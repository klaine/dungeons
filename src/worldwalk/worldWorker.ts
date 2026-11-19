import { World, worldSteps, worldTile } from '../core/world';
import { worldData } from '../worldmap/worldData';

/**
 * The world, made away from the page and kept here: first all of it that the page needs to draw it
 * far off and to know where it is, then its tiles of 5 metres one at a time, as the squares at a
 * metre ask for them (each made when first asked for: some two seconds).
 */
let w: World | null = null;
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'world') {
    const steps = worldSteps(m.seed, m.size);
    for (;;) {
      const s = steps.next();
      if (!s.done) { self.postMessage({ type: 'progress', text: s.value }); continue; }
      w = s.value;
      break;
    }
    // (Copied, not handed over: the tiles are made from the world, which stays here. With what its ink map needs, which the game draws.)
    self.postMessage({ type: 'world', world: worldData(w) });
  } else if (m.type === 'tile' && w) {
    const t = worldTile(w, m.i, m.j), f = t.field, data = f.data.slice();
    self.postMessage({ type: 'tile', tile: { i: m.i, j: m.j, ox: t.ox, oz: t.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data } }, { transfer: [data.buffer] });
  }
};
