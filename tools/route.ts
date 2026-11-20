/**
 * Lays the ways from each coastal town of a world to the valley head nearest it by way (`src/core/route.ts`), without a browser, and
 * reports how long each is and how it climbs; then makes the squares at a metre along the shortest (or the one asked for) with its bed
 * cut into them (`withWay`), and checks them: that neighbouring squares still meet exactly; that the land on the way's middle line is
 * the bed's height (but where a house's ground is laid over it); how far the bed is cut into the land or built up over it; how long a
 * square takes with a way through it; and how many triangles a mesh keeps with the way's points kept.
 *
 *   npx tsx tools/route.ts [world seed] [town number] [corridor breadth, metres]
 */
import { TILE, world, worldTile } from '../src/core/world';
import { layRoute, townValleyRoutes, wayClimb, wayOf } from '../src/core/route';
import { makeSquare, meshTriangles, Square, SQUARE, squareCount, TileData, TileGrid, tilesAt, tilesFor } from '../src/core/stream';
import { WayIndex } from '../src/core/way';

const seed = process.argv[2] ?? 'w0', townAsked = Number(process.argv[3] ?? 0), broad = Number(process.argv[4] ?? 300);
let t0 = Date.now();
const w = world(seed), p = w.plan, grid: TileGrid = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz };
console.log(`${seed}: world made in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
t0 = Date.now();
const routes = townValleyRoutes(w);
console.log(`  ${routes.length} towns' ways to their nearest valley heads laid in ${((Date.now() - t0) / 1000).toFixed(1)} s:`);
for (const r of routes) console.log(`    ${r.from.name} (coast${r.from.n}) to ${r.to.name} (valley${r.to.n}): ${(r.length / 1000).toFixed(2)} km, as the crow flies ${(Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z) / 1000).toFixed(2)}`);
const town = townAsked ? w.places.find((q) => q.kind === 'coast' && q.n === townAsked) : undefined;
const route = town ? routes.find((r) => r.from.n === town.n) ?? null : routes[0];
if (!route) { console.log('  no way to walk'); process.exit(1); }
t0 = Date.now();
const way = wayOf(w, route), climb = wayClimb(way);
console.log(`  the way from ${route.from.name} to ${route.to.name}: ${(route.length / 1000).toFixed(2)} km, ${way.points.length} points; graded in ${((Date.now() - t0) / 1000).toFixed(1)} s; up ${climb.up.toFixed(0)} m, down ${climb.down.toFixed(0)} m, steepest ${(climb.steepest * 100).toFixed(1)}% over 20 m`);
// (The direct route, to check the one chosen is the one `layRoute` gives.)
void layRoute;

// The squares the corridor touches.
const tileData = new Map<string, TileData>();
const tile = (i: number, j: number): TileData => {
  const key = `${i},${j}`;
  let t = tileData.get(key);
  if (!t) { const w5 = worldTile(w, i, j), f = w5.field; t = { i, j, ox: w5.ox, oz: w5.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data: f.data }; tileData.set(key, t); }
  return t;
};
const [cx, cz] = squareCount(grid), want = new Set<string>(), half = broad / 2;
for (const [x, z] of way.points) {
  for (let j = Math.floor((z - half + p.hz) / SQUARE.size); j <= Math.floor((z + half + p.hz) / SQUARE.size); j++)
    for (let i = Math.floor((x - half + p.hx) / SQUARE.size); i <= Math.floor((x + half + p.hx) / SQUARE.size); i++) if (i >= 0 && j >= 0 && i < cx && j < cz) want.add(`${i},${j}`);
}
const grounds = w.places.flatMap((q) => (q.ground ? [q.ground] : []));
const made = new Map<string, Square>(), times: number[] = [], plainTimes: number[] = [];
const levels = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6], tris = levels.map(() => 0), plainTris = levels.map(() => 0);
let cutMost = 0, fillMost = 0, offBed = 0, onBed = 0;
const ix = new WayIndex(way);
for (const key of want) {
  const [i, j] = key.split(',').map(Number), use = tilesFor(grid, i, j).map(([a, b]) => tile(a, b));
  const s = makeSquare(grid, use, i, j, p.n, grounds, [way]);
  const plain = makeSquare(grid, use, i, j, p.n, grounds);
  made.set(key, s); times.push(s.ms); plainTimes.push(plain.ms);
  levels.forEach((e, k) => { tris[k] += meshTriangles(s.errors, e).count; plainTris[k] += meshTriangles(plain.errors, e).count; });
  for (let k = 0; k < s.heights.length; k++) {
    const d = s.heights[k] - plain.heights[k];
    cutMost = Math.max(cutMost, -d); fillMost = Math.max(fillMost, d);
    const x = s.x0 + (k % SQUARE.n), z = s.z0 + Math.floor(k / SQUARE.n), n = ix.near(x, z);
    // (On the bed, but not where a house's ground is laid over it, which a way comes onto as the ground lies.)
    if (n && n.d < way.half && !grounds.some((g) => Math.hypot(x - g.x, z - g.z) < Math.hypot(g.w, g.d) / 2 + 20)) { onBed++; offBed = Math.max(offBed, Math.abs(s.heights[k] - n.y)); }
  }
}
let shared = 0, worst = 0;
const n = SQUARE.n, last = n - 1;
for (const [key, s] of made) {
  const [i, j] = key.split(',').map(Number), east = made.get(`${i + 1},${j}`), south = made.get(`${i},${j + 1}`);
  if (east) { shared++; for (let r = 0; r < n; r++) worst = Math.max(worst, Math.abs(s.heights[r * n + last] - east.heights[r * n])); }
  if (south) { shared++; for (let c = 0; c < n; c++) worst = Math.max(worst, Math.abs(s.heights[last * n + c] - south.heights[c])); }
}
// How far the bed lies from the tiles' land under it (what it was graded from), before the detail and wear the squares add.
const landRead = [...tileData.values()].map((t) => { const w5 = worldTile(w, t.i, t.j); return { t, f: w5.field }; });
let bedOff = 0;
way.points.forEach(([x, z], k) => { bedOff = Math.max(bedOff, Math.abs(way.heights[k] - tilesAt(landRead, grid, x, z))); });
const mid = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`  ${made.size} squares in a corridor ${broad} m broad; a square ${mid(times).toFixed(0)} ms in the middle with the way, ${mid(plainTimes).toFixed(0)} without`);
console.log(`  ${shared} edges shared between neighbours; they differ by at most ${(worst * 1000).toFixed(3)} mm`);
console.log(`  on the bed (${onBed.toLocaleString()} points) the land lies within ${(offBed * 1000).toFixed(1)} mm of it; cut ${cutMost.toFixed(2)} m at most, built up ${fillMost.toFixed(2)} m; the bed ${bedOff.toFixed(2)} m from the tiles' land at most`);
console.log('  triangles with the way kept / without: ' + levels.map((e, k) => `${e * 100} cm ${(tris[k] / 1000).toFixed(0)}k/${(plainTris[k] / 1000).toFixed(0)}k`).join(', '));
