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
  const W = (u, v) => [cx + tx * u + rx * v, cz + tz * u + rz * v];
  W.inv = (x, z) => [(x - cx) * tx + (z - cz) * tz, (x - cx) * rx + (z - cz) * rz];
  return W;
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
// ---- Ramp edits (from the in-game interchange editor, rampeditor.js) ----
// Each interchange ramp can be reshaped: a list of control points in the interchange's own
// frame (u along the freeway, v out to the side), joined by a smooth curve. Edits are saved in
// the browser; "template" edits apply to every interchange on that freeway (ring / xt), "halves"
// to one side of one interchange. The end that joins the freeway always stays put.
export const EDIT_KEY = 'crimecity.rampedits.v1';
export const EDITS = (() => {
  try {
    return JSON.parse(localStorage.getItem(EDIT_KEY) || 'null') || {};
  } catch {
    return {};
  }
})();
export const HALVES = []; // one side of an interchange: { id, name, main, dir, W, x, z, ramps: { off, loop, diag } }
// Fewer points along a polyline (Ramer-Douglas-Peucker), keeping the shape within tol meters.
function rdp(pts, tol) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = -1;
  let bd = tol;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = closestOnSegLocal(pts[i], a, b);
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return [a.slice(), b.slice()];
  return [...rdp(pts.slice(0, best + 1), tol).slice(0, -1), ...rdp(pts.slice(best), tol)];
}
function closestOnSegLocal(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
// A smooth curve through control points, a point every ~step m. Each control point is
// [u, v] (smooth: the curve's direction there follows its neighbors) or [u, v, tu, tv] (a set
// direction: the handle, as in a drawing program). Pieces between points are cubic Beziers.
export function handlesOf(P, i) {
  const p = P[i];
  const a = P[Math.max(0, i - 1)];
  const b = P[Math.min(P.length - 1, i + 1)];
  const lin = Math.hypot(p[0] - a[0], p[1] - a[1]) / 3;
  const lout = Math.hypot(b[0] - p[0], b[1] - p[1]) / 3;
  if (p.length >= 4) {
    // (a set handle: the same on both sides, mirrored)
    return { inV: [p[2], p[3]], outV: [p[2], p[3]], set: true };
  }
  let dx = b[0] - a[0];
  let dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  return { inV: [dx * lin, dz * lin], outV: [dx * lout, dz * lout], set: false };
}
export function splinePts(P, step = 2) {
  const out = [[P[0][0], P[0][1]]];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i];
    const d = P[i + 1];
    const ha = handlesOf(P, i).outV;
    const hd = handlesOf(P, i + 1).inV;
    const b = [a[0] + ha[0], a[1] + ha[1]];
    const c = [d[0] - hd[0], d[1] - hd[1]];
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]) + Math.hypot(c[0] - d[0], c[1] - d[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const m = 1 - t;
      out.push([0, 1].map((j) => m * m * m * a[j] + 3 * m * m * t * b[j] + 3 * m * t * t * c[j] + t * t * t * d[j]));
    }
  }
  return out;
}
// An edit as stored: { pts, street } (or, from before, just the points).
export function editPts(ov) {
  return Array.isArray(ov) ? ov : ov?.pts;
}
// The end of a ramp that joins the freeway: where it was, heading along the freeway.
export function lockEnd(kind, ctrl) {
  const i = kind === 'off' ? 0 : ctrl.length - 1;
  const j = kind === 'off' ? 1 : ctrl.length - 2;
  const l = Math.hypot(ctrl[j][0] - ctrl[i][0], ctrl[j][1] - ctrl[i][1]) / 3;
  ctrl[i] = [ctrl[i][0], ctrl[i][1], l, 0];
  return ctrl;
}
// Height along a ramp at arc length s.
function hAt(r, s) {
  const L = r.L;
  if (s <= 0) return r.h[0];
  for (let i = 1; i < L.length; i++) {
    if (L[i] >= s) {
      const t = (s - L[i - 1]) / (L[i] - L[i - 1] || 1);
      return r.h[i - 1] + (r.h[i] - r.h[i - 1]) * t;
    }
  }
  return r.h[r.h.length - 1];
}
// Add a ramp from its default path, then reshape it if it's been edited.
function editableRamp(W, path, keys, info, half, kind) {
  const r = addRamp(W, path, keys, info);
  r.local = path.p.map((p) => p.slice());
  r.defCtrl = rdp(r.local, 1.2); // (a handful of points to drag)
  r.ctrl = r.defCtrl;
  r.editKind = kind;
  r.half = half.id;
  half.ramps[kind] = r;
  const ov = EDITS.halves?.[half.id]?.[kind] || EDITS.template?.[half.main]?.[kind];
  const ovPts = editPts(ov);
  if (Array.isArray(ovPts) && ovPts.length >= 2) {
    const ctrl = ovPts.map((p) => p.map(Number));
    // (the end that joins the freeway stays exactly where it was, heading along the freeway)
    if (kind === 'off') ctrl[0] = r.defCtrl[0].slice();
    else ctrl[ctrl.length - 1] = r.defCtrl[r.defCtrl.length - 1].slice();
    lockEnd(kind, ctrl);
    const loc = splinePts(ctrl);
    const pts = loc.map(([u, v]) => W(u, v));
    const L = lengths(pts);
    const T0 = r.L[r.L.length - 1];
    const T1 = L[L.length - 1] || 1;
    const h = L.map((sl) => hAt(r, (sl / T1) * T0));
    Object.assign(r, { pts, h, L, local: loc, ctrl, edited: true });
    // Snapped onto a street: the point in the middle of that street the ramp links to.
    if (ov.street) r.streetLocal = ov.street.map(Number);
    // An entrance is taken by traffic going the way the ramp leaves the street.
    if (r.approach) {
      const [ax, az] = pts[0];
      const [bx, bz] = pts[Math.min(pts.length - 1, 3)];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      r.approach = [(bx - ax) / l, (bz - az) / l];
    }
  }
  return r;
}
// A world direction from a local one.
const dirOf = (W, du, dv) => {
  const [ax, az] = W(0, 0);
  const [bx, bz] = W(du, dv);
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return [(bx - ax) / l, (bz - az) / l];
};
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
  const H = 10; // half the cross street's width (they're all avenues, 20 m curb to curb)
  const uL = -(H + RAMP_HW + 0.6); // the loop's straight run in, just off the curb
  const name = opts.name;
  const [hx, hz] = W(0, 0);
  const half = { id: `${opts.main}@${Math.round(hx)},${Math.round(hz)}:${opts.dir}`, name, main: opts.main, dir: opts.dir, toward: opts.toward, W, x: hx, z: hz, H, vA, vL, ramps: {} };
  HALVES.push(half);

  // Exit: taper off the right lane, decelerate, swing right and down to the cross street,
  // meeting it square at the curb.
  const off = new Path(-Ud, vL).shift(-Ud + 35, vA).line(-Ud + 40, vA).shift(-40, vOff).line(-H + 1.5, vOff);
  const rOff = editableRamp(W, off, (lc, L) => [[sAtU(lc, L, -Ud + 38), DECK], [sAtU(lc, L, -42), 0]], {
    kind: 'off', main: opts.main, dir: opts.dir, laneFrom: lanes - 1, street: W(0, vOff), name,
  }, half, 'off');
  // Loop entrance: from the cross street's curb lane heading away from the freeway, peel off
  // to the right, loop 270 degrees up to the deck, then the acceleration lane across the bridge.
  const loop = new Path(-H + 2.2, 19).line(-H + 2.2, 21).shiftV(uL, vLoop - 2).line(uL, vLoop);
  loop.mark('a').arc(uL - rL, vLoop, rL, 0, Math.PI * 1.5).mark('b');
  loop.line(165, vA);
  const rLoop = editableRamp(W, loop, (lc, L, at) => [[at('a') - 4, 0], [at('b'), DECK]], {
    kind: 'on', loop: true, main: opts.main, dir: opts.dir, laneTo: lanes - 1, street: W(0, 20), name,
    approach: dirOf(W, 0, 1), // (taken by traffic heading away from the freeway: a right turn)
    tail: { v0: vA, v1: vL }, // (the acceleration lane carries on along the freeway: see addTails)
  }, half, 'loop');
  // Diagonal entrance: right turn off the cross street lane heading toward the freeway, up
  // alongside to join the acceleration lane.
  // (it stays out wide while it climbs, and only swings in alongside once it's level with
  // the deck: no running in underneath the edge of it)
  // It peels off the curb lane in a smooth right-hand curve (no square turn): you veer right
  // onto it.
  const vWide = vA + RAMP_HW * 2 + 1.2;
  const vS = vOn + 2; // where it leaves the street (well clear of the exit opposite)
  const R = 26;
  const diag = new Path(H - 2.5, vS + 6).line(H - 2.5, vS).arc(H - 2.5 + R, vS, R, Math.PI, Math.PI * 1.5);
  diag.shift(100, vWide).line(118, vWide).shift(150, vA).line(165, vA);
  const rDiag = editableRamp(W, diag, (lc, L) => [[sAtU(lc, L, H + 14), 0], [sAtU(lc, L, 116), DECK]], {
    kind: 'on', main: opts.main, dir: opts.dir, joinsRamp: true, street: W(0, vS + 6), name,
    approach: dirOf(W, 0, -1), // (taken by traffic heading toward the freeway: a right turn)
  }, half, 'diag');
  // (links for traffic between the street's middle and the ramp ends, inside the street)
  const offEnd = rOff.local[rOff.local.length - 1];
  const loopS = rLoop.local[0];
  const diagS = rDiag.local[0];
  const streetOf = (r, end) => (r.streetLocal ? W(...r.streetLocal) : W(0, end[1]));
  STUBS.push([streetOf(rOff, offEnd), W(...offEnd)], [streetOf(rLoop, loopS), W(...loopS)], [streetOf(rDiag, diagS), W(...diagS)]);
  RAMPS[RAMPS.length - 3].stub = STUBS.length - 3;
  RAMPS[RAMPS.length - 2].stub = STUBS.length - 2;
  RAMPS[RAMPS.length - 1].stub = STUBS.length - 1;
  // Land for the ramps (no streets or buildings).
  // (around wherever the ramps actually run, edited or not)
  const neg = [...rOff.local, ...rLoop.local].filter(([u]) => u < 0);
  const pos = rDiag.local.filter(([u]) => u > 0);
  const mx = (list, j, f) => f(...list.map((p) => p[j]));
  HOLES.push({ poly: rectLocal(W, Math.min(-Ud - 8, mx(neg, 0, Math.min) - 8), -H, 8, Math.max(vOff + 10, mx(neg, 1, Math.max) + 10)) });
  HOLES.push({ poly: rectLocal(W, H, Math.max(195, mx(pos, 0, Math.max) + 30), 8, Math.max(vS + 20, mx(pos, 1, Math.max) + 14)) }); // (room for the peel-off: side streets keep well clear)
  // Signs over the right-hand lanes: 200 m before the exit and where it leaves.
  const [ox, oz] = W(0, 0);
  const [tx, tz] = W(1, 0);
  const ang = Math.atan2(tz - oz, tx - ox);
  SIGNS.push({ at: W(-Ud - 150, vL), ang, text: `EXIT ${name}`, sub: '1/8 MILE', kind: 'advance', h: DECK });
  SIGNS.push({ at: W(-Ud + 25, vA), ang, text: `EXIT ${name}`, sub: '↗', kind: 'exit', h: DECK });
  // On the cross street, at the two entrances.
  SIGNS.push({ at: W(-H - 1.5, loopS[1] - 5), ang: ang + Math.PI / 2, text: opts.toward, kind: 'entrance', h: 0 });
  SIGNS.push({ at: W(H + 1.5, diagS[1] + 8), ang: ang - Math.PI / 2, text: opts.toward, kind: 'entrance', h: 0 });
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
addTails();

// ---- Acceleration lanes ----
// Each entrance's acceleration lane runs on alongside the freeway (following it round the
// ring's corners) for a good long stretch, then tapers gently into the right-hand lane: room
// to get up to speed and find a gap. It ends before the next exit starts, so traffic getting
// on never has to cross traffic getting off.
function addTails() {
  const XT_LINE = [[XT.x, XT.end0], [XT.x, XT.end1]];
  const lines = { ring: { pts: [...RING_LINE, RING_LINE[0]], closed: true }, xt: { pts: XT_LINE, closed: false } };
  for (const ln of Object.values(lines)) ln.L = lengths(ln.pts);
  // Point and direction (in point order) at arc length s.
  const at = (ln, s) => {
    const T = ln.L[ln.L.length - 1];
    if (ln.closed) s = ((s % T) + T) % T;
    s = Math.max(0, Math.min(T, s));
    let i = 1;
    while (i < ln.L.length - 1 && ln.L[i] < s) i++;
    const [ax, az] = ln.pts[i - 1];
    const [bx, bz] = ln.pts[i];
    const l = ln.L[i] - ln.L[i - 1] || 1;
    const t = (s - ln.L[i - 1]) / l;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / l, tz: (bz - az) / l };
  };
  // Arc length and side (+1: right of point order) of the nearest spot on the line.
  const proj = (ln, x, z) => {
    let best = null;
    for (let i = 1; i < ln.pts.length; i++) {
      const [ax, az] = ln.pts[i - 1];
      const [bx, bz] = ln.pts[i];
      const l = ln.L[i] - ln.L[i - 1] || 1;
      let t = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (l * l);
      t = Math.max(0, Math.min(1, t));
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) {
        const side = Math.sign(-(bz - az) * (x - ax) + (bx - ax) * (z - az)) || 1;
        best = { s: ln.L[i - 1] + l * t, d, side };
      }
    }
    return best;
  };
  const PAR = 150; // the acceleration lane itself, alongside
  const TAPER = 70; // and the taper into the right lane
  for (const r of RAMPS) {
    if (!r.tail) continue;
    const ln = lines[r.main];
    const T = ln.L[ln.L.length - 1];
    const n = r.pts.length;
    const [ex, ez] = r.pts[n - 1];
    const [px, pz] = r.pts[n - 2];
    const p0 = proj(ln, ex, ez);
    const a0 = at(ln, p0.s);
    const sign = (ex - px) * a0.tx + (ez - pz) * a0.tz >= 0 ? 1 : -1; // travel along point order?
    // Room: up to the next exit (or way off to the other freeway) on this carriageway.
    let room = ln.closed ? T / 2 : sign > 0 ? T - p0.s - 20 : p0.s - 20;
    let next = null;
    for (const q of RAMPS) {
      if (q === r || q.kind === 'on' || q.h[0] < DECK - 0.1) continue;
      const pq = proj(ln, q.pts[0][0], q.pts[0][1]);
      if (pq.d > 25 || pq.side !== p0.side) continue;
      let ds = (pq.s - p0.s) * sign;
      if (ln.closed) ds = ((ds % T) + T) % T;
      const gap = ln.closed ? 30 : 5; // (the crosstown's ways off curve away: merge right up to them)
      if (ds > 0 && ds - gap < room) {
        room = ds - gap;
        next = q;
      }
    }
    // The next exit close by, and its deceleration lane where ours is: one auxiliary lane
    // from the entrance right through to the exit (you merge left anywhere along it, or stay
    // in it to take the exit).
    let aux = null;
    if (next && ln.closed && room < PAR + TAPER + 60) {
      for (let i = 0; i < next.pts.length; i++) {
        const pq = proj(ln, next.pts[i][0], next.pts[i][1]);
        if (Math.abs(pq.d - r.tail.v0) < 0.3) {
          let ds = (pq.s - p0.s) * sign;
          if (ln.closed) ds = ((ds % T) + T) % T;
          aux = ds;
          break;
        }
      }
    }
    const taper = aux ? 0 : Math.max(35, Math.min(TAPER, room * 0.35));
    const par = aux ? aux : Math.max(10, Math.min(PAR, room - taper));
    const total = par + taper;
    const step = total / Math.max(1, Math.round(total / 4));
    for (let d = step; d <= total + 0.01; d += step) {
      const a = at(ln, p0.s + sign * d);
      const tx = a.tx * sign;
      const tz = a.tz * sign;
      // (v to the right of travel, as in the ramp's own frame)
      const k = d <= par ? 0 : smoother((d - par) / taper);
      const v = r.tail.v0 + (r.tail.v1 - r.tail.v0) * k;
      r.pts.push([a.x - tz * v, a.z + tx * v]);
      r.h.push(DECK);
    }
    r.aux = !!aux;
    r.tailPar = par;
    r.L = lengths(r.pts);
    r.tailLen = total;
  }
}

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
