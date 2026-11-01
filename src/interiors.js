import * as THREE from 'three';
import { makeCharacter, setHeight, lam } from './character.js';
import { WEAPONS } from './weapons.js';
import { MAP } from './worldplan.js';
import { dist, pick } from './util.js';
import { signTexture, specLine, gunPrice } from './shops.js';

// Interiors: places you walk into. For now the gun shops (src/gunshops.js): a store up front
// (a counter with the clerk behind it, a wall of guns behind him, glass cases down both walls)
// and an indoor range out back (three lanes, paper targets at 5, 9 and 15 m).
//
// Each room is built off the edge of the map (past MAP, out of sight of the city): you go in
// through the shop's door (a quick fade) and come back out the same door. While you're in,
// the floor is the room's (city.groundY), its walls stop you and your bullets (city.colliders,
// city.los), the camera stays inside it, the light is the room's (daynight.js), and nothing
// from outside comes in.
//
// The store: walk up to the counter and talk to the clerk to buy (shops.js openGun: his racks,
// his prices); stand at a glass case for a gun's numbers, and ask him about it (the menu opens
// on it). No guns out in the store; in a range lane you can shoot. A lane: free practice (the
// targets stand, every hit leaves a hole and its score) or, with USE, the challenge: 30 seconds
// of targets popping up one or two at a time, points by the ring times the distance; your best
// with each gun is kept, and a new best pays. Range ammo is on the house.

// The room, in its own frame: x across (-W..W), z in from the front door (0) to the back (D).
const W = 7;
const D = 32;
const H = 4;
const PART = 11; // (the wall between the store and the range)
const DOOR_X = [3.4, 5.4]; // (the door through it)
const COUNTER = { x0: -5, x1: 2, z0: 7, z1: 7.8, h: 1.05 };
const CLERK = { x: -1.5, z: 9 };
const LANES = [-4.6, 0, 4.6];
const BOOTH = [11.3, 15.0]; // (where you stand in a lane: room behind you for the camera)
const BENCH = 15.0;
const STAND_Z = 14.4;
const TARGET_Z = [STAND_Z + 5, STAND_Z + 9, STAND_Z + 15]; // (5, 9 and 15 m from where you stand)
const CHALLENGE_T = 30;
const BEST_KEY = 'crimecity.range.v1';

const _v = new THREE.Vector3();

// A gun to look at (on the wall, in a case): a few boxes in its colors, laid along +x.
function gunModel(id) {
  const g = new THREE.Group();
  const dark = 0x1c1c1c;
  const box = (w, h, d, x, y, z, c) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const C = { pistol: dark, revolver: 0x9aa0a6, mpistol: 0x262626, smg: 0x2a2a2a, shotgun: 0x5a3d22, rifle: 0x2b2f26, ak: 0x6b4423, hunting: 0x5a3d22 }[id] || dark;
  if (id === 'pistol' || id === 'revolver' || id === 'mpistol') {
    const L = id === 'revolver' ? 0.32 : 0.24;
    box(L, 0.06, 0.035, 0, 0.03, 0, id === 'revolver' ? C : dark); // (the slide / barrel)
    box(0.06, 0.11, 0.032, -L / 2 + 0.05, -0.05, 0, id === 'revolver' ? 0x4a2f1c : dark); // (the grip)
    if (id === 'revolver') box(0.07, 0.06, 0.05, -0.03, 0.02, 0, 0x7d8288); // (the cylinder)
    if (id === 'mpistol') box(0.03, 0.14, 0.028, 0.0, -0.09, 0, dark); // (the long mag)
  } else {
    const L = { smg: 0.55, shotgun: 0.95, rifle: 0.9, ak: 0.88, hunting: 1.12 }[id] || 0.8;
    box(L * 0.55, 0.07, 0.04, L * 0.12, 0.02, 0, id === 'ak' || id === 'shotgun' || id === 'hunting' ? dark : C); // (the receiver)
    box(L * 0.4, 0.025, 0.025, L * 0.55, 0.035, 0, dark); // (the barrel)
    box(L * 0.3, 0.09, 0.038, -L * 0.3, 0.0, 0, C); // (the stock)
    box(0.04, 0.09, 0.03, 0.02, -0.06, 0, dark); // (the grip)
    if (id === 'ak') box(0.05, 0.13, 0.03, L * 0.16, -0.08, 0, 0x2a2a2a); // (the curved mag, near enough)
    if (id === 'rifle' || id === 'smg') box(0.04, 0.12, 0.03, L * 0.15, -0.07, 0, dark);
    if (id === 'hunting') box(L * 0.28, 0.05, 0.05, L * 0.12, 0.09, 0, 0x111111); // (the scope)
    if (id === 'shotgun') box(L * 0.25, 0.05, 0.04, L * 0.35, -0.02, 0, 0x4a3420); // (the pump)
  }
  return g;
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
    this.fade = null;
    this.challenge = null;
    this.best = {};
    try {
      this.best = JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {};
    } catch {
      this.best = {};
    }
    const city = game.city;
    for (const shop of game.shops.gunShops) this.rooms.push(this.buildGunShop(shop, this.rooms.length));
    // (the rooms' floors: level, at their own height, wherever the hills would put it)
    const g0 = city.groundY;
    city.groundY = (x, z) => {
      for (const r of this.rooms) if (x > r.ox - W - 1 && x < r.ox + W + 1 && z > r.oz - 1 && z < r.oz + D + 1) return r.oy;
      return g0(x, z);
    };
    // (the black between outside and in)
    const f = document.createElement('div');
    f.id = 'fade';
    document.body.appendChild(f);
    this.fadeEl = f;
  }

  // ---- Building a gun shop ----
  buildGunShop(shop, i) {
    const game = this.game;
    const scene = game.scene;
    const city = game.city;
    // (off the map's east edge, one after another down it, well apart)
    const r = { shop, i, ox: MAP + 260 + i * 60, oz: 200, oy: 0, cases: [], lanes: [] };
    const root = new THREE.Group();
    root.position.set(r.ox, r.oy, r.oz);
    scene.add(root);
    r.root = root;
    const L = shop.look;
    const W2 = (lx, lz) => [r.ox + lx, r.oz + lz];
    // A box in the room's frame (x0..x1, y0..y1, z0..z1); solid: you can't walk through it,
    // stops: bullets don't either.
    const box = (x0, x1, y0, y1, z0, z1, color, { solid = false, stops = solid, mat = null } = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat || lam(color));
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      root.add(m);
      const [ax, az] = W2(x0, z0);
      const [bx, bz] = W2(x1, z1);
      const b = { minX: ax, maxX: bx, minZ: az, maxZ: bz, h: r.oy + y1, y0: r.oy + y0 };
      if (solid) city.colliders.push(b);
      if (stops) city.los.push(b);
      return m;
    };
    // Floor, ceiling and the shell.
    box(-W, W, -0.1, 0, 0, PART, L.floor); // (the store's floor)
    box(-W, W, -0.1, 0, PART, D, 0x55565a); // (the range: concrete)
    const ceil = box(-W, W, H, H + 0.1, 0, D, 0xd9d6cf);
    ceil.material.side = THREE.DoubleSide;
    const T = 0.3;
    box(-W - T, -W, 0, H, 0, D, L.walls, { solid: true });
    box(W, W + T, 0, H, 0, D, L.walls, { solid: true });
    box(-W, W, 0, H, -T, 0, L.walls, { solid: true }); // (the front, the door in it)
    box(-W, W, 0, H, D, D + T, 0x3b3328, { solid: true }); // (the back: a berm behind the targets)
    // (the partition between the store and the range, the door in it)
    box(-W, DOOR_X[0], 0, H, PART - 0.15, PART + 0.15, L.walls, { solid: true });
    box(DOOR_X[1], W, 0, H, PART - 0.15, PART + 0.15, L.walls, { solid: true });
    box(DOOR_X[0], DOOR_X[1], 2.6, H, PART - 0.15, PART + 0.15, L.walls, { solid: true });
    box(DOOR_X[0] + 0.1, DOOR_X[1] - 0.1, 2.5, 2.6, PART - 0.17, PART + 0.17, L.trim);
    // (trim along the walls, and the front door)
    for (const [x0, x1, z0, z1] of [[-W, -W + 0.05, 0, PART], [W - 0.05, W, 0, PART], [-W, W, 0.0, 0.05]]) box(x0, x1, 0, 0.18, z0, z1, L.trim);
    box(-0.8, 0.8, 0, 2.5, 0.0, 0.06, 0x2a2a2a); // (the door, from inside)
    box(-0.85, 0.85, 0.005, 0.02, 0.3, 1.3, 0x3a3f46); // (the mat)
    // (the lights: panels in the ceiling, and tubes over the lanes)
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (const z of [2.5, 6, 9.5]) for (const x of [-4, 0, 4]) box(x - 0.7, x + 0.7, H - 0.04, H - 0.01, z - 0.35, z + 0.35, 0, { mat: glow });
    for (const z of [12.5, 16, 21, 26, 30.5]) box(-W + 0.4, W - 0.4, H - 0.05, H - 0.01, z - 0.06, z + 0.06, 0, { mat: glow });
    // (a sign over the wall of guns)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.98), new THREE.MeshBasicMaterial({ map: signTexture(shop.sign, shop.signBg, '#fff') }));
    sign.position.set(-2.5, 3.35, PART - 0.16);
    sign.rotation.y = Math.PI;
    root.add(sign);
    // The counter: wood below, glass on top (guns inside), the register.
    box(COUNTER.x0, COUNTER.x1, 0, 0.92, COUNTER.z0, COUNTER.z1, L.trim, { solid: true });
    const glass = new THREE.MeshLambertMaterial({ color: 0xb8d8e8, transparent: true, opacity: 0.28, depthWrite: false });
    box(COUNTER.x0, COUNTER.x1, 0.92, COUNTER.h, COUNTER.z0, COUNTER.z1, 0, { mat: glass });
    box(1.0, 1.5, COUNTER.h, COUNTER.h + 0.28, 7.2, 7.6, 0x2b2b2b); // (the register)
    // (the gate at the end of the counter: staff only)
    box(COUNTER.x1, COUNTER.x1 + 0.12, 0, 1.0, COUNTER.z0, PART - 0.15, L.trim, { solid: true });
    box(COUNTER.x0 - 2.0, COUNTER.x0, 0, 1.0, COUNTER.z0, COUNTER.z0 + 0.12, L.trim, { solid: true });
    // (guns under the counter glass)
    shop.stock.slice(0, 4).forEach((id, k) => {
      const m = gunModel(id);
      m.rotation.x = -Math.PI / 2;
      m.position.set(COUNTER.x0 + 0.9 + k * 1.6, 0.95, (COUNTER.z0 + COUNTER.z1) / 2);
      root.add(m);
    });
    // The wall of guns behind the counter: a pegboard, everything he stocks, two rows.
    box(-6.6, 1.6, 0.9, 3.0, PART - 0.2, PART - 0.15, 0x9a8a6e);
    shop.stock.forEach((id, k) => {
      const m = gunModel(id);
      m.rotation.y = Math.PI; // (facing the store)
      const row = k % 2;
      const col = Math.floor(k / 2);
      m.position.set(-5.6 + col * 2.4 + row * 1.0, 2.45 - row * 0.85, PART - 0.24);
      m.scale.setScalar(1.25);
      root.add(m);
    });
    // Glass cases down both walls, a gun in each (the shop's stock round them).
    const caseSpots = [[-6.1, 3.0, 1], [-6.1, 5.4, 1], [6.1, 3.0, -1], [6.1, 5.4, -1]];
    caseSpots.forEach(([x, z, side], k) => {
      const id = shop.stock[k % shop.stock.length];
      box(x - 0.55, x + 0.55, 0, 0.85, z - 0.95, z + 0.95, L.trim, { solid: true });
      box(x - 0.55, x + 0.55, 0.85, 1.25, z - 0.95, z + 0.95, 0, { mat: glass });
      box(x - 0.5, x + 0.5, 0.85, 0.87, z - 0.9, z + 0.9, 0x5c1a1a); // (the felt)
      const m = gunModel(id);
      m.rotation.set(-Math.PI / 2, 0, Math.PI / 2 * side);
      m.position.set(x, 0.9, z);
      root.add(m);
      // (where you stand to look at it: in front of the case)
      r.cases.push({ id, x: x + side * 1.1, z, gx: x, gz: z });
    });
    // (a bench, a poster or two: it's lived in)
    box(-3.2, -1.2, 0, 0.45, 0.6, 1.0, 0x4a3a2a, { solid: true });
    for (const [x, c] of [[-6.94, 0xb03a2e], [6.94, 0x2e5ab0]]) {
      const p = box(x - 0.01, x + 0.01, 1.6, 2.6, 7.5, 8.3, c);
      p.material = lam(c);
    }
    // The clerk, behind the counter.
    const ck = shop.clerk;
    const c = makeCharacter({ ...ck.look, female: !!ck.female });
    setHeight(c, ck.height || 1.8);
    c.group.position.set(r.ox + CLERK.x, r.oy, r.oz + CLERK.z);
    c.group.rotation.y = Math.PI; // (facing the door)
    scene.add(c.group);
    r.clerk = { c, t: Math.random() * 10, talkT: 0 };
    // ---- The range ----
    // (the booths: partitions between the lanes, the bench in front of you, numbers over them)
    for (const x of [-2.3, 2.3]) box(x - 0.06, x + 0.06, 0, 2.3, BOOTH[0], BENCH + 0.6, 0x6d6e72, { solid: true });
    box(-W, W, 0, 1.0, BENCH, BENCH + 0.6, 0x5a4a3a, { solid: true }); // (the bench: no further)
    // (a rail across the ceiling the targets hang from... stands on the floor, near enough)
    LANES.forEach((lx, li) => {
      const lane = { i: li, x: lx, targets: [], holes: [] };
      TARGET_Z.forEach((tz, k) => {
        // (staggered across the lane, so the near one doesn't hide the far ones)
        const ox = [-0.95, 0.2, 1.05][k];
        const pivot = new THREE.Group();
        pivot.position.set(lx + ox, 0, tz);
        root.add(pivot);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), lam(0x2a2a2a));
        pole.position.set(0, 0.47, 0.02);
        pivot.add(pole);
        const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.0), new THREE.MeshLambertMaterial({ map: targetTexture(), side: THREE.DoubleSide }));
        paper.position.set(0, 1.45, 0);
        paper.rotation.y = Math.PI; // (facing the booths)
        pivot.add(paper);
        lane.targets.push({ pivot, paper, z: tz, ox, up: 1, goal: 1, holes: [] });
      });
      // (the lane number over the booth)
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ map: signTexture(`${li + 1}`, '#222', '#ffd23f') }));
      n.position.set(lx, 3.3, BOOTH[0] + 0.02);
      n.rotation.y = Math.PI;
      root.add(n);
      r.lanes.push(lane);
    });
    // (the range's floor stripe where you stand)
    for (const lx of LANES) box(lx - 1.6, lx + 1.6, 0.001, 0.012, BENCH - 0.18, BENCH - 0.05, 0xffd23f);
    return r;
  }

  // ---- Coming and going ----
  enter(i) {
    if (this.fade || this.inside) return;
    const game = this.game;
    const r = this.rooms[i];
    if (!r) return;
    this.startFade(() => {
      const p = game.player;
      p.x = r.ox;
      p.z = r.oz + 1.4;
      this.lightUp(true);
      p.heading = 0; // (facing in)
      p.vx = p.vz = 0;
      game.camYaw = 0;
      game.camPitch = 0.1;
      this.inside = r;
      this.lastLane = null;
      this.clearHoles(r);
      for (const l of r.lanes) for (const t of l.targets) t.goal = t.up = 1;
      game.hud.toast(`${r.shop.clerk.name}: "${pick(r.shop.clerk.hi)}"`, '#ffd479');
    });
  }

  leave() {
    if (this.fade || !this.inside) return;
    const game = this.game;
    const r = this.inside;
    this.stopChallenge(false);
    this.startFade(() => {
      const s = r.shop;
      const p = game.player;
      // (out the door, on the sidewalk, facing the street)
      p.x = s.x + s.nx * 0.9;
      p.z = s.z + s.nz * 0.9;
      p.heading = Math.atan2(s.nx, s.nz);
      p.vx = p.vz = 0;
      game.camYaw = p.heading;
      this.inside = null;
      this.lightUp(false);
      const mm = document.getElementById('minimap');
      if (mm) mm.style.visibility = '';
      if (game.dayNight) game.dayNight.night = -1; // (the outside light again: daynight.js)
    });
  }

  // Indoor light: from all round (the sky's light from below too: the ceiling and the
  // undersides aren't left in the dark), the same any time of day; back to outside's after.
  lightUp(on) {
    const h = this.game.hemi;
    if (!h) return;
    if (on) {
      this.hemi0 ??= { sky: h.color.clone(), ground: h.groundColor.clone() };
      h.color.set(0xfff4e2);
      h.groundColor.set(0xb9ae9c);
    } else if (this.hemi0) {
      h.color.copy(this.hemi0.sky);
      h.groundColor.copy(this.hemi0.ground);
    }
  }

  startFade(fn) {
    this.fade = { t: 0, fn, done: false };
  }

  // ---- Every frame (main.js) ----
  update(dt) {
    const game = this.game;
    // (the fade: to black, the move, back in)
    if (this.fade) {
      const F = this.fade;
      F.t += dt;
      if (!F.done && F.t >= 0.22) {
        F.done = true;
        F.fn();
      }
      const a = F.t < 0.22 ? F.t / 0.22 : Math.max(0, 1 - (F.t - 0.3) / 0.25);
      this.fadeEl.style.opacity = a.toFixed(3);
      if (F.t > 0.6) {
        this.fade = null;
        this.fadeEl.style.opacity = '0';
      }
    }
    const r = this.inside;
    for (const room of this.rooms) {
      if (room !== r && room.clerk.c.group.visible) room.clerk.c.group.visible = false;
    }
    if (!r) return;
    r.clerk.c.group.visible = true;
    const mm = document.getElementById('minimap');
    if (mm && mm.style.visibility !== 'hidden') mm.style.visibility = 'hidden'; // (no map in here)
    this.clerkPose(r, dt);
    // (the targets: up or down, swinging there)
    for (const l of r.lanes) {
      for (const t of l.targets) {
        t.up += Math.sign(t.goal - t.up) * Math.min(Math.abs(t.goal - t.up), dt * 7);
        t.pivot.rotation.x = (1 - t.up) * (Math.PI / 2) * 0.98; // (down: flat, top away from you)
      }
    }
    if (this.challenge) this.challengeStep(dt);
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
    const dx = p.x - c.group.position.x;
    const dz = p.z - c.group.position.z;
    const inStore = p.z - r.oz < PART;
    const want = inStore ? Math.atan2(dx, dz) - c.group.rotation.y : 0;
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
  // you're inside; armed(): whether your guns are out (in a lane) ----
  interact(a) {
    const game = this.game;
    const r = this.inside;
    if (!r || this.fade) return !!r;
    const p = game.player;
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    const lx = p.x - r.ox;
    const lz = p.z - r.oz;
    // (the front door)
    if (lz < 1.6 && Math.abs(lx) < 1.2) {
      game.prompt = `Press ${key} to leave ${r.shop.name}`;
      if (pressed) this.leave();
      return true;
    }
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
      return true;
    }
    // (a lane)
    const lane = this.laneAt(lx, lz);
    if (lane) {
      const w = game.arsenal.current();
      if (this.challenge) {
        if (this.challenge.lane !== lane) this.stopChallenge(false);
        return true;
      }
      const best = this.best[w.id] || 0;
      const last = this.lastHit && game.time - this.lastHit.at < 2.5 ? ` · last: ${this.lastHit.pts}${this.lastHit.head ? ' (head)' : ''} at ${this.lastHit.m} m` : '';
      if (w.melee) game.prompt = `Lane ${lane.i + 1}: get a gun out to shoot (range ammo's free)${last}`;
      else {
        game.prompt = `Press ${key} to start the 30-second challenge with the ${w.name} (best ${best}) · or just shoot${last}`;
        if (pressed) this.startChallenge(lane);
      }
      return true;
    }
    return true;
  }

  // Your guns are out only in a lane.
  armed() {
    const r = this.inside;
    if (!r) return true;
    const p = this.game.player;
    return !!this.laneAt(p.x - r.ox, p.z - r.oz);
  }

  // Free ammo at the range.
  freeAmmo() {
    return !!this.inside && this.armed();
  }

  laneAt(lx, lz) {
    const r = this.inside;
    if (!r || lz < BOOTH[0] - 0.2 || lz > BENCH + 0.1) return null;
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
    if (!r || dz <= 1e-4) return null;
    const lx0 = ox - r.ox;
    const ly0 = oy - r.oy;
    const lz0 = oz - r.oz;
    let best = null;
    for (const l of r.lanes) {
      for (const t of l.targets) {
        if (t.up < 0.85) continue;
        const tt = (t.z - lz0) / dz;
        if (tt <= 0 || tt >= maxT || (best && tt >= best.t)) continue;
        const x = lx0 + dx * tt - l.x - t.ox;
        const y = ly0 + dy * tt;
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
    for (const l of r.lanes) for (const t of l.targets) {
      for (const h of t.holes) t.paper.remove(h);
      t.holes = [];
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
    this.challenge = { lane, wid: w.id, wname: w.name, t: -2.5, score: 0, hits: 0, shown: 0, next: 0.4 };
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
    const name = this.inside?.shop.clerk.name;
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

  // The camera stays in the room (main.js, after it's placed).
  camera(cam) {
    const r = this.inside;
    if (!r) return;
    const p = cam.position;
    p.x = Math.max(r.ox - W + 0.25, Math.min(r.ox + W - 0.25, p.x));
    p.y = Math.max(r.oy + 0.3, Math.min(r.oy + H - 0.2, p.y));
    p.z = Math.max(r.oz + 0.25, Math.min(r.oz + D - 0.25, p.z));
    // (and not through the wall between the store and the range: the side you're on)
    const pz = this.game.player.z - r.oz;
    const lz = p.z - r.oz;
    if (pz < PART && lz > PART - 0.4) p.z = r.oz + PART - 0.4;
    if (pz >= PART && lz < PART + 0.4) p.z = r.oz + PART + 0.4;
  }
}
