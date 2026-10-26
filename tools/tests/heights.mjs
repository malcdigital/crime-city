import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const { STREETS } = await import('/src/worldplan.js'); const { HOLES } = await import('/src/fwyplan.js'); const L = [];
  for (const h of HOLES) { const xs = h.poly.map(p => p[0]); if (Math.max(...xs) > 1262) L.push('hole ' + h.poly.map(p => p.map(Math.round).join(',')).join(' ') + (h.frontage ? ' frontage ' + JSON.stringify(h.frontage.map(p => p.map(Math.round))) : '')); }
  for (const s of STREETS) if (s.pts.some(([x, z]) => x > 1262 && x < 1420 && z > 250 && z < 420)) L.push(`${s.name || s.cls} svc ${!!s.service} front ${!!s.frontage} stub ${s.stub}: ${s.pts.length > 6 ? s.pts.slice(0,2).concat(s.pts.slice(-2)).map(p => p.map(Math.round).join(',')).join(' ') : s.pts.map(p => p.map(Math.round).join(',')).join(' ')}`);
  return L.join('\n'); }));
await browser.close();
