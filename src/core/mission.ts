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

  // 4. A shortcut: one of the doors out of the entrance hall cannot be passed from this side. The
  // player meets it first as a way that is shut, and later opens it from behind. It is either a
  // door barred on its far side, or a portcullis whose lever stands just beyond it, in plain
  // sight through the bars. Only a way that lies on a loop can be shut like this, or the far side
  // could never be reached.
  if (rng.chance(0.85)) {
    const options = doors.filter((w) => w !== entry && !w.door && (w.a === site.entrance || w.b === site.entrance));
    for (const w of options.sort(() => rng.next() - 0.5)) {
      const far = other(w, site.entrance);
      const round = distances(site, site.start, (x) => x === w || isLocked(x));
      const needed = [far, ...site.items.map((i) => i.place), ...(goldDoor ? [other(goldDoor, site.goal)] : [site.goal])];
      if (!needed.every((p) => round.has(p)) || round.get(far)! < 3) continue;
      if (rng.chance(0.55)) {
        const [x, z] = leverSpot(site, w, far);
        w.door = { leaf: 'gate', lever: site.levers.length };
        site.levers.push({ place: far, opens: site.ways.indexOf(w), x, z });
      } else {
        w.door = { leaf: 'shut', barredFrom: far };
      }
      break;
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

/** Where a gate's lever stands: a pace or two inside the far room, to one side of the gateway. */
function leverSpot(site: Site, w: Way, far: number): [number, number] {
  const p = site.places[far];
  const side = w.a === far ? w.side : ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[w.side];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi - 0.6, Math.max(lo + 0.6, v));
  const along = w.at + (w.at < ((side === 'n' || side === 's' ? p.x0 + p.x1 : p.z0 + p.z1) / 2) ? 1 : -1) * (w.halfWidth + 1.0);
  switch (side) {
    case 'n': return [clamp(along, p.x0, p.x1), clamp(p.z0 + 1.5, p.z0, p.z1)];
    case 's': return [clamp(along, p.x0, p.x1), clamp(p.z1 - 1.5, p.z0, p.z1)];
    case 'w': return [clamp(p.x0 + 1.5, p.x0, p.x1), clamp(along, p.z0, p.z1)];
    case 'e': return [clamp(p.x1 - 1.5, p.x0, p.x1), clamp(along, p.z0, p.z1)];
  }
}

/** Plays the site: a breadth-first search over where the player is, what they hold, what they have unbarred and which levers they have thrown. */
export function solve(site: Site): Solution {
  const keyBit: Record<KeyId, number> = { iron: 1, gold: 2 };
  const bars = site.ways.map((w, i) => (w.door?.barredFrom !== undefined ? i : -1)).filter((i) => i >= 0);
  const pickUp = (place: number, keys: number) => site.items.reduce((k, it) => (it.place === place ? k | keyBit[it.key] : k), keys);
  const pull = (place: number, pulled: number) => site.levers.reduce((m, l, k) => (l.place === place ? m | (1 << k) : m), pulled);
  const encode = (place: number, keys: number, open: number, pulled: number) => ((place * 4 + keys) * 16 + open) * 16 + pulled;

  const startKeys = pickUp(site.start, 0);
  type Node = { place: number; keys: number; open: number; pulled: number; prev?: Node; move?: Move };
  const first: Node = { place: site.start, keys: startKeys, open: 0, pulled: pull(site.start, 0) };
  const seen = new Set<number>([encode(first.place, first.keys, first.open, first.pulled)]);
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
      if (d?.lever !== undefined && !(n.pulled & (1 << d.lever))) return;
      const to = other(w, n.place);
      const keys = pickUp(to, n.keys);
      const pulled = pull(to, n.pulled);
      for (const it of site.items) if (it.place === to && !(n.keys & keyBit[it.key])) events.push(`take the ${it.key} key`);
      if (pulled !== n.pulled) events.push('throw the lever');
      const code = encode(to, keys, open, pulled);
      if (seen.has(code)) return;
      seen.add(code);
      queue.push({ place: to, keys, open, pulled, prev: n, move: { way: i, to, events } });
    });
  }
  return { ok: false, moves: [], direct };
}
