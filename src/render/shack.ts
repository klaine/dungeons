import { Rng } from '../core/rng';
import type { Town } from '../core/site';
import type { anyAngle, P3 } from './geom/anyAngle';
import type { Colour } from './planting';

const shade = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
/**
 * One shack, as the town builds it: a floor of boards on a sill, walls of upright boards with a door and a window, corner posts, a roof
 * of two slopes or one, of tarred boards, tin or turf, a stovepipe, a cot, a crate and a barrel inside, nets or pots outside; on posts
 * and up steps if it stands on them. (In a module of its own, so that the building lab can make one without the town.) `solid` lays
 * the closed solids, `ground` says how high the ground is, and the posts go down to it or to a little under `sea`, whichever is lower.
 * Gives back the top of its stovepipe, where smoke rises.
 */
export function buildShack(sh: Town['shacks'][number], h: Rng, solid: ReturnType<typeof anyAngle>['solid'], ground: (x: number, z: number) => number, sea: number): { x: number; y: number; z: number } {
  const frame = (x: number, z: number, y: number, facing: number) => { const fx = Math.cos(facing), fz = Math.sin(facing); return (a: number, hh: number, f: number): P3 => [x + fx * f - fz * a, y + hh, z + fz * f + fx * a]; };
  const box = (at: ReturnType<typeof frame>, material: string, a0: number, a1: number, h0: number, h1: number, f0: number, f1: number, colour: Colour, scale = 0.5) =>
    solid(material, [at(a0, h0, f0), at(a1, h0, f0), at(a1, h0, f1), at(a0, h0, f1), at(a0, h1, f0), at(a1, h1, f0), at(a1, h1, f1), at(a0, h1, f1)], colour, scale);
  const at = frame(sh.x, sh.z, sh.y, sh.turn), hw = sh.w / 2, hd = sh.d / 2, plank = sh.colour, tar: Colour = [0.07, 0.065, 0.06], post: Colour = [0.24, 0.18, 0.12];
  const wallH = h.range(2.1, 2.5), door = h.range(-hw * 0.4, hw * 0.4);
  // On posts, if it stands on them: down to the ground or the bed under the water, and braced.
  if (sh.stilts) for (const [a, f] of [[-hw + 0.2, -hd + 0.2], [hw - 0.2, -hd + 0.2], [-hw + 0.2, hd - 0.2], [hw - 0.2, hd - 0.2], [0, hd - 0.2], [0, -hd + 0.2]]) {
    const [px, , pz] = at(a, 0, f), foot = Math.min(ground(px, pz), sea - 0.5) - 0.6;
    box(frame(px, pz, 0, sh.turn), 'wood', -0.1, 0.1, foot, sh.y, -0.1, 0.1, post, 0.9);
  }
  // The floor of boards, on a sill of timber.
  box(at, 'wood', -hw, hw, -0.25, -0.03, -hd, hd, post, 0.9);
  for (let f = -hd; f < hd - 0.01; f += 0.2) box(at, 'wood', -hw + 0.02, hw - 0.02, -0.03, 0, f + 0.005, Math.min(hd, f + 0.2) - 0.005, shade(plank, h.range(0.8, 1.1)), 0.9);
  // The walls: upright boards, each its own, with gaps where a board has shrunk; the door in the front, a window in a side.
  const winSide = h.chance(0.5) ? -1 : 1, win = h.range(-hd * 0.3, hd * 0.3);
  const wall = (from: [number, number], to: [number, number], top: (s: number) => number, hole?: { s0: number; s1: number; y0: number; y1: number }) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]), ua = (to[0] - from[0]) / len, uf = (to[1] - from[1]) / len, na = uf, nf = -ua;
    for (let s = 0; s < len - 0.02; s += 0.22) {
      const e = Math.min(len, s + 0.2), mid = (s + e) / 2, hgt = top(mid);
      const tone = shade(plank, h.range(0.7, 1.15));
      const piece = (y0: number, y1: number) => {
        if (y1 - y0 < 0.02) return;
        const p = (ss: number, yy: number, tt: number) => at(from[0] + ua * ss + na * tt, yy, from[1] + uf * ss + nf * tt);
        solid('wood', [p(s, y0, 0), p(e, y0, 0), p(e, y0, 0.05), p(s, y0, 0.05), p(s, y1, 0), p(e, y1, 0), p(e, y1, 0.05), p(s, y1, 0.05)], tone, 0.9);
      };
      if (hole && mid > hole.s0 && mid < hole.s1) { piece(0, hole.y0); piece(hole.y1, hgt); } else piece(0, hgt);
    }
  };
  const pitch = !sh.lean, ridgeUp = pitch ? h.range(0.9, 1.4) : 0, leanDrop = sh.lean ? h.range(0.5, 0.8) : 0;
  // (A roof of one slope falls from the front to the back, and the walls' tops fall with it: they had risen the other way, so that the
  // back wall stood up through the roof and the front stopped short of it.)
  const topAt = (f: number) => (pitch ? wallH : wallH - leanDrop * ((hd - f) / sh.d));
  const gableAt = (a: number) => (pitch ? wallH + ridgeUp * (1 - Math.abs(a) / hw) : wallH);
  wall([-hw, hd], [hw, hd], (s) => (pitch ? gableAt(-hw + s) : topAt(hd)), { s0: door + hw - 0.42, s1: door + hw + 0.42, y0: 0, y1: 1.85 });
  wall([hw, hd], [hw, -hd], (s) => topAt(hd - s), winSide > 0 ? { s0: hd - win - 0.35, s1: hd - win + 0.35, y0: 0.95, y1: 1.6 } : undefined);
  wall([hw, -hd], [-hw, -hd], (s) => (pitch ? gableAt(hw - s) : topAt(-hd)));
  wall([-hw, -hd], [-hw, hd], (s) => topAt(-hd + s), winSide < 0 ? { s0: hd + win - 0.35, s1: hd + win + 0.35, y0: 0.95, y1: 1.6 } : undefined);
  // Corner posts, and a shutter hung open beside the window.
  for (const [a, f] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) box(at, 'wood', a - 0.07, a + 0.07, -0.05, topAt(f) + 0.02, f - 0.07, f + 0.07, post, 0.9);
  // The roof: two slopes from a ridge along its depth, or one falling from front to back; of tarred boards, tin or turf.
  const cover: [string, Colour] = sh.roof === 'tin' ? ['metal', h.pick([[0.42, 0.22, 0.12], [0.36, 0.34, 0.32], [0.48, 0.3, 0.18]] as Colour[])] : sh.roof === 'turf' ? ['wood', [0.2, 0.22, 0.1]] : ['wood', tar];
  const e = 0.3, th = sh.roof === 'turf' ? 0.22 : 0.06;
  const slab = (pts: P3[]) => solid(cover[0], [...pts, ...pts.map(([x, y, z]): P3 => [x, y + th, z])], cover[1], 0.6);
  if (pitch) {
    for (const side of [-1, 1]) slab([at(0, wallH + ridgeUp, -hd - e), at(0, wallH + ridgeUp, hd + e), at(side * (hw + e), wallH - e * (ridgeUp / hw), hd + e), at(side * (hw + e), wallH - e * (ridgeUp / hw), -hd - e)]);
  } else slab([at(-hw - e, wallH + 0.03, hd + e), at(hw + e, wallH + 0.03, hd + e), at(hw + e, wallH - leanDrop - 0.03, -hd - e), at(-hw - e, wallH - leanDrop - 0.03, -hd - e)]);
  // Ribs on tin, so that it reads as corrugated sheets; a stovepipe.
  if (sh.roof === 'tin') for (let a = -hw - e + 0.15; a < hw + e; a += 0.25) {
    if (pitch) { const side = a < 0 ? -1 : 1, y0 = wallH - e * (ridgeUp / hw) + (1 - (Math.abs(a) + 0) / (hw + e)) * (ridgeUp + e * (ridgeUp / hw)); box(frame(...(at(a, 0, 0).filter((_, k) => k !== 1) as [number, number]), sh.y, sh.turn), 'metal', -0.02, 0.02, y0 + th, y0 + th + 0.03, -hd - e, hd + e, shade(cover[1], 0.8)); void side; }
  }
  const pipe = at(hw * 0.4, 0, -hd * 0.3);
  box(frame(pipe[0], pipe[2], sh.y, 0), 'metal', -0.08, 0.08, wallH - 0.3, wallH + ridgeUp + 0.7, -0.08, 0.08, [0.1, 0.09, 0.08]);
  const stovepipe = { x: pipe[0], y: sh.y + wallH + ridgeUp + 0.7, z: pipe[2] };
  // Inside: a cot, a crate, a barrel; outside, nets hung on a rack, or lobster pots, or firewood.
  box(at, 'wood', -hw + 0.15, -hw + 0.95, 0, 0.45, -hd + 0.2, -hd + 2.1, [0.35, 0.27, 0.18], 0.9);
  box(at, 'plaster', -hw + 0.18, -hw + 0.92, 0.45, 0.55, -hd + 0.25, -hd + 2.0, [0.5, 0.45, 0.38]);
  box(at, 'wood', hw - 0.75, hw - 0.15, 0, 0.6, -hd + 0.2, -hd + 0.8, [0.42, 0.32, 0.2], 0.9);
  if (h.chance(0.6)) {
    const side = h.chance(0.5) ? -1 : 1, a = side * (hw + 0.9);
    for (const f of [-hd * 0.6, hd * 0.6]) box(at, 'wood', a - 0.05, a + 0.05, 0, 1.9, f - 0.05, f + 0.05, post, 0.9);
    box(at, 'wood', a - 0.04, a + 0.04, 1.85, 1.92, -hd * 0.6, hd * 0.6, post, 0.9);
    box(at, 'plaster', a - 0.02, a + 0.02, 0.6, 1.85, -hd * 0.55, hd * 0.55, [0.35, 0.3, 0.22]);
  } else for (let k = 0; k < h.int(2, 5); k++) box(at, 'wood', -hw + 0.3 + k * 0.6, -hw + 0.8 + k * 0.6, 0, 0.45, hd + 0.4, hd + 0.9, [0.4, 0.3, 0.2], 0.9);
  // Steps up to the door, if it stands on posts.
  if (sh.stilts) for (let k = 1; k <= 6; k++) { const y = -k * 0.25; box(at, 'wood', door - 0.45, door + 0.45, y - 0.05, y, hd + k * 0.3 - 0.3, hd + k * 0.3, post, 0.9); }
  return stovepipe;
}
