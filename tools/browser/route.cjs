// Walks the route page (lab/route.html): a way from a coastal town to a valley head, its bed cut into the land at a metre and drawn as
// a track. Waits for the way and the squares about its start; keeps a picture from the quay looking along the way; walks it with the
// keys for a while and reports how far along it the walker got; tries to leave the corridor and reports where it held; keeps pictures
// halfway along and from above; and waits for the two places to be laid out ahead for the game, as the page does while one walks.
//   node tools/browser/route.cjs <out folder> [world seed] [from] [to]      (from and to as coast1, valley2)
// Needs a server on port 4173 (or PORT) serving the build (`npm run build`, then `npx vite preview`): only a build keeps the places
// laid out ahead, where the game finds them. With REAL_GPU=1 it opens a window and uses the machine's graphics card.
const { chromium } = require('playwright');
const fs = require('node:fs');
/**
 * Waits for the ground about the walker to be in: its squares meshed, the far land laid, the grass near by grown. Not every tree out
 * to 320 metres, which in software drawing comes in a block a frame at seconds a frame, and would take most of an hour; on a graphics
 * card it is a few seconds. Says every half minute what is still coming, and goes on after five minutes whatever is in.
 */
const settle = async (page, what) => {
  const t = Date.now();
  let said = t;
  for (;;) {
    const u = await page.evaluate(() => window.__walk.unsettled());
    if (!u.pending && !u.squares && !u.far && !u.grass) return;
    if (Date.now() - t > 300000) { console.log(`  going on ${what} with some still coming: ${JSON.stringify(u)}`); return; }
    if (Date.now() - said > 30000) { said = Date.now(); console.log(`  waiting ${what}: ${JSON.stringify(u)}`); }
    await page.waitForTimeout(2000);
  }
};
const picture = async (page, path) => {
  const url = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(document.getElementById('view').toDataURL('image/png')))));
  fs.writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
};
(async () => {
  const [out, seed = 'w0', from, to] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540) }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(0);
  const q = new URLSearchParams({ world: seed, dpr: '1', tex: '512' });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  await page.goto(`http://localhost:${process.env.PORT ?? 4173}/lab/route.html?${q}`);
  await page.waitForFunction(() => window.__walk && window.__walk.route(), null, { timeout: 600000, polling: 1000 });
  const r0 = await page.evaluate(() => { const r = window.__walk.route(); return { length: r.length, from: r.from.name, to: r.to.name, squares: r.squares, points: r.way.points.length }; });
  console.log(`${secs()} s: the way from ${r0.from} to ${r0.to}, ${(r0.length / 1000).toFixed(2)} km, ${r0.points} points; ${r0.squares} squares within reach of its corridor`);
  await settle(page, 'at the start');
  await page.waitForTimeout(2000);
  let st = await page.evaluate(() => window.__walk.stats());
  console.log(`${secs()} s: settled at the start; ${st.squares} squares, ${st.drawnTriangles.toLocaleString()} triangles drawn; ${st.trees} whole trees`);
  await picture(page, `${out}/${seed}-start.png`);
  // Walking: W held for a while (running), the walker turned along the way as they go.
  await page.keyboard.down('ShiftLeft');
  for (let k = 0; k < 3; k++) {
    // (Faced along the way from where they are: the next point some forty metres on.)
    await page.evaluate(() => {
      const r = window.__walk.route(), st = window.__walk.stats(), p = r.way.points;
      let best = 0, bd = Infinity;
      p.forEach(([x, z], i) => { const d = Math.hypot(x - st.x, z - st.z); if (d < bd) { bd = d; best = i; } });
      const [tx, tz] = p[Math.min(p.length - 1, best + 10)];
      window.__walk.goto(st.x, st.z, 1.7, Math.atan2(-(tx - st.x), -(tz - st.z)), -0.05, false);
    });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(8000); await page.keyboard.up('KeyW');
  }
  await page.keyboard.up('ShiftLeft');
  let r = await page.evaluate(() => { const r = window.__walk.route(); return { s: r.s, off: r.off }; });
  console.log(`${secs()} s: walked with the keys to ${r.s.toFixed(0)} m along, ${r.off.toFixed(1)} m off the middle`);
  // Leaving the corridor: put four hundred metres off the way, square to it, and see where the next frames hold the walker.
  await page.evaluate(() => {
    const r = window.__walk.route(), st = window.__walk.stats(), p = r.way.points;
    let best = 1, bd = Infinity;
    p.forEach(([x, z], i) => { const d = Math.hypot(x - st.x, z - st.z); if (i && d < bd) { bd = d; best = i; } });
    const dx = p[best][0] - p[best - 1][0], dz = p[best][1] - p[best - 1][1], l = Math.hypot(dx, dz);
    window.__walk.goto(p[best][0] - (dz / l) * 400, p[best][1] + (dx / l) * 400, 1.7, 0, -0.05, false);
  });
  await page.waitForTimeout(4000);
  r = await page.evaluate(() => { const r = window.__walk.route(); return { s: r.s, off: r.off }; });
  const hud = await page.evaluate(() => document.getElementById('hud').textContent);
  console.log(`${secs()} s: put 400 m off the way; held ${r.off.toFixed(1)} m off its middle, ${r.s.toFixed(0)} m along. The panel says:\n  ${hud.split('\n').slice(0, 4).join('\n  ')}`);
  // Halfway along, on the way, looking along it.
  await page.evaluate(() => {
    const r = window.__walk.route(), p = r.way.points, k = Math.floor(p.length / 2), [x, z] = p[k], [tx, tz] = p[Math.min(p.length - 1, k + 8)];
    window.__walk.goto(x, z, 1.7, Math.atan2(-(tx - x), -(tz - z)), -0.06, false);
  });
  await page.waitForTimeout(1500);
  await settle(page, 'there');
  await page.waitForTimeout(2500);
  await picture(page, `${out}/${seed}-half.png`);
  // Near the end, looking up to the valley head.
  await page.evaluate(() => {
    const r = window.__walk.route(), p = r.way.points, k = Math.max(0, p.length - 30), [x, z] = p[k], [tx, tz] = p[p.length - 1];
    window.__walk.goto(x, z, 1.7, Math.atan2(-(tx - x), -(tz - z)), -0.02, false);
  });
  await page.waitForTimeout(1500);
  await settle(page, 'there');
  await page.waitForTimeout(2500);
  await picture(page, `${out}/${seed}-end.png`);
  // From above, over the middle of the way, looking down along it.
  await page.evaluate(() => {
    const r = window.__walk.route(), p = r.way.points, k = Math.floor(p.length * 0.35), [x, z] = p[k], [tx, tz] = p[p.length - 1];
    window.__walk.goto(x, z, 160, Math.atan2(-(tx - x), -(tz - z)), -0.55, true);
  });
  await page.waitForTimeout(2000);
  await settle(page, 'there');
  await page.waitForTimeout(2500);
  await picture(page, `${out}/${seed}-above.png`);
  // The ink map of the stretch, with the walker on it: drawn when first opened (the sheet, then the walker over it, as one picture).
  await page.evaluate(() => window.__walk.ink(true));
  await page.waitForFunction(() => document.getElementById('ink').width > 0, null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(800);
  const saveInk = async (name) => {
    const url = await page.evaluate(() => { const a = document.getElementById('ink'), b = document.getElementById('inkme'), c = document.createElement('canvas'); c.width = a.width; c.height = a.height; const g = c.getContext('2d'); g.drawImage(a, 0, 0); g.drawImage(b, 0, 0); return c.toDataURL('image/png'); });
    fs.writeFileSync(`${out}/${seed}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  };
  await saveInk('ink');
  await page.evaluate(() => window.__walk.ink(false));
  // The places laid out ahead.
  await page.waitForFunction(() => /laid out ahead in|could not|Nothing is kept/.test(window.__walk.route().ahead), null, { timeout: 900000, polling: 2000 });
  const ahead = await page.evaluate(() => { const r = window.__walk.route(); return { ahead: r.ahead, ready: r.ready }; });
  console.log(`${secs()} s: ${ahead.ahead} (${ahead.ready.join(', ')})`);
  const links = await page.evaluate(() => [...document.querySelectorAll('#menus a')].map((a) => `${a.textContent} -> ${a.getAttribute('href')}`));
  console.log(`links: ${links.join(' | ')}`);
  // (The ink map again, now with the places laid out ahead drawn on it.)
  await page.evaluate(() => window.__walk.ink(true));
  await page.waitForTimeout(1500);
  await saveInk('ink-built');
  await browser.close();
})();
