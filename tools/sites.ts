/** Generates many sites and reports on them. Usage: npx tsx tools/sites.ts [count] */
import { generateSite } from '../src/core/generate';
import { solve } from '../src/core/mission';
import { loopCount } from '../src/core/site';

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
