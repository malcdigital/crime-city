import { CFG } from './config.js';
import { makeCharacter, SKIN_TONES } from './character.js';
import { Vehicle } from './vehicle.js';
import { Soldier, GangRide, GANGS } from './turf.js';
import { tierOf } from './claim.js';
import { streetAt } from './city.js';
import { gpsRoute } from './gps.js';
import { dist, pick, rand, randInt } from './util.js';

// Drug dealing.
// - Plugs: three suppliers around the city, one product each. Call one from your phone
//   (Contacts) to set up a pickup. Solo pickups are small; a gang run (a big load) is only
//   for a Kingpin. The plug fronts it: you owe them, and have 30 minutes of play to pay.
//   Miss it and the plug puts a hit out on you (shooters keep coming until you pay, plus 50%).
// - The run: drive to the plug and load up. Bigger loads and harder product mean more risk:
//   the cops might raid the spot while you're there, or a rival gang hears about it and
//   chases you down on the way back. Get it to the hangout (with no cops on you) to finish.
// - Gang runs are split: 40% is yours to sell, your homies move the rest and the money goes
//   into the turf stash with each payout.
// - Selling: when you're holding and not busy, people walk (or drive) up wanting to buy.
//   Sell or turn them down. Some are undercover cops; some try to rob you (less often the
//   more street cred you have). Cred also brings more customers who spend more.

const SAVE_KEY = 'crimecity.drugs.v1';
const DEADLINE = 30 * 60; // seconds of play to pay the plug
const HIT_EVERY = 150; // seconds between hit squads while you owe past the deadline
const LOAD_TIME = 3;
export const PRODUCTS = {
  weed: { name: 'Weed', unit: 'bag', units: 'bags', cost: 15, street: 40, solo: 20, gang: 120, risk: 0.25, color: '#6ab04c' },
  pills: { name: 'Pills', unit: 'pack', units: 'packs', cost: 35, street: 85, solo: 12, gang: 70, risk: 0.4, color: '#e056fd' },
  coke: { name: 'Coke', unit: 'gram', units: 'grams', cost: 80, street: 190, solo: 6, gang: 40, risk: 0.55, color: '#dfe6e9' },
};
const PLUGS = [
  { id: 'smokey', name: 'Smokey', product: 'weed', block: [0, 1] },
  { id: 'doc', name: 'Doc', product: 'pills', block: [7, 5] },
  { id: 'marco', name: 'Marco', product: 'coke', block: [4, 7] },
];
// Customers by cred tier (Nobody .. Kingpin): seconds between them, robbery chance, spend.
const CUSTOMER_GAP = [90, 70, 55, 45, 35, 25];
const ROB_CHANCE = [0.18, 0.13, 0.09, 0.06, 0.04, 0.02];
const TELLS = ['seems nervous', 'shoes are too clean', 'keeps looking over his shoulder', 'asks a lot of questions', 'fresh haircut, no tattoos'];
// The plug's texts while you owe, colder the closer the deadline: [seconds left, message].
// {owe} and {name} are filled in.
const REMINDERS = [
  [20 * 60, "Hope it's moving good. {owe} when you're ready. Don't make me wait."],
  [10 * 60, '10 minutes. {owe}. I fronted you on trust.'],
  [5 * 60, "5 minutes. I'm not asking twice. {owe}."],
  [2 * 60, "2 minutes. You know what happens to people who play with my money."],
  [60, "60 seconds. My people already know what you drive."],
  [20, "Clock's out. Pray."],
];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const amountText = (kind, n) => `${n} ${n === 1 ? PRODUCTS[kind].unit : PRODUCTS[kind].units} of ${PRODUCTS[kind].name.toLowerCase()}`;

export class Drugs {
  constructor(game) {
    this.game = game;
    const city = game.city;
    // Plugs: a guy on the corner, and a pickup spot in the curb lane in front of him.
    this.plugs = PLUGS.map((p) => {
      const b = city.blocks.find((k) => k.i === p.block[0] && k.j === p.block[1]);
      const x = b.cx;
      const z = b.minZ - 3.6;
      const ch = makeCharacter({ shirt: 0x111111, pants: 0x222222, skin: pick(SKIN_TONES), bandana: 0x444444 });
      ch.group.position.set(x, city.groundY(x, b.minZ + 1.2), b.minZ + 1.2);
      ch.group.rotation.y = Math.PI;
      game.scene.add(ch.group);
      return { ...p, b, x, z, r: 4, street: streetAt(x, z) };
    });
    this.inv = { weed: 0, pills: 0, coke: 0 };
    this.homie = { units: 0, value: 0, per: 0 };
    this.debts = []; // { plug, owe, left, hit, nextHit }
    this.run = null;
    this.customer = null;
    this.custT = 30;
    this.squads = [];
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (s.inv) Object.assign(this.inv, s.inv);
      if (s.homie) this.homie = s.homie;
      if (s.debts) this.debts = s.debts;
    } catch {
      // Fresh start.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ inv: this.inv, homie: this.homie, debts: this.debts }));
    } catch {
      // Storage unavailable.
    }
  }

  plug(id) {
    return this.plugs.find((p) => p.id === id);
  }

  tier() {
    return tierOf(this.game.cred);
  }

  canGangRun() {
    return CFG.GANG_RUNS_ANY_RANK || this.tier() >= 5;
  }

  holding() {
    return this.inv.weed + this.inv.pills + this.inv.coke;
  }

  // ---- Phone: contacts ----
  contacts() {
    const game = this.game;
    const list = [];
    for (const d of this.debts) {
      const p = this.plug(d.plug);
      list.push({
        label: `Pay ${p.name} back`, price: d.owe, detail: d.hit ? `${p.name} has a hit out on you. Pay up to call it off.` : `${fmt(d.left)} left to pay`,
        can: true, buy: () => this.pay(d),
      });
    }
    if (this.run && this.run.stage === 'toPlug') {
      list.push({ label: 'Call off the pickup', price: 0, priceText: '', detail: `${this.plug(this.run.plug).name} won't be happy, but you don't owe anything yet`, can: true, buy: () => this.cancelRun() });
    }
    const why = this.run ? "You're already on a run" : this.debts.length ? 'Pay what you owe first' : game.stars > 0 ? 'Lose the cops first' : true;
    for (const p of this.plugs) {
      const P = PRODUCTS[p.product];
      list.push({
        label: `${p.name} · ${P.name} · ${P.solo} ${P.units}`, price: 0, priceText: `owe ${money(P.solo * P.cost)}`,
        detail: `Solo pickup on ${p.street}. Fronted: pay ${money(P.solo * P.cost)} within 30 min. Sells for about ${money(P.street)} a ${P.unit}.`,
        can: why, buy: () => this.startRun(p, 'solo'),
      });
      list.push({
        label: `${p.name} · gang run · ${P.gang} ${P.units}`, price: 0, priceText: `owe ${money(P.gang * P.cost)}`,
        detail: `A big load: much riskier. You keep 40% to sell, your homies move the rest into the stash.`,
        can: this.canGangRun() ? why : `Kingpin only`, buy: () => this.startRun(p, 'gang'),
      });
    }
    return list;
  }

  startRun(p, kind) {
    const game = this.game;
    const P = PRODUCTS[p.product];
    const amount = kind === 'gang' ? P.gang : P.solo;
    // Risk: the product, the size of the load, and a gang run draws more attention.
    const risk = Math.min(0.92, P.risk + (kind === 'gang' ? 0.25 : 0));
    let incident = null;
    if (Math.random() < risk) {
      const r = Math.random();
      const raidW = p.product === 'coke' ? 0.5 : p.product === 'pills' ? 0.4 : 0.3;
      incident = r < raidW ? 'raid' : 'chase';
      if (kind === 'gang' && Math.random() < 0.35) incident = 'both';
    }
    this.run = { plug: p.id, kind, product: p.product, amount, owe: amount * P.cost, stage: 'toPlug', incident, loadT: 0, chased: false };
    game.mapView.waypoint = [p.x, p.z];
    game.shops.close();
    game.hud.toast(`${p.name}: "Pull up on ${p.street}."`, '#e0b000');
  }

  cancelRun() {
    this.run = null;
    this.game.mapView.waypoint = null;
    this.game.hud.toast('Pickup called off');
  }

  pay(d) {
    const game = this.game;
    const p = this.plug(d.plug);
    this.debts = this.debts.filter((x) => x !== d);
    for (const sq of this.squads) sq.called = true;
    game.hud.toast(`Paid ${p.name} ${money(d.owe)}. You're square.`);
    game.hud.text(p.name, d.hit ? "Money's good. I called them off. Next time it won't be this easy." : 'We good. Pleasure doing business.');
  }

  // ---- Updates ----
  update(dt, a) {
    // Prompts and progress for the HUD (shown after the other interactions run).
    this.prompt = '';
    this.progress = null;
    this.updateRun(dt, a);
    this.updateDebts(dt);
    this.updateSquads(dt);
    this.updateCustomer(dt, a);
    this.updateRobbers(dt);
  }

  // Interact button at the plug / the hangout during a run. Returns true if it used it.
  updateRun(dt, a) {
    const game = this.game;
    const r = this.run;
    if (!r) return;
    const p = this.plug(r.plug);
    const pl = game.player;
    const [px, pz] = pl.pos();
    const v = pl.vehicle;
    if (r.stage === 'toPlug' || r.stage === 'loading') {
      const near = dist(px, pz, p.x, p.z) < p.r + (v ? 1 : 2) && (!v || Math.abs(v.speed) < 1.5);
      if (!near) {
        if (r.stage === 'loading') {
          // Took off before you were loaded: no product, no debt.
          game.hud.toast('You left without the product', '#ff8080');
          this.run = null;
          game.mapView.waypoint = null;
        }
        return;
      }
      if (r.stage === 'toPlug') {
        r.stage = 'loading';
        r.loadT = 0;
        if (r.incident === 'raid' || r.incident === 'both') {
          // The spot gets raided while you're there.
          game.crime(r.product === 'coke' || r.kind === 'gang' ? 'drugRaidBig' : 'drugRaid', p.x, p.z);
          game.hud.toast('RAID! Grab the stuff and get out!', '#ff8080');
          game.storyEvent(null, p.x, p.z, `Police raid a drug spot on ${p.street}`);
        }
      }
      r.loadT += dt;
      this.progress = { value: Math.min(1, r.loadT / LOAD_TIME), label: `Loading ${amountText(r.product, r.amount)}…` };
      if (r.loadT >= LOAD_TIME) {
        r.stage = 'toHQ';
        this.debts.push({ plug: p.id, owe: r.owe, left: DEADLINE, hit: false, nextHit: 0, warned: 0 });
        const hq = game.city.crewHome;
        game.mapView.waypoint = [hq.x, hq.z];
        game.hud.toast(`Loaded. Get it back to the hangout. You owe ${p.name} ${money(r.owe)}.`, '#e0b000');
        this.save();
      }
      return;
    }
    // On the way back.
    if ((r.incident === 'chase' || r.incident === 'both') && !r.chased && dist(px, pz, p.x, p.z) > 70) {
      r.chased = true;
      const T = game.turfWars;
      const rivals = ['kings', 'vipers'].filter((g) => !T.underground(g));
      rivals.sort((g1, g2) => this.gangDist(g1, px, pz) - this.gangDist(g2, px, pz));
      for (const g of rivals) {
        if (T.sendHunters(g, px, pz, r.kind === 'gang' ? 3 : 2)) {
          game.hud.toast(`${GANGS[g].name} heard you're carrying — they're coming for it!`, '#ff8080');
          game.hud.news(`${GANGS[g].name} hunting a Green Street drug run through ${streetAt(px, pz)}`, 'crime');
          break;
        }
      }
    }
    const hq = game.city.crewHome;
    if (dist(px, pz, hq.x, hq.z) < (v ? 9 : 4)) {
      if (game.stars > 0) {
        this.prompt = "Don't lead the cops to the hangout — lose them first";
        return;
      }
      this.deliver();
    }
  }

  gangDist(g, x, z) {
    const b = this.game.turfWars.homeBlock(g);
    return b ? dist(b.cx, b.cz, x, z) : 1e9;
  }

  deliver() {
    const game = this.game;
    const r = this.run;
    const P = PRODUCTS[r.product];
    this.run = null;
    game.mapView.waypoint = null;
    if (r.kind === 'gang') {
      const mine = Math.round(r.amount * 0.4);
      const theirs = r.amount - mine;
      this.inv[r.product] += mine;
      this.homie.units += theirs;
      this.homie.value += theirs * P.street * 0.8;
      this.homie.per = Math.ceil(this.homie.units / 3);
      game.hud.toast(`Run complete: ${amountText(r.product, mine)} for you, the rest to your homies`);
      game.cred += 60;
    } else {
      this.inv[r.product] += r.amount;
      game.hud.toast(`Run complete: you're holding ${amountText(r.product, r.amount)}`);
      game.cred += 15;
    }
    game.save();
    this.save();
  }

  // Your homies' sales, collected with each turf payout: about a third of their stock each time.
  homieSales() {
    const h = this.homie;
    if (h.units <= 0) return 0;
    const n = Math.min(h.units, h.per || h.units);
    const take = (h.value / h.units) * n;
    h.units -= n;
    h.value -= take;
    if (h.units <= 0) this.homie = { units: 0, value: 0, per: 0 };
    this.save();
    return Math.round(take);
  }

  updateDebts(dt) {
    const game = this.game;
    for (const d of this.debts) {
      const p = this.plug(d.plug);
      if (!d.hit) {
        d.left -= dt;
        // Texts from the plug, getting colder as time runs out.
        for (const [mark, msg] of REMINDERS) {
          if (d.left <= mark && (d.warned || 1e9) > mark) {
            d.warned = mark;
            game.hud.text(p.name, msg.replace('{owe}', money(d.owe)));
          }
        }
        if (d.left <= 0) {
          d.hit = true;
          d.owe = Math.round(d.owe * 1.5);
          d.nextHit = 5;
          game.hud.text(p.name, `You had your chance. There's a price on your head now. ${money(d.owe)} and maybe I call them off.`);
          game.hud.toast(`${p.name} put a hit out on you!`, '#ff8080');
          this.save();
        }
      } else {
        d.nextHit -= dt;
        if (d.nextHit <= 0 && !this.squads.some((s) => !s.called && s.plug === d.plug) && game.wastedT <= 0) {
          d.nextHit = HIT_EVERY;
          this.sendSquad(p);
        }
      }
    }
  }

  // Shooters from the plug: a black car leaves the plug's corner and hunts you down.
  sendSquad(p) {
    const game = this.game;
    const T = game.turfWars;
    const car = new Vehicle(game.scene, 'sedan', p.x, p.z, -Math.PI / 2, GANGS.plug.car);
    game.vehicles.push(car);
    const riders = [];
    for (let i = 0; i < 3; i++) {
      const s = new Soldier(game, T, p.x + 2 + i, p.b.minZ + 1.5, 'plug', null, 'guard');
      s.aggroUntil = game.time + 1e6;
      s.baseHeart = s.heart = 1;
      T.soldiers.push(s);
      riders.push(s);
    }
    const ride = new GangRide(T, car, riders, p.b, 'chase');
    T.rides.push(ride);
    this.squads.push({ plug: p.id, car, riders, called: false });
    game.hud.toast(`${p.name}'s shooters are coming for you`, '#ff8080');
    game.hud.text(p.name, `Sent some friends to see you. Still ${money(this.debts.find((x) => x.plug === p.id)?.owe || 0)} to make it stop.`);
  }

  updateSquads() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const sq of this.squads) {
      for (const s of sq.riders) {
        // Keep hunting you while the hit is on; when it's called off they stand down.
        if (!s.alive) continue;
        if (sq.called) s.aggroUntil = 0;
        else s.aggroUntil = Math.max(s.aggroUntil, game.time + 60);
        if (sq.called && dist(s.x, s.z, px, pz) > 80 && s.state !== 'inCar') s.dispose();
      }
      sq.riders = sq.riders.filter((s) => !s.removed && s.alive);
    }
    this.squads = this.squads.filter((sq) => sq.riders.length);
  }

  // ---- Street customers ----
  busy() {
    const game = this.game;
    const v = game.player.vehicle;
    return game.stars > 0 || game.time - (game.lastLoudT ?? -99) < 20 || (this.run && this.run.stage !== 'toPlug') || game.wastedT > 0 || game.bustedT > 0 || game.player.busy
      || game.turfWars.playerInWar() || game.turfWars.claim || (v && Math.abs(v.speed) > 1) || game.shops.menu;
  }

  updateCustomer(dt, a) {
    const game = this.game;
    const c = this.customer;
    if (!c) {
      if (!this.holding() || this.busy()) return;
      this.custT -= dt;
      if (this.custT > 0) return;
      this.custT = CUSTOMER_GAP[this.tier()] * rand(0.7, 1.3);
      this.findCustomer();
      return;
    }
    const [px, pz] = game.player.pos();
    c.t += dt;
    // Walk-up: they come to you. Drive-up: a car pulls over next to you.
    const ped = c.ped;
    let there = false;
    if (ped) {
      if (ped.removed || !ped.standing || ped.state !== 'buyer') return this.dropCustomer(false);
      there = dist(ped.x, ped.z, px, pz) < (game.player.vehicle ? 3.2 : 1.9);
    } else {
      const car = c.car;
      if (car.removed || car.wrecked || !car.driver || car.driver.stopAt !== c.stop) return this.dropCustomer(false);
      there = dist(car.x, car.z, px, pz) < 10 && Math.abs(car.speed) < 0.6;
      // Stuck in traffic for a while: they give up.
      c.stuckT = !there && Math.abs(car.speed) < 0.5 ? (c.stuckT || 0) + dt : 0;
      if (c.stuckT > 8 && !c.offer) return this.dropCustomer(false);
    }
    if (!c.offer) {
      if (c.t > (c.car ? 45 : 25) || (this.busy() && !there)) return this.dropCustomer(false);
      if (!there) return;
      this.makeOffer(c);
    }
    // Offer on the table.
    c.wait += dt;
    const k = game.input.mode === 'pad';
    const tell = c.tell ? ` · ${c.tell}` : '';
    this.prompt = `${c.ped ? 'Wants' : 'Driver wants'} ${amountText(c.kind, c.units)} · ${money(c.price)}${tell} — ${k ? '✕' : 'E'} sell · ${k ? '○' : 'Q'} no`;
    if (a.dealYes) this.sell(c);
    else if (a.dealNo || c.wait > 10 || this.busy()) {
      if (c.wait > 10) game.hud.toast('"Forget it then."');
      this.dropCustomer(false);
    }
    // The buttons are for the deal right now.
    a.melee = false;
    a.sprint = false;
    a.interactHeld = false;
  }

  findCustomer() {
    const game = this.game;
    const pl = game.player;
    const [px, pz] = pl.pos();
    // On foot near the curb: sometimes a car pulls up instead.
    if (!pl.vehicle && Math.random() < 0.4) {
      const near = [...game.vehicles].sort((p1, p2) => dist(p1.x, p1.z, px, pz) - dist(p2.x, p2.z, px, pz));
      for (const car of near) {
        const d = car.driver;
        if (!d || !d.cruise || !d.active || car.removed || car.wrecked || d.stopAt || Math.abs(car.speed) < 3) continue;
        const dd = dist(car.x, car.z, px, pz);
        if (dd < 30 || dd > 160) continue;
        // It drives over through the streets and pulls up at the curb next to you.
        const route = gpsRoute(game.city, car.x, car.z, px, pz);
        if (route.length < 3) continue;
        const [rx, rz] = route[route.length - 2]; // middle of your street
        const k = dist(rx, rz, px, pz) || 1;
        route[route.length - 1] = [rx + ((px - rx) / k) * Math.min(k, 4.6), rz + ((pz - rz) / k) * Math.min(k, 4.6)];
        route[0] = [car.x, car.z];
        const stop = [px, pz];
        d.stopAt = stop;
        d.driveTo(route);
        this.customer = { car, stop, t: 0, wait: 0, offer: false };
        return;
      }
    }
    const peds = game.peds.peds.filter((p) => p.state === 'walk' && !p.shopkeeper && dist(p.x, p.z, px, pz) > 10 && dist(p.x, p.z, px, pz) < 45);
    if (!peds.length) {
      this.custT = 8;
      return;
    }
    const ped = pick(peds);
    ped.state = 'buyer';
    this.customer = { ped, t: 0, wait: 0, offer: false };
  }

  makeOffer(c) {
    const game = this.game;
    const tier = this.tier();
    const kinds = Object.keys(this.inv).filter((k) => this.inv[k] > 0);
    c.kind = pick(kinds);
    const P = PRODUCTS[c.kind];
    c.units = Math.min(this.inv[c.kind], randInt(1, 2 + tier));
    c.price = Math.round((c.units * P.street * (1 + 0.08 * tier) * rand(0.9, 1.1)) / 5) * 5;
    // Is it a setup? More likely on a big buy, less on your own turf.
    const turf = game.turfWars.turfAt(game.player.x, game.player.z);
    let uc = 0.05 + 0.015 * c.units + (c.kind === 'coke' ? 0.04 : 0);
    if (turf && turf.id === 'crew') uc *= 0.6;
    c.undercover = Math.random() < uc;
    c.rob = !c.undercover && Math.random() < ROB_CHANCE[tier];
    // Sometimes you can read them.
    c.tell = (c.undercover ? Math.random() < 0.65 : Math.random() < 0.12) ? pick(TELLS) : '';
    c.offer = true;
  }

  sell(c) {
    const game = this.game;
    const where = c.ped || c.car;
    this.inv[c.kind] -= c.units;
    if (c.undercover) {
      game.crime('drugDeal', where.x, where.z);
      game.hud.toast("It's a setup — undercover cop!", '#ff8080');
      this.dropCustomer(true);
    } else if (c.rob) {
      game.hud.toast(c.ped ? 'He snatched it and ran! Get it back!' : 'They grabbed it and took off!', '#ff8080');
      if (c.ped) {
        c.ped.loot = { kind: c.kind, units: c.units };
        c.ped.state = 'walk';
        c.ped.scare(game.player.x, game.player.z);
        this.robbers = [...(this.robbers || []), { ped: c.ped, t: 30 }];
      }
      this.dropCustomer(true);
    } else {
      game.cash += c.price;
      game.cred += 1 + Math.floor(c.units / 3);
      game.sfx.cash?.();
      game.hud.toast(`+${money(c.price)}`);
      this.dropCustomer(true);
    }
    game.save();
    this.save();
  }

  // Robbers who got away with your stuff: knock them down or kill them to get it back.
  updateRobbers(dt) {
    if (!this.robbers) return;
    const game = this.game;
    for (const r of this.robbers) {
      r.t -= dt;
      const p = r.ped;
      if (!p.loot) continue;
      if (!p.standing) {
        this.inv[p.loot.kind] += p.loot.units;
        game.hud.toast(`Got your ${PRODUCTS[p.loot.kind].name.toLowerCase()} back`);
        p.loot = null;
        this.save();
      }
    }
    this.robbers = this.robbers.filter((r) => r.ped.loot && r.t > 0 && !r.ped.removed);
  }

  dropCustomer(dealt) {
    const c = this.customer;
    this.customer = null;
    if (!c) return;
    if (c.ped && c.ped.state === 'buyer') {
      c.ped.resumeWalking();
      c.ped.hurryT = 6;
    }
    if (c.car && c.car.driver && c.car.driver.stopAt === c.stop) {
      c.car.driver.release(this.game);
      if (dealt && (c.rob || c.undercover)) c.car.driver.cruise = 20; // peel off
    }
    if (!dealt) this.custT = Math.min(this.custT, 20);
  }

  // Busted: the cops take everything you're holding. Wasted: whatever was in the car is gone.
  onBusted() {
    const had = this.holding() + (this.run && this.run.stage === 'toHQ' ? this.run.amount : 0);
    if (had) this.game.hud.news(`Police seize drugs from an arrested Green Street member`, 'info');
    this.inv = { weed: 0, pills: 0, coke: 0 };
    this.lostRun();
  }

  onWasted() {
    this.lostRun();
  }

  lostRun() {
    if (this.run) {
      if (this.run.stage === 'toHQ') this.game.hud.toast(`The load is gone — you still owe ${this.plug(this.run.plug).name}`, '#ff8080');
      this.run = null;
      this.game.mapView.waypoint = null;
    }
    this.dropCustomer(false);
    this.save();
  }

  // ---- HUD ----
  banner() {
    const r = this.run;
    if (r) {
      const p = this.plug(r.plug);
      if (r.stage === 'toPlug') return `DRUG RUN · pick up ${amountText(r.product, r.amount)} from ${p.name} on ${p.street}`;
      if (r.stage === 'loading') return `DRUG RUN · loading up at ${p.name}'s`;
      return `DRUG RUN · get ${amountText(r.product, r.amount)} back to the hangout`;
    }
    const d = this.debts[0];
    if (d) {
      const p = this.plug(d.plug);
      return d.hit ? `HIT ON YOU · ${p.name}'s shooters · pay ${money(d.owe)} (phone → contacts)` : `OWE ${p.name.toUpperCase()} ${money(d.owe)} · ${fmt(d.left)} left`;
    }
    return '';
  }

  hudLine() {
    const parts = Object.entries(this.inv).filter(([, n]) => n > 0).map(([k, n]) => `${PRODUCTS[k].name} ${n}`);
    if (this.run && this.run.stage === 'toHQ') parts.unshift(`Carrying ${this.run.amount}`);
    return parts.join(' · ');
  }

  blips() {
    return this.plugs.map((p) => [p.x, p.z, this.run && this.run.plug === p.id ? '#e0b000' : '#6c3483', 'D']);
  }
}

