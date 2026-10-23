import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { GANG_GUNS } from './gang.js';
import { PRODUCTS } from './drugs.js';
import { lam } from './character.js';
import { dist } from './util.js';

// The inventory strip. Tap L1 / Tab to swap your two weapons; hold it to open the strip.
// While it's open: D-pad ← → (arrow keys) picks an item, ✕ (E) gives it, □ (G) drops it.
// A press moves a set amount (one mag of ammo, $100, one unit of product); hold the button
// to move all of it. Weapons go whole.
// Giving: to another player next to you (multiplayer, later) or to a homie who's following
// you (they take guns and product: they'll use the gun, and sell the product into the stash).
const HOLD_ALL = 0.5; // seconds to hold for "all"
const CASH_STEP = 100;
const AMMO = [['pistol', 'Pistol'], ['smg', 'SMG'], ['rifle', 'Rifle'], ['shotgun', 'Shells']];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const gunName = (id) => WEAPONS.find((w) => w.id === id).name;

export class Inventory {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.holdT = 0;
    this.sel = 0;
    this.btn = { give: { t: 0, done: false }, drop: { t: 0, done: false } };
  }

  // Everything in the strip, in order.
  items() {
    const g = this.game;
    const ar = g.arsenal;
    const list = [0, 1].map((i) => ({ type: 'weapon', slot: i }));
    for (const [id, name] of AMMO) list.push({ type: 'ammo', id, name });
    list.push({ type: 'cash' });
    for (const k of Object.keys(g.drugs.inv)) list.push({ type: 'drug', kind: k });
    for (const it of list) {
      if (it.type === 'weapon') it.count = ar.slots[it.slot] ? 1 : 0;
      else if (it.type === 'ammo') it.count = ar.ammo[it.id].mag + ar.ammo[it.id].reserve;
      else if (it.type === 'cash') it.count = g.cash;
      else it.count = g.drugs.inv[it.kind];
    }
    return list;
  }

  update(dt, a) {
    const g = this.game;
    if (a.stripHeld && g.wastedT <= 0 && g.bustedT <= 0) {
      this.holdT += dt;
      if (!this.open && this.holdT > 0.2) this.open = true;
    } else if (this.holdT > 0) {
      if (!this.open) g.arsenal.swap();
      this.open = false;
      this.holdT = 0;
    }
    if (this.open) {
      const n = this.items().length;
      if (a.phoneLeft) this.sel = (this.sel - 1 + n) % n;
      if (a.phoneRight) this.sel = (this.sel + 1) % n;
      for (const [k, held] of [['give', a.giveHeld], ['drop', a.dropHeld]]) {
        const b = this.btn[k];
        if (held) {
          b.t += dt;
          if (b.t >= HOLD_ALL && !b.done) {
            b.done = true;
            this.act(k, true);
          }
        } else {
          if (b.t > 0 && !b.done) this.act(k, false);
          b.t = 0;
          b.done = false;
        }
      }
      // The strip has these buttons right now.
      a.phone = a.phoneToggle = false;
      a.sprint = a.reload = a.dealYes = a.dealNo = a.melee = false;
      a.interactHeld = false;
      a.nextWeapon = a.prevWeapon = false;
    } else {
      this.btn.give.t = this.btn.drop.t = 0;
      this.btn.give.done = this.btn.drop.done = false;
    }
    g.hud.inventoryStrip(g, this);
  }

  // Who's close enough to hand things to: other players (none yet) or homies following you.
  receiver() {
    const g = this.game;
    const [px, pz] = g.player.pos();
    const near = g.crew.following.filter((m) => m.standing && m.state !== 'inCar' && dist(m.x, m.z, px, pz) < 4.5);
    near.sort((p, q) => dist(p.x, p.z, px, pz) - dist(q.x, q.z, px, pz));
    return near[0] || null;
  }

  act(kind, all) {
    const g = this.game;
    const it = this.items()[this.sel];
    if (!it || it.count <= 0) return g.hud.toast(it && it.type === 'weapon' ? 'Empty slot' : 'You have none of that', '#ff8080');
    if (g.player.vehicle && kind === 'drop') return g.hud.toast('Get out of the car to drop things', '#ff8080');
    const ar = g.arsenal;
    if (kind === 'give') {
      const to = this.receiver();
      if (!to) return g.hud.toast('Nobody close enough to give to', '#ff8080');
      if (it.type === 'weapon') {
        const id = ar.slots[it.slot];
        if (!GANG_GUNS[id]) return g.hud.toast(`${to.name} can't use that`, '#ff8080');
        ar.slots[it.slot] = null;
        ar.refresh();
        to.setWeapon(GANG_GUNS[id]);
        to.givenGun = id;
        g.hud.toast(`Gave your ${gunName(id)} to ${to.name}`);
      } else if (it.type === 'drug') {
        const n = all ? it.count : 1;
        const P = PRODUCTS[it.kind];
        g.drugs.inv[it.kind] -= n;
        const h = g.drugs.homie;
        h.units += n;
        h.value += n * P.street * 0.8;
        h.per = Math.ceil(h.units / 3);
        g.hud.toast(`${to.name} will move ${n} ${n === 1 ? P.unit : P.units} of ${P.name.toLowerCase()} for you`);
      } else {
        return g.hud.toast(`${to.name} only takes guns and product. Cash and ammo go to other players.`, '#ff8080');
      }
      g.save();
      g.drugs.save();
      return;
    }
    // Drop it on the ground in front of you (pick it back up by walking over it).
    const h = g.player.heading;
    const [px, pz] = g.player.pos();
    const x = px + Math.sin(h) * 1.4;
    const z = pz + Math.cos(h) * 1.4;
    if (it.type === 'weapon') {
      const id = ar.slots[it.slot];
      ar.slots[it.slot] = null;
      ar.refresh();
      this.dropGun(x, z, id);
      g.hud.toast(`Dropped your ${gunName(id)}`);
    } else if (it.type === 'ammo') {
      const w = WEAPONS.find((q) => q.id === it.id);
      const n = all ? it.count : Math.min(it.count, w.mag);
      const am = ar.ammo[it.id];
      const fromReserve = Math.min(am.reserve, n);
      am.reserve -= fromReserve;
      am.mag -= n - fromReserve;
      g.dropAmmo(x, z, it.id, n);
      this.mine(g.pickups.at(-1));
      g.hud.toast(`Dropped ${n} ${it.name.toLowerCase()} ${it.id === 'shotgun' ? '' : 'rounds'}`.trim());
    } else if (it.type === 'cash') {
      const n = all ? it.count : Math.min(it.count, CASH_STEP);
      g.cash -= n;
      g.dropCash(x, z, n);
      this.mine(g.pickups.at(-1));
      g.hud.toast(`Dropped ${money(n)}`);
    } else {
      const n = all ? it.count : 1;
      g.drugs.inv[it.kind] -= n;
      this.dropDrug(x, z, it.kind, n);
      const P = PRODUCTS[it.kind];
      g.hud.toast(`Dropped ${n} ${n === 1 ? P.unit : P.units} of ${P.name.toLowerCase()}`);
    }
    g.save();
    g.drugs.save();
  }

  // Things you drop stay a while, and can't be picked up until you've stepped away.
  mine(p) {
    p.t = 300;
    p.armed = false;
  }

  dropDrug(x, z, kind, units) {
    const g = this.game;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.26), lam(kind === 'weed' ? 0x4f7a3f : kind === 'pills' ? 0xb15cc6 : 0xe8e8e8));
    m.position.set(x, 0.5, z);
    g.scene.add(m);
    g.pickups.push({ x, z, drug: kind, amount: units, mesh: m, t: 300, armed: false });
  }

  dropGun(x, z, id) {
    const g = this.game;
    const gg = GANG_GUNS[id];
    const [w, h, l] = gg ? gg.size : [0.1, 0.15, 0.5];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 1.6, h * 1.6, l * 1.6), lam(gg ? gg.color : 0x222222));
    m.position.set(x, 0.5, z);
    g.scene.add(m);
    g.pickups.push({ x, z, gun: id, mesh: m, t: 300, armed: false });
  }

  hint() {
    const pad = this.game.input.mode === 'pad';
    return pad ? 'D-pad ← → choose · ✕ give · □ drop · hold for all · tap L1 to swap weapons' : '← → choose · E give · G drop · hold for all · tap Tab to swap weapons';
  }
}

