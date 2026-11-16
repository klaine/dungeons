import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, NoColorSpace, OrthographicCamera, PlaneGeometry, RepeatWrapping,
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
  /** The pictures themselves, in the same order, four bytes to a point, bottom row first: for saving them. */
  pixels: Uint8Array[];
  size: number;
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
// The same, with a number belonging to the nearest cell: for giving each piece its own height or shade.
vec3 worleyId(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float d1 = 9., d2 = 9., id = 0.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 c = mod(i + g, per);
    vec2 o = hash22(c);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(c + 17.3); } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2, id);
}
// Flat faces meeting in creases, as rock breaks: each cell holds a tilted plane, and the height
// is the highest of the planes nearby. About -0.3 to 0.8.
float facets(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float best = -9.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 c = mod(i + g, per);
    vec2 d = f - g - hash22(c);
    vec2 n = hash22(c + 31.7) * 2. - 1.;
    best = max(best, hash21(c + 5.1) * .5 - dot(d, n) * .9 - dot(d, d) * .35);
  }
  return best;
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
  // Bark: long upright ridges with furrows between them that wander, join and part, cracked
  // across here and there, and fibrous within. Mid-grey, so that the vertex tint makes it oak or ash.
  bark: {
    normalStrength: 7.,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float warp = fbm(uv, vec2(3., 2.), 3, .5);
  // A furrow is where a slow noise, stretched upright, passes through nothing.
  float f1 = abs(gnoise(vec2(uv.x * 11. + warp * 2.2, uv.y * 1.5), vec2(11., 3.)));
  float f2 = abs(gnoise(vec2(uv.x * 23. + warp * 3. + 7., uv.y * 3.), vec2(23., 3.)));
  float ridge = smoothstep(.0, .2, f1) * (.72 + .28 * smoothstep(.0, .16, f2));
  // Now and then a ridge is broken across.
  vec3 w = worleyId(vec2(uv.x * 6., uv.y * 5. + warp), vec2(6., 5.));
  float across = smoothstep(.0, .05, w.y - w.x);
  float fibre = gnoise(vec2(uv.x * 64., uv.y * 6.), vec2(64., 6.)) * .5 + gnoise(vec2(uv.x * 150., uv.y * 14.), vec2(150., 14.)) * .3;
  return clamp(.1 + ridge * (.55 + .2 * w.z) * (.75 + .25 * across) + fibre * .11 + fbm(uv + 3., vec2(5.), 3, .5) * .12, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(4., 3.), 4, .5);
  vec3 base = mix(vec3(.13, .105, .09), vec3(.47, .43, .38), smoothstep(.2, .8, h + t * .3));
  // Grey-green crust on the ridges, as there is on any old trunk.
  base = mix(base, vec3(.4, .45, .34), smoothstep(.1, .4, fbm(uv + 8., vec2(5., 4.), 3, .5)) * smoothstep(.5, .8, h) * .5);
  albedo = base * (1. - cavity * .65);
  rough = clamp(.9 + cavity * .08, .6, 1.);
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
  // Living rock: a broken, weathered surface. A few long fractures, more short ones that are not
  // all open, flakes with slightly tilted faces, pits, and grain. There is no bedding in it: the
  // rock is textured from three sides, so beds are drawn by the shader, which knows which way is
  // up. Pale, like the dressed stone, so that the vertex tint sets its colour.
  rock: {
    normalStrength: 6.,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  vec2 warp = vec2(fbm(uv + 1.3, vec2(3.), 4, .55), fbm(uv + 8.9, vec2(3.), 4, .55));
  // A broken face: flat planes at three sizes, the lesser on the greater, meeting in sharp
  // edges. The hollows between them are where the cracks are; none is drawn.
  float broken = (facets(uv * 3. + warp * .6, vec2(3.)) - .3) * .5
               + (facets(uv * 7. + warp * 1.2 + 4.3, vec2(7.)) - .3) * .24
               + (facets(uv * 17. + 9.1, vec2(17.)) - .3) * .1;
  // A few hairline cracks that wander and stop.
  float c1 = abs(fbm(uv + 2.7, vec2(3.), 5, .5));
  float crack = (1. - smoothstep(.0, .009, c1)) * smoothstep(.0, .2, fbm(uv + 11.3, vec2(3.), 3, .5)) * .2;
  float roll = fbm(uv + 3.1, vec2(4.), 4, .55);
  vec2 wp = worley(uv * 30. + 2., vec2(30.));
  float pits = smoothstep(.22, .0, wp.x) * step(.6, hash21(floor(uv * 30. + 2.) + 7.)) * smoothstep(.0, .2, fbm(uv + 2.2, vec2(5.), 3, .5) + .05);
  float grain = fbm(uv + 1.7, vec2(56.), 4, .6);
  return clamp(.5 + broken + roll * .22 + grain * .13 - crack - pits * .2, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float blot = fbm(uv + 9.1, vec2(4.), 4, .5);
  float speck = hash21(floor(uv * 512.));
  vec3 base = mix(vec3(.52, .52, .53), vec3(.72, .70, .67), smoothstep(-.3, .35, blot));
  // Iron in the stone, weathering out warm.
  base = mix(base, vec3(.66, .52, .38), smoothstep(.1, .4, fbm(uv + 13.7, vec2(5.), 4, .55)) * .3);
  // Lichen: pale grey-green and ochre crusts on the high, dry parts.
  vec3 w = worleyId(uv * 11. + 5., vec2(11.));
  float crust = smoothstep(.2, .36, fbm(uv + 21.4, vec2(9.), 4, .6)) * smoothstep(.4, .7, h) * smoothstep(.5, .3, w.x);
  base = mix(base, mix(vec3(.66, .69, .55), vec3(.72, .6, .34), step(.6, w.z)), crust * .6);
  base *= mix(.74, 1.08, smoothstep(.15, .8, h));
  base *= 1. - cavity * .65;
  base *= .95 + speck * .1;
  albedo = base;
  rough = clamp(.9 + cavity * .08 - smoothstep(.6, .9, h) * .1, .55, 1.);
}`,
  },
  // Scree: broken stone lying loose. Stones of three sizes, each a lump highest in its middle,
  // the larger lying on the smaller, with earth and shadow in the gaps.
  scree: {
    normalStrength: 7.,
    height: /* glsl */ `
float lumps(vec2 uv, float n, float share, out float id) {
  vec3 w = worleyId(uv * n + vec2(fbm(uv + n, vec2(4.), 3, .5), fbm(uv + n + 5.3, vec2(4.), 3, .5)) * 1.2, vec2(n));
  id = w.z;
  // Not every cell holds a stone, and those that do hold stones of different sizes.
  float size = mix(.35, .62, fract(w.z * 7.3));
  return step(1. - share, w.z) * smoothstep(size, size * .25, w.x) * smoothstep(.0, .12, w.y - w.x);
}
float heightFn(vec2 uv) {
  float ia, ib, ic;
  float big = lumps(uv, 5., .4, ia) * (.55 + .4 * ia);
  float mid = lumps(uv + 3.7, 11., .7, ib) * (.36 + .25 * ib);
  float small = lumps(uv + 8.1, 26., .9, ic) * (.2 + .12 * ic);
  float grain = fbm(uv + 1.7, vec2(64.), 3, .6);
  return clamp(max(big, max(mid, small)) + .1 + grain * .09 + fbm(uv, vec2(3.), 3, .5) * .1, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib, ic;
  float big = lumps(uv, 5., .4, ia), mid = lumps(uv + 3.7, 11., .7, ib), small = lumps(uv + 8.1, 26., .9, ic);
  float tone = big > .05 ? ia : mid > .05 ? ib : ic;
  vec3 stone = mix(vec3(.44, .43, .43), vec3(.74, .72, .68), fract(tone * 3.7));
  stone = mix(stone, vec3(.6, .5, .38), step(.8, fract(tone * 11.3)) * .5);
  vec3 earth = vec3(.17, .14, .1);
  albedo = mix(earth, stone, smoothstep(.14, .26, h)) * (1. - cavity * .6);
  albedo *= .95 + hash21(floor(uv * 512.)) * .1;
  rough = clamp(.93 + cavity * .05, .6, 1.);
}`,
  },
  // Beaten earth, as on a track: packed and gently uneven, paler where it has dried and darker
  // where it holds the wet, with small stones trodden into it. No two patches the same tone, so
  // that a path is not one colour from end to end.
  soil: {
    normalStrength: 5.,
    height: /* glsl */ `
float pebbles(vec2 uv, float n, float share, out float id) {
  vec3 w = worleyId(uv * n + vec2(fbm(uv + n, vec2(4.), 3, .5), fbm(uv + n + 5.3, vec2(4.), 3, .5)) * 1.1, vec2(n));
  id = w.z;
  float size = mix(.3, .55, fract(w.z * 7.3));
  return step(1. - share, w.z) * smoothstep(size, size * .3, w.x) * smoothstep(.0, .1, w.y - w.x);
}
float heightFn(vec2 uv) {
  float ia, ib, ic;
  float stones = max(pebbles(uv + 1.1, 9., .2, ia) * (.42 + .25 * ia), max(pebbles(uv + 6.4, 19., .34, ib) * (.26 + .16 * ib), pebbles(uv + 2.9, 41., .5, ic) * (.14 + .08 * ic)));
  // Trodden ground: broad shallow hollows where feet fall, and the grain of dried mud.
  float lie = fbm(uv + 2.3, vec2(4.), 4, .55) * .2 + fbm(uv + 7.1, vec2(17.), 3, .5) * .08;
  float crack = smoothstep(.05, .0, worley(uv * 7. + fbm(uv, vec2(5.), 2, .5) * .6, vec2(7.)).y - worley(uv * 7. + fbm(uv, vec2(5.), 2, .5) * .6, vec2(7.)).x) * .08;
  return clamp(.36 + lie + fbm(uv, vec2(70.), 3, .6) * .06 - crack + stones, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib, ic;
  float a = pebbles(uv + 1.1, 9., .2, ia), b = pebbles(uv + 6.4, 19., .34, ib), c = pebbles(uv + 2.9, 41., .5, ic);
  float tone = a > .05 ? ia : b > .05 ? ib : ic;
  vec3 stone = mix(vec3(.36, .34, .31), vec3(.62, .59, .52), fract(tone * 3.7));
  stone = mix(stone, vec3(.5, .41, .3), step(.75, fract(tone * 11.3)) * .6);
  float damp = fbm(uv + 5.5, vec2(3.), 4, .55), dry = fbm(uv + 9.1, vec2(11.), 3, .5);
  // (Pale: dry trodden earth is the colour of sand, not of chocolate.)
  vec3 earth = mix(vec3(.17, .135, .092), vec3(.33, .27, .19), smoothstep(-.35, .35, damp));
  earth = mix(earth, vec3(.39, .33, .245), smoothstep(.05, .5, dry) * .5);
  albedo = mix(earth, stone, smoothstep(.04, .14, max(a, max(b, c)))) * (1. - cavity * .5);
  albedo *= .93 + hash21(floor(uv * 512.)) * .14;
  rough = .95;
}`,
  },
  // The floor of a wood: last year's leaves lying flat on one another, each its own brown, with
  // twigs across them and dark mould showing between.
  litter: {
    normalStrength: 4.5,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  vec2 warp = vec2(fbm(uv + 3.1, vec2(5.), 3, .5), fbm(uv + 7.7, vec2(5.), 3, .5));
  vec3 a = worleyId(uv * 12. + warp * 1.4, vec2(12.)), b = worleyId(uv * 21. + warp * 2. + 4.4, vec2(21.));
  float plateA = (.42 + .4 * a.z - a.x * .32) * smoothstep(.0, .08, a.y - a.x);
  float plateB = (.3 + .32 * b.z - b.x * .3) * smoothstep(.0, .09, b.y - b.x) * step(.25, b.z);
  float twig = smoothstep(.035, .0, abs(gnoise(vec2(uv.x * 3., uv.y * 11.) + 1.3, vec2(3., 11.)))) * step(.12, fbm(uv + 2., vec2(4.), 2, .5)) * .62;
  return clamp(max(max(plateA, plateB), twig) * .85 + fbm(uv, vec2(60.), 3, .6) * .07 + .07, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec2 warp = vec2(fbm(uv + 3.1, vec2(5.), 3, .5), fbm(uv + 7.7, vec2(5.), 3, .5));
  vec3 a = worleyId(uv * 12. + warp * 1.4, vec2(12.)), b = worleyId(uv * 21. + warp * 2. + 4.4, vec2(21.));
  float plateA = (.42 + .4 * a.z - a.x * .32) * smoothstep(.0, .08, a.y - a.x);
  float plateB = (.3 + .32 * b.z - b.x * .3) * smoothstep(.0, .09, b.y - b.x) * step(.25, b.z);
  float id = plateA >= plateB ? a.z : b.z;
  vec3 leaf = mix(vec3(.13, .085, .045), vec3(.3, .2, .09), fract(id * 5.3));
  leaf = mix(leaf, vec3(.27, .12, .05), step(.72, fract(id * 9.7)) * .7);
  leaf = mix(leaf, vec3(.31, .27, .14), step(.86, fract(id * 3.1)) * .6);
  float twig = smoothstep(.035, .0, abs(gnoise(vec2(uv.x * 3., uv.y * 11.) + 1.3, vec2(3., 11.)))) * step(.12, fbm(uv + 2., vec2(4.), 2, .5));
  vec3 mould = vec3(.045, .036, .026);
  albedo = mix(mould, leaf, smoothstep(.12, .24, max(plateA, plateB)));
  albedo = mix(albedo, vec3(.2, .16, .12), twig * .9) * (1. - cavity * .55);
  albedo *= .92 + hash21(floor(uv * 512.)) * .16;
  rough = .9;
}`,
  },
  // The ground under grass: a fine, fibrous mat with earth showing in the low places. No pattern
  // large enough to be seen repeating; the grass standing on it carries the look.
  // Lime plaster: laid on by hand, so never quite flat; fine grit in it; a hairline crack here and
  // there. Nearly white, so the wash on a wall comes from the colour given to each point of it.
  plaster: {
    normalStrength: 2.2,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float trowel = fbm(uv + 1.7, vec2(6.), 4, .55);
  float grit = fbm(uv + 5.1, vec2(90.), 2, .5);
  vec3 c = worleyId(uv * 5. + fbm(uv, vec2(4.), 2, .5) * .6, vec2(5.));
  float crack = (1. - smoothstep(.0, .012, c.y - c.x)) * step(.62, c.z);
  return clamp(.55 + (trowel - .5) * .35 + (grit - .5) * .12 - crack * .25, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float stain = fbm(uv + 9.3, vec2(3.), 4, .55), speck = hash21(floor(uv * 512.));
  albedo = vec3(.9, .89, .86) * (.88 + .14 * stain) * (1. - cavity * .4) * (.97 + .06 * speck);
  rough = .88;
}`,
  },
  // Clay roof tiles of the flat round-ended kind, hung in rows, each row lapping the one below
  // and set half a tile along from it. No two are quite the same red, and some have gone dark.
  tile: {
    normalStrength: 6.5,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float row = floor(uv.y * 8.), fy = fract(uv.y * 8.);
  float x = uv.x * 6. + mod(row, 2.) * .5, fx = fract(x) - .5;
  // The lower end of each tile is round, and shows the tile under it at its corners.
  float body = smoothstep(.0, .07, fy - (.5 - sqrt(max(.25 - fx * fx, 0.))) * .5) * smoothstep(.0, .05, .5 - abs(fx));
  float id = hash21(vec2(floor(x), row) + 3.);
  return clamp((.3 + .5 * (1. - fy) + (id - .5) * .08) * body + .08 + fbm(uv, vec2(48.), 2, .5) * .06, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float row = floor(uv.y * 8.);
  float x = uv.x * 6. + mod(row, 2.) * .5;
  float id = hash21(vec2(floor(x), row) + 3.), worn = fbm(uv + 4.2, vec2(5.), 4, .55);
  vec3 clay = mix(vec3(.5, .2, .12), vec3(.74, .37, .22), id);
  clay = mix(clay, vec3(.3, .2, .16), step(.82, fract(id * 7.3)) * .7);
  clay = mix(clay, vec3(.36, .34, .26), smoothstep(.55, .8, worn) * .45);
  albedo = clay * (1. - cavity * .6) * (.94 + .1 * hash21(floor(uv * 512.)));
  rough = .82;
}`,
  },
  ground: {
    normalStrength: 3.5,
    height: /* glsl */ `
float heightFn(vec2 uv) {
  float clump = fbm(uv + 4.2, vec2(7.), 4, .55);
  float thatch = gnoise(vec2(uv.x * 40., uv.y * 110.), vec2(40., 110.)) * .5 + gnoise(vec2(uv.x * 120., uv.y * 46.), vec2(120., 46.)) * .5;
  float fine = fbm(uv, vec2(90.), 3, .6);
  return clamp(.5 + clump * .55 + thatch * .22 + fine * .16, 0., 1.);
}`,
    surface: /* glsl */ `
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(5.), 4, .55);
  vec3 grass = mix(vec3(.05, .095, .022), vec3(.10, .17, .035), smoothstep(.3, .75, h));
  grass = mix(grass, vec3(.19, .2, .06), smoothstep(.1, .45, t) * .45);
  vec3 earth = vec3(.11, .085, .05);
  albedo = mix(grass, earth, smoothstep(.42, .26, h) * .8) * (1. - cavity * .35);
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

/**
 * The recipes are small programs written for WebGL, and are still painted with it, though
 * everything else is now drawn with WebGPU: a WebGL renderer of their own, on a canvas nobody
 * sees, paints each picture, the picture is read back, and it is handed on as plain data that
 * either kind of renderer can use. It is made when first wanted and thrown away by `doneGenerating`.
 */
let painter: WebGLRenderer | null = null;
export function doneGenerating(): void {
  painter?.dispose();
  painter?.forceContextLoss();
  painter = null;
}

export function generateTextureSet(recipe: keyof typeof RECIPES, size: number, seed: number): TextureSet {
  const renderer = (painter ??= new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false }));
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
  const pixels: Uint8Array[] = [];
  const render = (mode: number, srgb: boolean): Texture => {
    // (A colour picture is kept as colours are kept in a file, which is how it comes back when read.)
    const rt = new WebGLRenderTarget(size, size, { format: RGBAFormat, type: UnsignedByteType, depthBuffer: false, generateMipmaps: false, colorSpace: srgb ? SRGBColorSpace : NoColorSpace });
    material.uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const data = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, data);
    renderer.setRenderTarget(null);
    rt.dispose();
    pixels.push(data);
    const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  renderer.toneMapping = 0;
  const set = { map: render(0, true), normalMap: render(1, false), ormMap: render(2, false), pixels, size };
  material.dispose();
  quad.geometry.dispose();
  return set;
}
