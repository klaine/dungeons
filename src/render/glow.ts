import { AdditiveBlending, BufferAttribute, BufferGeometry, Camera, Mesh, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, cameraPosition, exp, float, normalize, positionLocal, uniform, vec4 } = TSL as N;

/**
 * The haze of light about a lit window after dark, as the eye sees any bright thing at night: a soft round of the window's own
 * colour, larger than the window, standing a little out from it towards whoever looks, so the wall round the window hides only
 * what is behind it, and from behind the house the house hides it all. Every pane of lit glass is found in the geometry already
 * built: the panes are boxes of twenty-four corners, and the light's colour is theirs.
 */
export class WindowGlow {
  readonly mesh: Mesh;
  private readonly uRight: N = uniform(new Vector3(1, 0, 0));
  private readonly uUp: N = uniform(new Vector3(0, 1, 0));

  /** `panes`: the position and colour attributes of the lit glass, as built. `bright`: how strong the haze is at this hour. */
  constructor(panes: { position: ArrayLike<number>; color: ArrayLike<number> }[], bright: number) {
    const centres: number[] = [], sizes: number[] = [], colours: number[] = [];
    for (const { position: p, color: c } of panes) {
      for (let b = 0; b + 24 <= p.length / 3; b += 24) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let v = b; v < b + 24; v++) {
          x0 = Math.min(x0, p[v * 3]); x1 = Math.max(x1, p[v * 3]); y0 = Math.min(y0, p[v * 3 + 1]); y1 = Math.max(y1, p[v * 3 + 1]); z0 = Math.min(z0, p[v * 3 + 2]); z1 = Math.max(z1, p[v * 3 + 2]);
        }
        centres.push((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        sizes.push(Math.max(x1 - x0, z1 - z0), y1 - y0);
        colours.push(c[b * 3], c[b * 3 + 1], c[b * 3 + 2]);
      }
    }
    const count = centres.length / 3;
    const where = new Float32Array(count * 12), size = new Float32Array(count * 8), tint = new Float32Array(count * 12), corner = new Float32Array(count * 8), index: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 4; k++) {
        where.set(centres.slice(i * 3, i * 3 + 3), (i * 4 + k) * 3);
        size.set(sizes.slice(i * 2, i * 2 + 2), (i * 4 + k) * 2);
        tint.set(colours.slice(i * 3, i * 3 + 3), (i * 4 + k) * 3);
        corner.set([k & 1 ? 1 : -1, k & 2 ? 1 : -1], (i * 4 + k) * 2);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(where, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 2));
    geometry.setAttribute('aTint', new BufferAttribute(tint, 3));
    geometry.setAttribute('aCorner', new BufferAttribute(corner, 2));
    geometry.setIndex(index);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const right = this.uRight, up = this.uUp;
    material.positionNode = Fn(() => {
      const p: N = positionLocal, s: N = attribute('aSize', 'vec2'), c: N = attribute('aCorner', 'vec2');
      // Half a metre out towards the eye; and some two or three times the window's size, a little wider than it is tall.
      const out: N = normalize(cameraPosition.sub(p)).mul(0.5);
      const r: N = s.x.add(s.y).mul(0.5).mul(1.35).add(0.35);
      return p.add(out).add(right.mul(c.x.mul(r).mul(1.15))).add(up.mul(c.y.mul(r)));
    })();
    material.colorNode = Fn(() => {
      const c: N = attribute('aCorner', 'vec2'), t: N = attribute('aTint', 'vec3');
      const d2: N = c.x.mul(c.x).add(c.y.mul(c.y));
      // (A falling-off that is already nearly nothing at the edge of the patch, so no edge is seen.)
      const glow: N = exp(d2.mul(-5)).sub(exp(float(-5))).max(0);
      return vec4(t.mul(glow.mul(bright)), float(1));
    })();
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'windowGlow';
    this.mesh.renderOrder = 2;
    this.mesh.visible = count > 0;
  }

  update(camera: Camera): void {
    camera.matrixWorld.extractBasis(this.uRight.value, this.uUp.value, SCRATCH);
  }
}
const SCRATCH = new Vector3();
