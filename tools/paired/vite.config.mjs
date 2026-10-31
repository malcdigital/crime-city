// Builds the paired-animation preview (tools/paired/preview.html) on its own:
//   npx vite build --config tools/paired/vite.config.mjs --outDir <dir>
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root: here, base: './', logLevel: 'warn', build: { emptyOutDir: true, chunkSizeWarningLimit: 2000, rollupOptions: { input: here + 'preview.html' } } });
