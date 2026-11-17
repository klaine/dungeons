import { Color, Vector2, Vector3, Vector4 } from 'three';
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { TextureSet } from './textures';

/**
 * The materials used for all static site geometry: standard physically based materials with
 *  - indirect light taken from the per-vertex bake instead of a uniform ambient term,
 *  - moss, damp and soot blended in from per-vertex fields, following the height map so growth
 *    starts in the low spots.
 *
 * They are written as node materials: each is a standard material whose colour, roughness and
 * normal are given as small programs built here, and whose lighting is the standard lighting
 * with three things changed (see `BakedLighting`). The renderer turns them into whatever its
 * graphics interface wants, WebGPU or WebGL 2.
 */

/**
 * A piece of such a program. The library's own types for these are stricter than is useful here:
 * they want every step of a calculation to declare whether it is one number or three, which
 * the calculation already knows. So the pieces, and the functions that make them, are taken untyped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const {
  Break, Fn, If, Loop, abs, attribute, cameraPosition, dFdx, dFdy, dot, float, floor, fract, fwidth, length, materialRoughness, max, min, mix,
  normalMap, normalWorldGeometry, normalize, positionView, positionWorld, pow, select, sin, smoothstep, step, texture, transformNormalToView,
  uniform, uv, vec2, vec3, vec4, vertexColor,
} = TSL as N;

export interface SiteUniforms {
  /** 0 before the bake has arrived, 1 once it has. */
  uBake: { value: number };
  /** Stand-in sky light used until the bake arrives. */
  uFallback: { value: Vector3 };
}

export const siteUniforms: SiteUniforms = {
  uBake: uniform(0) as N,
  uFallback: uniform(new Vector3(0.35, 0.4, 0.5)) as N,
};
const uBake = siteUniforms.uBake as N, uFallback = siteUniforms.uFallback as N;

// What every point of the site carries besides where it is and which way it faces: baked light
// (for each colour a level and the way it comes from), four fields (moss, damp, soot and one
// more, used differently by each material), and two numbers from the bake: the share of sky
// seen, and the share of the day in direct sun.
const shOf = (): N[] => [attribute('aSHr', 'vec4'), attribute('aSHg', 'vec4'), attribute('aSHb', 'vec4')];
const fieldOf = (): N => attribute('aField', 'vec4');
const bakeOf = (): N => attribute('aBake', 'vec2');
const one = (x: N): N => float(1).sub(x);
/** `smoothstep`, which may also be asked to fall instead of rise (the first edge above the second). */
const sstep = (a: number, b: number, x: N): N => (a > b ? one(smoothstep(b, a, x)) : smoothstep(a, b, x));

/** The baked light on a surface facing `wn`. */
const bakedAt = (wn: N): N => {
  const [r, g, b] = shOf(), n4 = vec4(1, wn);
  return max(vec3(dot(r, n4), dot(g, n4), dot(b, n4)), 0);
};
/**
 * 1 for what sees no sky out where the sun's shadows are not kept: under the hill, or indoors in
 * a building that is not baked. (Out there the two numbers a point carries are how much sky it
 * sees and a fixed share of sun; in the house they come from the bake, which never finds a
 * place with no sky and half a day's sun.) Such a point is not lit by the sun, whatever the
 * light thinks, and has light of its own whether or not the house's light has been reckoned.
 */
const underHill = (bk: N): N => one(smoothstep(0.004, 0.06, bk.x)).mul(step(0.55, bk.y));
/** Indirect light: the bake once it has arrived (or at once, for what has light of its own), and a stand-in for the sky until then. */
const irradianceOf = (wn: N, bk: N): N => mix(uFallback.mul(float(0.55).add(wn.y.mul(0.45))), bakedAt(wn), max(uBake, underHill(bk)));

/**
 * The standard lighting, with three things changed:
 *  - indirect light is what is given here (the bake), and nothing is taken from the sky's picture for it;
 *  - the sun's light is multiplied by `sun` (for what is under the hill and must not have it);
 *  - reflections of the sky are multiplied by `sky` (they belong only where the sky can be seen),
 *    and all gleam by `gleam` (ground and dry rock throw back almost none).
 */
class BakedLighting extends (PhysicalLightingModel as N) {
  constructor(private readonly o: { irradiance: N; sun?: N; sky?: N; gleam?: N }) {
    super();
  }

  direct(data: N, builder: N): void {
    if (this.o.sun && data.lightNode?.light?.isDirectionalLight) data = { ...data, lightColor: data.lightColor.mul(this.o.sun) };
    super.direct(data, builder);
  }

  indirect(builder: N): void {
    const c = builder.context;
    c.irradiance.assign(this.o.irradiance);
    c.iblIrradiance.assign(vec3(0));
    if (this.o.sky) c.radiance.mulAssign(this.o.sky);
    super.indirect(builder);
    if (this.o.gleam) {
      c.reflectedLight.directSpecular.mulAssign(this.o.gleam);
      c.reflectedLight.indirectSpecular.mulAssign(this.o.gleam);
    }
  }
}
const lit = (m: MeshStandardNodeMaterial, o: { irradiance: N; sun?: N; sky?: N; gleam?: N }): void => {
  (m as N).setupLightingModel = () => new BakedLighting(o);
};

/**
 * `matt` is for ground: turf and loose stone throw back almost no gleam. With the ordinary sheen
 * every surface has at a glancing angle, land seen from the air goes pale as milk with distance.
 */
export function makeSiteMaterial(base: TextureSet, moss: TextureSet, o: { normalScale?: number; roughness?: number; mossScale?: number; matt?: boolean } = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    normalMap: base.normalMap,
    normalScale: new Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    aoMap: base.ormMap,
    roughnessMap: base.ormMap,
    roughness: o.roughness ?? 1,
    metalness: 0,
    color: new Color(1, 1, 1),
  });
  const f = fieldOf(), bk = bakeOf();
  const stone: N = texture(base.map, uv()), mossTex: N = texture(moss.map, uv().mul(o.mossScale ?? 1.7));
  const wet = f.y;
  // Moss wants sky above it and little direct sun; before the bake arrives, use the raw field.
  const lightOk = mix(0.4, smoothstep(0.03, 0.3, bk.x).mul(one(smoothstep(0.2, 0.8, bk.y).mul(0.92))), uBake);
  const mossy = smoothstep(0, 0.22, f.x.mul(lightOk).mul(1.5).add(one(stone.a).mul(0.4)).add(mossTex.a.mul(0.45)).sub(1));
  // Damp stone is darker; soot is darker still and matt.
  let colour: N = stone.rgb.mul(vertexColor().rgb).mul(mix(1, 0.5, wet));
  colour = mix(colour, mossTex.rgb, mossy);
  colour = mix(colour, vec3(0.012), f.z.mul(0.9));
  m.colorNode = vec4(colour, 1);
  m.roughnessNode = mix(materialRoughness.mul(mix(1, 0.42, wet.mul(one(mossy)))), 0.97, max(mossy, f.z));
  // Stone that sees no sky, out where the sun's shadows are not kept, is indoors: the inside of
  // a tower in the valley, say. The sun does not reach it through its walls.
  // Reflections of the sky only where the sky can be seen.
  lit(m, { irradiance: irradianceOf(normalWorldGeometry, bk), sun: one(underHill(bk)), sky: mix(0.3, smoothstep(0, 0.5, bk.x), uBake), gleam: o.matt ? float(0.12) : undefined });
  return m;
}

/**
 * The material for ground: everything nearly level out of doors. It was grass texture with a
 * brown tint smeared along the track from one point of the sheet to the next, which looked
 * like what it was. Now the sheet says, at each of its points, how bare the ground is, how wet
 * and how much under trees (in the fields that masonry uses for damp, soot and so on), and
 * what is drawn is worked out for each point of the picture from those and from the textures
 * themselves:
 *  - turf, with broad slow changes of tone and dry patches, so that a hillside is not one green;
 *  - beaten earth where the ground is bare, pale and gritty with small stones in it; where it
 *    is wet as well, the shingle of a stream's bed;
 *  - last year's leaves under trees;
 *  - and the edges between them where the textures put them, not where the sheet's points
 *    happen to fall: grass holds on where its mat stands high and gives way where the earth
 *    does, so the edge of a track is ragged, with tufts out in the bare ground and bare ground
 *    in among the grass.
 * How much trouble is taken depends on how far off the ground is. Within a few strides bare
 * ground is drawn with depth: its stones stand up out of it and hide what is behind them as
 * the eye moves (the texture is slid along the line of sight by its own heights, a few steps
 * of it). Further off there is texture and its light and shade only. Further still the
 * textures are read more and more blurred, until a far field is its colour and its broad
 * variation and nothing that could be seen repeating.
 */
export function makeGroundMaterial(turf: TextureSet, soil: TextureSet, shingle: TextureSet, litter: TextureSet, thatch: TextureSet, moss: TextureSet, scale = 2.3): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0, color: new Color(1, 1, 1) });
  const f = fieldOf(), bk = bakeOf();
  // Where on the ground this point of the picture is, in metres; every texture is laid by that.
  const at0: N = positionWorld.xz, far: N = length(positionView), blur: N = smoothstep(70, 260, far).mul(5);
  const turfAt = (at: N): N => texture(turf.map, at);
  // The same turf read very large: slow changes of tone that no repeat can be seen in.
  const macro = turfAt(at0.div(41).add(0.37)).a, mid = turfAt(at0.div(9.7).add(0.11)).a;
  // The track: two ruts, a stride apart, and between them bare earth wherever grass is not
  // standing in a clump. (The sheet gives how far this point is to one side of the track's
  // middle, plus a hundred; nothing where there is no track.) Neither the ruts nor the edges
  // of the track run straight: they wander, and widen and narrow.
  const wander = turfAt(at0.div(5.3).add(0.61)).a.sub(0.5);
  const off = abs(f.x.sub(100).add(wander.mul(0.34))).add(mid.sub(0.5).mul(0.3));
  // (The field says how far from the track's middle, plus a hundred; or from a footpath's, plus two hundred.)
  const onFoot: N = step(150, f.x), onTrack: N = step(50, f.x).mul(one(onFoot));
  // A footpath: one worn line, a forearm's breadth or two, wandering a little either side of where it is laid.
  const footOff: N = abs(f.x.sub(200)).add(wander.mul(0.22)).toVar();
  const footBare: N = one(smoothstep(0.22, 0.5, footOff.add(mid.sub(0.5).mul(0.25)))).mul(onFoot).toVar();
  const rut: N = one(smoothstep(0, 0.34, abs(off.sub(0.58)).sub(0.2).sub(wander.mul(0.14)))).toVar();
  // The bottom of a rut, where wheels have pressed the earth down hard: narrower than the rut.
  const rutFloor: N = one(smoothstep(0, 0.16, abs(off.sub(0.58)).sub(0.08).sub(wander.mul(0.08)))).mul(onTrack).toVar();
  const clump = sin(at0.y.mul(0.9).add(sin(at0.y.mul(0.31)).mul(2.2)));
  const bareV: N = max(select(f.x.greaterThan(50).and(f.x.lessThan(150)), max(f.z, max(rut, sstep(-0.15, -0.35, clump).mul(one(smoothstep(0.25, 0.5, off))))), f.z), footBare.mul(0.85)).toVar();
  const wetV = f.y, litV = f.w;
  const stony: N = smoothstep(0.2, 0.55, wetV.add(mid.sub(0.5).mul(0.3))).toVar();
  // Near the eye, bare ground has depth: the texture is slid along the line of sight until the
  // line meets the height the texture has there, so stones stand up and hide what is behind them.
  const near = one(smoothstep(6, 14, far));
  const at: N = Fn(() => {
    const p: N = vec2(at0).toVar();
    If(near.greaterThan(0).and(bareV.greaterThan(0.04)), () => {
      const eye: N = normalize(cameraPosition.sub(positionWorld));
      const slide: N = eye.xz.div(max(eye.y, 0.3)).mul(mix(0.022, 0.05, stony)).mul(near).mul(smoothstep(0.04, 0.4, bareV)).toVar();
      const sunk: N = float(0).toVar();
      Loop(6, () => {
        const q = at0.sub(slide.mul(sunk));
        const h = mix((texture(soil.map, q.mul(1.5)) as N).level(0).a, (texture(shingle.map, q.mul(0.62)) as N).level(0).a, stony);
        If(one(h).lessThanEqual(sunk), () => { Break(); });
        sunk.addAssign(1 / 6);
      });
      p.subAssign(slide.mul(sunk));
    });
    return p;
  })().toVar();
  const gUv = at.mul(scale);
  // The turf is read twice, the second time larger and turned, and the two mixed: neither one's repeat survives the other.
  const gTurf: N = mix((texture(turf.map, gUv) as N).bias(blur), (texture(turf.map, at.yx.mul(0.83).add(0.29)) as N).bias(blur), 0.45).toVar();
  const gSoil: N = (texture(soil.map, at.mul(1.5)) as N).bias(blur), gShingle: N = (texture(shingle.map, at.mul(0.62)) as N).bias(blur), gLitter: N = (texture(litter.map, at.mul(1.7)) as N).bias(blur);
  const earthH = mix(gSoil.a, gShingle.a, stony);
  // Grass gives way to earth where its mat is thin and the earth stands high: not along a line.
  const bare: N = smoothstep(0.4, 0.6, bareV.mul(1.12).add(mid.sub(0.5).mul(0.55)).add(earthH.sub(gTurf.a).mul(0.35))).toVar();
  const leafy: N = smoothstep(0.4, 0.62, litV.add(macro.sub(0.5).mul(0.5)).add(gLitter.a.sub(gTurf.a).mul(0.3))).mul(one(bare)).toVar();
  // (Turf as it is, not as a lawn is painted: a little less green than the texture and the sheet would make it.)
  const raw: N = vertexColor().rgb.mul(gTurf.rgb).mul(mix(0.74, 1.3, macro));
  const base: N = mix(raw, vec3(dot(raw, vec3(0.3, 0.55, 0.15))), 0.22);
  const wide = turfAt(at0.div(23).add(0.71)).a;
  const lowSpotOf = (p: N): N => (texture(turf.map, p.div(6.1).add(0.19)) as N).a.add(mid.sub(0.5).mul(0.4));
  // Turf is not one green. It is yellower where it has dried, darker and bluer where clover and
  // moss have got into it, and thin enough in places for the earth to show.
  const patch = turfAt(at.div(3.7).add(0.83)).a;
  let turfed: N = mix(base, base.mul(vec3(1.5, 1.22, 0.7)), smoothstep(0.55, 0.8, mid).mul(0.34));
  turfed = mix(turfed, turfed.mul(vec3(0.62, 0.8, 0.86)), smoothstep(0.5, 0.72, patch).mul(0.5));
  turfed = mix(turfed, gSoil.rgb.mul(vec3(0.5, 0.46, 0.4)), sstep(0.4, 0.2, gTurf.a.add(patch.sub(0.5).mul(0.4))).mul(0.55)).toVar();
  // (Earth is darker where it is damp, which on a track is in broad patches, and darker in the hollows of the ground.)
  const damp = smoothstep(0.35, 0.7, wide.add(lowSpotOf(at0)).mul(0.6));
  const earthy = mix(gSoil.rgb.mul(vec3(0.6, 0.57, 0.52)), gShingle.rgb.mul(0.62), stony).mul(mix(0.84, 1.14, macro)).mul(mix(1, 0.68, damp));
  // Dead grass lying in the turf, in drifts some metres across: thickest where it is dry and trodden,
  // along the edges of the track and between its ruts, and least where the ground is wet.
  const gThatch: N = (texture(thatch.map, at.mul(1.15)) as N).bias(blur).toVar();
  const trodden = onTrack.mul(one(smoothstep(1.1, 2.4, off))).mul(0.35).add(onFoot.mul(one(smoothstep(0.4, 1.6, footOff))).mul(0.3));
  const dry: N = smoothstep(0.5, 0.72, wide.mul(0.7).add(mid.mul(0.45)).add(patch.sub(0.5).mul(0.35)).add(trodden).sub(wetV.mul(0.7)).sub(0.08).add(gThatch.a.sub(0.4).mul(0.3))).mul(one(leafy)).toVar();
  turfed = mix(turfed, gThatch.rgb.mul(vertexColor().rgb.mul(1.2).add(0.24)).mul(mix(0.8, 1.1, macro)), dry.mul(0.85));
  // And moss, low and dark, where it is damp or shaded.
  const gMoss: N = (texture(moss.map, at.mul(0.9)) as N).bias(blur);
  const mossy: N = smoothstep(0.55, 0.78, (texture(turf.map, at0.div(7.3).add(0.53)) as N).a.add(wetV.mul(0.45)).add(litV.mul(0.25)).sub(dry.mul(0.4))).mul(one(leafy)).toVar();
  turfed = mix(turfed, gMoss.rgb.mul(vec3(0.62, 0.72, 0.5)), mossy.mul(0.7));
  let ground: N = mix(turfed, gLitter.rgb.mul(mix(0.6, 0.85, mid)), leafy);
  // Along the edge of bare ground, a fringe of short green that is neither one nor the other.
  ground = mix(ground, turfed.mul(1.25), bare.mul(one(bare)).mul(1.4));
  ground = mix(ground, earthy, bare);
  // The floor of a rut is pressed hard and smooth, and darker; and in its low places water stands after rain.
  ground = mix(ground, ground.mul(vec3(0.58, 0.54, 0.5)), rutFloor.mul(bare));
  const lowSpot = lowSpotOf(at0);
  const puddle: N = smoothstep(0.55, 0.6, lowSpot).mul(rutFloor).mul(one(stony)).toVar();
  const wetRim: N = smoothstep(0.45, 0.56, lowSpot).mul(rutFloor).toVar();
  ground = mix(ground, ground.mul(0.6), wetRim.mul(0.6));
  ground = mix(ground, vec3(0.035, 0.032, 0.026), puddle.mul(0.85));
  m.colorNode = vec4(ground.mul(mix(1, 0.52, wetV)), 1);
  m.roughnessNode = mix(mix(float(0.96), 0.94, bare).mul(mix(1, 0.4, wetV.mul(bare))).mul(mix(1, 0.82, rutFloor.mul(bare))).mul(mix(1, 0.7, wetRim)), 0.04, puddle);
  {
    // Earth and shingle have their own relief; shingle borrows the earth's, laid coarser. Leaves lie flat.
    const gN: N = (texture(turf.normalMap, gUv) as N).bias(blur).xyz.mul(2).sub(1);
    const gE: N = (texture(soil.normalMap, at.mul(mix(1.5, 0.31, stony))) as N).bias(blur).xyz.mul(2).sub(1);
    const flat = one(leafy.mul(0.6));
    // (Dead grass has a relief of its own, of strands; standing water has none.)
    const gT: N = (texture(thatch.normalMap, at.mul(1.15)) as N).bias(blur).xyz.mul(2).sub(1);
    const turfN: N = mix(gN.mul(vec3(flat, flat, 1)), gT, dry.mul(0.8));
    const n: N = mix(turfN, gE, bare);
    const steep = mix(1, stony.mul(1.2).add(1.15), bare).mul(one(puddle));
    m.normalNode = normalMap(vec3(n.xy.mul(steep), n.z).mul(0.5).add(0.5));
  }
  // Ground is matt, except where it is wet stones, or water stands in a rut and mirrors the sky.
  lit(m, { irradiance: irradianceOf(normalWorldGeometry, bk), sun: one(underHill(bk)), sky: mix(0.3, smoothstep(0, 0.5, bk.x), uBake), gleam: max(mix(0.12, 0.7, wetV.mul(bare)), puddle.mul(1.6)) });
  return m;
}

/**
 * A material for small loose things: iron fittings, torch brands, keys. They are not part of the
 * light bake, and left to themselves they would be lit by the open sky wherever they are, indoors
 * included. Here they get a faint fixed ambient instead, and otherwise only the real lights.
 */
export function makePropMaterial(o: { color: Color; roughness: number; metalness: number; emissive?: Color; emissiveIntensity?: number }): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    color: o.color, roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? new Color(0, 0, 0), emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  lit(m, { irradiance: vec3(0.05, 0.045, 0.04), sky: float(0) });
  return m;
}

/**
 * Shared by all rock. `uShaftTop`, `uShaftUp` and `uShaftSun` are a shaft of sunlight let down into a
 * hall under the hill: a point on its middle line and how broad it is, the way up it, and the
 * sun's light. Rock that was told it stands in that light draws its edge itself, point by point
 * of the picture, so the round of light on the floor is round. `uRockFacet` is how far this stone
 * breaks in flat faces, 0 to 1: it is how much each face is lit as the flat plane it is. `uRockWorn`
 * is how far water has worked it, 0 to 1: the planes between its beds eaten back, runnels down its faces.
 */
export const rockUniforms: { uRockBroad: { value: number }; uRockFacet: { value: number }; uRockWorn: { value: number }; uShaftTop: { value: Vector4 }; uShaftUp: { value: Vector3 }; uShaftSun: { value: Vector3 } } = {
  uRockBroad: uniform(0.8) as N, uRockFacet: uniform(0) as N, uRockWorn: uniform(0) as N, uShaftTop: uniform(new Vector4()) as N, uShaftUp: uniform(new Vector3(0, 1, 0)) as N, uShaftSun: uniform(new Vector3()) as N,
};

/**
 * The material for natural rock. Carved rock has no texture coordinates worth the name, so the
 * texture is laid on from three sides by where each point is, and blended by which way it faces:
 * nothing stretches, on any slope or under any overhang. Over that:
 *  - the same texture read very large gives slow changes of tone, so no repeat can be seen;
 *  - on steep faces, thin beds of lighter and darker stone, and dark streaks where water runs down;
 *  - moss and damp from the per-vertex fields, as on masonry.
 * Light comes from the bake where there is one, and from the open sky where there is not.
 */
export function makeRockMaterial(base: TextureSet, moss: TextureSet, o: { scale?: number; normalScale?: number; dip?: [number, number] } = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, color: new Color(1, 1, 1) });
  const f = fieldOf(), bk = bakeOf();
  const P: N = positionWorld, rockN: N = normalize(normalWorldGeometry);
  const scale = o.scale ?? 0.3, bump = o.normalScale ?? 1.4, dip = o.dip ?? [0.05, 0.03];
  const uFacet = rockUniforms.uRockFacet as N, uWorn = rockUniforms.uRockWorn as N;
  const uBroad = rockUniforms.uRockBroad as N, uShaftTop = rockUniforms.uShaftTop as N, uShaftUp = rockUniforms.uShaftUp as N, uShaftSun = rockUniforms.uShaftSun as N;
  const w0: N = pow(abs(rockN), vec3(5));
  const w: N = w0.div(w0.x.add(w0.y).add(w0.z)).toVar();
  const ux = P.zy.mul(scale), uy = P.xz.mul(scale), uz = P.xy.mul(scale);
  // From far off the grain of the stone cannot be seen, and what would be seen instead is the
  // same square of it laid side by side to the horizon. So with distance it is read ever more
  // blurred, until a hillside a quarter of a mile away has the stone's colour and none of its pattern.
  const blur: N = smoothstep(110, 320, length(positionView)).mul(6);
  const read = (map: N, at: N, b: N = blur): N => (texture(map, at) as N).bias(b);
  const tex: N = read(base.map, ux).mul(w.x).add(read(base.map, uy).mul(w.y)).add(read(base.map, uz).mul(w.z)).toVar();
  // The same stone seen from far off: patches some metres across.
  const farTex: N = read(base.map, vec2(P.x.add(P.z.mul(0.71)), P.y.mul(0.9).add(P.z.mul(0.37))).mul(scale * 0.11), blur.mul(0.6)).toVar();
  // Stone that breaks in flat faces is lit face by face. The plane of each face is read from how the
  // surface slopes across the picture, turned to face outward, and mixed into the normal; where
  // it parts company with the smooth normal there is an edge, and an edge catches the light. Both
  // fade out with distance, where a pixel covers many faces and the plane it reads is only noise.
  const flat0: N = normalize(dFdx(P).cross(dFdy(P)));
  const flat: N = select(dot(flat0, rockN).lessThan(0), flat0.negate(), flat0);
  const near: N = one(smoothstep(45, 120, length(positionView)));
  const facetW: N = uFacet.mul(near);
  const edge: N = one(dot(flat, rockN)).mul(facetW);
  const steep = one(smoothstep(0.4, 0.75, abs(rockN.y)));
  let rock: N = tex.rgb.mul(mix(vec3(0.8, 0.79, 0.8), vec3(1.2, 1.17, 1.1), smoothstep(0.25, 0.75, farTex.a)));
  // Thin beds within the thick ones: bands a hand or two deep, gathered into broader ones, each
  // its own shade, with a dark line where one lies on the next. They fade out with distance,
  // before they could shimmer.
  // No two are alike. Their thickness is unequal (the count of them runs ahead of the height in
  // some stretches and falls behind in others, as in `Strata`); the plane between two is an open
  // dark line here, a hair there, and often nothing at all; and a line that is open does not run
  // on for ever, but closes and opens again along the face. Ruled lines are what gives a drawn cliff away.
  // (They roll, slowly: by the same stone read from far off, and read blurred, or its grain would make every line between beds a scribble.)
  const roll: N = (texture(base.map, vec2(P.x.add(P.z.mul(0.71)), P.y.mul(0.9).add(P.z.mul(0.37))).mul(scale * 0.11)) as N).bias(max(blur, 4.5)).toVar();
  // How high a point lies among the beds, in metres: they dip a little, and roll.
  const level: N = P.y.add(dot(P.xz, vec2(dip[0], dip[1]))).add(roll.r.sub(0.5).mul(1.5)).toVar();
  // (Water-worn stone is not bedded alike all over: stretches of it are massive, one pale face with hardly a line across it.)
  const bedded: N = f.w.mul(steep).mul(mix(1, smoothstep(0.3, 0.6, farTex.a), uWorn.mul(0.75))).toVar();
  const along: N = P.x.add(P.z.mul(0.6));
  /**
   * Beds of one thickness, in metres. Stone is bedded at every size: plates a hand thick lie in
   * beds of a stride, and those in great beds as tall as a house. Which of them the eye can see
   * depends on how far off it stands, so all three are drawn, each for as long as it is large
   * enough in the picture not to shimmer: close to, the plates; across a valley, the strides;
   * on a mountain a mile off, the great beds alone. One size of bed drawn at every distance is
   * right at one distance only: nearer it is too coarse, and farther it is a few stray lines.
   */
  const bedsOf = (thick: number, k: number) => {
    const u0: N = level.div(thick).add(k * 3.7).toVar();
    const u: N = u0.add(sin(u0.mul(1.9).add(roll.g.mul(5))).mul(0.3)).add(sin(u0.mul(0.83).add(1.3)).mul(0.26)).toVar();
    const large: N = one(smoothstep(0.2, 0.55, fwidth(u))).toVar();
    const within: N = fract(u).toVar();
    const tone = mix(0.72, 1.14, fract(sin(floor(u).mul(91.7)).mul(43758.5)));
    // The plane nearest this point, and three numbers of its own: how open it is, how wide, and where along the face it is shut.
    const plane: N = floor(u.add(0.5)).toVar();
    const planeOpen: N = fract(sin(plane.mul(57.3)).mul(24634.6)).toVar();
    const open: N = smoothstep(0.4, 0.8, planeOpen).mul(smoothstep(0.42, 0.6, farNoise(vec2(along.mul(0.09 / thick), plane.mul(7.13))))).toVar();
    const wide: N = fract(planeOpen.mul(7.31)).toVar();
    // (A great bed's plane is wider than a plate's, but not as many times wider as the bed is thicker.)
    const from: N = min(within, one(within)).div(mix(0.1, 0.3, wide).mul(Math.sqrt(0.3 / thick))).toVar();
    const line: N = mix(1, smoothstep(0, 1, from), open).toVar();
    // Where water has worked the stone the open planes are eaten back into grooves: darker, and with a lip above and below that the light catches.
    const dark = mix(0.62, mix(0.86, 0.5, wide), uWorn);
    // How steeply the surface runs into the groove, signed: up above the plane, down below it.
    const lip = from.mul(one(from)).mul(4).mul(step(from, 1)).mul(select(within.lessThan(0.5), 1, -1)).mul(open);
    return { large, tone, line, dark, lip };
  };
  const plates = bedsOf(0.3, 0), strides = bedsOf(1.4, 1), greats = bedsOf(6.5, 2);
  // Each size has its shades wherever it can be seen; its dark lines only once the size below it has grown too small to show its own,
  // or a face seen close would be ruled across with lines that nothing in its shape answers to.
  const seenP: N = bedded.mul(plates.large).toVar(), seenS: N = bedded.mul(strides.large).toVar(), seenG: N = bedded.mul(greats.large).toVar();
  const lineS: N = mix(1, strides.line, one(plates.large.mul(0.8))).toVar(), lineG: N = mix(1, greats.line, one(strides.large.mul(0.8))).toVar();
  rock = rock.mul(mix(1, plates.tone.mul(mix(plates.dark, 1, plates.line)), seenP))
    .mul(mix(1, mix(1, strides.tone, 0.6).mul(mix(strides.dark, 1, lineS)), seenS))
    .mul(mix(1, mix(1, greats.tone, 0.45).mul(mix(greats.dark, 1, lineG)), seenG));
  // (Every size of bed has its lip, each taking over from the one below as the lines do; and on stone that water has not worked, a fainter one.)
  const lip: N = plates.lip.mul(seenP).add(strides.lip.mul(seenS).mul(one(plates.large.mul(0.8)))).add(greats.lip.mul(seenG).mul(one(strides.large.mul(0.8))).mul(1.3)).mul(mix(0.35, 1, uWorn)).toVar();
  // The pits and cracks of the texture hold less of the sky's light; so do the planes between beds.
  const ao: N = mix(0.45, 1, smoothstep(0.08, 0.5, tex.a)).mul(mix(1, mix(mix(0.65, 0.5, uWorn), 1, plates.line), seenP)).mul(mix(1, mix(0.6, 1, lineS), seenS)).mul(mix(1, mix(0.6, 1, lineG), seenG)).toVar();
  // Where water runs down a face it leaves dark streaks, long and narrow.
  // (The streaks a walker sees are a stride or two apart, and the texture they are read from comes round again every three metres. On a
  // cliff that is no matter. On a mountain's face a furlong off it is a fence of upright bars, evenly spaced, and crossed with the beds
  // it is a chequerboard. So with distance the streaks are read eight times as broad: the great stains of a face, which do not repeat in sight.)
  const streakClose = (texture(base.map, vec2(P.z.mul(0.37), P.y.mul(0.03))) as N).a.mul(w.x).add((texture(base.map, vec2(P.x.mul(0.37), P.y.mul(0.03).add(0.5))) as N).a.mul(w.z));
  const streakFar = (texture(base.map, vec2(P.z.mul(0.043), P.y.mul(0.007).add(0.31))) as N).a.mul(w.x).add((texture(base.map, vec2(P.x.mul(0.043), P.y.mul(0.007).add(0.77))) as N).a.mul(w.z));
  const streak: N = mix(streakFar, streakClose, one(smoothstep(30, 100, length(positionView)))).toVar();
  const stain: N = smoothstep(0.5, 0.72, streak).mul(steep).mul(f.w.mul(0.65).add(0.35)).toVar();
  // (On pale water-worn stone the streaks are a grey film, not a dark one, and in places they run rust-coloured from iron in the rock.)
  const rust: N = smoothstep(0.62, 0.8, farTex.r.add(farTex.a).mul(0.5).add(streak.sub(0.5).mul(0.5))).mul(steep).mul(uWorn).toVar();
  rock = rock.mul(mix(vec3(1), mix(vec3(0.56, 0.53, 0.5), vec3(0.7, 0.7, 0.72), uWorn), stain.mul(mix(0.75, 0.6, uWorn))));
  rock = rock.mul(mix(vec3(1), vec3(1.1, 0.83, 0.6), rust.mul(0.45)));
  // Water-worn stone is also washed pale between the streaks, where the rain runs clean, and is
  // cut into runnels: narrow flutes straight down the face, a hand or two apart. They are drawn
  // as light and shade only, from the same texture read tall and narrow, and fade with distance.
  rock = rock.mul(mix(1, 1.2, smoothstep(0.5, 0.28, streak).mul(steep).mul(uWorn)));
  const fluteNear: N = one(smoothstep(25, 80, length(positionView))).mul(steep).mul(uWorn).toVar();
  const flute = (s: N, shift: number): N => (texture(base.map, vec2(s.mul(0.55), P.y.mul(0.045).add(shift))) as N).a;
  const fluteX: N = flute(P.z.add(0.05), 0).sub(flute(P.z.sub(0.05), 0)).mul(w.x).toVar(), fluteZ: N = flute(P.x.add(0.05), 0.5).sub(flute(P.x.sub(0.05), 0.5)).mul(w.z).toVar();
  const runnel = flute(P.z, 0).mul(w.x).add(flute(P.x, 0.5).mul(w.z));
  rock = rock.mul(mix(1, mix(0.86, 1.06, smoothstep(0.3, 0.7, runnel)), fluteNear.mul(w.x.add(w.z))));
  const wet: N = max(f.y, stain.mul(0.25)).toVar();
  // Moss: from above on what is level, from the side on what is not.
  const mossUv = select(w.x.greaterThan(w.z), ux, uz).mul(5.5);
  const mossTex: N = mix(texture(moss.map, mossUv), texture(moss.map, uy.mul(5.5)), w.y);
  const lightOk = mix(0.4, smoothstep(0.03, 0.3, bk.x).mul(one(smoothstep(0.2, 0.8, bk.y).mul(0.92))), uBake);
  const mossy: N = smoothstep(0, 0.22, f.x.mul(lightOk).mul(1.5).add(one(tex.a).mul(0.4)).add(mossTex.a.mul(0.45)).sub(1)).toVar();
  rock = rock.mul(edge.mul(0.7).add(1));
  m.colorNode = vec4(mix(vertexColor().rgb.mul(rock).mul(mix(1, 0.5, wet)), mossTex.rgb, mossy), 1);
  const rough: N = smoothstep(0.55, 0.9, tex.a).mul(-0.14).add(0.93).clamp(0.5, 1).mul(mix(1, 0.45, wet.mul(one(mossy))));
  m.roughnessNode = mix(rough, 0.97, mossy);
  // The normal map from three sides, each bent onto the surface and blended as the colour was.
  // It is read twice: as it is, for the grain and the small breaks, and four times larger, for
  // faces a stride or two across, which the carved surface is too coarse to hold an edge on.
  const lift = one(mossy.mul(0.6)).mul(bump);
  const closeTo: N = one(smoothstep(3, 13, length(positionView))).mul(0.8).toVar();
  const farOff: N = smoothstep(30, 130, length(positionView)).mul(1.5).toVar();
  const grain = (at: N, broad: N): N => {
    const t: N = read(base.normalMap, at).xyz.mul(2).sub(1);
    const wide: N = (texture(base.normalMap, at.mul(0.23).add(0.37)) as N).xy.mul(2).sub(1).mul(broad);
    // And once more, much smaller, for whoever stands within reach of it: the pits and the grain of a hand's breadth of stone.
    const fine: N = (texture(base.normalMap, at.mul(3.7).add(0.19)) as N).xy.mul(2).sub(1).mul(closeTo);
    // And from far off, very large: a face a furlong away is carved too coarsely to hold a buttress ten metres across or a ledge under
    // it, and without them it is a smooth ramp with stripes on. The same broken surface read sixty metres to the repeat gives them, as
    // light and shade; it comes in with distance, as the smaller relief goes out of sight.
    const vast: N = (texture(base.normalMap, at.mul(0.052).add(0.71)) as N).xy.mul(2).sub(1).mul(farOff);
    return vec3(t.xy.add(wide).add(fine).add(vast), t.z);
  };
  const tx = grain(ux, uBroad), ty = grain(uy, uBroad.mul(0.5)), tz = grain(uz, uBroad);
  const bx: N = vec3(tx.xy.mul(lift).add(rockN.zy), abs(tx.z).mul(rockN.x));
  const by: N = vec3(ty.xy.mul(lift).add(rockN.xz), abs(ty.z).mul(rockN.y));
  const bz: N = vec3(tz.xy.mul(lift).add(rockN.xy), abs(tz.z).mul(rockN.z));
  const bentSmooth: N = normalize(bx.zyx.mul(w.x).add(by.xzy.mul(w.y)).add(bz.xyz.mul(w.z)));
  // The grooves between beds and the runnels down the face bend the light as their slopes would.
  const up: N = vec3(0, 1, 0).sub(rockN.mul(rockN.y));
  const worn: N = up.mul(lip.mul(1.1)).add(vec3(fluteZ, 0, fluteX).mul(fluteNear).mul(1.6));
  const bent: N = normalize(mix(bentSmooth, flat, facetW.mul(0.2)).sub(worn)).toVar();
  m.normalNode = transformNormalToView(bent);
  // The sun down a shaft, on rock under the hill that was found to stand clear in it (which it
  // carries in the second of its two numbers, above the six tenths all such rock has).
  const inShaft = smoothstep(0.62, 0.95, bk.y).mul(step(bk.x, 0.004)).mul(step(0.001, uShaftTop.w));
  const fromAxis: N = P.sub(uShaftTop.xyz);
  const aside = length(fromAxis.sub(uShaftUp.mul(dot(fromAxis, uShaftUp))));
  const shaft = uShaftSun.mul(max(dot(bent, uShaftUp), 0)).mul(inShaft).mul(one(smoothstep(uShaftTop.w.sub(0.3), uShaftTop.w.add(0.05), aside)));
  // Rough rock gleams little, and less where it is dry.
  // (The sky's light is reckoned for the surface as its grain turns it, not for the smooth surface under the grain: most of a cliff is in
  // shade most of the day, and in shade the sky is all the light there is. Reckoned for the smooth surface, rock in shade is flat paint.)
  lit(m, { irradiance: irradianceOf(normalize(mix(rockN, bent, 0.85)), bk).add(shaft).mul(ao), sun: one(underHill(bk)), sky: mix(0.3, smoothstep(0, 0.5, bk.x), uBake).mul(ao), gleam: mix(0.3, 1, wet) });
  return m;
}

/** What far land is covered with in this season: its woods and its open ground. */
export const farUniforms: { uFarWood: { value: Vector3 }; uFarGrass: { value: Vector3 } } = {
  uFarWood: uniform(new Vector3(0.07, 0.15, 0.06)) as N, uFarGrass: uniform(new Vector3(0.16, 0.2, 0.08)) as N,
};

const farHash: N = Fn(([p]: [N]) => {
  const q: N = fract(vec3(p.xyx).mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});
const farNoise: N = Fn(([p]: [N]) => {
  const i: N = floor(p).toVar(), f0: N = fract(p);
  const f: N = f0.mul(f0).mul(f0.mul(-2).add(3)).toVar();
  return mix(mix(farHash(i), farHash(i.add(vec2(1, 0))), f.x), mix(farHash(i.add(vec2(0, 1))), farHash(i.add(vec2(1, 1))), f.x), f.y);
});
const farFbm: N = Fn(([p0]: [N]) => {
  const p: N = vec2(p0).toVar(), s: N = float(0).toVar(), a: N = float(0.5).toVar();
  Loop(4, () => {
    s.addAssign(a.mul(farNoise(p)));
    p.assign(p.mul(2.03).add(17.1));
    a.mulAssign(0.5);
  });
  return s;
});
// The crowns of a wood seen from above: how high the nearest crown stands at a point (0 between
// trees, 1 at a top), which way it slopes there, and a number of its own for each tree.
const farCrowns: N = Fn(([p]: [N]) => {
  const i: N = floor(p).toVar(), f: N = fract(p).toVar();
  const best: N = float(9).toVar(), id: N = float(0).toVar(), to: N = vec2(0).toVar();
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const g = vec2(x, y);
    const h: N = farHash(i.add(g)).toVar();
    const o: N = g.add(0.1).add(vec2(h, fract(h.mul(57.31))).mul(0.8)).sub(f).toVar();
    const d: N = dot(o, o).div(fract(h.mul(13.7)).mul(0.22).add(0.3)).toVar();
    If(d.lessThan(best), () => { best.assign(d); to.assign(o); id.assign(h); });
  }
  const h: N = max(0, one(best)).toVar();
  return vec4(h, to.mul(step(0.001, h)).mul(2.4), id);
});

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
export function makeFarMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, color: new Color(1, 1, 1) });
  const f = fieldOf();
  const uWood = farUniforms.uFarWood as N, uGrass = farUniforms.uFarGrass as N;
  const P: N = positionWorld, fp: N = P.xz, n0: N = normalize(normalWorldGeometry);
  const high = f.w, hollow = f.z;
  // How much of the picture one metre of ground takes up here: what is smaller than a point of it is left out.
  const grain: N = max(length(dFdx(fp)), length(dFdy(fp))).toVar();
  const broad: N = farFbm(fp.mul(0.03)).toVar(), fine: N = farNoise(fp.mul(0.21)).toVar();
  // Ribs and gullies, as light and shade. Water runs straight down a slope, so what it has cut
  // runs that way too: unevenness drawn out along the line of fall and left as it is across it.
  const down: N = n0.xz.div(max(length(n0.xz), 0.04)).toVar();
  let run: N = float(0);
  for (let k = -2; k <= 2; k++) run = run.add(farNoise(fp.add(down.mul(k * 10)).mul(0.075))).add(farNoise(fp.add(down.mul(k * 4)).mul(0.19).add(9)).mul(0.5));
  run = run.div(7.5).sub(0.5).toVar();
  const sloping: N = smoothstep(0.015, 0.16, one(n0.y)).mul(one(smoothstep(3, 9, grain))).toVar();
  const steep: N = one(smoothstep(0.52, 0.74, n0.y)).toVar();
  const ragged: N = broad.sub(0.5).add(fine.sub(0.5).mul(0.2)).add(run.mul(0.9).mul(sloping)).toVar();
  // Rock, in beds some metres thick, each its own shade; darker where it is steep and in hollows.
  const bedAt: N = P.y.add(broad.mul(34)).add(fp.x.mul(0.06)).div(7).toVar();
  const bed = mix(farHash(vec2(floor(bedAt), 3)), 0.5, smoothstep(0.25, 0.8, fwidth(bedAt)));
  let land: N = vertexColor().rgb.mul(bed.mul(0.5).add(0.62).add(broad.sub(0.5).mul(0.3))).mul(one(steep.mul(0.28))).mul(one(max(hollow, 0).mul(0.28)));
  // The gullies are the darker lines.
  const gullied = run.mul(1.5).mul(sloping).add(1);
  // Scree: pale and even, on slopes below the faces that are neither steep nor level.
  land = mix(land, vec3(0.33, 0.32, 0.31).mul(fine.mul(0.3).add(0.85)), smoothstep(0.3, 0.5, high.add(ragged.mul(0.2))).mul(one(steep)).mul(sstep(0.93, 0.83, n0.y)).mul(0.65));
  // Pasture above the trees, on what is not too steep.
  land = mix(land, uGrass.mul(broad.mul(0.45).add(0.8)), smoothstep(0, 0.07, float(0.62).sub(high).add(ragged.mul(0.3))).mul(one(steep)).mul(0.9));
  // Woods low down, reaching higher up the gullies than on the spurs between them.
  const wood: N = smoothstep(0, 0.05, float(0.37).sub(high).add(hollow.mul(0.13)).add(ragged.mul(0.42))).mul(one(steep.mul(0.85))).toVar();
  // Two kinds of tree, in stands: the smaller and darker are firs.
  const firs: N = smoothstep(0.42, 0.58, farNoise(fp.mul(0.011).add(5)).add(high.sub(0.2).mul(0.5))).toVar();
  const size = mix(3.7, 2.6, firs);
  const crown: N = farCrowns(fp.div(size)).toVar();
  const seen: N = one(smoothstep(0.25, 0.7, grain.div(size))).toVar();
  const green: N = uWood.mul(mix(vec3(1), vec3(0.62, 0.74, 0.82), firs)).mul(fine.mul(0.2).add(0.9));
  // Under the trees it is dark, whatever the ground is.
  land = mix(land, green.mul(0.45), wood.mul(0.9));
  // A wood thins out a tree at a time, not all together: each tree stands or does not.
  const standing: N = step(fract(crown.w.mul(91.3)), wood.mul(1.05)).mul(smoothstep(0, 0.3, crown.x)).toVar();
  const tone = crown.x.mul(0.36).add(0.74).mul(crown.w.mul(0.4).add(0.8));
  land = mix(land, green.mul(mix(0.84, tone, seen)), mix(wood, standing, seen).mul(step(0.0001, wood)));
  const farN: N = normalize(n0.sub(vec3(crown.y, 0, crown.z).mul(0.3).mul(seen).mul(standing).mul(step(0.0001, wood)))).toVar();
  // Snow on what is high, lying deeper in hollows and blown off what is steep.
  const snow: N = smoothstep(0, 0.08, high.sub(0.6).add(hollow.mul(0.12)).add(ragged.mul(0.35))).mul(smoothstep(0.5, 0.72, farN.y)).toVar();
  land = mix(land, vec3(1.3, 1.34, 1.42), snow);
  m.colorNode = vec4(land.mul(mix(gullied, 1, snow.mul(0.7))), 1);
  m.normalNode = transformNormalToView(farN);
  lit(m, { irradiance: mix(uFallback.mul(float(0.55).add(farN.y.mul(0.45))), bakedAt(farN), uBake), gleam: mix(0.08, 0.5, snow) });
  return m;
}
