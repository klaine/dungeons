import { Rng } from '../core/rng';
import type { Town } from '../core/site';
import { anyAngle, P3 } from './geom/anyAngle';
import { MeshBuilder } from './geom/meshBuilder';
import type { Colour } from './planting';

type Wall = NonNullable<Town['cityWalls']>[number];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];

/**
 * A city's wall (`layOutCity` in `town.ts`): its curtain in lengths of a few metres, its top following the ground as it climbs and
 * falls, a walk along it behind a parapet with merlons on its outer edge; round towers at its corners and between, standing over the
 * walk, roofed with cones of slates or finished with a battlement; and over each road a gatehouse, two square towers either side of
 * the way and the wall carried over it on a lintel. Of plain solids drawn with coursed stone (`castle` among the materials), as a
 * castle's wall is (`castle.ts`), but walking over the land rather than standing level round a bailey. `inside` is a point within
 * the wall, to tell its outer side from its inner.
 */
export function buildCityWall(mesh: (material: string) => MeshBuilder, w: Wall, ground: (x: number, z: number) => number, stone: Colour, rng: Rng, inside: [number, number]): void {
  const { solid, face } = anyAngle(mesh);
  const T = w.thick, H = w.height, slate: Colour = [0.24, 0.25, 0.29], dark: Colour = [0.06, 0.06, 0.065];
  const tone = (): Colour => shade(stone, rng.range(0.9, 1.08));
  const pts = w.closed ? [...w.line, w.line[0]] : w.line;
  // (Each gate's half breadth along the wall, and the half breadth of its towers.)
  const GT = 2.6;
  const inGate = (x: number, z: number, m: number) => w.gates.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + 2 * GT + m);
  // ---- the curtain: each length cut into pieces of three metres or so, each a solid from under the ground to the walk
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    // (Outward: the side away from `inside`.)
    let ox = -uz, oz = ux;
    if ((inside[0] - (ax + bx) / 2) * ox + (inside[1] - (az + bz) / 2) * oz > 0) { ox = -ox; oz = -oz; }
    const n = Math.max(1, Math.round(len / 3));
    for (let m = 0; m < n; m++) {
      const s0 = (len * m) / n, s1 = (len * (m + 1)) / n;
      const p0: [number, number] = [ax + ux * s0, az + uz * s0], p1: [number, number] = [ax + ux * s1, az + uz * s1];
      if (inGate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0) || inGate(p0[0], p0[1], -1.5) || inGate(p1[0], p1[1], -1.5)) continue;
      const g0 = ground(p0[0], p0[1]), g1 = ground(p1[0], p1[1]), top0 = g0 + H, top1 = g1 + H, foot0 = Math.min(g0, g1) - 1.2, foot1 = foot0;
      const at = (p: [number, number], o: number, y: number): P3 => [p[0] + ox * o, y, p[1] + oz * o];
      // The wall itself, battered a little at its foot.
      solid('castle', [at(p0, -T / 2, foot0), at(p1, -T / 2, foot1), at(p1, T / 2 + 0.25, foot1), at(p0, T / 2 + 0.25, foot0), at(p0, -T / 2, top0), at(p1, -T / 2, top1), at(p1, T / 2, top1), at(p0, T / 2, top0)], tone(), 0.5);
      // The parapet on its outer edge, and a merlon on every other piece of a metre and a half.
      solid('castle', [at(p0, T / 2 - 0.5, top0), at(p1, T / 2 - 0.5, top1), at(p1, T / 2, top1), at(p0, T / 2, top0), at(p0, T / 2 - 0.5, top0 + 1.05), at(p1, T / 2 - 0.5, top1 + 1.05), at(p1, T / 2, top1 + 1.05), at(p0, T / 2, top0 + 1.05)], tone(), 0.5);
      const pieces = Math.max(1, Math.round((s1 - s0) / 1.5));
      for (let q = 0; q < pieces; q += 2) {
        const f0 = q / pieces, f1 = (q + 0.55) / pieces;
        const m0: [number, number] = [p0[0] + (p1[0] - p0[0]) * f0, p0[1] + (p1[1] - p0[1]) * f0], m1: [number, number] = [p0[0] + (p1[0] - p0[0]) * f1, p0[1] + (p1[1] - p0[1]) * f1];
        const y0 = top0 + (top1 - top0) * f0 + 1.05, y1 = top0 + (top1 - top0) * f1 + 1.05;
        solid('castle', [at(m0, T / 2 - 0.5, y0), at(m1, T / 2 - 0.5, y1), at(m1, T / 2, y1), at(m0, T / 2, y0), at(m0, T / 2 - 0.5, y0 + 0.75), at(m1, T / 2 - 0.5, y1 + 0.75), at(m1, T / 2, y1 + 0.75), at(m0, T / 2, y0 + 0.75)], tone(), 0.5);
      }
    }
  }
  // ---- the towers: round, of twelve sides, from under the ground to some metres over the walk
  const sides = 12;
  for (const tw of w.towers) {
    const g = ground(tw.x, tw.z), foot = g - 1.5, top = g + H + rng.range(2.6, 4.2), r = tw.r, roofed = rng.chance(0.6);
    const ring = (rr: number, y: number) => Array.from({ length: sides }, (_, k) => { const a = (k / sides) * Math.PI * 2; return [tw.x + Math.cos(a) * rr, y, tw.z + Math.sin(a) * rr] as P3; });
    const lo = ring(r + 0.2, foot), hi = ring(r, top), c: P3 = [tw.x, (foot + top) / 2, tw.z];
    for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; face('castle', [lo[k], lo[j], hi[j], hi[k]], tone(), c); }
    if (roofed) {
      const eave = ring(r * 1.18, top), apex: P3 = [tw.x, top + r * 2.3, tw.z];
      for (let k = 0; k < sides; k++) face('tile', [eave[k], eave[(k + 1) % sides], apex], slate, [tw.x, top, tw.z]);
      face('tile', eave, slate, apex);
    } else {
      face('castle', hi, tone(), [tw.x, top - 1, tw.z]);
      // (A battlement: merlons round the top.)
      for (let k = 0; k < sides; k += 2) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 0.7) / sides) * Math.PI * 2, o = (rr: number, a: number, y: number): P3 => [tw.x + Math.cos(a) * rr, y, tw.z + Math.sin(a) * rr];
        solid('castle', [o(r - 0.5, a0, top), o(r - 0.5, a1, top), o(r, a1, top), o(r, a0, top), o(r - 0.5, a0, top + 0.9), o(r - 0.5, a1, top + 0.9), o(r, a1, top + 0.9), o(r, a0, top + 0.9)], tone(), 0.5);
      }
    }
    // (A slit looking out, dark, a little proud of the face.)
    const oa = Math.atan2(tw.z - inside[1], tw.x - inside[0]), sx = tw.x + Math.cos(oa) * (r + 0.03), sz = tw.z + Math.sin(oa) * (r + 0.03), px = -Math.sin(oa) * 0.09, pz = Math.cos(oa) * 0.09, ys = g + H * 0.55;
    face('stone', [[sx - px, ys, sz - pz], [sx + px, ys, sz + pz], [sx + px, ys + 1, sz + pz], [sx - px, ys + 1, sz - pz]], dark, [tw.x, ys, tw.z]);
  }
  // ---- the gates: a square tower either side of the way, and the wall carried over it on a lintel, the way through under it
  for (const g of w.gates) {
    const ox = Math.cos(g.out), oz = Math.sin(g.out), ax = -oz, az = ox, half = g.w / 2, D = T + 2.2;
    const road = ground(g.x, g.z), top = road + H + 3.2, pass = road + Math.max(4.6, half + 1.5);
    const at = (a: number, d: number, y: number): P3 => [g.x + ax * a + ox * d, y, g.z + az * a + oz * d];
    for (const side of [-1, 1]) {
      const a0 = side * half, a1 = side * (half + 2 * GT), foot = Math.min(ground(g.x + ax * a0, g.z + az * a0), ground(g.x + ax * a1, g.z + az * a1)) - 1.2;
      solid('castle', [at(a0, -D / 2, foot), at(a1, -D / 2, foot), at(a1, D / 2, foot), at(a0, D / 2, foot), at(a0, -D / 2, top), at(a1, -D / 2, top), at(a1, D / 2, top), at(a0, D / 2, top)], tone(), 0.5);
      // (Its battlement.)
      for (const f of [-0.75, 0.25]) solid('castle', [at(a1 - side * 0.5, f * D, top), at(a1, f * D, top), at(a1, (f + 0.45) * D, top), at(a1 - side * 0.5, (f + 0.45) * D, top), at(a1 - side * 0.5, f * D, top + 0.9), at(a1, f * D, top + 0.9), at(a1, (f + 0.45) * D, top + 0.9), at(a1 - side * 0.5, (f + 0.45) * D, top + 0.9)], tone(), 0.5);
    }
    // The lintel over the way, and the dark of the passage's vault under it.
    solid('castle', [at(-half, -D / 2, pass), at(half, -D / 2, pass), at(half, D / 2, pass), at(-half, D / 2, pass), at(-half, -D / 2, top - 0.4), at(half, -D / 2, top - 0.4), at(half, D / 2, top - 0.4), at(-half, D / 2, top - 0.4)], tone(), 0.5);
    face('stone', [at(-half, -D / 2 + 0.05, pass - 0.02), at(half, -D / 2 + 0.05, pass - 0.02), at(half, D / 2 - 0.05, pass - 0.02), at(-half, D / 2 - 0.05, pass - 0.02)], dark, at(0, 0, pass + 1));
  }
}
