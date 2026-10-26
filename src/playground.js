import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam, setShirt, bendLeg, crouchPose } from './character.js';
import { rand, dist, lerpAngle, pick } from './util.js';
import { safetyAt, turnout, quietNote } from './safety.js';

// Market St Park: a children's playground and a statue on the strip along Market St, between
// the Market St Courts (court.js) and Ferry St.
// - The playground: a low fence with a gate onto Market St, swings, a slide, a climbing frame,
//   a seesaw, a merry-go-round, a sandbox, benches and trees.
// - Longshoreman Plaza: a bronze dock worker with a sack on his shoulder, on a granite plinth,
//   with benches, flower beds and lamps round it.
// When you're near, kids play on everything (swinging, climbing up and going down the slide,
// riding the merry-go-round, see-sawing in pairs, digging in the sand, chasing each other) while
// parents watch from the benches, and a few people sit by the statue. How many come depends on
// the time of day and how safe it is round here (safety.js): kids are the first to stay home.
// The children can't be hurt (main.js leaves them out of characters()); trouble nearby still
// sends them running.
const PG = { x0: 586, x1: 650, z0: 914, z1: 945 }; // the playground, inside its fence
const GATE = [614, 618]; // in the north fence (x), onto Market St
const STREET_Z = 910; // Market St's curb
const PLAZA = { x: 678, z: 929, r: 11 };
const KID = 0.62; // children's size
const KID_HIP = 0.9 * KID;
const NEAR = 150;
const FAR = 200;

// Equipment (world coordinates).
const SWING = { x0: 591, x1: 603, z: 924, top: 2.4, rope: 1.95, seats: [593, 595.4, 598.6, 601] };
const SLIDE = { ladderX: 608.4, z: 936, top: 1.5, x0: 611, x1: 616.6, end: 0.35 };
const CLIMB = { xs: [625, 627, 629, 631, 633], zs: [918.5, 920.5, 922.5, 924.5], h: [1, 2] };
const SEESAW = { x: 630, z: 937, y: 0.5, half: 1.8 };
const MERRY = { x: 643, z: 924, r: 1.6 };
const SAND = { x: 594, z: 938.5, half: 2 };
const BENCHES = [
  { x: 606, z: 915.4, h: 0 },
  { x: 627, z: 915.4, h: 0 },
  { x: 648.6, z: 936, h: -Math.PI / 2 },
];
const PLAZA_BENCHES = [0, Math.PI / 2, Math.PI].map((a) => ({ a })); // east, south, west (north is the path)

export const PARK_SITE = { name: 'Market St Park', x: (PG.x0 + PG.x1) / 2, z: (PG.z0 + PG.z1) / 2, statue: { name: 'The Longshoreman', x: PLAZA.x, z: PLAZA.z } };
export const PARK_RESERVED = [
  [PG.x0 - 1.5, STREET_Z, PG.x1 + 1.5, PG.z1 + 1.5],
  [PLAZA.x - PLAZA.r - 1, STREET_Z, PLAZA.x + PLAZA.r + 1, PLAZA.z + PLAZA.r + 1],
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
const disc = (x, z, r, y, seg = 32) => {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
// A bar between two points.
const bar = (a, b, t = 0.07) => {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(t, t, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
};
// A park bench facing `h` (0 = +z): its parts in world space.
function bench(x, z, h, wood, iron) {
  const parts = [[box(2, 0.06, 0.45, 0, 0.45, 0), wood], [box(2, 0.45, 0.06, 0, 0.72, -0.22), wood]];
  for (const s of [-0.85, 0.85]) parts.push([box(0.06, 0.45, 0.45, s, 0.22, 0), iron]);
  for (const [g, list] of parts) {
    g.rotateY(h);
    g.translate(x, 0, z);
    list.push(g);
  }
}
// Two seats on a bench (where someone sits, and which way they face).
function benchSeats(b) {
  const fx = Math.sin(b.h);
  const fz = Math.cos(b.h);
  return [-0.5, 0.5].map((o) => ({ x: b.x + fz * o + fx * 0.05, z: b.z - fx * o + fz * 0.05, h: b.h, y: 0.48, who: null }));
}

function plaqueTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#5b4a2a';
  c.fillRect(0, 0, 256, 128);
  c.strokeStyle = '#c9a85a';
  c.lineWidth = 6;
  c.strokeRect(6, 6, 244, 116);
  c.fillStyle = '#e6cf8a';
  c.textAlign = 'center';
  c.font = 'bold 26px Georgia, serif';
  c.fillText('THE LONGSHOREMAN', 128, 48);
  c.font = 'italic 17px Georgia, serif';
  c.fillText('For the hands that built', 128, 80);
  c.fillText('the Docks · 1911', 128, 102);
  return new THREE.CanvasTexture(cv);
}

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext('2d');
  c.fillStyle = '#2e6b3a';
  c.fillRect(0, 0, 256, 96);
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.font = 'bold 30px Arial';
  c.fillText('MARKET ST', 128, 42);
  c.font = 'bold 22px Arial';
  c.fillText('PLAYGROUND', 128, 76);
  return new THREE.CanvasTexture(cv);
}

export function buildPark(city, scene) {
  const L = {
    rubberB: [], rubberR: [], rubberG: [], rubberO: [], concrete: [], stone: [], sand: [],
    green: [], red: [], yellow: [], blue: [], steel: [], wood: [], iron: [], bronze: [], granite: [],
    trunk: [], leaves: [], flowersA: [], flowersB: [], lampHead: [],
  };
  // ---- Ground ----
  L.rubberB.push(flat(589, 918, 605, 930, 0.04)); // under the swings
  L.rubberR.push(flat(606, 931, 621, 941.5, 0.04)); // the slide
  L.rubberG.push(flat(623, 916.5, 635, 926.5, 0.04)); // the climbing frame
  L.rubberO.push(flat(625, 933, 635, 941, 0.04)); // the seesaw
  L.rubberB.push(disc(MERRY.x, MERRY.z, 3.2, 0.04));
  L.concrete.push(flat(GATE[0], STREET_Z, GATE[1], 929, 0.035)); // path in from the street
  L.concrete.push(flat(PLAZA.x - 2, STREET_Z, PLAZA.x + 2, PLAZA.z - PLAZA.r + 0.5, 0.035));

  // ---- Low fence (green metal), gate onto Market St ----
  const fenceRuns = [
    [[PG.x0, PG.z0], [GATE[0], PG.z0]],
    [[GATE[1], PG.z0], [PG.x1, PG.z0]],
    [[PG.x1, PG.z0], [PG.x1, PG.z1]],
    [[PG.x1, PG.z1], [PG.x0, PG.z1]],
    [[PG.x0, PG.z1], [PG.x0, PG.z0]],
  ];
  for (const [[ax, az], [bx, bz]] of fenceRuns) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k <= n; k++) L.green.push(box(0.08, 1.05, 0.08, ax + ((bx - ax) * k) / n, 0.52, az + ((bz - az) * k) / n));
    for (const y of [0.35, 1.0]) L.green.push(bar([ax, y, az], [bx, y, bz], 0.03));
    // (thin uprights between the posts)
    const m = Math.round(len / 0.25);
    for (let k = 1; k < m; k++) L.green.push(box(0.02, 0.65, 0.02, ax + ((bx - ax) * k) / m, 0.67, az + ((bz - az) * k) / m));
    city.colliders.push({ minX: Math.min(ax, bx) - 0.1, maxX: Math.max(ax, bx) + 0.1, minZ: Math.min(az, bz) - 0.1, maxZ: Math.max(az, bz) + 0.1, h: 1.05 });
  }
  // The sign over the gate.
  for (const x of [GATE[0] - 0.2, GATE[1] + 0.2]) L.green.push(box(0.12, 2.6, 0.12, x, 1.3, PG.z0));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), new THREE.MeshLambertMaterial({ map: signTexture(), side: THREE.DoubleSide }));
  sign.position.set((GATE[0] + GATE[1]) / 2, 2.3, PG.z0 - 0.05);
  sign.rotation.y = Math.PI; // (reads from the street)
  scene.add(sign);

  // ---- Swings: an A-frame, a top bar, four seats on ropes (the seats move) ----
  const S = SWING;
  for (const x of [S.x0, (S.x0 + S.x1) / 2, S.x1]) {
    for (const dz of [-1.1, 1.1]) L.red.push(bar([x, 0, S.z + dz], [x, S.top, S.z], 0.08));
  }
  L.red.push(bar([S.x0, S.top, S.z], [S.x1, S.top, S.z], 0.08));
  const swings = [];
  const ropeMat = lam(0x777777);
  const seatMat = lam(0x222831);
  for (const x of S.seats) {
    const piv = new THREE.Group();
    piv.position.set(x, S.top, S.z);
    for (const o of [-0.22, 0.22]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, S.rope, 0.03), ropeMat);
      r.position.set(o, -S.rope / 2, 0);
      piv.add(r);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.24), seatMat);
    seat.position.set(0, -S.rope, 0);
    piv.add(seat);
    scene.add(piv);
    swings.push({ x, piv, who: null, a: 0, amp: 0, t: Math.random() * 6 });
  }

  // ---- Slide: ladder up to a platform, the chute down along +x ----
  const D = SLIDE;
  for (const dz of [-0.4, 0.4]) L.steel.push(bar([D.ladderX - 0.3, 0, D.z + dz], [D.ladderX + 0.2, D.top + 0.9, D.z + dz], 0.04));
  for (let y = 0.3; y < D.top; y += 0.3) L.steel.push(bar([D.ladderX - 0.3 + (y / (D.top + 0.9)) * 0.5, y, D.z - 0.4], [D.ladderX - 0.3 + (y / (D.top + 0.9)) * 0.5, y, D.z + 0.4], 0.03));
  L.blue.push(box(1.6, 0.12, 1.4, (D.ladderX + D.x0) / 2 + 0.2, D.top, D.z));
  for (const [x, z] of [[D.ladderX + 0.2, D.z - 0.65], [D.ladderX + 0.2, D.z + 0.65], [D.x0, D.z - 0.65], [D.x0, D.z + 0.65]]) L.steel.push(box(0.08, D.top + 1.1, 0.08, x, (D.top + 1.1) / 2, z));
  L.red.push(box(1.7, 0.1, 1.5, (D.ladderX + D.x0) / 2 + 0.2, D.top + 1.15, D.z)); // a little roof
  {
    const len = Math.hypot(D.x1 - D.x0, D.top - D.end);
    const ang = Math.atan2(D.top - D.end, D.x1 - D.x0);
    const chute = new THREE.BoxGeometry(len, 0.06, 0.7);
    chute.rotateZ(-ang);
    chute.translate((D.x0 + D.x1) / 2, (D.top + D.end) / 2, D.z);
    L.yellow.push(chute);
    for (const dz of [-0.36, 0.36]) {
      const rail = new THREE.BoxGeometry(len, 0.22, 0.05);
      rail.rotateZ(-ang);
      rail.translate((D.x0 + D.x1) / 2, (D.top + D.end) / 2 + 0.1, D.z + dz);
      L.yellow.push(rail);
    }
    L.steel.push(box(0.08, D.end + 0.1, 0.6, D.x1 - 0.1, (D.end + 0.1) / 2, D.z));
  }

  // ---- Climbing frame: a lattice of bars ----
  const C = CLIMB;
  for (const x of C.xs) for (const z of C.zs) L.green.push(bar([x, 0, z], [x, 2.05, z], 0.05));
  for (const y of C.h) {
    for (const z of C.zs) L.yellow.push(bar([C.xs[0], y, z], [C.xs[C.xs.length - 1], y, z], 0.04));
    for (const x of C.xs) L.yellow.push(bar([x, y, C.zs[0]], [x, y, C.zs[C.zs.length - 1]], 0.04));
  }

  // ---- Seesaw (the plank moves) ----
  const W = SEESAW;
  L.steel.push(box(0.5, W.y, 0.4, W.x, W.y / 2, W.z));
  const plank = new THREE.Group();
  plank.position.set(W.x, W.y + 0.05, W.z);
  const plankMesh = new THREE.Mesh(new THREE.BoxGeometry(W.half * 2 + 0.4, 0.08, 0.32), lam(0xd9822b));
  plank.add(plankMesh);
  for (const s of [-1, 1]) {
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.3), lam(0x4a5560));
    hnd.position.set(s * (W.half - 0.35), 0.2, 0);
    plank.add(hnd);
  }
  scene.add(plank);

  // ---- Merry-go-round (turns) ----
  const merry = new THREE.Group();
  merry.position.set(MERRY.x, 0.2, MERRY.z);
  const discMesh = new THREE.Mesh(new THREE.CylinderGeometry(MERRY.r, MERRY.r, 0.12, 24), lam(0xc0392b));
  merry.add(discMesh);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const rail = new THREE.Mesh(bar([0, 0.06, 0], [Math.cos(a) * (MERRY.r - 0.15), 0.85, Math.sin(a) * (MERRY.r - 0.15)], 0.035), lam(0xf2c418));
    merry.add(rail);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8), lam(0xf2c418));
  hub.position.y = 0.45;
  merry.add(hub);
  scene.add(merry);
  L.steel.push(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10).translate(MERRY.x, 0.1, MERRY.z));

  // ---- Sandbox ----
  const B = SAND;
  for (const [w, d, x, z] of [[B.half * 2 + 0.3, 0.15, B.x, B.z - B.half], [B.half * 2 + 0.3, 0.15, B.x, B.z + B.half], [0.15, B.half * 2, B.x - B.half, B.z], [0.15, B.half * 2, B.x + B.half, B.z]]) L.wood.push(box(w, 0.3, d, x, 0.15, z));
  L.sand.push(flat(B.x - B.half, B.z - B.half, B.x + B.half, B.z + B.half, 0.18));
  // (a bucket and spade)
  L.blue.push(box(0.25, 0.25, 0.25, B.x + 1, 0.3, B.z - 0.7));
  L.yellow.push(box(0.08, 0.05, 0.5, B.x - 0.6, 0.22, B.z + 0.8));

  // ---- Benches and trees ----
  for (const b of BENCHES) bench(b.x, b.z, b.h, L.wood, L.iron);
  const tree = (x, z, s = 1) => {
    L.trunk.push(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 2.4 * s, 6).translate(x, 1.2 * s, z));
    L.leaves.push(new THREE.IcosahedronGeometry(1.6 * s, 0).translate(x, 3.2 * s, z));
  };
  for (const x of [589, 603, 623, 640]) tree(x, 943, 1);
  tree(648, 916.5, 0.9);
  tree(588, 916.5, 0.9);

  // ---- Longshoreman Plaza ----
  const P = PLAZA;
  L.stone.push(disc(P.x, P.z, P.r, 0.05, 40));
  L.concrete.push(disc(P.x, P.z, 3.6, 0.06, 28));
  // The plinth: a stepped granite block, the plaque on the street side.
  L.granite.push(box(3.6, 0.4, 3.6, P.x, 0.2, P.z));
  L.granite.push(box(2.6, 1.6, 2.6, P.x, 1.2, P.z));
  L.granite.push(box(2.9, 0.25, 2.9, P.x, 2.12, P.z));
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshLambertMaterial({ map: plaqueTexture() }));
  plaque.position.set(P.x, 1.25, P.z - 1.31);
  plaque.rotation.y = Math.PI;
  scene.add(plaque);
  city.colliders.push({ minX: P.x - 1.8, maxX: P.x + 1.8, minZ: P.z - 1.8, maxZ: P.z + 1.8, h: 6 });
  // Flower beds at the corners.
  for (const [dx, dz, k] of [[-4.2, -4.2, 0], [4.2, -4.2, 1], [-4.2, 4.2, 1], [4.2, 4.2, 0]]) {
    L.wood.push(box(2.2, 0.3, 2.2, P.x + dx, 0.15, P.z + dz));
    L.leaves.push(box(2, 0.25, 2, P.x + dx, 0.38, P.z + dz));
    for (let n = 0; n < 9; n++) (k ? L.flowersA : L.flowersB).push(box(0.22, 0.22, 0.22, P.x + dx + rand(-0.8, 0.8), 0.6, P.z + dz + rand(-0.8, 0.8)));
  }
  // Benches facing the statue; lamps between them.
  const plazaSeats = [];
  for (const b of PLAZA_BENCHES) {
    const x = P.x + Math.cos(b.a) * 8;
    const z = P.z + Math.sin(b.a) * 8;
    const h = Math.atan2(P.x - x, P.z - z);
    bench(x, z, h, L.wood, L.iron);
    plazaSeats.push(...benchSeats({ x, z, h }));
  }
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const x = P.x + Math.cos(a) * 10;
    const z = P.z + Math.sin(a) * 10;
    L.iron.push(box(0.12, 3.6, 0.12, x, 1.8, z));
    L.lampHead.push(box(0.4, 0.5, 0.4, x, 3.75, z));
    city.colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1, h: 3.6 });
  }
  // The statue: a dock worker in bronze, a sack on his right shoulder, stepping out toward the
  // street, his left hand on his hip.
  const statue = makeStatue();
  statue.position.set(P.x, 2.25, P.z);
  statue.rotation.y = Math.PI; // (facing Market St)
  scene.add(statue);

  // ---- All the merged parts ----
  const mats = {
    rubberB: lam(0x3b6ea5), rubberR: lam(0xb5523b), rubberG: lam(0x4a8a52), rubberO: lam(0xd98a3b),
    concrete: lam(0xb9b6ae), stone: lam(0x9c968a), sand: lam(0xe3cf96), green: lam(0x2e6b3a), red: lam(0xc0392b),
    yellow: lam(0xf2c418), blue: lam(0x2f6fbf), steel: lam(0x8a939b), wood: lam(0x7a5434), iron: lam(0x2b2f33),
    bronze: lam(0x7a5a32), granite: lam(0x6e6a66), trunk: lam(0x5a3d24), leaves: lam(0x3f7a35),
    flowersA: lam(0xd94f70), flowersB: lam(0xf2c14e),
  };
  for (const [k, list] of Object.entries(L)) {
    if (!list.length || k === 'lampHead') continue;
    const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mats[k]); // (some shapes have no index)
    m.castShadow = !k.startsWith('rubber') && k !== 'concrete' && k !== 'stone' && k !== 'sand';
    m.receiveShadow = true;
    scene.add(m);
  }
  const headMat = new THREE.MeshLambertMaterial({ color: 0xe8e2c8, emissive: 0x000000 });
  scene.add(new THREE.Mesh(mergeGeometries(L.lampHead), headMat));
  city.windowMats?.push(headMat); // (lit after dark)

  const seats = BENCHES.flatMap(benchSeats);
  return { swings, plank, merry, seats, plazaSeats, statue };
}

// The bronze dock worker (a scaled-up character, posed).
function makeStatue() {
  const bronze = lam(0x7a5a32);
  const g = new THREE.Group();
  const part = (w, h, d, x, y, z, parent = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bronze);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const S = 1.9;
  const pivot = (x, y, z = 0) => {
    const p = new THREE.Group();
    p.position.set(x * S, y * S, z * S);
    g.add(p);
    return p;
  };
  // Legs: the left stepping forward.
  for (const [x, a] of [[0.13, -0.35], [-0.13, 0.25]]) {
    const hip = pivot(x, 0.9);
    hip.rotation.x = a;
    part(0.22 * S, 0.46 * S, 0.26 * S, 0, -0.22 * S, 0, hip);
    part(0.2 * S, 0.44 * S, 0.24 * S, 0, -0.66 * S, a * -0.1 * S, hip);
    part(0.22 * S, 0.1 * S, 0.34 * S, 0, -0.9 * S, 0.05 * S, hip); // boot
  }
  part(0.6 * S, 0.74 * S, 0.34 * S, 0, 1.26 * S, 0); // body (a work jacket)
  part(0.34 * S, 0.36 * S, 0.34 * S, 0, 1.82 * S, 0); // head
  part(0.4 * S, 0.1 * S, 0.4 * S, 0, 2.02 * S, 0); // flat cap
  part(0.38 * S, 0.04 * S, 0.18 * S, 0, 1.98 * S, 0.24 * S); // (its brim)
  // Right arm up, holding the sack on the shoulder; left hand on the hip.
  const armR = pivot(-0.37, 1.56);
  armR.rotation.z = 2.6;
  part(0.17 * S, 0.62 * S, 0.19 * S, 0, -0.3 * S, 0, armR);
  const sack = part(0.55 * S, 0.4 * S, 0.45 * S, -0.3 * S, 2.1 * S, -0.05 * S);
  sack.rotation.z = 0.35;
  const armL = pivot(0.37, 1.56);
  armL.rotation.z = 0.7;
  armL.rotation.x = 0.4;
  part(0.17 * S, 0.62 * S, 0.19 * S, 0, -0.3 * S, 0, armL);
  return g;
}

// The playground and plaza on the 2D maps.
export function drawPark(ctx, s) {
  ctx.fillStyle = '#5f8f4e';
  ctx.fillRect(PG.x0 * s, PG.z0 * s, (PG.x1 - PG.x0) * s, (PG.z1 - PG.z0) * s);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(606 * s, 931 * s, 15 * s, 10.5 * s);
  ctx.fillStyle = '#3b6ea5';
  ctx.fillRect(589 * s, 918 * s, 16 * s, 12 * s);
  ctx.strokeStyle = '#2e6b3a';
  ctx.lineWidth = Math.max(1, s * 0.4);
  ctx.strokeRect(PG.x0 * s, PG.z0 * s, (PG.x1 - PG.x0) * s, (PG.z1 - PG.z0) * s);
  ctx.fillStyle = '#9c968a';
  ctx.beginPath();
  ctx.arc(PLAZA.x * s, PLAZA.z * s, PLAZA.r * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5a32';
  ctx.beginPath();
  ctx.arc(PLAZA.x * s, PLAZA.z * s, Math.max(1.5, 2 * s), 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// The people: kids playing, parents on the benches, people sitting by the statue.
const SHIRTS = [0xff5a5f, 0x3fa7d6, 0xfad02c, 0x7bd389, 0xf28dd0, 0xff9f43, 0x9b8cff, 0x5ce1e6];
const TASKS = ['swing', 'slide', 'climb', 'seesaw', 'merry', 'sand', 'run'];

export class Playground {
  constructor(game) {
    this.game = game;
    this.site = game.city.park;
    this.kids = [];
    this.adults = [];
    this.spoiled = false;
    this.merrySpin = 0;
    this.seesawA = 0;
    this.seesawT = 0;
  }

  get active() {
    return this.kids.length + this.adults.length > 0;
  }

  // Kids, parents, statue sitters by the time of day.
  crowd() {
    const h = this.game.rhythm ? this.game.rhythm.hour() : 15;
    if (h < 8 || h >= 20.5) return [0, 0, h >= 20.5 && h < 22 ? 1 : 0];
    if (h < 11) return [3, 2, 1];
    if (h < 15) return [4, 2, 2];
    if (h < 19) return [7, 3, 3];
    return [3, 2, 2];
  }

  update(dt) {
    const S = this.site;
    if (!S) return;
    const game = this.game;
    const [px, pz] = game.player.pos();
    const d = dist(px, pz, PARK_SITE.x, PARK_SITE.z);
    if (d > FAR) {
      if (this.active) this.clear();
      this.spoiled = false;
      return;
    }
    if (!this.active && !this.spoiled && d < NEAR && game.time >= (this.nextTry || 0)) this.start();
    this.drop();
    this.animate(dt);
    if (this.wasActive && !this.active) this.spoiled = true;
    this.wasActive = this.active;
  }

  start() {
    const game = this.game;
    const safe = safetyAt(game, PARK_SITE.x, PARK_SITE.z);
    const [nk, np, ns] = this.crowd();
    // Parents keep the kids home first; the statue's regulars are harder to put off.
    const kids = turnout(nk, safe.k * safe.k, 0.4);
    const parents = kids ? Math.max(1, Math.min(np, Math.ceil(kids / 2.5))) : 0;
    const sitters = turnout(ns, safe.k, 0.25);
    quietNote(game, PARK_SITE.name, safe);
    this.nextTry = game.time + 30;
    if (!kids && !sitters) return;
    const S = this.site;
    const add = (x, z) => {
      const p = game.peds.addAt(x, z);
      p.state = 'play';
      p.act = this;
      p.keep = true;
      p.sidewalk = false;
      return p;
    };
    for (let k = 0; k < kids; k++) {
      const p = add(rand(PG.x0 + 3, PG.x1 - 3), rand(PG.z0 + 3, PG.z1 - 3));
      p.kid = true;
      p.char.group.scale.setScalar(KID);
      setShirt(p.char, pick(SHIRTS));
      p.walkSpeed = 2.4;
      p.pg = { role: 'kid', task: null, t: 0 };
      this.kids.push(p);
      this.newTask(p);
    }
    const seats = [...S.seats].sort(() => Math.random() - 0.5);
    for (let k = 0; k < parents; k++) {
      const s = seats[k];
      const p = add(s.x, s.z);
      s.who = p;
      p.heading = s.h;
      p.pg = { role: 'sit', seat: s };
      this.adults.push(p);
    }
    const ps = [...S.plazaSeats].sort(() => Math.random() - 0.5);
    for (let k = 0; k < sitters; k++) {
      const s = ps[k];
      const p = add(s.x, s.z);
      s.who = p;
      p.heading = s.h;
      p.pg = { role: 'sit', seat: s };
      this.adults.push(p);
    }
  }

  clear() {
    for (const p of [...this.kids, ...this.adults]) if (!p.removed) p.dispose();
    this.kids = [];
    this.adults = [];
    this.free();
  }

  free() {
    const S = this.site;
    for (const s of [...S.seats, ...S.plazaSeats]) if (s.who && (s.who.removed || s.who.state !== 'play')) s.who = null;
    for (const w of S.swings) if (w.who && (w.who.removed || w.who.state !== 'play')) w.who = null;
  }

  // Anyone scared off is out of the park (kids: off the equipment, onto the ground).
  drop() {
    for (const list of [this.kids, this.adults]) {
      for (const p of [...list]) {
        if (p.state === 'play' && !p.removed) continue;
        list.splice(list.indexOf(p), 1);
        p.keep = false;
        p.sidewalk = true;
        p.act = null;
        bendLeg(p.char.legL, p.char.kneeL, 0, 0);
        bendLeg(p.char.legR, p.char.kneeR, 0, 0);
        if (p.pg?.seat) p.z += Math.cos(p.pg.seat.h) * 0.8;
      }
    }
    this.free();
  }

  // The moving equipment: swings, the seesaw, the merry-go-round.
  animate(dt) {
    const S = this.site;
    for (const w of S.swings) {
      // Pumping up while someone's on; swinging down to a stop when they're off.
      w.amp = w.who ? Math.min(0.85, w.amp + dt * 0.18) : Math.max(0, w.amp - dt * 0.25);
      w.t += dt * 2.2;
      w.a = Math.sin(w.t) * w.amp;
      w.piv.rotation.x = -w.a;
    }
    const riders = this.kids.filter((p) => p.pg.task === 'merry' && p.pg.on).length;
    this.merrySpin = riders ? Math.min(1.6, this.merrySpin + dt * 0.8) : Math.max(0, this.merrySpin - dt * 0.5);
    S.merry.rotation.y += this.merrySpin * dt;
    const pair = this.kids.filter((p) => p.pg.task === 'seesaw' && p.pg.on).length === 2;
    this.seesawT += dt * 1.9;
    // (one alone sits on the ground end)
    const lone = this.kids.find((p) => p.pg.task === 'seesaw' && p.pg.on);
    const target = pair ? Math.sin(this.seesawT) * 0.3 : lone ? -lone.pg.end * 0.3 : 0;
    this.seesawA += (target - this.seesawA) * Math.min(1, dt * (pair ? 8 : 2));
    S.plank.rotation.z = this.seesawA;
  }

  // Something new to play on.
  newTask(p, not = null) {
    const S = this.site;
    const pg = p.pg;
    pg.on = false;
    pg.t = rand(14, 32);
    pg.step = 0;
    const options = TASKS.filter((t) => t !== not).filter((t) => {
      if (t === 'swing') return S.swings.some((w) => !w.who);
      if (t === 'seesaw') return this.kids.filter((q) => q.pg.task === 'seesaw').length < 2;
      if (t === 'merry') return this.kids.filter((q) => q.pg.task === 'merry').length < 4;
      if (t === 'sand') return this.kids.filter((q) => q.pg.task === 'sand').length < 2;
      return true;
    });
    pg.task = pick(options);
    if (pg.task === 'swing') {
      pg.swing = S.swings.find((w) => !w.who);
      pg.swing.who = p;
    } else if (pg.task === 'seesaw') {
      pg.end = this.kids.some((q) => q !== p && q.pg.task === 'seesaw' && q.pg.end === -1) ? 1 : -1;
    } else if (pg.task === 'merry') {
      pg.ang = rand(0, Math.PI * 2);
    } else if (pg.task === 'sand') {
      pg.spot = [SAND.x + rand(-1.3, 1.3), SAND.z + rand(-1.3, 1.3)];
    } else if (pg.task === 'climb') {
      pg.node = [pick(CLIMB.xs), pick(CLIMB.zs), pick(CLIMB.h)];
    } else if (pg.task === 'run') {
      pg.spot = this.openSpot();
    }
  }

  openSpot() {
    return [rand(PG.x0 + 2, PG.x1 - 2), rand(PG.z0 + 2, PG.z0 + 4.5)];
  }

  leave(p) {
    const pg = p.pg;
    if (pg.swing) {
      pg.swing.who = null;
      pg.swing = null;
    }
    this.newTask(p, pg.task);
  }

  // ---- Where each one goes (peds.js calls this every frame) ----
  drive(p, dt) {
    const pg = p.pg;
    if (pg.role === 'sit') return { speed: 0 };
    const go = (x, z, speed = 2.6) => (dist(p.x, p.z, x, z) > 0.35 ? { tx: x, tz: z, speed } : null);
    pg.t -= dt;
    pg.y = 0;
    pg.pose = null;
    const done = pg.t <= 0;
    const S = this.site;
    switch (pg.task) {
      case 'swing': {
        const w = pg.swing;
        if (!pg.on) {
          const g = go(w.x, SWING.z + 0.9);
          if (g) return g;
          pg.on = true;
        }
        if (done) {
          // (off when it's low)
          if (w.amp < 0.2) {
            p.z = SWING.z + 1;
            p.x = w.x;
            this.leave(p);
            return { speed: 0 };
          }
          w.who = null; // (stops pumping)
        }
        p.x = w.x;
        p.z = SWING.z + Math.sin(w.a) * SWING.rope;
        pg.y = SWING.top - Math.cos(w.a) * SWING.rope + 0.03;
        p.heading = 0;
        pg.pose = 'swing';
        return { speed: 0 };
      }
      case 'slide': {
        // Up the ladder, along the platform, down the chute; round again.
        const D = SLIDE;
        if (pg.step === 0) {
          const g = go(D.ladderX - 0.6, D.z);
          if (g) return g;
          if ((this.ladderBusy || 0) > this.game.time && this.ladderWho !== p) {
            p.heading = Math.PI / 2;
            return { speed: 0 };
          }
          this.ladderBusy = this.game.time + 2.2;
          this.ladderWho = p;
          pg.step = 1;
          pg.k = 0;
        }
        if (pg.step === 1) {
          pg.k += dt / 1.4;
          p.x = D.ladderX - 0.5 + pg.k * 0.6;
          p.z = D.z;
          pg.y = pg.k * D.top;
          p.heading = Math.PI / 2;
          pg.pose = 'climb';
          if (pg.k >= 1) {
            pg.step = 2;
            pg.k = 0;
          }
          return { speed: 0 };
        }
        if (pg.step === 2) {
          pg.k += dt / 0.6;
          p.x = D.ladderX + 0.1 + pg.k * (D.x0 - D.ladderX - 0.1);
          pg.y = D.top + 0.06;
          p.heading = Math.PI / 2;
          if (pg.k >= 1) {
            pg.step = 3;
            pg.k = 0;
          }
          return { speed: 0 };
        }
        if (pg.step === 3) {
          pg.k += dt / 1.1;
          const k = Math.min(1, pg.k);
          p.x = D.x0 + (D.x1 - D.x0) * k;
          const seat = D.top + (D.end - D.top) * k + 0.05;
          pg.y = seat - KID_HIP + 0.05;
          p.heading = Math.PI / 2;
          pg.pose = 'sit';
          if (pg.k >= 1) {
            p.x = D.x1 + 0.6;
            pg.step = done ? 9 : 0;
          }
          return { speed: 0 };
        }
        this.leave(p);
        return { speed: 0 };
      }
      case 'climb': {
        const [nx, nz, ny] = pg.node;
        if (!pg.on) {
          const g = go(nx, nz);
          if (g) return g;
          pg.on = true;
          pg.at = [nx, nz, 0];
        }
        // Clambering from bar to bar.
        const [ax, az, ay] = pg.at;
        const d3 = Math.hypot(nx - ax, nz - az, ny - ay);
        if (d3 < 0.05) {
          if (done) {
            if (ny === 0 || pg.at[2] === 0) {
              this.leave(p);
              return { speed: 0 };
            }
            pg.node = [nx, nz, 0]; // (climb down)
          } else pg.node = [Math.max(CLIMB.xs[0], Math.min(CLIMB.xs[4], nx + pick([-2, 0, 2]))), Math.max(CLIMB.zs[0], Math.min(CLIMB.zs[3], nz + pick([-2, 0, 2]))), pick(CLIMB.h)];
        } else {
          const step = Math.min(d3, dt * 0.9);
          pg.at = [ax + ((nx - ax) / d3) * step, az + ((nz - az) / d3) * step, ay + ((ny - ay) / d3) * step];
        }
        p.x = pg.at[0];
        p.z = pg.at[1];
        pg.y = pg.at[2];
        if (Math.hypot(nx - ax, nz - az) > 0.1) p.heading = lerpAngle(p.heading, Math.atan2(nx - ax, nz - az), Math.min(1, dt * 5));
        pg.pose = pg.y > 0.2 ? 'climb' : null;
        return { speed: 0 };
      }
      case 'seesaw': {
        const W = SEESAW;
        const sx = W.x + pg.end * (W.half - 0.15);
        if (!pg.on) {
          const g = go(sx - pg.end * 0.6, W.z);
          if (g) return g;
          pg.on = true;
          pg.alone = 0;
        }
        const partner = this.kids.some((q) => q !== p && q.pg.task === 'seesaw' && q.pg.on);
        pg.alone = partner ? 0 : pg.alone + dt;
        if (done || pg.alone > 7) {
          p.x = sx - pg.end * 0.6;
          this.leave(p);
          return { speed: 0 };
        }
        const a = this.seesawA;
        p.x = W.x + pg.end * (W.half - 0.15) * Math.cos(a);
        p.z = W.z;
        // (three.js tilts +x up for a positive angle)
        pg.y = W.y + 0.12 + pg.end * (W.half - 0.15) * Math.sin(a) - KID_HIP + 0.02;
        p.heading = pg.end < 0 ? Math.PI / 2 : -Math.PI / 2; // (facing the middle)
        pg.pose = 'sit';
        return { speed: 0 };
      }
      case 'merry': {
        const M = MERRY;
        const r = M.r - 0.35;
        if (!pg.on) {
          const g = go(M.x + Math.sin(pg.ang) * (M.r + 0.5), M.z + Math.cos(pg.ang) * (M.r + 0.5));
          if (g) return g;
          pg.on = true;
          pg.ang -= S.merry.rotation.y;
        }
        if (done && this.merrySpin < 0.6) {
          const a = pg.ang + S.merry.rotation.y;
          p.x = M.x + Math.sin(a) * (M.r + 0.5);
          p.z = M.z + Math.cos(a) * (M.r + 0.5);
          this.leave(p);
          return { speed: 0 };
        }
        // (riding round with the disc, facing the middle, holding the rail)
        const a = pg.ang + S.merry.rotation.y;
        p.x = M.x + Math.sin(a) * r;
        p.z = M.z + Math.cos(a) * r;
        pg.y = 0.26;
        p.heading = a + Math.PI;
        pg.pose = 'hold';
        return { speed: 0 };
      }
      case 'sand': {
        if (!pg.on) {
          const g = go(...pg.spot);
          if (g) return g;
          pg.on = true;
        }
        if (done) {
          this.leave(p);
          return { speed: 0 };
        }
        pg.y = 0.15;
        pg.pose = 'dig';
        return { speed: 0 };
      }
      default: {
        // Running about (chasing each other).
        const g = go(...pg.spot, 3.2);
        if (g) return g;
        if (done) {
          this.leave(p);
          return { speed: 0 };
        }
        pg.spot = this.openSpot();
        return { speed: 0 };
      }
    }
  }

  // Poses (peds.js calls this after the walk animation; returns the height off the ground).
  pose(p) {
    const pg = p.pg;
    const c = p.char;
    if (pg.role === 'sit') {
      bendLeg(c.legL, c.kneeL, 1.5, 1.5);
      bendLeg(c.legR, c.kneeR, 1.5, 1.5);
      c.armL.rotation.x = c.armR.rotation.x = -0.45;
      return pg.seat.y - 0.9;
    }
    const t = this.game.time;
    let y = (pg.y || 0) + 0.04;
    if (pg.pose === 'swing') {
      bendLeg(c.legL, c.kneeL, 1.4, 1.2 + Math.sin(t * 2.2) * 0.4);
      bendLeg(c.legR, c.kneeR, 1.4, 1.2 + Math.sin(t * 2.2) * 0.4);
      c.armL.rotation.x = c.armR.rotation.x = -2.7; // (hands on the ropes)
      y = pg.y - KID_HIP;
    } else if (pg.pose === 'sit') {
      bendLeg(c.legL, c.kneeL, 1.5, 0.3);
      bendLeg(c.legR, c.kneeR, 1.5, 0.3);
      c.armL.rotation.x = c.armR.rotation.x = -1.2;
      y = pg.y;
    } else if (pg.pose === 'climb') {
      c.armL.rotation.x = -2.8 + Math.sin(t * 6) * 0.3;
      c.armR.rotation.x = -2.8 - Math.sin(t * 6) * 0.3;
      bendLeg(c.legL, c.kneeL, 0.6 + Math.sin(t * 6) * 0.4, 1);
      bendLeg(c.legR, c.kneeR, 0.6 - Math.sin(t * 6) * 0.4, 1);
    } else if (pg.pose === 'hold') {
      c.armL.rotation.x = c.armR.rotation.x = -1.4;
    } else if (pg.pose === 'dig') {
      y += crouchPose(c, 1) * KID;
      c.armR.rotation.x = -1.2 + Math.sin(t * 7) * 0.5;
      c.armL.rotation.x = -0.8;
    }
    return y;
  }
}
