import {
  LinearFilter, LinearMipmapLinearFilter, Mesh, NoColorSpace, OrthographicCamera, PlaneGeometry, RepeatWrapping,
  RGBAFormat, Scene, ShaderMaterial, SRGBColorSpace, Texture, UnsignedByteType, WebGLRenderer, WebGLRenderTarget,
} from 'three';

/**
 * Procedural material recipes. Each recipe is a height function and a colour function in GLSL;
 * the generator renders tiling base colour, normal and occlusion/roughness maps from them.
 * All noise is periodic, so the results tile.
 */

export interface TextureSet {
  /** Base colour, with height in alpha. */
  map: Texture;
  normalMap: Texture;
  /** Occlusion in red, roughness in green, metalness in blue. */
  ormMap: Texture;
}

const NOISE = /* glsl */ `
uniform float uSeed;
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * .0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash21(vec2 p) { return hash22(p).x; }
// Gradient noise, periodic over 'per' lattice cells. Roughly -0.7..0.7.
float gnoise(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 ga = hash22(mod(i, per)) * 2. - 1.;
  vec2 gb = hash22(mod(i + vec2(1, 0), per)) * 2. - 1.;
  vec2 gc = hash22(mod(i + vec2(0, 1), per)) * 2. - 1.;
  vec2 gd = hash22(mod(i + vec2(1, 1), per)) * 2. - 1.;
  float a = dot(ga, f), b = dot(gb, f - vec2(1, 0)), c = dot(gc, f - vec2(0, 1)), d = dot(gd, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, vec2 freq, int octaves, float gain) {
  float sum = 0., amp = .5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(uv * freq + float(i) * 3.7, freq);
    freq *= 2.; amp *= gain;
  }
  return sum;
}
// Cellular noise: distance to nearest and second-nearest feature point.
vec2 worley(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float d1 = 9., d2 = 9.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 o = hash22(mod(i + g, per));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}
`;

interface Recipe {
  /** float heightFn(vec2 uv): 0..1 */
  height: string;
  /** void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough): linear colour */
  surface: string;
  normalStrength: number;
}

const RECIPES: Record<string, Recipe> = {
  // Dressed limestone: broad undulation, pitting, fine tooling and grain. Pale, so vertex tint sets the colour.
  stone: {
    normalStrength: 5.5,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float broad = fbm(uv, vec2(3.), 5, .55);
  float mid = fbm(uv + 7.3, vec2(12.), 4, .5);
  vec2 w = worley(uv * 22., vec2(22.));
  float pitMask = smoothstep(.12, .32, fbm(uv + 2.1, vec2(4.), 3, .5) + .1);
  float pitSize = .08 + .22 * hash21(floor(uv * 22.) + 3.);
  float pits = smoothstep(pitSize, .0, w.x) * pitMask * step(.55, hash21(floor(uv * 22.) + 11.));
  float tool = gnoise(vec2(uv.x * 14., uv.y * 96.), vec2(14., 96.)) * .5
             + gnoise(vec2(uv.x * 30., uv.y * 180.), vec2(30., 180.)) * .3;
  float grain = fbm(uv + 1.7, vec2(72.), 3, .6);
  float h = .58 + broad * .6 + mid * .26 + tool * .09 + grain * .12 - pits * .3;
  return clamp(h, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float blot = fbm(uv + 9.1, vec2(4.), 4, .5);
  float speck = hash21(floor(uv * 512.));
  vec3 base = mix(vec3(.60, .58, .55), vec3(.74, .72, .68), smoothstep(-.25, .3, blot));
  // Iron staining and a little warm/cool drift.
  float stain = smoothstep(.12, .4, fbm(uv + 13.7, vec2(6.), 4, .55));
  base = mix(base, vec3(.62, .50, .36), stain * .35);
  base *= mix(.86, 1.06, smoothstep(.2, .8, h));
  base *= 1. - cavity * .45;
  base *= .96 + speck * .08;
  albedo = base;
  rough = clamp(.86 + cavity * .1 - smoothstep(.6, .9, h) * .12 + (speck - .5) * .06, .5, 1.);
}`,
  },
  // Sawn timber: long grain, occasional knots, checks along the grain.
  wood: {
    normalStrength: 4.,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float warp = fbm(uv, vec2(2., 6.), 3, .5) * .12;
  float g1 = gnoise(vec2(uv.x * 4., (uv.y + warp) * 46.), vec2(4., 46.));
  float g2 = gnoise(vec2(uv.x * 9., (uv.y + warp) * 130.), vec2(9., 130.));
  float g3 = gnoise(vec2(uv.x * 20., (uv.y + warp) * 300.), vec2(20., 300.));
  vec2 w = worley(vec2(uv.x * 3., uv.y * 8.), vec2(3., 8.));
  float knot = smoothstep(.16, .0, w.x) * step(.72, hash21(floor(vec2(uv.x * 3., uv.y * 8.)) + .5));
  float checks = smoothstep(.42, .62, g1) * smoothstep(.1, .5, fbm(uv + 5., vec2(3., 3.), 3, .5) + .2);
  float h = .55 + g1 * .34 + g2 * .2 + g3 * .1 - checks * .3 + knot * .15;
  return clamp(h, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float tone = fbm(uv + 3.3, vec2(2., 10.), 4, .5);
  vec3 base = mix(vec3(.20, .13, .08), vec3(.42, .30, .19), smoothstep(.25, .8, h + tone * .5));
  base = mix(base, vec3(.33, .31, .28), smoothstep(.1, .5, fbm(uv + 8., vec2(3., 5.), 3, .5)) * .45);
  base *= 1. - cavity * .55;
  albedo = base;
  rough = clamp(.78 + cavity * .15 - h * .1, .45, 1.);
}`,
  },
  // Moss: soft clumps. Alpha (height) is used as the growth mask when blending over stone.
  moss: {
    normalStrength: 3.,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  vec2 w = worley(uv * 14., vec2(14.));
  vec2 w2 = worley(uv * 40. + 3., vec2(40.));
  float clumps = 1. - smoothstep(.0, .75, w.x);
  float tufts = 1. - smoothstep(.0, .8, w2.x);
  float h = clumps * .6 + tufts * .25 + fbm(uv, vec2(6.), 4, .55) * .5 + .12;
  return clamp(h, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(5.), 4, .55);
  vec3 dark = vec3(.035, .065, .018), mid = vec3(.10, .17, .035), dry = vec3(.22, .22, .07);
  vec3 base = mix(dark, mid, smoothstep(.2, .75, h));
  base = mix(base, dry, smoothstep(.1, .45, t) * .55);
  albedo = base * (1. - cavity * .3);
  rough = .96;
}`,
  },
};

function fragmentSource(r: Recipe): string {
  return /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform int uMode;
uniform float uTexel;
${NOISE}
${r.height}
${r.surface}
void main() {
  float h = heightFn(vUv);
  float e = uTexel;
  float hl = heightFn(vUv - vec2(e, 0.)), hr = heightFn(vUv + vec2(e, 0.));
  float hd = heightFn(vUv - vec2(0., e)), hu = heightFn(vUv + vec2(0., e));
  // Cavity: how far this point sits below its wider surroundings.
  float e2 = e * 6.;
  float around = .25 * (heightFn(vUv - vec2(e2, 0.)) + heightFn(vUv + vec2(e2, 0.))
                      + heightFn(vUv - vec2(0., e2)) + heightFn(vUv + vec2(0., e2)));
  float cavity = clamp((around - h) * 5., 0., 1.);
  if (uMode == 0) {
    vec3 albedo; float rough;
    surfaceFn(vUv, h, cavity, albedo, rough);
    gl_FragColor = vec4(albedo, h);
  } else if (uMode == 1) {
    vec3 n = normalize(vec3((hl - hr) * ${r.normalStrength.toFixed(2)}, (hd - hu) * ${r.normalStrength.toFixed(2)}, 2. * e * 512.));
    gl_FragColor = vec4(n * .5 + .5, 1.);
  } else {
    vec3 albedo; float rough;
    surfaceFn(vUv, h, cavity, albedo, rough);
    gl_FragColor = vec4(1. - cavity * .7, rough, 0., 1.);
  }
}`;
}

export function generateTextureSet(renderer: WebGLRenderer, recipe: keyof typeof RECIPES, size: number, seed: number): TextureSet {
  const r = RECIPES[recipe];
  const material = new ShaderMaterial({
    uniforms: { uMode: { value: 0 }, uTexel: { value: 1 / size }, uSeed: { value: seed } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: fragmentSource(r),
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const render = (mode: number, srgb: boolean): Texture => {
    const rt = new WebGLRenderTarget(size, size, {
      format: RGBAFormat, type: UnsignedByteType, depthBuffer: false,
      wrapS: RepeatWrapping, wrapT: RepeatWrapping,
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
      colorSpace: srgb ? SRGBColorSpace : NoColorSpace,
    });
    rt.texture.anisotropy = aniso;
    material.uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    return rt.texture;
  };

  const prevTone = renderer.toneMapping;
  renderer.toneMapping = 0;
  const set = { map: render(0, true), normalMap: render(1, false), ormMap: render(2, false) };
  renderer.toneMapping = prevTone;
  material.dispose();
  quad.geometry.dispose();
  return set;
}
