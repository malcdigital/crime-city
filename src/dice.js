import * as THREE from 'three';
import { dist, rand, pick, lerpAngle } from './util.js';
import { crouchPose, setShirt, restPose, bendSpine } from './character.js';
import { kneelPose } from './combatpose.js';
import { pushCircle } from './collision.js';
import { GANGS, Soldier } from './turf.js';
import { CFG } from './config.js';
import { iconizeHTML } from './icons.js';

// Street dice around the city: a few people crouched in a circle on a corner, money down, dice
// against the curb. Mostly in gang turf (and more at night), now and then on a neutral corner.
// Two games: cee-lo (three dice: everybody antes, everybody rolls; 4-5-6 wins, 1-2-3 loses,
// trips beat a point, the best roll takes the pot) and street craps (two dice: the shooter wins
// on 7 or 11 coming out and craps out on 2, 3 or 12; anything else is his point, and he has to
// hit it again before a 7; you bet with him or fade him, and when you shoot somebody fades you).
//
// Walk up and get in (E / D-pad ↑ / USE: the stake's up to you), or start one with your crew in
// your own turf. In a rival gang's hood it's a risk: win big and you're on their dice. They might
// call you a cheat (give it back or stand on it, and standing on it can get you shot at), and
// walking off with their money can get you followed. Anywhere, the cops can break it up.

const GAME = {
  celo: { name: 'Cee-lo', dice: 3 },
  craps: { name: 'Street craps', dice: 2 },
};
const STAKES = [10, 20, 50, 100, 250, 500];
const NAMES = ['Lil Mike', 'Dre', 'Smoke', 'Peanut', 'Boogie', 'Tank', 'Shorty', 'Black', 'Red', 'Juice', 'Pooh', 'Ant', 'Rell', 'Man-Man', 'Bird'];
const WOMEN = ['Kiki', 'Peaches', 'Lady', 'Nay Nay', 'Keke', 'Dee Dee', 'Precious', 'Jada', 'Shay'];
const MAX = 3; // (circles around at once)
const DIE = 0.08;

// ---- The dice ----
function pipsTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1e8';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = n === 1 ? '#c62828' : '#111';
  const P = { 1: [[32, 32]], 2: [[18, 18], [46, 46]], 3: [[16, 16], [32, 32], [48, 48]], 4: [[18, 18], [46, 18], [18, 46], [46, 46]], 5: [[16, 16], [48, 16], [32, 32], [16, 48], [48, 48]], 6: [[18, 14], [46, 14], [18, 32], [46, 32], [18, 50], [46, 50]] }[n];
  for (const [x, y] of P) {
    g.beginPath();
    g.arc(x, y, n === 1 ? 8 : 6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let MATS = null;
// (box faces: +x 3, -x 4, +y 1, -y 6, +z 2, -z 5: opposite faces add up to 7)
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
function dieMesh() {
  MATS ||= FACE_VALUES.map((v) => new THREE.MeshLambertMaterial({ map: pipsTexture(v) }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), MATS);
  m.castShadow = true;
  return m;
}
// The rotation that puts value v on top (then any turn about the vertical).
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function faceUp(v, yaw, out) {
  const [x, z] = { 1: [0, 0], 6: [Math.PI, 0], 2: [-Math.PI / 2, 0], 5: [Math.PI / 2, 0], 3: [0, Math.PI / 2], 4: [0, -Math.PI / 2] }[v];
  out.setFromEuler(_e.set(x, 0, z));
  return out.premultiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
}

// ---- The rules ----
// Cee-lo: what three dice make (null: nothing, roll again).
export function celo(d) {
  const s = [...d].sort((a, b) => a - b);
  if (s[0] === 4 && s[1] === 5 && s[2] === 6) return { rank: 1000, label: '4-5-6!', win: true };
  if (s[0] === 1 && s[1] === 2 && s[2] === 3) return { rank: -1, label: '1-2-3', lose: true };
  if (s[0] === s[2]) return { rank: 100 + s[0], label: `Trips ${s[0]}s` };
  if (s[0] === s[1]) return { rank: 10 + s[2], label: `Point ${s[2]}` };
  if (s[1] === s[2]) return { rank: 10 + s[0], label: `Point ${s[0]}` };
  return null;
}
const roll = (n) => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));

// ---- One circle ----
// Laid out the way it goes on a real corner: up against a backstop (a wall, or the curb when
// there's no wall), the dice thrown off it. The shooter steps up and gets down on a knee to
// shake and throw; the rest stand round him in a loose half-ring, everybody their own way
// (bent over with the hands on the knees, squatting, a knot of money in the hand, arms folded),
// all leaning in when the dice go.
const ROLES = ['hunch', 'cash', 'squat', 'hunch', 'lean', 'cash', 'hunch'];
const SHOOT_D = 0.95; // (the shooter, back from the dice)
const WALL_GAP = 0.45; // (the dice land this far off the backstop)

// The nearest wall within a few metres (a tall collider), else the curb (out toward the street).
function backstop(game, x, z) {
  const near = game.city.colliders.filter((b) => (b.h ?? 30) >= 2.5 && b.maxX > x - 3.5 && b.minX < x + 3.5 && b.maxZ > z - 3.5 && b.minZ < z + 3.5);
  let best = null;
  for (let i = 0; i < 24 && near.length; i++) {
    const a = (i / 24) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    for (let d = 0.6; d <= 2.8; d += 0.15) {
      if (pushCircle(x + dx * d, z + dz * d, 0.05, near).hit) {
        if (!best || d < best.d) best = { dx, dz, d, wall: true };
        break;
      }
    }
  }
  if (best) return best;
  const b = game.city.blockAt?.(x, z);
  let dx = 0;
  let dz = 1;
  if (b && b.cx != null) {
    const l = dist(b.cx, b.cz, x, z) || 1;
    dx = (x - b.cx) / l;
    dz = (z - b.cz) / l;
  } else {
    const a = Math.random() * Math.PI * 2;
    dx = Math.sin(a);
    dz = Math.cos(a);
  }
  return { dx, dz, d: 1.35, wall: false };
}

// Somewhere near (x, z) up against a building wall (on the walk, not in it), else (x, z) itself.
function wallSpot(game, x, z) {
  let best = null;
  for (let r = 0; r <= 10 && !best; r += 1) {
    const n = Math.max(1, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const qx = x + Math.sin(a) * r;
      const qz = z + Math.cos(a) * r;
      if (!game.city.blockAt?.(qx, qz) || pushCircle(qx, qz, 0.6, game.city.colliders).hit) continue;
      const B = backstop(game, qx, qz);
      if (B.wall && B.d > 0.9 && B.d < 1.9) {
        best = [qx, qz];
        break;
      }
    }
  }
  return best || [x, z];
}

function billMesh() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.006, 0.068), new THREE.MeshLambertMaterial({ color: 0x6f9a5c }));
  m.castShadow = false;
  return m;
}

class Circle {
  constructor(mgr, x, z, gang, kind, n, crew = false) {
    this.mgr = mgr;
    const game = mgr.game;
    this.game = game;
    this.gang = gang; // (a GANGS id, or null on a neutral corner)
    this.kind = kind;
    this.crew = crew; // (your own crew's game)
    // (the backstop: dice land just off it; the crowd gathers back from there)
    [x, z] = wallSpot(game, x, z);
    const B = backstop(game, x, z);
    this.wall = B.wall;
    this.dir = [B.dx, B.dz];
    this.sx = x + B.dx * (B.d - WALL_GAP);
    this.sz = z + B.dz * (B.d - WALL_GAP);
    this.back = Math.atan2(-B.dx, -B.dz); // (the way back from the dice, toward the crowd)
    this.x = this.sx - B.dx * 1.35;
    this.z = this.sz - B.dz * 1.35;
    this.y = game.city.groundY?.(this.sx, this.sz) || 0;
    this.peds = [];
    const roles = ROLES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const pref = n === 1 ? 0 : -1.0 + (2.0 * i) / (n - 1) + rand(-0.1, 0.1);
      const [px, pz] = this.arcPos(pref, 1.5);
      const p = game.peds.addAt(px, pz);
      p.act = this;
      p.state = 'play';
      p.keep = true;
      p.diceName = pick((p.female ? WOMEN : NAMES).filter((nm) => !this.peds.some((o) => o.name === nm)));
      if (gang && GANGS[gang]) setShirt(p.char, GANGS[gang].shirt);
      const s = { p, name: p.diceName, react: 0, reactKind: null, roll: 0, pref, rj: rand(-0.12, 0.3), role: roles[i % roles.length], seed: Math.random() * 10, bank: this.bankroll(), fade: Math.random() };
      if (s.role === 'cash') {
        // (a folded knot of bills in the hand)
        s.wad = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.075, 0.12), new THREE.MeshLambertMaterial({ color: 0x6f9a5c }));
        s.wad.position.set(0, -0.12, 0.05);
        p.char.wristL.add(s.wad);
      }
      this.peds.push(s);
    }
    this.dice = Array.from({ length: GAME[kind].dice }, () => {
      const m = dieMesh();
      game.scene.add(m);
      return { m, p0: null, pw: null, p1: null, q1: new THREE.Quaternion(), spin: new THREE.Vector3() };
    });
    // (money down, by the dice)
    this.bills = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => {
      const m = billMesh();
      const a = this.back + rand(-0.9, 0.9);
      const r = rand(0.18, 0.55);
      m.position.set(this.sx + Math.sin(a) * r, this.y + 0.004, this.sz + Math.cos(a) * r);
      m.rotation.y = rand(0, 6.28);
      game.scene.add(m);
      return m;
    });
    this.restDice();
    this.throw = null; // (dice in the air)
    this.wait = rand(0.5, 2); // (ambient: till the next roll)
    this.you = null; // (when you're in: your place in the ring, and the round)
    this.shooter = null; // (who's up: a seat, or 'you')
    this.amb = 0;
  }

  // What somebody walks up with: a couple hundred, more in gang turf; now and then somebody
  // holding (who'll raise the stakes when he's got the dice).
  bankroll(stake = 20) {
    let v = rand(120, 650) * (this.gang ? 1.35 : 1) * Math.max(1, stake / 40);
    if (Math.random() < 0.18) v *= rand(2.5, 4);
    return Math.round(v / 10) * 10;
  }

  // Somebody new walks up and gets in (from back up the walk), between hands. Returns the seat.
  addPlayer(stake) {
    const game = this.game;
    const used = new Set(this.peds.map((o) => o.name));
    const prefs = this.peds.map((o) => o.pref).concat(this.you ? [this.you.pref] : []);
    let pref = 0;
    for (let k = 0, best = -1; k < 12; k++) {
      const c = rand(-1, 1);
      const gap = Math.min(...prefs.map((q) => Math.abs(q - c)), 9);
      if (gap > best) {
        best = gap;
        pref = c;
      }
    }
    const [x, z] = this.arcPos(pref, 6);
    const p = game.peds.addAt(x, z);
    if (!p) return null;
    p.act = this;
    p.state = 'play';
    p.keep = true;
    const name = pick((p.female ? WOMEN : NAMES).filter((nm) => !used.has(nm))) || 'Somebody';
    p.diceName = name;
    if (this.gang && GANGS[this.gang]) setShirt(p.char, GANGS[this.gang].shirt);
    const s = { p, name, react: 0, reactKind: null, roll: 0, pref, rj: rand(-0.12, 0.3), role: pick(['hunch', 'hunch', 'cash', 'lean']), seed: Math.random() * 10, bank: this.bankroll(stake), fade: Math.random() };
    this.peds.push(s);
    return s;
  }

  // Gets up and walks off (tapped out).
  release(s) {
    const i = this.peds.indexOf(s);
    if (i < 0) return;
    this.peds.splice(i, 1);
    s.wad?.removeFromParent();
    if (this.shooter === s) this.shooter = null;
    const p = s.p;
    if (p.removed) return;
    p.act = null;
    p.keep = false;
    p.resumeWalking();
  }

  // A point round the dice: pref (radians either side of straight back from the backstop), r out.
  arcPos(pref, r) {
    const a = this.back + pref;
    return [this.sx + Math.sin(a) * r, this.sz + Math.cos(a) * r];
  }

  // (dice lying by the backstop)
  restDice() {
    const [dx, dz] = this.dir;
    this.dice.forEach((D, i) => {
      const off = (i - (this.dice.length - 1) / 2) * 0.12;
      D.m.position.set(this.sx - dz * off + rand(-0.04, 0.04), this.y + DIE / 2, this.sz + dx * off + rand(-0.04, 0.04));
      faceUp(1 + Math.floor(Math.random() * 6), rand(0, 6.28), D.m.quaternion);
    });
  }

  // Where everybody stands: the shooter up on the dice, the rest spread round behind in the
  // order they're in (you where you walked up), a gap where the shooter stepped out of; then
  // nudged apart (nobody in anybody) and off the walls. Worked out once a frame.
  layout() {
    const key = `${this.game.time}|${this.peds.length}|${!!this.you}|${this.shooter === 'you' ? 'you' : this.peds.indexOf(this.shooter)}`;
    if (this.layKey === key) return this.lay;
    const [dx, dz] = this.dir;
    const out = new Map();
    const all = [...this.peds.map((s) => ({ key: s, pref: s.pref })), ...(this.you ? [{ key: 'you', pref: this.you.pref }] : [])].sort((a, b) => a.pref - b.pref);
    const n = all.length;
    const A = Math.min(1.0, 0.3 * (n - 1) + 0.15); // (all behind the shooter: the wall's sides stay clear for the camera)
    const pts = [];
    all.forEach((m, i) => {
      if (m.key === this.shooter) return;
      const s = m.key === 'you' ? null : m.key;
      const ang = n === 1 ? 0.5 : -A + (2 * A * i) / (n - 1) + (s ? Math.sin(s.seed) * 0.08 : 0);
      const r = s?.role === 'squat' ? 1.55 : 1.8 + (s ? s.rj : 0);
      const [x, z] = this.arcPos(ang, r);
      pts.push({ key: m.key, x, z });
    });
    const sh = this.shooter ? { key: this.shooter, x: this.sx - dx * SHOOT_D, z: this.sz - dz * SHOOT_D, fixed: true } : null;
    const every = sh ? [sh, ...pts] : pts;
    const walls = this.game.city.colliders;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < every.length; i++) {
        for (let j = i + 1; j < every.length; j++) {
          const P = every[i];
          const Q = every[j];
          const d = Math.hypot(Q.x - P.x, Q.z - P.z) || 0.01;
          if (d >= 0.78) continue;
          const push = (0.78 - d) / d;
          const ux = (Q.x - P.x) * push;
          const uz = (Q.z - P.z) * push;
          if (P.fixed) {
            Q.x += ux;
            Q.z += uz;
          } else if (Q.fixed) {
            P.x -= ux;
            P.z -= uz;
          } else {
            Q.x += ux / 2;
            Q.z += uz / 2;
            P.x -= ux / 2;
            P.z -= uz / 2;
          }
        }
      }
      for (const P of every) {
        const r = pushCircle(P.x, P.z, 0.36, walls);
        P.x = r.x;
        P.z = r.z;
      }
    }
    for (const P of every) out.set(P.key, { x: P.x, z: P.z, face: P === sh ? Math.atan2(dx, dz) : Math.atan2(this.sx - P.x, this.sz - P.z) });
    this.layKey = key;
    this.lay = out;
    return out;
  }

  place(key) {
    return this.layout().get(key) || { x: this.x, z: this.z, face: 0 };
  }

  // On their mark (the shooter: down on the dice, ready to throw)? Somebody who can't quite get
  // there (stuck on something) is put there after a few seconds, so the game never waits on him.
  ready(s) {
    if (!this.peds.includes(s)) return true; // (gone: don't wait on him)
    const P = this.place(s);
    const off = dist(s.p.x, s.p.z, P.x, P.z);
    if (off < 0.3) {
      s.stuckT = 0;
      return true;
    }
    s.stuckT = (s.stuckT || 0) + (this.game.time - (s.stuckAt ?? this.game.time));
    s.stuckAt = this.game.time;
    if (s.stuckT > 3) {
      s.p.x = P.x;
      s.p.z = P.z;
      s.p.heading = P.face;
      s.stuckT = 0;
      return true;
    }
    return false;
  }

  // ---- The people in it (peds.js asks act.drive / act.pose) ----
  drive(p, dt) {
    const s = this.peds.find((q) => q.p === p);
    if (!s) return { speed: 0 };
    const P = this.place(s);
    const far = dist(p.x, p.z, P.x, P.z);
    if (far > 0.12) return { tx: P.x, tz: P.z, speed: Math.min(1.5, 0.6 + far) };
    p.heading = lerpAngle(p.heading, P.face, Math.min(1, dt * 6));
    return { speed: 0 };
  }

  pose(p) {
    const s = this.peds.find((q) => q.p === p);
    if (!s || p.speed > 0) return 0;
    return this.poseChar(p.char, s.role, s === this.shooter, s.roll, s.react > this.game.time ? s.reactKind : null, s.seed);
  }

  // A body in the game. role: how they stand; shooter: down on a knee with the dice; roll:
  // 'shake' / the time the throw went; react: 'win' / 'lose' for a moment after a roll.
  poseChar(c, role, shooter, roll, react, seed) {
    const t = this.game.time;
    restPose(c);
    for (const k of ['legL', 'legR', 'kneeL', 'kneeR']) c[k].rotation.set(0, 0, 0);
    if (react === 'win') {
      // (up, both arms up, bouncing)
      c.armL.rotation.set(-2.8 + Math.sin(t * 14) * 0.15, 0, 0.25);
      c.armR.rotation.set(-2.8 - Math.sin(t * 14) * 0.15, 0, -0.25);
      c.elbowL.rotation.x = c.elbowR.rotation.x = -0.2;
      bendSpine(c, -0.15);
      return 0.04 * Math.abs(Math.sin(t * 9));
    }
    if (react === 'lose') {
      // (stood up straight, hands on the head, turned half away)
      c.armL.rotation.set(-2.5, 0, 0.35);
      c.armR.rotation.set(-2.5, 0, -0.35);
      c.elbowL.rotation.x = c.elbowR.rotation.x = -2.1;
      bendSpine(c, -0.1, 0.5 * Math.sin(seed), 0);
      c.neck.rotation.set(0.25, 0, 0);
      return 0;
    }
    const lean = this.throw ? 0.18 : 0; // (everybody leans in while the dice go)
    const sway = Math.sin(t * 0.8 + seed) * 0.05;
    if (shooter) {
      // Down on one knee, the other forearm on that knee, the dice in the right hand.
      const y = kneelPose(c);
      bendSpine(c, 0.32 + lean * 0.5, 0, 0);
      c.armL.rotation.set(-0.85, 0, 0.15);
      c.elbowL.rotation.x = -0.9;
      c.neck.rotation.set(-0.2, 0, 0);
      if (roll === 'shake') {
        // (fist up by the ear, shaking)
        c.armR.rotation.set(-1.5 + Math.sin(t * 30) * 0.18, 0, -0.25);
        c.elbowR.rotation.x = -1.9;
        c.wristR.rotation.x = Math.sin(t * 30) * 0.4;
      } else if (typeof roll === 'number') {
        // (the throw: the arm whips forward and down, the hand opening)
        const k = Math.min(1, (t - roll) / 0.22);
        c.armR.rotation.set(-1.5 + k * 0.6, 0, -0.25 + k * 0.2);
        c.elbowR.rotation.x = -1.9 + k * 1.8;
        c.wristR.rotation.x = -0.6 * k;
      } else {
        c.armR.rotation.set(-0.7, 0, -0.1);
        c.elbowR.rotation.x = -0.8;
      }
      return y;
    }
    if (role === 'squat') {
      // (way down on the heels, forearms on the knees)
      const y = crouchPose(c, 0.66);
      c.legL.rotation.z = 0.18;
      c.legR.rotation.z = -0.18;
      bendSpine(c, 0.3 + lean, 0, sway * 0.5);
      c.armL.rotation.x = c.armR.rotation.x = -0.75;
      c.elbowL.rotation.x = c.elbowR.rotation.x = -0.6;
      c.neck.rotation.set(-0.15, 0, 0);
      return y;
    }
    if (role === 'hunch') {
      // (bent over, hands on the knees, looking down at it)
      const y = crouchPose(c, 0.2);
      c.legL.rotation.z = 0.1;
      c.legR.rotation.z = -0.1;
      bendSpine(c, 0.62 + lean, 0, sway);
      c.armL.rotation.set(-0.55, 0, 0.1);
      c.armR.rotation.set(-0.55, 0, -0.1);
      c.elbowL.rotation.x = c.elbowR.rotation.x = -0.15;
      c.neck.rotation.set(-0.45, 0, 0);
      return y;
    }
    if (role === 'cash') {
      // (stood, the knot of money in the left hand, thumbing it)
      bendSpine(c, 0.12 + lean, 0, sway);
      c.legL.rotation.x = 0.08;
      c.legR.rotation.x = -0.05;
      c.armL.rotation.set(-0.75, 0, 0.1);
      c.elbowL.rotation.x = -1.35;
      c.armR.rotation.set(-0.55, 0, -0.05);
      c.elbowR.rotation.x = -1.5 + Math.max(0, Math.sin(t * 2.2 + seed)) * 0.25;
      c.neck.rotation.set(0.2, 0, 0);
      return 0;
    }
    // lean: (stood back a bit, arms folded, weight on one leg)
    bendSpine(c, -0.04 + lean, 0, 0.06 + sway);
    c.legL.rotation.z = 0.08;
    c.armR.rotation.set(-0.55, 0, -0.35);
    c.armL.rotation.set(-0.55, 0, 0.35);
    c.elbowR.rotation.x = c.elbowL.rotation.x = -1.75;
    c.neck.rotation.set(0.25, 0, 0);
    return 0;
  }

  // ---- The dice going down ----
  // from: who's throwing ('you' or a seat). Out of the hand, off the backstop, back onto the
  // ground (cb with the values when they've settled).
  toss(values, from, cb) {
    const game = this.game;
    const [dx, dz] = this.dir;
    const P = this.place(from);
    const hx = P.x + dx * 0.35;
    const hz = P.z + dz * 0.35;
    this.dice.forEach((D, i) => {
      const off = (i - (this.dice.length - 1) / 2) * 0.1;
      D.p0 = [hx - dz * off * 0.3, this.y + 0.38, hz + dx * off * 0.3];
      const wl = off + rand(-0.12, 0.12); // (where it hits the backstop)
      D.pw = [this.sx + dx * (WALL_GAP - 0.04) - dz * wl, this.y + (this.wall ? rand(0.06, 0.16) : 0.05), this.sz + dz * (WALL_GAP - 0.04) + dx * wl];
      const ll = off * 1.6 + rand(-0.12, 0.12); // (where it comes to rest)
      const back = rand(-0.12, 0.2);
      D.p1 = [this.sx - dx * back - dz * ll, this.y + DIE / 2, this.sz - dz * back + dx * ll];
      faceUp(values[i], rand(0, 6.28), D.q1);
      D.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(16, 24));
    });
    this.throw = { t: 0, T: 1.05, values, cb };
    game.sfx?.dice?.();
  }

  stepDice(dt) {
    const T = this.throw;
    if (!T) return;
    T.t += dt;
    const k = Math.min(1, T.t / T.T);
    const lerp = (a, b, u) => a + (b - a) * u;
    for (const D of this.dice) {
      let x;
      let y;
      let z;
      if (k < 0.38) {
        // (out of the hand, down onto the ground short of the wall, skidding into it)
        const u = k / 0.38;
        x = lerp(D.p0[0], D.pw[0], u);
        z = lerp(D.p0[2], D.pw[2], u);
        y = lerp(D.p0[1], D.pw[1], u) + Math.sin(u * Math.PI) * 0.1;
      } else if (k < 0.72) {
        // (off the backstop, bouncing back)
        const u = (k - 0.38) / 0.34;
        x = lerp(D.pw[0], D.p1[0], u);
        z = lerp(D.pw[2], D.p1[2], u);
        y = lerp(D.pw[1], D.p1[1], u) + Math.sin(u * Math.PI) * 0.09;
      } else {
        // (a couple of little hops, settling)
        const u = (k - 0.72) / 0.28;
        x = D.p1[0];
        z = D.p1[2];
        y = D.p1[1] + Math.abs(Math.sin(u * Math.PI * 2)) * 0.035 * (1 - u);
      }
      D.m.position.set(x, y, z);
      if (k < 0.82) {
        D.m.rotation.x += D.spin.x * dt;
        D.m.rotation.y += D.spin.y * dt;
        D.m.rotation.z += D.spin.z * dt;
      } else D.m.quaternion.slerp(D.q1, Math.min(1, dt * 18));
    }
    if (k >= 1) {
      for (const D of this.dice) D.m.quaternion.copy(D.q1);
      this.throw = null;
      T.cb?.(T.values);
    }
  }

  react(s, kind) {
    s.react = this.game.time + (kind === 'win' ? 1.3 : 0.9);
    s.reactKind = kind;
  }

  // ---- Every frame ----
  update(dt) {
    this.stepDice(dt);
    // (anyone who ran off from it, or got hurt, is out)
    for (const s of [...this.peds]) {
      if (s.p.removed || s.p.state !== 'play' || s.p.act !== this) {
        this.peds.splice(this.peds.indexOf(s), 1);
        s.wad?.removeFromParent();
        if (this.shooter === s) this.shooter = null;
      }
    }
    if (this.you) this.mgr.round.step(dt);
    else this.ambient(dt);
  }

  // Not playing: they roll among themselves (so you can spot it from down the street). The
  // dice stay with a shooter a few rolls, then pass.
  ambient(dt) {
    if (this.throw || !this.peds.length) return;
    if (!this.shooter || this.shooter === 'you' || !this.peds.includes(this.shooter)) {
      this.shooter = pick(this.peds);
      this.wait = Math.max(this.wait, 1.5);
    }
    const s = this.shooter;
    if (!this.ready(s)) return;
    this.wait -= dt;
    if (this.wait < 0.9) s.roll = 'shake';
    if (this.wait > 0) return;
    const v = roll(GAME[this.kind].dice);
    s.roll = this.game.time;
    this.toss(v, s, () => {
      s.roll = 0;
      const good = this.kind === 'celo' ? (celo(v)?.rank ?? 0) > 100 : [7, 11].includes(v[0] + v[1]);
      const bad = this.kind === 'celo' ? celo(v)?.lose : [2, 3, 12].includes(v[0] + v[1]);
      if (good) {
        this.react(s, 'win');
        for (const o of this.peds) if (o !== s && Math.random() < 0.5) this.react(o, 'lose');
      } else if (bad) {
        this.react(s, 'lose');
        for (const o of this.peds) if (o !== s && Math.random() < 0.4) this.react(o, 'win');
      }
      if (Math.random() < (good || bad ? 0.6 : 0.25)) this.shooter = null; // (dice pass)
      this.wait = rand(1.8, 3.4);
    });
  }

  dispose(scatter = false) {
    for (const s of this.peds) {
      s.wad?.removeFromParent();
      const p = s.p;
      if (p.removed) continue;
      p.act = null;
      p.keep = false;
      if (scatter) p.hurryT = 10;
      p.resumeWalking();
    }
    this.peds = [];
    for (const D of this.dice) this.game.scene.remove(D.m);
    for (const m of this.bills) this.game.scene.remove(m);
  }
}

// ---- A round with you in it (cee-lo or craps), the money, and the trouble ----
// Everybody in it plays with their own money (s.bank; yours is your cash). A bet is always
// between two people: one backing the shooter (pro), one against him (con), each putting their
// side down (escrowed off the bankroll when it's made, the lot to whoever's right).
//   Craps: the shooter puts up his bet (raising it when he's holding: two or three times the
// stake) and the others fade it, covering what they can; you go with him (a side bet against
// one of them), fade him, or sit out, and if they can't cover all of it you're offered the rest.
// When it's your dice, ◀ ▶ sets your bet before the come-out. Once there's a point they lay or
// take odds on it (2 to 1 on 4 and 10, 3 to 2 on 5 and 9, 6 to 5 on 6 and 8): take it or pass.
// They bet among themselves too. Anybody who's tapped out gets up and walks off, and somebody new
// walks up now and then.
const POINT_ODDS = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
const r5 = (v) => Math.max(5, Math.round(v / 5) * 5);

class Round {
  constructor(mgr, circle, stake) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.c = circle;
    this.stake = stake;
    this.kind = circle.kind;
    this.phase = 'start';
    this.t = 0;
    this.first = 0;
    this.net = 0; // (what you're up, this sitting)
    this.tension = 0; // (in a rival hood: how hot they are about you winning)
    this.side = 'against'; // (craps, somebody else shooting: with him, fade him, or sit out)
    this.shooterKey = null; // (craps: who has the dice: 'you' or a seat)
    this.raise = 1; // (your come-out bet when it's your dice, in stakes)
    this.bets = [];
    this.offer = null;
    this.offers = [];
    this.lines = []; // (the panel: the last few things that happened)
  }

  // Everybody in it, you included, in seat order.
  players() {
    return [{ you: true, name: 'You', key: 'you' }, ...this.c.peds.map((s) => ({ s, name: s.name, key: s }))];
  }

  // ---- Money ----
  bank(p) {
    return p === 'you' ? this.game.cash : p.bank;
  }

  give(p, v) {
    if (p === 'you') this.game.cash += v;
    else p.bank += v;
  }

  nameOf(p) {
    return p === 'you' ? 'You' : p.name;
  }

  // A bet: pro backs the shooter putting down a, con against him putting down b. Both off
  // their bankroll now; the lot to the winner when it's decided.
  bet(pro, con, a, b, kind) {
    if (pro === con || a <= 0 || b <= 0 || this.bank(pro) < a || this.bank(con) < b) return false;
    this.give(pro, -a);
    this.give(con, -b);
    this.bets.push({ pro, con, a, b, kind });
    return true;
  }

  // What somebody's got riding right now.
  riding(p) {
    let v = 0;
    for (const B of this.bets) {
      if (B.pro === p) v += B.a;
      if (B.con === p) v += B.b;
    }
    return v;
  }

  // Walking off (or the cops) with money down: walk away and it's theirs; a raid, it's gone.
  forfeit(raid = false) {
    for (const B of this.bets) {
      if (raid) continue;
      if (B.pro === 'you') this.give(B.con, B.a + B.b);
      else if (B.con === 'you') this.give(B.pro, B.a + B.b);
      else {
        this.give(B.pro, B.a);
        this.give(B.con, B.b);
      }
      if (B.pro === 'you') this.net -= B.a;
      if (B.con === 'you') this.net -= B.b;
    }
    this.bets = [];
  }

  say(text) {
    this.lines.unshift(text);
    this.lines.length = Math.min(this.lines.length, 4);
  }

  rival() {
    const g = this.c.gang;
    return !!g && g !== 'crew' && !this.c.crew;
  }

  step(dt) {
    this.t += dt;
    if (this.c.peds.length < 1) return this.mgr.leave('They all got up and left');
    if (this.phase === 'start') {
      this.newRound();
      return;
    }
    // (somebody's offering you a bet: everything waits on your answer, a few seconds)
    if (this.offer) {
      this.offer.t -= dt;
      if (this.offer.t <= 0) this.passOffer();
      return;
    }
    if (this.phase === 'between' && this.t > (this.kind === 'celo' ? 2.4 : 1.8)) this.newRound();
    if (this.phase === 'npc' && this.t > 1.0 && !this.c.throw && this.c.ready(this.cur.s)) this.npcRoll();
    if (this.phase === 'bets' && this.t > 3.2) {
      this.lockBets();
      this.phase = 'npc';
      this.t = 0;
    }
    // A cop car rolling up, now and then.
    if (this.phase === 'between' && !this.raidChecked) {
      this.raidChecked = true;
      if (Math.random() < 0.025) this.raid();
    }
  }

  // Between hands: whoever's broke gets up and goes; now and then somebody new walks up.
  shuffleIn() {
    const floor = this.kind === 'celo' ? this.stake : Math.max(5, Math.round(this.stake * 0.3));
    for (const s of [...this.c.peds]) {
      if (s.bank >= floor || this.c.peds.length <= 1) continue;
      this.say(`${s.name}'s tapped out and walks off`);
      this.c.release(s);
    }
    const n = this.c.peds.length;
    if (n < 4 && Math.random() < (n < 2 ? 0.9 : n < 3 ? 0.4 : 0.15)) {
      const s = this.c.addPlayer(this.stake);
      if (s) this.say(`${s.name} walks up with $${s.bank}`);
    }
  }

  // ---- Cee-lo ----
  newRound() {
    const game = this.game;
    this.raidChecked = false;
    this.t = 0;
    this.shuffleIn();
    if (this.c.peds.length < 1) return this.mgr.leave('They all got up and left');
    if (this.kind === 'craps') return this.newComeOut();
    const P = this.players();
    if (game.cash < this.stake) return this.mgr.leave("You're tapped out");
    for (const p of P) this.give(p.key, -this.stake);
    this.pot = this.stake * P.length;
    this.results = new Map();
    this.order = P.map((_, i) => P[(i + this.first) % P.length]);
    this.first = (this.first + 1) % P.length;
    this.i = 0;
    this.rerolls = 0;
    this.say(`Everybody in: $${this.stake} each. Pot $${this.pot}`);
    this.next();
  }

  next() {
    const cur = this.order[this.i];
    if (!cur) return this.decide();
    this.t = 0;
    this.cur = cur;
    this.phase = cur.you ? 'you' : 'npc';
    this.c.shooter = cur.you ? 'you' : cur.s; // (steps up to the dice)
    if (cur.s) cur.s.roll = 'shake';
  }

  // (your press: ✕ / E / ROLL)
  youRoll() {
    if (this.phase !== 'you' || this.c.throw || this.offer) return;
    if (this.kind === 'craps') return this.crapsRoll('you');
    this.mgr.rollAt = this.game.time;
    this.c.toss(roll(3), 'you', (v) => this.result(v));
  }

  npcRoll() {
    const cur = this.cur;
    if (this.kind === 'craps') return this.crapsRoll(cur.s, cur.s);
    cur.s.roll = this.game.time;
    // (in their hood, now and then the dice are working for them)
    let v = roll(3);
    if (this.rival() && Math.random() < 0.15 && (celo(v)?.rank ?? 0) < 14) v = roll(3);
    this.c.toss(v, cur.s, (vv) => this.result(vv));
  }

  result(v) {
    const cur = this.cur;
    if (cur.s) cur.s.roll = 0;
    const r = celo(v);
    const who = cur.you ? 'You' : cur.name;
    if (!r) {
      // (nothing: roll again)
      this.rerolls += 1;
      this.say(`${who}: ${v.join('-')}, nothing. Again`);
      if (this.rerolls > 12) this.results.set(cur, { rank: 0, label: 'No point' });
      else {
        this.t = 0;
        this.phase = cur.you ? 'you' : 'npc';
        if (cur.s) cur.s.roll = 'shake';
        return;
      }
    } else {
      this.results.set(cur, r);
      this.say(`${who}: ${v.join('-')} · ${r.label}`);
      if (r.win) return this.decide(cur);
    }
    this.rerolls = 0;
    this.i += 1;
    this.next();
  }

  decide(auto = null) {
    const game = this.game;
    let winners;
    if (auto) winners = [auto];
    else {
      let best = -Infinity;
      for (const [, r] of this.results) best = Math.max(best, r.rank);
      winners = best < 0 ? [] : [...this.results].filter(([, r]) => r.rank === best).map(([p]) => p);
    }
    this.phase = 'between';
    this.t = 0;
    this.cur = null;
    const inIt = this.order.filter((p) => p.you || this.c.peds.includes(p.s));
    if (!winners.length) {
      // (everybody crapped out: antes back)
      for (const p of inIt) this.give(p.key, this.stake);
      this.say('Nobody hit. Money back');
      return;
    }
    const share = Math.floor(this.pot / winners.length);
    winners.forEach((p, k) => this.give(p.key, share + (k === 0 ? this.pot - share * winners.length : 0))); // (the odd dollar to the first)
    const youWon = winners.some((p) => p.you);
    for (const p of winners) if (p.s) this.c.react(p.s, 'win');
    for (const s of this.c.peds) if (!winners.some((p) => p.s === s) && Math.random() < 0.6) this.c.react(s, 'lose');
    if (youWon) {
      this.net += share - this.stake;
      this.say(winners.length > 1 ? `Split it: +$${share}` : `You take it: +$${this.pot}`);
      game.hud.toast(`You take the pot: +$${share}`, '#7ee081');
      this.heat(share - this.stake);
    } else {
      this.net -= this.stake;
      this.say(`${winners.map((p) => p.name).join(' and ')} take${winners.length > 1 ? '' : 's'} it`);
    }
  }

  // ---- Street craps ----
  shooterIsNpc() {
    return this.shooterKey !== 'you';
  }

  // What an NPC shooter puts up: the stake, or two or three times it when he's holding.
  shooterBet(s) {
    const st = this.stake;
    const k = s.bank >= st * 12 && Math.random() < 0.7 ? 3 : s.bank >= st * 6 && Math.random() < 0.6 ? 2 : 1;
    return Math.min(st * k, Math.floor(s.bank / 5) * 5);
  }

  newComeOut() {
    const P = this.players();
    let i = P.findIndex((p) => p.key === this.shooterKey);
    if (i < 0) i = (this.shooterAt ?? 0) % P.length;
    this.shooterAt = i;
    const sh = P[i];
    this.shooterKey = sh.key;
    this.cur = sh;
    this.c.shooter = sh.you ? 'you' : sh.s; // (steps up to the dice)
    this.point = null;
    this.bets = [];
    this.locked = false;
    this.t = 0;
    if (sh.you) {
      if (this.game.cash < this.stake) return this.mgr.leave("You're tapped out");
      this.raise = Math.max(1, Math.min(this.raise, Math.floor(this.game.cash / this.stake), 3));
      this.phase = 'you';
      this.say(`Your dice. Put up your bet and roll`);
    } else {
      this.center = this.shooterBet(sh.s);
      this.phase = 'bets';
      sh.s.roll = 'shake';
      this.say(`${sh.name} puts up $${this.center}${this.center > this.stake ? ' (raising it)' : ''}. With him or fade him?`);
    }
  }

  // (◀ ▶: before the come-out, your side on his dice, or how much you put up on yours)
  cycleSide(d) {
    if (this.phase === 'bets') {
      const S = ['with', 'against', 'sit'];
      this.side = S[(S.indexOf(this.side) + d + 3) % 3];
    } else if (this.phase === 'you' && this.kind === 'craps' && !this.locked) {
      const max = Math.max(1, Math.min(3, Math.floor(this.game.cash / this.stake)));
      this.raise = Math.max(1, Math.min(max, this.raise + d));
    }
  }

  // The come-out money goes down: the shooter's bet, faded; your side; theirs among themselves.
  lockBets() {
    if (this.locked) return;
    this.locked = true;
    const sh = this.shooterKey;
    const stake = this.stake;
    const others = this.c.peds.filter((s) => s !== sh);
    const X = sh === 'you' ? Math.min(this.game.cash, this.raise * stake) : this.center;
    let need = X;
    const faded = [];
    // (you fade him)
    if (sh !== 'you' && this.side === 'against' && need > 0) {
      const a = Math.min(need, this.game.cash);
      if (this.bet(sh, 'you', a, a, 'center')) {
        need -= a;
        faded.push(`you $${a}`);
      }
    }
    // (they cover what's left, the ones who like to fade first)
    for (const f of [...others].sort((p, q) => q.fade - p.fade || q.bank - p.bank)) {
      if (need <= 0) break;
      const a = Math.min(need, Math.floor((f.bank * (0.35 + f.fade * 0.35)) / 5) * 5);
      if (a >= 5 && this.bet(sh, f, a, a, 'center')) {
        need -= a;
        faded.push(`${f.name} $${a}`);
      }
    }
    const who = sh === 'you' ? 'You' : sh.name;
    if (faded.length) this.say(`${who}: $${X - need} faded (${faded.join(', ')})`);
    else this.say(`Nobody fades ${sh === 'you' ? 'you' : sh.name}`);
    // (you go with him: a side bet against one of them)
    if (sh !== 'you' && this.side === 'with') {
      const f = others.filter((o) => o.bank >= stake).sort((p, q) => q.fade - p.fade)[0];
      if (f && this.bet('you', f, stake, stake, 'side')) this.say(`You: $${stake} with ${sh.name}, ${f.name} fades you`);
      else this.say(`Nobody'll take your $${stake}`);
    }
    // (side bets among them)
    for (let k = Math.floor(Math.random() * 3); k > 0; k--) {
      const pool = others.filter((o) => o.bank >= 10 && this.riding(o) === 0);
      if (pool.length < 2) break;
      const a = pick(pool);
      const b = pick(pool.filter((o) => o !== a));
      const amt = Math.min(r5(stake * rand(0.4, 1.2)), Math.floor(Math.min(a.bank, b.bank) / 5) * 5);
      if (amt >= 5 && this.bet(a, b, amt, amt, 'side')) this.say(`${a.name} and ${b.name} bet $${amt} on it`);
    }
    // (they couldn't cover all of it: the rest is yours if you want it)
    if (sh !== 'you' && need >= 5 && this.game.cash >= 5) {
      const amt = Math.min(need, Math.floor(this.game.cash / 5) * 5);
      this.queue({ text: `Nobody's got the rest of ${sh.name}'s bet. Cover $${amt} of it?`, take: () => this.bet(sh, 'you', amt, amt, 'center') && !this.say(`You cover $${amt} more of ${sh.name}`) });
    }
  }

  crapsRoll(from, s = null) {
    if (!this.locked) this.lockBets();
    if (this.offer) return; // (an offer to answer first)
    if (s) s.roll = this.game.time;
    else this.mgr.rollAt = this.game.time;
    let v = roll(2);
    // (their shooter in their hood, you against him: the dice like him a little)
    if (s && this.rival() && this.exposure() < 0 && Math.random() < 0.12) v = roll(2);
    this.phase = 'air';
    this.c.toss(v, from, (vv) => this.crapsResult(vv, s));
  }

  // Which way you're betting this hand: + you want the shooter to hit, - you want him to miss.
  exposure() {
    let e = 0;
    for (const B of this.bets) {
      if (B.pro === 'you') e += B.a;
      if (B.con === 'you') e -= B.b;
    }
    return e;
  }

  crapsResult(v, s) {
    if (s) s.roll = 0;
    const sum = v[0] + v[1];
    const sh = this.cur;
    const who = sh.you ? 'You' : sh.name;
    let decided = null;
    if (this.point == null) {
      if (sum === 7 || sum === 11) decided = 'win';
      else if (sum === 2 || sum === 3 || sum === 12) decided = 'craps';
      else {
        this.point = sum;
        this.say(`${who}: ${v.join('-')} · point is ${sum}`);
        this.oddsOffers();
      }
    } else if (sum === this.point) decided = 'win';
    else if (sum === 7) decided = 'seven';
    else this.say(`${who}: ${v.join('-')} (${sum}) · need ${this.point}`);
    if (!decided) {
      this.t = 0;
      this.phase = sh.you ? 'you' : 'npc';
      if (sh.s) sh.s.roll = 'shake';
      return;
    }
    const shooterWins = decided === 'win';
    this.say(`${who}: ${v.join('-')} · ${shooterWins ? (this.point ? `hit the ${this.point}!` : `${sum}, winner!`) : decided === 'craps' ? `${sum}, craps` : 'seven out'}`);
    this.settle(shooterWins);
    if (sh.s) this.c.react(sh.s, shooterWins ? 'win' : 'lose');
    // (a seven out passes the dice; a winner or a craps on the come-out keeps them)
    if (decided === 'seven') {
      const P = this.players();
      const i = P.findIndex((p) => p.key === this.shooterKey);
      this.shooterAt = (i < 0 ? this.shooterAt : i) + 1;
      this.shooterKey = P[this.shooterAt % P.length].key;
    }
    this.phase = 'between';
    this.t = 0;
  }

  // Pay everybody off: the winner of each bet takes both sides of it.
  settle(shooterWins) {
    const game = this.game;
    const delta = new Map();
    const add = (p, v) => delta.set(p, (delta.get(p) || 0) + v);
    for (const B of this.bets) {
      const w = shooterWins ? B.pro : B.con;
      const l = shooterWins ? B.con : B.pro;
      this.give(w, B.a + B.b);
      add(w, shooterWins ? B.b : B.a);
      add(l, shooterWins ? -B.b : -B.a);
    }
    this.bets = [];
    for (const [p, d] of delta) {
      if (p === 'you' || p === this.shooterKey) continue;
      if (Math.random() < 0.85) this.c.react(p, d > 0 ? 'win' : 'lose');
    }
    const you = delta.get('you') || 0;
    if (you) {
      this.net += you;
      game.hud.toast(you > 0 ? `+$${you}` : `-$${-you}`, you > 0 ? '#7ee081' : '#ff8080');
      if (you > 0) this.heat(you);
    }
  }

  // A point's up: they lay and take odds on it. Up to two offers come your way.
  oddsOffers() {
    const [pays, per] = POINT_ODDS[this.point];
    const sh = this.shooterKey;
    const shName = sh === 'you' ? 'you' : sh.name;
    const others = this.c.peds.filter((o) => o !== sh && o.bank >= 10);
    const out = [];
    const base = () => r5(this.stake * rand(0.4, 1));
    const odds = `${pays} to ${per}`;
    // (one of them lays odds he misses: you back him)
    const L = pick(others);
    if (L) {
      const yours = base();
      const theirs = Math.round((yours * pays) / per);
      if (L.bank >= theirs && this.game.cash >= yours) {
        out.push({
          text: sh === 'you' ? `${L.name} lays you $${theirs} to $${yours} you don't hit the ${this.point}` : `${L.name} lays $${theirs} to your $${yours} ${shName} don't hit the ${this.point}`,
          take: () => this.bet('you', L, yours, theirs, 'odds') && !this.say(`You: $${yours} on the ${this.point} at ${odds}, ${L.name} lays it`),
          pass: () => {
            const M = pick(others.filter((o) => o !== L && o.bank >= yours));
            if (M && Math.random() < 0.6 && this.bet(M, L, yours, theirs, 'odds')) this.say(`${M.name} takes ${L.name}'s odds on the ${this.point}`);
          },
        });
      }
    }
    // (one of them takes odds he hits: you lay it)
    const B = pick(others.filter((o) => o !== L));
    if (B && sh !== 'you') {
      const theirs = base();
      const yours = Math.round((theirs * pays) / per);
      if (B.bank >= theirs && this.game.cash >= yours) {
        out.push({
          text: `${B.name} wants $${theirs} on the ${this.point} at ${odds}. Lay him $${yours}?`,
          take: () => this.bet(B, 'you', theirs, yours, 'odds') && !this.say(`You lay ${B.name} $${yours} to $${theirs} against the ${this.point}`),
        });
      }
    }
    for (const o of out.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2))) this.queue(o);
  }

  queue(o) {
    this.offers.push(o);
    if (!this.offer) this.nextOffer();
  }

  nextOffer() {
    const o = this.offers.shift();
    this.offer = o ? { ...o, t: 5 } : null;
  }

  // (✕ / E / TAKE)
  takeOffer() {
    const o = this.offer;
    if (!o) return;
    if (!o.take()) this.say("Can't cover that");
    this.nextOffer();
  }

  // (○ / Q / PASS, or it times out)
  passOffer() {
    const o = this.offer;
    if (!o) return;
    o.pass?.();
    this.nextOffer();
  }

  // ---- Trouble ----
  // You won in their hood: they get hotter about it; sometimes it boils over.
  heat(won) {
    if (!this.rival()) return;
    const war = this.game.turfWars?.playerInWar?.() ? 1.4 : 1;
    this.tension = Math.min(1, this.tension + (0.12 + Math.min(0.35, won / 1500)) * war);
    if (Math.random() < this.tension * 0.55) this.accuse(won);
  }

  accuse(won) {
    const s = pick(this.c.peds);
    if (!s) return;
    this.accused = { s, won };
    this.phase = 'accused';
    const line = pick(["Them dice loaded! Run that back.", "Nah, you cheatin'. Give me my money.", "Ain't no way. Them dice crooked.", "You switchin' dice on us?"]);
    this.say(`${s.name}: "${line}"`);
    this.game.hud.toast(`${s.name}: "${line}"`, '#ff8080');
  }

  // (✕ stand on it / ○ give it back)
  answer(stand) {
    const A = this.accused;
    if (!A || this.phase !== 'accused') return;
    this.accused = null;
    const game = this.game;
    if (!stand) {
      const back = Math.min(game.cash, A.won);
      game.cash -= back;
      A.s.bank = (A.s.bank || 0) + back; // (into his pocket)
      this.net -= back;
      this.tension = Math.max(0, this.tension - 0.35);
      this.say('You give it back. Cool...');
      game.hud.toast(`You hand it back (-$${A.won})`, '#9fc3ff');
      this.phase = 'between';
      this.t = 0;
      return;
    }
    if (Math.random() < 0.45) {
      this.say(`${A.s.name} sucks ${A.s.p?.female ? 'her' : 'his'} teeth and lets it go`);
      this.tension = Math.min(1, this.tension + 0.15);
      this.phase = 'between';
      this.t = 0;
      return;
    }
    this.mgr.goesDown(this.c, `${A.s.name}: "Aight, bet." It's going down!`);
  }

  // 12! Somebody saw a cruiser: everybody scatters, the money on the ground's gone.
  raid() {
    const game = this.game;
    game.hud.toast('"Twelve! Twelve!" The cops are rolling up', '#ff8080');
    if (Math.random() < 0.5) game.crime('gambling', this.c.x, this.c.z);
    this.mgr.leave(null, true);
  }

  // The panel.
  view() {
    const P = this.players();
    const g = this.c.gang && GANGS[this.c.gang];
    const head = `${GAME[this.kind].name.toUpperCase()} · ${this.c.crew ? 'YOUR BLOCK' : g ? g.name.toUpperCase() : 'THE CORNER'}`;
    const rows = P.map((p) => {
      const bank = `$${this.bank(p.key)}`;
      if (this.kind === 'celo') {
        const r = this.results ? [...this.results].find(([q]) => q.key === p.key)?.[1] : null;
        const now = this.cur?.key === p.key;
        return { name: p.name, you: !!p.you, text: [r ? r.label : now ? 'rolling...' : '', bank].filter(Boolean).join(' · '), now };
      }
      const shooter = p.key === this.shooterKey;
      const down = this.riding(p.key);
      const tag = shooter ? `SHOOTER${this.point ? ` · ${this.point}` : ''}` : '';
      return { name: p.name, you: !!p.you, text: [tag, down ? `$${down} down` : '', bank].filter(Boolean).join(' · '), now: shooter };
    });
    // (your money on this hand, in words)
    const act = this.bets.filter((B) => B.pro === 'you' || B.con === 'you').map((B) => {
      const mine = B.pro === 'you' ? B.a : B.b;
      const them = this.nameOf(B.pro === 'you' ? B.con : B.pro);
      const shName = this.shooterKey === 'you' ? 'you' : this.shooterKey?.name;
      if (B.kind === 'odds') return `$${mine} ${B.pro === 'you' ? 'on' : 'against'} the ${this.point} (${them})`;
      return `$${mine} ${B.pro === 'you' ? (this.shooterKey === 'you' ? 'on you' : `with ${shName}`) : `fading ${shName}`} (${them})`;
    });
    return {
      head, pot: this.kind === 'celo' ? this.pot : null, stake: this.stake, rows, lines: this.lines, phase: this.phase, side: this.side,
      net: this.net, accused: this.accused ? this.accused.s.name : null, rival: this.rival(), act: act.join(' · '),
      offer: this.offer ? this.offer.text : null, raise: this.raise, myBet: this.raise * this.stake, locked: this.locked, kind: this.kind, point: this.point,
    };
  }
}

// ---- All of it ----
export class DiceManager {
  constructor(game) {
    this.game = game;
    this.circles = [];
    this.round = null; // (you, in a game)
    this.spawnT = 2;
    this.again = 0;
  }

  get playing() {
    return !!this.round;
  }

  update(dt) {
    const game = this.game;
    if (CFG.START_NEAR_DICE && !this.startDone && game.started && game.time > 1.5 && !game.player.vehicle) this.startNear();
    const [px, pz] = game.player.pos();
    for (const c of [...this.circles]) {
      // (a long way off: they pack up)
      if (!c.you && (dist(c.x, c.z, px, pz) > 190 || c.peds.length < 2)) {
        c.dispose();
        this.circles.splice(this.circles.indexOf(c), 1);
        continue;
      }
      c.update(dt);
    }
    // New ones on corners around you: mostly in gang turf, more at night.
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = rand(3, 6);
      if (this.circles.length < MAX) this.trySpawn(px, pz);
    }
    this.panel();
  }

  // The camera while you're in a game (main.js camera, last): off to the side of the shooter,
  // a bit up, looking across him at the dice and the backstop, so you see every roll land. Your
  // look stick / drag swings it round the dice. Eases in when you get in, back out after.
  camShot(dt, cam) {
    const game = this.game;
    const R = this.round;
    this.camK = Math.max(0, Math.min(1, (this.camK || 0) + (R ? dt : -dt) * 2.2));
    if (R) this.camC = R.c;
    const C = this.camC;
    if (!C || this.camK <= 0) {
      this.camC = null;
      return null;
    }
    const [dx, dz] = C.dir;
    if (R && !this.camSet) {
      // (first frame in: from the side you walked up on, a little behind the shooter)
      // (from up by the backstop, off to the side you're on, looking back at the shooter: nobody
      // stands between it and the dice; a wall in the way, the other side)
      let side = (C.you?.pref ?? 0) >= 0 ? 1 : -1;
      const free = (sd) => {
        const a = Math.atan2(dx, dz) + sd * 1.4;
        return !pushCircle(C.sx - dx * 0.35 + Math.sin(a) * 2.4, C.sz - dz * 0.35 + Math.cos(a) * 2.4, 0.3, game.city.colliders).hit;
      };
      if (!free(side) && free(-side)) side = -side;
      game.camYaw = Math.atan2(dx, dz) + side * 1.4 + Math.PI;
      game.camPitch = 0;
      this.camSet = true;
    }
    if (!R) this.camSet = false;
    const yaw = game.camYaw;
    const lx = C.sx - dx * 0.35;
    const lz = C.sz - dz * 0.35;
    let D = 2.9;
    for (; D > 2; D -= 0.15) {
      const x = lx - Math.sin(yaw) * D;
      const z = lz - Math.cos(yaw) * D;
      if (!pushCircle(x, z, 0.15, game.city.colliders).hit) break;
    }
    const k = this.camK * this.camK * (3 - 2 * this.camK);
    const pos = new THREE.Vector3(lx - Math.sin(yaw) * D, C.y + 3.0, lz - Math.cos(yaw) * D);
    const look = new THREE.Vector3(lx, C.y + 1.35, lz); // (aimed a little over them: the dice sit low, clear of the panel)
    const fromLook = new THREE.Vector3();
    cam.getWorldDirection(fromLook).multiplyScalar(4).add(cam.position);
    return { pos: cam.position.clone().lerp(pos, k), look: fromLook.lerp(look, k) };
  }

  trySpawn(px, pz) {
    const game = this.game;
    const pts = game.city.walk?.pts;
    if (!pts?.length) return;
    const h = Math.floor((game.clockMinutes?.() ?? 720) / 60);
    const night = h >= 18 || h < 3 ? 1.6 : h < 10 ? 0.4 : 1;
    for (let k = 0; k < 12; k++) {
      const q = pts[Math.floor(Math.random() * pts.length)];
      const d = dist(q.x, q.z, px, pz);
      if (d < 45 || d > 140) continue;
      if (this.circles.some((c) => dist(c.x, c.z, q.x, q.z) < 60)) continue;
      const turf = game.turfWars?.turfAt(q.x, q.z);
      const gang = turf && !turf.hidden ? turf.id : null;
      const chance = (gang ? (gang === 'crew' ? 0.35 : 0.6) : 0.12) * night;
      if (Math.random() > chance) continue;
      // (a step in off the corner, clear of walls and poles)
      const b = q.b;
      let x = q.x;
      let z = q.z;
      if (b && b.cx != null) {
        const cx = b.cx;
        const cz = b.cz;
        const l = dist(cx, cz, x, z) || 1;
        x += ((cx - x) / l) * 1.6;
        z += ((cz - z) / l) * 1.6;
      }
      this.spawnAt(x, z, gang, Math.random() < 0.55 ? 'celo' : 'craps');
      return;
    }
  }

  // (testing) The nearest corner in a rival gang's turf: a game there, and you a few steps off it.
  startNear() {
    this.startDone = true;
    const game = this.game;
    const T = game.turfWars;
    const [px, pz] = game.player.pos();
    let best = null;
    let bd = Infinity;
    for (const q of game.city.walk?.pts || []) {
      const g = T?.turfAt(q.x, q.z);
      if (!g || g.hidden || g.id === 'crew' || !q.b || q.b.cx == null) continue;
      const d = dist(q.x, q.z, px, pz);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) return;
    const g = T.turfAt(best.x, best.z);
    const l = dist(best.b.cx, best.b.cz, best.x, best.z) || 1;
    const c = this.spawnAt(best.x + ((best.b.cx - best.x) / l) * 1.6, best.z + ((best.b.cz - best.z) / l) * 1.6, g.id, CFG.START_NEAR_DICE === 'craps' || CFG.START_NEAR_DICE === 'celo' ? CFG.START_NEAR_DICE : Math.random() < 0.5 ? 'celo' : 'craps', 4);
    // (you: a few steps behind the crowd, looking at the game; off to a side if that's a wall;
    // with something to bet)
    const p = game.player;
    game.cash = Math.max(game.cash, 500);
    for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const [x, z] = c.arcPos(off, 4.2);
      p.x = x;
      p.z = z;
      if (game.city.blockAt?.(x, z) && !pushCircle(x, z, 0.5, game.city.colliders).hit) break;
    }
    p.heading = Math.atan2(c.x - p.x, c.z - p.z);
    game.camYaw = p.heading;
    game.hud.toast(`A ${GAME[c.kind].name.toLowerCase()} game on the corner (${g.name} turf)`, '#ffd23f');
  }

  // A circle here (3 to 5 of them; in gang turf they're that gang's).
  spawnAt(x, z, gang, kind, n = 3 + Math.floor(Math.random() * 3)) {
    const r = pushCircle(x, z, 1.4, this.game.city.colliders);
    const c = new Circle(this, r.x, r.z, gang, kind, n, gang === 'crew');
    this.circles.push(c);
    return c;
  }

  // Your crew's corner: start one yourself, with whoever's posted up.
  crewNearby(px, pz) {
    const T = this.game.turfWars;
    if (!T || T.turfAt(px, pz)?.id !== 'crew') return false;
    return T.soldiers.some((s) => s.gangId === 'crew' && s.alive && dist(s.x, s.z, px, pz) < 6);
  }

  // The prompt and the button (main.js handleInteractions, when nothing else has it).
  offer(a) {
    const game = this.game;
    if (this.round || game.player.vehicle || game.time < this.again || game.courtMenu?.open) return;
    const [px, pz] = game.player.pos();
    const near = this.circles.find((c) => !c.you && c.peds.length >= 2 && dist(c.x, c.z, px, pz) < 2.6);
    const key = game.input.label('interact');
    const pressed = a.interactHeld && !game.interactWasHeld;
    if (near) {
      const g = near.gang && GANGS[near.gang];
      game.prompt = `${key}: get in the ${GAME[near.kind].name.toLowerCase()} game${g && !near.crew ? ` (${g.name} turf: watch yourself)` : ''}`;
      if (pressed) {
        a.interactHeld = false;
        this.menu(near);
      }
      return;
    }
    if (!game.prompt && this.crewNearby(px, pz) && !this.circles.some((c) => dist(c.x, c.z, px, pz) < 25)) {
      game.prompt = `${key}: start a dice game with the crew`;
      if (pressed) {
        a.interactHeld = false;
        this.menu(null);
      }
    }
  }

  // The stake (and, starting one, which game) in the court menu.
  menu(circle) {
    const game = this.game;
    const stakes = STAKES.filter((v) => v <= game.cash);
    if (!stakes.length) {
      game.hud.toast('You need at least $10 to get in', '#ff8080');
      this.again = game.time + 1;
      return;
    }
    const si = Math.max(0, stakes.indexOf(STAKES[this.stakeI ?? 1]));
    const g = circle?.gang && GANGS[circle.gang];
    const games = circle ? [circle.kind] : ['celo', 'craps'];
    game.courtMenu.show({
      title: circle ? `${circle.peds[0]?.name || 'Somebody'}'s dice game` : 'Your block',
      place: circle ? (circle.crew ? 'Your turf' : g ? `${g.name} turf${game.turfWars?.playerInWar?.() ? ' · at war' : ''}` : 'A neutral corner') : 'Start one with the crew',
      games: games.map((k) => ({ id: k, title: GAME[k].name, sub: () => (k === 'celo' ? 'Three dice · everybody antes, best roll takes the pot' : 'Two dice · 7 or 11 wins, hit your point before a 7') })),
      rules: [{ id: 'stake', label: 'Stake', values: stakes, i: si < 0 ? 0 : si, fmt: (v) => `$${v}` }],
      start: (st) => `ROLL IN · $${st.stake}`,
      watch: 'Walk away',
      onChange: (R) => {
        if (R.id === 'stake') this.stakeI = STAKES.indexOf(R.values[R.i]);
      },
      onStart: (st) => {
        let c = circle;
        if (!c) {
          const [px, pz] = game.player.pos();
          const r = pushCircle(px, pz, 1.4, game.city.colliders);
          c = new Circle(this, r.x, r.z, 'crew', st.game, 3, true);
          this.circles.push(c);
        }
        this.join(c, st.stake);
      },
      onClose: () => {
        this.again = game.time + 0.8;
      },
    });
  }

  join(c, stake) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    // (you take your place in the ring on the side you walked up)
    let pref = Math.atan2(px - c.sx, pz - c.sz) - c.back;
    pref = Math.atan2(Math.sin(pref), Math.cos(pref));
    c.you = { pref: Math.max(-1.0, Math.min(1.0, pref)) };
    if (c.shooter === 'you') c.shooter = null;
    this.round = new Round(this, c, stake);
    c.restDice();
    game.hud.toast(`${GAME[c.kind].name} · $${stake} a ${c.kind === 'celo' ? 'round' : 'bet'}. ${game.input.label('interact')} to roll · ○ / Q to walk away`, '#ffd23f');
  }

  // Getting up: done, tapped out, a raid (scatter), or after it went down.
  leave(why = null, scatter = false) {
    const game = this.game;
    const R = this.round;
    if (!R) return;
    const c = R.c;
    R.forfeit(scatter); // (money down and you walk: it's theirs; the cops: it's gone)
    this.round = null;
    c.you = null;
    this.again = game.time + 1.5;
    if (why) game.hud.toast(why, '#9fc3ff');
    else if (!scatter) game.hud.toast(R.net > 0 ? `You get up $${R.net} ahead` : R.net < 0 ? `You get up $${-R.net} down` : 'You get up even', R.net >= 0 ? '#7ee081' : '#ff8080');
    if (scatter) {
      c.dispose(true);
      this.circles.splice(this.circles.indexOf(c), 1);
      return;
    }
    // Walking off up big in their hood: a couple of them might follow you.
    if (R.rival() && R.net > 100 && Math.random() < 0.3 + Math.min(0.35, R.net / 1500) + R.tension * 0.3) {
      this.goesDown(c, `${pick(c.peds)?.name || 'One of them'}: "Where you think you going with our money?"`, 2);
    }
  }

  // It's going down: the circle gets up strapped (they're their gang's now), and the gang's
  // people nearby come too. n: how many of them (all, or a couple following you).
  goesDown(c, line, n = 99) {
    const game = this.game;
    const T = game.turfWars;
    const gang = c.gang;
    game.hud.toast(line, '#ff8080');
    if (this.round?.c === c) {
      this.round = null;
      c.you = null;
    }
    const out = c.peds.slice(0, n);
    for (const s of out) {
      const p = s.p;
      if (p.removed) continue;
      const S = new Soldier(game, T, p.x, p.z, gang, null, 'guard');
      S.heading = p.heading;
      S.aggroUntil = game.time + 60;
      T.soldiers.push(S);
      p.dispose();
    }
    c.peds = c.peds.filter((s) => !out.includes(s));
    T.aggro(gang, c.x, c.z, 45, 60);
    if (!c.peds.length || n >= 99) {
      c.dispose(true);
      this.circles.splice(this.circles.indexOf(c), 1);
    }
  }

  // Your buttons while you're in a game (main.js, before you move).
  input(dt, a) {
    const R = this.round;
    if (!R) return;
    const game = this.game;
    const p = game.player;
    const c = R.c;
    // (you're crouched in your spot: no walking about, no weapons)
    a.moveX = a.moveY = 0;
    a.sprint = false;
    const roll = (a.interactHeld && !game.interactWasHeld) || a.dealYes || a.menuOk;
    const back = a.dealNo || a.phoneBack;
    const lr = a.phoneLeft || a.menuUp ? -1 : a.phoneRight || a.menuDown ? 1 : 0;
    if (R.phase === 'accused') {
      if (roll) R.answer(true);
      else if (back) R.answer(false);
    } else if (R.offer) {
      // (somebody's offering you a bet: take it or pass)
      if (roll) R.takeOffer();
      else if (back) R.passOffer();
    } else if (R.phase === 'you') {
      if (lr) R.cycleSide(lr); // (your dice, before the come-out: how much you put up)
      if (roll) R.youRoll();
    } else if (R.phase === 'bets') {
      if (lr) R.cycleSide(lr);
      if (back) this.leave();
    } else if (back && (R.phase === 'between' || R.phase === 'start')) this.leave();
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.dealNo = a.enter = a.crouch = false;
    a.interactHeld = false;
    // (your place in the ring, or up on the dice when they're yours)
    if (this.round) {
      const P = c.place('you');
      p.x += (P.x - p.x) * Math.min(1, dt * 5);
      p.z += (P.z - p.z) * Math.min(1, dt * 5);
      p.heading = lerpAngle(p.heading, P.face, Math.min(1, dt * 8));
    }
  }

  // Your pose (main.js, after your walk animation): bent over with your hands on your knees in
  // the ring, or down on a knee on the dice, shaking and throwing.
  late() {
    const R = this.round;
    if (!R) return;
    const p = this.game.player;
    const c = p.char;
    const C = R.c;
    c.group.rotation.y = p.heading;
    const t = this.game.time;
    const shooter = C.shooter === 'you';
    const rollState = shooter && R.phase === 'you' ? 'shake' : this.rollAt && t - this.rollAt < 0.3 ? this.rollAt : 0;
    c.group.position.y += C.poseChar(c, 'hunch', shooter, rollState, null, 1.7);
  }

  // What the phone's two big buttons say right now (touch.js).
  touchLabels() {
    const R = this.round;
    if (R?.phase === 'accused') return { roll: 'STAND', back: 'GIVE BACK' };
    if (R?.offer) return { roll: 'TAKE', back: 'PASS' };
    return { roll: 'ROLL', back: 'LEAVE' };
  }

  // The dice panel (top of the screen) while you're in.
  panel() {
    let el = this.el;
    const R = this.round;
    if (!R) {
      if (el) el.classList.add('hidden');
      document.body.classList.remove('dice-on');
      return;
    }
    if (!el) {
      el = this.el = document.createElement('div');
      el.id = 'dice-panel';
      document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    document.body.classList.add('dice-on');
    const V = R.view();
    const inp = this.game.input;
    const touch = inp.touchMode;
    const pad = inp.mode === 'pad' && !touch;
    const K = { roll: touch ? 'ROLL' : pad ? '✕' : 'E', back: touch ? 'LEAVE' : pad ? '○' : 'Q', take: touch ? 'TAKE' : pad ? '✕' : 'E', pass: touch ? 'PASS' : pad ? '○' : 'Q', lr: touch ? '◀ ▶' : pad ? 'D-pad ◀ ▶' : '← →' };
    let hint = '';
    if (V.phase === 'accused') hint = `<b>${K.roll}</b> stand on it · <b>${K.back}</b> give it back`;
    else if (V.offer) hint = `<b>${K.take}</b> take it · <b>${K.pass}</b> pass`;
    else if (V.phase === 'you' && V.kind === 'craps' && !V.locked) hint = `Your bet <b>$${V.myBet}</b> · ${K.lr} change · <b>${K.roll}</b> roll 'em`;
    else if (V.phase === 'you') hint = `<b>${K.roll}</b> roll 'em`;
    else if (V.phase === 'bets') hint = `Your bet: <b>${V.side === 'with' ? 'WITH HIM' : V.side === 'against' ? 'FADE HIM' : 'SITTING OUT'}</b> · ${K.lr} change · ${K.back} walk away`;
    else if (V.phase === 'between') hint = `${K.back} walk away`;
    const rows = V.rows.map((r) => `<div class="dp-row${r.you ? ' you' : ''}${r.now ? ' now' : ''}"><span class="dp-n"></span><span class="dp-r"></span></div>`).join('');
    const html = `<div class="dp-box${V.rival ? ' rival' : ''}">
      <div class="dp-head"><span class="dp-t">${V.head}</span>${V.pot != null ? `<span class="dp-pot">POT $${V.pot}</span>` : ''}</div>
      <div class="dp-rows">${rows}</div>
      ${V.offer ? '<div class="dp-offer"></div>' : ''}
      <div class="dp-lines">${V.lines.map(() => '<div class="dp-line"></div>').join('')}</div>
      ${V.act ? '<div class="dp-act"></div>' : ''}
      <div class="dp-foot"><span class="dp-net ${V.net >= 0 ? 'up' : 'down'}">${V.net >= 0 ? '+' : '-'}$${Math.abs(V.net)}</span><span class="dp-hint">${iconizeHTML(hint)}</span></div>
    </div>`;
    const key = html + JSON.stringify(V.rows) + V.lines.join('|') + V.offer + V.act;
    if (this.lastKey !== key) {
      this.lastKey = key;
      el.innerHTML = html;
      // (names and what's said: as text)
      el.querySelectorAll('.dp-row').forEach((row, i) => {
        row.querySelector('.dp-n').textContent = V.rows[i].name;
        row.querySelector('.dp-r').textContent = V.rows[i].text;
      });
      el.querySelectorAll('.dp-line').forEach((d, i) => (d.textContent = V.lines[i]));
      const of = el.querySelector('.dp-offer');
      if (of) of.textContent = V.offer;
      const ac = el.querySelector('.dp-act');
      if (ac) ac.textContent = `Your money: ${V.act}`;
    }
  }
}
