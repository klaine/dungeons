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

export function makeSiteMaterial(base: TextureSet, moss: TextureSet, o: { normalScale?: number; roughness?: number; mossScale?: number } = {}): MeshStandardMaterial {
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
#include <lights_fragment_end>`);
  };
  // Every site material shares one program per texture layout.
  m.customProgramCacheKey = () => 'site-v1';
  return m;
}
