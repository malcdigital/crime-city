import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEALTH_BASE } from './districts.js';
import { mulberry32, dist } from './util.js';
import { inHole } from './fwyplan.js';
import { edgesNear } from './city.js';

// Street props on the sidewalks:
// - Fire hydrants (one per block). Hit one with a car and it breaks off and sprays water for
//   about half a minute.
// - Trash cans near the corners (more in the busy districts) and benches mid-block (Midtown,
//   Downtown, the Heights and around the parks). Cars knock them over; you can't walk
//   through them.
// - Litter on the sidewalks and in the gutters, and graffiti on the walls, in the poorer parts
//   of town (the Projects most, then the Docks, the Strip and Midtown); none in the Heights or
//   the Financial District.
// Knocked-over props are put back once you're well away.
const KINDS = {
  hydrant: { r: 0.3, slow: 0.65, dmg: 4 },
  trash: { r: 0.35, slow: 0.94, dmg: 0 },
  bench: { r: 0.9, slow: 0.85, dmg: 1 },
};
const TAGS = ['KINGS', 'GRN ST', 'SSK', 'RIP DRE', '4LIFE', 'SOUTHSIDE', 'OG', 'TRAP', 'DOCK BOYZ', 'NO SNITCH', 'MONEY', 'LOCO'];
const TAG_COLORS = ['#ff3fa4', '#34e7ff', '#f1c40f', '#2ecc71', '#e74c3c', '#9b59b6', '#ffffff', '#ff8c1a'];

export class Props {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.grid = new Map();
    this.sprays = [];
    this.resetT = 0;
    const rng = mulberry32(777);
    this.rng = rng;
    this.place(rng);
    this.buildMeshes();
    this.litter(rng);
    this.graffiti(rng);
  }

  // ---- Where everything goes ----
  place(rng) {
    const game = this.game;
    const city = game.city;
    const avoid = [];
    for (const s of city.stores) avoid.push([s.x, s.z, 4]);
    for (const a of game.bank?.atms || []) avoid.push([a.x, a.z, 2.5]);
    for (const s of game.transit?.stops || []) avoid.push([s.sx, s.sz, 4.5]);
    // (and clear of the sign, signal and street light poles, and never out in a road)
    for (const q of game.streets?.placedPoles || []) avoid.push([q[0], q[2], 1.6]);
    for (const q of game.streets?.lampPosts || []) avoid.push([q[0], q[2], 1.6]);
    const ok = (x, z) => !avoid.some(([ax, az, r]) => dist(ax, az, x, z) < r) && !inHole(x, z, 2) && city.blockAt(x, z) && !edgesNear(x, z, 0.4).some((e) => e.street?.stub === undefined);
    const add = (kind, x, z, yaw) => {
      if (!ok(x, z)) return;
      const it = { kind, x, z, yaw, x0: x, z0: z, yaw0: yaw, down: false, idx: -1, y0: city.groundY(x, z), ...KINDS[kind] };
      it.idx = this.items.filter((q) => q.kind === kind).length;
      this.items.push(it);
      const key = this.key(x, z);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(it);
    };
    for (const b of city.blocks) {
      if (b.type === 'police' || b.type === 'cityhall' || b.type === 'hospital' || b.type === 'chop') continue;
      if (b.lot || b.type === 'ramps' || b.type === 'place' || b.type === 'plaza') continue;
      // Each side along a street: a point along it (t from its start) at `inset` meters in from
      // the curb, and the yaw that faces the road.
      const sides = b.sides.filter((sd) => sd.cls && sd.len > 16).map((sd) => [(t, inset) => [sd.ax + sd.ux * t - sd.nx * inset, sd.az + sd.uz * t - sd.nz * inset, Math.atan2(sd.nx, sd.nz)], sd.len]);
      if (!sides.length) continue;
      const d = b.district;
      const busy = ['Downtown', 'Financial District', 'Government District', 'The Strip', 'Midtown'].includes(d);
      // One hydrant per block.
      {
        const [s, W] = sides[Math.floor(rng() * sides.length)];
        const t = rng() < 0.5 ? 12 : W - 12;
        add('hydrant', ...s(t, 0.6));
      }
      // Trash cans by the corners.
      for (const [s, W] of sides) {
        if (!busy && rng() > 0.35) continue;
        const t = rng() < 0.5 ? 7 : W - 7;
        add('trash', ...s(t, 0.6));
      }
      // Benches mid-block, facing the street.
      const benches = b.type === 'park' ? 1 : d === 'Midtown' || d === 'Downtown' || d === 'The Heights' ? 0.4 : 0;
      for (const [s, W] of sides) {
        if (rng() > benches || W < 26) continue;
        const t = rng() < 0.5 ? W * 0.43 : W * 0.57;
        add('bench', ...s(t, 0.8));
      }
    }
  }

  key(x, z) {
    return `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
  }

  near(x, z) {
    const out = [];
    const cx = Math.floor(x / 20);
    const cz = Math.floor(z / 20);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const l = this.grid.get(`${i},${j}`);
      if (l) out.push(...l);
    }
    return out;
  }

  // ---- Meshes: one instanced mesh per part ----
  buildMeshes() {
    const parts = {
      hydrant: [
        [new THREE.CylinderGeometry(0.17, 0.2, 0.7, 8), 0xc0392b, 0.35],
        [new THREE.SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xc0392b, 0.7],
        [new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2), 0xd8d8d8, 0.48],
      ],
      trash: [
        [new THREE.CylinderGeometry(0.3, 0.26, 0.95, 10), 0x2d5a3d, 0.475],
        [new THREE.CylinderGeometry(0.33, 0.33, 0.08, 10), 0x1e3d29, 0.97],
      ],
      bench: [
        [new THREE.BoxGeometry(1.8, 0.08, 0.45), 0x8a5a33, 0.45],
        [new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.22, 0.2), 0x8a5a33, 0.5],
        [new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(-0.8, 0, 0), 0x2b2b2b, 0.22],
        [new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(0.8, 0, 0), 0x2b2b2b, 0.22],
      ],
    };
    this.meshes = {};
    for (const [kind, list] of Object.entries(parts)) {
      const n = this.items.filter((i) => i.kind === kind).length;
      this.meshes[kind] = list.map(([geo, color, y]) => {
        geo.translate(0, y, 0);
        const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), Math.max(1, n));
        m.castShadow = kind !== 'trash';
        this.game.scene.add(m);
        return m;
      });
    }
    for (const it of this.items) this.pose(it);
    for (const list of Object.values(this.meshes)) for (const m of list) m.instanceMatrix.needsUpdate = true;
  }

  pose(it) {
    const m4 = this.m4 || (this.m4 = new THREE.Matrix4());
    const e = this.eu || (this.eu = new THREE.Euler());
    const q = this.q || (this.q = new THREE.Quaternion());
    e.set(it.tilt || 0, it.yaw, it.tiltZ || 0, 'YXZ');
    q.setFromEuler(e);
    const s = it.broken ? 0.35 : 1;
    m4.compose(new THREE.Vector3(it.x, (it.y0 ?? 0.2) + (it.lift || 0), it.z), q, new THREE.Vector3(1, s, 1));
    for (const mesh of this.meshes[it.kind]) {
      mesh.setMatrixAt(it.idx, m4);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- Litter: scraps of paper, bags and cans (one instanced mesh) ----
  litter(rng) {
    const city = this.game.city;
    const spots = [];
    for (const b of city.blocks) {
      if (b.lot || b.type === 'ramps' || b.type === 'place') continue;
      const wealth = WEALTH_BASE[b.district] ?? 1;
      const sides = b.sides.filter((sd) => sd.cls && sd.len > 8);
      if (!sides.length) continue;
      const n = Math.round(Math.max(0, 1.12 - wealth) * 70 * Math.min(1.5, b.area / 4000));
      for (let k = 0; k < n; k++) {
        // On the sidewalk or in the gutter just off the curb.
        const sd = sides[Math.floor(rng() * sides.length)];
        const along = 3 + rng() * (sd.len - 6);
        const inset = rng() < 0.45 ? -0.2 - rng() * 1.1 : 0.2 + rng() * 3.6;
        const y = inset > 0 ? 0.205 : 0.015;
        spots.push([sd.ax + sd.ux * along - sd.nx * inset, y, sd.az + sd.uz * along - sd.nz * inset, rng() * Math.PI * 2, rng()]);
      }
    }
    if (!spots.length) return;
    const geo = new THREE.PlaneGeometry(0.5, 0.36);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const colors = [0xe8e4d8, 0xd9d2c0, 0x9c7a4e, 0xb8b8b8, 0x6d8f4e, 0xc0392b, 0x3d6fb3];
    spots.forEach(([x, y, z, yaw, r], k) => {
      const s = 0.6 + r * 0.9;
      mesh.setMatrixAt(k, m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(s, 1, s)));
      mesh.setColorAt(k, col.setHex(colors[Math.floor(r * colors.length)]));
    });
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);
  }

  // ---- Graffiti on the walls facing the street ----
  graffiti(rng) {
    const city = this.game.city;
    const CHANCE = { 'The Projects': 0.7, 'The Docks': 0.5, 'The Strip': 0.35, Midtown: 0.15, Downtown: 0.08 };
    const tags = TAGS.map((t, k) => this.tagTexture(t, TAG_COLORS[k % TAG_COLORS.length], rng));
    const byTex = tags.map(() => []);
    for (const b of city.blocks) {
      const chance = CHANCE[b.district] || 0;
      if (!chance || b.type !== 'normal') continue;
      // The buildings standing on this block: tag the face toward the street.
      for (const o of b.buildings || []) {
        if (!o.w || (o.h || 0) < 3.5 || o.nx === undefined) continue;
        if (rng() > chance) continue;
        const span = o.w;
        if (span < 5) continue;
        const w = Math.min(span - 1, 3.2 + rng() * 2.5);
        const along = (rng() - 0.5) * (span - w - 0.5);
        const yaw = Math.atan2(o.nx, o.nz);
        const ux = Math.cos(o.ang);
        const uz = Math.sin(o.ang);
        const geo = new THREE.PlaneGeometry(w, w * 0.45);
        geo.rotateY(yaw);
        geo.translate(o.cx + o.nx * (o.d / 2 + 0.03) + ux * along, 0.2 + 1.1 + rng() * 0.8, o.cz + o.nz * (o.d / 2 + 0.03) + uz * along);
        byTex[Math.floor(rng() * tags.length)].push(geo);
      }
    }
    byTex.forEach((list, k) => {
      if (!list.length) return;
      const mat = new THREE.MeshLambertMaterial({ map: tags[k], transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.game.scene.add(new THREE.Mesh(mergeGeometries(list), mat));
    });
  }

  tagTexture(text, color, rng) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 116;
    const x = c.getContext('2d');
    x.font = `bold ${text.length > 7 ? 38 : 52}px Impact, 'Arial Black', sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.save();
    x.translate(128, 54);
    x.rotate((rng() - 0.5) * 0.25);
    x.lineWidth = 9;
    x.strokeStyle = '#111';
    x.strokeText(text, 0, 0);
    x.fillStyle = color;
    x.fillText(text, 0, 0);
    x.restore();
    // Drips.
    x.fillStyle = color;
    for (let k = 0; k < 6; k++) {
      const dx = 40 + rng() * 176;
      x.fillRect(dx, 64 + rng() * 10, 3, 12 + rng() * 30);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---- Each frame ----
  update(dt) {
    const game = this.game;
    // Cars knocking things over.
    for (const v of game.vehicles) {
      if (v.removed || v.exploded || v.high || Math.abs(v.speed) < 2.2) continue;
      // Only close to you (that's where it can be seen).
      const [px, pz] = game.player.pos();
      if (Math.abs(v.x - px) > 120 || Math.abs(v.z - pz) > 120) continue;
      for (const it of this.near(v.x, v.z)) {
        if (it.down) continue;
        for (const [cx, cz] of v.circles()) {
          if (dist(cx, cz, it.x, it.z) < v.radius + it.r) {
            this.knock(it, v);
            break;
          }
        }
      }
    }
    // You can't walk through them.
    const p = game.player;
    if (!p.vehicle) {
      for (const it of this.near(p.x, p.z)) {
        if (it.down && it.kind !== 'bench') continue;
        const r = it.r + 0.35;
        const d = dist(p.x, p.z, it.x, it.z);
        if (d < r && d > 1e-4) {
          p.x = it.x + ((p.x - it.x) / d) * r;
          p.z = it.z + ((p.z - it.z) / d) * r;
        }
      }
    }
    this.updateSprays(dt);
    // Put things back once you're well away.
    this.resetT -= dt;
    if (this.resetT <= 0) {
      this.resetT = 5;
      const [px, pz] = game.player.pos();
      for (const it of this.items) {
        if (!it.down || game.time - it.downT < 120 || dist(it.x0, it.z0, px, pz) < 150) continue;
        Object.assign(it, { x: it.x0, z: it.z0, yaw: it.yaw0, tilt: 0, tiltZ: 0, lift: 0, down: false, broken: false });
        this.pose(it);
      }
    }
  }

  knock(it, v) {
    const game = this.game;
    const [fx, fz] = v.forward();
    const s = Math.sign(v.speed) || 1;
    it.down = true;
    it.downT = game.time;
    v.speed *= it.slow;
    if (it.dmg) v.damage(it.dmg * Math.min(3, Math.abs(v.speed) / 8), v.driver === 'player');
    if (v.driver === 'player') v.crash = Math.max(v.crash, 3);
    if (it.kind === 'hydrant') {
      it.broken = true;
      this.spray(it.x, it.z);
    } else if (it.kind === 'trash') {
      // Over it goes, rolling along the way the car was going, and trash everywhere.
      it.x += fx * s * 1.6;
      it.z += fz * s * 1.6;
      it.yaw = Math.atan2(fx * s, fz * s);
      it.tilt = Math.PI / 2;
      it.lift = 0.3;
      for (let k = 0; k < 6; k++) {
        game.effects.sprite(it.x + (Math.random() - 0.5), 0.6, it.z + (Math.random() - 0.5), { color: [0xe8e4d8, 0x9c7a4e, 0x6d8f4e][k % 3], size: 0.25, life: 0.8, vx: fx * s * 3 + (Math.random() - 0.5) * 2, vy: 1.5, vz: fz * s * 3 + (Math.random() - 0.5) * 2 });
      }
    } else {
      it.x += fx * s * 1.2;
      it.z += fz * s * 1.2;
      it.yaw += (Math.random() - 0.5) * 1.4;
      it.tiltZ = (Math.random() < 0.5 ? -1 : 1) * 1.45;
      it.lift = 0.2;
    }
    game.sfx?.thud?.();
    this.pose(it);
  }

  // ---- Water from a broken hydrant ----
  spray(x, z) {
    const N = 140;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.26, transparent: true, opacity: 0.8, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.game.scene.add(pts);
    const s = { x, z, pts, pos, vel, t: 0, life: 32, N, next: 0 };
    for (let k = 0; k < N; k++) this.emit(s, k, Math.random() * 1.6);
    this.sprays.push(s);
    if (this.sprays.length > 5) this.endSpray(this.sprays[0]);
  }

  emit(s, k, age = 0) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.9;
    const vy = 8.5 + Math.random() * 2.5;
    s.vel[k * 3] = Math.cos(a) * r;
    s.vel[k * 3 + 1] = vy - 9.8 * age;
    s.vel[k * 3 + 2] = Math.sin(a) * r;
    s.pos[k * 3] = s.x + s.vel[k * 3] * age;
    s.pos[k * 3 + 1] = 0.6 + vy * age - 4.9 * age * age;
    s.pos[k * 3 + 2] = s.z + s.vel[k * 3 + 2] * age;
  }

  updateSprays(dt) {
    for (const s of this.sprays) {
      s.t += dt;
      const ending = s.t > s.life;
      let alive = 0;
      for (let k = 0; k < s.N; k++) {
        const i = k * 3;
        s.vel[i + 1] -= 9.8 * dt;
        s.pos[i] += s.vel[i] * dt;
        s.pos[i + 1] += s.vel[i + 1] * dt;
        s.pos[i + 2] += s.vel[i + 2] * dt;
        if (s.pos[i + 1] < 0.1) {
          // Splash down, then shoot up again (until the water's turned off).
          if (!ending) this.emit(s, k);
          else s.pos[i + 1] = -10;
        }
        if (s.pos[i + 1] > -5) alive++;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      // A puddle-ish mist at the base.
      if (!ending && Math.random() < dt * 8) this.game.effects.sprite(s.x + (Math.random() - 0.5) * 2, 0.3, s.z + (Math.random() - 0.5) * 2, { color: 0xdfefff, size: 1.2, life: 0.9, grow: 1.5, opacity: 0.35, vy: 0.4 });
      if (ending && !alive) s.done = true;
    }
    for (const s of this.sprays) if (s.done) this.endSpray(s);
  }

  endSpray(s) {
    this.game.scene.remove(s.pts);
    s.pts.geometry.dispose();
    s.pts.material.dispose();
    s.done = true;
    this.sprays = this.sprays.filter((q) => q !== s);
  }
}

