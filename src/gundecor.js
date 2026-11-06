import * as THREE from 'three';
import { kit } from './storedecor.js';
import { Stock, shelfRun } from './stock.js';

// The gun shops' dressing (interiors.js builds them): a floor and a ceiling with some texture
// to them, trim, the pegboard behind the guns, posters (safety, range rules, buy / sell /
// trade), a trophy head and a flag up high, ammo on shelves behind the counter, holsters and
// scopes on a slatwall, a plate carrier on a stand by the window, odds and ends on the counter;
// and in the range, the rules, ear muffs on hooks, and baffles across the ceiling. Static and
// merged per material (storedecor.js kit), so it costs a few draw calls a shop.
//
// d: { r, root, rg, L, shop, imat, floorMesh, ceilMesh, W, SX, BACK, H, COUNTER, SIDE_DOOR,
//      PART, D, BOOTH }

const TEX = {};
function canvasTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  draw(g, rnd);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX[key] = t;
  return t;
}
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export function decorateGunShop(d) {
  const { r, root, rg, L, shop, imat, W, SX, BACK, H, COUNTER, SIDE_DOOR, PART, D, BOOTH } = d;
  // (textured materials glow with the rest: interiors.js glow() scales r.papers)
  const texMat = (t) => {
    const m = new THREE.MeshLambertMaterial({ map: t, emissiveMap: t });
    r.papers.push(m);
    return m;
  };
  const K = kit(root, imat, texMat, canvasTex);
  const { add, B, C, P, tex, sheet, lit } = K;

  // ---- Floor and ceiling ----
  const fc = new THREE.Color(L.floor);
  const ft = canvasTex(`gfloor-${shop.i}`, 256, 128, (g, rnd) => {
    // (wide planks in the shop's floor color)
    for (let y = 0; y < 128; y += 21) {
      const off = (y / 21) % 2 ? 0 : 110;
      for (let x = -off; x < 256; x += 220) {
        const k = 0.85 + rnd() * 0.3;
        g.fillStyle = `rgb(${Math.min(255, fc.r * 255 * k)},${Math.min(255, fc.g * 255 * k)},${Math.min(255, fc.b * 255 * k)})`;
        g.fillRect(x, y, 220, 21);
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(x, y + 20, 220, 1);
        g.fillRect(x + 219, y, 1, 21);
        g.fillStyle = 'rgba(0,0,0,.08)';
        for (let k2 = 0; k2 < 4; k2++) g.fillRect(x + rnd() * 200, y + 4 + rnd() * 12, 30 + rnd() * 40, 1);
      }
    }
  });
  ft.repeat.set((W + SX) / 2.6, BACK / 1.3);
  d.floorMesh.material = texMat(ft);
  const ct = canvasTex('gceil', 128, 128, (g) => {
    g.fillStyle = '#dedad2'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#aaa69c'; g.lineWidth = 5; g.strokeRect(0, 0, 128, 128);
  });
  ct.repeat.set(30, 9);
  d.ceilMesh.material = texMat(ct);
  // (a band of the trim color round the walls, under the ceiling)
  for (const [y0, y1, c] of [[3.05, 3.2, L.trim], [3.22, 3.26, 0xe8e2d0]]) {
    B(-W, -W + 0.03, y0, y1, 0, BACK, c);
    B(SX - 0.03, SX, y0, y1, 0, SIDE_DOOR[0] - 0.1, c);
    B(SX - 0.03, SX, y0, y1, SIDE_DOOR[1] + 0.1, BACK, c);
  }

  // ---- The wall of guns: a pegboard behind them ----
  const peg = texMat(canvasTex(`gpeg-${shop.i}`, 256, 64, (g) => {
    const c = new THREE.Color(0x9a8a6e);
    g.fillStyle = hex(c.getHex()); g.fillRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(0,0,0,.4)';
    for (let y = 4; y < 64; y += 8) for (let x = 4; x < 256; x += 8) g.fillRect(x, y, 2, 2);
  }));
  peg.map.repeat.set(4, 1);
  P(8.2, 2.1, -2.5, 1.95, BACK - 0.065, 'z-', peg);
  // (ammo on shelves behind the counter, right of the gate)
  {
    const x0 = COUNTER.x1 + 0.4;
    const x1 = SX - 0.2;
    // (a wooden shelf unit, boxes of rounds on every shelf, stacked three high)
    d.box(x0, x1, 0, 2.3, BACK - 0.5, BACK, 0x4a3a2a, { solid: true }).visible = false;
    B(x0, x1, 0, 2.3, BACK - 0.06, BACK - 0.02, 0x3b2f25);
    for (const xx of [x0, x1 - 0.04]) B(xx, xx + 0.04, 0, 2.3, BACK - 0.5, BACK - 0.02, 0x4a3a2a);
    B(x0, x1, 2.26, 2.3, BACK - 0.5, BACK - 0.02, 0x4a3a2a);
    const S = new Stock(17 + shop.i);
    for (const y of [0.08, 0.52, 0.96, 1.4, 1.84]) {
      B(x0 + 0.04, x1 - 0.04, y - 0.03, y, BACK - 0.5, BACK - 0.06, 0x6e5a42);
      B(x0 + 0.04, x1 - 0.04, y - 0.06, y, BACK - 0.51, BACK - 0.5, 0xf2efe6); // (the price strip)
      shelfRun(S, { x0: x0 + 0.07, z0: BACK - 0.5, ux: 1, uz: 0, nx: 0, nz: 1, len: x1 - x0 - 0.14, y, depth: 0.4, height: 0.4, goods: ['ammo'], rows: 2, gap: 0.01 });
    }
    S.build(root);
    P(2.0, 0.34, (x0 + x1) / 2, 2.55, BACK - 0.03, 'z-', tex('ammo-hdr', 256, 44, hex(L.trim), [['AMMUNITION', 26, '#ffd23f']]));
  }
  // (a slatwall on the right of holsters, scopes and lights)
  const slat = sheet('gslat', 256, 128, (g, rnd) => {
    g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a3a3a';
    for (let y = 0; y < 128; y += 10) g.fillRect(0, y, 256, 6);
    const item = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, w, 2); };
    for (let k = 0; k < 7; k++) item(10 + k * 35, 14, 22, 30, ['#4a3020', '#111', '#5a4632'][k % 3]); // holsters
    for (let k = 0; k < 6; k++) item(14 + k * 40, 62, 30, 10, '#1a1a1a'); // scopes
    for (let k = 0; k < 8; k++) item(12 + k * 30, 92, 12, 22, ['#c0392b', '#222', '#d4ac0d'][k % 3]); // lights, cases
  });
  P(2.6, 1.3, SX - 0.04, 1.9, 8.6, 'x-', slat);
  // (a plate carrier on a stand by the right window)
  {
    const x = 4.4;
    const z = 0.75;
    C(x, 0.02, z, 0.25, 0.04, 0x222222, 'y', 14);
    C(x, 0.6, z, 0.025, 1.15, 0x555555, 'y', 8);
    B(x - 0.22, x + 0.22, 1.15, 1.75, z - 0.12, z + 0.12, 0x2f3a2a);
    B(x - 0.24, x + 0.24, 1.2, 1.65, z + 0.12, z + 0.16, 0x3d4a34);
    for (const sx of [-0.12, 0, 0.12]) B(x + sx - 0.05, x + sx + 0.05, 1.28, 1.44, z + 0.16, z + 0.2, 0x334029); // (mag pouches)
    P(0.5, 0.16, x, 1.0, z + 0.03, 'z+', tex('armor-tag', 128, 40, '#ffd23f', [['BODY ARMOR', 18, '#111']]));
  }
  // (on the counter: a bell, a cleaning kit, a sign about the background check)
  C(-3.8, COUNTER.h + 0.03, 7.35, 0.06, 0.05, 0xc9b037, 'y', 12, 0.08);
  B(-2.6, -2.1, COUNTER.h, COUNTER.h + 0.1, 7.2, 7.5, 0x7b241c);
  {
    const g = new THREE.BoxGeometry(0.5, 0.3, 0.02);
    g.rotateX(-0.25);
    g.translate(0.2, COUNTER.h + 0.15, 7.15);
    add(g, tex('bgcheck', 160, 96, '#fff', [['ID +', 20, '#111'], ['BACKGROUND', 16, '#b71c1c'], ['CHECK', 16, '#b71c1c']], { border: '#111' }));
  }
  // ---- Up on the walls ----
  // a trophy head over the left cases
  {
    const z = 4.2;
    const x = -W + 0.05;
    B(x - 0.03, x + 0.03, 2.55, 3.0, z - 0.25, z + 0.25, 0x5a3a1e);
    B(x, x + 0.3, 2.62, 2.92, z - 0.12, z + 0.12, 0x7a5a3a);
    B(x + 0.25, x + 0.55, 2.6, 2.8, z - 0.08, z + 0.08, 0x6e4e30);
    B(x + 0.53, x + 0.58, 2.62, 2.7, z - 0.04, z + 0.04, 0x1a1a1a);
    for (const s of [-1, 1]) {
      C(x + 0.15, 3.05, z + s * 0.1, 0.015, 0.3, 0xd8c7a0, 'y', 6);
      C(x + 0.15, 3.15, z + s * 0.2, 0.012, 0.22, 0xd8c7a0, 'z', 6);
      C(x + 0.15, 3.0, z + s * 0.08, 0.02, 0.06, 0x111111, 'x', 6);
    }
  }
  // a flag on the right wall, high
  P(1.5, 0.85, SX - 0.03, 2.6, 4.6 - 2.2, 'x-', sheet('gflag', 190, 100, (g) => {
    for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#f4f4f4' : '#b22234'; g.fillRect(0, (k * 100) / 13, 190, 100 / 13 + 0.5); }
    g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 76, 54);
    g.fillStyle = '#fff';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) g.fillRect(6 + x * 12, 5 + y * 10, 3, 3);
  }));
  // posters (in place of the plain ones), the rules by the range door, a clock
  P(0.8, 1.05, -W + 0.03, 2.05, 7.9, 'x+', tex('gsafety', 160, 210, '#1b1b1b', [['SAFETY', 30, '#ffd23f'], ['FIRST', 30, '#ffd23f'], ['TREAT EVERY', 15, '#fff', 800], ['GUN AS IF', 15, '#fff', 800], ["IT'S LOADED", 15, '#fff', 800]], { border: '#ffd23f' }));
  P(0.8, 1.0, SX - 0.03, 2.05, 6.9, 'x-', tex('grules', 160, 200, '#f2efe6', [['RANGE', 28, '#b71c1c'], ['RULES', 28, '#b71c1c'], ['EYES & EARS', 15, '#111', 800], ['MUZZLE DOWNRANGE', 12, '#111', 800], ['NO LOADED GUNS', 12, '#111', 800], ['PAST THIS POINT', 12, '#111', 800]], { border: '#b71c1c' }));
  P(1.4, 0.55, -W + 0.03, 2.4, 1.5, 'x+', tex('gbst', 256, 100, hex(L.trim), [['WE BUY · SELL', 26, '#fff'], ['TRADE', 26, '#ffd23f']], { border: '#ffd23f' }));
  {
    const face = sheet('gclock', 128, 128, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#111';
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 5, 4, 10); }
      g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(86, 50); g.moveTo(64, 64); g.lineTo(60, 26); g.stroke();
    });
    C(1.0, 3.55, BACK - 0.03, 0.22, 0.05, 0x1a1a1a, 'z', 20);
    P(0.4, 0.4, 1.0, 3.55, BACK - 0.06, 'z-', face);
  }
  // a camera in the corner (the shop's own; not one you can shoot out)
  B(-W + 0.05, -W + 0.2, H - 0.25, H - 0.05, 0.3, 0.5, 0xe5e5e5);
  S0(K, -W + 0.2, H - 0.3, 0.42, 0.04, 0x111111);
  // an extinguisher by the range door, a mat on the floor at the counter
  C(SX - 0.12, 0.62, SIDE_DOOR[0] - 0.45, 0.085, 0.5, 0xc0201a, 'y', 10);
  C(SX - 0.12, 0.92, SIDE_DOOR[0] - 0.45, 0.03, 0.1, 0x222222, 'y', 6);
  B(-4.6, 1.6, 0.02, 0.03, 5.9, 6.8, 0x2f3338);
  K.flush();

  // ---- The range ----
  const R = kit(rg, imat, texMat, canvasTex);
  // the rules, on the wall behind the booths
  R.P(1.4, 0.9, -2.3, 2.1, PART + 0.03, 'z+', tex('grange-rules', 220, 140, '#1b1b1b', [['EYES & EARS', 24, '#ffd23f'], ['AT ALL TIMES', 16, '#fff', 800], ['CEASE FIRE = HANDS OFF', 12, '#ff8a80', 800]], { border: '#ffd23f' }));
  R.P(1.2, 0.5, -4.6, 2.3, PART + 0.03, 'z+', tex('grange-hot', 200, 84, '#b71c1c', [['RANGE IS HOT', 24, '#fff']]));
  // ear muffs on hooks
  for (let k = 0; k < 4; k++) {
    const x = 4.0 + k * 0.45;
    R.B(x - 0.01, x + 0.01, 1.62, 1.66, PART, PART + 0.1, 0x777777);
    const g = new THREE.TorusGeometry(0.1, 0.02, 6, 12, Math.PI);
    g.translate(x, 1.5, PART + 0.1);
    R.add(g, 0x222222);
    for (const s of [-1, 1]) R.C(x + s * 0.1, 1.46, PART + 0.1, 0.05, 0.06, [0xc0392b, 0x2d6cdf, 0xffd23f, 0x2e7d32][k], 'x', 10);
  }
  // baffles across the ceiling (angled boards), and the lane lines on the concrete
  for (const z of [18.5, 23, 27.5]) {
    const g = new THREE.BoxGeometry(2 * W - 0.8, 0.05, 1.0);
    g.rotateX(0.5);
    g.translate(0, 3.55, z);
    R.add(g, 0x4a4036);
  }
  for (const x of [-2.3, 2.3]) R.B(x - 0.03, x + 0.03, 0.02, 0.028, BOOTH[1] + 0.6, D - 0.3, 0xd8d2c0);
  R.flush();
}

// (a little sphere, the camera's lens)
function S0(K, x, y, z, rad, color) {
  K.S(x, y, z, rad, color);
}
