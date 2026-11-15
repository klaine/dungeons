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
  | 'dark';

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
  /** What the place is in the fiction. */
  name: string;
}

/** Keys are told apart by their metal. */
export type KeyId = 'iron' | 'gold';

/** A door leaf hung in a doorway, and what stops it opening. */
export interface DoorSpec {
  /** Shut doors open when approached, unless something holds them. Open ones are just standing open. */
  leaf: 'shut' | 'open';
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
}

export interface Site {
  seed: string;
  places: Place[];
  ways: Way[];
  items: Item[];
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
export type Hour = 'morning' | 'midday' | 'evening';

/** Where and when: what the place is built of, what it is called, and the time of day. */
export interface Setting {
  stone: Stone;
  hour: Hour;
  /** What kind of house it is, for its name. */
  kind: string;
}

/** The sun and sky at each time of day, in the renderer's light units. */
export const SKIES: Record<Hour, { sun: [number, number, number]; colour: [number, number, number]; intensity: number; zenith: number[]; horizon: number[]; ground: number[] }> = {
  morning: { sun: [0.5, 0.62, 0.6], colour: [1.0, 0.88, 0.72], intensity: 11, zenith: [0.16, 0.3, 0.62], horizon: [0.66, 0.72, 0.8], ground: [0.09, 0.08, 0.07] },
  midday: { sun: [-0.12, 0.9, 0.42], colour: [1.0, 0.96, 0.9], intensity: 12.5, zenith: [0.14, 0.28, 0.66], horizon: [0.6, 0.72, 0.88], ground: [0.1, 0.09, 0.08] },
  evening: { sun: [-0.62, 0.5, 0.6], colour: [1.0, 0.7, 0.46], intensity: 9.5, zenith: [0.14, 0.22, 0.5], horizon: [0.8, 0.62, 0.48], ground: [0.08, 0.07, 0.06] },
};

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
