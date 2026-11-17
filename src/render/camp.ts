import { Vector3 } from 'three';
import { Camp } from '../core/site';
import { fbm2, Rng } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';
import { solids } from './buildings';
import { turner } from './geom/turned';

type Colour = [number, number, number];

/**
 * Builds a camp of charcoal burners where the site document says it is: the clamps, the hut, the
 * cordwood and the things of the trade, each standing on the ground as `ground` gives it. All of
 * it is plain solids, closed all round. Returns where smoke rises and what was left to be found.
 *
 * Most of it is turned work: a profile (how far out at each height) swept round an upright line,
 * which is what a mound of earth, a hut of poles, a barrel, a stump and a sack all are.
 */
export function buildCamp(
  camp: Camp, ground: (x: number, z: number) => number, mesh: (material: string) => MeshBuilder, rng: Rng, wayIn: [number, number] | null, turfColour: (x: number, z: number) => Colour,
): { smokes: { x: number; y: number; z: number; height: number }[]; finds: { at: Vector3; what: string }[]; fires: Vector3[] } {
  const { block, stick } = solids(mesh);
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const tone = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
  const earth: Colour = [0.2, 0.16, 0.12], soot: Colour = [0.06, 0.055, 0.05], sod: Colour = [0.13, 0.17, 0.07], coal: Colour = [0.025, 0.025, 0.03];
  const log: Colour = [0.42, 0.36, 0.3], pole: Colour = [0.36, 0.29, 0.21], pale: Colour = [0.62, 0.52, 0.36];

  const turned = turner(mesh, ground);
  // The lowest ground under a thing of a given breadth: it is set on that, and its foot goes a little below.
  const foot = (x: number, z: number, r: number) => (ground(x, z) + Math.min(ground(x, z), ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r))) / 2 - 0.08;
  const dome = (r: number, h: number, steps = 8): [number, number][] => Array.from({ length: steps + 1 }, (_, k) => { const a = (k / steps) * Math.PI / 2; return [k === steps ? 0 : r * Math.pow(Math.cos(a), 0.8), h * Math.sin(a) + 0.12] as [number, number]; });
  const smokes: { x: number; y: number; z: number; height: number }[] = [], finds: { at: Vector3; what: string }[] = [], fires: Vector3[] = [];
  const toMiddle = (x: number, z: number) => Math.atan2(camp.z - z, camp.x - x);

  // ---- the clamps
  for (const c of camp.clamps) {
    const y = foot(c.x, c.z, c.r), s = rng.range(0, 50);
    if (c.state === 'burning') {
      // Covered with earth and turf and burning inside: a low dome, sooty towards the top, with turf sods showing in patches, vents round it, a ladder against it and a hurdle to windward.
      const h = c.r * 0.95;
      turned('turf', c.x, y, c.z, [[c.r * 1.1, -0.8], [c.r * 1.04, 0], ...dome(c.r, h)], {
        bare: (a, hh) => (fbm2(a * 1.3 + s + 9, hh * 1.5, 2) > 0.56 && hh < h * 0.75 ? 0.15 : 0.96), segments: 28, swell: (a, hh) => 1 + 0.06 * (fbm2(a * 1.6 + s, hh * 1.3, 2) - 0.5) * 2,
        colour: (a, hh, t, vx, vz) => { const k = 0.8 + 0.4 * fbm2(a * 2.2 + s, hh * 2.4, 3), dark = 1 - 0.8 * Math.max(0, Math.min(1, (t - 0.45) / 0.45)); return tone(turfColour(vx, vz), k * dark); },
      });
      // (A kerb of sods round its foot.)
      turned('turf', c.x, y, c.z, [[c.r * 1.32, -0.1], [c.r * 1.22, 0.26], [c.r * 1.12, 0.26], [c.r * 1.0, -0.1]], { follow: true, bare: 0.1, segments: 28, swell: (a) => 1 + 0.05 * Math.sin(a * 9 + s), colour: (a, _h, _t, vx, vz) => tone(turfColour(vx, vz), 0.75 + 0.4 * fbm2(a * 3 + s, 1, 2)) });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3, r = c.r * 0.93, vy = y + 0.12 + h * 0.36;
        block('scree', V(c.x + Math.cos(a) * r - 0.09, vy - 0.07, c.z + Math.sin(a) * r - 0.09), V(c.x + Math.cos(a) * r + 0.09, vy + 0.07, c.z + Math.sin(a) * r + 0.09), [0.012, 0.01, 0.01]);
      }
      const la = toMiddle(c.x, c.z) + 2.2, lx = Math.cos(la), lz = Math.sin(la);
      for (const side of [-0.22, 0.22]) stick(V(c.x + lx * (c.r + 1.0) - lz * side, y + 0.1, c.z + lz * (c.r + 1.0) + lx * side), V(c.x + lx * c.r * 0.42 - lz * side, y + h * 0.98, c.z + lz * c.r * 0.42 + lx * side), 0.07, 0.07, pole);
      for (let k = 1; k <= 5; k++) {
        const t = k / 6, px = c.x + lx * (c.r + 1.0 - (c.r * 0.58 + 1.0) * t), pz = c.z + lz * (c.r + 1.0 - (c.r * 0.58 + 1.0) * t), py = y + 0.1 + (h * 0.98 - 0.1) * t;
        stick(V(px - lz * 0.26, py, pz + lx * 0.26), V(px + lz * 0.26, py, pz - lx * 0.26), 0.05, 0.05, pole);
      }
      // The hurdle: stakes in an arc on the side away from the middle of the camp, with rods woven between.
      const wa = toMiddle(c.x, c.z) + Math.PI, wr = c.r + 1.7;
      const posts = [-0.5, -0.25, 0, 0.25, 0.5].map((d) => [c.x + Math.cos(wa + d) * wr, c.z + Math.sin(wa + d) * wr] as [number, number]);
      posts.forEach(([px, pz]) => stick(V(px, ground(px, pz) - 0.2, pz), V(px, ground(px, pz) + 1.55, pz), 0.08, 0.08, pole));
      for (let k = 0; k < posts.length - 1; k++) for (let row = 0; row < 7; row++) {
        const [ax, az] = posts[k], [bx, bz] = posts[k + 1], ya = ground(ax, az) + 0.18 + row * 0.19, yb = ground(bx, bz) + 0.18 + row * 0.19, bow = (row + k) % 2 ? 0.05 : -0.05;
        stick(V(ax + Math.cos(wa) * bow, ya, az + Math.sin(wa) * bow), V(bx - Math.cos(wa) * bow, yb, bz - Math.sin(wa) * bow), 0.045, 0.16, [0.15, 0.135, 0.11]);
      }
      smokes.push({ x: c.x, y: y + h * 0.9, z: c.z, height: 10 });
    } else if (c.state === 'building') {
      // Stacked and not yet covered: billets stood on end in three rings, leaning in on a stake at the middle; the sods to cover it lie cut beside it, with the spade.
      stick(V(c.x, y, c.z), V(c.x, y + 2.3, c.z), 0.11, 0.11, pole);
      for (const [count, r0, r1, h] of [[9, 0.34, 0.1, 1.55], [13, 0.64, 0.24, 1.48], [18, 0.95, 0.42, 1.36]] as const) for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + rng.range(-0.08, 0.08), w = rng.range(0.13, 0.19);
        stick(V(c.x + Math.cos(a) * c.r * r0, y + 0.05, c.z + Math.sin(a) * c.r * r0), V(c.x + Math.cos(a) * c.r * r1, y + h + rng.range(-0.1, 0.1), c.z + Math.sin(a) * c.r * r1), w, w, tone(log, rng.range(0.8, 1.15)), 'bark');
      }
      const sa = toMiddle(c.x, c.z) + Math.PI + 0.7, sx = c.x + Math.cos(sa) * (c.r + 1.1), sz = c.z + Math.sin(sa) * (c.r + 1.1), sy = foot(sx, sz, 0.5) + 0.1;
      for (let k = 0; k < 9; k++) {
        const ox = (k % 3) * 0.36 - 0.36, layer = Math.floor(k / 3);
        block('leaf', V(sx + ox - 0.17, sy + layer * 0.13, sz - 0.26 + layer * 0.03), V(sx + ox + 0.17, sy + layer * 0.13 + 0.12, sz + 0.26 + layer * 0.03), tone(sod, rng.range(0.8, 1.2)));
      }
      stick(V(sx + 0.75, sy, sz + 0.1), V(sx + 0.55, sy + 1.25, sz - 0.25), 0.045, 0.045, pole);
      block('metal', V(sx + 0.66, sy - 0.05, sz + 0.02), V(sx + 0.84, sy + 0.24, sz + 0.06), [0.12, 0.12, 0.13]);
    } else {
      // Burnt, opened and raked out: what is left of its covering lies in a broken ring, scorched, with charcoal still in the middle of it and the rake left where it was last used.
      const gap = toMiddle(c.x, c.z);
      turned('turf', c.x, y, c.z, [[c.r * 1.1, -0.08], [c.r * 0.86, 0.42], [c.r * 0.68, 0.34], [c.r * 0.5, -0.08]], {
        follow: true, bare: 1, from: gap + 0.55, to: gap + Math.PI * 2 - 0.55, segments: 24, swell: (a) => 1 + 0.08 * (fbm2(a * 2 + s, 3, 2) - 0.5) * 2,
        colour: (a, hh, _t, vx, vz) => tone(turfColour(vx, vz), 0.3 + 0.3 * fbm2(a * 3 + s, hh * 4, 2)),
      });
      turned('scree', c.x, y, c.z, [[c.r * 0.66, -0.05], [c.r * 0.5, 0.2], [c.r * 0.3, 0.33], [0, 0.4]], { follow: true, segments: 18, swell: (a, hh) => 1 + 0.22 * (fbm2(a * 3 + s, hh * 6, 2) - 0.5) * 2, colour: (a, hh) => tone(coal, 0.6 + 0.9 * fbm2(a * 5 + s, hh * 9, 2)) });
      const rx = c.x + Math.cos(gap + 0.2) * c.r * 0.95, rz = c.z + Math.sin(gap + 0.2) * c.r * 0.95, ry = ground(rx, rz);
      stick(V(rx, ry + 0.04, rz), V(rx + Math.cos(gap + 1.2) * 1.7, ry + 0.1, rz + Math.sin(gap + 1.2) * 1.7), 0.045, 0.045, pole);
      stick(V(rx - Math.sin(gap + 1.2) * 0.3, ry + 0.05, rz + Math.cos(gap + 1.2) * 0.3), V(rx + Math.sin(gap + 1.2) * 0.3, ry + 0.05, rz - Math.cos(gap + 1.2) * 0.3), 0.05, 0.1, pole);
    }
  }

  // ---- the hut: a cone of poles covered with turf, the door looking at the clamp that is burning
  {
    const h = camp.hut, R = h.r, H = R * 1.6, y = foot(h.x, h.z, R) + 0.1, s = rng.range(0, 50), half = 0.46, doorTop = 1.98, edge = R * (1 - doorTop / H);
    // Its covering is sods laid in courses from the ground up, each course standing out a little over the one below it; the top, where the smoke goes out, is blackened.
    const courses = 9, slopeAt = (hh: number) => R * (1 - hh / H);
    const steps = (k: number, from: number, to: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let j = 0; j < courses; j++) {
        const h0 = (H * 0.95 * j) / courses, h1 = (H * 0.95 * (j + 1)) / courses;
        if (h1 <= from || h0 >= to) continue;
        const a = Math.max(h0, from), b = Math.min(h1, to);
        out.push([slopeAt(a) * k + 0.07, a], [slopeAt(b) * k + 0.02, b]);
      }
      return out;
    };
    const cover = (inside: boolean) => {
      const swell = (a: number, hh: number) => 1 + 0.04 * (fbm2(a * 3 + s, hh * 2, 2) - 0.5) * 2;
      if (inside) {
        const look = () => [0.05, 0.043, 0.035] as Colour;
        turned('scree', h.x, y, h.z, [[R * 0.94, -0.6], [edge * 0.94, doorTop]], { from: h.facing + half, to: h.facing + Math.PI * 2 - half, inside, segments: 22, colour: look });
        turned('scree', h.x, y, h.z, [[edge * 0.94, doorTop], [0, H * 0.95]], { inside, segments: 22, colour: look });
        return;
      }
      const look = (a: number, hh: number, _t: number, vx: number, vz: number) => tone(turfColour(vx, vz), (0.62 + 0.5 * fbm2(a * 5 + s, Math.floor((hh / (H * 0.95)) * courses) * 3.1, 2)) * (1 - 0.75 * Math.max(0, Math.min(1, (hh - H * 0.72) / (H * 0.2)))));
      const bare = (a: number, hh: number) => (hh > H * 0.8 ? 0.9 : 0.12 + 0.5 * Math.max(0, fbm2(a * 4 + s + 5, hh * 3, 2) - 0.5));
      turned('turf', h.x, y, h.z, [[R + 0.1, -0.6], ...steps(1, 0, doorTop)], { from: h.facing + half, to: h.facing + Math.PI * 2 - half, segments: 22, swell, colour: look, bare });
      turned('turf', h.x, y, h.z, [...steps(1, doorTop, H * 0.95), [0, H * 0.95]], { segments: 22, swell, colour: look, bare });
    };
    cover(false);
    cover(true);
    // The poles, which stand out through the turf at the top, and the frame of the door.
    for (let k = 0; k < 11; k++) {
      const a = h.facing + half + ((Math.PI * 2 - 2 * half) * k) / 10;
      stick(V(h.x + Math.cos(a) * R * 0.97, y, h.z + Math.sin(a) * R * 0.97), V(h.x - Math.cos(a) * R * 0.06, y + H * 1.07, h.z - Math.sin(a) * R * 0.06), 0.09, 0.09, pole);
    }
    const jamb = (side: number) => { const a = h.facing + side * half; return [V(h.x + Math.cos(a) * R, y, h.z + Math.sin(a) * R), V(h.x + Math.cos(a) * edge, y + doorTop, h.z + Math.sin(a) * edge)] as const; };
    for (const side of [-1, 1]) stick(...jamb(side), 0.13, 0.13, pole);
    stick(jamb(-1)[1], jamb(1)[1], 0.13, 0.13, pole);
    // Within: a bed of bracken on a frame against the back, and a stool.
    const back = h.facing + Math.PI, bx = h.x + Math.cos(back) * R * 0.42, bz = h.z + Math.sin(back) * R * 0.42, tx = -Math.sin(back), tz = Math.cos(back);
    stick(V(bx - tx * 0.85, y + 0.22, bz - tz * 0.85), V(bx + tx * 0.85, y + 0.22, bz + tz * 0.85), 0.18, 0.62, pole);
    stick(V(bx - tx * 0.82, y + 0.36, bz - tz * 0.82), V(bx + tx * 0.82, y + 0.36, bz + tz * 0.82), 0.12, 0.56, [0.33, 0.27, 0.12], 'leaf');
    const sx = h.x + Math.cos(h.facing + 1.5) * R * 0.38, sz = h.z + Math.sin(h.facing + 1.5) * R * 0.38;
    turned('wood', sx, y, sz, [[0.17, 0], [0.17, 0.4], [0, 0.4]], { segments: 10, colour: (_a, _h, t) => (t > 0.99 ? pale : pole) });
    finds.push({ at: V(bx, y + 0.62, bz), what: 'a tally stick notched for sacks of charcoal, and a clay pipe, on the bed in the burners\' hut' });
  }

  // ---- cordwood: billets laid across between stakes, five high
  for (const st of camp.stacks) {
    const ux = Math.cos(st.turn), uz = Math.sin(st.turn), y = foot(st.x, st.z, st.length / 2) + 0.14, count = Math.floor(st.length / 0.2);
    for (let row = 0; row < 5; row++) for (let k = 0; k < count - (row % 2); k++) {
      const d = -st.length / 2 + 0.1 + k * 0.2 + (row % 2) * 0.1, w = rng.range(0.15, 0.19), half = rng.range(0.46, 0.54), cx = st.x + ux * d, cz = st.z + uz * d;
      stick(V(cx - uz * half, y + row * 0.165, cz + ux * half), V(cx + uz * half, y + row * 0.165, cz - ux * half), w, w, tone(log, rng.range(0.75, 1.2)), 'bark');
    }
    for (const end of [-1, 1]) for (const side of [-0.4, 0.4]) {
      const px = st.x + ux * (st.length / 2 + 0.06) * end - uz * side, pz = st.z + uz * (st.length / 2 + 0.06) * end + ux * side;
      stick(V(px, y - 0.3, pz), V(px, y + 1.05, pz), 0.08, 0.08, pole);
    }
  }

  // ---- the smaller things
  for (const p of camp.props) {
    const y = foot(p.x, p.z, 0.4) + 0.1, ux = Math.cos(p.turn), uz = Math.sin(p.turn);
    if (p.kind === 'block') {
      // A chopping block with the axe left in it, and what has been split lying by.
      turned('bark', p.x, y, p.z, [[0.33, 0], [0.31, 0.52], [0, 0.52]], { segments: 12, colour: (_a, _h, t) => (t > 0.99 ? pale : log) });
      stick(V(p.x + ux * 0.05, y + 0.5, p.z + uz * 0.05), V(p.x + ux * 0.5, y + 1.0, p.z + uz * 0.5), 0.045, 0.06, pole);
      block('metal', V(p.x + ux * 0.05 - 0.09, y + 0.46, p.z + uz * 0.05 - 0.03), V(p.x + ux * 0.05 + 0.09, y + 0.66, p.z + uz * 0.05 + 0.03), [0.16, 0.16, 0.17]);
      for (let k = 0; k < 6; k++) { const a = rng.range(0, 6.28), d = rng.range(0.55, 1.1), t = rng.range(0, 3.14); stick(V(p.x + Math.cos(a) * d - Math.cos(t) * 0.25, y + 0.08, p.z + Math.sin(a) * d - Math.sin(t) * 0.25), V(p.x + Math.cos(a) * d + Math.cos(t) * 0.25, y + 0.08, p.z + Math.sin(a) * d + Math.sin(t) * 0.25), 0.1, 0.13, tone(pale, rng.range(0.8, 1.1))); }
    } else if (p.kind === 'barrel') {
      // A water butt: to quench the clamp if it takes fire.
      turned('wood', p.x, y, p.z, [[0.27, 0], [0.33, 0.25], [0.34, 0.45], [0.33, 0.65], [0.27, 0.9], [0.24, 0.9], [0.24, 0.84], [0, 0.84]], { segments: 14, colour: (_a, hh) => (Math.abs(hh - 0.14) < 0.05 || Math.abs(hh - 0.76) < 0.05 ? [0.09, 0.09, 0.1] : tone(pole, 1.1)) });
    } else if (p.kind === 'sacks') {
      // Sacks of charcoal, filled and tied, waiting for the cart.
      for (const [dx, dz, lean] of [[0, 0, 0], [0.5, 0.12, 0.1], [0.22, 0.48, -0.08], [-0.34, 0.38, 0.05]] as const) {
        const sx = p.x + ux * dx - uz * dz, sz = p.z + uz * dx + ux * dz, ss = rng.range(0, 20);
        turned('scree', sx, y, sz, [[0.26, -0.1], [0.31, 0.08], [0.32, 0.28], [0.28, 0.46], [0.15, 0.56], [0.09, 0.59], [0.14, 0.67], [0, 0.65]], { segments: 10, swell: (a, hh) => 1 + 0.16 * (fbm2(a * 2 + ss, hh * 5, 2) - 0.5) * 2 + lean * hh, colour: (a, hh) => tone([0.27, 0.24, 0.18], 0.7 + 0.45 * fbm2(a * 4 + ss, hh * 8, 2) - (hh < 0.18 ? 0.3 : 0)) });
      }
    } else if (p.kind === 'sledge') {
      // A sledge for dragging wood in: two runners turned up at the front, and bars across.
      for (const side of [-0.34, 0.34]) {
        stick(V(p.x - ux * 0.9 - uz * side, y + 0.07, p.z - uz * 0.9 + ux * side), V(p.x + ux * 0.75 - uz * side, y + 0.07, p.z + uz * 0.75 + ux * side), 0.1, 0.07, pole);
        stick(V(p.x + ux * 0.75 - uz * side, y + 0.07, p.z + uz * 0.75 + ux * side), V(p.x + ux * 1.05 - uz * side, y + 0.3, p.z + uz * 1.05 + ux * side), 0.1, 0.07, pole);
        for (const d of [-0.8, 0.6]) stick(V(p.x + ux * d - uz * side, y + 0.07, p.z + uz * d + ux * side), V(p.x + ux * d - uz * side, y + 0.62, p.z + uz * d + ux * side), 0.055, 0.055, pole);
      }
      for (const d of [-0.75, -0.3, 0.15, 0.6]) stick(V(p.x + ux * d - uz * 0.4, y + 0.17, p.z + uz * d + ux * 0.4), V(p.x + ux * d + uz * 0.4, y + 0.17, p.z + uz * d - ux * 0.4), 0.06, 0.09, tone(pole, 0.9));
      for (let k = 0; k < 4; k++) stick(V(p.x - ux * 0.7 + uz * (k * 0.17 - 0.26), y + 0.3, p.z - uz * 0.7 - ux * (k * 0.17 - 0.26)), V(p.x + ux * 0.5 + uz * (k * 0.17 - 0.26), y + 0.3, p.z + uz * 0.5 - ux * (k * 0.17 - 0.26)), 0.15, 0.15, tone(log, rng.range(0.8, 1.15)), 'bark');
    } else {
      // The burners' own fire: a ring of stones, ash, and a pot hung from three poles over it.
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, w = rng.range(0.1, 0.15); block('rock', V(p.x + Math.cos(a) * 0.5 - w, y - 0.05, p.z + Math.sin(a) * 0.5 - w), V(p.x + Math.cos(a) * 0.5 + w, y + rng.range(0.12, 0.2), p.z + Math.sin(a) * 0.5 + w), tone([0.32, 0.31, 0.3], rng.range(0.8, 1.1))); }
      turned('scree', p.x, y, p.z, [[0.42, -0.04], [0.28, 0.09], [0, 0.11]], { follow: true, segments: 10, colour: (a, hh) => tone([0.2, 0.2, 0.2], 0.4 + 0.9 * fbm2(a * 4, hh * 30, 2)) });
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; stick(V(p.x + Math.cos(a) * 0.75, y, p.z + Math.sin(a) * 0.75), V(p.x - Math.cos(a) * 0.06, y + 1.5, p.z - Math.sin(a) * 0.06), 0.05, 0.05, pole); }
      turned('metal', p.x, y + 0.5, p.z, [[0.1, 0], [0.18, 0.08], [0.19, 0.22], [0.16, 0.26], [0, 0.2]], { segments: 10, colour: () => [0.035, 0.035, 0.04] });
      stick(V(p.x, y + 0.74, p.z), V(p.x, y + 1.42, p.z), 0.02, 0.02, [0.05, 0.05, 0.05], 'metal');
      // And it is alight: brands laid across one another on the ash, burning.
      for (let k = 0; k < 4; k++) { const a = k * 0.8 + 0.3; stick(V(p.x - Math.cos(a) * 0.36, ground(p.x, p.z) + 0.1, p.z - Math.sin(a) * 0.36), V(p.x + Math.cos(a) * 0.36, ground(p.x, p.z) + 0.16 + k * 0.03, p.z + Math.sin(a) * 0.36), 0.08, 0.08, [0.05, 0.035, 0.03], 'bark'); }
      fires.push(V(p.x, ground(p.x, p.z) + 0.16, p.z));
    }
  }

  // ---- stumps, where the clearing was cut, and a few felled lengths not yet carried in
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rng.range(-0.15, 0.15), d = camp.r * rng.range(0.98, 1.2), x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d, r = rng.range(0.17, 0.33), tall = rng.range(0.22, 0.5);
    if (wayIn && Math.hypot(x - wayIn[0], z - wayIn[1]) < 2.6) continue;
    if (camp.stacks.some((st) => Math.hypot(x - st.x, z - st.z) < st.length / 2 + 0.9) || Math.hypot(x - camp.hut.x, z - camp.hut.z) < camp.hut.r + 0.8) continue;
    const s = rng.range(0, 30);
    turned('bark', x, ground(x, z), z, [[r * 1.35, -0.3], [r * 1.25, 0], [r, tall * 0.5], [r * 0.96, tall], [0, tall + 0.02]], { segments: 10, swell: (ang) => 1 + 0.12 * Math.sin(ang * 3 + s), colour: (_a, _h, t) => (t > 0.97 ? tone(pale, 0.9) : tone(log, 0.8)) });
    if (k % 5 === 2) { const t = a + 1.3, len = rng.range(1.4, 2.4), y = ground(x, z) + 0.13; stick(V(x + Math.cos(t) * 0.6, y, z + Math.sin(t) * 0.6), V(x + Math.cos(t) * (0.6 + len), ground(x + Math.cos(t) * (0.6 + len), z + Math.sin(t) * (0.6 + len)) + 0.13, z + Math.sin(t) * (0.6 + len)), 0.24, 0.24, tone(log, 0.9), 'bark'); }
  }
  return { smokes, finds, fires };
}
