import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';

// Ledger Ave Courts: an outdoor basketball court and a parking lot on the grass beside the
// east freeway, between Ledger Ave, Midway Blvd and Bond St (the land the off-ramp crosses).
// - The lot: two rows of nose-in spaces either side of an aisle that carries on from the road
//   coming up from Bond St, out to Midway Blvd. Parked cars fill some of the spaces
//   (parking.js picks them up from `spots`).
// - The court: full size, painted, a hoop at each end, a chain-link fence with a gate on the
//   lot side, benches, and four light poles that come on at night.
// Everything here is axis-aligned (the streets around it run north-south and east-west).
const LOT = { x0: 1179, x1: 1199, z0: 700, z1: 760.5 };
const AISLE = { x0: 1185, x1: 1193 }; // (in line with the road from Bond St)
const STALL_W = 2.7;
const STALL_Z0 = 703;
const STALLS = 20; // per row
const COURT = { cx: 1217, cz: 731, w: 15.24, l: 28.65 }; // play area (meters), long side north-south
const PAD = { x0: 1205, x1: 1229, z0: 711, z1: 751 }; // the court's slab, inside the fence
const FENCE_H = 3;
const GATE = [727, 735]; // gap in the west fence (z)

export const COURT_SITE = { lot: LOT, pad: PAD, name: 'Ledger Ave Courts', x: COURT.cx, z: COURT.cz };

// Ground the rest of the city should leave alone (signs, poles): [x0, z0, x1, z1].
export const COURT_RESERVED = [
  [LOT.x0 - 1, LOT.z0, LOT.x1 + 1, LOT.z1],
  [PAD.x0 - 2, PAD.z0 - 2, PAD.x1 + 2, PAD.z1 + 2],
];

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

// The court's paint: apron, playing surface, keys and lines (NBA-ish dimensions).
function courtTexture() {
  const W = PAD.x1 - PAD.x0;
  const L = PAD.z1 - PAD.z0;
  const S = 24; // pixels per meter
  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = L * S;
  const c = cv.getContext('2d');
  const X = (x) => (x - PAD.x0) * S;
  const Z = (z) => (z - PAD.z0) * S;
  c.fillStyle = '#2f5a45';
  c.fillRect(0, 0, cv.width, cv.height);
  const hw = COURT.w / 2;
  const hl = COURT.l / 2;
  c.fillStyle = '#365f8f';
  c.fillRect(X(COURT.cx - hw), Z(COURT.cz - hl), COURT.w * S, COURT.l * S);
  c.strokeStyle = '#f4f4f0';
  c.lineWidth = 0.08 * S;
  const keyW = 4.9;
  const keyL = 5.8;
  // Center circle (filled red), keys (red), then all the lines.
  c.fillStyle = '#b4473b';
  c.beginPath();
  c.arc(X(COURT.cx), Z(COURT.cz), 1.8 * S, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(X(COURT.cx - hw), Z(COURT.cz));
  c.lineTo(X(COURT.cx + hw), Z(COURT.cz));
  c.stroke();
  c.strokeRect(X(COURT.cx - hw), Z(COURT.cz - hl), COURT.w * S, COURT.l * S);
  for (const end of [-1, 1]) {
    const base = COURT.cz + end * hl; // baseline
    const ft = base - end * keyL; // free-throw line
    c.fillStyle = '#b4473b';
    c.fillRect(X(COURT.cx - keyW / 2), Z(Math.min(base, ft)), keyW * S, keyL * S);
    c.strokeRect(X(COURT.cx - keyW / 2), Z(Math.min(base, ft)), keyW * S, keyL * S);
    // Free-throw circle (the half away from the basket).
    c.beginPath();
    c.arc(X(COURT.cx), Z(ft), 1.8 * S, end > 0 ? Math.PI : 0, end > 0 ? Math.PI * 2 : Math.PI);
    c.stroke();
    // Three-point line: straight in the corners, then an arc round the basket.
    const rim = base - end * 1.6;
    const r3 = 7.24;
    const side = 6.7;
    const a = Math.asin(side / r3);
    const zc = rim - end * Math.cos(a) * r3; // where the arc meets the straight
    c.beginPath();
    for (const sx of [-1, 1]) {
      c.moveTo(X(COURT.cx + sx * side), Z(base));
      c.lineTo(X(COURT.cx + sx * side), Z(zc));
    }
    c.stroke();
    c.beginPath();
    const mid = end > 0 ? -Math.PI / 2 : Math.PI / 2;
    c.arc(X(COURT.cx), Z(rim), r3 * S, mid - a, mid + a); // (out to where it meets the corner lines)
    c.stroke();
  }
  // Some wear.
  c.fillStyle = 'rgba(0,0,0,0.06)';
  for (let k = 0; k < 140; k++) c.fillRect(Math.random() * cv.width, Math.random() * cv.height, 4 + Math.random() * 30, 2 + Math.random() * 10);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

// Chain-link: a see-through diamond mesh.
export function chainTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(190,196,200,0.95)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, 16);
  c.lineTo(16, 0);
  c.lineTo(32, 16);
  c.lineTo(16, 32);
  c.closePath();
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildCourt(city, scene) {
  const asphalt = [];
  const paint = [];
  const steel = [];
  const wood = [];
  const white = [];
  const orange = [];
  // ---- The lot ----
  asphalt.push(flat(LOT.x0, LOT.z0, LOT.x1, LOT.z1, 0.035));
  const spots = [];
  const rows = [
    { x0: LOT.x0 + 0.5, x1: AISLE.x0, heading: -Math.PI / 2 }, // west row, nose to the west
    { x0: AISLE.x1, x1: LOT.x1 - 0.5, heading: Math.PI / 2 }, // east row
  ];
  for (const r of rows) {
    for (let k = 0; k <= STALLS; k++) {
      const z = STALL_Z0 + k * STALL_W;
      paint.push(box(r.x1 - r.x0, 0.01, 0.12, (r.x0 + r.x1) / 2, 0.045, z));
    }
    // (the line at the head of each row)
    const hx = r.heading < 0 ? r.x0 : r.x1;
    paint.push(box(0.12, 0.01, STALLS * STALL_W, hx, 0.045, STALL_Z0 + (STALLS * STALL_W) / 2));
    for (let k = 0; k < STALLS; k++) {
      const z = STALL_Z0 + (k + 0.5) * STALL_W;
      // Wheel stop at the head of the space.
      const wx = hx + (r.heading < 0 ? 0.6 : -0.6);
      white.push(box(0.2, 0.12, 1.6, wx, 0.095, z));
      spots.push({ x: (r.x0 + r.x1) / 2 + (r.heading < 0 ? -0.3 : 0.3), z, heading: r.heading });
    }
  }
  // Arrows down the aisle (both ways).
  for (const z of [712, 748]) {
    paint.push(box(0.15, 0.01, 2.2, AISLE.x0 + 2, 0.045, z));
    paint.push(box(0.15, 0.01, 2.2, AISLE.x1 - 2, 0.045, z));
  }

  // ---- The court ----
  const courtMat = new THREE.MeshLambertMaterial({ map: courtTexture() });
  const pad = new THREE.Mesh(flat(PAD.x0, PAD.z0, PAD.x1, PAD.z1, 0.06), courtMat);
  pad.receiveShadow = true;
  scene.add(pad);
  // Concrete edge round the slab.
  for (const [w, d, x, z] of [
    [PAD.x1 - PAD.x0 + 0.6, 0.3, (PAD.x0 + PAD.x1) / 2, PAD.z0 - 0.15],
    [PAD.x1 - PAD.x0 + 0.6, 0.3, (PAD.x0 + PAD.x1) / 2, PAD.z1 + 0.15],
    [0.3, PAD.z1 - PAD.z0, PAD.x0 - 0.15, (PAD.z0 + PAD.z1) / 2],
    [0.3, PAD.z1 - PAD.z0, PAD.x1 + 0.15, (PAD.z0 + PAD.z1) / 2],
  ]) white.push(box(w, 0.1, d, x, 0.05, z));
  // A path across the grass from the lot to the gate.
  asphalt.push(flat(LOT.x1, GATE[0] + 1, PAD.x0, GATE[1] - 1, 0.04));

  // Hoops: pole behind the baseline, an arm out over the line, backboard, rim and net.
  const hl = COURT.l / 2;
  const nets = [];
  const hoops = [];
  for (const end of [-1, 1]) {
    const base = COURT.cz + end * hl;
    const poleZ = base + end * 1.0;
    const boardZ = base - end * 1.2;
    const rimZ = boardZ - end * 0.4;
    steel.push(box(0.22, 3.6, 0.22, COURT.cx, 1.8, poleZ));
    steel.push(box(0.14, 0.14, Math.abs(boardZ - poleZ), COURT.cx, 3.45, (poleZ + boardZ) / 2));
    white.push(box(1.8, 1.05, 0.06, COURT.cx, 3.42, boardZ));
    orange.push(box(0.59, 0.45, 0.07, COURT.cx, 3.25, boardZ - end * 0.005)); // (the square on the board)
    const rim = new THREE.TorusGeometry(0.23, 0.022, 6, 18);
    rim.rotateX(Math.PI / 2);
    rim.translate(COURT.cx, 3.05, rimZ);
    orange.push(rim);
    const net = new THREE.CylinderGeometry(0.23, 0.15, 0.45, 10, 2, true);
    net.translate(COURT.cx, 2.82, rimZ);
    nets.push(net);
    hoops.push({ x: COURT.cx, z: rimZ, y: 3.05, dir: -end, boardZ }); // (dir: from the rim out into the court, along z)
    city.colliders.push({ minX: COURT.cx - 0.2, maxX: COURT.cx + 0.2, minZ: poleZ - 0.2, maxZ: poleZ + 0.2, h: 3.6 });
  }
  // The ball, left by the free-throw line.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), lam(0xd8641f));
  ball.position.set(COURT.cx + 1.3, 0.18, COURT.cz - hl + 6.4);
  ball.castShadow = true;
  scene.add(ball);

  // Fence: posts every 3 m, a top rail, and the chain-link between (a gate gap on the west).
  const chainTex = chainTexture();
  const runs = [
    [[PAD.x0, PAD.z0], [PAD.x1, PAD.z0]],
    [[PAD.x1, PAD.z0], [PAD.x1, PAD.z1]],
    [[PAD.x1, PAD.z1], [PAD.x0, PAD.z1]],
    [[PAD.x0, PAD.z1], [PAD.x0, GATE[1]]],
    [[PAD.x0, GATE[0]], [PAD.x0, PAD.z0]],
  ];
  const fenceMeshes = [];
  for (const [[ax, az], [bx, bz]] of runs) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 3));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      steel.push(box(0.08, FENCE_H, 0.08, ax + (bx - ax) * t, FENCE_H / 2, az + (bz - az) * t));
    }
    const along = ax === bx;
    steel.push(box(along ? 0.06 : L, 0.06, along ? L : 0.06, (ax + bx) / 2, FENCE_H, (az + bz) / 2));
    const t = chainTex.clone();
    t.repeat.set(L / 0.6, FENCE_H / 0.6);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, FENCE_H), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    m.position.set((ax + bx) / 2, FENCE_H / 2, (az + bz) / 2);
    m.rotation.y = along ? Math.PI / 2 : 0;
    fenceMeshes.push(m);
    city.colliders.push({ minX: Math.min(ax, bx) - 0.1, maxX: Math.max(ax, bx) + 0.1, minZ: Math.min(az, bz) - 0.1, maxZ: Math.max(az, bz) + 0.1, h: FENCE_H });
  }
  for (const m of fenceMeshes) scene.add(m);

  // Benches inside the fence, along the west side (either side of the gate).
  for (const z of [719, 743]) {
    const x = PAD.x0 + 0.9;
    wood.push(box(0.45, 0.06, 2.2, x, 0.5, z));
    wood.push(box(0.06, 0.4, 2.2, x - 0.22, 0.75, z));
    steel.push(box(0.4, 0.45, 0.06, x, 0.27, z - 0.95), box(0.4, 0.45, 0.06, x, 0.27, z + 0.95));
  }

  // Light poles at the corners, outside the fence; the heads glow after dark.
  const heads = [];
  for (const [x, z, dx, dz] of [[PAD.x0 - 0.6, PAD.z0 - 0.6, 1, 1], [PAD.x1 + 0.6, PAD.z0 - 0.6, -1, 1], [PAD.x0 - 0.6, PAD.z1 + 0.6, 1, -1], [PAD.x1 + 0.6, PAD.z1 + 0.6, -1, -1]]) {
    steel.push(box(0.18, 8, 0.18, x, 4, z));
    steel.push(box(0.1, 0.1, 1.4, x + dx * 0.45, 7.9, z + dz * 0.45));
    heads.push(box(0.9, 0.18, 0.5, x + dx * 0.9, 7.85, z + dz * 0.9));
    city.colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15, h: 8 });
  }

  const add = (list, mat, shadow = true) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  add(asphalt, lam(0x3a3d42), false);
  add(paint, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), false);
  add(steel, lam(0x4a5560));
  add(wood, lam(0x7a5434));
  add(white, lam(0xe9e9e4));
  add(orange, lam(0xd8641f));
  add(nets, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }), false);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd9d6c8, emissive: 0x000000 });
  add(heads, headMat, false);
  city.windowMats?.push(headMat); // (lit after dark with the windows)
  // A pool of light over the court after dark.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(flat(PAD.x0 - 2, PAD.z0 - 2, PAD.x1 + 2, PAD.z1 + 2, 0.08), glowMat);
  glow.visible = false;
  scene.add(glow);
  (city.onNight = city.onNight || []).push((k) => {
    glowMat.opacity = 0.16 * k;
    glow.visible = k > 0.02;
  });
  return { spots, hoops, ball, pad: PAD, court: COURT };
}

// The lot and court on the 2D maps (city canvas, radar, big map).
export function drawCourt(ctx, s) {
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(LOT.x0 * s, LOT.z0 * s, (LOT.x1 - LOT.x0) * s, (LOT.z1 - LOT.z0) * s);
  ctx.fillStyle = '#365f8f';
  ctx.fillRect(PAD.x0 * s, PAD.z0 * s, (PAD.x1 - PAD.x0) * s, (PAD.z1 - PAD.z0) * s);
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = Math.max(1, s * 0.5);
  ctx.strokeRect((COURT.cx - COURT.w / 2) * s, (COURT.cz - COURT.l / 2) * s, COURT.w * s, COURT.l * s);
}
