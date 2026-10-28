import { HoopNet } from './net.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';

// Outdoor basketball courts. Each one: full size, painted, a hoop at each end, a chain-link
// fence with a gate, benches, and four light poles that come on at night. Built in the court's
// own frame (long side along local z, the gate on its local west side), then set down in the
// city at `cx, cz`, turned by `rot` (a quarter turn or none: the streets round them run
// north-south and east-west).
// - Ledger Ave Courts: on the grass beside the east freeway, between Ledger Ave, Midway Blvd
//   and Bond St, with a parking lot (two rows of nose-in spaces either side of an aisle that
//   carries on from the road up from Bond St to Midway Blvd; parking.js fills some of them).
// - Market St Courts: on the strip along Market St by the crosstown freeway, the gate onto
//   Market St (beside the children's park, playground.js).
const COURT = { cx: 0, cz: 0, w: 15.24, l: 28.65 }; // play area (meters), long side along local z
const PAD = { x0: -12, x1: 12, z0: -20, z1: 20 }; // the court's slab, inside the fence
const FENCE_H = 3;
const GATE = [-4, 4]; // gap in the (local) west fence, along z
export const COURT_CONFIGS = [
  { name: 'Ledger Ave Courts', cx: 1217, cz: 731, rot: 0, path: 6, lot: true },
  { name: 'Market St Courts', cx: 557, cz: 929, rot: -Math.PI / 2, path: 7 },
];
// The first court's lot (world coordinates).
const LOT = { x0: 1179, x1: 1199, z0: 700, z1: 760.5 };
const AISLE = { x0: 1185, x1: 1193 }; // (in line with the road from Bond St)
const STALL_W = 2.7;
const STALL_Z0 = 703;
const STALLS = 20; // per row

// Court frame -> world: (x, z) turned by rot (as three.js turns about y), moved to the center.
const toWorld = (cfg, x, z) => {
  const c = Math.cos(cfg.rot);
  const sn = Math.sin(cfg.rot);
  return [cfg.cx + x * c + z * sn, cfg.cz - x * sn + z * c];
};
// A box in the court's frame -> its world bounds.
const worldRect = (cfg, x0, z0, x1, z1) => {
  const a = toWorld(cfg, x0, z0);
  const b = toWorld(cfg, x1, z1);
  return { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) };
};

export const COURT_SITE = { name: COURT_CONFIGS[0].name, x: COURT_CONFIGS[0].cx, z: COURT_CONFIGS[0].cz };
export const COURT_SITES = COURT_CONFIGS.map((c) => ({ name: c.name, x: c.cx, z: c.cz }));

// Ground the rest of the city should leave alone (signs, poles): [x0, z0, x1, z1].
export const COURT_RESERVED = [[LOT.x0 - 1, LOT.z0, LOT.x1 + 1, LOT.z1]];
for (const cfg of COURT_CONFIGS) {
  const r = worldRect(cfg, PAD.x0 - 2 - cfg.path, PAD.z0 - 2, PAD.x1 + 2, PAD.z1 + 2);
  COURT_RESERVED.push([r.x0, r.z0, r.x1, r.z1]);
}

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

// A chain-link fence along straight runs ([[ax, az], [bx, bz]], axis-aligned, world space):
// posts every 3 m, a top rail, the mesh between; solid to walk or drive into.
export function chainFence(city, scene, runs, h = 1.8) {
  const posts = [];
  const chain = chainTexture();
  for (const [[ax, az], [bx, bz]] of runs) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 3));
    for (let k = 0; k <= n; k++) posts.push(box(0.07, h, 0.07, ax + ((bx - ax) * k) / n, h / 2, az + ((bz - az) * k) / n));
    const along = ax === bx;
    posts.push(box(along ? 0.05 : len, 0.05, along ? len : 0.05, (ax + bx) / 2, h, (az + bz) / 2));
    const t = chain.clone();
    t.repeat.set(len / 0.6, h / 0.6);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    m.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
    m.rotation.y = along ? Math.PI / 2 : 0;
    scene.add(m);
    city.colliders.push({ minX: Math.min(ax, bx) - 0.08, maxX: Math.max(ax, bx) + 0.08, minZ: Math.min(az, bz) - 0.08, maxZ: Math.max(az, bz) + 0.08, h });
  }
  if (posts.length) {
    const m = new THREE.Mesh(mergeGeometries(posts), lam(0x4a5560));
    m.castShadow = true;
    scene.add(m);
  }
}

export function buildCourts(city, scene) {
  return COURT_CONFIGS.map((cfg) => buildCourt(city, scene, cfg));
}

function buildCourt(city, scene, cfg) {
  const asphalt = [];
  const paint = [];
  const steel = [];
  const wood = [];
  const white = [];
  const orange = [];
  // Everything in the court's own frame goes in this group (set down in the city at the end);
  // the lot is in world coordinates already.
  const group = new THREE.Group();
  group.position.set(cfg.cx, 0, cfg.cz);
  group.rotation.y = cfg.rot;
  scene.add(group);
  const worldAsphalt = [];
  const worldPaint = [];
  const worldWhite = [];
  const spots = [];
  // Colliders: given in the court's frame, stored in world bounds.
  const collide = (x0, z0, x1, z1, h) => {
    const r = worldRect(cfg, x0, z0, x1, z1);
    city.colliders.push({ minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1, h });
  };
  if (cfg.lot) {
    buildLot(worldAsphalt, worldPaint, worldWhite, spots);
    // The lot's fence: open at both ends of the aisle (Midway Blvd, Bond St) and at the path to
    // the court's gate.
    const { x0, x1, z0, z1 } = LOT;
    chainFence(city, scene, [
      [[x0, z0], [AISLE.x0, z0]],
      [[AISLE.x1, z0], [x1, z0]],
      [[x1, z0], [x1, 727.5]],
      [[x1, 734.5], [x1, z1]],
      [[x1, z1], [AISLE.x1, z1]],
      [[AISLE.x0, z1], [x0, z1]],
      [[x0, z1], [x0, z0]],
    ]);
  }
  // ---- The court ----
  const courtMat = new THREE.MeshLambertMaterial({ map: courtTexture() });
  const pad = new THREE.Mesh(flat(PAD.x0, PAD.z0, PAD.x1, PAD.z1, 0.06), courtMat);
  pad.receiveShadow = true;
  group.add(pad);
  // Concrete edge round the slab.
  for (const [w, d, x, z] of [
    [PAD.x1 - PAD.x0 + 0.6, 0.3, (PAD.x0 + PAD.x1) / 2, PAD.z0 - 0.15],
    [PAD.x1 - PAD.x0 + 0.6, 0.3, (PAD.x0 + PAD.x1) / 2, PAD.z1 + 0.15],
    [0.3, PAD.z1 - PAD.z0, PAD.x0 - 0.15, (PAD.z0 + PAD.z1) / 2],
    [0.3, PAD.z1 - PAD.z0, PAD.x1 + 0.15, (PAD.z0 + PAD.z1) / 2],
  ]) white.push(box(w, 0.1, d, x, 0.05, z));
  // A path out from the gate (to the lot, or the street).
  if (!cfg.lot) asphalt.push(flat(PAD.x0 - cfg.path, GATE[0] + 1, PAD.x0, GATE[1] - 1, 0.04));

  // Hoops: pole behind the baseline, an arm out over the line, backboard, rim and net.
  const hl = COURT.l / 2;
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
    // (dir: from the rim out into the court)
    const [hx, hz] = toWorld(cfg, COURT.cx, rimZ);
    const [ax, az] = toWorld(cfg, COURT.cx, rimZ - end);
    hoops.push({ x: hx, z: hz, y: 3.05, dx: ax - hx, dz: az - hz });
    collide(COURT.cx - 0.2, poleZ - 0.2, COURT.cx + 0.2, poleZ + 0.2, 3.6);
  }
  // The ball, left by the free-throw line.
  const ball = ballMesh();
  ball.position.set(COURT.cx + 1.3, 0.18, COURT.cz - hl + 6.4);
  ball.castShadow = true;
  group.add(ball);

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
    collide(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, FENCE_H);
  }
  for (const m of fenceMeshes) group.add(m);

  // Benches inside the fence, along the west side (either side of the gate).
  for (const z of [-12, 12]) {
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
    collide(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 8);
  }

  const add = (list, mat, shadow = true, parent = group) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  add(asphalt, lam(0x3a3d42), false);
  add(paint, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), false);
  add(worldAsphalt, lam(0x3a3d42), false, scene);
  add(worldPaint, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), false, scene);
  add(worldWhite, lam(0xe9e9e4), true, scene);
  add(steel, lam(0x4a5560));
  add(wood, lam(0x7a5434));
  add(white, lam(0xe9e9e4));
  add(orange, lam(0xd8641f));
  // (the nets move: a little cloth sim each, net.js, stepped by hoops.js)
  const netSims = hoops.map((h) => new HoopNet(scene, h));
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd9d6c8, emissive: 0x000000 });
  add(heads, headMat, false);
  city.windowMats?.push(headMat); // (lit after dark with the windows)
  // A pool of light over the court after dark.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(flat(PAD.x0 - 2, PAD.z0 - 2, PAD.x1 + 2, PAD.z1 + 2, 0.08), glowMat);
  glow.visible = false;
  group.add(glow);
  (city.onNight = city.onNight || []).push((k) => {
    glowMat.opacity = 0.16 * k;
    glow.visible = k > 0.02;
  });
  const hw = COURT.w / 2;
  const hl2 = COURT.l / 2;
  return {
    name: cfg.name, cx: cfg.cx, cz: cfg.cz, spots, hoops, ball,
    nets: netSims,
    pad: worldRect(cfg, PAD.x0, PAD.z0, PAD.x1, PAD.z1),
    court: worldRect(cfg, COURT.cx - hw, COURT.cz - hl2, COURT.cx + hw, COURT.cz + hl2),
  };
}

// The first court's parking lot (world coordinates).
function buildLot(asphalt, paint, white, spots) {
  asphalt.push(flat(LOT.x0, LOT.z0, LOT.x1, LOT.z1, 0.035));
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
  // A path across the grass from the lot to the gate.
  asphalt.push(flat(LOT.x1, 727 + 1, 1205, 735 - 1, 0.04));
}


// The lots and courts on the 2D maps (city canvas, radar, big map).
export function drawCourt(ctx, s) {
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(LOT.x0 * s, LOT.z0 * s, (LOT.x1 - LOT.x0) * s, (LOT.z1 - LOT.z0) * s);
  for (const cfg of COURT_CONFIGS) {
    const p = worldRect(cfg, PAD.x0, PAD.z0, PAD.x1, PAD.z1);
    ctx.fillStyle = '#365f8f';
    ctx.fillRect(p.x0 * s, p.z0 * s, (p.x1 - p.x0) * s, (p.z1 - p.z0) * s);
    const c = worldRect(cfg, -COURT.w / 2, -COURT.l / 2, COURT.w / 2, COURT.l / 2);
    ctx.strokeStyle = '#f4f4f0';
    ctx.lineWidth = Math.max(1, s * 0.5);
    ctx.strokeRect(c.x0 * s, c.z0 * s, (c.x1 - c.x0) * s, (c.z1 - c.z0) * s);
  }
}

// A basketball: regulation size (24 cm across; the rims are 46 cm), pebbled orange with the
// black seams, so it reads as a ball next to the players.
let BALL_MAT = null;
export function ballMesh(r = 0.12) {
  if (!BALL_MAT) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#d8641f';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#1a1008';
    g.lineWidth = 2.5;
    // (the equator, two meridians, and the two curved panels' seams)
    g.beginPath();
    g.moveTo(0, 32);
    g.lineTo(128, 32);
    for (const x of [0, 32, 64, 96]) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, 64);
    }
    g.stroke();
    for (const x0 of [16, 80]) {
      g.beginPath();
      for (let y = 0; y <= 64; y += 2) g.lineTo(x0 + Math.sin((y / 64) * Math.PI) * 9 * (y < 32 ? 1 : 1), y);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    BALL_MAT = new THREE.MeshLambertMaterial({ map: tex });
  }
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), BALL_MAT);
  m.castShadow = true;
  return m;
}
