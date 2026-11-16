/**
 * The site document: what a generated place is, independent of how it is drawn.
 *
 * This is the first, small version. A site is a set of rectangular places on a shared plan, joined
 * by ways through the walls between them. Axes: +x east, +y up, +z south; lengths in metres.
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
  /** A door is a person-sized arch; an arch is a wide open bay; a window cannot be walked through. */
  kind: 'door' | 'arch' | 'window';
  /** Position of the centre along the wall: an x coordinate for north and south walls, z for east and west. */
  at: number;
  halfWidth: number;
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
