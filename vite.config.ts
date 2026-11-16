import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // Three pages: the tool itself, the gallery of candidates, and the small example that reads what it exports.
    rollupOptions: { input: { main: 'index.html', gallery: 'gallery.html', viewer: 'examples/viewer/index.html' } },
  },
});
