import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../core/rng';
import { countryAt, crestPoint, galleryRuns, inside, landAt, nearestOn } from '../core/mountain';
import { buildLandmark } from './landmarks';
import { Place, Site } from '../core/site';
import { Kit } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { MeshBuilder } from './geom/meshBuilder';
import { alongSheet, carveRock } from './geom/rock';
import { boulderForm, cliffRelief, erode, Grid2, ROCK, Strata } from './geom/rockForms';
import { layTerrain, turfColour } from './landscape';
import { Colour, growConifer, Planting } from './planting';
import { CardSet } from './scene';
import { anyAngle } from './coast';

/**
 * The mountain top, built from what the site document says of it: its ground, worn and carved
 * into precipices round the rim, crags on the summits and along the ridge; the slopes below
 * going down into the cloud; what people have put on it (the cairn and cross on the summit,
 * poles to mark the way in snow); what little grows; and the peaks far off. It is the
 * counterpart of the island's builder, and takes the valley's approach's place when the site
 * is a mountain.
 *
 * The rock is made as the valley's and the island's are: the plain shape given beds, worn by
 * frost on a lattice of heights, and carved as a solid. What is new is what lies at its foot:
 * not the sea but cloud, which is drawn with the air (see `post.ts`), so nothing below the
 * cloud's top is carved finely or at all. And the season is either summer, when the top is
 * bare rock, scree and thin turf with old snow lying in the hollows, or winter, when snow lies
 * on everything that is not too steep to hold it. The snow is the materials' (see
 * `siteMaterial.ts`); the builder only decides what grows.
 */

export interface MountainBuild {
  site: Site;
  /** The forecourt, which is the mountain's approach place. */
  p: Place;
  kit: Kit;
  wild: Kit;
  rng: Rng;
  planting: Planting;
  cards: CardSet[];
  fences: { min: Vector3; max: Vector3 }[];
  finds: { at: Vector3; what: string }[];
  outerRects: { x0: number; x1: number; z0: number; z1: number }[];
  stoneTint: Colour;
  flag: MasonryStyle;
}

export interface MountainResult {
  spawn: Vector3;
  yaw: number;
  track: [number, number][];
  far: { wood: [number, number, number]; grass: [number, number, number]; sward: [number, number, number]; bare: [number, number, number, number] };
  /** The sea of cloud: the level of its top, how high its billows stand, how broken it is, and the mountain's shape for its shadow on it. */
  deck: NonNullable<import('./scene').SceneDescription['deck']>;
  /** Where birds wheel: off the precipices, below the rim, and about the summit. */
  birds: { x: number; y: number; z: number }[];
  /** Where smoke rises: from the fire in the shelter. */
  smokes: { x: number; y: number; z: number; height: number }[];
  planted: Record<string, number>;
  /** Where the summit's cairn stands, for whatever wants to know where the view is. */
  lookout: { x: number; y: number; z: number; height: number };
  /** Lights: torches on the walls of the gallery way's tunnels, and the fire in the shelter. */
  torches: { position: Vector3; out: Vector3; fire?: number }[];
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

export function buildMountain(b: MountainBuild): MountainResult {
  let __t = performance.now();
  const __T = (label: string) => { if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DBG_T) console.log('  ', label, (performance.now() - __t).toFixed(0), 'ms'); __t = performance.now(); };
  const { site, p, kit, wild } = b;
  const m = site.mountain!, F = p.floor, g = site.grounds!, deck = m.deck;
  const winter = site.setting.season === 'winter';
  const rng = b.rng.fork('mountain');
  const s1 = rng.range(0, 60), s2 = rng.range(0, 60);
  const plain = (x: number, z: number) => landAt(m, F, x, z);
  const rockKind = ROCK[site.setting.stone];
  const strata = new Strata(rockKind, rng.fork('strata'), deck - 40);
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
  const insideOuter = (x: number, z: number, mg = 0) => b.outerRects.some((r) => x > r.x0 - mg && x < r.x1 + mg && z > r.z0 - mg && z < r.z1 + mg);
  const way = m.way ?? [], climb = m.climb ?? [];
  const nearWay = (x: number, z: number, reach: number) => (way.length ? nearestOn(way, x, z, reach).off : Infinity);
  const nearClimb = (x: number, z: number, reach: number) => (climb.length ? nearestOn(climb, x, z, reach).off : Infinity);
  // The gallery way, if there is one: its stretches open to the sky, which are part of the land's shape, and those under the rock, which are carved out of it.
  const gal = m.gallery, runs = gal ? galleryRuns(gal) : { open: [], under: [] };
  const nearOf = (lines: [number, number, number][][], x: number, z: number, reach: number) => {
    let off = Infinity, y = 0;
    for (const line of lines) { const n = nearestOn(line, x, z, reach); if (n.off < off) { off = n.off; y = n.y; } }
    return { off, y };
  };
  const nearOpen = (x: number, z: number, reach: number) => nearOf(runs.open, x, z, reach).off;
  const nearUnder = (x: number, z: number, reach: number) => nearOf(runs.under, x, z, reach);
  /** Nothing below this is drawn, or carved: it is deep enough in the cloud never to be seen. */
  const HIDDEN = deck - 34;

  // ---- the band that is carved: round the rim and the ridge's edges, this far in and out; and wherever the ground inland is steep
  // (Carved at half a metre, where a valley's rim and an island's cliffs are carved at four tenths: there is twice as much rock
  // here, most of it seen from further off, and at four tenths it took a minute and a half to build.)
  const CELL = 0.5, SHEET = 1.25, TILE = 10, IN = 5, OUT = 11;
  const snap = (v: number, up: boolean, to = TILE) => (up ? Math.ceil(v / to - 1e-6) : Math.floor(v / to + 1e-6)) * to;
  const area = { x0: snap(g.x0 - 90, false), x1: snap(g.x1 + 90, true), z0: snap(g.z0 - 90, false), z1: snap(g.z1 + 90, true) };
  const steepAt = (x: number, z: number) => { const y = plain(x, z); return Math.hypot(plain(x + 1.2, z) - y, plain(x, z + 1.2) - y) / 1.2 > 1.05; };
  const inBand = (x: number, z: number) => {
    const d = inside(m, x, z);
    if (d < -OUT || plain(x, z) < HIDDEN) return false;
    // (Wherever a tunnel runs, the rock over it is carved with it, however level the ground above.)
    return d < IN || steepAt(x, z) || (runs.under.length > 0 && nearUnder(x, z, 6).off < 5);
  };
  const tilesX = Math.round((area.x1 - area.x0) / TILE), tilesZ = Math.round((area.z1 - area.z0) / TILE);
  const tiles = new Uint8Array(tilesX * tilesZ);
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    let any = false;
    // (A tile wholly far below the top or far out from it has nothing to carve, and is passed over quickly.)
    const cx = area.x0 + (i + 0.5) * TILE, cz = area.z0 + (j + 0.5) * TILE;
    if (inside(m, cx, cz) < -OUT - TILE) continue;
    for (let z = area.z0 + j * TILE + 0.6; z < area.z0 + (j + 1) * TILE && !any; z += SHEET) for (let x = area.x0 + i * TILE + 0.6; x < area.x0 + (i + 1) * TILE && !any; x += SHEET) any = inBand(x, z);
    tiles[j * tilesX + i] = any ? 1 : 0;
  }
  const carvedTile = (i: number, j: number) => i >= 0 && j >= 0 && i < tilesX && j < tilesZ && tiles[j * tilesX + i] === 1;
  const carved = (x: number, z: number) => {
    const fi = (x - area.x0) / TILE, fj = (z - area.z0) / TILE;
    for (const i of [Math.floor(fi + 1e-6), Math.floor(fi - 1e-6)]) for (const j of [Math.floor(fj + 1e-6), Math.floor(fj - 1e-6)]) if (carvedTile(i, j)) return true;
    return false;
  };

  __T('tiles');
  // ---- the lattice of heights over the band, worn as frost wears a precipice
  const MARGIN = 3.5;
  const land = new Grid2(area.x0 - MARGIN, area.z0 - MARGIN, CELL, Math.round((area.x1 - area.x0 + 2 * MARGIN) / CELL) + 1, Math.round((area.z1 - area.z0 + 2 * MARGIN) / CELL) + 1);
  const known = new Uint8Array(land.data.length), within = new Uint8Array(land.data.length);
  for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
    const x = land.x0 + i * CELL, z = land.z0 + j * CELL, ti = Math.floor((x - area.x0) / TILE), tj = Math.floor((z - area.z0) / TILE);
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) {
      if (!carvedTile(ti + di, tj + dj)) continue;
      const tx0 = area.x0 + (ti + di) * TILE, tz0 = area.z0 + (tj + dj) * TILE;
      near = x > tx0 - MARGIN && x < tx0 + TILE + MARGIN && z > tz0 - MARGIN && z < tz0 + TILE + MARGIN;
    }
    if (!near) continue;
    const k = j * land.nx + i;
    known[k] = 1;
    within[k] = carved(x, z) ? 1 : 0;
    land.data[k] = plain(x, z);
  }
  const loose = land.like(), wornBy = land.like();
  // What has been built or made on the land is not worn: the way, the climb, the cairn's platform.
  const made = (x: number, z: number) => nearWay(x, z, 5) < 4.5 || nearClimb(x, z, 4) < 3.2 || nearOpen(x, z, 4) < 3.4 || (runs.under.length > 0 && nearUnder(x, z, 5).off < 4.4) || (!!m.cairn && Math.hypot(x - m.cairn.x, z - m.cairn.z) < 7);
  {
    const far = new Float32Array(land.data.length), nx = land.nx, nz = land.nz, D1 = CELL, D2 = CELL * Math.SQRT2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) far[j * nx + i] = i > 0 && j > 0 && i < nx - 1 && j < nz - 1 && within[j * nx + i] ? 1e6 : 0;
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k - 1] + D1, far[k - nx] + D1, far[k - nx - 1] + D2, far[k - nx + 1] + D2); }
    for (let j = nz - 2; j > 0; j--) for (let i = nx - 2; i > 0; i--) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k + 1] + D1, far[k + nx] + D1, far[k + nx + 1] + D2, far[k + nx - 1] + D2); }
    const before = land.data.slice(), active = new Uint8Array(land.data.length);
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
      const k = j * land.nx + i, x = land.x0 + i * CELL, z = land.z0 + j * CELL;
      if (!within[k] || far[k] < 0.8 || made(x, z)) continue;
      active[k] = 1;
    }
    // (Frost is harder on a mountain than by the sea or in a dell: more passes, and more of what falls is left lying.)
    erode({
      rock: land, loose, active, repose: 0.7, kept: 0.24, passes: 52,
      holds: (k, y) => {
        const x = land.x0 + (k % land.nx) * CELL, z = land.z0 + Math.floor(k / land.nx) * CELL;
        const hard = strata.hardness(Math.floor(strata.at(x, y, z)));
        return 0.6 + hard * hard * hard * 7;
      },
    });
    for (let k = 0; k < land.data.length; k++) { land.data[k] += loose.data[k]; wornBy.data[k] = land.data[k] - before[k]; }
  }
  const ground = (x: number, z: number): number => (wornBy.holds(x, z) ? plain(x, z) + wornBy.at(x, z) : plain(x, z));

  __T('lattice+erode');
  // ---- steepness, the way uphill, and how far the ground is rock
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
      // (Rock breaks through sooner than on a valley's side: there is little soil up here to cover it.)
      raw[k] = smooth((slope - 0.7) / 0.55) * (1 - smooth(loose.data[k] / 0.3));
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
      // (The paths are cut clean: no broken rock on them.)
      if (known[k] && raw[k] > 0) { const x = land.x0 + (k % nxL) * CELL, z = land.z0 + Math.floor(k / nxL) * CELL; if (nearWay(x, z, 3) < 2.4 || nearClimb(x, z, 3) < 1.7 || nearOpen(x, z, 3) < 2.3) rocky.data[k] = 0;
        // (And about a tunnel the rock is left nearly as the land has it: its breaks, which shift a face a stride or two, would open the tunnel's side or take its floor.)
        else if (runs.under.length && nearUnder(x, z, 4).off < 3.2) rocky.data[k] = Math.min(rocky.data[k], 0.12); }
      const l = Math.hypot(upX.data[k], upZ.data[k]), f = l > 1e-6 ? smooth(l / 0.8) / l : 0;
      upX.data[k] *= f; upZ.data[k] *= f;
    }
  }
  const stepBeds = Math.max(1, Math.round(1.3 / rockKind.bed)), stepped = Math.min(1, rockKind.bedded * 1.4);

  // ---- the land as a solid, as for the valley and the island
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
    const tread = strata.at(x, y, z) / stepBeds + 0.31, wb = tread - Math.floor(tread);
    fine += Math.max(-TREAD_MOST, Math.min(TREAD_MOST, ((wb - 0.5) * stepBeds * rockKind.bed) / spot.slope)) * stepped;
    out += Math.max(-FINE_MOST, Math.min(FINE_MOST, fine));
    out *= spot.rocky;
    const sx = x + out * spot.ux, sz = z + out * spot.uz;
    return (y - land.at(sx, sz)) / steepness.at(sx, sz);
  };

  // ---- the tunnels of the gallery way: air under the rock, along the way's line, a stride and a half
  // to either side and arched over a man's head, uneven as hewn rock is; and its windows, each a short
  // passage out through the face from the height of a parapet up.
  const tunnelBox = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const run of runs.under) for (const [x, z] of run) { tunnelBox.x0 = Math.min(tunnelBox.x0, x - 13); tunnelBox.x1 = Math.max(tunnelBox.x1, x + 13); tunnelBox.z0 = Math.min(tunnelBox.z0, z - 13); tunnelBox.z1 = Math.max(tunnelBox.z1, z + 13); }
  const windows = gal?.windows ?? [];
  const bore = { x: NaN, z: NaN, off: Infinity, floor: 0, wide: 1.35, high: 2.8, near: [] as typeof windows };
  const tunnelAir = (x: number, y: number, z: number): number => {
    if (x < tunnelBox.x0 || x > tunnelBox.x1 || z < tunnelBox.z0 || z > tunnelBox.z1) return -9;
    if (x !== bore.x || z !== bore.z) {
      bore.x = x; bore.z = z;
      const n = nearUnder(x, z, 5);
      // (Its floor is the way's own level there, taken from the whole of the way's line and not from the tunnel's stretch of it:
      // at a mouth the way goes on climbing, and a floor held at the level of the tunnel's last point cut a pit across it.)
      bore.off = n.off; bore.floor = n.off < 4 ? nearestOn(gal!.line, x, z, 5).y : n.y;
      if (n.off < 4) { bore.wide = 1.3 + (fbm2(x * 0.31 + s1, z * 0.31, 2) - 0.5) * 0.5; bore.high = 2.75 + (fbm2(x * 0.27, z * 0.27 + s2, 2) - 0.5) * 0.7; }
      bore.near = windows.filter((w) => Math.abs(x - w.x) < w.reach + 1.5 && Math.abs(z - w.z) < w.reach + 1.5);
    }
    let air = -9;
    if (bore.off < 4) air = Math.min(bore.wide - bore.off, y - bore.floor, bore.floor + bore.high - (bore.off / bore.wide) ** 2 * 0.9 - y);
    for (const w of bore.near) {
      const ox = Math.cos(w.out), oz = Math.sin(w.out), t = Math.min(w.reach, Math.max(0, (x - w.x) * ox + (z - w.z) * oz));
      const side = Math.hypot(x - w.x - ox * t, z - w.z - oz * t), up = (y - (w.y + 0.8)) / 0.85;
      air = Math.max(air, 0.85 * (1 - Math.hypot(side / 0.85, up)));
    }
    return air;
  };
  const density = runs.under.length ? (x: number, y: number, z: number) => Math.max(landAir(x, y, z), tunnelAir(x, y, z)) : landAir;
  /** How far inside a tunnel a point is from daylight, 0 at its mouths and by its windows, 1 deep in: for how dark the rock is there. */
  const shut = runs.under.map((run) => run.map(([x, z], k) => {
    let light = Math.min(k, run.length - 1 - k) * 2;
    for (const w of windows) light = Math.min(light, Math.hypot(x - w.x, z - w.z));
    return [x, z, smooth((light - 1.5) / 9)] as [number, number, number];
  }));
  // (Per tile of the carving: how low the tunnels under it go, so that the piece is made deep enough to hold them.)
  const tileLow = new Float32Array(tilesX * tilesZ).fill(Infinity);
  for (const run of runs.under) for (const [x, z, y] of run) {
    for (let j = Math.floor((z - 4.5 - area.z0) / TILE); j <= Math.floor((z + 4.5 - area.z0) / TILE); j++) for (let i = Math.floor((x - 4.5 - area.x0) / TILE); i <= Math.floor((x + 4.5 - area.x0) / TILE); i++) {
      if (i >= 0 && j >= 0 && i < tilesX && j < tilesZ) tileLow[j * tilesX + i] = Math.min(tileLow[j * tilesX + i], y - 1.6);
    }
  }

  // ---- colours: of rock high up, and of what ground there is on the top
  const tint = b.stoneTint;
  const outcrop: Colour = [0.5 + 0.5 * tint[0], 0.52 + 0.5 * tint[1], 0.56 + 0.5 * tint[2]];
  const rockColour = (tone: number): Colour => [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
  const blotSeed = rng.fork('blot').int(1, 9999);
  const mixC = (c: Colour, to: Colour, t: number) => { c[0] += (to[0] - c[0]) * t; c[1] += (to[1] - c[1]) * t; c[2] += (to[2] - c[2]) * t; };
  /**
   * Rock high on a mountain. Each bed has its shade, with broad stains over it, as in the valley.
   * Nothing grows on it but lichens: the yellow-green map lichen in round patches on faces that
   * take the weather, black where water runs down, and here and there the rusty orange that grows
   * where birds perch. No moss: it is too dry and too cold.
   */
  const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number): Colour => {
    const i = Math.floor(strata.at(q.x, q.y, q.z));
    const t = strata.shade(i), soft = 1 - strata.hardness(i);
    const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed);
    const c = rockColour((0.74 + 0.56 * blot) * (0.7 + 0.3 * open));
    const pale = rockKind.pale, dark = rockKind.dark;
    c[0] *= dark[0] + (pale[0] - dark[0]) * t; c[1] *= dark[1] + (pale[1] - dark[1]) * t; c[2] *= dark[2] + (pale[2] - dark[2]) * t;
    const up = Math.max(0, n.y);
    const patch = fbm3(q.x * 0.35 + 3, q.y * 0.35, q.z * 0.35, 3, blotSeed + 11), fleck = fbm3(q.x * 1.3, q.y * 1.3, q.z * 1.3, 2, blotSeed + 5);
    const lichen = smooth((patch - 0.52) / 0.08) * (0.35 + 0.65 * open);
    mixC(c, fleck > 0.6 ? [0.5, 0.26, 0.07] : fleck > 0.42 ? [0.42, 0.45, 0.2] : [0.1, 0.1, 0.09], lichen * 0.55);
    // Dark streaks down the steep faces, where melt water runs.
    const streak = smooth((fbm2(q.x * 0.9 + q.z * 0.9, q.y * 0.04, 2, blotSeed + 3) - 0.6) / 0.08) * (1 - up);
    mixC(c, [c[0] * 0.45, c[1] * 0.45, c[2] * 0.47], streak * 0.6);
    // (No moss; a little damp in what does not see the sky.)
    field[0] = 0;
    field[1] = 0.15 * soft * (1 - open);
    // (What is under a roof of rock: no snow lies on it.)
    field[2] = 0;
    field[3] = 0.25 + 0.75 * rockKind.bedded;
    // In a tunnel it is dark, the darker the further from its mouths and its windows; and a little damp.
    if (runs.under.length && tunnelAir(q.x, q.y, q.z) > -0.6) {
      const dim = 1 - 0.8 * nearOf(shut, q.x, q.z, 5).y;
      c[0] *= dim; c[1] *= dim; c[2] *= dim;
      field[1] = Math.max(field[1], 0.3); field[2] = 1;
    }
    return c;
  };

  // The way and the climb, as how far a point lies to one side of each, on a lattice over the top.
  const track = site.track ?? [];
  const ways = new Grid2(snap(g.x0 - 10, false, 1), snap(g.z0 - 10, false, 1), 0.5, Math.round((g.x1 - g.x0 + 20) / 0.5) + 2, Math.round((g.z1 - g.z0 + 20) / 0.5) + 2);
  const foot = ways.like();
  {
    ways.data.fill(99); foot.data.fill(8);
    const lines = [{ points: track, track: true }, ...(site.paths ?? []).map((q) => ({ points: q.points, track: false }))];
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
    if (x > p.x0 && x < p.x1 && z < p.z1 - 6) return 99;
    return ways.data[Math.round((z - ways.z0) / 0.5) * ways.nx + Math.round((x - ways.x0) / 0.5)];
  };
  const offFoot = (x: number, z: number) => (foot.holds(x, z) ? foot.at(x, z) : 8);
  /** How sheltered a hollow a point lies in, from 0 on a crest to 1 deep in a hollow: where turf holds, and where old snow lies longest. */
  const hollowAt = (x: number, z: number): number => {
    const y = plain(x, z);
    let around = 0;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; around += plain(x + Math.cos(a) * 7, z + Math.sin(a) * 7); }
    return smooth((around / 6 - y) / 1.6 + 0.5);
  };
  const lay = { track: 0, wet: 0, bare: 0 };
  /**
   * What the ground is on the top. Very little of it is turf: a thin brown sward of grasses
   * and cushions in the hollows and on the gentler slopes, and between them stony ground and
   * gravel that frost keeps moving. Bare where stones have come down.
   */
  const turfAt = (x: number, z: number): Colour => {
    const hollow = hollowAt(x, z), patch = fbm2(x * 0.07 + s2, z * 0.07 - s1, 3), fine = fbm2(x * 0.3 - s1, z * 0.3, 2);
    let bare = smooth((0.5 - hollow * 0.55 - patch * 0.4 + fine * 0.2) / 0.32);
    bare = Math.max(bare, loose.holds(x, z) ? smooth(loose.at(x, z) / 0.22) : 0);
    // (Nothing grows on the ledges of the precipices below the top: they are rock and what has fallen on them.)
    bare = Math.max(bare, smooth((-inside(m, x, z) - 1.5) / 3));
    // (And barer the higher it stands: the summits are stone.)
    bare = Math.max(bare, smooth((plain(x, z) - F - 22) / 14));
    lay.bare = Math.min(1, bare); lay.wet = 0.12 * hollow;
    const off = trackOff(x, z), f = offFoot(x, z);
    // (Nothing on wheels comes up here: the way is a path, worn by feet and hooves, broader than a footpath and without ruts.)
    lay.track = Math.min(Math.abs(off) * 0.42, f) < 3 ? 200 + Math.min(Math.abs(off) * 0.42, f) : 0;
    const c = turfColour(x, z, s1);
    // Thin turf, browned by sun and wind: less green than a valley's by a good deal.
    return [c[0] * 1.0, c[1] * 0.78, c[2] * 0.68];
  };
  const earth = (x: number, z: number): Colour => {
    const t = 0.66 + 0.5 * fbm2(x * 0.5 + s2, z * 0.5 + s1, 3);
    return [0.52 * t * outcrop[0], 0.5 * t * outcrop[1], 0.47 * t * outcrop[2]];
  };

  __T('fields');
  // ---- carving: each tile of the band as a piece, only as tall as its own ground needs
  const sheetEdge = alongSheet(ground, area.x0, area.z0, SHEET);
  wild.group = 'wild';
  const turfMesh = wild.mesh('turf'), screeMesh = wild.mesh('scree'), rockMesh = wild.mesh('rock');
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    if (!tiles[j * tilesX + i]) continue;
    const c = { x0: area.x0 + i * TILE, x1: area.x0 + (i + 1) * TILE, z0: area.z0 + j * TILE, z1: area.z0 + (j + 1) * TILE };
    let lo = Infinity, hi = -Infinity;
    const REACH = 4.5;
    for (let z = c.z0 - REACH; z < c.z1 + REACH + CELL / 2; z += CELL) for (let x = c.x0 - REACH; x < c.x1 + REACH + CELL / 2; x += CELL) { const h = land.at(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi < HIDDEN) continue;
    lo = Math.min(lo, tileLow[j * tilesX + i]);
    carveRock(rockMesh, density, {
      // (Not below what the cloud hides: there the rock is closed off flat.)
      min: V(c.x0, Math.floor(Math.max(lo - 2, HIDDEN) / CELL) * CELL, c.z0), max: V(c.x1, Math.ceil((hi + 2.8) / CELL) * CELL, c.z1),
      cell: CELL, uvScale: 0.4, otherUvScale: (mm) => (mm === screeMesh ? 0.55 : 2.3), fromSamples: true, occlusion: [0.3, 0.75], sharp: true, beyond: carved, edge: sheetEdge,
      // (A tunnel's floor is the rock it was cut in, whatever the ground is over it.)
      meshFor: (n, at) => (n.y > 0.74 && rocky.at(at.x, at.z) < 0.5 && !(runs.under.length && tunnelAir(at.x, at.y + 0.6, at.z) > 0) ? (loose.at(at.x, at.z) > 0.25 ? screeMesh : turfMesh) : null),
      shade: (q, n, field, other, open) => {
        if (other === turfMesh) { const col = turfAt(q.x, q.z); field[0] = lay.track; field[1] = lay.wet; field[2] = lay.bare; return col; }
        if (other === screeMesh) return earth(q.x, q.z);
        return shadeRock(q, n, field, open);
      },
    });
  }

  __T('carve');
  // ---- boulders: fallen from the crags and the precipices' tops, and left by frost all over the top
  const lying: [number, number, number][] = [];
  const layBoulder = (x: number, z: number, size: number, q: Rng, sunk = [0.15, 0.5]) => {
    const y = ground(x, z);
    const form = boulderForm(q.fork(`b${lying.length}`), size, rockKind), cy = y + form.half * q.range(sunk[0], sunk[1]), cell = Math.min(0.26, Math.max(0.1, size * 0.13));
    let low = y;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) low = Math.min(low, ground(x + dx * form.reach, z + dz * form.reach));
    carveRock(rockMesh, (qx, qy, qz) => form.density(qx - x, qy - cy, qz - z), {
      min: V(x - form.reach, Math.max(low - 1, cy - form.sink), z - form.reach), max: V(x + form.reach, cy + form.rise, z + form.reach),
      cell, uvScale: 0.5, fromSamples: true, occlusion: [cell * 2, Math.max(cell * 3, size * 0.45)], sharp: true,
      shade: (pt, n, field, _o, open) => shadeRock(pt, n, field, open),
    });
    lying.push([x, z, size]);
  };
  // (First about the landings on the climb: a few big stones at the rim of each, where the ridge breaks away; then elsewhere.)
  for (const [i, l] of (m.landings ?? []).entries()) {
    const q = rng.fork(`landing boulders ${i}`);
    for (let k = 0, tries = 0; k < 4 && tries < 40; tries++) {
      const a = l.out + q.range(-1.4, 1.4), d = l.r + q.range(0.2, 1.6), x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d, size = q.range(0.8, 2.1);
      if (nearClimb(x, z, 6) < size + 1.6 || lying.some(([bx, bz, bs]) => Math.hypot(bx - x, bz - z) < bs + size + 0.4)) continue;
      layBoulder(x, z, size, q); k++;
    }
  }
  {
    const q = rng.fork('boulders');
    for (let tries = 0; tries < 1400 && lying.length < 70; tries++) {
      const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1), d = inside(m, x, z);
      if (d < 2 || insideOuter(x, z, 4) || x > m.level.x0 - 2 && x < m.level.x1 + 2 && z > m.level.z0 - 2 && z < m.level.z1 + 2) continue;
      if (nearWay(x, z, 6) < 4 || nearClimb(x, z, 5) < 3 || nearOpen(x, z, 5) < 3.5 || (m.cairn && Math.hypot(x - m.cairn.x, z - m.cairn.z) < 7)) continue;
      // (More under the crags, where they fall, than out on the open top.)
      const under = rocky.holds(x, z) ? rocky.at(x, z) : 0;
      if (under > 0.5 || (under < 0.05 && !q.chance(0.35))) continue;
      const size = q.range(0.5, under > 0.05 ? 2.4 : 1.4);
      if (lying.some(([bx, bz, bs]) => Math.hypot(bx - x, bz - z) < bs + size + 0.6)) continue;
      layBoulder(x, z, size, q);
    }
  }

  __T('boulders');
  // ---- the sheet of ground over all that is not carved, out and down as far as the cloud lets it be seen
  // (The sheet asks for the height of each of its corners four times over, once for each square that shares it, and four more
  // times round each for the way it slopes: heights are kept as they are worked out.)
  const kept = new Map<number, number>();
  const groundKept = (x: number, z: number): number => {
    const key = (Math.round(x * 16) + 1048576) * 2097152 + Math.round(z * 16) + 1048576;
    let y = kept.get(key);
    if (y === undefined) kept.set(key, (y = ground(x, z)));
    return y;
  };
  layTerrain(turfMesh, rockMesh, groundKept, {
    area, cell: SHEET, seed: s1, stone: tint, turfScale: 2.3, rockScale: 0.4, bare: 0.62,
    colour: (x, z) => { const c = turfAt(x, z); return [c[0], c[1], c[2], lay.track, lay.wet, lay.bare, 0]; },
    rock: (tone) => rockColour(tone * 0.8),
    skip: (c) => {
      const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
      if (insideOuter(mx, mz)) return true;
      // (Quickly: what is well out beyond the edge is far down, under the cloud.)
      if (inside(m, mx, mz) < -150) return true;
      // (Its middle settles most squares; only those near the level the cloud hides need their corners looked at.)
      const mid = groundKept(mx, mz), isCarved = carved(mx, mz);
      if (mid < HIDDEN - 20 || (isCarved && mid > HIDDEN + 6)) return true;
      if (!isCarved && mid > HIDDEN) return false;
      const top = Math.max(groundKept(c.x0, c.z0), groundKept(c.x1, c.z0), groundKept(c.x0, c.z1), groundKept(c.x1, c.z1));
      return top < HIDDEN - 8 || (isCarved && top > HIDDEN + 0.5);
    },
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

  // The forecourt: flags from the door to where the way begins, baked with the house.
  kit.group = `p${p.id}`;
  {
    const doorX = track.length ? track[0][0] : (p.x0 + p.x1) / 2;
    for (let z = p.z0 + 0.05; z < p.z1 - 5.5; z += 1.5) kit.slab('floor', doorX - 1.15, z, doorX + 1.15, z + 1.5, F + 0.012, { ...b.flag, course: [0.6, 0.8], length: [0.7, 1.2] });
    kit.mass(V(p.x0 - 3, F - 5, p.z0), V(p.x1 + 3, F - 3.2, p.z1 + 3));
  }

  __T('sheet');
  // ---- what people have put up here
  wild.group = 'wild';
  const { solid } = anyAngle((mm) => wild.mesh(mm));
  const stone: Colour = [0.74 * tint[0], 0.72 * tint[1], 0.69 * tint[2]];
  const timber: Colour = [0.52, 0.42, 0.33];
  /** A block standing on end about a point, turned to `yaw`, `w` by `d` and `h` high, its foot at `y`; it may lean a little. */
  const block = (material: string, x: number, y: number, z: number, w: number, d: number, h: number, yaw: number, colour: Colour, lean = [0, 0]) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (a: number, f: number, up: number): [number, number, number] => [x + c * a - s * f + lean[0] * up, y + up, z + s * a + c * f + lean[1] * up];
    solid(material, [at(-w / 2, -d / 2, 0), at(w / 2, -d / 2, 0), at(w / 2, d / 2, 0), at(-w / 2, d / 2, 0), at(-w / 2, -d / 2, h), at(w / 2, -d / 2, h), at(w / 2, d / 2, h), at(-w / 2, d / 2, h)], colour);
  };
  /** A cairn: stones laid in rings, each ring smaller and set in the hollows of the one under it, to a point. */
  const cairn = (x: number, z: number, high: number, q: Rng) => {
    const y = ground(x, z) - 0.15;
    let up = 0, course = 0;
    while (up < high) {
      const k = up / high, r = (1 - k) * high * 0.42 + 0.12, ring = Math.max(1, Math.round((r * Math.PI * 2) / 0.55)), size = 0.42 - 0.18 * k;
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2 + course * 0.7 + q.range(-0.15, 0.15), sx = size * q.range(0.85, 1.25), sz = size * q.range(0.7, 1.05), sy = size * q.range(0.45, 0.7);
        // (A stone as it was picked up: no face square to another, narrower above than below, sitting a little askew.)
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r, yaw = a + q.range(-0.5, 0.5), c = Math.cos(yaw), sn = Math.sin(yaw), tilt = [q.range(-0.12, 0.12), q.range(-0.12, 0.12)];
        const at = (u: number, v: number, h: number): [number, number, number] => [cx + c * u - sn * v, y + up + h + u * tilt[0] + v * tilt[1], cz + sn * u + c * v];
        const tw = q.range(0.55, 0.9), ox = q.range(-0.1, 0.1) * sx, oz = q.range(-0.1, 0.1) * sz;
        solid('rock', [at(-sx / 2, -sz / 2, 0), at(sx / 2, -sz / 2, 0), at(sx / 2, sz / 2, 0), at(-sx / 2, sz / 2, 0),
          at((-sx / 2) * tw + ox, (-sz / 2) * tw + oz, sy * q.range(0.8, 1)), at((sx / 2) * tw + ox, (-sz / 2) * tw + oz, sy), at((sx / 2) * tw + ox, (sz / 2) * tw + oz, sy * q.range(0.75, 1)), at((-sx / 2) * tw + ox, (sz / 2) * tw + oz, sy * q.range(0.85, 1))], rockColour(q.range(0.85, 1.45)), 0.4);
      }
      up += size * 0.5; course++;
    }
  };
  const lookout = { x: m.cairn?.x ?? m.x, y: m.cairn?.y ?? F, z: m.cairn?.z ?? m.z, height: (m.cairn?.y ?? F) - deck };
  if (m.cairn) {
    // The summit: a great cairn, and beside it a cross of timber, braced and bound with iron.
    const c = m.cairn, q = rng.fork('summit');
    cairn(c.x, c.z, 2.1, q);
    const toHouse = Math.atan2((m.level.z0 + m.level.z1) / 2 - c.z, (m.level.x0 + m.level.x1) / 2 - c.x);
    const cx = c.x + Math.cos(toHouse + 1.4) * 2.1, cz = c.z + Math.sin(toHouse + 1.4) * 2.1, cy = ground(cx, cz);
    // (The arm faces the house below, as a summit cross faces the valley it was carried up from.)
    const face = toHouse + Math.PI / 2;
    block('wood', cx, cy - 0.4, cz, 0.18, 0.16, 4.3, face, timber);
    block('wood', cx + Math.cos(face) * -0.85, cy + 2.95, cz + Math.sin(face) * -0.85, 0.16, 0.14, 0.17, face, timber);
    for (let k = -4; k <= 4; k++) block('wood', cx + Math.cos(face) * k * 0.2, cy + 2.95, cz + Math.sin(face) * k * 0.2, 0.2, 0.14, 0.17, face, timber);
    block('metal', cx, cy + 2.88, cz, 0.22, 0.2, 0.32, face, [0.2, 0.19, 0.18]);
    // A stone base round its foot.
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; block('rock', cx + Math.cos(a) * 0.38, cy - 0.1, cz + Math.sin(a) * 0.38, 0.34, 0.26, 0.32, a, stone); }
    // And somebody left a spyglass by the cairn, for the view.
    const fx = c.x + Math.cos(toHouse) * 1.2, fz = c.z + Math.sin(toHouse) * 1.2;
    b.finds.push({ at: V(fx, ground(fx, fz) + 0.35, fz), what: 'a brass spyglass in a leather case, left by the cairn on the summit' });
  }
  // Poles beside the way, a few strides apart, for finding it when snow lies over it or the cloud is down: posts of larch with their tops painted.
  {
    const q = rng.fork('poles');
    let since = 0;
    for (let k = 1; k < way.length; k++) {
      since += Math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]);
      if (since < 13 || way[k][1] < p.z1 + 6) continue;
      since = 0;
      const [x0, z0] = way[k - 1], [x1, z1] = way[k], l = Math.hypot(x1 - x0, z1 - z0) || 1, side = k % 2 ? 1 : -1;
      const px = x1 - ((z1 - z0) / l) * 2.1 * side, pz = z1 + ((x1 - x0) / l) * 2.1 * side, y = ground(px, pz);
      if (y < way[k][2] - 1.5) continue;
      const lean = [q.range(-0.04, 0.04), q.range(-0.04, 0.04)], tall = q.range(2.1, 2.5);
      block('wood', px, y - 0.3, pz, 0.09, 0.09, tall - 0.4, q.range(0, 3), timber, lean);
      block('wood', px + lean[0] * (tall - 0.7), y - 0.3 + tall - 0.7, pz + lean[1] * (tall - 0.7), 0.095, 0.095, 0.4, q.range(0, 3), [0.62, 0.1, 0.06], lean);
    }
    // And at the head of the ridge and at its foot, cairns, as every way over the hills is marked.
    for (const t of [0.04, 0.97]) {
      const { x, z } = crestPoint(m, t);
      const n = nearestOn(way, x, z, 40);
      if (!Number.isFinite(n.off)) continue;
      // (Beside the way, not on it.)
      let best: [number, number] | null = null;
      for (let k = 0; k < 12 && !best; k++) { const a = (k / 12) * Math.PI * 2, cx = x + Math.cos(a) * 4, cz = z + Math.sin(a) * 4; if (nearWay(cx, cz, 6) > 3.2 && inside(m, cx, cz) > 3) best = [cx, cz]; }
      if (best) cairn(best[0], best[1], 1.3, q.fork(`c${t}`));
    }
  }

  // The bell tower beside the forecourt: a square shaft of coursed stone, a little narrower at each string course; an open stage at
  // the top, an arch in each face with the bell hanging within; a steep four-sided roof of slate and a cross. The hospice's own
  // roofs are low; this is what is seen of it from the ridge and from the summit, and in cloud its bell is what brings people in.
  if (m.belfry) {
    const bf = m.belfry, q = rng.fork('belfry');
    type P3 = [number, number, number];
    const tone = (k = 1): Colour => { const t = q.range(0.84, 1.05) * k; return [stone[0] * t, stone[1] * t, stone[2] * t]; };
    const box = (material: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: Colour) =>
      solid(material, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]].map(([x, y, z]) => [bf.x + x, bf.y + y, bf.z + z] as P3), colour);
    const H = bf.height, STAGE = 2.9;
    // The shaft, in three lifts, each set in a hand's breadth, with a string course between.
    let half = 1.75, y = -0.8;
    for (let lift = 0; lift < 3; lift++) {
      const top = lift === 2 ? H - STAGE : -0.8 + ((H - STAGE + 0.8) * (lift + 1)) / 3;
      for (; y < top - 0.01;) { const tall = Math.min(0.5, top - y); box('stone', -half, half, y, y + tall, -half, half, tone()); y += tall; }
      if (lift < 2) { box('stone', -half - 0.07, half + 0.07, y - 0.14, y, -half - 0.07, half + 0.07, tone(1.06)); half -= 0.1; }
    }
    // A door at its foot towards the forecourt (shut: a leaf of boards in a stone frame), and a slit in each lift.
    box('wood', -0.5, 0.5, 0, 2.0, -1.78, -1.7, [timber[0] * 0.8, timber[1] * 0.8, timber[2] * 0.8]);
    box('stone', -0.68, 0.68, 2.0, 2.26, -1.82, -1.7, tone(1.05));
    for (const yy of [H * 0.38, H * 0.6]) box('wood', -0.09, 0.09, yy, yy + 0.95, -1.71, -1.6, [0.05, 0.05, 0.05]);
    // The bell stage: a floor, four corner piers, a lintel course over each opening, a cornice.
    const b0 = H - STAGE, hb = half;
    box('stone', -hb - 0.1, hb + 0.1, b0 - 0.16, b0, -hb - 0.1, hb + 0.1, tone(1.06));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('stone', sx * hb - (sx > 0 ? 0.55 : 0), sx * hb + (sx > 0 ? 0 : 0.55), b0, b0 + STAGE - 0.5, sz * hb - (sz > 0 ? 0.55 : 0), sz * hb + (sz > 0 ? 0 : 0.55), tone());
    box('stone', -hb, hb, b0 + STAGE - 0.5, b0 + STAGE, -hb, hb, tone());
    box('stone', -hb - 0.16, hb + 0.16, b0 + STAGE, b0 + STAGE + 0.16, -hb - 0.16, hb + 0.16, tone(1.08));
    // (A low parapet in each opening.)
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) box('stone', ax ? ax * hb - (ax > 0 ? 0.3 : 0) : -hb + 0.55, ax ? ax * hb + (ax > 0 ? 0 : 0.3) : hb - 0.55, b0, b0 + 0.85, az ? az * hb - (az > 0 ? 0.3 : 0) : -hb + 0.55, az ? az * hb + (az > 0 ? 0 : 0.3) : hb - 0.55, tone(0.96));
    // The bell, on a timber headstock.
    box('wood', -hb + 0.3, hb - 0.3, b0 + STAGE - 0.78, b0 + STAGE - 0.56, -0.1, 0.1, [timber[0] * 0.7, timber[1] * 0.7, timber[2] * 0.7]);
    const bronze: Colour = [0.34, 0.26, 0.12];
    for (const [r, h0, h1] of [[0.2, 1.55, 2.1], [0.3, 1.2, 1.56], [0.4, 0.98, 1.21]] as const) box('metal', -r, r, b0 + h0, b0 + h1, -r, r, bronze);
    // The roof: four slopes of slate to a point, and the cross.
    const r0 = b0 + STAGE + 0.16, e = hb + 0.3, tip: P3 = [bf.x, bf.y + r0 + 3.4, bf.z], slate: Colour = [0.3, 0.32, 0.36];
    const corner = (sx: number, sz: number): P3 => [bf.x + sx * e, bf.y + r0, bf.z + sz * e];
    const { face } = anyAngle((mm) => wild.mesh(mm));
    for (const [c0, c1] of [[corner(-1, -1), corner(1, -1)], [corner(1, -1), corner(1, 1)], [corner(1, 1), corner(-1, 1)], [corner(-1, 1), corner(-1, -1)]]) face('slate', [c0, c1, tip], slate, [bf.x, bf.y + r0 + 0.5, bf.z]);
    face('slate', [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], slate, [bf.x, bf.y + r0 + 0.5, bf.z]);
    block('metal', tip[0], tip[1] - 0.1, tip[2], 0.05, 0.05, 1.0, 0, [0.15, 0.14, 0.13]);
    block('metal', tip[0], tip[1] + 0.55, tip[2], 0.5, 0.05, 0.05, 0, [0.15, 0.14, 0.13]);
  }
  // The bridge over the cleft in the ridge: two great bearers of larch from lip to lip, braced from below against the rock on
  // either side; a deck of planks laid across them; posts and two rails on each hand. It is walked on.
  if (m.bridge) {
    const br = m.bridge, q = rng.fork('bridge'), [ax, az, ay] = br.a, [bx, bz, by] = br.b, len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len, half = br.width / 2;
    type P3 = [number, number, number];
    // (In the bridge's own terms: `f` along it from its first end, `a` across, `h` above the deck.)
    const at = (f: number, a: number, h: number): P3 => [ax + ux * f - uz * a, ay + (by - ay) * (f / len) + h, az + uz * f + ux * a];
    const boxOf = (material: string, f0: number, f1: number, a0: number, a1: number, h0: number, h1: number, colour: Colour) =>
      solid(material, [at(f0, a0, h0), at(f1, a0, h0), at(f1, a1, h0), at(f0, a1, h0), at(f0, a0, h1), at(f1, a0, h1), at(f1, a1, h1), at(f0, a1, h1)], colour);
    const wood = (k = 1): Colour => { const t = q.range(0.78, 1.08) * k; return [timber[0] * t, timber[1] * t, timber[2] * t]; };
    const beam = (p0: P3, p1: P3, t: number, colour: Colour) => {
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1, px = (-dz / l) * t, pz = (dx / l) * t;
      solid('wood', [[p0[0] - px, p0[1] - t, p0[2] - pz], [p0[0] + px, p0[1] - t, p0[2] + pz], [p1[0] + px, p1[1] - t, p1[2] + pz], [p1[0] - px, p1[1] - t, p1[2] - pz], [p0[0] - px, p0[1] + t, p0[2] - pz], [p0[0] + px, p0[1] + t, p0[2] + pz], [p1[0] + px, p1[1] + t, p1[2] + pz], [p1[0] - px, p1[1] + t, p1[2] - pz]], colour);
    };
    // The bearers, their ends let into the rock; and a tie across under the deck at each third.
    for (const a of [-half + 0.32, half - 0.32]) boxOf('wood', -1.2, len + 1.2, a - 0.17, a + 0.17, -0.5, -0.09, wood(0.85));
    for (const f of [len / 3, (len * 2) / 3]) boxOf('wood', f - 0.12, f + 0.12, -half - 0.25, half + 0.25, -0.72, -0.5, wood(0.8));
    // Struts: from the rock some way down each wall of the cleft up to the bearers at their thirds.
    for (const a of [-half + 0.32, half - 0.32]) for (const [f0, f1] of [[0.9, len / 3], [len - 0.9, (len * 2) / 3]]) {
      const foot = at(f0, a, -0.5), down = Math.min(4.2, len * 0.3);
      beam([foot[0], foot[1] - down, foot[2]], at(f1, a, -0.55), 0.11, wood(0.8));
    }
    // The deck: planks side by side, no two quite alike, their ends not in a line.
    for (let f = -0.6; f < len + 0.6;) {
      const w = q.range(0.22, 0.32), o0 = q.range(0, 0.1), o1 = q.range(0, 0.1);
      boxOf('wood', f, f + w - 0.012, -half - o0, half + o1, -0.09, 0, wood());
      f += w;
    }
    // Posts and rails.
    for (const side of [-1, 1]) {
      const a = side * (half - 0.07);
      const n = Math.max(3, Math.round(len / 1.7));
      for (let k = 0; k <= n; k++) { const f = (len * k) / n; boxOf('wood', f - 0.06, f + 0.06, a - 0.06, a + 0.06, -0.3, 1.12, wood(0.9)); }
      beam(at(-0.2, a, 1.06), at(len + 0.2, a, 1.06), 0.05, wood(0.95));
      beam(at(-0.2, a, 0.56), at(len + 0.2, a, 0.56), 0.04, wood(0.9));
      // (And nobody goes over the side: what stops them is here, since the fences of the mountain's edge do not know a bridge.)
      for (let f = 0; f <= len; f += 0.45) { const [x, y, z] = at(f, side * (half + 0.2), 0); b.fences.push({ min: V(x - 0.24, y - 3, z - 0.24), max: V(x + 0.24, F + 160, z + 0.24) }); }
    }
  }
  // The gateway at the head of the ridge: two piers of squared stone, a round arch turned over the way, a wall above it stepped up to
  // a coping, and an iron cross on that. It stands on the skyline for whoever is coming up the ridge, and frames the top for them when they reach it.
  if (m.gate) {
    const gt = m.gate, q = rng.fork('gate'), fx = Math.cos(gt.heading), fz = Math.sin(gt.heading), y0 = Math.min(gt.y, ground(gt.x, gt.z)) - 0.3;
    type P3 = [number, number, number];
    // (In the gateway's own terms: `a` across the way, `f` along it, `h` up from the way's level.)
    const at = (a: number, f: number, h: number): P3 => [gt.x - fz * a + fx * f, gt.y + h, gt.z + fx * a + fz * f];
    const tone = () => { const t = q.range(0.82, 1.06); return [stone[0] * t, stone[1] * t, stone[2] * t] as Colour; };
    const CLEAR = 1.55, PIER = 1.0, SPRING = 2.35, DEEP = 0.55;
    for (const side of [-1, 1]) {
      // A pier, in courses; its foot goes down into the ground however that lies.
      let h = y0 - gt.y - 1.2;
      for (let course = 0; h < SPRING; course++) {
        const tall = course === 0 ? SPRING - Math.floor((SPRING - h) / 0.42) * 0.42 - h || 0.42 : 0.42, grow = course === 0 ? 0.12 : 0;
        const a0 = side * (CLEAR - grow), a1 = side * (CLEAR + PIER + grow);
        solid('stone', [at(a0, -DEEP - grow, h), at(a1, -DEEP - grow, h), at(a1, DEEP + grow, h), at(a0, DEEP + grow, h), at(a0, -DEEP - grow, h + tall), at(a1, -DEEP - grow, h + tall), at(a1, DEEP + grow, h + tall), at(a0, DEEP + grow, h + tall)], tone());
        h += tall;
      }
      // The wall over the arch on this side, stepped up towards the middle.
      for (const [a0, a1, h0, h1] of [[CLEAR + 0.2, CLEAR + PIER, SPRING, SPRING + 1.5], [0.9, CLEAR + 0.2, SPRING + 1.1, SPRING + 2.25]] as const) {
        solid('stone', [at(side * a0, -DEEP * 0.86, h0), at(side * a1, -DEEP * 0.86, h0), at(side * a1, DEEP * 0.86, h0), at(side * a0, DEEP * 0.86, h0), at(side * a0, -DEEP * 0.86, h1), at(side * a1, -DEEP * 0.86, h1), at(side * a1, DEEP * 0.86, h1), at(side * a0, DEEP * 0.86, h1)], tone());
      }
    }
    // The arch: nine stones cut to the curve, the middle one the key.
    for (let k = 0; k < 9; k++) {
      const t0 = (k / 9) * Math.PI, t1 = ((k + 1) / 9) * Math.PI, ri = CLEAR, ro = CLEAR + (k === 4 ? 0.62 : 0.5);
      const pt = (r: number, t: number, f: number): P3 => at(Math.cos(t) * r, f, SPRING + Math.sin(t) * r);
      solid('stone', [pt(ri, t0, -DEEP), pt(ro, t0, -DEEP), pt(ro, t1, -DEEP), pt(ri, t1, -DEEP), pt(ri, t0, DEEP), pt(ro, t0, DEEP), pt(ro, t1, DEEP), pt(ri, t1, DEEP)], tone());
    }
    // The head of the wall over the key, a coping across it, and the cross.
    solid('stone', [at(-0.95, -DEEP * 0.86, SPRING + 1.9), at(0.95, -DEEP * 0.86, SPRING + 1.9), at(0.95, DEEP * 0.86, SPRING + 1.9), at(-0.95, DEEP * 0.86, SPRING + 1.9), at(-0.95, -DEEP * 0.86, SPRING + 2.75), at(0.95, -DEEP * 0.86, SPRING + 2.75), at(0.95, DEEP * 0.86, SPRING + 2.75), at(-0.95, DEEP * 0.86, SPRING + 2.75)], tone());
    solid('stone', [at(-1.15, -DEEP - 0.08, SPRING + 2.75), at(1.15, -DEEP - 0.08, SPRING + 2.75), at(1.15, DEEP + 0.08, SPRING + 2.75), at(-1.15, DEEP + 0.08, SPRING + 2.75), at(-1.05, -DEEP, SPRING + 2.93), at(1.05, -DEEP, SPRING + 2.93), at(1.05, DEEP, SPRING + 2.93), at(-1.05, DEEP, SPRING + 2.93)], tone());
    const iron: Colour = [0.15, 0.14, 0.13], cx = at(0, 0, SPRING + 2.93);
    block('metal', cx[0], cx[1], cx[2], 0.06, 0.06, 1.15, gt.heading + Math.PI / 2, iron);
    block('metal', cx[0], cx[1] + 0.72, cx[2], 0.6, 0.06, 0.06, gt.heading + Math.PI / 2, iron);
  }
  // The shelter on the ridge: four walls of dry stone, a stride and a half high inside, a doorway
  // towards the way, a roof of timbers covered with slabs and weighted with stones against the
  // wind. Somebody left a staff in it.
  if (m.shelter) {
    const sh = m.shelter, q = rng.fork('shelter'), fx = Math.cos(sh.facing), fz = Math.sin(sh.facing);
    // (In the shelter's own terms: `a` to the right as one faces out of its door, `f` out through the door, `up` from its floor.)
    const W = 3.6, D = 3.0, T = 0.55, H = 1.95, DOOR = 0.95;
    const world = (a: number, f: number): [number, number] => [sh.x + fx * f - fz * a, sh.z + fz * f + fx * a];
    const wall = (a0: number, f0: number, a1: number, f1: number, gap: number) => {
      const len = Math.hypot(a1 - a0, f1 - f0), ua = (a1 - a0) / len, uf = (f1 - f0) / len, yaw = sh.facing + Math.atan2(uf, ua) + Math.PI / 2;
      let up = -0.25, course = 0;
      while (up < H) {
        const tall = q.range(0.24, 0.34);
        // (Each course breaks joint with the one under it: every other one begins with a short stone. None runs past the wall's end.)
        let at = 0, first = course % 2 === 1;
        while (at < len - 0.05) {
          const long = Math.min(first ? q.range(0.22, 0.38) : q.range(0.45, 0.8), len - at), mid = at + long / 2;
          first = false;
          // (The doorway: no stone across it below its lintel.)
          if (!(gap > 0 && Math.abs(mid - len / 2) < gap / 2 + long * 0.3 && up < H - 0.35)) {
            const [x, z] = world(a0 + ua * mid, f0 + uf * mid);
            block('rock', x, sh.y + up, z, long * 0.98, T * q.range(0.85, 1.05), tall, yaw + q.range(-0.05, 0.05), [stone[0] * q.range(0.8, 1.1), stone[1] * q.range(0.8, 1.1), stone[2] * q.range(0.8, 1.1)]);
          }
          at += long;
        }
        up += tall * 0.97; course++;
      }
    };
    wall(-W / 2, D / 2, W / 2, D / 2, DOOR);
    wall(-W / 2, -D / 2, W / 2, -D / 2, 0);
    wall(-W / 2 + T / 2, -D / 2, -W / 2 + T / 2, D / 2, 0);
    wall(W / 2 - T / 2, -D / 2, W / 2 - T / 2, D / 2, 0);
    // The lintel over the door, a long stone.
    { const [x, z] = world(0, D / 2); block('rock', x, sh.y + H - 0.32, z, DOOR + 0.9, T, 0.3, sh.facing + Math.PI / 2, stone); }
    // Timbers across, front to back, and slabs over them.
    for (let k = -2; k <= 2; k++) { const [x, z] = world(k * 0.78, 0); block('wood', x, sh.y + H, z, 0.14, D + 0.5, 0.14, sh.facing + Math.PI / 2, timber); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const [x, z] = world(-W / 2 + (i + 0.5) * (W / 4), -D / 2 + (j + 0.5) * (D / 3));
      block('rock', x, sh.y + H + 0.14, z, W / 4 + 0.12, D / 3 + 0.1, 0.1, sh.facing + q.range(-0.06, 0.06), [stone[0] * 0.9, stone[1] * 0.9, stone[2] * 0.9]);
      if (q.chance(0.4)) { const [bx, bz] = world(-W / 2 + (i + q.range(0.2, 0.8)) * (W / 4), -D / 2 + (j + q.range(0.2, 0.8)) * (D / 3)); block('rock', bx, sh.y + H + 0.24, bz, q.range(0.25, 0.4), q.range(0.2, 0.35), q.range(0.15, 0.25), q.range(0, 3), stone); }
    }
    // A bench of stone along the back wall.
    { const [x, z] = world(0, -D / 2 + T / 2 + 0.25); block('rock', x, sh.y - 0.1, z, W - T * 2 - 0.1, 0.5, 0.52, sh.facing + Math.PI / 2, stone); }
    const [ix, iz] = world(0.6, -D / 2 + T + 0.6);
    b.finds.push({ at: V(ix, sh.y + 0.35, iz), what: 'an iron-shod staff, left in the shelter on the ridge' });
  }
  // Where somebody did not get up, or did not get down: small crosses of iron at the edge, beside the way.
  {
    const q = rng.fork('crosses');
    for (let n = 0, tries = 0; tries < 80 && n < 2; tries++) {
      const k = q.int(6, Math.max(7, way.length - 6)), [wx, wz, wy] = way[k], [nx, nz] = way[Math.min(way.length - 1, k + 1)];
      const dir = Math.atan2(nz - wz, nx - wx), side = q.chance(0.5) ? 1 : -1, off = q.range(3.2, 5);
      const x = wx + Math.cos(dir + (side * Math.PI) / 2) * off, z = wz + Math.sin(dir + (side * Math.PI) / 2) * off;
      if (inside(m, x, z) < 1.5 || inside(m, x, z) > 6 || nearWay(x, z, 4) < 2.8 || Math.abs(ground(x, z) - wy) > 1.5 || (m.shelter && Math.hypot(x - m.shelter.x, z - m.shelter.z) < 8)) continue;
      const y = ground(x, z), face = dir + q.range(-0.3, 0.3), iron: Colour = [0.16, 0.15, 0.14];
      block('metal', x, y - 0.3, z, 0.05, 0.04, 1.25, face, iron);
      block('metal', x, y + 0.65, z, 0.5, 0.04, 0.05, face, iron);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; block('rock', x + Math.cos(a) * 0.22, y - 0.08, z + Math.sin(a) * 0.22, 0.22, 0.18, 0.18, a, stone); }
      n++;
    }
  }

  // At the landings: a seat of stone slabs to rest on, a cairn, or an iron cross; or nothing but the view.
  for (const [i, l] of (m.landings ?? []).entries()) {
    const q = rng.fork(`landing ${i}`), fx = Math.cos(l.out), fz = Math.sin(l.out);
    // (Towards the outer edge, facing out, clear of the path.)
    const x = l.x + fx * (l.r * 0.45), z = l.z + fz * (l.r * 0.45), y = ground(x, z);
    if (nearClimb(x, z, 4) < 1.8) continue;
    if (l.what === 'seat') {
      for (const s of [-0.7, 0.7]) block('rock', x - fz * s, y - 0.2, z + fx * s, 0.35, 0.4, 0.62, l.out, stone);
      block('rock', x, y + 0.42, z, 0.48, 2.1, 0.12, l.out, [stone[0] * 0.95, stone[1] * 0.95, stone[2] * 0.95]);
    } else if (l.what === 'cairn') cairn(x, z, q.range(1, 1.6), q);
    else if (l.what === 'cross') {
      const iron: Colour = [0.16, 0.15, 0.14], face = l.out + Math.PI / 2;
      block('metal', x, y - 0.3, z, 0.06, 0.05, 1.7, face, iron);
      block('metal', x, y + 0.95, z, 0.62, 0.05, 0.06, face, iron);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; block('rock', x + Math.cos(a) * 0.26, y - 0.08, z + Math.sin(a) * 0.26, 0.24, 0.2, 0.22, a, stone); }
    }
  }

  // ---- what grows, which is little
  // Along the gallery way, wherever the ground falls away beside it: iron posts let into the rock, and a rail from post to post.
  if (gal) {
    const iron: Colour = [0.15, 0.14, 0.13];
    type P3 = [number, number, number];
    const bar = (a: P3, c: P3, t: number) => {
      const dx = c[0] - a[0], dz = c[2] - a[2], l = Math.hypot(dx, dz) || 1, px = (-dz / l) * t, pz = (dx / l) * t;
      solid('metal', [[a[0] - px, a[1] - t, a[2] - pz], [a[0] + px, a[1] - t, a[2] + pz], [c[0] + px, c[1] - t, c[2] + pz], [c[0] - px, c[1] - t, c[2] - pz], [a[0] - px, a[1] + t, a[2] - pz], [a[0] + px, a[1] + t, a[2] + pz], [c[0] + px, c[1] + t, c[2] + pz], [c[0] - px, c[1] + t, c[2] - pz]], iron);
    };
    for (const run of runs.open) for (const side of [1, -1]) {
      let last: P3 | null = null;
      for (let k = 1; k < run.length - 1; k++) {
        const [x, z, y] = run[k], dx = run[k + 1][0] - run[k - 1][0], dz = run[k + 1][1] - run[k - 1][1], l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * side, nz = (dx / l) * side;
        // (Only where there is a drop on this side, and not where another path comes in.)
        const px = x + nx * 1.38, pz = z + nz * 1.38;
        if (ground(x + nx * 2.7, z + nz * 2.7) > y - 2.2 || nearWay(px, pz, 3) < 2.2 || nearClimb(px, pz, 3) < 2 || nearUnder(px, pz, 3).off < 1.2) { last = null; continue; }
        const top: P3 = [px, y + 1.02, pz];
        block('metal', px, y - 0.25, pz, 0.045, 0.045, 1.3, Math.atan2(dz, dx), iron);
        if (last) { bar(last, top, 0.016); bar([last[0], last[1] - 0.5, last[2]], [top[0], top[1] - 0.5, top[2]], 0.012); }
        last = top;
      }
    }
  }

  // Stones: frost splits the rock and leaves it lying, angular and sharp, all over the top, thickest under the crags and
  // where nothing grows. Each is a rough block of a few faces, no bigger than can be kicked or sat on; nobody trips on them.
  {
    const q = rng.fork('stones'), was = wild.group;
    wild.group = 'soft';
    type P3 = [number, number, number];
    let laid = 0;
    for (let tries = 0; tries < 26000 && laid < 4200; tries++) {
      const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1), d = inside(m, x, z);
      if (d < 0.5 || insideOuter(x, z, 1.5) || (x > m.level.x0 && x < m.level.x1 && z > m.level.z0 && z < m.level.z1)) continue;
      if (nearWay(x, z, 3) < 1.7 || nearClimb(x, z, 3) < 1.5 || nearOpen(x, z, 3) < 1.6) continue;
      const rk = rocky.holds(x, z) ? rocky.at(x, z) : 0;
      if (rk > 0.6) continue;
      turfAt(x, z);
      // (In drifts: many together, then few.)
      const drift = fbm2(x * 0.11 + s2, z * 0.11 - s1, 3);
      if (!q.chance(Math.min(1, 0.08 + 0.5 * lay.bare * smooth((drift - 0.42) / 0.2) + 1.2 * rk))) continue;
      const y = ground(x, z), size = q.range(0.1, 0.34) * (q.chance(0.08) ? 2.2 : 1), yaw = q.range(0, Math.PI), c = Math.cos(yaw), sn = Math.sin(yaw);
      const w = size * q.range(0.7, 1.4), dd = size * q.range(0.6, 1.1), h = size * q.range(0.35, 0.8), tw = q.range(0.45, 0.85), tx = q.range(-0.25, 0.25) * w, tz = q.range(-0.25, 0.25) * dd;
      const at = (a: number, f: number, up: number): P3 => [x + c * a - sn * f, y - 0.05 + up, z + sn * a + c * f];
      const tone = q.range(0.75, 1.25);
      solid('rock', [at(-w, -dd, 0), at(w, -dd, 0), at(w, dd, 0), at(-w, dd, 0),
        at(-w * tw + tx, -dd * tw + tz, h * q.range(0.7, 1)), at(w * tw + tx, -dd * tw + tz, h), at(w * tw + tx, dd * tw + tz, h * q.range(0.6, 1)), at(-w * tw + tx, dd * tw + tz, h * q.range(0.8, 1))], rockColour(tone * 0.95), 0.4);
      laid++;
    }
    wild.group = was;
  }
  // Kerbs: along both edges of the way, the climb and the gallery way's open stretches, stones set on edge a stride apart, as a
  // mule path is kept from spreading and from being lost under snow. Not continuous: here and there one is missing.
  {
    const q = rng.fork('kerbs'), was = wild.group;
    wild.group = 'soft';
    type P3 = [number, number, number];
    const kerbOn = (line: [number, number, number][], half: number, from: number, other: (x: number, z: number) => boolean) => {
      for (const side of [1, -1]) {
        let carry = q.range(0, 0.9);
        for (let k = Math.max(1, from); k < line.length; k++) {
          const [ax, az, ay] = line[k - 1], [bx, bz, by] = line[k], run = Math.hypot(bx - ax, bz - az);
          if (run < 0.2) continue;
          const nx = (-(bz - az) / run) * side, nz = ((bx - ax) / run) * side, heading = Math.atan2(bz - az, bx - ax);
          for (let f = carry; f < run; f += q.range(0.75, 1.15)) {
            carry = 0;
            if (q.chance(0.16)) continue;
            const t = f / run, x = ax + (bx - ax) * t + nx * (half + q.range(-0.06, 0.1)), z = az + (bz - az) * t + nz * (half + q.range(-0.06, 0.1));
            if (other(x, z) || insideOuter(x, z, 0.5) || (x > p.x0 - 0.5 && x < p.x1 + 0.5 && z < p.z1 + 0.5 && z > p.z0)) continue;
            // (None over a void: on the bridge the way has rails.)
            if (ground(x, z) < ay + (by - ay) * t - 1.2) continue;
            const y = Math.min(ay + (by - ay) * t, ground(x, z)) - 0.14, yaw = heading + q.range(-0.25, 0.25), c = Math.cos(yaw), sn = Math.sin(yaw);
            const w = q.range(0.13, 0.24), d = q.range(0.07, 0.12), h = q.range(0.18, 0.32), tw = q.range(0.6, 0.9);
            const at = (u: number, v: number, up: number): P3 => [x + c * u - sn * v, y + up, z + sn * u + c * v];
            solid('rock', [at(-w, -d, 0), at(w, -d, 0), at(w, d, 0), at(-w, d, 0), at(-w * tw, -d * 0.8, h * q.range(0.8, 1)), at(w * tw, -d * 0.8, h), at(w * tw, d * 0.8, h * q.range(0.8, 1)), at(-w * tw, d * 0.8, h * q.range(0.85, 1))], rockColour(q.range(0.6, 0.95)), 0.4);
          }
          carry = 0.4;
        }
      }
    };
    kerbOn(way, 1.45, 2, (x, z) => nearClimb(x, z, 3) < 1.6 || nearOpen(x, z, 3) < 1.7);
    kerbOn(climb, 1.3, 2, (x, z) => nearWay(x, z, 3) < 1.7 || nearOpen(x, z, 3) < 1.7);
    for (const run of runs.open) kerbOn(run, 1.42, 1, (x, z) => nearWay(x, z, 3) < 1.7 || nearClimb(x, z, 3) < 1.6 || nearUnder(x, z, 3).off < 1.6);
    wild.group = was;
  }
  // Steps, wherever a path climbs as a stair does: the top of the climb, and the gallery way where it comes up through the rock.
  // A block of stone at every half stride, set into the slope. They are for the eye, as the island's are: what is walked on is the
  // slope, so no foot catches on a riser.
  {
    const q = rng.fork('steps'), was = wild.group;
    wild.group = 'soft';
    const stepsOn = (line: [number, number, number][], halfWidth: number, from: number) => {
      for (let k = Math.max(0, from); k < line.length - 1; k++) {
        const [ax, az, ay] = line[k], [bx, bz, by] = line[k + 1], run = Math.hypot(bx - ax, bz - az);
        if (run < 0.3 || Math.abs(by - ay) / run < 0.38) continue;
        if (ground((ax + bx) / 2, (az + bz) / 2) < Math.min(ay, by) - 1.5) continue;
        const heading = Math.atan2(bz - az, bx - ax), n = Math.max(1, Math.round(run / 0.6)), up = by > ay;
        for (let j = 0; j < n; j++) {
          // Each tread a slab or two of the mountain's own stone, split and laid as it came: no two the same breadth or quite square to the way.
          const f = (j + 0.5) / n, top = ay + (by - ay) * (up ? (j + 1) / n : j / n);
          const px = -(bz - az) / run, pz = (bx - ax) / run, split = q.chance(0.55) ? q.range(-0.4, 0.4) * halfWidth : null;
          for (const [c0, c1] of split === null ? [[-halfWidth, halfWidth]] : [[-halfWidth, split - 0.02], [split + 0.02, halfWidth]]) {
            const mid = (c0 + c1) / 2 + q.range(-0.06, 0.06), tone = q.range(0.62, 0.95);
            block('rock', ax + (bx - ax) * f + px * mid, top - 0.36 + q.range(-0.03, 0.02), az + (bz - az) * f + pz * mid, run / n * q.range(0.9, 1.04), (c1 - c0) * q.range(0.9, 1.06), 0.38, heading + q.range(-0.07, 0.07), rockColour(tone), [q.range(-0.05, 0.05), q.range(-0.05, 0.05)]);
          }
        }
      }
    };
    if (way.length) stepsOn(way, 1.25, 2);
    if (climb.length) stepsOn(climb, 1.15, 2);
    if (gal) stepsOn(gal.line, 1.3, 0);
    wild.group = was;
  }
  // Light in the tunnels: a torch in an iron bracket on the inner wall every dozen strides, so that nobody walks them blind.
  const torches: MountainResult['torches'] = [];
  if (gal) for (const [a, e] of gal.under) {
    for (let k = a + 3; k <= e - 2; k += 6) {
      const [x, z, y] = gal.line[k], [nx2, nz2] = gal.line[Math.min(gal.line.length - 1, k + 1)], dx = nx2 - x, dz = nz2 - z, l = Math.hypot(dx, dz) || 1;
      // (The inner wall: the side away from the face, which is the side towards the middle of the mountain; unless a window is cut on the other.)
      let px = -dz / l, pz = dx / l;
      if (px * (m.x - x) + pz * (m.z - z) < 0) { px = -px; pz = -pz; }
      const at = V(x + px * 1.05, y + 1.85, z + pz * 1.05);
      torches.push({ position: at, out: V(-px, 0, -pz) });
      block('metal', at.x + px * 0.12, at.y - 0.28, at.z + pz * 0.12, 0.05, 0.3, 0.05, Math.atan2(pz, px), [0.14, 0.13, 0.12]);
    }
  }
  // And a fire burning on the floor of the shelter, for whoever comes up out of the cloud.
  if (m.shelter) torches.push({ position: V(m.shelter.x - Math.cos(m.shelter.facing) * 0.3, m.shelter.y + 0.05, m.shelter.z - Math.sin(m.shelter.facing) * 0.3), out: V(0, 0, 1), fire: 1.1 });

  // Young pines, here and there on ledges of the precipices and among the crags, where a seed has
  // lodged in a crack: low, leaning, bent by the wind. No older ones: what grows taller is blown down.
  const pines = (() => {
    const q = rng.fork('pines'), pineWood = wild.mesh('barkPine');
    wild.group = 'soft';
    const softPine = wild.mesh('barkPine');
    wild.group = 'wild';
    const stood: [number, number][] = [];
    for (let tries = 0; tries < 2500 && stood.length < 22; tries++) {
      const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1), d = inside(m, x, z);
      if (d < -9 || d > 4 || nearWay(x, z, 6) < 3.5 || nearClimb(x, z, 6) < 3 || nearOpen(x, z, 6) < 3.2 || insideOuter(x, z, 6)) continue;
      const y = ground(x, z);
      if (y < deck + 4 || !rocky.holds(x, z) || rocky.at(x, z) > 0.45) continue;
      // (On a ledge: the ground there nearly level, and rock close by.)
      let lo = y, hi = y, steepNear = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const h = ground(x + dx * 0.9, z + dz * 0.9); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (rocky.holds(x + dx, z + dz) && rocky.at(x + dx, z + dz) > 0.5) steepNear++;
      if (hi - lo > 0.9 || steepNear < 1 || stood.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < (q.chance(0.5) ? 2.5 : 9))) continue;
      const tall = q.range(2.2, 5.5);
      growConifer(b.planting, pineWood, x, y - 0.08, z, tall, tall * q.range(0.32, 0.45), tall * q.range(0.025, 0.04), { kind: 'pine', coastal: true, detail: 1, needle: (r) => [0.06 * r.range(0.8, 1.2), 0.12 * r.range(0.8, 1.2), 0.06 * r.range(0.8, 1.2)], bark: [0.75, 0.58, 0.46], soft: softPine }, q.fork(`pine${stood.length}`));
      stood.push([x, z]);
    }
    return stood.length;
  })();
  const planted = plantMountain({ site, rng: rng.fork('planting'), planting: b.planting, cards: b.cards, ground, turfAt, layBare: () => lay.bare, hollowAt, rockyAt: (x, z) => (rocky.holds(x, z) ? rocky.at(x, z) : 0), looseAt: (x, z) => (loose.holds(x, z) ? loose.at(x, z) : 0), trackOff, offFoot, insideOuter });

  __T('props+plants');
  // ---- the edge of the world: nobody walks off a precipice or down into the cloud
  const arrive = way.length ? way[way.length - 1] : [m.spur.to[0], m.spur.to[1], m.spur.y1];
  {
    // (On the sheet's own lattice, so that the heights it worked out are had for nothing.)
    const C = SHEET, gx0 = snap(g.x0 - 12, false, C), gz0 = snap(g.z0 - 12, false, C), nx = Math.round((g.x1 - g.x0 + 24) / C) + 1, nz = Math.round((g.z1 - g.z0 + 24) / C) + 1;
    const ok = new Uint8Array(nx * nz), floorY = arrive[2] - 2.5, bored = new Float32Array(nx * nz).fill(NaN);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = gx0 + i * C, z = gz0 + j * C, y = groundKept(x, z);
      let lo = y, hi = y;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]) { const h = groundKept(x + dx * C, z + dz * C); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      // Ground that can be stood on: not a drop, and not below the foot of the way, where the ridge goes on down into the cloud.
      // (Nor more than a few strides out beyond the edge, on the scree below a low stretch of it: the slope goes on down from there.)
      // (The way and the climb are always ground, as broad as they are cut, so that the fences beside them leave room to turn at a bend.)
      ok[j * nx + i] = (hi - lo < 1.85 && y > floorY && inside(m, x, z) > -6) || nearWay(x, z, 3) < 2.4 || nearClimb(x, z, 3) < 1.9 || nearOpen(x, z, 3) < 1.7 ? 1 : 0;
      // (And where a tunnel of the gallery way runs under a place, whatever the ground over it: its floor's level there.)
      if (runs.under.length) { const u = nearUnder(x, z, 3); if (u.off < 1.9) bored[j * nx + i] = u.y; }
    }
    const reach = new Uint8Array(nx * nz), queue: number[] = [];
    const start = Math.round((p.z1 - 2 - gz0) / C) * nx + Math.round(((p.x0 + p.x1) / 2 - gx0) / C);
    if (ok[start]) { reach[start] = 1; queue.push(start); }
    while (queue.length) {
      const k = queue.pop()!, i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, q = jj * nx + ii;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || reach[q] || !(ok[q] || bored[q] === bored[q])) continue;
        reach[q] = 1; queue.push(q);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      // Over a tunnel, where the ground above is not ground anyone may stand on (the brink of the precipice, mostly), the fence
      // begins above the tunnel's roof: whoever is in the tunnel walks under it, and nobody above steps off the edge there.
      if (reach[k] && !ok[k] && bored[k] === bored[k]) { const x = gx0 + i * C, z = gz0 + j * C; b.fences.push({ min: V(x - C / 2, bored[k] + 3.5, z - C / 2), max: V(x + C / 2, F + 160, z + C / 2) }); }
      if (reach[k]) continue;
      let touches = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && reach[jj * nx + ii]) touches = true; }
      if (!touches) continue;
      const x = gx0 + i * C, z = gz0 + j * C;
      b.fences.push({ min: V(x - C / 2, Math.min(HIDDEN, ground(x, z) - 4), z - C / 2), max: V(x + C / 2, F + 160, z + C / 2) });
    }
  }

  __T('fences');
  // ---- the other peaks, far off over the cloud, and the mountain's own lower slopes beyond the near ground
  wild.group = 'soft';
  layRange(wild.mesh('far'), site, F, tint, area, winter);
  // The sights of the country round about: built larger than life the further off they stand, or they would be specks; each faces the mountain.
  (m.sights ?? []).forEach((sg, i) => {
    const far = Math.hypot(sg.x - m.x, sg.z - m.z);
    buildLandmark(sg.kind, sg.x, sg.y - 2, sg.z, Math.atan2(m.z - sg.z, m.x - sg.x), (material) => wild.mesh(material), rng.fork(`sight${i}`), [0.82 * tint[0], 0.78 * tint[1], 0.7 * tint[2]], 1.1 + far / 900);
  });
  // The needles: each a tower drawn as rock, with the mountain's own beds, joints and colour, rising out of the cloud. Made as a
  // skin about its axis, ring upon ring, broken into buttresses and ledges; nobody goes near them, so they are not carved.
  {
    const softRock = wild.mesh('rock');
    (m.needles ?? []).forEach((nd, i) => {
      const q = rng.fork(`needle${i}`), base = deck - 40, top = deck + nd.height, tall = top - base, sA = q.range(0, 50), sB = q.range(0, 50);
      const lean = [q.range(-0.06, 0.06), q.range(-0.06, 0.06)], AROUND = 40, UP = Math.max(24, Math.round(tall / 1.6));
      const radius = (a: number, h: number) => {
        const t = h / tall;
        // Broad at the foot, drawn in towards the top, which is a blunt broken head; buttresses up its height; ledges where a bed is hard.
        const body = nd.r * (1.5 - 0.95 * Math.pow(t, 0.8)) * (1 - smooth((t - 0.9) / 0.1) * 0.75);
        const buttress = 0.72 + 0.5 * fbm2(Math.cos(a) * 1.7 + sA, Math.sin(a) * 1.7 + h * 0.012, 3, 3);
        const ledge = 1 + 0.1 * Math.sign(Math.sin(h * 0.9 + 3 * fbm2(h * 0.07, sB, 2, 5))) * rockKind.bedded;
        const rough = 1 + (fbm2(Math.cos(a) * 6 + sB, Math.sin(a) * 6 + h * 0.2, 2, 9) - 0.5) * 0.3;
        return body * buttress * ledge * rough;
      };
      const at = (ia: number, ih: number): [number, number, number] => {
        const a = (ia / AROUND) * Math.PI * 2, h = (ih / UP) * tall, r = radius(a, h);
        return [nd.x + lean[0] * h + Math.cos(a) * r, base + h, nd.z + lean[1] * h + Math.sin(a) * r];
      };
      const ids: number[] = [];
      for (let ih = 0; ih <= UP; ih++) for (let ia = 0; ia < AROUND; ia++) {
        const p0 = at(ia, ih), pa = at(ia + 1, ih), pb = at(ia - 1, ih), pu = at(ia, Math.min(UP, ih + 1)), pd = at(ia, Math.max(0, ih - 1));
        const ax = pa[0] - pb[0], ay = pa[1] - pb[1], az = pa[2] - pb[2], ux = pu[0] - pd[0], uy = pu[1] - pd[1], uz = pu[2] - pd[2];
        let nx = ay * uz - az * uy, ny = az * ux - ax * uz, nz = ax * uy - ay * ux;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        // (Facing out from the axis.)
        if (nx * (p0[0] - nd.x - lean[0] * (p0[1] - base)) + nz * (p0[2] - nd.z - lean[1] * (p0[1] - base)) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const field = new Float32Array(4), c = shadeRock(V(p0[0], p0[1], p0[2]), V(nx, ny, nz), field, 1);
        ids.push(softRock.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, ((ia / AROUND) * nd.r * 6) * 0.4, p0[1] * 0.4, c[0], c[1], c[2], field[0], field[1], field[2], field[3]));
      }
      for (let ih = 0; ih < UP; ih++) for (let ia = 0; ia < AROUND; ia++) {
        const a0 = ih * AROUND + ia, a1 = ih * AROUND + ((ia + 1) % AROUND), b0 = a0 + AROUND, b1 = a1 + AROUND;
        softRock.addTriangle(ids[a0], ids[b0], ids[a1]);
        softRock.addTriangle(ids[a1], ids[b0], ids[b1]);
      }
      // Its head: closed over.
      const [hx, hy, hz] = [nd.x + lean[0] * tall, top + 0.4, nd.z + lean[1] * tall];
      const fieldT = new Float32Array(4), cT = shadeRock(V(hx, hy, hz), V(0, 1, 0), fieldT, 1);
      const cap = softRock.addVertex(hx, hy, hz, 0, 1, 0, 0, hy * 0.4, cT[0], cT[1], cT[2], fieldT[0], fieldT[1], fieldT[2], fieldT[3]);
      for (let ia = 0; ia < AROUND; ia++) softRock.addTriangle(ids[UP * AROUND + ia], cap, ids[UP * AROUND + ((ia + 1) % AROUND)]);
    });
  }
  wild.group = 'wild';

  __T('range');
  // Where the player comes in: at the foot of the way, facing up it.
  // (Up the ridge, towards the top.)
  const back = way.length > 14 ? way[way.length - 13] : [m.spur.from[0], m.spur.from[1], F];
  return {
    spawn: V(arrive[0], ground(arrive[0], arrive[1]) + 1.75, arrive[1]),
    // (Yaw is measured so that 0 looks towards lesser z.)
    yaw: Math.atan2(-(back[0] - arrive[0]), -(back[1] - arrive[1])),
    track: [...track].reverse().slice(1, -1) as [number, number][],
    // (Turf seen from far off takes the colour of what stands on it: up here thin, dry and brown.)
    far: { wood: [0.05, 0.08, 0.035], grass: winter ? [0.2, 0.2, 0.17] : [0.2, 0.19, 0.1], sward: [0.25, 0.225, 0.125],
      // (And bare ground is scree: stones of the mountain's own rock, its colour and as pale.)
      bare: [0.42 * (rockKind.dark[0] + rockKind.pale[0]) * outcrop[0], 0.42 * (rockKind.dark[1] + rockKind.pale[1]) * outcrop[1], 0.43 * (rockKind.dark[2] + rockKind.pale[2]) * outcrop[2], 1] },
    deck: {
      level: deck, billow: m.billow, breaks: m.breaks ?? 0,
      shade: (() => {
        const mean = m.rim.reduce((sum, r) => sum + r, 0) / m.rim.length, pk = m.peaks[0];
        return { x: m.x, z: m.z, top: F, rTop: mean * 0.92, rFoot: mean + (F - deck) * 0.75, px: m.cairn?.x ?? pk.x, pz: m.cairn?.z ?? pk.z, pr: pk.r * 0.9, py: m.cairn?.y ?? F + pk.height };
      })(),
    },
    // Choughs: off the precipices on four sides, a little under the rim, so that they are looked down on; and about the summit.
    birds: [
      ...[0.4, 1.9, 3.5, 5.1].map((a) => { const r = m.rim[Math.floor((a / (Math.PI * 2)) * m.rim.length) % m.rim.length] + 22; return { x: m.x + Math.cos(a + s1) * r, y: F - 12, z: m.z + Math.sin(a + s1) * r }; }),
      ...(m.cairn ? [{ x: m.cairn.x + 14, y: m.cairn.y + 6, z: m.cairn.z - 10 }] : []),
    ],
    smokes: m.shelter ? [{ x: m.shelter.x - Math.cos(m.shelter.facing) * 0.3, y: m.shelter.y + 2.3, z: m.shelter.z - Math.sin(m.shelter.facing) * 0.3, height: 9 }] : [],
    planted: { ...planted, pines },
    lookout,
    torches,
  };
}

interface MountainPlanting {
  site: Site;
  rng: Rng;
  planting: Planting;
  cards: CardSet[];
  ground: (x: number, z: number) => number;
  turfAt: (x: number, z: number) => Colour;
  layBare: () => number;
  hollowAt: (x: number, z: number) => number;
  rockyAt: (x: number, z: number) => number;
  looseAt: (x: number, z: number) => number;
  trackOff: (x: number, z: number) => number;
  offFoot: (x: number, z: number) => number;
  insideOuter: (x: number, z: number, m?: number) => boolean;
}

/**
 * What grows on a mountain top: grasses in tufts where there is turf, short and browned;
 * cushions of moss campion, pink, hugging the ground among the stones; and here and there
 * gentians, blue, and yellow saxifrage. Nothing taller than a hand. In winter all of it is
 * under the snow, and only a few dry heads of grass stand up through it on the crests where
 * the wind has blown the snow thin.
 */
function plantMountain(c: MountainPlanting): Record<string, number> {
  const { site, planting, rng } = c, m = site.mountain!;
  const winter = site.setting.season === 'winter';
  const cushion: CardSet = { kind: 'thrift', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  const counts: Record<string, number> = {};
  const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const g = site.grounds!, STEP = winter ? 1.6 : 0.8, q = rng.fork('low'), s = rng.range(0, 99);
  for (let z = g.z0; z < g.z1; z += STEP) for (let x = g.x0; x < g.x1; x += STEP) {
    const px = x + q.range(-STEP / 2, STEP / 2), pz = z + q.range(-STEP / 2, STEP / 2);
    if (inside(m, px, pz) < 1 || c.insideOuter(px, pz, 1.5)) continue;
    if (px > m.level.x0 - 1 && px < m.level.x1 + 1 && pz > m.level.z0 - 1 && pz < m.level.z1 + 1) continue;
    if (c.rockyAt(px, pz) > 0.3 || c.looseAt(px, pz) > 0.2) continue;
    if (Math.abs(c.trackOff(px, pz)) < 1.6 || c.offFoot(px, pz) < 0.7) continue;
    c.turfAt(px, pz);
    const bare = c.layBare(), y = c.ground(px, pz), yaw = q.range(0, Math.PI * 2);
    const fine = fbm2(px * 0.4 - s, pz * 0.4 + s, 2);
    if (winter) {
      // (Only on crests, where the wind has the snow thin, and only now and then.)
      if (c.hollowAt(px, pz) < 0.3 && fine > 0.6 && q.chance(0.5)) { planting.tuft(planting.grass, px, y - 0.02, pz, q.range(0.3, 0.45), q.range(0.18, 0.3), yaw, [0.36, 0.3, 0.16]); count('grass'); }
      continue;
    }
    if (bare > 0.75) {
      // Among the stones: a cushion now and then.
      if (fine > 0.62 && q.chance(0.35)) { planting.tuft(cushion, px, y - 0.03, pz, q.range(0.25, 0.4), q.range(0.08, 0.14), yaw, q.chance(0.75) ? [0.6, 0.26, 0.42] : [0.55, 0.55, 0.5]); count('cushion'); }
      continue;
    }
    // On the turf: short browned grass, and flowers in it here and there.
    const tone = q.range(0.85, 1.15), dry = 0.45 + 0.3 * fine;
    planting.tuft(planting.grass, px, y - 0.03, pz, q.range(0.35, 0.55), q.range(0.12, 0.26), yaw, [(0.12 + 0.1 * dry) * tone, (0.17 + 0.03 * dry) * tone, (0.07 + 0.03 * dry) * tone]);
    count('grass');
    if (fine > 0.58 && q.chance(0.3)) {
      planting.tuft(planting.flowers, px + 0.15, y - 0.03, pz, 0.24, q.range(0.08, 0.14), yaw, q.chance(0.6) ? [0.12, 0.2, 0.72] : [0.66, 0.58, 0.12]);
      count(q.chance(0.6) ? 'gentian' : 'saxifrage');
    } else if (fine < 0.32 && q.chance(0.2)) {
      planting.tuft(cushion, px, y - 0.03, pz, q.range(0.25, 0.4), q.range(0.08, 0.14), yaw, [0.6, 0.26, 0.42]);
      count('cushion');
    }
  }
  if (cushion.matrices.length) c.cards.push(cushion);
  return counts;
}

/**
 * The mountains round about, seen over the cloud, and this mountain's own slopes beyond the
 * ground near enough to be built finely: one sheet in rings about the top, out to the edge of
 * what the eye is let see, drawn with the far material. Whatever lies deep in the cloud is left
 * out, and so is whatever the near ground covers. Each point carries how high it stands, which
 * the far material reads for where rock gives way to snow: in winter everything over the cloud
 * is white but the steep faces; in summer only the high peaks keep their snow.
 */
function layRange(mesh: MeshBuilder, site: Site, F: number, stone: Colour, near: { x0: number; x1: number; z0: number; z1: number }, winter: boolean): void {
  const m = site.mountain!, cx = m.x, cz = m.z, deck = m.deck, seed = (m.x * 7.31 + m.z * 3.17) % 97;
  const around = 640, radii: number[] = [];
  for (let r = 60; r <= 6900; r += 3 + r * 0.02) radii.push(r);
  // (The land is the core's: `countryAt`. Here it is only drawn.)
  const wet = new Uint8Array(radii.length * around);
  const rings = radii.length, H = new Float32Array(rings * around), X = new Float32Array(rings * around), Z = new Float32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const a = (k / around) * Math.PI * 2, q = ri * around + k;
    X[q] = cx + Math.cos(a) * radii[ri]; Z[q] = cz + Math.sin(a) * radii[ri];
    // (What the near ground covers is not wanted, and its height is not reckoned: it is dear to reckon.)
    const inNear = X[q] > near.x0 - 6 && X[q] < near.x1 + 6 && Z[q] > near.z0 - 6 && Z[q] < near.z1 + 6;
    if (inNear) { H[q] = deck - 400; continue; }
    const land = countryAt(m, F, X[q], Z[q]);
    H[q] = land.y; wet[q] = land.water ? 1 : 0;
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
    // How high it stands, as the far material reads it: snow over 0.6 or so, pasture below, woods below 0.37.
    // (Above the cloud as before. Below it the woods come up to the cloud's level in summer, with pasture on the crests that stand
    // in it; in winter the woods are below a snow line some way down.)
    const up = H[q] - deck, h = winter ? (up > 0 ? 0.78 + up / 220 : 0.78 + up / 260) : (up > 0 ? 0.48 + up / 420 : 0.44 + up / 300);
    const r = 0.37 * (0.6 + 0.4 * stone[0]), gg = 0.37 * (0.6 + 0.4 * stone[1]), bl = 0.4 * (0.6 + 0.4 * stone[2]);
    return (ids[q] = mesh.addVertex(X[q], H[q], Z[q], nx, ny, nz, X[q] * 0.012, Z[q] * 0.012, r, gg, bl, wet[q], 0, hollow, h));
  };
  for (let ri = 0; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
    const qa = at(ri, k), qb = at(ri, k + 1), qc = at(ri + 1, k + 1), qd = at(ri + 1, k);
    // (Deep in the cloud about the mountain nothing is drawn, nor where the near ground is: the cloud is whole there. Further off it
    // may be broken, and all the land is drawn, down to the valley floors.)
    if (Math.max(H[qa], H[qb], H[qc], H[qd]) < deck - 45 && (radii[ri] < 400 || !(m.breaks ?? 0))) continue;
    const a = id(ri, k), bb = id(ri, k + 1), c = id(ri + 1, k + 1), d = id(ri + 1, k);
    mesh.addTriangle(a, bb, c);
    mesh.addTriangle(a, c, d);
  }
}
