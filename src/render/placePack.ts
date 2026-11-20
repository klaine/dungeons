import { BufferAttribute, BufferGeometry, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Site } from '../core/site';
import { Hole, HoleGrid } from '../core/stream';
import { siteFrame, SiteFrame } from '../core/worldLand';
import { MeshBuilder } from './geom/meshBuilder';
import { CardSet, SceneDescription, SeaDesc } from './scene';
import { stoneStyles } from './geom/styles';

/** The stone of the world's own rock (`groundLook` in the walk page colours it so). */
const WORLD_STONE = 'greystone';
import { meshSite } from './siteMesher';

/**
 * A place built for the world, rather than alone (`docs/06-world.md`, *The world as the game*, step 2): its site meshed as the game
 * meshes it (`meshSite`), in a worker, then made ready to stand in the world the walker streams in. What lies beyond its own land is
 * left out (its far land and the painted trees on it: the world draws its own); everything else is turned into the world's
 * coordinates (its frame, `siteFrame`: a turn about its forecourt, and its heights to the world's), so that its light, baked in the
 * world's directions, reads as it should; the solid part of it gathered into one mesh with its tree of bounds (`MeshBVH`), for the body
 * to walk on and be stopped by, made here and sent as numbers; and the heights of its land along the edge of the square it was laid
 * over, so that the world's land about it can be brought to meet it there (`PlaceHole`, `makeSquare`). Everything sent is typed arrays,
 * handed over, not copied.
 */

/** One mesh of a place, in the world's coordinates, as a `MeshBuilder` would build it; and how it is lit. */
export interface PackedMesh {
  /** Its group and material (`wild|turf`, `p3|stone`), as the game keys them. */
  key: string;
  material: string;
  /** Part of the house, whose light the game bakes; else what stands about it, lit by its share of the sky. */
  baked: boolean;
  /** Stops nobody: twigs, roots, low boughs. */
  soft: boolean;
  position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array; field: Float32Array; edge: Uint8Array; index: Uint32Array;
  /** Each point's share of the sky (less than nothing indoors); its light of its own where it has one (13 to a point); and the bake's plan for it. */
  open: Float32Array;
  own: Float32Array | null;
  source: Int32Array | null; scale: Float32Array | null;
}

/**
 * The square of land a place was laid over, in the world: its middle, how it is turned (as its frame is), its half-breadths along its
 * own two ways, and the height of its land all the way round its edge (from the corner at its own least x and z, along +x, then +z,
 * then back along -x and -z), every `step` metres. For the world's land about it to meet it (`withHole` in `core/stream.ts`).
 */
export type PlaceHole = Hole;

export interface PlacePack {
  kind: string; n: number; name: string; title: string;
  meshes: PackedMesh[];
  cards: CardSet[];
  hole: PlaceHole;
  /** The solid part, in one mesh, and its tree of bounds as `MeshBVH.serialize` gives it. */
  solid: { position: Float32Array; index: Uint32Array; bvh: ReturnType<typeof MeshBVH.serialize> };
  water: SceneDescription['water'];
  /** Its sea, if it has one (an island, a harbour town), in the world's coordinates. */
  sea?: SeaDesc;
  streams: SceneDescription['streams'];
  falls: SceneDescription['falls'];
  /** For the bake: the house's masses (boxes, six numbers each, in the world), and its lights (each at a point, `keep`: baked in). */
  masses: Float32Array;
  lights: { pos: number[]; intensity: number[]; range: number; size: number; keep?: boolean }[];
  /** How many of the heights round its square's edge found no land under them, and took the one before. */
  misses: number;
  /** What lives and burns in it, in the world (`PlaceLife`). */
  life: PlaceLife;
  /** What its game is played with (`PlaceGame`). */
  game: PlaceGame;
  /** How long it took, milliseconds: laying out was before; meshing, and making ready. */
  ms: { mesh: number; pack: number };
  triangles: number;
}

/**
 * What lives and burns in a place, in the world, as the game has it in its scene's description: smoke over its chimneys and fires,
 * birds wheeling off its cliffs, flocks grazing, its torches and candles, its street lamps and its lighthouse's lamp, fireflies'
 * homes. Points as plain numbers, for handing over from the worker. Flocks are kept out of the house's rooms, which are given in the
 * site's own ways (`rooms`, x0 x1 z0 z1) with the frame to take a point of the world there (`frame`).
 */
export interface PlaceLife {
  smokes: { x: number; y: number; z: number; height: number }[];
  birds: { x: number; y: number; z: number }[];
  birdKind?: SceneDescription['birdKind'];
  flocks: { x: number; z: number; r: number; count: number }[];
  flockKind?: SceneDescription['flockKind'];
  torches: { position: [number, number, number]; out: [number, number, number]; fire?: number; flames?: [number, number, number][] }[];
  lamps: [number, number, number][];
  fireflies: number[];
  beacon?: { x: number; y: number; z: number };
  rooms: [number, number, number, number][];
  frame: SiteFrame;
}

/**
 * What the game's rules need of a place (`Game` in `src/app/game.ts`), in the site's own ways, as the game has them; the page plays
 * them in the place's frame (`life.frame`). The site itself only as far as the rules read it (its places, ways, keys, levers and which
 * place is the start, the goal and the hidden one), its doors with each leaf's geometry as arrays, where each of its places is
 * anchored, and the small things left about to be found.
 */
export interface PlaceGame {
  site: Pick<Site, 'places' | 'ways' | 'items' | 'levers' | 'start' | 'goal' | 'secret'>;
  doors: {
    way: number; hinge: [number, number, number]; yaw: number; swing: number; halfWidth: number; spring: number; thickness: number;
    material: 'wood' | 'stone'; blocker: { min: [number, number, number]; max: [number, number, number] }; centre: [number, number, number]; barSide: number;
    leaf: { position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array; field: Float32Array; edge: Uint8Array; index: Uint32Array } | null;
  }[];
  anchors: [number, number, number, number][];
  finds: { at: [number, number, number]; what: string }[];
}

/** A point of the world into a site's own ways: its frame's turn undone about its point (`frameMover`'s inverse, on the level). */
export function intoSite(f: SiteFrame, x: number, z: number): [number, number] {
  const c = Math.cos(f.turn), s = Math.sin(f.turn), dx = x - f.u, dz = z - f.v;
  return [f.hx + c * dx + s * dz, f.hz - s * dx + c * dz];
}

/** A site's points in the world: a turn about its frame's point, and its heights shifted to the world's. */
export function frameMover(f: SiteFrame) {
  const c = Math.cos(f.turn), s = Math.sin(f.turn), dy = f.base - f.floor;
  return {
    point: (x: number, y: number, z: number): [number, number, number] => { const dx = x - f.hx, dz = z - f.hz; return [f.u + c * dx - s * dz, y + dy, f.v + s * dx + c * dz]; },
    dir: (x: number, y: number, z: number): [number, number, number] => [c * x - s * z, y, s * x + c * z],
    /** A column-major 4 by 4 transform of the site's made into the world's: the frame applied after it. */
    matrix: (m: ArrayLike<number>, o: number, out: number[]) => {
      // (The frame: turn about y by -turn as three.js counts it, which is this (x, z) -> (c x - s z, s x + c z); then move.)
      for (let col = 0; col < 4; col++) {
        const x = m[o + col * 4], y = m[o + col * 4 + 1], z = m[o + col * 4 + 2], w = m[o + col * 4 + 3];
        out.push(c * x - s * z + (col === 3 ? (f.u - c * f.hx + s * f.hz) * w : 0), y + (col === 3 ? dy * w : 0), s * x + c * z + (col === 3 ? (f.v - s * f.hx - c * f.hz) * w : 0), w);
      }
    },
    dy,
  };
}

/**
 * The numbers of a mesh builder's mesh, turned into the world's coordinates; with `keep`, only the triangles whose middle (in the site's
 * own coordinates) it keeps: what a place has beyond the land it was laid over would stand on land the world has otherwise.
 */
function packBuilder(key: string, b: MeshBuilder, mv: ReturnType<typeof frameMover>, baked: boolean, keep?: (x: number, z: number) => boolean): PackedMesh {
  const g = b.build(), n = b.vertexCount;
  const pos = (g.getAttribute('position').array as Float32Array).slice(0, n * 3), nrm = (g.getAttribute('normal').array as Float32Array).slice(0, n * 3);
  let index = Uint32Array.from(g.getIndex()!.array as ArrayLike<number>);
  if (keep) {
    const kept: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], c = index[t + 1], d = index[t + 2];
      if (keep((pos[a * 3] + pos[c * 3] + pos[d * 3]) / 3, (pos[a * 3 + 2] + pos[c * 3 + 2] + pos[d * 3 + 2]) / 3)) kept.push(a, c, d);
    }
    if (kept.length < index.length) index = Uint32Array.from(kept);
  }
  for (let i = 0; i < n; i++) {
    const p = mv.point(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), d = mv.dir(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    pos.set(p, i * 3); nrm.set(d, i * 3);
  }
  const open = new Float32Array(n);
  for (let i = 0; i < n; i++) open[i] = b.openAt(i);
  const plan = baked ? b.bakePlan() : null, material = key.split('|').pop()!;
  return {
    key, material, baked, soft: key.startsWith('soft|'),
    position: pos, normal: nrm,
    uv: (g.getAttribute('uv').array as Float32Array).slice(0, n * 2), color: (g.getAttribute('color').array as Float32Array).slice(0, n * 3),
    field: (g.getAttribute('aField').array as Float32Array).slice(0, n * 4), edge: (g.getAttribute('aEdge').array as Uint8Array).slice(0, n * 4),
    index,
    open, own: b.own ? b.own.slice() : null, source: plan?.source ?? null, scale: plan?.scale ?? null,
  };
}

/**
 * A packed mesh cut into tiles of the ground `size` metres square, each triangle going to the tile its middle falls in, each tile's
 * points its own: so that what is out of view is left out of the frame (as the game cuts what stands about a place, `tileGeometry`).
 * Done here, in the worker, so that the page has nothing to do but make the pieces. Small meshes are given back whole.
 */
function tilePacked(m: PackedMesh, size: number, least = 3000): PackedMesh[] {
  const tris = m.index.length / 3;
  if (tris < least) return [m];
  const tiles = new Map<string, number[]>(), p = m.position, ix = m.index;
  for (let t = 0; t < tris; t++) {
    const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2];
    const key = `${Math.floor((p[a * 3] + p[b * 3] + p[c * 3]) / 3 / size)},${Math.floor((p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3 / size)}`;
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(t);
  }
  if (tiles.size < 2) return [m];
  const remap = new Int32Array(p.length / 3).fill(-1), out: PackedMesh[] = [];
  for (const list of tiles.values()) {
    const used: number[] = [], index = new Uint32Array(list.length * 3);
    list.forEach((t, k) => { for (let c = 0; c < 3; c++) { const v = ix[t * 3 + c]; if (remap[v] < 0) { remap[v] = used.length; used.push(v); } index[k * 3 + c] = remap[v]; } });
    const take = <T extends Float32Array | Uint8Array | Int32Array>(a: T, n: number): T => { const o = new (a.constructor as new (k: number) => T)(used.length * n); used.forEach((v, k) => { for (let q = 0; q < n; q++) o[k * n + q] = a[v * n + q]; }); return o; };
    out.push({
      ...m, index, position: take(m.position, 3), normal: take(m.normal, 3), uv: take(m.uv, 2), color: take(m.color, 3), field: take(m.field, 4), edge: take(m.edge, 4),
      open: take(m.open, 1), own: m.own ? take(m.own, 13) : null, source: null, scale: null,
    });
    for (const v of used) remap[v] = -1;
  }
  return out;
}

/**
 * Builds a place laid out in a world (`generateWorldPlace`) ready to stand in it: see above. Only for a place whose site has a frame in
 * a world; the far land (`soft|far`) and the painted trees standing on it (cards `tree` and `fir`) left out.
 */
export function packPlace(site: Site, info: { kind: string; n: number; name: string }, worldLand?: (x: number, z: number) => number): PlacePack {
  const f = siteFrame(site);
  if (!f) throw new Error('not a place in a world');
  const t0 = performance.now();
  const d = meshSite(site);
  const t1 = performance.now(), mv = frameMover(f);
  // The square of land it was laid over: as far as its own sheet of turf reaches, in its site.
  const land: MeshBuilder[] = [];
  for (const [k, b] of d.scenery?.meshes ?? []) if (b.vertexCount && (k === 'wild|turf' || k === 'wild|rockSheet')) land.push(b);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const landGeo: BufferGeometry[] = [];
  for (const b of land) {
    const g = b.build(), p = g.getAttribute('position').array as Float32Array;
    for (let i = 0; i < b.vertexCount; i++) { x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]); z0 = Math.min(z0, p[i * 3 + 2]); z1 = Math.max(z1, p[i * 3 + 2]); }
    landGeo.push(g);
  }
  /** Whether a point of the site lies within that square (a little over it at the edge, where the world's land meets it). */
  const within = (x: number, z: number) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2;
  const meshes: PackedMesh[] = [];
  for (const [k, b] of d.meshes) if (b.vertexCount) meshes.push(packBuilder(k, b, mv, true));
  // What stands about the house, but its far land, and what of it lies beyond its square (a mountain top's shelters and cairns
  // kilometres off, on peaks the world has otherwise): cut into tiles of 64 metres, as the game cuts it.
  for (const [k, b] of d.scenery?.meshes ?? []) {
    if (!b.vertexCount || k === 'soft|far') continue;
    const m = packBuilder(k, b, mv, false, within);
    if (m.index.length) meshes.push(...tilePacked(m, 64));
  }
  // Its own rock (its cliffs, its sheet of rock, its scree, its loose stones) in the world's grey stone, as the world's rock is
  // coloured (`groundLook`): coloured with the place's stone, a warm sandstone or a pale limestone, it met the world's land along a
  // line of another rock, round under a mountain top's plateau. The house's masonry keeps its stone.
  if (site.setting.stone !== WORLD_STONE) {
    const from = stoneStyles(site.setting.stone).tint, to = stoneStyles(WORLD_STONE).tint, k = [0, 1, 2].map((c) => to[c] / Math.max(0.05, from[c]));
    for (const m of meshes) if (m.material === 'rock' || m.material === 'rockSheet' || m.material === 'scree') for (let i = 0; i < m.color.length; i += 3) for (let c = 0; c < 3; c++) m.color[i + c] *= k[c];
  }
  // Its land's height all round the edge of that square, a little inside it, where the sheet surely is: found by looking down on the
  // land alone (not its trees, rock or buildings).
  const STEP = 2, inset = 1.5;
  const profile: number[] = [];
  let hole: PlaceHole, misses = 0;
  {
    const merged = new BufferGeometry(), pos: number[] = [], idx: number[] = [];
    for (const g of landGeo) {
      const o = pos.length / 3, p = g.getAttribute('position').array as Float32Array, ix = g.getIndex()!.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + o);
    }
    merged.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); merged.setIndex(idx);
    const bvh = new MeshBVH(merged), ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
    const ax = x0 + inset, bx = x1 - inset, az = z0 + inset, bz = z1 - inset, w = bx - ax, h = bz - az, round = 2 * (w + h);
    let last = 0;
    for (let s = 0; s < round; s += STEP) {
      const [x, z] = s < w ? [ax + s, az] : s < w + h ? [bx, az + (s - w)] : s < 2 * w + h ? [bx - (s - w - h), bz] : [ax, bz - (s - 2 * w - h)];
      ray.origin.set(x, 5000, z);
      const hit = bvh.raycastFirst(ray, 2);
      if (!hit) misses++;
      last = hit ? hit.point.y + mv.dy : last;
      profile.push(last);
    }
    // (Where a ray found nothing, the height before it; the first ones from the first found.)
    const first = profile.findIndex((v) => v !== 0);
    for (let k = 0; k < first; k++) profile[k] = profile[first];
    // The square in the world: its middle, turned as the frame is, its half-breadths the sheet's less the inset.
    const [cx, , cz] = mv.point((ax + bx) / 2, 0, (az + bz) / 2);
    // (And how far the place's land stands off the world's at each of those points, where the world's land is given: the band the world's
    // land is brought in over goes by it, `withHole`.)
    const gap = worldLand ? Float32Array.from(profile.map((y, k) => {
      const s = k * STEP, [x, z] = s < w ? [ax + s, az] : s < w + h ? [bx, az + (s - w)] : s < 2 * w + h ? [bx - (s - w - h), bz] : [ax, bz - (s - 2 * w - h)];
      const [wx, , wz] = mv.point(x, 0, z);
      return y - worldLand(wx, wz);
    })) : undefined;
    hole = { cx, cz, turn: f.turn, hx: w / 2, hz: h / 2, step: STEP, profile: Float32Array.from(profile), gap };
  }
  // A place whose land does not fill its square (a mountain top's stops where the cloud would hide it, and goes on below as the
  // world's): its hole following its land instead, a lattice read by looking down on its land and rock (`HoleGrid`).
  if (misses > profile.length * 0.02) hole = { ...hole, ...gridHole(meshes, worldLand) };
  // Its cards, but the painted trees of its far land and whatever grows beyond its square, in the world's coordinates.
  const cards: CardSet[] = [];
  for (const set of d.scenery?.cards ?? []) {
    if (set.kind === 'tree' || set.kind === 'fir') continue;
    const matrices: number[] = [], centres: number[] = [], colours: number[] = [];
    for (let i = 0; i < set.matrices.length / 16; i++) {
      if (!within(set.matrices[i * 16 + 12], set.matrices[i * 16 + 14])) continue;
      mv.matrix(set.matrices, i * 16, matrices);
      centres.push(...mv.point(set.centres[i * 3], set.centres[i * 3 + 1], set.centres[i * 3 + 2]));
      colours.push(set.colours[i * 3], set.colours[i * 3 + 1], set.colours[i * 3 + 2]);
    }
    if (matrices.length) cards.push({ ...set, matrices, centres, colours });
  }
  // The solid part in one mesh: the house, and what stands about it but what stops nobody.
  let vertices = 0, indices = 0;
  for (const m of meshes) if (!m.soft) { vertices += m.position.length / 3; indices += m.index.length; }
  const sPos = new Float32Array(vertices * 3), sIdx = new Uint32Array(indices);
  let vo = 0, io = 0;
  for (const m of meshes) if (!m.soft) {
    sPos.set(m.position, vo * 3);
    for (let i = 0; i < m.index.length; i++) sIdx[io++] = m.index[i] + vo;
    vo += m.position.length / 3;
  }
  const solidGeo = new BufferGeometry();
  solidGeo.setAttribute('position', new BufferAttribute(sPos, 3)); solidGeo.setIndex(new BufferAttribute(sIdx, 1));
  const solidBvh = new MeshBVH(solidGeo);
  // Water, in the world: ponds' outlines and streams' courses are points.
  const water = (d.water ?? []).filter((w) => within(w.x, w.z)).map((w) => {
    const [x, , z] = mv.point(w.x, 0, w.z), outline = w.outline ? (() => { const o: number[] = []; for (let k = 0; k < w.outline.length; k += 2) { const [px, , pz] = mv.point(w.outline[k], 0, w.outline[k + 1]); o.push(px, pz); } return o; })() : undefined;
    return { ...w, x, z, level: w.level + mv.dy, outline };
  });
  const streams = (d.streams ?? []).filter((s) => within(s.line[0], s.line[2])).map((s) => { const line: number[] = []; for (let k = 0; k < s.line.length; k += 3) line.push(...mv.point(s.line[k], s.line[k + 1], s.line[k + 2])); return { ...s, line }; });
  const falls = (d.falls ?? []).filter((q) => within(q.x, q.z)).map((q) => { const [x, y, z] = mv.point(q.x, q.y, q.z); return { ...q, x, y, z }; });
  // Its sea (an island's, a harbour town's), in the world: its middle and level moved, its bed laid again on a lattice along the world's
  // own two ways (the sea reads its bed along them), each point read from the place's bed where it falls, by the frame turned back;
  // the spray at the cliffs' feet moved and turned. (Its winter ice is the place's own, and is left.)
  let sea: SeaDesc | undefined;
  if (d.sea) {
    const b = d.sea.bed, c = Math.cos(f.turn), sn = Math.sin(f.turn);
    const corners = [[b.x0, b.z0], [b.x0 + (b.nx - 1) * b.cell, b.z0], [b.x0, b.z0 + (b.nz - 1) * b.cell], [b.x0 + (b.nx - 1) * b.cell, b.z0 + (b.nz - 1) * b.cell]].map(([x, z]) => mv.point(x, 0, z));
    const wx0 = Math.min(...corners.map((q) => q[0])), wx1 = Math.max(...corners.map((q) => q[0])), wz0 = Math.min(...corners.map((q) => q[2])), wz1 = Math.max(...corners.map((q) => q[2]));
    const nx = Math.ceil((wx1 - wx0) / b.cell) + 1, nz = Math.ceil((wz1 - wz0) / b.cell) + 1, data = new Float32Array(nx * nz);
    const bedAt = (x: number, z: number) => {
      const fx = Math.min(b.nx - 1.001, Math.max(0, (x - b.x0) / b.cell)), fz = Math.min(b.nz - 1.001, Math.max(0, (z - b.z0) / b.cell)), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * b.nx + i;
      return (b.data[k] * (1 - tx) + b.data[k + 1] * tx) * (1 - tz) + (b.data[k + b.nx] * (1 - tx) + b.data[k + b.nx + 1] * tx) * tz;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      // (The world's point back into the site: the frame's turn undone about its point.)
      const dx = wx0 + i * b.cell - f.u, dz = wz0 + j * b.cell - f.v, sx = f.hx + c * dx + sn * dz, sz = f.hz - sn * dx + c * dz;
      data[j * nx + i] = bedAt(sx, sz) + mv.dy;
    }
    const [cx, , cz] = mv.point(d.sea.x, 0, d.sea.z);
    sea = {
      level: d.sea.level + mv.dy, x: cx, z: cz, bed: { x0: wx0, z0: wz0, cell: b.cell, nx, nz, data },
      spray: d.sea.spray?.map((q) => { const [x, , z] = mv.point(q.x, 0, q.z), [nx2, , nz2] = mv.dir(q.nx, 0, q.nz); return { x, z, nx: nx2, nz: nz2 }; }),
    };
  }
  // For the bake: the house's masses as boxes square to the world's axes, which is all the bake takes (`bake.ts`), and its lamps.
  // Turned with the place, a box was given as the box about it, larger by as much as the turn: at a turn of eleven degrees a wall's
  // mass stood out past its own outer face, and the bake, finding the face inside stone, drew a dark blot on a gable outside. So where
  // the place is turned off the axes, each mass is cut into near-square pieces and each given as the largest box square to the world's
  // axes that lies within it: a little short of the mass between pieces, which the walls' own faces close, and never past it.
  const masses: number[] = [];
  {
    const ca = Math.abs(Math.cos(f.turn)), sa = Math.abs(Math.sin(f.turn)), square = Math.min(ca, sa) < 0.017;
    for (const m of d.masses) {
      const y0 = m.min.y + mv.dy, y1 = m.max.y + mv.dy;
      if (square) {
        const p = mv.point(m.min.x, 0, m.min.z), q2 = mv.point(m.max.x, 0, m.max.z);
        masses.push(Math.min(p[0], q2[0]), y0, Math.min(p[2], q2[2]), Math.max(p[0], q2[0]), y1, Math.max(p[2], q2[2]));
        continue;
      }
      const L = m.max.x - m.min.x, D = m.max.z - m.min.z, side = Math.max(0.5, Math.min(L, D)), ni = Math.max(1, Math.ceil(L / side)), nj = Math.max(1, Math.ceil(D / side));
      for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
        const a = L / ni / 2, b = D / nj / 2, [cx, , cz] = mv.point(m.min.x + (i + 0.5) * 2 * a, 0, m.min.z + (j + 0.5) * 2 * b);
        // (The half-breadths along the world's x and z of the largest box within a piece of half-breadths a and b turned: solving
        // u ca + v sa = a, u sa + v ca = b, the site's x lying nearer the world's x; else the same with the two turned about. Where that
        // has no answer, near forty-five degrees, a square within the piece's lesser half-breadth.)
        const [p, q2] = ca >= sa ? [a, b] : [b, a], det = Math.abs(ca * ca - sa * sa), hi = Math.max(ca, sa), lo = Math.min(ca, sa);
        let u = det > 0.2 ? (p * hi - q2 * lo) / det : 0, v = det > 0.2 ? (q2 * hi - p * lo) / det : 0;
        if (!(u > 0.02 && v > 0.02)) u = v = Math.min(a, b) / (ca + sa);
        masses.push(cx - u, y0, cz - v, cx + u, y1, cz + v);
      }
    }
  }
  const lights = d.torches.map((t) => {
    // (Where the game's torch puts its light: out from the wall and up a little; on an open fire, over it.)
    const at = t.fire ? t.position.clone().add(new Vector3(0, 0.55, 0)) : t.position.clone().addScaledVector(t.out, 0.36).add(new Vector3(0, 0.26, 0));
    return { pos: mv.point(at.x, at.y, at.z), intensity: [3.2, 1.92, 0.96], range: 30, size: 0.12, keep: true };
  });
  // What lives and burns in it, moved into the world as the rest is; only what is within its square.
  const at = (x: number, y: number, z: number) => mv.point(x, y, z), v3 = (q: Vector3) => at(q.x, q.y, q.z);
  const life: PlaceLife = {
    smokes: (d.smokes ?? []).filter((q) => within(q.x, q.z)).map((q) => { const [x, y, z] = at(q.x, q.y, q.z); return { x, y, z, height: q.height }; }),
    birds: (d.birds ?? []).filter((q) => within(q.x, q.z)).map((q) => { const [x, y, z] = at(q.x, q.y, q.z); return { x, y, z }; }),
    birdKind: d.birdKind,
    flocks: (d.flocks ?? []).filter((q) => within(q.x, q.z)).map((q) => { const [x, , z] = at(q.x, 0, q.z); return { x, z, r: q.r, count: q.count }; }),
    flockKind: d.flockKind,
    torches: d.torches.filter((t) => within(t.position.x, t.position.z)).map((t) => ({ position: v3(t.position), out: mv.dir(t.out.x, t.out.y, t.out.z), fire: t.fire, flames: t.flames?.map(v3) })),
    lamps: (d.lamps ?? []).filter((q) => within(q[0], q[2])).map((q) => at(q[0], q[1], q[2])),
    fireflies: (() => { const o: number[] = []; const ff = d.fireflies ?? []; for (let k = 0; k + 2 < ff.length; k += 3) if (within(ff[k], ff[k + 2])) o.push(...at(ff[k], ff[k + 1], ff[k + 2])); return o; })(),
    beacon: d.beacon && within(d.beacon.x, d.beacon.z) ? (() => { const [x, y, z] = at(d.beacon.x, d.beacon.y, d.beacon.z); return { x, y, z }; })() : undefined,
    rooms: site.places.map((q) => [q.x0, q.x1, q.z0, q.z1] as [number, number, number, number]),
    frame: f,
  };
  // What its game is played with, in its own ways (`PlaceGame`).
  const v = (q: Vector3): [number, number, number] => [q.x, q.y, q.z];
  const game: PlaceGame = {
    site: { places: site.places, ways: site.ways, items: site.items, levers: site.levers, start: site.start, goal: site.goal, secret: site.secret },
    doors: (d.doors ?? []).map((o) => {
      const g = o.leaf?.build();
      const arr = (name: string) => g!.getAttribute(name).array;
      return {
        way: o.way, hinge: v(o.hinge), yaw: o.yaw, swing: o.swing, halfWidth: o.halfWidth, spring: o.spring, thickness: o.thickness, material: o.material,
        blocker: { min: v(o.blocker.min), max: v(o.blocker.max) }, centre: v(o.centre), barSide: o.barSide,
        leaf: g ? { position: arr('position') as Float32Array, normal: arr('normal') as Float32Array, uv: arr('uv') as Float32Array, color: arr('color') as Float32Array, field: arr('aField') as Float32Array, edge: arr('aEdge') as Uint8Array, index: g.getIndex()!.array as Uint32Array } : null,
      };
    }),
    anchors: [...(d.anchors ?? new Map<number, Vector3>())].map(([id, q]) => [id, q.x, q.y, q.z]),
    finds: (d.finds ?? []).map((q) => ({ at: v(q.at), what: q.what })),
  };
  const triangles = meshes.reduce((s, m) => s + m.index.length / 3, 0);
  return {
    ...info, title: d.title ?? '', meshes, cards, hole, water, sea, streams, falls, masses: Float32Array.from(masses), lights, life, game,
    solid: { position: sPos, index: sIdx, bvh: MeshBVH.serialize(solidBvh) },
    ms: { mesh: t1 - t0, pack: performance.now() - t1 }, triangles, misses,
  };
}

/** What of a place is its land, for where it stands: its sheet of turf and of rock, its scree; and its carved rock (`gridHole`). */
const LAND = new Set(['wild|turf', 'wild|rockSheet', 'wild|scree']), ROCK = 'wild|rock';

/**
 * A place's hole as a lattice following its land (`HoleGrid` in `core/stream.ts`), from its packed meshes in the world: every metre,
 * whether its land is there and how high, found by looking down on it. Its carved rock counts as land where it stands near the
 * world's land, not where it stands far over it (twelve metres): the needles of rock that a mountain top raises out of its cloud stand on
 * nothing the world has, and the world's land drawn up to their tops would make cones of them. Below it, the place's rock may lie well
 * down (its land is worn on a lattice of its own, deeper in places by ten metres and more), and it counts down to forty: cut off at
 * twelve both ways, the rock was counted in patches and its edge was ragged. The land found is then taken
 * in by one point all round, so that the world's land, drawn up to its edge and a little in under it, runs in under the place's own;
 * hollows in it (where its house stands, the sheet left out) are filled; and every point is given how far it lies from the edge, and the
 * place's height and its standing off the world's land at the nearest point of the edge. The lattice reaches out beyond the land
 * as far as the band the world's land is brought in over (`withHole`), so that at its edge the world's land is its own.
 */
function gridHole(meshes: PackedMesh[], worldLand?: (x: number, z: number) => number): Pick<Hole, 'cx' | 'cz' | 'hx' | 'hz' | 'turn' | 'grid'> {
  // (A metre, as the world's squares are: at two, the edge could not follow a carved cliff, and the world's land met it a metre and a
  // half off its face.)
  const C = 1;
  const land = meshes.filter((m) => LAND.has(m.key)), rock = meshes.filter((m) => m.key === ROCK);
  let verts = 0, tris = 0;
  for (const m of [...land, ...rock]) { verts += m.position.length / 3; tris += m.index.length / 3; }
  const pos = new Float32Array(verts * 3), idx = new Uint32Array(tris * 3);
  let vo = 0, io = 0, landTris = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const m of [...land, ...rock]) {
    pos.set(m.position, vo * 3);
    for (let i = 0; i < m.index.length; i++) idx[io++] = m.index[i] + vo;
    if (land.includes(m)) { landTris += m.index.length / 3; for (let i = 0; i < m.position.length; i += 3) { x0 = Math.min(x0, m.position[i]); x1 = Math.max(x1, m.position[i]); z0 = Math.min(z0, m.position[i + 2]); z1 = Math.max(z1, m.position[i + 2]); } }
    vo += m.position.length / 3;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setIndex(new BufferAttribute(idx, 1));
  const bvh = new MeshBVH(geo), ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  // (And its land alone, under its rock: see `meets`.)
  const landGeo = new BufferGeometry();
  landGeo.setAttribute('position', new BufferAttribute(pos, 3)); landGeo.setIndex(new BufferAttribute(idx.slice(0, landTris * 3), 1));
  const landBvh = new MeshBVH(landGeo);
  // Looked down on over its land's extent, a point beyond it all round.
  const ix0 = Math.floor(x0 / C) - 1, iz0 = Math.floor(z0 / C) - 1, inx = Math.ceil(x1 / C) + 2 - ix0, inz = Math.ceil(z1 / C) + 2 - iz0;
  const found = new Float32Array(inx * inz).fill(NaN);
  // (The height the world's land is brought to at the edge: the place's land, and under its rock the land at the rock's foot where
  // there is any, not the rock's top. Brought to the top of a crag wherever the crag was taken for the place's land, a metre on and a
  // metre off along it, the world's land stood along a mountain's rim as a comb of spikes.)
  const meets = new Float32Array(inx * inz).fill(NaN);
  for (let j = 0; j < inz; j++) for (let i = 0; i < inx; i++) {
    const x = (ix0 + i) * C, z = (iz0 + j) * C;
    ray.origin.set(x, 1e4, z);
    const hit = bvh.raycastFirst(ray, 2);
    if (!hit) continue;
    const onRock = (hit.faceIndex ?? 0) >= landTris;
    if (onRock && worldLand) { const off = hit.point.y - worldLand(x, z); if (off > 12 || off < -40) continue; }
    found[j * inx + i] = hit.point.y;
    const under = onRock ? landBvh.raycastFirst(ray, 2) : null;
    meets[j * inx + i] = under && under.point.y < hit.point.y + 0.1 ? under.point.y : hit.point.y;
  }
  // How far it stands off the world's land at its edge, which sets how far out the lattice must reach: the broadest band, and a little.
  // (Not past three hundred metres: past that, the band is drawn in to fit.)
  const edgeGap = (k: number, nxx: number, ox: number, oz: number) => (worldLand ? meets[k] - worldLand((ox + (k % nxx)) * C, (oz + Math.floor(k / nxx)) * C) : 0);
  let most = 0;
  for (let j = 1; j < inz - 1; j++) for (let i = 1; i < inx - 1; i++) {
    const k = j * inx + i;
    if (!Number.isNaN(found[k]) && (Number.isNaN(found[k - 1]) || Number.isNaN(found[k + 1]) || Number.isNaN(found[k - inx]) || Number.isNaN(found[k + inx]))) most = Math.max(most, Math.abs(edgeGap(k, inx, ix0, iz0)));
  }
  const reach = Math.min(300, 30 + 3 * most + 8), M = Math.ceil(reach / C), gapMost = (reach - 38) / 3;
  const ox = ix0 - M, oz = iz0 - M, nx = inx + 2 * M, nz = inz + 2 * M, n = nx * nz;
  const y = new Float32Array(n).fill(NaN);
  for (let j = 0; j < inz; j++) y.set(meets.subarray(j * inx, (j + 1) * inx), (j + M) * nx + M);
  // Taken in by a point all round; then what is enclosed filled.
  const cover = new Uint8Array(n);
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let all = true;
    for (let b = -1; b <= 1 && all; b++) for (let a = -1; a <= 1 && all; a++) all = !Number.isNaN(y[(j + b) * nx + i + a]);
    if (all) cover[j * nx + i] = 1;
  }
  {
    const seen = new Uint8Array(n), stack: number[] = [];
    for (let i = 0; i < nx; i++) stack.push(i, (nz - 1) * nx + i);
    for (let j = 0; j < nz; j++) stack.push(j * nx, j * nx + nx - 1);
    while (stack.length) {
      const k = stack.pop()!;
      if (seen[k] || cover[k]) continue;
      seen[k] = 1;
      const i = k % nx, j = (k - i) / nx;
      if (i > 0) stack.push(k - 1); if (i < nx - 1) stack.push(k + 1); if (j > 0) stack.push(k - nx); if (j < nz - 1) stack.push(k + nx);
    }
    for (let k = 0; k < n; k++) if (!cover[k] && !seen[k]) cover[k] = 1;
  }
  // (A height for every point inside, where filled from the nearest found.)
  const known = nearestOf(nx, nz, (k) => !Number.isNaN(y[k]));
  const yAt = (k: number) => (Number.isNaN(y[k]) ? y[known[k]] : y[k]);
  const inner = nearestOf(nx, nz, (k) => cover[k] === 1), outer = nearestOf(nx, nz, (k) => cover[k] === 0);
  const dist = (a: number, b: number) => C * Math.hypot((a % nx) - (b % nx), Math.floor(a / nx) - Math.floor(b / nx));
  const gaps = new Map<number, number>();
  const gapOf = (k: number) => { let g = gaps.get(k); if (g === undefined) gaps.set(k, (g = Math.max(-gapMost, Math.min(gapMost, worldLand ? yAt(k) - worldLand((ox + (k % nx)) * C, (oz + Math.floor(k / nx)) * C) : 0)))); return g; };
  const out = new Float32Array(n), edge = new Float32Array(n), gap = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (cover[k]) {
      const d = outer[k] >= 0 ? dist(k, outer[k]) : Infinity;
      out[k] = -(d - C / 2); edge[k] = yAt(k); gap[k] = d < 4 * C ? gapOf(k) : 0;
    } else {
      const s = inner[k];
      if (s < 0) { out[k] = 1e6; continue; }
      out[k] = dist(k, s) - C / 2; gap[k] = gapOf(s);
      // (The place's land just outside its edge: where it was found there (the edge was taken in by a point), as found; beyond, the
      // world's own land as far off it as at the nearest point of the edge, so that it goes on down a slope as the world's does. Held
      // level from the edge instead, on a mountainside the world's land was brought up to a shelf over the six metres it is met in.)
      edge[k] = !Number.isNaN(y[k]) ? y[k] : worldLand && out[k] < 10 ? worldLand((ox + (k % nx)) * C, (oz + Math.floor(k / nx)) * C) + gap[k] : yAt(s);
    }
  }
  const grid: HoleGrid = { x0: ox * C, z0: oz * C, cell: C, nx, nz, out, edge, gap };
  return { cx: (ox + nx / 2) * C, cz: (oz + nz / 2) * C, hx: (nx * C) / 2, hz: (nz * C) / 2, turn: 0, grid };
}

/**
 * For every point of a lattice, the nearest point of it for which `seed` holds (its index; less than nothing if there is none): passed
 * over forwards and back twice, each point taking its neighbours' nearest where that is nearer to it, which finds the nearest but for
 * rare cases a fraction of a point out.
 */
function nearestOf(nx: number, nz: number, seed: (k: number) => boolean): Int32Array {
  const n = nx * nz, near = new Int32Array(n).fill(-1), d2 = new Float64Array(n).fill(Infinity);
  for (let k = 0; k < n; k++) if (seed(k)) { near[k] = k; d2[k] = 0; }
  const ahead = [[-1, 0], [-1, -1], [0, -1], [1, -1]], back = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let round = 0; round < 4; round++) {
    const fwd = round % 2 === 0, offs = fwd ? ahead : back;
    for (let jj = 0; jj < nz; jj++) {
      const j = fwd ? jj : nz - 1 - jj;
      for (let ii = 0; ii < nx; ii++) {
        const i = fwd ? ii : nx - 1 - ii, k = j * nx + i;
        for (const [di, dj] of offs) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const s = near[b * nx + a];
          if (s < 0) continue;
          const si = s % nx, sj = (s - si) / nx, dd = (i - si) * (i - si) + (j - sj) * (j - sj);
          if (dd < d2[k]) { d2[k] = dd; near[k] = s; }
        }
      }
    }
  }
  return near;
}

/** Every typed array's buffer in a pack, for handing it over from a worker rather than copying it. */
export function packTransfer(p: PlacePack): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: { buffer: ArrayBufferLike } | null | undefined) => { if (a && a.buffer instanceof ArrayBuffer) out.add(a.buffer); };
  for (const m of p.meshes) for (const a of [m.position, m.normal, m.uv, m.color, m.field, m.edge, m.index, m.open, m.own, m.source, m.scale]) add(a);
  add(p.solid.position); add(p.solid.index); add(p.hole.profile); add(p.hole.gap); add(p.hole.grid?.out); add(p.hole.grid?.edge); add(p.hole.grid?.gap); add(p.masses); add(p.sea?.bed.data);
  for (const r of p.solid.bvh.roots) if (r instanceof ArrayBuffer) out.add(r);
  add(p.solid.bvh.index as { buffer: ArrayBufferLike });
  return [...out];
}
