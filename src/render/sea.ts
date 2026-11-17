import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Atmosphere, skyParts } from './post';
import { rippleMap } from './water';
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
  Fn, abs, attribute, cos, positionLocal, cameraPosition, clamp, dot, exp, float, length, max, min, mix, normalize, positionWorld, pow, reflect, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} = TSL as N;
const one = (x: N): N => float(1).sub(x);
/**
 * The swell: three long trains of waves from the open sea, each as how many waves to the metre
 * across x and z, how fast it goes (as deep water has it, the root of g times the waves to the
 * metre), and how high (half its height, crest to trough). Its height lifts the surface and its
 * slope tilts it.
 */
const SWELL: [number, number, number, number][] = [[0.11, 0.05, 1.08, 0.42], [-0.04, 0.13, 1.13, 0.3], [0.21, -0.12, 1.55, 0.1]];

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
      const across = one(abs(at.x.mul(2).sub(1)));
      const tall: N = at.y.div(max(burst, 0.05));
      const body = smoothstep(0, 0.6, across).mul(one(smoothstep(0.3, 1, tall))).mul(smoothstep(0, 0.06, at.y));
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
      return vec3(p.x, p.y.add(h.mul(smoothstep(0, 3, d).mul(0.6).add(0.4)).mul(one(smoothstep(this.reach, this.reach + 250, out)))), p.z);
    })();
    this.material.fragmentNode = Fn(() => {
      const P: N = positionWorld, d: N = max(attribute('aDepth', 'float'), 0).toVar();
      const far: N = length(cameraPosition.xz.sub(P.xz)).toVar();
      const calm: N = smoothstep(0.5, 8, d).mul(0.75).add(0.25);
      const swell: N = SWELL.reduce((sum: N, [kx, kz, w, a]) => sum.add(vec2(kx, kz).mul(sin(P.x.mul(kx).add(P.z.mul(kz)).sub(t.mul(w))).mul(a))), vec2(0, 0)).mul(calm).toVar();
      // Waves and wavelets on the swell, finer and fainter with distance, so that far off the sea is smooth and only glints.
      const fade: N = exp(far.div(-260)).toVar();
      const w1: N = rip(P.xz.mul(0.045).add(vec2(0.011, 0.007).mul(t)));
      const w2: N = rip(P.zx.mul(0.13).sub(vec2(0.017, 0.009).mul(t)));
      const w3: N = rip(P.xz.mul(0.41).add(vec2(-0.03, 0.04).mul(t)));
      const slope: N = swell.add(w1.mul(0.075)).add(w2.mul(0.055).mul(fade.mul(0.6).add(0.4))).add(w3.mul(0.04).mul(fade)).mul(calm).toVar();
      const normal: N = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
      const view: N = normalize(cameraPosition.sub(P)).toVar();
      const facing: N = max(dot(normal, view), 0).toVar();
      // (A sea is never a mirror: its waves hide part of what it would reflect at a glancing angle, and show the water's own dark instead.)
      const fresnel: N = pow(one(facing), 5).mul(0.7).add(0.025).toVar();
      const dir: N = reflect(view.negate(), normal).toVar();
      // What it reflects: the sky that way (never the ground under the horizon), and the sun itself as a scatter of glints.
      const up: N = normalize(vec3(dir.x, max(dir.y, 0.02), dir.z));
      // (The sky towards the sun is far brighter than anything shown; it is brought down whole, keeping its colour, as for the haze.)
      const raw: N = u.tSky.sample(up).level(2).rgb.toVar();
      const skyColour: N = raw.mul(min(1, float(1.1).div(max(max(raw.r, raw.g), max(raw.b, 0.001))))).add(sky.skyAfterDark(up)).toVar();
      const glint: N = pow(max(dot(dir, u.uSunDir), 0), 900).mul(60).add(pow(max(dot(dir, u.uSunDir), 0), 90).mul(0.6)).mul(smoothstep(-0.02, 0.06, u.uSunDir.y));
      // The water itself: blue-green and clear over sand, dark where it is deep, lit by the sky over it.
      const body: N = mix(shallow, deep, smoothstep(0.5, 14, d)).toVar();
      let colour: N = mix(body, skyColour, fresnel).add(u.uSunColor.mul(glint).mul(0.012));
      // The surf: where the water shoals it breaks in lines running in to the shore, broken up as foam is; and against rock and sand at the very edge a fringe of white.
      const run: N = d.mul(1.6).add(t.mul(0.55)).add(rip(P.xz.mul(0.03)).x.mul(0.8));
      const lines: N = smoothstep(0.75, 0.98, sin(run.mul(2.4)).mul(0.5).add(0.5)).mul(one(smoothstep(0.4, 2.6, d))).toVar();
      const breakup: N = smoothstep(-0.3, 0.45, rip(P.xz.mul(0.27).add(vec2(0.02, -0.03).mul(t))).x.add(rip(P.zx.mul(0.61).sub(vec2(0.01, 0.04).mul(t))).y.mul(0.6)));
      const edge: N = one(smoothstep(0.05, 0.55, d)).mul(smoothstep(-0.6, 0.2, rip(P.xz.mul(0.5).add(t.mul(0.03))).x)).toVar();
      // And now and then a crest breaks out on the open water.
      const caps: N = smoothstep(0.78, 1.05, rip(P.xz.mul(0.021).add(vec2(0.004, 0.002).mul(t))).x.add(rip(P.zx.mul(0.09).add(t.mul(0.02))).y.mul(0.5))).mul(smoothstep(4, 12, d)).mul(fade).mul(0.35);
      const foam: N = clamp(max(lines.mul(breakup), edge).add(caps.mul(breakup)), 0, 1).toVar();
      colour = mix(colour, foamColour, foam.mul(0.9));
      // Shallow water shows what lies under it; at the very edge it thins to nothing, so the shore has no hard line.
      const clear: N = one(smoothstep(0.1, 3.2, d)).mul(one(fresnel)).mul(0.82);
      const alpha: N = one(clear).mul(smoothstep(0, 0.12, d).mul(0.85).add(0.15)).max(foam.mul(0.9));
      return vec4(min(colour, vec3(12)), alpha);
    })();
  }

  update(time: number): void {
    this.uTime.value = time;
  }

  /** How deep the water is at a point: for hearing the surf. */
  depthNear(x: number, z: number): number {
    const bed = this.desc.bed, fx = Math.round((x - bed.x0) / bed.cell), fz = Math.round((z - bed.z0) / bed.cell);
    if (fx < 0 || fz < 0 || fx >= bed.nx || fz >= bed.nz) return 60;
    return this.desc.level - bed.data[fz * bed.nx + fx];
  }
}
