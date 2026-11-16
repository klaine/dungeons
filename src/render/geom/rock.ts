import { Vector3 } from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';
import { MeshBuilder } from './meshBuilder';

/**
 * Natural rock. Where masonry is laid stone by stone on a surface, rock is carved: a function says
 * how far inside open air each point is (positive in air, negative in rock), and the surface
 * between the two is extracted with marching cubes. The result has curves, overhangs and no grid.
 *
 * Vertices are shared between the triangles that meet at them, and shading is smooth because
 * normals come from the function itself. Rock is textured in the shader from where each point is
 * and which way it faces, so nothing here depends on texture coordinates; those written are only
 * for an exported model.
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
   * Colour at a point, given its normal; and moss, wet, soot and bedding written to `field`.
   * `other` is the mesh the point was sent to by `meshFor`, or null if it stayed rock. `open` is
   * the share of the sky the point sees, which is 1 unless `occlusion` was asked for.
   */
  shade: (p: Vector3, n: Vector3, field: Float32Array, other: MeshBuilder | null, open: number) => [number, number, number];
  /** Sends a triangle to another mesh by which way it faces: turf for level ground, say. */
  meshFor?: (faceNormal: Vector3, centre: Vector3) => MeshBuilder | null;
  /** Texture repeats per metre for triangles sent to another mesh: one number for all, or one for each. */
  otherUvScale?: number | ((mesh: MeshBuilder) => number);
  /** Triangles for which this is false are left out. */
  keep?: (centre: Vector3) => boolean;
  /**
   * Distances, in metres, at which to feel for rock in front of each point. Where rock is found
   * the point sits in a crack or under an overhang and sees less sky. The function must be
   * roughly a distance for this to mean anything. The result is given to `shade` and recorded on
   * the mesh for light that is not baked.
   */
  occlusion?: number[];
  /** How far apart the function is sampled to find its slope. Larger smooths the shading. */
  normalReach?: number;
  /**
   * Take the feeling for rock that `occlusion` does from the samples already made instead of
   * asking the function again, which is much quicker where the function is costly.
   */
  fromSamples?: boolean;
  /**
   * Take slopes from the samples too. The shading is then exactly as fine as the surface and no
   * finer. Left off, slopes come from the function itself, and an edge too sharp for the
   * surface to follow is still shaded as sharp.
   */
  softNormals?: boolean;
  /**
   * Keep sharp edges. The surface is then made a different way (see `carveSharp`): corners and
   * creases in the function come out as corners and creases, where otherwise they are rounded
   * off to the size of a cell.
   */
  sharp?: boolean;
  /**
   * For land carved in several pieces with `sharp`: whether the ground at a point outside this
   * piece is carved by another. Where it is, the two pieces are made to agree along their common
   * edge; where it is not, this piece is closed exactly to its edge.
   */
  beyond?: (x: number, z: number) => boolean;
  /** With `sharp`: faces meeting at more than this angle, in degrees, are shaded as an edge. Default 36. */
  crease?: number;
}

// Cube corners and the pair of corners each edge joins, in the order the tables expect.
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

/** What is gathered for one mesh before any of it is written: points, their slopes, and triangles. */
interface Part {
  ids: Map<number, number>;
  pos: number[];
  grad: number[];
  face: number[];
  tris: number[];
}

export function carveRock(mesh: MeshBuilder, density: Density, o: RockOptions): number {
  if (o.sharp) return carveSharp(mesh, density, o);
  const nx = Math.ceil((o.max.x - o.min.x) / o.cell - 1e-6);
  const ny = Math.ceil((o.max.y - o.min.y) / o.cell - 1e-6);
  const nz = Math.ceil((o.max.z - o.min.z) / o.cell - 1e-6);
  const sx = nx + 1, sy = ny + 1;
  const values = new Float32Array(sx * sy * (nz + 1));
  // Sampled a column at a time, bottom to top: a function of the land can then work out what
  // it needs to know about a spot on the ground once, and use it all the way up.
  for (let k = 0; k <= nz; k++) for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    values[(k * sy + j) * sx + i] = density(o.min.x + i * o.cell, o.min.y + j * o.cell, o.min.z + k * o.cell);
  }

  // The function as the samples have it: between samples, by straight-line blending.
  const sampled = (x: number, y: number, z: number): number => {
    const fx = Math.min(nx - 1e-4, Math.max(0, (x - o.min.x) / o.cell)), fy = Math.min(ny - 1e-4, Math.max(0, (y - o.min.y) / o.cell)), fz = Math.min(nz - 1e-4, Math.max(0, (z - o.min.z) / o.cell));
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
    const at = (k * sy + j) * sx + i, up = at + sx, far = at + sx * sy;
    const lo = values[at] + (values[at + 1] - values[at]) * tx + (values[up] - values[at] + (values[at] - values[at + 1] - values[up] + values[up + 1]) * tx) * ty;
    const hi = values[far] + (values[far + 1] - values[far]) * tx + (values[far + sx] - values[far] + (values[far] - values[far + 1] - values[far + sx] + values[far + sx + 1]) * tx) * ty;
    return lo + (hi - lo) * tz;
  };
  const feel: Density = o.fromSamples ? sampled : density;
  const slopeOf: Density = o.softNormals ? sampled : density;

  const parts = new Map<MeshBuilder, Part>();
  const partOf = (m: MeshBuilder): Part => {
    let p = parts.get(m);
    if (!p) parts.set(m, (p = { ids: new Map(), pos: [], grad: [], face: [], tris: [] }));
    return p;
  };
  const P = [new Vector3(), new Vector3(), new Vector3()];
  const keys = [0, 0, 0];
  const A = new Vector3(), B = new Vector3(), F = new Vector3(), C = new Vector3();
  const corner = new Float32Array(8);
  const e = o.normalReach ?? (o.softNormals ? o.cell * 0.75 : 0.04);
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
        // An edge is known by the lower of its two ends and the way it runs, so that every cell
        // sharing it finds the same point.
        const li = i + Math.min(CORNER[a][0], CORNER[b][0]), lj = j + Math.min(CORNER[a][1], CORNER[b][1]), lk = k + Math.min(CORNER[a][2], CORNER[b][2]);
        const axis = CORNER[a][0] !== CORNER[b][0] ? 0 : CORNER[a][1] !== CORNER[b][1] ? 1 : 2;
        keys[v] = ((lk * sy + lj) * sx + li) * 3 + axis;
      }
      // The tables list each triangle facing into the rock, so the face normal is the reverse of
      // its winding. Winding is taken from the tables, never from the field's slope: where two
      // parts of the field meet in a crease the slope can point the wrong way, and a triangle
      // wound by it would face away and leave a hole.
      A.subVectors(P[1], P[0]);
      B.subVectors(P[2], P[0]);
      F.crossVectors(B, A);
      const area = F.length();
      if (area < 1e-7) continue;
      C.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
      if (o.keep && !o.keep(C)) continue;
      A.copy(F).multiplyScalar(1 / area);
      const part = partOf((o.meshFor && o.meshFor(A, C)) || mesh);
      const ids = [0, 0, 0];
      for (let v = 0; v < 3; v++) {
        let id = part.ids.get(keys[v]);
        if (id === undefined) {
          id = part.pos.length / 3;
          part.ids.set(keys[v], id);
          const p = P[v];
          part.pos.push(p.x, p.y, p.z);
          // The normal points into the air: the way the density rises.
          // Four samples at the corners of a tetrahedron give the slope as well as six along the axes.
          const a = slopeOf(p.x + e, p.y - e, p.z - e), b = slopeOf(p.x - e, p.y - e, p.z + e), c = slopeOf(p.x - e, p.y + e, p.z - e), d = slopeOf(p.x + e, p.y + e, p.z + e);
          part.grad.push(a - b - c + d, -a - b + c + d, -a + b - c + d);
          part.face.push(0, 0, 0);
        }
        // Larger triangles count for more.
        part.face[id * 3] += F.x; part.face[id * 3 + 1] += F.y; part.face[id * 3 + 2] += F.z;
        ids[v] = id;
      }
      part.tris.push(ids[0], ids[2], ids[1]);
      triangles++;
    }
  }

  const p = new Vector3(), n = new Vector3(), fn = new Vector3();
  const field = new Float32Array(4);
  for (const [target, part] of parts) {
    const other = target === mesh ? null : target;
    const scale = other ? (typeof o.otherUvScale === 'function' ? o.otherUvScale(other) : o.otherUvScale ?? o.uvScale) : o.uvScale;
    const written = new Int32Array(part.pos.length / 3);
    for (let v = 0; v < written.length; v++) {
      p.set(part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2]);
      n.set(part.grad[v * 3], part.grad[v * 3 + 1], part.grad[v * 3 + 2]);
      fn.set(part.face[v * 3], part.face[v * 3 + 1], part.face[v * 3 + 2]).normalize();
      // Where the field's slope disagrees with the surface actually made, believe the surface.
      if (n.lengthSq() < 1e-12) n.copy(fn); else n.normalize();
      if (n.dot(fn) < 0.3) n.copy(fn);
      let open = 1;
      if (o.occlusion) {
        open = 0;
        for (const r of o.occlusion) open += Math.min(1, Math.max(0, feel(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r) / r));
        open /= o.occlusion.length;
      }
      field[0] = 0; field[1] = 0; field[2] = 0; field[3] = 0;
      const [r, g, b] = o.shade(p, n, field, other, open);
      // Laid on from above for ground; for rock, from the side it mostly faces.
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const top = !!other || (ay >= ax && ay >= az);
      const u = top ? p.x : ax >= az ? p.z : p.x, w = top ? p.z : p.y;
      written[v] = target.addVertex(p.x, p.y, p.z, n.x, n.y, n.z, u * scale, w * scale, r, g, b, field[0], field[1], field[2], field[3]);
      if (o.occlusion) target.setOpen(written[v], open);
    }
    for (let t = 0; t < part.tris.length; t += 3) target.addTriangle(written[part.tris[t]], written[part.tris[t + 1]], written[part.tris[t + 2]]);
  }
  return triangles;
}

/** A smooth minimum: like `Math.min`, but rounds the crease where the two meet. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** A smooth maximum: like `Math.max`, but rounds the edge where the two meet. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

// For each of a cell's twelve edges: the corner it starts from (as offsets) and the way it runs.
const CELL_EDGE = [
  [0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 1, 1, 0],
  [0, 0, 0, 1], [1, 0, 0, 1], [0, 0, 1, 1], [1, 0, 1, 1],
  [0, 0, 0, 2], [1, 0, 0, 2], [0, 1, 0, 2], [1, 1, 0, 2],
];

/**
 * Carves rock so that its edges stay sharp.
 *
 * `carveRock` puts the surface's points on the edges of the sampling cells, where the function
 * changes sign, and joins them; a corner inside a cell is cut straight across. Here each cell
 * that the surface passes through gets one point instead, placed where the surface's faces meet:
 * every crossing of the cell's edges gives a spot the surface goes through and the way it faces
 * there, each such pair is a plane, and the point is put where those planes come closest to
 * meeting. On a flat face that is anywhere on the face; on a crease it is on the crease; at a
 * corner it is the corner. Points of neighbouring cells are then joined across every edge the
 * surface crosses. (This is known as dual contouring.)
 *
 * Shading keeps the edges too: at each point the faces around it are gathered into groups that
 * lie within the crease angle of each other, and each group is shaded as one smooth surface.
 */
function carveSharp(mesh: MeshBuilder, density: Density, o: RockOptions): number {
  const cell = o.cell;
  // Land in pieces is sampled one cell beyond its edge, so that it can agree with its neighbours.
  const pad = o.beyond ? 1 : 0;
  const nx = Math.ceil((o.max.x - o.min.x) / cell - 1e-6) + 2 * pad;
  const ny = Math.ceil((o.max.y - o.min.y) / cell - 1e-6);
  const nz = Math.ceil((o.max.z - o.min.z) / cell - 1e-6) + 2 * pad;
  const ox = o.min.x - pad * cell, oy = o.min.y, oz = o.min.z - pad * cell;
  const sx = nx + 1, sy = ny + 1, layer = sx * sy;
  const values = new Float32Array(layer * (nz + 1));
  for (let k = 0; k <= nz; k++) for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    values[k * layer + j * sx + i] = density(ox + i * cell, oy + j * cell, oz + k * cell);
  }
  const sampled = (x: number, y: number, z: number): number => {
    const fx = Math.min(nx - 1e-4, Math.max(0, (x - ox) / cell)), fy = Math.min(ny - 1e-4, Math.max(0, (y - oy) / cell)), fz = Math.min(nz - 1e-4, Math.max(0, (z - oz) / cell));
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
    const at = k * layer + j * sx + i, up = at + sx, far = at + layer;
    const lo = values[at] + (values[at + 1] - values[at]) * tx + (values[up] - values[at] + (values[at] - values[at + 1] - values[up] + values[up + 1]) * tx) * ty;
    const hi = values[far] + (values[far + 1] - values[far]) * tx + (values[far + sx] - values[far] + (values[far] - values[far + 1] - values[far + sx] + values[far + sx + 1]) * tx) * ty;
    return lo + (hi - lo) * tz;
  };
  const feel: Density = o.fromSamples ? sampled : density;
  const stride = [1, sx, layer];
  const e = o.normalReach ?? 0.04;

  // Where the surface crosses an edge of the lattice, and which way it faces there.
  const crossings = new Map<number, number>();
  const cp: number[] = [], cn: number[] = [];
  const crossing = (node: number, axis: number, i: number, j: number, k: number): number => {
    const key = node * 3 + axis;
    let id = crossings.get(key);
    if (id !== undefined) return id;
    const a = values[node], b = values[node + stride[axis]];
    let t = a / (a - b);
    const at = (f: number) => density(ox + (i + (axis === 0 ? f : 0)) * cell, oy + (j + (axis === 1 ? f : 0)) * cell, oz + (k + (axis === 2 ? f : 0)) * cell);
    // The function is not straight between samples, least of all near an edge; one more look
    // puts the crossing much nearer where it truly is.
    const d = at(t);
    if (d !== 0) t = (d < 0) === (a < 0) ? t + ((1 - t) * d) / (d - b) : (t * a) / (a - d);
    t = Math.min(1, Math.max(0, t));
    const x = ox + (i + (axis === 0 ? t : 0)) * cell, y = oy + (j + (axis === 1 ? t : 0)) * cell, z = oz + (k + (axis === 2 ? t : 0)) * cell;
    const g0 = density(x + e, y - e, z - e), g1 = density(x - e, y - e, z + e), g2 = density(x - e, y + e, z - e), g3 = density(x + e, y + e, z + e);
    let gx = g0 - g1 - g2 + g3, gy = -g0 - g1 + g2 + g3, gz = -g0 + g1 - g2 + g3;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-9) { gx = axis === 0 ? Math.sign(b - a) : 0; gy = axis === 1 ? Math.sign(b - a) : 0; gz = axis === 2 ? Math.sign(b - a) : 0; } else { gx /= l; gy /= l; gz /= l; }
    id = cp.length / 3;
    cp.push(x, y, z);
    cn.push(gx, gy, gz);
    crossings.set(key, id);
    return id;
  };

  // One point for every cell the surface passes through.
  const points = new Map<number, number>();
  const pp: number[] = [];
  const found = new Int32Array(12);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const base = k * layer + j * sx + i;
    let rock = 0;
    if (values[base] < 0) rock++; if (values[base + 1] < 0) rock++; if (values[base + sx] < 0) rock++; if (values[base + sx + 1] < 0) rock++;
    if (values[base + layer] < 0) rock++; if (values[base + layer + 1] < 0) rock++; if (values[base + layer + sx] < 0) rock++; if (values[base + layer + sx + 1] < 0) rock++;
    if (rock === 0 || rock === 8) continue;
    let count = 0, mx = 0, my = 0, mz = 0;
    for (let q = 0; q < 12; q++) {
      const ed = CELL_EDGE[q], node = base + ed[0] + ed[1] * sx + ed[2] * layer;
      if ((values[node] < 0) === (values[node + stride[ed[3]]] < 0)) continue;
      const id = crossing(node, ed[3], i + ed[0], j + ed[1], k + ed[2]);
      found[count++] = id;
      mx += cp[id * 3]; my += cp[id * 3 + 1]; mz += cp[id * 3 + 2];
    }
    mx /= count; my /= count; mz /= count;
    // The point nearest to all the planes, measured from the middle of the crossings and held
    // lightly to it, so that where the planes leave it free (along a crease, or anywhere on a
    // flat face) it stays in the middle.
    let a00 = 0.1, a01 = 0, a02 = 0, a11 = 0.1, a12 = 0, a22 = 0.1, b0 = 0, b1 = 0, b2 = 0, sxn = 0, syn = 0, szn = 0;
    for (let q = 0; q < count; q++) {
      const id = found[q] * 3, nxq = cn[id], nyq = cn[id + 1], nzq = cn[id + 2];
      const dist = nxq * (cp[id] - mx) + nyq * (cp[id + 1] - my) + nzq * (cp[id + 2] - mz);
      a00 += nxq * nxq; a01 += nxq * nyq; a02 += nxq * nzq; a11 += nyq * nyq; a12 += nyq * nzq; a22 += nzq * nzq;
      b0 += nxq * dist; b1 += nyq * dist; b2 += nzq * dist;
      sxn += nxq; syn += nyq; szn += nzq;
    }
    const c00 = a11 * a22 - a12 * a12, c01 = a02 * a12 - a01 * a22, c02 = a01 * a12 - a02 * a11;
    const det = a00 * c00 + a01 * c01 + a02 * c02;
    let px = mx, py = my, pz = mz;
    if (Math.abs(det) > 1e-9) {
      px += (c00 * b0 + c01 * b1 + c02 * b2) / det;
      py += (c01 * b0 + (a00 * a22 - a02 * a02) * b1 + (a01 * a02 - a00 * a12) * b2) / det;
      pz += (c02 * b0 + (a01 * a02 - a00 * a12) * b1 + (a00 * a11 - a01 * a01) * b2) / det;
    }
    // It may not leave its cell, or the surface could fold over itself.
    px = Math.min(ox + (i + 1) * cell, Math.max(ox + i * cell, px));
    py = Math.min(oy + (j + 1) * cell, Math.max(oy + j * cell, py));
    pz = Math.min(oz + (k + 1) * cell, Math.max(oz + k * cell, pz));
    // A cell beyond the edge of this piece, with no other piece there to answer for it, has its
    // point brought back onto the edge, sliding along the ground as it lies there.
    if (pad && (i === 0 || i === nx - 1 || k === 0 || k === nz - 1) && !o.beyond!(ox + (i + 0.5) * cell, oz + (k + 0.5) * cell)) {
      const tx = Math.min(o.max.x, Math.max(o.min.x, px)), tz = Math.min(o.max.z, Math.max(o.min.z, pz));
      const nl = Math.hypot(sxn, syn, szn) || 1;
      if (Math.abs(syn / nl) > 0.3) py -= (sxn * (tx - px) + szn * (tz - pz)) / syn;
      px = tx; pz = tz;
    }
    points.set((k * ny + j) * nx + i, pp.length / 3);
    pp.push(px, py, pz);
  }

  // Faces: across every edge the surface crosses, the points of the four cells round it are joined.
  const fv: number[] = [], fn: number[] = [], fa: number[] = [];
  const targets: MeshBuilder[] = [];
  const A = new Vector3(), B = new Vector3(), F = new Vector3(), C = new Vector3();
  const quad = [0, 0, 0, 0];
  const lowX = pad, highX = nx - pad, lowZ = pad, highZ = nz - pad;
  // Whether this piece is the one to make the faces round an edge. An edge on the far side of the
  // piece belongs to the neighbour there, if there is one.
  const owns = (index: number, low: number, high: number, along: boolean, x: number, z: number): boolean => {
    if (!pad) return true;
    if (index < low || index > high) return false;
    if (index < high) return true;
    return !along && !o.beyond!(x, z);
  };
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const node = k * layer + j * sx + i, here = values[node] < 0;
    for (let axis = 0; axis < 3; axis++) {
      if ((axis === 0 ? i : axis === 1 ? j : k) >= (axis === 0 ? nx : axis === 1 ? ny : nz)) continue;
      if ((values[node + stride[axis]] < 0) === here) continue;
      const wx = ox + i * cell, wz = oz + k * cell;
      if (!owns(i, lowX, highX, axis === 0, wx + cell * 0.5, wz + (axis === 2 ? cell * 0.5 : 0)) || !owns(k, lowZ, highZ, axis === 2, wx + (axis === 0 ? cell * 0.5 : 0), wz + cell * 0.5)) continue;
      // The four cells that share this edge, in order round it.
      let ok = true;
      for (let q = 0; q < 4 && ok; q++) {
        const u = q === 1 || q === 2 ? 0 : -1, v = q >= 2 ? 0 : -1;
        const ci = axis === 0 ? i : i + u, cj = axis === 1 ? j : axis === 0 ? j + u : j + v, ck = axis === 2 ? k : k + v;
        const id = ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz ? undefined : points.get((ck * ny + cj) * nx + ci);
        if (id === undefined) ok = false; else quad[q] = id;
      }
      if (!ok) continue;
      const far = (a: number, b: number) => Math.hypot(pp[a * 3] - pp[b * 3], pp[a * 3 + 1] - pp[b * 3 + 1], pp[a * 3 + 2] - pp[b * 3 + 2]);
      const split = far(quad[0], quad[2]) <= far(quad[1], quad[3]) ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
      for (let t = 0; t < 6; t += 3) {
        let a = quad[split[t]], b = quad[split[t + 1]];
        const c = quad[split[t + 2]];
        A.set(pp[b * 3] - pp[a * 3], pp[b * 3 + 1] - pp[a * 3 + 1], pp[b * 3 + 2] - pp[a * 3 + 2]);
        B.set(pp[c * 3] - pp[a * 3], pp[c * 3 + 1] - pp[a * 3 + 1], pp[c * 3 + 2] - pp[a * 3 + 2]);
        F.crossVectors(A, B);
        const area = F.length();
        if (area < 1e-8) continue;
        // It must face the air: along the edge, away from whichever end is in rock.
        const along = axis === 0 ? F.x : axis === 1 ? F.y : F.z;
        if (along > 0 !== here) { const swap = a; a = b; b = swap; F.negate(); }
        F.multiplyScalar(1 / area);
        C.set((pp[a * 3] + pp[b * 3] + pp[c * 3]) / 3, (pp[a * 3 + 1] + pp[b * 3 + 1] + pp[c * 3 + 1]) / 3, (pp[a * 3 + 2] + pp[b * 3 + 2] + pp[c * 3 + 2]) / 3);
        if (o.keep && !o.keep(C)) continue;
        targets.push((o.meshFor && o.meshFor(F, C)) || mesh);
        fv.push(a, b, c);
        fn.push(F.x, F.y, F.z);
        fa.push(area);
      }
    }
  }

  // For each point, the faces that meet at it.
  const faces = fa.length, pointCount = pp.length / 3;
  const first = new Int32Array(pointCount + 1);
  for (let q = 0; q < fv.length; q++) first[fv[q] + 1]++;
  for (let q = 0; q < pointCount; q++) first[q + 1] += first[q];
  const round = new Int32Array(fv.length), filled = new Int32Array(pointCount);
  for (let f = 0; f < faces; f++) for (let c = 0; c < 3; c++) { const v = fv[f * 3 + c]; round[first[v] + filled[v]++] = f; }

  // Written out: a point is written once for each group of faces round it that shade together.
  const limit = Math.cos(((o.crease ?? 36) * Math.PI) / 180);
  const written = new Map<MeshBuilder, Map<number, number[]>>();
  const p = new Vector3(), n = new Vector3();
  const field = new Float32Array(4);
  const corner = [0, 0, 0];
  for (let f = 0; f < faces; f++) {
    const target = targets[f], other = target === mesh ? null : target;
    let byPoint = written.get(target);
    if (!byPoint) written.set(target, (byPoint = new Map()));
    const fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = fv[f * 3 + c];
      n.set(0, 0, 0);
      for (let q = first[v]; q < first[v + 1]; q++) {
        const g = round[q];
        if (fn[g * 3] * fx + fn[g * 3 + 1] * fy + fn[g * 3 + 2] * fz >= limit) { n.x += fn[g * 3] * fa[g]; n.y += fn[g * 3 + 1] * fa[g]; n.z += fn[g * 3 + 2] * fa[g]; }
      }
      n.normalize();
      let list = byPoint.get(v);
      if (!list) byPoint.set(v, (list = []));
      let id = -1;
      for (let q = 0; q < list.length; q += 4) if (list[q] * n.x + list[q + 1] * n.y + list[q + 2] * n.z > 0.995) { id = list[q + 3]; break; }
      if (id < 0) {
        p.set(pp[v * 3], pp[v * 3 + 1], pp[v * 3 + 2]);
        let open = 1;
        if (o.occlusion) {
          open = 0;
          for (const r of o.occlusion) open += Math.min(1, Math.max(0, feel(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r) / r));
          open /= o.occlusion.length;
        }
        field[0] = 0; field[1] = 0; field[2] = 0; field[3] = 0;
        const [r, g, b] = o.shade(p, n, field, other, open);
        const scale = other ? (typeof o.otherUvScale === 'function' ? o.otherUvScale(other) : o.otherUvScale ?? o.uvScale) : o.uvScale;
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        const top = !!other || (ay >= ax && ay >= az);
        const u = top ? p.x : ax >= az ? p.z : p.x, w = top ? p.z : p.y;
        id = target.addVertex(p.x, p.y, p.z, n.x, n.y, n.z, u * scale, w * scale, r, g, b, field[0], field[1], field[2], field[3]);
        if (o.occlusion) target.setOpen(id, open);
        list.push(n.x, n.y, n.z, id);
      }
      corner[c] = id;
    }
    target.addTriangle(corner[0], corner[1], corner[2]);
  }
  return faces;
}
