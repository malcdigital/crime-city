import * as THREE from 'three';
import { districtAt } from './worldplan.js';
import { edgesNear } from './city.js';
import { inHole } from './fwyplan.js';

// Street furniture and the rules of the road, for intersections of any shape.
// - Traffic lights where main roads cross, and at the busy junctions of Downtown, the
//   Financial and Government districts and the Strip. Two phases: the arms are split by
//   direction into two groups (along the main road, and across it). Green 10 s, yellow 2.5 s,
//   all-red 1 s, offset junction to junction.
// - Elsewhere, stop signs: where a minor road meets a bigger one, only the minor road stops
//   (two-way stop); where equal roads meet, everyone stops (all-way stop). Bends in a road
//   (two arms) have nothing.
// - White stop lines on every approach that stops, just before the crosswalk.
// - Lights and stop signs on the near-right corner of each approach, by the stop line.
// - Street lights along every sidewalk (on at dusk, off at dawn — see daynight.js).
// Traffic (traffic.js), pedestrians (peds.js) and the police (enforcement.js) ask here what
// they're allowed to do. "Axis" is 'NS' (the first phase group) or 'EW' (the second).
const GREEN = 10;
const YELLOW = 2.5;
const ALLRED = 1;
const CYCLE = 2 * (GREEN + YELLOW + ALLRED);
const BUSY = ['Downtown', 'Financial District', 'Government District', 'The Strip'];

export class Streets {
  constructor(game) {
    this.game = game;
    const city = game.city;
    this.scene = game.scene;
    this.t = 0;
    this.nodes = city.nodes;
    this.control = new Map(); // node -> { type, offset, arms: [{ m, e, ux, uz, group, stop, stopAt }] }
    for (const n of city.nodes) {
      if (!n.edges) continue;
      const arms = n.edges.map((e) => {
        const m = e.other(n);
        const L = Math.hypot(m.x - n.x, m.z - n.z) || 1;
        return { m, e, ux: (m.x - n.x) / L, uz: (m.z - n.z) / L, rank: e.rank };
      });
      const deg = arms.length;
      let type = 'none';
      const top = Math.max(...arms.map((a) => a.rank));
      // Main axis: the direction of the highest-ranked arm.
      const lead = arms.find((a) => a.rank === top);
      for (const a of arms) {
        const along = Math.abs(a.ux * lead.ux + a.uz * lead.uz);
        a.group = along > Math.SQRT1_2 ? 0 : 1;
      }
      if (deg >= 3) {
        const big = arms.filter((a) => a.rank >= 4).length;
        const busy = BUSY.includes(districtAt(n.x, n.z)) && deg >= 4;
        const both = arms.some((a) => a.group === 0) && arms.some((a) => a.group === 1);
        const stub = arms.some((a) => a.e.street?.stub !== undefined);
        if (both && !stub && ((big >= 3 && arms.some((a) => a.group === 1 && a.rank >= 4)) || busy)) type = 'signal';
        else type = 'stop';
      }
      // Who stops: at a stop junction, everyone below the top rank (if the top-rank road
      // runs straight through), otherwise everyone.
      const tops = arms.filter((a) => a.rank === top);
      const through = tops.length === 2 && tops[0].ux * tops[1].ux + tops[0].uz * tops[1].uz < -0.7;
      // On a roundabout: no lights; traffic coming onto it gives way, traffic on it carries on.
      const round = arms.some((a) => a.e.street?.roundabout);
      if (round) type = deg >= 3 ? 'stop' : 'none';
      for (const a of arms) {
        a.stop = type === 'signal' || (type === 'stop' && !(through && a.rank === top));
        if (round) a.stop = type === 'stop' && !a.e.street?.roundabout;
        // The stop line: clear of the widest road crossing this one, plus the crosswalk.
        // At an angle the crossing road's pavement reaches further along this one (out to our
        // curb), so the line sits further back. (The straight continuation isn't a crossing.)
        let w = 0;
        for (const b of arms) {
          if (b === a) continue;
          const c = a.ux * b.ux + a.uz * b.uz;
          if (c < -0.94) continue;
          const sn = Math.max(0.45, Math.sqrt(Math.max(0, 1 - c * c)));
          w = Math.max(w, (b.e.w / 2 + (a.e.w / 2) * Math.abs(c)) / sn);
        }
        a.stopAt = Math.min(22, Math.max(6, w + 4.2));
        // (coming onto a roundabout: the give-way line right at the ring's edge)
        if (round && !a.e.street?.roundabout) {
          const ring = arms.find((o) => o.e.street?.roundabout);
          a.stopAt = ring.e.w / 2 + 1.2;
        }
      }
      this.control.set(n, { type, offset: Math.floor((n.x + n.z) / 20) % CYCLE, arms, yield: round });
    }
    this.build();
  }

  // The arm of junction n that traffic arrives along, coming from node `from` (or from a
  // point / direction).
  armFrom(n, from) {
    const c = this.control.get(n);
    if (!c) return null;
    const exact = c.arms.find((a) => a.m === from);
    if (exact) return exact;
    if (!from) return null;
    const dx = from.x - n.x;
    const dz = from.z - n.z;
    const L = Math.hypot(dx, dz) || 1;
    let best = null;
    let bd = -2;
    for (const a of c.arms) {
      const d = (a.ux * dx + a.uz * dz) / L;
      if (d > bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  // Phase group for traffic moving in direction (ux, uz) through n: 'NS' or 'EW'.
  axisOf(n, ux, uz) {
    const c = this.control.get(n);
    if (!c) return 'NS';
    // The arm it's coming in along points back the way it came.
    let best = null;
    let bd = -2;
    for (const a of c.arms) {
      const d = -(a.ux * ux + a.uz * uz);
      if (d > bd) {
        bd = d;
        best = a;
      }
    }
    return best && best.group === 1 ? 'EW' : 'NS';
  }

  // Signal phase for an axis ('NS' or 'EW') at a node: 'green' | 'yellow' | 'red'.
  phase(n, axis) {
    const c = this.control.get(n);
    if (!c || c.type !== 'signal') return 'green';
    const t = (this.t + c.offset) % CYCLE;
    const ns = t < GREEN ? 'green' : t < GREEN + YELLOW ? 'yellow' : 'red';
    const t2 = t - (GREEN + YELLOW + ALLRED);
    const ew = t2 >= 0 && t2 < GREEN ? 'green' : t2 >= GREEN && t2 < GREEN + YELLOW ? 'yellow' : 'red';
    return axis === 'NS' ? ns : ew;
  }

  typeAt(n) {
    return this.control.get(n)?.type || 'none';
  }

  // Must traffic arriving from `from` stop at n (sign or signal)?
  mustStop(n, from) {
    const a = this.armFrom(n, from);
    return !!a && a.stop;
  }

  // How far before the middle of n traffic arriving from `from` stops.
  stopDist(n, from) {
    const a = this.armFrom(n, from);
    return a ? a.stopAt : 10;
  }

  // Pedestrians on a crosswalk at a signal walk with the traffic going the same way.
  // (Only start across with at least 6 seconds of green left.)
  canWalk(n, axis) {
    if (this.typeAt(n) !== 'signal') return true;
    return this.phase(n, axis) === 'green' && this.greenLeft(n, axis) > 6;
  }

  greenLeft(n, axis) {
    const c = this.control.get(n);
    const t = (this.t + c.offset) % CYCLE;
    const start = axis === 'NS' ? 0 : GREEN + YELLOW + ALLRED;
    return start + GREEN - t;
  }

  // The junction nearest a point (within 40 m).
  nodeNear(x, z) {
    const n = this.game.city.nearestNode(x, z, (q) => q.street);
    return n && Math.hypot(n.x - x, n.z - z) < 40 ? n : null;
  }

  // ---- Meshes (all instanced: a few draw calls for the whole city) ----
  build() {
    const scene = this.scene;
    const city = this.game.city;
    const gy = (x, z) => city.groundY(x, z);
    const dummy = new THREE.Object3D();
    const place = (mesh, list) => {
      list.forEach(([x, y, z, ry, sx = 1, sy = 1, sz = 1], k) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      return mesh;
    };
    const lines = [];
    const signPoles = [];
    const signs = [];
    const yields = [];
    const sigPoles = [];
    const mastPoles = [];
    const arms = [];
    const mastLamps = [];
    const walks = [];
    const sigHeads = [];
    const lamps = { red: [], yellow: [], green: [] };
    this.lampRefs = []; // [node, axis, color, index]
    this.poleStats = { total: 0, moved: 0, skipped: 0 };
    this.junctionPoles = new Map(); // node -> the sign and signal poles there
    // In a roadway (any street's pavement, with a little room)?
    // (out on the hills the roads are strips that flare a little at bends and junctions: more room)
    const inRoad = (x, z, pad) => edgesNear(x, z, city.heightAt(x, z) > 0.05 ? pad + 1.6 : pad).length > 0 || !!this.game.highway?.surfacesAt(x, z, 0.8).some((o) => o.h < 2.5);
    // A point d meters out from junction n along arm a, following the street around its bends
    // (through curve points), with the street's direction there. Null past the next junction.
    const along = (n, a, d) => {
      let p = n;
      let q = a.m;
      for (let guard = 0; guard < 12; guard++) {
        const L = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const ux = (q.x - p.x) / L;
        const uz = (q.z - p.z) / L;
        if (d <= L - (q.edges && q.edges.length > 2 ? 3 : 0)) return { x: p.x + ux * d, z: p.z + uz * d, ux, uz };
        if (!q.edges || q.edges.length !== 2) return null; // (reached the next junction or a dead end)
        d -= L;
        const e = q.edges.find((e) => e.other(q) !== p);
        p = q;
        q = e.other(q);
      }
      return null;
    };
    const poleSpot = (n, a, w) => {
      // Out from the stop line first; then (a short street) a bit in toward the junction.
      const tries = [];
      for (let k = 0; k <= 8; k++) tries.push(a.stopAt + 0.6 + k * 1.5);
      for (let k = 1; k <= 8; k++) tries.push(a.stopAt + 0.6 - k * 1.5);
      for (const [k, d] of tries.entries()) {
        if (d < 4) break;
        const pt = along(n, a, d);
        if (!pt) continue;
        // (traffic heads toward n, so its right is to the left of the outward direction)
        const px = pt.x + pt.uz * (w / 2 + 0.7);
        const pz = pt.z - pt.ux * (w / 2 + 0.7);
        if (!inRoad(px, pz, 0.4)) return { p: [px, pz], moved: k > 0 };
      }
      return null;
    };
    for (const n of this.nodes) {
      const ctl = this.control.get(n);
      if (!ctl || ctl.type === 'none') continue;
      for (const a of ctl.arms) {
        if (!a.stop) continue;
        const w = a.e.w;
        // Traffic coming in along this arm heads toward the node: u = -arm direction.
        const ux = -a.ux;
        const uz = -a.uz;
        const rx = -uz;
        const rz = ux; // right of travel
        const axis = a.group === 1 ? 'EW' : 'NS';
        const lp = along(n, a, a.stopAt);
        if (lp) {
          const lx = lp.x + lp.uz * (w / 4);
          const lz = lp.z - lp.ux * (w / 4);
          lines.push([lx, city.roadY(lx, lz) + 0.01, lz, Math.atan2(-lp.ux, -lp.uz), (w / 2 - 0.6) / 7.4, 1, 1]); // (across the lanes coming in)
        }
        // Pole on the right-hand curb, facing oncoming drivers. It must stand clear of every
        // road (a short block or an angled junction can put the plain spot in another street):
        // slide it back along the curb until it's clear, or leave it out.
        // Traffic lights and stop signs both stand on the near side, on the right-hand corner
        // just behind the stop line, so each approach has its own light on its own corner.
        let spot = null;
        spot ||= poleSpot(n, a, w);
        this.poleStats.total++;
        if (!spot) {
          this.poleStats.skipped++;
          continue;
        }
        if (spot.moved) this.poleStats.moved++;
        let [px, pz] = spot.p;
        const here = this.junctionPoles.get(n) || this.junctionPoles.set(n, []).get(n);
        // (two lights wanting the same corner share one pole, a head facing each way)
        const share = here.find((q) => q.type === ctl.type && Math.hypot(q.x - px, q.z - pz) < 1.8);
        if (share) [px, pz] = [share.x, share.z];
        const y = gy(px, pz);
        if (!share) here.push({ x: px, z: pz, y, type: ctl.type });
        const face = Math.atan2(a.ux, a.uz); // the face points back toward the driver
        if (ctl.type === 'stop') {
          if (share) continue; // (one stop sign per corner)
          signPoles.push([px, y + 1.45, pz, 0]);
          (ctl.yield ? yields : signs).push([px, y + 2.55, pz, face]); // (a roundabout: give way)
          city.colliders.push({ minX: px - 0.12, maxX: px + 0.12, minZ: pz - 0.12, maxZ: pz + 0.12, h: y + 2.9 });
        } else {
          // A mast arm: a tall pole on the corner with an arm out over the lanes coming in, a
          // light hanging over each lane, one more on the pole at eye level, a walk signal for
          // people crossing, and a street light on top.
          const fx = Math.sin(face) * 0.24;
          const fz = Math.cos(face) * 0.24;
          const head = (hx, hy, hz) => {
            sigHeads.push([hx, hy, hz, face]);
            [['red', 0.45], ['yellow', 0], ['green', -0.45]].forEach(([col, dy]) => {
              this.lampRefs.push([n, axis, col, lamps[col].length]);
              lamps[col].push([hx + fx, hy + dy, hz + fz, face]);
            });
          };
          // (the arm reaches in from the curb, over this side's lanes, to near the middle)
          const reach = w / 2 + 0.7 - 0.8;
          const ax = -rx;
          const az = -rz;
          if (!share) {
            mastPoles.push([px, y + 3.9, pz, 0]);
            arms.push([px + ax * (reach / 2), y + 6.6, pz + az * (reach / 2), Math.atan2(ax, az), 1, 1, reach]);
            mastLamps.push([px, y + 7.9, pz, Math.atan2(ax, az)]);
            walks.push([px + ax * 0.25, y + 2.5, pz + az * 0.25, Math.atan2(ax, az)]); // (facing across the road, for people crossing it)
            city.colliders.push({ minX: px - 0.2, maxX: px + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2, h: y + 8 });
          }
          // over the lanes: at the travel lane and, on a wide road, the inner lane too
          const offs = [w / 2 + 0.7 - a.e.lane];
          if (w >= 16) offs.push(w / 2 + 0.7 - a.e.lane * 0.25);
          for (const o of offs) head(px + ax * o, y + 5.9, pz + az * o);
          head(px + ux * 0.3, y + 3.5, pz + uz * 0.3); // (on the pole)
        }
      }
    }
    const lineGeo = new THREE.PlaneGeometry(7.4, 0.45);
    lineGeo.rotateX(-Math.PI / 2);
    place(new THREE.InstancedMesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }), lines.length), lines);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 6), poleMat, signPoles.length), signPoles);
    const oct = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8);
    oct.rotateX(Math.PI / 2);
    oct.rotateZ(Math.PI / 8);
    const signMat = new THREE.MeshLambertMaterial({ color: 0xc0392b, emissive: 0x200000 });
    place(new THREE.InstancedMesh(oct, signMat, signs.length), signs);
    // Give way: a red triangle, point down.
    const tri = new THREE.CylinderGeometry(0.55, 0.55, 0.04, 3);
    tri.rotateX(Math.PI / 2);
    tri.rotateZ(-Math.PI / 2);
    place(new THREE.InstancedMesh(tri, signMat, Math.max(1, yields.length)), yields).count = yields.length;
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x2c3e50 }), sigPoles.length), sigPoles);
    // Mast arms: galvanized poles, arms, the street light on top, walk signals.
    const steel = new THREE.MeshLambertMaterial({ color: 0xa9adb3 });
    const many = (geo, mat, list) => {
      const m = place(new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), list);
      m.count = list.length;
      return m;
    };
    many(new THREE.CylinderGeometry(0.16, 0.2, 7.8, 8), steel, mastPoles);
    const armGeo = new THREE.CylinderGeometry(0.09, 0.11, 1, 6);
    armGeo.rotateX(Math.PI / 2); // (along local z; scaled to the arm's length)
    many(armGeo, steel, arms);
    const lampArm = new THREE.BoxGeometry(0.08, 0.08, 2.2);
    lampArm.translate(0, 0, 1.1);
    many(lampArm, steel, mastLamps);
    const lampHead = new THREE.BoxGeometry(0.35, 0.12, 0.7);
    lampHead.translate(0, -0.08, 2.2);
    many(lampHead, new THREE.MeshLambertMaterial({ color: 0x5b6067, emissive: 0x2a2416 }), mastLamps);
    const walkBox = new THREE.BoxGeometry(0.4, 0.4, 0.22);
    many(walkBox, new THREE.MeshLambertMaterial({ color: 0x1b1f24 }), walks);
    const hand = new THREE.PlaneGeometry(0.26, 0.26);
    hand.translate(0, 0, 0.12);
    many(hand, new THREE.MeshBasicMaterial({ color: 0xff6a1a }), walks);
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.45, 0.4), new THREE.MeshLambertMaterial({ color: 0x1b1f24 }), sigHeads.length), sigHeads);
    const lampGeo = new THREE.CircleGeometry(0.16, 12);
    this.lampMeshes = {};
    for (const col of ['red', 'yellow', 'green']) {
      const m = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lamps[col].length));
      m.count = lamps[col].length;
      place(m, lamps[col]);
      this.lampMeshes[col] = m;
    }
    this.on = { red: new THREE.Color(0xff2a1a), yellow: new THREE.Color(0xffc21a), green: new THREE.Color(0x2bff6a) };
    this.off = { red: new THREE.Color(0x3a0d0a), yellow: new THREE.Color(0x3a300a), green: new THREE.Color(0x0a3a18) };
    this.paintSignals(true);
    this.placedPoles = [...signPoles, ...sigPoles, ...mastPoles];
    this.buildNameSigns(place);
    this.buildStreetLights(place);
    this.placed = { stopLines: lines, signPoles, signs, sigPoles: [...sigPoles, ...mastPoles], sigHeads }; // (for checks and tests)
  }

  // Street name signs: green blades on the corner pole at each junction (the stop sign or the
  // traffic light), one per street, each running along the street it names.
  buildNameSigns(place) {
    const blades = []; // [x, y, z, dirx, dirz, name]
    const extra = []; // pole extensions above stop signs
    for (const [n, poles] of this.junctionPoles) {
      const pole = poles[0];
      if (!pole) continue;
      const named = new Map();
      for (const e of n.edges) {
        const nm = e.street?.name;
        if (!nm || e.street?.stub !== undefined) continue;
        const prev = named.get(nm);
        if (!prev || e.rank > prev.rank) named.set(nm, e);
      }
      const list = [...named.values()].sort((p, q) => q.rank - p.rank).slice(0, 2);
      if (!list.length) continue;
      const base = pole.type === 'stop' ? 3.05 : 4.5; // (on a mast pole: above its light)
      if (pole.type === 'stop') extra.push([pole.x, pole.y + 3.3, pole.z, 0]);
      list.forEach((e, k) => {
        const m = e.other(n);
        const L = Math.hypot(m.x - n.x, m.z - n.z) || 1;
        blades.push([pole.x, pole.y + base + k * 0.24, pole.z, (m.x - n.x) / L, (m.z - n.z) / L, e.street.name]);
      });
    }
    if (!blades.length) return;
    // One picture with every name on it.
    const names = [...new Set(blades.map((b) => b[5]))];
    const CW = 512;
    const CH = 64;
    const cols = 4;
    const rows = Math.ceil(names.length / cols);
    const cv = document.createElement('canvas');
    cv.width = CW * cols;
    cv.height = CH * rows;
    const g = cv.getContext('2d');
    names.forEach((nm, i) => {
      const x = (i % cols) * CW;
      const y = Math.floor(i / cols) * CH;
      g.fillStyle = '#1d6b3a';
      g.fillRect(x, y, CW, CH);
      g.strokeStyle = '#e8f2ea';
      g.lineWidth = 4;
      g.strokeRect(x + 4, y + 4, CW - 8, CH - 8);
      g.fillStyle = '#ffffff';
      g.font = 'bold 38px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(nm.toUpperCase(), x + CW / 2, y + CH / 2 + 2, CW - 30);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const pos = [];
    const uv = [];
    const W = 2.1;
    const Hh = 0.27;
    for (const [x, y, z, dx, dz, nm] of blades) {
      const i = names.indexOf(nm);
      const u0 = (i % cols) / cols;
      const u1 = u0 + 1 / cols;
      const v1 = 1 - Math.floor(i / cols) / rows;
      const v0 = v1 - 1 / rows;
      const ax = x - (dx * W) / 2;
      const az = z - (dz * W) / 2;
      const bx = x + (dx * W) / 2;
      const bz = z + (dz * W) / 2;
      // Front (one side) and back (the other, so it reads the right way round from there too).
      const quad = (p, q, flip) => {
        const [pa, pb] = flip ? [q, p] : [p, q];
        pos.push(pa[0], y - Hh / 2, pa[1], pb[0], y - Hh / 2, pb[1], pb[0], y + Hh / 2, pb[1]);
        pos.push(pa[0], y - Hh / 2, pa[1], pb[0], y + Hh / 2, pb[1], pa[0], y + Hh / 2, pa[1]);
        uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      };
      quad([ax, az], [bx, bz], false);
      quad([ax, az], [bx, bz], true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex })));
    if (extra.length) place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }), extra.length), extra);
    this.nameBlades = blades.length;
  }

  // Street lights: poles on the outer edge of the sidewalks, along every side of every block.
  buildStreetLights(place) {
    const city = this.game.city;
    const posts = [];
    const heads = [];
    const allPoles = [...(this.placedPoles || [])];
    const pools = [];
    for (const b of city.blocks) {
      if (b.type === 'ramps' || b.type === 'place') continue;
      for (const s of b.sides) {
        if (s.len < 14 || !s.cls || s.cls === 'under') continue; // (no lamp posts up into the freeway deck)
        const n = s.len > 45 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? s.len / 2 : s.len * (k === 0 ? 0.3 : 0.7);
          // A little inside the curb (lots up in the Heights have no curb: by the road edge).
          const inset = b.lot ? -0.8 : 0.5;
          const x = s.ax + s.ux * t - s.nx * inset;
          const z = s.az + s.uz * t - s.nz * inset;
          if (city.blockAt(x, z) && b.lot) continue;
          // Not right up against a sign or signal pole.
          if (allPoles.some((q) => Math.abs(q[0] - x) < 2.2 && Math.abs(q[2] - z) < 2.2)) continue;
          // Never out in a road, on a ramp, or in the ramp land at an interchange.
          if (edgesNear(x, z, 0.3).length || inHole(x, z, 2) || this.game.highway?.surfacesAt(x, z, 0.8).some((o) => o.h < 2.5)) continue;
          const y = city.groundY(x, z);
          posts.push([x, y + 3.2, z, 0]);
          heads.push([x + s.nx * 1.1, y + 6.35, z + s.nz * 1.1, Math.atan2(s.nx, s.nz)]);
          pools.push([x + s.nx * 1.6, city.groundY(x + s.nx * 2, z + s.nz * 2) + 0.04, z + s.nz * 1.6, 0]);
          city.colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12, h: y + 6.4 });
        }
      }
    }
    this.lampPosts = posts;
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 6), new THREE.MeshLambertMaterial({ color: 0x3d4247 }), posts.length), posts);
    this.lampMat = new THREE.MeshLambertMaterial({ color: 0x55595e, emissive: 0x000000 });
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.14, 2.3), this.lampMat, heads.length), heads);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const poolGeo = new THREE.PlaneGeometry(9, 9);
    poolGeo.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0xffe6b8, map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.pools = place(new THREE.InstancedMesh(poolGeo, this.poolMat, pools.length), pools);
    this.pools.visible = false;
    this.pools.renderOrder = 1;
  }

  // Night (0 = day, 1 = night): street lights on.
  setNight(k) {
    this.lampMat.emissive.setRGB(1.0 * k, 0.82 * k, 0.55 * k);
    this.poolMat.opacity = 0.32 * k;
    this.pools.visible = k > 0.02;
  }

  paintSignals(force = false) {
    let changed = force;
    for (const [n, axis, col, k] of this.lampRefs) {
      const lit = this.phase(n, axis) === col;
      const key = `${lit}`;
      const mesh = this.lampMeshes[col];
      if (!mesh.userData.state) mesh.userData.state = [];
      if (mesh.userData.state[k] === key) continue;
      mesh.userData.state[k] = key;
      mesh.setColorAt(k, lit ? this.on[col] : this.off[col]);
      changed = true;
    }
    if (changed) for (const m of Object.values(this.lampMeshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    this.paintT = (this.paintT || 0) - dt;
    if (this.paintT <= 0) {
      this.paintT = 0.2;
      this.paintSignals();
    }
  }
}

// Default stop distance (for callers without a junction at hand).
export const STOP_LINE = 12.2;
