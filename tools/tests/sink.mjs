// City-wide "sinking" scan. At sample points a car could be (every street, across its width,
// plus a grid over all the land), compare the height the game puts a car arriving along the
// ground at with the top of what's actually drawn there (every upward-facing triangle in the
// scene, indexed on a grid). Drawn surface well above the car's wheels = the car looks sunk.
import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const STEP = +(process.argv[2] || 4);
const TOL = +(process.argv[4] || 0.3);
const r = await page.evaluate(async ([STEP, TOL]) => {
  const g = window.__game; const C = g.city; const hw = g.highway;
  const { GRAPH } = await import('/src/worldplan.js');
  const t0 = performance.now();
  // upward-facing triangles of everything static
  const dyn = new Set(); for (const v of (g.vehicles||[])) v.group && v.group.traverse(o => dyn.add(o));
  const TC = 4; const tri = new Map(); let ntri = 0;
  const add = (k, t) => { let l = tri.get(k); if (!l) tri.set(k, l = []); l.push(t); };
  g.scene.updateMatrixWorld(true);
  g.scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || dyn.has(o) || !o.visible) return;
    if (o.material && (o.material.transparent || o.material.visible === false)) return;
    const pos = o.geometry.attributes.position; if (!pos) return; const idx = o.geometry.index; const m = o.matrixWorld.elements;
    const n = idx ? idx.count : pos.count;
    const P = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]; };
    for (let k = 0; k + 2 < n; k += 3) {
      const a = P(idx ? idx.getX(k) : k), b = P(idx ? idx.getX(k+1) : k+1), c = P(idx ? idx.getX(k+2) : k+2);
      // normal y (either winding counts if the material is double-sided)
      const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2], vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const L=Math.hypot(nx,ny,nz)||1;
      if (Math.abs(ny)/L < 0.5) continue;
      const t = [a,b,c]; t.src = (o.name || o.parent?.name || '') + ':' + (o.material?.color ? o.material.color.getHexString() : o.material?.type) + (o.material?.map ? '+tex' : '') + '#' + pos.count + (o.geometry.attributes.color ? 'vc' : '') + '@' + o.material.type; ntri++;
      const x0=Math.floor(Math.min(a[0],b[0],c[0])/TC), x1=Math.floor(Math.max(a[0],b[0],c[0])/TC), z0=Math.floor(Math.min(a[2],b[2],c[2])/TC), z1=Math.floor(Math.max(a[2],b[2],c[2])/TC);
      if ((x1-x0+1)*(z1-z0+1) > 400) { /* huge flat (water/sky plane): keep in a list */ add('big', t); continue; }
      for (let i=x0;i<=x1;i++) for (let j=z0;j<=z1;j++) add(i*10000+j, t);
    }
  });
  const yAt = (t, x, z) => { const [a,b,c] = t; const d = (b[2]-c[2])*(a[0]-c[0]) + (c[0]-b[0])*(a[2]-c[2]); if (Math.abs(d) < 1e-9) return null;
    const l1 = ((b[2]-c[2])*(x-c[0]) + (c[0]-b[0])*(z-c[2]))/d, l2 = ((c[2]-a[2])*(x-c[0]) + (a[0]-c[0])*(z-c[2]))/d, l3 = 1-l1-l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null; return l1*a[1]+l2*b[1]+l3*c[1]; };
  let src = ''; const topAt = (x, z, below) => { let best = null; for (const t of (tri.get(Math.floor(x/TC)*10000+Math.floor(z/TC)) || [])) { const y = yAt(t, x, z); if (y !== null && y < below && (best === null || y > best)) { best = y; src = t.src; } } return best; };
  // colliders on a grid
  const CC = 10; const cg = new Map();
  for (const b of C.colliders) for (let i=Math.floor(b.minX/CC); i<=Math.floor(b.maxX/CC); i++) for (let j=Math.floor(b.minZ/CC); j<=Math.floor(b.maxZ/CC); j++) { const k=i*10000+j; (cg.get(k)||cg.set(k,[]).get(k)).push(b); }
  const inCollider = (x, z, r) => (cg.get(Math.floor(x/CC)*10000+Math.floor(z/CC))||[]).some(b => { if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) return false; if (!b.ob) return true; const dx=x-b.ob.cx, dz=z-b.ob.cz; const u=dx*b.ob.c+dz*b.ob.s, v=-dx*b.ob.s+dz*b.ob.c; return Math.abs(u) < b.ob.hx + r && Math.abs(v) < b.ob.hz + r; });
  const pts = [];
  for (const e of GRAPH.edges) { const a = e.a.x !== undefined ? e.a : GRAPH.nodes[e.a], b = e.b.x !== undefined ? e.b : GRAPH.nodes[e.b]; if (!a || !b) continue; const L = Math.hypot(b.x-a.x, b.z-a.z) || 1; const n = Math.ceil(L/STEP); const w = (e.w || 8)/2; const ux=(b.x-a.x)/L, uz=(b.z-a.z)/L; for (let k=0;k<=n;k++) for (const f of [-0.8,0,0.8]) pts.push([a.x+(b.x-a.x)*k/n - uz*w*f, a.z+(b.z-a.z)*k/n + ux*w*f, 's']); }
  const nStreet = pts.length;
  for (let x = STEP/2; x < C.size; x += STEP) for (let z = STEP/2; z < C.size; z += STEP) pts.push([x, z, 'g']);
  const bad = []; let checked = 0;
  const o = { x: 0, z: 0, high: false };
  for (const [x, z, kind] of pts) {
    const gy = C.groundY(x, z); if (gy < -0.6) continue; // water
    if (inCollider(x, z, 0.9)) continue; // a car can't be here
    o.x = x; o.z = z; o.high = false; o.y = gy; hw.updateLayer(o); const cy = hw.groundFor(o);
    checked++;
    const top = topAt(x, z, cy + 2.2);
    if (top !== null && top > cy + TOL) bad.push([Math.round(x), Math.round(z), kind, +cy.toFixed(2), +top.toFixed(2), o.high ? 'H' : 'G', C.blockAt(x, z)?.type || '-', src]);
  }
  return { ntri, nStreet, n: pts.length, checked, bad, ms: Math.round(performance.now() - t0) };
}, [STEP, TOL]);
console.log('tris', r.ntri, 'points', r.n, '(street', r.nStreet + ')', 'checked', r.checked, 'sinking', r.bad.length, 'in', r.ms, 'ms');
const spots = [];
for (const b of r.bad) { const s = spots.find(s => Math.hypot(s.x - b[0], s.z - b[1]) < 20); if (s) { s.n++; if (b[4]-b[3] > s.depth) { s.depth = b[4]-b[3]; s.ex = b; } } else spots.push({ x: b[0], z: b[1], n: 1, depth: b[4]-b[3], ex: b }); }
spots.sort((a,b) => b.depth - a.depth);
console.log('spots', spots.length);
for (const s of spots.slice(0, +(process.argv[3]||60))) console.log(`@${s.x},${s.z} n${s.n} sink ${s.depth.toFixed(2)} m  e.g. ${JSON.stringify(s.ex)}`);
if (process.argv[5]) (await import('fs')).writeFileSync(process.argv[5], JSON.stringify(spots));
console.log('errors', errs.slice(0,3));
await browser.close();
