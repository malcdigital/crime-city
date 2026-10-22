import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Pooled visual effects: tracers, muzzle flashes, impacts, smoke, fire, explosions.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tex = dotTexture();
    this.pools = { add: [], norm: [] };
    this.lines = [];
    this.light = new THREE.PointLight(0xffa040, 0, 40, 1.5);
    scene.add(this.light);
  }

  sprite(x, y, z, { color = 0xffffff, size = 0.5, life = 0.3, vx = 0, vy = 0, vz = 0, grow = 0, additive = false, opacity = 1 }) {
    const pool = additive ? this.pools.add : this.pools.norm;
    let s = pool.find((p) => !p.userData.active);
    if (!s) {
      if (pool.length > 220) return;
      const m = new THREE.SpriteMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      s = new THREE.Sprite(m);
      this.scene.add(s);
      pool.push(s);
    }
    s.material.color.setHex(color);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.visible = true;
    s.userData = { active: true, life, max: life, vx, vy, vz, grow, size, opacity };
    s.material.opacity = opacity;
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffe9a0) {
    let l = this.lines.find((p) => !p.userData.active);
    if (!l) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
      l.frustumCulled = false;
      this.scene.add(l);
      this.lines.push(l);
    }
    const p = l.geometry.attributes.position;
    p.setXYZ(0, ax, ay, az);
    p.setXYZ(1, bx, by, bz);
    p.needsUpdate = true;
    l.material.color.setHex(color);
    l.material.opacity = 0.9;
    l.visible = true;
    l.userData = { active: true, life: 0.06, max: 0.06 };
  }

  muzzle(x, y, z) {
    this.sprite(x, y, z, { color: 0xffd060, size: 0.7, life: 0.05, additive: true });
  }

  impact(x, y, z) {
    for (let i = 0; i < 4; i++) {
      this.sprite(x, y, z, {
        color: 0xffc070, size: 0.12, life: 0.22, additive: true,
        vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6,
      });
    }
    this.sprite(x, y, z, { color: 0x9a9080, size: 0.35, life: 0.4, grow: 0.6, opacity: 0.6, vy: 0.5 });
  }

  hitPuff(x, y, z) {
    this.sprite(x, y, z, { color: 0x7a1f1f, size: 0.45, life: 0.3, grow: 0.3, opacity: 0.8 });
  }

  smoke(x, y, z, dark = false) {
    this.sprite(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, {
      color: dark ? 0x222222 : 0x777777, size: 0.8, life: 1.8, grow: 2.2, opacity: 0.55, vy: 1.4,
      vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4,
    });
  }

  fire(x, y, z) {
    this.sprite(x + (Math.random() - 0.5) * 1.2, y, z + (Math.random() - 0.5) * 1.6, {
      color: Math.random() < 0.5 ? 0xff7a1a : 0xffc040, size: 0.9, life: 0.5, grow: -0.6, additive: true, vy: 2.5,
    });
  }

  explosion(x, z) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      this.sprite(x, 1 + Math.random(), z, {
        color: i % 3 === 0 ? 0xffe080 : 0xff6a10, size: 1.6, life: 0.5 + Math.random() * 0.4, grow: 2.5, additive: true,
        vx: Math.cos(a) * sp, vy: 2 + Math.random() * 6, vz: Math.sin(a) * sp,
      });
    }
    for (let i = 0; i < 10; i++) this.smoke(x, 1.5 + Math.random() * 2, z, true);
    this.light.position.set(x, 3, z);
    this.light.intensity = 60;
  }

  update(dt) {
    for (const pool of [this.pools.add, this.pools.norm]) {
      for (const s of pool) {
        const u = s.userData;
        if (!u.active) continue;
        u.life -= dt;
        if (u.life <= 0) {
          u.active = false;
          s.visible = false;
          continue;
        }
        s.position.x += u.vx * dt;
        s.position.y += u.vy * dt;
        s.position.z += u.vz * dt;
        const k = 1 - u.life / u.max;
        s.scale.setScalar(Math.max(0.01, u.size + u.grow * k));
        s.material.opacity = u.opacity * (u.life / u.max);
      }
    }
    for (const l of this.lines) {
      const u = l.userData;
      if (!u.active) continue;
      u.life -= dt;
      if (u.life <= 0) {
        u.active = false;
        l.visible = false;
      } else l.material.opacity = 0.9 * (u.life / u.max);
    }
    this.light.intensity = Math.max(0, this.light.intensity - dt * 150);
  }
}
