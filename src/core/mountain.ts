import { fbm2, Rng } from './rng';
import { Mountain, Place, Site } from './site';
import { turnBetween } from './island';
import { erodedFbmLod, fbmd, HeightField, landDetail, ridgedFbm, wearByFrost, wearByWater } from './terrain';

/**
 * The top of a mountain above a sea of cloud. Where an island is land inside a coast that falls
 * to the sea, a mountain top is ground inside a rim that falls in precipices to slopes going
 * down into cloud. The house is a hospice on a shoulder near the south edge of the top, its
 * front towards a ridge that runs out from the rim and down into the cloud: the way up that
 * ridge is how anyone comes, and the player arrives at its foot, at the top of the cloud or in
 * it. The summit rises behind the house, on the north side, and a path climbs to a cairn on it.
 * Far off, other peaks stand out of the cloud.
 *
 * Everything here is in the site document's terms; the builder realises it. The plain shape of
 * the land is given here too (`landAt`), so that what is placed on it and what is built of it agree.
 */

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const TAU = Math.PI * 2;
const N = 96;

/** Interpolated round the ring of directions the rim is given for. */
function ringAt(table: number[], angle: number): number {
  const n = table.length, a = ((angle / TAU) * n % n + n) % n, i = Math.floor(a), t = a - i, u = t * t * (3 - 2 * t);
  return table[i % n] + (table[(i + 1) % n] - table[i % n]) * u;
}

/** How far the top of the precipice lies from the middle at a bearing. */
export function rimAt(m: Mountain, angle: number): number {
  let r = ringAt(m.rim, angle);
  // Buttresses and gullies: fins of rock standing out from the line, sharp-crested, with rounded bays between them, and lesser ribs on those.
  if (m.ribs) {
    const k = 120 / m.ribs.apart, c = Math.cos(angle), s = Math.sin(angle);
    const fin = 1 - Math.abs(fbm2(c * k + m.ribs.seed, s * k - m.ribs.seed, 2, 37) * 2 - 1);
    r += m.ribs.out * (fin * fin * 1.25 - 0.36) + m.ribs.out * 0.3 * (fbm2(c * k * 2.9 - m.ribs.seed, s * k * 2.9, 2, 41) - 0.5);
  }
  return r;
}

/** A soft maximum: the greater of two, with the corner where they meet rounded over `k`. */
function softMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Where a point lies against the ridge: how far from its crest line, and how far along it (0 at the rim, 1 at its end; less or more beyond). */
export function onSpur(m: Mountain, x: number, z: number): { off: number; t: number; y: number; d: number } {
  const crest = m.spur.crest;
  if (!crest) {
    // (Before its line is laid: straight from its head to its end.)
    const [ax, az] = m.spur.from, [bx, bz] = m.spur.to, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = ((x - ax) * dx + (z - az) * dz) / l2, tc = clamp01(t);
    return { off: Math.hypot(x - ax - dx * tc, z - az - dz * tc), t, y: m.spur.y0 + (m.spur.y1 - m.spur.y0) * tc, d: tc * Math.sqrt(l2) };
  }
  // Its line is indexed once in squares of the ground, with how far along it each point is, so that only the lengths of it near a point are looked at.
  let index = CRESTS.get(crest);
  if (!index) {
    const cells = new Map<number, number[]>(), C = 16, REACH = 96, along = [0];
    for (let k = 1; k < crest.length; k++) along.push(along[k - 1] + Math.hypot(crest[k][0] - crest[k - 1][0], crest[k][1] - crest[k - 1][1]));
    for (let k = 0; k < crest.length - 1; k++) {
      const [ax, az] = crest[k], [bx, bz] = crest[k + 1];
      for (let i = Math.floor((Math.min(ax, bx) - REACH) / C); i <= Math.floor((Math.max(ax, bx) + REACH) / C); i++) for (let j = Math.floor((Math.min(az, bz) - REACH) / C); j <= Math.floor((Math.max(az, bz) + REACH) / C); j++) {
        const key = i * 100003 + j, list = cells.get(key);
        if (list) list.push(k); else cells.set(key, [k]);
      }
    }
    CRESTS.set(crest, (index = { cells, C, along, total: along[along.length - 1] || 1 }));
  }
  const near = index.cells.get(Math.floor(x / index.C) * 100003 + Math.floor(z / index.C));
  // (Far from it, it is as if it were not there.)
  if (!near) return { off: 1e4, t: 0, y: m.spur.y0, d: 0 };
  let off = Infinity, t = 0, y = 0;
  for (const k of near) {
    const [ax, az, ay] = crest[k], [bx, bz, by] = crest[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
    if (d < off) { off = d; y = ay + (by - ay) * u; t = (index.along[k] + (index.along[k + 1] - index.along[k]) * u) / index.total; }
  }
  return { off, t, y, d: t * index.total };
}
const CRESTS = new WeakMap<object, { cells: Map<number, number[]>; C: number; along: number[]; total: number }>();

/** The point of the ridge's crest a share `t` of the way along it, 0 at its head to 1 at its end; and which way it runs there. */
export function crestPoint(m: Mountain, t: number): { x: number; z: number; y: number; heading: number } {
  const crest = m.spur.crest;
  if (!crest) { const [ax, az] = m.spur.from, [bx, bz] = m.spur.to; return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: m.spur.y0 + (m.spur.y1 - m.spur.y0) * t, heading: Math.atan2(bz - az, bx - ax) }; }
  const f = clamp01(t) * (crest.length - 1), k = Math.min(crest.length - 2, Math.floor(f)), u = f - k, [ax, az, ay] = crest[k], [bx, bz, by] = crest[k + 1];
  return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, y: ay + (by - ay) * u, heading: Math.atan2(bz - az, bx - ax) };
}

/** Half the breadth of the ridge's top at a point along it: it narrows towards its end, and its sides are not straight. */
function spurHalf(m: Mountain, x: number, z: number, t: number): number {
  // (And at one place along it it broadens into a shoulder some strides wider, where there is room to build.)
  const shoulder = m.spur.swell === undefined ? 0 : 9 * Math.exp(-(((t - m.spur.swell) / 0.055) ** 2));
  // (Nor is it one breadth all along: in one place a knife's edge a few strides across, in the next a shoulder with room to stand about.)
  const breadth = 0.52 + 1.0 * fbm2(t * 4.6 + m.spur.from[0] * 0.013, m.spur.from[1] * 0.013, 2, 53);
  return (m.spur.width / 2) * (1 - 0.2 * clamp01(t)) * breadth + (fbm2(x / 21 + 7.3, z / 21 - 2.1, 2, 31) - 0.5) * 3 + shoulder;
}

/** How far a point is inside the top (more than nothing on it, less beyond the precipice), measured from the middle's rim only. */
function insideTop(m: Mountain, x: number, z: number): number {
  const dx = x - m.x, dz = z - m.z;
  return rimAt(m, Math.atan2(dz, dx)) - Math.hypot(dx, dz);
}

/**
 * How far a point is inside the ground that stands above the precipices, the ridge included:
 * more than nothing on it, less beyond. Roughly a distance in metres near the edge.
 */
export function inside(m: Mountain, x: number, z: number): number {
  const s = onSpur(m, x, z);
  return softMax(insideTop(m, x, z), spurHalf(m, x, z, s.t) - s.off, 8);
}

/** How high the summits stand at a point, over the forecourt's floor: steep and broken, not domes. */
function summits(m: Mountain, x: number, z: number): number {
  let h = 0;
  // The mountain's shoulders: the whole top rises towards the summit, broad and uneven, so that it is a slope and not a table.
  const s = m.peaks[0];
  if (s) {
    const t = Math.max(0, 1 - Math.hypot(x - s.x, z - s.z) / (s.r * 3.2));
    h = s.height * 0.5 * t * t * (3 - 2 * t) * (0.8 + 0.4 * fbm2(x / 47 + 5.1, z / 47, 3, 41));
    // (They fall away towards the house, which stands in a saddle of them, as a hospice stands on a pass: not in a pit cut into them.)
    h *= 0.2 + 0.8 * smooth((outside(m.level, x, z) - 4) / 50);
  }
  for (const p of m.peaks) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r * 1.25) continue;
    // A horn is not a cone. Frost cuts a peak back on three or four sides into faces, each nearly a plane, and where two faces meet
    // there is a ridge running down from the top. So its height is reckoned face by face: on each, how far out from the top a point
    // lies along that face's own bearing, at that face's own steepness; the face a point is on is the one that has it lowest. The
    // faces are not alike, nor the ridges evenly spaced, and the top is not over the middle.
    const k = Math.abs(Math.round(p.x * 7.13 + p.z * 3.71)), faces = 3 + (k % 2), turn = ((k * 0.618) % 1) * Math.PI * 2;
    const ox = x - p.x - p.r * 0.08 * Math.cos(turn * 1.7), oz = z - p.z - p.r * 0.08 * Math.sin(turn * 1.7);
    let out = 0;
    for (let i = 0; i < faces; i++) {
      const a = turn + (i / faces) * Math.PI * 2 + 0.35 * Math.sin(k * 1.3 + i * 2.1), steep = 0.78 + 0.34 * ((k * 0.37 + i * 0.61) % 1);
      out = Math.max(out, (ox * Math.cos(a) + oz * Math.sin(a)) / (p.r * steep));
    }
    const t = Math.max(0, 1 - out);
    if (t <= 0) continue;
    // (Its faces broken by ribs and gullies running down them, and steepening towards the top, as a horn does.)
    const rib = 1 - Math.abs(fbm2(x / 13 + p.x * 0.01, z / 13 - p.z * 0.01, 2, 23) * 2 - 1);
    const shape = 0.62 * t + 0.38 * t * t * t;
    // (The summit's horn stands on its shoulders, and is half its height; a lesser peak stands by itself.)
    const horn = (p === s ? p.height * 0.5 : p.height) * shape * (0.9 + 0.16 * rib);
    h = p === s ? h + horn : Math.max(h, horn);
  }
  return h;
}

/**
 * How far the ground falls below the edge of the top at `out` metres beyond it: first the
 * precipice, `drop` high, then a slope of broken rock and scree going on down into the cloud.
 */
function fall(out: number, drop: number, phase = 0.5): number {
  if (out <= 0) return 0;
  const w = 2.5 + drop * 0.2;
  // Below the precipice the mountain goes down in tiers, as bedded rock does: a wall, a ledge sloping outward, another wall. Where
  // the tiers come differs from one side of the mountain to another (`phase`).
  const BENCH = 15, tier = (t: number) => { const k = Math.floor(t), f = t - k; return k + smooth((f - 0.42) / 0.26); };
  const s = Math.max(0, out - w * 0.5), stepped = (tier(s / BENCH + phase * 3) - tier(phase * 3)) * BENCH * 1.22 + s * 0.14;
  return drop * smooth(out / w) + stepped + Math.max(0, out - 50) * 0.6;
}

/**
 * How far the land has fallen at a distance `out` beyond an edge, for a mountain whose land is worn: the precipice, as `fall` has it,
 * and under it not tiers going down at one slope for ever, but a flank steep at first and easing out towards the valleys, as a
 * mountain's flanks do. How far out it reaches differs from bearing to bearing and from place to place: far out along a spur,
 * close in at the head of a bay; so the mountain's foot is not a ring. The water and the frost do the rest.
 */
function wornFall(m: Mountain, out: number, drop: number, x: number, z: number): number {
  if (out <= 0) return 0;
  const seed = m.terrain!.seed, w = 2.5 + drop * 0.2, b = Math.atan2(z - m.z, x - m.x);
  // (Some eight hundred metres from the top to the valleys, over one to three kilometres: as steep as two in one under the precipice
  // at the head of a bay, as one in one on a spur, and easing out below.)
  const spurs = fbmd(Math.cos(b) * 1.6 + 5.1, Math.sin(b) * 1.6 - 2.7, 3, seed + 51), wander = fbmd(x / 520, z / 520, 3, seed + 53);
  const reach = 560 * Math.min(1.9, Math.max(0.45, 1 + 1.6 * spurs + 0.7 * wander));
  const below = Math.max(0, out - w * 0.5);
  return drop * smooth(out / w) + 820 * (1 - Math.exp(-below / reach)) + below * 0.04;
}

const TORS = new WeakMap<object, { cells: Map<number, NonNullable<Mountain['tors']>>; C: number; count: number }>();
/** How high the tors and the rock teeth stand at a point: knobs of bare rock, steep-sided, as frost leaves the harder beds. */
function torsAt(m: Mountain, x: number, z: number): number {
  if (!m.tors?.length) return 0;
  // (They are looked up by the square of ground a point is in: there are scores of them, and this is asked millions of times.)
  let grid = TORS.get(m.tors);
  if (!grid || grid.count !== m.tors.length) {
    const cells = new Map<number, NonNullable<Mountain['tors']>>(), C = 12;
    for (const t of m.tors) {
      const reach = t.r * 1.6;
      for (let i = Math.floor((t.x - reach) / C); i <= Math.floor((t.x + reach) / C); i++) for (let j = Math.floor((t.z - reach) / C); j <= Math.floor((t.z + reach) / C); j++) {
        const key = i * 100003 + j, list = cells.get(key);
        if (list) list.push(t); else cells.set(key, [t]);
      }
    }
    TORS.set(m.tors, (grid = { cells, C, count: m.tors.length }));
  }
  const near = grid.cells.get(Math.floor(x / grid.C) * 100003 + Math.floor(z / grid.C));
  if (!near) return 0;
  let h = 0;
  for (const t of near) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d >= t.r * 1.6) continue;
    // A tooth (taller than it is broad) is a fin: a blade of rock standing on edge, its crest notched. A tor is a knob. Either stands
    // in beds: its height comes in steps the thickness of a bed, so its sides are ledges and little walls and not a smooth mound.
    const tooth = t.height > t.r * 1.4, turn = (t.x * 12.9898 + t.z * 78.233) % Math.PI, c = Math.cos(turn), s = Math.sin(turn);
    const along = (x - t.x) * c + (z - t.z) * s, across = -(x - t.x) * s + (z - t.z) * c, e = tooth ? Math.hypot(along / 1.3, across * 1.9) : d;
    if (e >= t.r) continue;
    const notch = tooth ? 0.5 + 0.75 * (1 - Math.abs(fbm2(along * 0.55 + t.x, t.z, 2, 47) * 2 - 1)) : 1;
    const raw = t.height * Math.pow(1 - e / t.r, tooth ? 0.42 : 0.5) * (0.65 + 0.7 * fbm2(x / 2.7 + t.x, z / 2.7 - t.z, 2, 19)) * notch;
    const BED = 1.05, k = Math.floor(raw / BED), f = raw / BED - k;
    h += (k + smooth((f - 0.3) / 0.4)) * BED * 0.75 + raw * 0.25;
  }
  return h;
}

const outside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The nearest point of a line of points `[x, z, y]` to a point: how far off it is, and the height
 * the line has there. Nothing is looked for further off than `reach`.
 */
export function nearestOn(line: [number, number, number][], x: number, z: number, reach: number): { off: number; y: number } {
  let index = INDEXES.get(line);
  if (!index || index.reach < reach) {
    const cells = new Map<number, number[]>(), C = 8;
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1];
      for (let i = Math.floor((Math.min(ax, bx) - reach) / C); i <= Math.floor((Math.max(ax, bx) + reach) / C); i++) for (let j = Math.floor((Math.min(az, bz) - reach) / C); j <= Math.floor((Math.max(az, bz) + reach) / C); j++) {
        const key = i * 100003 + j, list = cells.get(key);
        if (list) list.push(k); else cells.set(key, [k]);
      }
    }
    index = { cells, reach, C };
    INDEXES.set(line, index);
  }
  let off = Infinity, y = 0;
  const near = index.cells.get(Math.floor(x / index.C) * 100003 + Math.floor(z / index.C));
  if (!near) return { off, y };
  for (const k of near) {
    const [ax, az, ay] = line[k], [bx, bz, by] = line[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < off) { off = d; y = ay + (by - ay) * t; }
  }
  return { off, y };
}
const INDEXES = new WeakMap<[number, number, number][], { cells: Map<number, number[]>; reach: number; C: number }>();

/**
 * The plain shape of the land: the top, the ridge, and the slopes below them going down into the
 * cloud. The builder wears the precipices back from this and carves them, so where they stand
 * differs from it by a stride or two. `floor` is the forecourt's level. `levelled` says whether
 * what has been made on the land (the ground levelled for the house, the way, the climb, the
 * cairn's platform) is to be counted; while it is being laid out, it is not yet.
 */
export function landAt(m: Mountain, floor: number, x: number, z: number, levelled = true): number {
  // The land's own shape: the plain shape below, or, if this mountain's land is worn, the worn lattice made from it (blended back
  // into the plain shape at the lattice's edge, which is far out and deep in the cloud).
  // Beyond that lattice, once the country round about has been laid out, the mountain's lower flanks are the country's: worn with
  // it, on its finer lattice. (Before then, while the top is being laid out, its plain shape stands for them.)
  const field = m.terrain ? fieldOf(m, floor) : null;
  const below = (bx: number, bz: number) => (field && m.range.length ? nearCountryOf(m, floor).smoothAt(bx, bz) : baseLand(m, floor, bx, bz));
  let y: number;
  if (field && field.holds(x, z)) {
    const edge = Math.min(x - field.x0, z - field.z0, field.x0 + (field.nx - 1) * field.cell - x, field.z0 + (field.nz - 1) * field.cell - z);
    y = edge > 60 ? field.at(x, z) : below(x, z) + (field.at(x, z) - below(x, z)) * smooth(edge / 60);
    // (Deep under the cloud, where nothing has been laid out, the mountain's lattice is joined to the country it stands in: else, in
    // the corners of that lattice, it would go down below the valley floors about it.)
    if (m.range.length && y < m.deck - 60) y += (softMax(y, below(x, z), 30) - y) * smooth((m.deck - 60 - y) / 40);
  } else y = below(x, z);
  // The cleft across the ridge: a gap cut clean across it, steep-walled, where a band of weaker rock has gone; the bridge is over it.
  const notch = m.spur.notch;
  let cleft = 0;
  if (notch) { const s = onSpur(m, x, z); if (s.off < 60) cleft = notch.deep * (1 - smooth((Math.abs(s.d - notch.at) - notch.wide * 0.28) / (notch.wide * 0.24))); }
  y -= cleft;
  return made(m, floor, x, z, y, levelled, cleft);
}

/** The plain shape of the land, without the cleft and without what is made on it. */
function baseLand(m: Mountain, floor: number, x: number, z: number): number {
  // The top: rolling, broken ground, more roughly the higher it stands, with the summits on it;
  // it rounds over a little towards the precipice before it falls.
  const dTop = insideTop(m, x, z);
  let top = floor + summits(m, x, z) + (fbm2(x / 40 + 3.1, z / 40 - 1.7, 3, 7) - 0.5) * 8 + (fbm2(x / 11, z / 11, 2, 9) - 0.5) * 1.3;
  top -= 9 * (1 - smooth(dTop / 45));
  top = floor + (top - floor) * smooth((outside(m.level, x, z) - 2) / 16);
  const bearing = Math.atan2(z - m.z, x - m.x);
  const main = top - (m.terrain ? wornFall(m, -dTop, ringAt(m.drop, bearing), x, z) : fall(-dTop, ringAt(m.drop, bearing), fbm2(Math.cos(bearing) * 1.7 + m.x * 0.01, Math.sin(bearing) * 1.7 + m.z * 0.01, 2, 43)));
  // The ridge: its crest falls from the rim to its end, and its sides fall away from the crest,
  // and then over its own lesser precipices.
  const s = onSpur(m, x, z), tc = clamp01(s.t), half = spurHalf(m, x, z, s.t);
  const crest = s.y + (fbm2(x / 17 + 1.3, z / 17, 2, 5) - 0.5) * 2.4 * smooth(s.t / 0.2);
  const ridge = crest - 4.5 * Math.min(1, s.off / Math.max(half, 1)) ** 1.6 - (m.terrain ? wornFall(m, s.off - half, 14 + 12 * tc, x, z) : fall(s.off - half, 14 + 12 * tc));
  return softMax(main, ridge, 4);
}

/** The land with the tors on it, and, if `levelled`, with what has been made on it: the ways cut and made up, the platforms levelled. */
function made(m: Mountain, floor: number, x: number, z: number, y: number, levelled: boolean, cleft: number): number {
  const notch = m.spur.notch;
  if (!levelled) y += torsAt(m, x, z);
  if (levelled) {
    // The way is cut and made up to its own level, across a mule's breadth and a little more, and eased into the land beside it.
    if (m.way) {
      const w = nearestOn(m.way, x, z, 9);
      // (Not across the cleft, which the way goes over by its bridge: the ground is not made up to it there.)
      if (w.off < 9) y += (w.y - y) * (1 - smooth((w.off - 2.3) / 6)) * (notch ? 1 - smooth(cleft / (notch.deep * 0.12)) : 1);
    }
    // A little platform on the summit for the cairn and whoever stands by it. (Made before the climb, which comes up onto it: where
    // the two meet, the climb's own level holds, or its last strides would end at a wall.)
    if (m.cairn) { const w = 1 - smooth((Math.hypot(x - m.cairn.x, z - m.cairn.z) - 2.8) / 2.6); y += (m.cairn.y - y) * w; }
    // The climb goes up a ridge: the path is on its crest, a couple of strides broad, and the
    // ground falls away from it on both sides, built up where the land lies lower and cut back
    // where it stands higher. (Not beside the house, where the climb starts on the level ground.)
    // (The scramble too, the more sharply: its ridge is an arête, falling away steeply on either hand.)
    for (const [line, fall2] of [[m.climb, 0.5], [m.scramble?.line, 0.78]] as const) {
      if (!line) continue;
      const w = nearestOn(line, x, z, 16);
      if (w.off < 16) {
        const rising = smooth((w.y - floor - 1) / 6);
        const crest = w.y - fall2 * Math.pow(Math.max(0, w.off - 1.4), 1.3);
        const near = 1 - smooth((w.off - 1.5) / 2.2), ridged = (1 - smooth((w.off - 1.5) / 13)) * rising;
        let k = Math.max(near, crest > y ? ridged : ridged * 0.55);
        // (Where the scramble leaves the climb, the climb's own ground is left as it is, or the fork would cut a step across it.)
        if (line !== m.climb && m.climb) k *= smooth((nearestOn(m.climb, x, z, 8).off - 2.2) / 4);
        y += ((w.off < 1.5 ? w.y : crest) - y) * k;
      }
    }
    // (The tors and the teeth of rock beside the ways stand as they are: the ways were laid clear of them.)
    y += torsAt(m, x, z);
    // Level ground for the shelter on the ridge.
    if (m.shelter) { const w = 1 - smooth((Math.hypot(x - m.shelter.x, z - m.shelter.z) - 3.4) / 3); y += (m.shelter.y - y) * w; }
    // The landings on the climb: level ground at the bends, and a crag standing up beside each on the inner side.
    for (const l of m.landings ?? []) {
      const d = Math.hypot(x - l.x, z - l.z);
      // (A widening of the path, at the path's own level beside it, so that it rises with the path and leaves no step in it.)
      if (d < l.r + 3) { const level = m.climb ? nearestOn(m.climb, x, z, 16).y : l.y; y += ((Number.isFinite(level) ? level : l.y) - y) * (1 - smooth((d - l.r) / 3)); }
      const dc = Math.hypot(x - l.cx, z - l.cz);
      if (dc < l.cr) {
        const t = 1 - dc / l.cr, rough = 0.75 + 0.5 * fbm2(x / 3.1 + l.cx, z / 3.1, 2, 17);
        y = Math.max(y, l.y - 1 + (l.height + 1) * Math.pow(t, 0.55) * rough);
      }
    }
    // The gallery way, wherever it is open to the sky: a ledge three strides broad, cut into the face
    // and built out where the face falls away, to its own level, with the rock standing sheer behind it.
    // (Its tunnels are not the land's shape: the builder carves them.)
    // (Where it comes in to the climb, alongside it for a few strides, the climb's level holds: the two meet at one level where they
    // join, and a ledge cut to the gallery's level beside the rising climb would leave a step across it.)
    if (m.gallery) for (const run of galleryRuns(m.gallery).open) {
      const w = nearestOn(run, x, z, 4);
      if (w.off < 2.5) y += (w.y - y) * (1 - smooth((w.off - 1.5) / 0.9)) * (m.climb ? smooth((nearestOn(m.climb, x, z, 6).off - 1.6) / 1.6) : 1);
    }
    // (But where a tunnel runs close behind the face, the rock on its outer side may stand lower than its floor: there the
    // land is made up to the floor's level, never cut down to it, so that the floor is whole and the rock over it is left.)
    if (m.gallery) for (const run of galleryRuns(m.gallery).under) {
      const w = nearestOn(run, x, z, 4);
      if (w.off < 2.5 && y < w.y) y += (w.y - y) * (1 - smooth((w.off - 1.5) / 0.9));
    }
  }
  return y;
}

/**
 * The gallery way as stretches: those open to the sky and those under the rock, each a line of its
 * own points, running one point on into its neighbours at either end so that the two kinds meet.
 */
export function galleryRuns(g: NonNullable<Mountain['gallery']>): { open: [number, number, number][][]; under: [number, number, number][][] } {
  let runs = RUNS.get(g);
  if (!runs) {
    const n = g.line.length, open: [number, number, number][][] = [], under: [number, number, number][][] = [];
    const covered = new Uint8Array(n);
    for (const [a, b] of g.under) { for (let k = a; k <= b; k++) covered[k] = 1; under.push(g.line.slice(Math.max(0, a - 1), Math.min(n, b + 2))); }
    for (let k = 0; k < n; k++) {
      if (covered[k]) continue;
      let e = k;
      while (e + 1 < n && !covered[e + 1]) e++;
      if (e > k || n === 1) open.push(g.line.slice(Math.max(0, k - 1), Math.min(n, e + 2)));
      k = e;
    }
    RUNS.set(g, (runs = { open, under }));
  }
  return runs;
}
const RUNS = new WeakMap<object, { open: [number, number, number][][]; under: [number, number, number][][] }>();

/**
 * The country round about, far beyond where anyone walks: how high the land stands at a point, and whether it is water there.
 * Valleys lie six or seven hundred metres under the cloud, with long lakes in their floors; between them run ridges for miles,
 * their crests about the cloud's level and here and there above it; and out of them stand the mountains of `range`, each a horn
 * with hollow flanks and three or four ridges running down from it. Close about this mountain nothing but itself stands as high
 * as the cloud. It is the land's plain shape; whoever draws it decides what covers it.
 */
export function countryAt(m: Mountain, floor: number, x: number, z: number): { y: number; water: boolean } {
  if (m.terrain) return wornCountryAt(m, floor, x, z);
  const deck = m.deck, seed = (m.x * 7.31 + m.z * 3.17) % 97;
  const ridge = (px: number, pz: number, s: number) => { const v = 1 - Math.abs(fbm2(px, pz, 3, s) * 2 - 1); return v * v; };
  const lake = deck - 610;
  let y = deck - 680 + 330 * ridge(x * 0.00075 + seed, z * 0.00075, 5) + 70 * ridge(x * 0.0035, z * 0.0035 + seed, 15);
  // The long ridges: wooded, running for miles, standing up to the cloud and through it; lower and fewer close to this mountain.
  const out = Math.hypot(x - m.x, z - m.z), free = smooth((out - 420) / 700);
  const run = ridge(x * 0.00042 - seed, z * 0.00042 + seed * 0.7, 23), swell = 0.55 + 0.9 * fbm2(x * 0.00021 + seed, z * 0.00021, 2, 29);
  y = Math.max(y, deck - 330 + (400 * Math.pow(run, 1.3) * swell + 55 * ridge(x * 0.0041 + seed, z * 0.0041, 31) * run) * (0.45 + 0.55 * free));
  for (const q of m.range) {
    const d = Math.hypot(x - q.x, z - q.z);
    // (Below the cloud a mountain goes on down and out to the valley floor.)
    if (d > q.r) { if (d < q.r + 520) y = Math.max(y, deck - 250 - (d - q.r) * 0.85); continue; }
    const t = 1 - d / q.r, crest = ridge(x * 0.006 + q.x * 0.001, z * 0.006, 11), arete = ridge(x * 0.0025, z * 0.0025 + q.z * 0.001, 13);
    const around = Math.atan2(z - q.z, x - q.x), ribs = 3 + (Math.abs(Math.round(q.x + q.z)) % 2);
    const star = Math.pow(Math.abs(Math.cos((around * ribs) / 2 + q.x * 0.013 + 0.9 * fbm2(x * 0.0018 + q.z, z * 0.0018, 2, 7))), 0.7);
    const horn = 0.55 * Math.pow(t, 1.25) + 0.45 * Math.pow(t, 3.2);
    y = Math.max(y, deck - 250 + (q.height + 250) * horn * (0.62 + 0.2 * star * (1 - t * 0.5) + 0.16 * crest + 0.2 * arete));
  }
  // (This mountain's own slopes, as they go on down beyond the near ground.)
  if (out < 900) y = Math.max(y, landAt(m, floor, x, z, false));
  return y < lake ? { y: lake, water: true } : { y, water: false };
}

/**
 * The country round about as worn land, for a mountain whose land is worn. Its large shape is the
 * plain country's: valley floors under the cloud, the long ridges, and a mass under each mountain of
 * the range, so the landmarks stand where they did. Ridged noise breaks each mass into arêtes and
 * horns; a coarse lattice of it, fourteen kilometres across, is worn by water and frost, so that
 * valleys drain and branch; and on that, fine detail is laid, in fewer octaves the further a point
 * lies from this mountain, where whoever sees it stands.
 */
function wornCountryAt(m: Mountain, floor: number, x: number, z: number): { y: number; water: boolean } {
  // (Near this mountain, from a finer lattice worn at its own scale, so that the faces nearest have their gullies and ribs; beyond
  // it, from the coarse one with the detail laid on. This mountain's own flanks are in them, its top on a lattice of its own.)
  const near = nearCountryOf(m, floor), top = fieldOf(m, floor);
  const y = top.holds(x, z) ? landAt(m, floor, x, z, false) : near.holds(x, z) ? near.smoothAt(x, z) : countryDetailed(m, floor, x, z);
  const lake = m.deck - 610;
  return y < lake ? { y: lake, water: true } : { y, water: false };
}

/** The coarse worn country with its detail laid on: in fewer octaves the further a point lies from this mountain. */
function countryDetailed(m: Mountain, floor: number, x: number, z: number): number {
  const field = countryOf(m, floor), seed = m.terrain!.seed;
  const base = field.holds(x, z) ? field.smoothAt(x, z) : countryShape(m, floor, x, z);
  const out = Math.hypot(x - m.x, z - m.z);
  // (Seven octaves near, down to a finest of ten metres; two and a half far off, where the mesh is a hundred metres coarse.)
  const octaves = Math.min(7, Math.max(2.5, 7 - Math.log2(Math.max(out, 300) / 300)));
  const rel = Math.max(0, base - (m.deck - 690));
  return base + (12 + 0.05 * rel) * erodedFbmLod(x / 620 + 3.3, z / 620 - 1.1, octaves, seed + 77);
}

/**
 * The country's shape before it is worn. Two parts: how high the land is lifted, a smooth thing, and
 * ridged noise, which makes of it crests, arêtes and horns with hollows between, as mountains are.
 * The lift is low over the valley floors, long and narrow over the long ridges, and high and broad
 * under each mountain of the range; so the range's mountains stand about where the plan has them,
 * and the summits are where the noise puts them.
 */
function countryShape(m: Mountain, floor: number, x: number, z: number): number {
  const deck = m.deck, seed = m.terrain!.seed, s = (m.x * 7.31 + m.z * 3.17) % 97;
  const fl = deck - 690;
  // The floors, rolling a little over the miles.
  let lift = 150 + 110 * fbmd(x / 2600 + s, z / 2600, 3, seed + 5);
  // The long ridges, lower and fewer close to this mountain.
  const out = Math.hypot(x - m.x, z - m.z), free = smooth((out - 420) / 700);
  const wx = x / 2300 + 0.4 * fbmd(x / 3100, z / 3100 + s, 2, seed + 9), wz = z / 2300 + 0.4 * fbmd(x / 3100 - s, z / 3100, 2, seed + 10);
  const run = smooth(1 - Math.abs(fbmd(wx, wz, 3, seed + 11) * 2.4)), swell = 0.6 + 0.8 * (0.5 + fbmd(x / 4800 + s, z / 4800, 2, seed + 12));
  lift = softMax(lift, (300 + 330 * swell) * run * (0.45 + 0.55 * free), 120);
  // Under the range, broad and high, its outline not a circle; and at the middle of each a horn, which the noise's crests run up
  // into as arêtes, so that each mountain has its summit where the plan has it, as high as the plan has it.
  let horn = 0;
  for (let k = 0; k < m.range.length; k++) {
    const q = m.range[k], d = Math.hypot(x - q.x, z - q.z), reach = q.r * 1.15;
    if (d > reach * 2.6) continue;
    const t = (d / reach) * (1 + 0.35 * fbmd(x / 700 + k * 1.7, z / 700, 2, seed + 31));
    // (The noise's crests stand at about 1.1 times the lift, and its hollows at half: so the crests, not the mass, reach the height planned.)
    lift = softMax(lift, ((q.height + 690) / 1.1) * Math.exp(-t * t), 150);
    // (A horn is a pyramid of three or four faces, a little hollowed by the ice that cut them, with arêtes on its edges: not a cone,
    // and not a needle either, its faces at forty-five degrees and more but not much more. Only the
    // mountains that stand well over the cloud have one; the rest are what the noise makes of them.)
    if (q.height < 180 || d > reach * 1.6) continue;
    const faces = 3 + (k % 2), sector = TAU / faces, turn = k * 2.39 + 0.5 * fbmd(x / 500 + k, z / 500, 2, seed + 41);
    const off = ((((Math.atan2(z - q.z, x - q.x) - turn) % sector) + sector) % sector) - sector / 2;
    const th = (d * Math.cos(off)) / (reach * 0.95 * Math.cos(sector / 2));
    if (th < 1) horn = Math.max(horn, 0.97 * Math.pow(1 - th, 1.1) * (0.85 + 0.15 * ridgedFbm(x / 380 + k, z / 380, 3, seed + 43)));
  }
  // The ridged noise, its coordinates warped so that its crests wander and branch.
  const u = x / 1300 + 0.3 * fbmd(x / 1000, z / 1000, 3, seed + 21), v = z / 1300 + 0.3 * fbmd(x / 1000 + 7, z / 1000, 3, seed + 22);
  const r = softMax(ridgedFbm(u, v, 6, seed + 23), horn, 0.12);
  const land = fl + lift * (0.32 + 0.82 * r);
  // And this mountain, its flanks going down into the country and joined to it: below its top, broken by the same noise as the
  // country, so that its spurs have crests and its bays go deeper.
  if (out >= 2600) return land;
  const home = baseLand(m, floor, x, z);
  return softMax(land, home + 170 * smooth((floor - home - 120) / 260) * (r - 0.4), 60);
}

/** How the country round about is worn: tried and tuned with the relief tool, as `WEAR` is. */
export const COUNTRY_WEAR = {
  cell: 32, half: 7200, cut: 110, fill: 45,
  water: { drops: 1.0, life: 90, inertia: 0.15, capacity: 0.5, erode: 0.15, deposit: 0.25, evaporate: 0.012, gravity: 4, radius: 2, most: 4 },
  frost: { passes: 2, repose: 1.9, rate: 0.4 },
};
/** The finer lattice about this mountain: made from the coarse one with its detail, and worn again at its own scale. */
export const NEAR_WEAR = {
  cell: 12, half: 2600, cut: 45, fill: 20,
  water: { drops: 1.0, life: 70, inertia: 0.1, capacity: 0.5, erode: 0.15, deposit: 0.25, evaporate: 0.015, gravity: 4, radius: 2, most: 1.6 },
  frost: { passes: 2, repose: 1.9, rate: 0.4 },
};
const NEARS = new WeakMap<Mountain, { sig: number[]; field: HeightField }>();
function nearCountryOf(m: Mountain, floor: number): HeightField {
  const had = NEARS.get(m);
  if (had && had.sig[0] === m.deck && had.sig[1] === m.range.length && had.sig[2] === floor && had.sig[3] === m.peaks[0]?.height) return had.field;
  const W = NEAR_WEAR, cell = W.cell, n = Math.ceil((2 * W.half) / cell) + 1;
  const f = new HeightField(m.x - W.half, m.z - W.half, cell, n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f.data[j * n + i] = countryDetailed(m, floor, f.x0 + i * cell, f.z0 + j * cell);
  const shaped = f.data.slice();
  wearByWater(f, new Rng(`country-near/${m.terrain!.seed}`), W.water);
  for (let k = 0; k < f.data.length; k++) f.data[k] = Math.max(shaped[k] - W.cut, Math.min(shaped[k] + W.fill, f.data[k]));
  wearByFrost(f, W.frost.passes, W.frost.repose, W.frost.rate);
  // (Blended back to the coarse land at the lattice's edge, over the last three hundred metres, so that no seam shows where it ends.)
  const edge = Math.round(300 / cell);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, e = smooth(Math.min(i, j, n - 1 - i, n - 1 - j) / edge); f.data[k] = shaped[k] + (f.data[k] - shaped[k]) * e; }
  NEARS.set(m, { sig: [m.deck, m.range.length, floor, m.peaks[0]?.height], field: f });
  return f;
}

const COUNTRIES = new WeakMap<Mountain, { sig: number[]; field: HeightField }>();
function countryOf(m: Mountain, floor: number): HeightField {
  const had = COUNTRIES.get(m);
  if (had && had.sig[0] === m.deck && had.sig[1] === m.range.length && had.sig[2] === floor && had.sig[3] === m.peaks[0]?.height) return had.field;
  const W = COUNTRY_WEAR, cell = W.cell, n = Math.ceil((2 * W.half) / cell) + 1;
  const f = new HeightField(m.x - W.half, m.z - W.half, cell, n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f.data[j * n + i] = countryShape(m, floor, f.x0 + i * cell, f.z0 + j * cell);
  const shaped = f.data.slice();
  wearByWater(f, new Rng(`country/${m.terrain!.seed}`), W.water);
  for (let k = 0; k < f.data.length; k++) f.data[k] = Math.max(shaped[k] - W.cut, Math.min(shaped[k] + W.fill, f.data[k]));
  wearByFrost(f, W.frost.passes, W.frost.repose, W.frost.rate);
  // (Blended back to the shape unworn at the lattice's edge, beyond which the land is reckoned without it.)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, e = smooth(Math.min(i, j, n - 1 - i, n - 1 - j) / 12); f.data[k] = shaped[k] + (f.data[k] - shaped[k]) * e; }
  COUNTRIES.set(m, { sig: [m.deck, m.range.length, floor, m.peaks[0]?.height], field: f });
  return f;
}

/** A curve through points (Catmull and Rom's), a point every stride and a bit, no two nearer than that. */
function curveThrough(ctrl: [number, number][]): [number, number][] {
  const c = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]], out: [number, number][] = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]], n = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  // (Levels are written to a tenth of a metre, and points closer than this would seem to jump.)
  const spaced: [number, number][] = [out[0]];
  for (const q of out.slice(1, -1)) { const p0 = spaced[spaced.length - 1]; if (Math.hypot(q[0] - p0[0], q[1] - p0[1]) > 1.2) spaced.push(q); }
  const end = out[out.length - 1], p1 = spaced[spaced.length - 1];
  if (spaced.length > 1 && Math.hypot(end[0] - p1[0], end[1] - p1[1]) < 1.2) spaced.pop();
  spaced.push(end);
  return spaced;
}

/**
 * A line from `a` to `b` that climbs `climb` metres no more steeply than `slope`: straight if
 * that is steep enough, otherwise in zigzags across the line, each going `half` metres to either
 * side of it, as a path is made up a mountain. Points come every two metres or so.
 */
function zigzag(a: [number, number], b: [number, number], climb: number, slope: number, half: number): [number, number][] {
  const D = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, L = (Math.abs(climb) / slope) * 1.1;
  const ux = (b[0] - a[0]) / D, uz = (b[1] - a[1]) / D, px = -uz, pz = ux;
  const corners: [number, number][] = [a];
  if (L > D * 1.04 && half > 1.5) {
    const n = Math.max(2, Math.ceil(Math.sqrt(L * L - D * D) / (2 * half)));
    for (let k = 1; k <= n; k++) {
      const along = ((k - 0.5) / n) * D, side = k % 2 ? 1 : -1;
      corners.push([a[0] + ux * along + px * half * side, a[1] + uz * along + pz * half * side]);
    }
  }
  corners.push(b);
  const out: [number, number][] = [];
  for (let k = 0; k < corners.length - 1; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[k + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
    for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]);
  }
  out.push(b);
  return out;
}

/**
 * A level line along a line of points, from the land's own heights there, smoothed, then eased
 * wherever they climb more steeply than `slope`, with its ends held at `first` and `last`.
 */
function levelLine(pts: [number, number][], height: (x: number, z: number) => number, first: number, last: number, slope: number): [number, number, number][] {
  let h = pts.map(([x, z]) => height(x, z));
  for (let pass = 0; pass < 3; pass++) h = h.map((_, i) => { let sum = 0, n = 0; for (let j = i - 4; j <= i + 4; j++) if (j >= 0 && j < h.length) { sum += h[j]; n++; } return sum / n; });
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = along[along.length - 1];
  const lo = along.map((d) => Math.max(first - d * slope, last - (total - d) * slope)), hi = along.map((d) => Math.min(first + d * slope, last + (total - d) * slope));
  const fit = (i: number, v: number) => (lo[i] <= hi[i] ? Math.min(hi[i], Math.max(lo[i], v)) : (lo[i] + hi[i]) / 2);
  h = h.map((v, i) => fit(i, v));
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 1; i < h.length; i++) { const ds = (along[i] - along[i - 1]) * slope; h[i] = fit(i, Math.min(h[i - 1] + ds, Math.max(h[i - 1] - ds, h[i]))); }
    for (let i = h.length - 2; i >= 0; i--) { const ds = (along[i + 1] - along[i]) * slope; h[i] = fit(i, Math.min(h[i + 1] + ds, Math.max(h[i + 1] - ds, h[i]))); }
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  return pts.map(([x, z], i) => [round(x), round(z), round(h[i])]);
}

/**
 * Lays out a mountain top round a house whose forecourt is `meadow` and whose door is at `doorX`
 * in the forecourt's north side. Fills in the site's `mountain`, `grounds`, `track` and `paths`.
 */
export function layOutMountain(site: Site, meadow: Place, doorX: number, rng: Rng, worn = false): void {
  const round = (v: number) => Math.round(v * 10) / 10, T = site.wallThickness, F = meadow.floor;
  const others = site.places.filter((q) => q !== meadow);
  const house = { x0: Math.min(...others.map((q) => q.x0)) - T, x1: Math.max(...others.map((q) => q.x1)) + T, z0: Math.min(...others.map((q) => q.z0)) - T, z1: meadow.z1 };
  site.stands = 'free';
  const level = { x0: round(Math.min(house.x0, meadow.x0) - 6), x1: round(Math.max(house.x1, meadow.x1) + 6), z0: round(house.z0 - 6), z1: round(meadow.z1 + 2) };
  const hx = (level.x0 + level.x1) / 2, hz = (level.z0 + level.z1) / 2;

  // The rim: an oval turned any way, with spurs of the top standing out from it and gullies cut
  // back into it, as a mountain's top is; the precipice under it high in one place and less in the next.
  const shape = rng.fork('rim');
  const R = shape.range(120, 160), turn = shape.range(0, Math.PI), seed = shape.range(0, 500), squash = shape.range(0.68, 0.95);
  const heads = Array.from({ length: shape.int(2, 4) }, () => ({ at: shape.range(0, TAU), out: shape.range(10, 24), wide: shape.range(0.1, 0.22) }));
  const gullies = Array.from({ length: shape.int(1, 4) }, () => ({ at: shape.range(0, TAU), into: shape.range(6, 15), wide: shape.range(0.04, 0.08) }));
  const rimOf = (scale: number) => Array.from({ length: N }, (_, k) => {
    const a = (k / N) * TAU, c = Math.cos(a - turn), s = Math.sin(a - turn);
    let r = (R / Math.sqrt(c * c + (s * s) / (squash * squash))) * scale;
    r *= 1 + 0.2 * (fbm2(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, 3) - 0.5) + 0.1 * (fbm2(Math.cos(a) * 7 + seed, Math.sin(a) * 7 - seed, 2) - 0.5);
    for (const h of heads) r += h.out * Math.exp(-((turnBetween(h.at, a) / h.wide) ** 2));
    for (const g of gullies) r -= g.into * Math.exp(-((turnBetween(g.at, a) / g.wide) ** 2));
    return round(Math.max(40, r));
  });
  const dropSeed = shape.range(0, 500);
  // The house stands on a shoulder near the south edge: the middle of the top lies north of it.
  const middle = { x: round(hx + shape.range(-15, 15)), z: round(hz - R * squash * shape.range(0.3, 0.45)) };
  const m: Mountain = {
    x: middle.x, z: middle.z, rim: rimOf(1),
    // (In some stretches hardly a precipice at all, the top going over into a steep slope of scree; in others a wall the height of a church tower.)
    drop: Array.from({ length: N }, (_, k) => { const a = (k / N) * TAU; return round(6 + 48 * smooth((fbm2(Math.cos(a) * 1.4 + dropSeed, Math.sin(a) * 1.4, 3) - 0.28) / 0.44)); }),
    ribs: { seed: round(shape.range(0, 90)), out: round(shape.range(5, 9)), apart: round(shape.range(17, 27)) },
    deck: 0, billow: 0, spur: { from: [0, 0], to: [0, 0], width: 40, y0: F, y1: F }, peaks: [], level, range: [],
  };
  // Grown until the house and its level ground lie well inside the rim.
  const corners = [[level.x0, level.z0], [level.x1, level.z0], [level.x0, level.z1], [level.x1, level.z1], [hx, level.z1]];
  const margin = () => Math.min(...corners.map(([x, z]) => insideTop(m, x, z)));
  for (let grow = 1; grow < 2 && margin() < 16; grow += 0.05) m.rim = rimOf(grow);

  // The ridge: out from the rim on the south side, beyond the forecourt, and down.
  {
    const q = rng.fork('spur');
    const exitX = doorX, exitZ = level.z1;
    // Where the rim lies south of the forecourt, more or less: the ridge leaves it there.
    const a = Math.atan2(exitZ - m.z, exitX - m.x) + q.range(-0.35, 0.35);
    const at = rimAt(m, a) - 2, fx = m.x + Math.cos(a) * at, fz = m.z + Math.sin(a) * at;
    const dir = a + q.range(-0.3, 0.3), length = q.range(280, 350);
    m.spur = { from: [round(fx), round(fz)], to: [round(fx + Math.cos(dir) * length), round(fz + Math.sin(dir) * length)], width: round(q.range(18, 25)), y0: 0, y1: 0 };
    const plainTop = landAt({ ...m, spur: { ...m.spur, y0: -1e4, y1: -1e4 } }, F, fx, fz, false);
    m.spur.y0 = round(plainTop);
    // (No steeper along its length than the way may go straight down it: a path on a ridge keeps to the crest, and zigzags across a crest would cut it to pieces.)
    m.spur.y1 = round(plainTop - Math.min(q.range(82, 108), length * 0.26));
  }
  // Summits: the highest behind the house, on the north side; perhaps one or two lesser, anywhere clear of the house and the head of the ridge.
  {
    const q = rng.fork('peaks');
    for (let tries = 0; tries < 400 && m.peaks.length < 1; tries++) {
      const a = -Math.PI / 2 + q.range(-0.9, 0.9), at = rimAt(m, a) * q.range(0.5, 0.74);
      const r = q.range(42, 70), height = q.range(58, 108), x = m.x + Math.cos(a) * at, z = m.z + Math.sin(a) * at;
      // (Well back from the house: the way up to it is to be a walk, not a scramble behind the kitchen.)
      // (And as far off across the top as the top allows, at first asking: the further, the longer and easier the way up, and the higher the summit may stand.)
      if (outside(level, x, z) < Math.max(r * 0.55 + 28, 95 - tries * 0.3)) continue;
      m.peaks.push({ x: round(x), z: round(z), r: round(r), height: round(height) });
    }
    const more = q.int(0, 2);
    for (let tries = 0; tries < 300 && m.peaks.length < 1 + more; tries++) {
      const a = q.range(0, TAU), at = rimAt(m, a) * Math.sqrt(q.next()) * 0.85, x = m.x + Math.cos(a) * at, z = m.z + Math.sin(a) * at;
      const r = q.range(26, 45), height = q.range(14, Math.max(16, m.peaks[0].height * 0.6));
      if (outside(level, x, z) < r * 0.4 + 10 || Math.hypot(x - m.spur.from[0], z - m.spur.from[1]) < r + 20) continue;
      if (m.peaks.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.65)) continue;
      m.peaks.push({ x: round(x), z: round(z), r: round(r), height: round(height) });
    }
  }
  const plain = (x: number, z: number) => landAt(m, F, x, z, false);
  // (The head of the ridge stands at the height the land has there now the summits are on it.)
  m.spur.y0 = round(Math.min(F + 2, plain(m.spur.from[0], m.spur.from[1])));
  // The ridge's line. A ridge does not run straight: it swings one way and then the other, in two or three long bends, as it
  // goes out and down from the mountain; and it does not fall evenly, but over knolls and through saddles, steeply in one place
  // and hardly at all in the next. (It must keep going out from the mountain, and never turn back along its foot.)
  {
    const q = rng.fork('crest'), [fx, fz] = m.spur.from, straight = Math.atan2(m.spur.to[1] - fz, m.spur.to[0] - fx), length = Math.hypot(m.spur.to[0] - fx, m.spur.to[1] - fz), STEP = 6;
    let line: [number, number][] = [];
    for (let tries = 0; tries < 240; tries++) {
      const pts: [number, number][] = [[fx, fz]];
      let h = straight + q.range(-0.25, 0.25), x = fx, z = fz, gone = 0, sign = q.chance(0.5) ? 1 : -1, ok = true;
      // (Straight out for a little way first, clear of the rim.)
      for (let k = 0; k < 3; k++) { x += Math.cos(h) * STEP; z += Math.sin(h) * STEP; gone += STEP; pts.push([x, z]); }
      while (gone < length && ok) {
        const r = q.range(60, 150), turn = q.range(0.45, 1.05), n = Math.max(2, Math.round((r * turn) / STEP));
        for (let k = 0; k < n && gone < length && ok; k++) {
          h += (sign * STEP) / r; x += Math.cos(h) * STEP; z += Math.sin(h) * STEP; gone += STEP;
          pts.push([x, z]);
          ok = insideTop(m, x, z) < -6 - 0.42 * (gone - 18) && Math.abs(turnBetween(straight, h)) < 1.25;
        }
        sign = -sign;
      }
      if (ok) { line = pts; break; }
    }
    if (!line.length) for (let d = 0; d <= length; d += STEP) line.push([fx + Math.cos(straight) * d, fz + Math.sin(straight) * d]);
    const p1 = q.range(0, TAU), p2 = q.range(0, TAU), waves = q.range(1.8, 2.5);
    // (Knolls and saddles deep enough that whoever comes up it walks downhill two or three times on the way: into a saddle, with the next rise seen across it.)
    const fallen = (t: number) => Math.pow(t, 1.05) + 0.13 * Math.sin(t * waves * TAU + p1) * Math.sin(Math.PI * t) + 0.02 * Math.sin(t * 9.3 * TAU + p2) * smooth(t / 0.1);
    const end = fallen(1);
    m.spur.crest = line.map(([x, z], k) => [round(x), round(z), round(m.spur.y0 + (m.spur.y1 - m.spur.y0) * (fallen(k / (line.length - 1)) / end))]);
    m.spur.to = [m.spur.crest[m.spur.crest.length - 1][0], m.spur.crest[m.spur.crest.length - 1][1]];
    // The cleft across it, on most mountains: in its upper half, where the bridge over it will be above the cloud.
    if (rng.fork('notch?').chance(0.75)) {
      const total = line.reduce((sum, pt, k) => (k ? sum + Math.hypot(pt[0] - line[k - 1][0], pt[1] - line[k - 1][1]) : 0), 0);
      // (Where the crest runs most nearly level, on a knoll's top or in a saddle: a bridge wants its two ends at one height.)
      let at = total * 0.36, least = Infinity;
      for (let d = total * 0.24; d <= total * 0.5; d += 3) {
        const slope = Math.abs(crestPoint(m, (d + 9) / total).y - crestPoint(m, (d - 9) / total).y) / 18 + q.range(0, 0.02);
        if (slope < least) { least = slope; at = d; }
      }
      m.spur.notch = { at: round(at), wide: round(q.range(7.5, 10.5)), deep: round(q.range(11, 17)) };
    }
  }
  // (If the land is to be worn, it is worn now that its large shape is decided, so that every way and platform after is laid on the worn land.)
  if (worn) m.terrain = { seed: rng.fork('terrain').int(0, 1e6), cell: 2 };

  // The way: from the door across the forecourt, on to the head of the ridge, and down the ridge
  // in zigzags as steep as a mule path may be, to where the player arrives near its end.
  const track: [number, number][] = [[doorX, meadow.z0], [doorX, meadow.z1 - 4]];
  {
    const q = rng.fork('way'), hd = crestPoint(m, 0.07), ft = crestPoint(m, 0.93);
    const head: [number, number] = [hd.x, hd.z], foot: [number, number] = [ft.x, ft.z];
    const [sx, sz] = track[1];
    // From the forecourt to the head of the ridge: not ruled straight, but in one easy bow, as a path worn by feet goes.
    const first: [number, number][] = [];
    {
      const d = Math.hypot(head[0] - sx, head[1] - sz) || 1, n = Math.max(2, Math.round(d / 2)), bow = q.range(-1, 1) * Math.min(7, d * 0.16);
      for (let i = 0; i <= n; i++) { const t = i / n, off = bow * Math.sin(Math.PI * t) * smooth(t / 0.3); first.push([sx + (head[0] - sx) * t - ((head[1] - sz) / d) * off, sz + (head[1] - sz) * t + ((head[0] - sx) / d) * off]); }
    }
    // Down the ridge: along its crest as the crest swings, and wandering a little on it from one side to the other, round
    // a knoll here and a tooth of rock there. A point every two metres.
    const down: [number, number][] = [];
    {
      const total = (m.spur.crest ?? []).reduce((sum, p, k, all) => (k ? sum + Math.hypot(p[0] - all[k - 1][0], p[1] - all[k - 1][1]) : 0), 0) || 1;
      const p1 = q.range(0, TAU), p2 = q.range(0, TAU), room = Math.max(0.6, m.spur.width / 2 - 7);
      for (let d = 0.07 * total; d <= 0.93 * total; d += 2) {
        // (It comes to the cleft square and on the crest's own line, where the bridge is.)
        const toNotch = m.spur.notch ? smooth((Math.abs(d - m.spur.notch.at) - 7) / 16) : 1;
        const c = crestPoint(m, d / total), t = (d / total - 0.07) / 0.86, wander = (room * 0.8 * Math.sin(d / 17 + p1) + room * 0.35 * Math.sin(d / 6.3 + p2)) * smooth(t / 0.08) * smooth((1 - t) / 0.06) * toNotch;
        down.push([c.x - Math.sin(c.heading) * wander, c.z + Math.cos(c.heading) * wander]);
      }
      down.push(foot);
    }
    // (Kept on the ground: a point that would come near the edge is drawn in towards the crest or the middle.)
    const keep = (p: [number, number]): [number, number] => {
      let [x, z] = p;
      for (let i = 0; i < 30 && inside(m, x, z) < 5.5; i++) {
        const gx = inside(m, x + 1, z) - inside(m, x - 1, z), gz = inside(m, x, z + 1) - inside(m, x, z - 1), gl = Math.hypot(gx, gz) || 1;
        x += (gx / gl) * 0.8; z += (gz / gl) * 0.8;
      }
      return [round(x), round(z)];
    };
    const pts = [...first.slice(1), ...down.slice(1)].map(keep);
    for (const p of pts) if (Math.hypot(p[0] - track[track.length - 1][0], p[1] - track[track.length - 1][1]) > 1.2) track.push(p);
    // The way's level line, from the forecourt to the arrival.
    const line: [number, number][] = track.slice(1);
    // (Its level line is taken from the ridge as it would be without the cleft: the way does not go down into that.)
    const cut = m.spur.notch;
    delete m.spur.notch;
    m.way = levelLine(line, plain, F, plain(foot[0], foot[1]), 0.5);
    if (cut) m.spur.notch = cut;
    // The bridge: over the cleft the way does not go down and up, it goes across, straight and level from lip to lip.
    if (m.spur.notch) {
      const n = m.spur.notch, over = m.way.map(([x, z]) => { const sp = onSpur(m, x, z); return sp.off < 8 && Math.abs(sp.d - n.at) < n.wide / 2 + 2.2; });
      const i0 = over.indexOf(true), i1 = over.lastIndexOf(true);
      if (i0 > 2 && i1 < m.way.length - 3 && i1 > i0) {
        const a = m.way[i0 - 1], b = m.way[i1 + 1];
        // (The lips stand at what the land has there without the cleft; the way either side is eased to them by its own grade.)
        for (let k = i0; k <= i1; k++) { const f = (k - i0 + 1) / (i1 - i0 + 2); m.way[k] = [round(a[0] + (b[0] - a[0]) * f), round(a[1] + (b[1] - a[1]) * f), round(a[2] + (b[2] - a[2]) * f)]; track[k + 1] = [m.way[k][0], m.way[k][1]]; }
        m.bridge = { a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], width: 2.5 };
      } else delete m.spur.notch;
    }
    // The gateway: where the way comes off the ridge onto the top.
    {
      const k = m.way.findIndex(([x, z]) => onSpur(m, x, z).t > 0.035 && onSpur(m, x, z).off < 30);
      if (k > 1 && k < m.way.length - 2) m.gate = { x: m.way[k][0], z: m.way[k][1], y: m.way[k][2], heading: Math.round(Math.atan2(m.way[k + 1][1] - m.way[k - 1][1], m.way[k + 1][0] - m.way[k - 1][0]) * 1000) / 1000 };
    }
  }
  site.track = track;
  // The cloud: its top lies about the foot of the ridge, so that the player comes up out of it, or is still in its top when they arrive.
  {
    const q = rng.fork('cloud'), arrive = m.way![m.way!.length - 1][2];
    m.billow = round(q.range(6, 11));
    // (One day in eight it is unbroken to the horizon; on the others it has breaks in it, few or many, with the valleys showing through.)
    m.breaks = rng.fork('breaks').chance(0.12) ? 0 : Math.round(rng.fork('breaks amount').range(0.4, 0.95) * 100) / 100;
    // (Above the arrival by about as much as its deepest troughs go below it, so that the player always starts in the cloud and climbs out of it.)
    m.deck = round(arrive + m.billow * 2.3 + q.range(0, 4));
  }

  // A shelter on the ridge, a little above the cloud: a hut of dry stone roofed with slabs, beside
  // the way, where whoever is caught on it by the weather may wait it out.
  {
    const q = rng.fork('shelter'), wy = m.way!;
    for (let tries = 0; tries < 60 && !m.shelter; tries++) {
      const want = m.deck + q.range(5, 15), k = wy.findIndex((w) => w[2] < want);
      if (k < 2 || k > wy.length - 3) continue;
      // (The ridge broadens there to hold it.)
      m.spur.swell = Math.round(onSpur(m, wy[k][0], wy[k][1]).t * 1000) / 1000;
      const [x0, z0, y0] = wy[k], [x1, z1] = wy[k + 1], dir = Math.atan2(z1 - z0, x1 - x0), side = q.chance(0.5) ? 1 : -1, off = q.range(6, 7.5);
      const x = x0 + Math.cos(dir + (side * Math.PI) / 2) * off, z = z0 + Math.sin(dir + (side * Math.PI) / 2) * off;
      if (inside(m, x, z) < 7.5 || nearestOn(wy, x, z, 9).off < 5.4) continue;
      if (m.spur.notch && Math.abs(onSpur(m, x, z).d - m.spur.notch.at) < m.spur.notch.wide / 2 + 16) continue;
      m.shelter = { x: round(x), z: round(z), y: y0, facing: Math.round(Math.atan2(z0 - z, x0 - x) * 1000) / 1000 };
    }
  }

  // The climb to the summit: from the back corner of the level ground on the summit's side, up a
  // ridge that rises from the saddle to the top, winding on it in long S-shaped bends, at an even
  // grade gentle enough to walk without a hand on the rock, to a platform where the cairn stands.
  {
    const p = m.peaks[0], side = p.x < hx ? -1 : 1;
    const startX = side < 0 ? level.x0 + 2 : level.x1 - 2, startZ = level.z0 + 2;
    // The cairn: on the highest ground near the summit's middle.
    let best = -Infinity, cx = p.x, cz = p.z;
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * TAU * 3.7, d = (k / 60) * p.r * 0.25, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (inside(m, x, z) < 6) continue;
      const y = plain(x, z);
      if (y > best) { best = y; cx = x; cz = z; }
    }
    let top = plain(cx, cz);
    const toHouse = Math.atan2(startZ - cz, startX - cx), endX = cx + Math.cos(toHouse) * 3, endZ = cz + Math.sin(toHouse) * 3;
    // How long it must be to climb at one in three and a half; then the bends that make it so long, as one, one and a half or two
    // S-shapes across the straight line, as broad as they must be and no broader, wherever they keep well in from the edge and off the house.
    const want = ((top - F) / 0.36) * 1.04, D = Math.hypot(endX - startX, endZ - startZ) || 1;
    // The route: a smooth curve from beside the house through one or two points out on the top, on
    // alternate sides, to the summit, so that it swings out across the top and comes round and up in
    // great S-shaped bends, none tighter than some thirty-five metres across the half of it short of the summit itself. Many are
    // tried; the one kept is as long as a walker's grade wants, stays well in from the edge, and keeps
    // off the house and the way.
    const q0 = rng.fork('climb'), wy = m.way ?? [];
    const lengthOf = (pts: [number, number][]) => pts.reduce((sum, q, k) => (k ? sum + Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]) : 0), 0);
    const fits = (pts: [number, number][]) => pts.every(([x, z]) => inside(m, x, z) > 4.5 && (Math.hypot(x - startX, z - startZ) < 16 || (outside(level, x, z) > 4 && (!wy.length || nearestOn(wy, x, z, 10).off > 9))));
    /** A curve through points (Catmull and Rom's), every two metres or so. */
    const through = curveThrough;
    /** The tightest bend along a line, as the radius of the circle through points ten metres apart. */
    const tightest = (pts: [number, number][]) => {
      let least = Infinity;
      // (Not over its last quarter, where it comes up onto the summit itself and may wind as the rock lets it.)
      for (let k = 5; k < Math.min(pts.length - 5, pts.length * 0.75); k++) {
        const [ax, az] = pts[k - 5], [bx, bz] = pts[k], [cx2, cz2] = pts[k + 5];
        const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx2 - bx, cz2 - bz), ca = Math.hypot(ax - cx2, az - cz2);
        const area2 = Math.abs((bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax));
        least = Math.min(least, area2 < 1e-6 ? Infinity : (ab * bc * ca) / (2 * area2));
      }
      return least;
    };
    let chosen: [number, number][] | null = null, score = Infinity, apexes: number[] = [];
    const pick = () => { const a = q0.range(0, TAU), f = q0.range(0.15, 0.85); return [m.x + Math.cos(a) * rimAt(m, a) * f, m.z + Math.sin(a) * rimAt(m, a) * f] as [number, number]; };
    for (let tries = 0; tries < 2500; tries++) {
      const ctrl: [number, number][] = [[startX, startZ], pick()];
      if (q0.chance(0.6)) ctrl.push(pick());
      ctrl.push([endX, endZ]);
      const pts = through(ctrl), len = lengthOf(pts);
      const sc = Math.abs(len - want) + Math.max(0, want - len) * 2;
      // (Nor may it pass over the summit before it comes up to it.)
      if (sc >= score || tightest(pts) < 35 || !fits(pts) || pts.some(([x, z], k) => k < pts.length - 10 && Math.hypot(x - cx, z - cz) < 18)) continue;
      // (Where it swings widest, between the points it passes through: the bends' outer sides, for the landings.)
      apexes = [];
      let at = 0;
      for (let i = 1; i < ctrl.length - 1; i++) {
        let best = 0, bestK = -1;
        for (let k = 0; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - ctrl[i][0], pts[k][1] - ctrl[i][1]); if (bestK < 0 || d < best) { best = d; bestK = k; } }
        if (bestK > at) apexes.push((at = bestK));
      }
      score = sc; chosen = pts;
    }
    const rise = chosen ?? zigzag([startX, startZ], [endX, endZ], top - F, 0.36, Math.min(13, p.r * 0.28));
    const kept = [[hx, level.z1 - 2] as [number, number], [startX, level.z1 - 2] as [number, number], ...rise].map(([x, z]) => [round(x), round(z)] as [number, number]);
    // At an even grade from the level ground to the top; or, where the route is too short for that, at an easy grade most of
    // the way and up the last stretch onto the summit by a stair cut in the rock, no steeper than one in two and a half.
    const along = [0];
    for (let k = 1; k < rise.length; k++) along.push(along[k - 1] + Math.hypot(rise[k][0] - rise[k - 1][0], rise[k][1] - rise[k - 1][1]));
    // (An easy grade as far as it will take it; if the summit stands higher than that, the upper part of the route, up to nearly
    // half of it, is a stair in the rock, as steep as a stair may be.)
    const total = along[along.length - 1] || 1, last = total * 0.45, EASY = 0.4, STAIR = 0.6;
    // (A summit higher than even such a route can climb is a little lower: the top is only so broad.)
    for (let pass = 0; pass < 10 && top - F > (EASY * (total - last) + STAIR * last) * 0.985; pass++) {
      m.peaks[0].height = round(m.peaks[0].height * (((EASY * (total - last) + STAIR * last) * 0.97) / (top - F)));
      top = plain(cx, cz);
    }
    const height = top - F;
    const easy = Math.min(EASY, height / total);
    const split = easy * total >= height - 0.01 ? total : total - last;
    // (Not at one even grade either: the crest it follows rises in swells, and once or twice it goes down a little before it goes on up.)
    const swell = Math.min(2.4, total * 0.011), sw = rng.fork('climb swell').range(0, TAU);
    const levelAt = (d: number) => (d <= split ? easy * d : easy * split + ((height - easy * split) * (d - split)) / Math.max(1, total - split)) + (d < split ? swell * Math.sin((d / split) * 2.2 * TAU + sw) * Math.sin((Math.PI * d) / split) ** 2 : 0);
    m.climb = [
      ...kept.slice(0, 2).map(([x, z]) => [x, z, F] as [number, number, number]),
      ...rise.map(([x, z], k) => [round(x), round(z), round(F + levelAt(along[k]))] as [number, number, number]),
    ];
    if (split < total) m.climbStair = round(split);
    m.cairn = { x: round(cx), z: round(cz), y: round(top) };
    (site.paths ??= []).push({ points: kept, to: 'summit' });
    // At the outer side of each bend, where the path swings out to the edge of the ridge and the view
    // opens, the ground is widened into a landing to stop on; on the inner side a crag stands up.
    const q = rng.fork('landings'), climb = m.climb!;
    m.landings = [];
    const whats = ['view', 'seat', 'cairn', 'cross'] as const;
    // At the top of each arc, on its outer side, where the route swings widest and the view is.
    const heading = (k: number) => Math.atan2(rise[Math.min(rise.length - 1, k + 1)][1] - rise[k][1], rise[Math.min(rise.length - 1, k + 1)][0] - rise[k][0]);
    // (And a third and two thirds of the way along, if nothing is near there already.)
    const stops = [...(chosen ? apexes : []), Math.round(rise.length / 3), Math.round((rise.length * 2) / 3)];
    for (const k of stops) {
      if (k < 4 || k > rise.length - 6) continue;
      const tk = turnBetween(heading(k - 4), heading(k + 4));
      const out = heading(k) - Math.sign(tk || 1) * (Math.PI / 2), r = round(q.range(4.5, 7)), y = climb[k + 2][2];
      // (Pushed out from the path as far as the ridge allows; and not so near the top that it crowds the cairn's platform.)
      let push = 3.2;
      while (push > 0 && inside(m, rise[k][0] + Math.cos(out) * (push + r), rise[k][1] + Math.sin(out) * (push + r)) < 4) push -= 0.4;
      const x = rise[k][0] + Math.cos(out) * push, z = rise[k][1] + Math.sin(out) * push;
      if (Math.hypot(x - cx, z - cz) < r + 10 || m.landings.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 8)) continue;
      // The crag: on the inner side of the bend, clear of the path by a couple of strides.
      const cr = round(q.range(3.5, 5.5)), back = cr + 2.6, crx = rise[k][0] - Math.cos(out) * back, crz = rise[k][1] - Math.sin(out) * back;
      if (nearestOn(climb, crx, crz, cr + 4).off < cr + 2) continue;
      m.landings.push({ x: round(x), z: round(z), y: round(y), r, out: Math.round(out * 1000) / 1000, cx: round(crx), cz: round(crz), cr, height: round(q.range(4, 9)), what: whats[(m.landings.length + q.int(0, 3)) % 4] });
    }
  }

  // The bell tower: beside the forecourt, at the corner of the level ground away from where the climb sets out, clear of the way.
  {
    const q = rng.fork('belfry'), side = m.peaks[0].x < hx ? 1 : -1;
    const x = side > 0 ? level.x1 - 3.4 : level.x0 + 3.4, z = level.z1 - 3.6;
    if (Math.abs(x - doorX) > 6 && nearestOn(m.way ?? [], x, z, 9).off > 5 && nearestOn(m.climb ?? [], x, z, 9).off > 5) m.belfry = { x: round(x), z: round(z), y: F, height: round(q.range(11.5, 15)) };
  }

  // The kitchen's chimney, against the outside of the house: on the wall of the kitchen if it has one that is an outer wall, or of the
  // refectory, or of whichever room has. And the yard: a low wall along the front of the level ground with the way coming in through
  // it, and a cross on steps at the end of it away from the bell tower.
  {
    const rooms = [...others].filter((r) => (r.level ?? 0) === 0 && r.roof !== 'sky' && r.roof !== 'cave').sort((a, b) => Number(b.name === 'kitchen') - Number(a.name === 'kitchen') || Number(b.name === 'refectory') - Number(a.name === 'refectory'));
    for (const r of rooms) {
      const zc = (r.z0 + r.z1) / 2, xc = (r.x0 + r.x1) / 2;
      const sides: [number, number, [number, number], boolean][] = [[r.x0 - T, zc, [-1, 0], Math.abs(r.x0 - T - house.x0) < 0.05], [r.x1 + T, zc, [1, 0], Math.abs(r.x1 + T - house.x1) < 0.05], [xc, r.z0 - T, [0, -1], Math.abs(r.z0 - T - house.z0) < 0.05]];
      const side = sides.find((sd) => sd[3]);
      if (!side) continue;
      m.hearth = { x: round(side[0]), z: round(side[1]), out: side[2] };
      break;
    }
    const tower = m.belfry ? m.belfry.x : null, crossX = tower !== null && tower > hx ? level.x0 + 3 : level.x1 - 3;
    m.yard = { x0: level.x0 + 0.6, x1: level.x1 - 0.6, z: round(level.z1 - 0.5), gap: doorX, cross: [round(crossX), round(level.z1 - 2.6)] };
  }

  // The gallery way: on most mountains there is a second way up, along the mountainside.
  if (rng.fork('gallery?').chance(0.8)) layGallery(site, m, F, rng.fork('gallery'));
  // The scramble: on most mountains a third way, short and steep, up the summit's far ridge.
  if (rng.fork('scramble?').chance(0.85)) layScramble(site, m, F, rng.fork('scramble'));

  // Tors on the top: where the ground would otherwise lie open and even, knobs and low crags of rock, clear of everything made.
  {
    const q = rng.fork('tors'), all = [...(m.way ?? []), ...(m.climb ?? []), ...(m.gallery?.line ?? []), ...(m.scramble?.line ?? [])];
    m.tors = [];
    for (let tries = 0, want = q.int(14, 24); tries < 600 && m.tors.length < want; tries++) {
      const a = q.range(0, TAU), d = rimAt(m, a) * Math.sqrt(q.next()) * 0.95, x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      const r = q.range(2.2, 6.5), height = r * q.range(0.45, 0.95);
      if (inside(m, x, z) < r + 2 || outside(m.level, x, z) < r + 9) continue;
      if (all.some(([px, pz]) => Math.hypot(px - x, pz - z) < r + 5.5)) continue;
      if ((m.landings ?? []).some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 4) || (m.cairn && Math.hypot(m.cairn.x - x, m.cairn.z - z) < r + 9)) continue;
      if (m.shelter && Math.hypot(m.shelter.x - x, m.shelter.z - z) < r + 8) continue;
      if (m.tors.some((t) => Math.hypot(t.x - x, t.z - z) < (t.r + r) * 0.8)) continue;
      m.tors.push({ x: round(x), z: round(z), r: round(r), height: round(height) });
    }
    // And teeth of rock along the ridges, beside the way and the climb: taller than they are broad, now on one side and now on the
    // other, so that the path goes between and past them and the ridge has a skyline.
    const beside = (line: [number, number, number][], from: number, to: number, apart: [number, number]) => {
      let since = q.range(8, apart[1]), side = q.chance(0.5) ? 1 : -1;
      for (let k = Math.max(1, from); k < Math.min(line.length - 1, to); k++) {
        since -= Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
        if (since > 0) continue;
        since = q.range(apart[0], apart[1]);
        side = q.chance(0.7) ? -side : side;
        const dx = line[k + 1][0] - line[k - 1][0], dz = line[k + 1][1] - line[k - 1][1], l = Math.hypot(dx, dz) || 1;
        // (About one time in three there is one on either hand, close in: a gate of rock, with the way going through and what lies beyond framed in it.)
        const gate = q.chance(0.34);
        for (const sd of gate ? [side, -side] : [side]) {
          const r = q.range(1.5, 3.1), off = r * 1.3 + (gate ? q.range(2.45, 2.9) : q.range(2.6, 4.2)), x = line[k][0] - (dz / l) * sd * off, z = line[k][1] + (dx / l) * sd * off;
          if (inside(m, x, z) < 0.5 || outside(m.level, x, z) < r + 8) continue;
          if (all.some(([px, pz]) => Math.hypot(px - x, pz - z) < r * 1.3 + 2.4)) continue;
          if ((m.landings ?? []).some((ld) => Math.hypot(ld.x - x, ld.z - z) < ld.r + r + 1.5) || (m.cairn && Math.hypot(m.cairn.x - x, m.cairn.z - z) < r + 7)) continue;
          if (m.shelter && Math.hypot(m.shelter.x - x, m.shelter.z - z) < r + 6) continue;
          if (m.gate && Math.hypot(m.gate.x - x, m.gate.z - z) < r + 7) continue;
          if (m.spur.notch) { const sp = onSpur(m, x, z); if (sp.off < 40 && Math.abs(sp.d - m.spur.notch.at) < m.spur.notch.wide / 2 + r + 5) continue; }
          m.tors!.push({ x: round(x), z: round(z), r: round(r), height: round(r * q.range(gate ? 2.2 : 1.6, 3.1)) });
        }
      }
    };
    if (m.way) beside(m.way, m.way.findIndex(([x, z]) => onSpur(m, x, z).t > 0.12), m.way.length - 6, [20, 38]);
    if (m.climb) beside(m.climb, Math.round(m.climb.length * 0.25), m.climb.length - 8, [18, 34]);
  }

  // Other peaks, far off, standing out of the cloud: a few near enough to show their faces, more
  // beyond, and one or two great ones; none near, so the top stands alone over the cloud.
  {
    const q = rng.fork('range'), want = q.int(30, 42);
    // (Far off, beyond them all, a few giants: the great range this mountain is an outlier of.)
    for (let k = 0, n = q.int(5, 8), a0 = q.range(0, TAU); k < n; k++) {
      const a = a0 + q.range(-0.5, 0.5) + (k / n) * q.range(2.2, 3.6), d = q.range(3700, 6200);
      m.range.push({ x: round(m.x + Math.cos(a) * d), z: round(m.z + Math.sin(a) * d), r: round(q.range(1000, 1700)), height: round(q.range(480, 1050)) });
    }
    for (let tries = 0; tries < 900 && m.range.length < want; tries++) {
      const a = q.range(0, TAU), d = q.range(520, 3300);
      const big = q.chance(0.2 + 0.25 * smooth((d - 1400) / 1500));
      const height = round(big ? q.range(260, 650) : q.range(25, 230) * (0.55 + 0.45 * smooth((d - 520) / 1500)));
      const r = round(q.range(300, 700) * (big ? 1.6 : 1) * (0.7 + 0.3 * smooth((d - 520) / 900)));
      const x = round(m.x + Math.cos(a) * d), z = round(m.z + Math.sin(a) * d);
      if (m.range.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.45)) continue;
      m.range.push({ x, z, r, height });
    }
    // A great mountain does not stand alone: it has lesser summits on its ridges, a shoulder or two and a fore-peak, so that
    // what is seen is a massif with a skyline, not a cone.
    for (const p of [...m.range]) {
      if (p.height < 120) continue;
      for (let k = 0, n = q.int(2, 4); k < n; k++) {
        const a = q.range(0, TAU), d = p.r * q.range(0.28, 0.6);
        m.range.push({ x: round(p.x + Math.cos(a) * d), z: round(p.z + Math.sin(a) * d), r: round(p.r * q.range(0.45, 0.7)), height: round(p.height * q.range(0.5, 0.86)) });
      }
    }
  }
  // Needles: two to five towers of rock standing out of the cloud off the precipices, where a buttress has been cut off from the mountain.
  {
    const q = rng.fork('needles');
    m.needles = [];
    for (let tries = 0, want = q.int(2, 5); tries < 80 && m.needles.length < want; tries++) {
      const a = q.range(0, TAU), r = q.range(8, 17), d = rimAt(m, a) + q.range(30, 95) + r;
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      // (Not off the ridge, where they would stand in the way of the view down it, nor one upon another.)
      if (inside(m, x, z) > -22 - r || m.needles.some((n) => Math.hypot(n.x - x, n.z - z) < n.r + r + 14)) continue;
      // Their tops below the top of the mountain, some only a little: from the rim one looks down on them, or across at them.
      m.needles.push({ x: round(x), z: round(z), r: round(r), height: round(Math.max(20, (F - m.deck) * q.range(0.6, 1.3))) });
    }
  }
  // Sights: on crests of the country round about that stand near the cloud's level, a castle, a tower, a ruin, a monument;
  // far apart, and each where the ground falls away from it, so that it stands against the cloud or the sky.
  {
    const q = rng.fork('sights'), kinds = ['castle', 'tower', 'ruin', 'monument', 'castle', 'tower'] as const;
    m.sights = [];
    for (let tries = 0, want = q.int(4, 6); tries < 1500 && m.sights.length < want; tries++) {
      const a = q.range(0, TAU), d = q.range(650, 2700), x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d, y = countryAt(m, F, x, z).y;
      if (y < m.deck - 12 || y > m.deck + 110) continue;
      // (A crest: higher than the ground forty metres off on every side, and not by so much that it is a needle's point.)
      let top = true, fallen = 0;
      for (let k = 0; k < 8 && top; k++) { const h = countryAt(m, F, x + Math.cos(k * 0.785) * 40, z + Math.sin(k * 0.785) * 40).y; top = h < y + 1; fallen = Math.max(fallen, y - h); }
      if (!top || fallen > 55 || m.sights.some((p) => Math.hypot(p.x - x, p.z - z) < 520)) continue;
      m.sights.push({ kind: kinds[m.sights.length % kinds.length], x: round(x), z: round(z), y: round(y) });
    }
  }
  site.mountain = m;

  // The box that holds the top and the ridge.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  m.rim.forEach((r, k) => {
    const a = (k / N) * TAU, x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  });
  for (const [x, z] of m.spur.crest ?? [m.spur.from, m.spur.to]) { x0 = Math.min(x0, x - m.spur.width); x1 = Math.max(x1, x + m.spur.width); z0 = Math.min(z0, z - m.spur.width); z1 = Math.max(z1, z + m.spur.width); }
  site.grounds = { x0: round(x0), x1: round(x1), z0: round(z0), z1: round(z1) };
}

/**
 * Lays out the gallery way, if the mountain will hold one. It is found in terms of bearings from
 * the top's middle: it starts beside the head of the ridge, goes round one side of the mountain
 * to the bearing of a point on the climb that lies near the rim, and there turns in and comes up
 * to that point. Round the mountain it keeps to the face at its own level: at each bearing it
 * stands where the rock is as high as it is, a little cut in; but it does not follow the face
 * out round a buttress or far into a gully. It keeps near a line drawn smoothly round the top,
 * and where the face stands out beyond that line, it goes through the rock.
 */
function layGallery(site: Site, m: Mountain, F: number, rng: Rng): void {
  const round = (v: number) => Math.round(v * 10) / 10;
  const way = m.way, climb = m.climb;
  if (!way || !climb || climb.length < 12) return;
  // The land as it is with the way and the climb made, which the gallery must fit.
  const surf = (x: number, z: number) => landAt(m, F, x, z, true);
  // A line round the top that does not go out round its spurs or in up its gullies: the rim, evened out.
  const even = m.rim.map((_, k) => { let sum = 0; for (let j = -3; j <= 3; j++) sum += m.rim[(k + j + N) % N]; return sum / 7; });
  const refAt = (a: number) => Math.min(ringAt(even, a), rimAt(m, a) + 4);
  const at = (a: number, r: number): [number, number] => [m.x + Math.cos(a) * r, m.z + Math.sin(a) * r];
  const spurAt = Math.atan2(m.spur.from[1] - m.z, m.spur.from[0] - m.x);
  const clear = (m.spur.width / 2 + 12) / rimAt(m, spurAt);
  /** Where the face stands at a level, along a bearing: how far out the rock is still that high (and a little more), near the even line. */
  const faceAt = (a: number, y: number): { r: number; through: boolean } => {
    const ref = refAt(a);
    let r = ref - 14;
    for (let t = ref + 12; t > ref - 14; t -= 0.5) { const [x, z] = at(a, t); if (surf(x, z) >= y + 1.2) { r = t; break; } }
    return { r: Math.min(ref + 2.5, r + 0.4), through: r + 0.4 > ref + 2.5 };
  };
  // Where it ends: at a point of the climb's upper part. On that point's bearing it turns in from the
  // face, comes up through the rock by a stair onto the top a little way in from the rim, and goes on
  // over the open top to the climb.
  const climbLen = [0];
  for (let k = 1; k < climb.length; k++) climbLen.push(climbLen[k - 1] + Math.hypot(climb[k][0] - climb[k - 1][0], climb[k][1] - climb[k - 1][1]));
  const total = climbLen[climbLen.length - 1], IN = 13;
  let best: { dir: number; span: number; start: number; k: number; yP: number; yE: number; rE: number; y1: number; w: number } | null = null, bestScore = -Infinity;
  for (let k = 3; k < climb.length - 4; k += 2) {
    const share = climbLen[k] / total;
    if (share < 0.35 || share > 0.9) continue;
    const [tx, tz, ty] = climb[k], aT = Math.atan2(tz - m.z, tx - m.x), rT = Math.hypot(tx - m.x, tz - m.z), d = refAt(aT) - rT;
    if (d < IN + 12 || d > 150) continue;
    // Where the face stands on that bearing a few metres under the top; where the way comes out on the top, a stair's length in
    // from there; and how steeply the path from there must climb to the climb.
    const [ux, uz] = at(aT, refAt(aT) - 5), rP = faceAt(aT, surf(ux, uz) - 5).r, rE = rP - IN;
    const [ex, ez] = at(aT, rE), yE = surf(ex, ez);
    if (rE - rT < 10 || Math.abs(ty - yE) / (rE - rT) > 0.33 || outside(m.level, ex, ez) < 10) continue;
    // (The path over the top must not cross the climb lower down, the way, or the ground about the house, before it gets there.)
    let crosses = false;
    for (let t = 0; t < rE - rT - 9 && !crosses; t += 3) { const [qx, qz] = at(aT, rE - t); crosses = nearestOn(climb, qx, qz, 8).off < 7 || nearestOn(way, qx, qz, 8).off < 7 || outside(m.level, qx, qz) < 6; }
    if (crosses) continue;
    for (const dir of [1, -1]) {
      const start = spurAt + dir * clear;
      const span = ((((aT - start) * dir) % TAU) + TAU) % TAU;
      if (span < 0.7 || span > TAU - 2 * clear - 0.5) continue;
      // Where it leaves the way: the point of the way on the ridge nearest where it starts on the face.
      const [sx, sz] = at(start, refAt(start));
      let w = 0, near = Infinity;
      for (let i = 0; i < way.length; i++) { const dd = Math.hypot(way[i][0] - sx, way[i][1] - sz); if (dd < near) { near = dd; w = i; } }
      // Its level where it starts on the face: below the top there by some metres, and no further below the way than its first stretch can go down.
      const [fx, fz] = at(start, refAt(start) - 5), y1 = Math.max(way[w][2] - 0.3 * near, Math.min(way[w][2] - 1, surf(fx, fz) - 5.5));
      // Its level where it turns in: far enough under the top for a roof of rock, and no further than its stair can come up.
      const [px, pz] = at(aT, rP - 4), yP = Math.max(yE - 0.46 * IN, Math.min(yE - 0.3 * IN, surf(px, pz) - 4.5));
      const length = span * (refAt(start) + refAt(aT)) / 2, grade = (yP - y1) / length;
      if (Math.abs(grade) > 0.24 || length < 90) continue;
      // The longer round the better, to a point; and the higher up the climb it comes in.
      const score = -Math.abs(length - 240) * 0.08 + share * 25 - Math.abs(grade) * 60 - d * 0.1 + rng.range(0, 8);
      if (score > bestScore) { bestScore = score; best = { dir, span, start, k, yP, yE, rE, y1, w }; }
    }
  }
  if (!best) return;
  const { dir, span, start, k: joins, yP, yE, rE, y1, w } = best;
  const aT = start + dir * span;
  const steps = Math.max(8, Math.round((span * (refAt(start) + refAt(aT)) / 2) / 2));
  // Round the mountain: twice over, since where it stands depends on its level, and its level on how far it has come.
  // Its galleries: two to four stretches where it leaves the face on purpose and runs some strides inside
  // the rock, alongside the face, lit by windows cut out to it. (As well as wherever a buttress makes it.)
  const inset = new Float32Array(steps + 1);
  {
    const q = rng.fork('through');
    for (let made = 0, tries = 0, want = q.int(2, 4); made < want && tries < 60; tries++) {
      const len = q.int(8, 17), a = q.int(5, Math.max(6, steps - len - 7));
      if (a + len > steps - 6) continue;
      let free = true;
      for (let i = a - 8; i <= a + len + 8 && free; i++) free = i < 0 || i > steps || inset[i] === 0;
      if (!free) continue;
      for (let i = a; i <= a + len; i++) inset[i] = 6.5 * smooth((Math.min(i - a, a + len - i) + 1) / 4);
      made++;
    }
  }
  let levels = Array.from({ length: steps + 1 }, (_, i) => y1 + ((yP - y1) * i) / steps);
  let pts: [number, number][] = [];
  for (let pass = 0; pass < 2; pass++) {
    const radii: number[] = [];
    for (let i = 0; i <= steps; i++) radii.push(faceAt(start + (dir * span * i) / steps, levels[i]).r);
    // (Evened a little along its length, so that it does not jink at every ledge of the face.)
    const ease = (from: number[]) => from.map((_, i) => { let sum = 0, n = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j <= steps) { sum += from[j]; n++; } return sum / n; });
    const eased = ease(ease(radii));
    pts = eased.map((r, i) => at(start + (dir * span * i) / steps, r - inset[i]));
    const along = [0];
    for (let i = 1; i <= steps; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // (It sags a little between its ends, to keep well under the top.)
    levels = along.map((dd) => y1 + ((yP - y1) * dd) / (along[steps] || 1) - 3 * Math.sin((Math.PI * dd) / (along[steps] || 1)));
  }
  // Straight stretches, a point every two metres: from the way to its start on the face; from where it
  // turns in, up through the rock to the top; and from there over the top to the climb, at the land's own
  // heights eased to a path's grade.
  const line: [number, number, number][] = [];
  const leg = (a: [number, number, number], b: [number, number, number], ends: boolean) => {
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let i = ends ? 0 : 1; i < n; i++) line.push([round(a[0] + ((b[0] - a[0]) * i) / n), round(a[1] + ((b[1] - a[1]) * i) / n), round(a[2] + ((b[2] - a[2]) * i) / n)]);
  };
  // (Where it comes out on the top is reckoned again from where the face has turned out to stand: a stair's length in
  // from there, or further if the top is too high over it for a stair so short.)
  const rLast = Math.hypot(pts[steps][0] - m.x, pts[steps][1] - m.z), rT = Math.hypot(climb[joins][0] - m.x, climb[joins][1] - m.z);
  let ex = 0, ez = 0, out = NaN;
  for (let len = IN; len <= (m.terrain ? 44 : 30) && rLast - len - rT > 6 && Number.isNaN(out); len++) {
    [ex, ez] = at(aT, rLast - len);
    const y = surf(ex, ez);
    if (y - yP <= 0.5 * len && y - yP > -1) out = y;
  }
  if (Number.isNaN(out)) return;
  void yE; void rE;
  leg(way[w], [pts[0][0], pts[0][1], levels[0]], true);
  const linkEnd = line.length;
  for (let i = 0; i <= steps; i++) line.push([round(pts[i][0]), round(pts[i][1]), round(levels[i])]);
  leg([pts[steps][0], pts[steps][1], levels[steps]], [ex, ez, out], false);
  {
    const [tx, tz, ty] = climb[joins], n = Math.max(2, Math.round(Math.hypot(tx - ex, tz - ez) / 2));
    // (Not ruled straight across the top: it bows to one side, whichever keeps it clear of the edge, the house, the way and the climb.)
    const d = Math.hypot(tx - ex, tz - ez) || 1, lineOf = (bow: number) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, off = bow * Math.sin(Math.PI * t); return [ex + (tx - ex) * t - ((tz - ez) / d) * off, ez + (tz - ez) * t + ((tx - ex) / d) * off] as [number, number]; });
    const clearOf = (pts: [number, number][]) => pts.every(([x, z], i) => inside(m, x, z) > 6 && outside(m.level, x, z) > 6 && nearestOn(way, x, z, 8).off > 7 && (i > n - 5 || nearestOn(climb, x, z, 8).off > 6));
    const want = Math.min(20, d * 0.22) * (rng.fork('bow').chance(0.5) ? 1 : -1);
    const over = [want, -want, want / 2, -want / 2].map(lineOf).find(clearOf) ?? lineOf(0);
    line.push(...levelLine(over, surf, out, ty, 0.34));
  }
  // Which of it is under the rock: wherever the land stands well over a man's height above it. (Not its first stretch, down from the way.)
  const deep = line.map(([x, z, y], i) => i >= linkEnd && surf(x, z) - y > 3.3);
  // (A tunnel shorter than a few strides is a cutting; a gap in one shorter than that is not opened.)
  const runsOf = (flags: boolean[], want: boolean) => { const out: [number, number][] = []; for (let i = 0; i < flags.length; i++) { if (flags[i] !== want) continue; let e = i; while (e + 1 < flags.length && flags[e + 1] === want) e++; out.push([i, e]); i = e; } return out; };
  for (const [a, b] of runsOf(deep, false)) if (a > linkEnd && b < line.length - 3 && b - a < 1) for (let i = a; i <= b; i++) deep[i] = true;
  for (const [a, b] of runsOf(deep, true)) if (b - a < 2) for (let i = a; i <= b; i++) deep[i] = false;
  const under = runsOf(deep, true);
  // Windows: where a tunnel runs near the face, an opening is cut out to it every few strides.
  const windows: NonNullable<Mountain['gallery']>['windows'] = [];
  for (const [a, b] of under) for (let i = a + 2; i <= b - 2; i += 3) {
    const [x, z, y] = line[i], out = Math.atan2(z - m.z, x - m.x);
    for (let t = 1.5; t <= 9; t += 0.5) {
      if (surf(x + Math.cos(out) * t, z + Math.sin(out) * t) > y + 0.9) continue;
      windows.push({ x, z, y: round(y + 1), out: Math.round(out * 1000) / 1000, reach: round(t + 1.5) });
      break;
    }
  }
  m.gallery = { line, under, windows, joins };
  for (const run of galleryRuns(m.gallery).open) (site.paths ??= []).push({ points: run.map(([x, z]) => [x, z] as [number, number]), to: 'gallery' });
}

/**
 * Lays out the scramble: the third way to the summit, the shortest and the hardest. It leaves the climb low down, a little way
 * out from the house, crosses the top to the summit's far side in one long curve, and goes straight up the summit's far ridge, an
 * arête with a drop on either hand, to come out on the platform by the cairn from the side the climb does not come up. Its last
 * part is as steep as a stair cut in the rock may be, and has a chain to hold.
 */
function layScramble(site: Site, m: Mountain, F: number, rng: Rng): void {
  const round = (v: number) => Math.round(v * 10) / 10;
  const climb = m.climb, way = m.way, c = m.cairn;
  if (!climb || !way || !c || climb.length < 20) return;
  const plain0 = (x: number, z: number) => landAt(m, F, x, z, false);
  const gal = m.gallery?.line ?? [];
  // The side the climb comes up onto the summit from; the scramble comes from the other side.
  const arrive = Math.atan2(climb[climb.length - 5][1] - c.z, climb[climb.length - 5][0] - c.x);
  let best: { line: [number, number][]; steepFrom: number; branch: number; yFoot: number; score: number } | null = null;
  const why: Record<string, number> = {};
  const no = (k: string) => { why[k] = (why[k] ?? 0) + 1; };
  for (let tries = 0; tries < 1500; tries++) {
    // Where it comes up: a bearing from the summit well round from the climb's.
    const aEnd = arrive + (rng.chance(0.5) ? 1 : -1) * rng.range(1.0, Math.PI);
    // How far out the arête's foot is: far enough that from there to the top is no steeper than a stair cut in the rock. The arête is
    // built up as a ridge where the land under it is lower, and cut down where it is higher.
    const rFoot = rng.range(40, 135), fx = c.x + Math.cos(aEnd) * rFoot, fz = c.z + Math.sin(aEnd) * rFoot;
    if (inside(m, fx, fz) < 7) { no('foot at edge'); continue; }
    const ground0 = plain0(fx, fz), lowest = Math.max(c.y - 0.58 * (rFoot - 3.4), ground0 - 8), highest = Math.min(ground0 + 5, c.y - 12);
    if (lowest > highest) { no('arete steep'); continue; }
    // Where it leaves the climb: low down, a fifth to two fifths of the way up, off the level ground.
    const branch = Math.round(climb.length * rng.range(0.08, 0.45));
    const [sx, sz, sy] = climb[branch];
    if (outside(m.level, sx, sz) < 5) { no('branch on level'); continue; }
    // Round the flank: one point out on the side of the summit, between where it starts and the arête's foot, going round the side the climb is not on.
    const aStart = Math.atan2(sz - c.z, sx - c.x), side = rng.chance(0.5) ? 1 : -1;
    let span = ((aEnd - aStart) * side % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (span > Math.PI * 1.6) { no('span'); continue; }
    const aMid = aStart + side * span * rng.range(0.4, 0.6), rMid = Math.max(rFoot, Math.hypot(sx - c.x, sz - c.z)) * rng.range(0.85, 1.15);
    const mid: [number, number] = [c.x + Math.cos(aMid) * rMid, c.z + Math.sin(aMid) * rMid];
    const end: [number, number] = [c.x + Math.cos(aEnd) * 3.4, c.z + Math.sin(aEnd) * 3.4];
    // (The approach and the arête are one curve: no corner at the arête's foot.)
    const approachCtrl: [number, number][] = [[sx, sz], mid, [fx, fz]];
    // (Not ruled straight either: an arête bends as the rock it is cut in bends, once or twice, and the path keeps to its crest.)
    const ax = end[0] - fx, az = end[1] - fz, al = Math.hypot(ax, az) || 1, sway = rng.chance(0.5) ? 1 : -1, bendA = sway * rng.range(0.55, 1) * Math.min(22, al * 0.2), bendB = -sway * rng.range(0.35, 0.8) * Math.min(13, al * 0.12);
    const areteCtrl: [number, number][] = [[fx + ax * 0.35 - (az / al) * bendA, fz + az * 0.35 + (ax / al) * bendA], [fx + ax * 0.72 - (az / al) * bendB, fz + az * 0.72 + (ax / al) * bendB], end];
    // (Nor a hairpin there: the way into the foot and the way up the arête may not turn back on each other.)
    const inH = Math.atan2(fz - mid[1], fx - mid[0]), outH = Math.atan2(areteCtrl[0][1] - fz, areteCtrl[0][0] - fx);
    if (Math.abs(turnBetween(inH, outH)) > 1.75) { no('hairpin'); continue; }
    const line = curveThrough([...approachCtrl, ...areteCtrl]);
    let footAt = 0;
    for (let k = 1; k < line.length; k++) if (Math.hypot(line[k][0] - fx, line[k][1] - fz) < Math.hypot(line[footAt][0] - fx, line[footAt][1] - fz)) footAt = k;
    const approach = line.slice(0, footAt + 1), nA = line.length - footAt - 1;
    // Clear of the edge, the house, the way, the gallery way, and of the climb except where it leaves it; and not across the summit early.
    let fail = '';
    for (let k = 0; k < line.length && !fail; k++) {
      const [x, z] = line[k], onArete = k > line.length - nA - 1;
      if (inside(m, x, z) < 4.5) fail = 'c-edge';
      else if (outside(m.level, x, z) < 5) fail = 'c-house';
      else if (nearestOn(way, x, z, 9).off < 8) fail = 'c-way';
      else if (gal.length && nearestOn(gal, x, z, 9).off < 6) fail = 'c-gallery';
      // (Where the arête comes up onto the summit it may come near the climb's last strides, which arrive at the same platform.)
      else if (Math.hypot(x - sx, z - sz) > 14 && !(onArete && Math.hypot(x - c.x, z - c.z) < 12) && nearestOn(climb, x, z, 10).off < 9) fail = onArete ? 'c-climb-arete' : 'c-climb';
      else if (!onArete && Math.hypot(x - c.x, z - c.z) < rFoot * 0.7) fail = 'c-summit';
    }
    if (fail) { no(fail); continue; }
    const lenA = approach.reduce((sum, p, k) => (k ? sum + Math.hypot(p[0] - approach[k - 1][0], p[1] - approach[k - 1][1]) : 0), 0);
    // The arête's foot stands at its own ground, or lower if the approach cannot climb so far at a path's grade.
    // (The arête's foot at whatever level both its own climb and the approach's allow, as near the ground there as may be.)
    const lo = Math.max(lowest, sy - lenA * 0.34), hi = Math.min(highest, sy + lenA * 0.34);
    if (lo > hi) { no('levels'); continue; }
    const yFoot = Math.min(hi, Math.max(lo, ground0));
    // A long approach and a long arête make the better scramble; a steep arête is the point of it.
    const score = Math.min(lenA, 220) * 0.08 + rFoot * 0.3 + ((c.y - yFoot) / (rFoot - 3.4)) * 20 + rng.range(0, 4);
    if (!best || score > best.score) best = { line, steepFrom: approach.length - 1, branch, yFoot, score };
  }
  // (Why candidates were turned down, for tuning: `DBG_S=1` before a tool prints it.)
  if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DBG_S) console.log('scramble', JSON.stringify(why));
  if (!best) return;
  const { line, steepFrom, branch, yFoot } = best;
  const sy = climb[branch][2];
  // Levels: over the approach, from the climb's level to the arête's foot, by the land's own heights eased to a path's grade (it may go
  // down as well as up); then up the arête at an even grade, as steep as it must be.
  const approachLevels = levelLine(line.slice(0, steepFrom + 1), plain0, sy, yFoot, 0.36);
  const lenArete = line.slice(steepFrom).reduce((sum, p, k, all) => (k ? sum + Math.hypot(p[0] - all[k - 1][0], p[1] - all[k - 1][1]) : 0), 0);
  let run = 0;
  const areteLevels = line.slice(steepFrom + 1).map((p, k) => { const prev = line[steepFrom + k]; run += Math.hypot(p[0] - prev[0], p[1] - prev[1]); return [round(p[0]), round(p[1]), round(yFoot + ((c.y - yFoot) * run) / lenArete)] as [number, number, number]; });
  m.scramble = { line: [...approachLevels, ...areteLevels], branch, steep: steepFrom };
  (site.paths ??= []).push({ points: m.scramble.line.map(([x, z]) => [x, z] as [number, number]), to: 'scramble' });
}

/**
 * The worn land of a mountain whose land is worn: the plain shape on a lattice, given detail and worn
 * by water and frost. Made when first asked for, and made again if the shape it was made from has
 * changed since (a summit lowered to fit the climb). The ground levelled for the house is left as it is.
 */
const FIELDS = new WeakMap<Mountain, { sig: number[]; field: HeightField }>();
function fieldOf(m: Mountain, floor: number): HeightField {
  // (What the plain shape was made from, compared number by number: this is asked for at every point of the land, and must be quick.)
  const had = FIELDS.get(m), crest = m.spur.crest?.length ?? 0;
  if (had) {
    const s = had.sig;
    let same = s[0] === floor && s[1] === crest && s[2] === m.spur.y0 && s[3] === m.spur.y1 && s.length === 4 + m.peaks.length;
    for (let k = 0; same && k < m.peaks.length; k++) same = s[4 + k] === m.peaks[k].height;
    if (same) return had.field;
  }
  const field = wornLand(m, floor);
  FIELDS.set(m, { sig: [floor, crest, m.spur.y0, m.spur.y1, ...m.peaks.map((p) => p.height)], field });
  return field;
}

/** How the land is worn; kept here, and open, so that the relief tool (`tools/terrain.ts`) can try others. */
export const WEAR = {
  /** Detail on the top and on the slopes below it, in metres, and the breadth of its broadest wave. */
  topDetail: 4, slopeDetail: 16, detailScale: 150,
  /** How much of the wear the walkable top and the ridge are spared, 0 to 1. */
  spare: 0.85,
  /** How deep the water may cut below the detailed land, and how high it may build, in metres. */
  cut: 26, fill: 12,
  water: { drops: 1.2, life: 60, inertia: 0.1, capacity: 0.6, erode: 0.12, deposit: 0.2, evaporate: 0.015, gravity: 4, radius: 4, most: 0.6 },
  frost: { passes: 2, repose: 2.4, rate: 0.35 },
};

function wornLand(m: Mountain, floor: number): HeightField {
  const t = m.terrain!, rng = new Rng(`terrain/${t.seed}`);
  // Over the top and the ridge, and far enough out that the slopes have gone down into the cloud.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < N; k++) { const a = (k / N) * TAU, r = rimAt(m, a), x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (const [x, z] of m.spur.crest ?? [m.spur.from, m.spur.to]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const M = 150, cell = t.cell;
  const f = new HeightField(Math.floor((x0 - M) / cell) * cell, Math.floor((z0 - M) / cell) * cell, cell, Math.ceil((x1 - x0 + 2 * M) / cell) + 2, Math.ceil((z1 - z0 + 2 * M) / cell) + 2);
  const plainShape = new Float32Array(f.data.length), detailed = new Float32Array(f.data.length), keep = new Float32Array(f.data.length), pads = new Float32Array(f.data.length);
  for (let j = 0; j < f.nz; j++) for (let i = 0; i < f.nx; i++) {
    const x = f.x0 + i * cell, z = f.z0 + j * cell, k = j * f.nx + i;
    const y = baseLand(m, floor, x, z), within = inside(m, x, z);
    plainShape[k] = y;
    // The house's ground is not to be touched at all; the walkable top and the ridge's crest are mostly spared, so the water
    // notches their edges but does not cut back into them.
    const pad = 1 - smooth((outside(m.level, x, z) - 4) / 14);
    pads[k] = pad;
    keep[k] = Math.max(pad, WEAR.spare * smooth((within + 1) / 5));
    // Detail: a few metres on the top, more on the slopes below the rim and the ridge, where the rock is.
    const below = smooth(-within / 22);
    detailed[k] = y + (WEAR.topDetail + (WEAR.slopeDetail - WEAR.topDetail) * below) * landDetail(x, z, WEAR.detailScale, t.seed) * (1 - pad);
  }
  f.data.set(detailed);
  wearByWater(f, rng.fork('water'), { ...WEAR.water, keep });
  // (However long the water has been at it, it has not cut the mountain away: its depth is bounded, so the shape decided stays;
  // and on the walkable top and the ridge's crest bounded by how far they are spared, so that a gully notches the edge but does not
  // cut back into the top, where the carved rock would stand over it and the fences, laid by the land, would miss the drop.)
  for (let k = 0; k < f.data.length; k++) { const free = 1 - keep[k]; f.data[k] = Math.max(detailed[k] - WEAR.cut * free, Math.min(detailed[k] + WEAR.fill * free, f.data[k])); }
  wearByFrost(f, WEAR.frost.passes, WEAR.frost.repose, WEAR.frost.rate, keep);
  for (let k = 0; k < f.data.length; k++) f.data[k] += (plainShape[k] - f.data[k]) * pads[k];
  return f;
}
