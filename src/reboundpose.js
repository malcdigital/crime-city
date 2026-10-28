import { bendLeg } from './character.js';

// Rebounding, the same for everybody (you and him):
//   ready    a shot's up: facing the rim, hands up at the shoulders, ready to go get it.
//   box out  the back into the other one: a wide, low base, arms out wide with the elbows up,
//            sitting back into him.
//   grab     coming down with it: both hands snatch it (up high, or out in front), then it's
//            pulled in to the chin, elbows out, and the knees take the landing.
// (Going up for it is the rebound jump, blockpose.js; a ball off the floor is the scoop,
// stealpose.js.)
//
// readyPose(c), boxOutPose(c, phase, moving): pose it now. markGrab(c, now, high),
// grabPose(c, now): while one's on; grabbing(c, now): in the middle of one. The ones that bend
// the knees return how much further the hips come down.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const mix = (a, b, k) => a + (b - a) * k;
const seg = (k, a, b) => ease(clamp01((k - a) / (b - a)));

const GRAB_T = 0.55;

const legDrop = (c) => Math.max(0, Math.min(bendLeg(c.legL, c.kneeL, -c.legL.rotation.x, c.kneeL.rotation.x), bendLeg(c.legR, c.kneeR, -c.legR.rotation.x, c.kneeR.rotation.x)));

export function readyPose(c) {
  for (const [a, e, w, out] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = -1.9;
    a.rotation.z = 0.25 * out;
    e.rotation.x = -1.1;
    w.rotation.x = -0.3;
  }
}

export function boxOutPose(c, phase, moving) {
  const d0 = legDrop(c);
  // A wide base, low; shuffling a little if he's pushing.
  const sh = moving ? Math.sin(phase) * 0.15 : 0;
  const d1 = bendLeg(c.legL, c.kneeL, 0.75 + sh, 1.15);
  const d2 = bendLeg(c.legR, c.kneeR, 0.75 - sh, 1.15);
  c.legL.rotation.z = 0.3;
  c.legR.rotation.z = -0.3;
  // Arms out wide, elbows bent up: taking up room.
  for (const [a, e, w, out] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = -0.75;
    a.rotation.z = 1.1 * out;
    e.rotation.x = -1.0;
    w.rotation.x = 0;
  }
  c.group.rotation.x = -0.12; // (sitting back into him)
  return -Math.max(0, Math.max(0, Math.min(d1, d2)) * 0.92 - d0);
}

export function markGrab(c, now, high) {
  if (!c) return;
  const u = c.group.userData;
  u.grabAt = now;
  u.grabHigh = !!high;
}

export function grabbing(c, now) {
  const at = c?.group.userData.grabAt;
  return at != null && now - at >= 0 && now - at < GRAB_T;
}

export function grabPose(c, now) {
  const u = c.group.userData;
  if (u.grabAt == null) return null;
  const t = now - u.grabAt;
  if (t < 0 || t > GRAB_T) {
    u.grabAt = null;
    return null;
  }
  const k = t / GRAB_T;
  const snatch = 1 - seg(k, 0.15, 0.45); // (hands on it where it was)
  const chin = seg(k, 0.15, 0.45); // (pulled in to the chin, elbows out)
  const reach = u.grabHigh ? -2.85 : -1.6;
  for (const [a, e, w, out] of [[c.armL, c.elbowL, c.wristL, 1], [c.armR, c.elbowR, c.wristR, -1]]) {
    a.rotation.x = mix(reach, -1.45, chin);
    a.rotation.z = mix(-0.08, 0.7, chin) * out;
    e.rotation.x = mix(-0.15, -1.8, chin);
    w.rotation.x = mix(-0.35, 0.1, chin) * (snatch + chin);
  }
  // Coming down with it: knees soaking it up, then standing tall with it.
  const land = seg(k, 0.2, 0.45) * (1 - seg(k, 0.75, 1));
  const d0 = legDrop(c);
  const d1 = bendLeg(c.legL, c.kneeL, mix(-c.legL.rotation.x, 0.7, land), mix(c.kneeL.rotation.x, 1.2, land));
  const d2 = bendLeg(c.legR, c.kneeR, mix(-c.legR.rotation.x, 0.6, land), mix(c.kneeR.rotation.x, 1.1, land));
  c.group.rotation.x = 0.12 * land;
  return -Math.max(0, Math.max(0, Math.min(d1, d2)) - d0);
}
