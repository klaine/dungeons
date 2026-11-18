import { BufferAttribute, BufferGeometry } from 'three';
import { meshTriangles, SQUARE } from '../core/stream';

/**
 * A square of land at a metre (`stream.ts`) as a mesh true to within a given distance: only the
 * points the ground needs, many where it is broken and few where it is smooth, and fewer the further
 * off it lies, as whoever draws it asks. Along its edge it carries a skirt, a strip hanging down from
 * the edge: its neighbour may be meshed to another distance, keeping other points along the same edge,
 * and the skirt fills the slit that would show between them.
 */

/** How deep a skirt hangs below a square's edge, in metres. */
const SKIRT = 6;

export interface SquareMesh { geometry: BufferGeometry; triangles: number }

/**
 * Builds the mesh of a square true to within `maxError` metres. `colourAt` gives the ground's colour
 * at a point from its height and the steepness there.
 */
export function squareMesh(x0: number, z0: number, heights: Float32Array, errors: Float32Array, maxError: number, colourAt: (x: number, z: number, y: number, slope: number) => [number, number, number]): SquareMesh {
  const size = SQUARE.n, last = size - 1, { triangles } = meshTriangles(errors, maxError);
  const vertexOf = new Int32Array(size * size).fill(-1), pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const add = (k: number, drop = 0): number => {
    const i = k % size, j = (k - i) / size, y = heights[k];
    // (Normals from the ground at a metre, whatever the mesh keeps: a large triangle on rough ground still shades rough.)
    const l = i > 0 ? k - 1 : k, r = i < last ? k + 1 : k, u = j > 0 ? k - size : k, d = j < last ? k + size : k;
    const gx = (heights[r] - heights[l]) / Math.max(1, r - l), gz = (heights[d] - heights[u]) / Math.max(1, (d - u) / size), len = Math.hypot(gx, 1, gz);
    const [cr, cg, cb] = colourAt(x0 + i, z0 + j, y, Math.hypot(gx, gz));
    pos.push(x0 + i, y - drop, z0 + j); nrm.push(-gx / len, 1 / len, -gz / len); col.push(cr, cg, cb);
    return pos.length / 3 - 1;
  };
  const vertex = (k: number) => (vertexOf[k] >= 0 ? vertexOf[k] : (vertexOf[k] = add(k)));
  const index: number[] = [];
  const onEdge = (a: number, b: number) => {
    const ai = a % size, aj = (a - ai) / size, bi = b % size, bj = (b - bi) / size;
    return (ai === 0 && bi === 0) || (ai === last && bi === last) || (aj === 0 && bj === 0) || (aj === last && bj === last);
  };
  const edges: [number, number][] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    let a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    // (Wound so that each faces up: drawn from above, its corners run counter-clockwise.)
    const ax = a % size, az = (a - ax) / size, bx = b % size, bz = (b - bx) / size, cx = c % size, cz = (c - cx) / size;
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { const s = b; b = c; c = s; }
    index.push(vertex(a), vertex(b), vertex(c));
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) if (onEdge(p, q)) edges.push([p, q]);
  }
  // The skirt: for each piece of the edge, a strip down from it, made both ways about so it shows from either side.
  for (const [p, q] of edges) {
    const p0 = vertex(p), q0 = vertex(q), p1 = add(p, SKIRT), q1 = add(q, SKIRT);
    index.push(p0, q0, q1, p0, q1, p1, p0, q1, q0, p0, p1, q1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(new BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  g.computeBoundingSphere();
  return { geometry: g, triangles: index.length / 3 };
}
