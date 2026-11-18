import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { buried, CLASSICAL, classicalEnds, classicalFront, classicalStair, floorOf, footprintOf, TIMBER, timberFloor, timberFront, timberStair, timberWindows, wingWindows } from '../core/building';
import { Building } from '../core/site';
import { MeshBuilder } from './geom/meshBuilder';
import { layBeam } from './geom/timber';
import { buildBrick } from './brick';

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

/**
 * Whether a room has a lamp or a fire lit in it when it is dark, told from where it is (so no choice is drawn, and nothing else
 * about a place changes): a share of the rooms, and the colour and strength of the light in each; or nothing if it is dark.
 * Lamplight is yellow and steady, firelight redder; windows of one room are alike.
 */
export function litRoom(x: number, y: number, z: number, share = 0.38): Colour | null {
  const h = (k: number) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k * 19.19) * 43758.5453; return v - Math.floor(v); };
  if (h(0) > share) return null;
  const strength = 0.55 + 0.6 * h(1), fire = h(2);
  return [strength, strength * (0.5 - 0.12 * fire), strength * (0.17 - 0.1 * fire)];
}

/** The tools: where things are, and solids to build with. */
export function buildingTools(b: Building, base: number, mesh: (material: string) => MeshBuilder) {
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
    // (Which room a window belongs to, near enough: a stretch of a wall some three and a half metres long on one storey.)
    const room = f.P(Math.floor(g.s0 / 3.5) * 3.5, Math.floor(g.y0 / 2.6) * 2.6, 0), light = litRoom(Math.round(room.x), Math.round(room.y), Math.round(room.z));
    if (light) on(f, 'window', g.s0, g.s1, g.y0, g.y1, deep + 0.05, deep + 0.08, light);
    else on(f, 'glass', g.s0, g.s1, g.y0, g.y1, deep + 0.05, deep + 0.08, PANE);
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
function timberHouse(b: Building, base: number, given: (material: string) => MeshBuilder, rng: Rng, stone: Colour, first: boolean): void {
  // A house that was burnt is built as any other, through a mesh that chars what it is given: timber nearly black, plaster sooted
  // in streaks, stone darkened; and that throws away its glass, its flowers and its tiles, which did not survive.
  const burnt = !!b.burnt, waste = new MeshBuilder(), charred = new Map<string, MeshBuilder>();
  const mesh = !burnt ? given : (material: string): MeshBuilder => {
    if (material === 'glass' || material === 'window' || material === 'leaf' || material === 'tile') return waste;
    let m = charred.get(material);
    if (!m) {
      const real = given(material), k = material === 'wood' ? 0.28 : material === 'plaster' ? 0.42 : material === 'stone' ? 0.62 : 0.8;
      m = Object.create(real) as MeshBuilder;
      m.addVertex = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, r = 1, g = 1, bl = 1, ...rest: number[]) => {
        // (Soot rises: the upper part of a wall is blacker than its foot.)
        const up = Math.min(1, Math.max(0, (py - base) / 4)), f = k * (1 - 0.35 * up) * (0.85 + 0.3 * Math.abs(Math.sin(px * 3.1 + pz * 2.3)));
        return real.addVertex(px, py, pz, nx, ny, nz, u, v, r * f, g * f, bl * f, ...rest);
      };
      charred.set(material, m);
    }
    return m;
  };
  const k = buildingTools(b, base, mesh), { at, box, on, stick, pierced, glazed, wedge, slope } = k;
  const W = b.w, D = b.d, jetty = b.jetty ?? 0.35, T = 0.3, PLINTH = 0.3, H0 = b.heights[0];
  // How far behind the face of the posts each layer of a framed wall stands (see the storeys of framing).
  const RAIL = 0.015, BRACE = 0.028, CROSS = 0.04, PANEL = 0.06;
  // (Each storey is as high as the document says, so floors stand at different heights from house to house.)
  const floorOf = (storey: number) => PLINTH + b.heights.slice(0, storey).reduce((sum, h) => sum + h, 0), frontOf = (storey: number) => -jetty * storey;
  const top = floorOf(b.storeys), front = frontOf(b.storeys - 1);
  const paint: Colour = rng.pick([[0.16, 0.28, 0.2], [0.2, 0.26, 0.36], [0.36, 0.14, 0.11], [0.3, 0.24, 0.14]] as Colour[]);
  const frame: Colour = [0.8, 0.78, 0.7];

  // The ground storey: a stone plinth, plastered walls, a door and a window or two to the street, one small window to each side and the back.
  box('stone', -W / 2 - 0.07, W / 2 + 0.07, 0, PLINTH + 0.18, -0.07, D + 0.07, shade(stone, 0.8));
  const ground = k.walls(0);
  // (Where the door is, the site document says; the choice made here is kept only so that nothing after it is dealt differently.)
  const picked = rng.pick([0.24, 0.5, 0.76]), doorAt = W * (b.door ?? picked), door: Gap = { s0: doorAt - 0.52, s1: doorAt + 0.52, y0: PLINTH - 0.12, y1: PLINTH + 2.28 };
  ground.forEach((f, i) => {
    const gaps: Gap[] = [];
    if (i === 0) gaps.push(door);
    for (const [s0, s1] of timberWindows(b, 0)[i]) gaps.push({ s0, s1, y0: PLINTH + (i === 0 ? 0.95 : 1.15), y1: PLINTH + (i === 0 ? 2.0 : 1.95) });
    // (The ground storey is stone under its plaster, and thick: more than half a metre.)
    pierced(f, 'plaster', 0, f.L, PLINTH + 0.18, PLINTH + H0, 0, 0.56, LIMEWASH, gaps);
    for (const g of gaps) {
      if (g === door) {
        // A door of upright boards in a frame of oak, with a stone step before it.
        // (The boards of the door are dealt their tones whether it is shut or stands open inside: see the hall.)
        const tones = Array.from({ length: 5 }, () => 0.9 + 0.2 * rng.next());
        if (!b.plan) {
          for (let n = 0; n < 5; n++) on(f, 'wood', g.s0 + 0.1 + n * 0.168, g.s0 + 0.1 + (n + 1) * 0.168 - 0.008, PLINTH + 0.02, g.y1 - 0.1, 0.12, 0.17, shade(paint, tones[n]), true);
          for (const y of [PLINTH + 0.3, PLINTH + 1.55]) on(f, 'metal', g.s0 + 0.1, g.s1 - 0.1, y, y + 0.07, 0.1, 0.125, [0.05, 0.05, 0.055]);
          on(f, 'metal', g.s1 - 0.26, g.s1 - 0.2, PLINTH + 0.95, PLINTH + 1.1, 0.06, 0.12, [0.06, 0.06, 0.06]);
        }
        for (const [a, c] of [[g.s0 - 0.04, g.s0 + 0.1], [g.s1 - 0.1, g.s1 + 0.04]]) on(f, 'wood', a, c, PLINTH, g.y1 + 0.02, -0.03, 0.2, OAK, true);
        on(f, 'wood', g.s0 - 0.1, g.s1 + 0.1, g.y1 - 0.1, g.y1 + 0.1, -0.04, 0.2, OAK, true);
        on(f, 'stone', g.s0 - 0.25, g.s1 + 0.25, 0, PLINTH - 0.1, -0.55, 0.02, shade(stone, 0.9));
        on(f, 'stone', g.s0 - 0.12, g.s1 + 0.12, 0, PLINTH, -0.28, 0.02, shade(stone, 0.95));
      } else {
        glazed(f, g, 2, i === 0 ? 3 : 2, frame, 0.2);
        on(f, 'stone', g.s0 - 0.08, g.s1 + 0.08, g.y0 - 0.1, g.y0, -0.15, 0.2, shade(stone, 0.95));
        on(f, 'wood', g.s0 - 0.08, g.s1 + 0.08, g.y1, g.y1 + 0.14, -0.03, 0.14, OAK, true);
        // Inside, a board for a sill across the depth of the wall.
        on(f, 'wood', g.s0 - 0.04, g.s1 + 0.04, g.y0 - 0.05, g.y0, 0.27, 0.6, shade(OAK, 1.5), true);
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
      const lit = new Set<number>(timberWindows(b, storey)[i].map(([s0]) => Math.round((s0 - 0.2) / pitch)));
      const gaps: Gap[] = [...lit].map((n) => ({ s0: n * pitch + 0.2, s1: (n + 1) * pitch - 0.2, y0: sill + 0.14, y1: head }));
      // (Each layer of the frame stands at its own depth, a centimetre and more from the next, so that no two faces lie in one plane and
      // flicker against each other: posts and beams in front, rails and studs behind them, the braces behind those, the plaster at the back.)
      pierced(f, 'plaster', 0.05, f.L - 0.05, y0, y1, PANEL, T, b.colour, gaps);
      // Sill beam and head beam, posts, and the rail under the windows.
      on(f, 'wood', 0, f.L, y0 - 0.14, y0 + 0.2, 0, 0.2, OAK, true);
      on(f, 'wood', 0, f.L, y1 - 0.2, y1, 0, 0.2, OAK, true);
      for (let n = 0; n <= bays; n++) {
        const half = n === 0 || n === bays ? 0.11 : 0.085, s = Math.min(f.L - half, Math.max(half, n * pitch));
        on(f, 'wood', s - half, s + half, y0 + 0.2, y1 - 0.2, 0, 0.18, OAK, true);
      }
      on(f, 'wood', 0.1, f.L - 0.1, sill, sill + 0.14, RAIL, 0.17, OAK, true);
      for (let n = 0; n < bays; n++) {
        const a = n * pitch + 0.09, c = (n + 1) * pitch - 0.09;
        if (lit.has(n)) {
          const g = gaps.find((q) => Math.abs(q.s0 - (n * pitch + 0.2)) < 0.01)!;
          on(f, 'wood', a, c, head, head + 0.13, RAIL, 0.17, OAK, true);
          for (const [p, q] of [[a, g.s0], [g.s1, c]]) on(f, 'wood', p, q, sill + 0.14, head, RAIL, 0.16, OAK, true);
          glazed(f, g, 2, 2, frame, 0.07);
          // Under a window, more often than not, a cross.
          if (rng.chance(0.65)) {
            stick(f.P(a, y0 + 0.2, BRACE + 0.08), f.P(c, sill, BRACE + 0.08), 0.16, 0.11, OAK);
            stick(f.P(c, y0 + 0.2, CROSS + 0.075), f.P(a, sill, CROSS + 0.075), 0.15, 0.11, OAK);
          } else on(f, 'wood', (a + c) / 2 - 0.06, (a + c) / 2 + 0.06, y0 + 0.2, sill, RAIL, 0.16, OAK, true);
          if (i === 0) {
            for (const [p, q] of [[g.s0 - 0.36, g.s0 - 0.01], [g.s1 + 0.01, g.s1 + 0.36]]) on(f, 'wood', p, q, g.y0, g.y1, -0.03, 0.005, paint, true);
            // A box of flowers on the sill.
            on(f, 'wood', g.s0 - 0.05, g.s1 + 0.05, sill + 0.02, sill + 0.2, -0.2, -0.01, shade(OAK, 1.4), true);
            for (let s = g.s0; s < g.s1 - 0.05; s += 0.14) on(f, 'leaf', s, s + 0.12, sill + 0.2, sill + 0.27 + 0.1 * rng.next(), -0.19 + 0.05 * rng.next(), -0.03, rng.chance(0.55) ? [0.7, 0.07, 0.1] : [0.16, 0.36, 0.1]);
          }
        } else {
          // A brace from the foot of one post to the head of the next, leaning the way of its neighbours on that side of the wall.
          const lean = n < bays / 2;
          stick(f.P(lean ? a : c, y0 + 0.2, BRACE + 0.08), f.P(lean ? c : a, y1 - 0.2, BRACE + 0.08), 0.16, 0.13, OAK);
          if (y1 - sill > 1.45) on(f, 'wood', a, c, sill + 1.0, sill + 1.1, RAIL, 0.16, OAK, true);
        }
      }
    });
  }

  // The roof. A gable is framed as the walls are: rafters, a collar, a post, and a small window for the loft.
  const pitch = Math.tan(((b.gable ? 56 : 52) * Math.PI) / 180), eave = 0.45, verge = 0.38, tile: [string, Colour] = ['tile', [1.15, 1.08, 1.02]], dark: [string, Colour] = ['wood', shade(OAK, 0.8)];
  const gableWall = (f: Face, y: number, t: number) => {
    const half = f.L / 2, rise = half * pitch, mid = f.P(half, y + rise, t);
    const into = f.P(0, 0, 0.26).sub(f.P(0, 0, 0));
    wedge(f.P(0, y, t + PANEL), f.P(f.L, y, t + PANEL), f.P(half, y + rise, t + PANEL), into, ['plaster', b.colour], ['plaster', b.colour]);
    const collar = y + rise * 0.48, inAt = (h: number) => (h - y) / pitch;
    // (The two rafters meet at the top, so they too stand at different depths.)
    stick(f.P(0.05, y + 0.05, t + BRACE + 0.08), f.P(half, y + rise - 0.1, t + BRACE + 0.08), 0.16, 0.16, OAK);
    stick(f.P(f.L - 0.05, y + 0.05, t + CROSS + 0.08), f.P(half, y + rise - 0.1, t + CROSS + 0.08), 0.16, 0.16, OAK);
    on(f, 'wood', inAt(collar) + 0.1, f.L - inAt(collar) - 0.1, collar, collar + 0.14, t, t + 0.18, OAK, true);
    on(f, 'wood', half - 0.07, half + 0.07, collar + 0.14, y + rise - 0.25, t + RAIL, t + 0.17, OAK, true);
    for (const side of [-1, 1]) on(f, 'wood', half + side * half * 0.5 - 0.07, half + side * half * 0.5 + 0.07, y, y + rise * 0.5 - 0.12, t + RAIL, t + 0.17, OAK, true);
    const g: Gap = { s0: half - 0.36, s1: half + 0.36, y0: y + 0.5, y1: Math.min(collar - 0.08, y + 1.4) };
    on(f, 'wood', g.s0 - 0.09, g.s1 + 0.09, g.y0 - 0.1, g.y1 + 0.1, t + RAIL, t + 0.15, OAK, true);
    glazed(f, g, 2, 1, frame, t - 0.02);
    return mid;
  };
  const upper = k.walls(front);
  if (burnt) {
    // (No roof: a burnt house is open to the sky, and its gables fell with the roof.)
  } else if (b.gable) {
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
      box('plaster', u - w, u + w, y0 - 0.5, y0 + h, v0 + PANEL, v0 + 1.6, b.colour);
      for (const side of [-1, 1]) box('wood', u + side * w - 0.07, u + side * w + 0.07, y0 - 0.5, y0 + h, v0, v0 + 0.16, OAK, true);
      box('wood', u - w, u + w, y0 + h - 0.12, y0 + h, v0 + RAIL, v0 + 0.16, OAK, true);
      box('wood', u - w, u + w, y0 + 0.12, y0 + 0.24, v0 + RAIL, v0 + 0.16, OAK, true);
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
  // ------------------------------------------------------------------ inside
  // The rooms are as the site document plans them. A hall along one side with the stair in it,
  // the room beside it; landings and chambers above. Floors are boards on the joists whose ends
  // show under each storey outside; the walls between rooms are framed and filled as the outer
  // walls are, and the stair is a steep one of oak, boxed in below and with a screen of slats
  // along its open side, which is also what keeps anyone on a landing out of the well.
  if (b.plan) {
    const plan = b.plan, st = timberStair(b), G = TIMBER.ground, F = (storey: number) => timberFloor(b, storey);
    const boards: Colour = [0.36, 0.26, 0.16], linen: Colour = [0.8, 0.77, 0.7], iron: Colour = [0.05, 0.05, 0.055], away = -st.side;
    type Rect = { u0: number; u1: number; v0: number; v1: number };
    const without = (r: Rect, hole: Rect): Rect[] => [
      { u0: r.u0, u1: r.u1, v0: r.v0, v1: Math.min(r.v1, hole.v0) },
      { u0: r.u0, u1: r.u1, v0: Math.max(r.v0, hole.v1), v1: r.v1 },
      { u0: r.u0, u1: Math.min(r.u1, hole.u0), v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) },
      { u0: Math.max(r.u0, hole.u1), u1: r.u1, v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) },
    ].filter((q) => q.u1 - q.u0 > 0.01 && q.v1 - q.v0 > 0.01);
    const well: Rect = { u0: st.u0, u1: st.u1, v0: st.v0, v1: st.v1 };
    // A block between two places across the house (given as distances from the side wall the stair is on, or as `u`), whichever way round they come.
    const span = (material: string, ua: number, ub: number, y0: number, y1: number, v0: number, v1: number, colour: Colour, grain = false) => box(material, Math.min(ua, ub), Math.max(ua, ub), y0, y1, v0, v1, colour, grain);

    // The floors, and over the top storey its ceiling; under each, its joists.
    for (let storey = 1; storey <= b.storeys; storey++) {
      const ceiling = storey === b.storeys, y = floorOf(storey), fr = frontOf(Math.min(storey, b.storeys - 1));
      const all: Rect = { u0: -W / 2 + 0.25, u1: W / 2 - 0.25, v0: fr + 0.2, v1: D - 0.25 }, under = ceiling ? y : y - 0.13;
      // (A burnt house has lost its ceiling with its roof.)
      if (ceiling && burnt) continue;
      for (const r of ceiling ? [all] : without(all, well)) box('wood', r.u0, r.u1, under, ceiling ? y + 0.1 : y + 0.012, r.v0, r.v1, boards, true);
      const below = storey - 1, t = below === 0 ? G : T, deep = ceiling ? 0.15 : 0.2, a = frontOf(below) + t - 0.02, c = D - t + 0.02;
      for (let u = -W / 2 + 0.2; u < W / 2 - 0.1; u += 0.52) {
        const cut = !ceiling && u + 0.13 > well.u0 && u < well.u1;
        for (const [p, q] of cut ? [[a, well.v0 - 0.02], [well.v1 + 0.02, c]] : [[a, c]]) box('wood', u, u + 0.13, under - deep, under, p, q, OAK, true);
      }
      // (Round the well, a trimmer at each end to carry the joists that are cut short.)
      if (!ceiling) for (const v of [well.v0 - 0.14, well.v1 + 0.02]) box('wood', well.u0 - 0.12, well.u1 + 0.12, under - deep, under, v, v + 0.12, OAK, true);
    }
    // The room's floor is boarded; the hall's is the stone of the plinth.
    for (const r of plan.rooms) if (r.storey === 0 && r.kind === 'front') box('wood', r.u0, r.u1, F(0), F(0) + 0.02, r.v0, r.v1, boards, true);

    // A framed wall between rooms: a plate along its top, posts, a rail, the panels between washed white, and its doorways framed in oak.
    const framed = (line: 'u' | 'v', where: number, from: number, to: number, y0: number, y1: number, doors: { c: number; w: number }[]) => {
      const put = (material: string, a: number, c: number, lo: number, hi: number, half: number, colour: Colour, grain = false) => {
        if (c - a < 0.01) return;
        if (line === 'u') box(material, where - half, where + half, lo, hi, a, c, colour, grain); else box(material, a, c, lo, hi, where - half, where + half, colour, grain);
      };
      const head = Math.min(y0 + 1.98, y1 - 0.3), sorted = [...doors].sort((p, q) => p.c - q.c), panels: [number, number][] = [];
      let s = from;
      for (const d of sorted) {
        panels.push([s, d.c - d.w / 2]);
        put('plaster', d.c - d.w / 2, d.c + d.w / 2, head + 0.1, y1, 0.04, LIMEWASH);
        for (const e of [d.c - d.w / 2 - 0.1, d.c + d.w / 2]) put('wood', e, e + 0.1, y0, y1, 0.07, OAK, true);
        put('wood', d.c - d.w / 2, d.c + d.w / 2, head, head + 0.12, 0.07, OAK, true);
        s = d.c + d.w / 2;
      }
      panels.push([s, to]);
      for (const [a, c] of panels) {
        put('plaster', a, c, y0, y1, 0.04, LIMEWASH);
        put('wood', a, c, y0 + 1.0, y0 + 1.1, 0.062, OAK, true);
        const n = Math.max(1, Math.round((c - a) / 1.3));
        for (let k = 0; k <= n; k++) { const p = a + ((c - a) * k) / n; put('wood', Math.max(a, p - 0.06), Math.min(c, p + 0.06), y0, y1, 0.07, OAK, true); }
      }
      put('wood', from, to, y1 - 0.14, y1, 0.07, OAK, true);
    };
    for (let storey = 0; storey < b.storeys; storey++) {
      const y0 = F(storey), y1 = storey === b.storeys - 1 ? top : floorOf(storey + 1) - 0.13;
      const rooms = plan.rooms.filter((r) => r.storey === storey), doors = plan.doors.filter((d) => d.storey === storey && d.line === 'u');
      const hall = rooms.find((r) => r.kind === 'hall' || r.kind === 'passage')!, others = rooms.filter((r) => r !== hall);
      framed('u', doors[0].at, hall.v0, hall.v1, y0, y1, doors);
      if (others.length === 2) framed('v', (others[0].v1 + others[1].v0) / 2, others[0].u0, others[0].u1, y0, y1, []);

      // What stands in the rooms.
      for (const r of others) {
        const near = st.side < 0 ? r.u0 : r.u1, far = st.side < 0 ? r.u1 : r.u0, oak: Colour = [0.3, 0.2, 0.12];
        if (storey === 0) {
          // By the outer wall, under the windows to the street, a table with a bench on either side of it; in the inn, another further back.
          for (const v of first && r.v1 - r.v0 > 4.6 ? [r.v0 + 0.45, r.v1 - 2.1] : [r.v0 + 0.45]) {
            span('wood', far - away * 0.5, far - away * 1.25, y0 + 0.72, y0 + 0.78, v, v + 1.5, oak, true);
            for (const [du, dv] of [[0.54, 0.06], [1.15, 0.06], [0.54, 1.38], [1.15, 1.38]]) span('wood', far - away * du, far - away * (du + 0.06), y0, y0 + 0.72, v + dv, v + dv + 0.06, oak, true);
            for (const du of [0.08, 1.36]) {
              span('wood', far - away * du, far - away * (du + 0.3), y0 + 0.42, y0 + 0.47, v + 0.05, v + 1.45, oak, true);
              for (const dv of [0.12, 1.3]) span('wood', far - away * (du + 0.04), far - away * (du + 0.26), y0, y0 + 0.42, v + dv, v + dv + 0.06, oak, true);
            }
          }
          // Against the wall of the hall, from which it is fed, a stove of green tiles on a stone foot.
          const v = (r.v0 + r.v1) / 2 + 0.3, tiles: Colour = [0.2, 0.34, 0.24];
          span('stone', near + away * 0.03, near + away * 0.71, y0, y0 + 0.22, v - 0.03, v + 0.83, [0.3, 0.3, 0.3]);
          span('metal', near + away * 0.06, near + away * 0.68, y0 + 0.22, y0 + 1.5, v, v + 0.8, tiles);
          span('metal', near + away * 0.03, near + away * 0.71, y0 + 1.5, y0 + 1.6, v - 0.03, v + 0.83, tiles);
          span('metal', near + away * 0.14, near + away * 0.6, y0 + 1.6, y0 + 1.85, v + 0.08, v + 0.72, tiles);
        } else {
          // A bed along the outer wall, its head to the wall between the chambers, and a chest.
          const head = r.kind === 'front' ? r.v1 - 0.06 : r.v0 + 0.06, way = r.kind === 'front' ? -1 : 1, foot = head + way * 1.9;
          const lie = (material: string, du0: number, du1: number, lo: number, hi: number, d0: number, d1: number, colour: Colour, grain = false) => span(material, far - away * du0, far - away * du1, lo, hi, Math.min(head + way * d0, head + way * d1), Math.max(head + way * d0, head + way * d1), colour, grain);
          lie('wood', 0.06, 1.0, y0 + 0.14, y0 + 0.34, 0, 1.9, oak, true);
          for (const [du, dd] of [[0.06, 0], [0.92, 0], [0.06, 1.82], [0.92, 1.82]]) lie('wood', du, du + 0.08, y0, y0 + (dd ? 0.5 : 0.95), dd, dd + 0.08, oak, true);
          lie('wood', 0.06, 1.0, y0 + 0.5, y0 + 0.95, 0, 0.05, oak, true);
          lie('plaster', 0.1, 0.96, y0 + 0.34, y0 + 0.46, 0.08, 1.82, linen);
          lie('plaster', 0.2, 0.86, y0 + 0.46, y0 + 0.55, 0.1, 0.5, linen);
          lie('plaster', 0.08, 0.98, y0 + 0.44, y0 + 0.5, 0.62, 1.84, shade(b.colour, 0.55));
          void foot;
          const cv = r.kind === 'front' ? r.v1 - 1.05 : r.v0 + 0.1;
          span('wood', near + away * 0.1, near + away * 0.55, y0, y0 + 0.45, cv, cv + 0.95, shade(oak, 0.85), true);
          span('wood', near + away * 0.08, near + away * 0.57, y0 + 0.45, y0 + 0.5, cv - 0.02, cv + 0.97, oak, true);
          for (const dv of [0.15, 0.75]) span('metal', near + away * 0.09, near + away * 0.56, y0, y0 + 0.51, cv + dv, cv + dv + 0.05, iron);
        }
      }
    }

    // The stair.
    const rail = st.at(G + TIMBER.stair + 0.04), length = st.v1 - st.v0;
    st.flights.forEach((f, k) => {
      const y = F(k), up = F(k + 1) - y, railY = (v: number) => y + 0.95 + (up * (v - st.v0)) / length;
      for (let i = 0; i < f.steps - 1; i++) {
        const va = st.v0 + i * f.tread, step = y + (i + 1) * f.rise;
        // (The lowest flight is boxed in to the floor. Those above are treads only, boards let into a string at each side: a flight
        // with risers would hang too low over the heads of those coming up the flight beneath it, where the storey is a low one.)
        if (k === 0) box('wood', st.u0, st.u1, y, step, va, va + f.tread, shade(boards, 0.9), true);
        else box('wood', st.u0, st.u1, step - 0.05, step, va - 0.02, va + f.tread, shade(boards, 0.9), true);
        box('wood', rail - 0.022, rail + 0.022, k === 0 ? step : y, railY(va + f.tread / 2), va + f.tread / 2 - 0.022, va + f.tread / 2 + 0.022, OAK, true);
      }
      if (k > 0) for (const u of [st.u0 + 0.025, st.u1 - 0.025]) stick(at(u, y + f.rise - 0.16, st.v0), at(u, y + up - 0.16, st.v1 - f.tread), 0.05, 0.24, OAK);
      stick(at(rail, railY(st.v0), st.v0), at(rail, railY(st.v1), st.v1), 0.07, 0.08, OAK);
      box('wood', rail - 0.05, rail + 0.05, y, railY(st.v0) + 0.1, st.v0 - 0.05, st.v0 + 0.05, OAK, true);
      box('wood', rail - 0.05, rail + 0.05, k === 0 ? y + up - f.rise : y, railY(st.v1) + 0.1, st.v1 - 0.05, st.v1 + 0.05, OAK, true);
    });
    if (b.storeys > 1) {
      // On the top floor nothing goes up, and the well has a rail along it and across its end.
      const y = F(b.storeys - 1), wall = st.at(T), end = st.v0 - 0.04;
      stick(at(rail, y + 0.95, end), at(rail, y + 0.95, st.v1), 0.07, 0.08, OAK);
      stick(at(rail, y + 0.95, end), at(wall, y + 0.95, end), 0.07, 0.08, OAK);
      for (let v = st.v0 + 0.1; v < st.v1 - 0.05; v += 0.2) box('wood', rail - 0.022, rail + 0.022, y, y + 0.95, v - 0.022, v + 0.022, OAK, true);
      for (let u = Math.min(rail, wall) + 0.12; u < Math.max(rail, wall) - 0.06; u += 0.2) box('wood', u - 0.022, u + 0.022, y, y + 0.95, end - 0.022, end + 0.022, OAK, true);
      for (const v of [end, st.v1]) box('wood', rail - 0.05, rail + 0.05, y, y + 1.05, v - 0.05, v + 0.05, OAK, true);
    }
    // The door stands open, back against the wall of the hall; and at the back of the hall, behind the stair, a barrel.
    {
      const m = (st.side < 0 ? doorAt : W - doorAt) + 0.56, y = F(0);
      span('wood', st.at(m), st.at(m + 0.05), y + 0.02, y + 1.98, G + 0.02, G + 1.0, paint, true);
      for (const h of [0.3, 1.55]) span('metal', st.at(m - 0.02), st.at(m), y + h, y + h + 0.07, G + 0.06, G + 0.96, iron);
      span('wood', st.at(G + 0.12), st.at(G + 0.68), y, y + 0.85, st.v1 + 0.15, st.v1 + 0.71, shade(OAK, 1.3), true);
      for (const h of [0.15, 0.65]) span('metal', st.at(G + 0.1), st.at(G + 0.7), y + h, y + h + 0.05, st.v1 + 0.13, st.v1 + 0.73, iron);
    }
  }
  // In a burnt house, what fell when the roof burnt lies on the floor of each storey: charred beams, at angles, one end propped on another.
  if (burnt) {
    const fall = rng.fork('fallen');
    for (let storey = 0; storey < b.storeys; storey++) {
      const y = storey === 0 ? PLINTH + 0.18 : floorOf(storey), fr = frontOf(storey) + 0.6;
      for (let n = 0; n < 3; n++) {
        const u0 = fall.range(-W / 2 + 0.8, W / 2 - 0.8), v0 = fall.range(fr + 0.4, D - 1), a = fall.range(0, Math.PI), len = fall.range(1.8, 3.2);
        const u1 = Math.max(-W / 2 + 0.5, Math.min(W / 2 - 0.5, u0 + Math.cos(a) * len)), v1 = Math.max(fr, Math.min(D - 0.6, v0 + Math.sin(a) * len));
        stick(at(u0, y + 0.1, v0), at(u1, y + 0.1 + fall.range(0, 0.7), v1), 0.16, 0.18, OAK);
      }
    }
  }
  // The first house of a row is the inn, and hangs out its sign.
  if (first && !burnt) {
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
  const k = buildingTools(b, base, mesh), { at, box, on, stick, pierced, glazed, wedge, poly, block } = k;
  // (`T` is the rendered skin of an outer wall, which carries its windows; the rest of its thickness is the linings of the rooms inside.)
  const W = b.w, D = b.d, T = CLASSICAL.skin, FULL = CLASSICAL.outer, PLINTH = CLASSICAL.plinth, N = b.storeys, H0 = b.heights[0], wash = b.colour, granite = shade(stone, 0.62);
  const floorY = (storey: number) => floorOf(b, storey);
  const y1 = floorY(1), top = floorY(N);
  const frame: Colour = [0.86, 0.85, 0.8], leaf: Colour = rng.pick([[0.1, 0.17, 0.13], [0.2, 0.12, 0.07], [0.12, 0.13, 0.2]] as Colour[]);
  const roofTone: Colour = rng.pick([[0.36, 0.45, 0.4], [0.4, 0.2, 0.16], [0.3, 0.31, 0.33]] as Colour[]);
  /** Every opening in the outer walls, as the rooms inside need to know them: which wall (front, right, back, left), where along it in the building's measures, and how high. */
  // (`axis` says whether the wall is a line of constant `v` or of constant `u`; `lo` and `hi` are where its skin lies across its thickness, on that axis.)
  const holes: { axis: 'u' | 'v'; lo: number; hi: number; c: number; half: number; y0: number; y1: number; storey: number }[] = [];

  // One wall: its storeys, their windows, and what is moulded about them. `door` is the bay the door stands in, if any; `plain` leaves off the cornices over the windows.
  type Opening = Gap & { kind: 'window' | 'door' | 'back' | 'through' };
  // `centres` places the windows, along the wall from its left end, where they must line up with others; `back` is where a back door stands, if this wall has one.
  const wall = (f: Face, bays: number, side: number, o: { door?: number; plain?: boolean; margin?: number; centres?: number[]; back?: number; through?: number[] } = {}) => {
    const margin = o.margin ?? 0.8, pitch = (f.L - margin * 2) / bays, centre = (n: number) => o.centres?.[n] ?? margin + (n + 0.5) * pitch;
    // (Windows are as tall as their storeys allow: the room each lights is as high as the document says. None is cut where the ground stands against the wall.)
    // (`through` are doors on every storey into a wing behind this wall: plain openings, with no window in them.)
    const rows: Opening[][] = Array.from({ length: N }, (_, storey) => [...Array.from({ length: bays }, (_, n): Opening | null => {
      const c = centre(n), fy = floorY(storey), h = b.heights[storey];
      if (storey === 1 && o.back !== undefined && Math.abs(c - o.back) < 0.05) return { s0: c - 0.62, s1: c + 0.62, y0: fy - 0.01, y1: fy + Math.min(2.8, h - 0.75), kind: 'back' };
      const g: Opening = storey === 0
        ? n === o.door ? { s0: c - 0.85, s1: c + 0.85, y0: PLINTH - 0.01, y1: PLINTH + Math.min(3.3, H0 - 0.55), kind: 'door' } : { s0: c - 0.58, s1: c + 0.58, y0: PLINTH + 0.85, y1: PLINTH + H0 - 0.9, kind: 'window' }
        : { s0: c - 0.6, s1: c + 0.6, y0: fy + (storey === 1 ? 0.62 : 0.6), y1: fy + h - 1.05, kind: 'window' };
      return g.kind === 'window' && buried(b, k.local(f.P(c, 0, 0)).v, g.y0) ? null : g;
    }), ...(o.through ?? []).map((c): Opening => ({ s0: c - 0.55, s1: c + 0.55, y0: floorY(storey) - 0.01, y1: floorY(storey) + Math.min(2.35, b.heights[storey] - 0.75), kind: 'through' }))].filter((g): g is Opening => g !== null));
    rows.forEach((row, storey) => row.forEach((g) => {
      const p = k.local(f.P((g.s0 + g.s1) / 2, 0, 0));
      const q = k.local(f.P((g.s0 + g.s1) / 2, 0, T)), axis = Math.abs(q.u - p.u) > Math.abs(q.v - p.v) ? 'u' : 'v';
      holes.push({ axis, lo: Math.min(p[axis], q[axis]), hi: Math.max(p[axis], q[axis]), c: axis === 'u' ? p.v : p.u, half: (g.s1 - g.s0) / 2, y0: g.y0, y1: g.y1, storey });
    }));
    on(f, 'stone', -0.07, f.L + 0.07, 0, PLINTH, -0.07, T, granite);
    // (A building of one storey is all principal storey: smooth, not rusticated, and its windows dressed as the principal storey's are.)
    pierced(f, 'plaster', 0, f.L, PLINTH, y1, 0, T, wash, rows[0], N > 1 ? 0.44 : 0);
    for (let storey = 1; storey < N; storey++) pierced(f, 'plaster', 0, f.L, floorY(storey), floorY(storey + 1), 0.02, T, wash, rows[storey]);
    if (N > 1) {
      // The band between the ground storey and the one above, and a thin one under its windows; broken where a door goes through them.
      const doors = (rows[1] ?? []).filter((g) => g.kind === 'back' || g.kind === 'through');
      pierced(f, 'plaster', -0.1, f.L + 0.1, y1 - 0.05, y1 + 0.2, -0.1, 0.05, WHITE, doors);
      pierced(f, 'plaster', -0.06, f.L + 0.06, y1 + 0.2, y1 + 0.27, -0.06, 0.05, WHITE, doors);
      pierced(f, 'plaster', -0.04, f.L + 0.04, y1 + 0.52, y1 + 0.62, -0.035, 0.05, WHITE, doors);
    }
    // A door at the back, onto the ground there: plainer than the front, its leaves standing open into the room.
    for (const g of rows[1] ?? []) if (g.kind === 'back') {
      for (const [a, e] of [[g.s0 + 0.03, g.s0 + 0.09], [g.s1 - 0.09, g.s1 - 0.03]]) on(f, 'wood', a, e, g.y0 + 0.03, g.y1 - 0.08, FULL - 0.02, FULL + 0.62, leaf, true);
      on(f, 'wood', g.s0, g.s1, g.y1 - 0.08, g.y1, 0.08, 0.2, frame, true);
      for (const [a, e] of [[g.s0 - 0.18, g.s0], [g.s1, g.s1 + 0.18]]) on(f, 'plaster', a, e, g.y0 - 0.2, g.y1 + 0.18, -0.06, 0.05, WHITE);
      on(f, 'plaster', g.s0 - 0.3, g.s1 + 0.3, g.y1 + 0.18, g.y1 + 0.3, -0.16, 0.05, WHITE);
      on(f, 'stone', g.s0 - 0.1, g.s1 + 0.1, g.y0 - 0.25, g.y0, -0.5, FULL + 0.02, shade(stone, 0.8));
    }
    rows[0].forEach((g) => {
      if (g.kind === 'through') return;
      if (g.kind === 'door') {
        // The door: two leaves standing open into the hall, under a light of its own.
        const lintel = g.y1 - 0.62;
        for (const [a, e] of [[g.s0 + 0.03, g.s0 + 0.09], [g.s1 - 0.09, g.s1 - 0.03]]) on(f, 'wood', a, e, g.y0 + 0.03, lintel, FULL - 0.02, FULL + 0.8, leaf, true);
        on(f, 'wood', g.s0, g.s1, lintel, lintel + 0.09, 0.08, 0.18, frame, true);
        glazed(f, { s0: g.s0 + 0.02, s1: g.s1 - 0.02, y0: lintel + 0.09, y1: g.y1 - 0.02 }, 4, 1, frame);
        for (const [a, e] of [[g.s0 - 0.2, g.s0], [g.s1, g.s1 + 0.2]]) on(f, 'plaster', a, e, PLINTH, g.y1 + 0.02, -0.07, 0.05, WHITE);
        on(f, 'plaster', g.s0 - 0.3, g.s1 + 0.3, g.y1 + 0.02, g.y1 + 0.3, -0.1, 0.05, WHITE);
        on(f, 'plaster', g.s0 - 0.4, g.s1 + 0.4, g.y1 + 0.3, g.y1 + 0.42, -0.24, 0.05, WHITE);
        // The threshold, and steps of stone, each broader than the one above it.
        on(f, 'stone', g.s0, g.s1, PLINTH - 0.25, PLINTH, -0.02, FULL + 0.02, shade(stone, 0.85));
        // (Four low ones: the ground before a door is never quite the height it was levelled to, and a step and a bit stops a walker dead.)
        for (let step = 0; step < 4; step++) on(f, 'stone', g.s0 - 0.5 - step * 0.3, g.s1 + 0.5 + step * 0.3, -0.3, PLINTH - step * (PLINTH / 4), -0.4 - step * 0.32, 0.01, shade(stone, 0.78));
      } else if (N > 1) {
        glazed(f, g, 2, 3, frame, 0.14);
        // Over a window of the ground storey, the stones of a flat arch with its key standing proud.
        on(f, 'plaster', g.s0 - 0.16, g.s1 + 0.16, g.y1, g.y1 + 0.3, -0.03, 0.05, WHITE);
        on(f, 'plaster', (g.s0 + g.s1) / 2 - 0.12, (g.s0 + g.s1) / 2 + 0.12, g.y1 - 0.02, g.y1 + 0.38, -0.07, 0.05, WHITE);
        on(f, 'stone', g.s0 - 0.08, g.s1 + 0.08, g.y0 - 0.12, g.y0, -0.16, 0.16, granite);
      }
    });
    (N > 1 ? rows[1] ?? [] : rows[0].filter((g) => g.kind === 'window')).forEach((g, n) => {
      if (g.kind === 'back' || g.kind === 'through') return;
      glazed(f, g, 2, 4, frame);
      // The surround; the sill on its two blocks; and over it a frieze and a cornice on brackets, with a pediment in every other bay.
      for (const [a, e] of [[g.s0 - 0.17, g.s0], [g.s1, g.s1 + 0.17]]) on(f, 'plaster', a, e, g.y0, g.y1 + 0.17, -0.045, 0.06, WHITE);
      on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.17, -0.045, 0.06, WHITE);
      on(f, 'plaster', g.s0 - 0.24, g.s1 + 0.24, g.y0 - 0.1, g.y0, -0.2, 0.08, WHITE);
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
      if (g.kind === 'through') continue;
      glazed(f, g, 2, 2, frame);
      for (const [a, e] of [[g.s0 - 0.15, g.s0], [g.s1, g.s1 + 0.15]]) on(f, 'plaster', a, e, g.y0, g.y1 + 0.15, -0.04, 0.06, WHITE);
      on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.15, -0.04, 0.06, WHITE);
      on(f, 'plaster', g.s0 - 0.2, g.s1 + 0.2, g.y0 - 0.09, g.y0, -0.17, 0.08, WHITE);
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
  const sideBays = classicalEnds(b).length, middle = b.bays >> 1, order = N > 1 ? y1 + 0.27 : PLINTH;
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
  // (The back's windows stand behind the front's, and the ends' are placed as the plan expects them.)
  const ends = classicalEnds(b), fronts = classicalFront(b).windows;
  wall(right, sideBays, 1, { plain: true, centres: ends });
  // (Where a wing stands against the back wall there are no windows in it, but a door into the wing on every storey.)
  const behind = (u: number) => (b.wings ?? []).some((g) => g.side * u > W / 2 - g.width - 0.3);
  const backs = fronts.filter((u) => !behind(u)), into = b.plan!.doors.filter((q) => q.through).map((q) => W / 2 - q.c);
  wall(back, backs.length, 2, { plain: true, centres: backs.map((u) => W / 2 - u).sort((p, q) => p - q), back: b.backDoor === undefined ? undefined : W / 2 - b.backDoor, through: into });
  wall(left, sideBays, 3, { plain: true, centres: ends.map((v) => D - v).sort((p, q) => p - q) });
  // Strips at the corners, the height of the upper storeys.
  // The wings: three walls each, laid out as the main block's are; the main block's end wall runs straight on into the wing's outer wall.
  const wingFaces = (b.wings ?? []).map((g) => {
    const s = g.side, L = g.length, { along, across } = wingWindows(b, g);
    const outer: Face = { L, P: (a, y, t) => at(s * (W / 2 - t), y, s > 0 ? D + a : D + L - a) };
    const inner: Face = { L, P: (a, y, t) => at(s * (W / 2 - g.width + t), y, s > 0 ? D + L - a : D + a) };
    const end: Face = { L: g.width, P: (a, y, t) => at(s * (W / 2 - a), y, D + L - t) };
    wall(outer, along.length, s > 0 ? 1 : 3, { plain: true, centres: along.map((v) => (s > 0 ? v - D : D + L - v)).sort((p, q) => p - q) });
    wall(inner, along.length, s > 0 ? 3 : 1, { plain: true, centres: along.map((v) => (s > 0 ? D + L - v : v - D)).sort((p, q) => p - q) });
    wall(end, across.length, 2, { plain: true, centres: across.map((u) => W / 2 - s * u).sort((p, q) => p - q) });
    return [outer, inner, end];
  });
  for (const f of [front, right, back, left, ...wingFaces.flat()]) for (const s of [0.3, f.L - 0.3]) on(f, 'plaster', s - 0.3, s + 0.3, order, top, -0.05, 0.03, WHITE);

  // The cornice, all round: a frieze, three mouldings each standing further out than the one under it, and blocks along the front.
  const round = (y0: number, y3: number, reach: number, colour: Colour) => {
    for (const f of [front, right, back, left]) on(f, 'plaster', -reach, f.L + reach, y0, y3, -reach, 0.5, colour);
    if (b.portico) box('plaster', centreLeft - reach, centreRight + reach, y0, y3, -out - reach, 0, colour);
  };
  // (And round the wings, which are finished as the main block is.)
  const roundWings = (y0: number, y3: number, reach: number) => { for (const f of wingFaces.flat()) on(f, 'plaster', -reach, f.L + reach, y0, y3, -reach, 0.5, WHITE); };
  roundWings(top, top + 0.42, 0.04); roundWings(top + 0.42, top + 0.52, 0.14); roundWings(top + 0.52, top + 0.62, 0.26); roundWings(top + 0.62, top + 0.78, 0.4);
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
  for (const g of b.wings ?? []) {
    const ua = g.side > 0 ? W / 2 - g.width : -W / 2, ub = g.side > 0 ? W / 2 : -W / 2 + g.width;
    box('plaster', ua, ub, attic, attic + 0.5, D - 0.02, D + g.length, wash);
    box('plaster', ua - 0.05, ub + 0.05, attic + 0.5, attic + 0.58, D, D + g.length + 0.05, WHITE);
    // Its roof: hipped at its far end, and at its near end running in under the main block's, where it is lower.
    const y = attic + 0.58, e = 0.06, slope = Math.tan((21 * Math.PI) / 180), half = g.width / 2 + e, rise = half * slope, mid = (ua + ub) / 2;
    const near = D - rise / slope, far = D + g.length + e, up = new Vector3(0, 1, 0), dirOf = (du: number, dv: number) => at(du, 0, dv).sub(at(0, 0, 0)).add(up);
    const p = (u: number, yy: number, v: number) => at(u, yy, v);
    poly('metal', [p(ua - e, y, near), p(ua - e, y, far), p(mid, y + rise, far - half), p(mid, y + rise, near)], roofTone, dirOf(-1, 0));
    poly('metal', [p(ub + e, y, near), p(ub + e, y, far), p(mid, y + rise, far - half), p(mid, y + rise, near)], roofTone, dirOf(1, 0));
    poly('metal', [p(ua - e, y, far), p(ub + e, y, far), p(mid, y + rise, far - half)], roofTone, dirOf(0, 1));
    poly('metal', [p(ua - e, y, near), p(ub + e, y, near), p(mid, y + rise, near)], roofTone, dirOf(0, -1));
    poly('metal', [p(ua - e, y, near), p(ub + e, y, near), p(ub + e, y, far), p(ua - e, y, far)], shade(roofTone, 0.6), new Vector3(0, -1, 0));
    for (let v = D + 0.3; v < far - 0.2; v += 0.68) {
      const reach = Math.min(half, far - v);
      for (const side of [-1, 1]) stick(p(side < 0 ? ua - e : ub + e, y + 0.02, v), p(side < 0 ? ua - e + reach : ub + e - reach, y + reach * slope + 0.02, v), 0.035, 0.05, shade(roofTone, 0.85), 'metal');
    }
  }
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
  // The rooms are as the site document plans them; this builds them. Each is its clear floor, and
  // its walls are linings standing out from it into the wall about it: half of a wall shared with
  // the next room, and of an outer wall all of it within the rendered skin. Two linings back to
  // back are a wall; a door or window is the same hole cut in each.
  const plan = b.plan!, sw = plan.walls, stair = classicalStair(b);
  type Rect = { u0: number; u1: number; v0: number; v1: number };
  const frontOf = (u: number) => (b.portico && u > centreLeft && u < centreRight ? -out : 0);
  // How deep the lining on each side of a room is, and where the middle of that wall is.
  // (How deep the lining on each side of a room is, the plan says; and where it reaches to, which is where a skin with openings in it may be.)
  const lining = (r: (typeof plan.rooms)[number], side: number): { thick: number; far: number; face: number; dir: number } => {
    const face = [r.v0, r.v1, r.u0, r.u1][side], dir = side % 2 === 0 ? -1 : 1, thick = r.linings[side];
    return { thick, far: face + dir * thick, face, dir };
  };
  void frontOf; void sw;
  const stone2: Colour = [0.8, 0.77, 0.7], rail: Colour = [0.16, 0.1, 0.07];
  const stairAt = (a: number, e: number, y: number) => { const p = stair.place(a, e); return at(p.u, y, p.v); };
  stair.flights.forEach((f, storey) => {
    const { START, TREAD, LANDING, across, strip } = stair, fy = floorY(storey), mid = fy + f.first * f.rise, second = f.steps - f.first, end = f.turn - second * TREAD, upper = floorY(storey + 1);
    const piece = (a0: number, a1: number, e0: number, e1: number, lo: number, hi: number, colour: Colour, material = 'stone') => block(material, stairAt(a0, e0, lo), stairAt(a1, e1, hi), colour);
    for (let i = 1; i <= f.first; i++) piece(START + (i - 1) * TREAD, START + i * TREAD + 0.01, 0, strip, fy + i * f.rise - 0.22, fy + i * f.rise, stone2);
    piece(f.turn, f.turn + LANDING, 0, across, mid - 0.22, mid, stone2);
    for (let j = 1; j <= second; j++) piece(f.turn - j * TREAD - 0.01, f.turn - (j - 1) * TREAD, across - strip, across, mid + j * f.rise - 0.22, mid + j * f.rise, stone2);
    // What carries the landing, and the rails: one up each flight, on posts.
    for (const e of [0.06, across - 0.18]) piece(f.turn + LANDING - 0.2, f.turn + LANDING - 0.08, e, e + 0.12, fy, mid - 0.22, stone2);
    const post = (a: number, e: number, y: number) => piece(a - 0.04, a + 0.04, e - 0.04, e + 0.04, y, y + 1.0, rail, 'wood');
    for (const e of stair.broad ? [0.05, strip + 0.02] : [strip + 0.02]) {
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
    if (stair.broad) level(START + 0.06, -0.05, f.turn + LANDING + 0.05, -0.05);
    if (stair.broad) level(f.turn + LANDING + 0.05, -0.05, f.turn + LANDING + 0.05, across);
    if (storey === N - 2) level(START - 0.05, 0, START - 0.05, strip + 0.1);
    // (Where the second flight comes up a step short of the floor's edge, a strip of floor to step onto.)
    if (end > START + 0.01) piece(START, end, across - strip, across, upper - 0.3, upper, stone2);
  });
  // The well in the floor of a storey, for the flights that come up to it.
  const wellOf = (storey: number): Rect | null => {
    const f = stair.flights[storey - 1];
    if (!f) return null;
    const p = stair.place(stair.START, 0), q = stair.place(f.turn + stair.LANDING, stair.across);
    return { u0: Math.min(p.u, q.u), u1: Math.max(p.u, q.u), v0: Math.min(p.v, q.v), v1: Math.max(p.v, q.v) };
  };
  const without = (r: Rect, hole: Rect | null): Rect[] => {
    if (!hole || hole.u1 <= r.u0 || hole.u0 >= r.u1 || hole.v1 <= r.v0 || hole.v0 >= r.v1) return [r];
    const parts: Rect[] = [{ u0: r.u0, u1: r.u1, v0: r.v0, v1: Math.max(r.v0, hole.v0) }, { u0: r.u0, u1: r.u1, v0: Math.min(r.v1, hole.v1), v1: r.v1 }];
    parts.push({ u0: r.u0, u1: Math.max(r.u0, hole.u0), v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) }, { u0: Math.min(r.u1, hole.u1), u1: r.u1, v0: Math.max(r.v0, hole.v0), v1: Math.min(r.v1, hole.v1) });
    return parts.filter((q) => q.u1 - q.u0 > 0.02 && q.v1 - q.v0 > 0.02);
  };

  const paints: Colour[] = [[0.62, 0.72, 0.6], [0.58, 0.66, 0.74], [0.82, 0.7, 0.45], [0.8, 0.6, 0.56], [0.5, 0.2, 0.17], [0.86, 0.83, 0.74], [0.66, 0.62, 0.7], [0.45, 0.56, 0.5]];
  const boards: Colour = [0.42, 0.29, 0.17], sill: Colour = [0.9, 0.88, 0.83];
  // Under the ground floor, and over the top one.
  box('stone', -W / 2 + 0.2, W / 2 - 0.2, 0.1, PLINTH - 0.04, (b.portico ? -out : 0) + 0.2, D - 0.2, shade(stone, 0.6));
  box('plaster', -W / 2 + 0.2, W / 2 - 0.2, top - 0.3, top, (b.portico ? -out : 0) + 0.2, D - 0.2, WHITE);
  for (let storey = 0; storey < N; storey++) {
    const fy = floorY(storey), h = b.heights[storey], clear = fy + h - 0.3, doorTop = fy + Math.min(storey === 1 ? 2.7 : 2.35, h - 0.75);
    plan.rooms.forEach((room, index) => {
      const lived = room.kind === 'front' || room.kind === 'back', colour: Colour = lived ? rng.pick(paints) : [0.84, 0.81, 0.72];
      const thick = [0, 1, 2, 3].map((side) => lining(room, side));
      // The floor reaches to the middle of each wall about it: boards, or in the halls squares of two stones; and under it the ceiling of the room below.
      const whole: Rect = { u0: room.u0 - thick[2].thick, u1: room.u1 + thick[3].thick, v0: room.v0 - thick[0].thick, v1: room.v1 + thick[1].thick };
      for (const part of without(whole, wellOf(storey))) {
        if (storey > 0) box('plaster', part.u0, part.u1, fy - 0.3, fy - 0.04, part.v0, part.v1, WHITE);
        if (lived) box('wood', part.u0, part.u1, fy - 0.04, fy, part.v0, part.v1, boards, true);
        else for (let u = part.u0, i = 0; u < part.u1 - 0.01; u += 0.62, i++) for (let v = part.v0, j = 0; v < part.v1 - 0.01; v += 0.62, j++) {
          box('stone', u, Math.min(part.u1, u + 0.62), fy - 0.04, fy, v, Math.min(part.v1, v + 0.62), (i + j) % 2 ? [0.78, 0.75, 0.68] : [0.36, 0.35, 0.34]);
        }
      }
      // The four linings, cut for doors and windows, each with a skirting, a rail and a cornice; a frame to each door and a sill to each window.
      // (Each runs on past the room's corners by the depth of the linings it meets, so that no corner is left open.)
      const faces: { f: Face; lo: number; L: number; outer: number; line: 'u' | 'v' }[] = [
        { f: { L: 0, P: (s, y, t) => at(room.u0 + s, y, room.v0 - t) }, lo: room.u0, L: room.u1 - room.u0, outer: 0, line: 'v' },
        { f: { L: 0, P: (s, y, t) => at(room.u0 + s, y, room.v1 + t) }, lo: room.u0, L: room.u1 - room.u0, outer: 2, line: 'v' },
        { f: { L: 0, P: (s, y, t) => at(room.u0 - t, y, room.v0 + s) }, lo: room.v0, L: room.v1 - room.v0, outer: 3, line: 'u' },
        { f: { L: 0, P: (s, y, t) => at(room.u1 + t, y, room.v0 + s) }, lo: room.v0, L: room.v1 - room.v0, outer: 1, line: 'u' },
      ];
      faces.forEach((side, n) => {
        const f = side.f, { thick: deep, far, face, dir } = thick[n], axis = n < 2 ? 'v' : 'u', gaps: Gap[] = [], ways: Gap[] = [];
        const s0 = -(n < 2 ? thick[2].thick : thick[0].thick), s1 = side.L + (n < 2 ? thick[3].thick : thick[1].thick);
        // Openings in a skin that this lining reaches: windows, outer doors, and doors through into a wing.
        for (const hole of holes) if (hole.axis === axis && far > hole.lo - 0.06 && far < hole.hi + 0.06 && hole.storey === storey && hole.c > side.lo - 0.01 && hole.c < side.lo + side.L + 0.01) gaps.push({ s0: hole.c - hole.half - side.lo, s1: hole.c + hole.half - side.lo, y0: hole.y0, y1: hole.y1 });
        // Doors between rooms in this wall: whose middle line lies within the wall, out from this room's floor. (Those through a skin are cut with it, above.)
        for (const door of plan.doors) if (!door.through && door.line === side.line && (door.at - face) * dir > 0 && (door.at - face) * dir < deep + 0.6 && door.c > side.lo && door.c < side.lo + side.L) ways.push({ s0: door.c - door.w / 2 - side.lo, s1: door.c + door.w / 2 - side.lo, y0: fy - 0.05, y1: door.tall ? Math.min(clear - 0.35, fy + 3.0) : doorTop });
        const open = [...gaps, ...ways];
        pierced(f, 'plaster', s0, s1, fy, clear, 0, deep, colour, open);
        pierced(f, 'plaster', s0, s1, fy, fy + 0.16, -0.02, 0, WHITE, open);
        pierced(f, 'plaster', s0, s1, fy + 0.9, fy + 0.96, -0.025, 0, WHITE, open);
        on(f, 'plaster', s0, s1, clear - 0.14, clear, -0.1, 0, WHITE);
        for (const g of ways) {
          for (const [a, e] of [[g.s0 - 0.12, g.s0], [g.s1, g.s1 + 0.12]]) on(f, 'plaster', a, e, fy, g.y1 + 0.12, -0.035, 0, WHITE);
          on(f, 'plaster', g.s0, g.s1, g.y1, g.y1 + 0.12, -0.035, 0, WHITE);
        }
        // A window's sill inside is a board the whole depth of the lining, standing out a little into the room.
        for (const g of gaps) if (g.y0 > fy + 0.3) on(f, 'wood', g.s0 - 0.06, g.s1 + 0.06, g.y0 - 0.04, g.y0 + 0.02, -0.06, deep, sill, true);
      });
      // A stove of glazed tiles in the corner of each front room, away from the windows: a foot, a tall body, a cornice, and its small iron door.
      if (room.kind === 'front') {
        const near = Math.abs(room.u0) < Math.abs(room.u1) ? room.u0 + 0.06 : room.u1 - 0.06 - 0.58, v = room.v1 - 0.06 - 0.8, tiles: Colour = index % 3 ? [0.88, 0.88, 0.84] : [0.3, 0.42, 0.34];
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
          box('wood', room.u0 + 0.6, room.u0 + 2.2, fy + 0.44, fy + 0.49, room.v1 - 0.45, room.v1 - 0.05, oak, true);
          for (const du of [0.66, 2.08]) box('wood', room.u0 + du, room.u0 + du + 0.06, fy, fy + 0.44, room.v1 - 0.4, room.v1 - 0.1, oak, true);
        }
      }
    });
  }
}

/** Plain solids for other builders to use: a block between two corners, a squared length between two points, a sheet of roof. */
export function solids(mesh: (material: string) => MeshBuilder) {
  const t = buildingTools({ x: 0, z: 0, w: 0, d: 0, faces: 'w' } as Building, 0, mesh);
  return { block: t.block, stick: t.stick, slope: t.slope };
}

/** Builds one building where the site document says it stands, on ground at the height `base`. `stone` is the tint of the country's stone. */
export function buildBuilding(b: Building, base: number, mesh: (material: string) => MeshBuilder, rng: Rng, stone: Colour, first: boolean): void {
  // (Brick buildings are shut, and seen only from outside: nothing in them is indoors.)
  if (b.style === 'brick') { buildBrick(b, base, mesh, rng, stone); return; }
  // (What is built from here on is noted, mesh by mesh, so that it can be told afterwards which of it is indoors.)
  const begun = new Map<MeshBuilder, number>();
  const noting = (material: string) => { const m = mesh(material); if (!begun.has(m)) begun.set(m, m.vertexCount); return m; };
  if (b.style === 'timber') {
    timberHouse(b, base, noting, rng, stone, first);
    // Indoors is whatever is within the walls of the storey it is on: each storey stands further out over the street than the one below.
    const turn = b.faces === 'w' ? 1 : -1, top = timberFloor(b, b.storeys);
    for (const [m, from] of begun) m.setOpenBy((x, y, z) => {
      const u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2, h = y - base;
      let storey = 0;
      while (storey < b.storeys - 1 && h > timberFloor(b, storey + 1) - 0.14) storey++;
      return Math.abs(u) < b.w / 2 - 0.24 && v > timberFront(b, storey) + 0.24 && v < b.d - 0.24 && h > 0.4 && h < top + 0.05 ? 0.32 : 1;
    }, from);
    return;
  }
  imperialHouse(b, base, noting, rng, stone);
  // Indoors, only a share of the sky is seen, through the windows: so a room is dimmer than the street, and the sun lies on its floor where it comes in.
  const turn = b.faces === 'w' ? 1 : -1, height = 0.5 + b.heights.reduce((sum, h) => sum + h, 0), rects = footprintOf(b).map((r, i) => (i ? { ...r, v0: r.v0 - 0.5 } : r));
  for (const [m, from] of begun) m.setOpenBy((x, y, z) => {
    const u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
    return rects.some((r) => u > r.u0 + 0.24 && u < r.u1 - 0.24 && v > r.v0 + 0.24 && v < r.v1 - 0.24) && y > base + 0.3 && y < base + height - 0.02 ? 0.32 : 1;
  }, from);
}
