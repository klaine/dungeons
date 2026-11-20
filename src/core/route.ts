import { tilesAt, TileData } from './stream';
import { leastPath, smoothLine } from './terrain';
import { evenly, gradeWay, lengthOf, Way, WAY } from './way';
import { RIVER, TILE, World, WorldPlace, worldTile } from './world';

/**
 * Ways between the places of a world, to be walked from one to the next (asked: "lets try this with one traversable path from a town
 * to a valley"): laid over the world's land as its tracks are (`layWays`), round a hill rather than over it and along a slope rather
 * than up it, then given a bed of its own, graded, which the land at a metre is cut and filled to (`withWay`) and the ground's
 * material draws as a cart track. See `docs/06-world.md`, *A way between places*.
 */

/** One end of a route: a place of the world, and where on it the way begins or ends. */
export interface RouteEnd { kind: WorldPlace['kind']; n: number; name: string; x: number; z: number }

/** A route from one place to another: its ends, its line over the land, and how long it is. */
export interface WorldRoute { from: RouteEnd; to: RouteEnd; line: [number, number][]; length: number }

/** The world's land on a lattice of 16 metres, as `layWays` reads it: heights, water, and where rivers are broad enough to need a bridge. */
interface Lattice { n: number; m: number; cell: number; x0: number; z0: number; H: Float32Array; water: Uint8Array; river: Uint8Array }
const LATTICES = new WeakMap<World, Lattice>();
function latticeOf(w: World): Lattice {
  const had = LATTICES.get(w);
  if (had) return had;
  const f = w.field, S = 2, n = Math.floor((f.nx - 1) / S) + 1, m = Math.floor((f.nz - 1) / S) + 1;
  const H = new Float32Array(n * m), water = new Uint8Array(n * m), river = new Uint8Array(n * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const k = j * S * f.nx + i * S, g = j * n + i;
    H[g] = f.data[k]; water[g] = w.sea[k] || w.lake[k] ? 1 : 0; river[g] = w.acc[k] >= RIVER * 3 ? 1 : 0;
  }
  const l = { n, m, cell: f.cell * S, x0: f.x0, z0: f.z0, H, water, river };
  LATTICES.set(w, l);
  return l;
}

/** Where on a place a way to or from it begins: a town at its quay, on dry land; a valley head at its house; a mountain top at its ridge's foot. */
export function routeEnd(w: World, q: WorldPlace): RouteEnd {
  const L = latticeOf(w);
  let x = q.x, z = q.z;
  if (q.kind === 'mountain' && q.ridge) [x, z] = q.ridge.foot;
  if (q.kind === 'island' && q.landing) ({ x, z } = q.landing);
  // (On dry land: a town's quay is at the water's edge, and the lattice may put it in the sea.)
  const at = (gx: number, gz: number) => Math.min(L.m - 1, Math.max(0, Math.round((gz - L.z0) / L.cell))) * L.n + Math.min(L.n - 1, Math.max(0, Math.round((gx - L.x0) / L.cell)));
  if (L.water[at(x, z)]) {
    const c = at(x, z), ci = c % L.n, cj = Math.floor(c / L.n);
    search: for (let r = 1; r < 30; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= L.n || j >= L.m || L.water[j * L.n + i]) continue;
      x = L.x0 + i * L.cell; z = L.z0 + j * L.cell;
      break search;
    }
  }
  return { kind: q.kind, n: q.n, name: q.name, x, z };
}

/**
 * The line of a way from one place to another over the world's land, as a track is laid (`layWays`): each step costs its length, the
 * more the steeper (a slope of one in nine is twice the cost of level ground), a bridge as much as ninety metres more, and water may not
 * be crossed. Smoothed, and its points laid evenly `WAY.step` apart. Null if no way goes there over land.
 */
export function layRoute(w: World, from: WorldPlace, to: WorldPlace): WorldRoute | null {
  const L = latticeOf(w), a = routeEnd(w, from), b = routeEnd(w, to), steep = 0.11;
  const stepLen = (p: number, q: number) => L.cell * (Math.abs((p % L.n) - (q % L.n)) && Math.abs(p - q) !== 1 ? Math.SQRT2 : 1);
  const cost = (p: number, q: number) => {
    if (L.water[q]) return Infinity;
    const len = stepLen(p, q), s = Math.abs(L.H[q] - L.H[p]) / len;
    return len * (1 + (s / steep) ** 2) + (L.river[q] && !L.river[p] ? 90 : 0);
  };
  const raw = leastPath(L.x0, L.z0, L.cell, L.n, L.m, [a.x, a.z], [b.x, b.z], cost);
  if (!raw) return null;
  const line = evenly(smoothLine(raw, 4), WAY.step);
  return { from: a, to: b, line, length: lengthOf(line) };
}

/** For each town, the way to the valley head nearest it by way (not as the crow flies); the shortest first. */
export function townValleyRoutes(w: World): WorldRoute[] {
  const out: WorldRoute[] = [];
  for (const t of w.places.filter((q) => q.kind === 'coast')) {
    let best: WorldRoute | null = null;
    for (const v of w.places.filter((q) => q.kind === 'valley')) { const r = layRoute(w, t, v); if (r && (!best || r.length < best.length)) best = r; }
    if (best) out.push(best);
  }
  return out.sort((p, q) => p.length - q.length);
}

/**
 * A route's way: its bed graded on the land the squares at a metre are made from (the world's tiles of 5 metres, blended where they
 * overlap, `tilesAt`), so that it is cut into that land by a metre or two at most where the land is lumpy, not by the metres the world's
 * own lattice of 8 metres can lie off it. The tiles it crosses are made if they are not yet (a second or two each).
 */
export function wayOf(w: World, r: WorldRoute): Way {
  const grid = { stride: TILE.stride, over: TILE.over, hx: w.plan.hx, hz: w.plan.hz }, reach = TILE.stride / 2 + TILE.over;
  const tx = Math.round((2 * w.plan.hx) / TILE.stride), tz = Math.round((2 * w.plan.hz) / TILE.stride), need = new Set<string>();
  for (const [x, z] of r.line) for (let j = 0; j < tz; j++) for (let i = 0; i < tx; i++) {
    const ox = -w.plan.hx + TILE.stride / 2 + i * TILE.stride, oz = -w.plan.hz + TILE.stride / 2 + j * TILE.stride;
    if (Math.abs(x - ox) < reach && Math.abs(z - oz) < reach) need.add(`${i},${j}`);
  }
  const read = [...need].map((key) => {
    const [i, j] = key.split(',').map(Number), t = worldTile(w, i, j), f = t.field;
    const data: TileData = { i, j, ox: t.ox, oz: t.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data: f.data };
    return { t: data, f };
  });
  return gradeWay(r.line, (x, z) => tilesAt(read, grid, x, z));
}

/** How a way climbs: up and down along it in all, and its steepest over any twenty metres. */
export function wayClimb(way: Way): { up: number; down: number; steepest: number } {
  let up = 0, down = 0, steepest = 0;
  const h = way.heights, k20 = Math.max(1, Math.round(20 / WAY.step));
  for (let k = 1; k < h.length; k++) { const d = h[k] - h[k - 1]; if (d > 0) up += d; else down -= d; }
  for (let k = k20; k < h.length; k++) steepest = Math.max(steepest, Math.abs(h[k] - h[k - k20]) / lengthOf(way.points.slice(k - k20, k + 1)));
  return { up, down, steepest };
}
