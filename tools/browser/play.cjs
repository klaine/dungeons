// Plays generated sites to the end with the player's body. Usage: node play.cjs seed1 seed2 ... (WORLD=w2 node play.cjs land0:1 land1:2 builds them on that world's places)
const { chromium } = require('playwright');
(async () => {
  // With REAL_GPU=1 a window is opened and the machine's own graphics card is used; otherwise a software renderer, which needs none.
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = 0;
  for (const seed of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 240, height: 135 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
    // (With WORLD=w2, each seed is built on a place of that world: `seed:2` on the second of the kind, the first if no number is given.)
    const [name, n] = seed.split(':'), inWorld = process.env.WORLD ? `&world=${process.env.WORLD}&n=${n || 1}` : '';
    await page.goto(`http://localhost:${process.env.PORT || 5173}/?seed=${name}${process.env.PLACE ? `&place=${process.env.PLACE}` : ''}${inWorld}&nobake=1&dpr=1&bloom=0&air=0&nointro`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: inWorld ? 1500000 : 400000 });
    const walk = await page.evaluate(() => window.__dbg.walkTest());
    const r = await page.evaluate(() => window.__dbg.playthrough());
    const ui = await page.evaluate(() => ({ won: !document.getElementById('won').hidden, text: document.getElementById('wonText').textContent, keys: document.getElementById('keys').textContent }));
    if (!r.won || walk.length || errs.length) failed++;
    console.log(`${seed}: ${r.won ? 'WON' : 'FAILED'} | doorways failing walk test: ${walk.length} | keys: ${r.keys} | win screen: ${ui.won} ${errs.length ? '| ERRORS ' + errs.join('; ') : ''}`);
    console.log('   ' + r.log.join(' > '));
    for (const f of walk) console.log('   walk: ' + f);
    await page.close();
  }
  console.log(failed ? `${failed} FAILED` : 'all completed');
  await browser.close();
})();
