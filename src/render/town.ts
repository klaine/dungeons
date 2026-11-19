import { Vector3 } from 'three';
import { fbm2, fbm3, Rng } from '../core/rng';
import { Building, Site, Town } from '../core/site';
import { frameAt, inBuilding, inHarbour, nearLine, outsideBlock, outsideBuilt, outsideRect, riverAt, squareY, townGround, townLand } from '../core/town';
import { footprintOf } from '../core/building';
import { MeshBuilder } from './geom/meshBuilder';
import { alongSheet, carveRock } from './geom/rock';
import { boulderForm, cliffRelief, erode, Grid2, ROCK, Strata } from './geom/rockForms';
import { layTerrain, turfColour } from './landscape';
import { Colour, growConifer, growTree } from './planting';
import { CardSet } from './scene';
import { anyAngle, layBoat, layBollard } from './coast';
import { buildShack } from './shack';
import { buildBuilding } from './buildings';
import { layWall } from './walls';
import { hallGeometry } from './greatHall';
import type { IslandBuild, IslandResult } from './island';

/**
 * The town, built from what the site document says of it: its land, as found and as made, with
 * the sea's cliffs and the crags of the headland carved as rock; the harbour, its quay, its moles
 * and its light; the house's terrace and the stair down from it into the square; the market and
 * its fountain; the blocks of buildings, classical and timber, turned to their streets; the
 * shacks; the fields and their walls; the woods; and the country round about to the mountains.
 * It is the counterpart of the island's builder (`island.ts`) and takes the valley's approach's
 * place when the site is a town.
 *
 * The streets, the square and the waterfront are paved in the ground's own material: the sheet of
 * ground over them carries a field that says what it is (setts for a street, flags for the square),
 * and the material draws the stones (`makeGroundMaterial`), so that paving follows every rise and
 * fall of a street without a seam.
 */

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
type P3 = [number, number, number];

/** What the ground is at each point of the town, on a lattice: so that the sheet, the planting and the walls ask once. */
const Z = { wild: 0, street: 1, flags: 2, built: 3, yard: 4, track: 5, path: 6, shack: 7, field: 8, quay: 9, harbour: 10, river: 11 } as const;
/** What a way of the town is laid with: its own surface, or its kind's usual one (setts for a street or lane, earth for a track, a trodden line for a path). */
const surfaceOf = (s: Town['streets'][number]) => s.surface ?? (s.kind === 'street' || s.kind === 'lane' ? 'setts' : s.kind === 'track' ? 'dirt' : 'foot');

export function buildTown(b: IslandBuild): IslandResult & { smokes: { x: number; y: number; z: number; height: number }[] } {
  const { site, p, kit, wild } = b;
  const t = site.town!, F = p.floor, sea = t.sea, g = site.grounds!, L = t.land;
  const rng = b.rng.fork('town');
  const s1 = rng.range(0, 60), s2 = rng.range(0, 60);
  const ground = (x: number, z: number) => townGround(t, F, x, z);
  const made = townLand(t, F);
  const rockKind = ROCK[site.setting.stone];
  const tint = b.stoneTint;
  const insideOuter = (x: number, z: number, m = 0) => b.outerRects.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);

  // ---- what the ground is, point by point, on a lattice of a metre
  const ZC = 1, zx0 = L.x0, zz0 = L.z0, znx = Math.round((L.x1 - L.x0) / ZC) + 1, znz = Math.round((L.z1 - L.z0) / ZC) + 1;
  const zone = new Uint8Array(znx * znz), fieldOf = new Int16Array(znx * znz).fill(-1), offWay = new Float32Array(znx * znz).fill(99);
  // (And how far in from the paving's edge each point is, less than nothing outside it, and whether it is flags or setts.)
  const pave = new Float32Array(znx * znz).fill(-9), flagsAt = new Uint8Array(znx * znz), trodden = new Uint8Array(znx * znz);
  {
    const paint = (r: { x0: number; x1: number; z0: number; z1: number }, fn: (k: number, x: number, z: number) => void) => {
      const i0 = Math.max(0, Math.floor((r.x0 - zx0) / ZC)), i1 = Math.min(znx - 1, Math.ceil((r.x1 - zx0) / ZC)), j0 = Math.max(0, Math.floor((r.z0 - zz0) / ZC)), j1 = Math.min(znz - 1, Math.ceil((r.z1 - zz0) / ZC));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * znx + i, zx0 + i * ZC, zz0 + j * ZC);
    };
    // Fields first, then whatever lies over them.
    t.fields.forEach((f, n) => {
      const xs = f.corners.map((c) => c[0]), zs = f.corners.map((c) => c[1]);
      paint({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }, (k, x, z) => {
        // (Inside the four corners: on the inner side of every edge, going round.)
        for (let e = 0; e < 4; e++) { const [ax, az] = f.corners[e], [bx, bz] = f.corners[(e + 1) % 4]; if ((bx - ax) * (z - az) - (bz - az) * (x - ax) < 0) return; }
        zone[k] = Z.field; fieldOf[k] = n;
      });
    });
    for (const blk of t.blocks) paint(blk, (k, x, z) => { if (outsideBlock(blk, x, z) === 0) zone[k] = Z.yard; });
    for (const s of t.streets) {
      const xs = s.line.map((q) => q[0]), zs = s.line.map((q) => q[1]), half = s.width / 2;
      paint({ x0: Math.min(...xs) - half - 1, x1: Math.max(...xs) + half + 1, z0: Math.min(...zs) - half - 1, z1: Math.max(...zs) + half + 1 }, (k, x, z) => {
        const n = nearLine(s.line, x, z);
        if (n.off > half) return;
        // (What it is laid with decides how it is drawn: stone of any kind, and gravel, as paving; beaten earth as a track, with ruts.)
        const surf = surfaceOf(s), kind = surf === 'foot' ? Z.path : surf === 'dirt' ? Z.track : Z.street;
        if (kind === Z.street || zone[k] !== Z.street) { zone[k] = kind; offWay[k] = n.off; }
        // (A street or a lane of beaten earth is trodden bare across its breadth, not two ruts in the grass as a track out in the fields is.)
        if (surf === 'dirt' && s.width > 3 && n.off < half - 0.4) trodden[k] = 1;
      });
    }
    paint(t.square, (k) => { zone[k] = Z.flags; });
    paint({ x0: t.quay.x0, x1: t.quay.x1, z0: t.quay.z - t.quay.apron, z1: t.quay.z }, (k) => { zone[k] = Z.flags; });
    paint(p, (k) => { zone[k] = Z.flags; });
    // The paving: each street as it is laid (setts, flags or gravel; earth is not paving), the square, the waterfront and the forecourt in flags.
    for (const s of t.streets) {
      const surf = surfaceOf(s);
      if (surf === 'dirt' || surf === 'foot') continue;
      const xs = s.line.map((q) => q[0]), zs = s.line.map((q) => q[1]), half = s.width / 2, kind = surf === 'flags' ? 1 : surf === 'gravel' ? 2 : 0;
      paint({ x0: Math.min(...xs) - half - 3, x1: Math.max(...xs) + half + 3, z0: Math.min(...zs) - half - 3, z1: Math.max(...zs) + half + 3 }, (k, x, z) => {
        const d = half - nearLine(s.line, x, z).off;
        if (d > pave[k]) { pave[k] = d; flagsAt[k] = kind; }
      });
    }
    for (const r of [t.square, { x0: t.quay.x0, x1: t.quay.x1, z0: t.quay.z - t.quay.apron, z1: t.quay.z + 0.6 }, { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 + 0.3 }]) paint({ x0: r.x0 - 3, x1: r.x1 + 3, z0: r.z0 - 3, z1: r.z1 + 3 }, (k, x, z) => {
      const d = x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 ? Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z) : -outsideRect(r, x, z);
      if (d > pave[k] - 0.3) { pave[k] = Math.max(pave[k], d); flagsAt[k] = 1; }
    });
    for (const bd of t.buildings) { const r = Math.max(bd.w, bd.d) + 14; paint({ x0: bd.x - r, x1: bd.x + r, z0: bd.z - r, z1: bd.z + r }, (k, x, z) => { if (outsideBuilt(bd, x, z) < 0.6) zone[k] = Z.built; }); }
    for (const s of t.shacks) { const r = Math.max(s.w, s.d); paint({ x0: s.x - r, x1: s.x + r, z0: s.z - r, z1: s.z + r }, (k, x, z) => { if (Math.hypot(x - s.x, z - s.z) < r * 0.62) zone[k] = Z.shack; }); }
    // (The storehouses' quays, a band either side of their line: made, not rock; and the outlook's ring, flagged.)
    for (const w of t.wharves) { const xs = w.line.map((q0) => q0[0]), zs = w.line.map((q0) => q0[1]); paint({ x0: Math.min(...xs) - 6, x1: Math.max(...xs) + 6, z0: Math.min(...zs) - 6, z1: Math.max(...zs) + 6 }, (k, x, z) => { if (nearLine(w.line.map(([a, c]) => [a, c, 0] as P3), x, z).off < 4.5) zone[k] = Z.quay; }); }
    if (t.outlook) { const o = t.outlook; paint({ x0: o.x - 7, x1: o.x + 7, z0: o.z - 7, z1: o.z + 7 }, (k, x, z) => { if (Math.hypot(x - o.x, z - o.z) < 6.3) zone[k] = Z.built; }); }
    // (The storehouses and the decks before them.)
    for (const s of t.storehouses) { const r = s.d / 2 + 3, fx = Math.cos(s.turn), fz = Math.sin(s.turn); paint({ x0: s.x - r, x1: s.x + r, z0: s.z - r, z1: s.z + r }, (k, x, z) => { const f = (x - s.x) * fx + (z - s.z) * fz, a = -(x - s.x) * fz + (z - s.z) * fx; if (Math.abs(a) < s.w / 2 + 0.4 && f > -s.d / 2 - 0.4 && f < s.d / 2 + 2.4) zone[k] = Z.built; }); }
    paint({ x0: t.quay.x0 - 20, x1: t.quay.x1 + 20, z0: t.quay.z, z1: t.quay.z + 200 }, (k, x, z) => { if (inHarbour(t, x, z)) zone[k] = Z.harbour; });
    // The river, its bed and the foot of its banks, over whatever lay there: no paving and nothing growing in it.
    if (t.river) {
      const xs = t.river.line.map((q0) => q0[0]), zs = t.river.line.map((q0) => q0[1]), wide = Math.max(...t.river.width) / 2 + 3;
      paint({ x0: Math.min(...xs) - wide, x1: Math.max(...xs) + wide, z0: Math.min(...zs) - wide, z1: Math.max(...zs) + wide }, (k, x, z) => {
        const r = riverAt(t, x, z);
        if (r.off < r.half + (r.walled ? 0.3 : 1.2)) { zone[k] = Z.river; pave[k] = -9; }
      });
    }
  }
  const zoneAt = (x: number, z: number) => { const i = Math.round((x - zx0) / ZC), j = Math.round((z - zz0) / ZC); return i < 0 || j < 0 || i >= znx || j >= znz ? Z.wild : zone[j * znx + i]; };
  const fieldAt = (x: number, z: number) => { const i = Math.round((x - zx0) / ZC), j = Math.round((z - zz0) / ZC); return i < 0 || j < 0 || i >= znx || j >= znz ? -1 : fieldOf[j * znx + i]; };
  const earthAt = (x: number, z: number) => { const i = Math.round((x - zx0) / ZC), j = Math.round((z - zz0) / ZC); return i >= 0 && j >= 0 && i < znx && j < znz && trodden[j * znx + i] === 1; };
  const wayOff = (x: number, z: number) => { const i = Math.round((x - zx0) / ZC), j = Math.round((z - zz0) / ZC); return i < 0 || j < 0 || i >= znx || j >= znz ? 99 : offWay[j * znx + i]; };
  /** How far in from the paving's edge a point is (less than nothing outside it), read between the lattice's points; and whether it is flags. */
  const paveAt = (x: number, z: number): { d: number; flags: boolean; gravel: boolean } => {
    const fx = (x - zx0) / ZC, fz = (z - zz0) / ZC, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= znx - 1 || j >= znz - 1) return { d: -9, flags: false, gravel: false };
    const a = fx - i, c = fz - j, k = j * znx + i;
    return { d: pave[k] * (1 - a) * (1 - c) + pave[k + 1] * a * (1 - c) + pave[k + znx] * (1 - a) * c + pave[k + znx + 1] * a * c, flags: flagsAt[Math.round(fz) * znx + Math.round(fx)] >= 1, gravel: flagsAt[Math.round(fz) * znx + Math.round(fx)] === 2 };
  };

  // ---- the house's garden, behind it, on the open ground between the blocks either side of the square's line, wherever that is
  // lawn and gentle: walks of gravel on a square grid struck from the house's middle and from a walk along its back; between them
  // beds bordered by low clipped hedges with a gap in each side, every other bed planted with flowers in rows on bare earth and the
  // rest lawn with a clipped cone in its middle; cones of yew at the corners of the beds either side of the main walk; and a sundial
  // where four beds meet nearest the middle. It follows the ground's gentle rise; nothing is levelled for it. (That ground had been
  // one lawn climbing behind the house, the largest bare thing in the town seen from above.)
  const garden = { hedges: [] as [number, number, number, number][], cones: [] as [number, number, number][], beds: [] as { x0: number; x1: number; z0: number; z1: number; flowers: boolean; n: number }[], dial: null as [number, number] | null };
  const bedOf = new Uint8Array(znx * znz);
  const bedOf_ = (x: number, z: number) => { const i = Math.round((x - zx0) / ZC), j = Math.round((z - zz0) / ZC); return i >= 0 && j >= 0 && i < znx && j < znz ? bedOf[j * znx + i] : 0; };
  /** Whether a point is in one of the garden's flower beds; and in one of its lawns, which are mown. */
  const bedAt = (x: number, z: number) => bedOf_(x, z) === 1, mownAt = (x: number, z: number) => bedOf_(x, z) === 2;
  if (b.outerRects.length) {
    const lv = t.level, R = { x0: Math.max(L.x0, t.square.x0) + 2, x1: Math.min(L.x1, t.square.x1) - 2, z0: Math.max(L.z0, lv.z0 - 110), z1: lv.z1 - 2 };
    const hx = (Math.min(...b.outerRects.map((r) => r.x0)) + Math.max(...b.outerRects.map((r) => r.x1))) / 2, zRef = Math.min(...b.outerRects.map((r) => r.z0)) - 4.4;
    const S = 13, half = 1.2, clearOfHouse = 3;
    // (Open, and gentle: nowhere steeper than about one in four. The ground there is worn land, not graded, and uneven in small
    // bumps; held to one in seven, the garden was refused on single points and came out a pair of beds in a great lawn.)
    const gentle = (x: number, z: number) => Math.hypot(ground(x + 1, z) - ground(x - 1, z), ground(x, z + 1) - ground(x, z - 1)) < 0.5;
    const plain = (x: number, z: number) => zoneAt(x, z) === Z.wild && gentle(x, z);
    const houseOff = (x: number, z: number) => Math.min(...b.outerRects.map((r) => outsideRect({ x0: r.x0 - clearOfHouse, x1: r.x1 + clearOfHouse, z0: r.z0 - clearOfHouse, z1: r.z1 + clearOfHouse }, x, z)));
    const lineOff = (v: number, o: number) => { const m = (((v - o) % S) + S) % S; return Math.min(m, S - m); };
    // The beds first, so that the walks are laid only where they lead between beds or round them.
    const ci0 = Math.floor((R.x0 - hx) / S) - 1, ci1 = Math.ceil((R.x1 - hx) / S) + 1, cj0 = Math.floor((R.z0 - zRef) / S) - 1, cj1 = Math.ceil((R.z1 - zRef) / S) + 1;
    const bedAtCell = new Map<string, number>(), fits = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const r = { x0: hx + ci * S + half + 0.6, x1: hx + (ci + 1) * S - half - 0.6, z0: zRef + cj * S + half + 0.6, z1: zRef + (cj + 1) * S - half - 0.6 };
      let ok = r.x0 > R.x0 && r.x1 < R.x1 && r.z0 > R.z0 && r.z1 < R.z1;
      for (let z = r.z0 - 2; z <= r.z1 + 2.01 && ok; z += 1) for (let x = r.x0 - 2; x <= r.x1 + 2.01 && ok; x += 1) if (!plain(x, z) || houseOff(x, z) < 0) ok = false;
      if (ok) fits.set(`${ci},${cj}`, r);
    }
    // (Only in pairs either side of the house's line, so that the garden is as symmetrical as the house; laid one-sided where the
    // ground let it, it looked like a garden abandoned half made.)
    for (const [key, r] of fits) {
      const [ci, cj] = key.split(',').map(Number);
      if (!fits.has(`${-1 - ci},${cj}`)) continue;
      bedAtCell.set(key, garden.beds.length);
      garden.beds.push({ ...r, flowers: (((ci + cj) % 2) + 2) % 2 === 0, n: garden.beds.length });
    }
    if (garden.beds.length >= 2) {
      // The walks: round every bed, out to the next; gravel, with the band about it that the ground's material needs to draw its edge.
      for (let j = 0; j < znz; j++) for (let i = 0; i < znx; i++) {
        const x = zx0 + i * ZC, z = zz0 + j * ZC;
        if (x < R.x0 - 3 || x > R.x1 + 3 || z < R.z0 - 3 || z > R.z1 + 3) continue;
        const ci = Math.floor((x - hx) / S), cj = Math.floor((z - zRef) / S);
        // (A walk runs along a grid line only where a bed lies on one side of it or the other.)
        const bx = lineOff(x, hx), bz = lineOff(z, zRef);
        const ciL = Math.round((x - hx) / S), cjL = Math.round((z - zRef) / S);
        const alongX = garden.beds.length && (bedAtCell.has(`${ci},${cjL}`) || bedAtCell.has(`${ci},${cjL - 1}`));
        const alongZ = garden.beds.length && (bedAtCell.has(`${ciL},${cj}`) || bedAtCell.has(`${ciL - 1},${cj}`));
        const d = Math.min(alongX ? bz : 99, alongZ ? bx : 99);
        if (d > 99) continue;
        const sd = Math.min(half - d, x - R.x0 + 2, R.x1 + 2 - x, z - R.z0 + 2, R.z1 + 2 - z, houseOff(x, z) + 0.5);
        if (sd < -2.4) continue;
        const k = j * znx + i, open = zone[k] === Z.wild && gentle(x, z);
        if (!open) continue;
        if (sd > pave[k]) { pave[k] = sd; flagsAt[k] = 2; }
        if (sd > 0) zone[k] = Z.flags;
      }
      for (const bd of garden.beds) {
        const i0 = Math.ceil((bd.x0 + 0.5 - zx0) / ZC), i1 = Math.floor((bd.x1 - 0.5 - zx0) / ZC), j0 = Math.ceil((bd.z0 + 0.5 - zz0) / ZC), j1 = Math.floor((bd.z1 - 0.5 - zz0) / ZC);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bedOf[j * znx + i] = bd.flowers ? 1 : 2;
        // The hedge: round the bed a little in from its edge, with a gap in the middle of each side.
        const e = 0.35, gap = 0.8, mx = (bd.x0 + bd.x1) / 2, mz = (bd.z0 + bd.z1) / 2, X0 = bd.x0 + e, X1 = bd.x1 - e, Z0 = bd.z0 + e, Z1 = bd.z1 - e;
        garden.hedges.push([X0, Z0, mx - gap, Z0], [mx + gap, Z0, X1, Z0], [X0, Z1, mx - gap, Z1], [mx + gap, Z1, X1, Z1], [X0, Z0, X0, mz - gap], [X0, mz + gap, X0, Z1], [X1, Z0, X1, mz - gap], [X1, mz + gap, X1, Z1]);
        if (!bd.flowers) garden.cones.push([mx, mz, 1.6]);
      }
      // Yew at the corners of the beds either side of the main walk, and the sundial.
      for (const [key, n] of bedAtCell) {
        const [ci] = key.split(',').map(Number), bd = garden.beds[n];
        if (ci === -1) garden.cones.push([bd.x1 - 0.35, bd.z0 + 0.35, 2.6], [bd.x1 - 0.35, bd.z1 - 0.35, 2.6]);
        if (ci === 0) garden.cones.push([bd.x0 + 0.35, bd.z0 + 0.35, 2.6], [bd.x0 + 0.35, bd.z1 - 0.35, 2.6]);
      }
      let best = Infinity;
      const mid = { x: (R.x0 + R.x1) / 2, z: (R.z0 + R.z1) / 2 };
      for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
        if (![[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]].every(([a, c]) => bedAtCell.has(`${a},${c}`))) continue;
        const x = hx + ci * S, z = zRef + cj * S, d = Math.hypot(x - mid.x, z - mid.z) + Math.abs(ci) * 4;
        if (d < best) { best = d; garden.dial = [x, z]; }
      }
    } else garden.beds.length = 0;
  }

  // ---- the rock: wherever the made land is steep, which is the sea's cliffs and the crags of the headland and the hills,
  // carved as the island's cliffs are, in tiles
  const strata = new Strata(rockKind, rng.fork('strata'), sea, { fold: 6, faults: 4, around: [(L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2, 600] });
  const relief = cliffRelief(strata, rng.fork('relief').int(1, 9999));
  // The great hall in the rock, if the town has one, and the stair down to it: their air, as the mountain top's.
  const H = t.hall, hallGeo = H ? hallGeometry(H) : null;
  const hallAir = (x: number, y: number, z: number) => (hallGeo ? hallGeo.air(x, y, z) : -9);
  const stairLine = H?.stair ?? [], stairBox = stairLine.length ? { x0: Math.min(...stairLine.map((p0) => p0[0])) - 6, x1: Math.max(...stairLine.map((p0) => p0[0])) + 6, z0: Math.min(...stairLine.map((p0) => p0[1])) - 6, z1: Math.max(...stairLine.map((p0) => p0[1])) + 6 } : null;
  const stairAt = { x: NaN, z: NaN, off: Infinity, y: 0 };
  const stairAir = (x: number, y: number, z: number): number => {
    if (!stairBox || x < stairBox.x0 || x > stairBox.x1 || z < stairBox.z0 || z > stairBox.z1) return -9;
    if (x !== stairAt.x || z !== stairAt.z) { stairAt.x = x; stairAt.z = z; const n = nearLine(stairLine, x, z); stairAt.off = n.off; stairAt.y = n.y; }
    if (stairAt.off > 3.2) return -9;
    const rough = (fbm3(x * 0.45, y * 0.45, z * 0.45, 2) - 0.5) * 0.4;
    return Math.min(1.4 - stairAt.off + rough, y - stairAt.y, stairAt.y + 3.0 - (stairAt.off / 1.4) ** 2 * 0.8 - y + rough);
  };
  /** Whether a point across the ground is near the hall or its stair, so that the rock there is carved with them. */
  const nearHall = (x: number, z: number, m: number) => {
    if (hallGeo) { const { u, v } = hallGeo.inHall(x, z); if (u > -27 - m && u < hallGeo.frame.L + 4 + m && Math.abs(v) < hallGeo.frame.half + 22 + m) return true; }
    return !!stairBox && x > stairBox.x0 - m && x < stairBox.x1 + m && z > stairBox.z0 - m && z < stairBox.z1 + m && nearLine(stairLine, x, z).off < 5 + m;
  };
  const CELL = 0.4, SHEET = 1.2, TILE = 9.6;
  const snap = (v: number, up: boolean, to = TILE) => (up ? Math.ceil(v / to - 1e-6) : Math.floor(v / to + 1e-6)) * to;
  const area = { x0: snap(L.x0 + 4, true), x1: snap(L.x1 - 4, false), z0: snap(L.z0 + 4, true), z1: snap(L.z1 - 4, false) };
  const steepAt = (x: number, z: number) => { const y = ground(x, z); return Math.hypot(ground(x + 1.2, z) - y, ground(x, z + 1.2) - y) / 1.2 > 1.05; };
  const tilesX = Math.round((area.x1 - area.x0) / TILE), tilesZ = Math.round((area.z1 - area.z0) / TILE), tiles = new Uint8Array(tilesX * tilesZ);
  for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    let any = false;
    for (let z = area.z0 + j * TILE + 0.6; z < area.z0 + (j + 1) * TILE && !any; z += SHEET) for (let x = area.x0 + i * TILE + 0.6; x < area.x0 + (i + 1) * TILE && !any; x += SHEET) {
      // (Nothing the town made is rock: not the harbour's quay or its dug basin, nor ground levelled under a building.)
      const zn = zoneAt(x, z);
      if (zn === Z.harbour || zn === Z.flags || zn === Z.built || zn === Z.street || zn === Z.quay) continue;
      any = (steepAt(x, z) && ground(x, z) > sea - 4) || nearHall(x, z, 0);
    }
    tiles[j * tilesX + i] = any ? 1 : 0;
  }
  const carvedTile = (i: number, j: number) => i >= 0 && j >= 0 && i < tilesX && j < tilesZ && tiles[j * tilesX + i] === 1;
  const carved = (x: number, z: number) => {
    const fi = (x - area.x0) / TILE, fj = (z - area.z0) / TILE;
    for (const i of [Math.floor(fi + 1e-6), Math.floor(fi - 1e-6)]) for (const j of [Math.floor(fj + 1e-6), Math.floor(fj - 1e-6)]) if (carvedTile(i, j)) return true;
    return false;
  };
  const MARGIN = 3.2;
  const land = new Grid2(area.x0 - MARGIN, area.z0 - MARGIN, CELL, Math.round((area.x1 - area.x0 + 2 * MARGIN) / CELL) + 1, Math.round((area.z1 - area.z0 + 2 * MARGIN) / CELL) + 1);
  const known = new Uint8Array(land.data.length), inside = new Uint8Array(land.data.length);
  let anyRock = false;
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
    known[k] = 1; inside[k] = carved(x, z) ? 1 : 0; anyRock = true;
    land.data[k] = ground(x, z);
  }
  const loose = land.like(), wornBy = land.like();
  if (anyRock) {
    const far = new Float32Array(land.data.length), nx = land.nx, nz = land.nz, D1 = CELL, D2 = CELL * Math.SQRT2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) far[j * nx + i] = i > 0 && j > 0 && i < nx - 1 && j < nz - 1 && inside[j * nx + i] ? 1e6 : 0;
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k - 1] + D1, far[k - nx] + D1, far[k - nx - 1] + D2, far[k - nx + 1] + D2); }
    for (let j = nz - 2; j > 0; j--) for (let i = nx - 2; i > 0; i--) { const k = j * nx + i; if (far[k]) far[k] = Math.min(far[k], far[k + 1] + D1, far[k + nx] + D1, far[k + nx + 1] + D2, far[k + nx - 1] + D2); }
    const before = land.data.slice(), active = new Uint8Array(land.data.length);
    for (let k = 0; k < land.data.length; k++) if (inside[k] && far[k] >= 0.8) active[k] = 1;
    erode({
      rock: land, loose, active, repose: 0.67, kept: 0.16, passes: 40,
      holds: (k, y) => { const x = land.x0 + (k % land.nx) * CELL, z = land.z0 + Math.floor(k / land.nx) * CELL, hard = y < sea + 4 ? 0.95 : strata.hardness(Math.floor(strata.at(x, y, z))); return 0.7 + hard * hard * hard * 7; },
    });
    for (let k = 0; k < land.data.length; k++) {
      if (land.data[k] + loose.data[k] < sea + 0.4) loose.data[k] *= 0.3;
      land.data[k] += loose.data[k];
      wornBy.data[k] = land.data[k] - before[k];
    }
  }
  const worn = (x: number, z: number): number => (anyRock && wornBy.holds(x, z) ? ground(x, z) + wornBy.at(x, z) : ground(x, z));
  const steepness = land.like(), rocky = land.like(), upX = land.like(), upZ = land.like();
  {
    const H = land.data, nxL = land.nx, raw = new Float32Array(H.length);
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < nxL; i++) {
      const k = j * nxL + i;
      steepness.data[k] = 1;
      if (!known[k]) continue;
      const w = i > 0 && known[k - 1] ? k - 1 : k, e = i < nxL - 1 && known[k + 1] ? k + 1 : k, n = j > 0 && known[k - nxL] ? k - nxL : k, s = j < land.nz - 1 && known[k + nxL] ? k + nxL : k;
      const gx = e > w ? (H[e] - H[w]) / ((e - w) * CELL) : 0, gz = s > n ? (H[s] - H[n]) / (((s - n) / nxL) * CELL) : 0, slope = Math.hypot(gx, gz);
      steepness.data[k] = Math.sqrt(1 + slope * slope);
      upX.data[k] = gx; upZ.data[k] = gz;
      raw[k] = smooth((slope - 0.85) / 0.6) * (1 - smooth(loose.data[k] / 0.3));
    }
    const ease = (data: Float32Array, times: number) => {
      const from = new Float32Array(data.length);
      for (let tt = 0; tt < times; tt++) {
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
    for (let k = 0; k < H.length; k++) { rocky.data[k] = raw[k]; const l = Math.hypot(upX.data[k], upZ.data[k]), f = l > 1e-6 ? smooth(l / 0.8) / l : 0; upX.data[k] *= f; upZ.data[k] *= f; }
  }
  const stepBeds = Math.max(1, Math.round(1.3 / rockKind.bed)), stepped = Math.min(1, rockKind.bedded * 1.4);
  const spot = { x: NaN, z: NaN, rocky: 0, h: 0, steep: 1, slope: 0, ux: 0, uz: 0 };
  const density = (x: number, y: number, z: number): number => {
    if (x !== spot.x || z !== spot.z) {
      spot.x = x; spot.z = z;
      spot.rocky = rocky.at(x, z); spot.h = land.at(x, z); spot.steep = steepness.at(x, z);
      if (spot.rocky >= 0.002) { spot.slope = Math.sqrt(Math.max(0.04, spot.steep * spot.steep - 1)); spot.ux = upX.at(x, z); spot.uz = upZ.at(x, z); }
    }
    const d = (y - spot.h) / spot.steep;
    if (spot.rocky < 0.002 || d > 5.4 || d < -5.4) return d;
    let out = Math.min(2.4, Math.max(-2.4, relief.broad(x, y, z)));
    if (Math.abs(d - out * spot.rocky) > 1.5 * spot.rocky + 0.45) return d - out * spot.rocky;
    let fine = relief.fine(x, y, z);
    const tread = strata.at(x, y, z) / stepBeds + 0.31, within = tread - Math.floor(tread);
    fine += Math.max(-0.9, Math.min(0.9, ((within - 0.5) * stepBeds * rockKind.bed) / spot.slope)) * stepped;
    fine *= 0.45 + 0.55 * smooth((y - sea - 0.5) / 2.5);
    out += Math.max(-1.5, Math.min(1.5, fine));
    out *= spot.rocky;
    const sx = x + out * spot.ux, sz = z + out * spot.uz;
    return (y - land.at(sx, sz)) / steepness.at(sx, sz);
  };

  const landAir = density, carving = H ? (x: number, y: number, z: number) => Math.max(landAir(x, y, z), hallAir(x, y, z), stairAir(x, y, z)) : landAir;
  // ---- colours: the rock by the sea, the ground and what lies on it
  const outcrop: Colour = [0.5 + 0.5 * tint[0], 0.52 + 0.5 * tint[1], 0.56 + 0.5 * tint[2]];
  const blotSeed = rng.fork('blot').int(1, 9999);
  const mixC = (c: Colour, to: Colour, k: number) => { c[0] += (to[0] - c[0]) * k; c[1] += (to[1] - c[1]) * k; c[2] += (to[2] - c[2]) * k; };
  const shadeRock = (q: Vector3, n: Vector3, field: Float32Array, open: number): Colour => {
    const i = Math.floor(strata.at(q.x, q.y, q.z)), tb = strata.shade(i), soft = 1 - strata.hardness(i);
    const blot = fbm3(q.x * 0.3, q.y * 0.3, q.z * 0.3, 3, blotSeed), tone = (0.72 + 0.56 * blot) * (0.7 + 0.3 * open);
    const c: Colour = [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
    const pale = rockKind.pale, dark = rockKind.dark;
    c[0] *= dark[0] + (pale[0] - dark[0]) * tb; c[1] *= dark[1] + (pale[1] - dark[1]) * tb; c[2] *= dark[2] + (pale[2] - dark[2]) * tb;
    const up = Math.max(0, n.y), h = q.y - sea, steepFace = 1 - Math.abs(n.y);
    const k = 0.78 + 0.5 * fbm2(q.x / 38 + 5.3, q.z / 38, 2, blotSeed + 21);
    c[0] *= k; c[1] *= k; c[2] *= k;
    const seep = smooth((fbm3(q.x * 0.42, q.y * 0.035, q.z * 0.42, 2, blotSeed + 25) - 0.6) / 0.08) * steepFace * smooth((h - 2) / 3);
    mixC(c, [c[0] * 0.45, c[1] * 0.42, c[2] * 0.4], seep * 0.7);
    const patch = fbm3(q.x * 0.21 + 3, q.y * 0.35, q.z * 0.21, 3, blotSeed + 11), fleck = fbm3(q.x * 1.1, q.y * 1.1, q.z * 1.1, 2, blotSeed + 5);
    field[0] = Math.min(1, up * 0.6 + soft * 0.3 * (1 - open)); field[1] = 0;
    // (In the hall and on its stair, under the rock, there are no bands of the tide, and the torches have sooted it.)
    if (H && (hallAir(q.x, q.y, q.z) > -0.8 || stairAir(q.x, q.y, q.z) > -0.8)) { field[2] = 1; field[3] = 0.25 + 0.75 * rockKind.bedded; return c; }
    if (h < 0.2) { mixC(c, [0.05, 0.06, 0.035], 0.75); field[1] = 1; field[0] = 0.7; }
    else if (h < 1.6) { mixC(c, [c[0] * 0.45, c[1] * 0.45, c[2] * 0.42], 0.8); mixC(c, fleck > 0.5 ? [0.09, 0.075, 0.03] : [0.06, 0.06, 0.03], smooth((patch - 0.38) / 0.12) * (1 - smooth((h - 1.1) / 0.5))); field[1] = 1 - smooth((h - 0.8) / 0.8) * 0.5; }
    else if (h < 4.2) { mixC(c, [0.035, 0.035, 0.035], (1 - smooth((h - 2.6 - patch * 1.4) / 0.9)) * 0.8); field[1] = 0.25 * (1 - smooth((h - 2) / 1.5)); }
    else mixC(c, fleck > 0.52 ? [0.55, 0.32, 0.07] : [0.36, 0.38, 0.29], smooth((patch - 0.5) / 0.1) * (0.4 + 0.6 * up) * (1 - smooth((h - 26) / 10)) * open * 0.75);
    field[3] = 0.25 + 0.75 * rockKind.bedded;
    return c;
  };
  const season = site.setting.season ?? 'spring';
  // The stone the town is paved and built with: the country's own, a little paler for being cut and dressed.
  const paving: Colour = [0.62 * (0.55 + 0.45 * tint[0]), 0.6 * (0.55 + 0.45 * tint[1]), 0.57 * (0.55 + 0.45 * tint[2])];
  /** The colour of a crop, in its season, as a tint on the turf. */
  const cropTint = (crop: Town['fields'][number]['crop']): Colour => {
    const ripe = season === 'summer' ? 0.6 : season === 'autumn' ? 1 : 0;
    switch (crop) {
      case 'wheat': return ripe ? [1.25 + 0.25 * ripe, 1.05 + 0.1 * ripe, 0.45] : [0.85, 1.12, 0.6];
      case 'barley': return ripe ? [1.35 + 0.2 * ripe, 1.2 + 0.05 * ripe, 0.6] : [0.92, 1.15, 0.66];
      case 'oats': return ripe ? [1.15 + 0.2 * ripe, 1.1, 0.62] : [0.8, 1.05, 0.62];
      case 'roots': return [0.6, 0.85, 0.45];
      case 'fallow': return [0.9, 0.8, 0.6];
      default: return [1, 1, 1];
    }
  };
  const lay = { code: 0, wet: 0, bare: 0, litter: 0 };
  /** The ground's colour at a point, and in `lay` what it is besides: paved, a track, wet, bare, under leaves. */
  const turfAt = (x: number, z: number, y: number): Colour => {
    const zn = zoneAt(x, z), above = y - sea;
    lay.code = 0; lay.wet = 1 - smooth((above - 0.15) / 0.5); lay.bare = 0; lay.litter = 0;
    const c = turfColour(x, z, s1);
    // The shore: shingle and sand above the water and under it.
    const shore = 1 - smooth((above - 1.1) / 0.8);
    // (Paving, and the ground within a stride or two of it, carries how far in from the paving's edge it is, so that the material can
    // draw the edge where it truly is, and the paving's colour, which on the ground beside it is the dust of the street.)
    if (zn === Z.river) { lay.wet = 1; lay.bare = 1; return shade(c, 0.6); }
    const pv = paveAt(x, z);
    if (pv.d > -2.4) {
      // (How far in, in one band for every kind; and the kind in the litter channel, which paving has no other use for. See the
      // ground's material.)
      lay.code = -(300 + pv.d);
      lay.litter = pv.gravel ? -2 : pv.flags ? -1 : 0;
      const tone = 0.85 + 0.3 * fbm2(x * 0.08 + s2, z * 0.08, 2);
      if (pv.d > 0) return shade(paving, tone);
      const c0 = turfColour(x, z, s1);
      return [c0[0] * 0.75 + paving[0] * 0.6, c0[1] * 0.75 + paving[1] * 0.5, c0[2] * 0.75 + paving[2] * 0.5];
    }
    // (The garden's flower beds are dug earth between the rows.)
    if (bedAt(x, z)) { lay.bare = 0.95; lay.wet = Math.max(lay.wet, 0.25); return c; }
    if (zn === Z.track || zn === Z.path) {
      const off = wayOff(x, z);
      lay.code = zn === Z.track ? 100 + off * (fbm2(x * 0.3, z * 0.3, 2) > 0.5 ? 1 : -1) : 200 + off;
      if (earthAt(x, z)) lay.bare = 0.8 + 0.15 * fbm2(x * 0.25, z * 0.25, 2);
    }
    if (zn === Z.built || zn === Z.shack || zn === Z.yard) lay.bare = zn === Z.yard ? 0.25 + 0.4 * smooth((fbm2(x * 0.2, z * 0.2, 2) - 0.45) / 0.2) : 0.75;
    let tintC: Colour = [1, 1, 1];
    if (zn === Z.field) {
      const f = t.fields[fieldAt(x, z)];
      if (f) {
        tintC = cropTint(f.crop);
        if (f.crop === 'fallow') lay.bare = 0.7 + 0.2 * fbm2(x * 0.3, z * 0.3, 2);
        // (Roots and vines in rows, with the earth between them.)
        if (f.crop === 'roots' || f.crop === 'vines') { const row = Math.abs(((x * 0.6 + z * 0.08) % 1.6 + 1.6) % 1.6 - 0.8); lay.bare = Math.max(lay.bare, smooth((row - 0.3) / 0.2) * 0.85); }
      }
    }
    lay.bare = Math.max(lay.bare, shore, loose.holds(x, z) ? smooth(loose.at(x, z) / 0.28) * 0.45 : 0);
    // Under the woods, last year's leaves.
    lay.litter = woodAt(x, z) * 0.7;
    const salt = smooth((10 - above) / 8) * 0.3;
    return [c[0] * tintC[0] * (1 + 0.15 * salt), c[1] * tintC[1] * (1 - 0.05 * salt), c[2] * tintC[2] * (1 - 0.2 * salt)];
  };
  const earth = (x: number, z: number): Colour => { const tt = 0.62 + 0.5 * fbm2(x * 0.5 + s2, z * 0.5 + s1, 3); return [0.5 * tt * outcrop[0], 0.47 * tt * outcrop[1], 0.43 * tt * outcrop[2]]; };
  /** How much a point is wood, 0 to 1: out of the town and its fields, off the shore, on land not too steep, in broad stands, more higher up. */
  function woodAt(x: number, z: number): number {
    const zn = zoneAt(x, z);
    if (zn !== Z.wild) return 0;
    const y = ground(x, z), above = y - sea;
    if (above < 5) return 0;
    const fromTown = Math.min(outsideRect(t.square, x, z), ...t.blocks.map((r) => outsideBlock(r, x, z)));
    const stand = smooth((fbm2(x * 0.011 + s1, z * 0.011 - s2, 3) - 0.42 + 0.12 * smooth((above - 30) / 60)) / 0.12);
    return stand * smooth((fromTown - 30) / 30) * smooth((above - 5) / 10);
  }

  // ---- carving: each steep tile as a piece
  wild.group = 'wild';
  const turfMesh = wild.mesh('turf'), screeMesh = wild.mesh('scree'), rockMesh = wild.mesh('rock');
  const sheetEdge = alongSheet(worn, area.x0, area.z0, SHEET);
  if (anyRock) for (let j = 0; j < tilesZ; j++) for (let i = 0; i < tilesX; i++) {
    if (!tiles[j * tilesX + i]) continue;
    const c = { x0: area.x0 + i * TILE, x1: area.x0 + (i + 1) * TILE, z0: area.z0 + j * TILE, z1: area.z0 + (j + 1) * TILE };
    let lo = Infinity, hi = -Infinity;
    const REACH = 4.5;
    for (let z = c.z0 - REACH; z < c.z1 + REACH + CELL / 2; z += CELL) for (let x = c.x0 - REACH; x < c.x1 + REACH + CELL / 2; x += CELL) { const h = land.at(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    // (Deep enough for the hall's chasm, and for the stair where it runs under the tile.)
    if (H && nearHall((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, TILE)) lo = Math.min(lo, H.floor - H.chasm.depth - 2.5, ...stairLine.filter(([x, z]) => x > c.x0 - 6 && x < c.x1 + 6 && z > c.z0 - 6 && z < c.z1 + 6).map((p0) => p0[2] - 1.5));
    carveRock(rockMesh, carving, {
      min: V(c.x0, Math.floor(Math.max(lo - 2, sea - 4.8) / CELL) * CELL, c.z0), max: V(c.x1, Math.ceil((Math.max(hi, sea - 3) + 2.8) / CELL) * CELL, c.z1),
      cell: CELL, uvScale: 0.4, otherUvScale: (m) => (m === screeMesh ? 0.55 : 2.3), fromSamples: true, occlusion: [0.3, 0.75], sharp: true, beyond: carved, edge: sheetEdge,
      meshFor: (n, at) => (n.y > 0.74 && rocky.at(at.x, at.z) < 0.5 && !(H && (hallAir(at.x, at.y + 0.6, at.z) > 0 || (stairAir(at.x, at.y + 0.6, at.z) > 0 && ground(at.x, at.z) - at.y > 1.5))) ? (loose.at(at.x, at.z) > 0.3 && at.y > sea + 0.6 ? screeMesh : turfMesh) : null),
      shade: (q, n, field, other, open) => {
        if (other === turfMesh) { const col = turfAt(q.x, q.z, q.y); field[0] = lay.code; field[1] = lay.wet; field[2] = lay.bare; field[3] = lay.litter; return col; }
        if (other === screeMesh) return earth(q.x, q.z);
        return shadeRock(q, n, field, open);
      },
    });
  }

  // ---- the sheet of ground over all that is not carved, out under the sea a little way
  layTerrain(turfMesh, wild.mesh('rockSheet'), worn, {
    area, cell: SHEET, seed: s1, stone: tint, turfScale: 2.3, rockScale: 0.4, bare: 0.62,
    colour: (x, z) => { const y = worn(x, z), c = turfAt(x, z, y); return [c[0], c[1], c[2], lay.code, lay.wet, lay.bare, lay.litter]; },
    rock: (tone) => [0.4 * tone * outcrop[0] * 0.8, 0.4 * tone * outcrop[1] * 0.8, 0.4 * tone * outcrop[2] * 0.8],
    skip: (c) => { const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2; return (carved(mx, mz) && Math.max(worn(c.x0, c.z0), worn(c.x1, c.z0), worn(c.x0, c.z1), worn(c.x1, c.z1)) > sea - 4.6) || insideOuter(mx, mz); },
    warp: (x, z) => {
      if (!insideOuter(x, z)) return [x, z];
      let best: [number, number] = [x, z], least = Infinity;
      for (const r of b.outerRects) {
        const cx = Math.min(r.x1, Math.max(r.x0, x)), cz = Math.min(r.z1, Math.max(r.z0, z));
        for (const [px, pz] of [[r.x0 - 0.02, cz], [r.x1 + 0.02, cz], [cx, r.z0 - 0.02], [cx, r.z1 + 0.02]] as [number, number][]) { const d = Math.hypot(px - x, pz - z); if (d < least && !insideOuter(px, pz)) { least = d; best = [px, pz]; } }
      }
      return best;
    },
  });

  const mesh = (m: string) => wild.mesh(m);
  const { face, solid, rounded } = anyAngle(mesh);
  const stone: Colour = [0.74 * tint[0] + 0.1, 0.72 * tint[1] + 0.1, 0.68 * tint[2] + 0.1];
  /** A frame turned to face a bearing about a point: `a` to the right as one faces it, `f` forward, `h` up. */
  const frame = (x: number, z: number, y: number, facing: number) => { const fx = Math.cos(facing), fz = Math.sin(facing); return (a: number, h: number, f: number): P3 => [x + fx * f - fz * a, y + h, z + fz * f + fx * a]; };
  // (`bevel`, if given, takes the edges off by that much: see `chamfered`.)
  const box = (at: ReturnType<typeof frame>, material: string, a0: number, a1: number, h0: number, h1: number, f0: number, f1: number, colour: Colour, scale = 0.5, bevel = 0) => {
    const c: P3[] = [at(a0, h0, f0), at(a1, h0, f0), at(a1, h0, f1), at(a0, h0, f1), at(a0, h1, f0), at(a1, h1, f0), at(a1, h1, f1), at(a0, h1, f1)];
    if (bevel > 0) rounded(material, c, colour, bevel, scale); else solid(material, c, colour, scale);
  };
  /** Courses of dressed blocks along a line from `a` to `c` (in a frame facing out from the face), from `y0` up to `y1`, `deep` thick. */
  const masonry = (at: ReturnType<typeof frame>, a0: number, a1: number, y0: number, y1: number, deep: number, q: Rng, colour: Colour, weedTo = -Infinity) => {
    let row = 0;
    for (let y = y0; y < y1 - 0.02; row++) {
      const hgt = Math.min(y1 - y, q.range(0.42, 0.62));
      for (let a = a0 - (row % 2) * q.range(0.3, 0.7); a < a1 - 0.02;) {
        const len = q.range(0.9, 1.7), s = Math.max(a0, a), e = Math.min(a1, a + len);
        if (e - s > 0.05) {
          const tone = q.range(0.78, 1.08), wet = y + hgt < weedTo + 0.2;
          box(at, 'stone', s + 0.015, e - 0.015, y + 0.012, y + hgt - 0.012, -q.range(0, 0.04), deep, wet ? [0.12 * tone, 0.13 * tone, 0.09 * tone] : shade(colour, tone), 0.4);
        }
        a += len;
      }
      y += hgt;
    }
    // (The joints behind: one dark block the whole of the face, set back, so no light comes through between the stones.)
    box(at, 'stone', a0, a1, y0, y1, 0.04, deep, shade(colour, 0.35), 0.4);
  };

  // ---- the harbour: the quay's face and coping, its bollards and steps; the moles; the light
  const q = t.quay, deck = q.y;
  {
    const h = rng.fork('quay'), at = frame((q.x0 + q.x1) / 2, q.z, 0, -Math.PI / 2);
    // (In this frame the quay's face looks out to sea, which is +z: forward is -z, back into the quay; `a` runs west along it.)
    const half = (q.x1 - q.x0) / 2, bed = sea - 4;
    // (Where a river comes through the quay into the harbour, its face is open across the river's breadth, and its walls turn in.)
    const mouth = t.river ? [riverAt(t, t.river.line[t.river.line.length - 1][0], q.z).half, t.river.line[t.river.line.length - 1][0] - (q.x0 + q.x1) / 2] : null;
    const spans: [number, number][] = mouth ? [[-half, mouth[1] - mouth[0] - 0.3], [mouth[1] + mouth[0] + 0.3, half]] : [[-half, half]];
    const open = (a: number, m: number) => !!mouth && Math.abs(a - mouth[1]) < mouth[0] + m;
    for (const [a0, a1] of spans) {
      masonry(at, a0, a1, bed, deck - 0.3, 1.6, h, stone, sea + 0.4);
      // The coping: long stones laid across the edge, standing a little out over the face.
      for (let a = a0; a < a1 - 0.05;) {
        const len = h.range(1.1, 1.9), e = Math.min(a1, a + len);
        box(at, 'stone', a + 0.02, e - 0.02, deck - 0.3, deck, -0.12, 0.9, shade(stone, h.range(0.95, 1.12)), 0.4, 0.025);
        a = e;
      }
    }
    // Bollards of iron along the edge, and now and then steps down the face into the water.
    for (let a = -half + 6; a < half - 4; a += h.range(9, 15)) {
      if (open(a, 2)) continue;
      const [bx, , bz] = at(a, 0, 0.55);
      bollard(bx, bz, deck, h);
    }
    for (const a of [-half * h.range(0.3, 0.6), half * h.range(0.3, 0.6)]) {
      if (open(a, 4) || open(a + 3, 4)) continue;
      // (Let into the face: each step a block from the face out, the flight running along it down to the water.)
      for (let k = 0; k < 9; k++) {
        const y = deck - 0.3 - k * 0.27;
        if (y < sea - 0.6) break;
        box(at, 'stone', a + k * 0.32, a + k * 0.32 + 1.2, y - 0.27, y, -1.25, 0.02, shade(stone, h.range(0.8, 1)), 0.4, 0.02);
      }
    }
  }
  function bollard(x: number, z: number, y: number, h: Rng) {
    // (Black, or gone to rust: as the jetty's, turned and smoothly round.)
    layBollard(mesh, [x, y, z], h.chance(0.5) ? 0.1 : 1);
  }
  // The moles: a causeway of big blocks, battered, from the sea bed to a deck of flags, with a parapet along its seaward side
  // and blocks of rough stone heaped against its foot out there, where the sea breaks.
  t.moles.forEach((m, mi) => {
    const h = rng.fork(`mole${mi}`), half = m.width / 2;
    // Which side of the line is the harbour's: towards the quay's middle.
    const midX = (q.x0 + q.x1) / 2;
    for (let k = 0; k + 1 < m.line.length; k++) {
      const [ax, az] = m.line[k], [bx, bz] = m.line[k + 1], len = Math.hypot(bx - ax, bz - az), heading = Math.atan2(bz - az, bx - ax);
      // (A frame looking along the segment: `a` to its right. The harbour lies on the side towards the quay's middle.)
      const at = frame(ax, az, 0, heading), right = [Math.cos(heading + Math.PI / 2), Math.sin(heading + Math.PI / 2)];
      const inner = Math.sign((midX - ax) * right[0] + (q.z + 30 - az) * right[1]) || 1;
      // (The segments overlap a little at their joints, so that no gap shows where the line turns.)
      const f0 = k ? -half * 0.6 : 0, f1 = len + (k + 2 < m.line.length ? half * 0.6 : 0);
      const bed = Math.min(sea - 2, ...[0, 0.5, 1].map((s) => ground(ax + (bx - ax) * s, az + (bz - az) * s) - 0.5));
      for (const side of [-1, 1]) {
        const sat = frame(...(at(side * half, 0, 0).filter((_, n) => n !== 1) as [number, number]), 0, heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
        // (In the side's own frame the face looks out from the mole: `a` runs back along it.)
        const back = frame(ax + Math.cos(heading + side * Math.PI / 2) * half, az + Math.sin(heading + side * Math.PI / 2) * half, 0, heading + side * Math.PI / 2);
        void sat;
        masonry((aa, hh, ff) => back(side > 0 ? -aa : aa, hh, -ff), f0, f1, bed, m.y - 0.25, 1.4, h.fork(`face${k}${side}`), stone, sea + 0.4);
      }
      // The deck: big flags across the width.
      for (let f = f0; f < f1 - 0.05;) {
        const l2 = Math.min(f1 - f, h.range(1.2, 2)), parts = h.chance(0.5) ? 2 : 3;
        for (let n = 0; n < parts; n++) {
          const a0 = -half + (n / parts) * m.width, a1 = -half + ((n + 1) / parts) * m.width;
          box(at, 'stone', a0 + 0.02, a1 - 0.02, m.y - 0.3, m.y + h.range(-0.02, 0.01), f + 0.02, f + l2 - 0.02, shade(stone, h.range(0.82, 1.08)), 0.4);
        }
        f += l2;
      }
      // The core between the faces, so that nothing shows through.
      box(at, 'stone', -half + 1.2, half - 1.2, bed, m.y - 0.3, f0, f1, shade(stone, 0.3), 0.4);
      // The parapet on the seaward side.
      const outer = -inner;
      for (let f = f0; f < f1 - 0.05;) {
        const l2 = Math.min(f1 - f, h.range(1, 1.6));
        box(at, 'stone', outer > 0 ? half - 0.7 : -half, outer > 0 ? half : -half + 0.7, m.y - 0.02, m.y + 1.05, f + 0.015, f + l2 - 0.015, shade(stone, h.range(0.8, 1.05)), 0.4);
        box(at, 'stone', outer > 0 ? half - 0.78 : -half - 0.08, outer > 0 ? half + 0.08 : -half + 0.78, m.y + 1.05, m.y + 1.22, f + 0.015, f + l2 - 0.015, shade(stone, h.range(1, 1.15)), 0.4);
        f += l2;
      }
      // Rough blocks against the seaward foot.
      for (let f = 0; f < len; f += h.range(1.6, 2.8)) {
        const s = h.range(0.9, 1.8), off = outer * (half + h.range(0.6, 2.6)), y = sea + h.range(-1.2, 0.5), [cx, , cz] = at(off, 0, f), turn = h.range(0, Math.PI);
        const r = frame(cx, cz, y, turn), tip = h.range(-0.25, 0.25);
        solid('stone', [r(-s / 2, -s, -s / 2), r(s / 2, -s, -s / 2), r(s / 2, -s, s / 2), r(-s / 2, -s, s / 2), r(-s / 2 + tip, s * 0.4, -s / 2), r(s / 2, s * 0.45 + tip, -s / 2), r(s / 2 - tip, s * 0.4, s / 2), r(-s / 2, s * 0.35, s / 2)], shade(stone, h.range(0.5, 0.75)), 0.4);
      }
    }
    // Its head: rounded off in a ring of blocks about the end; and about its start too, if it stands off in the sea and does not
    // begin at the quay.
    const free = Math.abs(m.line[0][1] - q.z) > 4;
    for (const [ex, ez] of free ? [m.line[m.line.length - 1], m.line[0]] : [m.line[m.line.length - 1]]) {
      for (let n = 0; n < 12; n++) {
        const a = (n / 12) * Math.PI * 2, r = frame(ex, ez, 0, a);
        box(r, 'stone', -half * 0.28, half * 0.28, sea - 3, m.y - 0.02, half * 0.55, half, shade(stone, h.range(0.8, 1)), 0.4);
      }
      box(frame(ex, ez, 0, 0), 'stone', -half * 0.75, half * 0.75, sea - 3, m.y - 0.02, -half * 0.75, half * 0.75, shade(stone, 0.9), 0.4);
    }
  });
  // The harbour light: a round tower of stone on the head of the longer mole, white-washed, with a gallery and a lantern.
  let lamp: { x: number; y: number; z: number } | undefined;
  if (t.light) {
    const lh = t.light, at = frame(lh.x, lh.z, lh.y, lh.door), n = 18, white: Colour = [0.88, 0.87, 0.83], band: Colour = [0.55, 0.1, 0.07];
    const ring = (y0: number, y1: number, r0: number, r1: number, material: string, colour: Colour, from = 0, to = n) => {
      for (let k = from; k < to; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, ri0 = r0 - 0.4, ri1 = r1 - 0.4;
        solid(material, [at(Math.cos(a0) * ri0, y0, Math.sin(a0) * ri0), at(Math.cos(a0) * r0, y0, Math.sin(a0) * r0), at(Math.cos(a1) * r0, y0, Math.sin(a1) * r0), at(Math.cos(a1) * ri0, y0, Math.sin(a1) * ri0),
          at(Math.cos(a0) * ri1, y1, Math.sin(a0) * ri1), at(Math.cos(a0) * r1, y1, Math.sin(a0) * r1), at(Math.cos(a1) * r1, y1, Math.sin(a1) * r1), at(Math.cos(a1) * ri1, y1, Math.sin(a1) * ri1)], colour);
      }
    };
    const H = lh.height, rT = lh.r * 0.82;
    // (The door faces back along the mole: the segment of the wall there is left out up to the door's head, and a lintel laid over.)
    ring(0, 2.2, lh.r, lh.r - (lh.r - rT) * (2.2 / H), 'plaster', white, 1, n);
    box(at, 'stone', -0.6, 0.6, 2.1, 2.4, lh.r - 0.6, lh.r + 0.05, shade(stone, 1.1));
    box(at, 'wood', -0.5, 0.5, 0, 2.1, lh.r - 0.32, lh.r - 0.24, [0.12, 0.2, 0.16]);
    for (let y = 2.2; y < H - 0.01; y += 1.4) {
      const y1 = Math.min(H, y + 1.4), r0 = lh.r - (lh.r - rT) * (y / H), r1 = lh.r - (lh.r - rT) * (y1 / H);
      ring(y, y1, r0, r1, 'plaster', Math.floor(y / 1.4) % 3 === 1 ? band : white);
    }
    // The gallery and its rail, the lantern of glass in iron bars, and its cap.
    ring(H, H + 0.25, rT + 0.7, rT + 0.7, 'stone', shade(stone, 1.05));
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; box(frame(lh.x + Math.cos(a) * (rT + 0.55), lh.z + Math.sin(a) * (rT + 0.55), lh.y, 0), 'metal', -0.025, 0.025, H + 0.25, H + 1.2, -0.025, 0.025, [0.06, 0.06, 0.065]); }
    ring(H + 1.15, H + 1.22, rT + 0.6, rT + 0.6, 'metal', [0.06, 0.06, 0.065]);
    ring(H + 0.25, H + 2.1, rT * 0.75, rT * 0.75, 'glass', [0.25, 0.3, 0.3]);
    ring(H + 2.1, H + 2.3, rT * 0.85, rT * 0.85, 'metal', [0.1, 0.1, 0.1]);
    ring(H + 2.3, H + 3.1, rT * 0.8, 0.45, 'metal', [0.12, 0.2, 0.16]);
    box(at, 'metal', -0.3, 0.3, H + 0.6, H + 1.4, -0.3, 0.3, [1.0, 0.85, 0.5]);
    lamp = { x: lh.x, y: lh.y + H + 1.2, z: lh.z };
  }
  // Boats: drawn up on the shore, and moored in the harbour; each moored one a mesh of its own, so that it can ride the swell.
  t.boats.forEach((bt, n) => layBoat(wild, mesh, bt, n, sea, ground, rng.fork(`boat${n}`)));

  // ---- what lies about on the quay: crates, barrels, sacks and nets in heaps along it, landed and waiting; and a crane of timber
  // beside the ship, to swing what she carries ashore, with a barrel on its hook
  {
    const h = rng.fork('cargo');
    /** A barrel standing or lying on its side: staves bellied out to the middle, two hoops of iron, and its ends. */
    const barrel = (x: number, z: number, y: number, r: number, tall: number, upright: boolean, turn: number) => {
      const at = frame(x, z, y, turn), n = 10, oak: Colour = shade([0.56, 0.41, 0.26], h.range(0.8, 1.12)), hoop: Colour = [0.1, 0.09, 0.08];
      // (A point at angle `a` round the axis, `s` along it, `rr` out from it; lying, the axis runs forward at the height of the belly.)
      const P = (a: number, s: number, rr: number): P3 => (upright ? at(Math.cos(a) * rr, s, Math.sin(a) * rr) : at(Math.cos(a) * rr, r + Math.sin(a) * rr, s - tall / 2));
      const centre = P(0, tall / 2, 0), belly = (s: number) => r * (0.86 + 0.14 * Math.sin((s / tall) * Math.PI));
      const ring = (s: number, out = 0) => Array.from({ length: n }, (_, k) => P((k / n) * Math.PI * 2, s, belly(s) + out));
      const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tall);
      for (let j = 0; j + 1 < steps.length; j++) {
        const lo = ring(steps[j]), hi = ring(steps[j + 1]);
        for (let k = 0; k < n; k++) face('wood', [lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]], k % 2 ? oak : shade(oak, 0.9), centre, 0.9);
      }
      for (const s of [0, tall]) face('wood', ring(s), shade(oak, 0.8), centre, 0.9);
      for (const s of [tall * 0.14, tall * 0.86]) {
        const lo = ring(s - 0.025, 0.012), hi = ring(s + 0.025, 0.012);
        for (let k = 0; k < n; k++) face('metal', [lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]], hoop, centre);
      }
    };
    /** A crate of boards, with battens round it top and bottom. */
    const crate = (at: ReturnType<typeof frame>, a: number, f: number, y: number, w: number, d: number, tall: number) => {
      const c: Colour = shade([0.55, 0.43, 0.28], h.range(0.75, 1.1));
      box(at, 'wood', a - w / 2, a + w / 2, y, y + tall, f - d / 2, f + d / 2, c, 0.9);
      for (const yy of [y + 0.04, y + tall - 0.11]) box(at, 'wood', a - w / 2 - 0.015, a + w / 2 + 0.015, yy, yy + 0.07, f - d / 2 - 0.015, f + d / 2 + 0.015, shade(c, 0.82), 0.9);
    };
    /** A heap of what has been landed: crates (some stacked), barrels, sacks and heaped nets, set in a few places side by side along the quay. */
    const heap = (x: number, z: number) => {
      const y = ground(x, z), at = frame(x, z, y, -Math.PI / 2);
      for (const a of [-1.25, 0, 1.25]) for (const f of [-0.5, 0.5]) {
        if (!h.chance(0.65)) continue;
        const kind = h.next(), da = a + h.range(-0.1, 0.1), df = f + h.range(-0.06, 0.06);
        if (kind < 0.4) {
          const tall = h.range(0.45, 0.7);
          crate(at, da, df, 0, h.range(0.75, 1.05), h.range(0.7, 0.9), tall);
          if (h.chance(0.35)) crate(at, da + h.range(-0.08, 0.08), df, tall, h.range(0.55, 0.75), h.range(0.5, 0.7), h.range(0.35, 0.55));
        } else if (kind < 0.75) {
          const [px, , pz] = at(da, 0, df);
          if (h.chance(0.7)) barrel(px, pz, y, h.range(0.3, 0.37), h.range(0.82, 0.95), true, h.range(0, 3));
          else barrel(px, pz, y, 0.32, 0.9, false, -Math.PI / 2 + h.range(-0.15, 0.15));
        } else if (kind < 0.88) {
          for (const [sa, sf, sh] of [[-0.3, 0, 0], [0.3, 0.05, 0], [0, 0, 0.32]] as P3[]) solid('plaster', [at(da + sa - 0.32, sh, df + sf - 0.22), at(da + sa + 0.32, sh, df + sf - 0.22), at(da + sa + 0.32, sh, df + sf + 0.22), at(da + sa - 0.32, sh, df + sf + 0.22), at(da + sa - 0.26, sh + 0.34, df + sf - 0.15), at(da + sa + 0.26, sh + 0.34, df + sf - 0.15), at(da + sa + 0.26, sh + 0.34, df + sf + 0.15), at(da + sa - 0.26, sh + 0.34, df + sf + 0.15)], [0.62, 0.54, 0.4]);
        } else {
          const net: Colour = h.pick([[0.25, 0.22, 0.14], [0.2, 0.24, 0.18], [0.38, 0.26, 0.16]] as Colour[]);
          solid('plaster', [at(da - 0.6, 0, df - 0.45), at(da + 0.6, 0, df - 0.45), at(da + 0.6, 0, df + 0.45), at(da - 0.6, 0, df + 0.45), at(da - 0.35, 0.32, df - 0.22), at(da + 0.35, 0.32, df - 0.22), at(da + 0.35, 0.32, df + 0.22), at(da - 0.35, 0.32, df + 0.22)], net);
        }
      }
    };
    for (let x = q.x0 + 9; x < q.x1 - 9; x += h.range(16, 26)) {
      if (x > t.square.x0 + 6 && x < t.square.x1 - 6 && h.chance(0.6)) continue;
      // (Within two to four metres of the quay's edge: further back they lay across the way along the waterfront, where one walks in
      // from the harbour light; and none on the bridge over a river's mouth.)
      if (t.river && Math.abs(x - t.river.line[t.river.line.length - 1][0]) < t.river.width[t.river.width.length - 1] / 2 + 4) continue;
      heap(x, q.z - h.range(2.9, 3.2));
    }
    // The crane: on a block of stone at the quay's edge beside the ship, a mast with a jib raked up from low on it and out over the
    // water, held up by a rope from the mast's head; a winch at its foot, and a crate in a sling hanging from the jib's end.
    // (It was first a post with a level arm and a barrel hanging from it, and it looked like a gallows.)
    const ship = t.boats.find((bt) => bt.masts === 2) ?? t.boats.find((bt) => bt.masts);
    if (ship) {
      const cx = ship.x + (h.chance(0.5) ? -1 : 1) * Math.min(ship.length * 0.3, 6), cz = q.z - 1.6, y = deck, at = frame(cx, cz, y, Math.PI / 2);
      const oak: Colour = [0.3, 0.22, 0.15], rope: Colour = [0.36, 0.3, 0.2], iron: Colour = [0.1, 0.09, 0.085];
      /** A spar, or a rope, of square section between two points, whichever way it runs. */
      const spar = (a: P3, c: P3, r: number, material = 'wood', colour = oak) => {
        const d: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]), u: P3 = [d[0] / l, d[1] / l, d[2] / l];
        const cross = (p: P3, q: P3): P3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
        const s0 = cross(u, Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]), sl = Math.hypot(s0[0], s0[1], s0[2]), sv: P3 = [s0[0] / sl, s0[1] / sl, s0[2] / sl], w = cross(u, sv);
        const ring = (p: P3) => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]): P3 => [p[0] + (sv[0] * i + w[0] * j) * r, p[1] + (sv[1] * i + w[1] * j) * r, p[2] + (sv[2] * i + w[2] * j) * r]);
        solid(material, [...ring(a), ...ring(c)], colour, 0.9);
      };
      box(at, 'stone', -0.9, 0.9, -0.3, 0.55, -0.9, 0.9, shade(stone, 0.95), 0.4);
      box(at, 'wood', -0.17, 0.17, 0.55, 7.0, -0.17, 0.17, oak);
      box(at, 'metal', -0.2, 0.2, 6.8, 6.9, -0.2, 0.2, iron);
      // (Two shores raking down from the mast to the block's back corners, to stand it against the pull of the load.)
      for (const side of [-1, 1]) spar(at(0, 3.2, -0.1), at(side * 0.75, 0.55, -0.8), 0.08);
      const pivot = at(0, 1.4, 0.2), tip = at(0, 6.3, 4.9), head = at(0, 6.85, 0.18);
      spar(pivot, tip, 0.13);
      spar(head, tip, 0.025, 'wood', rope);
      // The winch on the landward side: two cheeks, a drum between them with rope wound on it, and a crank.
      for (const side of [-0.4, 0.4]) box(at, 'wood', side - 0.05, side + 0.05, 0.55, 1.45, -0.95, -0.35, oak);
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2, r = 0.17, ax = -0.65, ay = 1.15;
        solid('wood', [at(-0.35, ay + Math.sin(a0) * r, ax + Math.cos(a0) * r), at(0.35, ay + Math.sin(a0) * r, ax + Math.cos(a0) * r), at(0.35, ay + Math.sin(a1) * r, ax + Math.cos(a1) * r), at(-0.35, ay + Math.sin(a1) * r, ax + Math.cos(a1) * r), at(-0.35, ay, ax), at(0.35, ay, ax), at(0.35, ay, ax), at(-0.35, ay, ax)], k % 2 ? rope : shade(rope, 0.8), 0.9);
      }
      box(at, 'metal', 0.45, 0.75, 1.13, 1.17, -0.67, -0.63, iron); box(at, 'metal', 0.71, 0.75, 1.13, 1.42, -0.67, -0.63, iron);
      // The fall: from the drum up to the jib's end, and down from it to the hook, with a crate slung from it over the ship's hatch.
      spar(at(0, 1.3, -0.6), head, 0.02, 'wood', rope);
      const hook = 2.3;
      spar(tip, at(0, hook, 4.9), 0.022, 'wood', rope);
      const cw = 0.9, cd = 0.75, ctall = 0.7, cy = hook - 1.15;
      crate(at, 0, 4.9, cy, cw, cd, ctall);
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) spar(at((i * cw) / 2, cy + ctall, 4.9 + (j * cd) / 2), at(0, hook, 4.9), 0.015, 'wood', rope);
    }
  }

  // ---- the river: its water, a ribbon falling as its levels fall, white where it drops over a weir; in the town, walls of dressed
  // stone either side from its bed up to the quays, coped, with an iron railing along the top; boardwalks of timber at the foot of the
  // walls, on posts in the water, with a rail and a stair down to them from the quay; and its bridges, of stone in the town, a
  // segmental arch between abutments with a moulded ring, flagged and walled along its deck, and of timber out of it.
  const streams: { line: number[]; width: number; banks?: number[] }[] = [], falls: { x: number; y: number; z: number; height: number; width: number }[] = [];
  // (Where one may walk over or down in the river: its bridges' decks, its boardwalks and their stairs. Each a rectangle about a
  // point, turned to a bearing: half its length along the bearing, half its breadth across. The edge of the world leaves them open.)
  const decks: { x: number; z: number; heading: number; along: number; across: number }[] = [];
  const onDeck = (x: number, z: number) => decks.some((d) => { const c = Math.cos(d.heading), sn = Math.sin(d.heading), dx = x - d.x, dz = z - d.z; return Math.abs(dx * c + dz * sn) < d.along && Math.abs(-dx * sn + dz * c) < d.across; });
  if (t.river) {
    const rv = t.river, h = rng.fork('river'), L2 = rv.line, n = L2.length, iron: Colour = [0.05, 0.05, 0.055], oak: Colour = [0.33, 0.24, 0.16];
    // The water: every point at its level, its banks at the walls in the town (a hand into them), its breadth out of it.
    streams.push({ line: L2.flatMap(([x, z, y]) => [x, y + 0.02, z]), width: rv.width[0], banks: L2.flatMap((_, k) => { const w = rv.width[k] / 2 + (rv.walled[k] ? 0.15 : 0.6); return [w, w]; }) });
    for (let k = 0; k + 1 < n; k++) {
      const drop = L2[k][2] - L2[k + 1][2];
      if (drop > 0.9) falls.push({ x: L2[k + 1][0], y: L2[k + 1][2], z: L2[k + 1][1], height: drop, width: rv.width[k] * 0.8 });
    }
    // Where along the river each bridge stands, and how broad it is there (to keep walls' railings and the boardwalks clear of it).
    const alongOf = (x: number, z: number) => { const r = riverAt(t, x, z); let d = 0; for (let k = 0; k < r.k; k++) d += Math.hypot(L2[k + 1][0] - L2[k][0], L2[k + 1][1] - L2[k][1]); return d + r.along * Math.hypot(L2[Math.min(n - 1, r.k + 1)][0] - L2[r.k][0], L2[Math.min(n - 1, r.k + 1)][1] - L2[r.k][1]); };
    const crossings = rv.bridges.map((b) => ({ at: alongOf(b.x, b.z), half: b.width / 2 + 0.4 }));
    const byBridge = (d: number, m = 0) => crossings.some((c) => Math.abs(c.at - d) < c.half + m);
    const sides = (rv.side ? [-1, 1] : [-1, 1]) as (-1 | 1)[];
    const walkSides = h.chance(0.5) ? [-1, 1] : [h.chance(0.5) ? -1 : 1];
    let total = 0;
    for (let k = 0; k + 1 < n; k++) total += Math.hypot(L2[k + 1][0] - L2[k][0], L2[k + 1][1] - L2[k][1]);
    // The boardwalks: on one bank or both, in stretches between the bridges, each with a stair down to it from the quay at its upper end.
    const walled = (d: number) => { let acc = 0; for (let k = 0; k + 1 < n; k++) { const l = Math.hypot(L2[k + 1][0] - L2[k][0], L2[k + 1][1] - L2[k][1]); if (d <= acc + l) return rv.walled[k] && rv.walled[k + 1] && L2[k][1] < q.z - q.apron - 1; acc += l; } return false; };
    const pointAt = (d: number) => { let acc = 0; for (let k = 0; k + 1 < n; k++) { const l = Math.hypot(L2[k + 1][0] - L2[k][0], L2[k + 1][1] - L2[k][1]); if (d <= acc + l || k + 2 === n) { const f = Math.min(1, Math.max(0, (d - acc) / l)); return { x: L2[k][0] + (L2[k + 1][0] - L2[k][0]) * f, z: L2[k][1] + (L2[k + 1][1] - L2[k][1]) * f, y: L2[k][2] + (L2[k + 1][2] - L2[k][2]) * f, dx: (L2[k + 1][0] - L2[k][0]) / l, dz: (L2[k + 1][1] - L2[k][1]) / l, half: rv.width[k] / 2 }; } acc += l; } return { x: 0, z: 0, y: 0, dx: 1, dz: 0, half: 1 }; };
    const runs: { side: -1 | 1; from: number; to: number }[] = [];
    for (const side of walkSides) {
      let from = -1;
      for (let d = 0; d <= total; d += 1) {
        const ok = walled(d) && !byBridge(d, 1.5);
        if (ok && from < 0) from = d;
        if ((!ok || d + 1 > total) && from >= 0) { if (d - from > 14) runs.push({ side: side as -1 | 1, from: from + 0.5, to: d - 0.5 }); from = -1; }
      }
    }
    function stairAt(side: number, d: number) { return runs.some((r) => r.side === side && d > r.from - 0.3 && d < r.from + 3.4); }
    let d0 = 0;
    for (let k = 0; k + 1 < n; k++) {
      const [ax, az, ay] = L2[k], [bx, bz, by] = L2[k + 1], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      const dStart = d0;
      d0 += len;
      if (!rv.walled[k] || !rv.walled[k + 1] || az > q.z + 0.5) continue;
      const half = rv.width[k] / 2, water = Math.min(ay, by);
      for (const side of sides) {
        // (A frame with its origin on the wall's face at the stretch's start, `f` into the bank, `a` along the river.)
        const nx = -dz * side, nz = dx * side, ox = ax + nx * half, oz = az + nz * half, facing = Math.atan2(nz, nx);
        const at = frame(ox, oz, 0, facing), sign = (-Math.sin(facing) * dx + Math.cos(facing) * dz) > 0 ? 1 : -1;
        const a0 = sign > 0 ? 0 : -len, a1 = sign > 0 ? len : 0;
        // (The quay's level read well back from the wall: the ground falls into the river's cut over the ground's own spacing, so just
        // behind the wall it has already dipped; a band of flags along the coping covers that, and the bridges reach over it.)
        const top = Math.min(ground(ox + nx * 2.6, oz + nz * 2.6), ground(ox + nx * 2.6 + dx * len, oz + nz * 2.6 + dz * len));
        masonry(at, a0 - 0.05, a1 + 0.05, water - 2.1, top - 0.25, 1.1, h.fork(`wall${k}.${side}`), stone, water + 0.15);
        box(at, 'stone', a0, a1, top - 0.25, top + 0.05, -0.1, 0.55, shade(stone, h.range(1, 1.12)), 0.4);
        box(at, 'stone', a0, a1, top - 0.6, top + 0.02, 0.55, 2.1, shade(stone, h.range(0.88, 0.98)), 0.4);
        // The railing: posts every two metres and two rails; none where a bridge meets the wall or a stair goes down.
        for (let a = 0.6; a < len; a += 2) {
          const dd = dStart + a;
          if (byBridge(dd, 0.3) || stairAt(side, dd)) continue;
          const aa = sign > 0 ? a : -a;
          box(at, 'metal', aa - 0.03, aa + 0.03, top + 0.05, top + 1.05, 0.12, 0.18, iron);
          const seg = Math.min(2, len - a);
          if (!byBridge(dd + seg, 0.3) && !stairAt(side, dd + seg)) for (const yy of [top + 0.5, top + 1.0]) box(at, 'metal', Math.min(aa, aa + sign * seg), Math.max(aa, aa + sign * seg), yy, yy + 0.05, 0.13, 0.17, iron);
        }
      }
    }
    for (const r of runs) {
      const W = 2.3, level = (dd: number) => pointAt(dd).y + 0.5;
      // (Planks across, on joists along both edges, on posts down into the bed.)
      for (let dd = r.from; dd < r.to; dd += 1) {
        const p0 = pointAt(dd), nx = -p0.dz * r.side, nz = p0.dx * r.side, mid = p0.half - W / 2;
        decks.push({ x: p0.x + nx * mid, z: p0.z + nz * mid, heading: Math.atan2(p0.dz, p0.dx), along: 0.7, across: W / 2 });
      }
      for (let dd = r.from; dd < r.to; dd += 0.32) {
        const p0 = pointAt(dd), nx = -p0.dz * r.side, nz = p0.dx * r.side, y = level(dd), at = frame(p0.x, p0.z, y, Math.atan2(nz, nx));
        box(at, 'wood', -0.15, 0.15, -0.06, 0, p0.half - W, p0.half - 0.02, shade(oak, h.range(0.85, 1.15)), 0.9);
      }
      for (let dd = r.from; dd < r.to; dd += 2.4) {
        const p0 = pointAt(dd), nx = -p0.dz * r.side, nz = p0.dx * r.side, y = level(dd), at = frame(p0.x, p0.z, y, Math.atan2(nz, nx));
        for (const f of [p0.half - W + 0.1, p0.half - 0.15]) box(at, 'wood', -0.09, 0.09, -2.4, -0.06, f - 0.09, f + 0.09, shade(oak, 0.8), 0.9);
        // The rail on the water's side.
        box(at, 'wood', -0.05, 0.05, 0, 1.0, p0.half - W + 0.05, p0.half - W + 0.15, oak, 0.9);
        const p1 = pointAt(Math.min(r.to, dd + 2.4)), at1 = frame(p1.x, p1.z, level(Math.min(r.to, dd + 2.4)), Math.atan2(nz, nx));
        const [x0, , z0] = at(0, 0.95, p0.half - W + 0.1), [x1, , z1] = at1(0, 0.95, p1.half - W + 0.1);
        if (dd + 0.5 < r.to) solid('wood', [[x0, y + 0.9, z0 - 0.04], [x1, level(Math.min(r.to, dd + 2.4)) + 0.9, z1 - 0.04], [x1 + 0.04, level(Math.min(r.to, dd + 2.4)) + 0.9, z1 + 0.04], [x0 + 0.04, y + 0.9, z0 + 0.04], [x0, y + 1.0, z0 - 0.04], [x1, level(Math.min(r.to, dd + 2.4)) + 1.0, z1 - 0.04], [x1 + 0.04, level(Math.min(r.to, dd + 2.4)) + 1.0, z1 + 0.04], [x0 + 0.04, y + 1.0, z0 + 0.04]], oak, 0.9);
      }
      // The stair down from the quay at its upper end: steps along the wall, from the quay's level to the deck's.
      { const pm = pointAt(r.from + 1.6), nx0 = -pm.dz * r.side, nz0 = pm.dx * r.side; decks.push({ x: pm.x + nx0 * (pm.half - 0.6), z: pm.z + nz0 * (pm.half - 0.6), heading: Math.atan2(pm.dz, pm.dx), along: 1.8, across: 0.6 }); }
      const ps = pointAt(r.from), nx = -ps.dz * r.side, nz = ps.dx * r.side, topY = ground(ps.x + nx * (ps.half + 1.5), ps.z + nz * (ps.half + 1.5)), deckY = level(r.from), steps = Math.max(2, Math.round((topY - deckY) / 0.2));
      for (let s2 = 0; s2 < steps; s2++) {
        const dd = r.from + 3.2 - (s2 + 1) * (3.2 / steps), p0 = pointAt(dd), at = frame(p0.x, p0.z, 0, Math.atan2(nz, nx)), y = topY - (s2 + 1) * ((topY - deckY) / steps);
        box(at, 'stone', -3.2 / steps / 2, 3.2 / steps / 2, deckY - 0.3, y, p0.half - 1.2, p0.half - 0.02, shade(stone, h.range(0.85, 1.05)), 0.4);
      }
    }
    // The bridges.
    rv.bridges.forEach((b, bi) => {
      const hq = h.fork(`bridge${bi}`), at = frame(b.x, b.z, 0, b.heading), half = b.span / 2, hw = b.width / 2, water = riverAt(t, b.x, b.z).y;
      decks.push({ x: b.x, z: b.z, heading: b.heading, along: half + 2.1, across: hw - 0.4 });
      if (b.kind === 'stone') {
        // (A segmental arch springing a little over the water, as high as the deck allows; the fill over it to the deck.)
        const spring = water + 0.25, rise = Math.max(0.5, Math.min(b.y - 0.6 - spring, b.span * 0.32)), R = (half * half + rise * rise) / (2 * rise), cy = spring + rise - R, N = 18;
        const tone = shade(stone, 1.02);
        for (let i = 0; i < N; i++) {
          const f0 = -half + (b.span * i) / N, f1 = f0 + b.span / N, fm = (f0 + f1) / 2, under = cy + Math.sqrt(Math.max(0, R * R - fm * fm));
          box(at, 'stone', -hw, hw, under, b.y - 0.12, f0, f1 + 0.01, tone, 0.4);
          for (const sd of [-1, 1]) box(at, 'stone', sd < 0 ? -hw - 0.06 : hw - 0.3, sd < 0 ? -hw + 0.3 : hw + 0.06, under - 0.02, under + 0.42, f0, f1 + 0.01, shade(stone, 1.12), 0.4);
        }
        // Abutments, from the bed up under the arch's springing, a little into each bank.
        for (const e of [-1, 1]) box(at, 'stone', -hw - 0.1, hw + 0.1, water - 2.2, spring + 0.05, e < 0 ? -half - 1.2 : half - 0.05, e < 0 ? -half + 0.05 : half + 1.2, shade(stone, 0.9), 0.4);
        // The deck, flagged; and walls along it, coped, over the water's breadth.
        box(at, 'stone', -hw, hw, b.y - 0.6, b.y + 0.01, -half - 2.1, half + 2.1, shade(stone, 0.95), 0.4);
        for (const sd of [-1, 1]) {
          box(at, 'stone', sd < 0 ? -hw : hw - 0.38, sd < 0 ? -hw + 0.38 : hw, b.y, b.y + 0.85, -half - 0.3, half + 0.3, shade(stone, hq.range(0.92, 1.05)), 0.4);
          box(at, 'stone', sd < 0 ? -hw - 0.06 : hw - 0.44, sd < 0 ? -hw + 0.44 : hw + 0.06, b.y + 0.85, b.y + 1.0, -half - 0.36, half + 0.36, shade(stone, 1.15), 0.4);
        }
      } else {
        // Timber: two beams across on trestles at each bank, planks across them, and a handrail either side.
        for (const sd of [-1, 1]) box(at, 'wood', sd * hw - 0.12, sd * hw + 0.12, b.y - 0.42, b.y - 0.12, -half - 2.1, half + 2.1, oak, 0.9);
        for (let f = -half - 2.1; f < half + 2.1; f += 0.3) box(at, 'wood', -hw - 0.1, hw + 0.1, b.y - 0.12, b.y, f + 0.01, f + 0.28, shade(oak, hq.range(0.85, 1.15)), 0.9);
        for (const e of [-1, 1]) for (const sd of [-1, 1]) box(at, 'wood', sd * hw - 0.1, sd * hw + 0.1, water - 1.2, b.y - 0.42, e * half - 0.1, e * half + 0.1, shade(oak, 0.8), 0.9);
        for (const sd of [-1, 1]) {
          for (const f of [-half - 0.5, 0, half + 0.5]) box(at, 'wood', sd * hw - 0.05, sd * hw + 0.05, b.y, b.y + 1.0, f - 0.05, f + 0.05, oak, 0.9);
          box(at, 'wood', sd * hw - 0.05, sd * hw + 0.05, b.y + 0.92, b.y + 1.0, -half - 0.55, half + 0.55, oak, 0.9);
        }
      }
    });
  }

  // ---- the house's terrace over the square: a wall of dressed stone along its front, with a balustrade, and the stair down
  {
    const h = rng.fork('terrace'), sq = t.square, lv = t.level, st = t.stair;
    const yN = sq.yN, front = lv.z1;
    // The wall: from the square's ground up to the terrace's floor, either side of the stair, and round the terrace's front corners.
    for (const [a0, a1] of [[lv.x0, st.x0], [st.x1, lv.x1]]) {
      if (a1 - a0 < 0.3) continue;
      const at = frame((a0 + a1) / 2, front, 0, Math.PI / 2);
      masonry((aa, hh, ff) => at(-aa, hh, ff - 0.05), -(a1 - a0) / 2, (a1 - a0) / 2, Math.min(yN, squareY(t, front + 1)) - 0.8, F - 0.02, 1.2, h.fork(`wall${a0}`), stone);
      // The balustrade: a plinth, turned balusters, a rail.
      box(at, 'stone', -(a1 - a0) / 2, (a1 - a0) / 2, F, F + 0.18, -0.35, 0.02, shade(stone, 1.05));
      for (let a = -(a1 - a0) / 2 + 0.25; a < (a1 - a0) / 2 - 0.15; a += 0.32) {
        const [bx, , bz] = at(a, 0, -0.17);
        baluster(bx, bz, F + 0.18, 0.66);
      }
      box(at, 'stone', -(a1 - a0) / 2 - 0.04, (a1 - a0) / 2 + 0.04, F + 0.84, F + 1.0, -0.39, 0.06, shade(stone, 1.1));
      for (const a of [-(a1 - a0) / 2 + 0.2, (a1 - a0) / 2 - 0.2]) box(at, 'stone', a - 0.24, a + 0.24, F, F + 1.08, -0.42, 0.06, shade(stone, 1.02));
    }
    // Down its sides, as far back as the lanes beside it are lower than it.
    for (const side of [-1, 1]) {
      const x = side < 0 ? lv.x0 : lv.x1;
      let z1 = front;
      while (z1 > lv.z0 + 1 && F - ground(x + side * 1.2, z1 - 1) > 0.3) z1 -= 1;
      if (front - z1 < 1) continue;
      // (In the frame facing out from the side, `a` runs towards the front on the west and away from it on the east: the wall reaches
      // on past the corner by the front wall's thickness, at the front's end.)
      const at = frame(x, (front + z1) / 2, 0, side < 0 ? Math.PI : 0), L2 = (front - z1) / 2, a0 = side < 0 ? -L2 - 1.2 : -L2, a1 = side < 0 ? L2 : L2 + 1.2;
      masonry((aa, hh, ff) => at(aa, hh, ff - 0.05), a0, a1, Math.min(...[0, 0.5, 1].map((k) => ground(x + side * 1.2, z1 + (front - z1) * k))) - 0.8, F - 0.02, 1.2, h.fork(`side${side}`), stone);
      box(at, 'stone', a0, a1, F, F + 0.35, -0.1, 0.5, shade(stone, 1.05));
    }
    // The stair: steps of stone from the terrace down into the square, as broad as the stair, between cheeks that carry the balustrade on down.
    // (Down to the square's ground at the stair's foot, not at the square's top edge: where the square falls steeply to the sea, the last
    // step stood two hands over the ground before it, too high to climb.)
    const foot = Math.min(yN, squareY(t, st.z1)), drop = F - foot, steps = Math.max(2, Math.ceil(drop / 0.16)), rise = drop / steps, run = (st.z1 - st.z0) / steps;
    const at = frame((st.x0 + st.x1) / 2, st.z0, 0, Math.PI / 2), half = (st.x1 - st.x0) / 2;
    for (let k = 0; k < steps; k++) {
      const y = F - (k + 1) * rise;
      box(at, 'stone', -half, half, foot - 0.6, y + 0.0, k * run - 0.02, (k + 1) * run, shade(stone, h.range(0.9, 1.05)), 0.4);
      box(at, 'stone', -half, half, y - 0.04, y + 0.02, k * run - 0.04, k * run + 0.04, shade(stone, 1.12), 0.4);
    }
    for (const side of [-1, 1]) {
      box(at, 'stone', side < 0 ? -half - 0.6 : half, side < 0 ? -half : half + 0.6, foot - 0.6, F + 0.2, -0.1, st.z1 - st.z0, shade(stone, 0.95));
      box(at, 'stone', side < 0 ? -half - 0.66 : half - 0.06, side < 0 ? -half + 0.06 : half + 0.66, F + 0.2, F + 0.32, -0.1, 0.4, shade(stone, 1.1));
      // (A post at the foot of each cheek, with a ball on it.)
      box(at, 'stone', side < 0 ? -half - 0.65 : half - 0.05, side < 0 ? -half + 0.05 : half + 0.65, foot, foot + 1.2, st.z1 - st.z0 - 0.7, st.z1 - st.z0, shade(stone, 1.02));
    }
    // The forecourt, flagged from wall to wall.
    kit.group = `p${p.id}`;
    for (let z = p.z0 + 0.05; z < p.z1 - 0.05; z += 1.5) kit.slab('floor', p.x0 + 0.1, z, p.x1 - 0.1, Math.min(p.z1 - 0.05, z + 1.5), F + 0.012, { ...b.flag, course: [0.6, 0.8], length: [0.7, 1.2] });
    kit.mass(V(p.x0 - 3, F - 5, p.z0), V(p.x1 + 3, F - 3.2, p.z1 + 3));
    wild.group = 'wild';
  }
  function baluster(x: number, z: number, y: number, hgt: number) {
    const at = frame(x, z, y, 0), prof: [number, number][] = [[0, 0.09], [0.12, 0.09], [0.16, 0.06], [0.3, 0.1], [0.42, 0.05], [0.5, 0.05], [0.56, 0.08], [hgt, 0.08]];
    for (let k = 0; k + 1 < prof.length; k++) {
      const [y0, r0] = prof[k], [y1, r1] = prof[k + 1];
      solid('stone', [at(-r0, y0, -r0), at(r0, y0, -r0), at(r0, y0, r0), at(-r0, y0, r0), at(-r1, y1, -r1), at(r1, y1, -r1), at(r1, y1, r1), at(-r1, y1, r1)], shade(stone, 1.06));
    }
  }

  // ---- the market: the fountain, and stalls under awnings with what they sell
  if (t.fountain) {
    const fo = t.fountain, y = squareY(t, fo.z), at = frame(fo.x, fo.z, y, 0), n = 16;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, r0 = fo.r - 0.4, r1 = fo.r;
      solid('stone', [at(Math.cos(a0) * r0, -0.2, Math.sin(a0) * r0), at(Math.cos(a0) * r1, -0.2, Math.sin(a0) * r1), at(Math.cos(a1) * r1, -0.2, Math.sin(a1) * r1), at(Math.cos(a1) * r0, -0.2, Math.sin(a1) * r0),
        at(Math.cos(a0) * r0, 0.62, Math.sin(a0) * r0), at(Math.cos(a0) * (r1 + 0.06), 0.62, Math.sin(a0) * (r1 + 0.06)), at(Math.cos(a1) * (r1 + 0.06), 0.62, Math.sin(a1) * (r1 + 0.06)), at(Math.cos(a1) * r0, 0.62, Math.sin(a1) * r0)], shade(stone, 1.05));
    }
    // (The water in the basin: a dark still sheet.)
    face('glass', Array.from({ length: n }, (_, k) => at(Math.cos((k / n) * Math.PI * 2) * (fo.r - 0.35), 0.45, Math.sin((k / n) * Math.PI * 2) * (fo.r - 0.35))), [0.04, 0.07, 0.08], at(0, -1, 0));
    // The column in its middle, a bowl on it, and a figure's plinth at its head.
    box(at, 'stone', -0.45, 0.45, 0.4, 1.6, -0.45, 0.45, shade(stone, 1.0));
    for (let k = 0; k < 10; k++) { const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2; solid('stone', [at(0, 1.6, 0), at(Math.cos(a0) * 0.4, 1.6, Math.sin(a0) * 0.4), at(Math.cos(a1) * 0.4, 1.6, Math.sin(a1) * 0.4), at(0, 1.6, 0), at(0, 1.9, 0), at(Math.cos(a0) * 1.25, 1.95, Math.sin(a0) * 1.25), at(Math.cos(a1) * 1.25, 1.95, Math.sin(a1) * 1.25), at(0, 1.9, 0)], shade(stone, 1.08)); }
    box(at, 'stone', -0.22, 0.22, 1.9, 3.3, -0.22, 0.22, shade(stone, 1.0));
    box(at, 'stone', -0.32, 0.32, 3.3, 3.45, -0.32, 0.32, shade(stone, 1.1));
    box(at, 'metal', -0.12, 0.12, 3.45, 4.4, -0.12, 0.12, [0.16, 0.22, 0.18]);
    b.fences.push({ min: V(fo.x - fo.r, y - 1, fo.z - fo.r), max: V(fo.x + fo.r, y + 0.5, fo.z + fo.r) });
  }
  for (const [n, s] of t.stalls.entries()) {
    const h = rng.fork(`stall${n}`), y = squareY(t, s.z), at = frame(s.x, s.z, y, s.turn), hw = s.w / 2, hd = s.d / 2, oak: Colour = [0.32, 0.22, 0.13];
    for (const [a, f] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) box(at, 'wood', a - 0.05, a + 0.05, 0, f < 0 ? 2.25 : 1.95, f - 0.05, f + 0.05, oak, 0.9);
    // The counter at the front, and a board behind.
    box(at, 'wood', -hw, hw, 0.82, 0.88, hd - 0.7, hd, [0.42, 0.3, 0.18], 0.9);
    box(at, 'wood', -hw, hw, 0, 0.82, hd - 0.06, hd, [0.3, 0.22, 0.14], 0.9);
    // The awning, in stripes, falling from the back to the front and over it.
    const stripes = Math.max(3, Math.round(s.w / 0.45));
    for (let k = 0; k < stripes; k++) {
      const a0 = -hw - 0.15 + ((s.w + 0.3) * k) / stripes, a1 = -hw - 0.15 + ((s.w + 0.3) * (k + 1)) / stripes, col = k % 2 ? s.awning : [0.86, 0.84, 0.78] as Colour;
      solid('plaster', [at(a0, 2.25, -hd - 0.1), at(a1, 2.25, -hd - 0.1), at(a1, 1.92, hd + 0.4), at(a0, 1.92, hd + 0.4), at(a0, 2.28, -hd - 0.1), at(a1, 2.28, -hd - 0.1), at(a1, 1.95, hd + 0.4), at(a0, 1.95, hd + 0.4)], col);
      solid('plaster', [at(a0, 1.65, hd + 0.4), at(a1, 1.65, hd + 0.4), at(a1, 1.65, hd + 0.43), at(a0, 1.65, hd + 0.43), at(a0, 1.95, hd + 0.4), at(a1, 1.95, hd + 0.4), at(a1, 1.95, hd + 0.43), at(a0, 1.95, hd + 0.43)], col);
    }
    // What is for sale, on the counter and in crates before it.
    const wares: Colour[] = s.goods === 'fish' ? [[0.55, 0.58, 0.6], [0.42, 0.45, 0.5], [0.6, 0.5, 0.45]] : s.goods === 'fruit' ? [[0.7, 0.12, 0.06], [0.75, 0.45, 0.05], [0.35, 0.5, 0.1]] : s.goods === 'cloth' ? [[0.2, 0.25, 0.55], [0.6, 0.15, 0.12], [0.75, 0.68, 0.45]] : s.goods === 'pots' ? [[0.55, 0.3, 0.18], [0.45, 0.24, 0.14], [0.6, 0.55, 0.45]] : [[0.66, 0.48, 0.25], [0.55, 0.38, 0.18], [0.72, 0.6, 0.38]];
    for (let a = -hw + 0.25; a < hw - 0.2; a += h.range(0.32, 0.5)) {
      const c = h.pick(wares), hgt = s.goods === 'cloth' ? h.range(0.08, 0.2) : h.range(0.1, 0.2), dep = h.range(0.15, 0.35);
      box(at, s.goods === 'cloth' ? 'plaster' : 'wood', a - 0.12, a + 0.12, 0.88, 0.88 + hgt, hd - 0.6 + h.range(0, 0.2), hd - 0.6 + dep, c, 0.9);
    }
    for (let k = 0; k < h.int(1, 3); k++) {
      const a = h.range(-hw + 0.3, hw - 0.3), f = hd + h.range(0.35, 0.8);
      box(at, 'wood', a - 0.28, a + 0.28, 0, 0.32, f - 0.2, f + 0.2, [0.45, 0.33, 0.2], 0.9);
      box(at, 'wood', a - 0.24, a + 0.24, 0.32, 0.42, f - 0.16, f + 0.16, h.pick(wares), 0.9);
    }
  }

  // ---- the furniture of the streets: iron lamps along them, on the waterfront and round the square, whose lanterns are lit after dark
  // (their glass is the window's, and glows as a lit window does); benches along the square's sides; and on the square's axis
  // towards the harbour an obelisk of the country's stone on stepped plinths, with a gilt ball on its point.
  const lampAt = (x: number, z: number, h: Rng) => {
    const y = ground(x, z), iron: Colour = [0.05, 0.05, 0.055], at = frame(x, z, y, h.range(0, Math.PI * 2));
    box(at, 'metal', -0.16, 0.16, -0.1, 0.5, -0.16, 0.16, iron);
    box(at, 'metal', -0.11, 0.11, 0.5, 0.62, -0.11, 0.11, iron);
    box(at, 'metal', -0.055, 0.055, 0.62, 3.35, -0.055, 0.055, iron);
    box(at, 'metal', -0.09, 0.09, 3.35, 3.45, -0.09, 0.09, iron);
    // The lantern: glass on four sides between corner bars, a floor and a cap.
    box(at, 'metal', -0.2, 0.2, 3.45, 3.5, -0.2, 0.2, iron);
    box(at, 'window', -0.16, 0.16, 3.5, 3.95, -0.16, 0.16, [1.0, 0.72, 0.36]);
    for (const [a, f] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(at, 'metal', a - 0.025, a + 0.025, 3.5, 3.95, f - 0.025, f + 0.025, iron);
    solid('metal', [at(-0.24, 3.95, -0.24), at(0.24, 3.95, -0.24), at(0.24, 3.95, 0.24), at(-0.24, 3.95, 0.24), at(-0.03, 4.22, -0.03), at(0.03, 4.22, -0.03), at(0.03, 4.22, 0.03), at(-0.03, 4.22, 0.03)], iron);
  };
  {
    const h = rng.fork('lamps'), sq = t.square;
    const clearOf = (x: number, z: number) => !(t.river && riverAt(t, x, z).off < riverAt(t, x, z).half + 1.5) && !t.buildings.some((bd) => Math.abs(bd.x - x) < 30 && Math.abs(bd.z - z) < 30 && outsideBuilt(bd, x, z) < 1.1) && !t.stalls.some((st) => Math.hypot(st.x - x, st.z - z) < 2.5) && (!t.fountain || Math.hypot(t.fountain.x - x, t.fountain.z - z) > t.fountain.r + 1.5);
    // (Along the waterfront by the quay's edge, between the bollards; round the square's edges; and along the streets, by turns on either side.)
    for (let x = q.x0 + 5; x < q.x1 - 5; x += 15) if (clearOf(x, q.z - 1.5)) lampAt(x, q.z - 1.5, h);
    for (const side of [-1, 1]) for (let z = t.stair.z1 + 2; z < sq.z1 - 1; z += 12) { const x = side < 0 ? sq.x0 + 1.4 : sq.x1 - 1.4; if (clearOf(x, z)) lampAt(x, z, h); }
    for (const st of t.streets) {
      if (st.kind !== 'street' && st.kind !== 'lane') continue;
      let since = h.range(4, 14), side = 1;
      for (let k = 1; k < st.line.length; k++) {
        const [ax, az] = st.line[k - 1], [bx, bz] = st.line[k], run = Math.hypot(bx - ax, bz - az);
        since += run;
        if (since < 19 || run < 0.1) continue;
        const px = -(bz - az) / run, pz = (bx - ax) / run, x = bx + px * side * (st.width / 2 - 0.55), z = bz + pz * side * (st.width / 2 - 0.55);
        if (zoneAt(x, z) !== Z.street || !clearOf(x, z)) continue;
        lampAt(x, z, h);
        since = 0; side = -side;
      }
    }
    // Benches along the square's sides, facing in.
    for (const side of [-1, 1]) for (let z = t.stair.z1 + 8; z < sq.z1 - 4; z += h.range(9, 13)) {
      const x = side < 0 ? sq.x0 + 1.3 : sq.x1 - 1.3;
      if (!clearOf(x, z) || !clearOf(x, z + 1) || !clearOf(x, z - 1)) continue;
      const at = frame(x, z, ground(x, z), side < 0 ? 0 : Math.PI), oak: Colour = [0.36, 0.26, 0.16];
      for (const a of [-0.75, 0.75]) box(at, 'stone', a - 0.12, a + 0.12, 0, 0.42, -0.22, 0.2, shade(stone, 1.05));
      for (let f = -0.2; f < 0.2; f += 0.1) box(at, 'wood', -0.95, 0.95, 0.42, 0.47, f, f + 0.085, oak, 0.9);
      for (const yy of [0.62, 0.78]) box(at, 'wood', -0.95, 0.95, yy, yy + 0.1, -0.27, -0.22, oak, 0.9);
      for (const a of [-0.75, 0.75]) box(at, 'metal', a - 0.03, a + 0.03, 0.45, 0.9, -0.28, -0.22, [0.06, 0.06, 0.06]);
    }
    // The obelisk.
    const ox = (t.stair.x0 + t.stair.x1) / 2, oz = sq.z1 - 7, oy = squareY(t, oz), at = frame(ox, oz, oy, 0), granite = shade(stone, 0.92);
    if (!t.stalls.some((st) => Math.hypot(st.x - ox, st.z - oz) < 4.5) && (!t.fountain || Math.hypot(t.fountain.x - ox, t.fountain.z - oz) > t.fountain.r + 5)) {
      for (const [k, half] of [[0, 1.9], [1, 1.55], [2, 1.2]] as [number, number][]) box(at, 'stone', -half, half, -0.3 + k * 0.28, k * 0.28 + 0.28, -half, half, shade(granite, 1 - k * 0.04));
      box(at, 'stone', -0.85, 0.85, 0.84, 2.3, -0.85, 0.85, shade(granite, 1.08));
      box(at, 'stone', -0.98, 0.98, 2.3, 2.5, -0.98, 0.98, shade(granite, 1.12));
      solid('stone', [at(-0.5, 2.5, -0.5), at(0.5, 2.5, -0.5), at(0.5, 2.5, 0.5), at(-0.5, 2.5, 0.5), at(-0.32, 9.6, -0.32), at(0.32, 9.6, -0.32), at(0.32, 9.6, 0.32), at(-0.32, 9.6, 0.32)], shade(granite, 0.98));
      solid('stone', [at(-0.32, 9.6, -0.32), at(0.32, 9.6, -0.32), at(0.32, 9.6, 0.32), at(-0.32, 9.6, 0.32), at(0, 10.15, 0), at(0, 10.15, 0), at(0, 10.15, 0), at(0, 10.15, 0)], shade(granite, 0.98));
      for (let k = 0; k < 8; k++) { const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2; for (const [y0, y1, r0, r1] of [[10.12, 10.32, 0.04, 0.22], [10.32, 10.52, 0.22, 0.04]]) solid('metal', [at(0, y0, 0), at(Math.cos(a0) * r0, y0, Math.sin(a0) * r0), at(Math.cos(a1) * r0, y0, Math.sin(a1) * r0), at(0, y0, 0), at(0, y1, 0), at(Math.cos(a0) * r1, y1, Math.sin(a0) * r1), at(Math.cos(a1) * r1, y1, Math.sin(a1) * r1), at(0, y1, 0)], [0.85, 0.66, 0.24]); }
    }
  }

  // ---- the garden's hedges and cones (a dark core, so that nothing is seen through them, under leaves set close over its faces), its
  // sundial, and the flowers in its beds
  if (garden.beds.length) {
    const h = rng.fork('garden'), pl = b.planting, box0: Colour = [0.11, 0.21, 0.055], core: Colour = [0.06, 0.12, 0.04];
    const green = (): Colour => shade(box0, h.range(0.75, 1.25));
    for (const [ax, az, bx, bz] of garden.hedges) {
      const run = Math.hypot(bx - ax, bz - az);
      if (run < 0.3) continue;
      const dx = (bx - ax) / run, dz = (bz - az) / run, nx = -dz, nz = dx, W = 0.22, H = 0.6;
      // (In pieces of a couple of metres, each standing on the ground at its ends, so that the hedge follows the rise.)
      const pieces = Math.ceil(run / 2.2);
      for (let k = 0; k < pieces; k++) {
        const s0 = (k / pieces) * run - (k === 0 ? W : 0), s1 = ((k + 1) / pieces) * run + (k === pieces - 1 ? W : 0.01);
        const p0x = ax + dx * s0, p0z = az + dz * s0, p1x = ax + dx * s1, p1z = az + dz * s1, y0 = ground(p0x, p0z), y1 = ground(p1x, p1z);
        solid('plaster', [[p0x - nx * W, y0 - 0.1, p0z - nz * W], [p1x - nx * W, y1 - 0.1, p1z - nz * W], [p1x + nx * W, y1 - 0.1, p1z + nz * W], [p0x + nx * W, y0 - 0.1, p0z + nz * W], [p0x - nx * W, y0 + H, p0z - nz * W], [p1x - nx * W, y1 + H, p1z - nz * W], [p1x + nx * W, y1 + H, p1z + nz * W], [p0x + nx * W, y0 + H, p0z + nz * W]], core);
      }
      // (Leaves close and large enough to hide the core: a box hedge is a surface of leaves, not a dark box with sprigs on it.)
      for (let s = -W; s < run + W; s += 0.13) {
        const px = ax + dx * s, pz = az + dz * s, y = ground(px, pz);
        for (let k = 0; k < 3; k++) { const o = h.range(-W, W); pl.card(pl.leaves, px + nx * o, y + H + h.range(0, 0.05), pz + nz * o, h.range(0.26, 0.4), -Math.PI / 2 + h.range(-0.5, 0.5), h.range(0, 6.28), h.range(-0.5, 0.5), green(), px, y + H * 0.3, pz); }
        for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
          const ox = nx * side, oz = nz * side;
          pl.card(pl.leaves, px + ox * (W + 0.03), y + h.range(0.06, H), pz + oz * (W + 0.03), h.range(0.26, 0.4), h.range(-0.5, 0.5), Math.atan2(ox, oz) + h.range(-0.5, 0.5), h.range(-0.6, 0.6), green(), px, y + H * 0.3, pz);
        }
      }
    }
    for (const [cx, cz, tall] of garden.cones) {
      const y = ground(cx, cz), R = tall * 0.3, n = 8, apex: P3 = [cx, y + tall, cz], inside: P3 = [cx, y + tall * 0.3, cz];
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        face('plaster', [[cx + Math.cos(a0) * R * 0.85, y - 0.05, cz + Math.sin(a0) * R * 0.85], [cx + Math.cos(a1) * R * 0.85, y - 0.05, cz + Math.sin(a1) * R * 0.85], [apex[0], apex[1] - 0.1, apex[2]]], core, inside);
      }
      // (Close enough that the core does not show between them: with half as many the cone read as a dark spire hung with leaves.)
      for (let k = Math.round(560 * tall * tall / 6.8); k > 0; k--) {
        const hh = tall * (1 - Math.sqrt(h.next())) * 0.97, r = R * (1 - hh / tall) + 0.06, a = h.range(0, Math.PI * 2), ox = Math.cos(a), oz = Math.sin(a);
        pl.card(pl.leaves, cx + ox * r, y + hh, cz + oz * r, h.range(0.26, 0.38), -0.35 + h.range(-0.5, 0.5), Math.atan2(ox, oz) + h.range(-0.5, 0.5), h.range(-0.6, 0.6), shade(green(), 0.8), cx, y + tall * 0.25, cz);
      }
    }
    if (garden.dial) {
      const [dx, dz] = garden.dial, at = frame(dx, dz, ground(dx, dz), 0), st = shade(stone, 1.08), bronze: Colour = [0.42, 0.3, 0.14];
      box(at, 'stone', -0.42, 0.42, -0.1, 0.12, -0.42, 0.42, st, 0.4);
      box(at, 'stone', -0.15, 0.15, 0.12, 0.95, -0.15, 0.15, st, 0.4);
      box(at, 'stone', -0.27, 0.27, 0.95, 1.03, -0.27, 0.27, st, 0.4);
      box(at, 'metal', -0.2, 0.2, 1.03, 1.045, -0.2, 0.2, bronze);
      solid('metal', [at(-0.008, 1.045, -0.15), at(0.008, 1.045, -0.15), at(0.008, 1.045, 0.15), at(-0.008, 1.045, 0.15), at(-0.008, 1.045, -0.15), at(0.008, 1.045, -0.15), at(0.008, 1.2, 0.15), at(-0.008, 1.2, 0.15)], bronze);
    }
    // The flowers: in rows, two colours to a bed by turns, as bedding is planted; none in winter, and the autumn's in its own colours.
    if (season !== 'winter') {
      const schemes: [Colour, Colour][] = season === 'autumn'
        ? [[[0.7, 0.32, 0.06], [0.55, 0.12, 0.1]], [[0.78, 0.55, 0.1], [0.45, 0.2, 0.4]]]
        : [[[0.78, 0.1, 0.08], [0.88, 0.86, 0.78]], [[0.32, 0.26, 0.72], [0.88, 0.72, 0.12]], [[0.82, 0.36, 0.52], [0.88, 0.86, 0.78]], [[0.88, 0.46, 0.08], [0.5, 0.14, 0.44]]];
      for (const bd of garden.beds) if (bd.flowers) {
        const [c1, c2] = h.pick(schemes);
        // (Each plant a clump of leaves with its flowers over it, set close, so that a bed reads as a carpet of colour.)
        for (let z = bd.z0 + 0.85; z < bd.z1 - 0.75; z += 0.3) for (let x = bd.x0 + 0.85; x < bd.x1 - 0.75; x += 0.26) {
          const row = Math.round((z - bd.z0) / 0.3), c = row % 4 < 2 ? c1 : c2;
          const fx = x + h.range(-0.05, 0.05), fz = z + h.range(-0.05, 0.05), fy = ground(fx, fz);
          pl.tuft(pl.herbs, fx, fy - 0.03, fz, h.range(0.3, 0.4), h.range(0.16, 0.24), h.range(0, 6.28), shade([0.09, 0.17, 0.04], h.range(0.8, 1.2)));
          pl.tuft(pl.flowers, fx, fy - 0.02, fz, 0.36, h.range(0.26, 0.38), h.range(0, 6.28), shade(c, h.range(0.85, 1.1)));
        }
      }
    }
  }

  // ---- the buildings: each made in its own measures by the valley's builder, then turned to its street and set on its ground;
  // with a footing of stone under it, so that where the street falls away along its front no gap shows under its wall
  const chimneys: { x: number; y: number; z: number }[][] = [];
  t.buildings.forEach((bd, n) => buildTurned(bd, n));
  function buildTurned(bd: Building, n: number) {
    const local = new Map<string, MeshBuilder>(), y = bd.y ?? F, tops: Vector3[] = [];
    buildBuilding({ ...bd, x: 0, z: 0, faces: 'w', turn: undefined }, y, (m) => { if (!local.has(m)) local.set(m, new MeshBuilder()); return local.get(m)!; }, rng.fork(`building${n}`), [0.86 * tint[0], 0.77 * tint[1], 0.63 * tint[2]], n % 9 === 0 && bd.style === 'timber', tops);
    // (Built facing west, as the builder makes them; turned so that its front faces its bearing: by that bearing less a half turn.)
    const turn = (bd.turn ?? Math.PI) - Math.PI, c = Math.cos(turn), s = Math.sin(turn);
    for (const [m, src] of local) mesh(m).append(src, (v) => {
      const x = v.p[0], z = v.p[2], nx = v.n[0], nz = v.n[2];
      v.p[0] = bd.x + x * c - z * s; v.p[2] = bd.z + x * s + z * c;
      v.n[0] = nx * c - nz * s; v.n[2] = nx * s + nz * c;
    });
    chimneys[n] = tops.map((p) => ({ x: bd.x + p.x * c - p.z * s, y: p.y, z: bd.z + p.x * s + p.z * c }));
    // The footing: down from its floor a couple of metres, under its main block and its wings.
    for (const r of footprintOf(bd)) {
      const corners = [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].map(([u, v]) => turnedPoint(bd, u, v));
      let low = y;
      for (const [cx, cz] of corners) low = Math.min(low, ground(cx, cz));
      if (low > y - 0.05) continue;
      solid('stone', [...corners.map(([cx, cz]): P3 => [cx, low - 0.6, cz]), ...corners.map(([cx, cz]): P3 => [cx, y + 0.02, cz])], shade(stone, 0.85), 0.4);
    }
  }
  /** Where a point of a building's own measures (across its front from its middle, back from its front) is in the site. */
  function turnedPoint(bd: Building, u: number, v: number): [number, number] {
    const f = bd.turn ?? Math.PI, fx = Math.cos(f), fz = Math.sin(f), out = bd.d / 2 - v;
    return [bd.x + fx * out + fz * u, bd.z + fz * out - fx * u];
  }
  void inBuilding;

  // ---- the shacks
  const pipes: { x: number; y: number; z: number }[] = [];
  t.shacks.forEach((sh, n) => pipes.push(buildShack(sh, rng.fork(`shack${n}`), solid, ground, sea)));

  // ---- washing hung out on lines between neighbouring shacks: a line from a corner of one to the nearest corner of the other, sagging,
  // and on it shirts, sheets and cloths of faded colours, pegged by their tops. (Not walked into: it is soft, as twigs are.)
  {
    const h = rng.fork('washing'), used = new Set<number>(), line: Colour = [0.55, 0.52, 0.46];
    const cloths: Colour[] = [[0.86, 0.85, 0.8], [0.8, 0.78, 0.7], [0.55, 0.62, 0.72], [0.7, 0.42, 0.34], [0.42, 0.5, 0.4], [0.86, 0.84, 0.76], [0.3, 0.34, 0.45]];
    const cornerNear = (sh: Town['shacks'][number], x: number, z: number): [number, number] => {
      const at = frame(sh.x, sh.z, sh.y, sh.turn);
      let best: [number, number] = [sh.x, sh.z], d = Infinity;
      for (const [a, f] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = at((a * sh.w) / 2 + a * 0.1, 0, (f * sh.d) / 2 + f * 0.1), e = Math.hypot(p[0] - x, p[2] - z); if (e < d) { d = e; best = [p[0], p[2]]; } }
      return best;
    };
    wild.group = 'soft';
    t.shacks.forEach((a, i) => {
      if (used.has(i) || a.stilts) return;
      let best = -1, far = Infinity;
      t.shacks.forEach((o, j) => { const d = Math.hypot(o.x - a.x, o.z - a.z); if (j !== i && !used.has(j) && !o.stilts && d < far) { far = d; best = j; } });
      if (best < 0 || !h.chance(0.5)) return;
      const o = t.shacks[best], [x0, z0] = cornerNear(a, o.x, o.z), [x1, z1] = cornerNear(o, a.x, a.z), run = Math.hypot(x1 - x0, z1 - z0);
      const y0 = a.y + 2.25, y1 = o.y + 2.25;
      if (run < 4 || run > 12 || Math.abs(y1 - y0) > 0.9) return;
      // (Nothing in the way: no building, shack or wall between the two ends, and the ground under the line well below it.)
      let clear = true;
      for (let k = 1; k < 10 && clear; k++) {
        const x = x0 + ((x1 - x0) * k) / 10, z = z0 + ((z1 - z0) * k) / 10, zn = zoneAt(x, z);
        if (zn === Z.built || zn === Z.shack || zn === Z.harbour || ground(x, z) > y0 + ((y1 - y0) * k) / 10 - 2.1) clear = false;
      }
      if (!clear) return;
      used.add(i); used.add(best);
      const sag = 0.06 * run, yAt = (s: number) => y0 + (y1 - y0) * s - sag * 4 * s * (1 - s), dx = (x1 - x0) / run, dz = (z1 - z0) / run, nx = -dz * 0.006, nz = dx * 0.006;
      // The line, in short straight pieces along its sag.
      for (let k = 0; k < 8; k++) {
        const s0 = k / 8, s1 = (k + 1) / 8, p0: P3 = [x0 + (x1 - x0) * s0, yAt(s0), z0 + (z1 - z0) * s0], p1: P3 = [x0 + (x1 - x0) * s1, yAt(s1), z0 + (z1 - z0) * s1];
        solid('wood', [[p0[0] - nx, p0[1] - 0.008, p0[2] - nz], [p1[0] - nx, p1[1] - 0.008, p1[2] - nz], [p1[0] + nx, p1[1] - 0.008, p1[2] + nz], [p0[0] + nx, p0[1] - 0.008, p0[2] + nz], [p0[0] - nx, p0[1] + 0.008, p0[2] - nz], [p1[0] - nx, p1[1] + 0.008, p1[2] - nz], [p1[0] + nx, p1[1] + 0.008, p1[2] + nz], [p0[0] + nx, p0[1] + 0.008, p0[2] + nz]], line);
      }
      // The washing: pieces along it with gaps between, each hanging straight down from the line, a little stirred out of plumb.
      for (let s = h.range(0.6, 1.2); s < run - 0.6;) {
        const wide = h.range(0.4, 1.1), tall = h.range(0.45, 1.05), sa = s / run, sb = Math.min(run - 0.3, s + wide) / run;
        const ta = yAt(sa), tb = yAt(sb), lean = h.range(-0.08, 0.08), c = h.pick(cloths), th = 0.012;
        const A: P3 = [x0 + (x1 - x0) * sa, ta, z0 + (z1 - z0) * sa], B: P3 = [x0 + (x1 - x0) * sb, tb, z0 + (z1 - z0) * sb];
        const ox = -dz * lean, oz = dx * lean;
        solid('plaster', [[A[0] + ox - nx * 2, A[1] - tall, A[2] + oz - nz * 2], [B[0] + ox - nx * 2, B[1] - tall, B[2] + oz - nz * 2], [B[0] + ox + (-dz * th), B[1] - tall, B[2] + oz + dx * th], [A[0] + ox + (-dz * th), A[1] - tall, A[2] + oz + dx * th], [A[0], A[1], A[2]], [B[0], B[1], B[2]], [B[0] - dz * th, B[1], B[2] + dx * th], [A[0] - dz * th, A[1], A[2] + dx * th]], c, 0.8);
        s += wide + h.range(0.12, 0.6);
      }
    });
    wild.group = 'wild';
  }

  // ---- the waterfront beyond the harbour: quays of stone along the water, decks of planks on them, and on those the storehouses,
  // their gables to the water
  t.wharves.forEach((w, n) => {
    const h = rng.fork(`wharf${n}`);
    for (let k = 0; k + 1 < w.line.length; k++) {
      const [ax, az] = w.line[k], [bx, bz] = w.line[k + 1], len = Math.hypot(bx - ax, bz - az), heading = Math.atan2(bz - az, bx - ax);
      if (len < 0.05) continue;
      // (A frame on the line's middle facing in from the water: the sea is on the line's right hand, so inland is its left.)
      const at = frame((ax + bx) / 2, (az + bz) / 2, 0, heading - Math.PI / 2);
      masonry(at, -len / 2 - 0.06, len / 2 + 0.06, sea - 2.4, w.y - 0.28, 1.3, h.fork(`face${k}`), stone, sea + 0.4);
      box(at, 'stone', -len / 2 - 0.06, len / 2 + 0.06, w.y - 0.28, w.y - 0.04, -0.1, 0.7, shade(stone, h.range(1, 1.12)), 0.4);
    }
  });
  t.storehouses.forEach((st, n) => buildStore(st, rng.fork(`store${n}`)));
  function buildStore(st: Town['storehouses'][number], h: Rng) {
    const at = frame(st.x, st.z, st.y, st.turn), hw = st.w / 2, hd = st.d / 2, H = st.height, pitch = Math.tan((42 * Math.PI) / 180), ridge = H + hw * pitch;
    const red = st.colour, dark: Colour = shade(red, 0.4), white: Colour = [0.86, 0.84, 0.78], roofC: Colour = h.pick([[0.13, 0.13, 0.14], [0.2, 0.21, 0.22], [0.3, 0.31, 0.32]] as Colour[]);
    // The deck before it, to the quay's edge: planks across on joists.
    const quay = t.wharves.reduce((m, w) => Math.min(m, nearLine(w.line.map(([x, z]) => [x, z, 0] as P3), st.x, st.z).off), Infinity), deck = Math.max(0.6, quay - hd + 0.35);
    for (let f = hd; f < hd + deck - 0.02; f += 0.22) box(at, 'wood', -hw - 0.3, hw + 0.3, -0.02, 0.05, f + 0.01, Math.min(hd + deck, f + 0.21), shade([0.36, 0.3, 0.24], h.range(0.8, 1.15)), 0.9);
    for (const a of [-hw, 0, hw]) box(at, 'wood', a - 0.08, a + 0.08, -0.6, -0.02, hd, hd + deck, [0.2, 0.16, 0.12], 0.9);
    // On granite stones under its sills.
    for (const [a0, a1, f0, f1] of [[-hw - 0.1, hw + 0.1, -hd - 0.1, -hd + 0.3], [-hw - 0.1, hw + 0.1, hd - 0.3, hd + 0.1], [-hw - 0.1, -hw + 0.3, -hd, hd], [hw - 0.3, hw + 0.1, -hd, hd]]) box(at, 'stone', a0, a1, -0.9, 0.02, f0, f1, shade(stone, h.range(0.7, 0.9)), 0.4);
    box(at, 'wood', -hw, hw, -0.04, 0.12, -hd, hd, [0.22, 0.17, 0.12], 0.9);
    // The openings: in the gable a door of planks at the deck, a hatch for loading over it, a small window or two; in the sides now and then a window.
    const door = { a0: h.range(-hw + 0.5, hw - 2.3), w: h.range(1.3, 1.9) }, holes: { wall: number; s0: number; s1: number; y0: number; y1: number; kind: 'door' | 'hatch' | 'window' }[] = [];
    holes.push({ wall: 0, s0: door.a0 + hw, s1: door.a0 + hw + door.w, y0: 0.1, y1: 2.15, kind: 'door' });
    if (ridge - (H > 4.5 ? 2.6 : H) > 1.6 || H > 4.5) { const y0 = H > 4.5 ? H - 1.6 : H + 0.15; holes.push({ wall: 0, s0: hw - 0.5, s1: hw + 0.5, y0, y1: y0 + 1.1, kind: 'hatch' }); }
    if (h.chance(0.55)) { const a = door.a0 + door.w + 0.5 < hw - 1.1 ? hw - 0.8 : -hw + 0.8; holes.push({ wall: 0, s0: a + hw - 0.3, s1: a + hw + 0.3, y0: 1.2, y1: 1.85, kind: 'window' }); }
    for (const wall of [1, 3]) if (h.chance(0.35)) { const c = h.range(1.2, st.d - 1.2); holes.push({ wall, s0: c - 0.3, s1: c + 0.3, y0: H > 4.5 ? H - 1.6 : 1.3, y1: (H > 4.5 ? H - 1.6 : 1.3) + 0.6, kind: 'window' }); }
    // The four walls, going round: the gable to the water, the right side, the back gable, the left side. Each is laid along from `p0` to
    // `p1` in the frame (`a`, `f`), its outer face towards `out`.
    const walls: { p0: [number, number]; p1: [number, number]; gable: boolean }[] = [
      { p0: [-hw, hd], p1: [hw, hd], gable: true }, { p0: [hw, hd], p1: [hw, -hd], gable: false }, { p0: [hw, -hd], p1: [-hw, -hd], gable: true }, { p0: [-hw, -hd], p1: [-hw, hd], gable: false },
    ];
    walls.forEach((wl, wi) => {
      const [a0, f0] = wl.p0, [a1, f1] = wl.p1, len = Math.hypot(a1 - a0, f1 - f0), ua = (a1 - a0) / len, uf = (f1 - f0) / len, oa = uf, of = -ua;
      const P = (s0: number, y: number, tt: number): P3 => at(a0 + ua * s0 + oa * tt, y, f0 + uf * s0 + of * tt);
      const topAt = (s0: number) => (wl.gable ? H + (hw - Math.abs(a0 + ua * s0)) * pitch : H);
      const mine = holes.filter((q0) => q0.wall === wi);
      const piece = (s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, c: Colour) => { if (y1 - y0 > 0.02 && s1 - s0 > 0.01) solid('wood', [P(s0, y0, t0), P(s1, y0, t0), P(s1, y0, t1), P(s0, y0, t1), P(s0, y1, t0), P(s1, y1, t0), P(s1, y1, t1), P(s0, y1, t1)], c, 0.9); };
      // (Behind the boards, a dark backing, so that no light shows between them.)
      if (st.logs) {
        // Logs, laid one on another, their ends standing out past the corners.
        for (let y = 0.12; y < H - 0.05; y += 0.24) {
          const reach = wl.gable ? 0 : 0.28, tone = shade(red, h.range(0.75, 1.05));
          const cuts = mine.filter((o) => y + 0.22 > o.y0 && y < o.y1).sort((p0, p1) => p0.s0 - p1.s0);
          let from = -reach;
          for (const o of cuts) { piece(from, o.s0, y, y + 0.22, -0.02, 0.2, tone); from = o.s1; }
          piece(from, len + reach, y, y + 0.22, -0.02, 0.2, tone);
        }
        if (wl.gable) for (let s0 = 0; s0 < len - 0.01; s0 += 0.2) piece(s0, Math.min(len, s0 + 0.2), H - 0.05, topAt(s0 + 0.1), 0, 0.04, shade(red, h.range(0.8, 1.05)));
      } else {
        piece(0.02, len - 0.02, 0.12, H, 0.04, 0.12, dark);
        for (let s0 = 0; s0 < len - 0.01; s0 += 0.22) {
          const e = Math.min(len, s0 + 0.2), mid = (s0 + e) / 2, top = topAt(mid), tone = shade(red, h.range(0.82, 1.1));
          const cut = mine.find((o) => mid > o.s0 && mid < o.s1);
          if (cut) { piece(s0, e, 0.12, cut.y0, 0, 0.035, tone); piece(s0, e, cut.y1, top, 0, 0.035, tone); } else piece(s0, e, 0.12, top, 0, 0.035, tone);
          // (A batten over each joint.)
          if (s0 > 0.1 && !cut) piece(s0 - 0.035, s0 + 0.035, 0.12, topAt(s0) - 0.02, -0.03, 0, shade(tone, 0.95));
        }
      }
      // The doors and hatches: planks, shut; windows: a white frame and dark panes.
      for (const o of mine) {
        if (o.kind === 'window') { piece(o.s0, o.s1, o.y0, o.y1, 0.06, 0.09, [0.04, 0.05, 0.06]); for (const [x0, x1, y0, y1] of [[o.s0 - 0.06, o.s0, o.y0 - 0.06, o.y1 + 0.06], [o.s1, o.s1 + 0.06, o.y0 - 0.06, o.y1 + 0.06], [o.s0, o.s1, o.y0 - 0.06, o.y0], [o.s0, o.s1, o.y1, o.y1 + 0.06], [(o.s0 + o.s1) / 2 - 0.02, (o.s0 + o.s1) / 2 + 0.02, o.y0, o.y1]]) piece(x0, x1, y0, y1, -0.02, 0.07, white); continue; }
        const plank = o.kind === 'door' ? shade(red, 0.75) : shade(red, 0.9);
        for (let s0 = o.s0; s0 < o.s1 - 0.01; s0 += 0.18) piece(s0, Math.min(o.s1, s0 + 0.17), o.y0, o.y1, 0.03, 0.08, shade(plank, h.range(0.85, 1.1)));
        for (const y0 of [o.y0 + 0.2, (o.y0 + o.y1) / 2, o.y1 - 0.3]) piece(o.s0, o.s1, y0, y0 + 0.1, 0, 0.03, shade(plank, 0.8));
        piece(o.s0 - 0.08, o.s1 + 0.08, o.y1, o.y1 + 0.1, -0.02, 0.08, dark);
      }
      // Corner boards.
      if (!st.logs) for (const s0 of [0, len]) piece(s0 - 0.08, s0 + 0.08, 0.1, wl.gable ? H : H, -0.04, 0.04, shade(red, 0.85));
    });
    // The roof: two slopes of seamed sheet metal from the ridge, the gable over the water hooded well out, and boards along its edges.
    const e = 0.3, hood = 0.75, drop = (hw + e) * pitch;
    for (const side of [-1, 1]) {
      const c: P3[] = [at(0, ridge + 0.05, -hd - e), at(0, ridge + 0.05, hd + hood), at(side * (hw + e), ridge - drop, hd + hood), at(side * (hw + e), ridge - drop, -hd - e)];
      solid('metal', [...c, ...c.map(([x, y, z]): P3 => [x, y + 0.07, z])], roofC, 0.6);
      for (let a = 0.35; a < hw + e - 0.1; a += 0.55) { const p0 = at(side * a, ridge - a * pitch + 0.08, -hd - e), p1 = at(side * a, ridge - a * pitch + 0.08, hd + hood); solid('metal', [p0, p1, [p1[0], p1[1] + 0.04, p1[2]], [p0[0], p0[1] + 0.04, p0[2]], p0, p1, [p1[0], p1[1] + 0.04, p1[2]], [p0[0], p0[1] + 0.04, p0[2]]], shade(roofC, 0.85)); }
      for (const f of [hd + hood, -hd - e]) solid('wood', [at(0, ridge, f), at(side * (hw + e), ridge - drop, f), at(side * (hw + e), ridge - drop - 0.22, f), at(0, ridge - 0.22, f), at(0, ridge, f - 0.04), at(side * (hw + e), ridge - drop, f - 0.04), at(side * (hw + e), ridge - drop - 0.22, f - 0.04), at(0, ridge - 0.22, f - 0.04)], shade(red, 0.7), 0.9);
    }
    // (Under the hood, the gable's triangle above the walls is boarded too; and a lantern by the door.)
    box(at, 'metal', door.a0 + door.w + 0.2, door.a0 + door.w + 0.4, 2.3, 2.6, hd + 0.05, hd + 0.25, [0.08, 0.08, 0.08]);
  }

  // ---- walls of dry stone about the fields
  t.walls.forEach((w, k) => layWall(mesh, w, ground, [0.62 * (0.6 + 0.4 * tint[0]), 0.6 * (0.6 + 0.4 * tint[1]), 0.56 * (0.6 + 0.4 * tint[2])], rng.fork(`wall${k}`)));

  // ---- the outlook: a ring of stone at the cliff's edge with a parapet towards the sea, and a belvedere: a round temple of six columns
  if (t.outlook) {
    const o = t.outlook, at = frame(o.x, o.z, o.y, o.facing), n = 20, white: Colour = shade(stone, 1.15);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      solid('stone', [at(Math.cos(a0) * 5.4, -1.2, Math.sin(a0) * 5.4), at(Math.cos(a0) * 6, -1.2, Math.sin(a0) * 6), at(Math.cos(a1) * 6, -1.2, Math.sin(a1) * 6), at(Math.cos(a1) * 5.4, -1.2, Math.sin(a1) * 5.4), at(Math.cos(a0) * 5.4, 0.1, Math.sin(a0) * 5.4), at(Math.cos(a0) * 6, 0.1, Math.sin(a0) * 6), at(Math.cos(a1) * 6, 0.1, Math.sin(a1) * 6), at(Math.cos(a1) * 5.4, 0.1, Math.sin(a1) * 5.4)], shade(stone, 0.95));
      // (A parapet on the half towards the sea: forward in this frame is out over the cliff.)
      const mid = (a0 + a1) / 2;
      if (Math.cos(mid) > -0.1) solid('stone', [at(Math.cos(a0) * 5.45, 0.1, Math.sin(a0) * 5.45), at(Math.cos(a0) * 5.95, 0.1, Math.sin(a0) * 5.95), at(Math.cos(a1) * 5.95, 0.1, Math.sin(a1) * 5.95), at(Math.cos(a1) * 5.45, 0.1, Math.sin(a1) * 5.45), at(Math.cos(a0) * 5.45, 1.05, Math.sin(a0) * 5.45), at(Math.cos(a0) * 5.95, 1.05, Math.sin(a0) * 5.95), at(Math.cos(a1) * 5.95, 1.05, Math.sin(a1) * 5.95), at(Math.cos(a1) * 5.45, 1.05, Math.sin(a1) * 5.45)], white);
    }
    // The floor, flags in a ring.
    for (let k = 0; k < n; k++) { const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2; for (const [r0, r1] of [[0, 2.6], [2.6, 5.4]]) solid('stone', [at(Math.cos(a0) * r0, -0.3, Math.sin(a0) * r0), at(Math.cos(a0) * r1, -0.3, Math.sin(a0) * r1), at(Math.cos(a1) * r1, -0.3, Math.sin(a1) * r1), at(Math.cos(a1) * r0, -0.3, Math.sin(a1) * r0), at(Math.cos(a0) * r0, 0.08, Math.sin(a0) * r0), at(Math.cos(a0) * r1, 0.08, Math.sin(a0) * r1), at(Math.cos(a1) * r1, 0.08, Math.sin(a1) * r1), at(Math.cos(a1) * r0, 0.08, Math.sin(a1) * r0)], shade(stone, 0.85 + ((k + (r0 ? 1 : 0)) % 2) * 0.12)); }
    // The belvedere: six columns on a step, an entablature, a shallow dome of metal.
    const R = 2.2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6, [cx, , cz] = at(Math.cos(a) * R, 0, Math.sin(a) * R), col = frame(cx, cz, o.y, 0);
      for (let m = 0; m < 8; m++) { const a0 = (m / 8) * Math.PI * 2, a1 = ((m + 1) / 8) * Math.PI * 2; solid('stone', [col(0, 0.08, 0), col(Math.cos(a0) * 0.2, 0.08, Math.sin(a0) * 0.2), col(Math.cos(a1) * 0.2, 0.08, Math.sin(a1) * 0.2), col(0, 0.08, 0), col(0, 3.1, 0), col(Math.cos(a0) * 0.17, 3.1, Math.sin(a0) * 0.17), col(Math.cos(a1) * 0.17, 3.1, Math.sin(a1) * 0.17), col(0, 3.1, 0)], white); }
      box(col, 'stone', -0.26, 0.26, 0.08, 0.3, -0.26, 0.26, white);
      box(col, 'stone', -0.26, 0.26, 3.1, 3.28, -0.26, 0.26, white);
    }
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2, r0 = R - 0.35, r1 = R + 0.35;
      solid('stone', [at(Math.cos(a0) * r0, 3.28, Math.sin(a0) * r0), at(Math.cos(a0) * r1, 3.28, Math.sin(a0) * r1), at(Math.cos(a1) * r1, 3.28, Math.sin(a1) * r1), at(Math.cos(a1) * r0, 3.28, Math.sin(a1) * r0), at(Math.cos(a0) * r0, 3.75, Math.sin(a0) * r0), at(Math.cos(a0) * (r1 + 0.1), 3.75, Math.sin(a0) * (r1 + 0.1)), at(Math.cos(a1) * (r1 + 0.1), 3.75, Math.sin(a1) * (r1 + 0.1)), at(Math.cos(a1) * r0, 3.75, Math.sin(a1) * r0)], white);
      const d0 = R + 0.45, top = 3.75;
      for (let m = 0; m < 4; m++) {
        const e0 = (m / 4) * (Math.PI / 2), e1 = ((m + 1) / 4) * (Math.PI / 2), r00 = d0 * Math.cos(e0), r11 = d0 * Math.cos(e1), y00 = top + d0 * 0.55 * Math.sin(e0), y11 = top + d0 * 0.55 * Math.sin(e1);
        face('metal', [at(Math.cos(a0) * r00, y00, Math.sin(a0) * r00), at(Math.cos(a1) * r00, y00, Math.sin(a1) * r00), at(Math.cos(a1) * r11, y11, Math.sin(a1) * r11), at(Math.cos(a0) * r11, y11, Math.sin(a0) * r11)], [0.2, 0.32, 0.27], at(0, top - 2, 0));
      }
    }
    b.finds.push({ at: V(o.x, o.y + 1.4, o.z), what: 'the outlook on the headland: the town, its harbour and the coast laid out below' });
  }

  // ---- the hall: steps down its stair and up the stair in its wall to the gallery; torches in brackets down its walls, its side halls
  // and its stair where that is under the rock; fires in iron bowls either side of the bridge; a portal of dressed stone where the stair
  // goes in under the ground; and something left in it.
  const torches: IslandResult['torches'] = [];
  if (H && hallGeo) {
    const begun = new Map(['stone', 'metal'].map((mm) => [mm, mesh(mm).vertexCount]));
    const f = hallGeo.frame, hat = (u: number, v: number, y: number) => V(f.ox + f.ux * u - f.uz * v, y, f.oz + f.uz * u + f.ux * v);
    const steps = (line: [number, number, number][], width: number) => {
      for (let k = 0; k + 1 < line.length; k++) {
        const [ax, az, ay] = line[k], [bx, bz, by] = line[k + 1], run = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(Math.abs(by - ay) / 0.17));
        if (run < 0.05) continue;
        const at = frame(ax, az, 0, Math.atan2(bz - az, bx - ax));
        for (let i = 0; i < n; i++) { const y = ay + ((by - ay) * (i + (by < ay ? 0 : 1))) / n; box(at, 'stone', -width / 2, width / 2, Math.min(ay, by) - 0.6, y, (run * i) / n - 0.01, (run * (i + 1)) / n + 0.01, shade(stone, 0.8 + 0.12 * ((i + k) % 3) / 2), 0.4); }
      }
    };
    steps(stairLine, 2.3);
    const gs = H.gallery.side, gl: [number, number, number][] = [];
    for (let k = 0; k <= 12; k++) { const u = f.L - 3 - k * 2, v = gs * (f.half + 6), p0 = hat(u, v, H.floor + 11 * Math.min(1, (k * 2) / 24)); gl.push([p0.x, p0.z, p0.y]); }
    steps(gl, 2.2);
    const bracket = (pos: Vector3, out: Vector3) => { torches.push({ position: pos, out }); box(frame(pos.x - out.x * 0.12, pos.z - out.z * 0.12, pos.y - 0.28, Math.atan2(out.z, out.x)), 'metal', -0.025, 0.025, 0, 0.3, -0.025, 0.025, [0.14, 0.13, 0.12]); };
    for (let u = 4; u < f.L - 2; u += 9) for (const side of [-1, 1]) {
      if (Math.abs(u - H.chasm.at) < H.chasm.width / 2 + 1.5 || H.sides.some((sh) => sh.side === side && Math.abs(u - sh.at) < 4.5)) continue;
      bracket(hat(u, side * (f.half - 0.6), H.floor + 3.2), V(f.uz * side, 0, -f.ux * side));
    }
    for (const end of [-1, 1]) {
      const p0 = hat(H.chasm.at + end * (H.chasm.width / 2 + 1.8), 3.2, H.floor), at = frame(p0.x, p0.z, H.floor, 0);
      box(at, 'stone', -0.4, 0.4, -0.1, 1.05, -0.4, 0.4, shade(stone, 0.7));
      box(at, 'metal', -0.5, 0.5, 1.05, 1.27, -0.5, 0.5, [0.05, 0.045, 0.04]);
      torches.push({ position: V(p0.x, H.floor + 1.2, p0.z), out: V(0, 1, 0), fire: 0.85 });
    }
    for (let u = 8.2; u < f.L - 7; u += 9) bracket(hat(u, gs * (f.half + 3.6), H.floor + 13.2), V(f.uz * gs, 0, -f.ux * gs));
    for (const sh of H.sides) for (const e of [-sh.wide * 0.25, sh.wide * 0.25]) bracket(hat(sh.at + e, sh.side * (f.half + sh.long - 0.6), H.floor + 2.8), V(f.uz * sh.side, 0, -f.ux * sh.side));
    for (let k = 4; k < stairLine.length - 2; k += 6) {
      const [x, z, y] = stairLine[k], [nx2, nz2] = stairLine[k + 1], dx = nx2 - x, dz = nz2 - z, l = Math.hypot(dx, dz) || 1, px = -dz / l, pz = dx / l;
      if (ground(x, z) - y < 4) continue;
      torches.push({ position: V(x + px * 1.0, y + 1.9, z + pz * 1.0), out: V(-px, 0, -pz) });
    }
    const mouth = stairLine.findIndex(([x, z, y]) => ground(x, z) - y > 3.6);
    if (mouth > 0) {
      const [x, z, y] = stairLine[mouth], [px2, pz2] = stairLine[mouth - 1], at = frame(x, z, y, Math.atan2(z - pz2, x - px2));
      for (const side of [-1, 1]) box(at, 'stone', side * 1.75 - 0.38, side * 1.75 + 0.38, -0.3, 3.25, -0.45, 0.45, shade(stone, 1.05));
      box(at, 'stone', -2.2, 2.2, 3.2, 3.9, -0.5, 0.5, shade(stone, 1.1));
    }
    const last = H.sides[H.sides.length - 1];
    if (last) { const p0 = hat(last.at, last.side * (f.half + last.long - 1.4), H.floor); b.finds.push({ at: V(p0.x, H.floor + 0.35, p0.z), what: 'an iron-bound coffer, its lid broken open, at the end of a side hall in the rock' }); }
    for (const [mm, from] of begun) mesh(mm).setOpenBy((x, y, z) => (ground(x, z) - y > 2.5 ? 0.12 : 1), from);
  }

  // ---- what grows: grass where nothing is built or paved, crops in the fields, trees in the woods and the orchards
  const planted = plantTown();
  if (garden.beds.length) planted['garden beds'] = garden.beds.length;
  function plantTown(): Record<string, number> {
    const counts: Record<string, number> = {}, count = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
    const pl = b.planting, qq = rng.fork('plants'), dried = season === 'autumn' ? 0.6 : season === 'summer' ? 0.3 : 0;
    const centre = { x: (q.x0 + q.x1) / 2, z: q.z - 60 };
    const crops = new Map<string, CardSet>();
    const cropSet = (kind: CardSet['kind']) => { let c = crops.get(kind); if (!c) { c = { kind, shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] }; crops.set(kind, c); } return c; };
    // Low plants on a jittered lattice: closer near the town, where whoever walks will see them, and sparser further out.
    for (let z = g.z0; z < g.z1; z += 0.8) for (let x = g.x0; x < g.x1; x += 0.8) {
      const dist = Math.hypot(x - centre.x, (z - centre.z) * 1.3);
      if (dist > 380) continue;
      if (dist > 220 && qq.next() > 0.45) continue;
      const px = x + qq.range(-0.4, 0.4), pz = z + qq.range(-0.4, 0.4), zn = zoneAt(px, pz);
      if (zn === Z.street || zn === Z.flags || zn === Z.built || zn === Z.shack || zn === Z.harbour || zn === Z.quay || zn === Z.river || bedAt(px, pz)) continue;
      const y = ground(px, pz), above = y - sea;
      if (above < 1.4 || (rocky.holds(px, pz) && rocky.at(px, pz) > 0.35) || insideOuter(px, pz, 0.5)) continue;
      if ((zn === Z.track && (wayOff(px, pz) < 1.5 || earthAt(px, pz))) || (zn === Z.path && wayOff(px, pz) < 0.6)) continue;
      const yaw = qq.range(0, Math.PI * 2), fine = fbm2(px * 0.4 - s1, pz * 0.4 + s2, 2);
      if (zn === Z.field) {
        const f = t.fields[fieldAt(px, pz)];
        if (!f) continue;
        if (f.crop === 'wheat' || f.crop === 'barley' || f.crop === 'oats') {
          const tc = cropTint(f.crop), tall = (f.crop === 'oats' ? 0.75 : 0.85) * (season === 'spring' ? 0.45 : 1) * qq.range(0.85, 1.1);
          pl.tuft(pl.grass, px, y - 0.04, pz, qq.range(0.5, 0.7), tall, yaw, [0.3 * tc[0], 0.3 * tc[1], 0.12 * tc[2]]);
          count('crop');
        } else if (f.crop === 'pasture' || f.crop === 'orchard') {
          pl.tuft(pl.grass, px, y - 0.04, pz, qq.range(0.45, 0.7), qq.range(0.18, 0.32), yaw, [0.17 + 0.1 * dried, 0.3, 0.06]);
          if (fine > 0.62 && qq.chance(0.3)) { pl.tuft(pl.flowers, px, y - 0.03, pz, 0.3, qq.range(0.2, 0.32), yaw, qq.pick([[0.62, 0.62, 0.58], [0.7, 0.6, 0.1]] as Colour[])); count('flowers'); }
          count('grass');
        } else if (f.crop === 'roots' || f.crop === 'vines') {
          const row = Math.abs(((px * 0.6 + pz * 0.08) % 1.6 + 1.6) % 1.6 - 0.8);
          if (row < 0.3) { pl.tuft(f.crop === 'vines' ? cropSet('thicket' as CardSet['kind']) : pl.herbs, px, y - 0.04, pz, qq.range(0.5, 0.7), f.crop === 'vines' ? qq.range(0.9, 1.3) : qq.range(0.3, 0.45), yaw, f.crop === 'vines' ? [0.12, 0.2, 0.05] : [0.1, 0.22, 0.06]); count(f.crop); }
        }
        continue;
      }
      // Under the woods: ferns and bracken; on the shore, marram; elsewhere grass, longer the further from the town, and flowers in it.
      const wood = woodAt(px, pz);
      if (wood > 0.5) { if (qq.chance(0.5)) { pl.tuft(pl.ferns, px, y - 0.05, pz, qq.range(0.7, 1.2), qq.range(0.6, 1.0), yaw, season === 'autumn' ? [0.3, 0.15, 0.05] : [0.1, 0.2, 0.045]); count('ferns'); } continue; }
      if (above < 3 && dist > 60) { if (fine > 0.45) { pl.tuft(cropSet('marram'), px, y - 0.05, pz, qq.range(0.7, 1.1), qq.range(0.5, 0.85), yaw, [0.33, 0.33, 0.2]); count('marram'); } continue; }
      const mown = mownAt(px, pz), town = zn === Z.yard || mown ? 1 : smooth(1 - (Math.min(outsideRect(t.square, px, pz), ...t.blocks.map((r) => outsideBlock(r, px, pz))) - 5) / 30);
      if (zn === Z.yard && fine < 0.45) continue;
      const tall = (0.22 + 0.4 * (1 - town) + 0.15 * fine) * qq.range(0.75, 1.25) * (mown ? 0.45 : 1), tone = qq.range(0.85, 1.15), c = turfAt(px, pz, y);
      pl.tuft(pl.grass, px, y - 0.04, pz, qq.range(0.45, 0.7), tall, yaw, [(0.17 + 0.16 * dried) * c[0] * tone, 0.3 * c[1] * tone, (0.05 + 0.05 * dried) * c[2] * tone]);
      count('grass');
      if (fine > 0.6 && qq.chance(0.25) && season !== 'autumn' && !mown) { pl.tuft(pl.flowers, px, y - 0.03, pz, 0.32, qq.range(0.2, 0.34), yaw, qq.pick([[0.62, 0.62, 0.58], [0.55, 0.2, 0.45], [0.7, 0.6, 0.1]] as Colour[])); count('flowers'); }
    }
    // Trees: the woods, from the edge of the fields up into the hills; fruit trees in rows in the orchards; a few in the yards.
    const wood = wild.mesh('bark');
    wild.group = 'soft';
    const soft = wild.mesh('bark'), softPine = wild.mesh('barkPine');
    wild.group = 'wild';
    const pineWood = wild.mesh('barkPine');
    const leafTint: Colour = season === 'autumn' ? [0.55, 0.38, 0.12] : season === 'summer' ? [0.17, 0.28, 0.08] : [0.24, 0.38, 0.1];
    const leaf = (r: Rng): Colour => shade(leafTint, r.range(0.75, 1.2));
    const tr = rng.fork('trees');
    const grown: [number, number, number][] = [];
    const roomFor = (x: number, z: number, r: number) => !grown.some(([gx, gz, gr]) => Math.hypot(gx - x, gz - z) < gr + r);
    // The woods: grown trees near the town, where they are walked among; beyond, painted ones, each a tree on a tuft of cards, standing
    // thick in the same woods, so that the town is bordered by forest as far as the eye goes. (Grown, a wood that size would be millions
    // of leaves; painted, it is a few thousand cards.)
    const greens: Colour[] = season === 'autumn' ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
      : season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]] : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
    const firs: Colour[] = [[0.045, 0.13, 0.04], [0.06, 0.15, 0.04], [0.04, 0.11, 0.05]];
    const conifer = (x: number, z: number, above: number) => above > 45 + 20 * fbm2(x * 0.02, z * 0.02, 2) || fbm2(x * 0.013 + 5, z * 0.013 + 5, 2) > 0.62;
    const steep = (x: number, z: number) => Math.hypot(ground(x + 3, z) - ground(x - 3, z), ground(x, z + 3) - ground(x, z - 3)) / 6;
    for (let tries = 0; tries < 9000 && grown.length < 230; tries++) {
      const x = tr.range(g.x0 + 10, g.x1 - 10), z = tr.range(g.z0 + 10, g.z1 - 10);
      if (Math.hypot(x - centre.x, (z - centre.z) * 1.2) > 260) continue;
      const w = woodAt(x, z);
      if (w < 0.3 || tr.next() > w * 1.2) continue;
      const y = ground(x, z), above = y - sea;
      if ((rocky.holds(x, z) && rocky.at(x, z) > 0.3) || steep(x, z) > 0.7) continue;
      const pine = conifer(x, z, above) || tr.chance(0.12);
      if (!roomFor(x, z, pine ? 2.6 : 3.6)) continue;
      if (pine) growConifer(pl, pineWood, x, y - 0.05, z, tr.range(9, 17), tr.range(1.6, 2.6), tr.range(0.16, 0.28), { kind: tr.chance(0.5) ? 'spruce' : 'pine', detail: 1, needle: (r) => shade([0.06, 0.13, 0.06], r.range(0.8, 1.2)), bark: [0.8, 0.6, 0.48], soft: softPine }, tr.fork(`c${grown.length}`));
      else growTree(pl, wood, x, y - 0.05, z, tr.range(7, 12), tr.range(0.22, 0.36), { kind: tr.chance(0.55) ? 'oak' : 'ash', detail: 1, cards: 620, cardSize: 0.7, leaf, bark: [0.42, 0.4, 0.36], soft }, tr.fork(`t${grown.length}`));
      grown.push([x, z, pine ? 2.6 : 3.6]);
    }
    let painted = 0;
    const pt = rng.fork('painted trees');
    for (let z = L.z0 + 6; z < L.z1 - 6; z += 4.2) for (let x = L.x0 + 6; x < L.x1 - 6; x += 4.2) {
      const px = x + pt.range(-2, 2), pz = z + pt.range(-2, 2);
      if (Math.hypot(px - centre.x, (pz - centre.z) * 1.2) < 230) continue;
      const w = woodAt(px, pz);
      if (w < 0.25 || pt.next() > w) continue;
      const y = ground(px, pz), above = y - sea;
      if ((rocky.holds(px, pz) && rocky.at(px, pz) > 0.3) || steep(px, pz) > 0.9) continue;
      const fir = conifer(px, pz, above), own = pt.next(), c = fir ? firs[Math.floor(own * 2.999)] : greens[Math.floor(own * (greens.length - 0.001))], tone = (fir ? 0.75 : 0.5) + 0.3 * ((own * 7.3) % 1);
      const tall = fir ? 9 + 7 * ((own * 3.7) % 1) : 7 + 5 * ((own * 3.7) % 1);
      pl.farTree(fir, px, y - 0.4, pz, tall * (fir ? 0.42 : 0.95), tall, own * 6.283, [c[0] * tone, c[1] * tone, c[2] * tone]);
      painted++;
    }
    count('painted trees', painted);
    // The town's own trees: limes along the sides of the square and the back of the waterfront, before the fronts; and in the yards
    // within the blocks, a fruit tree or two in the gardens. None reaches a limb into a building.
    const nearBuildings = (x: number, z: number, r: number) => t.buildings.filter((bd) => Math.abs(bd.x - x) < r + 24 && Math.abs(bd.z - z) < r + 24);
    const keepOutOf = (list: Building[]) => (pnt: Vector3) => list.some((bd) => outsideBuilt(bd, pnt.x, pnt.z) < 0.4 && pnt.y < (bd.y ?? F) + 30);
    const lime = (x: number, z: number, tall: number, k: string) => {
      const y = ground(x, z), list = nearBuildings(x, z, 8);
      growTree(pl, wood, x, y - 0.05, z, tall, tall * 0.028, { kind: 'oak', detail: 1, cards: 760, cardSize: 0.62, leaf: (r) => shade(season === 'autumn' ? [0.62, 0.48, 0.12] : [0.2, 0.34, 0.09], r.range(0.8, 1.15)), bark: [0.36, 0.34, 0.31], soft, wide: 0.8, keepOut: keepOutOf(list) }, tr.fork(k));
      grown.push([x, z, 3]);
    };
    let townTrees = 0;
    {
      const sq = t.square, from = t.stair.z1 + 4;
      for (const side of [-1, 1]) for (let z = from; z < sq.z1 - 3; z += tr.range(7.5, 9)) {
        const x = side < 0 ? sq.x0 + 3.2 : sq.x1 - 3.2;
        if (t.stalls.some((st) => Math.hypot(st.x - x, st.z - z) < 3.5) || (t.fountain && Math.hypot(t.fountain.x - x, t.fountain.z - z) < t.fountain.r + 4)) continue;
        if (nearBuildings(x, z, 3).some((bd) => outsideBuilt(bd, x, z) < 2.2)) continue;
        lime(x, z, tr.range(9, 12), `lime${townTrees++}`);
      }
      const zf = q.z - q.apron + 2.4;
      for (let x = q.x0 + 6; x < q.x1 - 6; x += tr.range(9, 11.5)) {
        if (x > sq.x0 - 3 && x < sq.x1 + 3) continue;
        if (zoneAt(x, zf - 3) === Z.street || nearBuildings(x, zf, 3).some((bd) => outsideBuilt(bd, x, zf) < 1.8)) continue;
        lime(x, zf, tr.range(8, 11), `lime${townTrees++}`);
      }
    }
    count('town trees', townTrees);
    // Gardens in the yards: a fruit tree or two, beds of vegetables in rows, flowers along the walls.
    let fruitInYards = 0;
    for (const [n, blk] of t.blocks.entries()) {
      const yq = rng.fork(`yard${n}`), list = nearBuildings((blk.x0 + blk.x1) / 2, (blk.z0 + blk.z1) / 2, 30);
      const free = (x: number, z: number, m: number) => zoneAt(x, z) === Z.yard && !list.some((bd) => outsideBuilt(bd, x, z) < m);
      for (let tries = 0, made = 0; tries < 30 && made < (blk.kind === 'timber' ? 2 : 1); tries++) {
        const x = yq.range(blk.x0 + 5, blk.x1 - 5), z = yq.range(blk.z0 + 5, blk.z1 - 5);
        if (!free(x, z, 3.2) || !roomFor(x, z, 3)) continue;
        growTree(pl, wood, x, ground(x, z) - 0.05, z, yq.range(3.6, 5.5), yq.range(0.11, 0.16), { kind: yq.chance(0.6) ? 'oak' : 'ash', detail: 1, cards: 300, cardSize: 0.5, leaf: (r) => shade(season === 'autumn' ? [0.48, 0.42, 0.12] : season === 'spring' && yq.chance(0.5) ? [0.62, 0.5, 0.48] : [0.2, 0.34, 0.09], r.range(0.8, 1.15)), bark: [0.34, 0.3, 0.27], soft, wide: 1.2, keepOut: keepOutOf(list) }, yq.fork(`fruit${made}`));
        grown.push([x, z, 2.8]);
        made++; fruitInYards++;
      }
      // (A bed of vegetables in rows, in a timber block's yard.)
      if (blk.kind === 'timber') for (let tries = 0; tries < 20; tries++) {
        const x = yq.range(blk.x0 + 6, blk.x1 - 9), z = yq.range(blk.z0 + 6, blk.z1 - 8), w = yq.range(3, 5), d = yq.range(2.5, 4);
        if (!free(x, z, 1.5) || !free(x + w, z + d, 1.5) || !free(x + w, z, 1.5) || !free(x, z + d, 1.5)) continue;
        for (let rz = z; rz < z + d; rz += 0.55) for (let rx = x; rx < x + w; rx += 0.45) pl.tuft(pl.herbs, rx + yq.range(-0.08, 0.08), ground(rx, rz) - 0.05, rz, yq.range(0.35, 0.5), yq.range(0.25, 0.4), yq.range(0, 6.28), yq.pick([[0.1, 0.22, 0.06], [0.14, 0.24, 0.05], [0.12, 0.18, 0.08]] as Colour[]));
        count('vegetable beds');
        break;
      }
    }
    count('fruit trees in yards', fruitInYards);
    count('trees', grown.length);
    let fruit = 0;
    for (const f of t.fields) {
      if (f.crop !== 'orchard') continue;
      const [ax, az] = f.corners[0], [bx, bz] = f.corners[1], [, ] = f.corners[2], [dx, dz] = f.corners[3];
      for (let u = 0.12; u < 0.95; u += 0.16) for (let v = 0.12; v < 0.95; v += 0.18) {
        const x = ax + (bx - ax) * u + (dx - ax) * v, z = az + (bz - az) * u + (dz - az) * v;
        if (fruit > 70 || zoneAt(x, z) !== Z.field) continue;
        growTree(pl, wood, x, ground(x, z) - 0.05, z, tr.range(3.2, 4.4), tr.range(0.1, 0.15), { kind: 'oak', detail: 1, cards: 220, cardSize: 0.5, leaf: (r) => shade(season === 'autumn' ? [0.45, 0.4, 0.12] : [0.22, 0.36, 0.1], r.range(0.8, 1.15)), bark: [0.36, 0.32, 0.28], soft, wide: 1.2 }, tr.fork(`f${fruit}`));
        fruit++;
      }
    }
    count('fruit trees', fruit);
    b.cards.push(...[...crops.values()].filter((c) => c.matrices.length));
    return counts;
  }

  // ---- the edge of the world: nobody walks off a cliff or swims away, nor out of the country that was made
  {
    const C = 1.2, gx0 = snap(g.x0, false, C), gz0 = snap(g.z0, false, C), nx = Math.round((g.x1 - g.x0) / C) + 1, nz = Math.round((g.z1 - g.z0) / C) + 1;
    const ok = new Uint8Array(nx * nz);
    const onMole = (x: number, z: number) => t.moles.some((m) => { const n = nearLine(m.line.map(([a, c]) => [a, c, 0] as P3), x, z); return n.off < m.width / 2 - 0.2; });
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = gx0 + i * C, z = gz0 + j * C, y = worn(x, z);
      if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) continue;
      let lo = y, hi = y;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) { const hh = worn(x + dx * 1.1, z + dz * 1.1); lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
      const zn = zoneAt(x, z);
      ok[j * nx + i] = (hi - lo < 1.7 && y > sea - 0.35 && lo > sea - 0.6 && zn !== Z.harbour && zn !== Z.river) || onMole(x, z) || onDeck(x, z) || zn === Z.built || (zn === Z.street && !(t.river && riverAt(t, x, z).off < riverAt(t, x, z).half)) || zn === Z.flags || (zn === Z.shack) ? 1 : 0;
    }
    const reach = new Uint8Array(nx * nz), queue: number[] = [];
    const start = Math.round((p.z1 - 2 - gz0) / C) * nx + Math.round(((p.x0 + p.x1) / 2 - gx0) / C);
    if (ok[start]) { reach[start] = 1; queue.push(start); }
    while (queue.length) {
      const k = queue.pop()!, i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, n = jj * nx + ii; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || reach[n] || !ok[n]) continue; reach[n] = 1; queue.push(n); }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (reach[k]) continue;
      let touches = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && reach[jj * nx + ii]) touches = true; }
      if (!touches) continue;
      const x = gx0 + i * C, z = gz0 + j * C;
      let floor = Math.min(sea - 8, worn(x, z) - 4);
      // (Over the hall and its stair, above their roofs: whoever is in them walks under it.)
      if (H && hallGeo) { const { u, v } = hallGeo.inHall(x, z); if (u > -27 && u < hallGeo.frame.L + 4 && Math.abs(v) < hallGeo.frame.half + 22) floor = Math.max(floor, H.floor + H.high + 2.5); }
      if (stairLine.length) { const n = nearLine(stairLine, x, z); if (n.off < 3.5) floor = Math.max(floor, n.y + 4); }
      b.fences.push({ min: V(x - C / 2, floor, z - C / 2), max: V(x + C / 2, F + 140, z + C / 2) });
    }
  }

  // ---- the sea bed, for the sea to know how deep it is
  const BED = 2;
  const bed = { x0: snap(L.x0, false, BED), z0: snap(L.z0, false, BED), cell: BED, nx: Math.round((L.x1 - L.x0) / BED) + 1, nz: Math.round((L.z1 - L.z0) / BED) + 1, data: new Float32Array(0) };
  bed.data = new Float32Array(bed.nx * bed.nz);
  for (let j = 0; j < bed.nz; j++) for (let i = 0; i < bed.nx; i++) bed.data[j * bed.nx + i] = worn(bed.x0 + i * BED, bed.z0 + j * BED);

  // ---- the country round about: the coast either way, the hills and the mountains, drawn far
  wild.group = 'soft';
  {
    const season2 = site.setting.season ?? 'spring';
    const greens: Colour[] = season2 === 'autumn' ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
      : season2 === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]] : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
    const firs: Colour[] = [[0.045, 0.13, 0.04], [0.06, 0.15, 0.04], [0.04, 0.11, 0.05]];
    let far = 0;
    layCountry(mesh('far'), t, F, tint, (x, y, z, fir, own) => {
      const c = fir ? firs[Math.floor(own * 2.999)] : greens[Math.floor(own * (greens.length - 0.001))], tone = (fir ? 0.75 : 0.5) + 0.3 * ((own * 7.3) % 1);
      const tall = fir ? 9 + 7 * ((own * 3.7) % 1) : 7 + 5 * ((own * 3.7) % 1);
      b.planting.farTree(fir, x, y - 0.5, z, tall * (fir ? 0.42 : 0.95), tall, own * 6.283, [c[0] * tone, c[1] * tone, c[2] * tone]);
      far++;
    });
    planted['far trees'] = far;
  }
  wild.group = 'wild';

  // Where the player comes in: on the mole, a few strides short of the light, facing the town.
  const lm = t.moles.reduce((m, o) => (t.light && Math.hypot(o.line[o.line.length - 1][0] - t.light.x, o.line[o.line.length - 1][1] - t.light.z) < Math.hypot(m.line[m.line.length - 1][0] - t.light.x, m.line[m.line.length - 1][1] - t.light.z) ? o : m), t.moles[0]);
  const [hx, hz] = lm.line[lm.line.length - 1], [px2, pz2] = lm.line[lm.line.length - 2], ml = Math.hypot(hx - px2, hz - pz2);
  const sx = hx + ((px2 - hx) / ml) * 8, sz = hz + ((pz2 - hz) / ml) * 8;
  const look = { x: (t.square.x0 + t.square.x1) / 2 - sx, z: (t.square.z0 + t.square.z1) / 2 - sz };
  // Smoke from chimneys: from a share of the houses, rising from their ridges; and from the stovepipes of some of the shacks.
  const smokes: { x: number; y: number; z: number; height: number }[] = [];
  {
    const h = rng.fork('smoke');
    // (Each from one of the chimneys its builder put on it: smoke rising from the middle of a roof, where no chimney stood, was wrong.)
    t.buildings.forEach((bd, n) => {
      const from = chimneys[n];
      if (!from?.length || !h.chance(bd.style === 'imperial' ? 0.12 : 0.18) || smokes.length > 26) return;
      const top = h.pick(from);
      smokes.push({ x: top.x, y: top.y + 0.1, z: top.z, height: h.range(6, 12) });
    });
    for (const top of pipes) if (h.chance(0.2)) smokes.push({ ...top, height: h.range(4, 7) });
  }
  return {
    smokes,
    torches,
    spawn: V(sx, lm.y + 1.75, sz),
    yaw: Math.atan2(-look.x, -look.z),
    track: [...(site.track ?? [])].reverse().slice(1, -1) as [number, number][],
    far: { wood: [0.05, 0.08, 0.035], grass: season === 'autumn' ? [0.24, 0.21, 0.1] : season === 'summer' ? [0.17, 0.21, 0.08] : [0.15, 0.22, 0.08], bare: [0.7, 0.62, 0.52, 0] },
    sea: {
      level: sea, x: (q.x0 + q.x1) / 2, z: q.z + 60, bed,
      // Where the swell breaks: at the foot of the cliffs along the coast, and against the moles' seaward sides.
      spray: (() => {
        const out: { x: number; z: number; nx: number; nz: number }[] = [];
        for (let x = L.x0 + 20; x < L.x1 - 20; x += 6) {
          let z = L.z1 - 10;
          while (z > L.z0 + 20 && worn(x, z) < sea - 0.3) z -= 1.5;
          if (z >= L.z1 - 10 || worn(x, z - 4) < sea + 3 || inHarbour(t, x, z + 3)) continue;
          out.push({ x, z: z + 2.5, nx: 0, nz: 1 });
        }
        return out.filter((_, k) => k % 2 === 0);
      })(),
    },
    planted,
    lamp,
    streams, falls,
    // (The hall and its stair are under the rock: no mist lies in them, nor any shadow of the sun or the clouds.)
    unders: H && hallGeo ? [(() => {
      const f = hallGeo.frame, pts = [[-27, -f.half - 22], [f.L + 4, -f.half - 22], [-27, f.half + 22], [f.L + 4, f.half + 22]].map(([u, v]) => [f.ox + f.ux * u - f.uz * v, f.oz + f.uz * u + f.ux * v]);
      return { min: V(Math.min(...pts.map((p0) => p0[0])), H.floor - H.chasm.depth - 1, Math.min(...pts.map((p0) => p0[1]))), max: V(Math.max(...pts.map((p0) => p0[0])), H.floor + H.high + 2, Math.max(...pts.map((p0) => p0[1]))) };
    })(), { min: V(stairBox!.x0, Math.min(...stairLine.map((p0) => p0[2])) - 1, stairBox!.z0), max: V(stairBox!.x1, Math.max(...stairLine.map((p0) => p0[2])) + 3, stairBox!.z1) }] : [],
    // Sheep in the pastures.
    flocks: (() => {
      const fq = rng.fork('flocks'), out: { x: number; z: number; r: number; count: number }[] = [];
      for (const f of t.fields) {
        if (f.crop !== 'pasture' || out.length >= 4 || fq.chance(0.4)) continue;
        const x = f.corners.reduce((s, c) => s + c[0], 0) / 4, z = f.corners.reduce((s, c) => s + c[1], 0) / 4;
        out.push({ x, z, r: 12, count: fq.int(3, 8) });
      }
      b.planting.crop(out);
      return out;
    })(),
    // Gulls: over the harbour, off the moles, and along the cliffs.
    birds: [
      { x: (q.x0 + q.x1) / 2, y: q.y + 14, z: q.z + 30 },
      ...t.moles.map((m) => ({ x: m.line[m.line.length - 1][0], y: m.y + 8, z: m.line[m.line.length - 1][1] })),
      ...(t.outlook ? [{ x: t.outlook.x, y: t.outlook.y + 6, z: t.outlook.z }] : []),
    ],
  };
}

/**
 * The country seen from the town: the coast either way and the sea, the hills behind and the mountains behind them, the rest of the
 * land the town was found in, drawn in rings about it with the far material, with detail in fewer octaves the further out. Within
 * the town's own land the near sheet is drawn, and this is left out there, or sunk a little under it where the two overlap.
 */
function layCountry(mesh: MeshBuilder, t: Town, F: number, stone: Colour, tree?: (x: number, y: number, z: number, fir: boolean, own: number) => void): void {
  const L = t.land, cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2, sea = t.sea;
  const around = 1280, radii: number[] = [];
  for (let r = 220; r <= 7600; r += 3 + (r - 220) * 0.011) radii.push(r);
  const within = (x: number, z: number, m: number) => x > L.x0 + m && x < L.x1 - m && z > L.z0 + m && z < L.z1 - m;
  const height = (x: number, z: number, r: number) => {
    const y = frameAt(t, F, x, z, r);
    return within(x, z, 6) ? y - 1.5 : y;
  };
  const rings = radii.length, H = new Float32Array(rings * around), X = new Float32Array(rings * around), Zs = new Float32Array(rings * around);
  for (let ri = 0; ri < rings; ri++) for (let k = 0; k < around; k++) {
    const a = (k / around) * Math.PI * 2, q = ri * around + k;
    X[q] = cx + Math.cos(a) * radii[ri]; Zs[q] = cz + Math.sin(a) * radii[ri]; H[q] = height(X[q], Zs[q], radii[ri]);
  }
  const at = (ri: number, k: number) => Math.min(rings - 1, Math.max(0, ri)) * around + ((k + around) % around);
  const ids = new Int32Array(rings * around).fill(-1);
  const id = (ri: number, k: number) => {
    const q = at(ri, k);
    if (ids[q] >= 0) return ids[q];
    const e = at(ri, k + 1), w = at(ri, k - 1), n = at(ri + 1, k), s = at(ri - 1, k);
    const ax = X[e] - X[w], ay = H[e] - H[w], az = Zs[e] - Zs[w], bx = X[n] - X[s], by = H[n] - H[s], bz = Zs[n] - Zs[s];
    let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const span = Math.hypot(ax, az) * 0.5 + Math.hypot(bx, bz) * 0.5;
    const hollow = Math.min(1, Math.max(-1, (((H[e] + H[w] + H[n] + H[s]) / 4 - H[q]) / span) * 9));
    const h = (H[q] - sea) / 220;
    return (ids[q] = mesh.addVertex(X[q], H[q], Zs[q], nx, ny, nz, X[q] * 0.012, Zs[q] * 0.012, 0.37 * (0.6 + 0.4 * stone[0]), 0.37 * (0.6 + 0.4 * stone[1]), 0.4 * (0.6 + 0.4 * stone[2]), 0, 0, hollow, h));
  };
  // Woods on the nearer country: painted trees, thick on the near slopes and thinner further off, in stands, on land that is neither
  // steep nor high nor by the water, and none within the town's own land, which has its own.
  if (tree) {
    const own = (i: number, salt: number) => { let v = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 7919, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
    for (let ri = 0; ri < rings - 1 && radii[ri] < 1700; ri++) for (let k = 0; k < around; k++) {
      const a = at(ri, k), b2 = at(ri, k + 1), c = at(ri + 1, k + 1), d = at(ri + 1, k);
      const area = Math.hypot(X[b2] - X[a], Zs[b2] - Zs[a]) * (radii[ri + 1] - radii[ri]), want = area / (16 + Math.max(0, radii[ri] - 300) * 0.3), n = Math.floor(want) + (own(a, 1) < want % 1 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const u = own(a * 7 + j, 2), v = own(a * 7 + j, 3);
        const x = (X[a] * (1 - u) + X[b2] * u) * (1 - v) + (X[d] * (1 - u) + X[c] * u) * v, z = (Zs[a] * (1 - u) + Zs[b2] * u) * (1 - v) + (Zs[d] * (1 - u) + Zs[c] * u) * v;
        if (within(x, z, 0)) continue;
        const y = (H[a] * (1 - u) + H[b2] * u) * (1 - v) + (H[d] * (1 - u) + H[c] * u) * v, above = y - sea;
        const fall = Math.max(Math.abs(H[b2] - H[a]) / (Math.hypot(X[b2] - X[a], Zs[b2] - Zs[a]) || 1), Math.abs(H[d] - H[a]) / (radii[ri + 1] - radii[ri]));
        const wooded = 0.62 - above / 420 + 0.45 * (fbm2(x * 0.006 + 3.3, z * 0.006, 3) - 0.5) - (above < 8 ? 0.6 : 0);
        if (wooded < 0.25 + 0.3 * own(a * 7 + j, 4) || fall > 1.1 || above > 520) continue;
        tree(x, y, z, fbm2(x * 0.011 + 5, z * 0.011 + 5, 1) + (above / 300 - 0.2) * 0.6 > 0.55, own(a * 7 + j, 5));
      }
    }
  }
  for (let ri = 0; ri < rings - 1; ri++) for (let k = 0; k < around; k++) {
    const qa = at(ri, k), qb = at(ri, k + 1), qc = at(ri + 1, k + 1), qd = at(ri + 1, k);
    if (Math.max(H[qa], H[qb], H[qc], H[qd]) < sea - 2) continue;
    if ([qa, qb, qc, qd].every((qq) => within(X[qq], Zs[qq], 20))) continue;
    const a = id(ri, k), bb = id(ri, k + 1), c = id(ri + 1, k + 1), d = id(ri + 1, k);
    mesh.addTriangle(a, bb, c);
    mesh.addTriangle(a, c, d);
  }
}

