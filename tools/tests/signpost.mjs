import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME_URL); await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const r = await page.evaluate(async () => { const { edgesNear } = await import('/src/city.js'); const hw = window.__game.highway; const out=[]; let n=0;
  for (const sg of hw.signPosts) { n++; const [px,pz]=sg.post; const s=hw.surfacesAt(px,pz,0.15).length, e=edgesNear(px,pz,0.15).length; const shift=Math.hypot(px-sg.at[0],pz-sg.at[1]);
    if (s||e||shift>45) out.push([sg.text, sg.kind, Math.round(px), Math.round(pz), s, e, shift.toFixed(1)]); }
  return { n, out }; });
console.log('gantries', r.n, 'bad posts', r.out.length); for (const o of r.out) console.log(JSON.stringify(o)); console.log('errors', errs);
await browser.close();
