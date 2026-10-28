import { bendLeg, bendSpine } from './character.js';

// A reach-in (a steal try), the same for everybody (you on him, him on you), played over the
// defensive stance: a quick lunge step in, low, the hand on the ball's side shooting out at it
// and sweeping across (a wrist flick at the end), the other hand staying up, the body leaning
// and twisting into it; then back into the stance. A whiff (gambled and missed) hangs in the
// lunge longer, off balance.
//
// From the defensive stance (stance: true) it's a quicker, tighter poke: no lunge step, the
// feet stay set and the hips stay down, a short lean, and straight back into the slide.
//
// markReach(c, now, side, whiff, stance): side 1 the ball's to his right, -1 his left.
// reachPose(c, now, heading) poses it while one's on (call it after the rest of the pose);
// returns how much further the hips come down than the stance had them, or null when not reaching.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;

const OUT_L = 0.14; // (the lunge and the swipe)
const HOLD = 0.08;
const BACK_L = 0.22; // (recovering)

export function markReach(c, now, side, whiff = false, stance = false) {
  const u = c.group.userData;
  u.reachStance = stance;
  u.reachAt = now;
  u.reachSide = side >= 0 ? 1 : -1;
  u.reachWhiff = whiff;
  u.reachHit = false;
}

// The poke got it (a steal): the swipe goes on through the ball, the wrist snapping.
export function reachHit(c) {
  if (c) c.group.userData.reachHit = true;
}

export function reachWhiff(c) {
  c.group.userData.reachWhiff = true;
}

export function reachPose(c, now, heading) {
  const u = c.group.userData;
  if (u.reachAt == null) return null;
  const st = !!u.reachStance;
  const OUT = st ? 0.1 : OUT_L; // (from the stance: quicker out and back)
  const BACK = st ? 0.15 : BACK_L;
  const hold = (st ? 0.05 : HOLD) + (u.reachWhiff ? (st ? 0.12 : 0.25) : 0);
  const t = now - u.reachAt;
  if (t < 0 || t > OUT + hold + BACK) {
    u.reachAt = null;
    return null;
  }
  // k: 0 standing in the stance .. 1 full reach; s: how far the hand has swept across.
  const k = t < OUT ? ease(t / OUT) : t < OUT + hold ? 1 : 1 - ease((t - OUT - hold) / BACK);
  const s = ease(clamp01(t / (OUT + hold * 0.7)));
  const R = u.reachSide > 0;
  const reach = R ? { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 } : { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 };
  const up = R ? { a: c.armL, e: c.elbowL, w: c.wristL, out: 1 } : { a: c.armR, e: c.elbowR, w: c.wristR, out: -1 };
  // The reaching arm: out low at the ball (about waist height in front), straight, swinging
  // from out wide to across the body, the wrist flicking through.
  reach.a.rotation.x = mix(reach.a.rotation.x, st ? -1.05 : -1.25, k); // (lower from the stance)
  const hit = u.reachHit ? 1 : 0;
  reach.a.rotation.z = mix(reach.a.rotation.z, mix(0.55, -0.25 - 0.3 * hit, s) * reach.out, k);
  reach.e.rotation.x = mix(reach.e.rotation.x, -0.08, k);
  reach.w.rotation.x = mix(reach.w.rotation.x, mix(-0.3, 0.7 + 0.5 * hit, s), k);
  // The other hand stays up (no free layup lane behind the gamble).
  up.a.rotation.x = mix(up.a.rotation.x, -2.3, k);
  up.a.rotation.z = mix(up.a.rotation.z, 0.2 * up.out, k);
  up.e.rotation.x = mix(up.e.rotation.x, -0.35, k);
  if (st) {
    // From the stance: the feet stay set, a short lean and a twist into the poke.
    c.group.rotation.x = mix(c.group.rotation.x, c.group.rotation.x + (u.reachWhiff && t > OUT ? 0.22 : 0.14), k);
    c.group.rotation.y = heading - u.reachSide * 0.18 * k;
    bendSpine(c, mix(c.spine.rotation.x / 0.55, 0.42, k), -u.reachSide * 0.3 * k, 0); // (the shoulder dipping in after it)
    return 0;
  }
  // The lunge: the leg on the reaching side steps in, the other pushes; low, leaning, twisting.
  const [Lin, Kin] = R ? [c.legR, c.kneeR] : [c.legL, c.kneeL];
  const [Lout, Kout] = R ? [c.legL, c.kneeL] : [c.legR, c.kneeR];
  const d0 = Math.max(0, Math.min(bendLeg(Lin, Kin, -Lin.rotation.x, Kin.rotation.x), bendLeg(Lout, Kout, -Lout.rotation.x, Kout.rotation.x))); // (the stance's own)
  const d1 = bendLeg(Lin, Kin, mix(-Lin.rotation.x, 1.15, k), mix(Kin.rotation.x, 1.55, k));
  const d2 = bendLeg(Lout, Kout, mix(-Lout.rotation.x, 0.25, k), mix(Kout.rotation.x, 0.9, k));
  c.group.rotation.x = mix(c.group.rotation.x, u.reachWhiff && t > OUT ? 0.3 : 0.2, k);
  bendSpine(c, 0.3 * k, -u.reachSide * 0.35 * k, 0);
  c.group.rotation.y = heading - u.reachSide * 0.3 * k; // (turning into the hand that's reaching)
  return -Math.max(0, Math.max(0, Math.min(d1, d2)) - d0); // (the hips come down further with the lunge)
}
