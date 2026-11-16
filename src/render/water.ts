import { BufferAttribute, BufferGeometry, Camera, CanvasTexture, CircleGeometry, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial, Texture, Vector2, Vector3, WebGLRenderer } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CLOUDS } from './post';
import { Rng } from '../core/rng';

/**
 * Water, still and running. Still water is a level sheet over a hollow in the ground: dark, nearly a mirror, and thin enough
 * at the edge to show the bed. Its surface is ruffled by a ripple pattern that drifts, which is
 * what breaks the sky's reflection into moving light.
 */

/** A tiling pattern of ripples, as a normal map: a sum of waves that all fit the square exactly. */
function rippleMap(size = 256): Texture {
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

/**
 * How still water is shaded when it is a mirror. The scene is drawn a second time, upside down
 * as the water would show it, and that picture is laid on the surface: so the far bank, the
 * trees and the mountains stand in the water as they stand above it. Ripples bend the picture a
 * little. Looked at from above, water shows less of the sky and more of itself, and at its
 * edge, where it is shallow, it is clear and the bed shows through.
 */
const MIRROR = {
  name: 'StillWater',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    tRipples: { value: null as Texture | null }, uTime: { value: 0 }, uDeep: { value: new Vector3(0.02, 0.05, 0.045) },
    // The sky's weather, shared with whatever draws the sky: see `mirrorSky`.
    tCloud: { value: null }, uCloudOn: { value: 0 }, uCloudCover: { value: 0 }, uCloudBase: { value: 260 }, uCloudTop: { value: 620 },
    uCloudDrift: { value: new Vector3() }, uCloudSun: { value: new Vector3() }, uCloudAir: { value: new Vector3() }, uSunDir: { value: new Vector3(0, 1, 0) },
  },
  vertexShader: /* glsl */ `
uniform mat4 textureMatrix;
attribute float aShallow;
varying vec4 vUv;
varying vec3 vWorld;
varying float vShallow;
void main() {
  vUv = textureMatrix * vec4( position, 1.0 );
  vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vShallow = aShallow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
  fragmentShader: /* glsl */ `
precision highp sampler3D;
#define CLOUD_STEPS 14
uniform sampler2D tDiffuse;
uniform sampler2D tRipples;
uniform float uTime, uCloudOn;
${CLOUDS}
uniform vec3 uDeep;
varying vec4 vUv;
varying vec3 vWorld;
varying float vShallow;
void main() {
  // Two sets of ripples crossing, of different sizes, drifting different ways.
  vec2 a = texture2D( tRipples, vWorld.xz * 0.21 + uTime * vec2( 0.013, 0.008 ) ).xy * 2.0 - 1.0;
  vec2 b = texture2D( tRipples, vWorld.zx * 0.057 - uTime * vec2( 0.006, 0.004 ) ).xy * 2.0 - 1.0;
  vec2 ripple = a * 0.03 + b * 0.028;
  vec3 normal = normalize( vec3( ripple.x, 1.0, ripple.y ) );
  vec3 view = normalize( cameraPosition - vWorld );
  // Water mirrors nearly everything at a glancing angle and very little looked straight down on.
  float mirror = 0.03 + 0.97 * pow( 1.0 - max( dot( normal, view ), 0.0 ), 4.5 );
  vec4 at = vUv;
  at.xy += ripple * 0.55 * at.w;
  vec4 picture = texture2DProj( tDiffuse, at );
  vec3 seen = picture.rgb;
  // Where the picture shows open sky, the clouds are put into it: they are not things in the
  // scene, and so were not in the picture.
  if ( uCloudOn > 0.5 && picture.a < 0.5 ) {
    vec4 cloud = cloudMarch( vWorld, reflect( -view, normal ), 0.5 );
    seen = seen * cloud.a + cloud.rgb;
  }
  // The glare of the sun's own disc is spread by the ripples; unspread it would be a hard white dot.
  seen = min( seen, vec3( 9.0 ) );
  vec3 colour = mix( uDeep, seen, mirror );
  // Shallow water is clear: there, what is under it shows through.
  float clear = vShallow * ( 1.0 - mirror ) * 0.85;
  gl_FragColor = vec4( colour, 1.0 - clear );
}`,
};

/**
 * How running water is shaded. It is the same water as the still: the same colour in its
 * depths, the same clearness at its edges, and the same picture of the world standing in it,
 * so that where a stream runs into a lake the one becomes the other without a line between
 * them. What differs is that it moves. Its ripples are drawn out along the current and travel
 * down it, it is shallow enough for its bed to show all the way across, and where it falls
 * steeply it breaks white.
 *
 * The picture it mirrors is the still water's, which was made for a level sheet at one height.
 * A stream is nearly level and at nearly any height, so it reads the picture where its own
 * line of sight would meet that sheet: far things then stand in it exactly as they should, and
 * near ones a little out of place, which moving water hides. Where there is no such picture
 * (no still water drawn, or the eye below it) it mirrors a sky and a dark line of land that
 * are worked out and not seen.
 */
const FLOW = {
  vertexShader: /* glsl */ `
attribute vec2 aFlow;
attribute vec2 aDir;
attribute vec4 aWater;
varying vec3 vWorld;
varying vec2 vFlow;
varying vec2 vDir;
varying vec4 vWater;
void main() {
  vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vFlow = aFlow;
  vDir = aDir;
  vWater = aWater;
  gl_Position = projectionMatrix * viewMatrix * vec4( vWorld, 1.0 );
}`,
  fragmentShader: /* glsl */ `
precision highp sampler3D;
#define CLOUD_STEPS 10
uniform sampler2D tDiffuse;
uniform sampler2D tRipples;
uniform mat4 uPicture;
uniform float uPictured, uLevel, uTime, uCloudOn;
${CLOUDS}
uniform vec3 uDeep, uZenith, uHorizon, uLand, uFoam;
varying vec3 vWorld;
varying vec2 vFlow;
varying vec2 vDir;
varying vec4 vWater;
void main() {
  float shallow = vWater.x, fall = vWater.z, calm = vWater.w;
  // Two sets of ripples, both longer down the current than across it, travelling down it at
  // different speeds: so the pattern is never the same twice, as a current's is not.
  vec2 a = texture2D( tRipples, vec2( vFlow.x * 0.43, vFlow.y * 0.25 - uTime * 0.16 ) ).xy * 2.0 - 1.0;
  vec2 b = texture2D( tRipples, vec2( vFlow.x * 0.19 + 0.4, vFlow.y * 0.1 - uTime * 0.105 ) ).xy * 2.0 - 1.0;
  // Quiet where the bed is nearly level, broken where it falls.
  // Quieter still where it comes to rest: in the pool it rises in, and where it meets a lake.
  vec2 ripple = ( a * 0.6 + b * 0.5 ) * ( 0.07 + 0.1 * fall ) * ( 1.0 - 0.6 * calm );
  vec3 along = normalize( vec3( vDir.x, 0.0, vDir.y ) );
  vec3 normal = normalize( vec3( 0.0, 1.0, 0.0 ) + vec3( -along.z, 0.0, along.x ) * ripple.x + along * ripple.y );
  vec3 view = normalize( cameraPosition - vWorld );
  float mirror = 0.03 + 0.97 * pow( 1.0 - max( dot( normal, view ), 0.0 ), 4.5 );
  vec3 dir = reflect( -view, normal );
  // With no picture to go by: sky above, and below a ragged line the dark of banks and trees.
  vec3 seen = mix( uLand, mix( uHorizon, uZenith, pow( max( dir.y, 0.0 ), 0.6 ) ), smoothstep( 0.1, 0.42, dir.y + ( a.x + b.y ) * 0.25 ) );
  if ( uPictured > 0.001 ) {
    vec3 ray = vWorld - cameraPosition;
    vec3 onSheet = cameraPosition + ray * ( ( cameraPosition.y - uLevel ) / max( cameraPosition.y - vWorld.y, 0.01 ) );
    vec4 at = uPicture * vec4( onSheet, 1.0 );
    at.xy += ripple * 0.22 * at.w;
    vec4 picture = texture2DProj( tDiffuse, at );
    vec3 shown = picture.rgb;
    if ( uCloudOn > 0.5 && picture.a < 0.5 ) {
      vec4 cloud = cloudMarch( vWorld, dir, 0.5 );
      shown = shown * cloud.a + cloud.rgb;
    }
    seen = mix( seen, min( shown, vec3( 9.0 ) ), uPictured );
  }
  vec3 colour = mix( uDeep, seen, mirror );
  // The backs of the ripples that face the sky's brightest part catch it. This is what the eye
  // takes for water when it looks down into a stream and the mirror shows next to nothing.
  float glint = smoothstep( 0.012, 0.05, ripple.y - abs( ripple.x ) * 0.4 );
  colour += uFoam * glint * 0.06 * ( 1.0 - 0.6 * calm );
  // White water: streaks where the bed falls away, thickest where the ripples pile up.
  float foam = smoothstep( 0.3, 0.85, fall ) * smoothstep( 0.1, 0.55, ( a.x + a.y ) * 1.4 + ( b.x - b.y ) * 1.1 + fall * 0.35 );
  // Broken up small, as froth is, and never a solid sheet of white.
  foam *= 0.35 + 0.65 * smoothstep( -0.25, 0.3, texture2D( tRipples, vec2( vFlow.x * 1.7, vFlow.y * 0.8 - uTime * 0.62 ) ).x * 2.0 - 1.0 );
  colour = mix( colour, uFoam, foam * 0.7 );
  // It is nowhere deep, so the bed shows all the way across, and plainest at the edges. At the
  // very edge it thins to nothing, so that where there is no bank to end it, it has no rim.
  float clear = max( shallow, 0.34 + 0.66 * calm ) * ( 1.0 - mirror ) * 0.85 * ( 1.0 - foam );
  gl_FragColor = vec4( colour, ( 1.0 - clear ) * vWater.y * smoothstep( 1.0, 0.8, shallow ) );
}`,
};

export class Water {
  readonly meshes: Mesh[] = [];
  private mirrors: ShaderMaterial[] = [];
  private ripples = rippleMap();
  private material: MeshStandardMaterial;
  private flowing: ShaderMaterial | null = null;
  /** The mirror whose picture running water borrows, the height it lies at, and how to find a place in the world on it. */
  private sheet: Reflector | null = null;
  private level = 0;
  private fromWorld = new Matrix4();
  /** Whether the picture has been made for the view now being drawn; see `begin`. */
  private fresh = false;
  private mirroring = false;

  /**
   * Still water is a level sheet with the outline of its pond; running water is a ribbon laid
   * down the course of its stream, falling as the bed falls, whose ripples travel downstream.
   */
  constructor(
    pools: { x: number; z: number; r: number; level: number; outline?: number[] }[],
    streams: { line: number[]; width: number; banks?: number[]; fade?: number[] }[] = [],
    /**
     * `mirror` is the size of the picture still water reflects, in pixels; 0 for none, and the sky alone is mirrored.
     * `deep` is the colour of deep water in this light. The rest is for running water where it has no picture to
     * mirror: the sky overhead and at the horizon, land in shade, and something white in this light.
     */
    o: { mirror?: number; deep?: [number, number, number]; zenith?: number[]; horizon?: number[]; land?: number[]; foam?: number[] } = {},
  ) {
    this.ripples.repeat.set(1, 1);
    this.material = new MeshStandardMaterial({
      color: 0x0d2a26, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.84,
      normalMap: this.ripples, normalScale: new Vector2(0.2, 0.2), envMapIntensity: 2.2, depthWrite: false,
    });
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
      if (o.mirror) {
        // The mirror wants its sheet standing up, facing forward; it is then laid down flat.
        geometry.rotateX(Math.PI / 2);
        const mirror = new Reflector(geometry, { textureWidth: o.mirror, textureHeight: o.mirror, clipBias: 0.01, shader: MIRROR, multisample: o.mirror >= 1024 ? 4 : 0 });
        mirror.rotation.x = -Math.PI / 2;
        const material = mirror.material as ShaderMaterial;
        material.uniforms.tRipples.value = this.ripples;
        if (o.deep) material.uniforms.uDeep.value.set(o.deep[0], o.deep[1], o.deep[2]);
        material.transparent = true;
        material.depthWrite = false;
        this.mirrors.push(material);
        if (!this.sheet) { this.sheet = mirror; this.level = pool.level; }
        this.watch(mirror);
        mesh = mirror;
      } else {
        mesh = new Mesh(geometry, this.material);
        mesh.receiveShadow = true;
      }
      mesh.position.set(pool.x, pool.level, pool.z);
      mesh.renderOrder = 1;
      mesh.name = 'water';
      this.meshes.push(mesh);
    }
    if (streams.length) {
      if (o.mirror && !this.sheet) {
        // Running water alone, with no still water to lend it a picture: a mirror is made for
        // it at its middle height. It is never drawn itself; only its picture is used.
        const heights = streams.flatMap((q) => q.line.filter((_, i) => i % 3 === 1)).sort((a, b) => a - b);
        const mirror = new Reflector(new PlaneGeometry(1, 1), { textureWidth: o.mirror, textureHeight: o.mirror, clipBias: 0.01, shader: MIRROR, multisample: o.mirror >= 1024 ? 4 : 0 });
        mirror.rotation.x = -Math.PI / 2;
        mirror.position.set(streams[0].line[0], heights[heights.length >> 1], streams[0].line[2]);
        this.sheet = mirror;
        this.level = mirror.position.y;
        this.watch(mirror);
      }
      const vec = (v: number[] | undefined, x: number, y: number, z: number) => new Vector3(v?.[0] ?? x, v?.[1] ?? y, v?.[2] ?? z);
      this.flowing = new ShaderMaterial({
        name: 'RunningWater',
        uniforms: {
          tDiffuse: { value: this.sheet ? this.sheet.getRenderTarget().texture : null }, tRipples: { value: this.ripples },
          uPicture: { value: new Matrix4() }, uPictured: { value: 0 }, uLevel: { value: this.level }, uTime: { value: 0 },
          uDeep: { value: vec(o.deep, 0.02, 0.05, 0.045) }, uZenith: { value: vec(o.zenith, 0.14, 0.28, 0.66) }, uHorizon: { value: vec(o.horizon, 0.6, 0.72, 0.88) },
          uLand: { value: vec(o.land, 0.02, 0.03, 0.015) }, uFoam: { value: vec(o.foam, 0.8, 0.8, 0.8) },
          tCloud: { value: null }, uCloudOn: { value: 0 }, uCloudCover: { value: 0 }, uCloudBase: { value: 260 }, uCloudTop: { value: 620 },
          uCloudDrift: { value: new Vector3() }, uCloudSun: { value: new Vector3() }, uCloudAir: { value: new Vector3() }, uSunDir: { value: new Vector3(0, 1, 0) },
        },
        vertexShader: FLOW.vertexShader, fragmentShader: FLOW.fragmentShader, transparent: true, depthWrite: false,
      });
      if (this.sheet) {
        this.sheet.updateMatrixWorld(true);
        this.fromWorld.copy(this.sheet.matrixWorld).invert();
      }
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
      let run = 0;
      for (let k = 0; k < n; k++) {
        const x = stream.line[k * 3], y = stream.line[k * 3 + 1], z = stream.line[k * 3 + 2];
        const a = Math.max(0, k - 1) * 3, b = Math.min(n - 1, k + 1) * 3;
        let dx = stream.line[b] - stream.line[a], dz = stream.line[b + 2] - stream.line[a + 2];
        const l = Math.hypot(dx, dz) || 1;
        // How steeply it falls here: nothing on the level, all of it at one in six.
        const fall = Math.min(1, Math.max(0, ((stream.line[a + 1] - stream.line[b + 1]) / l) * 6));
        dx /= l; dz /= l;
        if (k) run += Math.hypot(x - stream.line[k * 3 - 3], z - stream.line[k * 3 - 1]);
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
      mesh.onBeforeRender = (renderer, scene, camera) => this.picture(renderer, scene, camera);
      this.meshes.push(mesh);
    }
  }

  /** Has the mirror note when it makes its picture, and keeps out of that picture whatever is marked as not to be mirrored. */
  private watch(mirror: Reflector): void {
    const make = mirror.onBeforeRender;
    mirror.onBeforeRender = (renderer, scene, camera, ...rest) => {
      mirror.getReflectionCamera(camera).layers.set(0);
      if (mirror === this.sheet) this.fresh = true;
      this.mirroring = true;
      make.call(mirror, renderer, scene, camera, ...rest);
      this.mirroring = false;
    };
  }

  /**
   * Running water is about to be drawn: sees that the picture it mirrors is of this view. The
   * still water makes the picture when it is itself drawn; when it is out of sight, or there is
   * none, it is made here.
   */
  private picture(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const sheet = this.sheet, flowing = this.flowing;
    if (!sheet || !flowing || this.mirroring) return;
    const above = camera.matrixWorld.elements[13] - this.level;
    if (!this.fresh && above > 0.05) {
      const hidden = !sheet.parent;
      (sheet.onBeforeRender as (r: WebGLRenderer, s: Scene, c: Camera) => void)(renderer, scene, camera);
      if (hidden) sheet.visible = false;
    }
    flowing.uniforms.uPicture.value.multiplyMatrices((sheet.material as ShaderMaterial).uniforms.textureMatrix.value, this.fromWorld);
    // With the eye below the sheet there is no picture to be had; it gives way before that.
    flowing.uniforms.uPictured.value = Math.min(1, Math.max(0, (above - 0.1) / 0.6));
  }

  /** To be called when a view of the scene is about to be drawn, so that the picture in the water is made afresh for it. */
  begin(): void {
    this.fresh = false;
  }

  /** Lets still water mirror the clouds: `sky` is the uniforms of whatever draws them, shared and not copied, so they move together. */
  mirrorSky(sky: Record<string, { value: unknown }>): void {
    for (const m of this.flowing ? [...this.mirrors, this.flowing] : this.mirrors) for (const name of ['tCloud', 'uCloudOn', 'uCloudCover', 'uCloudBase', 'uCloudTop', 'uCloudDrift', 'uCloudSun', 'uCloudAir', 'uSunDir']) m.uniforms[name] = sky[name] as { value: unknown };
  }

  update(time: number): void {
    for (const m of this.mirrors) m.uniforms.uTime.value = time;
    if (this.flowing) this.flowing.uniforms.uTime.value = time;
    this.ripples.offset.set(time * 0.013, time * 0.008);
  }
}
