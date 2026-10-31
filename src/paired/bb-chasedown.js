import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { dunkPose } from '../dunkpose.js';
import { holdPose, twoHandBall } from '../passpose.js';
import { curve, ramp, put, mix, jointsOf, root, reachPalm } from './kit.js';

// A chase-down block, authored as one scene at a rim (src/paired.js; the rim at the origin,
// 2.99 m up, facing out over the court (+z), the backboard 0.4 m behind it). The shooter's
// all alone on the break: in down the lane, a layup off the glass with his right hand. The
// chaser comes from way behind on his left, takes off after him, flies past and pins it on the
// backboard with his right hand just as it gets there; it slides down the glass and drops out.
// They both come down under the basket.

const TO = 0.86; // (the shooter's takeoff)
const RL = 1.08; // (the release)
const PIN = 1.3; // (pinned on the glass)
const H = 0.55; // (how high a layup gets the shooter's feet)
const HC = 1.1; // (and the chaser's)

// (the ball: where it's pinned, on the face of the board just above the rim, right of centre)
const PX = 0.04;
const PY = 3.08;
const PZ = -0.25;

const S = {
  x: curve([[0, 0.55], [TO, 0.3], [RL, 0.24], [1.6, 0.26], [2.2, 0.28]]),
  z: curve([[0, 6.4], [0.5, 3.6], [TO, 1.6], [RL, 0.95], [1.4, 0.6], [1.6, 0.5], [2.2, 0.45]]),
  y: (t) => (t < TO ? 0 : t < RL ? H * Math.sin(((t - TO) / (RL - TO)) * Math.PI * 0.5) : H * Math.max(0, 1 - ((t - RL) / 0.42) ** 2)),
  pitch: curve([[0, 0.1], [TO, 0.18], [RL, 0.05], [1.5, 0.05], [2.2, 0]]),
};
const C = {
  x: curve([[0, -0.6], [0.9, -0.5], [PIN, -0.2], [1.6, -0.45], [2.2, -0.6]]),
  z: curve([[0, 9.7], [0.5, 5.5], [0.98, 1.85], [PIN, -0.02], [1.55, -0.3], [1.8, -0.45], [2.2, -0.55]]),
  y: (t) => (t < 0.98 ? 0 : t < PIN ? HC * Math.sin(((t - 0.98) / (PIN - 0.98)) * Math.PI * 0.5) : HC * Math.max(0, 1 - ((t - PIN) / 0.4) ** 2)),
  pitch: curve([[0, 0.25], [0.98, 0.3], [PIN, 0.12], [1.6, 0.15], [2.2, 0.05]]),
};

const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

// The ball: in the shooter's hands, up and off his fingertips at the release, to the glass;
// pinned there a moment, then down the board and out.
function ballAt(t, a, from) {
  if (t <= RL) return from;
  if (t <= PIN) {
    const k = (t - RL) / (PIN - RL);
    return _p.set(from.x + (PX - from.x) * k, from.y + (PY - from.y) * k + 0.35 * Math.sin(k * Math.PI), from.z + (PZ - from.z) * k);
  }
  const s = t - PIN;
  if (s < 0.12) return _p.set(PX, PY, PZ); // (pinned)
  const u = s - 0.12;
  const y = PY - 4.9 * u * u;
  if (y > 0.12) return _p.set(PX + 0.3 * u, y, PZ + 1.4 * u);
  const tb = Math.sqrt((PY - 0.12) / 4.9);
  const v = u - tb;
  return _p.set(PX + 0.3 * u, 0.12 + Math.max(0, 2.2 * v - 4.9 * v * v), PZ + 1.4 * u);
}

// (where it leaves his hand: over his right shoulder at the top, from his root at the release)
const TOP = new THREE.Vector3(-0.12, 2.35, 0.45);
const _o = new THREE.Object3D();
_o.rotation.order = 'YXZ';
function releasePoint() {
  _o.position.set(S.x(RL), S.y(RL), S.z(RL));
  _o.rotation.set(S.pitch(RL), Math.PI, 0);
  _o.updateMatrixWorld(true);
  return _o.localToWorld(TOP.clone().add(new THREE.Vector3(0, 0.13, 0)));
}

export default {
  name: 'bb-chasedown',
  fps: 30,
  length: 2.2,
  actors: ['shooter', 'chaser'],
  rim: { x: 0, y: 2.99, z: 0, yaw: 0 },
  events: { release: Math.round(RL * 30), pin: Math.round(PIN * 30) },
  props: { shooter: { ball: 'track' } },
  contact: { move: 'chaser', against: 'shooter', skip: { chaser: ['wristR', 'elbowR'], shooter: ['wristR', 'elbowR'] }, tol: 0.015 },
  pose(t, { shooter: a, chaser: b }, adjust = {}) {
    // ---- The shooter: in down the lane, up, the ball off his right hand to the glass ----
    root(a, S.x(t), S.y(t), S.z(t), Math.PI, S.pitch(t));
    if (adjust.shooter) a.group.position.add(adjust.shooter);
    const drive = jointsOf(a, () => {
      animateWalk(a, t * 13, 1);
      holdPose(a);
    });
    const rise = jointsOf(a, () => dunkPose(a, 'one', 'rise', Math.min(1, Math.max(0, (t - TO) / (RL - TO)) * 0.8), 1));
    // (after: coming down, looking up at the glass where it went)
    const after = jointsOf(a, () => {
      dunkPose(a, 'one', 'drop', Math.min(1, Math.max(0, (t - RL) / 0.45)), 1);
      a.neck.rotation.set(-0.5, 0.3, 0);
    });
    if (t < TO - 0.1) put(a, drive);
    else if (t < RL) mix(a, drive, rise, ramp(t, TO - 0.1, TO + 0.06));
    else mix(a, rise, after, ramp(t, RL + 0.08, RL + 0.35));
    a.group.updateMatrixWorld(true);
    // (the right hand up under it to the release, laying it up)
    const lay = ramp(t, TO, RL - 0.04) * (1 - ramp(t, RL + 0.05, RL + 0.3));
    if (lay > 0) reachArm(a, 'R', TOP, new THREE.Vector3(-1, -0.3, 0), null, null, 'group');
    a.group.updateMatrixWorld(true);
    let ball;
    if (t < TO - 0.05) ball = twoHandBall(a, _b).clone();
    else if (t <= RL) {
      // (from both hands up into the right one at the top)
      const inHand = a.group.localToWorld(TOP.clone().add(new THREE.Vector3(0, 0.13, 0)));
      ball = twoHandBall(a, _b).clone().lerp(inHand, ramp(t, TO - 0.05, TO + 0.12));
    } else ball = ballAt(t, a, releasePoint()).clone();

    // ---- The chaser: from way back on his left, up after it, pinning it on the glass ----
    root(b, C.x(t), C.y(t), C.z(t), Math.PI, C.pitch(t));
    if (adjust.chaser) b.group.position.add(adjust.chaser);
    const sprint = jointsOf(b, () => {
      animateWalk(b, t * 15, 1);
      bendSpine(b, 0.3, 0, 0);
      b.neck.rotation.set(-0.45, 0, 0);
      b.armL.rotation.x *= 1.3;
      b.armR.rotation.x *= 1.3;
    });
    const fly = jointsOf(b, () => {
      dunkPose(b, 'one', 'rise', Math.min(1, Math.max(0, (t - 0.98) / (PIN - 0.98)) * 0.75), 1);
      b.neck.rotation.set(-0.6, -0.2, 0);
    });
    const land = jointsOf(b, () => {
      dunkPose(b, 'one', 'drop', Math.min(1, Math.max(0, (t - PIN) / 0.45)), 1);
      b.neck.rotation.set(-0.2, -0.4, 0); // (looking back at him)
    });
    if (t < 0.9) put(b, sprint);
    else if (t < PIN + 0.05) mix(b, sprint, fly, ramp(t, 0.9, 1.02));
    else mix(b, fly, land, ramp(t, PIN + 0.05, PIN + 0.35));
    b.group.updateMatrixWorld(true);
    // (the right arm up after it, the hand on the ball against the glass, then down with it a
    // little and away)
    const reach = ramp(t, 1.02, PIN - 0.04) * (1 - ramp(t, PIN + 0.12, PIN + 0.4));
    if (reach > 0) {
      // (the palm flat on the ball against the glass: up high, then onto it)
      const upHigh = b.group.localToWorld(new THREE.Vector3(-0.2, 2.5, 0.35));
      reachPalm(b, 'R', upHigh.lerp(new THREE.Vector3(PX, PY, PZ), ramp(t, 1.1, PIN - 0.02)), new THREE.Vector3(-1, -0.2, -0.3));
      b.group.updateMatrixWorld(true);
    }
    return { ball };
  },
};
