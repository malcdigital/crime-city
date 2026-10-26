import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(() => { const g = window.__game; g.start(); g.started = false; const L = [];
  const A = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDY:0 });
  for (const [sx, sz, wx, wz] of [[615, 686, 1455, 300], [403, 900, 1455, 300], [215, 486, 900, 1300], [800, 800, 60, 180]]) {
    const v = g.player.vehicle; v.x = sx; v.z = sz; g.mapView.waypoint = [wx, wz]; g.gps = null; g.gpsT = 0;
    for (let i = 0; i < 10; i++) g.update(1/30, A());
    L.push(`${sx},${sz} -> ${wx},${wz}: gps ${g.gps ? g.gps.length : 'none'} points`);
  }
  return L.join('\n'); }));
await browser.close();
