import { ACESFilmicToneMapping, BufferAttribute, CubeCamera, DirectionalLight, HalfFloatType, InstancedMesh, LinearMipmapLinearFilter, Material, Mesh, PCFShadowMap, PerspectiveCamera, RenderTarget, Scene, SRGBColorSpace, Texture, Vector3 } from 'three';
import { CubeRenderTarget, MeshStandardNodeMaterial, PMREMGenerator, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { attribute, mix, positionLocal, rtt, step } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fbm2, Rng } from '../core/rng';
import { Hour, SKIES, Stone } from '../core/site';
import { COVER } from '../core/world';
import { MeshBuilder } from '../render/geom/meshBuilder';
import { stoneStyles } from '../render/geom/styles';
import { turfColour } from '../render/landscape';
import { Colour, growConifer, growTree, Planting } from '../render/planting';
import { Atmosphere } from '../render/post';
import { CardSet } from '../render/scene';
import { groundUniforms, makeGroundMaterial, makeRockMaterial, makeSiteMaterial, rockUniforms, siteUniforms } from '../render/siteMaterial';
import { GroundLook } from '../render/streamMesh';
import { doneGenerating, generateTextureSet } from '../render/textures';
import { makeCards, paintCards, TreeLevel, treeShare, vegetationRange, vegetationUniforms } from '../render/vegetation';
import { ROCK } from '../render/geom/rockForms';

/**
 * How the walk over a world looks: the game's own textures, materials, sky, air and planting, set
 * up as the game and the material lab set them up (`src/app/main.ts`, `lab/materials.ts`), for land
 * streamed in rather than a site built whole. What is drawn here is what a place will show when it
 * stands on this land: ground and rock by the game's materials, from what lies at each point; grass
 * and flowers about the walker; trees where the world has woods, whole near by and as single painted
 * cards beyond, as the valley's far hillsides are; the sky, the sun and its shadows, and the haze.
 */

export type Season = 'spring' | 'summer' | 'autumn';
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** The textures and materials, painted and made as `main.ts` makes them. */
export function makeMaterials(texSize: number): Record<string, Material> {
  const moss = generateTextureSet('moss', texSize / 2, 9), rock = generateTextureSet('rock', texSize, 13), ground = generateTextureSet('ground', texSize, 17);
  const scree = generateTextureSet('scree', texSize, 23), soil = generateTextureSet('soil', texSize, 31), litter = generateTextureSet('litter', texSize, 37), thatch = generateTextureSet('thatch', texSize, 47);
  const bark = generateTextureSet('bark', texSize, 29), barkAsh = generateTextureSet('barkAsh', texSize, 59), barkPine = generateTextureSet('barkPine', texSize, 61), barkFir = generateTextureSet('barkFir', texSize, 67);
  doneGenerating();
  const barks: Record<string, () => MeshStandardNodeMaterial> = {
    bark: () => makeSiteMaterial(bark, moss, { normalScale: 2.2, mossScale: 2.5, matt: true, deep: 0.06 }),
    barkAsh: () => makeSiteMaterial(barkAsh, moss, { normalScale: 1.6, mossScale: 2.5, matt: true, deep: 0.02, hollow: 0.5 }),
    barkPine: () => makeSiteMaterial(barkPine, moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.04, hollow: 0.35 }),
    barkFir: () => makeSiteMaterial(barkFir, moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.03, hollow: 0.6 }),
  };
  const out: Record<string, Material> = {
    turf: makeGroundMaterial(ground, soil, scree, litter, thatch, moss),
    // (Rock laid as a sheet, not carved: its buttresses, gullies and ledges drawn on it, as the valley's far crags are.)
    rock: makeRockMaterial(rock, moss, { relief: true }),
  };
  // A tree's wood is drawn at one level or the other, whole or simply, never both: it is all there at the level whose share of the tree
  // is half or more (`treeShare`), and drawn into a point at its foot at the other, so that each tree's wood changes once, at the distance
  // its leaves change at. (Its wood says which tree it is, as its cards do: `aTree`, the tree's foot and its own number.)
  for (const [name, make] of Object.entries(barks)) for (const level of ['whole', 'simple'] as const) {
    const m = make(), tree = attribute('aTree', 'vec4');
    m.positionNode = mix(tree.xyz, positionLocal, step(0.5, treeShare(level, tree)));
    out[`${name}:${level}`] = m;
  }
  return out;
}

/** A mesh of the game's kind made into something to draw: lit by the sky as the game lights what it does not bake, by each point's share of it. */
export function meshOf(builder: MeshBuilder, material: Material, hour: Hour): Mesh {
  const geometry = builder.build(), S = SKIES[hour], L = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
  const sh = [geometry.getAttribute('aSHr'), geometry.getAttribute('aSHg'), geometry.getAttribute('aSHb')] as BufferAttribute[], bk = geometry.getAttribute('aBake') as BufferAttribute;
  for (let i = 0; i < builder.vertexCount; i++) {
    const open = 0.3 + 0.7 * builder.openAt(i);
    for (let c = 0; c < 3; c++) sh[c].setXYZW(i, (Math.PI / 2) * L[c] * open, 0, (Math.PI / 2) * L[c] * 0.8 * open, 0);
    bk.setXY(i, open, 0.6);
  }
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true; mesh.castShadow = true; mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Cards of a planting made into meshes, each kind's painting made once; trees' cards at the level they are drawn at, if any. */
const PAINTED = new Map<string, Texture>();
export function cardsOf(sets: CardSet[], level?: TreeLevel): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  for (const set of sets) {
    let t = PAINTED.get(set.kind);
    if (!t) PAINTED.set(set.kind, (t = paintCards(set.kind)));
    out.push(...makeCards(set, t, level));
  }
  return out;
}

/**
 * How far a point lies inside the world's woods, in metres: more than nothing in a wood (how far in from its edge), less than nothing
 * outside one (how far out), from the world's cover on its lattice of 8 metres, worked out once for the whole world (two sweeps each
 * way, as the ink map reckons how far the sea lies from land). Read between the lattice's points. A wood is close in its heart and thins
 * towards its edge, and past its edge single trees stand out in the open, fewer the further out: as the game's own woods are (asked
 * for the walk page: "overall the forest building maybe improved there").
 */
export function woodDepth(cover: Uint8Array, nx: number, nz: number, x0: number, z0: number, cell: number): (x: number, z: number) => number {
  const sweep = (inside: boolean): Float32Array => {
    const d = new Float32Array(nx * nz), c = cell, c2 = cell * Math.SQRT2;
    for (let k = 0; k < d.length; k++) d[k] = (cover[k] === COVER.forest) === inside ? 1e9 : 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!d[k]) continue;
      let m = d[k];
      if (i > 0) m = Math.min(m, d[k - 1] + c);
      if (j > 0) { m = Math.min(m, d[k - nx] + c); if (i > 0) m = Math.min(m, d[k - nx - 1] + c2); if (i < nx - 1) m = Math.min(m, d[k - nx + 1] + c2); }
      d[k] = m;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!d[k]) continue;
      let m = d[k];
      if (i < nx - 1) m = Math.min(m, d[k + 1] + c);
      if (j < nz - 1) { m = Math.min(m, d[k + nx] + c); if (i < nx - 1) m = Math.min(m, d[k + nx + 1] + c2); if (i > 0) m = Math.min(m, d[k + nx - 1] + c2); }
      d[k] = m;
    }
    return d;
  };
  // (Inside: how far to the nearest point not wood; outside: how far to the nearest wood. Half a cell either way at the edge itself.)
  const inn = sweep(true), out = sweep(false), signed = new Float32Array(nx * nz);
  for (let k = 0; k < signed.length; k++) signed[k] = inn[k] ? inn[k] - cell / 2 : -(out[k] - cell / 2);
  return (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell)), fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell)), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * nx + i;
    return (signed[k] * (1 - tx) + signed[k + 1] * tx) * (1 - tz) + (signed[k + nx] * (1 - tx) + signed[k + nx + 1] * tx) * tz;
  };
}

/**
 * The sky, the sun with its shadows over the ground about the walker, and the air (the game's
 * `Atmosphere`: haze with distance and the light in it), drawn through the game's pipeline.
 */
export function makeLight(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, hour: Hour, haze: number) {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const S = SKIES[hour], d = S.sun, dl = Math.hypot(d[0], d[1], d[2]), sunDir = new Vector3(d[0] / dl, d[1] / dl, d[2] / dl);
  const sun = new DirectionalLight(0xffffff, S.intensity);
  sun.color.setRGB(S.colour[0], S.colour[1], S.colour[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);
  const makeSky = (disc: boolean) => {
    const sky = new SkyMesh();
    sky.scale.setScalar(20000);
    sky.turbidity.value = 3.2; sky.rayleigh.value = 1.4; sky.mieCoefficient.value = 0.004; sky.mieDirectionalG.value = 0.82;
    sky.cloudCoverage.value = 0.25; sky.cloudDensity.value = 0.5;
    sky.showSunDisc.value = disc ? 1 : 0;
    for (const k of [sky]) if (S.disc) k.sunPosition.value.set(S.disc[0], S.disc[1], S.disc[2]).normalize(); else k.sunPosition.value.copy(sunDir);
    return sky;
  };
  const sky = makeSky(true), envSky = makeSky(false), envScene = new Scene();
  scene.add(sky);
  envScene.add(envSky);
  const pmrem = new PMREMGenerator(renderer), env: RenderTarget = pmrem.fromScene(envScene, 0, 1, 20000);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.5;
  const skyPicture = new CubeRenderTarget(64, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  new CubeCamera(1, 20000, skyPicture).update(renderer, envScene);
  const pipeline = new RenderPipeline(renderer);
  const atmosphere = new Atmosphere(scene, camera, renderer, 1);
  const aired = rtt(atmosphere.node);
  pipeline.outputNode = aired.add(bloom(aired, 0.14, 0.5, 1.8));
  const mean = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
  siteUniforms.uBake.value = 1;
  siteUniforms.uFallback.value.set(mean[0] * 0.9, mean[1] * 0.82, mean[2] * 0.71);
  const sharp = ROCK.greystone.sharp;
  rockUniforms.uRockBroad.value = 0.35 + 1.1 * sharp;
  rockUniforms.uRockFacet.value = sharp ** 2;
  rockUniforms.uRockWorn.value = ROCK.greystone.worn;
  rockUniforms.uShaftTop.value.set(0, 0, 0, 0);
  vegetationRange.value = 80;
  groundUniforms.uGrassRange.value = vegetationRange.value;
  vegetationUniforms.uWind.value = 1;
  const u = atmosphere.uniforms, low = hour === 'sunset' || hour === 'dusk', night = S.night ?? 0;
  u.uSunColor.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 1.7);
  u.uSkyColor.value.set(mean[0], mean[1], mean[2]).multiplyScalar(1.75);
  u.tSky.value = skyPicture.texture;
  u.uAirOn.value = 1;
  // (Thinner than a valley's: here the eye sees ten kilometres, there one.)
  u.uHaze.value.set((0.00006 + 0.0003 * haze * haze) * (low ? 1.35 : 1), 320, 0);
  if (!S.disc || S.disc[1] > 0) u.uGlare.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 0.018 * (0.4 + haze)); else u.uGlare.value.set(0, 0, 0);
  u.uSkyZenith.value.set(S.zenith[0], S.zenith[1], S.zenith[2]);
  u.uSkyHorizon.value.set(S.horizon[0], S.horizon[1], S.horizon[2]);
  if (S.disc) { u.uGlowDir.value.set(S.disc[0], S.disc[1], S.disc[2]); u.uGlow.value.set(0.55, 0.22, 0.14).multiplyScalar(night > 0.9 ? 0.05 : 1); } else u.uGlow.value.set(0, 0, 0);
  u.uNight.value = night;
  u.uDensity.value = 0.0018;
  u.uIndoorDensity.value = 14;
  u.uEnabled.value = 1;
  let shadowAt = new Vector3(1e9, 0, 0), shadowsDue = 3;
  return {
    sunDir, sun, atmosphere, pipeline,
    /** Asks for the shadows to be drawn again, a few times, as what casts them comes in. */
    redraw() { shadowsDue = 3; },
    /** The sun's shadows over the ground about the walker: moved with them, and drawn again when they have gone far or something has come in. */
    follow(at: Vector3, ground: number) {
      if (at.distanceTo(shadowAt) > 30) { shadowAt = at.clone(); shadowsDue = 3; }
      if (shadowsDue <= 0) return;
      shadowsDue--;
      const r = 160, centre = new Vector3(shadowAt.x, ground, shadowAt.z);
      sun.position.copy(centre).addScaledVector(sunDir, 900);
      sun.target.position.copy(centre); sun.target.updateMatrixWorld();
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 2000 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.needsUpdate = true;
    },
    /** The air's maps of what stands under the sun and the sky, for the light in the haze: drawn once the land far off is in. */
    land(statics: Mesh[], min: Vector3, max: Vector3) { u.uAirCentre.value.copy(min).add(max).multiplyScalar(0.5); atmosphere.updateStatic(statics, sunDir, min, max); },
    eyes: S.eyes ?? 1.7,
  };
}

/** The leaves of the season: as the lab and the valley have them. */
function greensOf(season: Season): Colour[] {
  return season === 'autumn' ? [[0.5, 0.33, 0.035], [0.52, 0.2, 0.03], [0.34, 0.11, 0.03], [0.42, 0.36, 0.05], [0.2, 0.27, 0.05]]
    : season === 'summer' ? [[0.09, 0.21, 0.035], [0.12, 0.25, 0.04], [0.08, 0.19, 0.045], [0.15, 0.25, 0.05]]
      : [[0.13, 0.27, 0.035], [0.18, 0.31, 0.04], [0.1, 0.23, 0.04], [0.2, 0.3, 0.05]];
}

/**
 * How the ground looks at a point, from what the world says lies there (`COVER`): the turf's colour
 * and the four fields the game's ground material reads (a track, wet, bare, litter), and rock's colour.
 * Pasture is the valley's turf; fields of hay paler and yellower; heath brown, with the purple of
 * heather in it; marsh wet; the floor of a wood under litter; the shore bare sand and shingle.
 */
export function groundLook(coverAt: (x: number, z: number) => number, seed: number, stone: Stone = 'greystone'): GroundLook {
  const tint = stoneStyles(stone).tint, outcrop: Colour = [0.5 + 0.5 * tint[0], 0.52 + 0.5 * tint[1], 0.56 + 0.5 * tint[2]];
  return {
    turf: (x, z, y, slope) => {
      const cv = coverAt(x, z), c = turfColour(x, z, seed);
      let r = c[0], g = c[1], b = c[2], wet = 0, bare = 0, litter = 0;
      const mix = (t: number[], k: number) => { r += (t[0] - r) * k; g += (t[1] - g) * k; b += (t[2] - b) * k; };
      if (cv === COVER.fields) mix([1.25, 1.12, 0.62], 0.6 + 0.3 * fbm2(x * 0.02 + 3, z * 0.06, 2));
      else if (cv === COVER.moor) { mix([0.95, 0.7, 0.62], 0.65); bare = 0.15; }
      else if (cv === COVER.marsh) { mix([0.8, 0.95, 0.62], 0.5); wet = 0.7; }
      else if (cv === COVER.forest) { litter = 0.85; mix([0.75, 0.8, 0.55], 0.4); }
      else if (cv === COVER.rock || cv === COVER.snow) bare = 0.55;
      if (cv === COVER.shore || y < 1.6) { bare = 1; wet = Math.max(wet, 0.5 * (1 - smooth((y - 0.3) / 1.2))); }
      // (Bare earth and stones showing through where it grows steep, before it is rock.)
      bare = Math.max(bare, 0.65 * smooth((slope - 0.5) / 0.25));
      return [r, g, b, 0, wet, bare, litter];
    },
    rock: (x, z, y) => {
      const tone = (0.6 + 0.45 * fbm2((y + x * 0.2) * 0.09, z * 0.012 + 7, 3)) * 0.85;
      return [0.4 * tone * outcrop[0], 0.4 * tone * outcrop[1], 0.4 * tone * outcrop[2]];
    },
  };
}

/** A tree of the world: where it stands, what it is, how tall and stout, and a number of its own. */
export interface WorldTree { x: number; z: number; kind: 'oak' | 'ash' | 'spruce' | 'pine'; tall: number; girth: number; own: number }

/**
 * The trees in a square of ground (`size` metres from `x0`, `z0`): one to a cell of seven metres where the world has woods, and in
 * a wood's heart now and then a second, so that it closes over; fewer towards a wood's edge, which thins out tree by tree (`depthAt`,
 * how far inside a wood a point lies); past the edge single trees standing out in the pasture and on the heath, fewer the further out,
 * and a few anywhere in the open; none on rock, shingle or water. (A wood was laid one to a cell, as likely at its edge as in its
 * heart, and stopped at a line as if fenced, with the open country beyond nearly bare.) Broadleaves low down, spruce and pine higher,
 * pine alone near the treeline; the trees at a wood's edge, in the light, a little shorter and broader. The same trees whoever asks,
 * so that a tree drawn far off as a card and near by whole is the same tree.
 */
export function treesIn(x0: number, z0: number, size: number, coverAt: (x: number, z: number) => number, heightAt: (x: number, z: number) => number, seed: number, depthAt: (x: number, z: number) => number = () => 30): WorldTree[] {
  const CELL = 7, out: WorldTree[] = [];
  const hash = (i: number, j: number, k: number) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k + seed, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  for (let j = Math.floor(z0 / CELL); j < Math.ceil((z0 + size) / CELL); j++) for (let i = Math.floor(x0 / CELL); i < Math.ceil((x0 + size) / CELL); i++) {
    // (Two places in the cell: the second used only in a wood's heart.)
    for (let pair = 0; pair < 2; pair++) {
      const o = pair * 10, x = (i + 0.1 + 0.8 * hash(i, j, 1 + o)) * CELL, z = (j + 0.1 + 0.8 * hash(i, j, 2 + o)) * CELL;
      if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
      const cv = coverAt(x, z), y = heightAt(x, z), deep = depthAt(x, z);
      const dense = fbm2(x * 0.012 + seed * 0.01, z * 0.012, 3);
      const open = cv === COVER.pasture ? 1 : cv === COVER.moor ? 0.6 : cv === COVER.fields ? 0.2 : 0;
      const chance = cv === COVER.forest
        ? (pair ? 0.3 * smooth((deep - 18) / 25) * smooth((dense - 0.3) / 0.3) : (0.32 + 0.6 * smooth(deep / 26)) * (0.8 + 0.2 * smooth((dense - 0.3) / 0.3)))
        : pair ? 0 : open * (0.022 + 0.2 * (1 - smooth(-deep / 45)));
      if (y < 2 || hash(i, j, 3 + o) > chance) continue;
      const slope = Math.hypot(heightAt(x + 2, z) - heightAt(x - 2, z), heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
      if (slope > 0.75) continue;
      const r = hash(i, j, 4 + o), high = smooth((y - 90) / 120);
      const kind: WorldTree['kind'] = y > 260 || r < high * 0.45 ? 'pine' : r < high ? 'spruce' : hash(i, j, 5 + o) < 0.7 ? 'oak' : 'ash';
      const s = hash(i, j, 6 + o), stunt = (1 - 0.35 * smooth((y - 220) / 120)) * (0.85 + 0.15 * smooth(deep / 20));
      const tall = (kind === 'oak' ? 7 + 4 * s : kind === 'ash' ? 9 + 4 * s : kind === 'spruce' ? 9 + 5 * s : 10 + 5 * s) * stunt;
      out.push({ x, z, kind, tall, girth: kind === 'oak' ? 0.24 + 0.12 * s : kind === 'ash' ? 0.2 + 0.08 * s : 0.18 + 0.1 * s, own: hash(i, j, 7 + o) });
    }
  }
  return out;
}

/**
 * Trees grown whole, as a valley's are, for those near the walker: their wood in the game's meshes by
 * its bark, their leaves and needles as cards. (A little less finely than a valley's own: there are
 * hundreds of them about.) `light` for those further off, out to some three hundred metres: the same
 * trees grown more simply, a trunk and its main limbs with a few hundred larger sprays, between the
 * whole trees near by and the single painted cards beyond, which were too plain to come so near.
 */
export function growTrees(trees: WorldTree[], heightAt: (x: number, z: number) => number, season: Season, light = false, edge?: EdgeGround): { wood: Map<string, MeshBuilder>; sets: CardSet[]; owners: Map<string, Float32Array> } {
  const detail = light ? 0.25 : 0.75, cards = light ? 170 : 900, cardSize = light ? 1.9 : 0.8;
  const planting = new Planting(), wood = new Map<string, MeshBuilder>(), greens = greensOf(season);
  const mesh = (name: string) => { let m = wood.get(name); if (!m) wood.set(name, (m = new MeshBuilder())); return m; };
  const leafOf = (base: Colour) => (q: Rng): Colour => { const t = q.range(0.7, 1.25); return [base[0] * t, base[1] * t * q.range(0.92, 1.08), base[2] * t]; };
  // (Which tree each card and each point of wood belongs to: its foot and its own number, for the levels to give way tree by tree.)
  const tag = tagger(planting, wood);
  for (const t of trees) {
    const y = heightAt(t.x, t.z), rng = new Rng(`tree/${t.x.toFixed(1)},${t.z.toFixed(1)}`), green = greens[Math.floor(t.own * greens.length) % greens.length];
    tag.begin();
    if (t.kind === 'oak') growTree(planting, mesh('bark'), t.x, y, t.z, t.tall, t.girth, { kind: 'oak', detail, cards, cardSize, leaf: leafOf(green), bark: [0.66, 0.58, 0.5], shaded: true, soft: mesh('bark') }, rng);
    else if (t.kind === 'ash') growTree(planting, mesh('barkAsh'), t.x, y, t.z, t.tall, t.girth, { kind: 'ash', detail, cards, cardSize, leaf: leafOf(green), bark: [0.86, 0.84, 0.8], shaded: true, soft: mesh('barkAsh') }, rng);
    else if (t.kind === 'spruce') growConifer(planting, mesh('barkFir'), t.x, y, t.z, t.tall, 2.1 + 0.6 * t.own, t.girth, { kind: 'spruce', detail, needle: leafOf([0.045, 0.13, 0.04]), bark: [0.62, 0.5, 0.42], shaded: true, soft: mesh('barkFir') }, rng);
    else growConifer(planting, mesh('barkPine'), t.x, y, t.z, t.tall, 2.6 + 0.4 * t.own, t.girth, { kind: 'pine', detail, needle: leafOf([0.07, 0.15, 0.07]), bark: [0.98, 0.6, 0.42], shaded: true, soft: mesh('barkPine') }, rng);
    tag.end(t.x, y, t.z, t.own);
  }
  // Where wood meets open ground, near by: bramble, bushes and young trees, which is what a wood's edge mostly is, as the game's are.
  // (The trees stood straight up out of the grass, the wood ending at its last trunk.) Drawn with the whole trees and changing with them.
  if (edge) {
    const { x0, z0, size, coverAt, depthAt, seed } = edge, plant = new Rng(`edge/${seed}/${x0},${z0}`);
    const bramble: Colour = season === 'autumn' ? [0.2, 0.12, 0.05] : [0.07, 0.15, 0.04];
    for (let gz = z0; gz < z0 + size; gz += 2) for (let gx = x0; gx < x0 + size; gx += 2) {
      const x = gx + plant.range(0, 2), z = gz + plant.range(0, 2), d = depthAt(x, z), r = plant.next(), own = plant.next();
      // (A belt some sixteen metres broad, thickest a metre or two inside the wood.)
      const belt = 1 - smooth(Math.abs(d - 1.5) / 8);
      if (belt <= 0 || r > 0.15 * belt) continue;
      const cv = coverAt(x, z), y = heightAt(x, z);
      if ((cv !== COVER.forest && cv !== COVER.pasture && cv !== COVER.moor) || y < 2) continue;
      if (Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2 > 0.6) continue;
      const rng = new Rng(`edge/${x.toFixed(1)},${z.toFixed(1)}`), green = leafOf(greens[Math.floor(own * greens.length) % greens.length]);
      tag.begin();
      if (r < 0.06 * belt) {
        // Bramble: a low dark mound a stride or two across.
        const sz = plant.range(0.5, 1.1);
        planting.crown(x, y + sz * 0.28, z, sz, sz * 0.45, 26, sz * 0.75, leafOf(bramble), plant);
      } else if (r < 0.13 * belt) {
        // A bush: several stems from the ground, branching, with its leaves on its twigs.
        const sz = plant.range(0.7, 1.35);
        growTree(planting, mesh('bark'), x, y - 0.05, z, sz * 2.4, 0.03 + 0.02 * sz, { kind: 'oak', detail: 0.5, cards: 64, cardSize: 0.52, leaf: green, bark: [0.66, 0.58, 0.5], shaded: true }, rng);
      } else {
        // A young tree coming up among them.
        const h = plant.range(2.2, 3.6);
        growTree(planting, mesh('barkAsh'), x, y - 0.05, z, h * 1.15, 0.055, { kind: 'ash', detail: 0.45, cards: 70, cardSize: 0.55, leaf: green, bark: [0.86, 0.84, 0.8], shaded: true }, rng);
      }
      tag.end(x, y, z, own);
    }
  }
  return { wood, sets: planting.sets, owners: tag.owners() };
}

/** A stretch of ground whose wood's edge is grown about with bramble, bushes and young trees (`growTrees`). */
export interface EdgeGround { x0: number; z0: number; size: number; coverAt: (x: number, z: number) => number; depthAt: (x: number, z: number) => number; seed: number }

/**
 * Marks what is grown between `begin` and `end` as one tree's: every card added to the planting's sets (`trees`, four numbers to a card)
 * and every point added to the wood's meshes, whose numbers `owners` gives, a mesh's four to a point, once all is grown.
 */
function tagger(planting: Planting, wood: Map<string, MeshBuilder>) {
  const sets = (): CardSet[] => [planting.leaves, planting.needles, planting.pines, planting.firs, planting.farTrees];
  const runs = new Map<string, number[]>();
  let cardsBefore: number[] = [], woodBefore = new Map<string, number>();
  return {
    begin() { cardsBefore = sets().map((s) => s.matrices.length / 16); woodBefore = new Map([...wood].map(([k, b]) => [k, b.vertexCount])); },
    end(x: number, y: number, z: number, own: number) {
      sets().forEach((s, k) => { const list = (s.trees ??= []); for (let c = cardsBefore[k]; c < s.matrices.length / 16; c++) list.push(x, y, z, own); });
      for (const [k, b] of wood) { let r = runs.get(k); if (!r) runs.set(k, (r = [])); r.push(woodBefore.get(k) ?? 0, b.vertexCount, x, y, z, own); }
    },
    owners(): Map<string, Float32Array> {
      const out = new Map<string, Float32Array>();
      for (const [k, b] of wood) {
        const a = new Float32Array(b.vertexCount * 4), r = runs.get(k) ?? [];
        for (let q = 0; q < r.length; q += 6) for (let v = r[q]; v < r[q + 1]; v++) a.set([r[q + 2], r[q + 3], r[q + 4], r[q + 5]], v * 4);
        out.set(k, a);
      }
      return out;
    },
  };
}

/** Trees far off, each one card with a whole tree painted on it, as the valley's far hillsides have them; each card saying which tree it is. */
export function farTrees(trees: WorldTree[], heightAt: (x: number, z: number) => number, season: Season): CardSet[] {
  const planting = new Planting(), greens = greensOf(season), firs: Colour[] = [[0.05, 0.12, 0.05], [0.06, 0.14, 0.06], [0.07, 0.15, 0.07]];
  const tag = tagger(planting, new Map());
  for (const t of trees) {
    const fir = t.kind === 'spruce' || t.kind === 'pine', c = fir ? firs[Math.floor(t.own * 2.999)] : greens[Math.floor(t.own * (greens.length - 0.001))], k = (fir ? 0.75 : 0.5) + 0.3 * ((t.own * 7.3) % 1), y = heightAt(t.x, t.z);
    tag.begin();
    planting.farTree(fir, t.x, y - 0.5, t.z, t.tall * (fir ? 0.42 : 0.95), t.tall, t.own * 6.283, [c[0] * k, c[1] * k, c[2] * k]);
    tag.end(t.x, y, t.z, t.own);
  }
  return planting.sets;
}

/**
 * What grows low in a square of ground about the walker: grass, thick in pasture, tall and pale in the
 * hay fields, short and brown on the heath, sparse in the woods and none on rock, shingle or water;
 * flowers in drifts in the open; ferns under the trees; reeds in the marsh. As the lab's meadow is grown.
 */
export function growLow(x0: number, z0: number, size: number, heightAt: (x: number, z: number) => number, coverAt: (x: number, z: number) => number, seed: number, season: Season): CardSet[] {
  const planting = new Planting(), plant = new Rng(`low/${seed}/${x0},${z0}`), STEP = 0.5;
  const parched = season === 'autumn' ? 0.55 : season === 'summer' ? 0.25 : 0;
  const fern: Colour = season === 'autumn' ? [0.34, 0.22, 0.05] : [0.1, 0.27, 0.05];
  const bracken: Colour = season === 'autumn' ? [0.46, 0.24, 0.08] : season === 'summer' ? [0.16, 0.27, 0.06] : [0.2, 0.32, 0.07];
  // (A number between 0 and 1 of a point's own, for choices that must not take from `plant`, which would reshuffle all that follows.)
  const own01 = (x: number, z: number, salt: number) => { const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453; return v - Math.floor(v); };
  // Flowers by kind, each in drifts of its own that overlap, as the game's meadows have them: buttercups nearly everywhere, white ox-eye
  // in broad drifts, pink-purple knapweed and campion, blue harebells fewer, red here and there. Where two would grow, the one whose
  // drift is thicker there. (They were one of four colours over fifty metres at a time.)
  const FLOWERS: { hue: Colour; size: number; at: number; bar: number }[] = [
    { hue: [1.5, 1.1, 0.2], size: 0.8, at: 0.11, bar: 0.52 }, { hue: [1.3, 1.3, 1.2], size: 1.2, at: 0.06, bar: 0.6 },
    { hue: [1.4, 0.4, 0.8], size: 1.0, at: 0.09, bar: 0.65 }, { hue: [0.25, 0.5, 1.5], size: 0.85, at: 0.13, bar: 0.69 },
    { hue: [1.5, 0.3, 0.12], size: 0.9, at: 0.1, bar: 0.75 },
  ];
  for (let gz = z0; gz < z0 + size; gz += STEP) for (let gx = x0; gx < x0 + size; gx += STEP) {
    const x = gx + plant.range(0, STEP), z = gz + plant.range(0, STEP), cv = coverAt(x, z), y = heightAt(x, z);
    if (y < 1.2 || cv === COVER.sea || cv === COVER.lake || cv === COVER.shore || cv === COVER.rock || cv === COVER.snow) continue;
    const slope = Math.hypot(heightAt(x + 0.7, z) - heightAt(x - 0.7, z), heightAt(x, z + 0.7) - heightAt(x, z - 0.7)) / 1.4;
    if (slope > 0.7 || (slope > 0.45 && !plant.chance((0.7 - slope) / 0.25))) continue;
    const wood = cv === COVER.forest, heath = cv === COVER.moor, hay = cv === COVER.fields, marsh = cv === COVER.marsh;
    if (wood && !plant.chance(0.25)) {
      if (plant.chance(0.06)) { const s = plant.range(0.8, 1.4), k = plant.range(0.75, 1.2); planting.tuft(planting.ferns, x, y - 0.04, z, s, s * plant.range(0.55, 0.8), plant.range(0, Math.PI), [fern[0] * k, fern[1] * k, fern[2] * k]); }
      continue;
    }
    if (heath && !plant.chance(0.7)) continue;
    const c = turfColour(x, z, seed), t = plant.range(0.75, 1.2), moist = 0.35 + 0.3 * (fbm2(x * 0.08 + 5, z * 0.08, 2) - 0.3) + (marsh ? 0.4 : 0);
    // Bracken on the dry banks of the pasture and the heath, in stands: broad fronds to the knee and higher, green, russet in autumn.
    // (Bracken is what takes a dry hillside nobody grazes hard; the slopes were turf like the level.)
    if ((cv === COVER.pasture || heath) && slope > 0.12 && moist < 0.45 && fbm2(x * 0.055 + 3, z * 0.055 - 7, 2) > 0.56 && own01(x, z, 1) < 0.4) {
      const s = 1 + 0.6 * own01(x, z, 2), k = 0.8 + 0.35 * own01(x, z, 3);
      planting.tuft(planting.ferns, x, y - 0.04, z, s, s * (0.6 + 0.25 * own01(x, z, 4)), own01(x, z, 5) * Math.PI, [bracken[0] * k, bracken[1] * k, bracken[2] * k]);
      continue;
    }
    const tall = (0.45 + 1.1 * moist) * (0.8 + 0.5 * fbm2(x * 0.3 + 3, z * 0.3 + 1, 2)) * (hay ? 1.7 : heath ? 0.55 : 1);
    const dry = Math.min(1, parched + (hay ? 0.75 : 0) + Math.max(0, (0.42 - moist) * 2.2) + (plant.chance(0.08) ? 0.8 : 0));
    let colour: Colour = [(0.17 + 0.2 * dry) * c[0] * t, (0.29 + 0.03 * dry) * c[1] * t, (0.05 + 0.05 * dry) * c[2] * t];
    // (Heather: brown, purple where it is in flower.)
    if (heath) colour = plant.chance(season === 'summer' ? 0.35 : 0.1) ? [0.32 * t, 0.12 * t, 0.26 * t] : [0.2 * t, 0.15 * t, 0.07 * t];
    const w = plant.range(0.4, 0.7) * (0.75 + 0.35 * tall), h = plant.range(0.2, 0.34) * (0.35 + 1.25 * tall);
    planting.tuft(planting.grass, x, y - 0.05, z, w, h, plant.range(0, Math.PI), colour);
    // Grass in seed where it stands long: heads over the sward, the colour of ripe seed (less of it in spring).
    if (!heath && tall > 0.8 && own01(x, z, 6) < (season === 'spring' ? 0.06 : 0.18)) {
      const ripe = 0.75 + 0.35 * own01(x, z, 7);
      planting.tuft(planting.grass, x + 0.07, y - 0.05, z - 0.05, w * 0.6, h * 1.45, own01(x, z, 8) * 40, [0.36 * ripe, 0.34 * ripe, 0.16 * ripe]);
    }
    if (!wood && !hay && !heath && plant.chance(0.06)) {
      let best = -1, kind = -1;
      for (let i = 0; i < FLOWERS.length; i++) {
        const f = FLOWERS[i], d = fbm2(x * f.at + 3 * (i + 3), z * f.at - 2 * (i + 1) + 7.3 * i, 2) - f.bar + own01(x, z, 10 + i) * 0.05;
        if (d > best) { best = d; kind = i; }
      }
      if (best >= 0) {
        const f = FLOWERS[kind], k = 0.85 + 0.25 * own01(x, z, 9), sz = plant.range(0.3, 0.45) * f.size;
        planting.tuft(planting.flowers, x, y - 0.02, z, sz, sz * plant.range(0.9, 1.3), plant.range(0, Math.PI), [f.hue[0] * k, f.hue[1] * k, f.hue[2] * k]);
      }
    }
    if (marsh && plant.chance(0.15)) planting.tuft(planting.reeds, x, y - 0.05, z, plant.range(0.5, 0.8), plant.range(1.1, 1.9), plant.range(0, Math.PI), [0.2 * plant.range(0.8, 1.2), 0.3, 0.08]);
  }
  return planting.sets;
}
