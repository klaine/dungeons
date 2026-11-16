/** Reports how well rooms are being furnished. Usage: npx tsx tools/furnish.ts [seed ...] */
import { generateSite } from '../src/core/generate';
import { meshSite } from '../src/render/siteMesher';

for (const seed of process.argv.slice(2).length ? process.argv.slice(2) : ['check-0', 'check-2']) {
  const site = generateSite(seed);
  console.log(seed, '-', site.title);
  for (const row of meshSite(site).furnishing ?? []) console.log('  ', JSON.stringify(row));
}
