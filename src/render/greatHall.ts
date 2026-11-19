import { fbm3 } from '../core/rng';
import type { Mountain } from '../core/site';

/**
 * A great hall cut in the rock (`Mountain['hall']`; a town's hills may have one too): its own measures and the air of it, as a
 * function of a point that is more than nothing inside the hall and less outside, for carving. The hall's frame runs `u` in from
 * the window end along its middle line and `v` across it.
 */
export type GreatHall = NonNullable<Mountain['hall']>;

export function hallGeometry(H: GreatHall) {
  const hallFrame = (() => {
    const [ox, oz] = H.out, dx = H.in[0] - ox, dz = H.in[1] - oz, L = Math.hypot(dx, dz) || 1;
    return { ox, oz, ux: dx / L, uz: dz / L, L, half: H.wide / 2, wall: H.high - H.wide / 2 };
  })();
  const hallPillars: [number, number][] = [];
  for (let u = 8; u < hallFrame.L - 5; u += 9) {
    if (Math.abs(u - H.chasm.at) < H.chasm.width / 2 + 3) continue;
    for (const v of [-hallFrame.half * 0.6, hallFrame.half * 0.6]) hallPillars.push([u, v]);
  }
  /** Where a point is in the hall's own measures: `u` in from the window end along its middle, `v` across it. */
  const inHall = (x: number, z: number) => { const f = hallFrame, dx = x - f.ox, dz = z - f.oz; return { u: dx * f.ux + dz * f.uz, v: -dx * f.uz + dz * f.ux }; };
  const hallAir = (x: number, y: number, z: number): number => {
    const f = hallFrame, { u, v } = inHall(x, z), fl = H.floor, C = H.chasm, av = Math.abs(v);
    if (u < -26 || u > f.L + 3 || av > f.half + 21 || y < fl - C.depth - 2) return -9;
    // (Shafts of daylight are open to the sky above; everything else ends under the vault.)
    if (y > fl + H.high + 2 && !H.sides.some((sh) => sh.shaft)) return -9;
    const rough = (fbm3(x * 0.4, y * 0.4, z * 0.4, 2) - 0.5) * 0.6;
    let air = -9;
    // The great hall: walls rising thirteen metres, then the vault; its pillars, swelling at the foot and at the head.
    if (u > -0.5 && av < f.half + 2 && y < fl + H.high + 2) {
      const ceil = fl + f.wall + Math.sqrt(Math.max(0, f.half * f.half - v * v));
      air = Math.min(f.half - av + rough, y - fl, ceil - y + rough, f.L - u + rough);
      const swell = 0.55 * Math.max(0, 1 - (y - fl) / 1.1) + 0.6 * Math.max(0, 1 - (fl + f.wall - y) / 1.6);
      for (const [pu, pv] of hallPillars) air = Math.min(air, Math.hypot(u - pu, v - pv) - 1.75 - swell + rough * 0.3);
      // (A lip of rock along both edges of the chasm, a metre high, except where the bridge goes over.)
      const fromChasm = Math.abs(u - C.at) - C.width / 2;
      if (fromChasm > -0.05 && fromChasm < 0.5 && av > 2.05) air = Math.min(air, y - (fl + 0.95));
    }
    // The chasm, from wall to wall and on into the rock as a cleft; and the bridge over it, arched beneath, with a parapet each side.
    if (Math.abs(u - C.at) < C.width / 2 + 1 && av < f.half + 5) {
      const top = av < f.half ? fl + H.high : fl + 2.5;
      let chasm = Math.min(C.width / 2 - Math.abs(u - C.at) + rough * 0.7, y - (fl - C.depth), top - y, f.half + 4 - av + rough);
      if (av < 2.05) {
        const t = (u - C.at) / (C.width / 2), under = fl - 1.3 - 2.4 * Math.max(0, 1 - t * t);
        chasm = Math.min(chasm, Math.max(under - y, y - (av > 1.6 ? fl + 0.95 : fl)));
      }
      air = Math.max(air, chasm);
    }
    // The windows: three tall arches out through the face, a sill a metre high past the first stride.
    if (u < 2) for (const wv of H.windows) {
      const dv = Math.abs(v - wv), top = fl + 12.5 + Math.sqrt(Math.max(0, 1.8 * 1.8 - dv * dv)) * 1.3;
      air = Math.max(air, Math.min(1.8 - dv + rough * 0.4, y - (u < -1.5 ? fl + 1.0 : fl), top - y + rough * 0.4, u + 25));
    }
    // The gallery, cut into one long wall eleven metres up, opening on the hall through an arcade with a sill; and the stair to it,
    // which climbs inside the wall behind the gallery from a doorway at the hall's near end.
    {
      const gs = H.gallery.side, d = v * gs - f.half, GF = fl + 11, sNear = f.L - 3, sFar = f.L - 27;
      if (d > -1.5 && d < 8 && y > fl - 0.5 && y < GF + 6) {
        let gal = -9;
        if (u > 6 && u < f.L - 6) {
          const ceil = GF + 3.6 + Math.sqrt(Math.max(0, 1.5 * 1.5 - (d - 2.3) * (d - 2.3))) * 0.6;
          gal = Math.min(1.5 - Math.abs(d - 2.3) + rough * 0.4, y - GF, ceil - y + rough * 0.4, u - 6, f.L - 6 - u);
          // (The arcade: an arch every four and a half metres through the wall between, from a metre over the gallery's floor.)
          const k = (u - 6) % 4.5, arch = Math.min(k - 0.9, 3.6 - k);
          if (arch > -0.6) gal = Math.max(gal, Math.min(arch + rough * 0.3, y - (GF + 1.0), GF + 3.9 + Math.sqrt(Math.max(0, 1.35 * 1.35 - (k - 2.25) * (k - 2.25))) - y, 1.2 - d));
        }
        // The doorway from the hall, and the stair climbing away from it towards the windows, then into the gallery's end.
        // (The doorway ends where the stair begins, so that the stair's first tread is the first step up: centred on the stair's foot,
        // its floor stayed at the hall's while the stair's rose beside it, and left a step of more than half a metre.)
        const door = Math.min(1.3 - Math.abs(u - (sNear + 1.3)), d + 1, 7.4 - d, y - fl, fl + 3.1 - y);
        const t = Math.min(1, Math.max(0, (sNear - u) / (sNear - sFar))), sf = fl + (GF - fl) * t;
        const stair = Math.min(1.35 - Math.abs(d - 6) + rough * 0.3, u - (sFar - 1.4), sNear + 1.3 - u, y - sf, sf + 3.0 - y);
        const into = Math.min(1.3 - Math.abs(u - (sFar - 0.2)), d - 1.4, 7.0 - d, y - GF, GF + 3.0 - y);
        air = Math.max(air, gal, door, stair, into);
      }
    }
    // The side halls, each through an arch in the great hall's wall; and a shaft of daylight down into one.
    for (const sh of H.sides) {
      const d = v * sh.side - f.half, e = u - sh.at, hw = sh.wide / 2;
      if (d < -2 || d > sh.long + 2 || Math.abs(e) > hw + 2) continue;
      const ceil = fl + 6.2 + Math.sqrt(Math.max(0, hw * hw - e * e)) * 0.5;
      let side = Math.min(hw - Math.abs(e) + rough, y - fl, ceil - y + rough, sh.long - d + rough, d + 1.5);
      if (d < 1.8) side = Math.min(side, 2.6 - Math.abs(e) + rough * 0.4, fl + 6.2 + Math.sqrt(Math.max(0, 2.6 * 2.6 - e * e)) - y);
      air = Math.max(air, side);
      if (sh.shaft) {
        const r = Math.hypot(d - sh.long / 2, e);
        air = Math.max(air, Math.min(sh.shaft - r + rough * 0.5, y - (fl + 6)));
      }
    }
    return air;
  };
  return { frame: hallFrame, pillars: hallPillars, inHall, air: hallAir };
}
