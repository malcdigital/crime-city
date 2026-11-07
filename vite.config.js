import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    // (your car's model, src/assets/azure.glb, goes inside the build: the game's one file)
    assetsInlineLimit: (file) => (file.endsWith('.glb') ? true : undefined),
  },
});
