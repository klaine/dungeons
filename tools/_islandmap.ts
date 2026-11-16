import { writeFileSync } from 'fs';
import { generateSite } from '../src/core/generate';
import { landAt, inland } from '../src/core/island';
import { solve } from '../src/core/mission';
const out = process.argv[2], seeds = process.argv.slice(3);
for (const seed of seeds) {
  const t = performance.now();
  const site = generateSite(seed, 'island');
  const o = site.island!, F = site.places.find((p) => p.role === 'approach')!.floor;
  console.log(seed, (performance.now() - t).toFixed(0) + 'ms', 'solvable', solve(site).ok, 'cottages', o.cottages.length, 'lh', !!o.lighthouse, 'castle', !!o.castle, 'stacks', o.stacks.length, 'cave', !!o.seaCave, 'sea', o.sea, 'combe', o.combe, site.title.slice(0, 80));
  const g = site.grounds!, S = 1, x0 = g.x0 - 50, z0 = g.z0 - 50, W = Math.round((g.x1 - g.x0 + 100) / S), H = Math.round((g.z1 - g.z0 + 100) / S);
  const px = Buffer.alloc(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i * S, z = z0 + j * S, y = landAt(o, F, x, z), k = (j * W + i) * 3;
    let c: number[];
    if (y < o.sea) { const d = Math.min(1, (o.sea - y) / 20); c = [20, 60 + 80 * (1 - d), 110 + 90 * (1 - d)]; }
    else { const h = (y - o.sea) / 40; c = inland(o, x, z) < 0 ? [140, 130, 110] : [60 + 150 * h, 120 + 100 * h, 50 + 60 * h]; }
    px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2];
  }
  const mark = (x: number, z: number, c: number[], r = 1) => { for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = Math.round((x - x0) / S) + di, j = Math.round((z - z0) / S) + dj; if (i >= 0 && j >= 0 && i < W && j < H) px.set(c, (j * W + i) * 3); } };
  for (const p of site.places) for (let x = p.x0; x <= p.x1; x += 0.5) { mark(x, p.z0, [0, 0, 0], 0); mark(x, p.z1, [0, 0, 0], 0); }
  for (const p of site.places) for (let z = p.z0; z <= p.z1; z += 0.5) { mark(p.x0, z, [0, 0, 0], 0); mark(p.x1, z, [0, 0, 0], 0); }
  const tr = site.track!; for (let k = 0; k < tr.length - 1; k++) for (let t = 0; t < 1; t += 0.05) mark(tr[k][0] + (tr[k + 1][0] - tr[k][0]) * t, tr[k][1] + (tr[k + 1][1] - tr[k][1]) * t, [230, 200, 120]);
  for (const p of site.paths ?? []) for (const [x, z] of p.points) mark(x, z, [250, 240, 200]);
  for (const c of o.cottages) mark(c.x, c.z, [255, 255, 255], 3);
  if (o.lighthouse) mark(o.lighthouse.x, o.lighthouse.z, [255, 0, 0], 3);
  if (o.castle) mark(o.castle.x, o.castle.z, [80, 80, 80], 8);
  for (const b of o.boats) mark(b.x, b.z, [120, 60, 20], 1);
  if (o.seaCave) mark(o.seaCave.x, o.seaCave.z, [0, 0, 0], 2);
  const head = `P6 ${W} ${H} 255\n`;
  writeFileSync(`${out}/${seed}.ppm`, Buffer.concat([Buffer.from(head), px]));
}
