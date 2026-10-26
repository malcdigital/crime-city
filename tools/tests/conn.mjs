import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
console.log(await page.evaluate(async () => { const g = window.__game; const { GRAPH, STREETS } = await import('/src/worldplan.js'); const L = [];
  // Undirected street graph components.
  const comp = new Map(); let c = 0;
  for (const n of GRAPH.nodes) { if (comp.has(n)) continue; c++; const st = [n]; while (st.length) { const m = st.pop(); if (comp.has(m)) continue; comp.set(m, c); for (const e of m.edges) st.push(e.other(m)); } }
  const size = {}; for (const v of comp.values()) size[v] = (size[v] || 0) + 1;
  const main = +Object.entries(size).sort((a, b) => b[1] - a[1])[0][0];
  const off = Object.entries(size).filter(([k]) => +k !== main).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, n] of off) { const ns = GRAPH.nodes.filter(x => comp.get(x) === +k); const names = [...new Set(ns.flatMap(x => x.edges.map(e => e.street?.name || e.cls)))].join(', '); L.push(`component of ${n} nodes near ${Math.round(ns[0].x)},${Math.round(ns[0].z)}: ${names}`); }
  const cd = STREETS.filter(s => /Canyon|Park Ave|Bayview/.test(s.name || '')).map(s => `${s.name}: ${s.pts.slice(0, 2).map(p => p.map(Math.round).join(',')).join(' ')} ... ${s.pts.slice(-1).map(p => p.map(Math.round).join(','))}`);
  return L.concat(cd).join('\n'); }));
await browser.close();
