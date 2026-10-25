// Freeway plan: the elevated ring (3 lanes each way) and the crosstown (2 lanes each way),
// their interchanges and every ramp, as pure geometry (no 3D). highway.js builds the decks,
// rails, pillars, signs and the lane graph from this; worldplan.js keeps streets and buildings
// out of the land the ramps need.
//
// The rule (from the player): you always veer RIGHT onto a ramp, and never cross traffic to
// reach one.
// - Exits leave from the right-hand lane, down a deceleration lane.
// - Entrances merge from the right, along an acceleration lane.
// - Service interchanges are partial cloverleaves ("parclo A4"): from the cross street,
//   every entrance is a right turn. Going toward the freeway's far side, you pass under it and
//   turn right into a loop; on the near side, you turn right onto a diagonal ramp. Exits come
//   down to a T-junction with the cross street (with lights).
// - Where the crosstown meets the ring: a two-loop T. The crosstown's right lane curves off to
//   the near side of the ring; its left lane crosses over the ring on a bridge and loops round
//   onto the far side. Every move exits right and merges from the right.
// - The freeways are 7.5 m up on pillars; a two-way street runs underneath (Ring Rd,
//   Crosstown Rd), so other streets can cross under anywhere.
//
// Local frames: for a carriageway, u runs along its travel direction and v to its right.

export const DECK = 7.5; // freeway surface height
export const LEVEL2 = 14; // bridges over the freeway
export const LANE = 3.5;
export const RAMP_HW = 3.6; // half a ramp's width (one lane plus shoulders)
export const laneV = (k) => 1.5 + LANE * (k + 0.5); // lane k's offset from the median (k = 0: fast lane)
export const edgeV = (lanes) => 1.5 + lanes * LANE + 2.5; // outer edge of a carriageway
export const RING = { x0: 120, z0: 120, x1: 1260, z1: 1260, r: 170, lanes: 3 };
export const XT = { x: 520, z0: RING.z0, z1: RING.z1, lanes: 2, end0: 430, end1: 950 };
export const RING_HALF = edgeV(RING.lanes); // 14.5
export const XT_HALF = edgeV(XT.lanes); // 11

// A rounded rectangle as a closed polyline, clockwise on the map (east along the north side).
export function roundRect(x0, z0, x1, z1, r, step = 4) {
  const pts = [];
  const arc = (cx, cz, a0, a1) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  const line = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (step * 5)));
    for (let k = 1; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  };
  arc(x1 - r, z0 + r, -Math.PI / 2, 0);
  line(x1, z0 + r, x1, z1 - r);
  arc(x1 - r, z1 - r, 0, Math.PI / 2);
  line(x1 - r, z1, x0 + r, z1);
  arc(x0 + r, z1 - r, Math.PI / 2, Math.PI);
  line(x0, z1 - r, x0, z0 + r);
  arc(x0 + r, z0 + r, Math.PI, Math.PI * 1.5);
  line(x0 + r, z0, x1 - r, z0);
  return pts;
}
export const RING_LINE = roundRect(RING.x0, RING.z0, RING.x1, RING.z1, RING.r);

// ---- Small path toolkit (local u/v coordinates) ----
const smoother = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
class Path {
  constructor(u, v) {
    this.p = [[u, v]];
  }
  // Remember where we are (index of the last point).
  mark(name) {
    this[name] = this.p.length - 1;
    return this;
  }
  get end() {
    return this.p[this.p.length - 1];
  }
  line(u, v, step = 3) {
    const [u0, v0] = this.end;
    const n = Math.max(1, Math.ceil(Math.hypot(u - u0, v - v0) / step));
    for (let k = 1; k <= n; k++) this.p.push([u0 + ((u - u0) * k) / n, v0 + ((v - v0) * k) / n]);
    return this;
  }
  // Sideways shift with level ends (heading along +u or -u at both ends).
  shift(u, v, step = 2) {
    const [u0, v0] = this.end;
    const n = Math.max(2, Math.ceil(Math.abs(u - u0) / step));
    for (let k = 1; k <= n; k++) this.p.push([u0 + ((u - u0) * k) / n, v0 + (v - v0) * smoother(k / n)]);
    return this;
  }
  // Same, but sliding along v (heading along +v or -v at both ends).
  shiftV(u, v, step = 2) {
    const [u0, v0] = this.end;
    const n = Math.max(2, Math.ceil(Math.abs(v - v0) / step));
    for (let k = 1; k <= n; k++) this.p.push([u0 + (u - u0) * smoother(k / n), v0 + ((v - v0) * k) / n]);
    return this;
  }
  // Arc around (cu, cv) from angle a0 to a1 (angles: atan2(v - cv, u - cu)).
  arc(cu, cv, r, a0, a1, step = 2.5) {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
    for (let k = 1; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      this.p.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
    }
    return this;
  }
}

// Cumulative length along a polyline.
export function lengths(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return L;
}
// Heights along a path from key stations [[s, h], ...]: straight grades with eased ends.
function profile(L, keys) {
  return L.map((s) => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let k = 1; k < keys.length; k++) {
      const [s0, h0] = keys[k - 1];
      const [s1, h1] = keys[k];
      if (s <= s1) {
        const t = (s - s0) / (s1 - s0 || 1);
        // Linear with 20% eased at each end (vertical curves).
        const e = 0.2;
        let f;
        if (t < e) f = (t * t) / (2 * e * (1 - e));
        else if (t > 1 - e) f = 1 - ((1 - t) * (1 - t)) / (2 * e * (1 - e));
        else f = (t - e / 2) / (1 - e);
        return h0 + (h1 - h0) * f;
      }
    }
    return keys[keys.length - 1][1];
  });
}
// Find the arc length where a path first reaches a local u (or v) value.
const sAtU = (local, L, u, sign = 1) => {
  for (let i = 0; i < local.length; i++) if ((local[i][0] - u) * sign >= 0) return L[i];
  return L[L.length - 1];
};

// A frame on a straight piece of freeway: origin at the cross street's center, t = travel
// direction of the carriageway, v to its right.
function frame(cx, cz, tx, tz) {
  const rx = -tz;
  const rz = tx;
  return (u, v) => [cx + tx * u + rx * v, cz + tz * u + rz * v];
}

export const RAMPS = [];
export const HOLES = []; // land kept clear of streets and buildings: { poly: [[x, z] x4] (rectangles) }
export const SIGNS = []; // { x, z, h, ang, text, kind }
export const XINGS = []; // service interchanges: { x, z, name, ... }
// Short streets joining ramp ends to the cross street: [street end, ramp end] (world points).
export const STUBS = [];
let rid = 0;
function addRamp(W, path, keys, info) {
  const local = path.p;
  const pts = local.map(([u, v]) => W(u, v));
  const L = lengths(pts);
  const h = profile(L, keys(local, L, (m) => L[path[m]]));
  const r = { id: rid++, pts, h, L, hw: RAMP_HW, ...info };
  RAMPS.push(r);
  return r;
}
const rectLocal = (W, u0, u1, v0, v1) => [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];

// ---- Service interchange (parclo A4), one carriageway's half ----
// Ud: where the exit's taper starts, before the cross street.
function parcloHalf(W, lanes, cross, opts) {
  const vL = laneV(lanes - 1); // right-hand lane
  const vA = vL + LANE; // deceleration / acceleration lane
  const Ud = opts.Ud ?? 180;
  const rL = 22; // loop radius
  const vLoop = vA + rL; // loop center's v
  const vOff = vA + 2 * rL + 9; // where the exit meets the cross street
  const vOn = 44; // where the diagonal entrance leaves the cross street
  const S = 8; // half the cross street's width
  const name = opts.name;

  // Exit: taper off the right lane, decelerate, swing right and down to the cross street.
  const off = new Path(-Ud, vL).shift(-Ud + 35, vA).line(-Ud + 40, vA).shift(-38, vOff).line(-S - 8, vOff);
  addRamp(W, off, (lc, L) => [[sAtU(lc, L, -Ud + 38), DECK], [sAtU(lc, L, -40), 0]], {
    kind: 'off', main: opts.main, dir: opts.dir, laneFrom: lanes - 1, street: W(0, vOff), name,
  });
  // Loop entrance: from the cross street lane heading away from the freeway, peel right,
  // loop 270 degrees up to the deck, then the acceleration lane across the bridge.
  const loop = new Path(-S - 1, S + 15).line(-S, vLoop - 4).line(-S, vLoop);
  loop.mark('a').arc(-S - rL, vLoop, rL, 0, Math.PI * 1.5).mark('b');
  loop.line(165, vA).shift(190, vL);
  addRamp(W, loop, (lc, L, at) => [[at('a') - 4, 0], [at('b'), DECK]], {
    kind: 'on', loop: true, main: opts.main, dir: opts.dir, laneTo: lanes - 1, street: W(0, S + 4), name,
  });
  // Diagonal entrance: right turn off the cross street lane heading toward the freeway, up
  // alongside to join the acceleration lane.
  // (it stays out wide while it climbs, and only swings in alongside once it's level with
  // the deck: no running in underneath the edge of it)
  const vWide = vA + RAMP_HW * 2 + 1.2;
  const diag = new Path(S + 8, vOn).shift(100, vWide).line(118, vWide).shift(150, vA).line(165, vA);
  addRamp(W, diag, (lc, L) => [[sAtU(lc, L, S + 9), 0], [sAtU(lc, L, 116), DECK]], {
    kind: 'on', main: opts.main, dir: opts.dir, joinsRamp: true, street: W(0, vOn), name,
  });
  STUBS.push([W(0, vOff), W(-S - 8, vOff)], [W(0, S + 4), W(-S - 1, S + 15)], [W(0, vOn), W(S + 8, vOn)]);
  RAMPS[RAMPS.length - 3].stub = STUBS.length - 3;
  RAMPS[RAMPS.length - 2].stub = STUBS.length - 2;
  RAMPS[RAMPS.length - 1].stub = STUBS.length - 1;
  // Land for the ramps (no streets or buildings).
  HOLES.push({ poly: rectLocal(W, -Ud - 8, -S, S, vOff + 10) });
  HOLES.push({ poly: rectLocal(W, S, 195, S, vOn + 10) });
  // Signs over the right-hand lanes: 200 m before the exit and where it leaves.
  const [ox, oz] = W(0, 0);
  const [tx, tz] = W(1, 0);
  const ang = Math.atan2(tz - oz, tx - ox);
  SIGNS.push({ at: W(-Ud - 150, vL), ang, text: `EXIT ${name}`, sub: '1/8 MILE', kind: 'advance', h: DECK });
  SIGNS.push({ at: W(-Ud + 25, vA), ang, text: `EXIT ${name}`, sub: '↗', kind: 'exit', h: DECK });
  // On the cross street, at the two entrances.
  SIGNS.push({ at: W(-S - 3, S + 2), ang: ang + Math.PI / 2, text: opts.toward, kind: 'entrance', h: 0 });
  SIGNS.push({ at: W(S + 4, vOn + 7), ang: ang - Math.PI / 2, text: opts.toward, kind: 'entrance', h: 0 });
}

// A full service interchange at a cross street on a straight freeway piece.
// (cx, cz): crossing point; (tx, tz): the axis direction (the +side carriageway's travel).
function parclo(cx, cz, tx, tz, lanes, main, name, towardPlus, towardMinus, city, Ud) {
  XINGS.push({ x: cx, z: cz, name, main });
  parcloHalf(frame(cx, cz, tx, tz), lanes, { city: city[0] }, { main, dir: 1, name, toward: towardPlus, Ud });
  parcloHalf(frame(cx, cz, -tx, -tz), lanes, { city: city[1] }, { main, dir: -1, name, toward: towardMinus, Ud });
}

// ---- The two-loop T where the crosstown meets the ring (north end; the south end is the same
// turned 180 degrees about the middle of the crosstown) ----
function crosstownT(rot) {
  // World point from "north end" coordinates (x, z).
  const mx = XT.x;
  const mz = (XT.z0 + XT.z1) / 2;
  const P = rot ? ([x, z]) => [2 * mx - x, 2 * mz - z] : (p) => p;
  const I = (x, z) => [x, z]; // identity frame (local = north-end world coords)
  const ring = RING.z0;
  const rlanes = RING.lanes;
  const inV = (k) => ring + laneV(k); // inner carriageway lanes (heading east here), z
  const outV = (k) => ring - laneV(k); // outer carriageway (heading west), z
  const aIn = ring + laneV(rlanes - 1) + LANE; // inner accel/decel lane z
  const aOut = ring - laneV(rlanes - 1) - LANE;
  const X = XT.x;
  const sbR = X - laneV(1); // crosstown southbound right lane x (west half)
  const nbR = X + laneV(1); // northbound right lane
  const nbL = X + laneV(0);
  const sbL = X - laneV(0);
  const bE = X + RAMP_HW + 0.1; // the bridge: two ramps side by side
  const bW = X - RAMP_HW - 0.1;
  const end = XT.end0; // where the crosstown proper ends
  const R1 = 60; // the right-hand curves
  const rL = 30; // loops
  const zB0 = ring + RING_HALF + 4; // bridge must be up by here (south edge of the ring)
  const zB1 = ring - RING_HALF - 4;
  const add = (path, keys, info) => {
    const pts = path.p;
    const world = pts.map(P);
    const L = lengths(world);
    const r = { id: rid++, pts: world, h: profile(L, keys(pts, L, (m) => L[path[m]])), L, hw: RAMP_HW, ...info };
    RAMPS.push(r);
    return r;
  };
  const sAtZ = (pts, L, z, sign) => {
    for (let i = 0; i < pts.length; i++) if ((pts[i][1] - z) * sign >= 0) return L[i];
    return L[L.length - 1];
  };
  // M1: crosstown northbound, right lane -> ring inner carriageway (east here).
  const xM1 = X + 25;
  const m1 = new Path(nbR, end).line(nbR, end - 10).shiftV(xM1, end - 70).line(xM1, aIn + R1);
  m1.arc(xM1 + R1, aIn + R1, R1, Math.PI, Math.PI * 1.5).line(X + 160, aIn).shift(X + 190, inV(rlanes - 1));
  add(m1, () => [[0, DECK]], { kind: 'link', from: 'xt', to: 'ring', dirTo: 1, lane: 1 });
  // M3: ring inner (east here) -> crosstown southbound right lane.
  const xM3 = X - 25;
  const m3 = new Path(X - 230, inV(rlanes - 1)).shift(X - 200, aIn).line(xM3 - R1, aIn);
  m3.arc(xM3 - R1, aIn + R1, R1, -Math.PI / 2, 0).line(xM3, end - 70).shiftV(sbR, end - 10).line(sbR, end);
  add(m3, () => [[0, DECK]], { kind: 'link', from: 'ring', to: 'xt', dirFrom: 1, lane: 1 });
  // M2: crosstown northbound, left lane -> over the ring -> loop right -> ring outer (west here).
  const m2 = new Path(nbL, end).line(nbL, end - 20).shiftV(bE, end - 90).line(bE, aOut - rL);
  m2.mark('a').arc(bE + rL, aOut - rL, rL, Math.PI, Math.PI * 2.5).mark('b').line(X - 120, aOut).shift(X - 150, outV(rlanes - 1));
  add(m2, (pts, L, at) => [[sAtZ(pts, L, end - 30, -1), DECK], [sAtZ(pts, L, zB0, -1), LEVEL2], [at('a'), LEVEL2], [at('b'), DECK]], {
    kind: 'link', from: 'xt', to: 'ring', dirTo: -1, lane: 0,
  });
  // M4: ring outer (west here) -> loop right -> over the ring -> crosstown southbound left lane.
  const m4 = new Path(X + 150, outV(rlanes - 1)).shift(X + 120, aOut).line(bW - rL, aOut);
  m4.mark('a').arc(bW - rL, aOut - rL, rL, Math.PI / 2, Math.PI * 2).mark('b').line(bW, end - 90).shiftV(sbL, end - 20).line(sbL, end);
  // (up through the loop to the bridge, then down onto the crosstown)
  add(m4, (pts, L, at) => [[at('a'), DECK], [at('b'), LEVEL2], [sAtZ(pts, L, zB0, 1), LEVEL2], [sAtZ(pts, L, end - 30, 1), DECK]], {
    kind: 'link', from: 'ring', to: 'xt', dirFrom: -1, lane: 0,
  });
  // Signs: on the crosstown before the split, and on the ring before each way off to it.
  const sg = (x, z, ang, text, sub, kind) => {
    const [px, pz] = P([x, z]);
    SIGNS.push({ at: [px, pz], ang: rot ? ang + Math.PI : ang, text, sub, kind, h: DECK });
  };
  sg(nbR, end + 220, -Math.PI / 2, rot ? 'RING HWY WEST' : 'RING HWY EAST', 'RIGHT LANE ↗', 'exit');
  sg(nbL, end + 220, -Math.PI / 2, rot ? 'RING HWY EAST' : 'RING HWY WEST', 'LEFT LANE ↖', 'exit');
  sg(X - 380, inV(rlanes - 1), 0, rot ? 'CROSSTOWN NORTH' : 'CROSSTOWN SOUTH', '1/8 MILE', 'advance');
  sg(X - 225, aIn, 0, rot ? 'CROSSTOWN NORTH' : 'CROSSTOWN SOUTH', '↘', 'exit');
  sg(X + 300, outV(rlanes - 1), Math.PI, rot ? 'CROSSTOWN NORTH' : 'CROSSTOWN SOUTH', '1/8 MILE', 'advance');
  sg(X + 145, aOut, Math.PI, rot ? 'CROSSTOWN NORTH' : 'CROSSTOWN SOUTH', '↖', 'exit');
  // Land: the curves and the legs down to the crosstown inside the ring, the loops outside.
  // (The acceleration lanes alongside the ring need none: they're up at deck height, and
  // buildings keep back from the ring anyway.)
  const rect = (ax, az, bx, bz) => ({ poly: [[ax, az], [bx, az], [bx, bz], [ax, bz]].map(P) });
  HOLES.push(rect(xM3 - R1 - 8, ring + 8, X - 8, aIn + R1 + 8));
  HOLES.push(rect(xM3 - 6, ring + 8, X - 8, end + 6));
  HOLES.push(rect(X + 8, ring + 8, xM1 + R1 + 8, aIn + R1 + 8));
  HOLES.push(rect(X + 8, ring + 8, xM1 + 6, end + 6));
  HOLES.push(rect(bW - 2 * rL - 8, aOut - 2 * rL - 8, bE + 2 * rL + 8, ring - 8));
}

// ---- Build everything ----
const { x0, z0, x1, z1 } = RING;
// Ring service interchanges. The axis runs clockwise; the + side (inner) carriageway goes with it.
// North side (axis heading east), south side (heading west), west (heading north), east (south).
parclo(900, z0, 1, 0, RING.lanes, 'ring', 'CENTRAL AVE', 'RING HWY EAST', 'RING HWY WEST', [true, false]);
parclo(900, z1, -1, 0, RING.lanes, 'ring', 'CENTRAL AVE', 'RING HWY WEST', 'RING HWY EAST', [true, true]);
parclo(x0, 490, 0, -1, RING.lanes, 'ring', 'PARK AVE', 'RING HWY NORTH', 'RING HWY SOUTH', [true, false]);
parclo(x0, 900, 0, -1, RING.lanes, 'ring', 'MARKET ST', 'RING HWY NORTH', 'RING HWY SOUTH', [true, false]);
parclo(x1, 490, 0, 1, RING.lanes, 'ring', 'PARK AVE', 'RING HWY SOUTH', 'RING HWY NORTH', [true, true]);
parclo(x1, 900, 0, 1, RING.lanes, 'ring', 'MARKET ST', 'RING HWY SOUTH', 'RING HWY NORTH', [true, true]);
// Crosstown: one service interchange, at Midway Blvd. Axis heads south; + side = west half.
parclo(XT.x, 690, 0, 1, XT.lanes, 'xt', 'MIDWAY BLVD', 'CROSSTOWN SOUTH', 'CROSSTOWN NORTH', [true, true], 170);
crosstownT(false);
crosstownT(true);

export function inHole(x, z, pad = 0) {
  for (const H of HOLES) {
    const [a, b, , d] = H.poly;
    // (holes are rectangles: test in the rectangle's own axes)
    const ux = b[0] - a[0];
    const uz = b[1] - a[1];
    const vx = d[0] - a[0];
    const vz = d[1] - a[1];
    const Lu = Math.hypot(ux, uz);
    const Lv = Math.hypot(vx, vz);
    const pu = ((x - a[0]) * ux + (z - a[1]) * uz) / Lu;
    const pv = ((x - a[0]) * vx + (z - a[1]) * vz) / Lv;
    if (pu > -pad && pu < Lu + pad && pv > -pad && pv < Lv + pad) return H;
  }
  return null;
}
