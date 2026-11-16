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
  const out = [{ u0: -b.w / 2, u1: b.w / 2, v0: 0, v1: b.d }];
  if (b.style === 'imperial' && b.portico) { const f = classicalFront(b); out.push({ u0: f.standL, u1: f.standR, v0: -CLASSICAL.out, v1: 0 }); }
  for (const g of b.wings ?? []) out.push({ u0: g.side > 0 ? b.w / 2 - g.width : -b.w / 2, u1: g.side > 0 ? b.w / 2 : -b.w / 2 + g.width, v0: b.d - 0.01, v1: b.d + g.length });
  return out;
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
  // A wing: rooms of one, two or three bays; and the other wing its mirror.
  const sizes: number[] = [];
  for (let left = middle - flank; left > 0;) {
    const take = left <= 3 && rng.chance(0.45) ? left : Math.min(left, rng.pick([1, 2, 2, 3]));
    sizes.push(take);
    left -= take;
  }
  for (const side of [-1, 1]) {
    let bay = side < 0 ? middle - flank : middle + flank + 1;
    for (const size of sizes) {
      const first = side < 0 ? bay - size : bay, last = side < 0 ? bay : bay + size;
      const u0 = lo(first), u1 = hi(last), inner = side < 0 ? last : first, atMiddle = side < 0 ? last === middle - flank : first === middle + flank + 1;
      plan.rooms.push({ kind: 'front', u0, u1, v0: front, v1: sF, linings: lined(front, sF, u0, u1) }, { kind: 'back', u0, u1, v0: sB, v1: back, linings: lined(sB, back, u0, u1) });
      plan.doors.push({ line: 'u', at: edge[inner], c: front + 1.25, w: 1.1 });
      // (Beside a passage the back rooms are reached from the front rooms: the passage's far end is its stair.)
      if (!atMiddle || broad === 3) plan.doors.push({ line: 'u', at: edge[inner], c: atMiddle ? sB + 0.9 : back - 1.25, w: 1.0 });
      plan.doors.push({ line: 'v', at: spine, c: (u0 + u1) / 2, w: 1.0 });
      bay += side * size;
    }
  }
  // The wings: a row of rooms each, one or two windows long, one opening into the next down the
  // wing's length, and the first into the main block through what was its back wall. That wall
  // stays as thick as it was, so the door through it is deep.
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
 * The stair of a classical building: two flights side by side and a landing between them, the
 * same on every storey, of steps no higher than a hand and a half however high the storey; so a
 * taller storey has a longer flight, and every flight begins where the one below began. It is
 * laid out in measures of its own, `a` along its flights from where the first begins to rise and
 * `e` across them, and `place` turns those into the building's. In a stair hall it lies along
 * the back wall; at the end of a passage it fills the passage's breadth.
 */
export function classicalStair(b: Building) {
  const room = b.plan!.rooms.find((r) => r.kind === 'stair' || r.kind === 'passage')!, broad = room.kind === 'stair';
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
