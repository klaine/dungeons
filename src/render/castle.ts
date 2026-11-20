import type { Castle, CastleTower } from '../core/castle';
import { MeshBuilder } from './geom/meshBuilder';

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

  /**
   * One flat face through its corners, facing away from `inside`. Its texture is laid along it: across a face that stands up, from
   * where along the wall it is (`u`, if given for each corner, else along the face's own line) and how high; on one that lies flat,
   * from where it is. So courses run level and blocks keep their size at any bearing.
   */
  const face = (material: string, pts: P3[], colour: Colour, inside: P3, us?: number[]) => {
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
    const ids = order.map((k) => {
      const q = pts[k];
      const u = flat ? q[0] * 0.5 : (us ? us[k] : q[0] * ux + q[2] * uz) * 0.5, v = flat ? q[2] * 0.5 : q[1] * 0.5;
      return m.addVertex(q[0], q[1], q[2], nx, ny, nz, u, v, colour[0], colour[1], colour[2]);
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
}
