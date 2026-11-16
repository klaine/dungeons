import { fbm2, Rng } from './rng';
import { Place, Valley } from './site';

/**
 * The shape of the valley. It is not a box. It begins at the house, which stands across the head
 * of it where the two sides come together; it opens out from there, bends, widens into bays and
 * draws in between spurs, and at its foot closes to a gap between two crags, where the track
 * goes out and the country beyond begins. Its two sides are recorded as where each lies at
 * every second metre down its length.
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
  return x > edgeAt(v, 'w', z) && x < edgeAt(v, 'e', z) ? best : -best;
}

/** Whether a point is ground that can be walked on with `margin` metres to spare: between the sides, and not beyond the gap. */
export function walkable(v: Valley, x: number, z: number, margin: number): boolean {
  return z < v.mouth - margin * 0.5 && z > v.z0 && insideOf(v, x, z) > margin;
}

/**
 * Shapes a valley below a house whose forecourt is `meadow`. Returns it and the line down its
 * middle, which is where a track would go if nothing turned it aside.
 */
export function shapeValley(meadow: Place, rng: Rng): { valley: Valley; middle: (z: number) => number } {
  const round = (x: number) => Math.round(x * 10) / 10;
  const step = 2, z0 = meadow.z0, length = meadow.z1 - meadow.z0 + rng.range(60, 98), mouth = Math.round((z0 + length) / step) * step;
  const mid = (meadow.x0 + meadow.x1) / 2, head = (meadow.x1 - meadow.x0) / 2 + rng.range(5.5, 10);
  const s = rng.range(0, 500), gate = rng.range(5.6, 7.4);
  // It bends: once or twice in its length, and less the nearer the house, which it must stay square to.
  const swing = rng.range(0, 15) * (rng.chance(0.5) ? 1 : -1), wave = rng.range(70, 140), phase = rng.range(0, Math.PI * 2);
  const middle = (z: number) => mid + (swing * (Math.sin(((z - z0) / wave) * Math.PI * 2 + phase) - Math.sin(phase)) + (fbm2(z / 46, s, 2) - 0.5) * 12) * smooth((z - meadow.z1 + 4) / 30);
  // Each side has its own breadth, a bay somewhere (more often than not), and its own unevenness.
  const sides = (['w', 'e'] as const).map((_, k) => ({
    full: rng.range(24, 50), open: rng.range(14, 30), close: rng.range(15, 24),
    bay: rng.chance(0.65) ? { at: z0 + length * rng.range(0.3, 0.8), deep: rng.range(7, 15), long: rng.range(7, 13) } : null,
    seed: s + 40 + k * 91,
  }));
  // And somewhere in the lower half, as often as not, it draws in between two spurs.
  const narrows = rng.chance(0.5) ? { at: z0 + length * rng.range(0.5, 0.78), by: rng.range(0.3, 0.5), long: rng.range(7, 11) } : null;
  const half = (side: (typeof sides)[number], z: number): number => {
    // (Beyond the gap the country opens out again, unevenly, into a broader vale.)
    if (z >= mouth) return gate + Math.min(64, Math.max(0, z - mouth - 3) * 1.25) * (0.75 + 0.6 * fbm2(z / 17, side.seed + 3, 2));
    let w = side.full * (1 + 0.5 * (fbm2(z / 40, side.seed, 2) - 0.5)) + (fbm2(z / 11, side.seed + 7, 2) - 0.5) * 5;
    if (side.bay) w += side.bay.deep * Math.exp(-(((z - side.bay.at) / side.bay.long) ** 2));
    if (narrows) w *= 1 - narrows.by * Math.exp(-(((z - narrows.at) / narrows.long) ** 2));
    w = Math.max(w, 15);
    // From the corner of the house it opens out; to the gap it draws in.
    w = head + (w - head) * smooth((z - z0 - 1.5) / side.open);
    w = gate + (w - gate) * smooth((mouth - z) / side.close);
    return z < meadow.z1 + 2 ? Math.max(w, head) : w;
  };
  const count = Math.round((mouth - z0) / step) + 1 + 22;
  const valley: Valley = { z0, step, west: [], east: [], mouth };
  for (let i = 0; i < count; i++) {
    const z = z0 + i * step, c = middle(Math.min(z, mouth + 30));
    valley.west.push(round(c - half(sides[0], z)));
    valley.east.push(round(c + half(sides[1], z)));
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
