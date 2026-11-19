import { generateWorldPlace } from '../core/generate';
import { World, worldSteps } from '../core/world';
import { landOfWorld } from '../core/worldLand';
import { worldData } from './worldData';

/**
 * Builds every place a world found, beforehand (the world's page, *Build every place*): the world made as the game's worker makes it,
 * then each place's layout as the game would lay it out, its house the place's own (`placeSeed`), and each tile of 5 metres made for
 * them. All handed to the page as it comes, to be kept in the browser (`worldStore.ts`), where the game finds them: going to a place
 * built beforehand, it neither makes the world nor its tiles nor lays the place out, but builds what was laid out.
 */
self.onmessage = (e: MessageEvent<{ seed: string; size?: { x: number; z: number } }>) => {
  const { seed, size } = e.data, steps = worldSteps(seed, size);
  let w: World;
  for (;;) {
    const s = steps.next();
    if (!s.done) { self.postMessage({ type: 'progress', text: s.value }); continue; }
    w = s.value;
    break;
  }
  const land = landOfWorld(w);
  self.postMessage({ type: 'world', world: worldData(w) });
  const sent = new Set<string>();
  w.places.forEach((q, k) => {
    self.postMessage({ type: 'progress', text: `Laying out ${q.name}`, done: k, total: w.places.length });
    let site: unknown = null, why = '', house = '';
    try { ({ seed: house, site } = generateWorldPlace(seed, q.kind === 'coast' ? 'town' : q.kind, q.n)); } catch (err) { why = (err as Error).message; }
    // (The tiles made for it, each handed over once.)
    for (const [key, t] of land.tiles) {
      if (sent.has(key)) continue;
      sent.add(key);
      const [i, j] = key.split(',').map(Number), f = t.field, data = f.data.slice();
      self.postMessage({ type: 'tile', tile: { i, j, ox: t.ox, oz: t.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data } }, { transfer: [data.buffer] });
    }
    self.postMessage({ type: 'site', kind: q.kind, n: q.n, seed: house, site, why });
  });
  self.postMessage({ type: 'done' });
};
