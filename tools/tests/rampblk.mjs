import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const g = window.__game; const { RAMPS } = await import('/src/fwyplan.js'); const out = new Map();
  for (const r of RAMPS) r.pts.forEach(([x, z], i) => { if (r.h[i] > 1.5) return; const b = g.city.blockAt(x, z); if (b && b.type !== 'ramps') { const k = b.key; const o = out.get(k) || { b, ramps: new Set(), n: 0 }; o.ramps.add(r.id + ':' + (r.editKind || r.kind)); o.n++; out.set(k, o); } });
  return [...out.values()].map(o => `block ${o.b.key} type ${o.b.type} district ${o.b.district} area ${Math.round(o.b.area)} ramps ${[...o.ramps].join(',')} pts ${o.n}`).join('\n') || 'none'; }));
await browser.close();
