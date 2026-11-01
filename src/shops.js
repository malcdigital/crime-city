import { PLACES, GUN_SHOP_BLOCKS } from './districts.js';
import { GUN_SHOPS } from './gunshops.js';
import * as THREE from 'three';
import { CFG, CRED_TIERS } from './config.js';
import { tierOf } from './claim.js';
import { WEAPONS } from './weapons.js';
import { GANG_GUNS } from './gang.js';
import { GANGS } from './turf.js';
import { dist, pick } from './util.js';
import { streetAt, SHOP_H } from './city.js';
import { ShopPreview } from './shoppreview.js';
import { dirIcon } from './icons.js';

// Money in and money out.
// In: every block Green Street holds pays every 10 minutes of play, more the higher your street
// cred ($100 a block as a Nobody up to $500 as Kingpin; the home block pays double) into a stash at the crew hangout. Walk up to it and grab it. Leave it sitting too
// long and a rival gang will hit it.
// Out: the gun shop (guns, ammo, body armor, crew gear), the mod garage (engine, brakes,
// armor, repair, respray) and a safehouse (respawn there, rest to heal).

const SAVE_KEY = 'crimecity.shop.v2'; // v2: the bigger map (properties reset)
// What each block pays per payout, by your street cred tier (Nobody .. Kingpin): the more
// respected you are, the more the block kicks up.
const PER_BLOCK = [100, 150, 200, 275, 375, 500];
const PERIOD = CFG.TURF_FAST ? 2 * 60 : 10 * 60; // seconds of play between payouts
const RAID_AFTER = 3; // uncollected payouts before a rival hits the stash

// What the gun shop sells. Ammo amounts are rounds per purchase.
const GUN_STOCK = [
  { id: 'pistol', price: 400, ammo: 36, ammoPrice: 60 },
  { id: 'smg', price: 1500, ammo: 90, ammoPrice: 150 },
  { id: 'shotgun', price: 2500, ammo: 18, ammoPrice: 120 },
  { id: 'rifle', price: 4500, ammo: 90, ammoPrice: 250 },
  { id: 'revolver', price: 900, ammo: 24, ammoPrice: 90 },
  { id: 'mpistol', price: 1200, ammo: 96, ammoPrice: 130 },
  { id: 'ak', price: 5200, ammo: 90, ammoPrice: 260 },
  { id: 'hunting', price: 6000, ammo: 20, ammoPrice: 200 },
];
const ARMOR_PRICE = 500;
// Crew gear: guns in two steps, and vests.
const CREW_GUNS = [
  { price: 3000, name: 'SMGs & shotguns', detail: 'No more pistols: every homie carries an SMG or a shotgun' },
  { price: 7500, name: 'Assault rifles', detail: 'Every homie carries an assault rifle' },
];
const CREW_VEST = { price: 4000, name: 'Crew vests', detail: 'Your homies take 40% less damage' };
// Mod garage, per car. Three levels each.
const MODS = {
  engine: { name: 'Engine', prices: [800, 1600, 3000], detail: (l) => `+${l * 7}% top speed, +${l * 12}% acceleration` },
  brakes: { name: 'Brakes', prices: [500, 1000, 2000], detail: (l) => `+${l * 15}% stopping power` },
  armor: { name: 'Armor', prices: [1000, 2000, 4000], detail: (l) => `Takes ${[0, 30, 55, 75][l]}% less damage` },
};
const REPAIR_PRICE = 250;
const RESPRAY_PRICE = 300;
const PAINTS = [0x1c1c1c, 0xf2f2f2, 0xb71c1c, 0x0d47a1, 0x1b5e20, 0xf9a825, 0x4a148c, 0x37474f, 0xe65100, 0x00838f];

const money = (n) => `$${n.toLocaleString('en-US')}`;
// The gun shop's categories (its menu is a carousel per category).
const CATS = [['guns', 'Guns'], ['ammo', 'Ammo'], ['armor', 'Armor'], ['crew', 'Crew']];
// A gun's numbers as bars, against the best in the game.
const GUNS = WEAPONS.filter((w) => !w.melee);
const STAT = {
  Damage: (w) => w.dmg * (w.pellets || 1),
  'Fire rate': (w) => 1 / w.rate,
  Accuracy: (w) => 1 / w.aimSpread,
  Range: (w) => w.range,
  Magazine: (w) => w.mag,
};
const STAT_MAX = Object.fromEntries(Object.entries(STAT).map(([k, f]) => [k, Math.max(...GUNS.map(f))]));
// A gun's numbers in a line: what it hits for, how fast, how many, how far.
export function specLine(w) {
  const rpm = Math.round(60 / w.rate);
  return `Damage ${w.dmg}${w.pellets ? ` ×${w.pellets}` : ''} · ${w.auto ? `${rpm} rounds/min` : `${rpm} shots/min`} · ${w.mag}-round mag · range ${w.range} m${w.scope ? ' · scope' : ''}`;
}
// What a gun costs at a shop (its list price times the shop's).
export function gunPrice(id, shop) {
  const s = GUN_STOCK.find((x) => x.id === id);
  return s ? Math.round((s.price * (shop?.mult || 1)) / 10) * 10 : 0;
}

// A block's storefront: the wall of the building facing its front street (city.storefront),
// plus a local frame for decorating it: frame(lx, lz) is a point lx along the wall (to the
// right as you face it) and -lz out in front of it; group() is a Group placed and turned the
// same way (so things built facing -z, the old north-facing way, face the street).
export function storefront(city, b) {
  const f = city.storefront(b);
  const th = Math.atan2(-f.nx, -f.nz);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const y0 = (f.y0 ?? 0.2) - 0.2;
  const frame = (lx, lz) => [f.wallX + lx * c + lz * s, f.wallZ - lx * s + lz * c];
  const group = (scene) => {
    const g = new THREE.Group();
    g.position.set(f.wallX, y0, f.wallZ);
    g.rotation.y = th;
    scene.add(g);
    return g;
  };
  return { ...f, block: b, frame, group, y0, rot: th };
}

export function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.strokeStyle = 'rgba(255,255,255,.5)';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 84);
  g.fillStyle = fg;
  g.font = 'bold 52px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Shops {
  constructor(game) {
    this.game = game;
    const city = game.city;
    const scene = game.scene;
    // Places.
    // The gun shops (src/gunshops.js): you go inside each (src/interiors.js). this.gun: Iron Mike's.
    this.gunShops = GUN_SHOPS.map((d, i) => ({ ...storefront(city, GUN_SHOP_BLOCKS[i]), ...d, i, color: '#c0392b', icon: 'gun' }));
    this.gun = this.gunShops[0];
    this.garage = { ...storefront(city, PLACES.garage), name: "Lou's Mod Garage", color: '#16a085', icon: 'M' };
    this.safe = { ...storefront(city, PLACES.safehouse), name: 'Safehouse', color: '#5d6d7e', icon: 'S' };
    {
      // The garage's drive-in spot: in the curb lane out front.
      const fs = this.garage.block.frontSide;
      const t = Math.max(6, Math.min(fs.len - 6, (this.garage.wallX - fs.ax) * fs.ux + (this.garage.wallZ - fs.az) * fs.uz));
      this.garage.x = fs.ax + fs.ux * t + fs.nx * 2.4;
      this.garage.z = fs.az + fs.uz * t + fs.nz * 2.4;
    }
    this.garage.r = 3.2;
    const sh = city.crewHome;
    this.stashAt = { x: sh.x + sh.ux * 1.1 - sh.nx * 3.2, z: sh.z + sh.uz * 1.1 - sh.nz * 3.2 }; // the duffel bag on the bench
    // Shop signs and doors.
    const front = (p, text, bg, door = true, y = Math.min(p.h - 1, 4.4)) => {
      const g = p.group(scene);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, '#fff') }));
      sign.position.set(0, y, -0.07);
      sign.rotation.y = Math.PI;
      g.add(sign);
      if (door) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
        d.position.set(0, 1.7, -0.06);
        d.rotation.y = Math.PI;
        g.add(d);
      }
      return sign;
    };
    for (const g of this.gunShops) front(g, g.sign, g.signBg, false, SHOP_H + 1.2); // (their doors are open: you walk in; the sign over the windows)
    front(this.garage, "LOU'S MOD GARAGE", '#0e6655');
    this.safeSign = front(this.safe, 'SAFEHOUSE', '#2c3e50');
    // Ground rings: walk-in (safehouse) and drive-in (garage).
    const ring = (x, z, r, color) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, city.groundY(x, z) + 0.05, z);
      scene.add(m);
      return m;
    };
    this.rings = [ring(this.safe.x, this.safe.z, 1.2, 0xbdc3c7), ring(this.garage.x, this.garage.z, this.garage.r, 0x1abc9c)];
    // The stash: a duffel bag on the bench, only there when there's money in it.
    const bag = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 10), new THREE.MeshLambertMaterial({ color: 0x1b2631 }));
    body.rotation.z = Math.PI / 2;
    bag.add(body);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 12, Math.PI), new THREE.MeshLambertMaterial({ color: 0x27ae60 }));
    strap.position.y = 0.18;
    bag.add(strap);
    bag.position.set(this.stashAt.x, city.groundY(this.stashAt.x, this.stashAt.z) + 0.7 + 0.22, this.stashAt.z);
    bag.rotation.y = Math.atan2(sh.ux, sh.uz) + Math.PI / 2;
    scene.add(bag);
    this.bag = bag;
    this.menu = null;
    this.buildMenu();
    this.load();
  }

  // ---- Save ----
  load() {
    let s = {};
    try {
      s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    } catch {
      // Fresh start.
    }
    this.stash = s.stash || 0;
    this.unpaid = s.unpaid || 0; // payouts sitting in the stash
    this.payT = s.payT || 0;
    // (the safehouse moved with the rebuilt city: owners from before get it back on the market,
    // once, with what it cost refunded to the bank)
    this.safehouse = !!s.safehouse && !!s.city2;
    this.refundSafehouse = !!s.safehouse && !s.city2;
    this.crewGuns = s.crewGuns || 0;
    this.crewVest = !!s.crewVest;
    this.game.armor = s.armor || 0;
    const ar = this.game.arsenal;
    if (s.slots) {
      ar.slots = s.slots;
      ar.active = s.active || 0;
    } else if (s.owned) {
      // Older saves: keep your two best guns.
      const best = ['rifle', 'shotgun', 'smg', 'pistol'].filter((id) => Object.values(s.owned).includes(id)).slice(0, 2);
      ar.slots = [best[0] || null, best[1] || null];
    } else if (CFG.START_ALL_GUNS) ar.slots = ['rifle', 'shotgun'];
    ar.refresh();
    if (s.ammo) for (const [id, v] of Object.entries(s.ammo)) if (ar.ammo[id]) Object.assign(ar.ammo[id], v);
    this.bag.visible = this.stash > 0;
    this.safeSign.material.color.set(this.safehouse ? 0xffffff : 0x888888);
  }

  save() {
    const ar = this.game.arsenal;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        stash: this.stash, unpaid: this.unpaid, payT: this.payT, safehouse: this.safehouse, city2: true, crewGuns: this.crewGuns,
        crewVest: this.crewVest, armor: Math.round(this.game.armor), slots: ar.slots, active: ar.active, ammo: ar.ammo,
      }));
    } catch {
      // Storage unavailable.
    }
  }

  // ---- Turf income ----
  payout() {
    const T = this.game.turfWars;
    if (T.underground('crew')) return 0;
    const n = T.count('crew');
    return n ? (n + (T.home.crew ? 1 : 0)) * this.perBlock() : 0;
  }

  perBlock() {
    return PER_BLOCK[tierOf(this.game.cred)];
  }

  update(dt) {
    const game = this.game;
    for (const r of this.rings) r.material.opacity = 0.5 + 0.25 * Math.sin(game.time * 4);
    this.bag.rotation.y = 0.3;
    this.payT += dt;
    if (this.payT >= PERIOD) {
      this.payT = 0;
      const sold = game.drugs.homieSales();
      if (sold) {
        this.stash += sold;
        this.bag.visible = true;
        game.hud.text(this.homie(), pick([`moved the work 💯 put ${money(sold)} in the stash`, `that pack gone. ${money(sold)} in the stash`, `we ran thru it. ${money(sold)} sittin in the stash`]));
      }
      const pay = this.payout();
      if (pay) {
        this.stash += pay;
        this.unpaid++;
        this.bag.visible = true;
        game.hud.text(this.homie(), pick([`blocks came thru 💯 ${money(pay)} this round (${money(this.perBlock())} a block). stash at ${money(this.stash)}`, `${money(pay)} came in off the blocks. stash sittin at ${money(this.stash)}, come grab it`, `yo the blocks paid. ${money(pay)}. stash at ${money(this.stash)} now`]));
        if (this.unpaid === RAID_AFTER - 1) {
          const r = this.raider();
          if (r) game.hud.text(this.homie(), `aye ${GANGS[r].name} been circlin the spot all day. come get the bread before they try sum`);
        } else if (this.unpaid >= RAID_AFTER) this.raid();
      }
      this.save();
    }
    // Keep crew gear on everyone (new homies show up over time).
    for (const m of game.crew.members) this.equip(m);
  }

  // Who texts you about the money: one of your homies.
  homie() {
    const m = this.game.crew.members.find((x) => x.alive);
    return m ? m.name : 'Green Street';
  }

  raider() {
    const T = this.game.turfWars;
    return ['kings', 'vipers'].filter((g) => !T.underground(g) && T.count(g)).sort((a, b) => T.count(b) - T.count(a))[0];
  }

  raid(gang = null) {
    const g = gang || this.raider();
    if (!g) return;
    const took = Math.round(this.stash * 0.5);
    this.stash -= took;
    this.unpaid = 0;
    // (in a pickup game: you hear about it after)
    this.game.afterGame(() => {
      this.game.hud.news(`${GANGS[g].name} hit Green Street's stash and walked off with ${money(took)}`, 'crime');
      this.game.hud.toast(`${GANGS[g].name} robbed your stash: -${money(took)}`, '#ff8080');
    });
  }

  collect() {
    const game = this.game;
    game.cash += this.stash;
    game.hud.toast(`+${money(this.stash)} from the stash`);
    game.sfx.cash?.();
    this.stash = 0;
    this.unpaid = 0;
    this.bag.visible = false;
    game.save();
    this.save();
  }

  // ---- Crew gear ----
  equip(m) {
    if (!m.alive) return;
    m.dmgK = this.crewVest ? 0.6 : 1;
    const want = this.crewGuns >= 2 ? 'rifle' : this.crewGuns === 1 && m.weapon.id === 'pistol' ? (Math.random() < 0.6 ? 'smg' : 'shotgun') : null;
    if (want && m.weapon.id !== want && (this.crewGuns >= 2 || m.weapon.id === 'pistol')) m.setWeapon(GANG_GUNS[want]);
  }

  // ---- Places, prompts and radar ----
  blips() {
    const out = [
      ...this.gunShops.map((g) => [g.x, g.z, g.color, 'gun']), // (a pistol: icons.js)
      [this.garage.x, this.garage.z, this.garage.color, 'wrench'],
      [this.safe.x, this.safe.z, this.safehouse ? '#2c3e50' : '#7f8c8d', 'safe'],
    ];
    if (this.stash > 0) out.push([this.stashAt.x, this.stashAt.z, '#27ae60', 'cash']);
    return out;
  }

  // Where you come back after being wasted or busted, if you own the safehouse.
  // Or the nearest home you own.
  respawnPoint() {
    const [px, pz] = this.game.player.pos();
    const homes = this.game.bank.ownedHomes().sort((a, b) => dist(a.x, a.z, px, pz) - dist(b.x, b.z, px, pz));
    return homes.length ? { x: homes[0].x, z: homes[0].z - 3 } : null;
  }

  // On foot: stash, gun shop, safehouse. In a car: the garage. Returns true if it showed a prompt.
  interact(a, dt) {
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    if (p.vehicle) {
      const v = p.vehicle;
      if (dist(v.x, v.z, this.garage.x, this.garage.z) > this.garage.r + 1) return false;
      if (v.wrecked) return false;
      if (Math.abs(v.speed) > 1.5) {
        game.prompt = `Stop in the ring to use ${this.garage.name}`;
        return true;
      }
      game.prompt = `Press ${key} to mod your ${v.type.label.toLowerCase()}`;
      if (pressed) this.open('garage');
      return true;
    }
    if (game.bank.interact(a)) return true;
    if (game.economy.interact(a)) return true;
    if (this.stash > 0 && dist(px, pz, this.stashAt.x, this.stashAt.z) < 1.8) {
      game.prompt = `Press ${key} to grab ${money(this.stash)} from the stash`;
      if (pressed) this.collect();
      return true;
    }
    if (dist(px, pz, this.safe.x, this.safe.z) < 1.6) {
      if (!this.safehouse) {
        const P = game.property;
        const home = game.bank.safeHome;
        const price = P.price(home);
        game.prompt = `Press ${key} to buy this safehouse for ${money(price)} (tax included; respawn here, stash, rest) · tax ~${money(P.weeklyTax(home))}/wk · upkeep ${money(P.dailyUpkeep(home))}/day`;
        if (pressed) {
          if (!game.bank.pay(price)) game.hud.toast(`You need ${money(price)} (bank + cash)`, '#ff8080');
          else {
            this.safehouse = true;
            P.bought(home, price);
            this.safeSign.material.color.set(0xffffff);
            game.hud.toast('Safehouse bought. You respawn here now.');
            game.hud.news(`Green Street pick up a safehouse on ${streetAt(this.safe.x, this.safe.z)}`, 'good');
            game.save();
            this.save();
          }
        }
      } else if (game.stars > 0) game.prompt = "Lose the cops first — don't lead them home";
      else {
        game.prompt = `Press ${key} for your safehouse (stash ${money(game.bank.safeHome.stash)} · rest)`;
        if (pressed) game.bank.openHome(game.bank.safeHome);
      }
      return true;
    }
    return false;
  }

  // ---- Menus ----
  buildMenu() {
    const el = document.createElement('div');
    el.id = 'shop';
    el.className = 'hidden';
    el.innerHTML = `<div class="shop-box"><div class="shop-head"><span class="shop-title"></span><span class="shop-cash"></span></div>`
      + `<div class="shop-car"><div class="car-tabs"></div><div class="car-stage"><canvas class="car-view"></canvas><button class="car-prev" aria-label="Previous">${dirIcon('left', 22)}</button><button class="car-next" aria-label="Next">${dirIcon('right', 22)}</button><div class="car-count"></div></div>`
      + `<div class="car-info"><div class="car-name"></div><div class="car-stats"></div><div class="car-detail"></div></div><div class="car-buyrow"><div class="car-dots"></div><button class="car-buy"></button></div></div>`
      + `<div class="shop-list"></div><div class="shop-detail"></div><div class="shop-help"></div></div>`;
    document.body.appendChild(el);
    this.el = el;
    el.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.shop-row');
      if (row && this.menu) this.select(+row.dataset.i);
    });
    this.preview = new ShopPreview(el.querySelector('.car-view'));
    // (the carousel: tabs, arrows, buy, a swipe across the stage)
    el.querySelector('.car-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]');
      if (t && this.menu) this.setTab(+t.dataset.t);
    });
    el.querySelector('.car-prev').addEventListener('click', () => this.step(-1));
    el.querySelector('.car-next').addEventListener('click', () => this.step(1));
    el.querySelector('.car-buy').addEventListener('click', () => this.buy());
    const stage = el.querySelector('.car-stage');
    // (a swipe: it turns over as soon as you've dragged far enough, one item per swipe)
    let sx = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      sx = e.clientX;
    });
    stage.addEventListener('pointermove', (e) => {
      if (sx === null || Math.abs(e.clientX - sx) < 40) return;
      this.step(e.clientX < sx ? 1 : -1);
      sx = null;
    });
    const end = () => (sx = null);
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', end);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.shop-car')) return;
      const row = e.target.closest('.shop-row');
      if (row && this.menu) {
        // Touchscreen: first tap selects (read the details), second tap buys.
        if (this.game.input.touchMode && this.menu.i !== +row.dataset.i) return this.select(+row.dataset.i);
        this.select(+row.dataset.i);
        this.buy();
      } else if (e.target === el) this.close();
    });
  }

  // A gun shop's clerk: his shop's racks, at his prices (src/interiors.js); focus: a gun to
  // open on (the one you were looking at).
  openGun(shop, focus = null) {
    this.open('gun');
    this.menu.shop = shop;
    this.menu.tab = 0;
    if (focus) {
      const k = this.items().findIndex((it) => it.gun === focus);
      if (k >= 0) this.menu.i = k;
    }
    this.render();
  }

  open(kind) {
    const game = this.game;
    this.menu = { kind, i: 0 };
    if (game.input.locked) game.input.unlock();
    this.el.classList.remove('hidden');
    this.el.querySelector('.shop-help').textContent = kind === 'gun'
      ? (game.input.touchMode ? 'Swipe or tap the arrows · tap a category · BUY · tap outside to leave' : game.input.mode === 'pad' ? 'D-pad ◀ ▶: browse · L1 / R1 or ↑↓: category · ✕: buy · ○: leave' : '← → / A D: browse · Q / R or ↑↓: category · Enter / click BUY · Esc: leave')
      : game.input.touchMode ? 'Tap to choose, tap again to buy · ○: leave' : game.input.mode === 'pad' ? 'D-pad ↑↓: choose · ✕: buy · ○: leave' : '↑↓ / W S: choose · Enter / click: buy · Esc: leave';
    this.el.classList.toggle('carousel', kind === 'gun');
    this.render();
  }

  close() {
    this.menu = null;
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
    this.el.classList.add('hidden');
  }

  // A menu with its own items (e.g. phone contacts).
  openCustom(title, items) {
    this.onClose = null;
    this.open('custom');
    this.menu.title = title;
    this.menu.custom = items;
    this.render();
  }

  // Items for the open menu: { label, price, detail, can (true or a reason), buy() }.
  items() {
    const game = this.game;
    const ar = game.arsenal;
    if (this.menu.custom) return this.menu.custom();
    if (this.menu.kind === 'custom') return [];
    if (this.menu.kind === 'gun') {
      const tab = CATS[this.menu.tab || 0][0];
      return this.gunItems().filter((it) => it.cat === tab);
    }
    // Garage: mods for the car you're in.
    const v = game.player.vehicle;
    if (!v) return [];
    v.mods = v.mods || { engine: 0, brakes: 0, armor: 0 };
    const list = [{
      label: 'Repair', price: REPAIR_PRICE, detail: `Body ${Math.round(v.health)}%`,
      can: v.health >= 99 ? 'Not damaged' : true, buy: () => (v.health = 100),
    }];
    for (const [k, m] of Object.entries(MODS)) {
      const l = v.mods[k];
      if (l >= 3) list.push({ label: `${m.name}: level 3 (max)`, price: 0, detail: m.detail(3), can: 'Maxed', buy: () => {} });
      else list.push({ label: `${m.name}: level ${l + 1}`, price: m.prices[l], detail: m.detail(l + 1), can: true, buy: () => v.mods[k]++ });
    }
    list.push({
      label: 'Respray', price: RESPRAY_PRICE, detail: game.stars > 0 ? 'New paint job — the cops lose a star' : 'New paint job',
      can: v.typeName === 'police' || v.typeName === 'swat' ? "Can't respray that" : true,
      buy: () => this.respray(v),
    });
    return list;
  }

  // Everything at a gun shop, in its categories: { cat, label, price, detail, can, buy(),
  // preview (what the carousel shows), weapon (for its numbers) }.
  gunItems() {
    const game = this.game;
    const ar = game.arsenal;
    const list = [];
    // (this shop's racks, at its prices)
    const shop = this.menu.shop || this.gun;
    const mult = shop.mult || 1;
    const price = (n) => Math.round((n * mult) / 10) * 10;
    for (const id of shop.stock || GUN_STOCK.map((s) => s.id)) {
      const s0 = GUN_STOCK.find((x) => x.id === id);
      const s = { ...s0, price: price(s0.price), ammoPrice: price(s0.ammoPrice) };
      const w = WEAPONS.find((x) => x.id === s.id);
      const have = ar.has(w.id);
      const out = have ? null : ar.wouldReplace(w.id);
      const outName = out ? WEAPONS.find((x) => x.id === out).name : null;
      list.push({
        cat: 'guns', label: w.name, price: s.price, gun: w.id, weapon: w, preview: { gun: w.id },
        detail: have ? 'You carry this one.' : `${out ? `You carry two guns: this replaces your ${outName}. ` : ''}Comes with ${s.ammo} rounds.`,
        can: have ? 'Owned' : true,
        buy: () => {
          ar.give(w.id);
          ar.ammo[w.id].mag = w.mag;
          ar.ammo[w.id].reserve += s.ammo;
        },
      });
      const am = ar.ammo[w.id];
      list.push({
        cat: 'ammo', label: `${w.name} ammo ×${s.ammo}`, price: s.ammoPrice, ammoFor: w.id, weapon: w, preview: { ammo: w.id },
        detail: `${have ? `Carrying ${am.mag + am.reserve}.` : `For the ${w.name} (you don't carry one).`} A box of ${s.ammo} rounds.`,
        can: true, buy: () => (am.reserve += s.ammo),
      });
    }
    list.push({
      cat: 'armor', label: 'Body armor', price: ARMOR_PRICE, preview: { armor: 1 },
      detail: `Soaks up most of the damage you take until it wears out. You're at ${Math.round(game.armor)}%.`,
      can: game.armor >= 100 ? 'Already full' : true, buy: () => (game.armor = 100),
    });
    const cg = CREW_GUNS[this.crewGuns];
    if (cg) list.push({ cat: 'crew', label: `Crew guns: ${cg.name}`, price: cg.price, detail: cg.detail, preview: { crew: this.crewGuns ? 'rifle' : 'smg' }, can: true, buy: () => this.crewGuns++ });
    else list.push({ cat: 'crew', label: 'Crew guns: maxed', price: 0, detail: 'Your homies all carry assault rifles', preview: { crew: 'rifle' }, can: 'Owned', buy: () => {} });
    list.push({ cat: 'crew', label: CREW_VEST.name, price: CREW_VEST.price, detail: CREW_VEST.detail, preview: { crew: 'vest' }, can: this.crewVest ? 'Owned' : true, buy: () => (this.crewVest = true) });
    return list;
  }

  // The carousel: the next or previous item, another category.
  step(d) {
    if (!this.menu) return;
    const n = this.items().length;
    if (!n) return;
    this.menu.dir = d;
    this.menu.i = (this.menu.i + d + n) % n;
    this.game.sfx.click?.();
    this.render();
  }

  setTab(t) {
    if (!this.menu || this.menu.tab === t) return;
    this.menu.tab = (t + CATS.length) % CATS.length;
    this.menu.i = 0;
    this.menu.dir = 1;
    this.render();
  }

  respray(v) {
    const game = this.game;
    const next = PAINTS.filter((c) => c !== v.color)[Math.floor(Math.random() * (PAINTS.length - 1))];
    v.repaint(next);
    if (game.stars > 0) {
      game.stars--;
      game.heat = game.stars ? CFG.STAR_HEAT[game.stars - 1] : 0;
      if (!game.stars) {
        game.clearWanted();
        game.police.standDown();
        game.hud.toast('Fresh paint. The cops lost you.');
      } else {
        game.lastSeen = game.time - 99; // they're looking for a different car now
        game.hud.toast(`Fresh paint. ${game.stars} star${game.stars > 1 ? 's' : ''} left.`);
      }
    }
  }

  select(i) {
    if (!this.menu || this.menu.i === i) return;
    this.menu.i = i;
    this.render();
  }

  buy() {
    const game = this.game;
    const item = this.items()[this.menu.i];
    if (!item) return;
    if (item.can !== true) return game.sfx.empty?.();
    // Shops take bank money (card first), then cash.
    if (!game.bank.pay(item.price)) {
      game.hud.toast("You can't afford that", '#ff8080');
      return;
    }
    item.buy();
    if (item.price) game.sfx.cash?.();
    game.save();
    this.save();
    if (this.menu) this.render(); // some choices close the menu
  }

  // Game paused while a menu is open.
  updateMenu(a) {
    if (this.menu?.kind === 'gun') {
      const now = performance.now();
      this.preview.frame(Math.min(0.1, (now - (this.lastFrame || now)) / 1000));
      this.lastFrame = now;
      if (a.menuLeft) this.step(-1);
      if (a.menuRight) this.step(1);
      if (a.menuUp || a.menuTabPrev) this.setTab(this.menu.tab - 1);
      if (a.menuDown || a.menuTabNext) this.setTab(this.menu.tab + 1);
      if (a.menuOk) this.buy();
      if (a.menuBack) this.close();
      return;
    }
    const n = this.items().length;
    if (a.menuUp) this.select((this.menu.i - 1 + n) % n);
    if (a.menuDown) this.select((this.menu.i + 1) % n);
    if (a.menuOk) this.buy();
    if (a.menuBack) this.close();
  }

  renderCarousel(items) {
    const game = this.game;
    const m = this.menu;
    const q = (c) => this.el.querySelector(c);
    const all = this.gunItems();
    q('.car-tabs').innerHTML = CATS.map(([k, name], t) => `<button data-t="${t}" class="${t === m.tab ? 'on' : ''}">${name}<small>${all.filter((it) => it.cat === k).length}</small></button>`).join('');
    const it = items[m.i];
    if (!it) return;
    this.preview.show(it.preview, m.dir || 1);
    q('.car-count').textContent = `${m.i + 1} / ${items.length}`;
    q('.car-name').textContent = it.label;
    // (a gun's numbers as bars; ammo shows the gun it's for)
    const w = it.weapon;
    q('.car-stats').innerHTML = w ? Object.entries(STAT).map(([k, f]) => {
      const v = Math.max(0.06, f(w) / STAT_MAX[k]);
      return `<div class="st"><span>${k}</span><b><i style="width:${Math.round(v * 100)}%"></i></b></div>`;
    }).join('') : '';
    q('.car-stats').classList.toggle('none', !w);
    q('.car-detail').textContent = it.detail;
    const off = it.can !== true;
    const poor = !off && !game.bank.canPay(it.price);
    const b = q('.car-buy');
    b.textContent = off ? it.can : `BUY · ${it.priceText ?? money(it.price)}`;
    b.className = `car-buy${off ? ' off' : ''}${poor ? ' poor' : ''}`;
    q('.car-dots').innerHTML = items.map((_, i) => `<i class="${i === m.i ? 'on' : ''}"></i>`).join('');
    this.lastFrame = performance.now();
    this.preview.frame(0);
  }

  render() {
    const game = this.game;
    const items = this.items();
    const m = this.menu;
    m.i = Math.min(m.i, items.length - 1);
    const place = m.kind === 'gun' ? m.shop || this.gun : this.garage;
    this.el.querySelector('.shop-title').textContent = m.title || place.name;
    this.el.querySelector('.shop-cash').textContent = `Cash ${money(game.cash)} · Bank ${money(game.bank.balance)}`;
    if (m.kind === 'gun') return this.renderCarousel(items);
    this.el.querySelector('.shop-list').innerHTML = items.map((it, i) => {
      const off = it.can !== true;
      const poor = !off && !game.bank.canPay(it.price);
      return `<div class="shop-row${i === m.i ? ' sel' : ''}${off ? ' off' : ''}${poor ? ' poor' : ''}" data-i="${i}"><span>${it.label}</span><span>${off ? it.can : it.priceText ?? money(it.price)}</span></div>`;
    }).join('');
    const it = items[m.i];
    this.el.querySelector('.shop-detail').textContent = it ? it.detail : '';
    this.el.querySelector('.shop-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
}

