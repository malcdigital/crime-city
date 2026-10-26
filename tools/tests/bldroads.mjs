// Buildings standing in a road: every building footprint (corners, edge midpoints, middle)
// must be clear of every street's pavement and the ring roads.
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const { edgesNear } = await import('/src/city.js');
  const C = window.__game.city;
  const bad = [];
  let n = 0;
  for (const b of C.blocks) {
    for (const it of b.buildings || []) {
      if (!it.R) continue;
      n++;
      const R = it.R;
      const pts = [...R, [it.cx, it.cz]];
      for (let i = 0; i < R.length; i++) pts.push([(R[i][0] + R[(i + 1) % R.length][0]) / 2, (R[i][1] + R[(i + 1) % R.length][1]) / 2]);
      const hits = pts.flatMap(([x, z]) => edgesNear(x, z, 0).filter((e) => e.street?.stub === undefined).map((e) => e.name || e.cls));
      if (hits.length) bad.push([Math.round(it.cx), Math.round(it.cz), b.key, b.type, [...new Set(hits)].join('/')]);
    }
  }
  return { n, bad };
});
console.log('buildings', r.n, 'in a road', r.bad.length);
for (const b of r.bad) console.log(JSON.stringify(b));
await browser.close();
