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
// From far off the grain of the stone cannot be seen, and what would be seen instead is the
// same square of it laid side by side to the horizon. So with distance it is read ever more
// blurred, until a hillside a quarter of a mile away has the stone's colour and none of its pattern.
float rockBlur = 6.0 * smoothstep( 110.0, 320.0, length( vViewPosition ) );
vec4 rockTex = texture2D( uRockMap, rockUx, rockBlur ) * rockW.x + texture2D( uRockMap, rockUy, rockBlur ) * rockW.y + texture2D( uRockMap, rockUz, rockBlur ) * rockW.z;
// The same stone seen from far off: patches some metres across.
vec4 rockFar = texture2D( uRockMap, vec2( vRockPos.x + vRockPos.z * 0.71, vRockPos.y * 0.9 + vRockPos.z * 0.37 ) * uRockScale * 0.11, rockBlur * 0.6 );
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
  vec3 tx = texture2D( uRockNormal, rockUx, rockBlur ).xyz * 2.0 - 1.0;
  vec3 ty = texture2D( uRockNormal, rockUy, rockBlur ).xyz * 2.0 - 1.0;
  vec3 tz = texture2D( uRockNormal, rockUz, rockBlur ).xyz * 2.0 - 1.0;
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
  m.customProgramCacheKey = () => 'rock-v4';
  return m;
}

/** What far land is covered with in this season: its woods and its open ground. */
export const farUniforms = { uFarWood: { value: new Vector3(0.07, 0.15, 0.06) }, uFarGrass: { value: new Vector3(0.16, 0.2, 0.08) } };

/**
 * The material for land far off: the hills and mountains round the valley. Nothing out there is
 * built or planted. It is one sheet of ground, far too coarse to carry a tree or a ledge, and
 * everything that makes it look like country is worked out for each point of the picture as it
 * is drawn:
 *  - what covers the ground, from how high it is, how steep, and whether it is a hollow or a
 *    spur: woods low down and up the gullies, pasture above, bare rock in beds where it is
 *    steep, scree under the faces, snow on what is high and not too steep to hold it. The edges
 *    of each are ragged, as they are, and not smeared from one corner of the sheet to the next;
 *  - in the woods, the crowns of the trees: each a small dome, lit on its sunward side, dark
 *    between it and the next. From a quarter of a mile this is what a wood looks like, and it
 *    costs nothing like what the trees would;
 *  - ribs and gullies smaller than the sheet can hold, as light and shade only.
 * All of it fades out as it becomes too small to draw, so nothing glitters at the horizon.
 * Each point of the sheet carries how high it stands (0 at the foot of its range, 1 at about
 * the height where rock takes over) and how much of a hollow it is, in the fields other
 * materials use for moss and damp.
 */
export function makeFarMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true, color: new Color(1, 1, 1) });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = siteUniforms.uBake;
    shader.uniforms.uFallback = siteUniforms.uFallback;
    shader.uniforms.uFarWood = farUniforms.uFarWood;
    shader.uniforms.uFarGrass = farUniforms.uFarGrass;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec4 aSHr; attribute vec4 aSHg; attribute vec4 aSHb;
attribute vec4 aField;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec3 vFarPos; varying vec3 vFarNrm;`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
vSHr = aSHr; vSHg = aSHg; vSHb = aSHb; vField = aField;
vFarPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
vFarNrm = normalize( mat3( modelMatrix ) * normal );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
uniform float uBake; uniform vec3 uFallback; uniform vec3 uFarWood; uniform vec3 uFarGrass;
varying vec4 vSHr; varying vec4 vSHg; varying vec4 vSHb;
varying vec4 vField; varying vec3 vFarPos; varying vec3 vFarNrm;
float farHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float farNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( farHash( i ), farHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( farHash( i + vec2( 0.0, 1.0 ) ), farHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float farFbm( vec2 p ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 4; i++ ) { s += a * farNoise( p ); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// The crowns of a wood seen from above: how high the nearest crown stands at a point (0 between
// trees, 1 at a top), which way it slopes there, and a number of its own for each tree.
vec4 farCrowns( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  float best = 9.0, id = 0.0;
  vec2 to = vec2( 0.0 );
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    float h = farHash( i + g );
    vec2 o = g + 0.1 + 0.8 * vec2( h, fract( h * 57.31 ) ) - f;
    float d = dot( o, o ) / ( 0.3 + 0.22 * fract( h * 13.7 ) );
    if ( d < best ) { best = d; to = o; id = h; }
  }
  float h = max( 0.0, 1.0 - best );
  return vec4( h, to * step( 0.001, h ) * 2.4, id );
}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
vec3 farN = normalize( vFarNrm );
float farShine = 0.08;
{
  vec2 fp = vFarPos.xz;
  float high = vField.w, hollow = vField.z;
  // How much of the picture one metre of ground takes up here: what is smaller than a point of it is left out.
  float grain = max( length( dFdx( fp ) ), length( dFdy( fp ) ) );
  float n0 = farFbm( fp * 0.03 ), fine = farNoise( fp * 0.21 );
  // Ribs and gullies, as light and shade. Water runs straight down a slope, so what it has cut
  // runs that way too: unevenness drawn out along the line of fall and left as it is across it.
  vec2 down = farN.xz / max( length( farN.xz ), 0.04 );
  float run = 0.0;
  for ( int k = -2; k <= 2; k++ ) run += farNoise( ( fp + down * float( k ) * 10.0 ) * 0.075 ) + 0.5 * farNoise( ( fp + down * float( k ) * 4.0 ) * 0.19 + 9.0 );
  run = run / 7.5 - 0.5;
  float sloping = smoothstep( 0.015, 0.16, 1.0 - farN.y ) * ( 1.0 - smoothstep( 3.0, 9.0, grain ) );
  float steep = 1.0 - smoothstep( 0.52, 0.74, farN.y );
  float ragged = ( n0 - 0.5 ) + ( fine - 0.5 ) * 0.2 + run * 0.9 * sloping;
  // Rock, in beds some metres thick, each its own shade; darker where it is steep and in hollows.
  float bedAt = ( vFarPos.y + n0 * 34.0 + fp.x * 0.06 ) / 7.0;
  float bed = mix( farHash( vec2( floor( bedAt ), 3.0 ) ), 0.5, smoothstep( 0.25, 0.8, fwidth( bedAt ) ) );
  vec3 land = diffuseColor.rgb * ( 0.62 + 0.5 * bed + 0.3 * ( n0 - 0.5 ) ) * ( 1.0 - 0.28 * steep ) * ( 1.0 - 0.28 * max( hollow, 0.0 ) );
  // The gullies are the darker lines.
  float gullied = 1.0 + run * 1.5 * sloping;
  // Scree: pale and even, on slopes below the faces that are neither steep nor level.
  land = mix( land, vec3( 0.33, 0.32, 0.31 ) * ( 0.85 + 0.3 * fine ), 0.65 * smoothstep( 0.3, 0.5, high + ragged * 0.2 ) * ( 1.0 - steep ) * smoothstep( 0.93, 0.83, farN.y ) );
  // Pasture above the trees, on what is not too steep.
  land = mix( land, uFarGrass * ( 0.8 + 0.45 * n0 ), smoothstep( 0.0, 0.07, 0.62 - high + 0.3 * ragged ) * ( 1.0 - steep ) * 0.9 );
  // Woods low down, reaching higher up the gullies than on the spurs between them.
  float wood = smoothstep( 0.0, 0.05, 0.37 - high + 0.13 * hollow + 0.42 * ragged ) * ( 1.0 - 0.85 * steep );
  if ( wood > 0.0 ) {
    // Two sizes of tree, in stands.
    // Two kinds of tree, in stands: the smaller and darker are firs.
    float firs = smoothstep( 0.42, 0.58, farNoise( fp * 0.011 + 5.0 ) + ( high - 0.2 ) * 0.5 );
    float size = mix( 3.7, 2.6, firs );
    vec4 crown = farCrowns( fp / size );
    float seen = 1.0 - smoothstep( 0.25, 0.7, grain / size );
    vec3 green = uFarWood * mix( vec3( 1.0 ), vec3( 0.62, 0.74, 0.82 ), firs ) * ( 0.9 + 0.2 * fine );
    // Under the trees it is dark, whatever the ground is.
    land = mix( land, green * 0.45, wood * 0.9 );
    // A wood thins out a tree at a time, not all together: each tree stands or does not.
    float standing = step( fract( crown.w * 91.3 ), wood * 1.05 ) * smoothstep( 0.0, 0.3, crown.x );
    float tone = ( 0.74 + 0.36 * crown.x ) * ( 0.8 + 0.4 * crown.w );
    land = mix( land, green * mix( 0.84, tone, seen ), mix( wood, standing, seen ) );
    farN = normalize( farN - vec3( crown.y, 0.0, crown.z ) * 0.3 * seen * standing );
  }
  // Snow on what is high, lying deeper in hollows and blown off what is steep.
  float snow = smoothstep( 0.0, 0.08, high - 0.6 + 0.12 * hollow + 0.35 * ragged ) * smoothstep( 0.5, 0.72, farN.y );
  land = mix( land, vec3( 1.3, 1.34, 1.42 ), snow );
  farShine = mix( 0.08, 0.5, snow );
  diffuseColor.rgb = land * mix( gullied, 1.0, snow * 0.7 );
}`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
normal = normalize( ( viewMatrix * vec4( farN, 0.0 ) ).xyz );`)
      .replace('#include <lights_fragment_end>', /* glsl */ `
{
  vec3 wn = inverseTransformDirection( normal, viewMatrix );
  vec3 baked = max( vec3( dot( vSHr, vec4( 1.0, wn ) ), dot( vSHg, vec4( 1.0, wn ) ), dot( vSHb, vec4( 1.0, wn ) ) ), 0.0 );
  vec3 fallback = uFallback * ( 0.55 + 0.45 * wn.y );
  irradiance = mix( fallback, baked, uBake );
  iblIrradiance = vec3( 0.0 );
}
#include <lights_fragment_end>
reflectedLight.directSpecular *= farShine; reflectedLight.indirectSpecular *= farShine;`);
  };
  m.customProgramCacheKey = () => 'far-v4';
  return m;
}
