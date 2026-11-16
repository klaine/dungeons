import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { Place } from '../core/site';
import { Kit } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { plank } from './geom/styles';

/**
 * Furniture: what makes a room a refectory and not just a box. Everything is built from the kit's
 * closed blocks of planking, so it is solid from every side, takes baked light, and is in the way
 * when walked into.
 *
 * Placement is simple and conservative: each piece asks for a rectangle of floor, and gets it only
 * if the rectangle is inside the room and clear of doorways and of everything already placed.
 */

export interface Rect { x0: number; z0: number; x1: number; z1: number }

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const post: MasonryStyle = { ...plank, course: [3, 3], length: [3, 3], tint: [0.8, 0.76, 0.72] };
const board: MasonryStyle = { ...plank, tint: [0.95, 0.9, 0.84] };
const stave: MasonryStyle = { ...plank, course: [3, 3], length: [0.11, 0.15], tint: [0.9, 0.82, 0.7] };
const straw: MasonryStyle = { ...plank, course: [3, 3], length: [3, 3], tint: [1.7, 1.45, 0.85], bevel: 0.03, proud: 0.01 };

export class Furnisher {
  /** How many pieces were placed, and why others were not; for tuning. */
  readonly tally = { placed: 0, outside: 0, overlap: 0, lost: 0, blocksWay: 0 };
  private taken: Rect[];
  /** Things that stand on the floor and cannot be walked through. */
  private solid: Rect[];

  /**
   * `keepClear` is floor nothing may stand on; `solids` are things already standing; `doors` are
   * points just inside each doorway, which must all stay reachable from one another.
   */
  constructor(private kit: Kit, private p: Place, private rng: Rng, keepClear: Rect[], private sparse: number, private doors: [number, number][] = [], solids: Rect[] = []) {
    this.taken = [...keepClear, ...solids];
    this.solid = [...solids];
  }

  /** Whether someone could still walk between all the doorways if `extra` were added. */
  private passable(extra: Rect): boolean {
    if (this.doors.length < 2) return true;
    const p = this.p;
    const cell = 0.2, body = 0.36;
    const nx = Math.ceil((p.x1 - p.x0) / cell), nz = Math.ceil((p.z1 - p.z0) / cell);
    const blocked = new Uint8Array(nx * nz);
    for (const r of [...this.solid, extra]) {
      const i0 = Math.max(0, Math.floor((r.x0 - body - p.x0) / cell)), i1 = Math.min(nx - 1, Math.floor((r.x1 + body - p.x0) / cell));
      const j0 = Math.max(0, Math.floor((r.z0 - body - p.z0) / cell)), j1 = Math.min(nz - 1, Math.floor((r.z1 + body - p.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
    }
    const at = ([x, z]: [number, number]) => Math.min(nz - 1, Math.max(0, Math.floor((z - p.z0) / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x - p.x0) / cell)));
    const start = at(this.doors[0]);
    if (blocked[start]) return false;
    const seen = new Uint8Array(nx * nz);
    seen[start] = 1;
    const queue = [start];
    while (queue.length) {
      const c = queue.pop()!;
      const i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const n = b * nx + a;
        if (!seen[n] && !blocked[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    return this.doors.every((d) => seen[at(d)] === 1);
  }

  /** Claims a rectangle of floor if it is free, with a little air round it. */
  private claim(r: Rect, air = 0.18): boolean {
    const p = this.p;
    if (r.x0 < p.x0 + 0.12 || r.x1 > p.x1 - 0.12 || r.z0 < p.z0 + 0.12 || r.z1 > p.z1 - 0.12) { this.tally.outside++; return false; }
    for (const t of this.taken) {
      if (r.x0 - air < t.x1 && r.x1 + air > t.x0 && r.z0 - air < t.z1 && r.z1 + air > t.z0) { this.tally.overlap++; return false; }
    }
    // A forsaken house has lost some of its furniture.
    if (this.rng.next() < this.sparse) { this.tally.lost++; return false; }
    if (!this.passable(r)) { this.tally.blocksWay++; return false; }
    this.taken.push(r);
    this.solid.push(r);
    this.tally.placed++;
    return true;
  }

  private box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, style: MasonryStyle): void {
    this.kit.box('wood', V(x0, y0, z0), V(x1, y1, z1), style, style, 'furniture');
  }

  /** A top on legs: a table, or a bench if low and narrow. */
  private slabOnLegs(r: Rect, height: number, thick: number, leg: number): void {
    const y = this.p.floor;
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    // Boards run the long way.
    this.kit.box('wood', V(r.x0, y + height - thick, r.z0), V(r.x1, y + height, r.z1), post, alongX ? board : { ...board, course: board.length, length: board.course }, 'furniture');
    const inset = 0.1;
    const long = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const pairs = Math.max(2, Math.round(long / 1.6) + 1);
    for (let k = 0; k < pairs; k++) {
      const t = inset + ((long - 2 * inset - leg) * k) / (pairs - 1);
      for (const side of [0, 1]) {
        const x = alongX ? r.x0 + t : side ? r.x1 - inset - leg : r.x0 + inset;
        const z = alongX ? (side ? r.z1 - inset - leg : r.z0 + inset) : r.z0 + t;
        this.box(x, y - 0.02, z, x + leg, y + height - thick, z + leg, post);
      }
    }
  }

  table(r: Rect): boolean {
    if (!this.claim(r)) return false;
    this.slabOnLegs(r, 0.78, 0.06, 0.09);
    return true;
  }

  bench(r: Rect): boolean {
    if (!this.claim(r, 0.1)) return false;
    this.slabOnLegs(r, 0.45, 0.05, 0.07);
    return true;
  }

  /** A low frame with a straw mattress. */
  bed(r: Rect): boolean {
    if (!this.claim(r)) return false;
    const y = this.p.floor;
    this.box(r.x0, y - 0.02, r.z0, r.x1, y + 0.3, r.z1, board);
    this.box(r.x0 + 0.05, y + 0.3, r.z0 + 0.05, r.x1 - 0.05, y + 0.43, r.z1 - 0.05, straw);
    return true;
  }

  barrel(x: number, z: number, radius = 0.3): boolean {
    if (!this.claim({ x0: x - radius, z0: z - radius, x1: x + radius, z1: z + radius }, 0.04)) return false;
    const y = this.p.floor;
    this.kit.roundWall('wood', x, z, radius, y - 0.02, y + 0.86, stave, false, { open: { v0: true, v1: true } });
    // The head: narrow wedges, so that it comes out round. Each wedge is flat, and three wide
    // ones made a triangle that left the barrel open at the rim. It laps the staves a little.
    this.kit.ring('wood', x, z, 0.004, radius * 1.02, y + 0.86, { ...stave, length: [0.062, 0.072] });
    this.kit.mass(V(x - radius * 0.6, y, z - radius * 0.6), V(x + radius * 0.6, y + 0.8, z + radius * 0.6));
    return true;
  }

  crate(x: number, z: number, size: number, stacked = false): boolean {
    if (!this.claim({ x0: x - size / 2, z0: z - size / 2, x1: x + size / 2, z1: z + size / 2 }, 0.05)) return false;
    const y = this.p.floor;
    this.box(x - size / 2, y - 0.02, z - size / 2, x + size / 2, y + size, z + size / 2, board);
    if (stacked) {
      const s = size * 0.8;
      this.box(x - s / 2 + 0.04, y + size, z - s / 2, x + s / 2 + 0.04, y + size + s, z + s / 2, board);
    }
    return true;
  }

  /** Shelves standing against a wall: `r` is the footprint, and boards run the long way. */
  shelf(r: Rect): boolean {
    if (!this.claim(r, 0.1)) return false;
    const y = this.p.floor;
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const t = 0.05;
    if (alongX) {
      this.box(r.x0, y - 0.02, r.z0, r.x0 + t, y + 1.75, r.z1, post);
      this.box(r.x1 - t, y - 0.02, r.z0, r.x1, y + 1.75, r.z1, post);
    } else {
      this.box(r.x0, y - 0.02, r.z0, r.x1, y + 1.75, r.z0 + t, post);
      this.box(r.x0, y - 0.02, r.z1 - t, r.x1, y + 1.75, r.z1, post);
    }
    for (const h of [0.28, 0.76, 1.24, 1.7]) this.box(r.x0, y + h, r.z0, r.x1, y + h + 0.04, r.z1, board);
    return true;
  }

  /** A rectangle against one wall: `at` along it, `width` wide, reaching `depth` into the room. */
  private against(side: 'n' | 's' | 'e' | 'w', at: number, width: number, depth: number, gap = 0.14): Rect {
    const p = this.p;
    switch (side) {
      case 'n': return { x0: at - width / 2, x1: at + width / 2, z0: p.z0 + gap, z1: p.z0 + gap + depth };
      case 's': return { x0: at - width / 2, x1: at + width / 2, z0: p.z1 - gap - depth, z1: p.z1 - gap };
      case 'w': return { x0: p.x0 + gap, x1: p.x0 + gap + depth, z0: at - width / 2, z1: at + width / 2 };
      case 'e': return { x0: p.x1 - gap - depth, x1: p.x1 - gap, z0: at - width / 2, z1: at + width / 2 };
    }
  }

  /** Furnishes the room according to what it is called. */
  furnish(): void {
    const p = this.p, rng = this.rng;
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const alongX = dx >= dz;
    const longWalls: ('n' | 's' | 'e' | 'w')[] = alongX ? ['n', 's'] : ['w', 'e'];
    const lo = alongX ? p.x0 : p.z0, long = alongX ? dx : dz, short = alongX ? dz : dx;
    const rectAlong = (a0: number, a1: number, b0: number, b1: number): Rect => (alongX ? { x0: a0, x1: a1, z0: b0, z1: b1 } : { x0: b0, x1: b1, z0: a0, z1: a1 });
    const mid = alongX ? cz : cx;
    const along = (side: 'n' | 's' | 'e' | 'w') => (side === 'n' || side === 's' ? [p.x0, p.x1] : [p.z0, p.z1]);
    const corners: [number, number][] = [[p.x0 + 0.55, p.z0 + 0.55], [p.x1 - 0.55, p.z0 + 0.55], [p.x0 + 0.55, p.z1 - 0.55], [p.x1 - 0.55, p.z1 - 0.55]];
    const cluster = (cornerIndex: number) => {
      const [x, z] = corners[cornerIndex];
      const sx = x < cx ? 1 : -1, sz = z < cz ? 1 : -1;
      this.barrel(x, z);
      this.barrel(x + sx * 0.66, z + sz * 0.05);
      this.barrel(x + sx * 0.1, z + sz * 0.66);
      if (rng.chance(0.6)) this.crate(x + sx * 0.75, z + sz * 0.78, 0.6, rng.chance(0.5));
    };
    const shelves = (count: number) => {
      for (const side of ['n', 's', 'w', 'e'] as const) {
        if (count <= 0) break;
        const [a, b] = along(side);
        if (this.shelf(this.against(side, a + (b - a) * rng.range(0.3, 0.7), Math.min(1.8, (b - a) * 0.4), 0.34))) count--;
      }
    };

    // Greedy rows: slide along and set a piece down wherever one fits.
    const wallRow = (side: 'n' | 's' | 'e' | 'w', width: number, depth: number, gap: number, make: (r: Rect) => boolean, wallGap = 0.14) => {
      const [a, b] = along(side);
      for (let at = a + width / 2 + 0.25; at <= b - width / 2 - 0.25;) {
        if (make(this.against(side, at, width, depth, wallGap))) at += width + gap;
        else at += 0.3;
      }
    };
    const centreRow = (offset: number, length: number, width: number, gap: number, make: (r: Rect) => boolean): number => {
      let made = 0;
      for (let at = lo + 0.8; at + length <= lo + long - 0.8;) {
        if (make(rectAlong(at, at + length, mid + offset - width / 2, mid + offset + width / 2))) { at += length + gap; made++; }
        else at += 0.3;
      }
      return made;
    };

    switch (p.name) {
      case 'refectory': {
        // Tables end to end down the room, a bench either side of each.
        for (const shift of [0, 1.3, -1.3]) {
          const tables: Rect[] = [];
          centreRow(shift, Math.min(2.6, long - 3), 0.86, 0.05, (r) => { const ok = this.table(r); if (ok) tables.push(r); return ok; });
          for (const t of tables) {
            const [a0, a1] = alongX ? [t.x0, t.x1] : [t.z0, t.z1];
            const b = alongX ? (t.z0 + t.z1) / 2 : (t.x0 + t.x1) / 2;
            this.bench(rectAlong(a0 + 0.15, a1 - 0.15, b + 0.65, b + 0.97));
            this.bench(rectAlong(a0 + 0.15, a1 - 0.15, b - 0.97, b - 0.65));
          }
          if (tables.length) break;
        }
        break;
      }
      case 'dormitory': {
        // Beds with their heads to the long walls.
        for (const side of longWalls) wallRow(side, 0.86, Math.min(1.95, short / 2 - 0.7), 0.6, (r) => this.bed(r));
        break;
      }
      case 'chapter house':
      case 'gallery':
      case 'gatehall': {
        for (const side of longWalls) wallRow(side, 2.0, 0.34, 0.5, (r) => this.bench(r));
        break;
      }
      case 'scriptorium': {
        // Desks in a row under one wall, each with a stool; books on shelves.
        const side = rng.pick(longWalls);
        wallRow(side, 1.1, 0.62, 0.8, (desk) => {
          if (!this.table(desk)) return false;
          this.crate((desk.x0 + desk.x1) / 2 + (alongX ? 0 : side === 'w' ? 0.75 : -0.75), (desk.z0 + desk.z1) / 2 + (alongX ? (side === 'n' ? 0.75 : -0.75) : 0), 0.36);
          return true;
        }, 0.5);
        shelves(2);
        break;
      }
      case 'kitchen': {
        if (!centreRow(0, Math.min(2.4, long - 3), 1.0, 9, (r) => this.table(r))) centreRow(rng.pick([1.3, -1.3]), Math.min(2.4, long - 3), 1.0, 9, (r) => this.table(r));
        cluster(rng.int(0, 3));
        shelves(1);
        break;
      }
      case 'store':
      case 'strongroom': {
        const order = [0, 1, 2, 3].sort(() => rng.next() - 0.5);
        cluster(order[0]);
        cluster(order[1]);
        if (rng.chance(0.5)) cluster(order[2]);
        shelves(1);
        break;
      }
      case 'workshop': {
        const side = rng.pick(longWalls);
        wallRow(side, Math.min(2.6, long - 2.4), 0.7, 9, (r) => this.table(r));
        cluster(rng.int(0, 3));
        this.crate(cx + rng.range(-0.8, 0.8), cz + rng.range(-0.8, 0.8), 0.65);
        break;
      }
      case 'cell':
      case 'oubliette': {
        const [x, z] = corners[rng.int(0, 3)];
        const bx = x < cx ? p.x0 + 0.2 : p.x1 - 0.2 - 0.86, bz = z < cz ? p.z0 + 0.2 : p.z1 - 0.2 - 1.9;
        this.bed({ x0: bx, x1: bx + 0.86, z0: bz, z1: bz + 1.9 });
        this.crate(cx + rng.range(-0.5, 0.5), cz + rng.range(-0.5, 0.5), 0.5);
        break;
      }
      case 'vestry':
      case 'reliquary':
      case 'antechamber': {
        shelves(2);
        break;
      }
      default:
        break;
    }
  }
}
