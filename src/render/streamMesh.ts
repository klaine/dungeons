import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBuilder } from './geom/meshBuilder';
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

/** What the ground looks like at a point, for `squareBuilders`: turf's colour and its four fields (track, wet, bare, litter), and rock's colour. */
export interface GroundLook {
  turf: (x: number, z: number, y: number, slope: number) => number[];
  rock: (x: number, z: number, y: number) => [number, number, number];
}

/**
 * A square of land at a metre as the game's own meshes: turf where it is gentle and rock where it
 * is steep (as `layTerrain` lays the valley's sheet, a triangle at a time by how steep it is), with
 * the colours and fields the game's ground and rock materials read, true to within `maxError`
 * metres, and its skirts. Each mesh shares its points among its triangles.
 */
export function squareBuilders(x0: number, z0: number, heights: Float32Array, errors: Float32Array, maxError: number, look: GroundLook, bare = 0.72): { turf: MeshBuilder; rock: MeshBuilder; triangles: number } {
  const size = SQUARE.n, last = size - 1, { triangles } = meshTriangles(errors, maxError);
  const turf = new MeshBuilder(), rock = new MeshBuilder();
  const ids = { turf: new Int32Array(size * size).fill(-1), rock: new Int32Array(size * size).fill(-1) };
  const normalAt = (k: number): [number, number, number, number] => {
    const i = k % size, j = (k - i) / size, l = i > 0 ? k - 1 : k, r = i < last ? k + 1 : k, u = j > 0 ? k - size : k, d = j < last ? k + size : k;
    const gx = (heights[r] - heights[l]) / Math.max(1, r - l), gz = (heights[d] - heights[u]) / Math.max(1, (d - u) / size), len = Math.hypot(gx, 1, gz);
    return [-gx / len, 1 / len, -gz / len, Math.hypot(gx, gz)];
  };
  const add = (which: 'turf' | 'rock', k: number, drop = 0): number => {
    const i = k % size, j = (k - i) / size, x = x0 + i, z = z0 + j, y = heights[k] - drop, [nx, ny, nz, slope] = normalAt(k);
    if (which === 'turf') {
      const c = look.turf(x, z, heights[k], slope);
      return turf.addVertex(x, y, z, nx, ny, nz, x * 2.3, z * 2.3, c[0], c[1], c[2], c[3] ?? 0, c[4] ?? 0, c[5] ?? 0, c[6] ?? 0);
    }
    const c = look.rock(x, z, heights[k]), alongX = Math.abs(nx) > Math.abs(nz);
    return rock.addVertex(x, y, z, nx, ny, nz, (alongX ? z : x) * 0.4, y * 0.4, c[0], c[1], c[2], Math.max(0, ny) * 0.9, 0, 0, 1);
  };
  const vertex = (which: 'turf' | 'rock', k: number) => (ids[which][k] >= 0 ? ids[which][k] : (ids[which][k] = add(which, k)));
  const onEdge = (a: number, b: number) => {
    const ai = a % size, aj = (a - ai) / size, bi = b % size, bj = (b - bi) / size;
    return (ai === 0 && bi === 0) || (ai === last && bi === last) || (aj === 0 && bj === 0) || (aj === last && bj === last);
  };
  let count = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    let a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const ax = a % size, az = (a - ax) / size, bx = b % size, bz = (b - bx) / size, cx = c % size, cz = (c - cx) / size;
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { const s = b; b = c; c = s; }
    // (Which mesh: by the triangle's own slope, as the valley's sheet is laid.)
    const px = [a % size, b % size, c % size], pz = [(a - px[0]) / size, (b - px[1]) / size, (c - px[2]) / size], py = [heights[a], heights[b], heights[c]];
    const ux = px[1] - px[0], uy = py[1] - py[0], uz = pz[1] - pz[0], vx = px[2] - px[0], vy = py[2] - py[0], vz = pz[2] - pz[0];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, fl = Math.hypot(fx, fy, fz);
    const which = Math.abs(fy) / Math.max(1e-9, fl) < bare ? 'rock' : 'turf', mesh = which === 'turf' ? turf : rock;
    const A = vertex(which, a), B = vertex(which, b), C = vertex(which, c);
    // (Wound as the valley's sheet is, so that it faces up.)
    mesh.addTriangle(A, B, C);
    count++;
    // The skirt, where this triangle has a side on the square's edge.
    for (const [p, q, P, Q] of [[a, b, A, B], [b, c, B, C], [c, a, C, A]] as const) {
      if (!onEdge(p, q)) continue;
      const p1 = add(which, p, SKIRT), q1 = add(which, q, SKIRT);
      mesh.addTriangle(P, q1, Q); mesh.addTriangle(P, p1, q1); mesh.addTriangle(P, Q, q1); mesh.addTriangle(P, q1, p1);
      count += 4;
    }
  }
  return { turf, rock, triangles: count };
}
