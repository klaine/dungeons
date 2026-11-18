/**
 * Generates many sites and reports on them. Usage: npx tsx tools/sites.ts [count] [valley|island|mountain]
 * (With a kind of place named, only that kind: the whole takes some twenty minutes, now that land is made before it is laid out.)
 * `SETTLE=town` (or `village`, `hamlet`, `manor`, `none`) before it gives every valley that settlement where there is room.
 */
import { generateSite, MakeOptions } from '../src/core/generate';
import { footprintOf } from '../src/core/building';
import { solve } from '../src/core/mission';
import { loopCount } from '../src/core/site';
import { inland, landAt } from '../src/core/island';
import { inside } from '../src/core/mountain';

const count = Number(process.argv[2] ?? 200), only = process.argv[3];
const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
let failures = 0;
for (let n = 0; n < (only && only !== 'valley' ? 0 : count); n++) {
  const seed = `check-${n}`;
  try {
    const site = generateSite(seed, 'valley', { settlement: process.env.SETTLE as MakeOptions['settlement'] });
    bump(`settlement=${site.settlement ?? 'none'}`);
    // Buildings stand clear of the track and of one another: a street's houses may touch, but none stands in another.
    const ground = (site.buildings ?? []).map((b) => footprintOf(b).map((r) => {
      const t = b.faces === 'w' ? 1 : -1, xs = [b.x - (t * b.d) / 2 + t * r.v0, b.x - (t * b.d) / 2 + t * r.v1], zs = [b.z + t * r.u0, b.z + t * r.u1];
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    }));
    for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) for (const a of ground[i]) for (const c of ground[j]) {
      if (Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 0.05 && Math.min(a.z1, c.z1) - Math.max(a.z0, c.z0) > 0.05) throw new Error(`buildings ${i} and ${j} stand in one another`);
    }
    const track = site.track ?? [];
    for (const [i, rects] of ground.entries()) for (const r of rects) for (let k = 0; k < track.length - 1; k++) {
      const [ax, az] = track[k], [bx, bz] = track[k + 1];
      for (let q = 0; q <= 10; q++) {
        const x = ax + ((bx - ax) * q) / 10, z = az + ((bz - az) * q) / 10;
        if (x > r.x0 - 1.4 && x < r.x1 + 1.4 && z > r.z0 - 1.4 && z < r.z1 + 1.4) throw new Error(`building ${i} stands on the track`);
      }
    }
    if (site.settlement === 'town') bump(`town houses=${Math.min(14, (site.buildings ?? []).filter((b) => b.brickwork?.kind !== 'church').length)}${(site.buildings ?? []).some((b) => b.brickwork?.kind === 'church') ? ' +church' : ''}`);
    const rooms = site.places.filter((p) => p.roof !== 'sky').length;
    bump(`rooms=${rooms}`);
    bump(`loops=${loopCount(site)}`);
    bump(`court=${site.places.some((p) => p.role === 'court')}`);
    bump(`plan=${/rooms (.*?)(?: with| and|;)/.exec(site.title)?.[1] ?? '?'}`);
    bump(`goalDepth=${site.places[site.goal].depth}`);
    const solution = solve(site);
    if (!solution.ok) throw new Error('cannot be completed');
    bump(`keys=${site.items.length}`);
    bump(`barred=${site.ways.some((w) => w.door?.barredFrom !== undefined)}`);
    bump(`gate=${site.levers.length > 0}`);
    bump(`secret=${site.secret >= 0}`);
    bump(`storeys=${site.places.filter((p) => p.level).map((p) => (p.level! > 0 ? 'up' : 'down')).sort().join('+') || 'none'}`);
    bump(`tower=${(site.towers ?? []).length > 0}`);
    bump(`buildings=${site.buildings ? `${site.buildings[0].style} x${site.buildings.length}` : 'none'}`);
    bump(`hall=${(site.grottoes ?? []).map((q) => (q.hall?.great ? 'great' : q.hall ? 'plain' : 'grotto')).join('+') || 'none'}`);
    bump(`moves/direct=${(solution.moves.length / solution.direct).toFixed(0)}x`);
    if (n < 4) console.log('    ', solution.moves.map((m) => [...m.events, `to ${site.places[m.to].name}`].join(', ')).join(' > '));
    bump(`dark=${site.places.filter((p) => p.light === 'dark').length}`);
    for (const w of site.ways) {
      if (w.kind !== 'window' && site.places[w.a].light === 'dark' && site.places[w.b].light === 'dark') throw new Error('two dark rooms in a row');
    }
    for (const w of site.ways) {
      if (w.kind === 'window' || w.kind === 'stair') continue;
      const d = Math.abs(site.places[w.a].floor - site.places[w.b].floor);
      // A built doorway takes a step or three; a cleft in a cave is a climb, but one that can be made.
      if (d > (w.natural ? 2.35 : 0.52)) throw new Error(`${w.natural ? 'cleft' : 'doorway'} too steep: ${d}`);
    }
    if (n < 4) console.log(seed, '-', site.title);
  } catch (e) {
    failures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
if (!only || only === 'valley') console.log(`${count} sites, ${failures} failures`);
for (const k of [...tally.keys()].sort()) console.log(' ', k.padEnd(14), tally.get(k));

// Islands: the same houses on islands in the sea. Each must be completable, and what is built on
// it must stand on the land, well in from the cliffs, with the track on land all the way to the jetty.
const isles = new Map<string, number>();
let isleFailures = 0;
for (let n = 0; n < (only && only !== 'island' ? 0 : Math.ceil(count / 4)); n++) {
  const seed = `isle-check-${n}`;
  try {
    const site = generateSite(seed, 'island'), o = site.island!;
    if (!solve(site).ok) throw new Error('cannot be completed');
    const tally2 = (k: string) => isles.set(k, (isles.get(k) ?? 0) + 1);
    for (const q of o.cottages) if (inland(o, q.x, q.z) < Math.max(q.w, q.d) / 2 + 3) throw new Error('a cottage at the cliff edge');
    if (o.lighthouse && inland(o, o.lighthouse.x, o.lighthouse.z) < 8) throw new Error('the lighthouse at the cliff edge');
    // The way over the land stays on it, and climbs no more steeply than a path can; the stair, if there is one, climbs at one in two and has no gaps.
    const way = o.way ?? [];
    for (const [x, z] of way) if (Math.hypot(x - way[way.length - 1][0], z - way[way.length - 1][1]) > 12 && inland(o, x, z) < 3) throw new Error(`the way off the land at ${x}, ${z}`);
    let steepest = 0;
    for (let k = 1; k < way.length; k++) steepest = Math.max(steepest, Math.abs(way[k][2] - way[k - 1][2]) / (Math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]) || 1));
    if (steepest > 0.42) throw new Error(`the way climbs at ${steepest.toFixed(2)}`);
    for (let k = 1; k < way.length - 1; k++) {
      const ux = way[k][0] - way[k - 1][0], uz = way[k][1] - way[k - 1][1], vx = way[k + 1][0] - way[k][0], vz = way[k + 1][1] - way[k][1], l = Math.hypot(ux, uz) * Math.hypot(vx, vz);
      if (l > 0 && (ux * vx + uz * vz) / l < -0.3) throw new Error(`the way turns back on itself at ${way[k][0]}, ${way[k][1]}`);
    }
    const stair = o.stair ?? [];
    for (let k = 1; k < stair.length; k++) {
      const run = Math.hypot(stair[k][0] - stair[k - 1][0], stair[k][1] - stair[k - 1][1]), rise = stair[k][2] - stair[k - 1][2];
      if (run > 4.5 || rise > run * 0.62 + 0.15) throw new Error(`the stair breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
    }
    // (Whether the island was found in a sea of them, as islands are made now, or drawn, as they are where none is found.)
    tally2(`found=${!!o.terrain}`);
    tally2(`landing=${o.landing}`);
    tally2(`peaks=${(o.peaks ?? []).length}`);
    tally2(`cottages=${o.cottages.length}`);
    tally2(`lighthouse=${!!o.lighthouse}`);
    tally2(`castle=${!!o.castle}`);
    tally2(`mansion=${o.mansion ? `${o.mansion.building.bays} bays x${o.mansion.building.storeys}` : 'none'}`);
    tally2(`cave=${!!o.seaCave}`);
    // The strand of shingle to the sea cave lies at its own level all the way, not buried under the cliff or the stair nor left in
    // the water, and climbs gently. (Its last few metres are the cave's own floor, cut into the cliff by the builder.)
    if (o.strand && o.seaCave) {
      const F = site.places.find((p) => p.role === 'approach')!.floor, l = o.strand.filter(([x, z]) => Math.hypot(x - o.seaCave!.x, z - o.seaCave!.z) > 6.5);
      for (let k = 0; k < l.length; k++) {
        const [x, z, y] = l[k], g = landAt(o, F, x, z);
        if (g > y + 0.6 || g < y - 0.05) throw new Error(`the strand stands ${(g - y).toFixed(1)} off its level at ${x}, ${z}`);
        if (k && Math.abs(g - landAt(o, F, l[k - 1][0], l[k - 1][1])) > Math.hypot(x - l[k - 1][0], z - l[k - 1][1]) * 0.45 + 0.05) throw new Error(`the strand climbs too steeply at ${x}, ${z}`);
      }
    }
    tally2(`stacks=${o.stacks.length}`);
    // The caverns, if there are any: their passages climb no more steeply than the way does, without a break, from the sea cave to
    // the cavern and from it to the open ground, which they come out on.
    if (o.caverns) {
      const cv = o.caverns;
      for (const [name, l] of [['passage in', cv.lower], ['passage out', cv.upper]] as const) {
        for (let k = 1; k < l.length; k++) {
          const run = Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]), rise = Math.abs(l[k][2] - l[k - 1][2]);
          if (run > 3 || rise > run * 0.45 + 0.05) throw new Error(`the caverns' ${name} breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
        }
      }
      if (Math.abs(cv.lower[cv.lower.length - 1][2] - cv.hall.y) > 0.2 || Math.abs(cv.upper[0][2] - cv.hall.y) > 0.2) throw new Error("the caverns' passages do not meet the cavern's floor");
      tally2('caverns=true');
    } else tally2('caverns=false');
  } catch (e) {
    isleFailures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
if (!only || only === 'island') console.log(`${Math.ceil(count / 4)} islands, ${isleFailures} failures`);
for (const k of [...isles.keys()].sort()) console.log(' ', k.padEnd(14), isles.get(k));

// Mountain tops: the same houses as hospices above the cloud. Each must be completable; the way and
// the climb stay on the top and climb no more steeply than a path can; the summit's cairn, the shelter
// and the arrival stand on the top; and the arrival is in the cloud. (Their land worn, as it is by default; and a few with the
// plain shape alone, `?terrain=plain`, held to the same.)
const peaks = new Map<string, number>();
let peakFailures = 0;
const wornPeaks = Math.ceil(count / 4), plainPeaks = Math.ceil(count / 20);
for (let n = 0; n < (only && only !== 'mountain' ? 0 : plainPeaks + wornPeaks); n++) {
  const worn = n < wornPeaks, seed = worn ? `peak-check-${n}` : `plain-check-${n - wornPeaks}`;
  try {
    const site = generateSite(seed, 'mountain', { terrain: worn ? 'eroded' : 'plain' }), m = site.mountain!;
    if (worn && !m.terrain) throw new Error('its land is not worn');
    if (!solve(site).ok) throw new Error('cannot be completed');
    const tally3 = (k: string) => peaks.set(worn ? k : `plain ${k}`, (peaks.get(worn ? k : `plain ${k}`) ?? 0) + 1);
    for (const [name, line, most] of [['way', m.way ?? [], 0.56], ['climb', m.climb ?? [], 0.74]] as const) {
      if (line.length < 2) throw new Error(`no ${name}`);
      for (const [x, z] of line) if (inside(m, x, z) < 3) throw new Error(`the ${name} off the top at ${x}, ${z}`);
      let steepest = 0;
      for (let k = 1; k < line.length; k++) steepest = Math.max(steepest, Math.abs(line[k][2] - line[k - 1][2]) / (Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) || 1));
      if (steepest > most) throw new Error(`the ${name} climbs at ${steepest.toFixed(2)}`);
    }
    if (m.cairn && inside(m, m.cairn.x, m.cairn.z) < 4) throw new Error('the cairn at the edge');
    // The hall under the top, if there is one: its stair no steeper than a stair cut in rock can be walked, and it reaches the hall.
    if (m.hall) {
      const st = m.hall.stair;
      for (let k = 1; k < st.length; k++) {
        const slope = Math.abs(st[k][2] - st[k - 1][2]) / (Math.hypot(st[k][0] - st[k - 1][0], st[k][1] - st[k - 1][1]) || 1);
        if (slope > 0.55) throw new Error(`the hall's stair climbs at ${slope.toFixed(2)}`);
      }
      const last = st[st.length - 1];
      if (Math.hypot(last[0] - m.hall.in[0], last[1] - m.hall.in[1]) > 0.5 || Math.abs(last[2] - m.hall.floor) > 0.2) throw new Error("the hall's stair does not come to the hall");
      tally3('hall=true');
    } else tally3('hall=false');
    const cl = m.climb ?? [];
    if (m.cairn && cl.some(([x, z], k) => k < cl.length - 10 && Math.hypot(x - m.cairn!.x, z - m.cairn!.z) < 15)) throw new Error('the climb crosses the summit before it reaches it');
    if (m.shelter && inside(m, m.shelter.x, m.shelter.z) < 5) throw new Error('the shelter at the edge');
    // The gallery way, if there is one: no steeper anywhere than a stair cut in rock; it starts on the way and ends on the climb;
    // its tunnels have rock over them and its ledges do not stand out in the air beyond the face.
    const g = m.gallery;
    if (g) {
      const first = g.line[0], last = g.line[g.line.length - 1], top = cl[g.joins];
      if (!m.way!.some(([x, z]) => Math.hypot(x - first[0], z - first[1]) < 0.5)) throw new Error('the gallery way does not start on the way');
      if (Math.hypot(last[0] - top[0], last[1] - top[1]) > 0.5 || Math.abs(last[2] - top[2]) > 0.3) throw new Error('the gallery way does not end on the climb');
      for (let k = 1; k < g.line.length; k++) {
        const run = Math.hypot(g.line[k][0] - g.line[k - 1][0], g.line[k][1] - g.line[k - 1][1]), rise = Math.abs(g.line[k][2] - g.line[k - 1][2]);
        if (run > 6 || rise > run * 0.6 + 0.15) throw new Error(`the gallery way breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
      }
      for (const [x, z] of g.line) if (inside(m, x, z) < -9) throw new Error(`the gallery way out in the air at ${x}, ${z}`);
      const tunnelled = g.under.reduce((sum, [a, b]) => sum + b - a + 1, 0) / g.line.length;
      tally3(`gallery tunnels=${g.under.length}`);
      tally3(`gallery under=${Math.round(tunnelled * 10) * 10}%`);
    }
    tally3(`gallery=${!!g}`);
    // The scramble, if there is one: it leaves the climb and comes out by the cairn; on the top all the way; no steeper than a stair.
    const sc = m.scramble;
    if (sc) {
      const first = sc.line[0], last = sc.line[sc.line.length - 1], from = cl[sc.branch];
      if (Math.hypot(first[0] - from[0], first[1] - from[1]) > 0.5) throw new Error('the scramble does not leave from the climb');
      if (m.cairn && Math.hypot(last[0] - m.cairn.x, last[1] - m.cairn.z) > 4.5) throw new Error('the scramble does not come out by the cairn');
      for (const [x, z] of sc.line) if (inside(m, x, z) < 3) throw new Error(`the scramble off the top at ${x}, ${z}`);
      for (let k = 1; k < sc.line.length; k++) {
        const run = Math.hypot(sc.line[k][0] - sc.line[k - 1][0], sc.line[k][1] - sc.line[k - 1][1]), rise = Math.abs(sc.line[k][2] - sc.line[k - 1][2]);
        if (run > 4 || rise > run * 0.66 + 0.12) throw new Error(`the scramble breaks at its point ${k}: ${run.toFixed(1)} along, ${rise.toFixed(1)} up`);
      }
    }
    tally3(`routes=${1 + (g ? 1 : 0) + (sc ? 1 : 0)}`);
    const arrive = m.way![m.way!.length - 1];
    if (arrive[2] + 1.7 > m.deck) throw new Error(`the arrival is above the cloud (${arrive[2]} against ${m.deck})`);
    // The way up the ridge is never ruled straight, and it goes downhill somewhere on the way up.
    {
      const w = m.way!, a = w[Math.round(w.length * 0.25)], b = w[w.length - 1];
      let off = 0, down = 0;
      for (let k = Math.round(w.length * 0.25); k < w.length; k++) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; off = Math.max(off, Math.abs((w[k][0] - a[0]) * (b[1] - a[1]) - (w[k][1] - a[1]) * (b[0] - a[0])) / l); }
      for (let k = w.length - 1; k > 0; k--) down += Math.max(0, w[k][2] - w[k - 1][2]);
      if (off < 6) throw new Error(`the way down the ridge is nearly straight (${off.toFixed(1)} m out of line)`);
      tally3(`ridge downhill=${Math.round(down / 5) * 5}m`);
    }
    tally3(`season=${site.setting.season}`);
    tally3(`peaks=${m.peaks.length}`);
    tally3(`shelter=${!!m.shelter}`);
    tally3(`summit=${Math.round((m.cairn?.y ?? 0) / 10) * 10}`);
  } catch (e) {
    peakFailures++;
    console.log(seed, 'FAILED', (e as Error).message);
  }
}
if (!only || only === 'mountain') console.log(`${wornPeaks} mountain tops and ${plainPeaks} plain, ${peakFailures} failures`);
for (const k of [...peaks.keys()].sort()) console.log(' ', k.padEnd(14), peaks.get(k));
if (failures || isleFailures || peakFailures) process.exitCode = 1;
