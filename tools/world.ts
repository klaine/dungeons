/**
 * Builds worlds (`src/core/world.ts`) without a browser, reports how long each stage took and what
 * was found in them, and draws each as shaded relief coloured by what lies on the land, with its
 * rivers, its towns, its ways and the places found marked; for judging a world by eye. Writes PNG files.
 *
 *   npx tsx tools/world.ts [seed or count] [out folder] [metres to a pixel]
 *
 * A number for the first argument makes that many worlds (`w0`, `w1`, …); anything else is one seed.
 * Marks: islands red rings, valley heads orange squares, mountain tops violet triangles; the harbour
 * a large black dot, towns smaller, villages smallest. Roads dark red, tracks brown, paths black and
 * broken, ferries blue and broken.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { COVER, world, worldSteps, World, WORLD_SIZE } from '../src/core/world';

const arg = process.argv[2] ?? '2', out = process.argv[3] ?? 'world-pictures', px = Number(process.argv[4] ?? 4);
const seeds = /^\d+$/.test(arg) ? Array.from({ length: Number(arg) }, (_, k) => `w${k}`) : [arg];
mkdirSync(out, { recursive: true });

/** A PNG of RGB pixels. */
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const tt = Buffer.from(t), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(Buffer.concat([tt, d]))); return Buffer.concat([l, tt, d, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Colours of what lies on the land. */
const COLOUR: Record<number, [number, number, number]> = {
  [COVER.sea]: [52, 86, 128], [COVER.lake]: [70, 110, 150], [COVER.shore]: [214, 200, 160], [COVER.marsh]: [120, 140, 110],
  [COVER.fields]: [196, 186, 120], [COVER.pasture]: [140, 170, 100], [COVER.forest]: [60, 100, 60], [COVER.moor]: [150, 130, 110],
  [COVER.rock]: [150, 145, 140], [COVER.snow]: [240, 242, 245],
};

function draw(w: World): Buffer {
  const f = w.field, hx = w.plan.hx, hz = w.plan.hz, W = Math.round((2 * hx) / px), WH = Math.round((2 * hz) / px), rgb = new Uint8Array(W * WH * 3);
  const H = new Float32Array((W + 2) * (WH + 2));
  for (let j = 0; j < WH + 2; j++) for (let i = 0; i < W + 2; i++) H[j * (W + 2) + i] = f.smoothAt(-hx + (i - 1) * px, -hz + (j - 1) * px);
  for (let j = 0; j < WH; j++) for (let i = 0; i < W; i++) {
    const k = (j + 1) * (W + 2) + i + 1, x = -hx + i * px, z = -hz + j * px;
    const gx = (H[k + 1] - H[k - 1]) / (2 * px), gz = (H[k + W + 2] - H[k - W - 2]) / (2 * px);
    // (Light from the north-west, high, as maps are shaded; a little exaggerated, so the low country's swells show.)
    const nl = Math.hypot(gx * 2, 1, gz * 2), shade = Math.max(0, (gx * 2 * 0.5 + 0.75 + gz * 2 * 0.43) / nl);
    const fi = Math.min(f.nx - 1, Math.max(0, Math.round((x - f.x0) / f.cell))), fj = Math.min(f.nz - 1, Math.max(0, Math.round((z - f.z0) / f.cell)));
    const c = w.cover[fj * f.nx + fi], col = COLOUR[c];
    const lit = c === COVER.sea || c === COVER.lake ? 1 : 0.35 + 0.8 * shade;
    // (The sea darker where it is deep.)
    const deep = c === COVER.sea ? Math.max(0.55, 1 + H[k] / 80) : 1;
    const o = (j * W + i) * 3;
    for (let q = 0; q < 3; q++) rgb[o + q] = Math.max(0, Math.min(255, col[q] * lit * deep));
  }
  const dot = (x: number, z: number, c: [number, number, number], r = 0) => {
    const ci = Math.round((x + hx) / px), cj = Math.round((z + hz) / px);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= WH || di * di + dj * dj > r * r + r) continue;
      const o = (j * W + i) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  };
  const line = (pts: [number, number][], c: [number, number, number], r = 0, gap = 0, widths?: number[]) => {
    let walked = 0;
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k], len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / (px * 0.5));
      for (let s = 0; s <= steps; s++) {
        const d = walked + (len * s) / steps;
        if (gap && Math.floor(d / gap) % 2) continue;
        const rr = widths ? Math.max(0, Math.round(widths[k] / px / 2)) : r;
        dot(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps, c, rr);
      }
      walked += len;
    }
  };
  for (const r of w.rivers) line(r.points, [60, 100, 160], 0, 0, r.width);
  const WAY: Record<string, { c: [number, number, number]; r: number; gap: number }> = {
    road: { c: [150, 30, 20], r: 1, gap: 0 }, track: { c: [110, 70, 30], r: 0, gap: 0 }, path: { c: [20, 20, 20], r: 0, gap: 90 }, ferry: { c: [180, 220, 255], r: 0, gap: 150 },
  };
  for (const way of w.ways) line(way.points, WAY[way.kind].c, WAY[way.kind].r, WAY[way.kind].gap);
  for (const t of w.towns) dot(t.x, t.z, [10, 10, 10], t.kind === 'harbour' ? 6 : t.kind === 'town' ? 4 : 2);
  for (const q of w.places) {
    const ci = (q.x + hx) / px, cj = (q.z + hz) / px, c: [number, number, number] = q.kind === 'island' ? [230, 40, 40] : q.kind === 'valley' ? [250, 150, 20] : [170, 60, 230];
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      if (q.kind === 'island') for (const r of [7, 8]) dot((ci + Math.cos(t) * r) * px - hx, (cj + Math.sin(t) * r) * px - hz, c);
    }
    if (q.kind === 'valley') for (let d = -6; d <= 6; d++) for (const e of [-6, 6]) { dot(q.x + d * px, q.z + e * px, c, 1); dot(q.x + e * px, q.z + d * px, c, 1); }
    if (q.kind === 'mountain') for (let d = 0; d <= 10; d++) { dot(q.x + (d - 10) * 0.6 * px, q.z + (d - 5) * px, c, 1); dot(q.x - (d - 10) * 0.6 * px, q.z + (d - 5) * px, c, 1); dot(q.x + (d - 5) * 1.2 * px, q.z + 5 * px, c, 1); }
  }
  return png(W, WH, rgb);
}

// (`SIZE=8x8` before the command makes worlds of that many kilometres east and west by north and south.)
const size = process.env.SIZE ? { x: Number(process.env.SIZE.split('x')[0]) * 1000, z: Number(process.env.SIZE.split('x')[1]) * 1000 } : WORLD_SIZE;
for (const seed of seeds) {
  const t0 = performance.now();
  // (A stage at a time, so the time each took is seen as it goes.)
  const steps = worldSteps(seed, size);
  for (let s = steps.next(); !s.done; s = steps.next()) process.stdout.write(`  ${s.value}\r`);
  const w = world(seed, size), t1 = performance.now();
  const count = (k: string) => w.places.filter((q) => q.kind === k).length;
  const covers = Object.entries(COVER).map(([name, c]) => `${name} ${((100 * w.cover.filter((v) => v === c).length) / w.cover.length).toFixed(0)}%`).join(', ');
  const h = w.field.data;
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const stages = Object.entries(w.timing).filter(([k]) => !/ \d/.test(k)).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', ');
  const tiles = Object.entries(w.timing).filter(([k]) => / \d/.test(k)), tileTime = tiles.reduce((s, [, v]) => s + v, 0);
  console.log(`${seed}: built in ${((t1 - t0) / 1000).toFixed(1)} s (${stages}; ${tiles.length} tiles ${(tileTime / 1000).toFixed(1)} s)`);
  console.log(`  ${2 * w.plan.hx / 1000} by ${2 * w.plan.hz / 1000} km; land ${lo.toFixed(0)} to ${hi.toFixed(0)} m; inland ${((w.plan.inland * 180) / Math.PI).toFixed(0)}°, plains ${(w.plan.plains / 1000).toFixed(1)} km, upland ${(w.plan.upland / 1000).toFixed(1)} km, great peaks ${w.peaks.map((q) => Math.round(q.y)).join(", ")} m`);
  console.log(`  ${covers}`);
  console.log(`  found: ${count('island')} islands, ${count('valley')} valley heads, ${count('mountain')} mountain tops; ${w.towns.length} towns (${w.towns.filter((t) => t.kind !== 'village').length} not villages); ${w.rivers.length} rivers; ways ${['road', 'track', 'path', 'ferry'].map((k) => `${w.ways.filter((q) => q.kind === k).length} ${k}`).join(', ')}`);
  for (const [k, why] of Object.entries(w.why)) console.log(`  ${k} turned down: ${Object.entries(why).map(([a, b]) => `${a} ${b}`).join(', ') || 'none'}`);
  for (const q of w.places) console.log(`    ${q.kind} ${q.n}: ${q.x.toFixed(0)}, ${q.z.toFixed(0)} at ${q.y.toFixed(0)} m${q.island ? `, island reaching ${q.island.reach.toFixed(0)} m` : ''}${q.ridge ? `, ridge to ${((q.ridge.angle * 180) / Math.PI).toFixed(0)}°, foot at ${q.ridge.footY.toFixed(0)} m` : ''}`);
  writeFileSync(`${out}/${seed}.png`, draw(w));
}
