import { Vector3 } from 'three';
import type { Castle, CastleTower } from '../core/castle';
import { MeshBuilder } from './geom/meshBuilder';
import { outdoorFieldAt } from './fields';

type Colour = [number, number, number];
type P3 = [number, number, number];

export interface CastleBuild {
  c: Castle;
  mesh: (material: string) => MeshBuilder;
  ground: (x: number, z: number) => number;
  /** The bailey's level, which is the house's. */
  floor: number;
  stone: Colour;
}

/**
 * The castle about the house: its curtain wall, its towers and its gate (the keep is a tower of the old kind, built with the others).
 * Of plain solids, as the buildings standing in the valley are, drawn with coursed stone (`castle` among the materials), not laid block
 * by block as the house is: the wall in straight lengths from corner to corner of its line along the brow of the hill, at whatever
 * bearing each runs, two metres through, with a walk along its top and a parapet and merlons on its outer edge, battered out a little
 * at its foot; at some of its corners a tower, round, half round with its back flat to the bailey, or square and small, standing over
 * the walk by a few metres and roofed with a cone of slates or finished with a battlement on a corbelled course, slits in it; and the
 * gate a tower of its own over the road, the way through it under a round arch and a vault, the portcullis hanging in its outer arch
 * half raised.
 */
export function buildCastle(b: CastleBuild): void {
  const { c, mesh, ground, floor, stone } = b;
  const T = c.thick, top = floor + c.height, n = c.wall.length;
  const cx = c.wall.reduce((s, p) => s + p[0], 0) / n, cz = c.wall.reduce((s, p) => s + p[1], 0) / n;
  let count = 0;
  const tone = (k = 1): Colour => { const t = (0.93 + 0.14 * (((count++ * 7919) % 13) / 13)) * k; return [stone[0] * t, stone[1] * t, stone[2] * t]; };
  const slate: Colour = [0.24, 0.25, 0.29], dark: Colour = [0.04, 0.04, 0.045], iron: Colour = [0.13, 0.12, 0.11];
  const P = new Vector3(), N = new Vector3(), F = new Float32Array(4);
  // (The ground at a point's foot, kept on a lattice of a metre: asked for at every corner of every stone of the wall.)
  const feet = new Map<number, number>();
  const footOf = (x: number, z: number) => { const k = Math.round(x) * 100003 + Math.round(z); let y = feet.get(k); if (y === undefined) { y = ground(Math.round(x), Math.round(z)); feet.set(k, y); } return y; };

  /**
   * One flat face through its corners, facing away from `inside`. Its texture is laid along it: across a face that stands up, from
   * where along the wall it is (`u`, if given for each corner, else along the face's own line) and how high; on one that lies flat,
   * from where it is. So courses run level and blocks keep their size at any bearing.
   */
  const face = (material: string, pts: P3[], colour: Colour, inside: P3, us?: number[], cell = false): void => {
    // (A large face that stands up, a length of the curtain or a tower's side, is cut into cells of a metre and a half or so, so that its
    // weathering, which is reckoned at its corners, varies over it: moss and damp at its foot here and not there, a darker patch, a
    // lighter one. Reckoned only at its four corners, a length of wall was one smooth wash from end to end.)
    if (!cell && pts.length === 4 && !us) {
      const [a, b, c2, d] = pts, wide = Math.hypot(b[0] - a[0], b[2] - a[2]), high = Math.max(Math.abs(d[1] - a[1]), Math.abs(c2[1] - b[1]));
      const level = Math.abs(a[1] - b[1]) < 0.01 && Math.abs(c2[1] - d[1]) < 0.01 && Math.hypot(d[0] - a[0], d[2] - a[2]) < 0.01;
      if (level && wide * high > 6) {
        const nu = Math.max(1, Math.round(wide / 1.6)), nv = Math.max(1, Math.round(high / 1.6));
        const at = (i: number, j: number): P3 => { const f = i / nu, g = j / nv, lo: P3 = [a[0] + (b[0] - a[0]) * f, a[1], a[2] + (b[2] - a[2]) * f]; return [lo[0], a[1] + (d[1] - a[1]) * g, lo[2]]; };
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) face(material, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], colour, inside, undefined, true);
        return;
      }
    }
    const m = mesh(material);
    const [p0, p1, p2] = pts;
    let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
    let ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    let nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mid = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
    const flip = (mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz < 0;
    const order = pts.map((_, k) => k);
    if (flip) { order.reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const flat = Math.abs(ny) > 0.8, hl = Math.hypot(nx, nz) || 1, ux = nz / hl, uz = -nx / hl;
    N.set(nx, ny, nz);
    const ids = order.map((k) => {
      const q = pts[k];
      const u = flat ? q[0] * 0.5 : (us ? us[k] : q[0] * ux + q[2] * uz) * 0.5, v = flat ? q[2] * 0.5 : q[1] * 0.5;
      // Weathered as the walls of the houses are: moss low on a wall and on what lies level, damp, and a tone that varies over the
      // wall (`outdoorFieldAt`, from the ground at its foot); and a face that stands up says how high that ground is, so that the
      // material raises damp in it to a ragged line, splashes its foot with dirt and runs rain down it in streaks. (Without, it was
      // all of one clean grey from its foot to its battlements, as if built that morning.)
      const foot = flat ? Math.min(q[1], floor) : Math.min(q[1], footOf(q[0], q[2]));
      const t = outdoorFieldAt(foot, 1.25)(P.set(q[0], q[1], q[2]), N, F);
      return m.addVertex(q[0], q[1], q[2], nx, ny, nz, u, v, colour[0] * t, colour[1] * t, colour[2] * t, F[0], F[1], F[2], flat || ny < -0.5 ? 0 : 1000 + foot);
    });
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
  };
  /** A closed solid on a ring of corners (`ring`, round in order), from `y0` to `y1`; narrowing to `narrow` times as broad at its top. */
  const prism = (material: string, ring: [number, number][], y0: number, y1: number, colour: Colour, narrow = 1, us?: number[]) => {
    const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length, mz = ring.reduce((s, p) => s + p[1], 0) / ring.length, mid: P3 = [mx, (y0 + y1) / 2, mz];
    const lo = ring.map(([x, z]) => [x, y0, z] as P3), hi = ring.map(([x, z]) => [mx + (x - mx) * narrow, y1, mz + (z - mz) * narrow] as P3);
    for (let k = 0; k < ring.length; k++) {
      const j = (k + 1) % ring.length;
      face(material, [lo[k], lo[j], hi[j], hi[k]], colour, mid, us ? [us[k], us[k + 1] ?? us[j], us[k + 1] ?? us[j], us[k]] : undefined);
    }
    face(material, hi, colour, mid);
    face(material, lo, colour, mid);
  };
  /** A block along a line: from `a` to `b` on the ground plan, `w0` to `w1` out from it along (`ox`, `oz`), `y0` to `y1` high. */
  const along = (material: string, ax: number, az: number, bx: number, bz: number, ox: number, oz: number, w0: number, w1: number, y0: number, y1: number, colour: Colour) => {
    prism(material, [[ax + ox * w0, az + oz * w0], [bx + ox * w0, bz + oz * w0], [bx + ox * w1, bz + oz * w1], [ax + ox * w1, az + oz * w1]], y0, y1, colour);
  };
  /** A parapet with merlons along a line, its outer face on the line and `t` thick inward along (`ix`, `iz`), standing on `y`. */
  const battlement = (ax: number, az: number, bx: number, bz: number, ix: number, iz: number, y: number, t = 0.5) => {
    along('castle', ax, az, bx, bz, ix, iz, 0, t, y, y + 1.0, tone());
    const len = Math.hypot(bx - ax, bz - az), teeth = Math.max(1, Math.round(len / 1.8));
    for (let m = 0; m < teeth; m++) {
      const f0 = (m + 0.2) / teeth, f1 = (m + 0.72) / teeth;
      along('castle', ax + (bx - ax) * f0, az + (bz - az) * f0, ax + (bx - ax) * f1, az + (bz - az) * f1, ix, iz, 0, t, y + 1.0, y + 1.65, tone(1.04));
    }
  };
  const towerAt = (x: number, z: number) => c.towers.find((t) => Math.hypot(t.x - x, t.z - z) < 0.5);
  const lowest = (pts: [number, number][], sink: number) => Math.min(...pts.map(([x, z]) => ground(x, z))) - sink;

  // ---- the curtain wall, a length at a time
  const G = 3.0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = c.wall[i], [bx, bz] = c.wall[(i + 1) % n], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    let ox = dz, oz = -dx;
    if (ox * ((ax + bx) / 2 - cx) + oz * ((az + bz) / 2 - cz) < 0) { ox = -ox; oz = -oz; }
    const tA = towerAt(ax, az), tB = towerAt(bx, bz);
    let runs: [number, number][] = [[tA ? tA.r * 0.55 : -T / 2, len - (tB ? tB.r * 0.55 : -T / 2)]];
    const ug = (c.gate.x - ax) * dx + (c.gate.z - az) * dz, off = Math.abs((c.gate.x - ax) * dz - (c.gate.z - az) * dx);
    if (off < 0.6 && ug > 0 && ug < len) runs = runs.flatMap(([u0, u1]) => [[u0, ug - G + 0.2], [ug + G - 0.2, u1]] as [number, number][]);
    for (const [r0, r1] of runs) {
      if (r1 - r0 < 0.3) continue;
      const pieces = Math.max(1, Math.round((r1 - r0) / 9));
      for (let k = 0; k < pieces; k++) {
        const u0 = r0 + ((r1 - r0) * k) / pieces, u1 = r0 + ((r1 - r0) * (k + 1)) / pieces;
        const P = (u: number): [number, number] => [ax + dx * u, az + dz * u];
        const [p0x, p0z] = P(u0), [p1x, p1z] = P(u1);
        const foot = lowest([[p0x + ox * (T / 2 + 1.5), p0z + oz * (T / 2 + 1.5)], [(p0x + p1x) / 2 + ox * (T / 2 + 1.5), (p0z + p1z) / 2 + oz * (T / 2 + 1.5)], [p1x + ox * (T / 2 + 1.5), p1z + oz * (T / 2 + 1.5)]], 1.2);
        // The wall, and a batter at its outer foot, as a wall on a slope is thickened where it meets the ground.
        along('castle', p0x, p0z, p1x, p1z, ox, oz, -T / 2, T / 2, foot, top, tone());
        prism('castle', [[p0x + ox * T / 2, p0z + oz * T / 2], [p1x + ox * T / 2, p1z + oz * T / 2], [p1x + ox * (T / 2 + 0.7), p1z + oz * (T / 2 + 0.7)], [p0x + ox * (T / 2 + 0.7), p0z + oz * (T / 2 + 0.7)]], foot, floor + 0.6, tone(0.95));
        battlement(p0x + ox * T / 2, p0z + oz * T / 2, p1x + ox * T / 2, p1z + oz * T / 2, -ox, -oz, top);
        // Put-log holes in both faces, where the builders' scaffold was carried: rows of small square sockets a metre and a third apart,
        // two strides or so along, not every one of them there, nor all quite in line. Most were stopped with a stone when the scaffold
        // came down: a row here and there shows, and few of its holes; and a length rebuilt or refaced shows none.
        // (Every row, a hole in two of every three, was a grid of black squares over every wall, and the eye read the grid as a pattern.)
        const lenP = Math.hypot(p1x - p0x, p1z - p0z);
        const rnd = (s: number) => { const h = Math.sin(s * 12.9898 + i * 37.7 + k * 11.1) * 43758.5453; return h - Math.floor(h); };
        for (const side of [1, -1]) {
          if (rnd(side * 5.1) < 0.3) continue;
          const lift = rnd(side * 7.3) * 1.33, step = 1.7 + rnd(side * 9.9) * 0.7;
          for (let y = floor + 1.5 + lift; y < top - 1.2; y += 1.33) {
            if (rnd(y * 3.7 + side) < 0.45) continue;
            for (let u = 0.6 + rnd(y + side * 2.2) * step; u < lenP - 0.6; u += step) {
              const h = Math.sin(u * 12.9898 + y * 78.233 + i * 37.7 + k * 11.1 + side * 3.3) * 43758.5453, r1 = h - Math.floor(h);
              if (r1 < 0.55) continue;
              const f = u / lenP, bx2 = p0x + (p1x - p0x) * f, bz2 = p0z + (p1z - p0z) * f, yy = y + (r1 - 0.5) * 0.14, s2 = 0.07 + (r1 - 0.55) * 0.07;
              const fx = ox * side, fz = oz * side, wx = bx2 + fx * (T / 2 + 0.012), wz = bz2 + fz * (T / 2 + 0.012), ax2 = -fz, az2 = fx;
              face('metal', [[wx - ax2 * s2, yy - s2, wz - az2 * s2], [wx + ax2 * s2, yy - s2, wz + az2 * s2], [wx + ax2 * s2, yy + s2, wz + az2 * s2], [wx - ax2 * s2, yy + s2, wz - az2 * s2]], dark, [bx2, yy, bz2]);
            }
          }
        }
      }
    }
  }

  // ---- the towers at the corners
  for (const t of c.towers) wallTower(t);
  function wallTower(t: CastleTower) {
    const tt = top + t.over, ox = Math.cos(t.out), oz = Math.sin(t.out), r = t.r;
    const foot = lowest(Array.from({ length: 8 }, (_, k) => [t.x + Math.cos((k / 8) * Math.PI * 2) * (r + 1), t.z + Math.sin((k / 8) * Math.PI * 2) * (r + 1)] as [number, number]), 1.4);
    if (t.kind === 'square') {
      const ux = -oz, uz = ox, at = (a: number, d: number): [number, number] => [t.x + ux * a * r + ox * d * r, t.z + uz * a * r + oz * d * r];
      const ring = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
      prism('castle', ring, foot, tt, tone());
      if (t.roof === 'cone') {
        const eave = ring.map(([x, z]) => [t.x + (x - t.x) * 1.15, tt, t.z + (z - t.z) * 1.15] as P3), apex: P3 = [t.x, tt + r * 2.3, t.z];
        for (let k = 0; k < 4; k++) face('tile', [eave[k], eave[(k + 1) % 4], apex], slate, [t.x, tt, t.z]);
        face('tile', eave, slate, apex);
      } else {
        const ring2 = [at(-1.1, -1.1), at(1.1, -1.1), at(1.1, 1.1), at(-1.1, 1.1)];
        prism('castle', ring2, tt - 0.5, tt, tone(1.03));
        for (let k = 0; k < 4; k++) { const [px, pz] = ring2[k], [qx, qz] = ring2[(k + 1) % 4], mx = t.x - (px + qx) / 2, mz = t.z - (pz + qz) / 2, ml = Math.hypot(mx, mz) || 1; battlement(px, pz, qx, qz, mx / ml, mz / ml, tt, 0.45); }
      }
      for (const y of [floor + 2.2, floor + 5.4]) slit(t.x + ox * r, t.z + oz * r, ox, oz, y);
      return;
    }
    // Round, or half round with its back to the bailey: sixteen faces round, its texture laid round it by the length of its arc.
    const half = t.kind === 'half', a0 = half ? t.out - 1.8 : 0, a1 = half ? t.out + 1.8 : Math.PI * 2, sides = half ? 10 : 18;
    const arc = Array.from({ length: half ? sides + 1 : sides }, (_, k) => a0 + ((a1 - a0) * k) / sides);
    const ring = arc.map((a) => [t.x + Math.cos(a) * r, t.z + Math.sin(a) * r] as [number, number]);
    prism('castle', ring, foot, tt, tone(), 1, [...arc.map((a) => (a - a0) * r), (a1 - a0) * r]);
    if (t.roof === 'cone') {
      const eave = arc.map((a) => [t.x + Math.cos(a) * r * 1.14, tt, t.z + Math.sin(a) * r * 1.14] as P3), apex: P3 = [t.x, tt + r * 2.4, t.z];
      for (let k = 0; k < eave.length - (half ? 1 : 0); k++) face('tile', [eave[k], eave[(k + 1) % eave.length], apex], slate, [t.x, tt, t.z]);
      face('tile', eave, slate, apex);
      // (A half tower's roof is closed at its back with a gable of stone.)
      if (half) face('castle', [eave[0], eave[eave.length - 1], apex], tone(), [t.x + ox, tt, t.z + oz]);
    } else {
      // A corbelled course standing out round its top, and the battlement on that.
      const out = arc.map((a) => [t.x + Math.cos(a) * (r + 0.3), t.z + Math.sin(a) * (r + 0.3)] as [number, number]);
      prism('castle', out, tt - 0.6, tt, tone(1.03));
      for (let k = 0; k < out.length - (half ? 1 : 0); k++) {
        const [px, pz] = out[k], [qx, qz] = out[(k + 1) % out.length], mx = t.x - (px + qx) / 2, mz = t.z - (pz + qz) / 2, ml = Math.hypot(mx, mz) || 1;
        battlement(px, pz, qx, qz, mx / ml, mz / ml, tt, 0.42);
      }
    }
    for (const [da, y] of [[0.5, floor + 2.4], [-0.5, floor + 5.2], [0, top + Math.max(1, t.over - 1.8)]] as [number, number][]) {
      const a = t.out + da;
      slit(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, Math.cos(a), Math.sin(a), y);
    }
  }
  /** An arrow slit: a dark cut, a hand broad and a stride high, on a face looking along (`nx`, `nz`). */
  function slit(x: number, z: number, nx: number, nz: number, y: number) {
    const ux = -nz, uz = nx, w = 0.09;
    prism('stone', [[x + ux * -w - nx * 0.04, z + uz * -w - nz * 0.04], [x + ux * w - nx * 0.04, z + uz * w - nz * 0.04], [x + ux * w + nx * 0.03, z + uz * w + nz * 0.03], [x + ux * -w + nx * 0.03, z + uz * -w + nz * 0.03]], y, y + 1.1, dark);
  }

  // ---- the gate: a tower over the road, the way through it under a round arch at either face and a vault between
  {
    const g = c.gate, ox = Math.cos(g.out), oz = Math.sin(g.out), ux = -oz, uz = ox, D = T + 2.4, half = g.w / 2, spring = floor + 3.0, crown = spring + half, tt = top + 4.2;
    const P = (a: number, d: number): [number, number] => [g.x + ux * a + ox * d, g.z + uz * a + oz * d];
    const Q = (a: number, d: number, y: number): P3 => { const [x, z] = P(a, d); return [x, y, z]; };
    const foot = lowest([P(-G, D / 2 + 1), P(G, D / 2 + 1), P(0, D / 2 + 2)], 1.2);
    // Its two sides, either hand of the way, from the ground to the top; over the way, from the arch's crown to the top.
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? -G : half, a1 = s < 0 ? -half : G;
      prism('castle', [P(a0, -D / 2), P(a1, -D / 2), P(a1, D / 2), P(a0, D / 2)], foot, tt, tone());
    }
    prism('castle', [P(-half, -D / 2), P(half, -D / 2), P(half, D / 2), P(-half, D / 2)], crown, tt, tone());
    // The arch at either face: the spandrels between the round of the arch and its square head, and the vault through.
    const N = 10, round = Array.from({ length: N + 1 }, (_, k) => { const a = Math.PI - (Math.PI * k) / N; return [Math.cos(a) * half, spring + Math.sin(a) * half] as [number, number]; });
    for (const d of [-D / 2, D / 2]) {
      const inside: P3 = Q(0, -d * 2, spring);
      for (let k = 0; k < N; k++) {
        const [a0, y0] = round[k], [a1, y1] = round[k + 1], corner = a0 + a1 < 0 ? -half : half;
        face('castle', [Q(a0, d, y0), Q(a1, d, y1), Q(corner, d, crown)], tone(), inside);
      }
    }
    for (let k = 0; k < N; k++) {
      const [a0, y0] = round[k], [a1, y1] = round[k + 1];
      face('castle', [Q(a0, -D / 2, y0), Q(a1, -D / 2, y1), Q(a1, D / 2, y1), Q(a0, D / 2, y0)], tone(0.85), Q(0, 0, spring - 2));
    }
    // A band of dressed stone round the arch's face, outside.
    for (let k = 0; k < N; k++) {
      const [a0, y0] = round[k], [a1, y1] = round[k + 1], s0 = Math.hypot(a0, y0 - spring) || 1, s1 = Math.hypot(a1, y1 - spring) || 1, w = 0.32;
      const o0: [number, number] = [a0 + (a0 / s0) * w, y0 + ((y0 - spring) / s0) * w], o1: [number, number] = [a1 + (a1 / s1) * w, y1 + ((y1 - spring) / s1) * w];
      face('stone', [Q(a0, D / 2 + 0.06, y0), Q(a1, D / 2 + 0.06, y1), Q(o1[0], D / 2 + 0.06, o1[1]), Q(o0[0], D / 2 + 0.06, o0[1])], tone(1.1), Q(0, 0, spring));
    }
    // Its top: a battlement on a corbelled course, round a flagged roof.
    const ring = [P(-G - 0.3, -D / 2 - 0.3), P(G + 0.3, -D / 2 - 0.3), P(G + 0.3, D / 2 + 0.3), P(-G - 0.3, D / 2 + 0.3)];
    prism('castle', ring, tt - 0.6, tt, tone(1.03));
    for (let k = 0; k < 4; k++) {
      const [px, pz] = ring[k], [qx, qz] = ring[(k + 1) % 4], mx = g.x - (px + qx) / 2, mz = g.z - (pz + qz) / 2, ml = Math.hypot(mx, mz) || 1;
      battlement(px, pz, qx, qz, mx / ml, mz / ml, tt, 0.45);
    }
    // The portcullis in the outer arch, half raised: its bars and rails of iron.
    const iron3 = (a0: number, a1: number, d0: number, d1: number, y0: number, y1: number) => prism('metal', [P(a0, d0), P(a1, d0), P(a1, d1), P(a0, d1)], y0, y1, iron);
    for (let a = -half + 0.25; a < half - 0.1; a += 0.4) iron3(a - 0.045, a + 0.045, D / 2 - 0.41, D / 2 - 0.29, spring - 0.9, spring + Math.sqrt(Math.max(0, half * half - a * a)) - 0.05);
    for (const y of [spring - 0.7, spring - 0.2]) iron3(-half + 0.1, half - 0.1, D / 2 - 0.42, D / 2 - 0.28, y - 0.045, y + 0.045);
    // Slits either side of the arch, over it.
    for (const a of [-G * 0.62, G * 0.62]) { const [x, z] = P(a, D / 2); slit(x, z, ox, oz, crown + 0.8); }
  }

  // ---- the bailey: ranges against the curtain, the stair up to the walk, the well, and what lies about
  const wood: Colour = [0.3, 0.21, 0.14], oak: Colour = [0.36, 0.26, 0.17], roofRed: Colour = [1.1, 1.02, 0.96];
  /** From a point on the curtain's inner face and a direction along it, the way into the bailey. */
  const inward = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az) || 1, dx = (bx - ax) / len, dz = (bz - az) / len;
    let ix = -dz, iz = dx;
    if (ix * (cx - (ax + bx) / 2) + iz * (cz - (az + bz) / 2) < 0) { ix = -ix; iz = -iz; }
    return { len, dx, dz, ix, iz };
  };
  /** A dark opening in a wall that faces (`fx`, `fz`): a door or a window, `u0` to `u1` along it from (`x0`, `z0`), `y0` to `y1` high. */
  const opening = (x0: number, z0: number, dx: number, dz: number, fx: number, fz: number, u0: number, u1: number, y0: number, y1: number, door: boolean) => {
    const at = (u: number, t: number): [number, number] => [x0 + dx * u + fx * t, z0 + dz * u + fz * t];
    const [ax, az] = at(u0, 0.02), [bx, bz] = at(u1, 0.02), inside: P3 = [x0 - fx, y0, z0 - fz];
    face(door ? 'wood' : 'metal', [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], door ? oak : dark, inside);
    // (A frame of oak round it, a hand broad and standing out a little.)
    for (const [p0, p1] of [[u0 - 0.12, u0], [u1, u1 + 0.12]]) prism('wood', [at(p0, -0.02), at(p1, -0.02), at(p1, 0.08), at(p0, 0.08)], y0, y1 + 0.1, wood);
    prism('wood', [at(u0 - 0.12, -0.02), at(u1 + 0.12, -0.02), at(u1 + 0.12, 0.08), at(u0 - 0.12, 0.08)], y1, y1 + 0.14, wood);
  };
  // The ranges: lean-to buildings against the curtain, stone walls, a single slope of tiles falling from the curtain to the front.
  for (const [k, r] of (c.ranges ?? []).entries()) {
    const { len, dx, dz, ix, iz } = inward(r.a[0], r.a[1], r.b[0], r.b[1]), D = r.depth, fh = r.height, bh = fh + D * 0.45;
    const at = (u: number, d: number): [number, number] => [r.a[0] + dx * u + ix * d, r.a[1] + dz * u + iz * d];
    const y0 = floor - 0.4, base = floor;
    // Its front wall and its two ends, half a metre thick; the ends rise with the roof towards the curtain.
    prism('castle', [at(0, D - 0.5), at(len, D - 0.5), at(len, D), at(0, D)], y0, base + fh, tone(0.97));
    for (const u of [0, len - 0.5]) {
      prism('castle', [at(u, 0), at(u + 0.5, 0), at(u + 0.5, D - 0.5), at(u, D - 0.5)], y0, base + fh, tone(0.97));
      const [p0x, p0z] = at(u, 0), [p1x, p1z] = at(u, D), [q0x, q0z] = at(u + 0.5, 0), [q1x, q1z] = at(u + 0.5, D);
      const mid: P3 = [(p0x + q1x) / 2, base + fh, (p0z + q1z) / 2];
      for (const [ax2, az2, bx2, bz2] of [[p0x, p0z, p1x, p1z], [q0x, q0z, q1x, q1z]]) face('castle', [[ax2, base + fh, az2], [bx2, base + fh, bz2], [ax2, base + bh, az2]], tone(0.97), [mid[0] + (ax2 === p0x ? 1 : -1) * dx * 3, mid[1], mid[2] + (ax2 === p0x ? 1 : -1) * dz * 3]);
      face('castle', [[p0x, base + bh, p0z], [p1x, base + fh, p1z], [q1x, base + fh, q1z], [q0x, base + bh, q0z]], tone(0.97), [mid[0], base, mid[2]]);
    }
    // The roof: a slope of tiles a quarter of a metre thick, out over the front by half a metre.
    const e0 = at(-0.3, -0.05), e1 = at(len + 0.3, -0.05), f0 = at(-0.3, D + 0.5), f1 = at(len + 0.3, D + 0.5);
    const yb = base + bh + 0.12, yf = base + fh - 0.12;
    const topQ: P3[] = [[e0[0], yb, e0[1]], [e1[0], yb, e1[1]], [f1[0], yf, f1[1]], [f0[0], yf, f0[1]]];
    const low: P3[] = topQ.map(([x, y, z]) => [x, y - 0.22, z]);
    const centre: P3 = [(e0[0] + f1[0]) / 2, (yb + yf) / 2 - 2, (e0[1] + f1[1]) / 2];
    face('tile', topQ, k % 2 ? [0.42, 0.44, 0.5] : roofRed, centre);
    face('wood', low, wood, [centre[0], centre[1] + 4, centre[2]]);
    for (let j = 0; j < 4; j++) { const a2 = topQ[j], b2 = topQ[(j + 1) % 4]; face('wood', [a2, b2, low[(j + 1) % 4], low[j]], wood, [centre[0], (yb + yf) / 2 - 0.11, centre[2]]); }
    // Its doors and windows in the front: a stable's broad doors, a store's narrow ones, a smithy's wide opening; small windows between.
    const [fx0, fz0] = at(0, D), wide = r.kind === 'stable' ? 1.6 : r.kind === 'smithy' ? 2.4 : 1.1, every = r.kind === 'stable' ? 3.2 : 4.2;
    for (let u = 1.2; u + wide < len - 0.8; u += every) {
      opening(fx0, fz0, dx, dz, ix, iz, u, u + wide, base, base + Math.min(fh - 0.45, r.kind === 'smithy' ? 2.4 : 2.1), true);
      if (u + wide + 1.6 < len - 0.8) opening(fx0, fz0, dx, dz, ix, iz, u + wide + 0.6, u + wide + 1.2, base + 1.3, base + 1.9, false);
    }
    // About it: barrels by its front, and wood stacked against an end.
    for (let j = 0; j < 3; j++) {
      const [bx2, bz2] = at(len * (0.25 + 0.22 * j) + (k % 2) * 0.6, D + 0.8 + 0.25 * (j % 2));
      barrel(bx2, bz2);
    }
    const [wx, wz] = at(len + 0.2, D * 0.45), sx = dx, sz = dz;
    for (let row = 0; row < 4; row++) for (let j = 0; j < 6 - row; j++) {
      const off = (j - (5 - row) / 2) * 0.24, y = base + 0.13 + row * 0.22, px = wx + ix * off + sx * 0.4, pz = wz + iz * off + sz * 0.4;
      log(px, y, pz, sx, sz, 1.1);
    }
  }
  /** A barrel standing on the ground: twelve staves round, two hoops. */
  function barrel(x: number, z: number) {
    const y = footOf(x, z), ring = Array.from({ length: 10 }, (_, i) => [x + Math.cos((i / 10) * Math.PI * 2) * 0.32, z + Math.sin((i / 10) * Math.PI * 2) * 0.32] as [number, number]);
    prism('wood', ring, y, y + 0.45, wood, 1.12);
    prism('wood', ring.map(([px, pz]) => [x + (px - x) * 1.12, z + (pz - z) * 1.12] as [number, number]), y + 0.45, y + 0.9, wood, 1 / 1.12);
    for (const h of [0.15, 0.78]) prism('metal', ring.map(([px, pz]) => [x + (px - x) * (h < 0.5 ? 1.06 : 1.06), z + (pz - z) * 1.06] as [number, number]), y + h, y + h + 0.05, iron);
  }
  /** A log lying along (`dx`, `dz`), `long` long. */
  function log(x: number, y: number, z: number, dx: number, dz: number, long: number) {
    const r = 0.11, px = -dz, pz = dx, ring: [number, number, number][] = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return [px * Math.cos(a) * r, Math.sin(a) * r, pz * Math.cos(a) * r]; });
    const end0 = ring.map(([a, b, cc]) => [x + a - dx * long / 2, y + b, z + cc - dz * long / 2] as P3), end1 = ring.map(([a, b, cc]) => [x + a + dx * long / 2, y + b, z + cc + dz * long / 2] as P3), mid: P3 = [x, y, z];
    for (let i = 0; i < 6; i++) face('wood', [end0[i], end0[(i + 1) % 6], end1[(i + 1) % 6], end1[i]], wood, mid);
    face('wood', end0, [0.55, 0.42, 0.28], mid); face('wood', end1, [0.55, 0.42, 0.28], mid);
  }
  // The stair up to the walk: steps of stone against the curtain's inner face, each a block down to the ground, so that it is solid.
  if (c.stair) {
    const st = c.stair, { len, dx, dz, ix, iz } = inward(st.a[0], st.a[1], st.b[0], st.b[1]), steps = Math.ceil((top - floor) / 0.22), rise = (top - floor) / steps, tread = len / steps;
    for (let k = 0; k < steps; k++) {
      const u0 = k * tread, u1 = (k + 1) * tread + (k === steps - 1 ? 0.05 : 0);
      const ring: [number, number][] = [[st.a[0] + dx * u0, st.a[1] + dz * u0], [st.a[0] + dx * u1, st.a[1] + dz * u1], [st.a[0] + dx * u1 + ix * st.width, st.a[1] + dz * u1 + iz * st.width], [st.a[0] + dx * u0 + ix * st.width, st.a[1] + dz * u0 + iz * st.width]];
      prism('castle', ring, Math.max(floor - 0.4, floor + k * rise - 1.6), floor + (k + 1) * rise, tone(1.02));
    }
  }
  // The well: a ring of stone a little over knee high, dark water in it, two posts of oak with a beam and a little roof of tiles.
  if (c.well) {
    const [x, z] = c.well, y = footOf(x, z), R = 1.05, ring = Array.from({ length: 14 }, (_, i) => [x + Math.cos((i / 14) * Math.PI * 2) * R, z + Math.sin((i / 14) * Math.PI * 2) * R] as [number, number]);
    prism('castle', ring, y - 0.3, y + 0.85, tone(1.04));
    face('metal', ring.map(([px, pz]) => [x + (px - x) * 0.78, y + 0.86, z + (pz - z) * 0.78] as P3), [0.02, 0.03, 0.035], [x, y, z]);
    for (const s2 of [-1, 1]) prism('wood', [[x + s2 * 0.95 - 0.07, z - 0.07], [x + s2 * 0.95 + 0.07, z - 0.07], [x + s2 * 0.95 + 0.07, z + 0.07], [x + s2 * 0.95 - 0.07, z + 0.07]], y + 0.8, y + 2.4, oak);
    prism('wood', [[x - 1.1, z - 0.06], [x + 1.1, z - 0.06], [x + 1.1, z + 0.06], [x - 1.1, z + 0.06]], y + 2.2, y + 2.32, oak);
    for (const s2 of [-1, 1]) face('tile', [[x - 1.3, y + 2.3, z], [x + 1.3, y + 2.3, z], [x + 1.3, y + 2.0, z + s2 * 0.9], [x - 1.3, y + 2.0, z + s2 * 0.9]], roofRed, [x, y, z]);
  }
}

/**
 * A bartizan: a small round turret corbelled out from the corner of a building's top, as castles' halls have them, its foot a cone
 * of corbelling under it, its shaft of coursed stone with a slit, and a pointed roof of slates. (Built of plain solids, as the castle.)
 */
export function bartizan(mesh: (material: string) => MeshBuilder, x: number, z: number, r: number, y0: number, y1: number, stone: Colour, out: number): void {
  const sides = 14, slate: Colour = [0.24, 0.25, 0.29];
  const ring = (rr: number, y: number) => Array.from({ length: sides }, (_, k) => { const a = (k / sides) * Math.PI * 2; return [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr] as P3; });
  const quad = (material: string, pts: P3[], colour: Colour, inside: P3, us?: number[]) => {
    const m = mesh(material), [p0, p1, p2] = pts;
    let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]), ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]), nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mid = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
    const order = pts.map((_, k) => k);
    if ((mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz < 0) { order.reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const ids = order.map((k) => m.addVertex(pts[k][0], pts[k][1], pts[k][2], nx, ny, nz, (us ? us[k] : pts[k][0] + pts[k][2]) * 0.5, pts[k][1] * 0.5, colour[0], colour[1], colour[2]));
    for (let k = 1; k < ids.length - 1; k++) m.addTriangle(ids[0], ids[k], ids[k + 1]);
  };
  const c: P3 = [x, (y0 + y1) / 2, z], base = y0 + 1.1;
  const foot = ring(0.35, y0), shaftLo = ring(r, base), shaftHi = ring(r, y1), eave = ring(r * 1.16, y1), apex: P3 = [x, y1 + r * 2.5, z];
  for (let k = 0; k < sides; k++) {
    const j = (k + 1) % sides, u0 = (k / sides) * Math.PI * 2 * r, u1 = ((k + 1) / sides) * Math.PI * 2 * r;
    quad('castle', [foot[k], foot[j], shaftLo[j], shaftLo[k]], stone, [x, base + 1, z]);
    quad('castle', [shaftLo[k], shaftLo[j], shaftHi[j], shaftHi[k]], stone, c, [u0, u1, u1, u0]);
    quad('tile', [eave[k], eave[j], apex], slate, [x, y1, z]);
  }
  quad('tile', eave, slate, apex);
  quad('castle', foot, stone, c);
  // A slit looking out.
  const ox = Math.cos(out), oz = Math.sin(out), ux = -oz, uz = ox, sx = x + ox * r, sz = z + oz * r, w = 0.08, ys = base + (y1 - base) * 0.35;
  const s = (a: number, d: number, y: number): P3 => [sx + ux * a + ox * d, y, sz + uz * a + oz * d];
  const dark: Colour = [0.04, 0.04, 0.045];
  for (const [p, q] of [[s(-w, 0.03, ys), s(w, 0.03, ys + 0.9)]]) quad('stone', [p, [q[0], p[1], q[2]], q, [p[0], q[1], p[2]]], dark, [x, ys, z]);
}
