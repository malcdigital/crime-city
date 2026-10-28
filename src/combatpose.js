import * as THREE from 'three';
import { crouchPose, bendLeg, reachArm, upperQuat, bendSpine, wristPos } from './character.js';

// Fighting and shooting poses, the same for everybody (you, the gangs, the cops, people in the
// street). The hands are placed where they belong (reachArm works out the shoulder and elbow),
// so a support hand is on the gun and a fist is at the chin, whatever the angles:
//   aimPose     a gun up and on target. A pistol three ways (style): in two hands, arms out in a
//               triangle, the gun at chin height, the support hand wrapped round the grip
//               ('two'); one-handed, the arm locked out at eye level, side-on, the other arm
//               hanging ('one'); or held sideways, the gun rolled flat, the elbow up and out
//               ('side'). Every grip kicks its own way when it fires. A long gun shouldered:
//               the butt in the right shoulder pocket, the cheek down on it, the support hand
//               out under the barrel, the body turned side-on (left shoulder to the target).
//               It follows the aim up and down, and kicks on every shot (markRecoil).
//   lowReady    a long gun carried one-handed at the hip, muzzle forward and down.
//   reloadPose  a reload over its length (k 0..1): a pistol brought in close, the mag dropped,
//               a new one from the belt slapped in, the slide racked over the top; a long gun
//               tipped in, the mag pulled and a new one seated, the charging handle pulled.
//   fightStance fists up, in a style (FIGHT_STYLES): orthodox (side-on, lead fist out at eye
//               height, rear at the chin, elbows down and a little out); the Philly shell (very
//               side-on, the lead arm folded low across the belly, the lead shoulder up over the
//               chin, the rear hand high at the cheek); peek-a-boo (square, crouched, both
//               gloves up at the face, bobbing side to side); street (upright, hands lower and
//               wider, bouncing). Knees bent, the head turned to him.
//   punchPose   a jab (lead hand, straight out), a cross (rear hand, the hips and shoulders
//               turning through it), a hook (lead hand, the elbow up level with the fist,
//               swinging round as the body turns), an uppercut (rear hand: dip, then drive up
//               under the chin as the knees straighten) or a kick (rear leg: knee up, a push
//               kick out at the belly, back to the stance), out of the stance and back to it.
//   flinchPose  hit (markFlinch(c, now, 'hit', blow)): the head snaps back and turned with the
//               blow, the body rocks back, a step back, hands come up; with the fists up, the
//               guard is knocked back into the face and the body rocks. Shot (still up): a jolt
//               back, then doubling over, a hand to the wound, the other arm flung out.
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
  upperQuat(c, _qi).invert();
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

// weapon: its id; pitch: up (+) / down (-) in radians; hand: 'R' / 'L' (peeking out left);
// style (pistols): 'two' | 'one' | 'side' (PISTOL_STYLES). Returns the body's turn.
export const PISTOL_STYLES = { two: 'Two hands', one: 'One hand', side: 'Sideways' };

// (the kick: the barrel flipped toward the gun's top by angle q)
function kickAim(q) {
  _h.copy(_a).multiplyScalar(Math.cos(q)).addScaledVector(_g, Math.sin(q));
  _a.copy(_h).normalize();
}
const _g = V();
// (the head turned to look where the gun points)
function look(c, yaw, down = 0, tilt = 0) {
  c.neck.rotation.set(down, yaw, tilt);
}

export function aimPose(c, weapon, pitch = 0, now = 0, hand = 'R', style = 'two') {
  const [gs, ss, mx] = sides(hand);
  const k = recoil(c, now);
  const p = Math.max(-0.9, Math.min(0.9, pitch));
  seatGuns(c);
  if (LONG.has(weapon)) {
    const kick = (weapon === 'shotgun' ? 0.3 : 0.12) * k;
    const beta = BLADE * mx;
    aimFrame(c, beta, p + kick);
    // (the butt in the shoulder pocket, pushed back by the kick; the grip a hand's width up it)
    _b.set(-0.19 * mx, 1.6, 0.17).addScaledVector(_a, -(weapon === 'shotgun' ? 0.09 : 0.05) * k);
    _t.copy(_b).addScaledVector(_a, 0.22).addScaledVector(_u, -0.06);
    reachArm(c, gs, _t, _p.set(-0.8 * mx, -0.6, -0.1), _a, _u);
    _s.copy(_b).addScaledVector(_a, 0.5).addScaledVector(_u, -0.1);
    reachArm(c, ss, _s, _p.set(0.3 * mx, -1, 0), _a, _u);
    look(c, beta * 0.75, 0.2 - p * 0.3, -0.08 * mx); // (cheek down on the stock)
    return -beta;
  }
  if (style === 'one') {
    // One-handed: side-on, the gun shoulder to him, the arm locked out a touch above the
    // shoulder so the sights are at the eye; a shot flips the gun up at the wrist and the arm
    // rides up a little with it.
    const beta = -0.55 * mx;
    aimFrame(c, beta, p);
    _t.set(-Math.abs(c.armR.position.x) * mx, 1.56, 0).addScaledVector(_a, 0.55 - 0.05 * k);
    _t.y += 0.1 + 0.07 * k;
    _g.copy(_u);
    kickAim(0.5 * k);
    reachArm(c, gs, _t, _p.set(-1 * mx, -0.4, -0.2), _a, _u);
    // (the other arm loose at the side)
    reachArm(c, ss, _s.set(0.43 * mx, 0.99, -0.04), _p.set(0.3 * mx, 0, -1));
    look(c, beta * 0.8, -p * 0.3);
    return -beta;
  }
  if (style === 'side') {
    // Sideways: the gun rolled flat (its top turned in), the elbow up and out, the arm bent,
    // the gun at chin height, a little lean back; a shot throws the muzzle in and up.
    const beta = -0.35 * mx;
    aimFrame(c, beta, p);
    _t.set(-Math.abs(c.armR.position.x) * mx, 1.56, 0).addScaledVector(_a, 0.45 - 0.05 * k).addScaledVector(_l, 0.08 * mx);
    _t.y += 0.03 + 0.04 * k;
    _h.copy(_l).multiplyScalar(mx); // (the gun's top: in)
    _g.copy(_h).addScaledVector(_u, 0.6).normalize();
    kickAim(0.45 * k);
    reachArm(c, gs, _t, _p.set(-1 * mx, 0.9, -0.1), _a, _h);
    reachArm(c, ss, _s.set(0.44 * mx, 1.0, -0.02), _p.set(0.3 * mx, 0, -1));
    bendSpine(c, -0.06, 0, 0);
    look(c, beta * 0.8, -p * 0.3, 0.14 * mx);
    return -beta;
  }
  // Two hands: arms out in a triangle, the gun at chin height on the centre line.
  const beta = BLADE_PISTOL * mx;
  aimFrame(c, beta, p + 0.32 * k);
  _t.set(-0.02 * mx, 1.55, 0).addScaledVector(_a, 0.44 - 0.05 * k).addScaledVector(_u, 0.03 * k);
  reachArm(c, gs, _t, _p.set(-0.5 * mx, -1, -0.2), _a, _u);
  // (the support hand round the grip from the other side, fingers wrapping across)
  _s.copy(_t).addScaledVector(_l, 0.07 * mx).addScaledVector(_u, -0.05).addScaledVector(_a, -0.03);
  _h.copy(_a).multiplyScalar(0.75).addScaledVector(_l, -0.65 * mx);
  reachArm(c, ss, _s, _p.set(0.9 * mx, -0.5, -0.1), _h, _u);
  look(c, beta * 0.8, 0.05 - p * 0.3);
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
  upperQuat(c, _qi).invert();
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
    look(c, beta * 0.6, 0.35);
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
  look(c, beta * 0.6, 0.4);
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

// The stances. blade: how side-on; lead / rear: the fists (fight frame); poles: which way the
// elbows point (body frame); lean: forward over the hips; legs: [lead hip, lead knee, rear hip,
// rear knee]; bounce, sway (side to side), shoulder (the lead shoulder rolled up), chin (tucked).
export const FIGHT_STYLES = {
  orthodox: { name: 'Orthodox', blade: 0.5, lead: [0.1, 1.68, 0.4], rear: [-0.1, 1.64, 0.22], leadPole: [0.75, -1, -0.15], rearPole: [-0.8, -1, -0.1], lean: 0.12, legs: [0.38, 0.62, -0.22, 0.32], bounce: 0.025, sway: 0, shoulder: 0, chin: 0.12 },
  philly: { name: 'Philly shell', blade: 0.85, lead: [-0.12, 1.2, 0.26], rear: [-0.13, 1.72, 0.14], leadPole: [0.8, -0.4, -0.2], rearPole: [-0.9, -1, 0], lean: -0.03, legs: [0.28, 0.35, -0.32, 0.62], bounce: 0.012, sway: 0, shoulder: 0.16, chin: 0.2 },
  peekaboo: { name: 'Peek-a-boo', blade: 0.25, lead: [0.07, 1.7, 0.3], rear: [-0.07, 1.68, 0.27], leadPole: [0.25, -1, 0.1], rearPole: [-0.25, -1, 0.1], lean: 0.3, legs: [0.6, 1.0, 0.1, 0.8], bounce: 0.018, sway: 0.13, shoulder: 0, chin: 0.25 },
  street: { name: 'Street', blade: 0.3, lead: [0.2, 1.5, 0.42], rear: [-0.22, 1.46, 0.32], leadPole: [1, -0.6, -0.2], rearPole: [-1, -0.6, -0.2], lean: 0.02, legs: [0.25, 0.35, -0.15, 0.25], bounce: 0.04, sway: 0, shoulder: 0, chin: 0.05 },
};
const styleOf = (u) => FIGHT_STYLES[u.fightStyle] || FIGHT_STYLES.orthodox;

// A fist at its guard (offset by d in the fight frame: knocked back by a hit, say).
function guard(c, side, tw, bob, S, dx = 0, dy = 0, dz = 0) {
  const g = side === 'L' ? S.lead : S.rear;
  fightPt(_t, g[0] + dx, g[1] + bob + dy, g[2] + dz, tw);
  const q = side === 'L' ? S.leadPole : S.rearPole;
  reachArm(c, side, _t, _p.set(q[0], q[1], q[2]));
}

const phase = (t, a, b) => ease(clamp01((t - a) / (b - a)));

// The punch going on (kind and its progress 0..1), or null.
function activePunch(u, now) {
  if (u.punchAt == null) return null;
  const t = (now - u.punchAt) / u.punchT;
  return t >= 0 && t < 1 ? t : null;
}

// Fists up. style: a FIGHT_STYLES key; seed: puts each one's bounce out of step with the
// others'. Returns how far the hips come down (for the body's height); the body's turn (side-
// on) is what punchPose returns.
export function fightStance(c, now = 0, moving = 0, style = 'orthodox', seed = 0) {
  const u = c.group.userData;
  u.fightStyle = style;
  const S = styleOf(u);
  const bob = Math.sin((now + seed) * 6.5) * S.bounce * (1 - moving);
  const sway = Math.sin((now + seed) * 3.1) * S.sway * (1 - moving * 0.5);
  u.fightTw = -S.blade;
  u.fightBob = bob;
  u.guardUp = true;
  bendSpine(c, S.lean + bob * 0.5, 0, S.shoulder + sway);
  c.neck.rotation.set(S.chin, S.blade * 0.7, -sway * 0.6);
  guard(c, 'L', -S.blade, bob, S);
  guard(c, 'R', -S.blade, bob, S);
  // A kick takes the legs: the rear knee up, the push out, back down to the stance.
  const t = activePunch(u, now);
  const L = S.legs;
  if (t != null && u.punchKind === 'kick') {
    const up = phase(t, 0, 0.3);
    const out = phase(t, 0.3, 0.46) * (1 - phase(t, 0.56, 0.74));
    const down = phase(t, 0.74, 1);
    const hip = mix(mix(L[2], 1.5, up), L[2], down);
    const knee = mix(mix(mix(L[3], 1.95, up), 0.12, out), L[3], down);
    bendLeg(c.legR, c.kneeR, hip, knee);
    const w = up * (1 - down);
    return -bendLeg(c.legL, c.kneeL, mix(L[0], 0.1, w), mix(L[1], 0.22, w));
  }
  if (moving > 0.2) return 0; // (on the move: the walk does the legs)
  // (knees bent, lead foot forward, rear foot back; an uppercut dips into the knees first)
  const dip = t != null && u.punchKind === 'uppercut' ? phase(t, 0, 0.2) * (1 - phase(t, 0.22, 0.42)) * 0.35 : 0;
  const d1 = bendLeg(c.legL, c.kneeL, L[0] + bob + dip * 0.5, L[1] + dip);
  const d2 = bendLeg(c.legR, c.kneeR, L[2] - bob + dip * 0.5, L[3] + dip);
  return -Math.min(d1, d2) + bob * 0.4;
}

// kind: 'jab' | 'cross' | 'hook' | 'uppercut' | 'kick'; T: how long it lasts (PUNCH_T).
export const PUNCH_T = { jab: 0.3, cross: 0.3, hook: 0.4, uppercut: 0.42, kick: 0.6 };
export function markPunch(c, now, kind = 'jab', T = PUNCH_T[kind] || 0.32) {
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
// the punch).
export function punchPose(c, now) {
  const u = c.group.userData;
  const S = styleOf(u);
  const base = u.fightTw ?? -S.blade;
  const bob = u.fightBob || 0;
  const t = activePunch(u, now);
  if (t == null) {
    if (u.punchAt != null && now - u.punchAt >= u.punchT) u.punchAt = null;
    return base;
  }
  const kind = u.punchKind;
  const lean = S.lean;
  if (kind === 'hook') {
    // Lead hook: the fist drops back a touch and the elbow comes up level with it, the hips and
    // shoulders whip round and the arm with them, bent square, a beat, back to the guard.
    const load = phase(t, 0, 0.18);
    const go = phase(t, 0.18, 0.45);
    const back = phase(t, 0.6, 1);
    const tw = base + 0.12 * load * (1 - go) - 0.55 * go * (1 - back);
    const ang = mix(0.55, -0.35, go); // (round the front, from his left to the middle)
    const w = Math.max(load, go) * (1 - back);
    const x = mix(S.lead[0], 0.42 * Math.sin(ang) + 0.04, w);
    const z = mix(S.lead[2], 0.5 * Math.cos(ang) + 0.12, w);
    fightPt(_t, x, mix(S.lead[1] + bob, 1.64, load * (1 - back)), z, tw);
    const up = (1 - back) * load;
    reachArm(c, 'L', _t, _p.set(mix(S.leadPole[0], 0.9, up), mix(S.leadPole[1], 0.35, up), mix(S.leadPole[2], -0.3, up)));
    guard(c, 'R', tw, bob, S);
    bendSpine(c, lean + 0.05 * go * (1 - back), -0.25 * go * (1 - back), S.shoulder);
    return tw;
  }
  if (kind === 'uppercut') {
    // Rear uppercut: the fist drops to the belly as the knees dip and the shoulder turns back,
    // then drives straight up under his chin, elbow bent and under it, the body turning square.
    const dip = phase(t, 0, 0.2);
    const drive = phase(t, 0.2, 0.42);
    const back = phase(t, 0.58, 1);
    const tw = base - 0.1 * dip * (1 - drive) + 0.75 * drive * (1 - back);
    const g = S.rear;
    let x = mix(g[0], -0.1, dip);
    let y = mix(g[1] + bob, 1.16, dip);
    let z = mix(g[2], 0.24, dip);
    x = mix(x, 0.0, drive);
    y = mix(y, 1.8, drive);
    z = mix(z, 0.42, drive);
    fightPt(_t, mix(x, g[0], back), mix(y, g[1] + bob, back), mix(z, g[2], back), tw);
    reachArm(c, 'R', _t, _p.set(mix(-0.3, -0.15, drive), -1, mix(-0.2, 0.25, drive)));
    guard(c, 'L', tw, bob, S);
    bendSpine(c, lean + 0.2 * dip * (1 - drive) - 0.12 * drive * (1 - back), 0.25 * drive * (1 - back) - 0.15 * dip * (1 - drive), S.shoulder + 0.2 * dip * (1 - drive));
    return tw;
  }
  if (kind === 'kick') {
    // Push kick off the rear leg (fightStance does the legs): squaring up to let it through,
    // leaning back over the standing leg, the rear hand dropping back for balance.
    const up = phase(t, 0, 0.3);
    const out = phase(t, 0.3, 0.46) * (1 - phase(t, 0.56, 0.74));
    const down = phase(t, 0.74, 1);
    const w = up * (1 - down);
    const tw = base * (1 - 0.65 * w);
    guard(c, 'L', tw, bob, S);
    guard(c, 'R', tw, bob, S, -0.15 * out, -0.3 * out, -0.25 * out);
    bendSpine(c, mix(lean, -0.3, out) - 0.05 * w, 0, S.shoulder * (1 - w));
    return tw;
  }
  // Jab / cross: a short load, the snap out, a beat there, back to the guard.
  const o = t < 0.12 ? -0.25 * ease(t / 0.12) : t < 0.38 ? mix(-0.25, 1, ease((t - 0.12) / 0.26)) : t < 0.55 ? 1 : 1 - ease((t - 0.55) / 0.45);
  const k = Math.max(0, o);
  const dip = Math.max(0, -o);
  if (kind === 'jab') {
    // Lead hand straight out at his chin, the lead shoulder rolling up behind it.
    const tw = base - 0.1 * k;
    fightPt(_t, mix(S.lead[0], 0.0, k), mix(S.lead[1] + bob, 1.62, k), mix(S.lead[2] - dip * 0.08, 0.85, k), tw);
    reachArm(c, 'L', _t, _p.set(mix(S.leadPole[0], 0.5, k), mix(S.leadPole[1], -1, k), mix(S.leadPole[2], -0.6, k)));
    guard(c, 'R', tw, bob, S);
    bendSpine(c, lean + 0.06 * k, -0.1 * k, S.shoulder + 0.08 * k);
    return tw;
  }
  // Cross: the rear hand straight through the middle, the hips and shoulders turning square and
  // past it, the weight onto the front foot.
  const tw = base + 0.8 * k - 0.05 * dip;
  fightPt(_t, mix(S.rear[0], 0.0, k), mix(S.rear[1] + bob, 1.62, k), mix(S.rear[2] - dip * 0.06, 0.88, k), tw);
  reachArm(c, 'R', _t, _p.set(mix(S.rearPole[0], -0.5, k), mix(S.rearPole[1], -1, k), mix(S.rearPole[2], -0.6, k)));
  guard(c, 'L', tw, bob, S);
  bendSpine(c, lean + 0.1 * k, 0.3 * k, S.shoulder * (1 - k));
  return tw;
}

// Which way someone falls when hit from (fx, fz): face down if it came from behind them.
export function fallFace(x, z, heading, fx, fz) {
  if (fx == null) return 'back';
  return (fx - x) * Math.sin(heading) + (fz - z) * Math.cos(heading) < 0 ? 'front' : 'back';
}

// kind: 'hit' (a blow) or 'shot'; blow: the punch it was ('hook' turns the head round,
// 'uppercut' snaps it up).
export function markFlinch(c, now, kind = 'hit', blow = 'jab') {
  if (!c) return;
  const u = c.group.userData;
  u.flinchAt = now;
  u.flinchKind = kind;
  u.flinchBlow = blow;
  u.flinchSide = blow === 'hook' ? 1 : blow === 'cross' ? -1 : Math.random() < 0.5 ? -1 : 1;
}

const FLINCH_T = { hit: 0.6, shot: 0.55 };
export function flinching(c, now) {
  const u = c?.group.userData;
  const at = u?.flinchAt;
  return at != null && now - at >= 0 && now - at < (FLINCH_T[u.flinchKind] || 0.5);
}

const _w0 = V();
const _w1 = V();
// Over whatever pose is there (a hand blends from where it is). Returns the lean back.
export function flinchPose(c, now) {
  const u = c.group.userData;
  if (u.flinchAt == null) return null;
  const T = FLINCH_T[u.flinchKind] || 0.5;
  const t = (now - u.flinchAt) / T;
  if (t < 0 || t >= 1) {
    if (t >= 1) u.flinchAt = null;
    return null;
  }
  const side = u.flinchSide || 1;
  const hit = t < 0.13 ? ease(t / 0.13) : 1 - ease((t - 0.13) / 0.87); // (the snap, then back)
  const late = phase(t, 0.08, 0.3) * (1 - phase(t, 0.6, 1)); // (what follows it)
  if (u.flinchKind === 'shot') {
    // A jolt back, then doubling over; a hand to the wound, the other arm flung out.
    wristPos(c, side > 0 ? 'R' : 'L', _w0);
    wristPos(c, side > 0 ? 'L' : 'R', _w1);
    bendSpine(c, mix(c.spine.rotation.x / 0.55, t < 0.15 ? -0.4 : 0.5, Math.max(hit, late)), 0.2 * side * hit, 0.12 * side * late);
    c.neck.rotation.set(mix(-0.4, 0.35, phase(t, 0.1, 0.3)) * Math.max(hit, late), 0, 0);
    _t.set(0.1 * side, 1.18, 0.2).lerp(_w0, 1 - late);
    reachArm(c, side > 0 ? 'R' : 'L', _t, _p.set(-0.6 * side, -1, 0), null, null, 'group');
    _s.set(0.55 * side, 1.25, 0.05).lerp(_w1, 1 - hit);
    reachArm(c, side > 0 ? 'L' : 'R', _s, _p.set(0.4 * side, -1, -0.4), null, null, 'group');
    crouchPose(c, 0.25 * late);
    return 0.3 * hit;
  }
  const blow = u.flinchBlow;
  const headUp = blow === 'uppercut' ? 1 : 0;
  // The head snaps back and round with the blow, the upper body rocks back.
  c.neck.rotation.set(-(0.7 + 0.45 * headUp) * hit, side * 0.7 * hit * (1 - headUp), side * 0.25 * hit);
  if (u.guardUp) {
    // Fists up: the guard is knocked back into the face, the body rocks and the knees give.
    const S = styleOf(u);
    const tw = u.fightTw ?? -S.blade;
    guard(c, 'L', tw, u.fightBob || 0, S, 0.1 * hit, 0.04 * hit, -0.2 * hit);
    guard(c, 'R', tw, u.fightBob || 0, S, -0.1 * hit, 0.04 * hit, -0.15 * hit);
    c.spine.rotation.x -= 0.3 * hit;
    c.chest.rotation.x -= 0.32 * hit;
    c.chest.rotation.y += side * 0.3 * hit * (1 - headUp);
    bendLeg(c.legL, c.kneeL, c.legL.rotation.x * -1 + 0.1 * late, c.kneeL.rotation.x + 0.25 * late);
    return 0.3 * hit;
  }
  // Hands come up to cover, a step back.
  wristPos(c, 'L', _w0);
  wristPos(c, 'R', _w1);
  bendSpine(c, -0.6 * hit + 0.1 * late, side * 0.45 * hit * (1 - headUp), side * 0.15 * hit);
  _t.set(0.12, 1.7, 0.28).lerp(_w0, 1 - late);
  reachArm(c, 'L', _t, _p.set(0.6, -1, -0.2), null, null, 'group');
  _s.set(-0.12, 1.68, 0.26).lerp(_w1, 1 - late);
  reachArm(c, 'R', _s, _p.set(-0.6, -1, -0.2), null, null, 'group');
  bendLeg(c.legR, c.kneeR, -0.4 * late, 0.3 * late);
  bendLeg(c.legL, c.kneeL, 0.15 * late, 0.35 * late);
  return 0.3 * hit;
}

// Down on the right knee, the left foot planted forward: shooting low. Returns the drop.
export function kneelPose(c) {
  bendSpine(c, 0.06);
  const d1 = bendLeg(c.legL, c.kneeL, 1.35, 1.45);
  const d2 = bendLeg(c.legR, c.kneeR, 0.15, 1.85);
  return -Math.min(0.62, Math.max(d1, d2) * 0.82);
}
