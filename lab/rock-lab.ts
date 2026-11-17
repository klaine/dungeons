// Prototype lab: ideas borrowed from Abyssal Garden (rock + plants) and teadrinker's foliage shader
// (light through crowns). Standalone on purpose: nothing here is imported by the game.
// Open /lab/rock-lab.html on the dev server.  Keys: 1-5 views, M material mode, T tree light-through.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const Q = new URLSearchParams(location.search);
let mode = Q.get('mode') ?? 'c'; // a plain | b rock shader | c rock shader + rubble + plants
let trans = Q.get('trans') !== '0'; // foliage light-through on/off
const STYLE = Q.get('style') === 'cliff' ? 1 : 0; // 0 mossy and crumbly, 1 faceted grey cliff
let seedN = parseInt(Q.get('seed') ?? '7', 10) || 7;

// ---------- small tools ----------
function rngOf(s: number) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rngOf(seedN * 7919 + 13);
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function h3(x: number, y: number, z: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + seedN * 1013) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vn(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz), b = h3(ix + 1, iy, iz), c = h3(ix, iy + 1, iz), d = h3(ix + 1, iy + 1, iz);
  const e = h3(ix, iy, iz + 1), f = h3(ix + 1, iy, iz + 1), g = h3(ix, iy + 1, iz + 1), h = h3(ix + 1, iy + 1, iz + 1);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy; return y0 + (y1 - y0) * fz;
}
function fbm(x: number, y: number, z: number, o = 4): number {
  let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * vn(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s / n;
}
function worley(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let best = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, cz = iz + k;
    const px = cx + h3(cx, cy, cz), py = cy + h3(cx + 101, cy, cz), pz = cz + h3(cx, cy + 57, cz);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2; if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// each Voronoi cell has one random plane; the field is how far a point sits above its own cell's plane, which cuts the rock into flat facets
function facets(x: number, y: number, z: number): number {
  const X = x * 0.11, Y = y * 0.16, Z = z * 0.11; const ix = Math.floor(X), iy = Math.floor(Y), iz = Math.floor(Z); let best = 9, bx = 0, by = 0, bz = 0, bi = 0, bj = 0, bk = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, cz = iz + k; const px = cx + h3(cx, cy, cz), py = cy + h3(cx + 101, cy, cz), pz = cz + h3(cx, cy + 57, cz);
    const d = (px - X) ** 2 + (py - Y) ** 2 + (pz - Z) ** 2; if (d < best) { best = d; bx = px; by = py; bz = pz; bi = cx; bj = cy; bk = cz; }
  }
  let nx = h3(bi + 7, bj, bk) - 0.5, ny = (h3(bi, bj + 7, bk) - 0.5) * 0.6, nz = h3(bi, bj, bk + 7) - 0.5; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  return -((X - bx) * nx + (Y - by) * ny * 1.4 + (Z - bz) * nz) * 4.0;
}

// ---------- the rock: one density function (Abyssal Garden's recipe: warp, cells, sawtooth ledges) ----------
interface Mesa { x: number; z: number; r: number; h: number; ph: number }
const MESAS: Mesa[] = [
  { x: -4, z: -2, r: 6.5, h: 15, ph: 0.0 }, { x: 8, z: 5, r: 4, h: 9, ph: 0.3 },
  { x: -10, z: 8, r: 3.2, h: 6.5, ph: 0.6 }, { x: 3, z: -10, r: 3.8, h: 11.5, ph: 0.8 }, { x: 12, z: -5, r: 2.6, h: 5, ph: 0.1 },
];
function density(x: number, y: number, z: number): number {
  const wx = x + (fbm(x * 0.11 + 3, y * 0.11, z * 0.11, 3) - 0.5) * 6;
  const wy = y + (fbm(x * 0.11, y * 0.11 + 9, z * 0.11, 3) - 0.5) * 2.5;
  const wz = z + (fbm(x * 0.11, y * 0.11, z * 0.11 + 17, 3) - 0.5) * 6;
  let d = -9;
  for (const m of MESAS) {
    const r = Math.hypot(wx - m.x, wz - m.z);
    const s = wy * 0.5 + m.ph; const saw = s - Math.floor(s); // sawtooth in height: each bed recedes, then steps back out = a ledge
    const rad = m.r * (1 + 0.16 * Math.sin(wy * 0.4 + m.ph * 6)) - 1.1 * saw;
    const top = (m.h - wy) * 0.8 - Math.max(0, r - m.r * 0.55) * 0.35;
    d = Math.max(d, Math.min(rad - r, top));
  }
  d = Math.max(d, 1.2 - y + (fbm(x * 0.08, 0, z * 0.08, 3) - 0.5) * 3); // ground
  d = Math.min(d, Math.hypot((x + 4) / 2.5, (y - 3.3) / 2.7) * 2.5 - 2.5 + 0.0 * z); // an arch tunnel through the big mesa, along z
  if (STYLE) d += (fbm(x * 0.4, y * 0.4, z * 0.4, 2) - 0.5) * 0.5 + facets(x, y, z) * 1.1; // cliffs: flat planes, one per cell, with little roughness between
  else d += (fbm(x * 0.55, y * 0.55, z * 0.55, 3) - 0.5) * 1.3 + (0.45 - worley(x * 0.35, y * 0.5, z * 0.35)) * 0.9;
  d = Math.min(d, 17.5 - Math.hypot(x, z), y + 2.5); // an island, closed below
  return d;
}

// naive surface nets: no tables, so short enough to read
function surfaceNets(f: (x: number, y: number, z: number) => number, x0: number, y0: number, z0: number, nx: number, ny: number, nz: number, s: number) {
  const sx = nx + 1, sy = ny + 1, sz = nz + 1; const val = new Float32Array(sx * sy * sz);
  const id = (i: number, j: number, k: number) => i + sx * (j + sy * k);
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) val[id(i, j, k)] = f(x0 + i * s, y0 + j * s, z0 + k * s);
  const cellV = new Int32Array(nx * ny * nz).fill(-1); const P: number[] = [], N: number[] = [];
  const cid = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = val[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; cv[c] = v; if (v > 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [a, b] of E) { if ((cv[a] > 0) === (cv[b] > 0)) continue; const t = cv[a] / (cv[a] - cv[b]);
      px += (a & 1) + ((b & 1) - (a & 1)) * t; py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; cnt++; }
    P.push(x0 + (i + px / cnt) * s, y0 + (j + py / cnt) * s, z0 + (k + pz / cnt) * s);
    // gradient from the grid corners
    const gx = (cv[1] + cv[3] + cv[5] + cv[7]) - (cv[0] + cv[2] + cv[4] + cv[6]);
    const gy = (cv[2] + cv[3] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[4] + cv[5]);
    const gz = (cv[4] + cv[5] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[2] + cv[3]);
    const gl = Math.hypot(gx, gy, gz) || 1; N.push(-gx / gl, -gy / gl, -gz / gl);
    cellV[cid(i, j, k)] = P.length / 3 - 1;
  }
  const idx: number[] = [];
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const v0 = val[id(i, j, k)] > 0;
    for (let a = 0; a < 3; a++) {
      const ni = i + (a === 0 ? 1 : 0), nj = j + (a === 1 ? 1 : 0), nk = k + (a === 2 ? 1 : 0);
      if (ni >= nx + 1 || nj >= ny + 1 || nk >= nz + 1) continue;
      if (v0 === (val[id(ni, nj, nk)] > 0)) continue;
      const b = (a + 1) % 3, c = (a + 2) % 3; const o = [i, j, k];
      const q = (db: number, dc: number) => { const p = [o[0], o[1], o[2]]; p[b] -= db; p[c] -= dc; return cellV[cid(p[0], p[1], p[2])]; };
      const A = q(0, 0), B = q(1, 0), C = q(1, 1), D = q(0, 1); if (A < 0 || B < 0 || C < 0 || D < 0) continue;
      if (v0) idx.push(A, B, C, A, C, D); else idx.push(A, C, B, A, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(idx);
  // fix winding globally if it came out inside-out
  const pa = g.getAttribute('position'), na = g.getAttribute('normal'); let agree = 0;
  for (let t = 0; t < Math.min(idx.length, 3000); t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1 = new THREE.Vector3().fromBufferAttribute(pa, b).sub(new THREE.Vector3().fromBufferAttribute(pa, a));
    const e2 = new THREE.Vector3().fromBufferAttribute(pa, c).sub(new THREE.Vector3().fromBufferAttribute(pa, a));
    agree += e1.cross(e2).dot(new THREE.Vector3().fromBufferAttribute(na, a)) > 0 ? 1 : -1;
  }
  if (agree < 0) { const ix = g.getIndex()!; for (let t = 0; t < ix.count; t += 3) { const b = ix.getX(t + 1); ix.setX(t + 1, ix.getX(t + 2)); ix.setX(t + 2, b); } }
  return g;
}

// ---------- the detail texture: warped fBm + ridges + cracks + pits, tileable, slopes baked in ----------
function makeDetail(): THREE.DataTexture {
  const S = 256;
  const hs = (x: number, y: number, p: number) => h3(((x % p) + p) % p, ((y % p) + p) % p, 5);
  const tn = (x: number, y: number, p: number) => {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hs(ix, iy, p), b = hs(ix + 1, iy, p), c = hs(ix, iy + 1, p), d = hs(ix + 1, iy + 1, p); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const wl = (x: number, y: number, p: number) => {
    const ix = Math.floor(x), iy = Math.floor(y); let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const d = Math.hypot(cx + h3(wx, wy, 9) - x, cy + h3(wx, wy, 31) - y); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    } return [f1, f2];
  };
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const wu = u + 0.05 * (tn(u * 4, v * 4, 4) - 0.5), wv = v + 0.05 * (tn(u * 4 + 7, v * 4, 4) - 0.5);
    let fb = 0, a = 0.5, p = 6; for (let o = 0; o < 5; o++) { fb += a * tn(wu * p, wv * p, p); a *= 0.5; p *= 2; }
    const rd = 1 - Math.abs(2 * tn(wu * 12, wv * 12, 12) - 1);
    const [f1, f2] = wl(wu * 7, wv * 7, 7); const crack = 1 - sm(0.0, 0.09, f2 - f1);
    const [g1] = wl(u * 16, v * 16, 16); const pit = 1 - sm(0.0, 0.35, g1);
    H[y * S + x] = fb * 0.55 + rd * 0.25 - crack * 0.35 - pit * 0.18;
  }
  let lo = 9, hi = -9; for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); } for (let i = 0; i < H.length; i++) H[i] = (H[i] - lo) / (hi - lo);
  const bl = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let s = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) s += H[((y + j + S) % S) * S + ((x + i + S) % S)]; bl[y * S + x] = s / 25; }
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, dx = H[y * S + ((x + 1) % S)] - H[y * S + ((x + S - 1) % S)], dy = H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x];
    out[i * 4] = Math.max(0, Math.min(255, 128 + dx * 700)); out[i * 4 + 1] = Math.max(0, Math.min(255, 128 + dy * 700));
    out[i * 4 + 2] = H[i] * 255; out[i * 4 + 3] = Math.max(0, Math.min(255, 128 + (H[i] - bl[i]) * 900));
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

// ---------- materials ----------
const sunDirW = new THREE.Vector3(-18, 14, 12).normalize();
const timeU = { value: 0 }; const transU = { value: 1 }; const sunVU = { value: new THREE.Vector3() };
let detailTex: THREE.DataTexture;
function rockMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tD = { value: detailTex };
    sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        mat4 wm = modelMatrix * instanceMatrix;
      #else
        mat4 wm = modelMatrix;
      #endif
      vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal);`);
    sh.fragmentShader = (STYLE ? '#define CLIFF'+String.fromCharCode(10) : '') + `uniform sampler2D tD; varying vec3 vWP; varying vec3 vWN; vec3 gN; float gR;
      vec3 triS(vec3 p, vec3 w, float s, out float h, out float c){
        vec4 a = texture2D(tD, p.zy*s), b = texture2D(tD, p.xz*s), d = texture2D(tD, p.xy*s);
        h = a.b*w.x + b.b*w.y + d.b*w.z; c = a.a*w.x + b.a*w.y + d.a*w.z;
        vec2 sa = a.rg*2.-1., sb = b.rg*2.-1., sd = d.rg*2.-1.;
        return vec3(0., sa.y, sa.x)*w.x + vec3(sb.x, 0., sb.y)*w.y + vec3(sd.x, sd.y, 0.)*w.z;
      }
      float hsh(float n){ return fract(sin(n*12.9898)*43758.5453); }\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `
        vec3 n = normalize(vWN); vec3 w = pow(abs(n), vec3(4.)); w /= dot(w, vec3(1.));
        float h0,c0,h1,c1,h2,c2,h3,c3;
        vec3 p0 = triS(vWP, w, .1, h0, c0), p1 = triS(vWP, w, .43, h1, c1), p2 = triS(vWP, w, 1.9, h2, c2), p3 = triS(vWP, w, 6.7, h3, c3);
        float fk = 1. - smoothstep(6., 26., length(vViewPosition));          // the finest scale fades out with distance
        vec3 pert = p0*.35 + p1*.5 + p2*.7 + p3*.8*fk;
        vec3 nn = normalize(n - pert*.9);
        #ifdef CLIFF
        vec3 fn = normalize(cross(dFdx(vWP), dFdy(vWP)));                         // flat facet normal, from how the surface slopes across the screen
        nn = normalize(mix(nn, fn, .8));
        float ridge = 1. - dot(fn, normalize(vWN));                               // where facets meet the smooth normal disagrees: catch light there
        #endif
        float st = vWP.y*.75 + (h0-.5)*5. + (h1-.5)*1.2;                        // beds: whole part picks a tint, fraction darkens the edge
        float bed = floor(st), fr = fract(st), hb = hsh(bed);
        #ifdef CLIFF
        vec3 tint = hb < .3 ? vec3(.55,.55,.57) : hb < .55 ? vec3(.42,.43,.46) : hb < .8 ? vec3(.62,.60,.57) : vec3(.34,.35,.38);
        tint *= mix(.7, 1., smoothstep(0., .08, fr));
        #else
        vec3 tint = hb < .3 ? vec3(.64,.55,.43) : hb < .55 ? vec3(.46,.45,.44) : hb < .8 ? vec3(.56,.37,.27) : vec3(.34,.31,.29);
        tint *= mix(.62, 1., smoothstep(0., .13, fr));
        #endif
        float lum = (.6 + .8*(h1*.5 + h2*.35 + h3*.15*fk)) * (.55 + .9*(c1*.4 + c2*.4 + c3*.2*fk));
        vec3 col = tint * lum;
        float enc = smoothstep(.62, .74, h0*.5 + h1*.5);                          // warm encrustation patches
        #ifdef CLIFF
        col = mix(col, vec3(.62,.58,.30)*lum, enc*.28*smoothstep(.2,.7,c2));        // sparse yellow lichen
        float stain = texture2D(tD, vec2((vWP.x + vWP.z)*.31, vWP.y*.045)).b;     // long vertical streaks where water runs down
        col *= 1. - .38*smoothstep(.55, .85, stain)*smoothstep(.3, .9, 1. - nn.y);
        col *= 1. + 1.6*ridge;
        #else
        col = mix(col, vec3(.74,.52,.30)*lum, enc*.45);
        #endif
        float up = smoothstep(.45, .8, nn.y);                                      // moss grows on what faces up
        float mp = smoothstep(.40, .62, h1*.6 + h0*.4 + (c2-.5)*.4);
        float moss = up*mp;
        #ifdef CLIFF
        moss *= smoothstep(.82, .97, nn.y)*.55;                                    // only a little, on the flattest ledges
        #endif
        #ifndef CLIFF
        moss = max(moss, smoothstep(2.4, .9, vWP.y)*smoothstep(.2, .6, h1)*.85*up);
        #endif
        col = mix(col, mix(vec3(.10,.20,.05), vec3(.30,.40,.10), h2)*(.7+.5*c2), moss);
        diffuseColor.rgb = col; gN = nn; gR = mix(.86, .98, moss);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gR;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize((viewMatrix * vec4(gN, 0.)).xyz);');
  };
  return m;
}

// blades: grass, hanging roots and fern leaves are one tapered, curled strip each, thousands of instances
function blade(segs: number, w0: number, len: number, curl: number): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [], I: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, y = t * len, z = curl * t * t * len, w = w0 * Math.pow(1 - t, 0.7) + 0.0005, c = 0.45 + 0.65 * t;
    P.push(-w, y, z, w, y, z); C.push(c, c, c, c, c, c);
    if (i < segs) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
function swayMaterial(fade: [number, number] = [1e9, 1e9 + 1]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = timeU; sh.uniforms.uFade = { value: new THREE.Vector2(fade[0], fade[1]) };
    sh.vertexShader = 'uniform float uT; uniform vec2 uFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // far blades thin to nothing, so the GPU drops them before it draws a pixel
      float fd = distance(cameraPosition, (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz);
      transformed.x *= 1. - smoothstep(uFade.x, uFade.y, fd);
      float hh = clamp(position.y, 0., 2.);
      float ph = instanceMatrix[3].x*.7 + instanceMatrix[3].z*.5;
      transformed.x += sin(uT*1.7 + ph)*.10*hh*hh; transformed.z += cos(uT*1.3 + ph*1.3)*.07*hh*hh;`);
  };
  return m;
}

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb9a58f); scene.fog = new THREE.Fog(0xb9a58f, 40, 120);
const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xa9bddb, 0x4a3f33, 0.9));
const sun = new THREE.DirectionalLight(0xffc690, 3.4); sun.position.copy(sunDirW).multiplyScalar(40); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 100; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun);

const VIEWS: Record<string, [number[], number[]]> = {
  '1': [[28, 14, 30], [0, 5, 0]], '2': [[-17, 4.5, 14], [-4, 4, -2]], '3': [[7, 9, 13], [3, 7, -9]], '4': [[11, 2.6, 15], [8, 0.8, 7]], '5': [[-8, 3.5, -22], [-6, 6, -13]],
};
function view(k: string, which = 0) { let v = VIEWS[k]; if (!v) return;
  if (k === '5' && spots5.length) { const t = spots5[which].clone().add(new THREE.Vector3(0, 5, 0)); const h = new THREE.Vector3(sunDirW.x, 0, sunDirW.z).normalize(); v = [[t.x - h.x * 22, t.y - 1.2, t.z - h.z * 22], [t.x, t.y, t.z]]; } cam.position.set(...(v[0] as [number, number, number])); ctl.target.set(...(v[1] as [number, number, number])); ctl.update(); }

let spots5: THREE.Vector3[] = []; (window as any).__v = (k: number) => view("5", k);
const hud = document.createElement('div'); hud.style.cssText = 'position:fixed;left:10px;top:8px;color:#fff;font:13px/1.4 system-ui;text-shadow:0 1px 3px #000;pointer-events:none;white-space:pre';
document.body.appendChild(hud);
let baseTxt = ''; let statTxt = '';
const status = (s: string) => { baseTxt = s; hud.textContent = s + '\n' + statTxt; };

const matPlain = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 });
let rockMesh: THREE.Mesh, matRock: THREE.MeshStandardMaterial;
const groupB = new THREE.Group(), groupC = new THREE.Group(); scene.add(groupB, groupC);
const lodMeshes: THREE.InstancedMesh[] = []; let lod = Q.get('lod') !== '0'; let tint = false;
const treeMats: THREE.Material[] = [], treeDepthMats: THREE.MeshDepthMaterial[] = [];

function build() {
  status('building the rock…');
  detailTex = makeDetail(); matRock = rockMaterial();
  const t0 = performance.now();
  const geo = surfaceNets(density, -19, -3, -19, 108, 63, 108, 0.35);
  const tRock = performance.now() - t0;
  rockMesh = new THREE.Mesh(geo, matPlain); rockMesh.castShadow = rockMesh.receiveShadow = true; scene.add(rockMesh);
  const P = geo.getAttribute('position'), N = geo.getAttribute('normal'), nV = P.count;
  const pickV = () => { const i = Math.floor(rnd() * nV); return { p: new THREE.Vector3().fromBufferAttribute(P, i), n: new THREE.Vector3().fromBufferAttribute(N, i) }; };

  // rubble: displaced icospheres cut by random planes, so each is a faceted chunk
  // the same chunk shape can be built at several detail levels: the shape is fixed by its own parameters, the detail only changes how finely it is cut
  const chunkShape = () => ({ planes: Array.from({ length: 4 }, () => ({ n: new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize(), d: 0.55 + rnd() * 0.35 })), k: rnd() * 50 });
  const chunkGeo = (sh: ReturnType<typeof chunkShape>, detail: number): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(1, detail); const p = g.getAttribute('position'); const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); v.multiplyScalar(0.8 + 0.5 * fbm(v.x * 1.6 + sh.k, v.y * 1.6, v.z * 1.6, 3));
      for (const pl of sh.planes) { const s = v.dot(pl.n) - pl.d; if (s > 0) v.addScaledVector(pl.n, -s); } p.setXYZ(i, v.x, v.y * 0.75, v.z);
    }
    g.computeVertexNormals(); return g;
  };
  const rubbleMat = rockMaterial(); const dummy = new THREE.Object3D(); const qq = new THREE.Quaternion();
  const RUB_TIERS = [{ detail: 2, step: 1, lo: 0, hi: 12 }, { detail: 1, step: 2, lo: 12, hi: 26 }, { detail: 0, step: 4, lo: 26, hi: 44 }]; // beyond that the ground's own texture carries it
  for (let variant = 0; variant < 4; variant++) {
    const shape = chunkShape(); const geos = RUB_TIERS.map(t => chunkGeo(shape, t.detail));
    const byCell = new Map<string, { m: number[][]; box: THREE.Box3 }>(); let n = 0;
    while (n < 6500) {
      const { p, n: nrm } = pickV(); if (nrm.y < 0.45 || rnd() > (STYLE ? 0.2 : 0.55) || (STYLE && p.y > 2.6 && rnd() > 0.15)) continue; // cliffs: rubble gathers as talus at the foot
      const s = 0.07 + Math.pow(rnd(), 3.2) * 0.55; // many small, a few large
      dummy.position.copy(p).addScaledVector(nrm, s * 0.2).add(new THREE.Vector3((rnd() - .5) * .5, 0, (rnd() - .5) * .5));
      dummy.quaternion.setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)); dummy.scale.set(s * (0.8 + rnd() * .6), s * (0.7 + rnd() * .5), s * (0.8 + rnd() * .6));
      dummy.updateMatrix(); n++;
      const key = Math.floor(dummy.position.x / 12) + ',' + Math.floor(dummy.position.z / 12); let c = byCell.get(key); if (!c) { c = { m: [], box: new THREE.Box3() }; byCell.set(key, c); }
      c.m.push(dummy.matrix.toArray()); c.box.expandByPoint(dummy.position);
    }
    for (const c of byCell.values()) RUB_TIERS.forEach((t, ti) => {
      const list = c.m.filter((_, i) => i % t.step === 0); if (!list.length) return;
      const im = new THREE.InstancedMesh(geos[ti], rubbleMat, list.length); im.castShadow = ti === 0; im.receiveShadow = true;
      list.forEach((m, i) => im.setMatrixAt(i, new THREE.Matrix4().fromArray(m)));
      im.userData = { box: c.box, tier: ti, lo: t.lo, hi: t.hi }; groupC.add(im); lodMeshes.push(im);
    });
  }

  // plants by what the surface faces: tufts on tops, hanging roots under overhangs, ferns on the steep
  // blades are recorded per ground cell, then built as a few tiers per cell: full blades near, fewer wider simpler ones farther, none beyond
  type Rec = { m: number[]; c: number[] };
  const CELL = 12; const cells = new Map<string, { recs: Record<string, Rec[]>; box: THREE.Box3 }>();
  const col = new THREE.Color();
  const put = (kind: string, p: THREE.Vector3, dir: THREE.Vector3, yaw: number, tilt: number, s: number, c: number[]) => {
    qq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    qq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    dummy.position.copy(p); dummy.quaternion.copy(qq); dummy.scale.setScalar(s); dummy.updateMatrix();
    const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL);
    let cell = cells.get(key); if (!cell) { cell = { recs: { grass: [], vines: [], fern: [] }, box: new THREE.Box3() }; cells.set(key, cell); }
    cell.recs[kind].push({ m: dummy.matrix.toArray(), c }); cell.box.expandByPoint(p);
  };
  const grass = { count: 0 }, vines = { count: 0 }, fern = { count: 0 };
  for (let t = 0; t < 700000; t++) {
    const { p, n } = pickV();
    const patch = fbm(p.x * 0.3, p.y * 0.2, p.z * 0.3, 3);
    if (n.y > 0.8 && patch > (STYLE ? 0.6 : 0.42) && rnd() < 0.5 && grass.count < 90000 - 8) {
      for (let b = 0; b < 7; b++) { const q = p.clone().add(new THREE.Vector3((rnd() - .5) * .35, 0, (rnd() - .5) * .35)); const d = new THREE.Vector3((rnd() - .5) * .5, 1, (rnd() - .5) * .5).normalize();
        grass.count++, put('grass', q, d, rnd() * 6.28, 0, 0.5 + rnd() * 0.9, [0.28 + rnd() * .22, 0.45 + rnd() * .3, 0.1 + rnd() * .1]); }
    } else if (n.y < -0.35 && p.y > 0.2 && rnd() < 0.45 && vines.count < 30000 - 4) {
      for (let b = 0; b < 3; b++) vines.count++, put('vines', p.clone().add(new THREE.Vector3((rnd() - .5) * .3, -0.02, (rnd() - .5) * .3)), new THREE.Vector3((rnd() - .5) * .2, -1, (rnd() - .5) * .2).normalize(), rnd() * 6.28, 0, 0.4 + rnd() * 1.0, [0.2 + rnd() * .15, 0.32 + rnd() * .2, 0.1]);
    } else if (Math.abs(n.y) < 0.55 && n.y > 0.1 && patch > 0.5 && rnd() < 0.035 && fern.count < 30000 - 8 && p.y > 0.8) {
      const d = n.clone().lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize(); const s = 0.5 + rnd() * 0.5;
      for (let b = 0; b < 7; b++) fern.count++, put('fern', p, d, (b / 7) * 6.28 + rnd() * .4, 0.9 + rnd() * .3, s, [0.12 + rnd() * .1, 0.35 + rnd() * .25, 0.1]);
    }
  }
  const TIERS: Record<string, { segs: number; w: number; len: number; curl: number; step: number; lo: number; hi: number; fade?: [number, number] }[]> = {
    grass: [{ segs: 5, w: 0.035, len: 0.75, curl: 0.35, step: 1, lo: 0, hi: 14 }, { segs: 2, w: 0.06, len: 0.75, curl: 0.35, step: 3, lo: 14, hi: 28 }, { segs: 1, w: 0.1, len: 0.75, curl: 0.2, step: 9, lo: 28, hi: 50, fade: [38, 50] }],
    vines: [{ segs: 8, w: 0.03, len: 2.0, curl: 0, step: 1, lo: 0, hi: 22 }, { segs: 3, w: 0.05, len: 2.0, curl: 0, step: 3, lo: 22, hi: 40, fade: [30, 40] }],
    fern: [{ segs: 6, w: 0.26, len: 1.3, curl: 0.9, step: 1, lo: 0, hi: 24 }, { segs: 2, w: 0.3, len: 1.3, curl: 0.9, step: 2, lo: 24, hi: 42, fade: [32, 42] }],
  };
  const tierMats: { m: THREE.MeshStandardMaterial; tier: number }[] = [];
  const geos: Record<string, THREE.BufferGeometry[]> = {}, mats: Record<string, THREE.MeshStandardMaterial[]> = {};
  for (const k in TIERS) { geos[k] = TIERS[k].map(t => blade(t.segs, t.w, t.len, t.curl)); mats[k] = TIERS[k].map((t, i) => { const m = swayMaterial(t.fade); tierMats.push({ m, tier: i }); return m; }); }
  for (const cell of cells.values()) for (const k in TIERS) TIERS[k].forEach((t, ti) => {
    const list = cell.recs[k].filter((_, i) => i % t.step === 0); if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[k][ti], mats[k][ti], list.length); im.receiveShadow = true;
    list.forEach((r, i) => { im.setMatrixAt(i, new THREE.Matrix4().fromArray(r.m)); col.setRGB(r.c[0], r.c[1], r.c[2]); im.setColorAt(i, col); });
    im.userData = { box: cell.box, tier: ti, lo: t.lo, hi: t.hi, tris: list.length * t.segs * 2 }; groupC.add(im); lodMeshes.push(im);
  });
  (window as any).__tierMats = tierMats;

  // trees: branching trunk, crowns of leaf cards; the foliage trick is in the shadow pass
  const leafTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!; const r = rngOf(99);
    for (let i = 0; i < 70; i++) {
      const x = 30 + r() * 196, y = 30 + r() * 196, a = r() * 6.28, L = 16 + r() * 20, Wd = 6 + r() * 6;
      g.save(); g.translate(x, y); g.rotate(a);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, L); const gcol = `${60 + r() * 50 | 0},${110 + r() * 70 | 0},${30 + r() * 25 | 0}`;
      gr.addColorStop(0, `rgba(${gcol},1)`); gr.addColorStop(0.7, `rgba(${gcol},0.85)`); gr.addColorStop(1, `rgba(${gcol},0.1)`); g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, L, Wd, 0, 0, 6.28); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const spots: THREE.Vector3[] = [];
  for (let t = 0; t < 40000 && spots.length < 6; t++) {
    const { p, n } = pickV(); if (n.y < 0.9 || p.y > 2.2 || p.y < 0.4 || Math.hypot(p.x, p.z) > 14) continue;
    if (MESAS.some(m => Math.hypot(p.x - m.x, p.z - m.z) < m.r + 3.5) || spots.some(s => s.distanceTo(p) < 7)) continue; spots.push(p);
  }
  spots5 = spots;
  const bark = new THREE.MeshStandardMaterial({ color: 0x4d3b2d, roughness: 1 }); const barkParts: THREE.BufferGeometry[] = [];
  spots.forEach((root, ti) => {
    const R = rngOf(ti * 31 + seedN); const cards: THREE.Vector3[] = []; const H = 5 + R() * 3;
    const grow = (o: THREE.Vector3, d: THREE.Vector3, len: number, rad: number, depth: number) => {
      const e = o.clone().addScaledVector(d, len); const cg = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1); cg.translate(0, len / 2, 0);
      cg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)); cg.translate(o.x, o.y, o.z); barkParts.push(cg);
      if (depth >= 2) { for (let k = 0; k < 6; k++) cards.push(e.clone().add(new THREE.Vector3(R() - .5, R() - .5, R() - .5).multiplyScalar(2.4))); }
      if (depth >= 4) return;
      const n = depth === 0 ? 4 : 3;
      for (let b = 0; b < n; b++) { const nd = d.clone().add(new THREE.Vector3(R() - .5, (depth === 0 ? 0.15 : 0.05) + R() * .2, R() - .5).multiplyScalar(depth === 0 ? 1.3 : 1.1)).normalize(); grow(e, nd, len * (0.62 + R() * 0.15), rad * 0.62, depth + 1); }
    };
    grow(root.clone().add(new THREE.Vector3(0, -0.3, 0)), new THREE.Vector3(0, 1, 0), H * 0.42, 0.34, 0);
    const centre = root.clone().add(new THREE.Vector3(0, H * 0.78, 0));
    const um = { value: centre }; const mat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCentre = um; sh.uniforms.uT = timeU; sh.uniforms.uSunV = sunVU; sh.uniforms.uTrans = transU; (mat as any).__u = sh.uniforms;
      sh.vertexShader = 'varying vec3 vCard; uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vCard = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
        transformed.x += sin(uT*1.4 + vCard.x*.9 + vCard.z*.7)*.06; transformed.y += cos(uT*1.9 + vCard.z)*.04;`);
      sh.fragmentShader = 'varying vec3 vCard; uniform vec3 uCentre; uniform vec3 uSunV; uniform float uTrans;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          vec3 sn = normalize(vCard - uCentre + vec3(0., .35, 0.));              // normals bent outward from the crown's heart: a round, soft mass
          normal = normalize((viewMatrix * vec4(sn, 0.)).xyz);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float back = pow(max(-dot(normalize(vViewPosition), uSunV), 0.), 2.);   // looking toward the sun through leaves: let it glow
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1., .8, .45) * back * uTrans * 1.1;`);
    };
    const im = new THREE.InstancedMesh(cardGeo, mat, cards.length * 3); const d2 = new THREE.Object3D();
    cards.forEach((c, i) => { for (let k = 0; k < 3; k++) { d2.position.copy(c).add(new THREE.Vector3(R() - .5, R() - .5, R() - .5).multiplyScalar(.8)); d2.quaternion.setFromEuler(new THREE.Euler(R() * 6.28, R() * 6.28, R() * 6.28)); d2.scale.setScalar(1.0 + R() * 0.9); d2.updateMatrix(); im.setMatrixAt(i * 3 + k, d2.matrix); } });
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5 }); im.customDepthMaterial = dm; treeDepthMats.push(dm); treeMats.push(mat);
    groupC.add(im);
  });
  const barkMesh = new THREE.Mesh(mergeGeometries(barkParts)!, bark); barkMesh.castShadow = barkMesh.receiveShadow = true; groupC.add(barkMesh);

  const info = `${nV} rock vertices · ${(tRock / 1000).toFixed(1)} s to carve · grass ${grass.count} · roots ${vines.count} · fern ${fern.count} · trees ${spots.length}`;
  (window as any).__info = info; (window as any).__spots = spots.map(s => [s.x.toFixed(1), s.y.toFixed(1), s.z.toFixed(1)]); apply(); view(Q.get('view') ?? '1'); (window as any).__ready = true;
}
function apply() {
  rockMesh.material = mode === 'a' ? matPlain : matRock;
  groupC.visible = mode === 'c'; groupB.visible = true;
  for (const d of treeDepthMats) d.alphaTest = trans ? 0.84 : 0.5; // the foliage trick: leaves cast smaller shadows than they look, so light leaks through crowns
  transU.value = trans ? 1 : 0;
  const names: any = { a: 'A  plain baseline (not the game\'s own material)', b: 'B  triplanar four-scale rock + beds + moss', c: 'C  B + rubble + plants by surface + trees' };
  status(`${names[mode]}\ndistance detail: ${lod ? 'ON' : 'off'}   ·   light through crowns: ${trans ? 'ON' : 'off'}   ·   keys: 1-5 views, M mode, T light-through, L distance detail, D tint tiers, C rock style\n${(window as any).__info ?? ''}`);
}
addEventListener('keydown', (e) => {
  if (VIEWS[e.key]) view(e.key); else if (e.key === 'm') { mode = mode === 'a' ? 'b' : mode === 'b' ? 'c' : 'a'; apply(); } else if (e.key === 't') { trans = !trans; apply(); } else if (e.key === 'c') { const u = new URL(location.href); u.searchParams.set('style', STYLE ? 'moss' : 'cliff'); location.href = u.toString(); } else if (e.key === 'l') { lod = !lod; apply(); } else if (e.key === 'd') { tint = !tint; for (const t of (window as any).__tierMats) t.m.color.set(!tint ? 0xffffff : [0xffffff, 0xff8080, 0x8080ff][t.tier]); }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });
const sv = new THREE.Vector3(); let frameMs = 0, nFrames = 0;
renderer.setAnimationLoop((t) => {
  timeU.value = (Q.has('still') ? 0 : t / 1000); ctl.update();
  sv.copy(sunDirW).transformDirection(cam.matrixWorldInverse);
  sunVU.value.copy(sv);
  for (const im of lodMeshes) { const u = im.userData; const d = u.box.distanceToPoint(cam.position); im.visible = lod ? (d >= u.lo && d < u.hi) : u.tier === 0; }
  const t0 = performance.now(); renderer.render(scene, cam); frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
  if (++nFrames % 20 === 0) { statTxt = `${(renderer.info.render.triangles / 1000).toFixed(0)}k triangles drawn · ${renderer.info.render.calls} draw calls · CPU submit ${frameMs.toFixed(1)} ms`; hud.textContent = baseTxt + '\n' + statTxt; (window as any).__stat = statTxt; }
});
setTimeout(build, 50);
