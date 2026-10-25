import * as THREE from 'three';
import { CFG } from './config.js';
import { districtOfBlock } from './districts.js';

// Street furniture and the rules of the road.
// - Traffic lights at the busy intersections (Downtown, the Financial and Government districts,
//   the Strip, and every third street in Midtown). Two phases: north-south, then east-west
//   (green 10 s, yellow 2.5 s, all-red 1 s), offset street to street so there's a green wave.
// - All-way stop signs everywhere else (and on the edge roads): stop at the line, then go when
//   the intersection is clear.
// - White stop lines on every approach, just before the crosswalk.
// - Street lights along every sidewalk (on at dusk, off at dawn — see daynight.js).
// Traffic (traffic.js) and pedestrians (peds.js) ask here what they're allowed to do.
const N = CFG.BLOCKS;
const P = CFG.PITCH;
const R = CFG.ROAD;
const GREEN = 10;
const YELLOW = 2.5;
const ALLRED = 1;
const CYCLE = 2 * (GREEN + YELLOW + ALLRED);
const STOP_AT = 11.2; // stop line: this far from the middle of the intersection
const ARMS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north, east, south, west (direction out of the node)

export class Streets {
  constructor(game) {
    this.game = game;
    const city = game.city;
    this.scene = game.scene;
    this.t = 0;
    this.nodes = city.nodes;
    // What controls each intersection.
    this.control = new Map(); // node -> { type, offset }
    for (const n of city.nodes) {
      const edge = n.i === 0 || n.j === 0 || n.i === N || n.j === N;
      const ds = [[n.i - 1, n.j - 1], [n.i, n.j - 1], [n.i - 1, n.j], [n.i, n.j]]
        .filter(([i, j]) => i >= 0 && j >= 0 && i < N && j < N).map(([i, j]) => districtOfBlock(i, j));
      const busy = ds.filter((d) => ['Downtown', 'Financial District', 'Government District', 'The Strip'].includes(d)).length >= 2
        || (ds.includes('Midtown') && (n.i % 3 === 0 || n.j % 3 === 0));
      this.control.set(n, { type: !edge && busy ? 'signal' : 'stop', offset: ((n.i + n.j) * 4) % CYCLE });
    }
    this.build();
  }

  // Signal phase for traffic moving along an axis ('NS' or 'EW') at a node: 'green' | 'yellow' | 'red'.
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
    return this.control.get(n)?.type || 'stop';
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

  nodeNear(x, z) {
    const i = Math.round(x / P);
    const j = Math.round(z / P);
    return this.game.city.nodeAt(i, j);
  }

  // ---- Meshes (all instanced: a few draw calls for the whole city) ----
  build() {
    const scene = this.scene;
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
      scene.add(mesh);
      return mesh;
    };
    const lines = [];
    const signPoles = [];
    const signs = [];
    const sigPoles = [];
    const sigHeads = [];
    const lamps = { red: [], yellow: [], green: [] };
    this.lampRefs = []; // [node, axis, color, index]
    for (const n of this.nodes) {
      const ctl = this.control.get(n);
      for (const [dx, dz] of ARMS) {
        const i2 = n.i + dx;
        const j2 = n.j + dz;
        if (i2 < 0 || j2 < 0 || i2 > N || j2 > N) continue; // no road that way
        // Traffic coming in along this arm drives toward the node, in the right-hand lane.
        const ux = -dx;
        const uz = -dz;
        const rx = -uz;
        const rz = ux; // right of travel
        const axis = dx !== 0 ? 'EW' : 'NS';
        const lx = n.x + dx * STOP_AT + rx * CFG.LANE;
        const lz = n.z + dz * STOP_AT + rz * CFG.LANE;
        lines.push([lx, 0.03, lz, Math.atan2(rx, rz), 1, 1, 1]);
        // Pole on the right-hand curb, facing oncoming drivers.
        const px = n.x + dx * (STOP_AT + 0.6) + rx * (R / 2 + 0.7);
        const pz = n.z + dz * (STOP_AT + 0.6) + rz * (R / 2 + 0.7);
        const face = Math.atan2(dx, dz); // the sign's face points back toward the driver
        if (ctl.type === 'stop') {
          signPoles.push([px, 1.45, pz, 0]);
          signs.push([px, 2.55, pz, face]);
          this.game.city.colliders.push({ minX: px - 0.12, maxX: px + 0.12, minZ: pz - 0.12, maxZ: pz + 0.12 });
        } else {
          sigPoles.push([px, 2.3, pz, 0]);
          sigHeads.push([px, 4.1, pz, face]);
          // Three lamps on the head, on the side facing traffic.
          const fx = Math.sin(face) * 0.24;
          const fz = Math.cos(face) * 0.24;
          [['red', 4.55], ['yellow', 4.1], ['green', 3.65]].forEach(([col, y]) => {
            this.lampRefs.push([n, axis, col, lamps[col].length]);
            lamps[col].push([px + fx, y, pz + fz, face]);
          });
          this.game.city.colliders.push({ minX: px - 0.15, maxX: px + 0.15, minZ: pz - 0.15, maxZ: pz + 0.15 });
        }
      }
    }
    // Stop lines.
    const lineGeo = new THREE.PlaneGeometry(R / 2 - 0.6, 0.45);
    lineGeo.rotateX(-Math.PI / 2);
    place(new THREE.InstancedMesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }), lines.length), lines);
    // Stop signs: a pole and a red octagon with a white rim.
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 6), poleMat, signPoles.length), signPoles);
    const oct = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8);
    oct.rotateX(Math.PI / 2);
    oct.rotateZ(Math.PI / 8);
    const signMat = new THREE.MeshLambertMaterial({ color: 0xc0392b, emissive: 0x200000 });
    place(new THREE.InstancedMesh(oct, signMat, signs.length), signs);
    // Traffic lights: pole, a dark head, and three lamps whose colors change.
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x2c3e50 }), sigPoles.length), sigPoles);
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.45, 0.4), new THREE.MeshLambertMaterial({ color: 0x1b1f24 }), sigHeads.length), sigHeads);
    const lampGeo = new THREE.CircleGeometry(0.16, 12);
    this.lampMeshes = {};
    for (const col of ['red', 'yellow', 'green']) {
      const m = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), lamps[col].length);
      place(m, lamps[col]);
      this.lampMeshes[col] = m;
    }
    this.on = { red: new THREE.Color(0xff2a1a), yellow: new THREE.Color(0xffc21a), green: new THREE.Color(0x2bff6a) };
    this.off = { red: new THREE.Color(0x3a0d0a), yellow: new THREE.Color(0x3a300a), green: new THREE.Color(0x0a3a18) };
    this.paintSignals(true);
    this.buildStreetLights(place);
  }

  // Street lights: a pole on the outer edge of every sidewalk, two per block side.
  buildStreetLights(place) {
    const city = this.game.city;
    const posts = [];
    const heads = [];
    const pools = [];
    for (const b of city.blocks) {
      const W = b.maxX - b.minX;
      for (const t of [W * 0.3, W * 0.7]) {
        // [x, z, direction the arm reaches out over the road]
        for (const [x, z, ax, az] of [
          [b.minX + t, b.minZ + 0.5, 0, -1], [b.minX + t, b.maxZ - 0.5, 0, 1],
          [b.minX + 0.5, b.minZ + t, -1, 0], [b.maxX - 0.5, b.minZ + t, 1, 0],
        ]) {
          posts.push([x, 0.2 + 3.2, z, 0]);
          heads.push([x + ax * 1.1, 0.2 + 6.35, z + az * 1.1, Math.atan2(ax, az)]);
          pools.push([x + ax * 1.6, 0.04, z + az * 1.6, 0]);
          city.colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12 });
        }
      }
    }
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 6), new THREE.MeshLambertMaterial({ color: 0x3d4247 }), posts.length), posts);
    // The arm and lamp: a box reaching out over the road (its underside glows at night).
    this.lampMat = new THREE.MeshLambertMaterial({ color: 0x55595e, emissive: 0x000000 });
    place(new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.14, 2.3), this.lampMat, heads.length), heads);
    // Pools of light on the ground (only show at night).
    // A soft glow that fades out from the middle.
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

export const STOP_LINE = STOP_AT;
