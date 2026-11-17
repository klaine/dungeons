import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Rng } from '../core/rng';

/**
 * Gulls. A cliff coast is never still: birds hang on the wind off the edge, wheel out over the
 * water and come back. Each is two wings and a body, a few triangles, flying a loop of its own
 * about a point off the cliffs: a long oval, tilted, some wide and slow, some tight. It glides
 * most of the time and now and then beats its wings. All of it is worked out where it is drawn,
 * from the time and what each bird was given at the start, so it costs nothing to keep them flying.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, cos, float, max, mix, positionLocal, sin, smoothstep, uniform, vec3, vec4, abs } = TSL as N;

export class Birds {
  readonly mesh: Mesh;
  private readonly uTime: N = uniform(0);

  /** `spots` are where flocks wheel: points off the cliffs at about the height of their tops. */
  constructor(spots: { x: number; y: number; z: number }[], seed: string, light: number) {
    const rng = new Rng(`birds/${seed}`);
    const position: number[] = [], centre: number[] = [], orbit: number[] = [], wing: number[] = [], index: number[] = [];
    // One bird: in its own measures, x across the wings, z along the body (forward is +z), y up.
    const shape: [number, number, number, number][] = [
      // x, y, z, and how far out along the wing the point is (0 at the body, 1 at the tip): the body,
      [0, 0, 0.32, 0], [0.07, 0, -0.05, 0], [-0.07, 0, -0.05, 0], [0, 0, -0.3, 0],
      // the left wing: its root, an elbow, and the tip,
      [-0.06, 0, 0.1, 0], [-0.42, 0.04, 0.06, 0.5], [-0.82, 0, -0.1, 1], [-0.4, 0.02, -0.08, 0.5], [-0.06, 0, -0.08, 0],
      // and the right.
      [0.06, 0, 0.1, 0], [0.42, 0.04, 0.06, 0.5], [0.82, 0, -0.1, 1], [0.4, 0.02, -0.08, 0.5], [0.06, 0, -0.08, 0],
    ];
    const tris = [[0, 1, 2], [1, 3, 2], [4, 5, 8], [5, 7, 8], [5, 6, 7], [9, 13, 10], [10, 13, 12], [10, 12, 11]];
    let birds = 0;
    for (const spot of spots) {
      const flock = rng.int(3, 8);
      for (let k = 0; k < flock; k++) {
        const base = position.length / 3, size = rng.range(0.85, 1.25);
        const along = rng.range(18, 60), across = along * rng.range(0.35, 0.8), speed = rng.range(5, 8.5) / along, phase = rng.range(0, Math.PI * 2), turn = rng.range(0, Math.PI * 2);
        const cx = spot.x + rng.range(-12, 12), cy = spot.y + rng.range(-6, 14), cz = spot.z + rng.range(-12, 12);
        // (Drawn once for the bird, not for each of its corners, or its corners would fly apart.)
        const way = rng.chance(0.5) ? 1 : -1, own = rng.range(0, 100), beat = rng.range(2, 6);
        for (const [x, y, z, w] of shape) {
          position.push(x * size, y * size, z * size);
          centre.push(cx, cy, cz);
          orbit.push(along, across, speed * way, phase);
          wing.push(w * Math.sign(x || 1) * size, turn, own, beat);
        }
        for (const t of tris) index.push(base + t[0], base + t[1], base + t[2]);
        birds++;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aCentre', new BufferAttribute(new Float32Array(centre), 3));
    geometry.setAttribute('aOrbit', new BufferAttribute(new Float32Array(orbit), 4));
    geometry.setAttribute('aWing', new BufferAttribute(new Float32Array(wing), 4));
    geometry.setIndex(index);
    const material = new MeshBasicNodeMaterial({ side: DoubleSide });
    const t = this.uTime;
    material.positionNode = Fn(() => {
      const c: N = attribute('aCentre', 'vec3'), o: N = attribute('aOrbit', 'vec4'), w: N = attribute('aWing', 'vec4');
      // Where on its loop the bird is, and which way it is going: the slope of the loop there.
      const a: N = t.mul(o.z).add(o.w).toVar();
      const ct = cos(w.y), st = sin(w.y);
      const lx: N = cos(a).mul(o.x), lz: N = sin(a).mul(o.y);
      const dx: N = sin(a).negate().mul(o.x).mul(o.z), dz: N = cos(a).mul(o.y).mul(o.z);
      const px = lx.mul(ct).sub(lz.mul(st)), pz = lx.mul(st).add(lz.mul(ct));
      const hx: N = dx.mul(ct).sub(dz.mul(st)).toVar(), hz: N = dx.mul(st).add(dz.mul(ct)).toVar();
      const hl: N = max(hx.mul(hx).add(hz.mul(hz)).sqrt(), 0.0001);
      const fx: N = hx.div(hl), fz: N = hz.div(hl);
      // It rises and falls a little on the wind, and banks into the turn.
      const lift = sin(a.mul(2).add(w.z)).mul(2.5);
      // Mostly gliding with the wings bent a little down at the tips; now and then a few beats.
      const beating = smoothstep(0.6, 0.85, sin(t.mul(0.35).add(w.z)));
      const flap: N = mix(float(-0.12), sin(t.mul(w.w.add(5)).add(w.z)).mul(0.5), beating).mul(abs(w.x));
      const p: N = positionLocal.add(vec3(0, flap, 0)).toVar();
      const bank: N = float(0.35).mul(o.z.sign());
      const py = p.y.add(p.x.mul(bank));
      // From the bird's own measures to the world: x across, z forward along the way it flies.
      const rx = fz, rz = fx.negate();
      return vec3(c.x.add(px).add(p.x.mul(rx)).add(p.z.mul(fx)), c.y.add(lift).add(py), c.z.add(pz).add(p.x.mul(rz)).add(p.z.mul(fz)));
    })();
    // White above and grey beneath, the wing tips black; lit only as much as the day is light.
    material.colorNode = Fn(() => {
      const w: N = attribute('aWing', 'vec4');
      const tip = smoothstep(0.75, 0.95, abs(w.x));
      return vec4(mix(vec3(0.8, 0.8, 0.78), vec3(0.06, 0.06, 0.07), tip).mul(light), 1);
    })();
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = `birds:${birds}`;
    this.mesh.layers.set(1);
  }

  update(time: number): void {
    this.uTime.value = time;
  }
}
