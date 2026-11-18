import { Rng } from './rng';
import { fbmd, HeightField, landDetail, wearByFrost, wearByWater } from './terrain';
import { Ground, withGrounds } from './fit';

/**
 * The world's land at a metre, made a square at a time where it is wanted (`docs/06-world.md`,
 * step 2): squares 256 metres on a side on a fixed grid in the world, so that a square is the same
 * whoever asks for it and whenever. A square is made from the world's tiles of 5 metres under it
 * (`worldTile`), blended where tiles overlap, with detail laid on finer than they hold, and worn a
 * little by water and frost at its own scale. The wear fades out towards the square's edge, so that
 * along its edge a square is the plain function of the tiles and the detail, which its neighbour
 * shares: two squares meet exactly. Nothing here draws: what is drawn is made from the heights and
 * from how far each point may be left out (`errorsOf`), by `streamMesh.ts`.
 *
 * Coordinates are the world's (`x` east, `z` south, metres from its middle).
 */

/** The squares' grid: 256 metres, 257 points a side at a metre, from the world's north-west corner. */
export const SQUARE = { size: 256, n: 257 };
/** How far beyond a square its land is made and worn, so the wear at its edge has ground to run on; and how far in from the edge the wear fades in. */
const APRON = 24, FADE = 20;

/** What a square needs of the world's tiles: each tile's lattice and where its middle lies (`ox`, `oz`). */
export interface TileData { i: number; j: number; ox: number; oz: number; x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array }
/** The tiles' grid, as the world has it (`TILE` in `world.ts`): a tile every `stride` metres, reaching `over` beyond. */
export interface TileGrid { stride: number; over: number; hx: number; hz: number }

/** Where a square lies: its north-west corner in the world. */
export function squareOrigin(g: TileGrid, i: number, j: number): [number, number] {
  return [-g.hx + i * SQUARE.size, -g.hz + j * SQUARE.size];
}

/** How many squares the world holds each way. */
export function squareCount(g: TileGrid): [number, number] {
  return [Math.ceil((2 * g.hx) / SQUARE.size), Math.ceil((2 * g.hz) / SQUARE.size)];
}

/** The tiles a square's land is read from (with its apron): every tile whose lattice covers any of it. */
export function tilesFor(g: TileGrid, i: number, j: number): [number, number][] {
  const [x0, z0] = squareOrigin(g, i, j), out: [number, number][] = [];
  const reach = g.stride / 2 + g.over;
  const tx = Math.round((2 * g.hx) / g.stride), tz = Math.round((2 * g.hz) / g.stride);
  for (let tj = 0; tj < tz; tj++) for (let ti = 0; ti < tx; ti++) {
    const ox = -g.hx + g.stride / 2 + ti * g.stride, oz = -g.hz + g.stride / 2 + tj * g.stride;
    if (x0 - APRON < ox + reach && x0 + SQUARE.size + APRON > ox - reach && z0 - APRON < oz + reach && z0 + SQUARE.size + APRON > oz - reach) out.push([ti, tj]);
  }
  return out;
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/**
 * The land of the tiles at a point: each tile's height there, weighed by how far inside its own
 * lattice the point lies, so that across the strip where two tiles overlap the land passes from one
 * to the other. (Tiles are worn each alone and differ there; read from one tile or the other, two
 * squares either side of the strip would not meet.)
 */
export function tilesAt(tiles: { t: TileData; f: HeightField }[], g: TileGrid, x: number, z: number): number {
  let sum = 0, weight = 0;
  for (const { t, f } of tiles) {
    const lx = x - t.ox, lz = z - t.oz, reach = g.stride / 2 + g.over;
    const inside = Math.min(reach - Math.abs(lx), reach - Math.abs(lz));
    if (inside <= 0) continue;
    // (Full weight from the tile's own two kilometres inward; nothing at its lattice's edge.)
    const w = smooth(inside / (2 * g.over)) + 1e-6;
    sum += w * f.smoothAt(lx, lz); weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Detail finer than the tiles hold, in metres: knolls and hollows tens of metres across, a metre or
 * two high where the ground is rough and less where it is gentle; and small unevenness on that.
 */
export function detailAt(x: number, z: number, slope: number, seed: number): number {
  const rough = 0.5 + 1.6 * smooth(slope / 0.5);
  return rough * (landDetail(x, z, 42, seed) + 0.25 * fbmd(x / 6, z / 6, 2, seed + 7));
}

/** The light wear a square is given at a metre: shallow gullies, the loose stuff they carry put down in hollows. */
const WEAR = { drops: 1.0, life: 40, inertia: 0.1, capacity: 0.4, erode: 0.12, deposit: 0.2, evaporate: 0.02, gravity: 4, radius: 1, most: 0.15 };
const CUT = 1.5, FILL = 0.6;

/** A made square: its heights at a metre (257 by 257, from its north-west corner), and how far each point may be left out. */
export interface Square { i: number; j: number; x0: number; z0: number; heights: Float32Array; errors: Float32Array; ms: number }

/**
 * Makes a square's land from the tiles under it. `seed` is the world's number for its noise. `grounds`
 * are the houses' grounds fitted to the land (`fit.ts`): made on it, levelled or terraced, with their
 * banks, after the wear; each a function of where a point lies alone, so two squares still meet.
 */
export function makeSquare(g: TileGrid, tiles: TileData[], i: number, j: number, seed: number, grounds: Ground[] = []): Square {
  const t0 = performance.now();
  const [x0, z0] = squareOrigin(g, i, j), n = SQUARE.n + 2 * APRON;
  const read = tiles.map((t) => { const f = new HeightField(t.x0, t.z0, t.cell, t.nx, t.nz); f.data.set(t.data); return { t, f }; });
  const f = new HeightField(x0 - APRON, z0 - APRON, 1, n, n);
  // The tiles' land, then the detail on it, rougher where the tiles' land is steep.
  for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) f.data[jj * n + ii] = tilesAt(read, g, f.x0 + ii, f.z0 + jj);
  const base = f.data.slice();
  for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
    const k = jj * n + ii, l = ii > 2 ? k - 3 : k, r = ii < n - 3 ? k + 3 : k, u = jj > 2 ? k - 3 * n : k, d = jj < n - 3 ? k + 3 * n : k;
    const slope = Math.hypot((base[r] - base[l]) / Math.max(1, (r - l)), (base[d] - base[u]) / Math.max(1, (d - u) / n));
    f.data[k] = base[k] + detailAt(f.x0 + ii, f.z0 + jj, slope, seed);
  }
  // The wear, and then only so much of it as lies far enough in from the square's edge.
  const shaped = f.data.slice();
  wearByWater(f, new Rng(`square/${seed}/${i},${j}`), WEAR);
  for (let k = 0; k < f.data.length; k++) f.data[k] = Math.max(shaped[k] - CUT, Math.min(shaped[k] + FILL, f.data[k]));
  wearByFrost(f, 1, 1.4, 0.4);
  const out = new Float32Array(SQUARE.n * SQUARE.n);
  for (let jj = 0; jj < SQUARE.n; jj++) for (let ii = 0; ii < SQUARE.n; ii++) {
    const k = (jj + APRON) * n + ii + APRON, edge = Math.min(ii, jj, SQUARE.n - 1 - ii, SQUARE.n - 1 - jj);
    out[jj * SQUARE.n + ii] = shaped[k] + (f.data[k] - shaped[k]) * smooth(edge / FADE);
  }
  if (grounds.length) for (let jj = 0; jj < SQUARE.n; jj++) for (let ii = 0; ii < SQUARE.n; ii++) {
    const k = jj * SQUARE.n + ii;
    out[k] = withGrounds(grounds, x0 + ii, z0 + jj, out[k]);
  }
  return { i, j, x0, z0, heights: out, errors: errorsOf(out), ms: performance.now() - t0 };
}

/**
 * How far each point of a square may be left out of its mesh: the most the ground at that point (and
 * at every point of the triangles split at it) departs from the triangle it would otherwise lie in.
 * The square is cut into right triangles, each split at the middle of its long side into two more,
 * down to a metre (as Mapbox's Martini does it, after Evans, Kirkpatrick and Townsend's right-
 * triangulated irregular networks); a mesh true to within a given distance splits wherever this
 * says more than that distance.
 */
export function errorsOf(h: Float32Array): Float32Array {
  const size = SQUARE.n, tile = size - 1, count = tile * tile * 2 - 2, parents = count - tile * tile;
  const coords = triangleCoords(), err = new Float32Array(size * size);
  for (let i = count - 1; i >= 0; i--) {
    const k = i * 4, ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1, cx = mx + my - ay, cy = my + ax - mx, m = my * size + mx;
    err[m] = Math.max(err[m], Math.abs((h[ay * size + ax] + h[by * size + bx]) / 2 - h[m]));
    if (i < parents) err[m] = Math.max(err[m], err[((ay + cy) >> 1) * size + ((ax + cx) >> 1)], err[((by + cy) >> 1) * size + ((bx + cx) >> 1)]);
  }
  return err;
}

let COORDS: Uint16Array | null = null;
/** The two ends of the long side of every triangle of the hierarchy, made once. */
function triangleCoords(): Uint16Array {
  if (COORDS) return COORDS;
  const tile = SQUARE.n - 1, count = tile * tile * 2 - 2, c = new Uint16Array(count * 4);
  for (let i = 0; i < count; i++) {
    let id = i + 2, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
    if (id & 1) { bx = by = cx = tile; } else { ax = ay = cy = tile; }
    while ((id >>= 1) > 1) {
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
      if (id & 1) { bx = ax; by = ay; ax = cx; ay = cy; } else { ax = bx; ay = by; bx = cx; by = cy; }
      cx = mx; cy = my;
    }
    c[i * 4] = ax; c[i * 4 + 1] = ay; c[i * 4 + 2] = bx; c[i * 4 + 3] = by;
  }
  COORDS = c;
  return c;
}

/**
 * The triangles of a square's mesh true to within `maxError` metres, as corners on its lattice
 * (each three pairs of point numbers `i + j * 257`), and the points they use.
 */
export function meshTriangles(errors: Float32Array, maxError: number): { triangles: Uint32Array; count: number } {
  const size = SQUARE.n, tile = size - 1, out: number[] = [];
  const go = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) { go(cx, cy, ax, ay, mx, my); go(bx, by, cx, cy, mx, my); }
    else out.push(ay * size + ax, by * size + bx, cy * size + cx);
  };
  go(0, 0, tile, tile, tile, 0);
  go(tile, tile, 0, 0, 0, tile);
  return { triangles: Uint32Array.from(out), count: out.length / 3 };
}
