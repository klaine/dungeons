import { cells3, facets3, fbm2, fbm3, hash1, Rng, valueNoise2 } from '../../core/rng';
import { Stone } from '../../core/site';
import { Density, smax } from './rock';

/**
 * The shapes rock takes. A cliff is a slope of ground broken by three things: beds of harder and
 * softer stone, joints that split the beds into blocks, and weather, which rounds what stands
 * proud and brings down what is loose. A boulder is a block that came away, with the same beds
 * and joints in it. Everything here is a function of position, so any piece of rock can be carved
 * from it at any fineness and neighbouring pieces agree where they meet.
 */

/** What a kind of stone is like in the mass. */
export interface RockCharacter {
  /** Thickness of a bed, in metres. */
  bed: number;
  /** Spacing of the upright joints, in metres. */
  joint: number;
  /** How far whole blocks stand proud of the face or have dropped out of it, 0 to 1. */
  blocky: number;
  /** How far weather has rounded the edges, 0 to 1. */
  round: number;
  /** How much one bed differs from the next in hardness and colour, 0 to 1. */
  bedded: number;
  /** How tall a block is, in beds: 1 for stone that splits along every bed, more for columns. */
  column: number;
  /** How far it breaks in flat faces with sharp edges, 0 to 1: the opposite of weathering smooth. */
  sharp: number;
  /** The tint of a pale bed and of a dark one, as multiples of the stone's own colour. */
  pale: [number, number, number];
  dark: [number, number, number];
}

export const ROCK: Record<Stone, RockCharacter> = {
  // Thick level beds split by upright joints into blocks: steps, ledges and square-cut faces.
  limestone: { bed: 0.95, joint: 1.9, blocky: 0.9, round: 0.3, bedded: 0.75, column: 1, sharp: 0.6, pale: [1.12, 1.1, 1.02], dark: [0.8, 0.8, 0.82] },
  // Thin beds of very different hardness, worn round: shelves and hollows in bands of colour.
  sandstone: { bed: 0.6, joint: 2.8, blocky: 0.5, round: 0.8, bedded: 1, column: 2, sharp: 0.3, pale: [1.15, 1.02, 0.84], dark: [0.86, 0.6, 0.46] },
  // Massive: few beds, wide joints, and a face broken into flat planes with sharp edges, great and small.
  greystone: { bed: 2.4, joint: 2.6, blocky: 0.75, round: 0.3, bedded: 0.3, column: 1, sharp: 1, pale: [1.08, 1.08, 1.1], dark: [0.74, 0.76, 0.82] },
  // Columns: close upright joints and hardly a bed to be seen.
  basalt: { bed: 3.2, joint: 0.85, blocky: 1, round: 0.1, bedded: 0.2, column: 1.4, sharp: 0.9, pale: [1.05, 1.04, 1.06], dark: [0.72, 0.72, 0.78] },
};

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

/** The beds of one place: where they lie, and how each stands up to weather. */
export class Strata {
  private dipX: number;
  private dipZ: number;
  readonly seed: number;

  constructor(readonly rock: RockCharacter, q: Rng, readonly datum: number) {
    this.dipX = q.range(-0.08, 0.08);
    this.dipZ = q.range(-0.05, 0.05);
    this.seed = q.int(1, 9999);
  }

  /** Where a point lies among the beds: whole numbers are the planes between them. Beds dip a little and roll. */
  at(x: number, y: number, z: number): number {
    return (y - this.datum + this.dipX * x + this.dipZ * z + (fbm2(x * 0.021 + this.seed, z * 0.021, 2) - 0.5) * 1.8) / this.rock.bed;
  }

  /**
   * How well bed `i` stands up to weather, 0 to 1. Beds come in runs: a few hard ones together
   * make a face, a few soft ones a ledge.
   */
  hardness(i: number): number {
    const run = valueNoise2((i * this.rock.bed) / 2.6 + 0.37, this.seed * 0.61, this.seed);
    const own = hash1(i, this.seed);
    // Most stone is sound. About a quarter of the height of a cliff is in beds that crumble.
    const h = smooth((0.5 + (run - 0.5) * 2.4 + (own - 0.5) * 0.5 - 0.1) / 0.28);
    return 1 - this.rock.bedded * (1 - h);
  }

  /** Bed `i`'s place between the stone's dark and pale tints, 0 to 1. */
  shade(i: number): number {
    return clamp01(0.5 + (hash1(i, this.seed + 7) - 0.5) * (0.5 + 0.9 * this.rock.bedded));
  }
}

/**
 * How far the face of a cliff stands out from the plain slope at a point, in metres: negative
 * where it is cut back. Laid over the slope, this is what makes it rock. It comes in two parts,
 * the broad forms and the fine, to be added together.
 */
export function cliffRelief(strata: Strata, seed: number): { broad: Density; fine: Density } {
  const c = strata.rock;
  const cell = new Float32Array(5);
  // A block that has dropped out leaves a hole; the rest stand a little in or out.
  const offset = (h: number) => (h < 0.07 ? -0.6 : (h - 0.54) * 1.0);
  const blend = Math.min(0.45, 0.17 / c.bed);
  const wall = 0.08 + 0.3 * c.round;
  const metres = Math.min(c.joint, c.bed * c.column);
  // Buttresses and gullies: broad forms that run up the face, and lumps a few paces across. In
  // stone that weathers round these are swellings; in stone that breaks sharp they are great
  // flat faces, taller than wide, as joints run, meeting in edges.
  const broad: Density = (x, y, z) => {
    const worn = (fbm3(x * 0.1, y * 0.028, z * 0.1, 3, seed) - 0.5) * 2.8 + (fbm3(x * 0.34, y * 0.34, z * 0.34, 2, seed + 5) - 0.5) * 0.9;
    if (c.sharp <= 0) return worn;
    return worn * (1 - 0.3 * c.sharp) + (facets3(x / 2.6 + 7.1, y / 4.2, z / 2.6, seed + 17) - 0.3) * 2.6 * c.sharp;
  };
  const fine: Density = (x, y, z) => {
    let r = 0;
    // Beds: soft ones are cut back under hard ones. The change is eased over a hand's breadth.
    const u = strata.at(x, y, z), i = Math.floor(u), t = u - i;
    let hard = strata.hardness(i);
    if (t < blend) hard += (strata.hardness(i - 1) - hard) * 0.5 * (1 - t / blend);
    else if (t > 1 - blend) hard += (strata.hardness(i + 1) - hard) * 0.5 * (1 - (1 - t) / blend);
    r -= (1 - hard) * 0.8;
    // And every bed stands a little in front of or behind the one below, so the face goes up in steps.
    r += (hash1(i, strata.seed + 31) - 0.5) * 0.3;
    // Joints: the beds split into blocks, each standing a little differently, with the joints
    // between them opened by frost. Blocks lie in their beds, so the cells are kept in layers.
    cells3(x / c.joint + seed, u / c.column, z / c.joint, seed + 11, 0.6, cell, 0.15);
    const edge = cell[4] * metres;
    const a = offset(cell[2]), b = offset(cell[3]);
    r += (a + (b - a) * 0.5 * (1 - smooth(edge / wall))) * c.blocky;
    r -= (1 - smooth(edge / 0.14)) * 0.16;
    // And a little plain roughness. The smaller breaks are left to the rock's texture, which can hold an edge.
    r += (fbm3(x * 2.3, y * 2.3, z * 2.3, 2, seed + 23) - 0.5) * 0.14;
    return r;
  };
  return { broad, fine };
}

/** A lump of rock, as a function that is negative inside it, about its own middle; and how far it reaches. */
export interface RockForm {
  density: Density;
  /** Nothing of it lies further than this from its middle, sideways; nor further than `rise` above or `sink` below. */
  reach: number;
  rise: number;
  sink: number;
  /** Half its thickness, for setting it on the ground. */
  half: number;
  /** Where a point of it lies between the stone's dark beds and its pale ones, 0 to 1. */
  bedShade?: (x: number, y: number, z: number) => number;
}

/** Turns about an upright axis by `yaw`, then leans by `tilt` towards the direction `lean`. Returned as nine numbers, row by row. */
function turning(yaw: number, tilt: number, lean: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), ax = Math.cos(lean), az = Math.sin(lean);
  // Rodrigues' formula about the level axis (ax, 0, az), applied after the turn about the upright.
  const k = 1 - ct;
  const t = [ct + ax * ax * k, -az * st, ax * az * k, az * st, ct, -ax * st, az * ax * k, ax * st, ct + az * az * k];
  const y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const m: number[] = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) m.push(t[r * 3] * y[col] + t[r * 3 + 1] * y[3 + col] + t[r * 3 + 2] * y[6 + col]);
  return m;
}

/**
 * A boulder: a block bounded by flat faces, as rock that has split along beds and joints is, with
 * a crack or two, the beds showing on its sides, its corners knocked off and its skin weathered.
 * `size` is roughly half its width.
 */
export function boulderForm(q: Rng, size: number, c: RockCharacter): RockForm {
  // It lies as it fell: turned any way, and tipped, the more so the less it is a slab.
  const m = turning(q.range(0, Math.PI * 2), q.range(0, 0.55) * q.next(), q.range(0, Math.PI * 2));
  // A block is as thick as a bed or two, so large ones are slabs and small ones are cubes.
  const flat = Math.min(0.9, Math.max(0.36, (c.bed * q.range(0.8, 1.9)) / (size * 2))) * q.range(0.85, 1.1);
  const wide = q.range(0.85, 1.25), deep = q.range(0.62, 0.95);
  const planes: number[] = [0, 1, 0, flat * size, 0, -1, 0, flat * size];
  const sides = 4 + q.int(0, 3), start = q.range(0, Math.PI * 2);
  for (let k = 0; k < sides; k++) {
    const a = start + ((k + q.range(-0.3, 0.3)) / sides) * Math.PI * 2;
    const nx = Math.cos(a), nz = Math.sin(a), ny = q.range(-0.28, 0.28), l = Math.hypot(nx, ny, nz);
    planes.push(nx / l, ny / l, nz / l, size * Math.hypot(nx * wide, nz * deep) * q.range(0.74, 1));
  }
  // Corners that have come away.
  for (let k = q.int(1, 3); k > 0; k--) {
    const nx = q.range(-1, 1), ny = q.range(-0.2, 1), nz = q.range(-1, 1), l = Math.hypot(nx, ny, nz) || 1;
    planes.push(nx / l, ny / l, nz / l, size * q.range(0.72, 0.98) * Math.hypot((nx / l) * wide, (ny / l) * flat * 1.4, (nz / l) * deep));
  }
  const round = size * (0.03 + 0.24 * c.round);
  // A crack right through it, on which the two parts have opened a little.
  const cracked = q.chance(0.45);
  const ca = q.range(0, Math.PI * 2), cnx = Math.cos(ca), cnz = Math.sin(ca), cny = q.range(-0.3, 0.3), cOff = q.range(-0.3, 0.3) * size;
  const seed = q.int(1, 99999), phase = q.range(0, 10);
  const bed = Math.min(c.bed * 0.5, size * 0.45);
  const far = size * 0.4;
  const density: Density = (x, y, z) => {
    const bx = m[0] * x + m[1] * y + m[2] * z, by = m[3] * x + m[4] * y + m[5] * z, bz = m[6] * x + m[7] * y + m[8] * z;
    let d = planes[1] * by - planes[3];
    for (let k = 4; k < planes.length; k += 4) d = smax(d, planes[k] * bx + planes[k + 1] * by + planes[k + 2] * bz - planes[k + 3], round);
    // Well clear of the surface, nothing below can change the answer's sign.
    if (d > far || d < -far) return d;
    const plain = d;
    if (cracked) {
      const cd = (cnx * bx + cny * by + cnz * bz - cOff) / Math.max(0.05, size * 0.05);
      d += size * 0.13 * Math.exp(-cd * cd);
    }
    // The beds it was made of show as grooves round it.
    const u = by / bed + phase, i = Math.floor(u), t = u - i;
    d += (1 - hash1(i, seed)) * c.bedded * size * 0.09 * smooth(Math.min(t, 1 - t) / 0.25) + (1 - smooth(Math.min(t, 1 - t) / 0.12)) * c.bedded * 0.04;
    // Faces where it has broken, lumps and hollows where it has weathered, then the grain of the surface.
    d -= (facets3(bx / (size * 0.7) + phase, by / (size * 0.7), bz / (size * 0.7), seed + 5) - 0.3) * size * 0.42 * c.sharp;
    d -= (fbm3(bx * 0.9 + phase, by * 0.9, bz * 0.9, 3, seed) - 0.5) * size * 0.24 * (1 - 0.6 * c.sharp);
    d -= (fbm3(bx * 4.1, by * 4.1, bz * 4.1, 2, seed + 3) - 0.5) * 0.05;
    // Never as far from the plain block as `far`, which is what lets the work above be skipped beyond it.
    // (A little less than `far`, or a shell of stone would appear exactly there.)
    return plain + Math.max(-far * 0.8, Math.min(far * 0.8, d - plain));
  };
  const reach = size * Math.max(wide, deep) * 1.5 + 0.15;
  const bedShade = (x: number, y: number, z: number) => hash1(Math.floor((m[3] * x + m[4] * y + m[5] * z) / bed + phase), seed + 9);
  return { density, reach, rise: size * (flat + 0.45) + 0.1, sink: size * (flat + 0.45) + 0.1, half: flat * size, bedShade };
}

/**
 * A stone set on end by people: a tall slab, thicker at the foot, with a broken top, fluted by
 * centuries of rain. `along` and `across` are half its width and half its thickness; it stands
 * `tall` above its middle and as far below. Lying down, `tall` runs along the ground instead.
 */
export function monolithForm(q: Rng, tall: number, along: number, across: number, c: RockCharacter, lying: boolean): RockForm {
  const seed = q.int(1, 99999), phase = q.range(0, 10);
  const lean = q.range(-0.07, 0.07), lean2 = q.range(-0.05, 0.05);
  // Two sloping faces make the top; where they meet is off to one side.
  const t1 = q.range(0.25, 0.7), t2 = q.range(0.1, 0.45);
  const round = across * (0.25 + 0.5 * c.round);
  const density: Density = (x, y, z) => {
    // In the stone's own terms: l along its length, a across its width, b through its thickness.
    const l = lying ? x : y, a = lying ? z : x + lean * y, b = lying ? y : z + lean2 * y;
    const taper = 1 - 0.16 * (l / tall);
    let d = smax(Math.abs(a) - along * taper, Math.abs(b) - across * taper, round);
    d = smax(d, (l + t1 * a - tall * 0.92) * 0.9, round);
    d = smax(d, (l - t2 * a * 1.4 - tall) * 0.9, round);
    d = smax(d, -l - tall, round);
    if (d > 0.4 || d < -0.4) return d;
    // Flutes running down it, lumps, and grain.
    d -= (fbm3(a * 2.6 + phase, l * 0.35, b * 2.6, 2, seed) - 0.5) * 0.2;
    d -= (fbm3(a * 0.9, l * 0.9 + phase, b * 0.9, 3, seed + 2) - 0.5) * 0.22;
    d -= (fbm3(x * 4.5, y * 4.5, z * 4.5, 2, seed + 4) - 0.5) * 0.05;
    return d;
  };
  const reach = (lying ? tall : Math.max(along, across)) * 1.15 + 0.35;
  return { density, reach, rise: (lying ? across : tall) + 0.35, sink: (lying ? across : tall) + 0.35, half: lying ? across : tall };
}

/** Numbers on a square lattice over the ground, read between its points by straight-line blending. */
export class Grid2 {
  readonly data: Float32Array;
  constructor(readonly x0: number, readonly z0: number, readonly cell: number, readonly nx: number, readonly nz: number) {
    this.data = new Float32Array(nx * nz);
  }
  like(): Grid2 {
    return new Grid2(this.x0, this.z0, this.cell, this.nx, this.nz);
  }
  fill(f: (x: number, z: number) => number): this {
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.data[j * this.nx + i] = f(this.x0 + i * this.cell, this.z0 + j * this.cell);
    return this;
  }
  /** Whether the point lies over the lattice at all. */
  holds(x: number, z: number): boolean {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + (this.nx - 1) * this.cell && z <= this.z0 + (this.nz - 1) * this.cell;
  }
  at(x: number, z: number): number {
    const fx = Math.min(this.nx - 1.0001, Math.max(0, (x - this.x0) / this.cell)), fz = Math.min(this.nz - 1.0001, Math.max(0, (z - this.z0) / this.cell));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * this.nx + i, d = this.data;
    return d[o] + (d[o + 1] - d[o]) * tx + (d[o + this.nx] - d[o] + (d[o] - d[o + 1] - d[o + this.nx] + d[o + this.nx + 1]) * tx) * tz;
  }
}

export interface ErosionOptions {
  /** Height of solid rock at each point; changed in place. */
  rock: Grid2;
  /** Depth of fallen material lying on the rock; filled in. */
  loose: Grid2;
  /** Where anything may move at all: nothing is taken from or dropped on points where this is 0. */
  active: Uint8Array;
  /** The steepest slope rock at height `y` over point `i` will hold, as rise over run. */
  holds: (i: number, y: number) => number;
  /** The steepest slope loose material will lie at. */
  repose: number;
  /** The share of what falls that stays as debris; the rest is taken to have weathered away. */
  kept: number;
  passes: number;
}

/**
 * Wears a landscape down the way frost and gravity do. Wherever rock stands steeper than it can
 * hold, some comes away and lands on the lowest ground beside it; wherever that debris lies
 * steeper than it can, it slides on. Soft beds retreat into ledges, hard ones are left standing
 * as faces, and scree gathers at the foot. Returns how much was moved in the last pass.
 */
export function erode(o: ErosionOptions): number {
  const { rock, loose, active } = o;
  const nx = rock.nx, nz = rock.nz, R = rock.data, L = loose.data, cell = rock.cell;
  const step = [-nx - 1, -nx, -nx + 1, -1, 1, nx - 1, nx, nx + 1];
  const run = [1.4142, 1, 1.4142, 1, 1, 1.4142, 1, 1.4142].map((d) => d * cell);
  let moved = 0;
  for (let pass = 0; pass < o.passes; pass++) {
    moved = 0;
    // Sweeping in the same direction every time would drag material that way; so turn about.
    const back = (pass & 1) === 1;
    for (let jj = 1; jj < nz - 1; jj++) for (let ii = 1; ii < nx - 1; ii++) {
      const i = back ? (nz - 1 - jj) * nx + (nx - 1 - ii) : jj * nx + ii;
      if (!active[i]) continue;
      const h = R[i] + L[i];
      let best = -1, steepest = 0;
      for (let k = 0; k < 8; k++) {
        const j = i + step[k];
        if (!active[j]) continue;
        const s = (h - R[j] - L[j]) / run[k];
        if (s > steepest) { steepest = s; best = k; }
      }
      if (best < 0) continue;
      const j = i + step[best];
      if (L[i] > 1e-3) {
        if (steepest <= o.repose) continue;
        const amount = Math.min(L[i], 0.5 * (steepest - o.repose) * run[best]);
        L[i] -= amount; L[j] += amount; moved += amount;
      } else {
        const limit = o.holds(i, R[i]);
        if (steepest <= limit) continue;
        // A fall takes at most a block's depth at a time, so that a bed is tested again as it is cut into.
        const amount = Math.min(0.3, 0.5 * (steepest - limit) * run[best]);
        R[i] -= amount; L[j] += amount * o.kept; moved += amount;
      }
    }
  }
  return moved;
}
