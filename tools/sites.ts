/** Generates many sites and reports on them. Usage: npx tsx tools/sites.ts [count] */
import { generateSite } from '../src/core/generate';
import { solve } from '../src/core/mission';
import { loopCount } from '../src/core/site';
import { inland } from '../src/core/island';
import { inside } from '../src/core/mountain';

const count = Number(process.argv[2] ?? 200);
const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
let failures = 0;
for (let n = 0; n < count; n++) {
  const seed = `check-${n}`;
  try {
    const site = generateSite(seed);
    const rooms = site.places.filter((p) => p.roof !== 'sky').length;
    bump(`rooms=${rooms}`);
    bump(`loops=${loopCount(site)}`);
    bump(`court=${site.places.some((p) => p.role === 'court')}`);
    bump(`plan=${/rooms (.*?)(?: with| and|;)/.exec(site.title)?.[1] ?? '?'}`);
    bump(`goalDepth=${site.places[site.goal].depth}`);
    const solution = solve(site);
    if (!solution.ok) throw new Error('cannot be completed');
    bump(`keys=${site.items.length}`);
    bump(`barred=${site.ways.some((w) => w.door?.barredFrom !== undefined)}`);
    bump(`gate=${site.levers.length > 0}`);
    bump(`secret=${site.secret >= 0}`);
    bump(`storeys=${site.places.filter((p) => p.level).map((p) => (p.level! > 0 ? 'up' : 'down')).sort().join('+') || 'none'}`);
    bump(`tower=${(site.towers ?? []).length > 0}`);
    bump(`buildings=${site.buildings ? `${site.buildings[0].style} x${site.buildings.length}` : 'none'}`);
    bump(`hall=${(site.grottoes ?? []).map((q) => (q.hall?.great ? 'great' : q.hall ? 'plain' : 'grotto')).join('+') || 'none'}`);
    bump(`moves/direct=${(solution.moves.length / solution.direct).toFixed(0)}x`);
    if (n < 4) console.log('    ', solution.moves.map((m) => [...m.events, `to ${site.places[m.to].name}`].join(', ')).join(' > '));
    bump(`dark=${site.places.filter((p) => p.light === 'dark').length}`);
    for (const w of site.ways) {
      if (w.kind !== 'window' && site.places[w.a].light === 'dark' && site.places[w.b].light === 'dark') throw new Error('two dark rooms in a row');
    }
    for (const w of site.ways) {
      if (w.kind === 'window' || w.kind === 'stair') continue;
      const d = Math.abs(site.places[w.a].floor - site.places[w.b].floor);
      // A built doorway takes a step or three; a cleft in a cave is a climb, but one that can be made.
      if (d > (w.natural ? 2.35 : 0.52)) throw new Error(`${w.natural ? 'cleft' : 'doorway'} too steep: ${d}`);
    }
    if (n < 4) console.log(seed, '-', site.title);
  } catch (e) {
    failures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
console.log(`${count} sites, ${failures} failures`);
for (const k of [...tally.keys()].sort()) console.log(' ', k.padEnd(14), tally.get(k));

// Islands: the same houses on islands in the sea. Each must be completable, and what is built on
// it must stand on the land, well in from the cliffs, with the track on land all the way to the jetty.
const isles = new Map<string, number>();
let isleFailures = 0;
for (let n = 0; n < Math.ceil(count / 4); n++) {
  const seed = `isle-check-${n}`;
  try {
    const site = generateSite(seed, 'island'), o = site.island!;
    if (!solve(site).ok) throw new Error('cannot be completed');
    const tally2 = (k: string) => isles.set(k, (isles.get(k) ?? 0) + 1);
    for (const q of o.cottages) if (inland(o, q.x, q.z) < Math.max(q.w, q.d) / 2 + 3) throw new Error('a cottage at the cliff edge');
    if (o.lighthouse && inland(o, o.lighthouse.x, o.lighthouse.z) < 8) throw new Error('the lighthouse at the cliff edge');
    // The way over the land stays on it, and climbs no more steeply than a path can; the stair, if there is one, climbs at one in two and has no gaps.
    const way = o.way ?? [];
    for (const [x, z] of way) if (Math.hypot(x - way[way.length - 1][0], z - way[way.length - 1][1]) > 12 && inland(o, x, z) < 3) throw new Error(`the way off the land at ${x}, ${z}`);
    let steepest = 0;
    for (let k = 1; k < way.length; k++) steepest = Math.max(steepest, Math.abs(way[k][2] - way[k - 1][2]) / (Math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]) || 1));
    if (steepest > 0.42) throw new Error(`the way climbs at ${steepest.toFixed(2)}`);
    for (let k = 1; k < way.length - 1; k++) {
      const ux = way[k][0] - way[k - 1][0], uz = way[k][1] - way[k - 1][1], vx = way[k + 1][0] - way[k][0], vz = way[k + 1][1] - way[k][1], l = Math.hypot(ux, uz) * Math.hypot(vx, vz);
      if (l > 0 && (ux * vx + uz * vz) / l < -0.3) throw new Error(`the way turns back on itself at ${way[k][0]}, ${way[k][1]}`);
    }
    const stair = o.stair ?? [];
    for (let k = 1; k < stair.length; k++) {
      const run = Math.hypot(stair[k][0] - stair[k - 1][0], stair[k][1] - stair[k - 1][1]), rise = stair[k][2] - stair[k - 1][2];
      if (run > 4.5 || rise > run * 0.62 + 0.15) throw new Error(`the stair breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
    }
    tally2(`landing=${o.landing}`);
    tally2(`peaks=${(o.peaks ?? []).length}`);
    tally2(`cottages=${o.cottages.length}`);
    tally2(`lighthouse=${!!o.lighthouse}`);
    tally2(`castle=${!!o.castle}`);
    tally2(`mansion=${o.mansion ? `${o.mansion.building.bays} bays x${o.mansion.building.storeys}` : 'none'}`);
    tally2(`cave=${!!o.seaCave}`);
    tally2(`stacks=${o.stacks.length}`);
  } catch (e) {
    isleFailures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
console.log(`${Math.ceil(count / 4)} islands, ${isleFailures} failures`);
for (const k of [...isles.keys()].sort()) console.log(' ', k.padEnd(14), isles.get(k));

// Mountain tops: the same houses as hospices above the cloud. Each must be completable; the way and
// the climb stay on the top and climb no more steeply than a path can; the summit's cairn, the shelter
// and the arrival stand on the top; and the arrival is in the cloud.
const peaks = new Map<string, number>();
let peakFailures = 0;
for (let n = 0; n < Math.ceil(count / 4); n++) {
  const seed = `peak-check-${n}`;
  try {
    const site = generateSite(seed, 'mountain'), m = site.mountain!;
    if (!solve(site).ok) throw new Error('cannot be completed');
    const tally3 = (k: string) => peaks.set(k, (peaks.get(k) ?? 0) + 1);
    for (const [name, line, most] of [['way', m.way ?? [], 0.42], ['climb', m.climb ?? [], 0.64]] as const) {
      if (line.length < 2) throw new Error(`no ${name}`);
      for (const [x, z] of line) if (inside(m, x, z) < 3) throw new Error(`the ${name} off the top at ${x}, ${z}`);
      let steepest = 0;
      for (let k = 1; k < line.length; k++) steepest = Math.max(steepest, Math.abs(line[k][2] - line[k - 1][2]) / (Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) || 1));
      if (steepest > most) throw new Error(`the ${name} climbs at ${steepest.toFixed(2)}`);
    }
    if (m.cairn && inside(m, m.cairn.x, m.cairn.z) < 4) throw new Error('the cairn at the edge');
    const cl = m.climb ?? [];
    if (m.cairn && cl.some(([x, z], k) => k < cl.length - 10 && Math.hypot(x - m.cairn!.x, z - m.cairn!.z) < 15)) throw new Error('the climb crosses the summit before it reaches it');
    if (m.shelter && inside(m, m.shelter.x, m.shelter.z) < 5) throw new Error('the shelter at the edge');
    // The gallery way, if there is one: no steeper anywhere than a stair cut in rock; it starts on the way and ends on the climb;
    // its tunnels have rock over them and its ledges do not stand out in the air beyond the face.
    const g = m.gallery;
    if (g) {
      const first = g.line[0], last = g.line[g.line.length - 1], top = cl[g.joins];
      if (!m.way!.some(([x, z]) => Math.hypot(x - first[0], z - first[1]) < 0.5)) throw new Error('the gallery way does not start on the way');
      if (Math.hypot(last[0] - top[0], last[1] - top[1]) > 0.5 || Math.abs(last[2] - top[2]) > 0.3) throw new Error('the gallery way does not end on the climb');
      for (let k = 1; k < g.line.length; k++) {
        const run = Math.hypot(g.line[k][0] - g.line[k - 1][0], g.line[k][1] - g.line[k - 1][1]), rise = Math.abs(g.line[k][2] - g.line[k - 1][2]);
        if (run > 5 || rise > run * 0.6 + 0.15) throw new Error(`the gallery way breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
      }
      for (const [x, z] of g.line) if (inside(m, x, z) < -9) throw new Error(`the gallery way out in the air at ${x}, ${z}`);
      const tunnelled = g.under.reduce((sum, [a, b]) => sum + b - a + 1, 0) / g.line.length;
      tally3(`gallery tunnels=${g.under.length}`);
      tally3(`gallery under=${Math.round(tunnelled * 10) * 10}%`);
    }
    tally3(`gallery=${!!g}`);
    const arrive = m.way![m.way!.length - 1];
    if (arrive[2] + 1.7 > m.deck) throw new Error(`the arrival is above the cloud (${arrive[2]} against ${m.deck})`);
    tally3(`season=${site.setting.season}`);
    tally3(`peaks=${m.peaks.length}`);
    tally3(`shelter=${!!m.shelter}`);
    tally3(`summit=${Math.round((m.cairn?.y ?? 0) / 10) * 10}`);
  } catch (e) {
    peakFailures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
console.log(`${Math.ceil(count / 4)} mountain tops, ${peakFailures} failures`);
for (const k of [...peaks.keys()].sort()) console.log(' ', k.padEnd(14), peaks.get(k));
if (failures || isleFailures || peakFailures) process.exitCode = 1;
