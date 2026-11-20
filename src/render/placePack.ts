import { BufferAttribute, BufferGeometry, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Site } from '../core/site';
import { Hole } from '../core/stream';
import { siteFrame, SiteFrame } from '../core/worldLand';
import { MeshBuilder } from './geom/meshBuilder';
import { CardSet, SceneDescription } from './scene';
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
  streams: SceneDescription['streams'];
  falls: SceneDescription['falls'];
  /** For the bake: the house's masses (boxes, six numbers each, in the world), and its lights (each at a point, `keep`: baked in). */
  masses: Float32Array;
  lights: { pos: number[]; intensity: number[]; range: number; size: number; keep?: boolean }[];
  /** How long it took, milliseconds: laying out was before; meshing, and making ready. */
  ms: { mesh: number; pack: number };
  triangles: number;
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

/** The numbers of a mesh builder's mesh, turned into the world's coordinates. */
function packBuilder(key: string, b: MeshBuilder, mv: ReturnType<typeof frameMover>, baked: boolean): PackedMesh {
  const g = b.build(), n = b.vertexCount;
  const pos = (g.getAttribute('position').array as Float32Array).slice(0, n * 3), nrm = (g.getAttribute('normal').array as Float32Array).slice(0, n * 3);
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
    index: Uint32Array.from(g.getIndex()!.array as ArrayLike<number>),
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
  const meshes: PackedMesh[] = [];
  for (const [k, b] of d.meshes) if (b.vertexCount) meshes.push(packBuilder(k, b, mv, true));
  // (What stands about the house, but its far land: kept in its own site's coordinates a moment longer, for the square's measure below.)
  const land: MeshBuilder[] = [];
  for (const [k, b] of d.scenery?.meshes ?? []) {
    if (!b.vertexCount || k === 'soft|far') continue;
    if (k === 'wild|turf' || k === 'wild|rockSheet') land.push(b);
    // (Cut into tiles of 64 metres, as the game cuts what stands about a place; not the house, whose light is baked as one.)
    meshes.push(...tilePacked(packBuilder(k, b, mv, false), 64));
  }
  // The square of land it was laid over: as far as its own sheet of turf reaches, in its site.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const landGeo: BufferGeometry[] = [];
  for (const b of land) {
    const g = b.build(), p = g.getAttribute('position').array as Float32Array;
    for (let i = 0; i < b.vertexCount; i++) { x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]); z0 = Math.min(z0, p[i * 3 + 2]); z1 = Math.max(z1, p[i * 3 + 2]); }
    landGeo.push(g);
  }
  // Its land's height all round the edge of that square, a little inside it, where the sheet surely is: found by looking down on the
  // land alone (not its trees, rock or buildings).
  const STEP = 2, inset = 1.5;
  const profile: number[] = [];
  let hole: PlaceHole;
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
  // Its cards, but the painted trees of its far land, in the world's coordinates.
  const cards: CardSet[] = [];
  for (const set of d.scenery?.cards ?? []) {
    if (set.kind === 'tree' || set.kind === 'fir') continue;
    const matrices: number[] = [], centres: number[] = [];
    for (let i = 0; i < set.matrices.length / 16; i++) mv.matrix(set.matrices, i * 16, matrices);
    for (let i = 0; i < set.centres.length / 3; i++) centres.push(...mv.point(set.centres[i * 3], set.centres[i * 3 + 1], set.centres[i * 3 + 2]));
    cards.push({ ...set, matrices, centres, colours: set.colours.slice() });
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
  const water = (d.water ?? []).map((w) => {
    const [x, , z] = mv.point(w.x, 0, w.z), outline = w.outline ? (() => { const o: number[] = []; for (let k = 0; k < w.outline.length; k += 2) { const [px, , pz] = mv.point(w.outline[k], 0, w.outline[k + 1]); o.push(px, pz); } return o; })() : undefined;
    return { ...w, x, z, level: w.level + mv.dy, outline };
  });
  const streams = (d.streams ?? []).map((s) => { const line: number[] = []; for (let k = 0; k < s.line.length; k += 3) line.push(...mv.point(s.line[k], s.line[k + 1], s.line[k + 2])); return { ...s, line }; });
  const falls = (d.falls ?? []).map((q) => { const [x, y, z] = mv.point(q.x, q.y, q.z); return { ...q, x, y, z }; });
  // For the bake: the house's masses as boxes in the world (each box's corners turned, and the box about them), and its lamps.
  const masses: number[] = [];
  for (const m of d.masses) {
    let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    for (const cx of [m.min.x, m.max.x]) for (const cz of [m.min.z, m.max.z]) for (const cy of [m.min.y, m.max.y]) {
      const p = mv.point(cx, cy, cz);
      a = a.map((v, k) => Math.min(v, p[k])); b = b.map((v, k) => Math.max(v, p[k]));
    }
    masses.push(...a, ...b);
  }
  const lights = d.torches.map((t) => {
    // (Where the game's torch puts its light: out from the wall and up a little; on an open fire, over it.)
    const at = t.fire ? t.position.clone().add(new Vector3(0, 0.55, 0)) : t.position.clone().addScaledVector(t.out, 0.36).add(new Vector3(0, 0.26, 0));
    return { pos: mv.point(at.x, at.y, at.z), intensity: [3.2, 1.92, 0.96], range: 30, size: 0.12, keep: true };
  });
  const triangles = meshes.reduce((s, m) => s + m.index.length / 3, 0);
  return {
    ...info, title: d.title ?? '', meshes, cards, hole, water, streams, falls, masses: Float32Array.from(masses), lights,
    solid: { position: sPos, index: sIdx, bvh: MeshBVH.serialize(solidBvh) },
    ms: { mesh: t1 - t0, pack: performance.now() - t1 }, triangles,
  };
}

/** Every typed array's buffer in a pack, for handing it over from a worker rather than copying it. */
export function packTransfer(p: PlacePack): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: { buffer: ArrayBufferLike } | null | undefined) => { if (a && a.buffer instanceof ArrayBuffer) out.add(a.buffer); };
  for (const m of p.meshes) for (const a of [m.position, m.normal, m.uv, m.color, m.field, m.edge, m.index, m.open, m.own, m.source, m.scale]) add(a);
  add(p.solid.position); add(p.solid.index); add(p.hole.profile); add(p.hole.gap); add(p.masses);
  for (const r of p.solid.bvh.roots) if (r instanceof ArrayBuffer) out.add(r);
  add(p.solid.bvh.index as { buffer: ArrayBufferLike });
  return [...out];
}
