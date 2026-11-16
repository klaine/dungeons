/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { BakeLights } from './bake';

/**
 * Light baking worker. Holds its own copy of the site geometry in a BVH and answers two requests:
 * direct light at a range of vertices, and one gather of incoming light over the hemisphere.
 */

let pos: Float32Array;
let nrm: Float32Array;
let bvh: MeshBVH;
let lights: BakeLights;
/** Triangles whose vertices start at or after this index belong to solid masses. */
let firstMassVertex = Infinity;
/** The vertices that are traced. Requests give ranges into this list. */
let carriers: Uint32Array;

const ray = new Ray();
const O = new Vector3();
const D = new Vector3();
const T = new Vector3();
const B = new Vector3();
const Nn = new Vector3();
const EPS = 0.004;

function frac(x: number): number {
  return x - Math.floor(x);
}

function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function sky(dx: number, dy: number, dz: number, out: Float32Array): void {
  const s = lights.sky;
  if (dy <= 0) {
    out[0] = s.ground[0]; out[1] = s.ground[1]; out[2] = s.ground[2];
    return;
  }
  const t = Math.pow(dy, 0.45);
  out[0] = s.horizon[0] + (s.zenith[0] - s.horizon[0]) * t;
  out[1] = s.horizon[1] + (s.zenith[1] - s.horizon[1]) * t;
  out[2] = s.horizon[2] + (s.zenith[2] - s.horizon[2]) * t;
  void dx; void dz;
}

function occluded(far: number): boolean {
  return bvh.raycastFirst(ray, DoubleSide, 0, far) !== null;
}

function direct(start: number, end: number, salt: number) {
  const n = end - start;
  const E = new Float32Array(n * 3);
  const sunVis = new Float32Array(n);
  // Direct light to be kept in the result, in the same form as gathered light: a constant and a direction.
  const kept = new Float32Array(n * 12);
  const sd = lights.sunDir;
  // Sun positions across a day, east to west through the south, for how much sun a spot gets.
  const DAY = 7;
  const day: number[][] = [];
  for (let k = 0; k < DAY; k++) {
    const phi = ((k + 0.5) / DAY) * Math.PI;
    const el = (14 + 36 * Math.sin(phi)) * (Math.PI / 180);
    day.push([Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)]);
  }
  for (let slot = start; slot < end; slot++) {
    const i = carriers[slot];
    const k = i * 3;
    const nx = nrm[k], ny = nrm[k + 1], nz = nrm[k + 2];
    O.set(pos[k] + nx * EPS, pos[k + 1] + ny * EPS, pos[k + 2] + nz * EPS);
    let r = 0, g = 0, b = 0;

    // Sun, jittered over a small disc so shadow edges soften after smoothing.
    const jx = (hash(i, salt) - 0.5) * 0.04, jy = (hash(i, salt + 1) - 0.5) * 0.04, jz = (hash(i, salt + 2) - 0.5) * 0.04;
    D.set(sd[0] + jx, sd[1] + jy, sd[2] + jz).normalize();
    ray.origin.copy(O);
    ray.direction.copy(D);
    const sunSeen = !occluded(Infinity);
    let hours = 0;
    for (let k = 0; k < DAY; k++) {
      ray.direction.set(day[k][0], day[k][1], day[k][2]);
      if (!occluded(Infinity)) hours++;
    }
    sunVis[slot - start] = hours / DAY;
    const ndl = nx * D.x + ny * D.y + nz * D.z;
    if (sunSeen && ndl > 0) {
      r += lights.sunE[0] * ndl; g += lights.sunE[1] * ndl; b += lights.sunE[2] * ndl;
    }

    for (const L of lights.points) {
      const lx = L.pos[0] + (hash(i, salt + 3) - 0.5) * L.size;
      const ly = L.pos[1] + (hash(i, salt + 4) - 0.5) * L.size;
      const lz = L.pos[2] + (hash(i, salt + 5) - 0.5) * L.size;
      D.set(lx - O.x, ly - O.y, lz - O.z);
      const d2 = D.lengthSq();
      if (d2 > L.range * L.range) continue;
      const d = Math.sqrt(d2);
      D.multiplyScalar(1 / d);
      const nl = nx * D.x + ny * D.y + nz * D.z;
      if (nl <= (L.keep ? -0.3 : 0)) continue;
      ray.origin.copy(O);
      ray.direction.copy(D);
      if (occluded(d - 0.02)) continue;
      const fall = 1 / Math.max(d2, 0.04);
      if (L.keep) {
        // A light from one direction, as constant plus direction: 1/4 + 1/2 cos fits a clamped cosine.
        const ko = (slot - start) * 12;
        for (let c = 0; c < 3; c++) {
          const s = L.intensity[c] * fall;
          kept[ko + c * 4] += 0.25 * s;
          kept[ko + c * 4 + 1] += 0.5 * s * D.x; kept[ko + c * 4 + 2] += 0.5 * s * D.y; kept[ko + c * 4 + 3] += 0.5 * s * D.z;
        }
      }
      if (nl <= 0) continue;
      const a = nl * fall;
      r += L.intensity[0] * a; g += L.intensity[1] * a; b += L.intensity[2] * a;
    }
    const o = (slot - start) * 3;
    E[o] = r; E[o + 1] = g; E[o + 2] = b;
  }
  return { E, sunVis, kept };
}

const skyOut = new Float32Array(3);
const G = 1.32471795724474602596;
const A1 = 1 / G;
const A2 = 1 / (G * G);

function gather(start: number, end: number, radiosity: Float32Array, rays: number, salt: number) {
  const n = end - start;
  const sh = new Float32Array(n * 12);
  const skyVis = new Float32Array(n);
  const valid = new Uint8Array(n);
  for (let slot = start; slot < end; slot++) {
    const i = carriers[slot];
    const k = i * 3;
    Nn.set(nrm[k], nrm[k + 1], nrm[k + 2]);
    O.set(pos[k] + Nn.x * EPS, pos[k + 1] + Nn.y * EPS, pos[k + 2] + Nn.z * EPS);
    if (Math.abs(Nn.y) < 0.9) T.set(0, 1, 0); else T.set(1, 0, 0);
    T.cross(Nn).normalize();
    B.crossVectors(Nn, T);
    const r1 = hash(i, salt), r2 = hash(i, salt + 7);
    let sR = 0, sG = 0, sB = 0;
    let dRx = 0, dRy = 0, dRz = 0, dGx = 0, dGy = 0, dGz = 0, dBx = 0, dBy = 0, dBz = 0;
    let skyCount = 0, backCount = 0;
    for (let s = 0; s < rays; s++) {
      // Uniform over the hemisphere: low-discrepancy points, rotated per vertex.
      const z = frac(r1 + (s + 0.5) * A1);
      const phi = 2 * Math.PI * frac(r2 + (s + 0.5) * A2);
      const sinT = Math.sqrt(Math.max(0, 1 - z * z));
      const cx = sinT * Math.cos(phi), cy = sinT * Math.sin(phi);
      D.set(T.x * cx + B.x * cy + Nn.x * z, T.y * cx + B.y * cy + Nn.y * z, T.z * cx + B.z * cy + Nn.z * z);
      ray.origin.copy(O);
      ray.direction.copy(D);
      const hit = bvh.raycastFirst(ray, DoubleSide);
      let lr = 0, lg = 0, lb = 0;
      if (!hit) {
        sky(D.x, D.y, D.z, skyOut);
        lr = skyOut[0]; lg = skyOut[1]; lb = skyOut[2];
        if (D.y > 0) skyCount++;
      } else {
        const f = hit.face!;
        // Seeing the back of a surface, or bare solid mass, means this vertex is buried.
        if (f.a >= firstMassVertex || f.normal.x * D.x + f.normal.y * D.y + f.normal.z * D.z > 0) {
          backCount++;
        } else {
          // Interpolate outgoing light across the hit triangle.
          const a = f.a * 3, b = f.b * 3, c = f.c * 3;
          const p = hit.point;
          const v0x = pos[b] - pos[a], v0y = pos[b + 1] - pos[a + 1], v0z = pos[b + 2] - pos[a + 2];
          const v1x = pos[c] - pos[a], v1y = pos[c + 1] - pos[a + 1], v1z = pos[c + 2] - pos[a + 2];
          const v2x = p.x - pos[a], v2y = p.y - pos[a + 1], v2z = p.z - pos[a + 2];
          const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
          const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
          const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
          const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
          const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
          const den = d00 * d11 - d01 * d01;
          let wb = 1 / 3, wc = 1 / 3;
          if (den > 1e-14) {
            wb = Math.min(1, Math.max(0, (d11 * d20 - d01 * d21) / den));
            wc = Math.min(1, Math.max(0, (d00 * d21 - d01 * d20) / den));
          }
          const wa = Math.max(0, 1 - wb - wc);
          lr = radiosity[a] * wa + radiosity[b] * wb + radiosity[c] * wc;
          lg = radiosity[a + 1] * wa + radiosity[b + 1] * wb + radiosity[c + 1] * wc;
          lb = radiosity[a + 2] * wa + radiosity[b + 2] * wb + radiosity[c + 2] * wc;
        }
      }
      sR += lr; sG += lg; sB += lb;
      dRx += lr * D.x; dRy += lr * D.y; dRz += lr * D.z;
      dGx += lg * D.x; dGy += lg * D.y; dGz += lg * D.z;
      dBx += lb * D.x; dBy += lb * D.y; dBz += lb * D.z;
    }
    // Irradiance for a normal n is E0 + dot(E1, n); see docs/04-look.md.
    const c0 = Math.PI / 2 / rays, c1 = Math.PI / rays;
    const o = (slot - start) * 12;
    sh[o] = sR * c0; sh[o + 1] = dRx * c1; sh[o + 2] = dRy * c1; sh[o + 3] = dRz * c1;
    sh[o + 4] = sG * c0; sh[o + 5] = dGx * c1; sh[o + 6] = dGy * c1; sh[o + 7] = dGz * c1;
    sh[o + 8] = sB * c0; sh[o + 9] = dBx * c1; sh[o + 10] = dBy * c1; sh[o + 11] = dBz * c1;
    skyVis[slot - start] = Math.min(1, (skyCount / rays) * 2);
    valid[slot - start] = backCount / rays < 0.35 ? 1 : 0;
  }
  return { sh, skyVis, valid };
}

let radiosity: Float32Array | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    pos = m.positions;
    nrm = m.normals;
    lights = m.lights;
    firstMassVertex = m.firstMassVertex ?? Infinity;
    carriers = m.carriers;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(new BufferAttribute(m.index, 1));
    bvh = new MeshBVH(g);
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'radiosity') {
    radiosity = m.radiosity;
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'direct') {
    const r = direct(m.start, m.end, m.salt);
    self.postMessage({ type: 'direct', start: m.start, end: m.end, ...r }, [r.E.buffer, r.sunVis.buffer, r.kept.buffer]);
  } else if (m.type === 'gather') {
    const r = gather(m.start, m.end, radiosity!, m.rays, m.salt);
    self.postMessage({ type: 'gather', start: m.start, end: m.end, ...r }, [r.sh.buffer, r.skyVis.buffer, r.valid.buffer]);
  }
};
