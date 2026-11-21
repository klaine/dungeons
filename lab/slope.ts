/**
 * A run down a groomed slope (`lab/slope.html`), watched or ridden.
 *
 * Watched: the downhill turns of `src/figures/alpine.ts` driven by what a skier does over some forty seconds (`makeDownhillRun`): long
 * wide turns tightening to short ones, opening up to a straight line, a tuck, braking to a near stop with the skis thrown across the
 * slope, and on down the hill; moved about in by the timeline of its parts, played at its own speed or slower.
 *
 * Ridden (asked: "can the turning and tucking combine? lets add touch/mouse control to the slope lab page for user to control the
 * skier. push forward means more tucked position, closer to screen bottom end more relaxed position, sideways controls turns"): where
 * the pointer is, against the middle of the picture, says what the skier does: up, tucked, the further the deeper; down, standing tall
 * and easy; to either side, turning that way, the further the sharper; any of them together, as a racer holds a tuck through a turn.
 * By mouse, where it is; by touch, where the finger is held; the arrow keys too. The skier goes as the slope and its stance let it:
 * pulled down the slope by its weight, as much as its skis point down it, slowed by the snow and by the air, much less tucked and more
 * standing tall; it turns tighter the faster it goes, if wider in a tuck; held, *Brake* (or Shift) throws the skis across the slope.
 * The slope goes on as far as it is ridden.
 *
 * Either way, the skier's skis leave their tracks in the snow, carved lines thin and dark and a skid a broad pale band, with snow thrown
 * up as it brakes; watched from behind, beside, above (where the tracks' shape shows best) or, watching, from anywhere.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, Scene, SkinnedMesh, SRGBColorSpace, Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FigureLibrary } from '../src/figures/library';
import { putOn } from '../src/figures/gear';
import { makeDownhillRun, Rider, RUN_LENGTH, RUN_PARTS, type RunSample } from '../src/figures/alpine';
import { Rng } from '../src/core/rng';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);

// The slope: a plane falling at sixteen degrees, `down` along its fall line and `left` across it, and the way out of it.
const ANGLE = (16 * Math.PI) / 180, G = 9.81;
const FALL = new Vector3(0, -Math.sin(ANGLE), Math.cos(ANGLE)), UP = new Vector3(0, Math.cos(ANGLE), Math.sin(ANGLE)), LEFT = new Vector3(1, 0, 0);
const onSlope = (down: number, left: number, out = 0) => new Vector3().addScaledVector(FALL, down).addScaledVector(LEFT, left).addScaledVector(UP, out);
/** Which way a skier going `way` (radians to the left of straight down) goes, on the slope. */
const along = (way: number) => new Vector3().addScaledVector(FALL, Math.cos(way)).addScaledVector(LEFT, Math.sin(way));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
/** The watched run's frames are a thirtieth of a second apart. */
const STEP = 1 / 30;

/** Where the skier is and what it is doing, now: watched or ridden. */
interface Now { down: number; left: number; speed: number; way: number; ski: number; skid: number; tuck: number; brake: number }

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

  // The snow: groomed corduroy faintly lined down the fall line, a little uneven in tone; a sheet moved along under the skier by whole
  // tiles of its picture (nine metres), so that the slope goes on as far as it is ridden.
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
  const W = 252, L = 720;
  snowMap.repeat.set(W / 9, L / 9);
  const snow = new Mesh(new PlaneGeometry(W, L), new MeshStandardMaterial({ color: 0xffffff, map: snowMap, roughness: 0.92 }));
  snow.geometry.rotateX(-Math.PI / 2).rotateX(ANGLE);
  snow.receiveShadow = true;
  scene.add(snow);

  // Beside the piste, firs on both sides and its edges marked with poles every twenty-five metres: a stretch of 300 metres of them,
  // laid three times, one after another, about wherever the skier is.
  const TILE = 300;
  const tiles: Group[] = [];
  {
    const rng = new Rng('woods'), trees: Matrix4[] = [];
    for (let down = 0; down < TILE; down += rng.range(3, 7)) for (const side of [-1, 1]) {
      if (rng.chance(0.25)) continue;
      const h = rng.range(5, 11), left = side * rng.range(36, 100);
      trees.push(new Matrix4().compose(onSlope(down, left).add(new Vector3(0, h * 0.42, 0)), new Quaternion(), new Vector3(h * 0.34, h, h * 0.34)));
    }
    const marks: Matrix4[] = [];
    for (let down = 0; down < TILE; down += 25) for (const side of [-1, 1]) marks.push(new Matrix4().compose(onSlope(down, side * 30).add(new Vector3(0, 0.75, 0)), new Quaternion(), new Vector3(1, 1, 1)));
    const firShape = new ConeGeometry(1, 1, 9), firPaint = new MeshStandardMaterial({ color: 0x24402f, roughness: 0.9 });
    const poleShape = new CylinderGeometry(0.035, 0.035, 1.5, 6), polePaint = new MeshStandardMaterial({ color: 0xd9542b, roughness: 0.6 });
    for (let k = 0; k < 3; k++) {
      const fir = new InstancedMesh(firShape, firPaint, trees.length), poles = new InstancedMesh(poleShape, polePaint, marks.length);
      trees.forEach((m, i) => fir.setMatrixAt(i, m));
      marks.forEach((m, i) => poles.setMatrixAt(i, m));
      fir.castShadow = true;
      // (Moved as a whole: what is in it is not where its bounds were worked out.)
      fir.frustumCulled = poles.frustumCulled = false;
      const tile = new Group();
      tile.add(fir, poles);
      scene.add(tile);
      tiles.push(tile);
    }
  }
  /** The slope's sheet and its woods moved along to be about the skier. */
  const keepSlopeAbout = (down: number, left: number) => {
    snow.position.copy(onSlope(Math.round(down / 45) * 45 + 220, Math.round(left / 45) * 45));
    const first = Math.floor(down / TILE) * TILE - TILE;
    tiles.forEach((tile, k) => tile.position.copy(onSlope(first + k * TILE, 0)));
  };

  // The skier: the mannequin, posed live when ridden (`Rider`) and by the made run when watched, with its downhill skis and poles.
  const base = (window as unknown as { __figureBase?: string }).__figureBase ?? new URL('../figures/', location.href).href;
  const library = await FigureLibrary.load(base);
  const idle = library.clips.find((c) => c.name === 'Idle_Loop')!;
  const source = await library.mannequin();
  const run = makeDownhillRun(source, idle, STEP);
  const live = new Rider(source, idle), model = live.model;
  model.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; } });
  putOn(model, 'alpine');
  const rider = new Group();
  rider.add(model);
  scene.add(rider);
  const tilt = new Quaternion().setFromAxisAngle(LEFT, ANGLE);
  /** Stands the skier on the slope, facing `facing` (radians to the left of straight down). */
  const standAt = (down: number, left: number, facing: number) => {
    rider.position.copy(onSlope(down, left));
    rider.quaternion.copy(tilt).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facing));
    rider.updateMatrixWorld(true);
  };
  const mixer = new AnimationMixer(model), action = mixer.clipAction(run.clip);
  action.play();
  const samples = run.samples, last = samples.length - 1;
  /** The watched run at time `t`, between its frames. */
  const sampleAt = (t: number): RunSample => {
    const f = clamp(t / STEP, 0, last), i = Math.min(last - 1, Math.floor(f)), k = f - i, a = samples[i], b = samples[i + 1];
    const out = { ...a };
    for (const key of Object.keys(a) as (keyof RunSample)[]) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  };
  /** Puts the skier where the watched run has it at time `t`, in its pose then. */
  const watchPose = (t: number): Now => {
    const s = sampleAt(t);
    standAt(s.down, s.left, 0);
    action.time = Math.min(t, RUN_LENGTH - 1e-4);
    mixer.update(0);
    rider.updateMatrixWorld(true);
    return s;
  };
  const feet = ['foot_l', 'foot_r'].map((n) => model.getObjectByName(n)!), toes = ['ball_l', 'ball_r'].map((n) => model.getObjectByName(n)!);
  /** Where a ski's middle is on the snow, now: between the ankle and the ball of its foot, a finger's breadth over the snow. */
  const skiOnSnow = (k: number) => {
    const a = feet[k].getWorldPosition(new Vector3()), b = toes[k].getWorldPosition(new Vector3()), mid = a.add(b).multiplyScalar(0.5);
    return mid.addScaledVector(UP, -mid.dot(UP) + 0.012);
  };

  // The tracks. A carved line is a narrow, sharp groove, shadowed; a skid scrapes a broad band, only a little paler than the snow
  // about it. Laid as strips, each a ski's middle at each step with the ski's track either side of it, across the way it went.
  const trackPaint = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: true });
  const groove = new Color(0x8ea5c2), scraped = new Color(0xd3dde9);
  const strip = (n: number) => {
    const g = new BufferGeometry(), index: number[] = [];
    for (let j = 1; j < n; j++) index.push(j * 2 - 2, j * 2 - 1, j * 2, j * 2 - 1, j * 2 + 1, j * 2);
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * 6), 3));
    g.setIndex(index);
    g.setDrawRange(0, 0);
    const mesh = new Mesh(g, trackPaint);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  };
  /** Writes the `j`th step of a strip: the ski's middle, the way it went, and how broad it is (half). */
  const lay = (mesh: Mesh, j: number, at: Vector3, way: number, half: number) => {
    const across = new Vector3().addScaledVector(LEFT, Math.cos(way)).addScaledVector(FALL, -Math.sin(way)).multiplyScalar(half);
    (mesh.geometry.getAttribute('position') as BufferAttribute).set([...at.clone().add(across).toArray(), ...at.clone().sub(across).toArray()], j * 6);
    const c = groove.clone().lerp(scraped, Math.min(1, (half - 0.035) * 2.5));
    (mesh.geometry.getAttribute('color') as BufferAttribute).set([c.r, c.g, c.b, c.r, c.g, c.b], j * 6);
  };
  const halfOf = (skid: number) => 0.035 + 0.75 * skid;
  // The watched run's: worked out once for the whole run, then shown as far as the skier has got.
  const watchTracks = [strip(Math.ceil((last + 1) / 2)), strip(Math.ceil((last + 1) / 2))];
  for (let i = 0, j = 0; i <= last; i += 2, j++) {
    const s = watchPose(i * STEP);
    for (const k of [0, 1]) lay(watchTracks[k], j, skiOnSnow(k), s.way, halfOf(s.skid));
  }
  for (const m of watchTracks) { m.geometry.getAttribute('position').needsUpdate = true; m.geometry.getAttribute('color').needsUpdate = true; }
  const showWatchTracks = (t: number | null) => { for (const m of watchTracks) m.geometry.setDrawRange(0, t === null ? 0 : Math.max(0, Math.floor(t / (2 * STEP))) * 6); };
  // The ridden run's: laid as the skier goes, a step every thirty centimetres; the oldest let go of when the strip is full.
  const RIDE_STEPS = 2400, rideTracks = [strip(RIDE_STEPS), strip(RIDE_STEPS)];
  let rideLaid = 0;
  const lastLaid = new Vector3();
  const layRide = (now: Now) => {
    const at = [skiOnSnow(0), skiOnSnow(1)];
    if (rideLaid && at[0].distanceTo(lastLaid) < 0.3) return;
    lastLaid.copy(at[0]);
    if (rideLaid === RIDE_STEPS) {
      for (const m of rideTracks) for (const name of ['position', 'color']) { const arr = (m.geometry.getAttribute(name) as BufferAttribute).array as Float32Array; arr.copyWithin(0, (RIDE_STEPS / 2) * 6); }
      rideLaid = RIDE_STEPS / 2;
    }
    for (const k of [0, 1]) lay(rideTracks[k], rideLaid, at[k], now.way, halfOf(now.skid));
    rideLaid++;
    for (const m of rideTracks) { m.geometry.getAttribute('position').needsUpdate = true; m.geometry.getAttribute('color').needsUpdate = true; m.geometry.setDrawRange(0, Math.max(0, rideLaid - 1) * 6); }
  };
  const clearRideTracks = () => { rideLaid = 0; for (const m of rideTracks) m.geometry.setDrawRange(0, 0); };

  // Snow thrown up from the skis' downhill edges while they slide sideways to slow down.
  const SPRAY = 260, spray = new InstancedMesh(new IcosahedronGeometry(0.06, 0), new MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), SPRAY);
  spray.frustumCulled = false;
  scene.add(spray);
  const flakes = Array.from({ length: SPRAY }, () => ({ p: new Vector3(), v: new Vector3(), life: 0 }));
  let nextFlake = 0;
  const hidden = new Matrix4().makeScale(0, 0, 0), m4 = new Matrix4(), size = new Vector3(), noTurn = new Quaternion();
  const sprayRng = new Rng('spray');
  const stepSpray = (dt: number, now: Now | null) => {
    if (now && now.skid > 0.45 && now.speed > 3.5) {
      const go = along(now.way);
      for (let i = 0; i < Math.round(now.speed * 0.9); i++) {
        const f = flakes[nextFlake++ % SPRAY], from = skiOnSnow(i % 2);
        f.p.copy(from).addScaledVector(go, 0.35).addScaledVector(LEFT, sprayRng.range(-0.8, 0.8)).addScaledVector(UP, 0.04);
        f.v.copy(go).multiplyScalar(now.speed * sprayRng.range(0.5, 1)).addScaledVector(UP, sprayRng.range(1.2, 3.2)).addScaledVector(LEFT, sprayRng.range(-1.5, 1.5));
        f.life = sprayRng.range(0.5, 0.9);
      }
    }
    flakes.forEach((f, i) => {
      if (f.life <= 0) { spray.setMatrixAt(i, hidden); return; }
      f.life -= dt; f.v.y -= G * dt; f.p.addScaledVector(f.v, dt);
      spray.setMatrixAt(i, m4.compose(f.p, noTurn, size.setScalar(Math.max(0, f.life) * 1.6)));
    });
    spray.instanceMatrix.needsUpdate = true;
  };
  const clearSpray = () => { for (const f of flakes) f.life = 0; };

  // ---------------------------------------------------------------- riding: the skier as the pointer and the slope have it
  /**
   * The ridden skier: where it is, which way it goes and how fast; the facing of its body (half the way it goes, lagging, so that its
   * chest stays more down the slope than its skis); how far into a tuck, standing tall and braking; its lean into the turn; and its
   * poles' flicks, each a time left to run.
   */
  const ride = { down: 0, left: 0, way: 0, speed: 0, facing: 0, tuck: 0, tall: 0, brake: 0, brakeSide: 1, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0 };
  /** What the rider asks: across (-1 to 1, to the right positive) and up (1 the deepest tuck, -1 standing tallest); and braking. */
  const ask = { x: 0, y: 0 }, want = { x: 0, y: 0, keys: { up: false, down: false, left: false, right: false }, brake: false, brakeKey: false };
  const FLICK = 0.3;
  const stepRide = (dt: number): Now => {
    const keys = want.keys, keyed = keys.up || keys.down || keys.left || keys.right;
    const tx = keyed ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : want.x, ty = keyed ? (keys.up ? 1 : 0) - (keys.down ? 1 : 0) : want.y;
    ask.x += (tx - ask.x) * ease(dt, 8);
    ask.y += (ty - ask.y) * ease(dt, 8);
    ride.tuck += (Math.max(0, ask.y) - ride.tuck) * ease(dt, 4);
    ride.tall += (Math.max(0, -ask.y) - ride.tall) * ease(dt, 4);
    const braking = want.brake || want.brakeKey;
    if (braking && ride.brake < 0.05) ride.brakeSide = Math.sign(ride.way || ride.lean) || 1;
    ride.brake += ((braking ? 1 : 0) - ride.brake) * ease(dt, 6);
    // Turning: quicker the faster (a carving ski holds its own curve, some twenty metres across at speed, pushed all the way), if
    // never too slowly to come round; wider tucked; none while braking.
    const turning = -ask.x * clamp(ride.speed / 9, 0.5, 1.2) * (1 - 0.35 * ride.tuck) * (1 - ride.brake);
    ride.way = clamp(ride.way + turning * dt, -1.9, 1.9);
    // The piste's edges, its poles thirty metres out: turned back towards the middle near them, and kept off the trees.
    if (Math.abs(ride.left) > 25 && Math.sign(ride.way) === Math.sign(ride.left)) ride.way -= Math.sign(ride.way) * Math.min(Math.abs(ride.way), dt * 2.2);
    // Its speed: its weight down the slope as much as its skis point down it, less the snow's friction, the air's drag (much less
    // tucked, more standing tall), a little lost to every turn, and a great deal to braking.
    const drag = 0.0065 + (0.0037 - 0.0065) * ride.tuck + (0.012 - 0.0065) * ride.tall;
    const pull = G * Math.sin(ANGLE) * Math.cos(ride.way) - 0.04 * G * Math.cos(ANGLE) - drag * ride.speed ** 2 - 0.05 * Math.abs(turning) * ride.speed - 7 * ride.brake;
    ride.speed = Math.max(0, ride.speed + pull * dt);
    ride.down += ride.speed * Math.cos(ride.way) * dt;
    ride.left = clamp(ride.left + ride.speed * Math.sin(ride.way) * dt, -31, 31);
    ride.time += dt;
    // The lean into the turn that speed and turning ask, as `makeDownhillRun` reckons it; and the inside pole flicked as a turn begins.
    const lean = clamp(Math.atan((ride.speed * turning) / G) / ((48 * Math.PI) / 180), -1.3, 1.3) * (1 - ride.brake);
    ride.lean += (lean - ride.lean) * ease(dt, 10);
    const side = Math.abs(ride.lean) > 0.2 ? Math.sign(ride.lean) : 0;
    if (side && side !== ride.leanSide) { if (side > 0) ride.flickL = FLICK; else ride.flickR = FLICK; }
    if (side) ride.leanSide = side;
    ride.flickL = Math.max(0, ride.flickL - dt);
    ride.flickR = Math.max(0, ride.flickR - dt);
    const bump = (left: number) => (left > 0 ? Math.sin((Math.PI * (FLICK - left)) / FLICK) : 0) * (1 - ride.tuck);
    ride.facing += (0.5 * ride.way - ride.facing) * ease(dt, 2);
    const ski = ride.way + ((ride.brakeSide * 78 * Math.PI) / 180) * ride.brake;
    live.pose({ s: ride.lean, ski: ski - ride.facing, tuck: ride.tuck, brake: ride.brake, tall: ride.tall, flickL: bump(ride.flickL), flickR: bump(ride.flickR) });
    standAt(ride.down, ride.left, ride.facing);
    return { down: ride.down, left: ride.left, speed: ride.speed, way: ride.way, ski, skid: Math.abs(Math.sin(ski - ride.way)), tuck: ride.tuck, brake: ride.brake };
  };
  /** What the ridden skier is doing, in words. */
  const doingNow = () => {
    if (ride.brake > 0.5) return 'Braking';
    if (ride.speed < 0.5) return 'Standing';
    const turn = Math.abs(ask.x) > 0.15 ? (ask.x < 0 ? 'turning left' : 'turning right') : '';
    const stance = ride.tuck > 0.5 ? 'Tucked' : ride.tall > 0.5 ? 'Standing tall' : '';
    if (stance && turn) return `${stance}, ${turn}`;
    if (stance) return stance;
    return turn ? `Carving ${turn.split(' ')[1]}` : 'Running straight';
  };

  // ---------------------------------------------------------------- what is shown, and how it is moved about in
  let mode: 'watch' | 'ride' = 'watch';
  let t = 0, playing = true, rate = 1, view: 'behind' | 'beside' | 'above' | 'free' = 'behind', scrubbing = false;
  const rates: [string, number][] = [['¼×', 0.25], ['½×', 0.5], ['1×', 1]];
  const views: [string, typeof view, string][] = [['Behind', 'behind', 'B'], ['Beside', 'beside', 'S'], ['Above', 'above', 'A'], ['Free', 'free', 'F']];
  const modes: [string, typeof mode, string][] = [['Watch', 'watch', 'Watch the run as it was made'], ['Ride', 'ride', 'Ride it yourself: point to steer']];
  const button = (parent: string, label: string, onclick: () => void, title?: string) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; b.onclick = onclick; $(parent).appendChild(b); return b; };
  const modeButtons = modes.map(([label, m, title]) => button('modes', label, () => setMode(m), title));
  const rateButtons = rates.map(([label, r]) => button('rates', label, () => { rate = r; reflect(); }));
  const viewButtons = views.map(([label, v, key]) => button('views', label, () => setView(v), `${label} (${key})`));
  const brakeButton = $('brake');
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
    modeButtons.forEach((b, i) => b.classList.toggle('on', modes[i][1] === mode));
    rateButtons.forEach((b, i) => b.classList.toggle('on', rates[i][1] === rate));
    viewButtons.forEach((b, i) => { b.classList.toggle('on', views[i][1] === view); b.hidden = mode === 'ride' && views[i][1] === 'free'; });
    $('rates').hidden = line.hidden = mode === 'ride';
    $('brakes').hidden = $('pad').hidden = mode === 'watch';
    $('name').textContent = mode === 'ride' ? 'Downhill run · riding' : 'Downhill run';
    document.body.classList.toggle('riding', mode === 'ride');
  };
  $('play').onclick = () => { playing = !playing; reflect(); };
  // (Free: the view turned about the skier by hand, and carried along with it; only watching, as riding the pointer steers.)
  const setView = (v: typeof view) => { view = mode === 'ride' && v === 'free' ? 'behind' : v; controls.enabled = view === 'free'; camera.up.set(0, 1, 0); placed = false; reflect(); };
  const setMode = (m: typeof mode) => {
    if (m === mode) return;
    if (m === 'ride') {
      // Ridden from where the watched run had got to, going as it went.
      const s = sampleAt(t);
      Object.assign(ride, { down: s.down, left: s.left, way: s.way, speed: s.speed, facing: 0, tuck: s.tuck, tall: 0, brake: 0, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0 });
      Object.assign(ask, { x: 0, y: s.tuck });
      Object.assign(want, { x: 0, y: s.tuck, brake: false, brakeKey: false });
      showWatchTracks(null);
      clearRideTracks();
      playing = true;
    } else clearRideTracks();
    mode = m;
    clearSpray();
    setView(view);
    placed = false;
  };
  const seek = (x: number) => { const r = line.getBoundingClientRect(); t = clamp(((x - r.left) / r.width) * RUN_LENGTH, 0, RUN_LENGTH - 0.01); clearSpray(); };
  line.addEventListener('pointerdown', (e) => { scrubbing = true; line.setPointerCapture(e.pointerId); seek(e.clientX); });
  line.addEventListener('pointermove', (e) => { if (scrubbing) seek(e.clientX); });
  line.addEventListener('pointerup', () => { scrubbing = false; });
  line.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { t = clamp(t + (e.key === 'ArrowRight' ? 1 : -1), 0, RUN_LENGTH - 0.01); clearSpray(); e.preventDefault(); } });

  // Riding by the pointer: where it is against the middle of the picture, as far as the ring drawn there; by mouse wherever it is over
  // the picture, by touch where a finger is held. Let go of, the skier eases back to its plain stance, going straight.
  const pad = $('pad'), dot = pad.querySelector('.dot') as HTMLElement;
  const ringOf = () => { const r = Math.min(innerWidth, innerHeight) * 0.3; return { cx: innerWidth / 2, cy: innerHeight * 0.48, r }; };
  const point = (e: PointerEvent) => {
    if (mode !== 'ride') return;
    const { cx, cy, r } = ringOf();
    let x = (e.clientX - cx) / r, y = (cy - e.clientY) / r;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    want.x = x; want.y = y;
  };
  const letGo = () => { want.x = 0; want.y = 0; };
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) point(e); });
  canvas.addEventListener('pointerdown', (e) => { point(e); if (mode === 'ride') canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') letGo(); });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') letGo(); });
  canvas.addEventListener('pointercancel', letGo);
  brakeButton.addEventListener('pointerdown', (e) => { want.brake = true; brakeButton.setPointerCapture(e.pointerId); brakeButton.classList.add('on'); });
  const brakeOff = () => { want.brake = false; brakeButton.classList.remove('on'); };
  brakeButton.addEventListener('pointerup', brakeOff);
  brakeButton.addEventListener('pointercancel', brakeOff);
  const ARROWS: Record<string, keyof typeof want.keys> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && e.key === ' ') return;
    if (mode === 'ride' && ARROWS[e.key]) { want.keys[ARROWS[e.key]] = true; e.preventDefault(); return; }
    if (mode === 'ride' && e.key === 'Shift') { want.brakeKey = true; return; }
    const k = e.key.toLowerCase(), v = views.find((x) => x[2].toLowerCase() === k);
    if (k === ' ') { playing = !playing; reflect(); e.preventDefault(); } else if (k === 'r') setMode(mode === 'ride' ? 'watch' : 'ride'); else if (v) setView(v[1]);
  });
  window.addEventListener('keyup', (e) => { if (ARROWS[e.key]) want.keys[ARROWS[e.key]] = false; if (e.key === 'Shift') want.brakeKey = false; });
  window.addEventListener('blur', () => { for (const k of Object.keys(want.keys) as (keyof typeof want.keys)[]) want.keys[k] = false; want.brakeKey = false; letGo(); });
  const showPad = () => {
    const { cx, cy, r } = ringOf();
    pad.style.setProperty('--r', `${r}px`); pad.style.left = `${cx}px`; pad.style.top = `${cy}px`;
    dot.style.transform = `translate(${(ask.x * r).toFixed(1)}px, ${(-ask.y * r).toFixed(1)}px)`;
    pad.classList.toggle('active', Math.hypot(want.x, want.y) > 0.05 || Object.values(want.keys).some(Boolean));
  };

  // The view, following the skier: eased, so that the turns swing the skier across it rather than swinging the view. Riding, behind
  // and above look most of the way along the way it goes.
  let placed = false;
  const eye = new Vector3(), look = new Vector3(), follow = new Vector3(), lastRider = new Vector3(), ahead = FALL.clone();
  const placeView = (now: Now, dt: number) => {
    const at = rider.position;
    follow.lerp(onSlope(now.down, mode === 'ride' ? now.left : now.left * 0.35), placed ? ease(dt, 3) : 1);
    ahead.lerp(mode === 'ride' ? FALL.clone().lerp(along(now.way), 0.65).normalize() : FALL, placed ? ease(dt, 2) : 1).normalize();
    if (view === 'free') {
      if (!placed) { camera.position.copy(at).addScaledVector(UP, 3).addScaledVector(LEFT, 6).addScaledVector(FALL, -6); controls.target.copy(at); }
      else camera.position.add(at.clone().sub(lastRider));
      controls.target.copy(at).addScaledVector(UP, 0.9);
      controls.update();
    } else {
      const wantAt = new Vector3(), aim = new Vector3();
      if (view === 'behind') { wantAt.copy(follow).addScaledVector(ahead, -9).addScaledVector(UP, 3.4); aim.copy(follow).addScaledVector(ahead, 6).addScaledVector(UP, 0.6); }
      else if (view === 'beside') { wantAt.copy(follow).addScaledVector(LEFT, 11).addScaledVector(FALL, 1.5).addScaledVector(UP, 1.8); aim.copy(at).addScaledVector(UP, 0.9); }
      else { wantAt.copy(follow).addScaledVector(UP, 32).addScaledVector(ahead, -9); aim.copy(follow).addScaledVector(ahead, -9); camera.up.copy(ahead); }
      eye.lerp(wantAt, placed ? ease(dt, 4) : 1);
      look.lerp(aim, placed ? ease(dt, 5) : 1);
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
  reflect();
  $('status').hidden = true;

  let then = performance.now(), shownPart = '';
  const frame = async () => {
    const now = performance.now(), dt = Math.min(0.1, (now - then) / 1000);
    then = now;
    let at: Now;
    if (mode === 'watch') {
      if (playing && !scrubbing) {
        t += dt * rate;
        if (t >= RUN_LENGTH) { t = 0; clearSpray(); placed = false; }
      }
      at = watchPose(t);
      showWatchTracks(t);
      stepSpray(playing && !scrubbing ? dt * rate : 0, playing && !scrubbing ? at : null);
      const part = RUN_PARTS.find((p) => t >= p.from && t < p.to) ?? RUN_PARTS[RUN_PARTS.length - 1];
      if (part.label !== shownPart) { shownPart = part.label; $('part').textContent = part.label; bands.forEach((b, i) => b.classList.toggle('now', RUN_PARTS[i] === part)); }
      $('clock').textContent = `${t.toFixed(1)} s of 44`;
      head.style.left = `${(t / RUN_LENGTH) * 100}%`;
      line.setAttribute('aria-valuenow', t.toFixed(1));
    } else {
      // (Stepped in small steps, so that a slow frame does not throw the skier off its line.)
      const steps = playing ? Math.ceil(dt / (1 / 120)) : 0;
      at = { down: ride.down, left: ride.left, speed: ride.speed, way: ride.way, ski: ride.way, skid: 0, tuck: ride.tuck, brake: ride.brake };
      for (let i = 0; i < steps; i++) at = stepRide(dt / steps);
      if (!steps) standAt(ride.down, ride.left, ride.facing);
      if (playing) layRide(at);
      stepSpray(playing ? dt : 0, playing ? at : null);
      const doing = doingNow();
      if (doing !== shownPart) { shownPart = doing; $('part').textContent = doing; }
      $('clock').textContent = `${ride.time.toFixed(0)} s riding`;
      showPad();
    }
    keepSlopeAbout(at.down, at.left);
    placeView(at, dt);
    $('speed').textContent = (at.speed * 3.6).toFixed(0);
    $('down').textContent = at.down.toFixed(0);
    await renderer.renderAsync(scene, camera);
    requestAnimationFrame(frame);
  };
  // (For a script that drives the page: where it is, and to put it anywhere; riding, what the pointer would ask.)
  (window as unknown as Record<string, unknown>).__slope = {
    seek: (to: number) => { t = to; clearSpray(); placed = false; }, pause: (p: boolean) => { playing = !p; reflect(); }, setView, setMode,
    steer: (x: number, y: number) => { want.x = x; want.y = y; }, brake: (on: boolean) => { want.brake = on; }, ride: () => ({ ...ride }),
    step: (seconds: number) => { let at: Now | null = null; for (let i = 0; i < Math.round(seconds * 120); i++) at = stepRide(1 / 120); if (at) layRide(at); placed = false; return { ...ride }; },
    time: () => t, ready: true, run,
  };
  requestAnimationFrame(frame);
}

start().catch((e) => { const s = $('status'); s.hidden = false; s.textContent = `The run could not be made: ${(e as Error)?.message ?? e}`; console.error(e); });
