import { Vector3 } from 'three';
import { fbm2 } from '../core/rng';
import { FieldFn } from './geom/kit';
import { TorchSpec } from './scene';

/**
 * Surface fields: where moss could grow, where stone is damp, where soot has gathered, and how
 * weathered it is. Written per vertex as the geometry is built. (Whether moss actually grows also
 * depends on light, which the bake adds later.)
 */

const SEED = 7;

/**
 * Under the sky: moss potential on the ground and at wall bases, rain streaks down walls.
 * `floor` is the height of the ground.
 */
export function outdoorFieldAt(floor: number): FieldFn {
  return (p: Vector3, n: Vector3, out: Float32Array): number => outdoor(p, n, out, floor);
}

export const outdoorField: FieldFn = outdoorFieldAt(0);

function outdoor(p: Vector3, n: Vector3, out: Float32Array, floor: number): number {
  const patch = fbm2(p.x * 0.35 + 3, p.z * 0.35 + 9, 4, SEED);
  const fine = fbm2(p.x * 2.1, p.z * 2.1 + p.y * 2.1, 3, SEED + 5);
  const up = Math.max(0, n.y);
  const h = p.y - floor;
  const low = 1 - Math.min(1, Math.max(0, h / 1.4));
  const ground = up * (0.12 + Math.max(0, patch - 0.4) * 2.6);
  const base = (1 - up) * low * low * (0.3 + patch * 1.0);
  const ledge = up * Math.min(1, Math.max(0, h - 0.3)) * 0.7;
  out[0] = Math.min(1, (ground + base + ledge) * (0.55 + fine * 0.8));
  out[1] = Math.min(1, low * low * (1 - up) * 0.5 * patch + up * Math.max(0, patch - 0.6) * 1.2);
  out[2] = 0;
  const streak = fbm2((p.x + p.z) * 2.6, p.y * 0.22, 4, SEED + 11);
  const blot = fbm2(p.x * 0.8 + 5, p.z * 0.8 + p.y * 0.8, 3, SEED + 13);
  return 0.66 + 0.3 * streak * (1 - up) + 0.26 * blot - low * (1 - up) * 0.14 + up * 0.14;
}

/**
 * Under a roof: damp low on the walls, soot above each flame. `floor` is the height of the floor
 * the damp rises from.
 */
export function indoorField(torches: readonly TorchSpec[], floor = 0): FieldFn {
  return (p: Vector3, n: Vector3, out: Float32Array): number => {
    const patch = fbm2(p.x * 0.5 + p.z * 0.5, p.y * 0.6 + 4, 4, SEED + 21);
    const up = Math.max(0, n.y);
    const low = 1 - Math.min(1, Math.max(0, (p.y - floor) / 1.1));
    out[0] = 0;
    out[1] = Math.min(1, (1 - up) * low * low * patch * 1.3 + up * Math.max(0, patch - 0.62) * 1.5);
    let soot = 0;
    for (const t of torches) {
      const dx = p.x - t.position.x, dz = p.z - t.position.z, dy = p.y - t.position.y;
      if (dy < 0.1 || dy > 3.2) continue;
      const spread = 0.22 + dy * 0.28;
      const r = Math.hypot(dx, dz);
      soot = Math.max(soot, Math.max(0, 1 - r / spread) * Math.max(0, 1 - dy / 3.2) * (0.6 + patch * 0.8));
    }
    out[2] = Math.min(1, soot);
    return 0.9 + 0.14 * patch;
  };
}
