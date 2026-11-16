import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // Two pages: the tool itself, and the small example that reads what it exports.
    rollupOptions: { input: { main: 'index.html', viewer: 'examples/viewer/index.html' } },
  },
});
