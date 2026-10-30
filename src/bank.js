import * as THREE from 'three';
import { CFG } from './config.js';
import { BANKS, ATMS, HOMES } from './districts.js';
import { storefront, signTexture } from './shops.js';
import { streetAt, districtAt } from './city.js';
import { GANGS } from './turf.js';
import { dist } from './util.js';

// Where your money lives.
// - Cash on you: what plugs take (they don't do wires), and what you lose when opps drop you
//   or rob you.
// - City Bank: safe, but only open 9 AM to 6 PM (game clock), 2% to deposit, and a monthly fee.
//   Shops take bank money (card first, then cash). Three branches around the city.
// - ATMs: withdraw only, up to a limit per game day, any time.
// - Home stashes: every home you own (and the safehouse) has one. No fees, open any time — but
//   now and then one gets robbed (rarely at random; more when a gang has beef with you).
// You have to go to each place in person to put money in or take it out.
const SAVE_KEY = 'crimecity.bank.v2'; // v2: the rebuilt city (homes moved: ownership reset once)
const OLD_KEY = 'crimecity.bank.v1';
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtClock = (m) => `${(Math.floor(m / 60) % 12) || 12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;
const ROB_EVERY = 120; // seconds between rolls for a random break-in
const ROB_CHANCE = 0.008; // per home with money in it, per roll (about once every 4 hours of play)

export class Bank {
  constructor(game) {
    this.game = game;
    const city = game.city;
    const scene = game.scene;
    this.balance = 0;
    this.atmUsed = 0; // today
    this.days = 0; // game days played (for the monthly fee)
    this.feeDay = 0;
    this.lastClock = null;
    this.robT = ROB_EVERY;

    // A sign over a storefront's door (f: from storefront()).
    const sign = (f, text, y, w, h, bg) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, '#fff') }));
      m.position.set(0, y, -0.07);
      m.rotation.y = Math.PI;
      f.group(scene).add(m);
      return m;
    };
    const ring = (x, z, color) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.2, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, city.groundY(x, z) + 0.05, z);
      scene.add(m);
      return m;
    };

    // Bank branches.
    this.banks = BANKS.map(({ block, name }) => {
      const f = storefront(city, block);
      sign(f, name.toUpperCase(), Math.min(f.h - 1, 5), 10, 1.8, '#145a32');
      ring(f.x, f.z, 0x27ae60);
      return { name, x: f.x, z: f.z, street: streetAt(f.x, f.z) };
    });

    // ATMs: a little box on the sidewalk with a glowing screen.
    const atmGeo = new THREE.BoxGeometry(0.8, 1.7, 0.55);
    const atmMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x5dade2 });
    this.atms = ATMS.map((b) => {
      // On the front sidewalk, 6 m from its end, against the inside of the sidewalk.
      const sd = b.frontSide;
      const inset = Math.max(1.2, (b.sw || 3) - 0.9);
      const t = Math.max(3, sd.len - 6);
      const x = sd.ax + sd.ux * t - sd.nx * inset;
      const z = sd.az + sd.uz * t - sd.nz * inset;
      const y = city.groundY(x, z);
      const yaw = Math.atan2(sd.nx, sd.nz); // screen faces the street
      const m = new THREE.Mesh(atmGeo, atmMat);
      m.position.set(x, y + 0.85, z);
      m.rotation.y = yaw;
      m.castShadow = true;
      scene.add(m);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), screenMat);
      s.position.set(x + sd.nx * 0.28, y + 1.3, z + sd.nz * 0.28);
      s.rotation.y = yaw;
      scene.add(s);
      city.colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, h: y + 1.7 });
      return { x: x + sd.nx * 1.1, z: z + sd.nz * 1.1 };
    });

    // Homes for sale. The safehouse (from the shops) counts as a home too.
    this.homes = HOMES.map((h) => {
      const f = storefront(city, h.block);
      const s = sign(f, 'FOR SALE', Math.min(f.h - 1, 4.2), 6, 1.4, '#7f8c8d');
      ring(f.x, f.z, 0xf5b041);
      return { ...h, x: f.x, z: f.z, owned: false, stash: 0, sign: s, district: districtAt(f.x, f.z), street: streetAt(f.x, f.z) };
    });
    this.safeHome = { id: 'safe', name: 'Safehouse', stash: 0, get owned() { return game.shops.safehouse; }, get x() { return game.shops.safe.x; }, get z() { return game.shops.safe.z; } };
    this.load();
  }

  // ---- Save ----
  load() {
    try {
      let s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) {
        // From before the rebuild: keep the money (anything stashed in a home goes to the
        // bank), but the homes are back on the market.
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
        if (!old) return;
        const stashed = Object.values(old.homes || {}).reduce((t, o) => t + (o.stash || 0), 0);
        s = { ...old, balance: (old.balance || 0) + stashed, homes: {} };
      }
      this.balance = s.balance || 0;
      this.atmUsed = s.atmUsed || 0;
      this.days = s.days || 0;
      this.feeDay = s.feeDay || 0;
      this.safeHome.stash = s.safeStash || 0;
      for (const h of this.homes) {
        const o = s.homes?.[h.id];
        if (o) {
          h.owned = !!o.owned;
          h.stash = o.stash || 0;
        }
      }
    } catch {
      // Fresh start.
    }
    this.refreshSigns();
  }

  save() {
    try {
      const homes = {};
      for (const h of this.homes) homes[h.id] = { owned: h.owned, stash: h.stash };
      localStorage.setItem(SAVE_KEY, JSON.stringify({ balance: this.balance, atmUsed: this.atmUsed, days: this.days, feeDay: this.feeDay, safeStash: this.safeHome.stash, homes }));
    } catch {
      // Storage unavailable.
    }
  }

  refreshSigns() {
    const S = this.game.shops;
    if (S && S.safeSign) S.safeSign.material.color.set(S.safehouse ? 0xffffff : 0x888888);
    for (const h of this.homes) {
      if (h.owned === h.signOwned) continue;
      h.signOwned = h.owned;
      h.sign.material.map.dispose();
      h.sign.material.map = signTexture(h.owned ? 'HOME' : 'FOR SALE', h.owned ? '#1e8449' : '#7f8c8d', '#fff');
      h.sign.material.needsUpdate = true;
    }
  }

  // ---- Money helpers ----
  open() {
    const m = this.game.clockMinutes();
    return m >= CFG.BANK_OPEN && m < CFG.BANK_CLOSE;
  }

  hours() {
    return `${fmtClock(CFG.BANK_OPEN)}–${fmtClock(CFG.BANK_CLOSE)}`;
  }

  ownedHomes() {
    return [...(this.safeHome.owned ? [this.safeHome] : []), ...this.homes.filter((h) => h.owned)];
  }

  stashTotal() {
    return this.ownedHomes().reduce((n, h) => n + h.stash, 0);
  }

  // Shops take bank money: card first, then cash. Returns false if you can't cover it.
  canPay(price) {
    return this.balance + this.game.cash >= price;
  }

  pay(price) {
    if (!this.canPay(price)) return false;
    const fromBank = Math.min(this.balance, price);
    this.balance -= fromBank;
    this.game.cash -= price - fromBank;
    this.save();
    return true;
  }

  deposit(n) {
    const game = this.game;
    n = Math.min(n, game.cash);
    if (n <= 0) return;
    const fee = Math.ceil(n * CFG.BANK_DEPOSIT_FEE);
    game.cash -= n;
    this.balance += n - fee;
    game.hud.toast(`Deposited ${money(n - fee)} (${money(fee)} fee). Balance ${money(this.balance)}`);
    game.sfx.cash?.();
    game.save();
    this.save();
  }

  withdraw(n) {
    const game = this.game;
    n = Math.min(n, this.balance);
    if (n <= 0) return;
    this.balance -= n;
    game.cash += n;
    game.hud.toast(`Withdrew ${money(n)}. Balance ${money(this.balance)}`);
    game.sfx.cash?.();
    game.save();
    this.save();
  }

  // ---- Each frame ----
  update(dt) {
    const game = this.game;
    // A new game day at midnight: the ATM limit resets; every 30 days the monthly fee.
    const m = game.clockMinutes();
    if (this.lastClock !== null && m < this.lastClock) {
      this.days++;
      this.atmUsed = 0;
      if (this.days - this.feeDay >= 30) {
        this.feeDay = this.days;
        const fee = Math.min(this.balance, CFG.BANK_MONTHLY_FEE);
        if (this.balance > 0) {
          this.balance -= fee;
          game.hud.text('City Bank', `Monthly account fee: ${money(fee)}. Balance ${money(this.balance)}.`);
        }
      }
      game.property?.newDay(this.days);
      this.save();
    }
    this.lastClock = m;
    // Was the bank open during each debt's clock? (Then money in the bank counts as "had it".)
    if (this.open()) for (const d of game.drugs.debts) d.bankSeen = true;
    // Rare random break-ins at homes with money in them.
    this.robT -= dt;
    if (this.robT <= 0) {
      this.robT = ROB_EVERY;
      for (const h of this.ownedHomes()) {
        if (h.stash > 0 && Math.random() < ROB_CHANCE) {
          this.robHome(h, null);
          break;
        }
      }
    }
  }

  // Someone hit one of your stashes: they take half.
  robHome(h, gang) {
    const game = this.game;
    const took = Math.round(h.stash * 0.5);
    if (took <= 0) return;
    h.stash -= took;
    const who = gang ? GANGS[gang].name : 'Somebody';
    // (in a pickup game: you hear about it after)
    game.afterGame(() => {
      game.hud.toast(`${who} broke into your ${h.name.toLowerCase()}: -${money(took)}`, '#ff8080');
      game.hud.news(`Break-in on ${streetAt(h.x, h.z)}${gang ? `: ${GANGS[gang].name} suspected` : ''}`, 'crime');
    });
    this.save();
  }

  // The fattest stash you have (for gangs looking to hit you back).
  biggestHome() {
    return this.ownedHomes().filter((h) => h.stash > 0).sort((a, b) => b.stash - a.stash)[0] || null;
  }

  // ---- On foot: bank counters, ATMs, homes ----
  interact(a) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    for (const b of this.banks) {
      if (dist(px, pz, b.x, b.z) > 1.6) continue;
      if (!this.open()) {
        game.prompt = `${b.name} is closed · open ${this.hours()} · ATMs work any time`;
        return true;
      }
      game.prompt = `Press ${key} to bank at ${b.name} (balance ${money(this.balance)})`;
      if (pressed) game.shops.openCustom(`${b.name} · balance ${money(this.balance)}`, () => this.bankItems());
      return true;
    }
    for (const t of this.atms) {
      if (dist(px, pz, t.x, t.z) > 1.4) continue;
      game.prompt = `Press ${key} to use the ATM (balance ${money(this.balance)})`;
      if (pressed) game.shops.openCustom(`ATM · balance ${money(this.balance)}`, () => this.atmItems());
      return true;
    }
    for (const h of this.homes) {
      if (dist(px, pz, h.x, h.z) > 1.6) continue;
      if (!h.owned) {
        const P = game.property;
        const price = P.price(h);
        game.prompt = `Press ${key} to buy this ${h.name.toLowerCase()} for ${money(price)} (tax included) · tax ~${money(P.weeklyTax(h))}/wk · upkeep ${money(P.dailyUpkeep(h))}/day`;
        if (pressed) {
          if (!this.pay(price)) game.hud.toast(`You need ${money(price)} (bank + cash)`, '#ff8080');
          else {
            h.owned = true;
            P.bought(h, price);
            this.refreshSigns();
            game.hud.toast(`${h.name} bought. Stash money here any time.`);
            game.hud.news(`Green Street member buys a ${h.name.toLowerCase()} on ${h.street}`, 'good');
            game.save();
            this.save();
          }
        }
        return true;
      }
      if (game.stars > 0) {
        game.prompt = "Lose the cops first — don't lead them home";
        return true;
      }
      game.prompt = `Press ${key} for your ${h.name.toLowerCase()} (stash ${money(h.stash)})`;
      if (pressed) this.openHome(h);
      return true;
    }
    return false;
  }

  openHome(h) {
    this.game.shops.openCustom(`${h.name} · stash ${money(h.stash)}`, () => this.homeItems(h));
  }

  amounts(max, verb, act) {
    const list = [];
    for (const n of [100, 1000, 5000]) {
      list.push({ label: `${verb} ${money(n)}`, price: 0, priceText: '', detail: '', can: max >= n ? true : max > 0 ? 'Not enough' : 'Nothing to move', buy: () => act(n) });
    }
    list.push({ label: `${verb} all (${money(max)})`, price: 0, priceText: '', detail: '', can: max > 0 ? true : 'Nothing to move', buy: () => act(max) });
    return list;
  }

  bankItems() {
    const game = this.game;
    const dep = this.amounts(game.cash, 'Deposit', (n) => this.deposit(n)).map((it) => ({ ...it, detail: `${Math.round(CFG.BANK_DEPOSIT_FEE * 100)}% fee. Safe from robbers. Shops take bank money (plugs don't).` }));
    const wd = this.amounts(this.balance, 'Withdraw', (n) => this.withdraw(n)).map((it) => ({ ...it, detail: 'No limit at the counter. Plugs only take cash.' }));
    this.retitle(`City Bank · balance ${money(this.balance)} · cash ${money(game.cash)}`);
    return [...dep, ...wd];
  }

  atmItems() {
    const game = this.game;
    const left = Math.max(0, CFG.ATM_DAILY_LIMIT - this.atmUsed);
    this.retitle(`ATM · balance ${money(this.balance)} · ${money(left)} left today`);
    const list = [];
    for (const n of [100, 500, 1000, 2000]) {
      const ok = n > this.balance ? 'Not enough' : n > left ? 'Over the daily limit' : true;
      list.push({
        label: `Withdraw ${money(n)}`, price: 0, priceText: '', detail: `ATMs pay out up to ${money(CFG.ATM_DAILY_LIMIT)} a day (resets at midnight). No deposits.`, can: ok,
        buy: () => {
          this.atmUsed += n;
          this.withdraw(n);
        },
      });
    }
    return list;
  }

  homeItems(h) {
    const game = this.game;
    this.retitle(`${h.name} · stash ${money(h.stash)} · cash ${money(game.cash)}`);
    const put = (n) => {
      n = Math.min(n, game.cash);
      game.cash -= n;
      h.stash += n;
      game.hud.toast(`Stashed ${money(n)}. ${h.name} stash: ${money(h.stash)}`);
      game.save();
      this.save();
    };
    const take = (n) => {
      n = Math.min(n, h.stash);
      h.stash -= n;
      game.cash += n;
      game.hud.toast(`Took ${money(n)}. ${h.name} stash: ${money(h.stash)}`);
      game.save();
      this.save();
    };
    const list = [
      ...this.amounts(game.cash, 'Stash', put).map((it) => ({ ...it, detail: 'No fees, open any time. A stash can get robbed — more likely when a gang has beef with you.' })),
      ...this.amounts(h.stash, 'Take', take).map((it) => ({ ...it, detail: '' })),
    ];
    const P = game.property;
    if (h.owed > 0) {
      list.push({ label: `Pay what you owe (${money(h.owed)})`, price: 0, priceText: '', detail: 'Back taxes and bills. Two weeks behind and the city seizes the property.', can: true, buy: () => P.payOwed(h) });
    }
    list.push({
      label: `Sell it (${money(P.sellPrice(h))})`, price: 0, priceText: '', detail: `Market price ${money(P.price(h))}, less ${money(P.salesTax(P.price(h)))} sales tax. ${P.why(h)}. Take your stash first — it goes with the place.`, can: true,
      buy: () => {
        const price = P.price(h);
        const get = P.sellPrice(h);
        game.cash += h.stash; // you clear it out on the way
        h.stash = 0;
        this.balance += get; // the sale goes into the bank
        if (h === this.safeHome) game.shops.safehouse = false;
        else h.owned = false;
        P.sold(h, price);
        this.refreshSigns();
        game.shops.close();
        game.hud.toast(`Sold your ${h.name.toLowerCase()}: +${money(get)} to the bank`);
        game.shops.save();
        game.save();
        this.save();
      },
    });
    if (h === this.safeHome || h.owned) {
      list.push({
        label: 'Rest (heal up and save)', price: 0, priceText: '', detail: 'Full health. The game saves.', can: true,
        buy: () => {
          game.health = 100;
          game.save();
          game.shops.save();
          game.turfWars.save();
          this.save();
          game.hud.toast('Rested. Game saved.');
        },
      });
    }
    return list;
  }

  retitle(t) {
    const m = this.game.shops.menu;
    if (m) m.title = t;
  }

  // ---- Map ----
  blips() {
    const out = this.banks.map((b) => [b.x, b.z, this.open() ? '#1e8449' : '#566573', 'B']);
    for (const h of this.homes) out.push([h.x, h.z, h.owned ? '#d4ac0d' : '#7f8c8d', '⌂']);
    return out;
  }

  atmSpots() {
    return this.atms;
  }

  legend(add) {
    for (const b of this.banks) add('blip', this.open() ? '#1e8449' : '#566573', 'B', `${b.name} (${this.open() ? 'open' : `closed · ${this.hours()}`})`, b.x, b.z);
    const t = [...this.atms].sort((p, q) => dist(p.x, p.z, ...this.game.player.pos()) - dist(q.x, q.z, ...this.game.player.pos()))[0];
    if (t) add('dot', '#5dade2', '', `ATMs · ${this.atms.length} (nearest)`, t.x, t.z);
    for (const h of this.homes) add('blip', h.owned ? '#d4ac0d' : '#7f8c8d', '⌂', h.owned ? `Your ${h.name.toLowerCase()} · stash ${money(h.stash)}` : `${h.name} for sale · ${money(this.game.property.price(h))}`, h.x, h.z);
  }
}

