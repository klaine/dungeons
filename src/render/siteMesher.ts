import { Vector3 } from 'three';
import { cells3, fbm2, fbm3, Rng } from '../core/rng';
import { Furnisher, Rect } from './furnish';
import { anyAngle } from './coast';
import { Building, Place, POINTED_VAULT, ROUND_TREAD, roundStair, shoreOf, Side, Site, SKIES, stairEnds, vaultRise, Way } from '../core/site';
import { toplineOf } from '../core/cathedral';
import { buildCathedral, cathedralWindows, spireTops } from './cathedral';
import { buildDoorLeaf } from './doorLeaf';
import { indoorField, outdoorFieldAt } from './fields';
import { archSdf, Frame, Kit, Opening } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { alongSheet, carveRock, smin } from './geom/rock';
import { buildCamp } from './camp';
import { buildMineYard } from './mine';
import { boulderForm, cliffRelief, erode, Grid2, monolithForm, ROCK, Strata } from './geom/rockForms';
import { beam as beamBuilt, plank as plankBuilt, stoneStyles } from './geom/styles';
import { FAR_RING, crestAt, farHeights, layMountains, layTerrain, turfColour } from './landscape';
import { MeshBuilder } from './geom/meshBuilder';
import { layBeam } from './geom/timber';
import { buildBuilding, buildingTools, solids } from './buildings';
import { placeHouse } from './housePlacing';
import { buildLandmark } from './landmarks';
import { footprintOf, groundOf, plinthOf, stepsUp } from '../core/building';
import { armRise, boxValley, edgeAt, hallOnward, insideOf, joinLine, slantAt, valleyLand } from '../core/valley';
import { lakeLevelAt, siteFrame, toSite, worldLand } from '../core/worldLand';
import { Colour, growConifer, growTree, layLimb, layTrunk, Planting } from './planting';
import { CardSet, DoorDesc, SceneDescription, SeaDesc, TorchSpec } from './scene';
import { buildIsland } from './island';
import { landAt as islandLandAt } from '../core/island';
import { buildMountain } from './mountain';
import { buildTown } from './town';
import { townGround } from '../core/town';
import { layWall } from './walls';
import { bartizan, buildCastle } from './castle';
import { castleOff } from '../core/castle';

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
type OuterWindow = Way & { outer: true; circle?: boolean };

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

/** Where the building has got to: said between its long steps, so that a page can show it and breathe while it waits. */
export interface MeshStage { label: string; at: number }

/**
 * How finely a valley's ground is laid where it is walked: the sheet's cell, in metres (1.2 by default; `?sheet=` in the browser,
 * `SHEET=` before a tool). The rock carved along the valley's sides is carved on a lattice that divides it exactly, as near 0.3
 * metres as that allows (0.3 for 1.2, 0.267 for 0.8), since every carved piece ends on the sheet's own lines.
 */
export const VALLEY_GROUND = { sheet: 1.2 };

/** Builds the whole scene at once, for tools that wait for it. */
export function meshSite(site: Site): SceneDescription {
  const steps = meshSiteSteps(site);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/**
 * The same, as a sequence of steps. It gives up control between rooms and caves; the caller may let the browser draw and answer the
 * person before asking for the next. (Built in one run it holds a page still for ten seconds or more, and browsers offer to kill such pages.)
 */
export function* meshSiteSteps(site: Site): Generator<MeshStage, SceneDescription, void> {
  yield { label: 'Surveying the ground', at: 0 };
  const kit = new Kit(site.seed);
  const rng = new Rng(site.seed).fork('mesh');
  const T = site.wallThickness;
  const places = site.places;
  const built = stoneStyles(site.setting.stone);
  // (A castle's walls and vaults are not laid stone by stone but in plain faces, drawn with coursed stone (`castle`): as the castle's
  // own walls and towers are, and as the buildings of the valley are built, of plain solids. Each face a block or two, so the light
  // still has points every metre or so to be baked at. Its floors, door surrounds and copings are laid as they were.)
  const plainStone = site.castle ? { ...built.ashlar, course: [4, 4] as const, length: [9, 9] as const, joint: 0.001, bevel: 0.001, depth: 0, proud: 0, relief: 0, maxSeg: 1.2, chip: 0, tintVar: 0.02, hueVar: 0.01, uvScale: 0.5 } : null;
  // (A cathedral is too large to be laid stone by stone: its walls, vaults, arches and floors are plain surfaces with their courses in
  // the picture, `ashlar`, as the buildings of the towns are drawn. See `MasonryStyle.flat`.)
  const flatOf = (st: MasonryStyle, cell = 0.6): MasonryStyle => ({ ...st, flat: true, material: 'ashlar', maxSeg: cell, uvScale: 1 / 2.4, tint: [st.tint[0] * 1.08, st.tint[1] * 1.08, st.tint[2] * 1.08] });
  const { ashlar, dressed, vaultStone, flag, hallFlag, coping, tint: stoneTint }: typeof built = site.cathedral
    ? { ...built, ashlar: flatOf(built.ashlar), dressed: flatOf(built.dressed, 0.35), vaultStone: flatOf(built.vaultStone), flag: flatOf(built.flag, 0.8), hallFlag: flatOf(built.hallFlag, 0.8), coping: flatOf(built.coping, 0.6) }
    : { ...built, ashlar: plainStone ?? built.ashlar, vaultStone: plainStone ? { ...plainStone, tint: built.vaultStone.tint } : built.vaultStone };
  // (Laid in the plain style, it is drawn in coursed stone; told by its measures, which no other style has, so that copies of it count.)
  const castleStone = (material: string, st: { course: readonly [number, number]; length: readonly [number, number] }) => (material === 'stone' && st.course[0] === 4 && st.length[0] === 9 ? 'castle' : material);
  if (plainStone) kit.materialFor = castleStone;
  /**
   * In a cathedral a wall more than a storey or two high is laid in larger blocks, as the great churches were, in courses half a
   * metre high and up to a metre and a half long (and its cost, forty metres of wall, stays within bounds).
   */
  // (Over a cathedral's floors, where nothing is seen close, the lattice its surfaces are cut on is coarser.)
  const big: MasonryStyle = { ...ashlar, maxSeg: 1.1 }, midStone = ashlar, bigDressed = dressed, bigVault = vaultStone;
  const NEAR = 6.5;
  const sky = SKIES[site.setting.hour];
  // Where sheep graze, if anywhere: worked out with the planting of each kind of place.
  let flockSpots: { x: number; z: number; r: number; count: number }[] | undefined;
  // And rooks over a valley's woods, if it has any.
  let rookSpots: { x: number; y: number; z: number }[] | undefined;
  let fireflySpots: number[] | undefined;
  // A valley's fields (`site.fields`): which one a point is in, -1 if none; or whether it is within `m` of one. (Looked up by their
  // boxes first: this is asked of every point of the ground's sheet and of every tuft.)
  const fieldList = (site.fields ?? []).map((f) => {
    const xs = f.corners.map((c) => c[0]), zs = f.corners.map((c) => c[1]);
    return { ...f, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const inPolygon = (c: [number, number][], x: number, z: number): boolean => {
    let inside = false;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) if ((c[i][1] > z) !== (c[j][1] > z) && x < ((c[j][0] - c[i][0]) * (z - c[i][1])) / (c[j][1] - c[i][1] || 1e-9) + c[i][0]) inside = !inside;
    return inside;
  };
  const edgeOff = (c: [number, number][], x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const [ax, az] = c[j], [bx, bz] = c[i], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
      best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
    }
    return best;
  };
  const fieldAt = (x: number, z: number, m = 0): number => {
    for (let k = 0; k < fieldList.length; k++) {
      const f = fieldList[k];
      if (x < f.x0 - m || x > f.x1 + m || z < f.z0 - m || z > f.z1 + m) continue;
      if (inPolygon(f.corners, x, z) || (m > 0 && edgeOff(f.corners, x, z) < m)) return k;
    }
    return -1;
  };

  /** The colour of a field's crop in the season, as a tint on the turf (as the town's fields have it). */
  const cropTint = (crop: NonNullable<Site['fields']>[number]['crop']): Colour => {
    const season = site.setting.season ?? 'spring', ripe = season === 'summer' ? 0.6 : season === 'autumn' ? 1 : 0;
    switch (crop) {
      case 'wheat': return ripe ? [1.25 + 0.25 * ripe, 1.05 + 0.1 * ripe, 0.45] : [0.85, 1.12, 0.6];
      case 'barley': return ripe ? [1.35 + 0.2 * ripe, 1.2 + 0.05 * ripe, 0.6] : [0.92, 1.15, 0.66];
      case 'oats': return ripe ? [1.15 + 0.2 * ripe, 1.1, 0.62] : [0.8, 1.05, 0.62];
      case 'roots': return [0.6, 0.85, 0.45];
      case 'fallow': return [0.9, 0.8, 0.6];
      default: return [1, 1, 1];
    }
  };

  // ------------------------------------------------------------------ helpers
  // (A cathedral's places stand at heights of their own, and not under one roofline: see `cathedral.ts`.)
  const cath = site.cathedral;
  // (A cathedral's boards and beams too are plain surfaces, their grain the picture's.)
  const plank: MasonryStyle = cath ? { ...plankBuilt, flat: true, maxSeg: 0.9 } : plankBuilt, beam: MasonryStyle = cath ? { ...beamBuilt, flat: true, maxSeg: 1.5 } : beamBuilt;
  /** The top of the masonry over a place: the house's roofline, or in a cathedral the place's own. */
  const topOf = (p: Place) => (cath ? toplineOf(p) : site.top);
  /** How high what is solid over a place goes: to its top, or to the floor of whatever room lies over it. */
  const overlaps = (a: { x0: number; x1: number; z0: number; z1: number }, b: { x0: number; x1: number; z0: number; z1: number }) => a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.z0 < b.z1 - 0.01 && b.z0 < a.z1 - 0.01;
  const solidTop = (p: Place) => {
    let top = topOf(p);
    for (const q of places) if (q.role !== 'approach' && (q.level ?? 0) > (p.level ?? 0) && q.floor > p.floor && overlaps(p, q)) top = Math.min(top, q.floor - 0.035);
    return top;
  };
  /** The places on storeys under a place that lie under part of it. */
  const placesUnder = (p: Place) => places.filter((q) => q.role !== 'approach' && (q.level ?? 0) < (p.level ?? 0) && q.floor < p.floor && overlaps(p, q));
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

  const shape = (w: Way): { y0: number; ys: number; point?: number; circle?: boolean } => {
    const lo = Math.min(places[w.a].floor, places[w.b].floor);
    const hi = Math.max(places[w.a].floor, places[w.b].floor);
    // (A pointed arch, as a church's are: two arcs each as broad as the opening.)
    const point = w.pointed ? 2 : undefined;
    // (A window in an outer wall of a house that stands free: tall and arched in a room lit by day, a slit where torches light it.
    // A church's windows say where they begin and spring.)
    if ((w as OuterWindow).outer) {
      const p = places[w.a];
      if ((w as OuterWindow).circle) return { y0: p.floor + w.spring! - w.halfWidth, ys: p.floor + w.spring!, circle: true };
      if (w.spring !== undefined) return { y0: p.floor + (w.sill ?? 1.05), ys: p.floor + w.spring, point };
      return { y0: p.floor + 1.05, ys: p.floor + Math.min(p.wall - 0.55, w.halfWidth < 0.3 ? 2.3 : 2.75) };
    }
    if (w.kind === 'window') return { y0: hi + 1.55, ys: hi + 2.35, point };
    return { y0: lo - 0.1, ys: hi + (w.spring ?? (w.natural ? 2.5 : w.kind === 'arch' ? 1.9 : 2.0)), point };
  };
  // A secret door shows no dressed stone on the side it is hidden from: the wall runs up to it.
  const hiddenFrom = (w: Way, p: Place) => w.door?.leaf === 'secret' && p.id !== site.secret;
  // (The front of a house that stands free is the forecourt's wall, and is built with it: the windows of the rooms behind it are cut
  // through it too. Without them they were walled up from outside, and open from inside, where the wall's face cannot be seen.)
  const frontWindows = (p: Place, side: Side): Way[] => p.role !== 'approach' || side !== 'n' ? []
    : [...outerWindows.values()].flat().filter((w) => w.side === 's' && Math.abs(places[w.a].z1 + T - p.z0) < 0.05);
  // (The stretches of a free house's front that stand on the forecourt's line, where its front is the forecourt's wall. A room set back
  // from that line has an outer wall of its own, with its windows; a front drawn across from end to end stood before it as a blank screen.)
  const frontPieces = (p: Place, fx0: number, fx1: number): [number, number][] => cath ? [] : !free ? [[fx0, fx1]]
    : runs.filter((r) => r.side === 's' && Math.abs(r.at - p.z0) < 0.05).map((r): [number, number] => [Math.max(fx0, r.from), Math.min(fx1, r.to)]).filter(([a, b]) => b - a > 0.05);
  const buildFront = (p: Place, fx0: number, fx1: number) => {
    for (const [a, b] of frontPieces(p, fx0, fx1)) kit.wallFace('stone', kit.frame(a, p.z0, b, p.z0), p.floor - 0.7, site.top, ashlar, { openings: holesOn(p, 'n', 0).filter((h) => h.at > a && h.at < b).map((h) => ({ ...h, c: h.at - a })) });
  };
  const holesOn = (p: Place, side: Side, e: number): Hole[] =>
    [...[...site.ways, ...(outerWindows.get(p.id) ?? [])].filter((w) => w.kind !== 'stair' && (w.a === p.id || w.b === p.id) && sideOf(w, p) === side), ...frontWindows(p, side)]
      .map((w) => ({ way: w, at: w.at, c: alongFrame(p, side, w.at, e), w: w.halfWidth, ...shape(w), ...(hiddenFrom(w, p) ? { band: 0.03 } : {}) }));

  const span = (p: Place) => (p.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0);
  const isEndWall = (p: Place, side: Side) => (p.axis === 'x') === (side === 'e' || side === 'w');
  /** The radius of a pointed vault's arcs over its half span, or 1 for a half-round one. */
  const pointOf = (p: Place) => (p.pointed ? POINTED_VAULT : 1);
  /** Whether a room is a cathedral's great space, whose ring of candles is a corona hung high. */
  const coronaOf = (p: Place) => !!cath && span(p) > 8 && ['nave', 'choir', 'crossing'].includes(p.name);
  const wallTop = (p: Place, side: Side): number => {
    if (p.roof === 'barrel') return p.floor + p.wall + (isEndWall(p, side) ? vaultRise(p) + 0.3 : 0.12);
    if (p.roof === 'timber') return p.floor + p.wall + 0.1;
    if (p.roof === 'cave') return p.floor + p.wall + 1.3;
    return topOf(p);
  };

  /**
   * The sanctum's altar dressed as the end of the way should be: a cloth of deep red over it, hanging down its front, with a band of
   * gold at its foot; a candle at either end, in an iron pricket, burning; and between them a casket bound in gilt. And the sanctum's
   * windows glazed in coloured glass, which the day comes through. (It was a bare stone chest and a torch: the end of the game.)
   */
  const dressAltar = (p: Place, f: Frame, u: number, half: number, near: number, deep: number, body: { min: Vector3; max: Vector3 }, lid: { min: Vector3; max: Vector3 }) => {
    const { solid } = anyAngle((m) => kit.mesh(m));
    const was = kit.group;
    kit.group = `p${p.id}`;
    const corners = (a: { min: Vector3; max: Vector3 }): [number, number, number][] => [
      [a.min.x, a.min.y, a.min.z], [a.max.x, a.min.y, a.min.z], [a.max.x, a.min.y, a.max.z], [a.min.x, a.min.y, a.max.z],
      [a.min.x, a.max.y, a.min.z], [a.max.x, a.max.y, a.min.z], [a.max.x, a.max.y, a.max.z], [a.min.x, a.max.y, a.max.z]];
    const top = lid.max.y, red: [number, number, number] = [0.32, 0.035, 0.04], gold: [number, number, number] = [0.62, 0.45, 0.12];
    // The cloth: over the lid, and down the front of the chest to a hand above the floor; its band of gold along the foot.
    solid('plaster', corners(wallBox(f, u - half + 0.12, u + half - 0.12, top, top + 0.012, -(near + 0.05), -(near + deep + 0.115))), red);
    solid('plaster', corners(wallBox(f, u - half + 0.12, u + half - 0.12, body.min.y + 0.16, top + 0.012, -(near + deep + 0.1), -(near + deep + 0.118))), red);
    solid('metal', corners(wallBox(f, u - half + 0.12, u + half - 0.12, body.min.y + 0.12, body.min.y + 0.22, -(near + deep + 0.1), -(near + deep + 0.122))), gold);
    // The candles: an iron pricket, a pale candle on it, and its flame.
    for (const end of [-1, 1]) {
      const a = u + end * (half - 0.08), mid = -(near + deep / 2), base = wallBox(f, a - 0.07, a + 0.07, top, top + 0.03, mid + 0.07, mid - 0.07);
      solid('metal', corners(base), [0.05, 0.045, 0.04]);
      solid('metal', corners(wallBox(f, a - 0.015, a + 0.015, top + 0.03, top + 0.34, mid + 0.015, mid - 0.015)), [0.05, 0.045, 0.04]);
      solid('metal', corners(wallBox(f, a - 0.06, a + 0.06, top + 0.34, top + 0.36, mid + 0.06, mid - 0.06)), [0.05, 0.045, 0.04]);
      solid('plaster', corners(wallBox(f, a - 0.025, a + 0.025, top + 0.36, top + 0.6, mid + 0.025, mid - 0.025)), [0.92, 0.88, 0.76]);
      const flame = wallBox(f, a - 0.012, a + 0.012, top + 0.61, top + 0.68, mid + 0.012, mid - 0.012);
      solid('lamp', corners(flame), [1, 0.85, 0.5]);
    }
    // The casket: a little chest of dark wood bound with gilt straps, on the cloth between the candles.
    const mid = -(near + deep / 2);
    solid('wood', corners(wallBox(f, u - 0.22, u + 0.22, top + 0.012, top + 0.2, mid + 0.14, mid - 0.14)), [0.18, 0.1, 0.06]);
    solid('wood', corners(wallBox(f, u - 0.23, u + 0.23, top + 0.2, top + 0.26, mid + 0.15, mid - 0.15)), [0.2, 0.11, 0.06]);
    for (const k of [-0.13, 0.13]) solid('metal', corners(wallBox(f, u + k - 0.02, u + k + 0.02, top + 0.012, top + 0.265, mid + 0.155, mid - 0.155)), gold);
    // The windows glazed: each a lattice of coloured panes, deep blue and red with gold and green among them, the leading dark between.
    const glass = rng.fork(`glass${p.id}`), hues: [number, number, number][] = [[0.08, 0.18, 0.75], [0.7, 0.06, 0.06], [0.85, 0.62, 0.1], [0.08, 0.45, 0.18], [0.35, 0.1, 0.55]];
    // (A cathedral's windows are glazed in colour with its outside: see `cathedral.ts`.)
    for (const w of cath ? [] : outerWindows.get(p.id) ?? []) {
      const q = places[p.id], wf = frameOf(q, w.side, 0.1), c = alongFrame(q, w.side, w.at, 0.1), { y0, ys } = shape(w);
      const cols = Math.max(2, Math.round((w.halfWidth * 2) / 0.16)), rows = Math.max(4, Math.round((ys - y0) / 0.16)), cw = (w.halfWidth * 2) / cols, ch = (ys - y0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        // (A pattern, not noise: bands of colour across the window, the middle column picked out, a border of gold.)
        // (A slit only two panes across has no border: blue and red in bands up it, with a gold or a green one here and there.)
        const wide = cols >= 4, edge = wide && (i === 0 || i === cols - 1 || j === 0), centre = wide && Math.abs(i - (cols - 1) / 2) < 0.6;
        const odd = glass.int(0, 6);
        const hue = edge ? hues[2] : centre ? hues[(Math.floor(j / 2) % 2) + 0] : odd === 0 ? hues[3] : odd === 1 ? hues[2] : hues[(Math.floor(j / 3) + i) % 2 === 0 ? 0 : 1];
        const t = glass.range(0.8, 1.15);
        const pane = wallBox(wf, c - w.halfWidth + i * cw + 0.008, c - w.halfWidth + (i + 1) * cw - 0.008, y0 + j * ch + 0.008, y0 + (j + 1) * ch - 0.008, T * 0.5 - 0.01, T * 0.5 + 0.01);
        solid('stained', corners(pane), [hue[0] * t, hue[1] * t, hue[2] * t]);
      }
      // The leading behind the panes: one dark sheet, so the joints between them read as lead.
      solid('metal', corners(wallBox(wf, c - w.halfWidth, c + w.halfWidth, y0, ys, T * 0.5 + 0.012, T * 0.5 + 0.02)), [0.03, 0.03, 0.03]);
    }
    kit.group = was;
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
  const flightOf = (w: Way & { base?: number }) => {
    const steps = Math.max(1, Math.round((places[w.b].floor - places[w.a].floor - (w.base ?? 0)) / STEP)), to = w.to ?? w.at;
    return { steps, tread: Math.abs(to - w.at) / steps, dir: to >= w.at ? 1 : -1, wide: w.halfWidth * 2, to };
  };
  /**
   * A stair that climbs round the walls (`round`), as the straight flight of its last leg, which comes up through the floor above,
   * and how high over the lower floor that leg begins (`base`). A straight stair as it is.
   */
  const headLeg = (w: Way): Way & { base?: number } => {
    if (!w.round) return w;
    const { legs } = roundStair(site, w), last = legs[legs.length - 1];
    return { ...w, side: last.side, at: last.from, to: last.to, round: undefined, base: last.y0 };
  };
  // How many steps can be climbed before the head comes to the beams of the ceiling: the well must have begun by then.
  // (With room to spare: whoever climbs is a stride deep, front to back, as well as a man high.)
  const stepsUnderCeiling = (w: Way & { base?: number }) => Math.max(0, Math.floor((places[w.a].wall - 0.27 - 2.3 - (w.base ?? 0)) / STEP));
  /** Where a stair stands on the floor of the lower place, and the well it comes up through in the floor of the upper. */
  const flightRect = (w: Way): Rect => strip(places[w.a], w.side, w.at, flightOf(w).to, flightOf(w).wide);
  /** Of a stair round the walls, the floor its legs and landings stand over within the first three metres of its climb. */
  const lowLegs = (w: Way): Rect[] => {
    const { legs, landings, width } = roundStair(site, w), p = places[w.a];
    return [...legs.filter((l) => l.y0 < 3.2).map((l) => strip(p, l.side, l.from, l.to, width)), ...landings.filter((l) => l.y < 3.2)];
  };
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
  if (free && cath) for (const [id, list] of cathedralWindows(site)) outerWindows.set(id, list as OuterWindow[]);
  if (free && !cath) {
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
          // (The door to the forecourt has a bay standing forward round it, which a window must clear.)
          const doors = site.ways.filter((w) => (w.a === q.id || w.b === q.id) && sideOf(w, q) === side && w.kind !== 'stair')
            .map((w) => { const m = places[w.a === q.id ? w.b : w.a].role === 'approach' ? 2.3 : 0.9; return [w.at - w.halfWidth - m, w.at + w.halfWidth + m]; });
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
  // Other lights, decided with the torches: a hearth against a wall (kitchens always, some great rooms and chambers), a ring of candles
  // hung from the ceiling of a great room, a standing candelabrum in a corner of a chamber. Each burns as a torch does, lights its room
  // and is baked, and a room that has one has a torch fewer.
  const hearthOf = new Map<number, { side: Side; at: number }>(), ringOf = new Map<number, Vector3>(), standOf = new Map<number, Vector3>();
  const pilasterSlots = new Map<number, { pos: number; side: Side; clear: boolean }[]>();
  for (const p of places) {
    const slots: { pos: number; side: Side; clear: boolean }[] = [];
    if (p.roof === 'barrel') {
      const a0 = p.axis === 'x' ? p.x0 : p.z0;
      const length = p.axis === 'x' ? p.x1 - p.x0 : p.z1 - p.z0;
      // (In a church, the ribs mark its bays: between its arcade's arches where it has one, every six metres or so where it has not.
      // Under a vault of more than one span, they go over its columns, every three metres or so.)
      const sides: Side[] = p.axis === 'x' ? ['n', 's'] : ['w', 'e'];
      const arcade = cath ? site.ways.filter((w) => w.kind === 'arch' && (w.a === p.id || w.b === p.id) && sideOf(w, p) === sides[0]).map((w) => w.at).sort((a, b) => a - b) : [];
      const ribs = !cath ? Math.max(0, Math.round(length / 3.4) - 1) : arcade.length >= 2 ? arcade.length - 1 : Math.max(0, Math.round(length / ((p.spans ?? 1) > 1 ? 3.2 : 5.8)) - 1);
      for (let k = 1; k <= ribs; k++) {
        const pos = arcade.length >= 2 ? (arcade[k - 1] + arcade[k]) / 2 : a0 + (length * k) / (ribs + 1);
        for (const side of sides) {
          const clear = !holesOn(p, side, 0).some((h) => Math.abs(h.at - pos) < h.w + 0.95);
          slots.push({ pos, side, clear });
        }
      }
    }
    pilasterSlots.set(p.id, slots);

    const list: TorchSpec[] = [];
    const inward = (side: Side): Vector3 => ({ n: V(0, 0, 1), s: V(0, 0, -1), w: V(1, 0, 0), e: V(-1, 0, 0) })[side];
    if (p.roof !== 'sky') {
      const area = (p.x1 - p.x0) * (p.z1 - p.z0);
      // Torches where the site asks for them; a daylit room gets one only if it is large; a dark room, none. (A long hall, of two cells
      // of the plan, has more.)
      const lq = rng.fork(`lights${p.id}`), built = (p.roof === 'barrel' || p.roof === 'timber') && !p.fallen;
      const into: Record<Side, Vector3> = { n: V(0, 0, 1), s: V(0, 0, -1), w: V(1, 0, 0), e: V(-1, 0, 0) };
      const wallPoint = (side: Side, at: number) => (side === 'n' ? V(at, 0, p.z0) : side === 's' ? V(at, 0, p.z1) : side === 'w' ? V(p.x0, 0, at) : V(p.x1, 0, at));
      // A hearth: on a wall with three metres clear of doors, windows, a stair and a vault's pilasters, and room before it; under a
      // vault on an end wall, where the vault does not come down.
      const hearthChance = ({ kitchen: 1, refectory: 0.6, 'chapter house': 0.4, dormitory: 0.4, solar: 0.5, 'upper chamber': 0.4, gatehall: 0.3, 'muniment room': 0.3 } as Record<string, number>)[p.name] ?? 0;
      if (built && hearthChance && lq.chance(hearthChance)) {
        const options: { side: Side; at: number; score: number }[] = [];
        for (const side of SIDES) {
          if (p.roof === 'barrel' && !isEndWall(p, side)) continue;
          const along = side === 'n' || side === 's', lo = along ? p.x0 : p.z0, hi = along ? p.x1 : p.z1, deep = along ? p.z1 - p.z0 : p.x1 - p.x0;
          if (hi - lo < 3.4 || deep < 3.6) continue;
          const holes = holesOn(p, side, 0), stairs = [...stairsFrom(p), ...stairsInto(p)].filter((w) => w.side === side);
          for (const shift of [0, -1, 1, -2, 2]) {
            const at = (lo + hi) / 2 + shift;
            if (at - 1.6 < lo || at + 1.6 > hi) continue;
            if (holes.some((h) => Math.abs(h.at - at) < h.w + 1.55) || stairs.some((w) => Math.max(w.at, w.to ?? w.at) > at - 1.9 && Math.min(w.at, w.to ?? w.at) < at + 1.9)) continue;
            if (slots.some((sl) => sl.side === side && Math.abs(sl.pos - at) < 1.7)) continue;
            options.push({ side, at, score: -Math.abs(shift) + lq.next() * 0.5 });
            break;
          }
        }
        const best = options.sort((a, b) => b.score - a.score)[0];
        if (best) {
          hearthOf.set(p.id, { side: best.side, at: best.at });
          // (The fire: three flames along the logs, and the light over them.)
          const flames = [-0.2, 0.03, 0.22].map((o) => wallPoint(best.side, best.at + o).addScaledVector(into[best.side], 0.5).setY(p.floor + 0.34));
          list.push({ position: wallPoint(best.side, best.at).addScaledVector(into[best.side], 0.5).setY(p.floor + 0.75), out: into[best.side], fire: 1.25, flames });
        }
      }
      // A ring of candles hung over the middle of a great room, high enough to walk under and clear of the ceiling.
      // (In a cathedral, a great corona of candles in the nave, the choir and under the crossing, hung high on a long chain.)
      const ringChance = ({ refectory: 0.6, 'chapter house': 0.6, gatehall: 0.35, dormitory: 0.3, sanctum: 0.5, scriptorium: 0.4, solar: 0.3, ...(cath ? { nave: 1, choir: 0.85, crossing: 0.7, shrine: 0.6 } : {}) } as Record<string, number>)[p.name] ?? 0;
      const ceiling = p.roof === 'barrel' ? p.floor + p.wall + vaultRise(p) : p.floor + p.wall;
      if (built && area >= 26 && ceiling - p.floor >= 3.3 && ringChance && lq.chance(ringChance)) {
        const great = coronaOf(p), at = V((p.x0 + p.x1) / 2, great ? p.floor + 4.6 : Math.max(p.floor + 2.55, Math.min(ceiling - 0.8, p.floor + 3.0)), (p.z0 + p.z1) / 2);
        ringOf.set(p.id, at);
        const R = great ? 1.3 : 0.5, n = great ? 12 : 6;
        const wicks = Array.from({ length: n }, (_, k) => V(at.x + R * Math.cos((k / n) * Math.PI * 2), at.y + 0.2, at.z + R * Math.sin((k / n) * Math.PI * 2)));
        list.push({ position: at.clone().setY(at.y + 0.15), out: V(0, -1, 0), flames: wicks });
      }
      // A standing candelabrum in a corner clear of doors and stairs, and far enough along each wall from its middle to keep clear of
      // whatever stands against it there.
      const standChance = ({ sanctum: 0.7, 'chapter house': 0.4, vestry: 0.5, reliquary: 0.6, antechamber: 0.3, 'muniment room': 0.3, scriptorium: 0.3, ...(cath ? { shrine: 0.9, crypt: 0.8, chapel: 0.7, sacristy: 0.6, library: 0.5 } : {}) } as Record<string, number>)[p.name] ?? 0;
      if (built && standChance && lq.chance(standChance)) {
        const corners = [[p.x0 + 0.5, p.z0 + 0.5, 'w', 'n'], [p.x1 - 0.5, p.z0 + 0.5, 'e', 'n'], [p.x0 + 0.5, p.z1 - 0.5, 'w', 's'], [p.x1 - 0.5, p.z1 - 0.5, 'e', 's']] as [number, number, Side, Side][];
        const fits = corners.filter(([x, z, sx, sz]) => {
          if (Math.abs(x - (p.x0 + p.x1) / 2) < 1.9 || Math.abs(z - (p.z0 + p.z1) / 2) < 1.9) return false;
          if (holesOn(p, sx, 0).some((h) => Math.abs(h.at - z) < h.w + 1.0) || holesOn(p, sz, 0).some((h) => Math.abs(h.at - x) < h.w + 1.0)) return false;
          return ![...stairsFrom(p), ...stairsInto(p)].some((w) => { const r = flightRect(w); return x > r.x0 - 1.2 && x < r.x1 + 1.2 && z > r.z0 - 1.2 && z < r.z1 + 1.2; });
        });
        if (fits.length) {
          const [x, z] = lq.pick(fits), foot = V(x, p.floor, z);
          standOf.set(p.id, foot);
          const top = p.floor + 1.62, wicks = [V(x - 0.24, top, z), V(x, top + 0.1, z), V(x + 0.24, top, z)];
          list.push({ position: V(x, top + 0.1, z), out: V(0, -1, 0), flames: wicks });
        }
      }
      // Up a stair that climbs round the walls, a torch on the wall over every other landing, so that it is never dark long.
      // (On the wall of the leg that comes up to the landing, a little short of it: over its last steps, with headroom under it.)
      for (const w of stairsFrom(p).filter((x) => x.round)) {
        const { legs, landings } = roundStair(site, w);
        landings.forEach((l, k) => {
          const leg = legs[k];
          if (k % 2 === 1 || !leg) return;
          const along = leg.to - Math.sign(leg.to - leg.from) * 0.8, off = 0.24;
          const at = leg.side === 'n' ? V(along, 0, p.z0 + off) : leg.side === 's' ? V(along, 0, p.z1 - off) : leg.side === 'w' ? V(p.x0 + off, 0, along) : V(p.x1 - off, 0, along);
          list.push({ position: at.setY(p.floor + l.y + 2.3), out: inward(leg.side) });
        });
      }
      const extra = list.length;
      const want = Math.max(0, (p.roof === 'cave' ? 0 : p.light === 'torch' ? (area < 22 ? 1 : area < 50 ? 2 : area < 90 ? 3 : 4) : p.light === 'day' ? (area >= 90 ? 2 : area >= 40 ? 1 : 0) : 0) - (extra ? 1 : 0)) + extra;
      // Candidates: the front of each free pilaster, else the middle of each wall that has room.
      const candidates: TorchSpec[] = [];
      const onWall = (side: Side, at: number, off: number): TorchSpec => {
        const out = inward(side);
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
        for (const r of w.round && w.a === p.id ? lowLegs(w) : [flightRect(headLeg(w))]) {
          for (let i = candidates.length - 1; i >= 0; i--) { const c = candidates[i].position; if (c.x > r.x0 - 0.5 && c.x < r.x1 + 0.5 && c.z > r.z0 - 0.5 && c.z < r.z1 + 0.5) candidates.splice(i, 1); }
        }
      }
      // (Nor on the wall over a hearth.)
      const hearth = hearthOf.get(p.id);
      if (hearth) for (let i = candidates.length - 1; i >= 0; i--) {
        const c = candidates[i].position, along = hearth.side === 'n' || hearth.side === 's' ? c.x : c.z, on = hearth.side === 'n' ? Math.abs(c.z - p.z0) < 0.7 : hearth.side === 's' ? Math.abs(c.z - p.z1) < 0.7 : hearth.side === 'w' ? Math.abs(c.x - p.x0) < 0.7 : Math.abs(c.x - p.x1) < 0.7;
        if (on && Math.abs(along - hearth.at) < 2.0) candidates.splice(i, 1);
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
    // (For finding where the time goes: with DBG_T set, as `DBG_T=1 npx tsx tools/land.ts 1`, each stage says how long it took.)
    let __t = performance.now();
    const __T = (label: string) => { if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DBG_T) console.log('  ', label, (performance.now() - __t).toFixed(0), 'ms'); __t = performance.now(); };
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
      buildFront(p, fx0, fx1);
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
    // (In a valley that was found, the track graded: the land under its middle, cut and made up so that it nowhere climbs more steeply
    // than three in ten, as an island's way is. Where the found land has a step, above the gap where its walls draw in, the track
    // went up a bank of forty-five degrees and more, which nobody could walk up.)
    // (And the sides of a cutting, or of the bank the track is made up on, lie back by its depth: over six metres where it is shallow,
    // and over nearly twice its depth where it is deep, which is a slope a walker can climb; at six metres a cutting seven deep
    // had sides of fifty degrees.)
    const grade = vale?.terrain ? (() => {
      const z0 = Math.floor(p.z1 - 2), n = Math.ceil(vale.mouth + 30) - z0 + 1, g = new Float32Array(n), land = new Float32Array(n);
      for (let i = 0; i < n; i++) g[i] = land[i] = valleyLand(vale, p.floor, p, pathAt(z0 + i), z0 + i);
      const most = new Float32Array(n);
      for (let i = 0; i + 1 < n; i++) most[i] = 0.3 * Math.hypot(1, pathAt(z0 + i + 1) - pathAt(z0 + i));
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < n; i++) g[i] = Math.min(g[i - 1] + most[i - 1], Math.max(g[i - 1] - most[i - 1], g[i]));
        for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i + 1] + most[i], Math.max(g[i + 1] - most[i], g[i]));
      }
      const read = (a: Float32Array, z: number) => { const f = Math.min(n - 1.001, Math.max(0, z - z0)), i = Math.floor(f), t = f - i; return a[i] * (1 - t) + a[i + 1] * t; };
      return { at: (z: number) => read(g, z), fade: (z: number) => Math.max(6, 1.8 * Math.abs(read(g, z) - read(land, z))) };
    })() : null;
    const graded = grade?.at;
    /** How far the land about a castle is lowered, that its hill may stand: the hill's height near it, coming back to nothing over sixty metres. */
    const castleBasin = (x: number, z: number) => (site.castle ? site.castle.rise * (1 - smooth((castleOff(site.castle, x, z) - 10) / 60)) : 0);
    const swells = (x: number, z: number): number => {
      const fromPath = Math.max(0, Math.abs(x - pathAt(z)) - pathHalf);
      // (Level on the promontory a keep stands on, as a castle's court would be; swelling elsewhere as it always did.)
      // (Fading in over some metres, so that the ledge coming up to it meets it without a step.)
      const level = !keepShelf ? 1 : Math.max(smooth((Math.abs(z - (keepShelf.z0 + keepShelf.z1) / 2) - (keepShelf.z1 - keepShelf.z0) / 2 + 2) / 9), smooth((fromSide(keepShelf.side, x, z) - 4.7 - keepShelf.depth + 1) / 6));
      // (A valley that was found: its floor is the land, held at the meadow's level about the house and following the land further
      // down; not tilted across the track, which keeps the level the land has under its middle.)
      if (vale?.terrain) {
        const land = valleyLand(vale, p.floor, p, x, z), mid = graded ? graded(z) : valleyLand(vale, p.floor, p, pathAt(z), z), floor = land + (mid - land) * (1 - Math.min(1, fromPath / (grade ? grade.fade(z) : 6)));
        // (About a castle, only its own ground is held level: held across the whole head of the valley, as about a house, the level
        // met the land rising at the valley's sides in a bank, drawn as rock all round the head. And the castle stands on a hill: its
        // bailey level, a walk's breadth level outside its wall, and from there the ground falls away, some way in thirty metres, to
        // the land lowered by the hill's height about it, which comes back to itself over sixty metres more.)
        const c = site.castle;
        if (c) {
          const off = castleOff(c, x, z);
          if (off <= 0) return p.floor - 0.03;
          const low = floor - castleBasin(x, z);
          // (On a seat of its own, at the brow of the land over the valley, the ground about its wall comes back to the land within ten
          // metres: drawn out over thirty, as about a hill made for it, it stood out from the brow as a terrace.)
          return p.floor - 0.03 + (low - p.floor + 0.03) * smooth((off - 1.5) / (c.rise > 0 ? 30 : 10)) * level;
        }
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
    // (A building of brick stands in a street, deep from its front: it is set at the height of the ground before its door, so that the
    // street runs level to its step; any other at the height of the ground under its middle.)
    // Where a point is in a building's own measures: `u` along its front, `v` back from it. (By the bearing its front faces, which for
    // one standing square to the valley is east or west, and for one turned to face a road wherever it runs is its `turn`.)
    const frontOf2 = (b: { x: number; z: number; d: number; faces: 'e' | 'w'; turn?: number }, x: number, z: number) => {
      const th = b.turn ?? (b.faces === 'w' ? Math.PI : 0), c = Math.cos(th), sn = Math.sin(th), dx = x - b.x, dz = z - b.z;
      return { u: -dz * c + dx * sn, v: b.d / 2 - (dx * c + dz * sn) };
    };
    /** Back from a building's own measures to the world. */
    const fromFront = (b: { x: number; z: number; d: number; faces: 'e' | 'w'; turn?: number }, u: number, v: number): [number, number] => {
      const th = b.turn ?? (b.faces === 'w' ? Math.PI : 0), c = Math.cos(th), sn = Math.sin(th);
      return [b.x + u * sn + (b.d / 2 - v) * c, b.z - u * c + (b.d / 2 - v) * sn];
    };
    const frontOf = (b: Building) => { const turn = b.faces === 'w' ? 1 : -1; return swells(b.x - (turn * b.d) / 2 - turn * 1.2, b.z); };
    // (One turned to a road is given the larger of its two half breadths both ways, as anything that asks only how far it reaches across and along may.)
    // (`reach`: how far from its middle anything of it reaches, its wings and steps with it: past that and four and a half metres more,
    // a point's ground is not its.)
    // (A village's house, turned to face its road wherever it bends, is set into the slope it stands on, as houses on a hillside are: its
    // floor at the height of the ground before its door, so that one steps in from the road, and the land coming to its walls as it
    // lies, rising against its back wall where the slope goes up behind it and falling from it, onto its footing, where it goes down;
    // only the ground before its door, and along its sides near the front, is levelled with its floor. Its floor is raised only as much
    // as keeps the land behind it from rising more than a metre up its back wall, under its windows. Levelled all round at its middle's
    // height, as before, the ground before the house stood in a bank over the road, a stride high, and behind it fell away from it.)
    const setIn = (b: Building) => b.turn !== undefined && b.style === 'timber';
    const sitOf = (b: Building) => {
      const at = (u: number, v: number) => { const [x, z] = fromFront(b, u, v); return swells(x, z); };
      // (Over a half basement or a cellar, at the road before its door, whatever lies behind: that is what they are for.)
      if (b.sunk || b.cellar) return at(0, -1.5);
      let high = -Infinity;
      for (const [u, v] of [[-b.w / 2, b.d + 0.3], [0, b.d + 0.3], [b.w / 2, b.d + 0.3], [-b.w / 2 - 0.3, b.d / 2], [b.w / 2 + 0.3, b.d / 2]]) high = Math.max(high, at(u, v));
      return Math.max(at(0, -1.5), high - 1.0);
    };
    const houses = (site.grounds ? site.buildings ?? [] : []).map((b) => { const hx = b.d / 2 + (b.style === 'imperial' ? 2.0 : 0.6), hz = b.w / 2 + 0.5, big = Math.max(hx, hz), rects = footprintOf(b); return { ...b, set: setIn(b), base: b.style === 'brick' ? frontOf(b) : setIn(b) ? sitOf(b) : swells(b.x, b.z), hx: b.turn !== undefined ? big : hx, hz: b.turn !== undefined ? big : hz, rects, reach: Math.max(...rects.map((r) => Math.max(Math.hypot(r.u0, r.v0 - b.d / 2), Math.hypot(r.u1, r.v0 - b.d / 2), Math.hypot(r.u0, r.v1 - b.d / 2), Math.hypot(r.u1, r.v1 - b.d / 2)))) + 4 }; });
    /** How near a point is to the village's houses and the castle's wall, for what grows: whether it is within `m` metres of either. */
    const nearBuilt = (x: number, z: number, m: number) => (!!site.castle && castleOff(site.castle, x, z) < m + 6) || houses.some((b) => Math.abs(x - b.x) + Math.abs(z - b.z) < (b.reach + m) * 1.415 && outside(b, x, z) < m);
    // Whether a point is under a building, within its outer walls.
    // Whether a point is under a building, within its outer walls (wings and all).
    const footprint = (b: (typeof houses)[number], x: number, z: number) => {
      const { u, v } = frontOf2(b, x, z);
      return b.rects.some((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1);
    };
    // (With room about it: half a metre, and before a classical building's door the depth of its steps. A dressed one's steps stand
    // before whatever stands forward, its middle or its pavilions, and are as deep as its plinth is high.)
    const outside = (b: (typeof houses)[number], x: number, z: number) => {
      const { u, v } = frontOf2(b, x, z);
      const run = b.dress ? Math.max(1.45, stepsUp(plinthOf(b)).run + 0.1) : 1.45;
      return Math.min(...b.rects.map((r, i) => Math.max(r.u0 - u, u - r.u1, (b.style === 'imperial' && (i === 0 || (b.dress && r.v1 <= 0)) ? r.v0 - run : r.v0) - v, v - r.v1))) - 0.55;
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
          // (Past the doorway a little more than the hall's own walls, so that this rock lies behind them: cut to the same faces, the
          // two lay one on the other and flickered, and the land's rock showed through in bright jagged pieces.)
          const a = hallAir(q, t, off, y) + 0.25 * smooth((t - 0.6) / 1.2);
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
    /**
     * How much of a crag a found valley's side has at a point, 0 to 1. Its sides were a crag all the way round, six to twenty metres
     * of rock raised along the line where the land had risen four metres over the stream, and on the land beyond, a rise of its own:
     * every valley a quarry cut into the country, its walls nothing the land had made (asked for: let the found land stand, and keep
     * the player in by walls that are not seen). Now the land the valley was found in is its sides, and rock stands only where
     * something needs a face of rock: a cave or a hall cut into the side, the passage behind it to the cavern, a stream coming over
     * the rim in a fall, a terrace built against the wall, and the head of the valley about the house, whose ridge and arms are the
     * valley's own. It dies away over some twenty metres from each. Read along each side, a metre at a time, once.
     */
    const cragOn = vale?.terrain ? (() => {
      const zA = Math.floor(vale.z0 - 60), n = Math.ceil(vale.mouth + 120 - zA) + 1, on = { w: new Float32Array(n), e: new Float32Array(n) };
      const near = (side: 'w' | 'e', z0: number, z1: number) => {
        for (let i = 0; i < n; i++) {
          const z = zA + i, d = Math.max(0, z0 - z, z - z1);
          on[side][i] = Math.max(on[side][i], 1 - smooth((d - 2) / 18));
        }
      };
      // (Not about a castle, which stands free on the open ground at the valley's head: there the head's sides are the land's too.)
      if (!site.castle) for (let i = 0; i < n; i++) on.w[i] = on.e[i] = 1 - smooth((zA + i - frontZ - 10) / 22);
      for (const q of grottoes) { const reach = q.hall ? q.hall.width / 2 + 6 : q.r * 1.3 + 5; near(q.side, q.z - reach, q.z + reach); }
      for (const t of terraces) near(t.side, Math.min(t.z0, t.z1) - t.run - 3, Math.max(t.z0, t.z1) + t.run + 3);
      for (const st of site.streams ?? []) if (st.from === 'fall' && st.course.length) {
        const [fx, fz] = st.course[0];
        near(fx < (sideAt('w', fz) + sideAt('e', fz)) / 2 ? 'w' : 'e', fz - 6, fz + 6);
      }
      const dp = site.backWay?.deep, cave = site.grottoes?.[0];
      if (dp?.join && cave) { const zs = joinLine(vale, cave, dp).map(([, z]) => z); near(cave.side, Math.min(...zs) - 4, Math.max(...zs) + 4); }
      return (x: number, z: number) => {
        const side = x < (sideAt('w', z) + sideAt('e', z)) / 2 ? 'w' : 'e', f = Math.min(n - 1.001, Math.max(0, z - zA)), i = Math.floor(f), t = f - i;
        return on[side][i] * (1 - t) + on[side][i + 1] * t;
      };
    })() : null;
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
      // (Where two houses' levelled ground meets, the nearer house's is the ground: laid one after the other, the later pulled the ground
      // at the walls of the one before to its own level, and on a slope the earlier stood a metre over the ground at its side.)
      let lay: { k: number; d: number; y: number } | null = null;
      for (const b of houses) {
        // A building on level ground has it levelled about it. One set into rising ground has the ground about it rise from its
        // front to its back, as much as the document says, and stand at that height behind it for some way before it gives back to the land.
        if ((!b.sunk || b.set) && Math.abs(x - b.x) + Math.abs(z - b.z) > (b.reach + (b.set ? 7.5 : 4.6)) * 1.415) continue;
        const d = outside(b, x, z), sunk = b.sunk ?? 0, { u, v } = frontOf2(b, x, z);
        let k: number;
        if (b.set && (b.sunk || b.cellar)) {
          // Over a half basement or a cellar: level with its floor before its door, rising (or falling) along its sides to the height
          // of its back door, and a yard at that height behind it, some three metres deep, before the land.
          const before = Math.max(0, -v), aside = Math.max(0, Math.abs(u) - b.w / 2), behind = Math.max(0, v - b.d);
          if (before > 4.5 || aside > 3.5 || behind > 7) continue;
          k = (1 - smooth((before - 1.4) / 2.6)) * (1 - smooth((aside - 0.6) / 2.4)) * (1 - smooth((behind - 3.2) / 3.2));
        } else if (b.set) {
          const before = Math.max(0, -v), aside = Math.max(0, Math.abs(u) - b.w / 2), back = Math.max(0, v - 0.6);
          if (before > 4.5 || aside > 3) continue;
          k = (1 - smooth((before - 1.4) / 2.6)) * (1 - smooth((aside - 0.4) / 2.2)) * (1 - smooth(back / 2.2));
        } else if (!sunk) {
          if (d > 4.5) continue;
          k = 1 - smooth((d - 0.9) / 3.2);
        } else {
          // (Behind it the risen ground runs on back towards the valley's side, as a hillside does, and gives way to the land only at its sides and far back.)
          const aside = Math.abs((b.faces === 'w' ? 1 : -1) * (z - b.z)) - b.hz;
          // (Before it the ground is level for the depth of its steps and more, as before any building.)
          if (v < -9 || aside > 14 || v > b.d + 38) continue;
          k = v < 0 ? 1 - smooth((Math.max(aside, -v - 2.4) - 0.9) / 3.2) : (1 - smooth((aside - 1.2) / 11)) * (1 - smooth((v - b.d - 22) / 16));
        }
        // (A cellar's ground falls from the front to the back as a half basement's rises.)
        const to = b.cellar ? -b.cellar * smooth(v / b.d) : groundOf(b, v, u);
        if (!lay || k > lay.k + 1e-6 || (k > lay.k - 1e-6 && d < lay.d)) lay = { k, d, y: b.base + to };
      }
      if (lay) { y += (lay.y - y) * lay.k; even = Math.min(even, 1 - lay.k); }
      for (const t of towers) {
        const d = Math.max(Math.abs(x - t.x), Math.abs(z - t.z));
        if (d > t.half + 5) continue;
        // (Giving way to the track's own ground beside it: a tower is set back from the track, but the corners of its levelled ground
        // reach further than its sides, and where the track was cut deep into the land the corner of a tower's ground, at the land's
        // height, stood as a bank across it.)
        const k = (1 - smooth((d - t.half - 1.9) / 2.8)) * smooth((fromPath - 0.3) / 2.5);
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
        // (In a valley that was found, only where something needs the rock: see `cragOn`.)
        const crag = cragOn ? cragOn(x, z) : 1;
        y += high * crag * (1 - smooth((ins - 4.7 + spread + wobble) / spread)) * (free ? 1 : z < frontZ ? 1 - ownHill : smooth((z - (frontZ - 0.3)) / 2.2) + (1 - smooth((z - (frontZ - 0.3)) / 2.2)) * (1 - ownHill));
        // Behind the crags the land does not lie flat, as round a quarry: it goes on up, as a hillside, more on some sides
        // than on others. (North of the house front the hills keep the distance they always kept from it.)
        const out = Math.max(0, -inside), north = Math.max(0, aside - 3), t = smooth((z - (frontZ - 2)) / 14), beyond = ridge ? (z < ridge.z && x > ridge.x0 && x < ridge.x1 ? 0 : out) : free ? out : north + (out - north) * t;
        const stands = 0.55 + 0.9 * fbm2(x * 0.008 + s2 + 9, z * 0.008 - s1, 2);
        // (A valley that was found has the land it was found in beyond its sides, rising behind the crags: not hills made up.)
        // (Behind its crags too the ground goes on up, as behind a drawn valley's, a little less; under that the land it was found in.
        // Where that land rose less than the crag stood, the top of the crag was left as a level shelf: the rim of a quarry.)
        // (Lowered as the floor is about a castle's hill, or the two met at the valley's side in a step its height.)
        if (vale.terrain) { y += smooth((beyond - 2) / 90) * 15 * stands * crag; if (inside < 0) y = Math.max(y, valleyLand(vale, p.floor, p, x, z) - castleBasin(x, z) + 0.5 * smooth(-inside / 6) * crag); }
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
    // (The sheet's cell, and the carving's, which divides it; the lattice the band is worn on stays at 0.3 whatever they are.)
    const SHEET = VALLEY_GROUND.sheet, CELL = SHEET / Math.max(1, Math.round(SHEET / 0.3)), WORN = 0.3;
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
      // (Rows and columns of the band as near 9.6 and 2.4 metres as whole cells of the sheet allow.)
      const zEnd = snapTo(vale.mouth + 19, true), ROW = SHEET * Math.round(9.6 / SHEET), COL = SHEET * Math.round(2.4 / SHEET);
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
    __T('the shape of the valley, its track and ground');
    const land = new Grid2(lx0, lz0, WORN, Math.round((lx1 - lx0) / WORN) + 1, Math.round((lz1 - lz0) / WORN) + 1);
    const known = new Uint8Array(land.data.length);
    // In front of the house the meadow runs level up to the wall; the scarp behind the wall is not this piece's business.
    const wallEnds = (x: number) => smooth((Math.min(x - (p.x0 - 0.2), p.x1 + 0.2 - x) + 0.7) / 0.7);
    for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
      const x = land.x0 + i * WORN, z = land.z0 + j * WORN;
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
      const far = new Float32Array(land.data.length), nxL = land.nx, nzL = land.nz, D1 = WORN, D2 = WORN * Math.SQRT2;
      for (let j = 0; j < nzL; j++) for (let i = 0; i < nxL; i++) far[j * nxL + i] = i > 0 && j > 0 && i < nxL - 1 && j < nzL - 1 && inBandPatch(land.x0 + i * WORN, land.z0 + j * WORN, 1e-6) ? 1e6 : 0;
      for (let j = 1; j < nzL - 1; j++) for (let i = 1; i < nxL - 1; i++) { const o = j * nxL + i; if (far[o]) far[o] = Math.min(far[o], far[o - 1] + D1, far[o - nxL] + D1, far[o - nxL - 1] + D2, far[o - nxL + 1] + D2); }
      for (let j = nzL - 2; j > 0; j--) for (let i = nxL - 2; i > 0; i--) { const o = j * nxL + i; if (far[o]) far[o] = Math.min(far[o], far[o + 1] + D1, far[o + nxL] + D1, far[o + nxL + 1] + D2, far[o + nxL - 1] + D2); }
      depthInBand = (x, z) => far[Math.min(nzL - 1, Math.max(0, Math.round((z - land.z0) / WORN))) * nxL + Math.min(nxL - 1, Math.max(0, Math.round((x - land.x0) / WORN)))];
      const before = land.data.slice();
      const active = new Uint8Array(land.data.length);
      const foot = land.like();
      for (let j = 0; j < land.nz; j++) for (let i = 0; i < land.nx; i++) {
        const x = land.x0 + i * WORN, z = land.z0 + j * WORN, o = j * land.nx + i;
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
          const x = land.x0 + (o % land.nx) * WORN, z = land.z0 + Math.floor(o / land.nx) * WORN;
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
          const x = land.x0 + (o % land.nx) * WORN, z = land.z0 + Math.floor(o / land.nx) * WORN;
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
        const gx = e > w ? (H[e] - H[w]) / ((e - w) * WORN) : 0, gz = s > n ? (H[s] - H[n]) / (((s - n) / nxL) * WORN) : 0;
        const slope = Math.hypot(gx, gz);
        steepness.data[o] = Math.sqrt(1 + slope * slope);
        upX.data[o] = gx; upZ.data[o] = gz;
        raw[o] = smooth((slope - 0.85) / 0.6) * (1 - smooth(loose.data[o] / 0.3));
        // (Not over the track: where the land's walls come close to it, as they can above the gap, the blocks and buttresses carved out
        // of a rocky face stood out across it, and stopped whoever walked up from the gap. There the rock is the land's own surface.)
        if (vale) {
          const x = land.x0 + i * land.cell, z = land.z0 + j * land.cell;
          if (z > p.z1 - 2 && z < vale.mouth + 4) raw[o] *= smooth((Math.abs(x - pathAt(z)) - pathHalf - 1.2) / 1.8);
        }
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
    // The street of a town: the ground before each house of brick, from its front to beyond the middle of the track, and the lanes
    // between; trodden bare, with nothing growing on it. 1 in the street, fading to 0 over a stride or two about it.
    const lots = houses.filter((b) => b.style === 'brick' && b.brickwork?.kind !== 'church').map((b) => {
      const turn = b.faces === 'w' ? 1 : -1, fx = b.x - (turn * b.d) / 2;
      return { turn, fx, z0: b.z - b.w / 2 - 0.6, z1: b.z + b.w / 2 + 0.6, reach: Math.abs(fx - pathAt(b.z)) + 2.2 };
    });
    const street = (x: number, z: number): number => {
      let s = 0;
      for (const q of lots) {
        const before = (q.fx - x) * q.turn;
        if (before < -0.5 || before > q.reach + 2 || z < q.z0 - 2 || z > q.z1 + 2) continue;
        s = Math.max(s, 1 - smooth(Math.max(q.z0 - z, z - q.z1, before - q.reach, 0) / 1.6));
      }
      return s;
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
      // in the street of a town, trodden earth and stones, greener at its edges and here and there;
      if (lots.length) bare = Math.max(bare, street(x, z) * (0.72 + 0.22 * fbm2(x * 0.4 + s1, z * 0.4 - s2, 2)));
      lay.bare = bare;
      lay.wet = wet;
      // And where the track is: how far to one side of its middle, plus a hundred; nothing if it is nowhere near.
      const off = trackOff(x, z);
      // (On a footpath, how far from its middle plus two hundred: the material for ground tells the one from the other.)
      const foot = offFoot(x, z);
      lay.track = Math.abs(off) < 6 ? 100 + off : foot < 3 ? 200 + foot : 0;
      // The castle's bailey is trodden earth, worn bare where people and carts go and greener along the foot of its walls.
      if (site.castle) {
        const off = castleOff(site.castle, x, z);
        if (off < 0) lay.bare = Math.max(lay.bare, (0.62 + 0.3 * fbm2(x * 0.35 + 3.1, z * 0.35, 2)) * smooth((-off - site.castle.thick / 2 - 0.6) / 2.2));
      }
      // The village's square is trodden earth; half its plots are gardens, in beds of dug earth with paths between.
      const vl = site.village;
      if (vl?.square && inPolygon(vl.square, x, z)) { lay.bare = Math.max(lay.bare, 0.75 + 0.15 * fbm2(x * 0.4, z * 0.4, 2)); return turfColour(x, z, s1); }
      if (vl) for (const [n, pl] of vl.plots.entries()) if (n % 2 === 0 && inPolygon(pl, x, z)) {
        const row = Math.abs((((x * 0.7 + z * 0.3) % 1.4) + 1.4) % 1.4 - 0.7);
        lay.bare = Math.max(lay.bare, smooth((row - 0.15) / 0.12) * 0.9);
        break;
      }
      // In a field, its crop: ploughed earth where it lies fallow, and roots in rows with the earth between.
      const fi = fieldList.length ? fieldAt(x, z) : -1;
      if (fi >= 0) {
        const f = fieldList[fi], tc = cropTint(f.crop), c = turfColour(x, z, s1);
        if (f.crop === 'fallow') lay.bare = Math.max(lay.bare, 0.7 + 0.2 * fbm2(x * 0.3, z * 0.3, 2));
        if (f.crop === 'roots') { const row = Math.abs((((x * 0.6 + z * 0.08) % 1.6) + 1.6) % 1.6 - 0.8); lay.bare = Math.max(lay.bare, smooth((row - 0.3) / 0.2) * 0.85); }
        return [c[0] * tc[0], c[1] * tc[1], c[2] * tc[2]];
      }
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
        // (Where a rim patch meets the sheet of ground, it is closed on the sheet's own edge, which runs on lines a cell apart.)
        edge: onSheet ? alongSheet(ground, 0, 0, SHEET) : undefined,
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
    __T('the land lattice and the rock along the sides');
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
    // Nothing wild grows in the fields: their crops are planted by themselves, below. In a pasture, its grass only.
    let cropping = false;
    const vlg = site.village;
    if (fieldList.length || vlg || site.castle) planting.keepOut = (set, x, z) => {
      if (cropping) return false;
      // (In the bailey, trodden as it is, no flowers, ferns or herbs; grass only along the foot of the walls, where nobody walks.)
      if (site.castle) { const off = castleOff(site.castle, x, z); if (off < 0) return set !== planting.grass || off < -(site.castle.thick / 2 + 1.6); }
      if (vlg?.square && inPolygon(vlg.square, x, z)) return true;
      if (vlg) for (const [n, pl] of vlg.plots.entries()) if (n % 2 === 0 && inPolygon(pl, x, z)) return set !== planting.herbs || Math.abs((((x * 0.7 + z * 0.3) % 1.4) + 1.4) % 1.4 - 0.7) > 0.2;
      const k = fieldList.length ? fieldAt(x, z) : -1;
      return k >= 0 && (fieldList[k].crop !== 'pasture' || set !== planting.grass);
    };
    // (And in winter the broadleaf trees are bare: what they keep is the brown of an oak's dead leaves, and far off the grey-brown haze
    // of their twigs; the grass is straw, mostly under the snow, and nothing flowers.)
    const winter = season === 'winter';
    const greens: Colour[] = season === 'autumn'
      ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
      : season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]]
      : winter ? [[0.19, 0.16, 0.15], [0.16, 0.14, 0.13], [0.21, 0.18, 0.16]]
      : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
    const parched = season === 'autumn' ? 0.55 : season === 'summer' ? 0.25 : winter ? 0.85 : 0;
    const inFlower = season === 'spring' ? 1 : season === 'summer' ? 0.6 : winter ? 0 : 0.15;
    // (Winter's grass is dead and pale, the colour of straw, whatever the turf would make it; and lies half as high, bent under the snow.)
    // (Yellow, as dead grass goes: grey-olive, as it first was, read as grass still green under a dull sky.)
    const straw = (c: Colour, tone = 1): Colour => (winter ? [0.46 * tone, 0.36 * tone, 0.15 * tone] : c);
    const lowered = winter ? 0.5 : 1;
    // (A number between 0 and 1 of a point's own, for choices that must not take from `plant`, which would reshuffle all that follows.)
    const own01 = (x: number, z: number, salt: number) => { const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453; return v - Math.floor(v); };
    const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
    const blossom: Colour = [0.85, 0.2, 0.38];
    const firs: Colour[] = [[0.045, 0.13, 0.04], [0.06, 0.15, 0.04], [0.04, 0.11, 0.05]];
    // (A conifer in winter keeps its needles, and snow lies on its boughs: two in five of its sprays are white.)
    const SNOWED: Colour = [0.74, 0.77, 0.82];
    const needleOf = (base: Colour) => (winter ? (q: Rng): Colour => (q.chance(0.4) ? leafOf(SNOWED)(q) : leafOf(base)(q)) : leafOf(base));
    // Trees used to be a pole with balls of leaves on it, drawn from the same streams of chance
    // as everything planted after them. Those crowns are still drawn, into nothing, so that all
    // that follows stands where it stood; the trees themselves are now grown, each from a
    // stream of its own.
    const spent = new Planting();
    let grown = 0;
    const oakBark: Colour = [0.66, 0.58, 0.5], ashBark: Colour = [0.86, 0.84, 0.8];
    let planted = 0;
    // (Within a castle's bailey, one: an old tree in a castle's yard is as it should be, and five were an orchard. Each is still dealt
    // from the stream, into nothing, so that all after it stands where it stood.)
    const meadowTrees = site.castle ? 1 : 5;
    for (let tries = 0; tries < 60 && planted < 5; tries++) {
      const x = r.range(p.x0 + 4.5, p.x1 - 4.5), z = r.range(p.z0 + 4, p.z1 - 3);
      if (Math.abs(x - pathAt(z)) < 3.6) continue;
      if (trees.some((t) => Math.hypot(t[0] - x, t[1] - z) < 5.5) || !clearOfStones(x, z, 1.2)) continue;
      const base = ground(x, z);
      const height = r.range(5.2, 7.6), girth = r.range(0.19, 0.28);
      const tall = height * 1.25, oak = grown % 3 !== 1;
      if (planted < meadowTrees) kit.mass(V(x - girth * 0.6, base, z - girth * 0.6), V(x + girth * 0.6, base + tall * (oak ? 0.3 : 0.48), z + girth * 0.6));
      const green = leafOf(plant.pick(greens));
      spent.broadleaf(x, base, z, height + 0.4, r.range(2.3, 3.1), 620, green, plant, 0.72);
      if (planted < meadowTrees) growTree(planting, kit.mesh(oak ? 'bark' : 'barkAsh'), x, base, z, tall, girth * 1.25, { kind: oak ? 'oak' : 'ash', detail: 1, cards: winter ? (oak ? 60 : 0) : 1500, cardSize: 0.74, leaf: winter ? leafOf([0.3, 0.18, 0.09]) : green, bark: oak ? oakBark : ashBark, soft: woodOf(oak ? 'oak' : 'ash', true), bare: winter }, rng.fork(`tree${grown++}`));
      else grown++;
      trees.push([x, z]);
      planted++;
    }

    __T('the meadow, the head, crags and stones');
    // ---- the ground beyond the meadow: a fine sheet over the valley and its rim, a coarse one
    // out to the hills, and mountains behind them
    // (The fine sheet's edges lie on six-metre lines, where it is eased onto the coarse one, and on its own cells' lines, where what is
    // carved ends: on the first lines that are both. For a cell of 1.2, every six metres; for 0.8, every twenty-four.)
    let every = 6;
    while (Math.abs(every / SHEET - Math.round(every / SHEET)) > 1e-6 && every < 600) every += 6;
    const snap = (v: number, up: boolean) => (up ? Math.ceil(v / 6) : Math.floor(v / 6)) * 6;
    const snapFine = (v: number, up: boolean) => (up ? Math.ceil(v / every) : Math.floor(v / every)) * every;
    const fine = { x0: snapFine(g.x0 - 34, false), x1: snapFine(g.x1 + 34, true), z0: snapFine(Math.min(houseZ0 - 40, g.z0 - 34), false), z1: snapFine(g.z1 + 34, true) };
    // (And of that box, only the blocks within reach of the valley: within thirty-four metres of its sides, as the box is of its ends,
    // or of the house. The coarse sheet lies on the rest. A valley that runs down from a castle's seat on a slant across a hillside has
    // a box a third larger than itself, and the fine sheet over all of it doubled the time a valley took to build.)
    const BLOCK = every, bnx = Math.round((fine.x1 - fine.x0) / BLOCK), bnz = Math.round((fine.z1 - fine.z0) / BLOCK), reachFine = 34 + BLOCK * 0.71;
    const fineMask = new Uint8Array(bnx * bnz);
    for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) {
      const x = fine.x0 + (i + 0.5) * BLOCK, z = fine.z0 + (j + 0.5) * BLOCK;
      const nearHouse = Math.max(houseX0 - x, x - houseX1, houseZ0 - z, z - p.z1) < 40 + BLOCK * 0.71;
      fineMask[j * bnx + i] = !vale || nearHouse || insideAt(x, z) > -reachFine ? 1 : 0;
    }
    const fineBlock = (i: number, j: number) => i >= 0 && j >= 0 && i < bnx && j < bnz && fineMask[j * bnx + i] === 1;
    /** Whether a point is where the fine sheet is laid. */
    const inFineSheet = (x: number, z: number) => fineBlock(Math.floor((x - fine.x0) / BLOCK), Math.floor((z - fine.z0) / BLOCK));
    /** How far inside the fine sheet a point is, from the nearest edge of it: up to a block's breadth. */
    const fineInside = (x: number, z: number) => {
      const i = Math.floor((x - fine.x0) / BLOCK), j = Math.floor((z - fine.z0) / BLOCK);
      let best = Math.min(x - fine.x0, fine.x1 - x, z - fine.z0, fine.z1 - z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if ((!di && !dj) || fineBlock(i + di, j + dj)) continue;
        const bx0 = fine.x0 + (i + di) * BLOCK, bz0 = fine.z0 + (j + dj) * BLOCK;
        best = Math.min(best, Math.hypot(Math.max(bx0 - x, 0, x - bx0 - BLOCK), Math.max(bz0 - z, 0, z - bz0 - BLOCK)));
      }
      return best;
    };
    /** The ground as the coarse sheet's corners have it, every six metres, and between them as a plane. */
    const coarse6 = (x: number, z: number) => {
      const gx = Math.floor(x / 6) * 6, gz = Math.floor(z / 6) * 6, fx = (x - gx) / 6, fz = (z - gz) / 6;
      return ground(gx, gz) * (1 - fx) * (1 - fz) + ground(gx + 6, gz) * fx * (1 - fz) + ground(gx, gz + 6) * (1 - fx) * fz + ground(gx + 6, gz + 6) * fx * fz;
    };
    // Near its edge the fine sheet is eased onto the coarse one's corners, so the two meet exactly.
    const eased = (x: number, z: number): number => {
      const inside = fineInside(x, z);
      const y = ground(x, z);
      if (inside >= 6) return y;
      const coarse = coarse6(x, z);
      return coarse + (y - coarse) * smooth(inside / 6);
    };
    const overlaps = (c: { x0: number; x1: number; z0: number; z1: number }, x0: number, x1: number, z0: number, z1: number) => c.x1 > x0 && c.x0 < x1 && c.z1 > z0 && c.z0 < z1;
    const terrain = { seed: s1, stone: stoneTint, turfScale: 2.3, rockScale: 0.4, colour: (x: number, z: number) => { const c = turfAt(x, z); return [c[0], c[1], c[2], lay.track, lay.wet, lay.bare, 0]; }, rock: (tone: number) => rockColour(tone * 0.8), bare: 0.62 };
    layTerrain(sceneryMesh('turf'), sceneryMesh('rockSheet'), eased, {
      ...terrain, area: fine, cell: SHEET,
      // Not where the land is carved, and not over the house: there it is the turf of the hill
      // above the vaults, left open over every court. Carved patches end on this sheet's own
      // lines, so a cell is either wholly carved or not at all.
      // Nor across the line of the house front, where the ground drops from the hill to the
      // meadow behind the wall: a cell lying across that would be a ramp through the doorway.
      skip: (c) => {
        const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
        if (!inFineSheet(mx, mz)) return true;
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
          const { u, v } = frontOf2(b, x, z);
          const within = (pu: number, pv: number) => b.rects.some((r) => pu > r.u0 + 0.01 && pu < r.u1 - 0.01 && pv > r.v0 + 0.01 && pv < r.v1 - 0.01);
          let best: [number, number] = [u, v], least = Infinity;
          for (const r of b.rects) {
            const cu = Math.min(r.u1, Math.max(r.u0, u)), cv = Math.min(r.v1, Math.max(r.v0, v));
            for (const [pu, pv] of [[r.u0 - 0.02, cv], [r.u1 + 0.02, cv], [cu, r.v0 - 0.02], [cu, r.v1 + 0.02]] as [number, number][]) {
              const d = Math.hypot(pu - u, pv - v);
              if (d < least && !within(pu, pv)) { least = d; best = [pu, pv]; }
            }
          }
          [x, z] = fromFront(b, best[0], best[1]);
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
    // Each sheet ends where a finer one begins, and none lies over another at its own height. (The far land's ring began two hundred
    // and fifteen metres from the meadow, inside the coarse sheet's square, and once the valley had grown long enough for a castle, a
    // village, fields and a forest, inside the fine sheet too, where the player arrives. Lying one on another at nearly the same height,
    // whichever stood the higher showed, a cell at a time: hard-edged pieces of two grounds, and steps of light and shade.) So the far
    // land begins beyond the fine sheet's farthest corner, and the coarse sheet fills what lies between, out to that circle and on
    // under the far land's first thirty metres, where the far land is let into it in patches (`ringShare` in the far material), and
    // no further: its corners beyond drawn in onto the circle there. Under the far land it lies a metre and a quarter lower than its
    // own ground, so that the far land is always the higher where both are drawn, and the ground shows only where the far land lets it.
    // (Ending at the ring itself, the far land's patches there opened onto the sky.)
    const farRing = Math.max(FAR_RING, Math.ceil(Math.max(...([[fine.x0, fine.z0], [fine.x1, fine.z0], [fine.x0, fine.z1], [fine.x1, fine.z1]] as const).map(([x, z]) => Math.hypot(x - cxA, z - czA))) + 6));
    const UNDER = 30, coarseEnd = farRing + UNDER;
    const reach = Math.max(246, snap(coarseEnd + 3, true));
    const ringOut = (x: number, z: number) => Math.hypot(x - cxA, z - czA) - farRing;
    // (Where it meets the fine sheet, along the edge of one of its blocks, it is the plane between the corners, as the fine sheet is
    // eased to there: its own points between those corners, at the ground's own height, stood a hand over or under the fine sheet's edge.)
    const meetsFine = (x: number, z: number) => inFineSheet(x + 0.01, z + 0.01) || inFineSheet(x - 0.01, z + 0.01) || inFineSheet(x + 0.01, z - 0.01) || inFineSheet(x - 0.01, z - 0.01);
    const underFar = (x: number, z: number) => (meetsFine(x, z) ? coarse6(x, z) : ground(x, z)) - 1.25 * smooth(ringOut(x, z) / 4);
    layTerrain(sceneryMesh('turf'), sceneryMesh('rockSheet'), underFar, {
      ...terrain, area: { x0: snap(cxA - reach, false), x1: snap(cxA + reach, true), z0: snap(czA - reach, false), z1: snap(czA + reach, true) }, cell: 3,
      warp: (x, z) => { const out = ringOut(x, z) - UNDER; if (out <= 0) return [x, z]; const k = coarseEnd / (out + coarseEnd); return [cxA + (x - cxA) * k, czA + (z - czA) * k]; },
      // (Out here what is steeper than a hillside can be walked is rock. As turf, the banks beyond the valley's mouth were smooth
      // rounded pillars the colour of the season's grass, with nothing growing on them: the sheet is too coarse to be a slope of
      // grass, and nothing is planted on ground so steep. As rock they are low crags, which is what such banks are.)
      // (Where the valley was found its hills are the land's own, with long slopes of forty and fifty degrees that are turf and
      // trees in such country; at six metres to a cell they came out as grey slabs. There only the steepest is bare.)
      bare: vale?.terrain ? 0.42 : 0.8,
      skip: (c) => inFineSheet((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2) || [ringOut(c.x0, c.z0), ringOut(c.x1, c.z0), ringOut(c.x0, c.z1), ringOut(c.x1, c.z1)].every((d) => d >= UNDER),
    });
    __T('the fine and coarse sheets');
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
    // (In a world, its hills are the world's out to the last ring: the world goes on, and has its own ranges.)
    const hills = vale?.terrain?.world ? (x: number, z: number) => valleyLand(vale, p.floor, p, x, z) : vale?.terrain ? (x: number, z: number) => {
      const out = Math.hypot(x - cxA, z - czA), found = valleyLand(vale, p.floor, p, x, z, out), w = smooth((out - 480) / 650);
      return w <= 0 ? found : found + (Math.max(found, ranges(x, z)) - found) * w;
    } : ranges;
    const landmarks = (site.landmarks ?? []).map((l) => {
      const top = crestAt(hills, cxA, czA, (l.angle * Math.PI) / 180, l.range === 'near' ? 255 : 400, l.range === 'near' ? 330 : 540);
      return { ...l, ...top, r: l.kind === 'castle' ? 40 : l.kind === 'ruin' ? 36 : 19 };
    });
    // (Not in the world's lakes, which lie in the low hollows these trees like best: they stood up out of the water.)
    const lakeLevel = lakeLevelAt(site);
    layMountains(farLand, cxA, czA, p.floor + 30, s2, stoneTint, (x, y, z, fir, own) => {
      const lake = lakeLevel?.(x, z);
      if (lake != null && y < lake + 0.8) return;
      // (Fewer where the far land begins, coming in to the whole over 180 metres, as the woods it paints do: they stood there one to
      // every thirteen square metres, against one to a hundred or so in the valley's own woods just inside, and from any height the
      // open ground about the valley was ringed by a wall of forest. Here about as thick as those woods, at first.)
      const outOfRing = ringOut(x, z);
      if (own01(x, z, 61) > 0.12 + 0.88 * smooth(outOfRing / 180)) return;
      // (In winter a far broadleaf, a whole crown painted on one card, is a dark ball: in the wood it is lost among the others, but
      // standing alone on the snow, as they do where the wood is thin, it was a blot. There the trees standing alone are firs.)
      if (winter && !fir && own01(x, z, 62) > smooth((outOfRing - 50) / 160)) return;
      const c0 = fir ? firs[Math.floor(own * 2.999)] : greens[Math.floor(own * (greens.length - 0.001))], t = (fir ? 0.75 : 0.5) + 0.3 * ((own * 7.3) % 1);
      // (A far fir in winter, a whole tree on one card, is green and white together.)
      const c: Colour = winter && fir ? [c0[0] * 0.6 + SNOWED[0] * 0.4, c0[1] * 0.6 + SNOWED[1] * 0.4, c0[2] * 0.6 + SNOWED[2] * 0.4] : c0;
      const tall = fir ? 7.5 + 6.5 * ((own * 3.7) % 1) : 6 + 4.5 * ((own * 3.7) % 1);
      planting.farTree(fir, x, y - 0.5, z, tall * (fir ? 0.42 : 0.95), tall, own * 6.283, [c[0] * t, c[1] * t, c[2] * t]);
    }, landmarks.map((l) => ({ x: l.x, z: l.z, r: l.r, y: l.y })), ground, vale?.terrain ? hills : undefined, farRing);
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
        // (Nor where its foot would reach into the valley, or within a few strides of its sides: in a long valley one stood in the
        // track a little above the gap, twelve metres of rock across the way up from where the player arrives.)
        if (vale && Array.from({ length: 25 }, (_, i) => i).some((i) => { const r = i ? reachC : 0, a = (i / 24) * Math.PI * 2; return insideAt(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r) > -8; })) continue;
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
        // (In a group of their own, `tor`, which stops nobody, as the soft rock does: a world draws its own hills, and a place standing
        // in it leaves out what stands on the game's, as it leaves out the far land, `packPlace`.)
        const was = wild.group;
        wild.group = 'tor';
        const torRock = wild.mesh('rock');
        wild.group = was;
        carveRock(torRock, air, {
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
    farCover = { wood: [mean[0] * 0.62, mean[1] * 0.62, mean[2] * 0.62], grass: season === 'autumn' ? [0.24, 0.21, 0.08] : season === 'summer' ? [0.15, 0.21, 0.06] : winter ? [0.3, 0.27, 0.2] : [0.15, 0.24, 0.06], ring: [cxA, czA, farRing] };

    __T('the far land, its crags and woods');
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
      for (const b of houses) clear = Math.min(clear, outside(b, x, z) - (b.style === 'imperial' || b.brickwork?.kind === 'church' ? 4 : 1.8));
      // Nothing stands in a town's street.
      if (lots.length && street(x, z) > 0.05) clear = Math.min(clear, -1);
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
      // (Not in a field, nor so near one that its crown hangs over the wall.)
      if (fieldList.length && fieldAt(x, z, 3) >= 0) return;
      const lift = y - p.floor;
      const kind = fbm2(x * 0.018 + s1, z * 0.018 + s2, 2) + lift * 0.006;
      const inBlossom = season === 'spring' && fbm2(x * 0.03 - s2, z * 0.03 + s1 * 2, 2) > 0.7;
      if (kind > 0.56 && !pick) {
        const height = plant.range(8, 14), radius = plant.range(1.9, 2.8);
        const girth = plant.range(0.16, 0.26), needle = needleOf(plant.pick(firs));
        // (The old boughs are still drawn from the stream, into nothing, as the old crowns are.)
        spent.conifer(x, y, z, height, radius, Math.round(5 + 6 * detail), needle, plant);
        spent.needles.matrices.length = spent.needles.colours.length = spent.needles.centres.length = 0;
        const own = rng.fork(`fir${grown++}`);
        if (detail > 0.3) {
          // Pines stand in patches among the spruce, on the drier knolls.
          const pine = fbm2(x * 0.05 - s1, z * 0.05 + s2 * 2, 2) > 0.57;
          growConifer(planting, woodOf(pine ? 'pine' : 'fir'), x, y, z, height * (pine ? 1.25 : 1.2), radius * (pine ? 1.15 : 1), girth * (pine ? 1.15 : 1.05), {
            kind: pine ? 'pine' : 'spruce', detail, needle: pine ? needleOf(pineGreen) : needle, bark: pine ? pineBark : firBark, shaded: true, soft: woodOf(pine ? 'pine' : 'fir', true),
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
        // (In winter: near, bare, an oak keeping a few of its dead leaves; far, where twigs are too fine to draw, their haze.)
        // (Painted sprays a metre and a half across stood for the far twigs at first, and from any height the bare woods were full
        // brown crowns, an autumn's: a trace of them is left.)
        const wintry = !winter ? 1 : detail > 0.5 ? (oak ? 0.04 : 0) : 0.05, builtNear = nearBuilt(x, z, 14);
        const reach = growTree(planting, woodOf(oak ? 'oak' : 'ash'), x, y, z, height * (oak ? 1.2 : 1.45) * (1 + 0.45 * old) * tall, girth * (oak ? 1.2 : 0.9) * (1 + 1.1 * old) * stout, {
          bare: winter, kind: oak ? 'oak' : 'ash', detail, cards: Math.round((110 + 1050 * detail) * (1 + 0.7 * old) * leafy * wintry), cardSize: (1.8 - 1.02 * detail) * (1 + 0.15 * old) * (giant > 1 || epic ? 1.15 : 1) * (epic ? 1.15 : 1), wide, leaf: winter ? leafOf(detail <= 0.5 ? [0.2, 0.18, 0.18] : [0.3, 0.18, 0.09]) : green, bark: oak ? oakBark : ashBark, shaded: true, soft: woodOf(oak ? 'oak' : 'ash', true),
          // (Its boughs kept out of the house: a great oak by a house standing free reached over its roofs and drooped into its court,
          // and through the arch from the court, where it stopped whoever walked through.)
          // (Nor low over the track and the paths, where a bough at head height stopped whoever walked up from the gap.)
          // (Nor into a house of the village, nor over the castle's wall.)
          keepOut: (q) => (q.y < site.top + 1.5 && inHouse(q.x, q.z, 0.4)) || (q.y < y + 2.6 && Math.min(offTrack(q.x, q.z), offFoot(q.x, q.z)) < 1.2) || (builtNear && q.y < y + 16 && nearBuilt(q.x, q.z, 0.9)),
        }, rng.fork(`tree${grown++}`));
        canopies.push([x, z, Math.max(spread, reach) * 1.1, 0.75]);
      }
    };
    // (A wood is close in its heart and thins out tree by tree towards its edge. Laid one to a cell wherever a patch said wood, with
    // the cells ten metres apart beyond the valley, the hills round about were planted as an orchard: young firs evenly spaced on a
    // lawn. Now a tree stands less often the nearer the patch's edge, and in its heart, now and then a second in the cell.)
    // (In a castle's valley the woods are where the valley has them: a forest at its foot where the player comes in, thinning to a
    // few trees about the fields and the village, and the castle's ground open. Leaned on the patches, so their edges stay ragged.)
    const zones = site.zones;
    // (And about a castle, asked for: more forest and trees round it. Its hill is wooded from some fourteen metres off its wall, where
    // the ground kept open for the walls' sake ends, out for a furlong and more, thinning towards the road and the village along it.)
    const castleWoods = (x: number, z: number) => {
      const c = site.castle;
      if (!c) return 0;
      const off = castleOff(c, x, z);
      return smooth((off - 14) / 14) * (1 - smooth((off - 120) / 70)) * smooth((offTrack(x, z) - 9) / 14);
    };
    const woodLean = (x: number, z: number): number => !zones ? 0
      : z > zones.forest[0] ? 0.2 * smooth((z - zones.forest[0]) / 25) - 0.3 * (1 - smooth((z - zones.forest[0] + 6) / 18))
      : Math.max(z > zones.fields[0] ? -0.3 : z > zones.village[0] ? -0.32 : -0.45, -0.45 + 0.62 * castleWoods(x, z));
    const woods = (area: { x0: number; x1: number; z0: number; z1: number }, step: number, f: (x: number, z: number) => number, skip: (x: number, z: number) => boolean) => {
      for (let gz = area.z0; gz < area.z1; gz += step) for (let gx = area.x0; gx < area.x1; gx += step) {
        const x0 = gx + plant.range(0.1, 0.9) * step, z0 = gz + plant.range(0.1, 0.9) * step;
        const thick = fbm2(x0 * 0.03 + s2, z0 * 0.03 + s1, 3) + woodLean(x0, z0);
        const pair = step > 8 && thick > 0.6 && own01(x0, z0, 51) < 0.5 ? 2 : 1;
        for (let k = 0; k < pair; k++) {
          const x = k ? gx + own01(x0, z0, 52) * step : x0, z = k ? gz + own01(x0, z0, 53) * step : z0;
          // (Nor in or against a house of the village, or within the castle's wall or by it: the woods' trees knew nothing of either while
          // the castle's ground and the village were kept clear of woods, and stood in them once woods came round them.)
          if (skip(x, z) || inHouse(x, z, 3) || inMeadow(x, z, 2.5) || nearBuilt(x, z, 3)) continue;
          if (offTrack(x, z) < 3.2 || offFoot(x, z) < 1.8 || !clearOfStones(x, z, 0.8) || clearOfFeatures(x, z) < 3) continue;
          const here = k ? fbm2(x * 0.03 + s2, z * 0.03 + s1, 3) + woodLean(x, z) : thick;
          if (here < 0.46 || slopeOf(f, x, z, 1.5) > 0.75) continue;
          if (step > 8 && own01(x, z, 54) < 0.85 * (1 - smooth((here - 0.46) / 0.12))) continue;
          // Full detail anywhere the player can stand, and for a stone's throw beyond, so that the wood the valley lies in goes on as
          // a wood past where one may walk (asked for: it had turned to rough trees within a few strides of the edge); less with
          // distance beyond that. (Fifteen metres and then sixty to nothing: twenty-five and ninety cost a frame some 2.5
          // milliseconds more than before, and was trimmed when asked.)
          const out = vale ? Math.max(0, -insideAt(x, z), g.z0 - z, z - vale.mouth - 8) : Math.max(0, g.x0 - x, x - g.x1, z - g.z1, g.z0 - z);
          tree(x, z, f(x, z), 1 - smooth((out - 15) / 60));
        }
      }
    };
    // (Where the woods beyond the valley begin: the fine sheet's area as it lies for a cell of 1.2, whatever the cell, so that a finer
    // sheet changes the ground and nothing that grows on it.)
    const near = { x0: snap(g.x0 - 34, false), x1: snap(g.x1 + 34, true), z0: snap(Math.min(houseZ0 - 40, g.z0 - 34), false), z1: snap(g.z1 + 34, true) };
    const inFine = (x: number, z: number) => x > near.x0 && x < near.x1 && z > near.z0 && z < near.z1;
    // An island carries a tree of its own: a pine or a spruce, small, as trees are on a rock in the water.
    for (const f of ponds) {
      if (!f.isle) continue;
      const own = rng.fork(`isletree${f.x}`), y = ground(f.isle.x, f.isle.z), pine = own.chance(0.5);
      growConifer(planting, woodOf(pine ? 'pine' : 'fir'), f.isle.x, y - 0.1, f.isle.z, own.range(4.5, 7), own.range(1.1, 1.6), 0.13, { kind: pine ? 'pine' : 'spruce', detail: 1, needle: needleOf(pine ? pineGreen : firs[0]), bark: pine ? pineBark : firBark, shaded: true, soft: woodOf(pine ? 'pine' : 'fir', true) }, own);
      canopies.push([f.isle.x, f.isle.z, 1.6, 1]);
    }
    // (Not where the keep stands.)
    // (Nor at the far end of a terrace, where a shrine or a cairn stands.)
    const shelfEnds = terraces.map((t) => { const z = t.rise === 'n' ? t.z1 - 2.4 : t.z0 + 2.4; return [sideAt(t.side, z) + (t.side === 'w' ? 1 : -1) * (4.7 + t.depth * 0.62), z]; });
    const row = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('treerow') : null; // (no woods when a row is asked for, so the row stands alone)
    if (!row) woods(fine, 6.2, eased, (x, z) => (!!site.keep && Math.hypot(x - site.keep.x, z - site.keep.z) < (site.keep.kind === 'castle' ? 34 : 16)) || shelfEnds.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 4.5));
    if (!row) woods({ x0: cxA - reach + 6, x1: cxA + reach - 6, z0: czA - reach + 6, z1: czA + reach - 6 }, 10, ground, (x, z) => inFine(x, z) || ringOut(x, z) > -4);
    // Trees among the village's houses (asked for: some near the buildings): a fruit tree in a garden or yard behind a house more often
    // than not, a broad old tree at a corner of the square, and now and then one beside a house, off its gable. Young and spreading,
    // and from a stream of their own, so that nothing else moves.
    if (!row && site.village) {
      const vt = rng.fork('village trees'), tq = rng.fork('village tree ages');
      const ok = (x: number, z: number, m: number) => !nearBuilt(x, z, m) && offTrack(x, z) > 3 && offFoot(x, z) > 1.6 && clearOfFeatures(x, z) > 3 && clearOfStones(x, z, 0.8) && (!fieldList.length || fieldAt(x, z, 3) < 0);
      for (const pl of site.village.plots) {
        if (!vt.chance(0.65)) continue;
        const cx = pl.reduce((a, q) => a + q[0], 0) / pl.length, cz = pl.reduce((a, q) => a + q[1], 0) / pl.length;
        const x = cx + vt.range(-1.2, 1.2), z = cz + vt.range(-1.2, 1.2);
        if (ok(x, z, 2.2)) tree(x, z, ground(x, z), 1, { oak: true, roll: tq.range(0.72, 0.95) });
      }
      const sq = site.village.square;
      if (sq && vt.chance(0.8)) {
        const k = vt.int(0, sq.length - 1), [qx, qz] = sq[k], mx = sq.reduce((a, q) => a + q[0], 0) / sq.length, mz = sq.reduce((a, q) => a + q[1], 0) / sq.length;
        const x = qx + (mx - qx) * 0.22, z = qz + (mz - qz) * 0.22;
        if (ok(x, z, 2.5)) tree(x, z, ground(x, z), 1, { oak: true, roll: tq.range(0.3, 0.6), old: true });
      }
      for (const b of houses) {
        if (!b.set || !vt.chance(0.35)) continue;
        const side = vt.chance(0.5) ? 1 : -1, [x, z] = fromFront(b, side * (b.w / 2 + vt.range(3.2, 4.5)), b.d * vt.range(0.3, 0.9));
        if (ok(x, z, 2.6)) tree(x, z, ground(x, z), 1, { oak: vt.chance(0.6), roll: tq.range(0.55, 0.9) });
      }
    }
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
      // The street of a town is walked all over.
      if (lots.length) w = Math.max(w, street(x, z));
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
      return straw([(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t], t);
    };
    const flowerHues: Colour[] = [[0.25, 0.5, 1.5], [1.4, 0.4, 0.8], [1.3, 1.3, 1.2], [1.5, 1.1, 0.2]];
    const hueAt = (x: number, z: number) => flowerHues[Math.floor(fbm2(x * 0.02 + s2, z * 0.02 - s1, 2) * 3.99) % 4];
    // Flowers by kind, each in drifts of its own that overlap: buttercups nearly everywhere, white ox-eye and cow parsley taller and in
    // broad drifts, pink-purple knapweed and campion, blue harebells and cornflowers fewer, and red here and there. (A meadow was one
    // colour over fifty metres at a time: the arrival in one seed was all pink spikes.) Where two would grow, the one whose drift is
    // thicker there.
    const FLOWERS: { hue: Colour; size: number; at: number; bar: number }[] = [
      { hue: [1.5, 1.1, 0.2], size: 0.8, at: 0.11, bar: 0.52 },
      { hue: [1.3, 1.3, 1.2], size: 1.2, at: 0.06, bar: 0.6 },
      { hue: [1.4, 0.4, 0.8], size: 1.0, at: 0.09, bar: 0.65 },
      { hue: [0.25, 0.5, 1.5], size: 0.85, at: 0.13, bar: 0.69 },
      { hue: [1.5, 0.3, 0.12], size: 0.9, at: 0.1, bar: 0.75 },
    ];
    const HERBS: Colour[] = [[1.35, 0.42, 0.85], [1.3, 1.25, 1.0], [1.45, 1.15, 0.25], [0.85, 0.3, 1.1]];
    const flowerAt = (x: number, z: number, y: number, size: number) => {
      if (!plant.chance(0.4 * inFlower)) return;
      let best = -1, k = -1;
      for (let i = 0; i < FLOWERS.length; i++) {
        const f = FLOWERS[i], d = fbm2(x * f.at + s1 * (i + 3), z * f.at - s2 * (i + 1) + 7.3 * i, 2) - f.bar + own01(x, z, i) * 0.05;
        if (d > best) { best = d; k = i; }
      }
      if (best < 0) return;
      const f = FLOWERS[k], t = 0.85 + 0.25 * own01(x, z, 9), sz = size * f.size;
      planting.tuft(planting.flowers, x, y - 0.02, z, sz, sz * plant.range(0.9, 1.3), plant.range(0, Math.PI), [f.hue[0] * t, f.hue[1] * t, f.hue[2] * t]);
    };
    // Grass. How tall it stands is worked out, not scattered: long where the ground is moist and
    // open and nobody walks, short where it is trodden or the soil is thin, and sparse under trees.
    const grass = (x0: number, x1: number, z0: number, z1: number, step: number, scale: number, keep: (x: number, z: number) => boolean) => {
      for (let gz = z0; gz < z1; gz += step) for (let gx = x0; gx < x1; gx += step) {
        const x = gx + plant.range(0, step), z = gz + plant.range(0, step);
        // (Nothing grows in the ruts of the track; what would have is drawn all the same and thrown away.)
        planting.muted = rutted(x, z) > 0.5 || towers.some((t) => Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < t.half + 1.4) || houses.some((b) => outside(b, x, z) < 0.7) || (lots.length > 0 && street(x, z) > 0.55);
        if (!keep(x, z)) continue;
        // (Nor in front of the mouth of a grotto, where the ground is cut away to the door: a tuft there stood in the air.)
        if (grottoes.some((q) => { const inside = (x - q.edge) * q.inw; return inside > -7 && inside < 3 && Math.abs(z - q.z) < 4; })) continue;
        const off = offTrack(x, z);
        if (off < 0.12 || !plant.chance(0.3 + 0.7 * Math.min(1, off / 1.4))) continue;
        if (slopeOf(ground, x, z, 0.3) > 0.55 || !clearOfStones(x, z, -0.15)) continue;
        const y = ground(x, z);
        // Nothing grows under water; at its edge, reeds: tall, close and pale.
        // Still water has them standing in it to the knee; a current keeps its bed clear.
        const depth = waterOver(x, z, y);
        if (depth > (running ? 0.04 : 0.3)) continue;
        if (depth > -0.22) {
          for (let k = 0; k < 2; k++) planting.tuft(planting.grass, x + plant.range(-0.25, 0.25), y - 0.05, z + plant.range(-0.25, 0.25), plant.range(0.45, 0.7), plant.range(0.9, 1.5) * (winter ? 0.7 : 1), plant.range(0, Math.PI), winter ? [0.42, 0.33, 0.14] : [0.22 * plant.range(0.8, 1.2), 0.3, 0.07]);
          continue;
        }
        const shade = shadeAt(x, z), wet = wetAt(x, z), wear = wearAt(x, z), thin = thinAt(x, z);
        const deep = Math.max(0, shade - 0.4) / 0.6;
        if (!plant.chance((1 - 0.72 * deep) * (1 - 0.45 * thin))) continue;
        const tall = (0.45 + 1.1 * wet) * (1 - 0.82 * wearAt(x, z, true)) * (1 - 0.5 * deep) * (1 - 0.55 * thin) * (0.8 + 0.5 * fbm2(x * 0.3 + s2, z * 0.3 + s1, 2)) * (winter ? 0.5 : 1);
        const w = plant.range(0.4, 0.7) * (0.75 + 0.35 * tall) * scale, h = plant.range(0.2, 0.34) * (0.35 + 1.25 * tall) * Math.sqrt(scale);
        planting.tuft(planting.grass, x, y - 0.05, z, w, h, plant.range(0, Math.PI), grassColour(x, z, wet));
        // Grass in seed, where it stands long and nobody treads it: heads over the sward, paler, the colour of ripe seed (less of it
        // in spring). And rushes in the wettest ground short of standing water, dark, stiff and in clumps. (The sward was one even
        // green, the same height everywhere at once: a lawn.)
        const r1 = own01(x, z, 21);
        if (tall > (winter ? 0.4 : 0.8) && wear < 0.2 && shade < 0.4 && r1 < (season === 'spring' ? 0.08 : 0.22)) {
          const ripe = 0.75 + 0.35 * own01(x, z, 22);
          planting.tuft(planting.grass, x + 0.07, y - 0.05, z - 0.05, w * 0.6, h * 1.45, r1 * 40, [0.36 * ripe, 0.34 * ripe, 0.16 * ripe]);
        } else if (wet > 0.72 && wear < 0.15 && shade < 0.6 && r1 < 0.35 * smooth((wet - 0.72) / 0.15)) {
          const dark = 0.75 + 0.35 * own01(x, z, 23);
          planting.tuft(planting.reeds, x, y - 0.05, z, w * 0.8, h * 1.2 + 0.25, r1 * 40, winter ? [0.15 * dark, 0.13 * dark, 0.07 * dark] : [0.07 * dark, 0.16 * dark, 0.035 * dark]);
        }
        // Flowers want sun, some moisture, and to be left alone.
        if (shade < 0.35 && wear < 0.4 && wet > 0.25 && plant.chance(0.14 * scale)) flowerAt(x, z, y, plant.range(0.3, 0.45) * Math.sqrt(scale));
      }
    };
    grass(p.x0 + 0.2, p.x1 - 0.2, p.z0 + 0.25, p.z1 - 0.2, 0.36, 1, () => true);
    grass(g.x0 - 2, g.x1 + 2, g.z0, g.z1 + 5, 0.56, 1.5, (x, z) => inGrounds(x, z, -2) && !inMeadow(x, z, -0.2) && !inHouse(x, z, 0.5));
    grass(g.x0 - 22, g.x1 + 22, g.z0 - 10, g.z1 + 22, 1.1, 2.4, (x, z) => !inGrounds(x, z, -2) && !inHouse(x, z, 0.5) && !(z < g.z0 && x > g.x0 && x < g.x1 && z > frontZ));
    planting.muted = false;

    const heather: Colour = season === 'spring' ? [0.1, 0.18, 0.06] : winter ? [0.18, 0.1, 0.11] : [0.42, 0.14, 0.34];
    __T('what lies and grows');
    // ---- a second, taller growth, from a stream of its own so that nothing above is disturbed
    const lush = rng.fork('lush');
    // Meadow grass: knee-high and close where the ground is moist and nobody walks, thinning to
    // nothing where it is dry, trodden or dark. With the turf grass under it, the ground is
    // covered, not dotted.
    for (let gz = g.z0 + 0.5; gz < g.z1; gz += 0.5) for (let gx = g.x0 + 1; gx < g.x1 - 1; gx += 0.5) {
      const x = gx + lush.range(0, 0.5), z = gz + lush.range(0, 0.5), t = lush.next(), turn = lush.range(0, Math.PI), tone = lush.range(0.75, 1.2);
      planting.muted = rutted(x, z) > 0.5 || towers.some((t) => Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < t.half + 1.4) || houses.some((b) => outside(b, x, z) < 0.7) || (lots.length > 0 && street(x, z) > 0.55);
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
      const tall = (0.42 + 0.75 * wet) * (0.7 + 0.6 * fbm2(x * 0.21 + s1, z * 0.21 - s2, 2)) * lowered;
      const c = turfColour(x, z, s1), dry = Math.min(1, parched + Math.max(0, (0.4 - wet) * 2));
      planting.tuft(planting.grass, x, y - 0.05, z, 0.55 + 0.4 * tall, tall, turn, straw([(0.16 + 0.2 * dry) * c[0] * tone, (0.3 + 0.03 * dry) * c[1] * tone, (0.05 + 0.05 * dry) * c[2] * tone], tone));
    }
    planting.muted = false;
    // The fields: their crops, close in rows across them; and dry-stone walls about them, with a gateway on the side towards the track.
    if (fieldList.length) {
      const cq = rng.fork('crops');
      cropping = true;
      for (const [k, f] of fieldList.entries()) {
        for (let gz = f.z0; gz < f.z1; gz += 0.62) for (let gx = f.x0; gx < f.x1; gx += 0.62) {
          const x = gx + cq.range(0, 0.62), z = gz + cq.range(0, 0.62), yaw = cq.range(0, Math.PI * 2);
          if (!inPolygon(f.corners, x, z) || edgeOff(f.corners, x, z) < 0.9) continue;
          const y = ground(x, z);
          if (f.crop === 'wheat' || f.crop === 'barley' || f.crop === 'oats') {
            // (In winter the fields are stubble under the snow: a crop's tufts stand short and straw-coloured.)
            const tc = cropTint(f.crop), tall = (f.crop === 'oats' ? 0.75 : 0.85) * (season === 'spring' ? 0.45 : winter ? 0.22 : 1) * cq.range(0.85, 1.1);
            planting.tuft(planting.grass, x, y - 0.04, z, cq.range(0.5, 0.7), tall, yaw, [0.3 * tc[0], 0.3 * tc[1], 0.12 * tc[2]]);
          } else if (f.crop === 'roots') {
            const row = Math.abs((((x * 0.6 + z * 0.08) % 1.6) + 1.6) % 1.6 - 0.8);
            if (row < 0.3 && !winter) planting.tuft(planting.herbs, x, y - 0.04, z, cq.range(0.5, 0.7), cq.range(0.3, 0.45), yaw, [0.1, 0.22, 0.06]);
          } else if (f.crop === 'pasture' && cq.chance(0.5)) {
            // (Grazed short, and in winter straw.)
            planting.tuft(planting.grass, x, y - 0.04, z, cq.range(0.45, 0.7), cq.range(0.12, 0.22), yaw, winter ? [0.46, 0.36, 0.15] : [0.17 + 0.1 * parched, 0.3, 0.06]);
          }
        }
        // Its wall: round the field in short lengths, with a gateway halfway along the side by the track.
        const line: [number, number][] = [], gaps: [number, number][] = [], c = f.corners;
        for (let e = 0; e < c.length; e++) {
          const [ax, az] = c[e], [bx, bz] = c[(e + 1) % c.length], n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.6));
          const start = line.length;
          for (let i = 0; i < n; i++) line.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
          if (e === c.length - 1) gaps.push([start + Math.floor(n / 2) - 1, start + Math.floor(n / 2) + 1]);
        }
        line.push(c[0]);
        layWall((m) => wild.mesh(m), { line, gaps, fallen: [], height: cq.range(0.95, 1.2) }, ground, [0.62 * (0.6 + 0.4 * stoneTint[0]), 0.6 * (0.6 + 0.4 * stoneTint[1]), 0.56 * (0.6 + 0.4 * stoneTint[2])], cq.fork(`wall${k}`));
      }
      cropping = false;
    }
    // The village's gardens: greens in rows on their beds.
    if (site.village && !winter) {
      const gq = rng.fork('gardens');
      cropping = true;
      for (const [n, pl] of site.village.plots.entries()) {
        if (n % 2) continue;
        const xs = pl.map((q) => q[0]), zs = pl.map((q) => q[1]);
        for (let gz = Math.min(...zs); gz < Math.max(...zs); gz += 0.45) for (let gx = Math.min(...xs); gx < Math.max(...xs); gx += 0.45) {
          const x = gx + gq.range(0, 0.45), z = gz + gq.range(0, 0.45);
          if (!inPolygon(pl, x, z) || edgeOff(pl, x, z) < 0.6 || Math.abs((((x * 0.7 + z * 0.3) % 1.4) + 1.4) % 1.4 - 0.7) > 0.18) continue;
          planting.tuft(planting.herbs, x, ground(x, z) - 0.04, z, gq.range(0.35, 0.5), gq.range(0.22, 0.4), gq.range(0, Math.PI * 2), [0.09 + gq.range(0, 0.05), 0.2 + gq.range(0, 0.06), 0.06]);
        }
      }
      cropping = false;
    }
    // Down the middle of the track, between the ruts, grass in clumps: thick for a few strides, then none.
    {
      const strip = rng.fork('strip');
      for (let z = p.z1 - 2; z < g.z1 - 3; z += 0.17) {
        const x = pathAt(z) + strip.range(-0.24, 0.24), tall = strip.range(0.2, 0.42), turn = strip.range(0, Math.PI), tone = strip.range(0.8, 1.15);
        if (clumpAt(z) < -0.05 || rutted(x, z) > 0.4) continue;
        const y = ground(x, z);
        if (waterOver(x, z, y) > -0.1) continue;
        const c = turfColour(x, z, s1);
        planting.tuft(planting.grass, x, y - 0.05, z, 0.42 + 0.5 * tall, tall * lowered, turn, straw([(0.17 + 0.1 * parched) * c[0] * tone, 0.3 * c[1] * tone, 0.055 * c[2] * tone], tone));
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
          planting.tuft(planting.grass, x, y - 0.05, z, 0.5 + 0.3 * patch, (0.22 + 0.5 * patch) * lowered, turn, straw([(0.17 + 0.2 * dry) * c[0] * tone, (0.29 + 0.03 * dry) * c[1] * tone, (0.05 + 0.05 * dry) * c[2] * tone], tone));
        } else if (t > 0.93 && patch > 0.5 && clearOf(x, z, 1)) {
          const size = 0.3 + 0.3 * top.next();
          planting.crown(x, y + size * 0.35, z, size, size * 0.5, 14, size * 0.9, leafOf(heather), top);
        } else if (t > 0.5 && t < 0.508 && bushes < 9 && clearOf(x, z, 1.6)) {
          growTree(planting, softBark, x, y - 0.05, z, 1.5 + 1.2 * top.next(), 0.04, { kind: 'oak', detail: 0.5, cards: winter ? 0 : 56, cardSize: 0.5, leaf: leafOf(greens[0]), bark: oakBark, shaded: true, bare: winter }, rng.fork(`topbush${bushes++}`));
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
    const fernGreen: Colour = season === 'autumn' ? [0.34, 0.22, 0.05] : winter ? [0.3, 0.17, 0.07] : [0.1, 0.27, 0.05];
    const open = (x: number, z: number) => inGrounds(x, z, 0.5) && !inHouse(x, z, 0.8) && offTrack(x, z) > 1.6 && offFoot(x, z) > 0.75 && clearOfStones(x, z, 0.05) && clearOfFeatures(x, z) > 0.3 && slopeOf(ground, x, z, 0.4) < 0.6;
    const census = { ferns: 0, bracken: 0, herbs: 0, nettles: 0, heather: 0, bramble: 0, thicket: 0, saplings: 0, scree: screeLaid };
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
        // (By kind, in drifts that overlap, as the meadow's flowers are: rosebay's pink, meadowsweet's cream, loosestrife's yellow and
        // purple. They were one colour over fifty metres: a whole bank of pink spikes.)
        let pick = 0, most = -9;
        for (let i = 0; i < HERBS.length; i++) { const d = fbm2(x * 0.07 + s2 * (i + 2), z * 0.07 - s1 * (i + 5) + 4.1 * i, 2) + own01(x, z, 40 + i) * 0.06; if (d > most) { most = d; pick = i; } }
        const hue = season === 'autumn' ? [0.4, 0.3, 0.16] as Colour : winter ? [0.3, 0.25, 0.16] as Colour : HERBS[pick];
        planting.tuft(planting.herbs, x, y - 0.03, z, size, plant.range(0.95, 1.5), plant.range(0, Math.PI), hue);
        census.herbs++;
        continue;
      }
      // Bracken on the dry banks, in stands: broad fronds to the knee and higher, green in spring and summer, russet in autumn. (The
      // valley's slopes were turf like its floor; bracken is what takes a dry hillside nobody grazes hard.)
      if (shade < 0.5 && wet < 0.45 && thin > 0.12 && thin < 0.65 && fbm2(x * 0.055 + s2 * 3, z * 0.055 - s1, 2) > 0.56 && plant.chance(0.45)) {
        const size = plant.range(1.0, 1.6), t = plant.range(0.8, 1.15), c: Colour = season === 'autumn' || winter ? [0.46, 0.24, 0.08] : season === 'summer' ? [0.16, 0.27, 0.06] : [0.2, 0.32, 0.07];
        planting.tuft(planting.ferns, x, y - 0.04, z, size, size * plant.range(0.6, 0.85), plant.range(0, Math.PI), [c[0] * t, c[1] * t, c[2] * t]);
        census.bracken++;
        continue;
      }
      // Heather and its like: low mounds on thin dry soil in the sun, against rock.
      if (thin > 0.5 && shade < 0.35 && wet < 0.5 && plant.chance(0.16)) {
        const size = plant.range(0.3, 0.55);
        planting.crown(x, y + size * 0.35, z, size, size * 0.5, 16, size * 0.9, leafOf(heather), plant);
        census.heather++;
        continue;
      }
      // Bramble where wood meets open ground: low dark mounds a stride or two across, which the edge of a wood is fringed with.
      // (Trees stood straight up out of the grass, the wood ending at its last trunk.)
      if (shade > 0.15 && shade < 0.55 && thin < 0.5 && own01(x, z, 31) < 0.045) {
        const size = 0.5 + 0.6 * own01(x, z, 32);
        planting.crown(x, y + size * 0.28, z, size, size * 0.45, 26, size * 0.75, leafOf(season === 'autumn' ? [0.2, 0.12, 0.05] : winter ? [0.1, 0.09, 0.06] : [0.07, 0.15, 0.04]), plant);
        census.bramble++;
        continue;
      }
      // Thicket: bushes where wood meets open ground, which is where the light and the shelter both are.
      // (Twice as thick as it was: a wood's edge is mostly bushes and young trees, not a line of trunks.)
      if (shade > 0.18 && shade < 0.5 && thin < 0.5 && plant.chance(0.07)) {
        const size = plant.range(0.7, 1.35);
        // A bush: several stems from the ground, branching, with its leaves on its twigs.
        const green = leafOf(plant.pick(greens));
        spent.crown(x, y + size * 0.55, z, size, size * 0.75, 52, size * 0.72, green, plant);
        spent.leaves.matrices.length = spent.leaves.colours.length = spent.leaves.centres.length = 0;
        growTree(planting, softBark, x, y - 0.05, z, size * 2.4, 0.03 + 0.02 * size, { kind: 'oak', detail: 0.5, cards: winter ? 0 : 64, cardSize: 0.52, leaf: green, bark: oakBark, shaded: true, bare: winter }, rng.fork(`bush${census.thicket}`));
        census.thicket++;
        // And now and then a young tree coming up among them.
        if (plant.chance(0.3)) {
          const sx = x + plant.range(-1.2, 1.2), sz = z + plant.range(-1.2, 1.2);
          if (open(sx, sz)) {
            const height = plant.range(2.2, 3.6);
            const green = leafOf(plant.pick(greens));
            spent.broadleaf(sx, ground(sx, sz), sz, height, plant.range(0.8, 1.2), 70, green, plant, 0.7);
            growTree(planting, woodOf('ash', true), sx, ground(sx, sz), sz, height * 1.15, 0.055, { kind: 'ash', detail: 0.45, cards: winter ? 0 : 70, cardSize: 0.55, leaf: green, bark: ashBark, shaded: true, bare: winter }, rng.fork(`tree${grown++}`));
            census.saplings++;
          }
        }
      }
    }
    // Sheep: a flock or two on the open ground of the valley, away from the house, the track, the paths, the woods and the water, on
    // ground not too steep. (A valley of pasture with nothing on it to graze it was a lawn kept by nobody.)
    {
      const q = rng.fork('flocks'), want = q.chance(0.8) ? q.int(1, 2) : 0, out: { x: number; z: number; r: number; count: number }[] = [];
      // (Where the valley has a pasture, the sheep are in it, within its walls.)
      for (const f of fieldList) if (f.crop === 'pasture') {
        const cx = f.corners.reduce((a, c) => a + c[0], 0) / f.corners.length, cz = f.corners.reduce((a, c) => a + c[1], 0) / f.corners.length;
        out.push({ x: cx, z: cz, r: Math.max(4, Math.min(12, edgeOff(f.corners, cx, cz) - 2)), count: q.int(5, 9) });
      }
      for (let tries = 0; tries < 400 && out.length < want && !fieldList.length; tries++) {
        const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1);
        if (!inGrounds(x, z, 10) || inHouse(x, z, 18) || offTrack(x, z) < 8 || offFoot(x, z) < 4 || shadeAt(x, z) > 0.12 || clearOfFeatures(x, z) < 8) continue;
        if (waterOver(x, z, ground(x, z)) > -1 || slopeOf(ground, x, z, 3) > 0.25 || out.some((f) => Math.hypot(f.x - x, f.z - z) < 50)) continue;
        out.push({ x, z, r: q.range(10, 18), count: q.int(3, 8) });
      }
      flockSpots = out;
      planting.crop(out);
    }
    // Rooks: a rookery in the wood, its birds wheeling and cawing over the tops of the trees, now here, now there.
    {
      const q = rng.fork('rooks'), out: { x: number; y: number; z: number }[] = [];
      for (let tries = 0; tries < 300 && out.length < 2; tries++) {
        const x = q.range(g.x0, g.x1), z = q.range(g.z0, g.z1);
        if (!inGrounds(x, z, 0) || shadeAt(x, z) < 0.5 || inHouse(x, z, 10) || out.some((b) => Math.hypot(b.x - x, b.z - z) < 80)) continue;
        out.push({ x, y: ground(x, z) + q.range(24, 34), z });
      }
      if (out.length) rookSpots = out;
    }
    // Fireflies: by the water and along the edges of the woods, in swarms of a hundred or two, low over the long grass. Whether
    // they are out (after sunset, in spring and summer, and not in rain) the program decides; this is only where they would be.
    {
      const q = rng.fork('fireflies'), out: number[] = [], swarms: { x: number; z: number }[] = [], banks: [number, number][] = [];
      for (const c of channels) for (let k = 0; k < c.x.length; k += 3) banks.push([c.x[k], c.z[k]]);
      for (let tries = 0; tries < 500 && swarms.length < 7; tries++) {
        let x: number, z: number;
        if (banks.length && q.chance(0.55)) { const [bx, bz] = q.pick(banks); x = bx + q.range(-8, 8); z = bz + q.range(-8, 8); }
        else {
          x = q.range(g.x0, g.x1); z = q.range(g.z0, g.z1);
          const s = shadeAt(x, z);
          if (s < 0.12 || s > 0.45) continue;
        }
        if (!inGrounds(x, z, 3) || inHouse(x, z, 12) || swarms.some((w) => Math.hypot(w.x - x, w.z - z) < 30)) continue;
        swarms.push({ x, z });
        const n = q.int(90, 200), r = q.range(8, 14);
        for (let k = 0; k < n; k++) {
          const a = q.range(0, Math.PI * 2), d = r * Math.sqrt(q.next()), fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
          if (!inGrounds(fx, fz, 1) || inHouse(fx, fz, 2)) continue;
          // (Over water they keep above it; most fly at the height of the grass heads, a few higher.)
          const gy = ground(fx, fz), top = gy + Math.max(0, waterOver(fx, fz, gy));
          out.push(fx, top + 0.25 + 2.2 * q.next() * q.next(), fz);
        }
      }
      if (out.length) fireflySpots = out;
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

    __T('the second growth');
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
    // The castle: its curtain wall along the brow of its hill, its towers and its gate (`render/castle.ts`). Its keep is among `towers`.
    if (site.castle) {
      const wasGroup = wild.group;
      wild.group = 'castle';
      buildCastle({ c: site.castle, mesh: (material) => wild.mesh(material), ground: swells, floor: p.floor, stone: stoneTint });
      wild.group = wasGroup;
    }
    // Buildings by the track. (The first timber house of a row is its inn.)
    houses.forEach((b, i) => {
      wild.group = 'house';
      // (Made in meshes of its own and then laid, so that its rooms can be marked as indoors and the feet of its walls damp: see `placeHouse`.)
      const local = new Map<string, MeshBuilder>(), into = (material: string) => { if (!local.has(material)) local.set(material, new MeshBuilder()); return local.get(material)!; };
      // (A house turned to face a road wherever it bends is built facing west about its own middle and turned into place, as a town's
      // are: built where it stands, the builder set it square to the valley, while its ground was levelled, and the ground's sheet cut
      // away, for it as it was turned, and its corners stood out over the slope.)
      const turned = b.turn !== undefined, own: Building = turned ? { ...b, x: 0, z: 0, faces: 'w', turn: undefined } : b, stone: Colour = [0.86 * stoneTint[0], 0.77 * stoneTint[1], 0.63 * stoneTint[2]];
      buildBuilding(own, b.base, into, rng.fork(`building${i}`), stone, i === 0 && !b.wheel);
      // Its footing: where the ground about it lies below its floor, as it does on a slope, stone from under its floor down into the
      // ground under its main block and its wings, as a town's houses have.
      {
        let low = b.base;
        for (const r of b.rects) for (const [u, v] of [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], [(r.u0 + r.u1) / 2, r.v0], [(r.u0 + r.u1) / 2, r.v1], [r.u0, (r.v0 + r.v1) / 2], [r.u1, (r.v0 + r.v1) / 2]]) {
          const [x, z] = fromFront(b, u, v);
          low = Math.min(low, ground(x, z));
        }
        // (Not under a cellar, whose walls its builder raises.)
        if (low < b.base - 0.05 && !b.cellar) {
          const { box } = buildingTools(own, b.base, into), tone: Colour = [stone[0] * 0.85, stone[1] * 0.85, stone[2] * 0.85];
          for (const r of b.rects) box('stone', r.u0 - 0.05, r.u1 + 0.05, low - b.base - 0.6, 0.02, r.v0 - 0.05, r.v1 + 0.05, tone);
        }
      }
      placeHouse(b, b.base, local, (material) => wild.mesh(material), { facing: b.turn ?? (b.faces === 'w' ? Math.PI : 0), foot: ground, ...(turned ? { turn: { angle: b.turn! - Math.PI, x: b.x, z: b.z } } : {}) });
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
    // The village's plots, walled in dry stone on three sides, the house standing across the fourth; and the well in its square.
    if (site.village) {
      const vq = rng.fork('village walls'), wallStone: Colour = [0.62 * (0.6 + 0.4 * stoneTint[0]), 0.6 * (0.6 + 0.4 * stoneTint[1]), 0.56 * (0.6 + 0.4 * stoneTint[2])];
      for (const [n, pl] of site.village.plots.entries()) {
        // (Its corners go round from the far side's left: the side by the house, from the third to the fourth, is not walled.)
        const sides = [pl[3], pl[0], pl[1], pl[2]], line: [number, number][] = [];
        for (let e = 0; e < 3; e++) {
          const [ax, az] = sides[e], [bx, bz] = sides[e + 1], m = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
          for (let i = 0; i < m; i++) line.push([ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m]);
        }
        line.push(sides[3]);
        layWall((m) => wild.mesh(m), { line, gaps: [], fallen: [], height: vq.range(0.75, 1.0) }, ground, wallStone, vq.fork(`plot${n}`));
      }
      // The churchyard, walled all round in dry stone a little higher, with a gateway before the church's door.
      const cy = site.village.churchyard;
      if (cy) {
        const line: [number, number][] = [];
        let gate = 0, best = Infinity;
        for (let e = 0; e < 4; e++) {
          const [ax, az] = cy.ring[e], [bx, bz] = cy.ring[(e + 1) % 4], m = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
          for (let i = 0; i < m; i++) {
            const x = ax + ((bx - ax) * (i + 0.5)) / m, z = az + ((bz - az) * (i + 0.5)) / m, d = Math.hypot(x - cy.gate[0], z - cy.gate[1]);
            if (d < best) { best = d; gate = line.length; }
            line.push([ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m]);
          }
        }
        line.push(cy.ring[0]);
        layWall((m) => wild.mesh(m), { line, gaps: [[gate - 1, gate + 1]], fallen: [], height: vq.range(1.0, 1.2) }, ground, wallStone, vq.fork('churchyard'));
      }
      if (site.village.well) {
        const [wx, wz] = site.village.well, wy = ground(wx, wz), made = solids((material) => wild.mesh(material));
        const { solid } = anyAngle((m) => wild.mesh(m));
        const ring = (r: number, y0: number, y1: number, colour: Colour) => {
          const n = 10;
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, ri = r - 0.28;
            const p = (a: number, rr: number, y: number): [number, number, number] => [wx + Math.cos(a) * rr, y, wz + Math.sin(a) * rr];
            solid('stone', [p(a0, ri, y0), p(a1, ri, y0), p(a1, r, y0), p(a0, r, y0), p(a0, ri, y1), p(a1, ri, y1), p(a1, r, y1), p(a0, r, y1)], colour, 0.6);
          }
        };
        // Its round kerb of stone, the water dark below; two posts, a beam with its windlass, and a little roof of tiles over all.
        ring(0.95, wy - 0.4, wy + 0.85, wallStone);
        made.block('stone', V(wx - 0.68, wy + 0.2, wz - 0.68), V(wx + 0.68, wy + 0.22, wz + 0.68), [0.03, 0.04, 0.05]);
        const oak: Colour = [0.24, 0.16, 0.1];
        for (const s of [-1, 1]) made.block('wood', V(wx + s * 0.9 - 0.08, wy + 0.6, wz - 0.08), V(wx + s * 0.9 + 0.08, wy + 2.35, wz + 0.08), oak);
        made.block('wood', V(wx - 1.05, wy + 1.55, wz - 0.06), V(wx + 1.05, wy + 1.67, wz + 0.06), oak);
        const tileC: Colour = [0.55, 0.3, 0.22];
        for (const s of [-1, 1]) solid('tile', [[wx - 1.2, wy + 2.3, wz], [wx + 1.2, wy + 2.3, wz], [wx + 1.2, wy + 2.3, wz + s * 0.02], [wx - 1.2, wy + 2.3, wz + s * 0.02], [wx - 1.2, wy + 1.95, wz + s * 0.95], [wx + 1.2, wy + 1.95, wz + s * 0.95], [wx + 1.2, wy + 2.0, wz + s * 0.95], [wx - 1.2, wy + 2.0, wz + s * 0.95]], tileC, 0.6);
      }
    }
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
  let farCover: { wood: [number, number, number]; grass: [number, number, number]; sward?: [number, number, number]; bare?: [number, number, number, number]; ring?: [number, number, number] } | undefined;
  const arrival: { spawn: Vector3 | null; track: [number, number][] } = { spawn: null, track: [] };
  const fences: { min: Vector3; max: Vector3 }[] = [];
  let underDeep: { min: Vector3; max: Vector3 } | undefined;
  let groundLow = Infinity;
  // Where smoke rises out of doors.
  const smokes: { x: number; y: number; z: number; height: number }[] = [];
  let paving: SceneDescription['paving'], lamps: SceneDescription['lamps'];
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
  const waters: { x: number; z: number; r: number; level: number; outline?: number[]; far?: boolean }[] = [];
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
  if (plainStone) wild.materialFor = castleStone;
  wild.group = 'wild';
  const scenery: { meshes: Map<string, MeshBuilder>; cards: CardSet[] } = { meshes: wild.meshes, cards: [] };
  const trees: [number, number][] = [];

  // ------------------------------------------------------------------ caves
  yield { label: 'Tracing the caves', at: 0.05 };
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
    buildFront(p, fx0, fx1);
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const made = buildIsland({ site, p, kit, wild, rng: rng.fork('approach'), planting, cards: scenery.cards, fences, finds, outerRects, stoneTint, flag });
    // The island's castle about the house, as a valley's: its curtain wall on the island's own ground, its towers and gate, and its keep.
    if (site.castle && site.island) {
      const isle = site.island, wasGroup = wild.group;
      wild.group = 'castle';
      buildCastle({ c: site.castle, mesh: (material) => wild.mesh(material), ground: (x, z) => islandLandAt(isle, p.floor, x, z), floor: p.floor, stone: stoneTint });
      wild.group = wasGroup;
      for (const t of (site.towers ?? []).filter((q) => q.castle)) buildTower(t, p.floor);
    }
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
    hallTorches.push(...made.torches);
    scenery.cards.push(...planting.sets);
  };
  // A town in place of a valley: the same, with the town's own builder (see `town.ts`), which gives what the island's does.
  const buildTownApproach = (p: Place) => {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const fx0 = Math.max(p.x0 - 0.2, Math.min(...outerRects.map((r) => r.x0))), fx1 = Math.min(p.x1 + 0.2, Math.max(...outerRects.map((r) => r.x1)));
    buildFront(p, fx0, fx1);
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const made = buildTown({ site, p, kit, wild, rng: rng.fork('approach'), planting, cards: scenery.cards, fences, finds, outerRects, stoneTint, flag: built.flag });
    // A city's citadel, built as a valley's castle is: its curtain, towers, gate, stair, ranges and well (`render/castle.ts`), on the
    // town's own ground about a bailey levelled at its floor; and its keep, as the castle's keep is built.
    if (site.town?.citadel) {
      const T = site.town, cd = T.citadel!, wasGroup = wild.group;
      wild.group = 'castle';
      buildCastle({ c: cd.castle, mesh: (material) => wild.mesh(material), ground: (x, z) => townGround(T, p.floor, x, z), floor: cd.floor, stone: stoneTint });
      wild.group = wasGroup;
      buildTower(cd.keep, cd.floor);
    }
    smokes.push(...made.smokes);
    paving = made.paving;
    lamps = made.lamps;
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
    hallTorches.push(...made.torches);
    scenery.cards.push(...planting.sets);
  };
  // A mountain top in place of a valley: the same, with the mountain's own builder (see `mountain.ts`).
  let cloudDeck: SceneDescription['deck'], rockSharp: number | undefined, nearFar: SceneDescription['nearFar'];
  function* buildMountainApproach(p: Place, span: [number, number]): Generator<MeshStage, void, void> {
    kit.group = `p${p.id}`;
    kit.field = outdoorFieldAt(p.floor, 1.2);
    const fx0 = Math.max(p.x0 - 0.2, Math.min(...outerRects.map((r) => r.x0))), fx1 = Math.min(p.x1 + 0.2, Math.max(...outerRects.map((r) => r.x1)));
    buildFront(p, fx0, fx1);
    wild.field = outdoorFieldAt(p.floor, 1.5);
    const made = yield* buildMountain({ span, site, p, kit, wild, rng: rng.fork('approach'), planting, cards: scenery.cards, fences, finds, outerRects, stoneTint, flag });
    arrival.spawn = made.spawn;
    arrival.track = made.track;
    farCover = made.far;
    spawnYaw = made.yaw;
    cloudDeck = made.deck;
    nearFar = made.nearFar;
    censuses.push(made.planted);
    lookouts.push(made.lookout);
    hallTorches.push(...made.torches);
    rockSharp = made.sharp;
    birdSpots = made.birds;
    flockSpots = made.flocks;
    smokes.push(...made.smokes);
    scenery.cards.push(...planting.sets);
  }
  const glows: { from: Vector3; position: Vector3; colour: [number, number, number]; strength: number }[] = [];
  // Where a cave's shaft comes up through the hill, the turf laid over the house is left open.
  const skylights = places.filter((q) => q.shaft).map((q) => ({ x0: q.shaft!.x - q.shaft!.r * 1.5 - 0.6, x1: q.shaft!.x + q.shaft!.r * 1.5 + 0.6, z0: q.shaft!.z - q.shaft!.r * 1.5 - 0.6, z1: q.shaft!.z + q.shaft!.r * 1.5 + 0.6 }));

  for (const p of places) {
    const at0 = 0.1 + 0.8 * (places.indexOf(p) / places.length), at1 = 0.1 + 0.8 * ((places.indexOf(p) + 1) / places.length);
    const what = p.role === 'approach' ? (site.island ? 'Raising the island, its cliffs and its trees' : site.town ? 'Laying out the town, its harbour, streets and buildings' : site.mountain ? 'Raising the mountain, its rock and its way up' : 'Carving the valley, its rock and its trees')
      : p.roof === 'cave' ? `Carving cave chamber ${p.id + 1} of ${places.length}` : `Laying stone: place ${p.id + 1} of ${places.length}`;
    yield { label: what, at: at0 };
    // (A place is built in one go, and some take seconds: where it is cut into parts, each says which it is on, so that the screen
    // does not hold still on one line and look hung.)
    const part = (name: string, f: number): MeshStage => ({ label: `${what}: ${name}`, at: at0 + (at1 - at0) * f });
    if (p.role === 'approach') { if (site.island) buildIslandApproach(p); else if (site.town) buildTownApproach(p); else if (site.mountain) yield* buildMountainApproach(p, [at0, at1]); else buildApproach(p); continue; }
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
      const wells = stairsInto(p).map(headLeg).map(wellRect);
      for (const r of without({ x0: p.x0 - 0.1, x1: p.x1 + 0.1, z0: p.z0 - 0.1, z1: p.z1 + 0.1 }, wells)) {
        if ((p.level ?? 0) > 0) kit.plane('wood', V(r.x0, p.floor, r.z0), V(0, 0, 1), V(1, 0, 0), V(0, 1, 0), r.z1 - r.z0, r.x1 - r.x0, plank);
        else kit.slab('floor', r.x0, r.z0, r.x1, r.z1, p.floor, open ? flag : hallFlag);
      }
      // Solid under it, unless there is a room there.
      // (In a cathedral, rooms lie under parts of others without a stair between: the solid is left out over each.)
      if (!roomUnder(p)) for (const r of without({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 }, placesUnder(p))) kit.mass(V(r.x0, p.floor - 1.2, r.z0), V(r.x1, p.floor - 0.035, r.z1));
      for (const w of stairsInto(p).map(headLeg)) {
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
      for (const w of stairsFrom(p).filter((x) => x.round)) {
        // A stair round the walls: each step a block set into the wall and carried out from it, a hand deeper than a step so that
        // the flight has a soffit under it; a slab at each landing in the corners; and a rail along the open side, posts and a top
        // rail following the flight, so that nobody steps off it into the well of the tower.
        const { legs, landings, width } = roundStair(site, w), stepStyle: MasonryStyle = { ...hallFlag, course: [0.45, 0.45], length: [1.4, 1.4] };
        const rail = anyAngle((m) => kit.mesh(m)), oak: [number, number, number] = [0.36, 0.25, 0.16];
        const inner = (side: Side, along: number, off: number): [number, number] => (side === 'n' ? [along, p.z0 + off] : side === 's' ? [along, p.z1 - off] : side === 'w' ? [p.x0 + off, along] : [p.x1 - off, along]);
        const post = (x: number, z: number, y: number) => kit.box('wood', V(x - 0.05, y - 0.05, z - 0.05), V(x + 0.05, y + 1.0, z + 0.05), beam, beam, 'post');
        const bar = (a: [number, number, number], b: [number, number, number]) => {
          const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * 0.04, nz = (dx / l) * 0.04;
          rail.solid('wood', [[a[0] - nx, a[1] - 0.05, a[2] - nz], [a[0] + nx, a[1] - 0.05, a[2] + nz], [b[0] + nx, b[1] - 0.05, b[2] + nz], [b[0] - nx, b[1] - 0.05, b[2] - nz], [a[0] - nx, a[1] + 0.04, a[2] - nz], [a[0] + nx, a[1] + 0.04, a[2] + nz], [b[0] + nx, b[1] + 0.04, b[2] + nz], [b[0] - nx, b[1] + 0.04, b[2] - nz]], oak);
        };
        // (Each step one stone, its arrises worn: a solid with its edges taken off, and not coursed masonry, of which a tower's
        // hundreds of steps would be a quarter of a million triangles.)
        const stepTone: [number, number, number] = [hallFlag.tint[0] * 0.95, hallFlag.tint[1] * 0.95, hallFlag.tint[2] * 0.95];
        const stone = (b: { min: Vector3; max: Vector3 }) => { const { min: a, max: c } = b; kit.mass(a, c); rail.rounded('floor', [[a.x, a.y, a.z], [c.x, a.y, a.z], [c.x, a.y, c.z], [a.x, a.y, c.z], [a.x, c.y, a.z], [c.x, c.y, a.z], [c.x, c.y, c.z], [a.x, c.y, c.z]], stepTone, 0.02); };
        void stepStyle;
        for (const leg of legs) {
          const fr = frameOf(p, leg.side, 0), dir = leg.to >= leg.from ? 1 : -1;
          for (let k = 0; k < leg.steps; k++) {
            const a = leg.from + dir * k * ROUND_TREAD, top = p.floor + leg.y0 + STEP * (k + 1);
            stone(wallBox(fr, alongFrame(p, leg.side, a, 0), alongFrame(p, leg.side, a + dir * ROUND_TREAD, 0), Math.max(p.floor - 0.05, top - 0.45), top, 0.12, -width));
          }
          // (The rail rises a step's height a tread; its posts stand on the steps, a little in from their open edge.)
          const n = Math.max(2, Math.ceil(Math.abs(leg.to - leg.from) / 1.1) + 1);
          for (let i = 0; i < n; i++) {
            const along = leg.from + (leg.to - leg.from) * (i / (n - 1)), [x, z] = inner(leg.side, along, width - 0.07);
            post(x, z, p.floor + leg.y0 + STEP * Math.max(1, Math.min(leg.steps, Math.ceil((i / (n - 1)) * leg.steps))));
          }
          const [ax, az] = inner(leg.side, leg.from, width - 0.07), [bx, bz] = inner(leg.side, leg.to, width - 0.07);
          bar([ax, p.floor + leg.y0 + STEP + 0.95, az], [bx, p.floor + leg.y0 + STEP * leg.steps + 0.95, bz]);
        }
        for (const l of landings) {
          stone({ min: V(l.x0, p.floor + l.y - 0.4, l.z0), max: V(l.x1, p.floor + l.y, l.z1) });
          // (Its two open sides are where the flights come onto it and go off it; only its inner corner looks into the well, and a post
          // stands there, where the rails of the two flights meet.)
          const cxL = l.x0 <= p.x0 + 0.01 ? l.x1 : l.x0, czL = l.z0 <= p.z0 + 0.01 ? l.z1 : l.z0, wx = l.x0 <= p.x0 + 0.01 ? p.x0 : p.x1, wz = l.z0 <= p.z0 + 0.01 ? p.z0 : p.z1;
          post(cxL + (cxL > wx ? -0.07 : 0.07), czL + (czL > wz ? -0.07 : 0.07), p.floor + l.y);
        }
      }
      for (const w of stairsFrom(p).filter((x) => !x.round)) {
        // The flight: courses of stone a step high, each a step shorter than the one under it.
        const f = flightOf(w), fr = frameOf(p, w.side, 0), stepStyle: MasonryStyle = { ...hallFlag, course: [STEP, STEP], length: [0.8, 1.3] };
        for (let k = 1; k <= f.steps; k++) {
          const b = wallBox(fr, alongFrame(p, w.side, w.at + f.dir * (k - 1) * f.tread, 0), alongFrame(p, w.side, f.to, 0), p.floor + STEP * (k - 1) - (k === 1 ? 0.05 : 0), p.floor + STEP * k, 0, -f.wide);
          kit.box('floor', b.min, b.max, stepStyle, hallFlag, 'step');
        }
      }
    }

    // Walls, and the solid behind them.
    yield part('walls', 0.1);
    for (const side of SIDES) {
      const top = wallTop(p, side);
      const f = frameOf(p, side, 0.1);
      const mid = f.length / 2;
      const R = span(p) / 2;
      const end = p.roof === 'barrel' && isEndWall(p, side);
      // A cave has masonry only where the builders walled it off to hang a door.
      // (Under a pointed vault the end wall is cut to its point; under a vault of more than one span it is built up whole, and each
      // span's vault meets it.)
      if (!cave || holesOn(p, side, 0).some((h) => !h.way.natural)) {
        const keep = end && (p.spans ?? 1) <= 1 ? (u: number, y: number) => y < roofY + 0.3 || archSdf(u - mid, y - roofY, R, pointOf(p)) < 0.45 : undefined;
        // (A cathedral's walls higher than a man sees close are of larger blocks, from a course a little over the doors.)
        const split = cath && top - p.floor > 9 ? p.floor + NEAR : top;
        kit.wallFace('stone', f, cave ? p.floor - 0.6 : p.floor - 0.1, split, cath ? midStone : ashlar, { openings: holesOn(p, side, 0.1), keep });
        if (split < top) kit.wallFace('stone', f, split, top, big, { openings: holesOn(p, side, 0.1), keep, courseKey: 'high' });
      }
      // Solid behind the wall, one wall's thickness deep; beyond that is another place or the outside.
      const ext = T / 2 + 0.02;
      kit.wallMass(frameOf(p, side, ext), T, p.floor - 1.2, p.roof === 'sky' ? top : solidTop(p), holesOn(p, side, ext));
    }

    // Roof.
    yield part('roof', 0.4);
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
      const n = p.spans ?? 1, R = span(p) / 2 / n, k = pointOf(p);
      const axis = p.axis === 'x' ? V(1, 0, 0) : V(0, 0, 1), across = p.axis === 'x' ? V(0, 0, 1) : V(1, 0, 0);
      const length = (p.axis === 'x' ? dx : dz) + 0.2;
      // (Each span its own vault; between them, a row of columns under a beam of stone that the vaults spring from.)
      const offsets = Array.from({ length: n }, (_, i) => -span(p) / 2 + R * (2 * i + 1));
      for (const o of offsets) {
        const start = (p.axis === 'x' ? V(p.x0 - 0.1, roofY, cz) : V(cx, roofY, p.z0 - 0.1)).addScaledVector(across, o);
        kit.barrelVault('stone', start, axis, length, R, cath && R > 1.6 ? bigVault : vaultStone, k);
      }
      kit.mass(V(p.x0 - T / 2, roofY + vaultRise(p) + 0.06, p.z0 - T / 2), V(p.x1 + T / 2, solidTop(p), p.z1 + T / 2));
      if (n > 1) {
        const lo = p.axis === 'x' ? p.x0 : p.z0, hi = p.axis === 'x' ? p.x1 : p.z1, bays = Math.max(2, Math.round((hi - lo) / 3.2));
        for (let i = 1; i < n; i++) {
          const line = (p.axis === 'x' ? cz : cx) - span(p) / 2 + 2 * R * i;
          const at = (along: number, acr: number, y: number) => (p.axis === 'x' ? V(along, y, acr) : V(acr, y, along));
          const box = (a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, style: MasonryStyle, tag: string) => {
            const A0 = at(a0, c0, y0), A1 = at(a1, c1, y1);
            kit.box('stone', V(Math.min(A0.x, A1.x), y0, Math.min(A0.z, A1.z)), V(Math.max(A0.x, A1.x), y1, Math.max(A0.z, A1.z)), style, coping, tag);
          };
          // The beam the two vaults spring from, from wall to wall over the columns.
          box(lo - 0.1, hi + 0.1, line - 0.28, line + 0.28, roofY - 0.42, roofY + R * 0.55, dressed, 'beam');
          for (let j = 1; j < bays; j++) {
            const a = lo + ((hi - lo) * j) / bays;
            // A column: a square base, a round shaft as a drum of stone (here eight-sided), and a cushion capital under the beam.
            box(a - 0.36, a + 0.36, line - 0.36, line + 0.36, p.floor - 0.05, p.floor + 0.32, coping, 'base');
            const c = at(a, line, 0), drum = anyAngle((m) => kit.mesh(m)), r = 0.24, sides = 8, y0 = p.floor + 0.32, y1 = roofY - 0.62;
            for (let q = 0; q < sides; q++) {
              const t0 = (q / sides) * Math.PI * 2, t1 = ((q + 1) / sides) * Math.PI * 2, ca = Math.cos(t0) * r, sa = Math.sin(t0) * r, cb2 = Math.cos(t1) * r, sb = Math.sin(t1) * r;
              drum.face('stone', [[c.x + ca, y0, c.z + sa], [c.x + cb2, y0, c.z + sb], [c.x + cb2, y1, c.z + sb], [c.x + ca, y1, c.z + sa]], [0.78 * stoneTint[0], 0.72 * stoneTint[1], 0.62 * stoneTint[2]], [c.x, (y0 + y1) / 2, c.z]);
            }
            box(a - 0.34, a + 0.34, line - 0.34, line + 0.34, roofY - 0.62, roofY - 0.42, coping, 'capital');
          }
        }
      }

      // In a cathedral's crypt, tombs: a chest of stone in each bay of its side spans, an effigy lying on its lid, clear of the doors
      // and of the stair's foot; the middle span is the way through.
      if (cath && p.name === 'crypt' && n > 2) {
        const lo = p.axis === 'x' ? p.x0 : p.z0, hi = p.axis === 'x' ? p.x1 : p.z1, bays = Math.max(2, Math.round((hi - lo) / 3.2)), tq = rng.fork(`tombs${p.id}`);
        const sidesAcross: Side[] = p.axis === 'x' ? ['n', 's'] : ['w', 'e'];
        for (const [k2, o] of [[0, offsets[0]], [1, offsets[n - 1]]] as [number, number][]) {
          const doors = holesOn(p, sidesAcross[k2], 0);
          for (let j = 0; j < bays; j++) {
            const a0 = lo + ((hi - lo) * j) / bays, a1 = lo + ((hi - lo) * (j + 1)) / bays, am = (a0 + a1) / 2;
            if (a1 - a0 < 2.8 || doors.some((h) => Math.abs(h.at - am) < h.w + 2.2) || !tq.chance(0.75)) continue;
            const c = (p.axis === 'x' ? cz : cx) + o, L = Math.min(2.2, a1 - a0 - 0.9), W = Math.min(0.95, R * 1.1);
            const at = (along: number, acr: number) => (p.axis === 'x' ? [along, acr] : [acr, along]);
            const [x0, z0] = at(am - L / 2, c - W / 2), [x1, z1] = at(am + L / 2, c + W / 2);
            kit.box('stone', V(Math.min(x0, x1), p.floor - 0.05, Math.min(z0, z1)), V(Math.max(x0, x1), p.floor + 0.78, Math.max(z0, z1)), dressed, coping, 'tomb');
            kit.box('stone', V(Math.min(x0, x1) - 0.06, p.floor + 0.78, Math.min(z0, z1) - 0.06), V(Math.max(x0, x1) + 0.06, p.floor + 0.92, Math.max(z0, z1) + 0.06), coping, coping, 'tomblid');
            // The effigy: a figure lying with its hands joined, as a long block with a head at one end and a cushion under it.
            const [e0x, e0z] = at(am - L / 2 + 0.25, c - W * 0.22), [e1x, e1z] = at(am + L / 2 - 0.45, c + W * 0.22);
            kit.box('stone', V(Math.min(e0x, e1x), p.floor + 0.92, Math.min(e0z, e1z)), V(Math.max(e0x, e1x), p.floor + 1.12, Math.max(e0z, e1z)), dressed, dressed, 'effigy');
            const [hx, hz] = at(am + L / 2 - 0.3, c);
            kit.box('stone', V(hx - 0.13, p.floor + 0.92, hz - 0.13), V(hx + 0.13, p.floor + 1.18, hz + 0.13), dressed, dressed, 'effigyhead');
          }
        }
      }

      const slots = pilasterSlots.get(p.id)!;
      for (const pos of new Set(slots.map((s) => s.pos))) {
        for (const o of offsets) kit.rib('stone', (p.axis === 'x' ? V(pos, roofY, cz) : V(cx, roofY, pos)).addScaledVector(across, o), axis, R, n > 1 ? 0.36 : 0.52, n > 1 ? 0.2 : 0.3, cath && R > 2 ? bigDressed : dressed, k);
      }
      for (const s of slots) {
        // In the wall's own terms: along it, and out of the wall into the room (negative depth).
        const f = frameOf(p, s.side, 0);
        const u = alongFrame(p, s.side, s.pos, 0);
        if (s.clear) {
          const b = wallBox(f, u - 0.26, u + 0.26, p.floor - 0.1, roofY - 0.2, 0.05, -0.3);
          kit.box('stone', b.min, b.max, roofY - p.floor > 9 ? big : ashlar);
        }
        const c = wallBox(f, u - 0.33, u + 0.33, roofY - 0.2, roofY + 0.02, 0.05, -0.37);
        kit.box('stone', c.min, c.max, coping, coping, 'impost');
      }
    } else if (p.roof === 'timber') {
      const alongX = dx >= dz;
      // Boards on beams; with a well left in them wherever a stair goes up through to the room above.
      const wells = stairsFrom(p).map(headLeg).map(wellRect);
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
      if (!roomOver(p)) kit.mass(V(p.x0 - T / 2, roofY + 0.08, p.z0 - T / 2), V(p.x1 + T / 2, solidTop(p), p.z1 + T / 2));
    }

    // Furnishings by role.
    yield part('furnishing', 0.7);
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
        // The garth inside the walk is, in most cloisters, a garden: four plots of grass behind low kerbs of stone, the paths between
        // them crossing at the well, and here and there flowers. Kept short where the house is kept, grown long where it is not; not
        // under snow. (A broad court all of flags was a yard, not a cloister.) From a stream of its own.
        const gq = rng.fork(`garth${p.id}`);
        if (gq.chance(0.7) && site.setting.season !== 'winter') {
          const { solid } = anyAngle((m) => kit.mesh(m));
          const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [number, number, number][] => [
            [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
          const edge = 2.3, path = 0.8, kerb = 0.13, k = 0.12, long = site.setting.condition === 'kept' ? 0 : site.setting.condition === 'damp' ? 0.5 : 1;
          const levers = site.levers.filter((l) => l.place === p.id);
          // (Four plots where the garth has room both ways; where it has room only one way, two, one either side of the well.)
          const gx0 = p.x0 + edge, gx1 = p.x1 - edge, gz0 = p.z0 + edge, gz1 = p.z1 - edge, wideX = gx1 - gx0 >= 2.4 + 2 * path, wideZ = gz1 - gz0 >= 2.4 + 2 * path;
          const split = wideX && wideZ ? path : 1.35;
          const spansX = wideX ? [[gx0, wx - split], [wx + split, gx1]] : wideZ ? [[gx0, gx1]] : [];
          const spansZ = wideZ ? [[gz0, wz - (wideX ? split : 1.35)], [wz + (wideX ? split : 1.35), gz1]] : wideX ? [[gz0, gz1]] : [];
          for (const [ax, bx] of spansX) for (const [az, bz] of spansZ) {
            if (bx - ax < 1.2 || bz - az < 1.2 || levers.some((l) => l.x > ax - 0.8 && l.x < bx + 0.8 && l.z > az - 0.8 && l.z < bz + 0.8)) continue;
            for (const [x0, z0, x1, z1] of [[ax, az, bx, az + k], [ax, bz - k, bx, bz], [ax, az + k, ax + k, bz - k], [bx - k, az + k, bx, bz - k]]) {
              kit.box('stone', V(x0, y - 0.05, z0), V(x1, y + kerb, z1), coping, coping, 'garthkerb');
            }
            solid('plaster', box(ax + k, y - 0.02, az + k, bx - k, y + kerb - 0.03, bz - k), [0.17, 0.12, 0.08]);
            const top = y + kerb - 0.03, area = (bx - ax - 2 * k) * (bz - az - 2 * k);
            // (Close set, and of a deeper green than the meadow's: it grows in the shade of the walls round it.)
            for (let n = Math.round(area * 14); n > 0; n--) {
              const x = gq.range(ax + k + 0.08, bx - k - 0.08), z = gq.range(az + k + 0.08, bz - k - 0.08), tone = gq.range(0.75, 1.1), tall = gq.range(0.2, 0.34) + long * gq.range(0.2, 0.55);
              planting.tuft(planting.grass, x, top - 0.03, z, gq.range(0.4, 0.6), tall, gq.range(0, Math.PI), [0.05 * tone, 0.105 * tone, 0.024 * tone]);
            }
            const fq = rng.fork(`garth${p.id}/${Math.round(ax * 10)},${Math.round(az * 10)}`);
            if (fq.chance(0.6)) {
              const hue: [number, number, number] = fq.pick([[0.62, 0.1, 0.1], [0.8, 0.7, 0.2], [0.8, 0.8, 0.74], [0.45, 0.2, 0.55]]);
              for (let n = fq.int(3, 9); n > 0; n--) {
                const x = fq.range(ax + k + 0.15, bx - k - 0.15), z = fq.range(az + k + 0.15, bz - k - 0.15), size = fq.range(0.3, 0.45);
                planting.tuft(planting.flowers, x, top - 0.02, z, size, size * fq.range(0.9, 1.3), fq.range(0, Math.PI), hue);
              }
            }
          }
        }
      }
    }
    // The hearth, the hung ring of candles and the standing candelabrum this room has, if any (decided with its torches).
    {
      const { solid } = anyAngle((m) => kit.mesh(m));
      const corners = (a: { min: Vector3; max: Vector3 }): [number, number, number][] => [
        [a.min.x, a.min.y, a.min.z], [a.max.x, a.min.y, a.min.z], [a.max.x, a.min.y, a.max.z], [a.min.x, a.min.y, a.max.z],
        [a.min.x, a.max.y, a.min.z], [a.max.x, a.max.y, a.min.z], [a.max.x, a.max.y, a.max.z], [a.min.x, a.max.y, a.max.z]];
      const cube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => corners({ min: V(x0, y0, z0), max: V(x1, y1, z1) });
      /** A thin square rod of iron from one point to another, as a chain or a leg is drawn from far enough off. */
      const rod = (a: Vector3, b: Vector3, w: number, colour: [number, number, number]) => {
        const d = b.clone().sub(a).normalize(), side = Math.abs(d.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
        const u = side.clone().cross(d).normalize().multiplyScalar(w), v = d.clone().cross(u).normalize().multiplyScalar(w);
        const ring = (q: Vector3): [number, number, number][] => [q.clone().sub(u).sub(v), q.clone().add(u).sub(v), q.clone().add(u).add(v), q.clone().sub(u).add(v)].map((r) => [r.x, r.y, r.z]);
        solid('metal', [...ring(a), ...ring(b)], colour);
      };
      const IRON: [number, number, number] = [0.05, 0.045, 0.04], WAX: [number, number, number] = [0.9, 0.86, 0.74];
      /** A candle on a dish, its wick's tip at `wick`. */
      const candle = (wick: Vector3, dishAt: number) => {
        solid('metal', cube(wick.x - 0.05, dishAt, wick.z - 0.05, wick.x + 0.05, dishAt + 0.015, wick.z + 0.05), IRON);
        solid('plaster', cube(wick.x - 0.016, dishAt + 0.015, wick.z - 0.016, wick.x + 0.016, wick.y - 0.01, wick.z + 0.016), WAX);
      };
      const hearth = hearthOf.get(p.id);
      if (hearth) {
        // A hearth of dressed stone against the wall: the hearthstone, a cheek either side, a mantel across them, and over that a hood
        // and then a breast up to the ceiling, which carries the flue. Inside, the back black with soot, and logs on two iron dogs.
        const f = frameOf(p, hearth.side, 0), u = alongFrame(p, hearth.side, hearth.at, 0), y = p.floor, top = roofY - 0.02;
        const at = (u0: number, u1: number, y0: number, y1: number, t0: number, t1: number) => wallBox(f, u + u0, u + u1, y0, y1, t0, t1);
        const put = (b: { min: Vector3; max: Vector3 }, style: typeof dressed, tag: string) => kit.box('stone', b.min, b.max, style, coping, tag);
        put(at(-1.35, 1.35, y - 0.03, y + 0.07, 0, -1.0), coping, 'hearthstone');
        put(at(-1.35, -0.95, y + 0.07, y + 1.3, 0, -0.8), dressed, 'cheek');
        put(at(0.95, 1.35, y + 0.07, y + 1.3, 0, -0.8), dressed, 'cheek');
        put(at(-1.45, 1.45, y + 1.3, y + 1.62, 0, -0.9), coping, 'mantel');
        put(at(-1.25, 1.25, y + 1.62, Math.min(top, y + 2.3), 0, -0.75), dressed, 'hood');
        if (top > y + 2.4) put(at(-0.95, 0.95, y + 2.3, top, 0, -0.55), dressed, 'breast');
        solid('stone', corners(at(-0.95, 0.95, y + 0.07, y + 1.3, 0.0, -0.05)), [0.05, 0.045, 0.04]);
        for (const side of [-1, 1]) {
          solid('metal', corners(at(side * 0.42 - 0.025, side * 0.42 + 0.025, y + 0.07, y + 0.32, -0.15, -0.65)), IRON);
        }
        // (Logs drawn as two square rods turned an eighth of a turn to one another, which from a step away is a round log.)
        const log = (u0: number, u1: number, h: number, t: number, r: number, colour: [number, number, number]) => {
          const a = at(u0, u0, h, h, t, t).min, b = at(u1, u1, h, h, t, t).min, d = b.clone().sub(a).normalize();
          for (const turn of [0, Math.PI / 4]) {
            const n = V(0, 1, 0).applyAxisAngle(d, turn).multiplyScalar(r), m = d.clone().cross(n).normalize().multiplyScalar(r);
            const ring = (q: Vector3): [number, number, number][] => [q.clone().sub(n).sub(m), q.clone().add(m).sub(n), q.clone().add(n).add(m), q.clone().add(n).sub(m)].map((v) => [v.x, v.y, v.z]);
            solid('wood', [...ring(a), ...ring(b)], colour);
          }
        };
        log(-0.55, 0.5, y + 0.28, -0.38, 0.07, [0.14, 0.09, 0.055]);
        log(-0.45, 0.55, y + 0.3, -0.56, 0.065, [0.12, 0.08, 0.05]);
        log(-0.4, 0.42, y + 0.42, -0.47, 0.06, [0.1, 0.065, 0.04]);
        solid('wood', corners(at(-0.35, 0.35, y + 0.07, y + 0.12, -0.25, -0.62)), [0.04, 0.03, 0.025]);
      }
      const ring = ringOf.get(p.id);
      if (ring) {
        // An iron ring of six candles, hung on three chains to a hook and from the hook on one to the ceiling. (A cathedral's corona
        // is greater: twelve candles on a ring two and a half metres across.)
        const great = coronaOf(p), RR = great ? 1.3 : 0.5, cn = great ? 12 : 6;
        const R0 = RR - 0.04 - (great ? 0.04 : 0), R1 = RR + 0.04 + (great ? 0.04 : 0), n = great ? 28 : 16;
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, y0 = ring.y - 0.02, y1 = ring.y + 0.02;
          const c = (r: number, a: number, h: number): [number, number, number] => [ring.x + r * Math.cos(a), h, ring.z + r * Math.sin(a)];
          solid('metal', [c(R0, a0, y0), c(R1, a0, y0), c(R1, a1, y0), c(R0, a1, y0), c(R0, a0, y1), c(R1, a0, y1), c(R1, a1, y1), c(R0, a1, y1)], IRON);
        }
        const hook = ring.clone().setY(ring.y + (great ? 1.6 : 0.8)), ceiling = p.roof === 'barrel' ? p.floor + p.wall + vaultRise(p) : roofY;
        for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; rod(V(ring.x + RR * Math.cos(a), ring.y + 0.02, ring.z + RR * Math.sin(a)), hook, great ? 0.012 : 0.008, IRON); }
        rod(hook, hook.clone().setY(ceiling + 0.05), great ? 0.02 : 0.012, IRON);
        for (let k = 0; k < cn; k++) candle(V(ring.x + RR * Math.cos((k / cn) * Math.PI * 2), ring.y + 0.2, ring.z + RR * Math.sin((k / cn) * Math.PI * 2)), ring.y + 0.02);
      }
      const stand = standOf.get(p.id);
      if (stand) {
        // A candelabrum of iron: three splayed feet, a shaft with a knop, an arm across with a candle at each end, and one above in the middle.
        const { x, z } = stand, y = p.floor;
        for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + Math.PI / 2; rod(V(x, y + 0.28, z), V(x + 0.28 * Math.cos(a), y + 0.01, z + 0.28 * Math.sin(a)), 0.014, IRON); }
        solid('metal', cube(x - 0.018, y + 0.26, z - 0.018, x + 0.018, y + 1.48, z + 0.018), IRON);
        solid('metal', cube(x - 0.045, y + 0.86, z - 0.045, x + 0.045, y + 0.94, z + 0.045), IRON);
        solid('metal', cube(x - 0.27, y + 1.45, z - 0.016, x + 0.27, y + 1.48, z + 0.016), IRON);
        solid('metal', cube(x - 0.016, y + 1.48, z - 0.016, x + 0.016, y + 1.55, z + 0.016), IRON);
        for (const dx2 of [-0.24, 0.24]) candle(V(x + dx2, y + 1.62, z), y + 1.48);
        candle(V(x, y + 1.72, z), y + 1.55);
      }
    }
    // On the walk round a tower's spire there is no room for a chest against the parapet: what is kept there lies on a block of stone
    // in the corner of the walk farthest from where the stair comes up. (A chest there filled the walk, and could only be reached by
    // its end, a metre from what lay on it.)
    const walkTop = !!cath && p.roof === 'sky' && (p.level ?? 0) > 0;
    if (walkTop && site.items.some((it) => it.place === p.id)) {
      const up = stairsInto(p)[0], head = up ? stairEnds(site, up).head : [cx, cz];
      const corners: [number, number][] = [[p.x0 + 0.55, p.z0 + 0.55], [p.x1 - 0.55, p.z0 + 0.55], [p.x0 + 0.55, p.z1 - 0.55], [p.x1 - 0.55, p.z1 - 0.55]];
      const [bx, bz] = corners.sort((a, b) => Math.hypot(b[0] - head[0], b[1] - head[1]) - Math.hypot(a[0] - head[0], a[1] - head[1]))[0];
      kit.box('stone', V(bx - 0.26, p.floor - 0.02, bz - 0.26), V(bx + 0.26, p.floor + 0.72, bz + 0.26), dressed, coping, 'keyblock');
      anchors.set(p.id, V(bx, p.floor + 0.72, bz));
    } else if ((p.role === 'goal' || p.role === 'reward') && !cave && !walkTop) {
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
      if (big) dressAltar(p, f, u, half, near, deep, body, lid);
    } else if (site.items.some((it) => it.place === p.id)) {
      // Something is kept here and there is no chest: a pedestal in the middle of the floor.
      kit.box('stone', V(cx - 0.3, p.floor - 0.4, cz - 0.3), V(cx + 0.3, p.floor + 0.14, cz + 0.3), coping, coping, 'base');
      kit.box('stone', V(cx - 0.22, p.floor + 0.14, cz - 0.22), V(cx + 0.22, p.floor + 0.92, cz + 0.22), { ...dressed, length: [0.44, 0.44] }, coping, 'shaft');
      kit.box('stone', V(cx - 0.3, p.floor + 0.92, cz - 0.3), V(cx + 0.3, p.floor + 1.04, cz + 0.3), coping, coping, 'cap');
      anchors.set(p.id, V(cx, p.floor + 1.04, cz));
    }

    yield part('doorways and stairs', 0.9);
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
      // The flight itself, and the floor at its foot. (Of a stair round the walls, all of it that stands low.)
      if (w.round) { keepClear.push(...lowLegs(w)); continue; }
      const f = flightOf(w);
      keepClear.push(flightRect(w), strip(p, w.side, w.at - f.dir * 1.3, w.at, f.wide + 0.4));
      const foot = strip(p, w.side, w.at - f.dir * 0.9, w.at - f.dir * 0.5, f.wide);
      doorPoints.push([(foot.x0 + foot.x1) / 2, (foot.z0 + foot.z1) / 2]);
    }
    for (const w of stairsInto(p).map(headLeg)) {
      // The well, with room to walk round it, and the floor at the head of the stair.
      const f = flightOf(w), r = wellRect(w);
      keepClear.push({ x0: r.x0 - 0.5, x1: r.x1 + 0.5, z0: r.z0 - 0.5, z1: r.z1 + 0.5 }, strip(p, w.side, f.to, f.to + f.dir * 1.3, f.wide + 0.4));
      const head = strip(p, w.side, f.to + f.dir * 0.4, f.to + f.dir * 0.8, f.wide);
      doorPoints.push([(head.x0 + head.x1) / 2, (head.z0 + head.z1) / 2]);
    }
    const anchor = anchors.get(p.id);
    const solids: Rect[] = [];
    // (The hearth, with room before it; and the candelabrum's feet.)
    {
      const h = hearthOf.get(p.id);
      if (h) {
        const f = frameOf(p, h.side, 0), u = alongFrame(p, h.side, h.at, 0), a = wallBox(f, u - 1.45, u + 1.45, 0, 1, 0, -1.0), b = wallBox(f, u - 1.5, u + 1.5, 0, 1, 0, -2.1);
        solids.push({ x0: a.min.x, x1: a.max.x, z0: a.min.z, z1: a.max.z });
        keepClear.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
      }
      const st = standOf.get(p.id);
      if (st) { solids.push({ x0: st.x - 0.32, x1: st.x + 0.32, z0: st.z - 0.32, z1: st.z + 0.32 }); keepClear.push({ x0: st.x - 0.6, x1: st.x + 0.6, z0: st.z - 0.6, z1: st.z + 0.6 }); }
    }
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
      kit.openingTrim('stone', f, op, T, cath && (op.ys - op.y0 > 4 || op.w > 1.4) ? bigDressed : dressed, secret ? (p.id === site.secret ? 'front' : 'back') : 'both');
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
        // (The leaf fills its doorway, which in a church may be higher than a man's door.)
        const leafSpring = Math.max(2.0, op.ys - hi), leafTop = leafSpring > 2.01 ? Math.max(3.2, leafSpring + w.halfWidth * 2 + 0.2) : 3.2;
        const block = wallBox(f, c - w.halfWidth, c + w.halfWidth, hi - 0.3, hi + leafTop, t - 0.14, t + 0.14);
        // A door that starts shut is baked shut, so a locked room does not fill with its neighbour's light.
        if (w.door.leaf === 'shut' || secret) {
          const slab = wallBox(f, c - w.halfWidth - 0.05, c + w.halfWidth + 0.05, hi - 0.3, hi + leafTop, t - 0.03, t + 0.03);
          kit.mass(slab.min, slab.max);
        }
        const leafSeed = `${site.seed}/door${site.ways.indexOf(w)}`;
        doors.push({
          way: site.ways.indexOf(w), hinge, yaw, swing: -faces * 1.62, halfWidth: lw, spring: leafSpring, thickness: thick,
          leaf: w.door.leaf === 'gate' ? null : buildDoorLeaf(leafSeed, lw, leafSpring, thick, secret ? { ...ashlar, length: [0.4, 0.8], course: [0.27, 0.36] } : undefined),
          material: secret ? 'stone' : 'wood',
          blocker: block,
          centre: f.a.clone().addScaledVector(f.dir, c).addScaledVector(f.normal, -t).setY(hi + 1.2),
          barSide: barred === undefined ? 0 : (barred === (highIsHere ? p.id : q.id) ? faces : -faces),
        });
      }
    }
  }

  // ------------------------------------------------------------------ the outside of a house that stands free
  yield { label: 'Walling and roofing the house', at: 0.92 };
  if (free && cath) {
    // A cathedral's outside is its own: see `cathedral.ts`.
    kit.field = outdoorFieldAt(places.find((q) => q.role === 'approach')!.floor, 1.0);
    buildCathedral({ kit, wild, finds, site, outerWindows, shape, ashlar: big, plain: midStone, dressed, coping, stoneTint, rng: rng.fork('cathedral') });
  }
  if (free && !cath) {
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
        // (A castle's hall and ranges are finished with a battlement along the tops of their outer walls, on the cornice, the roofs
        // behind it: what most tells a castle's buildings from a cloister's.)
        if (site.castle) {
          ledge(r, a, b, site.top + 0.12, site.top + 1.15, -0.55, ashlar, 'parapet');
          const teeth = Math.max(1, Math.round((b - a) / 1.7));
          for (let m = 0; m < teeth; m++) ledge(r, a + ((b - a) * (m + 0.2)) / teeth, a + ((b - a) * (m + 0.72)) / teeth, site.top + 1.15, site.top + 1.75, -0.55, ashlar, 'merlon');
        }
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
      const sanctum = q.role === 'goal', pitch = sanctum ? 1.05 : site.castle ? 0.42 : 0.62;
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
      // A castle's chapel shows as one from outside: a bell-cote on its ridge, two piers of dressed stone with the bell hung between
      // them under a capping, and a cross of iron over it. (Asked for: a chapel that shows as one from outside.)
      if (site.castle && /chapel/.test(q.name)) {
        const bx = alongX ? r1.x : cx, bz = alongX ? cz : r1.z, top = y + rise + 0.05;
        for (const off of [-0.5, 0.5]) {
          const px = alongX ? bx : bx + off, pz = alongX ? bz + off : bz;
          kit.box('stone', V(px - 0.16, top - 0.3, pz - 0.16), V(px + 0.16, top + 1.2, pz + 0.16), dressed, coping, 'chapelcote');
        }
        kit.box('stone', V(bx - 0.75, top + 1.2, bz - 0.75), V(bx + 0.75, top + 1.36, bz + 0.75), coping, coping, 'chapelcap');
        kit.box('stone', V(bx - 0.42, top + 1.36, bz - 0.42), V(bx + 0.42, top + 1.62, bz + 0.42), coping, coping, 'chapeltop');
        kit.box('metal', V(bx - 0.19, top + 0.5, bz - 0.19), V(bx + 0.19, top + 0.98, bz + 0.19), coping, coping, 'chapelbell');
        kit.box('metal', V(bx - 0.035, top + 1.62, bz - 0.035), V(bx + 0.035, top + 2.5, bz + 0.035), coping, coping, 'chapelcross');
        kit.box('metal', alongX ? V(bx - 0.035, top + 2.12, bz - 0.28) : V(bx - 0.28, top + 2.12, bz - 0.035), alongX ? V(bx + 0.035, top + 2.2, bz + 0.28) : V(bx + 0.28, top + 2.2, bz + 0.035), coping, coping, 'chapelarm');
      }
      if (sanctum) {
        // The gables: walls of ashlar up under the roof, in courses that step in as the roof narrows; and a bell-cote on the one nearer the front.
        for (const end of [0, 1]) {
          const at = alongX ? (end ? x1 - 0.3 : x0 + 0.3) : (end ? z1 - 0.3 : z0 + 0.3), courses = Math.max(3, Math.round(rise / 0.5));
          for (let k = 0; k < courses; k++) {
            const w = half * (1 - (k + 0.5) / courses) + 0.12, y0 = y - 0.12 + (rise * k) / courses, y1 = y - 0.12 + (rise * (k + 1)) / courses;
            if (alongX) kit.box('stone', V(at - 0.3, y0, cz - w), V(at + 0.3, y1, cz + w), ashlar, coping, 'gable'); else kit.box('stone', V(cx - w, y0, at - 0.3), V(cx + w, y1, at + 0.3), ashlar, coping, 'gable');
          }
        }
        if (site.castle) continue;
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
      // (A castle's walls are thick enough to need none: buttresses down every wall are a church's, or a cloister's.)
      if (site.castle) return;
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
    const turrets = new Set<string>();
    for (const r of runs) for (const end of [r.from, r.to]) {
      const dir = end === r.from ? -1 : 1, [ox, oz] = outward[r.side], along = r.side === 'n' || r.side === 's';
      // (A point just past the end of the run and just inside the wall: if that is outside the house, the corner is an outer one.)
      const px = along ? end + dir * 0.2 : r.at - ox * 0.2, pz = along ? r.at - oz * 0.2 : end + dir * 0.2;
      if (insideOuter(px, pz)) continue;
      kit.group = 'roofs';
      if (site.castle) {
        // A castle's hall has a turret corbelled out at each outer corner of its top instead. (Each corner is met by two runs: once.)
        const cx = along ? end : r.at, cz = along ? r.at : end, key = `${Math.round(cx * 10)},${Math.round(cz * 10)}`;
        if (turrets.has(key)) continue;
        turrets.add(key);
        const dx = ox + (along ? dir : 0), dz = oz + (along ? 0 : dir), l = Math.hypot(dx, dz) || 1, tr = 1.35;
        bartizan((m) => kit.mesh(m), cx + (dx / l) * tr * 0.72, cz + (dz / l) * tr * 0.72, tr, site.top - 3.2, site.top + 1.9, [0.62 * stoneTint[0], 0.6 * stoneTint[1], 0.56 * stoneTint[2]], Math.atan2(dz, dx));
        continue;
      }
      ledge(r, dir < 0 ? end : end - 0.95, dir < 0 ? end + 0.95 : end, low - 0.4, site.top - 0.75, 0.42, ashlar, 'corner');
      ledge(r, dir < 0 ? end : end - 1.05, dir < 0 ? end + 1.05 : end, site.top - 0.75, site.top - 0.6, 0.5, coping, 'cornercap');
    }
    // A chimney stack over every hearth, on the wall it stands against, rising through the roof to above its ridge: ashlar, with a
    // coping and the dark of the flue on top.
    for (const [id, h] of hearthOf) {
      const q = places[id], under = places.find((r) => (r.level ?? 0) === 0 && r.role !== 'approach' && r.x0 === q.x0 && r.x1 === q.x1 && r.z0 === q.z0 && r.z1 === q.z1);
      const ridge = under && ridgeOf.get(under.id);
      if (!ridge) continue;
      kit.group = 'roofs';
      const line = h.side === 'n' ? q.z0 - T / 2 : h.side === 's' ? q.z1 + T / 2 : h.side === 'w' ? q.x0 - T / 2 : q.x1 + T / 2, along = h.side === 'n' || h.side === 's';
      const box = (a: number, c: number, y0: number, y1: number) => along ? [V(h.at - a, y0, line - c), V(h.at + a, y1, line + c)] : [V(line - c, y0, h.at - a), V(line + c, y1, h.at + a)];
      const top = ridge.y + 0.9;
      const [s0, s1] = box(0.55, 0.62, site.top - 0.4, top), [c0, c1] = box(0.66, 0.72, top, top + 0.14);
      kit.box('stone', s0, s1, ashlar, coping, 'stack');
      kit.box('stone', c0, c1, coping, coping, 'stackcope');
      const [f0, f1] = box(0.28, 0.32, top + 0.14, top + 0.15);
      anyAngle((m) => kit.mesh(m)).solid('stone', [[f0.x, f0.y, f0.z], [f1.x, f0.y, f0.z], [f1.x, f0.y, f1.z], [f0.x, f0.y, f1.z], [f0.x, f1.y, f0.z], [f1.x, f1.y, f0.z], [f1.x, f1.y, f1.z], [f0.x, f1.y, f1.z]], [0.02, 0.02, 0.02]);
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
  const min = V(Infinity, -3, Infinity), max = V(-Infinity, Math.max(site.top, ...(cath ? spireTops(site) : [])) + 2, -Infinity);
  for (const p of places) {
    min.x = Math.min(min.x, p.x0 - 3); min.z = Math.min(min.z, p.z0 - 3);
    max.x = Math.max(max.x, p.x1 + 3); max.z = Math.max(max.z, p.z1 + 3);
  }
  if (site.grounds) {
    min.x = Math.min(min.x, site.grounds.x0 - 2); max.x = Math.max(max.x, site.grounds.x1 + 2); max.z = Math.max(max.z, site.grounds.z1 + 2);
    // (A town's country runs on north of the house, behind it: its fields and woods are under the sky as the rest is.)
    if (site.town) min.z = Math.min(min.z, site.grounds.z0 - 2);
  }
  // (And, across the ground, the spaces under the land: the sun's shadow and the two maps of what lies under the sky are drawn over
  // this box, and whatever lay outside it was taken to be in the open. A great hall under a mountain top reaches out to its windows
  // in the precipice, beyond the top; it had the sun on its walls and cloud shadows going over its floor.)
  const hall = site.mountain?.hall;
  const under: [number, number, number][] = [
    ...unders.flatMap((u): [number, number, number][] => [[u.min.x, u.min.z, 0], [u.max.x, u.max.z, 0]]),
    ...(hall ? [hall.out, hall.in, ...hall.stair].map(([x, z]): [number, number, number] => [x, z, hall.wide / 2 + Math.max(0, ...hall.sides.map((q) => q.long + 2)) + 6]) : []),
  ];
  for (const [x, z, r] of under) { min.x = Math.min(min.x, x - r); max.x = Math.max(max.x, x + r); min.z = Math.min(min.z, z - r); max.z = Math.max(max.z, z + r); }
  const approach = places.find((p) => p.role === 'approach') ?? places[site.entrance];
  // About a place built in a world, the world's lakes out to three kilometres, at their own levels, drawn plainly (not mirroring):
  // the water shows only where the land lies under it, so each fills its own hollow in the country round about.
  {
    // (The place's frame in its world, `siteFrame`: a town's lays the middle of its quay on the world's point.)
    const f = siteFrame(site);
    if (f) {
      const frame = { u: f.u, v: f.v, turn: f.turn };
      for (const lk of worldLand(f.world).lakes ?? []) {
        const [x, z] = toSite(frame, f.hx, f.hz, lk.x, lk.z);
        if (Math.hypot(x - f.hx, z - f.hz) > 3000) continue;
        const outline = lk.outline.flatMap(([ox, oz]) => toSite(frame, f.hx, f.hz, ox, oz));
        let r = 0;
        for (let k = 0; k < outline.length; k += 2) r = Math.max(r, Math.hypot(outline[k] - x, outline[k + 1] - z));
        waters.push({ x, z, r, level: lk.level - f.base + f.floor, outline, far: true });
      }
    }
  }
  return {
    meshes: kit.meshes,
    masses: kit.masses,
    torches: [...[...torchesByPlace.values()].flat(), ...hallTorches],
    unders,
    ...(backWay?.cavern ? { lowest: backWay.cavern.floor } : {}),
    ...(underDeep ? { underDeep } : {}),
    ...(groundLow < Infinity ? { groundLow } : {}),
    smokes,
    ...(paving ? { paving } : {}),
    ...(lamps?.length ? { lamps } : {}),
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
    ...(nearFar ? { nearFar } : {}),
    sea: islandSea,
    ...(rockSharp !== undefined ? { rockSharp } : {}),
    ...(cloudDeck ? { deck: cloudDeck, snow: site.setting.season === 'winter' ? 1 : 0.24, snowLine: [approach.floor + 22, site.setting.season === 'winter' ? 0 : 0.4] as [number, number] } : {}),
    // (A valley or a town in winter lies under snow: not as deep as a mountain's, so that what stands up out of it shows.)
    ...(!cloudDeck && site.setting.season === 'winter' ? { snow: 0.85 } : {}),
    flockKind: site.mountain ? 'goat' : 'sheep',
    birds: birdSpots ?? rookSpots,
    birdKind: birdSpots ? (site.mountain ? 'chough' : 'gull') : 'rook',
    flocks: flockSpots,
    fireflies: fireflySpots,
    beacon,
    finds,
  };
}
