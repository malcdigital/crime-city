import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { dunkPose } from '../dunkpose.js';
import { holdPose, twoHandBall } from '../passpose.js';
import { curve, ramp, put, mix, jointsOf, root, reachPalm } from './kit.js';

// A block from the side, authored as one scene at a rim (src/paired.js; the rim at the origin,
// 2.99 m up, facing out over the court (+z)). The shooter drives the lane and goes up for a
// right-hand layup; the help defender comes across from his right (the ball side), takes off
// sideways and meets it with his right hand at the top, out in front of the rim, and knocks it
// back across the lane. Both come down; the blocker lands past him on the lane line, the
// shooter turning to watch it go.

const TO = 0.8; // (the shooter's takeoff)
const BLK = 1.08; // (the block: near the top, the ball up on his hand)
const TOPT = 1.12;
const H = 0.8; // (how high the shooter's feet get)
const UP = 0.84; // (the blocker leaves the floor)
const HB = 1.0; // (and how high he gets)
const TOPB = 1.1;

const S = {
  x: curve([[0, 0.3], [TO, -0.05], [BLK, -0.12], [1.5, -0.14], [2.0, -0.15]]),
  z: curve([[0, 5.4], [0.45, 3.5], [TO, 1.9], [BLK, 1.15], [1.45, 1.0], [2.0, 1.0]]),
  y: (t) => (t < TO ? 0 : t < TOPT ? H * Math.sin(((t - TO) / (TOPT - TO)) * Math.PI * 0.5) : H * Math.max(0, 1 - ((t - TOPT) / 0.36) ** 2)),
  pitch: curve([[0, 0.1], [TO, 0.2], [BLK, 0.1], [1.4, 0.0], [2.0, 0]]),
  yaw: curve([[0, Math.PI], [BLK, Math.PI], [1.5, Math.PI + 0.5], [2.0, Math.PI + 0.7]]), // (turning to watch it go)
};
const B = {
  // (from the right of the lane, across, facing -x; carried on past him after)
  x: curve([[0, 3.4], [0.4, 2.5], [UP, 1.16], [BLK, 0.76], [1.45, 0.56], [2.0, 0.5]]),
  z: curve([[0, 1.3], [UP, 1.05], [BLK, 0.95], [1.45, 0.8], [2.0, 0.75]]),
  y: (t) => (t < UP ? 0 : t < TOPB ? HB * Math.sin(((t - UP) / (TOPB - UP)) * Math.PI * 0.5) : HB * Math.max(0, 1 - ((t - TOPB) / 0.38) ** 2)),
  pitch: curve([[0, 0.25], [UP, 0.2], [BLK, 0.0], [1.4, 0.1], [2.0, 0.1]]),
  roll: curve([[0, 0], [UP, 0], [BLK, -0.15], [1.4, 0], [2.0, 0]]), // (leaning into it)
};

// (where it's met: out in front of the rim on the shooter's right, a little under the rim)
const PB = new THREE.Vector3(0.24, 2.84, 0.74);
// (knocked back across the lane, a little out over the court)
const OUT = new THREE.Vector3(-2.9, 0.9, 0.8);
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
  name: 'bb-block-side',
  fps: 30,
  length: 2.0,
  actors: ['shooter', 'blocker'],
  rim: { x: 0, y: 2.99, z: 0, yaw: 0 },
  events: { takeoff: Math.round(TO * 30), block: Math.round(BLK * 30) },
  props: { shooter: { ball: 'track' } },
  contact: { move: 'blocker', against: 'shooter', skip: { shooter: ['wristR'], blocker: ['wristR'] }, tol: 0.015 },
  pose(t, { shooter: a, blocker: b }, adjust = {}) {
    // ---- The shooter: down the lane, up for the layup, knocked away from the side ----
    root(a, S.x(t), S.y(t), S.z(t), S.yaw(t), S.pitch(t));
    if (adjust.shooter) a.group.position.add(adjust.shooter);
    const drive = jointsOf(a, () => {
      animateWalk(a, t * 13, 1);
      holdPose(a);
    });
    const rise = jointsOf(a, () => dunkPose(a, 'one', 'rise', Math.min(1, Math.max(0, (t - TO) / (TOPT - TO)) * 0.85), 1));
    const after = jointsOf(a, () => {
      dunkPose(a, 'one', 'drop', Math.min(1, Math.max(0, (t - BLK) / 0.45)), 1);
      a.neck.rotation.set(-0.1, 0.5, 0);
    });
    if (t < TO - 0.1) put(a, drive);
    else if (t < BLK) mix(a, drive, rise, ramp(t, TO - 0.1, TO + 0.06));
    else mix(a, rise, after, ramp(t, BLK + 0.05, BLK + 0.3));
    a.group.updateMatrixWorld(true);
    let ball;
    if (t > BLK + 0.02) ball = swatted(t - 0.02);
    else {
      ball = twoHandBall(a, _b).clone();
      const up = ramp(t, TO - 0.05, BLK);
      if (up > 0) {
        ball.lerp(PB, up);
        reachPalm(a, 'R', ball, new THREE.Vector3(-0.35, -1, 0.15));
      }
    }
    // (the other hand up by his head, guarding it; down by his side coming down)
    const guard = ramp(t, TO - 0.1, TO + 0.12) * (1 - ramp(t, 1.75, 2.0));
    if (guard > 0) {
      a.group.updateMatrixWorld(true);
      const cur = a.group.worldToLocal(a.wristL.getWorldPosition(new THREE.Vector3()));
      const hold = new THREE.Vector3(0.24, 1.95, 0.18).lerp(new THREE.Vector3(0.36, 0.95, 0.02), ramp(t, BLK + 0.1, BLK + 0.5));
      reachArm(a, 'L', cur.lerp(hold, guard), new THREE.Vector3(1, -0.4, -0.2), null, null, 'group');
    }
    a.group.updateMatrixWorld(true);

    // ---- The blocker: across from the right, up sideways, the right hand on it ----
    root(b, B.x(t), B.y(t), B.z(t), -Math.PI / 2, B.pitch(t), B.roll(t));
    if (adjust.blocker) b.group.position.add(adjust.blocker);
    const run = jointsOf(b, () => {
      animateWalk(b, t * 14, 1);
      bendSpine(b, 0.2, 0, 0);
      b.neck.rotation.set(-0.3, -0.4, 0); // (eyes on the ball, off to his right)
    });
    const fly = jointsOf(b, () => {
      dunkPose(b, 'one', 'rise', Math.min(1, Math.max(0, (t - UP) / (TOPB - UP)) * 0.75), 1);
      b.neck.rotation.set(-0.45, -0.35, 0);
    });
    const land = jointsOf(b, () => {
      const k = Math.min(1, Math.max(0, (t - TOPB - 0.3) / 0.2));
      bendLeg(b.legL, b.kneeL, 0.2 + 0.4 * k, 0.4 + 0.6 * k);
      bendLeg(b.legR, b.kneeR, 0.2 + 0.4 * k, 0.4 + 0.6 * k);
      bendSpine(b, 0.15 * k, 0, 0);
      b.neck.rotation.set(-0.1, 0.4, 0); // (watching it go)
      b.armL.rotation.set(-0.8, 0, 0.6);
      b.armR.rotation.set(-1.2, 0, -0.4);
      b.elbowL.rotation.set(-0.5, 0, 0);
      b.elbowR.rotation.set(-0.5, 0, 0);
    });
    if (t < UP - 0.1) put(b, run);
    else if (t < BLK + 0.12) mix(b, run, fly, ramp(t, UP - 0.1, UP + 0.04));
    else mix(b, fly, land, ramp(t, BLK + 0.12, BLK + 0.45));
    b.group.updateMatrixWorld(true);
    // (the right palm: up and across onto it, then through it the way it goes)
    const hit = ramp(t, UP, BLK - 0.03) * (1 - ramp(t, BLK + 0.12, BLK + 0.35));
    if (hit > 0) {
      const from = b.group.localToWorld(new THREE.Vector3(-0.3, 2.2, 0.3));
      const through = PB.clone().add(new THREE.Vector3(-0.35, 0.05, 0.1)); // (the follow-through: across)
      const at = t <= BLK + 0.02 ? from.lerp(PB, ramp(t, UP, BLK - 0.02)) : PB.clone().lerp(through, ramp(t, BLK + 0.02, BLK + 0.14));
      reachPalm(b, 'R', at, new THREE.Vector3(-1, -0.4, -0.3));
      b.group.updateMatrixWorld(true);
    }
    return { ball };
  },
};
