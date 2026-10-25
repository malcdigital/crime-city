import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { lam } from './character.js';
import { signTexture } from './shops.js';
import { setHighwayBoxes } from './vehicle.js';
import { LINES, RAMPS, DECK_H, HW, RAMP_HW, CURB, GAP, MARGIN } from './hwlayout.js';

// Elevated highways: a ring around the city (over the edge roads) and a crosstown across the
// middle (over 7th Street), 8 m up. You get on and off by one-way loop ramps (layout in
// hwlayout.js): turn right off the street, circle up and merge; exits do the same backwards.
// Speed limit 65 (45 on the streets). No lights, no stop signs.
// The game is flat underneath (everything moves in x/z), so things up there are on a "high"
// layer: a car goes up when it drives onto the bottom of a ramp and comes back down at the
// bottom of one. Up there it rides at deck height and bumps the guard rails; down below it
// drives under (around the pillars) as if the highway weren't there.
// The highways and ramps are part of the road network (ramps one way), so traffic, police
// chases and the GPS use them.
export { DECK_H };
const P = CFG.PITCH;
const N = CFG.BLOCKS;
const T = 0.35; // rail thickness

export class Highway {
  constructor(game) {
    this.game = game;
    this.lines = LINES;
    this.ramps = RAMPS;
    this.colliders = []; // guard rails along the highways (only up at deck height)
    this.rampRails = []; // guard rails along the ramps
    this.nodes = [];
    this.buildGraph();
    this.buildColliders();
    this.buildMeshes();
    this.allRails = [...this.colliders, ...this.rampRails];
    setHighwayBoxes(this);
    // The highways on the radar and the map.
    const draw = this.game.city.drawMap;
    this.game.city.drawMap = (ctx, px) => {
      draw(ctx, px);
      this.drawMap(ctx, px);
    };
  }

  // ---- Road network ----
  buildGraph() {
    const city = this.game.city;
    const make = (x, z, extra = {}) => {
      const n = { x, z, nb: [], high: true, ...extra };
      this.nodes.push(n);
      return n;
    };
    const two = (a, b) => {
      if (!a.nb.includes(b)) a.nb.push(b);
      if (!b.nb.includes(a)) b.nb.push(a);
    };
    const one = (a, b) => {
      if (!a.nb.includes(b)) a.nb.push(b);
    };
    // Points along each highway: its ends, junctions with the other highways, where ramps
    // join, and every few blocks.
    const shared = new Map();
    const at = (x, z) => {
      const k = `${Math.round(x)},${Math.round(z)}`;
      if (!shared.has(k)) shared.set(k, make(x, z));
      return shared.get(k);
    };
    for (const l of LINES) {
      const stops = new Set([l.a0, l.a1]);
      for (const m of LINES) if (m.axis !== l.axis && m.c >= l.a0 && m.c <= l.a1 && l.c >= m.a0 && l.c <= m.a1) stops.add(m.c);
      for (const r of RAMPS) if (r.line === l) stops.add(l.axis === 'x' ? r.deck[0] : r.deck[1]);
      for (let k = 0; k <= N; k += 3) stops.add(k * P);
      const list = [...stops].sort((a, b) => a - b).map((a) => (l.axis === 'x' ? at(a, l.c) : at(l.c, a)));
      for (let k = 1; k < list.length; k++) two(list[k - 1], list[k]);
    }
    // Ramps: a one-way chain from the street to the highway (or back).
    for (const r of RAMPS) {
      const deck = at(r.deck[0], r.deck[1]);
      const corner = city.nearestNode(r.streetNode[0], r.streetNode[1]);
      // (the street end is an ordinary street point; ramp: the one-way bits)
      const street = make(r.street[0], r.street[1], { high: false, rampEnd: true });
      // Points along the loop, about every 9 m.
      const chain = [];
      let acc = 99;
      for (let i = 1; i < r.pts.length; i++) {
        acc += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
        if (acc >= 9 || i === r.pts.length - 1) {
          acc = 0;
          chain.push(make(r.pts[i][0], r.pts[i][1], { high: false, ramp: true }));
        }
      }
      if (r.kind === 'on') {
        one(corner, street);
        let prev = street;
        for (const n of chain) {
          one(prev, n);
          prev = n;
        }
        one(prev, deck);
      } else {
        let prev = deck;
        for (const n of chain) {
          one(prev, n);
          prev = n;
        }
        one(prev, street);
        one(street, corner);
      }
      r.nodes = [street, ...chain];
    }
  }

  // Which rails something up here can hit: near deck height, all of them; lower down (on a
  // ramp under the edge of the deck), just the ramp's own.
  boxesFor(y) {
    return y > DECK_H - 3 ? this.allRails : this.rampRails;
  }

  // ---- Heights and layers ----
  // Height of the highway surface at a spot, or null if there's none. Where a ramp runs under
  // the edge of a deck, nearY (how high the thing is now) picks which one it's on.
  heightAt(x, z, nearY = DECK_H) {
    const r = this.rampHeight(x, z);
    const d = this.onDeck(x, z, 0) ? DECK_H : null;
    if (r === null) return d;
    if (d === null) return r;
    return Math.abs(r - nearY) < Math.abs(d - nearY) ? r : d;
  }

  rampHeight(x, z) {
    for (const r of RAMPS) {
      const b = r.box;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      // Closest point on the ramp's center line.
      let best = Infinity;
      let bh = 0;
      const p = r.pts;
      for (let i = 1; i < p.length; i++) {
        const ax = p[i - 1][0];
        const az = p[i - 1][1];
        const dx = p[i][0] - ax;
        const dz = p[i][1] - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
        if (d2 < best) {
          best = d2;
          bh = r.h[i - 1] + (r.h[i] - r.h[i - 1]) * t;
        }
      }
      if (best <= (RAMP_HW + 0.3) ** 2) return bh;
    }
    return null;
  }

  // Up a ramp onto the highway, or back down to the street. o: a vehicle or the player.
  updateLayer(o) {
    if (!o.high) {
      const h = this.rampHeight(o.x, o.z);
      if (h !== null && h > 0.02 && h < 0.5) o.high = true;
    } else {
      const h = this.heightAt(o.x, o.z, o.y ?? o.hy ?? DECK_H);
      if (h === null || h <= 0.02) o.high = false;
    }
  }

  groundFor(o) {
    if (o.high) return this.heightAt(o.x, o.z, o.y ?? DECK_H) ?? 0;
    return this.game.city.groundY(o.x, o.z);
  }

  onDeck(x, z, pad = 0.6) {
    return LINES.some((l) => {
      const perp = l.axis === 'x' ? z : x;
      const along = l.axis === 'x' ? x : z;
      return Math.abs(perp - l.c) <= HW + pad && along >= l.a0 - HW && along <= l.a1 + HW;
    });
  }

  // On a city street (not a block, not out past the edge roads).
  onStreet(x, z) {
    const S = N * P;
    if (x < -CURB || z < -CURB || x > S + CURB || z > S + CURB) return false;
    return !this.game.city.blockAt(x, z);
  }

  // ---- Solid bits ----
  buildColliders() {
    const city = this.game.city;
    const box = (list, minX, maxX, minZ, maxZ, h) => list.push({ minX, maxX, minZ, maxZ, h });
    // Guard rails along both edges of each highway, with gaps where the other highways join
    // and where ramps merge in or peel off.
    for (const l of LINES) {
      l.rails = [];
      for (const side of [-1, 1]) {
        const gaps = [];
        for (const m of LINES) {
          if (m === l || m.axis === l.axis || m.c < l.a0 - 1 || m.c > l.a1 + 1) continue;
          if (side > 0 ? m.a1 > l.c + HW : m.a0 < l.c - HW) gaps.push([m.c - HW, m.c + HW]);
        }
        for (const r of RAMPS) {
          if (r.line !== l || r.side !== side) continue;
          // railGap is in the ramp's own u (along the highway): convert to world.
          const ends = r.railGap.map((u) => {
            const p = r.W(u, 0);
            return l.axis === 'x' ? p[0] : p[1];
          });
          gaps.push([Math.min(...ends), Math.max(...ends)]);
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
          l.rails.push({ a, b, p: (p0 + p1) / 2 });
        }
      }
      // Pillars down the middle of the road underneath, clear of the intersections.
      l.pillars = [];
      for (let a = l.a0 + 26; a < l.a1 - 10; a += 26) {
        const k = Math.round(a / P) * P;
        if (Math.abs(a - k) < CFG.ROAD / 2 + 7) continue;
        l.pillars.push(a);
        if (l.axis === 'x') box(city.colliders, a - 0.7, a + 0.7, l.c - 0.7, l.c + 0.7, DECK_H);
        else box(city.colliders, l.c - 0.7, l.c + 0.7, a - 0.7, a + 0.7, DECK_H);
      }
    }
    // Ramps: rails along both sides (short pieces round the curve); down on the ground, the
    // low part is a solid wall and the rest stands on pillars.
    for (const r of RAMPS) {
      r.rails = [[], []];
      r.pillars = [];
      const p = r.pts;
      let sinceP = 99;
      for (let i = 1; i < p.length; i++) {
        const [ax, az] = p[i - 1];
        const [bx, bz] = p[i];
        const dx = bx - ax;
        const dz = bz - az;
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L;
        const nz = dx / L;
        const hm = (r.h[i - 1] + r.h[i]) / 2;
        for (const [k, s] of [[0, -1], [1, 1]]) {
          const o = s * (RAMP_HW + T / 2);
          const x0 = ax + nx * o;
          const z0 = az + nz * o;
          const x1 = bx + nx * o;
          const z1 = bz + nz * o;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          // No rail where the ramp meets the deck or the street.
          if (this.onDeck(mx, mz) || (hm < 0.6 && this.onStreet(mx, mz))) {
            r.rails[k].push(null);
            continue;
          }
          r.rails[k].push([x0, z0, x1, z1]);
          // In short pieces, so on the curves the boxes hug the rail instead of poking into
          // the lane.
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
          for (let q = 0; q < n; q++) {
            const xa = x0 + ((x1 - x0) * q) / n;
            const za = z0 + ((z1 - z0) * q) / n;
            const xb = x0 + ((x1 - x0) * (q + 1)) / n;
            const zb = z0 + ((z1 - z0) * (q + 1)) / n;
            box(this.rampRails, Math.min(xa, xb) - T / 2, Math.max(xa, xb) + T / 2, Math.min(za, zb) - T / 2, Math.max(za, zb) + T / 2, DECK_H);
          }
        }
        // Down on the ground: the low part is a wall; higher up, pillars.
        if (hm > 0.9 && hm < 3.2) {
          const w = RAMP_HW * 0.8;
          box(city.colliders, Math.min(ax, bx) - w, Math.max(ax, bx) + w, Math.min(az, bz) - w, Math.max(az, bz) + w, 3);
        }
        sinceP += L;
        if (hm >= 3.2 && sinceP > 11 && !this.onDeck(bx, bz, 1.5)) {
          sinceP = 0;
          r.pillars.push([bx, bz, r.h[i]]);
          box(city.colliders, bx - 0.6, bx + 0.6, bz - 0.6, bz + 0.6, DECK_H);
        }
      }
    }
  }

  // ---- What you see ----
  buildMeshes() {
    const scene = this.game.scene;
    const parts = { deck: [], top: [], rail: [], pillar: [], yellow: [], white: [] };
    const boxAt = (list, w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      list.push(g);
    };
    const dims = (l, len, w) => (l.axis === 'x' ? [len, w] : [w, len]);
    for (const l of LINES) {
      const len = l.a1 - l.a0 + 2 * HW;
      const mid = (l.a0 + l.a1) / 2;
      const [cx, cz] = l.axis === 'x' ? [mid, l.c] : [l.c, mid];
      let [w, d] = dims(l, len, 2 * HW);
      boxAt(parts.deck, w, 0.9, d, cx, DECK_H - 0.45, cz);
      [w, d] = dims(l, len, 2 * HW - 0.2);
      boxAt(parts.top, w, 0.04, d, cx, DECK_H + 0.02, cz);
      for (const o of [-0.18, 0.18]) {
        [w, d] = dims(l, len - 2 * HW, 0.14);
        boxAt(parts.yellow, w, 0.03, d, l.axis === 'x' ? cx : cx + o, DECK_H + 0.05, l.axis === 'x' ? cz + o : cz);
      }
      for (const o of [-(HW - 1.6), HW - 1.6]) {
        [w, d] = dims(l, len - 2 * HW, 0.18);
        boxAt(parts.white, w, 0.03, d, l.axis === 'x' ? cx : cx + o, DECK_H + 0.05, l.axis === 'x' ? cz + o : cz);
      }
      for (const rl of l.rails) {
        const rlen = rl.b - rl.a;
        if (rlen < 0.5) continue;
        const m = (rl.a + rl.b) / 2;
        [w, d] = dims(l, rlen, T);
        boxAt(parts.rail, w, 0.9, d, l.axis === 'x' ? m : rl.p, DECK_H + 0.45, l.axis === 'x' ? rl.p : m);
      }
      for (const a of l.pillars) {
        const [x, z] = l.axis === 'x' ? [a, l.c] : [l.c, a];
        boxAt(parts.pillar, 1.4, DECK_H - 0.9, 1.4, x, (DECK_H - 0.9) / 2, z);
        [w, d] = l.axis === 'x' ? [2.2, 2 * HW - 2] : [2 * HW - 2, 2.2];
        boxAt(parts.pillar, w, 0.6, d, x, DECK_H - 1.2, z);
      }
    }
    for (const r of RAMPS) {
      parts.deck.push(ribbon(r.pts, r.h, RAMP_HW + 0.3, -0.75, -0.02));
      parts.top.push(ribbon(r.pts, r.h, RAMP_HW - 0.1, 0, 0.02, true));
      // The low part is solid underneath (down to the ground).
      const low = [];
      r.h.forEach((h, i) => {
        if (h < 3.4) low.push(i);
      });
      if (low.length > 1) {
        const a = Math.min(...low);
        const b = Math.max(...low);
        parts.deck.push(ribbon(r.pts.slice(a, b + 1), r.h.slice(a, b + 1), RAMP_HW + 0.3, 0, -0.77, false, true));
      }
      for (const k of [0, 1]) {
        r.rails[k].forEach((seg, i) => {
          if (!seg) return;
          const [x0, z0, x1, z1] = seg;
          parts.rail.push(wallPiece(x0, z0, r.h[i], x1, z1, r.h[i + 1], 0.9, T));
        });
      }
      for (const [x, z, h] of r.pillars) boxAt(parts.pillar, 1.1, h - 0.75, 1.1, x, (h - 0.75) / 2, z);
      // Signs: a green one at the curb where you turn off for an on-ramp; an EXIT sign at the
      // edge of the highway before each off-ramp.
      if (r.kind === 'on') {
        const [sx, sz] = r.W(GAP + 9, CURB + 2);
        const [tx, tz] = r.W(GAP + 19, CURB + 2); // cars come from +u, heading -u
        this.sign(scene, `${r.line.name} ↑`, sx, 0.2, sz, Math.atan2(sx - tx, sz - tz), 4.2);
      } else {
        const u0 = Math.max(...r.railGap) + 25; // 25 m before the exit (traffic heads -u)
        const [sx, sz] = r.W(u0, HW - 0.6);
        const [tx, tz] = r.W(u0 + 10, HW - 0.6);
        this.sign(scene, 'EXIT ↗', sx, DECK_H, sz, Math.atan2(sx - tx, sz - tz), 3.4);
      }
    }
    // Grass where buildings were cleared for the crosstown's loops.
    const SW = CFG.SIDEWALK;
    for (const b of this.game.city.blocks) {
      if (!RAMPS.some((r) => !r.ring && r.box.maxX > b.minX && r.box.minX < b.maxX && r.box.maxZ > b.minZ && r.box.minZ < b.maxZ)) continue;
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX - SW * 2, 0.05, b.maxZ - b.minZ - SW * 2), lam(0x557f45));
      lawn.position.set((b.minX + b.maxX) / 2, 0.215, (b.minZ + b.maxZ) / 2);
      lawn.receiveShadow = true;
      scene.add(lawn);
    }
    const mats = {
      deck: lam(0x8c8f94), top: lam(0x34363b), rail: lam(0xc4c7cb), pillar: lam(0x7f8388),
      yellow: new THREE.MeshBasicMaterial({ color: 0xd8b13a }), white: new THREE.MeshBasicMaterial({ color: 0xdadada }),
    };
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      // (all plain colors: drop texture coordinates so boxes and curved pieces merge)
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n.attributes.uv) n.deleteAttribute('uv');
        return n;
      });
      const m = new THREE.Mesh(mergeGeometries(geos), mats[k]);
      if (k === 'top' || k === 'deck' || k === 'rail') m.material.side = THREE.DoubleSide;
      m.castShadow = k === 'deck' || k === 'pillar' || k === 'rail';
      m.receiveShadow = k === 'top' || k === 'deck';
      scene.add(m);
    }
  }

  // A green sign on a post. `dir` is the way the traffic reading it is heading; it faces them.
  sign(scene, text, x, y, z, dir, w) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(text, '#1b6e3a') }));
    sign.position.set(x, y + 4.2, z);
    sign.rotation.y = dir + Math.PI; // the face looks back at them
    scene.add(sign);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.8, 6), lam(0x5a5f66));
    pole.position.set(x, y + 1.9, z);
    scene.add(pole);
  }

  drawMap(ctx, px) {
    const S = N * P;
    const s = px / (S + MARGIN * 2);
    const o = MARGIN;
    ctx.fillStyle = '#d6a23c';
    for (const l of LINES) {
      if (l.axis === 'x') ctx.fillRect((l.a0 - HW + o) * s, (l.c - HW * 0.7 + o) * s, (l.a1 - l.a0 + 2 * HW) * s, HW * 1.4 * s);
      else ctx.fillRect((l.c - HW * 0.7 + o) * s, (l.a0 - HW + o) * s, HW * 1.4 * s, (l.a1 - l.a0 + 2 * HW) * s);
    }
    ctx.strokeStyle = '#d6a23c';
    ctx.lineWidth = Math.max(2, RAMP_HW * 1.3 * s);
    ctx.lineCap = 'round';
    for (const r of RAMPS) {
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => (i ? ctx.lineTo((x + o) * s, (z + o) * s) : ctx.moveTo((x + o) * s, (z + o) * s)));
      ctx.stroke();
    }
  }
}

// A strip following a path (x, z points with heights hs): the top surface, plus (unless
// topOnly) its sides and underside for a slab `th` thick (th < 0: hanging below the top).
// toGround: instead, solid sides all the way down to the ground.
function ribbon(pts, hs, hw, th, lift, topOnly = false, toGround = false) {
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const Lp = [];
  const Rp = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(pts.length - 1, i + 1)];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    const y = hs[i] + lift;
    Lp.push([pts[i][0] + nx * hw, y, pts[i][1] + nz * hw]);
    Rp.push([pts[i][0] - nx * hw, y, pts[i][1] - nz * hw]);
  }
  const down = (p) => [p[0], toGround ? 0 : p[1] + th, p[2]];
  for (let i = 1; i < pts.length; i++) {
    const a = Lp[i - 1];
    const b = Lp[i];
    const c = Rp[i];
    const d = Rp[i - 1];
    if (!toGround) quad(a, b, c, d); // top
    if (!topOnly) {
      quad(a, down(a), down(b), b); // sides
      quad(d, c, down(c), down(d));
      if (!toGround) quad(down(a), down(d), down(c), down(b)); // underside
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A thin wall between two points, standing on heights h0 and h1 at its ends, `h` tall.
function wallPiece(x0, z0, h0, x1, z1, h1, h, t) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (t / 2);
  const nz = (dx / l) * (t / 2);
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const A = [x0 + nx, h0, z0 + nz];
  const B = [x1 + nx, h1, z1 + nz];
  const C = [x1 - nx, h1, z1 - nz];
  const D = [x0 - nx, h0, z0 - nz];
  const up = (p) => [p[0], p[1] + h, p[2]];
  quad(A, B, up(B), up(A));
  quad(D, up(D), up(C), C);
  quad(up(A), up(B), up(C), up(D));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
