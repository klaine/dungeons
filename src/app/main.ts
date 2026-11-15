import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, BufferGeometry, Color, FrontSide, PointLight, DirectionalLight, DoubleSide, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Ray, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { bake, BakeLights, BakeResult } from '../render/bake/bake';
import { AtmospherePass } from '../render/post';
import { makeSiteMaterial, siteUniforms } from '../render/siteMaterial';
import { generateTextureSet } from '../render/textures';
import { exportJson, exportModel, exportPlan, modelGlb, planCanvas, siteJson } from '../export/exporter';
import { generateSite } from '../core/generate';
import { solve } from '../core/mission';
import { SceneDescription } from '../render/scene';
import { drawPlan, placeAt } from '../maps/plan';
import { meshSite } from '../render/siteMesher';
import { Torch, TorchLights } from '../render/torch';
import { buildCourtyardHall } from '../scenes/courtyardHall';
import { Game } from './game';
import { Player } from './player';
import { TouchControls } from './touch';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);

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
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
const seed = params.get('seed')!;

const hud = {
  status: document.getElementById('status')!,
  bar: document.getElementById('bar')!,
  stats: document.getElementById('stats')!,
  title: document.getElementById('title')!,
  seed: document.getElementById('seed')!,
};
const newPlace = () => {
  const next = new URLSearchParams(location.search);
  next.set('seed', randomSeed());
  location.search = next.toString();
};
document.getElementById('new')!.addEventListener('click', newPlace);
document.getElementById('again')!.addEventListener('click', newPlace);

let toastTimer = 0;
function toast(message: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4200);
}

// Mean diffuse reflectance of each texture recipe, used by the bake together with vertex tint.
const MEAN_ALBEDO: Record<string, number> = { stone: 0.6, floor: 0.6, slate: 0.6, wood: 0.25, rock: 0.6 };

// Sun and sky, in the renderer's light units. The same numbers drive the real-time sun, the bake and the fog.
let SUN_COLOR = new Color(1.0, 0.84, 0.64);
let SUN_INTENSITY = 11;
let SKY = { zenith: [0.16, 0.3, 0.62], horizon: [0.62, 0.7, 0.8], ground: [0.09, 0.08, 0.07] };
const TORCH_INTENSITY = 3.2;

async function start(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, num('dpr', 1.5)));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.08, 400);

  // ------------------------------------------------------------------ materials
  hud.status.textContent = 'Generating materials';
  const texSize = num('tex', 1024);
  const stone = generateTextureSet(renderer, 'stone', texSize, 3);
  const wood = generateTextureSet(renderer, 'wood', texSize, 5);
  const moss = generateTextureSet(renderer, 'moss', texSize / 2, 9);
  const materials: Record<string, MeshStandardMaterial> = {
    stone: makeSiteMaterial(stone, moss, { normalScale: 1.0 }),
    floor: makeSiteMaterial(stone, moss, { normalScale: 1.2 }),
    slate: makeSiteMaterial(stone, moss, { normalScale: 0.7, roughness: 0.8 }),
    wood: makeSiteMaterial(wood, moss, { normalScale: 1.0 }),
    rock: makeSiteMaterial(stone, moss, { normalScale: 2.2 }),
  };

  // ------------------------------------------------------------------ geometry
  hud.status.textContent = 'Laying stone';
  await nextFrame();
  const t0 = performance.now();
  // The hand-built look test scene is still available as ?scene=test.
  const site = params.get('scene') === 'test' ? null : generateSite(seed);
  const desc: SceneDescription = site ? meshSite(site) : buildCourtyardHall(seed);
  hud.title.textContent = desc.title ?? 'Courtyard and hall, assembled by hand.';
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
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(merged);

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
  under.position.y = -2.6;
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

  const makeSky = (disc: boolean) => {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir);
    if (u.cloudCoverage) u.cloudCoverage.value = 0.32;
    if (u.cloudDensity) u.cloudDensity.value = 0.5;
    if (u.showSunDisc) u.showSunDisc.value = disc ? 1 : 0;
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
  const torches = desc.torches.map((t, i) => new Torch(t.position, t.out, i * 0.37 + 0.1));
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
  const composer = new EffectComposer(renderer);
  const atmosphere = new AtmospherePass(scene, camera, size.x, size.y);
  atmosphere.uniforms.uSunColor.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 1.7);
  atmosphere.uniforms.uSkyColor.value.set(0.42, 0.52, 0.7).multiplyScalar(1.6);
  atmosphere.uniforms.uDensity.value = num('fog', 0.003);
  atmosphere.uniforms.uIndoorDensity.value = num('dust', 14);
  atmosphere.updateStatic(renderer, [...statics, ...occluders], sunDir, desc.bounds.min, desc.bounds.max);
  if (params.get('air') === '0') atmosphere.uniforms.uEnabled.value = 0;
  const bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.14, 0.5, 1.8);
  composer.addPass(atmosphere);
  if (num('bloom', 1)) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);

  // ------------------------------------------------------------------ player
  const player = new Player(camera, canvas, bvh);
  new TouchControls(canvas, player, toggleLantern);

  // ------------------------------------------------------------------ doors, keys and the goal
  const game = site ? new Game(site, desc, scene, materials.wood, player, {
    toast,
    keysChanged: (keys) => {
      document.getElementById('keys')!.innerHTML = keys.map((k) => `<span class="${k}">${k} key</span>`).join('');
    },
    won: (seconds) => {
      const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
      document.getElementById('wonText')!.textContent = `You reached the heart of the house in ${m ? `${m} min ` : ''}${s} s, having seen ${game!.visited.size - 1} of its ${site.places.length - 1} places.`;
      document.getElementById('won')!.hidden = false;
      document.exitPointerLock?.();
    },
  }) : null;
  // ------------------------------------------------------------------ export
  const exportSource = () => ({
    statics,
    doors: game ? game.doors.map((d) => d.group) : [],
    textures: { stone, floor: stone, slate: stone, rock: stone, wood },
  });
  const menu = document.getElementById('exportMenu')!;
  document.getElementById('export')!.addEventListener('click', () => (menu.hidden = !menu.hidden));
  (document.getElementById('exportPlan') as HTMLButtonElement).hidden = !site;
  (document.getElementById('exportJson') as HTMLButtonElement).hidden = !site;
  document.getElementById('exportPlan')!.addEventListener('click', () => site && exportPlan(site));
  document.getElementById('exportJson')!.addEventListener('click', () => site && exportJson(site));
  document.getElementById('exportModel')!.addEventListener('click', () => {
    toast('Preparing the model. This can take a little while for a large place.');
    exportModel(renderer, exportSource(), seed).then(() => toast('Model saved.'), (err) => toast(`The model could not be made: ${err.message}`));
  });
  (window as any).__exports = { siteJson: () => site && siteJson(site), plan: () => site && planCanvas(site).toDataURL('image/png'), model: () => modelGlb(renderer, exportSource()) };

  let revealAll = params.has('reveal');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') revealAll = !revealAll;
  });
  if (params.has('cam')) {
    const c = params.get('cam')!.split(',').map(Number);
    player.place(new Vector3(c[0], c[1], c[2]), c[3] ?? 0, c[4] ?? 0);
  } else {
    player.place(desc.spawn.position, desc.spawn.yaw);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') atmosphere.uniforms.uEnabled.value = 1 - atmosphere.uniforms.uEnabled.value;
    if (e.code === 'KeyL') toggleLantern();
    if (e.code === 'KeyB') bakeTarget = bakeTarget > 0.5 ? 0 : 1;
  });

  hud.stats.textContent = `${desc.blocks.toLocaleString()} stones · ${vertexTotal.toLocaleString()} vertices · ${triTotal.toLocaleString()} triangles · built in ${buildMs.toFixed(0)} ms`;

  // ------------------------------------------------------------------ bake
  let bakeTarget = 0;
  const apply = (r: BakeResult) => {
    for (const p of parts) {
      const g = p.mesh.geometry;
      const shR = g.getAttribute('aSHr') as BufferAttribute;
      const shG = g.getAttribute('aSHg') as BufferAttribute;
      const shB = g.getAttribute('aSHb') as BufferAttribute;
      const bk = g.getAttribute('aBake') as BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const s = (p.offset + i) * 12;
        (shR.array as Float32Array).set(r.sh.subarray(s, s + 4), i * 4);
        (shG.array as Float32Array).set(r.sh.subarray(s + 4, s + 8), i * 4);
        (shB.array as Float32Array).set(r.sh.subarray(s + 8, s + 12), i * 4);
        bk.array[i * 2] = r.skyVis[p.offset + i];
        bk.array[i * 2 + 1] = r.sunVis[p.offset + i];
      }
      shR.needsUpdate = shG.needsUpdate = shB.needsUpdate = bk.needsUpdate = true;
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
      points: torches.map((t) => ({
        pos: [t.lightPosition.x, t.lightPosition.y, t.lightPosition.z],
        intensity: [1.0 * TORCH_INTENSITY, 0.6 * TORCH_INTENSITY, 0.3 * TORCH_INTENSITY],
        range: 30,
        size: 0.12,
      })),
    };
    const bakeStart = performance.now();
    bake(
      {
        positions, normals, albedo, index, source: bakeSource, scale: bakeScale, lights,
        masses: new Float32Array(desc.masses.flatMap((m) => [m.min.x, m.min.y, m.min.z, m.max.x, m.max.y, m.max.z])),
        // Phones and tablets have fewer and slower cores; halve the work unless asked otherwise.
        rays: num('rays', window.matchMedia('(pointer: coarse)').matches ? 16 : 32),
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
  const EXPOSURE_MIN = 0.3, EXPOSURE_MAX = num('expMax', 1.7);
  const exposureFor = (lum: number) => Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, EXPOSURE_KEY * Math.pow(lum, -0.43)));
  let exposure = -1;
  let exposureTarget = 0.5;
  let tick = 0;
  let metering = false;
  const glow = new Vector3();
  let lastPlace = -1;
  // In a software-rendered test run, drawing starves the bake workers; this draws rarely until the bake is done.
  const bakeFirst = params.has('bakefirst');
  let last = performance.now();
  let frames = 0, fpsAt = last;
  const fixedTime = params.has('time') ? Number(params.get('time')) : null;

  const frame = (now: number) => {
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
    if (sky.material.uniforms.time) sky.material.uniforms.time.value = time;

    siteUniforms.uBake.value += (bakeTarget - siteUniforms.uBake.value) * (1 - Math.exp(-dt * 4));
    composer.render(dt);

    // Eyes adjust: quickly to brightness, slowly to the dark.
    if (tick++ % 6 === 0 && !metering) {
      metering = true;
      atmosphere.measureAsync(renderer).then((lum) => {
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
        items: game?.things.filter((k) => !k.taken).map((k) => k.item),
      });
      const here = placeAt(site, player.position.x, player.position.z);
      if (here && here.id !== lastPlace) {
        lastPlace = here.id;
        hud.seed.textContent = `${seed} · ${here.name}`;
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

  (window as any).__dbg = { renderer, atmosphere, bloom, player, camera, scene, torches, sun, bvh, sunDir, desc, site, lantern, toggleLantern, game, get exposure() { return exposure; } };
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
      const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[w.side];
      const wallA = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
      const alongX = w.side === 'n' || w.side === 's';
      const inA = wallA - (alongX ? n[1] : n[0]) * 0.8;
      const inB = wallA + (alongX ? n[1] : n[0]) * (site.wallThickness + 0.8);
      const point = (v: number) => (alongX ? [w.at, v] : [v, w.at]);
      for (const [from, to, floorFrom, floorTo] of [[inA, inB, a.floor, b.floor], [inB, inA, b.floor, a.floor]] as const) {
        const [fx, fz] = point(from), [tx, tz] = point(to);
        player.place(new Vector3(fx, floorFrom + 1.68 + 0.05, fz), 0);
        player.analog.set(0, -1);
        let ok = false;
        for (let i = 0; i < 480 && !ok; i++) {
          player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
          player.update(1 / 60);
          ok = Math.hypot(tx - player.position.x, tz - player.position.z) < 0.35 && Math.abs(player.position.y - floorTo) < 0.12;
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
      let lastX = player.position.x, lastZ = player.position.z, sidestep = 0, turn = 1;
      for (let i = 0; i < 1500; i++) {
        if (Math.hypot(tx - player.position.x, tz - player.position.z) < reach) { player.analog.set(0, 0); return true; }
        player.yaw = Math.atan2(-(tx - player.position.x), -(tz - player.position.z));
        player.analog.set(sidestep > 0 ? turn : 0, sidestep > 0 ? -0.3 : -1);
        sidestep--;
        player.update(1 / 60);
        game.update(1 / 60, (clock += 1 / 60));
        if (i % 45 === 44) {
          // Not getting anywhere: something is in the way, so step round it.
          if (Math.hypot(player.position.x - lastX, player.position.z - lastZ) < 0.25) { sidestep = 40; turn = -turn; }
          lastX = player.position.x; lastZ = player.position.z;
        }
      }
      player.analog.set(0, 0);
      return false;
    };
    player.place(desc.spawn.position, desc.spawn.yaw);
    let at = site.start;
    for (const m of solve(site).moves) {
      const w = site.ways[m.way];
      const a = site.places[w.a];
      const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[w.side];
      const alongX = w.side === 'n' || w.side === 's';
      const wallA = w.side === 'n' ? a.z0 : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0;
      const inA = wallA - (alongX ? n[1] : n[0]) * 0.8;
      const inB = wallA + (alongX ? n[1] : n[0]) * (site.wallThickness + 0.8);
      const [near, far] = at === w.a ? [inA, inB] : [inB, inA];
      const point = (v: number) => (alongX ? [w.at, v] : [v, w.at]);
      const ok = walkTo(point(near)[0], point(near)[1], 0.3) && walkTo(point(far)[0], point(far)[1], 0.3);
      if (!ok) { log.push(`stuck going from ${site.places[at].name} to ${site.places[m.to].name}`); return { won: false, log }; }
      at = m.to;
      const anchor = desc.anchors?.get(at);
      if (anchor && (at === site.goal || game.things.some((k) => !k.taken && k.item.place === at))) {
        if (!walkTo(anchor.x, anchor.z, 1.0)) { log.push(`could not reach what is kept in the ${site.places[at].name}`); return { won: false, log }; }
      }
      log.push(`${site.places[at].name}${m.events.length ? ` (${m.events.join(', ')})` : ''}`);
    }
    return { won: game.won, keys: [...game.keys], log };
  };
  // For diagnosis: what a pixel looks at, and whether that point has a clear line to the sun.
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
  (window as any).__capture = (pose?: number[]) => {
    if (pose) {
      player.place(new Vector3(pose[0], pose[1], pose[2]), pose[3] ?? 0, pose[4] ?? 0);
      // Let the torch lights finish moving to the new position before the picture is taken.
      for (let i = 0; i < 12; i++) torchLights.update(1, new Vector3(pose[0], pose[1], pose[2]));
      lantern.intensity = lanternOn ? LANTERN_INTENSITY : 0;
      frame(performance.now());
      exposure = exposureFor(atmosphere.measure(renderer));
      renderer.toneMappingExposure = exposure;
      (window as any).__lum = atmosphere.measure(renderer);
    }
    composer.render(0);
    return canvas.toDataURL('image/png');
  };
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

start().catch((err) => {
  console.error(err);
  hud.status.textContent = `Failed to start: ${err.message}`;
});
