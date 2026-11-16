import { fbm2, valueNoise2 } from '../core/rng';
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
  /** The colour of turf at a point, and of rock given a tone; defaults are plain grass and the tinted stone. */
  colour?: (x: number, z: number) => [number, number, number];
  rock?: (tone: number) => [number, number, number];
  /** How level a triangle must be to hold turf, as the upward part of its normal; steeper is rock. */
  bare?: number;
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
      // Only what is really steep is bare: a hillside of forty degrees holds turf.
      const steep = fy / fl < (o.bare ?? 0.74);
      const mesh = steep ? rock : turf;
      const ids: number[] = [];
      for (const q of [A, B, C]) {
        if (steep) {
          const bed = fbm2((q.y + q.x * 0.2) * 0.9, q.z * 0.12 + o.seed, 3);
          const tone = 0.6 + 0.45 * bed;
          const alongX = Math.abs(fx) > Math.abs(fz);
          const c = o.rock ? o.rock(tone) : [0.8 * tone * o.stone[0], 0.74 * tone * o.stone[1], 0.65 * tone * o.stone[2]];
          ids.push(mesh.addVertex(q.x, q.y, q.z, q.nx, q.ny, q.nz, (alongX ? q.z : q.x) * o.rockScale, q.y * o.rockScale, c[0], c[1], c[2], Math.max(0, q.ny) * 0.9, 0, 0, 1));
        } else {
          const [r, g, b] = o.colour ? o.colour(q.x, q.z) : turfColour(q.x, q.z, o.seed);
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
 * sheet in polar coordinates over a height function.
 *
 * The heights are ridged noise, summed the way water would have it: each finer layer counts for
 * less where the layers before it are already steep. That leaves sharp crests with long smooth
 * flanks below them and gullies between, which is what running water makes of a mountain, where
 * plain noise gives lumps. What covers the ground is then decided by its height and slope:
 * forest low down and in the gullies, pasture above it, bare rock in bands where it is steep,
 * scree below the faces, and snow on what is high and not too steep to hold it.
 */
export function layMountains(rock: MeshBuilder, cx: number, cz: number, base: number, seed: number, stone: [number, number, number] = [1, 1, 1]): void {
  const around = 560;
  const radii: number[] = [];
  for (let r = 215; r <= 800; r += 5.5 + (r - 215) * 0.022) radii.push(r);
  const rings = radii.length;
  const ridge = (x: number, z: number, s: number) => { const v = 1 - Math.abs(valueNoise2(x, z, s) * 2 - 1); return v * v; };
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x - cx, z - cz), a = Math.atan2(z - cz, x - cx);
    // The range is not a circle: it stands nearer in some quarters than others, and is higher in some.
    const crest = 470 + 70 * Math.sin(a * 2 + seed) + 45 * Math.sin(a * 5 + seed * 1.7);
    const swell = Math.exp(-(((r - crest) / (r < crest ? 150 : 230)) ** 2));
    const massif = 0.4 + 1.1 * fbm2(x * 0.0022 + seed, z * 0.0022 - seed, 2);
    let sum = 0, amp = 0.55, fx = x * 0.0034 + seed, fz = z * 0.0034 - seed * 0.7, sx = 0, sz = 0;
    // No layer is finer than the sheet can draw here: one that was would come out as needles.
    // The sheet is coarser the further off it is, so the far side of the range is plainer.
    const spacing = Math.max(5.5 + (r - 215) * 0.022, (Math.PI * 2 * r) / around);
    let wave = 1 / 0.0034;
    for (let o = 0; o < 6; o++) {
      const drawn = Math.min(1, Math.max(0, (wave / spacing - 4.5) / 4.5));
      wave /= 2.03;
      if (drawn <= 0) break;
      amp *= drawn;
      const e = 0.02, v = ridge(fx, fz, seed + o * 13);
      // How steep this layer is here, added to the steepness of those before it.
      sx += (ridge(fx + e, fz, seed + o * 13) - v) / e * amp;
      sz += (ridge(fx, fz + e, seed + o * 13) - v) / e * amp;
      sum += (amp * v) / (1 + 0.9 * (sx * sx + sz * sz));
      amp *= 0.5;
      // Each layer is turned as well as shrunk, so that none lines up with the last.
      const nx = (fx * 0.8 - fz * 0.6) * 2.03, nz = (fx * 0.6 + fz * 0.8) * 2.03;
      fx = nx; fz = nz;
    }
    return base - 6 + swell * massif * (26 + 215 * sum);
  };
  const H = new Float32Array(rings * around), X = new Float32Array(rings * around), Z = new Float32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const a = (k / around) * Math.PI * 2, o = ri * around + k;
    X[o] = cx + Math.cos(a) * radii[ri]; Z[o] = cz + Math.sin(a) * radii[ri];
    H[o] = height(X[o], Z[o]);
  }
  const at = (ri: number, k: number) => Math.min(rings - 1, Math.max(0, ri)) * around + ((k + around) % around);
  // Any point still standing far above all four of its neighbours is a spike, not a summit, and is brought down.
  for (let pass = 0; pass < 3; pass++) {
    const was = H.slice();
    for (let ri = 1; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
      const o = ri * around + k;
      const top = Math.max(was[at(ri, k + 1)], was[at(ri, k - 1)], was[at(ri + 1, k)], was[at(ri - 1, k)]);
      const span = Math.hypot(X[at(ri, k + 1)] - X[o], Z[at(ri, k + 1)] - Z[o]) + (radii[ri + 1] - radii[ri]);
      if (was[o] > top + span * 0.2) H[o] = top + span * 0.2;
    }
  }
  const ids = new Int32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const o = ri * around + k, x = X[o], y = H[o], z = Z[o];
    // The slope, from the heights either side along the ring and across it.
    const e = at(ri, k + 1), w = at(ri, k - 1), n = at(ri + 1, k), s = at(ri - 1, k);
    const ax = X[e] - X[w], ay = H[e] - H[w], az = Z[e] - Z[w], bx = X[n] - X[s], by = H[n] - H[s], bz = Z[n] - Z[s];
    let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // Whether the ground here is a hollow or a crest, from how it stands against its neighbours.
    const span = Math.hypot(ax, az) * 0.5 + Math.hypot(bx, bz) * 0.5;
    const hollow = Math.min(1, Math.max(-1, (((H[e] + H[w] + H[n] + H[s]) / 4 - y) / span) * 9));
    const h = (y - base) / 190, steep = Math.min(1, Math.max(0, (0.8 - ny) / 0.3));
    const patch = fbm2(x * 0.011 + seed, z * 0.011, 3), fine = fbm2(x * 0.05, z * 0.05 + seed, 2);
    // Rock: in beds some metres thick, each its own shade, darker where it is steep and in hollows.
    const bed = hash01(Math.floor((y + x * 0.06 + patch * 30) / 9), seed);
    const tone = (0.5 + 0.28 * bed + 0.22 * patch) * (1 - 0.3 * steep) * (1 - 0.28 * Math.max(0, hollow));
    let r = 0.37 * tone * (0.6 + 0.4 * stone[0]), g = 0.37 * tone * (0.6 + 0.4 * stone[1]), b = 0.4 * tone * (0.6 + 0.4 * stone[2]);
    const lay = (cr: number, cg: number, cb: number, w: number) => { r += (cr - r) * w; g += (cg - g) * w; b += (cb - b) * w; };
    const sm = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
    // Scree: pale and even, on slopes below the faces that are neither steep nor level.
    lay(0.33, 0.32, 0.31, 0.6 * sm((h - 0.3) / 0.2) * (1 - steep) * sm((0.93 - ny) / 0.1));
    // Pasture above the trees, on what is not too steep.
    lay(0.16, 0.2, 0.08, sm((0.62 - h + 0.15 * (patch - 0.5)) / 0.12) * (1 - steep) * 0.85);
    // Forest low down, reaching higher up the gullies than on the spurs between them.
    lay(0.06 + 0.03 * fine, 0.13 + 0.05 * fine, 0.06, sm((0.36 - h + 0.12 * hollow + 0.2 * (patch - 0.5)) / 0.08) * (1 - 0.8 * steep));
    // Snow on what is high, lying deeper in hollows and blown off what is steep.
    const snow = sm((h - 0.6 + 0.12 * hollow + 0.1 * (patch - 0.5)) / 0.1) * sm((ny - 0.5) / 0.22);
    lay(1.3, 1.34, 1.42, snow);
    ids[o] = rock.addVertex(x, y, z, nx, ny, nz, x * 0.012, z * 0.012, r, g, b);
  }
  // The near edge of the sheet is turned down into the ground, so that from the air nobody sees
  // under the foot of the mountains to the sky beyond.
  const hem: number[] = [];
  for (let k = 0; k < around; k++) hem.push(rock.addVertex(X[k] + (cx - X[k]) * 0.06, H[k] - 55, Z[k] + (cz - Z[k]) * 0.06, (cx - X[k]) / radii[0], 0.2, (cz - Z[k]) / radii[0], 0, 0, 0.05, 0.1, 0.05));
  for (let k = 0; k < around; k++) {
    const k1 = (k + 1) % around;
    // The hem faces the middle of the ring.
    rock.addTriangle(hem[k], hem[k1], ids[k1]);
    rock.addTriangle(hem[k], ids[k1], ids[k]);
  }
  for (let ri = 0; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
    const a = ids[at(ri, k)], b = ids[at(ri, k + 1)], c = ids[at(ri + 1, k + 1)], d = ids[at(ri + 1, k)];
    // The sheet faces up. (It was long wound the other way, and so drawn inside out: every slope
    // turned towards the eye was thrown away, and only the far sides of ridges were seen.)
    rock.addTriangle(a, b, c);
    rock.addTriangle(a, c, d);
  }
}

function hash01(i: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(Math.floor(seed * 977), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
