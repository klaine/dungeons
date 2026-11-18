import { Rng } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';
import { anyAngle } from './coast';

type Colour = [number, number, number];
type P3 = [number, number, number];

/**
 * A dry-stone wall, as walls round fields on the western isles and the hill country are built: no
 * mortar, two faces of stones laid in courses, battered (broader at the foot than at the top), and
 * a coping of stones set on edge along the top to hold it down. Each stone is a block of its own,
 * of its own length and shade, set a little in or out of its neighbours; the courses follow the
 * ground. A gateway is a gap with a tall stone on either side; a tumbled stretch stands half as
 * high, and what fell from it lies along its foot.
 */
export interface WallSpec {
  line: [number, number][];
  gaps: [number, number][];
  fallen: [number, number][];
  height: number;
}

export function layWall(mesh: (material: string) => MeshBuilder, w: WallSpec, ground: (x: number, z: number) => number, stone: Colour, rng: Rng): void {
  const { solid } = anyAngle(mesh);
  const inRuns = (k: number, runs: [number, number][]) => runs.some(([a, b]) => k >= a && k < b);
  const COURSE = 0.26, FOOT = 0.78, TOP = 0.48;
  const tone = (): Colour => {
    const k = rng.range(0.7, 1.15), lichen = rng.next();
    // (Weathered grey, each stone its own; many with the pale grey-green or the yellow of lichen on them, a few darker where the weather lies.)
    if (lichen < 0.2) return [stone[0] * k * 1.18 + 0.05, stone[1] * k * 1.2 + 0.05, stone[2] * k * 1.05 + 0.04];
    if (lichen < 0.3) return [stone[0] * k * 1.15, stone[1] * k * 1.1, stone[2] * k * 0.72];
    if (lichen < 0.4) return [stone[0] * k * 0.72, stone[1] * k * 0.74, stone[2] * k * 0.72];
    return [stone[0] * k, stone[1] * k, stone[2] * k];
  };
  /**
   * A block from `a` to `b` along the wall at `y0` to `y1`, half as wide as `half`, nudged by `jog` across; its top tipped along the
   * wall by `lean` and its two ends of different heights by `tip`, as a rough stone sits. (A box with square corners everywhere
   * read as a wall of bricks.)
   */
  const block = (ax: number, az: number, bx: number, bz: number, y0a: number, y0b: number, h: number, half: number, jog: number, colour: Colour, lean = 0, tip = 0) => {
    const l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l, px = -uz, pz = ux;
    const c = (x: number, z: number, side: number, y: number, along = 0): P3 => [x + px * (side * half + jog) + ux * along, y, z + pz * (side * half + jog) + uz * along];
    solid('stone', [c(ax, az, -1, y0a), c(bx, bz, -1, y0b), c(bx, bz, 1, y0b), c(ax, az, 1, y0a), c(ax, az, -1, y0a + h + tip, lean), c(bx, bz, -1, y0b + h - tip, lean), c(bx, bz, 1, y0b + h - tip, lean), c(ax, az, 1, y0a + h + tip, lean)], colour, 0.6);
  };
  for (let k = 0; k + 1 < w.line.length; k++) {
    if (inRuns(k, w.gaps)) continue;
    const [ax, az] = w.line[k], [bx, bz] = w.line[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const fallen = inRuns(k, w.fallen), height = w.height * (fallen ? rng.range(0.35, 0.6) : 1), courses = Math.max(2, Math.round(height / COURSE));
    for (let c = 0; c < courses; c++) {
      const t = c / courses, half = (FOOT + (TOP - FOOT) * t) / 2, h = height / courses;
      // Stones of uneven length along the course, the joints of one course not over those of the next.
      for (let f = c % 2 ? -rng.range(0.1, 0.3) : 0; f < len;) {
        const f0 = Math.max(0, f), f1 = Math.min(len, f + rng.range(0.32, 0.72));
        const x0 = ax + ((bx - ax) * f0) / len, z0 = az + ((bz - az) * f0) / len, x1 = ax + ((bx - ax) * f1) / len, z1 = az + ((bz - az) * f1) / len;
        const g0 = ground(x0, z0), g1 = ground(x1, z1), base = Math.min(g0, g1) - 0.12 + c * h;
        if (f1 - f0 > 0.08) block(x0, z0, x1, z1, base + (g0 - Math.min(g0, g1)) * (1 - t), base + (g1 - Math.min(g0, g1)) * (1 - t), h * rng.range(0.8, 1.15), half * rng.range(0.9, 1.08), rng.range(-0.06, 0.06), tone(), 0, rng.range(-0.04, 0.04));
        f = f1 + 0.015;
      }
    }
    // The coping: stones set on edge across the top, close together.
    const top = (x: number, z: number) => Math.min(ground(x, z), ground(ax, az), ground(bx, bz)) - 0.12 + height;
    // (Close-set, shoulder to shoulder, of all heights and leaning this way and that: set apart, they read as battlements.)
    if (!fallen) for (let f = 0; f + 0.1 < len; f += rng.range(0.11, 0.17)) {
      const x0 = ax + ((bx - ax) * f) / len, z0 = az + ((bz - az) * f) / len, f1 = f + rng.range(0.1, 0.16), x1 = ax + ((bx - ax) * f1) / len, z1 = az + ((bz - az) * f1) / len;
      const y = top(x0, z0) - 0.04;
      block(x0, z0, x1, z1, y, y, rng.range(0.14, 0.32), TOP / 2 * rng.range(0.8, 1.05), rng.range(-0.05, 0.05), tone(), rng.range(-0.07, 0.07), rng.range(-0.05, 0.05));
    } else {
      // What fell: stones lying along the foot, on both sides.
      for (let s = 0; s < 3; s++) {
        const f = rng.range(0, len), side = rng.chance(0.5) ? 1 : -1, out = rng.range(0.55, 1.4), x = ax + ((bx - ax) * f) / len - ((bz - az) / len) * side * out, z = az + ((bz - az) * f) / len + ((bx - ax) / len) * side * out;
        const a = rng.range(0, Math.PI), r = rng.range(0.15, 0.28), y = ground(x, z) - 0.06;
        block(x - Math.cos(a) * r, z - Math.sin(a) * r, x + Math.cos(a) * r, z + Math.sin(a) * r, y, y, rng.range(0.14, 0.24), rng.range(0.14, 0.22), 0, tone());
      }
    }
  }
  // Gateposts: a tall stone either side of each gateway.
  for (const [a, b] of w.gaps) for (const k of [a, b]) {
    if (k <= 0 || k >= w.line.length - 1) continue;
    const [x, z] = w.line[k], [nx, nz] = w.line[k === a ? k - 1 : k + 1], l = Math.hypot(nx - x, nz - z) || 1, ux = (nx - x) / l, uz = (nz - z) / l, y = ground(x, z) - 0.15;
    block(x, z, x + ux * 0.4, z + uz * 0.4, y, y, w.height + 0.35, 0.3, 0, tone());
  }
}
