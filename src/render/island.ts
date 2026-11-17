import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../core/rng';
import { beachness, coastAt, inland, landAt } from '../core/island';
import { Place, Site } from '../core/site';
import { Kit } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { MeshBuilder } from './geom/meshBuilder';
import { carveRock } from './geom/rock';
import { boulderForm, cliffRelief, erode, Grid2, ROCK, Strata } from './geom/rockForms';
import { layTerrain, turfColour } from './landscape';
import { Colour, Planting } from './planting';
import { CardSet, SeaDesc } from './scene';
import { buildCoast } from './coast';
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
  far: { wood: [number, number, number]; grass: [number, number, number] };
  sea: SeaDesc;
  planted: Record<string, number>;
  /** Space under the cliff, out of doors: the sea cave, where no mist lies. */
  unders: { min: Vector3; max: Vector3 }[];
  birds: { x: number; y: number; z: number }[];
  /** The lighthouse's lamp, where its beam turns. */
  lamp?: { x: number; y: number; z: number };
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
  const strata = new Strata(rockKind, rng.fork('strata'), sea);
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
  const insideOuter = (x: number, z: number, m = 0) => b.outerRects.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);

  // ---- the band of coast that is carved: this far in from the cliff top, and this far out over the sea bed
  const CELL = 0.4, SHEET = 1.2, TILE = 9.6, IN = 8.4, OUT = 11;
  const snap = (v: number, up: boolean, to = TILE) => (up ? Math.ceil(v / to - 1e-6) : Math.floor(v / to + 1e-6)) * to;
  const area = { x0: snap(g.x0 - 40, false), x1: snap(g.x1 + 40, true), z0: snap(g.z0 - 40, false), z1: snap(g.z1 + 40, true) };
  const nearStack = (x: number, z: number, m: number) => o.stacks.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 2.2 + m);
  const cave = o.seaCave;
  const nearCave = (x: number, z: number, m: number) => !!cave && Math.hypot(x - cave.x - Math.cos(cave.heading) * cave.length * 0.5, z - cave.z - Math.sin(cave.heading) * cave.length * 0.5) < cave.length * 0.5 + 8 + m;
  const inBand = (x: number, z: number) => { const d = inland(o, x, z); return (d > -OUT && d < IN) || nearStack(x, z, 0) || nearCave(x, z, 0); };
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
    const built = (x: number, z: number) => o.cottages.some((q) => Math.hypot(x - q.x, z - q.z) < Math.max(q.w, q.d) + 3)
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
    const half = 1.9 + 0.8 * t + 2.6 * end + wobble, floor = caveFloor + a * 0.02, roof = floor + 3.6 + 1.6 * t + 2.2 * end;
    const arch = roof - (c / half) ** 2 * 2.2;
    return Math.min(half - Math.abs(c), y - floor + 0.3, arch - y, cave.length + 1.5 - a + end * 3);
  } : null;
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
  const density = caveAir ? (x: number, y: number, z: number) => Math.max(landAir(x, y, z), caveAir(x, y, z)) : landAir;

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
    return [c[0] * (1 + 0.18 * edge) * (1 - 0.06 * shelter) * (1 - 0.15 * heath), c[1] * (1 - 0.08 * edge + 0.06 * shelter) * (1 - 0.42 * heath), c[2] * (1 - 0.25 * edge) * (1 - 0.3 * heath)];
  };
  const earth = (x: number, z: number): Colour => {
    const t = 0.62 + 0.5 * fbm2(x * 0.5 + s2, z * 0.5 + s1, 3);
    return [0.5 * t * outcrop[0], 0.47 * t * outcrop[1], 0.43 * t * outcrop[2]];
  };

  // ---- carving: each tile of the band as a piece, only as tall as its own ground needs
  wild.group = 'wild';
  const turfMesh = wild.mesh('turf'), screeMesh = wild.mesh('scree'), rockMesh = wild.mesh('rock');
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    if (!tiles[j * tilesX + i]) continue;
    const c = { x0: area.x0 + i * TILE, x1: area.x0 + (i + 1) * TILE, z0: area.z0 + j * TILE, z1: area.z0 + (j + 1) * TILE };
    let lo = Infinity, hi = -Infinity;
    for (let z = c.z0; z < c.z1 + CELL / 2; z += CELL) for (let x = c.x0; x < c.x1 + CELL / 2; x += CELL) { const h = land.at(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (cave && nearCave((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, TILE)) lo = Math.min(lo, caveFloor - 1);
    carveRock(rockMesh, density, {
      // (Not below a few metres under the sea, where the water is too deep to see through: there the rock is closed off flat.)
      min: V(c.x0, Math.floor((Math.max(lo - 2, sea - 4.8)) / CELL) * CELL, c.z0), max: V(c.x1, Math.ceil((Math.max(hi, sea - 3) + 2.8) / CELL) * CELL, c.z1),
      cell: CELL, uvScale: 0.4, otherUvScale: (m) => (m === screeMesh ? 0.55 : 2.3), fromSamples: true, occlusion: [0.3, 0.75], sharp: true, beyond: carved,
      meshFor: (n, at) => (n.y > 0.74 && rocky.at(at.x, at.z) < 0.5 ? (loose.at(at.x, at.z) > 0.3 && at.y > sea + 0.6 ? screeMesh : turfMesh) : null),
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
      carveRock(rockMesh, (qx, qy, qz) => form.density(qx - x, qy - cy, qz - z), {
        min: V(x - form.reach, Math.max(y - 1, cy - form.sink), z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
        cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
        shade: (pt, n, field, _other, open) => shadeRock(pt, n, field, open),
      });
      lying.push([x, z, size]);
    }
  }

  // ---- the sheet of ground over all that is not carved, out under the sea a little way
  layTerrain(turfMesh, rockMesh, ground, {
    area, cell: SHEET, seed: s1, stone: tint, turfScale: 2.3, rockScale: 0.4, bare: 0.62,
    colour: (x, z) => { const y = ground(x, z), c = turfAt(x, z, y); return [c[0], c[1], c[2], lay.track, lay.wet, lay.bare, 0]; },
    rock: (tone) => rockColour(tone * 0.8),
    skip: (c) => { const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2; return carved(mx, mz) || insideOuter(mx, mz); },
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
  const coast = buildCoast({ site, wild, rng: rng.fork('coast'), ground, stoneTint: tint, finds: b.finds, fences: b.fences, caveFloor });
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
      ok[j * nx + i] = (hi - lo < 1.7 && y > sea - 0.35 && lo > sea - 0.6) || onJetty(x, z) || inCave(x, z) ? 1 : 0;
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
      const floor = caveAir && caveAir(x, caveFloor + 1, z) > -1.5 ? caveFloor + 8 : sea - 8;
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
  layMainland(wild.mesh('far'), site, tint);
  wild.group = 'wild';

  // Where the player comes in: at the end of the jetty, facing the land.
  const [jx, jz] = o.jetty.to, [rx, rz] = o.jetty.from, jl = Math.hypot(jx - rx, jz - rz);
  const ex = jx + ((rx - jx) / jl) * 1.6, ez = jz + ((rz - jz) / jl) * 1.6;
  const season = site.setting.season ?? 'spring';
  return {
    spawn: V(ex, coast.deck + 1.75, ez),
    // (Yaw is measured so that 0 looks towards lesser z.)
    yaw: Math.atan2(-(rx - jx), -(rz - jz)),
    track: [...track].reverse().slice(1, -1) as [number, number][],
    far: { wood: [0.05, 0.08, 0.035], grass: season === 'autumn' ? [0.22, 0.2, 0.09] : season === 'summer' ? [0.15, 0.2, 0.07] : [0.14, 0.22, 0.07] },
    sea: {
      level: sea, x: o.x, z: o.z, bed,
      // Where the swell breaks at the foot of a cliff, every few strides round the coast that is not beach, and round the stacks.
      spray: [
        ...Array.from({ length: 240 }, (_, k) => {
          const a = (k / 240) * Math.PI * 2, r = coastAt(o, a) + (k % 2 ? 3 : 5.5), x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
          return { x, z, nx: Math.cos(a), nz: Math.sin(a), ok: beachness(o, x, z) < 0.2 && inland(o, x, z) < -1 && ground(x, z) < sea - 0.2 && ground(x - Math.cos(a) * 5, z - Math.sin(a) * 5) > sea + 1.5 };
        }).filter((q) => q.ok).map(({ x, z, nx, nz }) => ({ x, z, nx, nz })),
        ...o.stacks.flatMap((q) => [0, 1, 2, 3].map((k) => ({ x: q.x + Math.cos(k * 1.57) * (q.r + 1.5), z: q.z + Math.sin(k * 1.57) * (q.r + 1.5), nx: Math.cos(k * 1.57), nz: Math.sin(k * 1.57) }))),
      ],
    },
    planted,
    lamp: coast.lamp,
    // Gulls: off the cliffs at the height of their tops, off the stacks, and over the cove.
    birds: [
      ...Array.from({ length: 4 }, (_, k) => { const a = (k / 4) * Math.PI * 2 + s1, r = coastAt(o, a) + 14; return { x: o.x + Math.cos(a) * r, y: F + 4, z: o.z + Math.sin(a) * r }; }),
      ...o.stacks.slice(0, 2).map((q) => ({ x: q.x, y: sea + q.height + 6, z: q.z })),
      { x: o.cove.x, y: sea + 14, z: o.cove.z },
    ],
    unders: cave ? [(() => {
      const ux = Math.cos(cave.heading), uz = Math.sin(cave.heading), a0 = 3, a1 = cave.length + 2, w = 6;
      const xs = [cave.x + ux * a0 - uz * w, cave.x + ux * a0 + uz * w, cave.x + ux * a1 - uz * w, cave.x + ux * a1 + uz * w], zs = [cave.z + uz * a0 + ux * w, cave.z + uz * a0 - ux * w, cave.z + uz * a1 + ux * w, cave.z + uz * a1 - ux * w];
      return { min: V(Math.min(...xs), caveFloor - 1, Math.min(...zs)), max: V(Math.max(...xs), caveFloor + 8, Math.max(...zs)) };
    })()] : [],
  };
}

/**
 * The land across the water: a coast that stands up from the sea in a line of low cliffs and
 * goes back into hills, and behind them mountains; it fills an arc of the horizon on one side,
 * and the rest is open sea. And the islets between, low humps of rock and turf. Drawn as one
 * sheet in rings about the island, with the far material, and left out wherever it lies under
 * the water.
 */
function layMainland(mesh: MeshBuilder, site: Site, stone: Colour): void {
  const o = site.island!, m = o.mainland, cx = o.x, cz = o.z, sea = o.sea, seed = (o.x * 7.31 + o.z * 3.17) % 97;
  const around = 720, radii: number[] = [];
  for (let r = 240; r <= 3400; r += 4 + (r - 240) * 0.016) radii.push(r);
  const ridge = (x: number, z: number, s: number) => { const v = 1 - Math.abs(fbm2(x, z, 3, s) * 2 - 1); return v * v; };
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x - cx, z - cz), a = Math.atan2(z - cz, x - cx);
    // The mainland's shore: at its distance on its bearing, coming nearer or further in bays and points, and turning away at either end of its arc.
    const off = Math.abs(((a - m.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const shore = m.distance * (1 + 0.12 * (fbm2(a * 3 + seed, 0.5, 3) - 0.5) + 0.05 * Math.sin(a * 9 + seed)) + Math.max(0, off - m.spread) * 2400;
    const inn = r - shore;
    let y = sea - 30;
    if (inn > -60) {
      // Low cliffs and a strand at the water, then rising country, then mountains.
      const lift = smooth((inn + 25) / 60) * (14 + 30 * fbm2(x * 0.004 + seed, z * 0.004, 3));
      const hills = smooth((inn - 80) / 500) * (40 + 260 * ridge(x * 0.0016 + seed, z * 0.0016, 7)) + smooth((inn - 500) / 900) * (200 + 520 * ridge(x * 0.0008 - seed, z * 0.0008, 9));
      y = sea - 30 + smooth((inn + 60) / 70) * 30 + lift + hills;
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
