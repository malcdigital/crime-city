// Shared setup for the test scripts: a headless Chromium (Playwright) and the game's address.
//   GAME_URL     the running game (default http://localhost:5174/ - start it with
//                `npx vite --port 5174` in the project folder)
//   PW_CHROMIUM  a Chromium to use instead of Playwright's own (`npx playwright install chromium`)
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

export const GAME_URL = process.env.GAME_URL || 'http://localhost:5174/';
// Screenshots go in tools/tests/shots (not kept in git).
export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const CLOUD = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
export function launch() {
  const executablePath = process.env.PW_CHROMIUM || (existsSync(CLOUD) ? CLOUD : undefined);
  // (software WebGL, so it runs on machines without a GPU too)
  return chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}
