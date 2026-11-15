import {
  ACESFilmicToneMapping, BoxGeometry, BufferAttribute, BufferGeometry, Color, FrontSide, DirectionalLight, DoubleSide, Mesh, MeshBasicMaterial,
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
import { Torch } from '../render/torch';
import { buildCourtyardHall } from '../scenes/courtyardHall';
import { Player } from './player';
import { TouchControls } from './touch';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);
const seed = params.get('seed') ?? 'first-light';

const hud = {
  status: document.getElementById('status')!,
  bar: document.getElementById('bar')!,
  stats: document.getElementById('stats')!,
};

// Mean diffuse reflectance of each texture recipe, used by the bake together with vertex tint.
const MEAN_ALBEDO: Record<string, number> = { stone: 0.6, floor: 0.6, slate: 0.6, wood: 0.25 };

// Sun and sky, in the renderer's light units. The same numbers drive the real-time sun, the bake and the fog.
const SUN_COLOR = new Color(1.0, 0.84, 0.64);
const SUN_INTENSITY = 11;
const SKY = { zenith: [0.16, 0.3, 0.62], horizon: [0.62, 0.7, 0.8], ground: [0.09, 0.08, 0.07] };
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
  };

  // ------------------------------------------------------------------ geometry
  hud.status.textContent = 'Laying stone';
  await nextFrame();
  const t0 = performance.now();
  const desc = buildCourtyardHall(seed);
  const statics: Mesh[] = [];
  const parts: { mesh: Mesh; offset: number; count: number; albedo: number }[] = [];
  let vertexTotal = 0, triTotal = 0;
  for (const [name, builder] of desc.meshes) {
    const geometry = builder.build();
    const mesh = new Mesh(geometry, materials[name] ?? materials.stone);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    statics.push(mesh);
    parts.push({ mesh, offset: vertexTotal, count: builder.vertexCount, albedo: MEAN_ALBEDO[name] ?? 0.5 });
    vertexTotal += builder.vertexCount;
    triTotal += builder.triangleCount;
  }
  const buildMs = performance.now() - t0;

  // One merged copy of everything, for collision and for the bake.
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const albedo = new Float32Array(vertexTotal * 3);
  const mortar = new Float32Array(vertexTotal);
  const index = new Uint32Array(triTotal * 3);
  let io = 0;
  for (const p of parts) {
    const g = p.mesh.geometry;
    positions.set(g.getAttribute('position').array as Float32Array, p.offset * 3);
    normals.set(g.getAttribute('normal').array as Float32Array, p.offset * 3);
    const col = g.getAttribute('color').array as Float32Array;
    const fld = g.getAttribute('aField').array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      for (let c = 0; c < 3; c++) albedo[(p.offset + i) * 3 + c] = Math.min(0.95, col[i * 3 + c] * p.albedo);
      mortar[p.offset + i] = fld[i * 4 + 3];
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
  const torches = desc.torches.map((t, i) => new Torch(t.position, t.out, i * 0.37 + 0.1, TORCH_INTENSITY));
  for (const t of torches) scene.add(t.group);

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
  atmosphere.setLights(torches.map((t) => ({ position: t.flamePosition, color: new Vector3(1.0, 0.5, 0.2).multiplyScalar(TORCH_INTENSITY * 0.16) })));
  const bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.14, 0.5, 1.8);
  composer.addPass(atmosphere);
  if (num('bloom', 1)) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);

  // ------------------------------------------------------------------ player
  const player = new Player(camera, canvas, bvh);
  new TouchControls(canvas, player);
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
    bakeTarget = 1;
  };

  if (!params.has('nobake')) {
    const lights: BakeLights = {
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
      sunE: [SUN_COLOR.r * SUN_INTENSITY, SUN_COLOR.g * SUN_INTENSITY, SUN_COLOR.b * SUN_INTENSITY],
      sky: SKY,
      points: torches.map((t) => ({
        pos: [t.light.position.x, t.light.position.y, t.light.position.z],
        intensity: [1.0 * TORCH_INTENSITY, 0.6 * TORCH_INTENSITY, 0.3 * TORCH_INTENSITY],
        range: 30,
        size: 0.12,
      })),
    };
    const bakeStart = performance.now();
    bake(
      {
        positions, normals, albedo, index, mortar, lights,
        masses: new Float32Array(desc.masses.flatMap((m) => [m.min.x, m.min.y, m.min.z, m.max.x, m.max.y, m.max.z])),
        // Phones and tablets have fewer and slower cores; halve the work unless asked otherwise.
        rays: num('rays', window.matchMedia('(pointer: coarse)').matches ? 24 : 48),
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
    for (const t of torches) t.update(time);
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

  (window as any).__dbg = { renderer, atmosphere, bloom, player, camera, scene, torches, sun, bvh, sunDir, get exposure() { return exposure; } };
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
