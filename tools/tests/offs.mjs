import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => { const m = await import('/src/fwyplan.js'); const { districtAt } = await import('/src/districts.js');
  return m.HALVES.map(h => { const o = h.ramps.off; const W=h.W; const a=W(-200,10.25), b=W(-190,10.25); return [h.id, h.main, h.name, districtAt(...o.pts[0]), a.map(Math.round), Math.round(Math.atan2(b[0]-a[0], b[1]-a[1])*180/Math.PI), o.local.filter((_, i) => i % 6 == 0).map(p => p.map(n=>+n.toFixed(1))).join(' ')]; }); });
for (const x of r) console.log(JSON.stringify(x));
await browser.close();
