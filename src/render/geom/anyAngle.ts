import type { Colour } from '../planting';
import { MeshBuilder } from './meshBuilder';

/** A point in the world, as a triple. */
export type P3 = [number, number, number];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Faces and closed solids at any angle, given by their corners in the world: a face through its points, turned to face away from a
 * point inside; a solid of eight corners (four below, four above, in the same order round), no two alike in tone. For what does not
 * stand square to the world: the coast's cottages and boats, the town's streets and shacks.
 */
export function anyAngle(mesh: (material: string) => MeshBuilder) {
  let count = 0;
  const face = (material: string, pts: P3[], colour: Colour, inside: P3, scale = 0.5) => {
    const m = mesh(material);
    const [a, b, c] = pts;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const mid = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
    let list = pts;
    if ((mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; list = [...pts].reverse(); }
    // Texture laid from where the point is, on whichever plane the face lies most nearly in.
    const flat = Math.abs(ny) > 0.7, side = Math.abs(nx) > Math.abs(nz);
    const ids = list.map((q) => m.addVertex(q[0], q[1], q[2], nx, ny, nz, (flat ? q[0] : side ? q[2] : q[0]) * scale, (flat ? q[2] : q[1]) * scale, colour[0], colour[1], colour[2]));
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
    m.markFace(ids);
  };
  const solid = (material: string, c: P3[], colour: Colour, scale = 0.5) => {
    const tone = shade(colour, 0.95 + 0.1 * (((count++ * 7919) % 13) / 13));
    const inside: P3 = [0, 0, 0];
    for (const q of c) { inside[0] += q[0] / 8; inside[1] += q[1] / 8; inside[2] += q[2] / 8; }
    for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) face(material, f.map((i) => c[i]), tone, inside, scale);
  };
  return { face, solid };
}
