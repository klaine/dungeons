import { fbm2 } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';

/**
 * The land beyond where the player can walk: ground running out from the approach into wooded
 * hills, and a ring of mountains behind them. None of it is baked or collided with. It is there
 * to be looked at, so it is built coarsely and lit by the sun and a fixed share of sky.
 */

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export type HeightFn = (x: number, z: number) => number;

export interface TerrainOptions {
  area: Rect;
  cell: number;
  /** Cells for which this is true are left out. */
  skip: (cell: Rect) => boolean;
  /** Moves a corner before it is placed: used to draw the sheet's edge up to a boundary. */
  warp?: (x: number, z: number) => [number, number];
  seed: number;
  /** Tint of bare rock. */
  stone: [number, number, number];
  /** Texture repeats per metre, for turf and for rock. */
  turfScale: number;
  rockScale: number;
}

/**
 * Lays a sheet of ground over a height function. Each cell is two triangles; a triangle goes to
 * the turf mesh if it is nearly level and to the rock mesh if it is steep. Normals come from the
 * slope of the function, so the sheet shades smoothly however coarse it is.
 */
export function layTerrain(turf: MeshBuilder, rock: MeshBuilder, height: HeightFn, o: TerrainOptions): number {
  const { area, cell } = o;
  const nx = Math.round((area.x1 - area.x0) / cell), nz = Math.round((area.z1 - area.z0) / cell);
  let triangles = 0;
  const e = Math.min(1, cell * 0.5);
  const P = [0, 0, 0, 0].map(() => ({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }));
  const corner = (k: number, x: number, z: number) => {
    const q = P[k];
    if (o.warp) [x, z] = o.warp(x, z);
    q.x = x; q.z = z;
    q.y = height(x, z);
    const dx = height(x + e, z) - height(x - e, z), dz = height(x, z + e) - height(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    q.nx = -dx / l; q.ny = (2 * e) / l; q.nz = -dz / l;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = area.x0 + i * cell, z0 = area.z0 + j * cell;
    if (o.skip({ x0, x1: x0 + cell, z0, z1: z0 + cell })) continue;
    corner(0, x0, z0); corner(1, x0 + cell, z0); corner(2, x0 + cell, z0 + cell); corner(3, x0, z0 + cell);
    // Split along the diagonal that makes the flatter pair, which keeps ridges from saw-toothing.
    const split = Math.abs(P[0].y - P[2].y) < Math.abs(P[1].y - P[3].y) ? [[0, 3, 2], [0, 2, 1]] : [[0, 3, 1], [1, 3, 2]];
    for (const [a, b, c] of split) {
      const A = P[a], B = P[b], C = P[c];
      const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-6) continue;
      const steep = fy / fl < 0.74;
      const mesh = steep ? rock : turf;
      const ids: number[] = [];
      for (const q of [A, B, C]) {
        if (steep) {
          const bed = fbm2((q.y + q.x * 0.2) * 0.9, q.z * 0.12 + o.seed, 3);
          const tone = 0.6 + 0.45 * bed;
          const alongX = Math.abs(fx) > Math.abs(fz);
          ids.push(mesh.addVertex(q.x, q.y, q.z, q.nx, q.ny, q.nz, (alongX ? q.z : q.x) * o.rockScale, q.y * o.rockScale,
            0.8 * tone * o.stone[0], 0.74 * tone * o.stone[1], 0.65 * tone * o.stone[2], Math.max(0, q.ny) * 0.9, 0, 0, 0));
        } else {
          const [r, g, b] = turfColour(q.x, q.z, o.seed);
          ids.push(mesh.addVertex(q.x, q.y, q.z, q.nx, q.ny, q.nz, q.x * o.turfScale, q.z * o.turfScale, r, g, b));
        }
      }
      mesh.addTriangle(ids[0], ids[1], ids[2]);
      triangles++;
    }
  }
  return triangles;
}

/** The colour of grass at a point: patchy, with drier and lusher stretches. */
export function turfColour(x: number, z: number, seed: number): [number, number, number] {
  const patch = fbm2(x * 0.5 + seed, z * 0.5 + seed * 1.7, 3);
  const dry = fbm2(x * 0.07 + seed * 0.3, z * 0.07 - seed, 3);
  const t = 0.75 + 0.6 * patch;
  const d = Math.max(0, dry - 0.5) * 1.2;
  return [(0.9 + 0.3 * d) * t, (1.05 + 0.05 * d) * t, (0.68 - 0.12 * d) * t];
}

/**
 * A ring of mountains round the whole scene, far enough off to be seen through haze. Drawn as a
 * sheet in polar coordinates over a height function: a broad swell some four hundred metres out,
 * broken into ridges, wooded at its foot and snowed on its tops.
 */
export function layMountains(rock: MeshBuilder, cx: number, cz: number, base: number, seed: number): void {
  const around = 280;
  const radii: number[] = [];
  for (let r = 215; r <= 760; r += 18 + (r - 215) * 0.04) radii.push(r);
  const ridged = (x: number, z: number, octaves: number) => 1 - Math.abs(fbm2(x, z, octaves, 3) - 0.5) * 2;
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x - cx, z - cz);
    const swell = Math.exp(-(((r - 470) / (r < 470 ? 150 : 210)) ** 2));
    const massif = 0.35 + 1.1 * fbm2(x * 0.0022 + seed, z * 0.0022 - seed, 2);
    const ridge = ridged(x * 0.0045 + seed, z * 0.0045, 4);
    const crag = ridged(x * 0.017 - seed, z * 0.017 + seed, 3);
    return base - 6 + swell * massif * (45 + 105 * ridge * ridge + 26 * crag * ridge);
  };
  const corner = (k: number, r: number) => {
    const a = (k / around) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const y = height(x, z), e = 6;
    const dx = height(x + e, z) - height(x - e, z), dz = height(x, z + e) - height(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    return { x, y, z, nx: -dx / l, ny: (2 * e) / l, nz: -dz / l };
  };
  for (let k = 0; k < around; k++) for (let ri = 0; ri < radii.length - 1; ri++) {
    const q = [corner(k, radii[ri]), corner(k + 1, radii[ri]), corner(k + 1, radii[ri + 1]), corner(k, radii[ri + 1])];
    const ids = q.map((p) => {
      // Wooded low down, bare rock above, and snow on what is highest and least steep.
      const h = (p.y - base) / 170;
      const wood = Math.min(1, Math.max(0, (0.34 - h) * 5 + (fbm2(p.x * 0.01, p.z * 0.01 + seed, 2) - 0.5)));
      const snow = Math.min(1, Math.max(0, (h - 0.62 + 0.5 * (p.ny - 0.7)) * 5));
      const tone = 0.6 + 0.5 * fbm2(p.x * 0.012 + seed, p.z * 0.012 + p.y * 0.02, 3);
      let r = 0.36 * tone, g = 0.38 * tone, b = 0.42 * tone;
      r += (0.1 - r) * wood; g += (0.19 - g) * wood; b += (0.11 - b) * wood;
      r += (1.25 - r) * snow; g += (1.3 - g) * snow; b += (1.4 - b) * snow;
      return rock.addVertex(p.x, p.y, p.z, p.nx, p.ny, p.nz, p.x * 0.012, p.z * 0.012, r, g, b);
    });
    // Seen from inside the ring, the sheet faces inwards and up.
    rock.addTriangle(ids[0], ids[2], ids[1]);
    rock.addTriangle(ids[0], ids[3], ids[2]);
  }
}
