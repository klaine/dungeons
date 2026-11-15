import { Rng } from './rng';
import { allReachable, neighbours, Place, Role, Roof, Side, Site, Way } from './site';

/**
 * First site generator: a walled house of rooms arranged in a loop, entered from a forecourt.
 *
 * The plan is a grid whose columns and rows vary in width, so rooms range from narrow passages to
 * halls while sharing walls exactly. Structure is built from a cycle, not from a tree with loops
 * added afterwards: the main ring gives two ways round from the entrance to the far side, and the
 * goal lies beyond the point where they meet. A wide enough ring encloses a court open to the
 * sky. Side chambers hang off the ring, and now and then two of them connect to make a second loop.
 *
 * Not here yet: locks and keys, pacing, premise, and anything that is not a rectangle.
 */

const T = 1.0;          // wall thickness
const STEP = 0.17;      // height of one stair
const MAX_STEPS = 3;    // most stairs that fit in a doorway

interface Cell { i: number; j: number }

export function generateSite(seed: string): Site {
  const rng = new Rng(seed).fork('site');
  const NX = 5, NZ = 4;

  // ---- ring shape and position; its south side sits on the south edge of the plan
  const shape = rng.next();
  const [rw, rh] = shape < 0.55 ? [3, 3] : shape < 0.75 ? [3, 2] : shape < 0.9 ? [2, 3] : [2, 2];
  const i0 = rng.int(0, NX - rw);
  const j0 = NZ - rh;
  const hasCourt = rw === 3 && rh === 3;

  // ---- column widths and row depths: mostly rooms, sometimes a passage
  const widths: number[] = [];
  const depths: number[] = [];
  for (let i = 0; i < NX; i++) widths.push(rng.chance(0.25) ? rng.range(3.0, 3.6) : rng.range(5.6, 7.6));
  for (let j = 0; j < NZ; j++) depths.push(rng.chance(0.2) ? rng.range(3.0, 3.6) : rng.range(5.6, 9.0));
  if (hasCourt) {
    widths[i0 + 1] = rng.range(6.6, 8.2);
    depths[j0 + 1] = rng.range(6.6, 8.6);
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  const xs = [0];
  const zs = [0];
  for (const w of widths) xs.push(round(xs[xs.length - 1] + w + T));
  for (const d of depths) zs.push(round(zs[zs.length - 1] + d + T));

  const places: Place[] = [];
  const ways: Way[] = [];
  const byCell = new Map<string, number>();
  const key = (c: Cell) => `${c.i},${c.j}`;
  const inGrid = (c: Cell) => c.i >= 0 && c.i < NX && c.j >= 0 && c.j < NZ;

  const addCell = (c: Cell, role: Role, name: string): Place => {
    const p: Place = {
      id: places.length, role, name, roof: 'barrel',
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
    const pa = places[byCell.get(key(a))!];
    const pb = places[byCell.get(key(b))!];
    const side = sideTowards(a, b);
    const along = side === 'n' || side === 's';
    const lo = along ? Math.max(pa.x0, pb.x0) : Math.max(pa.z0, pb.z0);
    const hi = along ? Math.min(pa.x1, pb.x1) : Math.min(pa.z1, pb.z1);
    const mid = (lo + hi) / 2;
    for (const o of offsets) ways.push({ a: pa.id, b: pb.id, side, kind, at: round(mid + o), halfWidth });
  };

  // ---- the ring, clockwise from its north-west corner
  const ring: Cell[] = [];
  for (let i = 0; i < rw; i++) ring.push({ i: i0 + i, j: j0 });
  for (let j = 1; j < rh; j++) ring.push({ i: i0 + rw - 1, j: j0 + j });
  for (let i = rw - 2; i >= 0; i--) ring.push({ i: i0 + i, j: j0 + rh - 1 });
  for (let j = rh - 2; j >= 1; j--) ring.push({ i: i0, j: j0 + j });
  for (const c of ring) addCell(c, 'passage', 'gallery');
  const DOOR = 0.85;
  for (let k = 0; k < ring.length; k++) connect(ring[k], ring[(k + 1) % ring.length], 'door', DOOR);

  // ---- entrance on the south side, goal as far round the ring as possible
  const southRow = ring.filter((c) => c.j === NZ - 1);
  const entranceCell = rw === 3 && rng.chance(0.5) ? southRow.find((c) => c.i === i0 + 1)! : rng.pick(southRow);
  const entranceIndex = ring.findIndex((c) => c.i === entranceCell.i && c.j === entranceCell.j);
  const entrance = places[byCell.get(key(entranceCell))!];
  entrance.role = 'entrance';
  entrance.name = 'gatehall';
  const farCell = ring[(entranceIndex + Math.floor(ring.length / 2)) % ring.length];
  const far = places[byCell.get(key(farCell))!];

  const free = (c: Cell) => inGrid(c) && !byCell.has(key(c)) && !(hasCourt && c.i === i0 + 1 && c.j === j0 + 1);
  const around = (c: Cell): Cell[] => [{ i: c.i, j: c.j - 1 }, { i: c.i + 1, j: c.j }, { i: c.i - 1, j: c.j }, { i: c.i, j: c.j + 1 }];

  let goal = far;
  const sanctumCell = around(farCell).find(free);
  if (sanctumCell) {
    goal = addCell(sanctumCell, 'goal', 'sanctum');
    connect(farCell, sanctumCell, 'door', DOOR);
  } else {
    far.role = 'goal';
    far.name = 'sanctum';
  }

  // ---- side chambers, and sometimes a door between two of them for a second loop
  const chambers: Cell[] = [];
  const candidates = ring.filter((c) => c !== entranceCell && c !== farCell);
  for (let k = candidates.length - 1; k > 0; k--) {
    const s = rng.int(0, k);
    [candidates[k], candidates[s]] = [candidates[s], candidates[k]];
  }
  for (const c of candidates) {
    if (chambers.length >= 3) break;
    const spot = around(c).find(free);
    if (!spot || !rng.chance(0.55)) continue;
    addCell(spot, 'reward', rng.pick(['cell', 'store', 'vestry', 'scriptorium']));
    connect(c, spot, 'door', DOOR);
    for (const other of chambers) {
      const adjacent = Math.abs(other.i - spot.i) + Math.abs(other.j - spot.j) === 1;
      if (adjacent && rng.chance(0.5)) connect(other, spot, 'door', DOOR);
    }
    chambers.push(spot);
  }

  // ---- the court: arcades on two sides, windows on the others
  let court: Place | null = null;
  if (hasCourt) {
    const cc: Cell = { i: i0 + 1, j: j0 + 1 };
    court = addCell(cc, 'court', 'cloister court');
    court.roof = 'sky';
    const sides = around(cc);
    for (let k = sides.length - 1; k > 0; k--) {
      const s = rng.int(0, k);
      [sides[k], sides[s]] = [sides[s], sides[k]];
    }
    sides.forEach((n, k) => {
      const length = n.i === cc.i ? court!.x1 - court!.x0 : court!.z1 - court!.z0;
      if (k < 2) {
        const count = Math.max(1, Math.floor((length - 0.6) / 3.1));
        const offsets = Array.from({ length: count }, (_, m) => (m - (count - 1) / 2) * 3.1);
        connect(cc, n, 'arch', 1.15, offsets);
      } else {
        connect(cc, n, 'window', 0.42, length > 6.4 && rng.chance(0.6) ? [-1.5, 1.5] : [0]);
      }
    });
  }

  // ---- the forecourt, outside the south wall
  const ecx = round((entrance.x0 + entrance.x1) / 2);
  const forecourt: Place = {
    id: places.length, role: 'approach', name: 'forecourt', roof: 'sky',
    x0: ecx - 4.5, x1: ecx + 4.5, z0: zs[NZ] + T / 2, z1: zs[NZ] + T / 2 + 7.5,
    floor: 0, wall: 3.9, axis: 'x', depth: 0,
  };
  places.push(forecourt);
  ways.push({ a: entrance.id, b: forecourt.id, side: 's', kind: 'door', at: ecx, halfWidth: 0.95 });

  // ---- roofs
  for (const p of places) {
    if (p.roof === 'sky') continue;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    p.axis = Math.abs(dx - dz) < 0.8 ? rng.pick(['x', 'z'] as const) : dx > dz ? 'x' : 'z';
    const roomy = Math.min(dx, dz) >= 5.6;
    const roof: Roof = roomy && p.role !== 'goal' && rng.chance(0.3) ? 'timber' : 'barrel';
    p.roof = roof;
    p.wall = roof === 'timber' ? 4.2 : 3.4;
    if (Math.min(dx, dz) < 4 && p.role === 'passage') p.name = 'passage';
  }

  // ---- floor levels: a gentle walk in steps, then pulled together until every doorway can hold its stairs
  const level = new Map<number, number>();
  let walk = 0;
  for (const c of ring) {
    walk += rng.pick([-1, 0, 0, 0, 1]);
    level.set(byCell.get(key(c))!, walk);
  }
  for (const p of places) {
    if (level.has(p.id)) continue;
    const parent = ways.find((w) => w.kind !== 'window' && (w.a === p.id || w.b === p.id) && level.has(w.a === p.id ? w.b : w.a));
    const base = parent ? level.get(parent.a === p.id ? parent.b : parent.a)! : 0;
    level.set(p.id, p.role === 'goal' ? base + 3 : p.role === 'court' ? base - 1 : p.role === 'approach' ? base - 2 : base + rng.pick([0, 1, 2]));
  }
  for (let pass = 0; pass < 40; pass++) {
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
  const lowest = Math.min(...level.values());
  for (const p of places) p.floor = round2((level.get(p.id)! - lowest) * STEP);

  // ---- depth from the entrance, roofline, title
  const site: Site = {
    seed, places, ways, wallThickness: T, top: 0, entrance: entrance.id, goal: goal.id,
    sun: normalise([-0.3, 0.6, 0.9]), title: '',
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
    return p.floor + p.wall + (p.roof === 'barrel' ? span / 2 : 0.4);
  })) + 1.3);
  if (!allReachable(site)) throw new Error(`generated site is not connected (seed ${seed})`);

  const rooms = places.filter((p) => p.roof !== 'sky').length;
  const number = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const parts = [`${number[rooms] ?? rooms} rooms`];
  parts.push(court ? 'in a ring round a cloister court' : 'in a ring');
  if (chambers.length) parts.push(`with ${number[chambers.length]} side ${chambers.length === 1 ? 'chamber' : 'chambers'}`);
  site.title = `A walled house of ${parts.join(' ')}; the sanctum lies ${goal.depth - 1} doors in.`;
  return site;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
