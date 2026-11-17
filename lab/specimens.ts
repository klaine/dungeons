// The things the material lab looks at: a length of cliff, a row of boulders, a patch of ground
// with a cart track, a footpath and a wet hollow in it, a few trees, and what grows low down.
// All of it is made with the game's own carving and planting, and carries what the game's
// geometry carries (colours, the four fields, how much sky each point sees), so that a material
// sees here exactly what it sees in a valley. Only the arrangement is the lab's: everything
// stands apart, in the open, a few strides from everything else.
import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../src/core/rng';
import { Stone } from '../src/core/site';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { carveRock } from '../src/render/geom/rock';
import { boulderForm, cliffRelief, ROCK, Strata } from '../src/render/geom/rockForms';
import { stoneStyles } from '../src/render/geom/styles';
import { turfColour } from '../src/render/landscape';
import { Colour, growConifer, growTree, Planting } from '../src/render/planting';
import { CardSet } from '../src/render/scene';

export type Season = 'spring' | 'summer' | 'autumn';

export interface Stage {
  /** Solid geometry by the name of its material: `rock`, `turf`, `bark`. */
  meshes: Map<string, MeshBuilder>;
  cards: CardSet[];
  ground: (x: number, z: number) => number;
  /** The part of the stage that is looked at closely: shadows are kept over this much. */
  near: { min: Vector3; max: Vector3 };
  /** Where things stand, for pointing the camera at them. */
  spots: Record<string, [number, number, number]>;
  /** How long each part took to make, in milliseconds. */
  times: Record<string, number>;
  counts: Record<string, number>;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

// Where the cliff stands: its face looks south (towards +z), which every hour's sun lights.
const FACE_Z = -22, CLIFF_HALF = 19, CLIFF_TOP = 10.5, CLIFF_BACK = -33;
// The cart track runs north and south on the east side, wandering; the footpath leaves it westward.
const trackX = (z: number) => 17 + Math.sin(z * 0.09) * 1.6 + Math.sin(z * 0.031 + 1) * 2.2;
const FOOT: [number, number][] = [[17, 21], [9, 17], [1, 18.5], [-7, 14], [-14, 15.5], [-23, 11]];
const HOLLOW = { x: 3, z: 6, r: 4.2 };

/** How far a point is from a line through the given points. */
function offLine(line: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], dx = bx - ax, dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function buildStage(o: { stone: Stone; season: Season; seed: string }): Stage {
  const rng = new Rng(`lab/${o.seed}`);
  const s1 = rng.fork('s1').int(1, 999), s2 = rng.fork('s2').int(1, 999);
  const times: Record<string, number> = {}, counts: Record<string, number> = {};
  const timed = <T>(name: string, work: () => T): T => { const t0 = performance.now(); const r = work(); times[name] = performance.now() - t0; return r; };
  const meshes = new Map<string, MeshBuilder>();
  const mesh = (name: string): MeshBuilder => { let m = meshes.get(name); if (!m) meshes.set(name, (m = new MeshBuilder())); return m; };
  const rock = mesh('rock'), turf = mesh('turf'), bark = mesh('bark');

  // ---------------------------------------------------------------- the ground
  // Gently rolling, with a hollow that holds water after rain, and lower along the track.
  const ground = (x: number, z: number): number => {
    const roll = (fbm2(x * 0.035 + s1, z * 0.035 + s2, 3) - 0.5) * 2.2 + (fbm2(x * 0.16 + s2, z * 0.16, 2) - 0.5) * 0.3;
    const dip = -0.55 * (1 - smooth(Math.hypot(x - HOLLOW.x, z - HOLLOW.z) / (HOLLOW.r * 1.5)));
    // Level before the cliff, so that its foot is one line.
    const flat = smooth((z - FACE_Z - 2) / 9);
    return roll * (0.25 + 0.75 * flat) + dip;
  };
  const trees: { x: number; z: number; r: number }[] = [];
  const canopy = (x: number, z: number): number => {
    let c = 0;
    for (const t of trees) c = Math.max(c, 1 - smooth((Math.hypot(x - t.x, z - t.z) - t.r * 0.55) / (t.r * 0.6)));
    return c;
  };
  const wetAt = (x: number, z: number): number => 1 - smooth((Math.hypot(x - HOLLOW.x, z - HOLLOW.z) - HOLLOW.r * 0.45) / (HOLLOW.r * 0.5));
  const trackOff = (x: number, z: number): number => (z > -12 ? x - trackX(z) : 99);
  const footOff = (x: number, z: number): number => offLine(FOOT, x, z);

  // ---------------------------------------------------------------- the cliff and the boulders
  const kind = ROCK[o.stone];
  const stoneTint = stoneStyles(o.stone).tint;
  // (As in the valley: weathered rock in the open is greyer than the same stone cut for a house.)
  const outcrop: Colour = [0.5 + 0.5 * stoneTint[0], 0.52 + 0.5 * stoneTint[1], 0.56 + 0.5 * stoneTint[2]];
  const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
  const strata = new Strata(kind, rng.fork('strata'), 0);
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
  const blotSeed = rng.fork('blot').int(1, 9999);
  const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number): Colour => {
    const u = strata.at(q.x, q.y, q.z), i = Math.floor(u);
    const t = strata.shade(i), soft = 1 - strata.hardness(i);
    const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed);
    const rust = smooth((fbm3(q.x * 0.17 + 9, q.y * 0.4, q.z * 0.17, 3, blotSeed + 3) - 0.6) / 0.14);
    const c = rockColour((0.72 + 0.56 * blot) * (0.7 + 0.3 * open));
    c[0] *= (kind.dark[0] + (kind.pale[0] - kind.dark[0]) * t) * (1 + 0.22 * rust);
    c[1] *= (kind.dark[1] + (kind.pale[1] - kind.dark[1]) * t) * (1 - 0.02 * rust);
    c[2] *= (kind.dark[2] + (kind.pale[2] - kind.dark[2]) * t) * (1 - 0.22 * rust);
    field[0] = Math.min(1, Math.max(0, n.y) * 0.9 + soft * 0.35 * (1 - open) + (1 - open) * 0.2);
    field[1] = Math.min(1, (1 - open) * 0.25 + soft * 0.3 * smooth((blot - 0.45) / 0.2));
    field[3] = 0.25 + 0.75 * kind.bedded;
    return c;
  };
  timed('cliff', () => {
    const CELL = 0.3;
    // Positive in air. A block of hill with a face that leans back a little, a top that rolls,
    // ends that fall away, and a back nobody looks at; the face is then broken as the valley's is.
    const air = (x: number, y: number, z: number): number => {
      const top = CLIFF_TOP + (fbm2(x * 0.09 + s1, z * 0.09, 2) - 0.5) * 2.4;
      const end = (Math.abs(x) - CLIFF_HALF - (fbm2(y * 0.2 + s2, z * 0.2, 2) - 0.5) * 3) * 0.8;
      const plain = z - (FACE_Z - 0.1 * y);
      const rest = Math.max(y - top, end, CLIFF_BACK - z);
      if (plain > 4.4 || plain < -4.4) return Math.max(plain, rest);
      const out = Math.min(2.4, Math.max(-2.4, relief.broad(x, y, z))) + Math.min(1.5, Math.max(-1.5, relief.fine(x, y, z)));
      return Math.max(plain - out, rest);
    };
    const before = rock.triangleCount + turf.triangleCount;
    carveRock(rock, air, {
      min: V(-CLIFF_HALF - 3.3, -1.2, CLIFF_BACK - 0.9), max: V(CLIFF_HALF + 3.3, CLIFF_TOP + 2.4, FACE_Z + 4.8),
      cell: CELL, uvScale: 0.4, otherUvScale: 2.3, fromSamples: true, occlusion: [0.3, 0.75], sharp: true,
      keep: (c) => c.y > ground(c.x, c.z) - 0.5,
      // The level top of the hill is turf, as it is in the valley; a ledge on the face is still rock.
      meshFor: (n, at) => (n.y > 0.74 && at.y > CLIFF_TOP - 2.2 ? turf : null),
      shade: (q, n, field, other, open) => (other ? turfColour(q.x, q.z, s1) : shadeRock(q, n, field, open)),
    });
    counts.cliff = rock.triangleCount + turf.triangleCount - before;
  });
  const stones: [number, number, number][] = [];
  timed('boulders', () => {
    const before = rock.triangleCount;
    const row: [number, number, number][] = [[-9.5, -9, 0.32], [-7.2, -8, 0.55], [-3.6, -9.5, 0.95], [1.6, -8.5, 1.5], [9, -10.5, 2.3], [5.2, 9.2, 0.7], [1.4, 3.1, 0.4]];
    row.forEach(([x, z, size], k) => {
      const fq = rng.fork(`boulder${k}`);
      const form = boulderForm(fq, size, kind);
      const base = ground(x, z), ts = fq.range(0, 60);
      const cy = base + form.half * fq.range(0.3, 0.75);
      const low = Math.min(base, ground(x - form.reach, z), ground(x + form.reach, z), ground(x, z - form.reach), ground(x, z + form.reach));
      const cell = Math.min(0.26, Math.max(0.08, size * 0.14));
      carveRock(rock, (qx, qy, qz) => form.density(qx - x, qy - cy, qz - z), {
        min: V(x - form.reach, Math.max(low - 0.4, cy - form.sink), z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
        cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
        shade: (c, n, field, _other, open) => {
          const h = c.y - base;
          field[0] = Math.min(1, Math.max(0, n.y) * 0.95 + (1 - open) * 0.3);
          field[1] = 0.45 * (1 - smooth(h / 0.3));
          field[3] = 0.35;
          const tone = (0.7 + 0.5 * fbm3(c.x * 1.1 + ts, c.y * 1.1, c.z * 1.1, 3)) * (0.66 + 0.34 * open) * (0.75 + 0.25 * smooth(h / 0.25));
          const t = form.bedShade!(c.x - x, c.y - cy, c.z - z), col = rockColour(tone);
          for (let k2 = 0; k2 < 3; k2++) col[k2] *= 0.3 + 0.7 * (kind.dark[k2] + (kind.pale[k2] - kind.dark[k2]) * t);
          return col;
        },
      });
      stones.push([x, z, size]);
    });
    counts.boulders = rock.triangleCount - before;
  });
  const clearOfStones = (x: number, z: number, room: number) => !stones.some((q) => Math.hypot(q[0] - x, q[1] - z) < q[2] + room);

  // ---------------------------------------------------------------- trees
  const planting = new Planting();
  const greens: Colour[] = o.season === 'autumn'
    ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
    : o.season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]]
    : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
  const parched = o.season === 'autumn' ? 0.55 : o.season === 'summer' ? 0.25 : 0;
  const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
  const oakBark: Colour = [0.66, 0.58, 0.5], ashBark: Colour = [0.86, 0.84, 0.8], firBark: Colour = [0.62, 0.5, 0.42], pineBark: Colour = [0.85, 0.58, 0.42];
  const spots: Record<string, [number, number, number]> = {};
  timed('trees', () => {
    const stand = (name: string, x: number, z: number, height: number): number => { const y = ground(x, z); spots[name] = [x, y + height * 0.6, z]; return y; };
    {
      const x = -21, z = 3, tall = 8.6, y = stand('oak', x, z, tall);
      const reach = growTree(planting, bark, x, y, z, tall, 0.33, { kind: 'oak', detail: 1, cards: 1500, cardSize: 0.74, leaf: leafOf(greens[0]), bark: oakBark, shaded: true, soft: bark }, rng.fork('oak'));
      trees.push({ x, z, r: reach });
    }
    {
      const x = -31, z = -7, tall = 10.5, y = stand('ash', x, z, tall);
      const reach = growTree(planting, bark, x, y, z, tall, 0.26, { kind: 'ash', detail: 1, cards: 1500, cardSize: 0.74, leaf: leafOf(greens[1]), bark: ashBark, shaded: true, soft: bark }, rng.fork('ash'));
      trees.push({ x, z, r: reach });
    }
    {
      // An old oak standing alone, its boughs reaching out low.
      const x = -36, z = 22, tall = 10, y = stand('old oak', x, z, tall);
      const reach = growTree(planting, bark, x, y, z, tall, 0.55, { kind: 'oak', detail: 1, cards: 2500, cardSize: 0.8, wide: 1.45, leaf: leafOf(greens[2]), bark: oakBark, shaded: true, soft: bark }, rng.fork('old-oak'));
      trees.push({ x, z, r: reach });
    }
    {
      const x = -30, z = 9, tall = 12, y = stand('spruce', x, z, tall);
      const reach = growConifer(planting, bark, x, y, z, tall, 2.5, 0.22, { kind: 'spruce', detail: 1, needle: leafOf([0.045, 0.13, 0.04]), bark: firBark, shaded: true, soft: bark }, rng.fork('spruce'));
      trees.push({ x, z, r: reach });
    }
    {
      const x = -19, z = 15, tall = 11.5, y = stand('pine', x, z, tall);
      const reach = growConifer(planting, bark, x, y, z, tall, 2.8, 0.23, { kind: 'pine', detail: 1, needle: leafOf([0.07, 0.15, 0.07]), bark: pineBark, shaded: true, soft: bark }, rng.fork('pine'));
      trees.push({ x, z, r: reach * 0.6 });
    }
    {
      // A bush, which is a small oak: what the valley's thickets are made of.
      const x = -12.5, z = 7.5, y = stand('bush', x, z, 1.6);
      growTree(planting, bark, x, y - 0.05, z, 2.3, 0.045, { kind: 'oak', detail: 0.5, cards: 64, cardSize: 0.52, leaf: leafOf(greens[3 % greens.length]), bark: oakBark, shaded: true }, rng.fork('bush'));
    }
    counts.wood = bark.triangleCount;
  });

  // ---------------------------------------------------------------- the sheet of ground
  timed('ground', () => {
    // Fine where it is walked on and coarser with distance, out to where far ground can be judged.
    const line: number[] = [];
    for (let v = -42; v <= 42.001; v += 0.6) line.push(v);
    for (let step = 0.9, v = 42 + step; v < 340; step = Math.min(14, step * 1.3), v += step) { line.push(v); line.unshift(-v); }
    const n = line.length, ids = new Int32Array(n * n);
    const e = 0.3;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = line[i], z = line[j] + 8, y = ground(x, z);
      const nx = ground(x - e, z) - ground(x + e, z), nz = ground(x, z - e) - ground(x, z + e), l = Math.hypot(nx, 2 * e, nz);
      const c = turfColour(x, z, s1);
      const off = trackOff(x, z), foot = footOff(x, z);
      const track = Math.abs(off) < 6 ? 100 + off : foot < 3 ? 200 + foot : 0;
      const wet = wetAt(x, z);
      // Bare in the bottom of the hollow, where water stands part of the year, and round the big stones.
      let bare = 0.9 * (1 - smooth((Math.hypot(x - HOLLOW.x, z - HOLLOW.z) - HOLLOW.r * 0.3) / (HOLLOW.r * 0.45)));
      for (const q of stones) bare = Math.max(bare, 0.5 * (1 - smooth((Math.hypot(q[0] - x, q[1] - z) - q[2] * 0.8) / 0.7)));
      // And along the foot of the cliff, where what falls from it lies.
      bare = Math.max(bare, 0.6 * (1 - smooth((z - FACE_Z - 0.5) / 2.2)) * (Math.abs(x) < CLIFF_HALF + 1 ? 1 : 0));
      ids[j * n + i] = turf.addVertex(x, y, z, nx / l, (2 * e) / l, nz / l, x * 2.3, z * 2.3, c[0], c[1], c[2], track, wet, bare, smooth((canopy(x, z) - 0.3) / 0.45));
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = ids[j * n + i], b = ids[j * n + i + 1], c = ids[(j + 1) * n + i], d = ids[(j + 1) * n + i + 1];
      turf.addTriangle(a, c, b);
      turf.addTriangle(b, c, d);
    }
    counts.ground = (n - 1) * (n - 1) * 2;
  });

  // ---------------------------------------------------------------- what grows low down
  timed('planting', () => {
    const plant = rng.fork('plant');
    const flowerHues: Colour[] = [[0.25, 0.5, 1.5], [1.4, 0.4, 0.8], [1.3, 1.3, 1.2], [1.5, 1.1, 0.2]];
    const fernGreen: Colour = o.season === 'autumn' ? [0.34, 0.22, 0.05] : [0.1, 0.27, 0.05];
    const rutted = (x: number, z: number): boolean => { const off = Math.abs(trackOff(x, z)); return Math.abs(off - 0.58) < 0.3; };
    for (let gz = -21; gz < 44; gz += 0.42) for (let gx = -42; gx < 34; gx += 0.42) {
      const x = gx + plant.range(0, 0.42), z = gz + plant.range(0, 0.42);
      const off = Math.abs(trackOff(x, z)), foot = footOff(x, z);
      if (rutted(x, z) || foot < 0.3 || !clearOfStones(x, z, -0.15)) continue;
      // Grass thins towards the track and the path, as it does where feet and wheels go.
      if (off < 1.4 && !plant.chance(0.3 + 0.7 * Math.min(1, off / 1.4))) continue;
      if (foot < 0.9 && !plant.chance(foot / 0.9)) continue;
      const y = ground(x, z), wet = wetAt(x, z), shade = canopy(x, z);
      const dx = Math.hypot(x - HOLLOW.x, z - HOLLOW.z);
      if (dx < HOLLOW.r * 0.42) continue;
      const deep = Math.max(0, shade - 0.4) / 0.6;
      if (!plant.chance(1 - 0.72 * deep)) continue;
      const moist = 0.35 + 0.5 * wet + 0.3 * (fbm2(x * 0.08 + s2, z * 0.08, 2) - 0.3);
      const wear = Math.max(0, 1 - off / 2.2, 1 - foot / 1.5);
      const tall = (0.45 + 1.1 * moist) * (1 - 0.82 * wear) * (1 - 0.5 * deep) * (0.8 + 0.5 * fbm2(x * 0.3 + s2, z * 0.3 + s1, 2));
      const c = turfColour(x, z, s1), t = plant.range(0.75, 1.2);
      const dry = Math.min(1, parched + Math.max(0, (0.42 - moist) * 2.2) + (plant.chance(0.08) ? 0.8 : 0));
      planting.tuft(planting.grass, x, y - 0.05, z, plant.range(0.4, 0.7) * (0.75 + 0.35 * tall), plant.range(0.2, 0.34) * (0.35 + 1.25 * tall), plant.range(0, Math.PI), [(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t]);
      // Flowers in drifts, in the open; ferns under the trees.
      if (shade < 0.35 && wear < 0.2 && fbm2(x * 0.13 + s1 * 3, z * 0.13 + s2, 2) > 0.6 && plant.chance(0.08)) {
        const size = plant.range(0.3, 0.45);
        planting.tuft(planting.flowers, x, y - 0.02, z, size, size * plant.range(0.9, 1.3), plant.range(0, Math.PI), flowerHues[Math.floor(fbm2(x * 0.02 + s2, z * 0.02 - s1, 2) * 3.99) % 4]);
      }
      if (shade > 0.45 && plant.chance(0.1 * shade)) {
        const size = plant.range(0.8, 1.4), k = plant.range(0.75, 1.2);
        planting.tuft(planting.ferns, x, y - 0.04, z, size, size * plant.range(0.55, 0.8), plant.range(0, Math.PI), [fernGreen[0] * k, fernGreen[1] * k, fernGreen[2] * k]);
      }
    }
    // Reeds round the wet bottom of the hollow.
    for (let k = 0; k < 90; k++) {
      const a = plant.range(0, Math.PI * 2), d = HOLLOW.r * plant.range(0.4, 0.62), x = HOLLOW.x + Math.cos(a) * d, z = HOLLOW.z + Math.sin(a) * d;
      planting.tuft(planting.reeds, x, ground(x, z) - 0.05, z, plant.range(0.5, 0.8), plant.range(1.1, 1.9), plant.range(0, Math.PI), [0.2 * plant.range(0.8, 1.2), 0.3, 0.08]);
    }
    for (const set of planting.sets) counts[set.kind] = set.matrices.length / 16;
  });

  spots.cliff = [0, 5.5, FACE_Z];
  spots.boulders = [1.6, 1, -8.5];
  spots.track = [trackX(14), ground(trackX(14), 14), 14];
  spots.path = [1, ground(1, 18.5), 18.5];
  spots.hollow = [HOLLOW.x, ground(HOLLOW.x, HOLLOW.z), HOLLOW.z];
  spots.meadow = [-4, ground(-4, 24), 24];
  return { meshes, cards: planting.sets, ground, near: { min: V(-44, -2, CLIFF_BACK - 2), max: V(36, 16, 46) }, spots, times, counts };
}
