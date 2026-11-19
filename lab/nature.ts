// What grows and what lies about, for the building lab: trees, bushes and boulders set out one by one as buildings are, and what
// is laid with a brush: grass, flowers, ferns, reeds and woods; masses of rock, raised or dug; and the ground itself, from the
// square's flags to turf, bare earth, mud, shingle, a cart track, a footpath, setts and gravel. All of it is made by the game's own
// planting, carving and ground material, and carries what the game's geometry carries, so that it looks here as it does in a
// valley or a town. Only the arrangement is the lab's.
import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../src/core/rng';
import { Stone } from '../src/core/site';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { carveRock, smax, smin } from '../src/render/geom/rock';
import { boulderForm, cliffRelief, ROCK, Strata } from '../src/render/geom/rockForms';
import { stoneStyles } from '../src/render/geom/styles';
import { turfColour } from '../src/render/landscape';
import { Colour, growConifer, growTree, Planting } from '../src/render/planting';
import { CardSet } from '../src/render/scene';

export type Season = 'spring' | 'summer' | 'autumn';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn'];

/** The trees one can set out: as the valley grows them. A bush is a small oak, which is what the valley's thickets are made of. */
export const TREES = ['oak', 'ash', 'old oak', 'spruce', 'pine', 'coast pine', 'bush'] as const;
export type TreeKind = (typeof TREES)[number];
/** A tree's own measures: how tall, how thick its trunk at the foot, how far its boughs spread (oak and ash), and which of the season's greens. */
export interface TreeWork { kind: TreeKind; height: number; girth: number; wide: number; leaf: number }
/** How far each of a tree's measures may go, by kind, and what it is dealt between. */
export const TREE_RANGES: Record<TreeKind, { height: [number, number]; girth: [number, number]; wide: [number, number] }> = {
  oak: { height: [5, 14], girth: [0.15, 0.5], wide: [0.8, 1.6] },
  ash: { height: [6, 16], girth: [0.14, 0.4], wide: [0.8, 1.4] },
  'old oak': { height: [7, 13], girth: [0.4, 0.7], wide: [1.2, 1.7] },
  spruce: { height: [5, 20], girth: [0.12, 0.35], wide: [1.6, 3.4] },
  pine: { height: [7, 20], girth: [0.16, 0.4], wide: [2, 3.6] },
  'coast pine': { height: [6, 14], girth: [0.16, 0.36], wide: [2, 3.4] },
  bush: { height: [1, 3.5], girth: [0.025, 0.07], wide: [0.8, 1.3] },
};
export const TREE_DEALT: Record<TreeKind, { height: [number, number]; girth: [number, number]; wide: [number, number] }> = {
  oak: { height: [7, 10.5], girth: [0.24, 0.36], wide: [1, 1] },
  ash: { height: [9, 12.5], girth: [0.2, 0.28], wide: [1, 1] },
  'old oak': { height: [9.5, 11], girth: [0.5, 0.6], wide: [1.4, 1.5] },
  spruce: { height: [9, 14], girth: [0.18, 0.25], wide: [2.1, 2.8] },
  pine: { height: [11, 16], girth: [0.24, 0.32], wide: [2.8, 2.8] },
  'coast pine': { height: [9, 12], girth: [0.24, 0.3], wide: [2.6, 2.6] },
  bush: { height: [1.6, 2.8], girth: [0.035, 0.05], wide: [1, 1] },
};
/** How far a tree's crown reaches from its trunk, near enough, for picking it and for keeping others off it. */
export const crownOf = (t: TreeWork): number => (t.kind === 'spruce' || t.kind.endsWith('pine') ? t.wide : t.kind === 'bush' ? t.height * 0.45 * t.wide : t.height * 0.32 * t.wide);

/** The season's greens for leaves (spring is the freshest, autumn turns), and how far the grass has dried. */
function greensOf(season: Season): Colour[] {
  return season === 'autumn' ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
    : season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]]
    : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
}
const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
const OAK_BARK: Colour = [0.66, 0.58, 0.5], ASH_BARK: Colour = [0.86, 0.84, 0.8], FIR_BARK: Colour = [0.62, 0.5, 0.42], PINE_BARK: Colour = [0.98, 0.6, 0.42];
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** One tree grown at `x`, `y`, `z` into `pl` and the bark meshes (`bark`, `barkAsh`, `barkPine`, `barkFir`), as the valley grows it. Returns how far it reaches. */
function growAt(pl: Planting, to: (name: string) => MeshBuilder, t: TreeWork, season: Season, x: number, y: number, z: number, q: Rng, keepOut?: (p: Vector3) => boolean): number {
  const greens = greensOf(season), leaf = leafOf(greens[Math.abs(Math.round(t.leaf)) % greens.length]);
  if (t.kind === 'oak' || t.kind === 'old oak') return growTree(pl, to('bark'), x, y, z, t.height, t.girth, { kind: 'oak', detail: 1, cards: t.kind === 'old oak' ? 2500 : 1500, cardSize: t.kind === 'old oak' ? 0.8 : 0.74, wide: t.wide, leaf, bark: OAK_BARK, shaded: true, soft: to('bark'), keepOut }, q);
  if (t.kind === 'ash') return growTree(pl, to('barkAsh'), x, y, z, t.height, t.girth, { kind: 'ash', detail: 1, cards: 1500, cardSize: 0.74, wide: t.wide, leaf, bark: ASH_BARK, shaded: true, soft: to('barkAsh'), keepOut }, q);
  if (t.kind === 'spruce') return growConifer(pl, to('barkFir'), x, y, z, t.height, t.wide, t.girth, { kind: 'spruce', detail: 1, needle: leafOf([0.045, 0.13, 0.04]), bark: FIR_BARK, shaded: true, soft: to('barkFir'), keepOut }, q);
  if (t.kind === 'pine' || t.kind === 'coast pine') return growConifer(pl, to('barkPine'), x, y, z, t.height, t.wide, t.girth, { kind: 'pine', coastal: t.kind === 'coast pine', detail: 1, needle: leafOf(t.kind === 'pine' ? [0.07, 0.15, 0.07] : [0.08, 0.16, 0.06]), bark: t.kind === 'pine' ? PINE_BARK : [0.8, 0.62, 0.5], shaded: true, soft: to('barkPine'), keepOut }, q);
  return growTree(pl, to('bark'), x, y - 0.05, z, t.height, t.girth, { kind: 'oak', detail: 0.5, cards: 64, cardSize: 0.52, wide: t.wide, leaf, bark: OAK_BARK, shaded: true, keepOut }, q);
}

/** One tree, standing at the origin: its bark into the meshes by name, its leaves as cards. Its boughs keep out of `keepOut`. */
export function growOne(t: TreeWork, season: Season, rng: Rng, mesh: (material: string) => MeshBuilder, keepOut?: (p: Vector3) => boolean): { cards: CardSet[]; reach: number } {
  const pl = new Planting();
  const reach = growAt(pl, mesh, t, season, 0, 0, 0, rng, keepOut);
  return { cards: pl.sets, reach };
}

/** The colour of weathered rock of a stone, and how it is shaded: as the valley's cliffs and boulders are. */
function rockShading(stone: Stone, rng: Rng) {
  const kind = ROCK[stone], tint = stoneStyles(stone).tint;
  // (As in the valley: weathered rock in the open is greyer than the same stone cut for a house.)
  const outcrop: Colour = [0.5 + 0.5 * tint[0], 0.52 + 0.5 * tint[1], 0.56 + 0.5 * tint[2]];
  const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
  const strata = new Strata(kind, rng.fork('strata'), 0), blotSeed = rng.fork('blot').int(1, 9999);
  const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number, coarse = false): Colour => {
    const u = strata.at(q.x, q.y, q.z), i = Math.floor(u);
    const t = coarse ? 0.55 : strata.shade(i), soft = coarse ? 0.3 : 1 - strata.hardness(i);
    const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed);
    const rust = smooth((fbm3(q.x * 0.17 + 9, q.y * 0.4, q.z * 0.17, 3, blotSeed + 3) - 0.6) / 0.14);
    const c = rockColour((0.72 + 0.56 * blot) * (0.7 + 0.3 * open));
    c[0] *= (kind.dark[0] + (kind.pale[0] - kind.dark[0]) * t) * (1 + 0.22 * rust);
    c[1] *= (kind.dark[1] + (kind.pale[1] - kind.dark[1]) * t) * (1 - 0.02 * rust);
    c[2] *= (kind.dark[2] + (kind.pale[2] - kind.dark[2]) * t) * (1 - 0.22 * rust);
    field[0] = Math.min(1, Math.max(0, n.y) * 0.9 + soft * 0.35 * (1 - open) + (1 - open) * 0.2);
    field[1] = Math.min(1, (1 - open) * 0.25 + soft * 0.3 * smooth((blot - 0.45) / 0.2));
    field[3] = 0.25 + 0.75 * kind.bedded;
    return c;
  };
  return { kind, strata, rockColour, shadeRock };
}

/** One boulder of the country's stone, `size` metres or so across, sitting on level ground at the origin: as the valley's are. */
export function boulderOne(stone: Stone, size: number, rng: Rng, mesh: (material: string) => MeshBuilder): void {
  const { kind, rockColour } = rockShading(stone, rng.fork('rock'));
  const form = boulderForm(rng, size, kind), ts = rng.range(0, 60);
  const cy = form.half * rng.range(0.3, 0.75), cell = Math.min(0.26, Math.max(0.08, size * 0.14));
  carveRock(mesh('rock'), (qx, qy, qz) => form.density(qx, qy - cy, qz), {
    min: V(-form.reach, Math.max(-0.4, cy - form.sink), -form.reach), max: V(form.reach, cy + form.rise, form.reach),
    cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
    shade: (c, n, field, _other, open) => {
      const h = c.y;
      field[0] = Math.min(1, Math.max(0, n.y) * 0.95 + (1 - open) * 0.3);
      field[1] = 0.45 * (1 - smooth(h / 0.3));
      field[3] = 0.35;
      const tone = (0.7 + 0.5 * fbm3(c.x * 1.1 + ts, c.y * 1.1, c.z * 1.1, 3)) * (0.66 + 0.34 * open) * (0.75 + 0.25 * smooth(h / 0.25));
      const t = form.bedShade!(c.x, c.y - cy, c.z), col = rockColour(tone);
      for (let k = 0; k < 3; k++) col[k] *= 0.3 + 0.7 * (kind.dark[k] + (kind.pale[k] - kind.dark[k]) * t);
      return col;
    },
  });
}

/** What the plant brush lays: the low things in drifts, the trees one by one at their distance, a wood a mixture of them. */
export const PLANT_PAINTS = ['grass', 'flowers', 'ferns', 'reeds', 'wood', 'oak', 'ash', 'spruce', 'pine', 'bush'] as const;
/** What the ground brush lays. Flags are what the square is laid with, so they are what painting them puts back. */
export const GROUND_PAINTS = ['flags', 'setts', 'gravel', 'turf', 'earth', 'mud', 'track', 'path'] as const;
export type GroundPaint = (typeof GROUND_PAINTS)[number];

/**
 * What is laid with the brushes, as numbers so that it can be kept and saved: the ground's dabs (`x`, `z`, radius, which of
 * `GROUND_PAINTS`, and the stroke it belongs to), the plants' (`x`, `y`, `z`, radius, which of `PLANT_PAINTS`, nothing, and a
 * number of its own that everything in it is grown from), and the rock's balls (`x`, `y`, `z`, radius, 1 to raise and -1 to dig).
 */
export interface Painted { ground: number[][]; plants: number[][]; rock: number[][] }

/** The makers of what is painted, for a country's stone and a season. */
export function natureKit(o: { stone: Stone; season: Season }) {
  const rng = new Rng(`lab/nature/${o.stone}`), s1 = rng.fork('s1').int(1, 999), s2 = rng.fork('s2').int(1, 999);
  const { kind, strata, shadeRock } = rockShading(o.stone, rng);
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999)), reliefSeed = rng.fork('relief').int(1, 9999);

  /**
   * Rock where the brush laid it: balls that run together where they touch, less whatever balls were dug out of them, broken as a
   * cliff is and of the same stone. The larger the whole, the coarser it is carved, so that a hill takes no longer than a boulder.
   */
  const carveMass = (balls: number[][]): MeshBuilder | null => {
    const adds = balls.filter((b) => b[4] > 0), digs = balls.filter((b) => b[4] < 0);
    if (!adds.length) return null;
    const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
    let least = Infinity, most = 0;
    for (const [x, y, z, r] of adds) { lo.min(V(x - r, y - r, z - r)); hi.max(V(x + r, y + r, z + r)); least = Math.min(least, r); most = Math.max(most, r); }
    const room = Math.min(4, most);
    lo.addScalar(-room); hi.addScalar(room);
    lo.y = Math.max(lo.y, -1);
    // (Nothing of it above the ground: nothing to carve.)
    if (hi.y <= lo.y + 0.1) return null;
    const size = hi.clone().sub(lo);
    const cell = Math.max(Math.max(0.08, Math.min(0.3, most / 5)), Math.cbrt((size.x * size.y * size.z) / 1.0e6));
    for (const k of ['x', 'y', 'z'] as const) lo[k] = Math.floor(lo[k] / cell) * cell;
    const coarse = cell > 0.6, rel = coarse ? cliffRelief(strata, reliefSeed, cell) : relief;
    // (Small lumps are broken less deeply than a hill, or they would be all relief and no lump.)
    const k = Math.max(cell, least * 0.6), deep = Math.min(1, most / 5);
    const air = (x: number, y: number, z: number): number => {
      let d = 1e9;
      for (const b of adds) { const di = Math.hypot(x - b[0], y - b[1], z - b[2]) - b[3]; if (di < d + k) d = smin(d, di, k); }
      for (const b of digs) { const di = b[3] - Math.hypot(x - b[0], y - b[1], z - b[2]); if (di > d - k) d = smax(d, di, k); }
      if (d > 4.5 || d < -4.5) return d;
      return d - (Math.min(2.4, Math.max(-2.4, rel.broad(x, y, z))) + Math.min(1.5, Math.max(-1.5, rel.fine(x, y, z)))) * deep;
    };
    const mass = new MeshBuilder(), mossSeed = s1 * 0.37;
    carveRock(mass, air, {
      min: lo, max: hi, cell, uvScale: 0.4, fromSamples: true, occlusion: [cell, cell * 2.5], sharp: true, crease: 36 + 24 * kind.round, normalReach: cell * 0.5,
      keep: (c) => c.y > -0.6,
      shade: (q, n, field, _other, open) => {
        const c = shadeRock(q, n, field, open, coarse);
        // (What lies back far enough to hold soil is green, in patches.)
        field[0] = Math.max(field[0], 2.6 * smooth((n.y - 0.72) / 0.16) * smooth((fbm2(q.x * 0.09 + mossSeed, q.z * 0.09, 3) - 0.36) / 0.2));
        return c;
      },
    });
    return mass;
  };

  /**
   * Grows what the plant brush laid. Everything in a dab follows from its own number, so the same dabs always grow the same plants;
   * `heightAt` says how high the ground stands at a spot (on the square, or on rock), or null where nothing can grow. Trees keep their
   * distance from trees already standing.
   */
  const growPainted = (dabs: number[][], heightAt: (x: number, z: number) => number | null, keepOut?: (p: Vector3) => boolean) => {
    const grown = new Map<string, MeshBuilder>();
    const to = (name: string): MeshBuilder => { let m = grown.get(name); if (!m) grown.set(name, (m = new MeshBuilder())); return m; };
    const pl = new Planting();
    const SPACE: Record<string, number> = { oak: 7, ash: 6.5, pine: 6.5, spruce: 4.5, bush: 2.4, wood: 5, grass: 0.42, flowers: 0.7, ferns: 0.9, reeds: 0.35 };
    const hues: Colour[] = [[0.25, 0.5, 1.5], [1.4, 0.4, 0.8], [1.3, 1.3, 1.2], [1.5, 1.1, 0.2]];
    const fern: Colour = o.season === 'autumn' ? [0.34, 0.22, 0.05] : [0.1, 0.27, 0.05];
    const parched = o.season === 'autumn' ? 0.55 : o.season === 'summer' ? 0.25 : 0;
    const stood: number[][] = [];
    let count = 0;
    for (const dab of dabs) {
      const [sx, , sz, r, kindAt, , seed] = dab, kind = PLANT_PAINTS[kindAt] ?? 'grass';
      const q = new Rng(`lab/paint/${seed}`), low = kind === 'grass' || kind === 'flowers' || kind === 'ferns' || kind === 'reeds';
      const tries = Math.min(4000, Math.max(1, Math.ceil(((Math.PI * r * r) / (SPACE[kind] * SPACE[kind])) * (low ? 1 : 1.7))));
      for (let k = 0; k < tries; k++) {
        const a = q.range(0, Math.PI * 2), d = r * Math.sqrt(q.next()), x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
        const own = q.fork(`p${k}`);
        const what = kind === 'wood' ? own.pick(['oak', 'oak', 'ash', 'spruce', 'spruce', 'pine', 'bush', 'bush'] as const) : kind;
        if (!low && stood.some((p) => Math.hypot(p[0] - x, p[1] - z) < (p[2] + SPACE[what]) * 0.42)) continue;
        const y = heightAt(x, z);
        if (y === null) continue;
        if (what === 'oak' || what === 'ash' || what === 'spruce' || what === 'pine' || what === 'bush') {
          const deal = TREE_DEALT[what];
          growAt(pl, to, { kind: what, height: own.range(...deal.height), girth: own.range(...deal.girth), wide: own.range(...deal.wide), leaf: own.int(0, 3) }, o.season, x, y, z, own, keepOut);
        } else if (what === 'grass') {
          const c = turfColour(x, z, s1), t = own.range(0.75, 1.2), tall = (0.75 + 0.8 * own.next()) * (0.8 + 0.5 * fbm2(x * 0.3 + s2, z * 0.3 + s1, 2)), dry = Math.min(1, parched + (own.chance(0.08) ? 0.8 : 0));
          pl.tuft(pl.grass, x, y - 0.05, z, own.range(0.4, 0.7) * (0.75 + 0.35 * tall), own.range(0.2, 0.34) * (0.35 + 1.25 * tall), own.range(0, Math.PI), [(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t]);
        } else if (what === 'flowers') {
          const size = own.range(0.3, 0.45);
          pl.tuft(pl.flowers, x, y - 0.02, z, size, size * own.range(0.9, 1.3), own.range(0, Math.PI), hues[Math.floor(fbm2(x * 0.05 + s2, z * 0.05 - s1, 2) * 3.99) % 4]);
        } else if (what === 'reeds') {
          pl.tuft(pl.reeds, x, y - 0.05, z, own.range(0.5, 0.8), own.range(1.1, 1.9), own.range(0, Math.PI), [0.2 * own.range(0.8, 1.2), 0.3, 0.08]);
        } else {
          const size = own.range(0.8, 1.4), t = own.range(0.75, 1.2);
          pl.tuft(pl.ferns, x, y - 0.04, z, size, size * own.range(0.55, 0.8), own.range(0, Math.PI), [fern[0] * t, fern[1] * t, fern[2] * t]);
        }
        if (!low) stood.push([x, z, SPACE[what]]);
        count++;
      }
    }
    return { meshes: grown, cards: pl.sets, count };
  };

  /**
   * What the brush laid on the ground of the square, as a sheet for the game's ground material, half a metre fine within `FINE`
   * metres of the middle: only where something was laid, cut along the true edge of the strokes, so that everywhere else the square
   * is its own paving as it was. Flags are the square itself: laying them takes away what was laid. Each point of the sheet is what
   * the last dab over it laid: setts or gravel (drawn by the material as courses of stones), turf, bare earth, mud, a cart track or a
   * footpath (each as far from the line its stroke drew as the point is). Where setts or gravel meet anything else, each point says
   * how far it is from their edge, so that the material draws the edge where it truly is and not where the sheet's points fall.
   */
  const groundSheet = (dabs: number[][]): MeshBuilder => {
    const N = Math.round((2 * FINE) / CELL) + 1, at = (i: number, j: number) => j * N + i, X = (i: number) => -FINE + i * CELL;
    const paint = new Int8Array(N * N), off = new Float32Array(N * N);
    // How far each point is outside what was laid (less than nothing inside it), and outside the setts and gravel among it: laid dab
    // by dab as shapes are, each disc added to or taken from them, so that their edges are round where the dabs are. (Only near a dab
    // does it matter, so only there is it worked out; elsewhere it is far outside.)
    const region = new Float32Array(N * N).fill(40), paving = new Float32Array(N * N).fill(40);
    const strokes = new Map<number, number[][]>();
    for (const d of dabs) { const s = strokes.get(d[4]) ?? []; s.push(d); strokes.set(d[4], s); }
    const toLine = (pts: number[][], x: number, z: number) => {
      if (pts.length === 1) return Math.hypot(x - pts[0][0], z - pts[0][1]);
      let best = Infinity;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, f = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
        best = Math.min(best, Math.hypot(x - ax - dx * f, z - az - dz * f));
      }
      return best;
    };
    for (const d of dabs) {
      const [x, z, r, p, stroke] = d, kind = GROUND_PAINTS[p] ?? 'flags', lined = kind === 'track' || kind === 'path', paved = kind === 'setts' || kind === 'gravel', reach = r + 2;
      const a = Math.max(0, Math.floor((x - reach + FINE) / CELL)), b = Math.min(N - 1, Math.ceil((x + reach + FINE) / CELL));
      const c = Math.max(0, Math.floor((z - reach + FINE) / CELL)), e = Math.min(N - 1, Math.ceil((z + reach + FINE) / CELL));
      for (let j = c; j <= e; j++) for (let i = a; i <= b; i++) {
        const k = at(i, j), px = X(i), pz = X(j), out = Math.hypot(px - x, pz - z) - r;
        if (kind === 'flags') { region[k] = Math.max(region[k], -out); continue; }
        region[k] = Math.min(region[k], out);
        paving[k] = paved ? Math.min(paving[k], out) : Math.max(paving[k], -out);
        if (out > 0) continue;
        paint[k] = p;
        if (lined) off[k] = toLine(strokes.get(stroke)!, px, pz);
      }
    }
    // The four numbers the ground material reads at each point: the track's or the paving's, how wet, how bare, and what paving.
    const fieldOf = (k: number, x: number, z: number) => {
      const kind = GROUND_PAINTS[paint[k]] ?? 'turf', sd = Math.max(-40, Math.min(40, paving[k])), edge = Math.abs(sd), c = turfColour(x, z, s1);
      let f0 = 0, wet = 0.15, bare = 0, f3 = 0;
      if (sd < 0) { f0 = -(300 + edge); f3 = kind === 'gravel' ? -2 : 0.5; }
      else {
        // (Not paving, but near it: how far outside its edge, so that the edge falls between the points truly.)
        if (edge < 40) f0 = -(300 - edge);
        if (kind === 'earth') bare = 1;
        else if (kind === 'mud') { bare = 1; wet = 1; }
        else if (kind === 'track') f0 = 100 + off[k];
        else if (kind === 'path') f0 = 200 + off[k];
      }
      return [x, 0.012, z, 0, 1, 0, x * 2.3, z * 2.3, c[0], c[1], c[2], f0, wet, bare, f3];
    };
    const sheet = new MeshBuilder(), ids = new Int32Array(N * N).fill(-1), cuts = new Map<string, number>();
    const point = (k: number, i: number, j: number) => { if (ids[k] < 0) { const v = fieldOf(k, X(i), X(j)); ids[k] = sheet.addVertex(...(v as Parameters<MeshBuilder['addVertex']>)); } return ids[k]; };
    // (Where the edge of what was laid crosses between two points, a point of its own on that line, shared by the triangles either side.)
    const cut = (ka: number, ia: number, ja: number, kb: number, ib: number, jb: number) => {
      const key = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
      let id = cuts.get(key);
      if (id === undefined) {
        const t = region[ka] / (region[ka] - region[kb]), va = fieldOf(ka, X(ia), X(ja)), vb = fieldOf(kb, X(ib), X(jb));
        // (Its fields are its nearer end's, so that a track's or the paving's numbers are not blended into others they are not.)
        const v = va.map((q, n) => (n < 11 ? q + (vb[n] - q) * t : t < 0.5 ? q : vb[n]));
        cuts.set(key, (id = sheet.addVertex(...(v as Parameters<MeshBuilder['addVertex']>))));
      }
      return id;
    };
    const tri = (p: [number, number][]) => {
      const ks = p.map(([i, j]) => at(i, j)), inside = ks.map((k) => region[k] <= 0);
      if (!inside.some(Boolean)) return;
      const poly: number[] = [];
      for (let n = 0; n < 3; n++) {
        const m = (n + 1) % 3;
        if (inside[n]) poly.push(point(ks[n], ...p[n]));
        if (inside[n] !== inside[m]) poly.push(cut(ks[n], ...p[n], ks[m], ...p[m]));
      }
      for (let n = 1; n + 1 < poly.length; n++) sheet.addTriangle(poly[0], poly[n], poly[n + 1]);
    };
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      tri([[i, j], [i, j + 1], [i + 1, j]]);
      tri([[i + 1, j], [i, j + 1], [i + 1, j + 1]]);
    }
    return sheet;
  };
  return { carveMass, growPainted, groundSheet };
}
/** How far from the middle of the square the ground can be painted, and how finely it is laid there. */
export const FINE = 64, CELL = 0.5;
