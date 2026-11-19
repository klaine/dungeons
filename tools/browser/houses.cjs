// Walks into houses of brick and canal houses with the player's body, and up their stairs: from the street up the stoop (or
// straight in), in at the front door, to the foot of the stair, up the flight, back along the well to the foot of the next, and so on
// to the top storey. Reports for each house how far it got and how high its feet were at the end, against the top floor.
// Usage: node houses.cjs seed1 seed2 ...   PLACE=town (default: canal houses in a harbour town) or PLACE=valley (a valley given a
// town of brick, as `?settle=town` asks); HOUSES (how many to a seed, 6 by default); PORT as for the others.
const { chromium } = require('playwright');
(async () => {
  const place = process.env.PLACE || 'town', many = Number(process.env.HOUSES || 6);
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = 0;
  for (const seed of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 240, height: 135 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
    const ask = place === 'valley' ? 'settle=town' : 'place=town';
    await page.goto(`http://localhost:${process.env.PORT || 5173}/?seed=${seed}&${ask}&nobake=1&dpr=1&bloom=0&air=0&nointro`);
    await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: 3000000, polling: 3000 });
    const rows = await page.evaluate(async (many) => {
      const C = await import('/src/core/canal.ts'), K = await import('/src/core/brick.ts'), I = await import('/src/core/interior.ts'), T = await import('/src/core/town.ts');
      const { site, player, groundAt } = window.__dbg, all = site.town ? site.town.buildings : site.buildings ?? [];
      // A spread of the houses that can be entered, of every plan: one of each of its rooms' kinds first, then the rest in turn.
      const houses = all.filter((b) => b.plan && (b.style === 'canal' || b.style === 'brick'));
      const sig = (b) => `${b.style}:${[...new Set(b.plan.rooms.map((r) => r.kind))].sort().join(',')}:${b.storeys}`;
      const picked = [], seen = new Set();
      for (const b of houses) if (!seen.has(sig(b))) { seen.add(sig(b)); picked.push(b); }
      for (const b of houses) if (picked.length < many && !picked.includes(b)) picked.push(b);
      const out = [];
      for (const b of picked.slice(0, many)) {
        const canal = b.style === 'canal', sh = canal ? C.canalShell(b) : K.brickShell(b), door = canal ? C.canalDoor(b) : K.brickDoor(b), W = b.w;
        const base = b.y ?? groundAt(...T.fromBuilding(b, 0, -1.5)) ?? 0, at = (u, v) => T.fromBuilding(b, u, v), du = (door.s0 + door.s1) / 2 - W / 2;
        const pts = [];
        // The way in: up the stoop if it has one, along its flight to the landing; else straight in.
        const st = canal ? C.canalStoop(b) : null;
        let start;
        if (st && st.flights.length && b.canalwork.stoop > 0.5) {
          const fl = st.flights[0];
          if (fl.dir === 0) { start = [du, -(st.landing.out + fl.steps * fl.tread + 1.5)]; pts.push([du, -0.45]); }
          else { const end = fl.s + fl.dir * (fl.steps * fl.tread + 0.6) - W / 2; start = [end, -1.8]; pts.push([end, -0.5], [(st.landing.s0 + st.landing.s1) / 2 - W / 2, -0.55]); }
        } else { start = [du, -2.5]; }
        pts.push([du, sh.v0 + 0.8]);
        const stair = b.plan.stair, flights = stair ? I.steepFlights(sh.floors, stair.v1 - stair.v0) : [];
        if (stair) {
          const mid = (stair.u0 + stair.u1) / 2, open = stair.wall < 0 ? stair.u1 : stair.u0, out = stair.wall < 0 ? 1 : -1;
          flights.forEach((f, k) => {
            // (On each storey, the free way beside the stair: midway between its rail and the far side of the room it stands in; reached past the end
      // of the longer of the flight come up and the flight going on up, whose balusters stand along it from the floor.)
            const rooms = b.plan.rooms.filter((r) => r.storey === undefined || r.storey === k), room = rooms.find((r) => mid > r.u0 && mid < r.u1 && stair.v0 > r.v0 - 0.01 && stair.v0 < r.v1 + 0.01);
            const far = room ? (out > 0 ? room.u1 : room.u0) : open + out * 1.2, free = (open + out * 0.05 + far) / 2;
            if (k > 0) { const past = stair.v0 + Math.max(flights[k - 1].length, f.length) + 0.45; pts.push([mid, past], [free, past], [free, stair.v0 - 0.55]); }
            if (k === 0) pts.push(...I.routeThrough(b.plan, sh, 0, pts[pts.length - 1], [mid, stair.v0 - 0.55]));
            pts.push([mid, stair.v0 - 0.55], [mid, stair.v0 + f.length + 0.45]);
          });
        }
        const [sx, sz] = at(...start);
        player.place({ x: sx, y: (groundAt(sx, sz) ?? base) + 1.75, z: sz }, 0);
        const walked = window.__dbg.walk(pts.map(([u, v]) => at(u, v)), 0.3), reached = walked.filter((w) => w.ok).length;
        const want = base + sh.floors[b.storeys - 1], got = walked.length ? walked[walked.length - 1].y : 0;
        out.push({ house: `${b.style} ${canal ? b.canalwork.gable : b.brickwork.kind} ${b.w}x${b.d} ${b.storeys} storeys (${[...new Set(b.plan.rooms.map((r) => r.kind))].join(' ')})`, points: pts.length, reached, top: +(got - want).toFixed(2), firstFail: walked.findIndex((w) => !w.ok) });
      }
      return out;
    }, many);
    for (const r of rows) {
      const ok = r.reached === r.points && Math.abs(r.top) < 0.3;
      if (!ok) failed++;
      console.log(seed, ok ? 'ok  ' : 'FAIL', JSON.stringify(r));
    }
    if (!rows.length) console.log(seed, 'no house that can be entered');
    await page.close();
  }
  console.log(failed ? `${failed} FAILED` : 'every house walked to the top');
  await browser.close();
})();
