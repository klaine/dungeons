// Drives the player at the edges of the valley from many directions, jumping, and reports whether they ever got out.
const { chromium } = require('playwright');
(async () => {
  // With REAL_GPU=1 a window is opened and the machine's own graphics card is used; otherwise a software renderer, which needs none.
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const seed of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 240, height: 135 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
    await page.goto(`http://localhost:5173/?seed=${seed}&nobake=1&dpr=1&bloom=0&air=0&nointro`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: 600000 });
    const r = await page.evaluate(() => {
      const { site, player, desc, groundAt } = window.__dbg;
      const g = site.grounds, a = site.places.find((p) => p.role === 'approach');
      let seedN = 12345;
      const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) >>> 0) / 4294967296);
      const out = { runs: 0, escaped: [], fell: [], stuckHigh: [], maxOut: 0, minY: 1e9, maxClimb: 0 };
      const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2;
      for (let run = 0; run < 36; run++) {
        // Start somewhere inside, aim at a point well beyond the edge (or at the cliff by the house).
        // Start somewhere inside the valley: a place in its box is tried until one is found that is in the valley itself.
        let sx = 0, sz = 0;
        for (let tries = 0; tries < 200; tries++) { sx = g.x0 + 8 + rnd() * (g.x1 - g.x0 - 16); sz = a.z1 + 4 + rnd() * (g.z1 - a.z1 - 12); if (!window.__dbg.beyond || window.__dbg.beyond(sx, sz) < -8) break; }
        const ang = (run / 36) * Math.PI * 2;
        const tx = cx + Math.sin(ang) * 140, tz = cz + Math.cos(ang) * 140;
        player.place({ x: sx, y: groundAt(sx, sz) + 1.8, z: sz }, 0);
        const startY = player.position.y;
        for (let i = 0; i < 1500; i++) {
          player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
          player.analog.set(0, -1);
          if (i % 40 === 0) player.jump();
          player.update(1 / 60);
        }
        const p = player.position;
        // Inside the house is not outside the valley: the door is open to anyone who walks at it.
        const indoors = site.places.some((q) => p.x > q.x0 - 1.2 && p.x < q.x1 + 1.2 && p.z > q.z0 - 1.2 && p.z < q.z1 + 1.2);
        // (Outside the valley's own shape, not merely outside the box that holds it.)
        const beyond = indoors ? -1 : window.__dbg.beyond ? window.__dbg.beyond(p.x, p.z) : Math.max(g.x0 - p.x, p.x - g.x1, p.z - g.z1, g.z0 - 2.5 - p.z);
        out.runs++;
        out.maxOut = Math.max(out.maxOut, beyond);
        out.minY = Math.min(out.minY, p.y);
        out.maxClimb = Math.max(out.maxClimb, p.y - startY);
        const where = `run ${run}: from (${sx.toFixed(0)}, ${sz.toFixed(0)}) to (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
        if (beyond > 0.5) out.escaped.push(where);
        if (p.y < a.floor - 4) out.fell.push(where);
        if (p.y - 1.75 > groundAt(p.x, p.z) + 3 ) out.stuckHigh.push(where);
      }
      // Each thing left in the valley: walk to it from a few metres off, on the side of the track, and see it taken.
      const { game } = window.__dbg;
      out.finds = [];
      const track = site.track;
      for (const f of game.finds) {
        let best = track[0], bd = 1e9;
        for (const t of track) { const d = Math.hypot(t[0] - f.at.x, t[1] - f.at.z); if (d < bd) { bd = d; best = t; } }
        const ux = (best[0] - f.at.x) / bd, uz = (best[1] - f.at.z) / bd;
        // The hut is entered by its doorway, which faces the track across the valley.
        const hut = f.what.includes('hut');
        // From the side of the track first; if something stands in the way, from either side of that.
        for (const turn of hut ? [0] : [0, 0.9, -0.9, 2.2]) {
          if (f.taken) break;
          const cx = ux * Math.cos(turn) - uz * Math.sin(turn), cz = ux * Math.sin(turn) + uz * Math.cos(turn);
          const sx = hut ? f.at.x + Math.sign(best[0] - f.at.x) * 8 : f.at.x + cx * 7, sz = hut ? f.at.z : f.at.z + cz * 7;
          player.place({ x: sx, y: groundAt(sx, sz) + 1.8, z: sz }, 0);
          for (let i = 0; i < 600 && !f.taken; i++) {
            player.yaw = Math.atan2(-(f.at.x - player.position.x), -(f.at.z - player.position.z));
            player.analog.set(0, -1);
            player.update(1 / 60);
            game.update(1 / 60, i / 60);
          }
        }
        out.finds.push(`${f.taken ? 'taken' : 'NOT TAKEN'}: ${f.what.slice(0, 30)} (player ended ${Math.hypot(player.position.x - f.at.x, player.position.z - f.at.z).toFixed(1)} m away, at height ${(player.position.y - f.at.y).toFixed(1)})`);
      }
      player.analog.set(0, 0);
      player.place(desc.spawn.position, desc.spawn.yaw);
      return out;
    });
    console.log(seed, JSON.stringify(r));
    await page.close();
  }
  await browser.close();
})();
