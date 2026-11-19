// Builds every kind of building the building lab offers (`lab/buildings.html`) with its measures
// pushed about at random, out past the ends of their ranges, and brought back by the lab's own rules
// (`normalise` in `lab/buildingKinds.ts`), as a person dragging sliders and handles would. Reports a
// building that fails to build, has points that are not numbers, or is built nowhere near where it
// should stand, with the shape that did it. Run it after changing those rules or the builders:
//
//   npx tsx tools/buildingLab.ts          60 of each kind
//   npx tsx tools/buildingLab.ts 300      300 of each
import { Box3, Vector3 } from 'three';
import { buildItem, deal, Item, Kind, KIND_ORDER, normalise, Shape } from '../lab/buildingKinds';
import { Rng } from '../src/core/rng';
import { MeshBuilder } from '../src/render/geom/meshBuilder';

const count = Number(process.argv[2]) || 60;
let failed = 0;
const rng = new Rng('building lab check');
/** A number pushed somewhere between a little under the low end and a little over the high one. */
const push = (lo: number, hi: number) => rng.range(lo - (hi - lo) * 0.25, hi + (hi - lo) * 0.25);

function shake(kind: Kind, s: Shape): Shape {
  const t: Shape = JSON.parse(JSON.stringify(s));
  t.w = push(4, 50); t.d = push(5, 20); t.storeys = Math.round(push(1, 7)); t.bays = Math.round(push(1, 15));
  t.heights = Array.from({ length: 8 }, () => push(2, 6));
  if (rng.chance(0.2)) t.colour = [rng.range(0, 1), rng.range(0, 1), rng.range(0, 1)];
  if (kind === 'timber') { t.jetty = push(0, 0.6); t.gable = rng.chance(0.5); t.door = rng.pick([0.24, 0.5, 0.76]); t.burnt = rng.chance(0.2); }
  if (kind === 'classical') {
    t.portico = rng.chance(0.6);
    const width = push(5, 9), side = rng.pick([[-1], [1], [-1, 1], []] as (-1 | 1)[][]);
    t.wings = side.map((g) => ({ side: g, width, length: push(6, 18) }));
    // The town's variations, asked for whether they can be had or not.
    t.pediment = rng.chance(0.5) ? false : undefined;
    t.entrances = rng.chance(0.5) ? Array.from({ length: rng.int(1, 3) }, () => rng.int(0, 20)) : undefined;
    t.arch = rng.chance(0.4) ? { side: rng.pick([-1, 1] as const) } : undefined;
    t.brick = rng.pick([undefined, 'stucco', 'bare'] as const);
    t.towers = rng.chance(0.5) ? Array.from({ length: rng.int(1, 4) }, () => ({ corner: rng.pick(['front', 'wing', 'back'] as const), side: rng.pick([-1, 1] as const), size: push(3, 7), extra: Math.round(push(0, 4)) })) : undefined;
  }
  if (kind === 'wooden') {
    t.basement = push(0.4, 2); t.endDoor = rng.pick([-1, 1] as const); t.dormers = Math.round(push(0, 5));
    t.wings = rng.chance(0.4) ? [{ side: rng.pick([-1, 1] as const), width: push(5, 10), length: push(5, 14) }] : undefined;
  }
  if (kind === 'shack') t.shack = { roof: rng.pick(['boards', 'tin', 'turf'] as const), lean: rng.chance(0.5), stilts: push(0, 2.5) };
  const bw = t.brickwork;
  if (bw) {
    bw.gable = rng.pick(['stepped', 'piers', 'volute', 'plain'] as const);
    bw.steps = Math.round(push(0, 8)); bw.pitch = push(38, 66); bw.rendered = rng.chance(0.5); bw.glazed = rng.chance(0.5);
    bw.niches = rng.pick(['white', 'brick', 'none'] as const); bw.door = rng.pick([0.28, 0.5, 0.72]); bw.roof = rng.pick(['red', 'dark', 'copper'] as const);
    bw.clay = rng.pick(['red', 'buff'] as const);
    if (bw.church) {
      const c = bw.church;
      c.towers = rng.pick([1, 2] as const); c.side = push(6, 10); c.height = push(15, 40); c.spire = rng.pick(['needle', 'corners', 'saddle'] as const);
      c.spireHeight = push(0, 36); c.choir = rng.pick(['apse', 'flat'] as const); c.choirLength = push(4, 10); c.end = rng.pick([-1, 1] as const);
    }
  }
  return normalise(kind, t, rng.chance(0.5) ? 'w' : 'bays');
}

const t0 = performance.now();
for (const kind of KIND_ORDER) {
  let worst = 0, triangles = 0;
  for (let n = 0; n < count; n++) {
    // (The first is as dealt; the rest shaken, and every fifth pushed to the ends of everything at once.)
    const dealt = deal(kind, `check ${n}`);
    let shape = n ? shake(kind, dealt) : dealt;
    if (n % 5 === 4) {
      const lo = n % 10 === 4;
      shape = normalise(kind, { ...shape, w: lo ? 0 : 99, d: lo ? 0 : 99, storeys: lo ? 0 : 99, bays: lo ? 0 : 99, heights: shape.heights.map(() => (lo ? 0 : 99)) }, 'w');
    }
    const item: Item = { id: n, kind, seed: `s${n}`, x: 0, z: 0, turn: 0, scale: [1, 1, 1], inn: n % 3 === 0, shape };
    const meshes = new Map<string, MeshBuilder>();
    const began = performance.now();
    try {
      buildItem(item, 'greystone', (m) => { let x = meshes.get(m); if (!x) meshes.set(m, (x = new MeshBuilder())); return x; });
    } catch (e) {
      failed++;
      console.log(`${kind} ${n}: did not build: ${(e as Error).message}\n  ${JSON.stringify(shape)}`);
      continue;
    }
    worst = Math.max(worst, performance.now() - began);
    // Every point a number, and all of it within reach of where the building stands.
    const box = new Box3(), p = new Vector3();
    let bad = '';
    for (const [name, m] of meshes) {
      const g = m.build(), pos = g.getAttribute('position');
      triangles += (g.index?.count ?? 0) / 3;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        if (!Number.isFinite(p.x + p.y + p.z)) { bad = `${name} has a point that is not a number`; break; }
        box.expandByPoint(p);
      }
      if (bad) break;
    }
    const size = box.getSize(new Vector3());
    if (!bad && (box.isEmpty() || size.x > 150 || size.z > 150 || size.y > 90 || box.min.y < -3)) bad = `built out of bounds: ${box.min.toArray().map((v) => v.toFixed(1))} to ${box.max.toArray().map((v) => v.toFixed(1))}`;
    if (bad) { failed++; console.log(`${kind} ${n}: ${bad}\n  ${JSON.stringify(shape)}`); }
  }
  console.log(`${kind}: ${count} built, the slowest in ${worst.toFixed(0)} ms, ${Math.round(triangles / count).toLocaleString()} triangles on average`);
}
console.log(`${failed ? `${failed} failed` : 'All built'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
