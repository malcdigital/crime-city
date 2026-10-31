import * as THREE from 'three';

// How far two characters are inside each other (paired animations: src/paired.js). Every body
// part is a box; each box's corners, edge middles, face middles and center are tested against
// the other man's boxes. A point inside a box is that deep in (the shortest way out), and that
// way out, in the world, is how to push them apart.
//   overlap(a, b, skipA, skipB) → { depth: deepest (m), push: Vector3 to move b by to clear it,
//   parts: [a part, b part] of the deepest }
// skipA / skipB: joint names whose own boxes don't count (hands meant to be on the other man).

const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mn = new THREE.Vector3();
const _mx = new THREE.Vector3();

// (the boxes of a character: its meshes, with their world matrices and names)
function boxes(c, skip) {
  const out = [];
  const skipNodes = new Set((skip || []).map((j) => c[j]).filter(Boolean));
  c.group.updateMatrixWorld(true);
  c.group.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.visible) return;
    if (skipNodes.has(m.parent)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const part = Object.keys(c).find((k) => c[k] === m.parent) || 'group';
    out.push({ m, bb: m.geometry.boundingBox, part });
  });
  return out;
}
// (sample points of a box, in the world)
function samples(B) {
  const { min, max } = B.bb;
  const xs = [min.x, (min.x + max.x) / 2, max.x];
  const ys = [min.y, (min.y + max.y) / 2, max.y];
  const zs = [min.z, (min.z + max.z) / 2, max.z];
  const pts = [];
  for (const x of xs) for (const y of ys) for (const z of zs) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(B.m.matrixWorld));
  return pts;
}
// (a point in a box: how deep, and which way out in the world)
function inside(p, B, out, margin = 0) {
  _inv.copy(B.m.matrixWorld).invert();
  _l.copy(p).applyMatrix4(_inv);
  const s = new THREE.Vector3();
  B.m.matrixWorld.decompose(_n, _q, s);
  // (margin: the box grown by that much all round, in the world: near enough counts)
  const mx = margin / (s.x || 1);
  const my = margin / (s.y || 1);
  const mz = margin / (s.z || 1);
  const min = _mn.set(B.bb.min.x - mx, B.bb.min.y - my, B.bb.min.z - mz);
  const max = _mx.set(B.bb.max.x + mx, B.bb.max.y + my, B.bb.max.z + mz);
  if (_l.x <= min.x || _l.x >= max.x || _l.y <= min.y || _l.y >= max.y || _l.z <= min.z || _l.z >= max.z) return 0;
  const opts = [
    [(_l.x - min.x) * s.x, -1, 0, 0], [(max.x - _l.x) * s.x, 1, 0, 0],
    [(_l.y - min.y) * s.y, 0, -1, 0], [(max.y - _l.y) * s.y, 0, 1, 0],
    [(_l.z - min.z) * s.z, 0, 0, -1], [(max.z - _l.z) * s.z, 0, 0, 1],
  ];
  let best = opts[0];
  for (const o of opts) if (o[0] < best[0]) best = o;
  out.set(best[1], best[2], best[3]).applyQuaternion(_q).normalize(); // (the way out of the box)
  return best[0];
}

export function overlap(a, b, skipA = [], skipB = [], margin = 0) {
  const A = boxes(a, skipA);
  const B = boxes(b, skipB);
  let depth = 0;
  let parts = null;
  const push = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sum = new THREE.Vector3();
  let n = 0;
  // (a's points in b's boxes: b moves the other way; b's points in a's boxes: b moves out)
  for (const [P, Q, sign] of [[A, B, -1], [B, A, 1]]) {
    for (const bp of P) {
      for (const p of samples(bp)) {
        for (const bq of Q) {
          const d = inside(p, bq, dir, margin);
          if (d <= 0) continue;
          sum.addScaledVector(dir, sign * d);
          n++;
          if (d > depth) {
            depth = d;
            push.copy(dir).multiplyScalar(sign * d);
            parts = sign < 0 ? [bp.part, bq.part] : [bq.part, bp.part];
          }
        }
      }
    }
  }
  // (the way to push: the deepest's way out, leaning toward the average of them all)
  if (n) push.lerp(sum.divideScalar(n).setLength(depth), 0.5);
  return { depth, push, parts };
}
