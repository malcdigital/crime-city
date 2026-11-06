import * as THREE from 'three';
import { makeCharacter, makePerson, setHeight, animateWalk, restPose, bendSpine, crouchPose, reachArm, SKIN_TONES } from './character.js';
import { aimPose, flinchPose } from './combatpose.js';
import { STORE_H } from './city.js';
import { DoorSet, doorLeaf } from './doors.js';
import { navStep } from './nav.js';
import { dist, pick, rand, lerpAngle } from './util.js';
import { signTexture } from './shops.js';
import { Robbery, STORE_GUNS } from './robbery.js';

// The stores you can rob (districts.js STORES), each a one-storey building you walk into
// (city.js leaves it hollow: city.storeHollows). Built here like the gun shops (interiors.js):
// its own walls, floor and ceiling, swing doors, the cutaway when the camera's outside behind
// you; lit from inside. Four kinds:
//   mart   - Corner 24/7, Quick Mart, Gas & Go: aisles, coolers, the counter by the door
//   market - Hilltop Market: the same, bigger and cleaner, a camera on the aisles, a guard
//   liquor - Liquor Barn, Night Owl Liquor: the clerk in a booth behind bulletproof glass
//   deli   - Late Nite Deli: a bodega, the deli case, the owner's cat on the counter
//   pawn   - Pawn King: glass cases, guns on the wall, the owner behind the cases
// Every one has a back room with the safe in it (in a liquor store's booth, the safe's in the
// booth). People: the clerk (and the guard), and customers who come and go. They're people on
// the street (peds.js Ped) for everything that can happen to them (shot, punched, knocked out,
// fighting you); while they're in here this file walks and poses them (Ped.inStore), and the
// stick-up is robbery.js.

const H = 3.6; // (the ceiling)
const SEE = 80; // (closer than this: the room's drawn)
const PEOPLE = 70; // (closer than this: the clerk and the customers are there)
const KINDS = {
  'Corner 24/7': 'mart', 'Quick Mart': 'mart', 'Gas & Go': 'mart', 'Hilltop Market': 'market',
  'Liquor Barn': 'liquor', 'Night Owl Liquor': 'liquor', 'Late Nite Deli': 'deli', 'Pawn King': 'pawn',
};
// Who works there: nerve 0..1 (how likely to stand up to you), what's under the counter.
const CLERKS = {
  'Corner 24/7': { name: 'Raj', nerve: 0.45, weapon: 'bat', skin: 0x8d5524, shirt: 0xc0392b },
  'Quick Mart': { name: 'Faisal', nerve: 0.55, weapon: 'pistol', skin: 0xa16e4b, shirt: 0x2e86c1 },
  'Gas & Go': { name: 'Darnell', nerve: 0.25, weapon: null, skin: 0x5c3a21, shirt: 0xd35400 },
  'Hilltop Market': { name: 'Megan', nerve: 0.2, weapon: null, skin: 0xf1c27d, shirt: 0x1e8449, female: true },
  'Liquor Barn': { name: 'Mr. Kim', nerve: 0.7, weapon: 'shotgun', skin: 0xe0ac69, shirt: 0x34495e },
  'Night Owl Liquor': { name: 'Mr. Park', nerve: 0.6, weapon: 'shotgun', skin: 0xe0ac69, shirt: 0x5d4037 },
  'Late Nite Deli': { name: 'Tony', nerve: 0.5, weapon: 'bat', skin: 0xc68642, shirt: 0xecf0f1 },
  'Pawn King': { name: 'Big Lou', nerve: 0.85, weapon: 'pistol', skin: 0xc68642, shirt: 0x7d3c98 },
};
// How many customers, most of the time (fewer late at night).
const CUSTOMERS = { mart: [1, 3], market: [2, 3], liquor: [1, 2], deli: [1, 2], pawn: [0, 1] };

// The rooms' own materials: lit from inside (they glow, more after dark).
const MATS = new Map();
function mat(color) {
  if (!MATS.has(color)) MATS.set(color, new THREE.MeshLambertMaterial({ color }));
  return MATS.get(color);
}
const TEXMATS = [];
function texMat(tex) {
  const m = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex });
  TEXMATS.push(m);
  return m;
}

// Canvas textures: shelves of goods, a cooler's bottles, a liquor wall, cigarettes, cases.
const TEX = {};
function canvasTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  draw(g, rnd);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX[key] = t;
  return t;
}
const GOODS = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#ecf0f1', '#1abc9c', '#d35400', '#c0392b'];
const shelfTex = () => canvasTex('shelf', 256, 128, (g, rnd) => {
  g.fillStyle = '#d9d4c7';
  g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 3; row++) {
    const y0 = 6 + row * 42;
    g.fillStyle = '#9a958a';
    g.fillRect(0, y0 + 34, 256, 5); // (the shelf edge)
    for (let x = 2; x < 254;) {
      const bw = 10 + Math.floor(rnd() * 18);
      const bh = 16 + Math.floor(rnd() * 16);
      g.fillStyle = GOODS[Math.floor(rnd() * GOODS.length)];
      g.fillRect(x, y0 + 34 - bh, bw - 2, bh);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x + 2, y0 + 36 - bh, bw - 6, 3);
      x += bw;
    }
  }
});
const coolerTex = () => canvasTex('cooler', 256, 256, (g, rnd) => {
  g.fillStyle = '#1b2a33';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 5; row++) {
    const y0 = 8 + row * 50;
    g.fillStyle = '#c9d6dc';
    g.fillRect(0, y0 + 42, 256, 3);
    for (let x = 4; x < 252; x += 12) {
      g.fillStyle = GOODS[Math.floor(rnd() * GOODS.length)];
      g.fillRect(x, y0 + 12, 8, 30);
      g.fillRect(x + 2, y0 + 6, 4, 8);
    }
  }
  g.fillStyle = 'rgba(200,235,255,.18)';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#8a9aa3';
  for (const x of [0, 126, 252]) g.fillRect(x, 0, 4, 256); // (the door frames)
});
const liquorTex = () => canvasTex('liquor', 256, 256, (g, rnd) => {
  g.fillStyle = '#3b2a1e';
  g.fillRect(0, 0, 256, 256);
  const glass = ['#7a3e12', '#a0522d', '#2e4d2e', '#d4c27a', '#5a1a1a', '#e8e0c8', '#3a5f7a'];
  for (let row = 0; row < 5; row++) {
    const y0 = 6 + row * 50;
    g.fillStyle = '#6b4a30';
    g.fillRect(0, y0 + 44, 256, 5);
    for (let x = 4; x < 252; x += 11) {
      g.fillStyle = glass[Math.floor(rnd() * glass.length)];
      const tall = 22 + Math.floor(rnd() * 10);
      g.fillRect(x, y0 + 44 - tall, 8, tall);
      g.fillRect(x + 3, y0 + 36 - tall, 2, 10);
      g.fillStyle = '#efe6d0';
      g.fillRect(x + 1, y0 + 30 - tall / 3, 6, 5); // (the label)
    }
  }
});
const smokesTex = () => canvasTex('smokes', 256, 128, (g, rnd) => {
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, 0, 256, 128);
  const packs = ['#ecf0f1', '#c0392b', '#f1c40f', '#2980b9', '#27ae60', '#8e44ad'];
  for (let y = 4; y < 124; y += 20) for (let x = 4; x < 252; x += 14) {
    g.fillStyle = packs[Math.floor(rnd() * packs.length)];
    g.fillRect(x, y, 11, 16);
    g.fillStyle = '#111';
    g.fillRect(x + 2, y + 10, 7, 3);
  }
});
const caseTex = () => canvasTex('case', 128, 64, (g, rnd) => {
  g.fillStyle = '#2a1a33';
  g.fillRect(0, 0, 128, 64);
  for (let k = 0; k < 26; k++) {
    g.fillStyle = rnd() < 0.6 ? '#f5c542' : '#d8dde3';
    const x = rnd() * 120;
    const y = rnd() * 56;
    g.beginPath();
    g.arc(x + 4, y + 4, 2 + rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
});
const deliTex = () => canvasTex('deli', 256, 64, (g, rnd) => {
  g.fillStyle = '#efe9dc';
  g.fillRect(0, 0, 256, 64);
  const meats = ['#c0392b', '#e8a598', '#d35400', '#f5cba7', '#f4d03f', '#a04000'];
  for (let x = 4; x < 252; x += 30) {
    g.fillStyle = meats[Math.floor(rnd() * meats.length)];
    g.fillRect(x, 20, 26, 30);
    g.fillStyle = '#fff';
    g.fillRect(x + 6, 52, 14, 8); // (a price tag)
  }
});

export class StoreRooms {
  constructor(game) {
    this.game = game;
    this.rooms = [];
    this.inside = null;
    this.robbery = new Robbery(game, this);
    const city = game.city;
    for (const store of city.stores) {
      if (!store.hollow) continue;
      this.rooms.push(this.build(store, store.hollow));
    }
    // (the floors: level, at the door's height)
    const g0 = city.groundY;
    city.groundY = (x, z) => {
      for (const r of this.rooms) {
        if (Math.abs(x - r.cx) > 16 || Math.abs(z - r.cz) > 16) continue;
        const [lx, lz] = this.local(r, x, z);
        if (Math.abs(lx) < r.w / 2 && lz > 0 && lz < r.d) return r.oy + 0.02;
      }
      return g0(x, z);
    };
    this.glowAt = -1;
  }

  // A point in the store's frame (x along the front, z in from the door), and back.
  local(r, x, z) {
    const dx = x - r.ox;
    const dz = z - r.oz;
    return [dx * r.X[0] + dz * r.X[1], -(dx * r.nx + dz * r.nz)];
  }
  world(r, lx, lz) {
    return [r.ox + r.X[0] * lx - r.nx * lz, r.oz + r.X[1] * lx - r.nz * lz];
  }
  // A heading in the world for a direction in the store's frame.
  heading(r, dx, dz) {
    return Math.atan2(r.X[0] * dx - r.nx * dz, r.X[1] * dx - r.nz * dz);
  }

  // ---- Building one ----
  build(store, hol) {
    const game = this.game;
    const city = game.city;
    const kind = KINDS[store.name] || 'mart';
    const prof = CLERKS[store.name] || CLERKS['Corner 24/7'];
    const r = {
      store, name: store.name, kind, prof, ox: hol.ox, oz: hol.oz, oy: hol.oy, nx: hol.nx, nz: hol.nz, X: [-hol.nz, hol.nx],
      w: hol.w, d: hol.d, front: [], cams: [], browse: [], customers: [], robbedN: 0, emptyUntil: 0,
    };
    const hw = (r.hw = hol.w / 2 - 0.2);
    const zb = (r.zb = hol.d - 0.2);
    const [ccx, ccz] = this.world(r, 0, hol.d / 2);
    r.cx = ccx;
    r.cz = ccz;
    const root = new THREE.Group();
    root.position.set(r.ox, r.oy, r.oz);
    root.rotation.y = Math.atan2(-r.nx, -r.nz);
    game.scene.add(root);
    root.updateMatrixWorld(true);
    r.root = root;
    const _p = new THREE.Vector3();
    const _q = new THREE.Vector3();
    const glass = new THREE.MeshLambertMaterial({ color: 0xb8d8e8, transparent: true, opacity: 0.25, depthWrite: false });
    const outsideMat = new THREE.MeshLambertMaterial({ color: kind === 'market' ? 0xd8cdb8 : 0xe8d9b5 });
    // A box in the store's frame. solid: you can't walk through it; stops: bullets and the
    // camera don't either; front: part of the front wall (fades for the cutaway).
    const box = (x0, x1, y0, y1, z0, z1, m, { solid = false, stops = solid, front = false } = {}) => {
      let mm = typeof m === 'number' ? mat(m) : m;
      if (front) {
        const own = [...MATS.values()].includes(mm);
        mm = mm.clone();
        mm.userData = { glow: own };
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mm);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      root.add(mesh);
      if (front) r.front.push(mesh);
      let b = null;
      if (solid || stops) {
        root.localToWorld(_p.set((x0 + x1) / 2, 0, (z0 + z1) / 2));
        root.localToWorld(_q.set((x0 + x1) / 2 + 1, 0, (z0 + z1) / 2)).sub(_p);
        const a = Math.atan2(_q.z, _q.x);
        const c = Math.abs(Math.cos(a));
        const s = Math.abs(Math.sin(a));
        const hx = (x1 - x0) / 2;
        const hz = (z1 - z0) / 2;
        const ex = c * hx + s * hz;
        const ez = s * hx + c * hz;
        b = { minX: _p.x - ex, maxX: _p.x + ex, minZ: _p.z - ez, maxZ: _p.z + ez, h: y1 - y0, y0: r.oy + y0 };
        if (Math.min(c, s) > 1e-4) b.ob = { cx: _p.x, cz: _p.z, hx, hz, c: Math.cos(a), s: Math.sin(a) };
        b.room = r;
        if (front) b.cut = r;
        if (solid) city.colliders.push(b);
        if (stops) city.los.push(b);
      }
      mesh.userData.box = b;
      return mesh;
    };
    // A wall with openings [a0, a1, y0, y1] along it (alongX: along the front; else across).
    const wall = (alongX, a0, a1, t0, t1, holes, color, opts = {}) => {
      const piece = (p0, p1, y0, y1, o = opts) => {
        if (p1 - p0 < 1e-3 || y1 - y0 < 1e-3) return;
        if (alongX) box(p0, p1, y0, y1, t0, t1, color, o);
        else box(t0, t1, y0, y1, p0, p1, color, o);
      };
      let at = a0;
      for (const [h0, h1, y0, y1] of [...holes].sort((p, q) => p[0] - q[0])) {
        piece(at, h0, opts.low ?? 0, STORE_H);
        // (below the opening: a window's sill wall; under a doorway just the foundation, which
        // you walk over)
        piece(h0, h1, opts.low ?? 0, y0, y0 > 0 ? opts : { ...opts, solid: false, stops: false });
        piece(h0, h1, y1, STORE_H, y0 > 0 || !opts.solid ? opts : { ...opts, solid: false, stops: true });
        at = h1;
      }
      piece(at, a1, opts.low ?? 0, STORE_H);
    };
    r.doors = new DoorSet();
    const hang = (hinge, dir, opts, front = false) => {
      const d = r.doors.add(root, { hinge, dir, width: 0.88, height: opts.h, leaf: (w, h) => doorLeaf(w, h, opts) });
      if (front) d.pivot.traverse((m) => m.isMesh && r.front.push(m));
      return d;
    };
    const inner = { liquor: 0x7a6a58, deli: 0xe9dcc0, pawn: 0x4e4a5a, market: 0xf2efe8 }[kind] || 0xe4e1d6;
    const floorC = { liquor: 0x5a4a3c, pawn: 0x3c3a40, market: 0xd8d8d0 }[kind] || 0xbdb7a8;
    const trim = 0x2b2b2b;

    // ---- The shell ----
    const WIN = [[-hw + 0.8, -1.7, 0.8, 2.8], [1.7, hw - 0.8, 0.8, 2.8]];
    const DOORWAY = [-0.9, 0.9, 0, 2.6];
    wall(true, -hw - 0.2, hw + 0.2, 0, 0.1, [...WIN, DOORWAY], outsideMat, { solid: true, front: true, low: -1.2 });
    wall(true, -hw, hw, 0.1, 0.2, [...WIN, DOORWAY], inner, { front: true });
    for (const [x0, x1, y0, y1] of WIN) {
      box(x0, x1, y0, y1, 0.06, 0.1, glass, { solid: true, stops: false, front: true });
      box(x0, x1, y0 - 0.08, y0, -0.1, 0.22, trim, { front: true });
      if (kind === 'liquor' || kind === 'pawn') {
        // (bars over the windows)
        for (let x = x0 + 0.25; x < x1; x += 0.35) box(x - 0.02, x + 0.02, y0, y1, -0.06, -0.02, 0x1a1a1a, { front: true });
      }
    }
    box(-1.0, 1.0, 2.6, 2.75, -0.1, 0.22, trim, { front: true });
    for (const sx of [-1, 1]) box(sx * 0.9 - 0.06, sx * 0.9 + 0.06, 0, 2.6, -0.1, 0.22, trim, { front: true });
    // (the sides and the back: outside walls, the store's walls inside them)
    wall(false, 0, hol.d, -hw - 0.2, -hw, [], outsideMat, { solid: true, low: -1.2 });
    wall(false, 0, hol.d, hw, hw + 0.2, [], outsideMat, { solid: true, low: -1.2 });
    wall(true, -hw - 0.2, hw + 0.2, zb, hol.d, [], outsideMat, { solid: true, low: -1.2 });
    box(-hw, -hw + 0.02, 0, H, 0.2, zb, inner);
    box(hw - 0.02, hw, 0, H, 0.2, zb, inner);
    box(-hw, hw, 0, H, zb - 0.02, zb, inner);
    // (the floor, the ceiling and its lights, the threshold, the mat)
    box(-hw, hw, -1.2, 0.02, 0.1, zb, floorC);
    box(-0.9, 0.9, -0.1, 0.02, -0.1, 0.2, trim);
    box(-hw, hw, H, H + 0.08, 0.1, zb, 0xdedad2);
    box(-0.8, 0.8, 0.02, 0.035, 0.4, 1.4, 0x3a3f46);
    const glow = new THREE.MeshBasicMaterial({ color: kind === 'liquor' || kind === 'pawn' ? 0xffe6b0 : 0xf4fbff });
    for (let z = 2.2; z < zb - 0.5; z += 3.4) for (let x = -hw + 2; x < hw - 1; x += 4) box(x - 0.6, x + 0.6, H - 0.04, H - 0.01, z - 0.2, z + 0.2, glow);
    // (the front doors: a pair of glass doors)
    const glassDoor = { h: 2.55, glass: 0xa9cfe0, frame: 0x1f1f1f };
    hang([-0.9, 0.14], [1, 0], glassDoor, true);
    hang([0.9, 0.14], [-1, 0], glassDoor, true);
    // (OPEN in the window, a price poster)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), new THREE.MeshBasicMaterial({ map: signTexture('OPEN', '#b71c1c', '#fff') }));
    sign.position.set(2.4, 2.3, 0.04);
    sign.rotation.y = Math.PI;
    root.add(sign);
    r.openSign = sign;

    // ---- The back room (the safe), in the back right corner ----
    const glassBooth = kind === 'liquor';
    const BR = (r.back = { x0: hw - 4.4, x1: hw, z0: zb - 3.6, z1: zb, door: [hw - 3.6, hw - 2.7] });
    if (!glassBooth) {
      wall(true, BR.x0, BR.x1, BR.z0 - 0.08, BR.z0 + 0.08, [[BR.door[0], BR.door[1], 0, 2.4]], inner, { solid: true });
      wall(false, BR.z0, BR.z1, BR.x0 - 0.08, BR.x0 + 0.08, [], inner, { solid: true });
      box(BR.door[0] - 0.08, BR.door[1] + 0.08, 2.4, 2.52, BR.z0 - 0.1, BR.z0 + 0.1, trim);
      r.backDoor = hang([BR.door[0], BR.z0], [1, 0], { h: 2.35, panel: 0x6b5a48, frame: 0x1f1f1f });
      // (the lock: a closed door you can't push through, while he's locked himself in)
      r.lock = box(BR.door[0], BR.door[1], 0, 2.4, BR.z0 - 0.06, BR.z0 + 0.06, 0x000000, { solid: true, stops: false }).userData.box;
      r.lock.off = true;
      root.children[root.children.length - 1].visible = false;
      box(BR.x0 + 0.1, BR.x0 + 0.8, 0, 1.8, BR.z0 + 0.4, BR.z1 - 0.3, 0x8a7a5a, { solid: true }); // (shelves of stock)
      box(BR.x0 + 1.2, BR.x0 + 2.3, 0, 0.8, BR.z1 - 1.0, BR.z1 - 0.2, 0x7a5a32, { solid: true }); // (boxes)
    }
    // (the safe)
    const sx = hw - 0.7;
    const sz = zb - 0.7;
    box(sx - 0.45, sx + 0.45, 0, 0.95, sz - 0.4, sz + 0.4, 0x2f3338, { solid: true });
    box(sx - 0.12, sx + 0.12, 0.45, 0.69, sz - 0.42, sz - 0.39, 0xb0b4b8);
    r.safe = { x: sx - 0.95, z: sz, face: [1, 0] };

    // ---- The store itself ----
    const shelf = texMat(shelfTex());
    const cooler = texMat(coolerTex());
    const unit = (x, z0, z1) => {
      // (an aisle unit, along z: goods both sides)
      box(x - 0.45, x + 0.45, 0, 0.12, z0, z1, 0x6a6a6a, { solid: true });
      const m = box(x - 0.42, x + 0.42, 0.12, 1.55, z0, z1, shelf, { solid: true, stops: false });
      m.material = [shelf, shelf, mat(0xbdbdbd), mat(0xbdbdbd), mat(0x9a9a9a), mat(0x9a9a9a)];
      for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.2) {
        r.browse.push([x - 0.95, z, [1, 0]]);
        r.browse.push([x + 0.95, z, [-1, 0]]);
      }
    };
    const coolers = (x0, x1, z0, z1, faceX) => {
      const m = box(x0, x1, 0, 2.3, z0, z1, cooler, { solid: true, stops: false });
      const side = mat(0xd5dbe0);
      m.material = faceX ? [faceX > 0 ? cooler : side, faceX < 0 ? cooler : side, side, side, side, side] : [side, side, side, side, side, cooler];
      if (faceX) for (let z = z0 + 1; z < z1 - 0.6; z += 2.4) r.browse.push([faceX > 0 ? x1 + 0.7 : x0 - 0.7, z, [-faceX, 0]]);
      else for (let x = x0 + 1; x < x1 - 0.6; x += 2.4) r.browse.push([x, z0 - 0.7, [0, 1]]);
    };
    const counterAlongZ = (x0, x1, z0, z1) => {
      box(x0, x1, 0, 0.95, z0, z1, 0x7b5e3b, { solid: true });
      box(x0 - 0.05, x1 + 0.05, 0.95, 1.0, z0 - 0.05, z1 + 0.05, 0x3a3a3a);
    };
    const register = (x, z, rot = 0) => {
      const g = box(x - 0.22, x + 0.22, 1.0, 1.22, z - 0.2, z + 0.2, 0x262626);
      g.rotation.y = rot;
      box(x - 0.18, x + 0.18, 1.22, 1.36, z - 0.06, z + 0.04, 0x55707a).rotation.y = rot;
      r.register = { x, z };
    };
    const cam = (x, y, z, ax, az) => {
      // (a dome camera on the ceiling, a red light: shoot it out and it's blind)
      const g = new THREE.Group();
      g.position.set(x, y, z);
      root.add(g);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.26), mat(0xe5e5e5));
      body.position.set(0, -0.08, 0);
      body.rotation.y = Math.atan2(ax, az);
      body.rotation.x = 0.35;
      g.add(body);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      lens.position.set(ax * 0.14, -0.13, az * 0.14);
      g.add(lens);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      led.position.set(ax * 0.06, -0.02, az * 0.06);
      g.add(led);
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), mat(0x9a9a9a));
      g.add(mount);
      r.cams.push({ g, body, led, lx: x, ly: y - 0.1, lz: z, alive: true });
    };
    if (kind === 'mart' || kind === 'market' || kind === 'deli') {
      // The counter by the door on the right, the clerk behind it facing the aisles; the
      // cigarettes on the wall behind him; the back room behind that.
      const cx0 = hw - 3.0;
      const z1 = kind === 'deli' ? 4.6 : 5.4;
      counterAlongZ(cx0, cx0 + 0.8, 1.4, z1);
      register(cx0 + 0.4, 2.3);
      r.clerkSpot = { x: hw - 1.3, z: 3.2, face: [-1, 0] };
      r.counter = { x: cx0 - 0.9, z: 3.2 }; // (where you stand across from him)
      r.pay = [cx0 - 0.75, 2.6, [1, 0]];
      const sm = texMat(smokesTex());
      box(hw - 0.32, hw - 0.04, 1.15, 2.4, 1.4, z1, sm).material = [mat(0x2a2a2a), sm, mat(0x2a2a2a), mat(0x2a2a2a), mat(0x2a2a2a), mat(0x2a2a2a)];
      box(cx0 + 0.1, cx0 + 0.7, 1.0, 1.06, z1 - 0.9, z1 - 0.2, 0xf5f5f5); // (the lottery tickets)
      // (aisles, coolers along the back and the left)
      const xs = kind === 'market' ? [-hw + 2.4, -hw + 5.0, -hw + 7.6].filter((x) => x < cx0 - 1.6) : [-hw + 2.6, -hw + 5.4].filter((x) => x < cx0 - 1.6);
      const aisleEnd = kind === 'deli' ? zb - 3.6 : zb - 2.4;
      for (const x of xs) unit(x, 3.0, aisleEnd);
      coolers(-hw, BR.x0 - 0.2, zb - 0.75, zb, 0);
      coolers(-hw, -hw + 0.75, 1.6, zb - 1.0, 1);
      if (kind === 'deli') {
        // (the deli case across the back-left: meats under glass, a slicer on top)
        const dm = texMat(deliTex());
        box(-hw + 1.0, BR.x0 - 0.6, 0, 0.75, zb - 2.6, zb - 1.8, 0xd5d5d5, { solid: true });
        box(-hw + 1.0, BR.x0 - 0.6, 0.75, 1.25, zb - 2.6, zb - 1.8, dm).material = [glass, glass, glass, glass, dm, glass];
        box(-hw + 2, -hw + 2.5, 1.25, 1.5, zb - 2.3, zb - 2.0, 0xb0b4b8);
        r.browse.push([-hw + 3, zb - 3.3, [0, 1]]);
        // (the cat, on the counter: Tony's)
        const cat = new THREE.Group();
        const fur = mat(0xe08a3c);
        const part = (w, h, d, x, y, z) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fur);
          m.position.set(x, y, z);
          cat.add(m);
          return m;
        };
        part(0.18, 0.14, 0.34, 0, 0.07, 0);
        part(0.14, 0.13, 0.13, 0, 0.16, 0.2);
        for (const ex of [-0.04, 0.04]) part(0.035, 0.05, 0.02, ex, 0.24, 0.2);
        r.catTail = part(0.035, 0.035, 0.28, 0, 0.12, -0.28);
        cat.position.set(cx0 + 0.4, 1.0, z1 - 0.5);
        cat.rotation.y = -Math.PI / 2;
        root.add(cat);
        r.cat = cat;
      }
      cam(hw - 0.4, H - 0.05, 0.6, -0.6, 0.8);
      if (kind === 'market') cam(-hw + 0.4, H - 0.05, zb - 0.6, 0.7, -0.7);
    } else if (kind === 'liquor') {
      // The booth: bulletproof glass from the counter to the ceiling across the back right,
      // the clerk in it, the bottles behind him; a pass-through tray in the glass. The rest:
      // bottles round the walls, an island, a cooler.
      const gz = 5.6;
      const gx0 = -1.4;
      box(gx0, hw, 0, 1.0, gz, gz + 0.6, 0x5a4030, { solid: true });
      box(gx0, hw, 1.0, 1.05, gz - 0.05, gz + 0.65, 0x2b2b2b);
      const bp = new THREE.MeshLambertMaterial({ color: 0xc8e4f0, transparent: true, opacity: 0.22, depthWrite: false });
      r.glass = { z: gz, x0: gx0, x1: hw, cracks: 0, mats: [bp] };
      r.glass.mesh = box(gx0, hw, 1.05, H, gz + 0.02, gz + 0.1, bp, { solid: true, stops: true });
      box(gx0 - 0.1, gx0, 0, H, gz, zb, inner, { solid: true, stops: true }); // (the booth's side: a wall)
      box(gx0, hw, H - 0.15, H, gz, gz + 0.12, trim);
      box(1.6, 2.4, 1.0, 1.12, gz - 0.25, gz + 0.65, 0x8a8f94); // (the tray through the glass)
      register(0.6, gz + 0.35);
      r.clerkSpot = { x: 1.8, z: gz + 1.4, face: [0, -1] };
      r.counter = { x: 1.8, z: gz - 0.9 };
      r.pay = [1.8, gz - 0.75, [0, 1]];
      const lm = texMat(liquorTex());
      box(gx0 + 0.1, hw - 0.1, 0.4, 2.8, zb - 0.45, zb - 0.05, lm).material = [mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), lm];
      box(-hw, -hw + 0.5, 0, 2.6, 1.2, zb - 1.0, lm, { solid: true }).material = [lm, mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e)];
      for (let z = 2.2; z < zb - 1.6; z += 2.4) r.browse.push([-hw + 1.2, z, [-1, 0]]);
      const isl = box(-hw + 2.4, -hw + 3.4, 0, 1.4, 2.4, gz - 0.2, lm, { solid: true, stops: false });
      isl.material = [lm, lm, mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e), mat(0x3b2a1e)];
      r.browse.push([-hw + 4.0, 3.4, [-1, 0]]);
      coolers(-hw + 0.6, gx0 - 0.4, zb - 0.75, zb, 0);
      cam(gx0 + 0.3, H - 0.05, gz - 0.3, -0.5, -0.8);
      r.safe = { x: hw - 1.65, z: zb - 0.7, face: [1, 0] };
    } else if (kind === 'pawn') {
      // Glass cases across the middle (gold and watches), the owner behind them, guitars and
      // guns on the wall behind him; a case along the left wall.
      const cz = 5.0;
      const cm = texMat(caseTex());
      const caseBox = (x0, x1, z0, z1) => {
        box(x0, x1, 0, 0.8, z0, z1, 0x3a2a1a, { solid: true });
        box(x0, x1, 0.8, 1.15, z0, z1, cm).material = [glass, glass, cm, glass, glass, glass];
      };
      caseBox(-4.2, 2.6, cz, cz + 0.7);
      caseBox(-4.2, -3.5, cz + 0.7, cz + 2.6);
      caseBox(-hw, -hw + 0.8, 1.6, 4.4);
      r.browse.push([-hw + 1.5, 2.4, [-1, 0]], [-hw + 1.5, 3.8, [-1, 0]], [-1.8, cz - 0.9, [0, 1]], [1.2, cz - 0.9, [0, 1]]);
      register(1.8, cz + 0.35);
      r.clerkSpot = { x: -0.6, z: cz + 1.5, face: [0, -1] };
      r.counter = { x: -0.6, z: cz - 0.9 };
      r.pay = [0.4, cz - 0.8, [0, 1]];
      // (the wall behind: guitars and guns)
      box(-hw + 0.2, BR.x0 - 0.3, 1.0, 3.0, zb - 0.06, zb - 0.02, 0x6e5a42);
      for (let k = 0; k < 4; k++) {
        const x = -hw + 1.2 + k * 1.1;
        box(x - 0.18, x + 0.18, 1.2, 1.75, zb - 0.16, zb - 0.08, [0x8e4b1e, 0x1f1f1f, 0xb03a2e, 0x6d4c2c][k]);
        box(x - 0.03, x + 0.03, 1.75, 2.55, zb - 0.14, zb - 0.1, 0x3b2a1a);
      }
      for (let k = 0; k < 3; k++) box(-hw + 5.8 + k * 0.7, -hw + 6.25 + k * 0.7, 2.2, 2.34, zb - 0.14, zb - 0.08, 0x222222);
      cam(-hw + 0.4, H - 0.05, 0.6, 0.6, 0.8);
      cam(hw - 4.8, H - 0.05, zb - 3.9, -0.4, -0.9);
    }
    // (the clerk's alarm button: under the counter, by his knee)
    r.alarm = { x: r.clerkSpot.x - r.clerkSpot.face[0] * 0.4, z: r.clerkSpot.z - r.clerkSpot.face[1] * 0.4 };
    // (the way out the door, and just outside it)
    r.door = [0, 0.9];
    r.outside = [0, -1.6];
    return r;
  }

  // ---- Every frame (main.js) ----
  update(dt) {
    const game = this.game;
    const p = game.player;
    const cam = game.camera.position;
    const was = this.inside;
    this.inside = null;
    for (const r of this.rooms) {
      const dc = Math.hypot(cam.x - r.cx, cam.z - r.cz);
      const show = dc < SEE;
      if (r.root.visible !== show) r.root.visible = show;
      const dp = Math.hypot(p.x - r.cx, p.z - r.cz);
      this.people(r, dp, dt);
      if (!p.vehicle && !p.high && dp < 14) {
        const [lx, lz] = this.local(r, p.x, p.z);
        if (Math.abs(lx) < r.hw + 0.1 && lz > 0.05 && lz < r.zb) {
          this.inside = r;
          r.lx = lx;
          r.lz = lz;
        }
      }
      if (!show) continue;
      if (dp < 40) {
        const pushers = [];
        if (!p.vehicle) pushers.push(p);
        for (const c of [r.clerk, r.guard, ...r.customers]) if (c && !c.removed && c.alive !== false) pushers.push(c);
        // (a locked back door stays shut)
        if (r.lock && !r.lock.off && r.backDoor) {
          r.doors.update(dt, pushers.filter((q) => {
            const [qx, qz] = this.local(r, q.x, q.z);
            return Math.abs(qz - r.back.z0) > 1.2 || qx < r.back.x0 - 0.5 || qx > r.back.door[1] + 1.4;
          }));
        } else r.doors.update(dt, pushers);
        if (r.catTail) r.catTail.rotation.y = Math.sin(game.time * 2.2) * 0.4;
        for (const c of r.cams) if (c.alive) c.led.visible = Math.floor(game.time * 1.5) % 2 === 0;
      }
    }
    if (was && was !== this.inside) this.cut(was, false, 1);
    this.glow();
    this.robbery.update(dt);
  }

  glow() {
    const n = Math.max(0, this.game.dayNight?.night ?? 0);
    if (Math.abs(n - this.glowAt) < 0.01) return;
    this.glowAt = n;
    const k = 0.2 + 0.6 * n;
    for (const m of MATS.values()) m.emissive.copy(m.color).multiplyScalar(k);
    for (const m of TEXMATS) m.emissive.setScalar(k);
    for (const r of this.rooms) for (const f of r.front) if (f.material.userData?.glow) f.material.emissive.copy(f.material.color).multiplyScalar(k);
  }

  // ---- The people in it ----
  // Near enough: the clerk at his post (the guard at the door), and customers who come and go;
  // far off, gone (they come back when you do).
  people(r, dp, dt) {
    const game = this.game;
    const here = dp < PEOPLE;
    if (!here) {
      if (dp > PEOPLE + 30) this.clearPeople(r);
      return;
    }
    if (!r.clerk || r.clerk.removed) {
      if (r.clerkGone && game.time < r.clerkGone) return; // (shot or hurt: nobody at the counter for a while)
      r.clerk = this.addPerson(r, 'clerk', r.clerkSpot.x, r.clerkSpot.z);
    }
    if (r.kind === 'market' && (!r.guard || r.guard.removed) && !(r.guardGone && game.time < r.guardGone)) r.guard = this.addPerson(r, 'guard', -2.2, 1.6);
    r.customers = r.customers.filter((c) => !c.removed && c.inStore);
    if (r.rob) return;
    // (customers: a few at a time, fewer late at night)
    r.custT = (r.custT ?? rand(0, 4)) - dt;
    if (r.custT > 0) return;
    r.custT = rand(8, 20);
    const m = game.clockMinutes?.() ?? 720;
    const late = m < 6 * 60 || m > 23 * 60;
    const [lo, hi] = CUSTOMERS[r.kind];
    const want = Math.max(0, Math.round(rand(lo, hi + 0.99) - (late ? 1 : 0)));
    if (r.customers.length >= Math.min(hi, want)) return;
    // (one walks in the door; when you're not around, they're just in there)
    const inside = dp > 25 || this.inside !== r;
    const [sx, sz] = inside ? pick(r.browse) : r.outside;
    const c = this.addPerson(r, 'customer', sx, sz);
    c.ss = 'browse';
    r.customers.push(c);
  }

  addPerson(r, role, lx, lz) {
    const game = this.game;
    const [x, z] = this.world(r, lx, lz);
    let char;
    let female = Math.random() < 0.45;
    if (role === 'clerk') {
      female = !!r.prof.female;
      char = makeCharacter({ shirt: r.prof.shirt, pants: 0x2a2a2a, skin: r.prof.skin, female });
      setHeight(char, r.prof.name === 'Big Lou' ? 1.9 : female ? 1.68 : 1.78);
    } else if (role === 'guard') {
      char = makeCharacter({ shirt: 0x1c2833, pants: 0x1c2833, skin: pick(SKIN_TONES), cap: 0x1c2833 });
      female = false;
    } else char = makePerson({ shirt: pick(GOODS.map((c) => parseInt(c.slice(1), 16))), pants: pick([0x22313f, 0x3b3b3b, 0x5d4037, 0x1b2631]), skin: pick(SKIN_TONES), female });
    game.scene.add(char.group);
    const p = game.peds.addAt(x, z, female, char);
    p.keep = true;
    p.sidewalk = false;
    p.state = 'store';
    p.ss = role === 'customer' ? 'browse' : 'post';
    p.storeRole = role;
    p.room = r;
    p.inStore = { step: (q, dt) => this.stepPerson(r, q, dt), scare: (q, fx, fz, gun) => this.scarePerson(r, q, fx, fz, gun) };
    if (role !== 'customer') {
      const w = role === 'guard' ? 'pistol' : r.prof.weapon;
      p.storeWeapon = w;
      p.nerve = role === 'guard' ? 0.6 : r.prof.nerve;
    } else {
      p.nerve = Math.random();
      p.browseT = rand(3, 8);
    }
    p.heading = this.heading(r, ...(role === 'clerk' ? r.clerkSpot.face : [0, 1]));
    p.walkSpeed = rand(1.1, 1.5);
    return p;
  }

  clearPeople(r) {
    for (const c of [r.clerk, r.guard, ...r.customers]) if (c && !c.removed && c.inStore) c.dispose();
    r.clerk = r.guard = null;
    r.customers = [];
  }

  // Someone leaves the store for the street: from here on they're an ordinary person outside.
  release(r, p, scared = false) {
    p.inStore = null;
    p.keep = false;
    p.sidewalk = true;
    p.room = null;
    r.customers = r.customers.filter((c) => c !== p);
    p.resumeWalking();
    if (scared) {
      const [fx, fz] = this.world(r, 0, 4);
      p.scare(fx, fz);
    }
  }

  // A shot or a fright (peds.js scare): robbery.js decides what they do.
  scarePerson(r, p, fx, fz, gun) {
    return this.robbery.scared(r, p, fx, fz, gun);
  }

  // Walk someone toward a spot in the store; true once they're there.
  walk(r, p, lx, lz, speed, dt) {
    const [tx, tz] = this.world(r, lx, lz);
    const d = dist(p.x, p.z, tx, tz);
    if (d < 0.25) {
      p.speed = 0;
      return true;
    }
    const s = Math.min(speed, d * 3 + 0.3);
    const h = navStep(p, tx, tz, s, dt, this.game, 0.3);
    if (h !== null) p.heading = lerpAngle(p.heading, h, Math.min(1, dt * 9));
    p.speed = s;
    return false;
  }

  // Walk a route of spots in turn (key: which route, so a new one starts from its first spot);
  // true once at the last.
  route(r, p, key, pts, speed, dt) {
    if (p.routeKey !== key) {
      p.routeKey = key;
      // (start from the first spot not behind us: the nearest one along the way)
      let best = 0;
      let bd = Infinity;
      pts.forEach(([x, z], i) => {
        const [wx, wz] = this.world(r, x, z);
        const d = dist(p.x, p.z, wx, wz);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      p.routeI = best;
    }
    const [x, z] = pts[p.routeI];
    if (this.walk(r, p, x, z, speed, dt)) {
      if (p.routeI >= pts.length - 1) return true;
      p.routeI++;
    }
    return false;
  }

  // The way from behind the counter to the back room (through its door), and on to a spot.
  toBack(r, lx, lz) {
    const B = r.back;
    const dc = (B.door[0] + B.door[1]) / 2;
    return [[r.clerkSpot.x, Math.min(r.clerkSpot.z + 2.5, B.z0 - 1.2)], [dc, B.z0 - 0.8], [dc, B.z0 + 0.9], [lx, lz]];
  }

  // Face a direction in the store (or a world point).
  face(r, p, dx, dz, dt, k = 8) {
    p.heading = lerpAngle(p.heading, this.heading(r, dx, dz), Math.min(1, dt * k));
  }
  facePoint(p, x, z, dt, k = 8) {
    p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * k));
  }

  // Each frame for someone in here (peds.js update, first): true if handled. Down, dead, in a
  // fight with you or coming round: the usual (peds.js).
  stepPerson(r, p, dt) {
    if (!p.standing || p.state === 'brawl' || p.groggy) return false;
    if (p.state !== 'store') {
      // (back on their feet after something: a customer gets out; staff back to work)
      if (p.storeRole === 'customer') p.ss = 'leave';
      else p.ss = r.rob ? p.ss : 'post';
      p.state = 'store';
    }
    const game = this.game;
    const c = p.char;
    p.speed = 0;
    let pose = null;
    const handled = this.robbery.stepPerson(r, p, dt);
    if (handled) pose = handled;
    else if (p.storeRole === 'customer') pose = this.customerIdle(r, p, dt);
    else if (p.storeRole === 'guard') {
      if (this.walk(r, p, -2.2, 1.6, 1.4, dt)) this.face(r, p, 0.3, 1, dt, 3);
      pose = 'stand';
    } else {
      // (the clerk: at his post behind the counter, watching the store)
      if (this.walk(r, p, r.clerkSpot.x, r.clerkSpot.z, 1.4, dt)) {
        const pl = game.player;
        if (this.inside === r) this.facePoint(p, pl.x, pl.z, dt, 3);
        else this.face(r, p, ...r.clerkSpot.face, dt, 3);
        pose = 'lean';
      }
    }
    this.place(r, p, dt, pose);
    return true;
  }

  // Shopping: from shelf to shelf, a look at each, now and then up to the counter, then out.
  customerIdle(r, p, dt) {
    if (p.ss === 'leave') {
      const [ox, oz] = r.outside;
      if (this.walk(r, p, ox, oz, p.walkSpeed, dt)) this.release(r, p);
      return null;
    }
    if (p.ss === 'browse') {
      p.spot ??= pick(r.browse);
      if (this.walk(r, p, p.spot[0], p.spot[1], p.walkSpeed, dt)) {
        p.ss = 'look';
        p.lookT = rand(2.5, 6);
      }
      return null;
    }
    if (p.ss === 'look') {
      this.face(r, p, ...p.spot[2], dt, 4);
      p.lookT -= dt;
      if (p.lookT <= 0) {
        p.browseT -= 1;
        if (p.browseT <= 0) {
          p.ss = 'pay';
          p.spot = r.pay;
        } else {
          p.ss = 'browse';
          p.spot = pick(r.browse);
        }
      }
      return 'browse';
    }
    if (p.ss === 'pay') {
      if (this.walk(r, p, p.spot[0], p.spot[1], p.walkSpeed, dt)) {
        this.face(r, p, ...p.spot[2], dt, 4);
        p.payT = (p.payT ?? 3) - dt;
        if (p.payT <= 0) p.ss = 'leave';
        return 'pay';
      }
      return null;
    }
    p.ss = 'browse';
    return null;
  }

  // Where they are and how they stand. pose: null (walking or standing), 'lean' (on the
  // counter), 'browse' (looking at the shelf), 'pay', 'hands' (hands up), 'cower', 'aim' (a gun
  // on you), 'bag' (filling a bag at the register), 'film' (phone up), 'dial' (at the safe),
  // 'reach' (a hand going under the counter), 'stand'.
  place(r, p, dt, pose) {
    const game = this.game;
    const c = p.char;
    p.phase += dt * p.speed * 4;
    animateWalk(c, p.phase, Math.min(1, p.speed / 1.5));
    let yOff = 0;
    const t = game.time + (p.id || 0);
    const gun = p.gunMesh;
    if (gun) gun.visible = pose === 'aim' || pose === 'draw';
    if (p.batMesh) p.batMesh.visible = pose === 'bat';
    if (p.phoneProp) p.phoneProp.visible = pose === 'film';
    if (p.bagMesh) p.bagMesh.visible = pose === 'bag' || pose === 'give';
    if (p.speed < 0.2) {
      if (pose === 'lean') {
        bendSpine(c, 0.14 + Math.sin(t * 1.6) * 0.02, 0, 0);
        c.armL.rotation.set(-0.7, 0, 0.12);
        c.elbowL.rotation.set(-0.75, 0, 0);
        c.armR.rotation.set(-0.7, 0, -0.12);
        c.elbowR.rotation.set(-0.75, 0, 0);
      } else if (pose === 'browse') {
        c.neck.rotation.set(0.2, Math.sin(t * 0.7) * 0.35, 0);
        c.armR.rotation.set(-0.5 + Math.max(0, Math.sin(t * 0.9)) * -0.7, 0, -0.1);
        c.elbowR.rotation.set(-0.8, 0, 0);
      } else if (pose === 'pay') {
        c.armR.rotation.set(-0.9, 0, -0.1);
        c.elbowR.rotation.set(-0.6, 0, 0);
      } else if (pose === 'hands') {
        // (hands up, palms out, shaking a little)
        const sh = Math.sin(t * 22) * 0.03;
        c.armL.rotation.set(-2.8 + sh, 0, 0.35);
        c.armR.rotation.set(-2.8 - sh, 0, -0.35);
        c.elbowL.rotation.set(-1.2, 0, 0);
        c.elbowR.rotation.set(-1.2, 0, 0);
        bendSpine(c, -0.08, 0, 0);
      } else if (pose === 'cower') {
        yOff = crouchPose(c, 1);
        c.armL.rotation.x = -2.7;
        c.armR.rotation.x = -2.7;
        c.elbowL.rotation.x = c.elbowR.rotation.x = -1.6;
      } else if (pose === 'aim' || pose === 'draw') {
        p.tw = aimPose(c, p.storeWeapon === 'shotgun' ? 'shotgun' : 'pistol', 0, game.time, 'R', 'two');
      } else if (pose === 'bat') {
        // (a bat up over the shoulder)
        c.armR.rotation.set(-2.6, 0, -0.3);
        c.elbowR.rotation.set(-1.4, 0, 0);
        c.armL.rotation.set(-2.2, 0, 0.4);
        c.elbowL.rotation.set(-1.6, 0, 0);
      } else if (pose === 'bag' || pose === 'give') {
        // (bent over the register stuffing a bag; giving it: held out)
        const k = pose === 'give' ? 0 : 1;
        bendSpine(c, 0.25 * k, 0, 0);
        c.armL.rotation.set(-1.0 - 0.3 * Math.sin(t * 7) * k, 0, 0.1);
        c.elbowL.rotation.set(-0.8, 0, 0);
        c.armR.rotation.set(-1.25, 0, -0.1);
        c.elbowR.rotation.set(-0.4 - 0.5 * k, 0, 0);
      } else if (pose === 'reach') {
        // (one hand still up, the other going down under the counter)
        bendSpine(c, 0.18, 0, 0.12);
        c.armL.rotation.set(-2.6, 0, 0.3);
        c.elbowL.rotation.set(-1.2, 0, 0);
        c.armR.rotation.set(0.15, 0, -0.25);
        c.elbowR.rotation.set(-0.2, 0, 0);
        yOff = -0.08;
      } else if (pose === 'film') {
        const b = Math.sin(t * 1.3) * 0.04;
        c.armR.rotation.set(-1.35 + b, 0, -0.35);
        c.armL.rotation.set(-1.3 + b, 0, 0.35);
        c.elbowR.rotation.set(-0.85, 0, 0);
        c.elbowL.rotation.set(-0.85, 0, 0);
      } else if (pose === 'dial') {
        yOff = crouchPose(c, 0.7);
        c.armR.rotation.set(-1.3, 0, -0.1);
        c.elbowR.rotation.set(-0.4, 0, 0);
        c.wristR.rotation.z = Math.sin(t * 6) * 0.6;
      }
    }
    if (pose !== 'aim' && pose !== 'draw') p.tw = 0;
    flinchPose(c, game.time);
    const y = game.city.groundY(p.x, p.z);
    c.group.position.set(p.x, y + yOff, p.z);
    c.group.rotation.x = 0;
    c.group.rotation.y = p.heading + (p.tw || 0);
  }

  // Their gun (or bat), in their right hand, made when they first go for it.
  arm(p) {
    const c = p.char;
    if (p.storeWeapon === 'bat') {
      if (!p.batMesh) {
        p.batMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.022, 0.8, 8), mat(0x9a6b3a));
        p.batMesh.position.set(0, -0.4, 0.02);
        c.wristR.add(p.batMesh);
      }
      return;
    }
    const g = STORE_GUNS[p.storeWeapon];
    if (!g || p.gunMesh) return;
    const [w, h, l] = g.size;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat(g.color));
    gun.position.set(0, -0.04, 0);
    gun.rotation.x = Math.PI / 2;
    c.wristR.add(gun);
    p.gunMesh = gun;
  }

  // A paper bag in the clerk's hands while he fills it.
  bag(p) {
    if (p.bagMesh) return;
    p.bagMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.14), mat(0xb08a5a));
    p.bagMesh.position.set(0, -0.14, 0.06);
    p.char.wristL.add(p.bagMesh);
  }

  // A phone in a customer's hands, filming you.
  phone(p) {
    if (p.phoneProp) return;
    p.phoneProp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.14, 0.012), mat(0x111111));
    p.phoneProp.position.set(-0.03, -0.12, 0.05);
    p.char.wristR.add(p.phoneProp);
  }

  // ---- Inside: what USE does and what the prompt says (main.js handleInteractions) ----
  interact(a) {
    return this.robbery.interact(a);
  }

  // Bullets in here (main.js tryFire, after the ray's been cast): a camera shot out, the booth
  // glass hit. Returns a nearer hit, or null.
  shot(ox, oy, oz, dx, dy, dz, maxT) {
    const r = this.inside || this.rooms.find((q) => Math.hypot(ox - q.cx, oz - q.cz) < 14);
    if (!r) return null;
    let best = null;
    for (const c of r.cams) {
      if (!c.alive) continue;
      const [wx, wz] = this.world(r, c.lx, c.lz);
      const wy = r.oy + c.ly;
      const tx = wx - ox;
      const ty = wy - oy;
      const tz = wz - oz;
      const t = tx * dx + ty * dy + tz * dz;
      if (t <= 0 || t >= maxT + 0.3) continue;
      const mx = ox + dx * t - wx;
      const my = oy + dy * t - wy;
      const mz = oz + dz * t - wz;
      if (mx * mx + my * my + mz * mz > 0.2 * 0.2) continue;
      if (!best || t < best.t) best = { t, cam: c, x: wx, y: wy, z: wz };
    }
    if (best) {
      this.robbery.camShot(r, best.cam);
      return best;
    }
    // (the booth glass: it holds, but it cracks)
    if (r.glass) {
      const [lox, loz] = this.local(r, ox, oz);
      const ldx = dx * r.X[0] + dz * r.X[1];
      const ldz = -(dx * r.nx + dz * r.nz);
      if (Math.abs(ldz) > 1e-4) {
        const t = (r.glass.z - loz) / ldz;
        const hx = lox + ldx * t;
        const hy = oy + dy * t - r.oy;
        if (t > 0 && t < maxT + 0.5 && hx > r.glass.x0 && hx < r.glass.x1 && hy > 1.05 && hy < H) {
          this.robbery.glassShot(r, hx, hy);
          const [wx, wz] = this.world(r, hx, r.glass.z);
          return { t, x: wx, y: r.oy + hy, z: wz, glass: true };
        }
      }
    }
    return null;
  }

  // The front wall, see-through (the cutaway) or not.
  cut(r, on, k = 0.2) {
    r.cutA ??= 1;
    r.cutA += ((on ? 0.12 : 1) - r.cutA) * k;
    const a = r.cutA;
    for (const m of r.front) {
      const mm = m.material;
      const base = mm.userData.a0 ?? (mm.userData.a0 = mm.opacity);
      const want = base * a;
      if (Math.abs(mm.opacity - want) < 1e-3) continue;
      mm.opacity = want;
      const see = a < 0.995 || base < 1;
      if (mm.transparent !== see) {
        mm.transparent = see;
        mm.depthWrite = !see;
        mm.needsUpdate = true;
      }
    }
  }

  // The camera may go out through this box (main.js): the store's front wall, from inside.
  camThrough(b) {
    return !!this.inside && b.cut === this.inside;
  }

  // The camera inside: under the ceiling; out behind you on the street, the front wall fades.
  camera(cam) {
    const r = this.inside;
    if (!r) return;
    const p = cam.position;
    p.y = Math.max(r.oy + 0.4, Math.min(r.oy + H - 0.2, p.y));
    const [, lz] = this.local(r, p.x, p.z);
    this.cut(r, lz < 0.25);
  }

  // A game you can quit (main.js activeGame): none here.
  activeGame() {
    return null;
  }
}
