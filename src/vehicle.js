import * as THREE from 'three';
import { lam } from './character.js';
import { pushCircle } from './collision.js';
import { clamp, lerp, wrapAngle } from './util.js';

export const VTYPES = {
  sedan: { armor: 5, w: 2.0, l: 4.4, h: 0.95, cab: [1.8, 0.7, 2.2, -0.2], max: 30, accel: 9, brake: 20, rev: 8, value: 900, label: 'Sedan',
    colors: [0x2a4d8f, 0x8f2a2a, 0xd0d0d0, 0x333333, 0x2f6b4f, 0xc9a227, 0x7a7a7a] },
  sports: { armor: 4, w: 2.0, l: 4.3, h: 0.75, cab: [1.7, 0.55, 1.8, -0.35], max: 44, accel: 14, brake: 24, rev: 8, value: 2500, label: 'Sports car',
    colors: [0xd61f1f, 0xf2c40f, 0x111111, 0x1f6fd6] },
  van: { armor: 6, w: 2.2, l: 5.0, h: 1.9, cab: null, max: 24, accel: 7, brake: 16, rev: 7, value: 700, label: 'Van',
    colors: [0xffffff, 0x5d6d7e, 0xa04000] },
  police: { armor: 6, w: 2.0, l: 4.6, h: 0.95, cab: [1.8, 0.7, 2.2, -0.2], max: 40, accel: 13, brake: 24, rev: 9, value: 1500, label: 'Police cruiser',
    colors: [0x151515] },
  swat: { armor: 10, w: 2.4, l: 5.4, h: 1.9, cab: null, max: 32, accel: 10, brake: 20, rev: 7, value: 2200, label: 'SWAT van',
    colors: [0x1b1f24] },
};

// Handling, after GTA V's handling.meta: max = peak tire grip (fTractionCurveMax, in g),
// slide = sliding grip as a share of the peak (fTractionCurveMin / Max), peak = slip angle of
// peak grip in radians (from fTractionCurveLateral), bias = front share of grip
// (fTractionBiasFront; a little under 0.5 keeps the rear planted).
const HANDLING = {
  sedan: { max: 1.95, slide: 0.86, peak: 0.16, bias: 0.48 },
  sports: { max: 2.3, slide: 0.88, peak: 0.15, bias: 0.48 },
  van: { max: 1.6, slide: 0.84, peak: 0.17, bias: 0.47 },
  police: { max: 2.1, slide: 0.87, peak: 0.16, bias: 0.48 },
  swat: { max: 1.65, slide: 0.85, peak: 0.17, bias: 0.47 },
};

const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
wheelGeo.rotateZ(Math.PI / 2);
const lightGeo = new THREE.BoxGeometry(0.4, 0.18, 0.06);
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xc0392b });

export class Vehicle {
  constructor(scene, typeName, x, z, heading, color) {
    const t = VTYPES[typeName];
    this.scene = scene;
    this.type = t;
    this.typeName = typeName;
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steerVis = 0;
    this.driver = null; // 'player', a traffic driver, or a police unit
    this.radius = t.w / 2 + 0.15;
    this.halfLen = t.l / 2;
    this.siren = false;
    this.sirenT = 0;
    this.crash = 0;
    this.removed = false;
    this.health = 100;
    this.wrecked = false; // on fire, about to explode
    this.exploded = false; // burnt-out shell
    this.burnT = 0;
    this.byPlayer = false;
    this.lat = 0; // sideways slide speed (drifting)
    this.grip = 1;
    this.drifting = false;
    this.burnout = false;
    this.rearSpin = 0;
    this.color = color ?? t.colors[Math.floor(Math.random() * t.colors.length)];
    this.group = new THREE.Group();
    this.wheels = [];
    this.build();
    scene.add(this.group);
    this.sync(0);
  }

  build() {
    const g = this.group;
    const t = this.type;
    const body = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.l), lam(this.color));
    body.position.y = 0.35 + t.h / 2;
    body.castShadow = true;
    g.add(body);
    if (t.cab) {
      const [cw, ch, cl, cz] = t.cab;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cl), lam(0x1d2630));
      cab.position.set(0, 0.35 + t.h + ch / 2, cz);
      cab.castShadow = true;
      g.add(cab);
    } else {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(t.w * 0.85, 0.7), lam(0x1d2630));
      glass.position.set(0, 0.35 + t.h - 0.5, t.l / 2 + 0.01);
      g.add(glass);
    }
    if (this.typeName === 'swat') {
      const band = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.02, 0.35, t.l * 0.7), lam(0x2d3e58));
      band.position.set(0, 0.35 + t.h * 0.45, -0.3);
      g.add(band);
      this.lightR = new THREE.MeshBasicMaterial({ color: 0x550000 });
      this.lightB = new THREE.MeshBasicMaterial({ color: 0x000055 });
      const top = 0.35 + t.h + 0.1;
      const lr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.35), this.lightR);
      lr.position.set(-0.45, top, t.l / 2 - 0.6);
      const lb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.35), this.lightB);
      lb.position.set(0.45, top, t.l / 2 - 0.6);
      g.add(lr, lb);
    }
    if (this.typeName === 'police') {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.02, 0.45, 2.0), lam(0xf2f2f2));
      stripe.position.set(0, 0.35 + t.h / 2, 0.1);
      g.add(stripe);
      this.lightR = new THREE.MeshBasicMaterial({ color: 0x550000 });
      this.lightB = new THREE.MeshBasicMaterial({ color: 0x000055 });
      const top = 0.35 + t.h + t.cab[1] + 0.1;
      const lr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), this.lightR);
      lr.position.set(-0.4, top, -0.2);
      const lb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), this.lightB);
      lb.position.set(0.4, top, -0.2);
      g.add(lr, lb);
    }
    // Front doors on hinges (every car). The car faces +z, so its right side is local -x.
    // side: -1 = driver (left), +1 = passenger (right).
    this.doors = {};
    const doorLen = this.typeName === 'sports' ? 1.25 : 1.1;
    const hingeZ = t.cab ? t.l * 0.12 + 0.05 : t.l / 2 - 0.85;
    const doorColor = this.typeName === 'police' ? 0xf2f2f2 : this.color;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(-side * (t.w / 2 + 0.03), 0.35 + t.h / 2 + 0.05, hingeZ);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, Math.min(t.h * 0.95 + 0.35, 1.5), doorLen), lam(doorColor));
      door.position.set(0, 0.1, -doorLen / 2);
      door.castShadow = true;
      pivot.add(door);
      // Window strip on the door.
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.3, doorLen * 0.8), lam(0x1d2630));
      win.position.set(0, t.h * 0.5 + 0.12, -doorLen / 2 - 0.05);
      if (t.cab) pivot.add(win);
      g.add(pivot);
      this.doors[side] = { pivot, angle: 0, target: 0, len: doorLen, closeT: 0 };
    }
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(lightGeo, headMat);
      hl.position.set(sx * (t.w / 2 - 0.35), 0.35 + t.h * 0.6, t.l / 2 + 0.01);
      const tl = new THREE.Mesh(lightGeo, tailMat);
      tl.position.set(sx * (t.w / 2 - 0.35), 0.35 + t.h * 0.6, -t.l / 2 - 0.01);
      g.add(hl, tl);
      for (const sz of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, lam(0x151515));
        w.rotation.order = 'YXZ';
        w.position.set(sx * (t.w / 2 - 0.02), 0.38, sz * (t.l / 2 - 0.85));
        w.userData.front = sz > 0;
        w.userData.left = sx > 0; // local +x is the car's left side
        w.userData.flat = false;
        g.add(w);
        this.wheels.push(w);
      }
    }
  }

  // Swing a door open. With autoClose (seconds), it shuts again by itself.
  openDoor(side, autoClose = 0) {
    if (!this.doors || this.exploded) return;
    const d = this.doors[side];
    d.target = side * 1.05;
    d.closeT = autoClose;
  }

  closeDoors() {
    if (this.doors) for (const d of Object.values(this.doors)) d.target = 0;
  }

  // World-space boxes for open doors, so bullets hit them.
  doorBoxes() {
    if (!this.doors) return [];
    const out = [];
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const toWorld = (lx, lz) => [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
    for (const d of Object.values(this.doors)) {
      if (Math.abs(d.angle) < 0.4) continue;
      const hx = d.pivot.position.x;
      const hz = d.pivot.position.z;
      const tx = hx - Math.sin(d.angle) * d.len;
      const tz = hz - Math.cos(d.angle) * d.len;
      const [ax, az] = toWorld(hx, hz);
      const [bx, bz] = toWorld(tx, tz);
      out.push({ minX: Math.min(ax, bx) - 0.06, maxX: Math.max(ax, bx) + 0.06, minZ: Math.min(az, bz) - 0.06, maxZ: Math.max(az, bz) + 0.06, h: 1.4 });
    }
    return out;
  }

  forward() {
    return [Math.sin(this.heading), Math.cos(this.heading)];
  }

  circles() {
    const [fx, fz] = this.forward();
    const o = this.halfLen - this.radius;
    return [
      [this.x + fx * o, this.z + fz * o],
      [this.x - fx * o, this.z - fz * o],
    ];
  }

  // ctrl: { throttle: -1..1, steer: -1..1 (positive = right), handbrake: bool }
  // Health is 0-100; tougher vehicles (armor) take less from each hit.
  damage(amount, byPlayer) {
    if (this.wrecked) return;
    const armorMod = [1, 0.7, 0.45, 0.25][this.mods ? this.mods.armor : 0]; // mod garage armor
    this.health -= (amount / (this.type.armor || 1)) * armorMod;
    if (byPlayer) this.byPlayer = true;
    if (this.health <= 0) {
      this.health = 0;
      this.wrecked = true;
      this.burnT = 7; // on fire: time to get out before it blows
    }
  }

  // Brake strength, with mod garage brake upgrades.
  brakePow() {
    return this.type.brake * (1 + 0.15 * (this.mods ? this.mods.brakes : 0));
  }

  // New paint: swap the body color (body panels and doors share one material per color).
  repaint(color) {
    const from = lam(this.color);
    const to = lam(color);
    this.group.traverse((m) => {
      if (m.isMesh && m.material === from) m.material = to;
    });
    this.color = color;
  }

  burnOut() {
    this.exploded = true;
    this.siren = false;
    const burnt = lam(0x1c1c1c);
    this.group.traverse((m) => {
      if (m.isMesh) m.material = burnt;
    });
  }

  get flatCount() {
    return this.wheels.filter((w) => w.userData.flat).length;
  }

  // World position of wheel i (for aiming at tires).
  wheelPos(i) {
    const w = this.wheels[i];
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const lx = w.position.x;
    const lz = w.position.z;
    return [this.x + lx * c + lz * s, 0.38, this.z - lx * s + lz * c];
  }

  // Shoot out a tire: it sags, and the car gets slower and pulls to that side.
  popTire(i) {
    const w = this.wheels[i];
    if (!w || w.userData.flat) return false;
    w.userData.flat = true;
    w.scale.set(1, 0.6, 0.6);
    w.position.y = 0.24;
    return true;
  }

  update(dt, ctrl, boxes) {
    if (this.wrecked) ctrl = { throttle: 0, steer: 0, handbrake: true };
    const t = this.type;
    let s = this.speed;
    const s0 = s;
    const thr = ctrl.throttle || 0;
    // Flat tires: lower top speed and acceleration.
    const flats = this.flatCount;
    const eng = this.mods ? this.mods.engine : 0; // mod garage engine level
    const maxS = t.max * (1 - 0.18 * flats) * (1 + 0.07 * eng);
    const accel = t.accel * (1 - 0.15 * flats) * (1 + 0.12 * eng);
    if (thr > 0) {
      if (s < -0.5) s += this.brakePow() * dt * thr;
      else s += accel * thr * dt * Math.max(0, 1 - s / maxS);
    } else if (thr < 0) {
      if (s > 0.5) s -= this.brakePow() * dt * -thr;
      else s = Math.max(-t.rev, s - t.accel * 0.6 * dt * -thr);
    } else {
      s -= Math.sign(s) * Math.min(Math.abs(s), 2.5 * dt);
    }
    s -= s * 0.08 * dt;
    if (ctrl.handbrake) s -= s * 2.2 * dt;

    if (flats) s -= s * 0.25 * flats * dt; // rims drag
    const steerMax = 0.6 / (1 + Math.abs(s) * 0.045);
    let steer = ctrl.steer || 0;
    // Burnout: gas and brake together from a standstill. The rear tires spin in place and
    // steering swings the back end around the front wheels.
    this.burnout = !!ctrl.burnout && Math.abs(s) < 3 && !this.wrecked;
    if (this.burnout) {
      s *= Math.max(0, 1 - dt * 6);
      this.speed = s;
      this.rearSpin = 40;
      const [ofx, ofz] = this.forward();
      const frontX = this.x + ofx * this.halfLen * 0.6;
      const frontZ = this.z + ofz * this.halfLen * 0.6;
      this.heading = wrapAngle(this.heading - steer * 1.6 * dt);
      const [nfx, nfz] = this.forward();
      this.x = frontX - nfx * this.halfLen * 0.6;
      this.z = frontZ - nfz * this.halfLen * 0.6;
      this.lat = 0;
      this.steerVis = lerp(this.steerVis, clamp(steer, -1, 1) * 0.6, Math.min(1, dt * 8));
      this.collide(boxes);
      return;
    }
    this.rearSpin = Math.max(0, this.rearSpin - dt * 30);
    if (flats) {
      // Pull toward the flat side, with a wobble at speed.
      let pull = 0;
      for (const w of this.wheels) if (w.userData.flat) pull += (w.userData.front ? 0.07 : 0.035) * (w.userData.left ? -1 : 1);
      const spd = Math.min(1, Math.abs(s) / 20);
      steer += pull * spd + Math.sin(performance.now() / 90) * 0.035 * flats * spd;
    }
    // Your car, once it's moving: GTA-style tire physics (see dynamics()). Parked cars, AI
    // cars and low speeds use the simple model below.
    const player = this.driver === 'player';
    if (player && s0 > 3.5 && !this.wrecked) {
      this.dynamics(dt, ctrl, steer, s0, maxS, accel);
      this.collide(boxes);
      return;
    }
    this.driftAmt = 0;
    this.steerVis = lerp(this.steerVis, clamp(steer, -1, 1) * steerMax, Math.min(1, dt * 8));
    const yaw = (s / 2.7) * Math.tan(this.steerVis);
    this.r = yaw; // remembered so the switch to the tire model is seamless
    this.heading = wrapAngle(this.heading - yaw * dt);
    this.lat *= Math.exp(-dt * 12); // any leftover slide settles quickly
    const [fx, fz] = this.forward();
    const rx = -fz, rz = fx;
    this.x += (fx * s + rx * this.lat) * dt;
    this.z += (fz * s + rz * this.lat) * dt;
    this.speed = s;
    this.drift = Math.abs(this.lat);
    this.collide(boxes);
  }

  // Driving model, after GTA V's handling data. Each axle's sideways grip follows a traction
  // curve: grip builds with slip angle up to a peak (fTractionCurveMax) at around 9 degrees,
  // then eases down to a slightly lower sliding grip (fTractionCurveMin) — so cars feel planted,
  // then slide progressively instead of snapping. Braking and accelerating shift weight
  // between the axles, each tire shares its grip between braking/driving and cornering
  // (friction circle), steering lock shrinks with speed, and some angular damping keeps it
  // stable. Drift: hold gas + brake while turning — weight goes forward and the rear tires
  // spin, so the rear loses grip and steps out. Counter-steer and the stick hold the angle.
  // Let go and grip returns smoothly over a fraction of a second.
  dynamics(dt, ctrl, steerIn, s0, maxS, accel) {
    const t = this.type;
    const H = HANDLING[this.typeName] || HANDLING.sedan;
    const m = 1400, Iz = 2300, a = 1.25, b = 1.45, L = a + b, hcg = 0.5, g = 9.81;
    if (this.vx === undefined || Math.abs(this.vx - s0) > 0.5 || !this.dyn) {
      // Coming in from the simple model (or after a collision changed our speed).
      this.vx = s0;
      this.vy = this.lat || 0;
      // Start from a turn rate the tires can actually hold at this speed.
      const rMaxNow = (H.max * g) / Math.max(s0, 1);
      this.r = clamp(this.r || 0, -rMaxNow, rMaxNow);
    }
    this.dyn = true;
    const steer = clamp(steerIn, -1, 1);
    const thr = ctrl.throttle || 0;
    const driftWanted = ctrl.gas && ctrl.brake && Math.abs(steer) > 0.15 && this.vx > 8;
    // Smooth in and out of the drift (no snapping).
    this.driftAmt = lerp(this.driftAmt || 0, driftWanted ? 1 : 0, Math.min(1, dt * (driftWanted ? 5 : 3.5)));
    const drift = this.driftAmt;
    // Steering: ~39 degrees parked, less at speed; more lock available while drifting.
    const lock = lerp(0.72 / (1 + this.vx * 0.032), 0.6, drift);
    this.steerVis = lerp(this.steerVis, steer * lock, Math.min(1, dt * 9));
    const delta = this.steerVis;
    // Pedals.
    const gasAmt = driftWanted ? 1 : Math.max(0, thr);
    const brakeAmt = driftWanted ? 0.08 : Math.max(0, -thr);
    const hb = ctrl.handbrake ? 1 : 0;
    const frontFlats = this.wheels.filter((w) => w.userData.flat && w.userData.front).length;
    const rearFlats = this.wheels.filter((w) => w.userData.flat && !w.userData.front).length;
    const muF = H.max * (H.bias + 0.5) * (1 - 0.25 * frontFlats);
    const muR = H.max * (1.5 - H.bias) * (1 - 0.25 * rearFlats) * (1 - 0.35 * drift);
    const curve = (al, mu) => {
      // Grip (as a friction coefficient) for a slip angle: builds to the peak, then eases to
      // the sliding level.
      const x = Math.abs(al);
      const pk = H.peak;
      if (x < pk) return mu * Math.sin((x / pk) * Math.PI / 2);
      const k = Math.min(1, (x - pk) / (pk * 1.6));
      return mu * (1 - (1 - H.slide) * k);
    };
    const n = 4;
    const ddt = dt / n;
    let ax = this.ax || 0;
    for (let i = 0; i < n; i++) {
      const vx = Math.max(this.vx, 0.5);
      const transfer = clamp((m * -ax * hcg) / L, -3500, 3500);
      const Fzf = (m * g * b) / L + transfer;
      const Fzr = (m * g * a) / L - transfer;
      // Front: brakes, then whatever grip is left corners.
      const fMax = muF * Fzf;
      const brakeDecel = Math.min(this.brakePow(), 12.5 * (1 + 0.15 * (this.mods ? this.mods.brakes : 0))); // ~1.3 g at most, like real brakes on sticky tires
      const Fxf = Math.max(-fMax * 0.95, -brakeAmt * m * brakeDecel * 0.6);
      const fyf = Math.sqrt(Math.max(0, fMax * fMax - Fxf * Fxf));
      const af = Math.atan2(this.vy + a * this.r, vx) - delta;
      const Fyf = clamp(-Math.sign(af) * curve(af, muF) * Fzf, -fyf, fyf);
      // Rear: drive (rear-wheel drive), brakes, handbrake.
      const rMax = muR * Fzr;
      // Traction control keeps drive force within what the rears can take while cornering;
      // in a drift you're deliberately spinning them.
      const tc = rMax * (driftWanted ? 0.7 : 0.55 + 0.35 * (1 - Math.abs(steer)));
      let Fxr = Math.min(gasAmt * m * accel * Math.max(0, 1 - this.vx / maxS), tc) - brakeAmt * m * Math.min(this.brakePow(), 12.5 * (1 + 0.15 * (this.mods ? this.mods.brakes : 0))) * 0.4 - hb * 0.3 * rMax; // handbrake: slows the rear, no slide
      Fxr = clamp(Fxr, -rMax, rMax);
      const fyr = Math.sqrt(Math.max(0, rMax * rMax - Fxr * Fxr));
      const ar = Math.atan2(this.vy - b * this.r, vx);
      const Fyr = clamp(-Math.sign(ar) * curve(ar, muR) * Fzr, -fyr, fyr);
      // Rolling resistance and drag; engine braking when coasting.
      const coast = gasAmt === 0 && brakeAmt === 0 ? m * 2.0 : 0;
      const drag = m * 0.08 * this.vx + coast + (this.flatCount ? m * 0.25 * this.flatCount * this.vx * 0.1 : 0);
      // Throttle holding the slide: drifting on the gas keeps most of your speed.
      const driftPush = drift * m * 9 * Math.max(0, 1 - this.vx / (maxS * 0.75));
      const Fx = Fxr + Fxf * Math.cos(delta) - Fyf * Math.sin(delta) - drag + driftPush;
      const Fy = Fyr + Fyf * Math.cos(delta) + Fxf * Math.sin(delta);
      ax = Fx / m;
      this.vx += (ax + this.vy * this.r) * ddt;
      this.vy += (Fy / m - this.vx * this.r) * ddt;
      this.r += ((a * (Fyf * Math.cos(delta) + Fxf * Math.sin(delta)) - b * Fyr) / Iz) * ddt;
      // Drift assist (like arcade racers): the stick sets the drift angle. The car's turn rate
      // is steered toward the rate its path is bending, plus a correction toward that angle,
      // so the slide holds steady instead of spinning out.
      if (drift > 0.05) {
        const target = -Math.sign(steer) * Math.abs(steer) * 0.6;
        const beta = Math.atan2(this.vy, vx);
        const V = Math.max(Math.hypot(this.vx, this.vy), 1);
        const pathRate = Fy / m / V; // how fast the direction of travel is turning
        const want = pathRate - (target - beta) * 3;
        this.r += (want - this.r) * (1 - Math.exp(-ddt * 9 * drift));
      }
      // Angular damping, and sideways creep dies out at walking pace.
      this.r *= Math.exp(-ddt * (0.6 + 1.0 * (1 - drift) * Math.min(1, this.vx / 20))); // stability at speed (less while drifting)
      if (this.vx < 6) this.vy *= Math.exp(-ddt * (6 - this.vx) * 1.5);
      this.heading = wrapAngle(this.heading - this.r * ddt);
      const [fx, fz] = this.forward();
      const rx = -fz, rz = fx;
      this.x += (fx * this.vx + rx * this.vy) * ddt;
      this.z += (fz * this.vx + rz * this.vy) * ddt;
    }
    this.ax = ax;
    this.speed = this.vx;
    this.lat = this.vy;
    this.drift = Math.abs(this.vy);
    this.grip = 1 - 0.42 * drift;
    this.drifting = drift > 0.3;
    this.rearSpin = driftWanted ? this.vx + 8 : 0;
    if (this.vx <= 3.5) this.dyn = false;
  }

  collide(boxes) {
    const [fx, fz] = this.forward();

    // Building collisions, using two circles along the car.
    let px = 0, pz = 0, nx = 0, nz = 0, hit = false;
    for (const [cx, cz] of this.circles()) {
      const r = pushCircle(cx, cz, this.radius, boxes);
      if (r.hit) {
        px += r.x - cx;
        pz += r.z - cz;
        nx += r.nx;
        nz += r.nz;
        hit = true;
      }
    }
    if (hit) {
      this.x += px;
      this.z += pz;
      this.lat *= 0.3;
      const nl = Math.hypot(nx, nz) || 1;
      const vn = ((fx * nx + fz * nz) / nl) * this.speed;
      if (vn < -1) {
        this.crash = Math.max(this.crash, -vn);
        this.speed *= 0.35;
        if (-vn > 12) this.damage((-vn - 12) * 2.5, false);
      }
    }
  }

  sync(dt) {
    // Ride up onto curbs and sidewalks instead of sinking into them.
    const gy = this.groundY || 0;
    this.y = this.y === undefined ? gy : this.y + (gy - this.y) * Math.min(1, dt * 18);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    for (const w of this.wheels) {
      const spin = !w.userData.front && this.rearSpin > 0 ? this.rearSpin : this.speed;
      if (!w.userData.flat) w.rotation.x += (spin * dt) / 0.38;
      else w.rotation.x = 0; // a flat tire is squashed at the bottom, not spinning
      if (w.userData.front) w.rotation.y = -this.steerVis; // positive steer is a right turn
    }
    if (this.doors) {
      for (const d of Object.values(this.doors)) {
        if (d.closeT > 0) {
          d.closeT -= dt;
          if (d.closeT <= 0) d.target = 0;
        }
        d.angle += (d.target - d.angle) * Math.min(1, dt * 6);
        d.pivot.rotation.y = d.angle;
      }
    }
    if (this.lightR) {
      this.sirenT += dt;
      const on = this.siren && Math.floor(this.sirenT * 6) % 2 === 0;
      this.lightR.color.setHex(this.siren ? (on ? 0xff2020 : 0x550000) : 0x550000);
      this.lightB.color.setHex(this.siren ? (on ? 0x000055 : 0x2050ff) : 0x000055);
    }
    this.crash = Math.max(0, this.crash - dt * 20);
  }

  dispose() {
    this.scene.remove(this.group);
    this.removed = true;
  }
}

// Push overlapping cars apart.
export function resolveCarCollisions(cars, onHit) {
  for (let a = 0; a < cars.length; a++) {
    const A = cars[a];
    for (let b = a + 1; b < cars.length; b++) {
      const Bc = cars[b];
      const dx = Bc.x - A.x;
      const dz = Bc.z - A.z;
      if (dx * dx + dz * dz > 64) continue;
      for (const [ax, az] of A.circles()) {
        for (const [bx, bz] of Bc.circles()) {
          const ddx = bx - ax;
          const ddz = bz - az;
          const d = Math.hypot(ddx, ddz);
          const min = A.radius + Bc.radius;
          if (d >= min || d < 1e-6) continue;
          // Measure the impact before anything slows down.
          const rel = Math.abs(A.speed - Bc.speed);
          // Parked roadblock cars are heavy: whatever hits them does most of the moving.
          const wa = A.heavy && !Bc.heavy ? 0.1 : Bc.heavy && !A.heavy ? 0.9 : 0.5;
          const ux = ddx / d;
          const uz = ddz / d;
          A.x -= ux * (min - d) * wa;
          A.z -= uz * (min - d) * wa;
          Bc.x += ux * (min - d) * (1 - wa);
          Bc.z += uz * (min - d) * (1 - wa);
          if (A.heavy !== Bc.heavy) {
            const mover = A.heavy ? Bc : A;
            mover.speed *= 0.6;
          }
          if (rel > 3 && onHit) onHit(A, Bc, rel);
          // Crash damage. Bumps between computer-driven cars are gentler so they don't
          // wreck each other on their own.
          const involvesPlayer = A.driver === 'player' || Bc.driver === 'player';
          const limit = involvesPlayer ? 10 : 16;
          if (rel > limit) {
            const dmg = (rel - limit) * (A.heavy || Bc.heavy ? 2.5 : involvesPlayer ? 1.5 : 0.8);
            A.damage(dmg, Bc.driver === 'player');
            Bc.damage(dmg, A.driver === 'player');
          }
          A.speed *= 0.92;
          Bc.speed *= 0.92;
        }
      }
    }
  }
}
