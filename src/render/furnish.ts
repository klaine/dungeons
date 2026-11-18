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

type Colour = [number, number, number];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
/** Turned wood, from pale ash to old dark oak; earthenware and stoneware; bindings of calf, of dyed leather, of vellum. */
const WOODS: Colour[] = [[0.62, 0.45, 0.28], [0.5, 0.34, 0.2], [0.38, 0.25, 0.15], [0.66, 0.52, 0.36]];
const POTS: Colour[] = [[0.55, 0.28, 0.16], [0.48, 0.3, 0.2], [0.6, 0.55, 0.47], [0.4, 0.38, 0.33], [0.62, 0.36, 0.2]];
const LEATHER: Colour[] = [[0.35, 0.18, 0.09], [0.28, 0.14, 0.08], [0.42, 0.26, 0.13], [0.33, 0.07, 0.06], [0.12, 0.2, 0.12], [0.1, 0.12, 0.22], [0.7, 0.62, 0.48], [0.2, 0.12, 0.07]];

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
  /** The small things set on tables and shelves are chosen from a stream of their own, so that adding them moved nothing else. */
  private small: Rng;

  constructor(private kit: Kit, private p: Place, private rng: Rng, keepClear: Rect[], private sparse: number, private doors: [number, number][] = [], solids: Rect[] = []) {
    this.taken = [...keepClear, ...solids];
    this.solid = [...solids];
    this.small = rng.fork('small things');
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
    // A blanket of undyed or dyed wool over the foot of it, falling a little over its sides, and a bolster at its head (the end
    // nearer a wall). A forsaken house has kept fewer of them.
    const q = this.small, alongX = r.x1 - r.x0 > r.z1 - r.z0, p = this.p;
    const headLow = alongX ? r.x0 - p.x0 < p.x1 - r.x1 : r.z0 - p.z0 < p.z1 - r.z1;
    if (q.next() > this.sparse) {
      const wool: Colour = q.pick([[0.55, 0.5, 0.42], [0.42, 0.36, 0.28], [0.36, 0.14, 0.1], [0.2, 0.24, 0.3], [0.3, 0.32, 0.22]]);
      const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0, cover = len * q.range(0.55, 0.72);
      const [a0, a1] = headLow ? [(alongX ? r.x1 : r.z1) - cover, alongX ? r.x1 : r.z1] : [alongX ? r.x0 : r.z0, (alongX ? r.x0 : r.z0) + cover];
      if (alongX) this.block('plaster', a0, y + 0.33, r.z0 + 0.02, a1 - 0.03, y + 0.47, r.z1 - 0.02, wool);
      else this.block('plaster', r.x0 + 0.02, y + 0.33, a0, r.x1 - 0.02, y + 0.47, a1 - 0.03, wool);
    }
    if (q.next() > this.sparse * 0.5) {
      const h0 = headLow ? (alongX ? r.x0 : r.z0) + 0.08 : (alongX ? r.x1 : r.z1) - 0.34;
      if (alongX) this.block('plaster', h0, y + 0.43, r.z0 + 0.1, h0 + 0.26, y + 0.55, r.z1 - 0.1, [0.78, 0.74, 0.64]);
      else this.block('plaster', r.x0 + 0.1, y + 0.43, h0, r.x1 - 0.1, y + 0.55, h0 + 0.26, [0.78, 0.74, 0.64]);
    }
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

  /**
   * A turned thing, closed top and foot: a bowl, a jug, a pot, a candle. `profile` is radius and height pairs from the foot up;
   * the sides are smooth, the top and the foot flat, and the top may be another colour (what is in it).
   */
  private turned(material: string, x: number, y: number, z: number, profile: [number, number][], colour: Colour, top: Colour = colour, sides = 12): void {
    const m = this.kit.mesh(material), n = profile.length;
    // The slope of the side at each point of the profile, from the points either side of it.
    const normals = profile.map((_, j) => {
      const [r0, h0] = profile[Math.max(0, j - 1)], [r1, h1] = profile[Math.min(n - 1, j + 1)];
      const l = Math.hypot(h1 - h0, r1 - r0) || 1;
      return [(h1 - h0) / l, -(r1 - r0) / l];
    });
    const rows: number[][] = profile.map(([r, h], j) => Array.from({ length: sides + 1 }, (_, k) => {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), [nr, nh] = normals[j];
      return m.addVertex(x + r * c, y + h, z + r * sn, nr * c, nh, nr * sn, (a * 0.08) / 0.5, h * 2, colour[0], colour[1], colour[2]);
    }));
    for (let j = 0; j + 1 < n; j++) for (let k = 0; k < sides; k++) {
      const a = rows[j][k], b = rows[j][k + 1], c = rows[j + 1][k + 1], d = rows[j + 1][k];
      m.addTriangle(a, c, b);
      m.addTriangle(a, d, c);
    }
    for (const [j, up] of [[0, -1], [n - 1, 1]] as const) {
      const [r, h] = profile[j], tone = up > 0 ? top : colour;
      const centre = m.addVertex(x, y + h, z, 0, up, 0, 0, 0, tone[0], tone[1], tone[2]);
      const rim = Array.from({ length: sides + 1 }, (_, k) => {
        const a = (k / sides) * Math.PI * 2;
        return m.addVertex(x + r * Math.cos(a), y + h, z + r * Math.sin(a), 0, up, 0, r * Math.cos(a), r * Math.sin(a), tone[0], tone[1], tone[2]);
      });
      for (let k = 0; k < sides; k++) if (up > 0) m.addTriangle(centre, rim[k + 1], rim[k]); else m.addTriangle(centre, rim[k], rim[k + 1]);
    }
  }

  /** A squared small thing: a book, a board, a box. */
  private block(material: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: Colour): void {
    const m = this.kit.mesh(material);
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const faces: [number[], number[]][] = [[[0, 3, 2, 1], [0, -1, 0]], [[4, 5, 6, 7], [0, 1, 0]], [[0, 1, 5, 4], [0, 0, -1]], [[2, 3, 7, 6], [0, 0, 1]], [[1, 2, 6, 5], [1, 0, 0]], [[3, 0, 4, 7], [-1, 0, 0]]];
    for (const [ids, nm] of faces) {
      const v = ids.map((i) => m.addVertex(P[i][0], P[i][1], P[i][2], nm[0], nm[1], nm[2], (nm[0] ? P[i][2] : P[i][0]) * 2, (nm[1] ? P[i][2] : P[i][1]) * 2, colour[0], colour[1], colour[2]));
      m.addTriangle(v[0], v[2], v[1]);
      m.addTriangle(v[0], v[3], v[2]);
    }
  }

  // The things themselves. Turned wood is pale and warm, earthenware red-brown or grey, iron near black.
  private bowl(x: number, y: number, z: number): void {
    const q = this.small, wood: Colour = q.pick(WOODS), k = q.range(0.85, 1.15);
    this.turned('wood', x, y, z, [[0.045 * k, 0], [0.07 * k, 0.012], [0.095 * k, 0.04], [0.1 * k, 0.055]], wood, q.chance(0.5) ? [0.3, 0.2, 0.09] : shade(wood, 0.7));
  }
  private cup(x: number, y: number, z: number): void {
    const q = this.small;
    this.turned('plaster', x, y, z, [[0.032, 0], [0.036, 0.01], [0.04, 0.085], [0.042, 0.09]], q.pick(POTS), [0.12, 0.08, 0.05], 10);
  }
  private jug(x: number, y: number, z: number): void {
    const q = this.small, k = q.range(0.85, 1.2);
    this.turned('plaster', x, y, z, [[0.06 * k, 0], [0.075 * k, 0.02], [0.088 * k, 0.08 * k], [0.075 * k, 0.15 * k], [0.045 * k, 0.2 * k], [0.04 * k, 0.225 * k], [0.05 * k, 0.24 * k]], q.pick(POTS), [0.06, 0.05, 0.04]);
  }
  private pot(x: number, y: number, z: number): void {
    const q = this.small, k = q.range(0.9, 1.3);
    this.turned('metal', x, y, z, [[0.07 * k, 0], [0.12 * k, 0.04 * k], [0.14 * k, 0.11 * k], [0.13 * k, 0.17 * k], [0.135 * k, 0.18 * k]], [0.045, 0.042, 0.04], [0.16, 0.11, 0.06]);
  }
  private crock(x: number, y: number, z: number, k: number): void {
    const q = this.small;
    this.turned('plaster', x, y, z, [[0.05 * k, 0], [0.075 * k, 0.03 * k], [0.085 * k, 0.12 * k], [0.06 * k, 0.19 * k], [0.055 * k, 0.21 * k]], q.pick(POTS), [0.25, 0.22, 0.18]);
  }
  private loaf(x: number, y: number, z: number): void {
    this.turned('plaster', x, y, z, [[0.07, 0], [0.09, 0.02], [0.085, 0.055], [0.055, 0.08], [0.02, 0.09]], [0.55, 0.36, 0.17], [0.5, 0.33, 0.15], 10);
  }
  /** A candle in a dish: lit, unless the house is forsaken. */
  private candle(x: number, y: number, z: number): void {
    const q = this.small, tall = q.range(0.08, 0.2);
    this.turned('metal', x, y, z, [[0.05, 0], [0.055, 0.008], [0.05, 0.016]], [0.12, 0.09, 0.05]);
    this.turned('plaster', x, y + 0.016, z, [[0.016, 0], [0.016, tall], [0.012, tall + 0.008]], [0.9, 0.86, 0.72], [0.9, 0.86, 0.72], 8);
    if (!this.sparse) this.turned('lamp', x, y + 0.016 + tall + 0.012, z, [[0.006, 0], [0.009, 0.015], [0.002, 0.04]], [1, 0.85, 0.5], [1, 0.85, 0.5], 6);
  }
  /** A book lying open: two leaves of pale parchment in a binding, and a quill and ink by it. */
  private openBook(x: number, y: number, z: number, alongX: boolean): void {
    const q = this.small, cover: Colour = q.pick(LEATHER), page: Colour = [0.8, 0.74, 0.6];
    const [hw, hd] = alongX ? [0.17, 0.12] : [0.12, 0.17];
    this.block('plaster', x - hw - 0.01, y, z - hd - 0.01, x + hw + 0.01, y + 0.012, z + hd + 0.01, cover);
    this.block('plaster', x - hw, y + 0.012, z - hd, x + hw, y + 0.03, z + hd, page);
    const ix = x + (alongX ? hw + 0.09 : 0.1), iz = z + (alongX ? 0.08 : hd + 0.09);
    this.turned('plaster', ix, y, iz, [[0.025, 0], [0.028, 0.035], [0.012, 0.045], [0.014, 0.05]], [0.05, 0.05, 0.06], [0.01, 0.01, 0.015], 8);
    this.block('plaster', ix - 0.004, y + 0.04, iz - 0.004, ix + 0.004, y + 0.2, iz + 0.004, [0.85, 0.83, 0.78]);
  }

  /**
   * What is set on a table, by what the room is for: bowls and cups at the places down either side, a jug, a loaf and a candle
   * down the middle of a refectory's; a book open on a desk; a pot, bowls and a loaf on a kitchen's. A forsaken house has less.
   */
  private setTable(r: Rect, kind: 'meal' | 'desk' | 'kitchen' | 'work'): void {
    const q = this.small, y = this.p.floor + 0.78, alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1, mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2, half = alongX ? (r.z1 - r.z0) / 2 : (r.x1 - r.x0) / 2;
    const at = (a: number, b: number): [number, number] => (alongX ? [a, mid + b] : [mid + b, a]);
    const keep = () => q.next() > this.sparse * 1.2;
    if (kind === 'meal') {
      for (const side of [-1, 1]) for (let a = a0 + 0.35; a < a1 - 0.25; a += 0.62) {
        if (!keep() || q.chance(0.25)) continue;
        const [x, z] = at(a + q.range(-0.05, 0.05), side * (half - 0.2));
        this.bowl(x, y, z);
        if (q.chance(0.55)) { const [cx, cz] = at(a + 0.17, side * (half - 0.15)); this.cup(cx, y, cz); }
      }
      for (let a = a0 + 0.6; a < a1 - 0.4; a += q.range(0.8, 1.3)) {
        if (!keep()) continue;
        const [x, z] = at(a, q.range(-0.06, 0.06)), what = q.int(0, 3);
        if (what === 0) this.jug(x, y, z); else if (what === 1) this.loaf(x, y, z); else if (what === 2) this.candle(x, y, z);
      }
    } else if (kind === 'desk') {
      const [x, z] = at((a0 + a1) / 2 - 0.08, 0);
      if (keep()) this.openBook(x, y, z, alongX);
      const [cx, cz] = at(a0 + 0.12, -half + 0.12);
      if (keep()) this.candle(cx, y, cz);
    } else if (kind === 'work') {
      // A workbench: a mallet, offcuts of board, a pot of glue, and an iron blade or two.
      const wood: Colour = q.pick(WOODS);
      for (let a = a0 + 0.3; a < a1 - 0.3; a += q.range(0.5, 0.9)) {
        if (!keep()) continue;
        const [x, z] = at(a, q.range(-half + 0.15, half - 0.15)), what = q.int(0, 3);
        const lay = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, c: Colour, m = 'wood') =>
          alongX ? this.block(m, x + u0, y + h0, z + v0, x + u1, y + h1, z + v1, c) : this.block(m, x + v0, y + h0, z + u0, x + v1, y + h1, z + u1, c);
        if (what === 0) { lay(-0.03, 0.03, -0.16, 0.12, 0, 0.03, shade(wood, 0.9)); lay(-0.06, 0.06, 0.12, 0.2, 0, 0.09, shade(wood, 0.7)); }
        else if (what === 1) { const n = q.int(2, 4); for (let k = 0, h = 0; k < n; k++, h += 0.025) lay(-0.25 + k * 0.03, 0.25 - k * 0.02, -0.06 - k * 0.01, 0.07, h, h + 0.025, shade(wood, q.range(0.8, 1.1))); }
        else if (what === 2) this.turned('plaster', x, y, z, [[0.045, 0], [0.05, 0.07], [0.04, 0.09]], q.pick(POTS), [0.3, 0.22, 0.1], 10);
        else lay(-0.2, 0.2, -0.04, 0.04, 0, 0.006, [0.2, 0.2, 0.21], 'metal');
      }
    } else {
      const [px, pz] = at(a0 + (a1 - a0) * q.range(0.25, 0.4), 0);
      if (keep()) this.pot(px, y, pz);
      for (let a = (a0 + a1) / 2; a < a1 - 0.2; a += 0.3) if (keep() && q.chance(0.6)) { const [x, z] = at(a, q.range(-half + 0.15, half - 0.15)); this.bowl(x, y, z); }
      if (keep()) { const [x, z] = at(a0 + 0.25, half - 0.2); this.loaf(x, y, z); }
      if (keep()) { const [x, z] = at(a1 - 0.2, -half + 0.18); this.jug(x, y, z); }
    }
  }

  /** What a shelf holds: books standing in runs, a few lying in a pile; or crocks, jugs and bowls. Not every board is full. */
  private stock(r: Rect, fill: 'books' | 'stores'): void {
    const q = this.small, y = this.p.floor, alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const a0 = (alongX ? r.x0 : r.z0) + 0.07, a1 = (alongX ? r.x1 : r.z1) - 0.07, b0 = alongX ? r.z0 : r.x0, b1 = alongX ? r.z1 : r.x1;
    const box = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, c: Colour) =>
      alongX ? this.block('plaster', u0, h0, v0, u1, h1, v1, c) : this.block('plaster', v0, h0, u0, v1, h1, u1, c);
    // (The wall is on the side of the rectangle nearer the room's edge: things stand back against it.)
    const p = this.p, wallLow = alongX ? r.z0 - p.z0 < p.z1 - r.z1 : r.x0 - p.x0 < p.x1 - r.x1;
    for (const h of [0.28, 0.76, 1.24]) {
      const floor = y + h + 0.04;
      if (q.next() < 0.15 + this.sparse) continue;
      let a = a0 + q.range(0, 0.15);
      while (a < a1 - 0.05) {
        if (q.chance(0.08)) { a += q.range(0.1, 0.3); continue; }
        if (fill === 'books') {
          // A run of books, of a height and a depth of their own, standing against the back; now and then a short pile lying flat.
          if (q.chance(0.08) && a + 0.3 < a1) {
            let top = floor;
            for (let k = q.int(2, 5); k > 0; k--) { const t = q.range(0.03, 0.06); box(a, a + 0.26, wallLow ? b0 + 0.04 : b1 - 0.24, wallLow ? b0 + 0.24 : b1 - 0.04, top, top + t, q.pick(LEATHER)); top += t; }
            a += 0.3;
            continue;
          }
          const w = q.range(0.025, 0.065), tall = q.range(0.18, 0.32), deep = q.range(0.15, 0.24);
          if (a + w > a1) break;
          const tone = q.range(0.75, 1.15), c = q.pick(LEATHER);
          box(a, a + w, wallLow ? b0 + 0.03 : b1 - 0.03 - deep, wallLow ? b0 + 0.03 + deep : b1 - 0.03, floor, floor + Math.min(tall, 0.42), shade(c, tone));
          a += w + (q.chance(0.85) ? 0.003 : q.range(0.02, 0.06));
        } else {
          const k = q.range(0.7, 1.15), rad = 0.09 * k;
          if (a + rad * 2 > a1) break;
          const u = a + rad, v = (b0 + b1) / 2, [x, z] = alongX ? [u, v] : [v, u], what = q.int(0, 4);
          if (what <= 1) this.crock(x, floor, z, k); else if (what === 2) this.jug(x, floor, z); else this.bowl(x, floor, z);
          a += rad * 2 + q.range(0.04, 0.12);
        }
      }
    }
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
    const shelves = (count: number, fill?: 'books' | 'stores') => {
      for (const side of ['n', 's', 'w', 'e'] as const) {
        if (count <= 0) break;
        const [a, b] = along(side), r = this.against(side, a + (b - a) * rng.range(0.3, 0.7), Math.min(1.8, (b - a) * 0.4), 0.34);
        if (this.shelf(r)) { count--; if (fill) this.stock(r, fill); }
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
        const before = this.tally.placed;
        // Tables end to end down the room, a bench either side of each.
        for (const shift of [0, 1.3, -1.3]) {
          const tables: Rect[] = [];
          centreRow(shift, Math.min(2.6, long - 3), 0.86, 0.05, (r) => { const ok = this.table(r); if (ok) tables.push(r); return ok; });
          for (const t of tables) {
            this.setTable(t, 'meal');
            const [a0, a1] = alongX ? [t.x0, t.x1] : [t.z0, t.z1];
            const b = alongX ? (t.z0 + t.z1) / 2 : (t.x0 + t.x1) / 2;
            this.bench(rectAlong(a0 + 0.15, a1 - 0.15, b + 0.65, b + 0.97));
            this.bench(rectAlong(a0 + 0.15, a1 - 0.15, b - 0.97, b - 0.65));
          }
          if (tables.length) break;
        }
        // (Where the middle of the room must be kept clear, its doors facing one another across it, the tables stand along the long
        // walls instead, a bench on the inner side of each. Without them a refectory with doors on every side was an empty hall.)
        if (this.tally.placed === before) {
          for (const side of longWalls) wallRow(side, Math.min(2.4, long * 0.35), 0.78, 0.5, (r) => {
            const inner: Rect = side === 'n' ? { ...r, z0: r.z1 + 0.18, z1: r.z1 + 0.5 } : side === 's' ? { ...r, z0: r.z0 - 0.5, z1: r.z0 - 0.18 }
              : side === 'w' ? { ...r, x0: r.x1 + 0.18, x1: r.x1 + 0.5 } : { ...r, x0: r.x0 - 0.5, x1: r.x0 - 0.18 };
            // (Shortened a little at each end, as a bench is.)
            const trim = (q: Rect): Rect => (side === 'n' || side === 's' ? { ...q, x0: q.x0 + 0.15, x1: q.x1 - 0.15 } : { ...q, z0: q.z0 + 0.15, z1: q.z1 - 0.15 });
            if (!this.table(r)) return false;
            this.setTable(r, 'meal');
            this.bench(trim(inner));
            return true;
          }, 0.3);
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
          this.setTable(desk, 'desk');
          this.crate((desk.x0 + desk.x1) / 2 + (alongX ? 0 : side === 'w' ? 0.75 : -0.75), (desk.z0 + desk.z1) / 2 + (alongX ? (side === 'n' ? 0.75 : -0.75) : 0), 0.36);
          return true;
        }, 0.5);
        shelves(2, 'books');
        break;
      }
      case 'kitchen': {
        const laid = (r: Rect) => { if (!this.table(r)) return false; this.setTable(r, 'kitchen'); return true; };
        if (!centreRow(0, Math.min(2.4, long - 3), 1.0, 9, laid)) centreRow(rng.pick([1.3, -1.3]), Math.min(2.4, long - 3), 1.0, 9, laid);
        cluster(rng.int(0, 3));
        shelves(1, 'stores');
        break;
      }
      case 'store':
      case 'strongroom': {
        const order = [0, 1, 2, 3].sort(() => rng.next() - 0.5);
        cluster(order[0]);
        cluster(order[1]);
        if (rng.chance(0.5)) cluster(order[2]);
        shelves(1, 'stores');
        break;
      }
      case 'workshop': {
        const side = rng.pick(longWalls);
        wallRow(side, Math.min(2.6, long - 2.4), 0.7, 9, (r) => { if (!this.table(r)) return false; this.setTable(r, 'work'); return true; });
        cluster(rng.int(0, 3));
        this.crate(cx + rng.range(-0.8, 0.8), cz + rng.range(-0.8, 0.8), 0.65);
        break;
      }
      case 'cell':
      case 'oubliette': {
        const [x, z] = corners[rng.int(0, 3)];
        const bx = x < cx ? p.x0 + 0.2 : p.x1 - 0.2 - 0.86, bz = z < cz ? p.z0 + 0.2 : p.z1 - 0.2 - 1.9;
        this.bed({ x0: bx, x1: bx + 0.86, z0: bz, z1: bz + 1.9 });
        // A crate for a table, with a bowl and a jug on it.
        const kx = cx + rng.range(-0.5, 0.5), kz = cz + rng.range(-0.5, 0.5);
        if (this.crate(kx, kz, 0.5) && this.small.next() > this.sparse) { this.bowl(kx - 0.08, p.floor + 0.5, kz + 0.06); this.jug(kx + 0.1, p.floor + 0.5, kz - 0.08); }
        break;
      }
      case 'vestry':
      case 'reliquary':
      case 'antechamber': {
        shelves(2, 'books');
        break;
      }
      // An undercroft is where a house keeps what it lays by: barrels and crates gathered in its corners, shelves along a wall.
      // (It was left bare, a vault of nothing.)
      case 'undercroft': {
        const order = [0, 1, 2, 3].sort(() => rng.next() - 0.5);
        cluster(order[0]);
        cluster(order[1]);
        cluster(order[2]);
        shelves(2, 'stores');
        break;
      }
      // What someone hid away: a chest or two and a shelf of things, left in the dust.
      case 'hidden chamber': {
        const [x, z] = corners[rng.int(0, 3)];
        this.crate(x + (x < cx ? 0.25 : -0.25), z + (z < cz ? 0.25 : -0.25), 0.7, rng.chance(0.4));
        this.crate(cx + rng.range(-0.6, 0.6), cz + rng.range(-0.6, 0.6), 0.55);
        shelves(1, 'books');
        break;
      }
      default:
        break;
    }
  }
}
