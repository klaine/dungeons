/**
 * Lays out harbour towns as cities (the plan `city`, `layOutCity` in `src/core/town.ts`) and draws each one's plan as a PNG, without a
 * browser: the land shaded by height, the sea, the river, the streets by breadth, the blocks (classical, timber, parks), the square
 * and the house's terrace, the buildings, shacks and storehouses, the moles, and the walls with their towers and gates (in red, with
 * the way out). For judging a city's layout by eye.
 *
 *   npx tsx tools/cityPlan.ts <seed> <out.png>
 *
 * `CITY='size=medium walls=1 citadel=1 river=1 greens=1 shantytown=0 gates=3'` before it asks for a city's settings, by the names
 * watabou's generator gives them; what is not asked is dealt. `WORLD=w2 N=1` builds it at a world's first coastal town, its main
 * streets coming in where the world's roads do (half a minute more, to make the world).
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateSite } from '../src/core/generate';
import { cityAskedFromWords, naturalLand, outlineOf, squareRing, townBounds } from '../src/core/town';
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
type P = [number, number]; type Col = [number, number, number];
const seed = process.argv[2] ?? 'city0', out = process.argv[3] ?? `${seed}-plan.png`;
const t0 = performance.now();
const world = process.env.WORLD ? { seed: process.env.WORLD, n: Number(process.env.N ?? 1) } : undefined;
const site = generateSite(seed, 'town', { townPlan: 'city', city: cityAskedFromWords(process.env.CITY), ...(world ? { world } : {}) });
const ms = performance.now() - t0;
const t = site.town!, F = site.places.find((p) => p.role === 'approach')!.floor;
const b = townBounds(t, 40), S = 1.5, W = Math.round((b.x1 - b.x0) * S), H = Math.round((b.z1 - b.z0) * S);
const rgb = new Uint8Array(W * H * 3);
const nat = naturalLand(t, F);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = b.x0 + i / S, z = b.z0 + j / S, y = nat.holds(x, z) ? nat.at(x, z) : 0, h = y - t.sea, k = (j * W + i) * 3;
  const c: Col = h < 0 ? [150, 180, 196] : (() => { const v = Math.max(110, 228 - h * 1.6); return [v, v * 0.95, v * 0.82]; })();
  rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2];
}
const fillPoly = (pts: P[], c: Col) => {
  if (pts.length < 3) return;
  const ps = pts.map(([x, z]) => [(x - b.x0) * S, (z - b.z0) * S] as P);
  const y0 = Math.max(0, Math.floor(Math.min(...ps.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ps.map((p) => p[1]))));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [], yy = y + 0.5;
    for (let k = 0; k < ps.length; k++) { const [ax, ay] = ps[k], [bx, by] = ps[(k + 1) % ps.length]; if ((ay <= yy) !== (by <= yy)) xs.push(ax + ((yy - ay) * (bx - ax)) / (by - ay)); }
    xs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < xs.length; m += 2) for (let x = Math.max(0, Math.ceil(xs[m] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[m + 1] - 0.5)); x++) { const k = (y * W + x) * 3; rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2]; }
  }
};
const disc = (x: number, z: number, r: number, c: Col) => fillPoly(Array.from({ length: 12 }, (_, k) => [x + r * Math.cos((k * Math.PI) / 6), z + r * Math.sin((k * Math.PI) / 6)] as P), c);
const line = (pts: P[], w: number, c: Col) => {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], l = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / l) * (w / 2), nz = ((bx - ax) / l) * (w / 2);
    fillPoly([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], c);
    disc(bx, bz, w / 2, c);
  }
  if (pts.length) disc(pts[0][0], pts[0][1], w / 2, c);
};
if (t.river) line(t.river.line.map(([x, z]) => [x, z] as P), 11, [110, 145, 170]);
for (const st of t.streets) line(st.line.map(([x, z]) => [x, z] as P), st.width, st.kind === 'track' ? [190, 165, 125] : st.kind === 'lane' ? [215, 205, 180] : st.width > 6.6 ? [250, 245, 230] : [232, 224, 204]);
for (const bl of t.blocks) fillPoly(bl.corners ?? [], bl.kind === 'green' ? [150, 190, 120] : bl.kind === 'classical' ? [235, 200, 150] : [200, 215, 170]);
fillPoly(squareRing(t), [246, 240, 224]);
fillPoly([[t.level.x0, t.level.z0], [t.level.x1, t.level.z0], [t.level.x1, t.level.z1], [t.level.x0, t.level.z1]], [150, 110, 120]);
for (const m of t.moles) line(m.line, m.width, [120, 120, 120]);
if (t.citadel) {
  const c = t.citadel.castle, k = t.citadel.keep;
  line([...c.wall, c.wall[0]], c.thick, [40, 40, 40]);
  for (const tw of c.towers) disc(tw.x, tw.z, tw.r, [40, 40, 40]);
  fillPoly([[k.x - k.half, k.z - k.half], [k.x + k.half, k.z - k.half], [k.x + k.half, k.z + k.half], [k.x - k.half, k.z + k.half]], [20, 20, 20]);
  disc(c.gate.x, c.gate.z, 3, [200, 30, 30]);
}
for (const bd of t.buildings) for (const r of outlineOf(bd)) fillPoly(r, bd.style === 'imperial' ? [168, 120, 84] : bd.style === 'canal' ? [130, 70, 60] : bd.style === 'brick' ? (bd.brickwork?.kind === 'church' ? [120, 30, 30] : bd.brickwork?.kind === 'store' ? [150, 60, 40] : [178, 80, 60]) : bd.style === 'chapel' ? [230, 230, 220] : bd.style === 'shed' ? [70, 60, 50] : [105, 88, 72]);
for (const s of t.shacks) disc(s.x, s.z, 2.4, [60, 60, 60]);
for (const s of t.storehouses) disc(s.x, s.z, 3, [150, 40, 30]);
for (const w of t.cityWalls ?? []) {
  line([...w.line, ...(w.closed ? [w.line[0]] : [])], w.thick, [40, 40, 40]);
  for (const tw of w.towers) disc(tw.x, tw.z, tw.r, [40, 40, 40]);
  for (const g of w.gates) { disc(g.x, g.z, 4.5, [200, 30, 30]); line([[g.x, g.z], [g.x + Math.cos(g.out) * 12, g.z + Math.sin(g.out) * 12]], 1.5, [200, 30, 30]); }
}
writeFileSync(out, png(W, H, rgb));
const styles = new Map<string, number>(); for (const bd of t.buildings) { const k = bd.style === 'brick' ? `brick ${bd.brickwork?.kind}` : bd.style; styles.set(k, (styles.get(k) ?? 0) + 1); }
console.log(seed, t.plan, JSON.stringify(Object.fromEntries(styles)), t.citadel ? `citadel keep, ${t.citadel.castle.towers.length} towers, ${t.citadel.castle.ranges?.length ?? 0} ranges` : 'no citadel', 'buildings', t.buildings.length, 'blocks', t.blocks.length, 'streets', t.streets.length, 'walls', t.cityWalls?.length ?? 0, `${ms.toFixed(0)} ms`, JSON.stringify(t.city), `${W}x${H}`);
