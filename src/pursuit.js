import { dist, clamp } from './util.js';
import { streetAt, districtAt } from './city.js';

// Police pursuit tactics, hiding from them, and what you hear on the radio.
// - Tactics (cars chasing you while you drive and they can see you): every half second each
//   chasing cruiser gets a job.
//   * intercept: one that's ahead of you races for where you'll be in a couple of seconds
//     (cutting you off at the next junction, or meeting you head on).
//   * pit: at 2+ stars, the closest one behind you lines its front bumper up on your rear
//     quarter and nudges it: you spin out. (One every ~8 s, at 15-65 mph.)
//   * box: when you slow to a crawl, one pulls across your nose and another alongside; with
//     cars against you and nowhere to go, it's an arrest (main.js bustPressure).
//   * tail: everyone else follows you as before (police.js).
// - Lying low: parked dead still for a few seconds among parked cars (a lot, or the curb) or
//   under a freeway deck, while nobody's watching: a cruiser driving by only spots you from
//   close up (14 m instead of 60), an officer on foot from 9 m, and under a deck the
//   helicopter can't see you at all. Move and it's over.
// - The radio: short lines from dispatch and the units at the bottom of the wanted stars
//   (where you're headed, lost visual, PIT, air support...).
// - The escape meter: how close you are to losing them (main.js decides; this works it out
//   for the HUD).
const PIT_GAP = 8; // seconds between PIT tries
const LOW_AFTER = 2.5; // seconds parked before you count as lying low
export const LOW_RANGE = { car: 14, foot: 9 };

export function heading(vx, vz) {
  if (Math.hypot(vx, vz) < 1) return null;
  return Math.abs(vx) > Math.abs(vz) ? (vx > 0 ? 'east' : 'west') : vz < 0 ? 'north' : 'south';
}

export class Pursuit {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.pitCd = 0;
    this.lowT = 0;
    this.lyingLow = false;
    this.radioT = 0;
    this.chatT = 0;
    this.wasSeen = false;
    this.lostT = 0;
    this.lines = [];
  }

  // ---- Every frame ----
  update(dt) {
    const game = this.game;
    this.pitCd = Math.max(0, this.pitCd - dt);
    this.radioT = Math.max(0, this.radioT - dt);
    this.updateLow(dt);
    if (game.stars === 0) {
      this.wasSeen = false;
      this.lostT = 0;
      for (const u of game.police.units) u.role = null;
      return;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.5;
      this.assign();
    }
    this.chatter(dt);
    if (this.pitCheck) this.pitCheck(dt);
  }

  // ---- Who does what ----
  assign() {
    const game = this.game;
    const v = game.player.vehicle;
    const units = game.police.units.filter((u) => u.chasing && u.mounted && !u.carLost && !u.allDead && !u.leaving);
    for (const u of units) u.role = 'tail';
    if (!v || !units.length) return;
    const [px, pz] = game.player.pos();
    const [fx, fz] = v.forward();
    const rx = -fz;
    const rz = fx;
    const s = Math.abs(v.speed);
    const rel = (u) => {
      const ox = u.car.x - px;
      const oz = u.car.z - pz;
      return { along: ox * fx + oz * fz, lat: ox * rx + oz * rz, d: Math.hypot(ox, oz) };
    };
    const near = units.map((u) => ({ u, ...rel(u) })).sort((a, b) => a.d - b.d);
    if (s < 4) {
      // Crawling or stopped: box you in.
      const close = near.filter((n) => n.d < 40);
      if (close[0]) close[0].u.role = 'boxFront';
      if (close[1]) {
        close[1].u.role = 'boxSide';
        close[1].u.boxSide = close[1].lat >= 0 ? 1 : -1;
      }
      return;
    }
    for (const n of near) if (n.along > 15 && n.d < 140) n.u.role = 'intercept';
    if (game.stars >= 2 && s > 6.5 && s < 29 && this.pitCd <= 0) {
      const behind = near.find((n) => n.along < 2 && n.d < 30);
      if (behind) {
        behind.u.role = 'pit';
        if (!behind.u.pitSide) behind.u.pitSide = behind.lat >= 0 ? 1 : -1;
      }
    }
    for (const n of near) if (n.u.role !== 'pit') n.u.pitSide = 0;
  }

  // Where a chasing cruiser should drive (police.js asks while it can see you): [tx, tz,
  // speed], or null for the usual chase.
  drive(u, maxS) {
    const game = this.game;
    const v = game.player.vehicle;
    if (!v || !u.role || u.role === 'tail') return null;
    const c = u.car;
    const [px, pz] = game.player.pos();
    const [fx, fz] = v.forward();
    const rx = -fz;
    const rz = fx;
    const s = Math.abs(v.speed);
    const d = dist(c.x, c.z, px, pz);
    if (u.role === 'intercept') {
      const T = clamp(d / Math.max(10, maxS * 0.9), 0.8, 3);
      const [vx, vz] = game.player.velocity();
      return [px + vx * T, pz + vz * T, maxS];
    }
    if (u.role === 'pit') {
      const side = u.pitSide || 1;
      // Aim the front bumper just ahead of the corner of your back bumper, on its side.
      const half = v.halfLen || 2.2;
      const tx = px - fx * (half * 0.7) + rx * side * 1.9;
      const tz = pz - fz * (half * 0.7) + rz * side * 1.9;
      const [cfx, cfz] = c.forward();
      const nose = [c.x + cfx * (c.halfLen || 2.2), c.z + cfz * (c.halfLen || 2.2)];
      const gap = dist(nose[0], nose[1], tx, tz);
      this.tryPit(u, side, nose);
      return [tx + fx * 2, tz + fz * 2, Math.min(maxS * 1.1, s + clamp(gap * 1.4, -2, 8))];
    }
    if (u.role === 'boxFront') {
      const tx = px + fx * 5.5;
      const tz = pz + fz * 5.5;
      const g = dist(c.x, c.z, tx, tz);
      return [tx, tz, g < 1.5 ? 0 : Math.min(maxS, 2 + g * 0.8)];
    }
    if (u.role === 'boxSide') {
      const side = u.boxSide || 1;
      const tx = px + rx * side * 3.4 + fx * 1;
      const tz = pz + rz * side * 3.4 + fz * 1;
      const g = dist(c.x, c.z, tx, tz);
      return [tx, tz, g < 1.5 ? 0 : Math.min(maxS, 2 + g * 0.8)];
    }
    return null;
  }

  // The cruiser's nose is on your back corner and it's going your way: spin you out.
  tryPit(u, side, nose) {
    const game = this.game;
    const v = game.player.vehicle;
    if (!v || this.pitCd > 0) return;
    const c = u.car;
    const [fx, fz] = v.forward();
    const rx = -fz;
    const rz = fx;
    const half = v.halfLen || 2.2;
    const corner = [v.x - fx * half * 0.8 + rx * side * 0.95, v.z - fz * half * 0.8 + rz * side * 0.95];
    if (dist(nose[0], nose[1], corner[0], corner[1]) > 1.5) return;
    const [cfx, cfz] = c.forward();
    if (cfx * fx + cfz * fz < 0.8) return; // (pointing the same way, near enough)
    if (c.speed < v.speed - 1.5 || v.speed < 6) return;
    // The nudge: the tail swings away from the cruiser, the nose round toward it.
    v.dyn = true;
    v.vx = v.speed;
    // (speed, vx and lat kept in step, or the tire model treats it as a fresh start and
    // resets the spin)
    v.speed *= 0.85;
    v.vx = v.speed;
    v.r = (v.r || 0) + side * (3.6 + v.speed * 0.09);
    v.vy = (v.vy || 0) - side * 4;
    v.lat = v.vy;
    v.spinT = 1.8;
    v.damage?.(4, false);
    c.speed *= 0.8;
    this.pitCd = PIT_GAP;
    u.role = 'tail';
    u.pitSide = 0;
    this.radio(`Unit ${u.callsign || 12}: PIT! Taking him out!`, true);
    game.sfx?.crash?.(0.6);
    // Over the next moment: did it work? (He slowed right down, or got turned well round.)
    let t = 1.8;
    const h0 = v.heading;
    let worked = false;
    this.pitCheck = (dt) => {
      t -= dt;
      const pv = game.player.vehicle;
      if (pv) {
        const turned = Math.abs(Math.atan2(Math.sin(pv.heading - h0), Math.cos(pv.heading - h0)));
        if (Math.abs(pv.speed) < 6 || turned > 0.7) worked = true;
      }
      if (t > 0) return;
      this.pitCheck = null;
      this.radio(worked ? 'Suspect spun out! Box him in!' : 'He held it. Stay on him.', true);
    };
  }

  // ---- Lying low ----
  updateLow(dt) {
    const game = this.game;
    const p = game.player;
    const v = p.vehicle;
    const [px, pz] = p.pos();
    const still = v ? Math.abs(v.speed) < 0.3 : Math.hypot(p.vx || 0, p.vz || 0) < 0.2 && p.lowProfile;
    const spot = still && (this.underDeck(px, pz) || this.amongCars(px, pz));
    if (!spot || game.seenNow) this.lowT = 0;
    else this.lowT += dt;
    const was = this.lyingLow;
    this.lyingLow = this.lowT > LOW_AFTER && game.stars > 0;
    if (this.lyingLow && !was) game.hud.toast(this.underDeck(px, pz) ? 'Lying low under the freeway' : 'Lying low', '#9fc3ff');
  }

  underDeck(x, z) {
    const hw = this.game.highway;
    if (!hw || this.game.player.vehicle?.high) return false;
    return hw.overhead(x, z, this.game.city.groundY(x, z));
  }

  // Parked among other cars: two or more parking spaces within 7 m (a lot, or the curb).
  amongCars(x, z) {
    let n = 0;
    for (const s of this.game.parking?.spots || []) {
      if (Math.abs(s.x - x) > 7 || Math.abs(s.z - z) > 7) continue;
      if (dist(s.x, s.z, x, z) < 7 && ++n >= 2) return true;
    }
    return false;
  }

  // ---- The radio ----
  radio(text, urgent = false) {
    if (this.radioT > 0 && !urgent) return;
    this.radioT = 3.5;
    this.game.hud.radio?.(text);
  }

  chatter(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const seen = game.seenNow;
    const where = () => streetAt(px, pz) || districtAt(px, pz);
    if (seen && !this.wasSeen) {
      const [vx, vz] = game.player.velocity();
      const h = heading(vx, vz);
      this.radio(h ? `Visual on the suspect, ${h}bound on ${where()}.` : `Eyes on the suspect, ${where()}.`);
      this.chatT = 9;
    } else if (!seen && this.wasSeen) {
      this.lostT = 0;
    }
    if (!seen) {
      this.lostT += dt;
      if (this.lostT > 3 && this.lostT - dt <= 3) this.radio(`Lost visual near ${streetAt(...(game.lastKnown || [px, pz])) || 'the last location'}. Searching the area.`);
    } else {
      this.chatT -= dt;
      if (this.chatT <= 0) {
        this.chatT = 10;
        const v = game.player.vehicle;
        const [vx, vz] = game.player.velocity();
        const h = heading(vx, vz);
        if (v && h) this.radio(`Suspect ${h}bound on ${where()}, ${Math.round(Math.abs(v.speed) * 2.237)} mph.`);
        else if (h) this.radio(`Suspect on foot, ${h}bound on ${where()}.`);
      }
    }
    this.wasSeen = seen;
    // Air support.
    const heli = game.police.heli;
    const hs = !!(heli && heli.sees);
    if (hs && !this.heliSaw) this.radio('Air One has the suspect in the light.');
    this.heliSaw = hs;
  }

  // ---- The escape meter (0..1) for the HUD ----
  escapeShare() {
    const game = this.game;
    if (!game.stars || game.seenNow || !game.searching) return 0;
    const since = game.unseenT || 0;
    const [px, pz] = game.player.pos();
    const [kx, kz] = game.lastKnown || [px, pz];
    const outside = dist(px, pz, kx, kz) > game.searchRadius;
    const need = outside ? 5 + game.stars * 1.5 : 30 + game.stars * 8;
    return clamp(since / need, 0, 1);
  }
}
