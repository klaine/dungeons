import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // Six pages: the tool itself, the gallery of candidates, the map of a world, a walk over a world's land streamed in at a metre, the
    // small example that reads what it exports, and the building lab (`lab/`).
    rollupOptions: { input: { main: 'index.html', gallery: 'gallery.html', world: 'world.html', walk: 'walk.html', viewer: 'examples/viewer/index.html', lab: 'lab/index.html' } },
  },
});
