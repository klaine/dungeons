// The building lab (`lab/buildings.html`) as one HTML file with everything in it: its program, the game's builders and
// materials, and three.js, as a single inline script. For putting it where only one page can go, such as an artifact on
// claude.ai, which also wraps the page in a document of its own: so with `--fragment` the file is only what goes inside
// the body (its title, its styles, its elements and its script), as such a page is written.
//
// Its figures (`public/figures/`) go inside it too, written out as text, some 9 MB more; or, with `--figures-beside`, they are written
// out as text into a folder `figures/` beside it (`clips.glb.txt`, …), to be published beside it where a host serves text files beside a
// page but not models, as an artifact on claude.ai does.
//
//   node tools/buildingLabPage.mjs [out.html] [--fragment] [--figures-beside]      (by default dist/building-lab.html, a whole document)
//
// Another lab page the same way: `--page lab/slope.html`, with only the figures' files it needs, `--only clips.glb,superhero-male.glb`
// (the clips, and the base man the slope's adventurer is dressed on); and its slices of the world (`public/slopes/`), beside it in a
// folder `slopes/` with `--figures-beside`, else in it.
import { build } from 'vite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), fragment = args.includes('--fragment'), beside = args.includes('--figures-beside');
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const page = valueOf('--page') ?? 'lab/buildings.html', only = valueOf('--only')?.split(',');
const out = resolve(args.find((a, i) => !a.startsWith('--') && !['--page', '--only'].includes(args[i - 1])) ?? join(root, 'dist/building-lab.html'));
const tmp = mkdtempSync(join(tmpdir(), 'building-lab-'));
try {
  await build({
    root, configFile: false, base: './', logLevel: 'warn',
    build: {
      outDir: tmp, emptyOutDir: true, target: 'es2022', modulePreload: false, assetsInlineLimit: 1e9, cssCodeSplit: false,
      // (One input and its imports in one chunk: there is nowhere to fetch a second from.)
      rollupOptions: { input: { lab: join(root, page) }, output: { inlineDynamicImports: true } },
    },
  });
  let html = readFileSync(join(tmp, page), 'utf8');
  html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
  const scripts = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)];
  if (scripts.length !== 1) throw new Error(`expected one script in the built page, found ${scripts.length}`);
  let code = readFileSync(join(tmp, dirname(page), scripts[0][1]), 'utf8');
  // (Inside an inline script the page's parser stops at the first `</script`; written `<\/script` it means the same to the program.)
  code = code.replace(/<\/script/gi, '<\\/script');
  if (code.includes('<!--')) throw new Error('the program has "<!--" in it, which an inline script cannot carry safely');
  html = html.replace(scripts[0][0], '');
  // The figures: where the program finds them (`library.ts`, `figureCrew.ts`), beside the page or in it.
  const figures = join(root, 'public/figures');
  const glbs = readdirSync(figures).filter((f) => f.endsWith('.glb') && (!only || only.includes(f)));
  if (beside) {
    mkdirSync(join(dirname(out), 'figures'), { recursive: true });
    for (const f of glbs) writeFileSync(join(dirname(out), 'figures', `${f}.txt`), readFileSync(join(figures, f)).toString('base64'));
  }
  let carried = beside
    ? `window.__figureBase = 'figures/'; window.__figureText = true;`
    : `window.__figureFiles = ${JSON.stringify(Object.fromEntries(glbs.map((f) => [f, readFileSync(join(figures, f)).toString('base64')])))};`;
  // The downhill run's slices of the world (`public/slopes/`, made by `tools/skiRun.ts`): beside it in a folder `slopes/`, or in it.
  if (page === 'lab/slope.html') {
    const slopes = join(root, 'public/slopes'), runs = readdirSync(slopes).filter((f) => f.endsWith('.json'));
    if (beside) {
      mkdirSync(join(dirname(out), 'slopes'), { recursive: true });
      for (const f of runs) writeFileSync(join(dirname(out), 'slopes', f), readFileSync(join(slopes, f)));
      carried += ` window.__slopeBase = 'slopes/';`;
    } else carried += ` window.__slopeFiles = ${JSON.stringify(Object.fromEntries(runs.map((f) => [f, readFileSync(join(slopes, f), 'utf8')])))};`;
  }
  // The script goes last, after the elements it looks for.
  html = html.replace('</body>', () => `<script>${carried}</script>\n<script type="module">${code}</script>\n</body>`);
  if (fragment) {
    // What a page wrapped by its host is written as: its own viewport, title and styles, then its elements and script.
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '');
    const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
    html = `${head.trim()}\n${body.trim()}\n`;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`${out}: ${(html.length / 1e6).toFixed(2)} MB${fragment ? ', a fragment for a host to wrap' : ''}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
