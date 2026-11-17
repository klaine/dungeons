/**
 * Draws a mountain top's land as shaded relief, its plain shape beside the same land worn by water
 * and frost (`?terrain=eroded`), with the ways drawn on, for a number of seeds; so that the wear can
 * be judged by eye and tuned without building the rock. Writes PNG files.
 *
 *   npx tsx tools/terrain.ts [count] [prefix] [out folder] [metres to a pixel] [top | country] [half the country's breadth]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateSite } from '../src/core/generate';
import { countryAt, landAt, WEAR } from '../src/core/mountain';
import type { Site } from '../src/core/site';

const count = Number(process.argv[2] ?? 3), prefix = process.argv[3] ?? 'peak', out = process.argv[4] ?? 'terrain-pictures', px = Number(process.argv[5] ?? 1.5);
// ('top' draws only the top within its rim, larger, and each land in a picture of its own; 'country' the country round about, fourteen kilometres across.)
const topOnly = process.argv[6] === 'top' || process.argv[6] === 'country', country = process.argv[6] === 'country';
mkdirSync(out, { recursive: true });
// (Other wear may be tried without editing the code: WEAR='{"cut":30,"water":{"capacity":1}}' before the command.)
if (process.env.WEAR) { const o = JSON.parse(process.env.WEAR); Object.assign(WEAR.water, o.water ?? {}); Object.assign(WEAR.frost, o.frost ?? {}); delete o.water; delete o.frost; Object.assign(WEAR, o); }

/** A PNG of RGB pixels. */
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Shaded relief of a site's land over a box, with its ways in colour. */
function relief(site: Site, box: [number, number, number, number], rgb: Uint8Array, w: number, h: number, left: number, stride: number) {
  const m = site.mountain!, floor = site.places.find((p) => p.id === site.start)!.floor;
  const hs = new Float32Array((w + 2) * (h + 2));
  const wet = new Uint8Array((w + 2) * (h + 2));
  for (let j = 0; j < h + 2; j++) for (let i = 0; i < w + 2; i++) {
    const x = box[0] + (i - 1) * px, z = box[1] + (j - 1) * px;
    if (country) { const c = countryAt(m, floor, x, z); hs[j * (w + 2) + i] = c.y; wet[j * (w + 2) + i] = c.water ? 1 : 0; }
    else hs[j * (w + 2) + i] = landAt(m, floor, x, z);
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of hs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const deck = m.deck;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j + 1) * (w + 2) + i + 1, y = hs[k];
    const gx = (hs[k + 1] - hs[k - 1]) / (2 * px), gz = (hs[k + w + 2] - hs[k - w - 2]) / (2 * px);
    // (Light from the north-west, high: as maps are shaded.)
    const nl = Math.hypot(gx, 1, gz), lx = -0.5, ly = 0.75, lz = -0.43;
    const shade = Math.max(0, (-gx * lx + ly - gz * lz) / nl / Math.hypot(lx, ly, lz));
    const slope = Math.hypot(gx, gz);
    // Turf where it is gentle, rock where steep, cloud-white below the deck.
    const t = (y - lo) / Math.max(1, hi - lo);
    let r = 120 + 70 * t, g = 140 + 50 * t, b = 95 + 60 * t;
    if (slope > 0.9) { r = 150; g = 140; b = 130; }
    if (country) { r = 70 + 150 * t; g = 105 + 120 * t; b = 70 + 160 * t; if (y > deck + 150) { r = g = b = 235; } }
    if (y < deck && !country) { r = r * 0.5 + 115; g = g * 0.5 + 120; b = b * 0.5 + 128; }
    if (wet[k]) { r = 60; g = 90; b = 140; }
    const o = (j * stride + left + i) * 3;
    rgb[o] = Math.min(255, r * (0.25 + 0.95 * shade)); rgb[o + 1] = Math.min(255, g * (0.25 + 0.95 * shade)); rgb[o + 2] = Math.min(255, b * (0.25 + 0.95 * shade));
  }
  const dot = (x: number, z: number, c: [number, number, number]) => {
    const i = Math.round((x - box[0]) / px), j = Math.round((z - box[1]) / px);
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const o = (j * stride + left + i) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  const lines: [[number, number, ...number[]][] | undefined, [number, number, number]][] = [[m.way, [220, 60, 40]], [m.climb, [250, 200, 40]], [m.gallery?.line, [60, 120, 230]], [m.scramble?.line, [200, 60, 200]]];
  for (const [line, c] of lines) if (line) for (let k = 1; k < line.length; k++) {
    const [ax, az] = line[k - 1], [bx, bz] = line[k], n = Math.ceil(Math.hypot(bx - ax, bz - az) / (px * 0.5));
    for (let s = 0; s <= n; s++) dot(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, c);
  }
  return { lo, hi };
}

for (let n = 0; n < count; n++) {
  const seed = `${prefix}${n}`;
  const t0 = performance.now();
  const plain = generateSite(seed, 'mountain'), t1 = performance.now();
  const worn = generateSite(seed, 'mountain', { terrain: 'eroded' }), t2 = performance.now();
  // The box: about the top and the ridge, the same for both.
  const m = plain.mountain!;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < m.rim.length; k++) { const a = (k / m.rim.length) * Math.PI * 2; x0 = Math.min(x0, m.x + Math.cos(a) * m.rim[k]); x1 = Math.max(x1, m.x + Math.cos(a) * m.rim[k]); z0 = Math.min(z0, m.z + Math.sin(a) * m.rim[k]); z1 = Math.max(z1, m.z + Math.sin(a) * m.rim[k]); }
  if (!topOnly) for (const [x, z] of m.spur.crest ?? []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const span = Number(process.argv[7] ?? 7000);
  const box: [number, number, number, number] = country ? [m.x - span, m.z - span, m.x + span, m.z + span] : [x0 - 40, z0 - 40, x1 + 40, z1 + 40];
  const w = Math.ceil((box[2] - box[0]) / px), h = Math.ceil((box[3] - box[1]) / px), gap = 8, stride = topOnly ? w : w * 2 + gap;
  const rgb = new Uint8Array(stride * h * 3).fill(255);
  const a = relief(plain, box, rgb, w, h, 0, stride), t3 = performance.now();
  if (topOnly) { writeFileSync(`${out}/${seed}-plain.png`, png(stride, h, rgb)); rgb.fill(255); }
  const b = relief(worn, box, rgb, w, h, topOnly ? 0 : w + gap, stride);
  writeFileSync(`${out}/${seed}${topOnly ? '-worn' : ''}.png`, png(stride, h, rgb));
  console.log(`${seed}: made plain in ${(t1 - t0).toFixed(0)} ms, worn in ${(t2 - t1).toFixed(0)} ms; land ${a.lo.toFixed(0)}..${a.hi.toFixed(0)} plain, ${b.lo.toFixed(0)}..${b.hi.toFixed(0)} worn; drawn in ${((t3 - t2) / 1000).toFixed(1)} s; routes plain ${[plain.mountain!.climb, plain.mountain!.gallery, plain.mountain!.scramble].filter(Boolean).length}, worn ${[worn.mountain!.climb, worn.mountain!.gallery, worn.mountain!.scramble].filter(Boolean).length}`);
}
