import { generateSite } from '../core/generate';
import { solve } from '../core/mission';
import { loopCount, Site } from '../core/site';
import { drawPlan } from '../maps/plan';

/**
 * The gallery: many generated places side by side, as plans. Generating a site document is cheap
 * (it is the building and lighting that take time), so candidates can be looked over by the dozen
 * and only the chosen one built.
 */

const WORDS_A = ['amber', 'ashen', 'bitter', 'cold', 'drowned', 'elder', 'fallow', 'gilded', 'hollow', 'iron', 'lost', 'mossy', 'pale', 'quiet', 'red', 'salt', 'thorn', 'winter'];
const WORDS_B = ['abbey', 'cell', 'cloister', 'crypt', 'gate', 'hall', 'keep', 'priory', 'reach', 'stair', 'vault', 'well'];
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const randomSeed = () => `${pick(WORDS_A)}-${pick(WORDS_B)}-${Math.floor(Math.random() * 90 + 10)}`;

const TESTS: Record<string, (s: Site) => boolean> = {
  court: (s) => s.places.some((p) => p.role === 'court'),
  cave: (s) => s.places.some((p) => p.roof === 'cave'),
  gate: (s) => s.levers.length > 0,
  secret: (s) => s.secret >= 0,
  fallen: (s) => s.places.some((p) => p.fallen),
  small: (s) => rooms(s) <= 7,
  large: (s) => rooms(s) >= 10,
};
const rooms = (s: Site) => s.places.filter((p) => p.roof !== 'sky' && p.id !== s.secret).length;

const grid = document.getElementById('grid')!;
const want = document.getElementById('want') as HTMLSelectElement;
const count = document.getElementById('count')!;
let shown = 0, tried = 0;

function card(site: Site): HTMLElement {
  const a = document.createElement('a');
  a.className = 'card';
  // (The settings go after a `#` as well, which a page shown inside another keeps when it is not handed its own `?`.)
  const query = `seed=${encodeURIComponent(site.seed)}&place=${site.island ? 'island' : site.mountain ? 'mountain' : 'valley'}`;
  a.href = `./?${query}#${query}`;
  const canvas = document.createElement('canvas');
  // The whole plan, as a referee would see it: nothing is hidden in the gallery.
  drawPlan(canvas, site, {
    pixels: 540, items: site.items, levers: site.levers, showSecrets: true, valley: !!site.island || !!site.mountain,
    shut: new Set(site.ways.map((w, i) => (w.door && w.door.leaf !== 'open' ? i : -1))),
  });
  const solution = solve(site);
  const text = document.createElement('div');
  const name = document.createElement('b');
  name.textContent = site.seed;
  const title = document.createElement('span');
  title.textContent = site.title;
  const facts = document.createElement('i');
  const loops = loopCount(site);
  facts.textContent = `${loops} ${loops === 1 ? 'loop' : 'loops'} · route of ${solution.moves.length} doorways, ${solution.direct} if nothing were locked`;
  text.append(name, title, facts);
  a.append(canvas, text);
  return a;
}

/** Adds up to a dozen places that pass the chosen test, giving up after a fair number of tries. */
function more(): void {
  const test = want.value in TESTS ? TESTS[want.value] : null;
  let added = 0;
  for (let attempt = 0; attempt < 400 && added < 12; attempt++) {
    // (Islands and mountain tops are kinds of place of their own, drawn whole, coast or rim and all.)
    const site = generateSite(randomSeed(), want.value === 'island' ? 'island' : want.value === 'mountain' ? 'mountain' : 'valley');
    tried++;
    if (test && !test(site)) continue;
    grid.append(card(site));
    added++;
    shown++;
  }
  count.textContent = test ? `${shown} shown of ${tried} generated` : `${shown} shown`;
}

document.getElementById('more')!.addEventListener('click', more);
want.addEventListener('change', () => {
  grid.replaceChildren();
  shown = 0;
  tried = 0;
  more();
});
more();
