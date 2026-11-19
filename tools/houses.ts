/**
 * Walks the player's body into houses of brick and canal houses, each built alone on level ground, without a browser: up the stoop
 * or straight in at the front door, to the foot of the stair, up each flight and back along the well to the next, to the top
 * storey. The same body and the same collision as the game's (`Player`, over the house's own triangles). Reports any house it could
 * not climb, with where it stopped. Usage: npx tsx tools/houses.ts [count] [canal|brick] [deep]   (`DEBUG=seed` for one house, in full.)
 */
(globalThis as Record<string, unknown>).document = { addEventListener() {}, body: { classList: { toggle() {} } } };
(globalThis as Record<string, unknown>).window = { addEventListener() {} };
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { canalDoor, canalShell, canalStoop, dealCanalHouse, planCanal } from '../src/core/canal';
import { brickDoor, brickShell, dealBrickHouse, planBrick } from '../src/core/brick';
import { routeThrough, steepFlights } from '../src/core/interior';
import { fromBuilding } from '../src/core/town';
import { Rng } from '../src/core/rng';
import { Building } from '../src/core/site';
import { buildBuilding } from '../src/render/buildings';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { Player } from '../src/app/player';

const count = Number(process.argv[2] ?? 30), only = process.argv[3], deep = Number(process.argv[4] ?? 13), debug = process.env.DEBUG;

/** Walks one house; returns null if it got to the top, or where it stopped. */
function walk(style: 'canal' | 'brick', seed: string, verbose = false): string | null | 'shut' {
  const d = style === 'canal' ? dealCanalHouse(new Rng(seed), { deep }) : dealBrickHouse(new Rng(seed), deep);
  if (!d) return 'shut';
  const b: Building = { ...d, x: 0, z: 0, faces: 'w', turn: Math.PI, y: 0 }, plan = style === 'canal' ? planCanal(b) : planBrick(b);
  if (!plan) return 'shut';
  b.plan = plan;
  const meshes = new Map<string, MeshBuilder>();
  buildBuilding({ ...b, turn: undefined }, 0, (k) => { if (!meshes.has(k)) meshes.set(k, new MeshBuilder()); return meshes.get(k)!; }, new Rng('walk'), [0.8, 0.78, 0.7], false);
  // (All of it, as the game collides with all it builds, and level ground about it.)
  const pos: number[] = [], idx: number[] = [];
  for (const m of meshes.values()) { const g = m.build(), o = pos.length / 3; pos.push(...(g.getAttribute('position').array as Float32Array)); for (const i of g.getIndex()!.array) idx.push(i + o); }
  const o = pos.length / 3;
  pos.push(-60, 0, -60, 60, 0, -60, 60, 0, 60, -60, 0, 60); idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); geo.setIndex(idx);
  const player = new Player(new PerspectiveCamera(), { addEventListener() {} } as unknown as HTMLElement, new MeshBVH(geo));
  const canal = style === 'canal', sh = canal ? canalShell(b) : brickShell(b), door = canal ? canalDoor(b) : brickDoor(b), W = b.w, du = (door.s0 + door.s1) / 2 - W / 2;
  const at = (u: number, v: number) => fromBuilding(b, u, v), pts: [number, number][] = [];
  // The way in: up the stoop, along its flight to the landing; else straight in.
  const st = canal ? canalStoop(b) : null;
  let start: [number, number] = [du, -2.5];
  if (st && st.flights.length && b.canalwork!.stoop > 0.5) {
    const fl = st.flights[0];
    if (fl.dir === 0) { start = [du, -(st.landing.out + fl.steps * fl.tread + 1.5)]; pts.push([du, -0.45]); }
    else { const end = fl.s + fl.dir * (fl.steps * fl.tread + 0.6) - W / 2; start = [end, -1.8]; pts.push([end, -0.5], [(st.landing.s0 + st.landing.s1) / 2 - W / 2, -0.55]); }
  }
  pts.push([du, sh.v0 + 0.8]);
  const stair = plan.stair, flights = stair ? steepFlights(sh.floors, stair.v1 - stair.v0) : [];
  if (stair) {
    const mid = (stair.u0 + stair.u1) / 2, open = stair.wall < 0 ? stair.u1 : stair.u0, out = stair.wall < 0 ? 1 : -1;
    flights.forEach((f, k) => {
      // (On each storey, the free way beside the stair: midway between its rail and the far side of the room it stands in; reached past the end
      // of the longer of the flight come up and the flight going on up, whose balusters stand along it from the floor.)
      const room = plan.rooms.filter((r) => r.storey === undefined || r.storey === k).find((r) => mid > r.u0 && mid < r.u1 && stair.v0 > r.v0 - 0.01 && stair.v0 < r.v1 + 0.01);
      const far = room ? (out > 0 ? room.u1 : room.u0) : open + out * 1.2, free = (open + out * 0.05 + far) / 2;
      if (k > 0) { const past = stair.v0 + Math.max(flights[k - 1].length, f.length) + 0.45; pts.push([mid, past], [free, past], [free, stair.v0 - 0.55]); }
      // (From the front door to the foot of the stair through whatever doorways lie between.)
      if (k === 0) pts.push(...routeThrough(plan, sh, 0, pts[pts.length - 1], [mid, stair.v0 - 0.55]));
      pts.push([mid, stair.v0 - 0.55], [mid, stair.v0 + f.length + 0.45]);
    });
  }
  const [sx, sz] = at(...start);
  player.place(new Vector3(sx, 1.75, sz), 0);
  if (verbose) console.log(style, seed, `${b.w} by ${b.d}`, plan.rooms.map((r) => r.kind).join(' '), 'floors', sh.floors.map((f) => f.toFixed(2)).join(' '), 'flights', flights.map((f) => `${f.steps} of ${f.rise.toFixed(3)} by ${f.tread.toFixed(3)}`).join(', '), 'stair', JSON.stringify(stair));
  for (const [n, [u, v]] of pts.entries()) {
    const [tx, tz] = at(u, v);
    let ok = false;
    for (let i = 0; i < 1800 && !ok; i++) {
      if (Math.hypot(tx - player.position.x, tz - player.position.z) < 0.3) { ok = true; break; }
      if (process.env.TRACE && i > 1780) { const pl = player as unknown as { onGround: boolean; velocity: Vector3 }; console.log('     frame', i, 'v', (player.position.x - b.x + b.d / 2).toFixed(3), 'y', player.position.y.toFixed(3), 'ground', pl.onGround, 'vel', pl.velocity.toArray().map((x) => x.toFixed(2)).join(',')); }
      player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
      player.analog.set(0, -1);
      player.update(1 / 60);
    }
    player.analog.set(0, 0);
    const p = player.position, here = `u ${(p.z - b.z).toFixed(2)} v ${(p.x - b.x + b.d / 2).toFixed(2)} y ${p.y.toFixed(2)}`;
    if (verbose) console.log(' ', n, ok ? 'reached' : 'STOPPED', `(${u.toFixed(2)}, ${v.toFixed(2)})`, 'at', here);
    if (!ok && verbose) {
      // What the body is touching where it stopped: each triangle near its capsule, by where it is and which way it faces.
      for (const [name, m] of meshes) {
        const g = m.build(), P = g.getAttribute('position').array as Float32Array, I = g.getIndex()!.array;
        for (let t = 0; t < I.length; t += 3) {
          const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3);
          const ys = [I[t], I[t + 1], I[t + 2]].map((i) => P[i * 3 + 1]);
          if (Math.hypot(c[0] - p.x, c[2] - p.z) < 0.45 && Math.max(...ys) > p.y + 0.05 && Math.min(...ys) < p.y + 1.9) console.log('   ', name, 'tri at u', (c[2] - b.z).toFixed(2), 'v', (c[0] - b.x + b.d / 2).toFixed(2), 'y', Math.min(...ys).toFixed(2), '..', Math.max(...ys).toFixed(2));
        }
      }
    }
    if (!ok) return `stopped short of point ${n} of ${pts.length} (u ${u.toFixed(2)}, v ${v.toFixed(2)}) at ${here}`;
  }
  const top = sh.floors[b.storeys - 1], y = player.position.y;
  return Math.abs(y - top) < 0.3 ? null : `ended at ${y.toFixed(2)}, the top floor being at ${top.toFixed(2)}`;
}

if (debug) { const [style, seed] = debug.split(':'); console.log(walk(style as 'canal' | 'brick', seed, true) ?? 'climbed'); process.exit(0); }
let failed = 0, walked = 0;
for (const style of ['canal', 'brick'] as const) {
  if (only && only !== style) continue;
  for (let n = 0; n < count; n++) {
    const r = walk(style, `walk-${n}`);
    if (r === 'shut') continue;
    walked++;
    if (r) { failed++; console.log(`${style}:walk-${n}`, r); }
  }
}
console.log(failed ? `${failed} of ${walked} FAILED` : `all ${walked} climbed to the top`);
process.exit(failed ? 1 : 0);
