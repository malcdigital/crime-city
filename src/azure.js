import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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

export function loadAzure(renderer) {
  if (AZURE.loading) return;
  AZURE.loading = true;
  // (what the paint, the chrome and the canopy reflect: a soft studio, like the model's own renders)
  if (renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    AZURE.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  // (in the build the model is a data: link; decoded here rather than fetched, because the page
  // it's published on may not allow fetching even that)
  const done = (gltf) => {
    try {
      AZURE.parts = prepare(gltf);
      AZURE.ready = true;
    } catch (e) {
      console.warn('Azure: could not prepare the model', e);
    }
    for (const f of AZURE.waiting) f();
    AZURE.waiting = [];
  };
  const fail = (e) => console.warn('Azure: could not load the model', e);
  const loader = new GLTFLoader();
  if (AZURE_URL.startsWith('data:')) {
    try {
      const bin = atob(AZURE_URL.slice(AZURE_URL.indexOf(',') + 1));
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      loader.parse(buf.buffer, '', done, fail);
    } catch (e) {
      fail(e);
    }
  } else loader.load(AZURE_URL, done, undefined, fail);
}

// Call f once the model's ready (now, if it is).
export function whenAzure(f) {
  if (AZURE.ready) f();
  else AZURE.waiting.push(f);
}

// The materials: the model's own (metal, gloss, the glowing strips), so it looks the way it was
// made; only the paint keeps its vertex colors (the gradient), and everything reflects the studio.
const MATS = new Set();
const PAINT = /cyan → blue/i;
function convert(m) {
  const c = m.clone();
  c.vertexColors = PAINT.test(m.name || '');
  // (the glass: smoked, but you can see who's driving)
  if (/smoked glass|smoked canopy/i.test(m.name || '')) {
    c.transparent = true;
    c.opacity = 0.62;
    c.depthWrite = false;
  }
  c.envMap = AZURE.env || null;
  c.envMapIntensity = 1;
  c.needsUpdate = true;
  MATS.add(c);
  return c;
}

// Night (0-1): the studio reflections fade so it doesn't glow in the dark.
export function azureNight(k) {
  for (const m of MATS) m.envMapIntensity = 1 - 0.8 * k;
}

function prepare(gltf) {
  const root = gltf.scenes[0] || gltf.scene;
  root.updateMatrixWorld(true);
  // (the loader drops the dots from names: "Wheel_Front_L.001" comes in as "Wheel_Front_L001")
  const named = (base) => {
    let hit = null;
    root.traverse((o) => {
      if (!hit && o.name.replace(/[.\s]/g, '').startsWith(base)) hit = o;
    });
    return hit;
  };
  // The frames things are kept in: each wheel about its middle, each door about its hinge.
  const wheelNodes = {};
  for (const k of ['Front_L', 'Front_R', 'Rear_L', 'Rear_R']) wheelNodes[k] = named(`Wheel_${k}`);
  const doorNodes = { L: named('Door_Hinge_L'), R: named('Door_Hinge_R') };
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
    if (/studio[\s_]*floor/i.test(o.name)) return;
    const [kind, k, frame] = frameOf(o);
    inv.copy(frame ? frame.matrixWorld : new THREE.Matrix4()).invert();
    tmp.multiplyMatrices(inv, o.matrixWorld);
    for (const src of Array.isArray(o.material) ? o.material : [o.material]) {
      let g = o.geometry.clone();
      g.applyMatrix4(tmp);
      if (g.index) g = g.toNonIndexed();
      for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'color') g.deleteAttribute(a);
      const mat = matFor(src);
      if (/^tail light/i.test(src.name)) mat.userData.tail = true;
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
  const parts = { body: [], wheels: {}, doors: {} };
  for (const [key, b] of buckets) {
    const out = [];
    for (const [mat, geos] of b) {
      const g = mergeGeometries(geos, false);
      if (!g) continue;
      g.computeBoundingSphere();
      out.push([g, mat]);
    }
    if (key === 'body') parts.body = out;
    else if (key.startsWith('wheel:')) parts.wheels[key.slice(6)] = out;
    else parts.doors[key.slice(5)] = out;
  }
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
    parts.doors[k] = {
      pieces: parts.doors[k] || [],
      at,
      open: open || new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2),
    };
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
  // the body (its light strips always lit, like the model; the tail lights brighten when you
  // brake: vehicle.js updateLights)
  v.heads = [];
  v.tails = [];
  for (const [geo, mat0] of P.body) {
    const mat = mat0.userData.tail ? mat0.clone() : mat0;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.userData.azure = true;
    g.add(m);
    if (mat0.userData.tail) v.azureTail = mat;
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
      m.userData.azure = true;
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
      m.userData.azure = true;
      d.pivot.add(m);
    }
    d.openQ = D.open; // (vehicle.js: angle 0 -> shut, the full open angle -> this pose)
  }
}
