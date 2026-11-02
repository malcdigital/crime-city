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
      const pref = n === 1 ? 0 : -1.2 + (2.4 * i) / (n - 1) + rand(-0.1, 0.1);
      const [px, pz] = this.arcPos(pref, 1.5);
      const p = game.peds.addAt(px, pz);
      p.act = this;
      p.state = 'play';
      p.keep = true;
      p.diceName = pick((p.female ? WOMEN : NAMES).filter((nm) => !this.peds.some((o) => o.name === nm)));
      if (gang && GANGS[gang]) setShirt(p.char, GANGS[gang].shirt);
      const s = { p, name: p.diceName, react: 0, reactKind: null, roll: 0, pref, rj: rand(-0.12, 0.3), role: roles[i % roles.length], seed: Math.random() * 10 };
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
  // order they're in (you where you walked up), a gap where the shooter stepped out of.
  place(key) {
    const [dx, dz] = this.dir;
    if (key === this.shooter) return { x: this.sx - dx * SHOOT_D, z: this.sz - dz * SHOOT_D, face: Math.atan2(dx, dz) };
    const all = [...this.peds.map((s) => ({ key: s, pref: s.pref })), ...(this.you ? [{ key: 'you', pref: this.you.pref }] : [])].sort((a, b) => a.pref - b.pref);
    const n = all.length;
    const A = Math.min(1.3, 0.36 * (n - 1) + 0.2);
    const i = all.findIndex((m) => m.key === key);
    const s = key === 'you' ? null : key;
    const ang = n === 1 ? 0.5 : -A + (2 * A * i) / (n - 1) + (s ? Math.sin(s.seed) * 0.08 : 0);
    const r = s?.role === 'squat' ? 1.25 : 1.5 + (s ? s.rj : 0);
    const [x, z] = this.arcPos(ang, r);
    return { x, z, face: Math.atan2(this.sx - x, this.sz - z) };
  }

  // On their mark (the shooter: down on the dice, ready to throw)?
  ready(s) {
    if (!this.peds.includes(s)) return true; // (gone: don't wait on him)
    const P = this.place(s);
    return dist(s.p.x, s.p.z, P.x, P.z) < 0.2;
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
    this.side = 'against'; // (craps: with the shooter, against him, or sit out)
    this.shooter = 0;
    this.lines = []; // (the panel: the last few things that happened)
  }

  // Everybody in it, you included, in seat order.
  players() {
    return [{ you: true, name: 'You' }, ...this.c.peds.map((s) => ({ s, name: s.name }))];
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
    const game = this.game;
    if (this.c.peds.length < 1) return this.mgr.leave('They all got up and left');
    if (this.phase === 'start') {
      this.newRound();
      return;
    }
    if (this.phase === 'between' && this.t > (this.kind === 'celo' ? 2.4 : 1.6)) this.newRound();
    if (this.phase === 'npc' && this.t > 1.0 && !this.c.throw && this.c.ready(this.cur.s)) this.npcRoll();
    if (this.phase === 'bets' && this.t > 2.6 && this.shooterIsNpc()) {
      this.placeBet();
      this.phase = 'npc';
      this.t = 0;
    }
    // A cop car rolling up, now and then.
    if (this.phase === 'between' && !this.raidChecked) {
      this.raidChecked = true;
      if (Math.random() < 0.025) this.raid();
    }
    void game;
  }

  // ---- Cee-lo ----
  newRound() {
    const game = this.game;
    this.raidChecked = false;
    this.t = 0;
    if (this.kind === 'craps') return this.newComeOut();
    const P = this.players();
    if (game.cash < this.stake) return this.mgr.leave("You're tapped out");
    game.cash -= this.stake;
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
    if (this.phase !== 'you' || this.c.throw) return;
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
    if (!winners.length) {
      // (everybody crapped out: antes back)
      game.cash += this.stake;
      this.say('Nobody hit. Money back');
      return;
    }
    const share = Math.floor(this.pot / winners.length);
    const youWon = winners.some((p) => p.you);
    for (const p of winners) if (p.s) this.c.react(p.s, 'win');
    for (const s of this.c.peds) if (!winners.some((p) => p.s === s) && Math.random() < 0.6) this.c.react(s, 'lose');
    if (youWon) {
      game.cash += share;
      this.net += share - this.stake;
      this.say(winners.length > 1 ? `Split it: +$${share}` : `You take it: +$${this.pot}`);
      game.hud.toast(`You take the pot: +$${share}`, '#7ee081');
      this.heat(share);
    } else {
      this.net -= this.stake;
      this.say(`${winners.map((p) => p.name).join(' and ')} take${winners.length > 1 ? '' : 's'} it`);
    }
  }

  // ---- Street craps ----
  shooterIsNpc() {
    const P = this.players();
    return !P[this.shooter % P.length].you;
  }

  newComeOut() {
    const P = this.players();
    this.shooter %= P.length;
    const sh = P[this.shooter];
    this.cur = sh;
    this.c.shooter = sh.you ? 'you' : sh.s; // (steps up to the dice)
    this.point = null;
    this.bet = null;
    this.t = 0;
    if (sh.you) {
      // (you're shooting: you bet on yourself, somebody fades you)
      if (this.game.cash < this.stake) return this.mgr.leave("You're tapped out");
      this.game.cash -= this.stake;
      this.bet = 'with';
      this.say(`Your dice. $${this.stake} on you, ${pick(this.c.peds).name} fades`);
      this.phase = 'you';
    } else {
      this.phase = 'bets';
      sh.s.roll = 'shake';
      this.say(`${sh.name} shooting. Bet with him, fade him, or sit out`);
    }
  }

  // (◀ ▶ while he's getting ready)
  cycleSide(d) {
    if (this.phase !== 'bets') return;
    const S = ['with', 'against', 'sit'];
    this.side = S[(S.indexOf(this.side) + d + 3) % 3];
  }

  placeBet() {
    if (this.side === 'sit' || this.game.cash < this.stake) {
      this.bet = null;
      return;
    }
    this.game.cash -= this.stake;
    this.bet = this.side;
  }

  crapsRoll(from, s = null) {
    if (s) s.roll = this.game.time;
    else this.mgr.rollAt = this.game.time;
    let v = roll(2);
    // (their shooter in their hood: the dice like him a little)
    if (s && this.rival() && this.bet === 'against' && Math.random() < 0.12) v = roll(2);
    this.phase = 'air';
    this.c.toss(v, from, (vv) => this.crapsResult(vv, s));
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
    // Your money.
    const game = this.game;
    if (this.bet) {
      const youWin = (this.bet === 'with') === shooterWins;
      if (youWin) {
        game.cash += this.stake * 2;
        this.net += this.stake;
        game.hud.toast(`+$${this.stake}`, '#7ee081');
        this.heat(this.stake * 2);
      } else this.net -= this.stake;
    }
    if (sh.s) this.c.react(sh.s, shooterWins ? 'win' : 'lose');
    // (a seven out passes the dice; a winner or a craps on the come-out keeps them)
    if (decided === 'seven') this.shooter += 1;
    this.phase = 'between';
    this.t = 0;
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
      game.cash -= Math.min(game.cash, A.won);
      this.net -= A.won;
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
    const rows = this.kind === 'celo'
      ? P.map((p) => {
        const r = this.results ? [...this.results].find(([q]) => q.you === p.you && q.s === p.s)?.[1] : null;
        const now = this.cur && this.cur.you === p.you && this.cur.s === p.s;
        return { name: p.name, you: !!p.you, text: r ? r.label : now ? 'rolling...' : '', now };
      })
      : P.map((p, i) => ({ name: p.name, you: !!p.you, text: i === this.shooter % P.length ? `SHOOTER${this.point ? ` · point ${this.point}` : ''}` : '', now: i === this.shooter % P.length }));
    return { head, pot: this.kind === 'celo' ? this.pot : null, stake: this.stake, rows, lines: this.lines, phase: this.phase, side: this.side, bet: this.bet, net: this.net, accused: this.accused ? this.accused.s.name : null, rival: this.rival() };
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
    c.you = { pref: Math.max(-1.3, Math.min(1.3, pref)) };
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
    if (R.phase === 'accused') {
      if (roll) R.answer(true);
      else if (back) R.answer(false);
    } else if (R.phase === 'you' && roll) R.youRoll();
    else if (R.phase === 'bets') {
      if (a.phoneLeft || a.menuUp) R.cycleSide(-1);
      if (a.phoneRight || a.menuDown) R.cycleSide(1);
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
    const K = { roll: touch ? 'ROLL' : pad ? '✕' : 'E', back: touch ? 'LEAVE' : pad ? '○' : 'Q', lr: touch ? '◀ ▶' : pad ? 'D-pad ◀ ▶' : '← →' };
    let hint = '';
    if (V.phase === 'accused') hint = `<b>${K.roll}</b> stand on it · <b>${K.back}</b> give it back`;
    else if (V.phase === 'you') hint = `<b>${K.roll}</b> roll 'em`;
    else if (V.phase === 'bets') hint = `Your bet: <b>${V.side === 'with' ? 'WITH HIM' : V.side === 'against' ? 'FADE HIM' : 'SITTING OUT'}</b> ($${V.stake}) · ${K.lr} change · ${K.back} walk away`;
    else if (V.phase === 'between') hint = `${K.back} walk away`;
    const rows = V.rows.map((r) => `<div class="dp-row${r.you ? ' you' : ''}${r.now ? ' now' : ''}"><span class="dp-n"></span><span class="dp-r"></span></div>`).join('');
    const html = `<div class="dp-box${V.rival ? ' rival' : ''}">
      <div class="dp-head"><span class="dp-t">${V.head}</span>${V.pot != null ? `<span class="dp-pot">POT $${V.pot}</span>` : ''}</div>
      <div class="dp-rows">${rows}</div>
      <div class="dp-lines">${V.lines.map(() => '<div class="dp-line"></div>').join('')}</div>
      <div class="dp-foot"><span class="dp-net ${V.net >= 0 ? 'up' : 'down'}">${V.net >= 0 ? '+' : '-'}$${Math.abs(V.net)}</span><span class="dp-hint">${iconizeHTML(hint)}</span></div>
    </div>`;
    const key = html + JSON.stringify(V.rows) + V.lines.join('|');
    if (this.lastKey !== key) {
      this.lastKey = key;
      el.innerHTML = html;
      // (names and what's said: as text)
      el.querySelectorAll('.dp-row').forEach((row, i) => {
        row.querySelector('.dp-n').textContent = V.rows[i].name;
        row.querySelector('.dp-r').textContent = V.rows[i].text;
      });
      el.querySelectorAll('.dp-line').forEach((d, i) => (d.textContent = V.lines[i]));
    }
  }
}
