// The buildings the building lab can set out, and the measures each may be given: what is dealt
// when one is added, how far each measure may be pushed before the builder no longer makes sense
// of it, and the site document that is built from it. No page and no drawing here, so that a
// check can build every kind at the ends of its ranges without a browser (`tools/buildingLab.ts`).
//
// Every building is built by the game's own builders (`buildBuilding` in `src/render/buildings.ts`)
// from a site document, as a valley builds it; only where it stands, which way it is turned and how
// it is scaled are the lab's. The document is always made at the origin facing `w`, and the lab
// places what is built.
import { floorOf, planClassical, planTimber, timberFloor } from '../src/core/building';
import { brickCountry, brickEaves, dealBrickHouse, dealChurch } from '../src/core/brick';
import { Rng } from '../src/core/rng';
import { BrickWork, Building, Stone } from '../src/core/site';
import { buildBuilding } from '../src/render/buildings';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { stoneStyles } from '../src/render/geom/styles';

export type Kind = 'timber' | 'classical' | 'gabled' | 'eaves' | 'store' | 'church';
/** What a building is, apart from where it stands: the measures of the site document that the lab lets be changed. */
export type Shape = Omit<Building, 'x' | 'z' | 'faces' | 'plan' | 'backDoor' | 'sunk' | 'wheel'>;
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
  gabled: { name: "Merchant's house", note: 'Brick, narrow and deep, its steep gable to the street: stepped, between piers, curved or plain.' },
  eaves: { name: 'Eaves house', note: 'Brick, broader and later, its eaves to the street and a small gable over its middle.' },
  store: { name: 'Warehouse', note: 'Brick, many low storeys, a column of loading doors under a hoist.' },
  church: { name: 'Church', note: 'Brick Gothic: a buttressed hall church, a tower or two with a spire, and a choir.' },
};
export const KIND_ORDER: Kind[] = ['classical', 'timber', 'gabled', 'eaves', 'store', 'church'];

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const odd = (v: number) => { const n = Math.round(v); return n % 2 ? n : n + (v > n ? 1 : -1); };

/** The washes of the timber houses, of the classical fronts, and of the brick towns' rendered fronts (as the generator deals them). */
export const TIMBER_WASHES: Colour[] = [[0.86, 0.8, 0.66], [0.82, 0.62, 0.3], [0.78, 0.5, 0.44], [0.55, 0.66, 0.74], [0.6, 0.68, 0.5], [0.88, 0.87, 0.82], [0.74, 0.36, 0.26]];
export const CLASSICAL_WASHES: Colour[] = [[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78], [0.88, 0.84, 0.72]];

/**
 * How far each measure may go. Some are tied to others, as they are when the generator deals
 * them: the breadth of a classical front, an eaves house and a church follows from its bays (each
 * bay between `pitch[0]` and `pitch[1]` metres, and `margin` at the ends), so widening one past what its
 * bays can fill adds bays, two at a time where the middle must stay a bay.
 */
export const RANGES = {
  timber: { w: [5, 11], d: [5.5, 10], storeys: [1, 4], height: [2.2, 3.8], bays: [1, 4], jetty: [0, 0.6] },
  classical: { bays: [3, 15], pitch: [2.2, 3.2], margin: 1.6, d: [8.5, 14], storeys: [1, 6], height: [2.8, 5.5], wingWidth: [5.4, 8.8], wingLength: [6, 18] },
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
    delete s.brickwork; delete s.portico; delete s.wings;
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
    delete s.brickwork; delete s.jetty; delete s.gable; delete s.door; delete s.burnt;
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
  delete s.jetty; delete s.gable; delete s.door; delete s.burnt; delete s.portico; delete s.wings;
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
export function deal(kind: Kind, seed: string, stone: Stone = 'greystone'): Shape {
  const rng = new Rng(`lab ${kind} ${seed}`), round = (v: number) => Math.round(v * 10) / 10;
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
    return normalise(kind, s);
  }
  const country = brickCountry(stone);
  if (kind === 'church') return normalise(kind, dealChurch(rng, 70, country)!);
  return normalise(kind, dealBrickHouse(rng, 15, kind, country));
}

/** The site document of an item, as the builders read it: at the origin, facing `w`, with its rooms planned. */
export function documentOf(item: Item): Building {
  const b: Building = { ...JSON.parse(JSON.stringify(item.shape)), x: 0, z: 0, faces: 'w' };
  if (item.kind === 'classical') b.plan = planClassical(b, new Rng(item.seed).fork('plan'));
  else if (item.kind === 'timber') b.plan = planTimber(b);
  return b;
}

/** The tint of the country's stone in what is built, as the site mesher gives it to the builders. */
export function stoneColour(stone: Stone): Colour {
  const t = stoneStyles(stone).tint;
  return [0.86 * t[0], 0.77 * t[1], 0.63 * t[2]];
}

/** Builds an item's building into meshes by material, at the origin facing `w` (its front towards -x, its middle at x = 0). */
export function buildItem(item: Item, stone: Stone, mesh: (material: string) => MeshBuilder): void {
  buildBuilding(documentOf(item), 0, mesh, new Rng(item.seed).fork('build'), stoneColour(stone), item.kind === 'timber' && !!item.inn);
}

/** The height of the top of a building's walls, where its roof begins, above the ground before its door. */
export function eavesOf(item: Item): number {
  const b = item.shape as Building;
  if (item.kind === 'timber') return timberFloor(b, b.storeys);
  if (item.kind === 'classical') return floorOf(b, b.storeys);
  return brickEaves(b);
}

