import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';
import { chainTexture } from './court.js';

// Harbor Field: a football field on the ramp land beside the east freeway at the Docks, between
// the road along the freeway and the on-ramp. Full length (100 yards and two end zones), but
// narrower than a regulation field (27 m, not 49): that's all the room the ramp leaves.
// Goalposts at both ends, bleachers behind the south end zone, a scoreboard behind the north
// one, and lights down the west side that come on at night. A chain-link fence round the lot of
// it, set back from the street, with a gate to the parking lot and one onto the street.
const YD = 0.9144;
const F = { x0: 1204, x1: 1231, z0: 940 }; // the field, end line to end line along z
F.z1 = F.z0 + 120 * YD;
F.cx = (F.x0 + F.x1) / 2;
const EZ = 10 * YD; // end zone depth
const GOAL0 = F.z0 + EZ; // north goal line
const GOAL1 = F.z1 - EZ;
const BLEACH = { x0: 1206, x1: 1229, z0: F.z1 + 5, rows: 5, depth: 0.85, rise: 0.45 };
const BOARD = { x: 1212, z: F.z0 - 6 };
// The fence (west side about 4 m back from the street; east side clear of the on-ramp).
const FENCE = { x0: 1202, x1: 1233, z0: 931, z1: 1060, h: 2.4 };
const GATE_S = [1213, 1217]; // onto the path from the lot (x)
const GATE_W = [1014, 1019]; // onto the street (z)
// The lot south of the bleachers: an aisle in line with Freight Way (which meets the road
// alongside here), a row of spaces either side.
const LOT = { x0: 1199, x1: 1237, z0: 1061, z1: 1080 };
const LOT_AISLE = [1067, 1074];
const LOT_X0 = 1200.5;
const STALL_W = 2.7;
const STALLS = 13; // per row

export const FIELD_SITE = { name: 'Harbor Field', x: F.cx, z: (F.z0 + F.z1) / 2, field: F };
export const FIELD_RESERVED = [[FENCE.x0 - 2, FENCE.z0 - 2, FENCE.x1 + 1, FENCE.z1 + 1], [LOT.x0 - 1, LOT.z0 - 1, LOT.x1 + 1, LOT.z1 + 1]];
export const FIELD_BLEACHERS = BLEACH;

const box = (w, h, d, x, y, z) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const flat = (x0, z0, x1, z1, y) => {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
};

// The paint: mowing stripes, end zones, yard lines, hash marks and numbers.
function fieldTexture() {
  const M = 1.8; // a little grass round the outside (meters, inside the fence)
  const S = 14; // pixels per meter
  const W = F.x1 - F.x0 + M * 2;
  const L = F.z1 - F.z0 + M * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * S);
  cv.height = Math.round(L * S);
  const c = cv.getContext('2d');
  const X = (x) => (x - F.x0 + M) * S;
  const Z = (z) => (z - F.z0 + M) * S;
  c.fillStyle = '#3f7a3a';
  c.fillRect(0, 0, cv.width, cv.height);
  // Mowing stripes every 5 yards.
  for (let k = 0; k < 24; k++) {
    c.fillStyle = k % 2 ? '#4a8a42' : '#427f3b';
    c.fillRect(X(F.x0), Z(F.z0 + k * 5 * YD), (F.x1 - F.x0) * S, 5 * YD * S + 1);
  }
  // End zones.
  for (const [z0, z1, col, word] of [[F.z0, GOAL0, '#1f6b3a', 'HARBOR'], [GOAL1, F.z1, '#22416e', 'DOCKS']]) {
    c.fillStyle = col;
    c.fillRect(X(F.x0), Z(z0), (F.x1 - F.x0) * S, (z1 - z0) * S);
    c.save();
    c.translate(X(F.cx), Z((z0 + z1) / 2));
    c.rotate(z0 === F.z0 ? Math.PI : 0);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = `bold ${Math.round(5.5 * S)}px Arial Black, Arial`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(word, 0, 0, (F.x1 - F.x0 - 3) * S);
    c.restore();
  }
  c.strokeStyle = '#f6f6f2';
  c.fillStyle = '#f6f6f2';
  // Boundary.
  c.lineWidth = 0.3 * S;
  c.strokeRect(X(F.x0), Z(F.z0), (F.x1 - F.x0) * S, (F.z1 - F.z0) * S);
  // Yard lines every 5, hash marks every yard (along both sidelines and the two hash rows).
  const hashX = [F.x0 + 0.6, F.cx - 3, F.cx + 3, F.x1 - 0.6];
  for (let yd = 0; yd <= 100; yd++) {
    const z = GOAL0 + yd * YD;
    if (yd % 5 === 0) {
      c.lineWidth = (yd === 0 || yd === 100 ? 0.25 : 0.12) * S;
      c.beginPath();
      c.moveTo(X(F.x0), Z(z));
      c.lineTo(X(F.x1), Z(z));
      c.stroke();
    } else {
      c.lineWidth = 0.1 * S;
      for (const hx of hashX) {
        c.beginPath();
        c.moveTo(X(hx - 0.3), Z(z));
        c.lineTo(X(hx + 0.3), Z(z));
        c.stroke();
      }
    }
    // Numbers every 10 yards, near each sideline, reading from that side.
    if (yd % 10 === 0 && yd > 0 && yd < 100) {
      const n = String(yd <= 50 ? yd : 100 - yd);
      c.font = `bold ${Math.round(1.8 * S)}px Arial`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const [x, rot] of [[F.x0 + 4, Math.PI / 2], [F.x1 - 4, -Math.PI / 2]]) {
        c.save();
        c.translate(X(x), Z(z));
        c.rotate(rot);
        c.fillText(n, 0, 0);
        c.restore();
      }
    }
  }
  // A logo at midfield.
  c.beginPath();
  c.arc(X(F.cx), Z(GOAL0 + 50 * YD), 3 * S, 0, Math.PI * 2);
  c.fillStyle = '#c9a227';
  c.fill();
  c.fillStyle = '#1b2b45';
  c.font = `bold ${Math.round(2.2 * S)}px Arial Black, Arial`;
  c.fillText('H', X(F.cx), Z(GOAL0 + 50 * YD) + 0.1 * S);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return { tex, M };
}

function scoreTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 112;
  const c = cv.getContext('2d');
  c.fillStyle = '#14181d';
  c.fillRect(0, 0, 256, 112);
  c.fillStyle = '#c9a227';
  c.font = 'bold 18px Arial';
  c.textAlign = 'center';
  c.fillText('HARBOR FIELD', 128, 22);
  c.fillStyle = '#fff';
  c.font = 'bold 14px Arial';
  c.fillText('HOME', 64, 48);
  c.fillText('GUEST', 192, 48);
  c.fillStyle = '#ff4d3a';
  c.font = 'bold 34px Courier New, monospace';
  c.fillText('00', 64, 88);
  c.fillText('00', 192, 88);
  c.fillStyle = '#f5c542';
  c.font = 'bold 16px Courier New, monospace';
  c.fillText('QTR 1', 128, 92);
  return new THREE.CanvasTexture(cv);
}

export function buildField(city, scene) {
  const steel = [];
  const alu = [];
  const yellow = [];
  const dark = [];
  // ---- The field ----
  const { tex, M } = fieldTexture();
  const turf = new THREE.Mesh(flat(F.x0 - M, F.z0 - M, F.x1 + M, F.z1 + M, 0.04), new THREE.MeshLambertMaterial({ map: tex }));
  turf.receiveShadow = true;
  scene.add(turf);

  // Goalposts: a post behind the end line, bent forward over it, crossbar and two uprights.
  for (const [line, dir] of [[F.z0, -1], [F.z1, 1]]) {
    const pz = line + dir * 1.8;
    yellow.push(box(0.25, 3.05, 0.25, F.cx, 1.52, pz));
    yellow.push(box(0.2, 0.2, Math.abs(pz - line), F.cx, 2.95, (pz + line) / 2));
    yellow.push(box(5.64, 0.18, 0.18, F.cx, 3.05, line));
    for (const s of [-1, 1]) yellow.push(box(0.14, 6.2, 0.14, F.cx + s * 2.82, 3.05 + 3.1, line));
    city.colliders.push({ minX: F.cx - 0.2, maxX: F.cx + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2, h: 3 });
  }

  // Bleachers behind the south end zone, facing the field.
  const B = BLEACH;
  for (let r = 0; r < B.rows; r++) {
    const z = B.z0 + (r + 0.5) * B.depth;
    const y = 0.45 + r * B.rise;
    alu.push(box(B.x1 - B.x0, 0.06, 0.35, (B.x0 + B.x1) / 2, y, z)); // seat
    alu.push(box(B.x1 - B.x0, 0.04, B.depth - 0.35, (B.x0 + B.x1) / 2, y - 0.25, z + 0.18)); // footboard
  }
  const topY = 0.45 + (B.rows - 1) * B.rise;
  const back = B.z0 + B.rows * B.depth;
  for (let x = B.x0; x <= B.x1 + 0.01; x += (B.x1 - B.x0) / 5) {
    steel.push(box(0.1, topY, 0.1, x, topY / 2, back));
    // (a slanted stringer under the seats)
    const g = new THREE.BoxGeometry(0.08, 0.08, Math.hypot(B.rows * B.depth, topY));
    g.rotateX(Math.atan2(topY, B.rows * B.depth));
    g.translate(x, topY / 2, B.z0 + (B.rows * B.depth) / 2);
    steel.push(g);
  }
  steel.push(box(B.x1 - B.x0, 0.06, 0.06, (B.x0 + B.x1) / 2, topY + 1, back)); // back rail
  for (let x = B.x0; x <= B.x1 + 0.01; x += (B.x1 - B.x0) / 5) steel.push(box(0.06, 1, 0.06, x, topY + 0.5, back));
  city.colliders.push({ minX: B.x0, maxX: B.x1, minZ: B.z0 + 0.2, maxZ: back, h: topY + 1 });

  // Scoreboard behind the north end zone (facing south, over the field).
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), new THREE.MeshBasicMaterial({ map: scoreTexture() }));
  sb.position.set(BOARD.x, 5.3, BOARD.z + 0.16);
  scene.add(sb);
  dark.push(box(6.4, 3, 0.3, BOARD.x, 5.3, BOARD.z));
  for (const s of [-1, 1]) steel.push(box(0.25, 4, 0.25, BOARD.x + s * 2.4, 2, BOARD.z));
  city.colliders.push({ minX: BOARD.x - 3.2, maxX: BOARD.x + 3.2, minZ: BOARD.z - 0.3, maxZ: BOARD.z + 0.3, h: 6.8 });

  // Light towers down the west side, aimed across the field.
  const heads = [];
  for (const z of [F.z0 + 12, (F.z0 + F.z1) / 2, F.z1 - 12]) {
    const x = FENCE.x0 + 0.9; // (just inside the fence)
    steel.push(box(0.3, 13, 0.3, x, 6.5, z));
    heads.push(box(0.5, 1.4, 3, x + 0.3, 13, z));
    city.colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, h: 13 });
  }

  // ---- The lot ----
  const asphalt = [flat(LOT.x0, LOT.z0, LOT.x1, LOT.z1, 0.035)];
  const paint = [];
  const white = [];
  const spots = [];
  for (const [z0, z1, heading] of [[LOT.z0 + 0.5, LOT_AISLE[0], Math.PI], [LOT_AISLE[1], LOT.z1 - 0.5, 0]]) {
    const head = heading ? z0 : z1; // (the nose end of the spaces)
    for (let k = 0; k <= STALLS; k++) paint.push(box(0.12, 0.01, z1 - z0, LOT_X0 + k * STALL_W, 0.045, (z0 + z1) / 2));
    paint.push(box(STALLS * STALL_W, 0.01, 0.12, LOT_X0 + (STALLS * STALL_W) / 2, 0.045, head));
    for (let k = 0; k < STALLS; k++) {
      const x = LOT_X0 + (k + 0.5) * STALL_W;
      white.push(box(1.6, 0.12, 0.2, x, 0.095, head + (heading ? 0.6 : -0.6)));
      spots.push({ x, z: (z0 + z1) / 2 + (heading ? -0.3 : 0.3), heading });
    }
  }
  // (a path from the lot through the gate to the bleachers)
  asphalt.push(flat(GATE_S[0] + 0.5, back, GATE_S[1] - 0.5, LOT.z0, 0.04));

  // ---- The fence ----
  const chain = chainTexture();
  const { x0, x1, z0, z1, h } = FENCE;
  const runs = [
    [[x0, z0], [x1, z0]],
    [[x1, z0], [x1, z1]],
    [[x1, z1], [GATE_S[1], z1]],
    [[GATE_S[0], z1], [x0, z1]],
    [[x0, z1], [x0, GATE_W[1]]],
    [[x0, GATE_W[0]], [x0, z0]],
  ];
  for (const [[ax, az], [bx, bz]] of runs) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 3));
    for (let k = 0; k <= n; k++) steel.push(box(0.08, h, 0.08, ax + ((bx - ax) * k) / n, h / 2, az + ((bz - az) * k) / n));
    const along = ax === bx;
    steel.push(box(along ? 0.06 : L, 0.06, along ? L : 0.06, (ax + bx) / 2, h, (az + bz) / 2));
    const t = chain.clone();
    t.repeat.set(L / 0.6, h / 0.6);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, h), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    m.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
    m.rotation.y = along ? Math.PI / 2 : 0;
    scene.add(m);
    city.colliders.push({ minX: Math.min(ax, bx) - 0.1, maxX: Math.max(ax, bx) + 0.1, minZ: Math.min(az, bz) - 0.1, maxZ: Math.max(az, bz) + 0.1, h });
  }
  // (a path from the street gate across the grass to the sideline)
  asphalt.push(flat(1197, GATE_W[0] + 0.5, x0, GATE_W[1] - 0.5, 0.04));

  const add = (list, mat, shadow = true) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
  };
  add(steel, lam(0x4a5560));
  add(alu, lam(0xb9c0c6));
  add(yellow, lam(0xf2c418));
  add(dark, lam(0x22272d));
  add(asphalt, lam(0x3a3d42), false);
  add(paint, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), false);
  add(white, lam(0xe9e9e4));
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd9d6c8, emissive: 0x000000 });
  add(heads, headMat, false);
  city.windowMats?.push(headMat); // (lit after dark with the windows)
  // A wash of light over the field after dark.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(flat(F.x0 - 2, F.z0 - 2, F.x1 + 2, F.z1 + 2, 0.08), glowMat);
  glow.visible = false;
  scene.add(glow);
  (city.onNight = city.onNight || []).push((k) => {
    glowMat.opacity = 0.13 * k;
    glow.visible = k > 0.02;
  });
  return { field: F, spots, bleachers: BLEACH, goal0: GOAL0, goal1: GOAL1 };
}

// On the 2D maps.
export function drawField(ctx, s) {
  ctx.fillStyle = '#4a8a42';
  ctx.fillRect(F.x0 * s, F.z0 * s, (F.x1 - F.x0) * s, (F.z1 - F.z0) * s);
  ctx.fillStyle = '#1f6b3a';
  ctx.fillRect(F.x0 * s, F.z0 * s, (F.x1 - F.x0) * s, EZ * s);
  ctx.fillStyle = '#22416e';
  ctx.fillRect(F.x0 * s, GOAL1 * s, (F.x1 - F.x0) * s, EZ * s);
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = Math.max(1, s * 0.5);
  ctx.strokeRect(F.x0 * s, F.z0 * s, (F.x1 - F.x0) * s, (F.z1 - F.z0) * s);
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(LOT.x0 * s, LOT.z0 * s, (LOT.x1 - LOT.x0) * s, (LOT.z1 - LOT.z0) * s);
  ctx.strokeStyle = 'rgba(200,205,210,0.8)';
  ctx.lineWidth = Math.max(1, s * 0.3);
  ctx.strokeRect(FENCE.x0 * s, FENCE.z0 * s, (FENCE.x1 - FENCE.x0) * s, (FENCE.z1 - FENCE.z0) * s);
  ctx.fillStyle = '#b9c0c6';
  ctx.fillRect(BLEACH.x0 * s, BLEACH.z0 * s, (BLEACH.x1 - BLEACH.x0) * s, BLEACH.rows * BLEACH.depth * s);
}
