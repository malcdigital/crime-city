import * as THREE from 'three';
import { restPose, fallPose, lieDown } from './character.js';
import { pushCircle } from './collision.js';

// Hit by a car: the body goes flying with real momentum instead of just tipping over.
// A body is two points, the feet and the head, held 1.7 m apart (position-based dynamics):
// gravity pulls on both, they hit the ground (bounce, slide, friction), walls push them out,
// and cars are solid boxes they hit and ride on. A car's bumper sweeps the legs at the car's
// speed while the head lags, so at speed the body wraps onto the hood, rides up the windshield
// and slides off over the roof or off the front when the car stops; slower, it's shoved ahead
// and drops. It spins about its own length as it goes, the arms and legs flailing; once it's
// still on the ground it's handed back lying down (character.js lieDown) where it ended up,
// face up or face down as it landed.
//   launch(t, v): t a character (peds, police, gang, crew, soldiers: x, z, heading, char), v
//   the car. main.js: update(dt) after the cars move, apply() after stepFalls each frame.
const G = 9.8;
const R_FEET = 0.1;
const R_HEAD = 0.16;
const MAX_T = 6; // (whatever happens, it's handed back by then)

const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();

export class Ragdolls {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  has(t) {
    return this.list.some((b) => b.t === t);
  }

  // The car's height (its roof), measured off its model once.
  roofOf(v) {
    if (v._roof == null) {
      const g = v.group;
      const ry = g.rotation.y;
      g.rotation.y = 0;
      g.updateMatrixWorld(true);
      _box.setFromObject(g);
      g.rotation.y = ry;
      g.updateMatrixWorld(true);
      v._roof = Math.max(0.8, _box.max.y - g.position.y);
    }
    return v._roof;
  }

  // The top of the car at u (m along it from the middle, + to the front).
  topAt(v, u) {
    const roof = this.roofOf(v);
    if (!v.type?.cab) return roof; // (a van, a bus, a box truck: flat up front)
    const h = v.halfLen;
    if (u > h * 0.3) return roof * 0.6; // (the hood)
    if (u < -h * 0.6) return roof * 0.66; // (the trunk)
    return roof;
  }

  // Sends t flying off car v.
  launch(t, v) {
    if (this.has(t)) return;
    const game = this.game;
    const c = t.char;
    const [fx, fz] = v.forward();
    const s = v.speed;
    const vx = fx * s;
    const vz = fz * s;
    const sp = Math.abs(s);
    const L = 1.7 * (c.group.scale.y || 1);
    const gy = this.ground(t, t.x, t.z, 0);
    // (which side of the car's middle they were on: they glance off that way)
    const lat = -(t.x - v.x) * fz + (t.z - v.z) * fx;
    const side = Math.max(-1, Math.min(1, lat / ((v.type?.w || 2) / 2)));
    const roof = this.roofOf(v);
    const wrap = sp > 7 && roof < 1.7 && Math.abs(side) < 0.8; // (onto the hood)
    const sx = -fz * Math.sign(s || 1);
    const sz = fx * Math.sign(s || 1);
    const push = side * sp * (wrap ? 0.15 : 0.35); // (sideways, away from the middle)
    const feet = { p: new THREE.Vector3(t.x, gy + R_FEET, t.z), r: R_FEET };
    const head = { p: new THREE.Vector3(t.x, gy + L + R_FEET, t.z), r: R_HEAD };
    const up = wrap ? 0.6 + sp * 0.12 : 1.2 + sp * 0.12;
    feet.v = new THREE.Vector3(vx * 1.0 - sx * push, wrap ? 0.8 : 0.4, vz * 1.0 - sz * push);
    head.v = new THREE.Vector3(vx * (wrap ? 0.3 : 0.9) - sx * push * 0.6, up, vz * (wrap ? 0.3 : 0.9) - sz * push * 0.6);
    // (where they face, to start; the spin about the body's length)
    const front = new THREE.Vector3(Math.sin(t.heading || 0), 0, Math.cos(t.heading || 0));
    const b = {
      t, c, L, feet, head, front, car: v, age: 0, still: 0, ground: 0, high: !!t.high, baseY: gy,
      spin: (Math.random() < 0.5 ? -1 : 1) * (2 + sp * 0.5),
      seed: Math.random() * 10,
    };
    this.list.push(b);
    if (v.driver === 'player') game.shakeCamera?.(Math.min(0.35, 0.08 + sp * 0.015), 0.15);
  }

  // Knocked off their feet by a blow from (fx, fz): power, m/s at the head. The feet slide a
  // little, the head goes back hard, and they topple and land where the hit sends them.
  knock(t, fx, fz, power = 3) {
    if (this.has(t)) return;
    const c = t.char;
    const L = 1.7 * (c.group.scale.y || 1);
    let dx = t.x - fx;
    let dz = t.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const gy = this.ground(t, t.x, t.z, 0);
    const feet = { p: new THREE.Vector3(t.x, gy + R_FEET, t.z), r: R_FEET, v: new THREE.Vector3(dx * power * 0.35, 0, dz * power * 0.35) };
    const head = { p: new THREE.Vector3(t.x, gy + L + R_FEET, t.z), r: R_HEAD, v: new THREE.Vector3(dx * power, 0.6, dz * power) };
    const front = new THREE.Vector3(Math.sin(t.heading || 0), 0, Math.cos(t.heading || 0));
    this.list.push({
      t, c, L, feet, head, front, car: null, age: 0, still: 0, ground: 0, high: !!t.high, baseY: gy,
      spin: (Math.random() - 0.5) * power * 0.6, seed: Math.random() * 10, calm: true,
    });
  }

  ground(t, x, z, y) {
    const game = this.game;
    if (t.high) {
      const h = game.highway?.heightAt?.(x, z, y);
      if (h != null) return h;
    }
    return game.city.groundY(x, z);
  }

  update(dt) {
    if (!this.list.length) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / n;
    for (let i = 0; i < n; i++) for (const b of this.list) this.step(b, h);
    for (const b of this.list) {
      b.age += dt;
      b.t.t = Math.max(b.t.t || 0, 1.5); // (nobody gets up mid-flight)
      // (where they are, for everyone else: their feet)
      b.t.x = b.feet.p.x;
      b.t.z = b.feet.p.z;
      const v = Math.max(b.feet.v.length(), b.head.v.length());
      b.still = b.ground >= 2 && v < 0.6 ? b.still + dt : 0;
      if (b.still > 0.35 || b.age > MAX_T || !b.t.char.group.parent) this.settle(b);
    }
    this.list = this.list.filter((b) => !b.done);
  }

  step(b, h) {
    const pts = [b.feet, b.head];
    for (const q of pts) {
      q.prev = q.prev || new THREE.Vector3();
      q.prev.copy(q.p);
      q.v.y -= G * h;
      q.vy0 = q.v.y;
      q.p.addScaledVector(q.v, h);
    }
    // (one body: the feet and head stay L apart)
    for (let k = 0; k < 2; k++) {
      _v.subVectors(b.head.p, b.feet.p);
      const d = _v.length() || 1e-4;
      const e = (d - b.L) / d / 2;
      b.feet.p.addScaledVector(_v, e);
      b.head.p.addScaledVector(_v, -e);
      for (const q of pts) this.collide(b, q);
    }
    let onGround = 0;
    for (const q of pts) {
      // (velocity from the move, then contact: friction on the ground)
      q.v.subVectors(q.p, q.prev).divideScalar(h);
      // (being pushed out of the ground or up onto a car stops a fall; it doesn't fire you
      // upward: a big push in one step would read as a huge speed)
      if (q.contact === 'ground') q.v.y = Math.min(q.v.y, Math.max(q.vy0, 0) + 0.5);
      else if (q.contact === 'car') q.v.y = Math.min(q.v.y, Math.max(q.vy0, 0) + 2.5);
      else if (q.v.y > q.vy0 + 4) q.v.y = q.vy0 + 4; // (the body pulling a point up after it)
      if (q.contact === 'ground') {
        onGround++;
        // (sliding on the street: friction takes off so much speed a second, then it stops)
        const sp = Math.hypot(q.v.x, q.v.z);
        const f = sp > 1e-4 ? Math.max(0, sp - 0.8 * G * h) / sp : 0;
        q.v.x *= f * (1 - 0.5 * h);
        q.v.z *= f * (1 - 0.5 * h);
        if (q.bounce != null) q.v.y = Math.max(q.v.y, q.bounce);
      } else if (q.contact === 'car') {
        // (riding on the car: dragged along with it, sliding over it)
        // (friction: it can only pull the body along so hard, so brake and it slides off the
        // front; floor it and it slides back over the roof)
        const car = q.on;
        const [fx, fz] = car.forward();
        const dx = fx * car.speed - q.v.x;
        const dz = fz * car.speed - q.v.z;
        const dv = Math.hypot(dx, dz);
        const k = dv > 1e-4 ? Math.min(1, (0.55 * G * h) / dv) : 0;
        q.v.x += dx * k;
        q.v.z += dz * k;
      }
    }
    b.ground = onGround;
    // (still up on a car after a couple of seconds: it rolls off the side)
    if (b.age > 2) {
      for (const q of pts) {
        if (q.contact !== 'car') continue;
        const car = q.on;
        const [fx, fz] = car.forward();
        const w = -(q.p.x - car.x) * fz + (q.p.z - car.z) * fx;
        const sgn = w >= 0 ? 1 : -1;
        q.v.x += -fz * sgn * 5 * h;
        q.v.z += fx * sgn * 5 * h;
        b.spin += sgn * 3 * h;
      }
    }
    // (the spin about the body's length dies on the ground)
    if (onGround) b.spin *= Math.max(0, 1 - 6 * h * onGround);
    _v.subVectors(b.head.p, b.feet.p).normalize();
    b.front.applyAxisAngle(_v, b.spin * h);
    b.front.addScaledVector(_v, -b.front.dot(_v));
    if (b.front.lengthSq() < 1e-6) b.front.set(_v.z, 0, -_v.x);
    b.front.normalize();
  }

  // Ground, walls, cars.
  collide(b, q) {
    const game = this.game;
    q.contact = null;
    q.bounce = null;
    // Cars: a solid box, the top shaped (hood, roof, trunk).
    for (const v of game.vehicles) {
      if (v.removed || !!v.high !== b.high) continue;
      const dx = q.p.x - v.x;
      const dz = q.p.z - v.z;
      if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
      const [fx, fz] = v.forward();
      const u = dx * fx + dz * fz;
      const w = -dx * fz + dz * fx;
      const hl = v.halfLen + q.r * 0.5;
      const hw = (v.type?.w || 2) / 2 + q.r * 0.5;
      if (Math.abs(u) > hl || Math.abs(w) > hw) continue;
      const base = v.y ?? this.ground(b.t, v.x, v.z, q.p.y);
      const top = base + this.topAt(v, u) + q.r;
      if (q.p.y >= top) continue;
      // (out the shortest way: up on top, or out the front, back or sides)
      const outs = [
        [top - q.p.y, 'up'],
        [hl - u, 'front'],
        [hl + u, 'back'],
        [hw - w, 'left'],
        [hw + w, 'right'],
      ];
      // (anything that was above the top a moment ago lands on it)
      if (q.prev.y >= top - 0.25) outs[0][0] *= 0.3;
      outs.sort((a, c) => a[0] - c[0]);
      const [d, way] = outs[0];
      if (way === 'up') {
        q.p.y = top;
        q.contact = 'car';
        q.on = v;
      } else {
        // (the w axis runs (-fz, fx): left is +w, right is -w)
        const [mx, mz] = way === 'front' ? [fx, fz] : way === 'back' ? [-fx, -fz] : way === 'left' ? [-fz, fx] : [fz, -fx];
        q.p.x += mx * d;
        q.p.z += mz * d;
      }
    }
    // Walls and buildings.
    const r = pushCircle(q.p.x, q.p.z, q.r, game.city.colliders);
    if (r.hit && q.p.y < b.baseY + 2.5) {
      q.p.x = r.x;
      q.p.z = r.z;
    }
    // The ground.
    const g = this.ground(b.t, q.p.x, q.p.z, q.p.y) + q.r;
    if (q.p.y < g + 0.02) {
      q.p.y = Math.max(q.p.y, g);
      q.contact = 'ground';
      if (q.p.y - q.prev.y < -0.06) q.bounce = 0; // (came down hard: no burrowing in)
    }
  }

  // Each frame after stepFalls (main.js frame): the body where the physics has it, the arms
  // and legs flailing in the air and settling toward how it'll lie.
  apply() {
    const now = performance.now() / 1000;
    for (const b of this.list) {
      const c = b.c;
      const g = c.group;
      _y.subVectors(b.head.p, b.feet.p).normalize();
      _z.copy(b.front);
      _x.crossVectors(_y, _z).normalize();
      _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      _q.setFromRotationMatrix(_m);
      g.quaternion.copy(_q);
      // (the axis is the body's middle: the feet point is its origin)
      g.position.copy(b.feet.p).addScaledVector(_y, -b.feet.r * 0.5);
      // Limbs: how it'll lie (face up or down as it is now), flung about while it flies.
      const face = b.front.y >= 0 ? 'back' : 'front';
      fallPose(c, 1.3, face);
      const air = (b.ground ? Math.max(0, 1 - b.age * 0.2) * 0.3 : 1) * (b.calm ? 0.45 : 1);
      const t = now * 9 + b.seed;
      const a = air;
      c.armL.rotation.x += Math.sin(t) * 1.1 * a - 1.2 * a;
      c.armL.rotation.z += (0.6 + Math.sin(t * 1.3) * 0.5) * a;
      c.armR.rotation.x += Math.sin(t + 2) * 1.1 * a - 1.0 * a;
      c.armR.rotation.z -= (0.6 + Math.sin(t * 1.1 + 1) * 0.5) * a;
      c.elbowL.rotation.x += -0.6 * a + Math.sin(t * 1.7) * 0.4 * a;
      c.elbowR.rotation.x += -0.6 * a + Math.sin(t * 1.5 + 1) * 0.4 * a;
      c.legL.rotation.x += Math.sin(t * 0.8) * 0.7 * a;
      c.legR.rotation.x += Math.sin(t * 0.8 + 2.5) * 0.7 * a;
      c.kneeL.rotation.x += (0.6 + Math.sin(t * 1.2) * 0.4) * a;
      c.kneeR.rotation.x += (0.6 + Math.sin(t * 1.2 + 1.5) * 0.4) * a;
      c.neck.rotation.x += Math.sin(t * 1.4) * 0.4 * a;
    }
  }

  // Still: lying where it ended up, handed back to the character.
  settle(b) {
    b.done = true;
    const t = b.t;
    const c = b.c;
    const hx = b.head.p.x - b.feet.p.x;
    const hz = b.head.p.z - b.feet.p.z;
    const face = b.front.y >= 0 ? 'back' : 'front';
    // (lying: face up, the head points back along -z of its facing; face down, along +z)
    t.heading = face === 'back' ? Math.atan2(-hx, -hz) : Math.atan2(hx, hz);
    t.x = b.feet.p.x;
    t.z = b.feet.p.z;
    restPose(c);
    c.group.quaternion.identity();
    c.group.rotation.set(0, t.heading, 0);
    lieDown(c, face);
    if (b.high && this.ground(t, t.x, t.z, b.feet.p.y) === this.game.city.groundY(t.x, t.z)) t.high = false;
  }
}
