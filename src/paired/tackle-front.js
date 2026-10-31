import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { fbPose, tackledPose, tacklerPose } from '../footballpose.js';
import { curve, ease, clamp01, put, mix, jointsOf } from './kit.js';

// A head-on tackle, authored as one scene (src/paired.js): the runner coming up the field (+z)
// with the ball tucked, the tackler coming the other way low. At contact (0.30 s) the tackler's
// shoulder goes into the runner's midsection and his arms wrap round the runner's hips (his hands
// put on the runner's back, wherever the runner is, every frame), he drives through, the runner's
// legs go out from under him and he's put on his back with the tackler landing on top of him.
//
// Both are posed here in one space; tools/paired/bake.mjs exports a clip for each and the
// alignment between them.

const TC = 0.3; // (contact)
const TD = 0.88; // (down)

// The roots: where each man's feet are and how he's tipped, through the tackle.
const R = {
  z: curve([[0, -1.8], [TC, 0], [0.42, 0.22], [0.6, 0.12], [0.8, -0.25], [TD, -0.35], [1.6, -0.38]]),
  y: curve([[0, 0], [0.42, 0], [0.6, 0.12], [0.8, 0.2], [TD, 0.22], [0.95, 0.26], [1.05, 0.22], [1.6, 0.22]]),
  pitch: curve([[0, 0], [TC, 0], [0.42, 0.05], [0.6, -0.55], [0.8, -1.35], [TD, -1.42], [1.6, -1.42]]),
};
const T = {
  z: curve([[0, 2.0], [TC, 0.75], [0.42, 0.55], [0.6, 0.3], [0.8, -0.05], [TD, -0.15], [1.6, -0.18]]),
  y: curve([[0, 0], [TC, 0], [0.6, 0.05], [0.8, 0.2], [TD, 0.26], [0.96, 0.22], [1.6, 0.22]]),
  pitch: curve([[0, 0], [TC, 0.1], [0.42, 0.25], [0.6, 0.75], [0.8, 1.25], [TD, 1.33], [1.6, 1.33]]),
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export default {
  name: 'tackle-front',
  fps: 30,
  length: 1.6,
  actors: ['runner', 'tackler'],
  events: { contact: Math.round(TC * 30), down: Math.round(TD * 30) },
  props: { runner: { ball: 'tuck' } },
  // (bodies don't go through each other: the tackler's pushed clear of the runner, his hands
  // still on him; src/paired.js contact)
  contact: { move: 'tackler', against: 'runner', skip: { tackler: ['wristL', 'wristR'] }, tol: 0.015 },
  pose(t, { runner: a, tackler: b }, adjust = {}) {
    // ---- The runner: up the field (+z), the ball tucked under his right arm ----
    a.group.rotation.order = 'YXZ';
    a.group.position.set(0, R.y(t), R.z(t));
    a.group.rotation.set(R.pitch(t), 0, 0);
    if (adjust.runner) a.group.position.add(adjust.runner);
    const run = jointsOf(a, () => {
      animateWalk(a, t * 13 + 0.6, 1);
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
    });
    // (hit: the upper body jack-knifes over the tackler, the head snaps forward, the free arm
    // flung out, the legs going out from under him)
    const hit = jointsOf(a, () => {
      fbPose(a, { lower: ['run'], upper: ['tuck', 6] });
      bendSpine(a, 0.55, -0.15, 0.1);
      a.neck.rotation.set(0.35, 0.2, 0);
      a.armL.rotation.set(-1.4, 0, 1.55); // (flung out wide, clear of the tackler's arms)
      a.elbowL.rotation.set(-0.3, 0, 0);
      bendLeg(a.legL, a.kneeL, 0.9, 0.6);
      bendLeg(a.legR, a.kneeR, 0.35, 1.1);
    });
    const down = jointsOf(a, () => {
      tackledPose(a, 1, 'front');
      a.armL.rotation.set(-1.1, 0, 1.15); // (the free arm out to the side for the ground)
      a.elbowL.rotation.set(-0.35, 0, 0);
    });
    // (the hit folds him over; he's going over backwards by 0.44 s, the body following the tip)
    if (t < TC) put(a, run);
    else if (t < 0.44) mix(a, run, hit, ease(clamp01((t - TC) / 0.1)));
    else mix(a, hit, down, ease(clamp01((t - 0.44) / (0.78 - 0.44))));
    a.group.updateMatrixWorld(true);

    // ---- The tackler: coming the other way (-z), low ----
    b.group.rotation.order = 'YXZ';
    b.group.position.set(0.05, T.y(t), T.z(t));
    if (adjust.tackler) b.group.position.add(adjust.tackler);
    b.group.rotation.set(T.pitch(t), Math.PI, 0);
    const come = jointsOf(b, () => {
      animateWalk(b, t * 12, 1);
      bendSpine(b, 0.55, 0, 0);
      b.neck.rotation.set(-0.55, 0, 0); // (eyes up on him)
      bendLeg(b.legL, b.kneeL, b.legL.rotation.x < 0 ? -b.legL.rotation.x + 0.25 : 0.25, b.kneeL.rotation.x + 0.35);
      bendLeg(b.legR, b.kneeR, b.legR.rotation.x < 0 ? -b.legR.rotation.x + 0.25 : 0.25, b.kneeR.rotation.x + 0.35);
    });
    const drive = jointsOf(b, () => {
      // (driving through: low, head across to the side, the legs still churning)
      animateWalk(b, t * 12, 0.7);
      bendSpine(b, 0.7, 0.25, 0);
      b.neck.rotation.set(-0.45, 0.55, 0);
    });
    const land = jointsOf(b, () => {
      tacklerPose(b, 1);
      // (on top of him: the thighs down to the turf, knees on it, the shins along it)
      bendLeg(b.legL, b.kneeL, 0.75, 0.55);
      bendLeg(b.legR, b.kneeR, 0.6, 0.75);
    });
    if (t < TC) put(b, come);
    else if (t < 0.55) mix(b, come, drive, ease(clamp01((t - TC) / 0.12)));
    else mix(b, drive, land, ease(clamp01((t - 0.55) / (TD - 0.55))));
    // (the arms: coming up for him, then wrapped round his hips, the hands on his back, wherever
    // he is: his own points, into the tackler's frame)
    const wrap = clamp01((t - (TC - 0.12)) / 0.14);
    b.group.updateMatrixWorld(true);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      // (round his back: behind him at the hips, a hand on each side)
      a.spine.localToWorld(_v.set(-sx * 0.2, 0.0, -0.14)); // (tackler's left hand on the runner's right)
      b.group.worldToLocal(_v);
      // (before the wrap: out in front, reaching)
      _w.set(sx * 0.3, 1.0, 0.55);
      _w.lerp(_v, ease(wrap));
      reachArm(b, side, _w, new THREE.Vector3(sx, -0.3, -0.2), null, null, 'group');
    }
  },
};
