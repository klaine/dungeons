// Walks out along the landing stage from the bank and reports whether the player stays on the deck.
const { chromium } = require('playwright');
(async () => {
  // With REAL_GPU=1 a window is opened and the machine's own graphics card is used; otherwise a software renderer, which needs none.
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const seed of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 240, height: 135 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:5173/?seed=${seed}&nobake=1&dpr=1&bloom=0&air=0&nointro`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: 600000 });
    console.log(seed, JSON.stringify(await page.evaluate(() => {
      const { site, player, desc, groundAt, game } = window.__dbg;
      const pond = site.features.find((f) => f.kind === 'pond');
      if (!pond) return 'no pond';
      const find = game.finds.find((f) => f.what.includes('landing'));
      const d = Math.hypot(find.at.x - pond.x, find.at.z - pond.z), ux = (find.at.x - pond.x) / d, uz = (find.at.z - pond.z) / d;
      const sx = pond.x + ux * pond.r * 1.3, sz = pond.z + uz * pond.r * 1.3;
      player.place({ x: sx, y: groundAt(sx, sz) + 1.8, z: sz }, 0);
      const heights = [];
      for (let i = 0; i < 500 && !find.taken; i++) {
        player.yaw = Math.atan2(-(find.at.x - player.position.x), -(find.at.z - player.position.z));
        player.analog.set(0, -1);
        player.update(1 / 60);
        game.update(1 / 60, i / 60);
        if (i % 25 === 0) heights.push(+(player.position.y - find.at.y).toFixed(2));
      }
      player.analog.set(0, 0);
      return { taken: find.taken, feetBelowFind: heights };
    })));
    await page.close();
  }
  await browser.close();
})();
