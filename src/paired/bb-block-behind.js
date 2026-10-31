import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { dunkPose } from '../dunkpose.js';
import { holdPose, twoHandBall } from '../passpose.js';
import { curve, ramp, put, mix, jointsOf, root, reachPalm } from './kit.js';

// A block from behind, authored as one scene at a rim (src/paired.js; the rim at the origin,
// 2.99 m up, facing out over the court (+z)). The shooter drives the lane and goes up for a
// layup a couple of meters out; the defender's trailing right on his back, goes up with him,
// reaches over his right shoulder with his left hand and swats it out of his hand as he brings
// it up, down toward the baseline. Not a chase-down (that one's pinned on the glass at the rim):
// this is from right behind him, in the lane, before it's let go. The shooter comes down
// stumbling a step forward, looking back at him.

const TO = 0.78; // (the shooter's takeoff)
const TOPT = 1.12; // (the top of his jump)
const BLK = 1.0; // (the block: on the way up, the ball coming up by his head)
const H = 0.62; // (how high the shooter's feet get)
const UP = 0.8; // (the blocker leaves the floor)
const HB = 0.98; // (and how high he gets)
const TOPB = 1.06;

const S = {
  x: curve([[0, 0.3], [TO, 0.18], [BLK, 0.15], [1.4, 0.12], [2.0, 0.1]]),
  z: curve([[0, 5.9], [0.45, 4.0], [TO, 2.75], [BLK, 2.2], [1.4, 1.7], [1.7, 1.5], [2.0, 1.45]]), // (carried on forward)
  y: (t) => (t < TO ? 0 : t < TOPT ? H * Math.sin(((t - TO) / (TOPT - TO)) * Math.PI * 0.5) : H * Math.max(0, 1 - ((t - TOPT) / 0.34) ** 2)),
  pitch: curve([[0, 0.1], [TO, 0.2], [BLK, 0.12], [1.35, 0.2], [1.6, 0.25], [2.0, 0.05]]),
};
const B = {
  x: curve([[0, 0.65], [UP, 0.62], [BLK, 0.6], [1.5, 0.66], [2.0, 0.7]]),
  z: curve([[0, 7.1], [0.4, 5.1], [UP, 3.0], [BLK, 2.6], [1.4, 2.42], [2.0, 2.3]]),
  y: (t) => (t < UP ? 0 : t < TOPB ? HB * Math.sin(((t - UP) / (TOPB - UP)) * Math.PI * 0.5) : HB * Math.max(0, 1 - ((t - TOPB) / 0.38) ** 2)),
  pitch: curve([[0, 0.3], [UP, 0.3], [BLK, 0.32], [1.3, 0.15], [1.6, 0.2], [2.0, 0.08]]),
};

// (the ball as he brings it up: by his right ear, in his own frame)
const LB = new THREE.Vector3(-0.18, 2.05, 0.16);
const _o = new THREE.Object3D();
_o.rotation.order = 'YXZ';
function inHand(t) {
  _o.position.set(S.x(t), S.y(t), S.z(t));
  _o.rotation.set(S.pitch(t), Math.PI, 0);
  _o.updateMatrixWorld(true);
  return _o.localToWorld(LB.clone());
}
const PB = inHand(BLK); // (where it's knocked out of his hand)
// (swatted: forward and down out of his hand, toward the baseline, bouncing)
const OUT = new THREE.Vector3(-0.7, -0.6, -3.0);
function swatted(t) {
  const s = t - BLK;
  const y = PB.y + OUT.y * s - 4.9 * s * s;
  if (y > 0.12) return new THREE.Vector3(PB.x + OUT.x * s, y, PB.z + OUT.z * s);
  const a = -4.9;
  const tb = (-OUT.y - Math.sqrt(OUT.y * OUT.y - 4 * a * (PB.y - 0.12))) / (2 * a);
  const vy = Math.abs(OUT.y - 9.8 * tb) * 0.55;
  const u = s - tb;
  return new THREE.Vector3(PB.x + OUT.x * s * 0.9, 0.12 + Math.max(0, vy * u - 4.9 * u * u), PB.z + OUT.z * s * 0.9);
}

const _b = new THREE.Vector3();

export default {
  name: 'bb-block-behind',
  fps: 30,
  length: 2.0,
  actors: ['shooter', 'blocker'],
  rim: { x: 0, y: 2.99, z: 0, yaw: 0 },
  events: { takeoff: Math.round(TO * 30), block: Math.round(BLK * 30) },
  props: { shooter: { ball: 'track' } },
  contact: { move: 'blocker', against: 'shooter', skip: { shooter: ['wristR'], blocker: ['wristL'] }, tol: 0.015 },
  pose(t, { shooter: a, blocker: b }, adjust = {}) {
    // ---- The shooter: down the lane, up for the layup, it's taken off him from behind ----
    root(a, S.x(t), S.y(t), S.z(t), Math.PI, S.pitch(t));
    if (adjust.shooter) a.group.position.add(adjust.shooter);
    const drive = jointsOf(a, () => {
      animateWalk(a, t * 13, 1);
      holdPose(a);
    });
    const rise = jointsOf(a, () => dunkPose(a, 'one', 'rise', Math.min(1, Math.max(0, (t - TO) / (TOPT - TO)) * 0.7), 1));
    // (after: the hand empty, coming down off balance, looking back over his shoulder)
    const after = jointsOf(a, () => {
      dunkPose(a, 'one', 'drop', Math.min(1, Math.max(0, (t - BLK) / 0.5)), 1);
      a.neck.rotation.set(0.1, -1.0, 0);
      bendSpine(a, 0.2, -0.25, 0);
    });
    if (t < TO - 0.1) put(a, drive);
    else if (t < BLK) mix(a, drive, rise, ramp(t, TO - 0.1, TO + 0.06));
    else mix(a, rise, after, ramp(t, BLK + 0.05, BLK + 0.35));
    a.group.updateMatrixWorld(true);
    // (the ball: from both hands up on his right palm by his ear, then knocked out of it)
    let ball;
    if (t > BLK + 0.02) ball = swatted(t - 0.02);
    else {
      ball = twoHandBall(a, _b).clone();
      const up = ramp(t, TO - 0.05, BLK);
      if (up > 0) {
        ball.lerp(t >= BLK ? PB : inHand(t), up);
        reachPalm(a, 'R', ball, new THREE.Vector3(-0.4, -1, 0.1));
      }
    }
    // (the other hand: up by his chest, protecting it, then out for balance coming down)
    const guard = ramp(t, TO - 0.1, TO + 0.12) * (1 - ramp(t, 1.7, 2.0));
    if (guard > 0) {
      a.group.updateMatrixWorld(true);
      const cur = a.group.worldToLocal(a.wristL.getWorldPosition(new THREE.Vector3()));
      const hold = new THREE.Vector3(0.22, 1.55, 0.22).lerp(new THREE.Vector3(0.45, 1.05, 0.15), ramp(t, BLK + 0.1, BLK + 0.5));
      reachArm(a, 'L', cur.lerp(hold, guard), new THREE.Vector3(1, -0.4, -0.2), null, null, 'group');
    }
    a.group.updateMatrixWorld(true);

    // ---- The blocker: right on his back, up with him, over the shoulder ----
    root(b, B.x(t), B.y(t), B.z(t), Math.PI, B.pitch(t));
    if (adjust.blocker) b.group.position.add(adjust.blocker);
    const run = jointsOf(b, () => {
      animateWalk(b, t * 14, 1);
      bendSpine(b, 0.25, 0, 0);
      b.neck.rotation.set(-0.35, 0, 0);
    });
    const fly = jointsOf(b, () => {
      dunkPose(b, 'one', 'rise', Math.min(1, Math.max(0, (t - UP) / (TOPB - UP)) * 0.7), -1);
      b.neck.rotation.set(-0.4, 0.15, 0);
    });
    const land = jointsOf(b, () => {
      const k = Math.min(1, Math.max(0, (t - TOPB - 0.3) / 0.2));
      bendLeg(b.legL, b.kneeL, 0.2 + 0.4 * k, 0.4 + 0.6 * k);
      bendLeg(b.legR, b.kneeR, 0.3 + 0.4 * k, 0.5 + 0.6 * k);
      bendSpine(b, 0.15 + 0.15 * k, 0, 0);
      b.neck.rotation.set(-0.1, 0.3, 0);
      b.armL.rotation.set(-1.1, 0, 0.4);
      b.armR.rotation.set(-0.6, 0, -0.4);
      b.elbowL.rotation.set(-0.4, 0, 0);
      b.elbowR.rotation.set(-0.6, 0, 0);
    });
    if (t < UP - 0.1) put(b, run);
    else if (t < BLK + 0.12) mix(b, run, fly, ramp(t, UP - 0.1, UP + 0.04));
    else mix(b, fly, land, ramp(t, BLK + 0.12, BLK + 0.45));
    b.group.updateMatrixWorld(true);
    // (the left palm: up over his shoulder onto the ball, through it, down the way it goes)
    const hit = ramp(t, UP, BLK - 0.03) * (1 - ramp(t, BLK + 0.12, BLK + 0.35));
    if (hit > 0) {
      const from = b.group.localToWorld(new THREE.Vector3(0.3, 2.2, 0.35));
      const through = PB.clone().add(new THREE.Vector3(0.0, 0.12, -0.35)); // (the follow-through: on over the top)
      const at = t <= BLK + 0.02 ? from.lerp(PB, ramp(t, UP, BLK - 0.02)) : PB.clone().lerp(through, ramp(t, BLK + 0.02, BLK + 0.14));
      reachPalm(b, 'L', at, new THREE.Vector3(1, -0.5, -0.3));
      b.group.updateMatrixWorld(true);
    }
    return { ball };
  },
};
