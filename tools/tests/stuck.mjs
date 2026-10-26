import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(() => { const L = []; const g = window.__game; g.start(); g.started = false;
  const A = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDY:0 });
  const p = g.player; if (p.vehicle) p.exit();
  p.x = 760; p.z = 795; g.time = ((8*60 - 9*60 + 2880) % 1440) * 2;
  const seen = new Map();
  for (let f = 0; f < 30 * 120; f++) {
    g.update(1/30, A());
    if (f % 30 === 0) for (const d of g.traffic.drivers) if ((d.stillT || 0) > 12 && !seen.has(d)) {
      const c = d.car; const S = g.streets; const ctl = S.control.get(d.to);
      seen.set(d, `t${(f/30).toFixed(0)} car ${Math.round(c.x)},${Math.round(c.z)} spd ${c.speed.toFixed(1)} from ${Math.round(d.from.x)},${Math.round(d.from.z)}${d.from.high?'H':''} to ${Math.round(d.to.x)},${Math.round(d.to.z)}${d.to.high?'H':''} ctl ${ctl?.type} blocked ${d.blockedBy ? (d.blockedBy.parkSpot ? 'parked' : d.blockedBy.driver === 'player' ? 'player' : (d.blockedBy.driver?.stillT||0) > 5 ? 'stuck car' : 'car') : '-'} passing ${!!d.passing} halt ${!!d.halt} bus ${!!d.bus} queue ${S.queue?.get(d.to)?.length || 0} dist ${Math.hypot(c.x-d.to.x, c.z-d.to.z).toFixed(1)}`);
    }
  }
  return [...seen.values()].join('\n') || 'none'; }));
await browser.close();
