import { HeightField } from '../core/terrain';
import { drawFootprint, footprintOf } from '../maps/footprint';
import { drawInkWorld, drawWorldRelief, inkFrame, WorldMap } from '../maps/inkWorld';
import { keptSites, KeptSite } from '../app/worldPlace';
import { worldShelf } from '../app/worldStore';
import placesWorker from './placesWorker?worker&url';

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

/** The places built: beforehand, now or on an earlier visit (kept in the browser); and those that could not be, with why. */
let built: KeptSite[] = [];
const failed = new Map<string, string>();
let prebuilding: Worker | null = null;

function draw(): void {
  if (!map) return;
  inkTab.setAttribute('aria-pressed', String(view === 'ink')); reliefTab.setAttribute('aria-pressed', String(view === 'relief'));
  if (view === 'ink') { drawInkWorld(canvas, map); drawBuilt(); } else drawWorldRelief(canvas, map);
}

/** Over the ink map, what is built at each place built (all of them, or those given): its ground, its ways and what stands on it, in red (`footprintOf`). */
function drawBuilt(which: KeptSite[] = built): void {
  if (!map || view !== 'ink' || !which.length) return;
  const ctx = canvas.getContext('2d')!, k = inkFrame(map.plan, canvas.width);
  for (const b of which) { const fp = footprintOf(b.site); if (fp) drawFootprint(ctx, fp, (x, z) => [k.X(x), k.Z(z)], { ink: '#9a2a1c', scale: 0.9 }); }
}

/** The world's size asked for in the address (`?size=8x8`, kilometres east and west by north and south), or none: six by ten. */
function sizeAsked(): { x: number; z: number } | undefined {
  const sz = (params.get('size') ?? '').split('x').map(Number);
  return sz.length === 2 && sz.every((v) => v >= 2 && v <= 20) ? { x: sz[0] * 1000, z: sz[1] * 1000 } : undefined;
}

/**
 * Builds every place of the world beforehand (asked: "on the entry page also add a button that enables the player to prebuild all
 * the found locations for the world. Then switching between them should be quicker and the ink map could show all the footprints"):
 * in a worker (`placesWorker.ts`), the world made again as the game makes it, then each place laid out as the game would lay it out,
 * its house the place's own; all of it kept in this browser (`worldStore.ts`), where the game finds it, and each place's footprint
 * drawn on the map as it comes. The bar goes through the world's making in about a sixth of it, then a share for each place.
 */
async function prebuild(): Promise<void> {
  if (!map || prebuilding) return;
  const seed = map.plan.seed, shelf = await worldShelf(seed), button = document.getElementById('prebuild') as HTMLButtonElement;
  const box = document.getElementById('making')!, bar = box.querySelector<HTMLElement>('.bar')!, fill = bar.querySelector<HTMLElement>('span')!, line = box.querySelector('p')!;
  const t0 = performance.now(), secs = () => ((performance.now() - t0) / 1000).toFixed(0);
  let share = 0, text = 'Making the world as the game makes it', keeping: Promise<unknown> = Promise.resolve();
  const show = () => { fill.style.width = `${(share * 100).toFixed(1)}%`; bar.setAttribute('aria-valuenow', String(Math.round(share * 100))); line.textContent = `${text}… ${secs()} s`; };
  box.hidden = false; button.disabled = true; status.textContent = '';
  const timer = setInterval(() => { if (share < 0.15) share = Math.min(0.15, share + 0.0015); show(); }, 250);
  // (Kept one after another, in the order they come.)
  const keep = (what: string, value: unknown) => { keeping = keeping.then(() => shelf?.set(what, value)); };
  const finish = (said: string) => { clearInterval(timer); box.hidden = true; button.disabled = false; prebuilding?.terminate(); prebuilding = null; status.textContent = said; };
  const worker = (prebuilding = new Worker(placesWorker, { type: 'module' }));
  worker.onmessage = (e) => {
    const m = e.data;
    if (map?.plan.seed !== seed) return;
    if (m.type === 'progress') { text = m.text; if (m.total) share = 0.15 + 0.85 * (m.done / m.total); return; }
    if (m.type === 'world') { keep('world', m.world); return; }
    if (m.type === 'tile') { keep(`${m.tile.i},${m.tile.j}`, m.tile); return; }
    if (m.type === 'site') {
      keep(`site:${m.kind}${m.n}`, { seed: m.seed, site: m.site });
      if (m.site) { const b: KeptSite = { kind: m.kind, n: m.n, seed: m.seed, site: m.site }; built = [...built.filter((o) => !(o.kind === m.kind && o.n === m.n)), b]; drawBuilt([b]); } else failed.set(`${m.kind}${m.n}`, m.why);
      listPlaces(seed);
      return;
    }
    if (m.type === 'done') {
      void keeping.then(() => finish(`Built ${built.length} places in ${secs()} s${failed.size ? `; ${failed.size} could not be` : ''}${shelf ? ', kept in this browser: going to one now lays nothing out again.' : '. (This browser keeps nothing here, so the game will lay them out again.)'}`));
    }
  };
  worker.onerror = (e) => finish(`The places could not all be built: ${e.message}`);
  worker.postMessage({ seed, size: sizeAsked() });
}
document.getElementById('prebuild')!.addEventListener('click', () => void prebuild());

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
    // (Built beforehand, or not to be: said beside its kind.)
    const done = built.some((b) => b.kind === q.kind && b.n === q.n), why = failed.get(`${q.kind}${q.n}`), note = document.createElement('span');
    if (done || why) { note.className = done ? 'built' : 'built failed'; note.textContent = done ? 'built' : 'could not be built'; if (why) note.title = why; }
    card.append(name, kind, note, document.createElement('br'), link('Build a house here', `${pageOf('game', './index.html')}#${game}`), link('Walk the land', `${pageOf('walk', './walk.html')}#${walk}`));
    placesEl.append(card);
  }
}

function make(seed: string): void {
  placesEl?.replaceChildren();
  built = []; failed.clear();
  prebuilding?.terminate(); prebuilding = null;
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
      // (What was built beforehand on an earlier visit, kept in this browser: its footprints drawn, its places marked.)
      void worldShelf(seed).then((shelf) => keptSites(shelf, map!.places)).then((kept) => { if (map?.plan.seed !== seed || !kept.length) return; built = kept; draw(); listPlaces(seed); });
      status.textContent = `Made in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${found('island')} islands, ${found('valley')} valley heads, ${found('mountain')} mountain tops and ${found('coast')} coastal towns found.`;
      window.__worldReady = true;
    }, 60);
  };
  worker.onerror = (e) => { progress.done(); status.textContent = `The world could not be made: ${e.message}`; };
  // (`?size=8x8` for a world of that many kilometres east and west by north and south; six by ten unless asked.)
  worker.postMessage({ seed, size: sizeAsked() });
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
