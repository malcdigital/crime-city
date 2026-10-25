import * as THREE from 'three';
import { CFG } from './config.js';
import { mulberry32 } from './util.js';
import { lam } from './character.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const { BLOCKS: N, BLOCK: B, ROAD: R, SIDEWALK: SW, PITCH: P, SIZE } = CFG;
export const roadC = (k) => k * P;

import { SPECIAL, STORES, PLACES, STYLES, districtOfBlock, districtAt } from './districts.js';

export { districtAt };

const AVENUES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave', '9th Ave', '10th Ave', '11th Ave', '12th Ave', '13th Ave', '14th Ave', '15th Ave'];
const STREETS = ['Grove St', 'Palm St', 'Market St', 'Union St', 'King St', 'Ocean St', 'Mill St', 'Bay St', 'Pine St', 'Cedar St', 'Elm St', 'Harbor St', 'Front St', 'Water St', 'Dock St'];

// Name of the nearest road, for news headlines.
export function streetAt(x, z) {
  const kx = Math.round(x / P);
  const kz = Math.round(z / P);
  const dx = Math.abs(x - kx * P);
  const dz = Math.abs(z - kz * P);
  if (dx < dz) return AVENUES[Math.max(0, Math.min(N, kx))];
  return STREETS[Math.max(0, Math.min(N, kz))];
}

// Building windows (some lit), and a matching glow map: only the lit windows, which light up
// at night (daynight.js turns the glow up after dark).
function windowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const c2 = document.createElement('canvas');
  c2.width = c2.height = 128;
  const g2 = c2.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g2.fillStyle = '#000000';
  g2.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const lit = rng() < 0.22;
      g.fillStyle = lit ? '#f1dc9a' : '#566779';
      g.fillRect(i * 32 + 7, j * 32 + 6, 18, 20);
      // At night more windows are lit than show in daylight.
      if (lit || rng() < 0.25) {
        g2.fillStyle = lit ? '#ffe2a0' : '#c9a86a';
        g2.fillRect(i * 32 + 7, j * 32 + 6, 18, 20);
      }
    }
  }
  const make = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const t = make(c);
  t.glow = make(c2);
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

// Fewer draw calls: everything static the city just built that shares a material is merged
// into one mesh per material per 2x2-block chunk (frustum culling still works chunk by chunk).
function mergeStatic(scene, first) {
  const groups = new Map();
  for (const m of scene.children.slice(first)) {
    if (!m.isMesh || m.isInstancedMesh || Array.isArray(m.material)) continue;
    const key = `${m.material.uuid}|${Math.floor(m.position.x / (P * 2))},${Math.floor(m.position.z / (P * 2))}|${m.castShadow}|${m.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    for (const m of list) scene.remove(m);
    for (const g of geos) g.dispose();
    scene.add(mesh);
  }
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
  const firstChild = scene.children.length;
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
  const windowMats = []; // every material with windows (their glow goes up at night)
  const winMat = (color) => {
    const m = new THREE.MeshLambertMaterial({ color, map: winTex, emissive: 0x000000, emissiveMap: winTex.glow });
    windowMats.push(m);
    return m;
  };
  const buildingMats = [0xc9c2b8, 0x9fb4c7, 0xb8a48c, 0x8e9aa6, 0xd6cfc4, 0x7d8a99, 0xa89f91, 0xb5aa9c].map(
    (c) => winMat(c),
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
  grass.position.set(SIZE / 2, -0.6, SIZE / 2); // well below the asphalt so it never shows through
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
  const containers = [];
  let deferredContainers = [];
  // Per-district building materials (windows on all of them).
  const matCache = {};
  const matsFor = (d) => (matCache[d] ||= STYLES[d].colors.map((c) => winMat(c)));
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  const roofMat = lam(0x5a4636);
  const columnGeo = new THREE.CylinderGeometry(0.45, 0.5, 8, 10);
  const columnMat = lam(0xeeeae0);
  const neonMats = [0xff3fa4, 0x34e7ff, 0xb84dff, 0xffe14d].map((c) => new THREE.MeshBasicMaterial({ color: c }));
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
      blocks.push({ i, j, minX, maxX, minZ, maxZ, cx, cz, type, district: districtOfBlock(i, j) });

      const slab = new THREE.Mesh(slabGeo, lam(0x8d8d8a));
      slab.position.set(cx, 0.1, cz);
      slab.receiveShadow = true;
      scene.add(slab);

      const iMinX = minX + SW, iMaxX = maxX - SW, iMinZ = minZ + SW, iMaxZ = maxZ - SW;

      if (type === 'park') {
        const lawn = new THREE.Mesh(new THREE.BoxGeometry(B - SW * 2, 0.06, B - SW * 2), lam(0x4f7a3f));
        lawn.position.set(cx, 0.22, cz);
        lawn.receiveShadow = true;
        scene.add(lawn);
        for (let t = 0; t < 9; t++) tree(rr(iMinX + 3, iMaxX - 3), rr(iMinZ + 3, iMaxZ - 3));
      } else if (type === 'police') {
        const w = 40, d = 24, h = 14;
        const bz = iMaxZ - d / 2 - 1;
        building(cx, bz, w, d, h, winMat(0x3b5b8c));
        sign('POLICE', cx, 10, bz - d / 2 - 0.06, Math.PI, 14, 2.6, '#1c2f5a');
        station = { x: cx, z: iMinZ + 8, heading: Math.PI, name: 'Central Precinct', roof: { x: cx, z: bz, y: h } };
        // Helipad on the roof.
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.08, 24), lam(0x2c3e50));
        pad.position.set(cx, h + 0.04, bz);
        scene.add(pad);
        const hMark = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.5), lam(0xf1c40f));
        hMark.position.set(cx, h + 0.1, bz);
        scene.add(hMark);
      } else if (type === 'cityhall') {
        const w = 44, d = 30, h = 18;
        const bz = cz + 4;
        building(cx, bz, w, d, h, winMat(0xf0ece2));
        const dome = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xd9d2c0));
        dome.position.set(cx, 0.2 + h, bz);
        dome.castShadow = true;
        scene.add(dome);
        sign('CITY HALL', cx, 12, bz - d / 2 - 0.06, Math.PI, 14, 2.4, '#4a4a4a');
        for (let k = -3; k <= 3; k++) {
          const col = new THREE.Mesh(columnGeo, columnMat);
          col.position.set(cx + k * 5, 0.2 + 4, bz - d / 2 - 0.8);
          scene.add(col);
        }
      } else if (type === 'hospital') {
        const w = 40, d = 24, h = 16;
        const bz = iMaxZ - d / 2 - 1;
        building(cx, bz, w, d, h, winMat(0xeeeeee));
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
        const district = districtOfBlock(i, j);
        const st = STYLES[district];
        const mats = matsFor(district);
        const pickMat = () => mats[Math.floor(rng() * mats.length)];
        const height = () => st.h[0] + Math.pow(rng(), 1.4) * (st.h[1] - st.h[0]);
        const kind = type === 'store' ? 'city' : st.kind;
        const lots = [];
        const fourLots = () => {
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
        };
        if (kind === 'houses') {
          // Big houses with yards and trees.
          const yard = new THREE.Mesh(new THREE.BoxGeometry(B - SW * 2, 0.06, B - SW * 2), lam(0x557f45));
          yard.position.set(cx, 0.22, cz);
          yard.receiveShadow = true;
          scene.add(yard);
          for (let qx = 0; qx < 3; qx++) {
            for (let qz = 0; qz < 2; qz++) {
              const w = rr(10, 13), d = rr(9, 12), h = height();
              const x = iMinX + 9 + qx * 19, z = iMinZ + 10 + qz * 36;
              building(x, z, w, d, h, pickMat());
              const roof = new THREE.Mesh(roofGeo, roofMat);
              roof.scale.set(w * 1.08, 2.6, d * 1.08);
              roof.position.set(x, 0.2 + h + 1.3, z);
              roof.castShadow = true;
              scene.add(roof);
            }
          }
          for (let t = 0; t < 4; t++) tree(rr(iMinX + 3, iMaxX - 3), cz + rr(-4, 4));
        } else if (kind === 'civic') {
          // One big stone government building with wide front steps.
          const w = rr(40, 48), d = rr(28, 36), h = height();
          building(cx, cz + 3, w, d, h, pickMat());
          const steps = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.5, 3), lam(0xd8d2c4));
          steps.position.set(cx, 0.45, cz + 3 - d / 2 - 1.5);
          scene.add(steps);
          for (let k = -2; k <= 2; k++) {
            const col = new THREE.Mesh(columnGeo, columnMat);
            col.position.set(cx + k * (w * 0.12), 0.2 + 4, cz + 3 - d / 2 - 0.6);
            scene.add(col);
          }
        } else if (kind === 'projects') {
          // Long, low brick buildings in rows.
          for (let r = 0; r < 3; r++) lots.push({ x: cx + rr(-2, 2), z: iMinZ + 8 + r * 20, w: rr(40, 48), d: 10 });
        } else if (kind === 'docks') {
          // Warehouses, and shipping containers stacked in the yard.
          lots.push({ x: cx, z: iMinZ + 12, w: rr(42, 50), d: 20 });
          if (rng() < 0.6) lots.push({ x: cx, z: iMaxZ - 12, w: rr(36, 46), d: 18 });
          else for (let k = 0; k < 4; k++) containers.push([iMinX + 8 + k * 11, iMaxZ - 10, rng()]);
        } else if (kind === 'towers' && rng() < 0.35) {
          lots.push({ x: cx, z: cz, w: rr(30, 40), d: rr(30, 40), hMul: 1.15 });
        } else if (kind === 'city' && type === 'normal' && rng() < 0.2) {
          lots.push({ qx: -1, qz: -1, x: cx, z: cz, w: rr(40, 52), d: rr(40, 52) });
        } else {
          fourLots();
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
          const h = height() * (lot.hMul || 1);
          building(lot.x, lot.z, lot.w, lot.d, h, pickMat());
          if (kind === 'strip') {
            // Neon across the front.
            const neon = new THREE.Mesh(new THREE.BoxGeometry(lot.w * 0.85, 0.35, 0.15), neonMats[Math.floor(rng() * neonMats.length)]);
            neon.position.set(lot.x, 3.6 + rng() * 2.5, lot.z - lot.d / 2 - 0.1);
            scene.add(neon);
          }
        }
      }
    }
  }

  // Shipping containers on the docks (low cover).
  deferredContainers = containers;

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
      for (let t = roadC(j) + R / 2 + 6.5; t < roadC(j + 1) - R / 2 - 5; t += 6) { // clear of the crosswalks
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
    const colors = { park: '#3f6b35', police: '#244a8a', chop: '#8a4a12', hospital: '#8a2a2a', cityhall: '#5a5648' };
    // Each district a slightly different shade.
    const shade = { 'The Heights': '#34433a', 'Financial District': '#2b3947', 'Government District': '#45443e', 'The Projects': '#3e302c', 'The Strip': '#362d42', 'The Docks': '#34373b' };
    for (const b of blocks) {
      ctx.fillStyle = colors[b.type] || shade[b.district] || '#2f3439';
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

  const boxColors = [0xb03a2e, 0x1f618d, 0x1e8449, 0xd68910, 0x7d3c98];
  for (const [x, z, r] of deferredContainers) addCover(x, z, 2.6, 6.2, 2.6, boxColors[Math.floor(r * boxColors.length)]);
  for (const [x, z, axis, r] of alleyCover) {
    const along = axis === 'x';
    if (r < 0.5) addCover(x, z, along ? 2.2 : 1.3, along ? 1.3 : 2.2, 1.4, 0x2e5e3a); // dumpster
    else {
      addCover(x + (along ? -0.6 : 0), z + (along ? 0 : -0.6), 1.1, 1.1, 1.0, 0x7a5a32); // crates
      addCover(x + (along ? 0.7 : 0), z + (along ? 0 : 0.7), 1.0, 1.0, 0.9, 0x86643a);
    }
  }

  const blockIJ = ([i, j]) => blocks[i * N + j];
  // Rival gang hangout: a sidewalk corner in the Projects.
  const turf = blockIJ(PLACES.gangHome);
  const gangHome = { x: turf.maxX - 4, z: turf.minZ + 4, block: turf };
  addCover(turf.maxX - 10, turf.minZ + 2.2, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 2.2, turf.minZ + 10, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 16, turf.minZ + 2.4, 2.6, 1.4, 1.4, 0x2e5e3a); // dumpster
  addCover(turf.maxX - 2.4, turf.minZ + 17, 1.4, 2.6, 1.4, 0x2e5e3a);
  // Street furniture across the road gives attackers cover too.
  addCover(turf.maxX + CFG.ROAD + 2.2, turf.minZ + 6, 1.4, 1.4, 1.1, 0x7a5a32);
  addCover(turf.maxX - 8, turf.minZ - CFG.ROAD - 2.2, 1.4, 1.4, 1.1, 0x7a5a32);

  // Your crew's hangout: the sidewalk outside the park in Midtown, next to Downtown.
  const homePark = blockIJ(PLACES.crewHome);
  const crewHome = { x: homePark.cx + 18, z: homePark.minZ + 2.4, block: homePark };
  addCover(homePark.cx + 18, homePark.minZ + 5.6, 3, 0.8, 0.7, 0x6d4c2f); // bench

  // New players start on the sidewalk outside that park.
  const park = homePark;
  const spawn = { x: park.cx, z: park.minZ + 2, heading: Math.PI, curbZ: roadC(PLACES.crewHome[1]) + R / 2 - 1.6 };

  mergeStatic(scene, firstChild);
  return { windowMats, colliders, los, crates, blocks, stores, chop, station, hospital, gangHome, crewHome, spawn, nodes, nodeAt, nearestNode, blockAt, groundY, drawMap, size: SIZE, P, N };
}
