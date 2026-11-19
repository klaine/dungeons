// The building lab (`lab/buildings.html`) as one HTML file with everything in it: its program, the game's builders and
// materials, and three.js, as a single inline script. For putting it where only one page can go, such as an artifact on
// claude.ai, which also wraps the page in a document of its own: so with `--fragment` the file is only what goes inside
// the body (its title, its styles, its elements and its script), as such a page is written.
//
//   node tools/buildingLabPage.mjs [out.html] [--fragment]      (by default dist/building-lab.html, a whole document)
import { build } from 'vite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), fragment = args.includes('--fragment');
const out = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'dist/building-lab.html'));
const tmp = mkdtempSync(join(tmpdir(), 'building-lab-'));
try {
  await build({
    root, configFile: false, base: './', logLevel: 'warn',
    build: {
      outDir: tmp, emptyOutDir: true, target: 'es2022', modulePreload: false, assetsInlineLimit: 1e9, cssCodeSplit: false,
      // (One input and its imports in one chunk: there is nowhere to fetch a second from.)
      rollupOptions: { input: { lab: join(root, 'lab/buildings.html') }, output: { inlineDynamicImports: true } },
    },
  });
  let html = readFileSync(join(tmp, 'lab/buildings.html'), 'utf8');
  html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
  const scripts = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)];
  if (scripts.length !== 1) throw new Error(`expected one script in the built page, found ${scripts.length}`);
  let code = readFileSync(join(tmp, 'lab', scripts[0][1]), 'utf8');
  // (Inside an inline script the page's parser stops at the first `</script`; written `<\/script` it means the same to the program.)
  code = code.replace(/<\/script/gi, '<\\/script');
  if (code.includes('<!--')) throw new Error('the program has "<!--" in it, which an inline script cannot carry safely');
  html = html.replace(scripts[0][0], '');
  // The script goes last, after the elements it looks for.
  html = html.replace('</body>', () => `<script type="module">${code}</script>\n</body>`);
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
