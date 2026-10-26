import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const g = window.__game; const C = g.city; const { edgesNear } = await import('/src/city.js'); const { closestOnSeg, pointInPoly } = await import('/src/geom.js'); const hw = g.highway; const R = {}; const ex = {};
  const bump = (k, msg) => { R[k] = (R[k] || 0) + 1; (ex[k] ||= []).length < 70 && ex[k].push(msg); };
  const inRoad = (x, z, pad = 0) => edgesNear(x, z, pad).filter(e => e.street?.stub === undefined).length > 0;
  const onRamp = (x, z) => hw.surfacesAt(x, z, 0.3).some(o => o.h < 2.5);
  const inBuilding = (x, z) => C.los.some(b => { if (b.ob) return false; return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ; });
  const P = g.streets.placed; const poles = [];
  const chk = (kind, x, z) => { poles.push([kind, x, z]); const f = `${kind} @${x.toFixed(0)},${z.toFixed(0)}`; if (inRoad(x, z, 0.1)) bump(kind + ' in road', f); if (onRamp(x, z)) bump(kind + ' on ramp', f); if (inBuilding(x, z)) bump(kind + ' in building', f); };
  for (const [x, , z] of P.signPoles) chk('stop sign', x, z);
  for (const [x, , z] of P.sigPoles) chk('signal', x, z);
  for (const [x, , z] of g.streets.lampPosts) chk('street light', x, z);
  for (const it of g.props.items) chk(it.kind, it.x, it.z);
  // Crowding: two poles/props closer than 0.9 m.
  const grid = new Map(); for (const p of poles) { const k = Math.floor(p[1] / 4) + ',' + Math.floor(p[2] / 4); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  for (const p of poles) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get((Math.floor(p[1] / 4) + i) + ',' + (Math.floor(p[2] / 4) + j)) || []) if (q !== p && q[1] >= p[1] && Math.hypot(q[1] - p[1], q[2] - p[2]) < 0.9) bump('crowded', `${p[0]} + ${q[0]} @${p[1].toFixed(0)},${p[2].toFixed(0)}`);
  // Markings: must be on a road, not under the road surface.
  const M = C.markings;
  for (const [x, y, z] of M.dashes) { if (!inRoad(x, z, -0.5)) bump('center dash off road', `@${x.toFixed(0)},${z.toFixed(0)}`); if (y < C.groundY(x, z) + 0.01 || (C.heightAt(x, z) > 0.1 && y < C.heightAt(x, z) + 0.045)) bump('center dash buried', `@${x.toFixed(0)},${z.toFixed(0)} y ${y.toFixed(2)} ground ${C.heightAt(x, z).toFixed(2)}`); if (onRamp(x, z)) bump('center dash under ramp', `@${x.toFixed(0)},${z.toFixed(0)}`); }
  for (const [x, y, z] of M.lines) { if (C.heightAt(x, z) > y) bump('parking line buried', `@${x.toFixed(0)},${z.toFixed(0)} ground ${C.heightAt(x, z).toFixed(2)}`); }
  for (const [x, y, z] of P.stopLines) { if (!inRoad(x, z, -0.5)) bump('stop line off road', `@${x.toFixed(0)},${z.toFixed(0)}`); if (C.heightAt(x, z) > 0.1 && y < C.heightAt(x, z) + 0.045) bump('stop line buried', `@${x.toFixed(0)},${z.toFixed(0)}`); }
  // Signal junctions: does every stopping approach have a signal head facing it?
  let sigJ = 0, stopJ = 0, appr = 0, noHead = 0;
  for (const [n, c] of g.streets.control) { if (c.type === 'signal') sigJ++; if (c.type === 'stop') stopJ++; }
  return JSON.stringify({ counts: { stopSigns: P.signPoles.length, signals: P.sigPoles.length, lights: g.streets.lampPosts.length, props: g.props.items.length, nameBlades: g.streets.nameBlades, dashes: M.dashes.length, stopLines: P.stopLines.length, signalJunctions: sigJ, stopJunctions: stopJ }, problems: R, examples: ex }, null, 1); }));
console.log(errs);
await browser.close();
