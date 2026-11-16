import { Color, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import { TextureSet } from './textures';

/**
 * The material used for all static site geometry: a standard physically based material with
 *  - indirect light taken from the per-vertex bake instead of a uniform ambient term,
 *  - moss, damp and soot blended in from per-vertex fields, following the height map so growth
 *    starts in the low spots.
 */

export interface SiteUniforms {
  /** 0 before the bake has arrived, 1 once it has. */
  uBake: { value: number };
  /** Stand-in sky light used until the bake arrives. */
  uFallback: { value: Vector3 };
}

export const siteUniforms: SiteUniforms = {
  uBake: { value: 0 },
  uFallback: { value: new Vector3(0.35, 0.4, 0.5) },
};

/**
 * `matt` is for ground: turf and loose stone throw back almost no gleam. With the ordinary sheen
 * every surface has at a glancing angle, land seen from the air goes pale as milk with distance.
 */
export function makeSiteMaterial(base: TextureSet, moss: TextureSet, o: { normalScale?: number; roughness?: number; mossScale?: number; matt?: boolean } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: base.map,
    normalMap: base.normalMap,
    normalScale: new Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    aoMap: base.ormMap,
    roughnessMap: base.ormMap,
    roughness: o.roughness ?? 1,
    metalness: 0,
    vertexColors: true,
    color: new Color(1, 1, 1),
  });

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = siteUniforms.uBake;
    shader.uniforms.uFallback = siteUniforms.uFallback;
    shader.uniforms.uMossMap = { value: moss.map };
    shader.uniforms.uMossScale = { value: o.mossScale ?? 1.7 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec4 aSHr; attribute vec4 aSHg; attribute vec4 aSHb;
attribute vec4 aField; attribute vec2 aBake;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec2 vBake;`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
vSHr = aSHr; vSHg = aSHg; vSHb = aSHb; vField = aField; vBake = aBake;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform float uBake; uniform vec3 uFallback; uniform sampler2D uMossMap; uniform float uMossScale;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec2 vBake;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
float siteMoss = 0.0;
float siteWet = vField.y;
{
  float stoneH = texture2D( map, vMapUv ).a;
  vec4 mossTex = texture2D( uMossMap, vMapUv * uMossScale );
  // Moss wants sky above it and little direct sun; before the bake arrives, use the raw field.
  float lightOk = mix( 0.4, smoothstep( 0.03, 0.3, vBake.x ) * ( 1.0 - 0.92 * smoothstep( 0.2, 0.8, vBake.y ) ), uBake );
  float grow = vField.x * lightOk;
  float m = grow * 1.5 + ( 1.0 - stoneH ) * 0.4 + mossTex.a * 0.45 - 1.0;
  siteMoss = smoothstep( 0.0, 0.22, m );
  // Damp stone is darker; soot is darker still and matt.
  diffuseColor.rgb *= mix( 1.0, 0.5, siteWet );
  diffuseColor.rgb = mix( diffuseColor.rgb, mossTex.rgb, siteMoss );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.012 ), vField.z * 0.9 );
}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor *= mix( 1.0, 0.42, siteWet * ( 1.0 - siteMoss ) );
roughnessFactor = mix( roughnessFactor, 0.97, max( siteMoss, vField.z ) );`)
      .replace('#include <lights_fragment_end>', /* glsl */ `
{
  vec3 wn = inverseTransformDirection( geometryNormal, viewMatrix );
  vec3 baked = max( vec3( dot( vSHr, vec4( 1.0, wn ) ), dot( vSHg, vec4( 1.0, wn ) ), dot( vSHb, vec4( 1.0, wn ) ) ), 0.0 );
  vec3 fallback = uFallback * ( 0.55 + 0.45 * wn.y );
  irradiance = mix( fallback, baked, uBake );
  iblIrradiance = vec3( 0.0 );
  // vBake: x = share of sky seen, y = share of the day in direct sun.
  // Reflections of the sky only where the sky can be seen.
  radiance *= mix( 0.3, smoothstep( 0.0, 0.5, vBake.x ), uBake );
}
#include <lights_fragment_end>
${o.matt ? 'reflectedLight.directSpecular *= 0.12; reflectedLight.indirectSpecular *= 0.12;' : ''}`);
  };
  // Every site material shares one program per texture layout.
  m.customProgramCacheKey = () => (o.matt ? 'site-v1-matt' : 'site-v1');
  return m;
}

/**
 * A material for small loose things: iron fittings, torch brands, keys. They are not part of the
 * light bake, and left to themselves they would be lit by the open sky wherever they are, indoors
 * included. Here they get a faint fixed ambient instead, and otherwise only the real lights.
 */
export function makePropMaterial(o: { color: Color; roughness: number; metalness: number; emissive?: Color; emissiveIntensity?: number }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: o.color, roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? new Color(0, 0, 0), emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */ `
irradiance = vec3( 0.05, 0.045, 0.04 );
iblIrradiance = vec3( 0.0 );
radiance = vec3( 0.0 );
#include <lights_fragment_end>`);
  };
  m.customProgramCacheKey = () => 'prop-v1';
  return m;
}

/**
 * The material for natural rock. Carved rock has no texture coordinates worth the name, so the
 * texture is laid on from three sides by where each point is, and blended by which way it faces:
 * nothing stretches, on any slope or under any overhang. Over that:
 *  - the same texture read very large gives slow changes of tone, so no repeat can be seen;
 *  - on steep faces, thin beds of lighter and darker stone, and dark streaks where water runs down;
 *  - moss and damp from the per-vertex fields, as on masonry.
 * Light comes from the bake where there is one, and from the open sky where there is not.
 */
/** How strongly rock shows broad flat faces: set for the kind of stone the place is made of. */
export const rockUniforms = { uRockBroad: { value: 0.8 } };

export function makeRockMaterial(base: TextureSet, moss: TextureSet, o: { scale?: number; normalScale?: number; dip?: [number, number] } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true, color: new Color(1, 1, 1) });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = siteUniforms.uBake;
    shader.uniforms.uFallback = siteUniforms.uFallback;
    shader.uniforms.uMossMap = { value: moss.map };
    shader.uniforms.uRockMap = { value: base.map };
    shader.uniforms.uRockNormal = { value: base.normalMap };
    shader.uniforms.uRockScale = { value: o.scale ?? 0.3 };
    shader.uniforms.uRockBump = { value: o.normalScale ?? 1.4 };
    shader.uniforms.uRockBroad = rockUniforms.uRockBroad;
    shader.uniforms.uRockDip = { value: new Vector2(o.dip?.[0] ?? 0.05, o.dip?.[1] ?? 0.03) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec4 aSHr; attribute vec4 aSHg; attribute vec4 aSHb;
attribute vec4 aField; attribute vec2 aBake;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec2 vBake;
varying vec3 vRockPos; varying vec3 vRockNrm;`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
vSHr = aSHr; vSHg = aSHg; vSHb = aSHb; vField = aField; vBake = aBake;
vRockPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
vRockNrm = normalize( mat3( modelMatrix ) * normal );`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform float uBake; uniform vec3 uFallback; uniform sampler2D uMossMap;
uniform sampler2D uRockMap; uniform sampler2D uRockNormal; uniform float uRockScale; uniform float uRockBump; uniform float uRockBroad; uniform vec2 uRockDip;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec2 vBake;
varying vec3 vRockPos; varying vec3 vRockNrm;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
vec3 rockN = normalize( vRockNrm );
vec3 rockW = pow( abs( rockN ), vec3( 5.0 ) );
rockW /= rockW.x + rockW.y + rockW.z;
vec2 rockUx = vRockPos.zy * uRockScale, rockUy = vRockPos.xz * uRockScale, rockUz = vRockPos.xy * uRockScale;
vec4 rockTex = texture2D( uRockMap, rockUx ) * rockW.x + texture2D( uRockMap, rockUy ) * rockW.y + texture2D( uRockMap, rockUz ) * rockW.z;
// The same stone seen from far off: patches some metres across.
vec4 rockFar = texture2D( uRockMap, vec2( vRockPos.x + vRockPos.z * 0.71, vRockPos.y * 0.9 + vRockPos.z * 0.37 ) * uRockScale * 0.11 );
float siteMoss = 0.0;
float siteWet = vField.y;
float rockAo = mix( 0.45, 1.0, smoothstep( 0.08, 0.5, rockTex.a ) );
{
  float steep = 1.0 - smoothstep( 0.4, 0.75, abs( rockN.y ) );
  vec3 rock = rockTex.rgb * mix( vec3( 0.8, 0.79, 0.8 ), vec3( 1.2, 1.17, 1.1 ), smoothstep( 0.25, 0.75, rockFar.a ) );
  // Thin beds within the thick ones: bands a hand or two deep, gathered into broader ones, each
  // its own shade, with a dark line where one lies on the next. They fade out with distance,
  // before they could shimmer.
  float bedAt = ( vRockPos.y + dot( vRockPos.xz, uRockDip ) ) * 3.3 + ( rockFar.r - 0.5 ) * 4.0;
  float beds = vField.w * steep * ( 1.0 - smoothstep( 0.2, 0.55, fwidth( bedAt ) ) );
  float bedIn = fract( bedAt );
  float bedTone = mix( 0.72, 1.14, fract( sin( floor( bedAt ) * 91.7 ) * 43758.5 ) ) * mix( 0.86, 1.1, fract( sin( floor( bedAt * 0.27 ) * 57.3 ) * 24634.6 ) );
  float bedLine = smoothstep( 0.0, 0.14, bedIn ) * smoothstep( 1.0, 0.9, bedIn );
  rock *= mix( 1.0, bedTone * mix( 0.62, 1.0, bedLine ), beds );
  rockAo *= mix( 1.0, mix( 0.65, 1.0, bedLine ), beds );
  // Where water runs down a face it leaves dark streaks, long and narrow.
  float streak = texture2D( uRockMap, vec2( vRockPos.z * 0.37, vRockPos.y * 0.03 ) ).a * rockW.x + texture2D( uRockMap, vec2( vRockPos.x * 0.37, vRockPos.y * 0.03 + 0.5 ) ).a * rockW.z;
  float stain = smoothstep( 0.5, 0.72, streak ) * steep * ( 0.35 + 0.65 * vField.w );
  rock *= mix( vec3( 1.0 ), vec3( 0.56, 0.53, 0.5 ), stain * 0.75 );
  siteWet = max( siteWet, stain * 0.25 );
  diffuseColor.rgb *= rock;

  // Moss: from above on what is level, from the side on what is not.
  vec2 mossUv = ( rockW.x > rockW.z ? rockUx : rockUz ) * 5.5;
  vec4 mossTex = mix( texture2D( uMossMap, mossUv ), texture2D( uMossMap, rockUy * 5.5 ), rockW.y );
  float lightOk = mix( 0.4, smoothstep( 0.03, 0.3, vBake.x ) * ( 1.0 - 0.92 * smoothstep( 0.2, 0.8, vBake.y ) ), uBake );
  float grow = vField.x * lightOk;
  float mossAt = grow * 1.5 + ( 1.0 - rockTex.a ) * 0.4 + mossTex.a * 0.45 - 1.0;
  siteMoss = smoothstep( 0.0, 0.22, mossAt );
  diffuseColor.rgb *= mix( 1.0, 0.5, siteWet );
  diffuseColor.rgb = mix( diffuseColor.rgb, mossTex.rgb, siteMoss );
}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = clamp( 0.93 - 0.14 * smoothstep( 0.55, 0.9, rockTex.a ), 0.5, 1.0 );
roughnessFactor *= mix( 1.0, 0.45, siteWet * ( 1.0 - siteMoss ) );
roughnessFactor = mix( roughnessFactor, 0.97, siteMoss );`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
{
  // The normal map from three sides, each bent onto the surface and blended as the colour was.
  // It is read twice: as it is, for the grain and the small breaks, and four times larger, for
  // faces a stride or two across, which the carved surface is too coarse to hold an edge on.
  vec3 tx = texture2D( uRockNormal, rockUx ).xyz * 2.0 - 1.0;
  vec3 ty = texture2D( uRockNormal, rockUy ).xyz * 2.0 - 1.0;
  vec3 tz = texture2D( uRockNormal, rockUz ).xyz * 2.0 - 1.0;
  tx.xy += ( texture2D( uRockNormal, rockUx * 0.23 + 0.37 ).xy * 2.0 - 1.0 ) * uRockBroad;
  ty.xy += ( texture2D( uRockNormal, rockUy * 0.23 + 0.37 ).xy * 2.0 - 1.0 ) * uRockBroad * 0.5;
  tz.xy += ( texture2D( uRockNormal, rockUz * 0.23 + 0.37 ).xy * 2.0 - 1.0 ) * uRockBroad;
  float bump = uRockBump * ( 1.0 - 0.6 * siteMoss );
  tx = vec3( tx.xy * bump + rockN.zy, abs( tx.z ) * rockN.x );
  ty = vec3( ty.xy * bump + rockN.xz, abs( ty.z ) * rockN.y );
  tz = vec3( tz.xy * bump + rockN.xy, abs( tz.z ) * rockN.z );
  vec3 bent = normalize( tx.zyx * rockW.x + ty.xzy * rockW.y + tz.xyz * rockW.z );
  normal = normalize( ( viewMatrix * vec4( bent, 0.0 ) ).xyz );
}`)
      .replace('#include <lights_fragment_end>', /* glsl */ `
{
  vec3 wn = inverseTransformDirection( geometryNormal, viewMatrix );
  vec3 baked = max( vec3( dot( vSHr, vec4( 1.0, wn ) ), dot( vSHg, vec4( 1.0, wn ) ), dot( vSHb, vec4( 1.0, wn ) ) ), 0.0 );
  vec3 fallback = uFallback * ( 0.55 + 0.45 * wn.y );
  // The pits and cracks of the texture hold less of the sky's light.
  irradiance = mix( fallback, baked, uBake ) * rockAo;
  iblIrradiance = vec3( 0.0 );
  radiance *= mix( 0.3, smoothstep( 0.0, 0.5, vBake.x ), uBake ) * rockAo;
}
#include <lights_fragment_end>
// Rough rock gleams little, and less where it is dry.
reflectedLight.directSpecular *= mix( 0.3, 1.0, siteWet );
reflectedLight.indirectSpecular *= mix( 0.3, 1.0, siteWet );`);
  };
  m.customProgramCacheKey = () => 'rock-v3';
  return m;
}
