// Whole-car check on slopes: at grid points over all the land, facing four ways, tilt a car
// to the ground under its wheels the way the game does (Vehicle.sync) and see whether the ground
// comes up through the body anywhere (its corners and the middle of each end).
// Args: [spacing m] [spots to list] [tolerance m]
import { launch, GAME_URL } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const STEP = +(process.argv[2] || 4);
const TOL = +(process.argv[4] || 0.35);
const r = await page.evaluate(([STEP, TOL]) => {
  const g = window.__game;
  const C = g.city;
  const hw = g.highway;
  const v = g.vehicles[0];
  const HL = 2.3; // (a big car's half length, half width)
  const HW = 1.0;
  const a = HL * 0.8;
  const b = HW * 2 * 0.45;
  const bad = [];
  let n = 0;
  for (let x = STEP / 2; x < C.size; x += STEP) for (let z = STEP / 2; z < C.size; z += STEP) {
    const gy = C.groundY(x, z);
    if (gy < -0.5 || hw.surfacesAt(x, z, 2).length) continue;
    for (const hd of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      n++;
      const fx = Math.sin(hd), fz = Math.cos(hd), lx = Math.cos(hd), lz = -Math.sin(hd);
      const G = (u, s) => C.groundY(x + fx * u + lx * s, z + fz * u + lz * s);
      const hf = G(a, 0), hb = G(-a, 0), hl = G(0, b), hr = G(0, -b);
      const pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(hf - hb, 2 * a)));
      const roll = Math.max(-0.5, Math.min(0.5, Math.atan2(hl - hr, 2 * b)));
      let lift = Math.max(0, Math.max((hf + hb) / 2, (hl + hr) / 2) - gy);
      if (lift > 1) lift = 0;
      const y0 = gy + lift;
      let worst = 0;
      for (const [u, s] of [[HL, HW], [HL, -HW], [-HL, HW], [-HL, -HW], [HL, 0], [-HL, 0], [0, HW], [0, -HW]]) {
        const plane = y0 + u * Math.tan(pitch) + s * Math.tan(roll);
        worst = Math.max(worst, G(u, s) - plane);
      }
      if (worst > TOL) bad.push([Math.round(x), Math.round(z), Math.round((hd * 180) / Math.PI), +worst.toFixed(2), +gy.toFixed(1)]);
    }
  }
  return { n, bad };
}, [STEP, TOL]);
const spots = [];
for (const b of r.bad) {
  const s = spots.find((s) => Math.hypot(s.x - b[0], s.z - b[1]) < 20);
  if (s) { s.n++; if (b[3] > s.depth) { s.depth = b[3]; s.ex = b; } } else spots.push({ x: b[0], z: b[1], n: 1, depth: b[3], ex: b });
}
spots.sort((a, b) => b.depth - a.depth);
console.log('car placements', r.n, 'digging in', r.bad.length, 'spots', spots.length);
for (const s of spots.slice(0, +(process.argv[3] || 30))) console.log(`@${s.x},${s.z} n${s.n} ${s.depth.toFixed(2)} m  e.g. ${JSON.stringify(s.ex)}`);
console.log('errors', errs.slice(0, 3));
await browser.close();
