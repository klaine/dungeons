/**
 * Makes squares of a world's land at a metre (`src/core/stream.ts`) about each of its places, without
 * a browser, and reports how long each took, how many triangles its mesh has at each distance it may
 * be meshed to, and whether neighbouring squares meet: along an edge they share, their heights must
 * be the same to the millimetre, or there is a crack.
 *
 *   npx tsx tools/stream.ts [world seed] [squares about each place, 1 for 3 by 3]
 */
import { TILE, world, worldTile } from '../src/core/world';
import { makeSquare, meshTriangles, Square, SQUARE, squareCount, TileData, TileGrid, tilesFor } from '../src/core/stream';

const seed = process.argv[2] ?? 'w2', reach = Number(process.argv[3] ?? 1);
const w = world(seed), p = w.plan, grid: TileGrid = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz };
const tileData = new Map<string, TileData>();
const tile = (i: number, j: number): TileData => {
  const key = `${i},${j}`;
  let t = tileData.get(key);
  if (!t) { const w5 = worldTile(w, i, j), f = w5.field; t = { i, j, ox: w5.ox, oz: w5.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data: f.data }; tileData.set(key, t); }
  return t;
};
const [cx, cz] = squareCount(grid), made = new Map<string, Square>(), times: number[] = [];
const levels = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6], tris = levels.map(() => 0);
for (const q of w.places) {
  const ci = Math.floor((q.x + p.hx) / SQUARE.size), cj = Math.floor((q.z + p.hz) / SQUARE.size);
  for (let j = cj - reach; j <= cj + reach; j++) for (let i = ci - reach; i <= ci + reach; i++) {
    if (i < 0 || j < 0 || i >= cx || j >= cz || made.has(`${i},${j}`)) continue;
    const s = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n);
    made.set(`${i},${j}`, s); times.push(s.ms);
    levels.forEach((e, k) => { tris[k] += meshTriangles(s.errors, e).count; });
  }
}
// Neighbours meet: the east edge of one is the west edge of the next, the south edge of one the north edge of the one below.
let shared = 0, worst = 0;
const n = SQUARE.n, last = n - 1;
for (const [key, s] of made) {
  const [i, j] = key.split(',').map(Number);
  const east = made.get(`${i + 1},${j}`), south = made.get(`${i},${j + 1}`);
  if (east) { shared++; for (let r = 0; r < n; r++) worst = Math.max(worst, Math.abs(s.heights[r * n + last] - east.heights[r * n])); }
  if (south) { shared++; for (let c = 0; c < n; c++) worst = Math.max(worst, Math.abs(s.heights[last * n + c] - south.heights[c])); }
}
const full = (SQUARE.n - 1) ** 2 * 2 * made.size;
times.sort((a, b) => a - b);
console.log(`${seed}: ${made.size} squares about ${w.places.length} places; ${tileData.size} tiles of 5 m read`);
console.log(`  a square took ${times[0].toFixed(0)} to ${times[times.length - 1].toFixed(0)} ms, ${times[Math.floor(times.length / 2)].toFixed(0)} the middle`);
console.log(`  triangles, of ${full.toLocaleString()} for the full lattice: ` + levels.map((e, k) => `${e * 100} cm ${((100 * tris[k]) / full).toFixed(1)}%`).join(', '));
console.log(`  ${shared} edges shared between neighbours; they differ by at most ${(worst * 1000).toFixed(3)} mm`);
process.exit(worst > 1e-3 ? 1 : 0);
