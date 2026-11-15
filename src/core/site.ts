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
  | 'sky';

export type Role = 'approach' | 'entrance' | 'passage' | 'court' | 'reward' | 'goal';

export interface Place {
  id: number;
  role: Role;
  roof: Roof;
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

export interface Way {
  /** Place ids. `side` is the wall of place `a` that the way passes through. */
  a: number;
  b: number;
  side: Side;
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
  /** Thickness of the walls between places. */
  wallThickness: number;
  /** Height of the roofline; courts are open wells down from it. */
  top: number;
  entrance: number;
  goal: number;
  /** Unit vector towards the sun. */
  sun: [number, number, number];
  /** One sentence describing the place. */
  title: string;
}

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
