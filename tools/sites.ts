/** Generates many sites and reports on them. Usage: npx tsx tools/sites.ts [count] */
import { generateSite } from '../src/core/generate';
import { solve } from '../src/core/mission';
import { loopCount } from '../src/core/site';
import { inland } from '../src/core/island';

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
    for (const q of o.cottages) if (inland(o, q.x, q.z) < Math.max(q.w, q.d) / 2 + 3) throw new Error('a cottage at the cliff edge');
    if (o.lighthouse && inland(o, o.lighthouse.x, o.lighthouse.z) < 8) throw new Error('the lighthouse at the cliff edge');
    const track = site.track!;
    for (const [x, z] of track.slice(0, -3)) if (inland(o, x, z) < 3) throw new Error(`the track off the land at ${x}, ${z}`);
    const tally2 = (k: string) => isles.set(k, (isles.get(k) ?? 0) + 1);
    tally2(`cottages=${o.cottages.length}`);
    tally2(`lighthouse=${!!o.lighthouse}`);
    tally2(`castle=${!!o.castle}`);
    tally2(`cave=${!!o.seaCave}`);
    tally2(`stacks=${o.stacks.length}`);
  } catch (e) {
    isleFailures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
console.log(`${Math.ceil(count / 4)} islands, ${isleFailures} failures`);
for (const k of [...isles.keys()].sort()) console.log(' ', k.padEnd(14), isles.get(k));
if (failures || isleFailures) process.exitCode = 1;
