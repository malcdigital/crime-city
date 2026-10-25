import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { lam } from './character.js';
import { signTexture } from './shops.js';
import { setHighwayBoxes } from './vehicle.js';

// Elevated highways: a ring around the city (over the edge roads) and a crosstown highway
// across the middle (over 7th Street), 8 m up, with ten ramps down to the streets. Speed limit
// 65 (45 on the streets). No lights, no stop signs.
// The game is flat underneath (everything moves in x/z), so things on the highway are on a
// "high" layer: a car goes up when it drives onto the bottom of a ramp and comes down at the
// bottom again. Up there it rides at deck height and bumps the guard rails; down below it
// drives under the deck (around the pillars) as if the highway weren't there.
// The highways are part of the road network, so traffic, police and the GPS use them.
const P = CFG.PITCH;
const N = CFG.BLOCKS;
const S = N * P;
const R = CFG.ROAD;
export const DECK_H = 8;
const HW = 8; // half the deck width
const RHW = R / 2; // half a ramp's width
const LINES = [
  { axis: 'x', c: 0, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'x', c: S, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'z', c: 0, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'z', c: S, a0: 0, a1: S, name: 'RING HWY' },
  { axis: 'x', c: 7 * P, a0: 0, a1: S, name: 'CROSSTOWN' },
];
// Ramps: from street corner A (i, j) up to the highway above corner B.
const RAMPS = [[3, 1, 3, 0], [10, 1, 10, 0], [4, 13, 4, 14], [11, 13, 11, 14], [1, 3, 0, 3], [1, 10, 0, 10], [13, 4, 14, 4], [13, 11, 14, 11], [5, 6, 5, 7], [9, 8, 9, 7]];

export class Highway {
  constructor(game) {
    this.game = game;
    const city = game.city;
    this.lines = LINES;
    this.colliders = []; // guard rails (for things on the highway)
    this.nodes = [];
    this.ramps = RAMPS.map(([ai, aj, bi, bj]) => {
      const A = city.nodeAt(ai, aj);
      const B = city.nodeAt(bi, bj);
      const axis = ai !== bi ? 'x' : 'z';
      const c = axis === 'x' ? A.z : A.x;
      const aC = axis === 'x' ? A.x : A.z;
      const bC = axis === 'x' ? B.x : B.z;
      const dir = Math.sign(bC - aC);
      const line = LINES.find((l) => l.axis !== axis && Math.abs(l.c - bC) < 1);
      return { A, B, axis, c, dir, sA: aC + dir * 11, sB: bC - dir * HW, line };
    });
    this.buildGraph();
    this.buildColliders();
    this.buildMeshes();
    setHighwayBoxes(this.colliders);
    // The highways on the radar and the map.
    const draw = city.drawMap;
    city.drawMap = (ctx, px) => {
      draw(ctx, px);
      this.drawMap(ctx, px);
    };
  }

  // ---- Road network: highway nodes, linked to the street corners at the ramp bottoms ----
  buildGraph() {
    const city = this.game.city;
    const make = (x, z) => {
      let n = this.nodes.find((q) => Math.abs(q.x - x) < 1 && Math.abs(q.z - z) < 1);
      if (!n) {
        n = { x, z, nb: [], high: true };
        this.nodes.push(n);
      }
      return n;
    };
    const link = (a, b) => {
      if (!a.nb.includes(b)) a.nb.push(b);
      if (!b.nb.includes(a)) b.nb.push(a);
    };
    // Points along each line: its ends, where other highways meet it, and the ramp tops.
    for (const l of LINES) {
      const at = (a) => (l.axis === 'x' ? make(a, l.c) : make(l.c, a));
      const stops = new Set([l.a0, l.a1]);
      for (const m of LINES) if (m.axis !== l.axis && m.c >= l.a0 && m.c <= l.a1 && l.c >= m.a0 && l.c <= m.a1) stops.add(m.c);
      for (const r of this.ramps) if (r.line === l) stops.add(r.c);
      // Also every few blocks, so cars can turn round and the GPS has places to aim for.
      for (let k = 0; k <= N; k += 3) stops.add(k * P);
      const list = [...stops].sort((a, b) => a - b).map(at);
      l.nodes = list;
      for (let k = 1; k < list.length; k++) link(list[k - 1], list[k]);
    }
    // Ramps replace the street they're on: the street corner links up to the highway.
    for (const r of this.ramps) {
      r.A.nb = r.A.nb.filter((n) => n !== r.B);
      r.B.nb = r.B.nb.filter((n) => n !== r.A);
      // The top of the ramp: on the highway line, right above B.
      const onLine = r.line.axis === 'x' ? make(r.c, r.line.c) : make(r.line.c, r.c);
      link(r.A, onLine);
      r.top = onLine;
    }
    // Drop any stray nodes that didn't get linked.
    this.nodes = this.nodes.filter((n) => n.nb.length);
  }

  // ---- Heights and layers ----
  // Height of the highway surface at a spot (deck or ramp), or null if there's none there.
  heightAt(x, z) {
    for (const l of LINES) {
      const perp = l.axis === 'x' ? z : x;
      const along = l.axis === 'x' ? x : z;
      if (Math.abs(perp - l.c) <= HW && along >= l.a0 - HW && along <= l.a1 + HW) return DECK_H;
    }
    for (const r of this.ramps) {
      const perp = r.axis === 'x' ? z : x;
      if (Math.abs(perp - r.c) > RHW + 0.4) continue;
      const along = r.axis === 'x' ? x : z;
      const t = (along - r.sA) / (r.sB - r.sA);
      if (t >= 0 && t <= 1) return DECK_H * t;
    }
    return null;
  }

  // Up a ramp onto the highway, or back down to the street. o: a vehicle or the player.
  updateLayer(o) {
    const h = this.heightAt(o.x, o.z);
    if (!o.high) {
      if (h !== null && h > 0.02 && h < 0.5) o.high = true;
    } else if (h === null || h <= 0.02) o.high = false;
  }

  groundFor(o) {
    if (o.high) return this.heightAt(o.x, o.z) ?? 0;
    return this.game.city.groundY(o.x, o.z);
  }

  // ---- Solid bits ----
  buildColliders() {
    const city = this.game.city;
    const box = (list, minX, maxX, minZ, maxZ, h) => list.push({ minX, maxX, minZ, maxZ, h });
    const T = 0.35; // rail thickness
    // Guard rails along both edges of each line, with gaps where other highways and ramps join.
    for (const l of LINES) {
      for (const side of [-1, 1]) {
        const gaps = [];
        for (const m of LINES) {
          if (m === l || m.axis === l.axis || m.c < l.a0 - 1 || m.c > l.a1 + 1) continue;
          if (side > 0 ? m.a1 > l.c + HW : m.a0 < l.c - HW) gaps.push([m.c - HW, m.c + HW]);
        }
        for (const r of this.ramps) {
          if (r.line !== l) continue;
          const aSide = Math.sign((r.axis === 'x' ? r.A.x : r.A.z) - l.c);
          if (aSide === side) gaps.push([r.c - RHW - 0.3, r.c + RHW + 0.3]);
        }
        gaps.sort((a, b) => a[0] - b[0]);
        let from = l.a0 - HW;
        const pieces = [];
        for (const [g0, g1] of gaps) {
          if (g0 > from) pieces.push([from, g0]);
          from = Math.max(from, g1);
        }
        if (l.a1 + HW > from) pieces.push([from, l.a1 + HW]);
        const p0 = l.c + side * HW;
        const p1 = p0 + side * T;
        for (const [a, b] of pieces) {
          if (l.axis === 'x') box(this.colliders, a, b, Math.min(p0, p1), Math.max(p0, p1), DECK_H + 1);
          else box(this.colliders, Math.min(p0, p1), Math.max(p0, p1), a, b, DECK_H + 1);
        }
        l.rails = (l.rails || []).concat(pieces.map(([a, b]) => ({ a, b, p: (p0 + p1) / 2, side })));
      }
    }
    // Ramp sides.
    for (const r of this.ramps) {
      const a = Math.min(r.sA, r.sB);
      const b = Math.max(r.sA, r.sB);
      for (const side of [-1, 1]) {
        const p0 = r.c + side * RHW;
        const p1 = p0 + side * T;
        if (r.axis === 'x') box(this.colliders, a, b, Math.min(p0, p1), Math.max(p0, p1), DECK_H);
        else box(this.colliders, Math.min(p0, p1), Math.max(p0, p1), a, b, DECK_H);
      }
      // Down on the street: the solid lower part of the ramp is a wall, and the highway
      // stands on pillars.
      const sAt = (t) => r.sA + (r.sB - r.sA) * t;
      const e0 = sAt(0.11);
      const e1 = sAt(0.4);
      const lo = Math.min(e0, e1);
      const hi = Math.max(e0, e1);
      if (r.axis === 'x') box(city.colliders, lo, hi, r.c - RHW, r.c + RHW, 3);
      else box(city.colliders, r.c - RHW, r.c + RHW, lo, hi, 3);
      r.wall = [lo, hi];
      r.pillars = [];
      for (let t = 0.55; t < 1; t += 0.22) {
        const s = sAt(t);
        r.pillars.push(s);
        if (r.axis === 'x') box(city.colliders, s - 0.6, s + 0.6, r.c - 0.6, r.c + 0.6, DECK_H);
        else box(city.colliders, r.c - 0.6, r.c + 0.6, s - 0.6, s + 0.6, DECK_H);
      }
    }
    // Pillars under the decks, down the middle of the road, clear of the intersections.
    for (const l of LINES) {
      l.pillars = [];
      for (let a = l.a0 + 26; a < l.a1 - 10; a += 26) {
        const k = Math.round(a / P) * P;
        if (Math.abs(a - k) < 14) continue;
        l.pillars.push(a);
        if (l.axis === 'x') box(city.colliders, a - 0.7, a + 0.7, l.c - 0.7, l.c + 0.7, DECK_H);
        else box(city.colliders, l.c - 0.7, l.c + 0.7, a - 0.7, a + 0.7, DECK_H);
      }
    }
  }

  // ---- What you see ----
  buildMeshes() {
    const scene = this.game.scene;
    const parts = { deck: [], top: [], rail: [], pillar: [], yellow: [], white: [] };
    const add = (list, geo, x, y, z, rotX = 0, rotZ = 0) => {
      const g = geo;
      if (rotX) g.rotateX(rotX);
      if (rotZ) g.rotateZ(rotZ);
      g.translate(x, y, z);
      list.push(g);
    };
    const dims = (l, len, w) => (l.axis === 'x' ? [len, w] : [w, len]);
    for (const l of LINES) {
      const len = l.a1 - l.a0 + 2 * HW;
      const mid = (l.a0 + l.a1) / 2;
      const [cx, cz] = l.axis === 'x' ? [mid, l.c] : [l.c, mid];
      let [w, d] = dims(l, len, 2 * HW);
      add(parts.deck, new THREE.BoxGeometry(w, 0.9, d), cx, DECK_H - 0.45, cz);
      [w, d] = dims(l, len, 2 * HW - 0.2);
      add(parts.top, new THREE.BoxGeometry(w, 0.04, d), cx, DECK_H + 0.02, cz);
      // Double yellow down the middle; solid white edge lines.
      for (const o of [-0.18, 0.18]) {
        [w, d] = dims(l, len - 2 * HW, 0.14);
        add(parts.yellow, new THREE.BoxGeometry(w, 0.03, d), l.axis === 'x' ? cx : cx + o, DECK_H + 0.05, l.axis === 'x' ? cz + o : cz);
      }
      for (const o of [-6.6, 6.6]) {
        [w, d] = dims(l, len - 2 * HW, 0.18);
        add(parts.white, new THREE.BoxGeometry(w, 0.03, d), l.axis === 'x' ? cx : cx + o, DECK_H + 0.05, l.axis === 'x' ? cz + o : cz);
      }
      for (const rl of l.rails) {
        const rlen = rl.b - rl.a;
        if (rlen < 0.5) continue;
        const m = (rl.a + rl.b) / 2;
        [w, d] = dims(l, rlen, 0.35);
        add(parts.rail, new THREE.BoxGeometry(w, 0.9, d), l.axis === 'x' ? m : rl.p, DECK_H + 0.45, l.axis === 'x' ? rl.p : m);
      }
      for (const a of l.pillars) {
        const [x, z] = l.axis === 'x' ? [a, l.c] : [l.c, a];
        add(parts.pillar, new THREE.BoxGeometry(1.4, DECK_H - 0.9, 1.4), x, (DECK_H - 0.9) / 2, z);
        // A cap under the deck.
        [w, d] = l.axis === 'x' ? [2.2, 2 * HW - 2] : [2 * HW - 2, 2.2];
        add(parts.pillar, new THREE.BoxGeometry(w, 0.6, d), x, DECK_H - 1.2, z);
      }
    }
    for (const r of this.ramps) {
      const L = Math.abs(r.sB - r.sA);
      const len = Math.hypot(L, DECK_H);
      const ang = Math.atan2(DECK_H, L);
      const mid = (r.sA + r.sB) / 2;
      const [cx, cz] = r.axis === 'x' ? [mid, r.c] : [r.c, mid];
      // A sloped slab: tilt so it rises toward B.
      const slab = (list, th, wide, yOff) => {
        const g = r.axis === 'x' ? new THREE.BoxGeometry(len, th, wide) : new THREE.BoxGeometry(wide, th, len);
        if (r.axis === 'x') g.rotateZ(r.dir * ang);
        else g.rotateX(-r.dir * ang);
        g.translate(cx, DECK_H / 2 + yOff, cz);
        list.push(g);
      };
      slab(parts.deck, 0.8, 2 * RHW + 0.6, -0.42);
      slab(parts.top, 0.04, 2 * RHW - 0.2, 0.02);
      for (const side of [-1, 1]) {
        const g = r.axis === 'x' ? new THREE.BoxGeometry(len, 0.9, 0.35) : new THREE.BoxGeometry(0.35, 0.9, len);
        if (r.axis === 'x') g.rotateZ(r.dir * ang);
        else g.rotateX(-r.dir * ang);
        g.translate(r.axis === 'x' ? cx : cx + side * (RHW + 0.17), DECK_H / 2 + 0.45, r.axis === 'x' ? cz + side * (RHW + 0.17) : cz);
        parts.rail.push(g);
      }
      // The solid lower part (a wall down on the street) and pillars under the upper part.
      // A wedge from the ground up to just under the slab, from the bottom of the ramp to
      // where the pillars take over.
      {
        const lo = Math.min(r.sA, r.wall[1]);
        const hi = Math.max(r.sA, r.wall[1]);
        const wl = hi - lo;
        const g = r.axis === 'x' ? new THREE.BoxGeometry(wl, 1, 2 * RHW) : new THREE.BoxGeometry(2 * RHW, 1, wl);
        g.translate(r.axis === 'x' ? (lo + hi) / 2 : r.c, 0.5, r.axis === 'x' ? r.c : (lo + hi) / 2);
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          if (pos.getY(k) < 0.5) continue;
          const along = r.axis === 'x' ? pos.getX(k) : pos.getZ(k);
          const t = Math.max(0, Math.min(1, (along - r.sA) / (r.sB - r.sA)));
          pos.setY(k, Math.max(0.05, DECK_H * t - 0.75));
        }
        g.computeVertexNormals();
        parts.deck.push(g);
      }
      for (const s of r.pillars) {
        const t = (s - r.sA) / (r.sB - r.sA);
        const h = DECK_H * t - 0.8;
        const [x, z] = r.axis === 'x' ? [s, r.c] : [r.c, s];
        add(parts.pillar, new THREE.BoxGeometry(1.2, h, 1.2), x, h / 2, z);
      }
      // A green sign at the bottom: which highway this goes up to.
      // (on the right-hand sidewalk, facing the cars coming up to it)
      const [sx, sz] = r.axis === 'x' ? [r.sA - r.dir, r.c + r.dir * (RHW + 1.6)] : [r.c - r.dir * (RHW + 1.6), r.sA - r.dir];
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(`${r.line.name} ↑`, '#1b6e3a') }));
      sign.position.set(sx, 4.6, sz);
      sign.rotation.y = r.axis === 'x' ? -r.dir * Math.PI / 2 : (r.dir > 0 ? Math.PI : 0);
      scene.add(sign);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), lam(0x5a5f66));
      pole.position.set(sx, 2, sz);
      scene.add(pole);
    }
    const mats = {
      deck: lam(0x8c8f94), top: lam(0x34363b), rail: lam(0xc4c7cb), pillar: lam(0x7f8388),
      yellow: new THREE.MeshBasicMaterial({ color: 0xd8b13a }), white: new THREE.MeshBasicMaterial({ color: 0xdadada }),
    };
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const m = new THREE.Mesh(mergeGeometries(list), mats[k]);
      m.castShadow = k === 'deck' || k === 'pillar' || k === 'rail';
      m.receiveShadow = k === 'top' || k === 'deck';
      scene.add(m);
    }
  }

  drawMap(ctx, px) {
    const s = px / (S + R * 2);
    const o = R;
    ctx.fillStyle = '#d6a23c';
    for (const l of LINES) {
      if (l.axis === 'x') ctx.fillRect((l.a0 - HW + o) * s, (l.c - HW * 0.7 + o) * s, (l.a1 - l.a0 + 2 * HW) * s, HW * 1.4 * s);
      else ctx.fillRect((l.c - HW * 0.7 + o) * s, (l.a0 - HW + o) * s, HW * 1.4 * s, (l.a1 - l.a0 + 2 * HW) * s);
    }
    for (const r of this.ramps) {
      const [x0, x1] = r.axis === 'x' ? [Math.min(r.sA, r.sB), Math.max(r.sA, r.sB)] : [r.c - RHW * 0.6, r.c + RHW * 0.6];
      const [z0, z1] = r.axis === 'x' ? [r.c - RHW * 0.6, r.c + RHW * 0.6] : [Math.min(r.sA, r.sB), Math.max(r.sA, r.sB)];
      ctx.fillRect((x0 + o) * s, (z0 + o) * s, (x1 - x0) * s, (z1 - z0) * s);
    }
  }
}
