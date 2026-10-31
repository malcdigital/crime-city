import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { fbPose, tackledPose, tacklerPose } from '../footballpose.js';
import { curve, ramp, put, mix, jointsOf, root, pointOn } from './kit.js';

// A tackle from the side, authored as one scene (src/paired.js): the runner going up the field
// (+z), the ball tucked under his right arm, the tackler coming across from his left (+x). His
// shoulder goes into the runner's ribs, his arms wrap round the runner's body (a hand on his far
// side, front and back, wherever he is), and the runner's carried sideways and rolled onto his
// right side with the tackler on top of him. From the runner's right it's the same mirrored
// (src/pairedplay.js).

const TC = 0.3; // (contact)
const TD = 0.86; // (down)

const R = {
  x: curve([[0, 0], [TC, 0], [0.5, -0.35], [0.7, -0.7], [TD, -0.85], [1.6, -0.9]]),
  z: curve([[0, -1.8], [TC, 0], [0.5, 0.65], [0.7, 1.0], [TD, 1.15], [1.6, 1.2]]),
  y: curve([[0, 0], [0.5, 0.02], [0.7, 0.14], [TD, 0.24], [0.95, 0.27], [1.05, 0.24], [1.6, 0.24]]),
  roll: curve([[0, 0], [TC, 0], [0.5, 0.35], [0.7, 1.15], [TD, 1.42], [1.6, 1.42]]),
};
const T = {
  x: curve([[0, 3.3], [TC, 0.82], [0.5, 0.2], [0.7, -0.25], [TD, -0.42], [1.6, -0.46]]),
  z: curve([[0, -0.12], [TC, 0], [0.5, 0.55], [0.7, 0.9], [TD, 1.02], [1.6, 1.06]]),
  y: curve([[0, 0], [0.55, 0.04], [0.75, 0.24], [TD, 0.3], [0.95, 0.27], [1.6, 0.28]]),
  pitch: curve([[0, 0.12], [TC, 0.25], [0.5, 0.6], [0.7, 1.15], [TD, 1.33], [1.6, 1.33]]),
};

export default {
  name: 'tackle-side',
  fps: 30,
  length: 1.6,
  actors: ['runner', 'tackler'],
  events: { contact: Math.round(TC * 30), down: Math.round(TD * 30) },
  props: { runner: { ball: 'tuck' } },
  contact: { move: 'tackler', against: 'runner', skip: { tackler: ['wristL', 'wristR'] }, tol: 0.015 },
  pose(t, { runner: a, tackler: b }, adjust = {}) {
    // ---- The runner ----
    root(a, R.x(t), R.y(t), R.z(t), 0, 0.12 * ramp(t, TC, 0.7), R.roll(t));
    if (adjust.runner) a.group.position.add(adjust.runner);
    const run = jointsOf(a, () => {
      animateWalk(a, t * 13 + 0.9, 1);
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
    });
    // (hit in the ribs: bent away from it, the head snapping toward it, the near arm flung up,
    // the legs knocked out sideways)
    const hit = jointsOf(a, () => {
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
      bendSpine(a, 0.2, -0.25, -0.45);
      a.neck.rotation.set(0.1, 0.2, 0.35);
      a.armL.rotation.set(-1.2, 0, 1.6);
      a.elbowL.rotation.set(-0.5, 0, 0);
      bendLeg(a.legL, a.kneeL, 0.4, 0.7);
      a.legL.rotation.z = 0.35;
      bendLeg(a.legR, a.kneeR, 0.1, 0.3);
    });
    const down = jointsOf(a, () => {
      tackledPose(a, 1, 'side', 1);
      // (rolled onto his right side, the ball arm stays tucked in, not out for the ground)
      a.armR.rotation.set(-0.9, 0, 0.15);
      a.elbowR.rotation.set(-1.9, 0, 0);
    });
    if (t < TC) put(a, run);
    else if (t < 0.44) mix(a, run, hit, ramp(t, TC, TC + 0.09));
    else mix(a, hit, down, ramp(t, 0.44, 0.8));
    a.group.updateMatrixWorld(true);

    // ---- The tackler: across from the runner's left, facing -x ----
    root(b, T.x(t), T.y(t), T.z(t), -Math.PI / 2, T.pitch(t));
    if (adjust.tackler) b.group.position.add(adjust.tackler);
    const come = jointsOf(b, () => {
      animateWalk(b, t * 12, 1);
      bendSpine(b, 0.45, 0, 0);
      b.neck.rotation.set(-0.55, 0, 0);
    });
    const drive = jointsOf(b, () => {
      animateWalk(b, t * 12, 0.6);
      bendSpine(b, 0.6, 0.3, 0);
      b.neck.rotation.set(-0.4, 0.5, 0); // (the head across in front of him)
    });
    const land = jointsOf(b, () => {
      tacklerPose(b, 1);
      bendLeg(b.legL, b.kneeL, 0.7, 0.6);
      bendLeg(b.legR, b.kneeR, 0.55, 0.8);
    });
    if (t < TC) put(b, come);
    else if (t < 0.55) mix(b, come, drive, ramp(t, TC, TC + 0.12));
    else mix(b, drive, land, ramp(t, 0.55, TD));
    // (the arms round his body: one hand on his far side at the back, the other at the front)
    const wrap = ramp(t, TC - 0.12, TC + 0.03);
    for (const [side, sz] of [['L', -1], ['R', 1]]) {
      const far = pointOn(a.chest, -0.24, -0.12, sz * 0.13, b);
      const reach = new THREE.Vector3(side === 'L' ? 0.3 : -0.3, 1.15, 0.55);
      reachArm(b, side, reach.lerp(far, wrap), new THREE.Vector3(side === 'L' ? 1 : -1, -0.2, -0.3), null, null, 'group');
    }
  },
};
