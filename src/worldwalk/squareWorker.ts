import { makeSquare, TileData } from '../core/stream';

/** Makes squares of land at a metre, one at a time, from tiles the page sends (each kept here once sent). */
const tiles = new Map<string, TileData>();
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  for (const t of m.tiles as TileData[]) tiles.set(`${t.i},${t.j}`, t);
  const use = (m.need as [number, number][]).map(([a, b]) => tiles.get(`${a},${b}`)!);
  const s = makeSquare(m.grid, use, m.i, m.j, m.seed, m.grounds);
  self.postMessage({ type: 'square', i: s.i, j: s.j, x0: s.x0, z0: s.z0, heights: s.heights, errors: s.errors, ms: s.ms }, { transfer: [s.heights.buffer, s.errors.buffer] });
};
