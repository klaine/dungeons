import { Rng, valueNoise2 } from './rng';
import { fbmd, HeightField, leastPath, ridgedFbm, smoothLine, wearByFrost, wearByWater, Wear } from './terrain';
import { findIslands, IslandSpot } from './archipelago';
import { findValleys, ValleySpot } from './highlands';
import { Namer } from './names';

/**
 * A world: one stretch of country, forty-eight kilometres square, in which every kind of place
 * is found rather than drawn. From the sea's side: open sea; a shelf with islands on it; the
 * coast; low country of fields and woods; an upland cut by glens; and at the back a high range,
 * with a few great peaks standing over it. One sea level for all of it, heights in metres over
 * the sea.
 *
 * It is made as the islands' and the valleys' frames are (`archipelago.ts`, `highlands.ts`), a
 * level up: the plain shape first, from noise, each zone with its own kind of land and the zones
 * blended where they meet; then worn by water and frost on a coarse lattice, so that rivers drain
 * it from the range to the sea; then what lies on it read from what is there (the sea, rivers,
 * lakes, what grows), and only then the places looked for in it. Islands and valley heads are too
 * small to see on the coarse lattice, so they are looked for in tiles of a finer one, made from
 * the coarse one with the detail laid back on and worn again at their own scale. The tiles lie on a
 * fixed grid in the world, so the land of a tile is the same whichever place asks for it.
 *
 * Coordinates are the world's own: `x` east and `z` south, in metres from its middle, as a site's are.
 * What it holds and how it is to be used is written down in `docs/06-world.md`.
 */

const TAU = Math.PI * 2;
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** A soft maximum: the greater of two, with the corner where they meet rounded over `k`. */
function softMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** What a world is, before its land is made: decided from its seed alone. */
export interface WorldPlan {
  seed: string;
  /** A number for the noise, from the seed. */
  n: number;
  /** Half the world's breadth: it runs from -half to half both ways. */
  half: number;
  /** Which way is inland, as an angle from east towards south: the sea lies the other way. */
  inland: number;
  /** Where the coast lies along that way, in metres from the middle, before it wanders. */
  coast: number;
  /** How far out from the coast the shelf with its islands reaches. */
  shelf: number;
  /** How broad the low country is, from the coast to the foot of the upland; and the upland, from there to the foot of the range (before either wanders). */
  plains: number;
  upland: number;
  /** The great peaks of the range: the landmarks, seen from everywhere. */
  peaks: { x: number; z: number; r: number; height: number }[];
}

export function planWorld(seed: string): WorldPlan {
  const rng = new Rng(`world/${seed}`), q = rng.fork('plan');
  const half = 24000;
  // (Inland is one of the four quarters, turned a little: so the zones lie across the square and each has its share of it.)
  const inland = q.int(0, 3) * (Math.PI / 2) + q.range(-0.35, 0.35);
  const span = half * (Math.abs(Math.cos(inland)) + Math.abs(Math.sin(inland)));
  const shelf = q.range(6500, 9000);
  const p: WorldPlan = {
    seed, n: 1000 + Math.floor(q.next() * 90000), half, inland,
    // (Some three and a half kilometres of open sea beyond the shelf, at the world's edge.)
    coast: -span + 4500 + shelf, shelf,
    // (Broad in some worlds, a strip in others, and in places none at all: there the upland comes down to the sea.)
    // (The range takes what is left, some third of the world: with more, it filled half of it and the rest was squeezed.)
    plains: q.range(3000, 10000), upland: q.range(10000, 14000), peaks: [],
  };
  // The great peaks: four to seven, well back in the range and well apart.
  const g = rng.fork('peaks'), want = g.int(4, 7);
  for (let tries = 0; tries < 600 && p.peaks.length < want; tries++) {
    const x = g.range(-half * 0.9, half * 0.9), z = g.range(-half * 0.9, half * 0.9), zn = zonesAt(p, x, z);
    if (zn.d - zn.U < 3500) continue;
    const r = g.range(1800, 2800);
    if (p.peaks.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.15)) continue;
    p.peaks.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r), height: Math.round(g.range(2300, 2900)) });
  }
  return p;
}

/** Where a point lies among the zones: how far inland of the coast (`d`), where the upland and the range begin there, and how much it belongs to each zone (the four add to one). */
export interface Zones { d: number; P: number; U: number; wI: number; wP: number; wU: number; wR: number }
const ZN: Zones = { d: 0, P: 0, U: 0, wI: 0, wP: 0, wU: 0, wR: 0 };

/** The zones at a point. (Written into one object, reused: read what is wanted before asking again.) */
export function zonesAt(p: WorldPlan, x: number, z: number): Zones {
  const n = p.n, s = x * Math.cos(p.inland) + z * Math.sin(p.inland);
  // (The coast wanders in bays and headlands some kilometres across, and in smaller ones on them.)
  const d = s - p.coast + 5000 * fbmd(x / 11000 + 1.7, z / 11000 - 0.3, 3, n + 1) + 900 * fbmd(x / 3000, z / 3000 + 2.2, 3, n + 2);
  const P = p.plains + 7000 * fbmd(x / 10000 + 3.3, z / 10000 - 1.2, 2, n + 3);
  const U = Math.max(P, -400) + p.upland + 4000 * fbmd(x / 10000 - 4.1, z / 10000 + 2.2, 2, n + 4);
  const a = smooth((d + 600) / 2000), b = smooth((d - P + 1500) / 3000), c = smooth((d - U + 2500) / 5000);
  ZN.d = d; ZN.P = P; ZN.U = U;
  ZN.wI = 1 - a; ZN.wP = a * (1 - b); ZN.wU = a * b * (1 - c); ZN.wR = a * b * c;
  return ZN;
}

/** How far the shelf's land is lowered to stand at the world's sea: so that near the coast some two fifths of it is out of the water, fewer further out. */
export const ISLE_SEA = 16;

/** The shelf: the archipelago's land (`archipelago.ts`), standing in the world's sea, lower and sparser further out, and beyond it the open sea. */
function islesAt(p: WorldPlan, x: number, z: number, d: number, fine: boolean): number {
  const n = p.n;
  const shelf = fbmd(x / 2200 + 1.3, z / 2200 - 0.7, 3, n + 11);
  const wu = x / 520 + 0.45 * fbmd(x / 700, z / 700, 3, n + 12), wv = z / 520 + 0.45 * fbmd(x / 700 + 5.2, z / 700, 3, n + 13);
  const isles = fbmd(wu, wv, fine ? 5 : 4, n + 14);
  let h = 170 * (0.45 * shelf + 0.55 * isles);
  const up = Math.max(0, h + 10) / 45, r = ridgedFbm(x / 260 + 0.3 * isles, z / 260, fine ? 5 : 3, n + 15);
  h += 18 * Math.min(1.4, up) * (r - 0.25);
  const out = clamp01(-d / p.shelf);
  return h - ISLE_SEA - 60 * out * out - 140 * smooth((-d - p.shelf) / 3000);
}

/** The low country: rising gently from the shore to the foot of the upland, in long swells with lesser ones on them. */
function plainsAt(p: WorldPlan, x: number, z: number, d: number, P: number, fine: boolean): number {
  const n = p.n, t = clamp01(d / Math.max(2500, P + 2500));
  return 4 + 150 * Math.pow(t, 1.3) + 40 * fbmd(x / 5000 + 0.7, z / 5000, 3, n + 21) * (0.35 + t) + 12 * fbmd(x / 1100, z / 1100 - 3.1, fine ? 5 : 3, n + 22);
}

/**
 * The floors of the great valleys, as lines running inland, from the range down towards the coast,
 * the way the land drains: level lines of the distance along the coast, pushed about by noise so
 * that they wander, but never so far that one turns back on itself or closes in a ring. Two families
 * of them, turned apart, so that valleys cross and join as rivers do, and the land between is cut
 * into massifs rather than long ridges side by side. 0 on a line, rising to 1 midway between two,
 * as `shape` bends it. (Made first as the lines where noise crosses its middle, they closed in rings
 * round hills, and a valley in a ring has nowhere to drain: the range was full of hollows a hundred
 * metres deep and more. One family alone combed the land into ridges, all alike.)
 */
function valleyLines(p: WorldPlan, x: number, z: number, apart: number, shape: number, seed: number): number {
  let v = 1;
  for (const [turn, k] of [[-0.42, 0], [0.38, 1]] as const) {
    const a = p.inland + turn, along = -x * Math.sin(a) + z * Math.cos(a), s = seed + k * 10;
    const f = along / (apart * 1.5) + 0.6 * fbmd(x / 7000 + 1.3, z / 7000, 3, s) + 0.15 * fbmd(x / 2000, z / 2000 - 2.6, 2, s + 1);
    v = Math.min(v, 2 * Math.abs(f - Math.round(f)));
  }
  return Math.pow(v, shape);
}

/**
 * The upland: as the valleys' frame has it (`highlands.ts`), ridged noise turned over so that its
 * crests are the floors of glens four or five hundred metres apart, branching and joining; and
 * under those, broad straths a couple of kilometres apart, made the same way at a larger size.
 * The glens fade out on the straths' floors, so that they come down into the straths and do not
 * dam them. Higher the further inland.
 */
function uplandAt(p: WorldPlan, x: number, z: number, d: number, P: number, U: number, fine: boolean): number {
  const n = p.n, t = clamp01((d - P) / Math.max(3000, U - P));
  const broad = fbmd(x / 2600 + 2.1, z / 2600, 3, n + 31);
  const strath = valleyLines(p, x, z, 2300, 0.9, n + 36);
  const wu = x / 520 + 0.45 * fbmd(x / 700, z / 700, 3, n + 32), wv = z / 520 + 0.45 * fbmd(x / 700 + 4.4, z / 700, 3, n + 33);
  const hills = 1 - Math.pow(Math.min(1, ridgedFbm(wu, wv, fine ? 5 : 4, n + 34) * 1.25), 1.6);
  const massif = 0.6 + 0.8 * clamp01(0.5 + fbmd(x / 2600 - 4.4, z / 2600 + 0.9, 3, n + 39));
  return 60 + 300 * t + 50 * broad * (0.3 + 0.7 * strath) + 230 * strath * massif + 170 * hills * Math.sqrt(strath) + 22 * fbmd(x / 200, z / 200, fine ? 4 : 2, n + 35) * strath;
}

/**
 * The range: as the mountain's country is (`mountain.ts`), valley floors with the mountains
 * standing between them, and under each great peak a mass. Its valleys are networks, branching and
 * joining, made as the upland's glens are, larger: great valleys a couple of kilometres apart, and
 * side valleys between them, which fade out on the great valleys' floors so that they run down into
 * them and do not dam them; the crests sharpened by ridged noise high up, where it makes arêtes and
 * horns. (Made first of crests alone, the range was a field of closed hollows, hundreds of metres
 * deep, every one a lake.) The floors rise inland, so they drain to the sea.
 */
function rangeAt(p: WorldPlan, x: number, z: number, d: number, U: number, fine: boolean): number {
  const n = p.n, t = clamp01((d - U) / 9000);
  const fl = 330 + 470 * t + 15 * fbmd(x / 3000, z / 3000 - 4.4, 2, n + 49);
  let big = 600 + 180 * fbmd(x / 4200, z / 4200 + 1.9, 3, n + 41) + 300 * t, mass = 0;
  for (const q of p.peaks) {
    const dd = Math.hypot(x - q.x, z - q.z);
    if (dd > q.r * 2.6) continue;
    const tt = (dd / q.r) * (1 + 0.35 * fbmd(x / 900 + q.x * 1e-3, z / 900, 2, n + 45)), e = Math.exp(-tt * tt);
    // (The side valleys and the crests add some two hundred and fifty metres at the top.)
    big = softMax(big, (q.height - fl - 250) * e, 220);
    mass = Math.max(mass, e);
  }
  // (The great valleys broad-floored, as ice leaves them; the side valleys branching, as the upland's glens do.)
  const great = Math.max(mass, valleyLines(p, x, z, 2800, 1.2, n + 46));
  const su = x / 850 + 0.45 * fbmd(x / 1100 - 3.3, z / 1100, 3, n + 50), sv = z / 850 + 0.45 * fbmd(x / 1100, z / 1100 + 6.1, 3, n + 51);
  const side = 1 - Math.pow(Math.min(1, ridgedFbm(su, sv, fine ? 4 : 3, n + 52) * 1.2), 1.4);
  const u = x / 1300 + 0.3 * fbmd(x / 1000, z / 1000, 3, n + 42), v = z / 1300 + 0.3 * fbmd(x / 1000 + 7, z / 1000, 3, n + 43);
  const crest = ridgedFbm(u, v, fine ? 7 : 5, n + 44);
  // (Along each ridge between valleys, massifs and the cols between them.)
  const massif = Math.max(mass, clamp01(0.5 + 1.2 * fbmd(x / 2400 + 5.1, z / 2400 - 2.3, 3, n + 53)));
  return fl + big * great * (0.45 + 0.55 * massif) + 420 * side * Math.sqrt(great) + 90 * crest * great;
}

/** The plain shape of the world's land at a point: each zone's land, in the share the point belongs to it. `fine` for the tiles' lattice, with more octaves. */
export function worldShape(p: WorldPlan, x: number, z: number, fine = false): number {
  const { d, P, U, wI, wP, wU, wR } = zonesAt(p, x, z);
  let h = 0;
  if (wI > 1e-4) h += wI * islesAt(p, x, z, d, fine);
  if (wP > 1e-4) h += wP * plainsAt(p, x, z, d, P, fine);
  if (wU > 1e-4) h += wU * uplandAt(p, x, z, d, P, U, fine);
  if (wR > 1e-4) h += wR * rangeAt(p, x, z, d, U, fine);
  return h;
}

/** How the world's lattice is worn: deep, so that rivers cut real valleys into the upland and the range. */
export const WORLD_WEAR: Wear = {
  cut: 140, fill: 60,
  water: { drops: 1.0, life: 90, inertia: 0.15, capacity: 0.5, erode: 0.15, deposit: 0.25, evaporate: 0.012, gravity: 4, radius: 2, most: 5 },
  frost: { passes: 2, repose: 1.3, rate: 0.4 },
};
/** How a tile is worn: as an island's or a valley's own frame is. */
export const TILE_WEAR: Wear = {
  cut: 35, fill: 14,
  water: { drops: 1.0, life: 80, inertia: 0.1, capacity: 0.5, erode: 0.15, deposit: 0.25, evaporate: 0.012, gravity: 4, radius: 2, most: 1.5 },
  frost: { passes: 2, repose: 1.5, rate: 0.4 },
};

/** What grows or lies at a point, as the world's lattice has it. */
export const COVER = { sea: 0, lake: 1, shore: 2, marsh: 3, fields: 4, pasture: 5, forest: 6, moor: 7, rock: 8, snow: 9 } as const;

export interface WorldPlace {
  kind: 'island' | 'valley' | 'mountain';
  /** Its number among places of its kind, from 1, best first; and its name. */
  n: number;
  name: string;
  /** Where it is (the middle of the house's ground, or the summit), and the height there. */
  x: number; z: number; y: number;
  /** How well it suits: higher is better. */
  score: number;
  /** For an island: as found in its tile, in the world's coordinates. */
  island?: IslandSpot;
  /** For a valley head: as found, its course in the world's coordinates. */
  valley?: ValleySpot;
  /** For a mountain top: which way its ridge runs down (an angle from east towards south), and where its foot is. */
  ridge?: { angle: number; foot: [number, number]; footY: number };
}

export interface Town { kind: 'harbour' | 'town' | 'village'; name: string; x: number; z: number; y: number }
export interface WorldWay { kind: 'road' | 'track' | 'path' | 'ferry'; points: [number, number][] }
export interface River { points: [number, number][]; width: number[] }

export interface World {
  plan: WorldPlan;
  /** Its name; the names of its sea, its upland and its range; and of each great peak, in the plan's order. */
  name: string;
  regions: { sea: string; upland: string; range: string };
  peakNames: string[];
  /** The land, worn; and as it was shaped before it was worn. */
  field: HeightField;
  shaped: HeightField;
  /** 1 where the sea is; where a lake stands, its surface (else 0); what lies at each point (`COVER`). */
  sea: Uint8Array;
  lake: Float32Array;
  cover: Uint8Array;
  /** How much ground drains through each point, square metres; and where it drains to next (-1 into the sea or off the world). */
  acc: Float32Array;
  down: Int32Array;
  rivers: River[];
  places: WorldPlace[];
  towns: Town[];
  ways: WorldWay[];
  /** How long each stage took, milliseconds; and why candidates were turned down, by kind. */
  timing: Record<string, number>;
  why: Record<string, Record<string, number>>;
}

/** The world's lattice: 48 metres, a thousand and one points a side. */
const CELL = 48, N = 1001;
/** A river on the map from four square kilometres of ground draining through it. */
export const RIVER = 4e6;

/**
 * Where water goes on a lattice: hollows filled to where they spill (flooded from the outlets
 * inward, lowest first), then from each point to its steepest neighbour downhill. Outlets are the
 * points marked in `outlet` and the lattice's edge.
 */
export function drain(f: HeightField, outlet?: Uint8Array): { filled: Float32Array; acc: Float32Array; down: Int32Array } {
  const nx = f.nx, nz = f.nz, n = nx * nz, h = f.data, filled = new Float32Array(n), seen = new Uint8Array(n), order = new Int32Array(n);
  const heap = new Int32Array(n), key = new Float32Array(n);
  let size = 0, popped = 0;
  const push = (k: number, y: number) => {
    let i = size++;
    heap[i] = k; key[i] = y;
    while (i > 0) { const pa = (i - 1) >> 1; if (key[pa] <= key[i]) break; const tk = heap[pa], ty = key[pa]; heap[pa] = heap[i]; key[pa] = key[i]; heap[i] = tk; key[i] = ty; i = pa; }
  };
  const pop = () => {
    const top = heap[0];
    size--;
    if (size > 0) {
      heap[0] = heap[size]; key[0] = key[size];
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < size && key[l] < key[m]) m = l;
        if (r < size && key[r] < key[m]) m = r;
        if (m === i) break;
        const tk = heap[m], ty = key[m]; heap[m] = heap[i]; key[m] = key[i]; heap[i] = tk; key[i] = ty; i = m;
      }
    }
    return top;
  };
  for (let k = 0; k < n; k++) {
    const i = k % nx, j = (k - i) / nx;
    if ((outlet && outlet[k]) || i === 0 || j === 0 || i === nx - 1 || j === nz - 1) { filled[k] = h[k]; seen[k] = 1; push(k, h[k]); }
  }
  while (size) {
    const k = pop(), i = k % nx, j = (k - i) / nx;
    order[popped++] = k;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const q = jj * nx + ii;
      if (seen[q]) continue;
      // (A hair above the point it was reached from, so that water still knows which way to go across a filled flat.)
      seen[q] = 1; filled[q] = Math.max(h[q], filled[k] + 1e-3); push(q, filled[q]);
    }
  }
  const acc = new Float32Array(n).fill(f.cell * f.cell), down = new Int32Array(n).fill(-1);
  // (Highest first: the reverse of the order the points were flooded in, so each passes on what it has gathered before its neighbour downhill does.)
  for (let o = n - 1; o >= 0; o--) {
    const k = order[o];
    if (outlet && outlet[k]) continue;
    const i = k % nx, j = (k - i) / nx;
    let low = -1, best = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const q = jj * nx + ii, drop = (filled[k] - filled[q]) / (di && dj ? Math.SQRT2 : 1);
      if (drop > best) { best = drop; low = q; }
    }
    if (low >= 0) { down[k] = low; acc[low] += acc[k]; }
  }
  return { filled, acc, down };
}

/**
 * Lets hollows drain, as rivers do: where a hollow is deeper than `deepest`, an outlet is cut from
 * its lowest point along the way the water would go, out through where it would spill, until the
 * ground beyond falls away below the cut on its own; low enough that what water stands in the
 * hollow afterwards is no deeper than `deepest`. Shallower hollows are left to fill, as lakes.
 * Three times over, since cutting one hollow can leave others inside it.
 */
export function breach(f: HeightField, outlet: Uint8Array, deepest: number): void {
  const h = f.data, nx = f.nx, n = h.length;
  for (let pass = 0; pass < 3; pass++) {
    const { filled, down } = drain(f, outlet), seen = new Uint8Array(n);
    let cut = 0;
    for (let s = 0; s < n; s++) {
      if (seen[s] || outlet[s] || filled[s] - h[s] < 0.5) continue;
      // The hollow: its points, and the lowest of them.
      const cells = [s];
      seen[s] = 1;
      let pit = s;
      for (let c = 0; c < cells.length; c++) {
        const k = cells[c], i = k % nx;
        if (h[k] < h[pit]) pit = k;
        for (const m of [k - nx, k + nx, i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1]) {
          if (m < 0 || m >= n || seen[m] || outlet[m] || filled[m] - h[m] < 0.5) continue;
          seen[m] = 1; cells.push(m);
        }
      }
      if (filled[pit] - h[pit] <= deepest) continue;
      cut++;
      const level = h[pit] + deepest;
      for (let k = down[pit], m = 1; k >= 0 && !outlet[k]; k = down[k], m++) {
        const want = level - 1e-3 * m;
        if (h[k] <= want && filled[k] - h[k] < 0.5) break;
        if (h[k] > want) h[k] = want;
      }
    }
    if (!cut) break;
  }
}

/** A worn lattice, keeping its shape from before the wear as well. */
function wear(f: HeightField, rng: Rng, w: Wear, keep?: Float32Array): HeightField {
  const shaped = new HeightField(f.x0, f.z0, f.cell, f.nx, f.nz);
  shaped.data.set(f.data);
  wearByWater(f, rng, { ...w.water, keep });
  for (let k = 0; k < f.data.length; k++) { const free = keep ? 1 - keep[k] : 1; f.data[k] = Math.max(shaped.data[k] - w.cut * free, Math.min(shaped.data[k] + w.fill * free, f.data[k])); }
  wearByFrost(f, w.frost.passes, w.frost.repose, w.frost.rate, keep);
  return shaped;
}

/** A tile of the finer lattice: twenty metres, 7.2 kilometres square, in coordinates of its own about its middle (`ox`, `oz` in the world). */
export interface Tile { i: number; j: number; ox: number; oz: number; field: HeightField; acc: Float32Array; down: Int32Array }
/** The tiles' grid: a tile every six kilometres, each reaching six hundred metres over its neighbours on every side. */
export const TILE = { cell: 20, n: 361, stride: 6000, over: 600 };

const TILES = new Map<string, Tile>();
/** The tile at (`i`, `j`) of a world: made when first asked for, and kept. */
export function worldTile(w: World, i: number, j: number): Tile {
  const key = `${w.plan.seed}/${i},${j}`;
  let t = TILES.get(key);
  if (t) return t;
  const p = w.plan, half = ((TILE.n - 1) * TILE.cell) / 2;
  const ox = -p.half + TILE.stride / 2 + i * TILE.stride, oz = -p.half + TILE.stride / 2 + j * TILE.stride;
  const f = new HeightField(-half, -half, TILE.cell, TILE.n, TILE.n), keep = new Float32Array(TILE.n * TILE.n);
  // Its shape: the world's fine shape, with what the world's wear did to the coarse one laid on it; so the rivers keep their valleys.
  for (let jj = 0; jj < TILE.n; jj++) for (let ii = 0; ii < TILE.n; ii++) {
    const x = ox + f.x0 + ii * TILE.cell, z = oz + f.z0 + jj * TILE.cell, k = jj * TILE.n + ii;
    const y = worldShape(p, x, z, true) + w.field.smoothAt(x, z) - w.shaped.smoothAt(x, z);
    f.data[k] = y;
    // (The sea's floor is spared: what the water brought down would otherwise build it up into flats and false islands.)
    keep[k] = 0.8 * smooth((-y - 1) / 6);
  }
  wear(f, new Rng(`world/${p.seed}/tile/${i},${j}`), TILE_WEAR, keep);
  const outlet = new Uint8Array(TILE.n * TILE.n);
  for (let k = 0; k < outlet.length; k++) outlet[k] = f.data[k] < 0 ? 1 : 0;
  const { acc, down } = drain(f, outlet);
  t = { i, j, ox, oz, field: f, acc, down };
  TILES.set(key, t);
  return t;
}

/** The ground a house's spot is looked for with: about the size of an island's or a valley's level ground. */
const HOUSE = { w: 46, d: 62 }, ISLE_RADIUS = 135, VALLEY_LENGTH = 260;
/** How many places of each kind are kept; and how many tiles of each kind are searched at most for them (the richest first, stopping when there are enough). */
const SEARCH = { isleTiles: 18, uplandTiles: 14, keep: 12 };

const WORLDS = new Map<string, World>();

/** The world of a seed: made when first asked for, and kept. */
export function world(seed: string): World {
  const steps = worldSteps(seed);
  for (;;) { const s = steps.next(); if (s.done) return s.value; }
}

/** The world made a stage at a time: each `yield` says what is being done next, so a page can paint between stages. */
export function* worldSteps(seed: string): Generator<string, World> {
  const had = WORLDS.get(seed);
  if (had) return had;
  const p = planWorld(seed), rng = new Rng(`world/${seed}`), timing: Record<string, number> = {}, why: Record<string, Record<string, number>> = { island: {}, valley: {}, mountain: {} };
  let t0 = performance.now();
  const lap = (k: string) => { const t = performance.now(); timing[k] = Math.round(t - t0); t0 = t; };
  yield 'Shaping the land';
  const f = new HeightField(-p.half, -p.half, CELL, N, N), keep = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = f.x0 + i * CELL, z = f.z0 + j * CELL, k = j * N + i;
    f.data[k] = worldShape(p, x, z);
    // (The shelf is spared on this lattice: its islands are a few points across here, and are worn in the tiles instead.)
    keep[k] = zonesAt(p, x, z).wI;
  }
  lap('shape');
  yield 'Wearing it with water and frost';
  const shaped = wear(f, rng.fork('wear'), WORLD_WEAR, keep);
  lap('wear');
  yield 'Following the water';
  const n = N * N, h = f.data, sea = new Uint8Array(n);
  {
    // The sea: whatever lies below its level and is joined to the world's edge by more of the same.
    const q: number[] = [];
    for (let k = 0; k < n; k++) { const i = k % N, j = (k - i) / N; if ((i === 0 || j === 0 || i === N - 1 || j === N - 1) && h[k] < 0) { sea[k] = 1; q.push(k); } }
    for (let c = 0; c < q.length; c++) {
      const k = q[c], i = k % N, j = (k - i) / N;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, m = jj * N + ii;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N || sea[m] || h[m] >= 0) continue;
        sea[m] = 1; q.push(m);
      }
    }
  }
  // (Hollows deeper than a loch get an outlet cut; the rest are lochs, some of them long ones down a valley's floor.)
  breach(f, sea, 60);
  const { filled, acc, down } = drain(f, sea);
  const lake = new Float32Array(n);
  for (let k = 0; k < n; k++) if (!sea[k] && filled[k] - h[k] > 1.5) lake[k] = Math.max(0.01, filled[k]);
  // (A lake of a point or two is a hollow the wear left, not a lake: let it go.)
  {
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (!lake[s] || seen[s]) continue;
      const cells = [s];
      seen[s] = 1;
      for (let c = 0; c < cells.length; c++) {
        const k = cells[c], i = k % N, j = (k - i) / N;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj, m = jj * N + ii;
          if (ii < 0 || jj < 0 || ii >= N || jj >= N || seen[m] || !lake[m]) continue;
          seen[m] = 1; cells.push(m);
        }
      }
      if (cells.length < 6) for (const k of cells) lake[k] = 0;
    }
  }
  const rivers = traceRivers(f, sea, acc, down);
  lap('water');
  yield 'Seeing what grows';
  const cover = coverOf(p, f, sea, lake, acc);
  lap('cover');
  const w: World = { plan: p, name: '', regions: { sea: '', upland: '', range: '' }, peakNames: [], field: f, shaped, sea, lake, cover, acc, down, rivers, places: [], towns: [], ways: [], timing, why };

  // ---- the places
  // Islands and valley heads, in the tiles where the shelf has land and where the upland is.
  const tiles = Math.round((2 * p.half) / TILE.stride);
  const isleTiles: { i: number; j: number; score: number }[] = [], uplandTiles: { i: number; j: number; score: number }[] = [];
  for (let j = 0; j < tiles; j++) for (let i = 0; i < tiles; i++) {
    let isle = 0, up = 0, all = 0;
    const cx = -p.half + TILE.stride / 2 + i * TILE.stride, cz = -p.half + TILE.stride / 2 + j * TILE.stride;
    for (let z = cz - TILE.stride / 2; z < cz + TILE.stride / 2; z += 240) for (let x = cx - TILE.stride / 2; x < cx + TILE.stride / 2; x += 240) {
      const zn = zonesAt(p, x, z), y = f.at(x, z);
      all++;
      if (zn.wI > 0.5 && y > -12) isle++;
      if (zn.wU > 0.6 && y > 20) up++;
    }
    if (isle / all > 0.04) isleTiles.push({ i, j, score: isle / all });
    if (up / all > 0.3) uplandTiles.push({ i, j, score: up / all });
  }
  isleTiles.sort((a, b) => b.score - a.score); uplandTiles.sort((a, b) => b.score - a.score);
  const isles: WorldPlace[] = [], valleys: WorldPlace[] = [];
  // (Only in the tile's own six kilometres, what lies in its overlap being the neighbour's; and two kilometres in from the world's
  // edge at least, so that what is seen from a place is the world's own.)
  const core = (t: Tile, x: number, z: number) => Math.abs(x - t.ox) <= TILE.stride / 2 && Math.abs(z - t.oz) <= TILE.stride / 2 && Math.max(Math.abs(x), Math.abs(z)) < p.half - 2000;
  /** The islands found so far, one to an island. */
  const islands = () => isles.filter((q, k) => !isles.slice(0, k).some((o) => Math.hypot(o.island!.cu - q.island!.cu, o.island!.cv - q.island!.cv) < 400));
  for (const { i, j } of isleTiles.slice(0, SEARCH.isleTiles)) {
    if (islands().length >= SEARCH.keep) break;
    yield `Looking for islands (${islands().length} so far)`;
    const t = worldTile(w, i, j);
    const spots = findIslands({ seed: 0, inner: t.field, outer: t.field }, HOUSE.w, HOUSE.d, ISLE_RADIUS, rng.fork(`isles ${i},${j}`), why.island, [0]);
    for (const s of spots) {
      const spot: IslandSpot = { ...s, u: s.u + t.ox, v: s.v + t.oz, cu: s.cu + t.ox, cv: s.cv + t.oz };
      if (!core(t, spot.cu, spot.cv)) continue;
      isles.push({ kind: 'island', n: 0, name: '', x: spot.u, z: spot.v, y: spot.base, score: 0, island: spot });
    }
    lap(`isles ${i},${j}`);
  }
  for (const { i, j } of uplandTiles.slice(0, SEARCH.uplandTiles)) {
    if (valleys.length >= SEARCH.keep) break;
    yield `Looking for valleys (${valleys.length} so far)`;
    const t = worldTile(w, i, j);
    const spots = findValleys({ seed: 0, inner: t.field, outer: t.field, acc: t.acc, down: t.down }, HOUSE.w, HOUSE.d, VALLEY_LENGTH, rng.fork(`glens ${i},${j}`), why.valley);
    // (Found best first; many lie a few points apart along the same stream.)
    let rank = 0;
    for (const s of spots) {
      const x = s.u + t.ox, z = s.v + t.oz;
      if (!core(t, x, z) || zonesAt(p, x, z).wU < 0.5) continue;
      if (valleys.some((o) => Math.hypot(o.x - x, o.z - z) < 1500)) continue;
      const spot: ValleySpot = { ...s, u: x, v: z, course: s.course.map(([a, b]) => [a + t.ox, b + t.oz]) };
      valleys.push({ kind: 'valley', n: 0, name: '', x, z, y: s.base, score: 10 - rank++, valley: spot });
      if (rank >= 4) break;
    }
    lap(`glens ${i},${j}`);
  }
  // Islands: the best place on each island found, and no two on one island.
  const keptIsles = islands();
  yield 'Looking for mountain tops';
  const summits = findSummits(w, why.mountain);
  lap('summits');
  const number = (list: WorldPlace[]) => list.slice(0, SEARCH.keep).map((q, k) => ({ ...q, n: k + 1 }));
  w.places = [...number(keptIsles), ...number(valleys.sort((a, b) => b.score - a.score)), ...number(summits)];

  // ---- towns and the ways between them
  yield 'Settling the low country';
  w.towns = settle(w, rng.fork('towns'));
  lap('towns');
  yield 'Laying roads';
  w.ways = layWays(w);
  lap('ways');
  // ---- names, in a fixed order, so that a world's names stay as they are while its places do
  const namer = new Namer(rng.fork('names'));
  w.name = namer.name('world');
  w.regions = { sea: namer.name('sea'), upland: namer.name('upland'), range: namer.name('range') };
  w.peakNames = p.peaks.map(() => namer.name('peak'));
  for (const t of w.towns) t.name = namer.name(t.kind);
  for (const q of w.places) q.name = namer.name(q.kind);
  WORLDS.set(seed, w);
  return w;
}

/** Rivers as lines, from where four square kilometres drain through a point down to the sea, a lake's still water, or where one joins another. */
function traceRivers(f: HeightField, sea: Uint8Array, acc: Float32Array, down: Int32Array): River[] {
  const n = f.nx * f.nz, nx = f.nx, inflow = new Uint8Array(n), done = new Uint8Array(n), out: River[] = [];
  for (let k = 0; k < n; k++) if (acc[k] >= RIVER && down[k] >= 0) inflow[down[k]]++;
  const at = (k: number): [number, number] => [f.x0 + (k % nx) * f.cell, f.z0 + Math.floor(k / nx) * f.cell];
  // (Width on the map, in metres: a burn a few metres, a river at its mouth some tens.)
  const width = (a: number) => Math.min(60, 3 + 6 * Math.sqrt(a / RIVER));
  for (let s = 0; s < n; s++) {
    if (acc[s] < RIVER || inflow[s] || sea[s]) continue;
    const pts: [number, number][] = [], wd: number[] = [];
    let k = s;
    for (;;) {
      pts.push(at(k)); wd.push(width(acc[k]));
      if (done[k] || sea[k] || down[k] < 0) break;
      done[k] = 1;
      k = down[k];
    }
    if (pts.length > 2) {
      // (Smoothed, so a river on the map does not go in steps of the lattice; its widths follow it.)
      const line = smoothLine(pts, 2), widths = line.map((_, i) => wd[Math.min(wd.length - 1, Math.round((i / (line.length - 1)) * (wd.length - 1)))]);
      out.push({ points: line, width: widths });
    }
  }
  return out;
}

/** What lies at each point: water, shore, marsh, fields, pasture, forest, moor, rock or snow, from height, slope, wet and the zone. */
function coverOf(p: WorldPlan, f: HeightField, sea: Uint8Array, lake: Float32Array, acc: Float32Array): Uint8Array {
  const n = f.nx * f.nz, nx = f.nx, h = f.data, out = new Uint8Array(n), C = COVER;
  for (let k = 0; k < n; k++) {
    if (sea[k]) { out[k] = C.sea; continue; }
    if (lake[k]) { out[k] = C.lake; continue; }
    const i = k % nx, j = (k - i) / nx, x = f.x0 + i * f.cell, z = f.z0 + j * f.cell, y = h[k];
    const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(f.nz - 1, j + 1);
    const slope = Math.hypot((h[j * nx + ir] - h[j * nx + il]) / ((ir - il) * f.cell), (h[jr * nx + i] - h[jl * nx + i]) / ((jr - jl) * f.cell));
    let bySea = false;
    for (const m of [k - 1, k + 1, k - nx, k + nx]) if (m >= 0 && m < n && sea[m]) bySea = true;
    const tree = 640 + 140 * fbmd(x / 6000, z / 6000, 2, p.n + 51), snow = 1900 + 180 * fbmd(x / 5000 + 3, z / 5000, 2, p.n + 52);
    const zn = zonesAt(p, x, z);
    // (Above the trees, heath and rough grazing, broken by rock where it is steep or high; snow lies all year only on the great peaks.)
    if (y > snow && slope < 1.1) out[k] = C.snow;
    else if (slope > 0.75 || y > tree + 850 + 200 * fbmd(x / 1500, z / 1500, 2, p.n + 55)) out[k] = C.rock;
    else if (y > tree) out[k] = C.moor;
    else if (bySea && y < 15 && slope < 0.3) out[k] = C.shore;
    else if (y < 30 && slope < 0.02 && acc[k] > 2e5) out[k] = C.marsh;
    else {
      // Fields on gentle low ground, woods on slopes and in patches, thinning out up the upland, whose higher ground is
      // mostly heath and rough grazing, with the woods down in its glens.
      const arable = (slope < 0.07 ? 1 : 0) * (1 - smooth((y - 220) / 120)) * (1 - zn.wR);
      const woods = fbmd(x / 2600 + 7, z / 2600, 4, p.n + 53) + 0.3 * smooth((slope - 0.12) / 0.3) - 0.18 * arable - 0.45 * smooth((y - 280) / 300) * (zn.wU + zn.wR);
      if (woods > 0.1) out[k] = C.forest;
      else if (arable > 0.5 && fbmd(x / 2000 - 3, z / 2000, 3, p.n + 54) > -0.12) out[k] = C.fields;
      else if (zn.wU + zn.wR > 0.5 && y > tree - 180) out[k] = C.moor;
      else out[k] = C.pasture;
    }
  }
  return out;
}

/**
 * Summits for mountain tops: in the range, a summit with nothing as high within a kilometre and a
 * half, standing six or seven hundred metres over the valleys about it (as the mountain top
 * stands over the valleys under its cloud), not on the flanks of a great peak, and with a ridge
 * running down from it that a way could come up: falling steadily for a kilometre or so, the
 * ground lower on both hands.
 */
function findSummits(w: World, why: Record<string, number>): WorldPlace[] {
  const no = (k: string) => { why[k] = (why[k] ?? 0) + 1; };
  const f = w.field, h = f.data, p = w.plan, out: WorldPlace[] = [];
  const R = Math.round(900 / CELL), W = Math.round(3000 / CELL), mark = new Int32Array(N * N);
  let stamp = 0;
  for (let j = W; j < N - W; j++) for (let i = W; i < N - W; i++) {
    const k = j * N + i, y = h[k];
    if (y < 900) continue;
    let top = true;
    for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && h[k + dj * N + di] > y) { top = false; break; }
    if (!top) continue;
    const x = f.x0 + i * CELL, z = f.z0 + j * CELL;
    if (zonesAt(p, x, z).wR < 0.5) { no('not in the range'); continue; }
    for (let dj = -R; dj <= R && top; dj++) for (let di = -R; di <= R; di++) if (di * di + dj * dj <= R * R && h[k + dj * N + di] > y) { top = false; break; }
    if (!top) { no('higher near'); continue; }
    // It must stand alone over the cloud, which lies some hundred and fifty metres under the top: the ground joined to it above
    // that must hold nothing higher, within three kilometres.
    const cloud = y - 150, q = [k];
    mark[k] = ++stamp;
    let joined = false;
    for (let c = 0; c < q.length && !joined; c++) {
      const m = q[c], mi = m % N, mj = (m - mi) / N;
      for (const o of [m - 1, m + 1, m - N, m + N]) {
        const oi = o % N, oj = (o - oi) / N;
        if (mark[o] === stamp || h[o] <= cloud) continue;
        if (Math.abs(oi - i) > W || Math.abs(oj - j) > W || Math.abs(oi - mi) > 1) continue;
        if (h[o] > y) { joined = true; break; }
        mark[o] = stamp; q.push(o);
      }
    }
    if (joined) { no('joined to higher over the cloud'); continue; }
    if (p.peaks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 1.3)) { no('on a great peak'); continue; }
    if (y > 2150) { no('too high'); continue; }
    let low = Infinity;
    for (let a = 0; a < 24; a++) for (const r of [2000, 2600, 3200]) low = Math.min(low, f.at(x + Math.cos((a / 24) * TAU) * r, z + Math.sin((a / 24) * TAU) * r));
    if (y - low < 600) { no('not standing high'); continue; }
    // Its ridge: of the ways down, the one that falls most steadily along a crest. (The site's way comes up some three hundred
    // metres of ridge, falling a hundred; this asks for a ridge as long again or more, the ground lower on both hands.)
    let best: { angle: number; score: number } | null = null;
    for (let s = 0; s < 32; s++) {
      const a = (s / 32) * TAU, cx = Math.cos(a), cz = Math.sin(a);
      let ok = true, sides = Infinity, prev = y;
      for (let t = 150; t <= 900 && ok; t += 150) {
        const lx = x + cx * t, lz = z + cz * t, ly = f.smoothAt(lx, lz);
        // (Down, or over a knoll on the way, and never down more than a crag would go.)
        if (ly > prev + 20 || prev - ly > 200) ok = false;
        prev = ly;
        if (t <= 750) for (const side of [-1, 1]) sides = Math.min(sides, ly - f.smoothAt(lx - cz * side * 250, lz + cx * side * 250));
      }
      const fallen = y - prev;
      if (!ok || sides < 25 || fallen < 120 || fallen > 650) continue;
      const score = Math.min(sides, 150) / 50 - Math.abs(fallen - 320) / 150;
      if (!best || score > best.score) best = { angle: a, score };
    }
    if (!best) { no('no ridge'); continue; }
    const fx = x + Math.cos(best.angle) * 900, fz = z + Math.sin(best.angle) * 900;
    out.push({ kind: 'mountain', n: 0, name: '', x, z, y, score: best.score + Math.min(900, y - low) / 300, ridge: { angle: best.angle, foot: [fx, fz], footY: f.smoothAt(fx, fz) } });
  }
  out.sort((a, b) => b.score - a.score);
  const kept: WorldPlace[] = [];
  for (const q of out) if (!kept.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 2500)) kept.push(q);
  return kept;
}

/**
 * Towns, as placeholders for what the low country will one day hold: a harbour where a river comes
 * out to the sea, nearest the islands; market towns where rivers run through the low country; and
 * villages, on good ground near water, in the low country and up the broad glens.
 */
function settle(w: World, rng: Rng): Town[] {
  const f = w.field, h = f.data, p = w.plan, towns: Town[] = [];
  const at = (k: number) => ({ x: f.x0 + (k % N) * CELL, z: f.z0 + Math.floor(k / N) * CELL, y: h[k] });
  const slopeAt = (k: number) => { const i = k % N, j = (k - i) / N; if (i < 1 || j < 1 || i > N - 2 || j > N - 2) return 1; return Math.hypot(h[k + 1] - h[k - 1], h[k + N] - h[k - N]) / (2 * CELL); };
  const isles = w.places.filter((q) => q.kind === 'island');
  const ix = isles.length ? isles.reduce((s, q) => s + q.x, 0) / isles.length : 0, iz = isles.length ? isles.reduce((s, q) => s + q.z, 0) / isles.length : 0;
  // The harbour: a river's mouth, the larger the river and the nearer the islands the better.
  let harbour = -1, best = -Infinity;
  for (let k = 0; k < N * N; k++) {
    if (w.acc[k] < RIVER || w.sea[k] || w.down[k] < 0 || !w.sea[w.down[k]]) continue;
    const { x, z } = at(k), score = Math.log(w.acc[k]) * 2 - (isles.length ? Math.hypot(x - ix, z - iz) / 3000 : 0);
    if (score > best) { best = score; harbour = k; }
  }
  if (harbour < 0) for (let k = 0; k < N * N; k++) {
    // (No river comes out to the sea: then the gentlest shore.)
    if (w.cover[k] !== COVER.shore) continue;
    const { x, z } = at(k), score = -slopeAt(k) * 50 - (isles.length ? Math.hypot(x - ix, z - iz) / 3000 : 0);
    if (score > best) { best = score; harbour = k; }
  }
  if (harbour >= 0) towns.push({ kind: 'harbour', name: '', ...at(harbour) });
  const clear = (x: number, z: number, d: number) => towns.every((t) => Math.hypot(t.x - x, t.z - z) >= d);
  // Market towns: on a river in the low country, on gentle ground; the largest rivers first, well apart.
  const sites: number[] = [];
  for (let k = 0; k < N * N; k++) if (w.acc[k] >= 2 * RIVER && !w.sea[k] && !w.lake[k] && h[k] > 3 && h[k] < 320 && slopeAt(k) < 0.05) sites.push(k);
  sites.sort((a, b) => w.acc[b] - w.acc[a]);
  for (const k of sites) {
    const t = at(k);
    if (towns.filter((q) => q.kind === 'town').length >= 4) break;
    if (zonesAt(p, t.x, t.z).wR > 0.3 || !clear(t.x, t.z, 7000)) continue;
    towns.push({ kind: 'town', name: '', ...t });
  }
  // Villages: by water, on fields or pasture, a few kilometres apart.
  const near: number[] = [];
  for (let k = 0; k < N * N; k += 3) if ((w.cover[k] === COVER.fields || w.cover[k] === COVER.pasture) && w.acc[k] > 3e5 && slopeAt(k) < 0.08) near.push(k);
  for (let tries = 0; tries < 4000 && near.length && towns.filter((q) => q.kind === 'village').length < 14; tries++) {
    const t = at(near[rng.int(0, near.length - 1)]);
    if (!clear(t.x, t.z, 3000)) continue;
    towns.push({ kind: 'village', name: '', ...t });
  }
  return towns;
}

/**
 * The ways: roads between the towns, the shortest set that joins them all; tracks from the
 * villages and the valley heads to the nearest road; paths from the foot of each mountain top's
 * ridge, and up it; and ferries from the harbour out to the islands. Each is laid as a walker or
 * a cart would lay it: round a hill rather than over it, along a slope rather than up it, across a
 * river where it must; and on a way already made where one goes the right way.
 */
function layWays(w: World): WorldWay[] {
  // (On a lattice of twice the world's: a way finer than ninety-six metres is not seen on a map of forty-eight kilometres.)
  const S = 2, n = Math.floor((N - 1) / S) + 1, cell = CELL * S, f = w.field, x0 = f.x0, z0 = f.z0;
  const H = new Float32Array(n * n), water = new Uint8Array(n * n), river = new Uint8Array(n * n), made = new Uint8Array(n * n), madeList: number[] = [];
  // (Ground that is a little worse or better going, in patches some hundreds of metres across, for what a lattice cannot know: a
  // farm in the way, a bog, a ford. On the flat it makes a way wander, as ways do, where otherwise it ran ruled along the lattice.)
  const going = new Float32Array(n * n);
  for (let g = 0; g < n * n; g++) going[g] = 0.7 + 0.6 * valueNoise2((x0 + (g % n) * cell) / 650, (z0 + Math.floor(g / n) * cell) / 650, w.plan.n + 71);
  const mark = (g: number) => { if (!made[g]) { made[g] = 1; madeList.push(g); } };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * S * N + i * S, g = j * n + i;
    H[g] = f.data[k]; water[g] = w.sea[k] || w.lake[k] ? 1 : 0; river[g] = w.acc[k] >= RIVER * 3 ? 1 : 0;
  }
  const idx = (x: number, z: number) => Math.min(n - 1, Math.max(0, Math.round((z - z0) / cell))) * n + Math.min(n - 1, Math.max(0, Math.round((x - x0) / cell)));
  const pt = (g: number): [number, number] => [x0 + (g % n) * cell, z0 + Math.floor(g / n) * cell];
  const ways: WorldWay[] = [];
  // What a step costs, for each kind of way: how steep it may be before it pays heavily, and what a bridge costs.
  const KIND = { road: { steep: 0.07, bridge: 700, reuse: 0.4 }, track: { steep: 0.11, bridge: 500, reuse: 0.5 }, path: { steep: 0.3, bridge: 300, reuse: 0.6 } };
  const route = (kind: 'road' | 'track' | 'path', from: [number, number], to: [number, number]): [number, number][] | null => {
    const o = KIND[kind];
    const cost = (a: number, b: number) => {
      if (water[b]) return Infinity;
      const di = Math.abs((a % n) - (b % n)), len = cell * (di && Math.abs(a - b) !== 1 ? Math.SQRT2 : 1), s = Math.abs(H[b] - H[a]) / len;
      let c = len * (1 + (s / o.steep) ** 2) * going[b];
      if (river[b] && !river[a]) c += o.bridge;
      return made[b] ? c * o.reuse : c;
    };
    const line = leastPath(x0, z0, cell, n, n, from, to, cost);
    if (!line) return null;
    for (const [x, z] of line) mark(idx(x, z));
    return line;
  };
  /** The nearest point of a way already made. */
  const nearestMade = (x: number, z: number): [number, number] | null => {
    let best = -1, bd = Infinity;
    for (const g of madeList) { const [px, pz] = pt(g), d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = g; } }
    return best < 0 ? null : pt(best);
  };
  const add = (kind: WorldWay['kind'], line: [number, number][] | null) => { if (line && line.length > 1) ways.push({ kind, points: smoothLine(line, 3) }); };
  // Roads: the towns joined by the shortest set of links (Prim's way), each link laid over the land.
  const hubs = w.towns.filter((t) => t.kind !== 'village');
  if (hubs.length) {
    const inTree = [hubs[0]], out = hubs.slice(1);
    while (out.length) {
      let bi = 0, bj = 0, bd = Infinity;
      for (let a = 0; a < inTree.length; a++) for (let b = 0; b < out.length; b++) { const d = Math.hypot(inTree[a].x - out[b].x, inTree[a].z - out[b].z); if (d < bd) { bd = d; bi = a; bj = b; } }
      add('road', route('road', [inTree[bi].x, inTree[bi].z], [out[bj].x, out[bj].z]));
      inTree.push(out[bj]); out.splice(bj, 1);
    }
  }
  if (!madeList.length && hubs.length) mark(idx(hubs[0].x, hubs[0].z));
  // Tracks: villages and valley heads, the nearest first, each to the nearest way already made.
  const ends: { x: number; z: number; kind: 'track' | 'path'; from?: [number, number][] }[] = [];
  for (const t of w.towns) if (t.kind === 'village') ends.push({ x: t.x, z: t.z, kind: 'track' });
  for (const q of w.places) if (q.kind === 'valley') ends.push({ x: q.x, z: q.z, kind: 'track' });
  // Paths: up each mountain top's ridge from its foot, and from the foot to the nearest way.
  for (const q of w.places) if (q.kind === 'mountain' && q.ridge) {
    ends.push({ x: q.ridge.foot[0], z: q.ridge.foot[1], kind: 'path', from: [[q.x, q.z], q.ridge.foot] });
  }
  const remaining = [...ends];
  while (remaining.length) {
    // (The one nearest the ways made so far, so that later ones can join it.)
    let bi = 0, bd = Infinity;
    for (let k = 0; k < remaining.length; k++) { const m = nearestMade(remaining[k].x, remaining[k].z); const d = m ? Math.hypot(m[0] - remaining[k].x, m[1] - remaining[k].z) : 0; if (d < bd) { bd = d; bi = k; } }
    const e = remaining.splice(bi, 1)[0], m = nearestMade(e.x, e.z);
    if (e.from) {
      // (The ridge: walked on its crest, straight up; it is not laid over the lattice, which would put it beside the crest.)
      const up: [number, number][] = [];
      for (let t = 0; t <= 1.0001; t += 0.1) up.push([e.from[0][0] + (e.from[1][0] - e.from[0][0]) * t, e.from[0][1] + (e.from[1][1] - e.from[0][1]) * t]);
      ways.push({ kind: 'path', points: up });
      for (const [x, z] of up) mark(idx(x, z));
    }
    if (m && Math.hypot(m[0] - e.x, m[1] - e.z) > cell) add(e.kind, route(e.kind, [e.x, e.z], m));
    else mark(idx(e.x, e.z));
  }
  // Ferries: from the harbour to each island, over the water and round the land.
  const harbour = w.towns.find((t) => t.kind === 'harbour');
  if (harbour) {
    const seaCost = (a: number, b: number) => {
      if (!water[b]) return Infinity;
      return cell * (Math.abs((a % n) - (b % n)) && Math.abs(a - b) !== 1 ? Math.SQRT2 : 1);
    };
    /** The nearest water to a point, on the lattice. */
    const wet = (x: number, z: number): [number, number] | null => {
      const c = idx(x, z), ci = c % n, cj = Math.floor(c / n);
      for (let r = 0; r < 20; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || !water[j * n + i]) continue;
        return pt(j * n + i);
      }
      return null;
    };
    const from = wet(harbour.x, harbour.z);
    for (const q of w.places) {
      if (q.kind !== 'island' || !from) continue;
      const to = wet(q.island!.cu, q.island!.cv);
      if (!to) continue;
      const line = leastPath(x0, z0, cell, n, n, from, to, seaCost);
      if (line) ways.push({ kind: 'ferry', points: smoothLine([[harbour.x, harbour.z], ...line], 3) });
    }
  }
  return ways;
}
