import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { LEAN, toplineOf } from '../core/cathedral';
import { Building, CathedralPart, OPPOSITE, Place, POINTED_RISE, roundStair, Side, Site, SpireKind, STEP_RISE, Way } from '../core/site';
import { archRise, archSdf, Frame, Kit, Opening } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { brickTools, Face, Pt } from './brick';
import { anyAngle } from './coast';

/**
 * The outside of a cathedral (`core/cathedral.ts`), and the windows through its walls.
 *
 * Its rooms are built as any house's are, inside; here is what is seen from the square, the harbour and the roofs of the town:
 *
 * - its walls, traced from the outline of its places in bands of height (each place stands as high as its own vault and the fill
 *   over it, so the nave's walls rise clear of the aisles' roofs as a clerestory, and the towers out of everything);
 * - its windows: tall pointed ones of two to four lights with tracery in their heads, glazed in colour within and dark without; round
 *   windows of radiating tracery in the west front and the transepts' ends where it has them; the belfries' paired openings behind
 *   louvres; and lancets up the towers wherever their stairs leave room;
 * - buttresses at every bay, in three stages, each finished with a pinnacle; over the aisles, from their buttresses to the clerestory,
 *   flying buttresses, each a half arch under a sloping coping;
 * - parapets along the eaves, steep roofs of lead, copper or dark tiles over the nave, the transepts and the choir, lean-tos over the
 *   aisles, a pyramid over the chapter house; gables of stone at the ends, coped, with a cross on each;
 * - the towers in stages, buttressed at the corners, under a parapet with a pinnacle at each corner and a spire of stone (crocketed,
 *   with lucarnes at its foot), of lead or of copper, or none; over the crossing a tower with openings for its bells, or a slender
 *   spire on the ridge;
 * - the west portal: orders of stone stepping in to the doors, a tympanum over them, a gable over the whole with a finial, and a
 *   gallery of figures over it.
 */

type Colour = [number, number, number];
/** A window in one of the church's outer walls: cut through the wall of its place (`a`), and what fills it. */
export type CathedralWindow = Way & { outer: true; circle?: boolean; fill: 'tracery' | 'louvre' | 'plain' };

const T = 1;
const PANE_SIZE = 0.55;
const PANE: Colour = [0.035, 0.045, 0.06];
const LEAD: Colour = [0.44, 0.46, 0.5], COPPER: Colour = [0.22, 0.44, 0.36], TILE: Colour = [0.32, 0.3, 0.33];
const GOLD: Colour = [0.78, 0.6, 0.22], IRON: Colour = [0.05, 0.05, 0.055], OAK: Colour = [0.2, 0.13, 0.085];
/** The colours of the glass, by day: deep blue and ruby above all, with gold, green and purple among them. */
const GLASS: Colour[] = [[0.08, 0.16, 0.78], [0.72, 0.05, 0.06], [0.88, 0.62, 0.1], [0.08, 0.46, 0.18], [0.36, 0.1, 0.58], [0.1, 0.32, 0.72]];
const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];

interface Rect { x0: number; x1: number; z0: number; z1: number }
const grown = (p: Rect, by: number): Rect => ({ x0: p.x0 - by, x1: p.x1 + by, z0: p.z0 - by, z1: p.z1 + by });

/** What the church is made of, read once from the site: its parts, its towers' rooms, how high each place's walls stand outside. */
function survey(site: Site) {
  const c = site.cathedral!, places = site.places;
  const part = new Map<number, CathedralPart>();
  for (const x of c.parts) part.set(x.place, x.part);
  const ground = places.filter((p) => p.role !== 'approach' && (p.level ?? 0) === 0);
  const of = (name: CathedralPart) => ground.find((p) => part.get(p.id) === name);
  const nave = of('nave')!, crossing = of('crossing')!, choir = of('choir')!;
  const yard = places.find((p) => p.role === 'approach')!;
  const same = (a: Place, b: Place) => Math.abs(a.x0 - b.x0) < 0.01 && Math.abs(a.x1 - b.x1) < 0.01 && Math.abs(a.z0 - b.z0) < 0.01 && Math.abs(a.z1 - b.z1) < 0.01;
  /** A tower's rooms from its foot up. */
  const stacks = c.towers.map((t) => {
    const foot = places[t.foot], rooms = places.filter((q) => (q.level ?? 0) > 0 && same(q, foot)).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    return { tower: t, foot, rooms, top: places[t.roof] };
  });
  const stackOf = (p: Place) => stacks.find((s) => s.foot.id === p.id || s.rooms.some((q) => q.id === p.id));
  /** How high the outside of a place of the ground storey stands: the top of its masonry, of its tower, or of the nave it is the first bay of. */
  const column = new Map<number, number>();
  for (const p of ground) {
    const st = stackOf(p);
    column.set(p.id, st ? st.top.floor + st.top.wall : part.get(p.id) === 'narthex' ? toplineOf(nave) : p.roof === 'sky' ? p.floor + p.wall : toplineOf(p));
  }
  return { c, places, part, ground, nave, crossing, choir, yard, stacks, stackOf, column, same };
}
type Survey = ReturnType<typeof survey>;

// ---------------------------------------------------------------------------------------------
// Roofs: what covers each place of the ground storey.

interface Roof {
  owner: number;
  /** A ridged roof with its ridge along `alongX` (or not); a lean-to rising towards `high`; a hipped roof, which over a square is a pyramid. */
  kind: 'gable' | 'lean' | 'hip';
  /** Its extent, to the outer faces of the walls it stands on. */
  x0: number; x1: number; z0: number; z1: number;
  alongX: boolean;
  high?: Side;
  eaves: number;
  pitch: number;
  /** Where its ends are walled up in gables of stone (towards lesser and greater along its ridge), and where it has a parapet along its eaves. */
  gables: [boolean, boolean];
  parapet: boolean;
  cover: [string, Colour];
}

function roofPlan(sv: Survey): Roof[] {
  const { c, part, ground, nave, crossing, choir, column } = sv, roofs: Roof[] = [];
  const cover: [string, Colour] = c.roof === 'copper' ? ['copper', COPPER] : c.roof === 'lead' ? ['metal', LEAD] : ['tile', TILE];
  const twin = c.towers.length === 2, narthex = ground.find((p) => part.get(p.id) === 'narthex');
  const top = column.get(nave.id)!, X0 = nave.x0 - T, X1 = nave.x1 + T;
  // The nave's roof from the west front (or the tower's back) to the crossing, and on over the choir, unless a tower stands over the crossing between.
  const front = twin && narthex ? narthex.z1 + T : nave.z1 + T, east = choir.z0 - T;
  const main = (z0: number, z1: number, g0: boolean, g1: boolean) => roofs.push({ owner: nave.id, kind: 'gable', x0: X0, x1: X1, z0, z1, alongX: false, eaves: top, pitch: c.pitch, gables: [g0, g1], parapet: true, cover });
  if (c.lantern) { main(crossing.z1 + T, front, false, twin); main(east, crossing.z0 - T, true, false); } else main(east, front, true, twin);
  for (const p of ground) {
    const k = part.get(p.id), q = grown(p, T), y = column.get(p.id)!;
    if (k === 'transept') {
      const west = p.x1 < 0, inner = c.lantern ? (west ? crossing.x0 - T : crossing.x1 + T) : 0;
      roofs.push({ owner: p.id, kind: 'gable', x0: west ? q.x0 : inner, x1: west ? inner : q.x1, z0: q.z0, z1: q.z1, alongX: true, eaves: y, pitch: c.pitch, gables: [west, !west], parapet: true, cover });
    } else if (k === 'aisle' || k === 'choir aisle' || k === 'chapel') {
      // (Against the nave, the choir, or the single tower beside the front.)
      const west = p.x1 < 0;
      roofs.push({ owner: p.id, kind: 'lean', x0: west ? q.x0 : nave.x1 + T, x1: west ? nave.x0 - T : q.x1, z0: q.z0, z1: q.z1, alongX: false, high: west ? 'e' : 'w', eaves: y, pitch: LEAN, gables: [k === 'choir aisle', k === 'chapel'], parapet: true, cover });
    } else if (k === 'shrine') {
      roofs.push({ owner: p.id, kind: 'gable', ...q, alongX: false, eaves: y, pitch: c.pitch, gables: [true, false], parapet: true, cover });
    } else if (!k && p.roof !== 'sky') {
      roofs.push({ owner: p.id, kind: 'hip', ...q, alongX: q.x1 - q.x0 >= q.z1 - q.z0, eaves: y, pitch: p.name === 'chapter house' ? 1.25 : 0.8, gables: [false, false], parapet: false, cover: p.name === 'chapter house' ? cover : ['tile', [0.62, 0.36, 0.28]] });
    }
  }
  return roofs;
}

/** How high a roof stands at a point (outside its extent, nothing). */
function roofAt(r: Roof, x: number, z: number): number {
  if (x < r.x0 - 0.01 || x > r.x1 + 0.01 || z < r.z0 - 0.01 || z > r.z1 + 0.01) return -Infinity;
  const inset = r.parapet ? 0.45 : -0.35;
  if (r.kind === 'lean') {
    const run = r.high === 'e' ? x - (r.x0 + inset) : r.high === 'w' ? r.x1 - inset - x : r.high === 's' ? z - (r.z0 + inset) : r.z1 - inset - z;
    return r.eaves + Math.max(0, run) * r.pitch;
  }
  const across = r.alongX ? Math.min(z - r.z0, r.z1 - z) : Math.min(x - r.x0, r.x1 - x), along = r.alongX ? Math.min(x - r.x0, r.x1 - x) : Math.min(z - r.z0, r.z1 - z);
  return r.eaves + Math.max(0, (r.kind === 'hip' ? Math.min(across, along) : across) - inset) * r.pitch;
}

// ---------------------------------------------------------------------------------------------
// Windows.

/** The line of the outer face of a place's wall on one side, and where along it the place runs. */
function faceLine(p: Rect, side: Side) {
  const along = side === 'n' || side === 's';
  return { along, at: side === 'n' ? p.z0 - T : side === 's' ? p.z1 + T : side === 'w' ? p.x0 - T : p.x1 + T, lo: along ? p.x0 : p.z0, hi: along ? p.x1 : p.z1 };
}

/**
 * How high the outside of a place's wall is hidden, between two points along it: by the places beyond it (to the tops of their walls)
 * and by their roofs where they come against it.
 */
function coverOf(sv: Survey, roofs: Roof[], p: Place, side: Side, u0: number, u1: number): number {
  const { ground, column } = sv, line = faceLine(p, side);
  let cover = -Infinity;
  for (const q of ground) {
    if (q.id === p.id) continue;
    const g = grown(q, T);
    // (Beyond the wall: the other's outline, grown by a wall, takes in the line.)
    const across = line.along ? (side === 'n' ? g.z1 : g.z0) : (side === 'w' ? g.x1 : g.x0);
    if (Math.abs(across - (side === 'n' || side === 'w' ? line.at + T : line.at - T)) > 0.05) continue;
    const lo = line.along ? g.x0 : g.z0, hi = line.along ? g.x1 : g.z1;
    if (hi <= u0 + 0.01 || lo >= u1 - 0.01) continue;
    cover = Math.max(cover, column.get(q.id)!);
  }
  // Roofs against the wall, just outside it.
  const step = 0.25, out = side === 'n' || side === 'w' ? -0.05 : 0.05;
  for (const r of roofs) {
    if (r.owner === p.id) continue;
    for (let u = u0; u <= u1 + 1e-6; u += step) {
      const x = line.along ? u : line.at + out, z = line.along ? line.at + out : u;
      cover = Math.max(cover, roofAt(r, x, z));
    }
  }
  return cover;
}

/** The windows of the church's outer walls, by place: worked out from what of each wall is seen, and where its bays are. */
export function cathedralWindows(site: Site): Map<number, CathedralWindow[]> {
  const sv = survey(site), roofs = roofPlan(sv), { c, part, places } = sv, out = new Map<number, CathedralWindow[]>();
  const add = (p: Place, w: CathedralWindow) => { if (!out.has(p.id)) out.set(p.id, []); out.get(p.id)!.push(w); };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const holesOf = (p: Place, side: Side) => site.ways.filter((w) => w.kind !== 'stair' && (w.a === p.id || w.b === p.id) && (w.a === p.id ? w.side : OPPOSITE[w.side]) === side);
  /** The highest any opening already in that wall reaches near a point along it. */
  const holeTop = (p: Place, side: Side, at: number, half: number) => Math.max(-Infinity, ...holesOf(p, side).filter((w) => Math.abs(w.at - at) < w.halfWidth + half + 0.5).map((w) => {
    const lo = Math.max(places[w.a].floor, places[w.b].floor);
    return lo + (w.spring ?? 2.0) + archRise(w.halfWidth, w.pointed ? 2 : 1) - p.floor;
  }));
  /** Where a window may go: from what hides the wall to under the vault (in an end wall, under its point), as heights over the floor. */
  const span = (p: Place) => (p.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0);
  const isEnd = (p: Place, side: Side) => (p.axis === 'x') === (side === 'e' || side === 'w');
  const tryWindow = (p: Place, side: Side, at: number, half: number, o: { sill?: number; fill?: CathedralWindow['fill']; rose?: boolean; lunette?: boolean } = {}): boolean => {
    const cover = coverOf(sv, roofs, p, side, at - half - 0.3, at + half + 0.3) - p.floor;
    let sill = Math.max(o.sill ?? 1.6, cover + 0.8, holeTop(p, side, at, half) + 0.9);
    const end = p.roof === 'barrel' && isEnd(p, side), point = p.pointed ? 1.5 : 1, R = span(p) / 2 / (p.spans ?? 1);
    // (In the end wall under a vault, a window may rise into the vault's lunette, keeping clear of its curve.)
    const mid = side === 'n' || side === 's' ? (p.x0 + p.x1) / 2 : (p.z0 + p.z1) / 2;
    const ceiling = p.roof === 'barrel' ? p.wall - 0.4 : p.wall - 0.35;
    const under = (y: number, u: number) => (end && o.lunette !== false ? y < p.wall - 0.3 || archSdf(u - mid, y - p.wall, R, point) < -0.55 : y < ceiling);
    if (o.rose) {
      // A round window as large as the wall leaves room for, up to a radius of five metres.
      const top = end ? p.wall + (p.pointed ? R * POINTED_RISE : R) - 0.6 : ceiling;
      let r = Math.min(5, half, (top - sill) / 2);
      for (; r >= 1.4; r -= 0.1) {
        const yc = Math.min(top - r, Math.max(sill + r, (sill + top) / 2));
        const ok = [0, 1, 2, 3, 4, 5, 6, 7].every((i) => { const a = (i / 8) * Math.PI * 2; return under(yc + Math.sin(a) * (r + 0.2), at + Math.cos(a) * (r + 0.2)); });
        if (ok && yc - r >= sill - 1e-6) { add(p, { a: p.id, b: p.id, side, kind: 'window', at: r2(at), halfWidth: r2(r), spring: r2(yc), outer: true, circle: true, fill: 'tracery' }); return true; }
      }
      return false;
    }
    // A pointed window: its head as high as it can go, its sill where the wall is first seen.
    let spring = ceiling - archRise(half, 2);
    if (end) { for (let y = p.wall + (p.pointed ? R * POINTED_RISE : R); y > sill; y -= 0.1) { const s = y - archRise(half, 2); if (under(y, at) && under(s + archRise(half, 2) * 0.5, at - half * 0.9) && under(s, at + half)) { spring = s; break; } } }
    sill = Math.max(sill, o.sill ?? 0);
    if (spring - sill < Math.max(1.4, half * 1.2)) return false;
    add(p, { a: p.id, b: p.id, side, kind: 'window', at: r2(at), halfWidth: r2(half), sill: r2(sill), spring: r2(spring), pointed: true, outer: true, fill: o.fill ?? 'tracery' });
    return true;
  };

  const arcadeAt = (p: Place) => site.ways.filter((w) => w.kind === 'arch' && (w.a === p.id || w.b === p.id) && (part.get(w.a) === 'nave' || part.get(w.a) === 'choir') && (part.get(w.b) === 'aisle' || part.get(w.b) === 'choir aisle')).map((w) => w.at);
  for (const p of sv.ground) {
    const k = part.get(p.id), st = sv.stackOf(p);
    if (st || p.roof === 'sky') continue;
    const bays = [...new Set(arcadeAt(p))].sort((a, b) => a - b), B = bays.length >= 2 ? bays[1] - bays[0] : 5.8;
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const line = faceLine(p, side), long = line.hi - line.lo, end = p.roof === 'barrel' && isEnd(p, side);
      if (k === 'nave' || k === 'choir' || k === 'aisle' || k === 'choir aisle' || k === 'chapel') {
        if (!end) { for (const at of bays.length ? bays : [(line.lo + line.hi) / 2]) tryWindow(p, side, at, Math.min(k === 'nave' || k === 'choir' ? 1.7 : 1.25, B / 2 - 0.85)); continue; }
        // (The choir's east end over the shrine's roof, and the chapels' fronts: one window, or a round one.)
        if (k === 'choir' || k === 'nave') { if (!(c.rose && tryWindow(p, side, (line.lo + line.hi) / 2, long / 2 - 1.2, { rose: true }))) tryWindow(p, side, (line.lo + line.hi) / 2, Math.min(2.6, long / 2 - 1.4)); }
        else tryWindow(p, side, (line.lo + line.hi) / 2, Math.min(1.3, long / 2 - 1.1), { sill: 3 });
      } else if (k === 'narthex') {
        if (side !== 's') continue;
        // The west front, over its portal and the gallery of figures over that: a round window, or a great window of lights.
        const door = site.ways.find((w) => w.a === p.id && w.side === 's' && w.kind === 'door');
        const sill = (door?.spring ?? 2.9) + 11.5;
        if (!(c.rose && tryWindow(p, side, (line.lo + line.hi) / 2, Math.min(5, long / 2 - 1.3), { sill, rose: true }))) tryWindow(p, side, (line.lo + line.hi) / 2, Math.min(2.6, long / 2 - 1.5), { sill });
      } else if (k === 'transept') {
        if (end) {
          // Its end: a tall window of lights, and over it, in the lunette, a round one.
          const mid = (line.lo + line.hi) / 2, tall = tryWindow(p, side, mid, Math.min(2.4, long / 2 - 1.6), { sill: 3, lunette: false });
          if (c.rose) tryWindow(p, side, mid, long / 2 - 1.3, { rose: true, sill: tall ? p.wall - 0.2 : 3 });
        } else {
          const n = Math.max(1, Math.round(long / 6)), w = Math.min(1.5, long / n / 2 - 0.9);
          for (let i = 0; i < n; i++) tryWindow(p, side, line.lo + (long * (i + 0.5)) / n, w);
        }
      } else if (k === 'shrine') {
        if (end) { tryWindow(p, side, (line.lo + line.hi) / 2, Math.min(2.2, long / 2 - 1.3), { sill: 2.4 }); continue; }
        const n = Math.max(1, Math.round(long / 4.2));
        for (let i = 0; i < n; i++) tryWindow(p, side, line.lo + (long * (i + 0.5)) / n, Math.min(1.1, long / n / 2 - 0.8), { sill: 2.4 });
      } else if (p.name === 'chapter house') {
        const n = Math.max(1, Math.round(long / 3.6));
        for (let i = 0; i < n; i++) tryWindow(p, side, line.lo + (long * (i + 0.5)) / n, Math.min(1.0, long / n / 2 - 0.6), { sill: 2.2 });
      } else if (p.light !== 'dark') {
        const n = Math.max(1, Math.round(long / 3.4));
        for (let i = 0; i < n; i++) tryWindow(p, side, line.lo + (long * (i + 0.5)) / n, 0.42, { sill: 1.4, fill: 'plain' });
      }
    }
  }
  // The towers: lancets up their stairs wherever the flight leaves room, and the belfries' paired openings, behind louvres.
  for (const st of sv.stacks) {
    const [shaft, belfry] = st.rooms;
    const climb = site.ways.find((w) => w.kind === 'stair' && w.a === shaft.id && w.round);
    const legs = climb ? roundStair(site, climb).legs : [];
    const up = site.ways.find((w) => w.kind === 'stair' && w.a === belfry.id);
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const line = faceLine(shaft, side), mid = (line.lo + line.hi) / 2;
      // (Each a lancet three and a half metres high; clear of every leg of the stair on that wall, above it by a man's height or below it.)
      for (let sill = 3; sill < shaft.wall - 5; sill += 0.5) {
        const top = sill + 3.6;
        if (legs.some((l) => l.side === side && sill < l.y0 + l.steps * STEP_RISE + 2.6 && top > l.y0 - 0.5)) continue;
        if (tryWindow(shaft, side, mid, 0.42, { sill, fill: 'plain' })) {
          // (`tryWindow` raises its head to the ceiling: brought down to three and a half metres over its sill.)
          const w = out.get(shaft.id)!.at(-1)!;
          if (w.spring! > sill + 3.0 || legs.some((l) => l.side === side && w.sill! < l.y0 + l.steps * STEP_RISE + 2.6 && w.spring! + 0.8 > l.y0 - 0.5)) w.spring = r2(w.sill! + 3.0);
          if (legs.some((l) => l.side === side && w.sill! < l.y0 + l.steps * STEP_RISE + 2.6 && w.spring! + 0.8 > l.y0 - 0.5)) out.get(shaft.id)!.pop();
          sill = (w.spring ?? sill) + 6;
        }
      }
      if (up && side === up.side) continue;
      const blen = line.hi - line.lo, n = blen > 9 ? 3 : 2, half = Math.min(1.0, blen / (2 * n) - 0.5);
      for (let i = 0; i < n; i++) tryWindow(belfry, side, mid + (i - (n - 1) / 2) * (2 * half + 0.8), half, { sill: 0.6, fill: 'louvre' });
    }
  }
  return out;
}

/** The highest points of the church: its spires' and towers' tops, for the box the sun's shadow is drawn over. */
export function spireTops(site: Site): number[] {
  const c = site.cathedral!, out: number[] = [];
  for (const t of c.towers) out.push(site.places[t.roof].floor + Math.max(3, t.spireHeight) + 2);
  const nave = site.places.find((p) => c.parts.some((x) => x.place === p.id && x.part === 'nave'))!;
  if (c.lantern) out.push(nave.floor + c.lantern.top + c.lantern.spireHeight + 2);
  if (c.fleche) out.push(toplineOf(nave) + (nave.x1 - nave.x0) / 2 * c.pitch + c.fleche + 2);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Building it.

export interface CathedralContext {
  kit: Kit;
  site: Site;
  outerWindows: Map<number, (Way & { outer: true; circle?: boolean })[]>;
  shape: (w: Way) => { y0: number; ys: number; point?: number; circle?: boolean };
  /** Ashlar for the great walls, and for the lower ones; dressed stone; copings. */
  ashlar: MasonryStyle;
  plain: MasonryStyle;
  dressed: MasonryStyle;
  coping: MasonryStyle;
  stoneTint: Colour;
  rng: Rng;
}

/** A run of outer wall: the way its face looks, where it stands across, from and to along it, and from and to in height. */
interface Run { side: Side; at: number; from: number; to: number; y0: number; y1: number }

export function buildCathedral(cx: CathedralContext): void {
  const { kit, site, ashlar, plain, dressed, coping, stoneTint } = cx;
  const sv = survey(site), roofs = roofPlan(sv), { c, part, places, ground, column, yard } = sv;
  const rng = cx.rng;
  const low = yard.floor - 0.7, F = sv.nave.floor;
  // (Long courses and great stones for what is large: copings, buttresses, parapets.)
  const long: MasonryStyle = { ...coping, maxSeg: 1.5 }, bigDressed: MasonryStyle = dressed;
  const STONE: Colour = [0.86 * stoneTint[0], 0.8 * stoneTint[1], 0.7 * stoneTint[2]], PALE: Colour = shade(STONE, 1.08);
  const fake: Building = { style: 'brick', x: 0, z: 0, w: 1, d: 0, faces: 'w', storeys: 1, heights: [3], bays: 1, colour: [1, 1, 1] };
  const k = brickTools(fake, 0, (m) => kit.mesh(m)), any = anyAngle((m) => kit.mesh(m));
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const outward: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

  // ---- the walls, in bands of height: in each band, the outline of every place that stands at least that high, traced exactly on
  // the lines of their edges; a face of wall along every stretch of it, carried up through the bands for as long as it goes on.
  const tops = [...new Set(ground.map((p) => Math.round(column.get(p.id)! * 100) / 100))].sort((a, b) => a - b);
  const runs: Run[] = [];
  {
    let open = new Map<string, Run>();
    let y0 = low;
    for (const y1 of tops) {
      // (The band's top is rounded to the centimetre, and a place's own top may be a hair under it.)
      const solid = ground.filter((p) => column.get(p.id)! >= y1 - 0.011).map((p) => grown(p, T));
      const xs = [...new Set(solid.flatMap((r) => [r.x0, r.x1]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
      const zs = [...new Set(solid.flatMap((r) => [r.z0, r.z1]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
      const inside = (x: number, z: number) => solid.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
      const cell = (i: number, j: number) => i >= 0 && j >= 0 && i < xs.length - 1 && j < zs.length - 1 && inside((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
      const found: Run[] = [];
      for (let j = 0; j < zs.length; j++) {
        let run: Run | null = null;
        for (let i = 0; i < xs.length - 1; i++) {
          const a = cell(i, j - 1), b = cell(i, j), side: Side | null = a !== b ? (b ? 'n' : 's') : null;
          if (run && run.side === side) { run.to = xs[i + 1]; continue; }
          if (run) found.push(run);
          run = side ? { side, at: zs[j], from: xs[i], to: xs[i + 1], y0, y1 } : null;
        }
        if (run) found.push(run);
      }
      for (let i = 0; i < xs.length; i++) {
        let run: Run | null = null;
        for (let j = 0; j < zs.length - 1; j++) {
          const a = cell(i - 1, j), b = cell(i, j), side: Side | null = a !== b ? (b ? 'w' : 'e') : null;
          if (run && run.side === side) { run.to = zs[j + 1]; continue; }
          if (run) found.push(run);
          run = side ? { side, at: xs[i], from: zs[j], to: zs[j + 1], y0, y1 } : null;
        }
        if (run) found.push(run);
      }
      const next = new Map<string, Run>();
      for (const r of found) {
        const key = `${r.side}|${r.at}|${r.from}|${r.to}`, was = open.get(key);
        if (was) { was.y1 = y1; next.set(key, was); open.delete(key); } else next.set(key, r);
      }
      for (const r of open.values()) runs.push(r);
      open = next;
      y0 = y1;
    }
    for (const r of open.values()) runs.push(r);
  }
  const frameFor = (r: { side: Side; at: number }, a: number, b: number): Frame =>
    r.side === 'n' ? kit.frame(b, r.at, a, r.at) : r.side === 's' ? kit.frame(a, r.at, b, r.at) : r.side === 'w' ? kit.frame(r.at, a, r.at, b) : kit.frame(r.at, b, r.at, a);
  const alongRun = (r: { side: Side }, a: number, b: number, at: number) => (r.side === 'n' || r.side === 'e' ? b - at : at - a);
  const faceOf = (f: Frame): Face => ({ L: f.length, P: (s, y, t) => V(f.a.x + f.dir.x * s - f.normal.x * t, y, f.a.z + f.dir.z * s - f.normal.z * t) });
  /** The place a stretch of outer wall belongs to: whichever of the ground storey's outlines, grown by a wall, it is the edge of. */
  const ownerOf = (r: Run, along: number) => ground.find((q) => {
    const g = grown(q, T), [ox, oz] = outward[r.side];
    const x = r.side === 'n' || r.side === 's' ? along : r.at - ox * 0.3, z = r.side === 'n' || r.side === 's' ? r.at - oz * 0.3 : along;
    return x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1 && column.get(q.id)! >= r.y1 - 0.011;
  });
  /** The openings a place's windows cut in an outer face along a line: its own, and those of its tower's rooms. */
  const lineOf = (q: Place, side: Side) => faceLine(q, side).at;
  const windowsOn = (r: Run) => {
    const list: { w: Way & { outer: true; circle?: boolean }; q: Place }[] = [];
    for (const [id, ws] of cx.outerWindows) {
      const q = places[id];
      for (const w of ws) if (w.side === r.side && Math.abs(lineOf(q, w.side) - r.at) < 0.05 && w.at > r.from + 0.2 && w.at < r.to - 0.2) list.push({ w, q });
    }
    return list;
  };
  const opening = (w: Way): Opening => ({ c: 0, w: w.halfWidth, ...cx.shape(w) });
  const doorsOn = (r: Run) => site.ways.filter((w) => w.kind === 'door' && (w.a === yard.id || w.b === yard.id)).filter((w) => {
    const q = places[w.a === yard.id ? w.b : w.a];
    return w.side && Math.abs(lineOf(q, 's') - r.at) < 0.05 && r.side === 's' && w.at > r.from && w.at < r.to;
  });

  // Walls, plinth, and a moulded course under the top of each.
  for (const r of runs) {
    const owner = ownerOf(r, (r.from + r.to) / 2);
    kit.group = owner ? `p${owner.id}` : 'roofs';
    const f = frameFor(r, r.from, r.to), holes: Opening[] = [];
    for (const { w } of windowsOn(r)) holes.push({ ...opening(w), c: alongRun(r, r.from, r.to, w.at) });
    for (const w of doorsOn(r)) holes.push({ ...opening(w), c: alongRun(r, r.from, r.to, w.at) });
    // (Stones as a house's within a few metres of the ground, where they are seen close; larger blocks over that.)
    const split = Math.min(r.y1, Math.max(r.y0, low + 7.2));
    if (split > r.y0 + 0.05) kit.wallFace('stone', f, r.y0, split, plain, { openings: holes });
    if (r.y1 > split + 0.05) kit.wallFace('stone', f, split, r.y1, ashlar, { openings: holes, courseKey: 'high' });
    const ledge = (a: number, b: number, y0: number, y1: number, out: number, style: MasonryStyle, tag: string) => {
      const [dx, dz] = outward[r.side], alongX = r.side === 'n' || r.side === 's';
      if (b - a < 0.05 || y1 - y0 < 0.02) return;
      const p0 = alongX ? V(a, y0, r.at) : V(r.at, y0, a), p1 = alongX ? V(b, y1, r.at + dz * out) : V(r.at + dx * out, y1, b);
      kit.box('stone', V(Math.min(p0.x, p1.x), y0, Math.min(p0.z, p1.z)), V(Math.max(p0.x, p1.x), y1, Math.max(p0.z, p1.z)), style, style, tag);
    };
    // (Broken for the doors.)
    if (r.y0 <= low + 0.01) {
      let a = r.from;
      for (const w of [...doorsOn(r)].sort((p, q) => p.at - q.at)) { ledge(a, w.at - w.halfWidth - 0.35, low + 0.3, low + 1.15, 0.22, long, 'plinth'); a = w.at + w.halfWidth + 0.35; }
      ledge(a, r.to, low + 0.3, low + 1.15, 0.22, long, 'plinth');
    }
    if (r.y1 - r.y0 > 1.5) ledge(r.from, r.to, r.y1 - 0.5, r.y1 - 0.05, 0.28, long, 'cornice');
  }

  // ---- the windows: their dressings through the wall, sills, and what fills them
  const outline = (op: Opening, n = 10): Pt[] => {
    if (op.circle) return Array.from({ length: 28 }, (_, i): Pt => [op.c + Math.cos((i / 28) * Math.PI * 2) * op.w, op.ys + Math.sin((i / 28) * Math.PI * 2) * op.w]);
    const pts: Pt[] = [[op.c - op.w, op.y0], [op.c + op.w, op.y0], [op.c + op.w, op.ys]];
    const point = op.point ?? 1, R = point * op.w, sweep = point > 1 ? Math.acos((R - op.w) / R) : Math.PI / 2;
    if (point <= 1) for (let i = 1; i < 2 * n; i++) { const a = (Math.PI * i) / (2 * n); pts.push([op.c + Math.cos(a) * op.w, op.ys + Math.sin(a) * op.w]); }
    else {
      for (let i = 1; i <= n; i++) { const a = (sweep * i) / n; pts.push([op.c - (R - op.w) + Math.cos(a) * R, op.ys + Math.sin(a) * R]); }
      for (let i = n - 1; i >= 1; i--) { const a = Math.PI - (sweep * i) / n; pts.push([op.c + (R - op.w) + Math.cos(a) * R, op.ys + Math.sin(a) * R]); }
    }
    pts.push([op.c - op.w, op.ys]);
    return pts;
  };
  const inside = (op: Opening, s: number, y: number) => (op.circle ? Math.hypot(s - op.c, y - op.ys) < op.w : y > op.y0 && Math.abs(s - op.c) < op.w && (y < op.ys || archSdf(s - op.c, y - op.ys, op.w, op.point) < 0));
  /** Coloured glass on the inside of a window, in panes about a third of a metre, in bands and borders as the old glaziers set them. */
  const stained = (f: Face, op: Opening, t: number, seed: number) => {
    const q = rng.fork(`glass${seed}`), size = PANE_SIZE, cols = Math.max(2, Math.round((op.w * 2) / size)), cw = (op.w * 2) / cols;
    const top = op.circle ? op.ys + op.w : op.ys + archRise(op.w, op.point), bottom = op.circle ? op.ys - op.w : op.y0, rows = Math.max(2, Math.round((top - bottom) / size)), ch = (top - bottom) / rows;
    const theme = q.int(0, 1);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const s0 = op.c - op.w + i * cw, y0 = bottom + j * ch, sm = s0 + cw / 2, ym = y0 + ch / 2;
      if (!inside(op, sm, ym) || !inside(op, s0 + 0.03, y0 + 0.03) || !inside(op, s0 + cw - 0.03, y0 + ch - 0.03) || !inside(op, s0 + 0.03, y0 + ch - 0.03) || !inside(op, s0 + cw - 0.03, y0 + 0.03)) continue;
      const edge = i === 0 || i === cols - 1, band = Math.floor(j / 3) % 2, odd = q.int(0, 7);
      const hue = op.circle ? GLASS[(Math.floor(Math.hypot(sm - op.c, ym - op.ys) / 0.6) + theme) % 3 === 0 ? 2 : (Math.floor(Math.atan2(ym - op.ys, sm - op.c) * 3) + 6) % 2 === 0 ? 0 : 1]
        : edge ? GLASS[2] : odd === 0 ? GLASS[3] : odd === 1 ? GLASS[4] : GLASS[(band + theme) % 2 === 0 ? 0 : 1];
      const tone = q.range(0.8, 1.15), a = f.P(s0 + 0.012, y0 + 0.012, t), b = f.P(s0 + cw - 0.012, y0 + 0.012, t), cc = f.P(s0 + cw - 0.012, y0 + ch - 0.012, t), d = f.P(s0 + 0.012, y0 + ch - 0.012, t);
      const into = f.P(sm, ym, t + 1);
      any.face('stained', [[a.x, a.y, a.z], [b.x, b.y, b.z], [cc.x, cc.y, cc.z], [d.x, d.y, d.z]], shade(hue, tone), [2 * a.x - into.x, a.y, 2 * a.z - into.z]);
    }
  };
  /** Tracery: mullions dividing the window into lights, each with a pointed head of its own, a ring in the head over them, and bars. */
  const tracery = (f: Face, op: Opening, deep: number) => {
    const wide = op.w * 2, lights = wide > 3.6 ? 4 : wide > 2.2 ? 3 : 2, bar = 0.16, lw = (wide - bar * (lights - 1)) / lights;
    for (let i = 1; i < lights; i++) {
      const s = op.c - op.w + i * (lw + bar) - bar / 2;
      k.on(f, 'stone', s - bar / 2, s + bar / 2, op.y0, op.ys + 0.02, deep - 0.06, deep + 0.14, PALE);
    }
    const stick = (a: Pt, b: Pt) => k.stick(f.P(a[0], a[1], deep + 0.04), f.P(b[0], b[1], deep + 0.04), 0.2, 0.13, PALE, 'stone');
    const riseL = archRise((lw + bar) / 2, 2);
    for (let i = 0; i < lights; i++) {
      const a = op.c - op.w + i * (lw + bar) - (i ? bar / 2 : 0), b = a + lw + (i ? bar / 2 : 0) + (i < lights - 1 ? bar / 2 : 0);
      const line = outline({ c: (a + b) / 2, w: (b - a) / 2, y0: op.ys, ys: op.ys, point: 2 }, 5).slice(2, -1);
      for (let q = 0; q < line.length - 1; q++) stick(line[q], line[q + 1]);
    }
    // The ring, as large as the head over the lights allows; and in a tall window, bars of stone across every three metres or so.
    const head = op.ys + archRise(op.w, op.point), free = head - (op.ys + riseL), r = Math.min(op.w * 0.5, free / 2 - 0.15);
    if (r > 0.25) {
      const yc = op.ys + riseL + free * 0.42;
      k.disc(f, op.c, yc, r, deep - 0.05, deep + 0.13, 'stone', PALE, r - 0.13);
      // (Cusps within it: a quatrefoil of four smaller rings.)
      if (r > 0.6) for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; k.disc(f, op.c + Math.cos(a) * r * 0.42, yc + Math.sin(a) * r * 0.42, r * 0.36, deep - 0.03, deep + 0.11, 'stone', PALE, r * 0.36 - 0.08); }
    }
    const transoms = Math.floor((op.ys - op.y0) / 3.2);
    for (let i = 1; i <= transoms; i++) { const y = op.y0 + ((op.ys - op.y0) * i) / (transoms + 1); k.on(f, 'stone', op.c - op.w, op.c + op.w, y - 0.08, y + 0.08, deep - 0.04, deep + 0.12, PALE); }
    for (let y = op.y0 + 0.55; y < op.ys - 0.2; y += 0.55) k.on(f, 'metal', op.c - op.w + 0.02, op.c + op.w - 0.02, y - 0.012, y + 0.012, deep + 0.02, deep + 0.05, IRON);
  };
  /** A round window's tracery: a ring at its edge, a hub, spokes between, and a ring of smaller roundels on them. */
  const rose = (f: Face, op: Opening, deep: number) => {
    const r = op.w, n = r > 3 ? 16 : 12, hub = r * 0.2;
    k.disc(f, op.c, op.ys, r + 0.02, deep - 0.06, deep + 0.14, 'stone', PALE, r - 0.22);
    k.disc(f, op.c, op.ys, hub, deep - 0.06, deep + 0.14, 'stone', PALE, hub - 0.16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      k.stick(f.P(op.c + ca * hub, op.ys + sa * hub, deep + 0.04), f.P(op.c + ca * (r - 0.2), op.ys + sa * (r - 0.2), deep + 0.04), 0.18, 0.13, PALE, 'stone');
      const b = a + Math.PI / n, rr = (r - hub) * 0.22;
      k.disc(f, op.c + Math.cos(b) * r * 0.66, op.ys + Math.sin(b) * r * 0.66, rr, deep - 0.03, deep + 0.11, 'stone', PALE, rr - 0.1);
    }
  };
  /** Louvres in a belfry's opening: dark within, boards set across it sloping out, to keep the weather off the bells and let their sound out. */
  const louvres = (f: Face, op: Opening, deep: number) => {
    k.prism(f, outline(op), [], deep + 0.4, deep + 0.44, 'wood', [0.015, 0.014, 0.012]);
    for (let y = op.y0 + 0.14; y < op.ys + archRise(op.w, op.point) * 0.5; y += 0.26) {
      const half = y < op.ys ? op.w : Math.max(0.05, op.w - (op.w * 2 - Math.sqrt(Math.max(0, (2 * op.w) ** 2 - (y - op.ys) ** 2))));
      k.on(f, 'wood', op.c - half + 0.02, op.c + half - 0.02, y, y + 0.03, deep - 0.04, deep + 0.22, shade(OAK, 0.75), true);
    }
  };
  let seed = 0;
  const dressedDone = new Set<Way>();
  for (const r of runs) {
    for (const { w, q } of windowsOn(r)) {
      if (dressedDone.has(w)) continue;
      dressedDone.add(w);
      kit.group = `p${q.id}`;
      const f = frameFor(r, r.from, r.to), op: Opening = { ...opening(w), c: alongRun(r, r.from, r.to, w.at) }, face = faceOf(f);
      kit.openingTrim('stone', f, op, T, op.w > 1.1 || op.ys - op.y0 > 4 ? bigDressed : dressed, 'both');
      const fill = (w as CathedralWindow).fill ?? 'plain';
      if (!op.circle) {
        const sill = { min: face.P(op.c - op.w - 0.25, op.y0 - 0.16, -0.12), max: face.P(op.c + op.w + 0.25, op.y0, T * 0.6) };
        kit.box('stone', V(Math.min(sill.min.x, sill.max.x), op.y0 - 0.16, Math.min(sill.min.z, sill.max.z)), V(Math.max(sill.min.x, sill.max.x), op.y0, Math.max(sill.min.z, sill.max.z)), coping, coping, 'sill');
      }
      // (A hood over the head, a moulding following its curve a hand out from the wall.)
      if (!op.circle && op.w > 0.5) {
        const line = outline({ ...op, w: op.w + 0.24 }, 8).slice(2, -1);
        for (let i = 0; i < line.length - 1; i++) k.stick(face.P(line[i][0], line[i][1], -0.08), face.P(line[i + 1][0], line[i + 1][1], -0.08), 0.16, 0.14, PALE, 'stone');
      }
      const deep = T * 0.45;
      if (fill === 'louvre') { louvres(face, op, deep); continue; }
      k.prism(face, outline(op), [], deep + 0.06, deep + 0.08, 'glass', PANE);
      if (fill === 'tracery') {
        if (op.circle) rose(face, op, deep); else tracery(face, op, deep);
        stained(face, op, deep + 0.1, seed++);
      }
    }
  }

  // ---- buttresses, at every bay of the church's walls and its corners, each in three stages with a pinnacle over it; and over the
  // aisles, from their buttresses, flying buttresses to the clerestory
  const pinnacle = (x: number, y: number, z: number, r: number, h: number) => {
    k.shaft(V(x, y, z), r * 1.15, h * 0.42, 4, Math.PI / 4, 'stone', STONE);
    k.pyramid(V(x, y + h * 0.42, z), r * 1.15, h * 0.58, 4, Math.PI / 4, 'stone', PALE);
    // (Crockets up its edges, and a finial.)
    for (let i = 1; i < 4; i++) for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2, t = i / 4, rr = r * 1.15 * (1 - t) + 0.06, yy = y + h * 0.42 + h * 0.58 * t;
      k.block('stone', V(x + Math.cos(a) * rr - 0.06, yy - 0.06, z + Math.sin(a) * rr - 0.06), V(x + Math.cos(a) * rr + 0.06, yy + 0.06, z + Math.sin(a) * rr + 0.06), PALE);
    }
    k.block('stone', V(x - 0.09, y + h, z - 0.09), V(x + 0.09, y + h + 0.32, z + 0.09), PALE);
  };
  const isChurch = (q: Place | undefined) => !!q && !!part.get(q.id) && part.get(q.id) !== 'tower';
  const nave = sv.nave, naveWallTop = nave.floor + nave.wall;
  const buttress = (r: Run, at: number, top: number, flyer: boolean) => {
    const [ox, oz] = outward[r.side], alongX = r.side === 'n' || r.side === 's';
    const box = (a: number, b: number, y0: number, y1: number, out: number, style: MasonryStyle, tag: string) => {
      const p0 = alongX ? V(at + a, y0, r.at) : V(r.at, y0, at + a), p1 = alongX ? V(at + b, y1, r.at + oz * out) : V(r.at + ox * out, y1, at + b);
      kit.box('stone', V(Math.min(p0.x, p1.x), y0, Math.min(p0.z, p1.z)), V(Math.max(p0.x, p1.x), y1, Math.max(p0.z, p1.z)), style, style, tag);
    };
    const h = top - low, s1 = low + h * 0.38, s2 = low + h * 0.72, deep = Math.min(1.9, 1.1 + h * 0.025);
    box(-0.48, 0.48, low - 0.3, s1, deep, h > 9 ? ashlar : plain, 'buttress');
    box(-0.54, 0.54, s1, s1 + 0.22, deep + 0.08, long, 'weathering');
    box(-0.44, 0.44, s1 + 0.22, s2, deep * 0.72, h > 9 ? ashlar : plain, 'buttress');
    box(-0.5, 0.5, s2, s2 + 0.2, deep * 0.72 + 0.08, long, 'weathering');
    box(-0.4, 0.4, s2 + 0.2, top, deep * 0.48, h > 9 ? ashlar : plain, 'buttress');
    const px = alongX ? at : r.at + ox * deep * 0.24, pz = alongX ? r.at + oz * deep * 0.24 : at;
    if (!flyer) { pinnacle(px, top, pz, 0.32, Math.min(4.5, 2 + h * 0.08)); return; }
    // The flyer: from a pier carried up over the aisle's roof, a half arch over to the clerestory where the vault's thrust comes.
    const hit = naveWallTop - 1.2, span = Math.abs((r.side === 'w' || r.side === 'n' ? nave.x0 - T : nave.x1 + T) - r.at);
    const pierTop = Math.max(top + 4, hit - span * 0.62);
    const pier0 = alongX ? V(at - 0.4, top, r.at + oz * 0.05) : V(r.at + ox * 0.05, top, at - 0.4), pier1 = alongX ? V(at + 0.4, pierTop, r.at + oz * deep * 0.48) : V(r.at + ox * deep * 0.48, pierTop, at + 0.4);
    kit.box('stone', V(Math.min(pier0.x, pier1.x), top, Math.min(pier0.z, pier1.z)), V(Math.max(pier0.x, pier1.x), pierTop, Math.max(pier0.z, pier1.z)), ashlar, coping, 'pier');
    pinnacle(px, pierTop, pz, 0.34, 4.2);
    if (hit < pierTop + 0.8) return;
    // (In the plane square to the wall through the buttress: `s` from the pier towards the nave, `t` across the flyer's breadth.)
    const towards = -1, wallAt = r.side === 'w' || r.side === 'n' ? nave.x0 - T : nave.x1 + T;
    const startAt = alongX ? r.at : r.at, run = Math.abs((alongX ? (oz < 0 ? nave.z0 - T : nave.z1 + T) : wallAt) - startAt);
    const dirX = alongX ? 0 : -ox, dirZ = alongX ? -oz : 0;
    const face: Face = { L: run, P: (s, y, t) => V((alongX ? at : startAt) + dirX * s + (alongX ? t : 0), y, (alongX ? startAt : at) + dirZ * s + (alongX ? 0 : t)) };
    void towards;
    const pts: Pt[] = [];
    const ya = pierTop - 2.2, yb = hit - 0.7;
    for (let i = 0; i <= 10; i++) { const tt = i / 10, a = (Math.PI / 2) * tt; pts.push([run * (1 - Math.cos(a)), ya + (yb - ya) * Math.sin(a)]); }
    pts.push([run, hit + 0.55], [0, pierTop - 0.25]);
    k.prism(face, pts, [], -0.32, 0.32, 'stone', STONE);
    // (Its coping, a ridge of stone along the top.)
    k.stick(face.P(0, pierTop - 0.18, 0), face.P(run, hit + 0.62, 0), 0.16, 0.74, PALE, 'stone');
  };
  const flyers = c.flyers;
  for (const r of runs) {
    if (r.y0 > low + 0.01) continue;
    const owner = ownerOf(r, (r.from + r.to) / 2);
    if (!isChurch(owner) || part.get(owner!.id) === 'narthex') continue;
    const kind = part.get(owner!.id)!, top = column.get(owner!.id)! - 0.6;
    kit.group = 'roofs';
    // Between its windows; and at its ends where they are outer corners.
    const ws = windowsOn(r).filter(({ q }) => q.id === owner!.id && !(cx.outerWindows.get(q.id) as CathedralWindow[] | undefined)?.some(() => false)).map(({ w }) => w.at).sort((a, b) => a - b);
    const spots: number[] = [];
    for (let i = 1; i < ws.length; i++) spots.push((ws[i - 1] + ws[i]) / 2);
    const [ox, oz] = outward[r.side];
    for (const [end, dir] of [[r.from, 1], [r.to, -1]] as [number, number][]) {
      const px = r.side === 'n' || r.side === 's' ? end - dir * 0.2 : r.at + ox * 0.3, pz = r.side === 'n' || r.side === 's' ? r.at + oz * 0.3 : end - dir * 0.2;
      if (!ground.some((q) => { const g = grown(q, T); return px > g.x0 && px < g.x1 && pz > g.z0 && pz < g.z1; })) spots.push(end + dir * 0.55);
    }
    for (const at of spots) {
      if (at < r.from + 0.4 || at > r.to - 0.4 || doorsOn(r).some((w) => Math.abs(w.at - at) < w.halfWidth + 1)) continue;
      // (On a wall with doors into the cloister, not in front of them.)
      if (site.ways.some((w) => w.kind === 'door' && (w.a === owner!.id || w.b === owner!.id) && Math.abs(w.at - at) < w.halfWidth + 0.9 && Math.abs(lineOf(owner!, w.a === owner!.id ? w.side : OPPOSITE[w.side]) - r.at) < 0.05)) continue;
      const aisle = kind === 'aisle' || kind === 'choir aisle';
      const longSide = (r.side === 'e' || r.side === 'w') && aisle && !spots.slice(-2).includes(at);
      buttress(r, at, top, flyers && longSide);
    }
  }

  // ---- parapets along the eaves, and the roofs
  for (const rf of roofs) {
    kit.group = 'roofs';
    const [cover, colour] = rf.cover, inset = rf.parapet ? 0.45 : -0.35;
    if (rf.parapet) {
      const owner = places[rf.owner];
      // (Along the sides its eaves run down; a lean-to has one, on its low side.)
      const sides: Side[] = rf.kind === 'lean' ? [OPPOSITE[rf.high!]] : rf.alongX ? ['n', 's'] : ['w', 'e'];
      for (const side of sides) {
        const along = side === 'n' || side === 's', at = side === 'n' ? rf.z0 : side === 's' ? rf.z1 : side === 'w' ? rf.x0 : rf.x1, a = along ? rf.x0 : rf.z0, b = along ? rf.x1 : rf.z1;
        const t0 = side === 'n' || side === 'w' ? at : at - 0.45, t1 = side === 'n' || side === 'w' ? at + 0.45 : at;
        const lo = along ? V(a, rf.eaves, t0) : V(t0, rf.eaves, a), hi = along ? V(b, rf.eaves + 1.0, t1) : V(t1, rf.eaves + 1.0, b);
        kit.box('stone', lo, hi, ashlar, long, 'parapet');
        const clo = along ? V(a, rf.eaves + 1.0, t0 - 0.06) : V(t0 - 0.06, rf.eaves + 1.0, a), chi = along ? V(b, rf.eaves + 1.16, t1 + 0.06) : V(t1 + 0.06, rf.eaves + 1.16, b);
        kit.box('stone', clo, chi, long, long, 'parapetcope');
        void owner;
      }
    }
    const m = kit.mesh(cover);
    const roofFace = (pts: Vector3[], inward: Vector3) => {
      const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
      const mid = pts.reduce((s, q) => s.add(q), new Vector3()).multiplyScalar(1 / pts.length);
      let list = pts;
      if (n.dot(mid.sub(inward)) < 0) { n.negate(); list = [...pts].reverse(); }
      const sideways = Math.abs(n.x) > Math.abs(n.z);
      const ids = list.map((q) => m.addVertex(q.x, q.y, q.z, n.x, n.y, n.z, (sideways ? q.z : q.x) * 0.62, (q.y + (sideways ? q.x : q.z) * n.y) * 0.62, colour[0], colour[1], colour[2]));
      for (let i = 1; i < ids.length - 1; i++) m.addTriangle(ids[0], ids[i], ids[i + 1]);
    };
    const seams = (a: Vector3, b: Vector3, ridgeA: Vector3, ridgeB: Vector3) => {
      // Standing seams up a metal roof, every two thirds of a metre, from its eaves to its ridge.
      if (cover === 'tile') return;
      const len = a.distanceTo(b), n = Math.floor(len / 0.66);
      for (let i = 1; i < n; i++) {
        const t = i / n, p = a.clone().lerp(b, t), q = ridgeA.clone().lerp(ridgeB, t);
        const d = q.clone().sub(p), across = b.clone().sub(a).normalize().multiplyScalar(0.025), up = new Vector3().crossVectors(across, d).normalize().multiplyScalar(-0.05);
        if (up.y < 0) up.negate();
        any.solid(cover, [[p.x - across.x, p.y, p.z - across.z], [p.x + across.x, p.y, p.z + across.z], [q.x + across.x, q.y, q.z + across.z], [q.x - across.x, q.y, q.z - across.z],
          [p.x - across.x + up.x, p.y + up.y, p.z - across.z + up.z], [p.x + across.x + up.x, p.y + up.y, p.z + across.z + up.z], [q.x + across.x + up.x, q.y + up.y, q.z + across.z + up.z], [q.x - across.x + up.x, q.y + up.y, q.z - across.z + up.z]], shade(colour, 0.9));
      }
    };
    const y = rf.eaves + (rf.parapet ? 0.15 : 0);
    if (rf.kind === 'lean') {
      const hiX = rf.high === 'e' ? rf.x1 : rf.high === 'w' ? rf.x0 : NaN, run = Math.abs(rf.x1 - rf.x0) - inset, rise = run * rf.pitch;
      const lowX = rf.high === 'e' ? rf.x0 + inset : rf.x1 - inset;
      const a = V(lowX, y, rf.z0), b = V(lowX, y, rf.z1), cc = V(hiX, y + rise, rf.z1), d = V(hiX, y + rise, rf.z0);
      roofFace([a, b, cc, d], V((rf.x0 + rf.x1) / 2, y - 3, (rf.z0 + rf.z1) / 2));
      seams(a, b, d, cc);
      // Its ends walled up where they are seen: a half gable, coped.
      for (const [i, z] of [[0, rf.z0], [1, rf.z1]] as [number, number][]) {
        if (!rf.gables[i]) continue;
        const f = kit.frame(i ? rf.x0 : rf.x1, z, i ? rf.x1 : rf.x0, z), x0 = Math.min(lowX, hiX), x1 = Math.max(lowX, hiX);
        const fr = i ? kit.frame(rf.x0, z, rf.x1, z) : kit.frame(rf.x1, z, rf.x0, z);
        void f;
        const hAt = (u: number) => { const x = fr.a.x + fr.dir.x * u; return y + Math.max(0, (rf.high === 'e' ? x - lowX : lowX - x)) * rf.pitch + 0.35; };
        kit.wallFace('stone', fr, rf.eaves - 0.1, y + rise + 0.4, plain, { keep: (u, yy) => yy < hAt(u) });
        k.stick(V(lowX, y + 0.3, z), V(hiX, y + rise + 0.3, z), 0.32, 0.62, PALE, 'stone');
        void x0; void x1;
      }
      continue;
    }
    if (rf.kind === 'hip') {
      const x0 = rf.x0 + inset, x1 = rf.x1 - inset, z0 = rf.z0 + inset, z1 = rf.z1 - inset, half = Math.min(x1 - x0, z1 - z0) / 2, rise = half * rf.pitch;
      const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
      const r0 = rf.alongX ? V(x0 + half, y + rise, czm) : V(cxm, y + rise, z0 + half), r1 = rf.alongX ? V(x1 - half, y + rise, czm) : V(cxm, y + rise, z1 - half);
      const a = V(x0, y, z0), b = V(x1, y, z0), cc = V(x1, y, z1), d = V(x0, y, z1), inw = V(cxm, y, czm);
      if (rf.alongX) { roofFace([a, b, r1, r0], inw); roofFace([cc, d, r0, r1], inw); roofFace([b, cc, r1], inw); roofFace([d, a, r0], inw); }
      else { roofFace([b, cc, r1, r0], inw); roofFace([d, a, r0, r1], inw); roofFace([a, b, r0], inw); roofFace([cc, d, r1], inw); }
      if (places[rf.owner].name === 'chapter house') { k.block('metal', V(r0.x - 0.08, r0.y, r0.z - 0.08), V(r0.x + 0.08, r0.y + 1.2, r0.z + 0.08), GOLD); }
      continue;
    }
    // A ridged roof, its ends walled in gables of stone where they are seen, coped, with a cross on each.
    const x0 = rf.alongX ? rf.x0 : rf.x0 + inset, x1 = rf.alongX ? rf.x1 : rf.x1 - inset, z0 = rf.alongX ? rf.z0 + inset : rf.z0, z1 = rf.alongX ? rf.z1 - inset : rf.z1;
    const half = rf.alongX ? (z1 - z0) / 2 : (x1 - x0) / 2, rise = half * rf.pitch, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    const r0 = rf.alongX ? V(x0, y + rise, czm) : V(cxm, y + rise, z0), r1 = rf.alongX ? V(x1, y + rise, czm) : V(cxm, y + rise, z1);
    const a = V(x0, y, z0), b = V(x1, y, z0), cc = V(x1, y, z1), d = V(x0, y, z1), inw = V(cxm, y - 2, czm);
    if (rf.alongX) { roofFace([a, b, r1, r0], inw); roofFace([cc, d, r0, r1], inw); seams(a, b, r0, r1); seams(d, cc, r0, r1); }
    else { roofFace([b, cc, r1, r0], inw); roofFace([d, a, r0, r1], inw); seams(a, d, r0, r1); seams(b, cc, r0, r1); }
    k.block(cover, rf.alongX ? V(x0, y + rise - 0.05, czm - 0.14) : V(cxm - 0.14, y + rise - 0.05, z0), rf.alongX ? V(x1, y + rise + 0.12, czm + 0.14) : V(cxm + 0.14, y + rise + 0.12, z1), shade(colour, 0.85));
    for (const i of [0, 1]) {
      if (!rf.gables[i]) continue;
      const at = rf.alongX ? (i ? rf.x1 : rf.x0) : (i ? rf.z1 : rf.z0), side: Side = rf.alongX ? (i ? 'e' : 'w') : (i ? 's' : 'n');
      const lo = rf.alongX ? rf.z0 : rf.x0, hi = rf.alongX ? rf.z1 : rf.x1, fr = frameFor({ side, at }, lo, hi), mid = (lo + hi) / 2;
      const hAt = (u: number) => y + Math.max(0, half - Math.abs(alongRun({ side }, lo, hi, lo) + 0 - 0 + (u - (hi - lo) / 2)) - 0) * rf.pitch + 0.4;
      // (A small round window in it, high up, where the gable is large enough to hold one.)
      const oc: Opening[] = rise > 7 ? [{ c: (hi - lo) / 2, w: Math.min(1.4, rise * 0.12), y0: y + rise * 0.42 - Math.min(1.4, rise * 0.12), ys: y + rise * 0.42, circle: true }] : [];
      kit.group = 'roofs';
      kit.wallFace('stone', fr, rf.eaves - 0.1, y + rise + 0.5, rise > 6 ? ashlar : plain, { keep: (u, yy) => yy < hAt(u), openings: oc });
      const face = faceOf(fr);
      for (const o of oc) { kit.openingTrim('stone', fr, o, 0.6, dressed, 'front'); k.prism(face, outline(o), [], 0.35, 0.4, 'glass', PANE); rose(face, o, 0.25); }
      // Its coping, up both slopes; kneelers at its feet; a cross at its head.
      const [ox, oz] = outward[side], out = 0.08;
      const foot0 = rf.alongX ? V(at + ox * out, y + 0.2, lo) : V(lo, y + 0.2, at + oz * out), foot1 = rf.alongX ? V(at + ox * out, y + 0.2, hi) : V(hi, y + 0.2, at + oz * out);
      const apex = rf.alongX ? V(at + ox * out, y + rise + 0.45, mid) : V(mid, y + rise + 0.45, at + oz * out);
      k.stick(foot0, apex, 0.42, 0.95, PALE, 'stone');
      k.stick(foot1, apex, 0.42, 0.95, PALE, 'stone');
      for (const ft of [foot0, foot1]) k.block('stone', V(ft.x - 0.5, ft.y - 0.3, ft.z - 0.5), V(ft.x + 0.5, ft.y + 0.5, ft.z + 0.5), STONE);
      cross(apex.x, apex.y + 0.1, apex.z, Math.min(2.4, 0.8 + rise * 0.08), rf.alongX);
      // (Pinnacles at the gable's shoulders on the great ends.)
      if (rise > 6) for (const ft of [foot0, foot1]) pinnacle(ft.x, ft.y + 0.5, ft.z, 0.4, 5);
    }
  }

  /** A cross of stone, its arms across `alongX` or not. */
  function cross(x: number, y: number, z: number, h: number, alongX: boolean) {
    const w = h * 0.08;
    k.block('stone', V(x - w, y, z - w), V(x + w, y + h, z + w), PALE);
    const arm = h * 0.32;
    if (alongX) k.block('stone', V(x - w, y + h * 0.62, z - arm), V(x + w, y + h * 0.62 + 2 * w, z + arm), PALE);
    else k.block('stone', V(x - arm, y + h * 0.62, z - w), V(x + arm, y + h * 0.62 + 2 * w, z + w), PALE);
  }

  // ---- the towers: stages marked by string courses, buttresses clasping their corners, a parapet over the belfry with a pinnacle at
  // each corner, and what crowns them
  const spire = (x: number, y: number, z: number, base: number, height: number, kind: SpireKind) => {
    if (kind === 'none' || height < 2) return;
    const material = kind === 'stone' ? 'stone' : kind === 'copper' ? 'copper' : 'metal', colour = kind === 'stone' ? PALE : kind === 'copper' ? COPPER : LEAD;
    const r = base / 2 / Math.cos(Math.PI / 8);
    // A low drum to stand on, then the spire's eight faces.
    k.shaft(V(x, y, z), r, 0.9, 8, Math.PI / 8, kind === 'stone' ? 'stone' : material, kind === 'stone' ? STONE : shade(colour, 0.9));
    k.pyramid(V(x, y + 0.9, z), r * 0.97, height - 0.9, 8, Math.PI / 8, material, colour);
    // Lucarnes at its foot, a small gable on each of four faces; on stone, crockets up its edges and bands round it.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2, cxl = x + Math.cos(a) * r * 0.78, czl = z + Math.sin(a) * r * 0.78, lh = Math.min(3.2, height * 0.08), lw = Math.min(0.9, r * 0.32);
      const alongX = Math.abs(Math.cos(a)) < 0.5;
      k.block(material, alongX ? V(cxl - lw, y + 0.9, czl - 0.6) : V(cxl - 0.6, y + 0.9, czl - lw), alongX ? V(cxl + lw, y + 0.9 + lh, czl + 0.6) : V(cxl + 0.6, y + 0.9 + lh, czl + lw), kind === 'stone' ? STONE : shade(colour, 0.95));
      k.pyramid(V(cxl, y + 0.9 + lh, czl), lw * 1.35, lh * 0.8, 4, Math.PI / 4, material, colour);
      const slit = alongX ? V(cxl - lw * 0.35, y + 1.2, czl + Math.sign(Math.sin(a)) * 0.6) : V(cxl + Math.sign(Math.cos(a)) * 0.6, y + 1.2, czl - lw * 0.35);
      k.block('wood', slit, alongX ? V(cxl + lw * 0.35, y + 0.9 + lh * 0.75, czl + Math.sign(Math.sin(a)) * 0.62) : V(cxl + Math.sign(Math.cos(a)) * 0.62, y + 0.9 + lh * 0.75, czl + lw * 0.35), [0.015, 0.014, 0.012]);
    }
    if (kind === 'stone') {
      for (let t = 0.1; t < 0.95; t += 2.2 / height) for (let q = 0; q < 8; q++) {
        const a = Math.PI / 8 + (q * Math.PI) / 4, rr = r * 0.97 * (1 - t) + 0.1, yy = y + 0.9 + (height - 0.9) * t;
        k.block('stone', V(x + Math.cos(a) * rr - 0.11, yy - 0.09, z + Math.sin(a) * rr - 0.11), V(x + Math.cos(a) * rr + 0.11, yy + 0.09, z + Math.sin(a) * rr + 0.11), PALE);
      }
      for (const t of [0.28, 0.55]) k.shaft(V(x, y + 0.9 + (height - 0.9) * t, z), r * 0.97 * (1 - t) + 0.08, 0.22, 8, Math.PI / 8, 'stone', STONE);
    }
    // Its point: a finial and a cross, or on metal a gilt ball under the cross.
    const tip = y + height;
    if (kind === 'stone') k.pyramid(V(x, tip - 0.4, z), 0.32, 1.2, 4, Math.PI / 4, 'stone', PALE);
    else k.shaft(V(x, tip - 0.15, z), 0.3, 0.5, 8, 0, 'metal', GOLD);
    k.block('metal', V(x - 0.05, tip, z - 0.05), V(x + 0.05, tip + 2.2, z + 0.05), kind === 'stone' ? IRON : GOLD);
    k.block('metal', V(x - 0.55, tip + 1.45, z - 0.05), V(x + 0.55, tip + 1.55, z + 0.05), kind === 'stone' ? IRON : GOLD);
  };
  for (const st of sv.stacks) {
    const g = grown(st.foot, T), parapet = st.top.floor + st.top.wall, belfry = st.rooms[1];
    kit.group = 'roofs';
    // String courses on each face where it is seen, at the belfry's floor and a third and two thirds of the way up to it.
    for (const r of runs) {
      if (ownerOf(r, (r.from + r.to) / 2)?.id !== st.foot.id) continue;
      const alongX = r.side === 'n' || r.side === 's', [ox, oz] = outward[r.side];
      for (const y of [belfry.floor - 0.4, F + (belfry.floor - F) / 3, F + ((belfry.floor - F) * 2) / 3, parapet - 1.6]) {
        if (y < r.y0 + 0.5 || y > r.y1 - 0.3) continue;
        const p0 = alongX ? V(r.from, y, r.at) : V(r.at, y, r.from), p1 = alongX ? V(r.to, y + 0.32, r.at + oz * 0.24) : V(r.at + ox * 0.24, y + 0.32, r.to);
        kit.box('stone', V(Math.min(p0.x, p1.x), y, Math.min(p0.z, p1.z)), V(Math.max(p0.x, p1.x), y + 0.32, Math.max(p0.z, p1.z)), long, long, 'string');
      }
    }
    // Blind lancets up each face it shows, a pair or three to each stage between its string courses, wherever no window is: a pointed
    // panel of darker stone sunk in a moulding, mullioned, so that the tower is not a bare shaft from the roofs to the bells.
    {
      const marks = [low + 1.5, F + (belfry.floor - F) / 3, F + ((belfry.floor - F) * 2) / 3, belfry.floor - 0.4].sort((a, b) => a - b);
      for (const r of runs) {
        if (ownerOf(r, (r.from + r.to) / 2)?.id !== st.foot.id) continue;
        const f = frameFor(r, r.from, r.to), face = faceOf(f), L = r.to - r.from, n = L > 9 ? 3 : 2, w = Math.min(1.1, L / (n * 2) - 0.55);
        const windows = windowsOn(r).map(({ w: x }) => ({ c: alongRun(r, r.from, r.to, x.at), w: x.halfWidth, y0: opening(x).y0, y1: opening(x).ys + archRise(x.halfWidth, 2) }));
        for (let stage = 0; stage < marks.length - 1; stage++) {
          const y0 = Math.max(marks[stage], r.y0) + 1.2, y1 = Math.min(marks[stage + 1], r.y1) - 0.9;
          if (y1 - y0 < 4 || w < 0.4) continue;
          for (let i = 0; i < n; i++) {
            const c = L / 2 + (i - (n - 1) / 2) * (2 * w + 0.9), ys = y1 - archRise(w, 2);
            if (windows.some((x) => Math.abs(x.c - c) < x.w + w + 0.4 && x.y0 < y1 + 0.5 && x.y1 > y0 - 0.5)) continue;
            const op: Opening = { c, w, y0, ys, point: 2 };
            k.prism(face, outline(op), [], -0.05, 0.02, 'stone', shade(STONE, 0.72));
            const ring = outline({ ...op, w: w + 0.12, y0: y0 - 0.12 });
            for (let q = 0; q < ring.length; q++) { const a = ring[q], b = ring[(q + 1) % ring.length]; k.stick(face.P(a[0], a[1], -0.1), face.P(b[0], b[1], -0.1), 0.16, 0.14, PALE, 'stone'); }
            k.on(face, 'stone', c - 0.06, c + 0.06, y0, ys + 0.02, -0.14, -0.04, PALE);
            for (const o of [-1, 1]) { const line = outline({ c: c + (o * w) / 2, w: w / 2, y0: ys, ys, point: 2 }, 4).slice(2, -1); for (let q = 0; q < line.length - 1; q++) k.stick(face.P(line[q][0], line[q][1], -0.09), face.P(line[q + 1][0], line[q + 1][1], -0.09), 0.1, 0.1, PALE, 'stone'); }
          }
        }
      }
    }
    // Buttresses at its corners, set square to each face, stepping back as they rise, to under the parapet.
    for (const [cxr, czr, sx, sz] of [[g.x0, g.z0, -1, -1], [g.x1, g.z0, 1, -1], [g.x0, g.z1, -1, 1], [g.x1, g.z1, 1, 1]] as [number, number, number, number][]) {
      // (Only where the corner is seen: not where it stands in the church beside it.)
      const seen = !ground.some((q) => q.id !== st.foot.id && column.get(q.id)! > low + 4 && cxr + sx * 0.5 > q.x0 - T && cxr + sx * 0.5 < q.x1 + T && czr + sz * 0.5 > q.z0 - T && czr + sz * 0.5 < q.z1 + T);
      const from = seen ? low - 0.3 : Math.max(...ground.filter((q) => q.id !== st.foot.id && cxr + sx * 0.5 > q.x0 - T && cxr + sx * 0.5 < q.x1 + T && czr + sz * 0.5 > q.z0 - T && czr + sz * 0.5 < q.z1 + T).map((q) => column.get(q.id)! + 2), low);
      const stages = 4, h = parapet - 1.2 - from;
      for (let i = 0; i < stages; i++) {
        const y0 = from + (h * i) / stages, y1 = from + (h * (i + 1)) / stages, d = 2.1 - i * 0.38, wdt = 0.7;
        kit.box('stone', V(sx < 0 ? cxr - d : cxr - wdt, y0, czr - wdt), V(sx < 0 ? cxr + wdt : cxr + d, y1, czr + wdt), ashlar, long, 'towerbuttress');
        kit.box('stone', V(cxr - wdt, y0, sz < 0 ? czr - d : czr - wdt), V(cxr + wdt, y1, sz < 0 ? czr + wdt : czr + d), ashlar, long, 'towerbuttress');
      }
      // A pinnacle over the corner, rising well over the parapet.
      pinnacle(cxr, parapet - 0.2, czr, 0.6, Math.min(9, 3 + st.tower.spireHeight * 0.12 + (parapet - F) * 0.04));
    }
    // The parapet's coping, and the top's floor of lead round the spire.
    for (const [a, b] of [[V(g.x0 - 0.1, parapet, g.z0 - 0.1), V(g.x1 + 0.1, parapet + 0.2, g.z0 + T + 0.1)], [V(g.x0 - 0.1, parapet, g.z1 - T - 0.1), V(g.x1 + 0.1, parapet + 0.2, g.z1 + 0.1)], [V(g.x0 - 0.1, parapet, g.z0), V(g.x0 + T + 0.1, parapet + 0.2, g.z1)], [V(g.x1 - T - 0.1, parapet, g.z0), V(g.x1 + 0.1, parapet + 0.2, g.z1)]] as [Vector3, Vector3][]) kit.box('stone', a, b, coping, coping, 'parapetcope');
    const base = Math.min(st.foot.x1 - st.foot.x0, st.foot.z1 - st.foot.z0) - 2.7;
    spire((st.foot.x0 + st.foot.x1) / 2, st.top.floor, (st.foot.z0 + st.foot.z1) / 2, base, st.tower.spireHeight, st.tower.spire);
    // Bells, hung in a frame of oak in the belfry, clear of its stair.
    {
      const up = site.ways.find((w) => w.kind === 'stair' && w.a === belfry.id), bx = (belfry.x0 + belfry.x1) / 2, bz = (belfry.z0 + belfry.z1) / 2;
      const shift = up ? (up.side === 'n' ? 0.7 : up.side === 's' ? -0.7 : 0) : 0, shiftX = up ? (up.side === 'w' ? 0.7 : up.side === 'e' ? -0.7 : 0) : 0;
      const y = belfry.floor, h = Math.min(belfry.wall - 0.4, 3.6), along = (belfry.x1 - belfry.x0) >= (belfry.z1 - belfry.z0);
      kit.group = `p${belfry.id}`;
      for (const o of [-1, 1]) {
        const px = bx + shiftX + (along ? o * 1.5 : 0), pz = bz + shift + (along ? 0 : o * 1.5);
        k.block('wood', V(px - 0.14, y, pz - 0.14), V(px + 0.14, y + h, pz + 0.14), OAK, true);
      }
      k.block('wood', along ? V(bx + shiftX - 1.7, y + h - 0.3, bz + shift - 0.15) : V(bx + shiftX - 0.15, y + h - 0.3, bz + shift - 1.7), along ? V(bx + shiftX + 1.7, y + h, bz + shift + 0.15) : V(bx + shiftX + 0.15, y + h, bz + shift + 1.7), OAK, true);
      for (const o of [-0.75, 0.75]) {
        const px = bx + shiftX + (along ? o : 0), pz = bz + shift + (along ? 0 : o), size = 0.55 + rng.next() * 0.15;
        // A bell: a lip, a waist and a crown, of bronze.
        k.shaft(V(px, y + h - 0.3 - size * 1.5, pz), size, size * 0.25, 12, 0, 'metal', [0.42, 0.3, 0.14]);
        k.pyramid(V(px, y + h - 0.3 - size * 1.25, pz), size * 0.98, size * 1.6, 12, 0, 'metal', [0.42, 0.3, 0.14]);
        k.shaft(V(px, y + h - 0.3 - size * 0.25, pz), size * 0.42, size * 0.25, 12, 0, 'metal', [0.38, 0.27, 0.12]);
      }
    }
  }

  // ---- over the crossing: a tower that is not climbed, its bell openings louvred, its corners buttressed, a parapet and pinnacles,
  // and its spire if it has one; or a slender spire on the ridge
  const crossing = sv.crossing, ridge = column.get(nave.id)! + ((nave.x1 - nave.x0) / 2 + T - 0.45) * c.pitch + 0.15;
  if (c.lantern) {
    const g = grown(crossing, T), y0 = column.get(crossing.id)! - 0.3, top = crossing.floor + c.lantern.top;
    kit.group = 'roofs';
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const along = side === 'n' || side === 's', at = side === 'n' ? g.z0 : side === 's' ? g.z1 : side === 'w' ? g.x0 : g.x1, lo = along ? g.x0 : g.z0, hi = along ? g.x1 : g.z1;
      const f = frameFor({ side, at }, lo, hi), L = hi - lo, ow = Math.min(0.9, L / 8), oy0 = Math.max(ridge + 1.2, top - 11), ys = top - 1.6 - archRise(ow, 2);
      const ops: Opening[] = ys - oy0 > 2 ? [-1, 1].flatMap((o) => [L / 2 + o * (ow + 0.4), L / 2 + o * (3 * ow + 1.4)]).map((cc) => ({ c: cc, w: ow, y0: oy0, ys, point: 2 })) : [];
      kit.wallFace('stone', f, y0, top, ashlar, { openings: ops });
      const face = faceOf(f);
      for (const op of ops) { kit.openingTrim('stone', f, op, 0.9, dressed, 'front'); louvres(face, op, 0.3); }
      kit.box('stone', along ? V(lo - 0.1, top - 0.45, at - 0.25) : V(at - 0.25, top - 0.45, lo - 0.1), along ? V(hi + 0.1, top, at + 0.25) : V(at + 0.25, top, hi + 0.1), coping, coping, 'cornice');
      kit.box('stone', along ? V(lo, top, Math.min(at, at + (side === 'n' ? 0.45 : -0.45))) : V(Math.min(at, at + (side === 'w' ? 0.45 : -0.45)), top, lo), along ? V(hi, top + 1.1, Math.max(at, at + (side === 'n' ? 0.45 : -0.45))) : V(Math.max(at, at + (side === 'w' ? 0.45 : -0.45)), top + 1.1, hi), plain, coping, 'parapet');
    }
    kit.box('stone', V(g.x0 + 0.3, top - 0.6, g.z0 + 0.3), V(g.x1 - 0.3, top - 0.3, g.z1 - 0.3), coping, coping, 'leads');
    for (const [x, z] of [[g.x0, g.z0], [g.x1, g.z0], [g.x0, g.z1], [g.x1, g.z1]]) {
      kit.box('stone', V(x - 0.7, y0, z - 0.7), V(x + 0.7, top + 0.3, z + 0.7), ashlar, coping, 'lanternbuttress');
      pinnacle(x, top + 0.3, z, 0.55, 6);
    }
    spire((g.x0 + g.x1) / 2, top - 0.3, (g.z0 + g.z1) / 2, Math.min(g.x1 - g.x0, g.z1 - g.z0) - 3.2, c.lantern.spireHeight, c.lantern.spire);
  } else if (c.fleche) {
    // The flèche: an eight-sided drum on the ridge over the crossing, open in arches, and a needle of the roofs' metal over it.
    const x = (crossing.x0 + crossing.x1) / 2, z = (crossing.z0 + crossing.z1) / 2, r = 1.2, kind: SpireKind = c.roof === 'copper' ? 'copper' : 'lead';
    kit.group = 'roofs';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.block('wood', V(x + Math.cos(a) * r - 0.1, ridge - 1.5, z + Math.sin(a) * r - 0.1), V(x + Math.cos(a) * r + 0.1, ridge + 3.2, z + Math.sin(a) * r + 0.1), kind === 'copper' ? COPPER : LEAD);
    }
    k.shaft(V(x, ridge - 1.5, z), r * 0.75, 4.7, 8, 0, 'wood', [0.02, 0.02, 0.02]);
    k.shaft(V(x, ridge + 3.2, z), r + 0.15, 0.3, 8, Math.PI / 8, kind === 'copper' ? 'copper' : 'metal', kind === 'copper' ? COPPER : LEAD);
    k.pyramid(V(x, ridge + 3.5, z), r + 0.1, c.fleche - 3.5, 8, Math.PI / 8, kind === 'copper' ? 'copper' : 'metal', kind === 'copper' ? COPPER : LEAD);
    k.block('metal', V(x - 0.04, ridge + c.fleche, z - 0.04), V(x + 0.04, ridge + c.fleche + 1.8, z + 0.04), GOLD);
    k.block('metal', V(x - 0.4, ridge + c.fleche + 1.2, z - 0.04), V(x + 0.4, ridge + c.fleche + 1.28, z + 0.04), GOLD);
  }

  // ---- the west portal: orders of stone stepping in to the doors, the tympanum over them, a gable over the whole with a finial;
  // blind portals on the towers' fronts beside it; and over the middle a gallery of figures under canopies
  const door = site.ways.find((w) => w.kind === 'door' && (w.a === yard.id || w.b === yard.id))!, inner = places[door.a === yard.id ? door.b : door.a];
  const zf = inner.z1 + T, dop = cx.shape(door);
  const portal = (xc: number, wDoor: number, ys: number, blind: boolean, scale: number) => {
    const D = 1.5 * scale, orders = 4, w0 = wDoor + 0.3 + orders * 0.3 * scale, spring = ys + 0.25, head = spring + archRise(w0, 2), Wp = w0 + 0.75 * scale, gTop = head + w0 * 1.15;
    const f: Face = { L: 1, P: (s, y, t) => V(s, y, zf + D - t) };
    const op = (w: number): Opening => ({ c: xc, w, y0: low + 0.2, ys: spring, point: 2 });
    kit.group = `p${inner.id}`;
    // The block it is cut in, standing forward of the front.
    k.prism(f, [[xc - Wp, low], [xc + Wp, low], [xc + Wp, head + 0.4], [xc - Wp, head + 0.4]], [outline(op(w0)).map(([s, y]): Pt => [s, Math.max(y, low + 0.2)])], 0, D, 'stone', STONE);
    // (Its foot is the block's foot: the opening comes down to the ground, as the doorway does.)
    for (let i = 0; i < orders; i++) {
      const wo = w0 - i * 0.3 * scale, wi = wo - 0.3 * scale, t0 = ((i + 1) * D) / (orders + 1);
      k.prism(f, outline(op(wo)), [outline(op(wi)).map(([s, y]): Pt => [s, y + 0.01])], t0, D, 'stone', i % 2 ? STONE : PALE);
      // (Each order's jambs a shaft of darker stone, with a capital at the springing.)
      for (const o of [-1, 1]) k.on(f, 'stone', xc + o * (wo - 0.12) - 0.1, xc + o * (wo - 0.12) + 0.1, low + 0.6, spring - 0.25, t0 - 0.1, t0 + 0.1, shade(STONE, 0.7));
      for (const o of [-1, 1]) k.on(f, 'stone', xc + o * (wo - 0.12) - 0.18, xc + o * (wo - 0.12) + 0.18, spring - 0.25, spring, t0 - 0.16, t0 + 0.14, PALE);
    }
    const wIn = w0 - orders * 0.3 * scale;
    // The tympanum: the stone between the innermost order's point and the doors' round head; on a blind portal, all of it.
    if (blind) k.prism(f, outline(op(wIn)), [], D - 0.18, D, 'stone', shade(STONE, 0.92));
    else {
      const outer = outline(op(wIn)).filter(([, y]) => y >= ys - 1e-6), arc: Pt[] = [];
      for (let i = 0; i <= 12; i++) { const a = (Math.PI * i) / 12; arc.push([xc - wDoor * Math.cos(a), ys + wDoor * Math.sin(a)]); }
      const ring: Pt[] = [[xc + wIn, ys], ...outer.slice(1).filter(([s]) => s !== xc + wIn || true).filter(([, y]) => y > ys + 1e-6), [xc - wIn, ys], ...arc];
      k.prism(f, ring, [], D - 0.2, D + 0.05, 'stone', shade(STONE, 0.92));
      for (const o of [-1, 1]) if (wIn > wDoor + 0.05) k.on(f, 'stone', o < 0 ? xc - wIn : xc + wDoor, o < 0 ? xc - wDoor : xc + wIn, low + 0.2, ys, D - 0.2, D + 0.05, STONE);
      // (A figure seated in it, in a mandorla: a ring, and a block of a body.)
      const ty = ys + (head - (ys + wDoor)) * 0.5 + wDoor;
      if (head - ys > wDoor + 1.4) { k.disc(f, xc, ty, Math.min(0.9, (head - ys - wDoor) * 0.4), D - 0.3, D - 0.18, 'stone', PALE, Math.min(0.9, (head - ys - wDoor) * 0.4) - 0.1); k.on(f, 'stone', xc - 0.28, xc + 0.28, ty - 0.6, ty + 0.35, D - 0.4, D - 0.18, PALE); k.disc(f, xc, ty + 0.52, 0.17, D - 0.4, D - 0.18, 'stone', PALE); }
    }
    // The gable over it: a triangle of stone to a finial, coped, crocketed.
    const gb: Pt[] = [[xc - Wp, head + 0.4], [xc + Wp, head + 0.4], [xc, gTop]];
    k.prism(f, gb, [], 0, 0.5, 'stone', STONE);
    for (const o of [-1, 1]) {
      k.stick(f.P(xc + o * (Wp + 0.1), head + 0.35, 0.25), f.P(xc, gTop + 0.15, 0.25), 0.22, 0.6, PALE, 'stone');
      for (let i = 1; i < 6; i++) { const t = i / 6, s = xc + o * (Wp + 0.1) * (1 - t), y = head + 0.4 + (gTop - head - 0.4) * t + 0.22; k.on(f, 'stone', s - 0.12, s + 0.12, y, y + 0.22, 0.1, 0.4, PALE); }
      // Pinnacles either side.
      const pp = f.P(xc + o * (Wp + 0.2), 0, 0.3);
      kit.box('stone', V(pp.x - 0.3, low, pp.z - 0.35), V(pp.x + 0.3, head + 0.4, pp.z + 0.35), plain, coping, 'portalpier');
      pinnacle(pp.x, head + 0.4, pp.z, 0.3, 3);
    }
    const fin = f.P(xc, gTop, 0.25);
    pinnacle(fin.x, fin.y, fin.z, 0.22, 1.6);
    return gTop;
  };
  const doorTop = dop.ys;
  const gTop = portal(door.at, door.halfWidth, doorTop, false, 1);
  for (const st of sv.stacks) if (st.foot.id !== inner.id && Math.abs(st.foot.z1 + T - zf) < 0.05) portal((st.foot.x0 + st.foot.x1) / 2, Math.min(0.9, (st.foot.x1 - st.foot.x0) / 2 - 2.1), doorTop - 0.4, true, 0.75);
  // The gallery of figures across the west front over the portal.
  {
    const span = inner.x1 - inner.x0, y = gTop + 0.6, n = Math.max(3, Math.floor((span + 2) / 1.35));
    kit.group = 'roofs';
    kit.box('stone', V(inner.x0 - T, y - 0.3, zf - 0.02), V(inner.x1 + T, y, zf + 0.7), coping, coping, 'gallery');
    kit.box('stone', V(inner.x0 - T, y + 2.6, zf - 0.02), V(inner.x1 + T, y + 2.85, zf + 0.6), coping, coping, 'gallerycope');
    for (let i = 0; i < n; i++) {
      const x = inner.x0 - T + ((span + 2 * T) * (i + 0.5)) / n, robe = shade(STONE, 0.95 + rng.next() * 0.1);
      k.block('stone', V(x - 0.24, y, zf + 0.14), V(x + 0.24, y + 0.18, zf + 0.6), STONE);
      any.solid('stone', [[x - 0.2, y + 0.18, zf + 0.18], [x + 0.2, y + 0.18, zf + 0.18], [x + 0.2, y + 0.18, zf + 0.56], [x - 0.2, y + 0.18, zf + 0.56], [x - 0.15, y + 1.62, zf + 0.22], [x + 0.15, y + 1.62, zf + 0.22], [x + 0.15, y + 1.62, zf + 0.5], [x - 0.15, y + 1.62, zf + 0.5]], robe);
      k.shaft(V(x, y + 1.62, zf + 0.36), 0.11, 0.26, 8, 0, 'stone', robe);
      // Its canopy, and the shafts between the figures.
      k.pyramid(V(x, y + 2.05, zf + 0.36), 0.36, 0.55, 4, Math.PI / 4, 'stone', PALE);
      k.block('stone', V(x - 0.36, y + 1.95, zf + 0.0), V(x + 0.36, y + 2.08, zf + 0.62), PALE);
      const sx = x + (span + 2 * T) / n / 2;
      if (i < n - 1) k.block('stone', V(sx - 0.07, y, zf + 0.42), V(sx + 0.07, y + 2.6, zf + 0.56), shade(STONE, 0.75));
    }
  }

  // ---- the cloister's walls where they stand free: a coping along their tops
  for (const p of ground) {
    if (p.roof !== 'sky') continue;
    const top = p.floor + p.wall;
    kit.group = `p${p.id}`;
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const line = faceLine(p, side), cover = coverOf(sv, roofs, p, side, line.lo, line.hi);
      if (cover > top + 0.3) continue;
      const a = line.lo - T, b = line.hi + T, w0 = side === 'n' || side === 'w' ? line.at - 0.12 : line.at - T, w1 = side === 'n' || side === 'w' ? line.at + T : line.at + 0.12;
      kit.box('stone', line.along ? V(a, top, w0) : V(w0, top, a), line.along ? V(b, top + 0.22, w1) : V(w1, top + 0.22, b), coping, coping, 'cope');
    }
  }
}
