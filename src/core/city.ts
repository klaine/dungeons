import { Rng } from './rng';

/**
 * A city laid out as Oleg Dolya (watabou) lays one out in his Medieval Fantasy City Generator, a different method from the village
 * generator that `grown.ts` follows, written afresh here for our land and measures:
 *
 * - The ground is cut into wards: the cells of a Voronoi diagram whose points lie on a spiral out from the heart of the place, close
 *   together at the heart and further apart outward, so that wards are small in the middle and large at the edge; the points are
 *   eased once or twice towards the middles of their cells (Lloyd's relaxation), which makes the wards more even.
 * - What stands there first (the square, the house, the waterfront, a river) is cut out of the wards, each ward keeping the larger
 *   side of a straight cut, so that the wards about the square front it with straight sides.
 * - The edges between wards are the streets. The main ones, the arteries, run from where the roads come into the city to its heart,
 *   along the edges that are least effort to walk; they are broader.
 * - Each ward is drawn in from its edges by half the breadth of the street along each, which leaves its block; a block too large is
 *   cut in two, square to its longest side near its middle and a little askew, an alley between the halves, and the halves again,
 *   until each is small enough.
 *
 * Nothing here knows of towns: polygons, lines and points only. A polygon (`Poly`) is convex, its points going round with its inside
 * on the right hand when x is east and z south (as a town's blocks go round), and each of its sides carries a tag, a number the
 * caller gives meaning to: what the side fronts.
 */

export type Pt = [number, number];
/** A convex polygon: `pts[k]` to `pts[k + 1]` is its side `k`, which fronts `tags[k]`. */
export interface Poly { pts: Pt[]; tags: number[] }

const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/** The polygon's area (the inside on the right hand, as above, gives more than nothing). */
export function areaOf(p: Pt[]): number {
  let s = 0;
  for (let k = 0; k < p.length; k++) { const [ax, az] = p[k], [bx, bz] = p[(k + 1) % p.length]; s += ax * bz - bx * az; }
  return -s / 2;
}

export function centroidOf(p: Pt[]): Pt {
  let a = 0, cx = 0, cz = 0;
  for (let k = 0; k < p.length; k++) {
    const [ax, az] = p[k], [bx, bz] = p[(k + 1) % p.length], c = ax * bz - bx * az;
    a += c; cx += (ax + bx) * c; cz += (az + bz) * c;
  }
  if (Math.abs(a) < 1e-9) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return [cx / (3 * a), cz / (3 * a)];
}

/** Whether a point is inside a convex polygon going round as a `Poly` does, by `m` and more. */
export function insideConvex(p: Pt[], x: number, z: number, m = 0): boolean {
  for (let k = 0; k < p.length; k++) {
    const [ax, az] = p[k], [bx, bz] = p[(k + 1) % p.length], l = Math.hypot(bx - ax, bz - az) || 1;
    if (((bx - ax) * (z - az) - (bz - az) * (x - ax)) / l > -m) return false;
  }
  return true;
}

/** Any ring of points made to go round as a `Poly` does. */
export function wound(p: Pt[]): Pt[] { return areaOf(p) < 0 ? p.slice().reverse() : p; }

/**
 * What is left of a polygon on the side of a line where `n·x <= c`, the side cut along the line fronting `tag`. (Sutherland and
 * Hodgman, keeping each side's tag: a side cut short keeps its own, the new side along the line takes the given one.)
 */
export function clipHalf(p: Poly, n: Pt, c: number, tag: number): Poly {
  const pts: Pt[] = [], tags: number[] = [], N = p.pts.length;
  for (let k = 0; k < N; k++) {
    const a = p.pts[k], b = p.pts[(k + 1) % N], e = p.tags[k], da = dot(n, a) - c, db = dot(n, b) - c;
    const ina = da <= 0, inb = db <= 0;
    if (ina) { pts.push(a); tags.push(e); }
    if (ina !== inb) {
      const s = da / (da - db), q: Pt = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      pts.push(q); tags.push(ina ? tag : e);
    }
  }
  // (Points that came out on top of one another are one: the side between them, of no length, goes.)
  const outP: Pt[] = [], outT: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    const q = pts[k], nx = pts[(k + 1) % pts.length];
    if (Math.hypot(nx[0] - q[0], nx[1] - q[1]) < 1e-6) continue;
    outP.push(q); outT.push(tags[k]);
  }
  return outP.length >= 3 ? { pts: outP, tags: outT } : { pts: [], tags: [] };
}

/** Side `k` of a convex ring going round as a `Poly` does, as its outward normal `n` and `c`: the ring is where `n·x <= c`. */
function sideLine(p: Pt[], k: number): { n: Pt; c: number } {
  const a = p[k], b = p[(k + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // (Inside points have (b − a) × (x − a) <= 0, which is n·(x − a) with this n.)
  const n: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  return { n, c: dot(n, a) };
}

/** A polygon drawn in from each side by as much as `by` says for that side's tag. */
export function insetPoly(p: Poly, by: (tag: number) => number): Poly {
  let out = p;
  for (let k = 0; k < p.pts.length; k++) {
    const d = by(p.tags[k]);
    if (!(d > 0)) continue;
    const { n, c } = sideLine(p.pts, k);
    out = clipHalf(out, n, c - d, p.tags[k]);
    if (out.pts.length < 3) return { pts: [], tags: [] };
  }
  return out;
}

/**
 * The cells of a Voronoi diagram of `seeds` within a box: each cell the box cut by the line halfway between its seed and each
 * other's, each side tagged with the index of the seed across it, or −1 for the box's edge.
 */
export function voronoi(seeds: Pt[], box: { x0: number; x1: number; z0: number; z1: number }): Poly[] {
  const frame: Poly = { pts: wound([[box.x0, box.z1], [box.x1, box.z1], [box.x1, box.z0], [box.x0, box.z0]]), tags: [-1, -1, -1, -1] };
  return seeds.map((s, i) => {
    // (Nearest first: a cell is soon small, and the seeds far off then cut nothing, which is quick to see.)
    const order = seeds.map((_, j) => j).filter((j) => j !== i).sort((a, b) => Math.hypot(seeds[a][0] - s[0], seeds[a][1] - s[1]) - Math.hypot(seeds[b][0] - s[0], seeds[b][1] - s[1]));
    let cell = frame;
    for (const j of order) {
      const o = seeds[j], d = Math.hypot(o[0] - s[0], o[1] - s[1]);
      if (d < 1e-6) continue;
      // (Once every corner of the cell is nearer its seed than half the way to this one, nothing further off can cut it.)
      const far = Math.max(...cell.pts.map((q) => Math.hypot(q[0] - s[0], q[1] - s[1])));
      if (d > 2 * far) break;
      const n: Pt = [(o[0] - s[0]) / d, (o[1] - s[1]) / d], mid: Pt = [(o[0] + s[0]) / 2, (o[1] + s[1]) / 2];
      cell = clipHalf(cell, n, dot(n, mid), j);
      if (cell.pts.length < 3) break;
    }
    return cell;
  });
}

/**
 * Points on a spiral out from `heart`, as watabou's cities have them: the k-th turned by √k × 5 radians from the first and
 * `r0 + k × step × (1 to 1.5)` out, so that they thin out outward. As many as reach `reach`.
 */
export function spiralSeeds(heart: Pt, step: number, reach: number, rng: Rng, r0 = 10): Pt[] {
  const sa = rng.range(0, Math.PI * 2), out: Pt[] = [heart];
  for (let k = 1; ; k++) {
    const a = sa + Math.sqrt(k) * 5, r = r0 + k * step * rng.range(1, 1.5);
    if (r > reach) break;
    out.push([heart[0] + Math.cos(a) * r, heart[1] + Math.sin(a) * r]);
  }
  return out;
}

/** Each seed for which `move` holds moved to the middle of its cell, `times` over (Lloyd's relaxation). */
export function relax(seeds: Pt[], box: { x0: number; x1: number; z0: number; z1: number }, times: number, move: (k: number) => boolean): Pt[] {
  let s = seeds;
  for (let n = 0; n < times; n++) {
    const cells = voronoi(s, box);
    s = s.map((p, k) => (move(k) && cells[k].pts.length >= 3 ? centroidOf(cells[k].pts) : p));
  }
  return s;
}

/**
 * A polygon with a convex obstacle cut out of it: of the lines along the obstacle's sides, the one that leaves the most of the
 * polygon on its far side, the cut fronting `tag`. The polygon as it was if they do not overlap.
 */
export function clipAway(p: Poly, obstacle: Pt[], tag: number, margin = 0): Poly {
  const ob = wound(obstacle);
  // (Not overlapping if some side of either parts them.)
  const parted = (a: Pt[], b: Pt[]) => {
    for (const poly of [a, b]) for (let k = 0; k < poly.length; k++) {
      const { n, c } = sideLine(poly, k);
      if (Math.min(...(poly === a ? b : a).map((q) => dot(n, q))) >= c + margin) return true;
    }
    return false;
  };
  if (parted(p.pts, ob)) return p;
  let best: Poly | null = null, most = -Infinity;
  for (let k = 0; k < ob.length; k++) {
    const { n, c } = sideLine(ob, k);
    const cut = clipHalf(p, [-n[0], -n[1]], -(c + margin), tag);
    const a = cut.pts.length >= 3 ? areaOf(cut.pts) : 0;
    if (a > most) { most = a; best = cut; }
  }
  return best && best.pts.length >= 3 ? best : { pts: [], tags: [] };
}

/** Where a line of points first comes into a convex polygon and where it last leaves it, and the points of it between; or null. */
function crossingOf(p: Pt[], line: Pt[]): { a: Pt; b: Pt; between: number[] } | null {
  let a: Pt | null = null, b: Pt | null = null;
  const between: number[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const s = line[k], e = line[k + 1];
    if (insideConvex(p, s[0], s[1])) between.push(k);
    // (Where this stretch crosses each side.)
    for (let m = 0; m < p.length; m++) {
      const c = p[m], d = p[(m + 1) % p.length], den = (e[0] - s[0]) * (d[1] - c[1]) - (e[1] - s[1]) * (d[0] - c[0]);
      if (Math.abs(den) < 1e-9) continue;
      const u = ((c[0] - s[0]) * (d[1] - c[1]) - (c[1] - s[1]) * (d[0] - c[0])) / den, v = ((c[0] - s[0]) * (e[1] - s[1]) - (c[1] - s[1]) * (e[0] - s[0])) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const q: Pt = [s[0] + (e[0] - s[0]) * u, s[1] + (e[1] - s[1]) * u];
      if (!a) a = q;
      b = q;
    }
  }
  if (insideConvex(p, line[line.length - 1][0], line[line.length - 1][1])) between.push(line.length - 1);
  return a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1 ? { a, b, between } : null;
}

/**
 * A polygon cut in two along a line, the two halves each kept `gap` metres from it, the cuts fronting `tag`. One half or none
 * where the line misses the polygon or a half comes to nothing.
 */
export function splitPoly(p: Poly, a: Pt, b: Pt, gap: number, tag: number): Poly[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l], c = dot(n, a);
  return [clipHalf(p, n, c - gap, tag), clipHalf(p, [-n[0], -n[1]], -c - gap, tag)].filter((h) => h.pts.length >= 3 && areaOf(h.pts) > 1);
}

/**
 * A polygon cut in two by a winding band (a river), along the chord from where its line comes into the polygon to where it leaves,
 * each half kept as far from the chord as the band is broad there and the line strays from the chord. The polygon as it was if the
 * line does not cross it.
 */
export function cutByBand(p: Poly, line: Pt[], half: (k: number) => number, tag: number): Poly[] {
  const x = crossingOf(p.pts, line);
  if (!x) return [offBand(p, line, half, tag)].filter((q) => q.pts.length >= 3);
  const l = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]), n: Pt = [-(x.b[1] - x.a[1]) / l, (x.b[0] - x.a[0]) / l];
  let gap = 0;
  for (const k of x.between) gap = Math.max(gap, Math.abs(dot(n, line[k]) - dot(n, x.a)) + half(k));
  if (!x.between.length) gap = half(0);
  // (Each end of the chord too: the band's breadth where it crosses.)
  let nearest = 0, nd = Infinity;
  for (let k = 0; k < line.length; k++) { const d = Math.min(Math.hypot(line[k][0] - x.a[0], line[k][1] - x.a[1]), Math.hypot(line[k][0] - x.b[0], line[k][1] - x.b[1])); if (d < nd) { nd = d; nearest = k; } }
  gap = Math.max(gap, half(nearest));
  return splitPoly(p, x.a, x.b, gap, tag).map((h) => offBand(h, line, half, tag)).filter((q) => q.pts.length >= 3);
}

/**
 * A polygon kept off a band it does not cross but may lie within: cut along each stretch of the band's line that comes nearer it
 * than the band's half breadth there, on the far side of the stretch from the polygon's middle, as far from it as the band is broad.
 */
export function offBand(p: Poly, line: Pt[], half: (k: number) => number, tag: number): Poly {
  let out = p;
  for (let k = 0; k + 1 < line.length && out.pts.length >= 3; k++) {
    const a = line[k], b = line[k + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const h = Math.max(half(k), half(k + 1)), ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    // (Only a stretch the polygon comes within the band of: some point of it nearer the stretch than that.)
    const near = out.pts.some((q) => { const s = Math.min(l, Math.max(0, (q[0] - a[0]) * ux + (q[1] - a[1]) * uz)); return Math.hypot(q[0] - a[0] - ux * s, q[1] - a[1] - uz * s) < h; });
    if (!near) continue;
    const c = centroidOf(out.pts), n: Pt = [-uz, ux], side = Math.sign(dot(n, [c[0] - a[0], c[1] - a[1]])) || 1;
    // (Keep side·n·(x − a) >= h, that is (−side·n)·x <= −side·n·a − h.)
    out = clipHalf(out, [-side * n[0], -side * n[1]], -side * dot(n, a) - h, tag);
  }
  return out;
}

/** How thick a polygon is: of its sides, the least of how far its furthest point stands from that side. */
export function thicknessOf(p: Pt[]): number {
  let least = Infinity;
  for (let k = 0; k < p.length; k++) {
    const { n, c } = sideLine(p, k);
    least = Math.min(least, Math.max(...p.map((q) => c - dot(n, q))));
  }
  return least;
}

/** How far side `k` of a polygon reaches in: its furthest point from that side. */
export function depthFrom(p: Pt[], k: number): number {
  const { n, c } = sideLine(p, k);
  return Math.max(...p.map((q) => c - dot(n, q)));
}

export interface AlleyOptions {
  /** A block larger than this, in square metres, is cut in two (within a factor that `sizeChaos` gives). */
  most: number;
  /** How far a cut strays from the middle of the longest side and from square to it, 0 not at all to 1 a good deal. */
  chaos: number;
  /** How much the largest block left uncut differs from block to block, 0 not at all to 1 four times either way. */
  sizeChaos: number;
  /** The alley's breadth. */
  gap: number;
  /** The thinnest a half may be; a block that would leave one thinner is not cut. */
  thinnest: number;
}

/**
 * A block cut into smaller ones with alleys between them, as watabou's wards are (`createAlleys`): cut square to its longest side,
 * near the middle of it, a little askew, and each half again while it is too large. The alleys are given to `alley`, each as the
 * line down its middle, and the tag of its sides is what `alley` returns.
 */
export function cutAlleys(p: Poly, o: AlleyOptions, rng: Rng, alley: (a: Pt, b: Pt) => number): Poly[] {
  const most = o.most * Math.pow(2, 4 * o.sizeChaos * (rng.next() - 0.5));
  if (areaOf(p.pts) <= most) return [p];
  let k = 0, longest = 0;
  for (let m = 0; m < p.pts.length; m++) { const a = p.pts[m], b = p.pts[(m + 1) % p.pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > longest) { longest = l; k = m; } }
  const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length], spread = 0.8 * o.chaos;
  const ux = (b[0] - a[0]) / longest, uz = (b[1] - a[1]) / longest, tag = -1000;
  // (Where along the side and how askew: as dealt, and failing that, where a cut so dealt would leave a half too thin, at the middle
  // and square.)
  const tries: [number, number][] = [[(1 - spread) / 2 + rng.next() * spread, (rng.next() - 0.5) * (Math.PI / 6) * o.chaos], [0.5, 0]];
  let mid: [Pt, Pt] | null = null, halves: Poly[] = [];
  for (const [at, tilt] of tries) {
    const base: Pt = [a[0] + (b[0] - a[0]) * at, a[1] + (b[1] - a[1]) * at];
    // (Square to the side, into the block, turned by the tilt.)
    const c = Math.cos(tilt), s = Math.sin(tilt), ix = uz, iz = -ux, dx = ix * c - iz * s, dz = ix * s + iz * c;
    const far = Math.max(...p.pts.map((q) => Math.hypot(q[0] - base[0], q[1] - base[1]))) + 5;
    // (The alley's line, clipped to the block.)
    mid = segmentIn(p.pts, [base[0] - dx * 5, base[1] - dz * 5], [base[0] + dx * far, base[1] + dz * far]);
    if (!mid) continue;
    halves = splitPoly(p, mid[0], mid[1], o.gap / 2, tag);
    if (halves.length === 2 && halves.every((h) => thicknessOf(h.pts) >= o.thinnest)) break;
    mid = null;
  }
  if (!mid) return [p];
  const t = alley(mid[0], mid[1]);
  return halves.flatMap((h) => cutAlleys({ pts: h.pts, tags: h.tags.map((g) => (g === tag ? t : g)) }, o, rng, alley));
}

/** The part of a segment within a convex polygon, or null. */
export function segmentIn(p: Pt[], a: Pt, b: Pt): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  for (let k = 0; k < p.length; k++) {
    const { n, c } = sideLine(p, k);
    // (Inside where n·(a + t d) <= c.)
    const num = dot(n, a) - c, den = dot(n, d);
    if (Math.abs(den) < 1e-12) { if (num > 0) return null; continue; }
    const t = -num / den;
    if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-6 ? [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]] : null;
}

/** The parts of a segment outside a convex polygon (none, one or two). */
export function segmentOut(p: Pt[], a: Pt, b: Pt): [Pt, Pt][] {
  const inn = segmentIn(wound(p), a, b);
  if (!inn) return [[a, b]];
  const out: [Pt, Pt][] = [];
  if (Math.hypot(inn[0][0] - a[0], inn[0][1] - a[1]) > 0.05) out.push([a, inn[0]]);
  if (Math.hypot(b[0] - inn[1][0], b[1] - inn[1][1]) > 0.05) out.push([inn[1], b]);
  return out;
}

/** A key for a point, so that the corners cells share are one. */
export const keyOf = (p: Pt) => `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;

/**
 * The least-effort way through a graph of points from `from` to any point `to` accepts, each step costing `cost` (Infinity where it
 * may not be taken). The points' indices in order, or null.
 */
export function leastWay(n: number, next: (i: number) => { j: number; cost: number }[], from: number, to: (i: number) => boolean): number[] | null {
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (to(u)) { const way = [u]; while (prev[way[0]] >= 0) way.unshift(prev[way[0]]); return way; }
    done[u] = 1;
    for (const { j, cost } of next(u)) if (dist[u] + cost < dist[j]) { dist[j] = dist[u] + cost; prev[j] = u; }
  }
}

/** Segments joined end to end into lines wherever two and only two meet, each line as its points. */
export function chainSegments(segs: [Pt, Pt][]): Pt[][] {
  const at = new Map<string, number[]>();
  segs.forEach(([a, b], k) => { for (const p of [a, b]) { const key = keyOf(p); (at.get(key) ?? at.set(key, []).get(key)!).push(k); } });
  const used = new Uint8Array(segs.length), lines: Pt[][] = [];
  const through = (p: Pt, from: number) => { const list = at.get(keyOf(p))!; return list.length === 2 ? list.find((k) => k !== from)! : -1; };
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    let line: Pt[] = [segs[k][0], segs[k][1]];
    // (On from each end while the line goes straight through a point two segments meet at.)
    for (const dir of [1, -1]) {
      let cur = k;
      for (;;) {
        const end = dir > 0 ? line[line.length - 1] : line[0], nk = through(end, cur);
        if (nk < 0 || used[nk]) break;
        used[nk] = 1;
        const [a, b] = segs[nk], other = keyOf(a) === keyOf(end) ? b : a;
        if (dir > 0) line.push(other); else line = [other, ...line];
        cur = nk;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The convex hull of points, going round as a `Poly` does (Andrew's monotone chain). */
export function convexHull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return wound([...lower.slice(0, -1), ...upper.slice(0, -1)]);
}

/** Whether two convex rings part: some side of either has all of the other beyond it. */
export function parted(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length], nx = z1 - z0, nz = x0 - x1;
    const pa = a.map(([x, z]) => x * nx + z * nz), pb = b.map(([x, z]) => x * nx + z * nz);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return true;
  }
  return false;
}
