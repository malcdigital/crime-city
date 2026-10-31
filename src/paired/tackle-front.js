import * as THREE from 'three';
import { animateWalk, bendSpine, bendLeg, reachArm } from '../character.js';
import { fbPose, tackledPose, tacklerPose } from '../footballpose.js';

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

// A smooth curve through keyed values: [time, value] pairs (Catmull-Rom between them, held at
// the ends), so the bodies carry their speed through the keys instead of stopping at each.
function curve(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    const n = keys.length - 1;
    if (t >= keys[n][0]) return keys[n][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t1, p1] = keys[i];
    const [t2, p2] = keys[i + 1];
    const p0 = i > 0 ? keys[i - 1][1] : p1 - (p2 - p1);
    const p3 = i + 2 <= n ? keys[i + 2][1] : p2 + (p2 - p1);
    const u = (t - t1) / (t2 - t1);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
}
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

// The roots: where each man's feet are and how he's tipped, through the tackle.
const R = {
  z: curve([[0, -1.8], [TC, 0], [0.42, 0.22], [0.6, 0.12], [0.8, -0.25], [TD, -0.35], [1.6, -0.38]]),
  y: curve([[0, 0], [0.42, 0], [0.6, 0.12], [0.8, 0.2], [TD, 0.22], [0.95, 0.26], [1.05, 0.22], [1.6, 0.22]]),
  pitch: curve([[0, 0], [TC, 0], [0.42, 0.05], [0.6, -0.55], [0.8, -1.35], [TD, -1.42], [1.6, -1.42]]),
};
const T = {
  z: curve([[0, 2.0], [TC, 0.75], [0.42, 0.55], [0.6, 0.3], [0.8, -0.05], [TD, -0.15], [1.6, -0.18]]),
  y: curve([[0, 0], [TC, 0], [0.6, 0.05], [0.8, 0.32], [TD, 0.42], [0.96, 0.36], [1.6, 0.38]]),
  pitch: curve([[0, 0], [TC, 0.1], [0.42, 0.25], [0.6, 0.75], [0.8, 1.25], [TD, 1.33], [1.6, 1.33]]),
};

// (a pose's joint rotations, to blend from one pose into another)
const J = ['spine', 'chest', 'neck', 'legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];
const snap = (c) => J.map((j) => c[j].quaternion.clone());
const put = (c, S) => J.forEach((j, i) => c[j].quaternion.copy(S[i]));
const mix = (c, A, B, w) => J.forEach((j, i) => c[j].quaternion.copy(A[i]).slerp(B[i], w));
const zero = (c) => J.forEach((j) => c[j].rotation.set(0, 0, 0));
// (a pose function that also sets the root: run it with the root kept)
function jointsOf(c, fn) {
  const p = c.group.position.clone();
  const r = c.group.rotation.clone();
  zero(c);
  fn();
  c.group.position.copy(p);
  c.group.rotation.copy(r);
  return snap(c);
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export default {
  name: 'tackle-front',
  fps: 30,
  length: 1.6,
  actors: ['runner', 'tackler'],
  events: { contact: Math.round(TC * 30), down: Math.round(TD * 30) },
  props: { runner: { ball: 'tuck' } },
  pose(t, { runner: a, tackler: b }) {
    // ---- The runner: up the field (+z), the ball tucked under his right arm ----
    a.group.rotation.order = 'YXZ';
    a.group.position.set(0, R.y(t), R.z(t));
    a.group.rotation.set(R.pitch(t), 0, 0);
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
      a.armL.rotation.set(-1.9, 0, 0.9);
      a.elbowL.rotation.set(-0.4, 0, 0);
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
    const land = jointsOf(b, () => tacklerPose(b, 1));
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
