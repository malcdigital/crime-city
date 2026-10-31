import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { dunkPose } from '../dunkpose.js';
import { holdPose, twoHandBall, palmBall } from '../passpose.js';
import { tackledPose } from '../footballpose.js';
import { curve, ramp, put, mix, jointsOf, root, reachPalm } from './kit.js';

// Dunked on (a posterizer), authored as one scene at a rim (src/paired.js): the rim's at the
// origin, 2.99 m over the floor (the courts' 3.05 less their 6 cm surface), facing out over the
// court (+z), the backboard 0.4 m behind it. The dunker drives in down the lane (from +z),
// takes off a step and a half out; the defender's under the rim facing him and goes straight up,
// arms up. The dunker rises into him (the free knee into his chest) and throws it down one
// handed over the top; the defender's knocked back and lands on his back under the basket. The
// dunker hangs on the rim, drops and stands over him.

const TO = 0.72; // (takeoff)
const SL = 1.14; // (the slam: through the rim)
const HG = 0.36; // (on the rim)
const DR = 0.3; // (back down)
const CT = 1.0; // (contact: the knee into him)
const H = 0.95; // (how high the dunker's feet get: the game's dunk height)
const HH = 0.62; // (hanging on the rim: arms up, hands on it)
const RIM = new THREE.Vector3(0, 2.99, 0);

const A = {
  x: curve([[0, -0.55], [TO, -0.3], [SL, -0.18], [SL + HG, -0.16], [SL + HG + DR, -0.2], [2.4, -0.2]]),
  z: curve([[0, 5.2], [0.36, 3.2], [TO, 1.75], [SL, 0.46], [SL + 0.1, 0.32], [SL + HG, 0.3], [SL + HG + DR, 0.72], [2.4, 0.76]]),
  // (up to the top for the slam, then down a little onto the rim, hanging, then the drop)
  y: (t) => (t < TO ? 0 : t < SL ? H * Math.sin(((t - TO) / (SL - TO)) * Math.PI * 0.5) : t < SL + HG ? HH + (H - HH) * Math.max(0, 1 - (t - SL) / 0.1) : HH * Math.max(0, 1 - ((t - SL - HG) / DR) ** 2)),
  pitch: curve([[0, 0.12], [TO, 0.22], [SL - 0.1, 0.1], [SL, 0.3], [SL + HG, 0.1], [SL + HG + DR, 0.12], [2.4, 0]]),
};
const D = {
  x: curve([[0, 0.2], [CT, 0.18], [1.4, 0.3], [2.4, 0.32]]),
  z: curve([[0, 0.85], [0.8, 0.8], [CT, 0.74], [1.2, 0.42], [1.4, 0.2], [1.6, 0.12], [2.4, 0.1]]),
  y: curve([[0, 0], [0.84, 0], [0.94, 0.16], [CT, 0.2], [1.12, 0.18], [1.32, 0.16], [1.45, 0.22], [1.6, 0.2], [2.4, 0.2]]),
  pitch: curve([[0, 0], [0.9, -0.05], [CT, -0.18], [1.12, -0.45], [1.3, -0.95], [1.45, -1.32], [1.6, -1.34], [2.4, -1.3]]),
};

const _b = new THREE.Vector3();

export default {
  name: 'bb-poster',
  fps: 30,
  length: 2.4,
  actors: ['dunker', 'defender'],
  rim: { x: 0, y: 2.99, z: 0, yaw: 0 },
  events: { takeoff: Math.round(TO * 30), contact: Math.round(CT * 30), slam: Math.round(SL * 30), down: Math.round(1.45 * 30) },
  props: { dunker: { ball: 'dunk', until: 'slam' } },
  contact: { move: 'defender', against: 'dunker', skip: { dunker: ['wristL', 'wristR'], defender: ['wristL', 'wristR'] }, tol: 0.015 },
  pose(t, { dunker: a, defender: b }, adjust = {}) {
    // ---- The dunker: down the lane, up, through it, on the rim, down, over him ----
    root(a, A.x(t), A.y(t), A.z(t), Math.PI, A.pitch(t));
    if (adjust.dunker) a.group.position.add(adjust.dunker);
    let two = true;
    if (t < TO) {
      // (the drive: running it in, the ball gathered into both hands for the last steps)
      const drive = jointsOf(a, () => {
        animateWalk(a, t * 13, 1);
        holdPose(a);
      });
      put(a, drive);
    } else {
      const ph = t < SL ? ['rise', (t - TO) / (SL - TO)] : t < SL + HG ? ['hang', (t - SL) / HG] : ['drop', Math.min(1, (t - SL - HG) / DR)];
      let r = null;
      const dunk = jointsOf(a, () => (r = dunkPose(a, 'one', ph[0], ph[1], 1)));
      two = r.two;
      if (t > SL + HG + DR) {
        // (stood over him: tall, the chest out, looking down at him)
        const over = jointsOf(a, () => {
          bendSpine(a, -0.12, 0.15, 0);
          a.neck.rotation.set(0.55, 0.1, 0);
          a.armL.rotation.set(-0.25, 0, 0.35);
          a.armR.rotation.set(-0.25, 0, -0.35);
          a.elbowL.rotation.set(-0.4, 0, 0);
          a.elbowR.rotation.set(-0.4, 0, 0);
        });
        mix(a, dunk, over, ramp(t, SL + HG + DR, SL + HG + DR + 0.35));
      } else put(a, dunk);
    }
    a.group.updateMatrixWorld(true);
    // (the hands on the rim: the ball hand over it and down through the middle for the slam,
    // then both hands on its front edge while he hangs)
    const toLocal = (x, y, z) => a.group.worldToLocal(new THREE.Vector3(x, y, z));
    const over = ramp(t, SL - 0.16, SL - 0.06);
    if (t < SL + 0.02 && over > 0) {
      // (the ball on his palm: from where the dunk had it, up over the rim, down through the middle)
      const cur = palmBall(a, 'R', new THREE.Vector3());
      const above = new THREE.Vector3(RIM.x, RIM.y + 0.32, RIM.z + 0.04);
      const through = new THREE.Vector3(RIM.x, RIM.y + 0.04, RIM.z);
      reachPalm(a, 'R', cur.lerp(above, over).lerp(through, ramp(t, SL - 0.06, SL)), new THREE.Vector3(-1, 0, 0.3));
    }
    const hang = ramp(t, SL + 0.02, SL + 0.1) * (1 - ramp(t, SL + HG, SL + HG + 0.08));
    if (hang > 0) {
      for (const [side, sx] of [['L', 1], ['R', -1]]) {
        const cur = (side === 'L' ? a.wristL : a.wristR).getWorldPosition(new THREE.Vector3());
        const grip = toLocal(RIM.x - sx * 0.13, RIM.y + 0.06, RIM.z + 0.2);
        reachArm(a, side, a.group.worldToLocal(cur).lerp(grip, hang), new THREE.Vector3(sx, 0, 0.3), null, null, 'group');
      }
    }
    a.group.updateMatrixWorld(true);
    // (the ball: in his hands till it's through, then down through the net and bouncing)
    let ball;
    if (t <= SL) ball = two && t < SL - 0.3 ? twoHandBall(a, _b).clone() : palmBall(a, 'R', _b).clone();
    else {
      const s = t - SL;
      const tb = Math.sqrt((2.85 - 0.12) / 4.9); // (to the floor)
      const y = s < tb ? 2.85 - 4.9 * s * s : 0.12 + Math.max(0, 1.6 * (s - tb) - 4.9 * (s - tb) ** 2);
      ball = new THREE.Vector3(0.0, Math.min(y, 2.95), 0.0 + 0.5 * Math.max(0, s - 0.1));
    }

    // ---- The defender: under the rim facing him, straight up, knocked back onto his back ----
    root(b, D.x(t), D.y(t), D.z(t), 0, D.pitch(t));
    if (adjust.defender) b.group.position.add(adjust.defender);
    const set = jointsOf(b, () => {
      bendLeg(b.legL, b.kneeL, 0.5, 0.8);
      bendLeg(b.legR, b.kneeR, 0.5, 0.8);
      b.legL.rotation.z = 0.15;
      b.legR.rotation.z = -0.15;
      bendSpine(b, 0.25, 0, 0);
      b.neck.rotation.set(-0.35, 0, 0);
      b.armL.rotation.set(-1.4, 0, 0.5);
      b.armR.rotation.set(-1.4, 0, -0.5);
      b.elbowL.rotation.set(-0.8, 0, 0);
      b.elbowR.rotation.set(-0.8, 0, 0);
    });
    // (up: legs straight under him, both arms straight up, chin up)
    const up = jointsOf(b, () => {
      bendLeg(b.legL, b.kneeL, 0.1, 0.25);
      bendLeg(b.legR, b.kneeR, 0.15, 0.3);
      bendSpine(b, -0.05, 0, 0);
      b.neck.rotation.set(-0.45, 0, 0);
      reachArm(b, 'L', new THREE.Vector3(0.18, 2.35, 0.12), new THREE.Vector3(1, 0, -0.3), null, null, 'group');
      reachArm(b, 'R', new THREE.Vector3(-0.18, 2.35, 0.12), new THREE.Vector3(-1, 0, -0.3), null, null, 'group');
    });
    // (hit: the head snapped back, arms flung, legs out from under him)
    const hit = jointsOf(b, () => {
      bendSpine(b, -0.3, 0.2, 0);
      b.neck.rotation.set(-0.6, 0.3, 0);
      b.armL.rotation.set(-2.4, 0, 0.9);
      b.armR.rotation.set(-1.9, 0, -1.1);
      b.elbowL.rotation.set(-0.3, 0, 0);
      b.elbowR.rotation.set(-0.5, 0, 0);
      bendLeg(b.legL, b.kneeL, 0.7, 0.5);
      bendLeg(b.legR, b.kneeR, 0.4, 0.9);
    });
    const down = jointsOf(b, () => {
      tackledPose(b, 1, 'front');
      b.armR.rotation.set(-1.5, 0, -0.5);
      b.elbowR.rotation.set(-0.6, 0, 0);
    });
    if (t < 0.82) put(b, set);
    else if (t < CT) mix(b, set, up, ramp(t, 0.82, 0.92));
    else if (t < 1.18) mix(b, up, hit, ramp(t, CT, CT + 0.1));
    else mix(b, hit, down, ramp(t, 1.18, 1.48));
    return { ball };
  },
};
