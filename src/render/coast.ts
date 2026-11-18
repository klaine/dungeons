import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { onStair } from '../core/island';
import { Site } from '../core/site';
import { Kit } from './geom/kit';
import { MeshBuilder } from './geom/meshBuilder';
import { buildLandmark } from './landmarks';
import { buildBuilding } from './buildings';
import { CLASSICAL } from '../core/building';
import { Colour } from './planting';

/**
 * What people have built on the island, other than the house: the jetty where the boats come
 * in, the fishermen's cottages above the beach, their boats, the lighthouse on its headland, the
 * castle on another, and what was left in the sea cave. Like the buildings of the valley, every
 * part is a closed solid of its own; unlike them, these stand at any angle, so they are made of
 * solids with eight corners given in the world, not of blocks square to it.
 */

export interface CoastBuild {
  site: Site;
  wild: Kit;
  rng: Rng;
  ground: (x: number, z: number) => number;
  stoneTint: Colour;
  finds: { at: Vector3; what: string }[];
  fences: { min: Vector3; max: Vector3 }[];
  caveFloor: number;
}

type P3 = [number, number, number];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];

/** Solids at any angle: a face through points, wound away from a point inside; and a solid of eight corners, bottom four then top four, going round the same way. */
export function anyAngle(mesh: (material: string) => MeshBuilder) {
  let count = 0;
  const face = (material: string, pts: P3[], colour: Colour, inside: P3, scale = 0.5) => {
    const m = mesh(material);
    const [a, b, c] = pts;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const mid = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
    let list = pts;
    if ((mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; list = [...pts].reverse(); }
    // Texture laid from where the point is, on whichever plane the face lies most nearly in.
    const flat = Math.abs(ny) > 0.7, side = Math.abs(nx) > Math.abs(nz);
    const ids = list.map((q) => m.addVertex(q[0], q[1], q[2], nx, ny, nz, (flat ? q[0] : side ? q[2] : q[0]) * scale, (flat ? q[2] : q[1]) * scale, colour[0], colour[1], colour[2]));
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
  };
  const solid = (material: string, c: P3[], colour: Colour, scale = 0.5) => {
    const tone = shade(colour, 0.95 + 0.1 * (((count++ * 7919) % 13) / 13));
    const inside: P3 = [0, 0, 0];
    for (const q of c) { inside[0] += q[0] / 8; inside[1] += q[1] / 8; inside[2] += q[2] / 8; }
    for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) face(material, f.map((i) => c[i]), tone, inside, scale);
  };
  return { face, solid };
}

/** A frame turned to face a bearing: `a` along to the right as one faces it, `f` forward, `y` up, about an origin. */
function frame(x: number, z: number, y: number, facing: number) {
  const fx = Math.cos(facing), fz = Math.sin(facing);
  return (a: number, h: number, f: number): P3 => [x + fx * f - fz * a, y + h, z + fz * f + fx * a];
}

export function buildCoast(c: CoastBuild): { deck: number; lamp?: { x: number; y: number; z: number } } {
  const { site, wild, rng } = c, o = site.island!, sea = o.sea;
  const mesh = (m: string) => wild.mesh(m);
  // (What is built here is noted, mesh by mesh, so that what is indoors can be told afterwards and lit as indoors.)
  const MATERIALS = ['plaster', 'stone', 'wood', 'glass', 'metal', 'lamp', 'thatch', 'slate'];
  const begun = new Map(MATERIALS.map((m) => [m, mesh(m).vertexCount]));
  const indoors: ((x: number, y: number, z: number) => number)[] = [];
  const { face, solid } = anyAngle(mesh);
  const stone: Colour = [0.78 * c.stoneTint[0], 0.75 * c.stoneTint[1], 0.7 * c.stoneTint[2]];
  // How far a point lies from the track or any footpath: what stands about a house is kept off them, or the way would be blocked.
  const ways = [site.track ?? [], ...(site.paths ?? []).map((w) => w.points)];
  const offWay = (x: number, z: number) => {
    let best = Infinity;
    for (const line of ways) for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
  /** A block in a frame: from `a0` to `a1` across, `h0` to `h1` up, `f0` to `f1` forward. */
  const box = (at: ReturnType<typeof frame>, material: string, a0: number, a1: number, h0: number, h1: number, f0: number, f1: number, colour: Colour, scale = 0.5) =>
    solid(material, [at(a0, h0, f0), at(a1, h0, f0), at(a1, h0, f1), at(a0, h0, f1), at(a0, h1, f0), at(a1, h1, f0), at(a1, h1, f1), at(a0, h1, f1)], colour, scale);

  // ---- the jetty: a pier of big stones from the beach out into the cove, its deck a little above high water
  const deck = sea + 1.35;
  {
    const [ax, az] = o.jetty.from, [bx, bz] = o.jetty.to, len = Math.hypot(bx - ax, bz - az), heading = Math.atan2(bz - az, bx - ax);
    const at = frame(ax, az, 0, heading), half = o.jetty.width / 2, q = rng.fork('jetty');
    // (Where it starts on the beach, its deck comes down to the sand as a ramp.)
    // (Where it stands from the foot of a cliff it is level from end to end; from a beach it comes down to the sand.)
    const rootY = o.landing === 'stair' ? deck : Math.min(deck, c.ground(ax, az) + 0.04);
    for (let f = 0; f < len - 1e-6;) {
      const f1 = Math.min(len, f + q.range(1.1, 1.6)), y0 = rootY + (deck - rootY) * Math.min(1, f / 4), y1 = rootY + (deck - rootY) * Math.min(1, f1 / 4);
      const foot = Math.min(c.ground(...at2(at, 0, f)), c.ground(...at2(at, 0, f1))) - 0.6;
      // Each length is a course of big blocks, two or three across, each set a little proud or sunk of its neighbours and each its
      // own shade; below where the tide comes they are dark with weed. (One block the width of the pier read as a slab of concrete.)
      const across = q.chance(0.5) ? 2 : 3, gap = 0.035, weed = Math.min(y0, sea + 0.55);
      for (let k = 0; k < across; k++) {
        const a0 = -half + (k / across) * 2 * half + (k ? gap : 0), a1 = -half + ((k + 1) / across) * 2 * half - (k < across - 1 ? gap : 0);
        // (Weathered: darker than new-cut stone, greyed and greened by the salt air, the odd block stained with rust or lichen.)
        const lift = q.range(-0.025, 0.02), tone = q.range(0.56, 0.82), t0 = y0 + lift, t1 = y1 + lift;
        if (weed > foot) solid('stone', [at(a0, foot, f), at(a1, foot, f), at(a1, foot, f1 - gap), at(a0, foot, f1 - gap), at(a0, weed, f), at(a1, weed, f), at(a1, weed, f1 - gap), at(a0, weed, f1 - gap)], [0.16 * tone, 0.17 * tone, 0.11 * tone], 0.35);
        const b0 = Math.max(foot, weed);
        const weathered = shade(stone, tone), stain = q.next();
        if (stain < 0.15) { weathered[0] *= 1.12; weathered[1] *= 0.98; weathered[2] *= 0.82; } else if (stain < 0.35) { weathered[0] *= 0.92; weathered[1] *= 1.02; weathered[2] *= 0.9; }
        solid('stone', [at(a0, b0, f), at(a1, b0, f), at(a1, b0, f1 - gap), at(a0, b0, f1 - gap), at(a0, t0, f), at(a1, t0, f), at(a1, t1, f1 - gap), at(a0, t1, f1 - gap)], weathered, 0.35);
      }
      f = f1;
    }
    // Coping along either edge, bollards, and a ladder of iron down the end into the water.
    for (const side of [-1, 1]) for (let f = 4.5; f < len - 0.3; f += 0.9) box(at, 'stone', side > 0 ? half - 0.42 : -half, side > 0 ? half : -half + 0.42, deck, deck + 0.14, f, Math.min(len, f + 0.9), shade(stone, 1.08), 0.4);
    for (const f of [len * 0.55, len - 0.9]) for (const side of [-1, 1]) {
      const a = side * (half - 0.7);
      for (let k = 0; k < 6; k++) {
        const t0 = (k / 6) * Math.PI * 2, t1 = ((k + 1) / 6) * Math.PI * 2, r = 0.16;
        solid('metal', [at(a, deck, f), at(a + Math.cos(t0) * r, deck, f + Math.sin(t0) * r), at(a + Math.cos(t1) * r, deck, f + Math.sin(t1) * r), at(a, deck, f), at(a, deck + 0.55, f), at(a + Math.cos(t0) * r, deck + 0.55, f + Math.sin(t0) * r), at(a + Math.cos(t1) * r, deck + 0.55, f + Math.sin(t1) * r), at(a, deck + 0.55, f)], [0.05, 0.05, 0.05]);
      }
    }
    for (const a of [-0.22, 0.22]) box(at, 'metal', a - 0.025, a + 0.025, sea - 1.2, deck + 0.9, len + 0.02, len + 0.07, [0.12, 0.07, 0.04]);
    for (let y = sea - 1; y < deck + 0.8; y += 0.3) box(at, 'metal', -0.22, 0.22, y, y + 0.03, len + 0.03, len + 0.06, [0.12, 0.07, 0.04]);
    // Nobody steps off the jetty into the water: the boxes nobody sees, along both sides beyond the beach and across the end.
    // (Nor across the strand of shingle that leaves the quay for the sea cave.)
    const onStrand = (x: number, z: number) => {
      if (!o.seaCave || o.landing !== 'stair') return false;
      const [sx, sz] = o.jetty.from, dx = o.seaCave.x - sx, dz = o.seaCave.z - sz, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - sx) * dx + (z - sz) * dz) / l2));
      return Math.hypot(x - sx - dx * t, z - sz - dz * t) < 2.4;
    };
    const fence = (a: number, f: number) => { const p = at(a, 0, f); if (onStair(o, p[0], p[2]).off < 1.7 || onStrand(p[0], p[2])) return; c.fences.push({ min: new Vector3(p[0] - 0.3, sea - 6, p[2] - 0.3), max: new Vector3(p[0] + 0.3, deck + 4, p[2] + 0.3) }); };
    // (From a beach the first strides are over sand; from the foot of a cliff the water is deep from the first.)
    for (let f = o.landing === 'stair' ? 0.2 : 5; f <= len + 0.4; f += 0.45) for (const side of [-1, 1]) fence(side * (half + 0.32), f);
    for (let a = -half; a <= half; a += 0.45) fence(a, len + 0.35);
  }

  // ---- the stair cut in the cliff: a step of dressed stone at every half stride, set into the slope it is cut in.
  // They are for the eye, as the valley's are: what is walked on is the slope, so no foot catches on a riser.
  if (o.stair) {
    const was = wild.group, q = rng.fork('stair'), st = o.stair;
    wild.group = 'soft';
    for (let k = 0; k < st.length - 1; k++) {
      const [ax, az, ay] = st[k], [bx, bz, by] = st[k + 1], run = Math.hypot(bx - ax, bz - az);
      if (run < 0.05) continue;
      const heading = Math.atan2(bz - az, bx - ax), at = frame(ax, az, 0, heading), n = Math.max(1, Math.round(run / 0.5));
      for (let j = 0; j < n; j++) {
        const f0 = (run * j) / n, f1 = (run * (j + 1)) / n, top = ay + (by - ay) * ((j + 1) / n);
        // (Level stretches, the landings, are paved, not stepped.)
        const flat = Math.abs(by - ay) < 0.05;
        box(at, 'stone', -1.35, 1.35, top - (flat ? 0.12 : 0.3), top + 0.02, f0, f1 + 0.03, shade(stone, q.range(0.78, 1.0)), 0.6);
      }
    }
    wild.group = was;
  }

  // ---- the fishermen's cottages
  o.cottages.forEach((h, n) => buildCottage(h, rng.fork(`cottage${n}`)));
  function buildCottage(h: (typeof o.cottages)[number], q: Rng) {
    // Facing the front: `a` along the front, `f` out of it; the house lies behind the front, from f = -d to 0.
    const at = frame(h.x + Math.cos(h.faces) * h.d / 2, h.z + Math.sin(h.faces) * h.d / 2, h.y, h.faces);
    const W = h.w / 2, D = h.d, eaves = q.range(2.3, 2.8), ridge = eaves + D * q.range(0.55, 0.72), wash = h.wash, t = 0.6;
    const base = -0.5;
    // The walls: whitewashed rubble two feet thick, a plinth tarred dark at the foot, and a gable at
    // each end. The door stands open and the cottage can be gone into: one room, with a flagged
    // floor, the hearth under the chimney at one gable, and a table, a bench, a box bed and a chest.
    const doorAt = q.range(-W * 0.25, W * 0.25), doorCol: Colour = q.pick([[0.12, 0.22, 0.32], [0.32, 0.1, 0.08], [0.12, 0.25, 0.14], [0.22, 0.2, 0.16]] as Colour[]);
    {
      const x0 = h.x + Math.cos(h.faces) * h.d / 2, z0 = h.z + Math.sin(h.faces) * h.d / 2, fx = Math.cos(h.faces), fz = Math.sin(h.faces);
      indoors.push((x, y, z) => {
        const f = (x - x0) * fx + (z - z0) * fz, a = -(x - x0) * fz + (z - z0) * fx;
        return Math.abs(a) < W - t + 0.06 && f > -D + t - 0.06 && f < -t + 0.06 && y > h.y - 0.5 && y < h.y + eaves - 0.01 ? 0.28 : 1;
      });
    }
    const doorTop = 1.95, frontHoles: { a0: number; a1: number; y0: number; y1: number }[] = [{ a0: doorAt - 0.48, a1: doorAt + 0.48, y0: -1, y1: doorTop }];
    const windowsAt: number[] = [];
    for (const side of [-1, 1]) {
      const wa = doorAt + side * q.range(1.4, Math.max(1.5, W - 0.9));
      if (Math.abs(wa) > W - 0.9) continue;
      windowsAt.push(wa);
      frontHoles.push({ a0: wa - 0.4, a1: wa + 0.4, y0: 0.9, y1: 1.8 });
    }
    const backWindow = q.range(-W * 0.4, W * 0.4);
    /** A length of wall from `a0` to `a1`, `f0` to `f1` deep, with holes cut in it: built as what is left, piers and the pieces over and under each hole. */
    const pierced = (a0: number, a1: number, f0: number, f1: number, y0: number, y1: number, holes: { a0: number; a1: number; y0: number; y1: number }[]) => {
      const cuts = [a0, a1, ...holes.flatMap((hh) => [hh.a0, hh.a1])].filter((v) => v >= a0 && v <= a1).sort((m, n) => m - n);
      for (let k = 0; k < cuts.length - 1; k++) {
        const u0 = cuts[k], u1 = cuts[k + 1];
        if (u1 - u0 < 1e-3) continue;
        const hole = holes.find((hh) => hh.a0 <= u0 + 1e-6 && hh.a1 >= u1 - 1e-6);
        if (!hole) { box(at, 'plaster', u0, u1, y0, y1, f0, f1, wash); continue; }
        if (hole.y0 > y0) box(at, 'plaster', u0, u1, y0, hole.y0, f0, f1, wash);
        if (hole.y1 < y1) box(at, 'plaster', u0, u1, hole.y1, y1, f0, f1, wash);
      }
    };
    pierced(-W, W, -t, 0, base, eaves, frontHoles);
    pierced(-W, W, -D, -D + t, base, eaves, [{ a0: backWindow - 0.3, a1: backWindow + 0.3, y0: 1.0, y1: 1.6 }]);
    for (const side of [-1, 1]) box(at, 'plaster', side > 0 ? W - t : -W, side > 0 ? W : -W + t, base, eaves, -D + t, -t, wash);
    // (Each gable a closed wedge of wall, the thickness of the wall, up to the ridge.)
    for (const side of [-1, 1]) solid('plaster', [at(side * W, eaves, -D), at(side * W, eaves, 0), at(side * (W - t), eaves, 0), at(side * (W - t), eaves, -D), at(side * W, ridge - 0.2, -D / 2), at(side * W, ridge - 0.2, -D / 2), at(side * (W - t), ridge - 0.2, -D / 2), at(side * (W - t), ridge - 0.2, -D / 2)], wash);
    // The tarred plinth, outside only, broken at the door.
    pierced(-W - 0.03, W + 0.03, 0, 0.03, base, 0.32, [{ a0: doorAt - 0.48, a1: doorAt + 0.48, y0: -1, y1: 1 }]);
    box(at, 'plaster', -W - 0.03, W + 0.03, base, 0.32, -D - 0.03, -D, [0.09, 0.09, 0.09]);
    for (const side of [-1, 1]) box(at, 'plaster', side > 0 ? W : -W - 0.03, side > 0 ? W + 0.03 : -W, base, 0.32, -D, 0, [0.09, 0.09, 0.09]);
    // The floor, of flags, a step up from the ground; and a stone at the door.
    box(at, 'stone', -W + t, W - t, -0.4, 0.12, -D + t, -t, shade(stone, 0.8), 0.6);
    box(at, 'stone', doorAt - 0.48, doorAt + 0.48, -0.4, 0.12, -t, 0, shade(stone, 0.9));
    box(at, 'stone', doorAt - 0.6, doorAt + 0.6, -0.4, 0.06, 0, 0.42, shade(stone, 0.95));
    // A lintel of timber over the door, and the door itself standing open into the room against the wall.
    // (It stands proud of the wall on both faces, a few centimetres, so that no face of it lies in the plane of the plaster and flickers.)
    box(at, 'wood', doorAt - 0.62, doorAt + 0.62, doorTop, doorTop + 0.16, -t - 0.04, 0.05, [0.22, 0.17, 0.12], 0.9);
    box(at, 'wood', doorAt - 0.48, doorAt - 0.43, 0.14, doorTop - 0.04, -t - 0.9, -t, doorCol, 0.9);
    // The windows: dark glass in the middle of the wall's thickness, white frames, and a deep sill inside.
    for (const wa of windowsAt) {
      box(at, 'glass', wa - 0.4, wa + 0.4, 0.9, 1.8, -t / 2 - 0.02, -t / 2 + 0.02, [0.03, 0.04, 0.05]);
      box(at, 'wood', wa - 0.03, wa + 0.03, 0.9, 1.8, -t / 2 - 0.03, -t / 2 + 0.03, [0.85, 0.85, 0.82]);
      box(at, 'wood', wa - 0.4, wa + 0.4, 1.33, 1.38, -t / 2 - 0.03, -t / 2 + 0.03, [0.85, 0.85, 0.82]);
      box(at, 'stone', wa - 0.5, wa + 0.5, 0.84, 0.93, -0.02, 0.12, shade(stone, 1.05));
    }
    box(at, 'glass', backWindow - 0.3, backWindow + 0.3, 1.0, 1.6, -D + t / 2 - 0.02, -D + t / 2 + 0.02, [0.03, 0.04, 0.05]);
    // A ceiling of boards on the tie beams, under the roof.
    box(at, 'wood', -W + t, W - t, eaves - 0.12, eaves, -D + t, -t, [0.3, 0.24, 0.17], 0.9);
    for (let a = -W + t + 0.6; a < W - t - 0.3; a += 1.1) box(at, 'wood', a - 0.08, a + 0.08, eaves - 0.3, eaves - 0.12, -D + t, -t, [0.22, 0.17, 0.12], 0.9);
    // The hearth, at the chimney's gable: a raised stone hearth, a breast of whitewash up to the ceiling, and a black crook.
    const end = q.chance(0.5) ? 1 : -1, ha = end * (W - t);
    box(at, 'stone', ha - end * 1.0, ha, 0.12, 0.34, -D / 2 - 0.85, -D / 2 + 0.85, shade(stone, 0.7));
    box(at, 'plaster', ha - end * 0.5, ha, 1.1, eaves - 0.12, -D / 2 - 0.85, -D / 2 + 0.85, wash);
    box(at, 'stone', ha - end * 0.55, ha - end * 0.45, 1.0, 1.1, -D / 2 - 0.9, -D / 2 + 0.9, shade(stone, 0.9));
    box(at, 'metal', ha - end * 0.35, ha - end * 0.3, 0.6, 1.05, -D / 2 - 0.02, -D / 2 + 0.02, [0.03, 0.03, 0.03]);
    box(at, 'lamp', ha - end * 0.45, ha - end * 0.15, 0.34, 0.42, -D / 2 - 0.25, -D / 2 + 0.25, [0.5, 0.2, 0.05]);
    // A table and a bench by the back wall, a box bed at the far end from the hearth, and a chest at its foot.
    const oak: Colour = [0.3, 0.22, 0.14];
    const tb = q.range(-0.6, 0.6) * Math.max(0, W - 2.8), tf = -D + t + 0.45;
    box(at, 'wood', tb - 0.7, tb + 0.7, 0.72, 0.78, tf, tf + 0.75, oak, 0.9);
    for (const [la, lf] of [[-0.62, 0.06], [0.58, 0.06], [-0.62, 0.65], [0.58, 0.65]]) box(at, 'wood', tb + la, tb + la + 0.06, 0.12, 0.72, tf + lf, tf + lf + 0.06, oak, 0.9);
    box(at, 'wood', tb - 0.65, tb + 0.65, 0.42, 0.47, tf + 0.95, tf + 1.25, oak, 0.9);
    for (const la of [-0.6, 0.55]) box(at, 'wood', tb + la, tb + la + 0.06, 0.12, 0.42, tf + 1.0, tf + 1.2, oak, 0.9);
    const ba = -end * (W - t);
    box(at, 'wood', ba, ba + end * 1.05, 0.12, 1.6, -D + t, -D + t + 2.0, [0.24, 0.18, 0.12], 0.9);
    box(at, 'wood', ba + end * 0.05, ba + end * 1.0, 0.5, 0.62, -D + t + 0.05, -D + t + 1.95, [0.6, 0.55, 0.45], 0.9);
    box(at, 'wood', ba + end * 0.1, ba + end * 0.75, 0.12, 0.62, -D + t + 2.15, -D + t + 2.6, [0.34, 0.2, 0.12], 0.9);
    // A lamp burning on the table, low, so the room is not black inside.
    box(at, 'lamp', tb - 0.06, tb + 0.06, 0.78, 0.98, tf + 0.3, tf + 0.42, [1, 0.8, 0.5]);
    // The roof: thatch, thick and rounded over the eaves and roped down against the wind; or slate, thin and dark.
    const over = h.roof === 'thatch' ? 0.45 : 0.25, thick = h.roof === 'thatch' ? 0.42 : 0.1;
    const roofCol: Colour = h.roof === 'thatch' ? [0.52, 0.42, 0.27] : [0.2, 0.21, 0.23];
    const material = h.roof === 'thatch' ? 'thatch' : 'slate';
    for (const side of [-1, 1]) {
      const fe = side < 0 ? -D - over : over, ye = eaves - over * (ridge - eaves) / (D / 2);
      solid(material, [at(-W - over, ye, fe), at(W + over, ye, fe), at(W + over, ridge, -D / 2), at(-W - over, ridge, -D / 2), at(-W - over, ye + thick, fe), at(W + over, ye + thick, fe), at(W + over, ridge + thick, -D / 2), at(-W - over, ridge + thick, -D / 2)], roofCol, h.roof === 'thatch' ? 0.6 : 0.9);
    }
    if (h.roof === 'thatch') {
      box(at, 'thatch', -W - over, W + over, ridge + thick - 0.1, ridge + thick + 0.22, -D / 2 - 0.35, -D / 2 + 0.35, shade(roofCol, 0.85), 0.6);
      // Ropes over the thatch, weighted with stones at the eaves.
      for (let a = -W; a <= W + 0.01; a += (2 * W) / 3) for (const side of [-1, 1]) {
        const fe = side < 0 ? -D - over : over, ye = eaves - over * (ridge - eaves) / (D / 2);
        box(at, 'stone', a - 0.2, a + 0.2, ye - 0.55, ye - 0.15, fe - 0.15 * side - 0.12, fe - 0.15 * side + 0.12, shade(stone, 0.8));
      }
    } else box(at, 'stone', -W - over, W + over, ridge + thick - 0.02, ridge + thick + 0.12, -D / 2 - 0.12, -D / 2 + 0.12, [0.25, 0.22, 0.2]);
    // The chimney, on the gable the hearth is against.
    box(at, 'plaster', end * (W - 0.75), end * (W - 0.05), ridge - 0.6, ridge + 1.0, -D / 2 - 0.4, -D / 2 + 0.4, wash);
    box(at, 'stone', end * (W - 0.85), end * (W + 0.05), ridge + 1.0, ridge + 1.12, -D / 2 - 0.5, -D / 2 + 0.5, shade(stone, 0.7));
    // Things about the door: lobster pots, a fish box, a barrel.
    const side = doorAt > 0 ? -1 : 1;
    // And now and then a net hung to dry between two poles beyond the gable: brown, sagging between them.
    if (q.chance(0.55)) {
      const a0 = -side * (W + 1.4), a1 = -side * (W + 1.4 + q.range(2.2, 3)), f = q.range(0.6, 1.8), top = q.range(1.7, 2.1), net: Colour = [0.2, 0.15, 0.09];
      // (Not across the track or a path: the poles and the net are solid, and a net hung over the way stopped anyone going by.)
      const clear = [0, 0.25, 0.5, 0.75, 1].every((t) => offWay(...at2(at, a0 + (a1 - a0) * t, f)) > 2.4);
      if (clear) {
        for (const a of [a0, a1]) box(at, 'wood', a - 0.05, a + 0.05, -0.3, top + 0.1, f - 0.05, f + 0.05, [0.3, 0.26, 0.2], 0.9);
        const S = 6;
        for (let k = 0; k < S; k++) {
          const t0 = k / S, t1 = (k + 1) / S, sag = (t: number) => Math.sin(t * Math.PI) * 0.35;
          const u0 = a0 + (a1 - a0) * t0, u1 = a0 + (a1 - a0) * t1;
          solid('wood', [at(u0, top - sag(t0) - 1.1, f), at(u1, top - sag(t1) - 1.1, f), at(u1, top - sag(t1) - 1.1, f + 0.025), at(u0, top - sag(t0) - 1.1, f + 0.025), at(u0, top - sag(t0), f), at(u1, top - sag(t1), f), at(u1, top - sag(t1), f + 0.025), at(u0, top - sag(t0), f + 0.025)], net, 2.5);
        }
      }
    }
    for (let k = 0; k < q.int(1, 4); k++) {
      const a = doorAt + side * (1.2 + k * 0.65), f = q.range(0.6, 1.4), y = 0, s = 0.28;
      if (Math.abs(a) > W + 1) break;
      if (offWay(...at2(at, a, f)) < 2) continue;
      box(at, 'wood', a - s, a + s, y, y + 0.42 + (k % 2) * 0.0, f - s * 0.8, f + s * 0.8, [0.36, 0.3, 0.22], 0.9);
    }
  }

  // ---- boats, drawn up on the beach or riding in the cove
  o.boats.forEach((bt, n) => {
    const q = rng.fork(`boat${n}`), L = bt.length / 2, B = bt.length * 0.19, depth = bt.length * 0.09;
    const y = bt.afloat ? sea - depth * 0.45 : c.ground(bt.x, bt.z) + 0.08;
    const roll = bt.afloat ? 0 : q.range(-0.18, 0.18);
    const at = frame(bt.x, bt.z, y, bt.heading);
    const tilt = (a: number, h: number, f: number): P3 => at(a * Math.cos(roll) - h * Math.sin(roll), h * Math.cos(roll) + a * Math.sin(roll), f);
    const paint: Colour = q.pick([[0.12, 0.27, 0.4], [0.5, 0.12, 0.08], [0.18, 0.35, 0.2], [0.75, 0.74, 0.7], [0.55, 0.42, 0.12]] as Colour[]);
    // The hull: stations from stern to bow, each a rounded bottom and flaring sides; the outside painted, tarred below, the inside bare wood.
    const S = 9, R = 5, sec: P3[][] = [], inner: P3[][] = [];
    for (let i = 0; i <= S; i++) {
      const f = -L + (2 * L * i) / S, t = i / S, w = B * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.6) * (t > 0.6 ? 1 - (t - 0.6) * 0.9 : 1), sheer = depth * (1 + 0.5 * (t > 0.5 ? (t - 0.5) * 2 : (0.5 - t) * 0.6));
      const ring: P3[] = [], ringIn: P3[] = [];
      for (let k = 0; k <= R; k++) {
        const u = -1 + (2 * k) / R, a = u * w, h = sheer - depth * (1 - u * u) * 1.1 * (t > 0.92 ? 0.3 : 1) - (Math.abs(u) < 1 ? 0 : 0);
        ring.push(tilt(a, h - sheer * 0.4 + depth * 0.6, f));
        ringIn.push(tilt(a * 0.88, h - sheer * 0.4 + depth * 0.6 + 0.05, f));
      }
      sec.push(ring); inner.push(ringIn);
    }
    const mid = at(0, depth * 2, 0);
    for (let i = 0; i < S; i++) for (let k = 0; k < R; k++) {
      const low = Math.abs(-1 + (2 * (k + 0.5)) / R) < 0.6;
      face('wood', [sec[i][k], sec[i][k + 1], sec[i + 1][k + 1], sec[i + 1][k]], low ? [0.05, 0.045, 0.04] : paint, mid, 0.9);
      face('wood', [inner[i][k], inner[i][k + 1], inner[i + 1][k + 1], inner[i + 1][k]], [0.42, 0.33, 0.22], at(0, -depth * 3, 0), 0.9);
    }
    // The gunwale joins inside to out along both sides, and the stern and bow are closed.
    for (let i = 0; i < S; i++) for (const k of [0, R]) face('wood', [sec[i][k], sec[i + 1][k], inner[i + 1][k], inner[i][k]], [0.85, 0.83, 0.78], at(0, -depth * 5, 0), 0.9);
    for (const i of [0, S]) for (let k = 0; k < R; k++) face('wood', [sec[i][k], sec[i][k + 1], inner[i][k + 1], inner[i][k]], paint, at(0, depth, i ? -L * 3 : L * 3), 0.9);
    // Thwarts across, and a pair of oars laid in her.
    for (const f of [-L * 0.45, 0.1, L * 0.4]) {
      const wAt = B * 0.82 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * ((f + L) / (2 * L)))), 0.6);
      solid('wood', [tilt(-wAt, depth * 0.55, f - 0.1), tilt(wAt, depth * 0.55, f - 0.1), tilt(wAt, depth * 0.55, f + 0.1), tilt(-wAt, depth * 0.55, f + 0.1), tilt(-wAt, depth * 0.62, f - 0.1), tilt(wAt, depth * 0.62, f - 0.1), tilt(wAt, depth * 0.62, f + 0.1), tilt(-wAt, depth * 0.62, f + 0.1)], [0.45, 0.36, 0.25], 0.9);
    }
  });

  // ---- the lighthouse
  const lh = o.lighthouse;
  if (lh) {
    const q = rng.fork('lighthouse'), r0 = lh.r, top = lh.height, rT = r0 * 0.8, wallT = 0.5, base = lh.y;
    const white: Colour = [0.9, 0.89, 0.86], band: Colour = q.chance(0.5) ? [0.55, 0.08, 0.06] : [0.08, 0.08, 0.08], iron: Colour = [0.06, 0.06, 0.065];
    const banded = q.chance(0.6), bands = q.int(1, 2);
    const N = 32, radiusAt = (h: number) => r0 + (rT - r0) * Math.min(1, Math.max(0, h / top));
    const ring = (a: number, r: number, h: number): P3 => [lh.x + Math.cos(a) * r, base + h, lh.z + Math.sin(a) * r];
    const doorHalf = 0.62 / ((r0 + r0 - wallT) / 2), doorTop = 2.25;
    const inDoor = (a: number) => Math.abs(((a - lh.door + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < doorHalf;
    // The wall, in courses each a little narrower than the last, cut for the door and, up the stair, for small windows.
    const course = 0.75, stepsPerTurn = 16, rise = 0.19, firstStep = lh.door + 1.25;
    const windows: { k: number; y: number }[] = [];
    for (let y = 2.55; y < top - 2.5; y += 3.0) {
      const a = firstStep + ((y - 1.3 - 0.15) / (stepsPerTurn * rise)) * Math.PI * 2;
      windows.push({ k: ((Math.round((a / (Math.PI * 2)) * N - 0.5) % N) + N) % N, y: Math.round((y + 1.2) / course) * course - 1.2 });
    }
    for (let h = -1.2; h < top - 1e-6; h += course) {
      const h1 = Math.min(top, h + course);
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
        if (h1 > 0.05 && h < doorTop - 0.01 && inDoor(am)) continue;
        // Slits of windows, one every few metres up, each where the stair passes it, a little above the step there.
        if (windows.some((w) => w.k === k && h > w.y - 0.01 && h < w.y + 1.4)) continue;
        const ro0 = radiusAt(h), ro1 = radiusAt(h1), ri0 = ro0 - wallT, ri1 = ro1 - wallT;
        const colour = banded && Array.from({ length: bands }, (_, j) => top * (0.35 + j * 0.3)).some((y) => h >= y - 0.01 && h < y + course * 2 - 0.01) ? band : white;
        solid('plaster', [ring(a0, ri0, h), ring(a1, ri0, h), ring(a1, ro0, h), ring(a0, ro0, h), ring(a0, ri1, h1), ring(a1, ri1, h1), ring(a1, ro1, h1), ring(a0, ro1, h1)], colour);
      }
    }
    // A lintel over the door, and a step before it.
    {
      const at = frame(lh.x, lh.z, base, lh.door);
      box(at, 'stone', -0.75, 0.75, doorTop, doorTop + 0.3, r0 - wallT - 0.05, r0 + 0.08, shade(stone, 1.1));
      box(at, 'stone', -0.8, 0.8, -0.3, 0.15, r0 - 0.05, r0 + 0.6, shade(stone, 1.0));
    }
    // The floor inside, and the stair: wedges of stone winding about a newel, from beside the door to the top.
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      solid('stone', [ring(a0, 0, -0.6), ring(a1, 0, -0.6), ring(a1, r0 - wallT + 0.05, -0.6), ring(a0, r0 - wallT + 0.05, -0.6), ring(a0, 0, 0.15), ring(a1, 0, 0.15), ring(a1, r0 - wallT + 0.05, 0.15), ring(a0, r0 - wallT + 0.05, 0.15)], shade(stone, 0.95));
    }
    const steps = Math.floor((top - 0.15) / rise), newel = 0.24;
    for (let s = 0; s < steps; s++) {
      const a0 = firstStep + (s / stepsPerTurn) * Math.PI * 2, a1 = firstStep + ((s + 1.08) / stepsPerTurn) * Math.PI * 2, y1 = 0.15 + (s + 1) * rise, y0 = y1 - 0.3;
      const out0 = radiusAt(y1) - wallT + 0.04;
      solid('stone', [ring(a0, newel, y0), ring(a1, newel, y0), ring(a1, out0, y0), ring(a0, out0, y0), ring(a0, newel, y1), ring(a1, newel, y1), ring(a1, out0, y1), ring(a0, out0, y1)], shade(stone, 0.9 + 0.1 * (s % 2)));
    }
    // The newel, up the middle to the lamp.
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
      solid('stone', [ring(a0, 0, 0), ring(a1, 0, 0), ring(a1, newel, 0), ring(a0, newel, 0), ring(a0, 0, top + 0.9), ring(a1, 0, top + 0.9), ring(a1, newel, top + 0.9), ring(a0, newel, top + 0.9)], shade(stone, 1.05));
    }
    // The top: a floor across the tower with a hatch where the stair comes up, carried out beyond the wall as the gallery.
    const lastA = firstStep + (steps / stepsPerTurn) * Math.PI * 2, gallery = rT + 1.0;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
      const back = ((lastA - am) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      // (Open over the last twelve steps, three quarters of a turn: anyone coming up must have room for their head under the floor.)
      const hatch = back < (12 / stepsPerTurn) * Math.PI * 2;
      const from = hatch ? rT - wallT + 0.02 : newel;
      solid('stone', [ring(a0, from, top - 0.05), ring(a1, from, top - 0.05), ring(a1, gallery, top - 0.05), ring(a0, gallery, top - 0.05), ring(a0, from, top + 0.15), ring(a1, from, top + 0.15), ring(a1, gallery, top + 0.15), ring(a0, gallery, top + 0.15)], shade(stone, 1.05));
      // Corbels under the gallery.
      if (k % 2 === 0) solid('stone', [ring(a0 + 0.03, rT - 0.05, top - 0.9), ring(a1 - 0.03, rT - 0.05, top - 0.9), ring(a1 - 0.03, rT + 0.1, top - 0.9), ring(a0 + 0.03, rT + 0.1, top - 0.9), ring(a0 + 0.03, rT - 0.05, top - 0.05), ring(a1 - 0.03, rT - 0.05, top - 0.05), ring(a1 - 0.03, gallery - 0.1, top - 0.05), ring(a0 + 0.03, gallery - 0.1, top - 0.05)], white);
      // The railing: iron posts and two rails.
      const p0 = ring(a0, gallery - 0.08, top + 0.15);
      solid('metal', [[p0[0] - 0.03, p0[1], p0[2] - 0.03], [p0[0] + 0.03, p0[1], p0[2] - 0.03], [p0[0] + 0.03, p0[1], p0[2] + 0.03], [p0[0] - 0.03, p0[1], p0[2] + 0.03], [p0[0] - 0.03, p0[1] + 1.05, p0[2] - 0.03], [p0[0] + 0.03, p0[1] + 1.05, p0[2] - 0.03], [p0[0] + 0.03, p0[1] + 1.05, p0[2] + 0.03], [p0[0] - 0.03, p0[1] + 1.05, p0[2] + 0.03]], iron);
      for (const rh of [0.5, 1.05]) solid('metal', [ring(a0, gallery - 0.11, top + 0.15 + rh - 0.04), ring(a1, gallery - 0.11, top + 0.15 + rh - 0.04), ring(a1, gallery - 0.05, top + 0.15 + rh - 0.04), ring(a0, gallery - 0.05, top + 0.15 + rh - 0.04), ring(a0, gallery - 0.11, top + 0.15 + rh), ring(a1, gallery - 0.11, top + 0.15 + rh), ring(a1, gallery - 0.05, top + 0.15 + rh), ring(a0, gallery - 0.05, top + 0.15 + rh)], iron);
    }
    // The lantern: a low wall, a ring of glass in iron glazing bars, a domed roof with a vent and a vane.
    // A way out onto the gallery on the side away from the hatch.
    // (The way out is over the quarter of the floor that is not open for the stair.)
    // (Two panes of the lantern's sixteen are left out for it, either side of a glazing bar that is left out too.)
    const doorK = ((Math.round(((lastA + Math.PI / 4) / (Math.PI * 2)) * 16 - 0.5) % 16) + 16) % 16, outA = ((doorK + 1) / 16) * Math.PI * 2, rl = rT - 0.3, lw = 0.12;
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2, am = (a0 + a1) / 2;
      const isDoor = k === doorK || k === (doorK + 1) % 16;
      if (!isDoor) {
        solid('metal', [ring(a0, rl - lw, top + 0.15), ring(a1, rl - lw, top + 0.15), ring(a1, rl, top + 0.15), ring(a0, rl, top + 0.15), ring(a0, rl - lw, top + 1.0), ring(a1, rl - lw, top + 1.0), ring(a1, rl, top + 1.0), ring(a0, rl, top + 1.0)], iron);
        solid('glass', [ring(a0, rl - 0.06, top + 1.0), ring(a1, rl - 0.06, top + 1.0), ring(a1, rl - 0.03, top + 1.0), ring(a0, rl - 0.03, top + 1.0), ring(a0, rl - 0.06, top + 3.0), ring(a1, rl - 0.06, top + 3.0), ring(a1, rl - 0.03, top + 3.0), ring(a0, rl - 0.03, top + 3.0)], [0.1, 0.12, 0.13]);
      }
      const b0 = ring(a0, rl - 0.05, top + 0.15);
      if (k !== (doorK + 1) % 16) solid('metal', [[b0[0] - 0.04, b0[1], b0[2] - 0.04], [b0[0] + 0.04, b0[1], b0[2] - 0.04], [b0[0] + 0.04, b0[1], b0[2] + 0.04], [b0[0] - 0.04, b0[1], b0[2] + 0.04], [b0[0] - 0.04, top + 3.1, b0[2] - 0.04], [b0[0] + 0.04, top + 3.1, b0[2] - 0.04], [b0[0] + 0.04, top + 3.1, b0[2] + 0.04], [b0[0] - 0.04, top + 3.1, b0[2] + 0.04]], iron);
      // The dome, in two tiers.
      solid('metal', [ring(a0, 0, top + 3.0), ring(a1, 0, top + 3.0), ring(a1, rl + 0.2, top + 3.0), ring(a0, rl + 0.2, top + 3.0), ring(a0, 0, top + 3.95), ring(a1, 0, top + 3.95), ring(a1, rl * 0.55, top + 3.85), ring(a0, rl * 0.55, top + 3.85)], iron);
      solid('metal', [ring(a0, 0, top + 3.85), ring(a1, 0, top + 3.85), ring(a1, rl * 0.55, top + 3.85), ring(a0, rl * 0.55, top + 3.85), ring(a0, 0, top + 4.5), ring(a1, 0, top + 4.5), ring(a1, 0.2, top + 4.5), ring(a0, 0.2, top + 4.5)], iron);
    }
    // The vent ball and the rod.
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
      solid('metal', [ring(a0, 0, top + 4.45), ring(a1, 0, top + 4.45), ring(a1, 0.28, top + 4.62), ring(a0, 0.28, top + 4.62), ring(a0, 0, top + 4.95), ring(a1, 0, top + 4.95), ring(a1, 0.26, top + 4.8), ring(a0, 0.26, top + 4.8)], iron);
    }
    solid('metal', [ring(0, 0.03, top + 4.9), ring(Math.PI / 2, 0.03, top + 4.9), ring(Math.PI, 0.03, top + 4.9), ring(Math.PI * 1.5, 0.03, top + 4.9), ring(0, 0.03, top + 6.2), ring(Math.PI / 2, 0.03, top + 6.2), ring(Math.PI, 0.03, top + 6.2), ring(Math.PI * 1.5, 0.03, top + 6.2)], iron);
    // The lamp on top of the newel: its lens a squat drum of glass rings, which shines by night.
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
      solid('lamp', [ring(a0, 0, top + 0.9), ring(a1, 0, top + 0.9), ring(a1, 0.5, top + 1.0), ring(a0, 0.5, top + 1.0), ring(a0, 0, top + 2.3), ring(a1, 0, top + 2.3), ring(a1, 0.48, top + 2.1), ring(a0, 0.48, top + 2.1)], [0.95, 0.88, 0.6]);
    }
    // Indoors the tower sees little sky: only what comes in at its door and windows.
    indoors.push((x, y, z) => (Math.hypot(x - lh.x, z - lh.z) < radiusAt(y - base) - wallT + 0.06 && y > base - 0.65 && y < base + top + 0.1 ? 0.22 : 1));
    // A low wall round the yard at its foot, whitewashed, open towards the door.
    for (let k = 0; k < 56; k++) {
      const a0 = (k / 56) * Math.PI * 2, a1 = ((k + 1) / 56) * Math.PI * 2, am = (a0 + a1) / 2, R = r0 + 9;
      if (Math.abs(((am - lh.door + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.16) continue;
      const g0 = c.ground(lh.x + Math.cos(a0) * R, lh.z + Math.sin(a0) * R), g1 = c.ground(lh.x + Math.cos(a1) * R, lh.z + Math.sin(a1) * R);
      const lo = Math.min(g0, g1) - base - 0.4, hi = Math.max(g0, g1) - base + 0.95;
      solid('plaster', [ring(a0, R - 0.25, lo), ring(a1, R - 0.25, lo), ring(a1, R + 0.25, lo), ring(a0, R + 0.25, lo), ring(a0, R - 0.25, hi), ring(a1, R - 0.25, hi), ring(a1, R + 0.25, hi), ring(a0, R + 0.25, hi)], white);
    }
    // Nobody goes over the rail: a ring of the boxes nobody sees, just outside it.
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, p = ring(a, gallery + 0.35, top);
      c.fences.push({ min: new Vector3(p[0] - 0.45, p[1] + 0.2, p[2] - 0.45), max: new Vector3(p[0] + 0.45, p[1] + 5, p[2] + 0.45) });
    }
    // Somebody left a spyglass on the gallery.
    const sa = lastA + Math.PI * 0.5;
    c.finds.push({ at: new Vector3(...ring(sa, (rl + gallery) / 2, top + 0.25)), what: 'a spyglass' });
  }

  // ---- the castle on its headland: curtain walls, towers and a keep, true to size, walked round and into its court
  if (o.castle) {
    const k = o.castle;
    // (Its walls, towers and gate only: the far hills' castle fills its court with ranges of buildings, and one of them stands across the gate.)
    const tint: Colour = [0.82 * c.stoneTint[0], 0.78 * c.stoneTint[1], 0.7 * c.stoneTint[2]];
    buildLandmark('castle', k.x, k.y, k.z, k.facing, mesh, rng.fork('castle'), tint, 0.5, true);
    // The keep, at the back of the court: a square tower with a battlement, its door towards the gate.
    const at = frame(k.x, k.z, k.y, k.facing), q = rng.fork('castle keep'), half = q.range(3.2, 4), tall = q.range(12, 16), back = q.range(3, 4.5);
    box(at, 'stone', -half, half, -2.5, tall, back, back + half * 2, shade(tint, 0.95), 0.35);
    for (let a = -half; a < half - 0.3; a += 1.2) for (const f of [back, back + half * 2 - 0.5]) box(at, 'stone', a, a + 0.6, tall, tall + 1, f, f + 0.5, shade(tint, 0.9), 0.35);
    for (let f = back + 0.5; f < back + half * 2 - 0.5; f += 1.2) for (const a of [-half, half - 0.5]) box(at, 'stone', a, a + 0.5, tall, tall + 1, f, f + 0.6, shade(tint, 0.9), 0.35);
    box(at, 'wood', -0.6, 0.6, 0, 2.3, back - 0.06, back, [0.18, 0.12, 0.08], 0.9);
    for (let y = 4; y < tall - 2; y += 3.2) box(at, 'glass', -0.15, 0.15, y, y + 1.1, back - 0.03, back, [0.02, 0.02, 0.02]);
    // Something left lying in the court, before the keep.
    c.finds.push({ at: new Vector3(...at(0.8, 0.2, -2)), what: 'a rusted helm' });
  }

  // ---- the ruin of a chapel on its headland: its west front with the window empty, its walls broken down
  if (o.chapel) {
    const k = o.chapel, fx = Math.cos(k.facing), fz = Math.sin(k.facing);
    buildLandmark('ruin', k.x - fx * 8, k.y, k.z - fz * 8, k.facing, mesh, rng.fork('chapel'), [0.82 * c.stoneTint[0], 0.78 * c.stoneTint[1], 0.7 * c.stoneTint[2]], 0.5);
    // (Left on the step before its west front, where the footpath comes: the walls of the nave stand too close and too high to be got through.)
    c.finds.push({ at: new Vector3(k.x - fx * 9.5, c.ground(k.x - fx * 9.5, k.z - fz * 9.5) + 0.25, k.z - fz * 9.5), what: 'a bronze handbell' });
  }

  // ---- the burial ground beside the house: a dry-stone wall, headstones in rows, a high cross
  if (o.graveyard) {
    const q = rng.fork('graveyard'), gy = o.graveyard, base = c.ground(gy.x, gy.z);
    const towardHouse = gy.x > (o.level.x0 + o.level.x1) / 2 ? -1 : 1;
    const at = frame(gy.x, gy.z, base, 0);
    // (In this frame `f` is along x and `a` along z.)
    const wallStone = shade(stone, 0.85), H = 0.95, t = 0.55;
    for (const [a0, a1, f0, f1, gap] of [
      [-gy.w / 2, gy.w / 2, -gy.d / 2 - t, -gy.d / 2, towardHouse < 0], [-gy.w / 2, gy.w / 2, gy.d / 2, gy.d / 2 + t, towardHouse > 0],
      [-gy.w / 2 - t, -gy.w / 2, -gy.d / 2 - t, gy.d / 2 + t, false], [gy.w / 2, gy.w / 2 + t, -gy.d / 2 - t, gy.d / 2 + t, false],
    ] as [number, number, number, number, boolean][]) {
      // Laid in lengths, each a little different in height, as dry stone is; a gateway in the side towards the house.
      for (let u = a0; u < a1 - 1e-6;) {
        const u1 = Math.min(a1, u + q.range(0.8, 1.4));
        if (!(gap && Math.abs((u + u1) / 2) < 1.1)) box(at, 'stone', u, u1, -0.4, H + q.range(-0.12, 0.08), f0, f1, shade(wallStone, q.range(0.85, 1.1)), 0.6);
        u = u1;
      }
    }
    // Headstones in rows, facing the way the house's door does; some leaning, a few fallen.
    for (let f = -gy.d / 2 + 1.6; f < gy.d / 2 - 1.2; f += q.range(1.8, 2.3)) for (let a = -gy.w / 2 + 1.4; a < gy.w / 2 - 1.2; a += q.range(1.2, 1.7)) {
      if (q.chance(0.22)) continue;
      const wide = q.range(0.45, 0.7), tall = q.range(0.5, 1.0), thick = q.range(0.08, 0.13), lean = q.range(-0.12, 0.12), tone = shade(stone, q.range(0.75, 1.05));
      const p = (da: number, h: number, df: number): P3 => at(a + da, h, f + df + h * lean);
      if (q.chance(0.12)) {
        // Fallen flat on its face.
        solid('stone', [p(-wide / 2, 0, 0), p(wide / 2, 0, 0), p(wide / 2, 0, tall), p(-wide / 2, 0, tall), p(-wide / 2, thick, 0), p(wide / 2, thick, 0), p(wide / 2, thick, tall), p(-wide / 2, thick, tall)], tone, 0.8);
      } else solid('stone', [p(-wide / 2, -0.3, 0), p(wide / 2, -0.3, 0), p(wide / 2, -0.3, thick), p(-wide / 2, -0.3, thick), p(-wide * 0.48, tall, 0), p(wide * 0.48, tall, 0), p(wide * 0.48, tall, thick), p(-wide * 0.48, tall, thick)], tone, 0.8);
    }
    // The high cross: a stepped base, a tall shaft, arms, and a ring about the crossing; facing the gateway.
    {
      const ca = gy.w / 2 - 2.2, cf = 0, cross = shade(stone, 0.92);
      box(at, 'stone', ca - 0.9, ca + 0.9, -0.3, 0.35, cf - 0.9, cf + 0.9, cross);
      box(at, 'stone', ca - 0.6, ca + 0.6, 0.35, 0.75, cf - 0.6, cf + 0.6, cross);
      box(at, 'stone', ca - 0.2, ca + 0.2, 0.75, 4.1, cf - 0.14, cf + 0.14, cross);
      box(at, 'stone', ca - 0.85, ca + 0.85, 3.05, 3.4, cf - 0.13, cf + 0.13, cross);
      for (let k = 0; k < 12; k++) {
        const t0 = (k / 12) * Math.PI * 2, t1 = ((k + 1) / 12) * Math.PI * 2, r0 = 0.48, r1 = 0.62, cy = 3.22;
        const ring = (tt: number, r: number, df: number): P3 => at(ca + Math.cos(tt) * r, cy + Math.sin(tt) * r, cf + df);
        solid('stone', [ring(t0, r0, -0.1), ring(t1, r0, -0.1), ring(t1, r1, -0.1), ring(t0, r1, -0.1), ring(t0, r0, 0.1), ring(t1, r0, 0.1), ring(t1, r1, 0.1), ring(t0, r1, 0.1)], cross);
      }
    }
  }

  // ---- in the sea cave, at its far end, something somebody hid
  if (o.seaCave) {
    const sc = o.seaCave, a = sc.length * 0.8;
    c.finds.push({ at: new Vector3(sc.x + Math.cos(sc.heading) * a, c.caveFloor + a * 0.02 + 0.3, sc.z + Math.sin(sc.heading) * a), what: 'a smuggler\'s lantern' });
  }
  for (const [m, from] of begun) mesh(m).setOpenBy((x, y, z) => { let v = 1; for (const f of indoors) v = Math.min(v, f(x, y, z)); return v; }, from);
  // ---- the mansion, built as the valley's classical houses are, which marks its own rooms as indoors (and so is built after the rest is marked).
  if (o.mansion) {
    const b = o.mansion.building, turn = b.faces === 'w' ? 1 : -1;
    buildBuilding(b, o.mansion.y, mesh, rng.fork('mansion'), c.stoneTint, false);
    // Somebody left something in its entrance hall.
    c.finds.push({ at: new Vector3(b.x - turn * (b.d / 2 - 3), o.mansion.y + CLASSICAL.plinth + 0.3, b.z + 0.6), what: 'a silver snuffbox' });
  }
  return { deck, lamp: o.lighthouse ? { x: o.lighthouse.x, y: o.lighthouse.y + o.lighthouse.height + 1.6, z: o.lighthouse.z } : undefined };
}

/** A point in a frame, on the ground plane: for asking how high the ground is under it. */
function at2(at: ReturnType<typeof frame>, a: number, f: number): [number, number] {
  const p = at(a, 0, f);
  return [p[0], p[2]];
}
