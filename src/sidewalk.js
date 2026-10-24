import * as THREE from 'three';
import { CFG } from './config.js';
import { segmentBlockedPad } from './collision.js';
import { dist } from './util.js';

// Sidewalks and crosswalks. People on foot stay on the sidewalks and only cross the street at
// the crosswalks next to each intersection (unless they're allowed to cut across: running
// for cover, getting out of a car, or a buyer you waved over).
//
// The walking graph: four corner points per block (on the sidewalk), joined along the block's
// sides and across the street by crosswalks. Shortest routes between every pair of corners are
// worked out once at startup.

const N = CFG.BLOCKS;
const CURB_REACH = 5; // a goal this far out into the road can be reached by stepping off the curb

// Sidewalk corner points around a block, clockwise.
export function corners(b) {
  const x0 = b.minX + 2, x1 = b.maxX - 2, z0 = b.minZ + 2, z1 = b.maxZ - 2;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

// Where a pedestrian at a corner can cross to: [di, dj, corner on the new block].
export const CROSSINGS = [
  [[-1, 0, 1], [0, -1, 3]],
  [[1, 0, 0], [0, -1, 2]],
  [[1, 0, 3], [0, 1, 1]],
  [[-1, 0, 2], [0, 1, 0]],
];

export function buildSidewalks(city, scene) {
  const blocks = city.blocks;
  const pts = []; // corner id = block index * 4 + corner
  for (const b of blocks) corners(b).forEach(([x, z], c) => pts.push({ x, z, b, c, id: pts.length }));
  const M = pts.length;
  const D = new Float32Array(M * M).fill(Infinity);
  const next = new Int16Array(M * M).fill(-1);
  const adj = Array.from({ length: M }, () => []);
  const link = (a, b) => {
    const d = dist(pts[a].x, pts[a].z, pts[b].x, pts[b].z);
    adj[a].push([b, d]);
    adj[b].push([a, d]);
  };
  const crossings = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    for (let c = 0; c < 4; c++) {
      const id = bi * 4 + c;
      link(id, bi * 4 + ((c + 1) % 4)); // along the block
      for (const [di, dj, nc] of CROSSINGS[c]) {
        const i = b.i + di;
        const j = b.j + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const o = (i * N + j) * 4 + nc;
        if (o < id) continue;
        link(id, o);
        crossings.push([pts[id], pts[o]]);
      }
    }
  }
  // Shortest routes from every corner (Dijkstra from each; next[] = first step on the way).
  // Built backwards: running from the destination, next[i -> dest] is the node we came from.
  const heap = new MinHeap();
  for (let t = 0; t < M; t++) {
    const row = t; // distances to t
    D[t * M + t] = 0;
    next[t * M + t] = t;
    heap.clear();
    heap.push(0, t);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > D[u * M + row]) continue;
      for (const [v, w] of adj[u]) {
        const nd = d + w;
        if (nd < D[v * M + row]) {
          D[v * M + row] = nd;
          next[v * M + row] = u; // from v, step to u to get closer to t
          heap.push(nd, v);
        }
      }
    }
  }
  if (scene) drawCrosswalks(scene, crossings);
  return { pts, D, next, M, crossings };
}

// White zebra stripes across the road at every crossing.
function drawCrosswalks(scene, crossings) {
  const R = CFG.ROAD;
  const P = CFG.PITCH;
  const geo = new THREE.PlaneGeometry(0.55, 3);
  geo.rotateX(-Math.PI / 2);
  const bars = [];
  for (const [a, b] of crossings) {
    const alongX = Math.abs(a.x - b.x) > Math.abs(a.z - b.z); // walking along x, across an avenue
    if (alongX) {
      const rx = Math.round((a.x + b.x) / 2 / P) * P;
      for (let t = -R / 2 + 0.9; t <= R / 2 - 0.8; t += 1.15) bars.push([rx + t, a.z, 0]);
    } else {
      const rz = Math.round((a.z + b.z) / 2 / P) * P;
      for (let t = -R / 2 + 0.9; t <= R / 2 - 0.8; t += 1.15) bars.push([a.x, rz + t, Math.PI / 2]);
    }
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xdedede }), bars.length);
  const dummy = new THREE.Object3D();
  bars.forEach(([x, z, ry], k) => {
    dummy.position.set(x, 0.025, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
  });
  scene.add(mesh);
}

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }

  get size() {
    return this.k.length;
  }

  clear() {
    this.k.length = 0;
    this.v.length = 0;
  }

  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }

  pop() {
    const k = this.k;
    const v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

// Distance from a point to a block's rectangle (0 inside).
function rectDist(b, x, z) {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

// The block whose sidewalk is closest to (x, z).
export function sideBlock(city, x, z) {
  const inside = city.blockAt(x, z);
  if (inside) return [inside, 0];
  const P = CFG.PITCH;
  const fi = Math.floor(x / P);
  const fj = Math.floor(z / P);
  let best = null;
  let bestD = Infinity;
  for (let i = fi - 1; i <= fi + 1; i++) {
    for (let j = fj - 1; j <= fj + 1; j++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const b = city.blocks[i * N + j];
      const d = rectDist(b, x, z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return [best, bestD];
}

// The spot at the edge of block b nearest (x, z), a step back from the curb.
export function curbPoint(b, x, z, back = 0.8) {
  return [Math.max(b.minX + back, Math.min(x, b.maxX - back)), Math.max(b.minZ + back, Math.min(z, b.maxZ - back))];
}

// Can someone at (ax, az) walk to (bx, bz) without crossing the street?
export function sameSide(city, ax, az, bx, bz) {
  const [ba] = sideBlock(city, ax, az);
  const [bb, d] = sideBlock(city, bx, bz);
  return ba === bb && d <= CURB_REACH;
}

// Next point to head for on the way to (gx, gz), on the sidewalks and crosswalks.
export function sidewalkWaypoint(game, e, gx, gz) {
  const city = game.city;
  const W = city.walk;
  const clear = (ax, az, bx, bz) => !segmentBlockedPad(ax, az, bx, bz, city.los, 0.3);
  const [gb, gd] = sideBlock(city, gx, gz);
  // A goal out in the road: step off the curb next to it (if it's close enough), or wait at the curb.
  let target = [gx, gz];
  if (gd > 0) {
    const landing = curbPoint(gb, gx, gz);
    if (gd > CURB_REACH) target = landing;
    else if (rectDist(gb, e.x, e.z) < CURB_REACH + 0.5 && (dist(e.x, e.z, ...landing) < 2.5 || dist(e.x, e.z, gx, gz) < 6)) return [gx, gz];
    else target = landing;
  }
  const [tx, tz] = target;
  const eb = city.blockAt(e.x, e.z);
  if (eb === gb && clear(e.x, e.z, tx, tz)) return target;
  const M = W.M;
  // Exit corners: on the goal's block, with a clear walk to the target.
  const exits = [];
  for (let c = 0; c < 4; c++) {
    const p = W.pts[(gb.i * N + gb.j) * 4 + c];
    if (clear(p.x, p.z, tx, tz)) exits.push([p, dist(p.x, p.z, tx, tz)]);
  }
  if (!exits.length) return target;
  const cost = (p) => {
    let best = Infinity;
    let pick = null;
    for (const [q, dq] of exits) {
      const d = W.D[p.id * M + q.id] + dq;
      if (d < best) {
        best = d;
        pick = q;
      }
    }
    return [best, pick];
  };
  if (!eb) {
    // In the road. On a crosswalk: carry on to whichever end gets us there. Otherwise get to
    // the nearest sidewalk.
    for (const [a, b] of W.crossings) {
      if (segDist(e.x, e.z, a.x, a.z, b.x, b.z) < 2) {
        const ca = dist(e.x, e.z, a.x, a.z) + cost(a)[0];
        const cb = dist(e.x, e.z, b.x, b.z) + cost(b)[0];
        const p = ca <= cb ? a : b;
        return [p.x, p.z];
      }
    }
    const [nb] = sideBlock(city, e.x, e.z);
    return curbPoint(nb, e.x, e.z, 1.2);
  }
  // Entry corner on our block, then the shortest way round.
  const bi = eb.i * N + eb.j;
  let best = Infinity;
  let from = null;
  let to = null;
  for (let c = 0; c < 4; c++) {
    const p = W.pts[bi * 4 + c];
    if (!clear(e.x, e.z, p.x, p.z)) continue;
    const [d, q] = cost(p);
    const total = dist(e.x, e.z, p.x, p.z) + d;
    if (total < best) {
      best = total;
      from = p;
      to = q;
    }
  }
  if (!from) return target;
  if (dist(e.x, e.z, from.x, from.z) > 0.8) return [from.x, from.z];
  if (from === to) return target;
  const n = W.pts[W.next[from.id * M + to.id]];
  return [n.x, n.z];
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

// A sidewalk corner to run to, away from a threat and not too far.
export function sidewalkEscape(game, e, threatX, threatZ) {
  let best = null;
  let bestScore = -Infinity;
  const dThreat = dist(e.x, e.z, threatX, threatZ);
  for (const p of game.city.walk.pts) {
    const de = dist(p.x, p.z, e.x, e.z);
    if (de < 8 || de > 75) continue;
    const dt = dist(p.x, p.z, threatX, threatZ);
    if (dt < dThreat) continue; // don't run past the threat
    const score = dt - de * 0.5 + Math.random() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ? [best.x, best.z] : null;
}
