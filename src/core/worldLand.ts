import { HeightField } from './terrain';
import { TILE, Tile, World, WorldPlace, worldTile, WORLD_SIZE, worldSteps } from './world';

/**
 * A world's land as a place built in it reads it (`docs/06-world.md`, step 3): its tiles of 5 metres
 * where they have been made, each weighed by how far inside its own lattice a point lies (as the
 * squares at a metre weigh them, `tilesAt` in `stream.ts`), and the world's own lattice of 8 metres
 * for the share of any tile not made; so near a place, where its tiles are made, the land is the
 * tiles', and further off it passes to the world's. Beyond the world's edge it is the world seen in
 * a mirror laid along that edge: land that goes on, with no streaks run out from the edge.
 *
 * A place's site records which world it was built in (`terrain.world`), and whoever builds it reads
 * the world's land from here. In a browser the world and its tiles are made in a worker and handed
 * over (`adoptWorldLand`); in a tool, made here when first asked for (`worldLand`).
 */
export interface WorldLand {
  seed: string;
  /** Half the world's breadth and depth, in metres. */
  hx: number; hz: number;
  /** The world's lattice of 8 metres. */
  field: HeightField;
  /** The tiles of 5 metres made so far, by `i,j`: each its lattice about its middle (`ox`, `oz`). */
  tiles: Map<string, { ox: number; oz: number; field: HeightField }>;
  /** The places found in it. */
  places: WorldPlace[];
  /** The world itself, where it was made in this thread (its tiles can then be made here too). */
  world?: World;
}

const LANDS = new Map<string, WorldLand>();
/** How far about a place its tiles of 5 metres are made: further off, the world's lattice of 8 metres is near enough. */
export const WORLD_REACH = 700;
const keyOf = (seed: string) => seed;

/** Takes up the land of a world made elsewhere (a worker), so that places built in it can read it. */
export function adoptWorldLand(land: WorldLand): WorldLand {
  LANDS.set(keyOf(land.seed), land);
  return land;
}

/** Adds a tile made elsewhere to a world's land. */
export function adoptTile(land: WorldLand, t: { i: number; j: number; ox: number; oz: number; x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array }): void {
  const f = new HeightField(t.x0, t.z0, t.cell, t.nx, t.nz);
  f.data.set(t.data);
  land.tiles.set(`${t.i},${t.j}`, { ox: t.ox, oz: t.oz, field: f });
}

/** The land of a world already taken up or made, if it has been. */
export function knownWorldLand(seed: string): WorldLand | undefined {
  return LANDS.get(keyOf(seed));
}

/** A world's land: as taken up, or made here (all at once: for tools, and for anything that can wait half a minute). */
export function worldLand(seed: string): WorldLand {
  const had = LANDS.get(keyOf(seed));
  if (had) return had;
  const steps = worldSteps(seed, WORLD_SIZE);
  let s = steps.next();
  while (!s.done) s = steps.next();
  return landOfWorld(s.value);
}

/** The land of a world made in this thread. */
export function landOfWorld(w: World): WorldLand {
  const had = LANDS.get(keyOf(w.plan.seed));
  if (had && had.world === w) return had;
  const land: WorldLand = { seed: w.plan.seed, hx: w.plan.hx, hz: w.plan.hz, field: w.field, tiles: new Map(), places: w.places, world: w };
  LANDS.set(keyOf(w.plan.seed), land);
  return land;
}

/** The tiles whose lattices reach within `r` metres of a point: what a place there needs made before it is built. */
export function tilesNear(land: { hx: number; hz: number }, x: number, z: number, r: number): [number, number][] {
  const out: [number, number][] = [], reach = TILE.stride / 2 + TILE.over;
  const tx = Math.round((2 * land.hx) / TILE.stride), tz = Math.round((2 * land.hz) / TILE.stride);
  for (let j = 0; j < tz; j++) for (let i = 0; i < tx; i++) {
    const ox = -land.hx + TILE.stride / 2 + i * TILE.stride, oz = -land.hz + TILE.stride / 2 + j * TILE.stride;
    const dx = Math.max(0, Math.abs(x - ox) - reach), dz = Math.max(0, Math.abs(z - oz) - reach);
    if (Math.hypot(dx, dz) < r) out.push([i, j]);
  }
  return out;
}

/** Makes the tiles within `r` of a point, one a step (each takes a second or two): for a world made in this thread. */
export function* makeTilesNear(land: WorldLand, x: number, z: number, r: number): Generator<string, void> {
  const w = land.world;
  if (!w) return;
  for (const [i, j] of tilesNear(land, x, z, r)) {
    if (land.tiles.has(`${i},${j}`)) continue;
    yield `Making the land at five metres (${land.tiles.size + 1})`;
    const t: Tile = worldTile(w, i, j);
    land.tiles.set(`${i},${j}`, { ox: t.ox, oz: t.oz, field: t.field });
  }
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** The world's own lattice at a point, the world mirrored beyond its edge. */
function fieldAt(land: WorldLand, x: number, z: number): number {
  const mirror = (v: number, h: number) => (v > h ? 2 * h - v : v < -h ? -2 * h - v : v);
  return land.field.smoothAt(mirror(x, land.hx - 4), mirror(z, land.hz - 4));
}

/** The height of a world's land at a point of the world (`x` east, `z` south, metres from its middle). */
export function landAt(land: WorldLand, x: number, z: number): number {
  const reach = TILE.stride / 2 + TILE.over, tx = Math.round((2 * land.hx) / TILE.stride), tz = Math.round((2 * land.hz) / TILE.stride);
  const ci = Math.floor((x + land.hx) / TILE.stride), cj = Math.floor((z + land.hz) / TILE.stride);
  let sum = 0, weight = 0, coarse = 0, wanted = false;
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    if (i < 0 || j < 0 || i >= tx || j >= tz) continue;
    const ox = -land.hx + TILE.stride / 2 + i * TILE.stride, oz = -land.hz + TILE.stride / 2 + j * TILE.stride;
    const inside = Math.min(reach - Math.abs(x - ox), reach - Math.abs(z - oz));
    if (inside <= 0) continue;
    const w = smooth(inside / (2 * TILE.over)) + 1e-6, t = land.tiles.get(`${i},${j}`);
    if (t) sum += w * t.field.smoothAt(x - ox, z - oz);
    else { coarse += w; wanted = true; }
    weight += w;
  }
  if (weight <= 0) return fieldAt(land, x, z);
  if (wanted) sum += coarse * fieldAt(land, x, z);
  return sum / weight;
}
