import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';
import { solids } from './buildings';
import { turner } from './geom/turned';

type Colour = [number, number, number];

/**
 * Builds what stands out of doors before a mine: the tramway of wooden rails from the adit's
 * mouth out along the spoil heap to its tip, with a tub on it; the miners' shed beside the mouth;
 * a stack of pit props; and a heap of what was thought worth keeping. (The heap of spoil itself is
 * ground, and is made with the ground.) Places are given as the mine has them: `inside` metres out
 * from the foot of the valley's wall along the adit's line, and `off` metres to one side of it.
 */
export function buildMineYard(
  o: { at: (inside: number, off: number) => [number, number]; heap: number; shed: -1 | 1; mouth: number; stone: Colour; cut: (inside: number) => number },
  ground: (x: number, z: number) => number, mesh: (material: string) => MeshBuilder, rng: Rng,
): { torches: { position: Vector3; out: Vector3 }[] } {
  const { block, stick } = solids(mesh), turned = turner(mesh, ground);
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const tone = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
  const pole: Colour = [0.36, 0.29, 0.21], plank: Colour = [0.3, 0.25, 0.19], log: Colour = [0.42, 0.36, 0.3], iron: Colour = [0.07, 0.07, 0.08];
  // A point of the yard, standing `up` above the ground there.
  const P = (inside: number, off: number, up = 0) => { const [x, z] = o.at(inside, off); return V(x, ground(x, z) + up, z); };
  // (On the adit's line the ground near the mouth is cut down to the adit's floor, and the tramway lies in the cutting.)
  const T = (inside: number, off: number, up = 0) => { const [x, z] = o.at(inside, off); return V(x, Math.min(ground(x, z), o.cut(inside)) + up, z); };
  const torches: { position: Vector3; out: Vector3 }[] = [];

  // ---- the tramway: two rails of squared timber on sleepers, from the mouth to the tip, and a stop at its end
  const tip = 8 + o.heap - 1.1;
  for (let s = o.mouth; s < tip - 0.01; s += 1) {
    const e = Math.min(tip, s + 1);
    for (const side of [-0.28, 0.28]) stick(T(s, side, 0.1), T(e, side, 0.1), 0.07, 0.09, pole);
    stick(T(s + 0.5, -0.5, 0.03), T(s + 0.5, 0.5, 0.03), 0.16, 0.07, tone(pole, rng.range(0.75, 1.05)));
  }
  for (const side of [-0.42, 0.42]) stick(P(tip + 0.1, side, -0.3), P(tip + 0.1, side, 0.6), 0.12, 0.12, pole);
  stick(P(tip + 0.1, -0.55, 0.42), P(tip + 0.1, 0.55, 0.42), 0.14, 0.14, pole);

  // ---- a tub on the rails: a box of planks bound with iron, on four wheels, with ore in it
  {
    const at = 8 + o.heap * 0.42, a = P(at - 0.55, 0), b = P(at + 0.55, 0), mid = a.clone().add(b).multiplyScalar(0.5), yaw = Math.atan2(b.z - a.z, b.x - a.x);
    const y = mid.y + 0.16, ux = Math.cos(yaw), uz = Math.sin(yaw);
    // (Its axles lie across the rails.)
    for (const d of [-0.36, 0.36]) {
      const cx = mid.x + ux * d, cz = mid.z + uz * d;
      for (const side of [-0.28, 0.28]) turned('wood', cx - uz * (side - 0.035), y + 0.18, cz + ux * (side - 0.035), [[0, 0], [0.19, 0], [0.19, 0.07], [0, 0.07]], { lie: yaw + Math.PI / 2, segments: 12, colour: (_a, _h, t) => (t > 0.01 && t < 0.99 ? iron : tone(pole, 0.8)) });
      stick(V(cx - uz * 0.34, y + 0.18, cz + ux * 0.34), V(cx + uz * 0.34, y + 0.18, cz - ux * 0.34), 0.06, 0.06, iron, 'metal');
    }
    stick(V(mid.x - ux * 0.6, y + 0.42, mid.z - uz * 0.6), V(mid.x + ux * 0.6, y + 0.42, mid.z + uz * 0.6), 0.74, 0.1, plank);
    for (const side of [-0.34, 0.34]) stick(V(mid.x - ux * 0.6 - uz * side, y + 0.7, mid.z - uz * 0.6 + ux * side), V(mid.x + ux * 0.6 - uz * side, y + 0.7, mid.z + uz * 0.6 + ux * side), 0.06, 0.48, tone(plank, rng.range(0.85, 1.1)));
    for (const end of [-0.57, 0.57]) stick(V(mid.x + ux * end - uz * 0.34, y + 0.7, mid.z + uz * end + ux * 0.34), V(mid.x + ux * end + uz * 0.34, y + 0.7, mid.z + uz * end - ux * 0.34), 0.06, 0.48, tone(plank, 0.95));
    for (const end of [-0.3, 0.3]) for (const side of [-0.375, 0.375]) stick(V(mid.x + ux * end - uz * side, y + 0.45, mid.z + uz * end + ux * side), V(mid.x + ux * end - uz * side, y + 0.95, mid.z + uz * end + ux * side), 0.05, 0.02, iron, 'metal');
    turned('scree', mid.x, y + 0.8, mid.z, [[0.5, 0], [0.38, 0.14], [0.2, 0.24], [0, 0.27]], { segments: 10, swell: (ang) => 1 + 0.18 * Math.sin(ang * 2 + yaw) * (Math.abs(Math.cos(ang - yaw)) < 0.5 ? -0.6 : 1), colour: (ang, h) => tone(o.stone, 0.5 + 0.5 * Math.abs(Math.sin(ang * 5 + h * 30))) });
  }

  // ---- the shed: a lean-to of posts and planks, open towards the tramway, roofed with boards
  {
    const s = o.shed, i0 = 7.4, i1 = 10.4, f = 3.7 * s, back = 6.1 * s;
    const base = Math.min(P(i0, f).y, P(i1, f).y, P(i0, back).y, P(i1, back).y), post = (inside: number, off: number, tall: number) => { const p = P(inside, off); stick(V(p.x, base - 0.4, p.z), V(p.x, base + tall, p.z), 0.14, 0.14, pole); };
    post(i0, f, 2.35); post(i1, f, 2.35); post(i0, back, 1.9); post(i1, back, 1.9); post((i0 + i1) / 2, f, 2.35);
    const up = (inside: number, off: number, y: number) => { const p = P(inside, off); return V(p.x, base + y, p.z); };
    // Plates along the tops of the posts, and the boards of the walls standing between sill and plate.
    stick(up(i0 - 0.15, f, 2.4), up(i1 + 0.15, f, 2.4), 0.14, 0.14, pole);
    stick(up(i0 - 0.15, back, 1.95), up(i1 + 0.15, back, 1.95), 0.14, 0.14, pole);
    for (let d = i0 + 0.12; d < i1; d += 0.25) stick(up(d, back, -0.1), up(d, back, 1.9), 0.22, 0.035, tone(plank, rng.range(0.8, 1.15)));
    for (const end of [i0, i1]) for (let d = Math.abs(f) + 0.12; d < Math.abs(back); d += 0.25) {
      const tall = 2.35 - 0.45 * ((d - Math.abs(f)) / (Math.abs(back) - Math.abs(f)));
      stick(up(end, d * s, -0.1), up(end, d * s, tall), 0.035, 0.22, tone(plank, rng.range(0.8, 1.15)));
    }
    // The roof: boards laid down the slope, one lapping the next, standing out past the walls all round.
    for (let d = i0 - 0.3; d < i1 + 0.3; d += 0.3) stick(up(d + 0.15, f - 0.45 * s, 2.58), up(d + 0.15, back + 0.3 * s, 1.98), 0.34, 0.035, tone([0.24, 0.215, 0.18], rng.range(0.8, 1.15)));
    // Within: a bench along the back, a cask, and a lamp hung on the middle post, which is kept burning.
    stick(up(i0 + 0.3, back - 0.45 * s, 0.5), up(i1 - 0.3, back - 0.45 * s, 0.5), 0.4, 0.06, plank);
    for (const d of [i0 + 0.5, i1 - 0.5]) stick(up(d, back - 0.45 * s, -0.1), up(d, back - 0.45 * s, 0.47), 0.3, 0.08, pole);
    const cask = P(i1 - 0.55, f + 0.6 * s);
    turned('wood', cask.x, base, cask.z, [[0.24, 0], [0.3, 0.2], [0.31, 0.4], [0.3, 0.6], [0.24, 0.8], [0.21, 0.8], [0.21, 0.75], [0, 0.75]], { segments: 12, colour: (_a, h) => (Math.abs(h - 0.12) < 0.04 || Math.abs(h - 0.68) < 0.04 ? iron : tone(pole, 1.1)) });
    const lamp = P((i0 + i1) / 2, f - 0.12 * s), away = P((i0 + i1) / 2, f - 1.12 * s);
    torches.push({ position: V(lamp.x, base + 1.85, lamp.z), out: V(away.x - lamp.x, 0, away.z - lamp.z).normalize() });
  }

  // ---- pit props, cut to length and stacked across the tramway from the shed; and a heap of ore sorted from the spoil
  {
    const s = -o.shed, y0 = P(8.8, 4.3 * s).y;
    let n = 0;
    for (let row = 0; row < 4; row++) for (let k = 0; k < 5 - row; k++) {
      const off = (3.9 + 0.19 * (k + row * 0.5)) * s, w = rng.range(0.15, 0.19), a = P(7.6 + rng.range(-0.1, 0.1), off), b = P(9.9 + rng.range(-0.1, 0.1), off);
      stick(V(a.x, y0 + 0.1 + row * 0.165, a.z), V(b.x, y0 + 0.1 + row * 0.165, b.z), w, w, tone(log, rng.range(0.8, 1.15)), 'bark');
      n++;
    }
    for (const d of [7.9, 9.6]) for (const off of [3.8, 5.0]) { const p = P(d, off * s); stick(V(p.x, y0 - 0.3, p.z), V(p.x, y0 + 0.75, p.z), 0.08, 0.08, pole); }
    const ore = P(12.4, 4.2 * s), sd = rng.range(0, 30);
    turned('scree', ore.x, ore.y, ore.z, [[1.25, -0.15], [0.95, 0.22], [0.5, 0.5], [0, 0.6]], { follow: true, segments: 14, swell: (ang, h) => 1 + 0.14 * Math.sin(ang * 3 + sd + h * 4), colour: (ang, h) => { const k = 0.55 + 0.6 * Math.abs(Math.sin(ang * 7 + h * 23 + sd)); return k > 0.95 ? [0.16, 0.34, 0.29] : tone(o.stone, k * 0.8); } });
    void n;
    // A barrow by the heap, tipped up on its nose: a tray of boards between two shafts, and a wheel.
    const bw = P(11.3, 5.6 * s), yaw = rng.range(0, 6.28), ux = Math.cos(yaw), uz = Math.sin(yaw);
    for (const side of [-0.27, 0.27]) stick(V(bw.x - ux * 0.75 - uz * side, bw.y + 0.5, bw.z - uz * 0.75 + ux * side), V(bw.x + ux * 0.75 - uz * side * 0.5, bw.y + 0.2, bw.z + uz * 0.75 + ux * side * 0.5), 0.06, 0.06, pole);
    stick(V(bw.x - ux * 0.35, bw.y + 0.46, bw.z - uz * 0.35), V(bw.x + ux * 0.45, bw.y + 0.3, bw.z + uz * 0.45), 0.62, 0.05, plank);
    turned('wood', bw.x + ux * 0.72 - uz * -0.035, bw.y + 0.2, bw.z + uz * 0.72 + ux * -0.035, [[0, 0], [0.2, 0], [0.2, 0.07], [0, 0.07]], { lie: yaw + Math.PI / 2, segments: 12, colour: () => tone(pole, 0.85) });
    for (const side of [-0.25, 0.25]) stick(V(bw.x - ux * 0.3 - uz * side, bw.y - 0.05, bw.z - uz * 0.3 + ux * side), V(bw.x - ux * 0.3 - uz * side, bw.y + 0.44, bw.z - uz * 0.3 + ux * side), 0.05, 0.05, pole);
    void block;
  }
  return { torches };
}
