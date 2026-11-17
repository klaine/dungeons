import { fbm2, Rng } from './rng';
import { Island, Place, Site } from './site';

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
  // (Measured along the bearing, which is near enough square to the coast wherever the coast is not swinging sharply.)
  const coast = coastAt(o, angle) - r;
  const c = o.cove, cr = Math.hypot(x - c.x, z - c.z);
  const bowl = cr - c.r;
  // The channel: from the middle of the cove out along its bearing to the open sea.
  const ux = Math.cos(c.out), uz = Math.sin(c.out), along = (x - c.x) * ux + (z - c.z) * uz, across = Math.abs(-(x - c.x) * uz + (z - c.z) * ux);
  // (Behind the middle of the cove the channel is only a round end, which the bowl takes in.)
  const channel = along > 0 ? across - c.mouth / 2 : Math.hypot(across, along) - c.mouth / 2;
  // (The two headlands either side of the mouth are rounded off, not left as points.)
  return softMin(coast, softMin(bowl, channel, 6), 5);
}

/**
 * How far the coast near a point is beach, from 0 to 1: the head of the cove, the part of its rim
 * that faces back into the island. Everywhere else the coast is cliff.
 */
export function beachness(o: Island, x: number, z: number): number {
  const c = o.cove, d = Math.hypot(x - c.x, z - c.z);
  const head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(z - c.z, x - c.x);
  const off = Math.abs(turnBetween(head, at));
  return (1 - smooth((off - c.beach) / 0.32)) * (1 - smooth((d - c.r - o.combe * 0.6) / 20));
}

/** How far a point is from the beach: from the rim of the cove at its head, and more the further round the rim it lies. */
function fromBeach(o: Island, x: number, z: number): number {
  const c = o.cove, d = Math.hypot(x - c.x, z - c.z);
  const head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(z - c.z, x - c.x);
  const off = Math.max(0, Math.abs(turnBetween(head, at)) - c.beach);
  return Math.max(0, d - c.r) + off * (c.r + 10) * 1.6;
}

/** How far a point is outside a rectangle, or nothing inside it. */
const outside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The plain shape of the land: the top of the island, falling to the sea at its coast. The builder
 * wears the cliffs back from this and carves them, so where they stand differs from it by a
 * stride or two; nothing placed here is placed that near the edge. `floor` is the forecourt's level.
 */
export function landAt(o: Island, floor: number, x: number, z: number, levelled = true): number {
  const d = inland(o, x, z);
  // The top: the forecourt's level about the house, a swell of high ground at the back of the
  // island, the land rolling gently, and the hollow it comes down through to the beach.
  let top = floor + o.crown.height * Math.exp(-((Math.hypot(x - o.crown.x, z - o.crown.z) / o.crown.r) ** 2));
  top += (fbm2(x / 38 + 3.1, z / 38 - 1.7, 3, 7) - 0.5) * 5 + (fbm2(x / 11, z / 11, 2, 9) - 0.5) * 0.8;
  // (Land at the cliff top rises a little towards the edge, as turf does where the wind has had the soil off the face below.)
  top += 0.6 * (1 - smooth(d / 10));
  const beachAt = o.sea + 1.15;
  const b = fromBeach(o, x, z);
  // A strip of beach at the foot of the hollow, a little above high water, and the hollow coming up from it.
  top = beachAt + (top - beachAt) * smooth((b - 7) / o.combe) - 0.9 * (1 - Math.min(1, b / 7));
  top = floor + (top - floor) * smooth((outside(o.level, x, z) - 2) / 16);
  if (levelled) {
    // What stands on the land has level ground made for it.
    const flat = (x0: number, z0: number, y: number, r: number) => { const w = 1 - smooth((Math.hypot(x - x0, z - z0) - r) / 4); top += (y - top) * w; };
    for (const q of o.cottages) flat(q.x, q.z, q.y, Math.max(q.w, q.d) * 0.62 + 1.2);
    if (o.lighthouse) flat(o.lighthouse.x, o.lighthouse.z, o.lighthouse.y, o.lighthouse.r + 10);
    if (o.castle) flat(o.castle.x, o.castle.z, o.castle.y, 19);
    if (o.chapel) flat(o.chapel.x, o.chapel.z, o.chapel.y, 13);
    if (o.graveyard) { const q = o.graveyard, w = 1 - smooth((Math.hypot(Math.max(Math.abs(x - q.x) - q.d / 2, 0), Math.max(Math.abs(z - q.z) - q.w / 2, 0)) - 1) / 5); top += (floor - top) * w; }
  }
  // Below the top of the cliff the land goes down to the sea bed: steeply where it is cliff, which
  // the builder turns to rock, and gently under a beach.
  let y = top;
  if (d < 0) {
    const out = -d, beach = beachness(o, x, z), high = Math.max(0, top - o.sea);
    const bed = o.sea - 2.5 - Math.min(24, out * 0.32) + (fbm2(x / 17, z / 17, 2, 13) - 0.5) * 3;
    const cliff = top + (bed - top) * smooth(out / (2.5 + high * 0.2));
    const sand = Math.min(top, o.sea + 0.3) - out * 0.1 - Math.max(0, out - 7) * 0.32;
    y = cliff + (Math.max(sand, bed) - cliff) * beach;
  }
  // A strand of shingle along the foot of the cove's cliff from the end of the beach to the sea cave, so that it can be walked to dry-shod.
  if (o.seaCave) {
    const sc = o.seaCave, c = o.cove, head = Math.atan2(o.z - c.z, o.x - c.x), at = Math.atan2(sc.z - c.z, sc.x - c.x);
    const end = head + Math.sign(turnBetween(head, at)) * c.beach * 0.85, bx = c.x + Math.cos(end) * (c.r - 1), bz = c.z + Math.sin(end) * (c.r - 1);
    const dx = sc.x - bx, dz = sc.z - bz, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - bx) * dx + (z - bz) * dz) / l2));
    const off = Math.hypot(x - bx - dx * t, z - bz - dz * t), strand = o.sea + 0.55 + 0.25 * t;
    if (off < 5.5 && y < strand) y += (strand - y) * (1 - smooth((off - 2.2) / 3.3));
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

/**
 * Lays out an island round a house whose forecourt is `meadow` and whose door is at `doorX` in
 * the forecourt's north side. Fills in the site's `island`, `grounds`, `track` and `paths`.
 */
export function layOutIsland(site: Site, meadow: Place, doorX: number, rng: Rng): void {
  const round = (v: number) => Math.round(v * 10) / 10, T = site.wallThickness, F = meadow.floor;
  const others = site.places.filter((q) => q !== meadow);
  const house = { x0: Math.min(...others.map((q) => q.x0)) - T, x1: Math.max(...others.map((q) => q.x1)) + T, z0: Math.min(...others.map((q) => q.z0)) - T, z1: meadow.z1 };
  site.stands = 'free';
  const level = { x0: round(Math.min(house.x0, meadow.x0) - 6), x1: round(Math.max(house.x1, meadow.x1) + 6), z0: round(house.z0 - 6), z1: round(meadow.z1 + 2) };
  const hx = (level.x0 + level.x1) / 2, hz = (level.z0 + level.z1) / 2;

  // How big the cove is, decided first, since a large one wants a large island round it: from a
  // pool twenty metres across the half of it to a bay three or four times that.
  const coveR = 19 * Math.pow(3.7, Math.pow(rng.fork('cove size').next(), 1.25));
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
  const sea = round(F - shape.range(17, 26));
  const island: Island = {
    x: middle.x, z: middle.z, coast: coastOf(1), sea,
    cove: { x: 0, z: 0, r: 0, out: 0, mouth: 0, beach: 0 }, crown: { x: 0, z: 0, r: 40, height: 0 }, combe: 60, level,
    jetty: { from: [0, 0], to: [0, 0], width: 3 }, cottages: [], boats: [], stacks: [], mainland: { bearing: 0, spread: 1, distance: 1500 }, islets: [],
  };
  // Grown until the house and its level ground lie well inside the cliffs.
  const corners = [[level.x0, level.z0], [level.x1, level.z0], [level.x0, level.z1], [level.x1, level.z1], [hx, level.z0]];
  const margin = () => Math.min(...corners.map(([x, z]) => coastAt(island, Math.atan2(z - island.z, x - island.x)) - Math.hypot(x - island.x, z - island.z)));
  for (let grow = 1; grow < 1.8 && margin() < 18; grow += 0.05) island.coast = coastOf(grow);

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
  if (!island.cove.r) throw new Error(`no cove would fit the island (seed ${site.seed})`);
  const cove = island.cove;
  const headAngle = Math.atan2(island.z - cove.z, island.x - cove.x);
  // The high ground: towards the back of the island, away from the cove.
  {
    const q = rng.fork('crown'), a = cove.out + Math.PI + q.range(-0.9, 0.9), at = coastAt(island, a) * q.range(0.35, 0.6);
    island.crown = { x: round(island.x + Math.cos(a) * at), z: round(island.z + Math.sin(a) * at), r: round(q.range(40, 70)), height: round(q.range(3, 9)) };
  }

  // The jetty, from the beach out into the cove, a little to one side of its head.
  {
    const q = rng.fork('jetty'), a = headAngle + q.range(-0.35, 0.35) * cove.beach, ux = -Math.cos(a), uz = -Math.sin(a);
    const rimX = cove.x + Math.cos(a) * cove.r, rimZ = cove.z + Math.sin(a) * cove.r, length = q.range(14, Math.min(22, cove.r * 0.8));
    island.jetty = { from: [round(rimX - ux * 4), round(rimZ - uz * 4)], to: [round(rimX + ux * length), round(rimZ + uz * length)], width: round(q.range(2.6, 3.4)) };
  }

  // The track: from the door across the forecourt, then wandering down the hollow to the head of the jetty.
  const root = island.jetty.from;
  const track: [number, number][] = [[doorX, meadow.z0], [doorX, meadow.z1 - 4]];
  {
    const q = rng.fork('track');
    const [sx, sz] = track[1], length = Math.hypot(root[0] - sx, root[1] - sz), steps = Math.max(3, Math.round(length / 9));
    const bend = q.range(-1, 1) * Math.min(18, length * 0.2), phase = q.range(0, Math.PI);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      let x = sx + (root[0] - sx) * t, z = sz + (root[1] - sz) * t;
      // (Leaving the forecourt it goes straight on south a little way first.)
      const away = Math.sin(t * Math.PI + phase * 0.3) * bend * (1 - t * 0.6);
      const ax = -(root[1] - sz) / length, az = (root[0] - sx) / length;
      x += ax * away * smooth(t / 0.3); z += az * away * smooth(t / 0.3);
      // Kept clear of the cliffs: drawn in towards the middle where it would go near them.
      for (let i = 0; i < 20 && inland(island, x, z) < 12 && t < 0.9; i++) { x += (island.x - x) * 0.06; z += (island.z - z) * 0.06; }
      track.push([round(x), round(z)]);
    }
    track.push([island.jetty.to[0], island.jetty.to[1]]);
  }
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
  const plain = (x: number, z: number) => landAt(island, F, x, z, false);
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
        const a = Math.atan2(island.z - cove.z, island.x - cove.x) + q.range(-1, 1) * (cove.beach + 0.35), at = cove.r + q.range(7, 16);
        x = cove.x + Math.cos(a) * at; z = cove.z + Math.sin(a) * at;
      }
      const r = Math.max(w, d) * 0.62 + 1.6;
      if (fromTrack(x, z) < d / 2 + 2.6 || inland(island, x, z) < r + 4 || !clear(x, z, r + 1.5)) continue;
      // Not on ground too steep to level: no more than a man's height between the corners.
      let lo = Infinity, hi = -Infinity;
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const y = plain(x + cx * w * 0.55, z + cz * w * 0.55); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      if (hi - lo > 3.4 || lo < sea + 1.4) continue;
      // Front to the track, or, now and then, gable to it and front to the sea.
      const toTrack = Math.atan2(-((bx - ax) / l) * side, (bz - az) / l * side);
      const faces = tries % 2 === 0 && q.chance(0.7) ? toTrack : Math.atan2(cove.z - z, cove.x - x);
      island.cottages.push({ x: round(x), z: round(z), y: round(plain(x, z)), w, d, faces: Math.round(faces * 1000) / 1000, roof: q.chance(0.55) ? 'thatch' : 'slate', wash: q.pick(washes) });
      taken.push({ x, z, r });
    }
  }

  // The lighthouse: on the headland that stands out furthest, well round from the cove and from the house.
  const toHouse = Math.atan2(hz - island.z, hx - island.x);
  {
    const q = rng.fork('lighthouse');
    let best = -Infinity, at = 0;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      if (Math.abs(turnBetween(a, cove.out)) < 1.2 || Math.abs(turnBetween(a, toHouse)) < 0.55) continue;
      let mean = 0;
      for (let j = -8; j <= 8; j++) mean += island.coast[(k + j + N) % N] / 17;
      const stand = island.coast[k] - mean + island.coast[k] * 0.05;
      if (stand > best) { best = stand; at = a; }
    }
    for (let tries = 0; tries < 30; tries++) {
      const a = at + q.range(-0.08, 0.08), back = coastAt(island, a) - q.range(15, 19), x = island.x + Math.cos(a) * back, z = island.z + Math.sin(a) * back;
      if (inland(island, x, z) < 13 || !clear(x, z, 13)) continue;
      const lh = { x: round(x), z: round(z), y: round(plain(x, z)), r: round(q.range(2.9, 3.4)), height: round(q.range(15, 22)), door: Math.round(Math.atan2(island.z - z, island.x - x) * 1000) / 1000 };
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
      island.castle = { x: round(x), z: round(z), y: round(plain(x, z)), facing: Math.round(a * 1000) / 1000 };
      taken.push({ x, z, r: 24 });
      break;
    }
    // Where there is no castle, as often as not the ruin of a chapel stands on a headland instead, as on so many of the western isles.
    const h = rng.fork('chapel');
    if (!island.castle && h.chance(0.65)) for (let tries = 0; tries < 80; tries++) {
      const a = h.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.9 || Math.abs(turnBetween(a, toHouse)) < 0.7) continue;
      if (island.lighthouse && Math.abs(turnBetween(a, Math.atan2(island.lighthouse.z - island.z, island.lighthouse.x - island.x))) < 0.9) continue;
      const back = coastAt(island, a) - h.range(18, 24), x = island.x + Math.cos(a) * back, z = island.z + Math.sin(a) * back;
      if (inland(island, x, z) < 16 || !clear(x, z, 18) || fromTrack(x, z) < 18) continue;
      island.chapel = { x: round(x), z: round(z), y: round(plain(x, z)), facing: Math.round((a + Math.PI / 2) * 1000) / 1000 };
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
      island.graveyard = { x, z, w, d };
      taken.push({ x, z, r: Math.max(w, d) / 2 + 2 });
      break;
    }
  }

  // Stacks off the headlands, and off the cliffs here and there; none in the way into the cove.
  {
    const q = rng.fork('stacks'), want = q.int(3, 7);
    for (let tries = 0; tries < 120 && island.stacks.length < want; tries++) {
      const h = q.pick(heads), a = q.chance(0.7) ? h.at + q.range(-h.wide, h.wide) * 1.5 : q.range(0, TAU);
      if (Math.abs(turnBetween(a, cove.out)) < 0.45 + cove.mouth / coastAt(island, cove.out)) continue;
      const r = q.range(2.6, 5.5), at = coastAt(island, a) + q.range(9, 24) + r, x = island.x + Math.cos(a) * at, z = island.z + Math.sin(a) * at;
      if (island.stacks.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r + 5)) continue;
      const cliff = F - sea + 3;
      island.stacks.push({ x: round(x), z: round(z), r: round(r), height: round(cliff * q.range(0.4, 0.95)) });
    }
  }

  // Boats drawn up on the beach above the water, and one or two moored in the cove.
  {
    const q = rng.fork('boats');
    for (let k = 0, n = q.int(2, 4); k < n; k++) {
      const a = headAngle + q.range(-0.9, 0.9) * cove.beach, at = cove.r + q.range(2.2, 4.8);
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
      const cave = { x: round(cove.x + Math.cos(a) * (cove.r - 0.5)), z: round(cove.z + Math.sin(a) * (cove.r - 0.5)), heading: Math.round((a + q.range(-0.3, 0.3)) * 1000) / 1000, length: round(q.range(14, 22)) };
      // It runs no further than the rock round it is thick: a cave that came out through the far side of a headland would leave the cliff full of holes.
      // (Whether a point is deep in the rock is judged against the coast and the cove both: the cove is in the island's record by now.)
      let deep = 0;
      for (let along = 4; along <= cave.length + 4; along += 1) {
        const px = cave.x + Math.cos(cave.heading) * along, pz = cave.z + Math.sin(cave.heading) * along;
        if (inland(island, px, pz) < Math.min(along * 0.75, 7)) break;
        // (Nor where the hill over it is too low to hold a roof: there the land comes down to the beach.)
        if (along > 6 && plain(px, pz) < sea + 10) break;
        deep = along;
      }
      if (deep - 4 >= 11) island.seaCave = { ...cave, length: round(Math.min(cave.length, deep - 4)) };
    }
  }

  // The mainland, across the water; and a few small islands between.
  {
    const q = rng.fork('mainland');
    island.mainland = { bearing: Math.round(q.range(0, TAU) * 1000) / 1000, spread: Math.round(q.range(0.7, 1.25) * 1000) / 1000, distance: Math.round(q.range(1100, 1700)) };
    // (How high its country stands, from a stream of its own: low green hills, or mountains with snow on them.)
    island.mainland.height = Math.round(rng.fork('mainland height').range(0.3, 1) * 100) / 100;
    for (let k = 0, n = q.int(1, 4); k < n; k++) {
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
  const footpath = (x: number, z: number, to: 'lighthouse' | 'castle' | 'chapel') => {
    const [sx, sz] = nearestOnTrack(x, z), points: [number, number][] = [];
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
  if (island.chapel) { const c = island.chapel; footpath(c.x - Math.cos(c.facing) * 12, c.z - Math.sin(c.facing) * 12, 'chapel'); }

  // The box that holds the island.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  island.coast.forEach((r, k) => {
    const a = (k / N) * TAU, x = island.x + Math.cos(a) * r, z = island.z + Math.sin(a) * r;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  });
  site.grounds = { x0: round(x0), x1: round(x1), z0: round(z0), z1: round(z1) };
}
