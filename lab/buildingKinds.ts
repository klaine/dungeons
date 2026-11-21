// The buildings the building lab can set out, and the measures each may be given: what is dealt
// when one is added, how far each measure may be pushed before the builder no longer makes sense
// of it, and the site document that is built from it. No page and no drawing here, so that a
// check can build every kind at the ends of its ranges without a browser (`tools/buildingLab.ts`).
//
// Every building is built by the game's own builders (`buildBuilding` in `src/render/buildings.ts`)
// from a site document, as a valley builds it; only where it stands, which way it is turned and how
// it is scaled are the lab's. The document is always made at the origin facing `w`, and the lab
// places what is built.
import { classicalVariations, CLOSE, dealDress, floorOf, footprintOf, freeAtEnds, groundOf, planClassical, planTimber, PLAIN_DRESS, timberFloor } from '../src/core/building';
import { brickCountry, brickEaves, dealBrickHouse, dealChurch, planBrick } from '../src/core/brick';
import { Rng } from '../src/core/rng';
import { Vector3 } from 'three';
import { BrickWork, Building, CanalWork, ClassicalDress, Stone, Town } from '../src/core/site';
import { canalEaves, dealCanalHouse, planCanal } from '../src/core/canal';
import { buildBuilding } from '../src/render/buildings';
import { placeHouse } from '../src/render/housePlacing';
import { anyAngle } from '../src/render/geom/anyAngle';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { stoneStyles } from '../src/render/geom/styles';
import { buildShack } from '../src/render/shack';
import { CardSet } from '../src/render/scene';
import { boulderOne, crownOf, growOne, Season, TREE_DEALT, TREE_RANGES, TreeKind, TREES, TreeWork } from './nature';

export type Kind = 'timber' | 'classical' | 'wooden' | 'gabled' | 'eaves' | 'store' | 'canal' | 'church' | 'shack' | 'tree' | 'boulder';
/** A shack's own measures, beyond its breadth, depth and colour: its roof, whether the roof is one slope, and how high it stands on posts. */
export interface ShackWork { roof: 'boards' | 'tin' | 'turf'; lean: boolean; stilts: number }
/**
 * What a building is, apart from where it stands: the measures of the site document that the lab lets be changed. (A shack is not a
 * building of the site document but a record of the town's; it is carried here as a breadth, a depth and a colour, and `shack`.)
 */
// (A tree and a boulder are not buildings either: each is carried as a breadth and a depth the size of its crown or itself, for picking it
// out and keeping others off it, and `tree` or `boulder`.)
export type Shape = Omit<Building, 'x' | 'z' | 'faces' | 'plan' | 'backDoor' | 'sunk' | 'wheel' | 'turn' | 'y'> & { shack?: ShackWork; tree?: TreeWork; boulder?: { size: number } };
type Colour = [number, number, number];

/** One building set out in the lab. */
export interface Item {
  id: number;
  kind: Kind;
  /** What the builder's own choices are made from: door colours, which rooms are lit, how the rooms are dealt. */
  seed: string;
  /** Where the middle of its main block stands, in metres. */
  x: number;
  z: number;
  /** Which way its front looks, in degrees: 0 is towards +z, and it turns anticlockwise seen from above. */
  turn: number;
  /** Stretched as a whole along its breadth, its height and its depth (bricks, windows and all), apart from its measures. */
  scale: [number, number, number];
  /** Of a timber house: it is an inn, and hangs out a sign. */
  inn?: boolean;
  shape: Shape;
}

export const KINDS: Record<Kind, { name: string; note: string }> = {
  timber: { name: 'Timber house', note: 'Framed storeys jettied out over a plastered ground storey, as in Alsace and the Moselle.' },
  classical: { name: 'Classical', note: 'Stucco of the early nineteenth century: a rusticated ground storey, tall windows, a cornice, often a portico and wings.' },
  wooden: { name: 'Wooden house', note: 'A classical house of weatherboards on a granite basement, as the small northern towns built them: one storey or two, its door up steps in an end wall, dormers in its roof.' },
  shack: { name: 'Shack', note: 'One room of boards under tarred boards, tin or turf, as on the fringes of the harbour town; on the ground or on posts.' },
  gabled: { name: "Merchant's house", note: 'Brick, narrow and deep, its steep gable to the street: stepped, between piers, curved or plain.' },
  eaves: { name: 'Eaves house', note: 'Brick, broader and later, its eaves to the street and a small gable over its middle.' },
  store: { name: 'Warehouse', note: 'Brick, many low storeys, a column of loading doors under a hoist.' },
  church: { name: 'Church', note: 'Brick Gothic: a buttressed hall church, a tower or two with a spire, and a choir.' },
  canal: { name: 'Canal house', note: 'Amsterdam: narrow, tall and deep, its front leaning out over the quay, a stoop to its door, and over the eaves a spout, stepped, neck or bell gable, or a cornice.' },
  tree: { name: 'Tree', note: 'Grown as the valley grows its trees: an oak, an ash, an old oak, a spruce, a pine, a pine of the coast, or a bush.' },
  boulder: { name: 'Boulder', note: 'A boulder of the country’s stone, carved as the valley’s are, bedded and broken as its rock is.' },
};
export const KIND_ORDER: Kind[] = ['classical', 'wooden', 'timber', 'gabled', 'eaves', 'store', 'canal', 'church', 'shack'];
/** What grows and what lies about, set out one by one as buildings are; and every kind the lab knows. */
export const NATURE_ORDER: Kind[] = ['tree', 'boulder'];
export const ALL_KINDS: Kind[] = [...KIND_ORDER, ...NATURE_ORDER];
export const isNature = (kind: Kind): boolean => kind === 'tree' || kind === 'boulder';

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const odd = (v: number) => { const n = Math.round(v); return n % 2 ? n : n + (v > n ? 1 : -1); };

/** The washes of the timber houses, of the classical fronts, and of the brick towns' rendered fronts (as the generator deals them). */
export const TIMBER_WASHES: Colour[] = [[0.86, 0.8, 0.66], [0.82, 0.62, 0.3], [0.78, 0.5, 0.44], [0.55, 0.66, 0.74], [0.6, 0.68, 0.5], [0.88, 0.87, 0.82], [0.74, 0.36, 0.26]];
export const CLASSICAL_WASHES: Colour[] = [[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78], [0.88, 0.84, 0.72]];
/** The paint of weatherboards, and the boards of shacks, as the town deals them. */
export const BOARDS: Colour[] = [[0.8, 0.55, 0.18], [0.78, 0.52, 0.2], [0.55, 0.2, 0.12], [0.86, 0.72, 0.36], [0.62, 0.68, 0.58], [0.72, 0.74, 0.72], [0.85, 0.6, 0.52]];
export const SHACK_BOARDS: Colour[] = [[0.42, 0.33, 0.24], [0.3, 0.26, 0.22], [0.5, 0.4, 0.3], [0.26, 0.3, 0.32], [0.45, 0.2, 0.15], [0.3, 0.38, 0.3]];

/** What belongs to one kind and to no other: taken away from a shape of another kind. */
const OWN = {
  classical: ['portico', 'wings', 'pediment', 'entrances', 'arch', 'brick', 'towers', 'dress'],
  wooden: ['basement', 'endDoor', 'dormers'],
  timber: ['jetty', 'gable', 'door', 'burnt'],
  brick: ['brickwork'],
  shack: ['shack'],
  canal: ['canalwork'],
  tree: ['tree'],
  boulder: ['boulder'],
} as const;
function keep(s: Shape, ...families: (keyof typeof OWN)[]): void {
  for (const [family, keys] of Object.entries(OWN)) if (!families.includes(family as keyof typeof OWN)) for (const k of keys) delete (s as Record<string, unknown>)[k];
}
/** The bays of a broad classical front's entrances, as the town sets them out: two either side of the middle, or the middle and one either side. */
export function entrancesFor(bays: number, count: 2 | 3): number[] {
  const middle = bays >> 1;
  if (count === 3) { const k = Math.max(2, Math.min(middle - 3, Math.round(bays / 4))); return [k, middle, bays - 1 - k]; }
  const k = Math.min(Math.round(bays / 4), (bays - 3) >> 1);
  return [k, bays - 1 - k];
}

/**
 * How far each measure may go. Some are tied to others, as they are when the generator deals
 * them: the breadth of a classical front, an eaves house and a church follows from its bays (each
 * bay between `pitch[0]` and `pitch[1]` metres, and `margin` at the ends), so widening one past what its
 * bays can fill adds bays, two at a time where the middle must stay a bay.
 */
export const RANGES = {
  timber: { w: [5, 11], d: [5.5, 10], storeys: [1, 4], height: [2.2, 3.8], bays: [1, 4], jetty: [0, 0.6] },
  classical: { bays: [3, 25], pitch: [2.2, 3.2], margin: 1.6, d: [8.5, 16], storeys: [1, 6], height: [2.8, 5.5], wingWidth: [5.4, 8.8], wingLength: [6, 18], towerSize: [4, 6.4], towerExtra: [1, 3], plinth: [0.5, 2.5] },
  wooden: { w: [9, 24], d: [7, 12], storeys: [1, 2], height: [2.7, 3.8], basement: [0.4, 2], dormers: [0, 5], wingWidth: [5, 10], wingLength: [5, 14] },
  shack: { w: [2.6, 6], d: [3, 6.5], stilts: [0, 2.5] },
  boulder: { size: [0.3, 8] },
  canal: { bays: [1, 7], pitch: [1.6, 2.5], margin: 1.1, d: [7, 22], storeys: [2, 7], height: [2.3, 4.8], stoop: [0, 1.6], lean: [0, 0.035], roof: [35, 62] },
  gabled: { w: [5.5, 11], d: [8, 18], storeys: [1, 5], height: [2.4, 5.2], bays: [1, 5], pitch: [40, 66] },
  eaves: { bays: [3, 9], pitch: [1.9, 2.8], margin: 1.3, d: [8, 14], storeys: [2, 5], height: [2.6, 4.6], roof: [38, 56] },
  store: { w: [6, 11.5], d: [10, 18], storeys: [3, 7], height: [2.3, 4.2], pitch: [48, 64] },
  church: { bays: [3, 8], pitch: [4.8, 6.6], d: [12, 19], wall: [8.5, 15], side: [6.5, 10], tower: [8, 26], choir: [4, 10] },
} as const;

/** How many storeys' heights the shape carries, made to match its storeys: a new storey is as high as the one under it, less a little. */
function fitHeights(s: Shape, lo: number, hi: number): void {
  const h = (s.heights ?? []).slice(0, s.storeys);
  while (h.length < s.storeys) h.push(h.length ? r2(h[h.length - 1] - (h.length > 1 ? 0.08 : 0.6)) : 3);
  s.heights = h.map((v) => r2(clamp(v, lo, hi)));
}

/** A bay count and breadth that agree: the bays kept if the breadth asked for can be filled by them, otherwise as many as fill it. */
function fitBays(s: Shape, bays: readonly number[], pitch: readonly number[], margin: number, keepOdd: boolean, asked: 'w' | 'bays'): void {
  let n = clamp(Math.round(s.bays), bays[0], bays[1]);
  if (keepOdd) n = clamp(odd(n), bays[0], bays[1]);
  if (asked === 'bays') {
    // (The bays were asked for: the breadth follows, keeping the spacing the front had.)
    const was = clamp((s.w - margin) / Math.max(1, n), pitch[0], pitch[1]);
    s.bays = n; s.w = r2(n * was + margin);
    return;
  }
  const w = clamp(s.w, bays[0] * pitch[0] + margin, bays[1] * pitch[1] + margin);
  const each = (w - margin) / n;
  if (each < pitch[0] || each > pitch[1]) {
    const mid = (pitch[0] + pitch[1]) / 2;
    n = clamp(Math.round((w - margin) / mid), bays[0], bays[1]);
    if (keepOdd) n = clamp(odd((w - margin) / mid), bays[0], bays[1]);
  }
  s.bays = n;
  s.w = r2(clamp(w, n * pitch[0] + margin, n * pitch[1] + margin));
}

/**
 * Brings a shape back within what its kind can be: every measure within its range, and those that
 * are tied to others made to agree with them. `asked` says which of a tied pair was just changed,
 * so that it is the other that gives way. Returns a new shape; the one given is not changed.
 */
export function normalise(kind: Kind, given: Shape, asked: 'w' | 'bays' = 'w'): Shape {
  const s: Shape = JSON.parse(JSON.stringify(given));
  s.colour = (s.colour ?? [0.86, 0.8, 0.66]).map((c) => clamp(c, 0, 1)) as Colour;
  if (kind === 'tree') {
    const t = s.tree ?? { kind: 'oak', height: 8.5, girth: 0.3, wide: 1, leaf: 0 }, k: TreeKind = (TREES as readonly string[]).includes(t.kind) ? t.kind : 'oak', R = TREE_RANGES[k];
    s.tree = { kind: k, height: r2(clamp(t.height, R.height[0], R.height[1])), girth: Math.round(clamp(t.girth, R.girth[0], R.girth[1]) * 1000) / 1000, wide: r2(clamp(t.wide, R.wide[0], R.wide[1])), leaf: clamp(Math.round(t.leaf), 0, 3) };
    Object.assign(s, { style: 'timber', w: r2(Math.max(0.8, crownOf(s.tree) * 1.4)), storeys: 1, heights: [s.tree.height], bays: 1 });
    s.d = s.w;
    keep(s, 'tree');
    return s;
  }
  if (kind === 'canal') {
    // (A canal house: its measures as any building's, the bays filling its breadth; the rest of what it is in `canalwork`, each choice
    // kept to what the builder makes, and those that go together kept together: a stepped gable has two to five steps a side and a neck
    // gable one or two tiers, a cornice has no crown on it, a warehouse has shutters.)
    const R = RANGES.canal;
    s.style = 'canal';
    fitBays(s, R.bays, R.pitch, R.margin, false, asked);
    s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    const c = s.canalwork ?? (deal('canal', 'lab').canalwork as CanalWork), one = <T>(v: T, list: readonly T[]) => (list.includes(v) ? v : list[0]);
    const col = (v: Colour | null | undefined, d: Colour): Colour => (Array.isArray(v) && v.length === 3 ? (v.map((x) => clamp(x, 0, 1.2)) as Colour) : d);
    const kind = one(c.kind, ['house', 'warehouse'] as const), gable = one(c.gable, ['spout', 'stepped', 'neck', 'bell', 'cornice', 'raised'] as const);
    s.canalwork = {
      kind, gable,
      tiers: gable === 'stepped' ? clamp(Math.round(c.tiers), 2, 5) : gable === 'neck' ? clamp(Math.round(c.tiers), 1, 2) : 1,
      crown: gable === 'cornice' ? 'flat' : one(c.crown, ['triangle', 'segment', 'scroll', 'flat'] as const),
      front: one(c.front, ['brick', 'painted'] as const), clay: one(c.clay, ['red', 'buff'] as const), tone: col(c.tone, [0.78, 0.66, 0.64]), trim: col(c.trim, [0.92, 0.91, 0.88]),
      ornament: clamp(Math.round(c.ornament), 0, 3) as 0 | 1 | 2 | 3, windows: one(c.windows, ['cross', 'small', 'large'] as const),
      frame: col(c.frame, [0.92, 0.91, 0.88]), shutters: c.shutters || kind === 'warehouse' ? col(c.shutters, [0.1, 0.22, 0.14]) : null, paint: col(c.paint, [0.06, 0.16, 0.1]),
      pui: c.pui ? col(c.pui, [0.1, 0.2, 0.13]) : null, stoop: r2(clamp(c.stoop, R.stoop[0], R.stoop[1])), basement: !!c.basement,
      lean: Math.round(clamp(c.lean, R.lean[0], R.lean[1]) * 1000) / 1000, door: clamp(Math.round(c.door), 0, s.bays - 1),
      pitch: r2(clamp(c.pitch, R.roof[0], R.roof[1])), roof: one(c.roof, ['red', 'dark'] as const), hoist: !!c.hoist,
    };
    keep(s, 'canal');
    return s;
  }
  if (kind === 'boulder') {
    const size = r2(clamp(s.boulder?.size ?? 1.2, RANGES.boulder.size[0], RANGES.boulder.size[1]));
    Object.assign(s, { style: 'timber', w: r2(size * 1.1), d: r2(size * 1.1), storeys: 1, heights: [r2(size * 0.7)], bays: 1, boulder: { size } });
    keep(s, 'boulder');
    return s;
  }
  if (kind === 'timber') {
    const R = RANGES.timber;
    s.style = 'timber';
    s.w = r2(clamp(s.w, R.w[0], R.w[1])); s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    // (A window wants a bay of the framing to itself: a narrow front has room for fewer.)
    s.bays = clamp(Math.round(s.bays), R.bays[0], Math.min(R.bays[1], Math.max(1, Math.floor(s.w / 1.9))));
    s.jetty = r2(clamp(s.jetty ?? 0.35, R.jetty[0], R.jetty[1]));
    s.gable = !!s.gable;
    s.door = [0.24, 0.5, 0.76].reduce((best, d) => (Math.abs(d - (s.door ?? 0.24)) < Math.abs(best - (s.door ?? 0.24)) ? d : best), 0.24);
    s.burnt = !!s.burnt;
    keep(s, 'timber');
    return s;
  }
  if (kind === 'wooden') {
    const R = RANGES.wooden;
    s.style = 'wooden';
    s.w = r2(clamp(s.w, R.w[0], R.w[1])); s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    // (Windows a little over two metres apart, as the town deals them; fewer or more as asked, within what the front can hold.)
    s.bays = clamp(Math.round(s.bays ?? (s.w - 2) / 2.2), 3, Math.max(3, Math.floor((s.w - 2) / 1.6)));
    s.basement = r2(clamp(s.basement ?? 1.1, R.basement[0], R.basement[1]));
    s.endDoor = s.endDoor === 1 ? 1 : -1;
    s.dormers = clamp(Math.round(s.dormers ?? 0), R.dormers[0], Math.min(R.dormers[1], Math.floor(s.w / 4.5)));
    // One wing at most, an L, as at a street corner. (Wings are counted the classical building's own, so put back after.)
    const g = s.wings?.[0];
    keep(s, 'wooden');
    if (g) s.wings = [{ side: g.side < 0 ? -1 : 1, width: r2(clamp(g.width, R.wingWidth[0], Math.min(R.wingWidth[1], s.w - 4))), length: r2(clamp(g.length, R.wingLength[0], R.wingLength[1])) }];
    return s;
  }
  if (kind === 'shack') {
    const R = RANGES.shack, sh = s.shack ?? { roof: 'boards', lean: false, stilts: 0 };
    // (A building of the timber style as far as its ground goes: a rectangle, its front at the front.)
    s.style = 'timber';
    s.w = r2(clamp(s.w, R.w[0], R.w[1])); s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = 1; s.heights = [2.3]; s.bays = 1;
    keep(s, 'shack');
    s.shack = { roof: (['boards', 'tin', 'turf'] as const).includes(sh.roof) ? sh.roof : 'boards', lean: !!sh.lean, stilts: r2(clamp(sh.stilts, R.stilts[0], R.stilts[1])) };
    return s;
  }
  if (kind === 'classical') {
    const R = RANGES.classical;
    s.style = 'imperial';
    fitBays(s, R.bays, R.pitch, R.margin, true, asked);
    s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    // (A middle of three bays standing forward needs wings of a bay at least either side of it.)
    s.portico = !!s.portico && s.bays >= 5;
    // Wings reach back from the ends of a broad front, each narrower than the part of the front beside the middle, so that its rooms open off the end rooms.
    const most = Math.min(R.wingWidth[1], s.w / 2 - 4);
    if (s.bays < 7 || most < R.wingWidth[0]) delete s.wings;
    else if (s.wings?.length) {
      const sides = [...new Set(s.wings.map((g) => (g.side < 0 ? -1 : 1) as -1 | 1))].sort();
      const width = r2(clamp(s.wings[0].width, R.wingWidth[0], most));
      s.wings = sides.map((side) => ({ side, width, length: r2(clamp(s.wings!.find((g) => (g.side < 0 ? -1 : 1) === side)!.length, R.wingLength[0], R.wingLength[1])) }));
    } else delete s.wings;
    keep(s, 'classical');
    // The variations the town deals: a middle that stands forward without its pediment; two or three entrances along a front of
    // eleven bays or more; a carriage way through the two bays at an end with no wing; walls of bare brick; towers at the corners.
    if (!s.portico || s.pediment !== false) delete s.pediment;
    const doors = s.entrances?.length ?? 0;
    if (s.bays < 11 || doors < 2) delete s.entrances;
    else s.entrances = entrancesFor(s.bays, doors >= 3 ? 3 : 2);
    if (s.arch) {
      if (s.wings?.length || freeAtEnds(s as Building) < 2) delete s.arch;
      else s.arch = { side: s.arch.side < 0 ? -1 : 1 };
    }
    if (s.brick !== 'stucco' && s.brick !== 'bare') delete s.brick;
    // Its dress (see `ClassicalDress`), within what the plan can make of it: a middle that leaves at least a bay either side of it, and
    // pavilions that leave a bay between them and the middle; one entrance where there is a broad middle or pavilions; three doors
    // only into a hall three bays broad; the ground never falling so far that its upper end comes up to the floor.
    const d: ClassicalDress = { ...PLAIN_DRESS, ...(s.dress ?? {}) }, middle = s.bays >> 1;
    d.centre = s.portico ? clamp(odd(d.centre), 3, Math.max(3, Math.min(9, s.bays - 2))) : 3;
    d.order = s.portico && d.order === 'columns' ? 'columns' : 'pilasters';
    const beside = s.portico ? middle - (d.centre - 1) / 2 : middle - (s.bays >= 7 ? 1 : 0);
    d.pavilions = clamp(Math.round(d.pavilions), 0, Math.max(0, Math.min(3, beside - 1)));
    if ((d.centre > 3 || d.pavilions) && s.entrances) delete s.entrances;
    if (d.pavilions && s.arch) delete s.arch;
    d.arches = clamp(Math.round(d.arches), 0, s.storeys > 1 ? 2 : 1) as 0 | 1 | 2;
    d.heads = (['plain', 'cornice', 'alternate', 'pediments'] as const).includes(d.heads) ? d.heads : 'alternate';
    d.rusticated = d.rusticated !== false; d.frieze = !!d.frieze; d.balustrade = !!d.balustrade; d.flag = !!d.flag;
    d.tympanum = (['window', 'oculus', 'clock', 'plain'] as const).includes(d.tympanum) ? d.tympanum : 'window';
    d.roof = (['dealt', 'grey', 'green', 'red', 'black', 'copper', 'tiles', 'dark'] as const).includes(d.roof) ? d.roof : 'dealt';
    d.style = (['empire', 'quoins', 'lesenes', 'bare'] as const).includes(d.style) ? d.style : 'empire';
    d.doors = d.doors === 3 && (s.portico || s.bays >= 7) && !s.entrances ? 3 : 1;
    d.plinth = r2(clamp(d.plinth, R.plinth[0], R.plinth[1]));
    const steepest = 2 * (d.plinth - 0.35);
    d.fall = r2(clamp(d.fall, -steepest, steepest));
    // (Dressed as the first of them were, it carries no dress at all.)
    if ((Object.keys(PLAIN_DRESS) as (keyof ClassicalDress)[]).every((key) => d[key] === PLAIN_DRESS[key])) delete s.dress;
    else s.dress = d;
    if (s.towers?.length && s.wings?.length) {
      const front = Math.min(R.towerSize[1], s.w / 2 - 3.5), seen = new Set<string>();
      s.towers = s.towers.filter((t) => {
        const wing = s.wings!.find((g) => g.side === t.side), key = `${t.corner}${t.side}`;
        if (seen.has(key) || (t.corner === 'wing' && !wing) || (t.corner === 'back' && wing)) return false;
        seen.add(key);
        return true;
      }).map((t) => {
        const most = t.corner === 'wing' ? Math.min(front, s.wings!.find((g) => g.side === t.side)!.width) : front;
        return { corner: t.corner, side: (t.side < 0 ? -1 : 1) as -1 | 1, size: r2(clamp(t.size, R.towerSize[0], most)), extra: clamp(Math.round(t.extra), R.towerExtra[0], R.towerExtra[1]) };
      }).filter((t) => t.size >= R.towerSize[0] && (t.corner !== 'wing' || s.wings!.find((g) => g.side === t.side)!.width >= R.towerSize[0]) && (t.corner === 'wing' || Math.min(R.towerSize[1], s.w / 2 - 3.5) >= R.towerSize[0]));
      if (!s.towers.length) delete s.towers;
    } else delete s.towers;
    return s;
  }
  // The brick family.
  s.style = 'brick';
  const bw: BrickWork = { ...(s.brickwork as BrickWork) };
  bw.kind = kind;
  bw.clay = bw.clay === 'buff' ? 'buff' : 'red';
  bw.tone = (bw.tone ?? [1, 1, 1]).map((c) => clamp(c, 0.5, 1.4)) as Colour;
  bw.rendered = !!bw.rendered; bw.glazed = !!bw.glazed;
  bw.roof = (['red', 'dark', 'copper'] as const).includes(bw.roof) ? bw.roof : 'red';
  bw.door = [0.28, 0.5, 0.72].reduce((best, d) => (Math.abs(d - bw.door) < Math.abs(best - bw.door) ? d : best), 0.5);
  keep(s, 'brick');
  if (kind === 'gabled') {
    const R = RANGES.gabled;
    s.w = r2(clamp(s.w, R.w[0], R.w[1])); s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    bw.gable = (['stepped', 'piers', 'volute', 'plain'] as const).includes(bw.gable) ? bw.gable : 'stepped';
    if (bw.gable === 'piers') {
      // Piers rise through the gable into pinnacles, and the windows stand between them: two columns to each space either side of the middle.
      bw.steps = clamp(Math.round(bw.steps), 1, Math.max(1, Math.floor((s.w - 0.54) / 2.4)));
      s.bays = bw.steps * 2;
    } else {
      bw.steps = bw.gable === 'stepped' ? clamp(Math.round(bw.steps), 2, Math.max(2, Math.min(8, Math.floor(s.w / 1.05))))
        : bw.gable === 'volute' ? clamp(Math.round(bw.steps), 1, 4) : 0;
      s.bays = clamp(Math.round(s.bays), R.bays[0], Math.min(R.bays[1], Math.max(1, Math.floor((s.w - 1.5) / 1.5))));
    }
    bw.niches = bw.gable === 'stepped' || bw.gable === 'piers' ? ((['white', 'brick', 'none'] as const).includes(bw.niches) ? bw.niches : 'none') : 'none';
    bw.pitch = r2(clamp(bw.pitch, R.pitch[0], R.pitch[1]));
    delete bw.church;
  } else if (kind === 'eaves') {
    const R = RANGES.eaves;
    fitBays(s, R.bays, R.pitch, R.margin, false, asked);
    s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    bw.gable = (['plain', 'volute', 'stepped'] as const).includes(bw.gable as 'plain') ? bw.gable : 'plain';
    bw.steps = bw.gable === 'plain' ? 0 : clamp(Math.round(bw.steps), 1, 3);
    bw.niches = 'none';
    bw.pitch = r2(clamp(bw.pitch, R.roof[0], R.roof[1]));
    delete bw.church;
  } else if (kind === 'store') {
    const R = RANGES.store;
    s.w = r2(clamp(s.w, R.w[0], R.w[1])); s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = clamp(Math.round(s.storeys), R.storeys[0], R.storeys[1]);
    fitHeights(s, R.height[0], R.height[1]);
    // (An odd number of columns, so that the loading doors are the middle one.)
    s.bays = clamp(odd(s.bays), 3, Math.max(3, odd(Math.floor((s.w - 1.5) / 1.4) - 0.5)));
    bw.gable = bw.gable === 'stepped' ? 'stepped' : 'plain';
    bw.steps = clamp(Math.round(bw.steps), 3, 6);
    bw.niches = (['white', 'brick', 'none'] as const).includes(bw.niches) ? bw.niches : 'none';
    bw.pitch = r2(clamp(bw.pitch, R.pitch[0], R.pitch[1]));
    delete bw.church;
  } else {
    const R = RANGES.church;
    fitBays(s, R.bays, R.pitch, 0, false, asked);
    s.d = r2(clamp(s.d, R.d[0], R.d[1]));
    s.storeys = 1;
    s.heights = [r2(clamp(s.heights?.[0] ?? 11, R.wall[0], R.wall[1]))];
    bw.gable = bw.gable === 'piers' ? 'piers' : 'stepped';
    bw.steps = clamp(Math.round(bw.steps), 3, 7);
    bw.niches = bw.niches === 'brick' ? 'brick' : 'white';
    const c = { ...(bw.church ?? { end: 1, towers: 1, side: 8, height: 26, spire: 'needle', spireHeight: 24, choir: 'apse', choirLength: 7 }) } as NonNullable<BrickWork['church']>;
    c.end = c.end < 0 ? -1 : 1;
    // (Two towers fill the end between them, so the nave must be broad enough for two.)
    c.towers = c.towers === 2 && s.d >= 15 ? 2 : 1;
    c.side = c.towers === 2 ? r2(s.d / 2 - 0.4) : r2(clamp(c.side, R.side[0], Math.min(R.side[1], s.d - 2)));
    c.height = r2(clamp(c.height, s.heights[0] + R.tower[0], s.heights[0] + R.tower[1]));
    c.spire = (['needle', 'corners', 'saddle'] as const).includes(c.spire) ? c.spire : 'needle';
    c.spireHeight = c.spire === 'saddle' ? 0 : r2(clamp(c.spireHeight, c.spire === 'needle' ? 12 : 10, c.spire === 'needle' ? 36 : 24));
    c.choir = c.choir === 'flat' ? 'flat' : 'apse';
    c.choirLength = r2(clamp(c.choirLength, R.choir[0], R.choir[1]));
    bw.church = c;
    bw.pitch = r2(clamp(bw.pitch, 46, 62));
  }
  s.brickwork = bw;
  return s;
}

/** A building of the kind, dealt from the seed as the generator deals one: the same rules, so that what is added is something a valley could hold. */
/** A tree of one kind, dealt from the seed as the valley deals them. */
export function dealTree(kind: TreeKind, seed: string): Shape {
  const rng = new Rng(`lab tree ${kind} ${seed}`), d = TREE_DEALT[kind];
  return normalise('tree', { style: 'timber', w: 1, d: 1, storeys: 1, heights: [1], bays: 1, colour: [0.3, 0.4, 0.2], tree: { kind, height: rng.range(d.height[0], d.height[1]), girth: rng.range(d.girth[0], d.girth[1]), wide: rng.range(d.wide[0], d.wide[1]), leaf: rng.int(0, 3) } });
}

export function deal(kind: Kind, seed: string, stone: Stone = 'greystone'): Shape {
  const rng = new Rng(`lab ${kind} ${seed}`), round = (v: number) => Math.round(v * 10) / 10;
  if (kind === 'tree') return dealTree(rng.pick(['oak', 'oak', 'ash', 'spruce', 'pine', 'bush'] as const), seed);
  // (As a town deals them, of the country's clay.)
  if (kind === 'canal') return normalise(kind, dealCanalHouse(rng, { country: brickCountry(stone) })!, 'bays');
  if (kind === 'boulder') return normalise(kind, { style: 'timber', w: 1, d: 1, storeys: 1, heights: [1], bays: 1, colour: [0.5, 0.5, 0.5], boulder: { size: round(rng.range(0.6, 2.6)) } });
  if (kind === 'timber') {
    const w = round(rng.range(6, 8.6)), d = round(rng.range(6.2, 7.8)), storeys = rng.chance(0.4) ? 3 : 2, jetty = round(rng.range(0.3, 0.45)), gable = rng.chance(0.6);
    const tall = rng.fork('heights'), heights = [round(tall.range(2.6, 3.3)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.35, 2.9) - n * 0.1))];
    return normalise(kind, { style: 'timber', w, d, storeys, heights, bays: w > 7.4 ? 3 : 2, colour: rng.pick(TIMBER_WASHES), jetty, gable, door: rng.pick([0.24, 0.76]) });
  }
  if (kind === 'classical') {
    const storeys = rng.pick([1, 2, 2, 3, 3, 3, 4]), tall = rng.fork('heights');
    const heights = storeys === 1 ? [round(tall.range(3.9, 4.6))] : [round(tall.range(3.4, 4.2)), round(tall.range(3.8, 4.8)), ...Array.from({ length: storeys - 2 }, (_, n) => round(tall.range(2.9, 3.4) - n * 0.1))];
    const bays = rng.pick([5, 7, 7, 9, 9, 11]), w = round(bays * 2.55 + 1.6);
    const s: Shape = { style: 'imperial', w, d: round(rng.range(9.4, 11.5)), storeys, heights, bays, colour: rng.pick(CLASSICAL_WASHES), portico: bays >= 7 || rng.chance(0.5) };
    const winged = rng.fork('wings');
    if (bays >= 7 && winged.chance(0.7)) {
      const width = round(winged.range(5.4, Math.min(8.8, w / 2 - 4))), length = round(winged.range(8, 14));
      s.wings = winged.chance(0.5) ? [{ side: -1, width, length }, { side: 1, width, length }] : [{ side: winged.chance(0.5) ? -1 : 1, width, length }];
    }
    // (And the variations and the dress, each from a stream of its own, as a place deals them; with room before it to stand high.)
    classicalVariations(s as Building, rng.fork('variations'));
    dealDress(s as Building, rng.fork('dress'), { raise: 1.8, columns: true });
    return normalise(kind, s);
  }
  if (kind === 'wooden') {
    // As the town deals one: one storey, now and then two, on a basement of granite, with an attic lit by dormers; now and then an L.
    const w = round(rng.range(11, 18)), d = round(rng.range(8, 9.6)), storeys = rng.chance(0.25) ? 2 : 1, tall = rng.fork('heights');
    const heights = storeys === 1 ? [round(tall.range(3.1, 3.6))] : [round(tall.range(3.0, 3.4)), round(tall.range(2.8, 3.2))];
    const s: Shape = { style: 'wooden', w, d, storeys, heights, bays: Math.max(3, Math.round((w - 2) / 2.2)), colour: rng.pick(BOARDS), basement: round(rng.range(0.8, 1.5)), endDoor: rng.chance(0.5) ? -1 : 1, dormers: rng.int(0, w > 14 ? 3 : 2) };
    if (rng.fork('corner').chance(0.25)) s.wings = [{ side: s.endDoor === 1 ? -1 : 1, width: round(Math.min(8, w - 5)), length: round(rng.range(8, 11)) }];
    return normalise(kind, s);
  }
  if (kind === 'shack') {
    const onPosts = rng.chance(0.25);
    return normalise(kind, { style: 'timber', w: round(rng.range(3.2, 5.2)), d: round(rng.range(3.6, 5.6)), storeys: 1, heights: [2.3], bays: 1, colour: rng.pick(SHACK_BOARDS), shack: { roof: rng.pick(['boards', 'boards', 'tin', 'tin', 'turf'] as const), lean: rng.chance(0.45), stilts: onPosts ? round(rng.range(1.2, 1.9)) : 0 } });
  }
  const country = brickCountry(stone);
  if (kind === 'church') return normalise(kind, dealChurch(rng, 70, country)!);
  return normalise(kind, dealBrickHouse(rng, 15, kind, country));
}

/**
 * A classical building of one character, dealt from the seed: a palace, as on a capital's square (a long front of twenty-odd bays, a
 * rusticated ground storey of round-headed windows on a high base of granite, a broad middle under columns and a pediment with a clock,
 * pavilions at the ends, a wreathed frieze, a flagpole, and the square falling away along it); or a plain block, three to nine bays,
 * with nothing on it but its windows, its bands and its cornice.
 */
export function dealCharacter(character: 'palace' | 'plain', seed: string): Shape {
  const rng = new Rng(`lab ${character} ${seed}`), round = (v: number) => Math.round(v * 10) / 10;
  if (character === 'palace') {
    const bays = rng.pick([19, 21, 23, 25, 25]), storeys = rng.pick([3, 3, 3, 4]), plinth = round(rng.range(1.3, 1.9));
    const s: Shape = {
      style: 'imperial', w: round(bays * 2.55 + 1.6), d: round(rng.range(13, 15)), storeys, bays, portico: true, colour: rng.pick([[0.9, 0.78, 0.45], [0.92, 0.8, 0.5], [0.86, 0.62, 0.56], [0.88, 0.84, 0.72]] as Colour[]),
      heights: [round(rng.range(4.2, 4.6)), round(rng.range(4.4, 4.9)), ...Array.from({ length: storeys - 2 }, () => round(rng.range(3.8, 4.2)))],
      dress: {
        centre: rng.pick([5, 5, 7]), order: rng.chance(0.75) ? 'columns' : 'pilasters', pavilions: rng.pick([2, 3, 3]), arches: rng.pick([1, 1, 2] as const), heads: rng.pick(['cornice', 'alternate', 'pediments'] as const),
        rusticated: true, frieze: true, balustrade: rng.chance(0.35), tympanum: rng.pick(['clock', 'clock', 'oculus'] as const), flag: true, doors: 3, plinth,
        fall: round((rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 2 * (plinth - 0.35))), roof: rng.pick(['dealt', 'green', 'grey', 'copper', 'black'] as const),
        style: rng.fork('style').pick(['empire', 'empire', 'quoins'] as const),
      },
    };
    return normalise('classical', s, 'bays');
  }
  const bays = rng.pick([3, 5, 5, 7, 7, 9]), storeys = rng.pick([2, 2, 3]);
  const s: Shape = {
    style: 'imperial', w: round(bays * 2.55 + 1.6), d: round(rng.range(9.4, 11)), storeys, bays, portico: false, colour: rng.pick(CLASSICAL_WASHES),
    heights: [round(rng.range(3.3, 3.8)), ...Array.from({ length: storeys - 1 }, () => round(rng.range(3.1, 3.5)))],
    dress: { ...PLAIN_DRESS, heads: rng.pick(['plain', 'plain', 'cornice'] as const), rusticated: rng.chance(0.4), tympanum: 'plain', style: rng.fork('style').pick(['lesenes', 'lesenes', 'bare', 'empire'] as const) },
  };
  return normalise('classical', s, 'bays');
}

/**
 * The ground a building stands on in the lab, where it is not level: a paving that falls along its front as its dress says, from the
 * square at its lower end to as high as the fall at its upper, reaching out before it far enough for its steps and a little round it.
 * Laid in the building's own measures (the ground before its door at nothing); the lab sets the building up by half the fall so that
 * the paving's lower end meets the square. Nothing for a building on level ground.
 */
export function liftOf(item: Item): number {
  return item.kind === 'classical' ? Math.abs(item.shape.dress?.fall ?? 0) / 2 : 0;
}
export function buildGround(item: Item, mesh: (material: string) => MeshBuilder, colour: Colour): void {
  const lift = liftOf(item);
  if (!lift) return;
  const b = { ...item.shape, x: 0, z: 0, faces: 'w' } as Building, s = item.shape, m = mesh('floor');
  const reach = Math.max(0, ...(s.wings ?? []).map((g) => g.length)), v0 = -9, v1 = s.d + reach + 2.5, u0 = -s.w / 2 - 3, u1 = s.w / 2 + 3;
  const us = [u0, -s.w / 2, s.w / 2, u1], top = (u: number) => groundOf(b, 0, u), P = (u: number, y: number, v: number): [number, number, number] => [-s.d / 2 + v, y, u];
  const quad = (p: [number, number, number][], n: [number, number, number]) => {
    const ids = p.map(([x, y, z]) => m.addVertex(x, y, z, n[0], n[1], n[2], z * 0.5, x * 0.5, colour[0], colour[1], colour[2]));
    m.addTriangle(ids[0], ids[1], ids[2]); m.addTriangle(ids[0], ids[2], ids[3]);
  };
  for (let i = 0; i < 3; i++) {
    const a = us[i], c = us[i + 1], ya = top(a), yc = top(c), len = Math.hypot(c - a, yc - ya), ny = (c - a) / len, nu = -(yc - ya) / len;
    // (The top, as the ground falls; and its two faces at the front and the back, down to the square.)
    quad([P(a, ya, v0), P(a, ya, v1), P(c, yc, v1), P(c, yc, v0)], [0, ny, nu]);
    quad([P(a, -lift, v0), P(a, ya, v0), P(c, yc, v0), P(c, -lift, v0)], [-1, 0, 0]);
    quad([P(c, -lift, v1), P(c, yc, v1), P(a, ya, v1), P(a, -lift, v1)], [1, 0, 0]);
  }
  for (const [u, n] of [[u0, -1], [u1, 1]] as [number, number][]) quad(n < 0 ? [P(u, -lift, v1), P(u, top(u), v1), P(u, top(u), v0), P(u, -lift, v0)] : [P(u, -lift, v0), P(u, top(u), v0), P(u, top(u), v1), P(u, -lift, v1)], [0, 0, n]);
}

/** The site document of an item, as the builders read it: at the origin, facing `w`, with its rooms planned. */
export function documentOf(item: Item): Building {
  const b: Building = { ...JSON.parse(JSON.stringify(item.shape)), x: 0, z: 0, faces: 'w' };
  if (item.kind === 'classical') b.plan = planClassical(b, new Rng(item.seed).fork('plan'));
  else if (item.kind === 'timber') b.plan = planTimber(b);
  // (A canal house and a house of brick are planned within too, and built so, unless their stair will not fit; a church is not.)
  else if (item.kind === 'canal' || item.kind === 'gabled' || item.kind === 'eaves' || item.kind === 'store') { const p = item.kind === 'canal' ? planCanal(b) : planBrick(b); if (p) b.plan = p; }
  return b;
}

/** The tint of the country's stone in what is built, as the site mesher gives it to the builders. */
export function stoneColour(stone: Stone): Colour {
  const t = stoneStyles(stone).tint;
  return [0.86 * t[0], 0.77 * t[1], 0.63 * t[2]];
}

/** A shack's record as the town keeps it, at the origin, its front towards -x as every building here is made. */
export function shackOf(item: Item): Town['shacks'][number] {
  const s = item.shape, sh = s.shack!;
  return { x: 0, z: 0, y: sh.stilts, w: s.w, d: s.d, turn: Math.PI, roof: sh.roof, lean: sh.lean, stilts: sh.stilts, colour: s.colour };
}

/** Builds an item's building into meshes by material, at the origin facing `w` (its front towards -x, its middle at x = 0). */
export function buildItem(item: Item, stone: Stone, mesh: (material: string) => MeshBuilder, near?: Building['near'], season: Season = 'summer', room?: Room): { cards?: CardSet[] } {
  // (A tree's leaves are cards, drawn otherwise than its bark: they are given back to be drawn. Its boughs keep out of what stands
  // about it: see `roomOf`.)
  if (item.kind === 'tree') return { cards: growOne(item.shape.tree!, season, new Rng(item.seed).fork('tree'), mesh, room && (room.walls.length || room.rock.length) ? keepOutOf(room) : undefined).cards };
  if (item.kind === 'boulder') { boulderOne(stone, item.shape.boulder!.size, new Rng(item.seed).fork('boulder'), mesh); return {}; }
  // (A shack's posts go down to the ground, which here is level and nowhere near the sea.)
  if (item.kind === 'shack') { buildShack(shackOf(item), new Rng(item.seed).fork('build'), anyAngle(mesh).solid, () => 0, Infinity); return {}; }
  const b = documentOf(item);
  if (near?.length) b.near = near;
  // Laid into the lab's meshes as the game lays a house into its place (`placeHouse`): its rooms marked as indoors, out of the sky's
  // light, and each point of its outer walls and timber carrying the height of the ground at its foot, which is what the materials
  // weather it by: damp risen in the foot of a wall, render come away, rain splash, timber faded and paint peeling. (Built straight into
  // the lab's meshes, nothing was marked, and its buildings stood as new and lit within as if roofless, whatever the materials were.)
  // Built facing west at the middle, as the lab builds every building, and standing on the square: on its own ground the lift lower.
  const local = new Map<string, MeshBuilder>();
  const into = (m: string) => { let x = local.get(m); if (!x) local.set(m, (x = new MeshBuilder())); return x; };
  buildBuilding(b, 0, into, new Rng(item.seed).fork('build'), stoneColour(stone), item.kind === 'timber' && !!item.inn);
  const ground = -liftOf(item);
  placeHouse(b, 0, local, mesh, { facing: Math.PI, foot: () => ground });
  return {};
}

/**
 * What a tree's boughs must keep out of, in its own measures as it is grown (about its foot, before it is turned or scaled): the
 * walls of what stands about it, each the outline of its ground (a little enlarged, so that leaves do not brush the wall) from below
 * the ground to its top; and the balls of painted rock. (To a tenth of a metre, so that one standing still does not make the tree be
 * grown again.)
 */
export interface Room { walls: { at: [number, number][]; y0: number; y1: number }[]; rock: number[][] }
/** The room a tree has: `topOf` says how high each thing about it rises over the square; `rock` is the painted rock's balls. */
export function roomOf(item: Item, others: Item[], topOf: (q: Item) => number, rock: number[][] = []): Room {
  const t = item.shape.tree!, reach = crownOf(t) * 1.8 + 2, tenth = (x: number) => Math.round(x * 10) / 10, half = item.shape.d / 2, sy = item.scale[1];
  const local = (X: number, Z: number): [number, number] => { const [u, v] = planAt(item, X, Z); return [tenth(-half + v), tenth(u)]; };
  const walls: Room['walls'] = [], m = 0.35;
  for (const q of others) {
    if (q.id === item.id || q.kind === 'tree') continue;
    for (const r of footprintOfItem(q)) {
      const at = ([[r.u0 - m, r.v0 - m], [r.u1 + m, r.v0 - m], [r.u1 + m, r.v1 + m], [r.u0 - m, r.v1 + m]] as [number, number][]).map(([u, v]) => local(...squareAt(q, u, v)));
      if (at.every(([x]) => x < -reach) || at.every(([x]) => x > reach) || at.every(([, z]) => z < -reach) || at.every(([, z]) => z > reach)) continue;
      walls.push({ at, y0: -2, y1: tenth((topOf(q) + 0.3) / sy) });
    }
  }
  const k = Math.cbrt(item.scale[0] * item.scale[1] * item.scale[2]);
  const balls = rock.map(([x, y, z, r, sign]) => { const [lx, lz] = local(x, z); return [lx, tenth(y / sy), lz, tenth(r / k), sign]; }).filter(([x, , z, r]) => Math.hypot(x, z) < reach + r + 4);
  return { walls, rock: balls };
}
/** Whether a point (in a tree's own measures) is where its boughs may not go. */
function keepOutOf(room: Room): (p: Vector3) => boolean {
  const adds = room.rock.filter((b) => b[4] > 0), digs = room.rock.filter((b) => b[4] < 0);
  return (p) => room.walls.some((w) => p.y > w.y0 && p.y < w.y1 && within2(w.at, p.x, p.z))
    || (adds.some((b) => Math.hypot(p.x - b[0], p.y - b[1], p.z - b[2]) < b[3] + 0.3) && !digs.some((b) => Math.hypot(p.x - b[0], p.y - b[1], p.z - b[2]) < b[3] - 0.3));
}
function within2(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point of the square (`x`, `z`) is within an item's ground: under a building, or a boulder, or a tree's trunk. */
export function standsIn(item: Item, x: number, z: number, room = 0): boolean {
  const [u, v] = planAt(item, x, z);
  if (item.kind === 'tree') return Math.hypot(u, v - item.shape.d / 2) < Math.max(0.4, item.shape.tree!.girth * 2) + room;
  return footprintOfItem(item).some((r) => u > r.u0 - room && u < r.u1 + room && v > r.v0 - room && v < r.v1 + room);
}

/** Where a point of an item's ground plan (`u` across its front, `v` back from it, in its own measures) stands in the square. */
function squareAt(item: Item, u: number, v: number): [number, number] {
  const a = Math.PI / 2 + (item.turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const x = (-item.shape.d / 2 + v) * item.scale[2], z = u * item.scale[0];
  return [item.x + x * c + z * s, item.z - x * s + z * c];
}
/** And back: where a point of the square falls on an item's ground plan, in its own measures. */
function planAt(item: Item, X: number, Z: number): [number, number] {
  const a = Math.PI / 2 + (item.turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = X - item.x, dz = Z - item.z;
  return [(dx * s + dz * c) / item.scale[0], (dx * c - dz * s) / item.scale[2] + item.shape.d / 2];
}
const footprintOfItem = (item: Item) => footprintOf({ ...item.shape, x: 0, z: 0, faces: 'w' } as Building);

/**
 * What stands close about an item, as the document's `near` records it: the ground plan of every other building near enough to shut
 * one of its windows, in its own measures, and how high that one's walls rise over its ground. (To a tenth of a metre, so that one
 * standing still does not make another be built again.)
 */
export function nearOf(item: Item, others: Item[]): Building['near'] {
  // (Trees and stones shut no windows; and have none.)
  if (isNature(item.kind)) return undefined;
  const own = footprintOfItem(item), reach = CLOSE + 0.8;
  const u0 = Math.min(...own.map((r) => r.u0)) - reach, u1 = Math.max(...own.map((r) => r.u1)) + reach, v0 = Math.min(...own.map((r) => r.v0)) - reach, v1 = Math.max(...own.map((r) => r.v1)) + reach;
  const out: NonNullable<Building['near']> = [], tenth = (x: number) => Math.round(x * 10) / 10;
  for (const q of others) {
    if (q.id === item.id || isNature(q.kind)) continue;
    const top = tenth((eavesOf(q) * q.scale[1] + liftOf(q) - liftOf(item)) / item.scale[1]);
    for (const r of footprintOfItem(q)) {
      const at = ([[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]] as [number, number][]).map(([u, v]) => planAt(item, ...squareAt(q, u, v)));
      if (at.every(([u]) => u < u0) || at.every(([u]) => u > u1) || at.every(([, v]) => v < v0) || at.every(([, v]) => v > v1)) continue;
      out.push({ at: at.map(([u, v]) => [tenth(u), tenth(v)]), top });
    }
  }
  return out.length ? out : undefined;
}

/** The height of the top of a building's walls, where its roof begins, above the ground before its door. */
export function eavesOf(item: Item): number {
  const b = item.shape as Building;
  if (item.kind === 'timber') return timberFloor(b, b.storeys);
  if (item.kind === 'classical') return floorOf(b, b.storeys);
  if (item.kind === 'wooden') return (b.basement ?? 1.1) + b.heights.reduce((sum, h) => sum + h, 0);
  if (item.kind === 'shack') return item.shape.shack!.stilts + 2.3;
  if (item.kind === 'tree') return item.shape.tree!.height;
  if (item.kind === 'canal') return canalEaves(b);
  if (item.kind === 'boulder') return item.shape.boulder!.size * 0.7;
  return brickEaves(b);
}

