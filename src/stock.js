import * as THREE from 'three';
import { GLOW_MATS } from './glowmats.js';
import { PHONE } from './quality.js';

// What's on the shelves, in 3D: boxes, cans, bottles, bags, jugs, packs. Each kind of shape is
// one instanced mesh per room (every item an instance with its own size, turn and color), so a
// store full of stock is half a dozen draw calls. Items come in blocks of the same thing (a run
// of the same cereal, a row of the same soda), faced up to the shelf edge, with labels, caps and
// bands as extra instances. Only drawn close up (storerooms.js swaps in the flat pictures from
// further off).

// One material for all of it: the color's per instance; it glows with the rooms at night, tinted
// by that color (like storedecor.js's vertex-colored one).
const MAT = new THREE.MeshLambertMaterial();
MAT.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif');
};
MAT.customProgramCacheKey = () => 'stock-inst';
GLOW_MATS.push(MAT);

// The shapes, a unit across and a unit tall, standing on y = 0, the front facing +z.
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const lathe = (pts) => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 6);
    g.computeVertexNormals();
    return g;
  };
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const can = new THREE.CylinderGeometry(0.5, 0.5, 1, 7).translate(0, 0.5, 0);
  // (a soda / water bottle: body, shoulder, neck)
  const bottle = lathe([[0, 0], [0.5, 0.02], [0.5, 0.58], [0.26, 0.8], [0.17, 1], [0, 1]]);
  // (a liquor or wine bottle: square shoulder, long neck)
  const wine = lathe([[0, 0], [0.5, 0], [0.5, 0.62], [0.17, 0.74], [0.15, 1], [0, 1]]);
  // (a bag of chips: a pillow)
  // (a bag of chips: puffed out in the middle, crimped flat along the top and bottom seams)
  const bag = new THREE.BoxGeometry(1, 1, 1, 2, 4, 1).translate(0, 0.5, 0);
  {
    const p = bag.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = Math.min(y, 1 - y) * 2; // (0 at the seams, 1 in the middle)
      const puff = t < 0.18 ? 0.08 : 0.35 + 0.65 * Math.sqrt(t);
      p.setZ(i, p.getZ(i) * puff);
      p.setX(i, p.getX(i) * (0.92 + 0.08 * t));
    }
    bag.computeVertexNormals();
  }
  const band = new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 1, true).translate(0, 0.5, 0);
  GEO = { box, can, bottle, wine, bag, band };
  return GEO;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

export class Stock {
  constructor(seed = 1) {
    this.items = {};
    this.seed = seed;
  }

  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  pick(a) {
    return a[Math.floor(this.rnd() * a.length)];
  }

  // One item: its shape, where its base sits (x, y, z), its size, color and turn about y.
  add(type, x, y, z, sx, sy, sz, color, ry = 0) {
    (this.items[type] ||= []).push([x, y, z, sx, sy, sz, color, ry]);
  }

  // Instanced meshes for everything, in parent.
  build(parent) {
    const G = geos();
    for (const [type, list] of Object.entries(this.items)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(G[type], MAT, list.length);
      list.forEach(([x, y, z, sx, sy, sz, color, ry], i) => {
        _q.setFromAxisAngle(_up, ry);
        _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.setHex(color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.items = {};
  }
}

// ---- The goods: what each thing looks like ----
// w across the front, h tall, d deep; kind: the shape; stack: how many high; extras drawn on it.
const C = {
  cereal: [0xd62828, 0xf7b801, 0x1d4e89, 0xf4f1de, 0xe76f51, 0x2a9d8f, 0x8338ec, 0x4a7c59],
  bag: [0xff7b00, 0xd00000, 0x1f75fe, 0xffd60a, 0x7b2cbf, 0x2b9348, 0x222222, 0xe63946],
  can: [0xc1121f, 0xb8bec5, 0x2d6a4f, 0xf4a261, 0x264653, 0xe9c46a],
  liquid: [0x5a1a08, 0x2b9348, 0xff8800, 0xd00000, 0x3a86ff, 0xdfe7ea, 0x6a0dad],
  label: [0xffffff, 0xf1faee, 0xffd60a, 0xd62828, 0x111111, 0x1d3557],
  liquor: [0x8a4b0f, 0x1e4d2b, 0xc9d6d3, 0x2b1a12, 0x1d3557, 0x6e2c0e, 0x4a5d23],
  pack: [0xf4f4f4, 0xc1121f, 0xd4a017, 0x1d3557, 0x2b9348, 0x111111],
  ammo: [0xb7950b, 0x7b241c, 0x1f618d, 0x145a32, 0x5d6d7e, 0xd35400, 0x1a1a1a],
};
export const GOODS = {
  cereal: (S) => ({ kind: 'box', w: 0.19, h: 0.27, d: 0.07, color: S.pick(C.cereal), label: S.pick(C.label), n: [3, 5] }),
  crackers: (S) => ({ kind: 'box', w: 0.15, h: 0.18, d: 0.06, color: S.pick(C.cereal), label: S.pick(C.label), n: [3, 6] }),
  pasta: (S) => ({ kind: 'box', w: 0.09, h: 0.2, d: 0.05, color: S.pick([0x1d4e89, 0x0b6e4f, 0xc1121f]), label: 0xf4f1de, n: [4, 8] }),
  soup: (S) => ({ kind: 'can', w: 0.075, h: 0.105, color: S.pick(C.can), label: S.pick(C.label), stack: 2, n: [4, 8] }),
  tuna: (S) => ({ kind: 'can', w: 0.085, h: 0.04, color: S.pick(C.can), stack: 3, n: [3, 6] }),
  chips: (S) => ({ kind: 'bag', w: 0.2, h: 0.27, d: 0.09, color: S.pick(C.bag), n: [3, 5] }),
  snack: (S) => ({ kind: 'bag', w: 0.13, h: 0.18, d: 0.06, color: S.pick(C.bag), n: [4, 7] }),
  candy: (S) => ({ kind: 'box', w: 0.12, h: 0.06, d: 0.1, color: S.pick(C.bag), stack: 2, n: [4, 7] }),
  bread: (S) => ({ kind: 'box', w: 0.12, h: 0.11, d: 0.28, color: S.pick([0xd9a066, 0xc68642, 0xe8c48a]), label: S.pick([0xd62828, 0x1d4e89, 0xf7b801]), n: [3, 5] }),
  detergent: (S) => ({ kind: 'box', w: 0.14, h: 0.26, d: 0.1, color: S.pick([0xf77f00, 0x1d4e89, 0x2a9d8f, 0xe9ecef, 0x8338ec]), cap: S.pick([0xffffff, 0x111111, 0xd62828]), label: 0xffffff, n: [2, 4] }),
  rolls: (S) => ({ kind: 'can', w: 0.11, h: 0.11, color: 0xf8f8f2, stack: 2, n: [3, 6] }),
  soda2: (S) => ({ kind: 'bottle', w: 0.1, h: 0.32, color: S.pick(C.liquid), label: S.pick(C.label), cap: S.pick([0xd62828, 0x2b9348, 0xffffff, 0x1d4e89]), n: [3, 6] }),
  soda: (S) => ({ kind: 'bottle', w: 0.066, h: 0.21, color: S.pick(C.liquid), label: S.pick(C.label), cap: S.pick([0xd62828, 0x2b9348, 0xffffff, 0x1d4e89]), n: [4, 9] }),
  water: (S) => ({ kind: 'bottle', w: 0.066, h: 0.22, color: 0xcfe8f5, label: S.pick([0x1f75fe, 0x00b4d8, 0xffffff]), cap: 0x1f75fe, n: [5, 10] }),
  beer: (S) => ({ kind: 'can', w: 0.066, h: 0.122, color: S.pick([0xd4a017, 0xc1121f, 0x1d3557, 0xb8bec5, 0x111111, 0x2b9348]), stack: 2, n: [5, 10] }),
  milk: (S) => ({ kind: 'box', w: 0.14, h: 0.25, d: 0.14, color: 0xf8f8f8, cap: S.pick([0xd62828, 0x1f75fe, 0x2b9348, 0xffd60a]), label: S.pick([0xd62828, 0x1f75fe, 0x2b9348]), n: [3, 6] }),
  juice: (S) => ({ kind: 'box', w: 0.09, h: 0.22, d: 0.09, color: S.pick([0xff8800, 0xffd60a, 0xd00000, 0x7b2cbf]), cap: 0xffffff, n: [4, 7] }),
  liquor: (S) => ({ kind: 'wine', w: 0.085, h: 0.3, color: S.pick(C.liquor), label: S.pick([0xf1e3c6, 0x111111, 0xffffff, 0xd4a017, 0x7b241c]), cap: S.pick([0x111111, 0xd4a017, 0x7b241c, 0xb8bec5]), n: [3, 6] }),
  wine: (S) => ({ kind: 'wine', w: 0.075, h: 0.31, color: S.pick([0x1a2b12, 0x2b0a0a, 0x3a1a1a, 0xd8d0a0]), label: S.pick([0xf1e3c6, 0xffffff]), cap: S.pick([0x7b241c, 0x111111, 0xd4a017]), n: [3, 6] }),
  pint: (S) => ({ kind: 'wine', w: 0.07, h: 0.19, color: S.pick(C.liquor), label: S.pick([0xf1e3c6, 0xd4a017, 0xffffff]), cap: 0x111111, n: [4, 8] }),
  pack: (S) => ({ kind: 'box', w: 0.056, h: 0.088, d: 0.024, color: S.pick(C.pack), label: S.pick([0x111111, 0xffffff, 0xd4a017]), n: [3, 8] }),
  ammo: (S) => ({ kind: 'box', w: 0.13, h: 0.07, d: 0.09, color: S.pick(C.ammo), label: S.pick([0xffffff, 0xffd60a, 0x111111]), stack: 3, n: [2, 4] }),
  case12: (S) => ({ kind: 'box', w: 0.27, h: 0.13, d: 0.2, color: S.pick([0xc1121f, 0x1d4e89, 0x2b9348, 0xff8800]), label: 0xffffff, stack: 1, n: [2, 3] }),
};

// A shelf's worth: from (x0, z0) along (ux, uz) for len meters, items standing on y, their
// backs toward (nx, nz) (into the shelf), up to depth deep and height tall; blocks of the
// kinds in goods (names in GOODS), picked in turn. rows: how many deep.
export function shelfRun(S, { x0, z0, ux, uz, nx, nz, len, y, depth = 0.34, height = 0.32, goods, rows = 1, gap = 0.012 }) {
  const ry = Math.atan2(-nx, -nz); // (fronts facing out of the shelf)
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const off = (cx, cz, lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
  let s = 0.02;
  let tries = 0;
  while (s < len - 0.05 && tries++ < 400) {
    const g = GOODS[S.pick(goods)](S);
    const d = g.d ?? g.w;
    const stack = g.stack || 1;
    const h = g.h;
    if (h > height + 0.02) continue;
    const per = Math.max(1, Math.min(stack, Math.floor(height / h)));
    const deep = Math.max(1, Math.min(rows, Math.floor(depth / (d + 0.01))));
    let k = g.n[0] + Math.floor(S.rnd() * (g.n[1] - g.n[0] + 1));
    for (; k > 0 && s + g.w <= len; k--) {
      const along = s + g.w / 2;
      for (let r = 0; r < deep; r++) {
        // (the front one at the shelf's edge, the rest behind it)
        const inn = 0.015 + d / 2 + r * (d + 0.01);
        const cx = x0 + ux * along + nx * inn;
        const cz = z0 + uz * along + nz * inn;
        const jit = (S.rnd() - 0.5) * 0.06; // (not quite square on the shelf)
        for (let st = 0; st < per; st++) {
          const yy = y + st * h;
          S.add(g.kind, cx, yy, cz, g.w, h, d, g.color, ry + jit);
          if (r > 0) continue; // (only the front row's labels show)
          if (g.label != null) {
            if (g.kind === 'box') {
              const [lx, lz] = off(cx, cz, 0, d / 2 + 0.002);
              S.add('box', lx, yy + h * 0.38, lz, g.w * 0.82, h * 0.3, 0.004, g.label, ry + jit);
            } else if (g.kind !== 'bag' && !PHONE) S.add('band', cx, yy + h * (g.kind === 'wine' ? 0.2 : 0.3), cz, g.w * 1.04, h * (g.kind === 'can' ? 0.45 : 0.24), g.w * 1.04, g.label, ry + jit);
          }
          if (g.cap != null && st === per - 1 && !PHONE) { // (not on a phone: too small to see)
            const cw = g.kind === 'box' ? g.w * 0.3 : g.w * 0.36;
            const [lx, lz] = g.kind === 'box' ? off(cx, cz, 0, d * 0.2) : [cx, cz];
            S.add('can', lx, yy + h * (g.kind === 'box' ? 1 : 0.97), lz, cw, h * 0.07, cw, g.cap, 0);
          }
        }
      }
      s += g.w + gap;
    }
    s += 0.03; // (a little gap between products)
  }
}
