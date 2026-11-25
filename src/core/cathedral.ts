import { Rng } from './rng';
import { leverSpot, solve } from './mission';
import { buildingHeight, layOutTown } from './town';
import type { CityOptions, Town } from './site';
import {
  allReachable, Cathedral, CathedralPart, neighbours, OPPOSITE, Place, POINTED_RISE, ROUND_TREAD as ROUND, roundLegs, Setting, Side, Site, SKIES,
  SpireKind, STEP_RISE, SUNWISE, vaultRise, Way, WHEN,
} from './site';

/**
 * The house of a harbour town, at the head of its square: a cathedral. Not a house of a few rooms but a great church and what
 * belongs to it, built of places as any house is, so that everything the game knows (doors, keys, stairs, maps, the bake) knows it:
 *
 * - the west front to the square: two towers with the narthex between them, or one great tower whose foot is the narthex;
 * - the nave of four to six bays between its aisles, open to them through tall arcades; the crossing, with the transepts' arms either
 *   side of it; the choir beyond, with its own aisles; and beyond that, raised a few steps, the shrine, which is the goal;
 * - beside the nave, on one side, the cloister: its garth with a walk round it, the refectory, a library by the front; off the
 *   transepts' arms the chapter house and the sacristy;
 * - the towers climbed: from the room at the foot by a flight against the wall to the tower's stair, which climbs round its walls to
 *   the belfry, and from there by a steep flight to the top, a walk behind the parapet round the spire;
 * - under the choir the crypt, a low hall of columns, reached by stairs down from the choir's aisles; beside it, under a transept, the
 *   dungeon, a passage of cells; and under the shrine a chamber no door shows.
 *
 * It is made as high as the town makes it: once the town is laid out round its ground, the tallest buildings about the square are
 * measured, and the nave's ridge is made between half as high again as they are and three times as high (`measure`). Its towers
 * stand over that, and their spires over them.
 *
 * Measures: x across the church (east as the site has it), z along it, the front at greater z facing the square, as every house's
 * front faces its forecourt; so the church's liturgical west is the site's south. Lengths in metres.
 */

const T = 1;
/** How steeply the aisles' lean-to roofs fall from the wall of the nave: rise over run. */
export const LEAN = 0.5;
/** The church's floor over the forecourt's: two steps up through the door. */
const CHURCH = 0.34;
const r1 = (v: number) => Math.round(v * 10) / 10;
/**
 * A stream of its own for a set of choices, its first few numbers passed over: the first a fresh stream gives is much alike for seeds
 * alike (`a`, `b`, …), and a choice made on it came out the same for nearly all of them.
 */
const streamOf = (rng: Rng, label: string): Rng => { const r = rng.fork(label); for (let i = 0; i < 4; i++) r.next(); return r; };
const r2 = (v: number) => Math.round(v * 100) / 100;
interface Rect { x0: number; x1: number; z0: number; z1: number }

/** The top of the masonry over a place: its vault's crown and the fill over it, or its ceiling's boards; or the top of its walls, open to the sky. */
export function toplineOf(p: Place): number {
  return p.floor + p.wall + (p.roof === 'barrel' ? vaultRise(p) + 0.7 : p.roof === 'timber' ? 0.35 : 0);
}

export function draftCathedral(seed: string, setting: Setting, rng: Rng, inWorld?: { seed: string; n: number }, townPlan?: NonNullable<Town['plan']>, city?: Partial<CityOptions>): Site {
  // ---- its measures: from a stream of their own
  const m = streamOf(rng, 'measures');
  const twin = m.chance(0.7);
  const N = r1(m.range(10, 12.6));
  const A = r1(Math.min(6.2, Math.max(4.8, N * m.range(0.42, 0.5))));
  const B = r1(m.range(5.3, 6.2));
  const nb = m.int(4, 6), cb = m.int(2, 3);
  // (A twin tower stands over the end of its aisle and a little beyond it; a single one is as broad as the nave, and as deep.)
  const Lw = twin ? r1(Math.max(A + 0.8, m.range(6.6, 7.6))) : N, Lr = twin ? r1(m.range(6.6, 7.4)) : N;
  const cloister = m.chance(0.85), cs: 1 | -1 = m.chance(0.5) ? 1 : -1, ds = (-cs) as 1 | -1;
  const C = r1(m.range(9.6, 11.4));
  const armLen = r1(cloister ? A + T + C : A + T + m.range(3.6, 7));
  const S = r1(Math.max(6.4, N * m.range(0.62, 0.76))), Sd = r1(m.range(6.5, 9));
  const pitch = r2(m.range(1.25, 1.7));
  const half = N / 2, naveLen = nb * B;

  const places: Place[] = [], ways: Way[] = [], parts: Cathedral['parts'] = [];
  const add = (q: Rect, name: string, o: Partial<Place> = {}, part?: CathedralPart): Place => {
    const dx = q.x1 - q.x0, dz = q.z1 - q.z0;
    const p: Place = {
      id: places.length, role: 'passage', name, roof: 'barrel', light: 'day', x0: r2(q.x0), x1: r2(q.x1), z0: r2(q.z0), z1: r2(q.z1),
      floor: CHURCH, wall: 4, axis: dx >= dz ? 'x' : 'z', depth: 0, ...o,
    };
    places.push(p);
    if (part) parts.push({ place: p.id, part });
    return p;
  };
  const way = (a: Place, b: Place, side: Side, kind: Way['kind'], at: number, halfWidth: number, o: Partial<Way> = {}): Way => {
    const w: Way = { a: a.id, b: b.id, side, kind, at: r2(at), halfWidth: r2(halfWidth), ...o };
    ways.push(w);
    return w;
  };
  /** A rectangle laid out on the east (`s` 1), or the same mirrored to the west. */
  const mirror = (q: Rect, s: 1 | -1): Rect => (s === 1 ? q : { ...q, x0: -q.x1, x1: -q.x0 });
  const across = (s: 1 | -1): Side => (s === 1 ? 'e' : 'w');
  const mid = (p: Place, alongX: boolean) => (alongX ? (p.x0 + p.x1) / 2 : (p.z0 + p.z1) / 2);

  // ---- the plan
  const front = { z0: -Lr, z1: 0 };
  const naveR: Rect = { x0: -half, x1: half, z0: -Lr - T - naveLen, z1: -Lr - T };
  const crossR: Rect = { x0: -half, x1: half, z0: naveR.z0 - T - N, z1: naveR.z0 - T };
  const choirR: Rect = { x0: -half, x1: half, z0: crossR.z0 - T - cb * B, z1: crossR.z0 - T };
  const shrineR: Rect = { x0: -S / 2, x1: S / 2, z0: choirR.z0 - T - Sd, z1: choirR.z0 - T };
  const aisleX = { x0: half + T, x1: half + T + A }, armX = { x0: half + T, x1: half + T + armLen }, beyondX = { x0: half + 2 * T + A, x1: half + T + armLen };

  // (Between two towers the narthex is the nave's first bay, as high, its vault running on; under one tower it is the tower's foot.)
  const narthex = add({ x0: -half, x1: half, ...front }, twin ? 'narthex' : 'tower porch', { role: 'entrance', axis: twin ? 'z' : 'x', roof: twin ? 'barrel' : 'timber', pointed: twin }, twin ? 'narthex' : 'tower');
  const fronts = ([-1, 1] as const).map((s) => twin
    ? add(mirror({ x0: half + T, x1: half + T + Lw, ...front }, s), 'tower', { roof: 'timber', light: 'torch' }, 'tower')
    : add(mirror({ ...aisleX, ...front }, s), 'chapel', { axis: 'z', pointed: true, light: 'torch', role: 'reward' }, 'chapel'));
  const nave = add(naveR, 'nave', { axis: 'z', pointed: true }, 'nave');
  const aisles = ([-1, 1] as const).map((s) => add(mirror({ ...aisleX, z0: naveR.z0, z1: naveR.z1 }, s), 'aisle', { axis: 'z', pointed: true }, 'aisle'));
  const crossing = add(crossR, 'crossing', { axis: 'z', pointed: true }, 'crossing');
  const arms = ([-1, 1] as const).map((s) => add(mirror({ ...armX, z0: crossR.z0, z1: crossR.z1 }, s), 'transept', { axis: 'x', pointed: true }, 'transept'));
  const choir = add(choirR, 'choir', { axis: 'z', pointed: true }, 'choir');
  const choirAisles = ([-1, 1] as const).map((s) => add(mirror({ ...aisleX, z0: choirR.z0, z1: choirR.z1 }, s), 'choir aisle', { axis: 'z', pointed: true }, 'choir aisle'));
  const shrine = add(shrineR, 'shrine', { role: 'goal', pointed: true, floor: r2(CHURCH + 3 * STEP_RISE), light: 'day' }, 'shrine');
  const side = (list: Place[], s: 1 | -1) => list[s === -1 ? 0 : 1];

  // The cloister, beside the aisle on its side, under the transept's arm: its garth, the refectory between it and the front, and a
  // library in the front beside the tower.
  let court: Place | null = null, range: Place | null = null, library: Place | null = null;
  if (cloister) {
    const Cz = naveLen - r1(Math.min(naveLen, C * m.range(1.0, 1.3))) < 5.5 ? naveLen : r1(Math.min(naveLen, C * m.range(1.0, 1.3)));
    court = add(mirror({ ...beyondX, z0: naveR.z0, z1: naveR.z0 + Cz }, cs), 'cloister court', { role: 'court', roof: 'sky', light: 'day', wall: 4.6 });
    if (naveLen - Cz >= 5.5) range = add(mirror({ ...beyondX, z0: court.z1 + T, z1: naveR.z1 }, cs), 'refectory', { roof: 'timber', wall: 5.6 });
    const x0 = twin ? half + 2 * T + Lw : beyondX.x0;
    if (beyondX.x1 - x0 >= 4.4) library = add(mirror({ x0, x1: beyondX.x1, ...front }, cs), 'library', { light: 'torch', wall: 3.6 });
  }
  // Off the transepts' arms, beside the choir's aisles: the chapter house on the cloister's side, the sacristy on the other.
  const north: (Place | null)[] = ([-1, 1] as const).map((s) => {
    const wide = beyondX.x1 - beyondX.x0;
    if (wide < 4.2) return null;
    const deep = Math.min(cb * B, s === cs ? r1(wide * m.range(0.9, 1.1)) : r1(m.range(5.5, 7.5)));
    return add(mirror({ ...beyondX, z0: crossR.z0 - T - deep, z1: crossR.z0 - T }, s), s === cs ? 'chapter house' : 'sacristy', { light: s === cs ? 'day' : 'torch', pointed: true });
  });

  // Under the church: the crypt under the choir, the stairs down to it under the choir's aisles, the dungeon under the transept on
  // the side away from the cloister, and the chamber under the shrine.
  const crypt = add(choirR, 'crypt', { level: -1, spans: 3, axis: 'z', light: 'torch' });
  const cryptStairs = ([-1, 1] as const).map((s) => add(mirror({ ...aisleX, z0: choirR.z0, z1: choirR.z1 }, s), 'crypt stair', { level: -1, roof: 'timber', light: 'torch', axis: 'z' }));
  const PW = 3;
  const passage = add(mirror({ ...armX, z0: crossR.z0, z1: crossR.z0 + PW }, ds), 'dungeon', { level: -1, axis: 'x', light: 'torch' });
  const k = Math.max(2, Math.floor((armLen + T) / (3.4 + T))), cw = r2((armLen + T) / k - T);
  const cells: Place[] = [];
  for (let i = 0; i < k; i++) {
    const x0 = armX.x0 + i * (cw + T);
    cells.push(add(mirror({ x0, x1: x0 + cw, z0: crossR.z0 + PW + T, z1: crossR.z1 }, ds), i === k - 1 ? 'oubliette' : 'cell', { level: -1, axis: 'z', light: 'dark', role: 'reward' }));
  }
  const hidden = add(shrineR, 'hidden chamber', { level: -1, spans: 2, light: 'dark', role: 'reward' });

  // The towers' rooms, one over another: the stair round the walls, the belfry, the top.
  const feet = twin ? fronts : [narthex];
  const stacks = feet.map((f) => ({
    foot: f,
    shaft: add(f, 'tower stair', { level: 1, roof: 'timber', light: 'torch', role: 'passage', pointed: undefined, axis: f.axis }),
    belfry: add(f, 'belfry', { level: 2, roof: 'timber', light: 'day', role: 'passage', pointed: undefined, axis: f.axis }),
    top: add(f, 'tower top', { level: 3, roof: 'sky', light: 'day', role: 'passage', pointed: undefined, axis: f.axis, wall: 1.2 }),
  }));

  // The forecourt, the parvis before the west front, which is the terrace at the head of the town's square.
  const x0All = Math.min(...places.map((p) => p.x0)) - T, x1All = Math.max(...places.map((p) => p.x1)) + T;
  const forecourt = add({ x0: r1(Math.min(-7, x0All - 3)), x1: r1(Math.max(7, x1All + 3)), z0: T, z1: T + r1(m.range(17, 21)) }, 'meadow', { role: 'approach', roof: 'sky', light: 'day', wall: 3.9, floor: 0, axis: 'x' });

  // ---- the ways
  way(narthex, forecourt, 's', 'door', 0, 1.25, { spring: 2.9 });
  const westArch = way(narthex, nave, 'n', 'arch', 0, twin ? half - 1.1 : Math.min(2.6, half - 1.6), { pointed: true });
  const towerDoors: Way[][] = [[], []];
  ([-1, 1] as const).forEach((s) => {
    const f = side(fronts, s), aisle = side(aisles, s), arm = side(arms, s), ca = side(choirAisles, s);
    if (twin) towerDoors[s === -1 ? 0 : 1].push(way(f, narthex, OPPOSITE[across(s)], 'door', -Lr * 0.45, 0.85));
    towerDoors[s === -1 ? 0 : 1].push(way(f, aisle, 'n', 'door', mid(aisle, true), 0.85));
    way(aisle, arm, 'n', 'arch', mid(aisle, true), A / 2 - 0.7, { pointed: true });
    way(crossing, arm, across(s), 'arch', mid(crossing, false), half - 1.1, { pointed: true });
    way(arm, ca, 'n', 'arch', mid(ca, true), A / 2 - 0.7, { pointed: true });
    const nr = north[s === -1 ? 0 : 1];
    if (nr) way(arm, nr, 'n', 'door', mid(nr, true), 0.9);
  });
  const pier = Math.min(2, Math.max(1.5, B * 0.3)), ha = (B - pier) / 2;
  const arcades: Way[] = [];
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < nb; i++) arcades.push(way(nave, side(aisles, s), across(s), 'arch', naveR.z0 + (i + 0.5) * B, ha, { pointed: true }));
    for (let i = 0; i < cb; i++) arcades.push(way(choir, side(choirAisles, s), across(s), 'arch', choirR.z0 + (i + 0.5) * B, ha, { pointed: true }));
  }
  const greatArches = [way(nave, crossing, 'n', 'arch', 0, half - 1.1, { pointed: true }), way(crossing, choir, 'n', 'arch', 0, half - 1.1, { pointed: true })];
  const shrineDoor = way(choir, shrine, 'n', 'door', 0, 0.95);
  if (court) {
    const aisle = side(aisles, cs), arm = side(arms, cs);
    way(aisle, court, across(cs), 'door', mid(court, false), 0.9);
    way(arm, court, 's', 'door', mid(court, true), 0.9);
    if (range) way(court, range, 's', 'door', mid(range, true), 0.9);
    if (library) way(range ?? court, library, 's', 'door', mid(library, true), 0.85);
  }
  for (const s of [-1, 1] as const) way(side(cryptStairs, s), crypt, OPPOSITE[across(s)], 'door', mid(crypt, false), 0.85);
  const dungeonDoor = way(side(cryptStairs, ds), passage, 's', 'door', mid(side(cryptStairs, ds), true), 0.85);
  const cellDoors = cells.map((c) => way(passage, c, 's', 'door', mid(c, true), 0.6));
  way(crypt, hidden, 'n', 'door', 0, 0.85, { door: { leaf: 'secret' } });

  // ---- the town, laid out round the church's ground and its forecourt
  const sky = SKIES[setting.hour].sun, l = Math.hypot(sky[0], sky[1], sky[2]);
  const towerSpires = (() => {
    const q = streamOf(rng, 'spires');
    const kind = q.pick<SpireKind>(twin ? ['stone', 'stone', 'lead', 'copper', 'copper', 'none'] : ['stone', 'stone', 'copper', 'lead']);
    // (Now and then one of two towers was never given its spire, as happened.)
    return feet.map((_, i) => (twin && i === 1 && kind !== 'none' && q.chance(0.12) ? 'none' : kind) as SpireKind);
  })();
  const looks = streamOf(rng, 'looks');
  const cathedral: Cathedral = {
    parts, towers: [], roof: looks.pick(['lead', 'lead', 'copper', 'copper', 'tile']), pitch, flyers: looks.chance(0.75), rose: looks.chance(0.65),
    measure: { near: 0, ridge: 0, least: 0 },
  };
  const site: Site = {
    seed, places, ways, items: [], levers: [], secret: hidden.id, start: forecourt.id, wallThickness: T, top: 0, entrance: narthex.id, goal: shrine.id,
    setting, sun: [sky[0] / l, sky[1] / l, sky[2] / l], title: '', cathedral,
  };
  layOutTown(site, forecourt, 0, rng.fork('town'), true, inWorld, townPlan, city);

  // ---- how high: the tallest buildings about the square, and the nave's ridge between half as high again as they are and three times
  const h = streamOf(rng, 'heights');
  const t = site.town!, fz = (forecourt.z0 + forecourt.z1) / 2;
  const about = t.buildings.filter((b) => Math.hypot(b.x, b.z - fz) < 170);
  const near = r1(Math.max(10, ...(about.length ? about : t.buildings).map(buildingHeight)));
  const factor = 1.5 + 1.5 * Math.pow(h.next(), 1.2);
  const roofRise = (half + T + 0.35) * pitch, rv = half * POINTED_RISE;
  // (Room for the clerestory over the aisles' roofs: their lean-to against the nave's wall, their vaults, and windows of a good height.)
  const cler = (A + T + 0.3) * LEAN + (A / 2) * POINTED_RISE + 0.7 + 3.8, minWa = 6.6;
  const Wn = r1(Math.max(minWa + cler, near * factor - roofRise - rv - 0.7));
  const Wa = r1(Math.min(Wn - cler, Math.max(minWa, Wn * h.range(0.44, 0.52))));
  for (const p of [nave, crossing, choir, ...arms]) p.wall = Wn;
  for (const p of [...aisles, ...choirAisles]) p.wall = Wa;
  shrine.wall = r1(Math.min(Wn - 2, Math.max(Wa, Wn * 0.62)));
  for (const nr of north) if (nr) nr.wall = r1(nr.name === 'chapter house' ? Math.min(Wa, 4 + (nr.x1 - nr.x0) * 0.45) : Math.min(Wa, 4.4));
  if (!twin) for (const f of fronts) f.wall = Wa;
  const ridge = r2(Wn + rv + 0.7 + roofRise);
  cathedral.measure = { near, ridge, least: r2(minWa + cler + rv + 0.7 + roofRise) };

  // The arches: each as tall as its wall lets it be, its point a little under where the vault springs.
  const springUnder = (wall: number, w: number) => r2(Math.max(2.4, wall - 0.6 - w * Math.sqrt(3)));
  for (const w of arcades) w.spring = springUnder(Wa, w.halfWidth);
  for (const w of greatArches) w.spring = springUnder(Wn, w.halfWidth);
  for (const w of ways) if (w.kind === 'arch' && w.spring === undefined && w.b !== nave.id) w.spring = springUnder(Math.min(places[w.a].wall, places[w.b].wall), w.halfWidth);

  // The towers, from the foot up. The foot's flight runs up the tower's outer wall to the room of the stair, whose stair climbs round
  // its walls to the belfry; a steep flight from there comes up through the top.
  const STEPS_UP = (len: number, tread: number, most: number) => Math.min(most, Math.floor((len - 1.5) / tread));
  const above = (twin ? 1.0 : 1.06) + h.next() * (twin ? 0.2 : 0.22);
  stacks.forEach((st, i) => {
    const f = st.foot, outer: Side = twin ? across(i === 0 ? -1 : 1) : 'w', alongX = outer === 'n' || outer === 's';
    const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0, steps1 = STEPS_UP(len, 0.25, twin ? 26 : 40), run1 = Math.min(len - 1.5, steps1 * 0.25);
    const rise1 = r2(steps1 * STEP_RISE), steps3 = STEPS_UP(Math.min(f.x1 - f.x0, f.z1 - f.z0), STEP_RISE, twin ? 34 : 46), rise3 = r2(steps3 * STEP_RISE);
    const Ht = Math.max(rise1 + 9 + rise3, ridge * above);
    let steps2 = Math.round((Ht - rise1 - rise3) / STEP_RISE);
    // (The foot's flight climbs towards the corner the stair round the walls begins from: the way of the sun round from the outer wall.)
    const first = SUNWISE[outer], up = outer === 'w' ? -1 : 1;
    const at1 = up < 0 ? f.z1 - 0.7 : f.z0 + 0.7, to1 = at1 + up * run1;
    // The stair round the walls: started a little along its first wall, as far along as makes its last leg long enough that whoever
    // climbs it comes up through the floor above without striking it. (Failing that, a step more, and the belfry so much higher.)
    const W = 1.15, dirOf = (s: Side) => (s === 'n' || s === 'e' ? 1 : -1);
    const startOf = (s: Side) => (s === 'n' ? f.x0 + W : s === 'e' ? f.z0 + W : s === 's' ? f.x1 - W : f.z1 - W);
    let at2 = startOf(first) + dirOf(first) * 0.3, to2 = NaN;
    let lastSide: Side = first;
    found: for (let extra = 0; extra < 40; extra++, steps2++) {
      for (let shift = 0.3; shift < 4; shift += ROUND) {
        const a = startOf(first) + dirOf(first) * shift, { legs } = roundLegs(f, steps2, first, a, W), last = legs[legs.length - 1];
        const full = Math.floor(((last.side === 'n' || last.side === 's' ? f.x1 - f.x0 : f.z1 - f.z0) - 2 * W) / ROUND + 1e-6);
        if (legs[0].side !== first || legs[0].steps < 2) break;
        if (last.steps >= Math.min(16, full)) { at2 = a; to2 = last.to; lastSide = last.side; break found; }
      }
    }
    if (Number.isNaN(to2)) { const { legs } = roundLegs(f, steps2, first, at2, W), last = legs[legs.length - 1]; to2 = last.to; lastSide = last.side; }
    const rise2 = r2(steps2 * STEP_RISE);
    // The steep flight in the belfry, against the wall across from where the stair round the walls comes up.
    const ws = OPPOSITE[lastSide], along3 = ws === 'n' || ws === 's', lo3 = along3 ? f.x0 : f.z0, run3 = r2(Math.min((along3 ? f.x1 - f.x0 : f.z1 - f.z0) - 1.5, steps3 * 0.25));
    f.floor = CHURCH;
    if (f.roof === 'timber') f.wall = r2(rise1 - 0.3);
    st.shaft.floor = r2(CHURCH + rise1); st.shaft.wall = r2(rise2 - 0.3);
    st.belfry.floor = r2(st.shaft.floor + rise2); st.belfry.wall = r2(rise3 - 0.3);
    st.top.floor = r2(st.belfry.floor + rise3);
    way(f, st.shaft, outer, 'stair', r2(at1), 0.55, { to: r2(to1) });
    way(st.shaft, st.belfry, first, 'stair', r2(at2), 0.575, { to: r2(to2), round: true });
    way(st.belfry, st.top, ws, 'stair', r2(lo3 + 0.7), 0.55, { to: r2(lo3 + 0.7 + run3) });
    const spire = towerSpires[i], top = st.top.floor - CHURCH;
    cathedral.towers.push({ foot: f.id, roof: st.top.id, spire, spireHeight: spire === 'none' ? 0 : r1(top * (twin ? h.range(0.5, 0.8) : h.range(0.65, 0.95))) });
  });
  // The single tower's foot is the narthex: the arch into the nave springs under its ceiling.
  if (!twin) westArch.halfWidth = r2(Math.min(westArch.halfWidth, (narthex.wall - 3.2) / Math.sqrt(3)));
  else narthex.wall = Wn;
  westArch.spring = springUnder(narthex.wall, westArch.halfWidth);
  // Over the crossing, a tower that is not climbed, or a slender spire on the ridge.
  {
    const q = streamOf(rng, 'crossing');
    if (q.chance(twin ? 0.6 : 0.4)) {
      const top = r1(ridge + Math.max(4, ridge * q.range(0.12, 0.3)));
      const spire = q.pick<SpireKind>(twin ? ['none', 'none', 'lead', 'copper', 'stone'] : ['none', 'none', 'none', 'lead', 'copper']);
      cathedral.lantern = { top, spire, spireHeight: spire === 'none' ? 0 : r1(top * q.range(0.45, 0.8)) };
    } else cathedral.fleche = r1(Math.max(8, ridge * q.range(0.35, 0.6)));
  }

  // The rooms under the church: the crypt's three low vaults on two rows of columns, deep enough under the choir for its floor and a
  // man's height under its vaults; the stairs down to it; the dungeon and its cells; the chamber under the shrine.
  const Rc = N / 3 / 2, stepsC = Math.ceil((2.3 + Rc + 0.45) / STEP_RISE), riseC = r2(stepsC * STEP_RISE), low = r2(CHURCH - riseC);
  crypt.floor = low; crypt.wall = 2.3;
  for (const [i, cs2] of cryptStairs.entries()) {
    const s = i === 0 ? -1 : 1, ca = side(choirAisles, s as 1 | -1);
    cs2.floor = low; cs2.wall = r2(riseC - 0.3);
    const len = cs2.z1 - cs2.z0, run = Math.min(len - 1.5, stepsC * 0.25), at = cs2.z1 - 0.7;
    way(cs2, ca, across(s as 1 | -1), 'stair', r2(at), 0.55, { to: r2(at - run) });
  }
  passage.floor = low; passage.wall = r2(riseC - 0.45 - PW / 2);
  for (const c of cells) { c.floor = low; c.wall = r2(riseC - 0.45 - (c.x1 - c.x0) / 2); }
  hidden.floor = low; hidden.axis = hidden.z1 - hidden.z0 >= hidden.x1 - hidden.x0 ? 'z' : 'x';
  hidden.wall = r2(shrine.floor - 0.45 - vaultRise({ ...hidden, wall: 0 }) - low);

  // ---- the roofline, and how far in each place is
  site.top = r2(Math.max(...places.filter((p) => p.role !== 'approach' && (p.level ?? 0) >= 0 && p.roof !== 'sky').map(toplineOf)));
  const adj = neighbours(site), depth = new Map<number, number>([[forecourt.id, 0]]), queue = [forecourt.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adj.get(id)!) if (!depth.has(n)) { depth.set(n, depth.get(id)! + 1); queue.push(n); }
  }
  for (const p of places) p.depth = depth.get(p.id) ?? -1;
  if (!allReachable(site)) throw new Error(`cathedral is not connected (seed ${seed})`);

  // ---- the mission: doors, locks and keys, and proof that it can be done
  // A cathedral's mission is its own, so that it takes the player both high and low: the shrine is locked, and its gold key and the
  // iron key that opens the way to it lie one at the top of a tower and one in the dungeon. Either the iron key is up the tower and
  // the gold behind the iron door into the dungeon; or the gold key is up the tower, behind an iron lock on the tower's doors, and the
  // iron key down in the dungeon. (A single tower's foot is the porch, which cannot be locked, so a single tower always has the iron key
  // at its top.) And a shortcut: one way in that is shut at first and opened from beyond.
  {
    const q = streamOf(rng, 'mission');
    const keyTower = q.int(0, stacks.length - 1), up = stacks[keyTower].top, deep = q.chance(0.5) ? cells[cells.length - 1] : q.pick(cells);
    const upFirst = !twin || q.chance(0.5);
    up.role = 'reward';
    shrineDoor.door = { leaf: 'shut', lock: 'gold' };
    if (upFirst) {
      // The iron key at the top; the gold behind the dungeon's iron door.
      site.items.push({ kind: 'key', key: 'iron', place: up.id }, { kind: 'key', key: 'gold', place: deep.id });
      dungeonDoor.door = { leaf: 'shut', lock: 'iron' };
    } else {
      site.items.push({ kind: 'key', key: 'gold', place: up.id }, { kind: 'key', key: 'iron', place: deep.id });
      for (const w of towerDoors[keyTower]) w.door = { leaf: 'shut', lock: 'iron' };
    }
    // The shortcut. Between two towers: the door from the narthex into the tower without the key is a portcullis, its lever in the
    // tower's foot, seen through the bars and reached round by the aisle. Under one tower: the door from the arm into the cloister is
    // barred on the arm's side; or, with no cloister, the door from a chapel into its aisle is a portcullis from the chapel's side.
    const other = twin ? stacks[1 - keyTower].foot : null;
    const gateIn = other ? towerDoors[1 - keyTower].find((w) => w.b === narthex.id || w.a === narthex.id) : undefined;
    if (gateIn && !gateIn.door) {
      const [x, z] = leverSpot(site, gateIn, other!.id);
      gateIn.door = { leaf: 'gate', lever: site.levers.length };
      site.levers.push({ place: other!.id, opens: ways.indexOf(gateIn), x, z });
    } else if (court) {
      const w = ways.find((x) => x.a === side(arms, cs).id && x.b === court!.id);
      if (w && !w.door) w.door = { leaf: 'shut', barredFrom: side(arms, cs).id };
    }
    // Other doors: some hung with a door standing open, some shut but free, the rest open arches; the great door stands open; the cells'
    // doors are all hung, shut or ajar.
    for (const w of ways) {
      if (w.kind !== 'door' || w.door) continue;
      const r = q.next(), cell = cellDoors.includes(w);
      if (w.a === forecourt.id || w.b === forecourt.id) w.door = { leaf: 'open' };
      else if (cell || r < 0.3) w.door = { leaf: r < 0.65 ? 'shut' : 'open' };
      else if (r < 0.6) w.door = { leaf: 'open' };
    }
  }
  if (!solve(site).ok) throw new Error(`cathedral cannot be completed (seed ${seed})`);

  // ---- what it is called
  const number = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const spireWord = (k: SpireKind) => (k === 'stone' ? 'a spire of stone' : k === 'lead' ? 'a spire of lead' : k === 'copper' ? 'a spire of copper' : 'no spire');
  const towersSaid = twin
    ? (towerSpires[0] === towerSpires[1] ? `two west towers, each with ${spireWord(towerSpires[0])}` : `two west towers, one with ${spireWord(towerSpires[0])} and one never finished`)
    : `a great west tower with ${spireWord(towerSpires[0])}`;
  const crossSaid = cathedral.lantern ? `a tower over the crossing${cathedral.lantern.spire !== 'none' ? ' and its spire' : ''}` : 'a slender spire over the crossing';
  const state = { kept: '', damp: 'damp ', forsaken: 'forsaken ' }[setting.condition];
  site.title = `At the head of a harbour town's square${setting.season === 'winter' ? ', in snow' : ''}, a ${state}${setting.stone} cathedral ${WHEN[setting.hour]}, its ridge ${Math.round(ridge)} metres high, ${(ridge / near).toFixed(1)} times the houses about the square: a nave of ${number[nb]} bays between its aisles, transepts, ${crossSaid}, a choir of ${number[cb]} bays and the shrine beyond; ${towersSaid}, climbed round their walls to the bells and the top; a crypt under the choir with a dungeon of ${number[cells.length]} cells beside it${court ? ', and a cloister' : ''}; the shrine lies ${shrine.depth - 1} doors in.`;
  return site;
}
