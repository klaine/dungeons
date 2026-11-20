import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Atmosphere, skyParts } from './post';
import { rippleMap } from './water';
import { mirrorAs, rainRings, weatherUniforms } from './siteMaterial';
import { SeaDesc } from './scene';

/**
 * The sea round an island. It is not still water made larger: a pond is a mirror with ripples,
 * and the sea is never a mirror. Its surface is a long swell with waves on it and wavelets on
 * those, which break the sky's reflection into a field of glints; it is dark and blue-green where
 * it is deep and clear over sand where it is shallow; and where it comes in on the shore it
 * breaks white, in lines that run in towards the land, and lies against the foot of every cliff
 * and stack in a fringe of foam.
 *
 * It is one sheet in rings about the island, out to the edge of what the eye is let see, fine
 * near the island and coarser beyond. Each point of it knows how deep the water is under it,
 * from the sea bed the builder recorded; out past that, the sea is deep.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const {
  Fn, abs, attribute, cameraFar, cameraNear, cameraViewMatrix, cos, floor, fract, fwidth, step, positionLocal, positionView, cameraPosition, clamp, dot, exp, float, length, max, min, mix, normalize,
  perspectiveDepthToViewZ, positionWorld, pow, reflect, screenUV, select, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4, viewportDepthTexture, viewportSharedTexture,
} = TSL as N;
const one = (x: N): N => float(1).sub(x);
/**
 * The swell: three long trains of waves from the open sea, each as how many waves to the metre
 * across x and z, how fast it goes (as deep water has it, the root of g times the waves to the
 * metre), and how high (half its height, crest to trough). Its height lifts the surface and its
 * slope tilts it.
 */
const SWELL: [number, number, number, number][] = [[0.11, 0.05, 1.08, 0.42], [-0.04, 0.13, 1.13, 0.3], [0.21, -0.12, 1.55, 0.1]];
/**
 * The waves the wind raises on the swell: each as how far it is turned from the way the wind blows, its length in metres, and how
 * high it stands (crest above the trough's floor). They do not lift the surface (the rings are too far apart to carry them), only
 * tilt it. The wind blows towards greater x and a little greater z, as the pennants stream (`layVessel`).
 */
const WIND_WAY = Math.atan2(0.34, 0.94);
const WIND: [number, number, number][] = [[0, 9.1, 0.13], [0.55, 5.3, 0.075], [-0.6, 3.1, 0.042], [0.25, 1.9, 0.024]];
const smoothJS = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
/** How far a point is from a lane given as a line of points. */
function laneOff(lane: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < lane.length; i++) {
    const [ax, az] = lane[i], bx = lane[i + 1][0] - ax, bz = lane[i + 1][1] - az, t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
    best = Math.min(best, Math.hypot(x - ax - bx * t, z - az - bz * t));
  }
  return best;
}
/** The same in the program of the picture, the lane's points being fixed. */
const laneOffN = (lane: [number, number][], p: N): N => {
  let best: N = float(1e6);
  for (let i = 0; i + 1 < lane.length; i++) {
    const a = vec2(...lane[i]), ab = vec2(lane[i + 1][0] - lane[i][0], lane[i + 1][1] - lane[i][1]), l2 = Math.max(1e-6, (lane[i + 1][0] - lane[i][0]) ** 2 + (lane[i + 1][1] - lane[i][1]) ** 2);
    const t = clamp(dot(p.sub(a), ab).div(l2), 0, 1);
    best = min(best, length(p.sub(a.add(ab.mul(t)))));
  }
  return best;
};
/** A number between 0 and 1 for a cell of the lattice. */
const cellHash = (c: N): N => fract(sin(dot(c, vec2(127.1, 311.7))).mul(43758.5453));
/** How far off a point is, for how much the water bends what is seen through it (less far off, where a point of the picture is large). */
const far0 = (P: N): N => length(cameraPosition.sub(P));

/**
 * The swell at a point at a time, as the sea's surface is lifted by it (see `positionNode` below): how high it stands there, and
 * how steeply it slopes across x and across z. For whatever floats on it. `depth` is how deep the water is there: the swell is
 * lower where it is shallow, as the surface's is.
 */
export function swellAt(x: number, z: number, time: number, depth: number): { h: number; dx: number; dz: number } {
  const k = Math.min(1, Math.max(0, depth / 3)), scale = (k * k * (3 - 2 * k)) * 0.6 + 0.4;
  let h = 0, dx = 0, dz = 0;
  for (const [kx, kz, w, a] of SWELL) { const ph = x * kx + z * kz - time * w; h -= Math.cos(ph) * a; dx += Math.sin(ph) * a * kx; dz += Math.sin(ph) * a * kz; }
  return { h: h * scale, dx: dx * scale, dz: dz * scale };
}

export class Sea {
  readonly mesh: Mesh;
  private readonly material = new NodeMaterial();
  private readonly ripples = rippleMap(256);
  private readonly uTime: N = uniform(0);
  /** How far from the island's middle the rings are close together. */
  private readonly reach: number;

  constructor(private readonly desc: SeaDesc, private readonly look: { deep: number[]; shallow: number[]; foam: number[] }) {
    const { bed } = desc;
    const depthAt = (x: number, z: number): number => {
      const fx = (x - bed.x0) / bed.cell, fz = (z - bed.z0) / bed.cell;
      if (fx < 0 || fz < 0 || fx > bed.nx - 1.001 || fz > bed.nz - 1.001) return 60;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * bed.nx + i, d = bed.data;
      const y = d[k] * (1 - tx) * (1 - tz) + d[k + 1] * tx * (1 - tz) + d[k + bed.nx] * (1 - tx) * tz + d[k + bed.nx + 1] * tx * tz;
      return Math.min(60, desc.level - y);
    };
    // Rings: a metre and a half apart over the lattice of the sea bed, then further and further apart out to the edge.
    const reach = (this.reach = Math.hypot(bed.nx * bed.cell, bed.nz * bed.cell) / 2 + 20), radii: number[] = [0];
    for (let r = 1.5; r < 3400; r += r < reach ? 1.5 : (r - reach) * 0.06 + 1.5) radii.push(r);
    radii.push(3400);
    const around = 540, position: number[] = [], depth: number[] = [], index: number[] = [];
    for (const r of radii) for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2, x = desc.x + Math.cos(a) * r, z = desc.z + Math.sin(a) * r;
      position.push(x, desc.level, z);
      depth.push(depthAt(x, z));
    }
    for (let i = 0; i < radii.length - 1; i++) for (let k = 0; k < around; k++) {
      const k1 = (k + 1) % around, a = i * around + k, b = i * around + k1, c = (i + 1) * around + k, d = (i + 1) * around + k1;
      // Where both rings lie under the land, nothing is drawn: no sea under the island.
      if (depth[a] < -1.5 && depth[b] < -1.5 && depth[c] < -1.5 && depth[d] < -1.5) continue;
      // Wound to face the sky.
      index.push(a, b, c, b, d, c);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depth), 1));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    this.material.transparent = true;
    // (It writes its depth, so that the air is laid over it by how far off it is, as over land.)
    this.material.depthWrite = true;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    const spray = this.sprays(desc.spray ?? [], look.foam);
    if (spray) this.mesh.add(spray);
  }

  /**
   * Spray: where the swell runs against a cliff it bursts up the rock. Each place is an upright
   * sheet facing out to sea, a soft cloud of white that rises when the swell there is highest and
   * thins as it falls back. When the swell is highest at a place is worked out from the same
   * trains of waves that lift the water.
   */
  private sprays(points: { x: number; z: number; nx: number; nz: number }[], foam: number[]): Mesh | null {
    if (!points.length) return null;
    const position: number[] = [], uvs: number[] = [], index: number[] = [];
    for (const p of points) {
      const base = position.length / 3, w = 7, h = 9, ax = -p.nz, az = p.nx;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        position.push(p.x + ax * (u - 0.5) * w + p.nx * v * 1.5, this.desc.level - 0.3 + v * h, p.z + az * (u - 0.5) * w + p.nz * v * 1.5);
        uvs.push(u, v);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(index);
    const material = new NodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    const t = this.uTime, white = vec3(...foam);
    material.fragmentNode = Fn(() => {
      const P: N = positionWorld, at: N = uv();
      // How high the swell stands here now, from -1 to 1: the spray goes up as it peaks.
      const h: N = SWELL.reduce((sum: N, [kx, kz, w, a]) => sum.sub(cos(P.x.mul(kx).add(P.z.mul(kz)).sub(t.mul(w))).mul(a)), float(0)).div(0.8).toVar();
      const burst: N = smoothstep(0.15, 0.9, h).toVar();
      // A soft round cloud, thickest low in the middle, rising as high as the burst takes it: no edges anywhere.
      const across: N = at.x.mul(2).sub(1);
      const tall: N = at.y.div(max(burst, 0.05));
      const body = exp(across.mul(across).mul(-5)).mul(exp(tall.mul(tall).mul(-3.5))).mul(smoothstep(0, 0.08, at.y));
      const drift = texture(this.ripples, vec2(P.x.add(P.z), P.y).mul(0.08).add(vec2(0.02, -0.11).mul(t))).x.add(texture(this.ripples, vec2(P.x.sub(P.z), P.y).mul(0.19).add(vec2(-0.03, -0.17).mul(t))).y);
      // (Never a solid sheet: broken up into drifting wisps, and thin.)
      return vec4(white, body.mul(smoothstep(0.7, 1.8, drift)).mul(burst).mul(0.32));
    })();
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    mesh.name = 'water';
    mesh.layers.set(1);
    return mesh;
  }

  /** How the sea is drawn, given the sky it reflects. To be called once, when the air is made. */
  attach(atmosphere: Atmosphere): void {
    const u = atmosphere.uniforms, t = this.uTime, look = this.look;
    const sky = skyParts(u, 8);
    const deep = vec3(...look.deep), shallow = vec3(...look.shallow), foamColour = vec3(...look.foam);
    const rip = (at: N): N => texture(this.ripples, at).xy.mul(2).sub(1);
    // The swell lifts the surface itself, so the water rises and falls against the cliffs and runs up the sand and back. Less where it is shallow.
    this.material.positionNode = Fn(() => {
      const p: N = positionLocal, d: N = max(attribute('aDepth', 'float'), 0);
      const h: N = SWELL.reduce((sum: N, [kx, kz, w, a]) => sum.sub(cos(p.x.mul(kx).add(p.z.mul(kz)).sub(t.mul(w))).mul(a)), float(0));
      // (Far out the rings are too far apart to carry it, and it is too far off to be seen rising: there the surface lies flat.)
      const out: N = length(p.xz.sub(vec2(this.desc.x, this.desc.z)));
      // (Ice lies still: no swell lifts it, and in the lane between it the water is nearly calm.)
      const ice = this.desc.ice, still: N = ice ? one(smoothstep(ice.reach - 60, ice.reach + 180, length(p.xz.sub(vec2(...ice.from))))).mul(0.85) : float(0);
      return vec3(p.x, p.y.add(h.mul(smoothstep(0, 3, d).mul(0.6).add(0.4)).mul(one(smoothstep(this.reach, this.reach + 250, out))).mul(one(still))), p.z);
    })();
    /**
     * The surface at a point: which way it faces, how rough it is past what can be drawn, and how high the waves on it stand.
     *
     * On the swell run waves the wind raises, four trains of them from three to nine metres long about the way the wind blows (the
     * way every pennant in a harbour streams), each sharp at its crest and broad in its trough as wind waves are (`exp(sin - 1)`, not
     * a plain wave); on those, ripples read from a picture at four sizes, each turned from the last so that their repeats do not line
     * up (with three, close to, the same pattern of ripples showed over and over). Where a wave is too small for the points of the
     * picture to show (fewer than a few points to its length), it is left out of which way the surface faces, and what it would have
     * tilted the surface by is kept as roughness instead (`rough`, the spread of the surface's slopes): the sea far off is not
     * smooth, only too finely rough to see, and it is that roughness that spreads the sun's reflection into a path of glitter.
     */
    const surface = (P: N, d: N): { normal: N; rough: N; crest: N; fade: N } => {
      const far: N = length(cameraPosition.xz.sub(P.xz)).toVar();
      // (How many metres a point of the picture covers here.)
      const px: N = max(length(fwidth(P.xz)), 1e-4).toVar();
      const shown = (metres: number): N => clamp(float(metres).div(px).sub(2).div(4), 0, 1);
      const calm: N = smoothstep(0.5, 8, d).mul(0.75).add(0.25).toVar();
      let slope: N = SWELL.reduce((sum: N, [kx, kz, w, a]) => sum.add(vec2(kx, kz).mul(sin(P.x.mul(kx).add(P.z.mul(kz)).sub(t.mul(w))).mul(a))), vec2(0, 0));
      let height: N = SWELL.reduce((sum: N, [kx, kz, w, a]) => sum.sub(cos(P.x.mul(kx).add(P.z.mul(kz)).sub(t.mul(w))).mul(a)), float(0)).div(SWELL.reduce((m, w) => m + w[3], 0));
      let lost: N = float(0.0012), crest: N = float(0);
      const windTotal = WIND.reduce((m, w) => m + w[2], 0);
      for (const [turn, len, a] of WIND) {
        const k = (Math.PI * 2) / len, w = Math.sqrt(9.81 * k), dx = Math.cos(WIND_WAY + turn) * k, dz = Math.sin(WIND_WAY + turn) * k;
        const ph: N = P.x.mul(dx).add(P.z.mul(dz)).sub(t.mul(w)).toVar(), peak: N = exp(sin(ph).sub(1)).toVar();
        const seen: N = shown(len);
        slope = slope.add(vec2(dx, dz).mul(cos(ph).mul(peak).mul(a * 1.0)).mul(seen));
        lost = lost.add(one(seen).mul((k * a) ** 2 * 0.25));
        crest = crest.add(peak.mul(a / windTotal));
      }
      // The ripples: tiles of 26, 8.3, 2.6 and 0.8 metres, each turned and drifting its own way.
      for (const [size, weight, ang, vx, vz] of [[26, 0.07, 0.3, 0.011, 0.007], [8.3, 0.05, 1.9, -0.017, 0.009], [2.6, 0.03, 4.1, 0.03, -0.04], [0.83, 0.014, 2.7, -0.05, 0.06]] as [number, number, number, number, number][]) {
        const c = Math.cos(ang), sn = Math.sin(ang);
        const q: N = vec2(P.x.mul(c).sub(P.z.mul(sn)), P.x.mul(sn).add(P.z.mul(c))).div(size).add(vec2(vx, vz).mul(t));
        const r: N = rip(q), seen: N = shown(size / 6);
        // (Turned back to the world's two ways.)
        slope = slope.add(vec2(r.x.mul(c).add(r.y.mul(sn)), r.y.mul(c).sub(r.x.mul(sn))).mul(weight).mul(seen));
        lost = lost.add(one(seen).mul(weight * weight * 0.18));
      }
      slope = slope.mul(calm);
      // And in rain, the drops' rings, plainest where the water is calm (a harbour, a cove), lost among the waves out at sea.
      slope = slope.add(rainRings(P.xz, (weatherUniforms.uWet as N).mul(one(smoothstep(4, 14, d)).mul(0.6).add(0.4))));
      return {
        normal: normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar(),
        rough: lost.mul(calm).toVar(),
        crest: clamp(crest.sub(0.3).div(0.7).mul(0.7).add(height.mul(0.3)), 0, 1).mul(calm).toVar(),
        fade: exp(far.div(-260)),
      };
    };
    /**
     * Ice, in a harbour town's winter (`SeaDesc['ice']`): out to some three hundred metres from the quay the sea is one sheet of ice
     * under snow, its edge ragged, and beyond it a belt of floes thinning out to open water; through it all a lane broken for the
     * ships, from the quay out between the moles' heads, where the ice lies in floes a few metres across along its edges and in
     * small broken pieces in the lane itself. The floes are the plane cut into cells, bent by noise so that they are not squares, each
     * ice or water as much of the sea there is ice, with dark water in the gaps between them. Gives how much of a point is ice, how
     * much of that is a floe's raw edge, and whether it is broken pieces in the lane.
     */
    const ice = this.desc.ice;
    const iceAt = (P: N): { cover: N; rim: N } => {
      if (!ice) return { cover: float(0), rim: float(0) };
      const lane: N = laneOffN(ice.lane, P.xz).add(rip(P.xz.mul(0.07)).x.mul(1.8)).toVar();
      const fromQ: N = length(P.xz.sub(vec2(...ice.from))).add(rip(P.xz.mul(0.011)).x.mul(45)).toVar();
      const fast: N = one(smoothstep(ice.reach - 25, ice.reach + 25, fromQ)), pack: N = one(smoothstep(ice.reach, ice.reach + 170, fromQ));
      const edge: N = smoothstep(ice.half - 1.5, ice.half + 2.5, lane).toVar(), broken: N = one(smoothstep(ice.half + 3, ice.half + 18, lane)).toVar();
      const bend: N = vec2(rip(P.xz.mul(0.05)).x, rip(P.zx.mul(0.05)).y).mul(1.7);
      // Floes along the lane and out in the pack, larger the further from the lane; small pieces in the lane itself.
      // (Bent less for the small pieces, which are broken angular: bent as much as the floes, they were swirls of white, like marble.)
      const floeAt = (size: N, share: N, crack: N, bent = 1): { on: N; rim: N } => {
        const q: N = P.xz.add(bend.mul(bent)).div(size), f: N = fract(q), gap: N = min(min(f.x, one(f.x)), min(f.y, one(f.y)));
        const on: N = step(cellHash(floor(q)), share).mul(smoothstep(crack, crack.mul(1.6), gap));
        return { on, rim: on.mul(one(smoothstep(crack.mul(1.6), crack.mul(4), gap))) };
      };
      const sheet: N = fast.mul(one(broken.mul(0.4))), share: N = max(sheet, pack.mul(0.78)).toVar();
      const floes = floeAt(mix(6, 2.6, broken), share, mix(0.07, 0.006, sheet.mul(one(broken))));
      const brash = floeAt(float(1.15), float(0.28).mul(fast.max(pack)), float(0.12), 0.18);
      return { cover: mix(brash.on, floes.on, edge), rim: mix(brash.on, floes.rim, edge) };
    };
    // What it mirrors of what stands about it, the quay, the boats, the houses along the shore, is found in the picture by the air's
    // pass (`mirrored` in `post.ts`): the sea says how nearly a mirror it is, as the waves let it be, and which way it faces. Less where
    // it shoals to nothing at the shore, and less where it is rough.
    this.material.userData.mirror = Fn(() => {
      const d: N = max(attribute('aDepth', 'float'), 0);
      const sf = surface(positionWorld, d);
      const n: N = cameraViewMatrix.mul(vec4(sf.normal, 0)).xyz;
      return mirrorAs(n, smoothstep(0.1, 1.2, d).mul(0.75).mul(one(smoothstep(0.01, 0.06, sf.rough).mul(0.5))).mul(one(iceAt(positionWorld).cover)));
    })();
    this.material.fragmentNode = Fn(() => {
      const P: N = positionWorld, d: N = max(attribute('aDepth', 'float'), 0).toVar();
      const { normal, rough, crest, fade } = surface(P, d);
      const view: N = normalize(cameraPosition.sub(P)).toVar();
      const facing: N = max(dot(normal, view), 0).toVar();
      // (A sea is never a mirror: its waves hide part of what it would reflect at a glancing angle, and show the water's own dark instead.)
      const fresnel: N = pow(one(facing), 5).mul(0.7).add(0.025).toVar();
      const dir: N = reflect(view.negate(), normal).toVar();
      // What it reflects: the sky that way (never the ground under the horizon), blurred as much as the surface is rough.
      const up: N = normalize(vec3(dir.x, max(dir.y, 0.02), dir.z));
      // (The sky towards the sun is far brighter than anything shown; it is brought down whole, keeping its colour, as for the haze.)
      const raw: N = u.tSky.sample(up).level(mix(1.5, 4.5, smoothstep(0.002, 0.04, rough))).rgb.toVar();
      const skyColour: N = raw.mul(min(1, float(1.1).div(max(max(raw.r, raw.g), max(raw.b, 0.001))))).add(sky.skyAfterDark(up)).toVar();
      // The sun (or the moon) in it: each facet of the waves that is turned just so throws it to the eye, and how many are is reckoned
      // from the spread of the surface's slopes (the waves too small to draw included): close to, a scatter of points of light; far
      // off, towards a low sun, a road of glitter that broadens with the roughness of the sea.
      const half: N = normalize(view.add(u.uSunDir)).toVar();
      const nh: N = max(dot(normal, half), 0.001).toVar(), m2: N = rough.mul(2).add(0.0006).toVar();
      const tan2: N = one(nh.mul(nh)).div(nh.mul(nh));
      const spread: N = exp(tan2.div(m2).negate()).div(m2.mul(3.1416).mul(nh.mul(nh).mul(nh).mul(nh)));
      const fh: N = pow(one(max(dot(half, view), 0)), 5).mul(0.98).add(0.02);
      const glint: N = min(spread.mul(fh).div(max(facing, 0.08).mul(4)), 60).mul(smoothstep(-0.02, 0.05, u.uSunDir.y)).toVar();
      // The water itself, as the eye sees into it: what lies under it (the bottom, rocks, the foot of a wall), bent a little by the
      // waves and fading with the depth of water the eye looks through, red first, so that sand under a metre of water is
      // turquoise and under five lost in blue-green; and where the eye sees nothing under it, the water's own colour.
      // (It was drawn half see-through, the same at every depth, so that shallows showed what lay under them washed out and flat.)
      const viewZ = (at: N): N => perspectiveDepthToViewZ(viewportDepthTexture(at).x, cameraNear, cameraFar);
      const thick0: N = positionView.z.sub(viewZ(screenUV)).toVar();
      const bentUV: N = screenUV.add(vec2(normal.x, normal.z.negate()).mul(0.03).mul(clamp(thick0.mul(0.4), 0, 1)).div(max(far0(P), 1).mul(0.05).add(1))).toVar();
      const thick1: N = positionView.z.sub(viewZ(bentUV)).toVar();
      // (Not bent where what is at the bent point stands above the water: a post, a hull.)
      const under0: N = thick1.greaterThan(0);
      const thick: N = max(select(under0, thick1, thick0), 0).toVar();
      const under: N = viewportSharedTexture(select(under0, bentUV, screenUV)).rgb.toVar();
      const through: N = exp(vec3(0.6, 0.2, 0.22).mul(thick).negate()).toVar();
      const own: N = mix(shallow.mul(0.5), deep, smoothstep(0.5, 5, d));
      const body: N = under.mul(through).add(own.mul(one(through)));
      // Light comes through the thin crests of the waves from behind, turquoise, looking towards the sun.
      const backlit: N = pow(max(dot(view.negate(), u.uSunDir), 0), 4).mul(0.8).add(0.12);
      const glow: N = u.uSunColor.mul(vec3(0.06, 0.32, 0.26)).mul(crest.mul(crest)).mul(backlit).mul(one(fresnel)).mul(smoothstep(-0.02, 0.1, u.uSunDir.y)).mul(0.22);
      let colour: N = mix(body, skyColour, fresnel).add(glow).add(u.uSunColor.mul(glint).mul(0.16));
      // The surf: where the water shoals it breaks in lines running in to the shore, broken up as foam is; and against rock and sand at the very edge a fringe of white.
      const run: N = d.mul(1.6).add(t.mul(0.55)).add(rip(P.xz.mul(0.03)).x.mul(0.8));
      const lines: N = smoothstep(0.75, 0.98, sin(run.mul(2.4)).mul(0.5).add(0.5)).mul(one(smoothstep(0.4, 2.6, d))).toVar();
      const breakup: N = smoothstep(-0.3, 0.45, rip(P.xz.mul(0.27).add(vec2(0.02, -0.03).mul(t))).x.add(rip(P.zx.mul(0.61).sub(vec2(0.01, 0.04).mul(t))).y.mul(0.6)));
      const edge: N = one(smoothstep(0.05, 0.55, d)).mul(smoothstep(-0.6, 0.2, rip(P.xz.mul(0.5).add(t.mul(0.03))).x)).toVar();
      // And now and then a crest breaks out on the open water: where the wind's waves stand highest.
      const caps: N = smoothstep(0.78, 1.05, rip(P.xz.mul(0.021).add(vec2(0.004, 0.002).mul(t))).x.add(rip(P.zx.mul(0.09).add(t.mul(0.02))).y.mul(0.5)).add(crest.mul(0.25))).mul(smoothstep(4, 12, d)).mul(fade).mul(0.35);
      // And against whatever stands in the water, a quay's wall, a mole's stones, a hull, a stake, the swell slaps and lies in a fringe
      // of foam a hand or two broad, which comes and goes: found from how little water there is between the surface and what the eye
      // sees through it. (The bed's depth knows nothing of a wall: the water is deep right up to it, and it stood clean against it.)
      // (A soft band, broken up into patches and streaks that come and go: drawn as a sharp one, it followed every step of a clinker
      // hull's planks in a row of white teeth.)
      const churn: N = rip(P.xz.mul(1.3).add(vec2(0.05, -0.04).mul(t))).x.mul(0.6).add(rip(P.zx.mul(3.1).sub(vec2(0.03, 0.06).mul(t))).y.mul(0.4)).toVar();
      const lap: N = pow(one(smoothstep(0, mix(0.7, 1.6, churn.mul(0.5).add(0.5)), thick0)), 1.6)
        .mul(smoothstep(-0.35, 0.35, churn.add(sin(t.mul(1.3).add(P.x.mul(0.21)).add(P.z.mul(0.17))).mul(0.3)))).mul(smoothstep(0.3, 1, d)).toVar();
      const foam: N = clamp(max(max(lines.mul(breakup), edge), lap.mul(0.7)).add(caps.mul(breakup)), 0, 1).toVar();
      colour = mix(colour, foamColour, foam.mul(0.9));
      // Ice over it all, where there is ice: snow-covered and lit as the snow on the land is, by the sky and the sun; grey-blue at a
      // floe's broken edge, where it is wet and seen into.
      if (ice) {
        const frozen = iceAt(P);
        const snowLit: N = u.uSkyColor.mul(0.55).add(u.uSunColor.mul(max(u.uSunDir.y, 0)).mul(0.42)).mul(vec3(0.9, 0.93, 0.98));
        const top: N = snowLit.mul(rip(P.xz.mul(0.33)).x.mul(0.08).add(rip(P.zx.mul(0.09)).y.mul(0.06)).add(0.92));
        const iceColour: N = mix(top, snowLit.mul(vec3(0.5, 0.58, 0.64)), frozen.rim.mul(0.8));
        // (And the open water is a winter sea's, dark grey-green, not the clear blue of a summer's shallows over sand.)
        colour = mix(colour.mul(vec3(0.42, 0.5, 0.52)), iceColour, frozen.cover);
      }
      return vec4(min(colour, vec3(12)), 1);
    })();
  }

  update(time: number): void {
    this.uTime.value = time;
  }

  /** Whether the sea is frozen about the town (`SeaDesc['ice']`). */
  get iced(): boolean {
    return !!this.desc.ice;
  }

  /** How much of the sea at a point is ice, 0 to 1 (see `SeaDesc['ice']`): for what floats on it, which the ice holds still. */
  iceAt(x: number, z: number): number {
    const ice = this.desc.ice;
    if (!ice) return 0;
    const lane = laneOff(ice.lane, x, z), fast = 1 - smoothJS((Math.hypot(x - ice.from[0], z - ice.from[1]) - ice.reach) / 120);
    return Math.max(0, Math.min(1, fast * smoothJS((lane - ice.half) / 6)));
  }

  /** How deep the water is at a point: for hearing the surf. */
  depthNear(x: number, z: number): number {
    const bed = this.desc.bed, fx = Math.round((x - bed.x0) / bed.cell), fz = Math.round((z - bed.z0) / bed.cell);
    if (fx < 0 || fz < 0 || fx >= bed.nx || fz >= bed.nz) return 60;
    return this.desc.level - bed.data[fz * bed.nx + fx];
  }
}
