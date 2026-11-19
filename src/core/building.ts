import { brickFootprint } from './brick';
import { Rng } from './rng';
import { Building, BuildingPlan } from './site';

/**
 * How a classical building is laid out: where its windows stand, how its rooms are planned, and
 * where its stair goes. Everything here is in the building's own measures: `u` across the front
 * from its middle, to the right as seen from outside; `v` back from the face of the front wall;
 * `y` up from the ground before the door. The builder and the maps both read it, so that what is
 * drawn on a plan is what is built.
 */

/** The thickness of its walls, and other fixed measures. */
export const CLASSICAL = {
  /** An outer wall, all of it; and the part of that which is the rendered skin with its windows. */
  outer: 0.75, skin: 0.3,
  /** The wall down the middle of the depth, between front rooms and back. */
  spine: 0.5,
  /** A wall between one room and the next. */
  cross: 0.3,
  /** How far the middle stands forward, where it does. */
  out: 0.4,
  plinth: 0.5,
};

/** The height of a storey's floor above the ground before the door. */
export const floorOf = (b: Building, storey: number): number => CLASSICAL.plinth + b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0);

/** How high the ground stands at a point of a building on a slope, above the ground before its door: none at the front, all of `sunk` at the back. */
export const groundOf = (b: Building, v: number): number => {
  const t = Math.min(1, Math.max(0, v / b.d));
  return (b.sunk ?? 0) * t * t * (3 - 2 * t);
};

/** Where the windows of a classical front stand (as `u`), and where the part of it that stands forward begins and ends. */
export function classicalFront(b: Building): { windows: number[]; standL: number; standR: number } {
  const W = b.w, middle = b.bays >> 1, pitch = (W - 1.6) / b.bays;
  if (!b.portico) return { windows: Array.from({ length: b.bays }, (_, n) => -W / 2 + 0.8 + (n + 0.5) * pitch), standL: 0, standR: 0 };
  // (Two wings, and between them three bays standing forward: each laid out evenly across its own breadth.)
  const a = 0.8 + (middle - 1) * pitch - 0.3, c = 0.8 + (middle + 2) * pitch + 0.3;
  const wing = (from: number, to: number) => Array.from({ length: middle - 1 }, (_, i) => -W / 2 + from + 0.5 + (i + 0.5) * ((to - from - 1.0) / (middle - 1)));
  const stand = Array.from({ length: 3 }, (_, i) => -W / 2 + a + 0.3 + (i + 0.5) * ((c - a - 0.6) / 3));
  return { windows: [...wing(0, a), ...stand, ...wing(c, W)], standL: a - W / 2, standR: c - W / 2 };
}

/** Where the windows of the end walls stand, as `v`: an even number of them, so that the wall down the middle meets each end wall between two. */
export function classicalEnds(b: Building): number[] {
  const n = b.d >= 10.4 ? 4 : 2, pitch = (b.d - 1.6) / n;
  return Array.from({ length: n }, (_, i) => 0.8 + (i + 0.5) * pitch);
}

/** The windows of a wing: along its two long walls (as `v`), and across its far end (as `u`). */
export function wingWindows(b: Building, wing: NonNullable<Building['wings']>[number]): { along: number[]; across: number[] } {
  const n = Math.max(1, Math.round((wing.length - 1.2) / 2.6)), pitch = (wing.length - 1.2) / n;
  const mid = wing.side * (b.w / 2 - wing.width / 2);
  return {
    along: Array.from({ length: n }, (_, i) => b.d + 0.6 + (i + 0.5) * pitch),
    across: wing.width >= 7.8 ? [mid - wing.width / 4, mid + wing.width / 4] : [mid],
  };
}

/** Where a building stands on the ground, as rectangles in its own measures: the main block, what stands forward of it, and its wings. */
export function footprintOf(b: Building): { u0: number; u1: number; v0: number; v1: number }[] {
  if (b.style === 'brick') return brickFootprint(b);
  const out = [{ u0: -b.w / 2, u1: b.w / 2, v0: 0, v1: b.d }];
  if (b.style === 'imperial' && b.portico) { const f = classicalFront(b); out.push({ u0: f.standL, u1: f.standR, v0: -CLASSICAL.out, v1: 0 }); }
  for (const g of b.wings ?? []) out.push({ u0: g.side > 0 ? b.w / 2 - g.width : -b.w / 2, u1: g.side > 0 ? b.w / 2 : -b.w / 2 + g.width, v0: b.d - 0.01, v1: b.d + g.length });
  return out;
}

/**
 * The variations a classical building may have, dealt from `rng` (a stream of its own, so that adding them changed nothing else):
 * its storeys may be other than a tall principal storey over a lower ground one (a tall ground storey under lower ones alike, or all
 * alike); now and then its middle stands forward without a pediment over it; and a building with wings, an L or a U, may have towers at one
 * to three of its corners, rising one to three storeys over its cornice. Towers go in pairs where they can (the two ends of the front,
 * or the two ends of a U's wings), and a third, if there is one, at a wing's end.
 */
export function classicalVariations(b: Building, rng: Rng): void {
  if (b.style !== 'imperial') return;
  // Its storeys. Most have the tall principal storey over a lower ground storey, as dealt; but some have a tall ground storey (shops,
  // a counting house, a hall) with lower storeys alike over it, and some have every storey the same height.
  if (b.storeys >= 2) {
    const q = rng.fork('storeys'), kind = q.pick(['principal', 'principal', 'principal', 'ground', 'ground', 'even', 'even']), r1 = (v: number) => Math.round(v * 10) / 10;
    if (kind === 'ground') b.heights = [r1(q.range(4.4, 5.2)), ...Array.from({ length: b.storeys - 1 }, (_, n) => r1(q.range(3.1, 3.5) - n * 0.05))];
    else if (kind === 'even') { const h = r1(q.range(3.3, 3.9)); b.heights = Array.from({ length: b.storeys }, (_, n) => r1(h + (n === 0 ? 0.2 : 0) - (n === b.storeys - 1 && b.storeys > 2 ? q.range(0, 0.2) : 0))); }
  }
  if (b.portico && rng.fork('pediment').chance(0.3)) b.pediment = false;
  // A broad one, eleven bays or more, may have two or three entrances along its front, each with its stair: two either side of the
  // middle, or the middle one and one either side.
  if (b.bays >= 11) {
    const q = rng.fork('entrances'), middle = b.bays >> 1;
    if (q.chance(0.4)) {
      if (q.chance(0.5)) { const k = q.int(2, middle - 3); b.entrances = [k, middle, b.bays - 1 - k]; }
      else { const k = Math.min(Math.round(b.bays / 4), (b.bays - 3) >> 1); b.entrances = [k, b.bays - 1 - k]; }
    }
  }
  const wings = b.wings ?? [], q = rng.fork('towers');
  if (!wings.length || !q.chance(0.65)) return;
  const count = q.pick([1, 2, 2, 3]), extra = q.pick([1, 1, 2, 2, 3]);
  const front = Math.min(6.4, b.w / 2 - 3.5, q.range(4.6, 6.4)), wingSize = (side: number) => Math.min(front, wings.find((g) => g.side === side)?.width ?? 0, q.range(4.6, 6.4));
  if (front < 4) return;
  const pairFront: NonNullable<Building['towers']> = [-1, 1].map((side) => ({ corner: 'front' as const, side: side as -1 | 1, size: Math.round(front * 10) / 10, extra }));
  const atWing = (side: -1 | 1) => ({ corner: 'wing' as const, side, size: Math.round(wingSize(side) * 10) / 10, extra: Math.min(3, extra + (q.chance(0.3) ? 1 : 0)) });
  const towers: NonNullable<Building['towers']> = [];
  if (count === 1) towers.push(q.chance(0.5) ? atWing(wings[q.int(0, wings.length - 1)].side) : pairFront[q.int(0, 1)]);
  else if (count === 2) towers.push(...(wings.length === 2 && q.chance(0.4) ? [atWing(-1), atWing(1)] : pairFront));
  else towers.push(...pairFront, atWing(wings[q.int(0, wings.length - 1)].side));
  b.towers = towers.filter((t) => t.size >= 4);
  if (!b.towers.length) delete b.towers;
}

/** Whether an opening whose foot is at `y0` would be under the ground, at a place `v` back from the front. */
export const buried = (b: Building, v: number, y0: number): boolean => y0 < groundOf(b, v) + 0.25;

/**
 * The plan of a classical building, worked out from its bays as such houses were. Each window is
 * a bay, and a wall between rooms may stand only between two windows. The middle bay, or the
 * middle three where the middle stands forward or the house is seven bays or more, is the way
 * in and the way up: three bays make an entrance hall to the front and a stair hall behind it,
 * one bay a passage through the house with the stair at its far end. The bays either side are
 * dealt out among rooms of one, two or three bays, the same on both sides, in two rows divided
 * by a wall down the middle of the depth. Doors stand in a line from room to room along the front
 * a stride in from the windows, along the back the same way, and from each front room to the
 * room behind it. Every storey is planned alike.
 */
export function planClassical(b: Building, rng: Rng): BuildingPlan {
  const { outer: T, spine: SPINE, cross: CROSS, out: OUT } = CLASSICAL;
  const W = b.w, D = b.d, { windows, standL, standR } = classicalFront(b);
  const bays = b.bays, middle = bays >> 1, broad = b.portico || bays >= 7 ? 3 : 1, flank = (broad - 1) / 2;
  // The middle line of each wall between bays: midway between two windows, or at the cheeks of what stands forward.
  const edge: number[] = [-W / 2];
  for (let i = 1; i < bays; i++) edge.push((windows[i - 1] + windows[i]) / 2);
  edge.push(W / 2);
  if (b.portico) { edge[middle - 1] = standL + CROSS / 2; edge[middle + 2] = standR - CROSS / 2; }
  const lo = (i: number) => (i === 0 ? -W / 2 + T : edge[i] + CROSS / 2), hi = (i: number) => (i === bays ? W / 2 - T : edge[i] - CROSS / 2);
  const spine = D / 2, sF = spine - SPINE / 2, sB = spine + SPINE / 2, front = T, back = D - T;
  const uL = lo(middle - flank), uR = hi(middle + flank + 1);
  const plan: BuildingPlan = { rooms: [], doors: [], walls: { outer: T, spine: SPINE, cross: CROSS } };
  // How far each wall of a room reaches out from it: all of an outer wall within its skin, half of any other.
  const IN = T - CLASSICAL.skin, side = (u: number) => (Math.abs(Math.abs(u) - (W / 2 - T)) < 0.02 ? IN : CROSS / 2);
  const lined = (v0: number, v1: number, u0: number, u1: number): [number, number, number, number] => [v0 < T + 0.02 ? IN : SPINE / 2, v1 > back - 0.02 ? IN : SPINE / 2, side(u0), side(u1)];
  if (broad === 1) plan.rooms.push({ kind: 'passage', u0: uL, u1: uR, v0: front, v1: back, linings: lined(front, back, uL, uR) });
  else {
    plan.rooms.push({ kind: 'hall', u0: uL, u1: uR, v0: b.portico ? -OUT + T : T, v1: sF, linings: lined(T, sF, uL, uR) }, { kind: 'stair', u0: uL, u1: uR, v0: sB, v1: back, linings: lined(sB, back, uL, uR) });
    plan.doors.push({ line: 'v', at: spine, c: (uL + uR) / 2, w: 2.2, tall: true });
  }
  if (b.entrances && b.entrances.length > 1) { planEntrances(b, rng, plan, { edge, lo, hi, lined, middle, broad, spine, sF, sB, front, back }); return planWings(b, rng, plan); }
  // A wing: rooms of one, two or three bays; and the other wing its mirror. (With a carriage way through its end, the outermost two
  // bays are one, the way on the ground storey and a pair of rooms over it on every other.)
  const sizes: number[] = [], arch = !!b.arch && middle - flank >= 2 && !b.wings?.length;
  for (let left = middle - flank - (arch ? 2 : 0); left > 0;) {
    const take = left <= 3 && rng.chance(0.45) ? left : Math.min(left, rng.pick([1, 2, 2, 3]));
    sizes.push(take);
    left -= take;
  }
  if (arch) sizes.push(2);
  for (const side of [-1, 1]) {
    let bay = side < 0 ? middle - flank : middle + flank + 1;
    for (const size of sizes) {
      const first = side < 0 ? bay - size : bay, last = side < 0 ? bay : bay + size;
      const u0 = lo(first), u1 = hi(last), inner = side < 0 ? last : first, atMiddle = side < 0 ? last === middle - flank : first === middle + flank + 1;
      // (The carriage way: on the ground storey one room from the front wall to the back, entered from neither neighbour; over it the
      // rooms are as anywhere else, and so named storey by storey.)
      const through = arch && side === b.arch!.side && (side < 0 ? first === 0 : last === bays);
      const storeys = through ? Array.from({ length: b.storeys - 1 }, (_, n) => n + 1) : [undefined];
      if (through) plan.rooms.push({ kind: 'carriage', u0, u1, v0: front, v1: back, linings: lined(front, back, u0, u1), storey: 0 });
      for (const storey of storeys) {
        const on = storey === undefined ? {} : { storey };
        plan.rooms.push({ kind: 'front', u0, u1, v0: front, v1: sF, linings: lined(front, sF, u0, u1), ...on }, { kind: 'back', u0, u1, v0: sB, v1: back, linings: lined(sB, back, u0, u1), ...on });
        plan.doors.push({ line: 'u', at: edge[inner], c: front + 1.25, w: 1.1, ...on });
        // (Beside a passage the back rooms are reached from the front rooms: the passage's far end is its stair.)
        if (!atMiddle || broad === 3) plan.doors.push({ line: 'u', at: edge[inner], c: atMiddle ? sB + 0.9 : back - 1.25, w: 1.0, ...on });
        plan.doors.push({ line: 'v', at: spine, c: (u0 + u1) / 2, w: 1.0, ...on });
      }
      bay += side * size;
    }
  }
  return planWings(b, rng, plan);
}

/** The bays a classical building's front doors are in: the middle one, or those it names. */
export const entranceBays = (b: Building): number[] => (b.entrances && b.entrances.length > 1 ? [...b.entrances].sort((p, q) => p - q) : [b.bays >> 1]);
/** How many bays stand at either end of a classical building before its first entrance and its hall (the fewer of the two ends). */
export function freeAtEnds(b: Building): number {
  const doors = entranceBays(b), middle = b.bays >> 1, broad = (d: number) => d === middle && (b.portico || b.bays >= 7);
  return Math.min(doors[0] - (broad(doors[0]) ? 1 : 0), b.bays - 1 - doors[doors.length - 1] - (broad(doors[doors.length - 1]) ? 1 : 0));
}

/**
 * The rooms of a broad classical building with more than one entrance. Each entrance is a hall and a stair: in the middle, where it
 * stands forward or the building is broad, the hall of three bays with the stair hall behind it; elsewhere a passage one bay broad
 * running back to its stair. A carriage way, if there is one, takes the two bays at its end. The bays between are rooms of one to
 * three bays, a front room and a back one, and each opens towards the entrance nearest it, through the rooms between.
 */
function planEntrances(b: Building, rng: Rng, plan: BuildingPlan, g: { edge: number[]; lo: (i: number) => number; hi: (i: number) => number; lined: (v0: number, v1: number, u0: number, u1: number) => [number, number, number, number]; middle: number; broad: number; spine: number; sF: number; sB: number; front: number; back: number }): void {
  const { edge, lo, hi, lined, middle, broad, spine, sF, sB, front, back } = g, { out: OUT, outer: T } = CLASSICAL, bays = b.bays;
  type Unit = { a: number; e: number; kind: 'broad' | 'passage' | 'carriage' | 'rooms' };
  const groups: Unit[] = entranceBays(b).map((d): Unit => (d === middle && broad === 3 ? { a: d - 1, e: d + 2, kind: 'broad' } : { a: d, e: d + 1, kind: 'passage' }));
  if (b.arch && !b.wings?.length && freeAtEnds(b) >= 2) groups.push(b.arch.side < 0 ? { a: 0, e: 2, kind: 'carriage' } : { a: bays - 2, e: bays, kind: 'carriage' });
  groups.sort((p, q) => p.a - q.a);
  // (Where the middle stands forward without a door in it, its rooms are its own: no room runs across its cheeks.)
  const breaks = b.portico && !groups.some((q) => q.kind === 'broad') ? [middle - 1, middle + 2] : [];
  const units: Unit[] = [];
  let at = 0;
  for (const q of [...groups, { a: bays, e: bays, kind: 'rooms' as const }]) {
    while (at < q.a) {
      const stop = Math.min(q.a, ...breaks.filter((k) => k > at)), left = stop - at;
      const take = left <= 3 && rng.chance(0.45) ? left : Math.min(left, rng.pick([1, 2, 2, 3]));
      units.push({ a: at, e: at + take, kind: 'rooms' });
      at += take;
    }
    if (q.e > q.a) { units.push(q); at = q.e; }
  }
  const entrance = (q: Unit) => q.kind === 'broad' || q.kind === 'passage';
  const forward = (q: Unit) => (b.portico && q.a >= middle - 1 && q.e <= middle + 2 ? -OUT + T : front);
  for (const q of units) {
    const u0 = lo(q.a), u1 = hi(q.e);
    if (q.kind === 'broad') {
      plan.rooms.push({ kind: 'hall', u0, u1, v0: forward(q), v1: sF, linings: lined(T, sF, u0, u1) }, { kind: 'stair', u0, u1, v0: sB, v1: back, linings: lined(sB, back, u0, u1) });
      plan.doors.push({ line: 'v', at: spine, c: (u0 + u1) / 2, w: 2.2, tall: true });
    } else if (q.kind === 'passage') plan.rooms.push({ kind: 'passage', u0, u1, v0: front, v1: back, linings: lined(front, back, u0, u1) });
    else if (q.kind === 'carriage') plan.rooms.push({ kind: 'carriage', u0, u1, v0: front, v1: back, linings: lined(front, back, u0, u1), storey: 0 });
  }
  units.forEach((q, k) => {
    if (entrance(q)) return;
    // Towards the nearest entrance.
    let best = -1;
    units.forEach((o, j) => { if (entrance(o) && (best < 0 || Math.abs(j - k) < Math.abs(best - k))) best = j; });
    const dir = best < k ? -1 : 1, next = units[k + dir], wall = edge[dir < 0 ? q.a : q.e], u0 = lo(q.a), u1 = hi(q.e), v0 = forward(q);
    const storeys = q.kind === 'carriage' ? Array.from({ length: b.storeys - 1 }, (_, n) => n + 1) : [undefined];
    for (const storey of storeys) {
      const on = storey === undefined ? {} : { storey };
      plan.rooms.push({ kind: 'front', u0, u1, v0, v1: sF, linings: lined(front, sF, u0, u1), ...on }, { kind: 'back', u0, u1, v0: sB, v1: back, linings: lined(sB, back, u0, u1), ...on });
      plan.doors.push({ line: 'u', at: wall, c: front + 1.25, w: 1.1, ...on });
      // (Beside a passage the back rooms are reached from the front rooms: the passage's far end is its stair.)
      if (next.kind !== 'passage') plan.doors.push({ line: 'u', at: wall, c: next.kind === 'broad' ? sB + 0.9 : back - 1.25, w: 1.0, ...on });
      plan.doors.push({ line: 'v', at: spine, c: (u0 + u1) / 2, w: 1.0, ...on });
    }
  });
}

/**
 * The wings: a row of rooms each, one or two windows long, one opening into the next down the
 * wing's length, and the first into the main block through what was its back wall. That wall
 * stays as thick as it was, so the door through it is deep.
 */
function planWings(b: Building, rng: Rng, plan: BuildingPlan): BuildingPlan {
  const { outer: T, cross: CROSS } = CLASSICAL, W = b.w, D = b.d, IN = T - CLASSICAL.skin;
  for (const wing of b.wings ?? []) {
    const { along } = wingWindows(b, wing), outer = wing.side * (W / 2 - T), inner = wing.side * (W / 2 - wing.width + T);
    const u0 = Math.min(outer, inner), u1 = Math.max(outer, inner), end = D + wing.length - T, door = (u0 + u1) / 2 + wing.side * -0.2;
    const cuts: number[] = [];
    for (let i = 1; i < along.length;) { const take = Math.min(along.length - i, rng.pick([1, 2, 2])); i += take; if (i < along.length) cuts.push((along[i - 1] + along[i]) / 2); }
    const walls = [D + CLASSICAL.skin, ...cuts, end];
    for (let i = 0; i < walls.length - 1; i++) {
      const v0 = i ? walls[i] + CROSS / 2 : walls[0], v1 = i === walls.length - 2 ? walls[i + 1] : walls[i + 1] - CROSS / 2;
      plan.rooms.push({ kind: 'wing', u0, u1, v0, v1, linings: [i ? CROSS / 2 : CLASSICAL.skin, i === walls.length - 2 ? IN : CROSS / 2, IN, IN] });
      if (i) plan.doors.push({ line: 'v', at: walls[i], c: door, w: 1.1 });
    }
    plan.doors.push({ line: 'v', at: D - (T - CLASSICAL.skin) / 2, c: door, w: 1.1, through: T + CLASSICAL.skin });
  }
  return plan;
}

/**
 * The carriage way's arch, where a classical building has one: its middle across the front (`u`), how broad it is, and how high its
 * crown and its springing stand over the ground before the building. It stands between the two windows of the end bays, and as the
 * front's, so the back's, at the same `u`.
 */
export function classicalArch(b: Building): { u: number; w: number; crown: number; spring: number } | null {
  const room = b.plan?.rooms.find((r) => r.kind === 'carriage');
  if (!room) return null;
  const { windows } = classicalFront(b), n = b.arch!.side < 0 ? 0 : b.bays - 2;
  const u = (windows[n] + windows[n + 1]) / 2, w = Math.min(3.3, windows[n + 1] - windows[n] + 0.9, 2 * Math.min(u - room.u0, room.u1 - u) - 0.3), crown = Math.min(CLASSICAL.plinth + b.heights[0] - 0.35, 4.1);
  return { u, w, crown, spring: crown - w / 2 };
}

/** Every stair of a classical building: one behind each entrance. */
export const classicalStairs = (b: Building) => b.plan!.rooms.filter((r) => r.kind === 'stair' || r.kind === 'passage').map((r) => classicalStair(b, r));

/**
 * The stair of a classical building: two flights side by side and a landing between them, the
 * same on every storey, of steps no higher than a hand and a half however high the storey; so a
 * taller storey has a longer flight, and every flight begins where the one below began. It is
 * laid out in measures of its own, `a` along its flights from where the first begins to rise and
 * `e` across them, and `place` turns those into the building's. In a stair hall it lies along
 * the back wall; at the end of a passage it fills the passage's breadth.
 */
export function classicalStair(b: Building, room = b.plan!.rooms.find((r) => r.kind === 'stair' || r.kind === 'passage')!) {
  const broad = room.kind === 'stair';
  const TREAD = 0.24, LANDING = 1.05, START = broad ? 1.2 : 0.3;
  const flights = b.heights.slice(0, -1).map((h) => {
    const steps = Math.ceil(h / 0.17), first = Math.ceil(steps / 2);
    return { steps, first, rise: h / steps, turn: START + first * TREAD };
  });
  const longest = START + Math.max(0, ...flights.map((f) => f.first)) * TREAD + LANDING;
  const across = broad ? 2.2 : room.u1 - room.u0 - 0.1, strip = Math.min(1.1, (across - 0.12) / 2);
  const place = broad
    ? (a: number, e: number) => ({ u: room.u0 + 0.05 + a, v: room.v1 - 0.05 - across + e })
    : (a: number, e: number) => ({ u: room.u0 + 0.05 + e, v: room.v1 - 0.05 - longest + a });
  return { broad, TREAD, LANDING, START, flights, across, strip, place };
}

// ---------------------------------------------------------------------------------------------
// Timber-framed houses.

/** The fixed measures of a timber house: its stone ground walls, its framed walls above, its plinth, the walls between its rooms, and its stair. */
export const TIMBER = { ground: 0.56, wall: 0.3, plinth: 0.3, partition: 0.14, stair: 0.8, riser: 0.22 };

/** The height of a timber house's floors above the ground before the door: the ground floor is the top of its plinth. */
export const timberFloor = (b: Building, storey: number): number => TIMBER.plinth + (storey === 0 ? 0.18 : b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0));

/** Where the front of a storey stands: each stands out over the one below. */
export const timberFront = (b: Building, storey: number): number => -(b.jetty ?? 0.35) * storey;

/** How many bays of framing a wall of a given length has. */
export const timberBays = (length: number): number => Math.max(2, Math.round(length / 1.55));

/**
 * The windows of one storey of a timber house, wall by wall (the front, then round by the right):
 * where each begins and ends along its wall, from the wall's left end as seen from outside. The
 * ground storey has a window or two beside the door and one small one in each other wall; a framed
 * storey has them in whole bays of the frame, on the street as many as the house has bays, at the
 * back one, and at the sides in every other bay.
 */
export function timberWindows(b: Building, storey: number): [number, number][][] {
  const W = b.w, D = b.d - timberFront(b, storey);
  if (storey === 0) {
    const door = W * (b.door ?? 0.24);
    return [[0.2, 0.5, 0.8].filter((c) => Math.abs(c * W - door) > 1.5).map((c): [number, number] => [c * W - 0.55, c * W + 0.55]), [[D / 2 - 0.4, D / 2 + 0.4]], [[W / 2 - 0.4, W / 2 + 0.4]], [[D / 2 - 0.4, D / 2 + 0.4]]];
  }
  return [W, D, W, D].map((L, i) => {
    const bays = timberBays(L), pitch = L / bays, lit = new Set<number>();
    if (i === 0) for (let n = 0; n < b.bays; n++) lit.add(Math.min(bays - 1, Math.floor(((n + 0.5) * bays) / b.bays)));
    else if (i === 2) lit.add(Math.floor(bays / 2));
    else for (let n = 1; n < bays; n += 2) lit.add(n);
    return [...lit].sort((p, q) => p - q).map((n): [number, number] => [n * pitch + 0.2, (n + 1) * pitch - 0.2]);
  });
}

/**
 * The stair of a timber house: straight flights one over another against the side wall of the
 * hall, on the side the door is, each rising towards the back. They are steep, as such stairs
 * are, and all the same length on plan, so that every flight begins over the foot of the one
 * below and each comes up through the floor at the same place.
 */
export function timberStair(b: Building) {
  const side: -1 | 1 = (b.door ?? 0.24) < 0.5 ? -1 : 1, G = TIMBER.ground;
  const v0 = G + 1.2, v1 = v0 + Math.min(2.9, b.d - 1.05 - v0);
  // (`m` is the distance from the outer face of the side wall the stair stands against.)
  const at = (m: number) => side * (b.w / 2 - m), a = at(G), c = at(G + TIMBER.stair);
  const flights = Array.from({ length: b.storeys - 1 }, (_, k) => {
    const height = timberFloor(b, k + 1) - timberFloor(b, k), steps = Math.ceil(height / TIMBER.riser);
    return { steps, rise: height / steps, tread: (v1 - v0) / (steps - 1) };
  });
  return { side, at, u0: Math.min(a, c), u1: Math.max(a, c), v0, v1, flights };
}

/**
 * The plan of a timber house. The door opens into a hall along one side of the house, with the
 * stair in it against the side wall; a framed wall divides it from the room, which has the
 * windows to the street. Upstairs the stair comes up into a landing, broader than the hall below
 * since its wall stands at a post of the frame, and off it are two chambers, one to the street
 * and one to the back, divided at a post of the side wall so that no wall meets a window.
 */
export function planTimber(b: Building): BuildingPlan {
  const { ground: G, wall: T, partition: P } = TIMBER, W = b.w, D = b.d, stair = timberStair(b), left = stair.side < 0;
  const plan: BuildingPlan = { rooms: [], doors: [], walls: { outer: G, spine: P, cross: P } };
  const span = (m0: number, m1: number) => { const a = stair.at(m0), c = stair.at(m1); return { u0: Math.min(a, c), u1: Math.max(a, c) }; };
  // (The walls of a room: front, back, left, right. The hall's outer wall is on the door's side; the room's on the other.)
  const walls = (outer: number, hall: boolean, front = outer, back = outer): [number, number, number, number] => [front, back, hall === left ? outer : P / 2, hall === left ? P / 2 : outer];
  const door = (left ? b.door ?? 0.24 : 1 - (b.door ?? 0.76)) * W, between = door + 0.82;
  plan.rooms.push({ kind: 'hall', ...span(G, between - P / 2), v0: G, v1: D - G, linings: walls(G, true), storey: 0 });
  plan.rooms.push({ kind: 'front', ...span(between + P / 2, W - G), v0: G, v1: D - G, linings: walls(G, false), storey: 0 });
  plan.doors.push({ line: 'u', at: stair.at(between), c: G + 1.65, w: 0.85, storey: 0 });
  for (let storey = 1; storey < b.storeys; storey++) {
    const front = timberFront(b, storey), post = (2 * W) / timberBays(W), bays = timberBays(D - front), cross = front + (Math.round(bays / 2) * (D - front)) / bays;
    plan.rooms.push({ kind: 'passage', ...span(T, post - P / 2), v0: front + T, v1: D - T, linings: walls(T, true), storey });
    plan.rooms.push({ kind: 'front', ...span(post + P / 2, W - T), v0: front + T, v1: cross - P / 2, linings: walls(T, false, T, P / 2), storey });
    plan.rooms.push({ kind: 'back', ...span(post + P / 2, W - T), v0: cross + P / 2, v1: D - T, linings: walls(T, false, P / 2, T), storey });
    plan.doors.push({ line: 'u', at: stair.at(post), c: front + T + 0.65, w: 0.8, storey }, { line: 'u', at: stair.at(post), c: D - T - 0.65, w: 0.8, storey });
  }
  return plan;
}
