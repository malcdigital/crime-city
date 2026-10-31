// Export paired animations (src/paired.js): each scene in src/paired/ baked into one clip per
// actor plus the pair (alignment, events), written to src/anims/paired/.
//   node tools/paired/bake.mjs [name ...]      (needs the dev server: npx vite --port 5174)
import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { launch, GAME_URL } from '../tests/launch.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(new URL('../../src/paired/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
const out = new URL('../../src/anims/paired/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(new URL('/', GAME_URL).href);
for (const name of names) {
  const res = await page.evaluate(async (name) => {
    const { bakePaired } = await import('/src/paired.js');
    const { makeCharacter } = await import('/src/character.js');
    const def = (await import(`/src/paired/${name}.js`)).default;
    const chars = Object.fromEntries(def.actors.map((a) => [a, makeCharacter({})]));
    const r = bakePaired(def, chars);
    return { clips: r.clips, pair: r.pair, report: r.report && { ...r.report } };
  }, name);
  for (const [a, clip] of Object.entries(res.clips)) writeFileSync(new URL(`${name}.${a}.json`, out), JSON.stringify(clip));
  writeFileSync(new URL(`${name}.pair.json`, out), JSON.stringify(res.pair, null, 2) + '\n');
  console.log(`${name}: ${res.pair.frames} frames @ ${res.pair.fps} fps · ${Object.keys(res.clips).join(' + ')} · align ${JSON.stringify(res.pair.align)}`);
  if (res.report) {
    const R = res.report;
    console.log(`  contact: worst overlap ${(R.worst * 100).toFixed(1)} cm (frame ${R.at}${R.parts ? `, ${R.parts.join(' / ')}` : ''}), ${R.over} frames over ${(R.tol * 100).toFixed(1)} cm`);
    console.log(`  under the turf at most: ${Object.entries(R.sink).map(([a, v]) => `${a} ${(v * 100).toFixed(1)} cm`).join(', ')}`);
    if (R.over) process.exitCode = 1;
  }
}
await browser.close();
