// Builds the city in 3D from the plan (worldplan.js): terrain with the hills and roads cut into
// them, the paved city and docks, sidewalks, buildings along every block's edges (at whatever
// angle the block sits), parks, trees and forest, the water and seawall, and the special places.
// Also the lookups the rest of the game uses: groundY, blockAt, nearestNode, streetAt, drawMap.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';
import { mulberry32 } from './util.js';
import { GFX, PHONE } from './quality.js';
import { area, bbox, centroid, closestOnSeg, insetConvex, isConvex, obb, pointInPoly } from './geom.js';
import {
  BLOCKS, GRAPH, STREETS, ROAD_CLASS, MAP, SEA, terrain, isWater, shoreDist, coastZ, insideRing, ringDist, districtAt,
} from './worldplan.js';
import { RAMPS, RING, RING_HALF, XT, XT_HALF, inHole, roundRect } from './fwyplan.js';
import { SPECIAL, STORES, PLACES, STYLES } from './districts.js';
import { buildCourt, drawCourt, COURT_RESERVED } from './court.js';

export { districtAt };
export const SIZE = MAP;

const RANK = { arterial: 5, collector: 4, under: 3, local: 2, hills: 2, pier: 1 };

// ---- Street names: the nearest street (spatial hash of the graph's edges) ----
const EH = 40;
const edgeHash = new Map();
for (const e of GRAPH.edges) {
  const i0 = Math.floor((Math.min(e.a.x, e.b.x) - 12) / EH);
  const i1 = Math.floor((Math.max(e.a.x, e.b.x) + 12) / EH);
  const j0 = Math.floor((Math.min(e.a.z, e.b.z) - 12) / EH);
  const j1 = Math.floor((Math.max(e.a.z, e.b.z) + 12) / EH);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = i * 1000 + j;
    if (!edgeHash.has(k)) edgeHash.set(k, []);
    edgeHash.get(k).push(e);
  }
}
// The nearest street edge to a point (within ~40 m), and how far.
export function edgeAt(x, z) {
  const i = Math.floor(x / EH);
  const j = Math.floor(z / EH);
  let best = null;
  let bd = Infinity;
  for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
    for (const e of edgeHash.get(a * 1000 + b) || []) {
      const c = closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
      if (c.d < bd) {
        bd = c.d;
        best = { e, d: c.d, t: c.t, x: c.x, z: c.z };
      }
    }
  }
  return best;
}
// Every street edge within r of a point (plus its own half width).
export function edgesNear(x, z, r) {
  const i = Math.floor(x / EH);
  const j = Math.floor(z / EH);
  const out = [];
  const seen = new Set();
  for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
    for (const e of edgeHash.get(a * 1000 + b) || []) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z).d < r + e.w / 2) out.push(e);
    }
  }
  return out;
}
// Name of the nearest named road, for news headlines.
export function streetAt(x, z) {
  const i = Math.floor(x / EH);
  const j = Math.floor(z / EH);
  let best = null;
  let bd = Infinity;
  for (let r = 1; r <= 3 && !best; r++) {
    for (let a = i - r; a <= i + r; a++) for (let b = j - r; b <= j + r; b++) {
      for (const e of edgeHash.get(a * 1000 + b) || []) {
        if (!e.name) continue;
        const c = closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z);
        if (c.d < bd) {
          bd = c.d;
          best = e.name;
        }
      }
    }
  }
  return best || districtAt(x, z);
}

// Building windows (some lit), and a matching glow map: only the lit windows, which light up
// at night (daynight.js turns the glow up after dark).
function windowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const c2 = document.createElement('canvas');
  c2.width = c2.height = 128;
  const g2 = c2.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g2.fillStyle = '#000000';
  g2.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const lit = rng() < 0.22;
      g.fillStyle = lit ? '#f1dc9a' : '#566779';
      g.fillRect(i * 32 + 7, j * 32 + 6, 18, 20);
      if (lit || rng() < 0.25) {
        g2.fillStyle = lit ? '#ffe2a0' : '#c9a86a';
        g2.fillRect(i * 32 + 7, j * 32 + 6, 18, 20);
      }
    }
  }
  const make = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const t = make(c);
  t.glow = make(c2);
  return t;
}

// Box with window UVs scaled to its size, so windows stay the same size on every building.
function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const S = 12;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const idx = f * 4 + v;
      let u = uv.getX(idx);
      let vv = uv.getY(idx);
      if (f === 2 || f === 3) {
        u = 0.005;
        vv = 0.005;
      } else {
        u *= (f < 2 ? d : w) / S;
        vv *= h / S;
      }
      uv.setXY(idx, u, vv);
    }
  }
  return g;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = 'bold 60px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 490);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Static geometry, gathered per material and per chunk of the map, merged at the end
// (few draw calls, and frustum culling still works chunk by chunk).
class Batch {
  constructor(scene, chunk = 400) {
    this.scene = scene;
    this.chunk = chunk;
    this.groups = new Map();
  }
  add(geo, mat, { cast = false, receive = true } = {}) {
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    const key = `${mat.uuid}|${Math.floor(c.x / this.chunk)},${Math.floor(c.z / this.chunk)}|${cast}|${receive}`;
    if (!this.groups.has(key)) this.groups.set(key, { mat, cast, receive, geos: [] });
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(k === 'color' && mat.vertexColors)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    this.groups.get(key).geos.push(g);
  }
  mesh(geo, mat, x, y, z, ry = 0, opts) {
    geo.rotateY(ry);
    geo.translate(x, y, z);
    this.add(geo, mat, opts);
  }
  flush() {
    for (const g of this.groups.values()) {
      const merged = mergeGeometries(g.geos);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, g.mat);
      m.castShadow = g.cast;
      m.receiveShadow = g.receive;
      this.scene.add(m);
      for (const x of g.geos) x.dispose();
    }
    this.groups.clear();
  }
}

// Flat polygon (x/z) as a geometry at height y.
function flatPoly(poly, y) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
// Polygon extruded from y0 up to y1 (slabs).
function slabPoly(poly, y0, y1) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

// Do two convex polygons overlap (separating axis test)?
function overlaps(P, Q, gap = 0) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const nx = az - bz;
      const nz = bx - ax;
      const L = Math.hypot(nx, nz) || 1;
      let pmin = Infinity;
      let pmax = -Infinity;
      let qmin = Infinity;
      let qmax = -Infinity;
      for (const [x, z] of P) {
        const d = (x * nx + z * nz) / L;
        pmin = Math.min(pmin, d);
        pmax = Math.max(pmax, d);
      }
      for (const [x, z] of Q) {
        const d = (x * nx + z * nz) / L;
        qmin = Math.min(qmin, d);
        qmax = Math.max(qmax, d);
      }
      if (pmax + gap <= qmin || qmax + gap <= pmin) return false;
    }
  }
  return true;
}

// A rectangle from its center, half sizes and the direction of its width (ux, uz).
const rect4 = (cx, cz, hw, hd, ux, uz) => {
  const vx = -uz;
  const vz = ux;
  return [
    [cx - ux * hw - vx * hd, cz - uz * hw - vz * hd],
    [cx + ux * hw - vx * hd, cz + uz * hw - vz * hd],
    [cx + ux * hw + vx * hd, cz + uz * hw + vz * hd],
    [cx - ux * hw + vx * hd, cz - uz * hw + vz * hd],
  ];
};

export function buildCity(scene) {
  const rng = mulberry32(1337);
  const rr = (a, b) => a + rng() * (b - a);
  const batch = new Batch(scene);
  const colliders = []; // everything solid
  const los = []; // tall things that block line of sight
  const crates = []; // low cover
  const stores = [];
  const blocks = BLOCKS;
  let chop = null;
  let station = null;
  let hospital = null;

  // ======== Terrain: a height grid with the roads and lots cut in ========
  const TG = 4;
  const GN = MAP / TG + 1;
  const H = new Float32Array(GN * GN);
  // The paved areas: the city inside the ring (plus Ring Rd), and the docks down to the water.
  const CITY_PAVE = roundRect(RING.x0 - 13, RING.z0 - 13, RING.x1 + 13, RING.z1 + 13, RING.r + 13, 6);
  const DOCKS_X0 = 135;
  const DOCKS_X1 = 1292;
  const docksPave = [];
  for (let x = DOCKS_X0; x <= DOCKS_X1; x += 10) docksPave.push([x, coastZ(x) - 1.5]);
  docksPave.push([DOCKS_X1, RING.z1], [DOCKS_X0, RING.z1]);
  const paved = (x, z) => ringDist(x, z) < 13 + 0.001 || insideRing(x, z)
    || (x > DOCKS_X0 && x < DOCKS_X1 && z > RING.z1 - 5 && z < coastZ(x) - 1.5);
  // Blocks out in the hills (not in the paved city): no sidewalk slab there - it's just the
  // ground, and any road through the block (a dead end, which doesn't split blocks) stays a road.
  for (const b of blocks) b.country = !b.lot && !paved(...centroid(b.poly));
  // (interchanges outside the ring sit on level ground, easing back into the hills around)
  const rampLevel = (x, z) => {
    if (!inHole(x, z, 36)) return 1;
    for (const [pad, k] of [[16, 0], [24, 0.3], [30, 0.55]]) if (inHole(x, z, pad)) return k;
    return 0.8;
  };
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const x = i * TG;
    const z = j * TG;
    H[j * GN + i] = paved(x, z) ? 0 : terrain(x, z) * rampLevel(x, z);
  }
  const rawAt = (x, z) => {
    const fx = Math.max(0, Math.min(GN - 1.001, x / TG));
    const fz = Math.max(0, Math.min(GN - 1.001, z / TG));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = H[j * GN + i];
    const b = H[j * GN + i + 1];
    const c = H[(j + 1) * GN + i];
    const d = H[(j + 1) * GN + i + 1];
    // (the same two triangles per square the terrain is drawn with - split from its +x
    // corner to its +z corner - so what you stand on is exactly the ground you see)
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
  // Roads outside the paved areas: heights along each, smoothed and kept to a 12% grade,
  // then burned into the grid (flat across the road, blending out over a few meters).
  const RW = new Float32Array(GN * GN); // how much a road has claimed each grid point
  const RT = new Float32Array(GN * GN);
  const RD = new Float32Array(GN * GN).fill(Infinity); // (and how far that road is)
  const ribbons = []; // roads drawn as strips on the terrain: { pts, h, w }
  const profiles = []; // each road's points and heights, before they're burned in
  for (const st of STREETS) {
    if (st.cls === 'pier') continue;
    const pts = [];
    for (let k = 0; k + 1 < st.pts.length; k++) {
      const [ax, az] = st.pts[k];
      const [bx, bz] = st.pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let i = k ? 1 : 0; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
    }
    if (st.stub !== undefined) continue; // (links inside the cross street: nothing to draw)
    if (pts.every(([x, z]) => paved(x, z))) continue;
    let h = pts.map(([x, z]) => (paved(x, z) ? 0 : rawAt(x, z)));
    for (let pass = 0; pass < 4; pass++) h = h.map((v, i) => (paved(...pts[i]) ? 0 : (h[Math.max(0, i - 2)] + h[Math.max(0, i - 1)] + v + h[Math.min(h.length - 1, i + 1)] + h[Math.min(h.length - 1, i + 2)]) / 5));
    const ds = (i) => Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    profiles.push({ st, pts, h, ds, pins: new Map() });
  }
  // Where roads meet, one height: a road meeting a bigger one (wider, or as wide and longer)
  // takes that road's height where they meet, so a junction is never a step between two
  // roads at different heights. Then each road is kept to a 12% grade out from there.
  const rankOf = (p) => ROAD_CLASS[p.st.cls].w * 10000 + p.pts.length;
  const byRank = [...profiles].sort((a, b) => rankOf(b) - rankOf(a));
  const done = [];
  const heightOn = (q, x, z) => {
    let best = null;
    for (let k = 0; k + 1 < q.pts.length; k++) {
      const c = closestOnSeg(x, z, q.pts[k][0], q.pts[k][1], q.pts[k + 1][0], q.pts[k + 1][1]);
      if (c.d < ROAD_CLASS[q.st.cls].w / 2 + 1 && (!best || c.d < best.d)) best = { d: c.d, h: q.h[k] + (q.h[k + 1] - q.h[k]) * c.t }; // (anywhere on its pavement)
    }
    return best;
  };
  for (const p of byRank) {
    for (let i = 0; i < p.pts.length; i++) {
      if (paved(...p.pts[i])) continue;
      for (const q of done) {
        const o = heightOn(q, p.pts[i][0], p.pts[i][1]);
        if (o) {
          p.pins.set(i, o.h);
          break;
        }
      }
    }
    const { h, ds } = p;
    for (const [i, v] of p.pins) h[i] = v;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < h.length; i++) if (!p.pins.has(i)) h[i] = Math.max(h[i - 1] - 0.12 * ds(i), Math.min(h[i - 1] + 0.12 * ds(i), h[i]));
      for (let i = h.length - 2; i >= 0; i--) if (!p.pins.has(i)) h[i] = Math.max(h[i + 1] - 0.12 * ds(i + 1), Math.min(h[i + 1] + 0.12 * ds(i + 1), h[i]));
    }
    // (two junctions too far apart in height for 12%: one even slope between them)
    const pinned = [...p.pins.keys()].sort((a, b) => a - b);
    for (let k = 0; k + 1 < pinned.length; k++) {
      const i0 = pinned[k];
      const i1 = pinned[k + 1];
      let L = 0;
      for (let i = i0 + 1; i <= i1; i++) L += ds(i);
      if (Math.abs(h[i1] - h[i0]) <= 0.12 * L + 0.01) continue;
      let s = 0;
      for (let i = i0 + 1; i < i1; i++) {
        s += ds(i);
        h[i] = h[i0] + ((h[i1] - h[i0]) * s) / L;
      }
    }
    done.push(p);
  }
  for (const { st, pts, h } of profiles) {
    const w = ROAD_CLASS[st.cls].w;
    ribbons.push({ pts, h, w, st });
    const reach = w / 2 + 13; // (flat across the road and a few meters either side, then easing into the hill)
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / TG));
      const i1 = Math.min(GN - 1, Math.ceil((Math.max(ax, bx) + reach) / TG));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / TG));
      const j1 = Math.min(GN - 1, Math.ceil((Math.max(az, bz) + reach) / TG));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = closestOnSeg(i * TG, j * TG, ax, az, bx, bz);
        if (c.d > reach) continue;
        const wgt = c.d < w / 2 + 4.5 ? 1 : 1 - (c.d - w / 2 - 4.5) / (reach - w / 2 - 4.5);
        const idx = j * GN + i;
        // (the nearest piece of road sets the height: on a slope, a piece further along
        // would leave the ground above or below the road)
        if (wgt > RW[idx] || (wgt === RW[idx] && c.d < RD[idx])) {
          RW[idx] = wgt;
          RD[idx] = c.d;
          RT[idx] = h[k] + (h[k + 1] - h[k]) * c.t;
        }
      }
    }
  }
  for (let k = 0; k < H.length; k++) if (RW[k] > 0) H[k] = H[k] * (1 - RW[k]) + RT[k] * RW[k];
  // House lots: a level pad at the height of the road in front.
  for (const b of blocks) {
    if (!b.lot) continue;
    const [fx, fz] = b.front ? b.front[0] : [b.cx, b.cz];
    b.padY = rawAt(fx, fz) + 0.15;
    // (level for one grid step past the edge, so the ground meets the pad's edge exactly
    // instead of dipping under it, then easing back into the hill)
    const reach = 5 + TG;
    const i0 = Math.max(0, Math.floor((b.minX - reach) / TG));
    const i1 = Math.min(GN - 1, Math.ceil((b.maxX + reach) / TG));
    const j0 = Math.max(0, Math.floor((b.minZ - reach) / TG));
    const j1 = Math.min(GN - 1, Math.ceil((b.maxZ + reach) / TG));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * TG;
      const z = j * TG;
      const idx = j * GN + i;
      if (RW[idx] > 0.9) continue;
      const inside = pointInPoly(x, z, b.poly);
      let d = 0;
      if (!inside) {
        d = Infinity;
        for (let q = 0; q < b.poly.length; q++) {
          const [ax, az] = b.poly[q];
          const [bx, bz] = b.poly[(q + 1) % b.poly.length];
          d = Math.min(d, closestOnSeg(x, z, ax, az, bx, bz).d);
        }
      }
      if (d > reach) continue;
      const wgt = d <= TG ? 1 : 1 - (d - TG) / (reach - TG);
      H[idx] = H[idx] * (1 - wgt) + b.padY * wgt;
    }
  }
  const heightAt = rawAt; // (after burning in)
  // Where paint goes on a road: just above its surface (the paved city is at 0; roads out on
  // the terrain are strips laid a few cm above the ground).
  const roadY = (x, z) => (paved(x, z) ? 0.02 : heightAt(x, z) + 0.065);

  // ======== Lookups: blocks, ground height, nodes ========
  const BG = 2;
  const BN = MAP / BG;
  // Which blocks touch each 2 m cell: every cell with a corner or its middle in the block,
  // and every cell its edge runs through (so slivers along the edge are never missed); a
  // cell two blocks share keeps both.
  const cellBlock = new Int16Array(BN * BN);
  const cellMore = new Map(); // cell -> [block ids] (a cell with more than one block)
  const mark = (i, j, b) => {
    if (i < 0 || j < 0 || i >= BN || j >= BN) return;
    const k = j * BN + i;
    const v = cellBlock[k];
    if (!v) cellBlock[k] = b.id + 1;
    else if (v !== b.id + 1) {
      const l = cellMore.get(k) || [];
      if (!l.includes(b.id)) l.push(b.id);
      cellMore.set(k, l);
    }
  };
  for (const b of blocks) {
    const i0 = Math.max(0, Math.floor(b.minX / BG));
    const i1 = Math.min(BN - 1, Math.floor(b.maxX / BG));
    const j0 = Math.max(0, Math.floor(b.minZ / BG));
    const j1 = Math.min(BN - 1, Math.floor(b.maxZ / BG));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x0 = i * BG;
      const z0 = j * BG;
      if (pointInPoly(x0 + 1, z0 + 1, b.poly) || pointInPoly(x0, z0, b.poly) || pointInPoly(x0 + BG, z0, b.poly)
        || pointInPoly(x0, z0 + BG, b.poly) || pointInPoly(x0 + BG, z0 + BG, b.poly)) mark(i, j, b);
    }
    for (let q = 0; q < b.poly.length; q++) {
      const [ax, az] = b.poly[q];
      const [bx, bz] = b.poly[(q + 1) % b.poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let t = 0; t <= n; t++) mark(Math.floor((ax + ((bx - ax) * t) / n) / BG), Math.floor((az + ((bz - az) * t) / n) / BG), b);
    }
  }
  const blockAt = (x, z) => {
    const i = Math.floor(x / BG);
    const j = Math.floor(z / BG);
    if (i < 0 || j < 0 || i >= BN || j >= BN) return null;
    const v = cellBlock[j * BN + i];
    if (!v) return null;
    const b = blocks[v - 1];
    if (pointInPoly(x, z, b.poly)) return b;
    for (const id of cellMore.get(j * BN + i) || []) if (pointInPoly(x, z, blocks[id].poly)) return blocks[id];
    return null;
  };
  // Piers: a deck level with the docks, over the water.
  const piers = [];
  for (const st of STREETS) {
    if (st.cls !== 'pier') continue;
    const [[ax, az], [bx, bz]] = [st.pts[0], st.pts[st.pts.length - 1]];
    piers.push({ ax, az, bx, bz, hw: ROAD_CLASS.pier.w / 2 + 1 });
  }
  const onPier = (x, z) => piers.some((p) => closestOnSeg(x, z, p.ax, p.az, p.bx, p.bz).d < p.hw);
  // Yards and pads (a lot's level ground, not a road crossing it): there you stand on the
  // pad's surface, which on a slope stands out over the hillside. Each 2 m cell remembers the
  // lot touching it (inside, or its edge running through); the exact outline decides.
  const padLot = new Int16Array(BN * BN).fill(-1);
  for (const b of blocks) {
    if (!b.lot || b.padY === undefined) continue;
    const put = (i, j) => {
      if (i < 0 || j < 0 || i >= BN || j >= BN) return;
      const k = j * BN + i;
      if (padLot[k] < 0 || blocks[padLot[k]].padY < b.padY) padLot[k] = b.id;
    };
    const i0 = Math.max(0, Math.floor(b.minX / BG));
    const i1 = Math.min(BN - 1, Math.floor(b.maxX / BG));
    const j0 = Math.max(0, Math.floor(b.minZ / BG));
    const j1 = Math.min(BN - 1, Math.floor(b.maxZ / BG));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPoly(i * BG + BG / 2, j * BG + BG / 2, b.poly)) put(i, j);
    for (let q = 0; q < b.poly.length; q++) {
      const [ax, az] = b.poly[q];
      const [bx, bz] = b.poly[(q + 1) % b.poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let t = 0; t <= n; t++) put(Math.floor((ax + ((bx - ax) * t) / n) / BG), Math.floor((az + ((bz - az) * t) / n) / BG));
    }
  }
  const padAt = (x, z) => {
    if (x < 0 || z < 0 || x >= MAP || z >= MAP) return -Infinity;
    const id = padLot[Math.floor(z / BG) * BN + Math.floor(x / BG)];
    if (id < 0) return -Infinity;
    const b = blocks[id];
    if (!pointInPoly(x, z, b.poly) || edgesNear(x, z, 0.2).length) return -Infinity;
    return b.padY + 0.02;
  };
  const steps = []; // raised entrance steps you can stand (or drive) on: { cx, cz, c, s, hx, hz, y }
  const groundY = (x, z) => {
    let h = heightAt(x, z);
    const b = blockAt(x, z);
    if (b && !b.lot && b.type !== 'ramps' && !b.country) h += 0.2;
    // (a yard is a level pad: on a slope its edge stands out over the ground, so on the
    // yard you're on its surface, not down in the hillside under it)
    h = Math.max(h, padAt(x, z));
    for (const st of steps) {
      const dx = x - st.cx;
      const dz = z - st.cz;
      if (Math.abs(dx * st.c + dz * st.s) < st.hx && Math.abs(-dx * st.s + dz * st.c) < st.hz) h = Math.max(h, st.y);
    }
    if (h < 0 && onPier(x, z)) h = 0; // (on a pier: its deck, even over shallow water)
    return h;
  };

  const nodes = GRAPH.nodes;
  for (const n of nodes) n.street = true;
  const NH = 50;
  const nodeHash = new Map();
  for (const n of nodes) {
    const k = Math.floor(n.x / NH) * 1000 + Math.floor(n.z / NH);
    if (!nodeHash.has(k)) nodeHash.set(k, []);
    nodeHash.get(k).push(n);
  }
  const nearestNode = (x, z, filter = null) => {
    const i = Math.floor(x / NH);
    const j = Math.floor(z / NH);
    let best = null;
    let bd = Infinity;
    for (let r = 1; r <= 8; r++) {
      for (let a = i - r; a <= i + r; a++) for (let b = j - r; b <= j + r; b++) {
        if (r > 1 && Math.abs(a - i) < r && Math.abs(b - j) < r) continue;
        for (const n of nodeHash.get(a * 1000 + b) || []) {
          if (filter && !filter(n)) continue;
          const d = Math.hypot(n.x - x, n.z - z);
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
      if (best && bd < (r - 0.5) * NH) break;
    }
    return best;
  };

  // ======== Block outlines: sides, fronts, sidewalks ========
  for (const b of blocks) {
    const ccw = area(b.poly) > 0;
    b.sides = b.poly.map((p, i) => {
      const q = b.poly[(i + 1) % b.poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const ux = (q[0] - p[0]) / len;
      const uz = (q[1] - p[1]) / len;
      // Outward normal (toward the street).
      let nx = uz;
      let nz = -ux;
      if (!ccw) {
        nx = -nx;
        nz = -nz;
      }
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      const near = edgeAt(mx + nx * 4, mz + nz * 4);
      const cls = near && near.d < 14 ? near.e.cls : null;
      return { ax: p[0], az: p[1], bx: q[0], bz: q[1], ux, uz, nx, nz, len, mx, mz, cls, street: near && near.d < 14 ? near.e.name : null, edge: near && near.d < 14 ? near.e : null };
    });
    b.sw = b.lot ? 0 : Math.max(2.5, ...b.sides.map((s) => (s.cls ? ROAD_CLASS[s.cls].sw : 3)));
    let best = b.sides[0];
    let bs = -1;
    for (const s of b.sides) {
      const score = s.len * (s.cls ? RANK[s.cls] : 0.5) * (s.street ? 1 : 0.6) * (s.cls === 'under' ? 0.3 : 1);
      if (score > bs) {
        bs = score;
        best = s;
      }
    }
    b.frontSide = best;
    b.corners = b.poly;
  }

  // ======== Materials ========
  const winTex = windowTexture(rng);
  const windowMats = [];
  // One material for every windowed building (fewer draw calls): each building's color is
  // painted into its vertices.
  const WIN = new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex, emissive: 0x000000, emissiveMap: winTex.glow });
  windowMats.push(WIN);
  const winMat = (color) => ({ win: true, color: new THREE.Color(color) });
  const matCache = {};
  const matsFor = (d) => (matCache[d] ||= STYLES[d].colors.map((c) => winMat(c)));
  const sidewalkMat = lam(0x8d8d8a);
  const plazaMat = lam(0xa6a196);
  const lawnMat = lam(0x4f7a3f);
  const yardMat = lam(0x557f45);
  const asphaltMat = lam(0x2e2f33);
  const roofMat = lam(0x5a4636);
  const columnMat = lam(0xeeeae0);
  const neonMats = [0xff3fa4, 0x34e7ff, 0xb84dff, 0xffe14d].map((c) => new THREE.MeshBasicMaterial({ color: c }));

  // ======== Ground ========
  {
    // Paved city and docks.
    batch.add(flatPoly(CITY_PAVE, 0), asphaltMat);
    batch.add(flatPoly(docksPave, 0), asphaltMat);
    // Terrain mesh (skipping squares under the paving), colored by height, slope and shore.
    // (on the height grid's own points, so it's exactly the ground everything stands on)
    const S = TG;
    const n = MAP / S;
    const grass = new THREE.Color(0x3d5a3a);
    const forest = new THREE.Color(0x2f4a2c);
    const sand = new THREE.Color(0xb9a77a);
    const rock = new THREE.Color(0x6b6a60);
    const mud = new THREE.Color(0x4a4636);
    const CH = 4; // chunks per side
    const per = n / CH;
    for (let ci = 0; ci < CH; ci++) for (let cj = 0; cj < CH; cj++) {
      const pos = [];
      const col = [];
      const vtx = (x, z) => {
        const y = heightAt(x, z) - 0.03;
        pos.push(x, y, z);
        const sd = shoreDist(x, z);
        const sl = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) + Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3));
        let c = grass.clone();
        if (y > 6) c.lerp(forest, Math.min(1, (y - 6) / 14));
        if (sl > 2.4) c.lerp(rock, Math.min(1, (sl - 2.4) / 3));
        if (sd < 14) c.lerp(sd < 3 ? mud : sand, Math.min(1, (14 - sd) / 8));
        col.push(c.r, c.g, c.b);
      };
      for (let i = ci * per; i < (ci + 1) * per; i++) for (let j = cj * per; j < (cj + 1) * per; j++) {
        const x0 = i * S;
        const z0 = j * S;
        if (paved(x0, z0) && paved(x0 + S, z0) && paved(x0, z0 + S) && paved(x0 + S, z0 + S)) continue;
        vtx(x0, z0); vtx(x0, z0 + S); vtx(x0 + S, z0);
        vtx(x0 + S, z0); vtx(x0, z0 + S); vtx(x0 + S, z0 + S);
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true;
      scene.add(m);
    }
    // Water.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 3, MAP * 3), new THREE.MeshLambertMaterial({ color: 0x2c5d8a, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(MAP / 2, SEA, MAP / 2);
    scene.add(water);
    // Roads on the terrain: strips following their heights, a patch at each end.
    for (const r of ribbons) {
      const pos = [];
      const hw = r.w / 2;
      const side = (i) => {
        const p = r.pts[Math.max(0, i - 1)];
        const q = r.pts[Math.min(r.pts.length - 1, i + 1)];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
      };
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        if (paved(ax, az) && paved(bx, bz)) continue;
        const [anx, anz] = side(i);
        const [bnx, bnz] = side(i + 1);
        // (a fine mesh laid on the ground - the road is burned into it - so roads meeting at
        // a junction lie on the same ground, and cars on them sit on what's drawn)
        const y = (x, z) => heightAt(x, z) + 0.04;
        const nu = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
        const nv = Math.max(1, Math.ceil(r.w / 2.5));
        const at = (u, v) => {
          const sx = (ax - anx * hw) + ((ax + anx * hw) - (ax - anx * hw)) * v;
          const sz = (az - anz * hw) + ((az + anz * hw) - (az - anz * hw)) * v;
          const ex = (bx - bnx * hw) + ((bx + bnx * hw) - (bx - bnx * hw)) * v;
          const ez = (bz - bnz * hw) + ((bz + bnz * hw) - (bz - bnz * hw)) * v;
          const x = sx + (ex - sx) * u;
          const z = sz + (ez - sz) * u;
          return [x, y(x, z), z];
        };
        for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++) {
          const p00 = at(iu / nu, iv / nv);
          const p01 = at(iu / nu, (iv + 1) / nv);
          const p10 = at((iu + 1) / nu, iv / nv);
          const p11 = at((iu + 1) / nu, (iv + 1) / nv);
          pos.push(...p00, ...p01, ...p10, ...p10, ...p01, ...p11);
        }
      }
      if (!pos.length) continue;
      // (wind the triangles to face up whichever way the road runs)
      for (let t = 0; t < pos.length; t += 9) {
        const ux = pos[t + 3] - pos[t];
        const uz = pos[t + 5] - pos[t + 2];
        const vx = pos[t + 6] - pos[t];
        const vz = pos[t + 8] - pos[t + 2];
        if (uz * vx - ux * vz < 0) {
          for (let k = 0; k < 3; k++) {
            const tmp = pos[t + 3 + k];
            pos[t + 3 + k] = pos[t + 6 + k];
            pos[t + 6 + k] = tmp;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      batch.add(g, asphaltMat);
      for (const i of [0, r.pts.length - 1]) {
        const [x, z] = r.pts[i];
        if (paved(x, z)) continue;
        // (a rounded end only where the road just ends - not where it meets another road)
        if (ribbons.some((o) => o !== r && o.pts.some((p, k) => k > 0 && closestOnSeg(x, z, o.pts[k - 1][0], o.pts[k - 1][1], p[0], p[1]).d < o.w / 2 + 0.5))) continue;
        const disk = new THREE.RingGeometry(0, hw, 16, Math.max(1, Math.ceil(hw / 2))); // (in rings, to follow the ground)
        disk.rotateX(-Math.PI / 2);
        disk.translate(x, 0, z);
        const dp = disk.attributes.position;
        for (let v = 0; v < dp.count; v++) dp.setY(v, heightAt(dp.getX(v), dp.getZ(v)) + 0.035);
        batch.add(disk, asphaltMat);
      }
    }
    // Piers: decks on pilings.
    const deckMat = lam(0x6e665a);
    const pileGeo = new THREE.CylinderGeometry(0.35, 0.35, 6, 6);
    for (const p of piers) {
      const L = Math.hypot(p.bx - p.ax, p.bz - p.az);
      const ang = Math.atan2(p.bx - p.ax, p.bz - p.az);
      const g = new THREE.BoxGeometry(p.hw * 2, 0.6, L);
      g.rotateY(ang);
      g.translate((p.ax + p.bx) / 2, -0.3, (p.az + p.bz) / 2);
      batch.add(g, deckMat);
      for (let t = 6; t < L; t += 10) {
        for (const s of [-1, 1]) {
          const ux = (p.bx - p.ax) / L;
          const uz = (p.bz - p.az) / L;
          const x = p.ax + ux * t - uz * s * (p.hw - 0.4);
          const z = p.az + uz * t + ux * s * (p.hw - 0.4);
          const pg = pileGeo.clone();
          pg.translate(x, -3.2, z);
          batch.add(pg, deckMat);
          // Rails along the sides.
          colliders.push(obb(x, z, 0.2, 5.2, ang, 1.1));
        }
      }
      const rail = new THREE.BoxGeometry(0.15, 1, L);
      for (const s of [-1, 1]) {
        const g2 = rail.clone();
        g2.rotateY(ang);
        g2.translate((p.ax + p.bx) / 2 + Math.cos(ang) * s * p.hw, 0.5, (p.az + p.bz) / 2 - Math.sin(ang) * s * p.hw);
        batch.add(g2, lam(0x9a9a9a));
      }
      // The end of the pier.
      colliders.push(obb(p.bx, p.bz, p.hw, 0.3, -ang + Math.PI / 2, 1.1));
    }
    // Seawall along the docks (gaps for the piers), and an invisible edge along every other shore.
    const wallMat = lam(0x9c9a92);
    const edge = (ax, az, bx, bz, visible) => {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) return;
      const a = Math.atan2(bz - az, bx - ax);
      colliders.push(obb((ax + bx) / 2, (az + bz) / 2, L / 2, 0.35, a, 1.1));
      if (visible) {
        const g = new THREE.BoxGeometry(L, 0.9, 0.6);
        g.rotateY(-a);
        g.translate((ax + bx) / 2, 0.45, (az + bz) / 2);
        batch.add(g, wallMat);
      }
    };
    const gapAt = (x) => piers.some((p) => Math.abs(p.ax - x) < p.hw + 0.5);
    for (let x = DOCKS_X0; x < DOCKS_X1; x += 5) {
      if (gapAt(x) || gapAt(x + 5)) continue;
      edge(x, coastZ(x) - 2, x + 5, coastZ(x + 5) - 2, true);
    }
    // Beach and bay shores: a line just above the waterline.
    const shore = [];
    for (let x = 0; x <= DOCKS_X0; x += 6) shore.push([x, coastZ(x) - 3]);
    shore.push(null);
    for (let x = DOCKS_X1; x <= MAP; x += 6) if (!isWater(x, coastZ(x) - 3)) shore.push([x, coastZ(x) - 3]);
    shore.push(null);
    for (let t = Math.PI * 0.5; t <= Math.PI * 1.5; t += 0.02) {
      const x = 1660 + Math.cos(t) * 330 * 1.012;
      const z = 1250 + Math.sin(t) * 420 * 1.012;
      if (x < MAP && z > 0 && !isWater(x, z) && z < coastZ(x) - 2) shore.push([x, z]);
      else shore.push(null);
    }
    for (let i = 0; i + 1 < shore.length; i++) if (shore[i] && shore[i + 1]) edge(...shore[i], ...shore[i + 1], false);
    // The edge of the world.
    for (const [x, z, hx, hz] of [[-1, MAP / 2, 1, MAP], [MAP + 1, MAP / 2, 1, MAP], [MAP / 2, -1, MAP, 1], [MAP / 2, MAP + 1, MAP, 1]]) {
      colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, h: 30 });
    }
  }

  // ======== Things that keep buildings away: freeways and ramps ========
  const RH = 10;
  const rampHash = new Map();
  for (const r of RAMPS) {
    for (let i = 0; i < r.pts.length; i += 2) {
      const [x, z] = r.pts[i];
      const k = Math.floor(x / RH) * 1000 + Math.floor(z / RH);
      if (!rampHash.has(k)) rampHash.set(k, []);
      rampHash.get(k).push([x, z, r.hw]);
    }
  }
  const nearRamp = (x, z, pad) => {
    const i = Math.floor(x / RH);
    const j = Math.floor(z / RH);
    for (let a = i - 2; a <= i + 2; a++) for (let b = j - 2; b <= j + 2; b++) {
      for (const [px, pz, hw] of rampHash.get(a * 1000 + b) || []) if (Math.hypot(px - x, pz - z) < hw + pad) return true;
    }
    return false;
  };
  const underXT = (x, z, pad) => Math.abs(x - XT.x) < XT_HALF + pad && z > RING.z0 && z < RING.z1;
  const clearOfRoads = (x, z, pad) => ringDist(x, z) > RING_HALF + pad && !underXT(x, z, pad) && !nearRamp(x, z, pad) && !inHole(x, z, pad);
  // A building's footprint (4 corners) clear of every street - its pavement and a sidewalk's
  // width - checked all over it, not just at the corners (a road can cut across a long side).
  const footClear = (R, pad = 1.5) => {
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const u = i / 4;
      const v = j / 4;
      const x = R[0][0] + (R[1][0] - R[0][0]) * u + (R[3][0] - R[0][0]) * v;
      const z = R[0][1] + (R[1][1] - R[0][1]) * u + (R[3][1] - R[0][1]) * v;
      if (edgesNear(x, z, pad).some((e) => e.street?.stub === undefined)) return false;
    }
    return true;
  };

  // ======== Building helpers ========
  // A box building: center, size, angle of its width (radians, x/z), base height.
  const building = (cx, cz, w, d, h, mat, ang = 0, base = null) => {
    if (base === null) {
      // (on a hillside: stand on the lowest ground under it, as tall as ever above the highest,
      // so it's never half buried in the slope)
      base = 0.2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const hs = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => heightAt(cx + (c * i * w - s * j * d) / 2, cz + (s * i * w + c * j * d) / 2));
      const lo = Math.min(...hs);
      const hi = Math.max(...hs);
      if (hi > 0.05) {
        base = lo - 0.1;
        h += hi - lo;
      }
    }
    const g = buildingGeo(w, h, d);
    if (mat.win) {
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = mat.color.r;
        c[i * 3 + 1] = mat.color.g;
        c[i * 3 + 2] = mat.color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      mat = WIN;
    }
    g.rotateY(-ang);
    g.translate(cx, base + h / 2, cz);
    batch.add(g, mat, { cast: true, receive: true });
    const box = base > 0.25 || base < 0.15 ? obb(cx, cz, w / 2, d / 2, ang, h, base) : obb(cx, cz, w / 2, d / 2, ang, base + h);
    colliders.push(box);
    los.push(box);
    return box;
  };
  const sign = (text, x, y, z, rotY, w, h, bg, fg = '#ffffff') => {
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    scene.add(p);
    return p;
  };
  const addCover = (x, z, w, d, h, color, ang = 0) => {
    if (!clearOfRoads(x, z, 1)) return;
    const base = groundY(x, z);
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(-ang);
    g.translate(x, base + h / 2, z);
    batch.add(g, lam(color), { cast: true });
    const box = { x, z, ...obb(x, z, w / 2, d / 2, ang, base + h) };
    colliders.push(box);
    crates.push(box);
  };

  // Trees: drawn in batches of instances (per chunk), with a small trunk collider.
  const treeList = [];
  const tree = (x, z, s = 1) => {
    treeList.push([x, z, s, groundY(x, z)]);
    colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, h: groundY(x, z) + 3 });
  };

  // Lay buildings along each side of an area (convex or not), facing out: returns the
  // footprints placed. opts: w/d ranges, h(), gap, onPlace(rect).
  const placeAlong = (b, lotPoly, opts) => {
    const placed = opts.placed || [];
    const ccw = area(lotPoly) > 0;
    const sides = lotPoly.map((p, i) => [p, lotPoly[(i + 1) % lotPoly.length]]);
    // Front side first, then the longest.
    sides.sort((s1, s2) => Math.hypot(s2[1][0] - s2[0][0], s2[1][1] - s2[0][1]) - Math.hypot(s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]));
    for (const [p, q] of sides) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 9) continue;
      const ux = (q[0] - p[0]) / L;
      const uz = (q[1] - p[1]) / L;
      // Inward normal.
      let nx = -uz;
      let nz = ux;
      if (!ccw) {
        nx = -nx;
        nz = -nz;
      }
      // Keep back from a freeway alongside.
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      let setback = 0;
      for (let s = 0; s < 14 && !clearOfRoads(mx + nx * s, mz + nz * s, 3); s += 1) setback = s + 1;
      let t = 0.8;
      let lastEnd = 0;
      while (t < L - 4) {
        let w = opts.w[0] + rng() * (opts.w[1] - opts.w[0]);
        if (t + w > L - 0.8) w = L - 0.8 - t;
        if (w < opts.w[0] * 0.6) break;
        let ok = false;
        for (const dm of [1, 0.7, 0.45]) {
          const d = (opts.d[0] + rng() * (opts.d[1] - opts.d[0])) * dm;
          if (d < 6) break;
          const cx = p[0] + ux * (t + w / 2) + nx * (setback + d / 2 + 0.3);
          const cz = p[1] + uz * (t + w / 2) + nz * (setback + d / 2 + 0.3);
          const R = rect4(cx, cz, w / 2, d / 2, ux, uz);
          const shrunk = rect4(cx, cz, w / 2 - 0.4, d / 2 - 0.4, ux, uz);
          if (!shrunk.every(([x, z]) => pointInPoly(x, z, lotPoly))) continue;
          if (![...shrunk, [cx, cz]].every(([x, z]) => clearOfRoads(x, z, 2.5))) continue;
          if (!footClear(R)) continue;
          if (placed.some((o) => overlaps(o.R, R, 0.6))) continue;
          const item = { R, cx, cz, w, d, ang: Math.atan2(uz, ux), ux, uz, nx: -nx, nz: -nz, side: [p, q] };
          placed.push(item);
          if (t - lastEnd > 3.5 && opts.gapCover) opts.gapCover(p[0] + ux * (t - 1.6) + nx * 1.4, p[1] + uz * (t - 1.6) + nz * 1.4, ux, uz);
          lastEnd = t + w;
          opts.onPlace?.(item);
          ok = true;
          break;
        }
        t += ok ? w + (opts.gap ? rng() * opts.gap : 0) : 4;
      }
    }
    return placed;
  };
  const inset = (poly, d) => {
    if (isConvex(poly)) {
      const r = insetConvex(poly, d);
      if (r.length) return r;
    }
    // Rough inset for odd shapes (corners along their bisectors).
    const ccw = area(poly) > 0;
    const n = poly.length;
    const out = poly.map((q, i) => {
      const p = poly[(i + n - 1) % n];
      const r = poly[(i + 1) % n];
      const nrm = (ax, az, bx, bz) => {
        const L = Math.hypot(bx - ax, bz - az) || 1;
        return ccw ? [-(bz - az) / L, (bx - ax) / L] : [(bz - az) / L, -(bx - ax) / L];
      };
      const n1 = nrm(p[0], p[1], q[0], q[1]);
      const n2 = nrm(q[0], q[1], r[0], r[1]);
      let bx = n1[0] + n2[0];
      let bz = n1[1] + n2[1];
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl;
      bz /= bl;
      const c = Math.max(0.4, bx * n1[0] + bz * n1[1]);
      return [q[0] + (bx * d) / c, q[1] + (bz * d) / c];
    });
    return area(out) * area(poly) > 0 && Math.abs(area(out)) > 20 ? out : [];
  };

  // The block's front: a point on the sidewalk in the middle of its front side.
  const frontPoint = (b, inward = b.sw / 2) => {
    const s = b.frontSide;
    return { x: s.mx - s.nx * inward, z: s.mz - s.nz * inward, nx: s.nx, nz: s.nz, ux: s.ux, uz: s.uz, heading: Math.atan2(s.nx, s.nz), rotY: Math.atan2(s.nx, s.nz), side: s };
  };
  // A special building facing the block's front: returns where it is and its door.
  const frontBuilding = (b, w, d, h, mat, setback = 10) => {
    const s = b.frontSide;
    let L = Math.min(w, s.len - 6);
    let cx = s.mx - s.nx * (b.sw + setback + d / 2);
    let cz = s.mz - s.nz * (b.sw + setback + d / 2);
    // (smaller, front kept where it is, until it's clear of every street round the block)
    for (let k = 0; k < 12 && !footClear(rect4(cx, cz, L / 2, d / 2, s.ux, s.uz)); k++) {
      L *= 0.85;
      d *= 0.85;
      cx = s.mx - s.nx * (b.sw + setback + d / 2);
      cz = s.mz - s.nz * (b.sw + setback + d / 2);
    }
    const ang = Math.atan2(s.uz, s.ux);
    building(cx, cz, L, d, h, mat, ang);
    const face = { x: cx + s.nx * (d / 2 + 0.06), z: cz + s.nz * (d / 2 + 0.06) };
    return { cx, cz, w: L, d, h, ang, face, rotY: Math.atan2(s.nx, s.nz), R: rect4(cx, cz, L / 2, d / 2, s.ux, s.uz) };
  };

  // ======== Blocks ========
  const slabs = [];
  const lawns = [];
  const plazas = [];
  const rampLawns = []; // ramp land: grass at street level
  const frontages = new Map(); // block -> the building on its front side (for storefronts)
  for (const b of blocks) {
    if (!b.lot && b.type !== 'ramps' && !b.country) slabs.push(b.poly);
    const lot = b.lot ? b.poly : inset(b.poly, b.sw);
    b.inner = lot;
    if (b.type === 'ramps') {
      rampLawns.push(b.poly);
      continue;
    }
    if (b.type === 'park' && b.island) {
      // A roundabout's island: lawn, and a statue on a stone plinth in the middle - a bronze
      // figure holding up a lit torch, facing down the avenue.
      const l = inset(b.poly, b.sw);
      if (l.length) lawns.push(l);
      const { x: sx, z: sz } = b.island;
      const stone = lam(0xb8b2a4);
      const bronze = lam(0x5f7f6a);
      const face = Math.PI; // (toward the south: up Central Ave from Downtown)
      const part = (geo, mat, x, y, z, ry = face) => batch.mesh(geo, mat, sx + x, y, sz + z, ry, { cast: true });
      part(new THREE.CylinderGeometry(4.2, 4.6, 0.6, 24), stone, 0, 0.5, 0);
      part(new THREE.BoxGeometry(4.4, 1.4, 4.4), stone, 0, 1.5, 0);
      part(new THREE.BoxGeometry(3.4, 2.2, 3.4), stone, 0, 3.3, 0);
      part(new THREE.BoxGeometry(3.8, 0.35, 3.8), stone, 0, 4.55, 0);
      const fig = (geo, x, y, z, rx = 0, rz = 0) => {
        geo.rotateX(rx);
        geo.rotateZ(rz);
        geo.translate(x, y, z);
        geo.rotateY(face);
        batch.mesh(geo, bronze, sx, 0, sz, 0, { cast: true });
      };
      const base = 4.7;
      fig(new THREE.CylinderGeometry(0.75, 1.15, 3.6, 10), 0, base + 1.8, 0); // robe
      fig(new THREE.CylinderGeometry(0.62, 0.75, 1.0, 10), 0, base + 4.0, 0); // shoulders
      fig(new THREE.BoxGeometry(0.62, 0.72, 0.62), 0, base + 4.85, 0); // head
      fig(new THREE.ConeGeometry(0.55, 0.45, 7), 0, base + 5.4, 0); // crown
      fig(new THREE.BoxGeometry(0.32, 1.9, 0.32), 0.62, base + 5.2, 0, 0, -0.12); // raised arm
      fig(new THREE.CylinderGeometry(0.16, 0.12, 0.9, 8), 0.75, base + 6.4, 0); // torch
      fig(new THREE.BoxGeometry(0.3, 1.3, 0.75), -0.82, base + 3.3, 0.2, 0.3); // tablet arm
      const flame = new THREE.ConeGeometry(0.28, 0.75, 8);
      flame.translate(0.75, base + 7.2, 0);
      flame.rotateY(face);
      batch.mesh(flame, new THREE.MeshBasicMaterial({ color: 0xffb030 }), sx, 0, sz, 0);
      colliders.push({ minX: sx - 2.3, maxX: sx + 2.3, minZ: sz - 2.3, maxZ: sz + 2.3, h: 12 });
      // (trees in two rings round it, the outer one along the island's edge)
      const rim = b.island.r - 14;
      for (const [rad, n, sc] of [[11, 8, 0.75], [rim, Math.round(rim / 3.2), 1]]) {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + 0.3;
          const x = sx + Math.cos(a) * rad;
          const z = sz + Math.sin(a) * rad;
          if (l.length && pointInPoly(x, z, l)) tree(x, z, sc);
        }
      }
      continue;
    }
    if (b.type === 'park') {
      const l = inset(b.poly, b.sw);
      if (l.length && !b.country) lawns.push(l); // (out in the hills the ground is grass already)
      const n = Math.min(60, Math.round(b.area / 260));
      for (let t = 0; t < n; t++) {
        const x = rr(b.minX, b.maxX);
        const z = rr(b.minZ, b.maxZ);
        if (l.length && pointInPoly(x, z, inset(l, 3) || l) && clearOfRoads(x, z, 3)) tree(x, z, rr(0.8, 1.3));
      }
      continue;
    }
    if (b.type === 'plaza') {
      plazas.push(b.poly);
      continue;
    }
    if (b.type === 'place') continue; // (quarry, junkyard, lookout: built below)
    if (!lot.length) continue;
    const district = b.district;
    const st = STYLES[district];
    const mats = matsFor(district);
    const pickMat = () => mats[Math.floor(rng() * mats.length)];
    const height = () => st.h[0] + Math.pow(rng(), 1.4) * (st.h[1] - st.h[0]);
    const placed = [];
    // Special buildings first, on the front.
    const specials = {
      police: () => {
        const f = frontBuilding(b, 40, 24, 14, winMat(0x3b5b8c));
        sign('POLICE', f.face.x, 10, f.face.z, f.rotY, 14, 2.6, '#1c2f5a');
        const fp = frontPoint(b, b.sw + 4);
        station = { x: fp.x, z: fp.z, heading: fp.heading, name: 'Central Precinct', roof: { x: f.cx, z: f.cz, y: 14.2 }, block: b, nx: fp.nx, nz: fp.nz, ux: fp.ux, uz: fp.uz };
        const pad = new THREE.CylinderGeometry(4, 4, 0.08, 24);
        batch.mesh(pad, lam(0x2c3e50), f.cx, 14.24, f.cz);
        batch.mesh(new THREE.BoxGeometry(2.4, 0.1, 0.5), lam(0xf1c40f), f.cx, 14.3, f.cz);
        placed.push(f);
      },
      cityhall: () => {
        const f = frontBuilding(b, 44, 30, 18, winMat(0xf0ece2), 8);
        batch.mesh(new THREE.SphereGeometry(9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xd9d2c0), f.cx, 18.2, f.cz, 0, { cast: true });
        sign('CITY HALL', f.face.x, 12, f.face.z, f.rotY, 14, 2.4, '#4a4a4a');
        const s = b.frontSide;
        for (let k = -3; k <= 3; k++) {
          batch.mesh(new THREE.CylinderGeometry(0.45, 0.5, 8, 10), columnMat, f.face.x + s.ux * k * 5 + s.nx * 0.8, 4.2, f.face.z + s.uz * k * 5 + s.nz * 0.8);
        }
        placed.push(f);
      },
      hospital: () => {
        const f = frontBuilding(b, 40, 24, 16, winMat(0xeeeeee));
        sign('HARBOR GENERAL HOSPITAL', f.face.x, 11, f.face.z, f.rotY, 18, 2.4, '#b71c1c');
        const fp = frontPoint(b, b.sw + 4);
        hospital = { x: fp.x, z: fp.z, heading: fp.heading, name: 'Harbor General' };
        placed.push(f);
      },
      chop: () => {
        const f = frontBuilding(b, 38, 22, 7, lam(0x6b5d4f), 14);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), lam(0x2a2a2a));
        door.position.set(f.face.x, 2.7, f.face.z);
        door.rotation.y = f.rotY;
        scene.add(door);
        sign('CHOP SHOP', f.face.x + b.frontSide.nx * 0.02, 6.1, f.face.z + b.frontSide.nz * 0.02, f.rotY, 12, 2.2, '#d35400');
        const fp = frontPoint(b, b.sw + 7);
        chop = { x: fp.x, z: fp.z, r: 7 };
        const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 7, 40), new THREE.MeshBasicMaterial({ color: 0xf39c12, transparent: true, opacity: 0.7 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(chop.x, 0.25, chop.z);
        scene.add(ring);
        placed.push(f);
      },
      store: () => {
        // A little shop on the front sidewalk, the name over the door.
        const s = b.frontSide;
        const w = 22;
        const d = 16;
        const cx = s.mx - s.nx * (b.sw + d / 2 + 0.3);
        const cz = s.mz - s.nz * (b.sw + d / 2 + 0.3);
        const ang = Math.atan2(s.uz, s.ux);
        building(cx, cz, w, d, 5, lam(0xe8d9b5), ang);
        const rotY = Math.atan2(s.nx, s.nz);
        const signMesh = sign(b.store.toUpperCase(), cx + s.nx * (d / 2 + 0.06), 4.3, cz + s.nz * (d / 2 + 0.06), rotY, 12, 1.8, '#27ae60');
        const fp = frontPoint(b);
        stores.push({ name: b.store, x: fp.x, z: fp.z, r: 2.8, cooldown: 0, signMesh, block: b, heading: fp.heading + Math.PI });
        placed.push({ R: rect4(cx, cz, w / 2, d / 2, s.ux, s.uz), cx, cz, w, d, ang, nx: s.nx, nz: s.nz, h: 5, front: true });
        frontages.set(b, { x: cx + s.nx * (d / 2), z: cz + s.nz * (d / 2), h: 5, nx: s.nx, nz: s.nz, ux: s.ux, uz: s.uz });
      },
    };
    if (!b.lot) specials[b.type]?.();
    const kind = st.kind;
    const onPlace = (it, h, mat) => {
      it.h = h;
      building(it.cx, it.cz, it.w, it.d, h, mat, it.ang);
      if (kind === 'strip') {
        const neon = new THREE.BoxGeometry(it.w * 0.85, 0.35, 0.15);
        neon.rotateY(-it.ang);
        batch.add(neon.translate(it.cx + it.nx * (it.d / 2 + 0.1), 3.6 + rng() * 2.5, it.cz + it.nz * (it.d / 2 + 0.1)), neonMats[Math.floor(rng() * neonMats.length)]);
      }
    };
    const gapCover = (x, z, ux, uz) => {
      if (rng() > 0.55) return;
      const ang = Math.atan2(uz, ux);
      if (rng() < 0.5) addCover(x, z, 2.2, 1.3, 1.4, 0x2e5e3a, ang);
      else {
        addCover(x - ux * 0.6, z - uz * 0.6, 1.1, 1.1, 1.0, 0x7a5a32, ang);
        addCover(x + ux * 0.7, z + uz * 0.7, 1.0, 1.0, 0.9, 0x86643a, ang);
      }
    };
    if (b.lot) {
      // A house on its lot, a yard around it.
      lawns.push(b.poly.map((p) => p));
      b.lawnY = b.padY + 0.02;
      if (b.type === 'park') continue;
      const s = b.sides.reduce((m, x) => (x.cls === 'hills' && x.len > (m?.len || 0) ? x : m), null) || b.sides[0];
      const w = rr(10, 13);
      const d = rr(9, 12);
      const [cx, cz] = centroid(b.poly);
      const ang = Math.atan2(s.uz, s.ux);
      const hgt = height();
      const base = b.padY - 0.6;
      building(cx, cz, w, d, hgt + 0.6, pickMat(), ang, base);
      const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
      roof.rotateY(Math.PI / 4);
      roof.scale(w * 1.08, 2.6, d * 1.08);
      roof.rotateY(-ang);
      batch.add(roof.translate(cx, base + hgt + 0.6 + 1.3, cz), roofMat, { cast: true });
      if (b.type === 'store') {
        const rotY = Math.atan2(s.nx, s.nz);
        const signMesh = sign(b.store.toUpperCase(), cx + s.nx * (d / 2 + 0.06), b.padY + 4, cz + s.nz * (d / 2 + 0.06), rotY, 10, 1.6, '#27ae60');
        const fx = s.mx + s.nx * 0.5;
        const fz = s.mz + s.nz * 0.5;
        stores.push({ name: b.store, x: fx, z: fz, r: 2.8, cooldown: 0, signMesh, block: b, heading: rotY + Math.PI });
      }
      frontages.set(b, { x: cx + s.nx * (d / 2), z: cz + s.nz * (d / 2), h: hgt, nx: s.nx, nz: s.nz, ux: s.ux, uz: s.uz, y0: b.padY });
      if (rng() < 0.7) tree(cx - s.nx * (d / 2 + 4) + s.ux * rr(-6, 6), cz - s.nz * (d / 2 + 4) + s.uz * rr(-6, 6));
      continue;
    }
    if (kind === 'civic' && b.type === 'normal') {
      const f = frontBuilding(b, Math.min(48, b.frontSide.len * 0.6), Math.min(34, Math.sqrt(b.area) * 0.45), height(), pickMat(), 6);
      const s = b.frontSide;
      batch.mesh(new THREE.BoxGeometry(f.w * 0.6, 0.5, 3), lam(0xd8d2c4), f.face.x + s.nx * 1.5, 0.45, f.face.z + s.nz * 1.5, -f.ang);
      steps.push({ cx: f.face.x + s.nx * 1.5, cz: f.face.z + s.nz * 1.5, c: Math.cos(f.ang), s: Math.sin(f.ang), hx: f.w * 0.3, hz: 1.5, y: 0.7 });
      for (let k = -2; k <= 2; k++) batch.mesh(new THREE.CylinderGeometry(0.45, 0.5, 8, 10), columnMat, f.face.x + s.ux * k * f.w * 0.12 + s.nx * 0.6, 4.2, f.face.z + s.uz * k * f.w * 0.12 + s.nz * 0.6);
      placed.push(f);
      frontages.set(b, { x: f.face.x, z: f.face.z, h: f.h, nx: s.nx, nz: s.nz, ux: s.ux, uz: s.uz });
    }
    const opts = {
      city: { w: [14, 26], d: [14, 24], gap: 2 },
      towers: { w: [22, 34], d: [20, 30], gap: 3 },
      civic: { w: [18, 30], d: [14, 22], gap: 6 },
      strip: { w: [12, 20], d: [12, 18], gap: 1.5 },
      docks: { w: [30, 50], d: [18, 24], gap: 8 },
      projects: { w: [36, 46], d: [10, 11], gap: 8 },
      houses: { w: [10, 13], d: [9, 12], gap: 6 },
    }[kind] || { w: [14, 24], d: [14, 22], gap: 2 };
    placeAlong(b, lot, {
      ...opts,
      placed,
      gapCover: kind === 'docks' || kind === 'houses' ? null : gapCover,
      onPlace: (it) => {
        const tall = kind === 'towers' && rng() < 0.3 ? 1.15 : 1;
        onPlace(it, height() * tall, pickMat());
        const fs = b.frontSide;
        // The building nearest the middle of the front side is the block's storefront.
        if (Math.abs(it.nx - fs.nx) < 0.2 && Math.abs(it.nz - fs.nz) < 0.2) {
          const prev = frontages.get(b);
          const dd = Math.hypot(it.cx - fs.mx, it.cz - fs.mz);
          if (!prev || (prev.dd !== undefined && dd < prev.dd)) {
            const fx = it.cx + it.nx * (it.d / 2);
            const fz = it.cz + it.nz * (it.d / 2);
            frontages.set(b, { x: fx, z: fz, h: it.h, nx: it.nx, nz: it.nz, ux: it.ux, uz: it.uz, dd, w: it.w, y0: heightAt(fx, fz) + 0.2 }); // (y0: the ground at the door, on a hill too)
          }
        }
      },
    });
    // Big blocks: something in the middle too (a tower, warehouse yard, project rows).
    const [ccx, ccz] = centroid(lot);
    if (b.area > 6000) {
      const s = b.frontSide;
      if (kind === 'projects') {
        for (let r = -2; r <= 2; r++) {
          const cx = ccx - s.nx * r * 22;
          const cz = ccz - s.nz * r * 22;
          const w = rr(38, 46);
          const R = rect4(cx, cz, w / 2, 5, s.ux, s.uz);
          if (R.every(([x, z]) => pointInPoly(x, z, lot)) && !placed.some((o) => overlaps(o.R, R, 3)) && clearOfRoads(cx, cz, 4) && footClear(R)) {
            const it = { R, cx, cz, w, d: 10, ang: Math.atan2(s.uz, s.ux), nx: s.nx, nz: s.nz };
            placed.push(it);
            onPlace(it, height(), pickMat());
          }
        }
      } else if (kind === 'docks') {
        for (let k = 0; k < 8; k++) {
          const x = ccx + rr(-20, 20);
          const z = ccz + rr(-20, 20);
          const R = rect4(x, z, 1.4, 3.2, s.ux, s.uz);
          if (R.every(([px, pz]) => pointInPoly(px, pz, lot)) && !placed.some((o) => overlaps(o.R, R, 1))) {
            placed.push({ R });
            addCover(x, z, 2.6, 6.2, 2.6, [0xb03a2e, 0x1f618d, 0x1e8449, 0xd68910, 0x7d3c98][k % 5], Math.atan2(s.uz, s.ux));
          }
        }
      } else if (kind === 'towers' || kind === 'city') {
        const w = rr(22, 34);
        const d = rr(22, 34);
        const R = rect4(ccx, ccz, w / 2, d / 2, s.ux, s.uz);
        if (R.every(([x, z]) => pointInPoly(x, z, lot)) && !placed.some((o) => overlaps(o.R, R, 2)) && clearOfRoads(ccx, ccz, 4) && footClear(R)) {
          const it = { R, cx: ccx, cz: ccz, w, d, ang: Math.atan2(s.uz, s.ux), nx: s.nx, nz: s.nz };
          placed.push(it);
          onPlace(it, height() * 1.2, pickMat());
        }
      }
    }
    b.buildings = placed;
  }

  // Quarry, junkyard, lookout.
  for (const b of blocks) {
    if (b.type !== 'place') continue;
    const y = b.padY;
    if (b.special === 'quarry') {
      for (let k = 0; k < 7; k++) addCover(b.cx + rr(-25, 25), b.cz + rr(-25, 25), rr(2, 4), rr(2, 4), rr(1.2, 2.4), 0x8a8478);
    } else if (b.special === 'junkyard') {
      const cols = [0x6b3a2a, 0x40566b, 0x5b5b52, 0x7a6a3a];
      for (let k = 0; k < 14; k++) addCover(b.cx + rr(-28, 28), b.cz + rr(-28, 28), 1.9, 4.2, 1.4, cols[k % 4], rr(0, Math.PI));
      building(b.cx + 20, b.cz - 24, 12, 8, 4, lam(0x5d5346), 0, y);
    } else if (b.special === 'lookout') {
      for (let k = -3; k <= 3; k++) addCover(b.cx + k * 4, b.cz - 20, 3, 0.8, 0.7, 0x6d4c2f);
    }
    lawns.push(b.poly);
  }

  // Sidewalk slabs, lawns and plazas.
  for (const p of slabs) batch.add(slabPoly(p, 0, 0.2), sidewalkMat);
  for (const p of plazas) batch.add(flatPoly(p, 0.23), plazaMat);
  for (const p of rampLawns) batch.add(flatPoly(p, 0.02), lawnMat);
  for (const b of blocks) if (b.lot) batch.add(flatPoly(b.poly, b.padY + 0.02), b.type === 'place' ? lam(0x6f6a5c) : yardMat);
  for (const p of lawns) {
    const b = blockAt(...centroid(p));
    if (b && b.lot) continue;
    batch.add(flatPoly(p, 0.24), lawnMat);
  }

  // Street trees along the sidewalks of the busier districts.
  for (const b of blocks) {
    if (b.lot || b.type === 'ramps' || b.type === 'plaza') continue;
    if (b.district === 'The Docks' || b.district === 'The Projects') continue;
    for (const s of b.sides) {
      if (s.len < 20 || s.cls === 'under') continue;
      const step = PHONE ? 22 : 15;
      for (let t = 9; t < s.len - 9; t += step) {
        const x = s.ax + s.ux * t - s.nx * 1.2;
        const z = s.az + s.uz * t - s.nz * 1.2;
        if (!clearOfRoads(x, z, 2)) continue;
        if (stores.some((st) => Math.hypot(st.x - x, st.z - z) < 9)) continue;
        if (b.buildings?.some((o) => pointInPoly(x, z, o.R))) continue;
        tree(x, z, 0.9);
      }
    }
  }
  // Forest outside the city: thicker on the hills.
  {
    const step = PHONE ? 15 : 11;
    for (let x = step / 2; x < MAP; x += step) {
      for (let z = step / 2; z < MAP; z += step) {
        const px = x + rr(-step / 2, step / 2);
        const pz = z + rr(-step / 2, step / 2);
        if (paved(px, pz) || isWater(px, pz) || shoreDist(px, pz) < 10) continue;
        const h = heightAt(px, pz);
        const keep = h > 6 ? 0.75 : 0.32;
        if (rng() > keep) continue;
        const gi = Math.round(px / TG);
        const gj = Math.round(pz / TG);
        if (RW[gj * GN + gi] > 0.02) continue;
        if (blockAt(px, pz) || inHole(px, pz, 5) || nearRamp(px, pz, 6) || ringDist(px, pz) < RING_HALF + 6) continue;
        tree(px, pz, rr(0.9, 1.5));
      }
    }
  }
  // Draw the trees: instanced, a batch per map chunk.
  {
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.2, 0);
    crownGeo.translate(0, 4, 0);
    const trunkMat = lam(0x5b3a1e);
    const crownMats = [lam(0x2f6b2f), lam(0x3a7a35), lam(0x28592a)];
    const CH = 800;
    const chunks = new Map();
    for (const t of treeList) {
      const k = `${Math.floor(t[0] / CH)},${Math.floor(t[1] / CH)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(t);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const list of chunks.values()) {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
      const byMat = crownMats.map(() => []);
      list.forEach(([x, z, s, y], i) => {
        q.setFromAxisAngle(up, (x * 7 + z * 3) % 6.28);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
        trunks.setMatrixAt(i, m4);
        byMat[Math.floor(Math.abs(x * 13 + z * 7)) % crownMats.length].push(m4.clone());
      });
      trunks.castShadow = true;
      trunks.computeBoundingSphere();
      scene.add(trunks);
      byMat.forEach((ms, k) => {
        if (!ms.length) return;
        const crowns = new THREE.InstancedMesh(crownGeo, crownMats[k], ms.length);
        ms.forEach((m, i) => crowns.setMatrixAt(i, m));
        crowns.castShadow = true;
        crowns.computeBoundingSphere();
        scene.add(crowns);
      });
    }
  }

  // ======== Road markings ========
  let markings = null;
  {
    const dashGeo = new THREE.PlaneGeometry(0.25, 3);
    dashGeo.rotateX(-Math.PI / 2);
    const lineGeo = new THREE.PlaneGeometry(0.16, 1);
    lineGeo.rotateX(-Math.PI / 2);
    const dashes = [];
    const lines = [];
    // How far each edge's markings stay back from the junction at each end.
    const clear = (n, e) => {
      let m = 0;
      for (const f of n.edges) if (f !== e) m = Math.max(m, f.w / 2);
      if (n.edges.length === 2) return 0; // (a bend, not a junction: the line carries on round it)
      return n.edges.length > 1 ? m + 4.5 : 1;
    };
    for (const e of GRAPH.edges) {
      if (e.cls === 'pier' || e.culDeSac || e.street?.stub !== undefined || e.street?.roundabout) continue; // (a roundabout: one way, no center line)
      const L = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      const ux = (e.b.x - e.a.x) / L;
      const uz = (e.b.z - e.a.z) / L;
      const t0 = clear(e.a, e);
      const t1 = L - clear(e.b, e);
      if (t1 - t0 < 4) continue;
      const ry = Math.atan2(ux, uz);
      for (let t = t0 + 1.5; t < t1 - 1.5; t += 6) {
        const x = e.a.x + ux * t;
        const z = e.a.z + uz * t;
        if (!paved(x, z)) continue; // (out on the hills: laid along the drawn road, below)
        dashes.push([x, roadY(x, z), z, ry]);
      }
      // The parking lane's edge line, in 3 m pieces: none where it would run out into another
      // road (a junction, a road meeting this one at an angle), none on a stub of a street.
      if (ROAD_CLASS[e.cls].parking && t1 - t0 >= 12 && paved(e.a.x, e.a.z) && paved(e.b.x, e.b.z)) {
        const off = e.w / 2 - 2.8;
        for (const s of [-1, 1]) {
          for (let t = t0; t + 3 <= t1 + 0.01; t += 3) {
            const x = e.a.x + ux * (t + 1.5) - uz * off * s;
            const z = e.a.z + uz * (t + 1.5) + ux * off * s;
            const ends = [[x - ux * 1.5, z - uz * 1.5], [x + ux * 1.5, z + uz * 1.5]];
            if (ends.some(([px, pz]) => edgesNear(px, pz, 1).some((o) => o !== e && o.street !== e.street))) continue;
            lines.push([x, roadY(x, z) + 0.001, z, ry, 3]);
          }
        }
      }
    }
    const cityDashes = dashes.length;
    // Roads out on the hills: the center dashes laid along the road as drawn, bending with
    // its curves and lying on it end to end up and down the slopes (not flat straight bars).
    const hillDash = [];
    for (const r of ribbons) {
      const st = r.st;
      if (st.cls === 'pier' || st.culDeSac) continue;
      const P = r.pts;
      const S = [0];
      for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = S[S.length - 1];
      let seg = 1;
      const at = (t) => {
        while (seg < P.length - 1 && S[seg] < t) seg++;
        while (seg > 1 && S[seg - 1] > t) seg--;
        const [ax, az] = P[seg - 1];
        const [bx, bz] = P[seg];
        const L = S[seg] - S[seg - 1] || 1;
        const k = Math.max(0, Math.min(1, (t - S[seg - 1]) / L));
        return [ax + (bx - ax) * k, az + (bz - az) * k, (bx - ax) / L, (bz - az) / L];
      };
      // (clear of junctions: where another road's pavement, plus room to turn, is close)
      const nearOther = (x, z) => edgesNear(x, z, 4.5).some((e) => e.street !== st && e.street?.stub === undefined);
      seg = 1;
      for (let t = 1.5; t + 3 < total - 1; t += 6) {
        const pts = [];
        let ok = true;
        for (let u = 0; u <= 3.001; u += 0.75) {
          const [x, z, dx, dz] = at(t + u);
          if (paved(x, z) || nearOther(x, z)) {
            ok = false;
            break;
          }
          pts.push([x, z, dx, dz]);
        }
        if (!ok) continue;
        for (let i = 0; i + 1 < pts.length; i++) {
          const q = [pts[i], pts[i + 1]].map(([x, z, dx, dz]) => {
            const y = heightAt(x, z) + 0.07;
            return [x + dz * 0.125, y, z - dx * 0.125, x - dz * 0.125, y, z + dx * 0.125];
          });
          const [a0, a1] = [q[0].slice(0, 3), q[0].slice(3)];
          const [b0, b1] = [q[1].slice(0, 3), q[1].slice(3)];
          hillDash.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
        }
        const [mx, mz, dx, dz] = at(t + 1.5);
        dashes.push([mx, heightAt(mx, mz) + 0.07, mz, Math.atan2(dx, dz), pts.map(([x, z]) => [x, heightAt(x, z) + 0.07, z])]); // (and the points it's laid through, for the tests)
      }
    }
    if (hillDash.length) {
      // (both faces: whichever way the road runs)
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(hillDash, 3));
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd9c45a, side: THREE.DoubleSide })));
    }
    markings = { dashes, lines };
    const flatDashes = dashes.slice(0, cityDashes); // (the city's: flat bars, all alike)
    const dashMesh = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xd9c45a }), flatDashes.length);
    const dummy = new THREE.Object3D();
    flatDashes.forEach(([x, y, z, ry], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    });
    dashMesh.computeBoundingSphere();
    scene.add(dashMesh);
    const lineMesh = new THREE.InstancedMesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xd8d8d8 }), lines.length);
    lines.forEach(([x, y, z, ry, len], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, len);
      dummy.updateMatrix();
      lineMesh.setMatrixAt(i, dummy.matrix);
    });
    lineMesh.computeBoundingSphere();
    scene.add(lineMesh);
  }

  // ======== Gang and crew hangouts, spawn ========
  const fp = (b, inward) => frontPoint(b, inward);
  const kings = PLACES.gangHome;
  let gangHome;
  {
    // The Kings hold a corner of their block: the front side's far corner.
    const s = kings.frontSide;
    const cx = s.bx - s.nx * 4 - s.ux * 4;
    const cz = s.bz - s.nz * 4 - s.uz * 4;
    const ang = Math.atan2(s.uz, s.ux);
    addCover(cx - s.ux * 6 + s.nx * 1.8, cz - s.uz * 6 + s.nz * 1.8, 1.4, 1.4, 1.1, 0x7a5a32, ang);
    addCover(cx - s.nx * 6, cz - s.nz * 6, 1.4, 1.4, 1.1, 0x7a5a32, ang);
    addCover(cx - s.ux * 12 + s.nx * 1.6, cz - s.uz * 12 + s.nz * 1.6, 2.6, 1.4, 1.4, 0x2e5e3a, ang);
    addCover(cx - s.nx * 12 + s.ux * 1.6, cz - s.nz * 12 + s.uz * 1.6, 1.4, 2.6, 1.4, 0x2e5e3a, ang);
    addCover(cx + s.nx * (kings.frontSide.edge?.w || 16) + s.nx * 6, cz + s.nz * ((kings.frontSide.edge?.w || 16) + 6), 1.4, 1.4, 1.1, 0x7a5a32, ang);
    gangHome = { x: cx, z: cz, block: kings, heading: Math.atan2(s.nx, s.nz) };
  }
  const home = PLACES.crewHome;
  const hp = fp(home, 2.4);
  const crewHome = { x: hp.x + hp.ux * 18, z: hp.z + hp.uz * 18, block: home, heading: hp.heading, nx: hp.nx, nz: hp.nz, ux: hp.ux, uz: hp.uz };
  addCover(crewHome.x - crewHome.nx * 3.2, crewHome.z - crewHome.nz * 3.2, 3, 0.8, 0.7, 0x6d4c2f, Math.atan2(hp.uz, hp.ux));
  // New players start on the sidewalk outside the square; two cars by the curb.
  const sw = fp(home, 1.2);
  const curbOff = (home.frontSide.edge?.w || 16) / 2 - 1.6;
  const cx0 = home.frontSide.mx + home.frontSide.nx * (home.frontSide.edge ? 1 : 0);
  const cz0 = home.frontSide.mz;
  const e = home.frontSide.edge;
  let lineX = cx0 + home.frontSide.nx * 8;
  let lineZ = cz0 + home.frontSide.nz * 8;
  if (e) {
    const c = closestOnSeg(home.frontSide.mx, home.frontSide.mz, e.a.x, e.a.z, e.b.x, e.b.z);
    lineX = c.x + home.frontSide.nx * -curbOff;
    lineZ = c.z + home.frontSide.nz * -curbOff;
  }
  const along = Math.atan2(home.frontSide.ux, home.frontSide.uz);
  const spawn = {
    x: sw.x, z: sw.z, heading: sw.heading,
    cars: [[lineX + home.frontSide.ux * 8, lineZ + home.frontSide.uz * 8, along], [lineX - home.frontSide.ux * 8, lineZ - home.frontSide.uz * 8, along]],
  };

  // Storefront of a block: where its front door is (the building facing its front street).
  const storefront = (b) => {
    if (frontages.has(b)) {
      const f = frontages.get(b);
      return { x: f.x + f.nx * 1.6, z: f.z + f.nz * 1.6, wallX: f.x, wallZ: f.z, h: f.h, nx: f.nx, nz: f.nz, ux: f.ux, uz: f.uz, rotY: Math.atan2(f.nx, f.nz), heading: Math.atan2(-f.nx, -f.nz), y0: f.y0 || 0.2 };
    }
    const p = frontPoint(b, b.sw + 1);
    return { x: p.x, z: p.z, wallX: p.x - p.nx * 1.6, wallZ: p.z - p.nz * 1.6, h: 6, nx: p.nx, nz: p.nz, ux: p.ux, uz: p.uz, rotY: p.rotY, heading: p.heading + Math.PI, y0: 0.2 };
  };

  batch.flush();

  // ======== Map ========
  // Terrain picture, drawn once.
  const terrainImg = document.createElement('canvas');
  {
    const n = 200;
    terrainImg.width = terrainImg.height = n;
    const g = terrainImg.getContext('2d');
    const img = g.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) * MAP) / n;
      const z = ((j + 0.5) * MAP) / n;
      const k = (j * n + i) * 4;
      let c;
      if (isWater(x, z)) c = [28, 58, 92];
      else if (paved(x, z)) c = [125, 128, 134];
      else {
        const h = heightAt(x, z);
        const v = Math.min(1, Math.max(0, h / 45));
        c = [38 + v * 40, 64 + v * 30, 42 + v * 22];
        if (shoreDist(x, z) < 12) c = [150, 138, 100];
      }
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const drawMap = (ctx, px) => {
    const s = px / MAP;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainImg, 0, 0, px, px);
    // Hill roads.
    ctx.strokeStyle = '#7d8086';
    ctx.lineCap = 'round';
    for (const r of ribbons) {
      ctx.lineWidth = Math.max(1.5, r.w * s);
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => (i ? ctx.lineTo(x * s, z * s) : ctx.moveTo(x * s, z * s)));
      ctx.stroke();
    }
    for (const p of piers) {
      ctx.lineWidth = p.hw * 2 * s;
      ctx.beginPath();
      ctx.moveTo(p.ax * s, p.az * s);
      ctx.lineTo(p.bx * s, p.bz * s);
      ctx.stroke();
    }
    const colors = { park: '#3f6b35', ramps: '#3a5a34', plaza: '#5b5a55', police: '#244a8a', chop: '#8a4a12', hospital: '#8a2a2a', cityhall: '#5a5648', place: '#5b5546' };
    const shade = { 'The Heights': '#3c4a3e', 'Financial District': '#2b3947', 'Government District': '#45443e', 'The Projects': '#3e302c', 'The Strip': '#362d42', 'The Docks': '#34373b', Downtown: '#30353b', Midtown: '#2f3439' };
    for (const b of blocks) {
      ctx.fillStyle = colors[b.type] || shade[b.district] || '#2f3439';
      ctx.beginPath();
      b.poly.forEach(([x, z], i) => (i ? ctx.lineTo(x * s, z * s) : ctx.moveTo(x * s, z * s)));
      ctx.closePath();
      ctx.fill();
    }
    drawCourt(ctx, s);
  };

  const city = {
    windowMats, colliders, los, crates, blocks, stores, chop, station, hospital, gangHome, crewHome, spawn,
    get markings() { return markings; },
    nodes, edges: GRAPH.edges, nearestNode, blockAt, groundY, paved, heightAt, roadY, drawMap, size: MAP, hilly: true,
    storefront, frontPoint, edgeAt, streetAt, onPier,
    byKey: new Map(blocks.map((b) => [b.key, b])),
    reserved: COURT_RESERVED, // (ground kept clear of signs and poles: the court and its lot)
  };
  city.court = buildCourt(city, scene);
  return city;
}
