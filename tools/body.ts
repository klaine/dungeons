/**
 * Walks the game's own body (`Player`) over a world's land at a metre, without a browser, as the walk and route pages now move it
 * (`src/worldwalk/body.ts`): on a patch of ground about it made again as it goes, stopped by the trunks of the trees standing there.
 * First the shortest town's way to its valley head (`route.ts`), running, steering for a point some way ahead along it; then straight
 * through the thickest wood near the way and back. Reports how long each took against how long it should, where the body was stopped
 * and for how long, how far it ever stood under or over the ground, how many patches were made and how long one took.
 *
 *   npx tsx tools/body.ts [world seed]
 */
// (The body listens to the page for keys and the mouse; here there is no page.)
(globalThis as Record<string, unknown>).document = { addEventListener() {}, body: { classList: { toggle() {} } } };
(globalThis as Record<string, unknown>).window = { addEventListener() {} };
import { PerspectiveCamera, Vector3 } from 'three';
import { Player } from '../src/app/player';
import { townValleyRoutes, wayOf } from '../src/core/route';
import { makeSquare, Square, SQUARE, squareCount, TileData, TileGrid, tilesFor } from '../src/core/stream';
import { COVER, TILE, world, worldTile } from '../src/core/world';
import { WorldColliders } from '../src/worldwalk/body';
import { treesIn, woodDepth } from '../src/worldwalk/dress';

const seed = process.argv[2] ?? 'w0';
const w = world(seed), p = w.plan, grid: TileGrid = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz }, f = w.field;
const route = townValleyRoutes(w)[0];
if (!route) { console.log(`${seed}: no way from a town to a valley head`); process.exit(1); }
const way = wayOf(w, route), grounds = w.places.flatMap((q) => (q.ground ? [q.ground] : []));
// The squares at a metre, made as they are wanted, with the way's bed in them, as the page's workers make them.
const tileData = new Map<string, TileData>(), squares = new Map<string, Square>();
const tile = (i: number, j: number): TileData => {
  const key = `${i},${j}`;
  let t = tileData.get(key);
  if (!t) { const w5 = worldTile(w, i, j), fl = w5.field; t = { i, j, ox: w5.ox, oz: w5.oz, x0: fl.x0, z0: fl.z0, cell: fl.cell, nx: fl.nx, nz: fl.nz, data: fl.data }; tileData.set(key, t); }
  return t;
};
const [SX, SZ] = squareCount(grid);
let squareMs = 0;
const squareAt = (x: number, z: number): Square | null => {
  const i = Math.floor((x + grid.hx) / SQUARE.size), j = Math.floor((z + grid.hz) / SQUARE.size), key = `${i},${j}`;
  if (i < 0 || j < 0 || i >= SX || j >= SZ) return null;
  let s = squares.get(key);
  if (!s) { s = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n, grounds, [way]); squares.set(key, s); squareMs += s.ms; }
  return s;
};
/** The land as the page draws it: a square's heights between its points. */
const heightAt = (x: number, z: number): number => {
  const s = squareAt(x, z);
  if (!s) return f.smoothAt(x, z);
  const n = SQUARE.n, fx = Math.min(n - 1.001, Math.max(0, x - s.x0)), fz = Math.min(n - 1.001, Math.max(0, z - s.z0)), a = Math.floor(fx), b = Math.floor(fz), tx = fx - a, tz = fz - b, h = s.heights;
  return h[b * n + a] * (1 - tx) * (1 - tz) + h[b * n + a + 1] * tx * (1 - tz) + h[(b + 1) * n + a] * (1 - tx) * tz + h[(b + 1) * n + a + 1] * tx * tz;
};
const coverAt = (x: number, z: number) => w.cover[Math.min(f.nz - 1, Math.max(0, Math.round((z - f.z0) / f.cell))) * f.nx + Math.min(f.nx - 1, Math.max(0, Math.round((x - f.x0) / f.cell)))];
const depthAt = woodDepth(w.cover, f.nx, f.nz, f.x0, f.z0, f.cell);
// (Clear of the way's bed, as the page keeps trees off it.)
const near = (x: number, z: number) => { let d = Infinity; for (const [px, pz] of way.points) d = Math.min(d, Math.hypot(px - x, pz - z)); return d; };
const treeCover = (x: number, z: number) => (near(x, z) < way.half + 4 ? COVER.shore : coverAt(x, z));
let trunksSeen = 0;
const colliders = new WorldColliders(heightAt, (x0, z0, x1) => { const t = treesIn(x0, z0, x1 - x0, treeCover, heightAt, p.n, depthAt); trunksSeen += t.length; return t.map((q) => ({ x: q.x, z: q.z, r: Math.max(0.2, q.girth * 1.1) })); });
const player = new Player(new PerspectiveCamera(), { addEventListener() {} } as unknown as HTMLElement, colliders);
player.fallTo = -1e4;
let sunk = 0, high = 0, snapped = 0;
player.constrain = (at) => { const g = heightAt(at.x, at.z); if (at.y < g - 0.3) { at.y = g; snapped++; } };
const patchMs: number[] = [];
/** The trunks about a stretch, for measuring how near the body came to them (it must stay its own breadth off). */
let closest = Infinity;
const trunksNear = (x: number, z: number) => treesIn(Math.floor(x / 32) * 32 - 32, Math.floor(z / 32) * 32 - 32, 96, treeCover, heightAt, p.n, depthAt);
let trunkCache = { key: '', list: [] as ReturnType<typeof trunksNear> };
/** Walks to each point in turn, running, steering for it; reports what happened. */
const walk = (name: string, pts: [number, number][], ahead: number) => {
  const dt = 1 / 60;
  let frames = 0, stuck = 0, stuckAt: [number, number] | null = null, best = 0, length = 0, airborne = 0;
  for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  let k = 0, lastProgress = 0, lastX = player.position.x, lastZ = player.position.z;
  const before = colliders.made;
  while (k < pts.length - 1 && frames < 60 * 60 * 20) {
    // (The point some way ahead along the line from the nearest one passed.)
    while (k < pts.length - 1 && Math.hypot(pts[k][0] - player.position.x, pts[k][1] - player.position.z) < ahead) k++;
    const [tx, tz] = pts[k];
    player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
    player.analog.set(0, -1); player.analogRun = true;
    const t0 = performance.now(), m0 = colliders.made;
    colliders.follow(player.position.x, player.position.z, 0);
    if (colliders.made > m0) patchMs.push(performance.now() - t0);
    player.update(dt);
    frames++;
    const g = heightAt(player.position.x, player.position.z), over = player.position.y - g;
    const tk = `${Math.floor(player.position.x / 32)},${Math.floor(player.position.z / 32)}`;
    if (tk !== trunkCache.key) trunkCache = { key: tk, list: trunksNear(player.position.x, player.position.z) };
    for (const t of trunkCache.list) closest = Math.min(closest, Math.hypot(t.x - player.position.x, t.z - player.position.z) - Math.max(0.2, t.girth * 1.1));
    sunk = Math.max(sunk, -over); high = Math.max(high, over);
    if (!player.grounded) airborne++;
    const moved = Math.hypot(player.position.x - lastX, player.position.z - lastZ);
    lastX = player.position.x; lastZ = player.position.z;
    // (Stopped: less than a tenth of its pace for a second together.)
    if (moved < 6.5 * dt * 0.1) { if (++stuck > 60 && !stuckAt) stuckAt = [player.position.x, player.position.z]; } else stuck = 0;
    if (k > best) { best = k; lastProgress = frames; }
    if (frames - lastProgress > 60 * 20) break;
  }
  const reached = k >= pts.length - 1, secs = frames / 60;
  console.log(`  ${name}: ${(length / 1000).toFixed(2)} km ${reached ? 'walked' : 'NOT walked'} in ${secs.toFixed(0)} s (${(length / 6.5).toFixed(0)} s at a run), ${(100 * airborne / Math.max(1, frames)).toFixed(0)}% of frames off the ground; ${colliders.made - before} patches${stuckAt ? `; stopped a second or more at ${stuckAt.map((v) => v.toFixed(0)).join(', ')}` : ''}`);
  return reached;
};
// (Every square the walks will cross made beforehand, as the page's workers would have them, so that a patch's time is its own.)
const [mx, mz] = way.points[Math.floor(way.points.length / 2)];
for (const [x, z] of way.points) for (const dx of [-64, 0, 64]) for (const dz of [-64, 0, 64]) squareAt(x + dx, z + dz);
for (let z = mz - 360; z <= mz + 360; z += 128) for (let x = mx - 360; x <= mx + 360; x += 128) squareAt(x, z);
const [sx, sz] = way.points[1];
player.place(new Vector3(sx, heightAt(sx, sz) + 1.68, sz), 0);
console.log(`${seed}: ${route.from.name} to ${route.to.name}, ${(route.length / 1000).toFixed(2)} km`);
const okWay = walk('along the way', way.points, 8);
// Then straight through the thickest wood within three hundred metres of the way's middle, and back.
let wx = mx, wz = mz, deepest = -Infinity;
for (let z = mz - 300; z <= mz + 300; z += 16) for (let x = mx - 300; x <= mx + 300; x += 16) { const d = depthAt(x, z); if (d > deepest && heightAt(x, z) > 2) { deepest = d; wx = x; wz = z; } }
const line: [number, number][] = [];
for (let t = -1; t <= 1.0001; t += 0.05) line.push([wx + t * 120, wz + t * 40]);
player.place(new Vector3(line[0][0], heightAt(line[0][0], line[0][1]) + 1.68, line[0][1]), 0);
const okWood = walk(`through a wood ${deepest.toFixed(0)} m deep`, line, 3);
const back = [...line].reverse();
const okBack = walk('and back', back, 3);
patchMs.sort((a, b) => a - b);
console.log(`  came within ${closest.toFixed(2)} m of a trunk's bark at nearest (the body is ${0.28} m broad either way)`);
console.log(`  stood ${(sunk * 100).toFixed(0)} cm under the ground at worst (put back on it ${snapped} times), ${high.toFixed(2)} m over it; ${trunksSeen.toLocaleString()} trunks met in all; a patch ${patchMs[Math.floor(patchMs.length / 2)]?.toFixed(1)} ms in the middle, ${patchMs[patchMs.length - 1]?.toFixed(1)} at most; ${squares.size} squares made (${(squareMs / 1000).toFixed(0)} s)`);
process.exit(okWay && okWood && okBack && closest > 0.25 ? 0 : 1);
