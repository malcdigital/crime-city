// Sign and signal poles: each must stand on a sidewalk (a city block, not a lot, not in any
// road's pavement). Lists the ones that don't.
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const { edgesNear } = await import('/src/city.js');
  const g = window.__game;
  const C = g.city;
  const bad = [];
  let n = 0;
  for (const [node, poles] of g.streets.junctionPoles) {
    for (const p of poles) {
      n++;
      const b = C.blockAt(p.x, p.z);
      const inRoad = edgesNear(p.x, p.z, 0.2).filter((e) => e.street?.stub === undefined);
      const why = !b ? (C.paved(p.x, p.z) && p.z < 1270 ? 'on open paving' : null) : inRoad.length ? 'in road ' + inRoad.map((e) => e.name || e.cls).join('/') : b.lot ? 'not a sidewalk (lot)' : null; // (a block out in the hills has no sidewalk: beside the road is right)
      if (why && !(C.heightAt(p.x, p.z) > 0.05 && !inRoad.length)) bad.push([Math.round(p.x), Math.round(p.z), p.type, why, Math.round(node.x), Math.round(node.z)]);
    }
  }
  // junctions with signs or lights but no pole at all (nothing to stop at, no street names)
  const bare = [];
  for (const [node, c] of g.streets.control) if (c.type !== 'none' && c.arms.some((a) => a.stop) && !(g.streets.junctionPoles.get(node) || []).length) bare.push([Math.round(node.x), Math.round(node.z), c.type]);
  return { poles: n, bad, bare };
});
console.log('poles', r.poles, 'off the sidewalk', r.bad.length);
for (const b of r.bad) console.log(JSON.stringify(b));
console.log('junctions with no pole', r.bare.length, JSON.stringify(r.bare));
await browser.close();
