import * as THREE from 'three';
import { CFG } from './config.js';
import { Vehicle, VTYPES } from './vehicle.js';
import { carModel, trimMat } from './carmodels.js';
import { mulberry32, dist } from './util.js';
import { GFX } from './quality.js';
import { STUBS, inHole } from './fwyplan.js';

// Cars parked along the curbs. Most streets have some, more in the residential parts of town
// (the Heights, Midtown, the Projects, the Strip) and few in the business districts and at
// the Docks. None near the corners, bus stops or the places you spawn.
// Far away they're cheap stand-ins (a few instanced meshes for the whole city); within
// MATERIAL meters of you each one turns into a real car you can hit, push, shoot or steal.
// Once you're well away again an untouched one goes back to being a stand-in; one that got
// moved or wrecked leaves an empty space that fills again later.
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
    for (const s of STUBS) avoid.push(s[0]);
    for (const e of city.edges) {
      if (!e.street || !['arterial', 'collector'].includes(e.cls)) continue;
      const { a, b } = e;
      const L = dist(a.x, a.z, b.x, b.z);
      if (L < 40) continue;
      const ux = (b.x - a.x) / L;
      const uz = (b.z - a.z) / L;
      const curb = e.w / 2 - 1.4; // car center: in the parking shoulder, just inside the curb
      for (const side of [1, -1]) {
        const px = -uz * side;
        const pz = ux * side;
        const blk = city.blockAt((a.x + b.x) / 2 + px * (e.w / 2 + 3), (a.z + b.z) / 2 + pz * (e.w / 2 + 3));
        if (!blk || blk.type === 'ramps' || blk.lot) continue;
        const dens = (blk.type === 'park' ? 0.3 : DENSITY[blk.district] ?? 0.3);
        // Cars on the right-hand side face the way that lane goes.
        const heading = side === 1 ? Math.atan2(ux, uz) : Math.atan2(-ux, -uz);
        for (let t = 20; t <= L - 20; t += 6.6) {
          if (rng() > dens) continue;
          const x = a.x + ux * t + px * curb;
          const z = a.z + uz * t + pz * curb;
          if (avoid.some(([qx, qz]) => dist(qx, qz, x, z) < 14)) continue;
          if (inHole(x, z, 4)) continue;
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
    // (and the parking lots - by the court, the field, the park: about half the spaces taken)
    for (const sp of [...(city.court?.spots || []), ...(city.footballField?.spots || []), ...(city.lots?.spots || [])]) {
      if (rng() > 0.55) continue;
      const r = rng();
      const type = r < 0.12 ? 'sports' : r < 0.3 ? 'van' : 'sedan';
      const cols = VTYPES[type].colors;
      this.spots.push({ x: sp.x, z: sp.z, heading: sp.heading, type, color: cols[Math.floor(rng() * cols.length)], car: null, gone: -1, idx: -1 });
    }
  }

  // One pair of instanced meshes per type (src/carmodels.js: the body in each car's color, the
  // rest in one piece), as many as there are spots of that type.
  makeMeshes() {
    this.mesh = {};
    const counts = {};
    for (const s of this.spots) counts[s.type] = (counts[s.type] || 0) + 1;
    for (const [type, n] of Object.entries(counts)) {
      const M = carModel(type, VTYPES[type]);
      const MAX = Math.min(n, 900);
      const paint = new THREE.InstancedMesh(M.standin.paint, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX);
      const rest = new THREE.InstancedMesh(M.standin.rest, trimMat, MAX);
      paint.castShadow = true;
      rest.castShadow = true;
      for (const m of [paint, rest]) {
        m.count = 0;
        m.frustumCulled = false;
        this.game.scene.add(m);
      }
      this.mesh[type] = { paint, rest, MAX, n: 0 };
    }
  }

  // Which stand-ins to draw, around where you are now.
  refresh(force = false) {
    const [px, pz] = this.game.player.pos();
    if (!force && this.built && dist(px, pz, this.built[0], this.built[1]) < 30) return;
    this.built = [px, pz];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const M of Object.values(this.mesh)) M.n = 0;
    for (const s of this.spots) {
      s.idx = -1;
      if (s.car || s.gone >= 0) continue;
      if (Math.abs(s.x - px) > SHOW || Math.abs(s.z - pz) > SHOW) continue;
      const M = this.mesh[s.type];
      if (!M || M.n >= M.MAX) continue;
      q.setFromAxisAngle(up, s.heading);
      m4.compose(v.set(s.x, 0, s.z), q, one);
      M.paint.setMatrixAt(M.n, m4);
      M.rest.setMatrixAt(M.n, m4);
      M.paint.setColorAt(M.n, col.setHex(s.color));
      s.idx = M.n++;
    }
    for (const M of Object.values(this.mesh)) {
      M.paint.count = M.rest.count = M.n;
      M.paint.instanceMatrix.needsUpdate = true;
      M.rest.instanceMatrix.needsUpdate = true;
      if (M.paint.instanceColor) M.paint.instanceColor.needsUpdate = true;
    }
  }

  // Hide one stand-in (its real car is out).
  hide(s) {
    if (s.idx < 0) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const M = this.mesh[s.type];
    M.paint.setMatrixAt(s.idx, zero);
    M.rest.setMatrixAt(s.idx, zero);
    M.paint.instanceMatrix.needsUpdate = true;
    M.rest.instanceMatrix.needsUpdate = true;
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
