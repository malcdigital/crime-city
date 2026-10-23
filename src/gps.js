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
    if (k === 0 || k === pts.length - 1) return true;
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
