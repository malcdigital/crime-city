// Traffic at the roundabouts: with the player standing nearby for a few minutes of game time,
// every car on the ring goes round the right way (island on its left), cars get through, and
// none sit stuck at or on it.
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const secs = +(process.argv[2] || 150);
const r = await page.evaluate(async (secs) => {
  const { ROUNDABOUTS } = await import('/src/worldplan.js');
  const g = window.__game;
  g.start();
  g.started = false;
  const A = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, slot: -1, throttle: 0, steer: 0, rsX: 0, rsY: 0, mouseDX: 0, mouseDY: 0 };
  const p = g.player;
  if (p.vehicle) p.exit();
  const out = [];
  for (const R of ROUNDABOUTS) {
    p.x = R.x + R.r + 12;
    p.z = R.z;
    let wrong = 0;
    let right = 0;
    const seen = new Map(); // driver -> angle travelled round
    const stuck = new Map();
    for (let f = 0; f < 30 * secs; f++) {
      g.update(1 / 30, A);
      if (f % 15) continue;
      for (const d of g.traffic.drivers) {
        const v = d.car;
        const dx = v.x - R.x;
        const dz = v.z - R.z;
        const rr = Math.hypot(dx, dz);
        if (rr > R.r + 4 || rr < R.r - 6) continue;
        if (Math.abs(v.speed) < 1) {
          stuck.set(d, (stuck.get(d) || 0) + 0.5);
          continue;
        }
        stuck.delete(d);
        // moving: which way round? (island on the left: left of heading points at the center)
        const lx = Math.cos(v.heading);
        const lz = -Math.sin(v.heading);
        const side = (lx * -dx + lz * -dz) / rr;
        if (side > 0.5) right++;
        else if (side < -0.5) wrong++;
        seen.set(d, true);
      }
    }
    const longStuck = [...stuck.values()].filter((t) => t > 20).length;
    out.push({ name: R.name, carsOnRing: seen.size, samplesRightWay: right, samplesWrongWay: wrong, stuckOver20s: longStuck });
  }
  return out;
}, secs);
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors.slice(0, 3));
await browser.close();
