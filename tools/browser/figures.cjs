// Drives the figure lab (lab/figures.html): the figures' paces, sitting on the bench and lying on a bedroll and getting up, climbing the
// ledges (and not the one too high), sent onto a ledge, up the stair and the ramp, a drop from the platform, creeping, and clips that
// carry the figure along. Reports each with what it should have come to, and keeps a picture of the most of them.
//   node tools/browser/figures.cjs <out folder>
// Needs the development server on port 5180 (`npm run figures`, or `npx vite --port 5180 --strictPort`), or PORT. The figures are
// stepped by the script at sixty steps a second while the page's own time stands still, so it does not matter how slowly software
// draws. With REAL_GPU=1 it opens a window and uses the machine's graphics card.
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
  const out = process.argv[2] ?? 'figures-out';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.REAL_GPU ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const faults = [];
  page.on('pageerror', (e) => faults.push(e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5180}/lab/figures.html${process.env.REAL_GPU ? '' : '?webgl'}`);
  await page.waitForFunction(() => window.figureLab && window.figureLab.ready, null, { timeout: 180000 });
  await page.evaluate(() => {
    const L = window.figureLab;
    L.pause(true);
    const V = (x, y, z) => L.figures[0].root.position.clone().set(x, y, z);
    const D = (x, z) => L.figures[0].want.clone().set(x, z);
    window.T = {
      V, D,
      /** Steps every figure `seconds` on, or until `until` says so; how long it took. */
      sim(seconds, until) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) { for (const f of L.figures) f.update(1 / 60); if (until && until()) return i / 60; } return seconds; },
      put(f, x, y, z, facing) { f.body.stand(V(x, y, z), 0); f.facing = facing; f.update(1 / 60); f.update(1 / 60); },
      look(tx, ty, tz, cx, cy, cz) { L.controls.target.set(tx, ty, tz); L.camera.position.set(cx, cy, cz); L.controls.update(); },
      at(f) { return f.body.position.toArray().map((v) => +v.toFixed(2)); },
      speed(f) { const m = f.body.motion; return +Math.hypot(m.x, m.z).toFixed(2); },
    };
  });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  let failed = 0;
  const check = (what, ok, said) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${said}`); };
  // (The view follows the chosen figure by how far it moved; it is put where wanted once the page has drawn a frame or two after.)
  const picture = async (name, look) => {
    await page.waitForTimeout(400);
    await page.evaluate(look);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}.png` });
  };

  for (const [pace, want] of [['walk', 1.3], ['run', 4.6], ['sprint', 7.0]]) {
    const s = await ev(([pace]) => { const f = figureLab.figures[0]; T.put(f, 0, 0, 22, Math.PI); f.drive(T.D(0, -1), pace); T.sim(2.5); const s = T.speed(f); f.drive(T.D(0, 0), 'walk'); T.sim(1.5); return s; }, [pace]);
    check(`${pace}`, Math.abs(s - want) < 0.05, `${s} m/s (pace ${want})`);
  }
  await ev(() => { const f = figureLab.figures[0]; figureLab.choose(f); T.put(f, 0, 0, 16, Math.PI); f.drive(T.D(0, -1), 'run'); T.sim(1.2); });
  await picture('run', () => { const p = figureLab.figures[0].root.position; T.look(p.x, 1, p.z, p.x + 4, 1.6, p.z + 0.5); });
  await ev(() => { const f = figureLab.figures[0]; f.drive(T.D(0, 0), 'walk'); T.sim(1.5); });

  const sit = await ev(() => { const L = figureLab, f = L.figures[0]; T.put(f, -4, 0, 8, Math.PI); L.takeSpot(f, L.stage.seats[0], 'walk'); const t = T.sim(20, () => f.state === 'seated'); T.sim(1.5); return { t, state: f.state }; });
  check('sits on the bench', sit.state === 'seated', `${sit.state} after ${sit.t.toFixed(1)} s`);
  const lie = await ev(() => { const L = figureLab, f = L.figures[1]; T.put(f, 4, 0, 8, Math.PI); L.takeSpot(f, L.stage.seats[2], 'walk'); const t = T.sim(20, () => f.state === 'asleep'); T.sim(0.5); return { t, state: f.state }; });
  check('lies down on a bedroll', lie.state === 'asleep', `${lie.state} after ${lie.t.toFixed(1)} s`);
  await picture('seated', () => T.look(-6.2, 0.7, 5.1, -4.4, 1.7, 7.6));
  await picture('asleep', () => T.look(5.5, 0.3, 4.5, 3.6, 2.0, 6.6));
  const up = await ev(() => { const L = figureLab; L.figures[0].standUp(); L.figures[1].standUp(); T.sim(3); return [L.figures[0].state, L.figures[1].state]; });
  check('both get up', up[0] === 'ground' && up[1] === 'ground', up.join(', '));

  for (const [i, h] of [[1, 1.0], [2, 1.25], [3, 1.6]]) {
    const r = await ev(([x]) => { const f = figureLab.figures[0]; T.put(f, x, 0, -1.0, Math.PI); f.jump(); const first = f.state; T.sim(3, () => f.state === 'ground' && f.body.grounded); T.sim(0.5); return { first, at: T.at(f) }; }, [-2.2 + i * 1.6]);
    if (h < 1.5) check(`climbs the ledge of ${h}`, r.first === 'climb' && Math.abs(r.at[1] - h) < 0.03 && r.at[2] < -2.2, `${r.first}, ends at ${r.at.join(', ')}`);
    else check(`does not climb the ledge of ${h}`, r.first === 'air' && r.at[1] < 0.05, `${r.first}, ends at ${r.at.join(', ')}`);
  }
  await ev(() => { const f = figureLab.figures[0]; figureLab.choose(f); T.put(f, -0.6, 0, -0.9, Math.PI); f.jump(); T.sim(0.22); });
  await picture('climb', () => T.look(-0.6, 1.0, -1.9, 2.6, 1.9, -0.2));
  await ev(() => T.sim(2));

  const sent = await ev(() => { const f = figureLab.figures[0]; T.put(f, -0.6, 0, 2, Math.PI); f.goTo(T.V(-0.6, 1, -3.5), 'run'); const t = T.sim(10, () => !f.busy && f.state === 'ground'); T.sim(0.3); return { t, at: T.at(f) }; });
  check('sent onto the ledge of 1.0, climbs it', Math.abs(sent.at[1] - 1) < 0.03, `at ${sent.at.join(', ')} after ${sent.t.toFixed(1)} s`);
  const stair = await ev(() => { const f = figureLab.figures[0]; T.put(f, -8, 0, 2.5, Math.PI); f.goTo(T.V(-8, 1.02, -3.5), 'walk'); const t = T.sim(15, () => !f.busy); return { t, at: T.at(f) }; });
  check('up the stair', Math.abs(stair.at[1] - 1.02) < 0.03, `at ${stair.at.join(', ')} after ${stair.t.toFixed(1)} s`);
  const ramp = await ev(() => { const f = figureLab.figures[0]; T.put(f, 6.2, 0, 1, Math.PI); f.goTo(T.V(6.2, 1.5, -7), 'run'); const t = T.sim(15, () => !f.busy); return { t, at: T.at(f) }; });
  check('up the ramp', Math.abs(ramp.at[1] - 1.5) < 0.03, `at ${ramp.at.join(', ')} after ${ramp.t.toFixed(1)} s`);
  const drop = await ev(() => { const f = figureLab.figures[0]; f.goTo(T.V(6.2, 0, -12), 'run'); let hard = false; T.sim(4, () => (hard = f.doing === 'landing hard')); return { hard, at: T.at(f) }; });
  check('drops off the platform and lands hard', drop.hard && drop.at[1] < 0.05, `at ${drop.at.join(', ')}`);
  await picture('landing', () => { T.sim(0.1); const p = figureLab.figures[0].root.position; T.look(p.x, 0.6, p.z, p.x + 3.2, 1.6, p.z + 2.0); });
  await ev(() => T.sim(3));

  const creep = await ev(() => { const f = figureLab.figures[0]; T.put(f, 0, 0, 12, Math.PI); f.toggleCrouch(); f.drive(T.D(0, -1), 'run'); T.sim(2); const s = T.speed(f); f.drive(T.D(0, 0), 'walk'); f.toggleCrouch(); T.sim(1); return s; });
  check('creeps', Math.abs(creep - 0.9) < 0.05, `${creep} m/s`);
  for (const [clip, far] of [['Roll_RM', 4.99], ['Sword_Regular_Combo', 2.35], ['Interact', 0]]) {
    const r = await ev(([clip]) => { const f = figureLab.figures[1]; T.put(f, 2, 0, 12, Math.PI); f.play(clip); T.sim(3.5); return { went: +(12 - f.body.position.z).toFixed(2), state: f.state }; }, [clip]);
    check(`plays ${clip}`, Math.abs(r.went - far) < 0.2 && r.state === 'ground', `went ${r.went} m (its clip ${far}), then ${r.state}`);
  }
  const death = await ev(() => { const f = figureLab.figures[1]; f.play('Death01'); T.sim(3); const lies = f.state; f.drive(T.D(0, -1), 'walk'); T.sim(1); return [lies, f.state]; });
  check('falls and stays down until moved', death[0] === 'act' && death[1] === 'ground', death.join(' then '));

  if (faults.length) { failed++; console.log(`FAIL errors in the page:\n  ${faults.join('\n  ')}`); }
  console.log(failed ? `${failed} failed` : 'all passed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
