/**
 * Builds the valley and its rock for a number of seeds, without a browser, and reports anything
 * wrong with what was carved: numbers that are not numbers, rock standing in the doorway of the
 * house, and how long the building took. Run it after any change to the rock or the ground.
 *
 *   npx tsx tools/land.ts [count] [prefix]
 *
 * `WORLD=w2` before it builds each house at a valley head of that world in turn (`?world=w2` in the
 * browser): the world is made first, half a minute, and each valley's tiles of 5 metres about it. With
 * `PLACE=coast` too, at its coastal towns instead (`?world=w2&place=coast`).
 */
import { generateSite } from '../src/core/generate';
import { meshSite, VALLEY_GROUND } from '../src/render/siteMesher';
import { worldLand } from '../src/core/worldLand';

const count = Number(process.argv[2] ?? 12), prefix = process.argv[3] ?? 'land';
// (`SHEET=0.8` before the command lays the valley's walked ground in cells of that size instead of 1.2 metres, as `?sheet=` does.)
if (process.env.SHEET) VALLEY_GROUND.sheet = Number(process.env.SHEET);
let failed = 0, slowest = 0;
const coast = process.env.PLACE === 'coast', inWorld = process.env.WORLD, heads = inWorld ? worldLand(inWorld).places.filter((q) => q.kind === (coast ? 'coast' : 'valley')) : [];
if (inWorld && !heads.length) { console.log(`world ${inWorld} has no ${coast ? 'coastal towns' : 'valley heads'}`); process.exit(1); }
for (let k = 0; k < count; k++) {
  const seed = `${prefix}${k}`;
  // (`TERRAIN=eroded` before the command builds valleys found in worn land, as `?terrain=eroded` does in the browser.)
  const head = inWorld ? heads[k % heads.length] : undefined, t1 = performance.now();
  const site = generateSite(seed, coast ? 'coast' : 'valley', head ? { world: { seed: inWorld!, n: head.n } } : process.env.TERRAIN === 'eroded' ? { terrain: 'eroded' } : process.env.TERRAIN === 'plain' ? { terrain: 'plain' } : {});
  const made = performance.now() - t1;
  const t0 = performance.now();
  const scene = meshSite(site);
  const ms = performance.now() - t0;
  slowest = Math.max(slowest, ms);
  const approach = site.places.find((p) => p.role === 'approach')!;
  const door = site.ways.find((w) => w.a === approach.id || w.b === approach.id);
  const problems: string[] = [];
  let rockTriangles = 0, groundTriangles = 0;
  for (const [set, where] of [[scene.meshes, 'site'], [scene.scenery?.meshes ?? new Map(), 'scenery']] as const) {
    for (const [key, mesh] of set) {
      if (!/\|(rock|turf|scree)$/.test(key)) continue;
      const g = mesh.build();
      const pos = g.getAttribute('position').array as Float32Array, nrm = g.getAttribute('normal').array as Float32Array;
      let bad = 0, blocking = 0;
      for (let i = 0; i < pos.length; i += 3) if (!Number.isFinite(pos[i] + pos[i + 1] + pos[i + 2] + nrm[i] + nrm[i + 1] + nrm[i + 2])) bad++;
      // The doorway: the width of the door, from knee height to head height, from a pace inside
      // the wall to a pace outside it. No triangle of ground may reach into that box.
      if (door) {
        const box = [door.at - door.halfWidth * 0.8, door.at + door.halfWidth * 0.8, approach.floor + 0.6, approach.floor + 1.7, approach.z0 - 1, approach.z0 + 1];
        const index = g.getIndex()!.array;
        for (let t = 0; t < index.length; t += 3) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (let v = 0; v < 3; v++) {
            const o = index[t + v] * 3;
            x0 = Math.min(x0, pos[o]); x1 = Math.max(x1, pos[o]); y0 = Math.min(y0, pos[o + 1]); y1 = Math.max(y1, pos[o + 1]); z0 = Math.min(z0, pos[o + 2]); z1 = Math.max(z1, pos[o + 2]);
          }
          if (x1 > box[0] && x0 < box[1] && y1 > box[2] && y0 < box[3] && z1 > box[4] && z0 < box[5]) blocking++;
        }
      }
      if (key.endsWith('rock') || key.endsWith('rockSheet')) rockTriangles += mesh.triangleCount;
      else groundTriangles += mesh.triangleCount;
      if (bad) problems.push(`${where} ${key}: ${bad} vertices that are not numbers`);
      if (blocking) problems.push(`${where} ${key}: ${blocking} triangles across the doorway`);
    }
  }
  if (problems.length) failed++;
  console.log(`${seed}${head ? ` at ${head.name} (${coast ? 'coastal town' : 'valley'} ${head.n} of ${inWorld}${site.valley?.terrain?.world ? '' : ', NOT FOUND THERE'}${site.valley?.sea !== undefined ? `; the shore ${(site.valley.mouth - site.places.find((p) => p.id === site.start)!.z1).toFixed(0)} m down the track, the sea ${site.valley.sea} m, ${site.buildings?.length ?? 0} buildings${site.valley.harbour ? `, a quay of ${Math.hypot(site.valley.harbour.quay.to[0] - site.valley.harbour.quay.from[0], site.valley.harbour.quay.to[1] - site.valley.harbour.quay.from[1]).toFixed(0)} m with ${site.valley.harbour.boats.filter((b) => b.afloat).length} boats riding and ${site.valley.harbour.boats.filter((b) => !b.afloat).length} drawn up` : ''}` : ''})` : ''}: ${site.setting.stone}, laid out in ${made.toFixed(0)} ms, built in ${ms.toFixed(0)} ms, ${rockTriangles.toLocaleString()} triangles of rock, ${groundTriangles.toLocaleString()} of turf and scree${problems.length ? ' | ' + problems.join('; ') : ''}`);
}
console.log(failed ? `${failed} of ${count} FAILED` : `all ${count} sound; slowest ${slowest.toFixed(0)} ms`);
process.exit(failed ? 1 : 0);
