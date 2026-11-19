/**
 * Builds the town, its land, rock and buildings, for a number of seeds, without a browser, and reports anything
 * wrong with what was carved: numbers that are not numbers, rock standing in the doorway of the
 * house, anything solid the town makes standing in any doorway of the house, inside it or out, and
 * how long the building took. Run it after any change to the rock or the ground.
 *
 *   npx tsx tools/town.ts [count] [prefix]
 */
import { generateSite } from '../src/core/generate';
import { meshSite } from '../src/render/siteMesher';

const count = Number(process.argv[2] ?? 12), prefix = process.argv[3] ?? 'town';
let failed = 0, slowest = 0;
for (let k = 0; k < count; k++) {
  const seed = `${prefix}${k}`;
  const site = generateSite(seed, 'town');
  const t0 = performance.now();
  const scene = meshSite(site);
  const ms = performance.now() - t0;
  slowest = Math.max(slowest, ms);
  const approach = site.places.find((p) => p.role === 'approach')!;
  const door = site.ways.find((w) => w.a === approach.id || w.b === approach.id);
  const problems: string[] = [];
  let rockTriangles = 0;
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
      if (bad) problems.push(`${where} ${key}: ${bad} vertices that are not numbers`);
      if (blocking) problems.push(`${where} ${key}: ${blocking} triangles across the doorway`);
    }
  }
  // Every doorway of the house, inside it as well as the front door: the width of the way, from just over the highest step a
  // walker takes on its lower side to head height on its higher, from a pace inside the wall to a pace beyond it (further where
  // a cleft climbs between chambers on different levels). Nothing solid the town makes may stand in that box: what the
  // forecourt's builder lays, and everything about the house but what stops nobody. The house's own stone is not asked about, since a raised sill or a cleft's rising floor belongs
  // there. (The garden behind the house was once laid through its rooms, and its hedges stood across the doorways.)
  const solids: [string, Float32Array, ArrayLike<number>][] = [];
  for (const [set, where] of [[scene.meshes, 'site'], [scene.scenery?.meshes ?? new Map(), 'scenery']] as const) {
    for (const [key, mesh] of set) {
      if (where === 'site' ? !key.startsWith(`p${approach.id}|`) : key.startsWith('soft|')) continue;
      const g = mesh.build();
      solids.push([`${where} ${key}`, g.getAttribute('position').array as Float32Array, g.getIndex()!.array]);
    }
  }
  for (const w of site.ways) {
    if (w.kind === 'window' || w.kind === 'stair') continue;
    const a = site.places[w.a], b = site.places[w.b], alongX = w.side === 'n' || w.side === 's', out = w.side === 'n' || w.side === 'w' ? -1 : 1;
    const wall = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
    const climb = w.natural && Math.abs(a.floor - b.floor) > 0.6 ? Math.min(3.4, 1.4 + Math.abs(a.floor - b.floor) * 0.9) : 0;
    const t0 = wall - out * (1 + (a.floor > b.floor ? climb : 0)), t1 = wall + out * (site.wallThickness + 1 + (b.floor > a.floor ? climb : 0));
    const across = [w.at - w.halfWidth * 0.8, w.at + w.halfWidth * 0.8], through = [Math.min(t0, t1), Math.max(t0, t1)];
    const [x0, x1] = alongX ? across : through, [z0, z1] = alongX ? through : across;
    const y0 = Math.min(a.floor, b.floor) + 0.4, y1 = Math.max(a.floor, b.floor) + 1.7;
    for (const [name, pos, index] of solids) {
      let blocking = 0;
      for (let t = 0; t < index.length; t += 3) {
        let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, lz = Infinity, hz = -Infinity;
        for (let v = 0; v < 3; v++) {
          const o = index[t + v] * 3;
          lx = Math.min(lx, pos[o]); hx = Math.max(hx, pos[o]); ly = Math.min(ly, pos[o + 1]); hy = Math.max(hy, pos[o + 1]); lz = Math.min(lz, pos[o + 2]); hz = Math.max(hz, pos[o + 2]);
        }
        if (hx > x0 && lx < x1 && hy > y0 && ly < y1 && hz > z0 && lz < z1) blocking++;
      }
      if (blocking) problems.push(`${name}: ${blocking} triangles across the ${w.kind} from the ${a.name} to the ${b.name}`);
    }
  }
  // Nothing left to be found may stand inside the fences that keep the player in the country about the town.
  for (const f of scene.finds ?? []) {
    if ((scene.fences ?? []).some((b) => f.at.x > b.min.x && f.at.x < b.max.x && f.at.z > b.min.z && f.at.z < b.max.z && f.at.y > b.min.y - 1 && f.at.y < b.max.y)) problems.push(`${f.what} is fenced off`);
  }
  if (problems.length) failed++;
  const t = site.town!, kinds = (k: string) => t.buildings.filter((b) => b.style === k).length;
  let triangles = 0;
  for (const set of [scene.meshes, scene.scenery?.meshes ?? new Map()]) for (const m of set.values()) triangles += m.triangleCount;
  console.log(`${seed}: ${kinds('imperial')} classical, ${kinds('timber')} timber, ${kinds('wooden')} wooden, ${t.storehouses.length} storehouses, ${t.shacks.length} shacks; ${triangles.toLocaleString()} triangles in all;`);
  console.log(`${seed}: ${site.setting.stone}, ${scene.fences?.length} fences, ${JSON.stringify(scene.planted)}, built in ${ms.toFixed(0)} ms, ${rockTriangles.toLocaleString()} triangles of rock${problems.length ? ' | ' + problems.join('; ') : ''}`);
}
console.log(failed ? `${failed} of ${count} FAILED` : `all ${count} sound; slowest ${slowest.toFixed(0)} ms`);
process.exit(failed ? 1 : 0);
