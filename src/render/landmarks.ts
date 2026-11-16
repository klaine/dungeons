import { Rng } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';

/**
 * What stands on the hills beyond the valley: a castle, a lone tower, the ruin of an abbey, a
 * monument. They are three hundred metres off and more, behind haze, and are seen as shapes
 * against the sky and as light and shade on their faces; so they are built of large plain
 * solids, square and many-sided, with only what reads at that distance: battlements, roofs,
 * the dark of a great window, broken tops. Each is laid out about its own middle and turned to
 * face the valley.
 */

type Colour = [number, number, number];

export function buildLandmark(
  kind: 'castle' | 'tower' | 'ruin' | 'monument', x: number, y: number, z: number, facing: number,
  mesh: (material: string) => MeshBuilder, rng: Rng, stone: Colour,
): void {
  const c = Math.cos(facing), s = Math.sin(facing);
  // From the landmark's own measures (`a` across its front, `b` back from it, `h` up) to the world.
  // (Built larger than life: at three hundred metres and more, a tower of real size is a speck. Castles less so, being broad.)
  const grand = kind === 'castle' ? 1.2 : 1.55;
  const at = (a: number, b: number, h: number): [number, number, number] => [x + (c * b - s * a) * grand, y + h * grand, z + (s * b + c * a) * grand];
  let count = 0;
  const tone = (lift = 1): Colour => { const t = (0.9 + 0.2 * (((count++ * 7919) % 11) / 11)) * lift; return [stone[0] * t, stone[1] * t, stone[2] * t]; };
  /** A flat face through the given corners, wound to face away from `inside`. */
  const face = (material: string, pts: [number, number, number][], colour: Colour, inside: [number, number, number]) => {
    const m = mesh(material);
    const [p0, p1, p2] = pts, ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mid = pts.reduce((m2, p) => [m2[0] + p[0] / pts.length, m2[1] + p[1] / pts.length, m2[2] + p[2] / pts.length], [0, 0, 0]);
    const flip = (mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz < 0;
    const list = flip ? [...pts].reverse() : pts;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    // (Texture laid by where the point is, at a coarse scale: stone courses a metre or so high, read as banding.)
    const ids = list.map((p) => m.addVertex(p[0], p[1], p[2], nx, ny, nz, (p[0] * Math.abs(nz) + p[2] * Math.abs(nx) + p[0] * Math.abs(ny)) * 0.18, (p[1] * (1 - Math.abs(ny)) + p[2] * Math.abs(ny)) * 0.18, colour[0], colour[1], colour[2]));
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
  };
  /** A block, in the landmark's measures: from `a0` to `a1` across, `b0` to `b1` back, `h0` to `h1` up. */
  const block = (material: string, a0: number, a1: number, b0: number, b1: number, h0: number, h1: number, colour: Colour = tone()) => {
    const mid = at((a0 + a1) / 2, (b0 + b1) / 2, (h0 + h1) / 2);
    const p = (a: number, b: number, h: number) => at(a, b, h);
    face(material, [p(a0, b0, h1), p(a1, b0, h1), p(a1, b1, h1), p(a0, b1, h1)], colour, mid);
    face(material, [p(a0, b0, h0), p(a1, b0, h0), p(a1, b1, h0), p(a0, b1, h0)], colour, mid);
    face(material, [p(a0, b0, h0), p(a1, b0, h0), p(a1, b0, h1), p(a0, b0, h1)], colour, mid);
    face(material, [p(a0, b1, h0), p(a1, b1, h0), p(a1, b1, h1), p(a0, b1, h1)], colour, mid);
    face(material, [p(a0, b0, h0), p(a0, b1, h0), p(a0, b1, h1), p(a0, b0, h1)], colour, mid);
    face(material, [p(a1, b0, h0), p(a1, b1, h0), p(a1, b1, h1), p(a1, b0, h1)], colour, mid);
  };
  /** A many-sided tower about (`a`, `b`), `r` across the half of it, narrowing to `top` times as wide; and, if `cap` is given, a pointed roof that high over it. */
  const round = (a: number, b: number, r: number, h0: number, h1: number, sides = 8, top = 1, cap = 0, colour: Colour = tone()) => {
    const mid = at(a, b, (h0 + h1) / 2), ring = (rr: number, h: number) => Array.from({ length: sides }, (_, k) => at(a + Math.cos((k / sides) * Math.PI * 2) * rr, b + Math.sin((k / sides) * Math.PI * 2) * rr, h));
    const lo = ring(r, h0), hi = ring(r * top, h1);
    for (let n = 0; n < sides; n++) face('stone', [lo[n], lo[(n + 1) % sides], hi[(n + 1) % sides], hi[n]], colour, mid);
    face('stone', hi, colour, mid);
    face('stone', lo, colour, mid);
    if (cap > 0) {
      const eave = ring(r * top * 1.12, h1), apex = at(a, b, h1 + cap), roof: Colour = [0.32, 0.18, 0.14];
      for (let n = 0; n < sides; n++) face('tile', [eave[n], eave[(n + 1) % sides], apex], roof, at(a, b, h1));
      face('tile', eave, roof, apex);
    }
  };
  /** Battlements along a wall's top, from (`a0`,`b0`) to (`a1`,`b1`), `t` thick, at height `h`. */
  const merlons = (a0: number, b0: number, a1: number, b1: number, t: number, h: number) => {
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.max(2, Math.round(len / 2.4));
    for (let k = 0; k < n; k++) {
      const f0 = (k + 0.2) / n, f1 = (k + 0.7) / n, pa = a0 + (a1 - a0) * f0, pb = b0 + (b1 - b0) * f0, qa = a0 + (a1 - a0) * f1, qb = b0 + (b1 - b0) * f1;
      block('stone', Math.min(pa, qa) - (a1 === a0 ? t / 2 : 0), Math.max(pa, qa) + (a1 === a0 ? t / 2 : 0), Math.min(pb, qb) - (b1 === b0 ? t / 2 : 0), Math.max(pb, qb) + (b1 === b0 ? t / 2 : 0), h, h + 1.4);
    }
  };
  /** A square tower with battlements and a corbelled parapet. */
  const keep = (a: number, b: number, half: number, h: number) => {
    block('stone', a - half, a + half, b - half, b + half, -6, h);
    block('stone', a - half - 0.6, a + half + 0.6, b - half - 0.6, b + half + 0.6, h, h + 1.2);
    merlons(a - half - 0.3, b - half - 0.3, a + half + 0.3, b - half - 0.3, 0.6, h + 1.2);
    merlons(a - half - 0.3, b + half + 0.3, a + half + 0.3, b + half + 0.3, 0.6, h + 1.2);
    merlons(a - half - 0.3, b - half - 0.3, a - half - 0.3, b + half + 0.3, 0.6, h + 1.2);
    merlons(a + half + 0.3, b - half - 0.3, a + half + 0.3, b + half + 0.3, 0.6, h + 1.2);
    // Narrow windows, dark, up its face: what makes it read as a tower and not a block.
    for (let y = 6; y < h - 3; y += 5.5) for (const fa of [-half * 0.4, half * 0.4]) block('stone', a + fa - 0.35, a + fa + 0.35, b - half - 0.05, b - half + 0.2, y, y + 2.2, [0.05, 0.05, 0.06]);
  };

  if (kind === 'tower') {
    // A lone tower on a hilltop, round or square, with a stair turret beside it, and perhaps a roof.
    const square = rng.chance(0.45), h = rng.range(22, 32), r = rng.range(4.2, 5.6);
    if (square) keep(0, 0, r, h);
    else {
      round(0, 0, r, -6, h, 12, 0.94, rng.chance(0.5) ? r * 1.9 : 0);
      for (let y = 7; y < h - 3; y += 6) block('stone', -0.35, 0.35, -r * 0.95, -r * 0.8, y, y + 2.4, [0.05, 0.05, 0.06]);
    }
    round(r * 0.95, r * 0.6, r * 0.38, -4, h + 3, 8, 1, rng.chance(0.6) ? r * 0.9 : 0);
    // And a low wall about its foot.
    for (const [a0, b0, a1, b1] of [[-r * 2.3, -r * 2.3, r * 2.3, -r * 2.3], [-r * 2.3, r * 2.3, r * 2.3, r * 2.3], [-r * 2.3, -r * 2.3, -r * 2.3, r * 2.3], [r * 2.3, -r * 2.3, r * 2.3, r * 2.3]]) {
      block('stone', Math.min(a0, a1) - 0.6, Math.max(a0, a1) + 0.6, Math.min(b0, b1) - 0.6, Math.max(b0, b1) + 0.6, -3, 3.2);
    }
  } else if (kind === 'castle') {
    // A curtain wall about a court, a tower at each corner, a gate in its face between two more, and a great keep.
    const W = rng.range(22, 30), D = rng.range(16, 22), wallH = rng.range(9, 12), t = 2.4;
    for (const [a0, a1, b0, b1] of [[-W, W, -D - t / 2, -D + t / 2], [-W, W, D - t / 2, D + t / 2], [-W - t / 2, -W + t / 2, -D, D], [W - t / 2, W + t / 2, -D, D]]) {
      // (The face towards the valley is broken for the gate.)
      if (b0 < -D + 1 && b1 < -D + 2) {
        block('stone', a0, -3.5, b0, b1, -5, wallH);
        block('stone', 3.5, a1, b0, b1, -5, wallH);
        block('stone', -3.5, 3.5, b0, b1, wallH - 3.2, wallH);
      } else block('stone', a0, a1, b0, b1, -5, wallH);
    }
    merlons(-W, -D - t / 2, W, -D - t / 2, 0.7, wallH);
    merlons(-W, D + t / 2, W, D + t / 2, 0.7, wallH);
    merlons(-W - t / 2, -D, -W - t / 2, D, 0.7, wallH);
    merlons(W + t / 2, -D, W + t / 2, D, 0.7, wallH);
    const roofs = rng.chance(0.55);
    for (const [a, b] of [[-W, -D], [W, -D], [-W, D], [W, D]]) round(a, b, 4.2, -6, wallH + 6, 10, 0.95, roofs ? 6.5 : 0);
    for (const a of [-5.6, 5.6]) round(a, -D - 1.2, 3.2, -5, wallH + 4, 8, 1, roofs ? 4.5 : 0);
    keep(rng.range(-W * 0.35, W * 0.35), rng.range(0, D * 0.4), rng.range(6, 8), rng.range(24, 32));
    // Roofs of the buildings along the inside of the walls, showing over them.
    for (const side of [-1, 1]) {
      const b0 = side * (D - t / 2) - side * 6.5, b1 = side * (D - t / 2);
      block('stone', -W * 0.7, W * 0.7, Math.min(b0, b1), Math.max(b0, b1), -2, wallH + 1.2);
      const ridge = wallH + 5.5, bm = (b0 + b1) / 2;
      face('tile', [at(-W * 0.7, b0, wallH + 1.2), at(W * 0.7, b0, wallH + 1.2), at(W * 0.7, bm, ridge), at(-W * 0.7, bm, ridge)], [0.33, 0.19, 0.15], at(0, bm, wallH));
      face('tile', [at(-W * 0.7, b1, wallH + 1.2), at(W * 0.7, b1, wallH + 1.2), at(W * 0.7, bm, ridge), at(-W * 0.7, bm, ridge)], [0.33, 0.19, 0.15], at(0, bm, wallH));
    }
  } else if (kind === 'ruin') {
    // The ruin of an abbey church: its west front standing with the great window empty, the walls
    // of its nave broken down to stumps along their length, and the stump of a tower at the crossing.
    const L = rng.range(30, 40), half = rng.range(6.5, 8.5), gable = rng.range(18, 24), t = 1.6;
    block('stone', -half, -2.6, -t / 2, t / 2, -4, gable - 4);
    block('stone', 2.6, half, -t / 2, t / 2, -4, gable - 4);
    block('stone', -2.6, 2.6, -t / 2, t / 2, -4, 2.5);
    block('stone', -2.6, 2.6, -t / 2, t / 2, gable - 6.5, gable - 4);
    // The point of the gable, as three steps narrowing.
    for (let k = 0; k < 3; k++) block('stone', -half * (0.8 - k * 0.25), half * (0.8 - k * 0.25), -t / 2, t / 2, gable - 4 + k * 1.5, gable - 2.5 + k * 1.5);
    for (const a of [-half, half]) {
      let b = t / 2;
      while (b < L) {
        const len = rng.range(3, 7), hh = Math.max(1.5, rng.range(2, 13) * (1 - b / L * 0.5));
        block('stone', a - t / 2, a + t / 2, b, Math.min(L, b + len), -4, hh);
        b += len + (rng.chance(0.3) ? rng.range(2, 5) : 0);
      }
    }
    // Buttresses on the gable's corners, and the crossing tower's stump.
    for (const a of [-half - 0.9, half + 0.9]) block('stone', a - 0.9, a + 0.9, -1.8, 0.8, -4, gable * 0.75);
    block('stone', -half * 0.9, half * 0.9, L * 0.62, L * 0.62 + half * 1.8, -4, rng.range(10, 16));
  } else {
    // A monument: an obelisk on three broad steps, with a ring of standing stones or a low rail round it.
    const base = rng.range(5, 7), tall = rng.range(24, 32);
    for (let k = 0; k < 3; k++) block('stone', -base + k * 1.4, base - k * 1.4, -base + k * 1.4, base - k * 1.4, -3 + k * 1.2, -1.8 + k * 1.2, tone(1.1));
    const w0 = rng.range(1.6, 2.0), w1 = w0 * 0.62;
    const p = (a: number, b: number, h: number) => at(a, b, h);
    const mid = p(0, 0, 1.8 + tall / 2), col = tone(1.15);
    const lo = [p(-w0, -w0, 1.8), p(w0, -w0, 1.8), p(w0, w0, 1.8), p(-w0, w0, 1.8)], hi = [p(-w1, -w1, 1.8 + tall), p(w1, -w1, 1.8 + tall), p(w1, w1, 1.8 + tall), p(-w1, w1, 1.8 + tall)];
    for (let k = 0; k < 4; k++) face('stone', [lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]], col, mid);
    const apex = p(0, 0, 1.8 + tall + w1 * 1.7);
    for (let k = 0; k < 4; k++) face('stone', [hi[k], hi[(k + 1) % 4], apex], col, mid);
  }
}
