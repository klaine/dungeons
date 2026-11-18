import { BufferAttribute, BufferGeometry, Camera, DoubleSide, LineSegments, Mesh, Vector3 } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Rng } from '../core/rng';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, cos, float, fract, length, positionLocal, select, sin, smoothstep, uniform, vec3, vec4 } = TSL as N;

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

/**
 * Snow falling, for when it is cold enough that what falls is snow: flakes drifting down slowly about whoever is looking, in the
 * same box of air that goes with them, each swaying on its way as it falls and turning a little, drawn as a small soft patch of
 * white facing the eye. As the rain, worked out where it is drawn, and not under a roof.
 */
export class Snowfall {
  readonly mesh: Mesh;
  private readonly uTime: N = uniform(0);
  private readonly uEye: N = uniform(new Vector3());
  private readonly uAmount: N = uniform(0);
  private readonly uLight: N = uniform(1);
  private readonly uRight: N = uniform(new Vector3(1, 0, 0));
  private readonly uUp: N = uniform(new Vector3(0, 1, 0));
  private shown = 0;

  constructor(seed: string) {
    const rng = new Rng(`snow/${seed}`), count = 7000, BOX = 26, HIGH = 16;
    const where = new Float32Array(count * 4 * 3), flake = new Float32Array(count * 4 * 4), corner = new Float32Array(count * 4 * 2), index: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = rng.range(0, BOX), z = rng.range(0, BOX), start = rng.next(), speed = rng.range(0.7, 1.5), share = rng.next(), size = rng.range(0.012, 0.03);
      const sway = rng.range(0, Math.PI * 2);
      for (let c = 0; c < 4; c++) {
        where.set([x, start, z], (i * 4 + c) * 3);
        flake.set([speed, size, share, sway], (i * 4 + c) * 4);
        corner.set([c & 1 ? 1 : -1, c & 2 ? 1 : -1], (i * 4 + c) * 2);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(where, 3));
    geometry.setAttribute('aFlake', new BufferAttribute(flake, 4));
    geometry.setAttribute('aCorner', new BufferAttribute(corner, 2));
    geometry.setIndex(index);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const t = this.uTime, eye = this.uEye, amount = this.uAmount, right = this.uRight, up = this.uUp;
    material.positionNode = Fn(() => {
      const p: N = positionLocal, f: N = attribute('aFlake', 'vec4'), c: N = attribute('aCorner', 'vec2');
      const fallen: N = fract(p.y.add(t.mul(f.x).div(HIGH)));
      // (Swaying as it falls, this way and that, a stride or so across.)
      const swayX: N = sin(t.mul(0.9).add(f.w)).mul(0.6), swayZ: N = cos(t.mul(0.7).add(f.w.mul(1.7))).mul(0.6);
      const y: N = eye.y.add(HIGH * 0.55).sub(fallen.mul(HIGH));
      const x: N = fract(p.x.add(swayX).sub(eye.x).div(BOX)).mul(BOX).add(eye.x).sub(BOX / 2);
      const z: N = fract(p.z.add(swayZ).sub(eye.z).div(BOX)).mul(BOX).add(eye.z).sub(BOX / 2);
      const gone: N = select(f.z.greaterThan(amount), float(-1000), float(0));
      return vec3(x, y.add(gone), z).add(right.mul(c.x.mul(f.y))).add(up.mul(c.y.mul(f.y)));
    })();
    material.colorNode = Fn(() => {
      const c: N = attribute('aCorner', 'vec2');
      return vec4(vec3(0.95, 0.96, 1).mul(this.uLight), float(0.85).mul(smoothstep(1, 0.2, length(c))));
    })();
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'snowfall';
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  update(time: number, camera: Camera, amount: number, open: boolean, light: number, dt: number): void {
    this.shown += ((open ? amount : 0) - this.shown) * Math.min(1, dt * 3);
    this.mesh.visible = this.shown > 0.01;
    this.uTime.value = time;
    this.uEye.value.copy(camera.position);
    this.uAmount.value = this.shown;
    this.uLight.value = light;
    // (Each flake faces the eye: the eye's own right and up, as the camera is turned.)
    camera.matrixWorld.extractBasis(this.uRight.value, this.uUp.value, SCRATCH);
  }
}
const SCRATCH = new Vector3();
