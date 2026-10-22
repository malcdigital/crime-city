import * as THREE from 'three';
import { CFG } from './config.js';
import { mulberry32 } from './util.js';
import { lam } from './character.js';

const { BLOCKS: N, BLOCK: B, ROAD: R, SIDEWALK: SW, PITCH: P, SIZE } = CFG;
export const roadC = (k) => k * P;

// Fixed special blocks, keyed by "i,j" block coordinates.
const SPECIAL = { '1,1': 'police', '6,5': 'chop', '5,6': 'hospital', '3,4': 'park', '5,1': 'park', '2,6': 'park' };
const STORES = {
  '0,3': 'Corner 24/7',
  '4,2': 'Liquor Barn',
  '6,7': 'Gas & Go',
  '2,0': 'Quick Mart',
  '7,2': 'Pawn King',
  '3,6': 'Late Nite Deli',
};

const AVENUES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave', '9th Ave'];
const STREETS = ['Grove St', 'Palm St', 'Market St', 'Union St', 'King St', 'Ocean St', 'Mill St', 'Bay St', 'Pine St'];

export function districtAt(x, z) {
  if (Math.hypot(x - SIZE / 2, z - SIZE / 2) < 150) return 'Downtown';
  if (x < SIZE / 2) return z < SIZE / 2 ? 'Hillcrest' : 'Southgate';
  return z < SIZE / 2 ? 'Eastside' : 'Harbor';
}

// Name of the nearest road, for news headlines.
export function streetAt(x, z) {
  const kx = Math.round(x / P);
  const kz = Math.round(z / P);
  const dx = Math.abs(x - kx * P);
  const dz = Math.abs(z - kz * P);
  if (dx < dz) return AVENUES[Math.max(0, Math.min(N, kx))];
  return STREETS[Math.max(0, Math.min(N, kz))];
}

function windowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      g.fillStyle = rng() < 0.22 ? '#f1dc9a' : '#566779';
      g.fillRect(i * 32 + 7, j * 32 + 6, 18, 20);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Box with window UVs scaled to its size, so windows stay the same size on every building.
function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const S = 12;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const idx = f * 4 + v;
      let u = uv.getX(idx);
      let vv = uv.getY(idx);
      if (f === 2 || f === 3) {
        u = 0.005;
        vv = 0.005; // roof and floor: plain wall color
      } else {
        u *= (f < 2 ? d : w) / S;
        vv *= h / S;
      }
      uv.setXY(idx, u, vv);
    }
  }
  return g;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = 'bold 60px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 490);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCity(scene) {
  const rng = mulberry32(1337);
  const rr = (a, b) => a + rng() * (b - a);
  const colliders = []; // everything solid
  const los = []; // tall things that block line of sight
  const blocks = [];
  const stores = [];
  let chop = null;
  let station = null;
  let hospital = null;

  const winTex = windowTexture(rng);
  const buildingMats = [0xc9c2b8, 0x9fb4c7, 0xb8a48c, 0x8e9aa6, 0xd6cfc4, 0x7d8a99, 0xa89f91, 0xb5aa9c].map(
    (c) => new THREE.MeshLambertMaterial({ color: c, map: winTex }),
  );

  // Ground: asphalt for the city, grass beyond.
  const groundSize = SIZE + R * 2 + 40;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), lam(0x2e2f33));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(SIZE / 2, 0, SIZE / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), lam(0x3d5a3a));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(SIZE / 2, -0.05, SIZE / 2);
  scene.add(grass);

  const building = (cx, cz, w, d, h, mat) => {
    const mesh = new THREE.Mesh(buildingGeo(w, h, d), mat);
    mesh.position.set(cx, 0.2 + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: h + 0.2 };
    colliders.push(box);
    los.push(box);
    return mesh;
  };

  const sign = (text, x, y, z, rotY, w, h, bg, fg = '#ffffff') => {
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    scene.add(p);
    return p;
  };

  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
  const crownGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const tree = (x, z) => {
    const t = new THREE.Mesh(trunkGeo, lam(0x5b3a1e));
    t.position.set(x, 1.7, z);
    t.castShadow = true;
    scene.add(t);
    const c = new THREE.Mesh(crownGeo, lam(0x2f6b2f));
    c.position.set(x, 4.2, z);
    c.castShadow = true;
    scene.add(c);
    colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
  };

  const alleyCover = [];
  const slabGeo = new THREE.BoxGeometry(B, 0.2, B);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const minX = roadC(i) + R / 2;
      const maxX = roadC(i + 1) - R / 2;
      const minZ = roadC(j) + R / 2;
      const maxZ = roadC(j + 1) - R / 2;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const key = `${i},${j}`;
      const type = SPECIAL[key] || (STORES[key] ? 'store' : 'normal');
      blocks.push({ i, j, minX, maxX, minZ, maxZ, cx, cz, type });

      const slab = new THREE.Mesh(slabGeo, lam(0x8d8d8a));
      slab.position.set(cx, 0.1, cz);
      slab.receiveShadow = true;
      scene.add(slab);

      const iMinX = minX + SW, iMaxX = maxX - SW, iMinZ = minZ + SW, iMaxZ = maxZ - SW;
      const tall = Math.max(0, 1 - Math.hypot(cx - SIZE / 2, cz - SIZE / 2) / 320);

      if (type === 'park') {
        const lawn = new THREE.Mesh(new THREE.BoxGeometry(B - SW * 2, 0.06, B - SW * 2), lam(0x4f7a3f));
        lawn.position.set(cx, 0.22, cz);
        lawn.receiveShadow = true;
        scene.add(lawn);
        for (let t = 0; t < 9; t++) tree(rr(iMinX + 3, iMaxX - 3), rr(iMinZ + 3, iMaxZ - 3));
      } else if (type === 'police') {
        const w = 40, d = 24, h = 14;
        const bz = iMaxZ - d / 2 - 1;
        building(cx, bz, w, d, h, new THREE.MeshLambertMaterial({ color: 0x3b5b8c, map: winTex }));
        sign('POLICE', cx, 10, bz - d / 2 - 0.06, Math.PI, 14, 2.6, '#1c2f5a');
        station = { x: cx, z: iMinZ + 8, heading: Math.PI, name: 'Central Precinct' };
      } else if (type === 'hospital') {
        const w = 40, d = 24, h = 16;
        const bz = iMaxZ - d / 2 - 1;
        building(cx, bz, w, d, h, new THREE.MeshLambertMaterial({ color: 0xeeeeee, map: winTex }));
        sign('HARBOR GENERAL HOSPITAL', cx, 11, bz - d / 2 - 0.06, Math.PI, 18, 2.4, '#b71c1c');
        hospital = { x: cx, z: iMinZ + 8, heading: Math.PI, name: 'Harbor General' };
      } else if (type === 'chop') {
        const w = 38, d = 22, h = 7;
        const bz = iMaxZ - d / 2 - 1;
        building(cx, bz, w, d, h, lam(0x6b5d4f));
        const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), lam(0x2a2a2a));
        door.position.set(cx, 2.7, bz - d / 2 - 0.05);
        door.rotation.y = Math.PI;
        scene.add(door);
        sign('CHOP SHOP', cx, 6.1, bz - d / 2 - 0.07, Math.PI, 12, 2.2, '#d35400');
        chop = { x: cx, z: iMinZ + 12, r: 7 };
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(6.2, 7, 40),
          new THREE.MeshBasicMaterial({ color: 0xf39c12, transparent: true, opacity: 0.7 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(chop.x, 0.25, chop.z);
        scene.add(ring);
      } else {
        const lots = [];
        if (type === 'normal' && rng() < 0.2) {
          lots.push({ qx: -1, qz: -1, x: cx, z: cz, w: rr(40, 52), d: rr(40, 52) });
        } else {
          // Alley mouths between the four buildings: room for a dumpster or some crates.
          const mid = 28;
          const mouths = [
            [iMinX + mid, iMinZ + 1.1, 'x'], [iMinX + mid, iMaxZ - 1.1, 'x'],
            [iMinX + 1.1, iMinZ + mid, 'z'], [iMaxX - 1.1, iMinZ + mid, 'z'],
          ];
          for (const m of mouths) if (rng() < 0.55) alleyCover.push([...m, rng()]);
          for (let qx = 0; qx < 2; qx++) {
            for (let qz = 0; qz < 2; qz++) {
              lots.push({ qx, qz, x: iMinX + 14 + qx * 28, z: iMinZ + 14 + qz * 28, w: rr(17, 25), d: rr(17, 25) });
            }
          }
        }
        for (const lot of lots) {
          if (type === 'store' && lot.qx === 0 && lot.qz === 0) {
            const w = 22, d = 16, h = 5;
            const front = iMinZ + 1;
            building(lot.x, front + d / 2, w, d, h, lam(0xe8d9b5));
            const name = STORES[key];
            const signMesh = sign(name.toUpperCase(), lot.x, 4.3, front - 0.06, Math.PI, 12, 1.8, '#27ae60');
            stores.push({ name, x: lot.x, z: minZ + SW / 2, r: 2.8, cooldown: 0, signMesh });
            continue;
          }
          const h = 8 + rng() * (14 + tall * 55);
          building(lot.x, lot.z, lot.w, lot.d, h, buildingMats[Math.floor(rng() * buildingMats.length)]);
        }
      }
    }
  }

  // Barriers around the edge of the city.
  const e0 = -R / 2 - 1.5;
  const e1 = SIZE + R / 2 + 1.5;
  const span = SIZE + R + 4;
  const barrierMat = lam(0xb0b0b0);
  for (const [x, z, w, d] of [
    [e0, SIZE / 2, 1, span],
    [e1, SIZE / 2, 1, span],
    [SIZE / 2, e0, span, 1],
    [SIZE / 2, e1, span, 1],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), barrierMat);
    m.position.set(x, 0.6, z);
    scene.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  // Dashed yellow center lines.
  const dashGeo = new THREE.PlaneGeometry(0.25, 3);
  dashGeo.rotateX(-Math.PI / 2);
  const dashes = [];
  for (let k = 0; k <= N; k++) {
    for (let j = 0; j < N; j++) {
      for (let t = roadC(j) + R / 2 + 3; t < roadC(j + 1) - R / 2 - 2; t += 6) {
        dashes.push([roadC(k), t, 0]);
        dashes.push([t, roadC(k), Math.PI / 2]);
      }
    }
  }
  const dashMesh = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xd9c45a }), dashes.length);
  const dummy = new THREE.Object3D();
  dashes.forEach(([x, z, ry], idx) => {
    dummy.position.set(x, 0.02, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    dashMesh.setMatrixAt(idx, dummy.matrix);
  });
  scene.add(dashMesh);

  // Road graph: intersections and their neighbors.
  const nodes = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) nodes.push({ i, j, x: roadC(i), z: roadC(j), nb: [] });
  const nodeAt = (i, j) => (i < 0 || j < 0 || i > N || j > N ? null : nodes[i * (N + 1) + j]);
  for (const n of nodes) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = nodeAt(n.i + di, n.j + dj);
      if (m) n.nb.push(m);
    }
  }
  const nearestNode = (x, z) => nodeAt(Math.round(Math.max(0, Math.min(SIZE, x)) / P), Math.round(Math.max(0, Math.min(SIZE, z)) / P));

  const blockAt = (x, z) => {
    const i = Math.floor(x / P);
    const j = Math.floor(z / P);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const b = blocks[i * N + j];
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ ? b : null;
  };
  const groundY = (x, z) => (blockAt(x, z) ? 0.2 : 0);

  // Static minimap background.
  const drawMap = (ctx, px) => {
    const s = px / (SIZE + R * 2);
    const o = R;
    ctx.fillStyle = '#26402a';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#7d8086';
    ctx.fillRect((0 - R / 2 + o) * s, (0 - R / 2 + o) * s, (SIZE + R) * s, (SIZE + R) * s);
    const colors = { normal: '#2f3439', store: '#2f3439', park: '#3f6b35', police: '#244a8a', chop: '#8a4a12', hospital: '#8a2a2a' };
    for (const b of blocks) {
      ctx.fillStyle = colors[b.type];
      ctx.fillRect((b.minX + o) * s, (b.minZ + o) * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    }
  };

  // Low cover (crates, dumpsters, benches): blocks bullets below its height.
  const crates = [];
  const addCover = (x, z, w, d, h, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
    m.position.set(x, 0.2 + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const box = { x, z, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h + 0.2 };
    colliders.push(box);
    crates.push(box);
  };

  for (const [x, z, axis, r] of alleyCover) {
    const along = axis === 'x';
    if (r < 0.5) addCover(x, z, along ? 2.2 : 1.3, along ? 1.3 : 2.2, 1.4, 0x2e5e3a); // dumpster
    else {
      addCover(x + (along ? -0.6 : 0), z + (along ? 0 : -0.6), 1.1, 1.1, 1.0, 0x7a5a32); // crates
      addCover(x + (along ? 0.7 : 0), z + (along ? 0 : 0.7), 1.0, 1.0, 0.9, 0x86643a);
    }
  }

  // Rival gang hangout: the sidewalk corner of block (1,6) in Southgate.
  const turf = blocks.find((b) => b.i === 1 && b.j === 6);
  const gangHome = { x: turf.maxX - 4, z: turf.minZ + 4, block: turf };
  addCover(turf.maxX - 10, turf.minZ + 2.2, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 2.2, turf.minZ + 10, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 16, turf.minZ + 2.4, 2.6, 1.4, 1.4, 0x2e5e3a); // dumpster
  addCover(turf.maxX - 2.4, turf.minZ + 17, 1.4, 2.6, 1.4, 0x2e5e3a);
  // Street furniture across the road gives attackers cover too.
  addCover(turf.maxX + CFG.ROAD + 2.2, turf.minZ + 6, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 8, turf.minZ - CFG.ROAD - 2.2, 1.4, 1.4, 1.1, 0x7a5a32);

  // Your crew's hangout: the sidewalk outside the downtown park.
  const homePark = blocks.find((b) => b.i === 3 && b.j === 4);
  const crewHome = { x: homePark.cx + 18, z: homePark.minZ + 2.4, block: homePark };
  addCover(homePark.cx + 18, homePark.minZ + 5.6, 3, 0.8, 0.7, 0x6d4c2f); // bench

  // New players start on the sidewalk outside the downtown park.
  const park = blocks.find((b) => b.i === 3 && b.j === 4);
  const spawn = { x: park.cx, z: park.minZ + 2, heading: Math.PI, curbZ: roadC(4) + R / 2 - 1.6 };

  return { colliders, los, crates, blocks, stores, chop, station, hospital, gangHome, crewHome, spawn, nodes, nodeAt, nearestNode, blockAt, groundY, drawMap, size: SIZE, P, N };
}
