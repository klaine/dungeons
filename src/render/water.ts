import { BufferAttribute, BufferGeometry, Camera, CanvasTexture, CircleGeometry, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, Texture, Vector2, Vector3 } from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Atmosphere, skyParts } from './post';
import { Rng } from '../core/rng';

/**
 * Water, still and running. Still water is a level sheet over a hollow in the ground: dark, nearly a mirror, and thin enough
 * at the edge to show the bed. Its surface is ruffled by a ripple pattern that drifts, which is
 * what breaks the sky's reflection into moving light.
 */

/** A tiling pattern of ripples, as a normal map: a sum of waves that all fit the square exactly. */
export function rippleMap(size = 256): Texture {
  const rng = new Rng('ripples');
  const waves: [number, number, number, number][] = [];
  for (let k = 0; k < 22; k++) {
    const fx = rng.int(-9, 9), fy = rng.int(-9, 9);
    if (fx === 0 && fy === 0) continue;
    waves.push([fx, fy, rng.range(0, Math.PI * 2), 1 / Math.hypot(fx, fy) ** 1.1]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    for (const [fx, fy, phase, amp] of waves) {
      const c = Math.cos(fx * u + fy * v + phase) * amp;
      dx += c * fx;
      dy += c * fy;
    }
    const l = Math.hypot(dx * 0.35, dy * 0.35, 1), i = (y * size + x) * 4;
    image.data[i] = 127.5 + (127.5 * -dx * 0.35) / l;
    image.data[i + 1] = 127.5 + (127.5 * -dy * 0.35) / l;
    image.data[i + 2] = 127.5 + 127.5 / l;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

// (The pieces of shader program used below, taken untyped: see the note in `siteMaterial.ts`.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const {
  Fn, If, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, distance, dot, exp, float, getViewPosition, length, max, min, mix, normalize,
  positionWorld, pow, reflect, reflector, select, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} = TSL as N;
const one = (x: N): N => float(1).sub(x);
/** `smoothstep`, which may also be asked to fall instead of rise (the first edge above the second). */
const sstep = (a: number, b: number, x: N): N => (a > b ? one(smoothstep(b, a, x)) : smoothstep(a, b, x));

/**
 * Where a point of the world is in the picture now being drawn, across and down, each from 0 to 1.
 * A mirror's picture is read at the same place flipped left for right.
 */
const inPicture = (p: N): N => {
  const clip: N = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1));
  const at: N = clip.xy.div(clip.w).mul(0.5).add(0.5);
  return vec2(one(at.x), one(at.y));
};

/**
 * What a mirror shows, with the sky's weather and the air put into it. A mirror's picture is
 * drawn without either. Where it shows open sky (nothing there, at any distance) the clouds are
 * put in: they are not things in the scene. Anything else is seen through as much air as lies
 * along the whole way to it, from the eye down to the water and on up to the thing, which the
 * picture's depths give; without this a far hill would stand sharper and darker in the lake
 * than it stands above it. `at` is where in the picture to look, `from` the point of the water,
 * `dir` the way the mirrored line of sight goes from there.
 */
const mirrored = (m: Mirror, sky: ReturnType<typeof skyParts>, u: Record<string, N>, at: N, from: N, dir: N): N => Fn(() => {
  const shown: N = m.picture.sample(at).rgb.toVar();
  const depth: N = m.depth.sample(at).toVar();
  If(depth.greaterThan(0.999999), () => {
    If(u.uCloudOn.greaterThan(0.5), () => {
      const cloud: N = sky.cloudMarch(from, dir, float(0.5), float(1e9)).toVar();
      shown.assign(shown.mul(cloud.a).add(cloud.rgb));
    });
  }).ElseIf(u.uAirOn.greaterThan(0.5), () => {
    // That is how far the thing is from the eye by way of the water; the air between eye and water is put in with the land's.
    const far: N = max(length(getViewPosition(vec2(at.x, at.y), depth, m.unproject)).sub(distance(cameraPosition, from)), 0).toVar();
    const thick: N = sky.airBeyond(from, dir, float(0), far, far).toVar();
    const through: N = exp(thick.x.negate().sub(thick.y)).toVar();
    shown.assign(shown.mul(through).add(sky.airColour(dir).mul(one(through))));
  });
  // The glare of the sun's own disc is spread by the ripples; unspread it would be a hard white dot.
  return min(shown, vec3(9));
})();

/** One mirror: a level at which the scene is drawn a second time, upside down, as water lying there would show it. */
interface Mirror {
  /** The picture, and how far off each thing in it is. */
  picture: N;
  depth: N;
  /** Stands where the mirror lies, facing up. */
  at: Object3D;
  level: number;
  /** From a place in the picture and its depth back to where the thing is, as the mirror's eye saw it. */
  unproject: N;
  eyeOf: (camera: Camera) => Camera;
}

function makeMirror(size: number, level: number, x: number, z: number): Mirror {
  // (Its picture is as large as asked for, against a screen about a thousand points high. It is drawn
  // with one sample to a point: its depths are read, which a picture of several samples does not allow, and ripples hide its edges.)
  const picture: N = reflector({ resolutionScale: Math.min(1, size / 1024), bounces: false, depth: true });
  const at: Object3D = picture.target;
  at.rotation.x = -Math.PI / 2;
  at.position.set(x, level, z);
  const base = picture.reflector, eyeOf = base.getVirtualCamera.bind(base);
  // What is marked as not to be mirrored is kept out of the picture.
  base.getVirtualCamera = (camera: Camera) => { const eye = eyeOf(camera); eye.layers.set(0); return eye; };
  return { picture, depth: picture.getDepthNode(), at, level, unproject: uniform(new Matrix4()), eyeOf: base.getVirtualCamera };
}

export class Water {
  readonly meshes: Mesh[] = [];
  private ripples = rippleMap();
  private material: MeshStandardMaterial;
  private mirrors: Mirror[] = [];
  private still: { material: NodeMaterial; mirror: Mirror }[] = [];
  private flowing: NodeMaterial | null = null;
  /** The mirror whose picture running water borrows. */
  private sheet: Mirror | null = null;
  private spray: NodeMaterial | null = null;
  private readonly uTime: N = uniform(0);
  /** How far running water may trust the mirror's picture: not at all once the eye is down at the mirror's level. */
  private readonly uPictured: N = uniform(0);
  private readonly look: { deep: N; zenith: N; horizon: N; land: N; foam: N };

  /**
   * Still water is a level sheet with the outline of its pond; running water is a ribbon laid
   * down the course of its stream, falling as the bed falls, whose ripples travel downstream.
   */
  constructor(
    pools: { x: number; z: number; r: number; level: number; outline?: number[]; far?: boolean }[],
    streams: { line: number[]; width: number; banks?: number[]; fade?: number[] }[] = [],
    /**
     * `mirror` is the size of the picture still water reflects, in pixels; 0 for none, and the sky alone is mirrored.
     * `deep` is the colour of deep water in this light. The rest is for running water where it has no picture to
     * mirror: the sky overhead and at the horizon, land in shade, and something white in this light.
     */
    o: { mirror?: number; deep?: [number, number, number]; zenith?: number[]; horizon?: number[]; land?: number[]; foam?: number[]; falls?: { x: number; y: number; z: number; height: number; width: number }[]; smokes?: { x: number; y: number; z: number; height: number }[] } = {},
  ) {
    const vec = (v: number[] | undefined, x: number, y: number, z: number): N => uniform(new Vector3(v?.[0] ?? x, v?.[1] ?? y, v?.[2] ?? z));
    this.look = { deep: vec(o.deep, 0.02, 0.05, 0.045), zenith: vec(o.zenith, 0.14, 0.28, 0.66), horizon: vec(o.horizon, 0.6, 0.72, 0.88), land: vec(o.land, 0.02, 0.03, 0.015), foam: vec(o.foam, 0.8, 0.8, 0.8) };
    this.ripples.repeat.set(1, 1);
    this.material = new MeshStandardMaterial({
      color: 0x0d2a26, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.84,
      normalMap: this.ripples, normalScale: new Vector2(0.2, 0.2), envMapIntensity: 2.2, depthWrite: false,
    });
    const sheet = (material: NodeMaterial) => { material.transparent = true; material.depthWrite = false; return material; };
    for (const pool of pools) {
      let geometry: BufferGeometry;
      if (pool.outline) {
        // Rings from the middle out to the shore and a little beyond it. Each point is marked
        // with how shallow the water is there: deep in the middle, nothing at the edge.
        const n = pool.outline.length / 2, rings = [[0.42, 0], [0.56, 0.35], [0.66, 1], [1, 1]];
        const position: number[] = [0, 0, 0], shallow: number[] = [0], index: number[] = [];
        for (const [share, clear] of rings) for (let k = 0; k < n; k++) {
          position.push((pool.outline[k * 2] - pool.x) * share, 0, (pool.outline[k * 2 + 1] - pool.z) * share);
          shallow.push(clear);
        }
        for (let k = 0; k < n; k++) {
          const k1 = (k + 1) % n;
          // Wound to face the sky.
          index.push(0, 1 + k1, 1 + k);
          for (let r = 0; r < rings.length - 1; r++) {
            const a = 1 + r * n + k, b = 1 + r * n + k1, c = 1 + (r + 1) * n + k, d = 1 + (r + 1) * n + k1;
            index.push(a, b, d, a, d, c);
          }
        }
        geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
        // The ripples are sized in metres, whatever the size of the pool.
        geometry.setAttribute('uv', new BufferAttribute(new Float32Array(position.flatMap((v, i) => (i % 3 === 1 ? [] : [v * 0.25]))), 2));
        geometry.setAttribute('aShallow', new BufferAttribute(new Float32Array(shallow), 1));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
      } else {
        geometry = new CircleGeometry(pool.r, 40);
        geometry.rotateX(-Math.PI / 2);
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * pool.r * 0.5, (uv.getY(i) - 0.5) * pool.r * 0.5);
        geometry.setAttribute('aShallow', new BufferAttribute(new Float32Array(uv.count), 1));
      }
      let mesh: Mesh;
      // (Not a lake far off in the country: a mirror is a second drawing of the scene, and a lake a kilometre off is not worth one.)
      if (o.mirror && !pool.far) {
        // A mirror: the scene is drawn a second time as water lying at this level would show it, and the water reads that picture.
        const mirror = makeMirror(o.mirror, pool.level, 0, 0), material = sheet(new NodeMaterial());
        this.mirrors.push(mirror);
        this.still.push({ material, mirror });
        if (!this.sheet) this.sheet = mirror;
        mesh = new Mesh(geometry, material);
        mesh.add(mirror.at);
        mirror.at.position.set(0, 0, 0);
      } else {
        mesh = new Mesh(geometry, this.material);
        mesh.receiveShadow = true;
      }
      mesh.position.set(pool.x, pool.level, pool.z);
      mesh.renderOrder = 1;
      mesh.name = 'water';
      this.meshes.push(mesh);
    }
    let lone: Mirror | null = null;
    if (streams.length) {
      if (o.mirror && !this.sheet) {
        // Running water alone, with no still water to lend it a picture: a mirror is made for
        // it at its middle height. Nothing is drawn there; only its picture is used.
        const heights = streams.flatMap((q) => q.line.filter((_, i) => i % 3 === 1)).sort((a, b) => a - b);
        lone = this.sheet = makeMirror(o.mirror, heights[heights.length >> 1], streams[0].line[0], streams[0].line[2]);
        this.mirrors.push(lone);
      }
      this.flowing = sheet(new NodeMaterial());
    }
    for (const stream of streams) {
      // Five points across at each point along: both edges, the middle, and one between on each side.
      const n = stream.line.length / 3, ACROSS = [[-1, 1], [-0.6, 0.5], [0, 0], [0.6, 0.5], [1, 1]];
      const position = new Float32Array(n * 15), flow = new Float32Array(n * 10), dir = new Float32Array(n * 10), water = new Float32Array(n * 20), index: number[] = [];
      // How far along the stream each point is from where it comes to rest: an end, or still water.
      const rest: number[] = [];
      for (let k = 0, far = 0; k < n; k++) {
        far = !k || (stream.fade && stream.fade[k] < 0.99) ? 0 : far + Math.hypot(stream.line[k * 3] - stream.line[k * 3 - 3], stream.line[k * 3 + 2] - stream.line[k * 3 - 1]);
        rest.push(far);
      }
      for (let k = n - 1, far = 0; k >= 0; k--) {
        far = k === n - 1 || (stream.fade && stream.fade[k] < 0.99) ? 0 : far + Math.hypot(stream.line[k * 3] - stream.line[k * 3 + 3], stream.line[k * 3 + 2] - stream.line[k * 3 + 5]);
        rest[k] = Math.min(rest[k], far);
      }
      let run = 0, churn = 0;
      for (let k = 0; k < n; k++) {
        const x = stream.line[k * 3], y = stream.line[k * 3 + 1], z = stream.line[k * 3 + 2];
        const a = Math.max(0, k - 1) * 3, b = Math.min(n - 1, k + 1) * 3;
        let dx = stream.line[b] - stream.line[a], dz = stream.line[b + 2] - stream.line[a + 2];
        const l = Math.hypot(dx, dz) || 1;
        // How steeply it falls here: nothing on the level, all of it at one in six; and past
        // that, up to 2, how nearly it is a sheer fall. Below a fall the water is white for
        // some way after it has stopped falling.
        const slope = Math.max(0, (stream.line[a + 1] - stream.line[b + 1]) / l), sheer = Math.min(1, Math.max(0, (slope - 0.6) / 1.6));
        churn = Math.max(sheer, churn * 0.72);
        const fall = Math.max(Math.min(1, slope * 6), Math.min(1, churn * 1.6)) + sheer * sheer * (3 - 2 * sheer);
        dx /= l; dz /= l;
        // (Measured down the water, not over the ground: a fall is as long as it is high.)
        if (k) run += Math.hypot(x - stream.line[k * 3 - 3], y - stream.line[k * 3 - 2], z - stream.line[k * 3 - 1]);
        const left = stream.banks ? stream.banks[k * 2] : stream.width / 2, right = stream.banks ? stream.banks[k * 2 + 1] : stream.width / 2;
        const shown = stream.fade ? stream.fade[k] : 1;
        ACROSS.forEach(([side, shallow], j) => {
          const off = side < 0 ? side * right : side * left, i = k * 5 + j;
          position.set([x - dz * off, y, z + dx * off], i * 3);
          flow.set([off, run], i * 2);
          dir.set([dx, dz], i * 2);
          water.set([shallow, shown, fall, 1 - Math.min(1, rest[k] / 6) ** 2 * (3 - 2 * Math.min(1, rest[k] / 6))], i * 4);
          // Wound to face the sky.
          if (k && j) index.push(i - 6, i - 5, i - 1, i - 5, i, i - 1);
        });
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(position, 3));
      geometry.setAttribute('aFlow', new BufferAttribute(flow, 2));
      geometry.setAttribute('aDir', new BufferAttribute(dir, 2));
      geometry.setAttribute('aWater', new BufferAttribute(water, 4));
      geometry.setIndex(index);
      const mesh = new Mesh(geometry, this.flowing!);
      // Drawn after still water, so that where the two overlap the stream lies on the lake and fades into it.
      mesh.renderOrder = 2;
      mesh.name = 'water';
      // Not itself mirrored: it reads the mirror's picture, and cannot be in the picture it reads.
      mesh.layers.set(1);
      if (lone) { mesh.add(lone.at); lone = null; }
      this.meshes.push(mesh);
    }
    this.mist(o.falls ?? []);
    this.smoke(o.smokes ?? []);
  }

  /**
   * Spray at the foot of a fall: a few upright sheets through the place the water lands, each a
   * soft cloud that rises and thins. It is the cheapest thing that keeps a waterfall from ending
   * in a clean line where it meets the pool.
   */
  private mist(falls: { x: number; y: number; z: number; height: number; width: number }[]): void {
    if (!falls.length) return;
    const spray = (this.spray = new NodeMaterial());
    spray.transparent = true;
    spray.depthWrite = false;
    spray.side = DoubleSide;
    spray.fragmentNode = Fn(() => {
      // Thickest low in the middle, nothing at the edges or the top; and never still.
      const at: N = uv(), P: N = positionWorld, t = this.uTime;
      const across = one(abs(at.x.mul(2).sub(1)));
      const body = smoothstep(0, 0.7, across).mul(sstep(1.0, 0.15, at.y)).mul(smoothstep(0, 0.08, at.y));
      const drift = texture(this.ripples, vec2(P.x.add(P.z), P.y).mul(0.06).add(vec2(0.02, -0.07).mul(t))).x.add(texture(this.ripples, vec2(P.x.sub(P.z), P.y).mul(0.13).add(vec2(-0.03, -0.12).mul(t))).y);
      return vec4(this.look.foam.mul(0.9), body.mul(smoothstep(0.35, 1.7, drift)).mul(0.42));
    })();
    for (const f of falls) {
      const wide = f.width * 1.6 + 2.2, tall = Math.min(4.5, 1.6 + f.height * 0.3);
      for (let k = 0; k < 3; k++) {
        const sheet = new Mesh(new PlaneGeometry(wide, tall), spray);
        sheet.position.set(f.x, f.y + tall / 2 - 0.15, f.z);
        sheet.rotation.y = (k * Math.PI) / 3 + 0.4;
        sheet.renderOrder = 3;
        sheet.name = 'water';
        sheet.layers.set(1);
        this.meshes.push(sheet);
      }
    }
  }

  /**
   * Smoke, where something smoulders out of doors: made as the spray of a fall is, of a few upright
   * sheets crossed through one line, but tall, narrow at the foot and spreading as it rises, grey,
   * climbing slowly and leaning one way and then the other. (It is here because the means are here.)
   */
  private smoke(smokes: { x: number; y: number; z: number; height: number }[]): void {
    if (!smokes.length) return;
    const material = new NodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.fragmentNode = Fn(() => {
      const at: N = uv(), P: N = positionWorld, t = this.uTime;
      // How far from the column's middle line, which leans more the higher it is; and how broad the column is there.
      const lean = at.y.mul(at.y).mul(sin(t.mul(0.23)).mul(0.1).add(0.08));
      const across = one(abs(at.x.sub(0.5).sub(lean)).div(mix(0.07, 0.42, at.y)));
      const body = smoothstep(0, 0.75, across).mul(smoothstep(0, 0.05, at.y)).mul(sstep(1.0, 0.35, at.y));
      const drift = texture(this.ripples, vec2(P.x.add(P.z).mul(0.09), P.y.mul(0.05)).add(vec2(0.01, -0.035).mul(t))).x.add(texture(this.ripples, vec2(P.x.sub(P.z).mul(0.17), P.y.mul(0.11)).add(vec2(-0.015, -0.06).mul(t))).y);
      // (Grey, whatever the light: wood smoke takes little colour from the sun.)
      const grey: N = dot(this.look.foam, vec3(0.33, 0.34, 0.33)).mul(0.5);
      return vec4(mix(vec3(grey), this.look.foam.mul(0.5), 0.2), body.mul(smoothstep(0.25, 1.5, drift)).mul(mix(0.42, 0.16, at.y)));
    })();
    for (const s of smokes) for (let k = 0; k < 3; k++) {
      const sheet = new Mesh(new PlaneGeometry(s.height * 0.55, s.height), material);
      sheet.position.set(s.x, s.y + s.height / 2 - 0.1, s.z);
      sheet.rotation.y = (k * Math.PI) / 3 + 0.2;
      sheet.renderOrder = 3;
      sheet.name = 'water';
      sheet.layers.set(1);
      this.meshes.push(sheet);
    }
  }

  /**
   * Says how water is to be drawn, given whatever draws the sky's weather and the air, so that
   * water mirrors the same clouds and fades with the same distance. To be called once.
   *
   * Still water, when it is a mirror: the far bank, the trees and the mountains stand in it as
   * they stand above it. Ripples bend the picture a little. Looked at from above, water shows
   * less of the sky and more of itself, and at its edge, where it is shallow, it is clear and
   * the bed shows through.
   *
   * Running water is the same water: the same colour in its depths, the same clearness at its
   * edges, and the same picture of the world standing in it, so that where a stream runs into a
   * lake the one becomes the other without a line between them. What differs is that it moves.
   * Its ripples are drawn out along the current and travel down it, it is shallow enough for
   * its bed to show all the way across, and where it falls steeply it breaks white. The picture
   * it mirrors is the still water's, which was made for a level sheet at one height. A stream
   * is nearly level and at nearly any height, so it reads the picture where its own line of
   * sight would meet that sheet: far things then stand in it exactly as they should, and near
   * ones a little out of place, which moving water hides. Where there is no such picture (none
   * drawn, or the eye below it) it mirrors a sky and a dark line of land that are worked out
   * and not seen.
   */
  mirrorSky(atmosphere: Atmosphere): void {
    const u = atmosphere.uniforms, t = this.uTime, look = this.look;
    const ripplesAt = (x: N, y: N): N => texture(this.ripples, vec2(x, y));
    for (const { material, mirror } of this.still) {
      const sky = skyParts(u, 14);
      material.fragmentNode = Fn(() => {
        const P: N = positionWorld;
        // Two sets of ripples crossing, of different sizes, drifting different ways.
        const a: N = texture(this.ripples, P.xz.mul(0.21).add(vec2(0.013, 0.008).mul(t))).xy.mul(2).sub(1);
        const b: N = texture(this.ripples, P.zx.mul(0.057).sub(vec2(0.006, 0.004).mul(t))).xy.mul(2).sub(1);
        const ripple: N = a.mul(0.03).add(b.mul(0.028)).toVar();
        const normal: N = normalize(vec3(ripple.x, 1, ripple.y)).toVar();
        const view: N = normalize(cameraPosition.sub(P)).toVar();
        // Water mirrors nearly everything at a glancing angle and very little looked straight down on.
        const mirroring: N = pow(one(max(dot(normal, view), 0)), 4.5).mul(0.97).add(0.03).toVar();
        const seen = mirrored(mirror, sky, u, inPicture(P).add(ripple.mul(0.55)), P, reflect(view.negate(), normal));
        // Shallow water is clear: there, what is under it shows through.
        const clear = attribute('aShallow', 'float').mul(one(mirroring)).mul(0.85);
        return vec4(mix(look.deep, seen, mirroring), one(clear));
      })();
    }
    if (this.flowing) {
      const sky = skyParts(u, 10), sheet = this.sheet;
      this.flowing.fragmentNode = Fn(() => {
        const P: N = positionWorld, w: N = attribute('aWater', 'vec4'), flow: N = attribute('aFlow', 'vec2'), way: N = attribute('aDir', 'vec2');
        const shallow = w.x, fall: N = min(w.z, 1).toVar(), sheer: N = max(w.z.sub(1), 0).toVar(), calm = w.w;
        // Two sets of ripples, both longer down the current than across it, travelling down it at
        // different speeds: so the pattern is never the same twice, as a current's is not.
        const a: N = ripplesAt(flow.x.mul(0.43), flow.y.mul(0.25).sub(t.mul(0.16))).xy.mul(2).sub(1).toVar();
        const b: N = ripplesAt(flow.x.mul(0.19).add(0.4), flow.y.mul(0.1).sub(t.mul(0.105))).xy.mul(2).sub(1).toVar();
        // Quiet where the bed is nearly level, broken where it falls.
        // Quieter still where it comes to rest: in the pool it rises in, and where it meets a lake.
        const ripple: N = a.mul(0.6).add(b.mul(0.5)).mul(fall.mul(0.1).add(0.07)).mul(one(calm.mul(0.6))).toVar();
        const along: N = normalize(vec3(way.x, 0, way.y)).toVar();
        const normal: N = normalize(vec3(0, 1, 0).add(vec3(along.z.negate(), 0, along.x).mul(ripple.x)).add(along.mul(ripple.y))).toVar();
        const view: N = normalize(cameraPosition.sub(P)).toVar();
        const mirroring: N = pow(one(max(dot(normal, view), 0)), 4.5).mul(0.97).add(0.03).toVar();
        const dir: N = reflect(view.negate(), normal).toVar();
        // With no picture to go by: sky above, and below a ragged line the dark of banks and trees.
        const seen: N = mix(look.land, mix(look.horizon, look.zenith, pow(max(dir.y, 0), 0.6)), smoothstep(0.1, 0.42, dir.y.add(a.x.add(b.y).mul(0.25)))).toVar();
        if (sheet) {
          // (Water above the eye, as a fall is seen from its foot, has no place on the sheet to read.)
          If(this.uPictured.greaterThan(0.001).and(cameraPosition.y.sub(P.y).greaterThan(0.05)).and(sheer.lessThan(0.5)), () => {
            const onSheet: N = cameraPosition.add(P.sub(cameraPosition).mul(cameraPosition.y.sub(sheet.level).div(max(cameraPosition.y.sub(P.y), 0.01))));
            const shown = mirrored(sheet, sky, u, inPicture(onSheet).add(ripple.mul(0.22)), P, dir);
            seen.assign(mix(seen, shown, this.uPictured));
          });
        }
        const colour: N = mix(look.deep, seen, mirroring).toVar();
        // The backs of the ripples that face the sky's brightest part catch it. This is what the eye
        // takes for water when it looks down into a stream and the mirror shows next to nothing.
        const glint = smoothstep(0.012, 0.05, ripple.y.sub(abs(ripple.x).mul(0.4)));
        colour.addAssign(look.foam.mul(glint).mul(0.06).mul(one(calm.mul(0.6))));
        // White water: streaks where the bed falls away, thickest where the ripples pile up.
        const foam: N = smoothstep(0.3, 0.85, fall).mul(smoothstep(0.1, 0.55, a.x.add(a.y).mul(1.4).add(b.x.sub(b.y).mul(1.1)).add(fall.mul(0.35)))).toVar();
        // Broken up small, as froth is, and never a solid sheet of white.
        foam.mulAssign(smoothstep(-0.25, 0.3, ripplesAt(flow.x.mul(1.7), flow.y.mul(0.8).sub(t.mul(0.62))).x.mul(2).sub(1)).mul(0.65).add(0.35));
        // A sheer fall is all white: water in strings and veils, drawn out long and coming down fast,
        // thinner in some strings than others so that the rock shows dark between them.
        If(sheer.greaterThan(0), () => {
          const veil: N = ripplesAt(flow.x.mul(0.7), flow.y.mul(0.26).sub(t.mul(1.7))).xy.add(ripplesAt(flow.x.mul(1.9).add(0.3), flow.y.mul(0.47).sub(t.mul(2.6))).xy).sub(1);
          foam.assign(mix(foam, smoothstep(-0.4, 0.2, veil.x.add(veil.y.mul(0.6))).mul(0.38).add(0.62), sheer));
        });
        // And where it has just come down it is still mostly white.
        foam.assign(max(foam, smoothstep(0.7, 1, fall).mul(0.6).mul(one(calm)).mul(smoothstep(-0.2, 0.3, a.x.add(b.y)).mul(0.45).add(0.55))));
        colour.assign(mix(colour, look.foam, foam.mul(mix(0.7, 0.96, sheer))));
        // It is nowhere deep, so the bed shows all the way across, and plainest at the edges. At the
        // very edge it thins to nothing, so that where there is no bank to end it, it has no rim.
        const clear = max(shallow, calm.mul(0.66).add(0.34)).mul(one(mirroring)).mul(0.85).mul(one(foam));
        return vec4(colour, one(clear).mul(w.y).mul(sstep(1.0, 0.8, shallow)));
      })();
    }
  }

  /** To be called before each picture is drawn: the time, and whose eye it is drawn for. */
  update(time: number, camera: Camera): void {
    this.uTime.value = time;
    for (const m of this.mirrors) m.unproject.value.copy(m.eyeOf(camera).projectionMatrix).invert();
    // With the eye below the sheet there is no picture to be had; it gives way before that.
    if (this.sheet) this.uPictured.value = Math.min(1, Math.max(0, (camera.matrixWorld.elements[13] - this.sheet.level - 0.1) / 0.6));
    this.ripples.offset.set(time * 0.013, time * 0.008);
  }
}
