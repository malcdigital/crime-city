import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const shots = JSON.parse(process.argv[2]);
await page.evaluate(() => { const g = window.__game; g.start(); });
for (const [x, z, hdeg, name, hour] of shots) {
  await page.evaluate(([x, z, hdeg, hour]) => { const g = window.__game; const v = g.player.vehicle; const h = hdeg * Math.PI / 180; v.x = x; v.z = z; v.heading = h; v.speed = 0; v.high = false; v.groundY = g.city.groundY(x, z); v.y = v.groundY; g.time = (((hour ?? 13)*60 - 9*60 + 2880) % 1440) * 2; g.camYaw = h; g.camPitch = 0.15; g.camTop = undefined; }, [x, z, hdeg, hour]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
await browser.close();
