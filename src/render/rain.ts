import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Rng } from '../core/rng';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, float, fract, positionLocal, select, uniform, vec3, vec4 } = TSL as N;

/**
 * Rain: streaks falling about whoever is looking, in a box of air some thirty metres across that goes with them, each drop at a
 * place and a pace of its own, slanted by the wind and drawn as long as it falls in a moment, as the eye sees rain. All of it is
 * worked out where it is drawn, from the time, so that it costs nothing to keep falling. Where there is a roof overhead it is
 * not drawn (what falls past a doorway is not missed), and how heavy it is says how many of the drops are drawn and how bright.
 */
export class Rain {
  readonly mesh: LineSegments;
  private readonly uTime: N = uniform(0);
  private readonly uEye: N = uniform(new Vector3());
  private readonly uAmount: N = uniform(0);
  private readonly uLight: N = uniform(1);
  private readonly uWind: N = uniform(new Vector3(0.18, 0, 0.08));
  private shown = 0;

  constructor(seed: string) {
    const rng = new Rng(`rain/${seed}`), count = 9000, BOX = 32, HIGH = 22;
    const where = new Float32Array(count * 2 * 3), drop = new Float32Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      // Each drop: where in the box it falls (x and z, and how far through its fall it starts), how fast, which end of the streak
      // this point is, and its share of the drops (only that share of all of them is drawn in light rain).
      const x = rng.range(0, BOX), z = rng.range(0, BOX), start = rng.next(), speed = rng.range(7.5, 10), share = rng.next();
      for (let e = 0; e < 2; e++) {
        where.set([x, start, z], (i * 2 + e) * 3);
        drop.set([speed, e, share, rng.range(0.85, 1.15)], (i * 2 + e) * 4);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(where, 3));
    geometry.setAttribute('aDrop', new BufferAttribute(drop, 4));
    const material = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    const t = this.uTime, eye = this.uEye, amount = this.uAmount, wind = this.uWind;
    material.positionNode = Fn(() => {
      const p: N = positionLocal, d: N = attribute('aDrop', 'vec4');
      // How far down its fall the drop is, as a share of the box's height; the box's floor and walls wrapped about the eye, so the
      // drops are always about it and never seen to start or end.
      const fallen: N = fract(p.y.add(t.mul(d.x).div(HIGH)));
      const y: N = eye.y.add(HIGH * 0.55).sub(fallen.mul(HIGH));
      const x: N = fract(p.x.add(wind.x.mul(fallen).mul(HIGH)).sub(eye.x).div(BOX)).mul(BOX).add(eye.x).sub(BOX / 2);
      const z: N = fract(p.z.add(wind.z.mul(fallen).mul(HIGH)).sub(eye.z).div(BOX)).mul(BOX).add(eye.z).sub(BOX / 2);
      // The streak: as long as the drop falls in a sixtieth of a second, a little more for the eye's blur, along the way it falls.
      const len: N = d.x.mul(0.06).mul(d.w);
      // (A drop not in this rain's share is sent away under the ground, out of sight.)
      const gone: N = select(d.z.greaterThan(amount), float(-1000), float(0));
      return vec3(x.sub(wind.x.mul(len).mul(d.y)), y.add(len.mul(d.y)).add(gone), z.sub(wind.z.mul(len).mul(d.y)));
    })();
    material.colorNode = vec4(vec3(0.72, 0.76, 0.82).mul(this.uLight), float(0.28));
    this.mesh = new LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'rain';
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** `amount` 0 to 1; `open` whether the eye is under the sky; `light` how bright the day is. */
  update(time: number, eye: Vector3, amount: number, open: boolean, light: number, dt: number): void {
    // (Coming in under a roof the rain is not drawn at once gone, nor going out at once there: it thins and thickens over a moment.)
    this.shown += ((open ? amount : 0) - this.shown) * Math.min(1, dt * 3);
    this.mesh.visible = this.shown > 0.01;
    this.uTime.value = time;
    this.uEye.value.copy(eye);
    this.uAmount.value = this.shown;
    this.uLight.value = light;
  }
}
