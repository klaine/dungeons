/** Generates many sites and reports on them. Usage: npx tsx tools/sites.ts [count] */
import { generateSite } from '../src/core/generate';
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
    bump(`goalDepth=${site.places[site.goal].depth}`);
    bump(`dark=${site.places.filter((p) => p.light === 'dark').length}`);
    for (const w of site.ways) {
      if (w.kind !== 'window' && site.places[w.a].light === 'dark' && site.places[w.b].light === 'dark') throw new Error('two dark rooms in a row');
    }
    for (const w of site.ways) {
      if (w.kind === 'window') continue;
      const d = Math.abs(site.places[w.a].floor - site.places[w.b].floor);
      if (d > 0.52) throw new Error(`doorway too steep: ${d}`);
    }
    if (n < 4) console.log(seed, '-', site.title);
  } catch (e) {
    failures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
console.log(`${count} sites, ${failures} failures`);
for (const k of [...tally.keys()].sort()) console.log(' ', k.padEnd(14), tally.get(k));
