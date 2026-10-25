import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lam } from './character.js';
import { signTexture } from './shops.js';
import { setHighwayBoxes } from './vehicle.js';
import { closestOnSeg, obb } from './geom.js';
import { edgesNear } from './city.js';
import { DECK, LANE, RAMPS, RAMP_HW, RING, RING_HALF, RING_LINE, SIGNS, STUBS, XT, XT_HALF, edgeV, laneV, lengths } from './fwyplan.js';

// The freeways in 3D, and how things get on and off them (layout in fwyplan.js).
// - The ring (3 lanes each way) and the crosstown (2 lanes each way), 7.5 m up on pillars over
//   Ring Rd and Crosstown Rd; bridges at 14 m where the crosstown's left lane crosses the ring.
// - Partial cloverleaf interchanges: every way on is a right turn off the cross street, every
//   way off leaves from the right-hand lane.
// - The game moves things in x/z; height comes from the ground or, up here, from the
//   surface under you. Every carriageway and ramp is a "surface" (a center line with heights
//   and a half width). Something up here rides the surface nearest its own height (so on a
//   bridge you stay on the bridge, under it you stay under), and comes back down to the
//   ground at the bottom of a ramp.
// - Guard rails run along every edge except where two surfaces join at the same height
//   (merges, splits, acceleration lanes), and down the middle of each freeway.
// - Lanes are chains of road-graph nodes (one way), linked to the street graph at the
//   interchanges, so traffic, police chases and the GPS use them.
export { DECK as DECK_H };
const T = 0.35; // rail thickness
const SEG = 4; // rail piece length

export class Highway {
  constructor(game) {
    this.game = game;
    this.buildSurfaces();
    this.buildGraph();
    this.buildColliders();
    this.buildMeshes();
    setHighwayBoxes(this);
    const draw = this.game.city.drawMap;
    this.game.city.drawMap = (ctx, px) => {
      draw(ctx, px);
      this.drawMap(ctx, px);
    };
  }

  // ---- Surfaces ----
  buildSurfaces() {
    const S = [];
    const add = (pts, h, hw, info) => {
      const L = lengths(pts);
      const s = { pts, h, hw, L, ...info };
      S.push(s);
      return s;
    };
    // The ring: closed, clockwise; its right side (inner) carries the clockwise lanes.
    const ring = [...RING_LINE, RING_LINE[0]];
    this.ring = add(ring, ring.map(() => DECK), RING_HALF, { main: 'ring', lanes: RING.lanes, closed: true });
    const xt = [];
    for (let z = XT.end0; z <= XT.end1 + 0.01; z += 5) xt.push([XT.x, z]);
    this.xt = add(xt, xt.map(() => DECK), XT_HALF, { main: 'xt', lanes: XT.lanes });
    for (const r of RAMPS) r.surf = add(r.pts, r.h, r.hw, { ramp: r });
    this.surfaces = S;
    // Spatial hash of every surface segment.
    this.CELL = 12;
    this.hash = new Map();
    for (const s of S) {
      for (let i = 1; i < s.pts.length; i++) {
        const [ax, az] = s.pts[i - 1];
        const [bx, bz] = s.pts[i];
        const r = s.hw + 1;
        const seg = { s, i };
        for (let x = Math.floor((Math.min(ax, bx) - r) / this.CELL); x <= Math.floor((Math.max(ax, bx) + r) / this.CELL); x++) {
          for (let z = Math.floor((Math.min(az, bz) - r) / this.CELL); z <= Math.floor((Math.max(az, bz) + r) / this.CELL); z++) {
            const k = x * 1000 + z;
            if (!this.hash.has(k)) this.hash.set(k, []);
            this.hash.get(k).push(seg);
          }
        }
      }
    }
  }

  // Every surface over a point: [{ s, h, d (from the center line) }], at most one per surface.
  surfacesAt(x, z, pad = 0.3) {
    const list = this.hash.get(Math.floor(x / this.CELL) * 1000 + Math.floor(z / this.CELL));
    if (!list) return [];
    const best = new Map();
    for (const { s, i } of list) {
      const [ax, az] = s.pts[i - 1];
      const [bx, bz] = s.pts[i];
      const c = closestOnSeg(x, z, ax, az, bx, bz);
      if (c.d > s.hw + pad) continue;
      const prev = best.get(s);
      if (prev && prev.d <= c.d) continue;
      best.set(s, { s, d: c.d, h: s.h[i - 1] + (s.h[i] - s.h[i - 1]) * c.t, i, t: c.t });
    }
    return [...best.values()];
  }

  // Height of the freeway surface at a spot (the one nearest nearY), or null if there's none.
  heightAt(x, z, nearY = DECK) {
    let best = null;
    let bd = Infinity;
    for (const o of this.surfacesAt(x, z)) {
      // (prefer what's at or a little under you: you don't jump up onto a bridge overhead)
      const d = o.h > nearY + 0.8 ? 100 + o.h - nearY : Math.abs(o.h - nearY);
      if (d < bd) {
        bd = d;
        best = o.h;
      }
    }
    return best;
  }

  // Lowest surface here (for the ground layer: where a ramp starts).
  rampHeight(x, z) {
    let low = null;
    for (const o of this.surfacesAt(x, z)) if (low === null || o.h < low) low = o.h;
    return low;
  }

  // Up a ramp onto the freeway, or back down to the street. o: a vehicle or the player.
  updateLayer(o) {
    if (!o.high) {
      const h = this.rampHeight(o.x, o.z);
      if (h !== null && h > 0.02 && h < 0.6) o.high = true;
    } else {
      const h = this.heightAt(o.x, o.z, o.y ?? o.hy ?? DECK);
      if (h === null || h <= 0.02) o.high = false;
    }
  }

  groundFor(o) {
    if (o.high) return this.heightAt(o.x, o.z, o.y ?? DECK) ?? this.game.city.groundY(o.x, o.z);
    return this.game.city.groundY(o.x, o.z);
  }

  // The highest freeway surface below height y here (or null): what a camera up there can't
  // go through.
  floorBelow(x, z, y) {
    let best = null;
    for (const o of this.surfacesAt(x, z, 0.5)) if (o.h <= y && (best === null || o.h > best)) best = o.h;
    return best;
  }

  // Is there freeway overhead (for things like the helicopter's view or rain)?
  overhead(x, z, y) {
    return this.surfacesAt(x, z, 0).some((o) => o.h > y + 2);
  }

  // ---- Road network: one-way lane chains ----
  buildGraph() {
    const city = this.game.city;
    this.nodes = [];
    this.lanes = [];
    const make = (x, z, extra) => {
      const n = { x, z, nb: [], high: true, ...extra };
      this.nodes.push(n);
      return n;
    };
    const one = (a, b) => {
      if (a && b && a !== b && !a.nb.includes(b)) a.nb.push(b);
    };
    // A lane: offset v from a surface's center line (right of its point order), in travel
    // order; nodes every `step` meters.
    const lane = (s, v, reverse, step, info) => {
      let pts = s.pts.map((p, i) => {
        const a = s.pts[Math.max(0, i - 1)];
        const b = s.pts[Math.min(s.pts.length - 1, i + 1)];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const rx = -(b[1] - a[1]) / L;
        const rz = (b[0] - a[0]) / L;
        return [p[0] + rx * v, p[1] + rz * v];
      });
      let hs = s.h.slice();
      // (a closed loop keeps its closing point, so its last stretch is part of the lane too)
      if (reverse) {
        pts.reverse();
        hs.reverse();
      }
      const L = lengths(pts);
      const nodes = [];
      let last = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        if (s.closed && L[L.length - 1] - L[i] < step * 0.5) break; // (the loop joins back up to its first node)
        if (L[i] - last >= step || i === pts.length - 1) {
          nodes.push(make(pts[i][0], pts[i][1], { hy: hs[i], s: L[i], ...info }));
          last = L[i];
        }
      }
      for (let i = 1; i < nodes.length; i++) one(nodes[i - 1], nodes[i]);
      if (s.closed) one(nodes[nodes.length - 1], nodes[0]);
      const ln = { s, v, reverse, pts, L, nodes, closed: s.closed, ...info };
      this.lanes.push(ln);
      return ln;
    };
    // Mainline lanes; lane changes allowed every few nodes.
    const mains = [];
    for (const s of [this.ring, this.xt]) {
      for (const dir of [1, -1]) {
        const set = [];
        for (let k = 0; k < s.lanes; k++) set.push(lane(s, dir * laneV(k), dir < 0, 22, { main: s.main, laneNo: k, dir }));
        for (let k = 0; k + 1 < set.length; k++) {
          for (const [A, B] of [[set[k], set[k + 1]], [set[k + 1], set[k]]]) {
            A.nodes.forEach((n, i) => {
              if (i % 3 !== 1) return;
              const m = B.nodes.find((q) => q.s > n.s + 12);
              one(n, m);
            });
          }
        }
        mains.push(set);
      }
    }
    // Ramps.
    for (const r of RAMPS) r.lane = lane(r.surf, 0, false, r.loop ? 7 : 10, { ramp: true });
    // Where a ramp starts or ends on another lane: the lane node just before / after that point.
    const laneHit = (x, z, exclude) => {
      let best = null;
      let bd = 1.6;
      for (const ln of this.lanes) {
        if (ln === exclude) continue;
        for (let i = 1; i < ln.pts.length; i++) {
          const c = closestOnSeg(x, z, ln.pts[i - 1][0], ln.pts[i - 1][1], ln.pts[i][0], ln.pts[i][1]);
          if (c.d < bd) {
            bd = c.d;
            best = { ln, s: ln.L[i - 1] + (ln.L[i] - ln.L[i - 1]) * c.t };
          }
        }
      }
      return best;
    };
    const before = (hit) => {
      let n = null;
      for (const q of hit.ln.nodes) if (q.s <= hit.s - 1) n = q;
      return n || (hit.ln.closed ? hit.ln.nodes[hit.ln.nodes.length - 1] : null);
    };
    const after = (hit) => hit.ln.nodes.find((q) => q.s >= hit.s + 1) || (hit.ln.closed ? hit.ln.nodes[0] : null);
    // Street ends of the stubs.
    const stubNode = (k) => {
      const [x, z] = STUBS[k][1];
      return city.nearestNode(x, z, (n) => n.street);
    };
    const streetNode = (k) => {
      const [x, z] = STUBS[k][0];
      return city.nearestNode(x, z, (n) => n.street);
    };
    for (const r of RAMPS) {
      const ns = r.lane.nodes;
      const first = ns[0];
      const last = ns[ns.length - 1];
      if (r.stub !== undefined) {
        const end = stubNode(r.stub);
        const cross = streetNode(r.stub);
        end.rampEnd = true;
        if (r.kind === 'off') {
          // Off the ramp onto the stub, then out to the cross street (one way).
          one(last, end);
          end.nb = [cross];
          cross.nb = cross.nb.filter((m) => m !== end);
        } else {
          end.nb = [first];
          const ci = end.nb;
          void ci;
          if (!cross.nb.includes(end)) cross.nb.push(end);
        }
      }
      if (r.kind === 'off' || r.kind === 'link') {
        // Starts on a mainline lane.
        const hit = laneHit(...r.pts[0], r.lane);
        if (hit) one(before(hit), first);
      }
      if (r.kind === 'on' || r.kind === 'link') {
        const hit = laneHit(...r.pts[r.pts.length - 1], r.lane);
        if (hit) one(last, after(hit));
      }
    }
    // Every node knows the lane it's on (for lane-keeping AI and the GPS).
    for (const ln of this.lanes) for (const n of ln.nodes) n.laneRef = ln;
  }

  // ---- Solid bits ----
  buildColliders() {
    const city = this.game.city;
    const rails = []; // [obb box with y0 = surface height]
    // A rail piece is left out where another surface carries on at the same height (a join).
    const joined = (x, z, h, s) => this.surfacesAt(x, z, -0.4).some((o) => o.s !== s && Math.abs(o.h - h) < 1.2);
    for (const s of this.surfaces) {
      s.rails = [];
      // The edge, resampled every 2 m (straights have points far apart), with heights.
      const E = [];
      for (let i = 1; i < s.pts.length; i++) {
        const [ax, az] = s.pts[i - 1];
        const [bx, bz] = s.pts[i];
        const n = Math.max(1, Math.ceil((s.L[i] - s.L[i - 1]) / 2));
        const L = s.L[i] - s.L[i - 1] || 1;
        const rx = -(bz - az) / L;
        const rz = (bx - ax) / L;
        for (let k = i > 1 ? 1 : 0; k <= n; k++) E.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, s.h[i - 1] + ((s.h[i] - s.h[i - 1]) * k) / n, rx, rz]);
      }
      const sides = s.ramp ? [-1, 1] : [-1, 0, 1];
      for (const side of sides) {
        const off = side * (s.hw + (side ? T / 2 : 0));
        const per = Math.round(SEG / 2);
        for (let k = 0; k + per < E.length + per - 1; k += per) {
          const A = E[k];
          const B = E[Math.min(E.length - 1, k + per)];
          if (A === B) break;
          const x0 = A[0] + A[3] * off;
          const z0 = A[1] + A[4] * off;
          const x1 = B[0] + B[3] * off;
          const z1 = B[1] + B[4] * off;
          const h0 = A[2];
          const h1 = B[2];
          const hm = (h0 + h1) / 2;
          if (hm < 0.6) continue; // down at street level
          // Left out where another surface carries on at the same height (a join): checked
          // at both ends and the middle.
          if (side && [[x0, z0], [(x0 + x1) / 2, (z0 + z1) / 2], [x1, z1]].some(([x, z]) => joined(x, z, hm, s))) continue;
          const L = Math.hypot(x1 - x0, z1 - z0);
          if (L < 0.2) continue;
          const box = obb((x0 + x1) / 2, (z0 + z1) / 2, L / 2 + 0.1, T / 2, Math.atan2(z1 - z0, x1 - x0), 1.1, Math.min(h0, h1));
          box.top = Math.max(h0, h1) + 1.1;
          rails.push(box);
          s.rails.push([x0, z0, h0, x1, z1, h1, side === 0]);
        }
      }
    }
    this.rails = rails;
    // Rails by height band (cars only bump the ones near their own height).
    this.bands = [];
    for (let k = 0; k < 12; k++) {
      const lo = k * 2 - 2.5;
      const hi = k * 2 + 2.5;
      this.bands.push(rails.filter((b) => b.top > lo && b.y0 < hi));
    }
    // Pillars, and the solid low part of each ramp (a wall to traffic down below).
    this.pillars = [];
    const pillar = (x, z, h, w = 1.4) => {
      this.pillars.push([x, z, h, w]);
      city.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - w / 2, maxZ: z + w / 2, h: h - 0.9 });
    };
    const clearOfStreets = (x, z, own) => !edgesNear(x, z, 1.5).some((e) => !own.includes(e.name));
    for (const s of [this.ring, this.xt]) {
      const own = s.main === 'ring' ? ['Ring Rd'] : ['Crosstown Rd'];
      const off = s.hw - 3.5;
      let since = 99;
      for (let i = 1; i < s.pts.length; i++) {
        since += s.L[i] - s.L[i - 1];
        if (since < 30) continue;
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const rx = -(b[1] - a[1]) / L;
        const rz = (b[0] - a[0]) / L;
        const pts = [[b[0] + rx * off, b[1] + rz * off], [b[0] - rx * off, b[1] - rz * off]];
        if (!pts.every(([x, z]) => clearOfStreets(x, z, own))) continue;
        since = 0;
        for (const [x, z] of pts) pillar(x, z, DECK);
        s.caps = s.caps || [];
        s.caps.push([b[0], b[1], Math.atan2(rz, rx)]);
      }
    }
    this.walls = [];
    for (const s of this.surfaces) {
      if (!s.ramp) continue;
      let since = 99;
      for (let i = 1; i < s.pts.length; i++) {
        const [ax, az] = s.pts[i - 1];
        const [bx, bz] = s.pts[i];
        const hm = (s.h[i - 1] + s.h[i]) / 2;
        const L = s.L[i] - s.L[i - 1];
        since += L;
        // Over another surface (the ramp's join with the deck): nothing underneath.
        const overDeck = this.surfacesAt(bx, bz, 0).some((o) => o.s !== s && o.h > 3);
        if (hm > 0.8 && hm < 4 && !overDeck) {
          const w = s.hw * 0.85;
          city.colliders.push(obb((ax + bx) / 2, (az + bz) / 2, L / 2 + 0.3, w, Math.atan2(bz - az, bx - ax), hm));
          this.walls.push(i);
        }
        if (hm >= 4 && since > 13 && !overDeck && !edgesNear(bx, bz, 1).length) {
          since = 0;
          pillar(bx, bz, s.h[i], 1.1);
        }
      }
    }
  }

  // Which rails something up here can hit.
  boxesFor(y) {
    return this.bands[Math.max(0, Math.min(this.bands.length - 1, Math.round(y / 2)))];
  }

  // ---- What you see ----
  buildMeshes() {
    const scene = this.game.scene;
    const parts = { deck: [], top: [], ramptop: [], rail: [], pillar: [], yellow: [], white: [] };
    for (const s of this.surfaces) {
      const thick = s.ramp ? 0.75 : 0.9;
      parts.deck.push(ribbon(s.pts, s.h, s.hw + 0.3, -thick, -0.02));
      (s.ramp ? parts.ramptop : parts.top).push(ribbon(s.pts, s.h, s.hw - 0.05, 0, s.ramp ? 0.025 : 0.03, true));
      if (s.ramp) {
        // The low part stands on solid ground.
        let a = -1;
        for (let i = 0; i <= s.h.length; i++) {
          const low = i < s.h.length && s.h[i] < 3.6 && s.h[i] > 0.05;
          if (low && a < 0) a = i;
          if (!low && a >= 0) {
            if (i - a > 1) parts.deck.push(ribbon(s.pts.slice(a, i), s.h.slice(a, i), s.hw + 0.3, 0, -0.77, false, true));
            a = -1;
          }
        }
      }
      for (const [x0, z0, h0, x1, z1, h1, median] of s.rails) parts.rail.push(wallPiece(x0, z0, h0, x1, z1, h1, median ? 0.85 : 0.9, median ? 0.5 : T));
      // Lane lines on the mainlines: dashed white between lanes, solid white at the edges,
      // yellow by the median.
      if (!s.ramp) {
        for (const dir of [1, -1]) {
          parts.yellow.push(stripe(s, dir * 1.5, 0.15, 0));
          parts.white.push(stripe(s, dir * (1.5 + s.lanes * LANE), 0.18, 0));
          for (let k = 1; k < s.lanes; k++) parts.white.push(stripe(s, dir * (1.5 + k * LANE), 0.14, 3));
        }
      }
    }
    for (const [x, z, h, w] of this.pillars) {
      const g = new THREE.BoxGeometry(w, h - 0.9, w);
      g.translate(x, (h - 0.9) / 2, z);
      parts.pillar.push(g);
    }
    for (const s of [this.ring, this.xt]) {
      for (const [x, z, a] of s.caps || []) {
        const g = new THREE.BoxGeometry(2 * s.hw - 4, 0.7, 2.2);
        g.rotateY(-a);
        g.translate(x, DECK - 1.25, z);
        parts.pillar.push(g);
      }
    }
    const mats = {
      deck: lam(0x8c8f94), top: lam(0x34363b), ramptop: new THREE.MeshLambertMaterial({ color: 0x36383d, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      rail: lam(0xc4c7cb), pillar: lam(0x7f8388),
      yellow: new THREE.MeshBasicMaterial({ color: 0xd8b13a, side: THREE.DoubleSide }), white: new THREE.MeshBasicMaterial({ color: 0xdadada, side: THREE.DoubleSide }),
    };
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (n.attributes.uv) n.deleteAttribute('uv');
        return n;
      });
      const m = new THREE.Mesh(mergeGeometries(geos), mats[k]);
      if (k === 'top' || k === 'ramptop' || k === 'deck' || k === 'rail') m.material.side = THREE.DoubleSide;
      m.castShadow = k === 'deck' || k === 'pillar' || k === 'rail';
      m.receiveShadow = k === 'top' || k === 'ramptop' || k === 'deck';
      scene.add(m);
    }
    for (const sg of SIGNS) this.sign(scene, sg);
  }

  // A green sign facing the traffic heading `ang` (x/z direction angle). On the freeway: over
  // the lane, on a gantry post at the edge; on a street: on a pole by the curb.
  sign(scene, sg) {
    const [x, z] = sg.at;
    const y = sg.h || 0;
    const w = Math.max(5, sg.text.length * 0.42);
    const text = sg.sub ? `${sg.text}  ${sg.sub}` : sg.text;
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(text, '#1b6e3a'), side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w + 3, 1.5), mat);
    const fx = -Math.cos(sg.ang);
    const fz = -Math.sin(sg.ang);
    p.rotation.y = Math.atan2(fx, fz);
    const over = y > 1;
    p.position.set(x, y + (over ? 6.2 : 4.2), z);
    scene.add(p);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, over ? 6.2 : 4, 6), lam(0x5a5f66));
    if (over) {
      // Post at the outer edge of the deck, arm over the lane.
      const surf = this.surfacesAt(x, z, 1)[0];
      const rx = -Math.sin(sg.ang);
      const rz = Math.cos(sg.ang);
      const reach = surf ? Math.max(1, surf.s.hw - surf.d + 0.6) : 3;
      pole.position.set(x + rx * reach, y + 3.1, z + rz * reach);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, reach), lam(0x5a5f66));
      arm.position.set(x + (rx * reach) / 2, y + 7.1, z + (rz * reach) / 2);
      arm.rotation.y = Math.atan2(rx, rz);
      scene.add(arm);
    } else {
      pole.position.set(x, 2, z);
    }
    scene.add(pole);
  }

  drawMap(ctx, px) {
    const s = px / this.game.city.size;
    ctx.strokeStyle = '#d6a23c';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const sf of this.surfaces) {
      ctx.lineWidth = Math.max(sf.ramp ? 1.5 : 3, sf.hw * 2 * s * (sf.ramp ? 0.8 : 0.9));
      ctx.beginPath();
      sf.pts.forEach(([x, z], i) => (i ? ctx.lineTo(x * s, z * s) : ctx.moveTo(x * s, z * s)));
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
    if (!toGround) quad(a, b, c, d);
    if (!topOnly) {
      quad(a, down(a), down(b), b);
      quad(d, c, down(c), down(d));
      if (!toGround) quad(down(a), down(d), down(c), down(b));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A painted line along a surface at offset v (right of its point order); dashed if dash > 0.
function stripe(s, v, w, dash) {
  const pos = [];
  const P = (i, o) => {
    const a = s.pts[Math.max(0, i - 1)];
    const b = s.pts[Math.min(s.pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const rx = -(b[1] - a[1]) / L;
    const rz = (b[0] - a[0]) / L;
    return [s.pts[i][0] + rx * (v + o), s.h[i] + 0.05, s.pts[i][1] + rz * (v + o)];
  };
  for (let i = 1; i < s.pts.length; i++) {
    if (dash && Math.floor(s.L[i - 1] / dash) % 3 !== 0) continue;
    const a = P(i - 1, -w / 2);
    const b = P(i, -w / 2);
    const c = P(i, w / 2);
    const d = P(i - 1, w / 2);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
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
