/**
 * Expressive range report: what the generator produces, measured over many seeds.
 *
 * Any single site can look fine while the generator as a whole makes the same thing over and
 * over. This runs it thousands of times and draws where the results fall, so sameness shows.
 * Writes a self-contained page to public/range.html, which is published with the site.
 *
 * Usage: npx tsx tools/range.ts [count]
 */
import { writeFileSync } from 'node:fs';
import { generateSite } from '../src/core/generate';
import { solve } from '../src/core/mission';
import { loopCount } from '../src/core/site';

const count = Number(process.argv[2] ?? 2000);
const LOOPS = ['1', '2', '3', '4+'];
const RATIO = ['under 1.5', '1.5 to 2', '2 to 2.5', '2.5 to 3', '3 or more'];
const grid = RATIO.map(() => LOOPS.map(() => 0));
const tally = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const rooms = new Map<string, number>();
const plans = new Map<string, number>();
const features = new Map<string, number>();
const dark = new Map<string, number>();
let failures = 0;

for (let n = 0; n < count; n++) {
  try {
    const site = generateSite(`range-${n}`);
    const solution = solve(site);
    const ratio = solution.moves.length / Math.max(1, solution.direct);
    const loops = Math.min(4, loopCount(site));
    grid[ratio < 1.5 ? 0 : ratio < 2 ? 1 : ratio < 2.5 ? 2 : ratio < 3 ? 3 : 4][loops - 1]++;
    tally(rooms, String(site.places.filter((p) => p.roof !== 'sky' && p.id !== site.secret).length));
    tally(plans, /: \w+ rooms (.*?)(?:,|;)/.exec(site.title)?.[1] ?? 'other');
    tally(dark, String(site.places.filter((p) => p.light === 'dark' && p.id !== site.secret).length));
    const has = (name: string, yes: boolean) => yes && tally(features, name);
    has('A court open to the sky', site.places.some((p) => p.role === 'court'));
    has('A natural cave', site.places.some((p) => p.roof === 'cave'));
    has('A hidden chamber', site.secret >= 0);
    has('Two keys', site.items.length === 2);
    has('A portcullis and lever', site.levers.length > 0);
    has('A barred door', site.ways.some((w) => w.door?.barredFrom !== undefined));
    has('A fallen roof', site.places.some((p) => p.fallen));
  } catch {
    failures++;
  }
}
const made = count - failures;

// ---- drawing. One hue throughout: every chart here shows how much, never which.
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (n: number) => `${((100 * n) / made).toFixed(n / made < 0.1 ? 1 : 0)}%`;

function heatmap(): string {
  const max = Math.max(...grid.flat());
  const cw = 92, ch = 46, left = 96, top = 30;
  let out = `<svg viewBox="0 0 ${left + cw * 4 + 12} ${top + ch * 5 + 44}" role="img" aria-label="Sites by number of loops and by how much longer the true route is than the direct one">`;
  LOOPS.forEach((l, i) => { out += `<text class="tick" x="${left + cw * i + cw / 2}" y="${top - 10}" text-anchor="middle">${l}</text>`; });
  out += `<text class="axis" x="${left + cw * 2}" y="${top + ch * 5 + 34}" text-anchor="middle">Independent loops in the plan</text>`;
  RATIO.forEach((r, j) => {
    // Longest routes at the top, like a chart's y axis.
    const row = RATIO.length - 1 - j;
    out += `<text class="tick" x="${left - 10}" y="${top + ch * j + ch / 2 + 4}" text-anchor="end">${RATIO[row]}</text>`;
    LOOPS.forEach((l, i) => {
      const v = grid[row][i];
      const step = v === 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1) + 0.5));
      const fill = step < 0 ? 'var(--empty)' : RAMP[step];
      const tip = `${v.toLocaleString()} sites (${pct(v)}) · ${l} ${l === '1' ? 'loop' : 'loops'} · route ${RATIO[row]} times the direct one`;
      out += `<rect class="mark" tabindex="0" data-tip="${esc(tip)}" x="${left + cw * i + 1}" y="${top + ch * j + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${fill}"/>`;
      // Label only the cells that hold a real share; the table below has every number.
      if (v / made >= 0.04) out += `<text class="${step >= 6 ? 'on-dark' : 'on-light'}" x="${left + cw * i + cw / 2}" y="${top + ch * j + ch / 2 + 4}" text-anchor="middle">${pct(v)}</text>`;
    });
  });
  return `${out}</svg>`;
}

function bars(rows: [string, number][], label: string): string {
  const max = Math.max(...rows.map((r) => r[1]));
  const left = 196, width = 300, band = 30, thick = 18;
  let out = `<svg viewBox="0 0 ${left + width + 64} ${rows.length * band + 8}" role="img" aria-label="${esc(label)}">`;
  out += `<line class="base" x1="${left}" y1="2" x2="${left}" y2="${rows.length * band + 2}"/>`;
  rows.forEach(([name, v], k) => {
    const w = Math.max(2, (v / max) * width);
    const y = k * band + (band - thick) / 2 + 2;
    // Square at the baseline, rounded at the data end.
    out += `<path class="mark bar" tabindex="0" data-tip="${esc(`${v.toLocaleString()} of ${made.toLocaleString()} sites (${pct(v)}) · ${name}`)}" d="M${left},${y} h${w - 4} a4,4 0 0 1 4,4 v${thick - 8} a4,4 0 0 1 -4,4 h${-(w - 4)} z"/>`;
    out += `<text class="tick" x="${left - 10}" y="${y + thick / 2 + 4}" text-anchor="end">${esc(name)}</text>`;
    out += `<text class="value" x="${left + w + 8}" y="${y + thick / 2 + 4}">${pct(v)}</text>`;
  });
  return `${out}</svg>`;
}

function columns(rows: [string, number][], label: string, axis: string): string {
  const max = Math.max(...rows.map((r) => r[1]));
  // Every column chart is drawn seven columns wide, so their lettering comes out the same size.
  const band = 44, thick = 24, height = 150, top = 22, slots = Math.max(7, rows.length);
  const left = 8 + ((slots - rows.length) * band) / 2;
  let out = `<svg viewBox="0 0 ${16 + slots * band} ${top + height + 44}" role="img" aria-label="${esc(label)}">`;
  out += `<line class="base" x1="${left}" y1="${top + height}" x2="${left + rows.length * band}" y2="${top + height}"/>`;
  const peak = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  rows.forEach(([name, v], k) => {
    const h = Math.max(2, (v / max) * height);
    const x = left + k * band + (band - thick) / 2;
    out += `<path class="mark bar" tabindex="0" data-tip="${esc(`${v.toLocaleString()} sites (${pct(v)}) · ${name} ${axis}`)}" d="M${x},${top + height} v${-(h - 4)} a4,4 0 0 1 4,-4 h${thick - 8} a4,4 0 0 1 4,4 v${h - 4} z"/>`;
    out += `<text class="tick" x="${x + thick / 2}" y="${top + height + 16}" text-anchor="middle">${esc(name)}</text>`;
    // Only the tallest column carries its value; the rest are in the tooltip and the table.
    if (name === peak[0]) out += `<text class="value" x="${x + thick / 2}" y="${top + height - h - 6}" text-anchor="middle">${pct(v)}</text>`;
  });
  out += `<text class="axis" x="${left + (rows.length * band) / 2}" y="${top + height + 36}" text-anchor="middle">${esc(axis)}</text>`;
  return `${out}</svg>`;
}

const byNumber = (m: Map<string, number>) => [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const table = (head: string[], rows: (string | number)[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const twoPlus = grid.reduce((s, row) => s + row[1] + row[2] + row[3], 0);
const longRoutes = grid[2].concat(grid[3], grid[4]).reduce((a, b) => a + b, 0);
const emptyCells = grid.flat().filter((v) => v === 0).length;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dungeons: expressive range</title>
<style>
  :root { color-scheme: light; --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781; --grid: #e1e0d9; --base: #c3c2b7; --series: #2a78d6; --empty: #f0efec; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --base: #383835; --series: #3987e5; --empty: #232322; } }
  :root[data-theme="dark"] { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --base: #383835; --series: #3987e5; --empty: #232322; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 0 0 2px; }
  p { margin: 0 0 12px; color: var(--ink2); max-width: 68ch; }
  .lede { font-size: 16px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 22px 0; }
  .tile, .card { background: var(--surface); border: 1px solid var(--grid); border-radius: 8px; padding: 14px 16px; }
  .tile b { display: block; font-size: 28px; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .tile span { color: var(--ink2); font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 430px), 1fr)); gap: 14px; }
  .card.wide { grid-column: 1 / -1; }
  .card p { font-size: 13px; margin-bottom: 10px; }
  svg { display: block; width: 100%; height: auto; max-width: 560px; overflow: visible; }
  .card.wide svg { max-width: 520px; }
  text { font: 12px ui-sans-serif, system-ui, sans-serif; fill: var(--ink2); }
  .axis { fill: var(--muted); }
  .value { fill: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .on-dark { fill: #fff; font-weight: 600; }
  .on-light { fill: #0b0b0b; font-weight: 600; }
  .base { stroke: var(--base); stroke-width: 1; }
  .bar { fill: var(--series); }
  .mark { outline: none; }
  .mark:hover, .mark:focus-visible { filter: brightness(1.12); stroke: var(--ink); stroke-width: 1.5; }
  details { margin-top: 10px; font-size: 13px; }
  summary { cursor: pointer; color: var(--ink2); }
  table { border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 3px 12px 3px 0; border-bottom: 1px solid var(--grid); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--ink2); font-weight: 600; }
  #tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); padding: 6px 9px; border-radius: 5px; font-size: 12.5px; max-width: 280px; opacity: 0; transition: opacity .1s; z-index: 2; }
</style>
</head>
<body>
<main>
  <h1>What the generator makes</h1>
  <p class="lede">${made.toLocaleString()} sites, one per seed, measured after the generator has picked the best of six drafts for each. A healthy generator spreads its output; one that keeps landing in the same place is making the same site again and again.</p>
  <div class="tiles">
    <div class="tile"><b>${made.toLocaleString()}</b><span>sites generated${failures ? `, ${failures} failed` : ', none failed'}</span></div>
    <div class="tile"><b>100%</b><span>proven completable by the solver</span></div>
    <div class="tile"><b>${pct(twoPlus)}</b><span>have two or more loops</span></div>
    <div class="tile"><b>${pct(longRoutes)}</b><span>need a route at least twice the direct one</span></div>
  </div>
  <div class="cards">
    <div class="card wide">
      <h2>Loops against route length</h2>
      <p>Rows show how many times longer the solver's shortest route is than walking straight to the goal with every door open: a measure of how much the locks and gates make the player go round. ${emptyCells} of 20 cells are empty.</p>
      ${heatmap()}
      <details><summary>Table</summary>${table(['Route / direct', ...LOOPS.map((l) => `${l} loops`)], RATIO.map((r, j) => [r, ...grid[j]]))}</details>
    </div>
    <div class="card">
      <h2>How often each feature appears</h2>
      <p>Share of sites with at least one.</p>
      ${bars(byCount(features), 'Share of sites with each feature')}
      <details><summary>Table</summary>${table(['Feature', 'Sites', 'Share'], byCount(features).map(([k, v]) => [k, v, pct(v)]))}</details>
    </div>
    <div class="card">
      <h2>Plan shapes</h2>
      <p>Which arrangement of loops the chosen draft used.</p>
      ${bars(byCount(plans).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]), 'Share of sites by plan shape')}
      <details><summary>Table</summary>${table(['Plan', 'Sites', 'Share'], byCount(plans).map(([k, v]) => [k, v, pct(v)]))}</details>
    </div>
    <div class="card">
      <h2>Rooms per site</h2>
      <p>Roofed rooms, not counting courts or a hidden chamber.</p>
      ${columns(byNumber(rooms), 'Sites by number of rooms', 'rooms')}
      <details><summary>Table</summary>${table(['Rooms', 'Sites', 'Share'], byNumber(rooms).map(([k, v]) => [k, v, pct(v)]))}</details>
    </div>
    <div class="card">
      <h2>Unlit rooms per site</h2>
      <p>Rooms left dark on purpose, for the light the player carries.</p>
      ${columns(byNumber(dark), 'Sites by number of unlit rooms', 'unlit rooms')}
      <details><summary>Table</summary>${table(['Unlit rooms', 'Sites', 'Share'], byNumber(dark).map(([k, v]) => [k, v, pct(v)]))}</details>
    </div>
  </div>
</main>
<div id="tip" role="status"></div>
<script>
  const tip = document.getElementById('tip');
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.style.opacity = 1; tip.style.left = Math.min(x + 14, innerWidth - 300) + 'px'; tip.style.top = (y + 16) + 'px'; };
  for (const el of document.querySelectorAll('[data-tip]')) {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => (tip.style.opacity = 0));
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.right, r.top); });
    el.addEventListener('blur', () => (tip.style.opacity = 0));
  }
</script>
</body>
</html>
`;
writeFileSync(new URL('../public/range.html', import.meta.url), html);
console.log(`${made} sites, ${failures} failures; ${pct(twoPlus)} with two or more loops; ${pct(longRoutes)} with routes at least twice direct; ${emptyCells} of 20 cells empty`);
console.log('wrote public/range.html');
