import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';
import { chainFence } from './court.js';

// Surface parking lots (beyond the ones built with the courts and the field). Each lot is
// asphalt rectangles plus rows of nose-in spaces running east-west; parked cars fill about half
// of them (parking.js picks up `spots`).
// - Market St Park lot: across Market St from the park, on the grass between the crosstown
//   freeway, Court St and Madison Ave. A main aisle the length of the strip (out onto Madison
//   Ave at the east end, a driveway onto Market St facing the park) and, where the grass is
//   deeper by the freeway, a second aisle onto the side street up to Court St, joined to the
//   main one at the west end.
const STALL = 2.7;
export const LOTS = [
  {
    name: 'Market St Park parking',
    asphalt: [
      [537, 872.3, 628.5, 889.6], // the strip along Market St
      [537, 855, 581.5, 872.3], // the deeper part by the freeway
    ],
    // Rows: x0..x1 of stalls, z0..z1 deep, nose: -1 parks facing north, +1 facing south.
    rows: [
      { x0: 543.5, x1: 625, z0: 884.5, z1: 889.4, nose: 1, gaps: [[597, 604.5], [610.5, 614.5]] }, // along Market St (the driveway; a street lamp)
      { x0: 543.5, x1: 625, z0: 872.5, z1: 878, nose: -1 },
      { x0: 543.5, x1: 580, z0: 867, z1: 872.5, nose: 1 }, // (back to back with the row above)
      { x0: 543.5, x1: 580, z0: 855.2, z1: 860.5, nose: -1 },
    ],
    trees: [[534, 858], [534, 868], [534, 880], [627, 874.5]],
    // A chain-link fence round it, open at the three ways in (and round a street lamp).
    fence: [
      [[537, 855], [581.5, 855]],
      [[581.5, 855], [581.5, 860.3]],
      [[581.5, 867.2], [581.5, 872.3]], // (gap: the side street)
      [[581.5, 872.3], [628.5, 872.3]],
      [[628.5, 872.3], [628.5, 877.8]],
      [[628.5, 884.7], [628.5, 889.6]], // (gap: Madison Ave)
      [[628.5, 889.6], [613.3, 889.6]],
      [[611.5, 889.6], [604.5, 889.6]], // (gap: the lamp post)
      [[597, 889.6], [537, 889.6]], // (gap: the driveway onto Market St)
      [[537, 889.6], [537, 855]],
    ],
  },
];

export const LOT_RESERVED = LOTS.flatMap((l) => l.asphalt.map(([x0, z0, x1, z1]) => [x0 - 1, z0 - 1, x1 + 1, z1 + 1]));

const box = (w, h, d, x, y, z) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const flat = (x0, z0, x1, z1, y) => {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
};

export function buildLots(city, scene) {
  const asphalt = [];
  const paint = [];
  const white = [];
  const trunk = [];
  const leaves = [];
  const spots = [];
  for (const lot of LOTS) {
    for (const [x0, z0, x1, z1] of lot.asphalt) asphalt.push(flat(x0, z0, x1, z1, 0.035));
    for (const r of lot.rows) {
      const head = r.nose < 0 ? r.z0 : r.z1; // (the end the cars' noses point at)
      const n = Math.floor((r.x1 - r.x0) / STALL);
      const inGap = (x) => (r.gaps || []).some(([a, b]) => x > a - 0.2 && x < b + 0.2);
      for (let k = 0; k <= n; k++) {
        const x = r.x0 + k * STALL;
        if (inGap(x)) continue;
        paint.push(box(0.12, 0.01, r.z1 - r.z0, x, 0.045, (r.z0 + r.z1) / 2));
      }
      for (let k = 0; k < n; k++) {
        const x = r.x0 + (k + 0.5) * STALL;
        if (inGap(x - STALL / 2) || inGap(x + STALL / 2)) continue;
        paint.push(box(STALL, 0.01, 0.12, x, 0.045, head));
        white.push(box(1.6, 0.12, 0.2, x, 0.095, head - r.nose * 0.6)); // wheel stop
        spots.push({ x, z: (r.z0 + r.z1) / 2 + r.nose * 0.3, heading: r.nose < 0 ? Math.PI : 0 });
      }
    }
    for (const [x, z] of lot.trees || []) {
      trunk.push(new THREE.CylinderGeometry(0.15, 0.22, 2.4, 6).translate(x, 1.2, z));
      leaves.push(new THREE.IcosahedronGeometry(1.5, 0).translate(x, 3.1, z));
    }
  }
  const add = (list, mat, shadow) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
  };
  add(asphalt, lam(0x3a3d42), false);
  add(paint, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), false);
  add(white, lam(0xe9e9e4), true);
  add(trunk, lam(0x5a3d24), true);
  add(leaves, lam(0x3f7a35), true);
  for (const lot of LOTS) for (const [x, z] of lot.trees || []) city.colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, h: 2.4 });
  for (const lot of LOTS) if (lot.fence) chainFence(city, scene, lot.fence);
  return { spots };
}

// On the 2D maps.
export function drawLots(ctx, s) {
  ctx.fillStyle = '#4a4d52';
  for (const lot of LOTS) for (const [x0, z0, x1, z1] of lot.asphalt) ctx.fillRect(x0 * s, z0 * s, (x1 - x0) * s, (z1 - z0) * s);
}
