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
// (Or after a `#`: `#world=w2`, or `#w2` alone, which a page shown inside another keeps where it may not keep a `?`.)
if (location.hash.includes('=')) for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params.set(k, v);
else if (/^[A-Za-z0-9-]{1,24}$/.test(location.hash.slice(1))) params.set('world', location.hash.slice(1));
const input = document.getElementById('seed') as HTMLInputElement;
const status = document.getElementById('status')!;
const canvas = document.getElementById('map') as HTMLCanvasElement;
const placesEl = document.getElementById('places');
const inkTab = document.getElementById('ink') as HTMLButtonElement, reliefTab = document.getElementById('relief') as HTMLButtonElement;
let map: WorldMap | null = null, view: 'ink' | 'relief' = params.get('view') === 'relief' ? 'relief' : 'ink', worker: Worker | null = null;
declare global { interface Window { __worldReady?: boolean; __world?: WorldMap } }

function draw(): void {
  if (!map) return;
  inkTab.setAttribute('aria-pressed', String(view === 'ink')); reliefTab.setAttribute('aria-pressed', String(view === 'relief'));
  if (view === 'ink') drawInkWorld(canvas, map); else drawWorldRelief(canvas, map);
}

/** Where another page of the tool is: as the page's head says (`<meta name="dungeons-game" content="…">`), or the usual file. */
const pageOf = (name: string, usual: string) => document.querySelector<HTMLMetaElement>(`meta[name="dungeons-${name}"]`)?.content || usual;

/** The places found, each with the way to it: a house built there and played (the game), or its land walked (the walk page). */
function listPlaces(seed: string): void {
  if (!placesEl || !map) return;
  placesEl.replaceChildren();
  const KIND = { island: 'Island', valley: 'Valley head', mountain: 'Mountain top' } as const;
  for (const q of map.places) {
    const card = document.createElement('div'), name = document.createElement('b'), kind = document.createElement('span');
    card.className = 'place'; kind.className = 'kind';
    name.textContent = q.name;
    kind.textContent = `${KIND[q.kind]} ${q.n} · ${Math.round(q.y)} m`;
    const link = (text: string, href: string) => { const a = document.createElement('a'); a.textContent = text; a.href = href; return a; };
    // (After a `#`, which a page shown inside another keeps where it may not keep a `?`; both pages read it. Where the game and the walk
    // are, a page may say in its head, as the published copy does, where they are not the usual files.)
    const game = new URLSearchParams({ world: seed, place: q.kind, n: String(q.n) }), walk = new URLSearchParams({ world: seed, at: `${q.kind}${q.n}` });
    card.append(name, kind, document.createElement('br'), link('Build a house here', `${pageOf('game', './index.html')}#${game}`), link('Walk the land', `${pageOf('walk', './walk.html')}#${walk}`));
    placesEl.append(card);
  }
}

function make(seed: string): void {
  placesEl?.replaceChildren();
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
    listPlaces(seed);
    window.__worldReady = true;
    worker?.terminate(); worker = null;
  };
  worker.onerror = (e) => { status.textContent = `The world could not be made: ${e.message}`; };
  // (`?size=8x8` for a world of that many kilometres east and west by north and south; six by ten unless asked.)
  const sz = (params.get('size') ?? '').split('x').map(Number);
  worker.postMessage({ seed, size: sz.length === 2 && sz.every((v) => v >= 2 && v <= 20) ? { x: sz[0] * 1000, z: sz[1] * 1000 } : undefined });
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
