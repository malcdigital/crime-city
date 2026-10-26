import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = []; page.on('pageerror', e => errors.push(e.message + e.stack));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const L = []; try {
  const g = window.__game; g.start(); g.started = false;
  const A = (o={}) => Object.assign({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDY:0 }, o);
  const Vehicle = g.vehicles[0].constructor; const TrafficDriver = g.traffic.drivers[0].constructor;
  const hw = g.highway; if (g.player.vehicle) g.player.exit();
  for (const d of g.traffic.drivers) { d.car.dispose(); d.active = false; }
  g.traffic.drivers = []; g.vehicles = g.vehicles.filter(v => !v.removed); g.traffic.spawn = () => {};
  const { pushCircle } = await import('/src/collision.js');
  for (const s of hw.surfaces.filter(s => s.ramp && s.ramp.kind === 'link')) {
    const r = s.ramp; const first = r.lane.nodes[0];
    const prev = hw.nodes.find(n => n.nb.includes(first) && !n.ramp);
    if (!prev) { L.push(`link ${r.id} ${r.from}>${r.to}: NO ENTRY`); continue; }
    const prev2 = hw.nodes.find(n => n.nb.includes(prev) && n.laneRef === prev.laneRef) || prev;
    const ux = prev.x - prev2.x, uz = prev.z - prev2.z, L0 = Math.hypot(ux, uz) || 1;
    const car = new Vehicle(g.scene, 'sedan', prev2.x + ux/L0*2, prev2.z + uz/L0*2, Math.atan2(ux, uz));
    car.high = true; car.y = 7.5; car.speed = 20;
    const d = new TrafficDriver(car, prev2, prev); car.driver = d; d.next = first;
    g.traffic.drivers.push(d); g.vehicles.push(car);
    let ok = false, t = 0, maxY = 0, minSpd = 99, bad = 0, prevSpd = 0, dumped = false;
    for (let f = 0; f < 30 * 60; f++) {
      g.player.x = car.x + 20; g.player.z = car.z + 20;
      g.update(1/30, A()); t += 1/30;
      maxY = Math.max(maxY, car.y || 0);
      if (!dumped && d.from.ramp && prevSpd - car.speed > 4) {
        dumped = true;
        L.push('DROP at ' + car.x.toFixed(1) + ',' + car.z.toFixed(1) + ' y ' + car.y.toFixed(2) + ' heading ' + car.heading.toFixed(2));
        for (const [cx, cz] of car.circles()) for (const b of hw.boxesFor(car.y)) {
          if (b.maxX < cx - 3 || b.minX > cx + 3 || b.maxZ < cz - 3 || b.minZ > cz + 3) continue;
          if (pushCircle(cx, cz, car.radius + 0.3, [b]).hit) L.push('  near box ' + JSON.stringify({ y0: +b.y0.toFixed(2), ob: b.ob && { cx: +b.ob.cx.toFixed(1), cz: +b.ob.cz.toFixed(1), hx: +b.ob.hx.toFixed(2), a: +Math.atan2(b.ob.s, b.ob.c).toFixed(2) }, aabb: [b.minX, b.maxX, b.minZ, b.maxZ].map(v => +v.toFixed(1)) }));
        }
        L.push('  surfaces ' + hw.surfacesAt(car.x, car.z).map(o => (o.s.ramp ? 'ramp' + o.s.ramp.id : o.s.main) + ' d' + o.d.toFixed(2)).join(', '));
      }
      prevSpd = car.speed;
      if (false) L.push(`   ${t.toFixed(1)} ${Math.round(car.x)},${Math.round(car.z)} spd ${car.speed.toFixed(1)} crash ${car.crash?.toFixed?.(1)} steer ${car.steerVis?.toFixed(2)}`);
      if (d.from.ramp) { minSpd = Math.min(minSpd, car.speed); const h = hw.heightAt(car.x, car.z, car.y); if (h === null) bad++; }
      if (t > 3 && d.from.high && !d.from.ramp && d.from.laneRef?.main === r.to) { ok = true; break; }
    }
    L.push(`link ${r.id} ${r.from}>${r.to}: ${ok ? 'OK' : 'FAIL'} in ${t.toFixed(1)}s, top ${maxY.toFixed(1)} m, slowest on ramp ${minSpd.toFixed(1)} m/s, frames off-surface ${bad}, at ${Math.round(car.x)},${Math.round(car.z)} y ${(car.y||0).toFixed(1)}`);
    car.dispose(); d.active = false;
  }
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1,5).join(' ')); } return L.join('\n'); }));
console.log(errors.slice(0, 3));
await browser.close();
