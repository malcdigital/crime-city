import * as THREE from 'three';
import { CRIMES } from './config.js';
import { lam } from './character.js';
import { dist } from './util.js';

// Getting arrested, booked, and getting out.
// - The arrest: you're cuffed where you stand (pulled out of the car first), an officer at your
//   back; then it's the ride to Central Precinct.
// - Booking: the charges (everything you did since you were last clear of the police) and your
//   record decide the sentence (game hours) and the bail. Then:
//     Post bail      - out now; costs money (more with a record; denied for killing a cop or
//                      more than one body).
//     Hire a lawyer  - a fee; usually gets it thrown out (75%), otherwise half the time.
//     Public defender - free; sometimes gets it thrown out (30%), otherwise most of the time.
//     Do the time    - the clock runs on while you're inside (up to two game days); street cred
//                      for doing it quietly.
//   Gun charges (shooting, killing, robbery) mean your guns are kept as evidence unless the
//   case is thrown out. You walk out of the precinct door, healed up.
// - Your record: every arrest counts against you (bigger sentences and bail) and falls off one
//   at a time, every 3 quiet game days. Saved.
const SAVE_KEY = 'crimecity.record.v1';
const HOUR = 120; // game.time seconds in a game hour
// Hours for each charge (the first count of each in full, more of the same at half).
const HOURS = {
  assault: 2, hitAndRun: 3, carjack: 4, assaultCop: 6, runOverCop: 10, stealCopCar: 5,
  robberyAlarm: 0, robbery: 8, gunfire: 2, murder: 18, copKilled: 36, gangKill: 10, explosion: 6,
  drugRaid: 4, drugRaidBig: 8, drugDeal: 6, possession: 2, fleeStop: 2, carTheft: 2, gambling: 1,
  resisting: 3, bribery: 3,
};
const LABELS = { resisting: 'Resisting arrest', bribery: 'Bribing an officer' };
const GUN_CHARGES = ['gunfire', 'murder', 'copKilled', 'gangKill', 'robbery'];
const MAX_HOURS = 48;

export class Justice {
  constructor(game) {
    this.game = game;
    this.charges = {}; // type -> count, since you were last clear
    this.record = { arrests: 0, lastDay: 0 };
    this.arrest = null;
    this.load();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s) Object.assign(this.record, s);
    } catch {
      // Storage unavailable.
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.record));
    } catch {
      // Storage unavailable.
    }
  }

  // A crime on your sheet (main.js crime()).
  note(type) {
    if (!(type in HOURS)) return;
    this.charges[type] = (this.charges[type] || 0) + 1;
  }

  // Clear of the police (escaped, a dirty cop let you go): the slate's wiped.
  clear() {
    if (!this.arrest) this.charges = {};
  }

  // ---- The numbers ----
  sentence(charges = this.charges) {
    let h = 0;
    for (const [t, n] of Object.entries(charges)) h += (HOURS[t] || 0) * (1 + (n - 1) * 0.5);
    h *= 1 + this.record.arrests * 0.3;
    return Math.round(Math.max(2, Math.min(MAX_HOURS, h)));
  }

  bail(charges = this.charges) {
    if (charges.copKilled || (charges.murder || 0) > 1) return null; // denied
    return Math.max(300, Math.round((this.sentence(charges) * 250 * (1 + this.record.arrests * 0.25)) / 50) * 50);
  }

  lawyerFee(charges = this.charges) {
    const b = this.bail(charges) ?? this.sentence(charges) * 400;
    return Math.round((800 + b * 0.3) / 50) * 50;
  }

  sheet(charges = this.charges) {
    const list = Object.entries(charges).filter(([, n]) => n > 0).map(([t, n]) => `${LABELS[t] || CRIMES[t]?.label || t}${n > 1 ? ` ×${n}` : ''}`);
    return list.length ? list.join(' · ') : 'Disorderly conduct';
  }

  // ---- The arrest ----
  // Called from main.bust() once it's a real arrest (not a dirty cop letting you go).
  start(opts = {}) {
    const game = this.game;
    if (opts.resisting) this.note('resisting');
    if (opts.bribery) this.note('bribery');
    if (!Object.keys(this.charges).length) this.charges.fleeStop = 1; // (they had you for something)
    const p = game.player;
    if (p.vehicle) p.exit();
    p.stopRolling?.();
    const charges = { ...this.charges };
    this.arrest = { charges, t: 0 };
    this.cuff();
    game.hud.busted(true, `Arrested: ${this.sheet(charges)}`);
  }

  // Cuffed: hands behind your back, an officer at your back.
  cuff() {
    const game = this.game;
    const c = game.player.char;
    if (!c) return;
    c.armL.rotation.set(0.55, 0, -0.25);
    c.armR.rotation.set(0.55, 0, 0.25);
    const steel = lam(0xcfd6dc);
    this.cuffs = new THREE.Group();
    for (const dx of [-0.07, 0.07]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 5, 12), steel);
      ring.position.set(dx, 0.92, -0.32);
      ring.rotation.x = Math.PI / 2;
      this.cuffs.add(ring);
    }
    c.group.add(this.cuffs);
    // The nearest officer steps in behind you.
    const [px, pz] = game.player.pos();
    let o = null;
    for (const q of game.police.officers()) if (q.standing && (!o || dist(q.x, q.z, px, pz) < dist(o.x, o.z, px, pz))) o = q;
    if (o && dist(o.x, o.z, px, pz) < 30) {
      const h = game.player.heading || 0;
      o.x = px - Math.sin(h) * 0.9;
      o.z = pz - Math.cos(h) * 0.9;
      o.heading = h;
      o.script = { x: o.x, z: o.z, fx: px, fz: pz, pose: (ch) => { ch.armR.rotation.x = -1.3; ch.armL.rotation.x = -0.4; } };
      o.char.armR.rotation.x = -1.3; // (hand on your shoulder)
      o.place();
      this.escort = o;
    }
  }

  uncuff() {
    const c = this.game.player.char;
    if (this.cuffs) c?.group.remove(this.cuffs);
    this.cuffs = null;
    if (c) {
      c.armL.rotation.set(0, 0, 0);
      c.armR.rotation.set(0, 0, 0);
    }
    if (this.escort) this.escort.script = null;
    this.escort = null;
  }

  // ---- Booking (main.afterBust, once the arrest scene is over) ----
  book() {
    const game = this.game;
    const A = this.arrest;
    if (!A) return false;
    game.hud.busted(false);
    this.uncuff();
    game.police.clearAll();
    // You're at the precinct now.
    const st = game.city.station;
    game.respawnAt(st);
    const ch = A.charges;
    const h = this.sentence(ch);
    const bail = this.bail(ch);
    const fee = this.lawyerFee(ch);
    const priors = this.record.arrests;
    const gunNote = GUN_CHARGES.some((t) => ch[t]) ? ' · your guns are held as evidence' : '';
    const list = () => [
      { label: `Charges: ${this.sheet(ch)}`, price: 0, can: priors ? `${priors} prior` : 'first arrest', detail: `Sentence: ${h} hours${gunNote}` },
      {
        label: 'Post bail', price: bail ?? 0, detail: bail ? 'Out right now' : 'Bail denied on these charges',
        can: bail ? true : 'Denied', buy: () => this.release('bail', 0, false),
      },
      {
        label: 'Hire a lawyer', price: fee, detail: `Usually gets it thrown out (75%); if not, ${Math.ceil(h * 0.5)} hours`, can: true,
        buy: () => (Math.random() < 0.75 ? this.release('lawyer', 1, true) : this.release('lawyer', Math.ceil(h * 0.5), false)),
      },
      {
        label: 'Public defender', price: 0, priceText: 'Free', detail: `Sometimes gets it thrown out (30%); if not, ${Math.ceil(h * 0.8)} hours`, can: true,
        buy: () => (Math.random() < 0.3 ? this.release('defender', 3, true) : this.release('defender', Math.ceil(h * 0.8), false)),
      },
      { label: 'Do the time', price: 0, priceText: `${h} h`, detail: 'Keep your money; the streets respect it', can: true, buy: () => this.release('time', h, false) },
    ];
    game.shops.openCustom('Central Precinct · Booking', list);
    game.shops.menu.i = 1;
    const help = game.shops.el.querySelector('.shop-help');
    if (help) help.textContent = help.textContent.replace(/leave$/, 'do the time');
    // (no walking out of booking: closing it means doing the time)
    game.shops.onClose = () => {
      if (this.arrest) this.release('time', h, false);
    };
    return true;
  }

  // Out: the clock runs on for however long you were inside.
  release(kind, hours, dismissed) {
    const game = this.game;
    const A = this.arrest;
    if (!A) return;
    this.arrest = null;
    game.shops.onClose = null;
    if (game.shops.menu) game.shops.close();
    const ch = A.charges;
    // Time inside (in steps, so every midnight still counts: bills, elections, debts).
    let left = hours * HOUR;
    while (left > 0) {
      const step = Math.min(left, 3 * HOUR);
      game.time += step;
      left -= step;
      game.bank?.update(0);
    }
    // Guns kept as evidence.
    const guns = GUN_CHARGES.some((t) => ch[t]) && !dismissed;
    if (guns) {
      game.arsenal.slots = [null, null];
      game.arsenal.selectSlot?.(0);
      game.arsenal.refresh?.();
    }
    // Street cred.
    let cred = 0;
    if (kind === 'time') cred = Math.min(40, hours * 2);
    else if (dismissed) cred = 5;
    else if (kind === 'bail') cred = -5;
    game.cred = Math.max(0, game.cred + cred);
    game.health = 100;
    this.record.arrests += 1;
    this.record.lastDay = game.bank?.days || 0;
    this.charges = {};
    this.save();
    const how = dismissed ? 'Case thrown out' : kind === 'bail' ? 'Out on bail' : `Released after ${hours} hours`;
    game.hud.toast(`${how}${guns ? ' · guns kept as evidence' : ''}${cred ? ` · ${cred > 0 ? '+' : ''}${cred} cred` : ''}`, dismissed ? '#7ee081' : '#9fc3ff');
    game.hud.news(dismissed ? 'Charges dropped against a Green Street member' : kind === 'time' ? `Green Street member released from Central Precinct after ${hours} hours` : 'Green Street member out on bail', 'info');
    game.save();
  }

  // ---- Each frame ----
  update() {
    const game = this.game;
    // The record fades: one arrest off every 3 game days without a new one.
    const day = game.bank?.days || 0;
    if (this.record.arrests > 0 && day - this.record.lastDay >= 3) {
      this.record.arrests -= 1;
      this.record.lastDay = day;
      this.save();
    }
  }
}

export const JAIL_HOURS = HOURS;
