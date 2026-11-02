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
    // Burning cars: a few flickering lights, handed to the fires nearest you (main.js).
    this.fireLights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xff7a2a, 0, 16, 1.6);
      scene.add(l);
      return l;
    });
    this.debris = []; // (pieces thrown by an explosion: falling, bouncing, settling)
    this.rings = []; // (shockwaves)
    this.scorches = []; // (burn marks on the ground)
    // Skid marks: a ring buffer of dark strips on the road.
    const geo = new THREE.PlaneGeometry(0.28, 0.5);
    geo.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false }), 600);
    this.skids.count = 0;
    this.skidN = 0;
    this.skidObj = new THREE.Object3D();
    this.skids.frustumCulled = false;
    scene.add(this.skids);
  }

  skid(x, z, heading) {
    const o = this.skidObj;
    o.position.set(x, 0.03, z);
    o.rotation.set(0, heading, 0);
    o.updateMatrix();
    this.skids.setMatrixAt(this.skidN % 600, o.matrix);
    this.skidN++;
    this.skids.count = Math.min(600, this.skidN);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  tireSmoke(x, z, amount = 1) {
    this.sprite(x + (Math.random() - 0.5) * 0.5, 0.35, z + (Math.random() - 0.5) * 0.5, {
      color: 0xdedede, size: 0.9 + amount * 0.6, life: 1.6 + amount, grow: 2.6, opacity: 0.45, vy: 0.6,
      vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2,
    });
  }

  sprite(x, y, z, { color = 0xffffff, size = 0.5, life = 0.3, vx = 0, vy = 0, vz = 0, grow = 0, additive = false, opacity = 1 }) {
    const pool = additive ? this.pools.add : this.pools.norm;
    let s = pool.find((p) => !p.userData.active);
    if (!s) {
      if (pool.length > 420) return;
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

  // A car fire's flame: bigger and fuller than a lick of fire, rising and thinning out.
  flame(x, y, z, scale = 1) {
    this.sprite(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, {
      color: Math.random() < 0.35 ? 0xffd060 : Math.random() < 0.6 ? 0xff8a1a : 0xff5510,
      size: (1.1 + Math.random() * 0.8) * scale, life: 0.55 + Math.random() * 0.35, grow: -0.7 * scale, additive: true,
      vy: 2.2 + Math.random() * 1.6, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6,
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

  // ---- Explosions ----
  // A car going up: a white flash, a fireball that swells and rolls up, turning to a black
  // mushroom of smoke; sparks and burning bits thrown out; a shockwave along the ground.
  fireball(x, y, z, scale = 1) {
    this.sprite(x, y + 0.8, z, { color: 0xfff6d8, size: 3.5 * scale, life: 0.16, grow: 6 * scale, additive: true });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const sp = (2 + r * 6) * scale;
      this.sprite(x + Math.cos(a) * r, y + 0.6 + Math.random() * 1.2, z + Math.sin(a) * r, {
        color: i % 4 === 0 ? 0xffe9a0 : i % 2 ? 0xff8a1a : 0xff5a0a,
        size: (1.4 + Math.random() * 1.4) * scale, life: 0.6 + Math.random() * 0.5, grow: 3.4 * scale, additive: true,
        vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 5, vz: Math.sin(a) * sp,
      });
    }
    // (the smoke: a column that rolls up and spreads at the top)
    for (let i = 0; i < 22; i++) {
      const up = Math.random();
      this.sprite(x + (Math.random() - 0.5) * 2, y + 1 + up * 3, z + (Math.random() - 0.5) * 2, {
        color: i % 3 ? 0x1a1a1a : 0x3a3530, size: (2 + Math.random() * 1.5) * scale, life: 3 + Math.random() * 2.5, grow: 5 * scale, opacity: 0.7,
        vx: (Math.random() - 0.5) * 2.2, vy: 2 + up * 4, vz: (Math.random() - 0.5) * 2.2,
      });
    }
    // (sparks and burning bits)
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 12;
      this.sprite(x, y + 1, z, { color: Math.random() < 0.5 ? 0xffd070 : 0xff7020, size: 0.14, life: 0.6 + Math.random() * 0.9, additive: true, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 9, vz: Math.sin(a) * sp });
    }
    this.light.position.set(x, y + 3, z);
    this.light.intensity = 90 * scale;
  }

  shockwave(x, y, z, r = 9) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.08, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, life: 0.45, r });
  }

  // A burn mark on the ground (the last dozen stay).
  scorch(x, y, z, r = 3.2) {
    if (!this.scorchTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(8,6,5,.92)');
      grad.addColorStop(0.55, 'rgba(15,12,10,.7)');
      grad.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`;
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 30;
        g.beginPath();
        g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 8, 0, Math.PI * 2);
        g.fill();
      }
      this.scorchTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.set(x, y + 0.04, z);
    m.renderOrder = 1;
    this.scene.add(m);
    this.scorches.push(m);
    if (this.scorches.length > 12) {
      const o = this.scorches.shift();
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }

  // A piece thrown out: flies, tumbles, bounces off the ground and settles; gone after a while.
  // ground(x, z) -> the ground's height there.
  throwPiece(obj, vel, spin, ground, size = 0.3, life = 45) {
    this.scene.add(obj);
    this.debris.push({ obj, vel, spin, ground, size, life, rest: false, burn: 2 + Math.random() * 4 });
    if (this.debris.length > 40) {
      const o = this.debris.shift();
      this.scene.remove(o.obj);
    }
  }

  update(dt) {
    // (thrown pieces)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
        continue;
      }
      if (d.burn > 0) {
        d.burn -= dt;
        if (Math.random() < dt * 14) this.sprite(d.obj.position.x, d.obj.position.y + 0.2, d.obj.position.z, { color: Math.random() < 0.5 ? 0xff7a1a : 0xffb040, size: 0.45, life: 0.4, grow: -0.3, additive: true, vy: 1.6 });
        if (Math.random() < dt * 5) this.sprite(d.obj.position.x, d.obj.position.y + 0.4, d.obj.position.z, { color: 0x222222, size: 0.5, life: 1.5, grow: 1.4, opacity: 0.5, vy: 1.2 });
      }
      if (d.rest) continue;
      const o = d.obj;
      d.vel.y -= 9.8 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt;
      o.rotation.y += d.spin.y * dt;
      o.rotation.z += d.spin.z * dt;
      const gy = d.ground(o.position.x, o.position.z) + d.size;
      if (o.position.y < gy) {
        o.position.y = gy;
        if (Math.abs(d.vel.y) < 1.2 && Math.hypot(d.vel.x, d.vel.z) < 0.6) {
          d.rest = true;
          // (settled: lying flat-ish)
          o.rotation.x = Math.round(o.rotation.x / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.2;
          o.rotation.z = Math.round(o.rotation.z / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.2;
          continue;
        }
        d.vel.y = -d.vel.y * 0.35;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.55);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.geometry.dispose();
        r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.m.scale.setScalar(1 + k * r.r);
      r.m.material.opacity = 0.55 * (1 - k);
    }
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
