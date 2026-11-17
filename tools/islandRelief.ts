/**
 * Draws islands as shaded relief, each drawn by rule beside the same seed found in a sea of islands (the way islands are made
 * now), with the way in red; for judging found land by eye. Writes PNG files.
 *
 *   npx tsx tools/islandRelief.ts <out folder> <metres to a pixel> <seed> [seed...]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateSite } from '../src/core/generate';
import { landAt, inland } from '../src/core/island';
const out = process.argv[2], px = Number(process.argv[3] ?? 1), seeds = process.argv.slice(4);
mkdirSync(out, { recursive: true });
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const tt = Buffer.from(t), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(Buffer.concat([tt, d]))); return Buffer.concat([l, tt, d, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const seed of seeds) for (const terrain of ['plain', 'eroded'] as const) {
  const s = generateSite(seed, 'island', { terrain }), o = s.island!, F = s.places.find((p) => p.id === s.start)!.floor;
  const R = Math.max(...o.coast) + 50, x0 = o.x - R, z0 = o.z - R, w = Math.ceil((2 * R) / px), h = w;
  const H = new Float32Array((w + 2) * (h + 2));
  for (let j = 0; j < h + 2; j++) for (let i = 0; i < w + 2; i++) H[j * (w + 2) + i] = landAt(o, F, x0 + (i - 1) * px, z0 + (j - 1) * px);
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j + 1) * (w + 2) + i + 1, y = H[k], gx = (H[k + 1] - H[k - 1]) / (2 * px), gz = (H[k + w + 2] - H[k - w - 2]) / (2 * px);
    const nl = Math.hypot(gx, 1, gz), sh = Math.max(0, (gx * 0.5 + 0.75 + gz * 0.43) / nl / 1.0);
    let c = [110 + (y - o.sea) * 2, 140 + (y - o.sea), 90];
    if (y < o.sea) c = [40, 70, 120];
    else if (Math.hypot(gx, gz) > 1) c = [150, 140, 130];
    const o3 = (j * w + i) * 3; for (let q = 0; q < 3; q++) rgb[o3 + q] = Math.max(0, Math.min(255, c[q] * (0.3 + 0.8 * sh)));
  }
  for (const [x, z] of o.way ?? []) { const i = Math.round((x - x0) / px), j = Math.round((z - z0) / px); if (i >= 0 && j >= 0 && i < w && j < h) { const o3 = (j * w + i) * 3; rgb[o3] = 230; rgb[o3 + 1] = 60; rgb[o3 + 2] = 40; } }
  writeFileSync(`${out}/${seed}-${terrain}.png`, png(w, h, rgb));
  console.log(seed, terrain, o.terrain ? 'found' : 'drawn', 'R', R.toFixed(0));
}
