import { CFG } from './config.js';

// Where the highways and their loop ramps go (pure geometry, no 3D). The city builder reads
// this to keep the ramp footprints clear (no buildings, trees or street lights there, and gaps
// in the barrier around the city); highway.js builds the highways from it.
//
// Highways: an elevated ring over the edge roads and a crosstown over 7th Street, 8 m up.
// Interchanges: each has a one-way on-ramp loop and a one-way off-ramp loop, both on the same
// side of the highway, either side of a cross street. On-ramp: turn right off the street,
// circle up 270 degrees and merge with the traffic on that side of the highway. Off-ramp: the
// same thing backwards. The ring's loops are outside the city (over open ground); the
// crosstown's take the corners of four blocks.
const P = CFG.PITCH;
const N = CFG.BLOCKS;
const S = N * P;
const R = CFG.ROAD;
export const DECK_H = 8;
export const HW = R / 2 + 1; // half the deck width (it overhangs the curbs a little)
export const LOOP_R = 18; // loop radius (to the middle of the ramp)
export const RAMP_HW = 4.8; // half a ramp's width (one wide lane plus shoulders)
export const GAP = 20; // from the cross street to where each ramp leaves the street
export const MARGIN = 62; // open ground drawn around the city (the ring's loops are out there)
export const CURB = R / 2;

export const LINES = [
  { axis: 'x', c: 0, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'x', c: S, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'z', c: 0, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'z', c: S, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'x', c: 7 * P, a0: 0, a1: S, name: 'CROSSTOWN' },
];

// [line index, cross street (in blocks along the line), side of the line the loops are on]
const SPOTS = [
  [0, 3, -1], [0, 10, -1], // north ring (loops outside, to the north)
  [1, 4, 1], [1, 11, 1], // south ring
  [2, 4, -1], [2, 11, -1], // west ring
  [3, 3, 1], [3, 10, 1], // east ring
  [4, 6, -1], // crosstown, north side (blocks 5,6 and 6,6)
  [4, 9, 1], // crosstown, south side (blocks 8,7 and 9,7)
];

// Local frame of an interchange: u along the highway, v away from it (on the loops' side).
// Picked so the loops always merge with the traffic on that side (right-hand traffic).
function frame(line, X, side) {
  const rho = line.axis === 'x' ? -side : side;
  return (u, v) => (line.axis === 'x' ? [X + rho * u, line.c + side * v] : [line.c + side * v, X + rho * u]);
}

// Points along a loop, in the local frame, from the street end to the highway end:
// out from the curb, then 270 degrees round, finishing alongside the deck heading -u.
function loopLocal(g) {
  const r = LOOP_R;
  const pts = [];
  const cv = HW + r; // circle center (v)
  for (let v = CURB; v < cv; v += 1.5) pts.push([g, v]);
  const steps = 48;
  for (let k = 0; k <= steps; k++) {
    const a = Math.PI + (k / steps) * 1.5 * Math.PI; // from the (-u) side, round through +v, +u, to -v
    pts.push([g + r + r * Math.cos(a), cv - r * Math.sin(a)]);
  }
  return pts;
}

function build() {
  const out = [];
  for (const [li, k, side] of SPOTS) {
    const line = LINES[li];
    const X = k * P;
    const W = frame(line, X, side);
    for (const kind of ['on', 'off']) {
      // On-ramps are on the +u side of the cross street; off-ramps mirror them on the -u side
      // and run the other way.
      const mir = kind === 'on' ? 1 : -1;
      let local = loopLocal(GAP).map(([u, v]) => [u * mir, v]);
      if (kind === 'off') local = local.reverse();
      const pts = local.map(([u, v]) => W(u, v));
      // Height along the ramp: 0 at the street end, deck height at the highway end.
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = len[len.length - 1];
      const h = len.map((s) => (kind === 'on' ? DECK_H * (s / L) : DECK_H * (1 - s / L)));
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const pad = RAMP_HW + 1;
      const box = { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
      out.push({
        line, X, side, kind, W, pts, h, L, box,
        // Road network hookups (world points): where the ramp meets the street lane, and the
        // highway point it merges at / leaves from.
        street: W(GAP * mir, 0), // (on the middle of the street; traffic keeps to its lane)
        streetNode: W(P * mir, 0), // the next corner along the street (where it comes from / goes to)
        deck: W((GAP + LOOP_R - 16) * mir, 0),
        // The bit of the deck edge the ramp merges along (gap in the guard rail): u range.
        railGap: kind === 'on' ? [GAP + LOOP_R - 2, GAP + LOOP_R + 15] : [-(GAP + LOOP_R + 15), -(GAP + LOOP_R - 2)],
        ring: li < 4,
      });
    }
  }
  return out;
}

export const RAMPS = build();

// Areas to keep clear of buildings, trees and street furniture.
export const RESERVED = RAMPS.map((r) => r.box);
export function reserved(x, z, pad = 0) {
  return RESERVED.some((b) => x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad);
}
export function overlapsReserved(minX, maxX, minZ, maxZ) {
  return RESERVED.some((b) => maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ);
}
