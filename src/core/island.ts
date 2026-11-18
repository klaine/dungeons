import { fbm2, Rng } from './rng';
import { archipelago, findIslands, frameHeight, islandDetail, islandFrame, IslandSpot } from './archipelago';
import { HeightField, leastPath, smoothLine, wornLattice } from './terrain';
import { Building, Island, Place, Site } from './site';
import { footprintOf, planClassical } from './building';

/**
 * An island in the sea. Where a valley is a strip of land between two lines of rock, an island
 * is land inside one line, its coast, which falls to the sea in cliffs; a cove is bitten out of
 * one side of it, round as a bowl, with a narrow mouth to the sea and a beach at its head, and
 * that is where anyone comes ashore. The house stands on the high ground at the island's back,
 * well in from the cliffs, and the land comes down from it through a hollow to the beach, where
 * the fishermen live. A lighthouse stands on the headland furthest from the cove, and now and
 * then a castle on another.
 *
 * Everything here is in the site document's terms; the builder realises it. The plain shape of
 * the land is given here too (`landAt`), so that what is placed on it and what is built of it
 * agree.
 */

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const TAU = Math.PI * 2;
/** The difference between two bearings, from -π to π. */
export const turnBetween = (a: number, b: number) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

/** How far the top of the cliffs lies from the island's middle at a bearing. */
export function coastAt(o: Island, angle: number): number {
  const n = o.coast.length, a = ((angle / TAU) * n % n + n) % n, i = Math.floor(a), t = a - i, u = t * t * (3 - 2 * t);
  return o.coast[i % n] + (o.coast[(i + 1) % n] - o.coast[i % n]) * u;
}

/** A soft minimum: the lesser of two, with the corner where they meet rounded over `k`. */
function softMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * How far a point is inside the land: more than nothing on the island, less out in the sea or the
 * cove. Roughly a distance in metres near the coast, which is all it is asked to be.
 */
export function inland(o: Island, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z, r = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
  // (Measured along the bearing, which is near enough square to the coast wherever the coast is not swinging sharply. On an island
  // that was found, whose coast has inlets running alongside the bearings, it is measured truly, from a field worked out from the land.)
  const sea = o.terrain ? coastField(o) : null;
  const coast = sea && sea.holds(x, z) ? sea.at(x, z) : coastAt(o, angle) - r;
  const c = o.cove, cr = Math.hypot(x - c.x, z - c.z);
  const bowl = cr - coveRim(o, Math.atan2(z - c.z, x - c.x));
  // The channel: from the middle of the cove out along its bearing to the open sea, wandering a little and not of one width.
  const ux = Math.cos(c.out), uz = Math.sin(c.out), along = (x - c.x) * ux + (z - c.z) * uz, side = -(x - c.x) * uz + (z - c.z) * ux;
  const s = c.x * 0.37 + c.z * 0.11, bend = c.mouth * 0.3 * Math.sin(along / 13 + s) * smooth(along / Math.max(8, c.r * 0.7));
  const wide = (c.mouth / 2) * (1 + 0.5 * (fbm2(along / 9 + s, 3.3, 2, 67) - 0.5));
  // (Behind the middle of the cove the channel is only a round end, which the bowl takes in.)
  const channel = along > 0 ? Math.abs(side - bend) - wide : Math.hypot(side, along) - c.mouth / 2;
  // (The two headlands either side of the mouth are rounded off, not left as points.)
  let d = softMin(coast, softMin(bowl, channel, 6), 5);
  // Along the open coast the cliff line is not a smooth curve: it stands out in buttresses where the rock is harder and is cut back
  // in gullies where a fault or a softer bed has given way. (Not round the cove, whose rim is its own, and where the quay, the stair
  // and the cave are cut; nor on the beach.)
  const near = 1 - smooth((Math.abs(d) - 3) / 12);
  if (near > 0) {
    const ridge = 1 - Math.abs(fbm2(x / 15 + s, z / 15, 3, 71) * 2 - 1);
    const cren = 3.4 * (ridge - 0.5) + 1.4 * (fbm2(x / 5.5, z / 5.5 + s, 2, 73) - 0.5);
    const fade = smooth((cr - c.r * 1.25 - 8) / 10) * (1 - beachness(o, x, z));
    d += cren * near * fade;
  }
  return d;
}

/**
 * How far the cove's rim lies from its middle at a bearing: not a circle. Round its head, where the beach is, a smooth sweep, as
 * a beach is; elsewhere its walls stand in and out, in bays and buttresses, by a fifth of its breadth or so.
 */
export function coveRim(o: Island, a: number): number {
  const c = o.cove;
  if (!c.r) return 0;
  const head = Math.atan2(o.z - c.z, o.x - c.x), off = Math.abs(turnBetween(head, a));
  const calm = o.landing === 'stair' ? 0 : 1 - smooth((off - c.beach) / 0.4), s = c.x * 0.37 + c.z * 0.11;
  const w = 0.44 * (fbm2(Math.cos(a) * 1.3 + s, Math.sin(a) * 1.3, 3, 61) - 0.5) + 0.07 * Math.sin(a * 5 + s) + 0.1 * (fbm2(Math.cos(a) * 5 + s, Math.sin(a) * 5, 2, 63) - 0.5);
  return c.r * (1 + w * (1 - 0.85 * calm));
}

/**
 * How far the coast near a point is beach, from 0 to 1: the head of the cove, the part of its rim
 * that faces back into the island. Everywhere else the coast is cliff.
 */
export function beachness(o: Island, x: number, z: number): number {
  // (A cove walled all round by cliff has no beach.)
  if (o.landing === 'stair') return 0;
  const c = o.cove, d = Math.hypot(x - c.x, z - c.z);
  const head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(z - c.z, x - c.x);
  const off = Math.abs(turnBetween(head, at));
  return (1 - smooth((off - c.beach) / 0.32)) * (1 - smooth((d - coveRim(o, at) - o.combe * 0.6) / 20));
}

/** How far a point is from the beach: from the rim of the cove at its head, and more the further round the rim it lies. */
function fromBeach(o: Island, x: number, z: number): number {
  const c = o.cove, d = Math.hypot(x - c.x, z - c.z);
  const head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(z - c.z, x - c.x);
  const off = Math.max(0, Math.abs(turnBetween(head, at)) - c.beach);
  return Math.max(0, d - coveRim(o, at)) + off * (c.r + 10) * 1.6;
}

/** How far a point is outside the ground a classical building stands on, its wings included: nothing within it. */
export function outsideBuilding(b: Building, x: number, z: number): number {
  const turn = b.faces === 'w' ? 1 : -1, u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
  let best = Infinity;
  for (const r of footprintOf(b)) best = Math.min(best, Math.hypot(Math.max(r.u0 - u, 0, u - r.u1), Math.max(r.v0 - v, 0, v - r.v1)));
  return best;
}

/** How far a point is outside a rectangle, or nothing inside it. */
const outside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The plain shape of the land: the top of the island, falling to the sea at its coast. The builder
 * wears the cliffs back from this and carves them, so where they stand differs from it by a
 * stride or two; nothing placed here is placed that near the edge. `floor` is the forecourt's level.
 */
/** Interpolated round the coast's ring of directions, as `coastAt` is: for any table given per direction. */
function ringAt(table: number[], angle: number): number {
  const n = table.length, a = ((angle / TAU) * n % n + n) % n, i = Math.floor(a), t = a - i, u = t * t * (3 - 2 * t);
  return table[i % n] + (table[(i + 1) % n] - table[i % n]) * u;
}

/**
 * The nearest point of a line of points `[x, z, y]` to a point: how far off it is, and the height
 * the line has there. Nothing is looked for further off than `reach`.
 */
function nearestOn(line: [number, number, number][], x: number, z: number, reach: number): { off: number; y: number } {
  // (Each line is indexed once in squares of the ground, so that only the lengths of it near a point are looked at.)
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

/** How high the summits stand at a point, over the forecourt's floor: steep and broken, not domes. */
function summits(o: Island, x: number, z: number): number {
  let h = 0;
  for (const p of o.peaks ?? []) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r) continue;
    // A cone with its flanks hollowed, crested and gullied by ridged noise, so that it reads as rock worn by weather.
    const t = 1 - d / p.r, ridge = 1 - Math.abs(fbm2(x / 23 + p.x * 0.01, z / 23 - p.z * 0.01, 3, 21) * 2 - 1);
    h = Math.max(h, p.height * Math.pow(t, 1.35) * (0.72 + 0.45 * ridge));
  }
  return h;
}

/**
 * The plain shape of the land: the top of the island, falling to the sea at its coast. The builder
 * wears the cliffs back from this and carves them, so where they stand differs from it by a
 * stride or two; nothing placed here is placed that near the edge. `floor` is the forecourt's level.
 * `levelled` says whether what has been made on the land (the ground levelled for buildings, the
 * way, the stair) is to be counted; while it is being laid out, it is not yet.
 */
export function landAt(o: Island, floor: number, x: number, z: number, levelled = true): number {
  const top = topAt(o, floor, x, z);
  return finish(o, x, z, below(o, x, z, levelled ? levelTop(o, floor, x, z, top) : top), levelled);
}

/** The top of the island, before anything is made on it: its swell, its summits, the land rolling between, coming down towards the coast. */
function topAt(o: Island, floor: number, x: number, z: number): number {
  const d = inland(o, x, z);
  let top: number;
  if (o.terrain) {
    // The land as it was found, made fine and worn again (`islandLand`); inside the coast never lower than a little over the sea.
    const f = islandLand(o, floor);
    // (Read on a smooth curve through the lattice, not straight between its points, which left creases a lattice apart.)
    top = f.holds(x, z) ? f.smoothAt(x, z) : frameY(o, floor, x, z);
    if (d > 0) top = Math.max(top, o.sea + 1.5);
    // A stream has cut its bed: flat across the water, with banks that lie back from it. (Only ever taken away.)
    for (const st of o.streams ?? []) {
      const w = nearestOn(st.course, x, z, 6), half = st.width / 2;
      if (w.off < half + 5) top = Math.min(top, w.y + 0.05 * Math.min(1, w.off / half) ** 2 + Math.max(0, w.off - half) * 0.85);
    }
  } else {
  // The top: a swell of high ground, the summits, and the land rolling between, more roughly the higher it stands.
  top = floor + o.crown.height * Math.exp(-((Math.hypot(x - o.crown.x, z - o.crown.z) / o.crown.r) ** 2)) + summits(o, x, z);
  top += (fbm2(x / 38 + 3.1, z / 38 - 1.7, 3, 7) - 0.5) * 6 + (fbm2(x / 11, z / 11, 2, 9) - 0.5) * 0.9;
  }
  // Towards the coast the land comes down, in some stretches all the way to a low rocky shore, in
  // others not at all, so the cliffs are low in one place and the island's full height in the next.
  // (Not on land that was found: its coast is where the land stands at the height its cliff is to have, and the cliff is cut there.)
  if (o.edge && d < 45 && !o.terrain) {
    const e = ringAt(o.edge, Math.atan2(z - o.z, x - o.x)), low = o.sea + 3.5 + 5 * fbm2(x / 19, z / 19, 2, 17);
    top += (Math.min(top, low) - top) * e * (1 - smooth(d / 45));
  }
  // (Land at the cliff top rises a little towards the edge, as turf does where the wind has had the soil off the face below.)
  top += 0.6 * (1 - smooth(d / 10));
  if (o.landing !== 'stair') {
    const beachAt = o.sea + 1.15;
    const b = fromBeach(o, x, z);
    // A strip of beach at the foot of the hollow, a little above high water, and the hollow coming up from it.
    top = beachAt + (top - beachAt) * smooth((b - 7) / o.combe) - 0.9 * (1 - Math.min(1, b / 7));
  }
  return floor + (top - floor) * smooth((outside(o.level, x, z) - 2) / 16);
}

/** The top with what has been made on it: the way cut and made up to its level, and level ground for whatever stands on the land. */
function levelTop(o: Island, floor: number, x: number, z: number, top: number): number {
  // The way is cut and made up to its own level, across a cart's breadth and a little more, and eased into the land beside it.
  const wayAt = o.way ? nearestOn(o.way, x, z, 9) : null;
  if (wayAt && wayAt.off < 9) top += (wayAt.y - top) * (1 - smooth((wayAt.off - 2.6) / 6));
  // What stands on the land has level ground made for it.
  // (Eased into the land over a breadth that grows with the height it has to make up, so that on a knoll or a slope the bank about
  // it is one that can be walked up, not a step.)
  const flat = (x0: number, z0: number, y: number, r: number) => { const w = 1 - smooth((Math.hypot(x - x0, z - z0) - r) / (4 + Math.abs(y - top) * 1.3)); top += (y - top) * w; };
  for (const q of o.cottages) flat(q.x, q.z, q.y, Math.max(q.w, q.d) * 0.62 + 1.2);
  if (o.lighthouse) flat(o.lighthouse.x, o.lighthouse.z, o.lighthouse.y, o.lighthouse.r + 10);
  if (o.castle) flat(o.castle.x, o.castle.z, o.castle.y, 19);
  if (o.chapel) flat(o.chapel.x, o.chapel.z, o.chapel.y, 15);
  if (o.mansion) { const w = 1 - smooth((outsideBuilding(o.mansion.building, x, z) - 3) / 5); top += (o.mansion.y - top) * w; }
  if (o.graveyard) { const q = o.graveyard, w = 1 - smooth((Math.hypot(Math.max(Math.abs(x - q.x) - q.d / 2, 0), Math.max(Math.abs(z - q.z) - q.w / 2, 0)) - 1) / 5); top += (floor - top) * w; }
  // (And on its own breadth the way's level holds over all of that: where the ground levelled for a cottage reaches it on a slope,
  // it would otherwise leave a step in the way. Only its breadth: the cottage keeps its own ground.)
  if (wayAt && wayAt.off < 3.6) top += (wayAt.y - top) * (1 - smooth((wayAt.off - 2.4) / 1.2));
  return top;
}

/** Below the top of the cliff the land goes down to the sea bed: steeply where it is cliff, which the builder turns to rock, and gently under a beach. */
function below(o: Island, x: number, z: number, top: number): number {
  const d = inland(o, x, z);
  if (d >= 0) return top;
  const out = -d, beach = beachness(o, x, z), high = Math.max(0, top - o.sea);
  const bed = o.sea - 2.5 - Math.min(24, out * 0.32) + (fbm2(x / 17, z / 17, 2, 13) - 0.5) * 3;
  // The fall is not one profile all round. In some stretches the face is sheer, in others it leans back; in some it is broken by a
  // ledge halfway, a harder bed; in some fallen rock lies piled at its foot; and in some the waves have cut a platform of rock at
  // the water's level, out from the foot. (Each from noise of a few tens of metres, so that a stretch keeps its character.)
  const v1 = fbm2(x / 55 + 9.1, z / 55, 2, 81), v2 = fbm2(x / 40, z / 40 + 4.4, 2, 83), v3 = fbm2(x / 33 - 2.2, z / 33, 2, 85);
  const sheer = smooth((v1 - 0.35) / 0.3), width = (2.5 + high * 0.2) * (1.7 - 1.25 * sheer);
  let cliff = top + (bed - top) * smooth(out / width);
  const ledged = smooth((v2 - 0.58) / 0.12) * smooth((high - 9) / 6);
  if (ledged > 0) {
    const mid = o.sea + high * (0.35 + 0.25 * v3), shelf = width * 0.7 + 1.5 + 3 * v3;
    const two = out < shelf ? top + (mid - top) * smooth(out / (width * 0.45)) : mid + (bed - mid) * smooth((out - shelf) / (width * 0.6));
    cliff += (two - cliff) * ledged;
  }
  const fallen = smooth((v3 - 0.56) / 0.14) * Math.min(7, 1 + high * 0.3);
  // (A skirt, falling away from the foot to the sea bed: beyond it the bed is as it was.)
  if (fallen > 0 && out > width * 0.5) cliff = Math.max(cliff, bed + (o.sea - 1.5 + fallen - bed) * (1 - smooth((out - width * 0.7) / (5 + high * 0.25))));
  const platform = smooth((v1 - 0.62) / 0.12) * (1 - beach);
  if (platform > 0 && out > width * 0.6) { const reach = width + 3 + 6 * v2; if (out < reach) cliff = Math.max(cliff, o.sea - 0.6 + 0.6 * platform + (fbm2(x / 3, z / 3, 2, 87) - 0.5) * 0.5 - smooth((out - reach + 1.5) / 1.5) * 2); }
  const sand = Math.min(top, o.sea + 0.3) - out * 0.1 - Math.max(0, out - 7) * 0.32;
  return cliff + (Math.max(sand, bed) - cliff) * beach;
}

/** The strand to the sea cave, the stair, and the stacks: made or standing on the land as it otherwise is. */
function finish(o: Island, x: number, z: number, y: number, levelled: boolean): number {
  // A strand of shingle along the foot of the cove's cliff to the sea cave, from the end of the beach or from the quay, so that it can be walked to dry-shod.
  if (o.seaCave) {
    const sc = o.seaCave, c = o.cove, head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(sc.z - c.z, sc.x - c.x);
    const end = head + Math.sign(turnBetween(head, at)) * c.beach * 0.85;
    const [bx, bz] = o.landing === 'stair' ? o.jetty.from : [c.x + Math.cos(end) * (coveRim(o, end) - 1), c.z + Math.sin(end) * (coveRim(o, end) - 1)];
    const dx = sc.x - bx, dz = sc.z - bz, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - bx) * dx + (z - bz) * dz) / l2));
    // (From a quay it starts at the quay's own level, a step lower than its deck, and falls to the cave's floor.)
    const off = Math.hypot(x - bx - dx * t, z - bz - dz * t), strand = o.landing === 'stair' ? o.sea + 1.2 - 0.4 * t : o.sea + 0.55 + 0.25 * t;
    if (off < 5.5 && y < strand) y += (strand - y) * (1 - smooth((off - 2.2) / 3.3));
  }
  // The stair: cut into the face and built out where the face falls away, to its own level, with the rock standing sheer behind it.
  if (levelled && o.stair) {
    const st = nearestOn(o.stair, x, z, 3);
    if (st.off < 2.4) y += (st.y - y) * (1 - smooth((st.off - 1.45) / 0.9));
  }
  // The arch: a span of rock from the cliff top out to its stack, falling away steeply on either hand. (The opening under it is cut
  // by the builder, as the sea cave is: the land is heights, which cannot say "hollow".)
  if (o.arch) {
    const ar = o.arch, [ax, az] = ar.from, [bx, bz] = ar.to, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)), off = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (off < ar.width * 1.2) {
      const span = ar.top - 0.8 * Math.sin(Math.PI * t) - Math.max(0, off - ar.width * 0.35) * 2.2;
      y = Math.max(y, y + (span - y) * (1 - smooth((off - ar.width * 0.5) / (ar.width * 0.35))));
    }
  }
  // Stacks: pillars standing out of the sea off the cliffs, as steep as the cliffs are.
  for (const s of o.stacks) {
    const r = Math.hypot(x - s.x, z - s.z);
    if (r > s.r * 2.2) continue;
    const lump = o.sea + s.height * (1 - 0.35 * smooth((r - s.r * 0.4) / s.r)) ;
    y = Math.max(y, y + (lump - y) * (1 - smooth((r - s.r) / (s.r * 0.55))));
  }
  return y;
}

/** The height of the land an island was found in, at a point of the site, before it is made fine (`archipelago.ts`). */
export function frameY(o: Island, floor: number, x: number, z: number): number {
  const t = o.terrain!, hx = (o.level.x0 + o.level.x1) / 2, hz = (o.level.z0 + o.level.z1) / 2;
  const [u, v] = islandFrame(t, hx, hz, x, z);
  return frameHeight(archipelago(t.seed), u, v) - t.base + floor;
}

/**
 * The land across the water from an island that was found: the rest of the sea of islands it was found in, with detail in fewer
 * octaves the further `out` it lies. (About the island itself the sea has had the low land away, as it cut the cliffs: within a few
 * hundred metres of its coast nothing stands out of the water but the island, which the near land draws.)
 */
export function acrossWater(o: Island, floor: number, x: number, z: number, out: number): number {
  const t = o.terrain!, hx = (o.level.x0 + o.level.x1) / 2, hz = (o.level.z0 + o.level.z1) / 2;
  const [u, v] = islandFrame(t, hx, hz, x, z);
  let y = frameHeight(archipelago(t.seed), u, v, out) - t.base + floor;
  const off = -inland(o, x, z);
  if (off < 400) y = Math.min(y, o.sea - 3 + Math.max(0, off - 120) * 0.12);
  return y;
}

/**
 * How far in from its coast each point of an island that was found lies (out to sea, how far out), on a two-metre lattice. Land is
 * what stands over the height its cliff is to have there (`edge`), on the island the house is on: other land in the lattice is sea.
 */
const COASTS = new WeakMap<Island, { sig: number[]; field: HeightField }>();
let lastCoast: { o: Island; t: object; coast: number[]; edge?: number[]; field: HeightField } | null = null;
function coastField(o: Island): HeightField {
  // (Asked for at nearly every point the builder makes: the last answer is kept, and given again while what it was made from is the same.)
  if (lastCoast && lastCoast.o === o && lastCoast.t === o.terrain && lastCoast.coast === o.coast && lastCoast.edge === o.edge) return lastCoast.field;
  const field = coastFieldOf(o);
  lastCoast = { o, t: o.terrain!, coast: o.coast, edge: o.edge, field };
  return field;
}
function coastFieldOf(o: Island): HeightField {
  const t = o.terrain!, had = COASTS.get(o), sig = [t.seed, t.u, t.v, t.turn, t.shore, o.coast.length, o.coast[0], o.edge?.[0] ?? 0];
  if (had && had.sig.every((v, k) => v === sig[k])) return had.field;
  const cell = 2, hx = (o.level.x0 + o.level.x1) / 2, hz = (o.level.z0 + o.level.z1) / 2, a = archipelago(t.seed);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < o.coast.length; k++) { const an = (k / o.coast.length) * TAU, r = o.coast[k] + 60; x0 = Math.min(x0, o.x + Math.cos(an) * r); x1 = Math.max(x1, o.x + Math.cos(an) * r); z0 = Math.min(z0, o.z + Math.sin(an) * r); z1 = Math.max(z1, o.z + Math.sin(an) * r); }
  x0 = Math.floor(x0 / cell) * cell; z0 = Math.floor(z0 / cell) * cell;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1, f = new HeightField(x0, z0, cell, nx, nz);
  const high = new Uint8Array(nx * nz), core = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, [u, v] = islandFrame(t, hx, hz, x, z), y = frameHeight(a, u, v);
    const cliff = 3 + 13 * (1 - ringAt(o.edge ?? [0], Math.atan2(z - o.z, x - o.x)));
    high[j * nx + i] = y > t.shore + cliff ? 1 : 0;
    core[j * nx + i] = y > t.shore + 9 ? 1 : 0;
  }
  const start = Math.round((hz - z0) / cell) * nx + Math.round((hx - x0) / cell);
  /** What is reached from the house's ground over `over`, and nowhere else. */
  const reached = (over: Uint8Array): Uint8Array => {
    const got = new Uint8Array(nx * nz), queue = [start];
    if (!over[start]) return got;
    got[start] = 1;
    while (queue.length) {
      const k = queue.pop()!, i = k % nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (n >= 0 && n < nx * nz && over[n] && !got[n]) { got[n] = 1; queue.push(n); }
    }
    return got;
  };
  // Distances, to the nearest point of the other kind, by two sweeps of the lattice (a chamfer of three and four, in metres near enough).
  const D1 = cell, D2 = cell * 1.4142;
  const sweep = (dist: Float32Array) => {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!dist[k]) continue; let m = dist[k]; if (i > 0) m = Math.min(m, dist[k - 1] + D1); if (j > 0) { m = Math.min(m, dist[k - nx] + D1); if (i > 0) m = Math.min(m, dist[k - nx - 1] + D2); if (i < nx - 1) m = Math.min(m, dist[k - nx + 1] + D2); } dist[k] = m; }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!dist[k]) continue; let m = dist[k]; if (i < nx - 1) m = Math.min(m, dist[k + 1] + D1); if (j < nz - 1) { m = Math.min(m, dist[k + nx] + D1); if (i < nx - 1) m = Math.min(m, dist[k + nx + 1] + D2); if (i > 0) m = Math.min(m, dist[k + nx - 1] + D2); } dist[k] = m; }
  };
  // The island is what the search found (the land nine metres over the sea, reached from the house), and its own shore, as low as
  // its cliffs are cut, within forty metres of that: not every low shore it touches, which may run on to the next island.
  const kernel = reached(core), near = new Float32Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) near[k] = kernel[k] ? 0 : 1e6;
  sweep(near);
  for (let k = 0; k < nx * nz; k++) high[k] = high[k] && near[k] <= 40 ? 1 : 0;
  const land = reached(high);
  const inside = new Float32Array(nx * nz), outside = new Float32Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) { inside[k] = land[k] ? 1e6 : 0; outside[k] = land[k] ? 0 : 1e6; }
  sweep(inside); sweep(outside);
  // (Half a cell from either side, so that the coast itself lies between a point of land and a point of sea.)
  for (let k = 0; k < nx * nz; k++) f.data[k] = land[k] ? inside[k] - cell / 2 : -(outside[k] - cell / 2);
  COASTS.set(o, { sig, field: f });
  return f;
}

/** How an island's own land is made fine and worn again; open, so that the relief tool can try others. */
export const ISLAND_WEAR = {
  /** Detail laid on, in metres; how far the walkable land is spared the water, 0 to 1. */
  detail: 2.2, spare: 0.5,
  wear: {
    cut: 8, fill: 4,
    water: { drops: 1.2, life: 60, inertia: 0.1, capacity: 0.6, erode: 0.12, deposit: 0.2, evaporate: 0.015, gravity: 4, radius: 3, most: 0.5 },
    frost: { passes: 2, repose: 1.6, rate: 0.35 },
  },
};
const FIELDS = new WeakMap<Island, { sig: number[]; field: HeightField }>();
/**
 * The island's own land, on a two-metre lattice: the land it was found in, with fine detail laid on and worn again by water and frost
 * at that scale. The house's ground is spared, and the sea bed; the rest of the land in part.
 */
let lastLand: { o: Island; t: object; coast: number[]; floor: number; field: HeightField } | null = null;
function islandLand(o: Island, floor: number): HeightField {
  if (lastLand && lastLand.o === o && lastLand.t === o.terrain && lastLand.coast === o.coast && lastLand.floor === floor) return lastLand.field;
  const field = islandLandOf(o, floor);
  lastLand = { o, t: o.terrain!, coast: o.coast, floor, field };
  return field;
}
function islandLandOf(o: Island, floor: number): HeightField {
  const t = o.terrain!, had = FIELDS.get(o), sig = [floor, t.seed, t.u, t.v, t.turn, t.base, o.coast.length];
  if (had && had.sig.every((v, k) => v === sig[k])) return had.field;
  const cell = t.cell, W = ISLAND_WEAR;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < o.coast.length; k++) { const a = (k / o.coast.length) * TAU, r = o.coast[k]; x0 = Math.min(x0, o.x + Math.cos(a) * r); x1 = Math.max(x1, o.x + Math.cos(a) * r); z0 = Math.min(z0, o.z + Math.sin(a) * r); z1 = Math.max(z1, o.z + Math.sin(a) * r); }
  const M = 40;
  x0 = Math.floor((x0 - M) / cell) * cell; z0 = Math.floor((z0 - M) / cell) * cell;
  const nx = Math.ceil((x1 + M - x0) / cell) + 1, nz = Math.ceil((z1 + M - z0) / cell) + 1;
  const keep = (x: number, z: number) => {
    if (frameY(o, floor, x, z) < o.sea + 1) return 1;
    const pad = 1 - smooth((outside(o.level, x, z) - 4) / 14);
    return Math.max(pad, W.spare);
  };
  const shape = (x: number, z: number) => frameY(o, floor, x, z) + W.detail * islandDetail(x, z, t.seed) * (1 - smooth((10 - outside(o.level, x, z)) / 10));
  const field = wornLattice(x0, z0, cell, nx, nz, shape, new Rng(`island-land/${t.seed}`), W.wear, keep, 6);
  FIELDS.set(o, { sig, field });
  return field;
}

/** Where on the stair, if anywhere, a point lies: how far from its middle line, and its level there. */
export function onStair(o: Island, x: number, z: number): { off: number; y: number } {
  return o.stair ? nearestOn(o.stair, x, z, 3) : { off: Infinity, y: 0 };
}

/**
 * Lays out an island round a house whose forecourt is `meadow` and whose door is at `doorX` in
 * the forecourt's north side. Fills in the site's `island`, `grounds`, `track` and `paths`.
 */
export function layOutIsland(site: Site, meadow: Place, doorX: number, rng: Rng, worn = false): void {
  const round = (v: number) => Math.round(v * 10) / 10, T = site.wallThickness, F = meadow.floor;
  const others = site.places.filter((q) => q !== meadow);
  const house = { x0: Math.min(...others.map((q) => q.x0)) - T, x1: Math.max(...others.map((q) => q.x1)) + T, z0: Math.min(...others.map((q) => q.z0)) - T, z1: meadow.z1 };
  site.stands = 'free';
  const level = { x0: round(Math.min(house.x0, meadow.x0) - 6), x1: round(Math.max(house.x1, meadow.x1) + 6), z0: round(house.z0 - 6), z1: round(meadow.z1 + 2) };
  const hx = (level.x0 + level.x1) / 2, hz = (level.z0 + level.z1) / 2;

  // How big the cove is, decided first, since a large one wants a large island round it: from a
  // pool twenty metres across the half of it to a bay three or four times that.
  const coveR = 19 * Math.pow(3.7, Math.pow(rng.fork('cove size').next(), 1.25));
  // If the land comes first, it is found now: an island in a sea of them with ground for the house on it (`archipelago.ts`).
  // (The seas are drawn from a pool of them, so that a sea once made serves every site that looks in it: a page of a dozen islands,
  // or a check of fifty, makes a few seas, not one for each. Each sea holds dozens of islands; which one a site gets is its own.)
  const SEAS = 24, terrainRng = rng.fork('terrain'), want = Math.max(terrainRng.range(110, 160), coveR * 1.45 + 70);
  const first = terrainRng.int(0, SEAS - 1), stride = 1 + 2 * terrainRng.int(0, 5);
  function* candidates(): Generator<{ seed: number; spot: IslandSpot }> {
    for (let tries = 0; tries < 10; tries++) {
      const seed = 4099 + ((first + tries * stride) % SEAS) * 131;
      for (const spot of findIslands(archipelago(seed), level.x1 - level.x0, level.z1 - level.z0, want, terrainRng.fork(`spot${tries}`)).slice(0, 8)) yield { seed, spot };
    }
  }
  let found: { seed: number; spot: IslandSpot } | null = null;
  // The coast. Islands come in kinds: an oval turned any way; a long ridge; two masses joined at a
  // waist; an egg, broad at one end; or a ragged one, all points and inlets. On any of them, two
  // to four headlands stand out, and now and then the sea has worked a narrow inlet into a weakness of the rock.
  const N = 96, shape = rng.fork('coast');
  const kind = rng.fork('island kind').pick(['oval', 'oval', 'long', 'waist', 'egg', 'ragged'] as const);
  const R = Math.max(shape.range(105, 160), coveR * 1.45 + 70), turn = shape.range(0, Math.PI), seed = shape.range(0, 500);
  const squash = kind === 'long' ? shape.range(0.42, 0.6) : kind === 'waist' ? shape.range(0.62, 0.8) : shape.range(0.72, 0.98);
  const pinch = kind === 'waist' ? shape.range(0.22, 0.34) : 0, swell = kind === 'egg' ? shape.range(0.18, 0.3) : 0, ragged = kind === 'ragged' ? 1 : 0;
  const heads = Array.from({ length: shape.int(2, 4) + ragged * shape.int(1, 3) }, () => ({ at: shape.range(0, TAU), out: shape.range(12, 28) * (R / 135), wide: shape.range(0.1, 0.24) * (ragged ? 0.6 : 1) }));
  const inlets = Array.from({ length: shape.int(0, 3) + ragged * shape.int(2, 4) }, () => ({ at: shape.range(0, TAU), into: shape.range(8, 20) * (R / 135), wide: shape.range(0.04, 0.08) }));
  const coastOf = (scale: number) => Array.from({ length: N }, (_, k) => {
    const a = (k / N) * TAU, c = Math.cos(a - turn), s = Math.sin(a - turn);
    let r = R / Math.sqrt(c * c + (s * s) / (squash * squash)) * scale;
    // (A waist draws the sides in across the long way's middle; an egg is broader towards one end.)
    r *= 1 - pinch * s * s + swell * c;
    r *= 1 + (0.2 + 0.1 * ragged) * (fbm2(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, 3) - 0.5) + (0.09 + 0.08 * ragged) * (fbm2(Math.cos(a) * 7 + seed, Math.sin(a) * 7 - seed, 2) - 0.5);
    for (const h of heads) r += h.out * Math.exp(-((turnBetween(h.at, a) / h.wide) ** 2));
    for (const h of inlets) r -= h.into * Math.exp(-((turnBetween(h.at, a) / h.wide) ** 2));
    return round(Math.max(40, r));
  });
  // The house stands near the island's northern side: the middle lies south of it by about half the island's breadth.
  const middle = { x: round(hx + shape.range(-18, 18)), z: round(hz + R * Math.max(squash, 0.7) * shape.range(0.42, 0.55)) };
  // (Higher over the sea than a valley's floor over its stream: the island stands out of deep water.)
  let sea = round(F - shape.range(20, 32));
  const island: Island = {
    x: middle.x, z: middle.z, coast: coastOf(1), sea,
    cove: { x: 0, z: 0, r: 0, out: 0, mouth: 0, beach: 0 }, crown: { x: 0, z: 0, r: 40, height: 0 }, combe: 60, level,
    jetty: { from: [0, 0], to: [0, 0], width: 3 }, cottages: [], boats: [], stacks: [], mainland: { bearing: 0, spread: 1, distance: 1500 }, islets: [],
  };
  /** Finds the cove; whether one would fit. */
  const layCove = (): boolean => {
    island.cove = { x: 0, z: 0, r: 0, out: 0, mouth: 0, beach: 0 };
    // The cove: on the island's south side, away from the house, its head facing back towards the
    // middle. A small one is a bowl inside the cliffs with a narrow way in; a large one lies further
    // out and opens wider, a bay. If none of the size wanted will fit, a smaller is tried.
    const coving = rng.fork('cove');
    for (let r = coveR; !island.cove.r && r > 15; r *= 0.88) {
      for (let tries = 0; tries < 50; tries++) {
        const out = Math.PI / 2 + coving.range(-1.05, 1.05), big = Math.min(1, (r - 19) / 50);
        const edge = coastAt(island, out), back = edge - r * coving.range(1 - 0.45 * big, 1.05 - 0.2 * big) - coving.range(4, 11);
        const c = { x: round(island.x + Math.cos(out) * back), z: round(island.z + Math.sin(out) * back), r: round(r), out, mouth: round(Math.max(11, r * coving.range(0.45, 0.6 + 0.7 * big))), beach: coving.range(0.55, 0.85) };
        const toMiddle = Math.hypot(island.x - c.x, island.z - c.z) || 1;
        const headX = c.x + ((island.x - c.x) / toMiddle) * r, headZ = c.z + ((island.z - c.z) / toMiddle) * r;
        const room = outside(level, headX, headZ);
        // Round its rim, except at its mouth, the rock between it and the open sea is never a thin fin: the cliffs would be carved through.
        const half = Math.asin(Math.min(1, c.mouth / 2 / r)) + 0.45;
        let thin = false;
        for (let k = 0; k < 48 && !thin; k++) {
          const t = (k / 48) * TAU;
          if (Math.abs(turnBetween(t, out)) < half) continue;
          const px = c.x + Math.cos(t) * (r + 14), pz = c.z + Math.sin(t) * (r + 14);
          thin = coastAt(island, Math.atan2(pz - island.z, px - island.x)) < Math.hypot(px - island.x, pz - island.z);
        }
        if (thin) continue;
        if (room < 52 || back < r * 0.5 + 20 || coastAt(island, Math.atan2(headZ - island.z, headX - island.x)) - Math.hypot(headX - island.x, headZ - island.z) < 10) continue;
        island.cove = c;
        island.combe = round(Math.min(coving.range(55, 80), room - 10));
        break;
      }
    }
    return island.cove.r > 0;
  };
  // Grown until the house and its level ground lie well inside the cliffs.
  const corners = [[level.x0, level.z0], [level.x1, level.z0], [level.x0, level.z1], [level.x1, level.z1], [hx, level.z0]];
  // (On land that was found, measured truly, from the land: its coast has inlets that a ring of distances from the middle does not.)
  const margin = () => Math.min(...corners.map(([x, z]) => (island.terrain ? coastField(island).at(x, z) : coastAt(island, Math.atan2(z - island.z, x - island.x)) - Math.hypot(x - island.x, z - island.z))));
  if (!worn) for (let grow = 1; grow < 1.8 && margin() < 18; grow += 0.05) island.coast = coastOf(grow);
  else for (const cand of candidates()) {
    found = cand;
    // The land that was found: its middle, the sea's level, and its coast, read off it. The coast is where the land stands at the
    // height its cliff is to have there, which differs round the island: a low rocky shore here, a cliff fifteen metres high there.
    // Beyond that the sea has had the land away, and the cliff is cut (`below`).
    const sp = found.spot, c = Math.cos(sp.turn), sn = Math.sin(sp.turn), du = sp.cu - sp.u, dv = sp.cv - sp.v;
    island.terrain = { seed: found.seed, cell: 1.5, u: sp.u, v: sp.v, turn: sp.turn, base: Math.round(sp.base * 100) / 100, shore: Math.round(sp.sea * 100) / 100 };
    island.x = round(hx + c * du + sn * dv); island.z = round(hz - sn * du + c * dv);
    island.sea = sea = round(F - (island.terrain.base - island.terrain.shore));
    const q = rng.fork('cliffs'), s0 = q.range(0, 500), sharp = q.range(0.12, 0.2);
    const cliffAt = (a: number) => 3 + 13 * smooth((fbm2(Math.cos(a) * 1.3 + s0, Math.sin(a) * 1.3, 3) - 0.42) / sharp);
    const height = (x: number, z: number) => frameY(island, F, x, z);
    island.coast = Array.from({ length: N }, (_, k) => {
      const a = (k / N) * TAU, at = island.sea + cliffAt(a);
      let r = 0;
      while (r < sp.reach + 60 && height(island.x + Math.cos(a) * r, island.z + Math.sin(a) * r) > at) r += 1;
      return round(Math.max(30, r - 1));
    });
    island.edge = Array.from({ length: N }, (_, k) => round(1 - (cliffAt((k / N) * TAU) - 3) / 13));
    // (Read again off the true coast, which is of this island alone: where it joins other land at a low shore, the first reading runs on.)
    const shoreField = coastField(island);
    island.coast = island.coast.map((was, k) => {
      const a = (k / N) * TAU;
      let r = 0;
      while (r < was + 40 && shoreField.at(island.x + Math.cos(a) * r, island.z + Math.sin(a) * r) > 0) r += 1;
      return round(Math.max(30, r - 1));
    });
    // (And the cove must fit on it: if it will not, the next island found is tried.)
    if (margin() >= 16 && layCove()) break;
    found = null;
  }
  if (worn && !found) throw new Error(`no island found has room for the house and a cove (seed ${site.seed})`);
  if (!found) { delete island.terrain; layCove(); }

  if (!island.cove.r) throw new Error(`no cove would fit the island (seed ${site.seed})`);
  const cove = island.cove;
  const headAngle = Math.atan2(island.z - cove.z, island.x - cove.x);
  // The high ground: towards the back of the island, away from the cove.
  {
    const q = rng.fork('crown'), a = cove.out + Math.PI + q.range(-0.9, 0.9), at = coastAt(island, a) * q.range(0.35, 0.6);
    island.crown = { x: round(island.x + Math.cos(a) * at), z: round(island.z + Math.sin(a) * at), r: round(q.range(40, 70)), height: round(q.range(3, 9)) };
    // (On land that was found, the crown is where it stands highest, and is only a record: the land is what it is.)
    if (island.terrain) {
      let best = -Infinity;
      for (let k = 0; k < 400; k++) { const a2 = q.range(0, TAU), r2 = coastAt(island, a2) * Math.sqrt(q.next()) * 0.9, x = island.x + Math.cos(a2) * r2, z = island.z + Math.sin(a2) * r2, y = frameY(island, F, x, z); if (y > best) { best = y; island.crown = { x: round(x), z: round(z), r: 50, height: round(y - F) }; } }
    }
  }
  const plain = (x: number, z: number) => landAt(island, F, x, z, false);

  // How the island is come to: up from a beach, or, about half the time, by a stair cut in the cliff of a cove walled all round by rock.
  island.landing = rng.fork('landing').chance(0.5) ? 'stair' : 'beach';
  // The point on the cove's rim where the landing is, for keeping the way up to the house clear: the head of the cove, or the quay.
  const halfMouth = Math.asin(Math.min(1, cove.mouth / 2 / cove.r));
  let landA = headAngle;
  if (island.landing === 'stair') {
    const q = rng.fork('quay');
    for (let tries = 0; tries < 30; tries++) {
      landA = headAngle + (q.chance(0.5) ? 1 : -1) * q.range(0.25, 1.1);
      if (Math.abs(turnBetween(landA, cove.out)) > halfMouth + 0.7) break;
    }
  }
  const landX = cove.x + Math.cos(landA) * coveRim(island, landA), landZ = cove.z + Math.sin(landA) * coveRim(island, landA);

  // The coast comes down to a low rocky shore in some stretches and stands at the island's full height in others.
  if (!island.terrain) {
    const q = rng.fork('edge'), s0 = q.range(0, 500), sharp = q.range(0.08, 0.16);
    island.edge = Array.from({ length: N }, (_, k) => {
      const a = (k / N) * TAU;
      // (Where the landing is a stair, the cove stands at its full height all round, or there would be little to climb.)
      const toCove = Math.abs(turnBetween(a, Math.atan2(cove.z - island.z, cove.x - island.x)));
      const keep = island.landing === 'stair' ? smooth((toCove - 0.5) / 0.4) : 1;
      return Math.round(smooth((fbm2(Math.cos(a) * 1.3 + s0, Math.sin(a) * 1.3, 3) - 0.52) / sharp) * keep * 100) / 100;
    });
  }
  // Summits: one to three, steep and broken, standing clear of the house's level ground and of the way down from it to the landing.
  {
    const q = rng.fork('peaks'), want = kind === 'long' || kind === 'ragged' ? q.int(2, 3) : q.int(1, 2), scale = R / 135;
    const toLanding = (x: number, z: number) => {
      const dx = landX - hx, dz = landZ - hz, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - hx) * dx + (z - hz) * dz) / l2));
      return Math.hypot(x - hx - dx * t, z - hz - dz * t);
    };
    island.peaks = [];
    // (Land that was found has its own hills.)
    for (let tries = 0; tries < 300 && island.peaks.length < want && !island.terrain; tries++) {
      const r = q.range(32, 70) * scale, height = q.range(18, 64), a = q.range(0, TAU), at = coastAt(island, a) * Math.sqrt(q.next()) * 0.85;
      const x = island.x + Math.cos(a) * at, z = island.z + Math.sin(a) * at;
      if (inland(island, x, z) < r * 0.2) continue;
      // (The house may stand on a shoulder of one, on ground cut level for it; but not under its crest.)
      if (outside(level, x, z) < r * 0.3 + 8) continue;
      if (Math.hypot(x - cove.x, z - cove.z) < cove.r + r * 0.5) continue;
      if (toLanding(x, z) < r * 0.6 + 6) continue;
      if (island.peaks.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.6)) continue;
      island.peaks.push({ x: round(x), z: round(z), r: round(r), height: round(height) });
    }
  }

  // The landing. At a beach, the jetty runs out from the sand a little to one side of the head of
  // the cove. At a stair, the quay stands at the foot of the cove's cliff, and the stair climbs from
  // it along the cliff's face, cut into the rock a stride or so in from the face, at one in two,
  // until it comes out on the top; where it would run into the cove's mouth it turns back on itself,
  // its next flight cut further in.
  if (island.landing === 'beach') {
    const q = rng.fork('jetty'), a = headAngle + q.range(-0.35, 0.35) * cove.beach, ux = -Math.cos(a), uz = -Math.sin(a);
    const rimX = cove.x + Math.cos(a) * coveRim(island, a), rimZ = cove.z + Math.sin(a) * coveRim(island, a), length = q.range(14, Math.min(22, cove.r * 0.8));
    island.jetty = { from: [round(rimX - ux * 4), round(rimZ - uz * 4)], to: [round(rimX + ux * length), round(rimZ + uz * length)], width: round(q.range(2.6, 3.4)) };
  } else {
    const q = rng.fork('jetty');
    // (Measured in from the rim towards the middle of the cove, `out` metres: the face falls from the rim to its foot.)
    const at = (a: number, out: number) => plain(cove.x + Math.cos(a) * (coveRim(island, a) - out), cove.z + Math.sin(a) * (coveRim(island, a) - out));
    let foot = 0;
    while (foot < 30 && at(landA, foot) > sea - 0.4) foot += 0.25;
    const rimL = coveRim(island, landA), ux = -Math.cos(landA), uz = -Math.sin(landA), rx = cove.x + Math.cos(landA) * (rimL - foot + 1), rz = cove.z + Math.sin(landA) * (rimL - foot + 1);
    const length = q.range(10, Math.min(16, cove.r * 0.55));
    island.jetty = { from: [round(rx), round(rz)], to: [round(rx + ux * length), round(rz + uz * length)], width: round(q.range(3, 3.8)) };
    const deck = sea + 1.35, stair: [number, number, number][] = [[round(rx), round(rz), round(deck)]];
    // Which way along the face it climbs: towards the head of the cove first, where the land is nearest the house.
    let dir = Math.sign(turnBetween(landA, headAngle)) || 1, a = landA, y = deck, flight = 0, travelled = 0, done = false;
    const STEP = 0.6, CUT = 1.4, APART = 3.7;
    let prev = rimL - foot + 1;
    const put = (r: number, h: number) => stair.push([round(cove.x + Math.cos(a) * r), round(cove.z + Math.sin(a) * r), round(h)]);
    for (let i = 0; i < 900 && !done; i++) {
      // Where on the face this level comes: as far in from the foot as the face stands that high, and a little further.
      let out = foot;
      while (out > -12 && at(a, out) < y + CUT) out -= 0.2;
      const top = plain(cove.x + Math.cos(a) * (Math.max(prev, coveRim(island, a)) + 1), cove.z + Math.sin(a) * (Math.max(prev, coveRim(island, a)) + 1));
      if (y >= top - 0.4 || out <= -12) {
        // Out on the top: a few strides on inland, level with it.
        for (const more of [1.5, 3, 4.5]) put(prev + more, y);
        done = true;
        break;
      }
      // (It keeps to the face, but never swings in or out by more than half a stride at a step.)
      const radius = Math.min(prev + 0.5, Math.max(prev - 0.5, coveRim(island, a) - out + APART * flight));
      const next = a + (dir * STEP) / radius;
      if (Math.abs(turnBetween(next, cove.out)) < halfMouth + 0.85 || travelled > Math.PI * 1.5) {
        // A landing, level, going in a stride or two into the rock; then back the other way, the next flight cut further in.
        dir = -dir; flight++; travelled = 0;
        if (flight > 3) break;
        for (let k = 1; k <= Math.round(APART / 0.6); k++) put(prev + k * 0.6, y);
        prev += APART;
        continue;
      }
      a = next; y += STEP * 0.5; travelled += STEP / radius; prev = radius;
      put(radius, y);
    }
    if (done) island.stair = stair;
    else {
      // (Where no stair will fit, the cove has a beach after all.)
      island.landing = 'beach';
      const a2 = headAngle, ux2 = -Math.cos(a2), uz2 = -Math.sin(a2), rimX = cove.x + Math.cos(a2) * coveRim(island, a2), rimZ = cove.z + Math.sin(a2) * coveRim(island, a2);
      island.jetty = { from: [round(rimX - ux2 * 4), round(rimZ - uz2 * 4)], to: [round(rimX + ux2 * 16), round(rimZ + uz2 * 16)], width: 3 };
    }
  }

  // The track: from the door across the forecourt, then wandering down to the landing: the head of the jetty, or of the stair.
  const stairway = island.stair;
  const root: [number, number] = stairway ? [stairway[stairway.length - 1][0], stairway[stairway.length - 1][1]] : island.jetty.from;
  const track: [number, number][] = [[doorX, meadow.z0], [doorX, meadow.z1 - 4]];
  // On land that was found, the track goes where a track would have been worn: by the way of least effort over the land, round a
  // hill and not over it, along a slope and not up it, clear of the cliffs and round the cove, wandering a little where nothing
  // decides it.
  let routed = false;
  /**
   * A way of least effort over the land, from (`sx`, `sz`) to (`ex`, `ez`): round hills rather than over them, along slopes rather
   * than up them, clear of the cliff edge but for its last strides into `ex`, `ez`, off the house's ground but for its first strides,
   * and round whatever `blocked` says stands in the way; wandering a little where nothing decides it; smoothed, a point every three
   * metres or so. Null if there is no way.
   */
  const routeOver = (sx: number, sz: number, ex: number, ez: number, label: string, blocked: (x: number, z: number) => boolean = () => false): [number, number][] | null => {
    const C = 3;
    let bx0 = Math.min(sx, ex), bx1 = Math.max(sx, ex), bz0 = Math.min(sz, ez), bz1 = Math.max(sz, ez);
    for (let k = 0; k < N; k++) { const a = (k / N) * TAU, r = island.coast[k]; bx0 = Math.min(bx0, island.x + Math.cos(a) * r); bx1 = Math.max(bx1, island.x + Math.cos(a) * r); bz0 = Math.min(bz0, island.z + Math.sin(a) * r); bz1 = Math.max(bz1, island.z + Math.sin(a) * r); }
    const gx0 = Math.floor(bx0 / C) * C, gz0 = Math.floor(bz0 / C) * C, gnx = Math.ceil((bx1 - gx0) / C) + 1, gnz = Math.ceil((bz1 - gz0) / C) + 1;
    const hs = new Float32Array(gnx * gnz), inl = new Float32Array(gnx * gnz), wander = new Float32Array(gnx * gnz), stop = new Uint8Array(gnx * gnz), s0 = rng.fork(`wander ${label}`).range(0, 300);
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
      const x = gx0 + i * C, z = gz0 + j * C, k = j * gnx + i;
      hs[k] = plain(x, z); inl[k] = inland(island, x, z); wander[k] = fbm2(x / 40 + s0, z / 40, 2, 23); stop[k] = blocked(x, z) ? 1 : 0;
    }
    const cost = (a: number, b: number) => {
      const ax = a % gnx, az = (a - ax) / gnx, bxx = b % gnx, bzz = (b - bxx) / gnx, len = Math.hypot(bxx - ax, bzz - az) * C;
      const x = gx0 + bxx * C, z = gz0 + bzz * C, grade = Math.abs(hs[b] - hs[a]) / len;
      // (Near where it ends it must come to the edge: the cliffs and the cove are kept clear of only away from it.)
      const away = smooth((Math.hypot(x - ex, z - ez) - 5) / 9);
      if (stop[b] && away > 0.5) return Infinity;
      let c = len * (1 + 10 * grade * grade + 0.5 * wander[b]);
      // (Steeper than a cart can go, it goes the long way round, along the slope.)
      if (grade > 0.22) c += len * 400 * (grade - 0.22);
      if (inl[b] < 12) c += len * 40 * away * (1 - inl[b] / 12);
      // (And never at the very edge, but where it comes down to the landing.)
      if (inl[b] < 6 && away > 0.2) return Infinity;
      // (Not back across the forecourt and the house's ground: it leaves them by the way it came out of the door.)
      if (outside(level, x, z) <= 0 && Math.hypot(x - sx, z - sz) > 6) c += len * 200;
      return c;
    };
    const line = leastPath(gx0, gz0, C, gnx, gnz, [sx, sz], [ex, ez], cost);
    if (!line) return null;
    // (Smoothed, and a point every three metres or so; leaving the forecourt it goes straight on south a little way first.)
    const smoothed = smoothLine(label === 'track' ? [[sx, sz], [sx, sz + 6], ...line.slice(2)] : line, 3);
    // (And never ruled straight, even where the land would let it be: a worn path wanders a stride or two from side to side, in
    // long bends and short, as feet have gone round a stone or a wet place. Not at its ends.)
    {
      const wq = rng.fork(label === 'track' ? 'track wander' : `wander/${label}`), p1 = wq.range(0, TAU), p2 = wq.range(0, TAU), along = [0];
      for (let k = 1; k < smoothed.length; k++) along.push(along[k - 1] + Math.hypot(smoothed[k][0] - smoothed[k - 1][0], smoothed[k][1] - smoothed[k - 1][1]));
      const total = along[along.length - 1], base = smoothed.map((p0) => [p0[0], p0[1]] as [number, number]), amp = label === 'track' ? 1 : 0.6;
      const offs = base.map((_, k) => (k === 0 || k === base.length - 1 ? 0 : amp * (3.4 * Math.sin(along[k] / 24 + p1) + 1.1 * Math.sin(along[k] / 8.5 + p2)) * smooth(along[k] / 14) * smooth((total - along[k]) / 16)));
      const lay = () => { for (let k = 1; k < base.length - 1; k++) { const [ax, az] = base[k - 1], [bx, bz] = base[k + 1], l = Math.hypot(bx - ax, bz - az) || 1; smoothed[k] = [base[k][0] - ((bz - az) / l) * offs[k], base[k][1] + ((bx - ax) / l) * offs[k]]; } };
      lay();
      // (Where the way bends sharply, a wander wider than the bend would fold it back on itself: there it is cut back until it does not.)
      for (let pass = 0; pass < 8; pass++) {
        let folded = false;
        for (let k = 1; k < smoothed.length - 1; k++) {
          const ux = smoothed[k][0] - smoothed[k - 1][0], uz = smoothed[k][1] - smoothed[k - 1][1], vx = smoothed[k + 1][0] - smoothed[k][0], vz = smoothed[k + 1][1] - smoothed[k][1], l = Math.hypot(ux, uz) * Math.hypot(vx, vz);
          if (l > 0 && (ux * vx + uz * vz) / l < 0.5) { folded = true; for (let j = Math.max(1, k - 4); j <= Math.min(offs.length - 2, k + 4); j++) offs[j] *= 0.5; }
        }
        if (!folded) break;
        lay();
      }
    }
    const out: [number, number][] = [];
    let last: [number, number] = [sx, sz];
    for (const p0 of smoothed.slice(1, -1)) {
      // (Smoothing cuts corners, round an inlet too: a point it brings near the edge is moved back inland, away from the nearest water.)
      let [x, z] = p0;
      for (let i = 0; i < 24 && inland(island, x, z) < 7 && Math.hypot(x - ex, z - ez) > 12; i++) {
        const gx = inland(island, x + 1, z) - inland(island, x - 1, z), gz = inland(island, x, z + 1) - inland(island, x, z - 1), gl = Math.hypot(gx, gz) || 1;
        x += (gx / gl) * 0.8; z += (gz / gl) * 0.8;
      }
      if (Math.hypot(x - last[0], z - last[1]) > 3) { out.push([round(x), round(z)]); last = [x, z]; }
    }
    // (Its end exactly, and no point just short of it: a step a hand long reads as a wall in a level line.)
    if (out.length && Math.hypot(ex - last[0], ez - last[1]) < 2) out.pop();
    out.push([round(ex), round(ez)]);
    return out;
  };
  if (island.terrain) {
    const routedLine = routeOver(track[1][0], track[1][1], root[0], root[1], 'track');
    if (routedLine) { track.push(...routedLine); routed = true; }
  }
  if (!routed) {
    const q = rng.fork('track');
    const [sx, sz] = track[1], length = Math.hypot(root[0] - sx, root[1] - sz), steps = Math.max(3, Math.round(length / 9));
    const bend = q.range(-1, 1) * Math.min(18, length * 0.2), phase = q.range(0, Math.PI);
    // Where it has further to climb than its length allows at a path's slope, it winds, in bends a long stride or two apart.
    const climb = Math.abs(F - (stairway ? stairway[stairway.length - 1][2] : plain(root[0], root[1]))), wanted = climb / 0.24;
    const wave = 28, swing = wanted > length * 1.02 ? Math.min(26, (wave / (Math.PI * 2)) * Math.sqrt((wanted / length) ** 2 - 1)) : 0;
    const many = Math.max(steps, Math.round(length / 3));
    // (Its last point is the landing itself, put there exactly.)
    for (let k = 1; k < many; k++) {
      const t = k / many;
      let bx = sx + (root[0] - sx) * t, bz = sz + (root[1] - sz) * t;
      const ax = -(root[1] - sz) / length, az = (root[0] - sx) / length;
      // (It goes round the cove, not across it: a point that would fall over the water is set back on the rim's land.)
      const fromCove = Math.hypot(bx - cove.x, bz - cove.z), keep = cove.r + 14;
      if (fromCove < keep && t < 0.999) { bx = cove.x + ((bx - cove.x) / (fromCove || 1)) * keep; bz = cove.z + ((bz - cove.z) / (fromCove || 1)) * keep; }
      // (Leaving the forecourt it goes straight on south a little way first, and it comes straight to the landing.)
      const wind = swing * Math.sin((t * length * Math.PI * 2) / wave) * smooth(t / 0.15) * smooth((1 - t) / 0.12);
      let x = bx, z = bz;
      // (A bend that would take it out over the cliffs is drawn in, as far as it must be.)
      for (let f = 1; f >= -0.01; f -= 0.1) {
        const away = Math.sin(t * Math.PI + phase * 0.3) * bend * (1 - t * 0.6) * f + wind * f;
        x = bx + ax * away * smooth(t / 0.3); z = bz + az * away * smooth(t / 0.3);
        if (inland(island, x, z) >= 12 || t >= 0.999) break;
      }
      // Kept clear of the cliffs: drawn in towards the middle where it would go near them.
      // Kept clear of the cliffs: moved away from the nearest water, uphill in how far it is inland, where it would go near them.
      for (let i = 0; i < 24 && inland(island, x, z) < 12 && t < 0.97; i++) {
        const gx = inland(island, x + 1, z) - inland(island, x - 1, z), gz = inland(island, x, z + 1) - inland(island, x, z - 1), gl = Math.hypot(gx, gz) || 1;
        x += (gx / gl) * 1.2; z += (gz / gl) * 1.2;
      }
      track.push([round(x), round(z)]);
    }
    track.push([round(root[0]), round(root[1])]);
  }
  // (No point is left that turns the track back on itself, as the pushing off the cliffs can: a hairpin a stride long is a step for whoever walks it.)
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 2; k < track.length - 1; k++) {
      const [ax, az] = track[k - 1], [bx, bz] = track[k], [cx, cz] = track[k + 1];
      const ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz, lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 1.2 || (lu * lv > 0 && (ux * vx + uz * vz) / (lu * lv) < -0.2)) { track.splice(k, 1); changed = true; break; }
    }
  }
  // The way's level line: the land's own heights along it, smoothed, then eased wherever they climb
  // more steeply than one in three, with its ends held at the forecourt and at the landing.
  {
    const pts: [number, number, number][] = [];
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
      for (let j = 0; j < n; j++) pts.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n, 0]);
    }
    pts.push([root[0], root[1], 0]);
    // (No two points nearer than a stride: the level line is written to a tenth of a metre, and points closer than that would make it seem to jump.)
    for (let i = pts.length - 2; i > 0; i--) if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 1.2) pts.splice(i, 1);
    let h = pts.map(([x, z]) => plain(x, z));
    const first = F, last = stairway ? stairway[stairway.length - 1][2] : plain(root[0], root[1]);
    for (let pass = 0; pass < 3; pass++) h = h.map((_, i) => { let sum = 0, n = 0; for (let j = i - 4; j <= i + 4; j++) if (j >= 0 && j < h.length) { sum += h[j]; n++; } return sum / n; });
    // (Each point is held within what can be climbed to it from either end, so the ends are always reached; between, no step is steeper than the slope allowed.)
    const SLOPE = 0.34, along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = along[along.length - 1];
    const lo = along.map((d) => Math.max(first - d * SLOPE, last - (total - d) * SLOPE)), hi = along.map((d) => Math.min(first + d * SLOPE, last + (total - d) * SLOPE));
    const fit = (i: number, v: number) => (lo[i] <= hi[i] ? Math.min(hi[i], Math.max(lo[i], v)) : (lo[i] + hi[i]) / 2);
    h = h.map((v, i) => fit(i, v));
    for (let pass = 0; pass < 40; pass++) {
      for (let i = 1; i < h.length; i++) { const ds = (along[i] - along[i - 1]) * SLOPE; h[i] = fit(i, Math.min(h[i - 1] + ds, Math.max(h[i - 1] - ds, h[i]))); }
      for (let i = h.length - 2; i >= 0; i--) { const ds = (along[i + 1] - along[i]) * SLOPE; h[i] = fit(i, Math.min(h[i + 1] + ds, Math.max(h[i + 1] - ds, h[i]))); }
    }
    island.way = pts.map(([x, z], i) => [round(x), round(z), round(h[i])]);
  }
  // From the landing out to where the player arrives: down the stair to the quay, and out along the jetty.
  if (stairway) for (let k = stairway.length - 2; k >= 0; k--) track.push([stairway[k][0], stairway[k][1]]);
  track.push([island.jetty.to[0], island.jetty.to[1]]);
  site.track = track;
  const fromTrack = (px: number, pz: number): number => {
    let best = Infinity;
    for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2));
      best = Math.min(best, Math.hypot(px - ax - (bx - ax) * t, pz - az - (bz - az) * t));
    }
    return best;
  };
  // (What is built is set on the ground as it is with the way made, and with what was built before it.)
  const made = (x: number, z: number) => landAt(island, F, x, z, true);
  // What can be walked to from the house, on a lattice two metres fine: ground no steeper than a
  // path can be, joined to the forecourt. Nothing anybody is meant to reach is put anywhere else.
  const REACH = 2, rx0 = Math.floor(Math.min(...island.coast.map((r, k) => island.x + Math.cos((k / N) * TAU) * r)) - 10), rz0 = Math.floor(Math.min(...island.coast.map((r, k) => island.z + Math.sin((k / N) * TAU) * r)) - 10);
  const rnx = Math.ceil((Math.max(...island.coast.map((r, k) => island.x + Math.cos((k / N) * TAU) * r)) + 10 - rx0) / REACH) + 1, rnz = Math.ceil((Math.max(...island.coast.map((r, k) => island.z + Math.sin((k / N) * TAU) * r)) + 10 - rz0) / REACH) + 1;
  const walk = new Uint8Array(rnx * rnz);
  {
    const H = new Float32Array(rnx * rnz), dry = new Uint8Array(rnx * rnz);
    for (let j = 0; j < rnz; j++) for (let i = 0; i < rnx; i++) {
      const x = rx0 + i * REACH, z = rz0 + j * REACH, k = j * rnx + i;
      H[k] = made(x, z);
      dry[k] = inland(island, x, z) > 2.5 && H[k] > sea + 0.8 ? 1 : 0;
    }
    const queue: number[] = [];
    const start = Math.round((meadow.z1 - 3 - rz0) / REACH) * rnx + Math.round(((meadow.x0 + meadow.x1) / 2 - rx0) / REACH);
    walk[start] = 1; queue.push(start);
    while (queue.length) {
      const k = queue.pop()!, i = k % rnx, j = Math.floor(k / rnx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, n = jj * rnx + ii;
        if (ii < 0 || jj < 0 || ii >= rnx || jj >= rnz || walk[n] || !dry[n] || Math.abs(H[n] - H[k]) > REACH * 0.7) continue;
        walk[n] = 1; queue.push(n);
      }
    }
  }
  const reached = (x: number, z: number) => {
    const i = Math.round((x - rx0) / REACH), j = Math.round((z - rz0) / REACH);
    return i >= 0 && j >= 0 && i < rnx && j < rnz && walk[j * rnx + i] === 1;
  };
  const taken: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number) => taken.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + r) && outside(level, x, z) > r + 4;

  // The fishermen's cottages: on the slope above the beach, either side of the track, fronts to it or to the sea.
  {
    const q = rng.fork('cottages'), want = q.int(3, 7);
    const washes: [number, number, number][] = [[0.9, 0.89, 0.84], [0.88, 0.86, 0.8], [0.86, 0.87, 0.86], [0.92, 0.88, 0.78], [0.78, 0.82, 0.84], [0.9, 0.84, 0.76]];
    for (let tries = 0; tries < 900 && island.cottages.length < want; tries++) {
      const along = q.range(0.4, 0.98), k = Math.min(track.length - 3, Math.floor(along * (track.length - 3)) + 1);
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l = Math.hypot(bx - ax, bz - az) || 1, side = q.chance(0.5) ? 1 : -1;
      const w = round(q.range(6.4, 9.5)), d = round(q.range(4.6, 5.6)), off = d / 2 + q.range(3.2, tries > 300 ? 14 : 6.5);
      const t = q.next();
      let x = ax + (bx - ax) * t + (-(bz - az) / l) * side * off, z = az + (bz - az) * t + ((bx - ax) / l) * side * off;
      // Half the tries, after the first, are along the rim of the cove above the beach, in a row looking out over the water.
      if (tries % 2 === 1) {
        const a = Math.atan2(island.z - cove.z, island.x - cove.x) + q.range(-1, 1) * (cove.beach + 0.35), at = coveRim(island, a) + q.range(7, 16);
        x = cove.x + Math.cos(a) * at; z = cove.z + Math.sin(a) * at;
      }
      const r = Math.max(w, d) * 0.62 + 1.6;
      if (fromTrack(x, z) < d / 2 + 2.6 || inland(island, x, z) < r + 4 || !clear(x, z, r + 1.5) || !reached(x, z)) continue;
      // Not on ground too steep to level: no more than a man's height between the corners.
      let lo = Infinity, hi = -Infinity;
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const y = plain(x + cx * w * 0.55, z + cz * w * 0.55); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      if (hi - lo > 3.4 || lo < sea + 1.4) continue;
      // Nor where its level ground, eased into the land about it, would pull the track out of its own grade: the ground is levelled for a
      // house after the track is cut, and a house standing much below the track beside it left a step in the track too steep to walk.
      const pad = Math.max(w, d) * 0.62 + 1.2, level = made(x, z);
      if ((island.way ?? []).some(([wx, wz, wy]) => { const past = Math.hypot(wx - x, wz - z) - pad; return past < 4 && Math.abs(level - wy) * (1 - smooth(past / 4)) > 0.45; })) continue;
      // Front to the track, or, now and then, gable to it and front to the sea.
      const toTrack = Math.atan2(-((bx - ax) / l) * side, (bz - az) / l * side);
      const faces = tries % 2 === 0 && q.chance(0.7) ? toTrack : Math.atan2(cove.z - z, cove.x - x);
      island.cottages.push({ x: round(x), z: round(z), y: round(made(x, z)), w, d, faces: Math.round(faces * 1000) / 1000, roof: q.chance(0.55) ? 'thatch' : 'slate', wash: q.pick(washes) });
      taken.push({ x, z, r });
    }
  }

  // The lighthouse: on the most prominent point near the coast, well round from the cove and from the house. Prominent as a
  // lighthouse's place must be: near the edge, with the sea on as many sides as may be within a short walk (the end of a headland
  // sees sea over most of the horizon, a point on a straight coast over half of it), and high.
  const toHouse = Math.atan2(hz - island.z, hx - island.x);
  {
    const q = rng.fork('lighthouse');
    const spots: { x: number; z: number; score: number }[] = [];
    const R = Math.max(...island.coast);
    for (let x = island.x - R; x <= island.x + R; x += 5) for (let z = island.z - R; z <= island.z + R; z += 5) {
      const d = inland(island, x, z);
      if (d < 13 || d > 24) continue;
      const a = Math.atan2(z - island.z, x - island.x);
      if (Math.abs(turnBetween(a, cove.out)) < 1.0 || Math.abs(turnBetween(a, toHouse)) < 0.5 || Math.hypot(x - hx, z - hz) < 60) continue;
      let open = 0;
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * TAU;
        for (let r = 10; r <= 45; r += 5) if (inland(island, x + Math.cos(t) * r, z + Math.sin(t) * r) < 0) { open++; break; }
      }
      spots.push({ x, z, score: (open / 24) * 10 + (plain(x, z) - sea) * 0.08 + q.range(0, 0.4) });
    }
    spots.sort((p0, p1) => p1.score - p0.score);
    for (let tries = 0; tries < Math.min(30, spots.length); tries++) {
      const { x, z } = spots[tries];
      if (inland(island, x, z) < 13 || !clear(x, z, 13)) continue;
      // (Its door must be got to on foot.)
      if (!reached(x + Math.cos(Math.atan2(island.z - z, island.x - x)) * 6, z + Math.sin(Math.atan2(island.z - z, island.x - x)) * 6)) continue;
      const lh = { x: round(x), z: round(z), y: round(made(x, z)), r: round(q.range(2.9, 3.4)), height: round(q.range(15, 22)), door: Math.round(Math.atan2(island.z - z, island.x - x) * 1000) / 1000 };
      // The keeper's cottage, in the yard beside the tower, its front the way the tower's door looks.
      const side = q.chance(0.5) ? 1 : -1, ka = lh.door + side * 1.75, kr = lh.r + 5.2;
      const keeper = { x: round(x + Math.cos(ka) * kr), z: round(z + Math.sin(ka) * kr), y: lh.y, w: 6.2, d: 4.6, faces: lh.door, roof: 'slate' as const, wash: [0.92, 0.91, 0.88] as [number, number, number] };
      if (inland(island, keeper.x, keeper.z) < 9) continue;
      island.lighthouse = lh;
      island.cottages.push(keeper);
      taken.push({ x, z, r: 14 });
      break;
    }
  }

  // A castle, in about half the islands, on another headland: it wants twenty metres of level ground every way.
  {
    const q = rng.fork('castle');
    if (q.chance(0.55)) for (let tries = 0; tries < 80; tries++) {
      const a = q.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.9 || Math.abs(turnBetween(a, toHouse)) < 0.7) continue;
      if (island.lighthouse && Math.abs(turnBetween(a, Math.atan2(island.lighthouse.z - island.z, island.lighthouse.x - island.x))) < 1.0) continue;
      const back = coastAt(island, a) - q.range(26, 32), x = island.x + Math.cos(a) * back, z = island.z + Math.sin(a) * back;
      if (inland(island, x, z) < 22 || !clear(x, z, 24) || fromTrack(x, z) < 26) continue;
      if (!reached(x - Math.cos(a) * 14, z - Math.sin(a) * 14)) continue;
      island.castle = { x: round(x), z: round(z), y: round(made(x, z)), facing: Math.round(a * 1000) / 1000 };
      taken.push({ x, z, r: 24 });
      break;
    }
    // Where there is no castle, now and then a mansion: a stuccoed classical house standing back from a headland, its front to the sea.
    const m = rng.fork('mansion');
    if (!island.castle && m.chance(0.45)) for (let tries = 0; tries < 120 && !island.mansion; tries++) {
      const a = m.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.8 || Math.abs(turnBetween(a, toHouse)) < 0.6) continue;
      if (island.lighthouse && Math.abs(turnBetween(a, Math.atan2(island.lighthouse.z - island.z, island.lighthouse.x - island.x))) < 0.8) continue;
      // From a pavilion of three windows to a front of nine; two or three storeys, the principal one tall.
      const bays = m.pick([3, 5, 5, 7, 7, 9]), storeys = m.pick([2, 2, 3, 3]), w = round(bays * 2.55 + 1.6), d = round(m.range(9.4, 11.5));
      const heights = [round(m.range(3.4, 4.2)), round(m.range(3.8, 4.8)), ...Array.from({ length: storeys - 2 }, () => round(m.range(2.9, 3.4)))];
      const back = coastAt(island, a) - m.range(24, 32), x = island.x + Math.cos(a) * back, z = island.z + Math.sin(a) * back;
      // (Its front looks out, east or west as the classical houses are built, whichever is the more towards the sea.)
      const faces: 'e' | 'w' = Math.cos(a) > 0 ? 'e' : 'w', turn = faces === 'w' ? 1 : -1;
      const b: Building = { style: 'imperial', x: round(x), z: round(z), w, d, faces, storeys, heights, bays, colour: m.pick([[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78], [0.88, 0.84, 0.72]] as [number, number, number][]), portico: bays >= 7 || (bays === 5 && m.chance(0.5)) };
      if (bays >= 7 && m.chance(0.5)) b.wings = [{ side: m.chance(0.5) ? -1 : 1, width: round(m.range(5.4, Math.min(8.8, w / 2 - 4))), length: round(m.range(7, 11)) }];
      // All of its ground well in from the cliffs, clear of what else is built, on land that can be levelled, and its door reached on foot.
      const corners = footprintOf(b).flatMap((r) => [[r.u0, r.v0], [r.u1, r.v0], [r.u0, r.v1], [r.u1, r.v1]]).map(([u, v]) => [b.x - (turn * b.d) / 2 + turn * v, b.z + turn * u]);
      const y = made(b.x, b.z);
      if (corners.some(([cx, cz]) => inland(island, cx, cz) < 9 || Math.abs(made(cx, cz) - y) > 4.5)) continue;
      const span = Math.max(w, d) / 2 + 8;
      if (!clear(b.x, b.z, span) || fromTrack(b.x, b.z) < span) continue;
      const doorX = b.x - turn * (b.d / 2 + 3), doorZ = b.z;
      if (inland(island, doorX, doorZ) < 6 || !reached(doorX, doorZ)) continue;
      b.plan = planClassical(b, m.fork('plan'));
      island.mansion = { building: b, y: round(y) };
      taken.push({ x: b.x, z: b.z, r: span });
    }
    // Where there is neither, as often as not the ruin of a chapel stands on a headland instead, as on so many of the western isles.
    const h = rng.fork('chapel');
    if (!island.castle && !island.mansion && h.chance(0.65)) for (let tries = 0; tries < 80; tries++) {
      const a = h.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.9 || Math.abs(turnBetween(a, toHouse)) < 0.7) continue;
      if (island.lighthouse && Math.abs(turnBetween(a, Math.atan2(island.lighthouse.z - island.z, island.lighthouse.x - island.x))) < 0.9) continue;
      const back = coastAt(island, a) - h.range(18, 24), x = island.x + Math.cos(a) * back, z = island.z + Math.sin(a) * back;
      if (inland(island, x, z) < 16 || !clear(x, z, 18) || fromTrack(x, z) < 18) continue;
      if (!reached(x - Math.cos(a + Math.PI / 2) * 9.5, z - Math.sin(a + Math.PI / 2) * 9.5) || !reached(x - Math.cos(a + Math.PI / 2) * 13, z - Math.sin(a + Math.PI / 2) * 13)) continue;
      island.chapel = { x: round(x), z: round(z), y: round(made(x, z)), facing: Math.round((a + Math.PI / 2) * 1000) / 1000 };
      taken.push({ x, z, r: 18 });
      break;
    }
  }

  // The burial ground, beside the house on one side or the other, on the forecourt's level.
  {
    const q = rng.fork('graveyard');
    for (const side of q.chance(0.5) ? [1, -1] : [-1, 1]) {
      const w = round(q.range(12, 18)), d = round(q.range(9, 13)), x = round(side > 0 ? level.x1 + d / 2 + 1.5 : level.x0 - d / 2 - 1.5), z = round(level.z0 + 6 + w / 2 + q.range(0, Math.max(0, level.z1 - level.z0 - w - 12)));
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => [x + (i * d) / 2, z + (j * w) / 2]);
      if (corners.some(([cx, cz]) => coastAt(island, Math.atan2(cz - island.z, cx - island.x)) - Math.hypot(cx - island.x, cz - island.z) < 12)) continue;
      if (fromTrack(x, z) < Math.max(w, d) / 2 + 4) continue;
      // (Clear of what is built already, and on ground near the house's own level, or the levelling of it would cut a cliff.)
      if (!clear(x, z, Math.max(w, d) / 2 + 6) || corners.some(([cx, cz]) => Math.abs(made(cx, cz) - F) > 3.5)) continue;
      island.graveyard = { x, z, w, d };
      taken.push({ x, z, r: Math.max(w, d) / 2 + 2 });
      break;
    }
  }

  // Streams. On an island that was found, the land drains as it was worn to: the water gathers into the bottoms of its valleys and
  // runs to the sea, over the cliff where the cliff is high. The two or three biggest are streams, each from where enough has
  // gathered to make one (a spring, or where it comes out from under the way) to the coast; kept clear of the way, the buildings
  // and the house's ground, which were laid on the land first.
  if (island.terrain) {
    const C = 4, R = Math.max(...island.coast) + 8, gx0 = island.x - R, gz0 = island.z - R, n = Math.ceil((2 * R) / C) + 1;
    const h = new Float32Array(n * n), dry = new Uint8Array(n * n), acc = new Float32Array(n * n), down = new Int32Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = gx0 + i * C, z = gz0 + j * C, k = j * n + i; dry[k] = inland(island, x, z) > 1 ? 1 : 0; h[k] = dry[k] ? plain(x, z) : sea - 10; acc[k] = dry[k] ? C * C : 0; }
    const order = Array.from({ length: n * n }, (_, k) => k).filter((k) => dry[k]).sort((a, b) => h[b] - h[a]);
    for (const k of order) {
      const i = k % n, j = (k - i) / n;
      let low = -1, best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = jj * n + ii, drop = (h[k] - h[q]) / Math.hypot(di, dj);
        if (drop > best) { best = drop; low = q; }
      }
      if (low >= 0) { down[k] = low; if (dry[low]) acc[low] += acc[k]; }
    }
    const xOf = (k: number) => gx0 + (k % n) * C, zOf = (k: number) => gz0 + Math.floor(k / n) * C;
    const clearOf = (x: number, z: number) => outside(level, x, z) > 12 && (!island.way || nearestOn(island.way, x, z, 10).off > 9) && (!island.stair || nearestOn(island.stair, x, z, 10).off > 9)
      && !island.cottages.some((q) => Math.hypot(x - q.x, z - q.z) < Math.max(q.w, q.d) + 6) && !(island.lighthouse && Math.hypot(x - island.lighthouse.x, z - island.lighthouse.z) < 22)
      && !(island.castle && Math.hypot(x - island.castle.x, z - island.castle.z) < 30) && !(island.chapel && Math.hypot(x - island.chapel.x, z - island.chapel.z) < 20)
      && !(island.mansion && outsideBuilding(island.mansion.building, x, z) < 10) && Math.hypot(x - island.jetty.from[0], z - island.jetty.from[1]) > 10;
    // Where water leaves the land: a cell whose next cell down is the sea, with much gathered above it; the more if it goes over a cliff.
    const outlets = order.filter((k) => down[k] >= 0 && !dry[down[k]] && acc[k] > 2400 && clearOf(xOf(k), zOf(k)))
      .map((k) => ({ k, score: acc[k] * (1 + Math.max(0, h[k] - sea) / 8) })).sort((a, b) => b.score - a.score);
    const qs = rng.fork('streams'), want = qs.int(1, 3);
    island.streams = [];
    for (const { k: out } of outlets) {
      if (island.streams.length >= want) break;
      if (island.streams.some((st) => st.course.some(([x, z]) => Math.hypot(x - xOf(out), z - zOf(out)) < 45))) continue;
      // Up from the coast, always into the cell that brings the most, until too little comes to make a stream, or it would come near what is built.
      const path = [out];
      for (let cur = out; path.length < 400;) {
        let up = -1, most = 700;
        const i = cur % n, j = (cur - i) / n;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const q = jj * n + ii; if (down[q] === cur && acc[q] > most) { most = acc[q]; up = q; } }
        if (up < 0 || !clearOf(xOf(up), zOf(up))) break;
        path.push(up); cur = up;
      }
      if (path.length < 8) continue;
      path.reverse();
      const width = Math.min(2.2, Math.max(0.6, 0.6 + 1.6 * Math.sqrt(acc[out] / 20000)));
      // (Smoothed, a point every two metres; its bed a hand and more under the land, and never rising.)
      const line = smoothLine(path.map((k) => [xOf(k), zOf(k)] as [number, number]), 2), course: [number, number, number][] = [];
      let last = Infinity, prev: [number, number] | null = null;
      for (const p0 of line) {
        if (prev && Math.hypot(p0[0] - prev[0], p0[1] - prev[1]) < 1.6) continue;
        const bed = Math.min(last - 0.03, plain(p0[0], p0[1]) - (0.35 + 0.1 * width));
        course.push([round(p0[0]), round(p0[1]), round(bed)]); last = bed; prev = p0;
      }
      const lip = course[course.length - 1][2];
      island.streams.push({ course, width: round(width), ...(lip - sea > 3 ? { fall: round(lip - sea) } : {}) });
    }
  }

  // Stacks off the headlands, and off the cliffs here and there; none in the way into the cove.
  {
    // (On an island that was found, its headlands are where its coast stands out furthest from its middle, as it was found.)
    const points = island.terrain ? island.coast.map((r, k) => ({ k, r })).filter(({ k, r }) => { for (let j = -6; j <= 6; j++) if (j && island.coast[(k + j + N) % N] > r) return false; return true; }).map(({ k }) => ({ at: (k / N) * TAU, out: 0, wide: 0.12 })) : heads;
    const q = rng.fork('stacks'), want = q.int(3, 7);
    // On an island that was found, the stacks are what the land left: knobs of it standing clear of the island off its cut coast,
    // as a headland leaves them when the sea has worked round them. (Only after those, if there are too few, are more put off the
    // headlands by rule.)
    if (island.terrain) {
      const C = 2, R = Math.max(...island.coast) + 70, gx0 = island.x - R, gz0 = island.z - R, n = Math.ceil((2 * R) / C) + 1, seen = new Uint8Array(n * n);
      const knob = (i: number, j: number) => { const x = gx0 + i * C, z = gz0 + j * C, d = inland(island, x, z); return d < -6 && d > -60 && frameY(island, F, x, z) > sea + 5; };
      const found: { x: number; z: number; r: number; height: number }[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (seen[j * n + i] || !knob(i, j)) continue;
        // (One knob: the cells of it reached from here, its middle, how far it spreads, and its top.)
        const cells = [j * n + i];
        seen[j * n + i] = 1;
        let sx = 0, sz = 0, top = -Infinity;
        for (let c = 0; c < cells.length && cells.length < 400; c++) {
          const k = cells[c], ci = k % n, cj = (k - ci) / n, x = gx0 + ci * C, z = gz0 + cj * C;
          sx += x; sz += z; top = Math.max(top, frameY(island, F, x, z));
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n || seen[jj * n + ii] || !knob(ii, jj)) continue; seen[jj * n + ii] = 1; cells.push(jj * n + ii); }
        }
        const area = cells.length * C * C;
        if (area < 12 || area > 700 || cells.length >= 400) continue;
        const x = sx / cells.length, z = sz / cells.length, a = Math.atan2(z - island.z, x - island.x);
        if (Math.abs(turnBetween(a, cove.out)) < 0.45 + cove.mouth / coastAt(island, cove.out)) continue;
        found.push({ x: round(x), z: round(z), r: round(Math.min(7, Math.max(2.6, Math.sqrt(area / Math.PI) * 0.8))), height: round(Math.min(top - sea, F - sea + 3) * q.range(0.85, 1.05)) });
      }
      // (The tallest first, and none crowding another.)
      for (const st of found.sort((p0, p1) => p1.height - p0.height)) if (island.stacks.length < want + 2 && !island.stacks.some((o2) => Math.hypot(o2.x - st.x, o2.z - st.z) < o2.r + st.r + 5)) island.stacks.push(st);
    }
    for (let tries = 0; tries < 120 && island.stacks.length < want && points.length; tries++) {
      const h = q.pick(points), a = q.chance(0.7) ? h.at + q.range(-h.wide, h.wide) * 1.5 : q.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.45 + cove.mouth / coastAt(island, cove.out)) continue;
      const r = q.range(2.6, 5.5), at = coastAt(island, a) + q.range(9, 24) + r, x = island.x + Math.cos(a) * at, z = island.z + Math.sin(a) * at;
      if (island.stacks.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r + 5)) continue;
      const cliff = F - sea + 3;
      island.stacks.push({ x: round(x), z: round(z), r: round(r), height: round(cliff * q.range(0.4, 0.95)) });
    }
    // Now and then the sea has cut through the neck of a headland and not yet brought down the rock over it: a stack near the
    // cliff is still joined to it by a span of rock, an arch with the sea running through under it.
    const qa = rng.fork('arch');
    if (island.terrain && qa.chance(0.45)) {
      for (const [i, s] of island.stacks.entries()) {
        const a = Math.atan2(s.z - island.z, s.x - island.x), edge = coastAt(island, a), gap = Math.hypot(s.x - island.x, s.z - island.z) - s.r - edge;
        if (gap < 6 || gap > 16) continue;
        const fx = island.x + Math.cos(a) * (edge - 3), fz = island.z + Math.sin(a) * (edge - 3), cliffTop = plain(fx, fz);
        // (No higher than the stack, or the cliff top: the span is what is left of the rock between them.)
        const top = Math.min(cliffTop, sea + s.height) - qa.range(0.5, 2);
        if (top - sea < 9) continue;
        island.arch = { from: [round(fx), round(fz)], to: [s.x, s.z], width: round(Math.max(5, s.r * qa.range(1.2, 1.7))), top: round(top), under: round((top - sea) * qa.range(0.45, 0.65)) };
        // (The stack stands as high as the span, at least.)
        island.stacks[i] = { ...s, height: round(Math.max(s.height, top - sea + 1)) };
        break;
      }
    }
  }

  // Boats drawn up on the beach above the water, and one or two moored in the cove.
  {
    const q = rng.fork('boats');
    // (Where there is no beach, none are drawn up.)
    for (let k = 0, n = island.landing === 'beach' ? q.int(2, 4) : 0; k < n; k++) {
      const a = headAngle + q.range(-0.9, 0.9) * cove.beach, at = coveRim(island, a) + q.range(2.2, 4.8);
      const x = cove.x + Math.cos(a) * at, z = cove.z + Math.sin(a) * at;
      if (Math.hypot(x - root[0], z - root[1]) < 5 || fromTrack(x, z) < 3) continue;
      island.boats.push({ x: round(x), z: round(z), heading: Math.round((a + Math.PI + q.range(-0.4, 0.4)) * 1000) / 1000, length: round(q.range(4.2, 5.8)), afloat: false });
    }
    for (let k = 0, n = q.int(1, 2); k < n; k++) {
      const a = headAngle + Math.PI + q.range(-1.2, 1.2), at = cove.r * q.range(0.2, 0.55);
      island.boats.push({ x: round(cove.x + Math.cos(a) * at), z: round(cove.z + Math.sin(a) * at), heading: q.range(0, TAU), length: round(q.range(4.8, 6.5)), afloat: true });
    }
  }

  // A cave in the cliff of the cove, at one end of the beach: it can be walked into along a strip of shingle.
  {
    const q = rng.fork('cave');
    if (q.chance(0.6)) {
      const a = headAngle + (q.chance(0.5) ? 1 : -1) * (cove.beach + q.range(0.45, 0.9));
      // Its mouth is at the foot of the cliff, a few strides out from the top of it into the cove, where the strand of shingle ends.
      const toe = 6.5, cave = { x: round(cove.x + Math.cos(a) * (coveRim(island, a) - toe)), z: round(cove.z + Math.sin(a) * (coveRim(island, a) - toe)), heading: Math.round((a + q.range(-0.3, 0.3)) * 1000) / 1000, length: round(q.range(20, 28)) };
      // It runs no further than the rock round it is thick: a cave that came out through the far side of a headland would leave the cliff full of holes.
      // (Whether a point is deep in the rock is judged against the coast and the cove both: the cove is in the island's record by now.)
      let deep = 0;
      for (let along = toe + 3; along <= cave.length + 4; along += 1) {
        const px = cave.x + Math.cos(cave.heading) * along, pz = cave.z + Math.sin(cave.heading) * along;
        if (inland(island, px, pz) < Math.min((along - toe) * 0.75, 7)) break;
        // (Nor where the hill over it is too low to hold a roof: there the land comes down to the beach.)
        if (along > toe + 5 && plain(px, pz) < sea + 10) break;
        deep = along;
      }
      if (deep - 4 >= toe + 10) island.seaCave = { ...cave, length: round(Math.min(cave.length, deep - 4)) };
    }
  }

  // The mainland, across the water; and a few small islands between.
  {
    const q = rng.fork('mainland');
    island.mainland = { bearing: Math.round(q.range(0, TAU) * 1000) / 1000, spread: Math.round(q.range(0.7, 1.25) * 1000) / 1000, distance: Math.round(q.range(1100, 1700)) };
    // (How high its country stands, from a stream of its own: low green hills, or mountains with snow on them.)
    island.mainland.height = Math.round(rng.fork('mainland height').range(0.3, 1) * 100) / 100;
    // (An island that was found has the rest of the sea it was found in about it, islands and all: none are put there.)
    for (let k = 0, n = q.int(1, 4); k < n && !island.terrain; k++) {
      const a = q.range(0, TAU), d = q.range(380, 1100);
      island.islets.push({ x: round(island.x + Math.cos(a) * d), z: round(island.z + Math.sin(a) * d), r: round(q.range(18, 60)), height: round(q.range(6, 28)) });
    }
  }
  site.island = island;

  // Footpaths from the track to the lighthouse door and to the castle's gate.
  const nearestOnTrack = (x: number, z: number): [number, number] => {
    let best: [number, number] = track[0], least = Infinity;
    for (let k = 1; k < track.length - 2; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)), px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < least) { least = d; best = [px, pz]; }
    }
    return best;
  };
  const footpath = (x: number, z: number, to: 'lighthouse' | 'castle' | 'chapel' | 'mansion') => {
    const [sx, sz] = nearestOnTrack(x, z), points: [number, number][] = [];
    // (On land that was found, it goes as the way does: by least effort over the land, and round what is built.)
    if (island.terrain) {
      const built = (bx: number, bz: number) => island.cottages.some((c) => Math.hypot(bx - c.x, bz - c.z) < Math.max(c.w, c.d) * 0.6 + 1.5)
        || (!!island.lighthouse && Math.hypot(bx - island.lighthouse.x, bz - island.lighthouse.z) < island.lighthouse.r + 1.5)
        || (!!island.castle && to !== 'castle' && Math.hypot(bx - island.castle.x, bz - island.castle.z) < 20) || (!!island.mansion && outsideBuilding(island.mansion.building, bx, bz) < 1.5);
      const line = routeOver(sx, sz, x, z, `path/${to}`, built);
      if (line) { (site.paths ??= []).push({ points: [[round(sx), round(sz)], ...line], to }); return; }
    }
    const n = Math.max(2, Math.round(Math.hypot(x - sx, z - sz) / 7)), q = rng.fork(`path/${to}`), sway = q.range(-6, 6);
    for (let k = 0; k <= n; k++) {
      const t = k / n, l = Math.hypot(x - sx, z - sz) || 1;
      let px = sx + (x - sx) * t + (-(z - sz) / l) * sway * Math.sin(t * Math.PI), pz = sz + (z - sz) * t + ((x - sx) / l) * sway * Math.sin(t * Math.PI);
      for (let i = 0; i < 20 && inland(island, px, pz) < 6; i++) { px += (island.x - px) * 0.05; pz += (island.z - pz) * 0.05; }
      points.push([round(px), round(pz)]);
    }
    (site.paths ??= []).push({ points, to });
  };
  const lh = island.lighthouse;
  if (lh) footpath(lh.x + Math.cos(lh.door) * (lh.r + 2.2), lh.z + Math.sin(lh.door) * (lh.r + 2.2), 'lighthouse');
  if (island.castle) { const c = island.castle; footpath(c.x - Math.cos(c.facing) * 13, c.z - Math.sin(c.facing) * 13, 'castle'); }
  if (island.mansion) { const b = island.mansion.building, turn = b.faces === 'w' ? 1 : -1; footpath(b.x - turn * (b.d / 2 + 2.5), b.z, 'mansion'); }
  if (island.chapel) { const c = island.chapel; footpath(c.x - Math.cos(c.facing) * 12, c.z - Math.sin(c.facing) * 12, 'chapel'); }

  // Walls. On an island that was found, the head dyke: a dry-stone wall from coast to coast, beyond the house, between the ground
  // about the houses, once tilled, and the open hill; and a field wall or two off it on the house's side, down to the coast. They
  // follow the land as a wall is built, not ruled straight; a gateway wherever the way or a footpath goes through; and here and
  // there a stretch has tumbled. Not near what is built, the cove, the stair or the streams.
  if (island.terrain) {
    const q = rng.fork('walls'), ways = [track, ...(site.paths ?? []).map((p0) => p0.points)];
    const offWays = (x: number, z: number) => { let best = Infinity; for (const l of ways) for (let k = 0; k + 1 < l.length; k++) { const [ax, az] = l[k], [bx, bz] = l[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return best; };
    const blocked = (x: number, z: number) => outside(level, x, z) < 4 || island.cottages.some((c) => Math.hypot(x - c.x, z - c.z) < Math.max(c.w, c.d) * 0.7 + 3)
      || (!!island.lighthouse && Math.hypot(x - island.lighthouse.x, z - island.lighthouse.z) < 16) || (!!island.castle && Math.hypot(x - island.castle.x, z - island.castle.z) < 26)
      || (!!island.chapel && Math.hypot(x - island.chapel.x, z - island.chapel.z) < 14) || (!!island.mansion && outsideBuilding(island.mansion.building, x, z) < 6)
      || (!!island.graveyard && Math.hypot(x - island.graveyard.x, z - island.graveyard.z) < Math.max(island.graveyard.w, island.graveyard.d))
      || Math.hypot(x - cove.x, z - cove.z) < coveRim(island, Math.atan2(z - cove.z, x - cove.x)) + 6
      || (!!island.stair && nearestOn(island.stair, x, z, 6).off < 5) || (island.streams ?? []).some((st) => nearestOn(st.course, x, z, 5).off < 3);
    /** A wall from `from` along `heading`, bending as the land and the builder's eye took it, until it meets the coast or something built. */
    const run = (fx: number, fz: number, heading: number, most: number): [number, number][] => {
      const line: [number, number][] = [];
      let x = fx, z = fz, h = heading;
      for (let k = 0; k < most; k++) {
        if (inland(island, x, z) < 3 || blocked(x, z)) break;
        line.push([round(x), round(z)]);
        h += (fbm2(x / 40 + 3, z / 40, 2, 91) - 0.5) * 0.12;
        x += Math.cos(h) * 2; z += Math.sin(h) * 2;
      }
      return line;
    };
    const walls: NonNullable<Island['walls']> = [];
    const toMiddle = Math.atan2(island.z - hz, island.x - hx);
    for (let tries = 0; tries < 12 && !walls.length; tries++) {
      const d = q.range(55, 110), cx = hx + Math.cos(toMiddle) * d, cz = hz + Math.sin(toMiddle) * d;
      if (inland(island, cx, cz) < 15 || blocked(cx, cz)) continue;
      const across = toMiddle + Math.PI / 2 + q.range(-0.35, 0.35);
      const a = run(cx, cz, across, 200), b = run(cx, cz, across + Math.PI, 200);
      const line = [...b.reverse(), ...a.slice(1)];
      if (line.length < 30) continue;
      walls.push({ line, gaps: [], fallen: [], height: round(q.range(1.1, 1.45)) });
    }
    // Field walls off the dyke, on the house's side, down to the coast.
    if (walls.length) {
      const dyke = walls[0].line;
      for (let k = 0, want = q.int(1, 2); k < 30 && walls.length < 1 + want; k++) {
        const i = q.int(Math.round(dyke.length * 0.15), Math.round(dyke.length * 0.85)), [px, pz] = dyke[i];
        const [ax, az] = dyke[Math.max(0, i - 2)], [bx, bz] = dyke[Math.min(dyke.length - 1, i + 2)];
        let h = Math.atan2(bz - az, bx - ax) + Math.PI / 2;
        if (Math.cos(h - toMiddle) > 0) h += Math.PI;
        const line = run(px + Math.cos(h) * 2, pz + Math.sin(h) * 2, h + q.range(-0.4, 0.4), 120);
        if (line.length < 12 || walls.slice(1).some((w) => w.line.some(([x, z]) => Math.hypot(x - line[0][0], z - line[0][1]) < 30))) continue;
        walls.push({ line, gaps: [], fallen: [], height: round(walls[0].height * q.range(0.85, 1)) });
      }
    }
    for (const w of walls) {
      // Gateways: wherever a way comes within a stride and a half of it, three metres clear.
      for (let k = 0; k < w.line.length; k++) {
        if (offWays(w.line[k][0], w.line[k][1]) > 1.6) continue;
        const a = Math.max(0, k - 1), b = Math.min(w.line.length - 1, k + 1);
        const last = w.gaps[w.gaps.length - 1];
        if (last && a <= last[1] + 1) last[1] = b; else w.gaps.push([a, b]);
      }
      // Stretches tumbled: two or three, of a few metres to twenty.
      for (let k = 0, n = q.int(1, 3); k < n; k++) { const a = q.int(0, Math.max(0, w.line.length - 4)); w.fallen.push([a, Math.min(w.line.length - 1, a + q.int(2, 10))]); }
    }
    if (walls.length) island.walls = walls;
  }

  // The box that holds the island.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  island.coast.forEach((r, k) => {
    const a = (k / N) * TAU, x = island.x + Math.cos(a) * r, z = island.z + Math.sin(a) * r;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  });
  site.grounds = { x0: round(x0), x1: round(x1), z0: round(z0), z1: round(z1) };
}
