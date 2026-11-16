import { planMission, solve } from './mission';
import { Rng } from './rng';
import { allReachable, Hour, loopCount, neighbours, Place, Role, Roof, Setting, Side, Site, SKIES, Stone, Way } from './site';

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
  };
  let best: Site | null = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    let site: Site;
    try {
      site = draftSite(seed, setting, base.fork(`site/${attempt}`));
    } catch {
      continue;
    }
    const s = score(site);
    if (s > bestScore) { bestScore = s; best = site; }
  }
  if (!best) throw new Error(`no site could be generated (seed ${seed})`);
  return best;
}

/** How much there is to a site: loops, gating, things to find, variety. Higher is better. */
export function score(site: Site): number {
  const solution = solve(site);
  const rooms = site.places.filter((p) => p.roof !== 'sky').length;
  const dark = site.places.filter((p) => p.light === 'dark').length;
  const roofs = new Set(site.places.map((p) => p.roof));
  return Math.min(loopCount(site), 3)
    + 1.2 * Math.min(solution.moves.length / Math.max(1, solution.direct), 3)
    + 0.8 * site.items.length
    + (site.ways.some((w) => w.door?.barredFrom !== undefined) ? 1 : 0)
    + (site.levers.length ? 1.2 : 0)
    + (site.secret >= 0 ? 0.7 : 0)
    + (roofs.has('sky') && site.places.some((p) => p.role === 'court') ? 0.8 : 0)
    + (roofs.has('cave') ? 0.8 : 0)
    + (roofs.has('timber') && roofs.has('barrel') ? 0.5 : 0)
    + (dark >= 1 && dark <= 3 ? 1 : 0)
    - 0.25 * Math.abs(rooms - 9);
}

function draftSite(seed: string, setting: Setting, rng: Rng): Site {
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
  const rooms = () => places.filter((p) => p.roof !== 'sky' && p.name !== 'hidden chamber').length;

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
    if (chambers.length >= 4 || rooms() >= MAX_ROOMS) break;
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
    if (beyond && rooms() < MAX_ROOMS && rng.chance(0.3)) {
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
    id: places.length, role: 'approach', name: 'hollow', roof: 'sky', light: 'day',
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

  // ---- depth from the start, roofline
  const site: Site = {
    seed, places, ways, items: [], levers: [], secret: secretId, start: forecourt.id, wallThickness: T, top: 0, entrance: entrance.id, goal: goal.id,
    setting, sun: normalise(SKIES[setting.hour].sun), title: '',
  };
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
  const caves = places.filter((p) => p.roof === 'cave').length;
  if (caves) parts.push(caves === 1 ? 'one of them a natural cave' : `${count(caves)} of them natural caves`);
  const dark = places.filter((p) => p.light === 'dark' && p.id !== secretId).length;
  const unlit = dark ? ` ${count(dark)[0].toUpperCase()}${count(dark).slice(1)} of its rooms ${dark === 1 ? 'is' : 'are'} unlit.` : '';
  const when = { morning: 'in the morning', midday: 'at midday', evening: 'at evening' }[setting.hour];
  if (places.some((p) => p.fallen)) parts.push('one with its roof fallen in');
  const state = { kept: '', damp: 'damp ', forsaken: 'forsaken ' }[setting.condition];
  site.title = `A ${state}${setting.stone} ${setting.kind} ${when}: ${parts.join(', ')}; the sanctum lies ${goal.depth - 1} doors in.${unlit}`;
  return site;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
