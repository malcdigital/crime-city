import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => { const m = await import('/src/fwyplan.js'); const { districtAt } = await import('/src/districts.js'); const out = [];
  for (const h of m.HALVES) for (const k of ['diag', 'loop']) { const r = h.ramps[k]; const i = r.h.findIndex(y => y > 0.7); if (i < 1) continue; const [ax, az] = r.pts[i-1], [bx, bz] = r.pts[i]; const L = Math.hypot(bx-ax, bz-az)||1; const rx = -(bz-az)/L, rz = (bx-ax)/L;
    for (const side of [-1, 1]) { const x = bx + rx*side*12, z = bz + rz*side*12; out.push([h.id, k, districtAt(bx, bz), side, Math.round(x), Math.round(z), Math.round(Math.atan2(-rx*side, -rz*side)*180/Math.PI), r.h[i].toFixed(2)]); } }
  return out; });
for (const x of r) console.log(JSON.stringify(x)); await browser.close();
