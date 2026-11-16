/**
 * The site document: what a generated place is, independent of how it is drawn.
 *
 * A site is a set of rectangular places, joined by ways. In the first version of this document
 * every place stood on one shared plan and every way went through the wall between two of them.
 * In the second, places may also lie one above another, on storeys, and a way may be a stair
 * that climbs from a place to the one over it. Axes: +x east, +y up, +z south; lengths in metres.
 */

export type Side = 'n' | 's' | 'e' | 'w';

export type Roof =
  /** A half-round stone vault along the place's long axis. */
  | 'barrel'
  /** A flat ceiling of boards on beams. */
  | 'timber'
  /** Open to the sky. */
  | 'sky'
  /** Not built at all: a natural cave, with rock for walls, floor and ceiling. */
  | 'cave';

export type Role = 'approach' | 'entrance' | 'passage' | 'court' | 'reward' | 'goal';

/**
 * How a place is lit. Darkness is a choice the generator makes, not a failure to place lights:
 * a dark room is somewhere the player's own light matters.
 */
export type Lighting =
  /** Open to the sky, or lit through windows and arches from a court. */
  | 'day'
  /** Torches on the walls. */
  | 'torch'
  /** Nothing. Only what the player carries, and what spills in through the doors. */
  | 'dark'
  /** In a cave: growths on the rock that give a faint light of their own. */
  | 'glow';

export interface Place {
  id: number;
  role: Role;
  roof: Roof;
  light: Lighting;
  /** Interior extent. Walls lie outside it. */
  x0: number; x1: number; z0: number; z1: number;
  /** Floor height. */
  floor: number;
  /** Height of the walls above the floor: to the springing of a vault, or to a flat ceiling. */
  wall: number;
  /** Direction a barrel vault runs. */
  axis: 'x' | 'z';
  /** Steps from the entrance, counted in places. */
  depth: number;
  /** What the place is in the fiction. Furnishing follows from it. */
  name: string;
  /** The roof has come down: open to the sky, with what fell still lying there. */
  fallen?: boolean;
  /** In a cave: a hole in the roof, open to the sky above the hill, that lets daylight down. */
  shaft?: { x: number; z: number; r: number };
  /**
   * Which storey the place is on: 0, or left out, for the ground storey that all the places of
   * version 1 stand on; 1 for a room over one of those; -1 for a cellar under one. A place on
   * another storey has the same outline as the place it is over or under, and is reached from
   * it by a stair.
   */
  level?: number;
}

/** Keys are told apart by their metal. */
export type KeyId = 'iron' | 'gold';

/** A door leaf hung in a doorway, and what stops it opening. */
export interface DoorSpec {
  /**
   * Shut doors open when approached, unless something holds them. Open ones are just standing open.
   * A gate is a portcullis: it can be seen through, and only its lever raises it. A secret door
   * is faced in stone to pass for wall, and gives way when pressed.
   */
  leaf: 'shut' | 'open' | 'gate' | 'secret';
  /** Index into the site's levers of the one that raises this gate. */
  lever?: number;
  /** Needs this key. */
  lock?: KeyId;
  /** Barred on the side of this place: it opens only from there, and stays open afterwards. */
  barredFrom?: number;
}

/** Something to pick up. */
export interface Item {
  kind: 'key';
  key: KeyId;
  place: number;
}

/** A lever standing on the floor of a place, which raises a gate somewhere. */
export interface Lever {
  place: number;
  /** Index into the site's ways of the gate it raises. */
  opens: number;
  x: number;
  z: number;
}

export interface Way {
  /** Place ids. `side` is the wall of place `a` that the way passes through. */
  a: number;
  b: number;
  side: Side;
  door?: DoorSpec;
  /**
   * A door is a person-sized arch; an arch is a wide open bay; a window cannot be walked through.
   * A stair does not go through a wall at all. It joins a place (`a`, the lower) to the place
   * directly over it (`b`): a straight flight inside the lower place, hard against its `side`
   * wall, rising from `at` along that wall to `to`, where it comes up through the floor above.
   * `halfWidth` is half the breadth of the flight.
   */
  kind: 'door' | 'arch' | 'window' | 'stair';
  /** Position of the centre along the wall: an x coordinate for north and south walls, z for east and west. */
  at: number;
  halfWidth: number;
  /** For a stair: where along the wall its head is, as `at` is where its foot is. */
  to?: number;
  /**
   * A way between two chambers of a cave: a cleft in the rock, not something built. It has no
   * door and no steps; its floor slopes from the one chamber's level to the other's.
   */
  natural?: boolean;
}

/** Something out in the valley. */
export interface Feature {
  /**
   * A pond lies in a hollow, with a landing stage built out into it from the side nearest the
   * track. Stones are a ring of standing stones on a low rise, with a flat stone in the middle.
   * A ruin is what is left of a small stone hut: broken walls, and a doorway on the side of the track.
   */
  kind: 'pond' | 'stones' | 'ruin';
  x: number;
  z: number;
  /** Radius: of the hollow the pond lies in, of the ring, or of the ground the ruin stands on. */
  r: number;
  /**
   * For a pond: its outline. How far the edge of its hollow lies from the middle in each of an
   * even ring of directions, starting towards +x and turning towards +z, as a share of `r`.
   * Left out, the pond is round. A pond may be a pool a few paces across or a lake that fills
   * its side of the valley; its shore bends away from the track and from whatever else is there.
   */
  shore?: number[];
  /** For a lake: a small island in it, as where its middle is and how far it is across its top. */
  isle?: { x: number; z: number; r: number };
}

/**
 * Running water. It rises at a spring under the rock, or runs out of a pond; it ends in a pond,
 * or goes to ground in a sink at the foot of the rim. The builder cuts it a bed that falls all
 * the way, so it never runs uphill, however the ground lies.
 */
/**
 * A terrace: a shelf of level ground standing out from one of the valley's side walls, part-way
 * up it, with a cliff of its own below and the rest of the wall behind. It is reached by a
 * ledge that rises along the wall from the valley floor, beginning beyond one end of it. From
 * the top the whole valley can be seen, and something has been left at its far end.
 */
export interface Terrace {
  /** Which side wall it stands against: `w` is the side of lesser x. */
  side: 'w' | 'e';
  /** Its level part lies from `z0` to `z1` along the valley. */
  z0: number;
  z1: number;
  /** How far it stands out from the foot of the wall, and how high above the valley floor, in metres. */
  depth: number;
  height: number;
  /** Which end the way up is at (`n` is towards the house), and how far the way up runs along the wall beyond that end. */
  rise: 'n' | 's';
  run: number;
  /** What the way up is: a ledge the rock happens to offer, or steps somebody cut in it, which are steeper and shorter. */
  way: 'ledge' | 'steps';
}

/**
 * A grotto: a cave in one of the valley's side walls. Most are small and natural; some are halls cut by hand (see `hall`). Its mouth is at the foot of the
 * wall, at `z` along the valley; a passage runs in under the hill to a chamber about `r` across
 * the half of it. It has nothing to do with the house. Something glows in it, and something was left there.
 */
export interface Grotto {
  side: 'w' | 'e';
  z: number;
  r: number;
  /**
   * If present, this is no natural cave but a hall hewn under the hill, and `r` is not used.
   * A squared doorway in the rock face opens on a broad stair that goes down `drop` metres, and
   * at its foot is the hall: `length` metres on from there, `width` across, `height` to the
   * crown of its roof, with two rows of pillars down it and a tomb on a dais at the far end.
   * It is lit by torches on the pillars and by nothing else.
   */
  hall?: { length: number; width: number; height: number; drop: number };
}

export interface Stream {
  /** The line it follows, in order from where it begins to where it ends. */
  course: [number, number][];
  /** How broad it is, in metres: a brook is one or two, a small river three or four. */
  width: number;
  /** Where it begins: at a spring under the rim, over the rim as a waterfall, or out of the pond. */
  from: 'spring' | 'fall' | 'pond';
  to: 'pond' | 'sink';
  /** Where it crosses the track, if it does, and how the track gets over: stepping stones through a brook, a timber bridge over a river. */
  crossing?: { x: number; z: number; by: 'ford' | 'bridge' };
}

/** How far the edge of a pond's hollow is from its middle in the direction of (dx, dz), in metres. */
export function shoreOf(f: Feature, dx: number, dz: number): number {
  if (!f.shore || !f.shore.length) return f.r;
  const n = f.shore.length, a = ((Math.atan2(dz, dx) / (Math.PI * 2)) * n + n) % n;
  const i = Math.floor(a), t = a - i, u = t * t * (3 - 2 * t);
  return f.r * (f.shore[i % n] + (f.shore[(i + 1) % n] - f.shore[i % n]) * u);
}

export interface Site {
  seed: string;
  places: Place[];
  ways: Way[];
  items: Item[];
  levers: Lever[];
  /** A place hidden behind a secret door, with something in it worth finding; -1 if there is none. */
  secret: number;
  /**
   * The open country that can be walked, the approach included: a valley shut in by rock, with
   * the house front along its north side. Absent in a site that has no more than its approach.
   */
  grounds?: { x0: number; x1: number; z0: number; z1: number };
  /**
   * The way from the door down the valley, as points from the door outwards. Flags as far as the
   * edge of the approach and a worn track after that. The player arrives at the last point.
   */
  track?: [number, number][];
  /** Things in the valley worth walking to. */
  features?: Feature[];
  /** Running water in the valley, if there is any. */
  streams?: Stream[];
  /** Ground in the valley that stands above its floor and can be climbed to. */
  terraces?: Terrace[];
  /** Caves in the valley's own walls, entered from its floor. */
  grottoes?: Grotto[];
  /** Where the player starts. */
  start: number;
  /** Thickness of the walls between places. */
  wallThickness: number;
  /** Height of the roofline; courts are open wells down from it. */
  top: number;
  entrance: number;
  goal: number;
  setting: Setting;
  /** Unit vector towards the sun. */
  sun: [number, number, number];
  /** One sentence describing the place. */
  title: string;
}

export type Stone = 'limestone' | 'sandstone' | 'greystone' | 'basalt';
export type Hour = 'morning' | 'midday' | 'evening' | 'sunset' | 'dusk' | 'night';

/** Where and when: what the place is built of, what it is called, and the time of day. */
export interface Setting {
  stone: Stone;
  hour: Hour;
  /** What kind of house it is, for its name. */
  kind: string;
  /** How it has fared: looked after, left to the wet, or abandoned long enough for a roof to fall. */
  condition: 'kept' | 'damp' | 'forsaken';
  /** The time of year, which colours everything that grows. */
  season?: 'spring' | 'summer' | 'autumn';
  /** How much of the sky is cloud, from 0 for clear to 1 for overcast. Clouds drift, and shade what is under them. */
  cloud?: number;
  /** Whether that cloud is heaped up or lies in flat banks. */
  cloudForm?: 'heaped' | 'layered';
  /** How much mist lies in the low ground, from 0 for none to 1 for a morning you cannot see across. */
  mist?: number;
  /** How thick the air is with distance, from 0 for the clearest day to 1 for hills that are barely there. */
  haze?: number;
}

/**
 * The light at each time of day, in the renderer's light units.
 *  - `sun` is where the strongest light comes from, and `colour` and `intensity` what it is: the
 *    sun by day, the glow where it went down at dusk, the moon at night.
 *  - `disc` is where the sun itself stands, for drawing the sky; below the horizon after sunset.
 *    Left out, it is where the light comes from.
 *  - `zenith`, `horizon` and `ground` are how bright the sky is overhead and at its edge, and the
 *    light thrown up by the land.
 *  - `night` is how far the stars are out, 0 to 1, and `eyes` how far eyes open in the dark: the
 *    most that exposure may rise to.
 */
export interface Sky {
  sun: [number, number, number];
  colour: [number, number, number];
  intensity: number;
  zenith: number[];
  horizon: number[];
  ground: number[];
  disc?: [number, number, number];
  night?: number;
  eyes?: number;
}

export const SKIES: Record<Hour, Sky> = {
  morning: { sun: [0.5, 0.62, 0.6], colour: [1.0, 0.88, 0.72], intensity: 11, zenith: [0.16, 0.3, 0.62], horizon: [0.66, 0.72, 0.8], ground: [0.09, 0.08, 0.07] },
  midday: { sun: [-0.12, 0.9, 0.42], colour: [1.0, 0.96, 0.9], intensity: 12.5, zenith: [0.14, 0.28, 0.66], horizon: [0.6, 0.72, 0.88], ground: [0.1, 0.09, 0.08] },
  evening: { sun: [-0.62, 0.5, 0.6], colour: [1.0, 0.7, 0.46], intensity: 9.5, zenith: [0.14, 0.22, 0.5], horizon: [0.8, 0.62, 0.48], ground: [0.08, 0.07, 0.06] },
  // The sun a hand's breadth above the hills: long shadows, red light, a sky going from gold to deep blue.
  sunset: { sun: [-0.8, 0.17, 0.57], colour: [1.0, 0.46, 0.2], intensity: 7.5, zenith: [0.07, 0.1, 0.26], horizon: [0.9, 0.46, 0.24], ground: [0.06, 0.045, 0.035], eyes: 2 },
  // The sun gone: no shadows to speak of, a band of rose where it went down, and the first stars.
  dusk: { sun: [-0.78, 0.26, 0.57], colour: [0.9, 0.55, 0.5], intensity: 0.9, zenith: [0.022, 0.032, 0.085], horizon: [0.2, 0.13, 0.15], ground: [0.02, 0.018, 0.02], disc: [-0.8, -0.07, 0.59], night: 0.35, eyes: 3.2 },
  // Moonlight: cold, faint, with shadows; every lit window and torch counts for much more.
  night: { sun: [0.42, 0.72, 0.55], colour: [0.62, 0.74, 1.0], intensity: 0.5, zenith: [0.006, 0.009, 0.024], horizon: [0.014, 0.018, 0.034], ground: [0.006, 0.006, 0.008], disc: [-0.5, -0.6, 0.62], night: 1, eyes: 4.5 },
};

/** How each time of day is put in a sentence. */
export const WHEN: Record<Hour, string> = { morning: 'in the morning', midday: 'at midday', evening: 'at evening', sunset: 'at sunset', dusk: 'at dusk', night: 'by night' };

export const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Ways that can be walked through, as an adjacency list. */
export function neighbours(site: Site): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const p of site.places) adj.set(p.id, []);
  for (const w of site.ways) {
    if (w.kind === 'window') continue;
    adj.get(w.a)!.push(w.b);
    adj.get(w.b)!.push(w.a);
  }
  return adj;
}

/**
 * Where a stair is stood at to go up it, and where one stands having come up: a stride before
 * its foot on the lower floor, and a stride beyond its head on the upper, each in the middle of
 * the flight's breadth. Walking from one to the other in a straight line is walking the stair.
 */
export function stairEnds(site: Site, w: Way): { foot: [number, number]; head: [number, number] } {
  const p = site.places[w.a], to = w.to ?? w.at, dir = to >= w.at ? 1 : -1, off = w.halfWidth;
  const at = (u: number): [number, number] => (w.side === 'n' ? [u, p.z0 + off] : w.side === 's' ? [u, p.z1 - off] : w.side === 'w' ? [p.x0 + off, u] : [p.x1 - off, u]);
  return { foot: at(w.at - dir * 0.6), head: at(to + dir * 0.6) };
}

/** Number of independent loops in the walkable graph: edges minus places plus one, for a connected site. */
export function loopCount(site: Site): number {
  const edges = site.ways.filter((w) => w.kind !== 'window');
  const pairs = new Set(edges.map((w) => `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`));
  return pairs.size - site.places.length + 1;
}

/** Whether every place can be reached on foot from the entrance. */
export function allReachable(site: Site): boolean {
  const adj = neighbours(site);
  const seen = new Set<number>([site.entrance]);
  const queue = [site.entrance];
  while (queue.length) {
    for (const n of adj.get(queue.pop()!)!) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === site.places.length;
}
