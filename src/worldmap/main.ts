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
  const KIND = { island: 'Island', valley: 'Valley head', mountain: 'Mountain top', coast: 'Coastal town' } as const;
  for (const q of map.places) {
    const card = document.createElement('div'), name = document.createElement('b'), kind = document.createElement('span');
    card.className = 'place'; kind.className = 'kind';
    name.textContent = q.name;
    kind.textContent = `${KIND[q.kind]} ${q.n} · ${Math.round(q.y)} m`;
    const link = (text: string, href: string) => { const a = document.createElement('a'); a.textContent = text; a.href = href; return a; };
    // (After a `#`, which a page shown inside another keeps where it may not keep a `?`; both pages read it. Where the game and the walk
    // are, a page may say in its head, as the published copy does, where they are not the usual files.)
    const game = new URLSearchParams({ world: seed, place: q.kind === 'coast' ? 'town' : q.kind, n: String(q.n) }), walk = new URLSearchParams({ world: seed, at: `${q.kind}${q.n}` });
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
  const t0 = performance.now(), progress = showProgress(t0);
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.type === 'progress') { progress.stage(e.data.text); return; }
    const d = e.data.data, field = new HeightField(d.field.x0, d.field.z0, d.field.cell, d.field.nx, d.field.nz);
    field.data.set(d.field.data);
    map = { ...d, field } as WorldMap;
    window.__world = map;
    const found = (k: string) => map!.places.filter((q) => q.kind === k).length;
    worker?.terminate(); worker = null;
    // (The map is drawn here, on the page, which holds still while it is: the bar is let paint first.)
    progress.stage('Drawing the map');
    setTimeout(() => {
      draw();
      listPlaces(seed);
      progress.done();
      status.textContent = `Made in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${found('island')} islands, ${found('valley')} valley heads, ${found('mountain')} mountain tops and ${found('coast')} coastal towns found.`;
      window.__worldReady = true;
    }, 60);
  };
  worker.onerror = (e) => { progress.done(); status.textContent = `The world could not be made: ${e.message}`; };
  // (`?size=8x8` for a world of that many kilometres east and west by north and south; six by ten unless asked.)
  const sz = (params.get('size') ?? '').split('x').map(Number);
  worker.postMessage({ seed, size: sz.length === 2 && sz.every((v) => v >= 2 && v <= 20) ? { x: sz[0] * 1000, z: sz[1] * 1000 } : undefined });
  status.textContent = '';
}

/**
 * The stages a world is made in, and about how many seconds each took (`tools/world.ts`, in a container of four cores; a desktop is
 * quicker, but in about the same shares): so that the bar moves through them as they are reported, and creeps on within one,
 * ever slower, rather than standing still through the ten seconds the land takes to lift.
 */
const STAGES: [string, number][] = [['Lifting', 9.5], ['Shaping', 1.3], ['Wearing', 11.7], ['Following', 1.4], ['Seeing', 0.8], ['Looking for islands', 1.1], ['Looking for valleys', 5.3], ['Looking for mountain', 0.2], ['Looking for coastal', 0.2], ['Settling', 0.1], ['Laying', 0.4], ['Drawing', 1.5]];
const STAGES_TOTAL = STAGES.reduce((s, [, t]) => s + t, 0);

/** The bar shown while a world is made: `stage` with each stage reported, `done` when the map is drawn. */
function showProgress(t0: number): { stage: (text: string) => void; done: () => void } {
  const box = document.getElementById('making')!, bar = box.querySelector<HTMLElement>('.bar')!, fill = bar.querySelector<HTMLElement>('span')!, line = box.querySelector('p')!;
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  // (An empty map is a great blank sheet: hidden until there is something on it; an old one dimmed while the new is made.)
  if (map) canvas.classList.add('dim'); else canvas.hidden = true;
  box.hidden = false;
  let at = -1, since = performance.now(), text = 'Starting', frame = 0;
  const tick = () => {
    const before = at < 0 ? 0 : STAGES.slice(0, at).reduce((s, [, t]) => s + t, 0), own = at < 0 ? 0.5 : STAGES[at][1];
    const share = Math.min(0.995, (before + own * (1 - Math.exp(-(performance.now() - since) / 1000 / own))) / STAGES_TOTAL);
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    line.textContent = `${text}… ${((performance.now() - t0) / 1000).toFixed(0)} s`;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stage(t) {
      text = t;
      const k = STAGES.findIndex(([p]) => t.startsWith(p));
      // (A stage reported again, as the search for valleys is at each tile, goes on where it was.)
      if (k >= 0 && k !== at) { at = k; since = performance.now(); }
    },
    done() { cancelAnimationFrame(frame); box.hidden = true; canvas.hidden = false; canvas.classList.remove('dim'); },
  };
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
