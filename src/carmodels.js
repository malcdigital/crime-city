import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Vehicle models (vehicle.js builds a car from these; parking.js's far-off stand-ins too).
// Every type is built once from side profiles and shared by every car of that type:
//   paint   the body panels (the car's color: one material per color)
//   trim    everything else that's solid, painted in its vertices (one shared material): bumpers,
//           grille, mirrors, plates, the black window trim, and the interior you see through the
//           glass (dashboard, steering wheel, seats, floor; a bus's rows of seats)
//   glass   windshield, rear and side windows (tinted, see-through)
//   doors   the two front doors (vehicle.js hangs them on hinges): a panel and its window
//   wheel   a tire with its rim and hub
//   lights  where the head and tail lights go; roof: the roof's height (signs, light bars)
//   seat    where the driver sits (vehicle.js seats a driver there: driverGeometry)
// A car faces +z, +x is its left, y is up from the ground; the body's underside is 0.33 m up.

const RIM = 0xb9bec4;
const TIRE = 0x161616;
const BLACK = 0x1a1b1d;
const DARK = 0x2a2c30;
const CHROME = 0xc8ccd0;
const PLATE = 0xe8e6da;

// ---- Geometry helpers ----

// Paint a geometry's vertices one color.
function tint(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// A side profile (points [z, y] round it) given width: half-width hw (a number, or hw(y) to
// taper it). Flat-shaded, the faces turned outward.
function loft(prof, hw, { caps = true, band = true } = {}) {
  const H = typeof hw === 'function' ? hw : () => hw;
  const pos = [];
  const push = (a, b, c, out) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.dot(out) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const P = (s, [z, y]) => new THREE.Vector3(s * H(y), y, z);
  if (caps) {
    const tris = THREE.ShapeUtils.triangulateShape(prof.map(([z, y]) => new THREE.Vector2(z, y)), []);
    for (const s of [1, -1]) for (const [i, j, k] of tris) push(P(s, prof[i]), P(s, prof[j]), P(s, prof[k]), new THREE.Vector3(s, 0, 0));
  }
  if (band) {
    // (which way round the profile goes: an edge's outside is to its right going round
    // clockwise, to its left the other way)
    let area = 0;
    for (let i = 0; i < prof.length; i++) {
      const [z0, y0] = prof[i];
      const [z1, y1] = prof[(i + 1) % prof.length];
      area += z0 * y1 - z1 * y0;
    }
    const ccw = area > 0;
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i];
      const b = prof[(i + 1) % prof.length];
      const dz = b[0] - a[0];
      const dy = b[1] - a[1];
      const out = ccw ? new THREE.Vector3(0, -dz, dy) : new THREE.Vector3(0, dz, -dy);
      const La = P(1, a);
      const Lb = P(1, b);
      const Ra = P(-1, a);
      const Rb = P(-1, b);
      push(La, Lb, Rb, out);
      push(La, Rb, Ra, out);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A box (w × h × d) at x, y, z, turned rx about x.
function box(w, h, d, x, y, z, color, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return tint(g, color);
}

// A bar of thickness t (and depth d) from point a to point b.
function bar(a, b, t, color, d = t) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(t, d, len);
  const m = new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.0001));
  g.applyMatrix4(m);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return tint(g, color);
}

// The bottom edge of a body: from the back to the front along the sill, up over each wheel.
function sill(L, y0, arches) {
  const pts = [[-L + 0.06, y0]];
  for (const [zc, r, yc] of [...arches].sort((p, q) => p[0] - q[0])) {
    pts.push([zc - r, y0]);
    for (let k = 1; k < 8; k++) {
      const t = Math.PI - (k / 8) * Math.PI;
      pts.push([zc + r * Math.cos(t), Math.max(y0, yc + r * Math.sin(t))]);
    }
    pts.push([zc + r, y0]);
  }
  pts.push([L - 0.06, y0]);
  return pts;
}

// Clip a convex polygon ([z, y] points) to z0 <= z <= z1.
function clipZ(poly, z0, z1) {
  const cut = (pts, keep, at) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) {
        const t = (at - a[0]) / (b[0] - a[0]);
        out.push([at, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  return cut(cut(poly, (p) => p[0] >= z0, z0), (p) => p[0] <= z1, z1);
}

// A flat window in the side of the greenhouse (the polygon on its tapered side, x = ±hw(y)).
function sidePane(poly, hw, s, out = 0.004) {
  if (poly.length < 3) return null;
  const pos = [];
  const P = ([z, y]) => [s * (hw(y) + out), y, z];
  for (let i = 1; i < poly.length - 1; i++) {
    const tri = [P(poly[0]), P(poly[i]), P(poly[i + 1])];
    const a = new THREE.Vector3(...tri[0]);
    const n = new THREE.Vector3(...tri[1]).sub(a).cross(new THREE.Vector3(...tri[2]).sub(a));
    if (n.x * s < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
    pos.push(...tri.flat());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const merge = (list) => {
  const gs = list.filter(Boolean).map((g) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g;
  });
  return gs.length ? mergeGeometries(gs) : null;
};

// ---- The interior ----

// The colors inside: the seats, their inserts, the dash, the carpet, an accent.
function palette(seat) {
  const c = new THREE.Color(seat);
  const ins = c.clone().lerp(new THREE.Color(0xffffff), 0.12).getHex();
  return { seat, insert: ins, dash: 0x2a2b2f, dash2: 0x36383d, carpet: 0x34353a, mat: 0x222326, accent: 0x9aa0a8, head: 0xbdb8ae };
}

// A disc facing -z (toward the seats) at x, y, z, radius r: a gauge, a knob, a speaker.
function disc(r, depth, x, y, z, color, tiltX = 0, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, depth, seg);
  g.rotateX(Math.PI / 2 + tiltX);
  g.translate(x, y, z);
  return tint(g, color);
}

// A bucket seat facing +z at (x, z), its cushion top at y: side bolsters on the cushion and
// the back, an insert down the middle, a headrest on two posts, the rails under it.
function seat(x, y, z, P, { w = 0.52, bench = false, sh = 1, rests = 1 } = {}) {
  const out = [];
  const back = -0.22 - 0.15 * (1 - sh); // (how far it leans back)
  const bh = 0.62 * sh;
  out.push(box(w, 0.12, 0.5, x, y - 0.06, z, P.seat)); // (the cushion)
  out.push(box(w - 0.16, 0.02, 0.4, x, y + 0.005, z + 0.01, P.insert)); // (its insert)
  // (the back, leaning back about the cushion's rear edge)
  const by = y + (bh / 2) * Math.cos(back);
  const bz = z - 0.25 + (bh / 2) * Math.sin(back);
  out.push(box(w, bh, 0.12, x, by, bz, P.seat, back));
  out.push(box(w - 0.16, bh - 0.12, 0.02, x, by - 0.02, bz + 0.065, P.insert, back));
  if (!bench) {
    for (const s of [1, -1]) {
      out.push(box(0.07, 0.08, 0.46, x + s * (w / 2 - 0.035), y + 0.02, z, P.seat)); // (cushion bolsters)
      out.push(box(0.07, bh * 0.8, 0.07, x + s * (w / 2 - 0.035), by - bh * 0.05, bz + 0.08, P.seat, back)); // (back bolsters)
    }
  }
  // (headrests: up on two posts over the back)
  const top = new THREE.Vector3(0, bh, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), back);
  const n = rests;
  for (let k = 0; k < n; k++) {
    const hx = n === 1 ? x : x - w / 2 + (w / n) * (k + 0.5);
    const hy = y + top.y + 0.06 + 0.08 * sh;
    const hz = z - 0.25 + top.z - 0.02;
    for (const s of [1, -1]) out.push(box(0.015, 0.08, 0.015, hx + s * 0.07, hy - 0.08, hz, P.accent));
    out.push(box(Math.min(0.26, w * 0.5), 0.17 * sh, 0.09, hx, hy, hz, P.seat, back));
  }
  // (the base and its rails)
  out.push(box(w * 0.8, Math.max(0.04, y - 0.12 - (y - 0.22)), 0.38, x, y - 0.17, z, 0x111112));
  for (const s of [1, -1]) out.push(box(0.03, 0.03, 0.5, x + s * w * 0.3, y - 0.21, z, P.accent));
  return out;
}

// The steering wheel, at (x, y, z), tilted on its column toward the driver: a rim, three
// spokes, the airbag hub with a badge, the column and its stalks.
function steeringWheel(x, y, z, tilt = 0.45) {
  const parts = [];
  const rim = new THREE.TorusGeometry(0.175, 0.024, 6, 22);
  parts.push(tint(rim, 0x111111));
  // (grips at 9 and 3, a little thicker)
  for (const s of [1, -1]) {
    const grip = new THREE.TorusGeometry(0.175, 0.03, 6, 6, 0.8);
    grip.rotateZ(s > 0 ? -0.4 : Math.PI - 0.4);
    parts.push(tint(grip, 0x1d1d1d));
  }
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = new THREE.BoxGeometry(0.15, 0.035, 0.025);
    sp.translate(0.085, 0, 0);
    sp.rotateZ(a);
    parts.push(tint(sp, 0x202124));
  }
  parts.push(tint(new THREE.BoxGeometry(0.13, 0.1, 0.06), 0x18191b)); // (the hub)
  const badge = new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10);
  badge.rotateX(Math.PI / 2);
  badge.translate(0, 0.005, -0.035);
  parts.push(tint(badge, CHROME));
  const g = merge(parts);
  g.rotateX(-tilt);
  g.translate(x, y, z);
  const out = [g];
  // (the column under its shroud, the stalks off it)
  const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), -tilt);
  const c0 = [x, y - 0.01 + back.y * 0.05, z + back.z * 0.05];
  const c1 = [x, y - 0.06 + back.y * 0.3, z + back.z * 0.3];
  out.push(bar(c0, c1, 0.09, 0x151517, 0.1));
  for (const s of [1, -1]) out.push(bar([x + s * 0.05, c0[1] + 0.01, c0[2] + 0.06], [x + s * 0.17, c0[1] + 0.0, c0[2] + 0.04], 0.018, 0x2a2b2e));
  return out;
}

// Dashboard, steering wheel, gauges, the radio, vents, the console and shifter, pedals, the
// seats, carpet and mats, the headliner, the mirror and visors: a car's cabin.
function cabin(o) {
  const { hwIn, belt, dashZ, seatZ, rearZ, driverX, color, seats = 4, wheelY = belt + 0.05, floor = 0.42, sh = 1, roof = belt + 0.5, wsTop = null } = o;
  const P = palette(color);
  const out = [];
  const back = (rearZ ?? seatZ) - 0.55;
  const W2 = hwIn * 2;
  // The floor: carpet, a tunnel down the middle, mats in the footwells.
  out.push(box(W2, floor - 0.3, dashZ - back, 0, (floor + 0.3) / 2, (dashZ + back) / 2, P.carpet));
  if (seats >= 2) out.push(box(0.26, 0.14, dashZ - back - 0.3, 0, floor + 0.07, (dashZ + back + 0.3) / 2, P.carpet)); // (the tunnel)
  for (const sx of seats >= 2 ? [1, -1] : [1]) out.push(box(0.46, 0.012, 0.55, sx * driverX, floor + 0.006, seatZ + 0.75, P.mat));
  if (seats >= 4 && rearZ !== undefined) for (const sx of [1, -1]) out.push(box(0.42, 0.012, 0.36, sx * driverX, floor + 0.006, rearZ + 0.52, P.mat));
  // The dashboard: the lower body, the padded top sloping up to the glass, the gauge hood.
  const dy = belt - 0.07;
  out.push(box(W2, 0.3, 0.42, 0, dy - 0.08, dashZ + 0.04, P.dash));
  out.push(box(W2 - 0.04, 0.05, 0.4, 0, belt + 0.06, dashZ + 0.08, P.dash2, 0.22)); // (the top)
  out.push(box(W2 - 0.06, 0.035, 0.035, 0, belt + 0.035, dashZ - 0.17, P.dash2)); // (its lip)
  // (the gauges: a hood over two dials, the needles, a strip of lights)
  out.push(box(0.4, 0.13, 0.16, driverX, belt + 0.06, dashZ - 0.08, P.dash2));
  out.push(box(0.38, 0.11, 0.01, driverX, belt + 0.0, dashZ - 0.155, 0x070809));
  for (const s of [1, -1]) {
    out.push(disc(0.048, 0.008, driverX + s * 0.09, belt + 0.0, dashZ - 0.162, 0xd8d8d0, 0, 16));
    out.push(disc(0.04, 0.008, driverX + s * 0.09, belt + 0.0, dashZ - 0.166, 0x0c0d10, 0, 16));
    out.push(box(0.004, 0.034, 0.004, driverX + s * 0.09 + 0.008, belt + 0.01, dashZ - 0.172, 0xe0402a, 0, 0)); // (the needle)
  }
  out.push(box(0.05, 0.02, 0.004, driverX, belt - 0.03, dashZ - 0.166, 0x2fd06a)); // (a light)
  // (the center stack: vents, the radio, the climate knobs, the hazard button)
  const cx = 0;
  out.push(box(0.36, 0.42, 0.06, cx, dy - 0.1, dashZ - 0.18, P.dash2));
  for (const s of [1, -1]) {
    out.push(box(0.13, 0.06, 0.01, cx + s * 0.085, dy + 0.05, dashZ - 0.212, 0x0b0c0e)); // (vents)
    for (let k = 0; k < 3; k++) out.push(box(0.12, 0.006, 0.012, cx + s * 0.085, dy + 0.03 + k * 0.02, dashZ - 0.216, P.accent));
  }
  out.push(box(0.26, 0.09, 0.012, cx, dy - 0.05, dashZ - 0.214, 0x0a0b0d)); // (the radio's face)
  out.push(box(0.15, 0.05, 0.004, cx, dy - 0.045, dashZ - 0.221, 0x1f6fa8)); // (its display)
  for (const s of [1, -1]) out.push(disc(0.018, 0.02, cx + s * 0.105, dy - 0.05, dashZ - 0.224, P.accent, 0, 10)); // (volume, tuning)
  for (let k = 0; k < 5; k++) out.push(box(0.028, 0.012, 0.008, cx - 0.06 + k * 0.03, dy - 0.085, dashZ - 0.222, 0x3a3c40)); // (presets)
  out.push(box(0.03, 0.02, 0.01, cx, dy + 0.0, dashZ - 0.218, 0xc0392b)); // (hazards)
  for (const s of [1, -1, 0]) out.push(disc(0.022, 0.025, cx + s * 0.09, dy - 0.18, dashZ - 0.222, 0x2d2f33, 0, 12)); // (climate knobs)
  // (vents at the ends, the glovebox, a speaker in the dash top)
  for (const s of [1, -1]) {
    out.push(box(0.1, 0.07, 0.01, s * (hwIn - 0.1), dy + 0.04, dashZ - 0.175, 0x0b0c0e));
    for (let k = 0; k < 3; k++) out.push(box(0.09, 0.006, 0.012, s * (hwIn - 0.1), dy + 0.02 + k * 0.02, dashZ - 0.18, P.accent));
  }
  if (seats >= 2) out.push(box(0.36, 0.14, 0.01, -driverX, dy - 0.1, dashZ - 0.175, P.dash2)); // (the glovebox)
  // The steering wheel on its column.
  out.push(...steeringWheel(driverX, wheelY, dashZ - 0.42));
  // (the pedals, under the dash in the driver's footwell)
  const pz = seatZ + 0.84;
  out.push(box(0.07, 0.11, 0.02, driverX + 0.09, floor + 0.12, pz, 0x2b2c2f, -0.5)); // (gas)
  out.push(box(0.1, 0.08, 0.02, driverX - 0.05, floor + 0.15, pz - 0.02, 0x2b2c2f, -0.5)); // (brake)
  // The console between the seats: shifter, cupholders, handbrake, the armrest.
  if (seats >= 2) {
    out.push(box(0.22, 0.2, 0.62, 0, floor + 0.16, seatZ + 0.25, P.dash));
    out.push(box(0.2, 0.012, 0.2, 0, floor + 0.265, seatZ + 0.45, 0x0e0f11)); // (the shifter's boot plate)
    out.push(bar([0, floor + 0.27, seatZ + 0.45], [0, floor + 0.4, seatZ + 0.42], 0.025, 0x111111));
    out.push(box(0.05, 0.05, 0.06, 0, floor + 0.42, seatZ + 0.42, 0x222326)); // (the knob)
    for (const s of [1, -1]) out.push(disc(0.035, 0.012, s * 0.05, floor + 0.265, seatZ + 0.22, 0x0b0c0e, -Math.PI / 2, 12)); // (cupholders)
    out.push(bar([0.045, floor + 0.27, seatZ + 0.1], [0.045, floor + 0.32, seatZ - 0.08], 0.035, 0x1a1b1d)); // (the handbrake)
    out.push(box(0.2, 0.08, 0.28, 0, floor + 0.3, seatZ - 0.12, P.seat)); // (the armrest)
  }
  // The seats: two up front, a bench behind.
  const cy = floor + 0.2;
  out.push(...seat(driverX, cy, seatZ, P, { sh }));
  if (seats >= 2) out.push(...seat(-driverX, cy, seatZ, P, { sh }));
  if (seats >= 4 && rearZ !== undefined) {
    out.push(...seat(0, cy + 0.02, rearZ, P, { w: W2 - 0.12, bench: true, rests: 3 }));
    // (the parcel shelf behind it, its speakers)
    out.push(box(W2 - 0.1, 0.03, 0.4, 0, belt + 0.02, rearZ - 0.62, P.dash));
    for (const s of [1, -1]) out.push(disc(0.06, 0.012, s * 0.45, belt + 0.04, rearZ - 0.62, 0x0b0c0e, -Math.PI / 2, 14));
  }
  // The headliner under the roof, the dome light, the mirror, the visors.
  const front = wsTop ?? dashZ - 0.45;
  out.push(box(W2 - 0.06, 0.02, front - back - 0.15, 0, roof - 0.04, (front + back) / 2 - 0.05, P.head));
  out.push(box(0.14, 0.012, 0.08, 0, roof - 0.055, (front + back) / 2, 0xfff4d6)); // (the dome light)
  out.push(box(0.22, 0.06, 0.02, 0, roof - 0.12, front - 0.02, 0x1a1b1d)); // (the mirror)
  out.push(box(0.2, 0.05, 0.004, 0, roof - 0.12, front - 0.032, 0x8fa3b5));
  out.push(box(0.02, 0.06, 0.02, 0, roof - 0.07, front - 0.01, 0x1a1b1d));
  for (const sx of seats >= 2 ? [1, -1] : [1]) out.push(box(0.36, 0.015, 0.16, sx * driverX, roof - 0.06, front - 0.1, P.head, 0.15)); // (visors)
  return out;
}

// The inside of a front door: the card, the armrest, the pull, the handle, a speaker, the
// window switches. Built at the hinge for side sx (+1 left), like the door.
function doorCard(D, sx, inside) {
  const P = palette(inside);
  const x = -sx * 0.035; // (on the door's inner face)
  const len = D.len;
  const out = [];
  out.push(box(0.012, D.top - D.bottom - 0.06, len - 0.08, x, (D.top + D.bottom) / 2, -len / 2, P.dash));
  out.push(box(0.012, 0.18, len - 0.2, x - sx * 0.002, D.top - 0.2, -len / 2 - 0.02, P.insert)); // (the fabric insert)
  out.push(box(0.07, 0.05, 0.4, x - sx * 0.035, D.top - 0.33, -len * 0.55, P.dash2)); // (the armrest)
  out.push(box(0.03, 0.04, 0.14, x - sx * 0.015, D.top - 0.12, -0.25, P.accent)); // (the handle)
  out.push(box(0.02, 0.02, 0.1, x - sx * 0.05, D.top - 0.305, -len * 0.55 + 0.12, 0x0e0f11)); // (the switches)
  const spk = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 14);
  spk.rotateZ(Math.PI / 2);
  spk.translate(x - sx * 0.006, D.bottom + 0.16, -len * 0.4);
  out.push(tint(spk, 0x0b0c0e));
  // (the outside handle)
  out.push(box(0.03, 0.03, 0.16, sx * 0.03, D.top - 0.12, -len + 0.22, BLACK));
  return merge(out);
}

// ---- The types ----

// A sedan-shaped car (sedan, police, taxi; sports with its own numbers): its side profile, the
// greenhouse, the doors and the interior from a few numbers.
function car(t, s) {
  const L = t.l / 2;
  const W = t.w / 2;
  const k = t.l / 4.4; // (lengths along the car scale with it)
  const wz = L - 0.85;
  const arches = [[wz, 0.47, 0.38], [-wz, 0.47, 0.38]];
  const y0 = 0.33;
  const { hood, belt, roof, trunk, wsBase, roofF, roofR, rearBase, noseY = 0.7 } = s;
  const fl = (s.floor ?? 0.42) - 0.02;
  // (the body: nose, hood, along the beltline, the trunk, the tail; the sill under it)
  const prof = [
    ...sill(L, y0, arches),
    [L, 0.48], [L + 0.02, noseY], [L - 0.14, hood], [wsBase * k, belt],
    // (the cabin: open from the floor up, between the windshield and the back glass)
    [wsBase * k - 0.05, fl], [rearBase * k + 0.05, fl],
    [rearBase * k, belt], [-L + 0.2, trunk], [-L, trunk - 0.12], [-L - 0.02, 0.5],
  ];
  const hwBody = (y) => W - 0.02 - 0.13 * THREE.MathUtils.smoothstep(y, belt - 0.3, roof);
  const hwB = hwBody(belt) - 0.04;
  const hwR = W - 0.27;
  const hwG = (y) => hwB + (hwR - hwB) * THREE.MathUtils.clamp((y - belt) / (roof - belt), 0, 1);
  const green = [[wsBase * k, belt], [roofF * k, roof], [roofR * k, roof], [rearBase * k, belt]];
  const paint = [loft(prof, hwBody)];
  // (the roof panel over the glass)
  paint.push(loft([[roofF * k + 0.05, roof - 0.035], [roofF * k - 0.02, roof + 0.025], [roofR * k + 0.02, roof + 0.025], [roofR * k - 0.05, roof - 0.035]], hwR + 0.015));
  // (the pillars: A at the windshield, B between the doors, C at the back glass)
  const bZ = s.bPillar * k;
  for (const sx of [1, -1]) {
    paint.push(bar([sx * hwB, belt, wsBase * k], [sx * hwR, roof, roofF * k], 0.07, 0, 0.09));
    paint.push(bar([sx * hwB, belt, rearBase * k], [sx * hwR, roof, roofR * k], 0.07, 0, 0.18));
  }
  // (the sides behind the front doors, floor to beltline: the doors close the rest)
  const wallX = hwBody(belt - 0.2) - 0.01;
  for (const sx of [1, -1]) paint.push(box(0.05, belt - fl, bZ - rearBase * k + 0.04, sx * wallX, (belt + fl) / 2, (bZ + rearBase * k) / 2 - 0.02, 0));
  const glass = [loft(green, hwG, { caps: false })];
  // Side windows: the front one is in the door (doors()); the rear one (four doors) here.
  if (s.doors4) for (const sx of [1, -1]) glass.push(sidePane(clipZ(green, rearBase * k, bZ - 0.06), hwG, sx));
  else for (const sx of [1, -1]) glass.push(sidePane(clipZ(green, rearBase * k, bZ - 0.06), hwG, sx));
  const trim = [];
  for (const sx of [1, -1]) {
    trim.push(bar([sx * hwB, belt + 0.01, bZ - 0.03], [sx * hwR, roof - 0.02, bZ - 0.08], 0.05, BLACK, 0.12)); // (B pillar)
    trim.push(box(0.03, 0.03, (wsBase - rearBase) * k, sx * (hwB + 0.02), belt + 0.005, ((wsBase + rearBase) * k) / 2, BLACK)); // (the belt trim)
    // (the mirror)
    trim.push(box(0.16, 0.12, 0.08, sx * (hwB + 0.12), belt + 0.1, wsBase * k - 0.12, s.mirror ?? BLACK));
    trim.push(box(0.1, 0.04, 0.06, sx * (hwB + 0.04), belt + 0.06, wsBase * k - 0.12, BLACK));
  }
  // (bumpers, the grille, plates, the exhaust)
  trim.push(box(t.w - 0.02, 0.2, 0.14, 0, 0.44, L - 0.02, s.bumper ?? DARK));
  trim.push(box(t.w - 0.02, 0.2, 0.14, 0, 0.44, -L + 0.02, s.bumper ?? DARK));
  trim.push(box(t.w * 0.42, 0.14, 0.05, 0, noseY - 0.08, L + 0.02, s.grille ?? 0x101114));
  trim.push(box(0.52, 0.12, 0.02, 0, 0.47, L + 0.1, PLATE));
  trim.push(box(0.52, 0.12, 0.02, 0, 0.6, -L - 0.03, PLATE));
  const ex = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8);
  ex.rotateX(Math.PI / 2);
  ex.translate(-W + 0.4, 0.38, -L - 0.03);
  trim.push(tint(ex, 0x555555));
  if (s.spoiler) {
    trim.push(box(t.w - 0.3, 0.04, 0.22, 0, trunk + 0.16, -L + 0.18, BLACK));
    for (const sx of [1, -1]) trim.push(box(0.04, 0.15, 0.08, sx * (W - 0.4), trunk + 0.07, -L + 0.2, BLACK));
  }
  // The cabin inside.
  const inside = [];
  {
    // (the inside of the sides behind the doors: the rear door cards, a speaker)
    const P = palette(s.inside);
    const z0 = rearBase * k + 0.08;
    const z1 = bZ - 0.03;
    for (const sx of [1, -1]) {
      inside.push(box(0.012, belt - fl - 0.08, z1 - z0, sx * (wallX - 0.033), (belt + fl) / 2, (z0 + z1) / 2, P.dash));
      inside.push(box(0.012, 0.16, (z1 - z0) * 0.7, sx * (wallX - 0.036), belt - 0.18, (z0 + z1) / 2, P.insert));
      if (s.doors4) inside.push(box(0.05, 0.05, 0.3, sx * (wallX - 0.06), belt - 0.33, (z0 + z1) / 2 + 0.1, P.dash2)); // (an armrest)
    }
  }
  inside.push(...cabin({ hwIn: hwB - 0.06, belt, dashZ: wsBase * k - 0.15, seatZ: s.seatZ * k, rearZ: s.doors4 ? s.rearSeatZ * k : undefined, driverX: 0.38, color: s.inside, seats: s.doors4 ? 4 : 2, floor: s.floor ?? 0.42, sh: s.seatH ?? 1, roof, wsTop: roofF * k }));
  return {
    paint, glass, trim, inside, green, hwG, hwBody, belt, roof, insideColor: s.inside,
    door: { hinge: wsBase * k - 0.05, len: wsBase * k - 0.05 - bZ, bottom: 0.4, top: belt, x: hwBody(belt - 0.2) + 0.01 },
    wheels: { z: [wz, -wz], x: W - 0.12, r: 0.36, w: 0.24 },
    lights: { head: [[W - 0.32, noseY + 0.03, L + 0.01]], tail: [[W - 0.3, trunk - 0.14, -L - 0.03]] },
    seat: { x: 0.38, y: (s.floor ?? 0.42) + 0.2, floor: s.floor ?? 0.42, z: s.seatZ * k, wheelZ: wsBase * k - 0.57, lean: s.seatH ? 0.58 : 0.08 },
  };
}

const SEDAN = { hood: 0.88, belt: 1.0, roof: 1.47, trunk: 1.02, wsBase: 0.95, roofF: 0.2, roofR: -0.78, rearBase: -1.35, bPillar: -0.25, seatZ: -0.35, rearSeatZ: -1.15, doors4: true, inside: 0x3a3b3e };

// A one-box van (van, the SWAT truck): a short hood, a glass cab up front, a solid cargo body.
function van(t, s) {
  const L = t.l / 2;
  const W = t.w / 2;
  const fz = L - 0.95;
  const rz = -L + 1.0;
  const y0 = 0.36;
  const { belt, roof, hood, wsTop, cabBack } = s;
  const arches = [[fz, 0.5, 0.42], [rz, 0.5, 0.42]];
  const prof = [...sill(L, y0, arches), [L, 0.5], [L + 0.02, hood - 0.25], [L - 0.15, hood], [L - 0.65, belt], [L - 0.7, 0.53], [cabBack + 0.02, 0.53], [cabBack, belt], [-L, belt], [-L - 0.02, 0.5]];
  const hwBody = (y) => W - 0.02 - 0.05 * THREE.MathUtils.smoothstep(y, belt - 0.2, belt);
  const hwB = W - 0.08;
  const hwR = W - 0.14;
  const hwG = (y) => hwB + (hwR - hwB) * THREE.MathUtils.clamp((y - belt) / (roof - belt), 0, 1);
  const green = [[L - 0.65, belt], [wsTop, roof], [cabBack, roof], [cabBack, belt]];
  const paint = [loft(prof, hwBody)];
  // (the cargo body behind the cab, and the roof over everything)
  paint.push(loft([[cabBack, belt - 0.01], [cabBack, roof], [-L + 0.04, roof], [-L, roof - 0.06], [-L, belt - 0.01]], (y) => hwG(y) + 0.01));
  paint.push(loft([[wsTop + 0.06, roof - 0.04], [wsTop - 0.02, roof + 0.04], [-L + 0.06, roof + 0.04], [-L + 0.02, roof - 0.04]], hwR + 0.02));
  for (const sx of [1, -1]) paint.push(bar([sx * hwB, belt, L - 0.65], [sx * hwR, roof, wsTop], 0.08, 0, 0.1));
  const glass = [loft(green, hwG, { caps: false, band: true })];
  const trim = [];
  trim.push(box(t.w, 0.24, 0.16, 0, 0.5, L, s.bumper ?? DARK));
  trim.push(box(t.w, 0.24, 0.16, 0, 0.5, -L, s.bumper ?? DARK));
  trim.push(box(t.w * 0.5, 0.2, 0.05, 0, hood - 0.12, L + 0.03, 0x101114));
  trim.push(box(0.52, 0.12, 0.02, 0, 0.5, L + 0.09, PLATE));
  trim.push(box(0.52, 0.12, 0.02, 0, 0.62, -L - 0.03, PLATE));
  trim.push(box(0.02, roof - 0.7, 0.02, 0, (roof + 0.7) / 2, -L - 0.01, BLACK)); // (the rear doors' seam)
  for (const sx of [1, -1]) {
    trim.push(box(0.18, 0.2, 0.08, sx * (W + 0.1), belt + 0.18, L - 0.75, BLACK)); // (mirror)
    trim.push(box(0.03, 0.03, L - 0.65 - cabBack, sx * (hwB + 0.02), belt, (L - 0.65 + cabBack) / 2, BLACK));
  }
  if (s.extra) trim.push(...s.extra(t));
  // (inside: the cab, and a wall behind it)
  const inside = [];
  inside.push(...cabin({ hwIn: hwB - 0.08, belt, dashZ: L - 0.8, seatZ: cabBack + 0.55, driverX: 0.45, color: s.inside, seats: 2, floor: 0.55, wheelY: belt + 0.02, roof, wsTop }));
  inside.push(box(hwB * 2 - 0.1, roof - 0.55, 0.05, 0, (roof + 0.55) / 2, cabBack + 0.03, DARK));
  return {
    paint, glass, trim, inside, green, hwG, hwBody, belt, roof,
    door: { hinge: L - 0.7, len: L - 0.7 - cabBack - 0.05, bottom: 0.45, top: belt, x: W - 0.01 },
    wheels: { z: [fz, rz], x: W - 0.12, r: 0.4, w: 0.26 },
    lights: { head: [[W - 0.3, hood - 0.18, L + 0.02]], tail: [[W - 0.12, belt - 0.2, -L - 0.03]] },
    insideColor: s.inside,
    seat: { x: 0.45, y: 0.75, floor: 0.55, z: cabBack + 0.55, wheelZ: L - 1.22 },
  };
}

// A box truck: a cab with its own hood, then the box (3.35 m tall, like a real 16-26 ft box).
const BOX_TOP = 3.35;
function truck(t) {
  const L = t.l / 2;
  const W = t.w / 2;
  const fz = L - 0.95;
  const rz = -L + 1.4;
  const belt = 1.3;
  const roof = 2.35;
  const cabBack = L - 2.1;
  const hwBody = (y) => W - 0.05 - 0.06 * THREE.MathUtils.smoothstep(y, belt - 0.2, belt);
  const hwB = W - 0.12;
  const hwR = W - 0.2;
  const hwG = (y) => hwB + (hwR - hwB) * THREE.MathUtils.clamp((y - belt) / (roof - belt), 0, 1);
  const prof = [[cabBack, 0.45], [fz - 0.5, 0.45], ...sill(L, 0.45, [[fz, 0.52, 0.42]]).slice(-9), [L, 0.6], [L + 0.02, 1.05], [L - 0.12, belt], [L - 0.22, 0.58], [cabBack, 0.58]];
  const green = [[L - 0.15, belt], [L - 0.45, roof], [cabBack + 0.1, roof], [cabBack + 0.1, belt]];
  const paint = [loft(prof, hwBody)];
  paint.push(loft([[L - 0.4, roof - 0.04], [L - 0.46, roof + 0.05], [cabBack + 0.05, roof + 0.05], [cabBack + 0.05, roof - 0.04]], hwR + 0.02));
  for (const sx of [1, -1]) paint.push(bar([sx * hwB, belt, L - 0.15], [sx * hwR, roof, L - 0.45], 0.08, 0, 0.1));
  // (the box)
  const box0 = cabBack - 0.15;
  paint.push(loft([[box0, 0.75], [box0, BOX_TOP], [-L, BOX_TOP], [-L, 0.75]], W));
  const glass = [loft(green, hwG, { caps: false })];
  const trim = [];
  trim.push(box(1.0, 0.2, Math.abs(box0 - 0.1 - -L), 0, 0.6, (box0 - 0.1 - L) / 2, BLACK)); // (the frame under the box)
  trim.push(box(t.w, 0.28, 0.18, 0, 0.62, L, DARK));
  trim.push(box(t.w, 0.12, 0.12, 0, 0.7, -L - 0.05, DARK));
  trim.push(box(t.w * 0.6, 0.3, 0.05, 0, 0.88, L + 0.03, 0x101114));
  trim.push(box(0.52, 0.12, 0.02, 0, 0.62, L + 0.1, PLATE));
  trim.push(box(0.03, BOX_TOP - 0.8, 0.03, 0, (BOX_TOP + 0.8) / 2, -L - 0.02, BLACK));
  for (const sx of [1, -1]) {
    trim.push(box(0.1, 0.32, 0.1, sx * (W + 0.18), belt + 0.3, L - 0.35, BLACK));
    // (the rear wheels' fenders)
    trim.push(box(0.3, 0.06, 1.1, sx * (W - 0.15), 0.98, rz, BLACK));
  }
  const inside = [];
  inside.push(...cabin({ hwIn: hwB - 0.08, belt, dashZ: L - 0.35, seatZ: cabBack + 0.55, driverX: 0.5, color: 0x3a3b3e, seats: 2, floor: 0.6, wheelY: belt + 0.02, roof, wsTop: L - 0.45 }));
  inside.push(box(hwB * 2, roof - 0.6, 0.05, 0, (roof + 0.6) / 2, cabBack + 0.12, DARK));
  return {
    paint, glass, trim, inside, green, hwG, hwBody, belt, roof: BOX_TOP,
    door: { hinge: L - 0.2, len: L - 0.25 - cabBack, bottom: 0.5, top: belt, x: W - 0.03 },
    wheels: { z: [fz, rz], x: W - 0.14, r: 0.45, w: 0.28 },
    lights: { head: [[W - 0.28, 0.98, L + 0.03]], tail: [[W - 0.15, 0.85, -L - 0.03]] },
    insideColor: 0x3a3b3e,
    seat: { x: 0.5, y: 0.8, floor: 0.6, z: cabBack + 0.55, wheelZ: L - 0.77 },
  };
}

const BUS_SEAT = palette(0x2b4a7a);

// A city bus: low floor, a glass band all round, rows of seats inside.
function bus(t) {
  const L = t.l / 2;
  const W = t.w / 2;
  const fz = L - 2.3;
  const rz = -L + 2.7;
  const belt = 1.25;
  const roof = 2.85; // (3.15 m over the roof cap: a city bus)
  const prof = [...sill(L, 0.32, [[fz, 0.58, 0.48], [rz, 0.58, 0.48]]), [L, 0.45], [L + 0.02, belt], [-L - 0.02, belt], [-L, 0.45]];
  const hw = W - 0.03;
  const paint = [loft(prof, hw)];
  paint.push(loft([[L - 0.05, roof], [L - 0.15, roof + 0.3], [-L + 0.15, roof + 0.3], [-L + 0.05, roof]], hw));
  const green = [[L + 0.02, belt], [L - 0.05, roof], [-L + 0.05, roof], [-L - 0.02, belt]];
  const glass = [loft(green, hw - 0.03, { caps: false })];
  for (const sx of [1, -1]) glass.push(sidePane(green, () => hw - 0.03, sx));
  const trim = [];
  // (pillars down the sides, the roof white, the destination sign, bumpers)
  for (let z = -L + 0.1; z <= L - 0.4; z += 1.15) for (const sx of [1, -1]) trim.push(box(0.04, roof - belt, 0.14, sx * (hw - 0.01), (roof + belt) / 2, z, BLACK));
  for (const sx of [1, -1]) trim.push(box(0.04, 0.14, t.l, sx * (hw - 0.01), roof - 0.07, 0, BLACK));
  trim.push(box(t.w - 0.2, 0.06, t.l - 0.4, 0, roof + 0.33, 0, 0xe8e8e8));
  trim.push(box(1.7, 0.26, 0.04, 0, roof - 0.17, L + 0.01, 0xffb020));
  trim.push(box(t.w, 0.3, 0.16, 0, 0.5, L + 0.02, DARK));
  trim.push(box(t.w, 0.3, 0.16, 0, 0.5, -L - 0.02, DARK));
  trim.push(box(0.04, 1.9, 0.9, -hw - 0.005, 1.3, L - 1.1, BLACK)); // (the doors on the curb side)
  trim.push(box(0.04, 1.9, 0.9, -hw - 0.005, 1.3, -0.4, BLACK));
  // (inside: the floor, the driver up front on the left, rows of pairs down both sides, poles)
  const inside = [];
  inside.push(box(t.w - 0.1, 0.1, t.l - 0.3, 0, 0.6, 0, DARK));
  inside.push(...cabin({ hwIn: 0.5, belt, dashZ: L - 0.45, seatZ: L - 1.2, driverX: 0.75, color: 0x2b3440, seats: 1, floor: 0.65, wheelY: belt - 0.05, roof, wsTop: L - 0.1 }));
  inside.push(box(t.w - 0.12, 0.03, t.l - 0.4, 0, roof - 0.02, 0, 0xd8d4c8)); // (the ceiling, a light strip down it)
  inside.push(box(0.12, 0.012, t.l - 1.2, 0, roof - 0.04, 0, 0xfff4d6));
  for (let z = L - 2.2; z > -L + 0.6; z -= 0.9) {
    if (z < fz + 0.6 && z > fz - 0.6) continue;
    for (const x of [0.85, 0.4, -0.4, -0.85]) {
      if (x < 0 && Math.abs(z - (L - 1.1)) < 0.6) continue;
      inside.push(...seat(x, 1.05, z, BUS_SEAT, { w: 0.42 }));
    }
  }
  for (let z = L - 1.8; z > -L + 1; z -= 2.2) inside.push(box(0.04, roof - 0.7, 0.04, 0.12, (roof + 0.7) / 2, z, CHROME));
  return {
    paint, glass, trim, inside, green, hwG: () => hw, hwBody: () => hw, belt, roof: roof + 0.3,
    door: null,
    wheels: { z: [fz, rz], x: W - 0.16, r: 0.5, w: 0.3 },
    lights: { head: [[W - 0.3, 0.75, L + 0.03]], tail: [[W - 0.2, 0.9, -L - 0.03]] },
    seat: { x: 0.75, y: 0.85, floor: 0.65, z: L - 1.2, wheelZ: L - 0.87 },
  };
}

const SPECS = {
  sedan: (t) => car(t, SEDAN),
  police: (t) => car(t, { ...SEDAN, inside: 0x1e1f22, bumper: 0x111111, grille: 0x050505 }),
  taxi: (t) => {
    const m = car(t, { ...SEDAN, inside: 0x6b5a45 });
    // (the roof sign and a checker band)
    m.trim.push(box(0.9, 0.3, 0.35, 0, m.roof + 0.17, -0.2 * (t.l / 4.4), 0xfff0b0));
    for (const sx of [1, -1]) for (let i = 0; i < 12; i++) m.trim.push(box(0.02, 0.07, 0.14, sx * (t.w / 2 - 0.03), 0.8 + (i % 2) * 0.07, -1.0 + i * 0.16, 0x111111));
    return m;
  },
  sports: (t) => car(t, { hood: 0.72, belt: 0.86, roof: 1.3, trunk: 0.9, wsBase: 0.62, roofF: -0.08, roofR: -0.62, rearBase: -1.5, bPillar: -0.62, seatZ: -0.5, noseY: 0.55, doors4: false, floor: 0.36, seatH: 0.72, inside: 0x1a1a1a, spoiler: true, mirror: 0x111111 }),
  van: (t) => van(t, { belt: 1.25, roof: 2.18, hood: 1.05, wsTop: 1.25, cabBack: 0.3, inside: 0x3a3b3e }),
  swat: (t) => van(t, {
    belt: 1.3, roof: 2.5, hood: 1.15, wsTop: 1.75, cabBack: 0.7, inside: 0x1b1d20, bumper: 0x0c0c0c,
    extra: (tt) => [box(tt.w + 0.04, 0.12, tt.l - 1.2, 0, 0.9, -0.4, 0x0c0c0c), box(tt.w * 0.7, 0.12, 0.12, 0, 0.75, tt.l / 2 + 0.12, 0x0c0c0c)],
  }),
  delivery: truck,
  bus,
};

// The wheel: a tire, a rim each side, a hub (its axle across x).
const wheelCache = new Map();
function wheelGeometry(r, w) {
  const key = `${r}|${w}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const parts = [];
  const tire = new THREE.CylinderGeometry(r, r, w, 16);
  parts.push(tint(tire, TIRE));
  for (const s of [1, -1]) {
    const rim = new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.02, 14);
    rim.translate(0, (s * w) / 2, 0);
    parts.push(tint(rim, RIM));
    const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.04, 8);
    hub.translate(0, (s * w) / 2 + s * 0.015, 0);
    parts.push(tint(hub, 0x8a8f95));
    // (spokes, so you see it turn)
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.BoxGeometry(r * 0.12, 0.025, r * 0.55);
      sp.translate(0, 0, r * 0.32);
      sp.rotateY((k / 5) * Math.PI * 2);
      sp.translate(0, (s * w) / 2 + s * 0.01, 0);
      parts.push(tint(sp, 0x9ea4aa));
    }
  }
  const g = merge(parts);
  g.rotateZ(Math.PI / 2);
  wheelCache.set(key, g);
  return g;
}

// A seated driver (hands on the wheel), painted in their colors: skin, shirt, pants.
const driverCache = new Map();
export function driverGeometry(look, seatAt, wheelZ) {
  const key = `${look.skin}|${look.shirt}|${look.pants}|${look.hair}|${seatAt.x}|${seatAt.y}|${seatAt.z}|${seatAt.floor}|${wheelZ}`;
  if (driverCache.has(key)) return driverCache.get(key);
  const { x, y, z, lean = 0 } = seatAt;
  // (the upper body, leaned back about the hips: low cars lay you back)
  const up = [];
  up.push(box(0.4, 0.44, 0.24, x, y + 0.28, z - 0.08, look.shirt, -0.15)); // (the chest)
  up.push(box(0.18, 0.07, 0.18, x, y + 0.52, z - 0.06, look.skin)); // (the neck)
  up.push(box(0.2, 0.22, 0.22, x, y + 0.64, z - 0.04, look.skin)); // (the head)
  if (look.hair !== undefined) up.push(box(0.21, 0.06, 0.23, x, y + 0.76, z - 0.05, look.hair));
  const tilt = (g) => g.translate(0, -y, -z).rotateX(-lean).translate(0, y, z);
  const parts = up.map(tilt);
  const shoulder = new THREE.Vector3(0, 0.45, -0.05).applyAxisAngle(new THREE.Vector3(1, 0, 0), -lean);
  // (the thighs forward along the seat, the shins down and forward to the pedals, the feet
  // flat on the floor: never through it)
  const floor = seatAt.floor ?? y - 0.2;
  const knee = [z + 0.42, y + 0.05];
  const foot = floor + 0.07;
  const drop = knee[1] - foot;
  const reach = Math.sqrt(Math.max(0.01, 0.42 * 0.42 - drop * drop));
  for (const s of [1, -1]) {
    const lx = x + s * 0.11;
    parts.push(bar([lx, y + 0.06, z - 0.02], [lx, knee[1], knee[0]], 0.15, look.pants, 0.15));
    parts.push(bar([lx, knee[1], knee[0]], [lx, foot + 0.02, knee[0] + reach], 0.12, look.pants, 0.13));
    parts.push(box(0.11, 0.08, 0.24, lx, foot, knee[0] + reach + 0.06, look.shoes ?? 0x141414)); // (the shoe)
  }
  // (the arms out to the wheel, the hands on it)
  for (const s of [1, -1]) parts.push(bar([x + s * 0.22, y + shoulder.y, z + shoulder.z], [x + s * 0.15, y + 0.42, wheelZ + 0.05], 0.09, look.shirt));
  for (const s of [1, -1]) parts.push(box(0.08, 0.08, 0.08, x + s * 0.15, y + 0.42, wheelZ + 0.08, look.skin));
  const g = merge(parts);
  driverCache.set(key, g);
  return g;
}

// A type's model (built the first time it's asked for).
const cache = new Map();
export function carModel(typeName, t) {
  if (cache.has(typeName)) return cache.get(typeName);
  const s = (SPECS[typeName] || SPECS.sedan)(t);
  const m = {
    paint: merge(s.paint.map((g) => {
      g = g.index ? g.toNonIndexed() : g;
      if (g.attributes.color) g.deleteAttribute('color');
      return g;
    })),
    trim: merge(s.trim),
    inside: merge(s.inside),
    glass: merge(s.glass),
    belt: s.belt,
    roof: s.roof,
    wheels: s.wheels,
    wheel: wheelGeometry(s.wheels.r, s.wheels.w),
    lights: s.lights,
    seat: s.seat,
    green: s.green, // (the cabin's side outline, [z, y] front to back: the windshield, the roof, the back)
    roofHw: s.hwG ? s.hwG(99) : t.w / 2, // (half the width across the top of the door openings)
    door: null,
  };
  // The doors: a panel (the body's color) from the hinge back, its window above it (the
  // greenhouse's side, between the door's ends). Built at the hinge (vehicle.js hangs it there),
  // for the left side (+x); the right one is mirrored.
  if (s.door) {
    const D = s.door;
    m.door = { hinge: D.hinge, len: D.len, x: D.x, panel: {}, glass: {} };
    for (const sx of [1, -1]) {
      const panel = new THREE.BoxGeometry(0.05, D.top - D.bottom, D.len);
      panel.translate(0, (D.top + D.bottom) / 2, -D.len / 2);
      const pane = sidePane(clipZ(s.green, D.hinge - D.len, D.hinge), s.hwG, sx);
      if (pane) pane.translate(-sx * D.x, 0, -D.hinge);
      m.door.panel[sx] = merge([panel]);
      m.door.trim = m.door.trim || {};
      m.door.trim[sx] = doorCard(D, sx, s.insideColor ?? 0x3a3b3e);
      m.door.glass[sx] = pane ? merge([pane]) : null;
    }
  }
  // The far-off stand-in (parking.js): everything but the paint in one piece, the glass dark
  // and solid, the wheels in place.
  const darkGlass = m.glass && tint(m.glass.clone(), 0x1d2630);
  const wheels = [];
  const plain = tint(new THREE.CylinderGeometry(s.wheels.r, s.wheels.r, s.wheels.w, 10).rotateZ(Math.PI / 2), TIRE);
  for (const sx of [1, -1]) for (const z of s.wheels.z) wheels.push(plain.clone().translate(sx * s.wheels.x, s.wheels.r, z));
  const doorPanels = [];
  if (m.door) {
    for (const sx of [1, -1]) {
      const p = m.door.panel[sx].clone().translate(sx * m.door.x, 0, m.door.hinge);
      doorPanels.push(p);
      if (m.door.glass[sx]) doorPanels.push(tint(m.door.glass[sx].clone().translate(sx * m.door.x, 0, m.door.hinge), 0x1d2630));
    }
  }
  m.standin = { paint: merge([m.paint.clone(), ...doorPanels.filter((g) => !g.attributes.color)]), rest: merge([...s.trim.map((g) => g.clone()), darkGlass, ...wheels, ...doorPanels.filter((g) => g.attributes.color)]) };
  cache.set(typeName, m);
  return m;
}

// The shared materials.
export const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const glassMat = new THREE.MeshPhongMaterial({ color: 0x1b2a38, specular: 0x8899aa, shininess: 80, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
export const wheelMat = trimMat;
// The inside: lit a little from within (a cabin in the sun's shade would be black), no shadows.
export const insideMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const insideK = { value: 0.55 };
insideMat.onBeforeCompile = (sh) => {
  sh.uniforms.insideK = insideK;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float insideK;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * insideK;');
};
// (after dark, less: night 0..1, from vehicle.js setCarNight)
export function setInsideNight(n) {
  insideK.value = 0.55 * (1 - n) + 0.1;
}
insideMat.customProgramCacheKey = () => 'carinside1';
