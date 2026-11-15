import { Vector3 } from 'three';
import { fbm2 } from '../core/rng';
import { Kit, Mass, Opening } from '../render/geom/kit';
import { MasonryStyle } from '../render/geom/masonry';
import { MeshBuilder } from '../render/geom/meshBuilder';

/**
 * The look-spike scene: a walled courtyard with an arcade along its east side, and a doorway in the
 * north wall into a barrel-vaulted hall lit by torches. Hand-assembled from the kit of parts; the
 * site mesher will make the same calls from generated data.
 *
 * Axes: +x east, +y up, +z south. The courtyard floor is y = 0.
 */

export interface TorchSpec {
  position: Vector3;
  /** Unit vector from the wall towards the room. */
  out: Vector3;
}

export interface SceneDescription {
  /** Geometry by material name. */
  meshes: Map<string, MeshBuilder>;
  /** Solid volumes behind the visible skin, for the light bake. */
  masses: Mass[];
  torches: TorchSpec[];
  sunDir: Vector3;
  spawn: { position: Vector3; yaw: number };
  bounds: { min: Vector3; max: Vector3 };
  blocks: number;
}

const LIME: [number, number, number] = [0.86, 0.77, 0.63];
const MORTAR: [number, number, number] = [0.5, 0.45, 0.36];

const ashlar: MasonryStyle = {
  course: [0.26, 0.38], length: [0.5, 1.05], joint: 0.007, bevel: 0.013, depth: 0.014, proud: 0.009, relief: 0.004,
  maxSeg: 0.3, chip: 0.14, tint: LIME, tintVar: 0.13, hueVar: 0.035, mortar: MORTAR, uvScale: 0.8,
};
const dressed: MasonryStyle = { ...ashlar, length: [0.26, 0.38], course: [0.3, 0.4], proud: 0.005, tint: [0.92, 0.84, 0.7], tintVar: 0.08, chip: 0.08 };
const vaultStone: MasonryStyle = { ...ashlar, course: [0.28, 0.36], length: [0.45, 0.8], tint: [0.8, 0.73, 0.62], maxSeg: 0.3 };
const flag: MasonryStyle = {
  course: [0.55, 0.95], length: [0.6, 1.35], joint: 0.009, bevel: 0.012, depth: 0.012, proud: 0.007, relief: 0.005,
  maxSeg: 0.3, chip: 0.2, tint: [0.64, 0.59, 0.51], tintVar: 0.16, hueVar: 0.03, mortar: [0.4, 0.37, 0.3], uvScale: 0.7,
};
const hallFlag: MasonryStyle = { ...flag, tint: [0.52, 0.49, 0.44], proud: 0.004 };
const coping: MasonryStyle = { ...dressed, length: [0.6, 0.9], course: [0.4, 0.6] };
const slate: MasonryStyle = {
  course: [0.24, 0.3], length: [0.3, 0.46], joint: 0.003, bevel: 0.008, depth: 0.012, proud: 0.014, relief: 0.003,
  maxSeg: 0.5, chip: 0.25, tint: [0.36, 0.39, 0.45], tintVar: 0.22, hueVar: 0.03, mortar: [0.12, 0.12, 0.13], uvScale: 1.4,
};
const plank: MasonryStyle = {
  course: [0.19, 0.27], length: [2.2, 3.8], joint: 0.002, bevel: 0.005, depth: 0.012, proud: 0.005, relief: 0.003,
  maxSeg: 0.5, chip: 0, tint: [1, 1, 1], tintVar: 0.2, hueVar: 0.04, mortar: [0.1, 0.07, 0.05], uvScale: 0.55,
};
const beam: MasonryStyle = { ...plank, course: [0.3, 0.4], length: [5, 6], bevel: 0.012, tint: [0.8, 0.78, 0.75], tintVar: 0.1 };

export function buildCourtyardHall(seed: string): SceneDescription {
  const kit = new Kit(seed);
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const sunDir = V(-0.3, 0.6, 0.9).normalize();
  const torches: TorchSpec[] = [];

  // Fields. Outdoors: moss where the ground and wall bases stay damp, strongest in joints and in
  // patches; walls streak darker towards the ground. Indoors: damp low on the walls, soot above flames.
  const noiseSeed = 7;
  const outdoor = (p: Vector3, n: Vector3, out: Float32Array): number => {
    const patch = fbm2(p.x * 0.35 + 3, p.z * 0.35 + 9, 4, noiseSeed);
    const fine = fbm2(p.x * 2.1, p.z * 2.1 + p.y * 2.1, 3, noiseSeed + 5);
    const up = Math.max(0, n.y);
    const low = 1 - Math.min(1, Math.max(0, p.y / 1.4));
    const ground = up * (0.12 + Math.max(0, patch - 0.4) * 2.6);
    const base = (1 - up) * low * low * (0.3 + patch * 1.0);
    const ledge = up * Math.min(1, Math.max(0, p.y - 0.3)) * 0.7;
    out[0] = Math.min(1, (ground + base + ledge) * (0.55 + fine * 0.8));
    out[1] = Math.min(1, low * low * (1 - up) * 0.5 * patch + up * Math.max(0, patch - 0.6) * 1.2);
    out[2] = 0;
    // Weathering: rain streaks down the walls, grime towards the ground, blotches on the paving.
    const streak = fbm2((p.x + p.z) * 2.6, p.y * 0.22, 4, noiseSeed + 11);
    const blot = fbm2(p.x * 0.8 + 5, p.z * 0.8 + p.y * 0.8, 3, noiseSeed + 13);
    return 0.66 + 0.3 * streak * (1 - up) + 0.26 * blot - low * (1 - up) * 0.14 + up * 0.14;
  };
  const indoor = (p: Vector3, n: Vector3, out: Float32Array): number => {
    const patch = fbm2(p.x * 0.5 + p.z * 0.5, p.y * 0.6 + 4, 4, noiseSeed + 21);
    const up = Math.max(0, n.y);
    const low = 1 - Math.min(1, Math.max(0, p.y / 1.1));
    out[0] = 0;
    out[1] = Math.min(1, (1 - up) * low * low * patch * 1.3 + up * Math.max(0, patch - 0.62) * 1.5);
    let soot = 0;
    for (const t of torches) {
      const dx = p.x - t.position.x, dz = p.z - t.position.z, dy = p.y - t.position.y;
      if (dy < 0.1) continue;
      const spread = 0.22 + dy * 0.28;
      const r = Math.hypot(dx, dz);
      soot = Math.max(soot, Math.max(0, 1 - r / spread) * Math.max(0, 1 - dy / 3.2) * (0.6 + patch * 0.8));
    }
    out[2] = Math.min(1, soot);
    return 0.9 + 0.14 * patch;
  };

  // ---------------------------------------------------------------- dimensions
  const CX0 = 0, CX1 = 14, CZ1 = 16;            // courtyard
  const AX = 11, AT = 0.7, AXB = 14.6;          // arcade wall line, its thickness, arcade back wall
  const NT = 0.9;                               // north wall thickness
  const HX0 = 3.5, HX1 = 10.5;                  // hall
  const HZ0 = -NT, HZ1 = -NT - 18;
  const SPRING = 3.5, R = 3.5;
  const hallAxisX = (HX0 + HX1) / 2;

  // Torches go on the pilasters, placed first so the soot field knows where they are.
  const ribZ = [1, 2, 3, 4].map((k) => HZ0 - k * 3.6);
  torches.push({ position: V(HX0 + 0.5, 2.25, ribZ[1]), out: V(1, 0, 0) });
  torches.push({ position: V(HX1 - 0.5, 2.25, ribZ[2]), out: V(-1, 0, 0) });
  torches.push({ position: V(HX0 + 0.5, 2.25, ribZ[3]), out: V(1, 0, 0) });
  torches.push({ position: V(HX1 - 0.5, 2.25, ribZ[3]), out: V(-1, 0, 0) });

  // ---------------------------------------------------------------- courtyard
  kit.field = outdoor;
  kit.slab('floor', CX0 - 0.1, -0.1, AXB + 0.1, CZ1 + 0.1, 0, flag);

  // North wall, with the hall door and a window above it.
  const north = kit.frame(CX0 - 0.1, 0, AXB + 0.1, 0);
  const door: Opening = { c: hallAxisX + 0.1, w: 0.95, y0: -0.1, ys: 2.25 };
  const window: Opening = { c: hallAxisX + 0.1, w: 0.5, y0: 4.5, ys: 5.35 };
  kit.wallFace('stone', north, -0.1, 8.6, ashlar, { openings: [door, window] });
  kit.openingTrim('stone', north, door, NT, dressed, 'both');
  kit.openingTrim('stone', north, window, NT, dressed, 'both');
  kit.box('stone', V(hallAxisX - 0.75, 4.36, -NT - 0.06), V(hallAxisX + 0.75, 4.5, 0.08), 'xXyYzZ', coping, coping);
  kit.slab('floor', hallAxisX - 1.05, -NT + 0.1, hallAxisX + 1.05, -0.1, 0, { ...flag, course: [0.7, 0.7], length: [0.9, 1.2] });

  // West wall, tall; south wall, low, both with merlons against the sky.
  const west = kit.frame(CX0, CZ1 + 0.1, CX0, -0.1);
  kit.wallFace('stone', west, -0.1, 6.0, ashlar);
  kit.wallMass(west, 1.2, -1, 6.0);
  kit.wallMass(north, NT, -1, 8.6, [door, window]);
  kit.mass(V(CX0 - 2, -1.6, HZ1 - 2), V(AXB + 2, -0.035, CZ1 + 2));
  const south = kit.frame(AX, CZ1, CX0 - 0.1, CZ1);
  kit.wallFace('stone', south, -0.1, 3.9, ashlar);
  kit.wallMass(south, 1.2, -1, 3.9);
  kit.box('stone', V(CX0 - 0.1, 3.9, CZ1 - 0.12), V(AX, 4.02, CZ1 + 0.6), 'zYy', coping, coping);
  for (let x = 0.5; x < AX - 1; x += 1.9) {
    kit.box('stone', V(x, 4.02, CZ1 - 0.04), V(x + 1.0, 4.9, CZ1 + 0.5), 'xXzY', ashlar, coping);
  }
  kit.box('stone', V(CX0 - 0.6, 6.0, -0.1), V(CX0 + 0.12, 6.12, CZ1 + 0.1), 'XYy', coping, coping);
  for (let z = 0.6; z < CZ1 - 1; z += 1.9) {
    kit.box('stone', V(CX0 - 0.5, 6.12, z), V(CX0 + 0.04, 7.0, z + 1.0), 'XzZY', ashlar, coping);
  }

  // Arcade: a wall of four arches on piers, a lean-to roof behind it.
  const arches: Opening[] = [2, 6, 10, 14].map((z) => ({ c: z + 0.1, w: 1.3, y0: -0.1, ys: 2.3 }));
  const arcade = kit.frame(AX, -0.1, AX, CZ1 + 0.1);
  kit.wallFace('stone', arcade, -0.1, 4.7, ashlar, { openings: arches });
  for (const a of arches) kit.openingTrim('stone', arcade, a, AT, dressed, 'both');
  kit.wallMass(arcade, AT, -1, 4.7, arches);
  kit.mass(V(AXB + 0.035, -1, -0.1), V(AXB + 1.4, 5.7, CZ1 + 0.1));
  kit.mass(V(AX + AT, -1, CZ1 + 0.035), V(AXB + 1.4, 4.7, CZ1 + 1.2));
  kit.box('stone', V(AX - 0.1, 4.7, -0.1), V(AX + AT, 4.82, CZ1 + 0.1), 'xYy', coping, coping);
  const arcadeIn = kit.frame(AX + AT, CZ1 + 0.1, AX + AT, -0.1);
  kit.wallFace('stone', arcadeIn, -0.1, 4.2, ashlar, { openings: arches.map((a) => ({ ...a, c: arcade.length - a.c })) });
  kit.wallFace('stone', kit.frame(AXB, -0.1, AXB, CZ1 + 0.1), -0.1, 4.2, ashlar);
  kit.wallFace('stone', kit.frame(AXB + 0.1, CZ1, AX + AT - 0.1, CZ1), -0.1, 4.2, ashlar);
  // The back wall rising above the roof, and the roof itself.
  kit.wallFace('stone', kit.frame(AXB + 0.2, -0.1, AXB + 0.2, CZ1 + 0.1), 5.7, 7.2, ashlar);
  const eave = V(AX + 0.06, 4.84, -0.1), ridge = V(AXB + 0.25, 6.3, -0.1);
  const slope = ridge.clone().sub(eave);
  const slopeLen = slope.length();
  slope.normalize();
  kit.plane('slate', eave, V(0, 0, 1), slope, V(0, 0, 1).cross(slope).normalize(), CZ1 + 0.2, slopeLen, slate);
  // Timber ceiling: beams across, boards above.
  kit.plane('wood', V(AX + AT - 0.1, 4.05, -0.1), V(0, 0, 1), V(1, 0, 0), V(0, -1, 0), CZ1 + 0.2, AXB - AX - AT + 0.2, plank);
  for (let z = 0.4; z < CZ1; z += 1.02) {
    kit.box('wood', V(AX + AT - 0.1, 3.78, z), V(AXB + 0.1, 4.05, z + 0.2), 'yzZ', beam, beam, 'beam');
  }

  // A well, off centre.
  const wx = 4.4, wz = 9.2;
  kit.roundWall('stone', wx, wz, 0.95, -0.1, 0.85, { ...ashlar, length: [0.45, 0.6] }, false, { open: { v1: true } });
  kit.roundWall('stone', wx, wz, 0.68, -2.5, 0.85, { ...ashlar, length: [0.35, 0.5] }, true, { open: { v1: true } });
  kit.ring('stone', wx, wz, 0.68, 0.95, 0.85, { ...dressed, length: [0.5, 0.65] });

  // ---------------------------------------------------------------- hall
  kit.field = indoor;
  kit.slab('floor', HX0 - 0.1, HZ1 - 0.1, HX1 + 0.1, HZ0 + 0.1, 0, hallFlag);
  const insideVault = (u: number, y: number, mid: number) => y < SPRING + 0.3 || Math.hypot(u - mid, y - SPRING) < R + 0.45;

  // South end (the back of the north wall) and north end, each with a window high up.
  const hallSouth = kit.frame(HX1 + 0.1, HZ0, HX0 - 0.1, HZ0);
  const mirror = (o: Opening): Opening => ({ ...o, c: HX1 + 0.1 - hallAxisX });
  kit.wallFace('stone', hallSouth, -0.1, 7.3, ashlar, {
    openings: [mirror(door), mirror(window)], keep: (u, y) => insideVault(u, y, hallSouth.length / 2),
  });
  const hallNorth = kit.frame(HX0 - 0.1, HZ1, HX1 + 0.1, HZ1);
  const apse: Opening = { c: hallNorth.length / 2, w: 0.55, y0: 3.7, ys: 5.2 };
  kit.wallFace('stone', hallNorth, -0.1, 7.3, ashlar, { openings: [apse], keep: (u, y) => insideVault(u, y, hallNorth.length / 2) });
  kit.openingTrim('stone', hallNorth, apse, NT, dressed, 'front');
  // The hall is cut into solid ground and masonry on every side but its two windows and its door.
  kit.wallMass(hallNorth, NT, -1, 8.2, [apse]);
  kit.mass(V(HX0 - 2, -1, HZ1 - NT - 0.1), V(HX0 - 0.035, 8.2, HZ0 - 0.035));
  kit.mass(V(HX1 + 0.035, -1, HZ1 - NT - 0.1), V(HX1 + 2, 8.2, HZ0 - 0.035));
  kit.mass(V(HX0 - 2, SPRING + R + 0.06, HZ1 - NT - 0.1), V(HX1 + 2, 8.2, HZ0 - 0.035));
  kit.box('stone', V(hallAxisX - 0.8, 3.56, HZ1 - NT), V(hallAxisX + 0.8, 3.7, HZ1 + 0.1), 'xXYZ', coping, coping);

  // Side walls to the springing, then the vault.
  kit.wallFace('stone', kit.frame(HX0, HZ0 + 0.1, HX0, HZ1 - 0.1), -0.1, SPRING + 0.12, ashlar);
  kit.wallFace('stone', kit.frame(HX1, HZ1 - 0.1, HX1, HZ0 + 0.1), -0.1, SPRING + 0.12, ashlar);
  kit.barrelVault('stone', V(hallAxisX, SPRING, HZ0 + 0.1), V(0, 0, -1), 18.2, R, vaultStone);

  // Transverse ribs on pilasters with a plain impost.
  for (const z of ribZ) {
    kit.rib('stone', V(hallAxisX, SPRING, z), V(0, 0, -1), R, 0.56, 0.32, dressed);
    for (const [x0, x1, faces] of [[HX0 - 0.05, HX0 + 0.32, 'XzZ'], [HX1 - 0.32, HX1 + 0.05, 'xzZ']] as const) {
      kit.box('stone', V(x0, -0.1, z - 0.28), V(x1, SPRING - 0.2, z + 0.28), faces, ashlar);
      const grow = x0 < hallAxisX ? [0, 0.07] : [-0.07, 0];
      kit.box('stone', V(x0 + grow[0], SPRING - 0.2, z - 0.35), V(x1 + grow[1], SPRING + 0.02, z + 0.35), faces + 'y', coping, coping, 'impost');
    }
  }

  // Dais: three steps up to a platform, and a stone chest on it.
  const stepZ = HZ1 + 3.4;
  for (let k = 0; k < 3; k++) {
    const y = 0.17 * (k + 1);
    const zf = stepZ - 0.42 * k;
    kit.box('floor', V(HX0 - 0.05, y - 0.17, k === 2 ? HZ1 - 0.1 : zf - 0.5), V(HX1 + 0.05, y, zf), 'ZY', { ...hallFlag, course: [0.17, 0.17], length: [0.8, 1.3] }, hallFlag, 'step');
  }
  const dy = 0.51;
  kit.box('stone', V(hallAxisX - 1.1, dy, HZ1 + 1.0), V(hallAxisX + 1.1, dy + 0.85, HZ1 + 1.95), 'xXzZ', { ...dressed, length: [0.7, 1.1], course: [0.4, 0.45] });
  kit.box('stone', V(hallAxisX - 1.2, dy + 0.85, HZ1 + 0.9), V(hallAxisX + 1.2, dy + 1.02, HZ1 + 2.05), 'xXzZYy', { ...coping, length: [1.1, 1.3], course: [0.17, 0.17] }, { ...coping, length: [2.4, 2.4], course: [1.15, 1.15] }, 'lid');

  return {
    meshes: kit.meshes,
    masses: kit.masses,
    torches,
    sunDir,
    spawn: { position: V(7.6, 1.7, 13.2), yaw: 0.06 },
    bounds: { min: V(-2, -3, HZ1 - 2), max: V(AXB + 2, 10, CZ1 + 2) },
    blocks: kit.blocks,
  };
}
