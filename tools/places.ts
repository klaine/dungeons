/**
 * Builds a place into a world as the walk and route pages do (`src/render/placePack.ts`, `src/worldwalk/places.ts`), without a
 * browser, and checks the join: the world's squares at a metre made about it with its hole (`withHole`) still meet one another exactly;
 * along the edge of the place's square they stand at the place's own land; how steep the band that brings them there is; and the
 * game's body (`Player`) walked along the way from the town into the valley to the house's door, on the ground about it and the place's
 * own solid part, crossing the seam: whether it gets there, and how far it ever stood under or over what it walks on.
 *
 *   npx tsx tools/places.ts [world seed] [kind: valley, coast, island, mountain] [number]
 *
 * With no kind, the valley head at the end of the shortest town's way, which the body is walked to; for another place, the join alone.
 * And whether the sky can be seen through the join, from under the ground and from the side, with the squares meshed as the walk
 * page meshes them.
 */
(globalThis as Record<string, unknown>).document = { addEventListener() {}, body: { classList: { toggle() {} } } };
(globalThis as Record<string, unknown>).window = { addEventListener() {} };
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Player } from '../src/app/player';
import { generateWorldPlace } from '../src/core/generate';
import { gradeLine, legTo, networkLines, townValleyRoutes } from '../src/core/route';
import { PATH_HALF } from '../src/core/way';
import { siteFrame, toWorld } from '../src/core/worldLand';
import { holeAt, makeSquare, Square, SQUARE, squareCount, TileData, TileGrid, tilesAt, tilesFor, wayThroughHoles } from '../src/core/stream';
import { TILE, world, worldTile } from '../src/core/world';
import { packPlace } from '../src/render/placePack';
import { squareBuilders } from '../src/render/streamMesh';
import { WorldColliders } from '../src/worldwalk/body';

const seed = process.argv[2] ?? 'w0', kindAsked = process.argv[3] as 'valley' | 'coast' | 'island' | 'mountain' | undefined, nAsked = Number(process.argv[4] ?? 1);
const w = world(seed), p = w.plan, grid: TileGrid = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz }, f = w.field;
const route = kindAsked ? null : townValleyRoutes(w)[0];
if (!kindAsked && !route) { console.log(`${seed}: no way from a town to a valley head`); process.exit(1); }
const q = w.places.find((o) => (route ? o.kind === route.to.kind && o.n === route.to.n : o.kind === kindAsked && o.n === nAsked));
if (!q) { console.log(`${seed}: no ${kindAsked} ${nAsked}`); process.exit(1); }
let t = Date.now();
const { site } = generateWorldPlace(seed, q.kind === 'coast' ? 'town' : q.kind, q.n);
// The way from the town to where the valley's own road begins (the last point of its track, where the player arrives), laid as a
// track is and graded, as the walk page lays a castle's valley's leg; and on from there up the valley's road to the house's door.
// (A mountain top: from the world's ways up its leg, a footpath, to where its own way down the ridge ends, and on up that to its door.)
const top = q.kind === 'mountain', sf = siteFrame(site), tr = top ? site.mountain?.way?.map(([x, z]) => [x, z] as [number, number]) : site.track;
const arrival = sf && tr?.length ? toWorld(sf, tr[tr.length - 1][0], tr[tr.length - 1][1]) : null;
const line = route && arrival ? legTo(w, [{ kind: 'track', line: [arrival] }], route.from)
  : top && arrival ? legTo(w, networkLines(w), { x: arrival[0], z: arrival[1] })?.slice().reverse() ?? null : null;
const way = line ? gradeLine(w, line, top ? PATH_HALF : undefined) : null;
const doorward: [number, number][] = sf && tr ? tr.slice().reverse().map(([x, z]) => toWorld(sf, x, z)) : [];
// (With the world's own land, as the page's worker gives it, for how far the place's stands off it at its edge.)
const gridT = { stride: TILE.stride, over: TILE.over, hx: p.hx, hz: p.hz };
const allTiles: { t: TileData; f: ReturnType<typeof worldTile>['field'] }[] = [];
for (let i = 0; i < Math.round((2 * p.hx) / TILE.stride); i++) for (let j = 0; j < Math.round((2 * p.hz) / TILE.stride); j++) { const w5 = worldTile(w, i, j); allTiles.push({ t: { ox: w5.ox, oz: w5.oz } as TileData, f: w5.field }); }
const pack = packPlace(site, { kind: q.kind, n: q.n, name: q.name }, (x, z) => tilesAt(allTiles, gridT, x, z), { clear: line ?? undefined, path: top });
const h = pack.hole;
const gaps = h.grid ? h.grid.gap : h.gap;
console.log(`${seed}: ${q.name} laid out and built in ${((Date.now() - t) / 1000).toFixed(0)} s (meshed ${(pack.ms.mesh / 1000).toFixed(0)}), ${(pack.triangles / 1e6).toFixed(2)} million triangles; its square ${(2 * h.hx).toFixed(0)} by ${(2 * h.hz).toFixed(0)} m; ${pack.misses} of ${h.profile.length} heights round its edge found no land${h.grid ? `, so its hole follows its land, a lattice ${h.grid.nx} by ${h.grid.nz} at ${h.grid.cell} m` : ''}; the place's land stands off the world's at its edge by ${(gaps ? gaps.reduce((a, v) => Math.max(a, Math.abs(v)), 0) : 0).toFixed(1)} m at most`);
{
  const l = pack.life;
  console.log(`  what lives and burns in it: ${l.smokes.length} smokes, ${l.birds.length} places of ${l.birdKind ?? 'gull'}s, ${l.flocks.reduce((n, f) => n + f.count, 0)} ${l.flockKind ?? 'sheep'} in ${l.flocks.length} flocks, ${l.torches.length} torches and fires, ${l.lamps.length} street lamps, ${l.fireflies.length / 3} fireflies' homes${l.beacon ? ', a lighthouse' : ''}`);
}
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
const graded = way ? wayThroughHoles(way, [h]) : null;
const times: number[] = [];
const squareAt = (x: number, z: number): Square | null => {
  const i = Math.floor((x + grid.hx) / SQUARE.size), j = Math.floor((z + grid.hz) / SQUARE.size), key = `${i},${j}`;
  if (i < 0 || j < 0 || i >= SX || j >= SZ) return null;
  let s = squares.get(key);
  if (!s) { s = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n, grounds, graded ? [graded] : [], [h]); squares.set(key, s); times.push(s.ms); }
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
  if (!sq) { sq = makeSquare(grid, tilesFor(grid, i, j).map(([a, b]) => tile(a, b)), i, j, p.n, grounds, way ? [way] : []); plain.set(key, sq); }
  const n = SQUARE.n, fx = Math.min(n - 1.001, Math.max(0, x - sq.x0)), fz = Math.min(n - 1.001, Math.max(0, z - sq.z0)), a = Math.floor(fx), b = Math.floor(fz);
  return sq.heights[b * n + a];
};
const reach = Math.hypot(h.hx, h.hz) + 260;
for (let z = h.cz - reach; z <= h.cz + reach; z += 128) for (let x = h.cx - reach; x <= h.cx + reach; x += 128) squareAt(x, z);
for (const [x, z] of way?.points ?? []) squareAt(x, z);
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
// Along the square's edge, the world's land against the place's: the place's own land found by looking down on its turf and rock sheet
// (and its scree and carved rock, where its hole follows its land).
const landMeshes = pack.meshes.filter((m) => m.key === 'wild|turf' || m.key === 'wild|rockSheet' || (h.grid && (m.key === 'wild|scree' || m.key === 'wild|rock')));
const lg = new BufferGeometry(), lp: number[] = [], li: number[] = [];
for (const m of landMeshes) { const o = lp.length / 3; for (const v of m.position) lp.push(v); for (const v of m.index) li.push(v + o); }
lg.setAttribute('position', new BufferAttribute(new Float32Array(lp), 3)); lg.setIndex(li);
const landBvh = new MeshBVH(lg), ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
const placeLand = (x: number, z: number) => { ray.origin.set(x, 5000, z); return landBvh.raycastFirst(ray, 2)?.point.y ?? NaN; };
const c = Math.cos(h.turn), s = Math.sin(h.turn);
// (Points of the edge, and which way is straight out from each: round the square; or, where the hole follows the land, where its
// lattice goes from inside to outside, out being the way its distance from the edge grows.)
const edgePoints: [number, number, number, number][] = [];
if (h.grid) {
  const g = h.grid, all: [number, number, number, number][] = [];
  for (let j = 1; j < g.nz - 1; j++) for (let i = 1; i < g.nx - 1; i++) {
    const k = j * g.nx + i;
    if (g.out[k] <= 0 || !(g.out[k - 1] <= 0 || g.out[k + 1] <= 0 || g.out[k - g.nx] <= 0 || g.out[k + g.nx] <= 0)) continue;
    const dx = g.out[k + 1] - g.out[k - 1], dz = g.out[k + g.nx] - g.out[k - g.nx], l = Math.hypot(dx, dz) || 1;
    all.push([g.x0 + i * g.cell - (dx / l) * g.out[k], g.z0 + j * g.cell - (dz / l) * g.out[k], dx / l, dz / l]);
  }
  for (let k = 0; k < 400; k++) edgePoints.push(all[Math.floor((k / 400) * all.length)]);
} else for (let k = 0; k < 400; k++) {
  const r = (k / 400) * 4 * (h.hx + h.hz), W = 2 * h.hx, D = 2 * h.hz;
  const [lx, lz] = r < W ? [-h.hx + r, -h.hz] : r < W + D ? [h.hx, -h.hz + (r - W)] : r < 2 * W + D ? [h.hx - (r - W - D), h.hz] : [-h.hx, h.hz - (r - 2 * W - D)];
  edgePoints.push([h.cx + c * lx - s * lz, h.cz + s * lx + c * lz, lx === h.hx ? c : lx === -h.hx ? -c : -s * Math.sign(lz), lx === h.hx ? s : lx === -h.hx ? -s : c * Math.sign(lz)]);
}
let worstAt = '', edgeOff = 0, edgeWorst = 0, edgeSum = 0, edgeN = 0, steepest = 0, ownSteepest = 0, steeper = 0, samples = 0;
for (const [x, z, ox, oz] of edgePoints) {
  const pl = placeLand(x, z), wl = heightAt(x, z);
  // (How far the world's land there lies from the place's, the nearest point of it within a metre and a half, not straight up: on a
  // mountainside four times as steep as it is broad, or at the foot of a carved cliff, the two a third of a metre apart sideways stand
  // more than a metre apart in height, and nothing shows.)
  let apart = Infinity;
  for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const h = placeLand(x + a * 0.75, z + b * 0.75); if (Number.isFinite(h)) apart = Math.min(apart, Math.hypot(a * 0.75, b * 0.75, h - wl)); }
  if (Number.isFinite(pl) && Number.isFinite(apart)) {
    if (apart > edgeWorst) worstAt = `${x.toFixed(1)}, ${z.toFixed(1)}: the place's ${pl.toFixed(2)}, the world's ${wl.toFixed(2)}`;
    edgeWorst = Math.max(edgeWorst, apart); edgeSum += apart; edgeN++;
    if (apart > 1) edgeOff++;
  }
  // (The band outside: the steepest slope over any two metres going straight out, against the land's own there.)
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
(way?.points ?? []).forEach(([x, z], k) => {
  const o = holeAt(h, x, z).out;
  if (o < 26 || o > 160) return;
  const pts0 = way!.points, [nx, nz] = pts0[Math.min(pts0.length - 1, k + 1)], l = Math.hypot(nx - x, nz - z) || 1, ax = -(nz - z) / l, az = (nx - x) / l;
  causeway = Math.max(causeway, Math.abs(heightAt(x + ax * 2, z + az * 2) - heightAt(x - ax * 2, z - az * 2)));
  bedPoints++;
});
console.log(`  along the way in the band (${bedPoints} points), its bed tilts across by ${(causeway * 100).toFixed(0)} cm at most over four metres`);
console.log(`  at the square's edge the world's land stands (from the nearest of the place's) within ${(edgeSum / Math.max(1, edgeN) * 100).toFixed(0)} cm of the place's on the whole, ${edgeWorst.toFixed(2)} m at worst; steepest slope in the band outside ${(100 * steepest).toFixed(0)}%, against ${(100 * ownSteepest).toFixed(0)}% for the land without the place; made much steeper than one in two over ${(100 * steeper / samples).toFixed(1)}% of it`);
if (edgeWorst > 0.5) console.log(`  (the worst at ${worstAt}; ${edgeOff} of ${edgeN} points of the edge more than a metre apart)`);
let walked = true;
if (way) {
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
  const pts: [number, number][] = [...way.points.map(([x, z]) => [x, z] as [number, number]), ...doorward.slice(1)];
  const [sx, sz] = pts[2];
  player.place(new Vector3(sx, heightAt(sx, sz) + 1.68, sz), 0);
  let k = 0, frames = 0, crossed = -1, sunk = 0, over = 0;
  t = Date.now();
  // (On to the last point itself, the house's door, not only until it is the one headed for.)
  while ((k < pts.length - 1 || Math.hypot(pts[k][0] - player.position.x, pts[k][1] - player.position.z) > 2) && frames < 60 * 600) {
    // (Along the valley's own road closely, within a couple of metres of each point: cutting its corners, as along the way, the body
    // went into the side of the castle's gate tower instead of through its arch.)
    while (k < pts.length - 1 && Math.hypot(pts[k][0] - player.position.x, pts[k][1] - player.position.z) < (k >= way.points.length ? 2.5 : 6)) k++;
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
  // (Where it stopped, to go and look: `__walk.goto(x, z)` on the walk page.)
  if (left >= 12) console.log(`  (it stopped at ${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}, ${player.position.y.toFixed(1)} high, ${inside(player.position.x, player.position.z) ? 'inside' : 'outside'} the place, heading for the way's point ${k} of ${pts.length}, ${pts[k][0].toFixed(1)}, ${pts[k][1].toFixed(1)})`);
  walked = left < 12;
}
// Whether the sky can be seen through the join: the squares across the place's edge meshed as the walk page meshes them, at the
// distances it meshes them to from some thirty metres off to five hundred, with what lies under the place left out as it leaves it out;
// then rays sent up and out from a metre under the ground all across the edge, every two metres. On a closed surface none gets out.
const solidGeo = new BufferGeometry();
solidGeo.setAttribute('position', new BufferAttribute(pack.solid.position, 3)); solidGeo.setIndex(new BufferAttribute(pack.solid.index, 1));
const solidBvh = MeshBVH.deserialize(pack.solid.bvh, solidGeo, { setIndex: true });
const look = { turf: () => [0.5, 0.5, 0.5, 0, 0, 0, 0], rock: (): [number, number, number] => [0.5, 0.5, 0.5] };
const across: [number, number][] = [];
{
  const bx = h.grid ? [h.grid.x0, h.grid.x0 + h.grid.nx * h.grid.cell, h.grid.z0, h.grid.z0 + h.grid.nz * h.grid.cell] : [h.cx - h.hx - 50, h.cx + h.hx + 50, h.cz - h.hz - 50, h.cz + h.hz + 50];
  for (let z = bx[2]; z <= bx[3]; z += 2) for (let x = bx[0]; x <= bx[1]; x += 2) { const o = holeAt(h, x, z).out; if (o > -2.5 && o < 4) across.push([x, z]); }
}
// (Every way upward: a ray from under the ground that meets nothing at all has got out through a gap. One that meets the ground from
// below, however far off, has crossed it; the squares meshed reach three hundred metres past the place's square, beyond any ray's
// rise under the land.)
const waysUp = [new Vector3(0, 1, 0), ...[0.35, 0.9, 1.35].flatMap((e) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new Vector3(Math.cos(e) * Math.cos(k * 0.785), Math.sin(e), Math.cos(e) * Math.sin(k * 0.785))))];
const leaksAt = (skip: (x: number, z: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => boolean, err: number) => {
  const pos: number[] = [], idx: number[] = [];
  for (const sq of squares.values()) {
    if (sq.x0 > h.cx + h.hx + 300 || sq.x0 + SQUARE.size < h.cx - h.hx - 300 || sq.z0 > h.cz + h.hz + 300 || sq.z0 + SQUARE.size < h.cz - h.hz - 300) continue;
    // (Meshed whole, and each triangle judged here by its middle and its corners: `squareBuilders` asks only of the middle.)
    const m = squareBuilders(sq.x0, sq.z0, sq.heights, sq.errors, err, look, 0.72, 1);
    for (const b of [m.turf, m.rock]) {
      const g = b.build(), P = g.getAttribute('position').array as Float32Array, I = g.getIndex()!.array;
      for (let t3 = 0; t3 < I.length; t3 += 3) {
        const a = I[t3], b2 = I[t3 + 1], c3 = I[t3 + 2];
        if (skip((P[a * 3] + P[b2 * 3] + P[c3 * 3]) / 3, (P[a * 3 + 2] + P[b2 * 3 + 2] + P[c3 * 3 + 2]) / 3, P[a * 3], P[a * 3 + 2], P[b2 * 3], P[b2 * 3 + 2], P[c3 * 3], P[c3 * 3 + 2])) continue;
        const o = pos.length / 3;
        for (const v of [a, b2, c3]) pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        idx.push(o, o + 1, o + 2);
      }
    }
  }
  const wg = new BufferGeometry();
  wg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); wg.setIndex(idx);
  const wb = new MeshBVH(wg), r = new Ray(new Vector3(), new Vector3());
  // Seen from the side, as the eye sees the edge from below its rim: from 170 metres out, level, at points of the edge a metre, three
  // and six under the place's land there; a ray that comes to such a point and goes on thirty metres more meeting nothing has passed
  // through a gap. (Looked at from the walk page, the sky showed in notches under a mountain top's rim.)
  let side = 0, sideAt = '';
  const T = new Vector3(), C = new Vector3();
  for (const [x, z, ox, oz] of edgePoints) {
    const top = placeLand(x - ox * 0.5, z - oz * 0.5);
    if (!Number.isFinite(top)) continue;
    for (const d of [1, 3, 6]) {
      // (The eye kept over the ground there: where the land outside rises above the edge it stood inside a hill, and a ray from
      // under the ground to under the ground met nothing and was taken for a gap.)
      T.set(x - ox * 0.5, top - d, z - oz * 0.5); C.set(T.x + ox * 170, 0, T.z + oz * 170); C.y = Math.max(T.y + 10, heightAt(C.x, C.z) + 3);
      r.origin.copy(C); r.direction.copy(T).sub(C).normalize();
      const far = C.distanceTo(T) + 30, hw = wb.raycastFirst(r, 2), hp = solidBvh.raycastFirst(r, 2);
      if ((!hw || hw.distance > far) && (!hp || hp.distance > far)) {
        side++; if (!sideAt) sideAt = `${x.toFixed(0)}, ${z.toFixed(0)}, ${d} m under`;
        break;
      }
    }
  }
  // (Rays given before the command, `RAYS="x,y,z;dx,dy,dz;..."`, as taken in the browser from the eye through points of the picture:
  // each told where it meets the world's land and the place's, and which of the place's meshes. What looked like the sky through a
  // gap under a mountain top's rim was found so to be the pale stone of its arrival, seen through notches in the world's land.)
  if (process.env.RAYS && err === 0.4) {
    const [o, ...ds] = process.env.RAYS.split(';').map((v) => v.split(',').map(Number));
    const allGeo = new BufferGeometry(), ap: number[] = [], ai: number[] = [], ends: [number, string][] = [];
    for (const m of pack.meshes) { const b0 = ap.length / 3; for (const v of m.position) ap.push(v); for (const v of m.index) ai.push(v + b0); ends.push([ai.length / 3, `${m.key} (${m.material})`]); }
    allGeo.setAttribute('position', new BufferAttribute(new Float32Array(ap), 3)); allGeo.setIndex(ai);
    const allBvh = new MeshBVH(allGeo);
    for (const d of ds) {
      r.origin.set(o[0], o[1], o[2]); r.direction.set(d[0], d[1], d[2]).normalize();
      const hw = wb.raycastFirst(r, 2), hp = solidBvh.raycastFirst(r, 2), ha = allBvh.raycastFirst(r, 2);
      const at = (t: number) => { const q = r.origin.clone().addScaledVector(r.direction, t); return `${t.toFixed(1)} m at ${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)} (out ${holeAt(h, q.x, q.z).out.toFixed(1)})`; };
      console.log(`    ray ${d.join(',')}: world ${hw ? at(hw.distance) : 'none'}; place's solid ${hp ? at(hp.distance) : 'none'}; place drawn ${ha ? at(ha.distance) + ' ' + ends.find(([e]) => (ha.faceIndex ?? 0) < e)![1] + ` facing ${ha.face?.normal.toArray().map((v) => v.toFixed(2))}` : 'none'}`);
    }
  }
  let leaks = 0, worstLeak = '';
  for (const [x, z] of across) {
    r.origin.set(x, heightAt(x, z) - 1, z);
    for (const d of waysUp) {
      r.direction.copy(d);
      const hw = wb.raycastFirst(r, 2), hp = solidBvh.raycastFirst(r, 2);
      if (!hw && !hp) {
        leaks++; if (!worstLeak) worstLeak = `${x.toFixed(0)}, ${z.toFixed(0)}`;
        break;
      }
    }
  }
  return { leaks, worstLeak, side, sideAt };
};
const seen: string[] = [];
// (`INBY=2.5,6` before the command tries leaving out what lies further in under the place than the page does, 2.5 metres.)
for (const inBy of (process.env.INBY ?? '2.5').split(',').map(Number)) for (const err of [0.05, 0.4]) {
  const a = leaksAt((cx, cz) => holeAt(h, cx, cz).out < -inBy, err);
  seen.push(`left out ${inBy} m in, meshed to ${err} m: from under the ground ${a.leaks}${a.worstLeak ? ` (${a.worstLeak})` : ''}, from the side ${a.side} of ${edgePoints.length}${a.sideAt ? ` (${a.sideAt})` : ''}`);
}
console.log(`  the sky seen through the join:\n    ${seen.join('\n    ')}`);
// (Where the hole follows a place's land, its edge runs along the feet of carved crags here and there, which a lattice of a metre does
// not follow exactly: there a point or two in a hundred may lie further apart, so long as none is far.)
const edgeHeld = h.grid ? edgeOff <= 0.02 * edgeN && edgeWorst < 4 : edgeWorst < 1;
process.exit(walked && worst < 1e-6 && edgeHeld && causeway < 0.25 ? 0 : 1);
