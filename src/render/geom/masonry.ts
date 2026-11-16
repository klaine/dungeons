import { Vector3 } from 'three';
import { Rng, valueNoise2 } from '../../core/rng';
import { MeshBuilder } from './meshBuilder';

/**
 * Lays individually modelled blocks on a surface.
 *
 * A surface maps (u, v) in metres to a point and a normal. Courses run along u and stack along v.
 * Every block is real geometry: a face that sits slightly proud, a bevelled edge, and a recessed
 * mortar strip. Fine grain is left to the normal map; everything that should cast a shadow or
 * catch a highlight on its edge is modelled.
 */
export type Surface = (u: number, v: number, p: Vector3, n: Vector3) => void;

export type RGB = readonly [number, number, number];

export interface MasonryStyle {
  /** Course height range along v. */
  course: readonly [number, number];
  /** Block length range along u. */
  length: readonly [number, number];
  /** Width of the mortar strip on each side of a block. */
  joint: number;
  /** Width of the bevel between mortar and face. */
  bevel: number;
  /** How far the mortar is recessed behind the surface. */
  depth: number;
  /** Largest amount a block face stands proud of the surface. */
  proud: number;
  /** Amplitude of slow undulation across a face. */
  relief: number;
  /** Longest face segment; smaller values follow curves better and carry baked light more finely. */
  maxSeg: number;
  /** Probability that a corner is chipped. */
  chip: number;
  tint: RGB;
  tintVar: number;
  hueVar: number;
  mortar: RGB;
  /** Texture repeats per metre. */
  uvScale: number;
}

export interface PatchOptions {
  u0: number; u1: number; v0: number; v1: number;
  style: MasonryStyle;
  rng: Rng;
  /** Edges that end at a convex corner: the block runs to the edge with an eased arris and no joint. */
  open?: { u0?: boolean; u1?: boolean; v0?: boolean; v1?: boolean };
  /** Return false to drop a block, given its extent. */
  keep?: (bu0: number, bv0: number, bu1: number, bv1: number) => boolean;
  /** Moves a vertex in surface coordinates, for example out from under an opening. */
  clampUV?: (uv: [number, number]) => void;
  /** True where the surface is cut away. Triangles touching such a point are left out. */
  hole?: (u: number, v: number) => boolean;
  /** Writes moss, wet and soot (channels 0 to 2) and returns a brightness multiplier. */
  field?: (p: Vector3, n: Vector3, out: Float32Array) => number;
  /** Patches that share a key, v0 and v1 get identical courses, so joints line up round corners. */
  courseKey?: string;
  /** Patches that share a key and u extent get identical block splits. */
  splitKey?: string;
  /** Lay one course across the whole of v. */
  singleCourse?: boolean;
  /** Push the outermost vertices this far behind the surface to close gaps at a raised patch's rim. */
  skirt?: number;
  /** Shift applied to all faces along the normal. */
  raise?: number;
}

const P = new Vector3();
const N = new Vector3();
const A = new Vector3();
const B = new Vector3();
const C = new Vector3();
const fieldOut = new Float32Array(4);

function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function splitRange(lo: number, hi: number, range: readonly [number, number], rng: Rng): number[] {
  const out = [lo];
  let x = lo;
  const span = hi - lo;
  if (span <= range[1]) return [lo, hi];
  for (;;) {
    const step = rng.range(range[0], range[1]);
    if (x + step > hi - range[0] * 0.6) break;
    x += step;
    out.push(x);
  }
  out.push(hi);
  return out;
}

/**
 * Whether a triangle next to a hole should be left out. Vertices inside a hole are moved to its
 * edge, so most such triangles simply end there. Two cases must go: one whose corners were all
 * inside, which collapses to nothing; and one whose corners were moved to opposite sides of the
 * hole, which would stretch across it.
 */
function acrossHole(flag: ArrayLike<number | boolean>, before: Float32Array, after: Float32Array, a: number, b: number, c: number): boolean {
  if (!flag[a] && !flag[b] && !flag[c]) return false;
  if (flag[a] && flag[b] && flag[c]) return true;
  const stretched = (i: number, j: number) => {
    if (!flag[i] && !flag[j]) return false;
    const was = Math.hypot(before[i * 2] - before[j * 2], before[i * 2 + 1] - before[j * 2 + 1]);
    const now = Math.hypot(after[i * 2] - after[j * 2], after[i * 2 + 1] - after[j * 2 + 1]);
    return now > was * 1.7 + 0.06;
  };
  return stretched(a, b) || stretched(b, c) || stretched(a, c);
}

function axisCoords(a: number, b: number, joint: number, bevel: number, maxSeg: number, openA: boolean, openB: boolean): number[] {
  const insetA = openA ? bevel : joint + bevel;
  const insetB = openB ? bevel : joint + bevel;
  const ia = a + insetA;
  const ib = b - insetB;
  if (ib - ia < 0.004) return [a, (a + b) / 2, b];
  const out = [a];
  if (!openA) out.push(a + joint);
  out.push(ia);
  const n = Math.max(1, Math.ceil((ib - ia) / maxSeg));
  for (let k = 1; k < n; k++) out.push(ia + ((ib - ia) * k) / n);
  out.push(ib);
  if (!openB) out.push(b - joint);
  out.push(b);
  return out;
}

export function layMasonry(mesh: MeshBuilder, surface: Surface, opts: PatchOptions): number {
  const { u0, u1, v0, v1, style: s, rng } = opts;
  const open = opts.open ?? {};
  const raise = opts.raise ?? 0;
  const noiseSeed = rng.int(0, 1 << 20);
  const courseRng = opts.courseKey ? new Rng(`course/${opts.courseKey}/${v0.toFixed(3)}/${v1.toFixed(3)}`) : rng;
  const splitRng = opts.splitKey ? new Rng(`split/${opts.splitKey}`) : null;

  const vs = opts.singleCourse ? [v0, v1] : splitRange(v0, v1, s.course, courseRng);
  let blocks = 0;
  const eps = 1e-5;
  const uv: [number, number] = [0, 0];

  for (let ci = 0; ci < vs.length - 1; ci++) {
    const bv0 = vs[ci];
    const bv1 = vs[ci + 1];
    const us = splitRange(u0, u1, s.length, splitRng ?? rng);
    for (let bi = 0; bi < us.length - 1; bi++) {
      const bu0 = us[bi];
      const bu1 = us[bi + 1];
      // Draw the same random numbers whether or not the block is kept, so filters do not reshuffle neighbours.
      const proud = rng.range(0, s.proud);
      const tiltU = rng.range(-0.5, 0.5) * s.proud;
      const tiltV = rng.range(-0.5, 0.5) * s.proud;
      const lum = 1 + (rng.next() - 0.5) * 2 * s.tintVar;
      const hue = (rng.next() - 0.5) * 2 * s.hueVar;
      const uvOffU = rng.next() * 7;
      const uvOffV = rng.next() * 7;
      const chips = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) chips[k] = rng.chance(s.chip) ? rng.range(0.03, 0.09) : 0;
      if (opts.keep && !opts.keep(bu0, bv0, bu1, bv1)) continue;

      const oU0 = !!open.u0 && bu0 - u0 < eps;
      const oU1 = !!open.u1 && u1 - bu1 < eps;
      const oV0 = !!open.v0 && bv0 - v0 < eps;
      const oV1 = !!open.v1 && v1 - bv1 < eps;
      const cu = axisCoords(bu0, bu1, s.joint, s.bevel, s.maxSeg, oU0, oU1);
      const cv = axisCoords(bv0, bv1, s.joint, s.bevel, s.maxSeg, oV0, oV1);
      const nu = cu.length;
      const nv = cv.length;
      const br = s.tint[0] * lum * (1 + hue);
      const bg = s.tint[1] * lum;
      const bb = s.tint[2] * lum * (1 - hue);

      const px = new Float32Array(nu * nv * 3);
      const sn = new Float32Array(nu * nv * 3);
      const mort = new Float32Array(nu * nv);
      const rises = new Float32Array(nu * nv);
      const uvs = new Float32Array(nu * nv * 2);
      const holed = opts.hole ? new Uint8Array(nu * nv) : null;
      const uvBefore = new Float32Array(nu * nv * 2);
      const uvAfter = new Float32Array(nu * nv * 2);

      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const u = cu[i];
          const v = cv[j];
          const dU0 = u - bu0, dU1 = bu1 - u, dV0 = v - bv0, dV1 = bv1 - v;
          let rise = 1;
          let sink = 0;
          const edge = (d: number, isOpen: boolean) => {
            if (isOpen) {
              rise = Math.min(rise, smoothstep(0, s.bevel, d));
            } else {
              rise = Math.min(rise, smoothstep(s.joint, s.joint + s.bevel, d));
              sink = Math.max(sink, 1 - smoothstep(s.joint * 0.6, s.joint + s.bevel * 0.7, d));
            }
          };
          edge(dU0, oU0); edge(dU1, oU1); edge(dV0, oV0); edge(dV1, oV1);

          let face = proud + tiltU * ((u - bu0) / (bu1 - bu0) - 0.5) + tiltV * ((v - bv0) / (bv1 - bv0) - 0.5);
          face += (valueNoise2(u * 5.1, v * 5.1, noiseSeed) - 0.5) * 2 * s.relief;
          if (chips[0]) face -= chips[0] * 0.5 * smoothstep(chips[0], 0, Math.hypot(dU0, dV0));
          if (chips[1]) face -= chips[1] * 0.5 * smoothstep(chips[1], 0, Math.hypot(dU1, dV0));
          if (chips[2]) face -= chips[2] * 0.5 * smoothstep(chips[2], 0, Math.hypot(dU0, dV1));
          if (chips[3]) face -= chips[3] * 0.5 * smoothstep(chips[3], 0, Math.hypot(dU1, dV1));
          let h = rise * Math.max(face, -s.depth) - sink * s.depth + raise;
          if (opts.skirt !== undefined) {
            const rim = (!open.u0 && u - u0 < eps) || (!open.u1 && u1 - u < eps)
              || (!open.v0 && v - v0 < eps) || (!open.v1 && v1 - v < eps);
            if (rim) h = -opts.skirt;
          }

          uv[0] = u; uv[1] = v;
          if (holed && opts.hole!(u, v)) holed[j * nu + i] = 1;
          if (opts.clampUV) opts.clampUV(uv);
          uvBefore[(j * nu + i) * 2] = u; uvBefore[(j * nu + i) * 2 + 1] = v;
          uvAfter[(j * nu + i) * 2] = uv[0]; uvAfter[(j * nu + i) * 2 + 1] = uv[1];
          surface(uv[0], uv[1], P, N);
          const k = (j * nu + i) * 3;
          px[k] = P.x + N.x * h; px[k + 1] = P.y + N.y * h; px[k + 2] = P.z + N.z * h;
          sn[k] = N.x; sn[k + 1] = N.y; sn[k + 2] = N.z;
          mort[j * nu + i] = sink;
          rises[j * nu + i] = rise;
          uvs[(j * nu + i) * 2] = u * s.uvScale + uvOffU;
          uvs[(j * nu + i) * 2 + 1] = v * s.uvScale + uvOffV;
        }
      }

      const backingStart = mesh.vertexCount;
      // Backing: a plain sheet just behind the mortar, slightly larger than the block. Neighbouring
      // blocks do not share vertices, so without it single pixels of whatever lies behind show
      // through along joints and at corners.
      {
        const grow = 0.004;
        const back = raise - s.depth - 0.006;
        surface(bu0, (bv0 + bv1) / 2, A, N);
        surface(bu1, (bv0 + bv1) / 2, B, C);
        const suCurve = Math.min(8, Math.max(1, Math.ceil(Math.acos(Math.min(1, N.dot(C))) / 0.07)));
        surface((bu0 + bu1) / 2, bv0, A, N);
        surface((bu0 + bu1) / 2, bv1, B, C);
        let sv = Math.min(8, Math.max(1, Math.ceil(Math.acos(Math.min(1, N.dot(C))) / 0.07)));
        let su2 = suCurve;
        // Near a hole the sheet needs enough vertices to stop short of it.
        let nearHole = false;
        if (opts.hole) {
          for (let j = 0; j <= 4 && !nearHole; j++) for (let i = 0; i <= 4; i++) {
            if (opts.hole(bu0 + ((bu1 - bu0) * i) / 4, bv0 + ((bv1 - bv0) * j) / 4)) { nearHole = true; break; }
          }
          if (nearHole) {
            su2 = Math.max(su2, Math.ceil((bu1 - bu0) / 0.1));
            sv = Math.max(sv, Math.ceil((bv1 - bv0) / 0.1));
          }
        }
        const su = su2;
        const holeFlags: boolean[] = [];
        const backBefore = new Float32Array((su + 1) * (sv + 1) * 2);
        const backAfter = new Float32Array((su + 1) * (sv + 1) * 2);
        const b0 = mesh.vertexCount;
        for (let j = 0; j <= sv; j++) {
          for (let i = 0; i <= su; i++) {
            uv[0] = bu0 - grow + ((bu1 - bu0 + 2 * grow) * i) / su;
            uv[1] = bv0 - grow + ((bv1 - bv0 + 2 * grow) * j) / sv;
            holeFlags.push(nearHole && opts.hole!(uv[0], uv[1]));
            backBefore[(j * (su + 1) + i) * 2] = uv[0]; backBefore[(j * (su + 1) + i) * 2 + 1] = uv[1];
            if (opts.clampUV) opts.clampUV(uv);
            backAfter[(j * (su + 1) + i) * 2] = uv[0]; backAfter[(j * (su + 1) + i) * 2 + 1] = uv[1];
            surface(uv[0], uv[1], P, N);
            P.addScaledVector(N, back);
            fieldOut[0] = 0; fieldOut[1] = 0; fieldOut[2] = 0;
            const tone = (opts.field ? opts.field(P, N, fieldOut) : 1) * 0.7;
            mesh.addVertex(P.x, P.y, P.z, N.x, N.y, N.z, uv[0] * s.uvScale, uv[1] * s.uvScale,
              s.mortar[0] * tone, s.mortar[1] * tone, s.mortar[2] * tone, 0, fieldOut[1], fieldOut[2], 1);
          }
        }
        surface((bu0 + bu1) / 2, (bv0 + bv1) / 2, P, N);
        surface((bu0 + bu1) / 2 + 0.01, (bv0 + bv1) / 2, A, C);
        surface((bu0 + bu1) / 2, (bv0 + bv1) / 2 + 0.01, B, C);
        A.sub(P); B.sub(P);
        const backFlip = C.crossVectors(A, B).dot(N) < 0;
        for (let j = 0; j < sv; j++) {
          for (let i = 0; i < su; i++) {
            const a = b0 + j * (su + 1) + i, b = a + 1, c = a + su + 1, d = c + 1;
            const skip1 = acrossHole(holeFlags, backBefore, backAfter, a - b0, b - b0, c - b0);
            const skip2 = acrossHole(holeFlags, backBefore, backAfter, b - b0, d - b0, c - b0);
            if (backFlip) { if (!skip1) mesh.addTriangle(a, c, b); if (!skip2) mesh.addTriangle(b, c, d); }
            else { if (!skip1) mesh.addTriangle(a, b, c); if (!skip2) mesh.addTriangle(b, d, c); }
          }
        }
      }

      // Orientation: make triangle winding and shading normals agree with the surface normal.
      const mid = (Math.floor(nv / 2) * nu + Math.floor(nu / 2)) * 3;
      const iu = (Math.floor(nv / 2) * nu + Math.min(nu - 1, Math.floor(nu / 2) + 1)) * 3;
      const iv = (Math.min(nv - 1, Math.floor(nv / 2) + 1) * nu + Math.floor(nu / 2)) * 3;
      A.set(px[iu] - px[mid], px[iu + 1] - px[mid + 1], px[iu + 2] - px[mid + 2]);
      B.set(px[iv] - px[mid], px[iv + 1] - px[mid + 1], px[iv + 2] - px[mid + 2]);
      C.crossVectors(A, B);
      const flip = C.x * sn[mid] + C.y * sn[mid + 1] + C.z * sn[mid + 2] < 0;

      const base = mesh.vertexCount;
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const k = (j * nu + i) * 3;
          const il = (j * nu + Math.max(0, i - 1)) * 3;
          const ir = (j * nu + Math.min(nu - 1, i + 1)) * 3;
          const jd = (Math.max(0, j - 1) * nu + i) * 3;
          const ju = (Math.min(nv - 1, j + 1) * nu + i) * 3;
          A.set(px[ir] - px[il], px[ir + 1] - px[il + 1], px[ir + 2] - px[il + 2]);
          B.set(px[ju] - px[jd], px[ju + 1] - px[jd + 1], px[ju + 2] - px[jd + 2]);
          C.crossVectors(A, B);
          if (flip) C.negate();
          const len = C.length();
          if (len < 1e-9) C.set(sn[k], sn[k + 1], sn[k + 2]);
          else C.multiplyScalar(1 / len);

          P.set(px[k], px[k + 1], px[k + 2]);
          N.set(sn[k], sn[k + 1], sn[k + 2]);
          fieldOut[0] = 0; fieldOut[1] = 0; fieldOut[2] = 0;
          const tone = opts.field ? opts.field(P, N, fieldOut) : 1;
          const m = mort[j * nu + i];
          mesh.addVertex(
            px[k], px[k + 1], px[k + 2],
            C.x, C.y, C.z,
            uvs[(j * nu + i) * 2], uvs[(j * nu + i) * 2 + 1],
            (br + (s.mortar[0] - br) * m) * tone,
            (bg + (s.mortar[1] - bg) * m) * tone,
            (bb + (s.mortar[2] - bb) * m) * tone,
            fieldOut[0], fieldOut[1], fieldOut[2], m,
          );
        }
      }
      for (let j = 0; j < nv - 1; j++) {
        for (let i = 0; i < nu - 1; i++) {
          const a = base + j * nu + i;
          const b = a + 1;
          const c = a + nu;
          const d = c + 1;
          const skip1 = holed !== null && acrossHole(holed, uvBefore, uvAfter, a - base, b - base, c - base);
          const skip2 = holed !== null && acrossHole(holed, uvBefore, uvAfter, b - base, d - base, c - base);
          if (flip) {
            if (!skip1) mesh.addTriangle(a, c, b);
            if (!skip2) mesh.addTriangle(b, c, d);
          } else {
            if (!skip1) mesh.addTriangle(a, b, c);
            if (!skip2) mesh.addTriangle(b, d, c);
          }
        }
      }
      // Baked light is traced only for the vertices on the stone's face. Its bevel, its mortar
      // edge and its backing sheet copy from the nearest of those, darkened towards the joint.
      {
        const carriers: number[] = [];
        let best = 0;
        for (let k = 0; k < nu * nv; k++) {
          if (rises[k] > 0.999) carriers.push(k);
          if (rises[k] > rises[best]) best = k;
        }
        if (!carriers.length) carriers.push(best);
        const isCarrier = new Uint8Array(nu * nv);
        for (const k of carriers) isCarrier[k] = 1;
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu; i++) {
            const k = j * nu + i;
            if (isCarrier[k]) continue;
            let near = carriers[0], nearD = Infinity;
            for (const c of carriers) {
              const di = (c % nu) - i, dj = Math.floor(c / nu) - j;
              const d = di * di + dj * dj;
              if (d < nearD) { nearD = d; near = c; }
            }
            mesh.setBakeSource(base + k, base + near, 1 - 0.5 * mort[k]);
          }
        }
        for (let v = backingStart; v < base; v++) mesh.setBakeSource(v, base + carriers[0], 0.35);
      }
      blocks++;
    }
  }
  return blocks;
}
