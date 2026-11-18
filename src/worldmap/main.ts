import { HeightField } from '../core/terrain';
import { drawInkWorld, drawWorldRelief, WorldMap } from '../maps/inkWorld';

/**
 * The world page: a world made from its seed (`?world=<seed>`), drawn as an ink map with the places
 * of adventure found in it, or as shaded relief. The world is made in a worker, so the page stays
 * answering while it is; it takes half a minute or so at most.
 */

const WORDS_A = ['amber', 'ashen', 'bitter', 'cold', 'drowned', 'elder', 'fallow', 'gilded', 'hollow', 'iron', 'lost', 'mossy', 'pale', 'quiet', 'red', 'salt', 'thorn', 'winter'];
const WORDS_B = ['coast', 'country', 'fells', 'firth', 'march', 'reach', 'shore', 'sound', 'strath', 'wold'];
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const randomSeed = () => `${pick(WORDS_A)}-${pick(WORDS_B)}-${Math.floor(Math.random() * 90 + 10)}`;

const params = new URLSearchParams(location.search);
const input = document.getElementById('seed') as HTMLInputElement;
const status = document.getElementById('status')!;
const canvas = document.getElementById('map') as HTMLCanvasElement;
const inkTab = document.getElementById('ink') as HTMLButtonElement, reliefTab = document.getElementById('relief') as HTMLButtonElement;
let map: WorldMap | null = null, view: 'ink' | 'relief' = params.get('view') === 'relief' ? 'relief' : 'ink', worker: Worker | null = null;
declare global { interface Window { __worldReady?: boolean; __world?: WorldMap } }

function draw(): void {
  if (!map) return;
  inkTab.setAttribute('aria-pressed', String(view === 'ink')); reliefTab.setAttribute('aria-pressed', String(view === 'relief'));
  if (view === 'ink') drawInkWorld(canvas, map); else drawWorldRelief(canvas, map);
}

function make(seed: string): void {
  input.value = seed;
  const url = new URL(location.href);
  url.searchParams.set('world', seed);
  history.replaceState(null, '', url);
  window.__worldReady = false;
  worker?.terminate();
  const t0 = performance.now();
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.type === 'progress') { status.textContent = `${e.data.text}…`; return; }
    const d = e.data.data, field = new HeightField(d.field.x0, d.field.z0, d.field.cell, d.field.nx, d.field.nz);
    field.data.set(d.field.data);
    map = { ...d, field } as WorldMap;
    window.__world = map;
    const found = (k: string) => map!.places.filter((q) => q.kind === k).length;
    status.textContent = `Made in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${found('island')} islands, ${found('valley')} valley heads and ${found('mountain')} mountain tops found.`;
    draw();
    window.__worldReady = true;
    worker?.terminate(); worker = null;
  };
  worker.onerror = (e) => { status.textContent = `The world could not be made: ${e.message}`; };
  worker.postMessage({ seed });
  status.textContent = 'Starting…';
}

document.getElementById('make')!.addEventListener('click', () => make(input.value.trim() || randomSeed()));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(input.value.trim() || randomSeed()); });
document.getElementById('another')!.addEventListener('click', () => make(randomSeed()));
inkTab.addEventListener('click', () => { view = 'ink'; draw(); });
reliefTab.addEventListener('click', () => { view = 'relief'; draw(); });
document.getElementById('save')!.addEventListener('click', () => {
  if (!map) return;
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `world-${map!.plan.seed}-${view}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});
make(params.get('world') || randomSeed());
