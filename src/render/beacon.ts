import { AdditiveBlending, ConeGeometry, DoubleSide, Group, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * The lighthouse's beam, at dusk and by night: two shafts of light turning about the lamp, seen
 * where they cross the damp air, brightest by the lantern and dying away over a few hundred
 * metres. Each is an open cone drawn faintly and added to what is behind it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, float, pow, smoothstep, uv, vec4, abs } = TSL as N;

export class Beacon {
  readonly group = new Group();

  constructor(at: { x: number; y: number; z: number }, strength: number) {
    const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
    // (Along the cone, `uv.y` runs from its wide end at 0 to the lamp at 1; around it, `uv.x`.)
    material.colorNode = Fn(() => {
      const near: N = uv().y;
      const fall = pow(near, 2.2).mul(smoothstep(1, 0.97, near));
      // Brighter along its middle as seen from the side: the edges of a cone are seen through less of it.
      const edge = abs(uv().x.mul(2).sub(1).fract().sub(0.5)).mul(2);
      return vec4(float(1).mul(0.95), float(0.85), float(0.62), fall.mul(float(0.5).add(edge.mul(0.5))).mul(strength));
    })();
    const length = 320;
    for (const turn of [0, Math.PI]) {
      const cone = new ConeGeometry(16, length, 24, 1, true);
      // Its point at the lamp, opening out along +x.
      cone.translate(0, -length / 2, 0);
      cone.rotateZ(Math.PI / 2);
      const mesh = new Mesh(cone, material);
      mesh.rotation.y = turn;
      mesh.renderOrder = 4;
      mesh.frustumCulled = false;
      mesh.layers.set(1);
      this.group.add(mesh);
    }
    this.group.position.set(at.x, at.y, at.z);
  }

  update(time: number): void {
    // Once round in about twelve seconds, and dipped a little below level, towards the sea.
    this.group.rotation.set(0, time * 0.52, -0.02);
  }
}
