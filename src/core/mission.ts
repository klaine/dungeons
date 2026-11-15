import { Rng } from './rng';
import { KeyId, Site, Way } from './site';

/**
 * The mission: what stands between the player and the goal, and proof that it can be overcome.
 *
 * `planMission` hangs doors, locks and bars on a site and hides the keys. `solve` plays the site
 * as a state search and returns the shortest way through, or reports that there is none. Nothing
 * here can be undone by the player (keys are kept, bars stay lifted), so a site that can be
 * completed from the start can be completed from anywhere: there are no dead ends to fall into.
 */

export interface Move {
  /** Index into `site.ways` of the way taken, and the place arrived at. */
  way: number;
  to: number;
  /** What happened on the way or on arrival, in order. */
  events: string[];
}

export interface Solution {
  ok: boolean;
  moves: Move[];
  /** Number of moves if there were no doors at all, for comparison. */
  direct: number;
}

const walkable = (w: Way) => w.kind !== 'window';
const other = (w: Way, place: number) => (w.a === place ? w.b : w.a);

/** Distances in moves from a place, optionally ignoring some ways. */
function distances(site: Site, from: number, blocked: (w: Way) => boolean = () => false): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    for (const w of site.ways) {
      if (!walkable(w) || blocked(w) || (w.a !== p && w.b !== p)) continue;
      const q = other(w, p);
      if (!dist.has(q)) {
        dist.set(q, dist.get(p)! + 1);
        queue.push(q);
      }
    }
  }
  return dist;
}

export function planMission(site: Site, rng: Rng): void {
  const doors = site.ways.filter((w) => w.kind === 'door');
  const ways = (place: number) => site.ways.filter((w) => walkable(w) && (w.a === place || w.b === place));
  const isLocked = (w: Way) => !!w.door?.lock;
  const entry = doors.find((w) => other(w, site.start) === site.entrance && (w.a === site.start || w.b === site.start));

  // 1. The goal behind a locked door, when it has a single way in.
  const goalWays = ways(site.goal);
  let goldDoor: Way | undefined;
  if (goalWays.length === 1 && goalWays[0].kind === 'door') {
    goldDoor = goalWays[0];
    goldDoor.door = { leaf: 'shut', lock: 'gold' };
  }

  // 2. Its key somewhere that takes finding: far from both the start and the goal, by preference a dead end.
  const place = (key: KeyId, avoid: number[]): number | undefined => {
    const fromStart = distances(site, site.start, isLocked);
    const toGoal = distances(site, goldDoor ? other(goldDoor, site.goal) : site.goal, isLocked);
    let best: number | undefined;
    let bestScore = -Infinity;
    for (const p of site.places) {
      if (!fromStart.has(p.id) || avoid.includes(p.id) || p.roof === 'sky') continue;
      if (p.id === site.start || p.id === site.entrance || p.id === site.goal) continue;
      const deadEnd = ways(p.id).length === 1;
      const score = fromStart.get(p.id)! + (toGoal.get(p.id) ?? 0) + (deadEnd ? 2.5 : 0) + (p.light === 'dark' ? 1 : 0) + rng.next();
      if (score > bestScore) { bestScore = score; best = p.id; }
    }
    if (best !== undefined) site.items.push({ kind: 'key', key, place: best });
    return best;
  };
  const goldAt = goldDoor ? place('gold', []) : undefined;

  // 3. Sometimes the gold key is itself behind an iron lock, with the iron key elsewhere.
  if (goldAt !== undefined && ways(goldAt).length === 1 && ways(goldAt)[0].kind === 'door' && rng.chance(0.65)) {
    const ironDoor = ways(goldAt)[0];
    ironDoor.door = { leaf: 'shut', lock: 'iron' };
    if (place('iron', [goldAt]) === undefined) delete ironDoor.door;
  }

  // 4. A shortcut: one of the doors out of the entrance hall is barred from its far side. The
  // player meets it first as a door that will not open, and later opens it from behind. Only a
  // door that lies on a loop can be barred, or the far side could never be reached.
  if (rng.chance(0.75)) {
    const options = doors.filter((w) => w !== entry && !w.door && (w.a === site.entrance || w.b === site.entrance));
    for (const w of options.sort(() => rng.next() - 0.5)) {
      const far = other(w, site.entrance);
      const round = distances(site, site.start, (x) => x === w || isLocked(x));
      const needed = [far, ...site.items.map((i) => i.place), ...(goldDoor ? [other(goldDoor, site.goal)] : [site.goal])];
      if (needed.every((p) => round.has(p)) && round.get(far)! >= 3) {
        w.door = { leaf: 'shut', barredFrom: far };
        break;
      }
    }
  }

  // 5. Other doorways: some hung with a door standing open, some shut but free, most left as plain arches.
  for (const w of doors) {
    if (w.door) continue;
    const r = rng.next();
    if (w === entry) w.door = { leaf: 'open' };
    else if (r < 0.22) w.door = { leaf: 'shut' };
    else if (r < 0.5) w.door = { leaf: 'open' };
  }
}

/** Plays the site: a breadth-first search over where the player is, what they hold and what they have unbarred. */
export function solve(site: Site): Solution {
  const keyBit: Record<KeyId, number> = { iron: 1, gold: 2 };
  const bars = site.ways.map((w, i) => (w.door?.barredFrom !== undefined ? i : -1)).filter((i) => i >= 0);
  const pickUp = (place: number, keys: number) => site.items.reduce((k, it) => (it.place === place ? k | keyBit[it.key] : k), keys);
  const encode = (place: number, keys: number, open: number) => place * 64 + keys * 16 + open;

  const startKeys = pickUp(site.start, 0);
  type Node = { place: number; keys: number; open: number; prev?: Node; move?: Move };
  const first: Node = { place: site.start, keys: startKeys, open: 0 };
  const seen = new Set<number>([encode(first.place, first.keys, first.open)]);
  const queue: Node[] = [first];
  const direct = distances(site, site.start).get(site.goal) ?? -1;

  while (queue.length) {
    const n = queue.shift()!;
    if (n.place === site.goal) {
      const moves: Move[] = [];
      for (let c: Node | undefined = n; c?.move; c = c.prev) moves.unshift(c.move);
      return { ok: true, moves, direct };
    }
    site.ways.forEach((w, i) => {
      if (!walkable(w) || (w.a !== n.place && w.b !== n.place)) return;
      const events: string[] = [];
      let open = n.open;
      const d = w.door;
      if (d?.lock) {
        if (!(n.keys & keyBit[d.lock])) return;
        events.push(`unlock with the ${d.lock} key`);
      }
      if (d?.barredFrom !== undefined) {
        const bit = 1 << bars.indexOf(i);
        if (!(open & bit)) {
          if (n.place !== d.barredFrom) return;
          open |= bit;
          events.push('lift the bar');
        }
      }
      const to = other(w, n.place);
      const keys = pickUp(to, n.keys);
      for (const it of site.items) if (it.place === to && !(n.keys & keyBit[it.key])) events.push(`take the ${it.key} key`);
      const code = encode(to, keys, open);
      if (seen.has(code)) return;
      seen.add(code);
      queue.push({ place: to, keys, open, prev: n, move: { way: i, to, events } });
    });
  }
  return { ok: false, moves: [], direct };
}
