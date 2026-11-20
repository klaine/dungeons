/**
 * Builds a valley head into a world as the walk and route pages do (`src/render/placePack.ts`, `src/worldwalk/places.ts`), without a
 * browser, and checks the join: the world's squares at a metre made about it with its hole (`withHole`) still meet one another exactly;
 * along the edge of the place's square they stand at the place's own land; how steep the band that brings them there is; and the
 * game's body (`Player`) walked along the way from the town into the valley to the house's door, on the ground about it and the place's
 * own solid part, crossing the seam: whether it gets there, and how far it ever stood under or over what it walks on.
 *
 *   npx tsx tools/places.ts [world seed]
 */
(globalThis as Record<string, unknown>).document = { addEventListener() {}, body: { classList: { toggle() {} } } };
(globalThis as Record<string, unknown>).window = { addEventListener() {} };
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Player } from '../src/app/player';
import { generateWorldPlace } from '../src/core/generate';
import { townValleyRoutes, wayOf } from '../src/core/route';
import { holeAt, makeSquare, Square, SQUARE, squareCount, TileData, TileGrid, tilesAt, tilesFor, wayThroughHoles } from '../src/core/stream';
import { TILE, world, worldTile } from '../src/core/world';
import { packPlace } from '../src/render/placePack';
import { WorldColliders } from '../src/worldwalk/body';

const seed = process.argv[2] ?? 'w0';
const w = world(seed), p = w.plan, grid: TileGrid = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz }, f = w.field;
const route = townValleyRoutes(w)[0];
if (!route) { console.log(`${seed}: no way from a town to a valley head`); process.exit(1); }
const way = wayOf(w, route), q = w.places.find((o) => o.kind === route.to.kind && o.n === route.to.n)!;
let t = Date.now();
const { site } = generateWorldPlace(seed, 'valley', q.n);
// (With the world's own land, as the page's worker gives it, for how far the place's stands off it at its edge.)
const gridT = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz };
const allTiles: { t: TileData; f: ReturnType<typeof worldTile>['field'] }[] = [];
for (let i = 0; i < Math.round((2 * p.hx) / TILE.stride); i++) for (let j = 0; j < Math.round((2 * p.hz) / TILE.stride); j++) { const w5 = worldTile(w, i, j); allTiles.push({ t: { ox: w5.ox, oz: w5.oz } as TileData, f: w5.field }); }
const pack = packPlace(site, { kind: 'valley', n: q.n, name: q.name }, (x, z) => tilesAt(allTiles, gridT, x, z));
const h = pack.hole;
console.log(`${seed}: ${q.name} laid out and built in ${((Date.now() - t) / 1000).toFixed(0)} s (meshed ${(pack.ms.mesh / 1000).toFixed(0)}), ${(pack.triangles / 1e6).toFixed(2)} million triangles; its square ${(2 * h.hx).toFixed(0)} by ${(2 * h.hz).toFixed(0)} m`);
// The squares about it, made as the page's workers make them, with the way and the place's hole.
const tileData = new Map<string, TileData>(), squares = new Map<string, Square>(), grounds = w.places.flatMap((o) => (o.ground ? [o.ground] : []));
const tile = (i: number, j: number): TileData => {
  const key = `${i},${j}`;
  let d = tileData.get(key);
  if (!d) { const w5 = worldTile(w, i, j), fl = w5.field; d = { i, j, ox: w5.ox, oz: w5.oz, x0: fl.x0, z0: fl.z0, cell: fl.cell, nx: fl.nx, nz: fl.nz, data: fl.data }; tileData.set(key, d); }
  return d;
};
const [SX, SZ] = squareCount(grid);
// (The way graded again on the land as the place leaves it, as the page does when the place comes in.)
const graded = wayThroughHoles(way, [h]);
const times: number[] = [];
const squareAt = (x: number, z: number): Square | null => {
  const i = Math.floor((x + grid.hx) / SQUARE.size), j = Math.floor((z + grid.hz) / SQUARE.size), key = `${i},${j}`;
  if (i < 0 || j < 0 || i >= SX || j >= SZ) return null;
  let s = squares.get(key);
  if (!s) { s = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n, grounds, [graded], [h]); squares.set(key, s); times.push(s.ms); }
  return s;
};
const heightAt = (x: number, z: number): number => {
  const s = squareAt(x, z);
  if (!s) return f.smoothAt(x, z);
  const n = SQUARE.n, fx = Math.min(n - 1.001, Math.max(0, x - s.x0)), fz = Math.min(n - 1.001, Math.max(0, z - s.z0)), a = Math.floor(fx), b = Math.floor(fz), tx = fx - a, tz = fz - b, hh = s.heights;
  return hh[b * n + a] * (1 - tx) * (1 - tz) + hh[b * n + a + 1] * tx * (1 - tz) + hh[(b + 1) * n + a] * (1 - tx) * tz + hh[(b + 1) * n + a + 1] * tx * tz;
};
// (And the same squares without the place, to tell how steep the land is of itself.)
const plain = new Map<string, Square>();
const plainAt = (x: number, z: number): number => {
  const i = Math.floor((x + grid.hx) / SQUARE.size), j = Math.floor((z + grid.hz) / SQUARE.size), key = `${i},${j}`;
  let sq = plain.get(key);
  if (!sq) { sq = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n, grounds, [way]); plain.set(key, sq); }
  const n = SQUARE.n, fx = Math.min(n - 1.001, Math.max(0, x - sq.x0)), fz = Math.min(n - 1.001, Math.max(0, z - sq.z0)), a = Math.floor(fx), b = Math.floor(fz);
  return sq.heights[b * n + a];
};
const reach = Math.hypot(h.hx, h.hz) + 260;
for (let z = h.cz - reach; z <= h.cz + reach; z += 128) for (let x = h.cx - reach; x <= h.cx + reach; x += 128) squareAt(x, z);
for (const [x, z] of way.points) squareAt(x, z);
// They meet one another.
let worst = 0, shared = 0;
const n = SQUARE.n, last = n - 1;
for (const [key, s] of squares) {
  const [i, j] = key.split(',').map(Number), east = squares.get(`${i + 1},${j}`), south = squares.get(`${i},${j + 1}`);
  if (east) { shared++; for (let r = 0; r < n; r++) worst = Math.max(worst, Math.abs(s.heights[r * n + last] - east.heights[r * n])); }
  if (south) { shared++; for (let c = 0; c < n; c++) worst = Math.max(worst, Math.abs(s.heights[last * n + c] - south.heights[c])); }
}
times.sort((a, b) => a - b);
console.log(`  ${squares.size} squares (${times[times.length >> 1].toFixed(0)} ms in the middle); ${shared} shared edges differ by at most ${(worst * 1000).toFixed(3)} mm`);
// Along the square's edge, the world's land against the place's: the place's own land found by looking down on its turf and rock sheet.
const landMeshes = pack.meshes.filter((m) => m.key === 'wild|turf' || m.key === 'wild|rockSheet');
const lg = new BufferGeometry(), lp: number[] = [], li: number[] = [];
for (const m of landMeshes) { const o = lp.length / 3; for (const v of m.position) lp.push(v); for (const v of m.index) li.push(v + o); }
lg.setAttribute('position', new BufferAttribute(new Float32Array(lp), 3)); lg.setIndex(li);
const landBvh = new MeshBVH(lg), ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
const placeLand = (x: number, z: number) => { ray.origin.set(x, 5000, z); return landBvh.raycastFirst(ray, 2)?.point.y ?? NaN; };
const c = Math.cos(h.turn), s = Math.sin(h.turn);
let edgeWorst = 0, edgeSum = 0, edgeN = 0, steepest = 0, ownSteepest = 0, steeper = 0, samples = 0;
for (let k = 0; k < 400; k++) {
  const r = (k / 400) * 4 * (h.hx + h.hz), W = 2 * h.hx, D = 2 * h.hz;
  const [lx, lz] = r < W ? [-h.hx + r, -h.hz] : r < W + D ? [h.hx, -h.hz + (r - W)] : r < 2 * W + D ? [h.hx - (r - W - D), h.hz] : [-h.hx, h.hz - (r - 2 * W - D)];
  const x = h.cx + c * lx - s * lz, z = h.cz + s * lx + c * lz, pl = placeLand(x, z), wl = heightAt(x, z);
  if (Number.isFinite(pl)) { edgeWorst = Math.max(edgeWorst, Math.abs(pl - wl)); edgeSum += Math.abs(pl - wl); edgeN++; }
  // (The band outside: the steepest slope over any two metres going straight out, against the land's own there.)
  const ox = lx === h.hx ? c : lx === -h.hx ? -c : -s * Math.sign(lz), oz = lx === h.hx ? s : lx === -h.hx ? -s : c * Math.sign(lz);
  for (let d = 0; d < 200; d += 2) {
    const g = Math.abs(heightAt(x + ox * (d + 2), z + oz * (d + 2)) - heightAt(x + ox * d, z + oz * d)) / 2, o = Math.abs(plainAt(x + ox * (d + 2), z + oz * (d + 2)) - plainAt(x + ox * d, z + oz * d)) / 2;
    steepest = Math.max(steepest, g); ownSteepest = Math.max(ownSteepest, o); samples++;
    // (How often the band is much steeper than the land was: half as steep again, and steeper than one in two.)
    if (g > 0.5 && g > o * 1.5) steeper++;
  }
}
// A way through the band is still a way: its bed level across, wherever it is a bed (from twenty-five metres out from the place's edge,
// where it fades into the land the place meets).
let causeway = 0, bedPoints = 0;
way.points.forEach(([x, z], k) => {
  const o = holeAt(h, x, z).out;
  if (o < 26 || o > 160) return;
  const [nx, nz] = way.points[Math.min(way.points.length - 1, k + 1)], l = Math.hypot(nx - x, nz - z) || 1, ax = -(nz - z) / l, az = (nx - x) / l;
  causeway = Math.max(causeway, Math.abs(heightAt(x + ax * 2, z + az * 2) - heightAt(x - ax * 2, z - az * 2)));
  bedPoints++;
});
console.log(`  along the way in the band (${bedPoints} points), its bed tilts across by ${(causeway * 100).toFixed(0)} cm at most over four metres`);
console.log(`  at the square's edge the world's land stands within ${(edgeSum / Math.max(1, edgeN) * 100).toFixed(0)} cm of the place's on the whole, ${edgeWorst.toFixed(2)} m at worst; steepest slope in the band outside ${(100 * steepest).toFixed(0)}%, against ${(100 * ownSteepest).toFixed(0)}% for the land without the place; made much steeper than one in two over ${(100 * steeper / samples).toFixed(1)}% of it`);
// The body walked along the way into the valley, then on to the forecourt: on the ground about it and the place's solid part.
const solid = new BufferGeometry();
solid.setAttribute('position', new BufferAttribute(pack.solid.position, 3)); solid.setIndex(new BufferAttribute(pack.solid.index, 1));
const placeBvh = MeshBVH.deserialize(pack.solid.bvh, solid, { setIndex: true });
const inside = (x: number, z: number, by = 0) => holeAt(h, x, z).out < -by;
const colliders = new WorldColliders(heightAt, () => [], (x, z) => inside(x, z, 0.5));
colliders.others.push(placeBvh);
const player = new Player(new PerspectiveCamera(), { addEventListener() {} } as unknown as HTMLElement, colliders);
player.fallTo = -1e4;
const under = new Ray(new Vector3(), new Vector3(0, -1, 0));
const placeGround = (x: number, y: number, z: number) => { under.origin.set(x, y + 1, z); return placeBvh.raycastFirst(under, 2)?.point.y ?? NaN; };
player.constrain = (at) => { if (inside(at.x, at.z)) return; const g = heightAt(at.x, at.z); if (at.y < g - 0.3) at.y = g; };
const pts: [number, number][] = way.points.map(([x, z]) => [x, z]);
const [sx, sz] = pts[2];
player.place(new Vector3(sx, heightAt(sx, sz) + 1.68, sz), 0);
let k = 0, frames = 0, crossed = -1, sunk = 0, over = 0;
t = Date.now();
while (k < pts.length - 1 && frames < 60 * 600) {
  while (k < pts.length - 1 && Math.hypot(pts[k][0] - player.position.x, pts[k][1] - player.position.z) < 6) k++;
  const [tx, tz] = pts[k];
  player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
  player.analog.set(0, -1); player.analogRun = true;
  colliders.follow(player.position.x, player.position.z, 0);
  player.update(1 / 60);
  frames++;
  const at = player.position, ins = inside(at.x, at.z);
  if (ins && crossed < 0) crossed = frames;
  const g = ins ? placeGround(at.x, at.y, at.z) : heightAt(at.x, at.z);
  if (Number.isFinite(g) && player.grounded) { sunk = Math.max(sunk, g - at.y); over = Math.max(over, at.y - g); }
}
const end = pts[pts.length - 1], left = Math.hypot(end[0] - player.position.x, end[1] - player.position.z);
console.log(`  the body along the way: ${left < 12 ? 'came to' : 'did NOT come to'} the house (${left.toFixed(0)} m short) in ${(frames / 60).toFixed(0)} s, into the place's square ${crossed < 0 ? 'never' : `after ${(crossed / 60).toFixed(0)} s`}; standing on the ground, at worst ${(sunk * 100).toFixed(0)} cm in it and ${(over * 100).toFixed(0)} cm over it`);
process.exit(left < 12 && worst < 1e-6 && edgeWorst < 1 && causeway < 0.25 ? 0 : 1);
