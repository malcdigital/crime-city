import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import AZURE_URL from './assets/azure.glb?url';

// Your car: the Azure V2 (src/assets/azure.glb, a Blender model, in the build as data). It's a
// vehicle type of its own (vehicle.js 'azure': 125 mph, quick, grippy) that drives and crashes
// like the rest (its procedural frame, carmodels.js, is still there for the physics, the seat,
// the damage), but what you see is the model:
//   the body           - merged by material (about thirty pieces, not the file's 260)
//   the four wheels    - each the visible part of the car's own wheel, so they spin, steer and
//                        go flat with it
//   the two doors      - butterfly doors, up and forward on their own hinges (the model's open
//                        pose, from its animation), on the car's door pivots
//   the lights         - the model's headlights and tail lights, switched like any car's
// The file's studio floor is left out. Until it's loaded (a moment at the start) an Azure is
// drawn as a sports car; then it's dressed.

export const AZURE = { ready: false, parts: null, waiting: [] };

export function loadAzure() {
  if (AZURE.loading) return;
  AZURE.loading = true;
  new GLTFLoader().load(
    AZURE_URL,
    (gltf) => {
      try {
        AZURE.parts = prepare(gltf);
        AZURE.ready = true;
      } catch (e) {
        console.warn('Azure: could not prepare the model', e);
      }
      for (const f of AZURE.waiting) f();
      AZURE.waiting = [];
    },
    undefined,
    (e) => console.warn('Azure: could not load the model', e),
  );
}

// Call f once the model's ready (now, if it is).
export function whenAzure(f) {
  if (AZURE.ready) f();
  else AZURE.waiting.push(f);
}

// The materials, for the game's lights (the model's are physically based; the city's aren't).
function convert(m) {
  const name = m.name || '';
  const color = m.color ? m.color.clone() : new THREE.Color(0xffffff);
  if (/cyan → blue|Cyan → blue/i.test(name)) return new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x6a7a8a }); // (the paint: a gradient in its vertices)
  if (/glass|canopy/i.test(name)) return new THREE.MeshPhongMaterial({ color, shininess: 110, specular: 0x9ab0c0 });
  if (/instrument/i.test(name)) return new THREE.MeshBasicMaterial({ color });
  if ((m.metalness ?? 0) > 0.4) return new THREE.MeshPhongMaterial({ color: color.clone().multiplyScalar(1.6), shininess: 60, specular: 0x777777 });
  return new THREE.MeshLambertMaterial({ color });
}

function prepare(gltf) {
  const root = gltf.scenes[0] || gltf.scene;
  root.updateMatrixWorld(true);
  const named = (n) => root.getObjectByName(n);
  // The frames things are kept in: each wheel about its middle, each door about its hinge.
  const wheelNodes = {};
  for (const k of ['Front_L', 'Front_R', 'Rear_L', 'Rear_R']) wheelNodes[k] = named(`Wheel_${k}.001`) || named(`Wheel_${k}`);
  const doorNodes = { L: named('Door_Hinge_L.001') || named('Door_Hinge_L'), R: named('Door_Hinge_R.001') || named('Door_Hinge_R') };
  const frameOf = (o) => {
    for (let p = o; p && p !== root; p = p.parent) {
      for (const [k, w] of Object.entries(wheelNodes)) if (p === w) return ['wheel', k, w];
      for (const [k, d] of Object.entries(doorNodes)) if (p === d) return ['door', k, d];
    }
    return ['body', null, null];
  };
  const mats = new Map();
  const matFor = (m) => {
    if (!mats.has(m)) mats.set(m, convert(m));
    return mats.get(m);
  };
  // buckets: group key -> material -> geometries
  const buckets = new Map();
  const add = (key, mat, geo) => {
    if (!buckets.has(key)) buckets.set(key, new Map());
    const b = buckets.get(key);
    if (!b.has(mat)) b.set(mat, []);
    b.get(mat).push(geo);
  };
  const inv = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/studio floor/i.test(o.name)) return;
    const [kind, k, frame] = frameOf(o);
    inv.copy(frame ? frame.matrixWorld : new THREE.Matrix4()).invert();
    tmp.multiplyMatrices(inv, o.matrixWorld);
    for (const src of Array.isArray(o.material) ? o.material : [o.material]) {
      let g = o.geometry.clone();
      g.applyMatrix4(tmp);
      if (g.index) g = g.toNonIndexed();
      for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'color') g.deleteAttribute(a);
      const lightKind = /^headlight/i.test(src.name) ? 'head' : /^tail light/i.test(src.name) ? 'tail' : null;
      const mat = lightKind ? lightKind : matFor(src);
      if (!(mat instanceof THREE.Material && mat.vertexColors) && g.attributes.color) g.deleteAttribute('color');
      if (mat instanceof THREE.Material && mat.vertexColors && !g.attributes.color) {
        const n = g.attributes.position.count;
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      // (a color attribute in VEC4: down to three)
      if (g.attributes.color && g.attributes.color.itemSize === 4) {
        const c4 = g.attributes.color;
        const c3 = new Float32Array(c4.count * 3);
        for (let i = 0; i < c4.count; i++) c3.set([c4.getX(i), c4.getY(i), c4.getZ(i)], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(c3, 3));
      }
      add(kind === 'body' ? 'body' : `${kind}:${k}`, mat, g);
    }
  });
  const parts = { body: [], wheels: {}, doors: {}, head: null, tail: null };
  for (const [key, b] of buckets) {
    const out = [];
    for (const [mat, geos] of b) {
      const g = mergeGeometries(geos, false);
      if (!g) continue;
      g.computeBoundingSphere();
      if (mat === 'head') parts.head = (parts.head || []).concat([g]);
      else if (mat === 'tail') parts.tail = (parts.tail || []).concat([g]);
      else out.push([g, mat]);
    }
    if (key === 'body') parts.body = out;
    else if (key.startsWith('wheel:')) parts.wheels[key.slice(6)] = out;
    else parts.doors[key.slice(5)] = out;
  }
  parts.head = parts.head && mergeGeometries(parts.head, false);
  parts.tail = parts.tail && mergeGeometries(parts.tail, false);
  // the doors' hinges (where they sit on the car) and their open pose (the animation's widest)
  for (const [k, d] of Object.entries(doorNodes)) {
    if (!d) continue;
    const at = new THREE.Vector3().setFromMatrixPosition(d.matrixWorld);
    let open = null;
    for (const clip of gltf.animations || []) {
      for (const tr of clip.tracks) {
        if (!tr.name.startsWith(`${d.name}.`) || !tr.name.endsWith('.quaternion')) continue;
        const v = tr.values;
        let best = -1;
        for (let i = 0; i < v.length; i += 4) {
          const a = 2 * Math.acos(Math.min(1, Math.abs(v[i + 3])));
          if (a > best) {
            best = a;
            open = new THREE.Quaternion(v[i], v[i + 1], v[i + 2], v[i + 3]);
          }
        }
      }
    }
    parts.doors[k] = { pieces: parts.doors[k] || [], at, open: open || new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2) };
  }
  // its size, wheels out (for the car's frame: vehicle.js / carmodels.js take these numbers)
  return parts;
}

const HIDE = new THREE.MeshBasicMaterial({ visible: false });

// Dress a car (vehicle.js Vehicle of type 'azure') in the model.
export function dressAzure(v) {
  const P = AZURE.parts;
  if (!P || v.removed || v.azureDressed) return;
  v.azureDressed = true;
  const g = v.group;
  // (the procedural car stays, unseen: it's what the damage and the seat work from)
  for (const m of [v.bodyMesh, v.trimMesh, v.glassMesh, v.insideMesh]) if (m) m.visible = false;
  for (const m of [...v.heads, ...v.tails]) m.visible = false;
  // the body
  for (const [geo, mat] of P.body) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  }
  // the lights: the model's, switched by the car (updateLights swaps their material)
  v.heads = [];
  v.tails = [];
  if (P.head) {
    const h = new THREE.Mesh(P.head, HIDE);
    g.add(h);
    v.heads.push(h);
  }
  if (P.tail) {
    const t = new THREE.Mesh(P.tail, HIDE);
    g.add(t);
    v.tails.push(t);
  }
  v.headOn = null;
  v.tailNow = null;
  // the wheels: the model's wheel inside each of the car's own (left = +x = the model's "R")
  for (const w of v.wheels) {
    const key = `${w.userData.front ? 'Front' : 'Rear'}_${w.userData.left ? 'R' : 'L'}`;
    const pieces = P.wheels[key];
    if (!pieces) continue;
    w.material = HIDE;
    for (const [geo, mat] of pieces) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      w.add(m);
    }
  }
  // the doors: on the car's pivots, moved to the model's hinges (driver's side, -1, is +x: "R")
  for (const [side, d] of Object.entries(v.doors || {})) {
    const D = P.doors[+side === -1 ? 'R' : 'L'];
    if (!D) continue;
    for (const c of d.pivot.children) c.visible = false;
    d.pivot.position.copy(D.at);
    for (const [geo, mat] of D.pieces) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      d.pivot.add(m);
    }
    d.openQ = D.open; // (vehicle.js: angle 0 -> shut, the full open angle -> this pose)
  }
}
