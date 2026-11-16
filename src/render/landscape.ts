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
  /** The colour of turf at a point, and of rock given a tone; defaults are plain grass and the tinted stone. The turf's may be followed by the point's four fields. */
  colour?: (x: number, z: number) => number[];
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
          const c = o.colour ? o.colour(q.x, q.z) : turfColour(q.x, q.z, o.seed);
          ids.push(mesh.addVertex(q.x, q.y, q.z, q.nx, q.ny, q.nz, q.x * o.turfScale, q.z * o.turfScale, c[0], c[1], c[2], c[3] ?? 0, c[4] ?? 0, c[5] ?? 0, c[6] ?? 0));
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
 * plain noise gives lumps. What covers the ground is decided where it is drawn, by the material
 * for far land, from the height and the hollowness recorded here at each point.
 */
export function layMountains(
  rock: MeshBuilder, cx: number, cz: number, base: number, seed: number, stone: [number, number, number] = [1, 1, 1],
  /** Called for each tree that stands on the nearer slopes: where, whether it is a fir, and a number between 0 and 1 of its own. */
  tree?: (x: number, y: number, z: number, fir: boolean, own: number) => void,
): void {
  const around = 560;
  const radii: number[] = [];
  for (let r = 215; r <= 3050; r += 5.5 + (r - 215) * 0.022) radii.push(r);
  const rings = radii.length;
  const ridge = (x: number, z: number, s: number) => { const v = 1 - Math.abs(valueNoise2(x, z, s) * 2 - 1); return v * v; };
  /** Ridges and gullies at a point, between 0 and about 1: `grain` is how many of the broadest to the metre. */
  const relief = (x: number, z: number, grain: number, s: number, spacing: number): number => {
    let sum = 0, amp = 0.55, fx = x * grain + s, fz = z * grain - s * 0.7, sx = 0, sz = 0;
    // No layer is finer than the sheet can draw here: one that was would come out as needles.
    // The sheet is coarser the further off it is, so the far side of a range is plainer.
    let wave = 1 / grain;
    for (let o = 0; o < 6; o++) {
      const drawn = Math.min(1, Math.max(0, (wave / spacing - 4.5) / 4.5));
      wave /= 2.03;
      if (drawn <= 0) break;
      amp *= drawn;
      const e = 0.02, v = ridge(fx, fz, s + o * 13);
      // How steep this layer is here, added to the steepness of those before it.
      sx += (ridge(fx + e, fz, s + o * 13) - v) / e * amp;
      sz += (ridge(fx, fz + e, s + o * 13) - v) / e * amp;
      sum += (amp * v) / (1 + 0.9 * (sx * sx + sz * sz));
      amp *= 0.5;
      // Each layer is turned as well as shrunk, so that none lines up with the last.
      const nx = (fx * 0.8 - fz * 0.6) * 2.03, nz = (fx * 0.6 + fz * 0.8) * 2.03;
      fx = nx; fz = nz;
    }
    return sum;
  };
  /**
   * Three ranges, one behind another, so that looking out there is always a nearer hill in
   * front of a further one: wooded foothills a few hundred metres off, the mountains behind
   * them, and far behind those a range several times as high, which is what goes up into the
   * cloud. Between each two the ground comes down again, and that is where mist lies.
   */
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x - cx, z - cz), a = Math.atan2(z - cz, x - cx);
    const spacing = Math.max(5.5 + (r - 215) * 0.022, (Math.PI * 2 * r) / around);
    let y = base - 6;
    // None of them is a circle: each stands nearer in some quarters than others, and higher in some.
    const footCrest = 292 + 26 * Math.sin(a * 3 + seed * 2.3) + 14 * Math.sin(a * 7 - seed);
    const foot = Math.exp(-(((r - footCrest) / (r < footCrest ? 44 : 40)) ** 2));
    // (Cut by gullies, like the range behind them: a hill with no water running off it is a lump.)
    if (foot > 0.004) y += foot * (8 + 105 * fbm2(x * 0.0055 - seed, z * 0.0055 + seed * 1.3, 3) ** 1.5 * (0.5 + 1.1 * relief(x, z, 0.0085, seed + 7, spacing)));
    const crest = 470 + 70 * Math.sin(a * 2 + seed) + 45 * Math.sin(a * 5 + seed * 1.7);
    const swell = Math.exp(-(((r - crest) / (r < crest ? 95 : 230)) ** 2));
    if (swell > 0.004) y += swell * (0.4 + 1.1 * fbm2(x * 0.0022 + seed, z * 0.0022 - seed, 2)) * (26 + 215 * relief(x, z, 0.0034, seed, spacing));
    const farCrest = 1700 + 260 * Math.sin(a * 2 + seed * 0.6) + 170 * Math.sin(a * 3 - seed * 1.9);
    const far = Math.exp(-(((r - farCrest) / (r < farCrest ? 520 : 800)) ** 2));
    if (far > 0.004) y += far * (0.35 + 1.2 * fbm2(x * 0.0007 - seed, z * 0.0007 + seed, 2)) * (40 + 740 * relief(x, z, 0.0011, seed + 40, spacing));
    return y;
  };
  const H = new Float32Array(rings * around), X = new Float32Array(rings * around), Z = new Float32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const a = (k / around) * Math.PI * 2, o = ri * around + k;
    X[o] = cx + Math.cos(a) * radii[ri]; Z[o] = cz + Math.sin(a) * radii[ri];
    H[o] = height(X[o], Z[o]);
  }
  const at = (ri: number, k: number) => Math.min(rings - 1, Math.max(0, ri)) * around + ((k + around) % around);
  // Rock does not stand in needles. Anything steeper than rock holds for long is worn down to
  // what it holds: a point may stand above its lowest neighbour only so far as the distance
  // between them allows. A tower two points wide goes in a few passes; a broad face is left.
  for (let pass = 0; pass < 10; pass++) {
    const was = H.slice();
    for (let ri = 1; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
      const o = ri * around + k;
      const along = Math.hypot(X[at(ri, k + 1)] - X[o], Z[at(ri, k + 1)] - Z[o]), across = radii[ri + 1] - radii[ri];
      const most = Math.min(Math.min(was[at(ri, k + 1)], was[at(ri, k - 1)]) + along * 1.25, Math.min(was[at(ri + 1, k)], was[at(ri - 1, k)]) + across * 1.25);
      if (was[o] > most) H[o] = most;
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
    // The far range is several times as high, and its woods, pastures and snow lie as much higher.
    const far = Math.min(1, Math.max(0, (radii[ri] - 800) / 500));
    const h = (y - base) / (190 * (1 + 2.3 * far * far * (3 - 2 * far)));
    // The sheet carries the colour of the bare stone and, for whatever draws it, how high this
    // point stands in its range and how much of a hollow it is. What covers the ground is worked
    // out from those where it is drawn, point by point of the picture: see the far material.
    const r = 0.37 * (0.6 + 0.4 * stone[0]), g = 0.37 * (0.6 + 0.4 * stone[1]), b = 0.4 * (0.6 + 0.4 * stone[2]);
    ids[o] = rock.addVertex(x, y, z, nx, ny, nz, x * 0.012, z * 0.012, r, g, b, 0, 0, hollow, h);
  }
  // Trees on the nearer slopes, where a hillside is close enough for its skyline to be seen
  // toothed with them. They stand where the far material paints woods: low down, up the
  // gullies, and not on what is steep. Fewer the further off, since less of each is seen.
  if (tree) {
    const own = (i: number, salt: number) => { let v = Math.imul(i + 1, 374761393) ^ Math.imul(salt + Math.floor(seed * 977), 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
    for (let ri = 0; ri < rings - 1 && radii[ri] < 440; ri++) for (let k = 0; k < around; k++) {
      const a = at(ri, k), b = at(ri, k + 1), c = at(ri + 1, k + 1), d = at(ri + 1, k);
      const area = Math.hypot(X[b] - X[a], Z[b] - Z[a]) * (radii[ri + 1] - radii[ri]);
      const want = area / (22 + (radii[ri] - 240) * 0.22), n = Math.floor(want) + (own(a, 1) < want % 1 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const u = own(a * 7 + j, 2), v = own(a * 7 + j, 3);
        const x = (X[a] * (1 - u) + X[b] * u) * (1 - v) + (X[d] * (1 - u) + X[c] * u) * v, z = (Z[a] * (1 - u) + Z[b] * u) * (1 - v) + (Z[d] * (1 - u) + Z[c] * u) * v;
        const y = (H[a] * (1 - u) + H[b] * u) * (1 - v) + (H[d] * (1 - u) + H[c] * u) * v;
        // How steep the cell is, from its fall across and along.
        const fall = Math.max(Math.abs(H[b] - H[a]) / Math.hypot(X[b] - X[a], Z[b] - Z[a]), Math.abs(H[d] - H[a]) / (radii[ri + 1] - radii[ri]));
        const hollow = Math.min(1, Math.max(-1, (((H[at(ri, k + 2)] + H[at(ri, k - 1)] + H[at(ri + 2, k)] + H[at(ri - 1, k)]) / 4 - y) / (radii[ri + 1] - radii[ri])) * 4));
        const patch = fbm2(x * 0.03 + seed, z * 0.03 - seed, 2) - 0.5;
        const wooded = 0.37 - (y - base) / 190 + 0.13 * hollow + 0.42 * patch;
        if (wooded < 0.02 * own(a * 7 + j, 4) || fall > 0.85) continue;
        tree(x, y, z, fbm2(x * 0.011 + 5, z * 0.011 + 5, 1) + ((y - base) / 190 - 0.2) * 0.5 > 0.5, own(a * 7 + j, 5));
      }
    }
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
