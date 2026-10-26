import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const pts = JSON.parse(process.argv[2]);
const r = await page.evaluate(async (pts) => { const { BLOCKS } = await import('/src/worldplan.js'); const { pointInPoly } = await import('/src/geom.js'); const C = window.__game.city; const { edgesNear } = await import('/src/city.js');
  return pts.map(([x,z]) => ({ x, z, h: +C.heightAt(x,z).toFixed(2), gy: +C.groundY(x,z).toFixed(2), blockAt: C.blockAt(x,z)?.key, blocks: (C.blocks || BLOCKS).filter(b => pointInPoly(x,z,b.poly)).map(b => [b.key, b.type, !!b.lot, b.padY?.toFixed(2)]), roads: edgesNear(x,z,6).map(e => e.name || e.cls), verts: [[0,0],[4,0],[0,4],[4,4]].map(([a,b]) => { const vx=Math.floor(x/4)*4+a, vz=Math.floor(z/4)*4+b; return [vx,vz,+C.heightAt(vx,vz).toFixed(2), C.blocks.filter(bb => pointInPoly(vx,vz,bb.poly)).map(bb=>bb.key+(bb.lot?'L'+bb.padY.toFixed(1):''))]; }) })); }, pts);
for (const o of r) console.log(JSON.stringify(o));
await browser.close();
