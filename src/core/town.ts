import { fbm2, Rng } from './rng';
import { Building, Place, Site, Town } from './site';
import { coastHeight, coastland, findTowns, townFrame, TownNeed, TownSpot } from './coastland';
import { HeightField, landDetail, leastPath, smoothLine, wornLattice } from './terrain';
import { classicalArch, classicalVariations, footprintOf, freeAtEnds, planClassical, planTimber } from './building';

/**
 * A harbour town, laid out on a coast that was found (`coastland.ts`). The land comes first: a
 * stretch of country between the sea and the mountains, made and worn; in it, a bay with low
 * ground behind its shore. Only then is the town laid on it, and the land made over where the
 * town needs it: the square and the waterfront levelled, the streets graded, the ground under
 * each building made level, the harbour dug out and its quay and moles built, and everything
 * else left as the weather left it. Where the land was steep at the sea, the sea has cut it back
 * to cliffs.
 *
 * Everything is in the site's measures: x east, z south, the sea to the south. The house stands
 * at the head of the square on its own level ground (the forecourt is a terrace over the square),
 * and the square opens at its foot onto the waterfront and the quay. Streets run square to the
 * square, along the shore and up from it, and the blocks between them are built up: with
 * classical buildings nearest the square and the harbour, timber houses beyond, and on the edges
 * of the town, along the shore and up the slopes, shacks. Outside, fields; then woods; then hills.
 */

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const round = (v: number) => Math.round(v * 10) / 10;
type Rect = { x0: number; x1: number; z0: number; z1: number };
/** How far a point is outside a rectangle, or nothing inside it. */
export const outsideRect = (r: Rect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/** The nearest point of a line of points `[x, z, y]` to a point: how far off it, and the line's height there. */
export function nearLine(line: [number, number, number][], x: number, z: number): { off: number; y: number } {
  let off = Infinity, y = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az, ay] = line[k], [bx, bz, by] = line[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < off) { off = d; y = ay + (by - ay) * t; }
  }
  return { off, y };
}

/** A point of a building in its own measures: `u` across its front from its middle (to the right as one faces it), `v` back from its front. */
export function inBuilding(b: Building, x: number, z: number): { u: number; v: number } {
  const t = b.turn ?? (b.faces === 'w' ? Math.PI : 0), fx = Math.cos(t), fz = Math.sin(t), dx = x - b.x, dz = z - b.z;
  // (Its front faces (fx, fz); the right hand of one who stands before it, facing it, is (fz, -fx).)
  return { u: dx * fz - dz * fx, v: b.d / 2 - (dx * fx + dz * fz) };
}

/** How far a point is outside a building's walls, wings and all, or nothing within them. */
export function outsideBuilt(b: Building, x: number, z: number): number {
  const { u, v } = inBuilding(b, x, z);
  let best = Infinity;
  for (const r of footprintOf(b)) best = Math.min(best, Math.hypot(Math.max(r.u0 - u, 0, u - r.u1), Math.max(r.v0 - v, 0, v - r.v1)));
  return best;
}

/** Where a point of a building's own measures is in the site. */
export function fromBuilding(b: Building, u: number, v: number): [number, number] {
  const t = b.turn ?? (b.faces === 'w' ? Math.PI : 0), fx = Math.cos(t), fz = Math.sin(t), out = b.d / 2 - v;
  return [b.x + fx * out + fz * u, b.z + fz * out - fx * u];
}

// ---- the land

/** The height of the frame's land at a point of the site, before anything is done to it here. */
export function frameAt(t: Town, floor: number, x: number, z: number, out = 0): number {
  const r = t.terrain, [u, v] = townFrame(r, (t.quay.x0 + t.quay.x1) / 2, t.quay.z, x, z);
  return coastHeight(coastland(r.seed), u, v, out) - r.base + floor;
}

/** How the town's own land is made fine and worn again. */
export const TOWN_WEAR = {
  detail: 1.7, spare: 0.45,
  wear: {
    cut: 6, fill: 3,
    water: { drops: 1.1, life: 60, inertia: 0.1, capacity: 0.6, erode: 0.12, deposit: 0.2, evaporate: 0.015, gravity: 4, radius: 2, most: 0.5 },
    frost: { passes: 2, repose: 1.4, rate: 0.35 },
  },
};

const NATURAL = new WeakMap<Town, { sig: number[]; field: HeightField }>();
/**
 * The town's land as the weather left it: the frame's land made fine and worn again, and then cut back by the sea. The sea eats into
 * the land along the coast by a few metres to twenty or more, more in some stretches than others; where the land rose steeply from
 * the water that leaves a cliff, where it was low a strip of shore is lost and nothing else. Not along the harbour's stretch, where
 * the town has kept the shore.
 */
export function naturalLand(t: Town, floor: number): HeightField {
  const r = t.terrain, had = NATURAL.get(t), sig = [floor, r.seed, r.u, r.v, r.turn, r.base, r.cell, t.land.x0, t.land.z0, t.quay.x0, t.quay.x1];
  if (had && had.sig.every((v, k) => v === sig[k])) return had.field;
  const cell = r.cell, L = t.land, nx = Math.round((L.x1 - L.x0) / cell) + 1, nz = Math.round((L.z1 - L.z0) / cell) + 1, W = TOWN_WEAR;
  const keep = (x: number, z: number) => (frameAt(t, floor, x, z) < t.sea - 1 ? 1 : W.spare);
  const shape = (x: number, z: number) => { const y = frameAt(t, floor, x, z); return y + W.detail * landDetail(x, z, 110, r.seed) * smooth((y - t.sea + 1) / 3); };
  const f = wornLattice(L.x0, L.z0, cell, nx, nz, shape, new Rng(`town-land/${r.seed}/${r.u}/${r.v}`), W.wear, keep, 8);
  // The sea's cut: how far each point lies from open water, by two sweeps of the lattice.
  const D = new Float32Array(nx * nz), d1 = cell, d2 = cell * Math.SQRT2;
  for (let k = 0; k < nx * nz; k++) D[k] = f.data[k] < t.sea - 0.2 ? 0 : 1e6;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!D[k]) continue; let m = D[k]; if (i > 0) m = Math.min(m, D[k - 1] + d1); if (j > 0) { m = Math.min(m, D[k - nx] + d1); if (i > 0) m = Math.min(m, D[k - nx - 1] + d2); if (i < nx - 1) m = Math.min(m, D[k - nx + 1] + d2); } D[k] = m; }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!D[k]) continue; let m = D[k]; if (i < nx - 1) m = Math.min(m, D[k + 1] + d1); if (j < nz - 1) { m = Math.min(m, D[k + nx] + d1); if (i < nx - 1) m = Math.min(m, D[k + nx + 1] + d2); if (i > 0) m = Math.min(m, D[k + nx - 1] + d2); } D[k] = m; }
  const qx = (t.quay.x0 + t.quay.x1) / 2, half = (t.quay.x1 - t.quay.x0) / 2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = L.x0 + i * cell, z = L.z0 + j * cell;
    if (D[k] > 40) continue;
    // (How far the sea has eaten in here: by stretches some tens of metres long; nothing along the harbour, and nothing near the
    // lattice's edge, where the land meets the frame's.)
    const edge = Math.min(x - L.x0, L.x1 - x, z - L.z0, L.z1 - z);
    const eat = (5 + 24 * smooth((fbm2(x / 70 + 3.3, z / 70, 3, r.seed % 997) - 0.35) / 0.3)) * smooth((Math.abs(x - qx) - half - 50) / 70) * smooth((edge - 20) / 40);
    if (D[k] < eat) f.data[k] = Math.min(f.data[k], t.sea - 0.9 - (eat - D[k]) * 0.3 + (fbm2(x / 4, z / 4, 2, 5) - 0.5) * 0.8);
  }
  NATURAL.set(t, { sig, field: f });
  return f;
}

const MADE = new WeakMap<Town, { sig: number[]; field: HeightField }>();
/** The town's land with what has been made on it: the land as found, graded, levelled and dug where the town needed it (`makeLand`). */
export function townLand(t: Town, floor: number): HeightField {
  const had = MADE.get(t), sig = [floor, t.terrain.seed, t.terrain.u, t.buildings.length, t.streets.length, t.shacks.length, t.storehouses.length, t.level.x0, t.level.z0];
  if (had && had.sig.every((v, k) => v === sig[k])) return had.field;
  const field = makeLand(t, floor, t.level);
  MADE.set(t, { sig, field });
  return field;
}

/** The height of the ground at a point of the site: the town's land where it was made, the frame's beyond. */
export function townGround(t: Town, floor: number, x: number, z: number): number {
  const f = townLand(t, floor);
  if (f.holds(x, z)) return f.smoothAt(x, z);
  return frameAt(t, floor, x, z);
}

/** The ground of the square at a point: falling from its north side to its south. */
export const squareY = (t: Town, z: number) => { const s = t.square; return s.yN + (s.yS - s.yN) * Math.min(1, Math.max(0, (z - s.z0) / (s.z1 - s.z0))); };
/** The waterfront's ground: from the quay's top at its edge, rising to the square's foot (or the street's) at its back. */
const apronY = (t: Town, back: number, z: number) => t.quay.y + (back - t.quay.y) * smooth((t.quay.z - z) / t.quay.apron);

/** Whether a point is in the harbour's water, inside the moles and before the quay. */
export function inHarbour(t: Town, x: number, z: number): boolean {
  if (z < t.quay.z || x < t.quay.x0 - 2 || x > t.quay.x1 + 2) return false;
  // (Between the two moles' lines, which run out from the quay's ends and turn in towards each other.)
  const [w, e] = t.moles;
  const reach = (m: Town['moles'][number]) => m.line[m.line.length - 1][1];
  return z < Math.max(reach(w), reach(e)) + 1 && x > lineX(w.line, z) && x < lineX(e.line, z);
}
/** Where a mole's line crosses a given z (its x there, or its nearest end's). */
function lineX(line: [number, number][], z: number): number {
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    if ((z - az) * (z - bz) <= 0 && Math.abs(bz - az) > 0.5) return ax + ((bx - ax) * (z - az)) / (bz - az);
  }
  return line[0][0];
}

/**
 * The land made: the land as found (`naturalLand`), and over it what the town did. Inside the town the ground is graded: the land
 * smoothed over a few tens of metres, so that streets climb evenly, and never lower than a little over the quay. The square is
 * laid level across and falling gently to the sea; the waterfront falls from it to the quay's top; the house's ground is level at
 * the forecourt's floor; each building stands on ground made level under it; the streets are at their own levels; the harbour is
 * dug out before the quay; tracks and paths are cut and made up to their lines.
 */
function makeLand(t: Town, floor: number, house: Rect): HeightField {
  const N = naturalLand(t, floor), cell = N.cell, nx = N.nx, nz = N.nz;
  const M = new HeightField(N.x0, N.z0, cell, nx, nz);
  M.data.set(N.data);
  // The grade: the land smoothed by a box some twenty-five metres across, twice.
  const G = N.data.slice(), tmp = new Float32Array(G.length), R = Math.round(12 / cell);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) { let s = 0; for (let i = -R; i <= R; i++) s += G[j * nx + Math.min(nx - 1, Math.max(0, i))]; for (let i = 0; i < nx; i++) { tmp[j * nx + i] = s / (2 * R + 1); s += G[j * nx + Math.min(nx - 1, i + R + 1)] - G[j * nx + Math.max(0, i - R)]; } }
    for (let i = 0; i < nx; i++) { let s = 0; for (let j = -R; j <= R; j++) s += tmp[Math.min(nz - 1, Math.max(0, j)) * nx + i]; for (let j = 0; j < nz; j++) { G[j * nx + i] = s / (2 * R + 1); s += tmp[Math.min(nz - 1, j + R + 1) * nx + i] - tmp[Math.max(0, j - R) * nx + i]; } }
  }
  const low = t.quay.y + 0.25;
  // What the town covers, and how near: its blocks, its streets, its square and waterfront, with a margin eased into the land.
  const sq = t.square, ap = { x0: t.quay.x0, x1: t.quay.x1, z0: t.quay.z - t.quay.apron, z1: t.quay.z };
  // (How near the town each point is, laid item by item over the points about each, so that each point is not asked of every street.)
  const W = new Float32Array(nx * nz);
  const over = (r: Rect, pad: number, d: (x: number, z: number) => number) => {
    const i0 = Math.max(0, Math.floor((r.x0 - pad - N.x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((r.x1 + pad - N.x0) / cell));
    const j0 = Math.max(0, Math.floor((r.z0 - pad - N.z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((r.z1 + pad - N.z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (W[k] < 1) W[k] = Math.max(W[k], 1 - smooth((d(N.x0 + i * cell, N.z0 + j * cell) - 2) / 12)); }
  };
  for (const r of [...t.blocks, sq, ap]) over(r, 16, (x, z) => outsideRect(r, x, z));
  for (const s of t.streets) if (s.kind === 'street' || s.kind === 'lane') for (let k = 0; k + 1 < s.line.length; k++) {
    const seg = [s.line[k], s.line[k + 1]], half = s.width / 2;
    over({ x0: Math.min(seg[0][0], seg[1][0]), x1: Math.max(seg[0][0], seg[1][0]), z0: Math.min(seg[0][1], seg[1][1]), z1: Math.max(seg[0][1], seg[1][1]) }, half + 16, (x, z) => nearLine(seg, x, z).off - half);
  }
  for (let k = 0; k < nx * nz; k++) if (W[k] > 0) M.data[k] = N.data[k] + (Math.max(low, G[k]) - N.data[k]) * W[k];
  // (Read from here on through a function of the point, so that each thing made below is laid over what is made before it.)
  const ease = (k: number, to: number, w: number) => { M.data[k] += (to - M.data[k]) * Math.min(1, Math.max(0, w)); };
  const each = (r: Rect, pad: number, fn: (k: number, x: number, z: number) => void) => {
    const i0 = Math.max(0, Math.floor((r.x0 - pad - N.x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((r.x1 + pad - N.x0) / cell));
    const j0 = Math.max(0, Math.floor((r.z0 - pad - N.z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((r.z1 + pad - N.z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i, N.x0 + i * cell, N.z0 + j * cell);
  };
  const boxOf = (line: [number, number, number][] | [number, number][]): Rect => ({ x0: Math.min(...line.map((p) => p[0])), x1: Math.max(...line.map((p) => p[0])), z0: Math.min(...line.map((p) => p[1])), z1: Math.max(...line.map((p) => p[1])) });
  // Tracks and paths, cut and made up to their own line across their breadth, and eased into the land beside.
  for (const s of t.streets) if (s.kind === 'track' || s.kind === 'path') each(boxOf(s.line), s.width + 6, (k, x, z) => { const n = nearLine(s.line, x, z); ease(k, n.y, 1 - smooth((n.off - s.width / 2 - 0.4) / 4.5)); });
  // Streets and lanes, at their own levels.
  for (const s of t.streets) if (s.kind === 'street' || s.kind === 'lane') each(boxOf(s.line), s.width + 4, (k, x, z) => { const n = nearLine(s.line, x, z); ease(k, n.y, 1 - smooth((n.off - s.width / 2 - 0.3) / 3)); });
  // The waterfront and the square.
  each(ap, 4, (k, x, z) => { const d = outsideRect(ap, x, z); const back = x > sq.x0 && x < sq.x1 ? sq.yS : Math.max(low, G[k]); ease(k, apronY(t, back, Math.max(ap.z0, Math.min(ap.z1, z))), 1 - smooth(d / 3)); });
  each(sq, 4, (k, x, z) => ease(k, squareY(t, z), 1 - smooth(outsideRect(sq, x, z) / 2.5)));
  // The house's level ground, at the forecourt's floor; the square comes up to the terrace's wall.
  // (Its wall stands along its front and down its sides as far as the lanes beside it are lower: the land is not eased into them.)
  each(house, 6, (k, x, z) => ease(k, floor, 1 - smooth((outsideRect(house, x, z) - (z > house.z1 || x < house.x0 || x > house.x1 ? 0 : 1)) / (z > house.z1 || x < house.x0 || x > house.x1 ? 0.8 : 5))));
  // The ground under each building, made level, with a margin; and under each shack that does not stand on posts.
  for (const b of t.buildings) {
    const y = b.y ?? floor, pad = Math.max(b.w, b.d + Math.max(0, ...(b.wings ?? []).map((g) => g.length)));
    each({ x0: b.x - pad, x1: b.x + pad, z0: b.z - pad, z1: b.z + pad }, 2, (k, x, z) => ease(k, y, 1 - smooth((outsideBuilt(b, x, z) - 0.4) / 1.6)));
    // (Behind a carriage way the yard comes up or down to its floor over a few strides.)
    const arch = b.arch ? classicalArch(b) : null;
    if (arch) each({ x0: b.x - pad - 8, x1: b.x + pad + 8, z0: b.z - pad - 8, z1: b.z + pad + 8 }, 0, (k, x, z) => {
      const { u, v } = inBuilding(b, x, z);
      if (v > b.d - 0.5 && v < b.d + 9) ease(k, y, (1 - smooth((v - b.d - 2.5) / 5)) * (1 - smooth((Math.abs(u - arch.u) - arch.w / 2 - 0.6) / 1.8)));
    });
  }
  for (const s of t.shacks) if (!s.stilts) each({ x0: s.x - s.w, x1: s.x + s.w, z0: s.z - s.w, z1: s.z + s.w }, 3, (k, x, z) => ease(k, s.y, 1 - smooth((Math.hypot(x - s.x, z - s.z) - Math.max(s.w, s.d) * 0.6) / 2)));
  // The storehouses' quays: the ground behind the line made up to its top, and before it dug out to the water.
  for (const w of t.wharves) {
    each(boxOf(w.line), 14, (k, x, z) => {
      let best = Infinity, sea2 = false;
      for (let i = 0; i + 1 < w.line.length; i++) {
        const [ax, az] = w.line[i], [bx, bz] = w.line[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, f = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(x - ax - dx * f, z - az - dz * f);
        if (d < best) { best = d; sea2 = dx * (z - az) - dz * (x - ax) > 0; }
      }
      if (sea2 && best > 0.2 && best < 9) M.data[k] = Math.min(M.data[k], t.sea - 1.8);
      else if (!sea2 && best < 4) ease(k, w.y, 1 - smooth((best - 2.5) / 1.5));
    });
  }
  for (const s of t.storehouses) {
    const fx = Math.cos(s.turn), fz = Math.sin(s.turn);
    each({ x0: s.x - s.d, x1: s.x + s.d, z0: s.z - s.d, z1: s.z + s.d }, 3, (k, x, z) => {
      const dx = x - s.x, dz = z - s.z, f = dx * fx + dz * fz, a = -dx * fz + dz * fx;
      // (Its own ground, and the deck before it to the quay's edge.)
      const out = Math.hypot(Math.max(Math.abs(a) - s.w / 2 - 0.4, 0), Math.max(-f - s.d / 2 - 0.4, 0, f - s.d / 2 - 2.6));
      ease(k, s.y, 1 - smooth((out - 0.2) / 1.8));
    });
  }
  // The outlook: level ground on the headland.
  if (t.outlook) { const o = t.outlook; each({ x0: o.x - 8, x1: o.x + 8, z0: o.z - 8, z1: o.z + 8 }, 4, (k, x, z) => ease(k, o.y, 1 - smooth((Math.hypot(x - o.x, z - o.z) - 5.5) / 4))); }
  // The harbour, dug out to a depth that ships can lie in, before the quay's edge and inside the moles.
  each({ x0: t.quay.x0 - 4, x1: t.quay.x1 + 4, z0: t.quay.z - 1, z1: Math.max(...t.moles.map((m) => m.line[m.line.length - 1][1])) + 6 }, 0, (k, x, z) => {
    if (inHarbour(t, x, z)) M.data[k] = Math.min(M.data[k], t.sea - 3.6 + (fbm2(x / 9, z / 9, 2, 3) - 0.5) * 0.6);
  });
  return M;
}

// ---- the layout

/** A classical building of the town's kind, as wide as its bays make it: `bays` across, its storeys and look from `rng`. */
function classical(rng: Rng, bays: number, d: number, colour: [number, number, number]): Omit<Building, 'x' | 'z' | 'faces'> {
  const storeys = rng.pick([2, 3, 3, 3, 4, 4, 5]), tall = rng.fork('heights');
  const heights = [round(tall.range(3.4, 4.2)), round(tall.range(3.8, 4.8)), ...Array.from({ length: storeys - 2 }, (_, n) => round(tall.range(2.9, 3.4) - n * 0.1))];
  // (About one in three is of bare brick, half of those with their dressings in stucco; from a stream of its own, so that nothing else changes.)
  const bk = rng.fork('brick'), brick = bk.chance(0.32) ? (bk.chance(0.5) ? 'stucco' as const : 'bare' as const) : undefined;
  return { style: 'imperial', w: round(bays * 2.55 + 1.6), d: round(d), storeys, heights, bays, colour, portico: bays >= 7 || (bays === 5 && rng.chance(0.4)), ...(brick ? { brick } : {}) };
}
/** A timber house of the town's kind: narrow to the street, gable or eaves to it, two to four storeys. */
function timber(rng: Rng, w: number, d: number, colour: [number, number, number]): Omit<Building, 'x' | 'z' | 'faces'> {
  const storeys = rng.pick([2, 2, 3, 3, 3, 4]), tall = rng.fork('heights');
  const heights = [round(tall.range(2.6, 3.3)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.35, 2.9) - n * 0.1))];
  return { style: 'timber', w: round(w), d: round(d), storeys, heights, bays: w > 7.4 ? 3 : 2, colour, jetty: round(rng.range(0.3, 0.45)), gable: rng.chance(0.65) };
}
/** A classical house of wood: one storey, now and then two, on a basement of granite, with an attic lit by dormers. */
function wooden(rng: Rng, w: number, d: number): Omit<Building, 'x' | 'z' | 'faces'> {
  const storeys = rng.chance(0.25) ? 2 : 1, tall = rng.fork('heights');
  const heights = storeys === 1 ? [round(tall.range(3.1, 3.6))] : [round(tall.range(3.0, 3.4)), round(tall.range(2.8, 3.2))];
  return {
    style: 'wooden', w: round(w), d: round(d), storeys, heights, bays: Math.max(3, Math.round((w - 2) / 2.2)), colour: rng.pick(BOARDS),
    basement: round(rng.range(0.8, 1.5)), endDoor: rng.chance(0.5) ? -1 : 1, dormers: rng.int(0, w > 14 ? 3 : 2),
  };
}
/** The paint of weatherboards: ochre, red ochre, yellow, a grey-green, grey, a faded pink. */
const BOARDS: [number, number, number][] = [[0.8, 0.55, 0.18], [0.78, 0.52, 0.2], [0.55, 0.2, 0.12], [0.86, 0.72, 0.36], [0.62, 0.68, 0.58], [0.72, 0.74, 0.72], [0.85, 0.6, 0.52]];
const WASHES: [number, number, number][] = [[0.86, 0.8, 0.66], [0.82, 0.62, 0.3], [0.78, 0.5, 0.44], [0.55, 0.66, 0.74], [0.6, 0.68, 0.5], [0.88, 0.87, 0.82], [0.74, 0.36, 0.26]];
const STUCCO: [number, number, number][] = [[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78], [0.88, 0.84, 0.72], [0.92, 0.82, 0.6]];

/**
 * Lays out a town round a house whose forecourt is `meadow` and whose door is at `doorX` in the forecourt's north side. Fills in the
 * site's `town`, `grounds`, `track` and `paths`. A town is always laid on land that was found: when only the house is being judged
 * (`worn` false), nothing is laid but the box the town would have.
 */
export function layOutTown(site: Site, meadow: Place, doorX: number, rng: Rng, worn = false): void {
  const T = site.wallThickness, F = meadow.floor;
  const others = site.places.filter((q) => q !== meadow);
  site.stands = 'free';
  const house = { x0: Math.min(...others.map((q) => q.x0)) - T, x1: Math.max(...others.map((q) => q.x1)) + T, z0: Math.min(...others.map((q) => q.z0)) - T, z1: meadow.z1 };
  const level = { x0: round(Math.min(house.x0, meadow.x0) - 3), x1: round(Math.max(house.x1, meadow.x1) + 3), z0: round(house.z0 - 4), z1: meadow.z1 };
  // The square, as broad as the house's ground and a lane either side; the stair from the forecourt into it; the waterfront.
  const dims = rng.fork('dims');
  const Wsq = round(Math.max(dims.range(50, 66), level.x1 - level.x0 + 12)), Dsq = round(dims.range(38, 52)), apron = round(dims.range(10, 13));
  let run = round(dims.range(6.5, 9.5));
  const qx = round((level.x0 + level.x1) / 2), qz = round(meadow.z1 + Dsq + apron);
  const box = { x0: qx - 470, x1: qx + 470, z0: qz - 360, z1: qz + 190 };
  if (!worn) { site.grounds = { x0: box.x0 + 12, x1: box.x1 - 12, z0: box.z0 + 12, z1: box.z1 - 12 }; return; }

  // ---- the land: a coast found with room for all of this
  const need: TownNeed = { square: { x0: -Wsq / 2, x1: Wsq / 2, z0: -(Dsq + apron), z1: -apron }, house: { x0: level.x0 - qx, x1: level.x1 - qx, z0: level.z0 - qz, z1: level.z1 - qz }, half: 190, deep: 230 };
  // (The coasts are drawn from a pool, as islands' seas are, so that one made serves many sites.)
  const COASTS = 13, tr = rng.fork('terrain'), first = tr.int(0, COASTS - 1), stride = 1 + tr.int(0, 5);
  let found: { seed: number; spot: TownSpot } | null = null;
  for (let tries = 0; tries < 9 && !found; tries++) {
    const seed = 9001 + ((first + tries * stride) % COASTS) * 131, spots = findTowns(coastland(seed), need, tr.fork(`spot${tries}`));
    if (spots.length) found = { seed, spot: spots[Math.min(spots.length - 1, tr.int(0, 2))] };
  }
  if (!found) throw new Error(`no coast found has room for a town (seed ${site.seed})`);
  const sp = found.spot, sea = round(F - sp.base);
  const quayY = round(sea + dims.range(1.7, 2.1));
  const t: Town = {
    terrain: { seed: found.seed, u: sp.u, v: sp.v, turn: sp.turn, base: sp.base, cell: 1.5 },
    sea, land: box, level,
    quay: { x0: qx - 60, x1: qx + 60, z: qz, y: quayY, apron },
    square: { x0: round(qx - Wsq / 2), x1: round(qx + Wsq / 2), z0: meadow.z1, z1: round(meadow.z1 + Dsq), yN: F - 1, yS: quayY + 0.3 },
    stair: { x0: 0, x1: 0, z0: meadow.z1, z1: meadow.z1 + run },
    moles: [], streets: [], blocks: [], buildings: [], shacks: [], storehouses: [], wharves: [], stalls: [], boats: [], fields: [], walls: [],
  };
  const nat = (x: number, z: number) => { const f = naturalLand(t, F); return f.holds(x, z) ? f.at(x, z) : frameAt(t, F, x, z); };
  const slopeAt = (x: number, z: number, r = 4) => Math.hypot(nat(x + r, z) - nat(x - r, z), nat(x, z + r) - nat(x, z - r)) / (2 * r);

  // ---- the quay and the harbour: the quay as long as the shore keeps near its line, the moles from its ends
  {
    const q = rng.fork('harbour');
    for (const side of [-1, 1]) {
      let reach = Wsq / 2 + 30;
      for (let x = reach; x <= Wsq / 2 + q.range(70, 100); x += 5) {
        const px = qx + side * x;
        // (The quay ends where the land behind it stands high, or where there is no land behind it at all.)
        if (nat(px, qz - 6) > sea + 6 || nat(px, qz - 14) < sea - 1.5) break;
        reach = x;
      }
      if (side < 0) t.quay.x0 = round(qx - reach); else t.quay.x1 = round(qx + reach);
    }
    // The moles: out from the quay's ends into the sea, then turning in towards each other, leaving a mouth between their heads.
    const long = q.chance(0.5) ? -1 : 1, width = round(q.range(6.5, 8.5)), top = round(quayY + q.range(0.4, 0.7));
    const span = t.quay.x1 - t.quay.x0, mouth = q.range(26, 36);
    const outW = round(q.range(60, 95) + (long < 0 ? 25 : 0)), outE = round(q.range(60, 95) + (long > 0 ? 25 : 0));
    const inW = round(Math.max(10, (span - mouth) * (long < 0 ? q.range(0.5, 0.65) : q.range(0.25, 0.4)))), inE = round(Math.max(10, span - mouth - inW));
    // (Each an arm: out from the quay's end leaning a little away from the harbour, then sweeping round in a curve towards the
    // other, in a dozen straight lengths, as moles are built.)
    const arm = (x0: number, side: -1 | 1, out: number, inward: number): [number, number][] => {
      const lean = q.range(0.05, 0.25) * out, pts: [number, number][] = [[x0, qz - 1]];
      for (let k = 1; k <= 12; k++) {
        const a = (k / 12) * (Math.PI / 2), x = x0 + side * (-lean * Math.sin(a * 2) * 0.5 + (inward + lean * 0.3) * (1 - Math.cos(a))), z = qz + out * Math.sin(a);
        pts.push([round(x), round(z)]);
      }
      return pts;
    };
    t.moles = [
      { line: arm(t.quay.x0, 1, outW, inW), width, y: top },
      { line: arm(t.quay.x1, -1, outE, inE), width, y: top },
    ];
    // The harbour light, at the head of the longer mole.
    const m = t.moles[long < 0 ? 0 : 1], [hx, hz] = m.line[m.line.length - 1], [px, pz] = m.line[m.line.length - 2];
    const along = Math.atan2(hz - pz, hx - px);
    t.light = { x: round(hx - Math.cos(along) * 3), z: round(hz - Math.sin(along) * 3), y: top, r: round(q.range(2.2, 2.8)), height: round(q.range(9, 13)), door: along + Math.PI };
  }

  // ---- the square and the stair: the square's ground from the land, eased so that its fall is gentle and the stair can climb from it
  {
    const s = t.square;
    s.yS = round(Math.max(quayY + 0.3, Math.min(nat(qx, s.z1 - 4), quayY + 2.5)));
    let yN = Math.min(Math.max(nat(qx, s.z0 + 4), s.yS), s.yS + Dsq * 0.075);
    // (The forecourt stands at least a short flight over the square, and no higher than its stair can climb at one in two.)
    if (F - yN < 0.9) yN = F - 0.9;
    if (F - yN > run * 0.55) run = round(Math.min(Dsq * 0.4, (F - yN) / 0.55));
    if (F - yN > run * 0.55) yN = F - run * 0.55;
    s.yN = round(yN); s.yS = round(Math.min(s.yS, s.yN));
    const sw = round(Math.min(meadow.x1 - meadow.x0 - 4, dims.range(9, 16)));
    const sx = Math.min(meadow.x1 - 2 - sw / 2, Math.max(meadow.x0 + 2 + sw / 2, doorX));
    t.stair = { x0: round(sx - sw / 2), x1: round(sx + sw / 2), z0: meadow.z1, z1: round(meadow.z1 + run) };
  }

  // ---- the grid: columns of blocks either side of the square, rows of them back from the waterfront, streets between
  const grid = rng.fork('grid');
  const cols: { x0: number; x1: number; side: -1 | 1; k: number }[] = [], colStreets: { x: number; w: number; side: -1 | 1; k: number }[] = [];
  for (const side of [-1, 1] as const) {
    let edge = side < 0 ? t.square.x0 : t.square.x1;
    for (let k = 1; k <= 5; k++) {
      const bw = grid.range(30, 40), a = edge, b = edge + side * bw;
      cols.push({ x0: round(Math.min(a, b)), x1: round(Math.max(a, b)), side, k });
      const sw = round(grid.range(6, 8));
      colStreets.push({ x: round(b + side * sw / 2), w: sw, side, k });
      edge = b + side * sw;
    }
  }
  const rows: { z0: number; z1: number; k: number }[] = [], rowStreets: { z: number; w: number; k: number }[] = [];
  {
    let edge = qz - apron;
    for (let k = 0; k < 6; k++) {
      const bd = grid.range(30, 38), sw = round(grid.range(6, 8));
      rows.push({ z0: round(edge - bd), z1: round(edge), k });
      rowStreets.push({ z: round(edge - bd - sw / 2), w: sw, k });
      edge -= bd + sw;
    }
  }
  // Which blocks are built, and with what: the land under each must be dry, even enough and not crag; classical nearest the square
  // and the harbour, timber beyond, and none further out (the shacks are there).
  // (The low ground along the shore is made up to the quay's level, as the waterfront is, so it is judged as it will be made.)
  const blockOk = (r: Rect) => {
    let lo = Infinity, hi = -Infinity;
    for (let z = r.z0; z <= r.z1; z += 4) for (let x = r.x0; x <= r.x1; x += 4) { const y = nat(x, z); lo = Math.min(lo, y); hi = Math.max(hi, Math.max(y, quayY)); if (slopeAt(x, z) > 0.42) return false; }
    return lo > (r.z1 > qz - apron - 1 ? sea - 1.5 : sea + 1) && hi - Math.max(lo, quayY) < 9;
  };
  const near = (r: Rect, m: number) => outsideRect(level, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) < m;
  for (const c of cols) for (const r of rows) {
    const b: Rect = { x0: c.x0, x1: c.x1, z0: r.z0, z1: r.z1 };
    const kind = (c.k === 1 && r.k <= 2) || (r.k === 0 && c.k <= 2) ? 'classical' : c.k <= 3 && r.k <= 3 && !(c.k === 3 && r.k === 3) ? 'timber' : null;
    if (!kind || near(b, 0) || !blockOk(b)) continue;
    t.blocks.push({ ...b, kind });
  }

  // The ground the streets are graded to: the land smoothed, as the made land has it (`makeLand`); for laying out, read off a lattice of its own.
  const gradeAt = (() => {
    const C = 4, gx0 = box.x0, gz0 = box.z0, gnx = Math.round((box.x1 - box.x0) / C) + 1, gnz = Math.round((box.z1 - box.z0) / C) + 1, raw = new Float32Array(gnx * gnz);
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) raw[j * gnx + i] = nat(gx0 + i * C, gz0 + j * C);
    const out = new Float32Array(raw.length), R = 3;
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
      let s = 0, n = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < gnx && jj < gnz) { s += raw[jj * gnx + ii]; n++; } }
      out[j * gnx + i] = Math.max(quayY + 0.25, s / n);
    }
    return (x: number, z: number) => {
      const fx = Math.min(gnx - 1.001, Math.max(0, (x - gx0) / C)), fz = Math.min(gnz - 1.001, Math.max(0, (z - gz0) / C)), i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, k = j * gnx + i;
      return out[k] * (1 - a) * (1 - b) + out[k + 1] * a * (1 - b) + out[k + gnx] * (1 - a) * b + out[k + gnx + 1] * a * b;
    };
  })();
  /** The ground of the town at a point, as it is laid out: the square's, the waterfront's, or the grade. */
  const townY = (x: number, z: number) => {
    if (x >= t.square.x0 && x <= t.square.x1 && z >= t.square.z0 && z <= t.square.z1) return squareY(t, z);
    if (z > qz - apron && x > t.quay.x0 && x < t.quay.x1) return apronY(t, x > t.square.x0 && x < t.square.x1 ? t.square.yS : gradeAt(x, qz - apron), z);
    return gradeAt(x, z);
  };

  // ---- the streets: the waterfront; between the rows, between the columns; lanes beside the house; only where there are blocks
  {
    const lineAt = (pts: [number, number][]): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let s = 0; s < n; s++) { const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n; out.push([round(x), round(z), round(townY(x, z) * 100) / 100]); }
      }
      const [lx, lz] = pts[pts.length - 1];
      out.push([round(lx), round(lz), round(townY(lx, lz) * 100) / 100]);
      // (No steeper than a street can be: where the land it is graded to jumps, as it does beside the house's terrace, the street
      // ramps instead, from both ends towards the middle.)
      const GRADE = 0.14;
      for (const dir of [1, -1]) for (let k = dir > 0 ? 1 : out.length - 2; k >= 0 && k < out.length; k += dir) {
        const p0 = out[k - dir], run = Math.hypot(out[k][0] - p0[0], out[k][1] - p0[1]);
        out[k][2] = Math.round(Math.min(p0[2] + run * GRADE, Math.max(p0[2] - run * GRADE, out[k][2])) * 100) / 100;
      }
      return out;
    };
    const span = (blocks: Rect[], along: 'x' | 'z'): [number, number] | null => {
      if (!blocks.length) return null;
      return along === 'x' ? [Math.min(...blocks.map((b) => b.x0)), Math.max(...blocks.map((b) => b.x1))] : [Math.min(...blocks.map((b) => b.z0)), Math.max(...blocks.map((b) => b.z1))];
    };
    // The waterfront, the length of the quay.
    t.streets.push({ line: lineAt([[t.quay.x0 + 2, qz - apron / 2], [t.quay.x1 - 2, qz - apron / 2]]), width: apron, kind: 'street' });
    // Between the rows: from the furthest block on one side to the furthest on the other, crossing the square's column north of the house only.
    for (const rs of rowStreets) {
      const by = t.blocks.filter((b) => Math.abs(b.z0 - (rs.z + rs.w / 2)) < 0.5 || Math.abs(b.z1 - (rs.z - rs.w / 2)) < 0.5);
      for (const side of [-1, 1]) {
        const mine = by.filter((b) => (side < 0 ? b.x1 <= t.square.x0 + 0.1 : b.x0 >= t.square.x1 - 0.1)), s = span(mine, 'x');
        if (!s) continue;
        const inner = side < 0 ? t.square.x0 : t.square.x1, outer = side < 0 ? s[0] : s[1];
        // (A street that runs into the house's ground stops at the lane beside it.)
        const stop = rs.z > level.z0 - 3 && rs.z < level.z1 + 3 ? (side < 0 ? level.x0 - 3 : level.x1 + 3) : inner;
        t.streets.push({ line: lineAt([[outer, rs.z], [stop, rs.z]]), width: rs.w, kind: 'street' });
      }
    }
    // Between the columns: from the waterfront up to the furthest block.
    for (const cs of colStreets) {
      const by = t.blocks.filter((b) => Math.abs(b.x0 - (cs.x + cs.w / 2)) < 0.5 || Math.abs(b.x1 - (cs.x - cs.w / 2)) < 0.5), s = span(by, 'z');
      if (!s) continue;
      const foot = cs.x > t.quay.x0 && cs.x < t.quay.x1 ? qz - apron + 0.5 : s[1];
      t.streets.push({ line: lineAt([[cs.x, foot], [cs.x, s[0]]]), width: cs.w, kind: 'street' });
    }
    // Lanes either side of the house, from the square up to the street behind it, if any.
    const behind = rowStreets.find((rs) => rs.z < level.z0 && t.blocks.some((b) => Math.abs(b.z1 - (rs.z - rs.w / 2)) < 0.5 || Math.abs(b.z0 - (rs.z + rs.w / 2)) < 0.5));
    for (const side of [-1, 1]) {
      const x = side < 0 ? (t.square.x0 + level.x0) / 2 : (t.square.x1 + level.x1) / 2, w = Math.abs(side < 0 ? level.x0 - t.square.x0 : t.square.x1 - level.x1);
      if (w < 3) continue;
      t.streets.push({ line: lineAt([[x, t.square.z0 + 1], [x, behind ? behind.z : level.z0 - 2]]), width: round(Math.min(6, w)), kind: 'lane' });
    }
  }

  /** Whether a classical building can have a carriage way through its end: two bays free of the middle, and no wing behind them. */
  const archable = (b: Building) => b.style === 'imperial' && !b.wings?.length && freeAtEnds(b) >= 2;
  /** Whether a block stands beside the square, fronting it. */
  const blocksBySquare = (r: Rect) => (Math.abs(r.x0 - t.square.x1) < 0.2 || Math.abs(r.x1 - t.square.x0) < 0.2) && r.z1 > t.square.z0 && r.z0 < t.square.z1;
  // ---- the buildings of the blocks: along every side of a block that fronts a street or the square, close together, their
  // fronts on the block's edge. The long sides first, corner to corner; the short sides between them.
  {
    const b0 = rng.fork('buildings');
    let n = 0;
    for (const blk of t.blocks) {
      const q = b0.fork(`block${n++}`), classic = blk.kind === 'classical';
      const deep = classic ? q.range(9.6, 11.8) : q.range(6.4, 8.6);
      const wash = (r: Rng) => (classic ? r.pick(STUCCO) : r.pick(WASHES));
      // Along a front from `a` to `c` (in the front's own run), facing `turn`, its edge given: buildings side by side.
      const front = (edge: (s: number) => [number, number], a: number, c: number, turn: number, depth: number) => {
        let s = a;
        while (c - s > (classic ? 9.3 : 5.6)) {
          const r = q.fork(`b${t.buildings.length}`);
          let spec: Omit<Building, 'x' | 'z' | 'faces'>;
          if (classic) {
            let bays = Math.floor((c - s - 1.6) / 2.55);
            if (bays > 13) bays = r.pick([5, 7, 7, 9, 9, 11]);
            if (bays % 2 === 0) bays--;
            if (bays < 3) break;
            spec = classical(r, bays, depth, wash(r));
          } else if (c - s > 14 && r.fork('wooden').chance(0.28) && (() => {
            // (Now and then, among the timber-framed houses, a classical house of wood, long and low; its door is in an end wall, and
            // the steps up to it want room beside it. It is deeper than the timber houses are, so it keeps away from the block's corners,
            // where it would reach into the first house of the side street.)
            const wW = Math.min(c - s - 3, r.range(11, 18)), dW = Math.max(depth, r.range(8, 9.5));
            return dW <= depth || (s - a > depth + 3.5 && c - s - wW > depth + 3.5);
          })()) {
            spec = wooden(r.fork('wooden house'), Math.min(c - s - 3, r.range(11, 18)), Math.max(depth, r.range(8, 9.5)));
            if (spec.endDoor! < 0) s += 3;
            if (spec.d > depth && (s - a < depth + 0.5 || c - s - spec.w < depth + 0.5)) spec.d = depth;
          } else {
            const w = Math.min(c - s, r.range(6, 8.8));
            if (w < 5.6) break;
            spec = timber(r, w, depth, wash(r));
          }
          const mid = s + spec.w / 2, [ex, ez] = edge(mid);
          const b: Building = { ...spec, x: round(ex - Math.cos(turn) * spec.d / 2), z: round(ez - Math.sin(turn) * spec.d / 2), faces: 'w', turn };
          // (Its ground: the street's or the square's, just before its front.)
          b.y = round(townY(ex + Math.cos(turn) * 1.5, ez + Math.sin(turn) * 1.5) * 100) / 100;
          if (b.style === 'imperial') {
            classicalVariations(b, r.fork('variations'));
            // (Now and then a carriage way through it into the block's yard: see below for the one every closed block has.)
            if (archable(b) && r.fork('arch').chance(0.25)) b.arch = { side: r.fork('arch side').chance(0.5) ? -1 : 1 };
            b.plan = planClassical(b, r.fork('plan'));
          }
          else if (b.style === 'timber') { b.door = r.pick([0.24, 0.76]); b.plan = planTimber(b); }
          t.buildings.push(b);
          s += spec.w + (classic ? r.range(0, 0.4) : spec.endDoor! > 0 ? 3 : r.chance(0.15) ? r.range(1.4, 2.6) : r.range(0, 0.25));
        }
      };
      // The block's four fronts: each the line of its edge, the run along it, and the bearing it faces. Two opposite fronts run the
      // block's whole length, corner to corner; the other two run between them.
      const sides = {
        s: { edge: (s: number): [number, number] => [s, blk.z1], run: [blk.x0, blk.x1], turn: Math.PI / 2 },
        n: { edge: (s: number): [number, number] => [blk.x1 + blk.x0 - s, blk.z0], run: [blk.x0, blk.x1], turn: -Math.PI / 2 },
        e: { edge: (s: number): [number, number] => [blk.x1, blk.z1 + blk.z0 - s], run: [blk.z0, blk.z1], turn: 0 },
        w: { edge: (s: number): [number, number] => [blk.x0, s], run: [blk.z0, blk.z1], turn: Math.PI },
      };
      type Side = keyof typeof sides;
      // A classical block next to the square fronts it; any other, the street to the south. Half the time its chief front is one
      // building, as broad as the block allows, with wings back along the side streets about a court: a U, or now and then an L.
      const chief = (classic && blocksBySquare(blk) ? (blk.x0 >= t.square.x1 - 0.1 ? 'w' : 'e') : 's') as Side;
      const across: Side = ({ s: 'n', n: 's', e: 'w', w: 'e' } as const)[chief];
      const ends: Side[] = chief === 's' || chief === 'n' ? ['e', 'w'] : ['n', 's'];
      const full = (k: Side) => k === chief || k === across;
      const span = (k: Side): [number, number] => { const [a, c] = sides[k].run; return full(k) ? [a, c] : [a + deep, c - deep]; };
      const winged = new Set<Side>();
      if (classic && q.fork('u').chance(0.5)) {
        const r = q.fork('chief'), [a, c] = span(chief);
        let bays = Math.min(15, Math.floor((c - a - 0.6 - 1.6) / 2.55));
        if (bays % 2 === 0) bays--;
        const length = (chief === 's' || chief === 'n' ? blk.z1 - blk.z0 : blk.x1 - blk.x0) - 2 * deep - 1.2;
        if (bays >= 7 && length >= 6) {
          const spec = classical(r, bays, deep, wash(r)), mid = (a + c) / 2, [ex, ez] = sides[chief].edge(mid), turn = sides[chief].turn;
          const b: Building = { ...spec, x: round(ex - Math.cos(turn) * deep / 2), z: round(ez - Math.sin(turn) * deep / 2), faces: 'w', turn };
          const width = round(r.range(5.4, Math.min(8.8, b.w / 2 - 4))), both = r.chance(0.75), one: -1 | 1 = r.chance(0.5) ? -1 : 1;
          b.wings = (both ? [-1, 1] as const : [one]).map((side) => ({ side, width, length: round(length) }));
          // (The side a wing stands on: the right hand of one who faces the front is (fz, -fx).)
          for (const g of b.wings) {
            const rx = Math.sin(turn) * g.side, rz = -Math.cos(turn) * g.side;
            winged.add(Math.abs(rx) > Math.abs(rz) ? (rx > 0 ? 'e' : 'w') : (rz > 0 ? 's' : 'n'));
          }
          b.y = round(townY(ex + Math.cos(turn) * 1.5, ez + Math.sin(turn) * 1.5) * 100) / 100;
          classicalVariations(b, r.fork('variations'));
          b.plan = planClassical(b, r.fork('plan'));
          t.buildings.push(b);
        }
      }
      // A timber block may have on a corner of its south front a classical house of wood built as an L: its front on the street to the
      // south, its wing down the side street; its door in its other end. The runs of the two fronts it stands on are shortened for it.
      const trim: Partial<Record<Side, [number, number]>> = {};
      if (!classic && q.fork('corner').chance(0.45)) {
        const r = q.fork('corner house'), side: -1 | 1 = r.chance(0.5) ? -1 : 1, spec = wooden(r, r.range(11, 15), r.range(8.5, 10));
        const width = round(r.range(7, Math.min(8.6, spec.w - 3))), length = round(Math.min(r.range(6, 10), blk.z1 - blk.z0 - spec.d - deep - 2));
        if (length >= 5) {
          const x = side > 0 ? blk.x1 - spec.w / 2 : blk.x0 + spec.w / 2, b: Building = { ...spec, x: round(x), z: round(blk.z1 - spec.d / 2), faces: 'w', turn: Math.PI / 2, endDoor: side > 0 ? -1 : 1, wings: [{ side, width, length }] };
          b.y = round(townY(x, blk.z1 + 1.5) * 100) / 100;
          t.buildings.push(b);
          trim.s = side > 0 ? [0, spec.w + 3] : [spec.w + 3, 0];
          // (The side street's run, counted from the south for the west front and from the north for the east one.)
          if (side > 0) trim.e = [spec.d + length + 0.6 - deep, 0]; else trim.w = [0, spec.d + length + 0.6 - deep];
        }
      }
      const from = t.buildings.length;
      for (const k of [chief, across, ...ends]) {
        if (winged.has(k) || (k === chief && t.buildings.some((b) => b.wings && b.style === 'imperial' && outsideRect(blk, b.x, b.z) === 0))) continue;
        const [a0, c0] = span(k), [ta, tc] = trim[k] ?? [0, 0];
        front(sides[k].edge, a0 + ta, c0 - tc, sides[k].turn, full(k) ? deep : Math.min(deep, (chief === 's' || chief === 'n' ? blk.x1 - blk.x0 : blk.z1 - blk.z0) / 2 - 1));
      }
      // A closed block of classical buildings is entered from the street: through a carriage way under an arch in one of them, at least,
      // into the yard within. (If none was given one, the broadest that can take one is.)
      const mine = t.buildings.slice(from).filter((b) => b.style === 'imperial');
      if (classic && !mine.some((b) => b.arch)) {
        const pick = mine.filter(archable).sort((p, o) => o.w - p.w)[0];
        if (pick) { const r = q.fork('arch'); pick.arch = { side: r.chance(0.5) ? -1 : 1 }; pick.plan = planClassical(pick, r.fork('plan')); }
      }
    }
  }

  // ---- the market: stalls in two rows either side of the way down the middle from the stair to the quay, and the fountain
  {
    const s = t.square, q = rng.fork('market'), mid = (t.stair.x0 + t.stair.x1) / 2;
    t.fountain = { x: round(mid), z: round(s.z0 + run + (s.z1 - s.z0 - run) * q.range(0.4, 0.55)), r: round(q.range(2.8, 4)) };
    const goods = ['fish', 'fruit', 'cloth', 'pots', 'bread'] as const;
    for (const side of [-1, 1]) {
      const x = side < 0 ? (s.x0 + mid - 5) / 2 : (s.x1 + mid + 5) / 2;
      for (let z = s.z0 + run + 4; z < s.z1 - 3; z += q.range(4.5, 6)) {
        if (Math.hypot(x - t.fountain.x, z - t.fountain.z) < t.fountain.r + 4 || q.chance(0.25)) continue;
        for (const face of [-1, 1]) {
          if (q.chance(0.3)) continue;
          t.stalls.push({ x: round(x + face * q.range(2.2, 3.2)), z: round(z), w: round(q.range(2.4, 3.4)), d: round(q.range(1.6, 2.1)), turn: face < 0 ? 0 : Math.PI, awning: q.pick([[0.62, 0.12, 0.08], [0.15, 0.3, 0.5], [0.75, 0.6, 0.2], [0.2, 0.42, 0.25], [0.85, 0.82, 0.74]] as [number, number, number][]), goods: q.pick([...goods]) });
        }
      }
    }
  }

  // ---- shacks: along the shore beyond the quay's ends, facing the water, some on posts at its edge; and on the fringes of the town
  {
    const q = rng.fork('shacks');
    const clear = (x: number, z: number, r: number) => !t.blocks.some((b) => outsideRect(b, x, z) < r) && !t.buildings.some((b) => outsideBuilt(b, x, z) < r) && !t.streets.some((s) => nearLine(s.line, x, z).off < s.width / 2 + r) && outsideRect(level, x, z) > r + 4 && !t.shacks.some((s) => Math.hypot(s.x - x, s.z - z) < Math.max(s.w, s.d) * 0.7 + r) && outsideRect(t.square, x, z) > r;
    const tints: [number, number, number][] = [[0.42, 0.33, 0.24], [0.3, 0.26, 0.22], [0.5, 0.4, 0.3], [0.26, 0.3, 0.32], [0.45, 0.2, 0.15], [0.3, 0.38, 0.3]];
    const shack = (x: number, z: number, turn: number, stilts: number) => {
      const w = round(q.range(3.2, 5.2)), d = round(q.range(3.6, 5.6)), y = round(stilts ? sea + q.range(1.5, 2) : nat(x, z) + 0.05);
      t.shacks.push({ x: round(x), z: round(z), y, w, d, turn, roof: q.pick(['boards', 'boards', 'tin', 'tin', 'turf'] as const), lean: q.chance(0.45), stilts: stilts ? round(y - nat(x, z)) : 0, colour: q.pick(tints) });
    };
    // Along the shore beyond one end of the quay, or both, where the land is low a good way along: a row of storehouses, their gables to
    // the water, on a quay of stone with a deck of planks before them.
    const rowOf = (side: -1 | 1) => {
      const pts: [number, number][] = [];
      for (let x = side < 0 ? t.quay.x0 - 12 : t.quay.x1 + 12; Math.abs(x - qx) < 360; x += side * 2) {
        let z = qz + 60;
        while (z > qz - 60 && nat(x, z) < sea + 0.6) z -= 0.5;
        if (z <= qz - 60 || z >= qz + 60 || nat(x, z - 14) > sea + 6 || slopeAt(x, z - 6, 5) > 0.3) break;
        if (t.moles.some((m) => m.line.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < m.width + 6))) { if (pts.length) break; continue; }
        pts.push([x, z]);
      }
      return pts;
    };
    const rows2 = ([-1, 1] as const).map((side) => ({ side, pts: rowOf(side) })).filter((r) => r.pts.length * 2 > 30).sort((p0, p1) => p1.pts.length - p0.pts.length);
    for (const [n, row] of rows2.entries()) {
      if (n && !q.chance(0.5)) break;
      const side = row.side;
      // (The quay's line: the shore made smooth, a little out into the water; the storehouses along it, gable after gable.)
      const sm = row.pts.map(([x], k) => { let s0 = 0, c0 = 0; for (let d = -4; d <= 4; d++) { const p0 = row.pts[k + d]; if (p0) { s0 += p0[1]; c0++; } } return [x, s0 / c0 + 1.2] as [number, number]; });
      const y = round(quayY - 0.1), stores: Town['storehouses'] = [];
      let at = 0;
      const lineAt = (s0: number): { x: number; z: number; tx: number; tz: number } => {
        const i = Math.min(sm.length - 2, Math.max(0, Math.floor(s0 / 2))), [ax, az] = sm[i], [bx, bz] = sm[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, f = s0 / 2 - i;
        return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, tx: (bx - ax) / l, tz: (bz - az) / l };
      };
      const length = (sm.length - 1) * 2, tint = q.fork('falu');
      while (at < length - 6 && stores.length < 12) {
        const w = round(tint.range(4.6, 7.2)), d = round(tint.range(7, 11.5)), deck = tint.range(1.4, 2.4), s0 = at + w / 2;
        if (s0 + w / 2 > length) break;
        const p0 = lineAt(s0);
        // (Facing out over the water: square to the line, the sea's side. The line runs along x, the sea to the south.)
        let nx = -p0.tz * side, nz = p0.tx * side;
        if (nz < 0) { nx = -nx; nz = -nz; }
        const cx = p0.x - nx * (deck + d / 2), cz = p0.z - nz * (deck + d / 2);
        const two = tint.chance(0.4), colour: [number, number, number] = tint.chance(0.85) ? [round(0.46 + tint.range(-0.05, 0.06)), round(0.13 + tint.range(-0.02, 0.03)), round(0.08 + tint.range(-0.01, 0.02))] : tint.pick([[0.62, 0.45, 0.22], [0.36, 0.28, 0.22]] as [number, number, number][]);
        if (clear(cx, cz, 1)) stores.push({ x: round(cx), z: round(cz), y, w, d, turn: Math.round(Math.atan2(nz, nx) * 100) / 100, height: round(two ? tint.range(4.8, 6) : tint.range(3.2, 3.9)), colour, logs: tint.chance(0.15) });
        at += w + tint.range(0.25, 1.4);
      }
      if (stores.length < 3) continue;
      t.storehouses.push(...stores);
      const used = sm.filter(([x]) => Math.abs(x - qx) <= Math.max(...stores.map((st) => Math.abs(st.x - qx))) + 6);
      t.wharves.push({ line: (side < 0 ? [...used].reverse() : used).map(([x, z]) => [round(x), round(z)] as [number, number]), y });
      // Boats tied up along it.
      for (const st of stores) if (q.chance(0.35)) t.boats.push({ x: round(st.x + Math.cos(st.turn) * (st.d / 2 + 4.5)), z: round(st.z + Math.sin(st.turn) * (st.d / 2 + 4.5)), heading: st.turn + Math.PI / 2, length: round(q.range(4.5, 7)), afloat: true });
    }
    // Along the shore elsewhere: from each end of the quay outward, where the land comes down low to the water, and no storehouses stand.
    for (const side of [-1, 1]) {
      if (t.wharves.some((w) => Math.sign(w.line[0][0] - qx) === side)) continue;
      let made = 0;
      for (let x = side < 0 ? t.quay.x0 - 14 : t.quay.x1 + 14; Math.abs(x - qx) < 330 && made < 9; x += side * q.range(8, 14)) {
        // (The shore here: coming in from the sea, the first ground a little over the water.)
        let z = qz + 70;
        while (z > qz - 80 && nat(x, z) < sea + 0.9) z -= 1;
        if (z <= qz - 80 || z >= qz + 70) continue;
        // (Not under a cliff, nor on ground that climbs steeply from the shore.)
        if (nat(x, z - 10) > sea + 5 || slopeAt(x, z - 3) > 0.3) continue;
        const onPosts = q.chance(0.3), sz = onPosts ? z + 1.5 : z - q.range(3, 6);
        if (!clear(x, sz, 2.5) || t.moles.some((m) => m.line.some(([mx, mz]) => Math.hypot(mx - x, mz - sz) < 14))) continue;
        shack(x, sz, Math.PI / 2 + q.range(-0.35, 0.35), onPosts ? 1 : 0);
        made++;
        // A boat drawn up on the shore before it, now and then.
        if (q.chance(0.5) && !onPosts) t.boats.push({ x: round(x + q.range(-3, 3)), z: round(z + q.range(0.5, 2.5)), heading: q.range(1.2, 1.9), length: round(q.range(3.8, 5.4)), afloat: false });
      }
    }
    // On the fringes: in the cells of the grid next to the built blocks that were not built themselves, a few each, on gentle ground.
    let fringe = 0;
    for (const c of cols) for (const r of rows) {
      const b: Rect = { x0: c.x0, x1: c.x1, z0: r.z0, z1: r.z1 };
      if (t.blocks.some((k) => k.x0 === b.x0 && k.z0 === b.z0) || near(b, 4) || fringe > 22) continue;
      if (!t.blocks.some((k) => outsideRect(k, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) < 45)) continue;
      const want = q.int(1, 4);
      for (let tries = 0, made = 0; tries < 20 && made < want; tries++) {
        const x = q.range(b.x0 + 3, b.x1 - 3), z = q.range(b.z0 + 3, b.z1 - 3);
        if (nat(x, z) < sea + 1.2 || slopeAt(x, z) > 0.28 || !clear(x, z, 3)) continue;
        // (Facing the nearest street, near enough.)
        let best = 0, bd = Infinity;
        for (const s of t.streets) { const n = nearLine(s.line, x, z); if (n.off < bd) { bd = n.off; const p = s.line.reduce((m, p0) => (Math.hypot(p0[0] - x, p0[1] - z) < Math.hypot(m[0] - x, m[1] - z) ? p0 : m)); best = Math.atan2(p[1] - z, p[0] - x); } }
        shack(x, z, Math.round((best + q.range(-0.3, 0.3)) * 100) / 100, 0);
        made++; fringe++;
      }
    }
  }

  // ---- boats in the harbour, moored along the quay and the moles' inner sides
  {
    const q = rng.fork('boats');
    // A schooner lying along the quay, and two or three smacks, each decked and with a mast; then the open boats in the gaps.
    const taken: [number, number][] = [], vq = rng.fork('vessels');
    const moor = (length: number, masts: number) => {
      for (let tries = 0; tries < 20; tries++) {
        const x = vq.range(t.quay.x0 + length / 2 + 5, t.quay.x1 - length / 2 - 5);
        if (taken.some(([a, b]) => x + length / 2 > a - 2 && x - length / 2 < b + 2)) continue;
        taken.push([x - length / 2, x + length / 2]);
        t.boats.push({ x: round(x), z: round(qz + length * 0.13 + 0.9), heading: vq.chance(0.5) ? 0 : Math.PI, length: round(length), afloat: true, masts });
        return;
      }
    };
    if (t.quay.x1 - t.quay.x0 > 90) moor(vq.range(20, 25), 2);
    for (let k = vq.int(2, 3); k > 0; k--) moor(vq.range(9, 13), 1);
    for (let x = t.quay.x0 + 8; x < t.quay.x1 - 8; x += q.range(7, 13)) {
      if (q.chance(0.35) || taken.some(([a, b]) => x > a - 5 && x < b + 5)) continue;
      t.boats.push({ x: round(x), z: round(qz + q.range(2.6, 3.4)), heading: q.chance(0.5) ? 0 : Math.PI, length: round(q.range(4.5, 7.5)), afloat: true });
    }
    for (let k = 0; k < 3; k++) {
      const x = q.range(t.quay.x0 + 25, t.quay.x1 - 25), z = qz + q.range(20, 45);
      if (inHarbour(t, x, z)) t.boats.push({ x: round(x), z: round(z), heading: q.range(0, Math.PI * 2), length: round(q.range(5, 9)), afloat: true });
    }
  }

  // ---- the outlook: on the headland, the highest ground near the cliff's edge with level room about it
  let outlookFrom: [number, number] | null = null;
  if (sp.head) {
    const q = rng.fork('outlook');
    let best: { x: number; z: number; y: number; facing: number; score: number } | null = null;
    const hx = qx + sp.head.x;
    for (let x = hx - 90; x <= hx + 90; x += 4) for (let z = qz - 110; z <= qz + 60; z += 4) {
      if (x < box.x0 + 40 || x > box.x1 - 40 || z < box.z0 + 40 || z > box.z1 - 40) continue;
      const y = nat(x, z);
      if (y < sea + 14) continue;
      // (The sea under it: towards the south, or out along the headland, within a short way.)
      let facing = NaN, drop = 0;
      for (let a = 0; a < 16; a++) {
        const an = (a / 16) * Math.PI * 2, d = nat(x + Math.cos(an) * 18, z + Math.sin(an) * 18);
        if (d < sea && y - d > drop) { drop = y - d; facing = an; }
      }
      if (!Number.isFinite(facing)) continue;
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 8; a++) { const v = nat(x + Math.cos(a * 0.785) * 5, z + Math.sin(a * 0.785) * 5); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi - lo > 4 || t.blocks.some((b) => outsideRect(b, x, z) < 30)) continue;
      const score = y - sea - (hi - lo) * 2 + q.range(0, 3);
      if (!best || score > best.score) best = { x, z, y, facing, score };
    }
    if (best) t.outlook = { x: round(best.x), z: round(best.z), y: round(best.y + 0.1), facing: Math.round(best.facing * 100) / 100 };
  }

  // ---- fields outside the town: parcels on a grid of their own, square to the town's, on gentle dry ground clear of it
  {
    const q = rng.fork('fields'), crops = ['wheat', 'wheat', 'barley', 'oats', 'fallow', 'pasture', 'pasture', 'roots', 'orchard', 'vines'] as const;
    const townBox = { x0: Math.min(...t.blocks.map((b) => b.x0), t.square.x0) - 14, x1: Math.max(...t.blocks.map((b) => b.x1), t.square.x1) + 14, z0: Math.min(...t.blocks.map((b) => b.z0), level.z0) - 14, z1: qz + 8 };
    const fx = q.range(46, 62), fz = q.range(38, 54);
    for (let z = box.z0 + 50; z < qz; z += fz) for (let x = box.x0 + 50; x < box.x1 - 50; x += fx) {
      const c: [number, number][] = [[x, z], [x + fx, z], [x + fx, z + fz], [x, z + fz]].map(([a, b]) => [round(a + q.range(-4, 4)), round(b + q.range(-4, 4))]);
      const mx = x + fx / 2, mz = z + fz / 2;
      if (outsideRect(townBox, mx, mz) < Math.max(fx, fz) * 0.55 || t.shacks.some((s) => Math.hypot(s.x - mx, s.z - mz) < fx * 0.6)) continue;
      if (t.outlook && Math.hypot(t.outlook.x - mx, t.outlook.z - mz) < 60) continue;
      let ok = true;
      for (const [px, pz] of [...c, [mx, mz] as [number, number]]) if (nat(px, pz) < sea + 2 || slopeAt(px, pz, 6) > 0.17) ok = false;
      if (!ok || q.chance(0.12)) continue;
      // (Neighbours often grow the same: a crop is kept from the field to the west half the time.)
      const prev = t.fields[t.fields.length - 1];
      const crop = prev && q.chance(0.4) && Math.abs(prev.corners[0][1] - c[0][1]) < 6 ? prev.crop : q.pick([...crops]);
      t.fields.push({ corners: c, crop });
    }
    // Walls of dry stone along some of the fields' north and west sides, with a gap in each: about the fields nearer the town, where they
    // are walked past and seen close. (A wall is some sixteen thousand faces of stone: a hundred of them were a third of a town's.)
    for (const f of t.fields) for (const [a, b] of [[0, 1], [3, 0]] as const) {
      const fx = f.corners.reduce((sum, c) => sum + c[0], 0) / 4, fz = f.corners.reduce((sum, c) => sum + c[1], 0) / 4;
      if (Math.hypot(fx - qx, fz - (qz - 60)) > 260 || !q.chance(0.5)) continue;
      const [ax, az] = f.corners[a], [bx, bz] = f.corners[b], len = Math.hypot(bx - ax, bz - az), g = q.range(0.2, 0.8);
      const gaps: [number, number][] = [[round(g * len - 2), round(g * len + 2)]];
      const fallen: [number, number][] = q.chance(0.25) ? [[round(q.range(0, len - 6)), 0]] : [];
      if (fallen.length) fallen[0][1] = round(fallen[0][0] + q.range(2, 5));
      t.walls.push({ line: [[ax, az], [bx, bz]], gaps, fallen, height: round(q.range(0.9, 1.25)) });
    }
  }

  // ---- the great hall in the rock: under the headland, its windows through the sea cliff, where the land stands high enough over
  // the water; otherwise deep in the highest hill, without windows. Its stair comes down from a portal in the open ground.
  layHall(t, F, rng.fork('hall'), nat, level);

  // ---- tracks out of the town: along the shore either way from the waterfront's ends, and up from the town's top to the fields
  // above it; and the path to the outlook. Routed over the land by least effort, as tracks are worn.
  {
    const C = 4, gx0 = box.x0 + 30, gz0 = box.z0 + 30, gnx = Math.round((box.x1 - box.x0 - 60) / C) + 1, gnz = Math.round((box.z1 - box.z0 - 60) / C) + 1;
    const hgt = new Float32Array(gnx * gnz), wet = new Uint8Array(gnx * gnz), built = new Uint8Array(gnx * gnz);
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
      const x = gx0 + i * C, z = gz0 + j * C, k = j * gnx + i;
      hgt[k] = nat(x, z); wet[k] = hgt[k] < sea + 0.8 || inHarbour(t, x, z) ? 1 : 0;
      built[k] = t.buildings.some((b) => outsideBuilt(b, x, z) < 2) || t.shacks.some((s) => Math.hypot(s.x - x, s.z - z) < Math.max(s.w, s.d)) || outsideRect(level, x, z) < 2 ? 1 : 0;
    }
    const cost = (a: number, b: number) => {
      if (wet[b] || built[b]) return Infinity;
      const run = Math.hypot((a % gnx) - (b % gnx), Math.floor(a / gnx) - Math.floor(b / gnx)) * C, grade = Math.abs(hgt[b] - hgt[a]) / run;
      return grade > 0.5 ? Infinity : run * (1 + 30 * grade * grade);
    };
    const route = (from: [number, number], to: [number, number], width: number, kind: 'track' | 'path') => {
      const p = leastPath(gx0, gz0, C, gnx, gnz, from, to, cost);
      if (!p || p.length < 3) return;
      const line = smoothLine(p, 2).filter((_, k, all) => k % 2 === 0 || k === all.length - 1);
      // (Its level: the land's, smoothed along it so that it climbs evenly.)
      const ys = line.map(([x, z]) => nat(x, z));
      const even = ys.map((_, k) => { let s = 0, n = 0; for (let d = -3; d <= 3; d++) { const v = ys[k + d]; if (v !== undefined) { s += v; n++; } } return s / n; });
      // (And never steeper than a path can be, where smoothing has left a short steep stretch.)
      for (let k = 1; k < even.length; k++) { const run = Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]); even[k] = Math.min(even[k - 1] + run * 0.45, Math.max(even[k - 1] - run * 0.45, even[k])); }
      t.streets.push({ line: line.map(([x, z], k) => [round(x), round(z), Math.round(Math.max(sea + 0.6, even[k]) * 100) / 100]), width, kind });
    };
    // Along the shore, from each end of the waterfront, as far as the land goes.
    for (const side of [-1, 1]) {
      const sx = side < 0 ? t.quay.x0 - 3 : t.quay.x1 + 3, sz = qz - apron / 2;
      let ex = qx + side * 400, ez = qz - 60;
      for (let z = qz - 140; z < qz - 20; z += 10) if (nat(ex, z) > sea + 2 && nat(ex, z) < sea + 40 && slopeAt(ex, z) < 0.2) { ez = z; break; }
      route([sx, sz], [ex, ez], 3.6, 'track');
    }
    // Up from the top of the town.
    const topStreet = t.streets.filter((s) => s.kind === 'street').reduce((m, s) => (Math.min(...s.line.map((p) => p[1])) < Math.min(...m.line.map((p) => p[1])) ? s : m), t.streets[0]);
    const top = topStreet.line.reduce((m, p) => (p[1] < m[1] ? p : m));
    route([top[0], top[1]], [top[0] + rng.fork('up').range(-80, 80), box.z0 + 60], 3.4, 'track');
    // To the hall's portal, from the nearest end of a street or track.
    if (t.hall) {
      const [px, pz] = t.hall.stair[0];
      let from: [number, number] = [qx, qz - apron / 2], fd = Infinity;
      for (const s of t.streets) for (const p of [s.line[0], s.line[s.line.length - 1]]) { const d = Math.hypot(p[0] - px, p[1] - pz); if (d < fd) { fd = d; from = [p[0], p[1]]; } }
      route(from, [px, pz], 2, 'path');
    }
    // To the outlook, from the nearest end of a street or track.
    if (t.outlook) {
      let from: [number, number] = [qx, qz - apron / 2], fd = Infinity;
      for (const s of t.streets) for (const p of [s.line[0], s.line[s.line.length - 1]]) { const d = Math.hypot(p[0] - t.outlook.x, p[1] - t.outlook.z); if (d < fd) { fd = d; from = [p[0], p[1]]; } }
      outlookFrom = from;
      route(from, [t.outlook.x, t.outlook.z], 1.8, 'path');
    }
  }
  void outlookFrom;

  // ---- what the rest of the program reads: the walkable box, the way from the door to where the player arrives, the paths
  site.town = t;
  site.grounds = { x0: box.x0 + 30, x1: box.x1 - 30, z0: box.z0 + 30, z1: box.z1 - 30 };
  const lm = t.light ? t.moles.reduce((m, q) => (Math.hypot(q.line[q.line.length - 1][0] - t.light!.x, q.line[q.line.length - 1][1] - t.light!.z) < Math.hypot(m.line[m.line.length - 1][0] - t.light!.x, m.line[m.line.length - 1][1] - t.light!.z) ? q : m)) : t.moles[0];
  // From the door: down the stair, across the square, out along the quay to the root of the mole, and along it to its head.
  const mid = (t.stair.x0 + t.stair.x1) / 2;
  site.track = [[doorX, meadow.z0], [mid, meadow.z1 - 2], [mid, t.square.z1], [mid, qz - apron / 2], [lm.line[0][0], qz - apron / 2], ...lm.line.slice(1).map(([x, z]) => [x, z] as [number, number])].map(([x, z]) => [round(x), round(z)] as [number, number]);
  site.paths = t.streets.filter((s) => s.kind === 'path').map((s) => ({ points: s.line.map(([x, z]) => [x, z] as [number, number]), to: t.hall && Math.hypot(s.line[s.line.length - 1][0] - t.hall.stair[0][0], s.line[s.line.length - 1][1] - t.hall.stair[0][1]) < 3 ? 'gallery' as const : 'summit' as const }));
}

// ---- for maps

/** The part of a town worth drawing on a map: its blocks, square, harbour, waterfront, storehouses and outlook, with a margin. */
export function townBounds(t: Town, margin = 40): Rect {
  const pts: [number, number][] = [[t.square.x0, t.square.z0], [t.square.x1, t.square.z1], [t.level.x0, t.level.z0], [t.level.x1, t.level.z1], ...t.blocks.flatMap((b): [number, number][] => [[b.x0, b.z0], [b.x1, b.z1]]), ...t.moles.flatMap((m) => m.line), ...t.storehouses.map((s): [number, number] => [s.x, s.z])];
  if (t.outlook) pts.push([t.outlook.x, t.outlook.z]);
  return { x0: Math.min(...pts.map((p) => p[0])) - margin, x1: Math.max(...pts.map((p) => p[0])) + margin, z0: Math.min(...pts.map((p) => p[1])) - margin, z1: Math.max(...pts.map((p) => p[1])) + margin };
}

/**
 * The coast as a map draws it: for each `step` of x from `x0` to `x1`, where the land meets the sea, coming in from the south (the
 * sea lies south of every town). Bays that run in behind a headland are drawn as if the headland were not there; at this scale it is
 * near enough.
 */
export function coastLine(t: Town, floor: number, x0: number, x1: number, z0: number, z1: number, step = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    let z = z1;
    while (z > z0 && townGround(t, floor, x, z) < t.sea) z -= 1;
    out.push([x, z]);
  }
  return out;
}

/** A building's outline on the ground, wings and all, as polygons of the site's points. */
export function outlineOf(b: Building): [number, number][][] {
  return footprintOf(b).map((r) => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].map(([u, v]) => fromBuilding(b, u, v)));
}

/**
 * A great hall in the rock outside the town, laid out as a mountain top's is (`layHall` in `mountain.ts`), but found otherwise: first
 * where the sea has cut a cliff high enough into a headland that a hall's vault can stand behind its face with rock over it, its
 * windows cut through the face over the water; failing that, deep under the highest hill in the town's country, with no windows. Its
 * stair comes down from a portal in the open ground, away from the town, at no more than one in two.
 */
function layHall(t: Town, F: number, rng: Rng, nat: (x: number, z: number) => number, level: Rect): void {
  // (As large a hall as the rock will hold: the largest first, down to one just tall enough for its gallery.)
  for (const [wide, high, long] of [[20, 21, 50], [18, 19, 42], [16, 17, 34]]) {
    if (layHallOf(t, F, rng.fork(`hall${long}`), nat, level, round(wide + rng.range(-1, 1)), round(high + rng.range(0, 1)), round(long + rng.range(-4, 4)))) return;
  }
}
function layHallOf(t: Town, F: number, rng: Rng, nat: (x: number, z: number) => number, level: Rect, WIDE: number, HIGH: number, LONG: number): boolean {
  const L = t.land, sea = t.sea, ground = (x: number, z: number) => nat(x, z), SLOPE = 0.48;
  void F;
  const away = (x: number, z: number, m: number) => !t.blocks.some((b) => outsideRect(b, x, z) < m) && outsideRect(level, x, z) > m && !t.buildings.some((b) => outsideBuilt(b, x, z) < m) && !t.storehouses.some((q) => Math.hypot(q.x - x, q.z - z) < m + 6) && !t.shacks.some((q) => Math.hypot(q.x - x, q.z - z) < m);
  const inLand = (x: number, z: number, m: number) => x > L.x0 + m && x < L.x1 - m && z > L.z0 + m && z < L.z1 - m;
  type Try = { ox: number; oz: number; a: number; floor: number; windows: boolean; score: number };
  const tries: Try[] = [];
  // Rock enough over the hall and its side halls, for a hall whose window end is at (ox, oz), running in along bearing `a`.
  const covered = (ox: number, oz: number, a: number, floor: number, long: number) => {
    const ux = Math.cos(a), uz = Math.sin(a), at = (u: number, v: number): [number, number] => [ox + ux * u - uz * v, oz + uz * u + ux * v];
    for (let u = 2; u <= long; u += 4) for (const v of [-WIDE / 2 - 2, 0, WIDE / 2 + 2]) { const [x, z] = at(u, v); if (!inLand(x, z, 30) || ground(x, z) < floor + HIGH + 3 || !away(x, z, 12)) return false; }
    for (const side of [-1, 1]) for (let d = 0; d <= 14; d += 3.5) { const [x, z] = at(long * 0.5, side * (WIDE / 2 + d)); if (ground(x, z) < floor + 10) return false; }
    return true;
  };
  // In a headland: along the coast, wherever the cliff stands high, a hall running in from its face.
  for (let x = L.x0 + 60; x < L.x1 - 60; x += 6) {
    let z = L.z1 - 40;
    while (z > L.z0 + 40 && ground(x, z) < sea) z -= 1;
    if (z <= L.z0 + 40 || ground(x, z - 8) < sea + HIGH + 4) continue;
    if (inHarbour(t, x, z + 4) || Math.abs(x - (t.quay.x0 + t.quay.x1) / 2) < (t.quay.x1 - t.quay.x0) / 2 + 40) continue;
    // (In along the land's rise from the face.)
    const gx = ground(x + 6, z - 8) - ground(x - 6, z - 8), gz = ground(x, z - 2) - ground(x, z - 14);
    const a = Math.atan2(-Math.abs(gz) - 0.3, gx * 0.6);
    const floor = round(sea + rng.range(3.5, 6)), ox = x + Math.cos(a) * 1.5, oz = z + Math.sin(a) * 1.5;
    // (The windows look out over the water, or at least over ground well below them.)
    if (ground(ox - Math.cos(a) * 6, oz - Math.sin(a) * 6) > floor + 0.5) continue;
    if (covered(ox, oz, a, floor, LONG)) tries.push({ ox, oz, a, floor, windows: true, score: ground(x, z - 8) - sea + rng.range(0, 6) });
  }
  // In a hill: under the highest ground in the country, with no windows, its floor deep enough.
  if (!tries.length) for (let k = 0; k < 400; k++) {
    const ox = rng.range(L.x0 + 80, L.x1 - 80), oz = rng.range(L.z0 + 80, L.z1 - 80), a = rng.range(0, Math.PI * 2);
    const ux = Math.cos(a), uz = Math.sin(a);
    let low = Infinity;
    for (let u = 0; u <= LONG; u += 8) for (const v of [-WIDE / 2 - 2, WIDE / 2 + 2]) low = Math.min(low, ground(ox + ux * u - uz * v, oz + uz * u + ux * v));
    const floor = round(low - HIGH - 5);
    if (floor < sea + 2) continue;
    if (covered(ox, oz, a, floor, LONG)) tries.push({ ox, oz, a, floor, windows: false, score: -floor * 0.1 + rng.range(0, 4) });
  }
  for (const best of tries.sort((p, q) => q.score - p.score).slice(0, 12)) {
    const { ox, oz, a, floor } = best, ux = Math.cos(a), uz = Math.sin(a), at = (u: number, v: number): [number, number] => [ox + ux * u - uz * v, oz + uz * u + ux * v];
    const [ix, iz] = at(LONG, 0);
    // (Its chasm no deeper than to a metre over the sea: below that the sea's own face would show in it.)
    const chasm = { at: round(LONG * rng.range(0.44, 0.54)), width: LONG < 40 ? 6 : 7, depth: round(Math.max(3, Math.min(14, floor - t.sea - 1))) };
    const first: -1 | 1 = rng.chance(0.5) ? 1 : -1;
    const sides: NonNullable<Town['hall']>['sides'] = [
      { at: round(chasm.at * 0.45), side: first, long: round(rng.range(10, 14)), wide: round(Math.min(LONG * 0.22, rng.range(9, 11))) },
      { at: round(chasm.at + (LONG - chasm.at) * 0.5), side: first === 1 ? -1 : 1, long: round(rng.range(10, 14)), wide: round(Math.min(LONG * 0.22, rng.range(9, 11))) },
    ];
    // A shaft of daylight down into a side hall, where open ground lies over it.
    for (const sh of sides) { const [x, z] = at(sh.at, sh.side * (WIDE / 2 + sh.long / 2)); if (away(x, z, 14) && (!t.outlook || Math.hypot(t.outlook.x - x, t.outlook.z - z) > 14)) { sh.shaft = 2.2; break; } }
    // The stair: from open ground, down to a turn beside the hall's near end, and from there in to it.
    let done = false;
    for (const turn of [-1, 1]) {
      if (done) break;
      const [tx, tz] = at(LONG + 6, turn * (WIDE / 2 + 6));
      const options: { x: number; z: number; y: number; score: number }[] = [];
      for (let k = 0; k < 24; k++) {
        const b2 = a + ((k / 24) * 2 - 1) * (Math.PI / 1.6);
        for (const run of [40, 50, 62, 76]) {
          const sx = tx + Math.cos(b2) * run, sz = tz + Math.sin(b2) * run, sy = ground(sx, sz), total = run + Math.hypot(tx - ix, tz - iz);
          if (!inLand(sx, sz, 40) || sy < sea + 2 || (sy - floor) / total > SLOPE || !away(sx, sz, 10)) continue;
          if (Math.abs(ground(sx + Math.cos(b2) * 4, sz + Math.sin(b2) * 4) - sy) > 1.6) continue;
          options.push({ x: sx, z: sz, y: sy, score: -run - Math.abs(k - 11.5) * 0.6 + rng.next() * 4 });
        }
      }
      for (const o of options.sort((p, q) => q.score - p.score)) {
        const legs: [number, number][] = [[o.x, o.z], [tx, tz], [ix, iz]];
        const total = Math.hypot(tx - o.x, tz - o.z) + Math.hypot(ix - tx, iz - tz), stair: [number, number, number][] = [];
        let walked = 0;
        for (let leg = 0; leg < 2; leg++) {
          const [ax, az] = legs[leg], [bx, bz] = legs[leg + 1], l = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(l / 2));
          for (let i = leg ? 1 : 0; i <= n; i++) { const s = i / n, d = walked + l * s; stair.push([round(ax + (bx - ax) * s), round(az + (bz - az) * s), round(o.y + (floor - o.y) * (d / total))]); }
          walked += l;
        }
        // (Never out of the ground on the way down, once it is under it; nor under anything built near the surface.)
        if (stair.some(([x, z, y]) => !away(x, z, 3) && ground(x, z) - y < 8)) continue;
        let under = false, bad = false;
        for (const [x, z, y] of stair) { const cover = ground(x, z) - y; if (cover > 4) under = true; else if (under && cover < 3.2) bad = true; }
        if (bad) continue;
        t.hall = { out: [round(ox), round(oz)], in: [round(ix), round(iz)], floor, wide: WIDE, high: HIGH, long: LONG, stair, windows: best.windows ? [-WIDE * 0.32, 0, WIDE * 0.32].map(round) : [], chasm, sides, gallery: { side: first } };
        done = true;
        break;
      }
    }
    if (done) return true;
  }
  return false;
}
