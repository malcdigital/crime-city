// Drive at every ramp from the side, across the ground, where it's low (0.3-2.5 m up): the car
// must either climb on or be stopped - never end up inside the ramp.
import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => { const g = window.__game; const C = g.city, hw = g.highway; const v = g.vehicles[0];
  const tests = []; for (const s of hw.surfaces) { if (!s.ramp) continue; for (let i = 1; i < s.pts.length; i += 3) { const h = s.h[i]; if (h < 0.3 || h > 2.5) continue; const [ax, az] = s.pts[i-1], [bx, bz] = s.pts[i]; const L = Math.hypot(bx-ax, bz-az) || 1; const rx = -(bz-az)/L, rz = (bx-ax)/L; for (const side of [-1, 1]) tests.push([bx + rx*side*(s.hw+7), bz + rz*side*(s.hw+7), Math.atan2(-rx*side, -rz*side), h]); } }
  let bad = 0, climbed = 0, blocked = 0, skipped = 0; const ex = [];
  for (const [x, z, hd, h] of tests) {
    if (hw.surfacesAt(x, z, 1).length || C.groundY(x, z) < -0.3) { skipped++; continue; }
    v.x = x; v.z = z; v.heading = hd; v.speed = 0; v.high = false; v.y = v.groundY = C.groundY(x, z); v.vx = 0; v.vz = 0;
    let worst = 0;
    for (let f = 0; f < 120; f++) { const dt = 1/60; v.update(dt, { throttle: 1, steer: 0 }, C.colliders); hw.updateLayer(v); v.groundY = hw.groundFor(v); v.sync(dt);
      if (!v.high) { for (const o of hw.surfacesAt(v.x, v.z, -0.5)) { const d = o.h - v.y; if (d > worst) worst = d; } } }
    if (worst > 0.3) { bad++; if (ex.length < 12) ex.push([Math.round(x), Math.round(z), +h.toFixed(2), +worst.toFixed(2), Math.round(v.x), Math.round(v.z)]); }
    else if (v.high) climbed++; else blocked++;
  }
  return { n: tests.length, bad, climbed, blocked, skipped, ex }; });
console.log(JSON.stringify(r)); console.log('errors', errs.slice(0, 3));
await browser.close();
