// Crosswalks: each must be at its junction, across one road only, on the road (end to end,
// curb to curb), and not on top of another crosswalk or out in another road's junction.
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const g = window.__game;
  const C = g.city;
  const { edgesNear } = await import('/src/city.js');
  const X = C.walk.crossings;
  const bad = {};
  const add = (k, c, extra = '') => (bad[k] ||= []).push(`@${Math.round((c.x0 + c.x1) / 2)},${Math.round((c.z0 + c.z1) / 2)}${extra}`);
  for (const c of X) {
    const mx = (c.x0 + c.x1) / 2;
    const mz = (c.z0 + c.z1) / 2;
    const own = new Set(c.n.edges);
    // in another road (not one of this junction's arms): out in some other junction or street
    const others = edgesNear(mx, mz, 0).filter((e) => !own.has(e) && e.street?.stub === undefined);
    if (others.length) add('in another road', c, ` (${others.map((e) => e.name || e.cls).join('/')})`);
    // ends on the curb: just past each end is not road (crossing reaches the sidewalk)
    for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z1]]) {
      const ox = x + (x - mx) * (1.5 / (c.w / 2));
      const oz = z + (z - mz) * (1.5 / (c.w / 2));
      if (edgesNear(ox, oz, -0.2).some((e) => !own.has(e))) { add('runs on into another road', c); break; }
    }
    const d = Math.hypot(mx - c.n.x, mz - c.n.z);
    if (d > 22) add('far from its junction', c, ` (${d.toFixed(0)} m)`);
    for (const o of X) {
      if (o === c) continue;
      const od = Math.hypot((o.x0 + o.x1) / 2 - mx, (o.z0 + o.z1) / 2 - mz);
      if (od < Math.max(c.w, o.w) * 0.6) { add('on top of another crosswalk', c, ` (${od.toFixed(1)} m)`); break; }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(bad)) out[k] = { n: v.length, ex: v.slice(0, 12) };
  return { crosswalks: X.length, problems: out };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
