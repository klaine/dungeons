import { Camera, DepthTexture, DirectionalLight, Matrix4, Object3D, Vector3 } from 'three';
import { ShadowBaseNode } from 'three/webgpu';
import * as TSL from 'three/tsl';

// (The pieces of shader program used below, taken untyped: see the note in `siteMaterial.ts`.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, If, abs, float, max, min, mix, normalWorld, shadow, shadowPositionWorld, smoothstep, step, texture, uniform, vec2, vec4 } = TSL as N;

/** A light that stands only for where a shadow is seen from: what `shadow` needs of a light. */
class Eye extends Object3D {
  readonly target = new Object3D();
  castShadow = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shadow: any;
}

/**
 * The sun's shadow, from two maps. The sun's shadow was drawn once, over the box of a place (`desc.bounds`), into a map 4096 points
 * square: in a valley that is a point to every five centimetres, but a harbour town is a kilometre across, and there a point of the
 * map was a quarter of a metre, so that near the eye every sill, moulding and post threw a shadow of soft blocks. And outside the box
 * there was no shadow at all: a mountain top's box is the house's, and the whole climb up to it, from where the player arrives, lay
 * in an unshadowed sun; a valley's ends a few strides behind where the player arrives.
 *
 * So the sun's own map is now drawn over a square some hundred and thirty metres across about the eye, 2048 points square, six
 * centimetres to a point, as fine as a valley's. It is not drawn every frame: only when the eye has gone a fifth of the way to the
 * square's edge from where it was last drawn, and the square is then put where the eye is, so that the eye is always well inside it.
 *
 * Beyond the square, and over the last part of the way to its edge, the shadow is read from the picture the air is lit from, taken
 * from the sun over the whole place when it is built (`Atmosphere.sunMap`; the land, its rock, what is built on it and the crowns of
 * trees are in it): a point of it is half a metre in a town, which is enough for what is that far off. It is read as four points of
 * the picture, each said to be in the light or not, and the four mixed by how near each is. (A second map read the ordinary way would
 * have been simpler, but the ground's material already reads all the textures the graphics interface lets one program read through a
 * filter, and one more could not be had: the air's picture is read without one.)
 */
export class SunShadow extends ShadowBaseNode {
  private readonly near = new Eye();
  private readonly nearShadow: N;
  /** From a point of the world to where it is in the near square, -1 to 1 across and up. */
  private readonly uNear: N = uniform(new Matrix4());
  private readonly at = new Vector3(Infinity, Infinity, Infinity);
  /** How many times the near map has been drawn again; for tuning. */
  redrawn = 0;

  /**
   * `eye` is whose eye the near square follows; `reach` half the breadth of the square, in metres; `size` how many points square its
   * map is; `radius` how far the place reaches from its middle. `far` is the air's picture from the sun: its depths, from a point of
   * the world to where it is in the picture, how deep the picture is in metres, how broad one of its points is, and whether the
   * graphics interface reckons depth from 0 (WebGPU) or from -1.
   */
  constructor(private readonly sun: DirectionalLight, private readonly eye: Camera, private readonly o: { reach: number; size: number; radius: number; far: { depth: DepthTexture; vp: N; deep: number; point: number; gpu: boolean } }) {
    super(sun);
    const map = (this.near.shadow = sun.shadow.clone());
    map.autoUpdate = false;
    map.needsUpdate = true;
    map.mapSize.set(o.size, o.size);
    // (As deep into the place as the whole place reaches, so that whatever stands up-sun of the square inside the place shades it too.)
    const deep = o.radius * 4 + 10;
    Object.assign(map.camera, { left: -o.reach, right: o.reach, top: o.reach, bottom: -o.reach, near: 1, far: deep });
    map.camera.updateProjectionMatrix();
    // (The bias is a share of the map's depth: kept as many metres as the whole map's was, less as its points are finer.)
    const wholeDeep = sun.shadow.camera.far - sun.shadow.camera.near, wholePoint = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.width;
    const nearPoint = (2 * o.reach) / o.size, finer = Math.max(0.25, nearPoint / wholePoint);
    map.bias = (sun.shadow.bias * wholeDeep * finer) / deep;
    // (And the point a surface is looked up from moved out along its normal by most of one of the map's points, and the map read over
    // a little more than a point about it: with less, the shadow of a long straight edge thrown slantwise across a wall, a string
    // course's or a sill's, came out as a row of small teeth, and a lit wall turned to the sun at a slant had faint stripes of shadow on it.)
    map.normalBias = Math.max(sun.shadow.normalBias * finer, 0.8 * nearPoint);
    map.radius = 1.8;
    this.nearShadow = shadow(this.near, map);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build(builder: any): any {
    // (Before the near map's own node, so that the square is moved before it is drawn.)
    builder.addSequentialNode(this);
    return super.build(builder);
  }

  /** In the light (1) or not (0), from the air's picture, at a point of the world. */
  private far(): N {
    const f = this.o.far;
    // (Moved a point of the picture out from the surface along its normal, and compared with a metre and a half of slack: the
    // picture is coarse, and a surface would otherwise shade itself in stripes.)
    const p: N = shadowPositionWorld.add(normalWorld.mul(f.point * 1.2));
    const c: N = f.vp.mul(vec4(p, 1));
    const s: N = c.xyz.div(c.w).toVar();
    const deep: N = f.gpu ? s.z : s.z.mul(0.5).add(0.5);
    const size = f.depth.image.width as number;
    const at: N = vec2(s.x.mul(0.5).add(0.5), s.y.mul(-0.5).add(0.5)).mul(size).sub(0.5).toVar();
    const base: N = at.floor().toVar(), w: N = at.sub(base).toVar();
    // (A point further from the sun than the picture reaches is shaded only by what the picture holds between it and the sun: compared
    // as it was, with its own depth past the picture's end, the empty picture behind everything said it was in shadow. At evening the
    // picture's box lies slantwise over the land, and the land down-sun of it was a dark strip with straight sides, wherever the near
    // map did not reach.)
    const lit = (dx: number, dy: number): N => step(min(deep, 1).sub(1.5 / f.deep), (texture(f.depth, base.add(vec2(dx, dy)).add(0.5).div(size)) as N).level(0).x);
    const out: N = mix(mix(lit(0, 0), lit(1, 0), w.x), mix(lit(0, 1), lit(1, 1), w.x), w.y);
    // (Outside the picture there is nothing to shade it; and a shadow running out past its side fades over the last tenth of the way,
    // and is not cut off along a line.)
    return mix(float(1), out, float(1).sub(smoothstep(0.9, 0.999, max(abs(s.x), abs(s.y)))));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(builder: any): any {
    return Fn(() => {
      this.setupShadowPosition(builder);
      const p: N = this.uNear.mul(vec4(shadowPositionWorld, 1));
      // How far inside the near square, from 1 at its middle to 0 at its edge: the near map alone well inside, the air's picture beyond.
      const inside: N = float(1).sub(smoothstep(0.75, 0.97, max(abs(p.x), abs(p.y)))).toVar();
      // (The near map is read at every point: it is read with a comparison, which the graphics interface allows only where every
      // point of a group of the picture takes the same way through the program. The air's picture, read without one, is read only
      // where it is wanted.)
      const out: N = vec4(this.nearShadow).toVar();
      If(inside.lessThan(0.999), () => { out.assign(mix(vec4(this.far()), out, inside)); });
      return out;
    })();
  }

  updateBefore(): undefined {
    const sun = this.sun;
    if (!this.near.parent && sun.parent) { sun.parent.add(this.near.target); sun.parent.add(this.near); }
    // Whatever asks for the sun's shadow to be drawn again (as the program does over its first frames) has the near map drawn again.
    if (sun.shadow.needsUpdate) {
      sun.shadow.needsUpdate = false;
      this.at.set(Infinity, Infinity, Infinity);
    }
    const eye = this.eye.position;
    if (this.at.distanceTo(eye) < this.o.reach * 0.2) return undefined;
    // The square is put where the eye is, and drawn again.
    this.at.copy(eye);
    const toSun = sun.position.clone().sub(sun.target.position).normalize();
    this.near.target.position.copy(eye);
    this.near.position.copy(eye).addScaledVector(toSun, this.o.radius * 2 + 5);
    this.near.updateMatrixWorld();
    this.near.target.updateMatrixWorld();
    const cam = this.near.shadow.camera;
    cam.position.copy(this.near.position);
    cam.lookAt(this.near.target.position);
    cam.updateMatrixWorld();
    (this.uNear.value as Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.near.shadow.needsUpdate = true;
    this.redrawn++;
    return undefined;
  }
}
