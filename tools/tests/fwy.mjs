import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = []; page.on('pageerror', e => errors.push(e.message + e.stack));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const L = []; try {
  const g = window.__game; g.start(); g.started = false;
  const A = (o={}) => Object.assign({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDY:0 }, o);
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const hw = g.highway; if (g.player.vehicle) g.player.exit();
  const Vehicle = g.vehicles[0].constructor;
  const TrafficDriver = g.traffic.drivers[0].constructor;
  // Clear normal traffic so we see the ramps on their own.
  for (const d of g.traffic.drivers) { d.car.dispose(); d.active = false; }
  g.traffic.drivers = []; g.vehicles = g.vehicles.filter(v => !v.removed);
  g.traffic.spawn = () => {};
  const results = [];
  const ramps = hw.surfaces.filter(s => s.ramp && s.ramp.kind === 'on');
  for (const s of ramps) {
    const r = s.ramp;
    const first = r.lane.nodes[0];
    // Start on the street before the ramp: the cross-street node, heading into the stub.
    const stubEnd = g.city.nodes.find(n => n.rampEnd && n.nb.includes(first));
    const cross = g.city.nodes.find(n => n.nb.includes(stubEnd) && n !== stubEnd);
    if (!stubEnd || !cross) { results.push({ id: r.id, err: 'no stub' }); continue; }
    const ux = stubEnd.x - cross.x, uz = stubEnd.z - cross.z, L0 = Math.hypot(ux, uz);
    const car = new Vehicle(g.scene, 'sedan', cross.x + ux / L0 * 2, cross.z + uz / L0 * 2, Math.atan2(ux, uz));
    const d = new TrafficDriver(car, cross, stubEnd); car.driver = d; d.cruise = 11;
    g.traffic.drivers.push(d); g.vehicles.push(car);
    g.player.x = cross.x + 30; g.player.z = cross.z + 30; // nearby (so it isn't despawned)
    let main = false, maxDev = 0, t = 0, highT = 0, minSpeedOnRamp = 99, endedHigh = false; const path = []; let lastTo = null;
    for (let f = 0; f < 30 * 50; f++) {
      g.player.x = car.x + 20; g.player.z = car.z + 20;
      g.update(1/30, A());
      t += 1/30;
      if (car.high) {
        highT += 1/30;
        const h = hw.heightAt(car.x, car.z, car.y);
        if (h !== null) maxDev = Math.max(maxDev, Math.abs((car.y ?? h) - h));
      }
      if (d.to !== lastTo) { lastTo = d.to; path.push((d.to.street ? (d.to.rampEnd ? 'E' : 'S') : d.to.ramp ? 'R' + (d.to.laneRef?.s?.ramp?.id) : 'M') + '@' + Math.round(d.to.x) + ',' + Math.round(d.to.z)); }
      if (d.to.high && !d.to.ramp && dist2(car, d.to) < 12) { main = true; break; }
    }
    results.push({ id: r.id, path: main ? '' : path.filter((q, i) => i < 3 || !q.startsWith(path[i-1]?.slice(0,3))).slice(0, 14).join(' '), start: [Math.round(cross.x), Math.round(cross.z), Math.round(stubEnd.x), Math.round(stubEnd.z)], loop: !!r.loop, main, t: t.toFixed(1), stuck: (d.stillT||0).toFixed(1), y: (car.y||0).toFixed(1), dev: maxDev.toFixed(2), at: [Math.round(car.x), Math.round(car.z)] });
    car.dispose(); d.active = false;
  }
  L.push('on-ramps: ' + results.filter(r => r.main).length + '/' + results.length + ' reached the freeway');
  for (const r of results.filter(r => !r.main)) L.push('  FAIL ' + JSON.stringify(r));
  L.push('  times: ' + results.filter(r=>r.main).map(r => r.t).join(' '));
  // Off-ramps: start on the mainline lane node just before each off ramp; drive till back on a street.
  const offs = hw.surfaces.filter(s => s.ramp && s.ramp.kind === 'off');
  const res2 = [];
  for (const s of offs) {
    const r = s.ramp; const first = r.lane.nodes[0];
    const prev = hw.nodes.find(n => n.nb.includes(first) && !n.ramp);
    if (!prev) { res2.push({ id: r.id, err: 'no entry' }); continue; }
    // Two nodes back, so it's up to speed in the right lane.
    const prev2 = hw.nodes.find(n => n.nb.includes(prev) && n.laneRef === prev.laneRef) || prev;
    const ux = prev.x - prev2.x, uz = prev.z - prev2.z, L0 = Math.hypot(ux, uz) || 1;
    const car = new Vehicle(g.scene, 'sedan', prev2.x + ux/L0*2, prev2.z + uz/L0*2, Math.atan2(ux, uz));
    car.high = true; car.y = 7.5; car.speed = 18;
    const d = new TrafficDriver(car, prev2, prev); car.driver = d; d.cruise = 11;
    d.next = first; // take the exit
    const realPick = d.pickNext.bind(d);
    g.traffic.drivers.push(d); g.vehicles.push(car);
    let back = false, t = 0;
    for (let f = 0; f < 30 * 40; f++) {
      g.player.x = car.x + 20; g.player.z = car.z + 20;
      g.update(1/30, A());
      t += 1/30;
      if (!car.high && d.from.street && t > 3) { back = true; break; }
    }
    res2.push({ id: r.id, back, t: t.toFixed(1), y: (car.y||0).toFixed(1), high: !!car.high, at: [Math.round(car.x), Math.round(car.z)], from: d.from.street ? 'street' : d.from.ramp ? 'ramp' : 'main' });
    car.dispose(); d.active = false;
  }
  L.push('off-ramps: ' + res2.filter(r => r.back).length + '/' + res2.length + ' got back down to a street');
  for (const r of res2.filter(r => !r.back)) L.push('  FAIL ' + JSON.stringify(r));
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1,5).join(' ')); } return L.join('\n'); }));
console.log(errors.slice(0, 3));
await browser.close();
