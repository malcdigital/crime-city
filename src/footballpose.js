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
  return fbPose(c, { lower: ['qbSet'], upper: ['snap'] });
}
function qbSetLegs(c) {
  bendLeg(c.legL, c.kneeL, 0.75, 1.05);
  bendLeg(c.legR, c.kneeR, 0.75, 1.05);
  c.legL.rotation.z = 0.14;
  c.legR.rotation.z = -0.14;
  bendSpine(c, 0.45, 0, 0);
  return -lowestPoint(c);
}
function snapHands(c) {
  c.neck.rotation.set(-0.5, 0, 0); // (eyes downfield over the line)
  reachArm(c, 'R', _a.set(-0.07, 0.98, 0.45), _b.set(-1, -0.4, -0.3), _c.set(0, -0.5, 1), null, 'group');
  reachArm(c, 'L', _a.set(0.07, 0.98, 0.45), _b.set(1, -0.4, -0.3), _c.set(0, -0.5, 1), null, 'group');
  grip(c, 'two');
}

// A receiver's two-point stance: the outside foot up, leaning over it, head up, arms cocked to
// drive off the line.
export function wrStance(c) {
  return fbPose(c, { lower: ['wrSet'], upper: ['wrReady'] });
}
function wrSetLegs(c) {
  // (set, not running: the feet a short stagger apart, knees bent, bent at the waist)
  bendLeg(c.legL, c.kneeL, 0.55, 0.8);
  bendLeg(c.legR, c.kneeR, 0.15, 0.55);
  bendSpine(c, 0.6, 0, 0);
  return -lowestPoint(c);
}
function wrReady(c) {
  // (both hands hanging low in front, still; head up)
  c.neck.rotation.set(-0.7, 0, 0);
  c.armL.rotation.set(-0.45, 0, 0.08);
  c.armR.rotation.set(-0.5, 0, -0.08);
  c.elbowL.rotation.set(-0.55, 0, 0);
  c.elbowR.rotation.set(-0.55, 0, 0);
}

// A defender's stance: wide, low, the hands loose in front, eyes up.
export function dbStance(c) {
  return fbPose(c, { lower: ['dbSet'], upper: ['dbReady'] });
}
function dbSetLegs(c) {
  bendLeg(c.legL, c.kneeL, 0.65, 1.05);
  bendLeg(c.legR, c.kneeR, 0.65, 1.05);
  c.legL.rotation.z = 0.2;
  c.legR.rotation.z = -0.2;
  bendSpine(c, 0.35, 0, 0);
  return -lowestPoint(c);
}
function dbReady(c) {
  c.neck.rotation.set(-0.35, 0, 0);
  c.armL.rotation.set(-0.55, 0, 0.12);
  c.armR.rotation.set(-0.55, 0, -0.12);
  c.elbowL.rotation.set(-1.0, 0, 0);
  c.elbowR.rotation.set(-1.0, 0, 0);
}

// In the pocket: two hands on the ball high at the chest, elbows in; look (-1..1, + his left)
// turns the head and shoulders to scan.
// still: standing in the pocket (not dropping back or moving): the base under it, feet out to
// shoulder width, knees soft, the front (left) foot a half step ahead, the weight on the balls
// of the feet, the feet alive (a light quick shuffle, now: seconds). Returns the height change.
export function holdBall(c, look = 0, still = true, now = 0) {
  return fbPose(c, { lower: still ? ['set', now] : ['run'], upper: ['hold', look] });
}
function holdHands(c, look = 0) {
  bendUpper(c, 0.16, look * 0.3, 0);
  c.neck.rotation.set(-0.08, look * 0.6, 0);
  reachArm(c, 'R', _a.set(-0.07, 1.3, 0.32), _b.set(-1, -0.6, -0.2), _c.set(0.2, 0.3, 1), null, 'body');
  reachArm(c, 'L', _a.set(0.07, 1.3, 0.32), _b.set(1, -0.6, -0.2), _c.set(-0.2, 0.3, 1), null, 'body');
  grip(c, 'two');
}
// (set: feet out to shoulder width, knees soft, the front (left) foot a half step ahead, alive
// on the toes, one foot then the other)
function setLegs(c, now = 0) {
  const hop = Math.max(0, Math.sin(now * 9)) * 0.06;
  const hop2 = Math.max(0, -Math.sin(now * 9)) * 0.06;
  bendLeg(c.legL, c.kneeL, 0.42 + hop, 0.55 + hop * 2);
  bendLeg(c.legR, c.kneeR, 0.18 + hop2, 0.55 + hop2 * 2);
  c.legL.rotation.z = 0.24;
  c.legR.rotation.z = -0.24;
  return -lowestPoint(c);
}

// In the pocket, the way a quarterback really stands there (you and theirs): side-on, the front
// (left) shoulder at the target and the body turned POCKET_CLOSE away from it (the caller turns
// the body: its facing minus POCKET_CLOSE), the head round on the target; the ball high at the
// chest by the back shoulder in both hands; a base a little wider than the shoulders, knees soft,
// the weight on the balls of the feet. Moving he doesn't run: short shuffle steps, one foot then
// the other (step: the stepping phase, the caller moves it on with distance and with turning to
// a new target; moving 0..1). look (-1..1) scans a little. Returns the height change.
export const POCKET_CLOSE = 1.0;
export function pocketStance(c, look = 0, step = 0, moving = 0) {
  return fbPose(c, { lower: ['pocket', step, moving], upper: ['pocketHands', look] });
}
function pocketHands(c, look = 0) {
  bendUpper(c, 0.16, 0.32 + look * 0.15, 0); // (the chest a little round toward the target)
  c.neck.rotation.set(-0.08, 0.62 + look * 0.3, 0); // (the eyes on it)
  reachArm(c, 'R', _a.set(-0.15, 1.3, 0.25), _b.set(-1, -0.6, -0.3), _c.set(0.25, 0.3, 1), null, 'body');
  reachArm(c, 'L', _a.set(-0.03, 1.31, 0.33), _b.set(1, -0.6, -0.2), _c.set(-0.15, 0.3, 1), null, 'body');
  grip(c, 'two');
}
function pocketLegs(c, step = 0, moving = 0) {
  const m = clamp01(moving);
  const sL = Math.max(0, Math.sin(step)) * m; // (the left foot up and across)
  const sR = Math.max(0, -Math.sin(step)) * m;
  const alive = (1 - m) * 0.03 * Math.sin(step * 0.5); // (standing: the feet alive)
  bendLeg(c.legL, c.kneeL, 0.38 + 0.3 * sL + alive, 0.62 + 0.7 * sL);
  bendLeg(c.legR, c.kneeR, 0.38 + 0.3 * sR - alive, 0.62 + 0.7 * sR);
  c.legL.rotation.z = 0.3 - 0.1 * sL; // (a little wider than the shoulders; the stepping foot comes in a touch)
  c.legR.rotation.z = -0.3 + 0.1 * sR;
  return -lowestPoint(c);
}

// Turning in the pocket by steps, not by gliding round on the spot (you: gridiron.js pocketPose;
// their quarterback: football.js). Each frame: where he wants to face (a yaw), how far he moved
// and the time. Off by more than about 7°, he takes a step: up to 40° of the turn with one foot
// (the one on the side he's turning to first, opening up), the body coming round with it, then
// the next with the other foot, till he's square to it. Shuffling, the steps go with the
// distance. Gives the yaw to stand at and the stepping phase / amount for pocketLegs.
export const POCKET_STICK = 0.45; // (the stick in the pocket (the drive, the QB Challenge): a shuffle, about 1.9 m/s, not a walk)
const TURN_MIN = 0.12;
const TURN_MAX = 0.7;
export class PocketFeet {
  constructor() {
    this.yaw = null;
    this.step = 0;
    this.turn = null;
  }
  update(face, moved, dt) {
    if (this.yaw == null) this.yaw = face;
    this.clock = (this.clock || 0) + dt;
    const diff = Math.atan2(Math.sin(face - this.yaw), Math.cos(face - this.yaw));
    if (!this.turn && Math.abs(diff) > TURN_MIN) {
      const by = Math.sign(diff) * Math.min(Math.abs(diff), TURN_MAX);
      // (the foot on the turning side first: +yaw turns him to his left, the left foot lifts on
      // an even half of the stepping phase; carrying on round the same way, the other foot next)
      const n = Math.round(this.step / Math.PI);
      const even = ((n % 2) + 2) % 2 === 0;
      const going = this.last && this.clock - this.last.at < 0.2 && Math.sign(this.last.by) === Math.sign(by);
      const ph = going || (by > 0) === even ? n * Math.PI : (n + 1) * Math.PI;
      this.turn = { from: this.yaw, by, t: 0, T: 0.13 + 0.12 * (Math.abs(by) / TURN_MAX), ph };
    }
    let lift = 0;
    if (this.turn) {
      const T = this.turn;
      T.t += dt;
      const k = Math.min(1, T.t / T.T);
      this.yaw = T.from + T.by * ease(k);
      this.step = T.ph + Math.PI * k; // (one foot up, round and down)
      lift = 1;
      if (k >= 1) {
        this.turn = null;
        this.last = { at: this.clock, by: T.by };
      }
    }
    this.step += moved * 5; // (shuffling: a step every 30 cm or so)
    return { yaw: this.yaw, step: this.step, moving: Math.min(1, (dt > 0 ? moved / dt : 0) / 1.4 + lift) };
  }
}

// Running with it: high and tight (the ball against the ribs, the hand over its front tip, the
// elbow clamped on it), leaning into the run (speed m/s), the head up.
// (the five points of a good carry: the nose in the palm, fingers over the front tip, the ball
// along the forearm, the back tip pinned in the crook of the elbow against the ribs, carried high
// on the outside of the body; the elbow tucked back and down)
export function tuckCarry(c, speed = 0) {
  return fbPose(c, { upper: ['tuck', speed] });
}
function tuckArm(c, speed = 0) {
  const lean = 0.08 + 0.2 * clamp01(speed / 7);
  bendUpper(c, lean, 0, 0);
  c.neck.rotation.set(-lean * 0.9, 0, 0);
  reachArm(c, 'R', _a.set(-0.29, 1.27, 0.3), _b.set(-0.3, -0.75, -1), _c.set(0.35, 0.05, 1), _d.set(-0.6, 1, 0), 'body');
  grip(c, 'tuck');
}

// Picking the ball up off the grass (yours and theirs), k 0..1 over about 0.6 s: down into a
// crouch over it, the head down on it, both hands scooping it (the ball's still on the ground
// till halfway), then up and out of it with the ball at the chest. Returns the height change.
export const PICK_T = 0.6;
export function pickupPose(c, k) {
  const e = Math.sin(Math.PI * clamp01(k));
  bendLeg(c.legL, c.kneeL, 0.35 + 0.95 * e, 0.35 + 1.45 * e); // (the left foot a half step up)
  bendLeg(c.legR, c.kneeR, 0.1 + 0.85 * e, 0.3 + 1.6 * e);
  c.legL.rotation.z = 0.1 * e;
  c.legR.rotation.z = -0.12 * e;
  bendSpine(c, 0.2 + 0.85 * e, 0, 0);
  c.neck.rotation.set(0.25 * e, 0, 0); // (eyes down on it)
  const y = 0.98 - 0.62 * e;
  reachArm(c, 'R', _a.set(-0.1, y, 0.42 + 0.08 * e), _b.set(-1, -0.4, -0.3), _c.set(0.1, -1, 0.4), null, 'group');
  reachArm(c, 'L', _a.set(0.1, y, 0.42 + 0.08 * e), _b.set(1, -0.4, -0.3), _c.set(-0.1, -1, 0.4), null, 'group');
  grip(c, k < 0.5 ? null : 'two');
  return -lowestPoint(c);
}

// The quarterback's throw. cock (0-1): the shoulders turning side-on, the ball coming back by
// the ear (the elbow up and out), the front arm pointing at the target, the front foot stepping;
// release (0-1, over ~0.4 s): the hips and chest whip round, the elbow leads, the forearm comes
// through and the arm follows through down across the body, the back shoulder ending forward.
export function throwPose(c, cock, release) {
  return fbPose(c, { lower: ['step', release > 0 ? 1 : ease(Math.min(1, cock))], upper: ['throw', cock, release] });
}
function throwArm(c, cock, release) {
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
  bendUpper(c, lean, tw, roll);
  c.neck.rotation.set(-0.08 - lean * 0.4, -tw * 0.85, -roll * 0.5); // (eyes staying on the target)
  grip(c, release > 0.12 ? null : 'throw'); // (in the hand until it's let go)
}
// (the step: front foot forward into the throw, back foot pushing; st 0..1)
function stepLegs(c, st) {
  bendLeg(c.legL, c.kneeL, 0.45 * st, 0.25 * st);
  bendLeg(c.legR, c.kneeR, -0.25 * st, 0.35 * st);
  return 0;
}

// Hands up for a catch, thumbs (or pinkies) together: high for a lob, reaching, the chest up
// and the eyes up on it; chest high for a bullet, the shoulders over it.
export function catchPose(c, high) {
  return fbPose(c, { upper: ['catch', high] });
}
function catchHands(c, high) {
  const y = high ? 2.06 : 1.42;
  const z = high ? 0.32 : 0.5;
  bendUpper(c, high ? -0.18 : 0.12, 0, 0);
  c.neck.rotation.set(high ? -0.6 : -0.1, 0, 0);
  reachArm(c, 'R', _a.set(-0.08, y, z), _b.set(-1, -0.4, -0.2), _c.set(0, 1, high ? 0.15 : 0.6), _d.set(0, 0, 1), 'group');
  reachArm(c, 'L', _a.set(0.08, y, z), _b.set(1, -0.4, -0.2), _c.set(0, 1, high ? 0.15 : 0.6), _d.set(0, 0, 1), 'group');
}

// ---- Celebrations (the drive's end: drivecine.js; yours and theirs, the same) ----
// The Griddy (t: seconds into it): a hop and a heel tap out in front on alternate feet each beat,
// the arms pumping opposite at the sides, elbows bent, a little sway; every eighth and seventh
// beat of eight, both hands up to the eyes for the goggles. Returns the height.
export const GRIDDY_BEAT = 0.4;
export function griddyPose(c, t) {
  const beat = t / GRIDDY_BEAT;
  const i = Math.floor(beat);
  const f = beat - i;
  const side = i % 2 ? 1 : -1; // (the tapping foot: +1 his left)
  const goggles = i % 8 >= 6;
  const tap = Math.sin(f * Math.PI); // (out and back within the beat)
  const tapHip = 0.15 + 0.75 * tap; // (kicked out in front, the leg near straight, the heel down)
  const tapKnee = 0.6 - 0.55 * tap;
  const [hl, kl, hr, kr] = side > 0 ? [tapHip, tapKnee, 0.3, 0.6] : [0.3, 0.6, tapHip, tapKnee];
  bendLeg(c.legL, c.kneeL, hl, kl);
  bendLeg(c.legR, c.kneeR, hr, kr);
  bendSpine(c, 0.18, 0.28 * side * tap, -0.08 * side * tap);
  c.neck.rotation.set(goggles ? -0.15 : -0.05, -0.25 * side * tap, 0);
  if (goggles) {
    // (the goggles: fingers ringed round the eyes, elbows out)
    reachArm(c, 'L', _a.set(0.09, 1.8, 0.24), _b.set(1, 0.1, -0.3), null, null, 'group');
    reachArm(c, 'R', _a.set(-0.09, 1.8, 0.24), _b.set(-1, 0.1, -0.3), null, null, 'group');
  } else {
    const sw = Math.sin(beat * Math.PI);
    c.armL.rotation.set(-0.45 - 0.75 * sw, 0, -0.18);
    c.armR.rotation.set(-0.45 + 0.75 * sw, 0, 0.18);
    c.elbowL.rotation.set(-1.65, 0, 0);
    c.elbowR.rotation.set(-1.65, 0, 0);
  }
  return -lowestPoint(c) + Math.abs(Math.sin(f * Math.PI)) * 0.09;
}

// A quarterback after a turnover (t: seconds in, it loops): hands up on top of the head looking
// at the sky, then bent over with the hands on the knees, then back up shaking his head, arms
// hanging. Eased from one to the next. Returns the height.
const UPSET = [
  // [time, armX, armZ, elbowX, hip, knee, spineX, neckX, shake]
  [0, -2.6, 0.55, -2.35, 0.05, 0.08, -0.12, -0.45, 0],
  [1.3, -2.6, 0.55, -2.35, 0.05, 0.08, -0.12, -0.45, 0],
  [1.8, -0.55, 0.12, -0.25, 0.55, 0.9, 0.75, 0.15, 0],
  [3.0, -0.55, 0.12, -0.25, 0.55, 0.9, 0.75, 0.15, 0],
  [3.5, 0.05, 0.08, -0.25, 0.05, 0.08, 0.1, 0.25, 1],
  [4.6, 0.05, 0.08, -0.25, 0.05, 0.08, 0.1, 0.25, 1],
  [5.0, -2.6, 0.55, -2.35, 0.05, 0.08, -0.12, -0.45, 0],
];
export function upsetPose(c, t) {
  const T = UPSET[UPSET.length - 1][0];
  const u = t % T;
  let k = 0;
  while (k < UPSET.length - 2 && u > UPSET[k + 1][0]) k++;
  const A = UPSET[k];
  const B = UPSET[k + 1];
  const e = ease(Math.min(1, (u - A[0]) / Math.max(0.01, B[0] - A[0])));
  const v = (j) => A[j] + (B[j] - A[j]) * e;
  bendLeg(c.legL, c.kneeL, v(4), v(5));
  bendLeg(c.legR, c.kneeR, v(4), v(5));
  bendSpine(c, v(6), 0, 0);
  c.neck.rotation.set(v(7), Math.sin(t * 9) * 0.45 * v(8), 0);
  c.armL.rotation.set(v(1), 0, -v(2));
  c.armR.rotation.set(v(1), 0, v(2));
  c.elbowL.rotation.set(v(3), 0, 0);
  c.elbowR.rotation.set(v(3), 0, 0);
  return -lowestPoint(c);
}

// Reaching back for a ball thrown behind him, still running: twisted toward it (side +1: his
// left, -1: his right), the near hand back and up behind the shoulder, the other across for it,
// head turned back after it.
export function reachBackPose(c, side) {
  return fbPose(c, { upper: ['reachBack', side] });
}
function reachBackArms(c, side) {
  bendUpper(c, 0.1, 1.0 * side, 0.12 * side);
  c.neck.rotation.set(-0.3, 0.9 * side, 0);
  const near = side > 0 ? 'L' : 'R';
  const far = side > 0 ? 'R' : 'L';
  // (the near hand out and back behind the shoulder, palm toward the ball; the far one across
  // the chest after it)
  reachArm(c, near, _a.set(0.55 * side, 1.5, -0.55), _b.set(side, -0.6, 0.3), _c.set(0.4 * side, 0.3, -1), _d.set(0, 1, 0), 'group');
  reachArm(c, far, _a.set(0.32 * side, 1.38, -0.12), _b.set(-side, -0.6, 0.4), _c.set(0.5 * side, 0.2, -0.8), _d.set(0, 1, 0), 'group');
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

// Tackled (the runner, k 0..1 down): hit from behind he pitches forward onto his front, arms
// thrown out ahead to break the fall; hit head on he's driven back onto his back, legs up, arms
// flung up; hit from the side (side +1: from his left) he's rolled over onto his side, the
// near arm wrapped by the tackler, the other reaching for the ground. Returns the height.
export function tackledPose(c, k, from, side = 1) {
  const e = ease(Math.min(1, k));
  c.group.rotation.z = 0;
  if (from === 'behind') {
    c.group.rotation.x = (Math.PI / 2) * 0.95 * e;
    bendSpine(c, -0.15 * e, 0, 0);
    c.neck.rotation.set(-0.6 * e, 0.25, 0);
    c.armL.rotation.set(-2.5, 0, -0.35);
    c.armR.rotation.set(-2.5, 0, 0.35);
    c.elbowL.rotation.set(-0.5, 0, 0);
    c.elbowR.rotation.set(-0.5, 0, 0);
    bendLeg(c.legL, c.kneeL, 0.1 * e, 0.4 * e);
    bendLeg(c.legR, c.kneeR, -0.15 * e, 0.2 * e);
    return 0.2 * e;
  }
  if (from === 'front') {
    c.group.rotation.x = -(Math.PI / 2) * 0.9 * e;
    bendSpine(c, 0.35 * e, 0, 0); // (curled up round it)
    c.neck.rotation.set(0.45 * e, 0, 0);
    c.armL.rotation.set(-1.4 - 1.2 * e, 0, -0.6);
    c.armR.rotation.set(-0.9, 0, 0.25); // (the ball arm, still tucked)
    c.elbowL.rotation.set(-0.4, 0, 0);
    c.elbowR.rotation.set(-1.9, 0, 0);
    bendLeg(c.legL, c.kneeL, 0.9 * e, 1.0 * e);
    bendLeg(c.legR, c.kneeR, 0.6 * e, 0.6 * e);
    return 0.22 * e;
  }
  // (the side: rolled away from the hit)
  c.group.rotation.x = 0.15 * e;
  c.group.rotation.z = side * (Math.PI / 2) * 0.92 * e; // (+z rolls him onto his right: away from a hit on his left)
  bendSpine(c, 0.25 * e, 0, 0.2 * side * e);
  c.neck.rotation.set(-0.2 * e, 0, 0.3 * side * e);
  const near = side > 0 ? 'L' : 'R';
  const far = side > 0 ? 'R' : 'L';
  c['arm' + near].rotation.set(-0.9, 0, side * 0.2);
  c['elbow' + near].rotation.set(-1.6, 0, 0);
  c['arm' + far].rotation.set(-1.0, 0, -side * 1.25 * e); // (out for the ground)
  c['elbow' + far].rotation.set(-0.3, 0, 0);
  bendLeg(c.legL, c.kneeL, 0.45 * e, 0.8 * e);
  bendLeg(c.legR, c.kneeR, 0.2 * e, 0.5 * e);
  return 0.24 * e;
}

// The tackler (k 0..1 through it): launching into him low, head across, arms wrapping round,
// then down on top of him, face down. Returns the height.
export function tacklerPose(c, k) {
  const e = ease(Math.min(1, k));
  c.group.rotation.z = 0;
  c.group.rotation.x = (Math.PI / 2) * 0.9 * e;
  bendSpine(c, 0.25, 0, 0);
  c.neck.rotation.set(-0.5, 0.2, 0);
  // (the wrap: both arms forward and in, elbows bent round him)
  c.armL.rotation.set(-1.6, 0, 0.55);
  c.armR.rotation.set(-1.6, 0, -0.55);
  c.elbowL.rotation.set(-1.2, 0, 0);
  c.elbowR.rotation.set(-1.2, 0, 0);
  bendLeg(c.legL, c.kneeL, -0.2 * e, 0.3);
  bendLeg(c.legR, c.kneeR, 0.1 * e, 0.6);
  return 0.24 * e;
}

// ---- The ball in the air, contested (the drive: drivereads.js) ----
// A defender's interception (k 0..1 over about 0.9 s): gathers, leaps with both hands high to
// snatch it at the top, then brings it down and tucks it as he lands. Returns the height.
export function pickPose(c, k) {
  const up = Math.sin(Math.min(1, k / 0.75) * Math.PI); // (the leap: off the ground and back)
  const hi = k < 0.5;
  bendLeg(c.legL, c.kneeL, 0.35 + 0.3 * (1 - up), 0.4 + 0.5 * (1 - up));
  bendLeg(c.legR, c.kneeR, 0.1 + 0.5 * up, 0.9 * up);
  if (hi) {
    bendSpine(c, -0.2, 0, 0);
    c.neck.rotation.set(-0.7, 0, 0);
    reachArm(c, 'L', _a.set(0.1, 2.25, 0.25), _b.set(1, 0, -0.2), null, null, 'group');
    reachArm(c, 'R', _a.set(-0.1, 2.25, 0.25), _b.set(-1, 0, -0.2), null, null, 'group');
  } else {
    // (brought down into the body, both hands over it)
    const e = ease((k - 0.5) / 0.5);
    bendSpine(c, 0.3 * e, 0, 0);
    c.neck.rotation.set(-0.2, 0, 0);
    reachArm(c, 'L', _a.set(0.06, 2.1 - 0.85 * e, 0.3 - 0.05 * e), _b.set(1, -0.3, -0.2), null, null, 'group');
    reachArm(c, 'R', _a.set(-0.06, 2.1 - 0.85 * e, 0.3 - 0.05 * e), _b.set(-1, -0.3, -0.2), null, null, 'group');
  }
  return -lowestPoint(c) + 0.55 * up;
}

// The catches (picks and your receivers' both): how long each takes and how far in (s) the ball's
// in his hands, at the top of the leap, out in front, over the shoulder, down at the turf.
export const CATCHES = { pick: { T: 0.9, lead: 0.34 }, pickRun: { T: 0.7, lead: 0.3 }, pickShoulder: { T: 0.9, lead: 0.48 }, pickScoop: { T: 0.8, lead: 0.32 } };

// Jumping the route (k 0..1 over about 0.7 s): running, he drives his hands out in front at chest
// height, takes it on the run and pulls it straight into the tuck. Upper body only: the legs run.
export function pickUndercutPose(c, k) {
  return fbPose(c, { upper: ['catchRun', k] });
}
function catchRunArms(c, k) {
  const e = ease(Math.min(1, k / 0.45));
  const g = ease(Math.max(0, (k - 0.45) / 0.55));
  bendUpper(c, 0.32 - 0.1 * g, 0, 0);
  c.neck.rotation.set(-0.35 + 0.2 * g, 0, 0);
  const z = 0.55 * e - 0.3 * g;
  const y = 1.32 - 0.15 * g;
  reachArm(c, 'L', _a.set(0.1, y, 0.15 + z), _b.set(1, -0.4, -0.2), null, null, 'group');
  reachArm(c, 'R', _a.set(-0.1, y, 0.15 + z), _b.set(-1, -0.4, -0.2), null, null, 'group');
}

// Over the shoulder (k 0..1 over about 0.9 s; side +1: it's coming over his left): still running,
// shoulders turned back toward it, head round looking for it, both hands up and back on that
// side, then brought down into the tuck. Upper body only.
export function pickShoulderPose(c, k, side = 1) {
  return fbPose(c, { upper: ['catchShoulder', k, side] });
}
function catchShoulderArms(c, k, side = 1) {
  const e = ease(Math.min(1, k / 0.55));
  const g = ease(Math.max(0, (k - 0.55) / 0.45));
  const tw = (1 - g) * e;
  bendUpper(c, 0.05, 0.65 * side * tw, 0.08 * side * tw);
  c.neck.rotation.set(-0.45 * tw, 0.9 * side * tw, 0);
  const x = 0.32 * side * (1 - g) + 0.06 * side;
  const y = 1.95 - 0.7 * g;
  const z = -0.15 * (1 - g) + 0.28 * g;
  reachArm(c, 'L', _a.set(x + 0.09, y, z), _b.set(1, 0, 0.2), null, null, 'group');
  reachArm(c, 'R', _a.set(x - 0.09, y, z), _b.set(-1, 0, 0.2), null, null, 'group');
}

// Scooping a low one (k 0..1 over about 0.8 s): sinks at the knees and the waist, both hands down
// under it just off the turf, then comes back up with it to the chest. Returns the height.
export function pickScoopPose(c, k) {
  const d = Math.sin(Math.min(1, k / 0.8) * Math.PI); // (down and back up)
  bendLeg(c.legL, c.kneeL, 0.2 + 0.9 * d, 0.3 + 1.3 * d);
  bendLeg(c.legR, c.kneeR, 0.1 + 0.5 * d, 0.2 + 0.8 * d);
  bendSpine(c, 0.15 + 0.85 * d, 0, 0);
  c.neck.rotation.set(-0.5 * d, 0, 0);
  const y = 1.25 - 0.95 * d;
  reachArm(c, 'L', _a.set(0.1, y, 0.35 + 0.15 * d), _b.set(1, -0.3, -0.3), null, null, 'group');
  reachArm(c, 'R', _a.set(-0.1, y, 0.35 + 0.15 * d), _b.set(-1, -0.3, -0.3), null, null, 'group');
  return -lowestPoint(c);
}

// A defender breaking it up (k 0..1 over about 0.7 s): a jump with the near arm (side +1: his
// left) cocked high, swatting down and across through the ball, the other arm out for balance.
export function swatPose(c, k, side = 1) {
  const up = Math.sin(Math.min(1, k / 0.8) * Math.PI);
  const sw = ease(Math.min(1, Math.max(0, (k - 0.25) / 0.35))); // (the swat itself)
  bendLeg(c.legL, c.kneeL, 0.2 + 0.4 * up, 0.3 + 0.6 * up);
  bendLeg(c.legR, c.kneeR, 0.4 * (1 - up), 0.5 * (1 - up));
  bendSpine(c, -0.1 + 0.35 * sw, 0.3 * side * sw, 0);
  c.neck.rotation.set(-0.55 + 0.3 * sw, 0, 0);
  const n = side > 0 ? 'L' : 'R';
  const o = side > 0 ? 'R' : 'L';
  reachArm(c, n, _a.set(0.25 * side - 0.4 * side * sw, 2.3 - 0.9 * sw, 0.15 + 0.35 * sw), _b.set(side, 0, -0.3), null, null, 'group');
  c['arm' + o].rotation.set(-0.8, 0, -side * 0.7);
  c['elbow' + o].rotation.set(-0.5, 0, 0);
  return -lowestPoint(c) + 0.4 * up;
}

// A receiver beaten to it (k 0..1 over about 0.7 s): both hands up for it, then they drop and
// open out as it's gone, head going back. (Caught, he secures it into his chest: holdBall.)
export function deniedPose(c, k) {
  return fbPose(c, { upper: ['denied', k] });
}
function deniedArms(c, k) {
  const e = ease(Math.min(1, k / 0.45));
  const g = ease(Math.max(0, (k - 0.45) / 0.55));
  bendUpper(c, -0.15 + 0.1 * g, 0, 0);
  c.neck.rotation.set(-0.6 + 0.2 * g, 0, 0);
  const y = 2.0 - 0.7 * g;
  reachArm(c, 'L', _a.set(0.12 + 0.35 * g, y, 0.3), _b.set(1, -0.2, -0.2), null, null, 'group');
  reachArm(c, 'R', _a.set(-0.12 - 0.35 * g, y, 0.3), _b.set(-1, -0.2, -0.2), null, null, 'group');
  void e;
}

// Juked: caught leaning the wrong way, twisted, the arms out for balance.
export function jukedPose(c, side = 1) {
  return fbPose(c, { upper: ['juked', side] });
}
function jukedArms(c, side = 1) {
  bendUpper(c, -0.2, 0.4 * side, 0.3 * side);
  c.neck.rotation.set(0.05, -0.45 * side, 0);
  c.armL.rotation.set(-1.7, 0, 0.6);
  c.armR.rotation.set(-0.6, 0, -0.7);
  c.elbowL.rotation.set(-0.3, 0, 0);
  c.elbowR.rotation.set(-0.4, 0, 0);
}

// A defender going up for the ball: stretched up after it on one arm, eyes on it.
export function reachBall(c) {
  return fbPose(c, { upper: ['reachBall'] });
}
function reachBallArms(c) {
  bendUpper(c, -0.12, 0.15, 0.22);
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
  if (g === 'tuck') {
    // (cradled along the forearm, just inside it, between it and the ribs)
    c.elbowR.getWorldPosition(_e1);
    c.wristR.getWorldPosition(_e2);
    // (resting on top of the forearm, the front of it in the hand, against the front of the ribs)
    const sc = c.group.scale.y || 1;
    out.lerpVectors(_e1, _e2, 0.62);
    _e3.set(0, 0.11 * sc, 0.04 * sc).applyQuaternion(c.chest.getWorldQuaternion(_q1));
    return out.add(_e3);
  }
  return twoHandBall(c, out);
}
// The ball's lie for the grip: tucked, along the forearm (its long axis is z); otherwise null
// (the caller keeps it square to the carrier).
export function fbBallQuat(c, q) {
  if (c.group.userData.fbGrip !== 'tuck') return null;
  c.elbowR.getWorldPosition(_e1);
  c.wristR.getWorldPosition(_e2);
  return q.setFromUnitVectors(_e5.set(0, 0, 1), _e2.sub(_e1).normalize());
}
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _e4 = new THREE.Vector3();
const _e5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

// Running moves with the ball tucked (yours; k 0..1 through the move):
// a juke: the plant, the hips and shoulders thrown toward the cut (side +1 his right), the head
// faking the other way; a spin: low, the ball tucked, the head coming round first; a stiff-arm:
// the free arm locked out ahead, palm out, the shoulder driving into it.
export function jukePose(c, side, k, speed = 5) {
  return fbPose(c, { lower: ['plant', side, k], upper: ['juke', side, k, speed] });
}
// (the plant foot, loaded; the other leg runs on)
function plantLeg(c, side, k) {
  const m = Math.sin(Math.PI * clamp01(k));
  bendLeg(side > 0 ? c.legL : c.legR, side > 0 ? c.kneeL : c.kneeR, 0.5 * m, 0.9 * m);
  (side > 0 ? c.legL : c.legR).rotation.z = side * 0.35 * m;
  return 0;
}
function jukeArms(c, side, k, speed = 5) {
  const m = Math.sin(Math.PI * clamp01(k));
  tuckArm(c, speed);
  c.spine.rotation.set(0, 0, 0); // (the move's own bend, not the carry's on top of it)
  c.chest.rotation.set(0, 0, 0);
  bendUpper(c, 0.2 + 0.1 * m, side * 0.25 * m, -side * 0.35 * m);
  c.neck.rotation.set(-0.2, -side * 0.3 * m, side * 0.2 * m);
  c.armL.rotation.set(-0.5 - 0.6 * m, 0, 0.5 * m); // (the free arm out for balance)
}
export function spinPose(c, k) {
  return fbPose(c, { full: ['spin', k] });
}
function spinBody(c, k) {
  tuckArm(c, 5);
  const m = Math.sin(Math.PI * clamp01(k));
  bendSpine(c, 0.3 + 0.1 * m, 0.3 * m, 0);
  c.neck.rotation.set(-0.3, 0.5 * m, 0); // (the head round first)
  c.armL.rotation.set(-0.9, 0, 0.9 * m);
  c.elbowL.rotation.set(-1.2, 0, 0);
  bendLeg(c.legL, c.kneeL, 0.5 * m, 0.8 * m);
  bendLeg(c.legR, c.kneeR, 0.3 * m, 0.9 * m);
}
export function stiffArmPose(c, k, speed = 5) {
  return fbPose(c, { upper: ['stiffArm', k, speed] });
}
function stiffArmArms(c, k, speed = 5) {
  tuckArm(c, speed);
  const m = ease(clamp01(k / 0.3)) * (1 - ease(clamp01((k - 0.75) / 0.25)));
  c.spine.rotation.set(0, 0, 0);
  c.chest.rotation.set(0, 0, 0);
  bendUpper(c, 0.25 + 0.1 * m, -0.4 * m, 0);
  c.neck.rotation.set(-0.3, 0.3 * m, 0);
  reachArm(c, 'L', _a.set(mix(0.3, 0.12, m), mix(1.15, 1.35, m), mix(0.2, 0.78, m)), _b.set(1, -0.6, -0.2), _c.set(0, 0.6, 1), _d.set(0, 0, -1), 'body');
}

// ---- The layers ----
// Every football pose is either a lower body and an upper body put together, or a whole-body
// move that takes both. You and everybody else are posed through fbPose, so a catch, a throw or
// a carry goes with whatever the legs are doing, running, set, in a stance, in the pocket:
//   lower   the legs, the lean at the waist and the height (what gets the feet on the grass).
//           'run' leaves the legs to the walk/run cycle that's already on them.
//   upper   the chest, the head and the arms (and where the ball is). Never the legs or the
//           height; its bend adds onto the lower's lean (bendUpper).
//   full    leaps, dives, falls, tackles, scoops, pick-ups and celebrations: the whole body.
// fbPose(c, { lower: [name, ...args], upper: [name, ...args] }) or fbPose(c, { full: [...] });
// returns the height change.
export const LOWER = {
  run: () => 0,
  set: setLegs, // (standing set: feet shoulder width, alive on the toes)
  pocket: pocketLegs, // (the pocket's base and its shuffle)
  qbSet: qbSetLegs,
  wrSet: wrSetLegs,
  dbSet: dbSetLegs,
  step: stepLegs, // (stepping into a throw)
  plant: plantLeg, // (a juke's plant foot)
};
export const UPPER = {
  huddle: huddleHands,
  snap: snapHands,
  wrReady,
  dbReady,
  hold: holdHands,
  pocketHands,
  tuck: tuckArm,
  throw: throwArm,
  catch: catchHands,
  reachBack: reachBackArms,
  catchRun: catchRunArms,
  catchShoulder: catchShoulderArms,
  denied: deniedArms,
  juked: jukedArms,
  reachBall: reachBallArms,
  juke: jukeArms,
  stiffArm: stiffArmArms,
};
export const FULL = {
  leap: pickPose,
  scoop: pickScoopPose,
  swat: swatPose,
  pickup: pickupPose,
  layout: layoutPose,
  tackled: tackledPose,
  tackler: tacklerPose,
  spin: spinBody,
  griddy: griddyPose,
  upset: upsetPose,
};
export function fbPose(c, L) {
  c.spine.rotation.set(0, 0, 0);
  c.chest.rotation.set(0, 0, 0);
  if (L.full) return FULL[L.full[0]](c, ...L.full.slice(1)) || 0;
  const y = L.lower ? LOWER[L.lower[0]](c, ...L.lower.slice(1)) || 0 : 0;
  if (L.upper) UPPER[L.upper[0]](c, ...L.upper.slice(1));
  return y;
}
// In the huddle: bent well over (whatever the legs had), hands on the knees.
function huddleHands(c) {
  bendSpine(c, 0.5, 0, 0);
  c.armL.rotation.x = c.armR.rotation.x = -0.55;
  c.elbowL.rotation.x = c.elbowR.rotation.x = -0.3;
}
// An upper-body bend, on top of the lower's lean (the same split as bendSpine).
function bendUpper(c, x = 0, y = 0, z = 0) {
  c.spine.rotation.x += x * 0.55;
  c.spine.rotation.y += y * 0.4;
  c.spine.rotation.z += z * 0.5;
  c.chest.rotation.x += x * 0.45;
  c.chest.rotation.y += y * 0.6;
  c.chest.rotation.z += z * 0.5;
}
