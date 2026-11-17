// The material lab: a small stage, apart from the game, for working on how rock, ground and
// leaves are drawn. Open /lab/materials.html on the dev server.
//
// What stands on the stage is made by the game's own code and drawn with the game's own
// materials, renderer, air and tone, so what is seen here is what a valley will show; nothing is
// copied. What the lab adds is speed. Saving `siteMaterial.ts`, `vegetation.ts` or `textures.ts`
// swaps the new materials in where they stand, in about a second, without carving anything again
// or moving the camera. A picture can be kept and wiped against the live one, to see what a change
// did. And the light, the stone, the season, the damp and the moss are on sliders.
import {
  ACESFilmicToneMapping, BufferAttribute, Color, CubeCamera, DirectionalLight, Group, HalfFloatType, InstancedMesh, InterleavedBufferAttribute,
  LinearMipmapLinearFilter, Material, Mesh, MOUSE, PCFShadowMap, PerspectiveCamera, Raycaster, RenderTarget, Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { CubeRenderTarget, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PMREMGenerator, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { rtt } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Hour, SKIES, Stone } from '../src/core/site';
import { ROCK } from '../src/render/geom/rockForms';
import { Atmosphere } from '../src/render/post';
import * as siteMaterial0 from '../src/render/siteMaterial';
import * as textures0 from '../src/render/textures';
import * as vegetation0 from '../src/render/vegetation';
import { buildStage, Season, Stage } from './specimens';

// The three files whose saving is taken up without a reload. Each is held here as it was last
// loaded; everything below reaches them through these, never through the imports above.
let SM = siteMaterial0, TX = textures0, VG = vegetation0;

// ------------------------------------------------------------------ what is set, and remembered
interface State {
  stone: Stone; season: Season; hour: Hour;
  /** Where the sun stands, in degrees, if not where the hour puts it: its bearing (0 is due south, 90 west) and its height. */
  bearing: number | null; height: number | null;
  /** Exposure, if it is held; otherwise it follows the picture, as the game's does. */
  exposure: number | null;
  air: boolean; haze: number; wind: number;
  /** Grass: how tall it stands, as a multiple of how it was planted, and how unequal it is, 0 to 1. */
  grassTall: number; grassVary: number;
  /** Moss on rock and bark, as a multiple of what the geometry carries; damp added to rock and ground, 0 to 1. */
  moss: number; damp: number;
  /** How far rock is lit face by face, and how broad its faces are, if not what the stone itself gives. */
  facet: number | null; broad: number | null; worn: number | null;
  tex: number;
  clay: boolean;
  show: { rock: boolean; ground: boolean; wood: boolean; leaves: boolean; grass: boolean };
  /** The camera: where it is, what it looks at, and how wide it sees. */
  cam: number[] | null; fov: number;
  panel: boolean;
  /** The land brush: whether it is in hand, how large it is, and whether it digs. */
  brush: boolean; radius: number; dig: boolean;
  /** Land painted with it: for each ball its middle, its radius, 1 to add or -1 to dig, and which stroke it was laid in. */
  balls: number[][];
}
const DEFAULTS: State = {
  stone: 'greystone', season: 'summer', hour: 'morning', bearing: null, height: null, exposure: null, air: true, haze: 0.5, wind: 1, grassTall: 1, grassVary: 0,
  moss: 1, damp: 0, facet: null, broad: null, worn: null, tex: 1024, clay: false, show: { rock: true, ground: true, wood: true, leaves: true, grass: true },
  cam: null, fov: 55, panel: true, brush: false, radius: 4, dig: false, balls: [],
};
const KEY = 'dungeons.lab.materials';
const query = new URLSearchParams(location.search);
const state: State = (() => {
  let kept: Partial<State> = {};
  try { kept = JSON.parse(sessionStorage.getItem(KEY) ?? '{}'); } catch { /* nothing kept */ }
  const s: State = { ...DEFAULTS, ...kept, show: { ...DEFAULTS.show, ...(kept.show ?? {}) } };
  // The address may name the stone, the season, the hour and the texture size, for pictures that can be taken again.
  if (query.get('stone')! in ROCK) s.stone = query.get('stone') as Stone;
  if (['spring', 'summer', 'autumn'].includes(query.get('season')!)) s.season = query.get('season') as Season;
  if (query.get('hour')! in SKIES) { s.hour = query.get('hour') as Hour; s.bearing = s.height = null; }
  if (query.has('tex')) s.tex = Number(query.get('tex')) || s.tex;
  return s;
})();
const remember = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private browsing */ } };

// ------------------------------------------------------------------ the page
const canvas = document.getElementById('view') as HTMLCanvasElement;
const panel = document.getElementById('panel')!, foot = document.getElementById('foot')!;
const said: { text: string; kind: 'good' | 'bad' | 'dim'; until: number } = { text: 'Starting', kind: 'dim', until: Infinity };
/** Says something at the foot of the page: what was rebuilt and how long it took, or what went wrong. */
const say = (text: string, kind: 'good' | 'bad' | 'dim' = 'dim', seconds = 12) => { said.text = text; said.kind = kind; said.until = performance.now() + seconds * 1000; };
// Shader programs are put together as they are first drawn, and what is wrong with one is
// reported to the console, not thrown. So that it is seen, the last such report is shown too.
{
  const was = console.error.bind(console);
  console.error = (...a: unknown[]) => { was(...a); say(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 600), 'bad', 60); };
  window.addEventListener('error', (e) => say(e.message, 'bad', 60));
  window.addEventListener('unhandledrejection', (e) => say(String(e.reason?.message ?? e.reason), 'bad', 60));
}

async function start(): Promise<void> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: query.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(query.get('dpr')) || 1.5));
  // The picture is drawn beside the panel, not under it, so that what is looked at is in the middle of what is seen.
  const wide = () => Math.max(200, window.innerWidth - (state.panel ? 248 : 0));
  renderer.setSize(wide(), window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(state.fov, wide() / window.innerHeight, 0.08, 3600);
  camera.layers.enable(1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.15;
  controls.maxDistance = 900;
  controls.zoomToCursor = true;

  // ------------------------------------------------------------------ the stage
  let stage: Stage;
  /** The solid things, by material; and beside each what its points carried when made, which the sliders work from. */
  const solids: { name: string; mesh: Mesh; field: Float32Array; open: Float32Array; painted?: boolean }[] = [];
  const cardGroups = { leaves: new Group(), grass: new Group() };
  scene.add(cardGroups.leaves, cardGroups.grass);
  let cardMeshes: InstancedMesh[] = [];
  let materials: Record<string, Material> = {};
  const clay = new MeshStandardNodeMaterial({ color: new Color(0.42, 0.41, 0.4), roughness: 0.92, metalness: 0 });
  let sets: Record<string, textures0.TextureSet> | null = null;
  // The sun's shadows are drawn only when something has changed; a few times over, since what
  // casts them may not be ready to draw the first time it is asked.
  let shadowsDue = 3;

  /** The textures, painted as the game paints them: the same recipes with the same seeds. */
  const paint = () => {
    if (sets) for (const s of Object.values(sets)) { s.map.dispose(); s.normalMap.dispose(); s.ormMap.dispose(); }
    const size = state.tex;
    sets = {
      moss: TX.generateTextureSet('moss', size / 2, 9), rock: TX.generateTextureSet('rock', size, 13), ground: TX.generateTextureSet('ground', size, 17),
      scree: TX.generateTextureSet('scree', size, 23), bark: TX.generateTextureSet('bark', size, 29), barkAsh: TX.generateTextureSet('barkAsh', size, 59), barkPine: TX.generateTextureSet('barkPine', size, 61), barkFir: TX.generateTextureSet('barkFir', size, 67), soil: TX.generateTextureSet('soil', size, 31),
      litter: TX.generateTextureSet('litter', size, 37), thatch: TX.generateTextureSet('thatch', size, 47),
    };
    TX.doneGenerating();
  };
  /** The materials, made as `main.ts` makes them. (Keep the two in step: what is given to each maker there is given here.) */
  const forge = () => {
    if (!sets) paint();
    const t = sets!;
    for (const m of Object.values(materials)) m.dispose();
    materials = {
      rock: SM.makeRockMaterial(t.rock, t.moss),
      turf: SM.makeGroundMaterial(t.ground, t.soil, t.scree, t.litter, t.thatch, t.moss),
      bark: SM.makeSiteMaterial(t.bark, t.moss, { normalScale: 2.2, mossScale: 2.5, matt: true, deep: 0.06 }),
      barkAsh: SM.makeSiteMaterial(t.barkAsh, t.moss, { normalScale: 1.6, mossScale: 2.5, matt: true, deep: 0.02, hollow: 0.5 }),
      barkPine: SM.makeSiteMaterial(t.barkPine, t.moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.04, hollow: 0.35 }),
      barkFir: SM.makeSiteMaterial(t.barkFir, t.moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.03, hollow: 0.6 }),
    };
    dress();
    setUniforms();
  };
  const dress = () => {
    for (const s of solids) {
      s.mesh.material = state.clay ? clay : materials[s.name];
      s.mesh.visible = s.name === 'rock' ? state.show.rock : s.name === 'turf' ? state.show.ground : state.show.wood;
    }
    cardGroups.leaves.visible = state.show.leaves;
    cardGroups.grass.visible = state.show.grass;
    shadowsDue = 3;
  };
  const plant = () => {
    for (const m of cardMeshes) { m.parent?.remove(m); m.geometry.dispose(); }
    const spent = new Set(cardMeshes.map((m) => m.material as Material));
    for (const m of spent) { (m as MeshStandardNodeMaterial).map?.dispose(); m.dispose(); }
    cardMeshes = [];
    VG.vegetationRange.value = 80;
    for (const set of stage.cards) {
      const high = set.kind === 'leaf' || set.kind === 'needle';
      for (const mesh of VG.makeCards(set, VG.paintCards(set.kind))) { (high ? cardGroups.leaves : cardGroups.grass).add(mesh); cardMeshes.push(mesh); }
    }
    shadowsDue = 3;
  };
  const build = () => {
    for (const s of solids) { scene.remove(s.mesh); s.mesh.geometry.dispose(); }
    solids.length = 0;
    stage = buildStage({ stone: state.stone, season: state.season, seed: query.get('seed') ?? 'a' });
    for (const [name, builder] of stage.meshes) addSolid(name, builder);
    plant();
  };
  const addSolid = (name: string, builder: MeshBuilder, painted = false) => {
    const geometry = builder.build();
    // (So that a line from the pointer finds where it meets the land at once, however much land there is.)
    (geometry as unknown as { boundsTree: MeshBVH }).boundsTree = new MeshBVH(geometry);
    const mesh = new Mesh(geometry, clay);
    mesh.raycast = acceleratedRaycast;
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    const open = new Float32Array(builder.vertexCount);
    for (let i = 0; i < open.length; i++) open[i] = builder.openAt(i);
    solids.push({ name, mesh, field: (geometry.getAttribute('aField').array as Float32Array).slice(), open, painted });
  };

  // ------------------------------------------------------------------ light
  const sunDir = new Vector3();
  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);
  const makeSky = (disc: boolean) => {
    const sky = new SkyMesh();
    sky.scale.setScalar(10000);
    sky.turbidity.value = 3.2;
    sky.rayleigh.value = 1.4;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.82;
    sky.cloudCoverage.value = 0.2;
    sky.cloudDensity.value = 0.5;
    sky.showSunDisc.value = disc ? 1 : 0;
    return sky;
  };
  const sky = makeSky(true), envSky = makeSky(false);
  scene.add(sky);
  const envScene = new Scene();
  envScene.add(envSky);
  const pmrem = new PMREMGenerator(renderer);
  let env: RenderTarget | null = null;
  scene.environmentIntensity = 0.5;
  const skyPicture = new CubeRenderTarget(64, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  const skyCamera = new CubeCamera(1, 20000, skyPicture);

  const pipeline = new RenderPipeline(renderer);
  const atmosphere = new Atmosphere(scene, camera, renderer, 1);
  {
    const aired = rtt(atmosphere.node);
    pipeline.outputNode = aired.add(bloom(aired, 0.14, 0.5, 1.8));
  }

  /** Where the sun stands: where it was put, or where the hour has it. */
  const sunAngles = (): [number, number] => {
    const d = SKIES[state.hour].sun, l = Math.hypot(d[0], d[1], d[2]);
    return [state.bearing ?? (Math.atan2(-d[0], d[2]) * 180) / Math.PI, state.height ?? (Math.asin(d[1] / l) * 180) / Math.PI];
  };
  /** The share of the whole sky's light that reaches every point: written where the game's bake writes it, as the game does for what it does not bake. */
  const lightFromSky = () => {
    const S = SKIES[state.hour], L = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
    for (const s of solids) {
      const g = s.mesh.geometry;
      const sh = [g.getAttribute('aSHr'), g.getAttribute('aSHg'), g.getAttribute('aSHb')] as InterleavedBufferAttribute[], bk = g.getAttribute('aBake') as InterleavedBufferAttribute;
      for (let i = 0; i < s.open.length; i++) {
        const open = 0.3 + 0.7 * s.open[i];
        for (let c = 0; c < 3; c++) sh[c].setXYZW(i, (Math.PI / 2) * L[c] * open, 0, (Math.PI / 2) * L[c] * 0.8 * open, 0);
        bk.setXY(i, open, 0.6);
      }
      sh[0].data.needsUpdate = true;
    }
  };
  const light = () => {
    const S = SKIES[state.hour], [bearing, height] = sunAngles();
    const b = (bearing * Math.PI) / 180, h = (height * Math.PI) / 180;
    sunDir.set(-Math.sin(b) * Math.cos(h), Math.sin(h), Math.cos(b) * Math.cos(h));
    sun.color.setRGB(S.colour[0], S.colour[1], S.colour[2]);
    sun.intensity = S.intensity;
    const centre = stage.near.min.clone().add(stage.near.max).multiplyScalar(0.5), radius = stage.near.max.clone().sub(stage.near.min).length() / 2;
    sun.position.copy(centre).addScaledVector(sunDir, radius + 5);
    sun.target.position.copy(centre);
    sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: radius * 2 + 10 });
    sun.shadow.camera.updateProjectionMatrix();
    // After sunset the sky is drawn for where the sun itself is, which is not where the light comes from.
    for (const k of [sky, envSky]) if (S.disc && state.bearing === null && state.height === null) k.sunPosition.value.set(S.disc[0], S.disc[1], S.disc[2]).normalize(); else k.sunPosition.value.copy(sunDir);
    env?.dispose();
    env = pmrem.fromScene(envScene, 0, 1, 20000);
    scene.environment = env.texture;
    skyCamera.update(renderer, envScene);
    const mean = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
    SM.siteUniforms.uFallback.value.set(mean[0] * 0.9, mean[1] * 0.82, mean[2] * 0.71);
    const u = atmosphere.uniforms, low = state.hour === 'sunset' || state.hour === 'dusk', haze = state.haze, night = S.night ?? 0;
    u.uSunColor.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 1.7);
    u.uSkyColor.value.set(mean[0], mean[1], mean[2]).multiplyScalar(1.75);
    u.tSky.value = skyPicture.texture;
    u.uAirOn.value = 1;
    u.uAirCentre.value.copy(centre);
    u.uHaze.value.set((0.00014 + 0.001 * haze * haze) * (low ? 1.35 : 1), 320, 0);
    if (!S.disc || S.disc[1] > 0) u.uGlare.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 0.018 * (0.4 + haze)); else u.uGlare.value.set(0, 0, 0);
    u.uSkyZenith.value.set(S.zenith[0], S.zenith[1], S.zenith[2]);
    u.uSkyHorizon.value.set(S.horizon[0], S.horizon[1], S.horizon[2]);
    if (S.disc) { u.uGlowDir.value.set(S.disc[0], S.disc[1], S.disc[2]); u.uGlow.value.set(0.55, 0.22, 0.14).multiplyScalar(night > 0.9 ? 0.05 : 1); } else u.uGlow.value.set(0, 0, 0);
    u.uNight.value = night;
    u.uDensity.value = 0.0018;
    u.uIndoorDensity.value = 14;
    u.uEnabled.value = state.air ? 1 : 0;
    atmosphere.updateStatic(solids.map((s) => s.mesh), sunDir, stage.near.min, stage.near.max);
    shadowsDue = 3;
  };
  /** The numbers the materials share, written to the materials as they now are. */
  const setUniforms = () => {
    const sharp = ROCK[state.stone].sharp;
    SM.siteUniforms.uBake.value = 1;
    SM.rockUniforms.uRockBroad.value = state.broad ?? 0.35 + 1.1 * sharp;
    SM.rockUniforms.uRockFacet.value = state.facet ?? sharp ** 2;
    SM.rockUniforms.uRockWorn.value = state.worn ?? ROCK[state.stone].worn;
    SM.rockUniforms.uShaftTop.value.set(0, 0, 0, 0);
    VG.vegetationUniforms.uWind.value = state.wind;
    SM.groundUniforms.uGrassRange.value = VG.vegetationRange.value;
    VG.vegetationUniforms.uGrassTall.value = state.grassTall;
    VG.vegetationUniforms.uGrassVary.value = state.grassVary;
    const S = SKIES[state.hour], mean = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
    SM.siteUniforms.uFallback.value.set(mean[0] * 0.9, mean[1] * 0.82, mean[2] * 0.71);
  };
  /** Moss and damp, from what the geometry carries and what the sliders add to it. */
  const setFields = () => {
    for (const s of solids) {
      const a = s.mesh.geometry.getAttribute('aField') as BufferAttribute, to = a.array as Float32Array;
      for (let i = 0; i < to.length; i += 4) {
        // (Not held to 1: out here, where nothing is baked, the material lets moss grow only a third as readily as the field asks, and the slider must be able to ask for more.)
        if (s.name !== 'turf') to[i] = s.field[i] * state.moss;
        to[i + 1] = Math.min(1, s.field[i + 1] + state.damp);
      }
      a.needsUpdate = true;
    }
  };

  // ------------------------------------------------------------------ views
  const VIEWS: { key: string; name: string; at: () => { from: number[]; to: number[]; fov?: number } }[] = [
    { key: '1', name: 'Stage', at: () => ({ from: [6, 9, 40], to: [-4, 3.5, -4] }) },
    { key: 'm', name: 'Mountain', at: () => ({ from: [16, 3.2, 62], to: [4, 30, -100] }) },
    { key: 'n', name: 'Face', at: () => ({ from: [34, 14, -70], to: [6, 50, -146] }) },
    { key: '2', name: 'Cliff', at: () => ({ from: [7, 4, 9], to: [-1, 8, -23] }) },
    { key: '3', name: 'Rock close', at: () => ({ from: [-7.5, 1.9, -17], to: [-3, 2.6, -23] }) },
    { key: '4', name: 'Cliff far', at: () => ({ from: [60, 16, 230], to: [0, 8, -23], fov: 10 }) },
    { key: '5', name: 'Boulders', at: () => ({ from: [4.2, 1.7, -3.6], to: stage.spots.boulders }) },
    { key: '6', name: 'Track', at: () => { const [x, y, z] = stage.spots.track; return { from: [x + 0.3, y + 1.7, z + 9], to: [x - 0.4, y + 0.2, z - 2] }; } },
    { key: '7', name: 'Ground close', at: () => { const [x, y, z] = stage.spots.track; return { from: [x - 2.2, y + 1.15, z + 1.2], to: [x - 0.7, y, z - 0.6] }; } },
    { key: '8', name: 'Ground far', at: () => ({ from: [10, 14, 190], to: [0, 0, 60], fov: 22 }) },
    { key: '9', name: 'Oak', at: () => { const [x, y, z] = stage.spots.oak; return { from: [x + 9, 2.2, z + 13], to: [x, y - 0.4, z] }; } },
    { key: '0', name: 'Leaves', at: () => { const [x, y, z] = stage.spots.oak; return { from: [x + 3.4, y - 1.6, z + 4.2], to: [x + 1, y + 0.3, z + 1] }; } },
    // Looking at the sun through the oak's crown, wherever the sun now is.
    { key: 'u', name: 'Into sun', at: () => { const [x, y, z] = stage.spots.oak, l = Math.hypot(sunDir.x, sunDir.z) || 1; return { from: [x - (sunDir.x / l) * 15, stage.ground(x, z) + 1.7, z - (sunDir.z / l) * 15], to: [x, y + 1, z] }; } },
    { key: 'h', name: 'Hollow', at: () => { const [x, y, z] = stage.spots.hollow; return { from: [x + 5.5, y + 2.1, z + 7.5], to: [x, y, z] }; } },
    { key: 'e', name: 'Pines', at: () => { const [x, y, z] = stage.spots.pine; return { from: [x + 12, 4, z + 20], to: [x + 3, y - 1, z + 5] }; } },
    { key: 'f', name: 'Firs', at: () => { const [x, y, z] = stage.spots.spruce; return { from: [x + 16, 3, z + 15], to: [x + 5, y - 1.5, z + 3] }; } },
  ];
  const keepCamera = () => { state.cam = [...camera.position.toArray(), ...controls.target.toArray()]; state.fov = camera.fov; remember(); };
  const place = (from: number[], to: number[], fov = 55) => {
    camera.position.set(from[0], from[1], from[2]);
    controls.target.set(to[0], to[1], to[2]);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.update();
    keepCamera();
    reflectPanel();
  };
  const view = (which: string) => {
    const v = VIEWS.find((q) => q.key === which || q.name.toLowerCase() === which.toLowerCase());
    if (!v) return false;
    const p = v.at();
    place(p.from, p.to, p.fov);
    return true;
  };
  controls.addEventListener('end', keepCamera);
  // A double click puts the point clicked on at the middle of things, to turn about and close in on.
  const ray = new Raycaster();
  canvas.addEventListener('dblclick', (e) => {
    ray.setFromCamera(new Vector2((e.clientX / wide()) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2), camera);
    const hit = ray.intersectObjects(solids.filter((s) => s.mesh.visible).map((s) => s.mesh), false)[0];
    if (hit) { controls.target.copy(hit.point); controls.update(); keepCamera(); }
  });
  /** Stands the camera at a walker's eye height over the ground beneath it, looking the way it was. */
  const standUp = () => {
    const y = stage.ground(camera.position.x, camera.position.z) + 1.7, d = y - camera.position.y;
    camera.position.y = y;
    controls.target.y += d;
    controls.update();
    keepCamera();
  };

  // ------------------------------------------------------------------ the land brush
  // A ball on the end of the pointer. Dragged over the land with the left button it leaves a
  // trail of balls of rock, each resting on whatever the pointer met (the ground, the cliff, land
  // painted by an earlier stroke: so a mass can be built upward); with Shift, or with digging chosen, the
  // balls are bitten out of what was painted before. When the button is let go the whole is
  // carved, as the cliff is carved and of the same stone, and takes the place of the balls.
  const ballShape = new SphereGeometry(1, 28, 14);
  const ballLook = (colour: number, opacity: number) => new MeshBasicNodeMaterial({ color: colour, transparent: true, opacity, depthWrite: false });
  const addLook = ballLook(0xe0b070, 0.3), digLook = ballLook(0xff5a40, 0.3), tipLook = ballLook(0xffffff, 0.22);
  const laid = new Group(), tip = new Mesh(ballShape, tipLook);
  tip.visible = false;
  scene.add(laid, tip);
  let stroke = 0, painting = false;
  const lastBall = new Vector3();
  const digging = (e: { shiftKey: boolean }) => state.dig !== e.shiftKey;
  /** Where the brush would lay a ball: on what the pointer meets, standing out of it by half its size, or sunk in by as much to dig. */
  const brushAt = (e: PointerEvent): Vector3 | null => {
    const box = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2), camera);
    // (Not on the balls of the stroke being drawn: each would be laid on the near side of the last, and the stroke would come straight
    // at the eye instead of following the pointer. A mass is built upward stroke by stroke, on what the last stroke carved.)
    const hit = ray.intersectObjects(solids.filter((s) => s.mesh.visible).map((s) => s.mesh), false)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new Vector3(0, 1, 0);
    return hit.point.clone().addScaledVector(n, state.radius * (digging(e) ? -0.3 : 0.5));
  };
  const lay = (at: Vector3, dig: boolean) => {
    state.balls.push([at.x, at.y, at.z, state.radius, dig ? -1 : 1, stroke]);
    const ball = new Mesh(ballShape, dig ? digLook : addLook);
    ball.position.copy(at);
    ball.scale.setScalar(state.radius);
    laid.add(ball);
    lastBall.copy(at);
  };
  /** Carves what has been painted, in place of what was carved from it before. */
  const carvePainted = (say0 = true) => {
    for (let i = solids.length - 1; i >= 0; i--) if (solids[i].painted) { scene.remove(solids[i].mesh); solids[i].mesh.geometry.dispose(); solids.splice(i, 1); }
    laid.clear();
    const made = stage.carveMass(state.balls);
    if (made) addSolid('rock', made.mesh, true);
    lightFromSky();
    setFields();
    dress();
    atmosphere.updateStatic(solids.map((s) => s.mesh), sunDir, stage.near.min, stage.near.max);
    remember();
    if (say0) say(made ? `Land carved from ${state.balls.length} balls in ${made.ms.toFixed(0)} ms, sampled every ${made.cell.toFixed(2)} m: ${made.mesh.triangleCount.toLocaleString()} triangles` : 'No painted land', 'good');
  };
  const holdBrush = () => {
    // With the brush in hand the left button paints; the right turns the view, the wheel closes in, as ever.
    controls.mouseButtons = state.brush ? { LEFT: -1 as unknown as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    canvas.style.cursor = state.brush ? 'crosshair' : '';
    if (!state.brush) tip.visible = false;
  };
  canvas.addEventListener('pointermove', (e) => {
    if (!state.brush) return;
    const at = brushAt(e);
    tip.visible = !!at;
    if (!at) return;
    tip.position.copy(at);
    tip.scale.setScalar(state.radius);
    tip.material = digging(e) ? digLook : tipLook;
    if (painting && at.distanceTo(lastBall) > state.radius * 0.55) lay(at, digging(e));
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.brush || e.button !== 0) return;
    const at = brushAt(e);
    if (!at) return;
    canvas.setPointerCapture(e.pointerId);
    painting = true;
    stroke = 1 + state.balls.reduce((m, b) => Math.max(m, b[5]), 0);
    lay(at, digging(e));
  });
  const endStroke = () => { if (!painting) return; painting = false; try { carvePainted(); } catch (e) { console.error(e); } };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const undoStroke = () => {
    const last = state.balls.reduce((m, b) => Math.max(m, b[5]), 0);
    state.balls = state.balls.filter((b) => b[5] !== last);
    carvePainted();
  };
  const clearLand = () => { state.balls = []; carvePainted(); };

  // ------------------------------------------------------------------ a picture kept, to compare with
  const keptImage = document.getElementById('kept') as HTMLImageElement, divider = document.getElementById('divider')!;
  let wantPicture: ((url: string) => void) | null = null;
  let keptPose: { cam: number[]; fov: number } | null = null;
  let wipe = 0.5;
  const setWipe = (f: number) => {
    wipe = Math.min(0.98, Math.max(0.02, f));
    divider.style.left = `${wipe * wide()}px`;
    keptImage.style.width = `${wide()}px`;
    keptImage.style.clipPath = `inset(0 ${(1 - wipe) * 100}% 0 0)`;
  };
  const keep = () => {
    wantPicture = (url) => {
      keptImage.src = url;
      keptPose = { cam: [...camera.position.toArray(), ...controls.target.toArray()], fov: camera.fov };
      document.body.classList.add('comparing');
      setWipe(wipe);
      say('Picture kept. Drag the line to compare; X lets it go.', 'good', 6);
    };
  };
  const letGo = () => { document.body.classList.remove('comparing'); keptPose = null; };
  const backToKept = () => { if (keptPose) place(keptPose.cam.slice(0, 3), keptPose.cam.slice(3), keptPose.fov); };
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setWipe(m.clientX / wide());
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
  });

  // ------------------------------------------------------------------ the panel
  const refreshers: (() => void)[] = [];
  const reflectPanel = () => { for (const r of refreshers) r(); };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };
  const heading = (text: string) => el('h2', panel, text);
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, title?: string) => {
    const row = el('div', panel); row.className = 'row';
    const l = el('label', row, label); if (title) l.title = row.title = title;
    const input = el('input', row); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    const out = el('output', row);
    const show = () => { const v = get(); input.value = String(v); out.textContent = step >= 1 ? v.toFixed(0) : v.toFixed(2); };
    input.addEventListener('input', () => { set(Number(input.value)); remember(); show(); });
    refreshers.push(show);
    return show;
  };
  const choice = <T extends string>(label: string, options: readonly T[], get: () => T, set: (v: T) => void) => {
    const row = el('div', panel); row.className = 'row wide';
    el('label', row, label);
    const select = el('select', row);
    for (const o of options) el('option', select, o).value = o;
    select.addEventListener('change', () => { set(select.value as T); remember(); reflectPanel(); });
    refreshers.push(() => { select.value = get(); });
  };
  const checks = (items: [string, () => boolean, (v: boolean) => void, string?][]) => {
    const row = el('div', panel); row.className = 'checks';
    for (const [label, get, set, title] of items) {
      const l = el('label', row); if (title) l.title = title;
      const input = el('input', l); input.type = 'checkbox';
      l.appendChild(document.createTextNode(label));
      input.addEventListener('change', () => { set(input.checked); remember(); reflectPanel(); });
      refreshers.push(() => { input.checked = get(); });
    }
  };
  const buttons = (items: [string, () => void, string?][]) => {
    const row = el('div', panel); row.className = 'buttons';
    for (const [label, act, title] of items) { const b = el('button', row, label); if (title) b.title = title; b.addEventListener('click', () => { act(); b.blur(); }); }
  };
  /** Does a piece of rebuilding, says how long it took, and says what went wrong if it did not work: the old things then stay as they were. */
  const redo = (what: string, work: () => void) => {
    const t0 = performance.now();
    // (New materials are not ready when they are made: their programs are put together when first drawn. So the time is taken once a picture has been drawn with them.)
    try { work(); say(`${what}…`, 'dim'); drawn = { what, since: t0, frames: 0 }; }
    catch (e) { console.error(e); say(`${what} failed: ${(e as Error).message}`, 'bad', 60); }
  };
  let drawn: { what: string; since: number; frames: number } | null = null;
  const drawnNow = { triangles: 0, calls: 0 };

  heading('Views');
  buttons(VIEWS.map((v) => [`${v.key.toUpperCase()} ${v.name}`, () => view(v.key)] as [string, () => void]));
  buttons([['G Stand on the ground', standUp, 'Puts the camera at eye height over the ground under it']]);
  slider('Lens', 6, 90, 1, () => camera.fov, (v) => { camera.fov = v; camera.updateProjectionMatrix(); state.fov = v; }, 'How wide the camera sees, in degrees: narrow it to look at far things as large as near ones');

  heading('Light');
  choice<Hour>('Hour', Object.keys(SKIES) as Hour[], () => state.hour, (v) => { state.hour = v; state.bearing = state.height = null; lightFromSky(); light(); setUniforms(); });
  slider('Sun bearing', -180, 180, 1, () => sunAngles()[0], (v) => { state.bearing = v; state.height ??= sunAngles()[1]; light(); }, '0 is due south, which the cliff faces; 90 is west');
  slider('Sun height', 1, 89, 1, () => sunAngles()[1], (v) => { state.height = v; state.bearing ??= sunAngles()[0]; light(); });
  const showExposure = slider('Exposure', 0.1, 3, 0.01, () => renderer.toneMappingExposure, (v) => { state.exposure = v; }, 'Moving this holds exposure where it is put');
  checks([
    ['exposure follows', () => state.exposure === null, (v) => { state.exposure = v ? null : renderer.toneMappingExposure; }, 'As in the game: the eye adjusts to the picture. Hold it still to compare how bright two versions of a material are.'],
    ['air', () => state.air, (v) => { state.air = v; atmosphere.uniforms.uEnabled.value = v ? 1 : 0; }, 'Haze and the light in the air, as the game draws them'],
  ]);
  slider('Haze', 0, 1, 0.01, () => state.haze, (v) => { state.haze = v; light(); });

  heading('Rock');
  choice<Stone>('Stone', Object.keys(ROCK) as Stone[], () => state.stone, (v) => { state.stone = v; state.facet = state.broad = state.worn = null; redo('Stage carved again', () => { build(); if (state.balls.length) carvePainted(false); lightFromSky(); setFields(); dress(); light(); setUniforms(); }); });
  slider('Flat faces', 0, 1, 0.01, () => SM.rockUniforms.uRockFacet.value, (v) => { state.facet = v; setUniforms(); }, 'uRockFacet: how far each face is lit as the flat plane it is. Each stone has its own; choosing a stone puts it back.');
  slider('Broad faces', 0, 2, 0.01, () => SM.rockUniforms.uRockBroad.value, (v) => { state.broad = v; setUniforms(); }, 'uRockBroad: the strength of the faces a stride across, from the normal map read large');
  slider('Water-worn', 0, 1, 0.01, () => SM.rockUniforms.uRockWorn.value, (v) => { state.worn = v; setUniforms(); }, 'uRockWorn: grooves eaten back along the planes between beds, and runnels down the faces. Limestone has it; choosing a stone puts it back.');
  slider('Moss', 0, 4, 0.01, () => state.moss, (v) => { state.moss = v; setFields(); }, 'Multiplies the moss the rock and bark carry');
  slider('Damp', 0, 1, 0.01, () => state.damp, (v) => { state.damp = v; setFields(); }, 'Added to the wet that rock and ground carry: after rain');

  heading('What grows');
  choice<Season>('Season', ['spring', 'summer', 'autumn'], () => state.season, (v) => { state.season = v; redo('Stage planted again', () => { build(); if (state.balls.length) carvePainted(false); lightFromSky(); setFields(); dress(); light(); }); });
  slider('Wind', 0, 3, 0.01, () => state.wind, (v) => { state.wind = v; setUniforms(); });
  slider('Grass height', 0.2, 3, 0.01, () => state.grassTall, (v) => { state.grassTall = v; setUniforms(); }, 'uGrassTall: multiplies how tall grass stands');
  slider('Grass uneven', 0, 1, 0.01, () => state.grassVary, (v) => { state.grassVary = v; setUniforms(); }, 'uGrassVary: at 0 grass is as it was planted; at 1 some tufts stand near twice as tall and others are cropped to a third, in drifts and tuft by tuft');

  heading('Shown');
  checks([
    ['rock', () => state.show.rock, (v) => { state.show.rock = v; dress(); }], ['ground', () => state.show.ground, (v) => { state.show.ground = v; dress(); }],
    ['wood', () => state.show.wood, (v) => { state.show.wood = v; dress(); }], ['leaves', () => state.show.leaves, (v) => { state.show.leaves = v; dress(); }],
    ['grass', () => state.show.grass, (v) => { state.show.grass = v; dress(); }],
    ['clay', () => state.clay, (v) => { state.clay = v; dress(); }, 'Everything solid in one plain grey: what the shapes alone give, without their materials'],
  ]);

  heading('Land brush');
  checks([
    ['brush in hand', () => state.brush, (v) => { state.brush = v; holdBrush(); }, 'L. Drag with the left button to lay rock on whatever the pointer meets; the right button then turns the view'],
    ['dig', () => state.dig, (v) => { state.dig = v; }, 'Bite out of what was painted, instead of adding. Holding Shift does the opposite of what is set here.'],
  ]);
  slider('Size', 0.4, 40, 0.1, () => state.radius, (v) => { state.radius = v; }, 'The radius of the brush in metres. [ and ] make it smaller and larger.');
  buttons([['Undo stroke', undoStroke, 'Z'], ['Clear', clearLand, 'Takes away all painted land']]);

  heading('Textures');
  choice<string>('Size', ['512', '1024', '2048'], () => String(state.tex), (v) => { state.tex = Number(v); redo(`Textures painted at ${v} and materials made`, () => { paint(); forge(); }); });
  buttons([['Make materials again', () => redo('Materials made', forge)]]);

  heading('Compare');
  buttons([['K Keep picture', keep, 'Keeps the picture as it is now, to wipe against the live one after a change'], ['X Let go', letGo], ['B Back to its view', backToKept]]);
  el('p', panel, 'Saving siteMaterial.ts, vegetation.ts or textures.ts swaps the new materials in where they stand. Double click a point to turn about it. P hides this panel.').className = 'note';

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (view(k)) return;
    if (k === 'g') standUp();
    else if (k === 'k') keep();
    else if (k === 'x') letGo();
    else if (k === 'b') backToKept();
    else if (k === 'l') { state.brush = !state.brush; holdBrush(); remember(); reflectPanel(); }
    else if (k === '[' || k === ']') { state.radius = Math.min(40, Math.max(0.4, state.radius * (k === ']' ? 1.25 : 0.8))); tip.scale.setScalar(state.radius); remember(); reflectPanel(); }
    else if (k === 'z') undoStroke();
    else if (k === 'c') { state.clay = !state.clay; dress(); remember(); reflectPanel(); }
    else if (k === 'p' || k === 'tab') { e.preventDefault(); state.panel = !state.panel; document.body.classList.toggle('bare', !state.panel); fit(); remember(); }
  });
  document.body.classList.toggle('bare', !state.panel);
  const fit = () => {
    camera.aspect = wide() / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wide(), window.innerHeight);
    foot.style.right = `${window.innerWidth - wide() + 14}px`;
    setWipe(wipe);
  };
  window.addEventListener('resize', fit);
  fit();

  // ------------------------------------------------------------------ first making
  {
    const t0 = performance.now();
    build();
    const t1 = performance.now();
    paint();
    const t2 = performance.now();
    forge();
    if (state.balls.length) carvePainted(false);
    holdBrush();
    lightFromSky();
    setFields();
    light();
    // (A view asked for in the address is taken once and then struck from it, so that loading the page again keeps wherever the camera has been moved to since.)
    if (query.has('view')) { view(query.get('view')!); const u = new URL(location.href); u.searchParams.delete('view'); history.replaceState(null, '', u); }
    else if (state.cam) place(state.cam.slice(0, 3), state.cam.slice(3), state.fov);
    else view('1');
    reflectPanel();
    say(`Stage built in ${(t1 - t0).toFixed(0)} ms (${Object.entries(stage!.times).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}); textures painted in ${(t2 - t1).toFixed(0)} ms`, 'dim', 20);
  }

  // ------------------------------------------------------------------ saving a file swaps it in
  // (The dev server tells the lab which of the three files was saved: see `labHot` in `vite.config.ts`.
  // The file is fetched again under a new address, which is how a browser is made to take it afresh.)
  if (import.meta.hot) {
    const hot = import.meta.hot;
    hot.send('lab:here');
    let busy = Promise.resolve();
    hot.on('lab:saved', ({ path, timestamp }: { path: string; timestamp: number }) => {
      busy = busy.then(async () => {
        const name = path.split('/').pop()!;
        try {
          const m = await import(/* @vite-ignore */ `${path}?t=${timestamp}`);
          if (name === 'siteMaterial.ts') { SM = m; redo(`${name} saved: materials made`, forge); }
          else if (name === 'vegetation.ts') { VG = m; redo(`${name} saved: cards made`, () => { plant(); setUniforms(); }); }
          else if (name === 'textures.ts') { TX = m; redo(`${name} saved: textures painted and materials made`, () => { paint(); forge(); }); }
        } catch (e) { say(`${name} could not be loaded: ${(e as Error).message}`, 'bad', 60); }
      });
    });
  }

  // ------------------------------------------------------------------ the loop
  const still = query.has('still');
  let last = performance.now(), fps = 60, tick = 0, metering = false, exposure = -1, exposureTarget = 0.5;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;
    controls.update();
    VG.vegetationUniforms.uTime.value = still ? 0 : now / 1000;
    VG.cullCards(cardMeshes, camera.position);
    if (shadowsDue > 0) { shadowsDue--; sun.shadow.needsUpdate = true; }
    atmosphere.update();
    pipeline.render();
    // What this frame drew, in every pass of it: it falls as blocks of grass and leaves pass out of range and are left out. (Cards that
    // have shrunk to nothing inside a block that is still drawn are counted all the same: they are sent, and cost their points.)
    { const info = renderer.info.render as unknown as { triangles: number; drawCalls: number }; drawnNow.triangles = info.triangles; drawnNow.calls = info.drawCalls; }
    if (drawn && ++drawn.frames === 2) { say(`${drawn.what}, and drawn after ${(performance.now() - drawn.since).toFixed(0)} ms`, 'good'); drawn = null; }
    if (wantPicture) { const give = wantPicture; wantPicture = null; give(canvas.toDataURL('image/png')); }
    // The eye adjusts, as in the game, unless exposure is held.
    const eyes = SKIES[state.hour].eyes ?? 1.7;
    if (state.exposure !== null) exposure = exposureTarget = state.exposure;
    else if (tick % 6 === 0 && !metering) {
      metering = true;
      atmosphere.measure().then((lum) => { exposureTarget = Math.min(eyes, Math.max(0.3, 0.36 * Math.pow(lum, -0.43))); metering = false; }, () => { metering = false; });
    }
    exposure = exposure < 0 ? exposureTarget : exposure + (exposureTarget - exposure) * (1 - Math.exp(-dt * (exposureTarget < exposure ? 3.5 : 1.1)));
    renderer.toneMappingExposure = exposure;
    if (tick++ % 15 === 0) {
      if (performance.now() > said.until) { said.text = ''; }
      const far = camera.position.distanceTo(controls.target);
      foot.innerHTML = '';
      if (said.text) el('div', foot, said.text).className = said.kind;
      el('div', foot, `${fps.toFixed(0)} frames a second · ${(drawnNow.triangles / 1e6).toFixed(2)} million triangles drawn in ${drawnNow.calls} calls · ${far < 10 ? far.toFixed(1) : far.toFixed(0)} m from what is looked at · exposure ${exposure.toFixed(2)}${state.exposure !== null ? ' (held)' : ''} · ${state.stone}, ${state.season}, ${state.hour}`).className = 'dim';
      if (state.exposure === null) showExposure();
    }
  };
  renderer.setAnimationLoop((now: number) => { try { frame(now); } catch (e) { console.error(e); } });

  // For driving the lab from the console or a script: set things, move, and take a picture.
  (window as unknown as Record<string, unknown>).__lab = {
    state, scene, camera, renderer, controls, atmosphere, sun,
    get stage() { return stage; }, get materials() { return materials; }, get modules() { return { SM, TX, VG }; },
    view, place, keep, letGo, forge, paint, plant,
    /** Draws one frame and gives it back as a picture. */
    capture: () => new Promise<string>((done) => { wantPicture = done; }),
    ready: true,
  };
}

start().catch((e) => { console.error(e); say(String(e?.message ?? e), 'bad', 600); foot.textContent = String(e?.message ?? e); });
