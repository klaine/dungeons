// Walks a world's land streamed in at a metre (walk.html): goes to each place given, waits until the squares about it are made and
// meshed, and reports how long that took, how many triangles are drawn and what each square was meshed to; and saves a picture.
//   node tools/browser/walk.cjs <out folder> <world seed> [place ...]     (places as valley1, island2, mountain3)
// Needs the development server on port 5173 (or PORT). With REAL_GPU=1 it opens a window and uses the machine's graphics card;
// otherwise a software renderer draws, slowly, so its frame times say nothing of a real one.
const { chromium } = require('playwright');
const fs = require('node:fs');
/** A picture from the page's own canvas: a screenshot waits for frames, and each frame is slow when drawn in software. */
const picture = async (page, path) => {
  const url = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(document.getElementById('view').toDataURL('image/png')))));
  fs.writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
};
const here0 = (st) => ({ x: st.x, z: st.z });
(async () => {
  const [out, seed = 'w2', ...places] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/walk.html?world=${seed}&dpr=1&tex=512&at=${places[0] ?? 'valley1'}`);
  await page.waitForFunction(() => window.__walk, null, { timeout: 600000 });
  console.log(`world ready after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const at of places.length ? places : ['valley1', 'island1', 'mountain1']) {
    const t1 = Date.now();
    // (Placed by the page's own keys: the place's number, with Shift for an island and Ctrl for a mountain top.)
    const m = /^(valley|island|mountain)(\d)$/.exec(at);
    if (m) await page.keyboard.press(`${m[1] === 'island' ? 'Shift+' : m[1] === 'mountain' ? 'Control+' : ''}Digit${m[2]}`);
    await page.waitForFunction(() => window.__walk.settled(), null, { timeout: 900000, polling: 1000 });
    const settle = (Date.now() - t1) / 1000;
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => window.__walk.stats());
    console.log(`${at}: settled in ${settle.toFixed(0)} s; ${st.squares} squares, ${st.squareTriangles.toLocaleString()} triangles in them, ${st.drawnTriangles.toLocaleString()} drawn; a square ${st.squareMsMiddle.toFixed(0)} ms; meshed ${st.levels.join('/')}; ${Math.round(st.tufts).toLocaleString()} tufts, ${st.trees} whole trees, ${st.farTreeCards.toLocaleString()} painted; frame ${st.frameMs.toFixed(0)} ms`);
    // From where one stands, looking north, to the hills.
    await page.evaluate(([x, z]) => window.__walk.goto(x, z, 1.7, 0, 0.02, false), [here0(st).x, here0(st).z]);
    await page.waitForFunction(() => window.__walk.settled(), null, { timeout: 900000, polling: 1000 });
    await page.waitForTimeout(2500);
    await picture(page, `${out}/${seed}-${at}-eye.png`);
    // Three pictures: from forty metres up looking out over the place; and from four hundred straight down, as it is and as its
    // triangles, which thin out with distance from where one stands.
    const here = here0(await page.evaluate(() => window.__walk.stats()));
    await page.evaluate(([x, z]) => window.__walk.goto(x, z, 40, 0.6, -0.28, true), [here.x, here.z]);
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => window.__walk.settled(), null, { timeout: 900000, polling: 1000 });
    await picture(page, `${out}/${seed}-${at}-out.png`);
    await page.evaluate(([x, z]) => window.__walk.goto(x, z, 420, 0, -1.5, true), [here.x, here.z]);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__walk.wireframe(true));
    await page.waitForTimeout(1500);
    await picture(page, `${out}/${seed}-${at}-wire.png`);
    await page.evaluate(([x, z]) => { window.__walk.wireframe(false); window.__walk.goto(x, z, 1.7, 0, -0.05, false); }, [here.x, here.z]);
  }
  await browser.close();
})();
