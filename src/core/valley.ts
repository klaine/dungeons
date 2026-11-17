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
export function shapeValley(meadow: Place, rng: Rng, house: { x0: number; x1: number; z0?: number } = meadow, free = false): { valley: Valley; middle: (z: number) => number } {
  const round = (x: number) => Math.round(x * 10) / 10;
  // (`front` is the house front, where the meadow begins; the valley's own record begins further north if it has arms.)
  const step = 2, front = meadow.z0, length = meadow.z1 - meadow.z0 + rng.range(95, 150), mouth = Math.round((front + length) / step) * step;
  const mid = (meadow.x0 + meadow.x1) / 2, head = (meadow.x1 - meadow.x0) / 2 + rng.range(5.5, 10);
  const s = rng.range(0, 500), gate = rng.range(7.4, 9.2);
  // It bends: once or twice in its length, and less the nearer the house, which it must stay square to.
  const swing = rng.range(0, 15) * (rng.chance(0.5) ? 1 : -1), wave = rng.range(70, 140), phase = rng.range(0, Math.PI * 2);
  const middle = (z: number) => mid + (swing * (Math.sin(((z - front) / wave) * Math.PI * 2 + phase) - Math.sin(phase)) + (fbm2(z / 46, s, 2) - 0.5) * 12) * smooth((z - meadow.z1 + 4) / 30);
  // Each side has its own breadth, a bay somewhere (more often than not), and its own unevenness.
  const sides = (['w', 'e'] as const).map((_, k) => ({
    full: rng.range(30, 58), open: rng.range(14, 30), close: rng.range(15, 24),
    bay: rng.chance(0.65) ? { at: front + length * rng.range(0.3, 0.8), deep: rng.range(8, 18), long: rng.range(8, 16) } : null,
    seed: s + 40 + k * 91,
  }));
  // And somewhere in the lower half, as often as not, it draws in between two spurs.
  const narrows = rng.chance(0.5) ? { at: front + length * rng.range(0.5, 0.78), by: rng.range(0.3, 0.5), long: rng.range(7, 11) } : null;
  // The ridge the house is built into (ending a little behind the face of the house front): as broad as the head of the valley, or as the house with eight metres to spare either side, whichever is broader.
  const ridge = { x0: round(Math.min(mid - head, house.x0 - 8)), x1: round(Math.max(mid + head, house.x1 + 8)), z: front - 0.5 };
  const edge = [mid - ridge.x0, ridge.x1 - mid];
  // The arms past the house, from a stream of their own: on one side, on both, or now and then on neither.
  const arming = rng.fork('arms'), count = arming.pick([0, 1, 1, 1, 2, 2]), first = arming.chance(0.5) ? 0 : 1;
  const arms = [0, 1].map((k) => (count === 2 || (count === 1 && k === first) ? { length: arming.range(36, 72), width: arming.range(16, 28), seed: arming.range(0, 500) } : null));
  // A house that stands free has the valley all round it: on either side a breadth of open ground, and behind it a bowl that closes some way back.
  const round_ = free && house.z0 !== undefined ? { gap: [arming.range(16, 26), arming.range(16, 26)], back: house.z0 - arming.range(18, 32), seed: arming.range(0, 500) } : null;
  const z0 = round_ ? Math.floor((round_.back - 26) / step) * step : front - Math.ceil(Math.max(0, ...arms.map((q) => (q ? q.length + 4 : 0))) / step) * step;
  const roundAt = (k: number, z: number): number => {
    const base = (k === 0 ? mid - house.x0 : house.x1 - mid) + round_!.gap[k] * (1 + 0.3 * (fbm2(z / 15, round_!.seed + k * 17, 2) - 0.5));
    // (Beside the house it keeps its breadth; behind it, it closes over the last twenty-odd metres, round as the head of a combe.)
    const t = Math.min(1, Math.max(0, (z - z0) / (round_!.back - z0)));
    return base * Math.sqrt(t * (2 - t));
  };
  // How far out from the ridge an arm's side lies at a place along it: nothing at its head, its full breadth by the house front.
  const armAt = (k: number, z: number): number => {
    const q = arms[k];
    if (!q) return 0;
    const t = (z - (front - q.length)) / q.length;
    return t <= 0 ? 0 : q.width * smooth(t / 0.55) * (1 + 0.35 * (fbm2(z / 13, q.seed, 2) - 0.5));
  };
  const half = (side: (typeof sides)[number], z: number, k: number): number => {
    if (z < front) return round_ ? Math.max(0.5, roundAt(k, z)) : edge[k] + armAt(k, z);
    // (Beyond the gap the country opens out again, unevenly, into a broader vale.)
    if (z >= mouth) return gate + Math.min(64, Math.max(0, z - mouth - 3) * 1.25) * (0.75 + 0.6 * fbm2(z / 17, side.seed + 3, 2));
    let w = side.full * (1 + 0.5 * (fbm2(z / 40, side.seed, 2) - 0.5)) + (fbm2(z / 11, side.seed + 7, 2) - 0.5) * 5;
    if (side.bay) w += side.bay.deep * Math.exp(-(((z - side.bay.at) / side.bay.long) ** 2));
    if (narrows) w *= 1 - narrows.by * Math.exp(-(((z - narrows.at) / narrows.long) ** 2));
    // From the corner of the ridge it opens out, or on from the mouth of an arm; to the gap it draws in.
    const start = round_ ? roundAt(k, front - 0.01) : edge[k] + armAt(k, front - 0.01);
    w = Math.max(w, 15, start * 0.9);
    w = start + (w - start) * smooth((z - front - 1.5) / side.open);
    w = gate + (w - gate) * smooth((mouth - z) / side.close);
    return z < meadow.z1 + 2 ? Math.max(w, head, start) : w;
  };
  const valley: Valley = { z0, step, west: [], east: [], mouth, ...(round_ ? {} : { ridge }) };
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

/** How much the floor of an arm of the valley has risen, at `z`, above the ground before the house front (which is at `front`). */
export const armRise = (z: number, front: number): number => 4.5 * smooth((front - 3.35 - z) / 45);

/**
 * The line of the passage that joins a cave in an arm's wall to the cavern under the arm: from
 * inside the cave's chamber out through its side, along the foot of the wall three strides behind
 * it (so that the crag stands over it while it is still shallow), and in to the cavern's outer rim.
 */
export function joinLine(v: Valley, cave: { side: 'w' | 'e'; z: number; r: number }, cavern: { x: number; z: number; rx: number; rz: number; join?: { toward: -1 | 1; run: number } }): [number, number][] {
  const inw = cave.side === 'w' ? 1 : -1, s = cavern.join?.toward ?? 1, run = cavern.join?.run ?? 0;
  const line: [number, number][] = [[edgeAt(v, cave.side, cave.z) - inw * (cave.r - 0.1), cave.z + s * 1.2]];
  for (let d = 1.2 * cave.r + 1, last = 1.2 * cave.r + run; ; d += 3) {
    const at = Math.min(d, last), z = cave.z + s * at;
    line.push([edgeAt(v, cave.side, z) - inw * 3.4, z]);
    if (at === last) break;
  }
  // (It comes into the cavern at the part of its rim that faces the way it comes.)
  const [px, pz] = line[line.length - 1], ux = (px - cavern.x) / cavern.rx, uz = (pz - cavern.z) / cavern.rz, u = Math.hypot(ux, uz) || 1;
  line.push([cavern.x + (ux / u) * (cavern.rx - 1.2), cavern.z + (uz / u) * (cavern.rz - 1.2)]);
  return line;
}
