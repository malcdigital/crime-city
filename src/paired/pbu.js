import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { fbPose, catchPose } from '../footballpose.js';
import { curve, ramp, put, mix, jointsOf, root } from './kit.js';

// A pass breakup, authored as one scene (src/paired.js): the receiver running his route (+z),
// the ball just into his hands up high (frame 0 is when it gets there), the defender trailing
// at his left hip. The defender leaps and brings his inside (right) arm down through the
// receiver's hands, knocking it out at the swat (event 'swat'); the receiver's hands open as
// it's gone, and they both come down and pull up. In the game the ball's stuck in the
// receiver's hands till the swat frame, then it pops loose the way the arm went.

const SW = 0.23; // (the swat)

const R = {
  z: curve([[0, 0], [0.3, 1.7], [0.6, 3.1], [1.0, 4.1], [1.3, 4.45]]),
};
const D = {
  x: curve([[0, 0.62], [SW, 0.42], [0.6, 0.55], [1.3, 0.62]]),
  z: curve([[0, -0.95], [SW, 0.35], [0.6, 2.2], [1.0, 3.3], [1.3, 3.7]]),
  y: curve([[0, 0], [0.04, 0], [0.16, 0.32], [SW, 0.38], [0.36, 0.26], [0.48, 0], [1.3, 0]]),
};

export default {
  name: 'pbu',
  fps: 30,
  length: 1.3,
  actors: ['receiver', 'defender'],
  events: { swat: Math.round(SW * 30) },
  props: { receiver: { ball: 'hands', until: 'swat' } },
  contact: { move: 'defender', against: 'receiver', skip: { defender: ['wristR', 'elbowR'], receiver: ['wristL', 'wristR'] }, tol: 0.015 },
  pose(t, { receiver: a, defender: b }, adjust = {}) {
    // ---- The receiver: hands up on it, then it's gone ----
    root(a, 0, 0, R.z(t), 0);
    if (adjust.receiver) a.group.position.add(adjust.receiver);
    const sp = Math.max(0.4, 1 - t * 0.6);
    const catching = jointsOf(a, () => {
      animateWalk(a, t * 12, sp);
      catchPose(a, true);
    });
    const lost = jointsOf(a, () => {
      animateWalk(a, t * 12, sp);
      fbPose(a, { lower: ['run'], upper: ['denied', 0.85] });
      bendSpine(a, 0.05, 0.25, 0); // (turned toward where it went)
    });
    if (t < SW) put(a, catching);
    else mix(a, catching, lost, ramp(t, SW, SW + 0.2));
    a.group.updateMatrixWorld(true);

    // ---- The defender: off his left hip, up, the arm down through his hands ----
    root(b, D.x(t), D.y(t), D.z(t), 0);
    if (adjust.defender) b.group.position.add(adjust.defender);
    const chase = jointsOf(b, () => {
      animateWalk(b, t * 13, 1);
      bendSpine(b, 0.15, 0, 0);
    });
    const leap = jointsOf(b, () => {
      bendSpine(b, -0.05, -0.35, -0.15);
      b.neck.rotation.set(-0.5, -0.3, 0);
      bendLeg(b.legL, b.kneeL, 0.6, 0.9);
      bendLeg(b.legR, b.kneeR, 0.15, 0.5);
      b.armL.rotation.set(-0.9, 0, 0.8); // (the outside arm out for balance)
      b.elbowL.rotation.set(-0.4, 0, 0);
    });
    const after = jointsOf(b, () => {
      animateWalk(b, t * 12, 0.7);
      bendSpine(b, 0.2, -0.15, 0);
    });
    if (t < 0.04) put(b, chase);
    else if (t < 0.45) mix(b, chase, leap, ramp(t, 0.04, 0.14));
    else mix(b, leap, after, ramp(t, 0.45, 0.62));
    // (the swing: from up over the receiver's hands, down through them at the swat, on down
    // and across)
    a.wristL.updateMatrixWorld(true);
    const hands = new THREE.Vector3();
    a.wristL.getWorldPosition(hands);
    const h2 = new THREE.Vector3();
    a.wristR.getWorldPosition(h2);
    hands.add(h2).multiplyScalar(0.5);
    b.group.updateMatrixWorld(true);
    const at = b.group.worldToLocal(hands.clone());
    const k = (t - SW) / 0.22; // (-1 above, 0 through, +1 below and past)
    const swing = at.clone().add(new THREE.Vector3(0.05, 0.35 * -Math.max(-1, Math.min(1, k)) + (k > 0 ? -0.15 * k : 0), k > 0 ? 0.25 * Math.min(1, k) : -0.15));
    const reach = new THREE.Vector3(-0.25, 2.1, 0.35);
    const w = ramp(t, 0.03, SW - 0.05) * (1 - ramp(t, 0.5, 0.75));
    reachArm(b, 'R', reach.clone().lerp(swing, w), new THREE.Vector3(-1, 0.2, -0.2), null, null, 'group');
  },
};
