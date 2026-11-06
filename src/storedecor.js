import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shelfRun } from './stock.js';

// The stores' decor (storerooms.js builds the rooms; this dresses them): floors and ceilings,
// trim, signs and posters, and the things every kind of store has about it. All of it's
// static, and merged per material, so a store's whole dressing is a handful of draw calls.
// Nothing here is in anyone's way: it's against the walls, up high, or on the counters (the
// few solid pieces are tight to a wall, clear of the paths people walk).
//
// d: { r, root, kind, hw, zb, H, BR, box, mat, texMat, canvasTex } from StoreRooms.build.

// Text on a canvas: lines of [text, px, color, weight?]; centered.
function textTex(canvasTex, key, w, h, bg, lines, o) {
  return canvasTex(key, w, h, (g) => drawText(g, w, h, bg, lines, o));
}
function drawText(g, w, h, bg, lines, { border = null, glow = false } = {}) {
  {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    } else g.clearRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = Math.max(3, h * 0.04);
      g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const total = lines.reduce((s, l) => s + l[1] * 1.15, 0);
    let y = (h - total) / 2;
    for (const [t, px, col, wt = 900] of lines) {
      g.font = `${wt} ${px}px Arial Black, Arial, sans-serif`;
      if (glow) {
        g.shadowColor = col;
        g.shadowBlur = px * 0.5;
      }
      g.fillStyle = col;
      g.fillText(t, w / 2, y + px * 0.6, w * 0.94);
      if (glow) g.fillText(t, w / 2, y + px * 0.6, w * 0.94);
      y += px * 1.15;
    }
  }
}

// (the materials that glow with the rooms: glowmats.js)
import { GLOW_MATS } from './glowmats.js';
export { GLOW_MATS };
// Every plain-colored piece shares one material, its color in its vertices (so a store's
// trim, fittings and odds and ends are one draw call). Its glow is tinted by that color too.
const VCOL = new THREE.MeshLambertMaterial({ vertexColors: true });
VCOL.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif');
};
VCOL.customProgramCacheKey = () => 'decor-vcol';
GLOW_MATS.push(VCOL);
// The signs and posters, drawn onto shared 1024 px sheets (packed in rows), so all the text
// in a room is one draw call a sheet. tex() hands back where on a sheet it went.
const SHEET = 1024;
const SHEETS = [];
const ON_SHEET = new Map();
function sheetText(key, w, h, bg, lines, o) {
  return sheetDraw(key, w, h, (g) => drawText(g, w, h, bg, lines, o));
}
function sheetDraw(key, w, h, draw) {
  if (ON_SHEET.has(key)) return ON_SHEET.get(key);
  let sh = SHEETS[SHEETS.length - 1];
  const fits = (q) => q && (q.x + w <= SHEET ? q.y + Math.max(q.row, h) <= SHEET : q.y + q.row + h <= SHEET);
  if (!fits(sh)) {
    const c = document.createElement('canvas');
    c.width = c.height = SHEET;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: t, emissiveMap: t });
    GLOW_MATS.push(m);
    sh = { c, g: c.getContext('2d'), t, m, x: 0, y: 0, row: 0 };
    SHEETS.push(sh);
  }
  if (sh.x + w > SHEET) {
    sh.x = 0;
    sh.y += sh.row + 2;
    sh.row = 0;
  }
  const { g } = sh;
  g.save();
  g.translate(sh.x, sh.y);
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  let seed = 7;
  draw(g, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  g.restore();
  // (a hair inside the edges, so the neighbours don't bleed in)
  const e = { sheet: sh, u0: (sh.x + 1) / SHEET, u1: (sh.x + w - 1) / SHEET, v0: 1 - (sh.y + h - 1) / SHEET, v1: 1 - (sh.y + 1) / SHEET };
  sh.x += w + 2;
  sh.row = Math.max(sh.row, h);
  sh.t.needsUpdate = true;
  ON_SHEET.set(key, e);
  return e;
}
const LIT = new Map();
const NEON = new Map();
const _c = new THREE.Color();

const ACCENT = { mart: 0xc0392b, market: 0x1e8449, liquor: 0x6e2c2c, deli: 0x1f6f3a, pawn: 0x6c3483 };

// The kit: shapes added to buckets by material, merged into one mesh each by flush().
export function kit(root, mat, texMat, canvasTex) {
  const buckets = new Map();
  const add = (geo, m) => {
    let mm = m;
    if (typeof m === 'number') {
      // (a plain color: into the shared vertex-colored mesh)
      _c.setHex(m);
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      mm = VCOL;
    } else if (m && m.sheet) {
      // (a sign on a sheet: its corner of the sheet)
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, m.u0 + uv.getX(i) * (m.u1 - m.u0), m.v0 + uv.getY(i) * (m.v1 - m.v0));
      mm = m.sheet.m;
    }
    if (!buckets.has(mm)) buckets.set(mm, []);
    buckets.get(mm).push(geo);
  };
  // A box (x0..x1, y0..y1, z0..z1 in the store's frame), turned rot about its own middle.
  const B = (x0, x1, y0, y1, z0, z1, m, rot = 0) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    if (rot) g.rotateY(rot);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    add(g, m);
  };
  // A cylinder standing up (axis: 'y'; 'x' or 'z' lies it down that way).
  const C = (x, y, z, rad, len, m, axis = 'y', seg = 12, rad2 = rad) => {
    const g = new THREE.CylinderGeometry(rad, rad2, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    add(g, m);
  };
  const S = (x, y, z, rad, m, sy = 1) => {
    const g = new THREE.SphereGeometry(rad, 12, 8);
    if (sy !== 1) g.scale(1, sy, 1);
    g.translate(x, y, z);
    add(g, m);
  };
  // A flat picture facing a way: 'x+' (on the left wall, facing into the room), 'x-' (right
  // wall), 'z-' (on a wall across the room, facing the door), 'z+' (facing the back).
  const ROT = { 'z+': 0, 'x+': Math.PI / 2, 'z-': Math.PI, 'x-': -Math.PI / 2 };
  const P = (w, h, x, y, z, face, m) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(ROT[face]);
    g.translate(x, y, z);
    add(g, m);
  };
  const tex = (key, w, h, bg, lines, o) => sheetText(key, w, h, bg, lines, o);
  const sheet = (key, w, h, draw) => sheetDraw(key, w, h, draw);
  // Neon (lit on its own, day and night).
  const neon = (key, w, h, lines) => {
    if (!NEON.has(key)) NEON.set(key, new THREE.MeshBasicMaterial({ map: textTex(canvasTex, key, w, h, null, lines, { glow: true }), transparent: true, depthWrite: false }));
    return NEON.get(key);
  };
  const lit = (color) => {
    if (!LIT.has(color)) LIT.set(color, new THREE.MeshBasicMaterial({ color }));
    return LIT.get(color);
  };
  const flush = () => {
    for (const [m, geos] of buckets) {
      const g = mergeGeometries(geos, false);
      for (const q of geos) q.dispose();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
    }
    buckets.clear();
  };
  return { add, B, C, S, P, tex, sheet, neon, lit, flush };
}

export function decorate(d) {
  const { r, root, kind, hw, zb, H, BR, mat, texMat, canvasTex } = d;
  const K = kit(root, mat, texMat, canvasTex);
  const { add, B, C, S, P, tex, sheet, neon, lit } = K;
  const accent = ACCENT[kind];
  const W = hw; // (inside faces of the side walls: x = ±hw)

  // ---- Floor, ceiling, trim ----
  const floorTex = {
    mart: ['floor-mart', 128, 128, (g) => {
      g.fillStyle = '#d9d3c4'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#b8b1a1'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
    }, 1.2],
    market: ['floor-market', 128, 128, (g) => {
      g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#c4c2ba'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 125);
      g.fillStyle = 'rgba(0,0,0,.04)'; g.fillRect(10, 20, 50, 30);
    }, 0.9],
    deli: ['floor-deli', 128, 128, (g) => {
      g.fillStyle = '#e6e1d3'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#6f6b62'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
    }, 0.9],
    liquor: ['floor-liquor', 256, 128, (g, rnd) => {
      for (let y = 0; y < 128; y += 16) {
        const off = (y / 16) % 2 ? 0 : 90;
        for (let x = -off; x < 256; x += 180) {
          const t = 60 + Math.floor(rnd() * 30);
          g.fillStyle = `rgb(${t + 40},${t + 14},${t - 20})`;
          g.fillRect(x, y, 180, 16);
          g.fillStyle = 'rgba(0,0,0,.35)';
          g.fillRect(x, y + 15, 180, 1);
          g.fillRect(x + 179, y, 1, 16);
        }
      }
    }, 2.4],
    pawn: ['floor-pawn', 128, 128, (g) => {
      g.fillStyle = '#3d3a44'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#4a4652'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64);
    }, 1.0],
  }[kind];
  {
    const [key, w, h, draw, size] = floorTex;
    const t = canvasTex(`${key}-${Math.round(hw * 2)}x${Math.round(zb)}`, w, h, draw);
    t.repeat.set((hw * 2) / size, zb / (size * (h / w)));
    t.anisotropy = 4;
    r.floorMesh.material = texMat(t);
    const ct = canvasTex(`ceil-${Math.round(hw * 2)}x${Math.round(zb)}`, 128, 128, (g) => {
      g.fillStyle = '#e9e6df'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,.05)';
      for (let k = 0; k < 40; k++) g.fillRect((k * 37) % 128, (k * 53) % 128, 2, 2); // (the speckle)
      g.strokeStyle = '#b9b6ad'; g.lineWidth = 5; g.strokeRect(0, 0, 128, 128);
    });
    ct.repeat.set((hw * 2) / 1.2, zb / 1.2);
    r.ceilMesh.material = texMat(ct);
  }
  // (baseboards and a band of the store's color round the walls)
  const base = kind === 'market' ? 0x7d8a86 : 0x2e2a26;
  B(-W, -W + 0.03, 0, 0.14, 0.2, zb, base);
  B(W - 0.03, W, 0, 0.14, 0.2, zb, base);
  B(-W, W, 0, 0.14, zb - 0.03, zb, base);
  for (const [y0, y1, c] of [[2.62, 2.82, accent], [2.84, 2.88, 0xf2f0ea]]) {
    B(-W, -W + 0.025, y0, y1, 0.2, zb, c);
    B(W - 0.025, W, y0, y1, 0.2, zb, c);
    B(-W, W, y0, y1, zb - 0.025, zb, c);
  }
  // (a dome mirror up in the front corner, to see round the aisles)
  S(-W + 0.35, H - 0.32, 0.55, 0.24, 0xc9d1d6, 0.6);
  B(-W + 0.3, -W + 0.4, H - 0.2, H, 0.5, 0.6, 0x777777);
  // (a wall clock)
  {
    const face = sheet('clock', 128, 128, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#111';
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 5, 4, 10); }
      g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + 26, 64 - 20); g.moveTo(64, 64); g.lineTo(60, 26); g.stroke();
    });
    const cz = kind === 'pawn' ? 6.6 : kind === 'liquor' ? 0.9 : 1.0;
    C(-W + 0.03, 3.15, cz, 0.22, 0.05, 0x1a1a1a, 'x', 20);
    P(0.4, 0.4, -W + 0.06, 3.15, cz, 'x+', face);
  }
  // (a trash can by the door)
  C(1.3, 0.36, 0.55, 0.22, 0.72, 0x3a4a3a, 'y', 14, 0.19);
  C(1.3, 0.73, 0.55, 0.23, 0.04, 0x222222, 'y', 14);
  // (the back door: EXIT over it, an extinguisher beside it)
  const exitM = new THREE.MeshBasicMaterial({ map: textTex(canvasTex, 'exit', 128, 48, '#0b6b2e', [['EXIT', 34, '#e9ffe9']]) });
  const ext = (x, z, face) => {
    const [ox, oz] = face === 'z-' ? [0, -0.12] : face === 'x+' ? [0.12, 0] : [-0.12, 0];
    C(x + ox, 0.62, z + oz, 0.085, 0.5, 0xc0201a, 'y', 10);
    C(x + ox, 0.92, z + oz, 0.03, 0.1, 0x222222, 'y', 6);
    B(x + ox * 0.4 - 0.05, x + ox * 0.4 + 0.05, 0.4, 1.0, z + oz * 0.4 - 0.05, z + oz * 0.4 + 0.05, 0x555555);
  };
  if (r.backDoor) {
    const mx = (BR.door[0] + BR.door[1]) / 2;
    B(mx - 0.22, mx + 0.22, 2.58, 2.76, BR.z0 - 0.16, BR.z0 - 0.1, 0x0d3d1c);
    P(0.4, 0.15, mx, 2.67, BR.z0 - 0.165, 'z-', exitM);
    ext(BR.door[0] - 0.4, BR.z0 - 0.02, 'z-');
  } else ext(-W + 0.02, zb - 1.4, 'x+');

  // ---- Shared bits for the stores with aisles ----
  const goodsTex = (key, colors) => sheet(key, 128, 128, (g, rnd) => {
    g.fillStyle = '#8a6a44'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) {
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      g.fillRect(x + 2, y + 2, 28, 28);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 6, y + 8, 20, 6);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 2, y + 28, 28, 2);
    }
  });
  const aisleSign = (x, z, n, words) => {
    const m = tex(`aisle-${kind}-${n}`, 256, 96, '#f7f5ef', [[`${n}`, 44, accent ? `#${accent.toString(16).padStart(6, '0')}` : '#c00'], [words, 22, '#222', 800]], { border: '#333' });
    B(x - 0.62, x + 0.62, 2.92, 3.34, z - 0.02, z + 0.02, 0xf7f5ef);
    P(1.2, 0.4, x, 3.13, z - 0.03, 'z-', m);
    P(1.2, 0.4, x, 3.13, z + 0.03, 'z+', m);
    for (const sx of [-0.5, 0.5]) B(x + sx - 0.006, x + sx + 0.006, 3.34, H, z - 0.006, z + 0.006, 0x444444);
  };
  const AISLES = {
    mart: ['CHIPS · CANDY', 'SNACKS · BREAD', 'HOUSEHOLD'],
    market: ['CEREAL · BREAKFAST', 'CANNED · PASTA', 'SNACKS · SODA'],
    deli: ['CHIPS · CANDY', 'GROCERY', 'HOUSEHOLD'],
  }[kind];
  if (AISLES && r.aisleXs) {
    const [az0, az1] = r.aisleZ;
    r.aisleXs.forEach((x, i) => {
      aisleSign(x, (az0 + az1) / 2, i + 1, AISLES[i] || 'GROCERY');
      // (an end cap facing the door: cases of something on special, a price card on top)
      B(x - 0.42, x + 0.42, 0, 0.12, az0 - 0.42, az0, 0x6a6a6a);
      if (d.S) {
        // (cases of soda stacked up, each with its label to the front; a step back up top)
        const [c1, c2] = [[0xc1121f, 0xffffff], [0x1d4e89, 0xe9ecef], [0x2b9348, 0xffd60a]][i % 3];
        for (let lay = 0; lay < 6; lay++) {
          const step = lay >= 4;
          for (let a = 0; a < 3; a++) for (let b = step ? 1 : 0; b < 2; b++) {
            const cx = x - 0.27 + a * 0.27;
            const cz = az0 - 0.105 - b * 0.2;
            const y = 0.12 + lay * 0.13;
            d.S.add('box', cx, y, cz, 0.26, 0.125, 0.19, lay % 2 ? c1 : c2 === 0xffffff ? 0xe63946 : c1, 0);
            if (b === (step ? 1 : 0) || true) if (b === 0 || step) d.S.add('box', cx, y + 0.03, cz - 0.096, 0.2, 0.06, 0.004, c2, 0);
          }
        }
      } else {
        const ec = goodsTex(`endcap-${i}`, [['#e74c3c', '#f1c40f'], ['#3498db', '#ecf0f1'], ['#27ae60', '#f39c12']][i % 3]);
        const g = new THREE.BoxGeometry(0.84, 1.1, 0.4);
        g.translate(x, 0.67, az0 - 0.21);
        add(g, ec);
      }
      const card = tex(`deal-${i}`, 128, 64, '#ffd23f', [[['2 FOR $5', '$1.99', 'SALE'][i % 3], 26, '#b71c1c']], { border: '#b71c1c' });
      B(x - 0.3, x + 0.3, 1.22, 1.5, az0 - 0.22, az0 - 0.2, 0xffd23f);
      P(0.6, 0.28, x, 1.36, az0 - 0.225, 'z-', card);
    });
  }
  // (over the coolers: a lit header saying what's in them)
  const header = (key, text, x0, x1, z0, z1, face) => {
    const len = face[0] === 'x' ? z1 - z0 : x1 - x0;
    const m = tex(`hdr-${key}`, 512, 64, `#${accent.toString(16).padStart(6, '0')}`, [[text, 34, '#fff']]);
    const [x, z] = [(x0 + x1) / 2, (z0 + z1) / 2];
    P(len, 0.36, x, 2.48, z, face, m);
  };

  // ---- Each kind ----
  if (kind === 'mart' || kind === 'market' || kind === 'deli') {
    const cx0 = r.counterX0;
    const z1 = r.counterZ1;
    // (the counter's front: a panel in the store's colors; a candy rack in front of it)
    const panel = tex(`counter-${r.name}`, 256, 128, `#${accent.toString(16).padStart(6, '0')}`, [[r.name.toUpperCase(), 30, '#fff'], ['THANK YOU · COME AGAIN', 16, '#ffe9a8', 700]]);
    P(z1 - 1.4, 0.7, cx0 - 0.012, 0.5, (1.4 + z1) / 2, 'x-', panel);
    const candy = sheet('candy', 128, 128, (g, rnd) => {
      g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 128, 128);
      const c = ['#e74c3c', '#f1c40f', '#8e44ad', '#2ecc71', '#e67e22', '#3498db', '#ecf0f1'];
      for (let y = 4; y < 128; y += 25) {
        g.fillStyle = '#777'; g.fillRect(0, y + 20, 128, 3);
        for (let x = 3; x < 124; x += 9) { g.fillStyle = c[Math.floor(rnd() * c.length)]; g.fillRect(x, y + 4, 7, 16); }
      }
    });
    {
      const zc0 = 3.85;
      const zc1 = Math.min(z1 - 0.15, 5.2);
      B(cx0 - 0.32, cx0 - 0.02, 0, 0.08, zc0, zc1, 0x333333);
      if (d.S) {
        // (a rack of little shelves: candy, gum, small bags)
        B(cx0 - 0.05, cx0 - 0.02, 0.08, 1.15, zc0, zc1, 0x333333);
        for (const zz of [zc0, zc1 - 0.02]) B(cx0 - 0.32, cx0 - 0.02, 0.08, 1.15, zz, zz + 0.02, 0x444444);
        B(cx0 - 0.32, cx0 - 0.02, 1.13, 1.17, zc0, zc1, 0xc0392b);
        for (const y of [0.1, 0.36, 0.62, 0.88]) {
          B(cx0 - 0.32, cx0 - 0.05, y - 0.015, y, zc0, zc1, 0x555555);
          B(cx0 - 0.33, cx0 - 0.32, y - 0.04, y + 0.03, zc0, zc1, 0xf2f2ee);
          shelfRun(d.S, { x0: cx0 - 0.32, z0: zc0 + 0.03, ux: 0, uz: 1, nx: 1, nz: 0, len: zc1 - zc0 - 0.06, y, depth: 0.26, height: 0.22, goods: y > 0.8 ? ['candy'] : ['candy', 'snack'], rows: 1, gap: 0.006 });
        }
      } else {
        const g = new THREE.BoxGeometry(0.3, 1.05, zc1 - zc0);
        g.translate(cx0 - 0.17, 0.6, (zc0 + zc1) / 2);
        add(g, candy);
      }
    }
    // (on the counter: the card reader, a tip jar, gum by the register)
    B(cx0 + 0.1, cx0 + 0.26, 1.0, 1.06, 2.75, 2.95, 0x1a1a1a);
    B(cx0 + 0.12, cx0 + 0.24, 1.06, 1.16, 2.8, 2.9, 0x111111, 0.4);
    P(0.08, 0.05, cx0 + 0.11, 1.12, 2.85, 'x-', lit(0x58d68d));
    const jar = new THREE.MeshLambertMaterial({ color: 0xd8eef5, transparent: true, opacity: 0.45, depthWrite: false });
    C(cx0 + 0.18, 1.1, 3.75, 0.07, 0.2, jar, 'y', 12);
    B(cx0 + 0.13, cx0 + 0.23, 1.0, 1.06, 3.72, 3.78, 0x6f9a5a);
    B(cx0 + 0.08, cx0 + 0.35, 1.0, 1.18, 1.55, 1.95, candy);
    if (kind === 'market') B(cx0 - 0.04, cx0 + 0.6, 1.0, 1.02, 3.2, z1 - 0.1, 0x141414); // (the checkout belt)
    // (behind the counter, over the cigarettes: WE CARD)
    P(1.2, 0.5, W - 0.05, 2.75, 2.6, 'x-', tex('wecard', 256, 108, '#fff', [['WE CARD', 34, '#b71c1c'], ['UNDER 21? NO SALE', 16, '#222', 700]], { border: '#b71c1c' }));
    // (coolers: the header over the back and the left)
    header(`${kind}-b`, kind === 'market' ? 'DAIRY · FROZEN · DRINKS' : 'BEER · SODA · WATER', -W, BR.x0 - 0.2, zb - 0.78, zb - 0.78, 'z-');
    header(`${kind}-l`, 'COLD DRINKS', -W + 0.78, -W + 0.78, 1.6, zb - 1.0, 'x+');
    // (the back room's wall: LOTTO, and smile, you're on camera)
    P(1.0, 0.8, BR.x1 - 1.4, 1.75, BR.z0 - 0.1, 'z-', tex('lotto', 200, 160, '#1a3d8f', [['LOTTO', 46, '#ffd23f'], ['PLAY HERE', 24, '#fff'], ['$1 · $2 · $5', 18, '#9fd3ff', 700]], { border: '#ffd23f' }));
    P(0.9, 0.6, BR.x0 - 0.1, 1.9, BR.z0 + 1.3, 'x-', tex('smile', 200, 132, '#fff', [['SMILE!', 38, '#111'], ["YOU'RE ON CAMERA", 18, '#c0392b', 800]], { border: '#111' }));
    if (kind === 'mart' || kind === 'deli') {
      // Coffee and hot food along the right wall, past the counter: coffee, the hot dog roller,
      // a slushie machine (someone always stops for one).
      const z0 = z1 + 0.6;
      const zE = Math.min(BR.z0 - 0.5, z0 + 3.0);
      d.box(W - 0.65, W, 0, 0.92, z0, zE, 0x5a4632, { solid: true });
      B(W - 0.7, W, 0.92, 0.97, z0 - 0.05, zE + 0.05, 0x2b2b2b);
      // coffee maker: body, a lit panel, pots
      B(W - 0.5, W - 0.05, 0.97, 1.55, z0 + 0.2, z0 + 0.75, 0x161616);
      P(0.3, 0.08, W - 0.505, 1.45, z0 + 0.47, 'x-', lit(0xff4d3a));
      for (const k of [0, 1]) C(W - 0.32, 1.08, z0 + 0.33 + k * 0.28, 0.07, 0.2, jar, 'y', 10);
      // cups and lids
      for (const k of [0, 1, 2]) C(W - 0.25, 1.12, z0 + 0.95 + k * 0.14, 0.045, 0.3, 0xf3efe6, 'y', 10, 0.035);
      // the roller: hot dogs turning (well, sitting) under a light
      const zr = z0 + 1.55;
      B(W - 0.58, W - 0.08, 0.97, 1.08, zr, zr + 0.55, 0x9a9da1);
      for (let k = 0; k < 6; k++) C(W - 0.33, 1.11, zr + 0.06 + k * 0.085, 0.022, 0.42, 0xb4532a, 'x', 8);
      B(W - 0.6, W - 0.06, 1.32, 1.36, zr - 0.02, zr + 0.57, 0xd0d0d0);
      for (const zz of [zr, zr + 0.55]) B(W - 0.1, W - 0.06, 1.08, 1.32, zz - 0.02, zz + 0.02, 0x9a9da1);
      // the slushie machine: two tanks, blue and red
      if (zE - (zr + 0.6) > 0.6) {
        const zs = zr + 0.75;
        B(W - 0.55, W - 0.05, 0.97, 1.25, zs, zs + 0.6, 0xd8d8d8);
        for (const [k, c] of [[0, 0x2f80ed], [1, 0xe03a3a]]) {
          const m = new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.85 });
          C(W - 0.3, 1.5, zs + 0.15 + k * 0.3, 0.12, 0.5, m, 'y', 12);
        }
        B(W - 0.55, W - 0.05, 1.75, 1.95, zs, zs + 0.6, 0xf2f2f2);
        P(0.5, 0.16, W - 0.555, 1.85, zs + 0.3, 'x-', tex('slush', 192, 64, '#2f80ed', [['FROZEN DRINKS', 22, '#fff']]));
      }
      header(`coffee-${kind}`, 'COFFEE · HOT FOOD', W - 0.02, W - 0.02, z0, zE, 'x-');
      r.browse.push([W - 1.2, z0 + 1.0, [1, 0]]);
    }
    if (kind === 'mart') {
      // An ATM in the front corner, an ice freezer under the left window, papers by the door.
      d.box(-W + 0.02, -W + 0.64, 0, 1.62, 0.32, 1.12, 0x3b4654, { solid: true });
      B(-W + 0.62, -W + 0.68, 0.95, 1.05, 0.42, 1.02, 0x2a2f36);
      P(0.4, 0.3, -W + 0.645, 1.3, 0.72, 'x+', lit(0x2e86de));
      P(0.6, 0.2, -W + 0.645, 1.75, 0.72, 'x+', tex('atm', 192, 64, '#0e5aa7', [['ATM', 36, '#fff']]));
      B(-W + 0.6, -W + 0.66, 1.66, 1.86, 0.42, 1.02, 0x0e5aa7);
      d.box(-W + 1.0, -2.4, 0, 0.88, 0.3, 0.95, 0xf4f6f7, { solid: true });
      B(-W + 1.0, -2.4, 0.88, 0.92, 0.28, 0.97, 0xd5dbe0);
      P(1.4, 0.36, (-W + 1.0 - 2.4) / 2, 0.5, 0.955, 'z+', tex('ice', 256, 64, '#f4f6f7', [['❄ ICE ❄', 34, '#1f7ae0']]));
      B(1.85, 2.85, 0, 0.06, 0.3, 0.65, 0x555555);
      for (const [k, c] of [[0, 0xe8e4da], [1, 0xdcd6c8], [2, 0xefe9db]]) B(1.9 + k * 0.32, 2.16 + k * 0.32, 0.06, 0.62 + k * 0.05, 0.35, 0.6, c);
      for (const x of [1.87, 2.83]) B(x - 0.015, x + 0.015, 0, 1.0, 0.33, 0.62, 0x666666);
      P(0.9, 0.2, 2.35, 0.9, 0.66, 'z+', tex('papers', 192, 48, '#222', [['DAILY NEWS', 22, '#fff']]));
    }
    if (kind === 'market') {
      // Produce under the left window, carts and baskets by the door, the store's banner.
      const fruit = (key, cols) => sheet(key, 128, 64, (g, rnd) => {
        g.fillStyle = '#6b4a2a'; g.fillRect(0, 0, 128, 64);
        for (let k = 0; k < 90; k++) {
          g.fillStyle = cols[Math.floor(rnd() * cols.length)];
          g.beginPath(); g.arc(rnd() * 128, rnd() * 64, 5 + rnd() * 3, 0, Math.PI * 2); g.fill();
        }
      });
      const crates = [['apples', ['#c0392b', '#e74c3c', '#a93226']], ['oranges', ['#e67e22', '#f39c12']], ['greens', ['#27ae60', '#2ecc71', '#1e8449']], ['lemons', ['#f4d03f', '#f7dc6f']]];
      const cx = -W + 0.9;
      const cw = (-2.0 - cx) / crates.length;
      crates.forEach(([n, cols], k) => {
        const x0 = cx + k * cw;
        d.box(x0 + 0.03, x0 + cw - 0.03, 0, 0.62, 0.3, 1.1, 0x7a5a32, { solid: k === 0 });
        const g = new THREE.BoxGeometry(cw - 0.1, 0.06, 0.8);
        g.rotateX(-0.32);
        g.translate(x0 + cw / 2, 0.75, 0.7);
        add(g, fruit(`fruit-${n}`, cols));
        P(cw - 0.2, 0.14, x0 + cw / 2, 0.45, 1.105, 'z+', tex(`price-${n}`, 128, 40, '#fff', [[`${n.toUpperCase()} ${['$1.29/lb', '89¢', '$1.99', '3/$1'][k]}`, 15, '#1e8449']]));
      });
      P(1.6, 0.5, (cx - 2.0) / 2, 1.85, 0.25, 'z+', tex('fresh', 256, 80, '#2c3e2e', [['FRESH PRODUCE', 30, '#f6f1d1']], { border: '#d4c27a' }));
      // carts
      const cart = (x, z) => {
        const m = 0x9aa3ab;
        B(x - 0.28, x + 0.28, 0.45, 0.47, z - 0.4, z + 0.4, m);
        for (const sx of [-0.28, 0.28]) B(x + sx - 0.01, x + sx + 0.01, 0.45, 0.95, z - 0.4, z + 0.4, m);
        for (const sz of [-0.4, 0.4]) B(x - 0.28, x + 0.28, 0.45, 0.95, z + sz - 0.01, z + sz + 0.01, m);
        B(x - 0.3, x + 0.3, 1.0, 1.04, z - 0.47, z - 0.43, 0xc0392b);
        for (const [sx, sz] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]]) C(x + sx, 0.06, z + sz, 0.05, 0.03, 0x222222, 'x', 8);
      };
      cart(1.45, 0.75);
      cart(1.45, 0.95);
      for (let k = 0; k < 4; k++) B(-1.55, -1.05, 0.02 + k * 0.1, 0.12 + k * 0.1, 0.35, 0.7, 0xc0392b);
      // the banner, hung across the store
      const bz = 2.2;
      P(4.2, 0.6, -1.5, 3.05, bz, 'z-', tex('banner', 512, 72, '#1e8449', [['HILLTOP MARKET · FRESH EVERY DAY', 30, '#fff']]));
      for (const sx of [-3.4, 0.4]) B(sx - 0.005, sx + 0.005, 3.35, H, bz - 0.005, bz + 0.005, 0x444444);
    }
    if (kind === 'deli') {
      // The menu board over the deli case, salamis hanging, a window ledge with stools, and
      // bunting across the ceiling.
      const x0 = -W + 1.0;
      const x1 = BR.x0 - 0.6;
      const menu = sheet('menu', 512, 192, (g) => {
        g.fillStyle = '#151515'; g.fillRect(0, 0, 512, 192);
        g.strokeStyle = '#c8a24a'; g.lineWidth = 6; g.strokeRect(4, 4, 504, 184);
        g.fillStyle = '#ffd23f'; g.font = '900 30px Arial Black, Arial'; g.textAlign = 'center'; g.fillText("TONY'S DELI", 256, 38);
        g.font = '700 19px Arial'; g.textAlign = 'left';
        const items = [['Italian Hero', '9.99'], ['Chopped Cheese', '7.50'], ['Turkey Club', '8.75'], ['BEC on a Roll', '4.50'], ['Pastrami on Rye', '11.25'], ['Coffee (any size)', '1.50']];
        items.forEach(([n, p], k) => {
          const x = k < 3 ? 22 : 270;
          const y = 78 + (k % 3) * 36;
          g.fillStyle = '#f2f2f2'; g.fillText(n, x, y);
          g.fillStyle = '#7ee081'; g.textAlign = 'right'; g.fillText(`$${p}`, x + 224, y); g.textAlign = 'left';
        });
      });
      P(x1 - x0, 0.9, (x0 + x1) / 2, 2.95, zb - 2.2, 'z-', menu);
      B(x0, x1, 2.48, 2.5, zb - 2.18, zb - 2.12, 0x333333);
      for (let k = 0; k < 5; k++) {
        const x = x0 + 0.5 + k * ((x1 - x0 - 1) / 4);
        C(x, 2.15, zb - 2.15, 0.06, 0.4, 0x7a2a1a, 'y', 10);
        B(x - 0.005, x + 0.005, 2.35, 2.5, zb - 2.155, zb - 2.145, 0xd8c7a0);
      }
      // ledge and stools
      B(-W + 0.85, -1.85, 1.0, 1.05, 0.22, 0.6, 0x6b4a30);
      for (let k = 0; k < 3; k++) {
        const x = -W + 1.6 + k * 1.5;
        C(x, 0.38, 0.95, 0.025, 0.76, 0x888888, 'y', 8);
        C(x, 0.78, 0.95, 0.18, 0.06, 0xb03a2e, 'y', 14);
        C(x, 0.03, 0.95, 0.16, 0.04, 0x666666, 'y', 12);
      }
      // bunting: little flags in green, white and red on a string across the store
      for (const bz of [3.2, 7.6]) {
        B(-W, W, 3.28, 3.29, bz - 0.005, bz + 0.005, 0x333333);
        for (let x = -W + 0.3, k = 0; x < W - 0.2; x += 0.42, k++) {
          const g = new THREE.ConeGeometry(0.1, 0.2, 3);
          g.rotateX(Math.PI);
          g.scale(1, 1, 0.15);
          g.translate(x, 3.16, bz);
          add(g, [0x1f8a3a, 0xf4f4f4, 0xc0392b][k % 3]);
        }
      }
    }
  } else if (kind === 'liquor') {
    const gz = r.boothZ;
    // Neon over the left wall's bottles, a WE CARD sticker on the glass, cases of beer stacked
    // under the window, a barrel, a TV up in the booth.
    P(2.2, 0.55, -W + 0.56, 3.0, 4.0, 'x+', neon('neon-beer', 256, 64, [['COLD BEER', 40, '#ff4fd8']]));
    P(2.0, 0.55, -W + 0.56, 3.0, 8.4, 'x+', neon('neon-liquor', 256, 64, [['LIQUOR', 44, '#4fd2ff']]));
    P(2.2, 0.5, 0.3, 3.15, gz - 0.02, 'z-', neon('neon-lotto', 256, 56, [['LOTTERY', 36, '#ffd23f']]));
    P(0.55, 0.38, 2.9, 1.5, gz - 0.005, 'z-', tex('wecard30', 128, 88, '#fff', [['WE CARD', 22, '#b71c1c'], ['UNDER 30', 16, '#222', 800]], { border: '#b71c1c' }));
    P(0.7, 0.3, -0.7, 1.5, gz - 0.005, 'z-', tex('nochecks', 160, 64, '#ffd23f', [['NO CHECKS', 20, '#111'], ['CASH · CARDS', 14, '#111', 700]]));
    const caseM = sheet('beercase', 128, 64, (g) => {
      g.fillStyle = '#b9925a'; g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#1f4fa3'; g.fillRect(0, 18, 128, 26);
      g.fillStyle = '#fff'; g.font = '900 18px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('LAGER 24', 64, 37);
    });
    for (let s = 0; s < 3; s++) {
      const x0 = -W + 1.1 + s * 0.9;
      for (let k = 0; k < 4 - (s % 2); k++) {
        const g = new THREE.BoxGeometry(0.8, 0.26, 0.55);
        g.rotateY((k % 2 ? 0.06 : -0.04) * (s + 1));
        g.translate(x0 + 0.4, 0.13 + k * 0.26, 0.62);
        add(g, caseM);
      }
    }
    C(-W + 2.9, 0.48, gz + 0.8, 0.36, 0.95, 0x6b4423, 'y', 16, 0.32);
    for (const y of [0.15, 0.8]) C(-W + 2.9, y, gz + 0.8, 0.365, 0.05, 0x333333, 'y', 16);
    C(-W + 2.9, 0.97, gz + 0.8, 0.33, 0.02, 0x5a3a1e, 'y', 16);
    for (let k = 0; k < 5; k++) C(-W + 2.75 + (k % 3) * 0.13, 1.1, gz + 0.72 + Math.floor(k / 3) * 0.16, 0.035, 0.26, [0x2e4d2e, 0x5a1a1a, 0x7a3e12][k % 3], 'y', 8);
    // the booth's TV, up in the corner
    B(W - 0.55, W - 0.05, 2.55, 2.95, gz + 0.55, gz + 1.25, 0x111111);
    P(0.6, 0.32, W - 0.56, 2.75, gz + 0.9, 'x-', lit(0x3d6fa5));
    B(W - 0.1, W, 2.7, 2.8, gz + 0.85, gz + 0.95, 0x333333);
    header('liq-b', 'WINE · SPIRITS', -W + 0.6, r.boothX0 - 0.4, zb - 0.78, zb - 0.78, 'z-');
  } else if (kind === 'pawn') {
    // WE BUY GOLD in neon over the guitars, an electronics wall down the right (TVs, speakers,
    // a stereo), a bike hung up on the left, a pegboard of tools.
    P(3.4, 0.6, -W + 2.8, 3.15, zb - 0.07, 'z-', neon('neon-gold', 384, 72, [['WE BUY GOLD', 46, '#ffd23f']]));
    P(1.6, 0.6, BR.x0 - 1.5, 2.95, zb - 0.07, 'z-', tex('loans', 220, 82, '#7d3c98', [['CASH LOANS', 28, '#fff'], ['FAST · NO CREDIT', 14, '#ffd23f', 800]], { border: '#ffd23f' }));
    const z0 = 1.0;
    const zE = BR.z0 - 0.6;
    for (const y of [0.45, 1.15, 1.85]) B(W - 0.55, W - 0.02, y - 0.03, y, z0, zE, 0x5a4632);
    for (const z of [z0, (z0 + zE) / 2, zE]) B(W - 0.55, W - 0.02, 0, 1.95, z - 0.03, z, 0x4a3a28);
    const tv = (y, z, w, h) => {
      B(W - 0.45, W - 0.12, y, y + h, z - w / 2, z + w / 2, 0x151515);
      P(w - 0.08, h - 0.08, W - 0.455, y + h / 2, z, 'x-', lit(0x22344a));
      P(0.18, 0.06, W - 0.456, y + 0.15, z + w / 2 - 0.2, 'x-', tex('tag', 64, 24, '#ffd23f', [['$80', 16, '#111']]));
    };
    tv(1.15, z0 + 0.9, 0.9, 0.55);
    tv(1.15, z0 + 2.2, 1.1, 0.62);
    tv(1.85, z0 + 1.4, 0.8, 0.5);
    for (let k = 0; k < 3; k++) {
      const z = (z0 + zE) / 2 + 0.6 + k * 0.7;
      B(W - 0.42, W - 0.12, 0.45, 0.95, z - 0.18, z + 0.18, 0x2a2a2a);
      C(W - 0.425, 0.78, z, 0.09, 0.02, 0x555555, 'x', 12);
      C(W - 0.425, 0.58, z, 0.06, 0.02, 0x555555, 'x', 12);
    }
    B(W - 0.45, W - 0.1, 1.15, 1.3, zE - 1.4, zE - 0.5, 0x333333);
    P(0.3, 0.05, W - 0.455, 1.24, zE - 0.95, 'x-', lit(0x58d68d));
    B(W - 0.48, W - 0.12, 0.45, 0.75, z0 + 0.3, z0 + 0.9, 0xd0d0d0);
    r.browse.push([W - 1.25, z0 + 1.5, [1, 0]], [W - 1.25, (z0 + zE) / 2 + 1.2, [1, 0]]);
    // the bike
    {
      const bx = -W + 0.12;
      const y = 2.6;
      const m = 0xc0392b;
      for (const z of [2.0, 3.1]) {
        const g = new THREE.TorusGeometry(0.33, 0.025, 6, 20);
        g.rotateY(Math.PI / 2);
        g.translate(bx, y, z);
        add(g, 0x1a1a1a);
      }
      const bar = (za, ya, zb2, yb) => {
        const len = Math.hypot(zb2 - za, yb - ya);
        const g = new THREE.CylinderGeometry(0.02, 0.02, len, 6);
        g.rotateX(Math.atan2(zb2 - za, yb - ya));
        g.translate(bx, (ya + yb) / 2, (za + zb2) / 2);
        add(g, m);
      };
      bar(2.0, y, 2.55, y);
      bar(2.55, y, 2.75, y + 0.38);
      bar(2.0, y, 2.6, y + 0.38);
      bar(2.6, y + 0.38, 3.1, y);
      bar(3.1, y, 3.05, y + 0.45);
      B(bx - 0.04, bx + 0.04, y + 0.38, y + 0.42, 2.5, 2.75, 0x111111);
      B(-W, -W + 0.06, y + 0.55, y + 0.6, 2.0, 2.1, 0x777777);
      B(-W, -W + 0.06, y + 0.55, y + 0.6, 3.0, 3.1, 0x777777);
    }
    // the pegboard of tools
    const peg = sheet('pegboard', 256, 128, (g) => {
      g.fillStyle = '#b08a5a'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 6; y < 128; y += 12) for (let x = 6; x < 256; x += 12) g.fillRect(x, y, 2, 2);
      const tool = (x, c, w, h) => { g.fillStyle = c; g.fillRect(x, 20, w, h); };
      tool(16, '#c0392b', 10, 70); tool(14, '#555', 14, 18);
      tool(50, '#f39c12', 26, 40); tool(58, '#222', 10, 50);
      tool(100, '#888', 6, 80); tool(96, '#2c3e50', 14, 22);
      tool(140, '#e67e22', 34, 26); tool(150, '#333', 12, 60);
      tool(200, '#27ae60', 22, 34); tool(206, '#777', 8, 58);
      g.fillStyle = '#fff'; g.font = '900 13px Arial'; g.fillText('TOOLS · $5 & UP', 150, 120);
    });
    P(2.2, 1.1, -W + 0.03, 1.85, 6.6, 'x+', peg);
    P(1.2, 0.45, -W + 0.03, 1.0, 9.0, 'x+', tex('norefund', 220, 82, '#fff', [['NO REFUNDS', 26, '#b71c1c'], ['ALL SALES FINAL', 15, '#222', 800]], { border: '#b71c1c' }));
  }

  K.flush();
}
