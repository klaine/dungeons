import { mergeParts } from './geom/mergeParts';
import {
  AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, PointLight,
  TorusGeometry, Vector3,
} from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { makePropMaterial } from './siteMaterial';

// (The pieces of shader program used below, taken untyped: see the note in `siteMaterial.ts`.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, float, floor, fract, mix, modelWorldMatrix, normalize, positionGeometry, pow, sin, smoothstep, uniform, uv, vec2, vec3, vec4 } = TSL as N;

const flameHash: N = Fn(([p0]: [N]) => {
  const p: N = fract(p0.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});
const flameNoise: N = Fn(([p]: [N]) => {
  const i: N = floor(p).toVar(), f0: N = fract(p);
  const f: N = f0.mul(f0).mul(f0.mul(-2).add(3)).toVar();
  return mix(mix(flameHash(i), flameHash(i.add(vec2(1, 0))), f.x), mix(flameHash(i.add(vec2(0, 1))), flameHash(i.add(vec2(1, 1))), f.x), f.y);
});

/**
 * A wall torch: an iron-bound brand on a bracket and an animated flame. It carries no light of its
 * own; `TorchLights` lends real lights to whichever torches are nearest the player.
 */

let TORCH_IRON: ReturnType<typeof makePropMaterial> | null = null, TORCH_WOOD: ReturnType<typeof makePropMaterial> | null = null;

export class Torch {
  readonly group = new Group();
  readonly flamePosition = new Vector3();
  readonly lightPosition = new Vector3();
  readonly phase: number;
  /** Brightness of the flame this frame, including flicker. */
  flicker = 1;
  private flame: NodeMaterial;
  private readonly uTime: { value: number } = uniform(0);
  private readonly uGain: { value: number } = uniform(1);

  constructor(position: Vector3, out: Vector3, phase: number, fire = 0, flames?: Vector3[]) {
    this.phase = phase;

    // (One iron and one wood for every torch: a material of its own for each was a set of uniforms and a pipeline for each.)
    const iron = (TORCH_IRON ??= makePropMaterial({ color: new Color(0.05, 0.045, 0.04), roughness: 0.55, metalness: 0.9 }));
    const wood = (TORCH_WOOD ??= makePropMaterial({ color: new Color(0.12, 0.07, 0.04), roughness: 0.9, metalness: 0 }));

    // The brand leans out from the wall; its head is at `position`.
    const lean = 0.42;
    const brand = new Mesh(new CylinderGeometry(0.045, 0.024, 0.62, 10), wood);
    const axis = new Vector3(0, Math.cos(lean), 0).addScaledVector(out, Math.sin(lean)).normalize();
    brand.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis);
    brand.position.copy(position).addScaledVector(axis, -0.31);
    const head = new Mesh(new CylinderGeometry(0.062, 0.05, 0.14, 10), iron);
    head.quaternion.copy(brand.quaternion);
    head.position.copy(position).addScaledVector(axis, -0.06);
    const ring = new Mesh(new TorusGeometry(0.055, 0.012, 6, 14), iron);
    ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis);
    ring.position.copy(position).addScaledVector(axis, -0.36);
    const arm = new Mesh(new CylinderGeometry(0.014, 0.014, 0.3, 6), iron);
    arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), out);
    arm.position.copy(ring.position).addScaledVector(out, -0.13);
    // (An open fire has none of that: only the flame, standing on whatever was built for it to burn on; nor have candles.)
    if (!fire && !flames) {
      for (const m of [brand, head, ring, arm]) { m.castShadow = false; this.group.add(m); }
      // (The iron parts drawn as one.)
      mergeParts(this.group);
    }

    // (The fire drawn on the sheet starts at its foot, 0.35 below its middle; so the middle stands that far, less a little, over the
    // top of the iron cup, and the flame comes out of the cup. Set along the brand instead, it hung beside the cup and below its rim.)
    if (fire) this.flamePosition.copy(position).add(new Vector3(0, 0.3 * fire, 0));
    else this.flamePosition.copy(position).addScaledVector(axis, 0.01).add(new Vector3(0, 0.3, 0));
    // The flame is a sheet that turns to face whoever looks at it, staying upright, with fire drawn on it.
    const flame = (this.flame = new NodeMaterial());
    flame.transparent = true;
    flame.blending = AdditiveBlending;
    flame.depthWrite = false;
    flame.side = DoubleSide;
    flame.vertexNode = Fn(() => {
      const centre: N = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
      const flat: N = cameraPosition.sub(centre).mul(vec3(1, 0, 1));
      const toCam: N = normalize(flat);
      const right = vec3(toCam.z, 0, toCam.x.negate());
      const wp = centre.add(right.mul(positionGeometry.x)).add(vec3(0, 1, 0).mul(positionGeometry.y));
      return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(wp, 1));
    })();
    flame.fragmentNode = Fn(() => {
      const p: N = uv().mul(2).sub(1).toVar();
      const t: N = (this.uTime as N).add(phase * 10);
      const up: N = p.y.add(1).mul(0.5).toVar();
      const n: N = flameNoise(vec2(p.x.mul(3), p.y.mul(2.2).sub(t.mul(3.2)))).mul(0.6).add(flameNoise(vec2(p.x.mul(7), p.y.mul(5).sub(t.mul(5.5)))).mul(0.4)).toVar();
      p.x.addAssign(n.sub(0.5).mul(0.5).mul(up).add(sin(t.mul(2.3).add(p.y.mul(3))).mul(0.06).mul(up)));
      const width: N = mix(0.52, 0.05, pow(up, 1.25));
      const shape = float(1).sub(smoothstep(width.mul(0.35), width, abs(p.x)));
      const body: N = shape.mul(smoothstep(-1, -0.72, p.y)).mul(float(1).sub(smoothstep(0.25, 0.95, p.y.add(n.sub(0.5).mul(0.7))))).toVar();
      const core = body.mul(body).mul(float(1).sub(smoothstep(-0.5, 0.35, p.y)));
      const col = mix(vec3(1, 0.16, 0.01), vec3(1, 0.55, 0.12), body).mul(body).mul(2.2).add(vec3(1, 0.85, 0.55).mul(core).mul(4));
      return vec4(col.mul(this.uGain as N), body);
    })();
    if (flames) {
      // Candles: a small flame on each wick, its foot just below the wick's tip; all drawn with the one material. (With `fire` too,
      // the flames of a hearth along its logs: larger, each its own size, and every other one turned about, so they are not alike.)
      const S = fire ? 0.62 * fire : 0.13;
      this.flamePosition.copy(position);
      flames.forEach((wick, k) => {
        const s = fire ? [1, 0.78, 0.9, 0.7][k % 4] : 1;
        // (A hearth's flames drawn twice as broad as a torch's: a fire of logs is a broad low fire, not a tongue.)
        const quad = new Mesh(new PlaneGeometry(0.4 * S * s * (k % 2 ? -1 : 1) * (fire ? 2.1 : 1), 0.7 * S * s), this.flame);
        quad.position.copy(wick).add(new Vector3(0, 0.35 * S * s - 0.008, 0));
        quad.frustumCulled = false;
        this.group.add(quad);
      });
    } else {
      const quad = new Mesh(new PlaneGeometry(0.4 * (fire || 1), 0.7 * (fire || 1)), this.flame);
      quad.position.copy(this.flamePosition);
      quad.frustumCulled = false;
      this.group.add(quad);
    }

    if (flames) this.lightPosition.copy(position);
    else if (fire) this.lightPosition.copy(position).add(new Vector3(0, 0.55, 0));
    else this.lightPosition.copy(position).addScaledVector(out, 0.36).add(new Vector3(0, 0.26, 0));
  }

  update(time: number): void {
    const t = time * 7 + this.phase * 31;
    this.flicker = 0.86 + 0.09 * Math.sin(t) + 0.05 * Math.sin(t * 2.7 + 1.3) + 0.04 * Math.sin(t * 5.1 + 0.4);
    this.uTime.value = time;
    this.uGain.value = this.flicker;
  }
}

/**
 * A fixed pool of shadow-casting lights shared among many torches. The nearest torches hold the
 * lights; when the player moves on, a light fades out, moves to its new torch, redraws its shadow
 * map once, and fades back in. Torches without a light still glow, and still light their rooms
 * through the bake's bounced light.
 */
export class TorchLights {
  readonly lights: PointLight[] = [];
  private slots: { torch: Torch | null; fade: number }[] = [];

  constructor(private torches: Torch[], count: number, private intensity: number) {
    for (let i = 0; i < count; i++) {
      const light = new PointLight(new Color(1.0, 0.6, 0.3), 0, 0, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.08;
      light.shadow.camera.far = 24;
      light.shadow.bias = -0.003;
      light.shadow.normalBias = 0.03;
      light.shadow.autoUpdate = false;
      this.lights.push(light);
      this.slots.push({ torch: null, fade: 0 });
    }
  }

  update(dt: number, viewer: Vector3): void {
    // The torches that should be lit: nearest first. A torch already lit keeps a small advantage,
    // so lights do not swap back and forth at a boundary.
    const held = new Set(this.slots.map((s) => s.torch));
    const wanted = [...this.torches]
      .sort((a, b) => score(a) - score(b))
      .slice(0, this.lights.length);
    function score(t: Torch): number {
      return t.lightPosition.distanceTo(viewer) - (held.has(t) ? 1.5 : 0);
    }
    const wantedSet = new Set(wanted);
    let moved = false;
    this.slots.forEach((slot, i) => {
      const light = this.lights[i];
      const keep = slot.torch !== null && wantedSet.has(slot.torch);
      slot.fade = Math.min(1, Math.max(0, slot.fade + (keep ? dt : -dt) * 3.5));
      if (!keep && slot.fade === 0 && !moved) {
        // One move per frame: each redraws a cube shadow map.
        const next = wanted.find((t) => !this.slots.some((s) => s.torch === t));
        slot.torch = next ?? null;
        if (next) {
          light.position.copy(next.lightPosition);
          light.shadow.needsUpdate = true;
          moved = true;
        }
      }
      light.intensity = slot.torch ? this.intensity * slot.torch.flicker * slot.fade : 0;
    });
  }

  /** Position and strength of each light now, for the glow in the air round it. */
  state(): { position: Vector3; strength: number }[] {
    return this.slots.map((s, i) => ({ position: s.torch ? s.torch.flamePosition : this.lights[i].position, strength: s.torch ? s.fade : 0 }));
  }
}
