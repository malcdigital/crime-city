import * as THREE from 'three';

// Heat check and on fire (streetball.js): smoke coming off the ball on a heat check, an NBA
// Jam fire trail when you're on fire, and a small explosion at the rim when it goes through.
// One pool of camera-facing sprites, each with a life, a drift and a size curve.

function puffTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, inner);
  r.addColorStop(0.45, outer);
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX = 160;

export class HeatFx {
  constructor(scene) {
    this.scene = scene;
    this.smokeTex = puffTexture('rgba(220,220,220,0.85)', 'rgba(150,150,150,0.35)');
    this.fireTex = puffTexture('rgba(255,250,200,1)', 'rgba(255,120,20,0.7)');
    this.parts = [];
    this.acc = 0;
  }

  spawn(kind, x, y, z, o = {}) {
    let p = this.parts.find((q) => !q.alive);
    if (!p) {
      if (this.parts.length >= MAX) return;
      const mat = new THREE.SpriteMaterial({ depthWrite: false, transparent: true });
      p = { s: new THREE.Sprite(mat) };
      p.s.renderOrder = 5;
      this.scene.add(p.s);
      this.parts.push(p);
    }
    const fire = kind !== 'smoke';
    const m = p.s.material;
    m.map = fire ? this.fireTex : this.smokeTex;
    m.blending = fire ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.color.setHex(o.color ?? 0xffffff);
    m.needsUpdate = true;
    Object.assign(p, {
      alive: true, kind, t: 0, T: o.T ?? 0.6, x, y, z,
      vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, s0: o.s0 ?? 0.3, s1: o.s1 ?? 0.6, a0: o.a0 ?? 0.8,
    });
    p.s.visible = true;
    p.s.position.set(x, y, z);
  }

  // Smoke drifting up off the ball (call every frame while it's a heat check).
  smoke(x, y, z, dt) {
    this.acc += dt * 44;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.spawn('smoke', x + (Math.random() - 0.5) * 0.15, y + 0.05, z + (Math.random() - 0.5) * 0.15, {
        T: 0.9 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3,
        s0: 0.22, s1: 0.95, a0: 0.85, color: 0x8f8f8f,
      });
    }
  }

  // Flames off the ball; flying, a thick trail left behind it (call every frame while on fire).
  fire(x, y, z, dt, flying) {
    this.acc += dt * (flying ? 70 : 34);
    while (this.acc >= 1) {
      this.acc -= 1;
      const hot = Math.random() < 0.35;
      this.spawn('fire', x + (Math.random() - 0.5) * 0.14, y + (Math.random() - 0.5) * 0.1, z + (Math.random() - 0.5) * 0.14, {
        T: (flying ? 0.45 : 0.35) + Math.random() * 0.2, vx: (Math.random() - 0.5) * 0.4, vy: 0.9 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4,
        s0: hot ? 0.34 : 0.42, s1: 0.06, a0: 0.95, color: hot ? 0xffe27a : 0xff7a1a,
      });
    }
  }

  // The rim blows up: a flash, a ring of fire out from it, sparks, a little smoke.
  explode(x, y, z) {
    this.spawn('fire', x, y, z, { T: 0.32, s0: 0.8, s1: 3.6, a0: 1, color: 0xfff1b0 });
    this.spawn('fire', x, y, z, { T: 0.5, s0: 0.5, s1: 2.4, a0: 0.9, color: 0xff7a1a });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const sp = 4 + Math.random() * 4;
      this.spawn('fire', x, y, z, {
        T: 0.45 + Math.random() * 0.3, vx: Math.cos(a) * sp, vy: (Math.random() - 0.3) * 3, vz: Math.sin(a) * sp,
        s0: 0.5, s1: 0.06, a0: 1, color: i % 3 ? 0xff7a1a : 0xffd23f,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.spawn('smoke', x, y, z, {
        T: 1.1 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 1.6, vy: 0.5 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.6,
        s0: 0.4, s1: 1.3, a0: 0.5, color: 0x777777,
      });
    }
  }

  update(dt) {
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.t += dt;
      if (p.t >= p.T) {
        p.alive = false;
        p.s.visible = false;
        continue;
      }
      const k = p.t / p.T;
      const drag = p.kind === 'smoke' ? 0.98 : 0.93;
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.s.position.set(p.x, p.y, p.z);
      const sz = p.s0 + (p.s1 - p.s0) * k;
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = p.a0 * (p.kind === 'smoke' ? Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.1)) * (1 - k) : 1 - k * k);
    }
  }

  clear() {
    for (const p of this.parts) {
      p.alive = false;
      p.s.visible = false;
    }
  }
}
