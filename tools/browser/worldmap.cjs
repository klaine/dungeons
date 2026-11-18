// Makes worlds on the world page and saves each as pictures: the ink map and the relief.
//   node tools/browser/worldmap.cjs <out folder> <seed> [seed...]
// Needs the development server on port 5173 (or PORT), as the other scripts here do.
const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
  const [out, ...seeds] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const seed of seeds) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => console.log(seed, 'page error:', e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:${process.env.PORT ?? 5173}/world.html?world=${encodeURIComponent(seed)}`);
    await page.waitForFunction(() => window.__worldReady === true, null, { timeout: 900000 });
    const made = (Date.now() - t0) / 1000;
    for (const view of ['ink', 'relief']) {
      await page.click(`#${view}`);
      const url = await page.evaluate(() => document.getElementById('map').toDataURL('image/png'));
      fs.writeFileSync(`${out}/${seed}-${view}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`${seed}: made and drawn in ${made.toFixed(0)} s; ${await page.evaluate(() => document.getElementById('status').textContent)}`);
    await page.close();
  }
  await browser.close();
})();
