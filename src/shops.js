import * as THREE from 'three';
import { CFG, CRED_TIERS } from './config.js';
import { tierOf } from './claim.js';
import { WEAPONS } from './weapons.js';
import { GANG_GUNS } from './gang.js';
import { GANGS } from './turf.js';
import { dist } from './util.js';
import { streetAt } from './city.js';

// Money in and money out.
// In: every block Green Street holds pays every 10 minutes of play, more the higher your street
// cred ($100 a block as a Nobody up to $500 as Kingpin; the home block pays double) into a stash at the crew hangout. Walk up to it and grab it. Leave it sitting too
// long and a rival gang will hit it.
// Out: the gun shop (guns, ammo, body armor, crew gear), the mod garage (engine, brakes,
// armor, repair, respray) and a safehouse (respawn there, rest to heal).

const SAVE_KEY = 'crimecity.shop.v1';
// What each block pays per payout, by your street cred tier (Nobody .. Kingpin): the more
// respected you are, the more the block kicks up.
const PER_BLOCK = [100, 150, 200, 275, 375, 500];
const PERIOD = CFG.TURF_FAST ? 2 * 60 : 10 * 60; // seconds of play between payouts
const RAID_AFTER = 3; // uncollected payouts before a rival hits the stash
const SAFEHOUSE_PRICE = 5000;

// What the gun shop sells. Ammo amounts are rounds per purchase.
const GUN_STOCK = [
  { id: 'smg', price: 1500, ammo: 90, ammoPrice: 150 },
  { id: 'shotgun', price: 2500, ammo: 18, ammoPrice: 120 },
  { id: 'rifle', price: 4500, ammo: 90, ammoPrice: 250 },
];
const ARMOR_PRICE = 500;
const PISTOL_AMMO = { ammo: 36, price: 60 };
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

// A storefront on the north face of a block: the building wall nearest the street there.
function storefront(city, i, j) {
  const b = city.blocks.find((k) => k.i === i && k.j === j);
  let best = null;
  for (const w of city.los) {
    const cx = (w.minX + w.maxX) / 2;
    const cz = (w.minZ + w.maxZ) / 2;
    if (cx < b.minX || cx > b.maxX || cz < b.minZ || cz > b.maxZ) continue;
    if (w.maxX - w.minX < 6) continue;
    if (!best || w.minZ < best.minZ - 0.1 || (Math.abs(w.minZ - best.minZ) < 0.1 && Math.abs(cx - b.cx) < Math.abs((best.minX + best.maxX) / 2 - b.cx))) best = w;
  }
  const x = best ? (best.minX + best.maxX) / 2 : b.cx;
  const wallZ = best ? best.minZ : b.minZ + 6;
  return { block: b, x, wallZ, z: wallZ - 1.6, h: best ? best.h : 6 };
}

function signTexture(text, bg, fg) {
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
    this.gun = { ...storefront(city, 2, 3), name: "Iron Mike's Guns", color: '#c0392b', icon: 'A' };
    this.garage = { ...storefront(city, 5, 4), name: "Lou's Mod Garage", color: '#16a085', icon: 'M' };
    this.safe = { ...storefront(city, 2, 4), name: 'Safehouse', color: '#5d6d7e', icon: 'S' };
    this.garage.z = this.garage.block.minZ - 3.6; // drive-in spot in the curb lane
    this.garage.r = 3.2;
    const sh = city.crewHome;
    this.stashAt = { x: sh.x + 1.1, z: sh.z + 3.2 }; // the duffel bag on the bench
    // Shop signs and doors.
    const front = (p, text, bg) => {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, '#fff') }));
      sign.position.set(p.x, Math.min(p.h - 1, 4.4), p.wallZ - 0.07);
      sign.rotation.y = Math.PI;
      scene.add(sign);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
      door.position.set(p.x, 1.7, p.wallZ - 0.06);
      door.rotation.y = Math.PI;
      scene.add(door);
      return sign;
    };
    front(this.gun, "IRON MIKE'S GUNS", '#8e1b10');
    front(this.garage, "LOU'S MOD GARAGE", '#0e6655');
    this.safeSign = front(this.safe, 'SAFEHOUSE', '#2c3e50');
    // Ground rings: walk-in (gun shop, safehouse) and drive-in (garage).
    const ring = (x, z, r, color) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, city.groundY(x, z) + 0.05, z);
      scene.add(m);
      return m;
    };
    this.rings = [ring(this.gun.x, this.gun.z, 1.2, 0xe74c3c), ring(this.safe.x, this.safe.z, 1.2, 0xbdc3c7), ring(this.garage.x, this.garage.z, this.garage.r, 0x1abc9c)];
    // The stash: a duffel bag on the bench, only there when there's money in it.
    const bag = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 10), new THREE.MeshLambertMaterial({ color: 0x1b2631 }));
    body.rotation.z = Math.PI / 2;
    bag.add(body);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 12, Math.PI), new THREE.MeshLambertMaterial({ color: 0x27ae60 }));
    strap.position.y = 0.18;
    bag.add(strap);
    bag.position.set(this.stashAt.x, 0.2 + 0.7 + 0.22, this.stashAt.z);
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
    this.safehouse = !!s.safehouse;
    this.crewGuns = s.crewGuns || 0;
    this.crewVest = !!s.crewVest;
    this.game.armor = s.armor || 0;
    const ar = this.game.arsenal;
    if (s.owned) ar.owned = s.owned;
    else if (!CFG.START_ALL_GUNS) ar.owned = { melee: 'fists', pistol: 'pistol' };
    if (s.ammo) for (const [id, v] of Object.entries(s.ammo)) if (ar.ammo[id]) Object.assign(ar.ammo[id], v);
    if (!ar.inSlot(ar.current().slot)) ar.select(WEAPONS.findIndex((w) => w.id === 'pistol'));
    this.bag.visible = this.stash > 0;
    this.safeSign.material.color.set(this.safehouse ? 0xffffff : 0x888888);
  }

  save() {
    const ar = this.game.arsenal;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        stash: this.stash, unpaid: this.unpaid, payT: this.payT, safehouse: this.safehouse, crewGuns: this.crewGuns,
        crewVest: this.crewVest, armor: Math.round(this.game.armor), owned: ar.owned, ammo: ar.ammo,
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
        game.hud.news(`Your homies moved product: ${money(sold)} into the stash`, 'good');
      }
      const pay = this.payout();
      if (pay) {
        this.stash += pay;
        this.unpaid++;
        this.bag.visible = true;
        const tier = CRED_TIERS[tierOf(game.cred)].name;
        game.hud.news(`Your turf paid out ${money(pay)} (${money(this.perBlock())} a block at ${tier}). Stash at the hangout: ${money(this.stash)}`, 'good');
        if (this.unpaid === RAID_AFTER - 1) {
          const r = this.raider();
          if (r) game.hud.news(`Word on the street: ${GANGS[r].name} are eyeing your stash. Go collect it.`, 'crime');
        } else if (this.unpaid >= RAID_AFTER) this.raid();
      }
      this.save();
    }
    // Keep crew gear on everyone (new homies show up over time).
    for (const m of game.crew.members) this.equip(m);
  }

  raider() {
    const T = this.game.turfWars;
    return ['kings', 'vipers'].filter((g) => !T.underground(g) && T.count(g)).sort((a, b) => T.count(b) - T.count(a))[0];
  }

  raid() {
    const g = this.raider();
    if (!g) return;
    const took = Math.round(this.stash * 0.5);
    this.stash -= took;
    this.unpaid = 0;
    this.game.hud.news(`${GANGS[g].name} hit Green Street's stash and walked off with ${money(took)}`, 'crime');
    this.game.hud.toast(`${GANGS[g].name} robbed your stash: -${money(took)}`, '#ff8080');
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
      [this.gun.x, this.gun.z, this.gun.color, 'A'],
      [this.garage.x, this.garage.z, this.garage.color, 'M'],
      [this.safe.x, this.safe.z, this.safehouse ? '#2c3e50' : '#7f8c8d', 'S'],
    ];
    if (this.stash > 0) out.push([this.stashAt.x, this.stashAt.z, '#27ae60', '$']);
    return out;
  }

  // Where you come back after being wasted or busted, if you own the safehouse.
  respawnPoint() {
    return this.safehouse ? { x: this.safe.x, z: this.safe.z - 3 } : null;
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
    if (this.stash > 0 && dist(px, pz, this.stashAt.x, this.stashAt.z) < 1.8) {
      game.prompt = `Press ${key} to grab ${money(this.stash)} from the stash`;
      if (pressed) this.collect();
      return true;
    }
    if (dist(px, pz, this.gun.x, this.gun.z) < 1.6) {
      if (game.stars > 0) {
        game.prompt = `${this.gun.name} won't serve you with the cops on you`;
        return true;
      }
      game.prompt = `Press ${key} to shop at ${this.gun.name}`;
      if (pressed) this.open('gun');
      return true;
    }
    if (dist(px, pz, this.safe.x, this.safe.z) < 1.6) {
      if (!this.safehouse) {
        game.prompt = `Press ${key} to buy this safehouse for ${money(SAFEHOUSE_PRICE)} (respawn here, rest to heal)`;
        if (pressed) {
          if (game.cash < SAFEHOUSE_PRICE) game.hud.toast(`You need ${money(SAFEHOUSE_PRICE)}`, '#ff8080');
          else {
            game.cash -= SAFEHOUSE_PRICE;
            this.safehouse = true;
            this.safeSign.material.color.set(0xffffff);
            game.hud.toast('Safehouse bought. You respawn here now.');
            game.hud.news(`Green Street pick up a safehouse on ${streetAt(this.safe.x, this.safe.z)}`, 'good');
            game.save();
            this.save();
          }
        }
      } else if (game.stars > 0) game.prompt = "Lose the cops first — don't lead them home";
      else {
        game.prompt = `Press ${key} to rest (heal up and save)`;
        if (pressed) {
          game.health = 100;
          game.save();
          this.save();
          game.turfWars.save();
          game.hud.toast('Rested. Game saved.');
        }
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
    el.innerHTML = `<div class="shop-box"><div class="shop-head"><span class="shop-title"></span><span class="shop-cash"></span></div><div class="shop-list"></div><div class="shop-detail"></div><div class="shop-help"></div></div>`;
    document.body.appendChild(el);
    this.el = el;
    el.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.shop-row');
      if (row && this.menu) this.select(+row.dataset.i);
    });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('.shop-row');
      if (row && this.menu) {
        this.select(+row.dataset.i);
        this.buy();
      } else if (e.target === el) this.close();
    });
  }

  open(kind) {
    const game = this.game;
    this.menu = { kind, i: 0 };
    if (game.input.locked) game.input.unlock();
    this.el.classList.remove('hidden');
    this.el.querySelector('.shop-help').textContent = game.input.mode === 'pad' ? 'D-pad ↑↓: choose · ✕: buy · ○: leave' : '↑↓ / W S: choose · Enter / click: buy · Esc: leave';
    this.render();
  }

  close() {
    this.menu = null;
    this.el.classList.add('hidden');
  }

  // A menu with its own items (e.g. phone contacts).
  openCustom(title, items) {
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
      const list = [];
      list.push({
        label: 'Body armor', price: ARMOR_PRICE, detail: 'Soaks up most of the damage you take until it wears out',
        can: game.armor >= 100 ? 'Already full' : true, buy: () => (game.armor = 100),
      });
      list.push({
        label: `Pistol ammo ×${PISTOL_AMMO.ammo}`, price: PISTOL_AMMO.price, detail: `Carrying ${ar.ammo.pistol.mag + ar.ammo.pistol.reserve}`,
        can: true, buy: () => (ar.ammo.pistol.reserve += PISTOL_AMMO.ammo),
      });
      for (const s of GUN_STOCK) {
        const w = WEAPONS.find((x) => x.id === s.id);
        const have = ar.owned[w.slot] === w.id;
        if (!have) {
          list.push({
            label: w.name, price: s.price, detail: `Comes with ${s.ammo} rounds`, can: true,
            buy: () => {
              ar.owned[w.slot] = w.id;
              ar.ammo[w.id].mag = w.mag;
              ar.ammo[w.id].reserve = s.ammo;
              ar.select(WEAPONS.indexOf(w));
            },
          });
        } else {
          const am = ar.ammo[w.id];
          list.push({
            label: `${w.name} ammo ×${s.ammo}`, price: s.ammoPrice, detail: `Carrying ${am.mag + am.reserve}`,
            can: true, buy: () => (am.reserve += s.ammo),
          });
        }
      }
      const cg = CREW_GUNS[this.crewGuns];
      if (cg) list.push({ label: `Crew guns: ${cg.name}`, price: cg.price, detail: cg.detail, can: true, buy: () => this.crewGuns++ });
      else list.push({ label: 'Crew guns: maxed', price: 0, detail: 'Your homies all carry assault rifles', can: 'Owned', buy: () => {} });
      list.push({ label: CREW_VEST.name, price: CREW_VEST.price, detail: CREW_VEST.detail, can: this.crewVest ? 'Owned' : true, buy: () => (this.crewVest = true) });
      return list;
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
    if (game.cash < item.price) {
      game.hud.toast("You can't afford that", '#ff8080');
      return;
    }
    game.cash -= item.price;
    item.buy();
    if (item.price) game.sfx.cash?.();
    game.save();
    this.save();
    if (this.menu) this.render(); // some choices close the menu
  }

  // Game paused while a menu is open.
  updateMenu(a) {
    const n = this.items().length;
    if (a.menuUp) this.select((this.menu.i - 1 + n) % n);
    if (a.menuDown) this.select((this.menu.i + 1) % n);
    if (a.menuOk) this.buy();
    if (a.menuBack) this.close();
  }

  render() {
    const game = this.game;
    const items = this.items();
    const m = this.menu;
    m.i = Math.min(m.i, items.length - 1);
    const place = m.kind === 'gun' ? this.gun : this.garage;
    this.el.querySelector('.shop-title').textContent = m.title || place.name;
    this.el.querySelector('.shop-cash').textContent = money(game.cash);
    this.el.querySelector('.shop-list').innerHTML = items.map((it, i) => {
      const off = it.can !== true;
      const poor = !off && game.cash < it.price;
      return `<div class="shop-row${i === m.i ? ' sel' : ''}${off ? ' off' : ''}${poor ? ' poor' : ''}" data-i="${i}"><span>${it.label}</span><span>${off ? it.can : it.priceText ?? money(it.price)}</span></div>`;
    }).join('');
    const it = items[m.i];
    this.el.querySelector('.shop-detail').textContent = it ? it.detail : '';
    this.el.querySelector('.shop-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
}

