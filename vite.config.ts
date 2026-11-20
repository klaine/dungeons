import { defineConfig, Plugin } from 'vite';

/**
 * For the material lab (`lab/materials.html`), while developing. The lab takes up a saved material
 * file where it stands, without loading its page again. The dev server would not let it: once the
 * game has been served too, it knows the game's program uses the same file and cannot take it up
 * that way, and tells every page to load again, the lab with the rest. So for these files the
 * telling is done here: pages that have said they are the lab are told which file was saved, and
 * fetch it again themselves; every other page is told to load again, as before. With no lab open
 * nothing is changed.
 */
const LAB_FILES = ['/src/render/siteMaterial.ts', '/src/render/vegetation.ts', '/src/render/textures.ts'];
function labHot(): Plugin {
  const labs = new WeakSet<object>();
  return {
    name: 'lab-hot',
    apply: 'serve',
    configureServer(server) {
      server.ws.on('lab:here', (_data, client) => { labs.add((client as unknown as { socket: object }).socket); });
    },
    hotUpdate({ file, modules, timestamp, server }) {
      if (this.environment.name !== 'client') return;
      const path = LAB_FILES.find((f) => file.split('\\').join('/').endsWith(f));
      const clients = [...server.ws.clients];
      if (!path || !clients.some((c) => labs.has(c.socket))) return;
      for (const m of modules) this.environment.moduleGraph.invalidateModule(m, undefined, timestamp, true);
      for (const c of clients) {
        if (labs.has(c.socket)) c.send('lab:saved', { path, timestamp });
        else c.send({ type: 'full-reload', path: '*' });
      }
      return [];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [labHot()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // Seven pages: the tool itself, the gallery of candidates, the map of a world, a walk over a world's land streamed in at a metre, the
    // small example that reads what it exports, the building lab, and the route lab (a way from a town to a valley head, walked).
    rollupOptions: { input: { main: 'index.html', gallery: 'gallery.html', world: 'world.html', walk: 'walk.html', viewer: 'examples/viewer/index.html', buildings: 'lab/buildings.html', route: 'lab/route.html' } },
  },
});
