import * as THREE from 'three';
import { segmentBlockedPad } from './collision.js';
import { dist } from './util.js';
import { closestOnSeg, pointInPoly } from './geom.js';

// Sidewalks and crosswalks. People on foot stay on the sidewalks and only cross the street at
// the crosswalks at the junctions (unless they're allowed to cut across: running for cover,
// getting out of a car, or a buyer you waved over).
//
// The walking graph: points on the sidewalk at each corner of every block (wherever its outline
// turns), joined along the block's sides and across the street by crosswalks at the junctions.
// Shortest routes between every pair of points are worked out once at startup.

const CURB_REACH = 5; // a goal this far out into the road can be reached by stepping off the curb

const walkable = (b) => b && !b.lot && b.type !== 'ramps' && b.type !== 'place';

// The sidewalk points of a block (computed once): where its outline turns, 2 m in from the curb.
export function corners(b) {
  if (b._corners) return b._corners;
  const P = b.poly;
  const n = P.length;
  const keep = [];
  let turn = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n];
    const q = P[i];
    const c = P[(i + 1) % n];
    const a1 = Math.atan2(q[1] - a[1], q[0] - a[0]);
    const a2 = Math.atan2(c[1] - q[1], c[0] - q[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    turn += Math.abs(d);
    run += Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (Math.abs(d) > 0.35 || turn > 0.3 || run > 30) {
      keep.push(i);
      turn = 0;
      run = 0;
    }
  }
  if (keep.length < 3) for (let i = 0; i < n; i++) if (!keep.includes(i)) keep.push(i);
  keep.sort((p, q) => p - q);
  const [cx, cz] = [b.cx, b.cz];
  b._corners = keep.map((i) => {
    const [x, z] = P[i];
    // 2 m in, toward the middle of the block, kept inside the outline.
    let px = x;
    let pz = z;
    const a = P[(i + n - 1) % n];
    const c = P[(i + 1) % n];
    const ux = (a[0] - x) / (Math.hypot(a[0] - x, a[1] - z) || 1) + (c[0] - x) / (Math.hypot(c[0] - x, c[1] - z) || 1);
    const uz = (a[1] - z) / (Math.hypot(a[0] - x, a[1] - z) || 1) + (c[1] - z) / (Math.hypot(c[0] - x, c[1] - z) || 1);
    const L = Math.hypot(ux, uz);
    if (L > 0.05) {
      px = x + (ux / L) * 2.4;
      pz = z + (uz / L) * 2.4;
    }
    if (!pointInPoly(px, pz, P)) {
      const k = 2.4 / (Math.hypot(cx - x, cz - z) || 1);
      px = x + (cx - x) * k;
      pz = z + (cz - z) * k;
    }
    return [px, pz];
  });
  return b._corners;
}

export function buildSidewalks(city, scene) {
  const blocks = city.blocks.filter(walkable);
  const pts = [];
  const blockPts = new Map();
  for (const b of blocks) {
    const ids = [];
    corners(b).forEach(([x, z], c) => {
      const p = { x, z, b, c, id: pts.length };
      pts.push(p);
      ids.push(p.id);
    });
    blockPts.set(b, ids);
  }
  const M = pts.length;
  const adj = Array.from({ length: M }, () => []);
  const link = (a, b, cross = null) => {
    const d = dist(pts[a].x, pts[a].z, pts[b].x, pts[b].z);
    adj[a].push([b, d, cross]);
    adj[b].push([a, d, cross]);
  };
  for (const ids of blockPts.values()) for (let k = 0; k < ids.length; k++) link(ids[k], ids[(k + 1) % ids.length]);
  // Crosswalks across each arm of each junction.
  const crossings = [];
  const streets = city.streetsRef;
  const nearestPt = (b, x, z) => {
    let best = null;
    let bd = 14;
    for (const id of blockPts.get(b) || []) {
      const d = dist(pts[id].x, pts[id].z, x, z);
      if (d < bd) {
        bd = d;
        best = pts[id];
      }
    }
    return best;
  };
  const blockNear = (x, z) => {
    const b = city.blockAt(x, z);
    if (walkable(b)) return b;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, 3], [3, -3], [-3, -3]]) {
      const o = city.blockAt(x + dx, z + dz);
      if (walkable(o)) return o;
    }
    return null;
  };
  const seen = new Set();
  for (const n of city.nodes) {
    if (!n.street || !n.edges || n.edges.length < 3) continue;
    const ctl = streets?.control.get(n);
    for (const e of n.edges) {
      if (e.cls === 'pier' || e.street?.stub !== undefined) continue;
      const m = e.other(n);
      const L = Math.hypot(m.x - n.x, m.z - n.z) || 1;
      const ux = (m.x - n.x) / L;
      const uz = (m.z - n.z) / L;
      const arm = ctl?.arms.find((a) => a.m === m);
      const d = Math.min(L * 0.45, arm ? arm.stopAt - 2.2 : e.w / 2 + 3);
      const cx = n.x + ux * d;
      const cz = n.z + uz * d;
      const rx = -uz;
      const rz = ux;
      const off = e.w / 2 + 1.6;
      const A = [cx + rx * off, cz + rz * off];
      const B = [cx - rx * off, cz - rz * off];
      const ba = blockNear(...A);
      const bb = blockNear(...B);
      if (!ba || !bb || ba === bb) continue;
      const pa = nearestPt(ba, ...A);
      const pb = nearestPt(bb, ...B);
      if (!pa || !pb) continue;
      const key = pa.id < pb.id ? `${pa.id}-${pb.id}` : `${pb.id}-${pa.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Walking across this arm: you go with the traffic of the other phase.
      const cross = { a: pa, b: pb, n, axis: arm && arm.group === 1 ? 'NS' : 'EW', x0: cx + rx * (e.w / 2), z0: cz + rz * (e.w / 2), x1: cx - rx * (e.w / 2), z1: cz - rz * (e.w / 2), ux, uz, w: e.w };
      crossings.push(cross);
      link(pa.id, pb.id, cross);
    }
  }
  // Shortest routes from every point (Dijkstra toward each; next[] = first step on the way).
  const D = new Float32Array(M * M).fill(Infinity);
  const next = new Int16Array(M * M).fill(-1);
  const heap = new MinHeap();
  for (let t = 0; t < M; t++) {
    D[t * M + t] = 0;
    next[t * M + t] = t;
    heap.clear();
    heap.push(0, t);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > D[u * M + t]) continue;
      for (const [v, w] of adj[u]) {
        const nd = d + w;
        if (nd < D[v * M + t]) {
          D[v * M + t] = nd;
          next[v * M + t] = u;
          heap.push(nd, v);
        }
      }
    }
  }
  if (scene) drawCrosswalks(scene, crossings, city);
  return { pts, D, next, M, crossings, adj, blockPts };
}

// White zebra stripes across the road at every crossing.
function drawCrosswalks(scene, crossings, city) {
  const geo = new THREE.PlaneGeometry(0.55, 3);
  geo.rotateX(-Math.PI / 2);
  const bars = [];
  for (const c of crossings) {
    const L = Math.hypot(c.x1 - c.x0, c.z1 - c.z0);
    // Bars run along the road (across the walk), spaced across it.
    const ry = Math.atan2(c.ux, c.uz);
    for (let t = 0.9; t <= L - 0.8; t += 1.15) {
      const x = c.x0 + ((c.x1 - c.x0) * t) / L;
      const z = c.z0 + ((c.z1 - c.z0) * t) / L;
      bars.push([x, city.roadY(x, z) + 0.005, z, ry]);
    }
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xdedede }), Math.max(1, bars.length));
  mesh.count = bars.length;
  const dummy = new THREE.Object3D();
  bars.forEach(([x, y, z, ry], k) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
  });
  mesh.computeBoundingSphere();
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

// Distance from a point to a block (0 inside).
export function blockDist(b, x, z) {
  if (x < b.minX - 40 || x > b.maxX + 40 || z < b.minZ - 40 || z > b.maxZ + 40) return Infinity;
  if (pointInPoly(x, z, b.poly)) return 0;
  let d = Infinity;
  const P = b.poly;
  for (let i = 0; i < P.length; i++) {
    const q = P[(i + 1) % P.length];
    d = Math.min(d, closestOnSeg(x, z, P[i][0], P[i][1], q[0], q[1]).d);
  }
  return d;
}

// The block whose sidewalk is closest to (x, z) (never empty).
export function sideBlock(city, x, z) {
  const inside = city.blockAt(x, z);
  if (walkable(inside)) return [inside, 0];
  let best = null;
  let bestD = Infinity;
  for (const b of city.blocks) {
    if (!walkable(b)) continue;
    const d = blockDist(b, x, z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (!best) {
    // Far from everything: the nearest by middle.
    for (const b of city.blocks) {
      if (!walkable(b)) continue;
      const d = dist(b.cx, b.cz, x, z);
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
  const P = b.poly;
  let best = null;
  for (let i = 0; i < P.length; i++) {
    const q = P[(i + 1) % P.length];
    const c = closestOnSeg(x, z, P[i][0], P[i][1], q[0], q[1]);
    if (!best || c.d < best.d) best = c;
  }
  const L = Math.hypot(b.cx - best.x, b.cz - best.z) || 1;
  if (pointInPoly(x, z, P) && best.d >= back) return [x, z];
  return [best.x + ((b.cx - best.x) / L) * back, best.z + ((b.cz - best.z) / L) * back];
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
  let target = [gx, gz];
  if (gd > 0) {
    const landing = curbPoint(gb, gx, gz);
    if (gd > CURB_REACH) target = landing;
    else if (blockDist(gb, e.x, e.z) < CURB_REACH + 0.5 && (dist(e.x, e.z, ...landing) < 2.5 || dist(e.x, e.z, gx, gz) < 6)) return [gx, gz];
    else target = landing;
  }
  const [tx, tz] = target;
  const ebRaw = city.blockAt(e.x, e.z);
  const eb = walkable(ebRaw) ? ebRaw : null;
  if (eb === gb && clear(e.x, e.z, tx, tz)) return target;
  const M = W.M;
  const exits = [];
  for (const id of W.blockPts.get(gb) || []) {
    const p = W.pts[id];
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
    for (const c of W.crossings) {
      const { a, b } = c;
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
  let best = Infinity;
  let from = null;
  let to = null;
  for (const id of W.blockPts.get(eb) || []) {
    const p = W.pts[id];
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

// A sidewalk point to run to, away from a threat and not too far.
export function sidewalkEscape(game, e, threatX, threatZ) {
  let best = null;
  let bestScore = -Infinity;
  const dThreat = dist(e.x, e.z, threatX, threatZ);
  for (const p of game.city.walk.pts) {
    const de = dist(p.x, p.z, e.x, e.z);
    if (de < 8 || de > 75) continue;
    const dt = dist(p.x, p.z, threatX, threatZ);
    if (dt < dThreat) continue;
    const score = dt - de * 0.5 + Math.random() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ? [best.x, best.z] : null;
}

// Walking on from point p (on its block): the neighbors along the block, and the crosswalks.
export function walkNeighbors(W, p) {
  return W.adj[p.id].map(([id, d, cross]) => ({ p: W.pts[id], d, cross }));
}
export { walkable };
