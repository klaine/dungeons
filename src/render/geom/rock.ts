import { Vector3 } from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';
import { MeshBuilder } from './meshBuilder';

/**
 * Natural rock. Where masonry is laid stone by stone on a surface, rock is carved: a function says
 * how far inside open air each point is (positive in air, negative in rock), and the surface
 * between the two is extracted with marching cubes. The result has curves, overhangs and no grid.
 *
 * Triangles do not share vertices. Each takes its texture from the direction it mostly faces
 * (floor and ceiling from above, walls from the side), which avoids stretched texture without
 * needing a special shader; shading stays smooth because normals come from the field itself.
 */

export type Density = (x: number, y: number, z: number) => number;

export interface RockOptions {
  min: Vector3;
  max: Vector3;
  /** Size of the sampling cells. Smaller is smoother and heavier. */
  cell: number;
  /** Texture repeats per metre. */
  uvScale: number;
  /**
   * Colour at a point, given its normal; and moss, wet and soot written to `field`. `face` is the
   * way the whole triangle faces, which is what `meshFor` was asked about.
   */
  shade: (p: Vector3, n: Vector3, field: Float32Array, face: Vector3) => [number, number, number];
  /** Sends a triangle to another mesh by which way it faces: turf for level ground, say. */
  meshFor?: (faceNormal: Vector3, centre: Vector3) => MeshBuilder | null;
  /** Texture repeats per metre for triangles sent to another mesh. */
  otherUvScale?: number;
}

// Cube corners and the pair of corners each edge joins, in the order the tables expect.
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

export function carveRock(mesh: MeshBuilder, density: Density, o: RockOptions): number {
  const nx = Math.ceil((o.max.x - o.min.x) / o.cell);
  const ny = Math.ceil((o.max.y - o.min.y) / o.cell);
  const nz = Math.ceil((o.max.z - o.min.z) / o.cell);
  const sx = nx + 1, sy = ny + 1;
  const values = new Float32Array(sx * sy * (nz + 1));
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    values[(k * sy + j) * sx + i] = density(o.min.x + i * o.cell, o.min.y + j * o.cell, o.min.z + k * o.cell);
  }

  const P = [new Vector3(), new Vector3(), new Vector3()];
  const N = [new Vector3(), new Vector3(), new Vector3()];
  const A = new Vector3(), B = new Vector3(), F = new Vector3();
  const field = new Float32Array(4);
  const corner = new Float32Array(8);
  const e = 0.04;
  let triangles = 0;

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let index = 0;
    for (let c = 0; c < 8; c++) {
      corner[c] = values[((k + CORNER[c][2]) * sy + j + CORNER[c][1]) * sx + i + CORNER[c][0]];
      if (corner[c] < 0) index |= 1 << c;
    }
    if (edgeTable[index] === 0) continue;
    for (let t = index * 16; triTable[t] !== -1; t += 3) {
      for (let v = 0; v < 3; v++) {
        const [a, b] = EDGE[triTable[t + v]];
        const f = corner[a] / (corner[a] - corner[b]);
        P[v].set(
          o.min.x + (i + CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * f) * o.cell,
          o.min.y + (j + CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * f) * o.cell,
          o.min.z + (k + CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * f) * o.cell,
        );
        // The normal points into the air: the way the density rises.
        N[v].set(
          density(P[v].x + e, P[v].y, P[v].z) - density(P[v].x - e, P[v].y, P[v].z),
          density(P[v].x, P[v].y + e, P[v].z) - density(P[v].x, P[v].y - e, P[v].z),
          density(P[v].x, P[v].y, P[v].z + e) - density(P[v].x, P[v].y, P[v].z - e),
        );
        if (N[v].lengthSq() < 1e-12) N[v].set(0, 1, 0);
        N[v].normalize();
      }
      // The tables list each triangle facing into the rock, so the face normal is the reverse of
      // its winding. Winding is taken from the tables, never from the field's slope: where two
      // parts of the field meet in a crease the slope can point the wrong way, and a triangle
      // wound by it would face away and leave a hole.
      A.subVectors(P[1], P[0]);
      B.subVectors(P[2], P[0]);
      F.crossVectors(B, A);
      if (F.lengthSq() < 1e-14) continue;
      F.normalize();
      for (let v = 0; v < 3; v++) if (N[v].dot(F) < 0.25) N[v].copy(F);
      // Texture from the side this triangle mostly faces.
      const ax = Math.abs(F.x), ay = Math.abs(F.y), az = Math.abs(F.z);
      const ids: number[] = [];
      const target = (o.meshFor && o.meshFor(F, A.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3))) || mesh;
      for (let v = 0; v < 3; v++) {
        const p = P[v];
        const u = ay >= ax && ay >= az ? p.x : ax >= az ? p.z : p.x;
        const w = ay >= ax && ay >= az ? p.z : p.y;
        field[0] = 0; field[1] = 0; field[2] = 0;
        const [r, g, b] = o.shade(p, N[v], field, F);
        const scale = target === mesh ? o.uvScale : o.otherUvScale ?? o.uvScale;
        ids.push(target.addVertex(p.x, p.y, p.z, N[v].x, N[v].y, N[v].z, u * scale, w * scale, r, g, b, field[0], field[1], field[2], 0));
      }
      target.addTriangle(ids[0], ids[2], ids[1]);
      triangles++;
    }
  }
  return triangles;
}

/** A smooth minimum: like `Math.min`, but rounds the crease where the two meet. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}
