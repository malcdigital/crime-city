import * as THREE from 'three';
import { carModel } from './carmodels.js';
import { VTYPES } from './vehicle.js';

// Crash damage you can see. Every hit dents the car where it was hit, as hard as it was hit:
// the panels there are pushed in (the body, the bumpers and trim, the doors, the glass), with a
// crumple to it rather than a smooth scoop, deeper the harder the hit and the more times that
// spot's been hit, up to about 40 cm. Harder hits do more:
//   over ~9 m/s   the headlights or taillights at that end smash (dark, they don't light up)
//   over ~11 m/s  the windows round the hit blow out, glass everywhere
//   over ~16 m/s  a wheel by the hit gets bent and leans over
// with paint chips and bits of plastic flying off. Repairs at the garage put it all back.
// Called from vehicle.js (walls, other cars) and streets.js / props.js (signs, hydrants):
// dent(v, x, z, dx, dz, strength): x, z the world point hit, (dx, dz) the way into the car.
// Each car only gets its own copy of its model the first time it's dented (the rest share).

const MAX_DEPTH = 0.48;
const FINE = new WeakMap(); // (model piece -> its finer copy)
const SPLIT = 0.3; // (m: edges longer than this are split on a car's first dent, so the panels can crumple)

// A finer copy of a model piece: every triangle with an edge longer than SPLIT split at the
// middle of its longest edge, again and again (every attribute carried along). The low-poly
// panels have too few points to dent; this gives them enough.
function finer(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const names = Object.keys(g.attributes);
  const src = names.map((n) => ({ n, a: g.attributes[n].array, s: g.attributes[n].itemSize }));
  const out = names.map(() => []);
  const P = g.attributes.position.array;
  const tri = (ia, ib, ic, depth, va, vb, vc) => {
    // (va..vc: the corners, each [ [attr values]... ] per attribute)
    const pa = va[0];
    const pb = vb[0];
    const pc = vc[0];
    const l0 = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const l1 = Math.hypot(pc[0] - pb[0], pc[1] - pb[1], pc[2] - pb[2]);
    const l2 = Math.hypot(pa[0] - pc[0], pa[1] - pc[1], pa[2] - pc[2]);
    const m = Math.max(l0, l1, l2);
    if (m <= SPLIT || depth >= 7) {
      for (const v of [va, vb, vc]) v.forEach((vals, k) => out[k].push(...vals));
      return;
    }
    const mid = (x, y) => x.map((vals, k) => vals.map((q, j) => (q + y[k][j]) / 2));
    if (m === l0) {
      const mm = mid(va, vb);
      tri(0, 0, 0, depth + 1, va, mm, vc);
      tri(0, 0, 0, depth + 1, mm, vb, vc);
    } else if (m === l1) {
      const mm = mid(vb, vc);
      tri(0, 0, 0, depth + 1, va, vb, mm);
      tri(0, 0, 0, depth + 1, va, mm, vc);
    } else {
      const mm = mid(vc, va);
      tri(0, 0, 0, depth + 1, va, vb, mm);
      tri(0, 0, 0, depth + 1, mm, vb, vc);
    }
  };
  const corner = (i) => src.map(({ a, s }) => Array.from(a.slice(i * s, i * s + s)));
  for (let i = 0; i < P.length / 3; i += 3) tri(0, 0, 0, 0, corner(i), corner(i + 1), corner(i + 2));
  const res = new THREE.BufferGeometry();
  src.forEach(({ n, s }, k) => res.setAttribute(n, new THREE.Float32BufferAttribute(out[k], s)));
  res.computeVertexNormals();
  return res;
}
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();

// (the same jitter for the same spot on the model, so the seams where pieces meet move together)
function hash(x, y, z) {
  let h = Math.imul(Math.round(x * 50), 73856093) ^ Math.imul(Math.round(y * 50), 19349663) ^ Math.imul(Math.round(z * 50), 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class CarDamage {
  constructor(game) {
    this.game = game;
    // (the finer copies worked out ahead, a piece at a time when the browser's idle, so a car's
    // first crash doesn't stutter)
    const queue = [];
    for (const t of ['sedan', 'taxi', 'police', 'sports', 'van', 'swat', 'delivery', 'bus']) {
      const M = carModel(t, VTYPES[t]);
      queue.push(M.paint, M.trim);
      if (M.door) for (const sx of [1, -1]) queue.push(M.door.panel[sx], M.door.trim[sx]);
    }
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
    const next = () => {
      const src = queue.shift();
      if (!src) return;
      if (!FINE.has(src)) FINE.set(src, finer(src));
      idle(next);
    };
    setTimeout(() => idle(next), 6000);
  }

  // The car's own copies of its pieces, to dent (once, on its first dent).
  parts(v) {
    if (v.dmg) return v.dmg.parts;
    const parts = [];
    const take = (mesh, glass = false) => {
      if (!mesh?.geometry) return;
      // (the finer copy is worked out once per model piece, then cloned per car)
      if (glass) mesh.geometry = mesh.geometry.clone();
      else {
        const src = mesh.geometry;
        if (!FINE.has(src)) FINE.set(src, finer(src));
        mesh.geometry = FINE.get(src).clone();
      }
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index;
      parts.push({ mesh, glass, orig: Float32Array.from(pos.array), disp: new Float32Array(pos.array.length), origIndex: idx ? idx.array.slice() : null });
    };
    take(v.bodyMesh);
    take(v.trimMesh);
    take(v.glassMesh, true);
    for (const d of Object.values(v.doors || {})) {
      d.pivot.children.forEach((m) => {
        if (m.isMesh) take(m, m.material?.transparent);
      });
    }
    v.dmg = { parts, hits: 0 };
    return parts;
  }

  dent(v, x, z, dx, dz, strength) {
    const game = this.game;
    if (!v || v.removed || v.exploded || !v.bodyMesh || strength < 4) return;
    const [px, pz] = game.player.pos();
    if (Math.hypot(v.x - px, v.z - pz) > 160) return; // (too far off to see)
    const parts = this.parts(v);
    v.dmg.hits++;
    v.group.updateMatrixWorld(true);
    // (at bumper height for a low car, a little higher on a tall one)
    const y = (v.y || 0) + Math.min(0.75, 0.45 + (v.model?.belt || 1) * 0.15);
    const R = Math.min(1.35, 0.55 + strength * 0.035);
    const depth = Math.min(0.36, (strength - 4) * 0.026 + 0.04);
    for (const P of parts) {
      const mesh = P.mesh;
      _m.copy(mesh.matrixWorld).invert();
      const pl = _p.set(x, y, z).applyMatrix4(_m).clone();
      const dl = _d.set(dx, 0, dz).transformDirection(_m).clone();
      const pos = mesh.geometry.attributes.position;
      const a = pos.array;
      const o = P.orig;
      let touched = false;
      for (let i = 0; i < a.length; i += 3) {
        const ex = a[i] - pl.x;
        const ey = (a[i + 1] - pl.y) * 0.7; // (spreads up the panel more than across)
        const ez = a[i + 2] - pl.z;
        const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d >= R) continue;
        const f = (1 - d / R) ** 2;
        const n = hash(o[i], o[i + 1], o[i + 2]) - 0.5; // (crumple)
        const k = depth * f * (0.78 + n * 0.55);
        let qx = P.disp[i] + dl.x * k;
        let qy = P.disp[i + 1] + dl.y * k - Math.abs(n) * depth * f * 0.25; // (and it sags a little)
        let qz = P.disp[i + 2] + dl.z * k;
        const len = Math.hypot(qx, qy, qz);
        if (len > MAX_DEPTH) {
          qx *= MAX_DEPTH / len;
          qy *= MAX_DEPTH / len;
          qz *= MAX_DEPTH / len;
        }
        P.disp[i] = qx;
        P.disp[i + 1] = qy;
        P.disp[i + 2] = qz;
        a[i] = o[i] + qx;
        a[i + 1] = o[i + 1] + qy;
        a[i + 2] = o[i + 2] + qz;
        touched = true;
      }
      // Glass round a hard hit: gone (its triangles there collapse to nothing).
      if (P.glass && strength > 11) {
        const idx = mesh.geometry.index;
        const tris = idx ? idx.count / 3 : a.length / 9;
        const vi = (t, c) => (idx ? idx.array[t * 3 + c] : t * 3 + c);
        for (let t = 0; t < tris; t++) {
          const i0 = vi(t, 0) * 3;
          const i1 = vi(t, 1) * 3;
          const i2 = vi(t, 2) * 3;
          const cx = (a[i0] + a[i1] + a[i2]) / 3;
          const cy = (a[i0 + 1] + a[i1 + 1] + a[i2 + 1]) / 3;
          const cz = (a[i0 + 2] + a[i1 + 2] + a[i2 + 2]) / 3;
          if (Math.hypot(cx - pl.x, (cy - pl.y) * 0.5, cz - pl.z) > R * 1.1) continue;
          if (idx) {
            idx.array[t * 3 + 1] = idx.array[t * 3];
            idx.array[t * 3 + 2] = idx.array[t * 3];
          } else {
            for (const ii of [i1, i2]) {
              a[ii] = a[i0];
              a[ii + 1] = a[i0 + 1];
              a[ii + 2] = a[i0 + 2];
            }
          }
          P.broken = true;
          touched = true;
        }
        if (idx) idx.needsUpdate = true;
      }
      if (touched) {
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
    }
    // Lights at that end, a wheel by it.
    const local = v.group.worldToLocal(_p.set(x, y, z));
    if (strength > 9) {
      for (const m of [...(v.heads || []), ...(v.tails || [])]) {
        if (!m.userData.broken && m.position.distanceTo(local) < R * 0.9) {
          m.userData.broken = true;
          v.headOn = undefined; // (updateLights puts the smashed look on)
          v.tailNow = null;
        }
      }
    }
    if (strength > 16) {
      for (const w of v.wheels || []) {
        if (Math.hypot(w.position.x - local.x, w.position.z - local.z) < 1.45) {
          const lean = Math.min(0.32, (strength - 16) * 0.02 + 0.08) * (w.userData.left ? 1 : -1);
          w.userData.camber = Math.max(-0.32, Math.min(0.32, (w.userData.camber || 0) + lean));
        }
      }
    }
    // Bits flying off.
    const fx = game.effects;
    if (fx) {
      const color = v.bodyMesh.material?.color?.getHex?.() ?? 0x888888;
      const n = Math.min(14, Math.round(strength * 0.5));
      for (let k = 0; k < n; k++) {
        const glass = strength > 11 && k % 3 === 0;
        fx.sprite(x, y + Math.random() * 0.4, z, {
          color: glass ? 0xcfe6f0 : k % 2 ? color : 0x1a1a1a,
          size: glass ? 0.07 : 0.1,
          life: 0.6 + Math.random() * 0.4,
          vx: -dx * (1 + Math.random() * 3) + (Math.random() - 0.5) * 3,
          vy: 1.5 + Math.random() * 2.5,
          vz: -dz * (1 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        });
      }
    }
  }

  // Good as new (the garage's repair).
  repair(v) {
    if (!v?.dmg) return;
    for (const P of v.dmg.parts) {
      const g = P.mesh.geometry;
      g.attributes.position.array.set(P.orig);
      P.disp.fill(0);
      g.attributes.position.needsUpdate = true;
      if (g.index && P.origIndex) {
        g.index.array.set(P.origIndex); // (the glass back in)
        g.index.needsUpdate = true;
      }
      g.computeVertexNormals();
      g.computeBoundingSphere();
      P.broken = false;
    }
    for (const m of [...(v.heads || []), ...(v.tails || [])]) m.userData.broken = false;
    for (const w of v.wheels || []) {
      w.userData.camber = 0;
      w.rotation.z = 0;
    }
    v.headOn = undefined;
    v.tailNow = null;
    v.dmg.hits = 0;
  }
}
