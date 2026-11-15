import { Vector3 } from 'three';
import { indoorField, outdoorField } from '../render/fields';
import { Kit, Opening } from '../render/geom/kit';
import { ashlar, beam, coping, dressed, flag, hallFlag, plank, slate, vaultStone } from '../render/geom/styles';
import { SceneDescription, TorchSpec } from '../render/scene';

/**
 * The look-spike scene: a walled courtyard with an arcade along its east side, and a doorway in the
 * north wall into a barrel-vaulted hall lit by torches. Hand-assembled from the kit of parts. Kept
 * as a fixed test bed for the look; open it with ?scene=test.
 *
 * Axes: +x east, +y up, +z south. The courtyard floor is y = 0.
 */

export function buildCourtyardHall(seed: string): SceneDescription {
  const kit = new Kit(seed);
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const sunDir = V(-0.3, 0.6, 0.9).normalize();
  const torches: TorchSpec[] = [];
  const outdoor = outdoorField;
  const indoor = indoorField(torches);

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
  kit.box('stone', V(hallAxisX - 0.75, 4.36, -NT - 0.06), V(hallAxisX + 0.75, 4.5, 0.08), coping, coping);
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
  kit.box('stone', V(CX0 - 0.1, 3.9, CZ1 - 0.12), V(AX, 4.02, CZ1 + 0.6), coping, coping);
  for (let x = 0.5; x < AX - 1; x += 1.9) {
    kit.box('stone', V(x, 4.02, CZ1 - 0.04), V(x + 1.0, 4.9, CZ1 + 0.5), ashlar, coping);
  }
  kit.box('stone', V(CX0 - 0.6, 6.0, -0.1), V(CX0 + 0.12, 6.12, CZ1 + 0.1), coping, coping);
  for (let z = 0.6; z < CZ1 - 1; z += 1.9) {
    kit.box('stone', V(CX0 - 0.5, 6.12, z), V(CX0 + 0.04, 7.0, z + 1.0), ashlar, coping);
  }

  // Arcade: a wall of four arches on piers, a lean-to roof behind it.
  const arches: Opening[] = [2, 6, 10, 14].map((z) => ({ c: z + 0.1, w: 1.3, y0: -0.1, ys: 2.3 }));
  const arcade = kit.frame(AX, -0.1, AX, CZ1 + 0.1);
  kit.wallFace('stone', arcade, -0.1, 4.7, ashlar, { openings: arches });
  for (const a of arches) kit.openingTrim('stone', arcade, a, AT, dressed, 'both');
  kit.wallMass(arcade, AT, -1, 4.7, arches);
  kit.mass(V(AXB + 0.035, -1, -0.1), V(AXB + 1.4, 5.7, CZ1 + 0.1));
  kit.mass(V(AX + AT, -1, CZ1 + 0.035), V(AXB + 1.4, 4.7, CZ1 + 1.2));
  kit.box('stone', V(AX - 0.1, 4.7, -0.1), V(AX + AT, 4.82, CZ1 + 0.1), coping, coping);
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
    kit.box('wood', V(AX + AT - 0.1, 3.78, z), V(AXB + 0.1, 4.05, z + 0.2), beam, beam, 'beam');
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
  kit.box('stone', V(hallAxisX - 0.8, 3.56, HZ1 - NT), V(hallAxisX + 0.8, 3.7, HZ1 + 0.1), coping, coping);

  // Side walls to the springing, then the vault.
  kit.wallFace('stone', kit.frame(HX0, HZ0 + 0.1, HX0, HZ1 - 0.1), -0.1, SPRING + 0.12, ashlar);
  kit.wallFace('stone', kit.frame(HX1, HZ1 - 0.1, HX1, HZ0 + 0.1), -0.1, SPRING + 0.12, ashlar);
  kit.barrelVault('stone', V(hallAxisX, SPRING, HZ0 + 0.1), V(0, 0, -1), 18.2, R, vaultStone);

  // Transverse ribs on pilasters with a plain impost.
  for (const z of ribZ) {
    kit.rib('stone', V(hallAxisX, SPRING, z), V(0, 0, -1), R, 0.56, 0.32, dressed);
    for (const [x0, x1] of [[HX0 - 0.05, HX0 + 0.32], [HX1 - 0.32, HX1 + 0.05]] as const) {
      kit.box('stone', V(x0, -0.1, z - 0.28), V(x1, SPRING - 0.2, z + 0.28), ashlar);
      const grow = x0 < hallAxisX ? [0, 0.07] : [-0.07, 0];
      kit.box('stone', V(x0 + grow[0], SPRING - 0.2, z - 0.35), V(x1 + grow[1], SPRING + 0.02, z + 0.35), coping, coping, 'impost');
    }
  }

  // Dais: three steps up to a platform, and a stone chest on it.
  const stepZ = HZ1 + 3.4;
  for (let k = 0; k < 3; k++) {
    const y = 0.17 * (k + 1);
    const zf = stepZ - 0.42 * k;
    kit.box('floor', V(HX0 - 0.05, y - 0.17, k === 2 ? HZ1 - 0.1 : zf - 0.5), V(HX1 + 0.05, y, zf), { ...hallFlag, course: [0.17, 0.17], length: [0.8, 1.3] }, hallFlag, 'step');
  }
  const dy = 0.51;
  kit.box('stone', V(hallAxisX - 1.1, dy, HZ1 + 1.0), V(hallAxisX + 1.1, dy + 0.85, HZ1 + 1.95), { ...dressed, length: [0.7, 1.1], course: [0.4, 0.45] });
  kit.box('stone', V(hallAxisX - 1.2, dy + 0.85, HZ1 + 0.9), V(hallAxisX + 1.2, dy + 1.02, HZ1 + 2.05), { ...coping, length: [1.1, 1.3], course: [0.17, 0.17] }, { ...coping, length: [2.4, 2.4], course: [1.15, 1.15] }, 'lid');

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
