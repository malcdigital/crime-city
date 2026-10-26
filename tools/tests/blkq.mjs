import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const pts = JSON.parse(process.argv[2]);
const r = await page.evaluate((pts) => { const c = window.__game.city; return pts.map(([x,z]) => { const b = c.blockAt(x,z); return [x,z, b && {key:b.key, type:b.type, lot:!!b.lot, district:b.district, minX:Math.round(b.minX),maxX:Math.round(b.maxX),minZ:Math.round(b.minZ),maxZ:Math.round(b.maxZ)}, +c.heightAt(x,z).toFixed(2), +c.groundY(x,z).toFixed(2)]; }); }, pts);
for (const x of r) console.log(JSON.stringify(x));
await browser.close();
