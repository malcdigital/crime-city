import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { fbPose, tackledPose, tacklerPose } from '../footballpose.js';
import { curve, ramp, put, mix, jointsOf, root, pointOn } from './kit.js';

// A tackle from behind, authored as one scene (src/paired.js): the runner going away up the
// field (+z) with the ball tucked, the tackler chasing him down. He launches, wraps both arms
// round the runner's hips from behind (his hands meeting in front of them, wherever the runner
// is) and drags him down: the runner pitches forward onto his front, arms out to break the
// fall, the tackler down on the backs of his legs.

const TC = 0.32; // (contact)
const TD = 0.86; // (down)

const R = {
  z: curve([[0, -1.25], [TC, 0.7], [0.5, 1.5], [0.7, 2.05], [TD, 2.3], [1.6, 2.36]]),
  y: curve([[0, 0], [0.5, 0], [0.7, 0.06], [TD, 0.12], [0.95, 0.15], [1.05, 0.12], [1.6, 0.12]]),
  pitch: curve([[0, 0], [0.15, 0.06], [TC, 0.08], [0.5, 0.45], [0.7, 1.2], [TD, 1.44], [1.6, 1.44]]),
};
const T = {
  z: curve([[0, -3.25], [0.16, -2.1], [TC, -0.62], [0.5, 0.1], [0.7, 0.45], [TD, 0.55], [1.6, 0.58]]),
  y: curve([[0, 0], [0.14, 0], [0.24, 0.3], [TC, 0.34], [0.5, 0.24], [0.7, 0.14], [TD, 0.1], [1.6, 0.1]]),
  pitch: curve([[0, 0.2], [0.14, 0.35], [TC, 1.12], [0.5, 1.32], [0.7, 1.45], [TD, 1.5], [1.6, 1.5]]),
};

export default {
  name: 'tackle-behind',
  fps: 30,
  length: 1.6,
  actors: ['runner', 'tackler'],
  events: { contact: Math.round(TC * 30), down: Math.round(TD * 30) },
  props: { runner: { ball: 'tuck' } },
  contact: { move: 'tackler', against: 'runner', skip: { tackler: ['wristL', 'wristR'] }, tol: 0.015 },
  pose(t, { runner: a, tackler: b }, adjust = {}) {
    // ---- The runner: going away up the field, the ball tucked ----
    root(a, 0, R.y(t), R.z(t), 0, R.pitch(t));
    if (adjust.runner) a.group.position.add(adjust.runner);
    const run = jointsOf(a, () => {
      animateWalk(a, t * 13 + 0.4, 1);
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
    });
    // (hit from behind: the head and chest thrown back, the free arm flung forward, the legs
    // caught: one dragged back, the other stepping out)
    const hit = jointsOf(a, () => {
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
      bendSpine(a, -0.25, 0.1, 0);
      a.neck.rotation.set(-0.45, 0, 0);
      a.armL.rotation.set(-1.8, 0, 0.45);
      a.elbowL.rotation.set(-0.3, 0, 0);
      bendLeg(a.legL, a.kneeL, 0.55, 0.5);
      bendLeg(a.legR, a.kneeR, -0.1, 0.45); // (dragged, not kicked back into him)
    });
    const down = jointsOf(a, () => tackledPose(a, 1, 'behind'));
    if (t < TC) put(a, run);
    else if (t < 0.46) mix(a, run, hit, ramp(t, TC, TC + 0.1));
    else mix(a, hit, down, ramp(t, 0.46, 0.8));
    a.group.updateMatrixWorld(true);

    // ---- The tackler: chasing him down, the launch, the wrap ----
    root(b, -0.04, T.y(t), T.z(t), 0, T.pitch(t));
    if (adjust.tackler) b.group.position.add(adjust.tackler);
    const chase = jointsOf(b, () => {
      animateWalk(b, t * 14, 1);
      bendSpine(b, 0.3, 0, 0);
      b.neck.rotation.set(-0.5, 0, 0);
    });
    // (in the air: stretched out, legs trailing, head up behind him)
    const fly = jointsOf(b, () => {
      bendSpine(b, -0.1, 0, 0);
      b.neck.rotation.set(-0.7, 0, 0);
      bendLeg(b.legL, b.kneeL, -0.15, 0.4);
      bendLeg(b.legR, b.kneeR, 0.1, 0.7);
    });
    const land = jointsOf(b, () => {
      tacklerPose(b, 1);
      bendLeg(b.legL, b.kneeL, 0.55, 0.6);
      bendLeg(b.legR, b.kneeR, 0.4, 0.8);
    });
    if (t < 0.14) put(b, chase);
    else if (t < 0.5) mix(b, chase, fly, ramp(t, 0.14, 0.26));
    else mix(b, fly, land, ramp(t, 0.5, TD));
    // (the arms: reaching for him, then round his hips from behind, the hands meeting in front;
    // sliding down round his thighs as he's dragged down)
    const wrap = ramp(t, TC - 0.14, TC + 0.02);
    const slide = ramp(t, 0.45, 0.75);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const hips = pointOn(a.spine, sx * 0.13, -0.08, 0.17, b);
      const thigh = pointOn(side === 'L' ? a.legL : a.legR, -sx * 0.06, -0.32, 0.13, b);
      const reach = new THREE.Vector3(sx * 0.28, 1.25, 0.6);
      reachArm(b, side, reach.lerp(hips.lerp(thigh, slide), wrap), new THREE.Vector3(sx, 0.2, -0.3), null, null, 'group');
    }
  },
};
