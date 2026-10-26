// Handling: the player's car at a set speed, full steering for 1.5 s, on the gas vs off it.
// Reports how far it turns (degrees) and how much it slides (peak sideways speed, m/s; peak
// slip angle, degrees). On the gas should turn at least as hard as off it, and off it the car
// shouldn't slide out.
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game;
  g.start();
  const v = g.player.vehicle || g.vehicles[0];
  v.driver = 'player';
  const out = {};
  for (const speed of [12, 20, 28]) {
    for (const [name, ctrl] of [['gas', { throttle: 1, steer: 1, gas: true }], ['coast', { throttle: 0, steer: 1 }], ['brake', { throttle: -0.6, steer: 1 }], ['drift', { throttle: 1, steer: 1, gas: true, brake: true }]]) {
      Object.assign(v, { x: 300, z: 1500, heading: 0, speed, vx: speed, vy: 0, lat: 0, r: 0, dyn: false, high: false, ax: 0, steerVis: 0, driftAmt: 0 });
      v.groundAt = null;
      const h0 = v.heading;
      let slide = 0;
      let slip = 0;
      let turned = 0;
      let prev = v.heading;
      for (let f = 0; f < 90; f++) {
        v.update(1 / 60, ctrl, []);
        let d = v.heading - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turned += d;
        prev = v.heading;
        slide = Math.max(slide, Math.abs(v.lat || 0));
        slip = Math.max(slip, Math.abs(Math.atan2(v.lat || 0, Math.max(1, v.speed))) * 57.3);
      }
      out[`${speed} m/s ${name}`] = { turned: +Math.abs(turned * 57.3).toFixed(0), slide: +slide.toFixed(1), slipDeg: +slip.toFixed(0), endSpeed: +v.speed.toFixed(1) };
    }
  }
  return out;
});
for (const [k, o] of Object.entries(r)) console.log(k.padEnd(16), JSON.stringify(o));
await browser.close();
