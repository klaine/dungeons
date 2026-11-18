import { AdditiveBlending, BufferAttribute, BufferGeometry, Camera, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Rng } from '../core/rng';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, cameraPosition, cos, float, fract, length, max, positionLocal, positionWorld, pow, sin, smoothstep, uniform, vec3, vec4 } = TSL as N;

/**
 * Fireflies on a warm evening: small lights low over the grass by the water and along the edges of the woods, each drifting
 * slowly about its own home and glowing now and then for a moment, a slow swell and fade, then dark again for some seconds.
 * Each is a small patch of light facing the eye, never smaller than a pixel or two however far off (a point that size would
 * flicker as it crossed the pixels), and dimmer the further off it is. All of it is worked out where it is drawn, from the time.
 */
export class Fireflies {
  readonly mesh: Mesh;
  private readonly uTime: N = uniform(0);
  private readonly uShown: N = uniform(0);
  private readonly uRight: N = uniform(new Vector3(1, 0, 0));
  private readonly uUp: N = uniform(new Vector3(0, 1, 0));
  private shown = 0;

  /** `homes`: three numbers to each fly, where it keeps about. `bright`: how strong its light is against the eye at this hour. */
  constructor(homes: number[], seed: string, bright: number) {
    const rng = new Rng(`fireflies/${seed}`), count = homes.length / 3;
    const where = new Float32Array(count * 4 * 3), fly = new Float32Array(count * 4 * 4), corner = new Float32Array(count * 4 * 2), index: number[] = [];
    for (let i = 0; i < count; i++) {
      // Each fly: its pace of drifting, how long between its glows, where in that it is now, and how bright it glows.
      const pace = rng.range(0.25, 0.6), period = rng.range(2.5, 6), phase = rng.next(), strength = rng.range(0.5, 1.2);
      for (let c = 0; c < 4; c++) {
        where.set([homes[i * 3], homes[i * 3 + 1], homes[i * 3 + 2]], (i * 4 + c) * 3);
        fly.set([pace, period, phase, strength], (i * 4 + c) * 4);
        corner.set([c & 1 ? 1 : -1, c & 2 ? 1 : -1], (i * 4 + c) * 2);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(where, 3));
    geometry.setAttribute('aFly', new BufferAttribute(fly, 4));
    geometry.setAttribute('aCorner', new BufferAttribute(corner, 2));
    geometry.setIndex(index);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const t = this.uTime, right = this.uRight, up = this.uUp, shown = this.uShown;
    material.positionNode = Fn(() => {
      const p: N = positionLocal, f: N = attribute('aFly', 'vec4'), c: N = attribute('aCorner', 'vec2');
      // (Wandering: three slow beats on each axis that never quite meet, a couple of metres across and less up and down.)
      const s: N = t.mul(f.x), k: N = f.z.mul(40);
      const drift: N = vec3(
        sin(s.mul(0.9).add(k)).mul(1.1).add(sin(s.mul(2.3).add(k.mul(1.7))).mul(0.35)),
        sin(s.mul(0.7).add(k.mul(2.3))).mul(0.3).add(sin(s.mul(1.9).add(k)).mul(0.12)),
        cos(s.mul(0.8).add(k.mul(1.3))).mul(1.1).add(cos(s.mul(2.1).add(k.mul(0.6))).mul(0.35)),
      );
      const at: N = p.add(drift);
      // The patch holds the light and the haze of light about it, as the eye sees a small bright thing in the dark; never smaller
      // than about four thousandths of the way to it, which keeps its core a pixel or two across on most screens.
      const size: N = max(float(0.1), length(at.sub(cameraPosition)).mul(0.004));
      return at.add(right.mul(c.x.mul(size))).add(up.mul(c.y.mul(size)));
    })();
    material.colorNode = Fn(() => {
      const f: N = attribute('aFly', 'vec4'), c: N = attribute('aCorner', 'vec2');
      // The glow: a swell and fade of about a second, once in each of its periods.
      const u: N = fract(t.div(f.y).add(f.z)), on: N = smoothstep(0, 0.12, u).mul(smoothstep(0.32, 0.12, u));
      const r: N = length(c), soft: N = smoothstep(0.3, 0, r).mul(3).add(pow(smoothstep(1, 0, r), float(2.5)).mul(0.5));
      // (Where it is drawn larger than it is, so as to be seen at all, its light is spread over more and each part of it is dimmer.)
      const grown: N = max(float(1), length(positionWorld.sub(cameraPosition)).mul(0.004 / 0.1));
      return vec4(vec3(0.78, 1, 0.3).mul(on.mul(f.w).mul(soft).mul(bright).mul(shown).div(grown)), float(1));
    })();
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fireflies';
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** `out`: whether they are out (a warm evening, no rain). They come out and go in over some seconds. */
  update(time: number, camera: Camera, out: boolean, dt: number): void {
    this.shown += ((out ? 1 : 0) - this.shown) * Math.min(1, dt * 0.5);
    this.mesh.visible = this.shown > 0.01;
    this.uTime.value = time;
    this.uShown.value = this.shown;
    camera.matrixWorld.extractBasis(this.uRight.value, this.uUp.value, SCRATCH);
  }
}
const SCRATCH = new Vector3();
