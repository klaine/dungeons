import { Box3, Ray, Vector3 } from 'three';
import type { SolidPart, Solids } from './solids';

/**
 * Ways for figures over what is solid (`solids.ts`), found as a grid of floors: in each cell of 35 centimetres, every surface facing the
 * sky with room enough over it to stand (1.7 metres), so that the storeys of a house, its stair and its roof are each floors of their own,
 * one over another. Neighbouring floors are joined where a figure could go from one to the other: a step or a low ledge (up to 0.55,
 * which it walks or hops), a ledge it climbs (0.75 to 1.3, straight on only), or a drop (down to 3.2 metres); and where nothing stands
 * between them at knee and chest height. Floors next to a wall cost a little more, so that ways keep off walls but still go through
 * doors. A way is found by A*, then pulled straight wherever a figure could go straight.
 *
 * The grid is made in tiles of some eight metres, only where a way is looked for, and forgotten when anything solid moves. A tile where
 * nothing stands but level paving needs no rays at all, so that ways across an open square are found at once.
 */

export interface Route {
  /** Where to go, in turn; the last is where it was asked to go, or as near to it as could be reached. */
  points: Vector3[];
  /** Whether the place asked for could be reached. */
  reached: boolean;
}

const CELL = 0.35, TILE = 24, HEIGHT = 1.7, STEP = 0.55, CLIMB_LOW = 0.75, CLIMB_HIGH = 1.3, DROP = 3.2, TOP = 60, MOST = 40000;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const OFF = 1 << 15;
const keyOf = (ix: number, iz: number, k: number) => ((ix + OFF) * 65536 + (iz + OFF)) * 16 + k;
const fromKey = (key: number): [number, number, number] => { const k = key % 16, c = (key - k) / 16, iz = (c % 65536) - OFF, ix = Math.floor(c / 65536) - OFF; return [ix, iz, k]; };

interface Tile { floors: number[][]; parts: SolidPart[] }
interface Edge { to: number; cost: number; kind: 'walk' | 'climb' | 'drop' }

/** A small heap of keys by priority, least first. */
class Heap {
  private k: number[] = []; private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, p = this.p; let i = k.length; k.push(key); p.push(pri);
    while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= pri) break; k[i] = k[j]; p[i] = p[j]; i = j; }
    k[i] = key; p[i] = pri;
  }
  pop(): number {
    const k = this.k, p = this.p, top = k[0], lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && p[c + 1] < p[c]) c++; if (p[c] >= lp) break; k[i] = k[c]; p[i] = p[c]; i = c; }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}

export class Nav {
  private tiles = new Map<number, Tile>();
  private edges = new Map<number, Edge[]>();
  private open = new Map<number, boolean>();
  private walls = new Map<string, boolean>();
  private narrows = new Map<string, boolean>();
  private version = -1;
  /** How many tiles were made, and how long the last way took to find, milliseconds: for the lab's foot. */
  made = 0; lastMs = 0; lastSearched = 0;

  constructor(private readonly solids: Solids) {}

  private fresh(): void {
    if (this.version === this.solids.version) return;
    this.version = this.solids.version;
    this.tiles.clear(); this.edges.clear(); this.open.clear(); this.walls.clear(); this.narrows.clear();
  }

  private tile(tx: number, tz: number): Tile {
    const key = tx * 100003 + tz;
    let t = this.tiles.get(key);
    if (t) return t;
    const x0 = tx * TILE * CELL, z0 = tz * TILE * CELL, span = TILE * CELL;
    const parts = this.solids.within(new Box3(new Vector3(x0 - 1, -50, z0 - 1), new Vector3(x0 + span + 1, TOP, z0 + span + 1)));
    const floors: number[][] = [];
    const down = new Vector3(0, -1, 0), ray = new Ray(new Vector3(), down);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL, level = this.solids.levelAt(x, z);
      if (!parts.length) { floors.push(level === null ? [] : [level]); continue; }
      ray.origin.set(x, TOP, z);
      const hits = this.solids.hits(ray, TOP + 50, parts).map((h) => ({ y: h.point.y, up: h.up }));
      if (level !== null) hits.push({ y: level, up: 1 });
      hits.sort((a, b) => b.y - a.y);
      const here: number[] = [];
      let above = Infinity;
      for (const h of hits) {
        // A surface facing the sky with room enough over it to stand; the same floor met twice is one.
        if (h.up > 0.6 && above - h.y >= HEIGHT && !here.some((y) => Math.abs(y - h.y) < 0.05)) here.push(h.y);
        above = Math.min(above, h.y);
      }
      floors.push(here.sort((a, b) => a - b));
    }
    t = { floors, parts };
    this.tiles.set(key, t);
    this.made++;
    return t;
  }

  /** The floors in cell (ix, iz), lowest first. */
  private floorsAt(ix: number, iz: number): number[] {
    const tx = Math.floor(ix / TILE), tz = Math.floor(iz / TILE);
    return this.tile(tx, tz).floors[(iz - tz * TILE) * TILE + (ix - tx * TILE)];
  }

  private partsNear(ix: number, iz: number): SolidPart[] { return this.tile(Math.floor(ix / TILE), Math.floor(iz / TILE)).parts; }

  private centre(ix: number, iz: number, y: number): Vector3 { return new Vector3((ix + 0.5) * CELL, y, (iz + 0.5) * CELL); }

  /**
   * Whether something stands between two cells' middles, from a quarter of a metre over the higher of their floors to as high as a
   * figure stands: a thin slab between them, tested against what is solid there. (Rays at a height or two went between the balusters of a
   * stair's railing, and the way stepped onto the side of a flight; a slab only to a metre and a half let a way off a landing under the
   * edge of the floor above, which the head met.)
   */
  private walled(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const id = ax < bx || (ax === bx && az < bz) ? `${ax},${az},${bx},${bz},${y.toFixed(2)}` : `${bx},${bz},${ax},${az},${y.toFixed(2)}`;
    let w = this.walls.get(id);
    if (w !== undefined) return w;
    const parts = [...new Set([...this.partsNear(ax, az), ...this.partsNear(bx, bz)])];
    w = false;
    if (parts.length) {
      const a = this.centre(ax, az, y), b = this.centre(bx, bz, y), t = 0.04;
      const box = new Box3(new Vector3(Math.min(a.x, b.x) - t, y + 0.25, Math.min(a.z, b.z) - t), new Vector3(Math.max(a.x, b.x) + t, y + HEIGHT + 0.02, Math.max(a.z, b.z) + t));
      w = this.solids.inBox(box, parts);
    }
    this.walls.set(id, w);
    return w;
  }

  private edgesOf(key: number): Edge[] {
    let out = this.edges.get(key);
    if (out) return out;
    const [ix, iz, k] = fromKey(key), y = this.floorsAt(ix, iz)[k];
    out = [];
    const walkTo = new Map<number, number>();
    for (const [dx, dz] of DIRS) {
      const jx = ix + dx, jz = iz + dz, diagonal = dx !== 0 && dz !== 0, there = this.floorsAt(jx, jz);
      // (Not round a corner diagonally: both cells beside the way must be walked to as well.)
      if (diagonal && !(walkTo.has(dx * 3) && walkTo.has(dz * 3 * 7))) continue;
      let best = -1, kind = 'walk' as Edge['kind'], bestD = Infinity;
      there.forEach((t, n) => {
        if (this.narrow(jx, jz, t)) return;
        const dy = t - y, a = Math.abs(dy);
        let as: Edge['kind'] | null = null;
        if (a <= STEP) as = 'walk';
        else if (!diagonal && dy >= CLIMB_LOW && dy <= CLIMB_HIGH) as = 'climb';
        else if (dy < -STEP && dy >= -DROP) as = 'drop';
        if (!as) return;
        const rank = (as === 'walk' ? 0 : as === 'climb' ? 10 : 20) + a;
        if (rank < bestD) { bestD = rank; best = n; kind = as; }
      });
      if (best < 0) continue;
      const ty = there[best];
      // (A ledge is climbed only where there is a floor to come up onto beyond its edge: not up a boulder's side a cell at a time.)
      if (kind === 'climb' && !this.floorsAt(jx + dx, jz + dz).some((f) => Math.abs(f - ty) <= STEP)) continue;
      if (this.walled(ix, iz, jx, jz, Math.max(y, ty))) continue;
      const to = keyOf(jx, jz, best);
      if (kind === 'walk' && !diagonal) walkTo.set(dx !== 0 ? dx * 3 : dz * 3 * 7, to);
      const run = diagonal ? Math.SQRT2 : 1, dy = ty - y;
      out.push({ to, kind, cost: run + (kind === 'walk' ? Math.abs(dy) * 0.6 : kind === 'climb' ? 5 : 1.5 + Math.abs(dy) * 0.5) });
    }
    // (Next to a wall, or the edge of a drop, a cell is not open: ways keep off such cells where they can.)
    this.open.set(key, out.filter((e) => e.kind === 'walk').length === 8);
    this.edges.set(key, out);
    return out;
  }

  private isOpen(key: number): boolean { if (!this.open.has(key)) this.edgesOf(key); return this.open.get(key)!; }

  /**
   * Whether a floor is too narrow to stand on: with nothing level beside it both across and along. The top of a handrail faces the sky
   * and has room over it, and was taken for a floor, and climbed onto.
   */
  private narrow(ix: number, iz: number, y: number): boolean {
    const id = `${ix},${iz},${y.toFixed(2)}`;
    let n = this.narrows.get(id);
    if (n !== undefined) return n;
    const level = (jx: number, jz: number) => this.floorsAt(jx, jz).some((f) => Math.abs(f - y) <= 0.3);
    n = !((level(ix + 1, iz) || level(ix - 1, iz)) && (level(ix, iz + 1) || level(ix, iz - 1)));
    this.narrows.set(id, n);
    return n;
  }

  /** The floor nearest `p` in its cell, or in one about it within `reach` cells: as a key, or null. */
  private nodeAt(p: Vector3, reach = 3): number | null {
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    let best: number | null = null, bestD = Infinity;
    for (let r = 0; r <= reach && best === null; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        this.floorsAt(cx + dx, cz + dz).forEach((y, k) => {
          // (A floor a little over the point is taken before one far under it: the point is where feet stand, or a surface pointed at.
          // One too narrow to stand on is taken only if there is nothing else.)
          const d = Math.abs(y - p.y) + (y > p.y + 0.6 ? 2 : 0) + r * 0.2 + (this.narrow(cx + dx, cz + dz, y) ? 5 : 0);
          if (d < bestD) { bestD = d; best = keyOf(cx + dx, cz + dz, k); }
        });
      }
    }
    return best;
  }

  private pointOf(key: number): Vector3 { const [ix, iz, k] = fromKey(key); return this.centre(ix, iz, this.floorsAt(ix, iz)[k]); }

  /** A way from `from` (where feet stand) to `to`; null if `from` stands on no floor the grid knows. */
  route(from: Vector3, to: Vector3): Route | null {
    const t0 = performance.now();
    this.fresh();
    const start = this.nodeAt(from), goal = this.nodeAt(to, 4);
    if (start === null) return null;
    const goalP = goal === null ? to : this.pointOf(goal);
    // (Most places asked for can be gone to straight, over open ground: then no search at all.)
    if (goal !== null && Math.abs(goalP.y - this.pointOf(start).y) < STEP && this.straight(this.pointOf(start), goalP)) {
      this.lastMs = performance.now() - t0; this.lastSearched = 0;
      return { points: [to.clone().setY(goalP.y)], reached: true };
    }
    const h = (key: number) => this.pointOf(key).distanceTo(goalP) / CELL;
    const g = new Map<number, number>([[start, 0]]), came = new Map<number, number>(), edgeKind = new Map<number, Edge['kind']>();
    const heap = new Heap();
    heap.push(start, h(start));
    let found: number | null = null, nearest = start, nearestH = h(start), searched = 0;
    while (heap.size && searched < MOST) {
      const cur = heap.pop(), gc = g.get(cur)!;
      if (cur === goal) { found = cur; break; }
      searched++;
      const hc = h(cur);
      if (hc < nearestH) { nearestH = hc; nearest = cur; }
      for (const e of this.edgesOf(cur)) {
        // (Off the open floor, a way costs more: it keeps off walls where it has room to.)
        const cost = gc + e.cost * (e.kind === 'walk' && !this.isOpen(e.to) ? 1.8 : 1);
        if (cost >= (g.get(e.to) ?? Infinity)) continue;
        g.set(e.to, cost); came.set(e.to, cur); edgeKind.set(e.to, e.kind);
        // (Leaning on the distance left more than on the cost so far finds a way through a square of buildings some times sooner; the
        // way is pulled straight afterwards, which takes out most of what that costs.)
        heap.push(e.to, cost + h(e.to) * 1.4);
      }
    }
    const end = found ?? nearest, keys = [end];
    while (keys[keys.length - 1] !== start) keys.push(came.get(keys[keys.length - 1])!);
    keys.reverse();
    const points = this.pull(keys, edgeKind);
    if (found !== null && goal !== null) points[points.length - 1] = to.clone().setY(this.pointOf(goal).y);
    this.lastMs = performance.now() - t0;
    this.lastSearched = searched;
    return { points, reached: found !== null };
  }

  /** The way pulled straight: from each point kept, on to the furthest that can be gone to straight, over open floor and no drop or climb. */
  private pull(keys: number[], kind: Map<number, Edge['kind']>): Vector3[] {
    const pts = keys.map((k) => this.pointOf(k)), out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = a + 1;
      for (let c = a + 2; c < Math.min(pts.length, a + 48); c++) {
        if (kind.get(keys[c]) !== 'walk') break;
        if (this.straight(pts[a], pts[c])) b = c;
      }
      // (A drop or a climb is kept as it is: from the edge, onto the floor beyond.)
      out.push(pts[b]);
      a = b;
    }
    return out.slice(1).length ? out.slice(1) : [pts[pts.length - 1]];
  }

  /** Whether a figure could go straight from `a` to `b`: over open floor all the way, each step a step, nothing between. */
  private straight(a: Vector3, b: Vector3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    let y = a.y, px = Math.floor(a.x / CELL), pz = Math.floor(a.z / CELL), pk = -1, pd = 0.3;
    this.floorsAt(px, pz).forEach((f, n2) => { if (Math.abs(f - y) <= pd) { pd = Math.abs(f - y); pk = n2; } });
    for (let s = 1; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n, z = a.z + ((b.z - a.z) * s) / n, ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
      if (ix === px && iz === pz) continue;
      const floors = this.floorsAt(ix, iz);
      let k = -1, best = STEP;
      floors.forEach((f, n2) => { const dy = Math.abs(f - y); if (dy <= best) { best = dy; k = n2; } });
      if (k < 0) return false;
      const key = keyOf(ix, iz, k);
      if (!this.isOpen(key)) return false;
      // (Each cell crossed is one a figure could have stepped into from the last.)
      if (pk >= 0 && !this.edgesOf(keyOf(px, pz, pk)).some((e) => e.to === key && e.kind === 'walk')) return false;
      y = floors[k]; px = ix; pz = iz; pk = k;
    }
    // (And it ends on the floor it was to end on, not one under it: a hall runs on under a stair's landing.)
    return Math.abs(y - b.y) <= STEP;
  }
}
