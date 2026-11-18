import { Rng, valueNoise2 } from './rng';
import { fbmd, HeightField, leastPath, ridgedFbm, smoothLine, wearByFrost, wearByWater, Wear } from './terrain';
import { findIslands, IslandSpot } from './archipelago';
import { findValleys, ValleySpot } from './highlands';
import { Namer } from './names';

/**
 * A world: one stretch of country, six kilometres by ten unless asked otherwise (`WORLD_SIZE`), in
 * which every kind of place is found rather than drawn, four of each. From the sea's side: open sea; a shelf with islands on it; the
 * coast; low country of fields and woods; an upland cut by glens; and at the back a high range,
 * with a few great peaks standing over it. One sea level for all of it, heights in metres over
 * the sea. Its mountains are hills of four to six hundred metres, its great peaks a little over that:
 * a small country, low enough that its land can one day be streamed in at a metre where it is walked.
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
  /** Half the world's breadth east and west (`hx`), and north and south (`hz`): it runs from -hx to hx, and -hz to hz. */
  hx: number;
  hz: number;
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
  /**
   * Summits planned in the range for mountain tops, as the islands are on the shelf: where each stands, how broad and how high, and
   * which way its ridge runs down (an angle from east towards south). (The range is narrow in a world this size, and of the
   * summits its noise makes few stand alone with a ridge to come up by.)
   */
  tops: { x: number; z: number; r: number; height: number; spur: number }[];
  /**
   * A great bay, the coast pushed inland: where its middle lies along the coast (metres from the
   * world's middle, eastward when inland is north), how broad it is at its mouth, and how far inland
   * it reaches.
   */
  bay: { at: number; width: number; depth: number };
  /** The shelf's islands: how far its land is lowered to stand at the sea (`sea`), and lowered further towards the shelf's outer edge (`fall`). */
  isles: { sea: number; fall: number };
  /**
   * Islands planned on the shelf, as the great peaks are in the range: where each stands, how far its coast lies from its
   * middle, how high it stands over the sea, and how it is drawn out and turned. (The shelf's own noise makes islets by the
   * hundred at one sea level, but few of the size a house's island is: the islands' frames find theirs by trying twenty levels.)
   */
  islands: { x: number; z: number; r: number; top: number; squash: number; turn: number; lobe: number; hill: number }[];
  /** Fjords, where the coast is high ground: how deeply they are cut (0 to 1), and how far inland of the coast they run. */
  fjords: { strength: number; reach: number };
}

/** How large a world is unless asked otherwise: six kilometres east and west, ten from the sea to the hills, as asked (a world as deep as it is long gives each zone room, the range most). */
export const WORLD_SIZE = { x: 6000, z: 10000 };

export function planWorld(seed: string, size: { x: number; z: number } = WORLD_SIZE): WorldPlan {
  const rng = new Rng(`world/${seed}`), q = rng.fork('plan');
  const hx = size.x / 2, hz = size.z / 2;
  // (Inland is north, turned a little: the sea and its islands to the south, the mountains to the north, as asked.)
  const inland = -Math.PI / 2 + q.range(-0.3, 0.3);
  const span = hx * Math.abs(Math.cos(inland)) + hz * Math.abs(Math.sin(inland));
  // (The zones' depths are shares of the world's depth from the sea to the hills, set for ten kilometres.)
  const k = hz / 5000, shelf = q.range(1700, 2300) * k;
  const p: WorldPlan = {
    seed, n: 1000 + Math.floor(q.next() * 90000), hx, hz, inland,
    // (Some eight hundred metres of open sea beyond the shelf, at the world's edge.)
    coast: -span + 800 * k + shelf, shelf,
    // (Broad in some worlds, a strip in others, and in places none at all: there the upland comes down to the sea.)
    // (The range takes what is left, some third of the world: with more, it filled half of it and the rest was squeezed.)
    plains: q.range(600, 1800) * k, upland: q.range(2400, 3200) * k, peaks: [], tops: [],
    bay: { at: 0, width: 0, depth: 0 }, fjords: { strength: 0, reach: 0 }, isles: { sea: ISLE_SEA, fall: 50 }, islands: [],
  };
  // The bay: somewhere along the coast, not hard by the world's edge; broad, and reaching well inland, past the low country into
  // the upland, where its sides and its head are fjord coast. (From a stream of its own, so the rest of the plan stays as it was.)
  const b = rng.fork('bay');
  p.bay = { at: Math.round(b.range(-0.4, 0.4) * hx), width: Math.round(Math.min(b.range(1500, 2500), hx * 0.8)), depth: Math.round(b.range(1800, 3000) * k) };
  p.fjords = { strength: Math.round(b.range(0.6, 1) * 100) / 100, reach: Math.round(b.range(900, 1800)) };
  // The planned islands: seven to nine, out on the shelf, in from the world's edge and well apart.
  const il = rng.fork('islands'), wantIsles = il.int(7, 9);
  for (let tries = 0; tries < 900 && p.islands.length < wantIsles; tries++) {
    const x = il.range(-hx + 500, hx - 500), z = il.range(-hz + 500, hz - 500), zn = zonesAt(p, x, z);
    if (zn.d0 > -0.12 * p.shelf || zn.d0 < -0.75 * p.shelf) continue;
    const r = il.range(150, 210);
    if (p.islands.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.6 + 250)) continue;
    p.islands.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r), top: Math.round(il.range(34, 52)), squash: Math.round(il.range(0.6, 0.95) * 100) / 100, turn: Math.round(il.range(0, Math.PI) * 100) / 100, lobe: Math.round(il.range(0, Math.PI * 2) * 100) / 100, hill: Math.round(il.range(0, Math.PI * 2) * 100) / 100 });
  }
  // The great peaks: one to three, well back in the range and well apart.
  const g = rng.fork('peaks'), want = g.int(1, 3);
  for (let tries = 0; tries < 600 && p.peaks.length < want; tries++) {
    const x = g.range(-hx * 0.9, hx * 0.9), z = g.range(-hz * 0.9, hz * 0.9), zn = zonesAt(p, x, z);
    if (zn.d0 - zn.U < 700) continue;
    const r = g.range(300, 450);
    if (p.peaks.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.15)) continue;
    p.peaks.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r), height: Math.round(g.range(650, 800)) });
  }
  // The planned summits: five, in the range, clear of the great peaks and of one another, each with its ridge running down towards
  // the coast, more or less, where the way up would come from.
  const tp = rng.fork('tops');
  for (let tries = 0; tries < 900 && p.tops.length < 5; tries++) {
    const x = tp.range(-hx + 450, hx - 450), z = tp.range(-hz + 450, hz - 450), zn = zonesAt(p, x, z);
    if (zn.d0 - zn.U < 250) continue;
    const r = tp.range(240, 320);
    if (p.peaks.some((o) => Math.hypot(o.x - x, o.z - z) < o.r * 1.6 + r + 300) || p.tops.some((o) => Math.hypot(o.x - x, o.z - z) < 1000)) continue;
    p.tops.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r), height: Math.round(tp.range(480, 600)), spur: Math.round((p.inland + Math.PI + tp.range(-1, 1)) * 100) / 100 });
  }
  return p;
}

/**
 * Where a point lies among the zones: how far inland of the coast (`d0`), and of the bay's shore as
 * the fjords reckon it (`d`); how far the land has sunk there for the bay (`bay`, 0 to 1); where the
 * upland and the range begin there; how far it is upland or range rather than low country (`up`), and
 * range rather than upland (`high`); and how much it belongs to each zone (the four add to one).
 */
export interface Zones { d: number; d0: number; bay: number; P: number; U: number; up: number; high: number; wI: number; wP: number; wU: number; wR: number }
const ZN: Zones = { d: 0, d0: 0, bay: 0, P: 0, U: 0, up: 0, high: 0, wI: 0, wP: 0, wU: 0, wR: 0 };

/** The zones at a point. (Written into one object, reused: read what is wanted before asking again.) */
export function zonesAt(p: WorldPlan, x: number, z: number): Zones {
  const n = p.n, s = x * Math.cos(p.inland) + z * Math.sin(p.inland);
  // (The coast wanders in bays and headlands a kilometre or two across, and in smaller ones on them.)
  const d0 = s - p.coast + 800 * fbmd(x / 2500 + 1.7, z / 2500 - 0.3, 3, n + 1) + 200 * fbmd(x / 700, z / 700 + 2.2, 3, n + 2);
  // The great bay: the land sunk in a broad hollow, deepest along its middle, which wanders, and dying away at its sides and at its
  // head; the sea comes in as far as the land lies under it. So its shore is where the land's own shape meets the sea: the valleys
  // drowned into inlets, the spurs between them left as headlands, the hills in it as islands, as a firth or a sea loch is.
  // (Drawn first as an outline cut out of the land, the bay's shore was one smooth sweep, cutting through hill and valley alike.)
  const B = p.bay, lat = -x * Math.sin(p.inland) + z * Math.cos(p.inland);
  const across = (lat - B.at + 300 * fbmd(d0 / 1400 + 2.7, 0.4, 2, n + 6)) / (B.width / 2) + 0.18 * fbmd(x / 700 - 1.9, z / 700 + 0.6, 3, n + 7);
  // (Sunk evenly over most of its breadth, and dying away slowly at its sides and head, so that there the land's own relief, not the
  // hollow's, says where the water stops.)
  // (Its edge worn into coves and points at two sizes, and its depth uneven: where the land is flat, as low country by the sea is,
  // nothing else breaks the line where the water stops, and without them it was a smooth sweep there.)
  const rag = 0.3 * fbmd(x / 550 + 4.2, z / 550 - 1.3, 3, n + 8) + 0.13 * fbmd(x / 160 - 2.6, z / 160 + 3.4, 2, n + 9);
  // (Its fall at the sides gentle, over most of the bay's half-breadth again: steep, it said where the shore went wherever the land
  // was gentle, and the bay came out a smooth lobe in low country.)
  const sunk = smooth((1.75 - Math.abs(across) + rag) / 1.5) * smooth((B.depth + 400 - d0 + 500 * rag) / 1300) * smooth((d0 + 500) / 500) * (0.85 + 0.3 * (0.5 + fbmd(x / 900, z / 900 + 7.7, 2, n + 10)));
  // (Where the fjords reckon the shore to be: the bay's outline, as it was first drawn.)
  const d = d0 - B.depth * Math.pow(Math.max(0, 1 - across * across), 1.1);
  const P = p.plains + 900 * fbmd(x / 2500 + 3.3, z / 2500 - 1.2, 2, n + 3);
  const U = Math.max(P, -100) + p.upland + 600 * fbmd(x / 2500 - 4.1, z / 2500 + 2.2, 2, n + 4);
  const a = smooth((d0 + 250) / 650), b = smooth((d0 - P + 300) / 600), c = smooth((d0 - U + 500) / 1000);
  ZN.d = d; ZN.d0 = d0; ZN.bay = sunk; ZN.P = P; ZN.U = U; ZN.up = b; ZN.high = c;
  ZN.wI = 1 - a; ZN.wP = a * (1 - b); ZN.wU = a * b * (1 - c); ZN.wR = a * b * c;
  return ZN;
}

/** How far the shelf's land is lowered to stand at the world's sea: so that near the coast some third of it is out of the water, fewer further out, in islands of a few hundred metres. */
export const ISLE_SEA = 24;

/** The shelf: the archipelago's land (`archipelago.ts`), standing in the world's sea, lower and sparser further out, and beyond it the open sea. */
function islesAt(p: WorldPlan, x: number, z: number, d: number, fine: boolean): number {
  const n = p.n;
  // (The shelf, the islands and the hills on them, as the archipelago has them; then lowered to the sea, and the planned islands.)
  const shelf = fbmd(x / 1500 + 1.3, z / 1500 - 0.7, 3, n + 11);
  const wu = x / 520 + 0.45 * fbmd(x / 700, z / 700, 3, n + 12), wv = z / 520 + 0.45 * fbmd(x / 700 + 5.2, z / 700, 3, n + 13);
  const isles = fbmd(wu, wv, fine ? 5 : 4, n + 14);
  let h = 170 * (0.45 * shelf + 0.55 * isles);
  const up = Math.max(0, h + 10) / 45, r = ridgedFbm(x / 260 + 0.3 * isles, z / 260, fine ? 5 : 3, n + 15);
  h += 18 * Math.min(1.4, up) * (r - 0.25);
  const out = clamp01(-d / p.shelf);
  h = h - p.isles.sea - p.isles.fall * out * out - 60 * smooth((-d - p.shelf) / 600);
  // The planned islands: a cliffed coast, a broad shoulder at the height a house stands at on an island, a hill on it; the coast
  // wandering, so no two are alike and none is a ring.
  for (const q of p.islands) {
    const dx = x - q.x, dz = z - q.z;
    if (Math.abs(dx) > q.r * 2 || Math.abs(dz) > q.r * 2) continue;
    const c = Math.cos(q.turn), sn = Math.sin(q.turn), a = (dx * c + dz * sn) / q.r, b = (-dx * sn + dz * c) / (q.r * q.squash);
    // (A lobe pushed out on one side, and the coast worn into points and coves at two sizes: an oval with a ring round it, drawn
    // first, looked like an egg in a pan.)
    const la = Math.cos(q.lobe) * 0.75, lb = Math.sin(q.lobe) * 0.75 * q.squash, lobe = Math.hypot(a - la, b - lb) / 0.55;
    const rr = Math.min(Math.hypot(a, b), lobe) * (1 + 0.22 * fbmd(x / 160 + q.x, z / 160, 3, n + 16) + 0.12 * fbmd(x / 45, z / 45 + q.z, 2, n + 18));
    if (rr > 1.45) continue;
    // (Its hill stands off to one side, as on the islands' own frames, where the house's shoulder is towards one end.)
    const hr = Math.hypot(a - Math.cos(q.hill) * 0.35, b - Math.sin(q.hill) * 0.35 * q.squash);
    const land = -14 + (q.top + 14) * smooth((1.06 - rr) / 0.22) * (0.62 + 0.38 * smooth((0.6 - hr) / 0.55)) + 3 * fbmd(x / 90, z / 90, fine ? 4 : 2, n + 17);
    const w = smooth((1.45 - rr) / 0.35);
    h = h * (1 - w) + land * w;
  }
  return h;
}

/** The low country: rising gently from the shore to the foot of the upland, in long swells with lesser ones on them. */
function plainsAt(p: WorldPlan, x: number, z: number, d: number, P: number, fine: boolean): number {
  const n = p.n, t = clamp01(d / Math.max(500, P + 500));
  return 3 + 60 * Math.pow(t, 1.3) + 15 * fbmd(x / 1500 + 0.7, z / 1500, 3, n + 21) * (0.35 + t) + 6 * fbmd(x / 400, z / 400 - 3.1, fine ? 5 : 3, n + 22);
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
function valleyLines(p: WorldPlan, x: number, z: number, apart: number, shape: number, seed: number, one = false): number {
  let v = 1;
  for (const [turn, k] of one ? ([[-0.42, 0]] as const) : ([[-0.42, 0], [0.38, 1]] as const)) {
    const a = p.inland + turn, along = -x * Math.sin(a) + z * Math.cos(a), s = seed + k * 10;
    const f = along / (apart * 1.5) + 0.6 * fbmd(x / (apart * 3) + 1.3, z / (apart * 3), 3, s) + 0.15 * fbmd(x / (apart * 0.87), z / (apart * 0.87) - 2.6, 2, s + 1);
    v = Math.min(v, 2 * Math.abs(f - Math.round(f)));
  }
  return Math.pow(v, shape);
}

/**
 * The upland: as the valleys' frame has it (`highlands.ts`), ridged noise turned over so that its
 * crests are the floors of glens four or five hundred metres apart, branching and joining; and
 * under those, broad straths a kilometre or so apart running inland (`valleyLines`). The glens fade
 * out on the straths' floors, so that they come down into the straths and do not dam them. Higher
 * the further inland.
 */
function uplandAt(p: WorldPlan, x: number, z: number, d: number, P: number, U: number, fine: boolean): number {
  const n = p.n, t = clamp01((d - P) / Math.max(600, U - P));
  const broad = fbmd(x / 1200 + 2.1, z / 1200, 3, n + 31);
  const strath = valleyLines(p, x, z, STRATHS, 0.9, n + 36);
  const wu = x / 520 + 0.45 * fbmd(x / 700, z / 700, 3, n + 32), wv = z / 520 + 0.45 * fbmd(x / 700 + 4.4, z / 700, 3, n + 33);
  const hills = 1 - Math.pow(Math.min(1, ridgedFbm(wu, wv, fine ? 5 : 4, n + 34) * 1.25), 1.6);
  const massif = 0.6 + 0.8 * clamp01(0.5 + fbmd(x / 1200 - 4.4, z / 1200 + 0.9, 3, n + 39));
  return 40 + 110 * t + 25 * broad * (0.3 + 0.7 * strath) + 110 * strath * massif + 90 * hills * Math.sqrt(strath) + 10 * fbmd(x / 150, z / 150, fine ? 4 : 2, n + 35) * strath;
}

/**
 * The range: as the mountain's country is (`mountain.ts`), valley floors with the mountains
 * standing between them, and under each great peak a mass. Its valleys are networks, branching and
 * joining, made as the upland's glens are, larger: great valleys a kilometre and more apart, and
 * side valleys between them, which fade out on the great valleys' floors so that they run down into
 * them and do not dam them; the crests sharpened by ridged noise high up, where it makes arêtes and
 * horns. (Made first of crests alone, the range was a field of closed hollows, hundreds of metres
 * deep, every one a lake.) The floors rise inland, so they drain to the sea.
 */
function rangeAt(p: WorldPlan, x: number, z: number, d: number, U: number, fine: boolean): number {
  const n = p.n, t = clamp01((d - U) / 2000);
  const fl = 90 + 110 * t + 8 * fbmd(x / 1200, z / 1200 - 4.4, 2, n + 49);
  let big = 220 + 60 * fbmd(x / 1500, z / 1500 + 1.9, 3, n + 41) + 80 * t, mass = 0;
  for (const q of p.peaks) {
    const dd = Math.hypot(x - q.x, z - q.z);
    if (dd > q.r * 2.6) continue;
    const tt = (dd / q.r) * (1 + 0.35 * fbmd(x / 250 + q.x * 1e-3, z / 250, 2, n + 45)), e = Math.exp(-tt * tt);
    // (The side valleys and the crests add some hundred and ten metres at the top.)
    big = softMax(big, (q.height - fl - 110) * e, 60);
    mass = Math.max(mass, e);
  }
  // The planned summits: a mass as the great peaks have, drawn out down the way its ridge runs, so the ridge falls gently that way.
  let calm = 0;
  for (const q of p.tops) {
    const dx = x - q.x, dz = z - q.z;
    if (dx * dx + dz * dz > q.r * q.r * 12) continue;
    const along = dx * Math.cos(q.spur) + dz * Math.sin(q.spur), across = -dx * Math.sin(q.spur) + dz * Math.cos(q.spur);
    const tt = Math.hypot(along / (along > 0 ? 2.4 : 1), across / 0.8) / q.r * (1 + 0.25 * fbmd(x / 200 + q.x * 1e-3, z / 200, 2, n + 47)), e = Math.exp(-tt * tt);
    big = softMax(big, (q.height - fl - 110) * e, 60);
    mass = Math.max(mass, e); calm = Math.max(calm, e);
  }
  // (The great valleys broad-floored, as ice leaves them; the side valleys branching, as the upland's glens do.)
  const great = Math.max(mass, valleyLines(p, x, z, 1300, 1.2, n + 46));
  const su = x / 400 + 0.45 * fbmd(x / 520 - 3.3, z / 520, 3, n + 50), sv = z / 400 + 0.45 * fbmd(x / 520, z / 520 + 6.1, 3, n + 51);
  const side = 1 - Math.pow(Math.min(1, ridgedFbm(su, sv, fine ? 4 : 3, n + 52) * 1.2), 1.4);
  const u = x / 500 + 0.3 * fbmd(x / 400, z / 400, 3, n + 42), v = z / 500 + 0.3 * fbmd(x / 400 + 7, z / 400, 3, n + 43);
  const crest = ridgedFbm(u, v, fine ? 7 : 5, n + 44);
  // (Along each ridge between valleys, massifs and the cols between them.)
  const massif = Math.max(mass, clamp01(0.5 + 1.2 * fbmd(x / 900 + 5.1, z / 900 - 2.3, 3, n + 53)));
  // (On a planned summit's mass the side valleys and the crests are quieter, so that its ridge comes down whole and is not notched
  // across by them; a way could not come up it otherwise.)
  return fl + big * great * (0.45 + 0.55 * massif) + 130 * side * Math.sqrt(great) * (1 - 0.8 * calm) + 35 * crest * great * (1 - 0.5 * calm);
}

/** How far apart the upland's straths lie, which the fjords follow down to the sea. */
const STRATHS = 1100;

/** The plain shape of the world's land at a point: each zone's land, in the share the point belongs to it. `fine` for the tiles' lattice, with more octaves. */
export function worldShape(p: WorldPlan, x: number, z: number, fine = false): number {
  const { d, d0, bay, P, U, up, high, wI, wP, wU, wR } = zonesAt(p, x, z);
  let h = 0;
  if (wI > 1e-4) h += wI * islesAt(p, x, z, d0, fine);
  if (wP > 1e-4) h += wP * plainsAt(p, x, z, d0, P, fine);
  if (wU > 1e-4) h += wU * uplandAt(p, x, z, d0, P, U, fine);
  if (wR > 1e-4) h += wR * rangeAt(p, x, z, d0, U, fine);
  // Fjords: where the coast is high ground (the upland come down to the sea, or the bay's shores cut into it), the straths, deep
  // as the ice left them, run on under the sea for a kilometre or two inland, shallowing towards their heads, between walls.
  const F = p.fjords, reach = 1 - smooth((d - F.reach) / 500);
  if (F.strength > 0 && d > -400 && reach > 0 && up > 0.05 && high < 0.95) {
    // (Down one family of straths only: where the two families cross, a fjord cut down both made planes meeting at the crossing,
    // which drew as a fan of flat wedges at the bay's head. Fjords do not cross.)
    const v = valleyLines(p, x, z, STRATHS, 1, p.n + 36, true), w = smooth(1 - v / 0.45) * up * (1 - high) * F.strength * reach;
    if (w > 0) h -= w * (70 + 0.75 * Math.max(0, h));
  }
  // The bay: the land sunk, less at its mouth, where the low country need go down only a little to be under the sea, and more
  // towards its head, where the upland's floors must go under; but not so far that its hills do, which stand as headlands and islands.
  if (bay > 0) h -= bay * (70 + 110 * smooth(d0 / p.bay.depth));
  return h;
}

/** How the world's lattice is worn: deep for its size, so that rivers cut real valleys into the upland and the range. */
export const WORLD_WEAR: Wear = {
  // (Building up no more than six metres anywhere, and putting down less: with eighteen, the rivers built fans where they came out
  // into the bay, all at that height, which drew as flat wedges fanning out from the bay's head.)
  cut: 40, fill: 6,
  water: { drops: 1.0, life: 90, inertia: 0.15, capacity: 0.5, erode: 0.15, deposit: 0.15, evaporate: 0.012, gravity: 4, radius: 2, most: 1.5 },
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
  regions: { sea: string; bay: string; upland: string; range: string };
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

/** The world's lattice: 8 metres (751 points by 1,251 for a world of six kilometres by ten). */
const CELL = 8;
/** A river on the map from forty hectares of ground draining through it. */
export const RIVER = 4e5;

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

/** A tile of the finer lattice: five metres, 2.4 kilometres square, in coordinates of its own about its middle (`ox`, `oz` in the world). */
export interface Tile { i: number; j: number; ox: number; oz: number; field: HeightField; acc: Float32Array; down: Int32Array }
/** The tiles' grid: a tile every two kilometres, each reaching two hundred metres over its neighbours on every side, on a lattice of 5 metres, as the islands' and the valleys' own frames are. */
export const TILE = { cell: 5, n: 481, stride: 2000, over: 200 };

const TILES = new Map<string, Tile>();
/** The tile at (`i`, `j`) of a world: made when first asked for, and kept. */
export function worldTile(w: World, i: number, j: number): Tile {
  const key = `${w.plan.seed}/${w.plan.hx}x${w.plan.hz}/${i},${j}`;
  let t = TILES.get(key);
  if (t) return t;
  const p = w.plan, half = ((TILE.n - 1) * TILE.cell) / 2;
  const ox = -p.hx + TILE.stride / 2 + i * TILE.stride, oz = -p.hz + TILE.stride / 2 + j * TILE.stride;
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
const SEARCH = { isleTiles: 8, uplandTiles: 8, keep: 4 };

const WORLDS = new Map<string, World>();

/** The world of a seed: made when first asked for, and kept. */
export function world(seed: string, size: { x: number; z: number } = WORLD_SIZE): World {
  const steps = worldSteps(seed, size);
  for (;;) { const s = steps.next(); if (s.done) return s.value; }
}

/** The world made a stage at a time: each `yield` says what is being done next, so a page can paint between stages. */
export function* worldSteps(seed: string, size: { x: number; z: number } = WORLD_SIZE): Generator<string, World> {
  const key = `${seed}@${size.x}x${size.z}`, had = WORLDS.get(key);
  if (had) return had;
  const p = planWorld(seed, size), rng = new Rng(`world/${seed}`), timing: Record<string, number> = {}, why: Record<string, Record<string, number>> = { island: {}, valley: {}, mountain: {} };
  let t0 = performance.now();
  const lap = (k: string) => { const t = performance.now(); timing[k] = Math.round(t - t0); t0 = t; };
  yield 'Shaping the land';
  const NX = Math.round((2 * p.hx) / CELL) + 1, NZ = Math.round((2 * p.hz) / CELL) + 1;
  const f = new HeightField(-p.hx, -p.hz, CELL, NX, NZ), keep = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = f.x0 + i * CELL, z = f.z0 + j * CELL, k = j * NX + i;
    f.data[k] = worldShape(p, x, z);
    // (The shelf is spared on this lattice: its islands are a few points across here, and are worn in the tiles instead. So is the
    // floor of the sea wherever it is, fjords' too: what the water brought down would build sills across them.)
    keep[k] = Math.max(zonesAt(p, x, z).wI, smooth(-f.data[k] / 15));
  }
  lap('shape');
  yield 'Wearing it with water and frost';
  const shaped = wear(f, rng.fork('wear'), WORLD_WEAR, keep);
  lap('wear');
  yield 'Following the water';
  const n = NX * NZ, h = f.data, sea = new Uint8Array(n);
  {
    // The sea: whatever lies below its level and is joined to the world's edge by more of the same.
    const q: number[] = [];
    for (let k = 0; k < n; k++) { const i = k % NX, j = (k - i) / NX; if ((i === 0 || j === 0 || i === NX - 1 || j === NZ - 1) && h[k] < 0) { sea[k] = 1; q.push(k); } }
    for (let c = 0; c < q.length; c++) {
      const k = q[c], i = k % NX, j = (k - i) / NX;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, m = jj * NX + ii;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || sea[m] || h[m] >= 0) continue;
        sea[m] = 1; q.push(m);
      }
    }
  }
  // (Hollows deeper than a loch get an outlet cut; the rest are lochs, some of them long ones down a valley's floor.)
  breach(f, sea, 15);
  const { filled, acc, down } = drain(f, sea);
  const lake = new Float32Array(n);
  for (let k = 0; k < n; k++) if (!sea[k] && filled[k] - h[k] > 0.8) lake[k] = Math.max(0.01, filled[k]);
  // (A lake of a few points is a hollow the wear left, not a lake: let it go.)
  {
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (!lake[s] || seen[s]) continue;
      const cells = [s];
      seen[s] = 1;
      for (let c = 0; c < cells.length; c++) {
        const k = cells[c], i = k % NX, j = (k - i) / NX;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj, m = jj * NX + ii;
          if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || seen[m] || !lake[m]) continue;
          seen[m] = 1; cells.push(m);
        }
      }
      if (cells.length < 40) for (const k of cells) lake[k] = 0;
    }
  }
  const rivers = traceRivers(f, sea, acc, down);
  lap('water');
  yield 'Seeing what grows';
  const cover = coverOf(p, f, sea, lake, acc);
  lap('cover');
  const w: World = { plan: p, name: '', regions: { sea: '', bay: '', upland: '', range: '' }, peakNames: [], field: f, shaped, sea, lake, cover, acc, down, rivers, places: [], towns: [], ways: [], timing, why };

  // ---- the places
  // Islands and valley heads, in the tiles where the shelf has land and where the upland is.
  const tilesX = Math.round((2 * p.hx) / TILE.stride), tilesZ = Math.round((2 * p.hz) / TILE.stride);
  const isleTiles: { i: number; j: number; score: number }[] = [], uplandTiles: { i: number; j: number; score: number }[] = [];
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    let isle = 0, up = 0, all = 0;
    const cx = -p.hx + TILE.stride / 2 + i * TILE.stride, cz = -p.hz + TILE.stride / 2 + j * TILE.stride;
    for (let z = cz - TILE.stride / 2; z < cz + TILE.stride / 2; z += 80) for (let x = cx - TILE.stride / 2; x < cx + TILE.stride / 2; x += 80) {
      const zn = zonesAt(p, x, z), y = f.at(x, z);
      all++;
      if ((zn.wI > 0.5 || zn.bay > 0.3) && y > -12) isle++;
      if (zn.wU > 0.6 && y > 20) up++;
    }
    if (isle / all > 0.04) isleTiles.push({ i, j, score: isle / all });
    if (up / all > 0.3) uplandTiles.push({ i, j, score: up / all });
  }
  isleTiles.sort((a, b) => b.score - a.score); uplandTiles.sort((a, b) => b.score - a.score);
  const isles: WorldPlace[] = [], valleys: WorldPlace[] = [];
  // (Only in the tile's own two kilometres, what lies in its overlap being the neighbour's; and four hundred metres in from the world's
  // edge at least, so that what is seen from a place is the world's own.)
  const core = (t: Tile, x: number, z: number) => Math.abs(x - t.ox) <= TILE.stride / 2 && Math.abs(z - t.oz) <= TILE.stride / 2 && Math.abs(x) < p.hx - 400 && Math.abs(z) < p.hz - 400;
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
      if (valleys.some((o) => Math.hypot(o.x - x, o.z - z) < 700)) continue;
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
  w.regions = { sea: namer.name('sea'), bay: namer.name('bay'), upland: namer.name('upland'), range: namer.name('range') };
  w.peakNames = p.peaks.map(() => namer.name('peak'));
  for (const t of w.towns) t.name = namer.name(t.kind);
  for (const q of w.places) q.name = namer.name(q.kind);
  WORLDS.set(key, w);
  return w;
}

/** Rivers as lines, from where forty hectares drain through a point down to the sea, a lake's still water, or where one joins another. */
function traceRivers(f: HeightField, sea: Uint8Array, acc: Float32Array, down: Int32Array): River[] {
  const n = f.nx * f.nz, nx = f.nx, inflow = new Uint8Array(n), done = new Uint8Array(n), out: River[] = [];
  for (let k = 0; k < n; k++) if (acc[k] >= RIVER && down[k] >= 0) inflow[down[k]]++;
  const at = (k: number): [number, number] => [f.x0 + (k % nx) * f.cell, f.z0 + Math.floor(k / nx) * f.cell];
  // (Width on the map, in metres: a burn a metre or two, a river at its mouth twenty and more.)
  const width = (a: number) => Math.min(25, 1.5 + 3 * Math.sqrt(a / RIVER));
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
    const tree = 300 + 60 * fbmd(x / 2000, z / 2000, 2, p.n + 51), snow = 700 + 40 * fbmd(x / 2000 + 3, z / 2000, 2, p.n + 52);
    const zn = zonesAt(p, x, z);
    // (Above the trees, heath and rough grazing, broken by rock where it is steep or high; snow lies late only on the great peaks.)
    if (y > snow && slope < 1.1) out[k] = C.snow;
    else if (slope > 0.75 || y > tree + 250 + 60 * fbmd(x / 500, z / 500, 2, p.n + 55)) out[k] = C.rock;
    else if (y > tree) out[k] = C.moor;
    else if (bySea && y < 6 && slope < 0.3) out[k] = C.shore;
    else if (y < 12 && slope < 0.02 && acc[k] > 2e4) out[k] = C.marsh;
    else {
      // Fields on gentle low ground, woods on slopes and in patches, thinning out up the upland, whose higher ground is
      // mostly heath and rough grazing, with the woods down in its glens.
      const arable = (slope < 0.07 ? 1 : 0) * (1 - smooth((y - 90) / 60)) * (1 - zn.wR);
      const woods = fbmd(x / 900 + 7, z / 900, 4, p.n + 53) + 0.3 * smooth((slope - 0.12) / 0.3) - 0.18 * arable - 0.5 * smooth((y - 70) / 150) * (zn.wU + zn.wR);
      if (woods > 0.14) out[k] = C.forest;
      else if (arable > 0.5 && fbmd(x / 600 - 3, z / 600, 3, p.n + 54) > -0.12) out[k] = C.fields;
      else if (zn.wU + zn.wR > 0.5 && y > tree - 80) out[k] = C.moor;
      else out[k] = C.pasture;
    }
  }
  return out;
}

/**
 * Summits for mountain tops: in the range, a summit with nothing as high within three hundred
 * metres, standing a hundred and eighty metres or more over the valleys a kilometre about it,
 * not on the flanks of a great peak, and with a ridge running down from it that a way could come
 * up: falling steadily for some four hundred and fifty metres, the ground lower on both hands.
 * (The mountain top as a site was made for a country three times as high; when it is fitted to
 * one of these, its cloud and the valleys under it come down to suit.)
 */
function findSummits(w: World, why: Record<string, number>): WorldPlace[] {
  const no = (k: string) => { why[k] = (why[k] ?? 0) + 1; };
  const f = w.field, h = f.data, p = w.plan, out: WorldPlace[] = [];
  // (Four hundred metres in from the world's edge, as the other places are; the window the ground joined to it is looked over in
  // stops at the edge. Kept a window's breadth from the edge, as first written for a larger world, half the range was never looked at.)
  const NX = f.nx, NZ = f.nz, R = Math.round(300 / CELL), W = Math.round(1200 / CELL), E = Math.round(400 / CELL), mark = new Int32Array(NX * NZ);
  let stamp = 0;
  for (let j = E; j < NZ - E; j++) for (let i = E; i < NX - E; i++) {
    const k = j * NX + i, y = h[k];
    if (y < 250) continue;
    let top = true;
    for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && h[k + dj * NX + di] > y) { top = false; break; }
    if (!top) continue;
    const x = f.x0 + i * CELL, z = f.z0 + j * CELL;
    if (zonesAt(p, x, z).wR < 0.5) { no('not in the range'); continue; }
    for (let dj = -R; dj <= R && top; dj++) for (let di = -R; di <= R; di++) if (di * di + dj * dj <= R * R && h[k + dj * NX + di] > y) { top = false; break; }
    if (!top) { no('higher near'); continue; }
    // It must stand alone over the cloud, which lies some forty metres under the top: the ground joined to it above that must hold
    // nothing higher, within twelve hundred metres.
    const cloud = y - 40, q = [k];
    mark[k] = ++stamp;
    let joined = false;
    for (let c = 0; c < q.length && !joined; c++) {
      const m = q[c], mi = m % NX, mj = (m - mi) / NX;
      for (const o of [m - 1, m + 1, m - NX, m + NX]) {
        if (o < 0 || o >= NX * NZ) continue;
        const oi = o % NX, oj = (o - oi) / NX;
        if (mark[o] === stamp || h[o] <= cloud) continue;
        if (Math.abs(oi - i) > W || Math.abs(oj - j) > W || Math.abs(oi - mi) > 1) continue;
        if (h[o] > y) { joined = true; break; }
        mark[o] = stamp; q.push(o);
      }
    }
    if (joined) { no('joined to higher over the cloud'); continue; }
    if (p.peaks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 1.3)) { no('on a great peak'); continue; }
    if (y > 700) { no('too high'); continue; }
    let low = Infinity;
    for (let a = 0; a < 24; a++) for (const r of [700, 900, 1100]) low = Math.min(low, f.at(x + Math.cos((a / 24) * TAU) * r, z + Math.sin((a / 24) * TAU) * r));
    if (y - low < 180) { no('not standing high'); continue; }
    // Its ridge: of the ways down, the one that falls most steadily along a crest. (The site's way comes up some three hundred
    // metres of ridge, falling a hundred; this asks for a ridge half as long again, the ground lower on both hands.)
    let best: { angle: number; score: number } | null = null;
    for (let s = 0; s < 32; s++) {
      const a = (s / 32) * TAU, cx = Math.cos(a), cz = Math.sin(a);
      let ok = true, sides = Infinity, prev = y;
      for (let t = 50; t <= 450 && ok; t += 50) {
        const lx = x + cx * t, lz = z + cz * t, ly = f.smoothAt(lx, lz);
        // (Down, or over a knoll on the way, and never down more than a crag would go.)
        if (ly > prev + 15 || prev - ly > 60) ok = false;
        prev = ly;
        if (t <= 400) for (const side of [-1, 1]) sides = Math.min(sides, ly - f.smoothAt(lx - cz * side * 100, lz + cx * side * 100));
      }
      const fallen = y - prev;
      if (!ok || sides < 6 || fallen < 40 || fallen > 260) continue;
      const score = Math.min(sides, 60) / 20 - Math.abs(fallen - 130) / 60;
      if (!best || score > best.score) best = { angle: a, score };
    }
    if (!best) { no('no ridge'); continue; }
    const fx = x + Math.cos(best.angle) * 450, fz = z + Math.sin(best.angle) * 450;
    out.push({ kind: 'mountain', n: 0, name: '', x, z, y, score: best.score + Math.min(350, y - low) / 110, ridge: { angle: best.angle, foot: [fx, fz], footY: f.smoothAt(fx, fz) } });
  }
  out.sort((a, b) => b.score - a.score);
  const kept: WorldPlace[] = [];
  for (const q of out) if (!kept.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 900)) kept.push(q);
  return kept;
}

/**
 * Towns, as placeholders for what the low country will one day hold: a harbour where a river comes
 * out to the sea, nearest the islands; market towns where rivers run through the low country; and
 * villages, on good ground near water, in the low country and up the broad glens.
 */
function settle(w: World, rng: Rng): Town[] {
  const f = w.field, h = f.data, p = w.plan, towns: Town[] = [];
  const NX = f.nx, NZ = f.nz, all = NX * NZ;
  const at = (k: number) => ({ x: f.x0 + (k % NX) * CELL, z: f.z0 + Math.floor(k / NX) * CELL, y: h[k] });
  const slopeAt = (k: number) => { const i = k % NX, j = (k - i) / NX; if (i < 1 || j < 1 || i > NX - 2 || j > NZ - 2) return 1; return Math.hypot(h[k + 1] - h[k - 1], h[k + NX] - h[k - NX]) / (2 * CELL); };
  const isles = w.places.filter((q) => q.kind === 'island');
  const ix = isles.length ? isles.reduce((s, q) => s + q.x, 0) / isles.length : 0, iz = isles.length ? isles.reduce((s, q) => s + q.z, 0) / isles.length : 0;
  // The harbour: a river's mouth, the larger the river and the nearer the islands the better.
  let harbour = -1, best = -Infinity;
  for (let k = 0; k < all; k++) {
    if (w.acc[k] < RIVER || w.sea[k] || w.down[k] < 0 || !w.sea[w.down[k]]) continue;
    const { x, z } = at(k), score = Math.log(w.acc[k]) * 2 - (isles.length ? Math.hypot(x - ix, z - iz) / 500 : 0);
    if (score > best) { best = score; harbour = k; }
  }
  if (harbour < 0) for (let k = 0; k < all; k++) {
    // (No river comes out to the sea: then the gentlest shore.)
    if (w.cover[k] !== COVER.shore) continue;
    const { x, z } = at(k), score = -slopeAt(k) * 50 - (isles.length ? Math.hypot(x - ix, z - iz) / 500 : 0);
    if (score > best) { best = score; harbour = k; }
  }
  if (harbour >= 0) towns.push({ kind: 'harbour', name: '', ...at(harbour) });
  const clear = (x: number, z: number, d: number) => towns.every((t) => Math.hypot(t.x - x, t.z - z) >= d);
  // Market towns: on a river in the low country, on gentle ground; the largest rivers first, well apart.
  const sites: number[] = [];
  for (let k = 0; k < all; k++) if (w.acc[k] >= 2 * RIVER && !w.sea[k] && !w.lake[k] && h[k] > 2 && h[k] < 120 && slopeAt(k) < 0.05) sites.push(k);
  sites.sort((a, b) => w.acc[b] - w.acc[a]);
  for (const k of sites) {
    const t = at(k);
    if (towns.filter((q) => q.kind === 'town').length >= 2) break;
    if (zonesAt(p, t.x, t.z).wR > 0.3 || !clear(t.x, t.z, 1800)) continue;
    towns.push({ kind: 'town', name: '', ...t });
  }
  // Villages: by water, on fields or pasture, eight hundred metres apart and more.
  const near: number[] = [];
  for (let k = 0; k < all; k += 3) if ((w.cover[k] === COVER.fields || w.cover[k] === COVER.pasture) && w.acc[k] > 3e4 && slopeAt(k) < 0.08) near.push(k);
  for (let tries = 0; tries < 4000 && near.length && towns.filter((q) => q.kind === 'village').length < 8; tries++) {
    const t = at(near[rng.int(0, near.length - 1)]);
    if (!clear(t.x, t.z, 800)) continue;
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
  // (On a lattice of twice the world's: a way finer than sixteen metres is not seen on a map of eight kilometres.)
  const f = w.field, S = 2, n = Math.floor((f.nx - 1) / S) + 1, m2 = Math.floor((f.nz - 1) / S) + 1, cell = CELL * S, x0 = f.x0, z0 = f.z0;
  const H = new Float32Array(n * m2), water = new Uint8Array(n * m2), river = new Uint8Array(n * m2), made = new Uint8Array(n * m2), madeList: number[] = [];
  // (Ground that is a little worse or better going, in patches some hundreds of metres across, for what a lattice cannot know: a
  // farm in the way, a bog, a ford. On the flat it makes a way wander, as ways do, where otherwise it ran ruled along the lattice.)
  const going = new Float32Array(n * m2);
  for (let g = 0; g < n * m2; g++) going[g] = 0.7 + 0.6 * valueNoise2((x0 + (g % n) * cell) / 250, (z0 + Math.floor(g / n) * cell) / 250, w.plan.n + 71);
  const mark = (g: number) => { if (!made[g]) { made[g] = 1; madeList.push(g); } };
  for (let j = 0; j < m2; j++) for (let i = 0; i < n; i++) {
    const k = j * S * f.nx + i * S, g = j * n + i;
    H[g] = f.data[k]; water[g] = w.sea[k] || w.lake[k] ? 1 : 0; river[g] = w.acc[k] >= RIVER * 3 ? 1 : 0;
  }
  const idx = (x: number, z: number) => Math.min(m2 - 1, Math.max(0, Math.round((z - z0) / cell))) * n + Math.min(n - 1, Math.max(0, Math.round((x - x0) / cell)));
  const pt = (g: number): [number, number] => [x0 + (g % n) * cell, z0 + Math.floor(g / n) * cell];
  const ways: WorldWay[] = [];
  // What a step costs, for each kind of way: how steep it may be before it pays heavily, and what a bridge costs.
  const KIND = { road: { steep: 0.07, bridge: 120, reuse: 0.4 }, track: { steep: 0.11, bridge: 90, reuse: 0.5 }, path: { steep: 0.3, bridge: 60, reuse: 0.6 } };
  const route = (kind: 'road' | 'track' | 'path', from: [number, number], to: [number, number]): [number, number][] | null => {
    const o = KIND[kind];
    const cost = (a: number, b: number) => {
      if (water[b]) return Infinity;
      const di = Math.abs((a % n) - (b % n)), len = cell * (di && Math.abs(a - b) !== 1 ? Math.SQRT2 : 1), s = Math.abs(H[b] - H[a]) / len;
      let c = len * (1 + (s / o.steep) ** 2) * going[b];
      if (river[b] && !river[a]) c += o.bridge;
      return made[b] ? c * o.reuse : c;
    };
    const line = leastPath(x0, z0, cell, n, m2, from, to, cost);
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
        if (i < 0 || j < 0 || i >= n || j >= m2 || !water[j * n + i]) continue;
        return pt(j * n + i);
      }
      return null;
    };
    const from = wet(harbour.x, harbour.z);
    for (const q of w.places) {
      if (q.kind !== 'island' || !from) continue;
      const to = wet(q.island!.cu, q.island!.cv);
      if (!to) continue;
      const line = leastPath(x0, z0, cell, n, m2, from, to, seaCost);
      if (line) ways.push({ kind: 'ferry', points: smoothLine([[harbour.x, harbour.z], ...line], 3) });
    }
  }
  return ways;
}
