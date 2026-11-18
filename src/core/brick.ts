import { Rng } from './rng';
import { Building, BrickWork, Stone } from './site';

/**
 * The brick buildings of the Baltic towns: how each kind is dealt from the seed, and the measures
 * that follow from what the site document says of it. Everything is in the building's own
 * measures, as in `building.ts`: `u` across the front from its middle, to the right as seen from
 * outside; `v` back from the face of the front wall; `y` up from the ground before the door.
 *
 * The family is the street front of a Hanseatic town, as along the Trave in Lübeck: tall narrow
 * merchants' houses with their gables to the street, stepped, or between piers that end in
 * pinnacles, or in curved tiers; the broader rendered houses of a later century with their eaves
 * to the street; warehouses; and over the roofs the towers of a church of brick.
 */

/** Fixed measures: the thickness of the front and of the other walls, the plinth, and how deep a niche is sunk into the front. */
export const BRICK = { front: 0.5, wall: 0.42, plinth: 0.32, niche: 0.13 };

type Colour = [number, number, number];
const round = (v: number) => Math.round(v * 100) / 100;

/** The height of a storey's floor above the ground before the door. */
export const brickFloor = (b: Building, storey: number): number => BRICK.plinth + b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0);

/** The height of the top of the walls, where the roof begins. */
export const brickEaves = (b: Building): number => brickFloor(b, b.storeys);

/** The washes of rendered fronts in the old towns: white, cream, ochre, salmon, ox-blood, sage and a grey-blue. */
export const WASHES: Colour[] = [[0.92, 0.9, 0.86], [0.9, 0.83, 0.66], [0.9, 0.72, 0.36], [0.88, 0.58, 0.48], [0.6, 0.22, 0.17], [0.66, 0.74, 0.6], [0.62, 0.69, 0.76]];
/** The tones of the brick itself, house by house: the common colour, darker, browner, and a warmer one that was fired less. */
const TONES: Colour[] = [[1, 1, 1], [1, 1, 1], [0.84, 0.8, 0.8], [0.78, 0.7, 0.66], [1.12, 1.04, 0.92], [1.06, 0.94, 0.9]];

/**
 * The brick of a country, from what it is built on. Brick was burnt from clay dug near the town, and its colour is the clay's:
 * iron in it fires red, lime fires it pale. So in limestone country the brick is buff, from pale yellow to ochre; on red
 * sandstone it is a warm orange-red; on the grey rocks the deep red of the Baltic towns; on basalt a dark red-brown. `tint`
 * multiplies every house's own tone.
 */
export interface BrickCountry { clay: 'red' | 'buff'; tint: Colour }
export function brickCountry(stone: Stone): BrickCountry {
  if (stone === 'limestone') return { clay: 'buff', tint: [1, 1, 1] };
  if (stone === 'sandstone') return { clay: 'red', tint: [1.14, 1.02, 0.86] };
  if (stone === 'basalt') return { clay: 'red', tint: [0.8, 0.72, 0.7] };
  return { clay: 'red', tint: [1, 1, 1] };
}
const RED: BrickCountry = { clay: 'red', tint: [1, 1, 1] };
const tinted = (a: Colour, c: Colour): Colour => [round(a[0] * c[0]), round(a[1] * c[1]), round(a[2] * c[2])];

/**
 * A house of the town's street, of the kind asked for, or of one dealt from the seed: a merchant's
 * house with its gable to the street most often, a broad house with its eaves to it now and then,
 * and here and there a warehouse. `deep` is the most depth the street has room for.
 */
export function dealBrickHouse(rng: Rng, deep = 14, kind?: BrickWork['kind'], country = RED): Omit<Building, 'x' | 'z' | 'faces'> {
  const k = kind ?? rng.pick(['gabled', 'gabled', 'gabled', 'gabled', 'gabled', 'gabled', 'eaves', 'eaves', 'store'] as const);
  const look = rng.fork('look'), tone = tinted(look.pick(TONES), country.tint), colour = look.pick(WASHES), clay = country.clay;
  if (k === 'eaves') {
    // From four windows across to six, at a little over two metres apart; three or four storeys; rendered, and its roof less steep.
    const bays = rng.int(4, 6), w = round(bays * 2.25 + 1.3), d = round(Math.min(deep, rng.range(9.5, 12)));
    const storeys = rng.chance(0.5) ? 3 : 4, tall = rng.fork('heights');
    const heights = [round(tall.range(3.5, 4.1)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.95, 3.35) - n * 0.08))];
    const gable = rng.pick(['plain', 'volute', 'volute', 'stepped'] as const);
    return {
      style: 'brick', w, d, storeys, heights, bays, colour,
      brickwork: { kind: k, gable, steps: gable === 'volute' ? 1 : 2, rendered: !rng.chance(0.15), clay, tone, glazed: false, niches: 'none', door: 0.5, pitch: round(rng.range(46, 52)), roof: rng.chance(0.75) ? 'red' : 'dark' },
    };
  }
  if (k === 'store') {
    // Narrower and plainer: four to six low storeys over a taller ground storey, bare brick, a plain or a stepped gable.
    const w = round(rng.range(7.2, 9.6)), d = round(Math.min(deep, rng.range(12, 15))), storeys = rng.int(4, 6), tall = rng.fork('heights');
    const heights = [round(tall.range(3.3, 3.8)), ...Array.from({ length: storeys - 1 }, () => round(tall.range(2.45, 2.75)))];
    const gable = rng.chance(0.55) ? 'stepped' as const : 'plain' as const;
    return {
      style: 'brick', w, d, storeys, heights, bays: w > 8.4 ? 5 : 3, colour,
      brickwork: { kind: k, gable, steps: Math.max(3, Math.min(5, Math.round(w / 2))), rendered: false, clay, tone, glazed: rng.chance(0.3), niches: rng.chance(0.4) ? 'brick' : 'none', door: 0.5, pitch: round(rng.range(54, 60)), roof: rng.chance(0.6) ? 'red' : 'dark' },
    };
  }
  // A merchant's house. Its gable: stepped most often, then curved in tiers, then between piers, then plain.
  const w = round(rng.range(6.4, 9.4)), d = round(Math.min(deep, rng.range(11, 15))), storeys = rng.pick([2, 3, 3, 3, 4]), tall = rng.fork('heights');
  // (The ground storey is the hall where goods were kept and business done: the tallest by far.)
  const heights = [round(tall.range(3.9, 4.9)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.75, 3.2) - n * 0.08))];
  const gable = rng.pick(['stepped', 'stepped', 'stepped', 'volute', 'volute', 'piers', 'piers', 'plain'] as const);
  const steps = gable === 'stepped' ? Math.max(3, Math.min(6, Math.round(w / 1.75) + rng.int(-1, 0)))
    : gable === 'piers' ? (w > 8 ? 3 : 2)
      : gable === 'volute' ? (w > 7.6 ? 3 : 2) : 0;
  // (Curved gables are of a later century and were mostly rendered; Gothic ones mostly left as brick.)
  const rendered = rng.chance(gable === 'volute' ? 0.75 : gable === 'plain' ? 0.35 : 0.14);
  const niches = gable === 'stepped' || gable === 'piers' ? rng.pick(['white', 'white', 'brick', 'brick', 'none'] as const) : 'none';
  return {
    style: 'brick', w, d, storeys, heights, bays: gable === 'piers' ? steps * 2 : w < 7.2 ? 2 : w < 8.6 ? 3 : rng.pick([3, 4]), colour,
    brickwork: {
      kind: 'gabled', gable, steps, rendered, clay, tone, glazed: !rendered && rng.chance(0.4), niches,
      door: rng.pick([0.28, 0.5, 0.72]), pitch: round(rng.range(55, 61)), roof: rng.chance(0.7) ? 'red' : 'dark',
    },
  };
}

/**
 * A church of the brick Gothic, as large as `room` metres along the street allows (its nave,
 * tower and choir together), and no larger than a town of this size would build. A hall church:
 * one great roof over nave and aisles, its walls buttressed between tall pointed windows.
 */
export function dealChurch(rng: Rng, room = 46, country = RED): Omit<Building, 'x' | 'z' | 'faces'> | null {
  const d = round(rng.range(14, 17.5)), twin = d >= 16 && rng.chance(0.3), side = round(twin ? d / 2 - 0.4 : rng.range(7.6, 9));
  const choir = rng.chance(0.6) ? 'apse' as const : 'flat' as const, choirLength = round(rng.range(6, 8.5));
  // (An apse is half an octagon, which reaches beyond the choir's walls by half the choir's breadth.)
  const reach = choirLength + (choir === 'apse' ? d * 0.31 : 0.6);
  let bays = rng.int(4, 6);
  const bay = round(rng.range(5.3, 6.1));
  while (bays > 3 && bays * bay + side + reach > room) bays--;
  if (bays * bay + side + reach > room) return null;
  const w = round(bays * bay), wall = round(rng.range(10.5, 13)), spire = twin ? 'needle' as const : rng.pick(['needle', 'needle', 'corners', 'saddle'] as const);
  return {
    style: 'brick', w, d, storeys: 1, heights: [wall], bays, colour: WASHES[0],
    brickwork: {
      kind: 'church', gable: rng.chance(0.6) ? 'stepped' : 'piers', steps: rng.int(4, 6), rendered: false, clay: country.clay, tone: tinted(rng.pick(TONES), country.tint), glazed: rng.chance(0.6),
      niches: rng.chance(0.65) ? 'white' : 'brick', door: 0.5, pitch: round(rng.range(52, 57)), roof: rng.chance(0.55) ? 'copper' : 'red',
      church: {
        end: rng.chance(0.5) ? -1 : 1, towers: twin ? 2 : 1, side, height: round(wall + rng.range(13, 20)), spire,
        spireHeight: round(spire === 'needle' ? rng.range(20, 30) : spire === 'corners' ? rng.range(14, 20) : 0), choir, choirLength,
      },
    },
  };
}

/** The parts of a church on the ground, in its own measures: the nave, its tower or towers, and its choir with the depth of its apse. */
export function churchParts(b: Building) {
  const c = b.brickwork!.church!, W = b.w, D = b.d, out = c.end;
  const nave = { u0: -W / 2, u1: W / 2, v0: 0, v1: D };
  // (The towers stand beyond the nave's end, their walls continuing its long walls where there are two.)
  const towerU = out > 0 ? [W / 2, W / 2 + c.side] : [-W / 2 - c.side, -W / 2];
  const towers = c.towers === 2
    ? [{ u0: towerU[0], u1: towerU[1], v0: 0, v1: c.side }, { u0: towerU[0], u1: towerU[1], v0: D - c.side, v1: D }]
    : [{ u0: towerU[0], u1: towerU[1], v0: D / 2 - c.side / 2, v1: D / 2 + c.side / 2 }];
  // The choir: as long as the document says, and an apse beyond that of half an octagon, as deep as half the choir is broad.
  const cw = round(D * 0.62), apse = c.choir === 'apse' ? cw / 2 : 0;
  const cu = out > 0 ? [-W / 2 - c.choirLength, -W / 2] : [W / 2, W / 2 + c.choirLength];
  const choir = { u0: cu[0], u1: cu[1], v0: D / 2 - cw / 2, v1: D / 2 + cw / 2, apse };
  return { nave, towers, choir, cw, away: -out as -1 | 1 };
}

/** Where a building of brick stands on the ground, as rectangles in its own measures. */
export function brickFootprint(b: Building): { u0: number; u1: number; v0: number; v1: number }[] {
  if (b.brickwork?.kind !== 'church') return [{ u0: -b.w / 2, u1: b.w / 2, v0: 0, v1: b.d }];
  // (The apse is taken as the rectangle it stands in.)
  const p = churchParts(b), a = p.choir;
  return [p.nave, ...p.towers, { u0: a.u0 - (p.away < 0 ? a.apse : 0), u1: a.u1 + (p.away > 0 ? a.apse : 0), v0: a.v0, v1: a.v1 }];
}
