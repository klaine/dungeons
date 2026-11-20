import { makeSquare, refineSquare, TileData } from '../core/stream';

/**
 * Makes squares of land at a metre, one at a time, from tiles the page sends (each kept here once
 * sent), with the beds of any ways through them cut in (`withWay`) and the land brought to meet any
 * place standing in the world (`withHole`); and splits a square the page
 * sends back into four at half a metre, when it asks.
 */
const tiles = new Map<string, TileData>();
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'fine') {
    const r = refineSquare(m.heights, m.i, m.j, m.x0, m.z0, m.seed, m.grounds);
    self.postMessage({ type: 'fine', i: m.i, j: m.j, quarters: r.quarters, ms: r.ms }, { transfer: r.quarters.flatMap((q) => [q.heights.buffer, q.errors.buffer]) });
    return;
  }
  for (const t of m.tiles as TileData[]) tiles.set(`${t.i},${t.j}`, t);
  const use = (m.need as [number, number][]).map(([a, b]) => tiles.get(`${a},${b}`)!);
  const s = makeSquare(m.grid, use, m.i, m.j, m.seed, m.grounds, m.ways ?? [], m.holes ?? []);
  self.postMessage({ type: 'square', i: s.i, j: s.j, x0: s.x0, z0: s.z0, heights: s.heights, errors: s.errors, ms: s.ms }, { transfer: [s.heights.buffer, s.errors.buffer] });
};
