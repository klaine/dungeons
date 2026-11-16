import { planMission, solve } from './mission';
import { Rng } from './rng';
import { allReachable, Building, Feature, Hour, loopCount, neighbours, Place, Role, Roof, Setting, Side, shoreOf, Site, SKIES, Stone, Stream, Way, WHEN } from './site';

/**
 * Site generator: a walled house of rooms, entered from a forecourt, with a sanctum to reach.
 *
 * The plan is a grid whose columns and rows vary in width, so rooms range from narrow passages to
 * halls while sharing walls exactly. Which cells are rooms, and which are joined, comes from a
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
export function generateSite(seed: string): Site {
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
  let best: Site | null = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    let site: Site;
    try {
      site = draftSite(seed, setting, base.fork(`site/${attempt}`), size);
    } catch {
      continue;
    }
    const s = score(site, size);
    if (s > bestScore) { bestScore = s; best = site; }
  }
  if (!best) throw new Error(`no site could be generated (seed ${seed})`);
  return best;
}

/**
 * What is out in the valley: the track from the door to where the player arrives, and a few
 * things set back from it, near enough to be seen in passing and far enough to be a walk.
 */
function layOutValley(site: Site, meadow: Place, doorX: number, rng: Rng): void {
  const round = (v: number) => Math.round(v * 10) / 10;
  // The valley itself: wider or narrower, longer or shorter, from one house to the next.
  const beside = rng.range(30, 48), down = rng.range(50, 78);
  const g = { x0: round(meadow.x0 - beside), x1: round(meadow.x1 + beside), z0: meadow.z0, z1: round(meadow.z1 + down) };
  site.grounds = g;
  const track: [number, number][] = [[doorX, meadow.z0]];
  let x = doorX;
  for (let z = meadow.z0 + 8; z <= g.z1 - 10; z += 8) {
    if (z > meadow.z1 - 2) x = Math.min(g.x1 - 24, Math.max(g.x0 + 24, x + rng.range(-6.5, 6.5)));
    track.push([round(x), round(z)]);
  }
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
  const features: Feature[] = [];
  const place = (kind: Feature['kind'], radius: [number, number], nearest: number, furthest: number) => {
    for (let tries = 0; tries < 60; tries++) {
      const r = rng.range(radius[0], radius[1]);
      const px = rng.range(g.x0 + 16 + r, g.x1 - 16 - r), pz = rng.range(meadow.z1 + 8 + r, g.z1 - 12 - r);
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
  layOutTower(site, meadow, fromTrack, rng.fork('tower'));
  layOutBuildings(site, meadow, fromTrack, rng.fork('buildings'));
}

/**
 * A tower in the valley, in something under half of them: a few strides off the track, with
 * its door towards it, on ground that nothing else has taken.
 */
function layOutTower(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const g = site.grounds!;
  if (!rng.chance(0.55)) return;
  const round = (v: number) => Math.round(v * 10) / 10;
  for (let tries = 0; tries < 30; tries++) {
    const x = round(rng.range(g.x0 + 17, g.x1 - 17)), z = round(rng.range(meadow.z1 + 12, g.z1 - 18)), off = fromTrack(x, z);
    if (off < 7.5 || off > 15) continue;
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
  return true;
}

/**
 * Buildings by the track, in about three valleys in five: either a few timber-framed houses in a
 * row with their fronts to the track, as a hamlet has them, or one stuccoed building of the
 * classical kind standing back from it. They go where there is room, and face the track.
 */
function layOutBuildings(site: Site, meadow: Place, fromTrack: (x: number, z: number) => number, rng: Rng): void {
  const g = site.grounds!, track = site.track ?? [];
  if (track.length < 2 || !rng.chance(0.6)) return;
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
    if (b.x - b.d / 2 < g.x0 + 15 || b.x + b.d / 2 > g.x1 - 15 || b.z - b.w / 2 < meadow.z1 + 10 || b.z + b.w / 2 > g.z1 - 16) return false;
    for (const [du, dv] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
      const x = b.x + (du * b.d) / 2, z = b.z + (dv * b.w) / 2;
      if (!roomAt(site, x, z, 4) || fromTrack(x, z) < 3.2) return false;
    }
    return true;
  };
  const side = rng.chance(0.5) ? 1 : -1;
  const out: Building[] = [];
  if (rng.chance(0.5)) {
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
  }
  if (out.length) site.buildings = out;
}

/** A cave in the valley's wall, in about one valley in two: where no water rises or goes to ground. */
function layOutGrotto(site: Site, meadow: Place, rng: Rng): void {
  const g = site.grounds!;
  if (!rng.chance(0.5)) return;
  for (let tries = 0; tries < 10; tries++) {
    const side = rng.chance(0.5) ? 'w' : 'e', z = Math.round(rng.range(meadow.z1 + 9, g.z1 - 14) * 10) / 10, r = Math.round(rng.range(2.0, 2.5) * 10) / 10;
    const edge = side === 'w' ? g.x0 : g.x1;
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
  const g = site.grounds!, features = site.features ?? [], streams = site.streams ?? [];
  const round = (v: number) => Math.round(v * 10) / 10;
  layOutGrotto(site, meadow, rng.fork('grotto'));
  if (!rng.chance(0.7)) return;
  for (let tries = 0; tries < 14; tries++) {
    const side = rng.chance(0.5) ? 'w' : 'e', rise = rng.chance(0.5) ? 'n' : 's';
    const depth = round(rng.range(5.5, 8.5)), height = round(rng.range(3.4, 5.2)), length = round(rng.range(11, 19));
    // The way up is a ledge no steeper than a hill path, about one in three; or steps cut in the rock, at one in two.
    const way = rng.chance(0.4) ? 'steps' : 'ledge';
    const run = round(height / (way === 'steps' ? 0.5 : 0.34) + 1.5);
    const lo = meadow.z1 + 8, hi = g.z1 - 14;
    if (hi - lo < length + run) continue;
    const start = rng.range(lo, hi - length - run), z0 = round(rise === 'n' ? start + run : start), z1 = round(z0 + length);
    const edge = side === 'w' ? g.x0 : g.x1, inward = side === 'w' ? 1 : -1;
    // Everything from the wall to a few paces in front of the shelf must be free; and the wall itself, of any cave in it.
    let free = !(site.grottoes ?? []).some((q) => q.side === side && q.z > start - 8 && q.z < start + length + run + 8);
    for (let z = start - 2; z <= start + length + run + 2 && free; z += 1.5) {
      for (let out = 3; out <= 4.7 + depth + 3.5 && free; out += 1.5) {
        const x = edge + inward * out;
        if (fromTrack(x, z) < 3.5) free = false;
        for (const f of features) if (Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.15) + 3) free = false;
        for (const st of streams) for (let k = 0; k < st.course.length - 1 && free; k++) {
          const [ax, az] = st.course[k], [bx, bz] = st.course[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
          const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
          if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < st.width / 2 + 5) free = false;
        }
      }
    }
    if (!free) continue;
    site.terraces = [{ side, z0, z1, depth, height, rise, run, way }];
    return;
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
  const g = site.grounds!, features = site.features!, track = site.track!;
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
    if (x < g.x0 + 12 + margin || x > g.x1 - 12 - margin || z > g.z1 - 12 - margin || z < meadow.z1 + 4 + margin) return false;
    return !features.some((f) => f !== but && Math.hypot(f.x - x, f.z - z) < (f.kind === 'stones' ? f.r * 3.5 : f.kind === 'ruin' ? f.r * 2.3 : shoreOf(f, x - f.x, z - f.z) * 1.1) + 1.5 + margin);
  };

  // A valley that was given no pond may have a pool of its own.
  if (!features.some((f) => f.kind === 'pond') && rng.chance(0.45)) {
    for (let tries = 0; tries < 40; tries++) {
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
  const rimX = side < 0 ? g.x0 + 6.5 : g.x1 - 6.5;
  const clear = (x: number, z: number, but?: Feature, on = side): boolean =>
    Math.sign(x - trackX(z)) === on && fromTrack(x, z) > 4 && x > g.x0 + 5.5 && x < g.x1 - 5.5 && z < g.z1 - 5.5 && z > meadow.z1 + 3
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
  const south = (x: number): [number, number] => [Math.min(g.x1 - 14, Math.max(g.x0 + 14, x)), g.z1 - 6.5];
  /**
   * Water that crosses the track. Most keeps to its own side; some runs down to the track, over
   * it, and away to a sink on the far side, and then the track has to get across: by stepping
   * stones if it is a brook, by a bridge if it is a river. All of this is drawn from a stream
   * of its own, so that a valley whose water does not cross is laid out as it always was.
   */
  const crossing = rng.fork('crossing'), crosses = crossing.chance(0.4);
  const over = (start: (towards: [number, number]) => [number, number], wide: number, but?: Feature): Stream | null => {
    for (let tries = 0; tries < 6; tries++) {
      const zc = crossing.range(meadow.z1 + 12, g.z1 - 18), xc = trackX(zc);
      // It comes to the track a little upstream of where it leaves it, so it crosses at a slant, as water does.
      const near: [number, number] = [xc + side * 7, zc - 1.5], far: [number, number] = [xc - side * 7, zc + 1.5];
      const from = start(near);
      if (from[1] > zc - 5) continue;
      const sink: [number, number] = crossing.chance(0.55) ? south(xc - side * crossing.range(8, 24)) : [side < 0 ? g.x1 - 6.5 : g.x0 + 6.5, Math.min(g.z1 - 14, zc + crossing.range(8, 22))];
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
        const spring: [number, number] = [rimX, Math.min(g.z1 - 16, Math.max(meadow.z1 + 5, pond.z + rng.range(-26, 4)))];
        const line = route(spring, edge(spring[0], spring[1]), pond);
        if (line && line.length >= 2) { streams.push({ course: line, width, from: 'spring', to: 'pond' }); break; }
      }
    }
    // Out: down the valley to a sink under the southern rim, or under the side rim further down.
    if (rng.chance(streams.length ? 0.9 : 0.5)) {
      const across = crosses ? over((towards) => edge(towards[0], towards[1]), round(width + 0.2), pond) : null;
      if (across) streams.push({ ...across, from: 'pond' });
      else for (let tries = 0; tries < 6; tries++) {
        const sink: [number, number] = rng.chance(0.6) || pond.z > g.z1 - 34 ? south(pond.x + side * rng.range(0, 12) + rng.range(-5, 5)) : [rimX, Math.min(g.z1 - 14, pond.z + rng.range(14, 30))];
        if (Math.sign(sink[0] - trackX(sink[1])) !== side) continue;
        const line = route(edge(sink[0], sink[1]), sink, pond);
        if (line && line.length >= 2) { streams.push({ course: line, width: round(width + 0.2), from: 'pond', to: 'sink' }); break; }
      }
    }
  } else if (rng.chance(0.55)) {
    // No pond: a stream down one side of the valley, from a spring to a sink.
    const across = crosses ? over(() => [rimX, crossing.range(meadow.z1 + 6, (meadow.z1 + g.z1) / 2)], width) : null;
    if (across) streams.push(across);
    else for (let tries = 0; tries < 8; tries++) {
      const spring: [number, number] = [rimX, rng.range(meadow.z1 + 6, (meadow.z1 + g.z1) / 2)];
      const sink = south(rimX - side * rng.range(10, 26));
      if (Math.sign(sink[0] - trackX(sink[1])) !== side) continue;
      const line = route(spring, sink);
      if (line && line.length >= 3) { streams.push({ course: line, width, from: 'spring', to: 'sink' }); break; }
    }
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

function draftSite(seed: string, setting: Setting, rng: Rng, size = MAX_ROOMS): Site {
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

  const addCell = (c: Cell, role: Role, name: string): Place => {
    const p: Place = {
      id: places.length, role, name, roof: 'barrel', light: 'torch',
      x0: xs[c.i] + T / 2, x1: xs[c.i + 1] - T / 2, z0: zs[c.j] + T / 2, z1: zs[c.j + 1] - T / 2,
      floor: 0, wall: 3.4, axis: 'x', depth: 0,
    };
    places.push(p);
    byCell.set(key(c), p.id);
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

  // ---- the drafted rooms and the ways between them; a court is entered through open arches
  for (const c of draft.cells) {
    const p = addCell(c, isCourt(c) ? 'court' : 'passage', isCourt(c) ? 'cloister court' : 'gallery');
    if (isCourt(c)) p.roof = 'sky';
  }
  const archesFor = (a: Cell, b: Cell): number[] => {
    const pa = placeOf(a), pb = placeOf(b);
    const length = a.i === b.i ? Math.min(pa.x1, pb.x1) - Math.max(pa.x0, pb.x0) : Math.min(pa.z1, pb.z1) - Math.max(pa.z0, pb.z0);
    const count = Math.max(1, Math.floor((length - 0.6) / 3.1));
    return Array.from({ length: count }, (_, m) => (m - (count - 1) / 2) * 3.1);
  };
  for (const [a, b] of draft.edges) {
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
  const farCell = ranked.find((c, k) => k < 3 && around(c).some(free)) ?? ranked[0];
  const far = placeOf(farCell);

  let goal = far;
  // Of the free cells beside it, the sanctum takes the largest.
  const sanctumCell = around(farCell).filter(free).sort((a, b) => widths[b.i] * depths[b.j] - widths[a.i] * depths[a.j])[0];
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

  // ---- roofs
  for (const p of places) {
    if (p.roof === 'sky' || p.roof === 'cave') continue;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    p.axis = Math.abs(dx - dz) < 0.8 ? rng.pick(['x', 'z'] as const) : dx > dz ? 'x' : 'z';
    const roomy = Math.min(dx, dz) >= 5.6;
    const roof: Roof = roomy && p.role !== 'goal' && rng.chance(0.3) ? 'timber' : 'barrel';
    p.roof = roof;
    p.wall = roof === 'timber' ? 4.2 : 3.4;
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
  layOutValley(site, forecourt, ecx, rng.fork('valley'));
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
  site.title = `A ${state}${setting.stone} ${setting.kind} ${when}: ${parts.join(', ')}; the sanctum lies ${goal.depth - 1} doors in.${unlit}`;
  return site;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
