import { fbm2, Rng } from './rng';
import { Place, Valley } from './site';

/**
 * The shape of the valley. It is not a box, and the house is not its end. The house is built into
 * the end of a ridge that comes down into the valley from the north; on either side of the ridge,
 * or on one, the valley runs on past the house as an arm, to close at a head of its own.
 * Southward from the house it opens out, bends, widens into bays and draws in between spurs, and
 * at its foot closes to a gap between two crags, where the track goes out and the country beyond
 * begins. Its two sides are recorded as where each lies at every second metre down its length.
 */

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** Where one side of the valley lies at `z`: the line the rock rises from. Beyond the ends of what is recorded it runs straight on. */
export function edgeAt(v: Valley, side: 'w' | 'e', z: number): number {
  const line = side === 'w' ? v.west : v.east, at = Math.min(line.length - 1, Math.max(0, (z - v.z0) / v.step)), i = Math.min(line.length - 2, Math.floor(at));
  return line[i] + (line[i + 1] - line[i]) * (at - i);
}

/** How much the side bears in or out as one goes down the valley: metres across for each metre along. */
export function slantAt(v: Valley, side: 'w' | 'e', z: number): number {
  return (edgeAt(v, side, z + v.step) - edgeAt(v, side, z - v.step)) / (2 * v.step);
}

/**
 * How far a point is from the nearer side of the valley: more than nothing between the two
 * sides, less outside them. The country beyond the gap counts as between them, since the sides
 * run on out there; whether a point can be walked to is another question: see `walkable`.
 */
export function insideOf(v: Valley, x: number, z: number): number {
  let best = Infinity;
  // (The ridge the house stands on is not valley: a point is as far inside as it is from the ridge's sides, if that is nearer.)
  const r = v.ridge, onRidge = !!r && z < r.z && x > r.x0 && x < r.x1;
  if (r) for (const rx of [r.x0, r.x1]) best = Math.min(best, Math.hypot(x - rx, Math.max(0, z - r.z)));
  const n = v.west.length, i0 = Math.max(0, Math.floor((z - v.z0) / v.step) - 40), i1 = Math.min(n - 2, i0 + 80);
  for (const line of [v.west, v.east]) {
    for (let i = i0; i <= i1; i++) {
      const az = v.z0 + i * v.step, ax = line[i], bx = line[i + 1] - ax, t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * v.step) / (bx * bx + v.step * v.step)));
      best = Math.min(best, Math.hypot(x - ax - bx * t, z - az - v.step * t));
    }
    // (Beyond either end each side runs straight on.)
    if (z < v.z0) best = Math.min(best, Math.abs(x - line[0]));
    if (z > v.z0 + (n - 1) * v.step) best = Math.min(best, Math.abs(x - line[n - 1]));
  }
  return x > edgeAt(v, 'w', z) && x < edgeAt(v, 'e', z) && !onRidge ? best : -best;
}

/** Whether a point is ground that can be walked on with `margin` metres to spare: between the sides, and not beyond the gap. */
export function walkable(v: Valley, x: number, z: number, margin: number): boolean {
  return z < v.mouth - margin * 0.5 && z > v.z0 && insideOf(v, x, z) > margin;
}

/**
 * Shapes a valley below a house whose forecourt is `meadow`. Returns it and the line down its
 * middle, which is where a track would go if nothing turned it aside.
 */
export function shapeValley(meadow: Place, rng: Rng, house: { x0: number; x1: number } = meadow): { valley: Valley; middle: (z: number) => number } {
  const round = (x: number) => Math.round(x * 10) / 10;
  // (`front` is the house front, where the meadow begins; the valley's own record begins further north if it has arms.)
  const step = 2, front = meadow.z0, length = meadow.z1 - meadow.z0 + rng.range(60, 98), mouth = Math.round((front + length) / step) * step;
  const mid = (meadow.x0 + meadow.x1) / 2, head = (meadow.x1 - meadow.x0) / 2 + rng.range(5.5, 10);
  const s = rng.range(0, 500), gate = rng.range(5.6, 7.4);
  // It bends: once or twice in its length, and less the nearer the house, which it must stay square to.
  const swing = rng.range(0, 15) * (rng.chance(0.5) ? 1 : -1), wave = rng.range(70, 140), phase = rng.range(0, Math.PI * 2);
  const middle = (z: number) => mid + (swing * (Math.sin(((z - front) / wave) * Math.PI * 2 + phase) - Math.sin(phase)) + (fbm2(z / 46, s, 2) - 0.5) * 12) * smooth((z - meadow.z1 + 4) / 30);
  // Each side has its own breadth, a bay somewhere (more often than not), and its own unevenness.
  const sides = (['w', 'e'] as const).map((_, k) => ({
    full: rng.range(24, 50), open: rng.range(14, 30), close: rng.range(15, 24),
    bay: rng.chance(0.65) ? { at: front + length * rng.range(0.3, 0.8), deep: rng.range(7, 15), long: rng.range(7, 13) } : null,
    seed: s + 40 + k * 91,
  }));
  // And somewhere in the lower half, as often as not, it draws in between two spurs.
  const narrows = rng.chance(0.5) ? { at: front + length * rng.range(0.5, 0.78), by: rng.range(0.3, 0.5), long: rng.range(7, 11) } : null;
  // The ridge the house is built into (ending a little behind the face of the house front): as broad as the head of the valley, or as the house with eight metres to spare either side, whichever is broader.
  const ridge = { x0: round(Math.min(mid - head, house.x0 - 8)), x1: round(Math.max(mid + head, house.x1 + 8)), z: front - 0.5 };
  const edge = [mid - ridge.x0, ridge.x1 - mid];
  // The arms past the house, from a stream of their own: on one side, on both, or now and then on neither.
  const arming = rng.fork('arms'), count = arming.pick([0, 1, 1, 1, 2, 2]), first = arming.chance(0.5) ? 0 : 1;
  const arms = [0, 1].map((k) => (count === 2 || (count === 1 && k === first) ? { length: arming.range(30, 62), width: arming.range(15, 26), seed: arming.range(0, 500) } : null));
  const z0 = front - Math.ceil(Math.max(0, ...arms.map((q) => (q ? q.length + 4 : 0))) / step) * step;
  // How far out from the ridge an arm's side lies at a place along it: nothing at its head, its full breadth by the house front.
  const armAt = (k: number, z: number): number => {
    const q = arms[k];
    if (!q) return 0;
    const t = (z - (front - q.length)) / q.length;
    return t <= 0 ? 0 : q.width * smooth(t / 0.55) * (1 + 0.35 * (fbm2(z / 13, q.seed, 2) - 0.5));
  };
  const half = (side: (typeof sides)[number], z: number, k: number): number => {
    if (z < front) return edge[k] + armAt(k, z);
    // (Beyond the gap the country opens out again, unevenly, into a broader vale.)
    if (z >= mouth) return gate + Math.min(64, Math.max(0, z - mouth - 3) * 1.25) * (0.75 + 0.6 * fbm2(z / 17, side.seed + 3, 2));
    let w = side.full * (1 + 0.5 * (fbm2(z / 40, side.seed, 2) - 0.5)) + (fbm2(z / 11, side.seed + 7, 2) - 0.5) * 5;
    if (side.bay) w += side.bay.deep * Math.exp(-(((z - side.bay.at) / side.bay.long) ** 2));
    if (narrows) w *= 1 - narrows.by * Math.exp(-(((z - narrows.at) / narrows.long) ** 2));
    // From the corner of the ridge it opens out, or on from the mouth of an arm; to the gap it draws in.
    const start = edge[k] + armAt(k, front - 0.01);
    w = Math.max(w, 15, start * 0.9);
    w = start + (w - start) * smooth((z - front - 1.5) / side.open);
    w = gate + (w - gate) * smooth((mouth - z) / side.close);
    return z < meadow.z1 + 2 ? Math.max(w, head, start) : w;
  };
  const valley: Valley = { z0, step, west: [], east: [], mouth, ridge };
  for (let i = 0, n = Math.round((mouth - z0) / step) + 1 + 22; i < n; i++) {
    const z = z0 + i * step, c = z < front ? mid : middle(Math.min(z, mouth + 30));
    valley.west.push(round(c - half(sides[0], z, 0)));
    valley.east.push(round(c + half(sides[1], z, 1)));
  }
  return { valley, middle };
}

/** The shape of a valley that was recorded only as a box, as they once all were: straight sides, drawing in at its foot to a gap. */
export function boxValley(g: { x0: number; x1: number; z0: number; z1: number }): Valley {
  const step = 2, mouth = g.z1, mid = (g.x0 + g.x1) / 2, v: Valley = { z0: g.z0, step, west: [], east: [], mouth };
  for (let z = g.z0; z <= mouth + 44; z += step) {
    const half = z >= mouth ? 6.5 + Math.min(64, Math.max(0, z - mouth - 3) * 1.25) : 6.5 + ((g.x1 - g.x0) / 2 - 6.5) * smooth((mouth - z) / 14);
    v.west.push(mid - half);
    v.east.push(mid + half);
  }
  return v;
}

/**
 * The arms of a valley that run on past the house: on which side, where each one's head is (the
 * last place, going north, where it is still a stride or two across), and the line up its middle.
 */
export function armsOf(v: Valley): { side: 'w' | 'e'; head: number; middle: (z: number) => number }[] {
  const r = v.ridge;
  if (!r) return [];
  const out: { side: 'w' | 'e'; head: number; middle: (z: number) => number }[] = [];
  for (const side of ['w', 'e'] as const) {
    const wide = (z: number) => (side === 'w' ? r.x0 - edgeAt(v, 'w', z) : edgeAt(v, 'e', z) - r.x1);
    if (wide(r.z - 4) < 8) continue;
    let head = r.z - 4;
    while (head > v.z0 && wide(head - 2) > 4) head -= 2;
    out.push({ side, head, middle: (z: number) => (side === 'w' ? (edgeAt(v, 'w', z) + r.x0) / 2 : (edgeAt(v, 'e', z) + r.x1) / 2) });
  }
  return out;
}
