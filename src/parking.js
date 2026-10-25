import * as THREE from 'three';
import { CFG } from './config.js';
import { Vehicle, VTYPES } from './vehicle.js';
import { mulberry32, dist } from './util.js';
import { GFX } from './quality.js';

// Cars parked along the curbs. Most streets have some, more in the residential parts of town
// (the Heights, Midtown, the Projects, the Strip) and few in the business districts and at
// the Docks. None near the corners, bus stops or the places you spawn.
// Far away they're cheap stand-ins (a few instanced meshes for the whole city); within
// MATERIAL meters of you each one turns into a real car you can hit, push, shoot or steal.
// Once you're well away again an untouched one goes back to being a stand-in; one that got
// moved or wrecked leaves an empty space that fills again later.
const P = CFG.PITCH;
const R = CFG.ROAD;
const CURB = R / 2 - 1.15; // car center: just inside the curb
const MATERIAL = 28;
const RELEASE = 45;
const SHOW = GFX.parkedShow; // stand-ins are drawn this far out (less on phones)
const DENSITY = {
  Downtown: 0.35,
  'Financial District': 0.2,
  'Government District': 0.2,
  'The Heights': 0.5,
  Midtown: 0.45,
  'The Projects': 0.45,
  'The Strip': 0.45,
  'The Docks': 0.15,
};

export class Parking {
  constructor(game) {
    this.game = game;
    this.spots = [];
    this.built = null;
    this.makeSpots();
    this.makeMeshes();
    this.refresh(true);
  }

  makeSpots() {
    const game = this.game;
    const city = game.city;
    const rng = mulberry32(4242);
    const avoid = [city.spawn, city.station, city.hospital, city.chop, city.gangHome, city.crewHome]
      .filter(Boolean).map((p) => [p.x, p.z]);
    for (const s of game.transit?.stops || []) avoid.push([s.x, s.z]);
    for (const a of city.nodes) {
      for (const b of a.nb) {
        if (b.i < a.i || b.j < a.j) continue; // each street once
        const L = dist(a.x, a.z, b.x, b.z);
        const ux = (b.x - a.x) / L;
        const uz = (b.z - a.z) / L;
        for (const side of [1, -1]) {
          const px = -uz * side;
          const pz = ux * side;
          const blk = city.blockAt((a.x + b.x) / 2 + px * 9, (a.z + b.z) / 2 + pz * 9);
          if (!blk) continue; // the outside of the edge roads
          const dens = (blk.type === 'park' ? 0.3 : DENSITY[blk.district] ?? 0.3);
          // Cars on the right-hand side face the way that lane goes.
          const heading = side === 1 ? Math.atan2(ux, uz) : Math.atan2(-ux, -uz);
          for (let t = 20; t <= L - 20; t += 6.6) {
            if (rng() > dens) continue;
            const x = a.x + ux * t + px * CURB;
            const z = a.z + uz * t + pz * CURB;
            if (avoid.some(([qx, qz]) => dist(qx, qz, x, z) < 14)) continue;
            const r = rng();
            const posh = blk.district === 'The Heights' || blk.district === 'Financial District';
            const busy = ['Downtown', 'The Strip', 'Midtown'].includes(blk.district);
            const type = r < (posh ? 0.3 : 0.1) ? 'sports' : r < (posh ? 0.4 : 0.25) ? 'van' : busy && r > 0.93 ? 'taxi' : 'sedan';
            const cols = VTYPES[type].colors;
            const color = cols[Math.floor(rng() * cols.length)];
            this.spots.push({ x, z, heading, type, color, car: null, gone: -1, idx: -1 });
          }
        }
      }
    }
  }

  makeMeshes() {
    const MAX = 900;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8);
    wheel.rotateZ(Math.PI / 2);
    const body = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX);
    const cab = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0x1d2630 }), MAX);
    const wheels = new THREE.InstancedMesh(wheel, new THREE.MeshLambertMaterial({ color: 0x151515 }), MAX * 4);
    body.castShadow = true;
    cab.castShadow = true;
    for (const m of [body, cab, wheels]) {
      m.count = 0;
      m.frustumCulled = false;
      this.game.scene.add(m);
    }
    this.mesh = { body, cab, wheels, MAX };
  }

  // Which stand-ins to draw, around where you are now.
  refresh(force = false) {
    const [px, pz] = this.game.player.pos();
    if (!force && this.built && dist(px, pz, this.built[0], this.built[1]) < 30) return;
    this.built = [px, pz];
    const { body, cab, wheels, MAX } = this.mesh;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let n = 0;
    for (const s of this.spots) s.idx = -1;
    for (const s of this.spots) {
      if (n >= MAX) break;
      if (s.car || s.gone >= 0) continue;
      if (Math.abs(s.x - px) > SHOW || Math.abs(s.z - pz) > SHOW) continue;
      const t = VTYPES[s.type];
      q.setFromAxisAngle(up, s.heading);
      sc.set(t.w, t.h, t.l);
      v.set(s.x, 0.35 + t.h / 2, s.z);
      body.setMatrixAt(n, m4.compose(v, q, sc));
      body.setColorAt(n, col.setHex(s.color));
      if (t.cab) {
        const [cw, ch, cl, cz] = t.cab;
        sc.set(cw, ch, cl);
        v.set(s.x + Math.sin(s.heading) * cz, 0.35 + t.h + ch / 2, s.z + Math.cos(s.heading) * cz);
      } else {
        // Vans: a windshield band across the front.
        sc.set(t.w * 0.86, 0.6, 0.1);
        const f = t.l / 2 + 0.02;
        v.set(s.x + Math.sin(s.heading) * f, 0.35 + t.h - 0.45, s.z + Math.cos(s.heading) * f);
      }
      cab.setMatrixAt(n, m4.compose(v, q, sc));
      sc.set(1, 1, 1);
      let k = 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * (t.w / 2 - 0.02);
          const lz = sz * (t.l / 2 - 0.85);
          const c = Math.cos(s.heading);
          const si = Math.sin(s.heading);
          v.set(s.x + lx * c + lz * si, 0.38, s.z - lx * si + lz * c);
          wheels.setMatrixAt(n * 4 + k++, m4.compose(v, q, sc));
        }
      }
      s.idx = n++;
    }
    body.count = cab.count = n;
    wheels.count = n * 4;
    body.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    cab.instanceMatrix.needsUpdate = true;
    wheels.instanceMatrix.needsUpdate = true;
  }

  // Hide one stand-in (its real car is out).
  hide(s) {
    if (s.idx < 0) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const { body, cab, wheels } = this.mesh;
    body.setMatrixAt(s.idx, zero);
    cab.setMatrixAt(s.idx, zero);
    for (let k = 0; k < 4; k++) wheels.setMatrixAt(s.idx * 4 + k, zero);
    body.instanceMatrix.needsUpdate = true;
    cab.instanceMatrix.needsUpdate = true;
    wheels.instanceMatrix.needsUpdate = true;
    s.idx = -1;
  }

  update(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    this.refresh();
    let changed = false;
    for (const s of this.spots) {
      if (Math.abs(s.x - px) > RELEASE + 10 || Math.abs(s.z - pz) > RELEASE + 10) {
        if (!s.car) {
          // An empty space fills up again after a while (out of sight).
          if (s.gone >= 0 && game.time - s.gone > 240 && dist(s.x, s.z, px, pz) > 200) {
            s.gone = -1;
            changed = true;
          }
          continue;
        }
      }
      const d = dist(s.x, s.z, px, pz);
      if (!s.car && s.gone < 0 && d < MATERIAL) {
        // Close up: a real car.
        const v = new Vehicle(game.scene, s.type, s.x, s.z, s.heading, s.color);
        v.parkSpot = s;
        game.vehicles.push(v);
        s.car = v;
        this.hide(s);
        continue;
      }
      if (s.car) {
        const v = s.car;
        const moved = dist(v.x, v.z, s.x, s.z) > 1.5 || v.driver || v.wrecked || v.removed || v.health < 70;
        if (moved) {
          // Taken, pushed off its spot or smashed up: it's just a car now, and the space is empty.
          v.parkSpot = null;
          s.car = null;
          s.gone = game.time;
          continue;
        }
        if (d > RELEASE) {
          v.dispose();
          s.car = null;
          changed = true;
        }
      }
    }
    if (changed) this.refresh(true);
  }
}
