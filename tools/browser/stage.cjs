// Pictures of buildings of brick (`src/core/brick.ts`) on a stage of their own, drawn by the game itself: its materials,
// sky, sun and air. A valley is loaded once, everything of it is put out of sight (land, rock, trees, far hills), a plain
// ground is laid, and the buildings asked for are dealt and built on it, row by row, and photographed from the poses given.
//
//   node tools/browser/stage.cjs <job.json>       one job, then done
//   node tools/browser/stage.cjs <folder>         every job put into the folder, as it comes, until stopped; each is renamed
//                                                 `.done` when it has been photographed (the valley takes minutes to load, a job seconds)
//
// A job:
//   { "out": "pictures/row", "faces": "e", "plain": true,
//     "rows": [{ "z": 0, "stone": "limestone", "houses": [{ "seed": "h1", "kind": "gabled", "set": { "gable": "stepped" } }] }],
//     "poses": [[21, 2, 13, 1.57, 0.3]] }
// A row is a street front of houses side by side along z from `z`, of the brick of the country of `stone`; each house is dealt
// from its `seed` as the town deals one (`kind` is `gabled`, `eaves`, `store` or `church`; `room` for a church), and `set` and `b`
// overwrite what was dealt, in `brickwork` and in the building. A house with `"style": "canal"` is a canal house instead
// (`src/core/canal.ts`), dealt with whatever `want` fixes of it (`{ "gable": "bell", "bays": 3, "ornament": 2 }`, as the building
// lab's address does); `set` then overwrites its `canalwork`. A pose is x, y, z, yaw and pitch, measured from the stage's first
// front: a yaw of 1.57 looks along -x, at fronts facing `e`. Without `plain` the valley is left as it is, and a paving is laid.
//
// Against a development server with hot reloading off, so that saving a file does not reload the page while it works: for one,
// `vite --port 5174` with a config of `{ ...base, server: { hmr: false } }`. `PORT` (5174 by default), `SEED` (the valley loaded),
// `HOUR`, and `W` and `H` (the size of the pictures). With REAL_GPU=1 a window and the machine's own graphics card.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const target = process.argv[2], folder = fs.statSync(target).isDirectory();
  const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 400)));
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT || 5174}/?seed=${process.env.SEED || 'w3'}&nobake=1&dpr=1&nointro&nogui&tex=${process.env.TEX || 512}&hour=${process.env.HOUR || 'morning'}&cloud=0.2`);
  await page.waitForFunction(() => typeof window.__capture === 'function' && (window.__frames ?? 0) > 1, null, { timeout: 1800000, polling: 2000 });
  // (The program's own loop is held, so that the page draws only when a picture is asked for: in a software renderer a frame takes seconds.)
  await page.evaluate(() => window.__film.hold(true));
  console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const run = async (file) => {
    const spec = JSON.parse(fs.readFileSync(file, 'utf8')), out = path.resolve(path.dirname(file), spec.out || 'stage');
    fs.mkdirSync(out, { recursive: true });
    const info = await page.evaluate(async (spec) => {
      // (The builders are fetched afresh for every job, so that what was saved since is what is built.)
      const t = Date.now(), BR = await import(`/src/render/brick.ts?t=${t}`), K = await import(`/src/core/brick.ts?t=${t}`);
      const CR = await import(`/src/render/canal.ts?t=${t}`), CK = await import(`/src/core/canal.ts?t=${t}`);
      const R = await import('/src/core/rng.ts'), MB = await import('/src/render/geom/meshBuilder.ts'), SB = await import('/src/render/buildings.ts');
      const d = window.__dbg, MeshC = d.scene.children.find((c) => c.isMesh).constructor;
      for (const m of window.__stage ?? []) { d.scene.remove(m); m.geometry.dispose(); }
      window.__stage = [];
      // Out of sight, and on a layer the camera does not draw (what grows is shown and hidden by its own culling every frame); casting no
      // shadow. The sky's dome stays.
      if (spec.plain && !window.__hidden) {
        window.__hidden = [];
        d.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) && !(o.scale.x >= 1000)) { o.visible = false; o.castShadow = false; o.layers.set(31); window.__hidden.push(o); } });
      }
      const meshes = new Map(), mesh = (m) => { let x = meshes.get(m); if (!x) meshes.set(m, (x = new MB.MeshBuilder())); return x; };
      const sp = d.desc.spawn.position, X = spec.x ?? sp.x, Z0 = spec.z ?? sp.z;
      let y = -1e9;
      for (let dz = -6; dz < 60; dz += 2) for (let dx = -18; dx < 18; dx += 2) y = Math.max(y, d.groundAt(X + dx, Z0 + dz) ?? -1e9);
      y += 0.05;
      const faces = spec.faces ?? 'e', turn = faces === 'w' ? 1 : -1, placed = [];
      let zEnd = Z0;
      for (const row of spec.rows ?? [{ houses: spec.houses }]) {
        const country = K.brickCountry(row.stone ?? 'greystone');
        let z = Z0 + (row.z ?? 0);
        for (const h of row.houses) {
          const rng = new R.Rng(h.seed), canal = h.style === 'canal';
          const deal = canal ? CK.dealCanalHouse(rng, { deep: h.deep ?? 16, want: h.want ?? {}, country }) : h.kind === 'church' ? K.dealChurch(rng, h.room ?? 70, country) : K.dealBrickHouse(rng, h.deep ?? 14, h.kind, country);
          if (!deal) { placed.push({ seed: h.seed, none: true }); continue; }
          Object.assign(canal ? deal.canalwork : deal.brickwork, h.set ?? {});
          Object.assign(deal, h.b ?? {});
          (canal ? CR.buildCanal : BR.buildBrick)({ ...deal, x: X + (row.x ?? 0) + turn * (deal.d / 2), z: z + deal.w / 2, faces }, y, mesh, rng.fork('build'), [0.7, 0.68, 0.64]);
          const work = canal ? deal.canalwork : deal.brickwork;
          placed.push({ seed: h.seed, kind: work.kind, gable: work.gable, clay: work.clay, w: deal.w, d: deal.d });
          z += deal.w + (h.gap ?? 0);
          zEnd = Math.max(zEnd, z);
        }
      }
      const sol = SB.solids(mesh);
      if (spec.plain) sol.block('plaster', { x: X - 260, y: y - 0.3, z: Z0 - 260 }, { x: X + 260, y, z: Z0 + 260 }, [0.2, 0.2, 0.19]);
      else sol.block('stone', { x: X - 20, y: y - 0.3, z: Z0 - 10 }, { x: X + 30, y, z: zEnd + 10 }, [0.5, 0.48, 0.45]);
      // Lit as scenery is: all the sky that can be seen, and a fixed share of sun.
      const L = [0, 1, 2].map((c) => 0.55 * [0.16, 0.3, 0.62][c] + 0.45 * [0.62, 0.7, 0.8][c]);
      for (const [name, builder] of meshes) {
        const g = builder.build(), sh = [g.getAttribute('aSHr'), g.getAttribute('aSHg'), g.getAttribute('aSHb')], bk = g.getAttribute('aBake');
        for (let i = 0; i < builder.vertexCount; i++) {
          const open = 0.3 + 0.7 * builder.openAt(i);
          for (let c = 0; c < 3; c++) sh[c].setXYZW(i, (Math.PI / 2) * L[c] * open, 0, (Math.PI / 2) * L[c] * 0.8 * open, 0);
          bk.setXY(i, open, 0.6);
        }
        const m = new MeshC(g, d.materials[name] ?? d.materials.stone);
        m.castShadow = name !== 'glass' && name !== 'window';
        m.receiveShadow = true;
        d.scene.add(m);
        window.__stage.push(m);
      }
      // (The sun's shadow is drawn once and kept: it is asked for again, so that the stage casts one and what was put out of sight none.)
      d.sun.shadow.needsUpdate = true;
      return { X, Z0, y, placed };
    }, spec);
    for (const [i, p] of (spec.poses ?? []).entries()) {
      const url = await page.evaluate((p) => window.__capture(p), [info.X + p[0], info.y + p[1], info.Z0 + p[2], p[3], p[4] ?? 0]);
      fs.writeFileSync(path.join(out, `${i}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(path.basename(file), '->', out, JSON.stringify(info.placed.map((p) => p.none ? `${p.seed}: no room` : `${p.kind} ${p.gable} ${p.clay}`)));
  };
  if (!folder) { await run(path.resolve(target)); await browser.close(); return; }
  for (;;) {
    const next = fs.readdirSync(target).filter((f) => f.endsWith('.json')).sort()[0];
    if (!next) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    const file = path.join(target, next);
    try { await run(file); } catch (e) { console.log(next, 'failed:', e.message.slice(0, 400)); }
    fs.renameSync(file, `${file}.done`);
  }
})();
