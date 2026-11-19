// Climbs the lighthouse of each island with the player's body: in at the door, up the stair that
// winds round the newel, out onto the gallery and round it to the spyglass. Reports how far it got.
// Usage: node lighthouse.cjs seed1 seed2 ...  (islands; PORT as for the others)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = 0;
  for (const seed of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 240, height: 135 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
    await page.goto(`http://localhost:${process.env.PORT || 5173}/?seed=${seed}&place=island&world=none&nobake=1&dpr=1&bloom=0&air=0&nointro`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: 600000 });
    const r = await page.evaluate(() => {
      const { site, player, game, groundAt } = window.__dbg, lh = site.island.lighthouse;
      if (!lh) return { none: true };
      // The same measures the builder uses (see coast.ts).
      const r0 = lh.r, top = lh.height, rT = r0 * 0.8, wallT = 0.5, rise = 0.19, perTurn = 16, first = lh.door + 1.25, newel = 0.24;
      const inner = (h) => r0 + (rT - r0) * Math.min(1, Math.max(0, h / top)) - wallT;
      const at = (a, rr) => [lh.x + Math.cos(a) * rr, lh.z + Math.sin(a) * rr];
      const steps = Math.floor((top - 0.15) / rise), last = first + (steps / perTurn) * Math.PI * 2;
      const pts = [at(lh.door, r0 + 2.5), at(lh.door, r0 - 0.8), at(first - 0.35, (newel + inner(0)) / 2 + 0.15)];
      for (let s = 0; s <= steps; s += 1) { const a = first + ((s + 0.5) / perTurn) * Math.PI * 2; pts.push(at(a, (newel + inner(0.15 + s * rise)) / 2 + 0.12)); }
      const doorK = ((Math.round(((last + Math.PI / 4) / (Math.PI * 2)) * 16 - 0.5) % 16) + 16) % 16, out = ((doorK + 1) / 16) * Math.PI * 2, rl = rT - 0.3, gallery = rT + 1.0, spy = last + Math.PI * 0.5;
      pts.push(at(last + 0.5, 0.9), at(out - 0.6, 1.0), at(out, 1.0), at(out, (rl + gallery) / 2));
      // Round the gallery the short way to where the spyglass lies.
      const turn = ((spy - out + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      for (let k = 1; k <= 8; k++) pts.push(at(out + (turn * k) / 8, (rl + gallery) / 2));
      const start = pts[0];
      player.place({ x: start[0], y: groundAt(start[0], start[1]) + 1.8, z: start[1] }, 0);
      const walked = window.__dbg.walk(pts.slice(1), 0.35);
      const reached = walked.filter((w) => w.ok).length;
      for (let i = 0; i < 60; i++) game.update(1 / 60, i / 60);
      const spyglass = game.finds.find((f) => f.what.includes('spyglass'));
      return { points: pts.length - 1, reached, topY: Math.max(...walked.map((w) => w.y)), towerTop: lh.y + top, spyglass: spyglass ? spyglass.taken : 'none', firstFail: walked.findIndex((w) => !w.ok) };
    });
    if (!r.none && (r.reached < r.points || r.spyglass !== true)) failed++;
    console.log(seed, JSON.stringify(r));
    await page.close();
  }
  console.log(failed ? `${failed} FAILED` : 'all climbed');
  await browser.close();
})();
