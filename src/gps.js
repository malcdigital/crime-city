import { dist } from './util.js';

// GPS: the quickest drive from one point to another over the road network (streets, ramps
// and freeways; one-way where they are), preferring fewer turns and the freeway for long
// trips. Returns a list of [x, z] points (start, the road, end); route.ys holds the height of
// each point (so the line can follow the freeway decks).
const TURN = 25; // a turn "costs" this many meters, so the route sticks to long straights

// The nearest street, its ends, and where on it.
function snap(city, x, z) {
  const hit = city.edgeAt(x, z);
  if (!hit) {
    const n = city.nearestNode(x, z, (q) => q.street);
    return { p: [n.x, n.z], ends: [n] };
  }
  return { p: [hit.x, hit.z], ends: [hit.e.a, hit.e.b], e: hit.e };
}

// opts.high: starting up on the freeway (the route starts on the lane you're in).
export function gpsRoute(city, fx, fz, tx, tz, opts = {}) {
  const hw = city.highway;
  let a = snap(city, fx, fz);
  if (opts.high && hw) {
    // The nearest freeway node ahead of you (any lane, any ramp).
    let best = null;
    let bd = 30;
    for (const n of hw.nodes) {
      const d = dist(n.x, n.z, fx, fz);
      if (d < bd && (!opts.fwd || (n.x - fx) * opts.fwd[0] + (n.z - fz) * opts.fwd[1] > 0)) {
        bd = d;
        best = n;
      }
    }
    if (best) a = { p: [fx, fz], ends: [best] };
  }
  const b = snap(city, tx, tz);
  // Same stretch of road: straight there.
  if (a.e && a.e === b.e) return withHeights(city, [[fx, fz], a.p, b.p, [tx, tz]]);
  const goal = new Set(b.ends);
  const best = new Map();
  const prev = new Map();
  const heap = [];
  const push = (n, g, from) => {
    if (best.has(n) && best.get(n) <= g) return;
    best.set(n, g);
    prev.set(n, from);
    const f = g + dist(n.x, n.z, ...b.p) * 0.75;
    heap.push([f, g, n]);
    let i = heap.length - 1;
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (heap[q][0] <= heap[i][0]) break;
      [heap[q], heap[i]] = [heap[i], heap[q]];
      i = q;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const n of a.ends) push(n, dist(...a.p, n.x, n.z), null);
  let done = null;
  let doneCost = Infinity;
  let guard = 0;
  while (heap.length && guard++ < 60000) {
    const [, g, n] = pop();
    if (g > best.get(n) || g >= doneCost) continue;
    if (goal.has(n)) {
      const c = g + dist(n.x, n.z, ...b.p);
      if (c < doneCost) {
        doneCost = c;
        done = n;
      }
    }
    const p = prev.get(n);
    for (const m of n.nb) {
      if (m === p) continue; // no U-turns mid-route
      let cost = dist(n.x, n.z, m.x, m.z);
      // Freeways are quicker (cost by time, roughly), ramps a bit slower than streets.
      if (n.high && m.high) cost *= n.ramp || m.ramp ? 0.75 : 0.42;
      if (p) {
        const ax = n.x - p.x;
        const az = n.z - p.z;
        const bx = m.x - n.x;
        const bz = m.z - n.z;
        const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
        if (c < 0.7) cost += TURN;
      }
      push(m, g + cost, n);
    }
  }
  if (!done) return withHeights(city, [[fx, fz], [tx, tz]]);
  const nodes = [];
  for (let n = done; n; n = prev.get(n)) nodes.unshift(n);
  const pts = [[fx, fz], a.p, ...nodes.map((n) => [n.x, n.z]), b.p, [tx, tz]];
  const ys = [null, null, ...nodes.map((n) => (n.high ? n.hy : null)), null, null];
  // Drop points in the middle of a straight line (at the same height).
  const keep = pts.map((p, k) => {
    if (k <= 1 || k >= pts.length - 2) return true;
    const [p0, p1] = [pts[k - 1], pts[k + 1]];
    const cross = (p[0] - p0[0]) * (p1[1] - p[1]) - (p[1] - p0[1]) * (p1[0] - p[0]);
    return Math.abs(cross) > 1e-3 || (ys[k] ?? 0) !== (ys[k - 1] ?? 0);
  });
  const out = pts.filter((_, k) => keep[k]);
  out.ys = ys.filter((_, k) => keep[k]).map((y, k) => (y ?? city.groundY(...out[k])));
  return out;
}

function withHeights(city, pts) {
  pts.ys = pts.map((p) => city.groundY(...p));
  return pts;
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
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false });
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
    const ys = pts && pts.ys ? pts.ys.slice(1, -1) : null;
    this.mesh.visible = !!road;
    if (!road) return;
    const key = road.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('|') + (ys ? ys.join(',') : '');
    if (key === this.key) return;
    this.key = key;
    const pos = [];
    const uv = [];
    const idx = [];
    // Measure from the end, so the chevrons don't jump as the start moves with you.
    let u = -routeLength(road);
    for (let k = 1; k < road.length; k++) {
      // (floats just above the road; follows the decks up on the freeway)
      const ya = (ys ? ys[k - 1] : 0) + 0.15;
      const yb = (ys ? ys[k] : 0) + 0.15;
      const [ax, az] = road[k - 1];
      const [bx, bz] = road[k];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const nx = -dz * (W / 2);
      const nz = dx * (W / 2);
      // Corners: each piece runs half a width past its end, and the next starts half a width
      // in, so they join without overlapping (overlaps would show darker).
      const s0 = k === 1 ? -W / 2 : W / 2;
      const sx = ax + dx * s0, sz = az + dz * s0;
      const ex = bx + dx * (W / 2), ez = bz + dz * (W / 2);
      const u0 = (u + s0) / TILE;
      const u1 = (u + len + W / 2) / TILE;
      const i = pos.length / 3;
      pos.push(sx + nx, ya, sz + nz, sx - nx, ya, sz - nz, ex + nx, yb, ez + nz, ex - nx, yb, ez - nz);
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

// Shortest path between two street nodes along the streets only (no freeway, no ramp
// connectors): a list of nodes. filter(n) can rule out more nodes.
export function nodePath(a, b, filter = null) {
  const best = new Map([[a, 0]]);
  const prev = new Map();
  const open = [[0, a]];
  while (open.length) {
    let bi = 0;
    for (let q = 1; q < open.length; q++) if (open[q][0] < open[bi][0]) bi = q;
    const [g, n] = open.splice(bi, 1)[0];
    if (g > best.get(n)) continue;
    if (n === b) break;
    for (const m of n.nb) {
      if (!m.street || m.rampEnd || (filter && !filter(m))) continue;
      const e = n.edgeTo?.get(m);
      if (!e || e.street?.stub !== undefined || e.cls === 'pier' || e.cls === 'hills') continue;
      const c = g + dist(n.x, n.z, m.x, m.z) * (e.rank >= 4 ? 0.8 : 1.15);
      if (best.has(m) && best.get(m) <= c) continue;
      best.set(m, c);
      prev.set(m, n);
      open.push([c, m]);
    }
  }
  if (!best.has(b)) return null;
  const out = [];
  for (let n = b; n; n = prev.get(n)) out.unshift(n);
  return out;
}
