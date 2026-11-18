import { Vector3 } from 'three';
import { cells3, fbm2, fbm3, Rng } from '../core/rng';
import { Furnisher, Rect } from './furnish';
import { Place, shoreOf, Side, Site, SKIES, Way } from '../core/site';
import { buildDoorLeaf } from './doorLeaf';
import { indoorField, outdoorFieldAt } from './fields';
import { Frame, Kit, Opening } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { alongSheet, carveRock, smin } from './geom/rock';
import { buildCamp } from './camp';
import { buildMineYard } from './mine';
import { boulderForm, cliffRelief, erode, Grid2, monolithForm, ROCK, Strata } from './geom/rockForms';
import { beam, plank, stoneStyles } from './geom/styles';
import { crestAt, farHeights, layMountains, layTerrain, turfColour } from './landscape';
import { MeshBuilder } from './geom/meshBuilder';
import { layBeam } from './geom/timber';
import { buildBuilding, solids } from './buildings';
import { buildLandmark } from './landmarks';
import { footprintOf, groundOf } from '../core/building';
import { armRise, boxValley, edgeAt, hallOnward, insideOf, joinLine, slantAt, valleyLand } from '../core/valley';
import { Colour, growConifer, growTree, layLimb, layTrunk, Planting } from './planting';
import { CardSet, DoorDesc, SceneDescription, SeaDesc, TorchSpec } from './scene';
import { buildIsland } from './island';
import { buildMountain } from './mountain';

/**
 * Turns a site document into geometry, using the kit of parts.
 *
 * Each place gets a floor, four wall faces with holes for its ways, and a roof by type. Each way
 * gets dressed stone round its opening, a threshold, and stairs where the floors differ. Solid
 * mass is recorded behind every wall and above every roof.
 */

const STEP = 0.17;
const SIDES: Side[] = ['n', 's', 'e', 'w'];
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

interface Hole extends Opening {
  way: Way;
  /** Centre in world coordinates along the wall. */
  at: number;
}

/** A window in an outer wall of a house that stands free: a way into nowhere, there only to be cut through the wall. */
type OuterWindow = Way & { outer: true };

/** One flat face of a roof of tiles, through the given corners, wound to face away from `inside`. */
function tileFace(mesh: MeshBuilder, pts: Vector3[], colour: [number, number, number], inside: Vector3): void {
  const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
  const mid = pts.reduce((m, q) => m.add(q), new Vector3()).multiplyScalar(1 / pts.length);
  let list = pts;
  if (n.dot(mid.sub(inside)) < 0) { n.negate(); list = [...pts].reverse(); }
  const side = Math.abs(n.x) > Math.abs(n.z);
  const ids = list.map((q) => mesh.addVertex(q.x, q.y, q.z, n.x, n.y, n.z, (side ? q.z : q.x) * 0.62, (q.y + (side ? q.x : q.z) * n.y) * 0.62, colour[0], colour[1], colour[2]));
  for (let k = 1; k < ids.length - 1; k++) mesh.addTriangle(ids[0], ids[k], ids[k + 1]);
}

export function meshSite(site: Site): SceneDescription {
  const kit = new Kit(site.seed);
  const rng = new Rng(site.seed).fork('mesh');
  const T = site.wallThickness;
  const places = site.places;
  const { ashlar, dressed, vaultStone, flag, hallFlag, coping, tint: stoneTint } = stoneStyles(site.setting.stone);
  const sky = SKIES[site.setting.hour];
  // Where sheep graze, if anywhere: worked out with the planting of each kind of place.
  let flockSpots: { x: number; z: number; r: number; count: number }[] | undefined;

  // ------------------------------------------------------------------ helpers
  /** The wall face of a place on one side, looking into the place, lengthened by `e` at both ends. */
  const frameOf = (p: Place, side: Side, e: number): Frame => {
    switch (side) {
      case 'n': return kit.frame(p.x0 - e, p.z0, p.x1 + e, p.z0);
      case 's': return kit.frame(p.x1 + e, p.z1, p.x0 - e, p.z1);
      case 'w': return kit.frame(p.x0, p.z1 + e, p.x0, p.z0 - e);
      case 'e': return kit.frame(p.x1, p.z0 - e, p.x1, p.z1 + e);
    }
  };
  /** Converts a world coordinate along a wall into a distance along its frame. */
  const alongFrame = (p: Place, side: Side, at: number, e: number): number => {
    switch (side) {
      case 'n': return at - (p.x0 - e);
      case 's': return p.x1 + e - at;
      case 'w': return p.z1 + e - at;
      case 'e': return at - (p.z0 - e);
    }
  };
  const flip: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const sideOf = (w: Way, p: Place): Side => (w.a === p.id ? w.side : flip[w.side]);

  const shape = (w: Way): { y0: number; ys: number } => {
    const lo = Math.min(places[w.a].floor, places[w.b].floor);
    const hi = Math.max(places[w.a].floor, places[w.b].floor);
    // (A window in an outer wall of a house that stands free: tall and arched in a room lit by day, a slit where torches light it.)
    if ((w as OuterWindow).outer) { const p = places[w.a]; return { y0: p.floor + 1.05, ys: p.floor + Math.min(p.wall - 0.55, w.halfWidth < 0.3 ? 2.3 : 2.75) }; }
    if (w.kind === 'window') return { y0: hi + 1.55, ys: hi + 2.35 };
    return { y0: lo - 0.1, ys: hi + (w.natural ? 2.5 : w.kind === 'arch' ? 1.9 : 2.0) };
  };
  // A secret door shows no dressed stone on the side it is hidden from: the wall runs up to it.
  const hiddenFrom = (w: Way, p: Place) => w.door?.leaf === 'secret' && p.id !== site.secret;
  const holesOn = (p: Place, side: Side, e: number): Hole[] =>
    [...site.ways, ...(outerWindows.get(p.id) ?? [])].filter((w) => w.kind !== 'stair' && (w.a === p.id || w.b === p.id) && sideOf(w, p) === side)
      .map((w) => ({ way: w, at: w.at, c: alongFrame(p, side, w.at, e), w: w.halfWidth, ...shape(w), ...(hiddenFrom(w, p) ? { band: 0.03 } : {}) }));

  const span = (p: Place) => (p.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0);
  const isEndWall = (p: Place, side: Side) => (p.axis === 'x') === (side === 'e' || side === 'w');
  const wallTop = (p: Place, side: Side): number => {
    if (p.roof === 'barrel') return p.floor + p.wall + (isEndWall(p, side) ? span(p) / 2 + 0.3 : 0.12);
    if (p.roof === 'timber') return p.floor + p.wall + 0.1;
    if (p.roof === 'cave') return p.floor + p.wall + 1.3;
    return site.top;
  };

  /** A box given in a wall's own terms: along it, up, and through it away from the place. */
  const wallBox = (f: Frame, u0: number, u1: number, y0: number, y1: number, t0: number, t1: number) => {
    const a = f.a.clone().addScaledVector(f.dir, u0).addScaledVector(f.normal, -t0);
    const b = f.a.clone().addScaledVector(f.dir, u1).addScaledVector(f.normal, -t1);
    return { min: V(Math.min(a.x, b.x), y0, Math.min(a.z, b.z)), max: V(Math.max(a.x, b.x), y1, Math.max(a.z, b.z)) };
  };
  // ------------------------------------------------------------------ storeys
  // A stair joins a place to the one over it. Both have the same outline; the flight stands in
  // the lower one against a wall, and comes up through a well in the floor of the upper.
  const stairsFrom = (p: Place) => site.ways.filter((w) => w.kind === 'stair' && w.a === p.id);
  const stairsInto = (p: Place) => site.ways.filter((w) => w.kind === 'stair' && w.b === p.id);
  const roomOver = (p: Place) => stairsFrom(p).length > 0, roomUnder = (p: Place) => stairsInto(p).length > 0;
  /** A strip of a place's floor against one of its walls: from `u0` to `u1` along the wall, and `deep` out from it. */
  const strip = (p: Place, side: Side, u0: number, u1: number, deep: number): Rect => {
    const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
    return side === 'n' ? { x0: lo, x1: hi, z0: p.z0, z1: p.z0 + deep } : side === 's' ? { x0: lo, x1: hi, z0: p.z1 - deep, z1: p.z1 }
      : side === 'w' ? { x0: p.x0, x1: p.x0 + deep, z0: lo, z1: hi } : { x0: p.x1 - deep, x1: p.x1, z0: lo, z1: hi };
  };
  /** What a stair is made of: how many steps, how deep each, which way it climbs along its wall, and how broad. */
  const flightOf = (w: Way) => {
    const steps = Math.max(1, Math.round((places[w.b].floor - places[w.a].floor) / STEP)), to = w.to ?? w.at;
    return { steps, tread: Math.abs(to - w.at) / steps, dir: to >= w.at ? 1 : -1, wide: w.halfWidth * 2, to };
  };
  // How many steps can be climbed before the head comes to the beams of the ceiling: the well must have begun by then.
  // (With room to spare: whoever climbs is a stride deep, front to back, as well as a man high.)
  const stepsUnderCeiling = (w: Way) => Math.max(0, Math.floor((places[w.a].wall - 0.27 - 2.3) / STEP));
  /** Where a stair stands on the floor of the lower place, and the well it comes up through in the floor of the upper. */
  const flightRect = (w: Way): Rect => strip(places[w.a], w.side, w.at, flightOf(w).to, flightOf(w).wide);
  const wellRect = (w: Way): Rect => {
    const f = flightOf(w);
    // The well begins where there would otherwise be less than a man's height over the steps.
    const clearSteps = stepsUnderCeiling(w);
    return strip(places[w.a], w.side, w.at + f.dir * clearSteps * f.tread, f.to, f.wide + 0.06);
  };
  /** A rectangle with other rectangles cut out of it, as rectangles: for a floor with a stairwell in it. */
  const without = (whole: Rect, holes: Rect[]): Rect[] => {
    let pieces = [whole];
    for (const h of holes) {
      const next: Rect[] = [];
      for (const r of pieces) {
        if (h.x0 >= r.x1 || h.x1 <= r.x0 || h.z0 >= r.z1 || h.z1 <= r.z0) { next.push(r); continue; }
        if (h.z0 > r.z0) next.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: h.z0 });
        if (h.z1 < r.z1) next.push({ x0: r.x0, x1: r.x1, z0: h.z1, z1: r.z1 });
        const z0 = Math.max(r.z0, h.z0), z1 = Math.min(r.z1, h.z1);
        if (h.x0 > r.x0) next.push({ x0: r.x0, x1: h.x0, z0, z1 });
        if (h.x1 < r.x1) next.push({ x0: h.x1, x1: r.x1, z0, z1 });
      }
      pieces = next;
    }
    return pieces.filter((r) => r.x1 - r.x0 > 0.02 && r.z1 - r.z0 > 0.02);
  };

  // ------------------------------------------------------------------ a house that stands free
  // A house that stands free in the valley is the same rooms as one built under a hill, but what
  // the hill hid is now seen: so it is walled outside along its whole outline, from the ground to
  // the roofline the courts open from, and roofed. The outline is the edge of every room grown by
  // a wall's thickness; it is traced on a lattice a hand's breadth fine, as runs of wall each
  // looking one way. Rooms lit by day have windows in their outer walls, rooms lit by torches a
  // slit, dark rooms none.
  const free = site.stands === 'free' && !!site.grounds;
  // A delve has no house front: the rock of the ridge comes down to the forecourt, with a portal built in it for the door.
  const delve = site.stands === 'delve' && !!site.grounds;
  const outerRects = free ? places.filter((p) => p.role !== 'approach' && (p.level ?? 0) >= 0).map((p) => ({ x0: p.x0 - T, x1: p.x1 + T, z0: p.z0 - T, z1: p.z1 + T })) : [];
  const insideOuter = (x: number, z: number, m = 0) => outerRects.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
  /** A run of outer wall: the way it looks (`n` is towards lesser z), where it stands across, and where it runs from and to along. */
  type Run = { side: Side; at: number; from: number; to: number };
  const runs: Run[] = [];
  const outerWindows = new Map<number, OuterWindow[]>();
  if (free) {
    const C = 0.1, ox = Math.min(...outerRects.map((r) => r.x0)) - C, oz = Math.min(...outerRects.map((r) => r.z0)) - C;
    const nx = Math.round((Math.max(...outerRects.map((r) => r.x1)) + C - ox) / C) + 1, nz = Math.round((Math.max(...outerRects.map((r) => r.z1)) + C - oz) / C) + 1;
    const solid = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) solid[j * nx + i] = insideOuter(ox + (i + 0.5) * C, oz + (j + 0.5) * C) ? 1 : 0;
    const cell = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < nz ? solid[j * nx + i] : 0);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (let j = 0; j <= nz; j++) {
      let run: Run | null = null;
      for (let i = 0; i <= nx; i++) {
        const a = cell(i, j - 1), b = cell(i, j), side: Side | null = i < nx && a !== b ? (b ? 'n' : 's') : null;
        if (run && run.side === side) { run.to = r2(ox + (i + 1) * C); continue; }
        if (run) runs.push(run);
        run = side ? { side, at: r2(oz + j * C), from: r2(ox + i * C), to: r2(ox + (i + 1) * C) } : null;
      }
    }
    for (let i = 0; i <= nx; i++) {
      let run: Run | null = null;
      for (let j = 0; j <= nz; j++) {
        const a = cell(i - 1, j), b = cell(i, j), side: Side | null = j < nz && a !== b ? (b ? 'w' : 'e') : null;
        if (run && run.side === side) { run.to = r2(oz + (j + 1) * C); continue; }
        if (run) runs.push(run);
        run = side ? { side, at: r2(ox + i * C), from: r2(oz + j * C), to: r2(oz + (j + 1) * C) } : null;
      }
    }
    // Windows: in each room, along each stretch of its wall that is outer wall, spaced evenly, and clear of doors, the ribs of a vault and any stair against that wall.
    for (const q of places) {
      if (q.role === 'approach' || (q.level ?? 0) < 0 || q.roof === 'sky' || q.roof === 'cave' || q.light === 'dark') continue;
      const list: OuterWindow[] = [];
      for (const side of SIDES) {
        const along = side === 'n' || side === 's', face = side === 'n' ? q.z0 - T : side === 's' ? q.z1 + T : side === 'w' ? q.x0 - T : q.x1 + T;
        const lo = along ? q.x0 : q.z0, hi = along ? q.x1 : q.z1;
        for (const r of runs) {
          if (r.side !== side || Math.abs(r.at - face) > 0.05) continue;
          const a = Math.max(lo, r.from) + 0.95, b = Math.min(hi, r.to) - 0.95;
          if (b < a) continue;
          const wide = q.light === 'day', count = wide ? Math.max(1, Math.round((b - a) / 3.1)) : 1;
          const ribs: number[] = [];
          if (q.roof === 'barrel' && (q.axis === 'x') === along) {
            const a0 = along ? q.x0 : q.z0, length = hi - lo, n = Math.max(0, Math.round(length / 3.4) - 1);
            for (let k = 1; k <= n; k++) ribs.push(a0 + (length * k) / (n + 1));
          }
          const stairs = [...stairsFrom(q), ...stairsInto(q)].filter((w) => w.side === side).map((w) => [Math.min(w.at, w.to ?? w.at) - 0.7, Math.max(w.at, w.to ?? w.at) + 0.7]);
          const doors = site.ways.filter((w) => (w.a === q.id || w.b === q.id) && sideOf(w, q) === side && w.kind !== 'stair').map((w) => [w.at - w.halfWidth - 0.9, w.at + w.halfWidth + 0.9]);
          for (let k = 0; k < count; k++) {
            const at = count === 1 ? (a + b) / 2 : a + ((b - a) * k) / (count - 1);
            // (Moved off a rib if it falls on one: to the middle of the bay beside it.)
            let c = at;
            for (const rib of ribs) if (Math.abs(c - rib) < 0.85) c = rib + (c >= rib ? 1 : -1) * Math.min(1.6, (hi - lo) / (ribs.length + 1) / 2);
            if (c < lo + 0.9 || c > hi - 0.9 || [...stairs, ...doors].some(([x0, x1]) => c > x0 && c < x1) || list.some((w) => w.side === side && Math.abs(w.at - c) < 1.8)) continue;
            list.push({ a: q.id, b: q.id, side, kind: 'window', at: Math.round(c * 100) / 100, halfWidth: wide ? 0.5 : 0.17, outer: true });
          }
        }
      }
      if (list.length) outerWindows.set(q.id, list);
    }
  }

  // ------------------------------------------------------------------ a way through the hill
  // The tunnel from a cave chamber out through the ridge to the arm beside it. Its air is one function, and three carvings take it
  // in: the chamber's, where it leaves; the land's, where its mouth opens in the ridge's side; and one of its own for the stretch
  // between. `along` is how far a point is into the ridge from the ridge's side: less than nothing out in the arm.
  const backWay = (() => {
    const bw = site.backWay, r = site.valley?.ridge, yard = places.find((q) => q.role === 'approach');
    if (!bw || !r || !yard || !site.grounds) return null;
    const p = places[bw.place], dir = bw.side === 'w' ? 1 : -1, edge = bw.side === 'w' ? r.x0 : r.x1, length = (bw.side === 'w' ? p.x0 : p.x1) * dir - edge * dir;
    const seeds = rng.fork('backway'), n1 = seeds.range(0, 50), n2 = seeds.range(0, 50), bend = seeds.range(-0.9, 0.9);
    const out = yard.floor - 0.03 + armRise(bw.z, yard.z0), OUT = 6.5, IN = 2.6;
    const along = (x: number) => (x - edge) * dir;
    const floorAt = (a: number) => {
      const t = Math.min(1, Math.max(0, (a + 2.5) / (length + 2.5)));
      // (Out in the arm it comes up a little, so that it meets whatever lies at the foot of the rock as a ramp and not a step.)
      return out + (p.floor - out) * (t * t * (3 - 2 * t)) + 0.16 * Math.max(0, -3 - a);
    };
    const air = (x: number, y: number, z: number): number => {
      const a = along(x);
      if (a < -OUT - 0.5 || a > length + IN + 0.5 || Math.abs(z - bw.z) > 3.2) return -9;
      const off = z - bw.z - bend * Math.sin(Math.min(1, Math.max(0, a / length)) * Math.PI);
      const floor = floorAt(a) + (fbm2(x * 1.1 + n1, z * 1.1, 2) - 0.5) * 0.08;
      const wide = 0.95 + (fbm2(a * 0.8 + n1, y * 0.7, 2) - 0.5) * 0.45, high = 2.3 + (fbm2(x * 0.7 + n2, z * 0.7, 2) - 0.5) * 0.5;
      return Math.min(smin(smin(wide - Math.abs(off), y - floor, 0.3), floor + high - y, 0.4), a + OUT, length + IN - a);
    };
    const top = Math.max(out, p.floor) + 4.2;
    // The way down: a tube along a line of three legs from the tunnel to the cavern, falling evenly and level for its last three metres, so that it meets the cavern's floor and not a ledge above it; and the cavern, an
    // uneven dome over a rough oval floor, with stalagmites standing on the floor and stalactites hanging over them.
    const dp = bw.deep;
    const cave = dp?.join ? site.grottoes?.[0] : undefined;
    const jLine = cave && dp && site.valley ? joinLine(site.valley, cave, dp) : [], jLens = jLine.slice(1).map((q, i) => Math.hypot(q[0] - jLine[i][0], q[1] - jLine[i][1])), jTotal = jLens.reduce((t, l) => t + l, 0);
    // (Points along the way down, every half metre, with its floor at each: for the barriers, which must stop above it.)
    const deepSamples: { x: number; y: number; z: number }[] = [];
    let deepAir: ((x: number, y: number, z: number) => number) | null = null, cavern: { x: number; z: number; floor: number; rx: number; rz: number; height: number; box: [number, number, number, number] } | null = null;
    if (dp) {
      const X = (a: number) => edge + dir * a, z1 = bw.z + dp.toward * dp.leg, start = floorAt(dp.from), yC = start - dp.drop;
      const rim = dp.x + dir * (dp.rx - 1.2);
      const line: [number, number][] = [[X(dp.from), bw.z], [X(dp.from), z1], [X(-5), z1], [rim, dp.z]];
      const lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1])), total = lens.reduce((t, l) => t + l, 0);
      // (Where the cavern lies beyond the arm, all of the fall is inside the ridge, and the way crosses under the arm level and deep.)
      const fallOver = dp.join ? lens[0] + lens[1] - 0.5 : total - 3;
      for (let i = 0, run = 0; i < lens.length; run += lens[i], i++) for (let d = 0; d < lens[i]; d += 0.5) deepSamples.push({ x: line[i][0] + ((line[i + 1][0] - line[i][0]) * d) / lens[i], y: start - dp.drop * Math.min(1, (run + d) / fallOver), z: line[i][1] + ((line[i + 1][1] - line[i][1]) * d) / lens[i] });
      // What has grown in the cavern. Some big stalagmites, each with a stalactite over it, and now and then the two grown together
      // into a column; smaller ones standing round their feet; and stalactites by themselves in the roof.
      // (None stands in a way in, nor between a way in and the middle of the cavern, where what was left there lies.)
      const clearOf = (q: { x: number; z: number; r: number }) => [[rim, dp.z], ...(jLine.length ? [jLine[jLine.length - 1]] : [])].every(([ex, ez]) => {
        const bx = dp.x - ex, bz = dp.z - ez, t = Math.min(1, Math.max(0, ((q.x - ex) * bx + (q.z - ez) * bz) / (bx * bx + bz * bz)));
        return Math.hypot(q.x - ex, q.z - ez) > 2.6 && Math.hypot(q.x - ex - bx * t, q.z - ez - bz * t) > q.r + 1;
      });
      const drip = rng.fork('dripstone');
      type Spike = { x: number; z: number; r: number; h: number; kind: 'up' | 'down' | 'column'; lx: number; lz: number; ph: number };
      const spikes: Spike[] = [];
      for (const q of Array.from({ length: 7 }, () => { const a = seeds.range(0, Math.PI * 2), d = seeds.range(0.25, 0.8); return { x: dp.x + Math.cos(a) * d * dp.rx, z: dp.z + Math.sin(a) * d * dp.rz, r: seeds.range(0.35, 0.7), h: seeds.range(1.2, 2.6) }; })) {
        const column = drip.chance(0.3), lean = () => drip.range(-0.12, 0.12), ph = drip.range(0, 6);
        if (!clearOf(q)) continue;
        spikes.push({ ...q, r: q.r * 1.2, h: q.h * 1.2, kind: column ? 'column' : 'up', lx: lean(), lz: lean(), ph });
        if (!column) spikes.push({ ...q, r: q.r * 0.8, h: q.h * 0.85, kind: 'down', lx: 0, lz: 0, ph: ph + 2 });
        for (let k = drip.int(1, 3); k > 0; k--) {
          const a = drip.range(0, Math.PI * 2), d = q.r * 1.2 + drip.range(0.3, 0.8), small = { x: q.x + Math.cos(a) * d, z: q.z + Math.sin(a) * d, r: drip.range(0.3, 0.42), h: drip.range(0.5, 1.2) };
          if (clearOf(small)) spikes.push({ ...small, kind: 'up', lx: lean(), lz: lean(), ph: drip.range(0, 6) });
        }
      }
      for (let k = 0; k < 10; k++) {
        const a = drip.range(0, Math.PI * 2), d = Math.sqrt(drip.range(0.02, 0.6));
        spikes.push({ x: dp.x + Math.cos(a) * d * dp.rx, z: dp.z + Math.sin(a) * d * dp.rz, r: drip.range(0.3, 0.5), h: drip.range(0.8, 2.2), kind: 'down', lx: 0, lz: 0, ph: drip.range(0, 6) });
      }
      deepAir = (x, y, z) => {
        // The tube: the nearest point of the line, how far along it that is, and how far off.
        let best = Infinity, sAt = 0, run = 0;
        for (let i = 0; i < 3; i++) {
          const [ax, az] = line[i], bx = line[i + 1][0] - ax, bz = line[i + 1][1] - az, t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (lens[i] * lens[i])));
          const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
          if (d < best) { best = d; sAt = run + t * lens[i]; }
          run += lens[i];
        }
        let air = -9;
        if (best < 2.4) {
          const floor = start - dp.drop * Math.min(1, sAt / fallOver) + (fbm2(x * 1.1 + n2, z * 1.1, 2) - 0.5) * 0.08;
          const wide = 0.9 + (fbm2(sAt * 0.8 + n2, y * 0.7, 2) - 0.5) * 0.4, high = 2.7 + (fbm2(x * 0.7 + n1, z * 0.7, 2) - 0.5) * 0.4;
          // (Broadest at knee height and drawing in to the roof, as water and not a mason would have made it.)
          const up = Math.min(1, Math.max(0, (y - floor - 0.5) / (high - 0.5)));
          air = smin(smin(wide * (1.12 - 0.5 * up * up) - best, y - floor, 0.3), floor + high - y, 0.5);
        }
        const ex = (x - dp.x) / dp.rx, ez = (z - dp.z) / dp.rz;
        if (Math.abs(ex) < 1.3 && Math.abs(ez) < 1.3 && y > yC - 1.5 && y < yC + dp.height + 2) {
          const rMin = Math.min(dp.rx, dp.rz);
          const e = (1 - Math.hypot(ex, ez)) * rMin + (fbm2(x * 0.5 + n1, z * 0.5 + n2, 3) - 0.5) * 1.6 + (fbm2(x * 1.9 + y * 1.1 + n1, z * 1.9 - y * 0.8 + n2, 3) - 0.5) * 0.5;
          const floor = yC + (fbm2(x * 0.8 + n2, z * 0.8 + n1, 3) - 0.5) * 0.3;
          const ceil = yC + 1.7 + (dp.height - 1.7) * Math.pow(Math.min(1, Math.max(0, e / rMin)), 0.5) + (fbm2(x * 0.65 + n1 + 9, z * 0.65 + n2, 3) - 0.5) * 0.9;
          let a = smin(smin(e, y - floor, 0.35), ceil - y, 0.5);
          for (const q of spikes) {
            if (Math.abs(x - q.x) > q.r * 1.5 + 0.7 || Math.abs(z - q.z) > q.r * 1.5 + 0.7) continue;
            // (None is round or straight: each has ribs down it, swells and draws in as it goes, and leans a little. A stalagmite
            // spreads at its foot; a column is thinnest at its middle; a stalactite by itself never hangs lower than leaves headroom.)
            // (Where the roof is too low for one to hang at all it dwindles to nothing, and does not stop short: a thing that is there at one point and not at the next is carved as a shard.)
            const room = q.kind === 'down' ? ceil - floor - 2.3 : 9, tall = q.kind === 'column' ? ceil - floor : q.kind === 'down' ? Math.max(0.3, Math.min(q.h, room)) : q.h, lim = Math.min(1, Math.max(0, room / 0.8)), thin = lim * lim * (3 - 2 * lim);
            const t = Math.min(1, Math.max(0, q.kind === 'down' ? (ceil - y) / tall : (y - floor) / tall));
            const ox = x - q.x - q.lx * t * tall, oz = z - q.z - q.lz * t * tall, ribs = 1 + 0.13 * Math.sin(Math.atan2(oz, ox) * 3 + q.ph + t * 2);
            const shape = q.kind === 'column' ? 0.4 + 0.75 * Math.pow(Math.abs(2 * t - 1), 1.7) + 0.4 * Math.exp(-t * 7)
              : Math.pow(1 - t, 1.2) * (0.84 + 0.16 * Math.sin(t * tall * 6.5 + q.ph)) + (q.kind === 'up' ? 0.4 * Math.exp(-t * 7) : 0.25 * Math.exp(-t * 9));
            a = Math.min(a, Math.hypot(ox, oz) - q.r * shape * ribs * thin + (1 - thin) * 0.3);
          }
          air = Math.max(air, a);
        }
        return air;
      };
      cavern = { x: dp.x, z: dp.z, floor: yC, rx: dp.rx, rz: dp.rz, height: dp.height, box: [Math.min(X(dp.from) + 2, dp.x - dp.rx - 1.5), Math.max(X(dp.from) + 2, dp.x + dp.rx + 1.5) + 0, Math.min(bw.z - 3, dp.z - dp.rz - 1.5), Math.max(bw.z + 3, dp.z + dp.rz + 1.5)] };
      cavern.box[0] = Math.min(X(dp.from) - 2, X(dp.from) + 2, dp.x - dp.rx - 1.5); cavern.box[1] = Math.max(X(dp.from) - 2, X(dp.from) + 2, dp.x + dp.rx + 1.5);
      cavern.box[2] = Math.min(cavern.box[2], z1 - 2.5); cavern.box[3] = Math.max(cavern.box[3], z1 + 2.5);
    }
    // The passage up from the cavern to the cave in the arm's wall, if there is one (see `join`, where the land is laid out and its
    // floor can be known). Here: its line, how far along that line a point is and how far off it, and the shape of it in section.
    const jAt = { off: Infinity, along: 0 };
    const joinAt = (x: number, z: number): typeof jAt => {
      jAt.off = Infinity;
      for (let i = 0, run = 0; i < jLens.length; run += jLens[i], i++) {
        const [ax, az] = jLine[i], bx = jLine[i + 1][0] - ax, bz = jLine[i + 1][1] - az, t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (jLens[i] * jLens[i])));
        const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
        if (d < jAt.off) { jAt.off = d; jAt.along = run + t * jLens[i]; }
      }
      return jAt;
    };
    const joinSection = (off: number, along: number, x: number, y: number, z: number, level: number): number => {
      const floor = level + (fbm2(x * 1.1 + n1, z * 1.1 + 7, 2) - 0.5) * 0.08;
      const wide = 0.9 + (fbm2(along * 0.8 + n1, y * 0.7 + 7, 2) - 0.5) * 0.4, high = 2.6 + (fbm2(x * 0.7 + n2, z * 0.7 + 7, 2) - 0.5) * 0.5;
      const up = Math.min(1, Math.max(0, (y - floor - 0.5) / (high - 0.5)));
      return smin(smin(wide * (1.12 - 0.5 * up * up) - off, y - floor, 0.3), floor + high - y, 0.5);
    };
    // (Its last three metres, level with the cavern's floor, are carved with the cavern: so the cavern's wall opens. A little more of
    // it than that is in the cavern's air, so that it does not end in a wall of its own just beyond.)
    const JOIN_LEVEL = 3, cavernAir = deepAir;
    if (jLine.length && cavern && deepAir) {
      const inner = deepAir, cv = cavern;
      deepAir = (x, y, z) => {
        const a = inner(x, y, z), q = joinAt(x, z);
        return q.off < 2.4 && q.along > jTotal - JOIN_LEVEL - 1.5 && y > cv.floor - 1.5 && y < cv.floor + 4 ? Math.max(a, joinSection(q.off, q.along, x, y, z, cv.floor)) : a;
      };
      // (And the cavern's carving reaches as far as that.)
      for (let d = 0; d <= JOIN_LEVEL + 0.5; d += 0.5) for (let i = jLens.length - 1, back = d; i >= 0; back -= jLens[i], i--) if (back <= jLens[i] || i === 0) {
        const f = Math.max(0, 1 - back / jLens[i]), x = jLine[i][0] + (jLine[i + 1][0] - jLine[i][0]) * f, z = jLine[i][1] + (jLine[i + 1][1] - jLine[i][1]) * f;
        cv.box[0] = Math.min(cv.box[0], x - 2.2); cv.box[1] = Math.max(cv.box[1], x + 2.2); cv.box[2] = Math.min(cv.box[2], z - 2.2); cv.box[3] = Math.max(cv.box[3], z + 2.2);
        break;
      }
    }
    const xa0 = edge + dir * -0.7, xb0 = edge + dir * (length + 0.3);
    const deepMin = V(Math.min(xa0, xb0, cavern ? cavern.box[0] : Infinity), cavern ? cavern.floor - 1.5 : Math.min(out, p.floor) - 1, Math.min(bw.z - 3, cavern ? cavern.box[2] : Infinity));
    // (Whether a point is over the part of that passage that is carved by itself and not with the cavern.)
    const joinOwn = (x: number, z: number): boolean => { if (!jLine.length) return false; const q = joinAt(x, z); return q.off < 2.4 && q.along < jTotal - JOIN_LEVEL; };
    return { p, dir, edge, length, z: bw.z, along, air, top, low: Math.min(out, p.floor), x: (a: number) => edge + dir * a, deepAir, deepSamples, cavernAir, cavern, start: dp ? floorAt(dp.from) : 0, deepMin, joinOwn, joinAt, joinSection, join: jLine.length ? { line: jLine, lens: jLens, total: jTotal, level: JOIN_LEVEL } : null };
  })();

  // ------------------------------------------------------------------ torches, decided first so soot can follow them
  const torchesByPlace = new Map<number, TorchSpec[]>();
  const pilasterSlots = new Map<number, { pos: number; side: Side; clear: boolean }[]>();
  for (const p of places) {
    const slots: { pos: number; side: Side; clear: boolean }[] = [];
    if (p.roof === 'barrel') {
      const a0 = p.axis === 'x' ? p.x0 : p.z0;
      const length = p.axis === 'x' ? p.x1 - p.x0 : p.z1 - p.z0;
      const ribs = Math.max(0, Math.round(length / 3.4) - 1);
      const sides: Side[] = p.axis === 'x' ? ['n', 's'] : ['w', 'e'];
      for (let k = 1; k <= ribs; k++) {
        const pos = a0 + (length * k) / (ribs + 1);
        for (const side of sides) {
          const clear = !holesOn(p, side, 0).some((h) => Math.abs(h.at - pos) < h.w + 0.95);
          slots.push({ pos, side, clear });
        }
      }
    }
    pilasterSlots.set(p.id, slots);

    const list: TorchSpec[] = [];
    if (p.roof !== 'sky') {
      const area = (p.x1 - p.x0) * (p.z1 - p.z0);
      // Torches where the site asks for them; a daylit room gets one only if it is large; a dark room, none.
      const want = p.roof === 'cave' ? 0 : p.light === 'torch' ? (area < 22 ? 1 : area < 50 ? 2 : 3) : p.light === 'day' && area >= 40 ? 1 : 0;
      // Candidates: the front of each free pilaster, else the middle of each wall that has room.
      const candidates: TorchSpec[] = [];
      const inward: Record<Side, Vector3> = { n: V(0, 0, 1), s: V(0, 0, -1), w: V(1, 0, 0), e: V(-1, 0, 0) };
      const onWall = (side: Side, at: number, off: number): TorchSpec => {
        const out = inward[side];
        const base = side === 'n' ? V(at, 0, p.z0) : side === 's' ? V(at, 0, p.z1) : side === 'w' ? V(p.x0, 0, at) : V(p.x1, 0, at);
        return { position: base.addScaledVector(out, off).setY(p.floor + 2.25), out };
      };
      for (const s of slots) if (s.clear) candidates.push(onWall(s.side, s.pos, 0.5));
      // Plain wall: the middle if it is free, and the quarter points, clear of doors and corners.
      for (const side of SIDES) {
        const lo = side === 'n' || side === 's' ? p.x0 : p.z0;
        const len = side === 'n' || side === 's' ? p.x1 - p.x0 : p.z1 - p.z0;
        const holes = holesOn(p, side, 0);
        for (const frac of [0.5, 0.25, 0.75]) {
          const at = lo + len * frac;
          const clear = !holes.some((h) => Math.abs(h.at - at) < h.w + 0.8) && at - lo > 0.7 && lo + len - at > 0.7;
          const taken = slots.some((s) => s.side === side && Math.abs(s.pos - at) < 0.9);
          if (clear && !taken) candidates.push(onWall(side, at, 0.24));
        }
      }
      // No torch on the wall where a stair stands against it.
      for (const w of [...stairsFrom(p), ...stairsInto(p)]) {
        const r = flightRect(w);
        for (let i = candidates.length - 1; i >= 0; i--) { const c = candidates[i].position; if (c.x > r.x0 - 0.5 && c.x < r.x1 + 0.5 && c.z > r.z0 - 0.5 && c.z < r.z1 + 0.5) candidates.splice(i, 1); }
      }
      // Spread them out: take the candidate farthest from those already chosen.
      while (list.length < want && candidates.length) {
        let best = 0, bestScore = -1;
        candidates.forEach((c, i) => {
          const score = list.length ? Math.min(...list.map((t) => t.position.distanceTo(c.position))) : rng.next();
          if (score > bestScore) { bestScore = score; best = i; }
        });
        list.push(candidates.splice(best, 1)[0]);
      }
    }
    torchesByPlace.set(p.id, list);
  }

  const furnishing: Record<string, unknown>[] = [];
  const doors: DoorDesc[] = [];
  const anchors = new Map<number, Vector3>();

  // ------------------------------------------------------------------ places
  const house = places.filter((p) => p.role !== 'approach');
  const houseX0 = Math.min(...house.map((p) => p.x0)) - T / 2;
  const houseX1 = Math.max(...house.map((p) => p.x1)) + T / 2;
  /**
   * The approach: open ground below the house front, which is built into a hillside. Rock rises
   * beside the house to hide its flanks and falls away southwards to a low bank, over which the
   * country beyond can be seen. Rock and turf are one carved surface; level ground is sent to the
   * turf mesh and the rest stays rock. A flagged path runs from the door.
   */
  // ------------------------------------------------------------------ a tower
  /**
   * A tower standing by itself: the first thing here that is seen from outside as well as from
   * within. A house in the hill has only inner faces to its walls. A tower's walls have two,
   * and the outer is made the same way as the inner: as the inner face of a place imagined on
   * the other side of the wall, which is what an outer face is. Inside it is built storey by
   * storey as the house's rooms over rooms are: floors laid round the wells of the stairs,
   * flights in courses of stone against the north and south walls by turns, a rail round each
   * well. It is scenery, not part of what is baked: so it is told which of its stones are indoors.
   */
  const buildTower = (t: NonNullable<Site['towers']>[number], base: number) => {
    const TW = 0.9, STEPS = 18, RISE = STEPS * STEP, TREAD = 0.25, RUN = STEPS * TREAD, WIDE = 1.0;
    const x0 = t.x - t.half, x1 = t.x + t.half, z0 = t.z - t.half, z1 = t.z + t.half;
    const floorY = (storey: number) => base + 0.15 + storey * RISE, roofY = floorY(t.storeys);
    const wasGroup = wild.group, wasField = wild.field;
    wild.group = 'tower';
    wild.field = outdoorFieldAt(base, 0.7);
    const room = (storey: number): Place => ({ id: -1, role: 'passage', roof: 'timber', light: 'day', x0, x1, z0, z1, floor: floorY(storey), wall: RISE - 0.3, axis: 'x', depth: 0, name: 'tower' });
    // The places imagined outside each wall.
    const beyond: Record<Side, Place> = {
      n: { ...room(0), x0: x0 - TW, x1: x1 + TW, z0: z0 - TW - 40, z1: z0 - TW }, s: { ...room(0), x0: x0 - TW, x1: x1 + TW, z0: z1 + TW, z1: z1 + TW + 40 },
      w: { ...room(0), x0: x0 - TW - 40, x1: x0 - TW, z0: z0 - TW, z1: z1 + TW }, e: { ...room(0), x0: x1 + TW, x1: x1 + TW + 40, z0: z0 - TW, z1: z1 + TW },
    };
    // What is cut through the walls: the door, and a slit to each storey above it, east and west.
    const cuts: { side: Side; at: number; w: number; y0: number; ys: number; storey: number }[] = [{ side: t.door, at: t.z, w: 0.75, y0: floorY(0) - 0.1, ys: floorY(0) + 1.95, storey: 0 }];
    cuts.push({ side: flip[t.door], at: t.z + 0.9, w: 0.2, y0: floorY(0) + 1.35, ys: floorY(0) + 2.15, storey: 0 });
    // (The chamber at the top has windows a man can lean in; below it there are only slits.)
    for (let k = 1; k < t.storeys; k++) for (const side of ['e', 'w'] as Side[]) cuts.push({ side, at: t.z + (side === 'e' ? -0.8 : 0.8), w: k === t.storeys - 1 ? 0.42 : 0.22, y0: floorY(k) + (k === t.storeys - 1 ? 0.95 : 1.15), ys: floorY(k) + (k === t.storeys - 1 ? 1.85 : 2.0), storey: k });
    for (const side of SIDES) {
      const out = beyond[side], face = flip[side];
      wild.wallFace('stone', frameOf(out, face, 0), base - 0.7, roofY + 0.02, ashlar, { openings: cuts.filter((c) => c.side === side).map((c) => ({ c: alongFrame(out, face, c.at, 0), w: c.w, y0: c.y0, ys: c.ys })) });
      for (let k = 0; k < t.storeys; k++) {
        // (Each storey's face goes up to meet the next: where a stair's well opens the floor, the wall behind it shows.)
        wild.wallFace('stone', frameOf(room(k), side, 0.1), floorY(k) - 0.1, floorY(k + 1) - 0.1, ashlar, { openings: cuts.filter((c) => c.side === side && c.storey === k).map((c) => ({ c: alongFrame(room(k), side, c.at, 0.1), w: c.w, y0: c.y0, ys: c.ys })) });
      }
    }
    for (const c of cuts) {
      const f = frameOf(room(c.storey), c.side, 0.1), u = alongFrame(room(c.storey), c.side, c.at, 0.1);
      wild.openingTrim('stone', f, { c: u, w: c.w, y0: c.y0, ys: c.ys }, TW, dressed, 'both');
      // A sill through the thickness of the wall: a threshold under the door, a ledge under a slit.
      const sill = wallBox(f, u - c.w - 0.1, u + c.w + 0.1, c.y0 + (c.storey === 0 && c.w > 0.5 ? 0.1 : 0), c.y0 + (c.storey === 0 && c.w > 0.5 ? 0.1 : 0), 0.1, TW + 0.1);
      wild.slab('floor', sill.min.x, sill.min.z, sill.max.x, sill.max.z, sill.min.y, { ...hallFlag, course: [0.7, 0.8], length: [0.9, 1.3] });
    }
    // The stairs: one to a storey, against the north wall going east, then the south going west, and so on up.
    const flights = Array.from({ length: t.storeys }, (_, k) => {
      // (Each begins a stride from one wall, so that it can be walked onto square, and ends most of a stride short of the other: room to step off and turn.)
      const side: Side = k % 2 === 0 ? 'n' : 's', dir = k % 2 === 0 ? 1 : -1, at = dir > 0 ? x0 + 0.95 : x1 - 0.95;
      return { side, dir, at, to: at + dir * RUN, well: strip(room(k), side, at + dir * TREAD, at + dir * RUN, WIDE + 0.06) };
    });
    const whole: Rect = { x0: x0 - 0.1, x1: x1 + 0.1, z0: z0 - 0.1, z1: z1 + 0.1 };
    wild.slab('floor', whole.x0, whole.z0, whole.x1, whole.z1, floorY(0), hallFlag);
    const stepStyle: MasonryStyle = { ...hallFlag, course: [STEP, STEP], length: [0.8, 1.3] };
    flights.forEach((fl, k) => {
      const p = room(k), fr = frameOf(p, fl.side, 0), y = floorY(k), up = floorY(k + 1);
      for (let i = 1; i <= STEPS; i++) {
        const b = wallBox(fr, alongFrame(p, fl.side, fl.at + fl.dir * (i - 1) * TREAD, 0), alongFrame(p, fl.side, fl.to, 0), y + STEP * (i - 1) - (i === 1 ? 0.05 : 0), y + STEP * i, 0, -WIDE);
        wild.box('floor', b.min, b.max, stepStyle, hallFlag, 'step');
      }
      // The floor above, laid round the well: boards within, flags on the roof; and boards under it for a ceiling, on beams.
      for (const r of without(whole, [fl.well])) {
        if (k + 1 < t.storeys) wild.plane('wood', V(r.x0, up, r.z0), V(0, 0, 1), V(1, 0, 0), V(0, 1, 0), r.z1 - r.z0, r.x1 - r.x0, plank);
        else wild.slab('floor', r.x0, r.z0, r.x1, r.z1, up, flag);
        wild.plane('wood', V(r.x0, up - 0.3, r.z0), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), r.x1 - r.x0, r.z1 - r.z0, plank);
      }
      for (let i = 0; i < 5; i++) {
        const z = z0 + ((z1 - z0) * (i + 0.5)) / 5;
        for (const r of without({ x0: x0 - 0.1, x1: x1 + 0.1, z0: z - 0.1, z1: z + 0.1 }, [{ ...fl.well, z0: fl.well.z0 - 0.25, z1: fl.well.z1 + 0.25 }])) {
          if (r.x1 - r.x0 > 0.2 && r.z1 - r.z0 > 0.15) wild.box('wood', V(r.x0, up - 0.55, r.z0), V(r.x1, up - 0.3, r.z1), beam, beam, 'beam');
        }
      }
      // The well: boarded in where the thickness of the floor shows, and railed on its two open sides.
      const zi = fl.side === 'n' ? fl.well.z1 : fl.well.z0, zw = fl.side === 'n' ? fl.well.z0 : fl.well.z1, inward = fl.side === 'n' ? 1 : -1, foot = fl.at + fl.dir * TREAD;
      wild.box('wood', V(fl.well.x0, up - 0.57, Math.min(zi, zi + inward * 0.07)), V(fl.well.x1, up, Math.max(zi, zi + inward * 0.07)), beam, beam, 'trimmer');
      wild.box('wood', V(Math.min(foot, foot - fl.dir * 0.07), up - 0.57, fl.well.z0), V(Math.max(foot, foot - fl.dir * 0.07), up, fl.well.z1), beam, beam, 'trimmer');
      const railed = (ax: number, az: number, bx: number, bz: number) => {
        const posts = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.25) + 1);
        for (let i = 0; i < posts; i++) {
          const x = ax + ((bx - ax) * i) / (posts - 1), z = az + ((bz - az) * i) / (posts - 1);
          wild.box('wood', V(x - 0.05, up - 0.02, z - 0.05), V(x + 0.05, up + 0.98, z + 0.05), beam, beam, 'post');
        }
        for (const [low, high] of [[0.86, 0.95], [0.42, 0.5]]) wild.box('wood', V(Math.min(ax, bx) - 0.04, up + low, Math.min(az, bz) - 0.04), V(Math.max(ax, bx) + 0.04, up + high, Math.max(az, bz) + 0.04), beam, beam, 'rail');
      };
      railed(foot - fl.dir * 0.05, zi + inward * 0.05, fl.to, zi + inward * 0.05);
      railed(foot - fl.dir * 0.05, zw + inward * 0.1, foot - fl.dir * 0.05, zi + inward * 0.05);
      // A torch to each storey, on the wall across from the door.
      hallTorches.push({ position: V(t.door === 'e' ? x0 + 0.24 : x1 - 0.24, y + 2.25, t.z - 1.3), out: V(t.door === 'e' ? 1 : -1, 0, 0) });
    });
    // The roof: a parapet on the walls, breast high, with merlons standing on it.
    const top = roofY + 1.05;
    wild.box('stone', V(x0 - TW, roofY, z0 - TW), V(x1 + TW, top, z0), ashlar, coping, 'parapet');
    wild.box('stone', V(x0 - TW, roofY, z1), V(x1 + TW, top, z1 + TW), ashlar, coping, 'parapet');
    wild.box('stone', V(x0 - TW, roofY, z0), V(x0, top, z1), ashlar, coping, 'parapet');
    wild.box('stone', V(x1, roofY, z0), V(x1 + TW, top, z1), ashlar, coping, 'parapet');
    const span = x1 - x0 + TW * 2, teeth = Math.max(3, Math.round(span / 1.7));
    for (let i = 0; i < teeth; i++) {
      const a = -TW + (span * (i + 0.18)) / teeth, b = -TW + (span * (i + 0.72)) / teeth;
      wild.box('stone', V(x0 + a, top, z0 - TW), V(x0 + b, top + 0.55, z0 - TW + 0.6), ashlar, coping, 'merlon');
      wild.box('stone', V(x0 + a, top, z1 + TW - 0.6), V(x0 + b, top + 0.55, z1 + TW), ashlar, coping, 'merlon');
      wild.box('stone', V(x0 - TW, top, z0 + a), V(x0 - TW + 0.6, top + 0.55, z0 + b), ashlar, coping, 'merlon');
      wild.box('stone', V(x1 + TW - 0.6, top, z0 + a), V(x1 + TW, top + 0.55, z0 + b), ashlar, coping, 'merlon');
    }
    {
      /**
       * What a tower has on its outside besides wall. A plinth, battered out at the foot, with a
       * weathered course on it. A band of dressed stone at every floor. Under the parapet a row
       * of corbels carrying a course that stands out over the wall, as towers were finished so
       * that what was dropped from the top fell clear of the foot. A porch over the door: two
       * posts, a beam and a pent of boards. And a pole with a banner.
       */
      const made = solids((material) => wild.mesh(material));
      const pale: Colour = [0.92 * stoneTint[0], 0.84 * stoneTint[1], 0.7 * stoneTint[2]], grey: Colour = [0.66 * stoneTint[0], 0.6 * stoneTint[1], 0.5 * stoneTint[2]];
      const X0 = x0 - TW, X1 = x1 + TW, Z0 = z0 - TW, Z1 = z1 + TW, doorOut = t.door === 'e' ? 1 : -1;
      // A course all the way round, standing `out` from the wall; left open before the door if it is low enough to bar it.
      const round = (out: number, y0: number, y1: number, colour: Colour) => {
        made.block('stone', V(X0 - out, y0, Z0 - out), V(X1 + out, y1, Z0), colour);
        made.block('stone', V(X0 - out, y0, Z1), V(X1 + out, y1, Z1 + out), colour);
        for (const [xa, xb, side] of [[X0 - out, X0, 'w'], [X1, X1 + out, 'e']] as [number, number, Side][]) {
          if (side === t.door && y0 < floorY(0) + 2.2) {
            made.block('stone', V(xa, y0, Z0), V(xb, y1, t.z - 1.15), colour);
            made.block('stone', V(xa, y0, t.z + 1.15), V(xb, y1, Z1), colour);
          } else made.block('stone', V(xa, y0, Z0), V(xb, y1, Z1), colour);
        }
      };
      round(0.26, base - 0.7, base + 0.75, grey);
      round(0.17, base + 0.75, base + 0.93, grey);
      round(0.08, base + 0.93, base + 1.05, pale);
      for (let k = 1; k < t.storeys; k++) round(0.09, floorY(k) - 0.24, floorY(k) - 0.04, pale);
      round(0.3, roofY - 0.08, roofY + 0.2, pale);
      round(0.12, roofY - 0.2, roofY - 0.08, pale);
      for (let a = X0 + 0.25; a < X1 - 0.2; a += 0.74) {
        for (const [za, zb] of [[Z0 - 0.26, Z0], [Z1, Z1 + 0.26]]) { made.block('stone', V(a, roofY - 0.5, za), V(a + 0.3, roofY - 0.2, zb), pale); made.block('stone', V(a + 0.04, roofY - 0.72, za === Z1 ? za : zb - 0.14), V(a + 0.26, roofY - 0.5, za === Z1 ? za + 0.14 : zb), pale); }
        const c = a - X0 + Z0;
        for (const [xa, xb] of [[X0 - 0.26, X0], [X1, X1 + 0.26]]) { made.block('stone', V(xa, roofY - 0.5, c), V(xb, roofY - 0.2, c + 0.3), pale); made.block('stone', V(xa === X1 ? xa : xb - 0.14, roofY - 0.72, c + 0.04), V(xa === X1 ? xa + 0.14 : xb, roofY - 0.5, c + 0.26), pale); }
      }
      // The porch.
      const oak: Colour = [0.24, 0.16, 0.1], wallX = t.door === 'e' ? X1 : X0, far = wallX + doorOut * 1.7;
      for (const z of [t.z - 1.25, t.z + 1.25]) {
        made.block('stone', V(far - 0.16, base - 0.2, z - 0.16), V(far + 0.16, base + 0.22, z + 0.16), grey);
        made.block('wood', V(far - 0.08, base + 0.22, z - 0.08), V(far + 0.08, base + 2.42, z + 0.08), oak, true);
        made.stick(V(far, base + 1.75, z), V(far, base + 2.4, z - Math.sign(z - t.z) * 0.6), 0.09, 0.09, oak);
        made.stick(V(wallX + doorOut * 0.02, base + 2.95, z), V(far + doorOut * 0.3, base + 2.42, z), 0.1, 0.12, oak);
      }
      made.block('wood', V(far - 0.09, base + 2.3, t.z - 1.45), V(far + 0.09, base + 2.46, t.z + 1.45), oak, true);
      made.slope([V(far + doorOut * 0.45, base + 2.42, t.z - 1.6), V(far + doorOut * 0.45, base + 2.42, t.z + 1.6), V(wallX, base + 3.1, t.z + 1.6), V(wallX, base + 3.1, t.z - 1.6)], ['wood', [0.3, 0.22, 0.15]], oak, 0.05);
      // Two steps up to the door.
      made.block('stone', V(Math.min(wallX, wallX + doorOut * 0.75), base - 0.3, t.z - 1.0), V(Math.max(wallX, wallX + doorOut * 0.75), base + 0.08, t.z + 1.0), pale);
      made.block('stone', V(Math.min(wallX, wallX + doorOut * 1.15), base - 0.3, t.z - 1.25), V(Math.max(wallX, wallX + doorOut * 1.15), base - 0.04, t.z + 1.25), grey);
      // The pole and its banner, on the corner over the door.
      const px = t.door === 'e' ? X1 - 0.3 : X0 + 0.3, pz = Z0 + 0.3, tall = top + 0.55;
      made.block('wood', V(px - 0.04, tall, pz - 0.04), V(px + 0.04, tall + 3.6, pz + 0.04), oak, true);
      made.block('leaf', V(px + 0.04, tall + 2.5, pz - 0.012), V(px + 1.5, tall + 3.5, pz + 0.012), [0.5, 0.06, 0.07]);
      made.block('leaf', V(px + 0.04, tall + 2.86, pz - 0.016), V(px + 1.5, tall + 3.14, pz + 0.016), [0.75, 0.62, 0.2]);
    }
    finds.push({ at: V(t.x - 1.2, roofY + 0.35, t.z + 1.4), what: 'a hunting horn bound with silver, left on the roof of the tower' });
    lookouts.push({ x: t.x, y: roofY + 1.2, z: t.z, height: roofY - base });
    wild.group = wasGroup;
    wild.field = wasField;
    // Which of its stones are indoors, and so see no sky and take no sun: everything inside its walls and under its roof.
    for (const [key, mesh] of wild.meshes) {
      if (!key.startsWith('tower|')) continue;
      mesh.setOpenBy((x, y, z) => (x > x0 - 0.06 && x < x1 + 0.06 && z > z0 - 0.06 && z < z1 + 0.06 && y < roofY - 0.1 ? 0 : 1));
      // Moss and damp have come up the outside of the walls from the ground, and under the course that stands out at the top the rain has left the wall dark.
      const outsideOf = (x: number, z: number) => x < x0 - TW + 0.12 || x > x1 + TW - 0.12 || z < z0 - TW + 0.12 || z > z1 + TW - 0.12;
      if (!key.endsWith('|stone')) continue;
      mesh.setField(0, (x, y, z) => (outsideOf(x, z) && y < base + 2.2 ? 0.85 * Math.max(0, 1 - (y - base + 0.3) / 2.2) : undefined));
      mesh.setField(1, (x, y, z) => (outsideOf(x, z) ? Math.max(0.5 * Math.max(0, 1 - (y - base) / 1.5), 0.45 * Math.max(0, 1 - (roofY - 0.2 - y) / 1.6) * (y < roofY - 0.2 ? 1 : 0)) : undefined));
    }
  };

  const buildApproach = (p: Place) => {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const doorway = holesOn(p, 'n', 0)[0];
    const doorX = doorway ? doorway.at : (p.x0 + p.x1) / 2;
    // (A house that stands free has a front no broader than itself; one built into the hill has one as broad as the forecourt, with the hill either side.)
    const fx0 = free ? Math.max(p.x0 - 0.2, Math.min(...outerRects.map((r) => r.x0))) : p.x0 - 0.2, fx1 = free ? Math.min(p.x1 + 0.2, Math.max(...outerRects.map((r) => r.x1))) : p.x1 + 0.2;
    if (delve) {
      // The portal: a face of dressed stone in the recess cut for it, with the door, a moulded head over it, and the rock all round.
      const px0 = doorX - 2.1, px1 = doorX + 2.1, top = p.floor + 4.2;
      kit.wallFace('stone', kit.frame(px0, p.z0, px1, p.z0), p.floor - 0.7, top, ashlar, { openings: holesOn(p, 'n', 0).map((h) => ({ ...h, c: h.at - px0 })) });
      kit.box('stone', V(px0 - 0.12, top - 0.05, p.z0 - 0.3), V(px1 + 0.12, top + 0.3, p.z0 + 0.22), coping, coping, 'portalhead');
      for (const x of [px0, px1 - 0.42]) kit.box('stone', V(x, p.floor - 0.2, p.z0 - 0.1), V(x + 0.42, top - 0.05, p.z0 + 0.14), dressed, dressed, 'portaljamb');
    } else {
      const front = kit.frame(fx0, p.z0, fx1, p.z0);
      kit.wallFace('stone', front, p.floor - 0.7, site.top, ashlar, { openings: holesOn(p, 'n', 0).map((h) => ({ ...h, c: h.at - fx0 })) });
    }

    const r = rng.fork('approach');
    const plant = rng.fork('planting');
    const s1 = r.range(0, 60), s2 = r.range(0, 60);
    const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
    // The open country that can be walked: the meadow before the door and the valley round it.
    const g = site.grounds ?? { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 };
    const cxA = (p.x0 + p.x1) / 2, czA = (p.z0 + p.z1) / 2;
    // Its shape: how far any point is from the nearer of its two sides (less than nothing outside them). Worked out once over the
    // valley and a little beyond, and read from that; further off, worked out as wanted. A site with no shape recorded is a box.
    const vale = site.grounds ? site.valley ?? boxValley(site.grounds) : null;
    const reachOf = vale ? new Grid2(g.x0 - 60, g.z0 - 30, 0.75, Math.ceil((g.x1 - g.x0 + 120) / 0.75) + 1, Math.ceil((g.z1 - g.z0 + 110) / 0.75) + 1).fill((x, z) => insideOf(vale, x, z)) : null;
    const insideAt = (x: number, z: number): number => (!vale ? Math.min(x - g.x0, g.x1 - x, g.z1 - z) : reachOf!.holds(x, z) ? reachOf!.at(x, z) : insideOf(vale, x, z));
    // How far a point is from the nearest footpath (and no more than eight metres), worked out once on a lattice over the valley.
    const footways = site.grounds ? site.paths ?? [] : [];
    const footGrid = footways.length ? new Grid2(g.x0 - 10, g.z0 - 10, 0.5, Math.ceil((g.x1 - g.x0 + 20) / 0.5) + 1, Math.ceil((g.z1 - g.z0 + 20) / 0.5) + 1).fill((x, z) => {
      let best = 8;
      for (const f of footways) for (let k = 0; k < f.points.length - 1; k++) {
        const [ax, az] = f.points[k], [bx, bz] = f.points[k + 1];
        if (Math.min(ax, bx) - best > x || Math.max(ax, bx) + best < x || Math.min(az, bz) - best > z || Math.max(az, bz) + best < z) continue;
        const dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return best;
    }) : null;
    /** How far a point is from the nearest footpath's middle. */
    const offFoot = (x: number, z: number) => (footGrid && footGrid.holds(x, z) ? footGrid.at(x, z) : 8);
    /** Where a side of the valley lies at `z`, and how far in from it a point is, measured square to it. */
    const sideAt = (side: 'w' | 'e', z: number) => (vale ? edgeAt(vale, side, z) : side === 'w' ? g.x0 : g.x1);
    const fromSide = (side: 'w' | 'e', x: number, z: number) => (side === 'w' ? x - sideAt('w', z) : sideAt('e', z) - x) / (vale ? Math.hypot(1, slantAt(vale, side, z)) : 1);
    /** Whether a point is in the valley, with `m` metres to spare, and not beyond the gap at its foot. */
    const inValley = (x: number, z: number, m: number) => z > g.z0 && z < (vale ? vale.mouth - m * 0.5 : g.z1 - m) && insideAt(x, z) > m;
    const houseZ0 = Math.min(...house.map((q) => q.z0)) - T;
    const frontZ = p.z0 - 0.35;
    const pathHalf = 1.15;
    // The way in: flags from the door across the meadow, then a worn track that wanders off down the valley.
    const knots = site.track ?? [[doorX, p.z0], [doorX, p.z1]];
    const pathAt = (z: number): number => {
      // A smooth curve through the track's points, with a slight wander of its own near the door.
      const n = knots.length;
      let k = 0;
      while (k < n - 2 && z > knots[k + 1][1]) k++;
      const t = Math.min(1, Math.max(0, (z - knots[k][1]) / (knots[k + 1][1] - knots[k][1])));
      const a = knots[Math.max(0, k - 1)][0], b = knots[k][0], c = knots[k + 1][0], d = knots[Math.min(n - 1, k + 2)][0];
      const x = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      return x + Math.sin(z * 0.23 + s1) * 0.6 * Math.min(1, Math.max(0, z - p.z0) / 5);
    };
    /**
     * The height of the ground anywhere. One function serves the carved meadow and the sheets laid
     * beyond it, so they meet. It is made of: gentle swells, level by the path and the door; the
     * escarpment the house is built into, a cliff beside the house and a hillside behind; a rim
     * of rock round the valley, too steep to climb; and beyond that, hills.
     */
    const escarpment = (x: number, z: number, wobble: number): number => {
      if (z < frontZ) return 1;
      const beside = delve ? 1 : Math.max(smooth((p.x0 + 2 + wobble * 0.5 - x) / 1.3), smooth((x - (p.x1 - 2 - wobble * 0.5)) / 1.3));
      return beside * (1 - smooth((z - p.z0 - 0.7 - Math.max(0, wobble)) / 2.4));
    };
    const wobbleAt = (x: number, z: number) => (fbm2(x * 0.3 + s2 + 20, z * 0.3 + s1, 3) - 0.5) * 3.2;
    const keepShelf = site.grounds ? (site.terraces ?? []).find((t) => t.keep) : undefined;
    const swells = (x: number, z: number): number => {
      const fromPath = Math.max(0, Math.abs(x - pathAt(z)) - pathHalf);
      // (Level on the promontory a keep stands on, as a castle's court would be; swelling elsewhere as it always did.)
      // (Fading in over some metres, so that the ledge coming up to it meets it without a step.)
      const level = !keepShelf ? 1 : Math.max(smooth((Math.abs(z - (keepShelf.z0 + keepShelf.z1) / 2) - (keepShelf.z1 - keepShelf.z0) / 2 + 2) / 9), smooth((fromSide(keepShelf.side, x, z) - 4.7 - keepShelf.depth + 1) / 6));
      // (A valley that was found: its floor is the land, held at the meadow's level about the house and following the land further
      // down; not tilted across the track, which keeps the level the land has under its middle.)
      if (vale?.terrain) {
        const land = valleyLand(vale, p.floor, p, x, z), mid = valleyLand(vale, p.floor, p, pathAt(z), z), floor = land + (mid - land) * (1 - Math.min(1, fromPath / 6));
        return p.floor - 0.03 + (floor - p.floor) * smooth((z - p.z1 - 2) / 30) * level;
      }
      return p.floor - 0.03 + (fbm2(x * 0.035 + s2, z * 0.035 + s1, 3) - 0.5) * 5.5 * Math.min(1, fromPath / 9) * smooth((z - p.z0 - 4) / 14) * level;
    };
    // The ground is levelled where something lies on it: hollowed for a pond, raised a little for the stones.
    const lies = (site.features ?? []).map((f) => ({ ...f, base: swells(f.x, f.z) }));
    // A tower stands on ground that was levelled for it.
    // (The keep's tower stands on its promontory: built at the shelf's height, though the ground under it is levelled before the shelf is raised.)
    const towers = (site.grounds ? site.towers ?? [] : []).map((t, i) => { const lift = keepShelf && i === 0 && site.keep ? keepShelf.height : 0; return { ...t, base: swells(t.x, t.z) + lift, lift }; });
    // So does a building; `hx` and `hz` are half its ground across the valley and along it, with what overhangs.
    const houses = (site.grounds ? site.buildings ?? [] : []).map((b) => ({ ...b, base: swells(b.x, b.z), hx: b.d / 2 + (b.style === 'imperial' ? 2.0 : 0.6), hz: b.w / 2 + 0.5, rects: footprintOf(b) }));
    // Whether a point is under a building, within its outer walls.
    // Whether a point is under a building, within its outer walls (wings and all).
    const footprint = (b: (typeof houses)[number], x: number, z: number) => {
      const turn = b.faces === 'w' ? 1 : -1, u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
      return b.rects.some((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1);
    };
    // (With room about it: half a metre, and before a classical building's door the depth of its steps.)
    const outside = (b: (typeof houses)[number], x: number, z: number) => {
      const turn = b.faces === 'w' ? 1 : -1, u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
      return Math.min(...b.rects.map((r, i) => Math.max(r.u0 - u, u - r.u1, (i === 0 && b.style === 'imperial' ? r.v0 - 1.45 : r.v0) - v, v - r.v1))) - 0.55;
    };
    // What is open to the sky in the hill above the house: courts, rooms that have lost their roofs, and the mouths of shafts.
    const openings = [...house.filter((q) => q.roof === 'sky').map((q) => ({ x0: q.x0, x1: q.x1, z0: q.z0, z1: q.z1 })), ...skylights];
    const pondList = lies.filter((f) => f.kind === 'pond');
    // How far out a point lies in a pond's hollow: 0 at its middle, 1 at its edge, whatever its shape.
    const across = (f: (typeof lies)[number], x: number, z: number) => Math.hypot(x - f.x, z - f.z) / shoreOf(f, x - f.x, z - f.z);
    // How deep the hollow is: a pool is a paddle, a lake is over your head.
    const hollow = (f: (typeof lies)[number]) => Math.min(2.8, Math.max(1, 0.75 + 0.13 * f.r));
    /**
     * Running water, as the ground knows it: a line of points down which a bed has been cut. The
     * height of the bed at each point is in `bed`, and falls all the way: see where they are made.
     */
    interface Channel { x: number[]; z: number[]; bed: number[]; half: number; depth: number; x0: number; x1: number; z0: number; z1: number; of: NonNullable<Site['streams']>[number]; fall?: Notch }
    const channels: Channel[] = [];
    /**
     * Where water comes over the rim. `x` and `z` are the lip, where the top of the wall breaks;
     * `out` is which way is out of the valley there (along x); `back` is how far the lip lies
     * from where the stream begins at the foot. A notch is worn in the top of the wall for the
     * water to come through, and the face under it is worn smooth.
     */
    interface Notch { x: number; z: number; out: number; half: number; depth: number; back: number }
    const notches: Notch[] = [];
    /**
     * Grottoes: caves in the valley's side walls. The land is carved from heights, which cannot
     * say "hollow"; so a grotto is given as air of its own, and wherever the land is carved the
     * two are taken together: what is air in either is air. A passage goes in at the foot of
     * the wall, bending a little, and opens into a chamber under the hill.
     */
    const grottoes = (site.grounds ? site.grottoes ?? [] : []).map((q, k) => {
      const seeds = rng.fork(`grotto${k}`);
      // (For a hall: where its stair begins, measured as everything in a grotto is, going out of the valley from seven metres inside its edge; how far the stair runs; and where the hall itself begins.)
      const stair0 = 3.9, run = q.hall ? q.hall.drop / 0.5 : 0, hall0 = stair0 + run + 1.6;
      // (And, if a passage goes on from it to the cavern, where its door onward is: see `hallOnward`.)
      const js = site.backWay?.deep?.join?.toward, on = q.hall && k === 0 && js !== undefined && vale ? { ...hallOnward(vale, q, js), s: js } : null;
      return { ...q, on, inw: q.side === 'w' ? 1 : -1, edge: sideAt(q.side, q.z), y0: NaN, far: 7 + q.r - 0.3, bend: seeds.range(-1, 1), n1: seeds.range(0, 50), n2: seeds.range(0, 50), stair0, run, hall0, gs: q.hall?.great?.gallery === 's' ? 1 : -1 };
    });
    /**
     * The air of a hewn hall, at a point given as the grotto's own measures: `t` going out of
     * the valley, `off` to one side of its middle line, `y` up. Nothing in it is rounded: it
     * was cut with tools, to a line. A doorway and a passage; a stair down; then the hall, with a
     * roof that rises to a crown along its middle, two rows of square pillars with spreading
     * heads and feet, and at the far end a dais three steps high with a tomb on it.
     */
    // How far along a hall's way in the land's own carving is kept: beyond this the stair is too deep for it.
    const UNDER_FROM = 6.7;
    const pillarsOf = (q: (typeof grottoes)[number]): [number, number][] => {
      const h = q.hall!, out: [number, number][] = [];
      for (let u = 3.4; u < h.length - 6.5; u += 4.4) for (const v of [-h.width * 0.27, h.width * 0.27]) out.push([u, v]);
      return out;
    };
    const hallFloor = (q: (typeof grottoes)[number], t: number): number => {
      const h = q.hall!, u = t - q.hall0;
      if (u < 0) return q.y0 + 0.24 * Math.max(0, 2.6 - t) - h.drop * Math.min(1, Math.max(0, (t - q.stair0) / q.run));
      return q.y0 - h.drop + (u > h.length - 5.6 ? 0.51 : 0);
    };
    /**
     * A great hall. Everything in it is measured as in any hall, with two things more: `yy`,
     * the height above its floor, and `o`, how far a point lies from the middle line towards the
     * side the gallery is on. The stair from the valley comes out on a ledge across the near
     * end, `deep` above the floor. On the gallery's side the wall of the hall is a screen with
     * arched openings in two tiers, a gallery behind the upper and an aisle behind the lower;
     * along the other wall a stair goes down from the ledge. Pillars stand in two rows the
     * whole height of it. A chasm crosses the floor, with a strip along its far side that
     * climbs out of it; a bridge crosses it at the floor and another at the gallery's level,
     * which ends at a door into a room cut in the far wall. A shaft in the roof lets the day in.
     */
    // (`foot` is the level bottom left at the foot of the steps out of the chasm, so that they can be walked onto.)
    const GREAT = { ledge: 6, gal: 3.4, screen: 0.9, bay: 3.65, stair: 3, pitch: 7.3, strip: 1.5, foot: 1.4 };
    // One tier of what lies behind the screen: a passage along the wall, and the arched openings into it.
    const tierAir = (a: number, o: number, yy: number, u: number, du: number, face: number, back: number, half: number, fy: number, from: number, to: number): number =>
      Math.max(a, Math.min(o - back, half - o, yy - fy, fy + 3.5 - yy, u - from, to - u), Math.min(1.3 - du, o - (face - 0.5), back + 0.5 - o, yy - fy, fy + 3.2 - 0.8 * (du / 1.3) ** 2 - yy, u - from - 0.6, to - 0.6 - u));
    const greatPillars = (q: (typeof grottoes)[number]): [number, number][] => {
      // (They stand opposite every other pier of the screen, counted both ways from the upper bridge, and well back from the chasm.)
      const h = q.hall!, c = h.great!.chasm, out: [number, number][] = [], clear = GREAT.bay * 2.5 - c.width / 2;
      for (const v of [-h.width * 0.27, h.width * 0.27]) {
        for (let u = c.at - clear; u > GREAT.ledge + 2.5; u -= GREAT.pitch) out.push([u, v]);
        for (let u = c.at + c.width + clear; u < h.length - 7; u += GREAT.pitch) out.push([u, v]);
      }
      return out;
    };
    /**
     * Where the day comes into a great hall: a round shaft through the roof, leaning towards the
     * sun so that its light lands where the lower bridge begins. `u`, `off` and `yy` are where
     * its middle line meets the roof; `du`, `dv` and `dy` are the way up it, towards the sun.
     * The sun is taken no lower than about fifty degrees (a shaft cut flatter than that would
     * light nothing but its own side), and steeper still if the shaft would otherwise come out
     * beyond the hall.
     */
    const shaftOf = (q: (typeof grottoes)[number]) => {
      const h = q.hall!, gr = h.great!, half = h.width / 2;
      const land = { u: gr.chasm.at - 2.4, off: 0 };
      let du = -q.inw * site.sun[0], dv = site.sun[2];
      const flat = Math.hypot(du, dv) || 1, lean = Math.min(0.78, flat / Math.max(0.05, site.sun[1]));
      du = (du / flat) * lean; dv = (dv / flat) * lean;
      // (Per metre climbed, how far it goes along and across. Kept inside the roof, and off the screen.)
      let top = { u: land.u + du * h.height * 0.95, off: land.off + dv * h.height * 0.95 };
      top = { u: Math.min(h.length - 6, Math.max(7, top.u)), off: Math.min(half - 7, Math.max(-(half - 7), top.off)) };
      const yy = h.height * (0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - (top.off / half) ** 2)));
      const len = Math.hypot(top.u - land.u, top.off - land.off, yy);
      return { u: top.u, off: top.off, yy, du: (top.u - land.u) / len, dv: (top.off - land.off) / len, dy: yy / len, r: 3, land };
    };
    const shaftFor = new Map<(typeof grottoes)[number], ReturnType<typeof shaftOf>>();
    for (const q of grottoes) if (q.hall?.great) shaftFor.set(q, shaftOf(q));
    const greatAir = (q: (typeof grottoes)[number], t: number, off: number, y: number): number => {
      const h = q.hall!, gr = h.great!, c = gr.chasm, u = t - q.hall0, half = h.width / 2, G = gr.deep, L = h.length, H = h.height;
      const yl = q.y0 - h.drop, yy = y - (yl - G), o = off * q.gs, face = half - GREAT.gal;
      // The way in, as to any hall; but it comes out on the ledge.
      const pf = q.y0 + 0.24 * Math.max(0, 2.6 - t) - h.drop * Math.min(1, Math.max(0, (t - q.stair0) / q.run));
      const air = Math.min(1.35 - Math.abs(off), y - pf, pf + 3.3 - y, t + 0.4, q.hall0 + 0.6 - t);
      if (u < -0.8 || u > L + 0.8) return air;
      const crown = H * (0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - (off / half) ** 2)));
      let a = Math.min(u, L - u, o + half, face - o, yy, crown - yy);
      // The ledge across the near end; the stair down from it along one wall; the dais at the far end.
      a = Math.min(a, Math.max(u - GREAT.ledge, yy - G));
      a = Math.min(a, Math.max(o + half - GREAT.stair, (yy - Math.min(G, G - (u - GREAT.ledge) / 2)) * 0.894));
      a = Math.min(a, Math.max(L - 5.6 - u, yy - 0.51));
      if (a > -1.2) {
        // The nearest pillar: they are counted outwards from the chasm, both ways.
        const c1 = c.at + c.width, near = u < c.at + c.width / 2, clear = GREAT.bay * 2.5 - c.width / 2, first = near ? c.at - clear : c1 + clear;
        const k = Math.max(0, Math.round((near ? first - u : u - first) / GREAT.pitch)), pu = near ? first - k * GREAT.pitch : first + k * GREAT.pitch;
        const pv = (off < 0 ? -1 : 1) * h.width * 0.27, d = Math.max(Math.abs(u - pu), Math.abs(off - pv));
        if ((near ? pu > GREAT.ledge + 2.5 : pu < L - 7) && d < 2.6) {
          // Square in the shaft; a band where the gallery's floor is; spreading wide under the roof, and a little at the foot.
          const top = H * 0.953;
          a = Math.min(a, d - (1.1 + 0.85 * smooth((yy - (top - 5)) / 2.8) + 0.36 * (1 - smooth((yy - 0.05) / 0.8)) + 0.2 * Math.min(1, Math.max(0, (0.5 - Math.abs(yy - G)) / 0.14))));
        }
        // The tomb, on the dais.
        a = Math.min(a, Math.max(Math.abs(u - (L - 2.7)) - 0.8, Math.abs(off) - 1.5, yy - (0.51 + 1.25)));
      }
      {
        // The chasm; and along its far side a strip whose floor climbs from the bottom to the hall's floor.
        const c1 = c.at + c.width, oA = face - GREAT.foot, ramp = Math.min(0, Math.max(-c.depth, -c.depth + (oA - o) / 2));
        a = Math.max(a, Math.min(u - c.at, c1 - GREAT.strip - u, yy + c.depth, o + half, face - o, 1.5 - yy));
        a = Math.max(a, Math.min(u - (c1 - GREAT.strip - 0.1), c1 - u, (yy - ramp) * 0.894, o + half, face - o, 1.5 - yy));
        // The bridge at the floor: level on top, arched beneath, thinnest at the middle.
        const uc = c.at + c.width / 2, x = (u - uc) / (c.width / 2);
        a = Math.min(a, Math.max(Math.abs(off) - 1.5, yy, -0.8 - 1.7 * x * x - yy));
        // The bridge above: from the gallery to the far wall, right over the chasm.
        const xo = (o - (face - half) / 2) / ((face + half) / 2);
        a = Math.min(a, Math.max(Math.abs(u - uc) - 1.3, yy - G, G - 1.0 - 3.2 * xo * xo - yy));
        // Behind the screen: the gallery, and the aisle under it; and the openings through to both, a bay apart, arched.
        const du = Math.abs(u - uc - GREAT.bay * Math.round((u - uc) / GREAT.bay)), back = face + GREAT.screen;
        a = tierAir(a, o, yy, u, du, face, back, half, G, 0.6, L - 2);
        a = tierAir(a, o, yy, u, du, face, back, half, 0, GREAT.ledge + 1.2, L - 6.4);
        // The door at the far end of the upper bridge, and the room behind it.
        a = Math.max(a, Math.min(1.2 - Math.abs(u - uc), -half + 0.3 - o, o + half + 1.7, yy - G, G + 3.0 - yy));
        a = Math.max(a, Math.min(3.2 - Math.abs(u - uc), -half - 1.5 - o, o + half + 8, yy - G, G + 3.8 - yy));
        // And, if a passage goes on from it, the door in that room's far wall.
        if (q.on) a = Math.max(a, Math.min(1.1 - Math.abs(u - uc), -half - 7.7 - o, o + q.on.end, yy - G, G + 2.6 - yy));
      }
      // The shaft that lets the day in.
      const sh = shaftFor.get(q)!;
      if (yy > sh.yy - 3) {
        const up = (yy - sh.yy) / sh.dy;
        a = Math.max(a, Math.min((sh.r - Math.hypot(u - sh.u - sh.du * up, off - sh.off - sh.dv * up)) * sh.dy, yy - (sh.yy - 2.5)));
      }
      return Math.max(air, a);
    };
    const hallAir = (q: (typeof grottoes)[number], t: number, off: number, y: number): number => {
      if (q.hall!.great) return greatAir(q, t, off, y);
      const h = q.hall!, u = t - q.hall0, floor = hallFloor(q, t);
      // The way in: a doorway's breadth, and half as high again as a man.
      let air = Math.min(1.35 - Math.abs(off), y - floor, floor + 3.3 - y, t + 0.4, q.hall0 + 0.6 - t);
      if (u > -0.7 && u < h.length + 0.7) {
        const half = h.width / 2, crown = floor + h.height * (0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - (off / half) ** 2))) - (u > h.length - 5.6 ? 0.51 : 0);
        let a = Math.min(u, h.length - u, half - Math.abs(off), y - floor, crown - y);
        if (a > -1) {
          // The nearest pillar, found by counting along the row and not by trying them all.
          const k = Math.round((u - 3.4) / 4.4), pu = 3.4 + k * 4.4, pv = (off < 0 ? -1 : 1) * h.width * 0.27;
          const d = Math.max(Math.abs(u - pu), Math.abs(off - pv));
          if (k >= 0 && pu < h.length - 6.5 && d < 1.6) {
            // Square in the shaft; spreading out under the roof, and a little at the foot.
            const top = q.y0 - h.drop + h.height * 0.74;
            a = Math.min(a, d - (0.62 + 0.42 * smooth((y - (top - 1.3)) / 1.2) + 0.2 * (1 - smooth((y - floor - 0.05) / 0.45))));
          }
          // The tomb: a block as long as a man, across the hall, on the dais.
          const tu = h.length - 2.7;
          a = Math.min(a, Math.max(Math.abs(u - tu) - 0.62, Math.abs(off) - 1.15, y - (floor + 1.0)));
        }
        // The door onward: a plain squared doorway through the side wall.
        if (q.on) a = Math.max(a, Math.min(1.1 - Math.abs(u - q.on.u), off * q.on.s - (half - 0.4), q.on.end - off * q.on.s, y - floor, floor + 2.6 - y));
        air = Math.max(air, a);
      }
      return air;
    };
    /**
     * The air of a mine, measured as a hall's is. An adit a little over two metres broad and high, its roof cut to a
     * slight arch, driven level into the hill; a crosscut off one side of it, lower, that was given up; and at the end the
     * working, where the lode was followed: broader and higher, its roof uneven, the ground at the back left standing in two steps.
     */
    const mineAir = (q: (typeof grottoes)[number], t: number, off: number, y: number): number => {
      const m = q.mine!, floor = q.y0 + 0.24 * Math.max(0, 2.6 - t), end = 7 + m.length;
      let a = Math.min(1.15 - Math.abs(off), y - floor, floor + 2.32 - 0.2 * (off / 1.15) ** 2 - y, t + 0.4, end + 0.5 - t);
      const so = off * m.cross.side;
      a = Math.max(a, Math.min(0.9 - Math.abs(t - 7 - m.cross.at), so + 0.5, m.cross.length - so, y - floor, floor + 2.05 - y));
      const u = t - end;
      if (u > -1.5) {
        const wide = 2.7 + 0.5 * (fbm2(t * 0.8 + q.n1, y * 0.6, 2) - 0.5) * 2, roof = floor + 3.0 + 0.6 * (fbm2(t * 0.9 + q.n2, off * 0.9, 2) - 0.5) * 2;
        a = Math.max(a, Math.min(u + 0.3, 5.4 - u, wide - Math.abs(off), y - floor - (u > 3.5 ? 0.64 : u > 2.4 ? 0.32 : 0), roof - y));
      }
      return a;
    };
    // How far into a grotto a point is: less than nothing outside it; 0 at its mouth; 1 well inside.
    let grottoDeep = 0;
    const grottoAir = (x: number, y: number, z: number): number => {
      let air = -Infinity;
      for (const q of grottoes) {
        const inside = (x - q.edge) * q.inw, t = 7 - inside, off = z - q.z;
        if (q.mine) {
          // A mine: only the mouth of its adit lies in the rock that is carved with the land.
          if (t < -0.5 || t > UNDER_FROM + 1.3 || Math.abs(off) > 2.2 || y > q.y0 + 5 || y < q.y0 - 1) continue;
          const a = mineAir(q, t, off, y);
          if (a > air) { air = a; grottoDeep = smooth((t - 2.6) / 3.2); }
          continue;
        }
        if (q.hall) {
          // A hall: only its doorway and the head of its stair lie in the rock that is carved with the land.
          if (t < -0.5 || t > q.hall0 + 1 || Math.abs(off) > 2.2 || y > q.y0 + 5 || y < q.y0 - q.hall.drop - 1) continue;
          const a = hallAir(q, t, off, y);
          if (a > air) { air = a; grottoDeep = smooth((t - 2.6) / 3.2); }
          continue;
        }
        if (t < -0.5 || t > q.far + q.r + 1.5 || Math.abs(off) > q.r * 1.25 + 2.2 || y > q.y0 + 5.5 || y < q.y0 - 2) continue;
        // The passage: a stride and a half wide, a little over a man's height, its floor falling gently inwards.
        const along = Math.min(1, Math.max(0, t / q.far)), side = off - q.bend * 0.55 * Math.sin(along * Math.PI);
        // (Before the mouth it rises again, so that where the ground outside stands higher the way in is a ramp and not a step.)
        const floor = q.y0 - 0.045 * Math.max(0, t - 2) + 0.24 * Math.max(0, 2.6 - t) + (fbm2(x * 1.1 + q.n1, z * 1.1, 2) - 0.5) * 0.1;
        const wide = 0.95 + (fbm2(t * 0.8 + q.n1, y * 0.7, 2) - 0.5) * 0.45, high = 2.25 + (fbm2(x * 0.7 + q.n2, z * 0.7, 2) - 0.5) * 0.6;
        let a = Math.min(smin(smin(wide - Math.abs(side), y - floor, 0.3), floor + high - y, 0.4), t + 0.4, q.far + 0.8 - t);
        // The chamber: an uneven dome over a rough oval floor.
        const e = (1 - Math.hypot((t - q.far) / q.r, off / (q.r * 1.2))) * q.r + (fbm2(x * 0.55 + q.n2, z * 0.55 + q.n1, 3) - 0.5) * 1.1 + (fbm2(x * 1.8 + y * 1.1 + q.n1, z * 1.8 - y * 0.8, 2) - 0.5) * 0.4;
        const ceil = floor + 1.5 + 2.1 * Math.pow(Math.min(1, Math.max(0, e / q.r)), 0.55) + (fbm2(x * 0.6 + q.n1 + 9, z * 0.6 + q.n2, 2) - 0.5) * 0.7;
        a = Math.max(a, smin(smin(e, y - floor, 0.35), ceil - y, 0.5));
        // Whatever the noise does, it stays inside the rock that is carved.
        a = Math.min(a, inside + 4.75);
        if (a > air) { air = a; grottoDeep = smooth((t - 2.6) / 3.2); }
      }
      return air;
    };
    /**
     * Terraces: shelves against the valley's side walls, each with a ledge rising to it along
     * the wall. `shelfAt` gives, for a terrace and a point, how much the ground is raised there
     * (`lift`) and whether the point is on the way up or on the shelf itself (`way`: 1 on it,
     * falling to 0 a stride outside).
     */
    const terraces = site.grounds ? site.terraces ?? [] : [];
    const shelf = { lift: 0, way: 0, top: 0 };
    const shelfAt = (t: (typeof terraces)[number], x: number, z: number): boolean => {
      const inside = fromSide(t.side, x, z);
      // Along the valley: how far beyond the level part towards the way up, and how far beyond its other end.
      const up = t.rise === 'n' ? t.z0 - z : z - t.z1, past = t.rise === 'n' ? z - t.z1 : t.z0 - z;
      if (inside > 4.7 + t.depth + 4 || inside < -7 || up > t.run + 3 || past > 4) return false;
      // The way up rises evenly from the valley floor to the shelf; the other end drops off.
      const high = t.height * (up <= 0 ? 1 : Math.max(0, 1 - up / t.run)) * (1 - smooth(past / 1.4));
      // The shelf has all its depth where it is level, and a path's width on the way up.
      const wide = 2.9 + (t.depth - 2.9) * (1 - smooth(up / 3.5));
      const front = 4.7 + wide + (fbm2(z * 0.23 + s1, s2 + 3.3, 2) - 0.5) * (up <= 0 ? 1.7 : 0.4);
      shelf.lift = high * (1 - smooth((inside - front) / 1.1)) * smooth((inside + 6) / 5);
      shelf.way = (1 - smooth((inside - front + 0.3) / 0.9)) * smooth((inside - 3.2) / 1.2) * smooth((t.run + 1.5 - up) / 1.5) * (1 - smooth(past / 1.2));
      shelf.top = up <= 0 && past <= 0 ? 1 : 0;
      return true;
    };
    // How much of its roughness the rock keeps at a point: all of it, except down the line of a fall.
    const roughAt = (x: number, z: number): number => {
      let keep = 1;
      for (const nt of notches) {
        const along = (x - nt.x) * nt.out, off = Math.abs(z - nt.z);
        if (along < -nt.back - 1.5 || along > 4 || off > nt.half + 2) continue;
        keep = Math.min(keep, 1 - 0.92 * (1 - smooth((off - nt.half - 0.2) / 1.8)));
      }
      // Nor where there is a way to walk up it: a path that the rock's own forms had eaten would be no path.
      for (const t of terraces) if (shelfAt(t, x, z)) keep = Math.min(keep, 1 - 0.8 * shelf.way);
      return keep;
    };
    const nearest = { d: 0, bed: 0, half: 0, depth: 0, t: 0 };
    /** The nearest point of a channel to a point of ground, written to `nearest`; false if the channel is nowhere near. */
    const along = (c: Channel, x: number, z: number, reach: number): boolean => {
      if (x < c.x0 - reach || x > c.x1 + reach || z < c.z0 - reach || z > c.z1 + reach) return false;
      // Every sixth point first: if none of those is anywhere near, none of the rest is either.
      let best = 0, bestD = Infinity;
      for (let i = 0; i < c.x.length; i += 6) {
        const d = (c.x[i] - x) * (c.x[i] - x) + (c.z[i] - z) * (c.z[i] - z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD > (reach + 5) * (reach + 5)) return false;
      for (let i = Math.max(0, best - 6); i < Math.min(c.x.length, best + 7); i++) {
        const d = (c.x[i] - x) * (c.x[i] - x) + (c.z[i] - z) * (c.z[i] - z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD > reach * reach + 4) return false;
      // Between that point and whichever neighbour is nearer, the true nearest point lies on the line joining them.
      nearest.d = Math.sqrt(bestD); nearest.bed = c.bed[best]; nearest.t = best;
      for (const o of [best - 1, best]) {
        if (o < 0 || o >= c.x.length - 1) continue;
        const ax = c.x[o], az = c.z[o], bx = c.x[o + 1] - ax, bz = c.z[o + 1] - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
        const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
        if (d <= nearest.d) { nearest.d = d; nearest.bed = c.bed[o] + (c.bed[o + 1] - c.bed[o]) * t; nearest.t = o + t; }
      }
      // It is broader where it rises and where it ends: a spring has its pool, and so has a sink.
      const end = Math.min(nearest.t, c.x.length - 1 - nearest.t);
      nearest.half = c.half * (1 + 0.8 * (1 - smooth(end / 3)));
      nearest.depth = c.depth;
      return true;
    };
    const rings = lies.filter((f) => f.kind === 'stones');
    const ruins = lies.filter((f) => f.kind === 'ruin');
    /**
     * How high the spoil of a mine lies at a point. The heap begins eight metres out from the foot of the wall, on the adit's
     * line: a bank that rises gently for the tramway, runs level, and ends in a tip that falls as steeply as loose stone will lie,
     * as do its sides.
     */
    const heapAt = (x: number, z: number): number => {
      let high = 0;
      for (const q of grottoes) {
        if (!q.mine) continue;
        const along = (x - q.edge) * q.inw - 8, off = Math.abs(z - q.z), len = q.mine.heap;
        if (along < 0 || along > len + 3 || off > 6) continue;
        const top = 1.15 * smooth(along / 5.5) * (1 - smooth((along - len + 0.6) / 2));
        high = Math.max(high, top * (1 - smooth((off - 1.3) / (1.5 * top + 0.5))));
      }
      return high;
    };
    const campBase = site.camp ? swells(site.camp.x, site.camp.z) : 0;
    const groundBase = (x: number, z: number): number => {
      const fromPath = Math.max(0, Math.abs(x - pathAt(z)) - pathHalf);
      const rough = Math.min(1, fromPath / 2.5) * Math.min(1, Math.max(0, z - p.z0) / 2.5);
      let y = swells(x, z);
      let even = 1;
      for (const f of lies) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (f.kind === 'pond') {
          if (d > f.r * 3.2) continue;
          const rho = across(f, x, z);
          if (rho > 1.75) continue;
          const k = 1 - smooth((rho - 1) / 0.7);
          y += (f.base - y) * k;
          y -= hollow(f) * (1 - smooth((rho - 0.22) / 0.75));
          // An island is a mound of the bed that comes up through the water to stand a little above it.
          if (f.isle) {
            const di = Math.hypot(x - f.isle.x, z - f.isle.z);
            if (di < f.isle.r * 2.6) y += Math.max(0, f.base + 0.3 - y) * (1 - smooth((di - f.isle.r * 0.7) / (f.isle.r * 1.9)));
          }
          even = Math.min(even, 1 - 0.8 * k);
        } else if (f.kind === 'stones') {
          if (d > f.r * 3.4) continue;
          const k = 1 - smooth((d - f.r * 1.25) / (f.r * 2.1));
          y += (f.base + 1.3 - y) * k;
          even = Math.min(even, 1 - 0.85 * k);
        } else {
          if (d > f.r * 2.2) continue;
          const k = 1 - smooth((d - f.r * 1.1) / (f.r * 1.1));
          y += (f.base - y) * k;
          even = Math.min(even, 1 - k);
        }
      }
      // The charcoal burners levelled their pitch: a clamp built on a slope burns unevenly, and the hut wants a floor.
      if (site.camp) {
        const d = Math.hypot(x - site.camp.x, z - site.camp.z), r = site.camp.r;
        if (d < r * 1.7) { const k = 1 - smooth((d - r * 0.9) / (r * 0.75)); y += (campBase - y) * k; even = Math.min(even, 1 - 0.9 * k); }
      }
      y += heapAt(x, z);
      for (const b of houses) {
        // A building on level ground has it levelled about it. One set into rising ground has the ground about it rise from its
        // front to its back, as much as the document says, and stand at that height behind it for some way before it gives back to the land.
        const d = outside(b, x, z), sunk = b.sunk ?? 0, v = (b.faces === 'w' ? 1 : -1) * (x - b.x) + b.d / 2;
        let k: number;
        if (!sunk) {
          if (d > 4.5) continue;
          k = 1 - smooth((d - 0.9) / 3.2);
        } else {
          // (Behind it the risen ground runs on back towards the valley's side, as a hillside does, and gives way to the land only at its sides and far back.)
          const aside = Math.abs((b.faces === 'w' ? 1 : -1) * (z - b.z)) - b.hz;
          // (Before it the ground is level for the depth of its steps and more, as before any building.)
          if (v < -9 || aside > 14 || v > b.d + 38) continue;
          k = v < 0 ? 1 - smooth((Math.max(aside, -v - 2.4) - 0.9) / 3.2) : (1 - smooth((aside - 1.2) / 11)) * (1 - smooth((v - b.d - 22) / 16));
        }
        y += (b.base + groundOf(b, v) - y) * k;
        even = Math.min(even, 1 - k);
      }
      for (const t of towers) {
        const d = Math.max(Math.abs(x - t.x), Math.abs(z - t.z));
        if (d > t.half + 5) continue;
        const k = 1 - smooth((d - t.half - 1.9) / 2.8);
        y += (t.base - t.lift - y) * k;
        even = Math.min(even, 1 - k);
      }
      y += ((fbm2(x * 0.22 + s1, z * 0.22 + s2, 3) - 0.5) * 1.1 * rough + (fbm2(x * 0.9 + s2, z * 0.9 + s1, 2) - 0.5) * 0.16 * rough) * even;
      // Running water has cut itself a bed: flat in the middle, with banks that lie back the
      // further the deeper it has had to cut. Ground is only ever taken away, never built up.
      for (const c of channels) {
        if (!along(c, x, z, 9)) continue;
        const cut = y - nearest.bed, bank = 0.7 + Math.max(0, cut) * 1.3;
        if (cut <= 0 || nearest.d > nearest.half + bank) continue;
        const floor = nearest.bed + 0.1 * Math.min(1, nearest.d / nearest.half) ** 2;
        y = floor + (y - floor) * smooth((nearest.d - nearest.half) / bank);
      }
      // A terrace stands on the valley floor as it finds it, against the wall.
      for (const t of terraces) if (shelfAt(t, x, z)) y += shelf.lift;
      const wobble = wobbleAt(x, z);
      // The hillside is level with the roofline over the house and rises behind it; beside the
      // house it starts to rise at once.
      // (In a valley with a shape of its own, the land to either side of the house is the valley's side run on north, and only the hill behind the house is the house's.)
      // (Nor does the scarp either side of the house front run on beyond the valley's sides, which are scarp enough.)
      const inside = insideAt(x, z), ridge = vale?.ridge;
      // (On a ridge, all of its top is the house's hill, but for its edges, which are crag.)
      const onRidge = ridge && z < frontZ ? smooth((Math.min(x - ridge.x0, ridge.x1 - x) - 3) / 5) : 0;
      const aside = Math.max(0, houseX0 - x, x - houseX1);
      let ownHill = !vale ? 1 : free ? 0 : z < frontZ ? Math.max(1 - smooth((aside - 1.5) / 6), onRidge) : 1 - smooth((-inside - 2) / 4);
      // (And the scarp either side of the house front goes no further than the ridge, where an arm of the valley may run on past it.)
      if (ridge && z >= frontZ) ownHill *= smooth((x - ridge.x0 + 1.5) / 2) * smooth((ridge.x1 + 1.5 - x) / 2);
      // An arm rises a little as it goes north, as the upper end of a valley does.
      if (ridge && z < frontZ) y += 4.5 * smooth((frontZ - 3 - z) / 45);
      const clearOfHouse = vale ? 0 : smooth(aside / 8);
      const riseFrom = houseZ0 + (frontZ - houseZ0) * clearOfHouse;
      // It lies a little above the top of the walls. (It used to lie a little below, inside the
      // solid that casts the house's shadow, and so was never once in the sun.)
      let crest = site.top + 0.12 + Math.min(18, Math.max(0, riseFrom - z) * 0.55);
      // Over the house it is not a lid but the top of a hill: it swells and dips, keeping level
      // only where it meets the front wall and the edge of anything open to the sky.
      if (z < frontZ) {
        let free = smooth((frontZ - z - 1.2) / 4);
        for (const o of openings) free = Math.min(free, smooth((Math.max(o.x0 - x, x - o.x1, o.z0 - z, z - o.z1) - 0.6) / 3.5));
        if (free > 0) crest += (0.25 + 1.9 * fbm2(x * 0.09 + s2 * 2, z * 0.09 - s1, 3) * fbm2(x * 0.31 + s1, z * 0.31 + s2, 2) * 2) * free;
      }
      if (crest > y) y += (crest - y) * escarpment(x, z, wobble) * ownHill;
      if (!vale) {
        // (A site with no shape recorded: a wall round a box, as valleys were first made.)
        y += (6.5 + 7 * fbm2(x * 0.03 + s1, z * 0.03 - s2, 2)) * (1 - smooth((inside - 2.9 + wobble) / 1.8)) * smooth((z - (p.z0 - 9)) / 7);
        const beyond = Math.max(0, -inside);
        y += smooth((beyond - 10) / 190) * 30 + (fbm2(x * 0.011 + s1, z * 0.011 + s2, 4) - 0.5) * 22 * smooth(beyond / 60);
      } else {
        // The rock goes up in a stride or two. It is made steeper than rock would long stand, and then worn back. How high it
        // stands is not the same all round: here a low broken crag, there a cliff three times the height. It begins at the
        // corners of the house, whose own scarp is the head of the valley; and beyond the gap at the foot it dies away.
        const high = 6 + 15 * fbm2(x * 0.021 + s1, z * 0.021 - s2, 2) ** 1.4;
        // (Dies away, not drops away: beyond the gap the same rise is spread over a broader and broader slope, until it is a hillside like any other.)
        const spread = 1.8 + 44 * smooth((z - vale.mouth - 4) / 20);
        // (Nor does it stand over the house, nor close beside it north of its front, where the house's own hill is; further off to either side it runs on north as the top of the land does.)
        // North of the house front everything is side, but for the house and its hill.
        // (Not so round a house that stands free, which has the valley all round it.)
        const ins = z < frontZ && !ridge && !free ? Math.min(inside, 2.9 + z - frontZ) : inside;
        y += high * (1 - smooth((ins - 4.7 + spread + wobble) / spread)) * (free ? 1 : z < frontZ ? 1 - ownHill : smooth((z - (frontZ - 0.3)) / 2.2) + (1 - smooth((z - (frontZ - 0.3)) / 2.2)) * (1 - ownHill));
        // Behind the crags the land does not lie flat, as round a quarry: it goes on up, as a hillside, more on some sides
        // than on others. (North of the house front the hills keep the distance they always kept from it.)
        const out = Math.max(0, -inside), north = Math.max(0, aside - 3), t = smooth((z - (frontZ - 2)) / 14), beyond = ridge ? (z < ridge.z && x > ridge.x0 && x < ridge.x1 ? 0 : out) : free ? out : north + (out - north) * t;
        const stands = 0.55 + 0.9 * fbm2(x * 0.008 + s2 + 9, z * 0.008 - s1, 2);
        // (A valley that was found has the land it was found in beyond its sides, rising behind the crags: not hills made up.)
        // (Behind its crags too the ground goes on up, as behind a drawn valley's, a little less; under that the land it was found in.
        // Where that land rose less than the crag stood, the top of the crag was left as a level shelf: the rim of a quarry.)
        if (vale.terrain) { y += smooth((beyond - 2) / 90) * 15 * stands; if (inside < 0) y = Math.max(y, valleyLand(vale, p.floor, p, x, z) + 0.5 * smooth(-inside / 6)); }
        else y += smooth((beyond - 2) / 90) * 23 * stands + smooth((beyond - 40) / 200) * 24 + (fbm2(x * 0.011 + s1, z * 0.011 + s2, 4) - 0.5) * 22 * smooth(beyond / 60);
      }
      // Where water comes over, it has worn a notch in the top of the wall and a channel back from it.
      for (const nt of notches) {
        const along = (x - nt.x) * nt.out, off = Math.abs(z - nt.z);
        if (along < -2 || along > 15 || off > nt.half + 1.4) continue;
        y -= nt.depth * (1 - smooth((off - nt.half) / 1.4)) * smooth((along + 2) / 1.6) * (1 - smooth((along - 9) / 6));
      }
      return y;
    };
    const slopeOf = (f: (x: number, z: number) => number, x: number, z: number, e: number) => Math.hypot(f(x + e, z) - f(x - e, z), f(x, z + e) - f(x, z - e)) / (2 * e);

    /**
     * Water. The site says where the streams run; here each is cut a bed. Its line is smoothed
     * and walked from its beginning to its end, and the bed is kept a hand below the ground as
     * it lies, but never allowed to rise: where the ground comes up in the way, the bed cuts
     * through it, and the stream runs in a gully. A stream that feeds a pond sets the pond's
     * level, if it arrives lower than the pond would otherwise lie; a stream that leaves a pond
     * starts from that level. So water runs downhill everywhere, whatever the ground was.
     */
    const cutBed = (stream: NonNullable<Site['streams']>[number]): void => {
      // A smooth curve through the points of the course, sampled about every metre.
      const pts = stream.course, xs: number[] = [], zs: number[] = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1], d = pts[Math.min(pts.length - 1, k + 2)];
        const n = Math.max(2, Math.round(Math.hypot(c[0] - b[0], c[1] - b[1]) / 1.1));
        for (let i = 0; i < n + (k === pts.length - 2 ? 1 : 0); i++) {
          const t = i / n, t2 = t * t, t3 = t2 * t;
          xs.push(0.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3));
          zs.push(0.5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3));
        }
      }
      const lake = (k: number) => pondList.reduce((best, f) => (Math.hypot(f.x - xs[k], f.z - zs[k]) < Math.hypot(best.x - xs[k], best.z - zs[k]) ? f : best), pondList[0]);
      const from = stream.from === 'pond' && pondList.length ? lake(0) : null, to = stream.to === 'pond' && pondList.length ? lake(xs.length - 1) : null;
      // How deep the water stands over its bed, and how far the bed is cut below the ground: a
      // river lies lower between its banks than a brook does. The water is always well under
      // the grass on either side, so that what is seen of it is seen between banks.
      const depth = 0.14 + 0.035 * stream.width, sunk = 0.3 + 0.06 * stream.width;
      const bed: number[] = [];
      for (let k = 0; k < xs.length; k++) {
        const natural = groundBase(xs[k], zs[k]) - sunk;
        const step = k ? Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]) * 0.005 : 0;
        // Water leaving a pond leaves at the pond's own level, not a hand above it.
        bed.push(k === 0 ? (from ? from.base - 0.42 - depth - 0.02 : natural) : Math.min(bed[k - 1] - step, natural));
      }
      if (to) {
        // Where the stream comes to the edge of the pond's hollow. The pond can lie no higher
        // than the stream arrives there; if it would, the pond is set lower.
        let rim = 0;
        for (let k = 0; k < xs.length; k++) if (across(to, xs[k], zs[k]) >= 1) rim = k;
        const level = to.base - 0.42;
        if (bed[rim] < level + 0.05) to.base -= Math.min(1.6, level + 0.05 - bed[rim]);
        // From there it runs down the bank and in under the pond's surface.
        const surface = to.base - 0.42, last = xs.length - 1;
        for (let k = rim + 1; k <= last; k++) bed[k] = Math.min(bed[rim], bed[rim] + (surface - depth - bed[rim]) * ((k - rim) / Math.max(1, last - rim)));
      }
      let fall: Notch | undefined;
      if (stream.from === 'fall') {
        // Out of the valley is towards whichever side wall the stream begins under. Going that
        // way, the lip is the first place the ground has come nearly up to the top of the wall.
        const out = xs[0] < (sideAt('w', zs[0]) + sideAt('e', zs[0])) / 2 ? -1 : 1, foot = groundBase(xs[0], zs[0]);
        let top = foot, back = 8;
        for (let d = 0; d <= 8; d += 0.4) top = Math.max(top, groundBase(xs[0] + out * d, zs[0]));
        for (let d = 0; d <= 8; d += 0.2) if (groundBase(xs[0] + out * d, zs[0]) > foot + 0.85 * (top - foot)) { back = d; break; }
        if (top - foot > 2.5) {
          fall = { x: xs[0] + out * back, z: zs[0], out, half: stream.width * 0.5 + 0.45, depth: 0.5 + 0.12 * stream.width, back };
          notches.push(fall);
        }
      }
      channels.push({ x: xs, z: zs, bed, half: stream.width / 2, depth, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), of: stream, fall });
    };
    // Streams into ponds first, since they settle how the ponds lie; then the rest.
    for (const st of (site.streams ?? []).filter((q) => q.to === 'pond')) cutBed(st);
    for (const st of (site.streams ?? []).filter((q) => q.to !== 'pond')) cutBed(st);
    const ponds = pondList.map((f) => Object.assign(f, { level: f.base - 0.42 }));

    /**
     * The rock of the valley. The plain shape above gives a smooth wall round the valley and a
     * smooth scarp at its head. Here it is turned into cliffs, in three steps:
     *  1. the stone is given beds, some hard and some soft, which dip a little;
     *  2. the wall is worn the way frost wears it, on a lattice of heights: soft beds fall back
     *     into ledges, hard ones are left as faces, and what fell lies at the foot as scree;
     *  3. the worn wall is carved as a solid, with the beds cut back or standing proud, split into
     *     blocks by joints, and broken into buttresses and gullies.
     * The same lattice serves every piece that is carved and the sheets laid beyond, so they meet.
     */
    const rockKind = ROCK[site.setting.stone];
    const strata = new Strata(rockKind, rng.fork('strata'), p.floor);
    const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
    const CELL = 0.3, SHEET = 1.2;
    const snapTo = (v: number, up: boolean) => (up ? Math.ceil(v / SHEET - 1e-6) : Math.floor(v / SHEET + 1e-6)) * SHEET;
    // The band of ground carved as cliff: this far into the valley from its edge, and this far out.
    const IN = 9.6, OUT = 6;
    const ZNo = snapTo(p.z0 - 7.2, false), ZNi = snapTo(p.z0 + IN, true);
    // The meadow is carved too, and baked with the house. Behind the house front there is nothing to carve.
    const MX0 = snapTo(p.x0 - 0.9, false), MX1 = snapTo(p.x1 + 0.9, true), MZ0 = snapTo(p.z0 - 0.14, false), MZ1 = snapTo(p.z1 + 0.3, true);
    const behind = p.z0 - 0.14;
    type Patch = { x0: number; x1: number; z0: number; z1: number };
    const meadowPatch: Patch = { x0: MX0, x1: MX1, z0: MZ0, z1: MZ1 };
    // The cliffs proper are only made where there is a valley.
    const walled = !!vale;
    /**
     * The band follows the valley's two sides wherever they go. It is made up of rows across the valley, each a few strides
     * deep, and in each row whatever stretches of it lie within the band are carved, each as one piece. The first row is
     * the head of the valley, about the house: all of it is carved, from side to side, since there the house's own scarp
     * stands between the two. A terrace stands out further than the band is deep, so more is carved there.
     */
    const headPatches: Patch[] = [], rimPatches: Patch[] = [], rows: { z0: number; z1: number; of: Patch[] }[] = [];
    if (vale) {
      const zEnd = snapTo(vale.mouth + 19, true), ROW = 9.6, COL = 2.4;
      let bx0 = Infinity, bx1 = -Infinity;
      const zStart = Math.min(ZNo, snapTo(vale.z0 - 9.6, false));
      for (let z = zStart; z <= zEnd; z += 2) { bx0 = Math.min(bx0, sideAt('w', z)); bx1 = Math.max(bx1, sideAt('e', z)); }
      bx0 = snapTo(bx0 - OUT - 33, false); bx1 = snapTo(bx1 + OUT + 33, true);
      const shelves = terraces.map((t) => ({ t, za: (t.rise === 'n' ? t.z0 - t.run : t.z0) - 4.5, zb: (t.rise === 's' ? t.z1 + t.run : t.z1) + 4.5 }));
      // (Past the gap at the foot the crag dies away over a broader and broader slope, which reaches further out behind the side than
      // the band does; where that slope is still steep, it is carved with the band. Laid as the plain sheet, the crag went on from
      // where the band stopped as a wall of smooth grey, the seam between them a straight line down it.)
      const dying = (z: number) => Math.min(30, 44 * smooth((z - vale.mouth - 2) / 20)) * smooth((vale.mouth + 34 - z) / 6);
      const inBand = (x: number, z: number): boolean => {
        const d = insideAt(x, z);
        if (d < -OUT - dying(z)) return false;
        if (d <= IN || (!free && z <= ZNi && z >= ZNo)) return true;
        return shelves.some((q) => z > q.za && z < q.zb && fromSide(q.t.side, x, z) < 4.7 + q.t.depth + 5);
      };
      for (let za = zStart; za < zEnd - 1e-6;) {
        const zb = za === ZNo ? ZNi : Math.min(zEnd, za + ROW, za < ZNo ? ZNo : Infinity), row = { z0: za, z1: zb, of: [] as Patch[] };
        let run: Patch | null = null;
        for (let x = bx0; x < bx1 - 1e-6; x += COL) {
          let any = false;
          for (let z = za + 0.6; z < zb && !any; z += 1.2) any = inBand(x + 0.6, z) || inBand(x + 1.8, z);
          if (any) { if (run) run.x1 = x + COL; else { run = { x0: x, x1: x + COL, z0: za, z1: zb }; row.of.push(run); } } else run = null;
        }
        // (Less the meadow, which is a piece of its own, and everything behind it: between the ends of the house front there is
        // nothing to carve, and were it carved, the ground before the door would be laid through the rooms behind it.)
        row.of = row.of.flatMap((c): Patch[] => (c.x1 <= MX0 || c.x0 >= MX1 || c.z0 >= MZ1 ? [c] : [
          { x0: c.x0, x1: Math.min(c.x1, MX0), z0: c.z0, z1: c.z1 }, { x0: Math.max(c.x0, MX1), x1: c.x1, z0: c.z0, z1: c.z1 },
          { x0: Math.max(c.x0, MX0), x1: Math.min(c.x1, MX1), z0: Math.max(c.z0, MZ1), z1: c.z1 },
        ].filter((q) => q.x1 - q.x0 > 0.01 && q.z1 - q.z0 > 0.01)));
        (za === ZNo ? headPatches : rimPatches).push(...row.of);
        rows.push(row);
        za = zb;
      }
    }
    const shelfPatches: Patch[] = [];
    const patches = [meadowPatch, ...headPatches, ...rimPatches];
    const inPatch = (c: Patch, x: number, z: number, m: number) => x >= c.x0 - m && x <= c.x1 + m && z >= c.z0 - m && z <= c.z1 + m;
    // With a hair's breadth to spare: a point on the edge of a patch, as lattice points are, belongs to it.
    const inBandPatch = (x: number, z: number, m: number) => rows.some((r) => z >= r.z0 - m && z <= r.z1 + m && r.of.some((c) => inPatch(c, x, z, m)));
    const carved = (x: number, z: number) => inPatch(meadowPatch, x, z, 1e-6) || inBandPatch(x, z, 1e-6);
    // How deep a point lies inside the band of cliff, measured from the nearest ground that is
    // not cliff: the valley floor, the hill outside, or the meadow and the house. (Filled in below, once the lattice is laid.)
    let depthInBand = (_x: number, _z: number): number => 0;
    const MARGIN = 3.2;
    const lx0 = Math.min(...patches.map((c) => c.x0)) - MARGIN, lz0 = Math.min(...patches.map((c) => c.z0)) - MARGIN, lx1 = Math.max(...patches.map((c) => c.x1)) + MARGIN, lz1 = Math.max(...patches.map((c) => c.z1)) + MARGIN;
    const land = new Grid2(lx0, lz0, CELL, Math.round((lx1 - lx0) / CELL) + 1, Math.round((lz1 - lz0) / CELL) + 1);
    const known = new Uint8Array(land.data.length);
    // In front of the house the meadow runs level up to the wall; the scarp behind the wall is not this piece's business.
    const wallEnds = (x: number) => smooth((Math.min(x - (p.x0 - 0.2), p.x1 + 0.2 - x) + 0.7) / 0.7);
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
      const x = land.x0 + i * CELL, z = land.z0 + j * CELL;
      // A little beyond what is carved is wanted too, because the face is looked up a few paces to one side of where it stands.
      if (!inPatch(meadowPatch, x, z, MARGIN) && !inBandPatch(x, z, MARGIN)) continue;
      known[j * land.nx + i] = 1;
      // (This holds for the lattice's margin behind the wall as much as for the meadow itself:
      // were the hill behind let in there, the meadow would find a cliff at its back and turn it to rock.)
      land.data[j * land.nx + i] = groundBase(x, z < behind && !delve ? z + (behind - z) * wallEnds(x) : z);
    }
    const loose = land.like();
    const wornBy = land.like();
    if (walled) {
      // How far each point of the band is from the nearest ground that is not band, counted in steps of the lattice, there and back.
      const far = new Float32Array(land.data.length), nxL = land.nx, nzL = land.nz, D1 = CELL, D2 = CELL * Math.SQRT2;
      for (let j = 0; j < nzL; j++) for (let i = 0; i < nxL; i++) far[j * nxL + i] = i > 0 && j > 0 && i < nxL - 1 && j < nzL - 1 && inBandPatch(land.x0 + i * CELL, land.z0 + j * CELL, 1e-6) ? 1e6 : 0;
      for (let j = 1; j < nzL - 1; j++) for (let i = 1; i < nxL - 1; i++) { const o = j * nxL + i; if (far[o]) far[o] = Math.min(far[o], far[o - 1] + D1, far[o - nxL] + D1, far[o - nxL - 1] + D2, far[o - nxL + 1] + D2); }
      for (let j = nzL - 2; j > 0; j--) for (let i = nxL - 2; i > 0; i--) { const o = j * nxL + i; if (far[o]) far[o] = Math.min(far[o], far[o + 1] + D1, far[o + nxL] + D1, far[o + nxL + 1] + D2, far[o + nxL - 1] + D2); }
      depthInBand = (x, z) => far[Math.min(nzL - 1, Math.max(0, Math.round((z - land.z0) / CELL))) * nxL + Math.min(nxL - 1, Math.max(0, Math.round((x - land.x0) / CELL)))];
      const before = land.data.slice();
      const active = new Uint8Array(land.data.length);
      const foot = land.like();
      for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
        const x = land.x0 + i * CELL, z = land.z0 + j * CELL, o = j * land.nx + i;
        // Nothing moves at the edge of the band, where it must still meet the ground beside it;
        // nor above the house, whose rooms lie close behind the scarp.
        const overHouse = z < ZNi + 2 && x > houseX0 - 4 && x < houseX1 + 4;
        if (!known[o] || !carved(x, z) || depthInBand(x, z) < 0.8 || overHouse) continue;
        active[o] = 1;
        foot.data[o] = swells(x, z);
      }
      erode({
        rock: land, loose, active, repose: 0.67, kept: 0.16, passes: 46,
        holds: (o, y) => {
          const x = land.x0 + (o % land.nx) * CELL, z = land.z0 + Math.floor(o / land.nx) * CELL;
          // The lowest beds are taken to be sound, so that the wall always starts with a face
          // too high to scramble up, whatever lies above it.
          const hard = y < foot.data[o] + 4.5 ? 0.92 : strata.hardness(Math.floor(strata.at(x, y, z)));
          // (Nor does anything wear the way up to a terrace, or its shelf, into steps: whoever made the way chose rock that holds.)
          for (const t of terraces) if (shelfAt(t, x, z) && (shelf.way > 0.05 || shelf.top)) return 8;
          return 0.7 + hard * hard * hard * 7;
        },
      });
      for (let o = 0; o < land.data.length; o++) {
        land.data[o] += loose.data[o];
        // (The way up to a terrace and its shelf are left as they were made: no scree lies on them and nothing wore them down.)
        if (terraces.length) {
          const x = land.x0 + (o % land.nx) * CELL, z = land.z0 + Math.floor(o / land.nx) * CELL;
          if (terraces.some((t) => shelfAt(t, x, z) && (shelf.way > 0.3 || shelf.top))) { land.data[o] = before[o]; loose.data[o] = 0; }
        }
        wornBy.data[o] = land.data[o] - before[o];
      }
    }
    const ground = (x: number, z: number): number => (walled && wornBy.holds(x, z) ? groundBase(x, z) + wornBy.at(x, z) : groundBase(x, z));
    // In a delve, the rock face over the door is cut back square to take the portal: a recess a little broader and higher than it, as deep as the wall.
    const portalHalf = 2.1, portalTop = p.floor + 4.2;
    const portalAir = delve ? (x: number, y: number, z: number) => Math.min(portalHalf + 0.05 - Math.abs(x - doorX), y - (p.floor - 0.4), portalTop + 0.1 - y, z - (p.z0 - T - 0.3), p.z0 + 5.2 - z) : null;
    // (The lowest ground there is, for the mist, which lies on it and not under it.)
    for (let i = 0; i < land.data.length; i++) if (land.data[i] < groundLow) groundLow = land.data[i];
    // A grotto's floor is level with the lowest ground before its mouth, as the wall's wearing
    // left it: any higher and there would be a sill to climb over on the way in.
    for (const q of grottoes) {
      let low = Infinity;
      for (let i = 3.3; i <= 7.6; i += 0.3) for (const off of [-0.6, 0, 0.6]) low = Math.min(low, ground(q.edge + q.inw * i, q.z + off));
      q.y0 = low - 0.03;
    }
    /**
     * The passage that joins the cave in an arm's wall to the cavern under the arm. Its air is a
     * tube along the line the document gives, of the same section as the other way down. It leaves
     * the cave's chamber on the level, falls evenly, and is level again for its last three metres.
     * As far as `seam` it is carved with the land, whose carving has the cave; from there on by
     * itself; and where the cavern's own carving reaches, by that.
     */
    const join = (() => {
      const dp = site.backWay?.deep, cv = backWay?.cavern, jw = backWay?.join, q = grottoes[0];
      if (!dp?.join || !cv || !jw || !backWay || !q || (q.hall && !q.on)) return null;
      const bwy = backWay, s = dp.join.toward, total = jw.total;
      const yS = q.hall ? q.y0 - q.hall.drop : q.y0 - 0.045 * (q.far - 2), yE = cv.floor, floorAt = (along: number) => yS + (yE - yS) * Math.min(1, Math.max(0, (along - 2) / (total - 2 - jw.level)));
      const xs = jw.line.map((b) => b[0]), zs = jw.line.map((b) => b[1]);
      const box = [Math.min(...xs) - 2.6, Math.max(...xs) + 2.6, Math.min(...zs) - 2.6, Math.max(...zs) + 2.6], top = yS + 3.4;
      const air = (x: number, y: number, z: number): number => {
        if (x < box[0] || x > box[1] || z < box[2] || z > box[3] || y > top || y < yE - 1.5) return -9;
        const at = bwy.joinAt(x, z), tube = at.off > 2.4 ? -9 : bwy.joinSection(at.off, at.along, x, y, z, floorAt(at.along));
        // (From a hall it begins inside the hall's door onward, and where the two overlap its air is the door's as well: so that
        // its own carving and the hall's make the same thing there.)
        return q.on && (z - q.z) * s > q.on.end - 1.5 && (z - q.z) * s < q.on.end + 0.2 ? Math.max(tube, hallAir(q, 7 - (x - q.edge) * q.inw, z - q.z, y)) : tube;
      };
      // Points along it, every half metre, with its floor at each: for what must know where it runs without asking for its air.
      const samples: { x: number; y: number; z: number }[] = [];
      for (let i = 0, run = 0; i < jw.lens.length; run += jw.lens[i], i++) for (let d = 0; d < jw.lens[i]; d += 0.5) samples.push({ x: jw.line[i][0] + ((jw.line[i + 1][0] - jw.line[i][0]) * d) / jw.lens[i], y: floorAt(run + d), z: jw.line[i][1] + ((jw.line[i + 1][1] - jw.line[i][1]) * d) / jw.lens[i] });
      const seam = q.z + s * (q.on ? q.on.end - 0.1 : 1.2 * q.r + 1.6);
      // (`own`: whether a point is past the seam, going from the cave, and so not the land's to carve. `byCave`: whether a patch of land holds the stretch before the seam.)
      return { air, box, top, high: yS, hewn: !!q.hall, samples, back: s * (q.on ? 0.5 : 1.3), inset: (z: number) => 0.07 * smooth(((z - seam) * s + (q.on ? 0.5 : 1.3)) / 0.4) * (1 - smooth(((z - seam) * s) / 0.8)), own: (z: number) => (z - seam) * s > 0, byCave: (c: { x0: number; x1: number; z0: number; z1: number }) => !q.hall && c.x1 > xs[0] - 5 && c.x0 < xs[0] + 5 && c.z1 > Math.min(q.z, seam) - 1 && c.z0 < Math.max(q.z, seam) + 1 };
    })();
    // Three things read off the worn heights: how steep the ground is, which turns a height
    // above it into a distance from it; which way is uphill; and how far the ground is rock,
    // which is where it is steep and bare.
    const steepness = land.like(), rocky = land.like(), upX = land.like(), upZ = land.like();
    {
      const H = land.data, nxL = land.nx;
      const raw = new Float32Array(H.length);
      for (let j = 0; j < land.nz; j++) for (let i = 0; i < nxL; i++) {
        const o = j * nxL + i;
        steepness.data[o] = 1;
        if (!known[o]) continue;
        const w = i > 0 && known[o - 1] ? o - 1 : o, e = i < nxL - 1 && known[o + 1] ? o + 1 : o;
        const n = j > 0 && known[o - nxL] ? o - nxL : o, s = j < land.nz - 1 && known[o + nxL] ? o + nxL : o;
        const gx = e > w ? (H[e] - H[w]) / ((e - w) * CELL) : 0, gz = s > n ? (H[s] - H[n]) / (((s - n) / nxL) * CELL) : 0;
        const slope = Math.hypot(gx, gz);
        steepness.data[o] = Math.sqrt(1 + slope * slope);
        upX.data[o] = gx; upZ.data[o] = gz;
        raw[o] = smooth((slope - 0.85) / 0.6) * (1 - smooth(loose.data[o] / 0.3));
      }
      // Each is eased over a pace or two: rock does not start at a line, and a face does not
      // change the way it looks at every step in it.
      const ease = (data: Float32Array, times: number) => {
        const from = new Float32Array(data.length);
        for (let t = 0; t < times; t++) {
          from.set(data);
          for (let j = 0; j < land.nz; j++) for (let i = 0; i < nxL; i++) {
            let sum = 0, count = 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nxL || jj >= land.nz || !known[jj * nxL + ii]) continue;
              sum += from[jj * nxL + ii]; count++;
            }
            data[j * nxL + i] = count ? sum / count : 0;
          }
        }
      };
      ease(raw, 1); ease(upX.data, 3); ease(upZ.data, 3);
      for (let o = 0; o < H.length; o++) {
        rocky.data[o] = raw[o];
        // The way uphill, as a direction; on ground that is nearly level it fades to nothing.
        const l = Math.hypot(upX.data[o], upZ.data[o]), k = l > 1e-6 ? smooth(l / 0.8) / l : 0;
        upX.data[o] *= k; upZ.data[o] *= k;
      }
    }
    // Close in front of the house the face must not be cut back, or it would break into the rooms.
    // How many beds make a step, and how strongly the stone steps at all: columns do not.
    const stepBeds = Math.max(1, Math.round(1.3 / rockKind.bed)), stepped = Math.min(1, rockKind.bedded * 1.4);
    const guarded = (x: number) => 1 - smooth((Math.max(houseX0 - 1.5 - x, x - houseX1 - 1.5)) / 2);
    /**
     * The land as a solid: positive in air, negative in the ground, and roughly the distance to
     * the surface. Where the ground is rock, the surface is not where the heights put it but as
     * far out from there, or back, as the rock's relief says: the heights are read that far
     * uphill or down. Moving the face sideways, not up and down, is what lets a hard bed
     * overhang a soft one, and keeps the top of a cliff from breaking into teeth.
     */
    // What is known about the spot of ground last asked about. The land is sampled a column at
    // a time, so this is nearly always the spot asked about next.
    const spot = { x: NaN, z: NaN, rocky: 0, h: 0, steep: 1, slope: 0, ux: 0, uz: 0 };
    // The fine relief and the steps together never move the face further than this.
    const TREAD_MOST = 0.9, FINE_MOST = 1.5;
    const landAir = (x: number, y: number, z: number): number => {
      if (x !== spot.x || z !== spot.z) {
        spot.x = x; spot.z = z;
        // (Down the line of a waterfall the face is worn smooth, so the water lies on it.)
        spot.rocky = rocky.at(x, z) * (notches.length || terraces.length ? roughAt(x, z) : 1); spot.h = land.at(x, z); spot.steep = steepness.at(x, z);
        if (spot.rocky >= 0.002) {
          spot.slope = Math.sqrt(Math.max(0.04, spot.steep * spot.steep - 1));
          spot.ux = upX.at(x, z); spot.uz = upZ.at(x, z);
        }
      }
      const d = (y - spot.h) / spot.steep;
      if (spot.rocky < 0.002 || d > 5.4 || d < -5.4) return d;
      // The broad forms first. If the fine ones could not bring the face as far as here, they
      // are not worked out: only the sign of the answer matters away from the face.
      let out = Math.min(2.4, Math.max(-2.4, relief.broad(x, y, z)));
      const most = FINE_MOST * spot.rocky + 0.45;
      if (Math.abs(d - out * spot.rocky) > most) return d - out * spot.rocky;
      let fine = relief.fine(x, y, z);
      // Bedded stone goes up in steps: within each step the face is brought upright, its top
      // pushed out and its foot drawn back, by as much as the slope there calls for. On a steep
      // face the treads are a hand wide; where the rock lies back they are ledges.
      const tread = strata.at(x, y, z) / stepBeds + 0.31, within = tread - Math.floor(tread);
      fine += Math.max(-TREAD_MOST, Math.min(TREAD_MOST, ((within - 0.5) * stepBeds * rockKind.bed) / spot.slope)) * stepped;
      out += Math.max(-FINE_MOST, Math.min(FINE_MOST, fine));
      // Close in front of the house the rock stands forward, and is cut back hardly at all.
      if (z < ZNi + 2) out += (Math.max(-0.2, 1.3 + out * 0.85) - out) * guarded(x);
      out *= spot.rocky;
      const sx = x + out * spot.ux, sz = z + out * spot.uz;
      return (y - land.at(sx, sz)) / steepness.at(sx, sz);
    };

    // Weathered rock in the open is greyer than the same stone freshly cut for the house.
    const outcrop: Colour = [0.5 + 0.5 * stoneTint[0], 0.52 + 0.5 * stoneTint[1], 0.56 + 0.5 * stoneTint[2]];
    const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
    const blotSeed = rng.fork('blot').int(1, 9999);
    /**
     * The colour of a point of cliff, and what grows and seeps on it. Each bed has its own shade
     * between the stone's pale and dark; over that lie broad stains, and everything is darker in
     * cracks and under overhangs, where dirt gathers and little light comes.
     */
    const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number, bedding: number): Colour => {
      const u = strata.at(q.x, q.y, q.z), i = Math.floor(u);
      const t = strata.shade(i), soft = 1 - strata.hardness(i);
      const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed);
      const rust = smooth((fbm3(q.x * 0.17 + 9, q.y * 0.4, q.z * 0.17, 3, blotSeed + 3) - 0.6) / 0.14);
      const tone = (0.72 + 0.56 * blot) * (0.7 + 0.3 * open);
      const c = rockColour(tone);
      const pale = rockKind.pale, dark = rockKind.dark;
      c[0] *= (dark[0] + (pale[0] - dark[0]) * t) * (1 + 0.22 * rust);
      c[1] *= (dark[1] + (pale[1] - dark[1]) * t) * (1 - 0.02 * rust);
      c[2] *= (dark[2] + (pale[2] - dark[2]) * t) * (1 - 0.22 * rust);
      const up = Math.max(0, n.y);
      // Moss on what faces the sky and in the soft beds, which hold water; damp below overhangs.
      field[0] = Math.min(1, up * 0.9 + soft * 0.35 * (1 - open) + (1 - open) * 0.2);
      field[1] = Math.min(1, (1 - open) * 0.25 + soft * 0.3 * smooth((blot - 0.45) / 0.2));
      field[3] = bedding;
      return c;
    };
    const earth = (x: number, z: number): Colour => {
      const t = 0.62 + 0.5 * fbm2(x * 0.5 + s2, z * 0.5 + s1, 3);
      return [0.5 * t * outcrop[0], 0.47 * t * outcrop[1], 0.43 * t * outcrop[2]];
    };
    // The track is a cart's: two ruts worn bare, and grass down the middle between them in
    // clumps, with bare earth between the clumps. The ruts are narrower than the sheet of the
    // ground is fine, so they cannot be marked on it point by point: the sheet carries how far
    // each point lies to one side of the middle of the track, which it can carry exactly, and
    // the ruts are drawn from that. The same shapes are worked out here, for what grows.
    const trackOff = (x: number, z: number): number => {
      if (z < p.z1 - 6) return 99;
      const off = x - pathAt(z);
      // Where the track comes up to the flags before the door, the ruts die away.
      return off + (off < 0 ? -1 : 1) * 4 * (1 - smooth((z - p.z1 + 6) / 3));
    };
    const clumpAt = (z: number) => Math.sin(z * 0.9 + 2.2 * Math.sin(z * 0.31));
    const rutted = (x: number, z: number): number => {
      const d = Math.abs(trackOff(x, z));
      if (d > 1.3) return 0;
      const rut = 1 - smooth((Math.abs(d - 0.58) - 0.2) / 0.34);
      return Math.max(rut, smooth((-0.15 - clumpAt(z)) / 0.2) * (1 - smooth((d - 0.25) / 0.25)));
    };
    /**
     * What the ground is at a point. Its colour is the turf's, and stays so; how bare it is and
     * how wet are left in `lay`, to be written into the point's fields, and it is the material
     * for ground that makes earth, shingle and their edges out of those.
     */
    const lay = { bare: 0, wet: 0, track: 0 };
    const turfAt = (x: number, z: number): Colour => {
      // Bare where stones have come down on it;
      let bare = walled && loose.holds(x, z) ? smooth(loose.at(x, z) / 0.28) * 0.45 : 0, wet = 0;
      // in the bed of a stream and up its banks a little way, which is shingle and wet;
      for (const ch of channels) if (along(ch, x, z, 3)) {
        bare = Math.max(bare, 0.92 * (1 - smooth((nearest.d - nearest.half) / 1.3)));
        wet = Math.max(wet, 1 - smooth((nearest.d - nearest.half - 0.1) / 0.75));
      }
      // in the bed of a pond, from a little above the water line down;
      for (const f of pondList) if (Math.abs(x - f.x) < f.r * 2 && Math.abs(z - f.z) < f.r * 2) {
        const rho = across(f, x, z);
        bare = Math.max(bare, 0.85 * (1 - smooth((rho - 0.72) / 0.18)));
        wet = Math.max(wet, 1 - smooth((rho - 0.85) / 0.14));
      }
      // on the spoil of a mine, which is broken stone;
      bare = Math.max(bare, Math.min(0.95, heapAt(x, z) * 3));
      lay.bare = bare;
      lay.wet = wet;
      // And where the track is: how far to one side of its middle, plus a hundred; nothing if it is nowhere near.
      const off = trackOff(x, z);
      // (On a footpath, how far from its middle plus two hundred: the material for ground tells the one from the other.)
      const foot = offFoot(x, z);
      lay.track = Math.abs(off) < 6 ? 100 + off : foot < 3 ? 200 + foot : 0;
      return turfColour(x, z, s1);
    };
    const cliff = site.top - p.floor + 0.5;
    /** Carves one patch of the land: rock where it is steep, turf where it is level, scree where debris lies. */
    // (`onSheet`: the patch ends on the plain sheet of ground, and is closed on the sheet's own edge. Not the meadow and the hill over the house,
    // which end on the house: the sheet's height there is the hilltop's, and closing on it raised rock into the doorway.)
    const carveLand = (whole: Patch, into: (material: string) => MeshBuilder, keep?: (at: Vector3) => boolean, onSheet = false) => {
      // A long patch is carved in lengths, each only as tall as its own ground needs.
      const TILE = 12;
      if (whole.x1 - whole.x0 > TILE * 1.5 || whole.z1 - whole.z0 > TILE * 1.5) {
        const alongX = whole.x1 - whole.x0 > whole.z1 - whole.z0;
        const from = alongX ? whole.x0 : whole.z0, to = alongX ? whole.x1 : whole.z1;
        for (let a = from; a < to - 1e-6; a += TILE) {
          const b = to - (a + TILE) < TILE * 0.5 ? to : a + TILE;
          carveLand(alongX ? { ...whole, x0: a, x1: b } : { ...whole, z0: a, z1: b }, into, keep, onSheet);
          if (b === to) break;
        }
        return;
      }
      const c = whole;
      let lo = Infinity, hi = -Infinity;
      // (Over the ground a little beyond the piece as well: the rock's face is pushed sideways by its relief, up to some four metres,
      // and so reads heights from there; a face that rose above the box or sank below it would be cut off there, and leave a hole.)
      const REACH = 4.5;
      for (let z = c.z0 - REACH; z < c.z1 + REACH + CELL / 2; z += CELL) for (let x = c.x0 - REACH; x < c.x1 + REACH + CELL / 2; x += CELL) {
        const h = land.at(x, z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const turf = into('turf'), scree = into('scree');
      // (Where there is a grotto, its air is taken with the land's.)
      carveRock(into('rock'), grottoes.length || portalAir || backWay ? (x, y, z) => Math.max(landAir(x, y, z), grottoes.length ? grottoAir(x, y, z) : -9, portalAir ? portalAir(x, y, z) : -9, backWay ? backWay.air(x, y, z) : -9, join ? join.air(x, y, z) : -9) : landAir, {
        min: V(c.x0, Math.floor((Math.min(lo - 2, join?.byCave(c) ? join.high - 2.6 : Infinity)) / CELL) * CELL, c.z0), max: V(c.x1, Math.ceil((hi + 2.8) / CELL) * CELL, c.z1),
        cell: CELL, uvScale: 0.4, otherUvScale: (m) => (m === scree ? 0.55 : 2.3), fromSamples: true, occlusion: [0.3, 0.75], keep, sharp: true, beyond: carved,
        // (Stone that weathers round is shaded round: fewer of its edges are kept as edges.)
        crease: 36 + 24 * rockKind.round,
        // The way the face slopes is felt for half a sample to either side, not a finger's breadth: the roughness of the rock is finer than
        // the carving, and slopes read from it point every way, which puts the carving's points anywhere in their cells and makes splinters.
        normalReach: CELL * 0.5,
        // (Where a rim patch meets the sheet of ground, it is closed on the sheet's own edge, which runs on lines 1.2 metres apart.)
        edge: onSheet ? alongSheet(ground, 0, 0, 1.2) : undefined,
        // A ledge on a rock face is still rock, with moss on it; turf is for ground that is ground.
        // (Nor is the floor of a grotto turf, though the hill over it may be.)
        meshFor: (n, at) => (n.y > 0.74 && rocky.at(at.x, at.z) < 0.5 && !(grottoes.length && grottoAir(at.x, at.y, at.z) > -0.6) && !(backWay && backWay.along(at.x) > -4.6 && backWay.air(at.x, at.y, at.z) > -0.6) && !(join && join.air(at.x, at.y, at.z) > -0.6) ? (loose.at(at.x, at.z) > 0.3 ? scree : turf) : null),
        shade: (q, n, field, other, open) => {
          if (other === turf) { const c = turfAt(q.x, q.z); field[0] = lay.track; field[1] = lay.wet; field[2] = lay.bare; return c; }
          if (other === scree) return earth(q.x, q.z);
          const c = shadeRock(q, n, field, open, 0.25 + 0.75 * rockKind.bedded);
          // Rock out here is lit as if the whole sky stood over it. Inside a grotto it does not,
          // and the rock is made as much darker as the daylight falls off going in.
          // (So in the mouth of the way through the hill.)
          if (backWay && backWay.along(q.x) > -4 && backWay.air(q.x, q.y, q.z) > -0.6) { const dim = 1 - 0.82 * smooth((backWay.along(q.x) + 4) / 3.5); c[0] *= dim; c[1] *= dim; c[2] *= dim; }
          if (join && join.air(q.x, q.y, q.z) > -0.6) { c[0] *= 0.14; c[1] *= 0.14; c[2] *= 0.14; field[1] = Math.max(field[1], 0.5); }
          else if (grottoes.length && grottoAir(q.x, q.y, q.z) > -0.6) { const dim = 1 - 0.86 * grottoDeep; c[0] *= dim; c[1] *= dim; c[2] *= dim; field[1] = Math.max(field[1], 0.5 * grottoDeep); }
          return c;
        },
      });
    };
    kit.group = `p${p.id}`;
    // Behind the house front, between the ends of the wall, there is nothing to see and nothing is made.
    carveLand(meadowPatch, (m) => kit.mesh(m), (at) => at.z > behind - CELL || at.x < p.x0 - 0.2 || at.x > p.x1 + 0.2);
    // The rim of the valley is too steep to climb, but nobody is to leave by it whatever they find.
    // (A grotto runs in under the edge; the rock itself keeps whoever is in it. There the fence
    // begins above the grotto's roof.)
    // (The fence follows each side a little behind it, in short lengths, as far as a few strides beyond the gap; and one crosses the track there,
    // where the valley ends for whoever is walking it, though the track and the land go on.)
    const fenceEnd = vale ? vale.mouth + 8 : g.z1 + 3;
    // (Whether the valley runs on past the house on either side of the ridge.)
    const armW = !!vale?.ridge && sideAt('w', p.z0 - 6) < vale.ridge.x0 - 3, armE = !!vale?.ridge && sideAt('e', p.z0 - 6) > vale.ridge.x1 + 3;
    for (const sideOf of ['w', 'e'] as const) {
      const caves = grottoes.filter((h) => h.side === sideOf), out = sideOf === 'w' ? -1 : 1;
      for (let z = g.z0 - 4; z < fenceEnd; z += 1.5) {
        const xa = sideAt(sideOf, z), xb = sideAt(sideOf, z + 1.5), near = out < 0 ? Math.max(xa, xb) - 1.2 : Math.min(xa, xb) + 1.2, far = out < 0 ? Math.min(xa, xb) - 3 : Math.max(xa, xb) + 3;
        const cave = caves.find((q) => z + 1.5 > q.z - q.r * 1.25 - 2.4 && z < q.z + q.r * 1.25 + 2.4);
        // (The cavern under an arm may reach beneath the valley's side: the barrier stops above its roof there.)
        const cv = backWay?.cavern, over = !!cv && z + 1.5 > cv.z - cv.rz - 2 && z < cv.z + cv.rz + 2 && Math.max(near, far) > cv.x - cv.rx - 2 && Math.min(near, far) < cv.x + cv.rx + 2;
        // (And above the passage from a cave to the cavern, and the way from the house to it, wherever either runs behind the side or crosses under it.)
        let under = -Infinity;
        for (const q of [...(join?.samples ?? []), ...(backWay?.deepSamples ?? [])]) if (q.z > z - 1.5 && q.z < z + 3 && q.x > Math.min(near, far) - 2 && q.x < Math.max(near, far) + 2) under = Math.max(under, q.y + 3.5);
        fences.push({ min: V(Math.min(near, far), cave ? cave.y0 + 4.6 : Math.max(over ? cv!.floor + cv!.height + 1.5 : -Infinity, under, p.floor - 6), z), max: V(Math.max(near, far), p.floor + 80, z + 1.5) });
      }
    }
    fences.push({ min: V(sideAt('w', fenceEnd) - 3, p.floor - 6, fenceEnd - 1.8), max: V(sideAt('e', fenceEnd) + 3, p.floor + 80, fenceEnd) });
    // (Across the house front either side of the house, unless the house stands free and can be walked round.)
    if (!free) fences.push(
      { min: V(armW ? vale!.ridge!.x0 + 1.2 : g.x0 - 3, p.floor - 6, p.z0 - 2.6), max: V(p.x0 - 0.2, p.floor + 80, p.z0 - 1.2) },
      { min: V(p.x1 + 0.2, p.floor - 6, p.z0 - 2.6), max: V(armE ? vale!.ridge!.x1 - 1.2 : g.x1 + 3, p.floor + 80, p.z0 - 1.2) },
    );
    // Up each side of the ridge that has an arm beside it, a fence a little way into the ridge, as along the valley's sides.
    if (vale?.ridge) for (const [arm, x0, x1] of [[armW, vale.ridge.x0 + 1.2, vale.ridge.x0 + 3], [armE, vale.ridge.x1 - 3, vale.ridge.x1 - 1.2]] as const) {
      if (!arm) continue;
      // (With a gap where the way through the hill goes under it, and another where the way down from that does.)
      const through = backWay && Math.abs(backWay.edge - (x0 + x1) / 2) < 4 ? backWay : null, dp = through ? site.backWay!.deep : undefined;
      const gaps = !through ? [] : [{ z: through.z, bottom: through.top + 0.4 }, ...(dp ? [{ z: through.z + dp.toward * dp.leg, bottom: through.start + 0.3 }] : [])].sort((g1, g2) => g1.z - g2.z);
      let from = vale.z0 - 4;
      for (const gap of gaps) {
        fences.push({ min: V(x0, p.floor - 6, from), max: V(x1, p.floor + 80, gap.z - 3) }, { min: V(x0, gap.bottom, gap.z - 3), max: V(x1, p.floor + 80, gap.z + 3) });
        from = gap.z + 3;
      }
      fences.push({ min: V(x0, p.floor - 6, from), max: V(x1, p.floor + 80, p.z0 - 1.2) });
    }
    // Solid rock beside the house, and under the meadow.
    // It stops well behind the face of the scarp, which is cut back in places by a stride or two.
    // (No further than the ridge's edge, where an arm of the valley may run past.)
    if (!free) {
      kit.mass(V(Math.max(p.x0 - 30, (vale?.ridge?.x0 ?? -Infinity) + 3.5), p.floor - 2, houseZ0), V(p.x0 - 0.3, p.floor + cliff - 1.2, p.z0 - 2.2));
      kit.mass(V(p.x1 + 0.3, p.floor - 2, houseZ0), V(Math.min(p.x1 + 30, (vale?.ridge?.x1 ?? Infinity) - 3.5), p.floor + cliff - 1.2, p.z0 - 2.2));
    }
    kit.mass(V(p.x0 - 3, p.floor - 5, p.z0), V(p.x1 + 3, p.floor - 3.2, p.z1 + 3));

    // The path: flags laid in a strip from the door, following the same gentle wander.
    for (let z = p.z0 + 0.05; z < p.z1 - 5.5; z += 1.5) {
      const mid = pathAt(z + 0.75);
      kit.slab('floor', mid - pathHalf, z, mid + pathHalf, z + 1.5, p.floor + 0.012, { ...flag, course: [0.6, 0.8], length: [0.7, 1.2] });
    }

    // Boulders: lumps of the same rock, lying where they came to rest. Mossed on top. Those in
    // the meadow are baked with it; those out in the valley are part of the scenery.
    // Everything out in the valley is built with a kit of its own, whose meshes are scenery.
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const sceneryMesh = (material: string) => wild.mesh(material);
    // Roots, twigs, bushes and the low boughs of firs: wood that is drawn but stops nobody.
    wild.group = 'soft';
    const softBark = wild.mesh('bark');
    // Each kind of tree wears its own bark, so its wood goes to a mesh of its own: an oak's to `bark`, as fallen logs and stumps do.
    const BARK = { oak: 'bark', ash: 'barkAsh', pine: 'barkPine', fir: 'barkFir' } as const;
    const woodOf = (kind: keyof typeof BARK, soft = false): MeshBuilder => { const was = wild.group; wild.group = soft ? 'soft' : 'wild'; const m = wild.mesh(BARK[kind]); wild.group = was; return m; };
    // And stones too small to stop anybody: the cobbles of a stream's bed.
    const softRock = wild.mesh('rock');
    wild.group = 'wild';
    // The scarp at the head of the valley, either side of the meadow, is near enough the door to
    // be baked with the house; the rest of the rim takes its light from the open sky.
    const overCourt = (at: Vector3) => house.some((q) => q.roof === 'sky' && at.x > q.x0 - T / 2 - 0.2 && at.x < q.x1 + T / 2 + 0.2 && at.z > q.z0 - T / 2 - 0.2 && at.z < q.z1 + T / 2 + 0.2)
      || skylights.some((q) => at.x > q.x0 && at.x < q.x1 && at.z > q.z0 && at.z < q.z1);
    kit.group = 'scarp';
    for (const c of headPatches) carveLand(c, (m) => kit.mesh(m), (at) => !overCourt(at));
    kit.group = `p${p.id}`;
    // (Where the stair of a hall goes down out of the land's reach, the land's rock is left out: the hall's own carving has it.)
    const underOwn = (at: Vector3) => grottoes.some((q) => (q.hall || q.mine) && 7 - (at.x - q.edge) * q.inw > UNDER_FROM && Math.abs(at.z - q.z) < 2.6 && at.y < q.y0 + 4.2);
    // (Nor where the way through the hill has gone in under the ridge: from there its own carving has it.)
    // (Nor anywhere near the way down from it, which passes under the foot of the land's rock.)
    const backOwn = (at: Vector3) => !!backWay && ((backWay.along(at.x) > -0.3 && Math.abs(at.z - backWay.z) < 3 && at.y < backWay.top) || (!!backWay.deepAir && at.y < backWay.start - 0.5 && backWay.deepAir(at.x, at.y, at.z) > -1.3));
    // (Nor near the passage from the cave to the cavern, once it has left the cave.)
    const joinOwn = (at: Vector3) => !!join && join.own(at.z) && join.air(at.x, at.y, at.z) > -0.6;
    for (const c of [...rimPatches, ...shelfPatches]) carveLand(c, sceneryMesh, (at) => !underOwn(at) && !backOwn(at) && !joinOwn(at), true);
    if (join && backWay?.deepAir) {
      // The passage from the cave down to the cavern, from where the land's carving leaves off to where the cavern's begins.
      // (It is carved on the same lattice as the cavern, so that the two meet without a crack.)
      // (The cavern's air is taken with it as the cavern is without this passage's own foot in it, which is level and would cut a pit in the floor here.)
      const jn = join, bwy = backWay, deepAir = backWay.cavernAir ?? backWay.deepAir, from = backWay.deepMin, snap = (v: number, o: number) => o + Math.floor((v - o) / 0.28) * 0.28;
      const wetField = indoorField([], jn.high - 9), tone3 = rng.fork('jointone').range(0, 50);
      // (From a hall it is of the hall's kind, which is told that it sees no sky at all; from a cave it is of the house's, like the cavern.)
      // (And from a cave, what of it lies beyond the house and the valley is of that kind too: see `offMap`.)
      const passes: [MeshBuilder, boolean | null][] = jn.hewn ? [[sunless(), null]] : [[kit.mesh('rock'), false], ...(offMap(jn.box[0], jn.box[2]) || offMap(jn.box[1], jn.box[2]) ? [[sunless(), true] as [MeshBuilder, boolean]] : [])];
      for (const [rockFor, out] of passes)
      // (Where it overlaps the carving it takes over from, it is made a few fingers narrower all round, widening to its true size
      // within a stride: so that there its rock stands wholly in front of the other's. Made the same size, the two came through each other in patches.)
      carveRock(rockFor, (x, y, z) => Math.max(deepAir(x, y, z), jn.air(x, y, z)) - jn.inset(z), {
        min: V(snap(jn.box[0], from.x), from.y, snap(jn.box[2], from.z)), max: V(jn.box[1], jn.top + 0.3, jn.box[3]), cell: 0.28, uvScale: 0.45,
        // (It begins a little before the land's carving leaves off: the two are on different lattices, and where they only met there would be chinks.)
        keep: (at) => jn.own(at.z + jn.back) && bwy.joinOwn(at.x, at.z) && (out === null || offMap(at.x, at.z) === out),
        shade: (c, n, field) => {
          wetField(c, n, field);
          const tone = 0.72 + 0.4 * fbm2((c.y + c.x * 0.18) * 2.6, c.z * 0.15 + tone3, 3) + 0.24 * fbm2(c.x * 0.9 + tone3, c.z * 0.9 + c.y * 0.7, 3);
          // (From a cave it begins as dark and as grey as the cave's own rock is made, which is the land's, and comes to its own colour
          // over some strides: begun in its own colour it showed from the cave as a lit doorway.)
          const own = jn.hewn ? 1 : smooth((bwy.joinAt(c.x, c.z).along - 3) / 8), dim = 0.24 + 0.76 * own, grey = 0.73 * tone * (1 - own);
          return [(0.8 * tone * stoneTint[0] * own + grey * 0.92) * dim, (0.74 * tone * stoneTint[1] * own + grey * 0.97) * dim, (0.65 * tone * stoneTint[2] * own + grey * 1.08) * dim];
        },
      });
      // The air in it and in the cavern is told that it is under the hill: the mist that lies in the valley on some days would otherwise
      // fill whatever of them lies beyond the edge of what the sky is reckoned over. (From a cave the box stops below the arm's ground, so
      // that none of the open arm is in it; the top of the passage there is near enough the valley to be reckoned rightly without.)
      {
        const cv = bwy.cavern!, xs = [...jn.samples.map((q) => q.x), cv.x - cv.rx - 2, cv.x + cv.rx + 2], zs = [...jn.samples.map((q) => q.z), cv.z - cv.rz - 2, cv.z + cv.rz + 2];
        underDeep = { min: V(Math.min(...xs) - 2, cv.floor - 1, Math.min(...zs) - 2), max: V(Math.max(...xs) + 2, jn.hewn ? jn.high + 3.4 : jn.high - 0.5, Math.max(...zs) + 2) };
      }
      // (Rock over it, for the sun's shadow only, as over the cavern.)
      for (let i = jn.hewn ? 2 : 10; i < jn.samples.length; i += 4) { const q = jn.samples[i]; kit.mass(V(q.x - 2.2, q.y + 3.5, q.z - 2.2), V(q.x + 2.2, q.y + 4.3, q.z + 2.2)); }
      // Something glows a third and two thirds of the way down it, to draw on whoever looks in.
      for (const t of [0.36, 0.7]) {
        const q = jn.samples[Math.floor(jn.samples.length * t)], side = t < 0.5 ? 1 : -1;
        glows.push({ from: V(q.x, q.y + 1.3, q.z), position: V(q.x + side * 3, q.y + 1.3, q.z + side * 0.4), colour: [0.25, 1.0, 0.72], strength: 1.2 });
      }
    }

    const stones: [number, number, number][] = [];
    let boulders = 0;
    const boulder = (mesh: MeshBuilder, x: number, z: number, size: number, q: Rng) => {
      // These four are no longer used, but are still drawn so that what follows them in the stream is as it was.
      const ts = q.range(0, 60);
      q.range(0.8, 1.3); q.range(0.8, 1.3); q.range(0.55, 0.8);
      const fq = rng.fork(`boulder${boulders++}`);
      const form = boulderForm(fq, size, rockKind);
      const base = ground(x, z);
      // It lies a little way into the ground, deeper on the downhill side than it looks.
      const cy = base + form.half * fq.range(0.3, 0.75);
      const low = Math.min(base, ground(x - form.reach, z), ground(x + form.reach, z), ground(x, z - form.reach), ground(x, z + form.reach));
      const cell = Math.min(0.26, Math.max(0.08, size * 0.14));
      carveRock(mesh, (qx, qy, qz) => form.density(qx - x, qy - cy, qz - z), {
        min: V(x - form.reach, Math.max(low - 0.4, cy - form.sink), z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
        cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
        shade: (c, n, field, _other, open) => {
          const h = c.y - base;
          // Moss on top and in the cracks; damp and dark where it meets the ground.
          field[0] = Math.min(1, Math.max(0, n.y) * 0.95 + (1 - open) * 0.3);
          field[1] = 0.45 * (1 - smooth(h / 0.3));
          field[3] = 0.35;
          const tone = (0.7 + 0.5 * fbm3(c.x * 1.1 + ts, c.y * 1.1, c.z * 1.1, 3)) * (0.66 + 0.34 * open) * (0.75 + 0.25 * smooth(h / 0.25));
          // It is the stone of the cliffs, beds and all, a little greyer for lying out in the weather.
          const t = form.bedShade!(c.x - x, c.y - cy, c.z - z), col = rockColour(tone);
          for (let k = 0; k < 3; k++) col[k] *= 0.3 + 0.7 * (rockKind.dark[k] + (rockKind.pale[k] - rockKind.dark[k]) * t);
          return col;
        },
      });
      stones.push([x, z, size]);
    };
    const clearOfStones = (x: number, z: number, room: number) => !stones.some((q) => Math.hypot(q[0] - x, q[1] - z) < q[2] + room);
    for (let tries = 0; tries < 80 && stones.length < 9; tries++) {
      const x = r.range(p.x0 + 2.5, p.x1 - 2.5), z = r.range(p.z0 + 5, p.z1 - 2.5);
      const size = r.range(0.45, 1.25);
      if (Math.abs(x - pathAt(z)) < 3 + size || !clearOfStones(x, z, size + 1.6)) continue;
      boulder(kit.mesh('rock'), x, z, size, r);
      kit.mass(V(x - size * 0.45, ground(x, z) - 0.3, z - size * 0.45), V(x + size * 0.45, ground(x, z) + size * 0.5, z + size * 0.45));
    }

    // Trees in the meadow: a trunk of staves, and a crown of leaf cards.
    // The time of year colours everything that grows: fresh greens and blossom in spring, deeper
    // greens and drier grass in summer, and in autumn gold, orange and rust with the grass gone to straw.
    const season = site.setting.season ?? 'spring';
    const greens: Colour[] = season === 'autumn'
      ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
      : season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]]
      : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
    const parched = season === 'autumn' ? 0.55 : season === 'summer' ? 0.25 : 0;
    const inFlower = season === 'spring' ? 1 : season === 'summer' ? 0.6 : 0.15;
    const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
    const blossom: Colour = [0.85, 0.2, 0.38];
    const firs: Colour[] = [[0.045, 0.13, 0.04], [0.06, 0.15, 0.04], [0.04, 0.11, 0.05]];
    // Trees used to be a pole with balls of leaves on it, drawn from the same streams of chance
    // as everything planted after them. Those crowns are still drawn, into nothing, so that all
    // that follows stands where it stood; the trees themselves are now grown, each from a
    // stream of its own.
    const spent = new Planting();
    let grown = 0;
    const oakBark: Colour = [0.66, 0.58, 0.5], ashBark: Colour = [0.86, 0.84, 0.8];
    let planted = 0;
    for (let tries = 0; tries < 60 && planted < 5; tries++) {
      const x = r.range(p.x0 + 4.5, p.x1 - 4.5), z = r.range(p.z0 + 4, p.z1 - 3);
      if (Math.abs(x - pathAt(z)) < 3.6) continue;
      if (trees.some((t) => Math.hypot(t[0] - x, t[1] - z) < 5.5) || !clearOfStones(x, z, 1.2)) continue;
      const base = ground(x, z);
      const height = r.range(5.2, 7.6), girth = r.range(0.19, 0.28);
      const tall = height * 1.25, oak = grown % 3 !== 1;
      kit.mass(V(x - girth * 0.6, base, z - girth * 0.6), V(x + girth * 0.6, base + tall * (oak ? 0.3 : 0.48), z + girth * 0.6));
      const green = leafOf(plant.pick(greens));
      spent.broadleaf(x, base, z, height + 0.4, r.range(2.3, 3.1), 620, green, plant, 0.72);
      growTree(planting, kit.mesh(oak ? 'bark' : 'barkAsh'), x, base, z, tall, girth * 1.25, { kind: oak ? 'oak' : 'ash', detail: 1, cards: 1500, cardSize: 0.74, leaf: green, bark: oak ? oakBark : ashBark, soft: woodOf(oak ? 'oak' : 'ash', true) }, rng.fork(`tree${grown++}`));
      trees.push([x, z]);
      planted++;
    }

    // ---- the ground beyond the meadow: a fine sheet over the valley and its rim, a coarse one
    // out to the hills, and mountains behind them
    const snap = (v: number, up: boolean) => (up ? Math.ceil(v / 6) : Math.floor(v / 6)) * 6;
    const fine = { x0: snap(g.x0 - 34, false), x1: snap(g.x1 + 34, true), z0: snap(Math.min(houseZ0 - 40, g.z0 - 34), false), z1: snap(g.z1 + 34, true) };
    // Near its edge the fine sheet is eased onto the coarse one's corners, so the two meet exactly.
    const eased = (x: number, z: number): number => {
      const inside = Math.min(x - fine.x0, fine.x1 - x, z - fine.z0, fine.z1 - z);
      const y = ground(x, z);
      if (inside >= 6) return y;
      const gx = Math.floor(x / 6) * 6, gz = Math.floor(z / 6) * 6, fx = (x - gx) / 6, fz = (z - gz) / 6;
      const coarse = ground(gx, gz) * (1 - fx) * (1 - fz) + ground(gx + 6, gz) * fx * (1 - fz) + ground(gx, gz + 6) * (1 - fx) * fz + ground(gx + 6, gz + 6) * fx * fz;
      return coarse + (y - coarse) * smooth(inside / 6);
    };
    const overlaps = (c: { x0: number; x1: number; z0: number; z1: number }, x0: number, x1: number, z0: number, z1: number) => c.x1 > x0 && c.x0 < x1 && c.z1 > z0 && c.z0 < z1;
    const terrain = { seed: s1, stone: stoneTint, turfScale: 2.3, rockScale: 0.4, colour: (x: number, z: number) => { const c = turfAt(x, z); return [c[0], c[1], c[2], lay.track, lay.wet, lay.bare, 0]; }, rock: (tone: number) => rockColour(tone * 0.8), bare: 0.62 };
    layTerrain(sceneryMesh('turf'), sceneryMesh('rockSheet'), eased, {
      ...terrain, area: fine, cell: 1.2,
      // Not where the land is carved, and not over the house: there it is the turf of the hill
      // above the vaults, left open over every court. Carved patches end on this sheet's own
      // lines, so a cell is either wholly carved or not at all.
      // Nor across the line of the house front, where the ground drops from the hill to the
      // meadow behind the wall: a cell lying across that would be a ramp through the doorway.
      skip: (c) => {
        const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
        // (Round a house that stands free, the sheet is the ground all the way to its walls, and none of it is under the house.)
        if (free) return carved(mx, mz) || insideOuter(mx, mz) || houses.some((b) => footprint(b, mx, mz));
        // Behind the front wall the sheet is the hilltop, right up to the wall; everywhere else
        // it gives way to what is carved.
        const behindWall = mx > p.x0 - 0.2 && mx < p.x1 + 0.2 && mz < frontZ - 0.05;
        if (!behindWall && (carved(mx, mz) || (c.z0 < p.z0 + 0.1 && c.z1 > frontZ - 0.05 && c.x1 > p.x0 - 0.3 && c.x0 < p.x1 + 0.3))) return true;
        // Nor under a building: where the ground rises against its walls, it would come up through its floors.
        if (houses.some((b) => footprint(b, mx, mz))) return true;
        return openings.some((o) => mx > o.x0 && mx < o.x1 && mz > o.z0 && mz < o.z1);
      },
      // Its corners are drawn back to the line of the wall top and out of every opening, so that
      // the turf ends exactly where masonry begins and no gap is left to look down.
      warp: (x, z) => {
        if (x > p.x0 - 0.2 && x < p.x1 + 0.2 && z > frontZ - 0.05 && z < p.z0 + 1.3) z = delve ? MZ0 : frontZ - 0.05;
        // (And to the outer walls of a house that stands free, the same way.)
        if (free && insideOuter(x, z)) {
          let best: [number, number] = [x, z], least = Infinity;
          for (const r of outerRects) {
            const cx = Math.min(r.x1, Math.max(r.x0, x)), cz = Math.min(r.z1, Math.max(r.z0, z));
            for (const [px, pz] of [[r.x0 - 0.02, cz], [r.x1 + 0.02, cz], [cx, r.z0 - 0.02], [cx, r.z1 + 0.02]] as [number, number][]) {
              const d = Math.hypot(px - x, pz - z);
              if (d < least && !insideOuter(px, pz)) { least = d; best = [px, pz]; }
            }
          }
          [x, z] = best;
        }
        // (And to the faces of a building, so that the ground meets its walls and goes no further: to the nearest
        // point of its outline, which is the edge of one of its rectangles not inside another.)
        for (const b of houses) {
          if (!footprint(b, x, z)) continue;
          const turn = b.faces === 'w' ? 1 : -1, u = turn * (z - b.z), v = turn * (x - b.x) + b.d / 2;
          const within = (pu: number, pv: number) => b.rects.some((r) => pu > r.u0 + 0.01 && pu < r.u1 - 0.01 && pv > r.v0 + 0.01 && pv < r.v1 - 0.01);
          let best: [number, number] = [u, v], least = Infinity;
          for (const r of b.rects) {
            const cu = Math.min(r.u1, Math.max(r.u0, u)), cv = Math.min(r.v1, Math.max(r.v0, v));
            for (const [pu, pv] of [[r.u0 - 0.02, cv], [r.u1 + 0.02, cv], [cu, r.v0 - 0.02], [cu, r.v1 + 0.02]] as [number, number][]) {
              const d = Math.hypot(pu - u, pv - v);
              if (d < least && !within(pu, pv)) { least = d; best = [pu, pv]; }
            }
          }
          x = b.x + turn * (best[1] - b.d / 2);
          z = b.z + turn * best[0];
        }
        for (const o of openings) {
          if (x <= o.x0 || x >= o.x1 || z <= o.z0 || z >= o.z1) continue;
          const w = x - o.x0, e = o.x1 - x, n = z - o.z0, so = o.z1 - z, least = Math.min(w, e, n, so);
          if (least === w) x = o.x0; else if (least === e) x = o.x1; else if (least === n) z = o.z0; else z = o.z1;
        }
        return [x, z];
      },
    });
    // The top of the front wall is finished with a coping, which also covers the last hand's
    // breadth between wall and turf; and every opening in the hill has a kerb of stone round it.
    if (!free && !delve) kit.box('stone', V(p.x0 - 0.2, site.top - 0.06, p.z0 - 0.5), V(p.x1 + 0.2, site.top + 0.2, p.z0 + 0.09), coping, coping, 'frontcoping');
    for (const o of house.filter((q) => q.roof === 'sky')) {
      const k = 0.4, y0 = site.top - 0.06, y1 = site.top + 0.3;
      kit.box('stone', V(o.x0 - k, y0, o.z0 - k), V(o.x1 + k, y1, o.z0), coping, coping, `kerbn${o.id}`);
      kit.box('stone', V(o.x0 - k, y0, o.z1), V(o.x1 + k, y1, o.z1 + k), coping, coping, `kerbs${o.id}`);
      kit.box('stone', V(o.x0 - k, y0, o.z0), V(o.x0, y1, o.z1), coping, coping, `kerbw${o.id}`);
      kit.box('stone', V(o.x1, y0, o.z0), V(o.x1 + k, y1, o.z1), coping, coping, `kerbe${o.id}`);
    }
    const reach = 246;
    layTerrain(sceneryMesh('turf'), sceneryMesh('rockSheet'), ground, {
      ...terrain, area: { x0: snap(cxA - reach, false), x1: snap(cxA + reach, true), z0: snap(czA - reach, false), z1: snap(czA + reach, true) }, cell: 3,
      // (Out here what is steeper than a hillside can be walked is rock. As turf, the banks beyond the valley's mouth were smooth
      // rounded pillars the colour of the season's grass, with nothing growing on them: the sheet is too coarse to be a slope of
      // grass, and nothing is planted on ground so steep. As rock they are low crags, which is what such banks are.)
      // (Where the valley was found its hills are the land's own, with long slopes of forty and fifty degrees that are turf and
      // trees in such country; at six metres to a cell they came out as grey slabs. There only the steepest is bare.)
      bare: vale?.terrain ? 0.42 : 0.8,
      skip: (c) => c.x0 >= fine.x0 && c.x1 <= fine.x1 && c.z0 >= fine.z0 && c.z1 <= fine.z1,
    });
    // Far land is drawn with a material of its own, and stops nobody: nobody gets there.
    wild.group = 'soft';
    const farLand = wild.mesh('far');
    wild.group = 'wild';
    // On the nearer hillsides the woods have trees standing in them: each a single tuft of
    // cards with a whole tree painted on it, in the colours of the season.
    // What stands on the hills: each on the highest ground at its bearing, in its range, on a hilltop levelled for it.
    // (A valley that was found has for hills the land it was found in, with detail in fewer octaves the further off.)
    // (And beyond it, from half a mile or so, the ranges a drawn valley has: the land it was found in is an upland of low hills, and
    // with nothing behind them the valley stood in a plain to the horizon.)
    const ranges = farHeights(cxA, czA, p.floor + 30, s2);
    const hills = vale?.terrain ? (x: number, z: number) => {
      const out = Math.hypot(x - cxA, z - czA), found = valleyLand(vale, p.floor, p, x, z, out), w = smooth((out - 480) / 650);
      return w <= 0 ? found : found + (Math.max(found, ranges(x, z)) - found) * w;
    } : ranges;
    const landmarks = (site.landmarks ?? []).map((l) => {
      const top = crestAt(hills, cxA, czA, (l.angle * Math.PI) / 180, l.range === 'near' ? 255 : 400, l.range === 'near' ? 330 : 540);
      return { ...l, ...top, r: l.kind === 'castle' ? 40 : l.kind === 'ruin' ? 36 : 19 };
    });
    layMountains(farLand, cxA, czA, p.floor + 30, s2, stoneTint, (x, y, z, fir, own) => {
      const c = fir ? firs[Math.floor(own * 2.999)] : greens[Math.floor(own * (greens.length - 0.001))], t = (fir ? 0.75 : 0.5) + 0.3 * ((own * 7.3) % 1);
      const tall = fir ? 7.5 + 6.5 * ((own * 3.7) % 1) : 6 + 4.5 * ((own * 3.7) % 1);
      planting.farTree(fir, x, y - 0.5, z, tall * (fir ? 0.42 : 0.95), tall, own * 6.283, [c[0] * t, c[1] * t, c[2] * t]);
    }, landmarks.map((l) => ({ x: l.x, z: l.z, r: l.r, y: l.y })), ground, vale?.terrain ? hills : undefined);
    // Crags. The hills are a sheet, too coarse to be rock and drawn with a material that only suggests it; so the stone of the valley
    // was never seen at any size but a cliff's. Here and there on the nearer hills a mass of it now stands out of the sheet: a tor
    // forty to eighty metres high, with a summit or two, faces to its foot, buttresses, gullies and clefts, carved as the cliffs are
    // and of the same stone, but five times as coarsely, since nobody comes nearer than a furlong. Its beds, its stains and the
    // relief of its faces are the rock material's doing, which draws them at the size the distance calls for.
    {
      const cq = rng.fork('crags'), count = cq.int(2, 4), turn = cq.range(0, Math.PI * 2), CELL = 1.6;
      for (let k = 0; k < count; k++) {
        const angle = turn + (k / count) * Math.PI * 2 + cq.range(-0.5, 0.5), far = cq.range(262, 335);
        const x0 = cxA + Math.cos(angle) * far, z0 = czA + Math.sin(angle) * far, own = cq.fork(`crag${k}`), seedC = own.int(1, 9999);
        // (Not where something is built on the hills.)
        if (landmarks.some((l) => Math.hypot(l.x - x0, l.z - z0) < l.r + 75)) continue;
        // One to three summits close together, the first the highest.
        const tops: number[][] = [];
        for (let t = 0, n = own.int(1, 3); t < n; t++) {
          const a = own.range(0, Math.PI * 2), d = t === 0 ? 0 : own.range(18, 38);
          // (Lower and broader than they were: at forty to eighty metres on a base of thirty or forty, each stood as a pyramid on its hill.)
          tops.push([x0 + Math.cos(a) * d, z0 + Math.sin(a) * d, (t === 0 ? own.range(26, 48) : own.range(14, 30)), (t === 0 ? own.range(32, 48) : own.range(18, 30))]);
        }
        const reachC = Math.max(...tops.map((t) => Math.hypot(t[0] - x0, t[1] - z0) + t[3])) + 16, high = Math.max(...tops.map((t) => t[2])) + 12;
        // The hill it stands on, read once on a lattice: the hills' own reckoning is too slow to ask at every point of the carving.
        const gx0 = x0 - reachC - 4, gz0 = z0 - reachC - 4, gn = Math.ceil((reachC * 2 + 8) / 4) + 1, under = new Float32Array(gn * gn);
        let low = Infinity, top = -Infinity;
        for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) { const h = hills(gx0 + i * 4, gz0 + j * 4); under[j * gn + i] = h; low = Math.min(low, h); top = Math.max(top, h); }
        const hillAt = (x: number, z: number): number => {
          const fx = Math.min(gn - 1.001, Math.max(0, (x - gx0) / 4)), fz = Math.min(gn - 1.001, Math.max(0, (z - gz0) / 4)), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
          return (under[j * gn + i] * (1 - tx) + under[j * gn + i + 1] * tx) * (1 - tz) + (under[(j + 1) * gn + i] * (1 - tx) + under[(j + 1) * gn + i + 1] * tx) * tz;
        };
        const cleft = new Float32Array(5);
        /** How high the stone stands over the hill at a spot: nothing beyond its foot, and steepest there. */
        const stands = (x: number, z: number): number => {
          let h = 0;
          // (Steep at its sides and broad over the top, as a tor is: a heap of blocks, not a cone.)
          for (const t of tops) { const u = Math.hypot(x - t[0], z - t[1]) / t[3]; if (u < 1) h = Math.max(h, t[2] * Math.pow(1 - u * u, 0.6) * (0.8 + 0.4 * fbm2(x * 0.03 + seedC, z * 0.03, 2))); }
          return h;
        };
        const air = (x: number, y: number, z: number): number => {
          const plain = (y - hillAt(x, z) + 3 - stands(x, z)) / 1.9;
          if (plain > 14 || plain < -14) return plain;
          // Its faces are pushed out into buttresses and drawn back into gullies, and cleft along its great joints.
          let out = (fbm3(x * 0.035, y * 0.014, z * 0.035, 3, seedC) - 0.5) * 20 + (fbm3(x * 0.12, y * 0.05, z * 0.12, 2, seedC + 3) - 0.5) * 7;
          cells3((x + y * 0.1) / 15 + seedC * 0.21, 0.5, (z - y * 0.05) / 15, seedC + 9, 0.8, cleft, 0);
          const which = ((cleft[2] + cleft[3]) * 5.3) % 1;
          if (which > 0.45) out -= (3 + 8 * (which - 0.45)) * (1 - smooth((cleft[4] * 15) / 4));
          // (Sideways for the faces: away from the middle of the crag. And a little downward, so that its top is broken ground.)
          const dx = x - x0, dz = z - z0, dl = Math.hypot(dx, dz) || 1;
          const sx = x - (dx / dl) * out, sz = z - (dz / dl) * out;
          return (y + out * 0.2 - hillAt(x, z) + 3 - stands(sx, sz)) / 1.9;
        };
        const snapC = (v: number, up: boolean) => (up ? Math.ceil(v / CELL) : Math.floor(v / CELL)) * CELL;
        const greenSeed = own.int(1, 9999);
        carveRock(softRock, air, {
          min: V(snapC(x0 - reachC, false), snapC(low - 6, false), snapC(z0 - reachC, false)), max: V(snapC(x0 + reachC, true), snapC(top + high, true), snapC(z0 + reachC, true)),
          cell: CELL, uvScale: 0.4, fromSamples: true, occlusion: [CELL, CELL * 3], sharp: true, crease: 36 + 24 * rockKind.round, normalReach: CELL * 0.5,
          // Only the crag itself: where no stone stands over the hill, the hill's own sheet is the ground.
          keep: (c) => stands(c.x, c.z) > 1.5 || c.y > hillAt(c.x, c.z) + 1,
          shade: (q, n, field, _other, open) => {
            const c = shadeRock(q, n, field, open, 0.25 + 0.75 * rockKind.bedded);
            // What lies back far enough to hold soil is green, in patches, as the hill about it is.
            field[0] = Math.max(field[0], 2.8 * smooth((n.y - 0.7) / 0.16) * smooth((fbm2(q.x * 0.07 + greenSeed, q.z * 0.07, 3) - 0.36) / 0.2));
            return c;
          },
        });
      }
    }
    // (Drawn but solid to nobody, and turned to face the valley.)
    wild.group = 'soft';
    landmarkSpots.push(...landmarks.map((l) => ({ kind: l.kind, x: l.x, y: l.y, z: l.z })));
    landmarks.forEach((l, i) => buildLandmark(l.kind, l.x, l.y, l.z, Math.atan2(czA - l.z, cxA - l.x), (material) => wild.mesh(material), rng.fork(`landmark${i}`), [0.82 * stoneTint[0], 0.78 * stoneTint[1], 0.7 * stoneTint[2]]));
    // The keep over a village: on its promontory, a castle's curtain walls round its tower (which is built with the towers), with
    // the gate towards the end the ledge comes up at; solid, since it can be walked to.
    if (site.keep && keepShelf && site.keep.kind === 'castle') {
      const k = site.keep, was = wild.group, size = { W: 12, D: 18 };
      wild.group = 'wild';
      buildLandmark('castle', k.x, swells(k.x, k.z) + keepShelf.height, k.z, keepShelf.rise === 'n' ? Math.PI / 2 : -Math.PI / 2, (material) => wild.mesh(material), rng.fork('keep'), [0.82 * stoneTint[0], 0.78 * stoneTint[1], 0.7 * stoneTint[2]], 0.6, true, size);
      wild.group = was;
    }
    wild.group = 'wild';
    // What far land is covered with, for whatever draws it: its woods and its open ground, by the season.
    const mean = greens.reduce((m, c) => [m[0] + c[0] / greens.length, m[1] + c[1] / greens.length, m[2] + c[2] / greens.length], [0, 0, 0]);
    farCover = { wood: [mean[0] * 0.62, mean[1] * 0.62, mean[2] * 0.62], grass: season === 'autumn' ? [0.24, 0.21, 0.08] : season === 'summer' ? [0.15, 0.21, 0.06] : [0.15, 0.24, 0.06] };

    // ---- what lies and grows in the valley
    // (The yard before a mine: the ground between its mouth and the tip, and the shed's and the stacks' beside the mouth.)
    const inYard = (x: number, z: number, m: number) => grottoes.some((q) => { if (!q.mine) return false; const inside = (x - q.edge) * q.inw, off = Math.abs(z - q.z); return inside > 1 && ((inside < 8 + q.mine.heap && off < 1.6 + m) || (inside < 13.5 && off < 7 + m)); });
    // (The floor of the charcoal burners' camp counts as within doors for whatever asks this: nothing grows on it and nothing is strewn on it.)
    const inHouse = (x: number, z: number, m: number) => (x > houseX0 - m && x < houseX1 + m && z > houseZ0 - m && z < frontZ + 0.4) || (!!site.camp && Math.hypot(x - site.camp.x, z - site.camp.z) < site.camp.r * 0.9 + Math.min(m, 1)) || heapAt(x, z) > 0.2 || inYard(x, z, Math.min(m, 1));
    const inMeadow = (x: number, z: number, m: number) => x > p.x0 - m && x < p.x1 + m && z > frontZ && z < p.z1 + m;
    // (In the valley: between its sides, and no further down than a few strides past the gap, where whoever walks it is stopped.)
    const inGrounds = (x: number, z: number, m: number) => (vale ? z > g.z0 && z < vale.mouth + 6 - m && insideAt(x, z) > m : x > g.x0 + m && x < g.x1 - m && z > g.z0 && z < g.z1 - m);
    const offTrack = (x: number, z: number) => Math.abs(x - pathAt(z)) - pathHalf;
    // How far a point is outside whatever lies in the valley: negative inside a pond's hollow or a ring.
    const clearOfFeatures = (x: number, z: number) => {
      let clear = Math.min(Infinity, ...lies.map((f) => Math.hypot(x - f.x, z - f.z) - (f.kind === 'pond' ? shoreOf(f, x - f.x, z - f.z) : f.r * (f.kind === 'stones' ? 1.5 : 1.15))));
      for (const c of channels) if (along(c, x, z, 12)) clear = Math.min(clear, nearest.d - nearest.half - 0.4);
      // A tower has clear ground about it.
      for (const t of towers) clear = Math.min(clear, Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) - t.half - 2.6);
      // Nor does anything stand in the yard of a mine.
      for (const q of grottoes) if (q.mine) { const inside = (x - q.edge) * q.inw; if (inside > 0 && inside < 14) clear = Math.min(clear, Math.abs(z - q.z) - 8); else if (inside < 9 + q.mine.heap) clear = Math.min(clear, Math.abs(z - q.z) - 3.4); }
      // The charcoal burners felled their clearing.
      if (site.camp) clear = Math.min(clear, Math.hypot(x - site.camp.x, z - site.camp.z) - site.camp.r * 1.08);
      // (More of it about a large building than a cottage: it is meant to be seen.)
      for (const b of houses) clear = Math.min(clear, outside(b, x, z) - (b.style === 'imperial' ? 4 : 1.8));
      // Nor before the mouth of the way through the hill.
      if (backWay && backWay.along(x) > -9 && backWay.along(x) < -1.5 && Math.abs(z - backWay.z) < 2.4) clear = Math.min(clear, -1);
      // Nor before the mouth of a grotto.
      for (const q of grottoes) { const inside = (x - q.edge) * q.inw; if (inside > 2 && inside < 9.5 && Math.abs(z - q.z) < 2.2) clear = Math.min(clear, -1); }
      // Nothing stands in the way up to a terrace.
      for (const t of terraces) if (shelfAt(t, x, z) && shelf.way > 0.05 && !shelf.top) clear = Math.min(clear, -1);
      return clear;
    };
    // How deep the water stands over a point of ground at height `y`: less than nothing if it is dry.
    // Whether that water is running is left in `running`.
    let running = false;
    const waterOver = (x: number, z: number, y: number) => {
      let deep = Math.max(-Infinity, ...ponds.map((f) => (across(f, x, z) < 1.2 ? f.level - y : -Infinity)));
      running = false;
      // A stream is as wide as its banks let it be, which is wider than its bed where they lie back.
      for (const c of channels) if (along(c, x, z, 5) && nearest.d < nearest.half + 2.5 && nearest.bed + nearest.depth - y > deep) { deep = nearest.bed + nearest.depth - y; running = true; }
      return deep;
    };
    // More boulders, some of them large, away from the track.
    for (let tries = 0; tries < 400 && stones.length < 44; tries++) {
      const x = plant.range(g.x0 + 6, g.x1 - 6), z = plant.range(g.z0 + 6, g.z1 - 6);
      const size = plant.chance(0.2) ? plant.range(1.3, 2.4) : plant.range(0.45, 1.2);
      if (!inGrounds(x, z, 6) || inMeadow(x, z, size + 1) || inHouse(x, z, size + 2) || (site.keep && Math.hypot(x - site.keep.x, z - site.keep.z) < 18) || offTrack(x, z) < 2.5 + size || offFoot(x, z) < 1.4 + size || !clearOfStones(x, z, size + 2) || slopeOf(ground, x, z, 0.6) > 0.5 || clearOfFeatures(x, z) < size + 2.5) continue;
      boulder(sceneryMesh('rock'), x, z, size, plant);
    }
    // Small stones are a dozen shapes carved once and set down again and again, each turned,
    // sized and tinted differently. They are carved only when the first is wanted.
    // The smallest, a stream's cobbles, are carved more coarsely: there are hundreds of them and each is a hand across.
    const stoneShapes: (MeshBuilder[] | null)[] = [null, null];
    const layStone = (into: MeshBuilder, x: number, y: number, z: number, size: number, tone: number, q: Rng, coarse = false) => {
      const shapes = (stoneShapes[coarse ? 1 : 0] ??= Array.from({ length: 12 }, (_, k) => {
        const form = boulderForm(rng.fork(`scree${k}`), 0.3, rockKind), m = new MeshBuilder();
        carveRock(m, form.density, {
          min: V(-form.reach, -form.sink, -form.reach), max: V(form.reach, form.rise, form.reach), cell: coarse ? 0.17 : 0.1, uvScale: 0.5, fromSamples: true, occlusion: [0.1, 0.2], sharp: true,
          shade: (_c, _n, _f, _o, open) => [open, open, open],
        });
        return m;
      }));
      const shape = q.pick(shapes), k = size / 0.3, turn = q.range(0, Math.PI * 2), cos = Math.cos(turn), sin = Math.sin(turn);
      into.append(shape, (v) => {
        const px = v.p[0] * k, pz = v.p[2] * k, nx = v.n[0], nz = v.n[2];
        v.p[0] = x + px * cos - pz * sin; v.p[1] = y + v.p[1] * k; v.p[2] = z + px * sin + pz * cos;
        v.n[0] = nx * cos - nz * sin; v.n[2] = nx * sin + nz * cos;
        const open = v.colour[0] * Math.min(1, 0.55 + (v.p[1] - y) / size + 0.5);
        const c = rockColour(tone * (0.55 + 0.45 * open));
        v.colour[0] = c[0]; v.colour[1] = c[1]; v.colour[2] = c[2];
        v.field[0] = Math.max(0, v.n[1]) * 0.6; v.field[3] = 0.2;
        v.open = open;
      });
    };
    // What has come down off the cliffs: blocks lying on the scree and out from its foot, and
    // the scree itself, which is small stones by the hundred.
    let screeLaid = 0;
    if (walled) {
      const fall = rng.fork('rockfall');
      const lying: [number, number, number][] = [];
      for (let j = 2; j < land.nz - 2; j += 2) for (let i = 2; i < land.nx - 2; i += 2) {
        const depth = loose.data[j * land.nx + i];
        if (depth < 0.06) continue;
        const x = land.x0 + (i + fall.range(-1, 1)) * CELL, z = land.z0 + (j + fall.range(-1, 1)) * CELL;
        if (offTrack(x, z) < 2 || clearOfFeatures(x, z) < 1) continue;
        if (fall.chance(0.012 * Math.min(1, depth / 0.4)) && clearOfStones(x, z, 1.2)) boulder(sceneryMesh('rock'), x, z, fall.chance(0.25) ? fall.range(1.1, 1.9) : fall.range(0.45, 1), fall);
        else if (fall.chance(0.5 * Math.min(1, depth / 0.5))) lying.push([x, z, fall.range(0.1, 0.24) + 0.25 * fall.next() * fall.next()]);
      }
      const into = sceneryMesh('rock');
      for (const [x, z, size] of lying) layStone(into, x, ground(x, z) + size * fall.range(0.05, 0.3), z, size, fall.range(0.6, 1.1), fall);
      screeLaid = lying.length;
    }
    // The bed of a stream is cobbles: the current has carried off everything smaller. Most lie
    // under the water and show through it; along the edges, and here and there in the middle,
    // they stand out of it, and it is these that make running water look as if it runs.
    {
      const bedded = rng.fork('cobbles');
      for (const c of channels) {
        for (let k = 1; k < c.x.length - 1; k++) {
          const ax = c.x[k], az = c.z[k], bx = c.x[k + 1] - ax, bz = c.z[k + 1] - az, l = Math.hypot(bx, bz) || 1;
          // Not where it runs out into still water: a pond's bed is mud.
          if (ponds.some((f) => across(f, ax, az) < 1.05)) continue;
          for (let j = 0, n = Math.round(l * (5.6 + 3 * c.half)); j < n; j++) {
            const t = bedded.next(), edge = bedded.chance(0.6);
            // Along one edge of the bed, or anywhere across it; and of those along the edge,
            // some lie out on the bank: fewer the further from the water, smaller, and sunk in
            // the turf. A bed of stones does not stop at a line.
            const out = edge && bedded.chance(0.45) ? Math.min(2.4, -Math.log(1 - bedded.next() * 0.98) * 0.6) : 0;
            const off = edge ? (bedded.chance(0.5) ? 1 : -1) * (c.half * bedded.range(0.8, 1.25) + out) : c.half * bedded.range(-0.85, 0.85);
            const x = ax + bx * t - (bz / l) * off, z = az + bz * t + (bx / l) * off;
            const size = (edge ? bedded.range(0.1, 0.22) + 0.22 * bedded.next() * bedded.next() : bedded.range(0.07, 0.17) + (bedded.chance(0.06) ? bedded.range(0.1, 0.25) : 0)) * (1 - 0.22 * out);
            // Not on the track, where they would be underfoot.
            if (out > 0 && offTrack(x, z) < 1.3) continue;
            // Wet stone is dark stone; stones up the bank are dry, and paler.
            layStone(softRock, x, ground(x, z) + size * (out > 0 ? bedded.range(-0.32, 0.02) : bedded.range(-0.1, 0.25)), z, size, bedded.range(0.34, 0.7) + 0.22 * Math.min(1, out), bedded, size < 0.3);
          }
        }
      }
    }
    // Rocks in the shallows of every pond but the smallest, half in the water and half out, and
    // on its island if it has one.
    {
      const stony = rng.fork('shallows');
      for (const f of ponds) {
        if (f.r < 4.5) continue;
        // (The side the landing stage is built on is kept clear, as it is of reeds.)
        let near = 0, nearD = Infinity;
        for (let z = f.z - 30; z <= f.z + 30; z += 1) {
          const d = Math.hypot(pathAt(z) - f.x, z - f.z);
          if (d < nearD) { nearD = d; near = z; }
        }
        const jx = (pathAt(near) - f.x) / nearD, jz = (near - f.z) / nearD;
        for (let k = 0, n = Math.round(f.r * 0.9); k < n; k++) {
          const a = stony.range(0, Math.PI * 2), out = shoreOf(f, Math.cos(a), Math.sin(a)) * stony.range(0.6, 0.86), size = stony.range(0.3, 0.75) + (stony.chance(0.2) ? stony.range(0.3, 0.7) : 0);
          if (Math.cos(a) * jx + Math.sin(a) * jz > 0.8) continue;
          boulder(sceneryMesh('rock'), f.x + Math.cos(a) * out, f.z + Math.sin(a) * out, size, stony.fork(`s${k}`));
        }
        if (f.isle) for (let k = 0; k < 3; k++) {
          const a = stony.range(0, Math.PI * 2), out = f.isle.r * stony.range(0.5, 1.1);
          boulder(sceneryMesh('rock'), f.isle.x + Math.cos(a) * out, f.isle.z + Math.sin(a) * out, stony.range(0.4, 0.9), stony.fork(`i${k}`));
        }
      }
    }
    // Where a stream rises and where it goes to ground there are boulders: the spring comes
    // out from among them, and the sink takes the water down between them.
    {
      const wet = rng.fork('springs');
      (site.streams ?? []).forEach((st, k) => {
        for (const [end, towards] of [[st.course[0], st.course[1]], [st.course[st.course.length - 1], st.course[st.course.length - 2]]] as const) {
          if ((end === st.course[0] ? st.from : st.to) === 'pond') continue;
          // Behind the end of the stream, away from the way it runs, and to either side of it.
          const l = Math.hypot(end[0] - towards[0], end[1] - towards[1]) || 1, ux = (end[0] - towards[0]) / l, uz = (end[1] - towards[1]) / l;
          for (const [back, sideways, size] of [[1.3, 0, 1.0], [0.5, 1.5, 0.75], [0.4, -1.4, 0.65], [1.9, 1.0, 0.55], [1.7, -1.1, 0.5]]) {
            const x = end[0] + ux * back * (1 + 0.4 * st.width) - uz * sideways * (1 + 0.25 * st.width), z = end[1] + uz * back * (1 + 0.4 * st.width) + ux * sideways * (1 + 0.25 * st.width);
            const bx = x + wet.range(-0.3, 0.3), bz = z + wet.range(-0.3, 0.3), big = size * wet.range(0.85, 1.3) * (0.8 + 0.12 * st.width);
            // Under a fall there is no boulder behind the pool: that is where the water comes down.
            if (st.from === 'fall' && end === st.course[0] && sideways === 0) continue;
            boulder(sceneryMesh('rock'), bx, bz, big, wet.fork(`b${k}`));
          }
        }
      });
    }
    // Woods first, because what grows under and between trees depends on where they stand.
    // Trees thin out into glades, firs take the higher ground, and here and there a stand is in
    // blossom. In the valley the trunks are solid; the track and the meadow are kept clear.
    const barkMesh = sceneryMesh('bark');
    const firBark: Colour = [0.62, 0.5, 0.42], pineBark: Colour = [0.98, 0.6, 0.42], pineGreen: Colour = [0.07, 0.15, 0.07];
    const canopies: [number, number, number, number][] = trees.map((t) => [t[0], t[1], 3.4, 0.75]);
    const tree = (x: number, z: number, y: number, detail: number, pick?: { oak: boolean; roll: number; old?: boolean }) => {
      const lift = y - p.floor;
      const kind = fbm2(x * 0.018 + s1, z * 0.018 + s2, 2) + lift * 0.006;
      const inBlossom = season === 'spring' && fbm2(x * 0.03 - s2, z * 0.03 + s1 * 2, 2) > 0.7;
      if (kind > 0.56 && !pick) {
        const height = plant.range(8, 14), radius = plant.range(1.9, 2.8);
        const girth = plant.range(0.16, 0.26), needle = leafOf(plant.pick(firs));
        // (The old boughs are still drawn from the stream, into nothing, as the old crowns are.)
        spent.conifer(x, y, z, height, radius, Math.round(5 + 6 * detail), needle, plant);
        spent.needles.matrices.length = spent.needles.colours.length = spent.needles.centres.length = 0;
        const own = rng.fork(`fir${grown++}`);
        if (detail > 0.3) {
          // Pines stand in patches among the spruce, on the drier knolls.
          const pine = fbm2(x * 0.05 - s1, z * 0.05 + s2 * 2, 2) > 0.57;
          growConifer(planting, woodOf(pine ? 'pine' : 'fir'), x, y, z, height * (pine ? 1.25 : 1.2), radius * (pine ? 1.15 : 1), girth * (pine ? 1.15 : 1.05), {
            kind: pine ? 'pine' : 'spruce', detail, needle: pine ? leafOf(pineGreen) : needle, bark: pine ? pineBark : firBark, shaded: true, soft: woodOf(pine ? 'pine' : 'fir', true),
          }, own);
        } else {
          // Far off, a trunk and tiers of boughs are enough.
          layTrunk(woodOf('fir'), x, y, z, height * 0.9, girth, firBark);
          planting.conifer(x, y, z, height, radius, Math.round(5 + 6 * detail), needle, own);
        }
        canopies.push([x, z, radius * 1.15, 1]);
      } else {
        const height = plant.range(5.5, 9.5), spread = plant.range(2.2, 3.4);
        const girth = plant.range(0.17, 0.3);
        plant.range(-0.4, 0.4); plant.range(-0.4, 0.4);
        const green = leafOf(inBlossom ? blossom : plant.pick(greens));
        spent.broadleaf(x, y, z, height, spread, Math.round(26 + 260 * detail), green, plant, 1.7 - 0.85 * detail);
        spent.leaves.matrices.length = spent.leaves.colours.length = spent.leaves.centres.length = 0;
        // Which kind grows where goes by patches, as woods do; a tree in blossom is of the spreading kind.
        const oak = pick ? pick.oak : inBlossom || fbm2(x * 0.045 + s2 * 3, z * 0.045 - s1, 2) > 0.44;
        // One tree in six is old: half as tall again, twice as thick, and carrying far more leaf.
        const old = pick ? (pick.old ? 1 : 0) : detail > 0.7 && grown % 6 === 2 ? 1 : 0;
        // Beyond that, trees are not all of an age: now and then one is a giant, towering over the
        // rest, and about one in four is young, slender and low. (A stream of its own, so no other choice moves.)
        const age = rng.fork(`age${grown}`), mix = typeof location !== 'undefined' && new URLSearchParams(location.search).has('agemix'), roll = pick ? pick.roll : mix ? [0.5, 0.5, 0.06, 0.01, 0.9, 0.9, 0.5, 0.9, 0.5][grown % 9] : age.next(); // (`?agemix` gives every kind of age in turn, for looking at)
        const giant = detail > 0.5 && roll < 0.05 ? age.range(1.7, 2.2) : 1, young = roll > 0.7 ? age.range(0.42, 0.7) : 1;
        // And very rarely an oak of great age that has spread rather than risen: a short, vast trunk
        // and limbs that reach out low and far, its crown a roof over the ground round it.
        const epic = detail > 0.7 && (oak || mix) && roll >= 0.05 && roll < 0.075;
        const wide = epic ? age.range(2.0, 2.5) : 1;
        const tall = giant * young * (epic ? 0.95 : 1), stout = epic ? 2.6 : giant > 1 ? giant * 1.15 : young * young, leafy = epic ? 5 : giant > 1 ? giant * giant * 0.75 : young * 0.8;
        const reach = growTree(planting, woodOf(oak ? 'oak' : 'ash'), x, y, z, height * (oak ? 1.2 : 1.45) * (1 + 0.45 * old) * tall, girth * (oak ? 1.2 : 0.9) * (1 + 1.1 * old) * stout, {
          kind: oak ? 'oak' : 'ash', detail, cards: Math.round((110 + 1050 * detail) * (1 + 0.7 * old) * leafy), cardSize: (1.8 - 1.02 * detail) * (1 + 0.15 * old) * (giant > 1 || epic ? 1.15 : 1) * (epic ? 1.15 : 1), wide, leaf: green, bark: oak ? oakBark : ashBark, shaded: true, soft: woodOf(oak ? 'oak' : 'ash', true),
          // (Its boughs kept out of the house: a great oak by a house standing free reached over its roofs and drooped into its court,
          // and through the arch from the court, where it stopped whoever walked through.)
          keepOut: (q) => q.y < site.top + 1.5 && inHouse(q.x, q.z, 0.4),
        }, rng.fork(`tree${grown++}`));
        canopies.push([x, z, Math.max(spread, reach) * 1.1, 0.75]);
      }
    };
    const woods = (area: { x0: number; x1: number; z0: number; z1: number }, step: number, f: (x: number, z: number) => number, skip: (x: number, z: number) => boolean) => {
      for (let gz = area.z0; gz < area.z1; gz += step) for (let gx = area.x0; gx < area.x1; gx += step) {
        const x = gx + plant.range(0.1, 0.9) * step, z = gz + plant.range(0.1, 0.9) * step;
        if (skip(x, z) || inHouse(x, z, 3) || inMeadow(x, z, 2.5)) continue;
        if (offTrack(x, z) < 3.2 || offFoot(x, z) < 1.8 || !clearOfStones(x, z, 0.8) || clearOfFeatures(x, z) < 3) continue;
        if (fbm2(x * 0.03 + s2, z * 0.03 + s1, 3) < 0.46 || slopeOf(f, x, z, 1.5) > 0.75) continue;
        // Full detail anywhere the player can stand; less with distance beyond the rim.
        const out = vale ? Math.max(0, -insideAt(x, z), g.z0 - z, z - vale.mouth - 8) : Math.max(0, g.x0 - x, x - g.x1, z - g.z1, g.z0 - z);
        tree(x, z, f(x, z), Math.max(0, 1 - out / 50));
      }
    };
    const inFine = (x: number, z: number) => x > fine.x0 && x < fine.x1 && z > fine.z0 && z < fine.z1;
    // An island carries a tree of its own: a pine or a spruce, small, as trees are on a rock in the water.
    for (const f of ponds) {
      if (!f.isle) continue;
      const own = rng.fork(`isletree${f.x}`), y = ground(f.isle.x, f.isle.z), pine = own.chance(0.5);
      growConifer(planting, woodOf(pine ? 'pine' : 'fir'), f.isle.x, y - 0.1, f.isle.z, own.range(4.5, 7), own.range(1.1, 1.6), 0.13, { kind: pine ? 'pine' : 'spruce', detail: 1, needle: leafOf(pine ? pineGreen : firs[0]), bark: pine ? pineBark : firBark, shaded: true, soft: woodOf(pine ? 'pine' : 'fir', true) }, own);
      canopies.push([f.isle.x, f.isle.z, 1.6, 1]);
    }
    // (Not where the keep stands.)
    // (Nor at the far end of a terrace, where a shrine or a cairn stands.)
    const shelfEnds = terraces.map((t) => { const z = t.rise === 'n' ? t.z1 - 2.4 : t.z0 + 2.4; return [sideAt(t.side, z) + (t.side === 'w' ? 1 : -1) * (4.7 + t.depth * 0.62), z]; });
    const row = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('treerow') : null; // (no woods when a row is asked for, so the row stands alone)
    if (!row) woods(fine, 6.2, eased, (x, z) => (!!site.keep && Math.hypot(x - site.keep.x, z - site.keep.z) < (site.keep.kind === 'castle' ? 34 : 16)) || shelfEnds.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 4.5));
    if (!row) woods({ x0: cxA - reach + 6, x1: cxA + reach - 6, z0: czA - reach + 6, z1: czA + reach - 6 }, 10, ground, inFine);
    // `?treerow=x,z`: a row of every kind of broadleaf in turn, seven metres apart along x, for looking at.
    if (row) {
      const [rx, rz] = row.split(',').map(Number);
      const kinds = [{ oak: false, roll: 0.9 }, { oak: true, roll: 0.9 }, { oak: false, roll: 0.5 }, { oak: true, roll: 0.5 }, { oak: false, roll: 0.01 }, { oak: true, roll: 0.01 }, { oak: true, roll: 0.5, old: true }, { oak: true, roll: 0.06 }];
      kinds.forEach((k, i) => { const tx = rx + i * 5.5 + (k.roll === 0.06 ? 7 : 0), tz = rz; tree(tx, tz, ground(tx, tz), 1, k); });
    }

    /**
     * The lie of the land, as four numbers at any point, each from 0 to 1. Everything that grows
     * below the trees is placed by them, and so is the height of the grass.
     *  - shade: how much of the sky the trees take, plus the foot of the rim that faces away from the sun;
     *  - wet: low ground, the margins of water, and the shaded foot of rock, where water gathers;
     *  - wear: where feet go, along the track, before the door and about the things people visit;
     *  - thin: where soil is shallow, on slopes and against rock.
     */
    const cellS = 1.5, sx0 = g.x0 - 14, sz0 = g.z0 - 8;
    const snx = Math.ceil((g.x1 + 14 - sx0) / cellS) + 1, snz = Math.ceil((g.z1 + 14 - sz0) / cellS) + 1;
    const cover = new Float32Array(snx * snz);
    for (const [cx, cz, cr, dense] of canopies) {
      const i0 = Math.max(0, Math.floor((cx - cr - sx0) / cellS)), i1 = Math.min(snx - 1, Math.ceil((cx + cr - sx0) / cellS));
      const j0 = Math.max(0, Math.floor((cz - cr - sz0) / cellS)), j1 = Math.min(snz - 1, Math.ceil((cz + cr - sz0) / cellS));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const d = Math.hypot(sx0 + ii * cellS - cx, sz0 + jj * cellS - cz) / cr;
        if (d < 1) cover[jj * snx + ii] = Math.min(1, cover[jj * snx + ii] + dense * (1 - d * d));
      }
    }
    const shadeAt = (x: number, z: number): number => {
      const fx = Math.min(snx - 1.001, Math.max(0, (x - sx0) / cellS)), fz = Math.min(snz - 1.001, Math.max(0, (z - sz0) / cellS));
      const ii = Math.floor(fx), jj = Math.floor(fz), tx = fx - ii, tz = fz - jj;
      const canopy = cover[jj * snx + ii] * (1 - tx) * (1 - tz) + cover[jj * snx + ii + 1] * tx * (1 - tz) + cover[(jj + 1) * snx + ii] * (1 - tx) * tz + cover[(jj + 1) * snx + ii + 1] * tx * tz;
      // Under the rock it is shadier than out in the valley, all along its foot.
      return Math.min(1, canopy + (vale ? 0.4 * (1 - smooth((insideAt(x, z) - 3) / 6)) : 0.55 * (1 - smooth((g.z1 - z - 3) / 9))));
    };
    const wetAt = (x: number, z: number): number => {
      let w = 0.38 - (swells(x, z) - p.floor) * 0.2 + (fbm2(x * 0.05 + s1 * 2, z * 0.05 - s2, 3) - 0.5) * 0.5;
      for (const f of ponds) w = Math.max(w, 1 - smooth((Math.hypot(x - f.x, z - f.z) - shoreOf(f, x - f.x, z - f.z) * 0.75) / 9));
      // A stream waters its banks for a few paces either side.
      for (const c of channels) if (along(c, x, z, 8)) w = Math.max(w, 1 - smooth((nearest.d - nearest.half) / 6));
      w += vale ? 0.22 * (1 - smooth((insideAt(x, z) - 3) / 7)) : 0.3 * (1 - smooth((g.z1 - z - 3) / 9));
      return Math.min(1, Math.max(0, w - parched * 0.3));
    };
    // (`close` is for how tall grass stands: it is short only in the track itself, and long right up to the ruts.)
    const wearAt = (x: number, z: number, close = false): number => {
      let w = close ? 1 - smooth((offTrack(x, z) - 0.95) / 0.7) : 1 - smooth((offTrack(x, z) - 0.2) / 2.4);
      // A footpath is worn bare along its middle, and the grass is short for a pace either side.
      w = Math.max(w, close ? 1 - smooth((offFoot(x, z) - 0.35) / 0.5) : 0.85 * (1 - smooth((offFoot(x, z) - 0.1) / 1.6)));
      w = Math.max(w, 0.8 * (1 - smooth((Math.hypot(x - doorX, z - p.z0) - 2) / 5)));
      for (const f of lies) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (f.kind === 'stones') w = Math.max(w, 0.6 * (1 - smooth((d - f.r * 0.9) / 2.5)));
        if (f.kind === 'ruin') w = Math.max(w, 0.45 * (1 - smooth((d - f.r * 0.5) / 2)));
      }
      // The floor of the burners' camp is trodden and scorched bare, nearly to its edge.
      if (site.camp) w = Math.max(w, 0.95 * (1 - smooth((Math.hypot(x - site.camp.x, z - site.camp.z) - site.camp.r * 0.78) / 2.4)));
      return w;
    };
    const thinAt = (x: number, z: number): number => {
      let t = Math.min(1, slopeOf(ground, x, z, 0.5) * 1.7);
      // Nothing much grows on scree.
      if (walled && loose.holds(x, z)) t = Math.max(t, smooth(loose.at(x, z) / 0.3));
      for (const q of stones) t = Math.max(t, 0.7 * (1 - smooth((Math.hypot(q[0] - x, q[1] - z) - q[2] - 0.2) / 1.4)));
      const rim = Math.min(vale ? insideAt(x, z) : Math.min(x - g.x0, g.x1 - x, g.z1 - z), z < p.z0 - 1.5 && vale?.ridge ? 99 : z - p.z0 + (x > p.x0 && x < p.x1 ? 99 : 0));
      return Math.max(t, 0.75 * (1 - smooth((rim - 2.5) / 3)));
    };

    const grassColour = (x: number, z: number, wet: number): Colour => {
      const c = turfColour(x, z, s1), t = plant.range(0.75, 1.2);
      // Green where there is water for it; straw-coloured where the ground is dry, and in the odd tuft anywhere.
      const dry = Math.min(1, parched + Math.max(0, (0.42 - wet) * 2.2) + (plant.chance(0.08) ? 0.8 : 0));
      return [(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t];
    };
    const flowerHues: Colour[] = [[0.25, 0.5, 1.5], [1.4, 0.4, 0.8], [1.3, 1.3, 1.2], [1.5, 1.1, 0.2]];
    const hueAt = (x: number, z: number) => flowerHues[Math.floor(fbm2(x * 0.02 + s2, z * 0.02 - s1, 2) * 3.99) % 4];
    const flowerAt = (x: number, z: number, y: number, size: number) => {
      if (fbm2(x * 0.13 + s1 * 3, z * 0.13 + s2, 2) < 0.64 || !plant.chance(0.45 * inFlower)) return;
      planting.tuft(planting.flowers, x, y - 0.02, z, size, size * plant.range(0.9, 1.3), plant.range(0, Math.PI), hueAt(x, z));
    };
    // Grass. How tall it stands is worked out, not scattered: long where the ground is moist and
    // open and nobody walks, short where it is trodden or the soil is thin, and sparse under trees.
    const grass = (x0: number, x1: number, z0: number, z1: number, step: number, scale: number, keep: (x: number, z: number) => boolean) => {
      for (let gz = z0; gz < z1; gz += step) for (let gx = x0; gx < x1; gx += step) {
        const x = gx + plant.range(0, step), z = gz + plant.range(0, step);
        // (Nothing grows in the ruts of the track; what would have is drawn all the same and thrown away.)
        planting.muted = rutted(x, z) > 0.5 || towers.some((t) => Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < t.half + 1.4) || houses.some((b) => outside(b, x, z) < 0.7);
        if (!keep(x, z)) continue;
        const off = offTrack(x, z);
        if (off < 0.12 || !plant.chance(0.3 + 0.7 * Math.min(1, off / 1.4))) continue;
        if (slopeOf(ground, x, z, 0.3) > 0.55 || !clearOfStones(x, z, -0.15)) continue;
        const y = ground(x, z);
        // Nothing grows under water; at its edge, reeds: tall, close and pale.
        // Still water has them standing in it to the knee; a current keeps its bed clear.
        const depth = waterOver(x, z, y);
        if (depth > (running ? 0.04 : 0.3)) continue;
        if (depth > -0.22) {
          for (let k = 0; k < 2; k++) planting.tuft(planting.grass, x + plant.range(-0.25, 0.25), y - 0.05, z + plant.range(-0.25, 0.25), plant.range(0.45, 0.7), plant.range(0.9, 1.5), plant.range(0, Math.PI), [0.22 * plant.range(0.8, 1.2), 0.3, 0.07]);
          continue;
        }
        const shade = shadeAt(x, z), wet = wetAt(x, z), wear = wearAt(x, z), thin = thinAt(x, z);
        const deep = Math.max(0, shade - 0.4) / 0.6;
        if (!plant.chance((1 - 0.72 * deep) * (1 - 0.45 * thin))) continue;
        const tall = (0.45 + 1.1 * wet) * (1 - 0.82 * wearAt(x, z, true)) * (1 - 0.5 * deep) * (1 - 0.55 * thin) * (0.8 + 0.5 * fbm2(x * 0.3 + s2, z * 0.3 + s1, 2));
        const w = plant.range(0.4, 0.7) * (0.75 + 0.35 * tall) * scale, h = plant.range(0.2, 0.34) * (0.35 + 1.25 * tall) * Math.sqrt(scale);
        planting.tuft(planting.grass, x, y - 0.05, z, w, h, plant.range(0, Math.PI), grassColour(x, z, wet));
        // Flowers want sun, some moisture, and to be left alone.
        if (shade < 0.35 && wear < 0.4 && wet > 0.25 && plant.chance(0.14 * scale)) flowerAt(x, z, y, plant.range(0.3, 0.45) * Math.sqrt(scale));
      }
    };
    grass(p.x0 + 0.2, p.x1 - 0.2, p.z0 + 0.25, p.z1 - 0.2, 0.36, 1, () => true);
    grass(g.x0 - 2, g.x1 + 2, g.z0, g.z1 + 5, 0.56, 1.5, (x, z) => inGrounds(x, z, -2) && !inMeadow(x, z, -0.2) && !inHouse(x, z, 0.5));
    grass(g.x0 - 22, g.x1 + 22, g.z0 - 10, g.z1 + 22, 1.1, 2.4, (x, z) => !inGrounds(x, z, -2) && !inHouse(x, z, 0.5) && !(z < g.z0 && x > g.x0 && x < g.x1 && z > frontZ));
    planting.muted = false;

    const heather: Colour = season === 'spring' ? [0.1, 0.18, 0.06] : [0.42, 0.14, 0.34];
    // ---- a second, taller growth, from a stream of its own so that nothing above is disturbed
    const lush = rng.fork('lush');
    // Meadow grass: knee-high and close where the ground is moist and nobody walks, thinning to
    // nothing where it is dry, trodden or dark. With the turf grass under it, the ground is
    // covered, not dotted.
    for (let gz = g.z0 + 0.5; gz < g.z1; gz += 0.5) for (let gx = g.x0 + 1; gx < g.x1 - 1; gx += 0.5) {
      const x = gx + lush.range(0, 0.5), z = gz + lush.range(0, 0.5), t = lush.next(), turn = lush.range(0, Math.PI), tone = lush.range(0.75, 1.2);
      planting.muted = rutted(x, z) > 0.5 || towers.some((t) => Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < t.half + 1.4) || houses.some((b) => outside(b, x, z) < 0.7);
      // The cheap questions first: most places are settled by them.
      if (!inGrounds(x, z, 0) || inHouse(x, z, 0.4)) continue;
      const shade = shadeAt(x, z), wet = wetAt(x, z), wear = wearAt(x, z, true);
      const want = (0.25 + 0.75 * smooth((wet - 0.25) / 0.35)) * (1 - smooth((wear - 0.15) / 0.3)) * (1 - 0.75 * smooth((shade - 0.45) / 0.4));
      if (t > want || offTrack(x, z) < 0.7 || !clearOfStones(x, z, 0)) continue;
      if (site.camp && Math.hypot(x - site.camp.x, z - site.camp.z) < site.camp.r * 0.9) continue;
      // Not inside the ring of stones or the walls of the hut.
      if (lies.some((f) => f.kind !== 'pond' && Math.hypot(x - f.x, z - f.z) < f.r * (f.kind === 'stones' ? 1.4 : 1.1))) continue;
      // Nor on rock: the cliffs are carved out from where the heights put them, and grass set by the heights would hang in the air.
      if (walled && rocky.holds(x, z) && (rocky.at(x, z) > 0.1 || loose.at(x, z) > 0.25)) continue;
      const y = ground(x, z);
      if (waterOver(x, z, y) > -0.2 || t > want * (1 - 0.7 * thinAt(x, z)) || slopeOf(ground, x, z, 0.3) > 0.5) continue;
      const tall = (0.42 + 0.75 * wet) * (0.7 + 0.6 * fbm2(x * 0.21 + s1, z * 0.21 - s2, 2));
      const c = turfColour(x, z, s1), dry = Math.min(1, parched + Math.max(0, (0.4 - wet) * 2));
      planting.tuft(planting.grass, x, y - 0.05, z, 0.55 + 0.4 * tall, tall, turn, [(0.16 + 0.2 * dry) * c[0] * tone, (0.3 + 0.03 * dry) * c[1] * tone, (0.05 + 0.05 * dry) * c[2] * tone]);
    }
    planting.muted = false;
    // Down the middle of the track, between the ruts, grass in clumps: thick for a few strides, then none.
    {
      const strip = rng.fork('strip');
      for (let z = p.z1 - 2; z < g.z1 - 3; z += 0.17) {
        const x = pathAt(z) + strip.range(-0.24, 0.24), tall = strip.range(0.2, 0.42), turn = strip.range(0, Math.PI), tone = strip.range(0.8, 1.15);
        if (clumpAt(z) < -0.05 || rutted(x, z) > 0.4) continue;
        const y = ground(x, z);
        if (waterOver(x, z, y) > -0.1) continue;
        const c = turfColour(x, z, s1);
        planting.tuft(planting.grass, x, y - 0.05, z, 0.42 + 0.5 * tall, tall, turn, [(0.17 + 0.1 * parched) * c[0] * tone, 0.3 * c[1] * tone, 0.055 * c[2] * tone]);
      }
    }
    // Under trees the ground is last year's leaves, not turf: thickest under the thickest crowns.
    {
      const under = (x: number, _y: number, z: number): number | undefined => {
        if (x < sx0 || z < sz0 || x > sx0 + (snx - 1) * cellS || z > sz0 + (snz - 1) * cellS) return undefined;
        const fx = Math.min(snx - 1.001, (x - sx0) / cellS), fz = Math.min(snz - 1.001, (z - sz0) / cellS), ii = Math.floor(fx), jj = Math.floor(fz), tx = fx - ii, tz = fz - jj;
        const canopy = cover[jj * snx + ii] * (1 - tx) * (1 - tz) + cover[jj * snx + ii + 1] * tx * (1 - tz) + cover[(jj + 1) * snx + ii] * (1 - tx) * tz + cover[(jj + 1) * snx + ii + 1] * tx * tz;
        return smooth((canopy - 0.3) / 0.45);
      };
      for (const [key, mesh] of [...kit.meshes, ...wild.meshes]) if (key.endsWith('|turf')) mesh.setField(3, under);
    }
    // Reeds: a bed of them wherever the water is shallow and the bank is low, taller than a man,
    // thickest at the water's edge. The side the landing stage is on is left open.
    for (const f of ponds) {
      let near = 0, nearD = Infinity;
      for (let z = f.z - 30; z <= f.z + 30; z += 1) {
        const d = Math.hypot(pathAt(z) - f.x, z - f.z);
        if (d < nearD) { nearD = d; near = z; }
      }
      const jx = (pathAt(near) - f.x) / nearD, jz = (near - f.z) / nearD;
      for (let k = 0; k < Math.min(2600, f.r * f.r * 16); k++) {
        const a = lush.range(0, Math.PI * 2), d = shoreOf(f, Math.cos(a), Math.sin(a)) * lush.range(0.5, 1.3), x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
        const h = lush.range(1.25, 2.2), w = lush.range(0.5, 0.9), turn = lush.range(0, Math.PI), tone = lush.range(0.75, 1.15), patch = fbm2(x * 0.35 + s2, z * 0.35 + s1, 2);
        if (Math.cos(a) * jx + Math.sin(a) * jz > 0.86 || patch < 0.4) continue;
        const y = ground(x, z), depth = f.level - y;
        if (depth < -0.3 || depth > 0.6) continue;
        const straw = season === 'autumn' ? 0.5 : parched;
        planting.tuft(planting.reeds, x, y - 0.05, z, w, h + Math.max(0, depth), turn, [(0.2 + 0.25 * straw) * tone, (0.31 + 0.02 * straw) * tone, 0.07 * tone]);
      }
    }
    // Ivy on the front of the house: it starts at the foot of the wall and climbs, spreading as
    // it goes and narrowing to its growing tip. A kept house has a little; a forsaken one is
    // half covered. In autumn some of it has turned red.
    if (!delve) {
      const amount = { kept: 0.35, damp: 0.7, forsaken: 1 }[site.setting.condition];
      const wall = lush.fork('ivy'), openings = holesOn(p, 'n', 0), highest = site.top - p.floor - 0.6;
      for (let k = 0, n = Math.round(((p.x1 - p.x0 - 8) / 4.5) * amount); k < n; k++) {
        let x = wall.range(p.x0 + 4, p.x1 - 4);
        const climb = Math.min(highest, wall.range(2.2, 6.5) * (0.6 + 0.6 * amount)), girth = wall.range(0.7, 1.6);
        const red = season === 'autumn' && wall.chance(0.35);
        if (openings.some((h) => Math.abs(h.at - x) < h.w + 0.5 + girth)) continue;
        for (let y = 0.1; y < climb; y += 0.2) {
          const f = y / climb, wide = girth * Math.sin(Math.PI * Math.pow(f, 0.6)) + 0.12;
          x += wall.range(-0.09, 0.09);
          for (let c = 0; c < 2 + Math.round(wide * 2.2); c++) {
            const lx = x + wall.range(-wide, wide), ly = p.floor + y + wall.range(-0.15, 0.15), t = wall.range(0.6, 1.15);
            planting.card(planting.leaves, lx, ly, p.z0 + 0.06 + wall.range(0, 0.07), wall.range(0.42, 0.7), wall.range(-0.3, 0.3), wall.range(-0.3, 0.3), wall.range(0, Math.PI * 2),
              red ? [0.42 * t, 0.07 * t, 0.03 * t] : [0.035 * t, 0.1 * t, 0.028 * t], lx, ly, p.z0 - 3);
          }
        }
      }
    }
    // The hill above the house: thin soil over the vaults, so no trees, but rough grass, heather
    // in mounds, and a bush here and there, all standing clear of the openings. (A house that stands free has roofs, not a hill.)
    if (!free) {
      const top = rng.fork('hilltop');
      const clearOf = (x: number, z: number, m: number) => !openings.some((o) => x > o.x0 - m && x < o.x1 + m && z > o.z0 - m && z < o.z1 + m);
      let bushes = 0;
      for (let gz = houseZ0 - 3; gz < frontZ - 0.6; gz += 0.62) for (let gx = Math.max(houseX0 - 3, p.x0 + 0.5); gx < Math.min(houseX1 + 3, p.x1 - 0.5); gx += 0.62) {
        const x = gx + top.range(0, 0.62), z = gz + top.range(0, 0.62), t = top.next(), turn = top.range(0, Math.PI), tone = top.range(0.7, 1.2);
        if (z > frontZ - 0.7 || !clearOf(x, z, 0.5)) continue;
        const y = ground(x, z), patch = fbm2(x * 0.16 + s1 * 2, z * 0.16 + s2, 2);
        if (t < 0.5) {
          const c = turfColour(x, z, s1), dry = Math.min(1, 0.35 + parched);
          planting.tuft(planting.grass, x, y - 0.05, z, 0.5 + 0.3 * patch, 0.22 + 0.5 * patch, turn, [(0.17 + 0.2 * dry) * c[0] * tone, (0.29 + 0.03 * dry) * c[1] * tone, (0.05 + 0.05 * dry) * c[2] * tone]);
        } else if (t > 0.93 && patch > 0.5 && clearOf(x, z, 1)) {
          const size = 0.3 + 0.3 * top.next();
          planting.crown(x, y + size * 0.35, z, size, size * 0.5, 14, size * 0.9, leafOf(heather), top);
        } else if (t > 0.5 && t < 0.508 && bushes < 9 && clearOf(x, z, 1.6)) {
          growTree(planting, softBark, x, y - 0.05, z, 1.5 + 1.2 * top.next(), 0.04, { kind: 'oak', detail: 0.5, cards: 56, cardSize: 0.5, leaf: leafOf(greens[0]), bark: oakBark, shaded: true }, rng.fork(`topbush${bushes++}`));
        }
      }
    }
    // Dead wood: trunks lying where they fell, and stumps, in the shade of the wood.
    {
      const dead = rng.fork('deadwood'), grey: Colour = [0.6, 0.56, 0.5];
      let lying = 0;
      for (let tries = 0; tries < 260 && lying < 16; tries++) {
        const x = dead.range(g.x0 + 8, g.x1 - 8), z = dead.range(g.z0 + 8, g.z1 - 8), a = dead.range(0, Math.PI), len = dead.range(2.2, 5.5), r = dead.range(0.11, 0.26), stump = dead.chance(0.35);
        if (!inGrounds(x, z, 8) || inHouse(x, z, 2) || shadeAt(x, z) < 0.45 || offTrack(x, z) < 3 || offFoot(x, z) < 1.5 || inMeadow(x, z, 2) || clearOfFeatures(x, z) < 2 || !clearOfStones(x, z, 1) || slopeOf(ground, x, z, 0.6) > 0.35) continue;
        if (stump) {
          const y = ground(x, z);
          layLimb(barkMesh, [V(x, y - 0.3, z), V(x, y + 0.1, z), V(x + 0.02, y + dead.range(0.35, 0.8), z)], [r * 1.9, r * 1.5, r * 1.3], 8, grey, 0, () => 0.75);
        } else {
          const dx = Math.cos(a) * len * 0.5, dz = Math.sin(a) * len * 0.5;
          const at = (t: number) => V(x + dx * t, ground(x + dx * t, z + dz * t) + r * (0.75 - 0.25 * Math.abs(t)), z + dz * t);
          layLimb(barkMesh, [at(-1), at(-0.35), at(0.35), at(1)], [r * 1.15, r * 1.05, r * 0.95, r * 0.8], 8, grey, 0, () => 0.75);
          stones.push([x, z, len * 0.4]);
        }
        lying++;
      }
    }

    // The other plants, each where it would grow.
    const fernGreen: Colour = season === 'autumn' ? [0.34, 0.22, 0.05] : [0.1, 0.27, 0.05];
    const open = (x: number, z: number) => inGrounds(x, z, 0.5) && !inHouse(x, z, 0.8) && offTrack(x, z) > 1.6 && offFoot(x, z) > 0.75 && clearOfStones(x, z, 0.05) && clearOfFeatures(x, z) > 0.3 && slopeOf(ground, x, z, 0.4) < 0.6;
    const census = { ferns: 0, herbs: 0, nettles: 0, heather: 0, thicket: 0, saplings: 0, scree: screeLaid };
    for (let gz = g.z0 + 1; gz < g.z1; gz += 0.95) for (let gx = g.x0; gx < g.x1; gx += 0.95) {
      const x = gx + plant.range(0, 0.95), z = gz + plant.range(0, 0.95);
      if (!open(x, z) || inMeadow(x, z, -1.5) && offTrack(x, z) < 4) continue;
      const shade = shadeAt(x, z), wet = wetAt(x, z), wear = wearAt(x, z), thin = thinAt(x, z);
      const y = ground(x, z);
      if (waterOver(x, z, y) > -0.25 || wear > 0.35) continue;
      // Ferns: in shade, where it is not dry. They take the place of grass under the trees.
      if (shade > 0.45 && wet + shade > 0.85 && plant.chance(0.55 * shade)) {
        const size = plant.range(0.8, 1.4) * (0.8 + 0.4 * wet), t = plant.range(0.75, 1.2);
        planting.tuft(planting.ferns, x, y - 0.04, z, size, size * plant.range(0.55, 0.8), plant.range(0, Math.PI), [fernGreen[0] * t, fernGreen[1] * t, fernGreen[2] * t]);
        census.ferns++;
        continue;
      }
      // Tall herbs: in drifts on moist open ground that nothing grazes or treads.
      if (shade < 0.3 && wet > 0.52 && thin < 0.4 && fbm2(x * 0.09 - s1, z * 0.09 + s2 * 2, 2) > 0.52 && plant.chance(0.4)) {
        const size = plant.range(0.5, 0.85);
        const hue = season === 'autumn' ? [0.4, 0.3, 0.16] as Colour : hueAt(x + 40, z);
        planting.tuft(planting.herbs, x, y - 0.03, z, size, plant.range(0.95, 1.5), plant.range(0, Math.PI), hue);
        census.herbs++;
        continue;
      }
      // Heather and its like: low mounds on thin dry soil in the sun, against rock.
      if (thin > 0.5 && shade < 0.35 && wet < 0.5 && plant.chance(0.16)) {
        const size = plant.range(0.3, 0.55);
        planting.crown(x, y + size * 0.35, z, size, size * 0.5, 16, size * 0.9, leafOf(heather), plant);
        census.heather++;
        continue;
      }
      // Thicket: bushes where wood meets open ground, which is where the light and the shelter both are.
      if (shade > 0.18 && shade < 0.5 && thin < 0.5 && plant.chance(0.035)) {
        const size = plant.range(0.7, 1.35);
        // A bush: several stems from the ground, branching, with its leaves on its twigs.
        const green = leafOf(plant.pick(greens));
        spent.crown(x, y + size * 0.55, z, size, size * 0.75, 52, size * 0.72, green, plant);
        spent.leaves.matrices.length = spent.leaves.colours.length = spent.leaves.centres.length = 0;
        growTree(planting, softBark, x, y - 0.05, z, size * 2.4, 0.03 + 0.02 * size, { kind: 'oak', detail: 0.5, cards: 64, cardSize: 0.52, leaf: green, bark: oakBark, shaded: true }, rng.fork(`bush${census.thicket}`));
        census.thicket++;
        // And now and then a young tree coming up among them.
        if (plant.chance(0.22)) {
          const sx = x + plant.range(-1.2, 1.2), sz = z + plant.range(-1.2, 1.2);
          if (open(sx, sz)) {
            const height = plant.range(2.2, 3.6);
            const green = leafOf(plant.pick(greens));
            spent.broadleaf(sx, ground(sx, sz), sz, height, plant.range(0.8, 1.2), 70, green, plant, 0.7);
            growTree(planting, woodOf('ash', true), sx, ground(sx, sz), sz, height * 1.15, 0.055, { kind: 'ash', detail: 0.45, cards: 70, cardSize: 0.55, leaf: green, bark: ashBark, shaded: true }, rng.fork(`tree${grown++}`));
            census.saplings++;
          }
        }
      }
    }
    // Sheep: a flock or two on the open ground of the valley, away from the house, the track, the paths, the woods and the water, on
    // ground not too steep. (A valley of pasture with nothing on it to graze it was a lawn kept by nobody.)
    {
      const q = rng.fork('flocks'), want = q.chance(0.8) ? q.int(1, 2) : 0, out: { x: number; z: number; r: number; count: number }[] = [];
      for (let tries = 0; tries < 400 && out.length < want; tries++) {
        const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1);
        if (!inGrounds(x, z, 10) || inHouse(x, z, 18) || offTrack(x, z) < 8 || offFoot(x, z) < 4 || shadeAt(x, z) > 0.12 || clearOfFeatures(x, z) < 8) continue;
        if (waterOver(x, z, ground(x, z)) > -1 || slopeOf(ground, x, z, 3) > 0.25 || out.some((f) => Math.hypot(f.x - x, f.z - z) < 50)) continue;
        out.push({ x, z, r: q.range(10, 18), count: q.int(3, 8) });
      }
      flockSpots = out;
      planting.crop(out);
    }
    // Nettles and docks: rank green growth on the enriched ground about a ruin.
    for (const f of ruins) {
      for (let k = 0; k < 70; k++) {
        const a = plant.range(0, Math.PI * 2), d = f.r * plant.range(0.75, 1.25);
        const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d * 0.85;
        if (offTrack(x, z) < 1.5 || !clearOfStones(x, z, 0.05)) continue;
        const t = plant.range(0.8, 1.2);
        planting.tuft(planting.herbs, x, ground(x, z) - 0.03, z, plant.range(0.5, 0.8), plant.range(0.7, 1.15), plant.range(0, Math.PI), [0.1 * t, 0.24 * t, 0.05 * t]);
        census.nettles++;
      }
    }
    censuses.push(census);

    // ---- what has been built or set up out here
    if (site.camp) {
      const way = (site.paths ?? []).find((q) => q.to === 'camp'), made = buildCamp(site.camp, ground, sceneryMesh, rng.fork('campbuild'), way ? way.points[way.points.length - 1] : null, (x, z) => turfColour(x, z, s1));
      smokes.push(...made.smokes);
      finds.push(...made.finds);
      // (The burners' own fire is a light, as a torch is: one of the few out of doors.)
      for (const at of made.fires) hallTorches.push({ position: at, out: V(0, 0, 1), fire: 1.9 });
    }
    const timber: Colour = [0.5, 0.42, 0.33];
    const beams = sceneryMesh('wood');
    let grain = 0;
    const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, d: number) => layBeam(beams, V(ax, ay, az), V(bx, by, bz), w, d, timber, (grain += 0.173));
    // Running water, for whatever draws it: the line of its surface, how far the water reaches
    // to either side at each point, and how much of it is to be shown there.
    for (const c of channels) {
      // The stream's own points, and before them, if it comes over the rim, the fall: from a
      // little way back in its notch, over the lip and down the face to the pool at the foot.
      // The water there lies on the rock, which was worn smooth for it, and goes where it goes.
      const xs = c.x.slice(), zs = c.z.slice(), ys = c.x.map((_, k) => c.bed[k] + c.depth), head: number[] = [];
      if (c.fall) {
        const pool = ys[0], hx: number[] = [], hy: number[] = [];
        let low = Infinity;
        for (let d = c.fall.back + 3.6; d > 0.45; d -= 0.2) {
          const x = c.x[0] + c.fall.out * d;
          // Water does not run uphill, whatever the rock does.
          low = Math.min(low, Math.max(pool, ground(x, c.z[0]) + 0.07));
          hx.push(x); hy.push(low);
        }
        xs.unshift(...hx); zs.unshift(...hx.map(() => c.z[0])); ys.unshift(...hy);
        for (let k = 0; k < hx.length; k++) head.push(c.fall.half * (1.05 + 0.4 * smooth((k - hx.length + 8) / 8)));
        falls.push({ x: c.x[0], y: pool, z: c.z[0], height: hy[0] - pool, width: c.half * 2 });
      }
      const n = xs.length, line: number[] = [], reach: number[] = [], fade: number[] = [];
      for (let k = 0; k < n; k++) {
        const x = xs[k], z = zs[k];
        let y = ys[k];
        // At a spring and at a sink the water comes out of the ground and goes into it: it is not cut off square.
        let shown = smooth(Math.min(k, n - 1 - k) / 2.5);
        // Where it meets still water it comes to that water's level and is lost in it, so that
        // there is one surface there and not one lying on another.
        for (const f of ponds) {
          const rho = across(f, x, z);
          if (rho > 1.3) continue;
          y = f.level + 0.004 + (y - f.level) * smooth((rho - 0.85) / 0.3);
          shown = Math.min(shown, smooth((rho - 0.72) / 0.3));
        }
        line.push(x, y, z);
        fade.push(shown);
        if (k < head.length) { reach.push(head[k], head[k]); continue; }
        // The water reaches as far as the ground stands above it, on each side: so its edge is
        // the bank's, with the bank's bays and points, and not a ruled line.
        const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), l = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) || 1;
        const sx = -(zs[b] - zs[a]) / l, sz = (xs[b] - xs[a]) / l;
        for (const side of [1, -1]) {
          // Where no bank is found (the ground falls away on that side) it is kept narrow.
          let far = c.half + 0.3;
          for (let d = 0.15; d < c.half * 1.8 + 1.6; d += 0.15) {
            if (ground(x + sx * side * d, z + sz * side * d) > y + 0.01) { far = d + 0.3; break; }
          }
          reach.push(far);
        }
      }
      // No narrower anywhere than its neighbours allow, or a bank that juts in would leave a gap behind it.
      const banks = reach.map((_, i) => (i < head.length * 2 ? reach[i] : Math.max(reach[Math.max(i % 2, i - 2)], reach[i], reach[Math.min(reach.length - 2 + (i % 2), i + 2)])));
      flows.push({ line, width: c.half * 2 + 0.5, banks, fade });
    }
    // In a grotto: growths that glow on the rock round the chamber, and something left on its floor.
    // A hall under the hill is carved as a body of its own, beyond the rock that is carved with
    // the land, in two pieces that overlap: the stair, and the hall. It sees no sky at all, and
    // is told so, so that nothing lights it but what burns in it and what is carried into it.
    for (const q of grottoes) {
      if (!q.hall) continue;
      const h = q.hall, gr = h.great, yl = q.y0 - h.drop, yf = yl - (gr?.deep ?? 0), half = h.width / 2;
      wild.group = 'under';
      const rockUnder = wild.mesh('rock');
      wild.group = 'wild';
      const tone1 = rng.fork('hewn').range(0, 50);
      // From a point of the world to the hall's own measures, and back.
      const tOf = (x: number) => 7 - (x - q.edge) * q.inw, xOf = (t: number) => q.edge + q.inw * (7 - t);
      // (And by a great hall's: along it, towards the gallery's side, and up from its floor.)
      const at = (u: number, o: number, yy: number) => V(xOf(q.hall0 + u), yf + yy, q.z + q.gs * o);
      const air = (x: number, y: number, z: number) => hallAir(q, tOf(x), z - q.z, y);
      const shade = (c: Vector3, n: Vector3): Colour => {
        // Tool marks, and soot under the roof.
        const tone = 0.8 + 0.22 * fbm2(c.x * 0.9 + tone1, c.z * 0.9 + c.y * 0.6, 3) - 0.18 * smooth((c.y - (yf + h.height * 0.55)) / (h.height * 0.4)) * Math.max(0, -n.y);
        return rockColour(tone);
      };
      // The land's rock is carved only a little deeper than the valley floor, so it can hold no more than the
      // head of the stair; this takes over from there, and what the land's carving made of the rest is thrown away.
      const span = (a: Vector3, b: Vector3): [Vector3, Vector3] => [V(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)), V(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z))];
      const pieces: [Vector3, Vector3][] = [span(V(xOf(UNDER_FROM - 0.3), yl - 0.9, q.z - 2.4), V(xOf(q.hall0 + 0.9), q.y0 + 3.9, q.z + 2.4))];
      const sh = shaftFor.get(q);
      if (gr && sh) {
        // A great hall is carved in three: the hall with its chasm, the room off the upper bridge, and the shaft above the roof.
        const uc = gr.chasm.at + gr.chasm.width / 2, rise = 9, lean = rise / sh.dy;
        pieces.push(span(at(-0.3, -half - 0.9, -gr.chasm.depth - 0.9), at(h.length + 0.9, half + 0.9, h.height + 0.9)));
        pieces.push(span(at(uc - 4.1, -half - 8.9, gr.deep - 0.9), at(uc + 4.1, -half - 0.5, gr.deep + 4.7)));
        pieces.push(span(
          V(xOf(q.hall0 + Math.min(sh.u, sh.u + sh.du * lean) - sh.r - 1.2), yf + sh.yy - 0.6, q.z + Math.min(sh.off, sh.off + sh.dv * lean) - sh.r - 1.2),
          V(xOf(q.hall0 + Math.max(sh.u, sh.u + sh.du * lean) + sh.r + 1.2), yf + sh.yy + rise, q.z + Math.max(sh.off, sh.off + sh.dv * lean) + sh.r + 1.2)));
      } else pieces.push(span(V(xOf(q.hall0 - 0.3), yf - 0.9, q.z - half - 0.9), V(xOf(q.hall0 + h.length + 0.9), yf + h.height + 0.9, q.z + half + 0.9)));
      // The door onward, and the first of the passage beyond it, which is the hall's to carve as far as the passage's own carving begins.
      const on = q.on, jn = on ? join : null;
      if (on) pieces.push(gr
        ? span(at(on.u - 1.7, -on.end - 0.4, gr.deep - 0.9), at(on.u + 1.7, -half - 8.5, gr.deep + 3.5))
        : span(V(xOf(q.hall0 + on.u - 1.7), yl - 0.9, q.z + on.s * (half + 0.5)), V(xOf(q.hall0 + on.u + 1.7), yl + 3.5, q.z + on.s * (on.end + 0.4))));
      for (const [min, max] of pieces) carveRock(rockUnder, jn ? (x, y, z) => Math.max(air(x, y, z), jn.air(x, y, z)) : air, { min, max, cell: gr ? 0.42 : 0.36, uvScale: 0.4, fromSamples: true, sharp: true, shade: (c, n) => shade(c, n), ...(jn ? { keep: (p3: Vector3) => !jn.own(p3.z) } : {}) });
      // The stair: steps of stone on the slope the rock was cut to, a stride and a half broad, each a hand and a half high.
      const cut = rng.fork('hallsteps');
      // (Counted from the bottom, so that the first step up from the hall is no higher than the rest: a step and a bit is a wall.)
      for (let k = 0; 0.34 * (k + 1) <= q.run + 0.05; k++) {
        const t = q.stair0 + q.run - 0.34 * (k + 1), top = yl + 0.17 * (k + 1), x0 = xOf(t), x1 = xOf(t + 0.34);
        layBeam(rockUnder, V((x0 + x1) / 2, top - 0.16, q.z - 1.3), V((x0 + x1) / 2, top - 0.16, q.z + 1.3), 0.36, 0.32, rockColour(cut.range(0.85, 1.05)), cut.range(0, 9));
      }
      // Where torches burn: they are hung further down, and what they light is reckoned from this.
      const lamps: Vector3[] = [];
      const torch = (position: Vector3, out: Vector3) => { hallTorches.push({ position, out }); lamps.push(position); };
      if (gr) {
        const c = gr.chasm, G = gr.deep, L = h.length, c1 = c.at + c.width, uc = c.at + c.width / 2, face = half - GREAT.gal, back = face + GREAT.screen;
        const step = (a: Vector3, b: Vector3) => layBeam(rockUnder, a, b, 0.36, 0.32, rockColour(cut.range(0.85, 1.05)), cut.range(0, 9));
        // The stair from the ledge to the floor, along the wall.
        for (let k = 0; 0.17 * (k + 1) <= G + 0.01; k++) {
          const u = GREAT.ledge + 2 * G - 0.34 * (k + 1) + 0.17, y = 0.17 * (k + 1) - 0.16;
          step(at(u, -half, y), at(u, -half + GREAT.stair, y));
        }
        // The steps out of the chasm, along its far side.
        for (let k = 0; 0.17 * (k + 1) <= c.depth + 0.01; k++) {
          const o = face - GREAT.foot - 0.34 * (k + 1) + 0.17, y = -c.depth + 0.17 * (k + 1) - 0.16;
          step(at(c1 - GREAT.strip, o, y), at(c1, o, y));
        }
        // The three steps of the dais.
        for (let k = 0; k < 3; k++) {
          const u = L - 5.6 - 0.34 * (2 - k) + 0.17;
          layBeam(rockUnder, at(u, -half + 0.4, 0.17 * (k + 1) - 0.16), at(u, face - 0.4, 0.17 * (k + 1) - 0.16), 0.36, 0.32, rockColour(0.95), k);
        }
        // Torches: on the pillars, facing the middle; either side of the way in; along the back wall of the gallery and of the aisle,
        // every other bay and turn about; either side of the tomb; and one in the room over the bridge.
        const way = (du: number, dout: number) => V(-q.inw * du, 0, q.gs * dout);
        for (const [u, v] of greatPillars(q)) torch(V(xOf(q.hall0 + u), yf + 2.7, q.z + v - Math.sign(v) * 1.36), V(0, 0, -Math.sign(v)));
        for (const side of [-1, 1]) torch(V(xOf(q.hall0 + 0.14), yf + G + 2.5, q.z + side * 2.5), way(1, 0));
        for (let k = -12; k <= 12; k++) {
          const u = uc + (k + 0.5) * GREAT.bay;
          if (u > 2.5 && u < L - 3.5 && (k & 1) === 0) torch(at(u, half - 0.14, G + 2.4), way(0, -1));
          if (u > GREAT.ledge + 2.5 && u < L - 7.5 && (k & 1) !== 0) torch(at(u, half - 0.14, 2.4), way(0, -1));
        }
        for (const side of [-1, 1]) torch(V(xOf(q.hall0 + L - 0.14), yf + 0.51 + 2.6, q.z + side * 3.6), way(-1, 0));
        torch(at(uc + 3.06, -half - 4.6, G + 2.3), way(-1, 0));
        finds.push({ at: V(xOf(q.hall0 + L - 2.7), yf + 0.51 + 1.43, q.z), what: 'a crown of dull gold, lying on the tomb in the great hall under the hill' });
        finds.push({ at: at(uc - 1.6, -half - 6.4, G + 0.4), what: 'a roll of drawings for a hall never finished, in the room over the bridge' });
        finds.push({ at: at(c.at + 2.2, -half + 2.2, -c.depth + 0.4), what: 'a helm with a dent in its crown, at the bottom of the chasm' });
        unders.push({ min: span(at(-1, -half - 9.5, -c.depth - 1), at(L + 1, half + 1, h.height + 1))[0].min(V(xOf(q.stair0), Infinity, Infinity)), max: span(at(-1, -half - 9.5, -c.depth - 1), at(L + 1, half + 1, h.height + 1))[1].max(V(xOf(q.stair0), -Infinity, -Infinity)) });
      } else {
        // The three steps of the dais.
        for (let k = 0; k < 3; k++) {
          const u = h.length - 5.6 - 0.34 * (2 - k), x = xOf(q.hall0 + u + 0.17);
          layBeam(rockUnder, V(x, yf + 0.17 * (k + 1) - 0.16, q.z - h.width / 2 + 0.4), V(x, yf + 0.17 * (k + 1) - 0.16, q.z + h.width / 2 - 0.4), 0.36, 0.32, rockColour(0.95), k);
        }
        // Torches on the pillars, facing the middle of the hall, and one either side of the tomb.
        for (const [u, v] of pillarsOf(q)) torch(V(xOf(q.hall0 + u), yf + 2.5, q.z + v - Math.sign(v) * 0.76), V(0, 0, -Math.sign(v)));
        for (const side of [-1, 1]) torch(V(xOf(q.hall0 + h.length - 0.14), yf + 0.51 + 2.5, q.z + side * 3.2), V(q.inw, 0, 0));
        // (And one beside the door onward, so that it is seen.)
        if (on) torch(V(xOf(q.hall0 + on.u + 1.9), yf + 2.5, q.z + on.s * (half - 0.14)), V(0, 0, -on.s));
        finds.push({ at: V(xOf(q.hall0 + h.length - 2.7), yf + 0.51 + 1.18, q.z), what: 'a crown of dull gold, lying on the tomb in the hall under the hill' });
        unders.push({ min: V(Math.min(xOf(q.stair0), xOf(q.hall0 + h.length + 1)), yf - 1, q.z - h.width / 2 - 1), max: V(Math.max(xOf(q.stair0), xOf(q.hall0 + h.length + 1)), yf + h.height + 1, q.z + h.width / 2 + 1) });
      }
      // The doorway: where the passage meets the face of the cliff it is dressed, as a made thing
      // is: two jambs of squared stone, a lintel across them, and a sill. The face is found by
      // walking in from the valley until the ground stands a doorway's height above the floor.
      {
        let face = 3.3;
        for (let t = 0.5; t < 6; t += 0.15) if (ground(xOf(t), q.z) > q.y0 + 3.2) { face = t; break; }
        const made = sceneryMesh('rock'), x = xOf(face - 0.25), pale = rockColour(1.18);
        for (const side of [-1, 1]) layBeam(made, V(x, q.y0 - 0.3, q.z + side * 1.62), V(x, q.y0 + 3.45, q.z + side * 1.62), 0.62, 0.9, pale, side + 2);
        layBeam(made, V(x, q.y0 + 3.78, q.z - 2.25), V(x, q.y0 + 3.78, q.z + 2.25), 1.0, 0.66, pale, 5);
        layBeam(made, V(x, q.y0 + 4.26, q.z - 1.5), V(x, q.y0 + 4.26, q.z + 1.5), 0.8, 0.3, rockColour(1.08), 6);
        layBeam(made, V(xOf(face - 0.6), q.y0 - 0.11, q.z - 1.9), V(xOf(face - 0.6), q.y0 - 0.11, q.z + 1.9), 1.5, 0.2, rockColour(1.0), 7);
      }
      /**
       * The light down here. No sky stands over a hall, and the sun's shadows are not kept this
       * far from the house, so nothing that lights the valley can be let light this. Its light
       * is reckoned here instead, point by point, and carried by the rock as baked light is: the
       * last of the day coming down the stair; every torch, as far as ten metres and not through
       * rock; and in a great hall the sun down its shaft, the sky seen through the shaft's mouth,
       * and what the sunlit floor throws back. Each is looked for along a straight line through
       * the hall's own air, so pillars and bridges cast shadows.
       */
      const sunC = [0, 1, 2].map((c) => sky.colour[c] * sky.intensity), skyC = [0, 1, 2].map((c) => 0.6 * sky.zenith[c] + 0.4 * sky.horizon[c]);
      const clear = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, far: number, by: number): boolean => {
        for (let d = by; d < far; d += by) if (air(px + lx * d, py + ly * d, pz + lz * d) < -0.1) return false;
        return true;
      };
      // (The sun, as the shaft was cut to take it: where its mouth is, and the way up it.)
      const mouth = sh ? at(sh.u, q.gs * sh.off, sh.yy) : null, up = sh ? V(-q.inw * sh.du, sh.dy, sh.dv) : null;
      const pool = sh ? at(sh.land.u, 0, 1.2) : null, area = sh ? Math.PI * sh.r * sh.r : 0;
      rockUnder.setLightBy((p, n, out) => {
        const px = p[0] + n[0] * 0.3, py = p[1] + n[1] * 0.3, pz = p[2] + n[2] * 0.3;
        // (Light from one way, written so that a face turned from it gets none and a face turned to it gets it all.)
        const add = (r: number, g: number, b: number, lx: number, ly: number, lz: number, nl: number) => {
          const k = nl / (0.25 + 0.5 * nl);
          out[0] += 0.25 * k * r; out[1] += 0.5 * k * r * lx; out[2] += 0.5 * k * r * ly; out[3] += 0.5 * k * r * lz;
          out[4] += 0.25 * k * g; out[5] += 0.5 * k * g * lx; out[6] += 0.5 * k * g * ly; out[7] += 0.5 * k * g * lz;
          out[8] += 0.25 * k * b; out[9] += 0.5 * k * b * lx; out[10] += 0.5 * k * b * ly; out[11] += 0.5 * k * b * lz;
        };
        // Never quite nothing: the eye finds a little in any dark.
        out[0] += 0.055; out[4] += 0.075; out[8] += 0.12;
        const day = 0.9 * (1 - smooth((tOf(p[0]) - 2.6) / 5)) * (Math.PI / 2);
        if (day > 0) for (let c = 0; c < 3; c++) { out[c * 4] += skyC[c] * day; out[c * 4 + 2] += skyC[c] * day * 0.8; }
        for (const l of lamps) {
          const dx = l.x - px, dy = l.y - py, dz = l.z - pz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 196) continue;
          const d = Math.sqrt(d2), nl = (n[0] * dx + n[1] * dy + n[2] * dz) / d;
          if (nl < 0.02 || !clear(px, py, pz, dx / d, dy / d, dz / d, d - 0.4, 0.55)) continue;
          const e = (7 * (1 - d / 14)) / (d2 + 1);
          add(e, e * 0.5, e * 0.17, dx / d, dy / d, dz / d, nl);
        }
        if (!sh || !mouth || !up || !pool) return;
        // The sun: only within the shaft's own round of light, and only where nothing stands between.
        const wx = px - mouth.x, wy = py - mouth.y, wz = pz - mouth.z, along = wx * up.x + wy * up.y + wz * up.z;
        const beam = smooth((sh.r + 1.2 - Math.hypot(wx - up.x * along, wy - up.y * along, wz - up.z * along)) / 0.6), nu = n[0] * up.x + n[1] * up.y + n[2] * up.z;
        // (Its light is not added here: the rock is told only that it stands in it, and draws the edge of the light itself.)
        if (beam > 0 && nu > 0.02 && clear(px, py, pz, up.x, up.y, up.z, 8.5 - along, 0.55)) out[12] = 1;
        // The sky, seen through the mouth of the shaft: little, cold, and from above.
        {
          const dx = mouth.x - px, dy = mouth.y + 1 - py, dz = mouth.z - pz, d = Math.hypot(dx, dy, dz), nl = (n[0] * dx + n[1] * dy + n[2] * dz) / d;
          const e = (16 * area * Math.max(0, dy / d)) / (d * d + 30);
          if (nl > 0.02 && e > 0.004 && clear(px, py, pz, dx / d, dy / d, dz / d, d - 1.5, 0.9)) add(skyC[0] * e, skyC[1] * e, skyC[2] * e, dx / d, dy / d, dz / d, nl);
        }
        // What the sunlit floor throws back: warm, and from below.
        {
          const dx = pool.x - px, dy = pool.y - py, dz = pool.z - pz, d = Math.hypot(dx, dy, dz), nl = (n[0] * dx + n[1] * dy + n[2] * dz) / d;
          const e = (3.2 * area * Math.max(0.2, -dy / d)) / (Math.PI * (d * d + 16));
          if (nl > 0.02 && e * sky.intensity > 0.004 && clear(px, py, pz, dx / d, dy / d, dz / d, d - 0.8, 0.9)) add(sunC[0] * e, sunC[1] * e * 0.9, sunC[2] * e * 0.78, dx / d, dy / d, dz / d, nl);
        }
      });
      if (sh && mouth && up) sunShafts.push({ top: mouth.clone().addScaledVector(up, 8), down: up.clone().negate(), length: 8 + sh.yy / sh.dy + gr!.chasm.depth, radius: sh.r });
    }
    // A mine is carved as a hall is: beyond the rock that is carved with the land, as a body of its own that sees no sky.
    grottoes.forEach((q, k) => {
      if (!q.mine) return;
      const m = q.mine, fl = q.y0, end = 7 + m.length, tc = 7 + m.cross.at, cs = m.cross.side;
      const tOf = (x: number) => 7 - (x - q.edge) * q.inw, xOf = (t: number) => q.edge + q.inw * (7 - t);
      wild.group = 'under';
      const rockIn = wild.mesh('rock'), woodIn = wild.mesh('wood');
      wild.group = 'wild';
      const woodOut = sceneryMesh('wood'), tone1 = rng.fork(`mine${k}`).range(0, 50), cut = rng.fork(`minetimber${k}`);
      const air = (x: number, y: number, z: number) => mineAir(q, tOf(x), z - q.z, y);
      const span = (a: Vector3, b: Vector3): [Vector3, Vector3] => [V(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)), V(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z))];
      // In three pieces that overlap a little: the adit, the working at its end, and the crosscut.
      const pieces = [
        span(V(xOf(UNDER_FROM - 0.3), fl - 0.9, q.z - 1.7), V(xOf(end + 0.2), fl + 3.0, q.z + 1.7)),
        span(V(xOf(end - 0.2), fl - 0.9, q.z - 3.8), V(xOf(end + 6.2), fl + 4.4, q.z + 3.8)),
        span(V(xOf(tc - 1.5), fl - 0.9, q.z + cs * 1.3), V(xOf(tc + 1.5), fl + 2.9, q.z + cs * (m.cross.length + 0.9))),
      ];
      for (const [min, max] of pieces) carveRock(rockIn, air, {
        min, max, cell: 0.32, uvScale: 0.4, fromSamples: true, sharp: true,
        shade: (c) => {
          // Pick marks; and in the working the lode they followed, a slanting band of green-stained stone in both walls and the face.
          const tone = 0.78 + 0.26 * fbm2(c.x * 0.9 + tone1, c.z * 0.9 + c.y * 0.6, 3), u = tOf(c.x) - end;
          const lode = u > -0.5 && Math.abs(c.y - (fl + 1.25 + 0.3 * (c.z - q.z) + 0.25 * (fbm2(c.x * 0.7 + tone1, c.z * 0.7, 2) - 0.5))) < 0.2;
          const base = rockColour(tone);
          return lode ? [base[0] * 0.55, base[1] * 1.25 + 0.03, base[2] * 1.05 + 0.02] : base;
        },
      });
      // Where the adit meets the face of the hill: found as a hall's doorway is.
      let face = 3.3;
      for (let t = 0.5; t < 6; t += 0.15) if (ground(xOf(t), q.z) > fl + 2.4) { face = t; break; }
      const timber: Colour = [0.36, 0.29, 0.21];
      const beamIn = (t: number, mesh: MeshBuilder, a: Vector3, b: Vector3, w: number, d: number) => layBeam(mesh, a, b, w, d, [timber[0] * cut.range(0.8, 1.1), timber[1] * cut.range(0.8, 1.1), timber[2] * cut.range(0.8, 1.1)], cut.range(0, 9));
      // The portal: two stout legs and a cap that stands out past them, with a strut to each leg from outside.
      {
        const x = xOf(face - 0.15);
        for (const side of [-1, 1]) {
          beamIn(face, woodOut, V(x, fl - 0.3, q.z + side * 1.12), V(x, fl + 2.2, q.z + side * 1.06), 0.24, 0.24);
          beamIn(face, woodOut, V(xOf(face - 1.3), ground(xOf(face - 1.3), q.z + side * 1.5) - 0.2, q.z + side * 1.5), V(x, fl + 1.7, q.z + side * 1.14), 0.14, 0.14);
        }
        beamIn(face, woodOut, V(x, fl + 2.32, q.z - 1.5), V(x, fl + 2.32, q.z + 1.5), 0.26, 0.26);
      }
      // Sets of timber down the adit, a long stride apart: two legs and a cap; boards over the first few, where the ground is worst.
      let sets = 0;
      for (let t = face + 1.6; t < end - 0.4; t += 2.1, sets++) {
        if (Math.abs(t - tc) < 1.25) continue;
        const mesh = t < 6.6 ? woodOut : woodIn, x = xOf(t);
        for (const side of [-1, 1]) beamIn(t, mesh, V(x, fl - 0.05, q.z + side * 1.02), V(x, fl + 2.0, q.z + side * 0.98), 0.15, 0.15);
        beamIn(t, mesh, V(x, fl + 2.07, q.z - 1.12), V(x, fl + 2.07, q.z + 1.12), 0.16, 0.16);
        if (sets < 3 || cut.chance(0.25)) for (const off of [-0.62, 0, 0.62]) beamIn(t, mesh, V(x, fl + 2.19, q.z + off), V(xOf(t + 2.1), fl + 2.19, q.z + off), 0.34, 0.04);
      }
      // The tramway underground: from the mouth to the foot of the working.
      for (const [t0, t1, mesh] of [[2.6, 6.6, woodOut], [6.6, end + 2.2, woodIn]] as [number, number, MeshBuilder][]) {
        for (const side of [-0.28, 0.28]) beamIn(t0, mesh, V(xOf(t0), fl + 0.1, q.z + side), V(xOf(t1), fl + 0.1, q.z + side), 0.07, 0.09);
        for (let t = t0 + 0.4; t < t1; t += 1) beamIn(t, mesh, V(xOf(t), fl + 0.03, q.z - 0.5), V(xOf(t), fl + 0.03, q.z + 0.5), 0.16, 0.07);
      }
      // In the working: a pick left against the face, a basket, and something worth carrying out.
      beamIn(end, woodIn, V(xOf(end + 4.9), fl + 0.66, q.z - 1.3), V(xOf(end + 5.25), fl + 1.5, q.z - 1.45), 0.045, 0.045);
      layBeam(woodIn, V(xOf(end + 5.2), fl + 1.44, q.z - 1.62), V(xOf(end + 5.2), fl + 1.44, q.z - 1.2), 0.05, 0.07, [0.08, 0.08, 0.09], 3);
      finds.push({ at: V(xOf(end + 4.3), fl + 0.64 + 0.4, q.z + 1.1), what: 'a leather bag of green ore and a miner\'s tally, left on the ledge at the end of the working' });
      // Two lights underground: at the crosscut, and in the working.
      hallTorches.push({ position: V(xOf(tc + 1.6), fl + 1.72, q.z - cs * 1.08), out: V(0, 0, cs) });
      hallTorches.push({ position: V(xOf(end + 1.2), fl + 1.9, q.z + 2.5), out: V(0, 0, -1) });
      unders.push({ min: V(Math.min(xOf(UNDER_FROM + 0.5), xOf(end + 6.5)), fl - 1, q.z - Math.max(4, m.cross.length + 1.2)), max: V(Math.max(xOf(UNDER_FROM + 0.5), xOf(end + 6.5)), fl + 4.6, q.z + Math.max(4, m.cross.length + 1.2)) });
      // And the yard.
      const yard = buildMineYard({ at: (inside, off) => [q.edge + q.inw * inside, q.z + off], heap: m.heap, shed: m.shed, mouth: 7 - 2.6, stone: rockColour(1), cut: (inside) => fl + 0.24 * Math.max(0, 2.6 - (7 - inside)) }, ground, sceneryMesh, rng.fork(`mineyard${k}`));
      hallTorches.push(...yard.torches);
    });
    grottoes.forEach((q, k) => {
      if (q.hall || q.mine) return;
      const cx = q.edge - q.inw * (q.far - 7), fy = q.y0 - 0.045 * (q.far - 2);
      const gr = rng.fork(`grottoglow${k}`), turn = gr.range(0, Math.PI * 2);
      for (let i = 0; i < 4; i++) {
        const a = turn + (i / 4) * Math.PI * 2 + gr.range(-0.4, 0.4), y = fy + gr.range(0.4, 1.5);
        glows.push({ from: V(cx, y, q.z), position: V(cx + Math.cos(a) * q.r * 2, y, q.z + Math.sin(a) * q.r * 2), colour: [0.25, 1.0, 0.72], strength: gr.range(1.1, 1.9) });
      }
      finds.push({ at: V(cx - q.inw * 0.8, fy + 0.4, q.z + 0.5), what: 'a lamp of green glass, cold for years, on the floor of the grotto' });
    });
    for (const t of towers) buildTower(t, t.base);
    // Buildings by the track. (The first timber house of a row is its inn.)
    houses.forEach((b, i) => {
      wild.group = 'house';
      buildBuilding(b, b.base, (material) => wild.mesh(material), rng.fork(`building${i}`), [0.86 * stoneTint[0], 0.77 * stoneTint[1], 0.63 * stoneTint[2]], i === 0 && !b.wheel);
      wild.group = 'wild';
      // A mill's waterwheel: two rims of short timbers, spokes from the hub to each, paddles between the rims, and the axle into the wall.
      if (b.wheel) {
        const w = b.wheel, wood = wild.mesh('wood'), oak: [number, number, number] = [0.22, 0.15, 0.1], wet: [number, number, number] = [0.13, 0.1, 0.07];
        const cy = b.base + w.y, dir = b.faces === 'w' ? 1 : -1, n = 16;
        const pt = (a: number, r: number, off: number) => V(w.x + off, cy + Math.sin(a) * r, w.z + Math.cos(a) * r);
        for (const off of [-0.32, 0.32]) {
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
            layBeam(wood, pt(a0, w.r, off), pt(a1, w.r, off), 0.12, 0.1, oak, k);
          }
          for (let k = 0; k < 6; k++) layBeam(wood, pt((k / 6) * Math.PI * 2, 0.18, off), pt((k / 6) * Math.PI * 2, w.r - 0.05, off), 0.09, 0.09, oak, k + 30);
        }
        for (let k = 0; k < n; k++) {
          const a = ((k + 0.5) / n) * Math.PI * 2;
          layBeam(wood, pt(a, w.r - 0.02, -0.38), pt(a, w.r - 0.02, 0.38), 0.05, 0.42, wet, k + 60);
        }
        layBeam(wood, V(w.x - 0.55, cy, w.z), V(b.x + dir * (b.d / 2 - 0.5), cy, w.z), 0.22, 0.22, oak, 90);
      }
    });
    // At the far end of a terrace, where the view is, somebody has built a cairn; and left something by it.
    for (const t of terraces) {
      if (t.keep) continue;
      const inw = t.side === 'w' ? 1 : -1, z = t.rise === 'n' ? t.z1 - 2.4 : t.z0 + 2.4;
      const x = sideAt(t.side, z) + inw * (4.7 + t.depth * 0.62), y = ground(x, z);
      const pile = rng.fork('cairn');
      if (t.shrine) {
        // A wayside shrine: a stepped base, a pillar with a niche in the face towards the valley, a little roof of tiles, and a lamp burning in the niche.
        const face = -inw;
        // (A block about the shrine's middle: `a` along the valley, `d` out towards the valley, `y` up.)
        const k = (a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, st: MasonryStyle, tag: string) => wild.box('stone', V(x + Math.min(d0 * face, d1 * face), y + y0, z + a0), V(x + Math.max(d0 * face, d1 * face), y + y1, z + a1), st, st, tag);
        k(-1.1, 1.1, -0.4, 0.22, -1.1, 1.1, coping, 'shrinestep');
        k(-0.8, 0.8, 0.22, 0.44, -0.8, 0.8, coping, 'shrinestep');
        k(-0.38, 0.38, 0.44, 2.5, -0.38, 0.38, dressed, 'shrinepillar');
        // (The niche: a dark recess with a lamp in it, cut in the face towards the valley.)
        k(-0.24, 0.24, 1.4, 2.1, 0.38, 0.44, coping, 'nichehood');
        wild.box('metal', V(x + face * 0.33 - 0.06, y + 1.47, z - 0.06), V(x + face * 0.33 + 0.06, y + 1.62, z + 0.06), coping, coping, 'lamp');
        glows.push({ from: V(x + face * 1.5, y + 1.6, z), position: V(x, y + 1.6, z), colour: [1.0, 0.62, 0.28], strength: 1.4 });
        const roofY = y + 2.5, tilesS = wild.mesh('tile'), tone: [number, number, number] = [1.08, 1.0, 0.95];
        const A = V(x - 0.62, roofY, z - 0.62), B = V(x + 0.62, roofY, z - 0.62), C = V(x + 0.62, roofY, z + 0.62), D = V(x - 0.62, roofY, z + 0.62), top = V(x, roofY + 0.75, z);
        for (const [p0, p1] of [[A, B], [B, C], [C, D], [D, A]]) tileFace(tilesS, [p0, p1, top], tone, V(x, roofY + 0.2, z));
        tileFace(tilesS, [A, B, C, D], tone, V(x, roofY + 1, z));
        wild.box('stone', V(x - 0.06, roofY + 0.72, z - 0.04), V(x + 0.06, roofY + 1.15, z + 0.04), coping, coping, 'finial');
        // Wayside crosses up the way to it, at even spaces: a stone shaft with a short arm, beside the path.
        const crossAt = (zz: number) => {
          const xx = sideAt(t.side, zz) + inw * (4.7 + 2.65), yy = ground(xx, zz);
          wild.box('stone', V(xx - 0.12, yy - 0.3, zz - 0.12), V(xx + 0.12, yy + 1.45, zz + 0.12), dressed, coping, 'waycross');
          wild.box('stone', V(xx - 0.12, yy + 1.05, zz - 0.38), V(xx + 0.12, yy + 1.27, zz + 0.38), dressed, coping, 'waycross');
        };
        for (let u = 2; u < t.run; u += Math.max(3.5, t.run / 3)) crossAt(t.rise === 'n' ? t.z0 - u : t.z1 + u);
      } else {
      // Big stones at the bottom, small at the top, each sitting in the hollow between those under it.
        for (let course = 0, up = 0; course < 5; course++) {
          const size = 0.52 - course * 0.075, ring = Math.max(1, 5 - course * 1.3), out = (0.46 - course * 0.11) * (course < 4 ? 1 : 0);
          for (let k = 0; k < ring; k++) {
            const a = (k / ring) * Math.PI * 2 + course * 0.9 + pile.range(-0.2, 0.2);
            layStone(sceneryMesh('rock'), x + Math.cos(a) * out, y + up - size * 0.2, z + Math.sin(a) * out, size * pile.range(0.9, 1.1), pile.range(0.8, 1.1), pile);
          }
          up += size * 0.62;
        }
      }
      // (Before the shrine's steps, or beside the cairn.)
      const fx = x - inw * (t.shrine ? 1.7 : 0.9);
      finds.push({ at: V(fx, ground(fx, z) + 0.35, z + 0.3), what: t.shrine ? 'a brass spyglass in a leather case, left before the shrine on the lookout' : 'a brass spyglass in a leather case, left by the cairn on the lookout' });
      if (t.way === 'steps') {
        // Steps cut in the rock, up the middle of the way: each a block a stride broad, its top
        // level with the ground at its upper edge. They are for the eye; what is walked on is
        // the slope they are cut from, so no foot catches on a riser.
        const cut = rng.fork('steps'), tread = 0.36;
        for (let u = t.run - 0.4; u > -0.3; u -= tread) {
          const zLow = t.rise === 'n' ? t.z0 - u : t.z1 + u, zHigh = t.rise === 'n' ? zLow + tread : zLow - tread, zMid = (zLow + zHigh) / 2, mid = sideAt(t.side, zMid) + inw * (4.7 + 1.45);
          const top = ground(mid, zHigh) + 0.015, half = 0.72 + cut.range(-0.05, 0.05), tone = cut.range(0.85, 1.1);
          layBeam(softRock, V(mid - half, top - 0.15, zMid), V(mid + half, top - 0.15, zMid), tread + 0.03, 0.3, rockColour(tone), cut.range(0, 9));
        }
      }
      lookouts.push({ x, y: y + 1.2, z, height: t.height });
    }
    // Where the track meets water it gets across: over a river by a bridge, through a brook on stones.
    for (const c of channels) {
      const cr = c.of.crossing;
      if (!cr) continue;
      // Where the water and the track really meet, which the site gives only to the nearest stride.
      let kc = 0;
      for (let k = 0; k < c.x.length; k++) if (Math.hypot(c.x[k] - pathAt(c.z[k]), c.z[k] - cr.z) < Math.hypot(c.x[kc] - pathAt(c.z[kc]), c.z[kc] - cr.z)) kc = k;
      const cx = pathAt(c.z[kc]), cz = c.z[kc], level = c.bed[kc] + c.depth;
      // The way the track runs here, and across it.
      const tx = pathAt(cz + 1) - pathAt(cz - 1), tl = Math.hypot(tx, 2), ux = tx / tl, uz = 2 / tl, lx = uz, lz = -ux;
      crossings.push({ x: cx, z: cz, by: cr.by, level });
      if (cr.by === 'ford') {
        // Stepping stones: flat-topped, a stride apart, standing a hand out of the water. They
        // are for the eye and stop nobody: the brook is shallow enough to walk through.
        const stony = rng.fork('ford');
        for (let at = -c.half - 0.5; at <= c.half + 0.55; at += 0.72) {
          const size = stony.range(0.5, 0.68), off = stony.range(-0.12, 0.12);
          layStone(softRock, cx + ux * at + lx * off, level - size * 0.42, cz + uz * at + lz * off, size, stony.range(0.75, 1.05), stony);
        }
        continue;
      }
      // A bridge: two bearers from bank to bank, planks across them, posts and a rail each side.
      const landing = (dir: number): number => {
        for (let d = c.half + 0.6; d < 8; d += 0.2) {
          const here = ground(cx + ux * dir * d, cz + uz * dir * d);
          if (here > level + 0.12 && ground(cx + ux * dir * (d + 0.6), cz + uz * dir * (d + 0.6)) - here < 0.04) return d + 0.3;
        }
        return 8;
      };
      const d0 = -landing(-1), d1 = landing(1);
      const ax = cx + ux * d0, az = cz + uz * d0, bx = cx + ux * d1, bz = cz + uz * d1;
      const ay = ground(ax, az) + 0.1, by = ground(bx, bz) + 0.1, span = d1 - d0;
      for (const side of [-0.72, 0.72]) beam(ax + lx * side, ay - 0.16, az + lz * side, bx + lx * side, by - 0.16, bz + lz * side, 0.2, 0.24);
      for (let d = 0.14; d < span; d += 0.275) {
        const t = d / span, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, lift = plant.range(-0.008, 0.008);
        beam(x - lx * 1.0, y - 0.015 + lift, z - lz * 1.0, x + lx * 1.0, y - 0.015 + lift, z + lz * 1.0, 0.25, 0.05);
      }
      for (const side of [-1.02, 1.02]) {
        const posts = Math.max(2, Math.round(span / 2.4) + 1);
        let last: [number, number, number] | null = null;
        for (let i = 0; i < posts; i++) {
          const t = i / (posts - 1), x = ax + (bx - ax) * t + lx * side, y = ay + (by - ay) * t, z = az + (bz - az) * t + lz * side;
          beam(x, Math.min(ground(x, z), y) - 0.5, z, x, y + 1.02, z, 0.13, 0.13);
          if (last) beam(last[0], last[1] + 0.92, last[2], x, y + 0.92, z, 0.09, 0.11);
          last = [x, y, z];
        }
      }
    }
    for (const f of ponds) {
      const outline: number[] = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2, r = shoreOf(f, Math.cos(a), Math.sin(a)) * 1.12;
        outline.push(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r);
      }
      waters.push({ x: f.x, z: f.z, r: f.r * 1.15, level: f.level, outline });
      // A landing stage, built out from the bank nearest the track: a deck of planks on two
      // bearers, carried on posts that stand on the bed.
      let near = 0, nearD = Infinity;
      for (let z = f.z - 30; z <= f.z + 30; z += 1) {
        const d = Math.hypot(pathAt(z) - f.x, z - f.z);
        if (d < nearD) { nearD = d; near = z; }
      }
      const ux = (pathAt(near) - f.x) / nearD, uz = (near - f.z) / nearD;
      const deck = f.level + 0.42, shore = shoreOf(f, ux, uz);
      // A pool is too small to want a landing stage; what was lost there lies at the water's edge.
      if (shore < 6) {
        let d = shore;
        while (d > shore * 0.4 && ground(f.x + ux * d, f.z + uz * d) > f.level + 0.1) d -= 0.2;
        finds.push({ at: V(f.x + ux * (d + 0.3), ground(f.x + ux * (d + 0.3), f.z + uz * (d + 0.3)) + 0.35, f.z + uz * (d + 0.3)), what: 'a silver ring, lost at the edge of the pool' });
        continue;
      }
      let from = shore * 1.3;
      while (from > shore * 0.5 && ground(f.x + ux * from, f.z + uz * from) > deck - 0.1) from -= 0.2;
      from += 0.5;
      const to = Math.max(shore * 0.2, from - 9), half = 0.62;
      const at = (d: number, side: number): [number, number] => [f.x + ux * d - uz * side, f.z + uz * d + ux * side];
      for (const side of [-half + 0.1, half - 0.1]) {
        const [ax, az] = at(from, side), [bx, bz] = at(to, side);
        beam(ax, deck - 0.12, az, bx, deck - 0.12, bz, 0.12, 0.14);
      }
      for (let d = from - 0.14; d > to; d -= 0.27) {
        const [ax, az] = at(d, -half), [bx, bz] = at(d, half);
        const lift = plant.range(0, 0.012);
        beam(ax, deck - 0.025 + lift, az, bx, deck - 0.025 + lift, bz, 0.24, 0.05);
      }
      for (let d = to + 0.3; d < from - 0.6; d += 1.9) for (const side of [-half + 0.1, half - 0.1]) {
        const [px, pz] = at(d, side);
        beam(px, ground(px, pz) - 0.4, pz, px + plant.range(-0.03, 0.03), deck + (d < to + 0.5 ? 0.55 : -0.05), pz, 0.13, 0.13);
      }
      const [ex, ez] = at(to + 0.45, 0);
      finds.push({ at: V(ex, deck + 0.3, ez), what: 'a silver ring, lost off the end of the landing stage' });
    }
    for (const f of rings) {
      // Standing stones: tall rough slabs set on end in a ring, each facing the middle, one fallen.
      const top = ground(f.x, f.z);
      const count = 6 + plant.int(0, 2), fallen = plant.int(0, count - 1), turn = plant.range(0, Math.PI * 2);
      for (let k = 0; k < count; k++) {
        const a = turn + (k / count) * Math.PI * 2 + plant.range(-0.12, 0.12);
        const x = f.x + Math.cos(a) * f.r, z = f.z + Math.sin(a) * f.r, base = ground(x, z);
        const down = k === fallen;
        const tall = plant.range(1.9, 2.9), wide = plant.range(0.5, 0.75), thick = plant.range(0.24, 0.36), ts = plant.range(0, 80);
        const ca = Math.cos(a), sa = Math.sin(a);
        const form = monolithForm(rng.fork(`stone${k}`), tall * 0.5, wide * 0.5, thick * (down ? 0.45 : 0.5), rockKind, down);
        const cy = base + (down ? thick * 0.2 : tall * 0.42);
        carveRock(sceneryMesh('rock'), (qx, qy, qz) => {
          // Turned so that the stone's broad face looks at the middle of the ring; a fallen one lies along the ring.
          const dx = qx - x, dz = qz - z;
          return form.density(-dx * sa + dz * ca, qy - cy, dx * ca + dz * sa);
        }, {
          min: V(x - form.reach, base - 0.5, z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
          cell: 0.1, uvScale: 0.5, fromSamples: true, occlusion: [0.2, 0.5], sharp: true,
          shade: (c, n, field, _other, open) => {
            const h = c.y - base;
            field[0] = Math.min(1, Math.max(0, n.y) * 1.0 + 0.25 + (1 - open) * 0.3);
            field[1] = 0.4 * (1 - smooth(h / 0.3));
            return rockColour((0.72 + 0.45 * fbm3(c.x * 1.2 + ts, c.y * 0.5, c.z * 1.2, 3)) * (0.55 + 0.45 * open));
          },
        });
        stones.push([x, z, down ? tall * 0.5 : 0.5]);
      }
      // The flat stone in the middle, and what was left on it.
      boulder(sceneryMesh('rock'), f.x, f.z, 0.62, plant);
      finds.push({ at: V(f.x, top + 0.75, f.z), what: 'an offering left on the stone in the ring: a little figure cut from horn' });
    }
    for (const f of ruins) {
      // What is left of a hut: four walls of the house's stone, broken down unevenly, with a
      // doorway on the side of the track and fallen stones about.
      const base = ground(f.x, f.z), ts = plant.range(0, 90);
      const hw = f.r * 0.62, hd = f.r * 0.5, t = 0.55;
      const doorSide = pathAt(f.z) > f.x ? 1 : -1;
      const tall = plant.range(0, Math.PI * 2);
      const heightAt = (x: number, z: number) => {
        const towards = Math.cos(Math.atan2(z - f.z, x - f.x) - tall);
        return Math.max(0.35, 0.7 + 1.5 * (0.5 + 0.5 * towards) + (fbm2(x * 0.9 + ts, z * 0.9, 2) - 0.5) * 1.6);
      };
      let piece = 0;
      const run = (x0: number, z0: number, x1: number, z1: number, gap: boolean) => {
        const along = Math.max(x1 - x0, z1 - z0), n = Math.max(2, Math.round(along / 1.05));
        for (let k = 0; k < n; k++) {
          const a0 = k / n, a1 = (k + 1) / n;
          const ax = x1 - x0 > z1 - z0, mid = (a0 + a1) / 2;
          // The doorway: a gap in the middle of this wall.
          if (gap && Math.abs(mid - 0.5) * along < 0.65) continue;
          const bx0 = ax ? x0 + (x1 - x0) * a0 : x0, bx1 = ax ? x0 + (x1 - x0) * a1 : x1;
          const bz0 = ax ? z0 : z0 + (z1 - z0) * a0, bz1 = ax ? z1 : z0 + (z1 - z0) * a1;
          const h = heightAt((bx0 + bx1) / 2, (bz0 + bz1) / 2);
          wild.box('stone', V(bx0, base - 0.5, bz0), V(bx1, base + h, bz1), dressed, dressed, `ruin${piece++}`);
        }
      };
      run(f.x - hw, f.z - hd, f.x + hw, f.z - hd + t, false);
      run(f.x - hw, f.z + hd - t, f.x + hw, f.z + hd, false);
      run(f.x - hw, f.z - hd + t, f.x - hw + t, f.z + hd - t, doorSide < 0);
      run(f.x + hw - t, f.z - hd + t, f.x + hw, f.z + hd - t, doorSide > 0);
      for (let k = 0; k < 9; k++) {
        const a = plant.range(0, Math.PI * 2), d = plant.range(hw + 0.6, hw + 2.6);
        const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d * 0.8, sx = plant.range(0.3, 0.6), sz = plant.range(0.25, 0.5), sy = plant.range(0.16, 0.34);
        // Nothing is left lying in the doorway.
        if (Math.sign(x - f.x) === doorSide && Math.abs(z - f.z) < 1.4) continue;
        wild.box('stone', V(x - sx / 2, ground(x, z) - 0.1, z - sz / 2), V(x + sx / 2, ground(x, z) + sy, z + sz / 2), { ...ashlar, length: [1, 1], course: [1, 1], chip: 0.6 }, undefined, `fallen${k}`);
      }
      finds.push({ at: V(f.x - doorSide * (hw - 1.3), base + 0.55, f.z), what: 'a pilgrim\'s badge of pewter, dropped in the ruined hut' });
    }
    // A fence along one side of the track where it comes into the valley: posts and two rails, some of them gone.
    if (site.grounds) {
      const side = plant.chance(0.5) ? 1 : -1;
      let last: [number, number, number] | null = null;
      for (let z = g.z1 - 15; z > g.z1 - 46; z -= 2.3) {
        const x = pathAt(z) + side * 2.1, y = ground(x, z);
        if (clearOfFeatures(x, z) < 1 || !clearOfStones(x, z, 0.3)) { last = null; continue; }
        beam(x, y - 0.35, z, x + plant.range(-0.04, 0.04), y + 1.05, z + plant.range(-0.04, 0.04), 0.13, 0.13);
        if (last) for (const h of [0.5, 0.9]) if (plant.chance(0.86)) beam(last[0], last[1] + h, last[2], x, y + h, z, 0.06, 0.11);
        last = [x, y, z];
      }
    }

    // Where the player comes in: at the far end of the track, facing up the valley to the house.
    if (site.grounds) {
      const z = knots[knots.length - 1][1];
      arrival.spawn = V(pathAt(z), ground(pathAt(z), z) + 1.75, z);
      for (let w = z - 6; w > p.z1 - 2; w -= 6) arrival.track.push([pathAt(w), w]);
      arrival.track.push([pathAt(p.z1 - 4), p.z1 - 4]);
    }
    scenery.cards.push(...planting.sets);
  };
  const planting = new Planting();
  let farCover: { wood: [number, number, number]; grass: [number, number, number]; sward?: [number, number, number]; bare?: [number, number, number, number] } | undefined;
  const arrival: { spawn: Vector3 | null; track: [number, number][] } = { spawn: null, track: [] };
  const fences: { min: Vector3; max: Vector3 }[] = [];
  let underDeep: { min: Vector3; max: Vector3 } | undefined;
  let groundLow = Infinity;
  // Where smoke rises out of doors.
  const smokes: { x: number; y: number; z: number; height: number }[] = [];
  /**
   * Whether a point lies outside what the sun's shadow and the open sky are reckoned over (the box of the house and the valley: see
   * the scene's `bounds`). Rock out there that is under the hill cannot be shadowed, and would stand in full sun; so it is made of
   * the kind that is told it sees no sky at all, as a hall under the hill is, and is lit by nothing but what is carried into it.
   */
  const mapBox = (() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity;
    for (const q of places) { x0 = Math.min(x0, q.x0 - 3); x1 = Math.max(x1, q.x1 + 3); z0 = Math.min(z0, q.z0 - 3); }
    if (site.grounds) { x0 = Math.min(x0, site.grounds.x0 - 2); x1 = Math.max(x1, site.grounds.x1 + 2); }
    return { x0, x1, z0 };
  })();
  const offMap = (x: number, z: number) => x < mapBox.x0 + 1.5 || x > mapBox.x1 - 1.5 || z < mapBox.z0 + 1.5;
  const sunless = () => { const was = wild.group; wild.group = 'under'; const m = wild.mesh('rock'); wild.group = was; return m; };
  const waters: { x: number; z: number; r: number; level: number; outline?: number[] }[] = [];
  const flows: { line: number[]; width: number; banks?: number[]; fade?: number[] }[] = [];
  const falls: { x: number; y: number; z: number; height: number; width: number }[] = [];
  const lookouts: { x: number; y: number; z: number; height: number }[] = [];
  const hallTorches: TorchSpec[] = [];
  const unders: { min: Vector3; max: Vector3 }[] = [];
  const sunShafts: { top: Vector3; down: Vector3; length: number; radius: number }[] = [];
  const landmarkSpots: { kind: string; x: number; y: number; z: number }[] = [];
  const crossings: { x: number; z: number; by: 'ford' | 'bridge'; level: number }[] = [];
  const finds: { at: Vector3; what: string }[] = [];
  const censuses: Record<string, number>[] = [];
  const wild = new Kit(`${site.seed}/wild`);
  wild.group = 'wild';
  const scenery: { meshes: Map<string, MeshBuilder>; cards: CardSet[] } = { meshes: wild.meshes, cards: [] };
  const trees: [number, number][] = [];

  // ------------------------------------------------------------------ caves
  // Chambers joined by clefts make one cave. Each is listed under every chamber it holds, first chamber first.
  const cavesOf = new Map<number, number[]>();
  for (const p of places) {
    if (p.roof !== 'cave' || cavesOf.has(p.id)) continue;
    const system = [p.id];
    for (let k = 0; k < system.length; k++) {
      for (const w of site.ways) {
        if (!w.natural || (w.a !== system[k] && w.b !== system[k])) continue;
        const other = w.a === system[k] ? w.b : w.a;
        if (!system.includes(other)) system.push(other);
      }
    }
    for (const id of system) cavesOf.set(id, system);
  }
  /**
   * The open air of one chamber, as a function that is positive in air and negative in rock: an
   * uneven dome over a rough oval floor, with a bay reaching towards each way in, and a shaft to
   * the sky if it has one.
   */
  const chamberAir = (p: Place): ((x: number, y: number, z: number) => number) => {
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const holes = SIDES.flatMap((side) => holesOn(p, side, 0).map((h) => ({ side, at: h.at, w: h.w, natural: !!h.way.natural })));
    const doorPoint = (d: { side: Side; at: number }) => (d.side === 'n' ? [d.at, p.z0] : d.side === 's' ? [d.at, p.z1] : d.side === 'w' ? [p.x0, d.at] : [p.x1, d.at]);
    // Sides the builders walled, where masonry hides the edge of the rock.
    const walled = new Set(holes.filter((d) => !d.natural).map((d) => d.side));
    const rx = dx / 2 - 0.35, rz = dz / 2 - 0.35, rMin = Math.min(rx, rz);
    const seeds = rng.fork(`cave${p.id}`);
    const s1 = seeds.range(0, 50), s2 = seeds.range(0, 50);
    const shape = (x: number, z: number): { e: number; nearDoor: number } => {
      let e = (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * rMin;
      e += (fbm2(x * 0.5 + s1, z * 0.5 + s2, 3) - 0.5) * 1.5;
      // Keep clear of the sides that have no wall to hide the edge of the rock.
      let limit = Infinity;
      if (!walled.has('n')) limit = Math.min(limit, z - p.z0);
      if (!walled.has('s')) limit = Math.min(limit, p.z1 - z);
      if (!walled.has('w')) limit = Math.min(limit, x - p.x0);
      if (!walled.has('e')) limit = Math.min(limit, p.x1 - x);
      e = Math.min(e, limit - 0.25);
      let nearDoor = Infinity;
      for (const d of holes) {
        const [qx, qz] = doorPoint(d);
        const dd = Math.hypot(x - qx, z - qz);
        nearDoor = Math.min(nearDoor, dd);
        e = Math.max(e, d.w + 0.9 - dd);
      }
      return { e, nearDoor };
    };
    return (x, y, z) => {
      let { e, nearDoor } = shape(x, z);
      // Ledges and hollows a hand's breadth to a pace across, so the walls are not smooth.
      e += (fbm2(x * 1.9 + y * 1.1 + s1, z * 1.9 - y * 0.8 + s2, 3) - 0.5) * 0.5 * Math.min(1, nearDoor / 1.5);
      const settle = Math.min(1, Math.max(0, (nearDoor - 1.3) / 1.6));
      const floorY = p.floor - 0.006 + (fbm2(x * 0.8 + s2, z * 0.8 + s1, 3) - 0.5) * 0.34 * settle;
      const dome = Math.pow(Math.min(1, Math.max(0, e / rMin)), 0.55);
      let ceilY = p.floor + p.wall * (0.5 + 0.5 * dome) + (fbm2(x * 0.65 + s1 + 9, z * 0.65 + s2, 3) - 0.5) * 0.9;
      ceilY = Math.max(ceilY, p.floor + 3.5 - nearDoor * 0.5);
      const air = smin(smin(e, y - floorY, 0.35), ceilY - y, 0.5);
      // Whatever the noise does, the rock must close before it reaches the edge of the space
      // being carved, except towards a masonry wall, which hides the edge.
      let edge = Math.min(p.floor + p.wall + 1.2 - y, y - (p.floor - 0.6));
      if (!walled.has('n')) edge = Math.min(edge, z - p.z0);
      if (!walled.has('s')) edge = Math.min(edge, p.z1 - z);
      if (!walled.has('w')) edge = Math.min(edge, x - p.x0);
      if (!walled.has('e')) edge = Math.min(edge, p.x1 - x);
      // And towards a masonry wall, through the wall and half a metre on, no further: so that it does not end in a skin of rock
      // across the doorway. What it makes beyond the wall, in the next place, is not kept (see where caves are carved).
      edge = Math.min(edge, z - (p.z0 - T - 0.5), p.z1 + T + 0.5 - z, x - (p.x0 - T - 0.5), p.x1 + T + 0.5 - x);
      let out = Math.min(air, edge - 0.2);
      if (p.shaft) {
        // Where the roof fell in long ago: a hole to the open hill, wider at the top than the bottom.
        const lean = (y - p.floor) * 0.03;
        const flare = 1 + 0.45 * Math.min(1, Math.max(0, (y - p.floor - p.wall * 0.6) / (site.top - p.floor - p.wall * 0.6)));
        const r = p.shaft.r * flare * (0.85 + 0.3 * fbm2(y * 0.5 + s1, Math.atan2(z - p.shaft.z, x - p.shaft.x) * 1.5 + s2, 2));
        out = Math.max(out, Math.min(r - Math.hypot(x - p.shaft.x - lean, z - p.shaft.z + lean * 0.6), y - (p.floor + p.wall * 0.6)));
      }
      return out;
    };
  };
  /** The air of a cleft between two chambers: a rough tube through the rock, its floor sloping from one level to the other. */
  const cleftAir = (w: Way): ((x: number, y: number, z: number) => number) => {
    const a = places[w.a], b = places[w.b];
    const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[w.side];
    const alongX = w.side === 'n' || w.side === 's';
    const edge = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
    const seeds = rng.fork(`cleft${w.a}-${w.b}`);
    const t1 = seeds.range(0, 50), bend = seeds.range(-0.5, 0.5);
    // Where the floor begins to climb and where it has done, measured through the wall from the first chamber's edge.
    // (No further into either chamber than it is deep, less a little: a cleft at the far side of a shallow chamber would otherwise run on
    // through it at its own floor, and out the other side into whatever lies beyond.)
    const depthA = (alongX ? a.z1 - a.z0 : a.x1 - a.x0) - 0.6, depthB = (alongX ? b.z1 - b.z0 : b.x1 - b.x0) - 0.6;
    const steep = Math.abs(a.floor - b.floor) > 0.6, reach = steep ? Math.min(3.4, 1.4 + Math.abs(a.floor - b.floor) * 0.9, a.floor >= b.floor ? depthA : depthB) : 0;
    const rise0 = !steep ? 0 : a.floor >= b.floor ? -reach : 0.1, rise1 = !steep ? T : a.floor >= b.floor ? T - 0.1 : T + reach;
    return (x, y, z) => {
      // t runs from the first chamber's edge through the wall; s is the distance to one side.
      const t = alongX ? (z - edge) * n[1] : (x - edge) * n[0];
      // The floor climbs on the side of the higher chamber, where it cuts a way down into that
      // chamber's floor, and is level with the lower chamber by the time it reaches it: so there
      // is no ledge to get up at either end.
      const f = Math.min(1, Math.max(0, (t - rise0) / (rise1 - rise0)));
      const s = (alongX ? x : z) - w.at - bend * Math.sin(f * Math.PI);
      const floorY = a.floor + (b.floor - a.floor) * (f * f * (3 - 2 * f)) + (fbm2(x * 1.1 + t1, z * 1.1, 2) - 0.5) * 0.07;
      const wide = w.halfWidth + 0.15 + (fbm2(t * 0.9 + t1, y * 0.8, 2) - 0.5) * 0.5;
      const high = 2.45 + (fbm2(x * 0.8 + t1, z * 0.8 + 7, 2) - 0.5) * 0.7;
      const air = smin(smin(wide - Math.abs(s), y - floorY, 0.3), floorY + high - y, 0.4);
      // It reaches a good pace into each chamber, and no further.
      return Math.min(air, t + Math.min(depthA, 1.5 - Math.min(0, rise0 - 0.3)), T + Math.min(depthB, 1.5 + Math.max(0, rise1 - T + 0.3)) - t);
    };
  };
  // An island in place of a valley: the house front where it meets the forecourt is built here, as for a house standing
  // free in a valley, and everything else out of doors by the island's own builder (see `island.ts`).
  let islandSea: SeaDesc | undefined, spawnYaw = 0, birdSpots: { x: number; y: number; z: number }[] | undefined, beacon: { x: number; y: number; z: number } | undefined;
  const buildIslandApproach = (p: Place) => {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const fx0 = Math.max(p.x0 - 0.2, Math.min(...outerRects.map((r) => r.x0))), fx1 = Math.min(p.x1 + 0.2, Math.max(...outerRects.map((r) => r.x1)));
    kit.wallFace('stone', kit.frame(fx0, p.z0, fx1, p.z0), p.floor - 0.7, site.top, ashlar, { openings: holesOn(p, 'n', 0).map((h) => ({ ...h, c: h.at - fx0 })) });
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const made = buildIsland({ site, p, kit, wild, rng: rng.fork('approach'), planting, cards: scenery.cards, fences, finds, outerRects, stoneTint, flag });
    arrival.spawn = made.spawn;
    arrival.track = made.track;
    farCover = made.far;
    islandSea = made.sea;
    spawnYaw = made.yaw;
    censuses.push(made.planted);
    unders.push(...made.unders);
    birdSpots = made.birds;
    flockSpots = made.flocks;
    beacon = made.lamp;
    flows.push(...made.streams);
    falls.push(...made.falls);
    scenery.cards.push(...planting.sets);
  };
  // A mountain top in place of a valley: the same, with the mountain's own builder (see `mountain.ts`).
  let cloudDeck: SceneDescription['deck'], rockSharp: number | undefined;
  const buildMountainApproach = (p: Place) => {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const fx0 = Math.max(p.x0 - 0.2, Math.min(...outerRects.map((r) => r.x0))), fx1 = Math.min(p.x1 + 0.2, Math.max(...outerRects.map((r) => r.x1)));
    kit.wallFace('stone', kit.frame(fx0, p.z0, fx1, p.z0), p.floor - 0.7, site.top, ashlar, { openings: holesOn(p, 'n', 0).map((h) => ({ ...h, c: h.at - fx0 })) });
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const made = buildMountain({ site, p, kit, wild, rng: rng.fork('approach'), planting, cards: scenery.cards, fences, finds, outerRects, stoneTint, flag });
    arrival.spawn = made.spawn;
    arrival.track = made.track;
    farCover = made.far;
    spawnYaw = made.yaw;
    cloudDeck = made.deck;
    censuses.push(made.planted);
    lookouts.push(made.lookout);
    hallTorches.push(...made.torches);
    rockSharp = made.sharp;
    birdSpots = made.birds;
    smokes.push(...made.smokes);
    scenery.cards.push(...planting.sets);
  };
  const glows: { from: Vector3; position: Vector3; colour: [number, number, number]; strength: number }[] = [];
  // Where a cave's shaft comes up through the hill, the turf laid over the house is left open.
  const skylights = places.filter((q) => q.shaft).map((q) => ({ x0: q.shaft!.x - q.shaft!.r * 1.5 - 0.6, x1: q.shaft!.x + q.shaft!.r * 1.5 + 0.6, z0: q.shaft!.z - q.shaft!.r * 1.5 - 0.6, z1: q.shaft!.z + q.shaft!.r * 1.5 + 0.6 }));

  for (const p of places) {
    if (p.role === 'approach') { if (site.island) buildIslandApproach(p); else if (site.mountain) buildMountainApproach(p); else buildApproach(p); continue; }
    kit.group = `p${p.id}`;
    const open = p.roof === 'sky';
    const damp = { kept: 0.6, damp: 1.9, forsaken: 1.3 }[site.setting.condition];
    kit.field = open ? outdoorFieldAt(p.floor, p.fallen ? 1.8 : site.setting.condition === 'kept' ? 0.7 : 1.2) : indoorField(torchesByPlace.get(p.id)!, p.floor, damp);
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const roofY = p.floor + p.wall;

    const cave = p.roof === 'cave';
    if (cave) {
      kit.mass(V(p.x0, p.floor - 1.6, p.z0), V(p.x1, p.floor - 0.7, p.z1));
    } else {
      // The floor: flags on the ground, boards over another room; and left open over any stair that comes up through it.
      const wells = stairsInto(p).map(wellRect);
      for (const r of without({ x0: p.x0 - 0.1, x1: p.x1 + 0.1, z0: p.z0 - 0.1, z1: p.z1 + 0.1 }, wells)) {
        if ((p.level ?? 0) > 0) kit.plane('wood', V(r.x0, p.floor, r.z0), V(0, 0, 1), V(1, 0, 0), V(0, 1, 0), r.z1 - r.z0, r.x1 - r.x0, plank);
        else kit.slab('floor', r.x0, r.z0, r.x1, r.z1, p.floor, open ? flag : hallFlag);
      }
      // Solid under it, unless there is a room there.
      if (!roomUnder(p)) kit.mass(V(p.x0, p.floor - 1.2, p.z0), V(p.x1, p.floor - 0.035, p.z1));
      for (const w of stairsInto(p)) {
        // The thickness of the floor shows round the well: it is boarded in, on the two sides that are not wall or stair.
        const r = wellRect(w), under = places[w.a], y0 = under.floor + under.wall - 0.27, alongX = w.side === 'n' || w.side === 's', f = flightOf(w);
        const foot = w.at + f.dir * stepsUnderCeiling(w) * f.tread;
        // And a rail stands on those two sides, so nobody walks into the well: posts, a top rail and one below it.
        // The end where the stair comes up is left open.
        const railed = (ax: number, az: number, bx: number, bz: number) => {
          const length = Math.hypot(bx - ax, bz - az), posts = Math.max(2, Math.ceil(length / 1.25) + 1);
          for (let i = 0; i < posts; i++) {
            const x = ax + ((bx - ax) * i) / (posts - 1), z = az + ((bz - az) * i) / (posts - 1);
            kit.box('wood', V(x - 0.05, p.floor - 0.02, z - 0.05), V(x + 0.05, p.floor + 0.98, z + 0.05), beam, beam, 'post');
          }
          for (const [low, high] of [[0.86, 0.95], [0.42, 0.5]]) kit.box('wood', V(Math.min(ax, bx) - 0.04, p.floor + low, Math.min(az, bz) - 0.04), V(Math.max(ax, bx) + 0.04, p.floor + high, Math.max(az, bz) + 0.04), beam, beam, 'rail');
        };
        if (alongX) {
          const zi = w.side === 'n' ? r.z1 : r.z0, zw = w.side === 'n' ? r.z0 : r.z1;
          kit.box('wood', V(r.x0, y0, Math.min(zi, zi + (w.side === 'n' ? 0.07 : -0.07))), V(r.x1, p.floor, Math.max(zi, zi + (w.side === 'n' ? 0.07 : -0.07))), beam, beam, 'trimmer');
          kit.box('wood', V(Math.min(foot, foot - f.dir * 0.07), y0, r.z0), V(Math.max(foot, foot - f.dir * 0.07), p.floor, r.z1), beam, beam, 'trimmer');
          railed(foot - f.dir * 0.05, zi + (w.side === 'n' ? 0.05 : -0.05), f.to, zi + (w.side === 'n' ? 0.05 : -0.05));
          railed(foot - f.dir * 0.05, zw + (w.side === 'n' ? 0.1 : -0.1), foot - f.dir * 0.05, zi + (w.side === 'n' ? 0.05 : -0.05));
        } else {
          const xi = w.side === 'w' ? r.x1 : r.x0, xw = w.side === 'w' ? r.x0 : r.x1;
          kit.box('wood', V(Math.min(xi, xi + (w.side === 'w' ? 0.07 : -0.07)), y0, r.z0), V(Math.max(xi, xi + (w.side === 'w' ? 0.07 : -0.07)), p.floor, r.z1), beam, beam, 'trimmer');
          kit.box('wood', V(r.x0, y0, Math.min(foot, foot - f.dir * 0.07)), V(r.x1, p.floor, Math.max(foot, foot - f.dir * 0.07)), beam, beam, 'trimmer');
          railed(xi + (w.side === 'w' ? 0.05 : -0.05), foot - f.dir * 0.05, xi + (w.side === 'w' ? 0.05 : -0.05), f.to);
          railed(xw + (w.side === 'w' ? 0.1 : -0.1), foot - f.dir * 0.05, xi + (w.side === 'w' ? 0.05 : -0.05), foot - f.dir * 0.05);
        }
      }
      for (const w of stairsFrom(p)) {
        // The flight: courses of stone a step high, each a step shorter than the one under it.
        const f = flightOf(w), fr = frameOf(p, w.side, 0), stepStyle: MasonryStyle = { ...hallFlag, course: [STEP, STEP], length: [0.8, 1.3] };
        for (let k = 1; k <= f.steps; k++) {
          const b = wallBox(fr, alongFrame(p, w.side, w.at + f.dir * (k - 1) * f.tread, 0), alongFrame(p, w.side, f.to, 0), p.floor + STEP * (k - 1) - (k === 1 ? 0.05 : 0), p.floor + STEP * k, 0, -f.wide);
          kit.box('floor', b.min, b.max, stepStyle, hallFlag, 'step');
        }
      }
    }

    // Walls, and the solid behind them.
    for (const side of SIDES) {
      const top = wallTop(p, side);
      const f = frameOf(p, side, 0.1);
      const mid = f.length / 2;
      const R = span(p) / 2;
      const end = p.roof === 'barrel' && isEndWall(p, side);
      // A cave has masonry only where the builders walled it off to hang a door.
      if (!cave || holesOn(p, side, 0).some((h) => !h.way.natural)) {
        kit.wallFace('stone', f, cave ? p.floor - 0.6 : p.floor - 0.1, top, ashlar, {
          openings: holesOn(p, side, 0.1),
          keep: end ? (u, y) => y < roofY + 0.3 || Math.hypot(u - mid, y - roofY) < R + 0.45 : undefined,
        });
      }
      // Solid behind the wall, one wall's thickness deep; beyond that is another place or the outside.
      const ext = T / 2 + 0.02;
      kit.wallMass(frameOf(p, side, ext), T, p.floor - 1.2, p.roof === 'sky' ? top : site.top, holesOn(p, side, ext));
    }

    // Roof.
    if (cave) {
      // A cave is carved once, whole, when its first chamber comes up: every chamber and every
      // cleft between them as one body of air in one body of rock, so nothing has to be joined.
      const system = cavesOf.get(p.id)!;
      if (system[0] === p.id) {
        const airs = system.map((id) => chamberAir(places[id]));
        const clefts = site.ways.filter((w) => w.natural && system.includes(w.a)).map(cleftAir);
        const through = backWay && system.includes(backWay.p.id) ? backWay : null;
        const all = through ? [...airs, ...clefts, through.air] : [...airs, ...clefts];
        const members = system.map((id) => places[id]);
        const shafted = members.some((q) => q.shaft);
        const wetField = indoorField([], Math.min(...members.map((q) => q.floor)));
        const tone1 = rng.fork(`cavetone${p.id}`).range(0, 50), tone2 = rng.fork(`cavetone2${p.id}`).range(0, 50);
        // (Nothing of the rock is kept inside another place: where a chamber's way in reaches through a wall into a built room, the rock it would end in there is not made.)
        const others = places.filter((q) => !system.includes(q.id) && q.role !== 'approach');
        carveRock(kit.mesh('rock'), (x, y, z) => {
          let air = -Infinity;
          for (const f of all) air = Math.max(air, f(x, y, z));
          return air;
        }, {
          keep: (at) => !others.some((q) => at.x > q.x0 - 0.02 && at.x < q.x1 + 0.02 && at.z > q.z0 - 0.02 && at.z < q.z1 + 0.02 && at.y > q.floor - 0.6 && at.y < q.floor + q.wall + 2),
          min: V(Math.min(...members.map((q) => q.x0)) - 0.14, Math.min(...members.map((q) => q.floor)) - 0.9, Math.min(...members.map((q) => q.z0)) - 0.14),
          max: V(Math.max(...members.map((q) => q.x1)) + 0.14, shafted ? site.top - 0.12 : Math.max(...members.map((q) => q.floor + q.wall)) + 1.2, Math.max(...members.map((q) => q.z1)) + 0.14),
          cell: 0.28, uvScale: 0.45,
          shade: (c, n, field) => {
            wetField(c, n, field);
            // Under a shaft, where daylight and rain come down, the rock is green.
            for (const q of members) if (q.shaft) field[0] = Math.max(field[0], (1 - Math.min(1, Math.hypot(c.x - q.shaft.x, c.z - q.shaft.z) / (q.shaft.r * 3.2))) * (0.5 + 0.5 * Math.max(0, n.y)));
            // Beds of slightly different stone, tilted; darker where water has stood.
            const bed = fbm2((c.y + c.x * 0.18) * 2.6, c.z * 0.15 + tone1, 3);
            const blot = fbm2(c.x * 0.9 + tone2, c.z * 0.9 + c.y * 0.7, 3);
            const tone = 0.72 + 0.4 * bed + 0.24 * blot;
            return [0.8 * tone * stoneTint[0], 0.74 * tone * stoneTint[1], 0.65 * tone * stoneTint[2]];
          },
        });
        // The stretch of the way through the hill between the chamber and the rock that is carved with the land; and with it, in one
        // carving, the way down from it and the cavern at its foot. (None of it is kept where the land's carving or the chamber's has it.)
        if (through) {
          const xa = through.x(-0.7), xb = through.x(through.length + 0.3), tone3 = rng.fork('backwaytone').range(0, 50), cv = through.cavern, deepAir = through.deepAir, dp0 = site.backWay!.deep!;
          // (What of it lies beyond the house and the valley is made of rock that sees no sky: see `offMap`. Both are carved on one lattice.)
          const deepMax = V(Math.max(xa, xb, cv ? cv.box[1] : -Infinity), through.top, Math.max(through.z + 3, cv ? cv.box[3] : -Infinity));
          const beyondMap = offMap(through.deepMin.x, through.deepMin.z) || offMap(deepMax.x, through.deepMin.z);
          for (const out of beyondMap ? [false, true] : [false]) carveRock(out ? sunless() : kit.mesh('rock'), deepAir ? (x, y, z) => Math.max(through.air(x, y, z), deepAir(x, y, z)) : through.air, {
            min: through.deepMin,
            max: deepMax, cell: 0.28, uvScale: 0.45,
            keep: (at) => { const al = through.along(at.x); return al < through.length + 0.3 && !(al < -0.7 && at.y > through.start - 2.2 && Math.abs(at.z - through.z) < 3.2) && !(al < -0.7 && !cv) && !through.joinOwn(at.x, at.z) && offMap(at.x, at.z) === out; },
            shade: (c, n, field) => {
              wetField(c, n, field);
              field[1] = Math.max(field[1], cv && c.y < cv.floor + 2 ? 0.6 : 0);
              const tone = 0.72 + 0.4 * fbm2((c.y + c.x * 0.18) * 2.6, c.z * 0.15 + tone3, 3) + 0.24 * fbm2(c.x * 0.9 + tone3, c.z * 0.9 + c.y * 0.7, 3);
              return [0.8 * tone * stoneTint[0], 0.74 * tone * stoneTint[1], 0.65 * tone * stoneTint[2]];
            },
          });
          if (cv) {
            // Rock over the cavern, for the sun's shadow only: where it lies behind the valley's side there is nothing else above it that casts one.
            kit.mass(V(dp0.x - dp0.rx - 2.5, cv.floor + cv.height + 1, dp0.z - dp0.rz - 2.5), V(dp0.x + dp0.rx + 2.5, cv.floor + cv.height + 2.2, dp0.z + dp0.rz + 2.5));
            // (And round its sides, down to below its floor: a low sun came in under the edge of that roof and lit a wall of it.)
            {
              const ax = dp0.rx + 2.5, az = dp0.rz + 2.5, y0 = cv.floor - 1, y1 = cv.floor + cv.height + 2.2;
              for (const k of [-1, 1]) {
                kit.mass(V(dp0.x + k * ax - 0.6, y0, dp0.z - az - 0.6), V(dp0.x + k * ax + 0.6, y1, dp0.z + az + 0.6));
                kit.mass(V(dp0.x - ax - 0.6, y0, dp0.z + k * az - 0.6), V(dp0.x + ax + 0.6, y1, dp0.z + k * az + 0.6));
              }
            }
            // (And along the way down to it: flecks of sun showed on its walls too, inside the ridge and under the arm.)
            for (let i = 6; i < through.deepSamples.length; i += 4) { const q = through.deepSamples[i]; kit.mass(V(q.x - 2.2, q.y + 3.5, q.z - 2.2), V(q.x + 2.2, q.y + 4.3, q.z + 2.2)); }
            // What glows in the cavern, round its walls; and what was left in the middle of it.
            const gr = rng.fork('deepglow');
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2 + gr.range(-0.3, 0.3), y = cv.floor + gr.range(0.5, 2.2);
              glows.push({ from: V(cv.x, y, cv.z), position: V(cv.x + Math.cos(a) * cv.rx * 2, y, cv.z + Math.sin(a) * cv.rz * 2), colour: [0.25, 1.0, 0.72], strength: gr.range(1.3, 2.1) });
            }
            finds.push({ at: V(cv.x, cv.floor + 0.4, cv.z), what: 'a miner\'s lamp and a bag of rough garnets, left in the cavern under the hill' });
          }
        }
      }
      // Rock above the chamber; where a shaft goes up through it, rock all round the shaft.
      const above = p.floor + p.wall + 1.25;
      if (p.shaft) {
        const h = p.shaft.r * 1.5 + 0.4, sx = p.shaft.x, sz = p.shaft.z;
        kit.mass(V(p.x0 - T / 2, above, p.z0 - T / 2), V(p.x1 + T / 2, site.top, sz - h));
        kit.mass(V(p.x0 - T / 2, above, sz + h), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
        kit.mass(V(p.x0 - T / 2, above, sz - h), V(sx - h, site.top, sz + h));
        kit.mass(V(sx + h, above, sz - h), V(p.x1 + T / 2, site.top, sz + h));
        // Ferns in the light at the foot of the shaft.
        const fr = rng.fork(`shaftferns${p.id}`);
        for (let k = 0; k < 16; k++) {
          const a = fr.range(0, Math.PI * 2), d = Math.sqrt(fr.next()) * p.shaft.r * 2.1, t = fr.range(0.8, 1.2), size = fr.range(0.55, 1.0);
          // Cards take their share of sky from the open air; down here that is a fraction, so they are made darker to match.
          planting.tuft(planting.ferns, sx + Math.cos(a) * d, p.floor - 0.03, sz + Math.sin(a) * d, size, size * fr.range(0.55, 0.8), fr.range(0, Math.PI), [0.03 * t, 0.085 * t, 0.016 * t]);
        }
      } else kit.mass(V(p.x0 - T / 2, above, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
      // Growths that glow: clusters low on the rock round the edge of the chamber.
      if (p.light === 'glow') {
        const gr = rng.fork(`glow${p.id}`);
        const count = 3 + gr.int(0, 2), turn = gr.range(0, Math.PI * 2);
        for (let k = 0; k < count; k++) {
          const a = turn + (k / count) * Math.PI * 2 + gr.range(-0.4, 0.4);
          // Aimed from the middle of the chamber; whoever draws it finds the rock along that line.
          const y = p.floor + gr.range(0.3, 1.4);
          glows.push({ from: V(cx, y, cz), position: V(cx + Math.cos(a) * dx, y, cz + Math.sin(a) * dz), colour: [0.25, 1.0, 0.72], strength: gr.range(1.1, 1.9) });
        }
      }
    } else if (p.roof === 'barrel') {
      const R = span(p) / 2;
      const axis = p.axis === 'x' ? V(1, 0, 0) : V(0, 0, 1);
      const start = p.axis === 'x' ? V(p.x0 - 0.1, roofY, cz) : V(cx, roofY, p.z0 - 0.1);
      const length = (p.axis === 'x' ? dx : dz) + 0.2;
      kit.barrelVault('stone', start, axis, length, R, vaultStone);
      kit.mass(V(p.x0 - T / 2, roofY + R + 0.06, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));

      const slots = pilasterSlots.get(p.id)!;
      for (const pos of new Set(slots.map((s) => s.pos))) {
        kit.rib('stone', p.axis === 'x' ? V(pos, roofY, cz) : V(cx, roofY, pos), axis, R, 0.52, 0.3, dressed);
      }
      for (const s of slots) {
        // In the wall's own terms: along it, and out of the wall into the room (negative depth).
        const f = frameOf(p, s.side, 0);
        const u = alongFrame(p, s.side, s.pos, 0);
        if (s.clear) {
          const b = wallBox(f, u - 0.26, u + 0.26, p.floor - 0.1, roofY - 0.2, 0.05, -0.3);
          kit.box('stone', b.min, b.max, ashlar);
        }
        const c = wallBox(f, u - 0.33, u + 0.33, roofY - 0.2, roofY + 0.02, 0.05, -0.37);
        kit.box('stone', c.min, c.max, coping, coping, 'impost');
      }
    } else if (p.roof === 'timber') {
      const alongX = dx >= dz;
      // Boards on beams; with a well left in them wherever a stair goes up through to the room above.
      const wells = stairsFrom(p).map(wellRect);
      for (const r of without({ x0: p.x0 - 0.1, x1: p.x1 + 0.1, z0: p.z0 - 0.1, z1: p.z1 + 0.1 }, wells)) {
        if (alongX) kit.plane('wood', V(r.x0, roofY, r.z0), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), r.x1 - r.x0, r.z1 - r.z0, plank);
        else kit.plane('wood', V(r.x0, roofY, r.z0), V(0, 0, 1), V(1, 0, 0), V(0, -1, 0), r.z1 - r.z0, r.x1 - r.x0, plank);
      }
      const long = alongX ? dx : dz;
      const count = Math.max(2, Math.round(long / 1.05));
      for (let k = 0; k < count; k++) {
        const at = (alongX ? p.x0 : p.z0) + (long * (k + 0.5)) / count;
        // A beam that would cross a well stops at its edge.
        const whole: Rect = alongX ? { x0: at - 0.1, x1: at + 0.1, z0: p.z0 - 0.1, z1: p.z1 + 0.1 } : { x0: p.x0 - 0.1, x1: p.x1 + 0.1, z0: at - 0.1, z1: at + 0.1 };
        for (const r of without(whole, wells.map((h) => (alongX ? { ...h, x0: h.x0 - 0.2, x1: h.x1 + 0.2 } : { ...h, z0: h.z0 - 0.2, z1: h.z1 + 0.2 })))) {
          if (r.x1 - r.x0 > 0.15 && r.z1 - r.z0 > 0.15) kit.box('wood', V(r.x0, roofY - 0.27, r.z0), V(r.x1, roofY, r.z1), beam, beam, 'beam');
        }
      }
      // Solid above, unless there is a room there.
      if (!roomOver(p)) kit.mass(V(p.x0 - T / 2, roofY + 0.08, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
    }

    // Furnishings by role.
    if (p.role === 'court' && !p.fallen) {
      // (In the middle of a cloister, which the walk round it leaves room for; anywhere near the middle of a smaller court.)
      // (The same chances are drawn either way, so that nothing drawn after them is dealt differently.)
      const cloister = Math.min(dx, dz) >= 7.4, nx = dx > 6 ? rng.range(-0.8, 0.8) : 0, nz = dz > 6 ? rng.range(-0.8, 0.8) : 0;
      const wx = cx + (cloister ? 0 : nx), wz = cz + (cloister ? 0 : nz);
      const y = p.floor;
      kit.roundWall('stone', wx, wz, 0.95, y - 0.1, y + 0.85, { ...ashlar, length: [0.45, 0.6] }, false, { open: { v1: true } });
      kit.roundWall('stone', wx, wz, 0.68, y - 2.5, y + 0.85, { ...ashlar, length: [0.35, 0.5] }, true, { open: { v1: true } });
      kit.ring('stone', wx, wz, 0.68, 0.95, y + 0.85, { ...dressed, length: [0.5, 0.65] });
      // A cloister walk round a court that has room for one: slender columns a stride and a half in from the walls, a beam along their
      // heads, and a lean-to roof of tiles from the wall down to the beam. No column stands before a doorway or an arch.
      if (cloister) {
        const inset = 1.85, h = 2.9, tilesC = kit.mesh('tile'), roofTone: [number, number, number] = [1.1, 1.03, 0.98];
        const lineAt = (side: Side) => (side === 'n' ? p.z0 + inset : side === 's' ? p.z1 - inset : side === 'w' ? p.x0 + inset : p.x1 - inset);
        for (const side of SIDES) {
          const along = side === 'n' || side === 's', lo = (along ? p.x0 : p.z0) + inset, hi = (along ? p.x1 : p.z1) - inset, line = lineAt(side);
          const holes = holesOn(p, side, 0), n = Math.max(1, Math.round((hi - lo) / 2.3));
          for (let k = 0; k <= n; k++) {
            // (The corner columns are set out from the walls along x, and not again from those along z.)
            if (!along && (k === 0 || k === n)) continue;
            const pos = lo + ((hi - lo) * k) / n;
            if (k > 0 && k < n && holes.some((q) => Math.abs(q.at - pos) < q.w + 0.75)) continue;
            const x = along ? pos : line, z = along ? line : pos;
            kit.box('stone', V(x - 0.24, y - 0.05, z - 0.24), V(x + 0.24, y + 0.22, z + 0.24), coping, coping, 'base');
            kit.box('stone', V(x - 0.15, y + 0.22, z - 0.15), V(x + 0.15, y + h - 0.22, z + 0.15), dressed, coping, 'colonnette');
            kit.box('stone', V(x - 0.25, y + h - 0.22, z - 0.25), V(x + 0.25, y + h, z + 0.25), coping, coping, 'capital');
          }
          const a = lo - 0.25, b = hi + 0.25;
          kit.box('wood', along ? V(a, y + h, line - 0.14) : V(line - 0.14, y + h, a), along ? V(b, y + h + 0.26, line + 0.14) : V(line + 0.14, y + h + 0.26, b), beam, beam, 'walkbeam');
          // The roof: from the wall a metre higher than the beam, down to a hand beyond it.
          const wallLine = side === 'n' ? p.z0 : side === 's' ? p.z1 : side === 'w' ? p.x0 : p.x1, out = side === 'n' || side === 'w' ? 1 : -1;
          const lowY = y + h + 0.26, highY = lowY + 1.05, past = line + out * 0.35, from = lo - inset, to = hi + inset;
          const pts = along
            ? [V(from, highY, wallLine), V(to, highY, wallLine), V(to - (out > 0 ? 0 : 0), lowY, past), V(from, lowY, past)]
            : [V(wallLine, highY, from), V(wallLine, highY, to), V(past, lowY, to), V(past, lowY, from)];
          tileFace(tilesC, pts, roofTone, along ? V((from + to) / 2, lowY - 1, line) : V(line, lowY - 1, (from + to) / 2));
          tileFace(tilesC, pts.map((q) => q.clone().setY(q.y - 0.08)), roofTone, along ? V((from + to) / 2, lowY + 2, line) : V(line, lowY + 2, (from + to) / 2));
        }
      }
    }
    if ((p.role === 'goal' || p.role === 'reward') && !cave) {
      // A stone chest against the wall opposite the way in; the goal's is larger and raised.
      const door = site.ways.find((w) => w.kind === 'door' && (w.a === p.id || w.b === p.id));
      // Against the wall opposite the way in, unless that wall has an opening of its own (a
      // secret door, say); then against whichever wall is blank.
      // (A room reached only by a stair has its chest across the room from the stair.)
      const stairSides = [...stairsFrom(p), ...stairsInto(p)].map((w) => w.side);
      const opposite: Side = door ? flip[sideOf(door, p)] : stairSides.length ? flip[stairSides[0]] : 'n';
      const far = [opposite, ...SIDES].find((side) => holesOn(p, side, 0).length === 0 && !stairSides.includes(side)) ?? opposite;
      const f = frameOf(p, far, 0);
      const u = f.length / 2;
      // The grand arrangement needs room in front of it; a small chamber gets the plain one.
      const room = far === 'n' || far === 's' ? dz : dx;
      const big = p.role === 'goal' && room >= 4.6;
      const half = Math.min(big ? 1.1 : 0.7, f.length / 2 - 0.6);
      let y = p.floor;
      if (big) {
        const plinth = wallBox(f, u - half - 0.5, u + half + 0.5, y - 0.02, y + STEP, -0.5, -2.3);
        kit.box('floor', plinth.min, plinth.max, { ...hallFlag, course: [STEP + 0.02, STEP + 0.02], length: [0.8, 1.3] }, hallFlag, 'step');
        y += STEP;
      }
      const near = big ? 0.95 : 0.35, deep = big ? 0.9 : 0.65;
      const body = wallBox(f, u - half, u + half, y, y + (big ? 0.85 : 0.6), -near, -(near + deep));
      kit.box('stone', body.min, body.max, { ...dressed, length: [0.7, 1.1], course: [0.4, 0.45] });
      const lid = wallBox(f, u - half - 0.1, u + half + 0.1, body.max.y, body.max.y + 0.17, -(near - 0.1), -(near + deep + 0.1));
      kit.box('stone', lid.min, lid.max, { ...coping, length: [1.1, 1.3], course: [0.17, 0.17] }, { ...coping, length: [2.4, 2.4], course: [1.2, 1.2] }, 'lid');
      anchors.set(p.id, V((lid.min.x + lid.max.x) / 2, lid.max.y, (lid.min.z + lid.max.z) / 2));
    } else if (site.items.some((it) => it.place === p.id)) {
      // Something is kept here and there is no chest: a pedestal in the middle of the floor.
      kit.box('stone', V(cx - 0.3, p.floor - 0.4, cz - 0.3), V(cx + 0.3, p.floor + 0.14, cz + 0.3), coping, coping, 'base');
      kit.box('stone', V(cx - 0.22, p.floor + 0.14, cz - 0.22), V(cx + 0.22, p.floor + 0.92, cz + 0.22), { ...dressed, length: [0.44, 0.44] }, coping, 'shaft');
      kit.box('stone', V(cx - 0.3, p.floor + 0.92, cz - 0.3), V(cx + 0.3, p.floor + 1.04, cz + 0.3), coping, coping, 'cap');
      anchors.set(p.id, V(cx, p.floor + 1.04, cz));
    }

    // Floor that must stay clear: in front of every doorway, and round whatever stands in the middle.
    const keepClear: Rect[] = [];
    const doorPoints: [number, number][] = [];
    for (const side of SIDES) {
      for (const h of holesOn(p, side, 0)) {
        if (h.way.kind === 'window') continue;
        doorPoints.push(side === 'n' ? [h.at, p.z0 + 0.7] : side === 's' ? [h.at, p.z1 - 0.7] : side === 'w' ? [p.x0 + 0.7, h.at] : [p.x1 - 0.7, h.at]);
        const reach = 1.5, half = h.w + 0.3;
        keepClear.push(side === 'n' ? { x0: h.at - half, x1: h.at + half, z0: p.z0, z1: p.z0 + reach }
          : side === 's' ? { x0: h.at - half, x1: h.at + half, z0: p.z1 - reach, z1: p.z1 }
          : side === 'w' ? { x0: p.x0, x1: p.x0 + reach, z0: h.at - half, z1: h.at + half }
          : { x0: p.x1 - reach, x1: p.x1, z0: h.at - half, z1: h.at + half });
      }
    }
    for (const w of stairsFrom(p)) {
      // The flight itself, and the floor at its foot.
      const f = flightOf(w);
      keepClear.push(flightRect(w), strip(p, w.side, w.at - f.dir * 1.3, w.at, f.wide + 0.4));
      const foot = strip(p, w.side, w.at - f.dir * 0.9, w.at - f.dir * 0.5, f.wide);
      doorPoints.push([(foot.x0 + foot.x1) / 2, (foot.z0 + foot.z1) / 2]);
    }
    for (const w of stairsInto(p)) {
      // The well, with room to walk round it, and the floor at the head of the stair.
      const f = flightOf(w), r = wellRect(w);
      keepClear.push({ x0: r.x0 - 0.5, x1: r.x1 + 0.5, z0: r.z0 - 0.5, z1: r.z1 + 0.5 }, strip(p, w.side, f.to, f.to + f.dir * 1.3, f.wide + 0.4));
      const head = strip(p, w.side, f.to + f.dir * 0.4, f.to + f.dir * 0.8, f.wide);
      doorPoints.push([(head.x0 + head.x1) / 2, (head.z0 + head.z1) / 2]);
    }
    const anchor = anchors.get(p.id);
    const solids: Rect[] = [];
    if (anchor) {
      // The chest or pedestal: solid itself, with room kept round it to walk up to it.
      solids.push({ x0: anchor.x - 1.2, x1: anchor.x + 1.2, z0: anchor.z - 0.6, z1: anchor.z + 0.6 });
      keepClear.push({ x0: anchor.x - 1.5, x1: anchor.x + 1.5, z0: anchor.z - 1.5, z1: anchor.z + 1.5 });
    }
    for (const l of site.levers) if (l.place === p.id) keepClear.push({ x0: l.x - 0.9, x1: l.x + 0.9, z0: l.z - 0.9, z1: l.z + 0.9 });
    if (!open && !cave) {
      const furnisher = new Furnisher(kit, p, rng.fork(`furnish${p.id}`), keepClear, site.setting.condition === 'forsaken' ? 0.4 : 0, doorPoints, solids);
      furnisher.furnish();
      furnishing.push({ place: p.name, ...furnisher.tally });
    }
    if (p.fallen) {
      // What came down is still here: blocks of the vault, large and small, mostly towards the middle.
      const rubble = rng.fork(`rubble${p.id}`);
      for (let k = 0; k < 22; k++) {
        const sx = rubble.range(0.3, 0.75), sz = rubble.range(0.3, 0.6), sy = rubble.range(0.18, 0.42);
        const x = cx + (rubble.next() + rubble.next() - 1) * (dx / 2 - 0.8), z = cz + (rubble.next() + rubble.next() - 1) * (dz / 2 - 0.8);
        const r = { x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2 };
        if (keepClear.some((t) => r.x0 < t.x1 && r.x1 > t.x0 && r.z0 < t.z1 && r.z1 > t.z0)) continue;
        // A lane from every doorway to the middle of the room stays open, so the rubble can be
        // walked round and never rings anyone in.
        const lane = 0.62 + Math.max(sx, sz) / 2;
        if (doorPoints.some(([ax, az]) => {
          const ux = cx - ax, uz = cz - az, t = Math.min(1, Math.max(0, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz || 1)));
          return Math.hypot(x - ax - ux * t, z - az - uz * t) < lane;
        })) continue;
        kit.box('stone', V(r.x0, p.floor - 0.06, r.z0), V(r.x1, p.floor + sy, r.z1), { ...ashlar, length: [1, 1], course: [1, 1], chip: 0.6 }, undefined, `rubble${k}`);
        if (rubble.chance(0.35)) kit.box('stone', V(r.x0 + 0.08, p.floor + sy, r.z0 + 0.05), V(r.x1 - 0.12, p.floor + sy + sy * 0.8, r.z1 - 0.08), { ...ashlar, length: [1, 1], course: [1, 1], chip: 0.6 }, undefined, `rubble${k}b`);
        keepClear.push(r);
      }
    }

    // Ways are built once, from the side of their first place. A cleft in a cave is not built at all.
    for (const w of site.ways) {
      if (w.a !== p.id || w.natural || w.kind === 'stair') continue;
      const q = places[w.b];
      const f = frameOf(p, w.side, 0.1);
      const c = alongFrame(p, w.side, w.at, 0.1);
      const op: Opening = { c, w: w.halfWidth, ...shape(w) };
      const secret = w.door?.leaf === 'secret';
      kit.openingTrim('stone', f, op, T, dressed, secret ? (p.id === site.secret ? 'front' : 'back') : 'both');
      if (w.kind === 'window') {
        const sill = wallBox(f, c - w.halfWidth - 0.22, c + w.halfWidth + 0.22, op.y0 - 0.14, op.y0, -0.07, T + 0.07);
        kit.box('stone', sill.min, sill.max, coping, coping);
        continue;
      }
      const lo = Math.min(p.floor, q.floor), hi = Math.max(p.floor, q.floor);
      const sill = wallBox(f, c - w.halfWidth - 0.1, c + w.halfWidth + 0.1, lo, lo, 0.1, T - 0.1);
      kit.slab('floor', sill.min.x, sill.min.z, sill.max.x, sill.max.z, lo, { ...hallFlag, course: [0.7, 0.8], length: [0.9, 1.3] });
      // Stairs inside the thickness of the wall, rising towards the higher floor.
      const steps = Math.round((hi - lo) / STEP);
      const tread = (T - 0.2) / Math.max(1, steps);
      const stepStyle: MasonryStyle = { ...hallFlag, course: [STEP, STEP], length: [0.8, 1.3] };
      for (let k = 1; k <= steps; k++) {
        const lowIsHere = p.floor <= q.floor;
        const t0 = lowIsHere ? 0.1 + (k - 1) * tread : 0.1;
        const t1 = lowIsHere ? T - 0.1 : T - 0.1 - (k - 1) * tread;
        const b = wallBox(f, c - w.halfWidth - 0.05, c + w.halfWidth + 0.05, lo + STEP * (k - 1), lo + STEP * k, t0, t1);
        kit.box('floor', b.min, b.max, stepStyle, hallFlag, 'step');
      }
      // A door leaf, hung at the higher side so it stands on the top stair and swings away from the steps.
      // A secret door instead sits flush with the wall of the room it is hidden from, and swings away from it.
      if (w.door) {
        const publicIsHere = secret && p.id !== site.secret;
        const highIsHere = secret ? !publicIsHere : p.floor > q.floor;
        const thick = secret ? 0.1 : 0.07;
        const t = secret ? (publicIsHere ? thick / 2 - 0.004 : T - thick / 2 + 0.004) : highIsHere ? 0.2 : T - 0.2;
        const towardsHigh = highIsHere ? f.normal.clone() : f.normal.clone().negate();
        const lw = w.halfWidth - (secret ? 0.012 : 0.02);
        const hingeLow = rng.chance(0.5);
        const d = hingeLow ? f.dir.clone() : f.dir.clone().negate();
        const hinge = f.a.clone().addScaledVector(f.dir, hingeLow ? c - lw : c + lw).addScaledVector(f.normal, -t).setY(hi + 0.006);
        const yaw = Math.atan2(-d.z, d.x);
        const faces = Math.sign(Math.sin(yaw) * towardsHigh.x + Math.cos(yaw) * towardsHigh.z) || 1;
        const barred = w.door.barredFrom;
        const block = wallBox(f, c - w.halfWidth, c + w.halfWidth, hi - 0.3, hi + 3.2, t - 0.14, t + 0.14);
        // A door that starts shut is baked shut, so a locked room does not fill with its neighbour's light.
        if (w.door.leaf === 'shut' || secret) {
          const slab = wallBox(f, c - w.halfWidth - 0.05, c + w.halfWidth + 0.05, hi - 0.3, hi + 3.2, t - 0.03, t + 0.03);
          kit.mass(slab.min, slab.max);
        }
        const leafSeed = `${site.seed}/door${site.ways.indexOf(w)}`;
        doors.push({
          way: site.ways.indexOf(w), hinge, yaw, swing: -faces * 1.62, halfWidth: lw, spring: 2.0, thickness: thick,
          leaf: w.door.leaf === 'gate' ? null : buildDoorLeaf(leafSeed, lw, 2.0, thick, secret ? { ...ashlar, length: [0.4, 0.8], course: [0.27, 0.36] } : undefined),
          material: secret ? 'stone' : 'wood',
          blocker: block,
          centre: f.a.clone().addScaledVector(f.dir, c).addScaledVector(f.normal, -t).setY(hi + 1.2),
          barSide: barred === undefined ? 0 : (barred === (highIsHere ? p.id : q.id) ? faces : -faces),
        });
      }
    }
  }

  // ------------------------------------------------------------------ the outside of a house that stands free
  if (free) {
    const yard = places.find((q) => q.role === 'approach')!, low = yard.floor;
    const ox0 = Math.min(...outerRects.map((r) => r.x0)), ox1 = Math.max(...outerRects.map((r) => r.x1));
    // (Where the house front meets the forecourt it is built with the forecourt, and that stretch is left out here.)
    const fronted: [number, number] = [Math.max(yard.x0 - 0.2, ox0), Math.min(yard.x1 + 0.2, ox1)];
    const frameFor = (r: Run, a: number, b: number): Frame =>
      r.side === 'n' ? kit.frame(b, r.at, a, r.at) : r.side === 's' ? kit.frame(a, r.at, b, r.at) : r.side === 'w' ? kit.frame(r.at, a, r.at, b) : kit.frame(r.at, b, r.at, a);
    const alongRun = (r: Run, a: number, b: number, at: number) => (r.side === 'n' || r.side === 'e' ? b - at : at - a);
    const outward: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
    /** A box standing out from a run of wall: from `a` to `b` along it, `y0` to `y1` up, `out` beyond its face. */
    const ledge = (r: Run, a: number, b: number, y0: number, y1: number, out: number, style: MasonryStyle, tag: string) => {
      const [dx, dz] = outward[r.side], alongX = r.side === 'n' || r.side === 's';
      const p0 = alongX ? V(a, y0, r.at) : V(r.at, y0, a), p1 = alongX ? V(b, y1, r.at + dz * out) : V(r.at + dx * out, y1, b);
      kit.box('stone', V(Math.min(p0.x, p1.x), y0, Math.min(p0.z, p1.z)), V(Math.max(p0.x, p1.x), y1, Math.max(p0.z, p1.z)), style, style, tag);
    };
    kit.field = outdoorFieldAt(low, 1.0);
    for (const r of runs) {
      const pieces: [number, number][] = r.side === 's' && Math.abs(r.at - yard.z0) < 0.05
        ? [[r.from, Math.min(r.to, fronted[0])], [Math.max(r.from, fronted[1]), r.to]].filter(([a, b]) => b - a > 0.05) as [number, number][]
        : [[r.from, r.to]];
      // Which room's wall this is, for its windows and for what it is baked with.
      const owners = places.filter((q) => q.role !== 'approach' && (q.level ?? 0) >= 0 && (r.side === 'n' ? Math.abs(q.z0 - T - r.at) < 0.05 : r.side === 's' ? Math.abs(q.z1 + T - r.at) < 0.05 : r.side === 'w' ? Math.abs(q.x0 - T - r.at) < 0.05 : Math.abs(q.x1 + T - r.at) < 0.05));
      for (const [a, b] of pieces) {
        const mid = (a + b) / 2, owner = owners.find((q) => (r.side === 'n' || r.side === 's' ? q.x0 - T <= mid && q.x1 + T >= mid : q.z0 - T <= mid && q.z1 + T >= mid));
        kit.group = `p${(owner ?? yard).id}`;
        const holes: Opening[] = [];
        for (const q of owners) for (const w of outerWindows.get(q.id) ?? []) if (w.side === r.side && w.at > a + 0.3 && w.at < b - 0.3) holes.push({ c: alongRun(r, a, b, w.at), w: w.halfWidth, ...shape(w) });
        kit.wallFace('stone', frameFor(r, a, b), low - 0.7, site.top, ashlar, { openings: holes });
        // A plinth along its foot, a band at the height of the rooms' floors upstairs, and a cornice under the roof.
        ledge(r, a, b, low - 0.4, low + 0.42, 0.14, coping, 'plinth');
        ledge(r, a, b, site.top - 0.34, site.top + 0.12, 0.24, coping, 'cornice');
      }
    }
    // The windows dressed through the thickness of the wall, each with a sill.
    for (const [id, list] of outerWindows) for (const w of list) {
      const q = places[id], f = frameOf(q, w.side, 0.1), c = alongFrame(q, w.side, w.at, 0.1), op: Opening = { c, w: w.halfWidth, ...shape(w) };
      kit.group = `p${id}`;
      kit.openingTrim('stone', f, op, T, dressed, 'both');
      const sill = wallBox(f, c - w.halfWidth - 0.2, c + w.halfWidth + 0.2, op.y0 - 0.13, op.y0, -0.06, T + 0.12);
      kit.box('stone', sill.min, sill.max, coping, coping);
    }
    // Roofs: one over each room that is not open to the sky, hipped, of tiles, from the cornice to a ridge along the room's length,
    // with ridge tiles along the top. The sanctum's is steeper and higher, and gabled, with a bell-cote on one gable.
    const tiles = kit.mesh('tile'), roofTone: [number, number, number] = site.setting.condition === 'forsaken' ? [0.82, 0.78, 0.74] : [1.12, 1.05, 1.0];
    kit.group = 'roofs';
    const ridgeOf = new Map<number, { y: number; alongX: boolean; a: number; b: number; c: number }>();
    for (const q of places) {
      if (q.role === 'approach' || (q.level ?? 0) !== 0 || q.roof === 'sky' || q.fallen) continue;
      const sanctum = q.role === 'goal', pitch = sanctum ? 1.05 : 0.62;
      const e = T / 2 + 0.34, x0 = q.x0 - e, x1 = q.x1 + e, z0 = q.z0 - e, z1 = q.z1 + e, y = site.top + 0.12;
      const alongX = x1 - x0 >= z1 - z0, half = (alongX ? z1 - z0 : x1 - x0) / 2, rise = half * pitch, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const tone: [number, number, number] = [roofTone[0] * (0.94 + 0.12 * ((q.id * 7919) % 11) / 11), roofTone[1] * 0.98, roofTone[2] * 0.97];
      // (A gabled roof runs its ridge the whole length; a hipped one stops half its breadth from each end.)
      const inset = sanctum ? 0 : half;
      const r0 = alongX ? V(x0 + inset, y + rise, cz) : V(cx, y + rise, z0 + inset), r1 = alongX ? V(x1 - inset, y + rise, cz) : V(cx, y + rise, z1 - inset);
      const a = V(x0, y, z0), b = V(x1, y, z0), c = V(x1, y, z1), d = V(x0, y, z1), inside = V(cx, y + rise * 0.3, cz);
      if (alongX) { tileFace(tiles, [a, b, r1, r0], tone, inside); tileFace(tiles, [c, d, r0, r1], tone, inside); if (!sanctum) { tileFace(tiles, [b, c, r1], tone, inside); tileFace(tiles, [d, a, r0], tone, inside); } }
      else { tileFace(tiles, [b, c, r1, r0], tone, inside); tileFace(tiles, [d, a, r0, r1], tone, inside); if (!sanctum) { tileFace(tiles, [a, b, r0], tone, inside); tileFace(tiles, [c, d, r1], tone, inside); } }
      tileFace(tiles, [a, b, c, d], tone, V(cx, y + 1, cz));
      // (The roof stands a hand above the tops of the walls, which the cornice hides where there is one; where there is none, the slot
      // between could be looked into and through, to the sky beyond. A plate under the roof, lying on the walls, fills it.)
      kit.box('stone', V(x0, site.top - 0.02, z0), V(x1, y, z1), coping, coping, 'plate');
      kit.box('tile', alongX ? V(r0.x - 0.05, y + rise - 0.06, cz - 0.13) : V(cx - 0.13, y + rise - 0.06, r0.z - 0.05), alongX ? V(r1.x + 0.05, y + rise + 0.1, cz + 0.13) : V(cx + 0.13, y + rise + 0.1, r1.z + 0.05), coping, coping, 'ridge');
      ridgeOf.set(q.id, { y: y + rise, alongX, a: alongX ? r0.x : r0.z, b: alongX ? r1.x : r1.z, c: alongX ? cz : cx });
      if (sanctum) {
        // The gables: walls of ashlar up under the roof, in courses that step in as the roof narrows; and a bell-cote on the one nearer the front.
        for (const end of [0, 1]) {
          const at = alongX ? (end ? x1 - 0.3 : x0 + 0.3) : (end ? z1 - 0.3 : z0 + 0.3), courses = Math.max(3, Math.round(rise / 0.5));
          for (let k = 0; k < courses; k++) {
            const w = half * (1 - (k + 0.5) / courses) + 0.12, y0 = y - 0.12 + (rise * k) / courses, y1 = y - 0.12 + (rise * (k + 1)) / courses;
            if (alongX) kit.box('stone', V(at - 0.3, y0, cz - w), V(at + 0.3, y1, cz + w), ashlar, coping, 'gable'); else kit.box('stone', V(cx - w, y0, at - 0.3), V(cx + w, y1, at + 0.3), ashlar, coping, 'gable');
          }
        }
        const front = alongX ? (Math.abs(x1 - yard.z0) < Math.abs(x0 - yard.z0) ? x1 : x0) : (z1 > z0 ? z1 - 0.3 : z0 + 0.3), top = y + rise + 0.05;
        const bx = alongX ? front + (front > cx ? -0.3 : 0.3) : cx, bz = alongX ? cz : front;
        for (const off of [-0.55, 0.55]) {
          const px = alongX ? bx : bx + off, pz = alongX ? bz + off : bz;
          kit.box('stone', V(px - 0.17, top, pz - 0.17), V(px + 0.17, top + 1.25, pz + 0.17), dressed, coping, 'belfry');
        }
        kit.box('stone', V(bx - 0.8, top + 1.25, bz - 0.8), V(bx + 0.8, top + 1.42, bz + 0.8), coping, coping, 'belfrycap');
        kit.box('stone', V(bx - 0.5, top + 1.42, bz - 0.5), V(bx + 0.5, top + 1.75, bz + 0.5), coping, coping, 'belfrytop');
        kit.box('metal', V(bx - 0.2, top + 0.55, bz - 0.2), V(bx + 0.2, top + 1.05, bz + 0.2), coping, coping, 'bell');
      }
    }
    // Chimneys: on the kitchen and the refectory, rising through the roof beside the ridge, with a capping on top.
    for (const q of places) {
      const rg = ridgeOf.get(q.id);
      if (!rg || !['kitchen', 'refectory', 'warming house'].includes(q.name)) continue;
      const along = rg.a + (rg.b - rg.a) * 0.7 + (rg.b - rg.a < 0.5 ? 0 : 0), across = rg.c + 0.55;
      const x = rg.alongX ? along : across, z = rg.alongX ? across : along;
      kit.group = `p${q.id}`;
      kit.box('stone', V(x - 0.46, site.top - 0.2, z - 0.46), V(x + 0.46, rg.y + 1.35, z + 0.46), ashlar, coping, 'chimney');
      kit.box('stone', V(x - 0.56, rg.y + 1.35, z - 0.56), V(x + 0.56, rg.y + 1.52, z + 0.56), coping, coping, 'chimneycap');
    }
    // Buttresses against the outside of every vaulted room, where the ribs of its vault come down within, to take their thrust;
    // in two stages, each with a sloping coping; and a clasping buttress round every outer corner.
    const buttress = (r: Run, at: number) => {
      const mid = low + (site.top - low) * 0.55;
      ledge(r, at - 0.38, at + 0.38, low - 0.4, mid, 0.9, ashlar, 'buttress');
      ledge(r, at - 0.44, at + 0.44, mid, mid + 0.16, 0.98, coping, 'weathering');
      ledge(r, at - 0.34, at + 0.34, mid + 0.16, site.top - 0.55, 0.5, ashlar, 'buttress');
      ledge(r, at - 0.4, at + 0.4, site.top - 0.55, site.top - 0.39, 0.58, coping, 'weathering');
    };
    kit.field = outdoorFieldAt(low, 1.0);
    const placed: { side: Side; at: number; pos: number }[] = [];
    const clearOfWindows = (side: Side, at: number, pos: number) => !places.some((q) => (outerWindows.get(q.id) ?? []).some((w) => w.side === side && Math.abs(w.at - pos) < w.halfWidth + 0.55 && Math.abs((side === 'n' ? q.z0 - T : side === 's' ? q.z1 + T : side === 'w' ? q.x0 - T : q.x1 + T) - at) < 0.05));
    for (const q of places) {
      if (q.role === 'approach' || (q.level ?? 0) !== 0) continue;
      kit.group = `p${q.id}`;
      for (const sl of pilasterSlots.get(q.id) ?? []) {
        const face = sl.side === 'n' ? q.z0 - T : sl.side === 's' ? q.z1 + T : sl.side === 'w' ? q.x0 - T : q.x1 + T;
        const r = runs.find((u) => u.side === sl.side && Math.abs(u.at - face) < 0.05 && sl.pos > u.from + 0.6 && sl.pos < u.to - 0.6);
        if (!r || (outerWindows.get(q.id) ?? []).some((w) => w.side === sl.side && Math.abs(w.at - sl.pos) < w.halfWidth + 0.55)) continue;
        if (r.side === 's' && Math.abs(r.at - yard.z0) < 0.05 && sl.pos > fronted[0] - 0.5 && sl.pos < fronted[1] + 0.5) continue;
        buttress(r, sl.pos);
        placed.push({ side: r.side, at: r.at, pos: sl.pos });
      }
    }
    // And along any long stretch of wall, evenly, a buttress every four or five metres wherever there is no window: a long wall
    // with nothing on it is the one thing that most makes a building look unfinished. A string course runs round at the height of a storey.
    for (const r of runs) {
      const pieces: [number, number][] = r.side === 's' && Math.abs(r.at - yard.z0) < 0.05
        ? ([[r.from, Math.min(r.to, fronted[0])], [Math.max(r.from, fronted[1]), r.to]] as [number, number][]).filter(([a, b]) => b - a > 0.05)
        : [[r.from, r.to]];
      for (const [a, b] of pieces) {
        kit.group = 'roofs';
        ledge(r, a, b, low + 3.55, low + 3.75, 0.12, coping, 'stringcourse');
        if (b - a < 5) continue;
        const n = Math.round((b - a) / 4.5);
        for (let k = 1; k < n; k++) {
          const pos = a + ((b - a) * k) / n;
          if (placed.some((q) => q.side === r.side && Math.abs(q.at - r.at) < 0.05 && Math.abs(q.pos - pos) < 1.6) || !clearOfWindows(r.side, r.at, pos)) continue;
          buttress(r, pos);
          placed.push({ side: r.side, at: r.at, pos });
        }
      }
    }
    for (const r of runs) for (const end of [r.from, r.to]) {
      const dir = end === r.from ? -1 : 1, [ox, oz] = outward[r.side], along = r.side === 'n' || r.side === 's';
      // (A point just past the end of the run and just inside the wall: if that is outside the house, the corner is an outer one.)
      const px = along ? end + dir * 0.2 : r.at - ox * 0.2, pz = along ? r.at - oz * 0.2 : end + dir * 0.2;
      if (insideOuter(px, pz)) continue;
      kit.group = 'roofs';
      ledge(r, dir < 0 ? end : end - 0.95, dir < 0 ? end + 0.95 : end, low - 0.4, site.top - 0.75, 0.42, ashlar, 'corner');
      ledge(r, dir < 0 ? end : end - 1.05, dir < 0 ? end + 1.05 : end, site.top - 0.75, site.top - 0.6, 0.5, coping, 'cornercap');
    }
    // The entrance: the bay of the front with the door in it stands forward, its door dressed through the depth it stands out,
    // and rises over the cornice in a gable of stepped courses.
    {
      const door = holesOn(yard, 'n', 0)[0];
      if (door) {
        const half = door.w + 1.5, x0 = door.at - half, x1 = door.at + half, zf = yard.z0 + 0.6, top = site.top + 0.9;
        kit.group = `p${yard.id}`;
        const f = kit.frame(x0, zf, x1, zf), op: Opening = { c: door.at - x0, w: door.w, y0: door.y0, ys: door.ys };
        kit.wallFace('stone', f, low - 0.7, top, ashlar, { openings: [op] });
        kit.openingTrim('stone', f, op, 0.6, dressed, 'front');
        for (const [a, b] of [[x0 - 0.02, x0 + 0.45], [x1 - 0.45, x1 + 0.02]]) kit.box('stone', V(a, low - 0.5, yard.z0), V(b, top, zf), ashlar, coping, 'porchside');
        kit.box('stone', V(x0 - 0.1, top - 0.02, yard.z0 - 0.3), V(x1 + 0.1, top + 0.16, zf + 0.12), coping, coping, 'porchcope');
        for (let k = 0; k < 4; k++) {
          const inset = (k + 1) * half * 0.2;
          kit.box('stone', V(x0 + inset, top + 0.16 + k * 0.5, yard.z0 - 0.3), V(x1 - inset, top + 0.16 + (k + 1) * 0.5, zf), ashlar, coping, 'porchgable');
        }
      }
    }
  }

  // ------------------------------------------------------------------ result
  const min = V(Infinity, -3, Infinity), max = V(-Infinity, site.top + 2, -Infinity);
  for (const p of places) {
    min.x = Math.min(min.x, p.x0 - 3); min.z = Math.min(min.z, p.z0 - 3);
    max.x = Math.max(max.x, p.x1 + 3); max.z = Math.max(max.z, p.z1 + 3);
  }
  if (site.grounds) {
    min.x = Math.min(min.x, site.grounds.x0 - 2); max.x = Math.max(max.x, site.grounds.x1 + 2); max.z = Math.max(max.z, site.grounds.z1 + 2);
  }
  const approach = places.find((p) => p.role === 'approach') ?? places[site.entrance];
  return {
    meshes: kit.meshes,
    masses: kit.masses,
    torches: [...[...torchesByPlace.values()].flat(), ...hallTorches],
    unders,
    ...(backWay?.cavern ? { lowest: backWay.cavern.floor } : {}),
    ...(underDeep ? { underDeep } : {}),
    ...(groundLow < Infinity ? { groundLow } : {}),
    smokes,
    sunShafts,
    landmarks: landmarkSpots,
    sunDir: V(site.sun[0], site.sun[1], site.sun[2]),
    spawn: { position: arrival.spawn ?? V(site.ways.find((w) => w.b === approach.id || w.a === approach.id)?.at ?? (approach.x0 + approach.x1) / 2, approach.floor + 1.75, approach.z1 - 6.2), yaw: spawnYaw },
    track: arrival.track,
    bounds: { min, max },
    blocks: kit.blocks,
    title: site.title,
    sun: { colour: sky.colour, intensity: sky.intensity, sky: { zenith: sky.zenith, horizon: sky.horizon, ground: sky.ground }, disc: sky.disc, night: sky.night, eyes: sky.eyes, cloud: site.setting.cloud, layered: site.setting.cloudForm === 'layered', mist: site.setting.mist, haze: site.setting.haze, floor: site.island ? site.island.sea + 1.5 : site.mountain ? site.mountain.deck : approach.floor },
    doors,
    anchors,
    furnishing,
    glows,
    scenery,
    planted: censuses[0],
    fences,
    water: waters,
    streams: flows,
    falls,
    crossings,
    lookouts,
    far: farCover,
    sea: islandSea,
    ...(rockSharp !== undefined ? { rockSharp } : {}),
    ...(cloudDeck ? { deck: cloudDeck, snow: site.setting.season === 'winter' ? 1 : 0.24, snowLine: [approach.floor + 22, site.setting.season === 'winter' ? 0 : 0.4] as [number, number] } : {}),
    birds: birdSpots,
    flocks: flockSpots,
    beacon,
    finds,
  };
}
