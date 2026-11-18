import { worldSteps } from '../core/world';

/**
 * Makes a world away from the page, which would otherwise hold still for the half minute or more
 * it takes: says what it is doing at each stage, then hands over what the map needs.
 */
self.onmessage = (e: MessageEvent<{ seed: string; size?: { x: number; z: number } }>) => {
  const steps = worldSteps(e.data.seed, e.data.size);
  for (;;) {
    const s = steps.next();
    if (!s.done) { self.postMessage({ type: 'progress', text: s.value }); continue; }
    const w = s.value, f = w.field;
    const data = {
      plan: w.plan, name: w.name, regions: w.regions, peakNames: w.peakNames, peaks: w.peaks,
      field: { x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data: f.data },
      sea: w.sea, lake: w.lake, cover: w.cover, rivers: w.rivers, places: w.places, towns: w.towns, ways: w.ways, timing: w.timing,
    };
    // (Handed over, not copied: this worker makes one world and is done.)
    self.postMessage({ type: 'done', data }, { transfer: [f.data.buffer, w.sea.buffer, w.lake.buffer, w.cover.buffer] });
    return;
  }
};
