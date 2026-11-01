import * as THREE from 'three';
import { makeCharacter, setHeight, lam } from './character.js';
import { WEAPONS } from './weapons.js';
import { pick } from './util.js';
import { signTexture, specLine, gunPrice } from './shops.js';
import { SHOP_FOOT, SHOP_H } from './city.js';
import { DoorSet, doorLeaf } from './doors.js';
import { gunModel as gunModelOf } from './gunmodels.js';
const gunModel = (id) => gunModelOf(id, imat); // (they glow a little, like the rest inside)

// Interiors: places you walk into. For now the gun shops (src/gunshops.js), each the ground floor
// of a real building in the city (city.js builds the floors above and leaves this one open:
// city.hollows). A store at the front door (a counter with the clerk behind it, a wall of guns
// behind him, glass cases on the walls, windows on the street) and, through a door in its side
// wall, an indoor range beside it (three lanes, paper targets at 5, 9 and 15 m).
//
// No loading, no fade: you walk in through the open door, and anyone after you can too. Its
// walls stop you and your bullets (city.colliders, city.los), the floor is its own (city.groundY),
// the camera stays under its ceiling, and when the camera's out on the street behind you the
// front wall fades away (the cutaway: main.js lets the camera through it).
//
// The store: walk up to the counter and talk to the clerk to buy (shops.js openGun: his racks,
// his prices); stand at a glass case for a gun's numbers, and ask him about it (the menu opens
// on it). Guns away in the store (unless the cops are after you); in a range lane you can shoot.
// A lane: free practice (the targets stand, every hit leaves a hole and its score) or, with USE,
// the challenge: 30 seconds of targets popping up one or two at a time, points by the ring times
// the distance; your best with each gun is kept, and a new best pays. Range ammo is on the house.

// The store, in the shop's frame (city.js SHOP_FOOT): x across (-W..SX), z in from the front
// door (0) to its back wall (BACK); the stockroom behind that.
const W = 7;
const SX = 6.85; // (the wall between the store and the range: SX..SX + 0.3)
const BACK = 11;
const H = 4; // (the ceiling)
const [FX0, FX1, FZ] = SHOP_FOOT; // (the whole building: x FX0..FX1, z -0.3..FZ - 0.3)
const ZB = FZ - 0.3; // (the back of the building)
const DOOR = 0.9; // (the front door: -DOOR..DOOR)
const SIDE_DOOR = [4.4, 6.2]; // (the door into the range, in the side wall)
const COUNTER = { x0: -5, x1: 2, z0: 7, z1: 7.8, h: 1.05 };
const CLERK = { x: -1.5, z: 9 };
// The range, in its own frame: x across (-W..W), z down the lanes from the wall it shares with
// the store (PART) to the berm at the end (D). In the shop's frame: x = RX + z, z = RC - x.
const PART = 11;
const RX = SX + 0.3 - PART;
const RC = 7;
const D = FX1 - 0.3 - RX;
const LANES = [-4.6, 0, 4.6];
const BOOTH = [12.6, 15.0]; // (the booths: a walkway behind them, room behind you for the camera)
const BENCH = 15.0;
const STAND_Z = 14.4;
const TARGET_Z = [STAND_Z + 5, STAND_Z + 9, STAND_Z + 15]; // (5, 9 and 15 m from where you stand)
const CHALLENGE_T = 30;
const BEST_KEY = 'crimecity.range.v1';
const SEE = 85; // (closer than this, its rooms are drawn: you can see in the windows)

// The shops' own materials: lit from inside (a glow that's stronger after dark: update), not
// by the point lights a room would need (every light costs every pixel in the city).
const IMATS = new Map();
function imat(color) {
  if (!IMATS.has(color)) IMATS.set(color, new THREE.MeshLambertMaterial({ color }));
  return IMATS.get(color);
}

// A paper target: a dark silhouette with scoring rings, on a white sheet (0.62 × 1.0 m).
let targetTex = null;
function targetTexture() {
  if (targetTex) return targetTex;
  const c = document.createElement('canvas');
  c.width = 124;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, 124, 200);
  g.fillStyle = '#1d2733';
  g.beginPath();
  g.arc(62, 40, 18, 0, Math.PI * 2); // (the head)
  g.fill();
  g.beginPath();
  g.moveTo(26, 200);
  g.lineTo(30, 78);
  g.quadraticCurveTo(62, 58, 94, 78);
  g.lineTo(98, 200);
  g.fill();
  g.strokeStyle = '#e8e2d0';
  g.lineWidth = 2;
  for (const r of [12, 26, 40, 56]) {
    g.beginPath();
    g.arc(62, 116, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#e8e2d0';
  g.font = 'bold 11px Arial';
  g.textAlign = 'center';
  g.fillText('10', 62, 120);
  targetTex = new THREE.CanvasTexture(c);
  targetTex.colorSpace = THREE.SRGBColorSpace;
  return targetTex;
}
// (where the rings are on the sheet, in its own meters: the chest at y 1.42, the head at 1.8)
const CHEST_Y = 1.42;
const HEAD_Y = 1.8;
function ringScore(dx, y) {
  if (Math.hypot(dx, y - HEAD_Y) < 0.1) return { pts: 10, head: true };
  const r = Math.hypot(dx, y - CHEST_Y);
  return { pts: r < 0.06 ? 10 : r < 0.13 ? 8 : r < 0.2 ? 6 : r < 0.28 ? 4 : 2, head: false };
}


export class Interiors {
  constructor(game) {
    this.game = game;
    this.rooms = [];
    this.inside = null;
    this.challenge = null;
    this.best = {};
    try {
      this.best = JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {};
    } catch {
      this.best = {};
    }
    const city = game.city;
    game.shops.gunShops.forEach((shop, i) => {
      const h = city.hollows?.[i];
      if (h) this.rooms.push(this.buildGunShop(shop, h));
    });
    // (its floors: level, its own height, wall to wall)
    const g0 = city.groundY;
    city.groundY = (x, z) => {
      for (const r of this.rooms) {
        if (Math.abs(x - r.cx) > 20 || Math.abs(z - r.cz) > 20) continue;
        const [lx, lz] = this.local(r, x, z);
        if (lx > FX0 && lx < FX1 && lz > -0.3 && lz < ZB) return r.oy + 0.02;
      }
      return g0(x, z);
    };
    this.glowAt = -1;
  }

  // A point in the shop's frame (x along the front, z in from the door), and back.
  local(r, x, z) {
    const dx = x - r.ox;
    const dz = z - r.oz;
    return [dx * r.X[0] + dz * r.X[1], -(dx * r.nx + dz * r.nz)];
  }
  world(r, lx, lz) {
    return [r.ox + r.X[0] * lx - r.nx * lz, r.oz + r.X[1] * lx - r.nz * lz];
  }

  // ---- Building a gun shop: in its building (city.hollows: where it is, which way it faces) ----
  buildGunShop(shop, hol) {
    const game = this.game;
    const scene = game.scene;
    const city = game.city;
    const r = { shop, i: shop.i, ox: hol.ox, oz: hol.oz, oy: hol.oy, nx: hol.nx, nz: hol.nz, X: [-hol.nz, hol.nx], cases: [], lanes: [], front: [], papers: [], greeted: false };
    const [ccx, ccz] = this.world(r, (FX0 + FX1) / 2, ZB / 2);
    r.cx = ccx;
    r.cz = ccz;
    // (the frame: +x along the front, +z in from the street; the range's turned a quarter, its
    // lanes running on along the street)
    const root = new THREE.Group();
    root.position.set(r.ox, r.oy, r.oz);
    root.rotation.y = Math.atan2(-r.nx, -r.nz);
    scene.add(root);
    r.root = root;
    const rg = new THREE.Group();
    rg.position.set(RX, 0, RC);
    rg.rotation.y = Math.PI / 2;
    root.add(rg);
    root.updateMatrixWorld(true);
    r.rangeInv = rg.matrixWorld.clone().invert();
    const L = shop.look;
    const outside = lam(0x4a4440); // (the ground floor's outside walls: lit like the street)
    const glass = new THREE.MeshLambertMaterial({ color: 0xb8d8e8, transparent: true, opacity: 0.28, depthWrite: false });
    const _p = new THREE.Vector3();
    const _q = new THREE.Vector3();
    // A box in a frame (the store's or the range's: x0..x1, y0..y1, z0..z1). solid: you can't
    // walk through it; stops: bullets (and the camera) don't either; front: part of the front
    // wall (it fades for the cutaway, the camera goes through it).
    // (its doors: swing doors you push through, doors.js)
    r.doors = new DoorSet();
    const hang = (hinge, dir, opts, front = false) => {
      const mats = [];
      const d = r.doors.add(root, { hinge, dir, width: 0.88, height: opts.h, leaf: (w, h) => doorLeaf(w, h, { ...opts, mats }) });
      if (front) d.pivot.traverse((m) => m.isMesh && r.front.push(m));
      return d;
    };
    const box = (x0, x1, y0, y1, z0, z1, color, { solid = false, stops = solid, mat = null, frame = root, front = false } = {}) => {
      let m = mat || (typeof color === 'number' ? imat(color) : color);
      if (front) {
        const own = [...IMATS.values()].includes(m);
        m = m.clone();
        m.userData = { glow: own }; // (its own copy, to fade; it glows like the rest inside)
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      frame.add(mesh);
      if (front) r.front.push(mesh);
      if (solid || stops) {
        frame.updateMatrixWorld(true);
        frame.localToWorld(_p.set((x0 + x1) / 2, 0, (z0 + z1) / 2));
        frame.localToWorld(_q.set((x0 + x1) / 2 + 1, 0, (z0 + z1) / 2)).sub(_p);
        const a = Math.atan2(_q.z, _q.x);
        const c = Math.abs(Math.cos(a));
        const s = Math.abs(Math.sin(a));
        const hx = (x1 - x0) / 2;
        const hz = (z1 - z0) / 2;
        const ex = c * hx + s * hz;
        const ez = s * hx + c * hz;
        const b = { minX: _p.x - ex, maxX: _p.x + ex, minZ: _p.z - ez, maxZ: _p.z + ez, h: y1 - y0, y0: r.oy + y0 };
        if (Math.min(c, s) > 1e-4) b.ob = { cx: _p.x, cz: _p.z, hx, hz, c: Math.cos(a), s: Math.sin(a) };
        b.room = r;
        if (front) b.cut = r; // (main.js: the camera goes through it from inside)
        if (solid) city.colliders.push(b);
        if (stops) city.los.push(b);
      }
      return mesh;
    };
    // A wall along x (z0..z1 thick) or along z (x0..x1 thick) with openings cut in it:
    // holes [a0, a1, y0, y1] along it.
    const wall = (alongX, a0, a1, t0, t1, holes, color, opts = {}) => {
      const piece = (p0, p1, y0, y1, o = opts) => {
        if (p1 - p0 < 1e-3 || y1 - y0 < 1e-3) return;
        if (alongX) box(p0, p1, y0, y1, t0, t1, color, o);
        else box(t0, t1, y0, y1, p0, p1, color, o);
      };
      let at = a0;
      for (const [h0, h1, y0, y1] of [...holes].sort((p, q) => p[0] - q[0])) {
        piece(at, h0, 0, SHOP_H);
        piece(h0, h1, 0, y0);
        // (over a doorway: it stops bullets, but you walk under it)
        piece(h0, h1, y1, SHOP_H, y0 > 0 || !opts.solid ? opts : { ...opts, solid: false, stops: true });
        at = h1;
      }
      piece(at, a1, 0, SHOP_H);
    };

    // ---- The shell ----
    // The front: the store's glass and its door, then the range's blank wall. Outside, a dark
    // storefront; inside, the store's walls.
    const WIN = [[-6.5, -1.5, 0.75, 2.9], [1.5, 6.4, 0.75, 2.9]];
    const DOORWAY = [-DOOR, DOOR, 0, 2.6];
    const storeFront = { solid: true, front: true };
    wall(true, FX0, SX + 0.3, -0.3, -0.12, [...WIN, DOORWAY], 0x2c2826, storeFront);
    wall(true, -W, SX, -0.12, 0, [...WIN, DOORWAY], L.walls, storeFront);
    for (const [x0, x1, y0, y1] of WIN) {
      box(x0, x1, y0, y1, -0.2, -0.16, null, { mat: glass, solid: true, stops: false, front: true });
      box(x0, x1, y0 - 0.08, y0, -0.34, 0.02, L.trim, { front: true }); // (the sill)
    }
    box(-DOOR - 0.1, DOOR + 0.1, 2.6, 2.75, -0.34, 0.02, L.trim, { front: true }); // (the door frame)
    for (const s of [-1, 1]) box(s * DOOR - 0.06, s * DOOR + 0.06, 0, 2.6, -0.34, 0.02, L.trim, { front: true });
    wall(true, SX + 0.3, FX1, -0.3, -0.12, [], outside, { solid: true });
    wall(true, SX + 0.3, FX1 - 0.3, -0.12, 0, [], 0x6d6e72, { stops: true });
    // The left side, the back and the far end.
    wall(false, -0.3, ZB, FX0, FX0 + 0.18, [], outside, { solid: true });
    wall(false, 0, BACK, FX0 + 0.18, -W, [], L.walls);
    wall(true, FX0, FX1, ZB - 0.18, ZB, [], outside, { solid: true });
    wall(true, SX + 0.3, FX1 - 0.3, ZB - 0.3, ZB - 0.18, [], 0x6d6e72);
    wall(false, -0.3, ZB, FX1 - 0.18, FX1, [], outside, { solid: true });
    // (the stockroom behind the store: closed off)
    box(-W, SX, 0, SHOP_H, BACK, ZB - 0.18, 0x5a5048, { solid: true });
    box(-W, SX, 0, SHOP_H, BACK - 0.02, BACK, L.walls);
    // The wall between the store and the range, the door through it.
    wall(false, 0, ZB - 0.18, SX, SX + 0.3, [[SIDE_DOOR[0], SIDE_DOOR[1], 0, 2.5]], L.walls, { solid: true });
    box(SX - 0.04, SX + 0.34, 2.5, 2.6, SIDE_DOOR[0] - 0.1, SIDE_DOOR[1] + 0.1, L.trim);
    // The doors: a pair of glass doors at the front, a pair of solid ones into the range.
    const glassDoor = { h: 2.55, glass: 0xa9cfe0, frame: 0x1f1f1f };
    hang([-DOOR, -0.15], [1, 0], glassDoor, true);
    hang([DOOR, -0.15], [-1, 0], glassDoor, true);
    const backDoor = { h: 2.45, panel: L.trim, frame: 0x1f1f1f };
    hang([SX + 0.15, SIDE_DOOR[0]], [0, 1], backDoor);
    hang([SX + 0.15, SIDE_DOOR[1]], [0, -1], backDoor);
    box(SX - 0.25, SX - 0.02, 2.75, 3.15, (SIDE_DOOR[0] + SIDE_DOOR[1]) / 2 - 0.5, (SIDE_DOOR[0] + SIDE_DOOR[1]) / 2 + 0.5, null, {
      mat: new THREE.MeshBasicMaterial({ map: signTexture('RANGE', '#1b1b1b', '#ffd23f') }),
    }).rotation.y = -Math.PI / 2;
    // Floors and the ceiling.
    box(-W, SX, -0.1, 0.02, 0, BACK, L.floor);
    box(-DOOR, DOOR, -0.1, 0.02, -0.3, 0, L.trim); // (the threshold)
    box(SX, SX + 0.3, -0.1, 0.02, SIDE_DOOR[0], SIDE_DOOR[1], L.trim);
    box(FX0 + 0.18, FX1 - 0.18, H, SHOP_H, -0.12, ZB - 0.18, 0xd9d6cf);
    // (trim along the floor, the mat at the door)
    box(-W, -W + 0.05, 0, 0.18, 0, BACK, L.trim);
    box(-W, SX, 0, 0.18, BACK - 0.05, BACK, L.trim);
    box(-0.85, 0.85, 0.02, 0.035, 0.3, 1.3, 0x3a3f46);
    // (the lights: panels in the ceiling)
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (const z of [2.5, 6, 9.5]) for (const x of [-4, 0, 4]) box(x - 0.7, x + 0.7, H - 0.04, H - 0.01, z - 0.35, z + 0.35, 0, { mat: glow });
    // (a sign over the wall of guns)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.98), new THREE.MeshBasicMaterial({ map: signTexture(shop.sign, shop.signBg, '#fff') }));
    sign.position.set(-2.5, 3.35, BACK - 0.03);
    sign.rotation.y = Math.PI;
    root.add(sign);
    // The counter: wood below, glass on top (guns inside), the register.
    box(COUNTER.x0, COUNTER.x1, 0, 0.92, COUNTER.z0, COUNTER.z1, L.trim, { solid: true });
    box(COUNTER.x0, COUNTER.x1, 0.92, COUNTER.h, COUNTER.z0, COUNTER.z1, 0, { mat: glass });
    box(1.0, 1.5, COUNTER.h, COUNTER.h + 0.28, 7.2, 7.6, 0x2b2b2b); // (the register)
    // (the gate at the end of the counter: staff only)
    box(COUNTER.x1, COUNTER.x1 + 0.12, 0, 1.0, COUNTER.z0, BACK, L.trim, { solid: true });
    box(COUNTER.x0 - 2.0, COUNTER.x0, 0, 1.0, COUNTER.z0, COUNTER.z0 + 0.12, L.trim, { solid: true });
    // (guns under the counter glass)
    shop.stock.slice(0, 4).forEach((id, k) => {
      const m = gunModel(id);
      m.rotation.x = -Math.PI / 2;
      m.position.set(COUNTER.x0 + 0.9 + k * 1.6, 0.95, (COUNTER.z0 + COUNTER.z1) / 2);
      root.add(m);
    });
    // The wall of guns behind the counter: a pegboard, everything he stocks, two rows.
    box(-6.6, 1.6, 0.9, 3.0, BACK - 0.06, BACK - 0.02, 0x9a8a6e);
    shop.stock.forEach((id, k) => {
      const m = gunModel(id);
      m.rotation.y = Math.PI; // (facing the store)
      const row = k % 2;
      const col = Math.floor(k / 2);
      m.position.set(-5.6 + col * 2.4 + row * 1.0, 2.45 - row * 0.85, BACK - 0.1);
      m.scale.setScalar(1.25);
      root.add(m);
    });
    // Glass cases on the walls, a gun in each (the shop's stock round them): two on the left,
    // one on the right (the range's door's there too).
    const caseSpots = [[-6.1, 3.0, 1], [-6.1, 5.4, 1], [SX - 0.75, 2.4, -1]];
    caseSpots.forEach(([x, z, side], k) => {
      const id = shop.stock[k % shop.stock.length];
      box(x - 0.55, x + 0.55, 0, 0.85, z - 0.95, z + 0.95, L.trim, { solid: true });
      box(x - 0.55, x + 0.55, 0.85, 1.25, z - 0.95, z + 0.95, 0, { mat: glass });
      box(x - 0.5, x + 0.5, 0.85, 0.87, z - 0.9, z + 0.9, 0x5c1a1a); // (the felt)
      const m = gunModel(id);
      m.rotation.set(-Math.PI / 2, 0, (Math.PI / 2) * side);
      m.position.set(x, 0.9, z);
      root.add(m);
      // (where you stand to look at it: in front of the case)
      r.cases.push({ id, x: x + side * 1.1, z, gx: x, gz: z });
    });
    // (a bench, a poster or two: it's lived in)
    box(-3.4, -1.6, 0, 0.45, 0.6, 1.0, 0x4a3a2a, { solid: true });
    for (const [x, c, z] of [[-W + 0.01, 0xb03a2e, 7.9], [SX - 0.01, 0x2e5ab0, 8.4]]) box(x - 0.01, x + 0.01, 1.6, 2.6, z - 0.4, z + 0.4, c);
    // The clerk, behind the counter, facing the door.
    const ck = shop.clerk;
    const c = makeCharacter({ ...ck.look, female: !!ck.female });
    setHeight(c, ck.height || 1.8);
    c.group.position.set(CLERK.x, 0, CLERK.z);
    c.group.rotation.y = Math.PI;
    root.add(c.group);
    r.clerk = { c, t: Math.random() * 10, talkT: 0 };

    // ---- The range (its own frame) ----
    const R = { frame: rg };
    box(-W, W, -0.1, 0.02, PART, D, 0x55565a, R); // (concrete)
    box(-W, W, 0, SHOP_H, D - 0.02, D, 0x3b3328, R); // (the berm behind the targets)
    for (const z of [12.5, 16, 21, 26, 30.5]) box(-W + 0.4, W - 0.4, H - 0.05, H - 0.01, z - 0.06, z + 0.06, 0, { ...R, mat: glow });
    // (the booths: partitions between the lanes, the bench in front of you, numbers over them)
    for (const x of [-2.3, 2.3]) box(x - 0.06, x + 0.06, 0, 2.3, BOOTH[0], BENCH + 0.6, 0x6d6e72, { ...R, solid: true });
    box(-W, W, 0, 1.0, BENCH, BENCH + 0.6, 0x5a4a3a, { ...R, solid: true }); // (the bench: no further)
    LANES.forEach((lx, li) => {
      const lane = { i: li, x: lx, targets: [] };
      TARGET_Z.forEach((tz, k) => {
        // (staggered across the lane, so the near one doesn't hide the far ones)
        const ox = [-0.95, 0.2, 1.05][k];
        const pivot = new THREE.Group();
        pivot.position.set(lx + ox, 0, tz);
        rg.add(pivot);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), imat(0x2a2a2a));
        pole.position.set(0, 0.47, 0.02);
        pivot.add(pole);
        const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.0), new THREE.MeshLambertMaterial({ map: targetTexture(), side: THREE.DoubleSide, emissiveMap: targetTexture() }));
        r.papers.push(paper.material);
        paper.position.set(0, 1.45, 0);
        paper.rotation.y = Math.PI; // (facing the booths)
        pivot.add(paper);
        lane.targets.push({ pivot, paper, z: tz, ox, up: 1, goal: 1, holes: [] });
      });
      // (the lane number over the booth)
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshBasicMaterial({ map: signTexture(`${li + 1}`, '#222', '#ffd23f') }));
      n.position.set(lx, 3.78, BOOTH[0] + 0.02); // (up by the ceiling: out of your sights)
      n.rotation.y = Math.PI;
      rg.add(n);
      r.lanes.push(lane);
    });
    for (const lx of LANES) box(lx - 1.6, lx + 1.6, 0.02, 0.032, BENCH - 0.18, BENCH - 0.05, 0xffd23f, R); // (where you stand)
    return r;
  }

  // ---- Every frame (main.js) ----
  update(dt) {
    const game = this.game;
    const p = game.player;
    const cam = game.camera.position;
    // (which shop you're in, and which room: the store or the range)
    const was = this.inside;
    this.inside = null;
    let near = null;
    let nd = Infinity;
    for (const r of this.rooms) {
      const d = Math.hypot(cam.x - r.cx, cam.z - r.cz);
      const show = d < SEE;
      if (r.root.visible !== show) r.root.visible = show;
      if (d < nd) {
        nd = d;
        near = r;
      }
      if (p.vehicle || p.high || Math.abs(p.x - r.cx) > 20 || Math.abs(p.z - r.cz) > 20) continue;
      const [lx, lz] = this.local(r, p.x, p.z);
      if (lz < 0 || lz > ZB || lx < -W || lx > FX1) continue;
      this.inside = r;
      r.part = lx < SX + 0.15 ? 'store' : 'range';
      r.lx = lx;
      r.lz = lz;
    }
    this.glow();
    const r = this.inside;
    if (r !== was) {
      if (was) this.cut(was, false, 1);
      // (in the door: the clerk says hello, once a visit)
      if (r && !r.greeted) {
        r.greeted = true;
        r.clerk.talkT = 1.2;
        game.hud.toast(`${r.shop.clerk.name}: "${pick(r.shop.clerk.hi)}"`, '#ffd479');
      }
    }
    for (const room of this.rooms) {
      if (room !== r && room.greeted && Math.hypot(p.x - room.cx, p.z - room.cz) > 40) room.greeted = false;
    }
    // (the challenge is in your lane: step out of it and it's over)
    const C = this.challenge;
    if (C && (r !== C.room || this.laneAt(...this.rangeLocal(r, p.x, p.z)) !== C.lane)) this.stopChallenge(false, 'You left your lane: challenge over');
    if (!near || nd > SEE) return;
    // (its doors: whoever's walking through pushes them)
    const pushers = [];
    if (!p.vehicle) pushers.push(p);
    for (const c of game.characters()) {
      if (c.alive === false || c.vehicle || Math.abs(c.x - near.cx) > 25 || Math.abs(c.z - near.cz) > 25) continue;
      pushers.push(c);
    }
    near.doors.update(dt, pushers);
    this.clerkPose(near, dt);
    // (the targets: up or down, swinging there)
    for (const l of near.lanes) {
      for (const t of l.targets) {
        t.up += Math.sign(t.goal - t.up) * Math.min(Math.abs(t.goal - t.up), dt * 7);
        t.pivot.rotation.x = (1 - t.up) * (Math.PI / 2) * 0.98; // (down: flat, top away from you)
      }
    }
    if (this.challenge) this.challengeStep(dt);
  }

  // The lights inside: the rooms' materials glow (more after dark, when there's less light
  // from outside to see by).
  glow() {
    const n = Math.max(0, this.game.dayNight?.night ?? 0);
    if (Math.abs(n - this.glowAt) < 0.01) return;
    this.glowAt = n;
    const k = 0.2 + 0.6 * n;
    for (const m of IMATS.values()) m.emissive.copy(m.color).multiplyScalar(k);
    for (const r of this.rooms) for (const m of r.papers) m.emissive.setScalar(k);
    for (const r of this.rooms) for (const f of r.front) if (f.material.userData.glow) f.material.emissive.copy(f.material.color).multiplyScalar(k);
  }

  // A world point in the range's frame (x across the lanes, z down them).
  rangeLocal(r, x, z) {
    const [lx, lz] = this.local(r, x, z);
    return [RC - lz, lx - RX];
  }

  // The clerk: leaning on the counter, watching you, a gesture while he talks.
  clerkPose(r, dt) {
    const K = r.clerk;
    const c = K.c;
    K.t += dt;
    K.talkT = Math.max(0, K.talkT - dt);
    const game = this.game;
    const p = game.player;
    const talking = K.talkT > 0 || game.shops.menu?.shop === r.shop;
    // (his head to you, if you're in the store)
    const [lx, lz] = this.local(r, p.x, p.z);
    const inStore = this.inside === r && r.part === 'store';
    const want = inStore ? Math.atan2(lx - CLERK.x, lz - CLERK.z) - Math.PI : 0;
    const yaw = Math.atan2(Math.sin(want), Math.cos(want));
    const br = Math.sin(K.t * 1.6) * 0.02; // (breathing)
    c.spine.rotation.set(0.12 + br, Math.max(-0.5, Math.min(0.5, yaw * 0.3)), 0);
    c.chest.rotation.set(0.05, 0, 0);
    c.neck.rotation.set(-0.05, Math.max(-0.9, Math.min(0.9, yaw * 0.6)), 0);
    // (the hands on the counter; talking, one comes up)
    c.armL.rotation.set(-0.75, 0, 0.12);
    c.elbowL.rotation.set(-0.7, 0, 0);
    c.armR.rotation.set(-0.75, 0, -0.12);
    c.elbowR.rotation.set(-0.7, 0, 0);
    if (talking) {
      const g = Math.sin(K.t * 5);
      c.armR.rotation.set(-1.1 + g * 0.15, 0.2, -0.25);
      c.elbowR.rotation.set(-1.3 + g * 0.2, 0, 0);
    }
    c.legL.rotation.set(0, 0, 0.04);
    c.legR.rotation.set(0, 0, -0.04);
  }

  // ---- Inside: what USE does, what the prompt says (main.js handleInteractions). True while
  // you're inside; armed(): whether your guns are out ----
  interact(a) {
    const game = this.game;
    const r = this.inside;
    if (!r) return false;
    const p = game.player;
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    if (r.part === 'store') {
      const lx = r.lx;
      const lz = r.lz;
      // (the clerk, across the counter)
      if (lz > COUNTER.z0 - 1.6 && lz < COUNTER.z0 && lx > COUNTER.x0 && lx < COUNTER.x1) {
        game.prompt = `Press ${key} to talk to ${r.shop.clerk.name}`;
        if (pressed) this.talk(r);
        return true;
      }
      // (a glass case: its gun's numbers; ask him about it)
      const cs = r.cases.find((k) => Math.hypot(lx - k.x, lz - k.z) < 0.9);
      if (cs) {
        const w = WEAPONS.find((x) => x.id === cs.id);
        game.prompt = `Press ${key} to look at the ${w.name} · $${gunPrice(w.id, r.shop).toLocaleString('en-US')} · ${specLine(w)}`;
        if (pressed) this.talk(r, w.id);
      }
      return true;
    }
    // (a lane)
    const lane = this.laneAt(...this.rangeLocal(r, p.x, p.z));
    if (lane) {
      const w = game.arsenal.current();
      if (this.challenge) return true;
      const best = this.best[w.id] || 0;
      const last = this.lastHit && game.time - this.lastHit.at < 2.5 ? ` · last: ${this.lastHit.pts}${this.lastHit.head ? ' (head)' : ''} at ${this.lastHit.m} m` : '';
      if (w.melee) game.prompt = `Lane ${lane.i + 1}: get a gun out to shoot (range ammo's free)${last}`;
      else {
        game.prompt = `Press ${key} to start the 30-second challenge with the ${w.name} (best ${best}) · or just shoot${last}`;
        if (pressed) this.startChallenge(lane);
      }
    }
    return true;
  }

  // Your guns are out only in a lane (or with the cops after you).
  armed() {
    const r = this.inside;
    if (!r || this.game.stars > 0) return true;
    return r.part === 'range' && !!this.laneAt(...this.rangeLocal(r, this.game.player.x, this.game.player.z));
  }

  // Free ammo at the range.
  freeAmmo() {
    const r = this.inside;
    return !!r && r.part === 'range' && this.armed();
  }

  laneAt(lx, lz) {
    const r = this.inside;
    if (!r || r.part !== 'range' || lz < BOOTH[0] - 0.2 || lz > BENCH + 0.1) return null;
    return r.lanes.find((l) => Math.abs(lx - l.x) < 2.2) || null;
  }

  // Talking to the clerk: a line, then his menu (on the gun you asked about).
  talk(r, focus = null) {
    const game = this.game;
    const ck = r.shop.clerk;
    r.clerk.talkT = 1.5;
    const w = focus && WEAPONS.find((x) => x.id === focus);
    game.hud.toast(`${ck.name}: "${w ? `That's the ${w.name}. Want me to ring it up?` : pick(ck.hi)}"`, '#ffd479');
    const cash0 = game.cash + game.bank.balance;
    game.shops.onClose = () => {
      r.clerk.talkT = 1.2;
      const spent = cash0 > game.cash + game.bank.balance;
      game.hud.toast(`${ck.name}: "${pick(spent ? ck.bought : ck.bye)}"`, '#ffd479');
    };
    game.shops.openGun(r.shop, focus);
  }

  // ---- The range: your shots against the paper (main.js tryFire). The nearest standing
  // target this ray hits before t, or null ----
  rangeShot(ox, oy, oz, dx, dy, dz, maxT) {
    const r = this.inside;
    if (!r || r.part !== 'range') return null;
    const o = new THREE.Vector3(ox, oy, oz).applyMatrix4(r.rangeInv);
    const d = new THREE.Vector3(dx, dy, dz).transformDirection(r.rangeInv);
    if (d.z <= 1e-4) return null;
    let best = null;
    for (const l of r.lanes) {
      for (const t of l.targets) {
        if (t.up < 0.85) continue;
        const tt = (t.z - o.z) / d.z;
        if (tt <= 0 || tt >= maxT || (best && tt >= best.t)) continue;
        const x = o.x + d.x * tt - l.x - t.ox;
        const y = o.y + d.y * tt;
        if (Math.abs(x) > 0.31 || y < 0.95 || y > 1.95) continue;
        best = { t: tt, lane: l, target: t, x, y, wx: ox + dx * tt, wy: oy + dy * tt, wz: oz + dz * tt };
      }
    }
    if (!best) return null;
    // (the hole, and the score)
    const T = best.target;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hole.position.set(-best.x, best.y - 1.45, 0.003); // (on the sheet, the side facing you)
    T.paper.add(hole);
    T.holes.push(hole);
    if (T.holes.length > 40) T.paper.remove(T.holes.shift());
    const S = ringScore(best.x, best.y);
    const m = Math.round(T.z - STAND_Z);
    this.lastHit = { pts: S.pts, head: S.head, m, at: this.game.time };
    if (this.challenge && this.challenge.lane === best.lane && T.live) this.challengeHit(T, S, m);
    return best;
  }

  clearHoles(r) {
    for (const l of r.lanes) {
      for (const t of l.targets) {
        for (const h of t.holes) t.paper.remove(h);
        t.holes = [];
      }
    }
  }

  // ---- The challenge ----
  startChallenge(lane) {
    const game = this.game;
    const w = game.arsenal.current();
    if (w.melee) return;
    this.clearHoles(this.inside);
    for (const t of lane.targets) {
      t.goal = 0;
      t.live = false;
    }
    this.challenge = { lane, room: this.inside, wid: w.id, wname: w.name, t: -2.5, score: 0, hits: 0, shown: 0, next: 0.4 };
    document.body.classList.add('ranging'); // (its board: style.css)
  }

  challengeStep(dt) {
    const C = this.challenge;
    const game = this.game;
    C.t += dt;
    // (you swapped guns: it's another gun's challenge, so it ends)
    if (game.arsenal.current().id !== C.wid) return this.stopChallenge(false, 'You switched guns: challenge over');
    const left = Math.max(0, CHALLENGE_T - C.t);
    if (C.t < 0) {
      game.hud.sport?.(`RANGE · ${C.wname.toUpperCase()} · GET READY ${Math.ceil(-C.t)}`, null, 'Targets pop up: hit them before they drop · further out scores more');
      return;
    }
    if (C.t >= CHALLENGE_T) return this.stopChallenge(true);
    // (targets: one at a time at first, two at once in the second half; up for less as it goes)
    const life = 1.7 - 0.6 * (C.t / CHALLENGE_T);
    const want = C.t > CHALLENGE_T / 2 ? 2 : 1;
    for (const t of C.lane.targets) {
      if (t.live && game.time - t.liveAt > life) {
        t.live = false;
        t.goal = 0; // (missed: down it goes)
      }
    }
    C.next -= dt;
    const live = C.lane.targets.filter((t) => t.live);
    if (live.length < want && C.next <= 0) {
      const free = C.lane.targets.filter((t) => !t.live && t.up < 0.05);
      if (free.length) {
        const t = pick(free);
        t.live = true;
        t.liveAt = game.time + 0.12; // (counts from when it's up)
        t.goal = 1;
        C.shown++;
        C.next = 0.35 + Math.random() * 0.4;
      }
    }
    game.hud.sport?.(`RANGE · ${C.wname.toUpperCase()} · ${Math.ceil(left)}s · ${C.score} PTS`, { v: left / CHALLENGE_T, lo: 2, hi: 2 }, `Hit them before they drop · best ${this.best[C.wid] || 0}`);
  }

  challengeHit(T, S, m) {
    const C = this.challenge;
    const mult = m >= 14 ? 2 : m >= 8 ? 1.5 : 1;
    C.score += Math.round(S.pts * mult);
    C.hits++;
    T.live = false;
    T.goal = 0;
  }

  // Over (done: the time ran out; otherwise called off): the score, the best, the pay.
  stopChallenge(done, why = null) {
    const C = this.challenge;
    if (!C) return;
    const game = this.game;
    this.challenge = null;
    game.hud.sport?.(null);
    document.body.classList.remove('ranging');
    for (const t of C.lane.targets) {
      t.live = false;
      t.goal = 1; // (back up for practice)
    }
    if (!done) {
      if (why) game.hud.toast(why, '#ff8080');
      return;
    }
    const prev = this.best[C.wid] || 0;
    const name = C.room?.shop.clerk.name;
    if (C.score > prev) {
      this.best[C.wid] = C.score;
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(this.best));
      } catch {
        // Storage unavailable.
      }
      const pay = Math.min(500, Math.round(C.score / 20) * 10); // (half the score in dollars, up to $500)
      game.cash += pay;
      game.cred += 2;
      game.save?.();
      game.hud.toast(`NEW BEST with the ${C.wname}: ${C.score} pts (${C.hits}/${C.shown} hit) · +$${pay} +2 cred${name ? ` · ${name}: "Now that's shooting."` : ''}`, '#7ee081');
    } else game.hud.toast(`${C.wname}: ${C.score} pts (${C.hits}/${C.shown} hit) · best ${prev}`, '#ffd479');
  }

  // A game you can quit (main.js activeGame): the challenge.
  activeGame() {
    if (!this.challenge) return null;
    return { label: 'stop the range challenge', quit: () => this.stopChallenge(false, 'Challenge called off') };
  }

  // The front wall, see-through (the cutaway) or not; k: how far (eased by the caller).
  cut(r, on, k = 0.2) {
    r.cutA ??= 1;
    r.cutA += ((on ? 0.12 : 1) - r.cutA) * k;
    const a = r.cutA;
    for (const m of r.front) {
      const mat = m.material;
      const base = mat.userData.a0 ?? (mat.userData.a0 = mat.opacity);
      const want = base * a;
      if (Math.abs(mat.opacity - want) < 1e-3) continue;
      mat.opacity = want;
      const see = a < 0.995 || base < 1;
      if (mat.transparent !== see) {
        mat.transparent = see;
        mat.depthWrite = !see;
        mat.needsUpdate = true;
      }
    }
  }

  // The camera may go out through this box (main.js): the store's front wall, from inside.
  camThrough(b) {
    return b.cut === this.inside && this.inside?.part === 'store';
  }

  // The camera inside (main.js, after it's placed): under the ceiling; out on the street behind
  // you (it went through the front wall: main.js), the front wall fades.
  camera(cam) {
    const r = this.inside;
    if (!r) return;
    const p = cam.position;
    p.y = Math.max(r.oy + 0.4, Math.min(r.oy + H - 0.25, p.y));
    const [, lz] = this.local(r, p.x, p.z);
    this.cut(r, r.part === 'store' && lz < 0.1);
  }
}
