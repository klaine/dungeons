import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../core/rng';
import { acrossWater, beachness, coastAt, inland, landAt, onStair } from '../core/island';
import { layWall } from './walls';
import { Place, Site } from '../core/site';
import { Kit } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { MeshBuilder } from './geom/meshBuilder';
import { alongSheet, carveRock } from './geom/rock';
import { boulderForm, cliffRelief, erode, Grid2, ROCK, Strata } from './geom/rockForms';
import { layTerrain, turfColour } from './landscape';
import { Colour, Planting } from './planting';
import { CardSet, SeaDesc } from './scene';
import { anyAngle, buildCoast } from './coast';
import { plantIsland } from './islandPlanting';

/**
 * The island, built from what the site document says of it: its land, worn and carved into sea
 * cliffs where the coast is high and laid as a beach where it comes down to the cove; the sea bed
 * running out under the water; the stacks off the headlands; the mainland across the water; and,
 * through `buildCoast` and `plantIsland`, what stands and grows on it. It is the counterpart of
 * the valley's approach in `siteMesher.ts`, and takes its place when the site is an island.
 *
 * The cliffs are made as the valley's are (see the note on the rock of the valley there): the
 * plain shape is given beds, worn by frost on a lattice of heights, and carved as a solid with
 * the beds stepped and split into blocks. What differs is the sea at their foot: below the high
 * water line the rock is dark and wet with weed, above it black with lichen in a band, and higher
 * up orange and grey lichens grow on it, as on any coast that faces weather.
 */

export interface IslandBuild {
  site: Site;
  /** The forecourt, which is the island's approach place. */
  p: Place;
  /** The kit for what is baked with the house, and the one for everything out on the island. */
  kit: Kit;
  wild: Kit;
  rng: Rng;
  planting: Planting;
  cards: CardSet[];
  fences: { min: Vector3; max: Vector3 }[];
  finds: { at: Vector3; what: string }[];
  /** The outer walls of the house, as rectangles: the ground comes up to them and goes no further. */
  outerRects: { x0: number; x1: number; z0: number; z1: number }[];
  stoneTint: Colour;
  flag: MasonryStyle;
}

export interface IslandResult {
  spawn: Vector3;
  yaw: number;
  track: [number, number][];
  far: { wood: [number, number, number]; grass: [number, number, number]; bare?: [number, number, number, number] };
  sea: SeaDesc;
  planted: Record<string, number>;
  /** Space under the cliff, out of doors: the sea cave, where no mist lies. */
  unders: { min: Vector3; max: Vector3 }[];
  birds: { x: number; y: number; z: number }[];
  flocks: { x: number; z: number; r: number; count: number }[];
  /** The lighthouse's lamp, where its beam turns. */
  lamp?: { x: number; y: number; z: number };
  /** Running water, and where it falls, for the water's drawing: as `SceneDescription.streams` and `falls`. */
  streams: { line: number[]; width: number; banks?: number[]; fade?: number[] }[];
  falls: { x: number; y: number; z: number; height: number; width: number }[];
  /** Torches in the caverns under the island and their passages, if it has them. */
  torches: { position: Vector3; out: Vector3; fire?: number }[];
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

export function buildIsland(b: IslandBuild): IslandResult {
  const { site, p, kit, wild } = b;
  const o = site.island!, F = p.floor, sea = o.sea, g = site.grounds!;
  const rng = b.rng.fork('island');
  const s1 = rng.range(0, 60), s2 = rng.range(0, 60);
  const plain = (x: number, z: number) => landAt(o, F, x, z);
  const rockKind = ROCK[site.setting.stone];
  // (The island's cliffs show hundreds of metres of face: its beds are folded, and broken by faults, so they do not read as one pattern.)
  const strata = new Strata(rockKind, rng.fork('strata'), sea, { fold: 7, faults: 5, around: [o.x, o.z, Math.max(...o.coast)] });
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
  const insideOuter = (x: number, z: number, m = 0) => b.outerRects.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);

  // ---- the band of coast that is carved: this far in from the cliff top, and this far out over the sea bed
  // (Rock carved at a third of a metre and the sheet laid at a little under a metre: a notch finer than first made.)
  const CELL = 0.32, SHEET = 0.96, TILE = 9.6, IN = 8.4, OUT = 11;
  const snap = (v: number, up: boolean, to = TILE) => (up ? Math.ceil(v / to - 1e-6) : Math.floor(v / to + 1e-6)) * to;
  const area = { x0: snap(g.x0 - 40, false), x1: snap(g.x1 + 40, true), z0: snap(g.z0 - 40, false), z1: snap(g.z1 + 40, true) };
  const nearStack = (x: number, z: number, m: number) => o.stacks.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 2.2 + m);
  const cave = o.seaCave;
  const nearCave = (x: number, z: number, m: number) => !!cave && Math.hypot(x - cave.x - Math.cos(cave.heading) * cave.length * 0.5, z - cave.z - Math.sin(cave.heading) * cave.length * 0.5) < cave.length * 0.5 + 8 + m;
  // (Steep ground inland is carved as rock too: the crags of the summits. And the stair, wherever it runs, is carved with the cliff it is cut in.)
  const steepAt = (x: number, z: number) => { const y = plain(x, z); return Math.hypot(plain(x + 1.2, z) - y, plain(x, z + 1.2) - y) / 1.2 > 1.1; };
  const ar = o.arch;
  const nearArch = (x: number, z: number, m: number) => { if (!ar) return false; const [ax, az] = ar.from, [bx, bz] = ar.to, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - dx * t, z - az - dz * t) < ar.width + 4 + m; };
  // The caverns under the island, if it has them, and their passages: how far a point lies outside them, across the ground.
  const CV = o.caverns;
  const nearLine = (line: [number, number, number][], x: number, z: number): { off: number; y: number } => {
    let off = Infinity, y = 0;
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az, ay] = line[k], [bx, bz, by] = line[k + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < off) { off = d; y = ay + (by - ay) * t; }
    }
    return { off, y };
  };
  /** Where a point is in the cavern's own measures: 0 at its middle, 1 at its edge. */
  const inHall = (x: number, z: number) => {
    const h = CV!.hall, dx = x - h.x, dz = z - h.z, c = Math.cos(h.turn), sn = Math.sin(h.turn);
    return Math.hypot((dx * c + dz * sn) / h.rx, (-dx * sn + dz * c) / h.rz);
  };
  const nearCaverns = (x: number, z: number) => !CV || x < CV.hall.x - 200 || x > CV.hall.x + 200 || z < CV.hall.z - 200 || z > CV.hall.z + 200 ? Infinity : Math.min(nearLine(CV.lower, x, z).off - 1.6, nearLine(CV.upper, x, z).off - 1.6, (inHall(x, z) - 1) * Math.min(CV.hall.rx, CV.hall.rz));
  const inBand = (x: number, z: number) => { const d = inland(o, x, z); return (d > -OUT && d < IN) || nearStack(x, z, 0) || nearCave(x, z, 0) || nearArch(x, z, 0) || onStair(o, x, z).off < 6 || (d >= IN && steepAt(x, z)) || nearCaverns(x, z) < 4; };
  const tilesX = Math.round((area.x1 - area.x0) / TILE), tilesZ = Math.round((area.z1 - area.z0) / TILE);
  const tiles = new Uint8Array(tilesX * tilesZ);
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    let any = false;
    for (let z = area.z0 + j * TILE + 0.6; z < area.z0 + (j + 1) * TILE && !any; z += SHEET) for (let x = area.x0 + i * TILE + 0.6; x < area.x0 + (i + 1) * TILE && !any; x += SHEET) any = inBand(x, z);
    tiles[j * tilesX + i] = any ? 1 : 0;
  }
  /** Whether the ground at a point is carved; a point on the edge of a carved tile belongs to it. */
  const carved = (x: number, z: number) => {
    const fi = (x - area.x0) / TILE, fj = (z - area.z0) / TILE;
    for (const i of [Math.floor(fi + 1e-6), Math.floor(fi - 1e-6)]) for (const j of [Math.floor(fj + 1e-6), Math.floor(fj - 1e-6)]) {
      if (i >= 0 && j >= 0 && i < tilesX && j < tilesZ && tiles[j * tilesX + i]) return true;
    }
    return false;
  };
  const carvedTile = (i: number, j: number) => i >= 0 && j >= 0 && i < tilesX && j < tilesZ && tiles[j * tilesX + i] === 1;

  // ---- the lattice of heights over the band, worn as frost wears a cliff
  const MARGIN = 3.2;
  const land = new Grid2(area.x0 - MARGIN, area.z0 - MARGIN, CELL, Math.round((area.x1 - area.x0 + 2 * MARGIN) / CELL) + 1, Math.round((area.z1 - area.z0 + 2 * MARGIN) / CELL) + 1);
  const known = new Uint8Array(land.data.length), inside = new Uint8Array(land.data.length);
  for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
    const x = land.x0 + i * CELL, z = land.z0 + j * CELL, ti = Math.floor((x - area.x0) / TILE), tj = Math.floor((z - area.z0) / TILE);
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) {
      if (!carvedTile(ti + di, tj + dj)) continue;
      const tx0 = area.x0 + (ti + di) * TILE, tz0 = area.z0 + (tj + dj) * TILE;
      near = x > tx0 - MARGIN && x < tx0 + TILE + MARGIN && z > tz0 - MARGIN && z < tz0 + TILE + MARGIN;
    }
    if (!near) continue;
    const o2 = j * land.nx + i;
    known[o2] = 1;
    inside[o2] = carved(x, z) ? 1 : 0;
    land.data[o2] = plain(x, z);
  }
  const loose = land.like(), wornBy = land.like();
  {
    // How far each point of the band is from the nearest ground that is not band.
    const far = new Float32Array(land.data.length), nx = land.nx, nz = land.nz, D1 = CELL, D2 = CELL * Math.SQRT2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) far[j * nx + i] = i > 0 && j > 0 && i < nx - 1 && j < nz - 1 && inside[j * nx + i] ? 1e6 : 0;
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k - 1] + D1, far[k - nx] + D1, far[k - nx - 1] + D2, far[k - nx + 1] + D2); }
    for (let j = nz - 2; j > 0; j--) for (let i = nx - 2; i > 0; i--) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k + 1] + D1, far[k + nx] + D1, far[k + nx + 1] + D2, far[k + nx - 1] + D2); }
    const before = land.data.slice(), active = new Uint8Array(land.data.length);
    // Nothing is worn where something has been built, or where the ground was levelled for it, or on the beach.
    const built = (x: number, z: number) => onStair(o, x, z).off < 4 || o.cottages.some((q) => Math.hypot(x - q.x, z - q.z) < Math.max(q.w, q.d) + 3)
      || (!!o.lighthouse && Math.hypot(x - o.lighthouse.x, z - o.lighthouse.z) < o.lighthouse.r + 9)
      || (!!o.castle && Math.hypot(x - o.castle.x, z - o.castle.z) < 24)
      || Math.hypot(x - o.jetty.from[0], z - o.jetty.from[1]) < 8;
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
      const k = j * land.nx + i, x = land.x0 + i * CELL, z = land.z0 + j * CELL;
      if (!inside[k] || far[k] < 0.8 || built(x, z) || beachness(o, x, z) > 0.4) continue;
      active[k] = 1;
    }
    erode({
      rock: land, loose, active, repose: 0.67, kept: 0.16, passes: 46,
      holds: (k, y) => {
        const x = land.x0 + (k % land.nx) * CELL, z = land.z0 + Math.floor(k / land.nx) * CELL;
        // The sea keeps the foot of a cliff washed and sound: what the waves reach does not crumble back as frost has it.
        const hard = y < sea + 4 ? 0.95 : strata.hardness(Math.floor(strata.at(x, y, z)));
        return 0.7 + hard * hard * hard * 7;
      },
    });
    for (let k = 0; k < land.data.length; k++) {
      // Debris that comes down into the sea is taken by it; above the water it lies as scree.
      if (land.data[k] + loose.data[k] < sea + 0.4) loose.data[k] *= 0.3;
      land.data[k] += loose.data[k];
      wornBy.data[k] = land.data[k] - before[k];
    }
  }
  const ground = (x: number, z: number): number => (wornBy.holds(x, z) ? plain(x, z) + wornBy.at(x, z) : plain(x, z));

  // ---- steepness, the way uphill, and how far the ground is rock: read off the worn heights, as for the valley
  // (The box that holds the stair, with room about it, for asking quickly whether a point could be on it.)
  const stairBox = o.stair ? [Math.min(...o.stair.map((q) => q[0])) - 3, Math.max(...o.stair.map((q) => q[0])) + 3, Math.min(...o.stair.map((q) => q[1])) - 3, Math.max(...o.stair.map((q) => q[1])) + 3] : null;
  // Where streams go over the cliffs: from the lip out along the way the water was going, for as far as a face could fall
  // (`[x, z, along x, along z, length, half its breadth]`).
  const fallLines: number[][] = (o.streams ?? []).filter((st) => st.fall).map((st) => {
    const c = st.course, [ax, az] = c[Math.max(0, c.length - 3)], [bx, bz] = c[c.length - 1], l = Math.hypot(bx - ax, bz - az) || 1;
    return [bx, bz, (bx - ax) / l, (bz - az) / l, 26, st.width / 2 + 0.6];
  });
  const steepness = land.like(), rocky = land.like(), upX = land.like(), upZ = land.like();
  {
    const H = land.data, nxL = land.nx, raw = new Float32Array(H.length);
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < nxL; i++) {
      const k = j * nxL + i;
      steepness.data[k] = 1;
      if (!known[k]) continue;
      const w = i > 0 && known[k - 1] ? k - 1 : k, e = i < nxL - 1 && known[k + 1] ? k + 1 : k;
      const n = j > 0 && known[k - nxL] ? k - nxL : k, s = j < land.nz - 1 && known[k + nxL] ? k + nxL : k;
      const gx = e > w ? (H[e] - H[w]) / ((e - w) * CELL) : 0, gz = s > n ? (H[s] - H[n]) / (((s - n) / nxL) * CELL) : 0;
      const slope = Math.hypot(gx, gz);
      steepness.data[k] = Math.sqrt(1 + slope * slope);
      upX.data[k] = gx; upZ.data[k] = gz;
      raw[k] = smooth((slope - 0.85) / 0.6) * (1 - smooth(loose.data[k] / 0.3));
    }
    const ease = (data: Float32Array, times: number) => {
      const from = new Float32Array(data.length);
      for (let t = 0; t < times; t++) {
        from.set(data);
        for (let j = 1; j < land.nz - 1; j++) for (let i = 1; i < nxL - 1; i++) {
          const k = j * nxL + i;
          if (!known[k]) continue;
          let sum = 0, count = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = k + dj * nxL + di; if (known[q]) { sum += from[q]; count++; } }
          data[k] = sum / count;
        }
      }
    };
    ease(raw, 1); ease(upX.data, 3); ease(upZ.data, 3);
    for (let k = 0; k < H.length; k++) {
      rocky.data[k] = raw[k];
      // (The stair is cut clean: no broken rock on its treads.)
      if (stairBox) { const x = land.x0 + (k % nxL) * CELL, z = land.z0 + Math.floor(k / nxL) * CELL; if (known[k] && x > stairBox[0] && x < stairBox[1] && z > stairBox[2] && z < stairBox[3] && onStair(o, x, z).off < 2.1) rocky.data[k] = 0; }
      // (Down the line of a fall the face is worn smooth, so that the water lies on it.)
      if (fallLines.length && known[k]) { const x = land.x0 + (k % nxL) * CELL, z = land.z0 + Math.floor(k / nxL) * CELL; for (const fl of fallLines) { const t = Math.max(0, Math.min(1, ((x - fl[0]) * fl[2] + (z - fl[1]) * fl[3]) / fl[4])), off = Math.hypot(x - fl[0] - fl[2] * fl[4] * t, z - fl[1] - fl[3] * fl[4] * t); if (off < fl[5] + 2.5) rocky.data[k] *= smooth((off - fl[5]) / 2.5) * 0.85 + 0.15 * smooth((off - fl[5] - 1) / 1.5); } }
      const l = Math.hypot(upX.data[k], upZ.data[k]), f = l > 1e-6 ? smooth(l / 0.8) / l : 0;
      upX.data[k] *= f; upZ.data[k] *= f;
    }
  }
  const stepBeds = Math.max(1, Math.round(1.3 / rockKind.bed)), stepped = Math.min(1, rockKind.bedded * 1.4);

  // ---- the cave in the cove's cliff: a passage on a floor of shingle, opening out at its end
  const caveFloor = sea + 0.75;
  const caveAir = cave ? (x: number, y: number, z: number): number => {
    const ux = Math.cos(cave.heading), uz = Math.sin(cave.heading), a = (x - cave.x) * ux + (z - cave.z) * uz, c = -(x - cave.x) * uz + (z - cave.z) * ux;
    if (a < -6 || a > cave.length + 6) return -9;
    const t = Math.min(1, Math.max(0, a / cave.length)), end = Math.exp(-(((a - cave.length * 0.85) / (cave.length * 0.22)) ** 2));
    const wobble = (fbm2(a * 0.25 + s1, y * 0.3, 2) - 0.5) * 1.2;
    // (Its roof is kept a good thickness of rock under the ground above, wherever that is low.)
    const half = 1.9 + 0.8 * t + 2.6 * end + wobble, floor = caveFloor + a * 0.02, roof = Math.min(floor + 3.6 + 1.6 * t + 2.2 * end, Math.max(floor + 2.6, land.at(x, z) - 3));
    const arch = roof - (c / half) ** 2 * 2.2;
    return Math.min(half - Math.abs(c), y - floor + 0.3, arch - y, cave.length + 1.5 - a + end * 3);
  } : null;
  // ---- the opening under the arch: the sea cut through the neck of rock between the cliff and its stack. Not an ellipse: its roof
  // is a bed of the rock, nearly level, stepped where blocks have fallen from it; its sides are joints, leaning in as they rise
  // and stepping at the beds, one side not as the other; and at the water the waves have worn a notch into both.
  const archAir = ar ? (() => {
    const [ax, az] = ar.from, [bx, bz] = ar.to, len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const stack = o.stacks.reduce((p, q) => (Math.hypot(q.x - bx, q.z - bz) < Math.hypot(p.x - bx, p.z - bz) ? q : p), o.stacks[0]);
    const near = 3, far = len - (stack ? stack.r * 0.8 : 3), mid = (near + far) / 2, half = Math.max(2.5, (far - near) / 2);
    const q = rng.fork('arch'), leanA = q.range(0.08, 0.4), leanB = q.range(0.08, 0.4), roofTilt = q.range(-0.12, 0.12), bed = rockKind.bed * q.range(2.5, 4.5);
    const sa = q.range(0, 50), sb = q.range(0, 50);
    // (Stepped: a smooth wander held to the nearest of steps a bed or two apart, so that its edges are ledges, not curves.)
    const steps = (v: number, size: number) => Math.round(v / size) * size;
    return (x: number, y: number, z: number): number => {
      const sAlong = (x - ax) * ux + (z - az) * uz, c = -(x - ax) * uz + (z - az) * ux;
      if (Math.abs(c) > ar.width + 3 || sAlong < near - 6 || sAlong > far + 6) return -9;
      const up = Math.max(0, y - sea);
      // The roof: a bed, tilted a little, its underside broken into blocks; a little higher at the middle, where most has fallen.
      const roof = sea + ar.under + roofTilt * (sAlong - mid) + 0.18 * ar.under * (1 - ((sAlong - mid) / half) ** 2)
        + steps((fbm2(sAlong * 0.22 + sa, c * 0.22, 2) - 0.5) * 3.2, bed) + (fbm2(sAlong * 0.9, c * 0.9 + sb, 2) - 0.5) * 0.5;
      // The sides: joints, each leaning in by its own amount as it rises, stepping out and in at the beds.
      const jogA = steps((fbm2(y * 0.18 + sa, c * 0.15, 2) - 0.5) * 2.6, bed * 0.7), jogB = steps((fbm2(y * 0.18 + sb, c * 0.15 + 7, 2) - 0.5) * 2.6, bed * 0.7);
      const notch = 0.9 * Math.exp(-(((y - sea - 0.4) / 1.3) ** 2));
      const left = mid - half + leanA * up + jogA - notch, right = mid + half - leanB * up + jogB + notch;
      const rough = (fbm2(sAlong * 1.3 + sb, y * 1.3, 2) - 0.5) * 0.35;
      return Math.min(sAlong - left, right - sAlong, roof - y, y - (sea - 8)) + rough;
    };
  })() : null;
  /** How far in under the cliff a point of the cave is, 0 at its mouth and 1 at its end: for how dark it is there. */
  const caveDeep = (x: number, z: number) => (cave ? Math.min(1, Math.max(0, ((x - cave.x) * Math.cos(cave.heading) + (z - cave.z) * Math.sin(cave.heading)) / cave.length)) : 0);

  // ---- the land as a solid, as for the valley: heights read uphill or down as far as the rock's relief says
  const spot = { x: NaN, z: NaN, rocky: 0, h: 0, steep: 1, slope: 0, ux: 0, uz: 0 };
  const TREAD_MOST = 0.9, FINE_MOST = 1.5;
  const landAir = (x: number, y: number, z: number): number => {
    if (x !== spot.x || z !== spot.z) {
      spot.x = x; spot.z = z;
      spot.rocky = rocky.at(x, z); spot.h = land.at(x, z); spot.steep = steepness.at(x, z);
      if (spot.rocky >= 0.002) { spot.slope = Math.sqrt(Math.max(0.04, spot.steep * spot.steep - 1)); spot.ux = upX.at(x, z); spot.uz = upZ.at(x, z); }
    }
    const d = (y - spot.h) / spot.steep;
    if (spot.rocky < 0.002 || d > 5.4 || d < -5.4) return d;
    let out = Math.min(2.4, Math.max(-2.4, relief.broad(x, y, z)));
    const most = FINE_MOST * spot.rocky + 0.45;
    if (Math.abs(d - out * spot.rocky) > most) return d - out * spot.rocky;
    let fine = relief.fine(x, y, z);
    const tread = strata.at(x, y, z) / stepBeds + 0.31, within = tread - Math.floor(tread);
    fine += Math.max(-TREAD_MOST, Math.min(TREAD_MOST, ((within - 0.5) * stepBeds * rockKind.bed) / spot.slope)) * stepped;
    // Where the waves reach, the rock is scoured smooth of its smaller breaks.
    fine *= 0.45 + 0.55 * smooth((y - sea - 0.5) / 2.5);
    out += Math.max(-FINE_MOST, Math.min(FINE_MOST, fine));
    out *= spot.rocky;
    const sx = x + out * spot.ux, sz = z + out * spot.uz;
    return (y - land.at(sx, sz)) / steepness.at(sx, sz);
  };
  // ---- the caverns: the passages, natural and uneven, a little broader where the rock gave; the cavern, a low dome over a floor that
  // rises a little to its edges, with dripstone in it, columns from floor to roof and spears up from the floor and down from the roof,
  // kept off the way across it from one passage to the other.
  const drip: { x: number; z: number; r: number; kind: 'up' | 'down' | 'column'; reach: number }[] = [];
  if (CV) {
    const q = rng.fork('dripstone'), h = CV.hall, a = CV.lower[CV.lower.length - 1], bq = CV.upper[0];
    for (let tries = 0; tries < 200 && drip.length < 16; tries++) {
      const t = q.range(0, Math.PI * 2), r = Math.sqrt(q.range(0.05, 0.75)), c = Math.cos(h.turn), sn = Math.sin(h.turn);
      const lx = Math.cos(t) * r * h.rx, lz = Math.sin(t) * r * h.rz, x = h.x + lx * c - lz * sn, z = h.z + lx * sn + lz * c;
      // (Off the way across: the line from where the passage in comes to where the passage out leaves.)
      const dx = bq[0] - a[0], dz = bq[1] - a[1], l2 = dx * dx + dz * dz || 1, tt = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      if (Math.hypot(x - a[0] - dx * tt, z - a[1] - dz * tt) < 2.8 || drip.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + 1.2)) continue;
      const kind = q.chance(0.3) ? 'column' : q.chance(0.5) ? 'up' : 'down';
      drip.push({ x, z, r: kind === 'column' ? q.range(0.6, 1.3) : q.range(0.35, 0.8), kind, reach: q.range(1.5, 4.5) });
    }
  }
  // (A box round all of it, outside which nothing need be reckoned: the land is carved a great deal more than the caverns are.)
  const sysBox = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
  if (CV) {
    const R = Math.max(CV.hall.rx, CV.hall.rz) * 1.3;
    for (const [x, z, y] of [...CV.lower, ...CV.upper, [CV.hall.x - R, CV.hall.z - R, CV.hall.y], [CV.hall.x + R, CV.hall.z + R, CV.hall.y + CV.hall.high]] as [number, number, number][]) {
      sysBox.x0 = Math.min(sysBox.x0, x - 4); sysBox.x1 = Math.max(sysBox.x1, x + 4); sysBox.z0 = Math.min(sysBox.z0, z - 4); sysBox.z1 = Math.max(sysBox.z1, z + 4);
      sysBox.y0 = Math.min(sysBox.y0, y - 2); sysBox.y1 = Math.max(sysBox.y1, y + 4);
    }
    sysBox.y1 = Math.max(sysBox.y1, CV.hall.y + CV.hall.high + 2);
  }
  // (What depends only on where a point is across the ground is kept for the next point, which is mostly in the same column; and the
  // roughness, a noise in three dimensions, is reckoned only near the caverns. Reckoned for every point in the box, it made one island
  // take 87 seconds to build instead of 78.)
  const col = { x: NaN, z: NaN, lo: { off: 0, y: 0 }, up: { off: 0, y: 0 }, r: 0, half: 0, dome: 0 };
  const systemAir = CV ? (x: number, y: number, z: number): number => {
    if (x < sysBox.x0 || x > sysBox.x1 || z < sysBox.z0 || z > sysBox.z1 || y < sysBox.y0 || y > sysBox.y1) return -9;
    if (x !== col.x || z !== col.z) {
      col.x = x; col.z = z; col.lo = nearLine(CV.lower, x, z); col.up = nearLine(CV.upper, x, z); col.r = inHall(x, z);
      col.half = 1.55 + (fbm2(x * 0.15 + s2, z * 0.15, 2) - 0.5) * 0.8; col.dome = fbm2(x * 0.08 + s1, z * 0.08, 2);
    }
    if (col.lo.off > 3.5 && col.up.off > 3.5 && col.r >= 1.25) return -9;
    const rough = (fbm3(x * 0.35 + s1, y * 0.35, z * 0.35, 2) - 0.5) * 0.9;
    let air = -9;
    for (const n of [col.lo, col.up]) {
      if (n.off > 3.5) continue;
      const half = col.half;
      air = Math.max(air, Math.min(half - n.off + rough, y - n.y, n.y + 3.1 - (n.off / half) ** 2 * 0.9 - y + rough));
    }
    const h = CV.hall, r = col.r;
    if (r < 1.25) {
      const floor = h.y + 0.9 * r * r, roof = h.y + 1.6 + (h.high - 1.6) * Math.sqrt(Math.max(0, 1 - r * r)) * (0.8 + 0.4 * col.dome);
      let cav = Math.min((1 - r) * Math.min(h.rx, h.rz) + rough, y - floor, roof - y + rough);
      for (const d of drip) {
        const off = Math.hypot(x - d.x, z - d.z);
        if (off > d.r * (d.kind === 'column' ? 1.7 : 1) + 0.6) continue;
        if (d.kind === 'column') cav = Math.min(cav, off - d.r * (1 + 0.16 * Math.sin((y - floor) * 0.7 + d.reach) + 0.5 * Math.max(0, 1 - (y - floor) / 1.5) + 0.5 * Math.max(0, 1 - (roof - y) / 1.5)));
        else if (d.kind === 'up') { const u = (y - floor) / d.reach; if (u < 1) cav = Math.min(cav, off - d.r * Math.pow(1 - Math.max(0, u), 1.3)); }
        else { const u = (roof - y) / d.reach; if (u < 1) cav = Math.min(cav, off - d.r * Math.pow(1 - Math.max(0, u), 1.3)); }
      }
      air = Math.max(air, cav);
    }
    return air;
  } : null;
  const density = caveAir || archAir || systemAir ? (x: number, y: number, z: number) => Math.max(landAir(x, y, z), caveAir ? caveAir(x, y, z) : -9, archAir ? archAir(x, y, z) : -9, systemAir ? systemAir(x, y, z) : -9) : landAir;

  // ---- colours: of rock by the sea, and of the turf on the land above it
  const tint = b.stoneTint;
  const outcrop: Colour = [0.5 + 0.5 * tint[0], 0.52 + 0.5 * tint[1], 0.56 + 0.5 * tint[2]];
  const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
  const blotSeed = rng.fork('blot').int(1, 9999);
  const mixC = (c: Colour, to: Colour, t: number) => { c[0] += (to[0] - c[0]) * t; c[1] += (to[1] - c[1]) * t; c[2] += (to[2] - c[2]) * t; };
  /**
   * Rock by the sea. Each bed has its shade, with broad stains over it, as in the valley; then the
   * sea's bands. Under the water it is dark and furred with weed. Between the tides it is hung
   * with wrack, olive and brown. Just above, where only spray reaches, a black lichen stains it in
   * a band a man's height or two deep. Above that, on faces that take the weather, the orange
   * and the grey-green lichens of a sea cliff grow in patches, and the birds have whitened the
   * ledges under the top.
   */
  const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number): Colour => {
    const u = strata.at(q.x, q.y, q.z), i = Math.floor(u);
    const t = strata.shade(i), soft = 1 - strata.hardness(i);
    const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed);
    const tone = (0.72 + 0.56 * blot) * (0.7 + 0.3 * open);
    const c = rockColour(tone);
    const pale = rockKind.pale, dark = rockKind.dark;
    c[0] *= dark[0] + (pale[0] - dark[0]) * t; c[1] *= dark[1] + (pale[1] - dark[1]) * t; c[2] *= dark[2] + (pale[2] - dark[2]) * t;
    const up = Math.max(0, n.y), h = q.y - sea;
    // Each stretch of cliff its own: darker in one, paler in the next where the rock has lately fallen and the fresh face shows,
    // stained the rust and ochre of iron where water seeps out of it; and down the faces, streaks: dark where the seeps run, from
    // under the turf at the top, pale where the birds' droppings have run down from a ledge.
    const stretch = fbm2(q.x / 38 + 5.3, q.z / 38, 2, blotSeed + 21), warm = smooth((fbm2(q.x / 26, q.z / 26 + 2.7, 2, blotSeed + 23) - 0.55) / 0.15);
    const k = 0.78 + 0.5 * stretch;
    c[0] *= k * (1 + 0.28 * warm); c[1] *= k * (1 + 0.08 * warm); c[2] *= k * (1 - 0.18 * warm);
    const steepFace = 1 - Math.abs(n.y);
    const streak = fbm3(q.x * 0.42, q.y * 0.035, q.z * 0.42, 2, blotSeed + 25), seep = smooth((streak - 0.6) / 0.08) * steepFace * smooth((h - 2) / 3);
    mixC(c, [c[0] * 0.45, c[1] * 0.42, c[2] * 0.4], seep * 0.7);
    const runs = smooth((fbm3(q.x * 0.6 + 9, q.y * 0.05, q.z * 0.6, 2, blotSeed + 27) - 0.66) / 0.06) * steepFace * smooth((h - 6) / 4);
    mixC(c, [0.66, 0.65, 0.6], runs * 0.45);
    const patch = fbm3(q.x * 0.21 + 3, q.y * 0.35, q.z * 0.21, 3, blotSeed + 11), fleck = fbm3(q.x * 1.1, q.y * 1.1, q.z * 1.1, 2, blotSeed + 5);
    field[0] = Math.min(1, up * 0.6 + soft * 0.3 * (1 - open));
    field[1] = 0;
    if (h < 0.2) {
      mixC(c, [0.05, 0.06, 0.035], 0.75);
      field[1] = 1; field[0] = 0.7;
    } else if (h < 1.6) {
      const wrack = smooth((patch - 0.38) / 0.12) * (1 - smooth((h - 1.1) / 0.5));
      mixC(c, [c[0] * 0.45, c[1] * 0.45, c[2] * 0.42], 0.8);
      mixC(c, fleck > 0.5 ? [0.09, 0.075, 0.03] : [0.06, 0.06, 0.03], wrack);
      field[1] = 1 - smooth((h - 0.8) / 0.8) * 0.5;
    } else if (h < 4.2) {
      const black = (1 - smooth((h - 2.6 - patch * 1.4) / 0.9)) * 0.8;
      mixC(c, [0.035, 0.035, 0.035], black);
      field[1] = 0.25 * (1 - smooth((h - 2) / 1.5));
    } else {
      // Orange lichen on what faces the sky and the weather, grey-green elsewhere, in patches.
      const lichen = smooth((patch - 0.5) / 0.1) * (0.4 + 0.6 * up) * (1 - smooth((h - 26) / 10)) * open;
      mixC(c, fleck > 0.52 ? [0.55, 0.32, 0.07] : [0.36, 0.38, 0.29], lichen * 0.75);
      const pale2 = smooth((fbm3(q.x * 0.6, q.y * 1.6, q.z * 0.6, 2, blotSeed + 7) - 0.62) / 0.08) * smooth((-n.y + 0.1) / 0.3) * smooth((h - 6) / 4);
      mixC(c, [0.62, 0.61, 0.57], pale2 * 0.6);
    }
    // In the cave it is dark, and the darker the further in.
    if (caveAir && caveAir(q.x, q.y, q.z) > -0.8) { const dim = 1 - 0.85 * caveDeep(q.x, q.z); c[0] *= dim; c[1] *= dim; c[2] *= dim; field[1] = Math.max(field[1], 0.6); }
    field[3] = 0.25 + 0.75 * rockKind.bedded;
    return c;
  };

  // The track and the footpaths, as how far a point lies to one side of each, on a lattice over the island.
  const track = site.track ?? [];
  const lines = [{ points: track.slice(0, -1), track: true }, ...(site.paths ?? []).map((q) => ({ points: q.points, track: false }))];
  const ways = new Grid2(snap(g.x0 - 10, false, 1), snap(g.z0 - 10, false, 1), 0.5, Math.round((g.x1 - g.x0 + 20) / 0.5) + 2, Math.round((g.z1 - g.z0 + 20) / 0.5) + 2);
  const foot = ways.like();
  {
    ways.data.fill(99); foot.data.fill(8);
    for (const line of lines) for (let k = 0; k < line.points.length - 1; k++) {
      const [ax, az] = line.points[k], [bx, bz] = line.points[k + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
      const reach = line.track ? 6 : 8;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - ways.x0) / 0.5)), i1 = Math.min(ways.nx - 1, Math.ceil((Math.max(ax, bx) + reach - ways.x0) / 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - ways.z0) / 0.5)), j1 = Math.min(ways.nz - 1, Math.ceil((Math.max(az, bz) + reach - ways.z0) / 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = ways.x0 + i * 0.5, z = ways.z0 + j * 0.5, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (l * l)));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t), k2 = j * ways.nx + i;
        if (line.track) { if (d < Math.abs(ways.data[k2])) ways.data[k2] = d * (((x - ax) * dz - (z - az) * dx) < 0 ? -1 : 1); }
        else foot.data[k2] = Math.min(foot.data[k2], d);
      }
    }
  }
  const trackOff = (x: number, z: number) => {
    if (!ways.holds(x, z)) return 99;
    // (Near the door it gives way to the flags laid across the forecourt.)
    if (x > p.x0 && x < p.x1 && z < p.z1 - 6) return 99;
    const d = ways.data[Math.round((z - ways.z0) / 0.5) * ways.nx + Math.round((x - ways.x0) / 0.5)];
    return d;
  };
  const offFoot = (x: number, z: number) => (foot.holds(x, z) ? foot.at(x, z) : 8);
  /**
   * Heath: in from the cliff edge and out of the shelter of the hollow, in patches some tens of
   * metres across, the turf gives way to heather and gorse. One rule for the ground's colour and
   * for what grows on it, so the two agree.
   */
  const heathAt = (x: number, z: number): number => {
    const edge = 1 - smooth((inland(o, x, z) - 1) / 14), shelter = smooth((o.combe * 0.9 - Math.hypot(x - o.cove.x, z - o.cove.z) + o.cove.r) / 25);
    return smooth((fbm2(x * 0.045 + s2, z * 0.045 - s2, 3) - 0.5) / 0.08) * (1 - edge) * (1 - shelter);
  };
  const lay = { track: 0, wet: 0, bare: 0 };
  /**
   * Turf, and what the ground is at a point besides: bare sand or shingle on the beach and under
   * the water, wet below the tide line, bare where stones have come down. The turf of a sea cliff
   * is short and burnt by salt towards the edge, and greener in the shelter of the hollow.
   */
  const turfAt = (x: number, z: number, y: number): Colour => {
    const beach = beachness(o, x, z), above = y - sea;
    let bare = Math.max(loose.holds(x, z) ? smooth(loose.at(x, z) / 0.28) * 0.45 : 0, 1 - smooth((above - 0.9 - 0.9 * beach) / 0.7));
    bare = Math.max(bare, beach * (1 - smooth((above - 1.6) / 0.8)));
    if (cave && caveAir!(x, caveFloor + 0.5, z) > -0.5) bare = 1;
    const wet = 1 - smooth((above - 0.15) / 0.5);
    lay.bare = bare; lay.wet = wet * 0.85;
    const off = trackOff(x, z), f = offFoot(x, z);
    lay.track = Math.abs(off) < 6 ? 100 + off : f < 3 ? 200 + f : 0;
    const c = turfColour(x, z, s1), edge = 1 - smooth((inland(o, x, z) - 2) / 10), shelter = smooth((o.combe - Math.hypot(x - o.cove.x, z - o.cove.z) + o.cove.r) / 30);
    // (Burnt yellow-grey at the edge; a deeper green in the hollow; brown under heather.)
    const heath = heathAt(x, z) * 0.7;
    // (And in broad patches, tens of metres across, rough grazing: moor grass and rush, olive and brown, between the sweeter green
    // where the sheep keep it short. Without them the whole island from above was one even green, like a lawn.)
    const rough = smooth((fbm2(x * 0.016 + s1 * 0.7, z * 0.016 - s2 * 0.4, 3) - 0.47) / 0.12) * 0.95 * (1 - shelter * 0.5);
    return [c[0] * (1 + 0.18 * edge) * (1 - 0.06 * shelter) * (1 - 0.15 * heath) * (1 - 0.04 * rough), c[1] * (1 - 0.08 * edge + 0.06 * shelter) * (1 - 0.42 * heath) * (1 - 0.3 * rough), c[2] * (1 - 0.25 * edge) * (1 - 0.3 * heath) * (1 - 0.6 * rough)];
  };
  const earth = (x: number, z: number): Colour => {
    const t = 0.62 + 0.5 * fbm2(x * 0.5 + s2, z * 0.5 + s1, 3);
    return [0.5 * t * outcrop[0], 0.47 * t * outcrop[1], 0.43 * t * outcrop[2]];
  };

  // ---- carving: each tile of the band as a piece, only as tall as its own ground needs
  // (Where a piece meets the plain sheet, it is closed on the sheet's own edge.)
  const sheetEdge = alongSheet(ground, area.x0, area.z0, SHEET);
  wild.group = 'wild';
  const turfMesh = wild.mesh('turf'), screeMesh = wild.mesh('scree'), rockMesh = wild.mesh('rock');
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    if (!tiles[j * tilesX + i]) continue;
    const c = { x0: area.x0 + i * TILE, x1: area.x0 + (i + 1) * TILE, z0: area.z0 + j * TILE, z1: area.z0 + (j + 1) * TILE };
    let lo = Infinity, hi = -Infinity;
    // (Taken over the ground a little beyond the tile as well: the rock's face is pushed sideways by its relief, up to some four metres,
    // and so reads heights from there; a face that rose above the box or sank below it would be cut off there, and leave a hole.)
    const REACH = 4.5;
    for (let z = c.z0 - REACH; z < c.z1 + REACH + CELL / 2; z += CELL) for (let x = c.x0 - REACH; x < c.x1 + REACH + CELL / 2; x += CELL) { const h = land.at(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (cave && nearCave((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, TILE)) lo = Math.min(lo, caveFloor - 1);
    if (CV && nearCaverns((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2) < TILE) lo = Math.min(lo, Math.min(CV.lower[0][2], CV.hall.y) - 1.6);
    carveRock(rockMesh, density, {
      // (Not below a few metres under the sea, where the water is too deep to see through: there the rock is closed off flat.)
      min: V(c.x0, Math.floor((Math.max(lo - 2, sea - 4.8)) / CELL) * CELL, c.z0), max: V(c.x1, Math.ceil((Math.max(hi, sea - 3) + 2.8) / CELL) * CELL, c.z1),
      cell: CELL, uvScale: 0.4, otherUvScale: (m) => (m === screeMesh ? 0.55 : 2.3), fromSamples: true, occlusion: [0.3, 0.75], sharp: true, beyond: carved, edge: sheetEdge,
      meshFor: (n, at) => {
        if (!(n.y > 0.74 && rocky.at(at.x, at.z) < 0.5)) return null;
        // (Under the island, the caverns' floors are the rock.)
        if (systemAir && systemAir(at.x, at.y + 0.6, at.z) > 0 && plain(at.x, at.z) - at.y > 1.5) return null;
        // (Not in the stair's cut: the ledge either side of the steps, and the floor they stand on, are the rock they are cut in. As
        // ground they were turf, and so close to the sea it was drawn as sand: a band of yellow up the cliff beside the steps.)
        if (stairBox && at.x > stairBox[0] && at.x < stairBox[1] && at.z > stairBox[2] && at.z < stairBox[3]) { const st = onStair(o, at.x, at.z); if (st.off < 2.6 && at.y < st.y + 1.6) return null; }
        return loose.at(at.x, at.z) > 0.3 && at.y > sea + 0.6 ? screeMesh : turfMesh;
      },
      shade: (q, n, field, other, open) => {
        if (other === turfMesh) { const col = turfAt(q.x, q.z, q.y); field[0] = lay.track; field[1] = lay.wet; field[2] = lay.bare; return col; }
        if (other === screeMesh) return earth(q.x, q.z);
        return shadeRock(q, n, field, open);
      },
    });
  }

  // ---- boulders fallen from the cliffs, lying at their foot half in the water, where the waves break on them
  {
    const q = rng.fork('boulders'), lying: [number, number, number][] = [];
    for (let tries = 0; tries < 900 && lying.length < 46; tries++) {
      const a = q.range(0, Math.PI * 2), r = coastAt(o, a) + q.range(2.5, 9), x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
      if (inland(o, x, z) > -2 || beachness(o, x, z) > 0.25) continue;
      const y = ground(x, z), size = q.range(0.8, 2.6);
      if (y < sea - 2.2 || y > sea + 1.2) continue;
      // Not in the way into the cove.
      const c = o.cove, along = (x - c.x) * Math.cos(c.out) + (z - c.z) * Math.sin(c.out), across = Math.abs(-(x - c.x) * Math.sin(c.out) + (z - c.z) * Math.cos(c.out));
      if (along > 0 && across < c.mouth / 2 + 4) continue;
      if (lying.some(([bx, bz, bs]) => Math.hypot(bx - x, bz - z) < bs + size + 0.6)) continue;
      const form = boulderForm(q.fork(`b${lying.length}`), size, rockKind), cy = y + form.half * q.range(0.2, 0.6), cell = Math.min(0.26, Math.max(0.1, size * 0.13));
      // (Cut off a little under the ground, to save carving what is buried: under the lowest ground beneath it, not only the ground
      // at its middle, for where the bed falls away the cut would show, an open hole in the stone at the water's edge.)
      let under = y;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) under = Math.min(under, ground(x + dx * form.reach, z + dz * form.reach));
      carveRock(rockMesh, (qx, qy, qz) => form.density(qx - x, qy - cy, qz - z), {
        min: V(x - form.reach, Math.max(under - 1, cy - form.sink), z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
        cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
        shade: (pt, n, field, _other, open) => shadeRock(pt, n, field, open),
      });
      lying.push([x, z, size]);
    }
  }

  // ---- the sheet of ground over all that is not carved, out under the sea a little way
  layTerrain(turfMesh, wild.mesh('rockSheet'), ground, {
    area, cell: SHEET, seed: s1, stone: tint, turfScale: 2.3, rockScale: 0.4, bare: 0.62,
    colour: (x, z) => { const y = ground(x, z), c = turfAt(x, z, y); return [c[0], c[1], c[2], lay.track, lay.wet, lay.bare, 0]; },
    rock: (tone) => rockColour(tone * 0.8),
    // (Where the sea bed lies deeper than the rock is carved, under deep water, the sheet is laid there too, so there is no hole in the bottom of the sea.)
    skip: (c) => { const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2; return (carved(mx, mz) && Math.max(ground(c.x0, c.z0), ground(c.x1, c.z0), ground(c.x0, c.z1), ground(c.x1, c.z1)) > sea - 4.6) || insideOuter(mx, mz); },
    // The ground is drawn to the outer walls of the house and goes no further, so no gap is left to look down.
    warp: (x, z) => {
      if (!insideOuter(x, z)) return [x, z];
      let best: [number, number] = [x, z], least = Infinity;
      for (const r of b.outerRects) {
        const cx = Math.min(r.x1, Math.max(r.x0, x)), cz = Math.min(r.z1, Math.max(r.z0, z));
        for (const [px, pz] of [[r.x0 - 0.02, cz], [r.x1 + 0.02, cz], [cx, r.z0 - 0.02], [cx, r.z1 + 0.02]] as [number, number][]) {
          const d = Math.hypot(px - x, pz - z);
          if (d < least && !insideOuter(px, pz)) { least = d; best = [px, pz]; }
        }
      }
      return best;
    },
  });

  // The forecourt: flags from the door to where the track begins, baked with the house.
  kit.group = `p${p.id}`;
  {
    const doorX = track.length ? track[0][0] : (p.x0 + p.x1) / 2;
    for (let z = p.z0 + 0.05; z < p.z1 - 5.5; z += 1.5) kit.slab('floor', doorX - 1.15, z, doorX + 1.15, z + 1.5, F + 0.012, { ...b.flag, course: [0.6, 0.8], length: [0.7, 1.2] });
    kit.mass(V(p.x0 - 3, F - 5, p.z0), V(p.x1 + 3, F - 3.2, p.z1 + 3));
  }

  // ---- what stands on the island, and what grows on it
  wild.group = 'wild';
  const coast = buildCoast({ site, wild, rng: rng.fork('coast'), ground, stoneTint: tint, finds: b.finds, fences: b.fences, caveFloor, rockAt: (q, n, field) => shadeRock(q, n, field, 1) });
  // The dry-stone walls, of the island's own stone.
  (o.walls ?? []).forEach((w, k) => layWall((m) => wild.mesh(m), w, ground, [0.62 * (0.6 + 0.4 * tint[0]), 0.6 * (0.6 + 0.4 * tint[1]), 0.56 * (0.6 + 0.4 * tint[2])], rng.fork(`wall${k}`)));
  const planted = plantIsland({ site, wild, rng: rng.fork('planting'), planting: b.planting, cards: b.cards, ground, turfAt, heathAt, rockyAt: (x, z) => (rocky.holds(x, z) ? rocky.at(x, z) : 0), trackOff, offFoot, looseAt: (x, z) => (loose.holds(x, z) ? loose.at(x, z) : 0) });

  // ---- the edge of the world: nobody walks off a cliff or swims away
  {
    const C = 1.2, gx0 = snap(g.x0 - 12, false, C), gz0 = snap(g.z0 - 12, false, C), nx = Math.round((g.x1 - g.x0 + 24) / C) + 1, nz = Math.round((g.z1 - g.z0 + 24) / C) + 1;
    const ok = new Uint8Array(nx * nz);
    const onJetty = (x: number, z: number) => {
      const [ax, az] = o.jetty.from, [bx, bz] = o.jetty.to, dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      const a = ((x - ax) * dx + (z - az) * dz) / l, c = Math.abs(-(x - ax) * dz + (z - az) * dx) / l;
      return a > -1 && a < l + 0.4 && c < o.jetty.width / 2 + 0.3;
    };
    const inCave = (x: number, z: number) => !!caveAir && caveAir(x, caveFloor + 1, z) > 0.3;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = gx0 + i * C, z = gz0 + j * C, y = ground(x, z);
      let lo = y, hi = y;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) { const h = ground(x + dx * 1.1, z + dz * 1.1); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      // Ground that can be stood on: not a drop, and not deeper than the knee in the sea; the jetty, and the floor of the cave.
      ok[j * nx + i] = (hi - lo < 1.7 && y > sea - 0.35 && lo > sea - 0.6) || onJetty(x, z) || inCave(x, z) || onStair(o, x, z).off < 1.25 ? 1 : 0;
    }
    // Only what is reached from the forecourt counts: a ledge halfway down a cliff is not ground anyone walks to.
    const reach = new Uint8Array(nx * nz), queue: number[] = [];
    const start = Math.round((p.z1 - 2 - gz0) / C) * nx + Math.round(((p.x0 + p.x1) / 2 - gx0) / C);
    if (ok[start]) { reach[start] = 1; queue.push(start); }
    while (queue.length) {
      const k = queue.pop()!, i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, q = jj * nx + ii;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || reach[q] || !ok[q]) continue;
        reach[q] = 1; queue.push(q);
      }
    }
    // A fence over every cell that is not reached but touches one that is. (Over the cave, the fence begins above its roof.)
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (reach[k]) continue;
      let touches = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && reach[jj * nx + ii]) touches = true; }
      if (!touches) continue;
      const x = gx0 + i * C, z = gz0 + j * C;
      // (Over the cave, where the rock stands above its roof, the fence begins above the roof; anywhere else, out over the water included, it goes down below the sea bed.)
      let floor = caveAir && caveAir(x, caveFloor + 1, z) > -1.5 && ground(x, z) > caveFloor + 7 ? caveFloor + 8 : Math.min(sea - 8, ground(x, z) - 4);
      // (And over the caverns and their passages, above their roofs: whoever is in them walks under it.)
      if (CV) {
        const lo2 = nearLine(CV.lower, x, z), up2 = nearLine(CV.upper, x, z);
        if (lo2.off < 3) floor = Math.max(floor, lo2.y + 4);
        if (up2.off < 3) floor = Math.max(floor, up2.y + 4);
        if (inHall(x, z) < 1.3) floor = Math.max(floor, CV.hall.y + CV.hall.high + 2);
      }
      b.fences.push({ min: V(x - C / 2, floor, z - C / 2), max: V(x + C / 2, F + 90, z + C / 2) });
    }
  }

  // ---- the sea bed, for the sea to know how deep it is
  const BED = 2;
  const bed = { x0: snap(g.x0 - 120, false, BED), z0: snap(g.z0 - 120, false, BED), cell: BED, nx: Math.round((g.x1 - g.x0 + 240) / BED) + 1, nz: Math.round((g.z1 - g.z0 + 240) / BED) + 1, data: new Float32Array(0) };
  bed.data = new Float32Array(bed.nx * bed.nz);
  for (let j = 0; j < bed.nz; j++) for (let i = 0; i < bed.nx; i++) bed.data[j * bed.nx + i] = ground(bed.x0 + i * BED, bed.z0 + j * BED);

  // ---- the mainland and the islets, far across the water
  wild.group = 'soft';
  layMainland(wild.mesh('far'), site, tint, F);
  wild.group = 'wild';

  // ---- running water: each stream's surface along its bed, and where it goes over a cliff, down the face to the sea, lying on
  // the rock (worn smooth for it), and spray and the sound of it at the foot
  const streamLines: IslandResult['streams'] = [], fallsAt: IslandResult['falls'] = [];
  for (const st of o.streams ?? []) {
    const depth = 0.14 + 0.06 * st.width, line: number[] = [], banks: number[] = [], fade: number[] = [];
    const n = st.course.length;
    st.course.forEach(([x, z, y], k) => { line.push(x, y + depth, z); banks.push(st.width / 2 + 0.25, st.width / 2 + 0.25); fade.push(smooth(k / 2.5)); });
    if (st.fall) {
      const [ax, az] = st.course[Math.max(0, n - 3)], [bx, bz, by] = st.course[n - 1], l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l;
      let y = by + depth, foot = { x: bx, z: bz };
      for (let d = 0.3; d < 26; d += 0.3) {
        const x = bx + ux * d, z = bz + uz * d;
        // (Water does not run uphill, whatever the rock does; and it ends in the sea.)
        y = Math.max(sea + 0.05, Math.min(y, ground(x, z) + 0.09));
        // (Spreading as it falls, and broken: a fall over a sea cliff is a broad veil by the time it reaches the foot.)
        const spread = st.width / 2 + 0.6 + Math.min(2.2, Math.max(0, by - y) * 0.12);
        line.push(x, y, z); banks.push(spread, spread); fade.push(1);
        foot = { x, z };
        if (y <= sea + 0.06) break;
      }
      fallsAt.push({ x: foot.x, y: sea, z: foot.z, height: by - sea, width: st.width + 3 });
    }
    streamLines.push({ line, width: st.width + 0.5, banks, fade });
  }

  // Where the player comes in: at the end of the jetty, facing the land.
  const [jx, jz] = o.jetty.to, [rx, rz] = o.jetty.from, jl = Math.hypot(jx - rx, jz - rz);
  const ex = jx + ((rx - jx) / jl) * 1.6, ez = jz + ((rz - jz) / jl) * 1.6;
  // The caverns: torches down the passages and round the cavern; the smugglers' barrels and crates against its wall, and what they
  // left; and two jambs and a lintel of stone where the passage out comes up into its cutting.
  const torches: IslandResult['torches'] = [];
  if (CV) {
    const { solid } = anyAngle((mm) => wild.mesh(mm));
    const begun = new Map(['stone', 'wood', 'metal'].map((mm) => [mm, wild.mesh(mm).vertexCount]));
    const box = (mm: string, x: number, y: number, z: number, w: number, d: number, hgt: number, yaw: number, colour: Colour) => {
      const c = Math.cos(yaw), sn = Math.sin(yaw), at = (a: number, f: number, up: number): [number, number, number] => [x + c * a - sn * f, y + up, z + sn * a + c * f];
      solid(mm, [at(-w / 2, -d / 2, 0), at(w / 2, -d / 2, 0), at(w / 2, d / 2, 0), at(-w / 2, d / 2, 0), at(-w / 2, -d / 2, hgt), at(w / 2, -d / 2, hgt), at(w / 2, d / 2, hgt), at(-w / 2, d / 2, hgt)], colour);
    };
    for (const line of [CV.lower, CV.upper]) for (let k = 3, side = 1; k < line.length - 2; k += 5, side = -side) {
      const [x, z, y] = line[k], [nx2, nz2] = line[k + 1], dx = nx2 - x, dz = nz2 - z, l = Math.hypot(dx, dz) || 1, px = (-dz / l) * side, pz = (dx / l) * side;
      if (plain(x, z) - y < 3.5) continue;
      torches.push({ position: V(x + px * 1.15, y + 1.9, z + pz * 1.15), out: V(-px, 0, -pz) });
    }
    const h = CV.hall, c = Math.cos(h.turn), sn = Math.sin(h.turn), onEdge = (t: number, r: number) => { const lx = Math.cos(t) * r * h.rx, lz = Math.sin(t) * r * h.rz; return [h.x + lx * c - lz * sn, h.z + lx * sn + lz * c]; };
    for (let k = 0; k < 5; k++) {
      const [x, z] = onEdge((k / 5) * Math.PI * 2 + 0.4, 0.8), dx = h.x - x, dz = h.z - z, l = Math.hypot(dx, dz) || 1;
      torches.push({ position: V(x, h.y + 0.9 * 0.64 + 2.0, z), out: V(dx / l, 0, dz / l) });
    }
    const q = rng.fork('cache'), [kx, kz] = onEdge(q.range(0, Math.PI * 2), 0.62), ky = h.y + 0.9 * 0.62 * 0.62;
    for (let k = 0; k < 4; k++) box('wood', kx + q.range(-1.4, 1.4), ky - 0.05, kz + q.range(-1.4, 1.4), 0.6, 0.6, q.range(0.55, 0.85), q.range(0, 3), [0.62, 0.45, 0.28]);
    box('wood', kx + 1.9, ky - 0.05, kz - 0.6, 1.1, 0.7, 0.7, q.range(0, 3), [0.55, 0.4, 0.25]);
    b.finds.push({ at: V(kx, ky + 0.4, kz), what: 'a tarred keg of brandy and a coil of rope, the smugglers\' cache in the cavern under the island' });
    const up = CV.upper, mouth = up.findIndex(([x, z, y]) => plain(x, z) - y < 3.4);
    if (mouth > 0) {
      const [x, z, y] = up[mouth], [x0, z0] = up[mouth - 1], yaw = Math.atan2(z - z0, x - x0) + Math.PI / 2, cc = Math.cos(yaw), ss = Math.sin(yaw);
      for (const side of [-1, 1]) box('stone', x + cc * side * 1.8, y - 0.3, z + ss * side * 1.8, 0.6, 0.8, 3.3, yaw, [0.6 * tint[0], 0.58 * tint[1], 0.55 * tint[2]]);
      box('stone', x, y + 3.0, z, 4.3, 0.9, 0.6, yaw, [0.6 * tint[0], 0.58 * tint[1], 0.55 * tint[2]]);
    }
    // (What is set up down there sees little of the sky, and is lit so.)
    for (const [mm, from] of begun) wild.mesh(mm).setOpenBy((x, y, z) => (plain(x, z) - y > 2.5 ? 0.12 : 1), from);
  }
  const season = site.setting.season ?? 'spring';
  return {
    torches,
    spawn: V(ex, coast.deck + 1.75, ez),
    // (Yaw is measured so that 0 looks towards lesser z.)
    yaw: Math.atan2(-(rx - jx), -(rz - jz)),
    track: [...track].reverse().slice(1, -1) as [number, number][],
    far: {
      wood: [0.05, 0.08, 0.035], grass: season === 'autumn' ? [0.22, 0.2, 0.09] : season === 'summer' ? [0.15, 0.2, 0.07] : [0.14, 0.22, 0.07],
      // (Bare earth on an island is peat over thin soil, dark and brown: the track and the footpaths worn into it are that colour, not
      // the pale soil of a valley's lane, which in the open sun out here read as chalk, and a footpath across the turf as a white line.)
      bare: [0.66, 0.56, 0.46, 0],
    },
    sea: {
      level: sea, x: o.x, z: o.z, bed,
      // Where the swell breaks at the foot of a cliff, every few strides round the coast that is not beach, and round the stacks.
      spray: [
        ...Array.from({ length: 240 }, (_, k) => {
          const a = (k / 240) * Math.PI * 2, r = coastAt(o, a) + (k % 2 ? 3 : 5.5), x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
          // (Not in the cove, which is sheltered, nor anywhere the coast found along this bearing is not the cliff's own foot.)
          const inCove = Math.hypot(x - o.cove.x, z - o.cove.z) < o.cove.r + 12;
          return { x, z, nx: Math.cos(a), nz: Math.sin(a), ok: !inCove && inland(o, x - Math.cos(a) * 2, z - Math.sin(a) * 2) > -4 && beachness(o, x, z) < 0.2 && inland(o, x, z) < -1 && ground(x, z) < sea - 0.2 && ground(x - Math.cos(a) * 5, z - Math.sin(a) * 5) > sea + 1.5 };
        }).filter((q) => q.ok).map(({ x, z, nx, nz }) => ({ x, z, nx, nz })),
        ...o.stacks.flatMap((q) => [0, 1, 2, 3].map((k) => ({ x: q.x + Math.cos(k * 1.57) * (q.r + 1.5), z: q.z + Math.sin(k * 1.57) * (q.r + 1.5), nx: Math.cos(k * 1.57), nz: Math.sin(k * 1.57) }))),
      ],
    },
    planted,
    lamp: coast.lamp,
    streams: streamLines,
    falls: fallsAt,
    // Sheep on the pasture: two to four flocks, well in from the cliffs, off the track and the paths, away from the house and the
    // cottages and the lighthouse, on ground not too steep, and a good way apart. (An island of grass with nothing on it to graze it was
    // a lawn kept by nobody.)
    flocks: (() => {
      const q = rng.fork('flocks'), want = q.int(2, 4), out: { x: number; z: number; r: number; count: number }[] = [];
      for (let tries = 0; tries < 300 && out.length < want; tries++) {
        const a = q.range(0, Math.PI * 2), x = o.x + Math.cos(a) * coastAt(o, a) * q.range(0.15, 0.8), z = o.z + Math.sin(a) * coastAt(o, a) * q.range(0.15, 0.8);
        if (inland(o, x, z) < 26 || Math.abs(trackOff(x, z)) < 12 || offFoot(x, z) < 6) continue;
        if (x > o.level.x0 - 25 && x < o.level.x1 + 25 && z > o.level.z0 - 25 && z < o.level.z1 + 25) continue;
        if (o.cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 28) || (o.lighthouse && Math.hypot(o.lighthouse.x - x, o.lighthouse.z - z) < 30)) continue;
        if (Math.hypot(ground(x + 4, z) - ground(x - 4, z), ground(x, z + 4) - ground(x, z - 4)) / 8 > 0.3 || out.some((f) => Math.hypot(f.x - x, f.z - z) < 60)) continue;
        out.push({ x, z, r: q.range(14, 24), count: q.int(4, 9) });
      }
      b.planting.crop(out);
      return out;
    })(),
    // Gulls: off the cliffs at the height of their tops, off the stacks, and over the cove.
    birds: [
      ...Array.from({ length: 4 }, (_, k) => { const a = (k / 4) * Math.PI * 2 + s1, r = coastAt(o, a) + 14; return { x: o.x + Math.cos(a) * r, y: F + 4, z: o.z + Math.sin(a) * r }; }),
      ...o.stacks.slice(0, 2).map((q) => ({ x: q.x, y: sea + q.height + 6, z: q.z })),
      { x: o.cove.x, y: sea + 14, z: o.cove.z },
    ],
    unders: [...(CV ? [
      { min: V(CV.hall.x - Math.max(CV.hall.rx, CV.hall.rz) - 2, CV.hall.y - 1, CV.hall.z - Math.max(CV.hall.rx, CV.hall.rz) - 2), max: V(CV.hall.x + Math.max(CV.hall.rx, CV.hall.rz) + 2, CV.hall.y + CV.hall.high + 2, CV.hall.z + Math.max(CV.hall.rx, CV.hall.rz) + 2) },
      ...[CV.lower, CV.upper].map((line) => ({ min: V(Math.min(...line.map((p0) => p0[0])) - 2, Math.min(...line.map((p0) => p0[2])) - 1, Math.min(...line.map((p0) => p0[1])) - 2), max: V(Math.max(...line.map((p0) => p0[0])) + 2, Math.max(...line.map((p0) => p0[2])) + 1.5, Math.max(...line.map((p0) => p0[1])) + 2) })),
    ] : []), ...(cave ? [(() => {
      const ux = Math.cos(cave.heading), uz = Math.sin(cave.heading), a0 = 3, a1 = cave.length + 2, w = 6;
      const xs = [cave.x + ux * a0 - uz * w, cave.x + ux * a0 + uz * w, cave.x + ux * a1 - uz * w, cave.x + ux * a1 + uz * w], zs = [cave.z + uz * a0 + ux * w, cave.z + uz * a0 - ux * w, cave.z + uz * a1 + ux * w, cave.z + uz * a1 - ux * w];
      return { min: V(Math.min(...xs), caveFloor - 1, Math.min(...zs)), max: V(Math.max(...xs), caveFloor + 8, Math.max(...zs)) };
    })()] : [])],
  };
}

/**
 * The land across the water: a coast that stands up from the sea in a line of low cliffs and
 * goes back into hills, and behind them mountains; it fills an arc of the horizon on one side,
 * and the rest is open sea. And the islets between, low humps of rock and turf. Drawn as one
 * sheet in rings about the island, with the far material, and left out wherever it lies under
 * the water.
 */
function layMainland(mesh: MeshBuilder, site: Site, stone: Colour, F: number): void {
  const o = site.island!, m = o.mainland, cx = o.x, cz = o.z, sea = o.sea, seed = (o.x * 7.31 + o.z * 3.17) % 97;
  // (A notch finer than first made: half as many points again round each ring, and the rings closer.)
  const around = 1440, radii: number[] = [];
  for (let r = 240; r <= 3400; r += 2.4 + (r - 240) * 0.009) radii.push(r);
  const ridge = (x: number, z: number, s: number) => { const v = 1 - Math.abs(fbm2(x, z, 3, s) * 2 - 1); return v * v; };
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x - cx, z - cz), a = Math.atan2(z - cz, x - cx);
    // (An island that was found has about it the rest of the sea it was found in: the land of that, not a mainland drawn by rule.)
    if (o.terrain) return acrossWater(o, F, x, z, r);
    // The mainland's shore: at its distance on its bearing, coming nearer or further in bays and points, and turning away at either end of its arc.
    const off = Math.abs(((a - m.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const shore = m.distance * (1 + 0.12 * (fbm2(a * 3 + seed, 0.5, 3) - 0.5) + 0.05 * Math.sin(a * 9 + seed)) + Math.max(0, off - m.spread) * 2400;
    const inn = r - shore;
    let y = sea - 30;
    if (inn > -60) {
      // Low cliffs and a strand at the water, then rising country, then mountains.
      const lift = smooth((inn + 25) / 60) * (14 + 30 * fbm2(x * 0.004 + seed, z * 0.004, 3));
      const hills = smooth((inn - 80) / 500) * (40 + 260 * ridge(x * 0.0016 + seed, z * 0.0016, 7)) + smooth((inn - 500) / 900) * (200 + 520 * ridge(x * 0.0008 - seed, z * 0.0008, 9));
      y = sea - 30 + smooth((inn + 60) / 70) * 30 + lift + hills * (m.height ?? 1);
    }
    // The islets: low humps, steep at their edges.
    for (const q of o.islets) {
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < q.r * 1.6) y = Math.max(y, sea - 4 + (q.height + 4) * (1 - smooth((d - q.r * 0.55) / (q.r * 0.55))) * (0.75 + 0.5 * fbm2(x * 0.05, z * 0.05, 2, 3)));
    }
    return y;
  };
  const rings = radii.length, H = new Float32Array(rings * around), X = new Float32Array(rings * around), Z = new Float32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const a = (k / around) * Math.PI * 2, q = ri * around + k;
    X[q] = cx + Math.cos(a) * radii[ri]; Z[q] = cz + Math.sin(a) * radii[ri]; H[q] = height(X[q], Z[q]);
  }
  const at = (ri: number, k: number) => Math.min(rings - 1, Math.max(0, ri)) * around + ((k + around) % around);
  const ids = new Int32Array(rings * around).fill(-1);
  const id = (ri: number, k: number) => {
    const q = at(ri, k);
    if (ids[q] >= 0) return ids[q];
    const e = at(ri, k + 1), w = at(ri, k - 1), n = at(ri + 1, k), s = at(ri - 1, k);
    const ax = X[e] - X[w], ay = H[e] - H[w], az = Z[e] - Z[w], bx = X[n] - X[s], by = H[n] - H[s], bz = Z[n] - Z[s];
    let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const span = Math.hypot(ax, az) * 0.5 + Math.hypot(bx, bz) * 0.5;
    const hollow = Math.min(1, Math.max(-1, (((H[e] + H[w] + H[n] + H[s]) / 4 - H[q]) / span) * 9));
    const h = (H[q] - sea) / 220;
    const r = 0.37 * (0.6 + 0.4 * stone[0]), g = 0.37 * (0.6 + 0.4 * stone[1]), bl = 0.4 * (0.6 + 0.4 * stone[2]);
    return (ids[q] = mesh.addVertex(X[q], H[q], Z[q], nx, ny, nz, X[q] * 0.012, Z[q] * 0.012, r, g, bl, 0, 0, hollow, h));
  };
  for (let ri = 0; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
    const qa = at(ri, k), qb = at(ri, k + 1), qc = at(ri + 1, k + 1), qd = at(ri + 1, k);
    // Under the sea nothing is drawn: the sea is opaque out here.
    if (Math.max(H[qa], H[qb], H[qc], H[qd]) < sea - 2) continue;
    const a = id(ri, k), bb = id(ri, k + 1), c = id(ri + 1, k + 1), d = id(ri + 1, k);
    mesh.addTriangle(a, bb, c);
    mesh.addTriangle(a, c, d);
  }
}

/** How far a point is out from the island's coast, for whatever needs a rough answer far from it. */
export function offshore(site: Site, x: number, z: number): number {
  const o = site.island!;
  return Math.hypot(x - o.x, z - o.z) - coastAt(o, Math.atan2(z - o.z, x - o.x));
}
