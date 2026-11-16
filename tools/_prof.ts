import { generateSite } from '../src/core/generate';
import { meshSite } from '../src/render/siteMesher';
const site = generateSite(process.argv[2] ?? 'isle0', 'island');
const t = performance.now(); meshSite(site); console.log('total', (performance.now() - t).toFixed(0));
