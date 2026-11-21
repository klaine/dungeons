/**
 * A run down a groomed slope (`lab/slope.html`): the downhill turns of `src/figures/alpine.ts` driven by what a skier does over some
 * forty seconds (`makeDownhillRun`): long wide turns tightening to short ones, opening up to a straight line, a tuck, braking to a near
 * stop with the skis thrown across the slope, and on down the hill. The skier goes down the slope as it does, and its skis leave their
 * tracks in the snow, carved lines that swing wide and then close, and a broad smear where it skids to slow down. Watched from behind,
 * beside, from above (where the tracks' shape shows best) or from anywhere; played at its own speed or slower, and moved about in by
 * the timeline of its parts.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, Scene, SRGBColorSpace, Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FigureLibrary } from '../src/figures/library';
import { putOn } from '../src/figures/gear';
import { makeDownhillRun, RUN_LENGTH, RUN_PARTS, type RunSample } from '../src/figures/alpine';
import { Rng } from '../src/core/rng';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);

// The slope: a plane falling at sixteen degrees, `down` along its fall line and `left` across it, and the way out of it.
const ANGLE = (16 * Math.PI) / 180;
const FALL = new Vector3(0, -Math.sin(ANGLE), Math.cos(ANGLE)), UP = new Vector3(0, Math.cos(ANGLE), Math.sin(ANGLE)), LEFT = new Vector3(1, 0, 0);
const onSlope = (down: number, left: number, out = 0) => new Vector3().addScaledVector(FALL, down).addScaledVector(LEFT, left).addScaledVector(UP, out);
/** The run's frames are a thirtieth of a second apart. */
const STEP = 1 / 30;

async function start() {
  const canvas = $<HTMLCanvasElement>('view');
  const renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL: query.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  scene.background = new Color(0xa9c8e8);
  scene.fog = new Fog(0xc9dcee, 90, 520);
  const camera = new PerspectiveCamera(50, 1, 0.1, 1200);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;

  // Light: the sky's, and a sun low across the slope, so that the snow has a grain and the skier a shadow.
  scene.add(new HemisphereLight(0xd6e6ff, 0xf3f6fb, 1.15));
  const sun = new DirectionalLight(0xfff4e6, 2.3);
  const sunFrom = new Vector3(-0.55, 0.75, -0.35).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // The snow: groomed corduroy faintly lined down the fall line, a little uneven in tone.
  const snowMap = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!, rng = new Rng('snow');
    g.fillStyle = '#f2f5f9'; g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 4) { g.fillStyle = `rgba(150,170,200,${0.05 + rng.range(0, 0.04)})`; g.fillRect(x, 0, 1.5, 512); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '160,180,210'},${rng.range(0.15, 0.4)})`; g.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(1, 3), rng.range(1, 3)); }
    for (let i = 0; i < 24; i++) { g.fillStyle = `rgba(170,190,215,${rng.range(0.008, 0.02)})`; g.beginPath(); g.arc(rng.range(0, 512), rng.range(0, 512), rng.range(60, 160), 0, 7); g.fill(); }
    const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const W = 220, L = 640;
  snowMap.repeat.set(W / 9, L / 9);
  const snow = new Mesh(new PlaneGeometry(W, L), new MeshStandardMaterial({ color: 0xffffff, map: snowMap, roughness: 0.92 }));
  snow.geometry.rotateX(-Math.PI / 2).rotateX(ANGLE);
  snow.position.copy(onSlope(L / 2 - 60, 0));
  snow.receiveShadow = true;
  scene.add(snow);

  // Beside the piste, firs on both sides, and its edges marked with poles every twenty-five metres.
  {
    const rng = new Rng('woods'), trees: Matrix4[] = [];
    for (let down = -60; down < L - 40; down += rng.range(3, 7)) for (const side of [-1, 1]) {
      if (rng.chance(0.25)) continue;
      const h = rng.range(5, 11), left = side * rng.range(30, 95);
      trees.push(new Matrix4().compose(onSlope(down, left).add(new Vector3(0, h * 0.42, 0)), new Quaternion(), new Vector3(h * 0.34, h, h * 0.34)));
    }
    const fir = new InstancedMesh(new ConeGeometry(1, 1, 9), new MeshStandardMaterial({ color: 0x24402f, roughness: 0.9 }), trees.length);
    trees.forEach((m, i) => fir.setMatrixAt(i, m));
    fir.castShadow = true;
    const marks: Matrix4[] = [];
    for (let down = -40; down < L - 40; down += 25) for (const side of [-1, 1]) marks.push(new Matrix4().compose(onSlope(down, side * 26).add(new Vector3(0, 0.75, 0)), new Quaternion(), new Vector3(1, 1, 1)));
    const poles = new InstancedMesh(new CylinderGeometry(0.035, 0.035, 1.5, 6), new MeshStandardMaterial({ color: 0xd9542b, roughness: 0.6 }), marks.length);
    marks.forEach((m, i) => poles.setMatrixAt(i, m));
    scene.add(fir, poles);
  }

  // The skier: the mannequin, its downhill skis and poles, and the run made on it.
  const base = (window as unknown as { __figureBase?: string }).__figureBase ?? new URL('../figures/', location.href).href;
  const library = await FigureLibrary.load(base);
  const idle = library.clips.find((c) => c.name === 'Idle_Loop')!;
  const run = makeDownhillRun(await library.mannequin(), idle, STEP);
  const rig = await library.body('mannequin');
  putOn(rig.model, 'alpine');
  const rider = new Group();
  rider.add(rig.model);
  rider.quaternion.setFromAxisAngle(LEFT, ANGLE);
  scene.add(rider);
  const mixer = new AnimationMixer(rig.model), action = mixer.clipAction(run.clip);
  action.play();
  const samples = run.samples, last = samples.length - 1;
  /** The run at time `t`, between its frames. */
  const sampleAt = (t: number): RunSample => {
    const f = Math.min(last, Math.max(0, t / STEP)), i = Math.min(last - 1, Math.floor(f)), k = f - i, a = samples[i], b = samples[i + 1];
    const out = { ...a };
    for (const key of Object.keys(a) as (keyof RunSample)[]) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  };
  /** Puts the skier where it is at time `t`, in its pose then. */
  const pose = (t: number) => {
    const s = sampleAt(t);
    rider.position.copy(onSlope(s.down, s.left));
    action.time = Math.min(t, RUN_LENGTH - 1e-4);
    mixer.update(0);
    rider.updateMatrixWorld(true);
    return s;
  };

  // The tracks: where each ski's middle went, laid on the snow frame by frame, a ski's width where it carved, broad where it slid
  // sideways. Worked out once for the whole run, then shown as far as the skier has got.
  const tracks: { mesh: Mesh; until: number[] }[] = [];
  {
    const feet = ['foot_l', 'foot_r'].map((n) => rig.model.getObjectByName(n)!), toes = ['ball_l', 'ball_r'].map((n) => rig.model.getObjectByName(n)!);
    const per: Vector3[][] = [[], []], wide: number[] = [], ways: number[] = [];
    const a = new Vector3(), b = new Vector3();
    for (let i = 0; i <= last; i += 2) {
      const s = pose(i * STEP);
      for (const k of [0, 1]) {
        feet[k].getWorldPosition(a); toes[k].getWorldPosition(b);
        const mid = a.add(b).multiplyScalar(0.5);
        // (Onto the snow, a finger's breadth over it.)
        per[k].push(mid.addScaledVector(UP, -mid.dot(UP) + 0.012).clone());
      }
      wide.push(0.035 + 0.75 * s.skid);
      ways.push(s.way);
    }
    // (A carved line is a narrow, sharp groove, shadowed; a skid scrapes a broad band, only a little paler than the snow about it.)
    const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: true });
    const groove = new Color(0x8ea5c2), scraped = new Color(0xd3dde9);
    for (const k of [0, 1]) {
      const n = per[k].length, pos = new Float32Array(n * 6), tone = new Float32Array(n * 6), index: number[] = [];
      for (let j = 0; j < n; j++) {
        const across = new Vector3().addScaledVector(LEFT, Math.cos(ways[j])).addScaledVector(FALL, -Math.sin(ways[j])).multiplyScalar(wide[j]);
        pos.set([...per[k][j].clone().add(across).toArray(), ...per[k][j].clone().sub(across).toArray()], j * 6);
        const c = groove.clone().lerp(scraped, Math.min(1, (wide[j] - 0.035) * 2.5));
        tone.set([c.r, c.g, c.b, c.r, c.g, c.b], j * 6);
        if (j) index.push(j * 2 - 2, j * 2 - 1, j * 2, j * 2 - 1, j * 2 + 1, j * 2);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('color', new BufferAttribute(tone, 3));
      g.setIndex(index);
      const mesh = new Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      tracks.push({ mesh, until: per[k].map((_, j) => j * 2 * STEP) });
    }
  }
  const showTracks = (t: number) => { for (const tr of tracks) { const n = Math.max(0, Math.min(tr.until.length - 1, Math.floor(t / (2 * STEP)))); tr.mesh.geometry.setDrawRange(0, n * 6); } };

  // Snow thrown up from the skis' downhill edges while they slide sideways to slow down.
  const SPRAY = 260, spray = new InstancedMesh(new IcosahedronGeometry(0.06, 0), new MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), SPRAY);
  spray.frustumCulled = false;
  scene.add(spray);
  const flakes = Array.from({ length: SPRAY }, () => ({ p: new Vector3(), v: new Vector3(), life: 0 }));
  let nextFlake = 0;
  const hidden = new Matrix4().makeScale(0, 0, 0), m4 = new Matrix4(), one = new Vector3(1, 1, 1), noTurn = new Quaternion();
  const sprayRng = new Rng('spray');
  const stepSpray = (dt: number, s: RunSample | null) => {
    if (s && s.skid > 0.45 && s.speed > 3.5) {
      const feet = ['foot_l', 'foot_r'].map((n) => rig.model.getObjectByName(n)!.getWorldPosition(new Vector3()));
      for (let i = 0; i < Math.round(s.speed * 0.9); i++) {
        const f = flakes[nextFlake++ % SPRAY], from = feet[i % 2];
        f.p.copy(from).addScaledVector(FALL, 0.35).addScaledVector(LEFT, sprayRng.range(-0.8, 0.8)).addScaledVector(UP, -from.dot(UP) + 0.05);
        f.v.copy(FALL).multiplyScalar(s.speed * sprayRng.range(0.5, 1)).addScaledVector(UP, sprayRng.range(1.2, 3.2)).addScaledVector(LEFT, sprayRng.range(-1.5, 1.5));
        f.life = sprayRng.range(0.5, 0.9);
      }
    }
    flakes.forEach((f, i) => {
      if (f.life <= 0) { spray.setMatrixAt(i, hidden); return; }
      f.life -= dt; f.v.y -= 9.81 * dt; f.p.addScaledVector(f.v, dt);
      spray.setMatrixAt(i, m4.compose(f.p, noTurn, one.setScalar(Math.max(0, f.life) * 1.6)));
      one.set(1, 1, 1);
    });
    spray.instanceMatrix.needsUpdate = true;
  };
  const clearSpray = () => { for (const f of flakes) f.life = 0; };

  // ---------------------------------------------------------------- what is shown, and how it is moved about in
  let t = 0, playing = true, rate = 1, view: 'behind' | 'beside' | 'above' | 'free' = 'behind', scrubbing = false;
  const rates: [string, number][] = [['¼×', 0.25], ['½×', 0.5], ['1×', 1]];
  const views: [string, typeof view, string][] = [['Behind', 'behind', 'B'], ['Beside', 'beside', 'S'], ['Above', 'above', 'A'], ['Free', 'free', 'F']];
  const rateButtons = rates.map(([label, r]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => { rate = r; reflect(); }; $('rates').appendChild(b); return b; });
  const viewButtons = views.map(([label, v, key]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = `${label} (${key})`; b.onclick = () => setView(v); $('views').appendChild(b); return b; });
  const line = $('line'), head = line.querySelector('.head') as HTMLElement;
  const bands = RUN_PARTS.map((part) => {
    const d = document.createElement('div'); d.className = 'band';
    d.style.left = `${(part.from / RUN_LENGTH) * 100}%`; d.style.width = `${((part.to - part.from) / RUN_LENGTH) * 100}%`;
    const s = document.createElement('span'); s.textContent = part.label; d.title = part.label; d.appendChild(s);
    line.insertBefore(d, head);
    return d;
  });
  const reflect = () => {
    $('play').textContent = playing ? 'Pause' : 'Play';
    rateButtons.forEach((b, i) => b.classList.toggle('on', rates[i][1] === rate));
    viewButtons.forEach((b, i) => b.classList.toggle('on', views[i][1] === view));
  };
  $('play').onclick = () => { playing = !playing; reflect(); };
  // (Free: the view turned about the skier by hand, and carried along with it.)
  const setView = (v: typeof view) => { view = v; controls.enabled = v === 'free'; camera.up.set(0, 1, 0); placed = false; reflect(); };
  const seek = (x: number) => { const r = line.getBoundingClientRect(); t = Math.min(RUN_LENGTH - 0.01, Math.max(0, ((x - r.left) / r.width) * RUN_LENGTH)); clearSpray(); };
  line.addEventListener('pointerdown', (e) => { scrubbing = true; line.setPointerCapture(e.pointerId); seek(e.clientX); });
  line.addEventListener('pointermove', (e) => { if (scrubbing) seek(e.clientX); });
  line.addEventListener('pointerup', () => { scrubbing = false; });
  line.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { t = Math.min(RUN_LENGTH - 0.01, Math.max(0, t + (e.key === 'ArrowRight' ? 1 : -1))); clearSpray(); e.preventDefault(); } });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && e.key === ' ') return;
    const k = e.key.toLowerCase(), v = views.find((x) => x[2].toLowerCase() === k);
    if (k === ' ') { playing = !playing; reflect(); e.preventDefault(); } else if (v) setView(v[1]);
  });

  // The view, following the skier: eased, so that the turns swing the skier across it rather than swinging the view.
  let placed = false;
  const eye = new Vector3(), look = new Vector3(), follow = new Vector3(), lastRider = new Vector3();
  const placeView = (s: RunSample, dt: number) => {
    const at = rider.position, k = placed ? 1 - Math.exp(-dt * 3) : 1;
    follow.lerp(onSlope(s.down, s.left * 0.35), k);
    if (view === 'free') {
      if (!placed) { camera.position.copy(at).addScaledVector(UP, 3).addScaledVector(LEFT, 6).addScaledVector(FALL, -6); controls.target.copy(at); }
      else camera.position.add(at.clone().sub(lastRider));
      controls.target.copy(at).addScaledVector(UP, 0.9);
      controls.update();
    } else {
      const want = new Vector3(), aim = new Vector3();
      if (view === 'behind') { want.copy(follow).addScaledVector(FALL, -9).addScaledVector(UP, 3.4); aim.copy(follow).addScaledVector(FALL, 6).addScaledVector(UP, 0.6); }
      else if (view === 'beside') { want.copy(follow).addScaledVector(LEFT, 11).addScaledVector(FALL, 1.5).addScaledVector(UP, 1.8); aim.copy(at).addScaledVector(UP, 0.9); }
      else { want.copy(follow).addScaledVector(UP, 32).addScaledVector(FALL, -9); aim.copy(follow).addScaledVector(FALL, -9); camera.up.copy(FALL); }
      eye.lerp(want, placed ? 1 - Math.exp(-dt * 4) : 1);
      look.lerp(aim, placed ? 1 - Math.exp(-dt * 5) : 1);
      camera.position.copy(eye);
      camera.lookAt(look);
    }
    lastRider.copy(at);
    placed = true;
    sun.position.copy(at).addScaledVector(sunFrom, 50);
    sun.target.position.copy(at);
  };

  const fit = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', fit);
  fit();
  setView('behind');
  $('status').hidden = true;

  let then = performance.now(), shownPart = '';
  const frame = async () => {
    const now = performance.now(), dt = Math.min(0.1, (now - then) / 1000);
    then = now;
    if (playing && !scrubbing) {
      t += dt * rate;
      if (t >= RUN_LENGTH) { t = 0; clearSpray(); placed = false; }
    }
    const s = pose(t);
    showTracks(t);
    stepSpray(playing && !scrubbing ? dt * rate : 0, playing && !scrubbing ? s : null);
    placeView(s, dt);
    const part = RUN_PARTS.find((p) => t >= p.from && t < p.to) ?? RUN_PARTS[RUN_PARTS.length - 1];
    if (part.label !== shownPart) { shownPart = part.label; $('part').textContent = part.label; bands.forEach((b, i) => b.classList.toggle('now', RUN_PARTS[i] === part)); }
    $('speed').textContent = (s.speed * 3.6).toFixed(0);
    $('down').textContent = s.down.toFixed(0);
    $('clock').textContent = t.toFixed(1);
    head.style.left = `${(t / RUN_LENGTH) * 100}%`;
    line.setAttribute('aria-valuenow', t.toFixed(1));
    await renderer.renderAsync(scene, camera);
    requestAnimationFrame(frame);
  };
  // (For a script that drives the page: where it is, and to put it anywhere.)
  (window as unknown as Record<string, unknown>).__slope = { seek: (to: number) => { t = to; clearSpray(); placed = false; }, pause: (p: boolean) => { playing = !p; reflect(); }, setView, time: () => t, ready: true, run };
  requestAnimationFrame(frame);
}

start().catch((e) => { const s = $('status'); s.hidden = false; s.textContent = `The run could not be made: ${(e as Error)?.message ?? e}`; console.error(e); });
