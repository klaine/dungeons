import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { Building } from '../core/site';
import { MeshBuilder } from './geom/meshBuilder';
import { layBeam } from './geom/timber';

/**
 * Buildings that stand by themselves and are seen from outside. The site document says what a
 * building is in a few numbers (its style, its size, its storeys, its bays and its colour); this
 * makes it, piece by piece: every timber, every moulding, every pane is a closed solid of its
 * own, so the light catches them as it would. Nothing is drawn on. There are two styles.
 *
 * A building is laid out in measures of its own: `s` along a wall from its left end as seen from
 * outside, `y` up from the ground it stands on, `t` into the wall from its face. The four walls
 * are the front, then round by the right. A wall with openings is built as what is left of it:
 * the piers between, the breast under each and the head over each.
 */

type Colour = [number, number, number];
/** A wall seen from outside: how long it is, and where a place on it is in the world. */
interface Face { L: number; P: (s: number, y: number, t: number) => Vector3 }
interface Gap { s0: number; s1: number; y0: number; y1: number }

const OAK: Colour = [0.2, 0.13, 0.085], WHITE: Colour = [0.9, 0.89, 0.85], PANE: Colour = [0.04, 0.055, 0.075], LIMEWASH: Colour = [0.86, 0.84, 0.78];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];

/** The tools: where things are, and solids to build with. */
function tools(b: Building, base: number, mesh: (material: string) => MeshBuilder) {
  const turn = b.faces === 'w' ? 1 : -1;
  // From the building's own measures (along its front, up, back from its front) to the world.
  const at = (u: number, y: number, v: number) => new Vector3(b.x - (turn * b.d) / 2 + turn * v, base + y, b.z + turn * u);
  let count = 0;
  const A = new Vector3(), B = new Vector3(), N = new Vector3(), U = new Vector3(), V = new Vector3();
  /** One flat face of a solid, through the given corners, facing `out`. `grain` lays the texture along its longer way, as timber wants. */
  const poly = (material: string, pts: Vector3[], colour: Colour, out: Vector3, grain = false, scale = 0.5) => {
    const m = mesh(material);
    N.crossVectors(A.subVectors(pts[1], pts[0]), B.subVectors(pts[2], pts[0])).normalize();
    const list = N.dot(out) < 0 ? [...pts].reverse() : pts;
    if (N.dot(out) < 0) N.negate();
    if (Math.abs(N.y) > 0.95) { U.set(1, 0, 0); V.set(0, 0, 1); } else { U.set(N.z, 0, -N.x).normalize(); V.crossVectors(N, U); if (V.y < 0) V.negate(); }
    if (grain) {
      let lu = 0, lv = 0;
      for (const p of list) { lu = Math.max(lu, Math.abs(A.subVectors(p, list[0]).dot(U))); lv = Math.max(lv, Math.abs(A.dot(V))); }
      if (lv > lu) { A.copy(U); U.copy(V); V.copy(A); }
    }
    const ids = list.map((p) => m.addVertex(p.x, p.y, p.z, N.x, N.y, N.z, p.dot(U) * scale, p.dot(V) * scale, colour[0], colour[1], colour[2]));
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
  };
  /** A block between two opposite corners, square to the world. No two are quite the same tone. */
  const block = (material: string, a: Vector3, c: Vector3, colour: Colour, grain = false) => {
    const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x), y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y), z0 = Math.min(a.z, c.z), z1 = Math.max(a.z, c.z);
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const col = shade(colour, 0.94 + 0.12 * (((count++ * 7919) % 13) / 13)), scale = grain ? 0.9 : 0.5;
    const p = (x: number, y: number, z: number) => new Vector3(x, y, z);
    poly(material, [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], col, p(1, 0, 0), grain, scale);
    poly(material, [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)], col, p(-1, 0, 0), grain, scale);
    poly(material, [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)], col, p(0, 1, 0), grain, scale);
    poly(material, [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], col, p(0, -1, 0), grain, scale);
    poly(material, [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], col, p(0, 0, 1), grain, scale);
    poly(material, [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)], col, p(0, 0, -1), grain, scale);
  };
  /** A block given in the building's own measures. */
  const box = (material: string, u0: number, u1: number, y0: number, y1: number, v0: number, v1: number, colour: Colour, grain = false) => block(material, at(u0, y0, v0), at(u1, y1, v1), colour, grain);
  /** A block set in a wall. */
  const on = (f: Face, material: string, s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, colour: Colour, grain = false) => block(material, f.P(s0, y0, t0), f.P(s1, y1, t1), colour, grain);
  /** A squared length of timber from one point to another. */
  const stick = (from: Vector3, to: Vector3, thick: number, broad: number, colour: Colour, material = 'wood') => layBeam(mesh(material), from, to, thick, broad, shade(colour, 0.92 + 0.16 * (((count++ * 104729) % 11) / 11)), count * 0.173);
  /** The four walls of a storey whose front stands at `front` (less than nothing if it stands out over the street). */
  const walls = (front: number, w = b.w, d = b.d): Face[] => [
    { L: w, P: (s, y, t) => at(-w / 2 + s, y, front + t) },
    { L: d - front, P: (s, y, t) => at(w / 2 - t, y, front + s) },
    { L: w, P: (s, y, t) => at(w / 2 - s, y, d - t) },
    { L: d - front, P: (s, y, t) => at(-w / 2 + t, y, d - s) },
  ];
  /** A stretch of wall with openings in it: what is left of the wall, as blocks. `bands` cuts it into courses with a dark joint between, as rusticated work is. */
  const pierced = (f: Face, material: string, s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, colour: Colour, gaps: Gap[], bands = 0) => {
    const piece = (a: number, c: number, lo: number, hi: number) => {
      if (c - a < 0.01 || hi - lo < 0.01) return;
      if (!bands) { on(f, material, a, c, lo, hi, t0, t1, colour); return; }
      on(f, material, a, c, lo, hi, t0 + 0.045, t1, shade(colour, 0.5));
      // (Courses are counted from the foot of the whole wall, so that they run level across every piece of it.)
      for (let y = y0; y < hi - 0.01; y += bands) {
        const from = Math.max(lo, y), to = Math.min(hi, y + bands - 0.055);
        if (to - from > 0.03) on(f, material, a, c, from, to, t0, t0 + 0.06, colour);
      }
    };
    const sorted = gaps.filter((g) => g.s1 > s0 && g.s0 < s1).sort((a, c) => a.s0 - c.s0);
    let s = s0;
    for (const g of sorted) {
      piece(s, g.s0, y0, y1);
      piece(g.s0, g.s1, y0, g.y0);
      piece(g.s0, g.s1, g.y1, y1);
      s = g.s1;
    }
    piece(s, s1, y0, y1);
  };
  /** What stands in a window opening: the frame, the bars that divide it, and the glass behind them. */
  const glazed = (f: Face, g: Gap, across: number, down: number, frame: Colour, deep = 0.1) => {
    const w = g.s1 - g.s0, h = g.y1 - g.y0;
    on(f, 'glass', g.s0, g.s1, g.y0, g.y1, deep + 0.05, deep + 0.08, PANE);
    for (const [a, c] of [[g.s0, g.s0 + 0.07], [g.s1 - 0.07, g.s1]]) on(f, 'wood', a, c, g.y0, g.y1, deep, deep + 0.07, frame, true);
    for (const [a, c] of [[g.y0, g.y0 + 0.07], [g.y1 - 0.07, g.y1]]) on(f, 'wood', g.s0, g.s1, a, c, deep, deep + 0.07, frame, true);
    for (let k = 1; k < across; k++) on(f, 'wood', g.s0 + (w * k) / across - 0.022, g.s0 + (w * k) / across + 0.022, g.y0, g.y1, deep + 0.01, deep + 0.06, frame, true);
    for (let k = 1; k < down; k++) on(f, 'wood', g.s0, g.s1, g.y0 + (h * k) / down - 0.02, g.y0 + (h * k) / down + 0.02, deep + 0.015, deep + 0.055, frame, true);
  };
  /** A solid with a three-cornered end, drawn out along a line: a gable, a pediment, a ridged roof. `ends` and `sides` are what its faces are made of. */
  const wedge = (a0: Vector3, b0: Vector3, top0: Vector3, along: Vector3, sides: [string, Colour], ends: [string, Colour], under: [string, Colour] = ends) => {
    const a1 = a0.clone().add(along), b1 = b0.clone().add(along), top1 = top0.clone().add(along);
    const mid = a0.clone().add(b0).add(top0).multiplyScalar(1 / 3).addScaledVector(along, 0.5);
    const outOf = (...pts: Vector3[]) => pts.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / pts.length).sub(mid);
    poly(sides[0], [a0, a1, top1, top0], sides[1], outOf(a0, a1, top1, top0), false, sides[0] === 'tile' ? 0.62 : 0.5);
    poly(sides[0], [b0, b1, top1, top0], sides[1], outOf(b0, b1, top1, top0), false, sides[0] === 'tile' ? 0.62 : 0.5);
    poly(ends[0], [a0, b0, top0], ends[1], outOf(a0, b0, top0));
    poly(ends[0], [a1, b1, top1], ends[1], outOf(a1, b1, top1));
    poly(under[0], [a0, b0, b1, a1], under[1], outOf(a0, b0, b1, a1));
  };
  /** One slope of a roof: a sheet with some thickness, through four corners given from the eaves up, covered on top and boarded beneath. */
  const slope = (corners: Vector3[], cover: [string, Colour], under: Colour, thick = 0.16) => {
    N.crossVectors(A.subVectors(corners[1], corners[0]), B.subVectors(corners[3], corners[0])).normalize();
    if (N.y < 0) N.negate();
    const up = N.clone(), low = corners.map((p) => p.clone().addScaledVector(up, -thick));
    poly(cover[0], corners, cover[1], up, false, cover[0] === 'tile' ? 0.62 : 0.5);
    poly('wood', low, under, up.clone().negate(), true, 0.9);
    const mid = corners.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(0.25);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      poly('wood', [corners[i], corners[j], low[j], low[i]], under, corners[i].clone().add(corners[j]).multiplyScalar(0.5).sub(mid), true, 0.9);
    }
  };
  /** From a place in the world back to the building's own measures. */
  const local = (p: Vector3) => ({ u: turn * (p.z - b.z), y: p.y - base, v: turn * (p.x - b.x) + b.d / 2 });
  return { at, local, poly, block, box, on, stick, walls, pierced, glazed, wedge, slope };
}

/**
 * A timber-framed house. Its ground storey is stone under plaster, on a plinth; over it stand one
 * or two storeys of framing, each jettied out over the street on the ends of its floor joists:
 * a sill beam and a head beam, posts between them at every bay, a rail at the height of the
 * window sills, and in the bays that have no window a brace, or under a window a cross. The
 * spaces between are filled and washed with the house's colour. The roof is steep and tiled,
 * with either a framed gable to the street or its eaves, and then dormers; a chimney of stone
 * comes through it. Windows have shutters, and on the street side boxes of flowers.
 */
function timberHouse(b: Building, base: number, mesh: (material: string) => MeshBuilder, rng: Rng, stone: Colour, first: boolean): void {
  const k = tools(b, base, mesh), { at, box, on, stick, pierced, glazed, wedge, slope } = k;
  const W = b.w, D = b.d, jetty = b.jetty ?? 0.35, T = 0.3, PLINTH = 0.3, H0 = b.heights[0];
  // (Each storey is as high as the document says, so floors stand at different heights from house to house.)
  const floorOf = (storey: number) => PLINTH + b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0), frontOf = (storey: number) => -jetty * storey;
  const top = floorOf(b.storeys), front = frontOf(b.storeys - 1);
  const paint: Colour = rng.pick([[0.16, 0.28, 0.2], [0.2, 0.26, 0.36], [0.36, 0.14, 0.11], [0.3, 0.24, 0.14]] as Colour[]);
  const frame: Colour = [0.8, 0.78, 0.7];

  // The ground storey: a stone plinth, plastered walls, a door and a window or two to the street, one small window to each side and the back.
  box('stone', -W / 2 - 0.07, W / 2 + 0.07, 0, PLINTH + 0.18, -0.07, D + 0.07, shade(stone, 0.8));
  const ground = k.walls(0);
  const doorAt = W * rng.pick([0.24, 0.5, 0.76]), door: Gap = { s0: doorAt - 0.52, s1: doorAt + 0.52, y0: PLINTH - 0.12, y1: PLINTH + 2.02 };
  ground.forEach((f, i) => {
    const gaps: Gap[] = [];
    if (i === 0) {
      gaps.push(door);
      for (const c of [0.2, 0.5, 0.8]) if (Math.abs(c * W - doorAt) > 1.5) gaps.push({ s0: c * W - 0.55, s1: c * W + 0.55, y0: PLINTH + 0.95, y1: PLINTH + 2.0 });
    } else gaps.push({ s0: f.L * 0.5 - 0.4, s1: f.L * 0.5 + 0.4, y0: PLINTH + 1.15, y1: PLINTH + 1.95 });
    pierced(f, 'plaster', 0, f.L, PLINTH + 0.18, PLINTH + H0, 0, T, LIMEWASH, gaps);
    for (const g of gaps) {
      if (g === door) {
        // A door of upright boards in a frame of oak, with a stone step before it.
        for (let n = 0; n < 5; n++) on(f, 'wood', g.s0 + 0.1 + n * 0.168, g.s0 + 0.1 + (n + 1) * 0.168 - 0.008, PLINTH + 0.02, g.y1 - 0.1, 0.12, 0.17, shade(paint, 0.9 + 0.2 * rng.next()), true);
        for (const y of [PLINTH + 0.3, PLINTH + 1.55]) on(f, 'metal', g.s0 + 0.1, g.s1 - 0.1, y, y + 0.07, 0.1, 0.125, [0.05, 0.05, 0.055]);
        on(f, 'metal', g.s1 - 0.26, g.s1 - 0.2, PLINTH + 0.95, PLINTH + 1.1, 0.06, 0.12, [0.06, 0.06, 0.06]);
        for (const [a, c] of [[g.s0 - 0.04, g.s0 + 0.1], [g.s1 - 0.1, g.s1 + 0.04]]) on(f, 'wood', a, c, PLINTH, g.y1 + 0.02, -0.03, 0.2, OAK, true);
        on(f, 'wood', g.s0 - 0.1, g.s1 + 0.1, g.y1 - 0.1, g.y1 + 0.1, -0.04, 0.2, OAK, true);
        on(f, 'stone', g.s0 - 0.25, g.s1 + 0.25, 0, PLINTH - 0.1, -0.55, 0.02, shade(stone, 0.9));
        on(f, 'stone', g.s0 - 0.12, g.s1 + 0.12, 0, PLINTH, -0.28, 0.02, shade(stone, 0.95));
      } else {
        glazed(f, g, 2, i === 0 ? 3 : 2, frame);
        on(f, 'stone', g.s0 - 0.08, g.s1 + 0.08, g.y0 - 0.1, g.y0, -0.06, 0.12, shade(stone, 0.95));
        on(f, 'wood', g.s0 - 0.08, g.s1 + 0.08, g.y1, g.y1 + 0.14, -0.03, 0.14, OAK, true);
        if (i === 0) for (const [a, c] of [[g.s0 - 0.52, g.s0 - 0.02], [g.s1 + 0.02, g.s1 + 0.52]]) {
          // Shutters, of boards with two ledges across them, standing open against the wall.
          on(f, 'wood', a, c, g.y0, g.y1, -0.035, 0, paint, true);
          for (const y of [g.y0 + 0.14, g.y1 - 0.22]) on(f, 'wood', a + 0.02, c - 0.02, y, y + 0.08, -0.055, -0.03, shade(paint, 0.8), true);
        }
      }
    }
  });
  // A bench by the door, for the evening.
  {
    const f = ground[0], s = doorAt > W / 2 ? doorAt - 2.3 : doorAt + 1.0;
    on(f, 'wood', s, s + 1.3, 0.42, 0.47, -0.42, -0.04, shade(OAK, 1.5), true);
    for (const leg of [s + 0.08, s + 1.14]) on(f, 'wood', leg, leg + 0.08, 0, 0.42, -0.38, -0.08, shade(OAK, 1.3), true);
  }

  // The storeys of framing.
  for (let storey = 1; storey < b.storeys; storey++) {
    const y0 = floorOf(storey), y1 = floorOf(storey + 1), sill = y0 + 0.98, head = Math.min(sill + 0.14 + 1.08, y1 - 0.36), fr = frontOf(storey);
    // What carries it out over the street: the ends of the floor joists, a board under them, and a bracket at each end.
    box('wood', -W / 2, W / 2, y0 - 0.2, y0 - 0.14, fr - 0.02, frontOf(storey - 1) + 0.06, shade(OAK, 0.9), true);
    for (let u = -W / 2 + 0.2; u < W / 2 - 0.1; u += 0.52) box('wood', u, u + 0.13, y0 - 0.34, y0 - 0.2, fr + 0.02, frontOf(storey - 1) + 0.1, OAK, true);
    for (const u of [-W / 2 + 0.11, W / 2 - 0.11]) stick(at(u, y0 - 0.9, frontOf(storey - 1) - 0.02), at(u, y0 - 0.3, fr + 0.08), 0.14, 0.14, OAK);
    k.walls(fr).forEach((f, i) => {
      const bays = Math.max(2, Math.round(f.L / 1.55)), pitch = f.L / bays;
      // Which bays have windows: on the street as many as the house has, spread evenly; elsewhere every other bay, or one.
      const lit = new Set<number>();
      if (i === 0) for (let n = 0; n < b.bays; n++) lit.add(Math.min(bays - 1, Math.floor(((n + 0.5) * bays) / b.bays)));
      else if (i === 2) lit.add(Math.floor(bays / 2));
      else for (let n = 1; n < bays; n += 2) lit.add(n);
      const gaps: Gap[] = [...lit].map((n) => ({ s0: n * pitch + 0.2, s1: (n + 1) * pitch - 0.2, y0: sill + 0.14, y1: head }));
      pierced(f, 'plaster', 0.05, f.L - 0.05, y0, y1, 0.045, T, b.colour, gaps);
      // Sill beam and head beam, posts, and the rail under the windows.
      on(f, 'wood', 0, f.L, y0 - 0.14, y0 + 0.2, 0, 0.2, OAK, true);
      on(f, 'wood', 0, f.L, y1 - 0.2, y1, 0, 0.2, OAK, true);
      for (let n = 0; n <= bays; n++) {
        const half = n === 0 || n === bays ? 0.11 : 0.085, s = Math.min(f.L - half, Math.max(half, n * pitch));
        on(f, 'wood', s - half, s + half, y0 + 0.2, y1 - 0.2, 0, 0.18, OAK, true);
      }
      on(f, 'wood', 0.1, f.L - 0.1, sill, sill + 0.14, 0.005, 0.17, OAK, true);
      for (let n = 0; n < bays; n++) {
        const a = n * pitch + 0.09, c = (n + 1) * pitch - 0.09;
        if (lit.has(n)) {
          const g = gaps.find((q) => Math.abs(q.s0 - (n * pitch + 0.2)) < 0.01)!;
          on(f, 'wood', a, c, head, head + 0.13, 0.005, 0.17, OAK, true);
          for (const [p, q] of [[a, g.s0], [g.s1, c]]) on(f, 'wood', p, q, sill + 0.14, head, 0.01, 0.16, OAK, true);
          glazed(f, g, 2, 2, frame, 0.07);
          // Under a window, more often than not, a cross.
          if (rng.chance(0.65)) {
            stick(f.P(a, y0 + 0.2, 0.09), f.P(c, sill, 0.09), 0.16, 0.11, OAK);
            stick(f.P(c, y0 + 0.2, 0.085), f.P(a, sill, 0.085), 0.15, 0.11, OAK);
          } else on(f, 'wood', (a + c) / 2 - 0.06, (a + c) / 2 + 0.06, y0 + 0.2, sill, 0.01, 0.16, OAK, true);
          if (i === 0) {
            for (const [p, q] of [[g.s0 - 0.36, g.s0 - 0.01], [g.s1 + 0.01, g.s1 + 0.36]]) on(f, 'wood', p, q, g.y0, g.y1, -0.03, 0.005, paint, true);
            // A box of flowers on the sill.
            on(f, 'wood', g.s0 - 0.05, g.s1 + 0.05, sill + 0.02, sill + 0.2, -0.2, -0.01, shade(OAK, 1.4), true);
            for (let s = g.s0; s < g.s1 - 0.05; s += 0.14) on(f, 'leaf', s, s + 0.12, sill + 0.2, sill + 0.27 + 0.1 * rng.next(), -0.19 + 0.05 * rng.next(), -0.03, rng.chance(0.55) ? [0.7, 0.07, 0.1] : [0.16, 0.36, 0.1]);
          }
        } else {
          // A brace from the foot of one post to the head of the next, leaning the way of its neighbours on that side of the wall.
          const lean = n < bays / 2;
          stick(f.P(lean ? a : c, y0 + 0.2, 0.09), f.P(lean ? c : a, y1 - 0.2, 0.09), 0.16, 0.13, OAK);
          if (y1 - sill > 1.45) on(f, 'wood', a, c, sill + 1.0, sill + 1.1, 0.012, 0.16, OAK, true);
        }
      }
    });
  }

  // The roof. A gable is framed as the walls are: rafters, a collar, a post, and a small window for the loft.
  const pitch = Math.tan(((b.gable ? 56 : 52) * Math.PI) / 180), eave = 0.45, verge = 0.38, tile: [string, Colour] = ['tile', [1.15, 1.08, 1.02]], dark: [string, Colour] = ['wood', shade(OAK, 0.8)];
  const gableWall = (f: Face, y: number, t: number) => {
    const half = f.L / 2, rise = half * pitch, mid = f.P(half, y + rise, t);
    const into = f.P(0, 0, 0.26).sub(f.P(0, 0, 0));
    wedge(f.P(0, y, t + 0.045), f.P(f.L, y, t + 0.045), f.P(half, y + rise, t + 0.045), into, ['plaster', b.colour], ['plaster', b.colour]);
    const collar = y + rise * 0.48, inAt = (h: number) => (h - y) / pitch;
    stick(f.P(0.05, y + 0.05, t + 0.09), f.P(half, y + rise - 0.1, t + 0.09), 0.16, 0.16, OAK);
    stick(f.P(f.L - 0.05, y + 0.05, t + 0.085), f.P(half, y + rise - 0.1, t + 0.085), 0.16, 0.16, OAK);
    on(f, 'wood', inAt(collar) + 0.1, f.L - inAt(collar) - 0.1, collar, collar + 0.14, t, t + 0.18, OAK, true);
    on(f, 'wood', half - 0.07, half + 0.07, collar + 0.14, y + rise - 0.25, t + 0.005, t + 0.17, OAK, true);
    for (const side of [-1, 1]) on(f, 'wood', half + side * half * 0.5 - 0.07, half + side * half * 0.5 + 0.07, y, y + rise * 0.5 - 0.12, t + 0.005, t + 0.17, OAK, true);
    const g: Gap = { s0: half - 0.36, s1: half + 0.36, y0: y + 0.5, y1: Math.min(collar - 0.08, y + 1.4) };
    on(f, 'wood', g.s0 - 0.09, g.s1 + 0.09, g.y0 - 0.1, g.y1 + 0.1, t + 0.01, t + 0.15, OAK, true);
    glazed(f, g, 2, 1, frame, t - 0.02);
    return mid;
  };
  const upper = k.walls(front);
  if (b.gable) {
    const rise = (W / 2 + eave) * pitch, drop = eave * pitch;
    gableWall(upper[0], top, 0);
    gableWall(upper[2], top, 0);
    // Two slopes that meet at a ridge, standing out past the gables and over the walls; and a line of ridge tiles to close the joint.
    for (const side of [-1, 1]) slope([at(side * (W / 2 + eave), top - drop, front - verge), at(side * (W / 2 + eave), top - drop, D + verge), at(0, top - drop + rise, D + verge), at(0, top - drop + rise, front - verge)], tile, dark[1]);
    box('tile', -0.13, 0.13, top - drop + rise - 0.06, top - drop + rise + 0.07, front - verge, D + verge, [0.95, 0.85, 0.8]);
    // Boards along the edge of the roof over the street.
    for (const side of [-1, 1]) stick(at(side * (W / 2 + eave), top - drop - 0.04, front - verge - 0.03), at(0, top - drop + rise - 0.04, front - verge - 0.03), 0.05, 0.24, shade(OAK, 0.9));
  } else {
    const span = D - front, rise = (span / 2 + eave) * pitch, drop = eave * pitch, mid = front + span / 2;
    gableWall(upper[1], top, 0);
    gableWall(upper[3], top, 0);
    for (const v of [front - eave, D + eave]) slope([at(-W / 2 - verge, top - drop, v), at(W / 2 + verge, top - drop, v), at(W / 2 + verge, top - drop + rise, mid), at(-W / 2 - verge, top - drop + rise, mid)], tile, dark[1]);
    box('tile', -W / 2 - verge, W / 2 + verge, top - drop + rise - 0.06, top - drop + rise + 0.07, mid - 0.13, mid + 0.13, [0.95, 0.85, 0.8]);
    for (const end of [-W / 2 - verge - 0.03, W / 2 + verge + 0.03]) for (const v of [front - eave, D + eave]) stick(at(end, top - drop - 0.04, v), at(end, top - drop + rise - 0.04, mid), 0.05, 0.24, shade(OAK, 0.9));
    // Dormers in the slope over the street: a small framed front with a window, and a roof of its own.
    const dormers = b.bays >= 3 ? 2 : 1;
    for (let n = 0; n < dormers; n++) {
      const u = dormers === 1 ? 0 : (n ? 1 : -1) * W * 0.24, v0 = front + 0.55, y0 = top + (v0 - front + eave) * pitch - drop, h = 1.25, w = 0.62;
      box('plaster', u - w, u + w, y0 - 0.5, y0 + h, v0 + 0.045, v0 + 1.6, b.colour);
      for (const side of [-1, 1]) box('wood', u + side * w - 0.07, u + side * w + 0.07, y0 - 0.5, y0 + h, v0, v0 + 0.16, OAK, true);
      box('wood', u - w, u + w, y0 + h - 0.12, y0 + h, v0, v0 + 0.16, OAK, true);
      box('wood', u - w, u + w, y0 + 0.12, y0 + 0.24, v0, v0 + 0.16, OAK, true);
      const f: Face = { L: w * 2, P: (s, y, t) => at(u - w + s, y, v0 + t) };
      glazed(f, { s0: 0.12, s1: w * 2 - 0.12, y0: y0 + 0.3, y1: y0 + h - 0.18 }, 2, 1, frame, 0.02);
      wedge(at(u - w - 0.2, y0 + h, v0 - 0.22), at(u + w + 0.2, y0 + h, v0 - 0.22), at(u, y0 + h + (w + 0.2) * 1.15, v0 - 0.22), at(0, 0, 2.6).sub(at(0, 0, 0)), tile, ['plaster', b.colour], dark);
    }
  }
  // The chimney: stone, with a slab on it and two pots.
  {
    const u = b.gable ? (rng.chance(0.5) ? 1 : -1) * W * 0.2 : W * rng.range(-0.25, 0.25), v = b.gable ? D * rng.range(0.45, 0.7) : front + (D - front) / 2 + 0.6;
    const ridge = top + (b.gable ? W / 2 : (D - front) / 2) * pitch;
    box('stone', u - 0.34, u + 0.34, top + 0.4, ridge + 0.75, v - 0.3, v + 0.3, shade(stone, 0.72));
    box('stone', u - 0.42, u + 0.42, ridge + 0.75, ridge + 0.85, v - 0.38, v + 0.38, shade(stone, 0.6));
    for (const side of [-1, 1]) box('tile', u + side * 0.17 - 0.09, u + side * 0.17 + 0.09, ridge + 0.85, ridge + 1.12, v - 0.09, v + 0.09, [0.9, 0.8, 0.75]);
  }
  // The first house of a row is the inn, and hangs out its sign.
  if (first) {
    const y = floorOf(1) + 1.75, u = doorAt - W / 2 + (doorAt > W / 2 ? -0.9 : 0.9), v = frontOf(1);
    box('metal', u - 0.025, u + 0.025, y, y + 0.05, v - 1.05, v + 0.02, [0.05, 0.05, 0.055]);
    stick(at(u, y - 0.45, v + 0.02), at(u, y, v - 0.6), 0.03, 0.03, [0.05, 0.05, 0.055], 'metal');
    box('wood', u - 0.03, u + 0.03, y - 0.68, y - 0.1, v - 0.98, v - 0.38, paint, true);
    box('wood', u - 0.04, u + 0.04, y - 0.52, y - 0.26, v - 0.84, v - 0.52, [0.78, 0.62, 0.2], true);
  }
}

/**
 * A stuccoed classical building. A plinth of grey stone; a ground storey of rusticated work, in
 * courses with the joints struck deep; a moulded band; then the tall windows of the principal
 * storey, each in a moulded surround with a cornice over it on brackets, or a small pediment in
 * every other bay; lower storeys of plainer windows over that, as many as it has; pilaster strips
 * at the corners; a deep cornice on blocks, a low wall above it, and a low hipped roof of sheet
 * metal laid in seams. With a portico, the middle three bays stand forward under four pilasters
 * and a pediment, and the door, up three steps, is in the middle of them. Walls are washed with
 * the building's colour and everything moulded is white.
 *
 * Inside, it is planned as such houses were, from its bays. The middle is the way in and the way
 * up: where the middle is three bays broad, an entrance hall to the front and behind it a hall
 * with the stair, two flights and a landing along its back wall; where it is one bay, a passage
 * through the house with the stair at its far end. Either side is a wing of rooms in two rows, a
 * front row and a back, each room one to three bays broad, the two wings alike. Doors stand in a
 * line from room to room along the front, a stride in from the windows, so that from one end of
 * the house the other is seen through every door between; each front room opens into the room
 * behind it; and every storey is planned the same. Each room has its own colour, a skirting, a
 * rail at the height of a chair's back and a cornice; the front rooms have a stove of glazed
 * tiles in the corner.
 */
function imperialHouse(b: Building, base: number, mesh: (material: string) => MeshBuilder, rng: Rng, stone: Colour): void {
  const k = tools(b, base, mesh), { at, box, on, stick, pierced, glazed, wedge, poly, block } = k;
  const W = b.w, D = b.d, T = 0.3, PLINTH = 0.5, N = b.storeys, H0 = b.heights[0], wash = b.colour, granite = shade(stone, 0.62);
  const floorY = (storey: number) => PLINTH + b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0);
  const y1 = floorY(1), top = floorY(N);
  const frame: Colour = [0.86, 0.85, 0.8], leaf: Colour = rng.pick([[0.1, 0.17, 0.13], [0.2, 0.12, 0.07], [0.12, 0.13, 0.2]] as Colour[]);
  const roofTone: Colour = rng.pick([[0.36, 0.45, 0.4], [0.4, 0.2, 0.16], [0.3, 0.31, 0.33]] as Colour[]);
  /** Every opening in the outer walls, as the rooms inside need to know them: which wall (front, right, back, left), where along it in the building's measures, and how high. */
  const holes: { side: number; c: number; half: number; y0: number; y1: number; storey: number }[] = [];

  // One wall: its storeys, their windows, and what is moulded about them. `door` is the bay the door stands in, if any; `plain` leaves off the cornices over the windows.
  const wall = (f: Face, bays: number, side: number, o: { door?: number; plain?: boolean; margin?: number } = {}) => {
    const margin = o.margin ?? 0.8, pitch = (f.L - margin * 2) / bays, centre = (n: number) => margin + (n + 0.5) * pitch;
    // (Windows are as tall as their storeys allow: the room each lights is as high as the document says.)
    const rows: Gap[][] = Array.from({ length: N }, (_, storey) => Array.from({ length: bays }, (_, n): Gap => {
      const c = centre(n), fy = floorY(storey), h = b.heights[storey];
      if (storey === 0) return n === o.door ? { s0: c - 0.85, s1: c + 0.85, y0: PLINTH - 0.01, y1: PLINTH + Math.min(3.3, H0 - 0.55) } : { s0: c - 0.58, s1: c + 0.58, y0: PLINTH + 0.85, y1: PLINTH + H0 - 0.9 };
      return { s0: c - 0.6, s1: c + 0.6, y0: fy + (storey === 1 ? 0.62 : 0.6), y1: fy + h - 1.05 };
    }));
    rows.forEach((row, storey) => row.forEach((g) => {
      const p = k.local(f.P((g.s0 + g.s1) / 2, 0, 0));
      holes.push({ side, c: side % 2 === 0 ? p.u : p.v, half: (g.s1 - g.s0) / 2, y0: g.y0, y1: g.y1, storey });
    }));
    on(f, 'stone', -0.07, f.L + 0.07, 0, PLINTH, -0.07, T, granite);
    pierced(f, 'plaster', 0, f.L, PLINTH, y1, 0, T, wash, rows[0], 0.44);
    for (let storey = 1; storey < N; storey++) pierced(f, 'plaster', 0, f.L, floorY(storey), floorY(storey + 1), 0.02, T, wash, rows[storey]);
    if (N > 1) {
      // The band between the ground storey and the one above, and a thin one under its windows.
      on(f, 'plaster', -0.1, f.L + 0.1, y1 - 0.05, y1 + 0.2, -0.1, 0.05, WHITE);
      on(f, 'plaster', -0.06, f.L + 0.06, y1 + 0.2, y1 + 0.27, -0.06, 0.05, WHITE);
      on(f, 'plaster', -0.04, f.L + 0.04, y1 + 0.52, y1 + 0.62, -0.035, 0.05, WHITE);
    }
    rows[0].forEach((g, n) => {
      if (n === o.door) {
        // The door: two leaves standing open into the hall, under a light of its own.
        const lintel = g.y1 - 0.62;
        for (const [a, e] of [[g.s0 + 0.03, g.s0 + 0.09], [g.s1 - 0.09, g.s1 - 0.03]]) on(f, 'wood', a, e, g.y0 + 0.03, lintel, T - 0.02, T + 0.8, leaf, true);
        on(f, 'wood', g.s0, g.s1, lintel, lintel + 0.09, 0.08, 0.18, frame, true);
        glazed(f, { s0: g.s0 + 0.02, s1: g.s1 - 0.02, y0: lintel + 0.09, y1: g.y1 - 0.02 }, 4, 1, frame);
        for (const [a, e] of [[g.s0 - 0.2, g.s0], [g.s1, g.s1 + 0.2]]) on(f, 'plaster', a, e, PLINTH, g.y1 + 0.02, -0.07, 0.05, WHITE);
        on(f, 'plaster', g.s0 - 0.3, g.s1 + 0.3, g.y1 + 0.02, g.y1 + 0.3, -0.1, 0.05, WHITE);
        on(f, 'plaster', g.s0 - 0.4, g.s1 + 0.4, g.y1 + 0.3, g.y1 + 0.42, -0.24, 0.05, WHITE);
        // The threshold, and steps of stone, each broader than the one above it.
        on(f, 'stone', g.s0, g.s1, PLINTH - 0.25, PLINTH, -0.02, T + 0.12, shade(stone, 0.85));
        // (Four low ones: the ground before a door is never quite the height it was levelled to, and a step and a bit stops a walker dead.)
        for (let step = 0; step < 4; step++) on(f, 'stone', g.s0 - 0.5 - step * 0.3, g.s1 + 0.5 + step * 0.3, -0.3, PLINTH - step * (PLINTH / 4), -0.4 - step * 0.32, 0.01, shade(stone, 0.78));
      } else {
        glazed(f, g, 2, 3, frame);
        // Over a window of the ground storey, the stones of a flat arch with its key standing proud.
        on(f, 'plaster', g.s0 - 0.16, g.s1 + 0.16, g.y1, g.y1 + 0.3, -0.03, 0.05, WHITE);
        on(f, 'plaster', (g.s0 + g.s1) / 2 - 0.12, (g.s0 + g.s1) / 2 + 0.12, g.y1 - 0.02, g.y1 + 0.38, -0.07, 0.05, WHITE);
        on(f, 'stone', g.s0 - 0.06, g.s1 + 0.06, g.y0 - 0.1, g.y0, -0.06, 0.1, granite);
      }
    });
    (rows[1] ?? []).forEach((g, n) => {
      glazed(f, g, 2, 4, frame);
      // The surround; the sill on its two blocks; and over it a frieze and a cornice on brackets, with a pediment in every other bay.
      for (const [a, e] of [[g.s0 - 0.17, g.s0], [g.s1, g.s1 + 0.17]]) on(f, 'plaster', a, e, g.y0, g.y1 + 0.17, -0.045, 0.06, WHITE);
      on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.17, -0.045, 0.06, WHITE);
      on(f, 'plaster', g.s0 - 0.24, g.s1 + 0.24, g.y0 - 0.1, g.y0, -0.13, 0.06, WHITE);
      for (const s of [g.s0 - 0.17, g.s1 + 0.05]) on(f, 'plaster', s, s + 0.12, g.y0 - 0.3, g.y0 - 0.1, -0.09, 0.03, WHITE);
      if (o.plain) return;
      on(f, 'plaster', g.s0 - 0.17, g.s1 + 0.17, g.y1 + 0.17, g.y1 + 0.37, -0.03, 0.03, WHITE);
      for (const s of [g.s0 - 0.2, g.s1 + 0.07]) on(f, 'plaster', s, s + 0.13, g.y1 + 0.12, g.y1 + 0.4, -0.12, 0.03, WHITE);
      on(f, 'plaster', g.s0 - 0.3, g.s1 + 0.3, g.y1 + 0.37, g.y1 + 0.47, -0.2, 0.03, WHITE);
      if ((n + (bays >> 1)) % 2 === 0) {
        const into = f.P(0, 0, 0.2).sub(f.P(0, 0, 0));
        wedge(f.P(g.s0 - 0.3, g.y1 + 0.47, -0.17), f.P(g.s1 + 0.3, g.y1 + 0.47, -0.17), f.P((g.s0 + g.s1) / 2, g.y1 + 0.82, -0.17), into, ['plaster', WHITE], ['plaster', WHITE]);
      }
    });
    for (const row of rows.slice(2)) for (const g of row) {
      glazed(f, g, 2, 2, frame);
      for (const [a, e] of [[g.s0 - 0.15, g.s0], [g.s1, g.s1 + 0.15]]) on(f, 'plaster', a, e, g.y0, g.y1 + 0.15, -0.04, 0.06, WHITE);
      on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.15, -0.04, 0.06, WHITE);
      on(f, 'plaster', g.s0 - 0.2, g.s1 + 0.2, g.y0 - 0.09, g.y0, -0.1, 0.06, WHITE);
    }
    return { pitch, centre };
  };
  // A pilaster: a foot, a shaft that narrows a little upward, and a head.
  const pilaster = (f: Face, s: number, y0: number, y3: number, out: number) => {
    on(f, 'plaster', s - 0.34, s + 0.34, y0, y0 + 0.18, -out - 0.07, 0.03, WHITE);
    on(f, 'plaster', s - 0.3, s + 0.3, y0 + 0.18, y0 + 0.3, -out - 0.04, 0.03, WHITE);
    on(f, 'plaster', s - 0.26, s + 0.26, y0 + 0.3, y3 - 0.42, -out, 0.03, WHITE);
    on(f, 'plaster', s - 0.3, s + 0.3, y3 - 0.42, y3 - 0.3, -out - 0.04, 0.03, WHITE);
    on(f, 'plaster', s - 0.34, s + 0.34, y3 - 0.3, y3 - 0.1, -out - 0.08, 0.03, WHITE);
    on(f, 'plaster', s - 0.38, s + 0.38, y3 - 0.1, y3, -out - 0.11, 0.03, WHITE);
  };

  const [front, right, back, left] = k.walls(0);
  // (An even number of windows to each end, so that the wall between the front rooms and the back meets the end walls between two of them.)
  const sideBays = D >= 10.4 ? 4 : 2, middle = b.bays >> 1, order = N > 1 ? y1 + 0.27 : PLINTH;
  let centreLeft = 0, centreRight = 0;
  const out = 0.4;
  if (b.portico) {
    // The front in three: two wings, and between them the three middle bays standing forward.
    const margin = 0.8, pitch = (W - margin * 2) / b.bays, a = margin + (middle - 1) * pitch - 0.3, c = margin + (middle + 2) * pitch + 0.3;
    centreLeft = a - W / 2; centreRight = c - W / 2;
    const wing = (from: number, to: number): Face => ({ L: to - from, P: (s, y, t) => front.P(from + s, y, t) });
    const stand: Face = { L: c - a, P: (s, y, t) => front.P(a + s, y, t - out) };
    wall(wing(0, a), middle - 1, 0, { margin: 0.5 });
    wall(wing(c, W), middle - 1, 0, { margin: 0.5 });
    const { centre } = wall(stand, 3, 0, { door: 1, margin: 0.3 });
    // (And the sides of what stands forward.)
    box('plaster', centreLeft, centreLeft + 0.3, PLINTH, top, -out, 0.02, wash);
    box('plaster', centreRight - 0.3, centreRight, PLINTH, top, -out, 0.02, wash);
    for (const s of [0.36, (centre(0) + centre(1)) / 2, (centre(1) + centre(2)) / 2, stand.L - 0.36]) pilaster(stand, s, order, top, 0.13);
  } else wall(front, b.bays, 0, { door: middle });
  wall(right, sideBays, 1, { plain: true });
  wall(back, b.bays, 2, { plain: true });
  wall(left, sideBays, 3, { plain: true });
  // Strips at the corners, the height of the upper storeys.
  for (const f of [front, right, back, left]) for (const s of [0.3, f.L - 0.3]) on(f, 'plaster', s - 0.3, s + 0.3, order, top, -0.05, 0.03, WHITE);

  // The cornice, all round: a frieze, three mouldings each standing further out than the one under it, and blocks along the front.
  const round = (y0: number, y3: number, reach: number, colour: Colour) => {
    for (const f of [front, right, back, left]) on(f, 'plaster', -reach, f.L + reach, y0, y3, -reach, 0.5, colour);
    if (b.portico) box('plaster', centreLeft - reach, centreRight + reach, y0, y3, -out - reach, 0, colour);
  };
  round(top, top + 0.42, 0.04, WHITE);
  round(top + 0.42, top + 0.52, 0.14, WHITE);
  round(top + 0.52, top + 0.62, 0.26, WHITE);
  round(top + 0.62, top + 0.78, 0.4, WHITE);
  for (let u = -W / 2 + 0.1; u < W / 2 - 0.05; u += 0.27) {
    const forward = b.portico && u > centreLeft && u < centreRight - 0.1 ? out : 0;
    box('plaster', u, u + 0.12, top + 0.3, top + 0.42, -forward - 0.13, -forward, WHITE);
  }
  // The low wall over the cornice, which is what the roof stands behind.
  const attic = top + 0.78;
  box('plaster', -W / 2, W / 2, attic, attic + 0.5, 0, D, wash);
  box('plaster', -W / 2 - 0.05, W / 2 + 0.05, attic + 0.5, attic + 0.58, -0.05, D + 0.05, WHITE);
  if (b.portico) {
    // The pediment over the middle: its face set back within mouldings that follow its slopes.
    const half = (centreRight - centreLeft) / 2 + 0.4, mid = (centreLeft + centreRight) / 2, rise = half * 0.42, v = -out - 0.4;
    wedge(at(mid - half, attic, v + 0.22), at(mid + half, attic, v + 0.22), at(mid, attic + rise, v + 0.22), at(0, 0, 2.2 + out).sub(at(0, 0, 0)), ['metal', roofTone], ['plaster', wash], ['plaster', WHITE]);
    for (const side of [-1, 1]) stick(at(mid + side * half, attic + 0.06, v + 0.1), at(mid, attic + rise + 0.06, v + 0.1), 0.26, 0.16, WHITE, 'plaster');
    box('plaster', mid - 0.3, mid + 0.3, attic + rise * 0.3, attic + rise * 0.3 + 0.36, v + 0.18, v + 0.24, PANE);
  }
  // The roof: low, hipped, of sheet metal laid in seams up the slope.
  {
    const y = attic + 0.58, e = 0.06, slope = Math.tan((21 * Math.PI) / 180), half = D / 2 + e, rise = half * slope;
    const a = at(-W / 2 - e, y, -e), c = at(W / 2 + e, y, -e), g = at(W / 2 + e, y, D + e), h = at(-W / 2 - e, y, D + e);
    const r0 = at(-W / 2 - e + half, y + rise, D / 2), r1 = at(W / 2 + e - half, y + rise, D / 2), up = new Vector3(0, 1, 0);
    const outward = (n: Vector3) => n.add(up);
    poly('metal', [a, c, r1, r0], roofTone, outward(at(0, 0, -1).sub(at(0, 0, 0))));
    poly('metal', [g, h, r0, r1], roofTone, outward(at(0, 0, 1).sub(at(0, 0, 0))));
    poly('metal', [c, g, r1], roofTone, outward(at(1, 0, 0).sub(at(0, 0, 0))));
    poly('metal', [h, a, r0], roofTone, outward(at(-1, 0, 0).sub(at(0, 0, 0))));
    poly('metal', [a, c, g, h], shade(roofTone, 0.6), new Vector3(0, -1, 0));
    for (let u = -W / 2 + 0.4; u < W / 2 - 0.2; u += 0.68) {
      const reach = Math.min(half, u + W / 2 + e, W / 2 + e - u);
      for (const side of [-1, 1]) stick(at(u, y + 0.02, side < 0 ? -e : D + e), at(u, y + reach * slope + 0.02, side < 0 ? -e + reach : D + e - reach), 0.035, 0.05, shade(roofTone, 0.85), 'metal');
    }
    // Chimneys, plastered, each with a white cap.
    const stacks = b.bays >= 7 ? 4 : 2;
    for (let n = 0; n < stacks; n++) {
      const u = (-0.5 + (n + 0.5) / stacks) * Math.max(1.5, W - D * 0.9), v = D / 2 + (n % 2 ? 1.5 : -1.5);
      box('plaster', u - 0.45, u + 0.45, y + rise * 0.4, y + rise + 0.95, v - 0.3, v + 0.3, shade(wash, 0.92));
      box('plaster', u - 0.52, u + 0.52, y + rise + 0.95, y + rise + 1.07, v - 0.37, v + 0.37, WHITE);
    }
  }
  // ------------------------------------------------------------------ inside
  interface Rect { u0: number; u1: number; v0: number; v1: number }
  interface Room extends Rect { kind: 'hall' | 'stair' | 'through' | 'front' | 'back' }
  interface Door { line: 'u' | 'v'; at: number; c: number; half: number; tall?: boolean }
  // Where one bay ends and the next begins, across the front: midway between windows, and at the cheeks of what stands forward.
  const windows = holes.filter((h) => h.side === 0 && h.storey === 0).map((h) => h.c).sort((p, q) => p - q);
  const bays = b.bays, broad = b.portico || bays >= 7 ? 3 : 1, flank = (broad - 1) / 2;
  const edge: number[] = [-W / 2 + T];
  for (let i = 1; i < bays; i++) edge.push((windows[i - 1] + windows[i]) / 2);
  edge.push(W / 2 - T);
  if (b.portico) { edge[middle - 1] = centreLeft + 0.15; edge[middle + 2] = centreRight - 0.15; }
  const uL = edge[middle - flank], uR = edge[middle + flank + 1], vF = b.portico ? -out + T : T, spine = D / 2, vB = D - T;
  const plan: Room[] = [], doors: Door[] = [];
  if (broad === 1) plan.push({ u0: uL, u1: uR, v0: vF, v1: vB, kind: 'through' });
  else {
    plan.push({ u0: uL, u1: uR, v0: vF, v1: spine, kind: 'hall' }, { u0: uL, u1: uR, v0: spine, v1: vB, kind: 'stair' });
    doors.push({ line: 'v', at: spine, c: (uL + uR) / 2, half: 1.1, tall: true });
  }
  {
    // A wing: rooms of one, two or three bays; and the other wing its mirror.
    const sizes: number[] = [];
    for (let leftOver = middle - flank; leftOver > 0;) {
      const take = leftOver <= 3 && rng.chance(0.45) ? leftOver : Math.min(leftOver, rng.pick([1, 2, 2, 3]));
      sizes.push(take);
      leftOver -= take;
    }
    for (const side of [-1, 1]) {
      let bay = side < 0 ? middle - flank : middle + flank + 1;
      for (const size of sizes) {
        const a = side < 0 ? edge[bay - size] : edge[bay], c = side < 0 ? edge[bay] : edge[bay + size], inner = side < 0 ? c : a;
        plan.push({ u0: a, u1: c, v0: T, v1: spine, kind: 'front' }, { u0: a, u1: c, v0: spine, v1: vB, kind: 'back' });
        // Doors: in a line along the front; along the back; and from each front room to the room behind it.
        const atMiddle = Math.abs(inner - (side < 0 ? uL : uR)) < 0.01;
        doors.push({ line: 'u', at: inner, c: T + 1.25, half: 0.55 });
        if (!atMiddle || broad === 3) doors.push({ line: 'u', at: inner, c: atMiddle ? spine + 1.0 : vB - 1.25, half: 0.5 });
        doors.push({ line: 'v', at: spine, c: (a + c) / 2, half: 0.5 });
        bay += side * size;
      }
    }
  }
  // The stair: two flights side by side and a landing between them, the same on every storey. It is laid out in measures of
  // its own: `a` along its flights from where the first begins to rise, `e` across them. In a hall three bays broad it lies along
  // the back wall; in a passage it lies at the far end, the passage's whole breadth.
  const TREAD = 0.24, LANDING = 1.05, START = broad === 3 ? 1.2 : 0.3;
  const flights = Array.from({ length: N - 1 }, (_, storey) => {
    const h = b.heights[storey], steps = Math.ceil(h / 0.17), first = Math.ceil(steps / 2);
    return { steps, first, rise: h / steps, turn: START + first * TREAD };
  });
  const longest = START + Math.max(0, ...flights.map((f) => f.first)) * TREAD + LANDING;
  const across = broad === 3 ? 2.2 : uR - uL - 0.2, strip = Math.min(1.1, (across - 0.12) / 2);
  const stairAt = broad === 3
    ? (a: number, e: number, y: number) => at(uL + 0.1 + a, y, vB - 0.05 - across + e)
    : (a: number, e: number, y: number) => at(uL + 0.1 + e, y, vB - 0.05 - longest + a);
  const stairRect = (a0: number, a1: number, e0: number, e1: number): Rect => {
    const p = k.local(stairAt(a0, e0, 0)), q = k.local(stairAt(a1, e1, 0));
    return { u0: Math.min(p.u, q.u), u1: Math.max(p.u, q.u), v0: Math.min(p.v, q.v), v1: Math.max(p.v, q.v) };
  };
  const stone2: Colour = [0.8, 0.77, 0.7], rail: Colour = [0.16, 0.1, 0.07];
  flights.forEach((f, storey) => {
    const fy = floorY(storey), mid = fy + f.first * f.rise, second = f.steps - f.first, end = f.turn - second * TREAD, upper = floorY(storey + 1);
    const piece = (a0: number, a1: number, e0: number, e1: number, lo: number, hi: number, colour: Colour, material = 'stone') => block(material, stairAt(a0, e0, lo), stairAt(a1, e1, hi), colour);
    for (let i = 1; i <= f.first; i++) piece(START + (i - 1) * TREAD, START + i * TREAD + 0.01, 0, strip, fy + i * f.rise - 0.22, fy + i * f.rise, stone2);
    piece(f.turn, f.turn + LANDING, 0, across, mid - 0.22, mid, stone2);
    for (let j = 1; j <= second; j++) piece(f.turn - j * TREAD - 0.01, f.turn - (j - 1) * TREAD, across - strip, across, mid + j * f.rise - 0.22, mid + j * f.rise, stone2);
    // What carries the landing, and the rails: one up each flight, on posts.
    for (const e of [0.06, across - 0.18]) piece(f.turn + LANDING - 0.2, f.turn + LANDING - 0.08, e, e + 0.12, fy, mid - 0.22, stone2);
    const post = (a: number, e: number, y: number) => piece(a - 0.04, a + 0.04, e - 0.04, e + 0.04, y, y + 1.0, rail, 'wood');
    for (const e of broad === 3 ? [0.05, strip + 0.02] : [strip + 0.02]) {
      stick(stairAt(START, e, fy + 0.95), stairAt(f.turn, e, mid + 0.95), 0.06, 0.06, rail);
      post(START, e, fy); post(f.turn, e, mid);
    }
    stick(stairAt(f.turn, across - strip - 0.02, mid + 0.95), stairAt(end, across - strip - 0.02, upper + 0.95), 0.06, 0.06, rail);
    post(f.turn, across - strip - 0.02, mid); post(end, across - strip - 0.02, upper);
    // Round the well in the floor above: a rail along its open side and across its far end; and at the top of the house across its near end too.
    const level = (a0: number, e0: number, a1: number, e1: number) => {
      stick(stairAt(a0, e0, upper + 0.95), stairAt(a1, e1, upper + 0.95), 0.06, 0.06, rail);
      const n = Math.max(1, Math.round(Math.hypot(a1 - a0, e1 - e0) / 1.1));
      for (let i = 0; i <= n; i++) post(a0 + ((a1 - a0) * i) / n, e0 + ((e1 - e0) * i) / n, upper);
    };
    if (broad === 3) level(START + 0.06, -0.05, f.turn + LANDING + 0.05, -0.05);
    if (broad === 3) level(f.turn + LANDING + 0.05, -0.05, f.turn + LANDING + 0.05, across);
    if (storey === N - 2) level(START - 0.05, 0, START - 0.05, strip + 0.1);
    // (Where the second flight comes up a step short of the floor's edge, a strip of floor to step onto.)
    if (end > START + 0.01) piece(START, end, across - strip, across, upper - 0.3, upper, stone2);
  });
  // The well in the floor of a storey, for the flights that come up to it.
  const wellOf = (storey: number): Rect | null => (storey === 0 || !flights[storey - 1] ? null : stairRect(START, flights[storey - 1].turn + LANDING, 0, across));
  const without = (r: Rect, hole: Rect | null): Rect[] => {
    if (!hole || hole.u1 <= r.u0 || hole.u0 >= r.u1 || hole.v1 <= r.v0 || hole.v0 >= r.v1) return [r];
    const parts: Rect[] = [{ u0: r.u0, u1: r.u1, v0: r.v0, v1: Math.max(r.v0, hole.v0) }, { u0: r.u0, u1: r.u1, v0: Math.min(r.v1, hole.v1), v1: r.v1 }];
    parts.push({ u0: r.u0, u1: Math.max(r.u0, hole.u0), v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) }, { u0: Math.min(r.u1, hole.u1), u1: r.u1, v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) });
    return parts.filter((q) => q.u1 - q.u0 > 0.02 && q.v1 - q.v0 > 0.02);
  };

  const paints: Colour[] = [[0.62, 0.72, 0.6], [0.58, 0.66, 0.74], [0.82, 0.7, 0.45], [0.8, 0.6, 0.56], [0.5, 0.2, 0.17], [0.86, 0.83, 0.74], [0.66, 0.62, 0.7], [0.45, 0.56, 0.5]];
  const boards: Colour = [0.42, 0.29, 0.17];
  // Under the ground floor, and over the top one.
  box('stone', -W / 2 + 0.2, W / 2 - 0.2, 0.1, PLINTH - 0.04, vF - 0.1, D - 0.2, shade(stone, 0.6));
  box('plaster', -W / 2 + 0.2, W / 2 - 0.2, top - 0.3, top, b.portico ? -out + 0.2 : 0.2, D - 0.2, WHITE);
  for (let storey = 0; storey < N; storey++) {
    const fy = floorY(storey), h = b.heights[storey], clear = fy + h - 0.3, doorTop = fy + Math.min(storey === 1 ? 2.7 : 2.35, h - 0.75);
    plan.forEach((room, index) => {
      const lived = room.kind === 'front' || room.kind === 'back', colour: Colour = lived ? rng.pick(paints) : [0.84, 0.81, 0.72];
      // The floor: boards, or in the halls squares of two stones; and under it what is the ceiling of the room below.
      for (const part of without({ u0: room.u0 - 0.1, u1: room.u1 + 0.1, v0: room.v0 - 0.1, v1: room.v1 + 0.1 }, wellOf(storey))) {
        if (storey > 0) box('plaster', part.u0, part.u1, fy - 0.3, fy - 0.04, part.v0, part.v1, WHITE);
        if (lived) box('wood', part.u0, part.u1, fy - 0.04, fy, part.v0, part.v1, boards, true);
        else for (let u = part.u0, i = 0; u < part.u1 - 0.01; u += 0.62, i++) for (let v = part.v0, j = 0; v < part.v1 - 0.01; v += 0.62, j++) {
          box('stone', u, Math.min(part.u1, u + 0.62), fy - 0.04, fy, v, Math.min(part.v1, v + 0.62), (i + j) % 2 ? [0.78, 0.75, 0.68] : [0.36, 0.35, 0.34]);
        }
      }
      // The four walls: lined with the room's colour, cut for its doors and windows; a skirting, a rail and a cornice; and a frame to each door.
      const sides: { f: Face; L: number; lo: number; outer: number; line: 'u' | 'v'; at: number }[] = [
        { f: { L: 0, P: (s, y, t) => at(room.u0 + s, y, room.v0 + 0.1 - t) }, L: room.u1 - room.u0, lo: room.u0, outer: room.v0 <= vF + 0.01 ? 0 : -1, line: 'v', at: room.v0 },
        { f: { L: 0, P: (s, y, t) => at(room.u0 + s, y, room.v1 - 0.1 + t) }, L: room.u1 - room.u0, lo: room.u0, outer: room.v1 >= vB - 0.01 ? 2 : -1, line: 'v', at: room.v1 },
        { f: { L: 0, P: (s, y, t) => at(room.u0 + 0.1 - t, y, room.v0 + s) }, L: room.v1 - room.v0, lo: room.v0, outer: room.u0 <= -W / 2 + T + 0.01 ? 3 : -1, line: 'u', at: room.u0 },
        { f: { L: 0, P: (s, y, t) => at(room.u1 - 0.1 + t, y, room.v0 + s) }, L: room.v1 - room.v0, lo: room.v0, outer: room.u1 >= W / 2 - T - 0.01 ? 1 : -1, line: 'u', at: room.u1 },
      ];
      for (const side of sides) {
        const f = side.f, gaps: Gap[] = [], ways: Gap[] = [];
        if (side.outer >= 0) for (const hole of holes) if (hole.side === side.outer && hole.storey === storey && hole.c > side.lo && hole.c < side.lo + side.L) gaps.push({ s0: hole.c - hole.half - side.lo, s1: hole.c + hole.half - side.lo, y0: hole.y0, y1: hole.y1 });
        for (const door of doors) if (door.line === side.line && Math.abs(door.at - side.at) < 0.01 && door.c > side.lo && door.c < side.lo + side.L) ways.push({ s0: door.c - door.half - side.lo, s1: door.c + door.half - side.lo, y0: fy - 0.05, y1: door.tall ? Math.min(clear - 0.35, fy + 3.0) : doorTop });
        const open = [...gaps, ...ways];
        pierced(f, 'plaster', 0, side.L, fy, clear, 0, 0.1, colour, open);
        pierced(f, 'plaster', 0, side.L, fy, fy + 0.16, -0.02, 0, WHITE, open);
        pierced(f, 'plaster', 0, side.L, fy + 0.9, fy + 0.96, -0.025, 0, WHITE, open);
        on(f, 'plaster', 0, side.L, clear - 0.14, clear, -0.1, 0, WHITE);
        for (const g of ways) {
          for (const [a, e] of [[g.s0 - 0.12, g.s0], [g.s1, g.s1 + 0.12]]) on(f, 'plaster', a, e, fy, g.y1 + 0.12, -0.035, 0, WHITE);
          on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.12, -0.035, 0, WHITE);
        }
      }
      // A stove of glazed tiles in the corner of each front room, away from the windows: a foot, a tall body, a cornice, and its small iron door.
      if (room.kind === 'front') {
        const near = Math.abs(room.u0) < Math.abs(room.u1) ? room.u0 + 0.12 : room.u1 - 0.12 - 0.58, v = room.v1 - 0.12 - 0.8, tiles: Colour = index % 3 ? [0.88, 0.88, 0.84] : [0.3, 0.42, 0.34];
        const body = Math.min(clear - 0.5, fy + 2.3);
        box('stone', near - 0.03, near + 0.61, fy, fy + 0.24, v - 0.03, v + 0.8, [0.2, 0.2, 0.2]);
        box('metal', near, near + 0.58, fy + 0.24, body, v, v + 0.78, tiles);
        box('metal', near - 0.04, near + 0.62, body, body + 0.12, v - 0.04, v + 0.8, tiles);
        box('metal', near + 0.06, near + 0.52, body + 0.12, body + 0.3, v + 0.06, v + 0.72, tiles);
        box('metal', near + 0.16, near + 0.42, fy + 0.45, fy + 0.8, v - 0.025, v, [0.05, 0.05, 0.055]);
      }
      // In the room over the entrance hall, a table and two benches; in the entrance hall itself a bench by the wall.
      if (room.kind === 'hall') {
        const u = (room.u0 + room.u1) / 2, v = (room.v0 + room.v1) / 2 - 0.4, oak: Colour = [0.3, 0.2, 0.12];
        if (storey > 0) {
          box('wood', u - 1.0, u + 1.0, fy + 0.72, fy + 0.78, v - 0.5, v + 0.5, oak, true);
          for (const [du, dv] of [[-0.9, -0.42], [0.84, -0.42], [-0.9, 0.36], [0.84, 0.36]]) box('wood', u + du, u + du + 0.07, fy, fy + 0.72, v + dv, v + dv + 0.07, oak, true);
          for (const dv of [-1.0, 0.72]) {
            box('wood', u - 0.8, u + 0.8, fy + 0.42, fy + 0.46, v + dv, v + dv + 0.3, oak, true);
            for (const du of [-0.74, 0.68]) box('wood', u + du, u + du + 0.06, fy, fy + 0.42, v + dv + 0.04, v + dv + 0.26, oak, true);
          }
        } else {
          box('wood', room.u0 + 0.6, room.u0 + 2.2, fy + 0.44, fy + 0.49, room.v1 - 0.55, room.v1 - 0.15, oak, true);
          for (const du of [0.66, 2.08]) box('wood', room.u0 + du, room.u0 + du + 0.06, fy, fy + 0.44, room.v1 - 0.5, room.v1 - 0.2, oak, true);
        }
      }
    });
  }
}

/** Plain solids for other builders to use: a block between two corners, a squared length between two points, a sheet of roof. */
export function solids(mesh: (material: string) => MeshBuilder) {
  const t = tools({ x: 0, z: 0, w: 0, d: 0, faces: 'w' } as Building, 0, mesh);
  return { block: t.block, stick: t.stick, slope: t.slope };
}

/** Builds one building where the site document says it stands, on ground at the height `base`. `stone` is the tint of the country's stone. */
export function buildBuilding(b: Building, base: number, mesh: (material: string) => MeshBuilder, rng: Rng, stone: Colour, first: boolean): void {
  if (b.style === 'timber') { timberHouse(b, base, mesh, rng, stone, first); return; }
  // (What is built from here on is noted, mesh by mesh, so that it can be told afterwards which of it is indoors.)
  const begun = new Map<MeshBuilder, number>();
  const noting = (material: string) => { const m = mesh(material); if (!begun.has(m)) begun.set(m, m.vertexCount); return m; };
  imperialHouse(b, base, noting, rng, stone);
  // Indoors, only a share of the sky is seen, through the windows: so a room is dimmer than the street, and the sun lies on its floor where it comes in.
  const turn = b.faces === 'w' ? 1 : -1, height = 0.5 + b.heights.reduce((sum, h) => sum + h, 0);
  for (const [m, from] of begun) m.setOpenBy((x, y, z) => {
    const u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
    return Math.abs(u) < b.w / 2 - 0.24 && v > (b.portico && Math.abs(u) < 4.2 ? -0.16 : 0.24) && v < b.d - 0.24 && y > base + 0.3 && y < base + height - 0.02 ? 0.24 : 1;
  }, from);
}
