// Every painted line in the game, checked against the road it's on: street center dashes,
// parking-lane lines, freeway and ramp lane lines. For each corner of each painted piece:
//   - it's on the road (streets: within the pavement and not up on a sidewalk; freeways: over
//     the deck or ramp it belongs to),
//   - it's at the road's height (not floating above it or sunk into it),
//   - center dashes stay on the road's center line (so they bend with it), lane lines on theirs.
// Args: [examples to list]
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const g = window.__game;
  const C = g.city;
  const hw = g.highway;
  const { edgesNear } = await import('/src/city.js');
  const { closestOnSeg } = await import('/src/geom.js');
  const KIND = { d9c45a: 'street center', d8d8d8: 'street lane', d8b13a: 'freeway yellow', dadada: 'freeway white' };
  const pieces = []; // { kind, tri: [[x,y,z] x3] }
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const kind = KIND[o.material?.color?.getHexString()];
    if (!kind || o.material.type !== 'MeshBasicMaterial') return; // (paint, not a prop that happens to be white)
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const mats = [];
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        const m = o.matrixWorld.clone();
        const im = new o.matrixWorld.constructor();
        o.getMatrixAt(k, im);
        mats.push(m.multiply(im));
      }
    } else mats.push(o.matrixWorld);
    for (const M of mats) {
      const e = M.elements;
      const P = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };
      for (let k = 0; k + 2 < n; k += 3) pieces.push({ kind, tri: [P(idx ? idx.getX(k) : k), P(idx ? idx.getX(k + 1) : k + 1), P(idx ? idx.getX(k + 2) : k + 2)] });
    }
  });
  const bad = {};
  const counts = {};
  const add = (k, msg) => { (bad[k] ||= []).push(msg); };
  for (const { kind, tri } of pieces) {
    counts[kind] = (counts[kind] || 0) + 1;
    for (const [x, y, z] of tri) {
      const at = `@${x.toFixed(0)},${z.toFixed(0)}`;
      if (kind.startsWith('street')) {
        const roads = edgesNear(x, z, 0).filter((e) => e.street?.stub === undefined);
        if (!roads.length) { add(`${kind}: off the road`, at); continue; }
        const b = C.blockAt(x, z);
        if (b && b.type !== 'ramps' && !b.country) add(`${kind}: on a sidewalk or yard`, `${at} (${b.type})`);
        const surf = C.roadY(x, z) - (C.roadY === undefined ? 0 : 0); // where paint belongs
        const ground = C.heightAt(x, z);
        if (y < ground - 0.005) add(`${kind}: sunk into the road`, `${at} by ${(ground - y).toFixed(2)} m`);
        if (y > Math.max(ground, 0) + 0.2) add(`${kind}: floating`, `${at} by ${(y - ground).toFixed(2)} m`);
        if (kind === 'street center') {
          let d = Infinity;
          for (const e of roads) d = Math.min(d, closestOnSeg(x, z, e.a.x, e.a.z, e.b.x, e.b.z).d);
          if (d > 0.6) add(`${kind}: off the center line`, `${at} by ${d.toFixed(2)} m`);
        }
      } else {
        const s = hw.surfacesAt(x, z, 0.05).filter((o) => Math.abs(o.h + 0.05 - y) < 0.4);
        if (!s.length) {
          const any = hw.surfacesAt(x, z, 0.05);
          if (!any.length) add(`${kind}: off the deck`, at);
          else add(`${kind}: not at the deck's height`, `${at} y ${y.toFixed(2)} deck ${any.map((o) => o.h.toFixed(2)).join('/')}`);
        }
      }
    }
  }
  // Dashed lines: how long the painted dashes are (a dash much longer than meant = a line
  // that's lost its dashes, or a piece across a long straight).
  const long = {};
  for (const { kind, tri } of pieces) {
    const L = Math.max(...[[0, 1], [1, 2], [0, 2]].map(([a, b]) => Math.hypot(tri[a][0] - tri[b][0], tri[a][2] - tri[b][2])));
    if (kind === 'street center' && L > 3.3) (long[kind] ||= []).push(`@${tri[0][0].toFixed(0)},${tri[0][2].toFixed(0)} ${L.toFixed(1)} m`);
  }
  // (grouped into places 25 m across, so each spot shows once)
  const summary = {};
  for (const [k, v] of Object.entries(bad)) {
    const spots = [];
    for (const m of v) {
      const [x, z] = m.slice(1).split(' ')[0].split(',').map(Number);
      const sp = spots.find((q) => Math.hypot(q.x - x, q.z - z) < 25);
      if (sp) sp.n++;
      else spots.push({ x, z, n: 1, ex: m });
    }
    summary[k] = { n: v.length, places: spots.length, ex: spots.sort((a, b) => b.n - a.n).slice(0, 25).map((q) => `${q.ex} (x${q.n})`) };
  }
  return { counts, problems: summary, longDashes: Object.fromEntries(Object.entries(long).map(([k, v]) => [k, { n: v.length, ex: v.slice(0, 6) }])) };
});
console.log(JSON.stringify(r, null, 1));
console.log('errors', errs.slice(0, 3));
await browser.close();
