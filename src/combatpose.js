import * as THREE from 'three';
import { crouchPose, bendLeg, reachArm } from './character.js';

// Fighting and shooting poses, the same for everybody (you, the gangs, the cops, people in the
// street). The hands are placed where they belong (reachArm works out the shoulder and elbow),
// so a support hand is on the gun and a fist is at the chin, whatever the angles:
//   aimPose     a gun up and on target. A pistol in two hands, arms out in a triangle, the gun
//               at chin height, the support hand wrapped round the grip. A long gun shouldered:
//               the butt in the right shoulder pocket, the cheek down on it, the support hand
//               out under the barrel, the body turned side-on (left shoulder to the target).
//               It follows the aim up and down, and kicks on every shot (markRecoil).
//   lowReady    a long gun carried one-handed at the hip, muzzle forward and down.
//   reloadPose  a reload over its length (k 0..1): a pistol brought in close, the mag dropped,
//               a new one from the belt slapped in, the slide racked over the top; a long gun
//               tipped in, the mag pulled and a new one seated, the charging handle pulled.
//   fightStance fists up: side-on (left foot and shoulder forward), the lead fist out at eye
//               height, the rear one at the chin, elbows down and a little out, knees bent,
//               leaning in, a little bounce.
//   punchPose   a jab (lead hand, straight out), a cross (rear hand, the hips and shoulders
//               turning right through it) or a hook (lead hand, the elbow up level with the
//               fist, swinging round as the body turns), out of the stance and back to it.
//   flinchPose  hit: knocked back, hands up (markFlinch); shot, a harder jolt, one hand going
//               to the hit (markFlinch(c, now, 'shot')).
//   kneelPose   down on one knee to shoot (crouched and aiming).
//
// The aim poses return how far to turn the body (radians, added to its facing), as punches do.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const LONG = new Set(['smg', 'rifle', 'shotgun']);
const BLADE = 0.72; // (side-on behind a long gun)
const BLADE_PISTOL = 0.12;
const FIGHT = 0.5; // (side-on with fists up)

const V = () => new THREE.Vector3();
const _a = V();
const _u = V();
const _l = V();
const _b = V();
const _t = V();
const _s = V();
const _p = V();
const _h = V();

// The old way (one angle per joint) for the poses that are still keyed that way.
const set = ([a, e, w, side], x, z, el, wr) => {
  a.rotation.set(x, 0, side * z);
  e.rotation.set(el, 0, 0);
  w.rotation.set(wr, 0, 0);
};

// The aim, in the body's frame: pitch p (up +), turned beta toward the body's left (+x).
// _a: down the barrel; _u: the gun's top; _l: to its left.
// (The spots are worked out against the shoulders, so they hold on a leaning body; the aim
// itself stays true to the world: it's turned back by whatever lean there is.)
const _qi = new THREE.Quaternion();
function aimFrame(c, beta, p) {
  _a.set(Math.sin(beta) * Math.cos(p), Math.sin(p), Math.cos(beta) * Math.cos(p));
  _u.set(-Math.sin(beta) * Math.sin(p), Math.cos(p), -Math.cos(beta) * Math.sin(p));
  _qi.copy(c.spine.quaternion).invert();
  _a.applyQuaternion(_qi);
  _u.applyQuaternion(_qi);
  _l.crossVectors(_u, _a);
}

// Guns sit in the hand at the grip: a pistol's slide just behind the wrist, a long gun's stock
// running back past it toward the shoulder (each mesh is centred on its own length).
function seatGuns(c) {
  for (const w of [c.wristR, c.wristL]) {
    for (const m of w.children) {
      const d = m.geometry?.parameters?.depth;
      if (!m.isMesh || !d || d < 0.25 || m.geometry.parameters.width > 0.14) continue;
      const back = d > 0.45 ? 0.28 : 0.09;
      m.position.set(0, -0.06 - (d / 2 - back), d > 0.45 ? 0.03 : 0.05);
    }
  }
}

export function markRecoil(c, now) {
  if (c) c.group.userData.recoilAt = now;
}

// (0..1: the kick, sharp then settling over ~0.18 s)
function recoil(c, now) {
  const at = c.group.userData.recoilAt;
  if (at == null) return 0;
  const t = now - at;
  if (t < 0 || t > 0.18) return 0;
  return t < 0.04 ? t / 0.04 : 1 - ease((t - 0.04) / 0.14);
}

const sides = (hand) => (hand === 'L' ? ['L', 'R', -1] : ['R', 'L', 1]);

// weapon: its id; pitch: up (+) / down (-) in radians; hand: 'R' / 'L' (peeking out left).
// Returns the body's turn.
export function aimPose(c, weapon, pitch = 0, now = 0, hand = 'R') {
  const [gs, ss, mx] = sides(hand);
  const k = recoil(c, now);
  seatGuns(c);
  if (LONG.has(weapon)) {
    const kick = (weapon === 'shotgun' ? 0.3 : 0.12) * k;
    const beta = BLADE * mx;
    aimFrame(c, beta, Math.max(-0.9, Math.min(0.9, pitch)) + kick);
    // (the butt in the shoulder pocket, pushed back by the kick; the grip a hand's width up it)
    _b.set(-0.19 * mx, 1.6, 0.17).addScaledVector(_a, -(weapon === 'shotgun' ? 0.09 : 0.05) * k);
    _t.copy(_b).addScaledVector(_a, 0.22).addScaledVector(_u, -0.06);
    reachArm(c, gs, _t, _p.set(-0.8 * mx, -0.6, -0.1), _a, _u);
    _s.copy(_b).addScaledVector(_a, 0.5).addScaledVector(_u, -0.1);
    reachArm(c, ss, _s, _p.set(0.3 * mx, -1, 0), _a, _u);
    return -beta;
  }
  // A pistol in two hands: arms out in a triangle, the gun at chin height on the centre line.
  const beta = BLADE_PISTOL * mx;
  aimFrame(c, beta, Math.max(-0.9, Math.min(0.9, pitch)) + 0.32 * k);
  _t.set(-0.02 * mx, 1.55, 0).addScaledVector(_a, 0.44 - 0.05 * k).addScaledVector(_u, 0.03 * k);
  reachArm(c, gs, _t, _p.set(-0.5 * mx, -1, -0.2), _a, _u);
  // (the support hand round the grip from the other side, fingers wrapping across)
  _s.copy(_t).addScaledVector(_l, 0.07 * mx).addScaledVector(_u, -0.05).addScaledVector(_a, -0.03);
  _h.copy(_a).multiplyScalar(0.75).addScaledVector(_l, -0.65 * mx);
  reachArm(c, ss, _s, _p.set(0.9 * mx, -0.5, -0.1), _h, _u);
  return -beta;
}

// A long gun carried one-handed at the hip, muzzle forward and down; the other arm swings
// with the walk. Returns the body's turn (none) or false for a handgun (it just hangs).
export function lowReady(c, weapon, hand = 'R') {
  if (!LONG.has(weapon)) return false;
  const [gs, , mx] = sides(hand);
  seatGuns(c);
  _a.set(-0.16 * mx, -0.5, 0.85).normalize();
  _u.set(0, 1, 0).addScaledVector(_a, -_a.y).normalize();
  _qi.copy(c.spine.quaternion).invert();
  _a.applyQuaternion(_qi);
  _u.applyQuaternion(_qi);
  reachArm(c, gs, _t.set(-0.33 * mx, 1.1, 0.14), _p.set(-0.6 * mx, 0, -1), _a, _u);
  return 0;
}

// A path of hand positions over k: keys [[k, Vector3], ...] eased from one to the next.
function along(keys, k, out) {
  let i = 0;
  while (i < keys.length - 2 && k > keys[i + 1][0]) i++;
  const [k0, p0] = keys[i];
  const [k1, p1] = keys[i + 1];
  return out.lerpVectors(p0, p1, ease(clamp01((k - k0) / Math.max(1e-4, k1 - k0))));
}
const R = Array.from({ length: 8 }, V);

// A reload over its length, k 0..1 (weapon: its id; hand: 'R' / 'L'). Returns the body's turn.
export function reloadPose(c, weapon, k, hand = 'R') {
  const [gs, ss, mx] = sides(hand);
  seatGuns(c);
  if (LONG.has(weapon)) {
    // The gun down off the shoulder and tipped up; the support hand pulls the mag (to the belt),
    // seats a new one with a slap, reaches over and pulls the charging handle.
    const beta = 0.6 * mx;
    aimFrame(c, beta, 0.3);
    _b.set(-0.17 * mx, 1.4, 0.22);
    _t.copy(_b).addScaledVector(_a, 0.22).addScaledVector(_u, -0.06);
    reachArm(c, gs, _t, _p.set(-0.8 * mx, -0.6, 0), _a, _u);
    const H = R[0].copy(_b).addScaledVector(_a, 0.48).addScaledVector(_u, -0.1); // (handguard)
    const M = R[1].copy(_b).addScaledVector(_a, 0.32).addScaledVector(_u, -0.2); // (mag)
    const In = R[2].copy(_b).addScaledVector(_a, 0.32).addScaledVector(_u, -0.13);
    const Belt = R[3].set(0.22 * mx, 1.0, 0.16);
    const Ch = R[4].copy(_b).addScaledVector(_a, 0.06).addScaledVector(_u, 0.1).addScaledVector(_l, 0.05 * mx);
    const Pull = R[5].copy(Ch).addScaledVector(_a, -0.12);
    along([[0, H], [0.12, M], [0.3, Belt], [0.42, Belt], [0.58, M], [0.64, In], [0.72, Ch], [0.8, Pull], [0.88, Ch], [1, H]], k, _s);
    reachArm(c, ss, _s, _p.set(0.6 * mx, -1, 0), _a, _u);
    return -beta;
  }
  // A pistol brought in close, muzzle up; the mag dropped, the support hand down to the belt and
  // up with a new one into the grip, then over the top to rack the slide.
  const beta = 0.15 * mx;
  aimFrame(c, beta, 0.55);
  _t.set(-0.06 * mx, 1.36, 0.3);
  reachArm(c, gs, _t, _p.set(-0.6 * mx, -1, 0), _a, _u);
  const G = R[0].copy(_t).addScaledVector(_l, 0.07 * mx).addScaledVector(_u, -0.05);
  const Belt = R[1].set(0.22 * mx, 1.0, 0.12);
  const Mag = R[2].copy(_t).addScaledVector(_u, -0.2);
  const In = R[3].copy(_t).addScaledVector(_u, -0.12);
  const Top = R[4].copy(_t).addScaledVector(_u, 0.1).addScaledVector(_a, 0.02);
  const Back = R[5].copy(Top).addScaledVector(_a, -0.13);
  along([[0, G], [0.12, G], [0.32, Belt], [0.42, Belt], [0.56, Mag], [0.64, In], [0.72, Top], [0.8, Back], [0.88, Top], [1, G]], k, _s);
  reachArm(c, ss, _s, _p.set(0.8 * mx, -0.6, 0), _a, _u);
  return -beta;
}

// ---- Fists ----

// A spot in the fight's frame (z toward him, x to your left) into the body's, the body turned
// tw from facing him.
function fightPt(out, x, y, z, tw) {
  const c = Math.cos(tw);
  const s = Math.sin(tw);
  return out.set(x * c - z * s, y, x * s + z * c);
}
const GUARD_L = [0.1, 1.68, 0.4]; // (the lead fist, out at eye height)
const GUARD_R = [-0.1, 1.64, 0.22]; // (the rear fist, at the chin)

function guard(c, side, tw, bob) {
  const g = side === 'L' ? GUARD_L : GUARD_R;
  fightPt(_t, g[0], g[1] + bob, g[2], tw);
  reachArm(c, side, _t, side === 'L' ? _p.set(0.75, -1, -0.15) : _p.set(-0.8, -1, -0.1));
}

// Fists up. Returns how far the hips come down (for the body's height); the body's turn (side-
// on) is what punchPose returns.
export function fightStance(c, now = 0, moving = 0) {
  const bob = Math.sin(now * 6.5) * 0.025 * (1 - moving);
  const u = c.group.userData;
  u.fightTw = -FIGHT;
  u.fightBob = bob;
  c.spine.rotation.x = 0.12 + bob * 0.5;
  guard(c, 'L', -FIGHT, bob);
  guard(c, 'R', -FIGHT, bob);
  if (moving > 0.2) return 0; // (on the move: the walk does the legs)
  // (knees bent, lead foot forward, rear foot back)
  const d1 = bendLeg(c.legL, c.kneeL, 0.38 + bob, 0.62);
  const d2 = bendLeg(c.legR, c.kneeR, -0.22 - bob, 0.32);
  return -Math.min(d1, d2) + bob * 0.4;
}

// kind: 'jab' | 'cross' | 'hook'; T: how long it lasts.
export function markPunch(c, now, kind = 'jab', T = 0.32) {
  if (!c) return;
  const u = c.group.userData;
  u.punchAt = now;
  u.punchKind = kind;
  u.punchT = T;
}

export function punching(c, now) {
  const u = c?.group.userData;
  return !!u && u.punchAt != null && now - u.punchAt >= 0 && now - u.punchAt < u.punchT;
}

// Over the stance. Returns the body's turn (radians, to add to its facing: side-on, and into
// the punch); null when the fists aren't up.
export function punchPose(c, now) {
  const u = c.group.userData;
  const base = u.fightTw ?? -FIGHT;
  const bob = u.fightBob || 0;
  if (u.punchAt == null) return base;
  const t = (now - u.punchAt) / u.punchT;
  if (t < 0 || t >= 1) {
    if (t >= 1) u.punchAt = null;
    return base;
  }
  const kind = u.punchKind;
  if (kind === 'hook') {
    // Lead hook: the fist drops back a touch and the elbow comes up level with it (0-0.18), the
    // hips and shoulders whip round to the right and the arm with them, bent square (to 0.45),
    // a beat, then back to the guard.
    const load = ease(clamp01(t / 0.18));
    const go = ease(clamp01((t - 0.18) / 0.27));
    const back = ease(clamp01((t - 0.6) / 0.4));
    const tw = base + 0.12 * load * (1 - go) - 0.55 * go * (1 - back);
    const ang = mix(0.55, -0.35, go); // (round the front, from his left to the middle)
    const x = mix(GUARD_L[0], 0.42 * Math.sin(ang) + 0.04, Math.max(load, go) * (1 - back));
    const z = mix(GUARD_L[2], 0.5 * Math.cos(ang) + 0.12, Math.max(load, go) * (1 - back));
    fightPt(_t, x, mix(GUARD_L[1] + bob, 1.64, (1 - back) * load), z, tw);
    const up = (1 - back) * load;
    reachArm(c, 'L', _t, _p.set(mix(0.75, 0.9, up), mix(-1, 0.35, up), mix(-0.15, -0.3, up)));
    guard(c, 'R', tw, bob);
    c.spine.rotation.x += 0.05 * go * (1 - back);
    return tw;
  }
  // Jab / cross: a short load, the snap out, a beat there, back to the guard.
  const out = t < 0.12 ? -0.25 * ease(t / 0.12) : t < 0.38 ? mix(-0.25, 1, ease((t - 0.12) / 0.26)) : t < 0.55 ? 1 : 1 - ease((t - 0.55) / 0.45);
  const k = Math.max(0, out);
  const dip = Math.max(0, -out);
  if (kind === 'jab') {
    // Lead hand straight out at his chin, the lead shoulder rolling up behind it.
    const tw = base - 0.1 * k;
    fightPt(_t, mix(GUARD_L[0], 0.0, k), mix(GUARD_L[1] + bob, 1.62, k), mix(GUARD_L[2] - dip * 0.08, 0.85, k), tw);
    reachArm(c, 'L', _t, _p.set(mix(0.75, 0.5, k), -1, mix(-0.15, -0.6, k)));
    guard(c, 'R', tw, bob);
    c.spine.rotation.x += 0.06 * k;
    return tw;
  }
  // Cross: the rear hand straight through the middle, the hips and shoulders turning square and
  // past it, the weight onto the front foot.
  const tw = base + 0.8 * k - 0.05 * dip;
  fightPt(_t, mix(GUARD_R[0], 0.0, k), mix(GUARD_R[1] + bob, 1.62, k), mix(GUARD_R[2] - dip * 0.06, 0.88, k), tw);
  reachArm(c, 'R', _t, _p.set(mix(-0.8, -0.5, k), -1, mix(-0.1, -0.6, k)));
  guard(c, 'L', tw, bob);
  c.spine.rotation.x += 0.1 * k;
  return tw;
}

// Which way someone falls when hit from (fx, fz): face down if it came from behind them.
export function fallFace(x, z, heading, fx, fz) {
  if (fx == null) return 'back';
  return (fx - x) * Math.sin(heading) + (fz - z) * Math.cos(heading) < 0 ? 'front' : 'back';
}

export function markFlinch(c, now, kind = 'hit') {
  if (!c) return;
  c.group.userData.flinchAt = now;
  c.group.userData.flinchKind = kind;
  c.group.userData.flinchSide = Math.random() < 0.5 ? -1 : 1;
}

export function flinching(c, now) {
  const at = c?.group.userData.flinchAt;
  return at != null && now - at >= 0 && now - at < 0.45;
}

export function flinchPose(c, now) {
  const u = c.group.userData;
  if (u.flinchAt == null) return null;
  const t = (now - u.flinchAt) / 0.45;
  if (t < 0 || t >= 1) {
    if (t >= 1) u.flinchAt = null;
    return null;
  }
  const k = t < 0.2 ? ease(t / 0.2) : 1 - ease((t - 0.2) / 0.8);
  if (u.flinchKind === 'shot') {
    // (shot: a jolt, doubling over a little, one hand going to where it hit, the other arm
    // flung out)
    const hit = u.flinchSide > 0 ? [c.armR, c.elbowR, c.wristR, 1] : [c.armL, c.elbowL, c.wristL, -1];
    const other = u.flinchSide > 0 ? [c.armL, c.elbowL, c.wristL, -1] : [c.armR, c.elbowR, c.wristR, 1];
    set(hit, mix(hit[0].rotation.x, -0.7, k), 0.75 * k, -1.9 * k, 0.3 * k);
    set(other, mix(other[0].rotation.x, -0.5, k), -0.7 * k, -0.4 * k, 0);
    c.spine.rotation.x = mix(c.spine.rotation.x, t < 0.12 ? -0.25 : 0.3, k);
    crouchPose(c, 0.22 * k);
    return 0.28 * k;
  }
  // (hands coming up, the head and shoulders snapped back)
  set([c.armL, c.elbowL, c.wristL, -1], -1.2 * k, 0.3 * k, -1.6 * k, 0);
  set([c.armR, c.elbowR, c.wristR, 1], -1.0 * k, 0.3 * k, -1.8 * k, 0);
  c.spine.rotation.x = mix(c.spine.rotation.x, -0.3, k);
  crouchPose(c, 0.15 * k);
  return 0.18 * k;
}

// Down on the right knee, the left foot planted forward: shooting low. Returns the drop.
export function kneelPose(c) {
  c.spine.rotation.x = 0.06;
  const d1 = bendLeg(c.legL, c.kneeL, 1.35, 1.45);
  const d2 = bendLeg(c.legR, c.kneeR, 0.15, 1.85);
  return -Math.min(0.62, Math.max(d1, d2) * 0.82);
}
