import { bendLeg } from './character.js';

// Steals, the same for everybody (you and him):
//   stripped  the one who had it: the hands fly open where the ball was, a jolt back, then a
//             twist toward where it went, knees giving.
//   scoop     whoever comes up with a loose ball off the floor: the hips drop, leaning over, both
//             hands down to it, and up to the chest.
// (The poke itself is the reach-in, reachpose.js: reachHit makes it go through.)
//
// markStripped(c, now, side): side 1 it went off to his right, -1 his left.
// markScoop(c, now). strippedPose / scoopPose(c, now, heading) pose it while it's on and return
// how far the hips come down (or null when there's none on). scooping(c, now): in the middle of one.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const seg = (k, a, b) => ease(clamp01((k - a) / (b - a)));

const STRIP_T = 0.55;
const SCOOP_T = 0.36;

export function markStripped(c, now, side) {
  if (!c) return;
  const u = c.group.userData;
  u.stripAt = now;
  u.stripSide = side >= 0 ? 1 : -1;
}

export function markScoop(c, now) {
  if (!c) return;
  c.group.userData.scoopAt = now;
}

export function scooping(c, now) {
  const at = c?.group.userData.scoopAt;
  return at != null && now - at >= 0 && now - at < SCOOP_T;
}

export function strippedPose(c, now, heading) {
  const u = c.group.userData;
  if (u.stripAt == null) return null;
  const t = now - u.stripAt;
  if (t < 0 || t > STRIP_T) {
    u.stripAt = null;
    return null;
  }
  const k = t / STRIP_T;
  const jolt = seg(k, 0, 0.15) * (1 - seg(k, 0.55, 1)); // (hands open, rocked back)
  const turn = seg(k, 0.15, 0.6) * (1 - seg(k, 0.8, 1)); // (looking round after it)
  // Both hands flung open out in front where the ball was, palms up.
  for (const [a, e, w, out] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = mix(a.rotation.x, -1.45, jolt);
    a.rotation.z = mix(a.rotation.z, 0.5 * out, jolt);
    e.rotation.x = mix(e.rotation.x, -0.45, jolt);
    w.rotation.x = mix(w.rotation.x, -0.6, jolt);
  }
  const d0 = Math.max(0, Math.min(bendLeg(c.legL, c.kneeL, -c.legL.rotation.x, c.kneeL.rotation.x), bendLeg(c.legR, c.kneeR, -c.legR.rotation.x, c.kneeR.rotation.x)));
  const give = Math.max(jolt * 0.6, turn * 0.4);
  const d1 = bendLeg(c.legL, c.kneeL, mix(-c.legL.rotation.x, 0.55, give), mix(c.kneeL.rotation.x, 1.0, give));
  const d2 = bendLeg(c.legR, c.kneeR, mix(-c.legR.rotation.x, 0.45, give), mix(c.kneeR.rotation.x, 0.9, give));
  c.group.rotation.x = -0.22 * jolt + 0.1 * turn;
  c.group.rotation.y = heading + u.stripSide * -0.6 * turn;
  return -Math.max(0, Math.max(0, Math.min(d1, d2)) - d0);
}

export function scoopPose(c, now, heading) {
  const u = c.group.userData;
  if (u.scoopAt == null) return null;
  const t = now - u.scoopAt;
  if (t < 0 || t > SCOOP_T) {
    u.scoopAt = null;
    return null;
  }
  const k = t / SCOOP_T;
  const down = seg(k, 0, 0.35) * (1 - seg(k, 0.5, 1)); // (bent over, hands at the floor)
  const up = seg(k, 0.4, 0.9); // (ball up to the chest)
  for (const [a, e, w, out] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = mix(mix(a.rotation.x, -0.75, down), -1.15, up * (1 - down));
    a.rotation.z = mix(a.rotation.z, 0.12 * out, Math.max(down, up));
    e.rotation.x = mix(mix(e.rotation.x, -0.15, down), -1.35, up * (1 - down));
    w.rotation.x = mix(w.rotation.x, -0.3, down);
  }
  const d0 = Math.max(0, Math.min(bendLeg(c.legL, c.kneeL, -c.legL.rotation.x, c.kneeL.rotation.x), bendLeg(c.legR, c.kneeR, -c.legR.rotation.x, c.kneeR.rotation.x)));
  const d1 = bendLeg(c.legL, c.kneeL, mix(-c.legL.rotation.x, 1.35, down), mix(c.kneeL.rotation.x, 1.9, down));
  const d2 = bendLeg(c.legR, c.kneeR, mix(-c.legR.rotation.x, 1.0, down), mix(c.kneeR.rotation.x, 1.5, down));
  c.group.rotation.x = mix(c.group.rotation.x, 0.55, down);
  c.group.rotation.y = heading;
  return -Math.max(0, Math.max(0, Math.min(d1, d2)) - d0);
}
