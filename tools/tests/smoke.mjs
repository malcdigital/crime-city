import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = []; page.on('pageerror', e => errors.push(e.message + '\n' + (e.stack||'').split('\n').slice(0,4).join('\n')));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await page.evaluate(() => { const g = window.__game; g.start(); g.started = false; window.A = (o={}) => Object.assign({ moveX:0, moveY:0, lookX:0, lookY:0, slot:-1, throttle:0, steer:0, rsX:0, rsY:0, mouseDX:0, mouseDY:0 }, o);
  window.step = (n, o) => { const g = window.__game; for (let k = 0; k < n; k++) { g.update(1/30, A(o)); g.interactWasHeld = !!(o && o.interactHeld); } }; });
const run = async (name, fn) => { const r = await page.evaluate(fn).catch(e => 'THREW ' + e.message); console.log(`== ${name}\n${r}`); };
await run('taxi + bus', () => { const L = []; try {
  const g = window.__game; const p = g.player; if (p.vehicle) { const v = p.vehicle; p.exit(); v.dispose(); }
  g.cash = 500;
  const Veh = g.vehicles[0].constructor; const TD = g.traffic.drivers[0].constructor;
  const e = g.city.edges.find(e => e.cls === 'collector' && Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) > 60);
  const L0 = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z); const ux = (e.b.x - e.a.x) / L0, uz = (e.b.z - e.a.z) / L0;
  const tx = e.a.x + ux * 30 - uz * e.lane, tz = e.a.z + uz * 30 + ux * e.lane;
  const taxi = new Veh(g.scene, 'taxi', tx, tz, Math.atan2(ux, uz)); const d = new TD(taxi, e.a, e.b); taxi.driver = d; g.traffic.drivers.push(d); g.vehicles.push(taxi);
  p.x = tx - uz * (e.w / 2 - e.lane + 1.5); p.z = tz + ux * (e.w / 2 - e.lane + 1.5);
  step(2); L.push('prompt: ' + g.prompt);
  g.mapView.waypoint = [1100, 1150];
  step(1, { interactHeld: true }); step(1);
  const items = g.shops.items ? g.shops.items() : [];
  L.push(`menu "${g.shops.menu?.title}": ${items.length} rows; first: ${items[0]?.label} ${items[0]?.price} (${items[0]?.detail})`);
  if (g.shops.menu) { g.shops.menu.i = 0; g.shops.buy(); }
  for (let k = 0; k < 30 * 4; k++) step(1);
  const [px, pz] = p.pos();
  L.push(`after taxi: at ${px.toFixed(0)},${pz.toFixed(0)} dist to waypoint ${Math.hypot(px - 1100, pz - 1150).toFixed(0)} m, on block ${!!g.city.blockAt(px, pz)}, cash ${g.cash}`);
  const s = g.transit.stops[1]; p.x = s.wx; p.z = s.wz; step(2);
  L.push('bus prompt: ' + g.prompt + ' · stops ' + g.transit.stops.length + ' · routes ' + g.transit.routes.map(r => r.loop.length).join('/'));
  step(1, { interactHeld: true }); step(1);
  if (g.shops.menu) { g.shops.menu.i = 3; g.shops.buy(); for (let k = 0; k < 30 * 4; k++) step(1); const [bx, bz] = p.pos(); L.push('after bus: nearest stop ' + g.transit.stops.map(q => Math.hypot(q.wx - bx, q.wz - bz)).sort((a, b) => a - b)[0].toFixed(1) + ' m'); }
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1, 4).join(' ')); } return L.join('\n'); });
await run('police 1..5 stars while driving', () => { const L = []; try {
  const g = window.__game; const p = g.player;
  const Veh = g.vehicles[0].constructor;
  // On Market St heading east.
  const car = new Veh(g.scene, 'sports', 200, 903.6, Math.PI / 2); g.vehicles.push(car); p.enter(car);
  for (const s of [5]) {
    g.heat = [0, 1, 3, 6, 10, 15][s] + 0.5; g.stars = s; g.crime('assaultCop', p.x, p.z); 
    let blocks = 0, spikes = 0, heli = false;
    for (let k = 0; k < 30 * 25; k++) {
      // drive along with a little steering
      // keep to Market St / Ring Rd: steer toward a point 20 m ahead on the nearest street
      const v = p.vehicle; const [fx, fz] = v.forward(); const hit = g.city.edgeAt(v.x + fx * 20, v.z + fz * 20);
      let steer = 0; if (hit) { const dx = hit.x - v.x, dz = hit.z - v.z; const cr = fx * dz - fz * dx; steer = Math.max(-1, Math.min(1, cr / 10)); }
      step(1, { throttle: 0.7, steer });
      blocks = Math.max(blocks, g.police.plans?.length || 0, g.police.units.filter(u => u.roadblock || u.blockPlan).length);
      g.heat = Math.max(g.heat, 15.5); g.lastSeen = g.time;
      spikes = Math.max(spikes, g.police.spikes.length); heli = heli || !!g.police.heli;
    }
    L.push(`stars ${g.stars}: units ${g.police.units.length}, officers ${g.police.officers().length}, roadblock plans ${blocks}, spikes ${spikes}, heli ${heli}, player at ${p.pos().map(v => v.toFixed(0))}`);
  }
  g.heat = 0; g.stars = 0;
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1, 4).join(' ')); } return L.join('\n'); });
await run('raid + claim + war + drugs', () => { const L = []; try {
  const g = window.__game; const p = g.player; if (p.vehicle) p.exit();
  g.stars = 0; g.heat = 0;
  for (const u of g.police.units) u.leaving = true;
  step(30);
  const b = g.city.blocks.find(b => b.district === 'Midtown' && b.type === 'normal' && !g.turfWars.owner[b.key]);
  const fp = g.city.frontPoint(b, 1.5); p.x = fp.x; p.z = fp.z;
  L.push('raid sent: ' + g.police.raid(p.x, p.z, 3));
  step(30 * 5); L.push('units after raid ' + g.police.units.length);
  g.stars = 0; g.heat = 0; for (const u of g.police.units) u.leaving = true; step(30 * 3);
  // Claim
  g.cred = 500;
  const T = g.turfWars;
  if (T.startClaim) { T.startClaim(b); L.push('claim stage ' + T.claim?.stage + ' tags ' + T.claim?.tags?.length); }
  else L.push('turf api: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(T)).filter(k => /claim/i.test(k)).join(','));
  // Turf war on a kings block
  const kb = T.blocks.find(x => T.owner[x.key] === 'kings' && x.key !== T.home.kings);
  if (kb && T.startWar) { T.startWar(kb, 'vipers', 'kings', false); step(30 * 10); L.push('wars ' + T.wars.length + ' soldiers ' + T.soldiers.length); }
  L.push('turf counts ' + ['kings','vipers','crew'].map(gg => gg + ':' + T.blocks.filter(x => T.owner[x.key] === gg).length).join(' '));
  // Drugs plugs
  L.push('plugs ' + g.drugs.plugs.map(pl => `${pl.name}@${pl.street} (${Math.round(pl.x)},${Math.round(pl.z)})`).join(' · '));
  L.push('stores ' + g.city.stores.map(s => s.name).join(', '));
  L.push('banks ' + g.bank.banks.map(x => x.name + '@' + x.street).join(' · ') + ' · atms ' + g.bank.atms.length + ' · homes ' + g.bank.homes.map(h => h.name + ':' + h.district).join(', '));
  L.push('companies ' + g.economy.companies.map(c => c.name + '@' + c.street).join(' · '));
  L.push('gun ' + g.shops.gun.x.toFixed(0) + ',' + g.shops.gun.z.toFixed(0) + ' garage ' + g.shops.garage.x.toFixed(0) + ',' + g.shops.garage.z.toFixed(0));
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1, 4).join(' ')); } return L.join('\n'); });
await run('map + gps', () => { const L = []; try {
  const g = window.__game; const p = g.player;
  g.mapView.waypoint = [1455, 300];
  const r = (window.__gps = g.gps); step(5);
  L.push('gps points ' + (g.gps ? g.gps.length : 'none') + ' ys ' + (g.gps?.ys ? 'yes' : 'no'));
  g.mapView.show(); g.mapView.draw(); g.mapView.draw(); g.mapView.hide();
  L.push('map ok');
  } catch (e) { L.push('ERROR ' + e.message + ' ' + e.stack.split('\n').slice(1, 4).join(' ')); } return L.join('\n'); });
console.log('page errors:', errors.slice(0, 5).join('\n---\n'));
await browser.close();
