import { Rng, fbm2 } from '../core/rng';
import { beachness, inland, outsideBuilding } from '../core/island';
import { Site } from '../core/site';
import { Kit } from './geom/kit';
import { Colour, growConifer, growTree, Planting } from './planting';
import { CardSet } from './scene';

/**
 * What grows on an island, and where. It is not the valley's planting moved to the sea: the wind
 * decides most of it. On the cliff tops the turf is short, burnt by salt at the edge, and full of
 * thrift in pink cushions and sea campion; in from the edge it is heath, heather with gorse in
 * thick bushes yellow with flower; behind the beach the sand is held by marram; and only in the
 * shelter of the hollow above the cove is there anything taller than a man: bracken, foxgloves,
 * a few low wind-cut trees, and pines that somebody planted as a break beside the house.
 *
 * Each rule reads the same few numbers at a point: how far in from the edge it is, how much of
 * a beach is near, how sheltered it is (by the hollow), and the patchiness of the ground, which
 * the noise gives.
 */

export interface IslandPlanting {
  site: Site;
  wild: Kit;
  rng: Rng;
  planting: Planting;
  cards: CardSet[];
  ground: (x: number, z: number) => number;
  turfAt: (x: number, z: number, y: number) => Colour;
  heathAt: (x: number, z: number) => number;
  rockyAt: (x: number, z: number) => number;
  trackOff: (x: number, z: number) => number;
  offFoot: (x: number, z: number) => number;
  looseAt: (x: number, z: number) => number;
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const set = (kind: CardSet['kind']): CardSet => ({ kind, shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] });

export function plantIsland(c: IslandPlanting): Record<string, number> {
  const { site, planting, rng } = c, o = site.island!, sea = o.sea;
  const season = site.setting.season ?? 'spring';
  const thrift = set('thrift'), marram = set('marram'), gorse = set('gorse'), bloomCards = set('bloom');
  const s = rng.range(0, 99);
  const places = site.places;
  const hx0 = Math.min(...places.map((p) => p.x0)) - 2.5, hx1 = Math.max(...places.map((p) => p.x1)) + 2.5, hz0 = Math.min(...places.map((p) => p.z0)) - 2.5;
  const approach = places.find((p) => p.role === 'approach')!;
  /** Whether something stands at a point, so nothing grows there. */
  const built = (x: number, z: number, m: number) => {
    if (x > hx0 - m && x < hx1 + m && z > hz0 - m && z < approach.z0 + m) return true;
    for (const q of o.cottages) if (Math.hypot(x - q.x, z - q.z) < Math.max(q.w, q.d) * 0.62 + m) return true;
    if (o.lighthouse && Math.hypot(x - o.lighthouse.x, z - o.lighthouse.z) < o.lighthouse.r + 0.6 + m) return true;
    if (o.castle && Math.hypot(x - o.castle.x, z - o.castle.z) < 17 + m) return true;
    if (o.chapel && Math.hypot(x - o.chapel.x, z - o.chapel.z) < 12 + m) return true;
    if (o.mansion && outsideBuilding(o.mansion.building, x, z) < 1.5 + m) return true;
    if (o.graveyard && Math.abs(x - o.graveyard.x) < o.graveyard.d / 2 + 0.7 + m && Math.abs(z - o.graveyard.z) < o.graveyard.w / 2 + 0.7 + m) return true;
    const [ax, az] = o.jetty.from;
    return Math.hypot(x - ax, z - az) < 2.5 + m;
  };
  /** How sheltered a point is: in the hollow above the cove, or in the lee of the house. */
  const shelterAt = (x: number, z: number) => Math.max(smooth((o.combe * 0.9 - Math.hypot(x - o.cove.x, z - o.cove.z) + o.cove.r) / 25), smooth(1 - (Math.max(hx0 - x, 0, x - hx1) + Math.max(hz0 - z, 0, z - approach.z1)) / 10) * 0.6);
  const green = (base: Colour, k = 1): Colour => [base[0] * k, base[1] * k, base[2] * k];
  // (Tints as the valley's are, which the card's paint and the light then brighten: a grass card tinted a third green is a full green on the screen.)
  const dried = season === 'autumn' ? 0.6 : season === 'summer' ? 0.3 : 0;
  const heather: Colour = season === 'autumn' ? [0.26, 0.12, 0.16] : season === 'summer' ? [0.32, 0.14, 0.26] : [0.13, 0.15, 0.07];
  const gorseGreen: Colour = [0.05, 0.09, 0.025], bloom: Colour = [0.62, 0.42, 0.02];
  const counts: Record<string, number> = {};
  const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  // ---- the low plants, on a jittered lattice over the whole island
  const g = site.grounds!, STEP = 0.72, q = rng.fork('low');
  for (let z = g.z0; z < g.z1; z += STEP) for (let x = g.x0; x < g.x1; x += STEP) {
    const px = x + q.range(-0.36, 0.36), pz = z + q.range(-0.36, 0.36);
    const d = inland(o, px, pz);
    if (d < 0.6 || built(px, pz, 0.4)) continue;
    const y = c.ground(px, pz), above = y - sea;
    if (above < 1.3 || c.rockyAt(px, pz) > 0.35 || c.looseAt(px, pz) > 0.25) continue;
    const off = Math.abs(c.trackOff(px, pz)), foot = c.offFoot(px, pz);
    if (off < 1.5 || foot < 0.55) continue;
    const edge = 1 - smooth((d - 1) / 14), beach = beachness(o, px, pz), shelter = shelterAt(px, pz);
    const patch = fbm2(px * 0.09 + s, pz * 0.09 - s, 3), fine = fbm2(px * 0.4 - s, pz * 0.4 + s, 2);
    const turf = c.turfAt(px, pz, y);
    const yaw = q.range(0, Math.PI * 2);
    // Behind the beach, on the sand: marram, in clumps, and little else.
    if (beach > 0.35 && above < 4.5) {
      if (fine > 0.42) { planting.tuft(marram, px, y - 0.05, pz, q.range(0.7, 1.1), q.range(0.6, 0.95), yaw, [0.33, 0.33, 0.2]); count('marram'); }
      continue;
    }
    // Heath: in from the edge, out of the hollow, where the patches say: heather, and gorse in thick bushes.
    const heath = c.heathAt(px, pz);
    if (heath > 0.5 && fine > 0.3) {
      if (fbm2(px * 0.23 + 7, pz * 0.23, 2) > 0.6) {
        const big = q.range(0.9, 1.6);
        planting.tuft(gorse, px, y - 0.1, pz, big * 1.3, big, yaw, green(gorseGreen, q.range(0.8, 1.2)));
        // Its flowers are among the spines, not on top of them: a smaller card, inside the bush.
        if (q.chance(season === 'autumn' ? 0.15 : 0.6)) planting.tuft(bloomCards, px, y - 0.1, pz, big * 1.25, big * 0.97, yaw + 0.5, green(bloom, q.range(0.7, 1.05)));
        count('gorse');
      } else {
        planting.tuft(planting.grass, px, y - 0.05, pz, q.range(0.6, 0.85), q.range(0.28, 0.42), yaw, green(heather, q.range(0.75, 1.2)));
        count('heather');
      }
      continue;
    }
    // In the hollow: bracken, deep in places, and here and there foxgloves.
    if (shelter > 0.45 && patch > 0.46) {
      if (q.chance(0.55)) { planting.tuft(planting.ferns, px, y - 0.05, pz, q.range(0.8, 1.3), q.range(0.7, 1.15), yaw, season === 'autumn' ? [0.3, 0.15, 0.05] : [0.1, 0.2, 0.045]); count('bracken'); }
      if (q.chance(0.06)) { planting.tuft(planting.herbs, px, y - 0.05, pz, 0.35, q.range(0.9, 1.3), yaw, [0.42, 0.13, 0.3]); count('foxglove'); }
      continue;
    }
    // Everywhere else, short turf; at the edge, thrift and sea campion in it.
    {
      // Short where the wind has it, longer in shelter; straw-coloured at the burnt edge and in a dry season.
      const tall = (0.2 + 0.32 * shelter + 0.14 * (1 - edge) + 0.12 * fine) * q.range(0.75, 1.25), dry = Math.min(1, edge * 0.6 + dried), tone = q.range(0.85, 1.15);
      planting.tuft(planting.grass, px, y - 0.04, pz, q.range(0.45, 0.7), tall, yaw, [(0.17 + 0.18 * dry) * turf[0] * tone, (0.3 + 0.02 * dry) * turf[1] * tone, (0.05 + 0.05 * dry) * turf[2] * tone]);
      count('grass');
    }
    if (edge > 0.25 && fine > 0.55 - edge * 0.2 && q.chance(0.7)) {
      planting.tuft(thrift, px + 0.2, y - 0.03, pz, q.range(0.3, 0.45), q.range(0.18, 0.3), yaw, season === 'autumn' ? [0.3, 0.25, 0.2] : [0.62, 0.24, 0.4]);
      count('thrift');
    } else if (edge > 0.15 && fine < 0.3 && q.chance(0.25) && season !== 'autumn') {
      planting.tuft(planting.flowers, px, y - 0.03, pz, 0.32, q.range(0.18, 0.3), yaw, [0.62, 0.62, 0.58]);
      count('campion');
    }
  }

  // ---- trees: only in shelter. Low, crooked broadleaves in the hollow; a row of pines beside the house to break the wind.
  const wood = c.wild.mesh('bark');
  c.wild.group = 'soft';
  const soft = c.wild.mesh('bark');
  c.wild.group = 'wild';
  const leafTint: Colour = season === 'autumn' ? [0.55, 0.38, 0.12] : season === 'summer' ? [0.17, 0.28, 0.08] : [0.24, 0.38, 0.1];
  const leaf = (r: Rng): Colour => green(leafTint, r.range(0.75, 1.2));
  const t = rng.fork('trees');
  let grown = 0;
  for (let tries = 0; tries < 900 && grown < 26; tries++) {
    const a = t.range(0, Math.PI * 2), r = o.cove.r + t.range(6, o.combe * 0.9), x = o.cove.x + Math.cos(a) * r, z = o.cove.z + Math.sin(a) * r;
    if (shelterAt(x, z) < 0.5 || inland(o, x, z) < 8 || built(x, z, 3) || Math.abs(c.trackOff(x, z)) < 4 || c.offFoot(x, z) < 2.5) continue;
    const y = c.ground(x, z);
    if (y - sea < 3) continue;
    growTree(planting, wood, x, y - 0.05, z, t.range(3.5, 6.5), t.range(0.13, 0.22), { kind: t.chance(0.6) ? 'oak' : 'ash', detail: 1, cards: 520, cardSize: 0.6, leaf, bark: [0.42, 0.4, 0.36], soft }, t.fork(`tree${grown}`));
    grown++;
  }
  counts.trees = grown;
  // The windbreak: a line of pines on the side of the house towards the open sea, the way the wind comes.
  {
    const p = rng.fork('pines'), toss = p.chance(0.5) ? -1 : 1, side = o.graveyard ? (o.graveyard.x > (hx0 + hx1) / 2 ? -1 : 1) : toss, x = side < 0 ? hx0 - p.range(5, 8) : hx1 + p.range(5, 8);
    let pines = 0;
    for (let z = hz0 - 4; z < approach.z1; z += p.range(3.2, 4.6)) {
      const px = x + p.range(-1, 1);
      if (inland(o, px, z) < 6 || Math.abs(c.trackOff(px, z)) < 3) continue;
      growConifer(planting, wood, px, c.ground(px, z) - 0.05, z, p.range(8, 13), p.range(1.6, 2.4), p.range(0.16, 0.26), { kind: 'pine', detail: 1, needle: (r) => green([0.06, 0.13, 0.06], r.range(0.8, 1.2)), bark: [0.55, 0.38, 0.28], soft }, p.fork(`pine${pines}`));
      pines++;
    }
    counts.pines = pines;
  }
  c.cards.push(...[thrift, marram, gorse, bloomCards].filter((q2) => q2.matrices.length));
  return counts;
}
