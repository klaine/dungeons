import { planMission, solve } from './mission';
import { Rng } from './rng';
import { layOutIsland } from './island';
import { layOutMountain } from './mountain';
import { layOutTown as layOutHarbourTown } from './town';
import { findValleys, highlands, ValleySpot } from './highlands';
import { landAt as worldLandAt, makeTilesNear, worldLand, WORLD_REACH } from './worldLand';
import { armRise, armsOf, edgeAt, hallOnward, insideOf, joinLine, shapeValley, slantAt, valleyLand, walkable } from './valley';
import { classicalFront, classicalVariations, dealDress, floorOf, footprintOf, planClassical, planTimber } from './building';
import { brickCountry, dealBrickHouse, dealChurch } from './brick';
import { allReachable, Building, Feature, Hour, loopCount, neighbours, Place, Role, Roof, Setting, Side, shoreOf, Site, SKIES, Stone, Stream, Terrace, Way, WHEN } from './site';

/**
 * Site generator: a walled house of rooms, entered from a forecourt, with a sanctum to reach.
 *
 * The plan is a grid whose columns and rows vary in width, so rooms range from narrow passages to
 * halls while sharing walls exactly; now and then two cells side by side are one long hall, and a
 * room whose wall looks out on nothing may stand in from the grid's line, so that rooms are not
 * all the size of their cells. Which cells are rooms, and which are joined, comes from a
 * draft: one of several ways of laying out loops. Structure is built from cycles, not from a tree
 * with loops added afterwards, so there is always more than one way round. Side chambers and
 * chains of chambers hang off the loops, a court may open one cell to the sky, and the mission
 * layer then locks and bars the result.
 *
 * Not here yet: pacing, premise, and anything that is not a rectangle.
 */

const T = 1.0;          // wall thickness
const STEP = 0.17;      // height of one stair
const MAX_STEPS = 3;    // most stairs that fit in a doorway
const NX = 6, NZ = 5;   // plan grid; the entrance is on the south row
const MAX_ROOMS = 11;
const CANDIDATES = 6;  // sites drafted per seed; the best is kept

interface Cell { i: number; j: number }

/** The bare plan: which cells are places, which are joined, where the way in is. */
interface Draft {
  cells: Cell[];
  edges: [Cell, Cell][];
  entrance: Cell;
  /** A cell to leave open to the sky, if any. */
  court: Cell | null;
  /** How the title describes the arrangement. */
  phrase: string;
}

const key = (c: Cell) => `${c.i},${c.j}`;
const same = (a: Cell, b: Cell) => a.i === b.i && a.j === b.j;

/** The cells round the edge of a rectangle of cells, clockwise from its north-west corner. */
function loop(i0: number, j0: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < w; i++) out.push({ i: i0 + i, j: j0 });
  for (let j = 1; j < h; j++) out.push({ i: i0 + w - 1, j: j0 + j });
  for (let i = w - 2; i >= 0; i--) out.push({ i: i0 + i, j: j0 + h - 1 });
  for (let j = h - 2; j >= 1; j--) out.push({ i: i0, j: j0 + j });
  return out;
}

/** Collects cells and edges without duplicates. */
class DraftBuilder {
  cells = new Map<string, Cell>();
  edges = new Map<string, [Cell, Cell]>();
  cell(c: Cell): void {
    if (!this.cells.has(key(c))) this.cells.set(key(c), c);
  }
  edge(a: Cell, b: Cell): void {
    this.cell(a);
    this.cell(b);
    const k = [key(a), key(b)].sort().join('|');
    this.edges.set(k, [a, b]);
  }
  ring(cells: Cell[]): void {
    cells.forEach((c, k) => this.edge(c, cells[(k + 1) % cells.length]));
  }
  degree(c: Cell): number {
    return [...this.edges.values()].filter(([a, b]) => same(a, c) || same(b, c)).length;
  }
}

/** One loop of rooms; a wide one encloses a court. */
function draftRing(rng: Rng): Draft {
  const r = rng.next();
  const [w, h] = r < 0.55 ? [3, 3] : r < 0.75 ? [3, 2] : r < 0.9 ? [2, 3] : [2, 2];
  const i0 = rng.int(0, NX - w), j0 = NZ - h;
  const b = new DraftBuilder();
  const cells = loop(i0, j0, w, h);
  b.ring(cells);
  const south = cells.filter((c) => c.j === NZ - 1);
  const entrance = w === 3 && rng.chance(0.5) ? south.find((c) => c.i === i0 + 1)! : rng.pick(south);
  let court: Cell | null = null;
  if (w === 3 && h === 3) {
    court = { i: i0 + 1, j: j0 + 1 };
    const sides: Cell[] = [{ i: court.i, j: court.j - 1 }, { i: court.i + 1, j: court.j }, { i: court.i - 1, j: court.j }, { i: court.i, j: court.j + 1 }];
    shuffle(sides, rng);
    b.edge(court, sides[0]);
    b.edge(court, sides[1]);
  }
  return { cells: [...b.cells.values()], edges: [...b.edges.values()], entrance, court, phrase: court ? 'in a ring round a cloister court' : 'in a ring' };
}

/** Two loops side by side, sharing the rooms between them. */
function draftDouble(rng: Rng): Draft {
  const wa = rng.int(2, 3), wb = rng.int(2, 3);
  const i0 = rng.int(0, NX - (wa + wb - 1)), j0 = NZ - 2;
  const b = new DraftBuilder();
  b.ring(loop(i0, j0, wa, 2));
  b.ring(loop(i0 + wa - 1, j0, wb, 2));
  const south = [...b.cells.values()].filter((c) => c.j === NZ - 1);
  return { cells: [...b.cells.values()], edges: [...b.edges.values()], entrance: rng.pick(south), court: pickCourt(b, rng, 0.35), phrase: 'in two rings side by side' };
}

/** Two loops, one behind the other, overlapping by one room or more. */
function draftStack(rng: Rng): Draft {
  const wa = rng.int(2, 3), wb = rng.int(2, 3);
  const ia = rng.int(1, NX - wa - 1);
  // The rear loop is shifted sideways, but must still touch the front one.
  const ib = Math.max(0, Math.min(NX - wb, ia + rng.int(-(wb - 1), wa - 1)));
  const b = new DraftBuilder();
  b.ring(loop(ia, NZ - 2, wa, 2));
  b.ring(loop(ib, NZ - 3, wb, 2));
  const south = [...b.cells.values()].filter((c) => c.j === NZ - 1);
  return { cells: [...b.cells.values()], edges: [...b.edges.values()], entrance: rng.pick(south), court: pickCourt(b, rng, 0.4), phrase: 'in two rings, one behind the other' };
}

/** A gallery running back from the entrance with rooms off both sides, joined along the flanks. */
function draftSpine(rng: Rng): Draft {
  const c = rng.int(1, NX - 2);
  const b = new DraftBuilder();
  const rows = [NZ - 1, NZ - 2, NZ - 3];
  rows.slice(1).forEach((j, k) => b.edge({ i: c, j: rows[k] }, { i: c, j }));
  let loops = 0;
  for (const side of shuffle([-1, 1], rng)) {
    let previous: Cell | null = null;
    for (const j of rows) {
      const want = rng.chance(0.8) || (loops === 0 && side === 1 && j !== NZ - 1);
      if (!want) { previous = null; continue; }
      const cell = { i: c + side, j };
      b.edge({ i: c, j }, cell);
      // Joining neighbours along the flank is what turns the comb into loops.
      if (previous && (rng.chance(0.75) || loops === 0)) { b.edge(previous, cell); loops++; }
      previous = cell;
    }
  }
  return { cells: [...b.cells.values()], edges: [...b.edges.values()], entrance: { i: c, j: NZ - 1 }, court: pickCourt(b, rng, 0.35, c), phrase: 'off a central gallery' };
}

/** Chooses a room on a loop to leave open to the sky: a garth to be crossed. */
function pickCourt(b: DraftBuilder, rng: Rng, chance: number, avoidColumn = -1): Cell | null {
  if (!rng.chance(chance)) return null;
  const options = [...b.cells.values()].filter((c) => c.j !== NZ - 1 && c.i !== avoidColumn && b.degree(c) >= 2);
  return options.length ? rng.pick(options) : null;
}

function shuffle<V>(list: V[], rng: Rng): V[] {
  for (let k = list.length - 1; k > 0; k--) {
    const s = rng.int(0, k);
    [list[k], list[s]] = [list[s], list[k]];
  }
  return list;
}

/**
 * Generates the site for a seed. Several are drafted and the one with the richest structure is
 * kept: early layers are cheap, so it pays to make many and choose.
 */
/**
 * What kind of place to make: a house at the head of a valley (the default), a house on an island in the sea, a hospice on a
 * mountain top above the cloud, or a house at the head of a harbour town's square (in a world, on one of its coastal towns).
 */
export type PlaceKind = 'valley' | 'island' | 'mountain' | 'town';

/** Choices that are not part of the seed: trials of other ways of making a place, to be compared with the usual way. */
export interface MakeOptions {
  /**
   * How the land is made: by default (`eroded`) its plain shape is given fractal detail and worn by water and frost (`terrain.ts`)
   * before anything is laid on it, and the country round about is made the same way; `plain` keeps the plain shape alone, as
   * places were first made.
   */
  terrain?: 'eroded' | 'plain';
  /**
   * The place to build it on in a world (`world.ts`): the `n`th of the place's kind found in the world of seed `seed`. Its land is
   * the world's (`worldLand.ts`), the house's ground where the world found ground for it; the house is still the site's own seed's.
   * (Only for land that is made, not `plain`.)
   */
  world?: { seed: string; n: number };
  /** What settlement a valley is to have, whatever the seed would give it (`none` for none); if there is no room for it, what there is room for. */
  settlement?: NonNullable<Site['settlement']> | 'none';
}

export function generateSite(seed: string, kind: PlaceKind = 'valley', opts: MakeOptions = {}): Site {
  const base = new Rng(seed);
  const pickFrom = base.fork('setting');
  const setting: Setting = {
    stone: pickFrom.pick<Stone>(['limestone', 'limestone', 'sandstone', 'greystone', 'basalt']),
    hour: pickFrom.pick<Hour>(['morning', 'midday', 'evening', 'evening']),
    kind: pickFrom.pick(['priory', 'abbey', 'charterhouse', 'hospice', 'preceptory']),
    condition: pickFrom.pick<Setting['condition']>(['kept', 'kept', 'damp', 'forsaken', 'forsaken']),
    // Drawn from a stream of its own, so that adding it did not change any site already seen.
    season: base.fork('season').pick<NonNullable<Setting['season']>>(['spring', 'spring', 'summer', 'autumn']),
    // Mostly a sky of broken cloud; now and then nearly clear, or heavy.
    cloud: Math.round(base.fork('cloud').pick([0.12, 0.3, 0.38, 0.45, 0.5, 0.58, 0.72]) * 100) / 100,
  };
  // A mountain top has two seasons, not four: bare rock and thin turf in summer, snow in winter.
  // (From a stream of its own, so valleys and islands keep the seasons they had.)
  // And what stands on a pass or a peak, keeping travellers alive, is a hospice.
  if (kind === 'mountain') {
    setting.season = base.fork('mountain season').chance(0.5) ? 'winter' : 'summer'; setting.kind = 'hospice';
    // And it is at its best with the sun low: long shadows on rock and snow, the cloud lit from the side, the mountain's own
    // shadow lying out across it. So the day is oftener young or old up here than in a valley. (The evening goes on to sunset and dusk as elsewhere.)
    setting.hour = base.fork('mountain hour').pick<Hour>(['morning', 'morning', 'morning', 'midday', 'evening', 'evening', 'evening', 'evening']);
  }
  // The later hours were added after the first three, and are reached from the evening by a
  // stream of their own, so that most sites already seen keep the hour they had.
  if (setting.hour === 'evening') {
    const later = base.fork('later').next();
    setting.hour = later < 0.3 ? 'sunset' : later < 0.4 ? 'dusk' : later < 0.47 ? 'night' : 'evening';
  }
  // The air, from a stream of its own. Mist lies in low ground when the day is young or done,
  // and more in autumn; haze stands in the distance on any day, some days much more than
  // others; and cloud is heaped, or lies in flat banks, which it does oftenest under a low sun
  // and when there is much of it.
  {
    const air = base.fork('air');
    const damp = { morning: 0.5, midday: 0.04, evening: 0.16, sunset: 0.4, dusk: 0.58, night: 0.46 }[setting.hour];
    setting.mist = Math.round(Math.min(1, Math.max(0, damp + air.range(-0.28, 0.3) + (setting.season === 'autumn' ? 0.14 : 0))) * 100) / 100;
    setting.haze = Math.round((0.3 + 0.7 * air.next()) * 100) / 100;
    const low = setting.hour === 'morning' || setting.hour === 'sunset' || setting.hour === 'dusk';
    setting.cloudForm = air.chance(0.2 + (low ? 0.3 : 0) + ((setting.cloud ?? 0) > 0.55 ? 0.2 : 0)) ? 'layered' : 'heaped';
  }
  // How big a house this seed is for. Without a size to aim at, choosing the richest draft always
  // chooses the largest, and every site comes out with ten or eleven rooms.
  const size = pickFrom.pick([6, 7, 8, 8, 9, 9, 10, 11]);
  let best: Site | null = null, bestAttempt = -1;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    let site: Site;
    try {
      site = draftSite(seed, setting, base.fork(`site/${attempt}`), size, kind, { ...opts, terrain: 'plain' });
    } catch {
      continue;
    }
    const s = score(site, size);
    if (s > bestScore) { bestScore = s; best = site; bestAttempt = attempt; }
  }
  if (!best) throw new Error(`no site could be generated (seed ${seed})`);
  // (The drafts are judged by their houses alone; worn land takes a second or two to make, so only the draft kept is made again with it.)
  // (Every kind of place unless asked otherwise, `plain`: valleys too, now that a found one walks and looks as a drawn one does.)
  // (A town is always laid on land that was found: its drafts lay nothing out but the box it would have.)
  if (opts.terrain !== 'plain' || kind === 'town') {
    if (kind === 'town') return draftSite(seed, setting, base.fork(`site/${bestAttempt}`), size, kind, { ...opts, terrain: 'eroded' });
    try { return draftSite(seed, setting, base.fork(`site/${bestAttempt}`), size, kind, { ...opts, terrain: 'eroded' }); } catch (e) {
      // (The plain draft stands. `DBG_TERRAIN=1` before a tool says why.)
      if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DBG_TERRAIN) console.log('terrain:', (e as Error).message);
      // (But a place in a world is that place or nothing: the next best drafts are tried on it, and if none will go, it is said why.)
      if (opts.world) {
        let why = (e as Error).message;
        for (let attempt = 0; attempt < CANDIDATES; attempt++) {
          if (attempt === bestAttempt) continue;
          try { return draftSite(seed, setting, base.fork(`site/${attempt}`), size, kind, { ...opts, terrain: 'eroded' }); } catch (e2) { why = (e2 as Error).message; }
        }
        throw new Error(`no house of seed ${seed} could be built at ${kind} ${opts.world.n} of world ${opts.world.seed}: ${why}`);
      }
    }
  }
  return best;
}

/**
 * What is out in the valley: the track from the door to where the player arrives, and a few
 * things set back from it, near enough to be seen in passing and far enough to be a walk.
 */
function layOutValley(site: Site, meadow: Place, doorX: number, rng: Rng, worn = false, inWorld?: { seed: string; n: number }, asked?: MakeOptions['settlement']): void {
  const round = (v: number) => Math.round(v * 10) / 10;
  // The valley itself: its two sides, from the house to the gap at its foot. No two are the same shape.
  const others = site.places.filter((q) => q !== meadow), house = { x0: Math.min(...others.map((q) => q.x0)) - site.wallThickness, x1: Math.max(...others.map((q) => q.x1)) + site.wallThickness };
  // How the house stands: nearly half stand free in the valley; a third are no house but a delve of caves under the ridge; the rest are built into it.
  const stands = rng.fork('stands').next(), free = stands < 0.45;
  if (free) site.stands = 'free';
  else if (stands < 0.8) { site.stands = 'delve'; makeDelve(site, rng.fork('delve')); }
  const back = Math.min(...others.map((q) => q.z0)) - site.wallThickness;
  // If the land comes first, the valley is found now: the head of a glen in an upland made by noise and worn (`highlands.ts`), with
  // ground for the meadow at its head. (The uplands are drawn from a pool, as islands' seas are, so that one made serves many sites.)
  let found: { seed: number; spot: ValleySpot; world?: string } | undefined;
  if (worn && inWorld) {
    // (Or in a world, where it was found already: its tiles about it made first, if this is where the world was made.)
    const land = worldLand(inWorld.seed), q = land.places.find((o) => o.kind === 'valley' && o.n === inWorld.n);
    if (!q?.valley) throw new Error(`world ${inWorld.seed} has no valley head ${inWorld.n}`);
    for (const _ of makeTilesNear(land, q.x, q.z, WORLD_REACH)) { /* (each a second or two) */ }
    found = { seed: 0, spot: q.valley, world: inWorld.seed };
  } else if (worn) {
    const q = rng.fork('terrain'), LANDS = 16, first = q.int(0, LANDS - 1), stride = 1 + 2 * q.int(0, 4);
    for (let tries = 0; tries < 6 && !found; tries++) {
      const seed = 7001 + ((first + tries * stride) % LANDS) * 131, spots = findValleys(highlands(seed), meadow.x1 - meadow.x0, meadow.z1 - meadow.z0, meadow.z1 - meadow.z0 + 200, q.fork(`spot${tries}`));
      if (spots.length) found = { seed, spot: spots[Math.min(spots.length - 1, q.int(0, 2))] };
    }
  }
  const { valley: v, middle } = shapeValley(meadow, rng.fork('shape'), { ...house, z0: back }, free, found);
  site.valley = v;
  const within = v.west.slice(0, Math.round((v.mouth - v.z0) / v.step) + 1), withinE = v.east.slice(0, within.length);
  // (The box that holds it, for whatever only needs to know how far it reaches.)
  const g = { x0: round(Math.min(...within)), x1: round(Math.max(...withinE)), z0: v.z0, z1: round(v.mouth + 3) };
  site.grounds = g;
  // The track goes down it from the door to the gap, wandering, but never close under either side.
  const track: [number, number][] = [[doorX, meadow.z0]];
  let x = doorX;
  for (let z = meadow.z0 + 8; z <= v.mouth - 5; z += 8) {
    if (z > meadow.z1 - 2) {
      const w = edgeAt(v, 'w', z) + 13, e = edgeAt(v, 'e', z) - 13;
      x = w < e ? Math.min(e, Math.max(w, x + rng.range(-6.5, 6.5))) : (w + e) / 2;
      // Towards the gap it draws in to the middle of it.
      const near = Math.min(1, Math.max(0, (z - (v.mouth - 30)) / 24));
      x += (middle(v.mouth) - x) * near * near;
      // (And nowhere nearer either side than eight metres, measured square to the side: the sides draw in to the gap on a slant,
      // and measured straight across, as above, a track thirteen metres off was four from the side, in the rock carved along it.)
      for (let k = 0; k < 24 && insideOf(v, x, z) < 8; k++) x += ((edgeAt(v, 'w', z) + edgeAt(v, 'e', z)) / 2 - x) * 0.2;
    }
    track.push([round(x), round(z)]);
  }
  track.push([round((edgeAt(v, 'w', v.mouth) + edgeAt(v, 'e', v.mouth)) / 2), v.mouth - 1]);
  site.track = track;
  const fromTrack = (px: number, pz: number): number => {
    let best = Infinity;
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1];
      const t = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
      best = Math.min(best, Math.hypot(px - ax - (bx - ax) * t, pz - az - (bz - az) * t));
    }
    return best;
  };
  // What kind of settlement the valley has is settled first, and everything else is put round it.
  const settle = rng.fork('settle').next();
  site.settlement = settle < 0.4 ? 'village' : settle < 0.6 ? 'hamlet' : settle < 0.78 ? 'manor' : undefined;
  // Of the valleys meant to have a village, about half have a little town of brick instead. (From a stream of its own.)
  if (site.settlement === 'village' && rng.fork('town').chance(0.5)) site.settlement = 'town';
  if (asked) site.settlement = asked === 'none' ? undefined : asked;
  if (!site.settlement) delete site.settlement;
  // (A town that has no room is a village of timber houses, which take less; a village that has none, a hamlet.)
  if (site.settlement === 'town' && !layOutTown(site, meadow, fromTrack, rng.fork('town street'))) site.settlement = 'village';
  if (site.settlement === 'village' && !layOutVillage(site, meadow, fromTrack, rng.fork('village'))) site.settlement = 'hamlet';
  const features: Feature[] = [];
  const place = (kind: Feature['kind'], radius: [number, number], nearest: number, furthest: number) => {
    for (let tries = 0; tries < 200; tries++) {
      const r = rng.range(radius[0], radius[1]);
      const px = rng.range(g.x0 + 16 + r, g.x1 - 16 - r), pz = rng.range(meadow.z1 + 8 + r, g.z1 - 12 - r);
      if (!walkable(v, px, pz, 15 + r) || !clearOfBuildings(site, px, pz, r + 6)) continue;
      const d = fromTrack(px, pz);
      if (d < r + nearest || d > r + furthest) continue;
      if (features.some((f) => Math.hypot(f.x - px, f.z - pz) < f.r + r + 14)) continue;
      features.push({ kind, x: round(px), z: round(pz), r: round(r) });
      return;
    }
  };
  // Two of the three things a valley may hold, and now and then all of them.
  const kinds: Feature['kind'][] = ['pond', 'stones', 'ruin'];
  const leaveOut = rng.chance(0.3) ? -1 : rng.int(0, 2);
  for (const kind of kinds.filter((_, k) => k !== leaveOut)) {
    if (kind === 'pond') place('pond', [7.5, 10.5], 5, 15);
    if (kind === 'stones') place('stones', [3.4, 4.2], 9, 30);
    if (kind === 'ruin') place('ruin', [4.2, 5.2], 6, 22);
  }
  site.features = features;
  layOutWater(site, meadow, fromTrack, rng.fork('water'));
  layOutHeights(site, meadow, fromTrack, rng.fork('heights'));
  layOutArms(site, meadow, doorX, rng.fork('armways'));
  layOutTower(site, meadow, fromTrack, rng.fork('tower'));
  layOutFootpaths(site, rng.fork('footpaths'));
  if (site.settlement && site.settlement !== 'village' && site.settlement !== 'town') layOutBuildings(site, meadow, fromTrack, rng.fork('buildings'), site.settlement === 'hamlet');
  layOutMill(site, fromTrack, rng.fork('mill'));
  layOutCamp(site, meadow, fromTrack, rng.fork('camp'));
  layOutMine(site, meadow, fromTrack, rng.fork('mine'));
  // On the hills about the valley, now and then, something built: seen against the sky from the valley floor.
  {
    const far = rng.fork('landmarks'), count = far.pick([0, 1, 1, 2, 2, 3]), taken: number[] = [];
    for (let i = 0; i < count; i++) {
      // (Not behind the house, where the escarpment hides the hills, and no two near one another.)
      let angle = 0;
      for (let tries = 0; tries < 20; tries++) { angle = Math.round(far.range(-25, 205)); if (taken.every((t) => Math.abs(t - angle) > 38)) break; }
      taken.push(angle);
      const kind = far.pick(['castle', 'castle', 'tower', 'tower', 'tower', 'ruin', 'ruin', 'monument'] as const);
      (site.landmarks ??= []).push({ kind, angle, range: kind === 'castle' && far.chance(0.5) ? 'far' : 'near' });
    }
  }
}

/**
 * A delve: the plan of the house turned into caves. Every room that need not be built becomes a
 * chamber of rock; a court becomes a cavern, with a shaft to the sky if there is room for one;
 * an open arch between two chambers becomes a cleft, so that they are carved as one; windows
 * between chambers go. What stays built: the way in, the sanctum, the room behind a secret door,
 * any room a stair goes up or down from, and every wall a door hangs in.
 */
function makeDelve(site: Site, rng: Rng): void {
  const round = (x: number) => Math.round(x * 100) / 100;
  const stairs = new Set(site.ways.filter((w) => w.kind === 'stair').flatMap((w) => [w.a, w.b]));
  const secretWays = site.ways.filter((w) => w.door?.leaf === 'secret').flatMap((w) => [w.a, w.b]);
  const cave = new Set<number>();
  for (const p of site.places) {
    if (p.role === 'approach' || p.role === 'entrance' || p.role === 'goal' || p.id === site.secret || secretWays.includes(p.id) || stairs.has(p.id) || p.roof === 'cave') { if (p.roof === 'cave') cave.add(p.id); continue; }
    const court = p.roof === 'sky', roomy = Math.min(p.x1 - p.x0, p.z1 - p.z0) >= 5;
    p.roof = 'cave';
    p.fallen = undefined;
    cave.add(p.id);
    if (court && roomy) {
      p.wall = round(rng.range(5.6, 7));
      p.light = 'day';
      p.shaft = { x: round((p.x0 + p.x1) / 2 + rng.range(-0.6, 0.6)), z: round((p.z0 + p.z1) / 2 + rng.range(-0.6, 0.6)), r: round(rng.range(1.7, 2.3)) };
      p.name = rng.pick(['cavern', 'well of light', 'open cavern']);
    } else {
      p.wall = round(rng.range(3.3, 4.8));
      p.light = rng.chance(0.45) ? 'glow' : 'dark';
      p.name = rng.pick(['cave', 'hollow', 'chamber', 'rift', 'gallery of rock', 'grotto']);
    }
  }
  site.ways = site.ways.filter((w) => !(w.kind === 'window' && (cave.has(w.a) || cave.has(w.b))));
  // Never two dark places in a row, here as in a house: a chamber beside a dark one has growths on its rock that glow.
  for (const id of cave) {
    const p = site.places[id];
    if (p.light !== 'dark') continue;
    if (site.ways.some((w) => w.kind !== 'window' && (w.a === id || w.b === id) && site.places[w.a === id ? w.b : w.a].light === 'dark')) p.light = 'glow';
  }
  // (And most doorways between two chambers were never doorways: a cleft, not a wall with a door in it. Some are walled, and keep their doors.)
  for (const w of site.ways) if (cave.has(w.a) && cave.has(w.b) && (w.kind === 'arch' || (w.kind === 'door' && !w.door && rng.chance(0.6)))) { w.kind = 'arch'; w.natural = true; w.halfWidth = round(rng.range(0.9, 1.3)); }
}

/**
 * The arms of the valley past the house. Each has a footpath up it from the track before the
 * door, and something at the end of the path: the cave, if there is one in that arm, and if not
 * the ruin of a hut near its head. The path keeps to the middle of the arm, wandering a little.
 */
function layOutArms(site: Site, meadow: Place, doorX: number, rng: Rng): void {
  const v = site.valley!, round = (x: number) => Math.round(x * 10) / 10, features = site.features ?? [];
  for (const arm of armsOf(v)) {
    const inw = arm.side === 'w' ? 1 : -1, cave = (site.grottoes ?? []).find((q) => q.side === arm.side && q.z < v.ridge!.z);
    let goal: [number, number];
    let to: 'cave' | 'ruin';
    if (cave) {
      // (To the floor before the cave's mouth.)
      goal = [edgeAt(v, arm.side, cave.z) + inw * 9.5, cave.z];
      to = 'cave';
    } else {
      // (Where the arm has opened out enough to hold it: towards the head, but not in it.)
      const r = round(rng.range(4.2, 4.8));
      let z = arm.head + 10;
      while (z < v.ridge!.z - 14 && !walkable(v, arm.middle(z), z, r + 1.8)) z += 2;
      const x = arm.middle(z);
      if (!walkable(v, x, z, r + 1.8) || features.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r + 8)) continue;
      features.push({ kind: 'ruin', x: round(x), z: round(z), r });
      goal = [x, z + r + 1.5];
      to = 'ruin';
    }
    // From the track a few strides out from the door, across to the mouth of the arm, and up it.
    const front = v.ridge!.z, points: [number, number][] = [[round(doorX), round(meadow.z0 + 7)], [round(arm.middle(front - 3)), round(front + 6)]];
    let wander = 0;
    for (let z = front - 3; z > goal[1] + 4; z -= 5) {
      wander = Math.max(-2.2, Math.min(2.2, wander + rng.range(-1, 1)));
      points.push([round(arm.middle(z) + wander), round(z)]);
    }
    points.push([round(goal[0]), round(goal[1])]);
    (site.paths ??= []).push({ points, to });
  }
  site.features = features;
}

/**
 * A mill, where a stream runs out of a pond: on the stream's bank a little below the pond, where
 * the stream runs fairly straight down the valley, a timber house with its back to the water and
 * a waterwheel in the stream beside its back wall; and a footpath from the track to its door.
 */
function layOutMill(site: Site, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const v = site.valley!, round = (x: number) => Math.round(x * 10) / 10;
  const st = (site.streams ?? []).find((q) => q.from === 'pond');
  if (!st || !rng.chance(0.75)) return;
  const pond = (site.features ?? []).find((f) => f.kind === 'pond')!;
  const house = timberHouse(rng.fork('house'), [0.84, 0.8, 0.7]);
  house.storeys = 2; house.heights = house.heights.slice(0, 2);
  for (let k = 1; k < st.course.length; k++) {
    const [ax, az] = st.course[k - 1], [bx, bz] = st.course[k], len = Math.hypot(bx - ax, bz - az);
    // (Along the valley, fairly straight, and clear of the pond's shore by a few strides.)
    if (len < 1 || Math.abs(bx - ax) / len > 0.45) continue;
    const mz = (az + bz) / 2, mx = (ax + bx) / 2;
    if (Math.hypot(mx - pond.x, mz - pond.z) < shoreOf(pond, mx - pond.x, mz - pond.z) + 5) continue;
    // (On the track's side of the stream, so that its door, which faces away from the water, faces the track.)
    const toTrack = Math.sign(site.track!.reduce((best, t) => (Math.abs(t[1] - mz) < Math.abs(best[1] - mz) ? t : best), site.track![0])[0] - mx) || 1;
    for (const side of [toTrack as -1 | 1]) {
      const off = house.d / 2 + st.width / 2 + 1.1, x = round(mx + side * off), z = round(mz);
      // (Its back is the side towards the stream: a house east of the stream faces east, its back to the west.)
      const b: Building = { ...house, x, z, faces: side > 0 ? 'e' : 'w' };
      const ok = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([du, dv]) => {
        const px = x + (du * b.d) / 2, pz = z + (dv * b.w) / 2;
        return walkable(v, px, pz, 4) && fromTrack(px, pz) > 3.5 && clearOfBuildings(site, px, pz, 2) && !(site.features ?? []).some((f) => Math.hypot(f.x - px, f.z - pz) < (f.kind === 'pond' ? shoreOf(f, px - f.x, pz - f.z) + 1.5 : f.r * 2.4));
      });
      if (!ok) continue;
      b.door = 0.5;
      b.plan = planTimber(b);
      b.wheel = { x: round(mx), z, y: 1.15, r: 1.9 };
      // The footpath to its door: from the nearest point of the track that has a clear way across to it, past nothing that stands or lies there.
      const doorX = x + side * (b.d / 2 + 1.2);
      const clearLine = (tx: number, tz: number) => {
        const len = Math.hypot(doorX - tx, z - tz);
        for (let t = 2; t < len; t += 1) { const px = tx + ((doorX - tx) * t) / len, pz = tz + ((z - tz) * t) / len; if (!roomAt(site, px, pz, 0.9)) return false; }
        return true;
      };
      const from = [...site.track!].sort((p, q) => Math.hypot(p[0] - doorX, p[1] - z) - Math.hypot(q[0] - doorX, q[1] - z)).find(([tx, tz]) => clearLine(tx, tz));
      if (!from) continue;
      (site.buildings ??= []).push(b);
      if (Math.hypot(from[0] - doorX, from[1] - z) > 6) (site.paths ??= []).push({ to: 'mill', points: [[round(from[0]), round(from[1])], [round((from[0] + doorX) / 2), round((from[1] + z) / 2)], [round(doorX), z]] });
      return;
    }
  }
}

/**
 * A way through the hill. Where a cave chamber of the house lies at its outer edge beside an arm
 * of the valley, a tunnel may run from it straight out through the ridge to a mouth in the
 * ridge's side: so whoever goes in at the front can come out in the arm, by the path to the
 * cave or the ruin there. Only from a chamber that can be reached without a key, a bar, a lever
 * or a secret door, so that it is no way round any of them.
 */
function layOutBackWay(site: Site, meadow: Place, rng: Rng): void {
  const v = site.valley, r = v?.ridge;
  if (!v || !r || site.stands === 'free' || !rng.chance(0.85)) return;
  // What can be reached from the door with nothing in hand.
  const open = new Set<number>([site.start]), queue = [site.start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const w of site.ways) {
      if (w.kind === 'window' || (w.a !== id && w.b !== id)) continue;
      if (w.door && (w.door.lock || w.door.barredFrom !== undefined || w.door.leaf === 'gate' || w.door.leaf === 'secret')) continue;
      const n = w.a === id ? w.b : w.a;
      if (!open.has(n)) { open.add(n); queue.push(n); }
    }
  }
  const fits: NonNullable<Site['backWay']>[] = [];
  for (const p of site.places) {
    if (p.roof !== 'cave' || (p.level ?? 0) !== 0 || !open.has(p.id) || p.id === site.secret) continue;
    const z = Math.round(((p.z0 + p.z1) / 2) * 10) / 10;
    if (z > meadow.z0 - 10.5 || p.z1 - p.z0 < 4) continue;
    for (const side of ['w', 'e'] as const) {
      // The outermost place on that side at that place along the house, with an arm beside the ridge broad enough for a mouth to open into.
      if (site.places.some((q) => q !== p && q.role !== 'approach' && q.z0 < z + 2.5 && q.z1 > z - 2.5 && (side === 'w' ? q.x0 < p.x0 : q.x1 > p.x1))) continue;
      const edge = side === 'w' ? r.x0 : r.x1, arm = side === 'w' ? r.x0 - edgeAt(v, 'w', z) : edgeAt(v, 'e', z) - r.x1, length = side === 'w' ? p.x0 - r.x0 : r.x1 - p.x1;
      if (arm < 12 || length < 6 || length > 16) continue;
      // (Its floor climbs or falls from the chamber's to the arm's, no steeper than a hill path.)
      if (Math.abs(meadow.floor + armRise(z, meadow.z0) - p.floor) > 0.3 * (length + 3)) continue;
      const mx = edge + (side === 'w' ? -5.5 : 5.5);
      if ((site.features ?? []).some((f) => Math.hypot(f.x - mx, f.z - z) < f.r + 3.5)) continue;
      fits.push({ place: p.id, side, z });
    }
  }
  if (!fits.length) return;
  const bw = rng.pick(fits);
  site.backWay = bw;
  // And from the tunnel, more often than not, a way down: to a cavern under the arm, deep enough that the arm's floor lies well over its roof.
  const deep = rng.fork('deep'), p = site.places[bw.place], round = (x: number) => Math.round(x * 10) / 10;
  const dir = bw.side === 'w' ? 1 : -1, edge = bw.side === 'w' ? r.x0 : r.x1, length = (bw.side === 'w' ? p.x0 - r.x0 : r.x1 - p.x1);
  const lucky = deep.chance(0.75);
  if (p.floor - (meadow.floor + armRise(bw.z, meadow.z0)) > 0.8) return;
  const from = round(Math.max(2.5, length - 3)), rx = round(deep.range(6, 8)), rz = round(deep.range(5, 6.5));
  // The branch runs along the ridge between its side and the house: no place may stand out into that strip.
  const stripClear = (z1: number) => !site.places.some((q) => q !== p && q.role !== 'approach' && q.z0 < Math.max(bw.z, z1) + 2 && q.z1 > Math.min(bw.z, z1) - 2 && (bw.side === 'w' ? q.x0 < p.x0 - 1 : q.x1 > p.x1 + 1));
  // If there is a cave in the wall of that arm, the cavern is put where a passage can come down to it from the back of the cave as
  // well: so the cave, the cavern and the house are one system, and the hill can be gone into at one and come out of at another.
  const cave = (site.grottoes ?? [])[0];
  if (cave && !cave.hall && cave.side === bw.side && cave.z < r.z) {
    let best: { cost: number; deep: NonNullable<NonNullable<Site['backWay']>['deep']> } | null = null;
    for (const s of [-1, 1] as const) for (let run = 14; run <= 36; run += 2) {
      // The cavern is not under the arm, which draws in towards its head and seldom has room, but under the hill behind the arm's
      // outer wall: the passage from the cave runs behind that wall to it, and the way from the house crosses to it deep under the arm.
      // (That way first runs along inside the ridge until it is level with the cavern, and so comes to it from the side and not from the
      // end the passage comes in by.)
      // (The passage, going on as it was going, runs into the cavern's end; the way from the house comes into its side. So the two do not arrive together, one over the other.)
      const endZ = cave.z + s * (1.2 * cave.r + run), cz = round(endZ + s * (rz + 2.5)), toward = cz >= bw.z ? 1 : -1, leg = round(Math.min(36, Math.max(8, Math.abs(cz - bw.z)))), z1 = bw.z + toward * leg;
      if (Math.max(z1 + 6, cz + rz) > meadow.z0 || cz - rz < v.z0 - 12 || !stripClear(z1)) continue;
      const made = { from, leg, toward, x: round(edgeAt(v, bw.side, endZ) - dir * 7.4), z: cz, rx, rz, height: 5, drop: 8.5, join: { toward: s, run } } as const;
      const line = joinLine(v, cave, made), lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1])), total = lens.reduce((t, l) => t + l, 0);
      // (It goes down no steeper than the other way does, leaves the cave on the level, and comes level into the cavern; its last leg is not a mere kink; it does not pass over the cavern, where it would break in through the roof; and it keeps away from water at the wall's foot.)
      const fall = meadow.floor + armRise(cave.z, meadow.z0) - (p.floor - 8.5) + 0.5;
      if ((total - 5) * 0.4 < fall || lens[lens.length - 1] < 2.5) continue;
      if (line.slice(0, -1).some(([x, z]) => Math.hypot((x - made.x) / (rx + 2.6), (z - cz) / (rz + 2.6)) < 1)) continue;
      // (Nor does the way from the house, crossing to the cavern at the cavern's depth, pass under it where it has itself come down
      // more than half way: higher up there is rock enough between the two.)
      const ax = edge - dir * 5, bx = made.x + dir * (rx - 1.2) - ax, bz = cz - z1;
      let along = 0;
      if (line.slice(0, -1).some(([x, z], i) => {
        along += i ? lens[i - 1] : 0;
        const t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - z1) * bz) / (bx * bx + bz * bz)));
        return along > total * 0.5 && Math.hypot(x - ax - bx * t, z - z1 - bz * t) < 4;
      })) continue;
      if ((site.features ?? []).some((f) => line.some(([x, z]) => Math.hypot(f.x - x, f.z - z) < f.r + 5))) continue;
      if ((site.streams ?? []).some((st) => st.course.some(([x, z]) => line.slice(0, -1).some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 6)))) continue;
      if (!best || run < best.cost) best = { cost: run, deep: made };
    }
    if (best) { bw.deep = best.deep; return; }
  }
  // Or a hall cut under the hill from that arm: then the cavern lies beyond the hall, to one side of it, and the passage to it leaves by a
  // door in the hall's side wall (or, from a great hall, by one in the room over its upper bridge, which was made to have a door onward).
  if (cave && cave.hall && cave.side === bw.side && cave.z < r.z) {
    const h = cave.hall, half = h.width / 2, caveEdge = edgeAt(v, cave.side, cave.z), hall0 = 3.9 + h.drop / 0.5 + 1.6;
    let best: { cost: number; deep: NonNullable<NonNullable<Site['backWay']>['deep']> } | null = null;
    for (const s of (h.great ? [h.great.gallery === 's' ? -1 : 1] : [-1, 1]) as (-1 | 1)[]) for (let run = 10; run <= 30; run += 2) {
      const on = hallOnward(v, cave, s), endZ = cave.z + s * (on.end - 0.6 + run), cz = round(endZ + s * (rz + 2.5)), toward = cz >= bw.z ? 1 : -1, leg = round(Math.min(36, Math.max(8, Math.abs(cz - bw.z)))), z1 = bw.z + toward * leg;
      if (Math.max(z1 + 6, cz + rz) > meadow.z0 || cz - rz < v.z0 - 12 || !stripClear(z1)) continue;
      const made = { from, leg, toward, x: round(on.x), z: cz, rx, rz, height: 5, drop: 8.5, join: { toward: s, run } } as const;
      const line = joinLine(v, cave, made), lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1])), total = lens.reduce((t, l) => t + l, 0);
      // (It goes down to the cavern, not up, and no steeper than the other ways do.)
      const fall = meadow.floor + armRise(cave.z, meadow.z0) - h.drop - (p.floor - 8.5);
      if (fall < 0.8 || (total - 5) * 0.4 < fall + 0.5) continue;
      // (All of it lies under the hill and none of it under the valley, whichever way the valley's side goes from here.)
      const round_ = Array.from({ length: 8 }, (_, k) => [made.x + Math.cos((k * Math.PI) / 4) * rx, cz + Math.sin((k * Math.PI) / 4) * rz]);
      if ([...line, ...round_].some(([x, z]) => insideOf(v, x, z) > -3)) continue;
      // (And the way from the house, crossing to the cavern, keeps clear of the hall and of the stair down to it: it is at their depth.)
      const ax = edge - dir * 5, bx = made.x + dir * (rx - 1.2) - ax, bz = cz - z1, n = Math.ceil(Math.hypot(bx, bz));
      let clear = true;
      for (let k = 0; k <= n && clear; k++) {
        const x = ax + (bx * k) / n, z = z1 + (bz * k) / n, t = 7 - (x - caveEdge) * (dir), off = Math.abs(z - cave.z);
        if (t > -1 && t < hall0 + h.length + 6 && off < (t < hall0 - 2 ? 2.4 : half + (h.great ? 10 : 1)) + 5) clear = false;
      }
      if (!clear) continue;
      if (!best || run < best.cost) best = { cost: run, deep: made };
    }
    if (best) { bw.deep = best.deep; return; }
  }
  if (!lucky) return;
  const leg = 8;
  for (const toward of [-1, 1] as const) {
    const z1 = bw.z + toward * leg, cz = z1 + toward * 1.5;
    // (Not under the valley below the house front, where ponds lie in hollows; nor near a hall under the hill on that side.)
    if (Math.max(z1, cz + rz) > meadow.z0 - 6) continue;
    if ((site.grottoes ?? []).some((q) => q.side === bw.side && Math.abs(q.z - cz) < (q.hall ? 24 : 9))) continue;
    if (!stripClear(z1)) continue;
    bw.deep = { from, leg, toward, x: round(edge - dir * (6 + rx)), z: round(cz), rx, rz, height: 5, drop: 8.5 };
    return;
  }
}

/**
 * A footpath from the track to each thing that lies off it and is worth walking to: the ring of
 * stones, the ruin, the landing stage of a pond, the tower's door. Each leaves the track at the
 * nearest point and goes straight there, wandering a little, and stops at the thing's edge.
 */
function layOutFootpaths(site: Site, rng: Rng): void {
  const track = site.track ?? [], round = (x: number) => Math.round(x * 10) / 10;
  if (track.length < 2) return;
  const nearestOnTrack = (x: number, z: number): [number, number] => {
    let best: [number, number] = track[0], bd = Infinity;
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)), px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = [px, pz]; }
    }
    return best;
  };
  const lead = (x: number, z: number, edge: number, to: NonNullable<Site['paths']>[number]['to']) => {
    const [tx, tz] = nearestOnTrack(x, z), d = Math.hypot(x - tx, z - tz);
    if (d - edge < 5) return;
    const ux = (x - tx) / d, uz = (z - tz) / d, n = Math.max(2, Math.round((d - edge) / 4));
    const points: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const t = ((d - edge) * k) / n, w = k === 0 || k === n ? 0 : Math.sin((k / n) * Math.PI) * rng.range(-1.4, 1.4);
      points.push([round(tx + ux * t - uz * w), round(tz + uz * t + ux * w)]);
    }
    (site.paths ??= []).push({ points, to });
  };
  // To the foot of the way up to a shrine, which pilgrims walk.
  for (const t of site.terraces ?? []) if (t.shrine && site.valley) {
    const z = t.rise === 'n' ? t.z0 - t.run - 1.5 : t.z1 + t.run + 1.5, x = edgeAt(site.valley, t.side, z) + (t.side === 'w' ? 1 : -1) * 6.2;
    lead(x, z, 0, 'shrine');
  }
  for (const f of site.features ?? []) {
    if (f.kind === 'stones') lead(f.x, f.z, f.r * 1.55, 'stones');
    else if (f.kind === 'ruin' && !(site.paths ?? []).some((p) => p.to === 'ruin' && Math.hypot(p.points[p.points.length - 1][0] - f.x, p.points[p.points.length - 1][1] - f.z) < f.r + 3)) lead(f.x, f.z, f.r + 1.2, 'ruin');
    else if (f.kind === 'pond') { const [tx, tz] = nearestOnTrack(f.x, f.z); lead(f.x, f.z, shoreOf(f, tx - f.x, tz - f.z) * 0.98, 'pond'); }
  }
  if (!site.keep) for (const t of site.towers ?? []) lead(t.x + (t.door === 'e' ? t.half + 1.2 : -t.half - 1.2), t.z, 0, 'tower');
}

/**
 * A mine, in about one valley in four that has no hall under the hill: an adit driven into one side of the valley where the
 * side runs fairly straight and nothing else is, with its yard before it. Recorded as a cave of the valley's wall is, since
 * that is what it is to everything that asks where the wall is opened.
 */
function layOutMine(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const v = site.valley, track = site.track ?? [];
  if (!v || track.length < 2 || (site.grottoes ?? []).some((q) => q.hall) || !rng.chance(0.4)) return;
  const round = (x: number) => Math.round(x * 10) / 10;
  for (let tries = 0; tries < 160; tries++) {
    const side = rng.chance(0.5) ? 'w' : 'e', inw = side === 'w' ? 1 : -1, z = round(rng.range(meadow.z1 + 14, v.mouth - 24)), edge = edgeAt(v, side, z);
    if (Math.max(...[-8, -4, 0, 4, 8].map((d) => Math.abs(slantAt(v, side, z + d)))) > 0.28) continue;
    const heap = round(rng.range(8, 10.5)), yardX = edge + inw * 13, tipX = edge + inw * (8 + heap);
    // The yard: from the foot of the wall out to the tip of the heap, and a few strides to either side.
    if (!walkable(v, tipX, z, 6) || !roomAt(site, yardX, z, 10) || fromTrack(tipX, z) < 5) continue;
    if ((site.grottoes ?? []).some((q) => q.side === side && Math.abs(q.z - z) < 18)) continue;
    if ((site.terraces ?? []).some((t) => t.side === side && z > t.z0 - t.run - 14 && z < t.z1 + t.run + 14)) continue;
    if (site.keep && Math.hypot(site.keep.x - yardX, site.keep.z - z) < 40) continue;
    if (site.camp && Math.hypot(site.camp.x - yardX, site.camp.z - z) < site.camp.r + 16) continue;
    if ((site.paths ?? []).some((p) => p.points.some(([px, pz]) => Math.hypot(px - yardX, pz - z) < 11))) continue;
    if ((site.streams ?? []).some((st) => st.course.some(([x, cz]) => Math.abs(x - edge) < 20 && Math.abs(cz - z) < 11))) continue;
    const length = round(rng.range(14, 22));
    (site.grottoes ??= []).push({ side, z, r: 1.2, mine: { length, cross: { at: round(length * rng.range(0.45, 0.6)), length: round(rng.range(4.5, 7)), side: rng.chance(0.5) ? 1 : -1 }, heap, shed: rng.chance(0.5) ? 1 : -1 } });
    // A footpath from the track to the yard, coming in beside the tramway.
    let tx = track[0][0], tz = track[0][1], bd = Infinity;
    const gx = edge + inw * 10, gz = z;
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((gx - ax) * (bx - ax) + (gz - az) * (bz - az)) / l2)), px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      if (Math.hypot(gx - px, gz - pz) < bd) { bd = Math.hypot(gx - px, gz - pz); tx = px; tz = pz; }
    }
    const shedSide = site.grottoes[site.grottoes.length - 1].mine!.shed, ex = edge + inw * 6, ez = z - shedSide * 2.2, d = Math.hypot(ex - tx, ez - tz);
    if (d > 6) {
      const ux = (ex - tx) / d, uz = (ez - tz) / d, n = Math.max(2, Math.round(d / 4)), points: [number, number][] = [];
      for (let k = 0; k <= n; k++) {
        const t = (d * k) / n, w = k === 0 || k === n ? 0 : Math.sin((k / n) * Math.PI) * rng.range(-1.2, 1.2);
        points.push([round(tx + ux * t - uz * w), round(tz + uz * t + ux * w)]);
      }
      (site.paths ??= []).push({ points, to: 'mine' });
    }
    return;
  }
}

/**
 * A camp of charcoal burners, in about one valley in four that has no village: in a clearing some way off the track, where
 * nothing else is, with a footpath to it. What stands in it is set out round the way in, which is on the side towards the track:
 * the clamp that is burning nearest the middle, where it can be watched from the hut's door; the hut at the back; the one being
 * built and the one raked out to either side; the cordwood by the way in, where it was carted to.
 */
function layOutCamp(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const v = site.valley, g = site.grounds, track = site.track ?? [];
  if (!v || !g || track.length < 2 || site.settlement === 'village' || site.settlement === 'town' || !rng.chance(0.45)) return;
  const round = (x: number) => Math.round(x * 10) / 10;
  for (let tries = 0; tries < 200; tries++) {
    const r = round(rng.range(7.5, 9)), x = round(rng.range(g.x0 + 12, g.x1 - 12)), z = round(rng.range(meadow.z1 + 10, v.mouth - 16));
    if (!walkable(v, x, z, r + 6) || !roomAt(site, x, z, r + 5)) continue;
    const off = fromTrack(x, z);
    if (off < r + 7 || off > r + 34) continue;
    // (Not under a terrace or the way up to one, nor across a footpath, nor before a cave's mouth.)
    if ((site.terraces ?? []).some((t) => z > t.z0 - t.run - r - 3 && z < t.z1 + t.run + r + 3 && (t.side === 'w' ? x - edgeAt(v, 'w', z) : edgeAt(v, 'e', z) - x) < t.depth + r + 4)) continue;
    if ((site.paths ?? []).some((p) => p.points.some(([px, pz]) => Math.hypot(px - x, pz - z) < r + 3))) continue;
    if ((site.grottoes ?? []).some((q) => Math.abs(q.z - z) < r + 6 && (q.side === 'w' ? x - edgeAt(v, 'w', z) : edgeAt(v, 'e', z) - x) < r + 14)) continue;
    // The nearest point of the track: the way in is on that side, and the footpath comes from there.
    let tx = track[0][0], tz = track[0][1], bd = Infinity;
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)), px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      if (Math.hypot(x - px, z - pz) < bd) { bd = Math.hypot(x - px, z - pz); tx = px; tz = pz; }
    }
    const a0 = Math.atan2(tz - z, tx - x), at = (a: number, d: number): [number, number] => [round(x + Math.cos(a0 + a) * d * r), round(z + Math.sin(a0 + a) * d * r)];
    const turn = (a: number) => round(a0 + a);
    const [hx, hz] = at(Math.PI + 0.55, 0.66), [bx, bz] = at(1.2, 0.4), [nx, nz] = at(-1.6, 0.5), [sx, sz] = at(Math.PI - 0.75, 0.7);
    const camp: NonNullable<Site['camp']> = {
      x, z, r,
      clamps: [
        { x: bx, z: bz, r: round(rng.range(1.9, 2.2)), state: 'burning' },
        { x: nx, z: nz, r: round(rng.range(1.6, 1.8)), state: 'building' },
        { x: sx, z: sz, r: round(rng.range(1.8, 2.1)), state: 'spent' },
      ],
      hut: { x: hx, z: hz, r: 2.4, facing: round(Math.atan2(bz - hz, bx - hx)) },
      stacks: [
        { x: at(0.85, 0.88)[0], z: at(0.85, 0.88)[1], turn: turn(0.85 + Math.PI / 2), length: round(rng.range(2.6, 3.4)) },
        { x: at(-0.8, 0.88)[0], z: at(-0.8, 0.88)[1], turn: turn(-0.8 + Math.PI / 2), length: round(rng.range(2.4, 3.2)) },
        { x: at(2.95, 0.9)[0], z: at(2.95, 0.9)[1], turn: turn(2.95 + Math.PI / 2), length: round(rng.range(2.0, 2.8)) },
      ],
      props: [
        { kind: 'block', x: at(0.5, 0.62)[0], z: at(0.5, 0.62)[1], turn: turn(rng.range(0, 6)) },
        { kind: 'sledge', x: at(-0.3, 0.6)[0], z: at(-0.3, 0.6)[1], turn: turn(-0.3 + 0.4) },
        { kind: 'barrel', x: round(hx + Math.cos(Math.atan2(bz - hz, bx - hx) + 0.9) * 2.5), z: round(hz + Math.sin(Math.atan2(bz - hz, bx - hx) + 0.9) * 2.5), turn: 0 },
        { kind: 'sacks', x: round(sx + Math.cos(a0 + 0.5) * 2.6), z: round(sz + Math.sin(a0 + 0.5) * 2.6), turn: turn(rng.range(0, 6)) },
        { kind: 'hearth', x: at(Math.PI - 0.35, 0.3)[0], z: at(Math.PI - 0.35, 0.3)[1], turn: 0 },
      ],
    };
    site.camp = camp;
    // The footpath, from the track to the edge of the clearing, wandering a little.
    const d = Math.hypot(x - tx, z - tz), ux = (x - tx) / d, uz = (z - tz) / d, n = Math.max(2, Math.round((d - r) / 4)), points: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const t = ((d - r * 0.8) * k) / n, w = k === 0 || k === n ? 0 : Math.sin((k / n) * Math.PI) * rng.range(-1.2, 1.2);
      points.push([round(tx + ux * t - uz * w), round(tz + uz * t + ux * w)]);
    }
    (site.paths ??= []).push({ points, to: 'camp' });
    return;
  }
}

/**
 * A tower in the valley, in something under half of them: a few strides off the track, with
 * its door towards it, on ground that nothing else has taken.
 */
function layOutTower(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const g = site.grounds!;
  if (!rng.chance(0.55) || site.keep) return;
  const round = (v: number) => Math.round(v * 10) / 10;
  // Where the track crosses water, the tower stands to watch the crossing: tried there first, a few strides off it.
  const crossing = (site.streams ?? []).find((st) => st.crossing)?.crossing, watch = rng.fork('watch');
  for (let tries = 0; tries < 120; tries++) {
    const near = crossing && tries < 40, a = watch.range(0, Math.PI * 2), r = watch.range(9, 15);
    const x = round(near ? crossing.x + Math.cos(a) * r : rng.range(g.x0 + 17, g.x1 - 17)), z = round(near ? crossing.z + Math.sin(a) * r : rng.range(meadow.z1 + 12, g.z1 - 18)), off = fromTrack(x, z);
    if (off < 7.5 || off > 15 || !walkable(site.valley!, x, z, 15)) continue;
    let free = true;
    for (const f of site.features ?? []) if (Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.15) + 8) free = false;
    for (const st of site.streams ?? []) for (let k = 0; k < st.course.length - 1 && free; k++) {
      const [ax, az] = st.course[k], [bx, bz] = st.course[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
      if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < st.width / 2 + 9) free = false;
    }
    if (!free) continue;
    // The door is in whichever of the east and west walls looks at the track.
    // (Three storeys at the least, and as many as eight: some are a watch-house and some a landmark.)
    site.towers = [{ x, z, half: 3.1, storeys: 3 + rng.fork('tall').int(0, 5), door: fromTrack(x + 2, z) < fromTrack(x - 2, z) ? 'e' : 'w' }];
    return;
  }
}

/** Whether there is room at a point: nothing lying in the valley, no water and no tower within `r` metres of it. */
function roomAt(site: Site, x: number, z: number, r: number): boolean {
  for (const f of site.features ?? []) if (Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.15) + r) return false;
  for (const st of site.streams ?? []) for (let k = 0; k < st.course.length - 1; k++) {
    const [ax, az] = st.course[k], [bx, bz] = st.course[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < st.width / 2 + r) return false;
  }
  for (const t of site.towers ?? []) if (Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) < t.half + 2 + r) return false;
  return clearOfBuildings(site, x, z, r);
}

/** Whether a point is at least `r` metres from the ground of every building already in the valley. */
function clearOfBuildings(site: Site, x: number, z: number, r: number): boolean {
  // (Nothing else goes on or before the promontory a keep stands on, nor on the way up to it.)
  for (const t of site.terraces ?? []) if (t.keep && site.valley) {
    const inside = (x - edgeAt(site.valley, t.side, z)) * (t.side === 'w' ? 1 : -1);
    const zA = t.z0 - (t.rise === 'n' ? t.run : 0) - 4 - r, zB = t.z1 + (t.rise === 's' ? t.run : 0) + 4 + r;
    if (z > zA && z < zB && inside < 4.7 + t.depth + 5 + r) return false;
  }
  for (const b of site.buildings ?? []) {
    const turn = b.faces === 'w' ? 1 : -1, u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
    for (const q of footprintOf(b)) if (u > q.u0 - r && u < q.u1 + r && v > q.v0 - r - (b.style === 'imperial' ? 2 : 0.6) && v < q.v1 + r) return false;
  }
  return true;
}

/**
 * Buildings by the track, in about three valleys in five: either a few timber-framed houses in a
 * row with their fronts to the track, as a hamlet has them, or one stuccoed building of the
 * classical kind standing back from it. They go where there is room, and face the track.
 */
function layOutBuildings(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng, hamlet: boolean): void {
  const g = site.grounds!, track = site.track ?? [];
  if (track.length < 2) return;
  rng.next();
  const round = (v: number) => Math.round(v * 10) / 10;
  // Where the track is, across the valley, at a place along it.
  const trackX = (z: number): number => {
    let k = 0;
    while (k < track.length - 2 && z > track[k + 1][1]) k++;
    const t = Math.min(1, Math.max(0, (z - track[k][1]) / ((track[k + 1][1] - track[k][1]) || 1)));
    return track[k][0] + (track[k + 1][0] - track[k][0]) * t;
  };
  // A building fits if its ground is inside the valley, clear of what lies there, and off the track.
  const fits = (b: { x: number; z: number; w: number; d: number }): boolean => {
    if (b.z - b.w / 2 < meadow.z1 + 10 || ![[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([du, dv]) => walkable(site.valley!, b.x + (du * b.d) / 2, b.z + (dv * b.w) / 2, 14))) return false;
    for (const [du, dv] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
      const x = b.x + (du * b.d) / 2, z = b.z + (dv * b.w) / 2;
      if (!roomAt(site, x, z, 4) || fromTrack(x, z) < 3.2) return false;
    }
    return true;
  };
  const side = rng.chance(0.5) ? 1 : -1;
  const out: Building[] = [];
  rng.next();
  if (hamlet) {
    // A hamlet: two to four houses, no two alike, a step or two apart.
    const washes: [number, number, number][] = [[0.86, 0.8, 0.66], [0.82, 0.62, 0.3], [0.78, 0.5, 0.44], [0.55, 0.66, 0.74], [0.6, 0.68, 0.5], [0.88, 0.87, 0.82], [0.74, 0.36, 0.26]];
    // (A row is tried in several places, and each house at several distances from the track; the fullest row found is kept.)
    for (let tries = 0; tries < 24 && out.length < 2; tries++) {
      let z = rng.range(meadow.z1 + 12, g.z1 - 44);
      const row: Building[] = [], wanted = rng.int(2, 4), from = rng.int(0, washes.length - 1), near = tries % 2 ? side : -side;
      for (let k = 0; k < wanted; k++) {
        const w = round(rng.range(6, 8.6)), d = round(rng.range(6.2, 7.8)), storeys = rng.chance(0.4) ? 3 : 2, jetty = round(rng.range(0.3, 0.45)), gable = rng.chance(0.6);
        // (How high each storey is: a tall ground storey more often than not, and lower rooms the higher they are.)
        const tall = rng.fork(`heights${tries}.${k}`), heights = [round(tall.range(2.6, 3.3)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.35, 2.9) - n * 0.1))];
        for (let step = 0; step < 5; step++) {
          const b: Building = {
            style: 'timber', x: round(trackX(z + w / 2) + near * (4.6 + step * 1.3 + d / 2)), z: round(z + w / 2), w, d, faces: near > 0 ? 'w' : 'e', storeys, heights, bays: w > 7.4 ? 3 : 2,
            colour: washes[(from + k * 2) % washes.length], jetty, gable,
          };
          if (fits(b)) { row.push(b); break; }
        }
        z += w + rng.range(1.2, 3.6);
      }
      if (row.length > out.length) out.splice(0, out.length, ...row);
    }
  } else {
    const washes: [number, number, number][] = [[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78], [0.88, 0.84, 0.72]];
    // From a pavilion of one storey to a block of five; most have two or three.
    const storeys = rng.pick([1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5]), colour = rng.pick(washes);
    // (Its storeys: the ground storey, the tall principal one, and lower ones over that. One storey alone is a tall one.)
    const tall = rng.fork('heights');
    const heights = storeys === 1 ? [round(tall.range(3.9, 4.6))] : [round(tall.range(3.4, 4.2)), round(tall.range(3.8, 4.8)), ...Array.from({ length: storeys - 2 }, (_, n) => round(tall.range(2.9, 3.4) - n * 0.1))];
    // From three windows across to thirteen. The broadest are tried first, and narrower ones as room proves hard to find.
    const widest = rng.pick([5, 7, 7, 9, 9, 11, 13]);
    for (let tries = 0; tries < 280 && !out.length; tries++) {
      const bays = Math.max(3, widest - 2 * Math.floor(tries / 50)), w = round(bays * 2.55 + 1.6), d = round(rng.range(9.4, 11.5)), z = rng.range(meadow.z1 + 11 + w / 2, g.z1 - 17 - w / 2), off = rng.range(7.5, tries % 50 < 25 ? 14 : 22);
      const near = tries % 2 ? side : -side;
      const b: Building = { style: 'imperial', x: round(trackX(z) + near * (off + d / 2)), z: round(z), w, d, faces: near > 0 ? 'w' : 'e', storeys, heights, bays, colour, portico: bays >= 7 || (bays === 5 && tries % 3 === 0) };
      if (fits(b)) out.push(b);
    }
    // Whether all of a building's ground, wings and all, is clear of the track and of whatever lies in the valley.
    const clearAll = (b: Building): boolean => {
      const turn = b.faces === 'w' ? 1 : -1;
      for (const r of footprintOf(b)) for (const [u, v] of [[r.u0, r.v0], [r.u1, r.v0], [r.u0, r.v1], [r.u1, r.v1], [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2]]) {
        const x = b.x - (turn * b.d) / 2 + turn * v, z = b.z + turn * u;
        if (!walkable(site.valley!, x, z, 12) || z < meadow.z1 + 8 || !roomAt(site, x, z, 3.5) || fromTrack(x, z) < 3.2) return false;
      }
      return true;
    };
    for (const b of out) {
      // A broad one now and then has wings reaching back from its ends about a court: one, making an L, or two, making a U.
      const winged = rng.fork('wings');
      if (b.bays >= 7 && winged.chance(0.7)) {
        // (Narrower than the part of the front beside its middle, so that the wing's rooms open off the main block's end rooms.)
        const width = round(winged.range(5.4, Math.min(8.8, b.w / 2 - 4))), both = winged.chance(0.5), one: -1 | 1 = winged.chance(0.5) ? -1 : 1;
        // (If there is no room for it as wished, it is tried shorter, and then as an L.)
        for (const [length, sides] of [[round(winged.range(8, 14)), both ? [-1, 1] : [one]], [7, both ? [-1, 1] : [one]], [7, [one]], [7, [-one]]] as [number, (-1 | 1)[]][]) {
          b.wings = sides.map((side) => ({ side, width, length }));
          if (clearAll(b)) break;
          delete b.wings;
        }
      }
      // (Its variations: storeys of other heights, a middle without its pediment, towers at the corners of an L or a U. From a
      // stream of their own, and before anything that reads its storeys' heights.)
      classicalVariations(b, rng.fork('variations'));
      // How it is dressed, from a stream of its own (`dealDress`): on level ground, at its plinth. Columns and pavilions that would
      // stand where the track or anything else is are left off, and if even then it would not fit, it is dressed as before.
      dealDress(b, rng.fork('dress'), { columns: true });
      if (b.dress && !clearAll(b)) { b.dress.order = 'pilasters'; if (!clearAll(b)) b.dress.pavilions = 0; if (!clearAll(b)) delete b.dress; }
      // About two in five of the taller ones are set into rising ground: the lowest storey open to the front and buried at the back.
      const cut = rng.fork('sunk');
      if (b.storeys >= 3 && cut.chance(0.45)) {
        b.sunk = round(floorOf(b, 1) - 0.2);
        b.backDoor = round(classicalFront(b).windows[(b.bays >> 1) + (b.portico || b.bays >= 7 ? 2 : 1)]);
      }
      b.plan = planClassical(b, rng.fork('plan'));
    }
  }
  // About one hamlet in two was burnt, long enough ago that nobody has rebuilt it. (From a stream of its own.)
  if (hamlet && rng.fork('burnt').chance(0.5)) for (const b of out) b.burnt = true;
  // A timber house has its door to one side of its front, and is planned inside from that.
  for (const [k, b] of out.entries()) if (b.style === 'timber') {
    b.door = rng.fork(`door${k}`).pick([0.24, 0.76]);
    b.plan = planTimber(b);
  }
  if (out.length) site.buildings = out;
}

/**
 * A little town of brick, as on the Baltic coast: a street of houses along the track where the
 * valley is broadest, their fronts to it on a common line, wall against wall as town houses
 * stand, with a lane between now and then; most of them merchants' houses with their gables to
 * the street, some broader houses with their eaves to it, here and there a warehouse. Beside the
 * street, set back behind its yard, a church of brick, as large as there is room for. The church
 * is placed first, since it needs the most room, and the houses go where it is not. Returns false
 * if there was not room for at least four houses, and leaves nothing.
 */
function layOutTown(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): boolean {
  const v = site.valley!, track = site.track!, round = (x: number) => Math.round(x * 100) / 100;
  const trackX = (z: number): number => {
    let k = 0;
    while (k < track.length - 2 && z > track[k + 1][1]) k++;
    const t = Math.min(1, Math.max(0, (z - track[k][1]) / ((track[k + 1][1] - track[k][1]) || 1)));
    return track[k][0] + (track[k + 1][0] - track[k][0]) * t;
  };
  // Where the valley is broadest, in the stretch below the house and above the gap.
  const lo = meadow.z1 + 16, hi = v.mouth - 28;
  if (hi - lo < 34) return false;
  let mid = lo, best = -Infinity;
  for (let z = lo; z <= hi; z += 2) {
    const broad = edgeAt(v, 'e', z) - edgeAt(v, 'w', z) + rng.range(-4, 4);
    if (broad > best) { best = broad; mid = z; }
  }
  const length = rng.range(50, 72), z0 = Math.max(lo, mid - length / 2), z1 = Math.min(hi + 10, z0 + length);
  const out: Building[] = [], country = brickCountry(site.setting.stone);
  // The corners and middles of a building's ground, in the world.
  const corners = (b: Building, grow = 0) => footprintOf(b).flatMap((r) => {
    const turn = b.faces === 'w' ? 1 : -1, at = (u: number, w: number): [number, number] => [b.x - (turn * b.d) / 2 + turn * w, b.z + turn * u];
    return [at(r.u0 - grow, r.v0 - grow), at(r.u1 + grow, r.v0 - grow), at(r.u0 - grow, r.v1 + grow), at(r.u1 + grow, r.v1 + grow), at((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2), at(r.u0 - grow, (r.v0 + r.v1) / 2), at(r.u1 + grow, (r.v0 + r.v1) / 2)];
  });
  // Whether two buildings' grounds overlap, `gap` apart at least. (Houses of a street may touch; nothing may stand in another.)
  const apart = (p: Building, q: Building, gap: number) => footprintOf(p).every((a) => footprintOf(q).every((c) => {
    const ta = p.faces === 'w' ? 1 : -1, tc = q.faces === 'w' ? 1 : -1;
    const ax0 = Math.min(p.x - (ta * p.d) / 2 + ta * a.v0, p.x - (ta * p.d) / 2 + ta * a.v1), ax1 = Math.max(p.x - (ta * p.d) / 2 + ta * a.v0, p.x - (ta * p.d) / 2 + ta * a.v1);
    const az0 = Math.min(p.z + ta * a.u0, p.z + ta * a.u1), az1 = Math.max(p.z + ta * a.u0, p.z + ta * a.u1);
    const cx0 = Math.min(q.x - (tc * q.d) / 2 + tc * c.v0, q.x - (tc * q.d) / 2 + tc * c.v1), cx1 = Math.max(q.x - (tc * q.d) / 2 + tc * c.v0, q.x - (tc * q.d) / 2 + tc * c.v1);
    const cz0 = Math.min(q.z + tc * c.u0, q.z + tc * c.u1), cz1 = Math.max(q.z + tc * c.u0, q.z + tc * c.u1);
    return ax1 + gap <= cx0 || cx1 + gap <= ax0 || az1 + gap <= cz0 || cz1 + gap <= az0;
  }));
  // The church: beside the street at one end of it, behind a yard, where it closes the view along the street; the largest that fits.
  const chooser = rng.fork('church');
  for (const room of [48, 40, 33]) {
    const church = dealChurch(chooser.fork(`deal${room}`), room, country);
    if (!church) continue;
    let pick: Building | null = null, score = Infinity;
    for (const side of [-1, 1] as const) for (let z = z0 - 14; z <= z1 + 14; z += 2) for (const yard of [7, 10, 13]) {
      const x = trackX(z) + side * (yard + church.d / 2), b: Building = { ...church, x: round(x), z: round(z), faces: side > 0 ? 'w' : 'e' };
      if (!corners(b, 1.5).every(([cx, cz]) => walkable(v, cx, cz, 5) && roomAt(site, cx, cz, 2.5) && fromTrack(cx, cz) > 4.5)) continue;
      const along = footprintOf(b).flatMap((r) => [b.z + (b.faces === 'w' ? 1 : -1) * r.u0, b.z + (b.faces === 'w' ? 1 : -1) * r.u1]);
      const s = Math.min(Math.abs(Math.min(...along) - (z1 - 8)), Math.abs(Math.max(...along) - (z0 + 8))) + yard * 0.8 + chooser.range(0, 6);
      if (s < score) { score = s; pick = b; }
    }
    if (pick) { out.push(pick); break; }
  }
  // The houses: along both sides, wall against wall; a lane now and then; a house of each kind dealt in turn.
  let k = 0;
  for (const side of [-1, 1] as const) {
    for (let z = z0 + rng.range(0, 3); z < z1;) {
      const house = dealBrickHouse(rng.fork(`house${k}`), 13, undefined, country), line = 4.5 + rng.range(0, 0.35);
      let placed = false;
      // (Where the valley's side or something in it comes close, the house is tried shallower, as town lots are cut short.)
      for (let n = 0; n < 9 && !placed; n++) {
        const step = n % 3, d = [house.d, Math.min(house.d, 10.5), Math.min(house.d, 8.6)][Math.floor(n / 3)];
        const b: Building = { ...house, d, x: round(trackX(z + house.w / 2) + side * (line + step * 0.9 + d / 2)), z: round(z + house.w / 2), faces: side > 0 ? 'w' : 'e' };
        if (!corners(b).every(([cx, cz]) => walkable(v, cx, cz, 4) && roomAt(site, cx, cz, 0.6) && fromTrack(cx, cz) > 3.1)) continue;
        if (!out.every((q) => apart(b, q, q.brickwork?.kind === 'church' ? 3 : -0.01))) continue;
        out.push(b); placed = true; k++;
      }
      z += placed ? house.w + (rng.chance(0.18) ? rng.range(2.6, 4.5) : 0) : 1.5;
    }
  }
  if (out.filter((b) => b.brickwork?.kind !== 'church').length < 4) return false;
  site.buildings = out;
  return true;
}

/** A timber house of the valley's kind, its storeys and its look dealt from `rng`. */
function timberHouse(rng: Rng, colour: [number, number, number]): Omit<Building, 'x' | 'z' | 'faces'> {
  const round = (v: number) => Math.round(v * 10) / 10;
  const w = round(rng.range(6, 8.6)), d = round(rng.range(6.2, 7.8)), storeys = rng.chance(0.4) ? 3 : 2, jetty = round(rng.range(0.3, 0.45)), gable = rng.chance(0.6);
  const tall = rng.fork('heights'), heights = [round(tall.range(2.6, 3.3)), ...Array.from({ length: storeys - 1 }, (_, n) => round(tall.range(2.35, 2.9) - n * 0.1))];
  return { style: 'timber', w, d, storeys, heights, bays: w > 7.4 ? 3 : 2, colour, jetty, gable };
}

/**
 * A village: houses along both sides of the track where the valley is broadest, their fronts to
 * the track, close together as houses in a street are, with a lane between them here and there;
 * and above it, on the hillside beyond the valley's side, its keep. Returns false if there was
 * not room for at least four houses, and leaves nothing.
 */
function layOutVillage(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): boolean {
  const v = site.valley!, track = site.track!, round = (x: number) => Math.round(x * 10) / 10;
  const trackX = (z: number): number => {
    let k = 0;
    while (k < track.length - 2 && z > track[k + 1][1]) k++;
    const t = Math.min(1, Math.max(0, (z - track[k][1]) / ((track[k + 1][1] - track[k][1]) || 1)));
    return track[k][0] + (track[k + 1][0] - track[k][0]) * t;
  };
  // Where the valley is broadest, in the stretch below the house and above the gap.
  const lo = meadow.z1 + 18, hi = v.mouth - 30;
  if (hi - lo < 30) return false;
  let mid = lo, best = -Infinity;
  for (let z = lo; z <= hi; z += 2) {
    const broad = edgeAt(v, 'e', z) - edgeAt(v, 'w', z) + rng.range(-4, 4);
    if (broad > best) { best = broad; mid = z; }
  }
  const length = rng.range(38, 58), z0 = Math.max(lo, mid - length / 2), z1 = Math.min(hi + 10, z0 + length);
  const washes: [number, number, number][] = [[0.86, 0.8, 0.66], [0.82, 0.62, 0.3], [0.78, 0.5, 0.44], [0.55, 0.66, 0.74], [0.6, 0.68, 0.5], [0.88, 0.87, 0.82], [0.74, 0.36, 0.26]];
  const out: Building[] = [];
  const fits = (b: Building): boolean => {
    for (const [du, dv] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const x = b.x + (du * b.d) / 2, z = b.z + (dv * b.w) / 2;
      if (!walkable(v, x, z, 5) || fromTrack(x, z) < 3.2 || !roomAt(site, x, z, 0.8)) return false;
    }
    return !out.some((q) => Math.abs(q.z - b.z) < (q.w + b.w) / 2 + 0.6 && Math.abs(q.x - b.x) < (q.d + b.d) / 2 + 0.6);
  };
  let k = 0;
  for (const side of [-1, 1] as const) {
    for (let z = z0 + rng.range(0, 4); z < z1;) {
      const house = timberHouse(rng.fork(`house${k}`), washes[(k * 3 + 1) % washes.length]);
      let placed = false;
      for (let step = 0; step < 4 && !placed; step++) {
        const b: Building = { ...house, x: round(trackX(z + house.w / 2) + side * (4.1 + step * 1.1 + house.d / 2)), z: round(z + house.w / 2), faces: side > 0 ? 'w' : 'e' };
        if (fits(b)) { out.push(b); placed = true; k++; }
      }
      // (Next door: close by, or across a lane.)
      z += house.w + (rng.chance(0.25) ? rng.range(3.5, 6) : rng.range(0.6, 2.2));
      if (!placed) z += 2;
    }
  }
  if (out.length < 4) return false;
  // The inn is the house nearest the middle of the village, which is the first of them.
  out.sort((p, q) => Math.abs(p.z - mid) - Math.abs(q.z - mid));
  for (const [n, b] of out.entries()) { b.door = rng.fork(`door${n}`).pick([0.24, 0.76]); b.plan = planTimber(b); }
  site.buildings = out;
  // The keep: on a promontory over the village, a high shelf standing out from one side of the valley, sheer to the valley floor,
  // with a ledge climbing along the side wall to its end; and the castle's gate faces that end. It is put where it fits nearest the village's middle.
  // (A castle wants a broad promontory; where none fits, the keep is a tower alone on a smaller one.)
  const wanted = rng.chance(0.6) ? 'castle' as const : 'tower' as const, height = round(rng.range(7, 10)), run = round(height / 0.34 + 1.5);
  let kind: 'castle' | 'tower' = wanted;
  const places: { t: Terrace; score: number }[] = [];
  for (const tryKind of wanted === 'castle' ? ['castle', 'tower'] as const : ['tower'] as const) {
    kind = tryKind;
    const depth = kind === 'castle' ? 23 : 12, shelfLength = kind === 'castle' ? 28 : 14;
    for (const side of ['w', 'e'] as const) for (const rise of ['n', 's'] as const) for (let start = meadow.z1 + 10; start <= v.mouth - 26 - shelfLength - run; start += 2) {
      const z0 = round(rise === 'n' ? start + run : start), z1 = round(z0 + shelfLength), inward = side === 'w' ? 1 : -1;
      let free = true;
      for (let z = start - 2; z <= start + shelfLength + run + 2 && free; z += 1.5) {
        if (Math.abs(slantAt(v, side, z)) > 0.9 || edgeAt(v, 'e', z) - edgeAt(v, 'w', z) < depth + 18) free = false;
        for (let out = 3; out <= 4.7 + depth + 2 && free; out += 1.5) {
          const x = edgeAt(v, side, z) + inward * out;
          if (fromTrack(x, z) < 2.5 || !clearOfBuildings(site, x, z, 1.5)) free = false;
        }
      }
      if (free) places.push({ t: { side, z0, z1, depth, height, rise, run, way: 'ledge', keep: true }, score: Math.abs((z0 + z1) / 2 - mid) + rng.range(0, 8) });
    }
    if (places.length) break;
  }
  if (places.length) {
    const t = places.sort((p, q) => p.score - q.score)[0].t, inward = t.side === 'w' ? 1 : -1, zc = round((t.z0 + t.z1) / 2), toward = t.rise === 'n' ? -1 : 1;
    site.terraces = [t];
    const cx = round(edgeAt(v, t.side, zc) + inward * (4.7 + t.depth * 0.5));
    site.keep = { x: cx, z: zc, kind };
    // The tower: alone in the middle of the shelf, or at the back of the castle's court, away from the gate. Its door faces the valley.
    const tz = round(zc - toward * (kind === 'castle' ? 5.5 : 0));
    site.towers = [{ x: cx, z: tz, half: 3.1, storeys: 4 + rng.fork('keeptall').int(0, 3), door: t.side === 'w' ? 'e' : 'w' }];
    // The footpath: from the track, by the clearest line, to the foot of the ledge; up it; along the shelf to the gate; and to the tower's door.
    const wayX = (z: number) => round(edgeAt(v, t.side, z) + inward * (4.7 + 1.45));
    const footZ = round(t.rise === 'n' ? t.z0 - t.run - 1 : t.z1 + t.run + 1), topZ = t.rise === 'n' ? t.z0 + 1 : t.z1 - 1;
    const clearLine = (tx: number, tz2: number) => {
      const fx = wayX(footZ), len = Math.hypot(fx - tx, footZ - tz2);
      for (let q = 2; q < len - 1; q += 1) if (!roomAt(site, tx + ((fx - tx) * q) / len, tz2 + ((footZ - tz2) * q) / len, 0.9)) return false;
      return true;
    };
    const from = [...track].sort((p, q) => Math.hypot(p[0] - wayX(footZ), p[1] - footZ) - Math.hypot(q[0] - wayX(footZ), q[1] - footZ)).find(([tx, tz2]) => clearLine(tx, tz2));
    const gateZ = round(zc + toward * (kind === 'castle' ? 7.5 : 6.5));
    // (Across the end of the shelf to stand square before the gate, then in through it.)
    const pts: [number, number][] = [[wayX(footZ), footZ], [wayX((footZ + topZ) / 2), round((footZ + topZ) / 2)], [wayX(topZ), round(topZ)], [cx, round(topZ + toward * 0.5)], [cx, gateZ], [round(cx + inward * 5.4), gateZ], [round(cx + inward * 5.4), tz], [round(cx + inward * 3.9), tz]];
    if (from) pts.unshift([round(from[0]), round(from[1])]);
    (site.paths ??= []).push({ to: 'keep', points: pts });
  }
  return true;
}

/** A cave in the valley's wall, in about one valley in two: where no water rises or goes to ground. */
function layOutGrotto(site: Site, meadow: Place, rng: Rng): void {
  const g = site.grounds!, v = site.valley!;
  // Where the valley runs on past the house, a cave is likeliest up one of its arms, in the arm's outer wall: the way to it is the path past the house.
  const arms = armsOf(v), byArm = rng.fork('armcave'), arm = arms.length && byArm.chance(0.7) ? arms[byArm.int(0, arms.length - 1)] : null;
  if (!arm && !rng.chance(0.5)) return;
  for (let tries = 0; tries < 30; tries++) {
    const side = arm ? arm.side : rng.chance(0.5) ? 'w' : 'e', r = Math.round(rng.range(2.0, 2.5) * 10) / 10;
    const z = Math.round((arm ? byArm.range(arm.head + 9, arm.head + (v.ridge!.z - arm.head) * 0.6) : rng.range(meadow.z1 + 9, v.mouth - 24)) * 10) / 10;
    const edge = edgeAt(v, side, z);
    // (It goes straight in under the hill, so it is made where the side runs fairly straight down the valley.)
    if (Math.max(Math.abs(slantAt(v, side, z)), Math.abs(slantAt(v, side, z - 4)), Math.abs(slantAt(v, side, z + 4))) > 0.3) continue;
    // Springs, falls and sinks are all at the foot of the walls; a cave keeps away from them, and from any stream.
    if ((site.streams ?? []).some((st) => st.course.some(([x, cz]) => Math.abs(x - edge) < 16 && Math.abs(cz - z) < 9))) continue;
    if ((site.features ?? []).some((f) => Math.abs(f.x - edge) < f.r * 2.4 + 9 && Math.abs(f.z - z) < f.r * 2.4 + 4)) continue;
    site.grottoes = [{ side, z, r }];
    // Now and then it is not a cave at all, but a hall somebody cut under the hill: long, high and pillared.
    if (rng.chance(0.4)) {
      const round = (v: number) => Math.round(v * 10) / 10;
      site.grottoes[0].hall = { length: round(rng.range(22, 30)), width: round(rng.range(12, 15)), height: round(rng.range(9, 11)), drop: round(rng.range(5.1, 5.95)) };
      // And of those, about half are great: come upon from a ledge high in one end, with a chasm across the floor.
      const great = rng.fork('great');
      if (great.chance(0.5)) {
        const deep = round(great.range(11, 13)), width = round(great.range(24, 28)), across = 7.5;
        // (The stair from the ledge goes down at one in two and wants level floor at its foot before the chasm; beyond the chasm there is the dais.)
        const at = round(6 + deep * 2 + great.range(3.5, 5));
        site.grottoes[0].hall = {
          length: round(at + across + great.range(13, 16)), width, height: round(deep + great.range(10, 12)), drop: site.grottoes[0].hall.drop,
          great: { deep, gallery: great.chance(0.5) ? 'n' : 's', chasm: { at, width: across, depth: round(Math.min(10, width / 2 - 3.2)) } },
        };
      }
    }
    return;
  }
}

/**
 * Ground to climb to. Most valleys have a terrace against one of their side walls: a shelf some
 * metres up, with a way to it that rises along the wall. It goes where there is room: clear of
 * the track, of the water, and of whatever else is out there.
 */
function layOutHeights(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const features = site.features ?? [], streams = site.streams ?? [];
  const round = (v: number) => Math.round(v * 10) / 10;
  layOutGrotto(site, meadow, rng.fork('grotto'));
  // (A valley whose keep stands on a promontory has that for its height.)
  if (!rng.chance(0.7) || site.terraces?.length) return;
  const v = site.valley!, lo = meadow.z1 + 8, hi = v.mouth - 24;
  // What it is to be is dealt first; then every place along both sides is looked at, and one of
  // those it fits is taken. If it fits nowhere, a smaller one is tried.
  const want = { depth: round(rng.range(5.5, 8.5)), height: round(rng.range(3.4, 5.2)), length: round(rng.range(11, 19)), way: rng.chance(0.4) ? 'steps' as const : 'ledge' as const };
  for (const scale of [1, 0.8, 0.65]) {
    const depth = round(Math.max(5.2, want.depth * scale)), length = round(Math.max(10, want.length * scale)), height = want.height, way = want.way;
    // The way up is a ledge no steeper than a hill path, about one in three; or steps cut in the rock, at one in two.
    const run = round(height / (way === 'steps' ? 0.5 : 0.34) + 1.5);
    if (hi - lo < length + run) continue;
    const fits: Terrace[] = [];
    for (const side of ['w', 'e'] as const) for (const rise of ['n', 's'] as const) for (let start = lo; start <= hi - length - run; start += 2) {
      const z0 = round(rise === 'n' ? start + run : start), z1 = round(z0 + length), inward = side === 'w' ? 1 : -1;
      // Everything from the wall to a few paces in front of the shelf must be free; and the wall itself, of any cave in it.
      let free = !(site.grottoes ?? []).some((q) => q.side === side && q.z > start - 8 && q.z < start + length + run + 8);
      for (let z = start - 2; z <= start + length + run + 2 && free; z += 1.5) {
        // (The shelf follows the side of the valley, which must not swing far in or out along it, and must leave room across from it.)
        if (Math.abs(slantAt(v, side, z)) > 1.1 || edgeAt(v, 'e', z) - edgeAt(v, 'w', z) < depth + 18) free = false;
        for (let out = 3; out <= 4.7 + depth + 1.5 && free; out += 1.5) {
          const x = edgeAt(v, side, z) + inward * out;
          if (fromTrack(x, z) < 2.6 || !clearOfBuildings(site, x, z, 2.5)) free = false;
          for (const f of features) if (Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.15) + 2.5) free = false;
          for (const st of streams) for (let k = 0; k < st.course.length - 1 && free; k++) {
            const [ax, az] = st.course[k], [bx, bz] = st.course[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
            const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
            if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < st.width / 2 + 4) free = false;
          }
        }
      }
      if (free) fits.push({ side, z0, z1, depth, height, rise, run, way });
    }
    if (fits.length) {
      site.terraces = [rng.pick(fits)];
      // Half of them have a shrine at the lookout, which pilgrims climb to. (From a stream of its own.)
      if (rng.fork('shrine').chance(0.5)) site.terraces[0].shrine = true;
      return;
    }
  }
}

/**
 * Water in the valley. A pond is given a size, anything from a pool to a lake, and a shore that
 * swells where there is room and draws in from the track and from whatever else stands near. A
 * stream is led to it from a spring under the rock on its own side of the valley, and another
 * out of it to a sink at the foot of the rim; a valley with no pond may still have a stream
 * running down one side. Water keeps to one side of the track, so nothing has to be bridged.
 * All this is drawn from a stream of chance of its own, so that what was already in a valley is
 * where it was.
 */
function layOutWater(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const g = site.grounds!, v = site.valley!, features = site.features!, track = site.track!;
  const round = (v: number) => Math.round(v * 10) / 10;
  const trackX = (z: number): number => {
    for (let k = 0; k < track.length - 1; k++) {
      if (z <= track[k + 1][1] || k === track.length - 2) {
        const t = Math.min(1, Math.max(0, (z - track[k][1]) / (track[k + 1][1] - track[k][1])));
        return track[k][0] + (track[k + 1][0] - track[k][0]) * t;
      }
    }
    return track[0][0];
  };
  // Whether a point of ground is free for water: clear of the track, the meadow, the rim, and anything else out here.
  const free = (x: number, z: number, margin: number, but?: Feature): boolean => {
    if (fromTrack(x, z) < 3 + margin) return false;
    if (!walkable(v, x, z, 12 + margin) || z < meadow.z1 + 4 + margin || !clearOfBuildings(site, x, z, 3 + margin)) return false;
    return !features.some((f) => f !== but && Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.1) + 1.5 + margin);
  };

  // A valley that was given no pond may have a pool of its own.
  if (!features.some((f) => f.kind === 'pond') && rng.chance(0.45)) {
    for (let tries = 0; tries < 120; tries++) {
      const r = rng.range(4, 7), x = rng.range(g.x0 + 18, g.x1 - 18), z = rng.range(meadow.z1 + 10, g.z1 - 18);
      if (!free(x, z, r) || fromTrack(x, z) > r + 22) continue;
      features.push({ kind: 'pond', x: round(x), z: round(z), r: round(r) });
      break;
    }
  }
  const streams: Stream[] = [];
  const pond = features.find((f) => f.kind === 'pond');
  if (pond) {
    // Pool, pond or lake; and a shore of its own.
    const roll = rng.next();
    const want = pond.r * (roll < 0.22 ? rng.range(0.42, 0.65) : roll < 0.6 ? rng.range(0.8, 1.25) : rng.range(1.6, 2.7));
    const N = 20, long = rng.range(0, Math.PI), stretch = rng.range(0.08, 0.5), lobe = rng.range(0, Math.PI * 2), knots = rng.range(0, Math.PI * 2);
    let shore: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const wish = want * Math.min(1.7, Math.max(0.6, 1 + stretch * Math.cos(2 * (a - long)) + 0.16 * Math.cos(3 * (a - lobe)) + 0.09 * Math.cos(5 * a + knots)));
      // As far that way as the ground is free, and no further.
      let reach = 2.5;
      while (reach < wish && free(pond.x + dx * (reach + 0.5) * 1.12, pond.z + dz * (reach + 0.5) * 1.12, 0, pond)) reach += 0.5;
      shore.push(reach);
    }
    for (let pass = 0; pass < 2; pass++) shore = shore.map((v, k) => Math.min(v, 0.25 * shore[(k + N - 1) % N] + 0.5 * v + 0.25 * shore[(k + 1) % N] + 0.4));
    const r = shore.reduce((a, b) => a + b, 0) / N;
    pond.r = round(r);
    pond.shore = shore.map((v) => Math.round((v / pond.r) * 100) / 100);
    // A lake of any size may have an island: off-centre, where there is most water.
    if (pond.r >= 10.5 && rng.chance(0.65)) {
      // (Away from the track, which is the side the landing stage is built on.)
      const landward = Math.sign(trackX(pond.z) - pond.x) || 1;
      let k = 0;
      for (let q = 0; q < N; q++) if (Math.cos((q / N) * Math.PI * 2) * landward < 0.2 && (Math.cos((k / N) * Math.PI * 2) * landward >= 0.2 || shore[q] > shore[k])) k = q;
      const a = (k / N) * Math.PI * 2 + rng.range(-0.3, 0.3), out = shoreOf(pond, Math.cos(a), Math.sin(a)) * rng.range(0.28, 0.4);
      pond.isle = { x: round(pond.x + Math.cos(a) * out), z: round(pond.z + Math.sin(a) * out), r: round(rng.range(1.5, 2.8)) };
    }
  }
  // Which side of the track the water keeps to.
  const side = pond ? Math.sign(pond.x - trackX(pond.z)) || 1 : rng.chance(0.5) ? 1 : -1;
  // The foot of the rock on the water's side of the valley, at any place down it; and on the other side.
  const rimX = (z: number, on = side) => (on < 0 ? edgeAt(v, 'w', z) + 6.5 : edgeAt(v, 'e', z) - 6.5);
  const clear = (x: number, z: number, but?: Feature, on = side): boolean =>
    Math.sign(x - trackX(z)) === on && fromTrack(x, z) > 4 && z < v.mouth - 4 && insideOf(v, x, z) > 5.5 && z > meadow.z1 + 3 && clearOfBuildings(site, x, z, 2.5)
    && !features.some((f) => f !== but && Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 0.9) + 2);
  // A wandering line from one point to another over free ground, or nothing if there is no way.
  const route = (from: [number, number], to: [number, number], but?: Feature, on = side, q = rng): [number, number][] | null => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.round(length / 8));
    const px = -(to[1] - from[1]) / length, pz = (to[0] - from[0]) / length;
    const line: [number, number][] = [[round(from[0]), round(from[1])]];
    let drift = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n, bx = from[0] + (to[0] - from[0]) * t, bz = from[1] + (to[1] - from[1]) * t;
      drift = Math.max(-5, Math.min(5, drift + q.range(-3, 3))) * Math.sin(Math.PI * t);
      let ok = false;
      for (const d of [drift, drift * 0.4, 0, -drift * 0.5, 3, -3, 6, -6]) {
        if (!clear(bx + px * d, bz + pz * d, but, on)) continue;
        line.push([round(bx + px * d), round(bz + pz * d)]);
        ok = true;
        break;
      }
      if (!ok) return null;
    }
    line.push([round(to[0]), round(to[1])]);
    return line;
  };
  const width = round(rng.chance(0.3) ? rng.range(2.4, 3.8) : rng.range(1.0, 1.9));
  // Where water goes to ground at the foot of the valley: under the rock on whichever side of the track it is, a little above the gap.
  const south = (x: number): [number, number] => { const z = v.mouth - 15; return [rimX(z, x < trackX(z) ? -1 : 1), z]; };
  /**
   * Water that crosses the track. Most keeps to its own side; some runs down to the track, over
   * it, and away to a sink on the far side, and then the track has to get across: by stepping
   * stones if it is a brook, by a bridge if it is a river. All of this is drawn from a stream
   * of its own, so that a valley whose water does not cross is laid out as it always was.
   */
  // (Not in a valley found in worn land, whose water and track both follow the line it drains by: crossing there, a stream ran a long
  // way down the track itself, the bridge found no bank to land on, and whoever walked the track went under its deck along the bed.)
  const crossing = rng.fork('crossing'), crosses = crossing.chance(0.4) && !v.terrain;
  const over = (start: (towards: [number, number]) => [number, number], wide: number, but?: Feature): Stream | null => {
    for (let tries = 0; tries < 6; tries++) {
      const zc = crossing.range(meadow.z1 + 12, v.mouth - 26), xc = trackX(zc);
      // It comes to the track a little upstream of where it leaves it, so it crosses at a slant, as water does.
      const near: [number, number] = [xc + side * 7, zc - 1.5], far: [number, number] = [xc - side * 7, zc + 1.5];
      const from = start(near);
      if (from[1] > zc - 5) continue;
      const sinkZ = Math.min(v.mouth - 18, zc + crossing.range(8, 22));
      const sink: [number, number] = crossing.chance(0.55) ? south(xc - side * crossing.range(8, 24)) : [rimX(sinkZ, -side), sinkZ];
      if (Math.sign(sink[0] - trackX(sink[1])) !== -side) continue;
      const down = route(from, near, but, side, crossing), away = down && route(far, sink, but, -side, crossing);
      if (!down || !away) continue;
      return { course: [...down, [round(xc), round(zc)], ...away], width: wide, from: 'spring', to: 'sink', crossing: { x: round(xc), z: round(zc), by: wide >= 2.2 ? 'bridge' : 'ford' } };
    }
    return null;
  };
  if (pond) {
    const edge = (tx: number, tz: number): [number, number] => {
      const d = Math.hypot(tx - pond.x, tz - pond.z), ux = (tx - pond.x) / d, uz = (tz - pond.z) / d, r = shoreOf(pond, ux, uz) * 0.72;
      return [pond.x + ux * r, pond.z + uz * r];
    };
    // In: from a spring under the rim on this side, somewhere up the valley from the pond.
    if (rng.chance(0.85)) {
      for (let tries = 0; tries < 6; tries++) {
        const springZ = Math.min(v.mouth - 20, Math.max(meadow.z1 + 5, pond.z + rng.range(-26, 4)));
        const spring: [number, number] = [rimX(springZ), springZ];
        const line = route(spring, edge(spring[0], spring[1]), pond);
        if (line && line.length >= 2) { streams.push({ course: line, width, from: 'spring', to: 'pond' }); break; }
      }
    }
    // Out: down the valley to a sink under the southern rim, or under the side rim further down.
    if (rng.chance(streams.length ? 0.9 : 0.5)) {
      const across = crosses ? over((towards) => edge(towards[0], towards[1]), round(width + 0.2), pond) : null;
      if (across) streams.push({ ...across, from: 'pond' });
      else for (let tries = 0; tries < 6; tries++) {
        const sinkZ = Math.min(v.mouth - 18, pond.z + rng.range(14, 30));
        const sink: [number, number] = rng.chance(0.6) || pond.z > v.mouth - 38 ? south(pond.x + side * rng.range(0, 12) + rng.range(-5, 5)) : [rimX(sinkZ), sinkZ];
        if (Math.sign(sink[0] - trackX(sink[1])) !== side) continue;
        const line = route(edge(sink[0], sink[1]), sink, pond);
        if (line && line.length >= 2) { streams.push({ course: line, width: round(width + 0.2), from: 'pond', to: 'sink' }); break; }
      }
    }
  } else if (rng.chance(0.55)) {
    // No pond: a stream down one side of the valley, from a spring to a sink.
    const across = crosses ? over(() => { const z = crossing.range(meadow.z1 + 6, (meadow.z1 + v.mouth) / 2); return [rimX(z), z]; }, width) : null;
    if (across) streams.push(across);
    else for (let tries = 0; tries < 8; tries++) {
      const springZ = rng.range(meadow.z1 + 6, (meadow.z1 + v.mouth) / 2);
      const spring: [number, number] = [rimX(springZ), springZ];
      const sink = south(spring[0]);
      if (Math.sign(sink[0] - trackX(sink[1])) !== side) continue;
      const line = route(spring, sink);
      if (line && line.length >= 3) { streams.push({ course: line, width, from: 'spring', to: 'sink' }); break; }
    }
  }
  // Water that has come down the valley to its foot does not go to ground there, as a rule: it goes out by the gap, beside the
  // track, and on into the country beyond. (Where it reaches the foot of the valley on the track's side, it crosses nothing more.)
  for (const st of streams) {
    const [lx, lz] = st.course[st.course.length - 1];
    if (st.to !== 'sink' || lz < v.mouth - 16) continue;
    const on = Math.sign(lx - trackX(lz)) || 1;
    // (Through the gap, a few strides to the side of its middle; beyond it, straight on as it went through, wandering a little.)
    const beside = (z: number): [number, number] => {
      const at = Math.min(z, v.mouth + 2), w = edgeAt(v, 'w', at), e = edgeAt(v, 'e', at), mid = (w + e) / 2;
      return [round(mid + on * Math.max(3.2, (e - w) / 2 - 4.4) + (z > v.mouth + 2 ? on * Math.sin(z * 0.11) * 1.5 : 0)), round(z)];
    };
    // (Not where the land rises to the gap, as a valley found in the land may: water cannot run uphill, and its bed, which may never
    // rise, was cut a gully twelve metres deep through the gap, where the track ends and whoever comes in arrives. It goes to ground.)
    if (v.terrain) {
      const at = (q: [number, number]) => valleyLand(v, meadow.floor, meadow, q[0], q[1]);
      const lowest = Math.min(...st.course.map((q) => at(q as [number, number])));
      if (Math.max(at(beside(v.mouth - 6)), at(beside(v.mouth + 2))) > lowest + 1.5) continue;
    }
    st.course.push(beside(v.mouth - 6), beside(v.mouth + 2), beside(v.mouth + 14), beside(v.mouth + 30), beside(v.mouth + 52));
    st.to = 'out';
  }
  // Some of the water that rises under the rim comes over it instead, as a fall: the bigger the stream the likelier.
  const falls = rng.fork('falls');
  for (const st of streams) if (st.from === 'spring' && falls.chance(st.width >= 2.2 ? 0.55 : 0.4)) st.from = 'fall';
  if (streams.length) site.streams = streams;
}

/** How much there is to a site: loops, gating, things to find, variety. Higher is better. */
export function score(site: Site, size = 9): number {
  const solution = solve(site);
  const rooms = site.places.filter((p) => p.roof !== 'sky').length - site.ways.filter((w) => w.natural).length;
  const dark = site.places.filter((p) => p.light === 'dark').length;
  const roofs = new Set(site.places.map((p) => p.roof));
  return Math.min(loopCount(site), 3)
    + 2.2 * Math.min(solution.moves.length / Math.max(1, solution.direct), 3)
    + 0.8 * site.items.length
    + (site.ways.some((w) => w.door?.barredFrom !== undefined) ? 1 : 0)
    + (site.levers.length ? 1.2 : 0)
    + (site.secret >= 0 ? 0.7 : 0)
    + (roofs.has('sky') && site.places.some((p) => p.role === 'court') ? 0.8 : 0)
    + (roofs.has('cave') ? 0.8 : 0)
    + 0.4 * Math.min(3, site.ways.filter((w) => w.natural).length)
    + (roofs.has('timber') && roofs.has('barrel') ? 0.5 : 0)
    + (dark >= 1 && dark <= 3 ? 1 : 0)
    - 0.5 * Math.abs(rooms - size);
}

function draftSite(seed: string, setting: Setting, rng: Rng, size = MAX_ROOMS, kind: PlaceKind = 'valley', opts: MakeOptions = {}): Site {
  const pick = rng.next();
  const draft = pick < 0.34 ? draftRing(rng) : pick < 0.58 ? draftDouble(rng) : pick < 0.8 ? draftStack(rng) : draftSpine(rng);
  const court = draft.court;
  const isCourt = (c: Cell) => !!court && same(c, court);

  // ---- column widths and row depths: mostly rooms, sometimes a passage
  const widths: number[] = [];
  const depths: number[] = [];
  for (let i = 0; i < NX; i++) widths.push(rng.chance(0.25) ? rng.range(3.0, 3.6) : rng.range(5.6, 7.6));
  for (let j = 0; j < NZ; j++) depths.push(rng.chance(0.2) ? rng.range(3.0, 3.6) : rng.range(5.6, 9.0));
  if (court) {
    widths[court.i] = rng.range(6.6, 8.2);
    depths[court.j] = rng.range(6.6, 8.6);
  }
  // Now and then a column or a row broader still, for a hall, or narrower, for a closet of a room; and the court sometimes a broad
  // garth. (With every room within a metre or two of every other the houses were all much alike.) From a stream of its own, so the
  // draft and every choice after it are what they were.
  const proportions = rng.fork('proportions');
  for (let i = 0; i < NX; i++) if (widths[i] > 5) widths[i] = proportions.chance(0.16) ? proportions.range(8.6, 10.8) : proportions.chance(0.12) ? proportions.range(4.4, 5.2) : widths[i];
  for (let j = 0; j < NZ; j++) if (depths[j] > 5) depths[j] = proportions.chance(0.16) ? proportions.range(9.4, 11.6) : proportions.chance(0.12) ? proportions.range(4.4, 5.2) : depths[j];
  if (court && proportions.chance(0.45)) {
    widths[court.i] = proportions.range(8.6, 11.8);
    depths[court.j] = proportions.range(8.6, 12.2);
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  const xs = [0];
  const zs = [0];
  for (const w of widths) xs.push(round(xs[xs.length - 1] + w + T));
  for (const d of depths) zs.push(round(zs[zs.length - 1] + d + T));

  const places: Place[] = [];
  const ways: Way[] = [];
  const byCell = new Map<string, number>();
  const inGrid = (c: Cell) => c.i >= 0 && c.i < NX && c.j >= 0 && c.j < NZ;
  const placeOf = (c: Cell) => places[byCell.get(key(c))!];

  const addCell = (c: Cell, role: Role, name: string, also?: Cell): Place => {
    const i0 = Math.min(c.i, also?.i ?? c.i), i1 = Math.max(c.i, also?.i ?? c.i), j0 = Math.min(c.j, also?.j ?? c.j), j1 = Math.max(c.j, also?.j ?? c.j);
    const p: Place = {
      id: places.length, role, name, roof: 'barrel', light: 'torch',
      x0: xs[i0] + T / 2, x1: xs[i1 + 1] - T / 2, z0: zs[j0] + T / 2, z1: zs[j1 + 1] - T / 2,
      floor: 0, wall: 3.4, axis: 'x', depth: 0,
    };
    places.push(p);
    byCell.set(key(c), p.id);
    if (also) byCell.set(key(also), p.id);
    return p;
  };

  /** The wall of `a` that faces cell `b`, for edge-adjacent cells. */
  const sideTowards = (a: Cell, b: Cell): Side => (b.j < a.j ? 'n' : b.j > a.j ? 's' : b.i > a.i ? 'e' : 'w');

  const connect = (a: Cell, b: Cell, kind: Way['kind'], halfWidth: number, offsets: number[] = [0]): void => {
    const pa = placeOf(a), pb = placeOf(b);
    const side = sideTowards(a, b);
    const along = side === 'n' || side === 's';
    const lo = along ? Math.max(pa.x0, pb.x0) : Math.max(pa.z0, pb.z0);
    const hi = along ? Math.min(pa.x1, pb.x1) : Math.min(pa.z1, pb.z1);
    const mid = (lo + hi) / 2;
    for (const o of offsets) ways.push({ a: pa.id, b: pb.id, side, kind, at: round(mid + o), halfWidth });
  };
  const DOOR = 0.85;
  const joined = (a: Cell, b: Cell) => ways.some((w) => (w.a === byCell.get(key(a)) && w.b === byCell.get(key(b))) || (w.b === byCell.get(key(a)) && w.a === byCell.get(key(b))));

  // ---- now and then two rooms of the draft side by side are one long hall (or, where they are narrow, one long gallery): the wall
  // between them is not built, and the way between them is not needed. Never the court or the gatehall. From a stream of its own.
  const halls = new Map<string, Cell>();
  {
    const q = rng.fork('halls'), want = q.chance(0.65) ? (q.chance(0.35) ? 2 : 1) : 0, taken = new Set<string>();
    for (const [a, b] of shuffle(draft.edges.filter(([a, b]) => !isCourt(a) && !isCourt(b) && !same(a, draft.entrance) && !same(b, draft.entrance)), q)) {
      if (halls.size >= want) break;
      if (taken.has(key(a)) || taken.has(key(b))) continue;
      const sideBySide = a.j === b.j, long = sideBySide ? widths[a.i] + widths[b.i] + T : depths[a.j] + depths[b.j] + T;
      if (long > 19.5) continue;
      halls.set(key(b), a);
      taken.add(key(a));
      taken.add(key(b));
    }
  }
  const joinedTo = (c: Cell) => [...halls.entries()].find(([, a]) => same(a, c))?.[0];

  // ---- the drafted rooms and the ways between them; a court is entered through open arches
  for (const c of draft.cells) {
    if (halls.has(key(c))) continue;
    const other = joinedTo(c), also = other ? draft.cells.find((d) => key(d) === other) : undefined;
    const p = addCell(c, isCourt(c) ? 'court' : 'passage', isCourt(c) ? 'cloister court' : 'gallery', also);
    if (isCourt(c)) p.roof = 'sky';
  }
  const archesFor = (a: Cell, b: Cell): number[] => {
    const pa = placeOf(a), pb = placeOf(b);
    const length = a.i === b.i ? Math.min(pa.x1, pb.x1) - Math.max(pa.x0, pb.x0) : Math.min(pa.z1, pb.z1) - Math.max(pa.z0, pb.z0);
    const count = Math.max(1, Math.floor((length - 0.6) / 3.1));
    return Array.from({ length: count }, (_, m) => (m - (count - 1) / 2) * 3.1);
  };
  for (const [a, b] of draft.edges) {
    if (placeOf(a) === placeOf(b)) continue;
    if (isCourt(a) || isCourt(b)) connect(a, b, 'arch', 1.15, archesFor(a, b));
    else connect(a, b, 'door', DOOR);
  }

  const around = (c: Cell): Cell[] => [{ i: c.i, j: c.j - 1 }, { i: c.i + 1, j: c.j }, { i: c.i - 1, j: c.j }, { i: c.i, j: c.j + 1 }];
  const free = (c: Cell) => inGrid(c) && !byCell.has(key(c));
  // A cave counts as one room however many chambers it runs to.
  const rooms = () => places.filter((p) => p.roof !== 'sky' && p.name !== 'hidden chamber').length - ways.filter((w) => w.natural).length;

  // ---- entrance, and the room farthest from it
  const entrance = placeOf(draft.entrance);
  entrance.role = 'entrance';
  entrance.name = 'gatehall';
  const hops = (from: number): Map<number, number> => {
    const dist = new Map<number, number>([[from, 0]]);
    const queue = [from];
    while (queue.length) {
      const id = queue.shift()!;
      for (const w of ways) {
        if (w.kind === 'window' || (w.a !== id && w.b !== id)) continue;
        const n = w.a === id ? w.b : w.a;
        if (!dist.has(n)) { dist.set(n, dist.get(id)! + 1); queue.push(n); }
      }
    }
    return dist;
  };
  const fromEntrance = hops(entrance.id);
  // Farthest first; among the farthest few, prefer one with spare ground beside it for the sanctum.
  const ranked = draft.cells.filter((c) => !isCourt(c) && !same(c, draft.entrance))
    .map((c) => ({ c, d: fromEntrance.get(placeOf(c).id)!, tie: rng.next() }))
    .sort((a, b) => b.d - a.d || a.tie - b.tie).map((x) => x.c);
  // (And among those, one with room beside it at least four and a half metres across: a sanctum a passage's width was a corridor.)
  const broad = (c: Cell) => (Math.min(widths[c.i], depths[c.j]) >= 4.4 ? 1 : 0);
  const farCell = ranked.find((c, k) => k < 3 && around(c).some((n) => free(n) && broad(n))) ?? ranked.find((c, k) => k < 3 && around(c).some(free)) ?? ranked[0];
  const far = placeOf(farCell);

  let goal = far;
  // Of the free cells beside it, the sanctum takes the largest; and one a passage's width across only if there is no other.
  const sanctumCell = around(farCell).filter(free).sort((a, b) => broad(b) - broad(a) || widths[b.i] * depths[b.j] - widths[a.i] * depths[a.j])[0];
  if (sanctumCell) {
    goal = addCell(sanctumCell, 'goal', 'sanctum');
    connect(farCell, sanctumCell, 'door', DOOR);
  } else {
    far.role = 'goal';
    far.name = 'sanctum';
  }

  // ---- side chambers, some of them two deep, and now and then a door between neighbours
  const chambers: Cell[] = [];
  const hosts = shuffle(draft.cells.filter((c) => !isCourt(c) && !same(c, draft.entrance) && !same(c, farCell)), rng);
  for (const host of hosts) {
    if (chambers.length >= 4 || rooms() >= size) break;
    const spot = shuffle(around(host).filter(free), rng)[0];
    if (!spot || !rng.chance(0.55)) continue;
    addCell(spot, 'reward', rng.pick(['cell', 'store', 'vestry', 'scriptorium']));
    connect(host, spot, 'door', DOOR);
    for (const other of chambers) {
      const adjacent = Math.abs(other.i - spot.i) + Math.abs(other.j - spot.j) === 1;
      if (adjacent && !joined(other, spot) && rng.chance(0.4)) connect(other, spot, 'door', DOOR);
    }
    chambers.push(spot);
    // A second chamber beyond the first: somewhere properly out of the way.
    const beyond = shuffle(around(spot).filter(free), rng)[0];
    if (beyond && rooms() < size && rng.chance(0.3)) {
      placeOf(spot).name = 'antechamber';
      placeOf(spot).role = 'passage';
      addCell(beyond, 'reward', rng.pick(['strongroom', 'reliquary', 'oubliette']));
      connect(spot, beyond, 'door', DOOR);
      chambers.push(beyond);
    }
  }

  // ---- a secret: a chamber behind a stretch of wall that is really a door. Nothing depends on
  // finding it; it is there for whoever looks closely.
  let secretId = -1;
  if (rng.chance(0.5)) {
    const hostsForSecret = shuffle(places.filter((p) => p.roof !== 'sky' && p.role !== 'entrance' && p.role !== 'goal'), rng);
    for (const host of hostsForSecret) {
      const cell = [...byCell.entries()].find(([, id]) => id === host.id)![0].split(',').map(Number);
      const spot = shuffle(around({ i: cell[0], j: cell[1] }).filter(free), rng)[0];
      if (!spot) continue;
      const hidden = addCell(spot, 'reward', 'hidden chamber');
      connect({ i: cell[0], j: cell[1] }, spot, 'door', DOOR);
      ways[ways.length - 1].door = { leaf: 'secret' };
      hidden.light = 'dark';
      secretId = hidden.id;
      break;
    }
  }

  // ---- windows from the court into the rooms that do not open onto it
  if (court) {
    const cp = placeOf(court);
    for (const n of around(court)) {
      if (!byCell.has(key(n)) || joined(court, n)) continue;
      const length = n.i === court.i ? cp.x1 - cp.x0 : cp.z1 - cp.z0;
      connect(court, n, 'window', 0.42, length > 6.4 && rng.chance(0.6) ? [-1.5, 1.5] : [0]);
    }
  }

  // ---- the forecourt, outside the south wall
  const ecx = round((entrance.x0 + entrance.x1) / 2);
  const forecourt: Place = {
    id: places.length, role: 'approach', name: 'meadow', roof: 'sky', light: 'day',
    x0: Math.min(ecx - 7, Math.min(...places.map((p) => p.x0)) - 3), x1: Math.max(ecx + 7, Math.max(...places.map((p) => p.x1)) + 3),
    z0: zs[NZ] + T / 2, z1: zs[NZ] + T / 2 + 17,
    floor: 0, wall: 3.9, axis: 'x', depth: 0,
  };
  places.push(forecourt);
  ways.push({ a: entrance.id, b: forecourt.id, side: 's', kind: 'door', at: ecx, halfWidth: 0.95 });

  // ---- some dead ends are not rooms at all: the builders broke into a cave and walled it off
  for (const p of places) {
    const doors = ways.filter((w) => w.kind !== 'window' && (w.a === p.id || w.b === p.id));
    const roomy = Math.min(p.x1 - p.x0, p.z1 - p.z0) >= 4.6;
    if (p.role === 'reward' && p.id !== secretId && doors.length === 1 && roomy && rng.chance(0.5)) {
      p.roof = 'cave';
      p.light = 'dark';
      p.wall = rng.range(3.3, 4.4);
      p.name = rng.pick(['cave', 'grotto', 'hollow']);
    }
  }

  // ---- a cave does not have to stop at one chamber. Where there is unused ground beside it, it
  // runs on: more chambers, joined by clefts in the rock, with light that belongs underground. One
  // chamber may have a shaft open to the sky; others have growths on the rock that glow. Between
  // them it is dark, so there is always something ahead to walk towards.
  const cellOf = (id: number): Cell => {
    for (const [k, v] of byCell) if (v === id) { const [i, j] = k.split(',').map(Number); return { i, j }; }
    throw new Error('place without a cell');
  };
  for (const first of places.filter((p) => p.roof === 'cave')) {
    if (!rng.chance(0.85)) continue;
    const chain = [first];
    const cells = [cellOf(first.id)];
    const steps = [0];   // how many clefts each chamber lies beyond the first
    const want = rng.int(1, 3);
    for (let k = 0; k < want; k++) {
      // Grow from the far end, or now and then from an earlier chamber, which makes a fork.
      const from = k > 0 && rng.chance(0.25) ? rng.int(0, cells.length - 1) : cells.length - 1;
      const spots = shuffle(around(cells[from]).filter(free), rng);
      if (!spots.length) continue;
      const q = addCell(spots[0], 'reward', rng.pick(['cavern', 'rift', 'gallery of rock', 'chamber']));
      q.roof = 'cave';
      q.light = 'dark';
      q.wall = rng.range(3.4, 6.4);
      connect(cells[from], spots[0], 'arch', round(rng.range(0.9, 1.35)));
      ways[ways.length - 1].natural = true;
      chain.push(q);
      cells.push(spots[0]);
      steps.push(steps[from] + 1);
    }
    if (chain.length === 1) continue;
    // Only chambers that lead nowhere further are rewards; the rest are the way to them.
    for (const c of chain) {
      const leads = ways.filter((w) => w.kind !== 'window' && (w.a === c.id || w.b === c.id)).length;
      c.role = leads > 1 ? 'passage' : 'reward';
    }
    // Light, chamber by chamber from the first, which stays as dark as it was found.
    let shaftGiven = false;
    chain.forEach((c, k) => {
      if (steps[k] % 2 === 0) return;
      const roomy = Math.min(c.x1 - c.x0, c.z1 - c.z0) >= 5;
      if (!shaftGiven && roomy && rng.chance(0.6)) {
        shaftGiven = true;
        c.light = 'day';
        // Wide enough for daylight to reach the floor through the thickness of the hill.
        c.shaft = { x: round((c.x0 + c.x1) / 2 + rng.range(-0.6, 0.6)), z: round((c.z0 + c.z1) / 2 + rng.range(-0.6, 0.6)), r: round(rng.range(1.7, 2.3)) };
        c.wall = Math.max(c.wall, 5.4);
      } else c.light = 'glow';
    });
  }

  // ---- not every room fills its cell of the plan. Where a wall of a room looks out on nothing (no room beyond it, and no door, arch
  // or window in it), it may stand in from the line of the plan: so rooms are of sizes of their own, and the outline of a house that
  // stands free steps in and out. Never the front, which stands in a line to the forecourt; never so far that a doorway in a wall
  // either side of it would no longer fit; and never a room cut down below four metres and a half. From a stream of its own.
  {
    const q = rng.fork('insets');
    const opposite = { n: 's', s: 'n', e: 'w', w: 'e' } as const;
    for (const p of places) {
      if (p.roof === 'sky' || p.roof === 'cave' || p.role === 'approach') continue;
      const cells = [...byCell.entries()].filter(([, id]) => id === p.id).map(([k]) => { const [i, j] = k.split(',').map(Number); return { i, j }; });
      const mine = ways.filter((w) => w.a === p.id || w.b === p.id).map((w) => ({ side: w.a === p.id ? w.side : opposite[w.side], at: w.at, half: w.halfWidth }));
      for (const side of shuffle(['n', 'e', 'w'] as Side[], q)) {
        if (!q.chance(0.45)) continue;
        const di = side === 'e' ? 1 : side === 'w' ? -1 : 0, dj = side === 'n' ? -1 : 0;
        if (cells.some((c) => { const n = byCell.get(key({ i: c.i + di, j: c.j + dj })); return n !== undefined && n !== p.id; })) continue;
        if (mine.some((w) => w.side === side)) continue;
        const across = side === 'n' ? p.z1 - p.z0 : p.x1 - p.x0;
        if (across < 5) continue;
        let d = q.range(0.5, Math.min(2.2, across - 4.5));
        // (The doorways in the two walls either side keep their jambs and half a metre more.)
        for (const w of mine) {
          if (side === 'n' && (w.side === 'e' || w.side === 'w')) d = Math.min(d, w.at - w.half - 0.6 - p.z0);
          if (side === 'w' && (w.side === 'n' || w.side === 's')) d = Math.min(d, w.at - w.half - 0.6 - p.x0);
          if (side === 'e' && (w.side === 'n' || w.side === 's')) d = Math.min(d, p.x1 - (w.at + w.half + 0.6));
        }
        d = Math.floor(d * 10) / 10;
        if (d < 0.4) continue;
        if (side === 'n') p.z0 = round(p.z0 + d); else if (side === 'w') p.x0 = round(p.x0 + d); else p.x1 = round(p.x1 - d);
      }
    }
  }

  // ---- roofs
  for (const p of places) {
    if (p.roof === 'sky' || p.roof === 'cave') continue;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    p.axis = Math.abs(dx - dz) < 0.8 ? rng.pick(['x', 'z'] as const) : dx > dz ? 'x' : 'z';
    const roomy = Math.min(dx, dz) >= 5.6;
    const roof: Roof = roomy && p.role !== 'goal' && rng.chance(0.3) ? 'timber' : 'barrel';
    p.roof = roof;
    // (A long hall stands taller than a chamber: its walls rise with its length, up to a metre and more under a timber roof.)
    const long = Math.max(dx, dz);
    p.wall = round(roof === 'timber' ? 4.2 + Math.min(1.4, Math.max(0, (long - 8) * 0.15)) : 3.4 + Math.min(0.7, Math.max(0, (long - 9) * 0.09)));
    if (Math.min(dx, dz) < 4 && p.name === 'gallery') p.name = 'passage';
  }

  // ---- what each room was for. The big ones get the communal uses, one of each at most.
  const communal = shuffle(['refectory', 'dormitory', 'chapter house'], rng);
  const working = shuffle(['kitchen', 'store', 'workshop', 'scriptorium', 'dormitory'], rng);
  for (const p of places) {
    if (p.name !== 'gallery') continue;
    const area = (p.x1 - p.x0) * (p.z1 - p.z0);
    if (area >= 44 && communal.length) p.name = communal.pop()!;
    else if (area >= 26 && working.length) p.name = working.pop()!;
  }

  // ---- a forsaken house has lost a roof: one room lies open, with what fell still in it
  if (setting.condition === 'forsaken') {
    const options = places.filter((p) => (p.roof === 'barrel' || p.roof === 'timber') && p.id !== secretId && p.role !== 'goal' && p.role !== 'entrance' && Math.min(p.x1 - p.x0, p.z1 - p.z0) >= 5);
    if (options.length) {
      const p = rng.pick(options);
      p.roof = 'sky';
      p.fallen = true;
      p.name = `roofless ${p.name}`;
    }
  }

  // ---- light. Daylight where a court reaches in; torches at the entrance and the sanctum; and some
  // rooms left dark on purpose, never two in a row, so there is always light ahead to walk towards.
  for (const p of places) {
    if (p.roof === 'sky') { p.light = 'day'; continue; }
    if (p.roof === 'cave') continue;
    const facesCourt = ways.some((w) => w.kind !== 'door' && (w.a === p.id || w.b === p.id) && places[w.a === p.id ? w.b : w.a].roof === 'sky');
    if (facesCourt) p.light = 'day';
  }
  for (const p of places) {
    if (p.light !== 'torch' || p.role === 'entrance' || p.role === 'goal') continue;
    const besideDark = ways.some((w) => w.kind !== 'window' && (w.a === p.id || w.b === p.id) && places[w.a === p.id ? w.b : w.a].light === 'dark');
    if (p.id !== secretId && !besideDark && rng.chance(p.role === 'reward' ? 0.5 : 0.28)) p.light = 'dark';
  }

  // ---- floor levels: a gentle walk in steps out from the entrance, then pulled together until
  // every doorway can hold its stairs
  const level = new Map<number, number>([[entrance.id, 0], [forecourt.id, -2]]);
  const order = [entrance.id];
  while (order.length) {
    const id = order.shift()!;
    for (const w of ways) {
      if (w.kind === 'window' || (w.a !== id && w.b !== id)) continue;
      const n = places[w.a === id ? w.b : w.a];
      if (level.has(n.id)) continue;
      const base = level.get(id)!;
      // A secret door must sit flush in its wall, so the floor beyond is level with the floor before.
      level.set(n.id, n.id === secretId ? base : n.role === 'goal' ? base + 3 : n.role === 'court' ? base - 1 : base + rng.pick([-1, 0, 0, 0, 1, 1]));
      order.push(n.id);
    }
  }
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (const w of ways) {
      if (w.kind === 'window') continue;
      const la = level.get(w.a)!, lb = level.get(w.b)!;
      if (Math.abs(la - lb) > MAX_STEPS) {
        level.set(lb > la ? w.b : w.a, Math.max(la, lb) - 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (secretId >= 0) {
    const w = ways.find((x) => x.door?.leaf === 'secret')!;
    level.set(secretId, level.get(w.a === secretId ? w.b : w.a)!);
  }
  const lowest = Math.min(...level.values());
  for (const p of places) p.floor = Math.round((level.get(p.id)! - lowest) * STEP * 100) / 100;

  // ---- a cave goes down. Each chamber beyond the first lies below the one it is reached from,
  // and not by a step but by a man's height or more: the cleft between them is a climb. (Down,
  // because above there is only so much hill.) From a stream of its own, so the houses are as they were.
  {
    const deep = rng.fork('cavelevels'), seen = new Set<number>();
    for (const first of places) {
      if (first.roof !== 'cave' || seen.has(first.id) || !ways.some((w) => !w.natural && w.kind !== 'window' && (w.a === first.id || w.b === first.id))) continue;
      const queue = [first.id];
      seen.add(first.id);
      while (queue.length) {
        const id = queue.shift()!;
        for (const w of ways) {
          if (!w.natural || (w.a !== id && w.b !== id)) continue;
          const next = w.a === id ? w.b : w.a;
          if (seen.has(next)) continue;
          seen.add(next);
          places[next].floor = Math.round(Math.max(first.floor - 3.6, places[id].floor - deep.range(1.3, 2.3)) * 100) / 100;
          queue.push(next);
        }
      }
    }
  }

  // ---- depth from the start, roofline
  // ---- storeys. Some rooms have another over them, or a cellar under them, reached by a stair
  // that runs up one long wall and comes through the floor above. The room on the other storey
  // has the same outline; nothing else opens off it, so it is a place to go and come back from,
  // and a good place to hide a key. All from a stream of its own, and added after everything
  // else, so the house on the ground is what it would have been without them.
  {
    const up = rng.fork('storeys');
    const TREAD = 0.25, STEPS = 18, RISE = STEPS * STEP, RUN = STEPS * TREAD;
    const want = up.chance(0.6) ? (up.chance(0.3) ? 2 : 1) : 0;
    const hosts = shuffle(places.filter((p) => (p.roof === 'barrel' || p.roof === 'timber') && !p.fallen && p.id !== secretId && p.role !== 'goal' && p.role !== 'entrance' && p.id !== forecourt.id
      && Math.max(p.x1 - p.x0, p.z1 - p.z0) >= RUN + 1.55 && Math.min(p.x1 - p.x0, p.z1 - p.z0) >= 3.7), up);
    let made = 0;
    for (const host of hosts) {
      if (made >= want) break;
      const alongX = host.x1 - host.x0 >= host.z1 - host.z0, lo = alongX ? host.x0 : host.z0, hi = alongX ? host.x1 : host.z1;
      // A long wall with nothing opening through it where the flight would stand.
      const clear = (side: Side, from: number, to: number) => !ways.some((w) => {
        if (w.a !== host.id && w.b !== host.id) return false;
        const on = w.a === host.id ? w.side : ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[w.side];
        return on === side && w.at + w.halfWidth > Math.min(from, to) - 0.5 && w.at - w.halfWidth < Math.max(from, to) + 0.5;
      });
      const options: { side: Side; at: number; to: number }[] = [];
      for (const side of (alongX ? ['n', 's'] : ['w', 'e']) as Side[]) {
        for (const forward of [true, false]) {
          const slack = hi - lo - RUN - 1.5, shift = up.range(0, Math.max(0, slack));
          const at = forward ? lo + 0.7 + shift : hi - 0.7 - shift, to = forward ? at + RUN : at - RUN;
          if (clear(side, at, to)) options.push({ side, at: round(at), to: round(forward ? round(at) + RUN : round(at) - RUN) });
        }
      }
      if (!options.length) continue;
      const stair = up.pick(options), down = up.chance(0.5);
      const other: Place = {
        ...host, id: places.length, role: 'reward', roof: 'timber', fallen: undefined, shaft: undefined,
        wall: down ? RISE - 0.3 : up.range(2.9, 3.5),
        floor: Math.round((down ? host.floor - RISE : host.floor + RISE) * 100) / 100,
        level: down ? -1 : 1,
        // Never two dark rooms in a row: a cellar is dark unless the room over it is.
        light: down ? (host.light === 'dark' ? 'torch' : 'dark') : up.chance(0.5) && host.light !== 'dark' ? 'dark' : 'torch',
        name: down ? up.pick(['cellar', 'undercroft', 'crypt', 'cold store']) : up.pick(['solar', 'loft', 'upper chamber', 'muniment room']),
      };
      // The lower of the two has a flat ceiling at the height the stair climbs to.
      if (!down) { host.roof = 'timber'; host.wall = RISE - 0.3; }
      places.push(other);
      ways.push({ a: down ? other.id : host.id, b: down ? host.id : other.id, side: stair.side, kind: 'stair', at: stair.at, to: stair.to, halfWidth: 0.55 });
      made++;
    }
  }

  const site: Site = {
    seed, places, ways, items: [], levers: [], secret: secretId, start: forecourt.id, wallThickness: T, top: 0, entrance: entrance.id, goal: goal.id,
    setting, sun: normalise(SKIES[setting.hour].sun), title: '',
    // The valley the house stands at the head of: the meadow, and open country to walk on three sides of it.
  };
  // (The island is laid out from a stream of its own, so the house on it is the house the same seed has in a valley.)
  const inWorld = opts.terrain === 'eroded' ? opts.world : undefined;
  if (kind === 'island') layOutIsland(site, forecourt, ecx, rng.fork('island'), opts.terrain === 'eroded', inWorld);
  else if (kind === 'mountain') layOutMountain(site, forecourt, ecx, rng.fork('mountain'), opts.terrain === 'eroded', inWorld);
  else if (kind === 'town') layOutHarbourTown(site, forecourt, ecx, rng.fork('town'), opts.terrain === 'eroded', inWorld);
  else layOutValley(site, forecourt, ecx, rng.fork('valley'), opts.terrain === 'eroded', inWorld, opts.settlement);
  const adj = neighbours(site);
  const depth = new Map<number, number>([[forecourt.id, 0]]);
  const queue = [forecourt.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adj.get(id)!) {
      if (!depth.has(n)) {
        depth.set(n, depth.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  for (const p of places) p.depth = depth.get(p.id) ?? -1;
  site.top = round(Math.max(...places.filter((p) => p.roof !== 'sky').map((p) => {
    const span = p.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0;
    return p.floor + p.wall + (p.roof === 'barrel' ? span / 2 : p.roof === 'cave' ? 1.3 : 0.4);
  })) + 1.3);
  if (!allReachable(site)) throw new Error(`generated site is not connected (seed ${seed})`);

  // ---- the mission: doors, locks, bars and keys, then proof that it can be completed
  planMission(site, rng.fork('mission'));
  if (!solve(site).ok) throw new Error(`generated site cannot be completed (seed ${seed})`);
  layOutBackWay(site, forecourt, rng.fork('backway'));

  // ---- title
  const number = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
  const count = (n: number) => number[n] ?? String(n);
  const parts = [`${count(rooms())} rooms ${draft.phrase}`];
  if (court && draft.phrase.indexOf('court') < 0) parts.push('with a court to cross');
  if (chambers.length) parts.push(`and ${count(chambers.length)} side ${chambers.length === 1 ? 'chamber' : 'chambers'}`);
  const caves = places.filter((p) => p.roof === 'cave').length, clefts = ways.filter((w) => w.natural).length;
  if (caves) parts.push(clefts ? (caves - clefts === 1 ? `one of them a cave that runs on through ${count(caves)} chambers` : `${count(caves - clefts)} of them caves, ${count(caves)} chambers of rock in all`)
    : caves === 1 ? 'one of them a natural cave' : `${count(caves)} of them natural caves`);
  const dark = places.filter((p) => p.light === 'dark' && p.id !== secretId).length;
  const unlit = dark ? ` ${count(dark)[0].toUpperCase()}${count(dark).slice(1)} of its rooms ${dark === 1 ? 'is' : 'are'} unlit.` : '';
  const when = WHEN[setting.hour];
  if (places.some((p) => p.fallen)) parts.push('one with its roof fallen in');
  const below = places.filter((p) => (p.level ?? 0) < 0), above = places.filter((p) => (p.level ?? 0) > 0);
  const a = (name: string) => `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
  if (below.length) parts.push(below.length === 1 ? `${a(below[0].name)} below` : `${count(below.length)} cellars below`);
  if (above.length) parts.push(above.length === 1 ? `${a(above[0].name)} above` : `${count(above.length)} rooms above`);
  const state = { kept: '', damp: 'damp ', forsaken: 'forsaken ' }[setting.condition];
  site.title = `${kind === 'island' ? 'On an island in the sea, a' : kind === 'town' ? 'At the head of a harbour town\'s square, a' : kind === 'mountain' ? `On a mountain top above the cloud${setting.season === 'winter' ? ', in snow' : ''}, a` : 'A'} ${state}${setting.stone} ${setting.kind} ${when}: ${parts.join(', ')}; the sanctum lies ${goal.depth - 1} doors in.${unlit}`;
  return site;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
