import * as THREE from 'three';
import { bendSpine, bendLeg, reachArm, lowestPoint } from './character.js';
import { twoHandBall } from './passpose.js';

// Football poses with the spine (yours in gridiron.js, everybody else's in football.js: the same
// code, so you and they move alike). Each sets the joints on c (after the walk animation) and
// most return the height change that puts the feet (or whatever's lowest) on the grass. The pose
// also records where the ball sits (c.group.userData.fbGrip), so the ball is placed from the
// hands after posing (fbBallAt) instead of at a fixed spot beside the body.
//   qbStance     at the line: knees bent, bent at the waist over a flat back, eyes downfield,
//                both hands out together for the snap
//   wrStance     a two-point stance: staggered feet, leaning over the front foot, head up
//   dbStance     a defender's: wide and low, weight on the balls of the feet, hands ready
//   holdBall     the quarterback in the pocket: two hands on it high at the chest, the head and
//                shoulders turning to scan the field
//   tuckCarry    running with it: high and tight under the arm, leaning into the run
//   throwPose    the throw: the shoulders turn side-on loading it, the ball back by the ear; then
//                the hips and chest whip through, the arm follows and finishes across the body
//   catchPose    hands up in a diamond: high (a lob: reaching, looking it in) or at the chest
//   layoutPose   a diving catch (stretched out, head up after the ball) or brought down
//   jukedPose    off balance, twisted, the arms out
//   reachBall    a defender going up for the ball

const mix = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const grip = (c, g) => (c.group.userData.fbGrip = g);

// The quarterback's stance at the line: knees bent, hands out together for the snap.
export function qbStance(c) {
  bendLeg(c.legL, c.kneeL, 0.75, 1.05);
  bendLeg(c.legR, c.kneeR, 0.75, 1.05);
  c.legL.rotation.z = 0.14;
  c.legR.rotation.z = -0.14;
  bendSpine(c, 0.45, 0, 0);
  c.neck.rotation.set(-0.5, 0, 0); // (eyes downfield over the line)
  reachArm(c, 'R', _a.set(-0.07, 0.98, 0.45), _b.set(-1, -0.4, -0.3), _c.set(0, -0.5, 1), null, 'group');
  reachArm(c, 'L', _a.set(0.07, 0.98, 0.45), _b.set(1, -0.4, -0.3), _c.set(0, -0.5, 1), null, 'group');
  grip(c, 'two');
  return -lowestPoint(c);
}

// A receiver's two-point stance: the outside foot up, leaning over it, head up, arms cocked to
// drive off the line.
export function wrStance(c) {
  bendLeg(c.legL, c.kneeL, 0.6, 0.75);
  bendLeg(c.legR, c.kneeR, -0.2, 0.6);
  bendSpine(c, 0.55, 0, 0);
  c.neck.rotation.set(-0.65, 0, 0);
  c.armR.rotation.set(-0.8, 0, 0);
  c.elbowR.rotation.set(-1.3, 0, 0);
  c.armL.rotation.set(0.45, 0, 0);
  c.elbowL.rotation.set(-0.9, 0, 0);
  return -lowestPoint(c);
}

// A defender's stance: wide, low, the hands loose in front, eyes up.
export function dbStance(c) {
  bendLeg(c.legL, c.kneeL, 0.65, 1.05);
  bendLeg(c.legR, c.kneeR, 0.65, 1.05);
  c.legL.rotation.z = 0.2;
  c.legR.rotation.z = -0.2;
  bendSpine(c, 0.35, 0, 0);
  c.neck.rotation.set(-0.35, 0, 0);
  c.armL.rotation.set(-0.55, 0, 0.12);
  c.armR.rotation.set(-0.55, 0, -0.12);
  c.elbowL.rotation.set(-1.0, 0, 0);
  c.elbowR.rotation.set(-1.0, 0, 0);
  return -lowestPoint(c);
}

// In the pocket: two hands on the ball high at the chest, elbows in; look (-1..1, + his left)
// turns the head and shoulders to scan.
export function holdBall(c, look = 0) {
  bendSpine(c, 0.12, look * 0.3, 0);
  c.neck.rotation.set(-0.05, look * 0.6, 0);
  reachArm(c, 'R', _a.set(-0.07, 1.3, 0.32), _b.set(-1, -0.6, -0.2), _c.set(0.2, 0.3, 1), null, 'body');
  reachArm(c, 'L', _a.set(0.07, 1.3, 0.32), _b.set(1, -0.6, -0.2), _c.set(-0.2, 0.3, 1), null, 'body');
  grip(c, 'two');
}

// Running with it: high and tight (the ball against the ribs, the hand over its front tip, the
// elbow clamped on it), leaning into the run (speed m/s), the head up.
export function tuckCarry(c, speed = 0) {
  const lean = 0.08 + 0.2 * clamp01(speed / 7);
  bendSpine(c, lean, 0, 0);
  c.neck.rotation.set(-lean * 0.9, 0, 0);
  reachArm(c, 'R', _a.set(-0.21, 1.13, 0.37), _b.set(-1, -0.5, -0.6), _c.set(0.1, 0.2, 1), _d.set(-1, 0, 0), 'body');
  grip(c, 'tuck');
}

// The quarterback's throw. cock (0-1): the shoulders turning side-on, the ball coming back by
// the ear (the elbow up and out), the front arm pointing at the target, the front foot stepping;
// release (0-1, over ~0.4 s): the hips and chest whip round, the elbow leads, the forearm comes
// through and the arm follows through down across the body, the back shoulder ending forward.
export function throwPose(c, cock, release) {
  const k = ease(Math.min(1, cock));
  // (cocked: the upper arm out to the side and up, the forearm back up behind the head)
  let s = [mix(-0.7, -2.0, k), mix(0, -0.7, k), mix(-0.4, -1.9, k), mix(0, 0.5, k)];
  let g = [mix(-0.6, -1.5, k), mix(0, 0.15, k), mix(-0.4, -0.25, k), mix(0, 0.55, k)];
  // (the trunk: turned side-on (the throwing shoulder back), leaning back a touch, the back
  // shoulder dipped)
  let tw = -0.75 * k;
  let lean = -0.12 * k;
  let roll = 0.12 * k;
  if (release > 0) {
    const r = Math.min(1, release);
    const a = ease(Math.min(1, r / 0.35)); // (the whip forward)
    const b = ease(Math.max(0, (r - 0.35) / 0.65)); // (following through, down and across)
    s = [mix(mix(s[0], -2.4, a), -0.9, b), mix(mix(s[1], -0.2, a), 0.45, b), mix(mix(s[2], -0.2, a), -0.5, b), mix(mix(s[3], -0.6, a), -0.4, b)];
    g = [mix(g[0], -0.5, a), mix(g[1], -0.1, a), mix(g[2], -1.5, a), mix(g[3], 0, a)]; // (the front arm tucks in)
    tw = mix(mix(tw, 0.3, a), 0.55, b);
    lean = mix(mix(lean, 0.25, a), 0.45, b);
    roll = mix(mix(roll, -0.08, a), -0.12, b);
  }
  c.armR.rotation.set(s[0], 0, s[1]);
  c.elbowR.rotation.set(s[2], 0, 0);
  c.wristR.rotation.set(s[3], 0, 0);
  c.armL.rotation.set(g[0], g[3], g[1]); // (the front arm turned back toward the target)
  c.elbowL.rotation.set(g[2], 0, 0);
  c.wristL.rotation.set(0, 0, 0);
  bendSpine(c, lean, tw, roll);
  c.neck.rotation.set(-0.08 - lean * 0.4, -tw * 0.85, -roll * 0.5); // (eyes staying on the target)
  // (the step: front foot forward into the throw, back foot pushing)
  const st = release > 0 ? 1 : k;
  bendLeg(c.legL, c.kneeL, 0.45 * st, 0.25 * st);
  bendLeg(c.legR, c.kneeR, -0.25 * st, 0.35 * st);
  grip(c, release > 0.12 ? null : 'throw'); // (in the hand until it's let go)
}

// Hands up for a catch, thumbs (or pinkies) together: high for a lob, reaching, the chest up
// and the eyes up on it; chest high for a bullet, the shoulders over it.
export function catchPose(c, high) {
  const y = high ? 2.06 : 1.42;
  const z = high ? 0.32 : 0.5;
  bendSpine(c, high ? -0.18 : 0.12, 0, 0);
  c.neck.rotation.set(high ? -0.6 : -0.1, 0, 0);
  reachArm(c, 'R', _a.set(-0.08, y, z), _b.set(-1, -0.4, -0.2), _c.set(0, 1, high ? 0.15 : 0.6), _d.set(0, 0, 1), 'group');
  reachArm(c, 'L', _a.set(0.08, y, z), _b.set(1, -0.4, -0.2), _c.set(0, 1, high ? 0.15 : 0.6), _d.set(0, 0, 1), 'group');
}

// Laid out (a diving catch) or going down in a tackle: k 0..1 tipped forward onto the stomach.
// A dive stretches out, arms ahead, the back arched and the head up after the ball; a tackle
// curls round the ball. Returns the height change.
export function layoutPose(c, k, dive) {
  const e = ease(Math.min(1, k));
  c.group.rotation.x = (Math.PI / 2) * 0.95 * e;
  if (dive) {
    bendSpine(c, -0.3 * e, 0, 0);
    c.neck.rotation.set(-0.75 * e, 0, 0);
    c.armL.rotation.set(-2.95, 0, -0.12);
    c.armR.rotation.set(-2.95, 0, 0.12);
    c.elbowL.rotation.set(-0.15, 0, 0);
    c.elbowR.rotation.set(-0.15, 0, 0);
  } else {
    bendSpine(c, 0.3 * e, 0, 0.1 * e);
    c.neck.rotation.set(0.2 * e, 0.3 * e, 0);
    c.armL.rotation.set(-2.2, 0, -0.3);
    c.armR.rotation.set(-1.2, 0, 0.1);
    c.elbowL.rotation.set(-0.9, 0, 0);
    c.elbowR.rotation.set(-1.7, 0, 0);
  }
  c.legL.rotation.x = c.legR.rotation.x = 0;
  c.kneeL.rotation.x = c.kneeR.rotation.x = dive ? 0.3 : 0.6;
  // (tipped over at the feet the body already lies at the ground: lift it by its thickness so
  // it rests on the grass instead of sinking into it)
  return 0.2 * e;
}

// Juked: caught leaning the wrong way, twisted, the arms out for balance.
export function jukedPose(c, side = 1) {
  bendSpine(c, -0.2, 0.4 * side, 0.3 * side);
  c.neck.rotation.set(0.05, -0.45 * side, 0);
  c.armL.rotation.set(-1.7, 0, 0.6);
  c.armR.rotation.set(-0.6, 0, -0.7);
  c.elbowL.rotation.set(-0.3, 0, 0);
  c.elbowR.rotation.set(-0.4, 0, 0);
}

// A defender going up for the ball: stretched up after it on one arm, eyes on it.
export function reachBall(c) {
  bendSpine(c, -0.12, 0.15, 0.22);
  c.neck.rotation.set(-0.6, 0, 0);
  c.armL.rotation.set(-2.75, 0, 0.12);
  c.elbowL.rotation.set(-0.15, 0, 0);
  c.armR.rotation.set(-1.2, 0, -0.35);
  c.elbowR.rotation.set(-0.7, 0, 0);
}

// Where the ball is for the pose just set (world, into out), or null when it isn't in the hands.
// Call after the height change is applied (or add it to y).
export function fbBallAt(c, out) {
  const g = c.group.userData.fbGrip;
  if (!g) return null;
  c.group.updateMatrixWorld(true);
  if (g === 'throw') return c.wristR.localToWorld(out.set(0, -0.12, 0.04));
  if (g === 'tuck') return c.chest.localToWorld(out.set(-0.22, -0.1, 0.23));
  return twoHandBall(c, out);
}

// Running moves with the ball tucked (yours; k 0..1 through the move):
// a juke: the plant, the hips and shoulders thrown toward the cut (side +1 his right), the head
// faking the other way; a spin: low, the ball tucked, the head coming round first; a stiff-arm:
// the free arm locked out ahead, palm out, the shoulder driving into it.
export function jukePose(c, side, k, speed = 5) {
  tuckCarry(c, speed);
  const m = Math.sin(Math.PI * clamp01(k));
  bendSpine(c, 0.2 + 0.1 * m, side * 0.25 * m, -side * 0.35 * m);
  c.neck.rotation.set(-0.2, -side * 0.3 * m, side * 0.2 * m);
  bendLeg(side > 0 ? c.legL : c.legR, side > 0 ? c.kneeL : c.kneeR, 0.5 * m, 0.9 * m); // (the plant foot, loaded)
  (side > 0 ? c.legL : c.legR).rotation.z = side * 0.35 * m;
  c.armL.rotation.set(-0.5 - 0.6 * m, 0, 0.5 * m); // (the free arm out for balance)
}
export function spinPose(c, k) {
  tuckCarry(c, 5);
  const m = Math.sin(Math.PI * clamp01(k));
  bendSpine(c, 0.3 + 0.1 * m, 0.3 * m, 0);
  c.neck.rotation.set(-0.3, 0.5 * m, 0); // (the head round first)
  c.armL.rotation.set(-0.9, 0, 0.9 * m);
  c.elbowL.rotation.set(-1.2, 0, 0);
  bendLeg(c.legL, c.kneeL, 0.5 * m, 0.8 * m);
  bendLeg(c.legR, c.kneeR, 0.3 * m, 0.9 * m);
}
export function stiffArmPose(c, k, speed = 5) {
  tuckCarry(c, speed);
  const m = ease(clamp01(k / 0.3)) * (1 - ease(clamp01((k - 0.75) / 0.25)));
  bendSpine(c, 0.25 + 0.1 * m, -0.4 * m, 0);
  c.neck.rotation.set(-0.3, 0.3 * m, 0);
  reachArm(c, 'L', _a.set(mix(0.3, 0.12, m), mix(1.15, 1.35, m), mix(0.2, 0.78, m)), _b.set(1, -0.6, -0.2), _c.set(0, 0.6, 1), _d.set(0, 0, -1), 'body');
}
