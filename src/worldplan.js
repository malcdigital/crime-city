// The city's plan: terrain, water, districts, every street and every block.
// Pure data and geometry (no 3D), so the city builder, the map and tests can all use it.
// The freeways and their ramps come from fwyplan.js; streets and blocks stay out of ramp land.
//
// Layout (x east, z south; the map is 1600 x 1600 m), after the research report
// (reports/City and highway design for games.md):
// - Sea along the south, a bay in the south-east; the Docks on the waterfront, with piers.
// - The ring freeway around the core, the crosstown north-south through it. A two-way street
//   runs under each (Ring Rd, Crosstown Rd).
// - Arterials: Park Ave, Midway Blvd and Market St east-west, Central Ave north-south, and
//   Grand Ave on the diagonal up to the Government District's plaza.
// - Districts with their own street patterns: Midtown West (grid), Midtown East (grid turned
//   25 degrees), Central Park, Downtown (tight grid), the Financial District (old, irregular),
//   the Projects (superblocks with cul-de-sacs), the Strip (a grid cut by curving Ocean Blvd),
//   the Government District, the inner Docks (big warehouse blocks).
// - Outside the ring: the Heights on a hill with winding contour roads, the Docks on the
//   water, wooded ridges north and west with a lookout, a quarry and a junkyard.
import {
  area, bbox, centroid, clipConvex, clipSegConvex, closestOnSeg, dist, insetConvex, isConvex,
  mulberry, pointInPoly, segInter, simplify,
} from './geom.js';
import { HOLES, RING, RING_HALF, RING_LINE, STUBS, XT, XT_HALF, inHole } from './fwyplan.js';

export const MAP = 1600;
const rng = mulberry(20261025);
const rr = (a, b) => a + rng() * (b - a);

// ---- Road classes: curb-to-curb width and sidewalk width ----
// lane: from the middle of the road to the middle of the travel lane each way; rank: which
// road has priority at a junction.
export const ROAD_CLASS = {
  arterial: { w: 20, sw: 5, parking: true, lane: 3.6, rank: 5 },
  collector: { w: 16, sw: 4, parking: true, lane: 3.4, rank: 4 },
  local: { w: 13, sw: 3, parking: false, lane: 3.0, rank: 2 },
  under: { w: 16, sw: 3, parking: false, lane: 3.4, rank: 3 }, // under a freeway
  hills: { w: 10, sw: 0, parking: false, lane: 2.6, rank: 2 },
  pier: { w: 12, sw: 0, parking: false, lane: 3.0, rank: 1 },
  roundabout: { w: 12, sw: 4, parking: false, lane: 0, rank: 6 }, // (one way round: drive its middle)
};

const { x0: RX0, z0: RZ0, x1: RX1, z1: RZ1 } = RING;
const CX = XT.x;
export const PARK_Z = 490;
export const MIDWAY_Z = 690;
export const MARKET_Z = 900;
export const CENTRAL_X = 900;

// ---- Terrain and water ----
export const SEA = -1.2; // water surface height
export function coastZ(x) {
  return 1445 + 10 * Math.sin(x / 140) + 5 * Math.sin(x / 47);
}
const BAY = { x: 1660, z: 1250, rx: 330, rz: 420 };
function bayK(x, z) {
  return Math.hypot((x - BAY.x) / BAY.rx, (z - BAY.z) / BAY.rz);
}
export function isWater(x, z) {
  return z > coastZ(x) || bayK(x, z) < 1;
}
// Distance to the shore (positive on land, roughly).
export function shoreDist(x, z) {
  return Math.min(coastZ(x) - z, (bayK(x, z) - 1) * BAY.rx);
}
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
// Signed distance from the ring freeway's centerline (negative inside): it's a rounded
// rectangle, so this is exact and quick.
export function ringSd(x, z) {
  const { x0, z0, x1, z1, r } = RING;
  const dx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const dz = Math.abs(z - (z0 + z1) / 2) - ((z1 - z0) / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - r;
}
export const ringDist = (x, z) => Math.abs(ringSd(x, z));
export const insideRing = (x, z) => ringSd(x, z) < 0;
export const HEIGHTS_CENTER = [1455, 380];
// Height of the land before roads are cut in. The city inside the ring (and a strip around
// it) is flat; outside, the Heights hill to the east, wooded ridges north and west, and the
// land drops to the sea.
export function terrain(x, z) {
  let h = 0;
  const out = insideRing(x, z) ? 0 : smooth((ringDist(x, z) - RING_HALF - 22) / 90);
  if (out > 0) {
    const [hx, hz] = HEIGHTS_CENTER;
    const d1 = Math.hypot(x - hx, z - hz);
    h += 44 * smooth(1 - d1 / 230) ** 1.3;
    h += 14 * smooth(1 - Math.hypot(x - 1420, z - 700) / 160);
    h += 26 * smooth((80 - z) / 80) + 18 * smooth((80 - x) / 80);
    h *= out;
  }
  const sd = shoreDist(x, z);
  if (sd < 8) h = Math.min(h, -0.3 - (8 - sd) * 0.45);
  return Math.max(h, -5);
}

// ---- Districts: zones (convex polygons) that decide the street pattern, looks and gameplay ----
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const inRing = (poly) => clipConvex(poly, RING_LINE);

export const ZONES = [
  { name: 'Midtown', id: 'mid-w', poly: inRing(rect(0, 0, CX, PARK_Z)), kind: 'grid', angle: 0, du: 78, dv: 84 },
  { name: 'The Projects', id: 'proj', poly: rect(RX0, PARK_Z, CX, MARKET_Z), kind: 'super', angle: 0, du: 140, dv: 135 },
  { name: 'The Strip', id: 'strip', poly: inRing(rect(0, MARKET_Z, CX, 1600)), kind: 'grid', angle: 0, du: 92, dv: 88 },
  { name: 'Midtown', id: 'mid-e', poly: rect(CX, RZ0, CENTRAL_X, PARK_Z), kind: 'grid', angle: 0.44, du: 88, dv: 70 },
  { name: 'Central Park', id: 'park', poly: rect(CX, PARK_Z, CENTRAL_X, MIDWAY_Z), kind: 'park' },
  { name: 'Downtown', id: 'down', poly: rect(CX, MIDWAY_Z, CENTRAL_X, MARKET_Z), kind: 'grid', angle: 0, du: 75, dv: 70 },
  { name: 'Financial District', id: 'fin', poly: rect(CX, MARKET_Z, CENTRAL_X, RZ1), kind: 'old', du: 64, dv: 60 },
  { name: 'Government District', id: 'gov', poly: inRing(rect(CENTRAL_X, 0, 1600, PARK_Z)), kind: 'grid', angle: 0, du: 118, dv: 104 },
  { name: 'Downtown', id: 'down-e', poly: rect(CENTRAL_X, PARK_Z, RX1, MARKET_Z), kind: 'grid', angle: 0, du: 90, dv: 72 },
  { name: 'The Docks', id: 'docks-in', poly: inRing(rect(CENTRAL_X, MARKET_Z, 1600, 1600)), kind: 'grid', angle: 0, du: 120, dv: 120 },
];
export function districtAt(x, z) {
  if (insideRing(x, z) && ringDist(x, z) > RING_HALF) {
    for (const zn of ZONES) if (pointInPoly(x, z, zn.poly)) return zn.name === 'Central Park' ? 'Midtown' : zn.name;
  }
  if (x > RX1 - 20 && z < 1050) return 'The Heights';
  if (z > RZ1 - 20) return 'The Docks';
  if (x > RX1 - 20) return 'The Docks';
  if (z < RZ0 + 20) return x > CENTRAL_X ? 'Government District' : 'Midtown';
  if (x < RX0 + 20) return z < PARK_Z ? 'Midtown' : z < MARKET_Z ? 'The Projects' : 'The Strip';
  for (const zn of ZONES) if (pointInPoly(x, z, zn.poly)) return zn.name === 'Central Park' ? 'Midtown' : zn.name;
  return 'Midtown';
}

// ---- Streets ----
// Each: { pts: [[x, z], ...], cls, name, keep?: true (not cut by ramp land) }.
const streets = [];
const add = (pts, cls, name, extra = {}) => {
  streets.push({ pts, cls, name, ...extra });
};

// Under the freeways.
add([...RING_LINE, RING_LINE[0]], 'under', 'Ring Rd', { keep: true, loop: true });
add([[CX, RZ0], [CX, RZ1]], 'under', 'Crosstown Rd', { keep: true });
// Arterials (cross streets at the interchanges go on out past the ring).
add([[20, PARK_Z], [1345, PARK_Z]], 'arterial', 'Park Ave', { keep: true });
add([[RX0, MIDWAY_Z], [RX1, MIDWAY_Z]], 'arterial', 'Midway Blvd', { keep: true });
add([[20, MARKET_Z], [1340, MARKET_Z]], 'arterial', 'Market St', { keep: true }); // (on past the ring far enough to meet the exit road there)
export const WATERFRONT = (x) => coastZ(x) - 30;
add([[CENTRAL_X, 28], [CENTRAL_X, WATERFRONT(CENTRAL_X)]], 'arterial', 'Central Ave', { keep: true });
// The diagonal, from Market St up through Downtown to the Government plaza.
export const PLAZA = [1080, 300];
add([[640, MARKET_Z], [CENTRAL_X, MIDWAY_Z], PLAZA], 'arterial', 'Grand Ave');
// The Strip: Ocean Blvd sweeps through it toward the water.
{
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.05) pts.push([150 + 360 * t, 935 + 240 * t - 60 * Math.sin(t * Math.PI)]);
  add(pts, 'collector', 'Ocean Blvd');
}
// Docks: Waterfront Dr, streets down from Ring Rd, and the piers.
{
  const wf = [];
  for (let x = 150; x <= 1290; x += 30) wf.push([x, WATERFRONT(x)]);
  add(wf, 'collector', 'Waterfront Dr');
  for (const [x, name] of [[200, 'Harbor Rd'], [380, 'Cannery Rd'], [660, 'Pier Rd'], [1120, 'Bay Rd']]) {
    add([[x, RZ1 - 10], [x, WATERFRONT(x)]], 'collector', name);
  }
  add([[150, WATERFRONT(150)], [150, RZ1 - 60]], 'collector', null);
  for (const [k, x] of [230, 470, 760, 1010, 1240].entries()) add([[x, WATERFRONT(x)], [x, 1570]], 'pier', `Pier ${k + 1}`);
}
// The Heights: Park Ave climbs in, contour roads wind round the hill, Summit Rd goes up the
// middle, and Bayview Dr comes up from Market St along the bay.
const [HX, HZ] = HEIGHTS_CENTER;
const arcPts = (cx, cz, r, a0, a1, step = 10) => {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
};
const onLand = (pts) => pts.filter(([x, z]) => x > RX1 + 60 && x < 1590 && z > 15 && shoreDist(x, z) > 25);
add(onLand(arcPts(HX, HZ, 175, Math.PI * 0.62, Math.PI * 1.7)), 'hills', 'Canyon Dr');
add(arcPts(HX, HZ, 175, Math.PI * 0.56, Math.PI * 0.62), 'hills', 'Canyon Dr'); // (on round to where Bayview Dr comes up)
add(onLand(arcPts(HX, HZ, 105, Math.PI * 0.2, Math.PI * 1.85)), 'hills', 'Vista Loop');
add(arcPts(HX, HZ, 42, 0, Math.PI * 2), 'hills', 'Summit Cir');
// (up from Canyon Dr on the north-west side, clear of the Park Ave interchange's land)
add([[HX + 175 * Math.cos(Math.PI * 1.3), HZ + 175 * Math.sin(Math.PI * 1.3)], [HX + 105 * Math.cos(Math.PI * 1.3), HZ + 105 * Math.sin(Math.PI * 1.3)]], 'hills', 'Summit Rd');
add([[HX + 105 * Math.cos(Math.PI * 1.3), HZ + 105 * Math.sin(Math.PI * 1.3)], [HX + 42 * Math.cos(Math.PI * 1.3), HZ + 42 * Math.sin(Math.PI * 1.3)]], 'hills', 'Summit Rd'); // (on up to the top, in line)
add([[1320, MARKET_Z], [1380, 860], [1420, 790], [1440, 700], [1446, 630], [HX + 175 * Math.cos(Math.PI * 0.56), HZ + 175 * Math.sin(Math.PI * 0.56)]], 'hills', 'Bayview Dr');
// The ridges: a lookout north up Central Ave, a quarry and a junkyard out west.
add([[CENTRAL_X, 28], [CENTRAL_X - 70, 22], [CENTRAL_X - 130, 30]], 'hills', 'Lookout Rd');
add([[20, PARK_Z], [22, 360], [30, 240], [60, 180]], 'hills', 'Quarry Rd');
add([[20, MARKET_Z], [24, 1040], [40, 1160], [90, 1240]], 'hills', 'Junkyard Rd');

// Short streets out to the ramp ends at the interchanges.
for (const [k, [p, q]] of STUBS.entries()) add([p, q], 'local', null, { keep: true, stub: k });

// District street grids. Each zone's own grid, clipped to the zone (so its streets meet the
// streets around it in T-junctions) and cut where ramps need the land.
const NAMES = {
  'mid-w': ['Grove St', 'Palm St', 'Union St', 'Elm St', 'Cedar St'],
  'mid-w-v': ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave'],
  proj: ['Kingsway', 'Lowell St', 'Hope St'],
  'proj-v': ['Carver Ave', 'Douglass Ave', 'Tubman Ave'],
  strip: ['Neon St', 'Velvet St', 'Sunset St', 'Jade St'],
  'strip-v': ['Club Row', 'Bourbon Ave', 'Casino Ave'],
  'mid-e': ['Maple St', 'Oak St', 'Pine St', 'Walnut St', 'Spruce St', 'Willow St'],
  'mid-e-v': ['6th Ave', '7th Ave', '8th Ave', '9th Ave', '10th Ave'],
  down: ['Commerce St', 'Main St', 'Court St'],
  'down-v': ['Lincoln Ave', 'Madison Ave', 'Jefferson Ave', 'Adams Ave'],
  gov: ['Capitol St', 'Senate St', 'Liberty St'],
  'gov-v': ['Federal Ave', 'Justice Ave'],
  'down-e': ['Bank St', 'Exchange St', 'Trade St', 'Bond St'],
  'down-e-v': ['Wall Ave', 'Stock Ave', 'Ledger Ave'],
  fin: ['Old Mill St', 'Bay St', 'Water St', 'Front St', 'Harbor St', 'Dock St', 'Slip St', 'Ferry St', 'Pearl St'],
  'docks-in': ['Cargo Way', 'Freight Way'],
  'docks-in-v': ['Crane Ave', 'Rail Ave'],
};
const pickName = (list, k) => (list ? list[k % list.length] : null);
const edgeDist = (x, z, poly) => Math.min(...poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return closestOnSeg(x, z, p[0], p[1], q[0], q[1]).d;
}));

for (const zn of ZONES) {
  if (zn.kind === 'park') continue;
  const bb = bbox(zn.poly);
  const [cx, cz] = centroid(zn.poly);
  if (zn.kind === 'old') {
    // The old core: a grid with its corners nudged around, so the blocks come out irregular
    // (streets bend, some stop short in a T).
    const nu = Math.round((bb.maxX - bb.minX) / zn.du);
    const nv = Math.round((bb.maxZ - bb.minZ) / zn.dv);
    const P = [];
    for (let i = 0; i <= nu; i++) {
      P.push([]);
      for (let j = 0; j <= nv; j++) {
        const edge = i === 0 || i === nu || j === 0 || j === nv;
        const x = bb.minX + ((bb.maxX - bb.minX) * i) / nu + (edge ? 0 : rr(-12, 12));
        const z = bb.minZ + ((bb.maxZ - bb.minZ) * j) / nv + (edge ? 0 : rr(-10, 10));
        P[i].push([x, z]);
      }
    }
    let k = 0;
    for (let j = 1; j < nv; j++) {
      const row = P.map((col) => col[j]);
      const a = rng() < 0.25 ? 1 : 0;
      const b = rng() < 0.25 ? nu - 1 : nu;
      add(row.slice(a, b + 1), 'local', pickName(NAMES.fin, k++));
    }
    for (let i = 1; i < nu; i++) {
      const a = rng() < 0.3 ? 1 : 0;
      add(P[i].slice(a), 'local', pickName(NAMES.fin, k++));
    }
    continue;
  }
  const ang = zn.angle || 0;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const ext = Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
  const lines = [];
  for (let u = -Math.floor(ext / zn.du) * zn.du; u <= ext; u += zn.du) lines.push({ u, dir: 'v' });
  for (let v = -Math.floor(ext / zn.dv) * zn.dv; v <= ext; v += zn.dv) lines.push({ v, dir: 'u' });
  let ku = 0;
  let kv = 0;
  for (const L of lines) {
    let a;
    let b;
    if (L.dir === 'v') {
      a = [cx + L.u * c + ext * s, cz + L.u * s - ext * c];
      b = [cx + L.u * c - ext * s, cz + L.u * s + ext * c];
    } else {
      a = [cx - ext * c - L.v * s, cz - ext * s + L.v * c];
      b = [cx + ext * c - L.v * s, cz + ext * s + L.v * c];
    }
    const t = clipSegConvex(a[0], a[1], b[0], b[1], zn.poly);
    if (!t) continue;
    const p0 = [a[0] + (b[0] - a[0]) * t[0], a[1] + (b[1] - a[1]) * t[0]];
    const p1 = [a[0] + (b[0] - a[0]) * t[1], a[1] + (b[1] - a[1]) * t[1]];
    if (dist(p0[0], p0[1], p1[0], p1[1]) < 25) continue;
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    if (edgeDist(mid[0], mid[1], zn.poly) < 32) continue;
    const isV = L.dir === 'v';
    const name = pickName(NAMES[isV ? `${zn.id}-v` : zn.id] || NAMES[zn.id], isV ? ku++ : kv++);
    if (zn.kind === 'super' && rng() < 0.5) {
      // Superblocks: some streets end in a cul-de-sac partway.
      const f = rng() < 0.5 ? 0.45 : 0.55;
      const flip = rng() < 0.5;
      const q0 = flip ? p1 : p0;
      const q1 = flip ? p0 : p1;
      add([q0, [q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f]], 'local', name, { culDeSac: true });
      continue;
    }
    add([p0, p1], zn.kind === 'super' ? 'collector' : 'local', name);
  }
}

// ---- Service streets around ramp land (so the blocks next to it close up) ----
// Along each edge of a hole that isn't already on a street: inside the ring, or at the docks.
{
  const keepSegs = [];
  for (const st of streets) {
    if (!st.keep) continue;
    for (let k = 0; k + 1 < st.pts.length; k++) keepSegs.push([...st.pts[k], ...st.pts[k + 1]]);
  }
  // (a main road already along that side closes it: no service road squeezed in beside it)
  const nearKeep = (x, z) => keepSegs.some(([ax, az, bx, bz]) => closestOnSeg(x, z, ax, az, bx, bz).d < 20);
  for (const H of HOLES) {
    const [hx, hz] = centroid(H.poly);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = H.poly[i];
      const [bx, bz] = H.poly[(i + 1) % 4];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (nearKeep(mx, mz)) continue;
      const city = (insideRing(mx, mz) && ringDist(mx, mz) > 12) || (mz > RZ1 + 12 && mx > 130 && mx < RX1 - 10 && !isWater(mx, mz));
      if (!city) {
        // Out of town: only the road an exit comes down onto, from the exit to the avenue.
        if (H.frontage && i === 2) add(H.frontage.map((p) => p.slice()), 'local', null, { service: true, frontage: true });
        if (!(H.edgeRoad && i === 2)) continue;
      }
      // 2 m out from the edge (so the hole itself doesn't cut it away).
      const L = Math.hypot(mx - hx, mz - hz) || 1;
      const nx = (mx - hx) / L;
      const nz = (mz - hz) / L;
      // (snap the push direction to the edge's normal)
      const ex = bx - ax;
      const ez = bz - az;
      const el = Math.hypot(ex, ez) || 1;
      let px = -ez / el;
      let pz = ex / el;
      if (px * nx + pz * nz < 0) {
        px = -px;
        pz = -pz;
      }
      const o = 2;
      const ux = ex / el;
      const uz = ez / el;
      // Run each end on until it meets a street (up to 16 m).
      const reach = (x, z, dx, dz) => {
        let best = 16;
        for (const st of streets) {
          for (let k = 0; k + 1 < st.pts.length; k++) {
            const X = segInter(x, z, x + dx * 16, z + dz * 16, ...st.pts[k], ...st.pts[k + 1]);
            if (X && X.t * 16 < best) best = X.t * 16;
          }
        }
        return best < 16 ? best : 2;
      };
      const A = [ax + px * o, az + pz * o];
      const B = [bx + px * o, bz + pz * o];
      const ra = reach(A[0], A[1], -ux, -uz);
      const rb = reach(B[0], B[1], ux, uz);
      add([[A[0] - ux * ra, A[1] - uz * ra], [B[0] + ux * rb, B[1] + uz * rb]], 'local', null, { service: true, frontage: !!(H.frontage && i === 2) });
    }
  }
}

// ---- Cut streets where ramps need the land ----
function cutByHoles(st) {
  if (st.keep) return [st];
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 2) {
      let len = 0;
      for (let i = 1; i < cur.length; i++) len += dist(cur[i - 1][0], cur[i - 1][1], cur[i][0], cur[i][1]);
      if (len > 30) out.push({ ...st, pts: cur });
    }
    cur = [];
  };
  for (let k = 0; k + 1 < st.pts.length; k++) {
    const [ax, az] = st.pts[k];
    const [bx, bz] = st.pts[k + 1];
    const n = Math.max(1, Math.ceil(dist(ax, az, bx, bz) / 2));
    for (let i = k > 0 ? 1 : 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      if (inHole(x, z, 1)) {
        flush();
        continue;
      }
      // Keep only the points that matter: segment ends, and the last point before a hole.
      const nx = ax + ((bx - ax) * (i + 1)) / n;
      const nz = az + ((bz - az) * (i + 1)) / n;
      if (i === 0 || i === n || !cur.length || inHole(nx, nz, 1)) cur.push([x, z]);
    }
  }
  flush();
  return out;
}
{
  const cut = streets.flatMap(cutByHoles);
  streets.length = 0;
  streets.push(...cut);
}

// ---- The road graph: intersections and the street pieces between them ----
// Every street is cut wherever it meets another; nodes closer than SNAP are merged.
const SNAP = 3.5;
function buildGraph() {
  const segs = [];
  for (const [si, st] of streets.entries()) {
    for (let k = 0; k + 1 < st.pts.length; k++) {
      const [ax, az] = st.pts[k];
      const [bx, bz] = st.pts[k + 1];
      if (dist(ax, az, bx, bz) < 0.5) continue;
      segs.push({ si, k, ax, az, bx, bz, cuts: [0, 1] });
    }
  }
  const CELL = 60;
  const hash = new Map();
  segs.forEach((g, idx) => {
    const i0 = Math.floor((Math.min(g.ax, g.bx) - SNAP) / CELL);
    const i1 = Math.floor((Math.max(g.ax, g.bx) + SNAP) / CELL);
    const j0 = Math.floor((Math.min(g.az, g.bz) - SNAP) / CELL);
    const j1 = Math.floor((Math.max(g.az, g.bz) + SNAP) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i},${j}`;
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push(idx);
    }
  });
  const seen = new Set();
  for (const list of hash.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        const key = i < j ? i * 100000 + j : j * 100000 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = segs[i];
        const h = segs[j];
        if (g.si === h.si) continue;
        const X = segInter(g.ax, g.az, g.bx, g.bz, h.ax, h.az, h.bx, h.bz);
        if (X) {
          g.cuts.push(X.t);
          h.cuts.push(X.u);
          continue;
        }
        // An end that stops just short of another street: a T.
        for (const [P, Q, end] of [[g, h, 0], [g, h, 1], [h, g, 0], [h, g, 1]]) {
          // (a ring road's own points are never pulled onto another street - that tears the ring)
          if (streets[P.si].roundabout) continue;
          const px = end ? P.bx : P.ax;
          const pz = end ? P.bz : P.az;
          const c = closestOnSeg(px, pz, Q.ax, Q.az, Q.bx, Q.bz);
          // (an end anywhere on the other street's pavement joins it)
          const reachQ = Math.max(SNAP, ROAD_CLASS[streets[Q.si].cls].w / 2);
          if (c.d < reachQ && c.t > 0.001 && c.t < 0.999) {
            Q.cuts.push(c.t);
            if (c.d >= SNAP) {
              // Bring the end onto the street's middle, so the two meet in one junction.
              if (end) {
                P.bx = c.x;
                P.bz = c.z;
              } else {
                P.ax = c.x;
                P.az = c.z;
              }
              // (and the street itself, so it's drawn - and its lines painted - where it's driven)
              const sp = streets[P.si].pts;
              if (end && P.k + 2 === sp.length) sp[sp.length - 1] = [c.x, c.z];
              if (!end && P.k === 0) sp[0] = [c.x, c.z];
            }
          }
        }
      }
    }
  }
  const nodes = [];
  const nhash = new Map();
  const nodeAt = (x, z) => {
    const i = Math.round(x / SNAP);
    const j = Math.round(z / SNAP);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      for (const n of nhash.get(`${a},${b}`) || []) if (dist(n.x, n.z, x, z) < SNAP) return n;
    }
    const n = { id: nodes.length, x, z, nb: [], edges: [] };
    nodes.push(n);
    const k = `${i},${j}`;
    if (!nhash.has(k)) nhash.set(k, []);
    nhash.get(k).push(n);
    return n;
  };
  const edges = [];
  for (const g of segs) {
    const st = streets[g.si];
    const ts = [...new Set(g.cuts.map((t) => Math.round(t * 1e5) / 1e5))].sort((p, q) => p - q);
    let prev = nodeAt(g.ax + (g.bx - g.ax) * ts[0], g.az + (g.bz - g.az) * ts[0]);
    for (let k = 1; k < ts.length; k++) {
      const n = nodeAt(g.ax + (g.bx - g.ax) * ts[k], g.az + (g.bz - g.az) * ts[k]);
      if (n === prev) continue;
      if (prev.edges.some((e) => e.other(prev) === n)) {
        prev = n;
        continue;
      }
      const e = { id: edges.length, a: prev, b: n, cls: st.cls, name: st.name, street: st, culDeSac: !!st.culDeSac };
      e.other = (m) => (m === e.a ? e.b : e.a);
      e.w = ROAD_CLASS[st.cls].w;
      e.lane = ROAD_CLASS[st.cls].lane;
      e.rank = ROAD_CLASS[st.cls].rank;
      edges.push(e);
      prev.edges.push(e);
      n.edges.push(e);
      prev = n;
    }
  }
  for (const e of edges) {
    // (a roundabout is one way: the way that keeps its island on the driver's left)
    let fwd = true;
    let back = true;
    const R = e.street.roundabout;
    if (R) {
      const fx = e.b.x - e.a.x;
      const fz = e.b.z - e.a.z;
      const left = fz * (R.x - (e.a.x + e.b.x) / 2) - fx * (R.z - (e.a.z + e.b.z) / 2) > 0;
      fwd = left;
      back = !left;
    }
    if (fwd && !e.a.nb.includes(e.b)) e.a.nb.push(e.b);
    if (back && !e.b.nb.includes(e.a)) e.b.nb.push(e.a);
  }
  // Each node: the edge toward each neighbor.
  for (const n of nodes) n.edgeTo = new Map(n.edges.map((e) => [e.other(n), e]));
  return { nodes, edges };
}

// ---- Blocks: the land between streets ----
function buildBlocks(graph) {
  const { nodes, edges } = graph;
  // Faces of the planar graph, ignoring dead ends.
  const deg = new Map(nodes.map((n) => [n, n.edges.length]));
  const alive = new Set(edges);
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const e of alive) {
      if (deg.get(e.a) <= 1 || deg.get(e.b) <= 1) {
        alive.delete(e);
        deg.set(e.a, deg.get(e.a) - 1);
        deg.set(e.b, deg.get(e.b) - 1);
        pruned = true;
      }
    }
  }
  const out = new Map();
  for (const n of nodes) {
    const list = n.edges.filter((e) => alive.has(e)).map((e) => {
      const m = e.other(n);
      return { e, to: m, ang: Math.atan2(m.z - n.z, m.x - n.x) };
    });
    list.sort((p, q) => p.ang - q.ang);
    out.set(n, list);
  }
  const used = new Set();
  const faces = [];
  for (const e of alive) {
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]]) {
      if (used.has(`${from.id}>${to.id}`)) continue;
      const poly = [];
      const fedges = [];
      let u = from;
      let v = to;
      let ce = e;
      let guard = 0;
      while (guard++ < 3000) {
        const key = `${u.id}>${v.id}`;
        if (used.has(key)) break;
        used.add(key);
        poly.push([u.x, u.z]);
        fedges.push(ce);
        const list = out.get(v);
        const back = Math.atan2(u.z - v.z, u.x - v.x);
        let best = null;
        let bestD = Infinity;
        for (const o of list) {
          let d = back - o.ang;
          while (d <= 1e-9) d += Math.PI * 2;
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
        if (!best) break;
        u = v;
        v = best.to;
        ce = best.e;
      }
      if (poly.length >= 3) faces.push({ poly, edges: fedges });
    }
  }
  const blocks = [];
  for (const f of faces) {
    const A = area(f.poly);
    if (A <= 200 || A > 300000) continue;
    const b = makeBlock(f, blocks.length);
    if (b) blocks.push(b);
  }
  return blocks;
}

// A block: the face shrunk to the curbs (half each street's width).
function makeBlock(f, id) {
  let poly = simplify(f.poly, 0.4);
  const wedge = roundaboutWedge(poly);
  if (wedge) poly = wedge.poly;
  const armEdges = wedge ? f.edges.filter((e) => !e.street?.roundabout) : f.edges;
  const isApex = (p) => wedge && wedge.apexes.some((a) => a[0] === p[0] && a[1] === p[1]);
  const half = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    let mx = (p[0] + q[0]) / 2;
    let mz = (p[1] + q[1]) / 2;
    // (a side running in to the wedge's point: the road along it is the one closest all
    // along its length outside the ring - not whichever road is nearest one spot of it)
    if (isApex(p) || isApex(q)) {
      const ap = isApex(p) ? p : q;
      const R = wedge.hits.find((h) => h.apexes.some((a) => a[0] === ap[0] && a[1] === ap[1])).R;
      const samples = [];
      for (let k = 1; k < 10; k++) {
        const x = p[0] + ((q[0] - p[0]) * k) / 10;
        const z = p[1] + ((q[1] - p[1]) * k) / 10;
        if (Math.hypot(x - R.x, z - R.z) > R.r + 2) samples.push([x, z]);
      }
      if (samples.length) {
        let bestE = null;
        let bestD = Infinity;
        for (const e of armEdges) {
          let sum = 0;
          for (const [x, z] of samples) sum += closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z).d;
          if (sum < bestD) {
            bestD = sum;
            bestE = e;
          }
        }
        if (bestE) return bestE.w / 2;
      }
    }
    let best = 7;
    let bd = Infinity;
    for (const e of armEdges) {
      const c = closestOnSeg(mx, mz, e.a.x, e.a.z, e.b.x, e.b.z);
      if (c.d < bd) {
        bd = c.d;
        best = e.w / 2;
      }
    }
    return best;
  });
  let curb = isConvex(poly) ? insetConvex(poly, half) : [];
  // (a roundabout's corner block: its point is a narrow wedge, cut off by the ring after -
  // let the corner go as far in as it must)
  if (!curb.length) curb = insetLoose(poly, half, wedge ? 30 : 3);
  if (!curb.length) return null;
  if (wedge) for (const h of wedge.hits) curb = clipDisc(curb, h.R, h.R.r + ROAD_CLASS.roundabout.w / 2);
  const [cx, cz] = centroid(curb);
  if (isWater(cx, cz)) return null;
  const zone = insideRing(cx, cz) ? ZONES.find((zn) => pointInPoly(cx, cz, zn.poly)) : null;
  const district = districtAt(cx, cz);
  const bb = bbox(curb);
  const A = Math.abs(area(curb));
  // How much of it is ramp land.
  let inH = 0;
  let tot = 0;
  for (let x = bb.minX + 4; x < bb.maxX; x += 8) {
    for (let z = bb.minZ + 4; z < bb.maxZ; z += 8) {
      if (!pointInPoly(x, z, curb)) continue;
      tot++;
      if (inHole(x, z)) inH++;
    }
  }
  const rampShare = tot ? inH / tot : 0;
  let type = 'normal';
  if (rampShare > 0.5) type = 'ramps'; // (ramp land first, even in a park district)
  else if (zone && zone.kind === 'park') type = 'park';
  else if (A < 900) type = 'plaza';
  const names = f.edges.map((e) => e.name).filter(Boolean);
  return {
    id, key: `b${id}`, face: poly, ring: f.poly, poly: curb, cx, cz, ...bb, district,
    zone: zone ? zone.id : (district === 'The Heights' ? 'heights' : district === 'The Docks' ? 'docks' : 'edge'),
    type, area: A, rampShare,
    edges: f.edges,
    streets: [...new Set(names)],
    convex: isConvex(curb),
  };
}

// A block beside a roundabout. Its outline (road center lines) runs round part of the ring:
// that part is replaced by the roundabout's middle, so the block is the wedge between its two
// roads; then the curbs are worked out as usual, and the wedge's point is cut off by the circle
// just outside the ring road - so the curb runs along each road and round the circle.
function roundaboutWedge(poly) {
  // (a block can border more than one roundabout: every ring's stretch is found on the
  // original outline first, then all are replaced together)
  const n = poly.length;
  const ringOf = poly.map((p) => ROUNDABOUTS.find((R) => Math.abs(Math.hypot(p[0] - R.x, p[1] - R.z) - R.r) < 1.5) || null);
  if (!ringOf.some(Boolean)) return null;
  const hits = [];
  const replace = new Map(); // index of a stretch's first point -> its apex
  for (const R of ROUNDABOUTS) {
    const on = ringOf.map((q) => q === R);
    if (!on.some(Boolean) || on.every(Boolean)) continue;
    // (the point the block's two roads would meet at, carried on into the ring - usually its
    // middle; or where they really cross, if that's inside the ring)
    const apex = (s) => {
      let e = s;
      while (on[(e + 1) % n] && e - s < n) e++;
      const P1 = poly[(s + n - 1) % n];
      const S = poly[s];
      const E = poly[e % n];
      const N1 = poly[(e + 1) % n];
      const X = segInter(P1[0], P1[1], P1[0] + (S[0] - P1[0]) * 50, P1[1] + (S[1] - P1[1]) * 50, N1[0], N1[1], N1[0] + (E[0] - N1[0]) * 50, N1[1] + (E[1] - N1[1]) * 50);
      if (X) {
        const x = P1[0] + (S[0] - P1[0]) * 50 * X.t;
        const z = P1[1] + (S[1] - P1[1]) * 50 * X.t;
        if (Math.hypot(x - R.x, z - R.z) < R.r) return [[x, z]];
      }
      // (the two roads don't meet inside the ring - one runs off to another roundabout: keep
      // where each meets the ring; the ring's own disc is trimmed off the block after)
      return S === E ? [S] : [S, E];
    };
    const apexes = [];
    for (let i = 0; i < n; i++) {
      if (on[i] && !on[(i + n - 1) % n]) {
        const a = apex(i);
        if (a.length === 1) apexes.push(a[0]);
        replace.set(i, a);
      }
    }
    hits.push({ R, apexes });
  }
  if (!hits.length) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (replace.has(i)) out.push(...replace.get(i));
    else if (!ringOf[i] || !hits.some((h) => h.R === ringOf[i])) out.push(poly[i]);
  }
  return { poly: out, hits, apexes: hits.flatMap((h) => h.apexes) };
}
function clipDisc(poly, R, rad) {
  const inside = (p) => Math.hypot(p[0] - R.x, p[1] - R.z) < rad;
  const cross = (p, q) => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const fx = p[0] - R.x;
    const fz = p[1] - R.z;
    const A = dx * dx + dz * dz;
    const B = 2 * (fx * dx + fz * dz);
    const C = fx * fx + fz * fz - rad * rad;
    const D = Math.max(0, B * B - 4 * A * C);
    const ts = [(-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A)].filter((t) => t >= 0 && t <= 1);
    return ts.map((t) => [p[0] + dx * t, p[1] + dz * t]);
  };
  const arc = (a, b) => {
    const a0 = Math.atan2(a[1] - R.z, a[0] - R.x);
    let da = Math.atan2(b[1] - R.z, b[0] - R.x) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const n = Math.max(1, Math.ceil(Math.abs(da) / 0.1));
    const pts = [];
    for (let k = 1; k < n; k++) pts.push([R.x + Math.cos(a0 + (da * k) / n) * rad, R.z + Math.sin(a0 + (da * k) / n) * rad]);
    return pts;
  };
  const out = [];
  const marks = new Set(); // (where a road's curb meets the circle: rounded off below)
  let entry = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (!inside(p)) out.push(p);
    const X = cross(p, q);
    for (const x of X) {
      if (entry === null && !inside(p)) {
        entry = x;
        marks.add(out.length);
        out.push(x);
      } else if (entry !== null) {
        out.push(...arc(entry, x));
        marks.add(out.length);
        out.push(x);
        entry = null;
      } else {
        marks.add(out.length);
        out.push(x);
      }
    }
  }
  return out.length >= 3 ? roundCorners(out, marks, 9) : poly;
}
// Round off the given corners of a polygon: the corner is replaced by a curve from `rad`
// meters before it to `rad` meters after it, along the outline (so traffic swings round a
// curb there, not a sharp point).
function roundCorners(poly, marks, rad) {
  const n = poly.length;
  const skip = new Set();
  const curves = new Map();
  const walk = (i, dir) => {
    let left = rad;
    let j = i;
    for (let guard = 0; guard < n; guard++) {
      const k = (j + dir + n) % n;
      const L = Math.hypot(poly[k][0] - poly[j][0], poly[k][1] - poly[j][1]);
      if (L >= left) {
        const t = left / (L || 1);
        return { pt: [poly[j][0] + (poly[k][0] - poly[j][0]) * t, poly[j][1] + (poly[k][1] - poly[j][1]) * t], j };
      }
      left -= L;
      j = k;
      if (k !== i) skip.add(k);
    }
    return { pt: poly[i], j: i };
  };
  for (const i of marks) {
    const P = walk(i, -1).pt;
    const Q = walk(i, 1).pt;
    const V = poly[i];
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const m = 1 - t;
      pts.push([m * m * P[0] + 2 * m * t * V[0] + t * t * Q[0], m * m * P[1] + 2 * m * t * V[1] + t * t * Q[1]]);
    }
    curves.set(i, pts);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (curves.has(i)) out.push(...curves.get(i));
    else if (!skip.has(i)) out.push(poly[i]);
  }
  return out;
}

// Inset for odd shapes: move each corner in along its bisector.
function insetLoose(poly, half, capK = 3) {
  // Each side moved in by its own street's half width (so it lands right on that street's
  // curb), and each corner where two moved sides meet (a miter, capped where the sides are
  // nearly parallel).
  const n = poly.length;
  const ccw = area(poly) > 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n];
    const q = poly[i];
    const r = poly[(i + 1) % n];
    const n1 = norm(q[0] - p[0], q[1] - p[1], ccw);
    const n2 = norm(r[0] - q[0], r[1] - q[1], ccw);
    const d1 = half[(i + n - 1) % n];
    const d2 = half[i];
    // Side 1: through p + n1 d1 along (q - p); side 2: through q + n2 d2 along (r - q).
    const ax = p[0] + n1[0] * d1;
    const az = p[1] + n1[1] * d1;
    const ux = q[0] - p[0];
    const uz = q[1] - p[1];
    const bx = q[0] + n2[0] * d2;
    const bz = q[1] + n2[1] * d2;
    const vx = r[0] - q[0];
    const vz = r[1] - q[1];
    const den = ux * vz - uz * vx;
    let pt = null;
    if (Math.abs(den) > 1e-6 * Math.hypot(ux, uz) * Math.hypot(vx, vz)) {
      const t = ((bx - ax) * vz - (bz - az) * vx) / den;
      pt = [ax + ux * t, az + uz * t];
      // (a very sharp corner would throw the point far out: cap it)
      const lim = capK * Math.max(d1, d2);
      if (Math.hypot(pt[0] - q[0], pt[1] - q[1]) > lim) pt = null;
    }
    if (!pt) {
      const d = (d1 + d2) / 2;
      let mx = n1[0] + n2[0];
      let mz = n1[1] + n2[1];
      const ml = Math.hypot(mx, mz) || 1;
      pt = [q[0] + (mx / ml) * d, q[1] + (mz / ml) * d];
    }
    out.push(pt);
  }
  return Math.abs(area(out)) > 50 && area(out) * area(poly) > 0 ? out : [];
}
const norm = (dx, dz, ccw) => {
  const L = Math.hypot(dx, dz) || 1;
  return ccw ? [-dz / L, dx / L] : [dz / L, -dx / L];
};

// Distance from a segment to a polygon (0 if it runs into it).
function segPolyDist(ax, az, bx, bz, poly) {
  if (pointInPoly(ax, az, poly) || pointInPoly(bx, bz, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [px, pz] = poly[i];
    const [qx, qz] = poly[(i + 1) % poly.length];
    const cross = (ox, oz, ux, uz, vx, vz) => (ux - ox) * (vz - oz) - (uz - oz) * (vx - ox);
    const d1 = cross(ax, az, bx, bz, px, pz);
    const d2 = cross(ax, az, bx, bz, qx, qz);
    const d3 = cross(px, pz, qx, qz, ax, az);
    const d4 = cross(px, pz, qx, qz, bx, bz);
    if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
    d = Math.min(d, closestOnSeg(px, pz, ax, az, bx, bz).d, closestOnSeg(qx, qz, ax, az, bx, bz).d, closestOnSeg(ax, az, px, pz, qx, qz).d, closestOnSeg(bx, bz, px, pz, qx, qz).d);
  }
  return d;
}

// ---- Lots along the hill roads (no blocks form up there: houses face the road) ----
// Rectangles each side of the road, set back a little, wherever they fit; plus a big lot at
// the end of each ridge road (the quarry, the junkyard, the lookout).
function addLots(graph, blocks) {
  const edgesNear = (x, z, r) => graph.edges.filter((e) => closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z).d < r + e.w / 2);
  const fits = (poly, own, st) => {
    const [cx, cz] = centroid(poly);
    for (const p of [...poly, [cx, cz]]) {
      if (isWater(p[0], p[1]) || shoreDist(p[0], p[1]) < 6 || inHole(p[0], p[1], 4)) return false;
      if (p[0] < 6 || p[0] > 1594 || p[1] < 6 || p[1] > 1594) return false;
      if (ringDist(p[0], p[1]) < RING_HALF + 30 || insideRing(p[0], p[1])) return false;
      for (const e of edgesNear(p[0], p[1], 2)) if (!own(e)) return false;
    }
    // (and no other road through it anywhere - not only at its corners and middle)
    const [x0, x1] = [Math.min(...poly.map((q) => q[0])), Math.max(...poly.map((q) => q[0]))];
    const [z0, z1] = [Math.min(...poly.map((q) => q[1])), Math.max(...poly.map((q) => q[1]))];
    for (const e of graph.edges) {
      // (its own road can run along its front edge, but not into it; any other road keeps clear)
      const pad = e.w / 2 + (e.street === st ? 0.3 : 2);
      if (Math.max(e.a.x, e.b.x) < x0 - pad || Math.min(e.a.x, e.b.x) > x1 + pad || Math.max(e.a.z, e.b.z) < z0 - pad || Math.min(e.a.z, e.b.z) > z1 + pad) continue;
      if (segPolyDist(e.a.x, e.a.z, e.b.x, e.b.z, poly) < pad) return false;
    }
    for (const b of blocks) {
      if (b.maxX < Math.min(...poly.map((q) => q[0])) || b.minX > Math.max(...poly.map((q) => q[0]))) continue;
      if (b.maxZ < Math.min(...poly.map((q) => q[1])) || b.minZ > Math.max(...poly.map((q) => q[1]))) continue;
      if (poly.some((q) => pointInPoly(q[0], q[1], b.poly)) || b.poly.some((q) => pointInPoly(q[0], q[1], poly)) || pointInPoly(cx, cz, b.poly)) return false;
    }
    return true;
  };
  const lot = (poly, info) => {
    const [cx, cz] = centroid(poly);
    const bb = bbox(poly);
    const id = blocks.length;
    const district = districtAt(cx, cz);
    blocks.push({
      id, key: `b${id}`, face: poly, poly, cx, cz, ...bb, district, zone: district === 'The Heights' ? 'heights' : 'ridge',
      type: 'normal', area: Math.abs(area(poly)), rampShare: 0, edges: [], streets: [info.street].filter(Boolean),
      convex: true, lot: true, ...info,
    });
  };
  for (const st of streets) {
    if (st.cls !== 'hills' || /Quarry|Junkyard|Lookout/.test(st.name || '')) continue;
    const pts = st.pts;
    const Ls = [0];
    for (let i = 1; i < pts.length; i++) Ls.push(Ls[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    const L = Ls[Ls.length - 1];
    const at = (t) => {
      let i = 1;
      while (i < pts.length - 1 && Ls[i] < t) i++;
      const f = (t - Ls[i - 1]) / (Ls[i] - Ls[i - 1] || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    };
    const w = ROAD_CLASS.hills.w;
    const n = Math.floor((L - 16) / 30);
    // Each side: lots 26 m deep, set back 2.5 m from the road edge, about 30 m wide.
    for (let k = 0; k < n; k++) {
      const t0 = 8 + (k * (L - 16)) / n + 1.5;
      const t1 = 8 + ((k + 1) * (L - 16)) / n - 1.5;
      const A = at(t0);
      const B = at(t1);
      const cl = dist(A[0], A[1], B[0], B[1]) || 1;
      const ux = (B[0] - A[0]) / cl;
      const uz = (B[1] - A[1]) / cl;
      // (on a curve the chord sits inside the bend: push the lot out by the sag)
      const M = at((t0 + t1) / 2);
      for (const side of [-1, 1]) {
        const nx = -uz * side;
        const nz = ux * side;
        const sag = (M[0] - (A[0] + B[0]) / 2) * nx + (M[1] - (A[1] + B[1]) / 2) * nz;
        const o0 = w / 2 + 2.5 + Math.max(0, sag);
        const o1 = o0 + 26;
        const P = (p, o) => [p[0] + nx * o, p[1] + nz * o];
        let poly = [P(A, o0), P(B, o0), P(B, o1), P(A, o1)];
        if (area(poly) < 0) poly = poly.reverse();
        const own = (e) => e.street === st || e.cls === 'hills';
        if (fits(poly, own, st)) lot(poly, { street: st.name, front: [P(M, w / 2 + Math.max(0, sag)), Math.atan2(-nz, -nx)] });
      }
    }
  }
  // The ends of the ridge roads.
  for (const [name, x, z, kind] of [['Quarry Rd', 60, 180, 'quarry'], ['Junkyard Rd', 90, 1240, 'junkyard'], ['Lookout Rd', CENTRAL_X - 130, 30, 'lookout']]) {
    const s = kind === 'lookout' ? 26 : 38;
    let dx = 0;
    let dz = 0;
    if (kind === 'quarry') dz = -s - 6;
    if (kind === 'junkyard') dx = s + 6;
    if (kind === 'lookout') dx = -s - 6;
    // (as big as fits without another road running through it: smaller if need be)
    const own = streets.find((st) => st.name === name);
    let best = null;
    for (const k of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      const h = s * k;
      const cx = x + (dx / s) * (h + 6);
      const cz = z + (dz / s) * (h + 6);
      const poly = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
      if (graph.edges.every((e) => e.street === own || segPolyDist(e.a.x, e.a.z, e.b.x, e.b.z, poly) >= e.w / 2 + 2)) {
        best = poly;
        break;
      }
    }
    if (best) lot(best, { street: name, special: kind, front: [[x, z], 0], type: 'place' });
  }
}

// ---- Tidy up where the district grids meet the main roads ----
// Each district lays out its own grid, so where two meet (or a grid meets an arterial) you can
// get a street running right alongside another, its pavement overlapping, or two streets
// meeting a main road a few meters apart (a jog, with stop signs out in the road). So:
// - a street that mostly runs alongside a bigger (or earlier) one is dropped;
// - a street that ends on another a few meters from an existing junction is moved onto it,
//   so the two make one crossing.
function tidyStreets() {
  const prio = (st) => (st.keep ? 10 : st.stub !== undefined ? 9 : ROAD_CLASS[st.cls].rank - (st.service ? 0.5 : 0));
  const segsOf = (st) => st.pts.slice(1).map((q, k) => [...st.pts[k], ...q]);
  const fixed = (st) => st.keep || st.stub !== undefined || st.loop || st.cls === 'pier' || st.frontage; // (an exit's road: the exit joins it where it is)
  // 1. Alongside another street.
  const drop = new Set();
  streets.forEach((S, si) => {
    if (fixed(S)) return;
    const wS = ROAD_CLASS[S.cls].w;
    let total = 0;
    let along = 0;
    for (const [ax, az, bx, bz] of segsOf(S)) {
      const L = dist(ax, az, bx, bz);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      for (let d = 2; d < L; d += 4) {
        total++;
        const x = ax + ux * d;
        const z = az + uz * d;
        const hit = streets.some((T, ti) => {
          if (T === S || drop.has(T) || prio(T) < prio(S) || (prio(T) === prio(S) && ti > si)) return false;
          const lim = (wS + ROAD_CLASS[T.cls].w) / 2 + 4;
          return segsOf(T).some(([cx, cz, ex, ez]) => {
            const l2 = dist(cx, cz, ex, ez) || 1;
            if (Math.abs(((ex - cx) / l2) * ux + ((ez - cz) / l2) * uz) < 0.94) return false; // (not parallel)
            return closestOnSeg(x, z, cx, cz, ex, ez).d < lim;
          });
        });
        if (hit) along++;
      }
    }
    if (total && along / total > 0.5) drop.add(S);
  });
  for (let i = streets.length - 1; i >= 0; i--) if (drop.has(streets[i])) streets.splice(i, 1);
  // 2. Ends just off an existing junction: move them onto it.
  const TOL = 4;
  const SHIFT = 14;
  for (const S of streets) {
    if (fixed(S) || S.pts.length < 2) continue;
    for (const end of [0, S.pts.length - 1]) {
      const [x, z] = S.pts[end];
      // The street this end meets.
      let host = null;
      for (const H of streets) {
        if (H === S) continue;
        if (segsOf(H).some(([ax, az, bx, bz]) => closestOnSeg(x, z, ax, az, bx, bz).d < TOL)) {
          host = H;
          break;
        }
      }
      if (!host) continue;
      // Junctions along it: other streets crossing it or ending on it (not the ramp stubs).
      let best = null;
      let bd = SHIFT;
      const consider = (px, pz) => {
        const d = dist(x, z, px, pz);
        if (d > 0.5 && d < bd) {
          bd = d;
          best = [px, pz];
        }
      };
      for (const X of streets) {
        if (X === S || X === host || (X.stub !== undefined && !S.service)) continue; // (service roads may join a ramp junction)
        for (const [ax, az, bx, bz] of segsOf(host)) {
          for (const [cx, cz, ex, ez] of segsOf(X)) {
            const I = segInter(ax, az, bx, bz, cx, cz, ex, ez);
            if (I) consider(ax + (bx - ax) * I.t, az + (bz - az) * I.t);
          }
          for (const q of [X.pts[0], X.pts[X.pts.length - 1]]) {
            const c = closestOnSeg(q[0], q[1], ax, az, bx, bz);
            if (c.d < TOL) consider(c.x, c.z);
          }
        }
      }
      if (best) S.pts[end] = best;
    }
  }
}
tidyStreets();

// ---- Roundabouts ----
// A big many-way junction made a roundabout: the streets stop at a one-way ring road (right-
// hand traffic goes round with the island on its left), entering traffic gives way, and the
// island in the middle has a statue.
// feeds: a street brought round to come onto the ring by itself (it ran right along the
// ring's edge, crossing the roads coming onto it): kept from its far end, then curved in to
// the ring at the angle given (degrees; 0 = east, -90 = north).
export const ROUNDABOUTS = [{ x: CENTRAL_X, z: MIDWAY_Z, r: 52, name: 'Liberty Circle', feeds: [{ name: 'Exchange St', angle: -32, from: 100 }] }, // (big enough to take in the five-way junction that was just off it)
  // Down Grand Ave, where it crosses an avenue and a street a few meters apart (two junctions
  // on top of each other): one roundabout each instead.
  // Bank St, where Grand Ave and Wall Ave cross it 28 m apart: one roundabout for both.
  { x: 978, z: 560, r: 26, name: 'Bank Circle' }, // (south of Park Ave by ~40 m, so a queue at its lights stays off the ring)
  { x: 777, z: 788, r: 30, name: 'Union Circle' },
  { x: 695, z: 853, r: 26, name: 'Founders Circle' },
];
function makeRoundabouts() {
  for (const R of ROUNDABOUTS) {
    for (const F of R.feeds || []) {
      const st = streets.find((q) => q.name === F.name && q.pts.some((p) => Math.hypot(p[0] - R.x, p[1] - R.z) < R.r + 60));
      if (!st) continue;
      // from its far end in to `from` meters off the ring's middle, then a smooth curve on
      const far = Math.hypot(st.pts[0][0] - R.x, st.pts[0][1] - R.z) > Math.hypot(st.pts.at(-1)[0] - R.x, st.pts.at(-1)[1] - R.z);
      const pts = far ? [...st.pts] : [...st.pts].reverse();
      const keep = [pts[0]];
      let A = null;
      let dir = null;
      for (let i = 1; i < pts.length && !A; i++) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        for (let t = 0; t <= L; t += 1) {
          const x = ax + ((bx - ax) * t) / L;
          const z = az + ((bz - az) * t) / L;
          if (Math.hypot(x - R.x, z - R.z) <= F.from) {
            A = [x, z];
            dir = [(bx - ax) / L, (bz - az) / L];
            break;
          }
        }
        if (!A) keep.push(pts[i]);
      }
      if (!A) continue;
      const ang = (F.angle * Math.PI) / 180;
      const P = [R.x + Math.cos(ang) * (R.r + 1), R.z + Math.sin(ang) * (R.r + 1)];
      const k = Math.hypot(P[0] - A[0], P[1] - A[1]) * 0.6;
      const Cp = [A[0] + dir[0] * k, A[1] + dir[1] * k];
      const curve = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const m = 1 - t;
        curve.push([m * m * A[0] + 2 * m * t * Cp[0] + t * t * P[0], m * m * A[1] + 2 * m * t * Cp[1] + t * t * P[1]]);
      }
      // (on in a little way past the ring's edge, so the cut below ends it right on the ring)
      const inward = [R.x + Math.cos(ang) * (R.r - 3), R.z + Math.sin(ang) * (R.r - 3)];
      st.pts = [...keep, ...curve, inward];
    }
    const inside = ([x, z]) => Math.hypot(x - R.x, z - R.z) < R.r;
    // Where a segment crosses the circle (parameter t along it), in order.
    const hits = (p, q) => {
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const fx = p[0] - R.x;
      const fz = p[1] - R.z;
      const A = dx * dx + dz * dz;
      const B = 2 * (fx * dx + fz * dz);
      const Cc = fx * fx + fz * fz - R.r * R.r;
      const D = B * B - 4 * A * Cc;
      if (D <= 0 || A < 1e-9) return [];
      const sq = Math.sqrt(D);
      return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t > 0 && t < 1);
    };
    for (let k = streets.length - 1; k >= 0; k--) {
      const st = streets[k];
      if (!st.pts.some(inside) && !st.pts.some((p, i) => i && hits(st.pts[i - 1], p).length)) continue;
      const pieces = [];
      let cur = inside(st.pts[0]) ? null : [st.pts[0]];
      for (let i = 1; i < st.pts.length; i++) {
        const p = st.pts[i - 1];
        const q = st.pts[i];
        for (const t of hits(p, q)) {
          const X = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
          if (cur) {
            cur.push(X);
            pieces.push(cur);
            cur = null;
          } else cur = [X];
        }
        if (cur && !inside(q)) cur.push(q);
      }
      if (cur) pieces.push(cur);
      streets.splice(k, 1, ...pieces.filter((pp) => pp.length >= 2).map((pts) => ({ ...st, pts })));
    }
    // Roads coming onto it close beside a bigger one (they all used to meet at one junction
    // just off the ring): the smaller one stops at its last crossing before the ring instead,
    // so each road has its own way on, well apart.
    const onRing = (p) => Math.abs(Math.hypot(p[0] - R.x, p[1] - R.z) - R.r) < 0.5;
    const ends = [];
    streets.forEach((st) => {
      if (onRing(st.pts[0])) ends.push({ st, at: st.pts[0], first: true });
      if (onRing(st.pts[st.pts.length - 1])) ends.push({ st, at: st.pts[st.pts.length - 1], first: false });
    });
    const rank = (st) => ROAD_CLASS[st.cls].rank * 1e4 + Math.min(9999, st.pts.length);
    for (const e of ends) {
      const bigger = ends.find((o) => o !== e && o.st !== e.st && rank(o.st) > rank(e.st) && Math.hypot(o.at[0] - e.at[0], o.at[1] - e.at[1]) < 25);
      // (or a short stretch off the ring to another junction just beyond it - queues there
      // would back up onto the ring: it stops at that junction instead)
      const firstCross = (() => {
        const pts = e.first ? e.st.pts : [...e.st.pts].reverse();
        let walked = 0;
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1];
          const [bx, bz] = pts[i];
          const L = Math.hypot(bx - ax, bz - az);
          for (const o of streets) {
            if (o === e.st || o.roundabout) continue;
            for (let k = 0; k + 1 < o.pts.length; k++) {
              const X = segInter(ax, az, bx, bz, ...o.pts[k], ...o.pts[k + 1]);
              if (X && walked + X.t * L > 1) return walked + X.t * L;
            }
            for (const q of [o.pts[0], o.pts[o.pts.length - 1]]) {
              const c = closestOnSeg(q[0], q[1], ax, az, bx, bz);
              if (c.d < 2 && walked + c.t * L > 1) return walked + c.t * L;
            }
          }
          walked += L;
        }
        return Infinity;
      })();
      if (!bigger && firstCross > 30) continue;
      // back along it to the first place another street meets it
      const pts = e.first ? e.st.pts : [...e.st.pts].reverse();
      let cut = null;
      let walked = 0;
      for (let i = 1; i < pts.length && !cut; i++) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        for (const o of streets) {
          if (o === e.st) continue;
          for (let k = 0; k + 1 < o.pts.length; k++) {
            const X = segInter(ax, az, bx, bz, ...o.pts[k], ...o.pts[k + 1]);
            if (X && (walked > 0 || X.t > 0.05) && (!cut || X.t < cut.t)) cut = { i, t: X.t };
          }
          for (const q of [o.pts[0], o.pts[o.pts.length - 1]]) {
            const c = closestOnSeg(q[0], q[1], ax, az, bx, bz);
            if (c.d < 2 && (walked > 0 || c.t > 0.05) && (!cut || c.t < cut.t)) cut = { i, t: c.t };
          }
        }
        walked += Math.hypot(bx - ax, bz - az);
      }
      if (!cut) continue;
      const [ax, az] = pts[cut.i - 1];
      const [bx, bz] = pts[cut.i];
      const rest = [[ax + (bx - ax) * cut.t, az + (bz - az) * cut.t], ...pts.slice(cut.i)];
      e.st.pts = e.first ? rest : rest.reverse();
      e.dropped = true;
    }
    // (any piece left with no length to it goes)
    const len = (st) => st.pts.reduce((L, p, i) => (i ? L + Math.hypot(p[0] - st.pts[i - 1][0], p[1] - st.pts[i - 1][1]) : 0), 0);
    for (let k = streets.length - 1; k >= 0; k--) if (streets[k].pts.length < 2 || len(streets[k]) < 1) streets.splice(k, 1);
    // The ring: a point exactly where each road meets it (and none of its own close by, which
    // could merge into the wrong junction and leave a gap in the ring).
    const angs = [];
    for (const st of streets) for (const q of [st.pts[0], st.pts[st.pts.length - 1]]) if (onRing(q)) angs.push((Math.atan2(q[1] - R.z, q[0] - R.x) + Math.PI * 2) % (Math.PI * 2)); // (0 to 2 pi, like the ring's own points)
    const ringPts = [];
    const nArc = Math.ceil((Math.PI * 2 * R.r) / 7);
    for (let k = 0; k < nArc; k++) {
      const a0 = (k / nArc) * Math.PI * 2;
      const near = angs.some((a1) => Math.abs(Math.atan2(Math.sin(a0 - a1), Math.cos(a0 - a1))) * R.r < 4);
      if (!near) ringPts.push(a0);
    }
    ringPts.push(...angs);
    ringPts.sort((p, q) => p - q);
    const loop = ringPts.map((a1) => [R.x + Math.cos(a1) * R.r, R.z + Math.sin(a1) * R.r]);
    add([...loop, loop[0]], 'roundabout', R.name, { keep: true, loop: true, roundabout: R });
  }
}
makeRoundabouts();

// A service road in town that runs on past its last cross street and stops in nothing (it
// didn't reach the next street): the loose end is cut off at that cross street. Left alone it
// would sit under the block's lawn, with its lines and signs showing through the grass.
function trimLooseServiceEnds() {
  const reachOf = (o) => Math.max(SNAP, ROAD_CLASS[o.cls].w / 2);
  const touches = (x, z, self) => streets.some((o) => o !== self && o.pts.some((q, k) => k + 1 < o.pts.length && closestOnSeg(x, z, ...q, ...o.pts[k + 1]).d < reachOf(o)));
  for (const st of streets) {
    if (!st.service || st.pts.length < 2) continue;
    for (const end of [0, 1]) {
      const n = st.pts.length;
      const P = end ? st.pts[n - 1] : st.pts[0];
      const Q = end ? st.pts[n - 2] : st.pts[1];
      if (!insideRing(...P) || touches(...P, st)) continue;
      // The nearest street it crosses (or that meets it), going back from the loose end.
      let best = null;
      for (const o of streets) {
        if (o === st) continue;
        for (let k = 0; k + 1 < o.pts.length; k++) {
          const X = segInter(...P, ...Q, ...o.pts[k], ...o.pts[k + 1]);
          if (X && X.t > 0.01 && (!best || X.t < best.t)) best = X;
        }
        for (const q of [o.pts[0], o.pts[o.pts.length - 1]]) {
          const c = closestOnSeg(...q, ...P, ...Q);
          if (c.d < reachOf(st) && c.t > 0.01 && (!best || c.t < best.t)) best = { t: c.t, x: c.x, z: c.z };
        }
      }
      if (!best || best.t * dist(...P, ...Q) > 70) continue;
      if (end) st.pts[n - 1] = [best.x, best.z];
      else st.pts[0] = [best.x, best.z];
    }
  }
}
trimLooseServiceEnds();

export const STREETS = streets;
export const GRAPH = buildGraph();
export const BLOCKS = buildBlocks(GRAPH).filter((b) => b.area >= 60);
// (a roundabout's island: grass and its statue, nothing built on it)
for (const b of BLOCKS) {
  const R = ROUNDABOUTS.find((q) => Math.hypot(b.cx - q.x, b.cz - q.z) < q.r * 0.5);
  if (R) Object.assign(b, { type: 'park', island: R });
}
BLOCKS.forEach((b, i) => {
  b.id = i;
  b.key = `b${i}`;
});
addLots(GRAPH, BLOCKS);
// Each block's key comes from where it is (not its number in the list), so a change to the
// streets in one part of town doesn't scramble saved turf everywhere else.
{
  const used = new Set();
  for (const b of BLOCKS) {
    let k = `b${Math.round(b.cx)}_${Math.round(b.cz)}`;
    while (used.has(k)) k += 'x';
    used.add(k);
    b.key = k;
  }
}
export { RING_HALF, XT_HALF };
