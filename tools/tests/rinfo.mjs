import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const pts = JSON.parse(process.argv[2]);
const r = await page.evaluate(async (pts) => { const { edgesNear } = await import('/src/city.js'); const g = window.__game; const C = g.city, hw = g.highway;
  return pts.map(([x,z]) => ({ x, z, h: +C.heightAt(x,z).toFixed(2), gy: +C.groundY(x,z).toFixed(2), surf: hw.surfacesAt(x,z,1).map(o => [o.s.ramp?'ramp':'main', o.s.kind || o.s.main || '', +o.h.toFixed(2), +o.d.toFixed(1), +o.s.hw.toFixed(1)]), roads: edgesNear(x,z,5).map(e => [e.name || e.cls, e.cls]) })); }, pts);
for (const o of r) console.log(JSON.stringify(o));
await browser.close();
