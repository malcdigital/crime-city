import * as THREE from 'three';
import { restPose, reachArm, bendSpine, bendLeg } from './character.js';
import { fightStance, markPunch, punchPose, markFlinch, flinchPose, PUNCH_T } from './combatpose.js';
import { dist } from './util.js';

// Fighting your way out of a stop on foot (main.js fightStop): a short paired scene before the
// outcome. Held by the arm, you wrench it free and turn on him; standing in front of him, you
// step in. Then the punch: it lands and he goes down (knockOut), or he slips it and puts you
// down (the bust). Three ways out of the hold, picked at random:
//   elbow - yank the arm loose, an elbow back into him, square up, lead hook
//   spin  - spin out of it the other way round, dip, rear uppercut
//   shove - wrench loose, turn and two-hand shove him off you, straight right
// and one from in front of him:
//   rush  - a step in, straight right
// main.js runs it: step() every frame in place of your own movement (the player), the officer
// through his script pose (police.js), done() at the end.
const T = 1.3; // the whole scene
const HIT = { elbow: 0.86, spin: 0.9, shove: 0.92, rush: 0.5 }; // when the punch lands
const BLOW = { elbow: 'hook', spin: 'uppercut', shove: 'cross', rush: 'cross' };
const FIRST = { elbow: 0.34, shove: 0.42 }; // the first contact (him flinching)

const clamp01 = (k) => Math.max(0, Math.min(1, k));
const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => ease(clamp01((t - a) / (b - a)));
const mix = (a, b, k) => a + (b - a) * k;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const V = () => new THREE.Vector3();
const _a = V();
const _b = V();
const _p = V();
const _q = new THREE.Quaternion();
const JOINTS = ['spine', 'chest', 'neck', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];

export class BreakFree {
  // held: he had you by the arm (stopscene.js grab); win: decided up front (main.js).
  constructor(game, cop, { held, win, done }) {
    this.game = game;
    this.cop = cop;
    this.win = win;
    this.done = done;
    this.t = 0;
    const P = game.player;
    this.variant = held ? ['elbow', 'spin', 'shove'][Math.floor(Math.random() * 3)] : 'rush';
    this.h0 = P.heading;
    this.blow = BLOW[this.variant];
    this.hitT = HIT[this.variant];
    this.punched = false;
    this.landed = false;
    this.first = false;
    this.prev = null;
    // (where he ends up: an arm's length in front of you, a touch further if you shove him)
    this.reach = this.variant === 'shove' ? 0.92 : 0.8;
    this.c0 = [cop.x, cop.z];
    cop.script = { x: cop.x, z: cop.z, fx: P.x, fz: P.z, speed: 0, pose: (c) => this.poseCop(c) };
  }

  // The heading from you to him.
  toCop() {
    const P = this.game.player;
    return Math.atan2(this.cop.x - P.x, this.cop.z - P.z);
  }

  // Each frame (main.js update, in place of your own movement). Returns true when it's over.
  step(dt) {
    const game = this.game;
    const P = game.player;
    const cop = this.cop;
    const c = P.char;
    const now = game.time;
    this.t += dt;
    const t = this.t;
    const v = this.variant;
    // Where he is: shoved back, or (rush) where you step in to; and you turned onto him.
    const hc = this.toCop();
    let turn;
    if (v === 'spin') {
      // (the long way round: away from his hold, all the way round to face him)
      const d = wrap(hc - this.h0);
      const long = d > 0 ? d - Math.PI * 2 : d + Math.PI * 2;
      turn = this.h0 + long * seg(t, 0.06, 0.6);
    } else turn = this.h0 + wrap(hc - this.h0) * seg(t, v === 'rush' ? 0 : 0.18, v === 'rush' ? 0.2 : 0.62);
    P.heading = turn;
    if (cop.standing) {
      const d = dist(P.x, P.z, cop.x, cop.z) || 1;
      let want = this.reach;
      if (v === 'shove') want = mix(0.7, 1.05, seg(t, FIRST.shove, FIRST.shove + 0.2)) - 0.18 * seg(t, 0.64, 0.86);
      if (v === 'rush') {
        // (you close the gap)
        const k = Math.min(1, dt * 9) * (t < this.hitT ? 1 : 0);
        const go = Math.max(0, d - want) * k;
        P.x += ((cop.x - P.x) / d) * go;
        P.z += ((cop.z - P.z) / d) * go;
      } else {
        // (him stepping round in front of you as you turn on him, pushed back with the shove)
        const k = Math.min(1, dt * 8);
        const nd = mix(d, want, k);
        cop.x = P.x + ((cop.x - P.x) / d) * nd;
        cop.z = P.z + ((cop.z - P.z) / d) * nd;
      }
      cop.script.x = cop.x;
      cop.script.z = cop.z;
      cop.script.fx = P.x;
      cop.script.fz = P.z;
    }
    // The pose.
    restPose(c);
    P.poseY = 0;
    P.twist = 0;
    const style = game.style?.fight;
    if (!this.punched && t >= this.hitT - this.contact()) {
      this.punched = true;
      markPunch(c, now, this.blow);
    }
    if (t < 0.4 && v !== 'rush') this.wrench(c, t);
    else {
      const drop = fightStance(c, now, 0, style);
      P.poseY = Math.min(0, drop);
      P.twist = punchPose(c, now) ?? 0;
      if (v === 'shove' && t < FIRST.shove + 0.25) this.shove(c, t);
      flinchPose(c, now); // (he slipped it and caught you)
    }
    // (a quick blend between the moves: no snapping joints)
    this.smooth(c, dt);
    // Contact.
    if (!this.first && FIRST[v] != null && t >= FIRST[v]) {
      this.first = true;
      if (cop.standing) markFlinch(cop.char, now, 'hit', v === 'elbow' ? 'hook' : 'jab');
      game.sfx.punch?.();
    }
    if (!this.landed && t >= this.hitT) {
      this.landed = true;
      if (this.win) {
        game.sfx.punch?.();
      } else {
        // (he slips it and catches you)
        markFlinch(c, now, 'hit', 'hook');
        game.sfx.punch?.();
      }
      if (this.win) this.done(true); // (he goes down now; you follow through)
    }
    P.sync();
    if (t >= (this.win ? this.hitT + 0.35 : T)) {
      this.end();
      if (!this.win) this.done(false); // (then he takes you down)
      return true;
    }
    return false;
  }

  // How long the punch takes to land (into its own timing: combatpose.js).
  contact() {
    const f = { hook: 0.45, uppercut: 0.42, cross: 0.38 }[this.blow] || 0.4;
    return f * (PUNCH_T[this.blow] || 0.3);
  }

  // Tearing the arm loose from behind your back (stopscene.js posePlayer's hold), turning.
  wrench(c, t) {
    const v = this.variant;
    const yank = seg(t, 0.02, 0.2);
    const k0 = 1 - seg(t, 0.0, 0.1); // (still held, the first instant)
    // (the right hand: up behind the back, ripped out to the side, then...)
    _a.set(0.02, 1.12, -0.26).lerp(_b.set(-0.5, 1.23, -0.05), yank); // (heights: the small of the back, the waist)
    if (v === 'elbow') {
      // ...driven back into him: the elbow out behind you, the fist at your chest.
      const el = seg(t, 0.2, 0.32) * (1 - seg(t, 0.36, 0.48));
      _a.lerp(_b.set(-0.12, 1.4, 0.22), el);
      reachArm(c, 'R', _a, _p.set(-0.7, 0.15, -1).normalize(), null, null, 'group');
      bendSpine(c, mix(0.3, 0.05, yank), -0.5 * el + 0.15 * yank, -0.1 * el);
    } else if (v === 'spin') {
      // ...tucked in to the chest as you spin, both hands up.
      const tuck = seg(t, 0.12, 0.3);
      _a.lerp(_b.set(-0.12, 1.44, 0.25), tuck);
      reachArm(c, 'R', _a, _p.set(-1, -0.4, -0.2), null, null, 'group');
      reachArm(c, 'L', _b.set(0.12, 1.45, 0.25), _p.set(1, -0.4, -0.2), null, null, 'group');
      bendSpine(c, mix(0.3 * k0, 0.18, tuck), 0.3 * tuck, 0);
      // (the feet: a pivot, knees bent)
      bendLeg(c.legL, c.kneeL, 0.25 * tuck, 0.45 * tuck);
      bendLeg(c.legR, c.kneeR, 0.15 * tuck, 0.4 * tuck);
    } else {
      // ...both hands come up to shove him.
      const up = seg(t, 0.15, 0.4);
      _a.lerp(_b.set(-0.14, 1.37, 0.3), up);
      reachArm(c, 'R', _a, _p.set(-1, -0.6, -0.3), null, null, 'group');
      reachArm(c, 'L', _b.set(0.14, 1.35, 0.3).lerp(_p.set(0.25, 0.95, 0.05), 1 - up), _p.set(1, -0.6, -0.3), null, null, 'group');
      bendSpine(c, mix(0.3, 0.1, yank), 0.2 * yank, 0);
    }
    c.neck.rotation.set(mix(0.3, -0.05, yank), 0, 0);
    if (v !== 'spin') {
      bendLeg(c.legL, c.kneeL, 0.2 * yank, 0.3 * yank);
      bendLeg(c.legR, c.kneeR, -0.1 * yank, 0.25 * yank);
    }
  }

  // The two-hand shove: both arms driving out at his chest, then back to the guard.
  shove(c, t) {
    const out = seg(t, FIRST.shove - 0.08, FIRST.shove) * (1 - seg(t, FIRST.shove + 0.08, FIRST.shove + 0.25));
    if (out <= 0) return;
    reachArm(c, 'R', _a.set(-0.16, 1.4, mix(0.3, 0.62, out)), _p.set(-1, -0.6, -0.2), null, null, 'group');
    reachArm(c, 'L', _a.set(0.16, 1.4, mix(0.3, 0.62, out)), _p.set(1, -0.6, -0.2), null, null, 'group');
    bendSpine(c, 0.15 * out, 0, 0);
    bendLeg(c.legL, c.kneeL, 0.45 * out, 0.4 * out);
    bendLeg(c.legR, c.kneeR, -0.35 * out, 0.15 * out);
  }

  smooth(c, dt) {
    const prev = this.prev;
    const k = Math.min(1, dt * 22);
    if (prev) for (const j of JOINTS) c[j].quaternion.copy(_q.copy(prev[j]).slerp(c[j].quaternion, k));
    this.prev ??= {};
    for (const j of JOINTS) (this.prev[j] ??= new THREE.Quaternion()).copy(c[j].quaternion);
  }

  // Him (his script pose: police.js): his hands on your arm as you tear loose, then thrown off,
  // hands coming up; the blows land on him (flinch). If he wins, he slips it and grabs you.
  poseCop(c) {
    const t = this.t;
    const now = this.game.time;
    restPose(c);
    for (const j of ['legL', 'legR', 'kneeL', 'kneeR']) c[j].rotation.set(0, 0, 0);
    const lost = seg(t, 0.04, 0.24); // (his grip gone)
    const up = seg(t, 0.3, 0.6);
    // (hands: reaching where your arm was, flung off, then up in front of him)
    _a.set(0.15, 1.15, 0.4).lerp(_b.set(0.3, 1.0, 0.15), lost).lerp(_b.set(0.16, 1.44, 0.3), up);
    reachArm(c, 'L', _a, _p.set(1, -0.6, -0.3), null, null, 'group');
    _a.set(-0.15, 1.19, 0.35).lerp(_b.set(-0.32, 1.0, 0.1), lost).lerp(_b.set(-0.16, 1.44, 0.3), up);
    reachArm(c, 'R', _a, _p.set(-1, -0.6, -0.3), null, null, 'group');
    bendSpine(c, 0.15 * (1 - lost) - 0.12 * lost * (1 - up), 0, 0);
    if (!this.win && this.landed) {
      // (he slipped your punch: low, then taking hold of you)
      const k = seg(t, this.hitT, this.hitT + 0.2);
      bendSpine(c, 0.35 * k, 0.2 * k, 0);
      bendLeg(c.legL, c.kneeL, 0.35 * k, 0.6 * k);
      bendLeg(c.legR, c.kneeR, 0.2 * k, 0.55 * k);
    } else if (!this.win && t > this.hitT - 0.15) {
      // (ducking under it)
      const k = seg(t, this.hitT - 0.15, this.hitT);
      bendSpine(c, 0.45 * k, 0.25 * k, 0.1 * k);
      bendLeg(c.legL, c.kneeL, 0.45 * k, 0.8 * k);
      bendLeg(c.legR, c.kneeR, 0.3 * k, 0.75 * k);
    } else if (this.variant === 'shove' && t > FIRST.shove) {
      // (stumbling back from the shove)
      const k = seg(t, FIRST.shove, FIRST.shove + 0.15) * (1 - seg(t, FIRST.shove + 0.25, this.hitT - 0.1));
      bendLeg(c.legR, c.kneeR, -0.4 * k, 0.3 * k);
      bendLeg(c.legL, c.kneeL, 0.2 * k, 0.2 * k);
    }
    flinchPose(c, now);
  }

  end() {
    this.cop.script = null;
  }
}
