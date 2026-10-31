import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { dunkPose } from '../dunkpose.js';
import { holdPose, twoHandBall } from '../passpose.js';
import { curve, ramp, put, mix, jointsOf, root, reachPalm } from './kit.js';

// A block at the rim, authored as one scene at a rim (src/paired.js; the rim at the origin,
// 2.99 m up, facing out over the court (+z), the backboard 0.4 m behind it). The shooter drives
// the lane and goes up for a right-hand layup at the rim; the blocker's set under the basket
// facing him, goes straight up (both arms up, no foul) and meets it with his left hand right in
// front of the rim, at the top, and swats it away out to the side. They both come down; the
// blocker lands squared up, the shooter lands looking at where it went.

const TO = 0.8; // (the shooter's takeoff)
const BLK = 1.12; // (the block: the ball at the top, his hand on it)
const H = 0.82; // (how high the shooter's feet get)
const HB = 0.96; // (and the blocker's)
const UP = 0.84; // (the blocker leaves the floor)

const S = {
  x: curve([[0, 0.3], [TO, -0.05], [BLK, -0.12], [1.5, -0.08], [2.0, -0.05]]),
  z: curve([[0, 5.3], [0.45, 3.3], [TO, 1.62], [BLK, 0.88], [1.3, 0.9], [1.5, 1.02], [2.0, 1.1]]), // (knocked back a step coming down)
  y: (t) => (t < TO ? 0 : t < BLK ? H * Math.sin(((t - TO) / (BLK - TO)) * Math.PI * 0.5) : H * Math.max(0, 1 - ((t - BLK) / 0.36) ** 2)),
  pitch: curve([[0, 0.1], [TO, 0.2], [BLK, 0.1], [1.3, -0.08], [1.6, 0.04], [2.0, 0]]),
};
const B = {
  x: curve([[0, -0.2], [UP, -0.18], [BLK, -0.16], [2.0, -0.16]]),
  z: curve([[0, 0.05], [UP, 0.08], [BLK, 0.1], [1.5, 0.08], [2.0, 0.06]]),
  y: (t) => (t < UP ? 0 : t < BLK ? HB * Math.sin(((t - UP) / (BLK - UP)) * Math.PI * 0.5) : HB * Math.max(0, 1 - ((t - BLK) / 0.38) ** 2)),
  pitch: curve([[0, 0.15], [UP, 0.1], [BLK, -0.05], [1.4, 0.05], [2.0, 0.1]]),
};

// (where it's met: up at the rim's height, just out in front of it on the shooter's right)
const PB = new THREE.Vector3(0.2, 2.9, 0.46);
const TOP = new THREE.Vector3(-0.14, 2.3, 0.42); // (the shooter's hand knocked back from, his frame)
const topAt = () => PB.clone();
// (swatted: from where it was met, out to the shooter's right and back out over the court,
// bouncing)
const OUT = new THREE.Vector3(2.6, 1.2, 2.4);
function swatted(t) {
  const P = topAt(BLK);
  const s = t - BLK;
  const y = P.y + OUT.y * s - 4.9 * s * s;
  if (y > 0.12) return new THREE.Vector3(P.x + OUT.x * s, y, P.z + OUT.z * s);
  // (the bounce: the time it hit, then up again at half the speed it came down)
  const a = -4.9;
  const tb = (-OUT.y - Math.sqrt(OUT.y * OUT.y - 4 * a * (P.y - 0.12))) / (2 * a);
  const vy = Math.abs(OUT.y - 9.8 * tb) * 0.55;
  const u = s - tb;
  return new THREE.Vector3(P.x + OUT.x * s * 0.9, 0.12 + Math.max(0, vy * u - 4.9 * u * u), P.z + OUT.z * s * 0.9);
}

const _b = new THREE.Vector3();

export default {
  name: 'bb-rimblock',
  fps: 30,
  length: 2.0,
  actors: ['shooter', 'blocker'],
  rim: { x: 0, y: 2.99, z: 0, yaw: 0 },
  events: { takeoff: Math.round(TO * 30), block: Math.round(BLK * 30) },
  props: { shooter: { ball: 'track' } },
  contact: { move: 'blocker', against: 'shooter', skip: { shooter: ['wristR'], blocker: ['wristL'] }, tol: 0.015 },
  pose(t, { shooter: a, blocker: b }, adjust = {}) {
    // ---- The shooter: down the lane, up for the layup at the rim, blocked, down ----
    root(a, S.x(t), S.y(t), S.z(t), Math.PI, S.pitch(t));
    if (adjust.shooter) a.group.position.add(adjust.shooter);
    const drive = jointsOf(a, () => {
      animateWalk(a, t * 13, 1);
      holdPose(a);
    });
    const rise = jointsOf(a, () => dunkPose(a, 'one', 'rise', Math.min(1, Math.max(0, (t - TO) / (BLK - TO)) * 0.85), 1));
    // (after: knocked off it, the arm coming down, coming down looking out after the ball)
    const after = jointsOf(a, () => {
      dunkPose(a, 'one', 'drop', Math.min(1, Math.max(0, (t - BLK) / 0.4)), 1);
      a.neck.rotation.set(-0.15, -0.6, 0);
      bendSpine(a, 0.1, 0, -0.1);
    });
    if (t < TO - 0.1) put(a, drive);
    else if (t < BLK) mix(a, drive, rise, ramp(t, TO - 0.1, TO + 0.06));
    else mix(a, rise, after, ramp(t, BLK + 0.04, BLK + 0.3));
    a.group.updateMatrixWorld(true);
    a.group.updateMatrixWorld(true);
    // (the ball: from both hands up on his right palm to where it's met, then knocked away)
    let ball;
    if (t > BLK + 0.02) ball = swatted(t - 0.02);
    else {
      ball = twoHandBall(a, _b).clone();
      const up = ramp(t, TO - 0.05, BLK);
      if (up > 0) {
        ball.lerp(PB, up);
        reachPalm(a, 'R', ball, new THREE.Vector3(-0.35, -1, 0.15)); // (the elbow down under it, the layup arm)
      }
    }
    // (the other hand up by his head as he rises, guarding it, not out in front of him)
    // (then down by his side as he lands, never swung out into the man in front of him)
    const guard = ramp(t, TO - 0.1, TO + 0.12) * (1 - ramp(t, 1.75, 2.0));
    if (guard > 0) {
      a.group.updateMatrixWorld(true);
      const cur = a.group.worldToLocal(a.wristL.getWorldPosition(new THREE.Vector3()));
      const hold = new THREE.Vector3(0.24, 1.95, 0.18).lerp(new THREE.Vector3(0.36, 0.95, 0.02), ramp(t, BLK + 0.1, BLK + 0.5));
      reachArm(a, 'L', cur.lerp(hold, guard), new THREE.Vector3(1, -0.4, -0.2), null, null, 'group');
      a.group.updateMatrixWorld(true);
    }
    // (after: his hand knocked back off it)
    const back = ramp(t, BLK + 0.02, BLK + 0.06) * (1 - ramp(t, BLK + 0.12, BLK + 0.32));
    if (back > 0) reachArm(a, 'R', TOP.clone().lerp(new THREE.Vector3(-0.32, 2.0, 0.05), ramp(t, BLK + 0.02, BLK + 0.17)), new THREE.Vector3(-0.35, -1, 0.15), null, null, 'group');
    a.group.updateMatrixWorld(true);

    // ---- The blocker: under the rim facing out, straight up, the left hand on it ----
    root(b, B.x(t), B.y(t), B.z(t), 0, B.pitch(t));
    if (adjust.blocker) b.group.position.add(adjust.blocker);
    const set = jointsOf(b, () => {
      bendLeg(b.legL, b.kneeL, 0.55, 0.9);
      bendLeg(b.legR, b.kneeR, 0.55, 0.9);
      b.legL.rotation.z = 0.15;
      b.legR.rotation.z = -0.15;
      bendSpine(b, 0.25, 0, 0);
      b.neck.rotation.set(-0.3, 0, 0);
      b.armL.rotation.set(-1.2, 0, 0.6);
      b.armR.rotation.set(-1.2, 0, -0.6);
      b.elbowL.rotation.set(-0.9, 0, 0);
      b.elbowR.rotation.set(-0.9, 0, 0);
    });
    // (up: legs long under him, both arms going up, eyes on the ball)
    const up = jointsOf(b, () => {
      bendLeg(b.legL, b.kneeL, 0.1, 0.25);
      bendLeg(b.legR, b.kneeR, 0.2, 0.35);
      bendSpine(b, -0.05, 0, 0);
      b.neck.rotation.set(-0.5, 0.1, 0);
      reachArm(b, 'R', new THREE.Vector3(-0.2, 2.3, 0.1), new THREE.Vector3(-1, 0, -0.3), null, null, 'group');
      reachArm(b, 'L', new THREE.Vector3(0.22, 2.3, 0.2), new THREE.Vector3(1, 0, -0.3), null, null, 'group');
    });
    // (down: landing on both feet, knees giving, arms coming down, squared up)
    const land = jointsOf(b, () => {
      const k = Math.min(1, Math.max(0, (t - BLK - 0.3) / 0.2));
      bendLeg(b.legL, b.kneeL, 0.2 + 0.4 * k, 0.4 + 0.6 * k);
      bendLeg(b.legR, b.kneeR, 0.2 + 0.4 * k, 0.4 + 0.6 * k);
      bendSpine(b, 0.15 * k, 0, 0);
      b.neck.rotation.set(-0.1, 0.3, 0); // (watching it go)
      b.armL.rotation.set(-1.0, 0, 0.5);
      b.armR.rotation.set(-1.4, 0, -0.4);
      b.elbowL.rotation.set(-0.5, 0, 0);
      b.elbowR.rotation.set(-0.6, 0, 0);
    });
    if (t < UP - 0.1) put(b, set);
    else if (t < BLK + 0.12) mix(b, set, up, ramp(t, UP - 0.1, UP + 0.04));
    else mix(b, up, land, ramp(t, BLK + 0.12, BLK + 0.45));
    b.group.updateMatrixWorld(true);
    // (the left palm: up to the ball as it gets to the top, on it at the block, then through it,
    // out the way it goes)
    const hit = ramp(t, UP + 0.04, BLK - 0.03) * (1 - ramp(t, BLK + 0.12, BLK + 0.35));
    if (hit > 0) {
      const P = topAt(BLK);
      const from = b.group.localToWorld(new THREE.Vector3(0.25, 2.25, 0.2));
      const through = P.clone().add(new THREE.Vector3(0.4, 0.05, 0.02)); // (the follow-through: out to the side, the way it goes)
      const at = t <= BLK + 0.02 ? from.lerp(P, ramp(t, UP + 0.04, BLK - 0.02)) : P.clone().lerp(through, ramp(t, BLK + 0.02, BLK + 0.14));
      reachPalm(b, 'L', at, new THREE.Vector3(1, -0.5, -0.4));
      b.group.updateMatrixWorld(true);
    }
    return { ball };
  },
};
