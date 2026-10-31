import * as THREE from 'three';

// What the paired scenes (src/paired/*.js) are written with: keyed curves for the roots, and
// whole poses snapshotted and blended into each other.

// A smooth curve through keyed values: [time, value] pairs (Catmull-Rom between them, held at
// the ends), so the bodies carry their speed through the keys instead of stopping at each.
export function curve(keys) {
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
export const ease = (k) => k * k * (3 - 2 * k);
export const clamp01 = (k) => Math.max(0, Math.min(1, k));
// (a 0..1 ramp from a to b seconds, eased)
export const ramp = (t, a, b) => ease(clamp01((t - a) / (b - a)));

// (a pose's joint rotations, to blend from one pose into another)
export const J = ['spine', 'chest', 'neck', 'legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];
export const snap = (c) => J.map((j) => c[j].quaternion.clone());
export const put = (c, S) => J.forEach((j, i) => c[j].quaternion.copy(S[i]));
export const mix = (c, A, B, w) => J.forEach((j, i) => c[j].quaternion.copy(A[i]).slerp(B[i], w));
const zero = (c) => J.forEach((j) => c[j].rotation.set(0, 0, 0));
// (a pose made by fn, its joints only: whatever it does to the root is put back)
export function jointsOf(c, fn) {
  const p = c.group.position.clone();
  const r = c.group.rotation.clone();
  zero(c);
  fn();
  c.group.position.copy(p);
  c.group.rotation.copy(r);
  return snap(c);
}
// (a root: position and yaw / pitch / roll, the game's rotation order)
export function root(c, x, y, z, yaw, pitch = 0, roll = 0) {
  c.group.rotation.order = 'YXZ';
  c.group.position.set(x, y, z);
  c.group.rotation.set(pitch, yaw, roll);
}
// (a point on one man (his node's local coords) in another man's own frame: to reach for it)
const _v = new THREE.Vector3();
export function pointOn(node, x, y, z, frameOf, out = new THREE.Vector3()) {
  node.localToWorld(_v.set(x, y, z));
  frameOf.group.updateMatrixWorld(true);
  return out.copy(frameOf.group.worldToLocal(_v));
}
