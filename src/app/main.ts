import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, InterleavedBufferAttribute, BufferGeometry, Color, CubeCamera, FrontSide, HalfFloatType, LinearMipmapLinearFilter, InstancedMesh, PointLight, DirectionalLight, DoubleSide, Mesh, MeshBasicMaterial,
  SphereGeometry,
  Material, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Ray, Scene, SRGBColorSpace,
  Vector2, Vector3,
} from 'three';
import { CubeRenderTarget, PMREMGenerator, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { rtt } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { bake, BakeLights, BakeResult } from '../render/bake/bake';
import { Atmosphere } from '../render/post';
import { edgeAt, insideOf, joinLine } from '../core/valley';
import { buildingPlans } from '../maps/buildingPlan';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { farUniforms, makeFarMaterial, makeGroundMaterial, makePropMaterial, makeRockMaterial, makeSiteMaterial, rockUniforms, siteUniforms } from '../render/siteMaterial';
import { ROCK } from '../render/geom/rockForms';
import { doneGenerating, generateTextureSet } from '../render/textures';
import { exportInk, exportJson, exportModel, exportPlan, inkCanvas, modelGlb, planCanvas, siteJson } from '../export/exporter';
import { generateSite } from '../core/generate';
import { Hour, SKIES, stairEnds, WHEN } from '../core/site';
import { cloudNoise } from '../render/clouds';
import { solve } from '../core/mission';
import { SceneDescription } from '../render/scene';
import { renderMap } from '../maps/rendered';
import { cullCards, makeCards, paintCards, vegetationRange, vegetationUniforms } from '../render/vegetation';
import { Water } from '../render/water';
import { Sea } from '../render/sea';
import { Birds } from '../render/birds';
import { Beacon } from '../render/beacon';
import { inland } from '../core/island';
import { Sound, Surface } from './sound';
import { Rng } from '../core/rng';
import { drawPlan, placeAt } from '../maps/plan';
import { meshSite } from '../render/siteMesher';
import { Torch, TorchLights } from '../render/torch';
import { buildCourtyardHall } from '../scenes/courtyardHall';
import { Game } from './game';
import { Player } from './player';
import { TouchControls } from './touch';

// The address's settings: after its `?`, and after a `#` as well. A page shown inside another (an
// embedded preview) may not be handed its own `?`; what follows a `#` it always keeps.
const params = new URLSearchParams(location.search);
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params.set(k, v);
const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
/** Goes to the place the given settings describe, by the `#` where the page is framed and by the `?` where it is not. */
function go(next: URLSearchParams): void {
  if (framed) { location.hash = next.toString(); location.reload(); } else go(next);
}
/** Writes the settings into the address without going anywhere, so that a link or a reload brings them back. */
function keep(next: URLSearchParams): void {
  try { history.replaceState(null, '', framed ? `${location.pathname}${location.search}#${next}` : `${location.pathname}?${next}`); } catch { /* (a framed page may not be let change its address) */ }
}
const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);

/**
 * How much detail to draw. Chosen on the opening card and remembered; a parameter in the address
 * overrides any one setting. Touch devices start a step lower, since their screens are dense and
 * their graphics modest.
 */
const QUALITY = {
  low: { dpr: 1, tex: 512, rays: 12, grass: 40, bloom: 0, leaves: 0.5, clouds: 0, mirror: 0 },
  medium: { dpr: 1.25, tex: 1024, rays: 16, grass: 55, bloom: 1, leaves: 0.75, clouds: 16, mirror: 512 },
  high: { dpr: 1.5, tex: 1024, rays: 32, grass: 80, bloom: 1, leaves: 1, clouds: 28, mirror: 1024 },
};
const coarse = window.matchMedia('(pointer: coarse)').matches;
const remembered = (() => { try { return localStorage.getItem('dungeons.quality'); } catch { return null; } })();
const wanted = params.get('quality') ?? remembered ?? (coarse ? 'medium' : 'high');
const qualityName = (wanted in QUALITY ? wanted : 'high') as keyof typeof QUALITY;
const quality = QUALITY[qualityName];

/** A fresh, readable seed such as "amber-vault-41". */
function randomSeed(): string {
  const a = ['amber', 'ashen', 'bright', 'cold', 'deep', 'elder', 'fallow', 'gilded', 'hollow', 'iron', 'last', 'mossy', 'north', 'old', 'pale', 'quiet', 'red', 'salt', 'tall', 'west'];
  const b = ['abbey', 'cloister', 'court', 'crypt', 'gate', 'hall', 'hold', 'keep', 'priory', 'vault', 'ward', 'well'];
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(a)}-${pick(b)}-${Math.floor(Math.random() * 90 + 10)}`;
}

// Every place has a seed in its address, so a link reproduces it.
if (!params.has('seed')) {
  params.set('seed', randomSeed());
  keep(params);
}
const seed = params.get('seed')!;
// What kind of place: a valley, unless an island is asked for.
// (A build may be made to open on an island when nothing is asked for: `VITE_PLACE=island npm run build`.)
const place = (params.get('place') ?? import.meta.env.VITE_PLACE) === 'island' ? 'island' : 'valley';

const hud = {
  status: document.getElementById('status')!,
  bar: document.getElementById('bar')!,
  stats: document.getElementById('stats')!,
  title: document.getElementById('title')!,
  seed: document.getElementById('seed')!,
};
const newPlace = () => {
  const next = new URLSearchParams(params);
  next.set('seed', randomSeed());
  go(next);
};
document.getElementById('new')!.addEventListener('click', newPlace);
document.getElementById('again')!.addEventListener('click', newPlace);
// The other kind of place: an island, from a valley, or a valley from an island; a new one, since the same seed is the same house.
{
  const button = document.getElementById('kind')!;
  button.textContent = place === 'island' ? 'A valley' : 'An island';
  button.addEventListener('click', () => {
    const next = new URLSearchParams(params);
    next.set('seed', randomSeed());
    next.set('place', place === 'island' ? 'valley' : 'island');
    next.delete('at');
    go(next);
  });
}

let toastTimer = 0;
function toast(message: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4200);
}

// Mean diffuse reflectance of each texture recipe, used by the bake together with vertex tint.
const MEAN_ALBEDO: Record<string, number> = { stone: 0.6, floor: 0.6, slate: 0.6, wood: 0.25, rock: 0.6, scree: 0.45, bark: 0.3, turf: 0.12, leaf: 0.1 };

// Sun and sky, in the renderer's light units. The same numbers drive the real-time sun, the bake and the fog.
let SUN_COLOR = new Color(1.0, 0.84, 0.64);
let SUN_INTENSITY = 11;
let SKY = { zenith: [0.16, 0.3, 0.62], horizon: [0.62, 0.7, 0.8], ground: [0.09, 0.08, 0.07] };
const TORCH_INTENSITY = 3.2;

async function start(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  // Drawn with WebGPU where the browser has it, and with WebGL 2 where it has not (or when `?webgl` asks for it): the same programs serve both.
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: params.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, num('dpr', quality.dpr)));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  // It sees as far as the furthest range of hills.
  const camera = new PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 3600);
  camera.layers.enable(1);

  // ------------------------------------------------------------------ materials
  hud.status.textContent = 'Generating materials';
  const texSize = num('tex', quality.tex);
  const stone = generateTextureSet('stone', texSize, 3);
  const wood = generateTextureSet('wood', texSize, 5);
  const moss = generateTextureSet('moss', texSize / 2, 9);
  const rock = generateTextureSet('rock', texSize, 13);
  const ground = generateTextureSet('ground', texSize, 17);
  const scree = generateTextureSet('scree', texSize, 23);
  const bark = generateTextureSet('bark', texSize, 29);
  const soil = generateTextureSet('soil', texSize, 31);
  const litter = generateTextureSet('litter', texSize, 37);
  const plaster = generateTextureSet('plaster', texSize, 41);
  const thatch = generateTextureSet('thatch', texSize, 47);
  const tile = generateTextureSet('tile', texSize, 43);
  // On an island the bare ground is sand, where in a valley it is beaten earth.
  const sand = place === 'island' ? generateTextureSet('sand', texSize, 53) : null;
  doneGenerating();
  const materials: Record<string, Material> = {
    stone: makeSiteMaterial(stone, moss, { normalScale: 1.0 }),
    floor: makeSiteMaterial(stone, moss, { normalScale: 1.2 }),
    slate: makeSiteMaterial(stone, moss, { normalScale: 0.7, roughness: 0.8 }),
    wood: makeSiteMaterial(wood, moss, { normalScale: 1.0 }),
    rock: makeRockMaterial(rock, moss),
    far: makeFarMaterial(),
    scree: makeSiteMaterial(scree, moss, { normalScale: 1.6, matt: true }),
    // (Bark is matt. With the sheen every smooth thing has at a glancing angle, a round trunk mirrored the sky down both its sides and stood pale blue.)
    bark: makeSiteMaterial(bark, moss, { normalScale: 1.8, mossScale: 2.5, matt: true }),
    // Grass and leaves use the moss recipe as their own surface, tinted per vertex.
    turf: makeGroundMaterial(ground, sand ?? soil, scree, litter, thatch, moss),
    leaf: makeSiteMaterial(moss, moss, { normalScale: 2.4 }),
    // What buildings are made of besides stone and timber: plaster, with a wash of colour on it; clay tiles; sheet metal, for low roofs;
    // and glass, which is the same smooth surface made dark and bright, so that it mirrors the sky.
    plaster: makeSiteMaterial(plaster, moss, { normalScale: 0.8 }),
    tile: makeSiteMaterial(tile, moss, { normalScale: 1.3, mossScale: 3 }),
    metal: makeSiteMaterial(plaster, moss, { normalScale: 0.25, roughness: 0.5 }),
    glass: makeSiteMaterial(plaster, moss, { normalScale: 0.12, roughness: 0.1 }),
    // Thatch on the fishermen's cottages; and the lamp of the lighthouse, which shines by night.
    thatch: makeSiteMaterial(thatch, moss, { normalScale: 1.6, mossScale: 2 }),
    lamp: makePropMaterial({ color: new Color(0.95, 0.9, 0.75), roughness: 0.15, metalness: 0, emissive: new Color(1, 0.82, 0.5), emissiveIntensity: 0.4 }),
  };

  // ------------------------------------------------------------------ geometry
  hud.status.textContent = 'Laying stone';
  await nextFrame();
  const t0 = performance.now();
  // The hand-built look test scene is still available as ?scene=test.
  const site = params.get('scene') === 'test' ? null : generateSite(seed, place);
  // The hour and the cloud can be asked for in the address, whatever the seed gave.
  if (site) {
    const hour = params.get('hour') as Hour | null;
    if (hour && hour in SKIES && hour !== site.setting.hour) {
      site.title = site.title.replace(WHEN[site.setting.hour], WHEN[hour]);
      site.setting.hour = hour;
      const d = SKIES[hour].sun, l = Math.hypot(d[0], d[1], d[2]);
      site.sun = [d[0] / l, d[1] / l, d[2] / l];
    }
    if (params.has('cloud')) site.setting.cloud = Math.min(1, Math.max(0, Number(params.get('cloud'))));
    // So can the air: how much mist and haze, and whether the cloud lies in banks.
    if (params.has('mist')) site.setting.mist = Math.min(1, Math.max(0, Number(params.get('mist'))));
    if (params.has('haze')) site.setting.haze = Math.min(1, Math.max(0, Number(params.get('haze'))));
    if (params.has('layered')) site.setting.cloudForm = params.get('layered') === '0' ? 'heaped' : 'layered';
  }
  const desc: SceneDescription = site ? meshSite(site) : buildCourtyardHall(seed);
  if (desc.far) { farUniforms.uFarWood.value.set(...desc.far.wood); farUniforms.uFarGrass.value.set(...desc.far.grass); }
  hud.title.textContent = desc.title ?? 'Courtyard and hall, assembled by hand.';
  // Stone that breaks sharp shows broad flat faces; stone that weathers round hardly any.
  if (site) rockUniforms.uRockBroad.value = 0.35 + 1.1 * ROCK[site.setting.stone].sharp;
  if (site) rockUniforms.uRockFacet.value = ROCK[site.setting.stone].sharp ** 2;
  if (site) rockUniforms.uRockWorn.value = ROCK[site.setting.stone].worn;
  // Sound starts with the first click or key, which is the earliest a browser allows.
  const sound = new Sound();
  const muteButton = document.getElementById('mute') as HTMLButtonElement;
  const showMute = () => (muteButton.textContent = sound.muted ? 'Sound off' : 'Sound on');
  showMute();
  muteButton.addEventListener('click', () => { sound.start(); sound.toggleMute(); showMute(); });
  window.addEventListener('pointerdown', () => sound.start(), { once: true });
  window.addEventListener('keydown', (e) => {
    sound.start();
    if (e.code === 'KeyN') { sound.toggleMute(); showMute(); }
  });
  // The opening card: what this place is, how to move, and how much detail to draw.
  const intro = document.getElementById('intro')!;
  if (site && !params.has('nointro')) {
    document.getElementById('introName')!.textContent = `The ${site.setting.kind}`;
    document.getElementById('introText')!.textContent = site.title;
    const select = document.getElementById('quality') as HTMLSelectElement;
    select.value = qualityName;
    select.addEventListener('change', () => {
      try { localStorage.setItem('dungeons.quality', select.value); } catch { /* private browsing: the choice lasts for this visit only */ }
      const next = new URLSearchParams(params);
      next.delete('quality');
      next.delete('dpr'); next.delete('tex'); next.delete('rays'); next.delete('grass'); next.delete('bloom'); next.delete('leaves'); next.delete('clouds'); next.delete('mirror');
      go(next);
    });
    document.getElementById('begin')!.addEventListener('click', () => {
      intro.hidden = true;
      document.body.classList.remove('intro');
      sound.start();
      if (!coarse) canvas.requestPointerLock?.();
    });
    intro.hidden = false;
    document.body.classList.add('intro');
  }
  if (desc.sun) {
    SUN_COLOR = new Color(desc.sun.colour[0], desc.sun.colour[1], desc.sun.colour[2]);
    SUN_INTENSITY = desc.sun.intensity;
    SKY = desc.sun.sky;
  }
  const map = document.getElementById('map') as HTMLCanvasElement;
  map.hidden = !site;
  map.addEventListener('click', () => map.classList.toggle('big'));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') map.classList.toggle('big');
  });
  hud.seed.textContent = seed;
  const statics: Mesh[] = [];
  const parts: { mesh: Mesh; offset: number; count: number; albedo: number; plan: { source: Int32Array; scale: Float32Array } }[] = [];
  let vertexTotal = 0, triTotal = 0;
  for (const [name, builder] of desc.meshes) {
    const geometry = builder.build();
    const material = name.split('|')[1];
    const mesh = new Mesh(geometry, materials[material] ?? materials.stone);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    statics.push(mesh);
    parts.push({ mesh, offset: vertexTotal, count: builder.vertexCount, albedo: MEAN_ALBEDO[material] ?? 0.5, plan: builder.bakePlan() });
    vertexTotal += builder.vertexCount;
    triTotal += builder.triangleCount;
  }
  // What lies beyond the site is drawn but not baked or collided with. Its share of sky is the
  // whole sky, written into the same attributes the bake fills for everything else.
  const scenic: Mesh[] = [];
  const solidScenery: Mesh[] = [];
  for (const [key, builder] of desc.scenery?.meshes ?? []) {
    // Keyed as the site's own meshes are, by group and material.
    const material = key.split('|').pop()!;
    const geometry = builder.build();
    const L = [0, 1, 2].map((c) => 0.55 * SKY.zenith[c] + 0.45 * SKY.horizon[c]);
    const sh = [geometry.getAttribute('aSHr'), geometry.getAttribute('aSHg'), geometry.getAttribute('aSHb')] as BufferAttribute[];
    const bk = geometry.getAttribute('aBake') as BufferAttribute;
    const own = builder.own;
    for (let i = 0; i < builder.vertexCount; i++) {
      // What lies under the hill has light of its own, reckoned when it was built; it is marked as seeing no sky, which keeps the sun off it.
      if (own) {
        for (let c = 0; c < 3; c++) sh[c].setXYZW(i, own[i * 13 + c * 4], own[i * 13 + c * 4 + 1], own[i * 13 + c * 4 + 2], own[i * 13 + c * 4 + 3]);
        bk.setXY(i, 0, 0.6 + 0.4 * own[i * 13 + 12]);
        continue;
      }
      // Rock knows how much of the sky each of its points can see; everything else sees all of it.
      // Even the deepest crack gets a little light back from the rock about it.
      const open = 0.3 + 0.7 * builder.openAt(i);
      for (let c = 0; c < 3; c++) sh[c].setXYZW(i, (Math.PI / 2) * L[c] * open, 0, (Math.PI / 2) * L[c] * 0.8 * open, 0);
      bk.setXY(i, open, 0.6);
    }
    const mesh = new Mesh(geometry, materials[material] ?? materials.stone);
    mesh.name = `scenery:${material}`;
    mesh.receiveShadow = true;
    // (Glass throws no shadow: the sun comes in at windows.)
    mesh.castShadow = material !== 'glass';
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    scenic.push(mesh);
    // Twigs, roots and low boughs are drawn but stop nobody.
    if (!key.startsWith('soft|')) solidScenery.push(mesh);
  }
  // Grass, flowers and leaves: one draw call for each kind.
  let cardTotal = 0;
  const cardMeshes: InstancedMesh[] = [];
  // Grass is drawn out to this distance, by the level of detail chosen.
  vegetationRange.value = num('grass', quality.grass);
  vegetationUniforms.uWind.value = num('wind', 1);
  // Trees carry more leaves than a modest machine wants to draw; at the lower levels of detail
  // a share of them is left off, evenly, so every crown thins and none goes bare.
  const leafShare = num('leaves', quality.leaves);
  for (const whole of desc.scenery?.cards ?? []) {
    let set = whole;
    if (leafShare < 1 && whole.kind === 'leaf') {
      set = { ...whole, matrices: [], colours: [], centres: [] };
      for (let i = 0, n = whole.matrices.length / 16; i < n; i++) {
        if (Math.floor((i + 1) * leafShare) === Math.floor(i * leafShare)) continue;
        for (let c = 0; c < 16; c++) set.matrices.push(whole.matrices[i * 16 + c]);
        for (let c = 0; c < 3; c++) { set.colours.push(whole.colours[i * 3 + c]); set.centres.push(whole.centres[i * 3 + c]); }
      }
    }
    for (const cards of makeCards(set, paintCards(set.kind))) {
      // What grows low on the ground is left out of the picture still water mirrors: there it is
      // a fringe a few pixels high, and drawing it twice cost a tenth of the frame. The eye sees
      // the second layer and the mirror does not. Reeds stand in the water and are kept.
      // Nor are the whole trees of the far hillsides: in a lake they are a few points of the picture under ripples.
      if ((cards.userData.ground && set.kind !== 'reed') || set.kind === 'fir' || set.kind === 'tree') cards.layers.set(1);
      scene.add(cards);
      scenic.push(cards);
      cardMeshes.push(cards);
    }
    cardTotal += set.matrices.length / 16;
  }
  // Deep water takes its colour from the sky over it: a dark green by day, nearly black by night.
  const water = new Water(desc.water ?? [], desc.streams ?? [], {
    mirror: Math.round(num('mirror', quality.mirror)),
    zenith: SKY.zenith, horizon: SKY.horizon,
    falls: desc.falls,
    smokes: desc.smokes,
    // Banks and trees with the light behind them; and foam, which is white, in the light there is.
    land: SKY.ground.map((v) => v * 0.45),
    foam: [0, 1, 2].map((c) => 0.6 * SKY.horizon[c] + 0.12 * SUN_COLOR.toArray()[c] * SUN_INTENSITY),
    deep: [(0.55 * SKY.zenith[0] + 0.45 * SKY.horizon[0]) * 0.06 + 0.002, (0.55 * SKY.zenith[1] + 0.45 * SKY.horizon[1]) * 0.17 + 0.003, (0.55 * SKY.zenith[2] + 0.45 * SKY.horizon[2]) * 0.11 + 0.003],
  });
  for (const m of water.meshes) { scene.add(m); scenic.push(m); }
  // The sea round an island: blue-green and clear in the shallows, and white where it breaks.
  const sea = desc.sea ? new Sea(desc.sea, {
    deep: [0, 1, 2].map((c) => (0.55 * SKY.zenith[c] + 0.45 * SKY.horizon[c]) * [0.05, 0.16, 0.2][c] + 0.002),
    shallow: [0, 1, 2].map((c) => (0.5 * SKY.zenith[c] + 0.5 * SKY.horizon[c]) * [0.18, 0.5, 0.48][c]),
    foam: [0, 1, 2].map((c) => 0.55 * SKY.horizon[c] + 0.1 * SUN_COLOR.toArray()[c] * SUN_INTENSITY),
  }) : null;
  if (sea) { scene.add(sea.mesh); scenic.push(sea.mesh); }
  // Gulls over the cliffs, white in the light of the hour.
  const birds = desc.birds?.length ? new Birds(desc.birds, seed, SUN_INTENSITY * 0.55 + 0.4) : null;
  if (birds) scene.add(birds.mesh);
  // The lighthouse's beam turns once the sun is low enough for it to be lit.
  const lit = site?.setting.hour === 'night' ? 0.22 : site?.setting.hour === 'dusk' ? 0.1 : site?.setting.hour === 'sunset' ? 0.035 : 0;
  const beacon = desc.beacon && lit ? new Beacon(desc.beacon, lit) : null;
  if (beacon) scene.add(beacon.group);
  if (site && (site.setting.hour === 'night' || site.setting.hour === 'dusk')) (materials.lamp as MeshStandardMaterial).emissiveIntensity = site.setting.hour === 'night' ? 60 : 25;
  const buildMs = performance.now() - t0;

  // One merged copy of everything, for collision and for the bake.
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const albedo = new Float32Array(vertexTotal * 3);
  const bakeSource = new Int32Array(vertexTotal);
  const bakeScale = new Float32Array(vertexTotal);
  const index = new Uint32Array(triTotal * 3);
  let io = 0;
  for (const p of parts) {
    const g = p.mesh.geometry;
    positions.set(g.getAttribute('position').array as Float32Array, p.offset * 3);
    normals.set(g.getAttribute('normal').array as Float32Array, p.offset * 3);
    const col = g.getAttribute('color').array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      for (let c = 0; c < 3; c++) albedo[(p.offset + i) * 3 + c] = Math.min(0.95, col[i * 3 + c] * p.albedo);
      bakeSource[p.offset + i] = p.plan.source[i] + p.offset;
      bakeScale[p.offset + i] = p.plan.scale[i];
    }
    const src = g.getIndex()!.array;
    for (let i = 0; i < src.length; i++) index[io++] = src[i] + p.offset;
  }
  // Collision takes in the ground and trunks of the country round the site as well, which the bake does not.
  let extraVertices = 0, extraIndices = 0;
  for (const m of solidScenery) { extraVertices += m.geometry.getAttribute('position').count; extraIndices += m.geometry.getIndex()!.count; }
  const solidPositions = new Float32Array((vertexTotal + extraVertices) * 3);
  const solidIndex = new Uint32Array(triTotal * 3 + extraIndices);
  solidPositions.set(positions);
  solidIndex.set(index);
  let vo = vertexTotal, so = triTotal * 3;
  for (const m of solidScenery) {
    const pos = m.geometry.getAttribute('position').array as Float32Array, src = m.geometry.getIndex()!.array;
    solidPositions.set(pos, vo * 3);
    for (let i = 0; i < src.length; i++) solidIndex[so++] = src[i] + vo;
    vo += pos.length / 3;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(solidPositions, 3));
  merged.setIndex(new BufferAttribute(solidIndex, 1));
  const bvh = new MeshBVH(merged);

  // Growths that glow in the caves. Each cluster sits on the rock, found by looking along its line.
  const glowLights: { pos: [number, number, number]; intensity: [number, number, number] }[] = [];
  {
    const cap = new SphereGeometry(1, 8, 6);
    // (No brighter than this: brighter, and in the dark, where the eye is wide open, they burn out to white and are not seen to be green.)
    const lit = new MeshBasicMaterial({ color: new Color(0.1, 0.85, 0.5) });
    const spread = new Rng(`${seed}/glow`);
    for (const g of desc.glows ?? []) {
      const dir = g.position.clone().sub(g.from).normalize();
      const hit = bvh.raycastFirst(new Ray(g.from, dir), DoubleSide);
      if (!hit || !hit.face) continue;
      const normal = hit.face.normal.clone();
      if (normal.dot(dir) > 0) normal.negate();
      const side = new Vector3().crossVectors(normal, new Vector3(0, 1, 0)).normalize(), up = new Vector3().crossVectors(side, normal);
      for (let k = 0; k < 9; k++) {
        const m = new Mesh(cap, lit);
        const r = spread.range(0.025, 0.07);
        m.position.copy(hit.point).addScaledVector(side, spread.range(-0.4, 0.4)).addScaledVector(up, spread.range(-0.3, 0.3)).addScaledVector(normal, r * 0.3);
        m.scale.set(r, r * 0.55, r);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        scene.add(m);
      }
      const at = hit.point.clone().addScaledVector(normal, 0.3);
      glowLights.push({ pos: [at.x, at.y, at.z], intensity: [g.colour[0] * g.strength, g.colour[1] * g.strength, g.colour[2] * g.strength] });
    }
  }

  const occluders: Mesh[] = [];
  // The solid masses cast shadows. The visible stone is only a skin, and a skin shadows itself
  // unreliably; drawing the mass behind it, from its sunward side, gives walls real thickness.
  if (desc.masses.length) {
    const boxes = desc.masses.map((m) => {
      const size = m.max.clone().sub(m.min);
      const g = new BoxGeometry(size.x, size.y, size.z);
      g.translate((m.min.x + m.max.x) / 2, (m.min.y + m.max.y) / 2, (m.min.z + m.max.z) / 2);
      return g;
    });
    const solid = new Mesh(mergeGeometries(boxes), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: FrontSide }));
    solid.castShadow = true;
    solid.frustumCulled = false;
    scene.add(solid);
    occluders.push(solid);
  }

  // A dark plane far below, so any hairline gap shows as shadow rather than sky.
  const under = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ color: 0x050505, side: DoubleSide }));
  under.rotation.x = -Math.PI / 2;
  // (Below the lowest floor there is, which in a cave may be some way down.)
  under.position.y = Math.min(-2.6, ...(site?.places ?? []).map((q) => q.floor - 2.6), ...(desc.unders ?? []).map((u) => u.min.y - 1.5), ...(desc.lowest !== undefined ? [desc.lowest - 1.5] : []));
  // (Round an island it is below the sea bed, out of sight under deep water.)
  if (desc.sea) under.position.y = Math.min(under.position.y, desc.sea.level - 60);
  scene.add(under);

  // ------------------------------------------------------------------ sun and sky
  const sunDir = desc.sunDir;
  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  const centre = desc.bounds.min.clone().add(desc.bounds.max).multiplyScalar(0.5);
  const radius = desc.bounds.max.clone().sub(desc.bounds.min).length() / 2;
  sun.position.copy(centre).addScaledVector(sunDir, radius + 5);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: radius * 2 + 10 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);

  const cloudSteps = Math.round(num('clouds', quality.clouds));
  const makeSky = (disc: boolean) => {
    const sky = new SkyMesh();
    sky.scale.setScalar(10000);
    sky.turbidity.value = 3.2;
    sky.rayleigh.value = 1.4;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.82;
    // The sky is drawn for where the sun itself is, which after sunset is not where the light comes from.
    if (desc.sun?.disc) sky.sunPosition.value.set(desc.sun.disc[0], desc.sun.disc[1], desc.sun.disc[2]).normalize();
    else sky.sunPosition.value.copy(sunDir);
    // Its own painted clouds are used only when the real ones are turned off.
    sky.cloudCoverage.value = cloudSteps > 0 ? 0 : 0.32;
    sky.cloudDensity.value = 0.5;
    sky.showSunDisc.value = disc ? 1 : 0;
    return sky;
  };
  const sky = makeSky(true);
  scene.add(sky);
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.add(makeSky(false));
  scene.environment = pmrem.fromScene(envScene, 0, 1, 20000).texture;
  scene.environmentIntensity = 0.5;

  // ------------------------------------------------------------------ torches
  const torches = desc.torches.map((t, i) => new Torch(t.position, t.out, i * 0.37 + 0.1, t.fire));
  for (const t of torches) scene.add(t.group);
  // Four real lights serve however many torches there are; see TorchLights.
  const torchLights = new TorchLights(torches, 4, TORCH_INTENSITY);
  for (const l of torchLights.lights) scene.add(l);

  // A light the player carries, for rooms the site leaves dark. It casts no shadows: redrawing a
  // shadow map of the whole site every frame as the player moves is more than the frame can afford.
  const lantern = new PointLight(new Color(1.0, 0.74, 0.48), 0, 11, 2);
  scene.add(lantern);
  const LANTERN_INTENSITY = num('lantern', 0.9);
  let lanternOn = true;
  const toggleLantern = () => {
    lanternOn = !lanternOn;
    document.body.classList.toggle('unlit', !lanternOn);
  };

  // ------------------------------------------------------------------ post
  const size = renderer.getDrawingBufferSize(new Vector2());
  // The picture is made in steps: the scene; the air put into it; the glow of what is very bright
  // added; and last the eye's adjustment to light and the screen's colours, which the pipeline does itself.
  const pipeline = new RenderPipeline(renderer);
  const atmosphere = new Atmosphere(scene, camera, renderer, Math.max(1, cloudSteps));
  {
    // (The air is drawn once into a picture of its own, which the glow then reads; otherwise it would be worked out twice.)
    const aired = rtt(atmosphere.node);
    pipeline.outputNode = num('bloom', quality.bloom) ? aired.add(bloom(aired, 0.14, 0.5, 1.8)) : aired;
  }
  const skyMean = [0, 1, 2].map((c) => 0.55 * SKY.zenith[c] + 0.45 * SKY.horizon[c]);
  atmosphere.uniforms.uSunColor.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 1.7);
  atmosphere.uniforms.uSkyColor.value.set(skyMean[0], skyMean[1], skyMean[2]).multiplyScalar(1.75);
  // Until the bake arrives, surfaces are lit by a stand-in for the sky of this hour.
  siteUniforms.uFallback.value.set(skyMean[0] * 0.9, skyMean[1] * 0.82, skyMean[2] * 0.71);
  water.mirrorSky(atmosphere);
  sea?.attach(atmosphere);
  /**
   * The weather: how much of the sky is cloud and whether it heaps up or lies in banks, how much
   * mist lies in the low ground, and how thick the air is with distance. All of it is read by the
   * air as it is drawn, so it can be changed as one watches.
   */
  const applyWeather = (w: { cloud: number; layered: boolean; mist: number; haze: number }) => {
    const u = atmosphere.uniforms, floor = desc.sun?.floor ?? 0, low = site?.setting.hour === 'sunset' || site?.setting.hour === 'dusk', { haze, mist, layered } = w;
    u.uCloudCover.value = w.cloud;
    // Haze: thin enough that the valley is clear across, thick enough that each range of hills
    // is paler than the one in front of it. A low sun has more air to shine through.
    u.uHaze.value.set((0.00014 + 0.001 * haze * haze) * (low ? 1.35 : 1), 320, floor);
    // Mist: a few metres deep on the valley floor, from a veil to a fog.
    u.uMist.value.set(mist < 0.08 ? 0 : 0.045 * mist * mist, 2.2 + 3.2 * mist, floor - 0.4);
    u.uMistLow.value = desc.groundLow !== undefined ? desc.groundLow - 0.5 : -1e6;
    // And in the country beyond the valley, on its own higher ground, from some way out.
    u.uMistFar.value.set(mist < 0.08 ? 0 : 0.006 * mist, 14 + 8 * mist, floor + 26, 175);
    // The haze is alight towards the sun only while the sun is up.
    if (!desc.sun?.disc || desc.sun.disc[1] > 0) u.uGlare.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 0.018 * (0.4 + haze));
    // The more cloud there is the lower it hangs, and heavy cloud sits on the peaks. In flat
    // banks it is a thin layer; heaped, it towers.
    u.uCloudBase.value = floor + 310 - 150 * w.cloud;
    u.uCloudTop.value = u.uCloudBase.value + (layered ? 150 : 360);
    u.uCloudFlat.value = layered ? 1 : 0;
  };
  const night = desc.sun?.night ?? 0;
  {
    const u = atmosphere.uniforms;
    if (cloudSteps > 0) {
      u.tCloud.value = cloudNoise(64);
      u.uCloudOn.value = 1;
      u.uCloudCover.value = desc.sun?.cloud ?? 0.4;
      // Lit cloud is as bright as a white wall in the same light; its shaded parts take the sky's colour.
      u.uCloudSun.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 0.19);
      u.uCloudAir.value.set(skyMean[0], skyMean[1], skyMean[2]).multiplyScalar(0.95);
      u.uShade.value = night > 0.2 ? 0.35 : 0.55;
    }
    if (desc.sun?.disc) {
      // After sunset the daytime sky gives next to nothing, and the night's own is added.
      u.uSkyZenith.value.set(SKY.zenith[0], SKY.zenith[1], SKY.zenith[2]);
      u.uSkyHorizon.value.set(SKY.horizon[0], SKY.horizon[1], SKY.horizon[2]);
      u.uGlowDir.value.set(desc.sun.disc[0], desc.sun.disc[1], desc.sun.disc[2]);
      u.uGlow.value.set(0.55, 0.22, 0.14).multiplyScalar(night > 0.9 ? 0.05 : 1);
      u.uNight.value = night;
    }
  }
  {
    // The air at a distance. What the land fades into is the sky itself, low down in whatever
    // direction is looked in: so the sky, without the sun's disc, is drawn once into a small
    // picture that the haze reads.
    const u = atmosphere.uniforms;
    const skyPicture = new CubeRenderTarget(64, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    new CubeCamera(1, 20000, skyPicture).update(renderer, envScene);
    u.tSky.value = skyPicture.texture;
    u.uAirOn.value = 1;
    u.uAirCentre.value.copy(desc.bounds.min).add(desc.bounds.max).multiplyScalar(0.5);
    applyWeather({ cloud: desc.sun?.cloud ?? 0.4, layered: !!desc.sun?.layered, mist: desc.sun?.mist ?? 0, haze: desc.sun?.haze ?? 0.5 });
  }
  if (desc.underDeep) { atmosphere.uniforms.uUnder2Min.value.copy(desc.underDeep.min); atmosphere.uniforms.uUnder2Max.value.copy(desc.underDeep.max); }
  else { atmosphere.uniforms.uUnder2Min.value.set(1, 1, 1); atmosphere.uniforms.uUnder2Max.value.set(0, 0, 0); }
  if (desc.unders?.length) {
    // One box about everything that is under the hill out of doors.
    const lowest = atmosphere.uniforms.uUnderMin.value.set(Infinity, Infinity, Infinity), highest = atmosphere.uniforms.uUnderMax.value.set(-Infinity, -Infinity, -Infinity);
    for (const u of desc.unders) { lowest.min(u.min); highest.max(u.max); }
  }
  {
    // A shaft of daylight in a hall under the hill: its air is lit as the sun is that day, or the moon.
    const shaft = desc.sunShafts?.[0], u = atmosphere.uniforms;
    if (shaft) {
      u.uShaftTop.value.set(shaft.top.x, shaft.top.y, shaft.top.z, shaft.radius);
      u.uShaftDown.value.set(shaft.down.x, shaft.down.y, shaft.down.z, shaft.length);
      u.uShaftCol.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 0.012);
      u.uUnderAir.value.set(skyMean[0], skyMean[1], skyMean[2]).multiplyScalar(0.05);
      rockUniforms.uShaftTop.value.set(shaft.top.x, shaft.top.y, shaft.top.z, shaft.radius);
      rockUniforms.uShaftUp.value.copy(shaft.down).negate();
      rockUniforms.uShaftSun.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY);
    } else { u.uShaftTop.value.set(0, 0, 0, 0); u.uUnderAir.value.set(0, 0, 0); rockUniforms.uShaftTop.value.set(0, 0, 0, 0); }
  }
  atmosphere.uniforms.uDensity.value = num('fog', 0.0018);
  atmosphere.uniforms.uIndoorDensity.value = num('dust', 14);
  atmosphere.updateStatic([...statics, ...occluders], sunDir, desc.bounds.min, desc.bounds.max);
  if (params.get('air') === '0') atmosphere.uniforms.uEnabled.value = 0;

  // ------------------------------------------------------------------ player
  const player = new Player(camera, canvas, bvh);
  player.fallTo = Math.min(-8, under.position.y - 1);
  for (const f of desc.fences ?? []) player.blockers.push({ min: f.min, max: f.max, active: true });
  new TouchControls(canvas, player, toggleLantern);

  // ------------------------------------------------------------------ doors, keys and the goal
  const game = site ? new Game(site, desc, scene, materials, player, {
    toast,
    sound: (event) => sound.play(event),
    keysChanged: (keys) => {
      document.getElementById('keys')!.innerHTML = keys.map((k) => `<span class="${k}">${k} key</span>`).join('');
    },
    won: (seconds) => {
      const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
      document.getElementById('wonText')!.textContent = `You reached the heart of the house in ${m ? `${m} min ` : ''}${s} s, having seen ${game!.visited.size - 1} of its ${site.places.length - 1} places${site.secret >= 0 ? (game!.foundSecret ? ', and found what it was hiding' : ', but not what it was hiding') : ''}.${game!.finds.length ? ` Out in the valley you picked up ${game!.finds.filter((f) => f.taken).length} of the ${game!.finds.length} things left there.` : ''}`;
      document.getElementById('won')!.hidden = false;
      document.exitPointerLock?.();
    },
  }) : null;
  // ------------------------------------------------------------------ export
  const exportSource = () => ({
    statics,
    doors: game ? game.doors.map((d) => ({ node: d.group, way: d.desc.way, material: d.desc.material })) : [],
    textures: { stone, floor: stone, slate: stone, rock, scree, bark, wood, turf: ground, leaf: moss, plaster, tile, metal: plaster, glass: plaster },
  });
  const menu = document.getElementById('exportMenu')!;
  document.getElementById('export')!.addEventListener('click', () => (menu.hidden = !menu.hidden));
  {
    // The weather menu. What it changes is written into the address too, so that the place comes back as it was left.
    const panel = document.getElementById('weatherMenu')!, field = (id: string) => document.getElementById(id) as HTMLInputElement;
    const now = { cloud: desc.sun?.cloud ?? 0.4, layered: !!desc.sun?.layered, mist: desc.sun?.mist ?? 0, haze: desc.sun?.haze ?? 0.5, wind: vegetationUniforms.uWind.value };
    field('wCloud').value = String(now.cloud); field('wMist').value = String(now.mist); field('wHaze').value = String(now.haze); field('wWind').value = String(now.wind);
    (document.getElementById('wForm') as HTMLSelectElement).value = now.layered ? 'layered' : 'heaped';
    (document.getElementById('wHour') as HTMLSelectElement).value = site?.setting.hour ?? 'midday';
    const show = () => { for (const id of ['wCloud', 'wMist', 'wHaze', 'wWind']) (panel.querySelector(`output[for=${id}]`) as HTMLOutputElement).value = Number(field(id).value).toFixed(2); };
    const remember = () => {
      const next = new URLSearchParams(params);
      next.set('cloud', now.cloud.toFixed(2)); next.set('mist', now.mist.toFixed(2)); next.set('haze', now.haze.toFixed(2)); next.set('layered', now.layered ? '1' : '0');
      if (now.wind !== 1) next.set('wind', now.wind.toFixed(2)); else next.delete('wind');
      keep(next);
    };
    const change = () => {
      now.cloud = Number(field('wCloud').value); now.mist = Number(field('wMist').value); now.haze = Number(field('wHaze').value); now.wind = Number(field('wWind').value);
      now.layered = (document.getElementById('wForm') as HTMLSelectElement).value === 'layered';
      applyWeather(now);
      vegetationUniforms.uWind.value = now.wind;
      show();
      remember();
    };
    for (const id of ['wCloud', 'wMist', 'wHaze', 'wWind', 'wForm']) document.getElementById(id)!.addEventListener('input', change);
    // A new hour moves the sun, and with it every shadow and all the light that was worked out: the place is built again, and the eye put back where it was.
    document.getElementById('wHour')!.addEventListener('change', (e) => {
      remember();
      const next = new URLSearchParams(params), p = player.position;
      next.set('hour', (e.target as HTMLSelectElement).value);
      next.set('at', [p.x, p.y, p.z, player.yaw].map((v) => v.toFixed(2)).join(','));
      next.set('nointro', '1');
      go(next);
    });
    document.getElementById('weather')!.addEventListener('click', () => { panel.hidden = !panel.hidden; show(); });
  }
  (document.getElementById('exportPlan') as HTMLButtonElement).hidden = !site;
  (document.getElementById('exportJson') as HTMLButtonElement).hidden = !site;
  (document.getElementById('exportInk') as HTMLButtonElement).hidden = !site;
  document.getElementById('exportInk')!.addEventListener('click', () => site && exportInk(site));
  document.getElementById('exportPlan')!.addEventListener('click', () => site && exportPlan(site));
  document.getElementById('exportJson')!.addEventListener('click', () => site && exportJson(site));
  document.getElementById('exportModel')!.addEventListener('click', () => {
    toast('Preparing the model. This can take a little while for a large place.');
    exportModel(exportSource(), seed).then(() => toast('Model saved.'), (err) => toast(`The model could not be made: ${err.message}`));
  });
  // The battle map is a picture of the scene itself, so it is taken here, where the scene is.
  const battleMap = (maxPixels = 4096) => {
    const map = renderMap(renderer, scene, site!, { indoorExposure: 1.6, outdoorExposure: 0.42, mute: [lantern, ...torchLights.lights], outdoorOnly: scenic, maxPixels });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, num('dpr', quality.dpr)));
    window.dispatchEvent(new Event('resize'));
    return map.canvas;
  };
  (document.getElementById('exportBattle') as HTMLButtonElement).hidden = !site;
  document.getElementById('exportBattle')!.addEventListener('click', () => {
    if (!site) return;
    if (!(window as any).__bakeDone) toast('The light is still being worked out; the map will be better once it has finished.');
    battleMap().toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${seed}-battlemap.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, 'image/jpeg', 0.92);
  });
  (window as any).__exports = { battle: (max?: number) => battleMap(max).toDataURL('image/jpeg', 0.9), siteJson: () => site && siteJson(site), plan: () => site && planCanvas(site).toDataURL('image/png'), ink: () => site && inkCanvas(site).toDataURL('image/png'), model: () => modelGlb(exportSource()) };

  let revealAll = params.has('reveal');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') revealAll = !revealAll;
  });
  // A camera placed by the address, or anyone asking to fly, stays where it is put and does not drop.
  if (params.has('fly') || params.has('cam')) player.fly(true);
  const at = (params.get('at') ?? '').split(',').map(Number);
  if (params.has('cam')) {
    const c = params.get('cam')!.split(',').map(Number);
    player.place(new Vector3(c[0], c[1], c[2]), c[3] ?? 0, c[4] ?? 0);
  } else if (at.length >= 3 && at.every(Number.isFinite)) {
    // Back where they stood when the place was built again for another hour, on their feet.
    player.place(new Vector3(at[0], at[1] + 1.7, at[2]), at[3] ?? 0, 0);
  } else {
    player.place(desc.spawn.position, desc.spawn.yaw);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') atmosphere.uniforms.uEnabled.value = 1 - atmosphere.uniforms.uEnabled.value;
    if (e.code === 'KeyL') toggleLantern();
    if (e.code === 'KeyB') bakeTarget = bakeTarget > 0.5 ? 0 : 1;
  });

  hud.stats.textContent = `${desc.blocks.toLocaleString()} stones · ${vertexTotal.toLocaleString()} vertices · ${triTotal.toLocaleString()} triangles · ${cardTotal.toLocaleString()} cards · built in ${buildMs.toFixed(0)} ms`;

  // ------------------------------------------------------------------ bake
  let bakeTarget = 0;
  const apply = (r: BakeResult) => {
    for (const p of parts) {
      const g = p.mesh.geometry;
      // The baked light of a point is fourteen numbers side by side: twelve of light, then sky seen and sun seen.
      const light = (g.getAttribute('aSHr') as unknown as InterleavedBufferAttribute).data, numbers = light.array as Float32Array;
      for (let i = 0; i < p.count; i++) {
        const s = (p.offset + i) * 12;
        numbers.set(r.sh.subarray(s, s + 12), i * 14);
        numbers[i * 14 + 12] = r.skyVis[p.offset + i];
        numbers[i * 14 + 13] = r.sunVis[p.offset + i];
      }
      light.needsUpdate = true;
    }
    // Moving things take their baked light from the nearest part of the building.
    game?.applyBake((at) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < vertexTotal; i++) {
        const dx = positions[i * 3] - at.x, dy = positions[i * 3 + 1] - at.y, dz = positions[i * 3 + 2] - at.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      const e = [0, 1, 2].map((c) => {
        const o = best * 12 + c * 4;
        return r.sh[o] + 0.5 * Math.hypot(r.sh[o + 1], r.sh[o + 2], r.sh[o + 3]);
      }) as [number, number, number];
      return { e, sky: r.skyVis[best], sun: r.sunVis[best] };
    });
    bakeTarget = 1;
  };

  if (!params.has('nobake')) {
    const lights: BakeLights = {
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
      sunE: [SUN_COLOR.r * SUN_INTENSITY, SUN_COLOR.g * SUN_INTENSITY, SUN_COLOR.b * SUN_INTENSITY],
      sky: SKY,
      points: [
        ...torches.map((t) => ({
          pos: [t.lightPosition.x, t.lightPosition.y, t.lightPosition.z] as [number, number, number],
          intensity: [1.0 * TORCH_INTENSITY, 0.6 * TORCH_INTENSITY, 0.3 * TORCH_INTENSITY] as [number, number, number],
          range: 30,
          size: 0.12,
        })),
        // What glows in the caves is a faint light, but in the dark a faint light goes a long way.
        ...glowLights.map((g) => ({ pos: g.pos, intensity: g.intensity, range: 12, size: 0.3, keep: true })),
      ],
    };
    const bakeStart = performance.now();
    bake(
      {
        positions, normals, albedo, index, source: bakeSource, scale: bakeScale, lights,
        masses: new Float32Array(desc.masses.flatMap((m) => [m.min.x, m.min.y, m.min.z, m.max.x, m.max.y, m.max.z])),
        // Phones and tablets have fewer and slower cores; halve the work unless asked otherwise.
        rays: num('rays', quality.rays),
        bounces: num('bounces', 2),
        workers: num('workers', Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1))),
      },
      (label, f) => {
        hud.status.textContent = label;
        hud.bar.style.transform = `scaleX(${f})`;
      },
      apply,
    ).then((r) => {
      apply(r);
      hud.status.textContent = '';
      hud.bar.style.transform = 'scaleX(0)';
      hud.stats.textContent += ` · light baked in ${((performance.now() - bakeStart) / 1000).toFixed(1)} s`;
      (window as any).__bakeDone = true;
    }).catch((err) => {
      console.error(err);
      hud.status.textContent = 'Light bake failed; showing unbaked lighting';
      (window as any).__bakeDone = true;
    });
  } else {
    hud.status.textContent = '';
    (window as any).__bakeDone = true;
  }

  // ------------------------------------------------------------------ loop
  // Exposure follows measured scene brightness, but only part of the way, so dim places stay dim.
  const EXPOSURE_KEY = num('key', 0.36);
  // In the dark the eye opens further: how far depends on the hour.
  const EXPOSURE_MIN = 0.3, EXPOSURE_MAX = num('expMax', desc.sun?.eyes ?? 1.7);
  const exposureFor = (lum: number) => Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, EXPOSURE_KEY * Math.pow(lum, -0.43)));
  let exposure = -1;
  let exposureTarget = 0.5;
  let tick = 0;
  let metering = false;
  const glow = new Vector3();
  let lastPlace = -1;
  const lastStep = { x: 0, z: 0 };
  // How near water is, for the ear: running water, a fall, and whether the player is standing in a stream.
  const hearing = { brook: 0, fall: 0, wading: false };
  let listened = 0;
  // In a software-rendered test run, drawing starves the bake workers; this draws rarely until the bake is done.
  const bakeFirst = params.has('bakefirst');
  let last = performance.now();
  let frames = 0, fpsAt = last;
  const fixedTime = params.has('time') ? Number(params.get('time')) : null;

  const frame = (now: number) => {
    // A window that had no size when the program started has one by now.
    if (canvas.width === 0 && window.innerWidth > 0) window.dispatchEvent(new Event('resize'));
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const time = fixedTime ?? now / 1000;
    player.update(dt);
    game?.update(dt, time);
    for (const t of torches) t.update(time);
    // Held low and to the right, so it models what it lights instead of flattening it.
    lantern.position.set(0.28, -0.42, -0.15).applyQuaternion(camera.quaternion).add(camera.position);
    const lanternTarget = lanternOn ? LANTERN_INTENSITY * (0.94 + 0.06 * Math.sin(time * 9.1) * Math.sin(time * 3.7)) : 0;
    lantern.intensity += (lanternTarget - lantern.intensity) * (1 - Math.exp(-dt * 8));
    torchLights.update(dt, camera.position);
    atmosphere.setLights(torchLights.state().map((s) => ({
      position: s.position, color: glow.set(1.0, 0.5, 0.2).multiplyScalar(TORCH_INTENSITY * 0.16 * s.strength).clone(),
    })));
    vegetationUniforms.uTime.value = time;
    // The wind carries the clouds across, slowly, and turns them over as they go.
    atmosphere.uniforms.uCloudDrift.value.set(time * 0.0042, time * 0.0006, time * 0.0017);
    {
      // What is underfoot and overhead, for sound: a roof or the sky, and grass, earth, stone or planks.
      const at = site ? placeAt(site, player.position.x, player.position.z, player.position.y) : undefined;
      const open = !site || !at || at.roof === 'sky';
      // (Worked out a few times a second: it changes no faster than a walk.)
      if (listened++ % 6 === 0) {
        const px = player.position.x, py = player.position.y, pz = player.position.z;
        let near = Infinity;
        hearing.wading = false;
        for (const st of desc.streams ?? []) for (let i = 0; i < st.line.length; i += 3) {
          const flat = Math.hypot(st.line[i] - px, st.line[i + 2] - pz);
          near = Math.min(near, Math.hypot(flat, st.line[i + 1] - py));
          if (flat < st.width * 0.5 + 0.6 && py < st.line[i + 1] - 0.03 && py > st.line[i + 1] - 1) hearing.wading = true;
        }
        hearing.brook = Math.max(0, 1 - near / 16);
        // A fall carries much further than a brook, and a high one further than a low one.
        let fall = 0;
        for (const f of desc.falls ?? []) fall = Math.max(fall, (0.5 + 0.5 * Math.min(1, f.height / 8)) / (1 + (Math.hypot(f.x - px, f.z - pz) / 11) ** 2));
        // On an island the surf is heard all round, loudest at the edge and under the cliffs: it is the roar a fall makes, coming from the shore.
        if (site?.island) {
          const edge = Math.abs(inland(site.island, px, pz));
          fall = Math.max(fall, 0.5 / (1 + (edge / 14) ** 2));
          if (py < site.island.sea + 1.9) hearing.wading = true;
        }
        hearing.fall = fall < 0.02 ? 0 : fall;
      }
      let surface: Surface = 'stone';
      if (site && (!at || at.role === 'approach')) {
        const track = site.track ?? [];
        let onTrack = false;
        for (let k = 0; k < track.length - 1; k++) {
          const [ax, az] = track[k], [bx, bz] = track[k + 1];
          if (player.position.z >= Math.min(az, bz) && player.position.z <= Math.max(az, bz)) {
            const x = ax + ((bx - ax) * (player.position.z - az)) / (bz - az || 1);
            onTrack = Math.abs(player.position.x - x) < 1.4;
          }
        }
        const onDeck = (desc.water ?? []).some((w) => Math.hypot(player.position.x - w.x, player.position.z - w.z) < w.r * 0.8 && player.position.y > w.level + 0.2)
          || (desc.crossings ?? []).some((c) => c.by === 'bridge' && Math.hypot(player.position.x - c.x, player.position.z - c.z) < 4 && player.position.y > c.level + 0.2);
        surface = onDeck ? 'wood' : hearing.wading ? 'water' : onTrack ? (at ? 'stone' : 'earth') : 'grass';
      }
      const moved = Math.hypot(player.position.x - lastStep.x, player.position.z - lastStep.z);
      lastStep.x = player.position.x; lastStep.z = player.position.z;
      sound.update(dt, time, open ? 1 : 0, moved < 1 ? moved : 0, player.grounded, player.running, surface, hearing);
    }
    cullCards(cardMeshes, camera.position);
    water.update(time, camera);
    sea?.update(time);
    birds?.update(time);
    beacon?.update(time);

    siteUniforms.uBake.value += (bakeTarget - siteUniforms.uBake.value) * (1 - Math.exp(-dt * 4));
    atmosphere.update();
    pipeline.render();

    // Eyes adjust: quickly to brightness, slowly to the dark.
    if (tick++ % 6 === 0 && !metering) {
      metering = true;
      atmosphere.measure().then((lum) => {
        exposureTarget = exposureFor(lum);
        metering = false;
      }, () => { metering = false; });
    }
    const rate = exposureTarget < exposure ? 3.5 : 1.1;
    exposure = exposure < 0 ? exposureTarget : exposure + (exposureTarget - exposure) * (1 - Math.exp(-dt * rate));
    renderer.toneMappingExposure = exposure;

    // The plan follows the player, and the readout names the place they are standing in.
    if (site && tick % 6 === 1) {
      drawPlan(map, site, {
        player: { x: player.position.x, z: player.position.z, yaw: player.yaw },
        labels: map.classList.contains('big'),
        visited: revealAll || !game ? undefined : game.visited,
        shut: new Set(game?.doors.filter((d) => !d.open).map((d) => d.desc.way)),
        showSecrets: revealAll,
        items: game?.things.filter((k) => !k.taken).map((k) => k.item),
        levers: game?.levers.filter((l) => !l.thrown).map((l) => l.lever),
        // Out of doors the plan takes in the whole valley; indoors, the house alone.
        valley: (placeAt(site, player.position.x, player.position.z, player.position.y)?.role ?? 'approach') === 'approach',
        // The storey the player is on is the one that is drawn.
        level: placeAt(site, player.position.x, player.position.z, player.position.y)?.level ?? 0,
      });
      const here = placeAt(site, player.position.x, player.position.z, player.position.y);
      if (here && here.id !== lastPlace) {
        lastPlace = here.id;
        hud.seed.textContent = `${seed} · ${here.name}`;
      } else if (!here && lastPlace !== -2) {
        lastPlace = -2;
        // (Out of doors: the valley, or the island.)
        hud.seed.textContent = `${seed} · ${site.island ? 'island' : 'valley'}`;
      }
    }

    frames++;
    if (now - fpsAt > 500) {
      document.getElementById('fps')!.textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`;
      frames = 0;
      fpsAt = now;
    }
    (window as any).__frames = ((window as any).__frames ?? 0) + 1;
  };
  let loopCount = 0;
  const loop = (now: number) => {
    if (!bakeFirst || (window as any).__bakeDone || loopCount++ % 240 === 0) frame(now);
    else (window as any).__frames = ((window as any).__frames ?? 0) + 1;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // The height of whatever is underfoot at a point, for placing a camera or a test.
  const groundAt = (x: number, z: number): number => {
    const hit = bvh.raycastFirst(new Ray(new Vector3(x, 200, z), new Vector3(0, -1, 0)), DoubleSide);
    return hit ? hit.point.y : 0;
  };
  (window as any).__dbg = { sound, groundAt, renderer, pipeline, atmosphere, player, camera, scene, torches, sun, bvh, sunDir, desc, site, lantern, toggleLantern, game, get exposure() { return exposure; } };
  // For checking that geometry matches the plan: walks the player's body through every door and
  // arch, in both directions, and reports the ways that could not be crossed.
  (window as any).__dbg.walkTest = () => {
    if (!site) return [];
    const failures: string[] = [];
    // This checks the masonry, so doors are taken out of the way for the duration.
    const wasActive = player.blockers.map((b) => b.active);
    for (const b of player.blockers) b.active = false;
    for (const w of site.ways) {
      if (w.kind === 'window') continue;
      const a = site.places[w.a], b = site.places[w.b];
      if (w.kind === 'stair') {
        // A stair is walked from a stride before its foot to a stride beyond its head, and back.
        const { foot, head } = stairEnds(site, w);
        for (const [from, to, floorFrom, floorTo] of [[foot, head, a.floor, b.floor], [head, foot, b.floor, a.floor]] as const) {
          player.place(new Vector3(from[0], floorFrom + 1.68 + 0.05, from[1]), 0);
          player.analog.set(0, -1);
          let ok = false;
          for (let i = 0; i < 900 && !ok; i++) {
            player.yaw = Math.atan2(-(to[0] - player.position.x), -(to[1] - player.position.z));
            player.update(1 / 60);
            ok = Math.hypot(to[0] - player.position.x, to[1] - player.position.z) < 0.35 && Math.abs(player.position.y - floorTo) < 0.12;
          }
          if (!ok) failures.push(`stair ${w.a}->${w.b} ${floorTo > floorFrom ? 'up' : 'down'}: stopped at (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}), wanted (${to[0].toFixed(2)}, ${floorTo.toFixed(2)}, ${to[1].toFixed(2)})`);
        }
        continue;
      }
      const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[w.side];
      const wallA = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
      const alongX = w.side === 'n' || w.side === 's';
      // (A cleft between chambers on different levels climbs for some way into the higher one, so it is tried from further in.)
      const steep = !!w.natural && Math.abs(a.floor - b.floor) > 0.6, climb = Math.min(3.4, 1.4 + Math.abs(a.floor - b.floor) * 0.9) + 0.5;
      const inA = wallA - (alongX ? n[1] : n[0]) * (steep && a.floor > b.floor ? climb : 0.8);
      const inB = wallA + (alongX ? n[1] : n[0]) * (site.wallThickness + (steep && b.floor > a.floor ? climb : 0.8));
      const point = (v: number) => (alongX ? [w.at, v] : [v, w.at]);
      for (const [from, to, floorFrom, floorTo] of [[inA, inB, a.floor, b.floor], [inB, inA, b.floor, a.floor]] as const) {
        const [fx, fz] = point(from), [tx, tz] = point(to);
        player.place(new Vector3(fx, floorFrom + 1.68 + 0.05, fz), 0);
        player.analog.set(0, -1);
        let ok = false;
        for (let i = 0; i < 480 && !ok; i++) {
          player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
          player.update(1 / 60);
          ok = Math.hypot(tx - player.position.x, tz - player.position.z) < 0.35 && Math.abs(player.position.y - floorTo) < (steep ? 0.35 : 0.12);
        }
        if (!ok) failures.push(`${w.kind} ${w.a}->${w.b} side ${w.side}: stopped at (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}), wanted (${tx.toFixed(2)}, ${floorTo.toFixed(2)}, ${tz.toFixed(2)})`);
      }
    }
    player.analog.set(0, 0);
    player.blockers.forEach((b, i) => (b.active = wasActive[i]));
    player.place(desc.spawn.position, desc.spawn.yaw);
    return failures;
  };

  // For checking that the mission can be completed in the built world, not just on paper: follows
  // the solver's route with the player's body, letting doors and keys respond as they would in play.
  (window as any).__dbg.playthrough = () => {
    if (!site || !game) return { won: false, log: ['no site'] };
    const log: string[] = [];
    let clock = 0;
    const walkTo = (tx: number, tz: number, reach: number): boolean => {
      let lastX = player.position.x, lastZ = player.position.z, sidestep = 0, turn = 1, tries = 0;
      for (let i = 0; i < 2600; i++) {
        if (Math.hypot(tx - player.position.x, tz - player.position.z) < reach) { player.analog.set(0, 0); return true; }
        player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
        player.analog.set(sidestep > 0 ? turn : 0, sidestep > 0 ? -0.3 : -1);
        sidestep--;
        player.update(1 / 60);
        game.update(1 / 60, (clock += 1 / 60));
        if (i % 45 === 44) {
          // Not getting anywhere: something is in the way, so step round it.
          if (Math.hypot(player.position.x - lastX, player.position.z - lastZ) < 0.25) {
            tries++;
            if (tries % 3 === 0) turn = -turn;
            sidestep = 30 + 25 * (tries % 3);
          }
          lastX = player.position.x; lastZ = player.position.z;
        }
      }
      player.analog.set(0, 0);
      return false;
    };
    player.place(desc.spawn.position, desc.spawn.yaw);
    // Up the track from where the player arrives to the meadow.
    for (const [tx, tz] of desc.track ?? []) {
      if (!walkTo(tx, tz, 1.2)) { log.push(`stuck on the track at (${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)})`); return { won: false, log }; }
    }
    let at = site.start;
    for (const m of solve(site).moves) {
      const w = site.ways[m.way];
      const a = site.places[w.a];
      if (w.kind === 'stair') {
        const { foot, head } = stairEnds(site, w), [near, far] = at === w.a ? [foot, head] : [head, foot];
        if (!(walkTo(near[0], near[1], 0.3) && walkTo(far[0], far[1], 0.3))) { log.push(`stuck on the stair from ${site.places[at].name} to ${site.places[m.to].name}`); return { won: false, log }; }
        // Off the end of the stair and onto the floor beside it, as anyone would, before going on: otherwise whoever
        // has just come up makes for the next door across the well and goes straight back down it.
        const off = { n: [0, 1.5], s: [0, -1.5], e: [-1.5, 0], w: [1.5, 0] }[w.side];
        walkTo(far[0] + off[0], far[1] + off[1], 0.4);
        at = m.to;
        const kept = desc.anchors?.get(at);
        if (kept && game.things.some((k) => !k.taken && k.item.place === at) && !walkTo(kept.x, kept.z, 1.0)) { log.push(`could not reach what is kept in the ${site.places[at].name}`); return { won: false, log }; }
        log.push(`${site.places[at].name}${m.events.length ? ` (${m.events.join(', ')})` : ''}`);
        continue;
      }
      const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[w.side];
      const alongX = w.side === 'n' || w.side === 's';
      const wallA = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
      const inA = wallA - (alongX ? n[1] : n[0]) * 0.8;
      const inB = wallA + (alongX ? n[1] : n[0]) * (site.wallThickness + 0.8);
      const [near, far] = at === w.a ? [inA, inB] : [inB, inA];
      const point = (v: number) => (alongX ? [w.at, v] : [v, w.at]);
      // Straight to the doorway if that works; if something stands in the way (a stair against
      // the wall, as a rule), by way of the middle of the room, or of a point a stride in from the door.
      const here = site.places[at], inward = point(near + (near - far) * 0.7);
      const toDoor = () => walkTo(point(near)[0], point(near)[1], 0.3);
      // (Then by each corner of the room in turn, nearest way round first: a room with tables
      // down the middle is walked round, not through.)
      const corners = [[here.x0 + 1.1, here.z0 + 1.1], [here.x1 - 1.1, here.z0 + 1.1], [here.x0 + 1.1, here.z1 - 1.1], [here.x1 - 1.1, here.z1 - 1.1]]
        .map(([x, z]) => ({ x, z, round: Math.hypot(x - player.position.x, z - player.position.z) + Math.hypot(x - point(near)[0], z - point(near)[1]) }))
        .sort((p, q) => p.round - q.round);
      const attempt = () => (toDoor() || (walkTo((here.x0 + here.x1) / 2, (here.z0 + here.z1) / 2, 0.8) && toDoor()) || (walkTo(inward[0], inward[1], 0.6) && toDoor())
        || corners.some((c) => walkTo(c.x, c.z, 0.7) && toDoor())) && walkTo(point(far)[0], point(far)[1], 0.3);
      let ok = attempt();
      if (!ok) {
        // Found on another storey than the one being walked (down a stairwell, say): back by the stair, and once more.
        const now = placeAt(site, player.position.x, player.position.z, player.position.y);
        const stair = now && now.id !== at ? site.ways.find((q) => q.kind === 'stair' && ((q.a === now.id && q.b === at) || (q.b === now.id && q.a === at))) : undefined;
        if (stair) {
          const ends = stairEnds(site, stair), [from, to] = stair.a === now!.id ? [ends.foot, ends.head] : [ends.head, ends.foot];
          ok = walkTo(from[0], from[1], 0.3) && walkTo(to[0], to[1], 0.3) && attempt();
        }
      }
      if (!ok) { log.push(`stuck going from ${site.places[at].name} to ${site.places[m.to].name}`); return { won: false, log }; }
      at = m.to;
      for (const l of game.levers) {
        if (!l.thrown && l.lever.place === at && !walkTo(l.at.x, l.at.z, 0.9)) { log.push(`could not reach the lever in the ${site.places[at].name}`); return { won: false, log }; }
      }
      // Give a rising gate time to clear before walking on.
      for (let i = 0; i < 100; i++) game.update(1 / 60, (clock += 1 / 60));
      const anchor = desc.anchors?.get(at);
      if (anchor && (at === site.goal || game.things.some((k) => !k.taken && k.item.place === at))) {
        if (!walkTo(anchor.x, anchor.z, 1.0)) { log.push(`could not reach what is kept in the ${site.places[at].name}`); return { won: false, log }; }
      }
      log.push(`${site.places[at].name}${m.events.length ? ` (${m.events.join(', ')})` : ''}`);
    }
    return { won: game.won, keys: [...game.keys], log };
  };
  // For diagnosis: what a pixel looks at, and whether that point has a clear line to the sun.
  // For walking the player's body along a line of points, wherever they are: up a tower, through a hall under the hill.
  // It goes straight at each and steps round nothing, so that whatever stops it shows. Says how far it got.
  // How far a point is outside the valley that can be walked (less than nothing inside it): for the tests that try to get out.
  // (A cave or a hall in the valley's side runs in under the hill beyond its edge, and whoever is in one has not got out.)
  (window as any).__dbg.beyond = (x: number, z: number) => {
    if (site?.island) return -inland(site.island, x, z);
    const v = site?.valley;
    if (!v) return -1;
    // (Nor whoever is down a mine.)
    if ((site.grottoes ?? []).some((q) => q.mine && Math.abs(z - q.z) < Math.max(5, q.mine.cross.length + 2.5) && (q.side === 'w' ? edgeAt(v, 'w', q.z) - x : x - edgeAt(v, 'e', q.z)) < q.mine.length + 8)) return -1;
    if ((site.grottoes ?? []).some((q) => Math.abs(z - q.z) < (q.hall ? q.hall.width / 2 + 12 : q.r * 1.25 + 4) && (q.side === 'w' ? edgeAt(v, 'w', q.z) - x : x - edgeAt(v, 'e', q.z)) < (q.hall ? q.hall.length + 30 : q.r + 6))) return -1;
    // (Nor has whoever is in the way through the hill.)
    const bw = site.backWay;
    if (bw && v.ridge && Math.abs(z - bw.z) < 4 && x > Math.min(v.ridge.x0, site.places[bw.place].x0) - 1 && x < Math.max(v.ridge.x1, site.places[bw.place].x1) + 1) return -1;
    // (Nor whoever is in the cavern under the arm, or in the passage up from it to the cave in the arm's wall, which runs behind the valley's side.)
    const dp = bw?.deep, cave = site.grottoes?.[0];
    if (dp && Math.hypot((x - dp.x) / (dp.rx + 2), (z - dp.z) / (dp.rz + 2)) < 1) return -1;
    if (dp?.join && cave) {
      const line = joinLine(v, cave, dp);
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i], bx = line[i + 1][0] - ax, bz = line[i + 1][1] - az, f = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
        if (Math.hypot(x - ax - bx * f, z - az - bz * f) < 3.5) return -1;
      }
    }
    return Math.max(-insideOf(v, x, z), z - v.mouth - 8.5, v.z0 - 2.5 - z);
  };
  (window as any).__dbg.walk = (points: [number, number][], reach = 0.35) => {
    const out: { ok: boolean; x: number; y: number; z: number }[] = [];
    for (const [tx, tz] of points) {
      let ok = false;
      for (let i = 0; i < 1800 && !ok; i++) {
        if (Math.hypot(tx - player.position.x, tz - player.position.z) < reach) { ok = true; break; }
        player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
        player.analog.set(0, -1);
        player.update(1 / 60);
      }
      player.analog.set(0, 0);
      out.push({ ok, x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) });
      if (!ok) break;
    }
    return out;
  };
  // Floor plans of the buildings in the valley, as pictures: for looking at, and for checks.
  (window as any).__dbg.buildingPlans = () => (site?.buildings ?? []).filter((b) => b.plan).map((b) => buildingPlans(b).toDataURL('image/png'));
  (window as any).__dbg.buildingPlansAt = (b: Parameters<typeof buildingPlans>[0], scale?: number) => buildingPlans(b, scale).toDataURL('image/png');
  (window as any).__dbg.sunProbe = (nx: number, ny: number) => {
    camera.updateMatrixWorld(true);
    const dir = new Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    const hit = bvh.raycastFirst(new Ray(camera.position.clone(), dir), DoubleSide);
    if (!hit) return null;
    const n = hit.face!.normal.clone();
    const o = hit.point.clone().addScaledVector(n, 0.004);
    const block = bvh.raycastFirst(new Ray(o, sunDir.clone()), DoubleSide);
    return { p: hit.point.toArray(), n: n.toArray(), ndl: n.dot(sunDir), blockedAt: block ? block.distance : -1 };
  };
  // For automated checks: draw a frame and hand back the pixels.
  // (The brightness of a picture cannot be read back at once, so the picture is drawn, measured, and drawn again as the eye would then see it.)
  (window as any).__capture = async (pose?: number[]) => {
    // (The renderer draws the scene once to a frame of the browser's, however often it is asked; a capture is a frame of its own.)
    const fresh = () => (renderer as any)._nodes?.nodeFrame?.update();
    fresh();
    if (pose) {
      player.place(new Vector3(pose[0], pose[1], pose[2]), pose[3] ?? 0, pose[4] ?? 0);
      // Let the torch lights finish moving to the new position before the picture is taken.
      for (let i = 0; i < 12; i++) torchLights.update(1, new Vector3(pose[0], pose[1], pose[2]));
      lantern.intensity = lanternOn ? LANTERN_INTENSITY : 0;
      frame(performance.now());
      exposure = exposureTarget = exposureFor(await atmosphere.measure());
      (window as any).__lum = exposure;
      renderer.toneMappingExposure = exposure;
    }
    fresh();
    atmosphere.update();
    pipeline.render();
    return canvas.toDataURL('image/png');
  };
}

/** Waits for the next frame to be drawn; or, where none is being drawn (a page in the background), a moment. */
function nextFrame(): Promise<void> {
  return new Promise((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 120);
  });
}

start().catch((err) => {
  console.error(err);
  hud.status.textContent = `Failed to start: ${err.message}`;
});
