// A close-up picture from any point at any target (the game's own camera is switched off).
// Args: '[[eyeX, eyeY, eyeZ, lookX, lookY, lookZ, "name", hour], ...]'
import { launch, GAME_URL, SHOTS } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto(GAME_URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const shots = JSON.parse(process.argv[2]);
await page.evaluate(() => { const g = window.__game; g.start(); g.updateCamera = () => {}; });
for (const [ex, ey, ez, lx, ly, lz, name, hour] of shots) {
  await page.evaluate(([ex, ey, ez, lx, ly, lz, hour]) => {
    const g = window.__game;
    g.time = (((hour ?? 13) * 60 - 9 * 60 + 2880) % 1440) * 2;
    g.camera.position.set(ex, ey, ez);
    g.camera.lookAt(lx, ly, lz);
  }, [ex, ey, ez, lx, ly, lz, hour]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
await browser.close();
