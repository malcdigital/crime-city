import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = []; page.on('pageerror', e => errors.push(e.message + e.stack));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const secs = +(process.argv[2] || 120);
console.log(await page.evaluate((secs) => { const L = []; try {
  const g = window.__game; g.start(); g.started = false;
  const A = (o={}) => Object.assign({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDX:0, mouseDY:0 }, o);
  const p = g.player; if (p.vehicle) p.exit();
  const legs = [['Downtown', 8*60], ['The Strip', 23*60], ['Financial District', 12*60], ['The Projects', 3*60+30], ['Midtown', 17*60+30], ['The Heights', 10*60], ['The Docks', 14*60], ['Government District', 9*60]];
  for (const [d, m] of legs) {
    const b = g.city.blocks.find(b => b.district === d && (b.type === 'normal'));
    if (p.vehicle) p.exit();
    const fp = g.city.frontPoint(b, 1); p.x = fp.x; p.z = fp.z; g.time = ((m - 9*60 + 2880) % 1440) * 2;
    const t0 = performance.now(); let ped = 0, car = 0, n = 0, high = 0, stuck = 0, onRamp = 0;
    const was = new Map();
    for (let f = 0; f < 30*secs; f++) {
      g.update(1/30, A());
      if (f % 60 === 0) {
        ped += g.peds.peds.length; const reg = g.traffic.drivers.filter(x=>g.traffic.regular(x)); car += reg.length; n++;
        high += g.vehicles.filter(v => v.high).length;
        onRamp += reg.filter(x => x.from.ramp || x.to.ramp).length;
      }
    }
    for (const dd of g.traffic.drivers) if ((dd.stillT || 0) > 15) stuck++;
    const stuckPeds = g.peds.peds.filter(q => q.state === 'walk' && (q.navFails || 0) >= 3).length;
    L.push(`${d.padEnd(19)} ${String(Math.floor(m/60)).padStart(2)}:${String(m%60).padStart(2,'0')} · ${((performance.now()-t0)/(30*secs)).toFixed(1)} ms/f · peds ${(ped/n).toFixed(0)} · cars ${(car/n).toFixed(0)} (freeway ${(high/n).toFixed(1)}, ramps ${(onRamp/n).toFixed(1)}) · stuck cars ${stuck} · stuck peds ${stuckPeds} · patrols ${g.police.units.filter(u=>u.patrol).length} · parked real ${g.parking.spots.filter(s=>s.car).length} · buses ${g.transit.buses.length} · stars ${g.stars}`);
  }
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1,5).join(' ')); } return L.join('\n'); }, secs));
console.log(errors.slice(0, 3));
await browser.close();
