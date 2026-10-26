// Off-road driving on the hills: cars dropped at random spots outside the paved city drive
// flat out with random steering for a while. Every frame, the body's underside corners (the
// car tilted to the ground the way the game does) must stay above the ground.
// Args: [runs] [seconds each]
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const RUNS = +(process.argv[2] || 300);
const SECS = +(process.argv[3] || 8);
const r = await page.evaluate(([RUNS, SECS]) => {
  const g = window.__game;
  const C = g.city;
  const hw = g.highway;
  const v = g.vehicles[0];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  v.groundAt = (x, z) => (v.high ? hw.heightAt(x, z, v.y) ?? v.groundY : C.groundY(x, z));
  const corners = [];
  const t = v.type;
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) corners.push([(sx * t.w) / 2, 0.35, (sz * t.l) / 2]);
  const bad = [];
  const paths = [];
  let frames = 0;
  let worstAll = 0;
  for (let run = 0; run < RUNS; run++) {
    let x, z;
    for (let k = 0; k < 200; k++) {
      x = 30 + rnd() * 1540;
      z = 30 + rnd() * 1540;
      if (C.heightAt(x, z) > 2 && C.groundY(x, z) > -0.2 && !hw.surfacesAt(x, z, 3).length && v.steepness(x, z, 0) <= 0.2) break; // (starting on drivable ground)
    }
    Object.assign(v, { x, z, heading: rnd() * Math.PI * 2, speed: 0, lat: 0, high: false });
    v.y = v.groundY = C.groundY(x, z);
    v.pitch = v.roll = 0;
    let steer = 0;
    let path = 0;
    let worst = 0;
    let at = null;
    for (let f = 0; f < SECS * 60; f++) {
      const dt = 1 / 60;
      if (f % 40 === 0) steer = rnd() * 2 - 1;
      const px0 = v.x, pz0 = v.z;
      v.update(dt, { throttle: 1, steer }, C.colliders);
      path += Math.hypot(v.x - px0, v.z - pz0);
      hw.updateLayer(v);
      v.groundY = hw.groundFor(v);
      v.sync(dt);
      if (f < 30) continue; // (settling after the drop)
      frames++;
      v.group.updateMatrixWorld(true);
      for (const [cx, cy, cz] of corners) {
        const p = v.group.localToWorld(new v.group.position.constructor(cx, cy, cz));
        if (v.high) continue;
        const d = C.groundY(p.x, p.z) - p.y;
        if (d > worst) { worst = d; at = [Math.round(p.x), Math.round(p.z), 'f' + f, 'car', +v.x.toFixed(1), +v.z.toFixed(1), 'y', +v.y.toFixed(2), 'gy', +v.groundY.toFixed(2), 'pitch', +v.pitch.toFixed(2), 'roll', +v.roll.toFixed(2), 'spd', +v.speed.toFixed(1), 'steep', +v.steepness(v.x, v.z, v.heading).toFixed(2), 'corner', [cx, cz], 'cg', +C.groundY(p.x, p.z).toFixed(2), 'py', +p.y.toFixed(2)]; }
      }
    }
    worstAll = Math.max(worstAll, worst);
    paths.push(path);
    if (worst > 0.3) bad.push([run, +worst.toFixed(2), at]);
  }
  paths.sort((a, b) => a - b);
  return { runs: RUNS, frames, avgPath: Math.round(paths.reduce((a, b) => a + b, 0) / paths.length), shortRuns: paths.filter((p) => p < 30).length, worstAll: +worstAll.toFixed(2), bad: bad.length, ex: bad.slice(0, 15) };
}, [RUNS, SECS]);
console.log(JSON.stringify(r));
console.log('errors', errs.slice(0, 3));
await browser.close();
