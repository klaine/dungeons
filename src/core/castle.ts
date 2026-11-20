import { Rng } from './rng';
import { Place, Site } from './site';
import { insideOf } from './valley';

/**
 * A castle at a valley's head, about the house, which is its hall and keep. (Asked for: a castle with walls, two to four towers, a
 * gate, a keep, a chapel and a dungeon, on high ground, with a village grown about its foot; and then, of the first one, that it was
 * an unnatural perfect rectangle with heavy towers all alike, standing apart from its village.) Laid out as castles on a hill are,
 * Gruyères, Corfe, Beynac or Kaysersberg: its wall follows the brow of the hill it stands on, in straight lengths from corner to
 * corner, round the house and the ground before it; towers of several kinds at some of its corners, smaller than a keep and none
 * alike; its gate where the road comes up, in a tower of its own; and its keep, taller and slenderer than any, at the back of the
 * bailey, the last place to hold.
 */
export interface Castle {
  /** The wall's corners, in order round the bailey. */
  wall: [number, number][];
  /** From the ground to the wall-walk, and through. */
  height: number;
  thick: number;
  /** The gate: where it stands in the wall, which way it faces out (a bearing from greater x towards greater z), how broad its way. */
  gate: { x: number; z: number; out: number; w: number };
  /** The wall's towers, at its corners; the keep is in `Site.towers`, marked `castle`, and can be gone into and climbed. */
  towers: CastleTower[];
  /** How far the castle's ground stands over the land about its foot: the hill it is on. */
  rise: number;
}

export interface CastleTower {
  x: number;
  z: number;
  /** Round; half round, standing out from the wall with its back flat to the bailey; or square and small. */
  kind: 'round' | 'half' | 'square';
  /** Its radius, or half its breadth. */
  r: number;
  /** How far it stands over the wall-walk. */
  over: number;
  /** A pointed roof of tiles, or a battlement. */
  roof: 'cone' | 'battlement';
  /** Which way it faces out of the bailey. */
  out: number;
}

/** How far a point is outside the castle's wall line (negative within it). */
export function castleOff(c: Pick<Castle, 'wall'>, x: number, z: number): number {
  const w = c.wall;
  let inside = false, best = Infinity;
  for (let i = 0, j = w.length - 1; i < w.length; j = i++) {
    const [ax, az] = w[j], [bx, bz] = w[i];
    if ((bz > z) !== (az > z) && x < ((ax - bx) * (z - bz)) / (az - bz || 1e-9) + bx) inside = !inside;
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
  }
  return inside ? -best : best;
}

/**
 * Lays the castle out about the house (its rooms, `house`) and the meadow before its door, within the valley. Its wall is an oval
 * of eight to eleven straight lengths, a little uneven, some ten metres off the house on either hand and behind and some paces beyond
 * the meadow; the gate where a line from the door down the valley meets it; towers at three or four of the other corners, the
 * sharpest turns first; the keep at the back. Returns the gate, for the road to start from.
 */
export function layOutCastle(site: Site, meadow: Place, house: { x0: number; x1: number; z0: number }, doorX: number, rng: Rng): Castle {
  const v = site.valley!, round = (x: number) => Math.round(x * 10) / 10;
  const hx0 = Math.min(house.x0, meadow.x0), hx1 = Math.max(house.x1, meadow.x1), hz0 = house.z0, hz1 = meadow.z1;
  const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
  const fromHouse = (x: number, z: number) => Math.hypot(Math.max(hx0 - x, 0, x - hx1), Math.max(hz0 - z, 0, z - hz1));
  const n = rng.int(8, 11), phase = rng.range(0, (Math.PI * 2) / n);
  const jitter = Array.from({ length: n }, () => [rng.range(-0.2, 0.2), rng.range(-0.08, 0.16)]);
  let margin = rng.range(9, 12);
  let wall: [number, number][] = [];
  for (let attempt = 0; attempt < 10; attempt++, margin *= 0.88) {
    const ax = (hx1 - hx0) / 2 + margin, az = (hz1 - hz0) / 2 + margin * 0.85;
    wall = [];
    for (let k = 0; k < n; k++) {
      const a = phase + ((k + jitter[k][0]) / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      // On an oval about the house, each corner a little in or out of it; and never nearer the house than seven metres.
      let r = (1 / Math.hypot(c / ax, s / az)) * (1 + jitter[k][1]);
      while (fromHouse(cx + c * r, cz + s * r) < 7) r += 0.5;
      // (Further out behind the house, where the keep stands between it and the wall.)
      if (cz + s * r < hz0 + 2) r += 5;
      wall.push([round(cx + c * r), round(cz + s * r)]);
    }
    // (Within the valley, with room to walk round it.)
    if (wall.every(([x, z]) => insideOf(v, x, z) > 7)) break;
  }
  // The gate: where a line from the door straight down the valley crosses the wall.
  let gate = { x: doorX, z: hz1 + 6, out: Math.PI / 2, w: 3.4 }, edge = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = wall[i], [bx, bz] = wall[(i + 1) % n];
    if ((ax - doorX) * (bx - doorX) > 0 || Math.max(az, bz) < hz1) continue;
    const t = (doorX - ax) / (bx - ax || 1e-9), z = az + (bz - az) * t;
    if (z < hz1) continue;
    // (Not hard by a corner: kept four metres from either end of its length.)
    const len = Math.hypot(bx - ax, bz - az), u = Math.min(len - 4, Math.max(4, t * len)) / len;
    const nx = bz - az, nz = -(bx - ax), out = Math.atan2(nz, nx);
    // (Outward is away from the bailey's middle.)
    const outward = Math.cos(out) * (cx - (ax + bx) / 2) + Math.sin(out) * (cz - (az + bz) / 2) < 0 ? out : out + Math.PI;
    gate = { x: round(ax + (bx - ax) * u), z: round(az + (bz - az) * u), out: Math.round(outward * 1000) / 1000, w: 3.4 };
    edge = i;
    break;
  }
  // Towers at the corners: the sharpest turns first, none by the gate, three or four of them, no two alike in kind and size.
  const turnAt = (k: number) => {
    const [px, pz] = wall[(k + n - 1) % n], [x, z] = wall[k], [qx, qz] = wall[(k + 1) % n];
    const a = Math.atan2(z - pz, x - px), b = Math.atan2(qz - z, qx - x);
    return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  };
  const corners = wall.map((_, k) => k).filter((k) => Math.hypot(wall[k][0] - gate.x, wall[k][1] - gate.z) > 9).sort((a, b) => turnAt(b) - turnAt(a) + rng.range(-0.15, 0.15));
  const want = rng.int(3, 4), kinds: CastleTower['kind'][] = ['round', 'half', 'square', 'round'];
  const towers: CastleTower[] = [];
  for (const k of corners) {
    if (towers.length >= want) break;
    if (towers.some((t) => Math.hypot(t.x - wall[k][0], t.z - wall[k][1]) < 14)) continue;
    const kind = kinds[(towers.length + rng.int(0, 3)) % 4];
    const [x, z] = wall[k];
    towers.push({
      x, z, kind, r: round(kind === 'square' ? rng.range(2.2, 2.9) : rng.range(2.4, 3.3)), over: round(rng.range(2.5, 6.5)),
      roof: kind === 'square' ? (rng.chance(0.5) ? 'cone' : 'battlement') : rng.chance(0.6) ? 'cone' : 'battlement',
      out: Math.round(Math.atan2(z - cz, x - cx) * 1000) / 1000,
    });
  }
  void edge;
  // The keep: tall and slender, at the back of the bailey, where the wall is furthest from the gate, on the bailey's side of it and
  // clear of the house. Its door faces the bailey's middle. (A tower that can be gone into and climbed, as the old lone tower could.)
  const back = wall.map((p, k) => ({ p, k })).sort((a, b) => Math.hypot(b.p[0] - gate.x, b.p[1] - gate.z) - Math.hypot(a.p[0] - gate.x, a.p[1] - gate.z));
  const half = round(rng.range(2.7, 3.1)), storeys = rng.int(5, 6);
  for (const { p } of back) {
    const dx = cx - p[0], dz = cz - p[1], l = Math.hypot(dx, dz) || 1, inset = half + 0.9 + 1.0 + 0.6;
    const kx = round(p[0] + (dx / l) * inset), kz = round(p[1] + (dz / l) * inset);
    if (fromHouse(kx, kz) < half + 0.9 + 0.9 || towers.some((t) => Math.hypot(t.x - kx, t.z - kz) < t.r + half + 2.5)) continue;
    site.towers = [...(site.towers ?? []).filter((t) => !t.castle), { x: kx, z: kz, half, storeys, door: kx < cx ? 'e' : 'w', castle: true }];
    break;
  }
  return { wall, height: round(rng.range(6.5, 8)), thick: 2, gate, towers, rise: round(rng.range(7, 10)) };
}
