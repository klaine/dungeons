import { Vector3 } from 'three';
import { fbm2, Rng } from '../core/rng';
import { Furnisher, Rect } from './furnish';
import { Place, Side, Site, SKIES, Way } from '../core/site';
import { buildDoorLeaf } from './doorLeaf';
import { indoorField, outdoorFieldAt } from './fields';
import { Frame, Kit, Opening } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { carveRock, smin } from './geom/rock';
import { beam, plank, stoneStyles } from './geom/styles';
import { layMountains, layTerrain, turfColour } from './landscape';
import { MeshBuilder } from './geom/meshBuilder';
import { Colour, layTrunk, Planting } from './planting';
import { CardSet, DoorDesc, SceneDescription, TorchSpec } from './scene';

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

export function meshSite(site: Site): SceneDescription {
  const kit = new Kit(site.seed);
  const rng = new Rng(site.seed).fork('mesh');
  const T = site.wallThickness;
  const places = site.places;
  const { ashlar, dressed, vaultStone, flag, hallFlag, coping, tint: stoneTint } = stoneStyles(site.setting.stone);
  const sky = SKIES[site.setting.hour];

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
    if (w.kind === 'window') return { y0: hi + 1.55, ys: hi + 2.35 };
    return { y0: lo - 0.1, ys: hi + (w.kind === 'arch' ? 1.9 : 2.0) };
  };
  // A secret door shows no dressed stone on the side it is hidden from: the wall runs up to it.
  const hiddenFrom = (w: Way, p: Place) => w.door?.leaf === 'secret' && p.id !== site.secret;
  const holesOn = (p: Place, side: Side, e: number): Hole[] =>
    site.ways.filter((w) => (w.a === p.id || w.b === p.id) && sideOf(w, p) === side)
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
      const want = p.light === 'torch' ? (area < 22 ? 1 : area < 50 ? 2 : 3) : p.light === 'day' && area >= 40 ? 1 : 0;
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
  const buildApproach = (p: Place) => {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const doorway = holesOn(p, 'n', 0)[0];
    const doorX = doorway ? doorway.at : (p.x0 + p.x1) / 2;
    const front = kit.frame(p.x0 - 0.2, p.z0, p.x1 + 0.2, p.z0);
    kit.wallFace('stone', front, p.floor - 0.7, site.top, ashlar, { openings: holesOn(p, 'n', 0).map((h) => ({ ...h, c: h.at - (p.x0 - 0.2) })) });

    const r = rng.fork('approach');
    const plant = rng.fork('planting');
    const s1 = r.range(0, 60), s2 = r.range(0, 60);
    const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
    // The open country that can be walked: the meadow before the door and the valley round it.
    const g = site.grounds ?? { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 };
    const cxA = (p.x0 + p.x1) / 2, czA = (p.z0 + p.z1) / 2;
    const houseZ0 = Math.min(...house.map((q) => q.z0)) - T;
    const frontZ = p.z0 - 0.35;
    const pathHalf = 1.15;
    // The way in: flags from the door across the meadow, then a worn track that wanders off down the valley.
    const pathAt = (z: number) => doorX + Math.sin(z * 0.23 + s1) * 0.6 * Math.min(1, Math.max(0, z - p.z0) / 5) + Math.sin(z * 0.06 + s2) * 5 * smooth((z - p.z1 + 4) / 26);
    /**
     * The height of the ground anywhere. One function serves the carved meadow and the sheets laid
     * beyond it, so they meet. It is made of: gentle swells, level by the path and the door; the
     * escarpment the house is built into, a cliff beside the house and a hillside behind; a rim
     * of rock round the valley, too steep to climb; and beyond that, hills.
     */
    const escarpment = (x: number, z: number, wobble: number): number => {
      if (z < frontZ) return 1;
      const beside = Math.max(smooth((p.x0 + 2 + wobble * 0.5 - x) / 1.3), smooth((x - (p.x1 - 2 - wobble * 0.5)) / 1.3));
      return beside * (1 - smooth((z - p.z0 - 0.3 - Math.max(0, wobble)) / 3.4));
    };
    const wobbleAt = (x: number, z: number) => (fbm2(x * 0.3 + s2 + 20, z * 0.3 + s1, 3) - 0.5) * 3.2;
    const ground = (x: number, z: number): number => {
      const fromPath = Math.max(0, Math.abs(x - pathAt(z)) - pathHalf);
      const rough = Math.min(1, fromPath / 2.5) * Math.min(1, Math.max(0, z - p.z0) / 2.5);
      let y = p.floor - 0.03
        + (fbm2(x * 0.035 + s2, z * 0.035 + s1, 3) - 0.5) * 5.5 * Math.min(1, fromPath / 9) * smooth((z - p.z0 - 4) / 14)
        + (fbm2(x * 0.22 + s1, z * 0.22 + s2, 3) - 0.5) * 1.1 * rough + (fbm2(x * 0.9 + s2, z * 0.9 + s1, 2) - 0.5) * 0.16 * rough;
      const wobble = wobbleAt(x, z);
      // The hillside is level with the roofline over the house and rises behind it; beside the
      // house it starts to rise at once.
      const clearOfHouse = smooth(Math.max(0, houseX0 - x, x - houseX1) / 8);
      const riseFrom = houseZ0 + (frontZ - houseZ0) * clearOfHouse;
      const crest = site.top - 0.15 + Math.min(18, Math.max(0, riseFrom - z) * 0.55);
      if (crest > y) y += (crest - y) * escarpment(x, z, wobble);
      const inside = Math.min(x - g.x0, g.x1 - x, g.z1 - z);
      y += (6.5 + 7 * fbm2(x * 0.03 + s1, z * 0.03 - s2, 2)) * (1 - smooth((inside - 2 + wobble) / 3.6));
      const beyond = Math.max(0, -inside);
      return y + smooth((beyond - 10) / 190) * 30 + (fbm2(x * 0.011 + s1, z * 0.011 + s2, 4) - 0.5) * 22 * smooth(beyond / 60);
    };
    const slopeOf = (f: (x: number, z: number) => number, x: number, z: number, e: number) => Math.hypot(f(x + e, z) - f(x - e, z), f(x, z + e) - f(x, z - e)) / (2 * e);
    // Weathered rock in the open is greyer than the same stone freshly cut for the house.
    const outcrop: Colour = [0.5 + 0.5 * stoneTint[0], 0.52 + 0.5 * stoneTint[1], 0.56 + 0.5 * stoneTint[2]];
    const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
    // Earth shows through along the track, where feet have worn the grass away.
    const worn = (x: number, z: number) => (z < p.z1 - 6 ? 0 : 1 - smooth((Math.abs(x - pathAt(z)) - 0.5) / 1.1)) * smooth((z - p.z1 + 6) / 3);
    const turfAt = (x: number, z: number): Colour => {
      const c = turfColour(x, z, s1), w = worn(x, z) * (0.75 + 0.25 * fbm2(x * 1.3, z * 1.3 + s1, 2));
      return [c[0] + (2.5 - c[0]) * w, c[1] + (0.95 - c[1]) * w, c[2] + (0.5 - c[2]) * w];
    };
    const cliff = site.top - p.floor + 0.5;
    const turf = kit.mesh('turf');
    carveRock(kit.mesh('rock'), (x, y, z) => {
      // The cliff is broken: beds that step back as they rise, and clefts down them. The breaking
      // dies away at the edge of what is carved, where this surface must meet the sheet beyond.
      const rocky = escarpment(x, z, wobbleAt(x, z)) * Math.min(1, Math.max(0, (y - p.floor - 0.4) / 1.2)) * smooth(Math.min(x - p.x0, p.x1 - x) / 1.4 + 0.15);
      if (rocky <= 0) return y - ground(x, z);
      const bed = Math.abs(((y * 0.95 + fbm2(x * 0.12 + s1, z * 0.12 + s2, 2) * 2.2) % 1) - 0.5) - 0.25;
      const cleft = Math.abs(fbm2(x * 0.75 + s2, z * 0.75 + y * 0.25 + s1, 3) - 0.5) - 0.12;
      const lump = (fbm2(x * 0.45 + y * 0.5 + s2, z * 0.45 - y * 0.4 + s1, 3) - 0.5) * 1.5;
      return y - ground(x, z) + ((fbm2(x * 1.4 + y * 0.9 + s1, z * 1.4 - y * 0.7 + s2, 2) - 0.5) * 0.5 + lump + bed * 1.5 + Math.min(0.2, cleft) * 2.6) * rocky;
    }, {
      min: V(p.x0 - 0.3, p.floor - 3.4, p.z0 - 0.14), max: V(p.x1 + 0.3, p.floor + cliff + 1.4, p.z1 + 0.3),
      cell: 0.42, uvScale: 0.4, otherUvScale: 2.3,
      meshFor: (n) => (n.y > 0.74 ? turf : null),
      shade: (q, n, field, face) => {
        // Asked of the triangle, not the corner: a rock face with one level corner is still rock.
        if (face.y > 0.74) return turfAt(q.x, q.z);
        const bed = fbm2((q.y + q.x * 0.2) * 1.8, q.z * 0.2 + s1, 3);
        const tone = 0.62 + 0.4 * bed + 0.2 * fbm2(q.x * 0.8 + s2, q.z * 0.8 + q.y, 3);
        field[0] = Math.max(0, n.y) * 0.9;
        return rockColour(tone);
      },
    });
    // The rim of the valley is too steep to climb, but nobody is to leave by it whatever they find.
    fences.push(
      { min: V(g.x0 - 3, p.floor - 6, g.z0 - 3), max: V(g.x0 - 1.2, p.floor + 80, g.z1 + 3) },
      { min: V(g.x1 + 1.2, p.floor - 6, g.z0 - 3), max: V(g.x1 + 3, p.floor + 80, g.z1 + 3) },
      { min: V(g.x0 - 3, p.floor - 6, g.z1 + 1.2), max: V(g.x1 + 3, p.floor + 80, g.z1 + 3) },
      { min: V(g.x0 - 3, p.floor - 6, p.z0 - 2.6), max: V(p.x0 - 0.2, p.floor + 80, p.z0 - 1.2) },
      { min: V(p.x1 + 0.2, p.floor - 6, p.z0 - 2.6), max: V(g.x1 + 3, p.floor + 80, p.z0 - 1.2) },
    );
    // Solid rock beside the house, and under the meadow.
    kit.mass(V(p.x0 - 30, p.floor - 2, houseZ0), V(p.x0 - 0.3, p.floor + cliff - 1.2, p.z0 + 0.8));
    kit.mass(V(p.x1 + 0.3, p.floor - 2, houseZ0), V(p.x1 + 30, p.floor + cliff - 1.2, p.z0 + 0.8));
    kit.mass(V(p.x0 - 3, p.floor - 5, p.z0), V(p.x1 + 3, p.floor - 3.2, p.z1 + 3));

    // The path: flags laid in a strip from the door, following the same gentle wander.
    for (let z = p.z0 + 0.05; z < p.z1 - 5.5; z += 1.5) {
      const mid = pathAt(z + 0.75);
      kit.slab('floor', mid - pathHalf, z, mid + pathHalf, z + 1.5, p.floor + 0.012, { ...flag, course: [0.6, 0.8], length: [0.7, 1.2] });
    }

    // Boulders: lumps of the same rock, lying where they came to rest. Mossed on top. Those in
    // the meadow are baked with it; those out in the valley are part of the scenery.
    const sceneryMesh = (material: string) => {
      let m = scenery.meshes.get(material);
      if (!m) scenery.meshes.set(material, (m = new MeshBuilder()));
      return m;
    };
    const stones: [number, number, number][] = [];
    const boulder = (mesh: MeshBuilder, x: number, z: number, size: number, q: Rng) => {
      const base = ground(x, z), ts = q.range(0, 60), sx = q.range(0.8, 1.3), sz = q.range(0.8, 1.3), sy = q.range(0.55, 0.8);
      carveRock(mesh, (qx, qy, qz) => {
        const d = Math.hypot((qx - x) / sx, (qy - base - size * 0.2) / sy, (qz - z) / sz);
        return d - size + (fbm2(qx * 1.6 + qy * 1.1 + ts, qz * 1.6 - qy * 0.9 + ts, 3) - 0.5) * size * 0.75;
      }, {
        min: V(x - size * 1.9, base - 0.6, z - size * 1.9), max: V(x + size * 1.9, base + size * 1.6, z + size * 1.9),
        cell: Math.max(0.16, size * 0.2), uvScale: 0.5,
        shade: (c, n, field) => {
          field[0] = Math.max(0, n.y) * 1.0;
          return rockColour(0.6 + 0.5 * fbm2(c.x * 1.3 + ts, c.z * 1.3 + c.y, 3));
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
    const greens: Colour[] = [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
    const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
    const blossom: Colour = [0.85, 0.2, 0.38];
    const firs: Colour[] = [[0.045, 0.13, 0.04], [0.06, 0.15, 0.04], [0.04, 0.11, 0.05]];
    let planted = 0;
    for (let tries = 0; tries < 60 && planted < 5; tries++) {
      const x = r.range(p.x0 + 4.5, p.x1 - 4.5), z = r.range(p.z0 + 4, p.z1 - 3);
      if (Math.abs(x - pathAt(z)) < 3.6) continue;
      if (trees.some((t) => Math.hypot(t[0] - x, t[1] - z) < 5.5) || !clearOfStones(x, z, 1.2)) continue;
      const base = ground(x, z);
      const height = r.range(5.2, 7.6), girth = r.range(0.19, 0.28);
      kit.roundWall('wood', x, z, girth, base - 0.3, base + height, { ...plank, course: [6, 6], length: [0.07, 0.13], tint: [0.34, 0.3, 0.27], tintVar: 0.3, proud: 0.012, bevel: 0.012 }, false, { open: { v0: true, v1: true } });
      kit.mass(V(x - girth * 0.6, base, z - girth * 0.6), V(x + girth * 0.6, base + height, z + girth * 0.6));
      planting.broadleaf(x, base, z, height + 0.4, r.range(2.3, 3.1), 620, leafOf(plant.pick(greens)), plant, 0.72);
      trees.push([x, z]);
      planted++;
    }

    // ---- the ground beyond the meadow: a fine sheet over the valley and its rim, a coarse one
    // out to the hills, and mountains behind them
    const snap = (v: number, up: boolean) => (up ? Math.ceil(v / 6) : Math.floor(v / 6)) * 6;
    const fine = { x0: snap(g.x0 - 34, false), x1: snap(g.x1 + 34, true), z0: snap(houseZ0 - 40, false), z1: snap(g.z1 + 34, true) };
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
    const terrain = { seed: s1, stone: stoneTint, turfScale: 2.3, rockScale: 0.4, colour: turfAt, rock: rockColour };
    layTerrain(sceneryMesh('turf'), sceneryMesh('rock'), eased, {
      ...terrain, area: fine, cell: 1.2,
      // Not over the meadow, which is carved, and not over the house. Corners that fall just
      // inside the meadow are drawn back to its edge, so the sheet meets it without lapping in.
      // Over the house it is the turf of the hill above the vaults, left open over every court.
      skip: (c) => overlaps(c, p.x0 + 1.3, p.x1 - 1.3, frontZ, p.z1 - 1.3) || (c.z0 < frontZ && c.z1 > frontZ && c.x1 > p.x0 - 0.3 && c.x0 < p.x1 + 0.3)
        || house.some((q) => q.roof === 'sky' && overlaps(c, q.x0 - T / 2 - 0.2, q.x1 + T / 2 + 0.2, q.z0 - T / 2 - 0.2, q.z1 + T / 2 + 0.2)),
      warp: (x, z) => {
        const w = x - (p.x0 - 0.25), e = p.x1 + 0.25 - x, s = p.z1 + 0.25 - z;
        if (w <= 0 || e <= 0 || s <= 0 || z < frontZ) return [x, z];
        const least = Math.min(w, e, s);
        return least === w ? [p.x0 - 0.25, z] : least === e ? [p.x1 + 0.25, z] : [x, p.z1 + 0.25];
      },
    });
    const reach = 246;
    layTerrain(sceneryMesh('turf'), sceneryMesh('rock'), ground, {
      ...terrain, area: { x0: snap(cxA - reach, false), x1: snap(cxA + reach, true), z0: snap(czA - reach, false), z1: snap(czA + reach, true) }, cell: 6,
      skip: (c) => c.x0 >= fine.x0 && c.x1 <= fine.x1 && c.z0 >= fine.z0 && c.z1 <= fine.z1,
    });
    layMountains(sceneryMesh('rock'), cxA, czA, p.floor + 30, s2);

    // ---- what lies and grows in the valley
    const inHouse = (x: number, z: number, m: number) => x > houseX0 - m && x < houseX1 + m && z > houseZ0 - m && z < frontZ + 0.4;
    const inMeadow = (x: number, z: number, m: number) => x > p.x0 - m && x < p.x1 + m && z > frontZ && z < p.z1 + m;
    const inGrounds = (x: number, z: number, m: number) => x > g.x0 + m && x < g.x1 - m && z > g.z0 && z < g.z1 - m;
    const offTrack = (x: number, z: number) => Math.abs(x - pathAt(z)) - pathHalf;
    // More boulders, some of them large, away from the track.
    for (let tries = 0; tries < 400 && stones.length < 44; tries++) {
      const x = plant.range(g.x0 + 6, g.x1 - 6), z = plant.range(g.z0 + 6, g.z1 - 6);
      const size = plant.chance(0.2) ? plant.range(1.3, 2.4) : plant.range(0.45, 1.2);
      if (inMeadow(x, z, size + 1) || offTrack(x, z) < 2.5 + size || !clearOfStones(x, z, size + 2) || slopeOf(ground, x, z, 0.6) > 0.5) continue;
      boulder(sceneryMesh('rock'), x, z, size, plant);
    }
    const grassColour = (x: number, z: number): Colour => {
      const c = turfColour(x, z, s1), t = plant.range(0.75, 1.2);
      // Mostly green; straw-coloured where the ground is dry, and in the odd tuft anywhere.
      const dry = Math.min(1, Math.max(0, (fbm2(x * 0.07 + s1 * 0.3, z * 0.07 - s1, 3) - 0.5) * 5) + (plant.chance(0.08) ? 0.8 : 0));
      return [(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t];
    };
    const flowerHues: Colour[] = [[0.25, 0.5, 1.5], [1.4, 0.4, 0.8], [1.3, 1.3, 1.2], [1.5, 1.1, 0.2]];
    const flowerAt = (x: number, z: number, y: number, size: number) => {
      if (fbm2(x * 0.13 + s1 * 3, z * 0.13 + s2, 2) < 0.64 || !plant.chance(0.45)) return;
      const hue = flowerHues[Math.floor(fbm2(x * 0.02 + s2, z * 0.02 - s1, 2) * 3.99) % 4];
      planting.tuft(planting.flowers, x, y - 0.02, z, size, size * plant.range(0.9, 1.3), plant.range(0, Math.PI), hue);
    };
    // Grass: thick in the meadow, a little coarser across the valley, thin by the path, long in
    // patches, and rough on the rim and just beyond it.
    const grass = (x0: number, x1: number, z0: number, z1: number, step: number, scale: number, keep: (x: number, z: number) => boolean) => {
      for (let gz = z0; gz < z1; gz += step) for (let gx = x0; gx < x1; gx += step) {
        const x = gx + plant.range(0, step), z = gz + plant.range(0, step);
        if (!keep(x, z)) continue;
        const off = offTrack(x, z);
        if (off < 0.12 || !plant.chance(0.3 + 0.7 * Math.min(1, off / 1.4))) continue;
        if (slopeOf(ground, x, z, 0.3) > 0.55 || !clearOfStones(x, z, -0.15)) continue;
        const long = Math.max(0, fbm2(x * 0.3 + s2, z * 0.3 + s1, 2) - 0.5) * 2.4;
        const w = plant.range(0.4, 0.7) * (1 + long * 0.5) * scale, h = plant.range(0.22, 0.42) * (1 + long * 1.7) * Math.sqrt(scale);
        const y = ground(x, z);
        planting.tuft(planting.grass, x, y - 0.05, z, w, h, plant.range(0, Math.PI), grassColour(x, z));
        if (plant.chance(0.12 * scale)) flowerAt(x, z, y, plant.range(0.3, 0.45) * Math.sqrt(scale));
      }
    };
    grass(p.x0 + 0.2, p.x1 - 0.2, p.z0 + 0.25, p.z1 - 0.2, 0.36, 1, () => true);
    grass(g.x0 - 2, g.x1 + 2, g.z0, g.z1 + 2, 0.56, 1.5, (x, z) => !inMeadow(x, z, -0.2) && !inHouse(x, z, 0.5));
    grass(g.x0 - 22, g.x1 + 22, g.z0 - 10, g.z1 + 22, 1.1, 2.4, (x, z) => !inGrounds(x, z, -2) && !inHouse(x, z, 0.5) && !(z < g.z0 && x > g.x0 && x < g.x1 && z > frontZ));
    // Bushes: by boulders and trees, and along the foot of the rock.
    for (let k = 0; k < 150; k++) {
      const x = plant.range(g.x0 + 3, g.x1 - 3), z = plant.range(g.z0 + 3, g.z1 - 3);
      if (offTrack(x, z) < 2.4 || slopeOf(ground, x, z, 0.4) > 0.6 || !clearOfStones(x, z, 0.1)) continue;
      const byRock = stones.some((q) => Math.hypot(q[0] - x, q[1] - z) < q[2] + 2.2) || Math.min(x - g.x0, g.x1 - x, g.z1 - z) < 8 || z - g.z0 < 6;
      if (!byRock && !plant.chance(0.25)) continue;
      const size = plant.range(0.6, 1.1);
      planting.crown(x, ground(x, z) + size * 0.5, z, size, size * 0.7, 46, size * 0.75, leafOf(plant.pick(greens)), plant);
    }
    // Woods. Trees thin out into glades, firs take the higher ground, and here and there a stand
    // is in blossom. In the valley the trunks are solid; the track and the meadow are kept clear.
    const wood = sceneryMesh('wood');
    const bark: Colour = [0.3, 0.26, 0.22];
    const tree = (x: number, z: number, y: number, detail: number) => {
      const lift = y - p.floor;
      const kind = fbm2(x * 0.018 + s1, z * 0.018 + s2, 2) + lift * 0.006;
      const inBlossom = fbm2(x * 0.03 - s2, z * 0.03 + s1 * 2, 2) > 0.7;
      if (kind > 0.56) {
        const height = plant.range(8, 14), radius = plant.range(1.9, 2.8);
        layTrunk(wood, x, y, z, height * 0.9, plant.range(0.16, 0.26), bark);
        planting.conifer(x, y, z, height, radius, Math.round(5 + 6 * detail), leafOf(plant.pick(firs)), plant);
      } else {
        const height = plant.range(5.5, 9.5), spread = plant.range(2.2, 3.4);
        layTrunk(wood, x, y, z, height * 0.8, plant.range(0.17, 0.3), bark, [plant.range(-0.4, 0.4), plant.range(-0.4, 0.4)]);
        planting.broadleaf(x, y, z, height, spread, Math.round(26 + 260 * detail), leafOf(inBlossom ? blossom : plant.pick(greens)), plant, 1.7 - 0.85 * detail);
      }
    };
    const woods = (area: { x0: number; x1: number; z0: number; z1: number }, step: number, f: (x: number, z: number) => number, skip: (x: number, z: number) => boolean) => {
      for (let gz = area.z0; gz < area.z1; gz += step) for (let gx = area.x0; gx < area.x1; gx += step) {
        const x = gx + plant.range(0.1, 0.9) * step, z = gz + plant.range(0.1, 0.9) * step;
        if (skip(x, z) || inHouse(x, z, 3) || inMeadow(x, z, 2.5)) continue;
        if (offTrack(x, z) < 3.2 || !clearOfStones(x, z, 0.8)) continue;
        if (fbm2(x * 0.03 + s2, z * 0.03 + s1, 3) < 0.46 || slopeOf(f, x, z, 1.5) > 0.75) continue;
        // Full detail anywhere the player can stand; less with distance beyond the rim.
        const out = Math.max(0, g.x0 - x, x - g.x1, z - g.z1, g.z0 - z);
        tree(x, z, f(x, z), Math.max(0, 1 - out / 50));
      }
    };
    const inFine = (x: number, z: number) => x > fine.x0 && x < fine.x1 && z > fine.z0 && z < fine.z1;
    woods(fine, 6.2, eased, () => false);
    woods({ x0: cxA - reach + 6, x1: cxA + reach - 6, z0: czA - reach + 6, z1: czA + reach - 6 }, 10, ground, inFine);

    // Where the player comes in: at the far end of the track, facing up the valley to the house.
    if (site.grounds) {
      const z = g.z1 - 11;
      arrival.spawn = V(pathAt(z), ground(pathAt(z), z) + 1.75, z);
      for (let w = z - 6; w > p.z1 - 2; w -= 6) arrival.track.push([pathAt(w), w]);
      arrival.track.push([pathAt(p.z1 - 4), p.z1 - 4]);
    }
    scenery.cards.push(...planting.sets);
  };
  const planting = new Planting();
  const arrival: { spawn: Vector3 | null; track: [number, number][] } = { spawn: null, track: [] };
  const fences: { min: Vector3; max: Vector3 }[] = [];
  const scenery: { meshes: Map<string, MeshBuilder>; cards: CardSet[] } = { meshes: new Map(), cards: [] };
  const trees: [number, number][] = [];

  for (const p of places) {
    if (p.role === 'approach') { buildApproach(p); continue; }
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
      kit.slab('floor', p.x0 - 0.1, p.z0 - 0.1, p.x1 + 0.1, p.z1 + 0.1, p.floor, open ? flag : hallFlag);
      kit.mass(V(p.x0, p.floor - 1.2, p.z0), V(p.x1, p.floor - 0.035, p.z1));
    }

    // Walls, and the solid behind them.
    for (const side of SIDES) {
      const top = wallTop(p, side);
      const f = frameOf(p, side, 0.1);
      const mid = f.length / 2;
      const R = span(p) / 2;
      const end = p.roof === 'barrel' && isEndWall(p, side);
      // A cave has masonry only where the builders walled it off to hang a door.
      if (!cave || holesOn(p, side, 0).length) {
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
      // Open air is an uneven dome over a rough oval floor, with a bay reaching each doorway.
      const doors = SIDES.flatMap((side) => holesOn(p, side, 0).map((h) => ({ side, at: h.at, w: h.w })));
      const doorPoint = (d: { side: Side; at: number }) => (d.side === 'n' ? [d.at, p.z0] : d.side === 's' ? [d.at, p.z1] : d.side === 'w' ? [p.x0, d.at] : [p.x1, d.at]);
      const walled = new Set(doors.map((d) => d.side));
      const rx = dx / 2 - 0.35, rz = dz / 2 - 0.35, rMin = Math.min(rx, rz);
      const s1 = rng.range(0, 50), s2 = rng.range(0, 50);
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
        for (const d of doors) {
          const [qx, qz] = doorPoint(d);
          const dd = Math.hypot(x - qx, z - qz);
          nearDoor = Math.min(nearDoor, dd);
          e = Math.max(e, d.w + 0.9 - dd);
        }
        return { e, nearDoor };
      };
      const density = (x: number, y: number, z: number): number => {
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
        return Math.min(air, edge - 0.2);
      };
      const wet = indoorField([], p.floor);
      carveRock(kit.mesh('rock'), density, {
        min: V(p.x0 - 0.14, p.floor - 0.6, p.z0 - 0.14), max: V(p.x1 + 0.14, p.floor + p.wall + 1.2, p.z1 + 0.14),
        cell: 0.28, uvScale: 0.45,
        shade: (q, n, field) => {
          wet(q, n, field);
          // Beds of slightly different stone, tilted; darker where water has stood.
          const bed = fbm2((q.y + q.x * 0.18) * 2.6, q.z * 0.15 + s1, 3);
          const blot = fbm2(q.x * 0.9 + s2, q.z * 0.9 + q.y * 0.7, 3);
          const tone = 0.72 + 0.4 * bed + 0.24 * blot;
          return [0.8 * tone * stoneTint[0], 0.74 * tone * stoneTint[1], 0.65 * tone * stoneTint[2]];
        },
      });
      kit.mass(V(p.x0 - T / 2, p.floor + p.wall + 1.25, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
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
      if (alongX) kit.plane('wood', V(p.x0 - 0.1, roofY, p.z0 - 0.1), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), dx + 0.2, dz + 0.2, plank);
      else kit.plane('wood', V(p.x0 - 0.1, roofY, p.z0 - 0.1), V(0, 0, 1), V(1, 0, 0), V(0, -1, 0), dz + 0.2, dx + 0.2, plank);
      const long = alongX ? dx : dz;
      const count = Math.max(2, Math.round(long / 1.05));
      for (let k = 0; k < count; k++) {
        const at = (alongX ? p.x0 : p.z0) + (long * (k + 0.5)) / count;
        if (alongX) kit.box('wood', V(at - 0.1, roofY - 0.27, p.z0 - 0.1), V(at + 0.1, roofY, p.z1 + 0.1), beam, beam, 'beam');
        else kit.box('wood', V(p.x0 - 0.1, roofY - 0.27, at - 0.1), V(p.x1 + 0.1, roofY, at + 0.1), beam, beam, 'beam');
      }
      kit.mass(V(p.x0 - T / 2, roofY + 0.08, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
    }

    // Furnishings by role.
    if (p.role === 'court' && !p.fallen) {
      const wx = cx + (dx > 6 ? rng.range(-0.8, 0.8) : 0), wz = cz + (dz > 6 ? rng.range(-0.8, 0.8) : 0);
      const y = p.floor;
      kit.roundWall('stone', wx, wz, 0.95, y - 0.1, y + 0.85, { ...ashlar, length: [0.45, 0.6] }, false, { open: { v1: true } });
      kit.roundWall('stone', wx, wz, 0.68, y - 2.5, y + 0.85, { ...ashlar, length: [0.35, 0.5] }, true, { open: { v1: true } });
      kit.ring('stone', wx, wz, 0.68, 0.95, y + 0.85, { ...dressed, length: [0.5, 0.65] });
    }
    if ((p.role === 'goal' || p.role === 'reward') && !cave) {
      // A stone chest against the wall opposite the way in; the goal's is larger and raised.
      const door = site.ways.find((w) => w.kind === 'door' && (w.a === p.id || w.b === p.id));
      // Against the wall opposite the way in, unless that wall has an opening of its own (a
      // secret door, say); then against whichever wall is blank.
      const opposite: Side = door ? flip[sideOf(door, p)] : 'n';
      const far = [opposite, ...SIDES].find((side) => holesOn(p, side, 0).length === 0) ?? opposite;
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

    // Ways are built once, from the side of their first place.
    for (const w of site.ways) {
      if (w.a !== p.id) continue;
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
    torches: [...torchesByPlace.values()].flat(),
    sunDir: V(site.sun[0], site.sun[1], site.sun[2]),
    spawn: { position: arrival.spawn ?? V(site.ways.find((w) => w.b === approach.id || w.a === approach.id)?.at ?? (approach.x0 + approach.x1) / 2, approach.floor + 1.75, approach.z1 - 6.2), yaw: 0 },
    track: arrival.track,
    bounds: { min, max },
    blocks: kit.blocks,
    title: site.title,
    sun: { colour: sky.colour, intensity: sky.intensity, sky: { zenith: sky.zenith, horizon: sky.horizon, ground: sky.ground } },
    doors,
    anchors,
    furnishing,
    scenery,
    fences,
  };
}
