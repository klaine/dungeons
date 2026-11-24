/**
 * Finds a ski run in a world (`src/core/skiRun.ts`) and writes its slice, the snow on the world's land about it, for the downhill
 * run's page (`lab/slope.html`) to ski: `public/slopes/<world>.json`. Reports what was found: where the run starts and ends, how far
 * it falls, how steep it is, how long the search and the slice took, and how large the file is. With a folder, also draws the
 * search as shaded relief (every run kept in yellow, the one chosen in red, the places' and towns' keep-away rings in magenta).
 *
 *   npx tsx tools/skiRun.ts [world seed, w2] [folder for the picture]          (`PICK=2` before it to take the second run kept)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { world } from '../src/core/world';
import { findSkiRun, RUN, sliceOfRun } from '../src/core/skiRun';
import { writeSlice } from '../src/core/skiSlice';

const seed = process.argv[2] ?? 'w2', folder = process.argv[3];
let t = performance.now();
const w = world(seed);
console.log(`${seed} (${w.name}): world made in ${((performance.now() - t) / 1000).toFixed(1)} s`);
t = performance.now();
const found = findSkiRun(w);
console.log(`  ${found.tried} starts tried, ${found.kept.length} runs kept, in ${((performance.now() - t) / 1000).toFixed(1)} s`);
for (const r of found.kept.slice(0, 5)) {
  const [a, b] = [r.points[0], r.points[r.points.length - 1]];
  console.log(`    from ${a.map((v) => v.toFixed(0))} at ${r.heights[0].toFixed(0)} m to ${b.map((v) => v.toFixed(0))} at ${r.heights[r.heights.length - 1].toFixed(0)} m: ${r.length} m long, falling ${r.drop.toFixed(0)} m, ${r.mean.toFixed(1)} degrees on the whole, ${r.steepest.toFixed(1)} at most over ${RUN.ahead} m`);
}
// (`PICK=2` before the command takes the second run kept instead, and so on.)
const run = found.kept[Number(process.env.PICK ?? 1) - 1] ?? null;
if (!run) { console.log('  no run found'); process.exit(1); }
t = performance.now();
const slice = sliceOfRun(w, run);
const text = writeSlice(slice), out = `public/slopes/${seed}.json`;
mkdirSync('public/slopes', { recursive: true });
writeFileSync(out, text);
let inSlice = 0;
for (const v of slice.snow.data) if (!Number.isNaN(v)) inSlice++;
console.log(`  slice made in ${((performance.now() - t) / 1000).toFixed(1)} s: ${inSlice.toLocaleString()} points of snow at a metre, near land ${slice.near.nx} by ${slice.near.nz} at ${slice.near.cell} m, country ${slice.far.nx} by ${slice.far.nz} at ${slice.far.cell} m; below ${slice.peak}`);
console.log(`  written to ${out}, ${(text.length / 1e6).toFixed(2)} MB`);

if (folder) {
  // Shaded relief of the country about the run, its cover tinted, the runs kept drawn over it.
  const f = w.field, [mx, mz] = run.points[Math.floor(run.points.length / 2)], half = 2500, px = 5, W = (2 * half) / px, H = W, rgb = new Uint8Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = mx - half + i * px, z = mz - half + j * px, hx = f.at(x + px, z) - f.at(x - px, z), hz = f.at(x, z + px) - f.at(x, z - px);
    const l = ((hx / (2 * px)) * 0.6 + (hz / (2 * px)) * 0.6 + 1) / Math.hypot(hx / (2 * px), hz / (2 * px), 1);
    const ci = Math.round((x - f.x0) / f.cell), cj = Math.round((z - f.z0) / f.cell), c = ci < 0 || cj < 0 || ci >= f.nx || cj >= f.nz ? 0 : w.cover[cj * f.nx + ci];
    const base = c <= 1 ? [70, 110, 160] : c === 6 ? [90, 130, 80] : c === 8 ? [160, 150, 140] : c === 9 ? [240, 240, 250] : c === 7 ? [150, 140, 100] : [170, 190, 120];
    for (let k = 0; k < 3; k++) rgb[(j * W + i) * 3 + k] = Math.min(255, base[k] * Math.max(0.25, Math.min(1.2, l)));
  }
  const dot = (x: number, z: number, col: number[], r = 1) => {
    const i = Math.round((x - mx + half) / px), j = Math.round((z - mz + half) / px);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < W && jj < H) rgb.set(col, (jj * W + ii) * 3); }
  };
  found.kept.slice(1).forEach((k) => k.points.forEach(([x, z]) => dot(x, z, [255, 200, 0])));
  run.points.forEach(([x, z]) => { dot(x, z, [230, 30, 30], 1); });
  for (const q of [...w.places.map((p) => ({ ...p, r: RUN.place })), ...w.towns.map((t) => ({ ...t, r: RUN.town }))]) for (let a = 0; a < 200; a++) dot(q.x + Math.cos(a / 32) * q.r, q.z + Math.sin(a / 32) * q.r, [255, 0, 255], 0);
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/${seed}-run.png`, png(W, H, rgb));
  console.log(`  picture: ${folder}/${seed}-run.png`);
}

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
