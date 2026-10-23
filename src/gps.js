import { CFG } from './config.js';
import { dist } from './util.js';

// GPS: the shortest drive along the street grid from one point to another, preferring
// fewer turns. Returns a list of [x, z] points (start, corners, end).
const TURN = 40; // a turn "costs" this many meters, so the route sticks to long straights

// The nearest point on a road, and the two intersections at either end of that stretch.
function snap(city, x, z) {
  const P = CFG.PITCH;
  const N = city.N;
  const cl = (v) => Math.max(0, Math.min(N * P, v));
  const i = Math.max(0, Math.min(N, Math.round(x / P)));
  const j = Math.max(0, Math.min(N, Math.round(z / P)));
  const onV = [i * P, cl(z)]; // on an avenue (runs along z)
  const onH = [cl(x), j * P]; // on a street (runs along x)
  if (dist(x, z, ...onV) <= dist(x, z, ...onH)) {
    const j0 = Math.min(N - 1, Math.floor(onV[1] / P));
    return { p: onV, ends: [city.nodeAt(i, j0), city.nodeAt(i, j0 + 1)] };
  }
  const i0 = Math.min(N - 1, Math.floor(onH[0] / P));
  return { p: onH, ends: [city.nodeAt(i0, j), city.nodeAt(i0 + 1, j)] };
}

const dirOf = (ax, az, bx, bz) => (Math.abs(bx - ax) > Math.abs(bz - az) ? (bx > ax ? 0 : 1) : bz > az ? 2 : 3);

export function gpsRoute(city, fx, fz, tx, tz) {
  const a = snap(city, fx, fz);
  const b = snap(city, tx, tz);
  // Same stretch of road: straight there.
  if (a.ends.every((n) => b.ends.includes(n))) return [[fx, fz], a.p, b.p, [tx, tz]];
  // Dijkstra over (intersection, heading) so turns can cost extra.
  const best = new Map();
  const prev = new Map();
  const open = [];
  const push = (n, d, cost, from) => {
    const k = n.i * 100 + n.j + d * 10000;
    if (best.has(k) && best.get(k) <= cost) return;
    best.set(k, cost);
    prev.set(k, from);
    open.push({ n, d, cost, k });
  };
  for (const n of a.ends) push(n, dirOf(...a.p, n.x, n.z), dist(...a.p, n.x, n.z), null);
  let done = null;
  let doneCost = Infinity;
  while (open.length) {
    let bi = 0;
    for (let q = 1; q < open.length; q++) if (open[q].cost < open[bi].cost) bi = q;
    const cur = open.splice(bi, 1)[0];
    if (cur.cost > best.get(cur.k) || cur.cost >= doneCost) continue;
    if (b.ends.includes(cur.n)) {
      const d = dirOf(cur.n.x, cur.n.z, ...b.p);
      const c = cur.cost + dist(cur.n.x, cur.n.z, ...b.p) + (d === cur.d ? 0 : TURN);
      if (c < doneCost) {
        doneCost = c;
        done = cur.k;
      }
    }
    for (const m of cur.n.nb) {
      const d = dirOf(cur.n.x, cur.n.z, m.x, m.z);
      if (d === (cur.d ^ 1)) continue; // no U-turns mid-route
      push(m, d, cur.cost + CFG.PITCH + (d === cur.d ? 0 : TURN), cur.k);
    }
  }
  if (done === null) return [[fx, fz], [tx, tz]];
  const nodes = [];
  for (let k = done; k !== null; k = prev.get(k)) {
    const id = k % 10000;
    nodes.unshift(city.nodeAt(Math.floor(id / 100), id % 100));
  }
  const pts = [[fx, fz], a.p, ...nodes.map((n) => [n.x, n.z]), b.p, [tx, tz]];
  // Drop points in the middle of a straight line.
  return pts.filter((p, k) => {
    if (k <= 1 || k >= pts.length - 2) return true; // ends, and where they join the road
    const [p0, p1] = [pts[k - 1], pts[k + 1]];
    const cross = (p[0] - p0[0]) * (p1[1] - p[1]) - (p[1] - p0[1]) * (p1[0] - p[0]);
    return Math.abs(cross) > 1e-3;
  });
}

// Total length of a route, in meters.
export function routeLength(pts) {
  let d = 0;
  for (let k = 1; k < pts.length; k++) d += dist(...pts[k - 1], ...pts[k]);
  return d;
}

// The route drawn on the road in 3D: a yellow strip with chevrons sliding toward the
// waypoint, plus a light beam standing on the waypoint itself.
const W = 0.9; // strip width
const TILE = 2.4; // meters per chevron
export class GpsLine {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#e0a800';
    g.fillRect(0, 0, 64, 32);
    g.strokeStyle = '#fff2a8';
    g.lineWidth = 7;
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(18, 3);
    g.lineTo(40, 16);
    g.lineTo(18, 29);
    g.stroke();
    this.tex = new THREE.CanvasTexture(c);
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.visible = false;
    scene.add(this.beam);
    this.key = '';
  }

  // pts: the route from gpsRoute (first and last points are off the road, so skip them).
  update(dt, pts, waypoint) {
    this.tex.offset.x -= dt * 0.9; // chevrons slide toward the waypoint
    this.beam.visible = !!waypoint;
    if (waypoint) {
      this.beam.position.set(waypoint[0], 30, waypoint[1]);
      this.beam.material.opacity = 0.28 + 0.1 * Math.sin(performance.now() / 300);
    }
    const road = pts && pts.length > 2 ? pts.slice(1, -1) : null;
    this.mesh.visible = !!road;
    if (!road) return;
    const key = road.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    const pos = [];
    const uv = [];
    const idx = [];
    // Measure from the end, so the chevrons don't jump as the start moves with you.
    let u = -routeLength(road);
    const y = 0.04;
    for (let k = 1; k < road.length; k++) {
      const [ax, az] = road[k - 1];
      const [bx, bz] = road[k];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const nx = -dz * (W / 2);
      const nz = dx * (W / 2);
      // Stretch each piece by half the width so corners join up.
      const sx = ax - dx * (W / 2), sz = az - dz * (W / 2);
      const ex = bx + dx * (W / 2), ez = bz + dz * (W / 2);
      const u0 = (u - W / 2) / TILE;
      const u1 = (u + len + W / 2) / TILE;
      const i = pos.length / 3;
      pos.push(sx + nx, y, sz + nz, sx - nx, y, sz - nz, ex + nx, y, ez + nz, ex - nx, y, ez - nz);
      uv.push(u0, 1, u0, 0, u1, 1, u1, 0);
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      u += len;
    }
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new this.THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }
}
