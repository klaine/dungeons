// Drives the figures of the building lab (lab/buildings.html, `lab/figureCrew.ts`) on its own buildings, and says of each order whether
// the figure came to what it should: round the classical building to behind it; in at its door and up its stair to the first floor and
// the second, and out again; onto a ledge of rock painted on the square; onto the bench in front of a timber house, sitting; and one
// figure talking to another, then punching it. Keeps a picture of the figures from above, with the palette of orders.
//   node tools/browser/crew.cjs <out folder>
// Needs the development server on port 5179 (`npm run buildings`), or PORT. The figures are stepped by the script at thirty steps a
// second, so it does not matter how slowly software draws (opening the lab and bringing the figures in takes some two minutes so).
// With REAL_GPU=1 it opens a window and uses the machine's graphics card.
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
  const out = process.argv[2] ?? 'crew-out';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const faults = [];
  page.on('pageerror', (e) => faults.push(e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT ?? 5179}/lab/buildings.html?fresh&nofigures${process.env.REAL_GPU ? '' : '&webgl'}`);
  await page.waitForFunction(() => window.__lab && window.__lab.ready, null, { timeout: 400000 });
  await page.waitForFunction(() => window.__lab.pending() === 0, null, { timeout: 400000, polling: 1000 });
  await page.evaluate(() => window.__lab.stroke({ layer: 'rock', size: 1.0, points: [[-14, 2], [-13, 2.5], [-12, 3]] }));
  await page.evaluate(async () => {
    const L = window.__lab, V = (x, y, z) => L.camera.position.clone().set(x, y, z);
    L.keepSolids();
    for (const [kind, x, z] of [['base-man', 0, 7], ['base-woman', 2, 16], ['mannequin', 6, 16]]) await L.crew.add(kind, V(x, 0, z), Math.PI, false);
    window.T = {
      V,
      /** Steps the figures `sec` on, or until `until` says so; how long it took. */
      sim(sec, until) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { L.keepSolids(); L.crew.update(1 / 30); if (until && until()) return i / 30; } return sec; },
      at: (f) => f.body.position.toArray().map((v) => +v.toFixed(2)),
      put(f, x, y, z) { f.stop(); f.body.stand(V(x, y, z), 0); f.update(1 / 30); },
      /** Sends `f` with the order `id` to (x, y, z), looking down from `eye` (or from above), and waits until it is done or `until`. */
      send(f, id, at, eye, sec, until) { L.crew.choose([f], false); L.orderAt(id, at, eye); const ms = L.crew.nav.lastMs; const t = T.sim(sec, until ?? (() => !f.busy && f.state === 'ground')); T.sim(0.5); return { t, ms, at: T.at(f), state: f.state }; },
    };
  });
  console.log(`lab and figures in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  let failed = 0;
  const check = (what, ok, said) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${said}`); };
  const ev = (fn, a) => page.evaluate(fn, a);
  const near = (a, b, d) => Math.hypot(a[0] - b[0], a[2] - b[2]) < d && Math.abs(a[1] - b[1]) < 0.25;

  let r = await ev(() => T.send(window.__lab.crew.figures[0], 'walk', [0, 0, -22], undefined, 60));
  check('round the building to behind it', near(r.at, [0, 0, -22], 0.6), `at ${r.at} after ${r.t.toFixed(1)} s (way found in ${r.ms.toFixed(0)} ms)`);
  r = await ev(() => { const f = window.__lab.crew.figures[0]; T.put(f, 0, 0, 7); return T.send(f, 'walk', [0, 4.3, -8], [0, 5.8, -7.9], 90); });
  check('in at the door and up to the first floor', near(r.at, [0, 4.3, -8], 0.6), `at ${r.at} after ${r.t.toFixed(1)} s (way found in ${r.ms.toFixed(0)} ms)`);
  r = await ev(() => T.send(window.__lab.crew.figures[0], 'walk', [0, 8.7, -8], [0, 10.2, -7.9], 90));
  check('up to the second floor', near(r.at, [0, 8.7, -8], 0.6), `at ${r.at} after ${r.t.toFixed(1)} s`);
  r = await ev(() => T.send(window.__lab.crew.figures[0], 'walk', [0, 0, 9], undefined, 90));
  check('down and out again', near(r.at, [0, 0, 9], 0.6), `at ${r.at} after ${r.t.toFixed(1)} s`);
  r = await ev(() => { const L = window.__lab, f = L.crew.figures[2], top = L.surfaces(-13, 2.5).filter((h) => h[1] > 0.6)[0][0]; T.put(f, -12, 0, 10); const s = T.send(f, 'walk', [-13, top, 2.5], undefined, 30); return { ...s, top }; });
  check('onto the rock', r.at[1] > r.top - 0.3, `top ${r.top.toFixed(2)}; at ${r.at} after ${r.t.toFixed(1)} s`);
  r = await ev(() => {
    const L = window.__lab, f = L.crew.figures[0];
    // (A bench: a surface at the height of a seat with the ground just beside it, about the timber houses.)
    let seat = null;
    for (let x = -40; x <= -20 && !seat; x += 0.25) for (let z = -10; z <= 18 && !seat; z += 0.25) {
      const s = L.surfaces(x, z, 3).filter((h) => h[1] > 0.6);
      if (s.length && s[0][0] > 0.38 && s[0][0] < 0.58 && L.surfaces(x + 0.6, z, 3)[0]?.[0] < 0.05) seat = [x, s[0][0], z];
    }
    if (!seat) return { seat };
    T.put(f, seat[0] + 4, 0, seat[2] + 1);
    return { seat, ...T.send(f, 'sit', seat, [seat[0], seat[1] + 1.4, seat[2] + 0.05], 30, () => f.state === 'seated') };
  });
  check('sits on a bench', r.state === 'seated', r.seat ? `bench at ${r.seat}; ${r.state} after ${r.t.toFixed(1)} s` : 'no bench found');
  r = await ev(() => { const L = window.__lab, [, a, c] = L.crew.figures, p = c.body.position; T.put(a, 2, 0, 16); T.put(c, 6, 0, 16); const s = T.send(a, 'talk', [p.x, p.y + 1.2, p.z], [p.x, p.y + 12, p.z + 0.5], 15, () => a.state === 'act'); return { ...s, a: a.doing, c: c.doing }; });
  check('talks with another, which talks back', /talking/.test(r.a) && /talking/.test(r.c), `${r.a} / ${r.c}`);
  r = await ev(() => { const L = window.__lab, [, a, c] = L.crew.figures, p = c.body.position; L.crew.choose([a], false); L.orderAt('punch', [p.x, p.y + 1.2, p.z], [p.x, p.y + 12, p.z + 0.5]); T.sim(10, () => a.state === 'act'); T.sim(0.45); return { a: a.doing, c: c.doing }; });
  check('punches another, which is hit', /punch/.test(r.a) && /hit/.test(r.c), `${r.a} / ${r.c}`);

  await ev(() => window.__lab.crew.choose([window.__lab.crew.figures[1]]));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/chosen.png` });
  if (faults.length) { failed++; console.log(`FAIL errors in the page:\n  ${faults.join('\n  ')}`); }
  console.log(failed ? `${failed} failed` : 'all passed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
