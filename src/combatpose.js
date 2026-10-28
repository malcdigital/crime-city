import { crouchPose, bendLeg } from './character.js';

// Fighting and shooting poses, the same for everybody (you, the gangs, the cops):
//   aimPose     a gun up and on target: a pistol in two hands (the gun arm locked straight,
//               the support hand cupping it), a long gun shouldered (the trigger elbow out, the
//               support arm reaching under the barrel); following the aim up and down; a kick
//               on every shot (markRecoil).
//   lowReady    a long gun carried across the body, muzzle down, when it isn't up.
//   fightStance fists up: hands at the chin, elbows in, knees bent, the lead foot forward, a
//               little bounce.
//   punchPose   a jab (lead hand), a cross (rear hand, the body turning into it) or a hook
//               (round from the side), out of the stance and back to it (markPunch).
//   flinchPose  hit: knocked back a step, hands coming up (markFlinch); shot, a harder jolt,
//               the hand going to the hit (markFlinch(c, now, 'shot')).
//   reloadPose  a reload, over its length (k 0..1): a pistol's mag out and a new one in, the
//               slide racked; a long gun's mag out and in at the well, the charging handle.
//   kneelPose   down on one knee to shoot (crouched and aiming).
//
// The arms: x raises them forward (negative), z swings them in across the body (positive on
// the right arm, negative on the left), an elbow bends with a negative x, a wrist likewise.
// Guns sit on the wrist pointing down the hand, so the shoulder + elbow + wrist angles add up
// to where the barrel points: -π/2 is level, straight ahead.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const LEVEL = -Math.PI / 2;
const LONG = new Set(['smg', 'rifle', 'shotgun']);

const arms = (c, hand) => (hand === 'L'
  ? { g: [c.armL, c.elbowL, c.wristL, -1], s: [c.armR, c.elbowR, c.wristR, 1] }
  : { g: [c.armR, c.elbowR, c.wristR, 1], s: [c.armL, c.elbowL, c.wristL, -1] });
const set = ([a, e, w, side], x, z, el, wr) => {
  a.rotation.x = x;
  a.rotation.z = side * z;
  a.rotation.y = 0;
  e.rotation.x = el;
  w.rotation.x = wr;
};

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

// weapon: its id; pitch: up (+) / down (-) in radians; hand: 'R' / 'L' (peeking out left).
export function aimPose(c, weapon, pitch = 0, now = 0, hand = 'R') {
  const p = Math.max(-0.9, Math.min(0.9, pitch));
  const k = recoil(c, now);
  const { g, s } = arms(c, hand);
  if (LONG.has(weapon)) {
    // Shouldered: the trigger arm's elbow out and bent, the wrist turning the barrel level;
    // the support arm out under the barrel.
    const kick = (weapon === 'shotgun' ? 0.35 : 0.16) * k;
    const sx = -1.0 - p * 0.85 - kick;
    const el = -1.05;
    set(g, sx, 0.12, el, LEVEL - p - kick * 0.4 - sx - el);
    set(s, -1.38 - p * 0.9 - kick * 0.6, 0.3, -0.32, 0.15);
  } else {
    // A pistol in two hands: the gun arm straight down the sights, the other bent in to cup it.
    const kick = 0.3 * k;
    const sx = LEVEL - p * 0.95 - kick;
    set(g, sx, 0.14, -0.05, -kick * 0.9);
    set(s, sx + 0.18, 0.42, -0.62, -0.25);
  }
}

// A long gun down and across the body, muzzle toward the ground: carried, not aimed.
export function lowReady(c, weapon, hand = 'R') {
  if (!LONG.has(weapon)) return false;
  const { g, s } = arms(c, hand);
  set(g, -0.45, 0.32, -1.25, 0.95);
  set(s, -0.85, 0.55, -0.85, 0.2);
  return true;
}

// Fists up. Returns how far the hips come down (for the body's height).
export function fightStance(c, now = 0, moving = 0) {
  const bob = Math.sin(now * 6.5) * 0.04 * (1 - moving);
  // (the lead hand, the left, a little further out; the rear one tight at the chin)
  set([c.armL, c.elbowL, c.wristL, -1], -0.98 + bob, 0.32, -1.75, 0.25);
  set([c.armR, c.elbowR, c.wristR, 1], -0.78 - bob, 0.38, -2.05, 0.3);
  if (moving > 0.2) return 0; // (on the move: the walk does the legs)
  // (knees bent, lead foot forward, rear back)
  const d1 = bendLeg(c.legL, c.kneeL, 0.42 + bob, 0.55);
  const d2 = bendLeg(c.legR, c.kneeR, 0.05 - bob, 0.38);
  return -Math.min(d1, d2) + bob * 0.3;
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

// Over the stance (or whatever the arms were doing). Returns the body's turn (radians, to add
// to its facing: into the punch) or null when there's none going.
export function punchPose(c, now) {
  const u = c.group.userData;
  if (u.punchAt == null) return null;
  const t = (now - u.punchAt) / u.punchT;
  if (t < 0 || t >= 1) {
    if (t >= 1) u.punchAt = null;
    return null;
  }
  // (a short load, the snap out, a beat there, back to the guard)
  const out = t < 0.12 ? -0.25 * ease(t / 0.12) : t < 0.38 ? mix(-0.25, 1, ease((t - 0.12) / 0.26)) : t < 0.55 ? 1 : 1 - ease((t - 0.55) / 0.45);
  const k = Math.max(0, out);
  const back = Math.max(0, -out);
  const kind = u.punchKind;
  if (kind === 'jab') {
    // Lead hand straight out at chin height.
    set([c.armL, c.elbowL, c.wristL, -1], mix(-0.98, -1.62, k) + back * 0.15, mix(0.32, 0.12, k), mix(-1.75, -0.05, k), mix(0.25, 0, k));
    return -0.12 * k;
  }
  if (kind === 'cross') {
    // Rear hand across and through, the shoulders turning into it.
    set([c.armR, c.elbowR, c.wristR, 1], mix(-0.78, -1.6, k) + back * 0.2, mix(0.38, 0.28, k), mix(-2.05, -0.05, k), mix(0.3, 0, k));
    return 0.32 * k - 0.1 * back;
  }
  // Hook: the rear arm bent square, swinging round from the side.
  set([c.armR, c.elbowR, c.wristR, 1], mix(-0.78, -1.45, k), mix(0.38, mix(-0.2, 1.05, k), clamp01(t * 2)), mix(-2.05, -1.45, k), 0.1);
  return 0.45 * k - 0.15 * back;
}

// Hit (a punch, say): from (fx, fz), the direction it came from relative to them is worked out
// by the caller; this only poses. Returns the lean back (radians) or null.
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
    // (shot: a jolt, one hand going to where it hit, the other arm flung out)
    const hit = u.flinchSide > 0 ? [c.armR, c.elbowR, c.wristR, 1] : [c.armL, c.elbowL, c.wristL, -1];
    const other = u.flinchSide > 0 ? [c.armL, c.elbowL, c.wristL, -1] : [c.armR, c.elbowR, c.wristR, 1];
    set(hit, mix(hit[0].rotation.x, -0.7, k), 0.75 * k, -1.9 * k, 0.3 * k);
    set(other, mix(other[0].rotation.x, -0.5, k), -0.7 * k, -0.4 * k, 0);
    crouchPose(c, 0.22 * k);
    return 0.28 * k;
  }
  // (hands coming up, the head snapped back)
  set([c.armL, c.elbowL, c.wristL, -1], -1.2 * k, 0.3 * k, -1.6 * k, 0);
  set([c.armR, c.elbowR, c.wristR, 1], -1.0 * k, 0.3 * k, -1.8 * k, 0);
  crouchPose(c, 0.15 * k);
  return 0.18 * k;
}

// A reload over its length, k 0..1 (weapon: its id; hand: 'R' / 'L').
export function reloadPose(c, weapon, k, hand = 'R') {
  const { g, s } = arms(c, hand);
  const seg = (a, b) => ease(clamp01((k - a) / (b - a)));
  if (LONG.has(weapon)) {
    // The gun tipped in at chest height; the support hand pulls the mag (to the belt), slaps a
    // new one in, then reaches over and racks the handle.
    set(g, -0.75, 0.3, -1.25, LEVEL + 0.35 - (-0.75) - (-1.25));
    const down = seg(0.1, 0.35) * (1 - seg(0.45, 0.65));
    const rack = seg(0.75, 0.85) * (1 - seg(0.88, 1));
    set(s, mix(-1.05, -0.25, down) - rack * 0.35, mix(0.55, 0.15, down) + rack * 0.35, mix(-0.75, -0.3, down) - rack * 0.5, 0.15);
    return;
  }
  // A pistol brought in close, muzzle up a little; the mag dropped, the support hand down to the
  // belt and back up with a new one, then over the top to rack the slide.
  set(g, -0.95, 0.32, -1.3, LEVEL + 0.45 - (-0.95) - (-1.3));
  const down = seg(0.1, 0.35) * (1 - seg(0.45, 0.7));
  const rack = seg(0.75, 0.86) * (1 - seg(0.9, 1));
  set(s, mix(-0.95, -0.2, down) - rack * 0.25, mix(0.55, 0.12, down) + rack * 0.2, mix(-1.3, -0.35, down) - rack * 0.3, 0);
}

// Down on the right knee, the left foot planted forward: shooting low. Returns the drop.
export function kneelPose(c) {
  const d1 = bendLeg(c.legL, c.kneeL, 1.35, 1.45);
  const d2 = bendLeg(c.legR, c.kneeR, 0.15, 1.85);
  return -Math.min(0.62, Math.max(d1, d2) * 0.82);
}
