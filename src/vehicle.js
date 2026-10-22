import * as THREE from 'three';
import { lam } from './character.js';
import { pushCircle } from './collision.js';
import { clamp, lerp, wrapAngle } from './util.js';

export const VTYPES = {
  sedan: { w: 2.0, l: 4.4, h: 0.95, cab: [1.8, 0.7, 2.2, -0.2], max: 30, accel: 9, brake: 20, rev: 8, value: 900, label: 'Sedan',
    colors: [0x2a4d8f, 0x8f2a2a, 0xd0d0d0, 0x333333, 0x2f6b4f, 0xc9a227, 0x7a7a7a] },
  sports: { w: 2.0, l: 4.3, h: 0.75, cab: [1.7, 0.55, 1.8, -0.35], max: 44, accel: 14, brake: 24, rev: 8, value: 2500, label: 'Sports car',
    colors: [0xd61f1f, 0xf2c40f, 0x111111, 0x1f6fd6] },
  van: { w: 2.2, l: 5.0, h: 1.9, cab: null, max: 24, accel: 7, brake: 16, rev: 7, value: 700, label: 'Van',
    colors: [0xffffff, 0x5d6d7e, 0xa04000] },
  police: { w: 2.0, l: 4.6, h: 0.95, cab: [1.8, 0.7, 2.2, -0.2], max: 40, accel: 13, brake: 24, rev: 9, value: 1500, label: 'Police cruiser',
    colors: [0x151515] },
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
        g.add(w);
        this.wheels.push(w);
      }
    }
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
  damage(amount, byPlayer) {
    if (this.wrecked) return;
    this.health -= amount;
    if (byPlayer) this.byPlayer = true;
    if (this.health <= 0) {
      this.health = 0;
      this.wrecked = true;
      this.burnT = 4;
    }
  }

  burnOut() {
    this.exploded = true;
    this.siren = false;
    const burnt = lam(0x1c1c1c);
    this.group.traverse((m) => {
      if (m.isMesh) m.material = burnt;
    });
  }

  update(dt, ctrl, boxes) {
    if (this.wrecked) ctrl = { throttle: 0, steer: 0, handbrake: true };
    const t = this.type;
    let s = this.speed;
    const thr = ctrl.throttle || 0;
    if (thr > 0) {
      if (s < -0.5) s += t.brake * dt * thr;
      else s += t.accel * thr * dt * Math.max(0, 1 - s / t.max);
    } else if (thr < 0) {
      if (s > 0.5) s -= t.brake * dt * -thr;
      else s = Math.max(-t.rev, s - t.accel * 0.6 * dt * -thr);
    } else {
      s -= Math.sign(s) * Math.min(Math.abs(s), 2.5 * dt);
    }
    s -= s * 0.08 * dt;
    if (ctrl.handbrake) s -= s * 2.2 * dt;

    const steerMax = 0.6 / (1 + Math.abs(s) * 0.045);
    this.steerVis = lerp(this.steerVis, clamp(ctrl.steer || 0, -1, 1) * steerMax, Math.min(1, dt * 8));
    this.heading = wrapAngle(this.heading - (s / 2.7) * Math.tan(this.steerVis) * dt);
    const [fx, fz] = this.forward();
    this.x += fx * s * dt;
    this.z += fz * s * dt;
    this.speed = s;

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
      const nl = Math.hypot(nx, nz) || 1;
      const vn = ((fx * nx + fz * nz) / nl) * this.speed;
      if (vn < -1) {
        this.crash = Math.max(this.crash, -vn);
        this.speed *= 0.35;
        if (-vn > 9) this.damage((-vn - 9) * 2.5, this.driver === 'player');
      }
    }
  }

  sync(dt) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    for (const w of this.wheels) {
      w.rotation.x += (this.speed * dt) / 0.38;
      if (w.userData.front) w.rotation.y = this.steerVis;
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
          const push = (min - d) / 2;
          const ux = ddx / d;
          const uz = ddz / d;
          A.x -= ux * push;
          A.z -= uz * push;
          Bc.x += ux * push;
          Bc.z += uz * push;
          const rel = Math.abs(A.speed - Bc.speed);
          if (rel > 3 && onHit) onHit(A, Bc, rel);
          if (rel > 10) {
            A.damage((rel - 10) * 1.5, Bc.driver === 'player');
            Bc.damage((rel - 10) * 1.5, A.driver === 'player');
          }
          A.speed *= 0.92;
          Bc.speed *= 0.92;
        }
      }
    }
  }
}
