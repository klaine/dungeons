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
 * Ridden, the slope has kickers on it (asked: "can we add jumps/kickers to the course? riding them in tucked position causes ski jump
 * animation (but here with poles of course), middle is regular kicker jump, tall standing is a backflip? if there is turning, it can
 * mix in spin? landing badly activates ragdoll physics and player can restart run"): built jumps of snow every 130 metres, each at a
 * different place across the piste, a ramp curving up to a lip. Off the lip the skier is thrown as any body is, as far and as high
 * as its speed takes it, and what it does in the air is what it was doing as it left: tucked, a ski jumper's flight; neither tucked
 * nor standing tall, straight air, the knees drawn up; standing tall, a backflip; and turning as well, a spin with any of them, a 360
 * turning, a 720 turning hard. In the air, pointing up draws it tighter and turns it quicker, pointing down opens it out and slows the
 * turn; it opens up to land by itself. Landed short of the turn, or too hard, it goes limp (`ragdoll.ts`) and tumbles and slides down
 * the snow until it stops; *Restart run*, or Enter, starts the run again from the top.
 *
 * Either way, the skier's skis leave their tracks in the snow, carved lines thin and dark and a skid a broad pale band, with snow thrown
 * up as it brakes; watched from behind, beside, above (where the tracks' shape shows best) or, watching, from anywhere.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide,
  Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, Scene, SkinnedMesh, SRGBColorSpace, Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FigureLibrary } from '../src/figures/library';
import { putOn } from '../src/figures/gear';
import { makeDownhillRun, Rider, RUN_LENGTH, RUN_PARTS, type RunSample } from '../src/figures/alpine';
import { type Ground, type Joint, JOINTS, Ragdoll } from '../src/figures/ragdoll';
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
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const TURN = 2 * Math.PI, deg = (d: number) => (d * Math.PI) / 180;

/**
 * The kickers on the ridden slope: the foot of the first so far down it, one every so far after it, each set across the piste at its
 * own place; a ramp so long, rising to a lip so high, curving up as the power of the way along it (steepest at the lip, some twenty
 * degrees over the slope), and behind the lip a steep back down to the snow; so broad across its top, its sides sloping down.
 */
const KICK = { first: 70, every: 130, length: 7, height: 1.5, power: 1.7, back: 2.4, half: 2.5, side: 1.2 };
const kickLefts = new Map<number, number>();
const kickerLeft = (i: number) => { let v = kickLefts.get(i); if (v === undefined) { v = new Rng(`kicker ${i}`).range(-14, 14); kickLefts.set(i, v); } return v; };
/** The kicker nearest `down`, by its number. */
const kickerNear = (down: number) => Math.round((down - KICK.first - (KICK.length + KICK.back) / 2) / KICK.every);
/** A kicker's height `u` along it from its foot, and how steeply it rises there. */
const rise = (u: number): [number, number] => {
  const { length: L, height: H, power: P, back: B } = KICK;
  if (u <= 0) return [0, 0];
  if (u <= L) return [H * (u / L) ** P, ((P * H) / L) * (u / L) ** (P - 1)];
  if (u <= L + B) return [H * (1 - (u - L) / B), -H / B];
  return [0, 0];
};
/** A kicker's height at `u` along it and `x` across it from its middle; and how it rises along and across. */
const kickerShape = (u: number, x: number) => {
  const [f, df] = rise(u), ax = Math.abs(x), { half, side } = KICK;
  const s = ax <= half ? 1 : ax < half + side ? 1 - (ax - half) / side : 0, ds = ax > half && ax < half + side ? -Math.sign(x) / side : 0;
  return { h: f * s, dDown: df * s, dLeft: f * ds };
};
const FLAT = { h: 0, dDown: 0, dLeft: 0 };
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
    if (kickersOn) placeKickers(down);
  };

  // The kickers, there only when the slope is ridden. The snow's height over the slope where the skier is, and how it rises along the
  // slope and across it: on the slope itself none, on a kicker its shape.
  let kickersOn = false;
  const groundAt = (down: number, left: number) => {
    if (!kickersOn) return FLAT;
    const i = kickerNear(down);
    return i < 0 ? FLAT : kickerShape(down - (KICK.first + i * KICK.every), left - kickerLeft(i));
  };
  /** The ground under a point anywhere, for a body gone limp: how far over it the point is, and which way is up from it. */
  const groundUnder: Ground = (p) => {
    const g = groundAt(p.dot(FALL), p.dot(LEFT)), up = UP.clone().addScaledVector(FALL, -g.dDown).addScaledVector(LEFT, -g.dLeft), k = up.length();
    return { above: (p.dot(UP) - g.h) / k, up: up.divideScalar(k) };
  };
  // Each kicker drawn as its shape in snow, the lip dyed blue across its top, a flag either side of the lip; a few of them, moved to be
  // the ones about the skier.
  const kickerSurface = (u0: number, u1: number, nu: number, x0: number, x1: number, nx: number, lift: number, xs?: number[]) => {
    const across = xs ?? Array.from({ length: nx + 1 }, (_, j) => x0 + ((x1 - x0) * j) / nx), us: number[] = [];
    for (let i = 0; i <= nu; i++) us.push(u0 + ((u1 - u0) * i) / nu);
    if (u1 > KICK.length && u0 < KICK.length && !us.includes(KICK.length)) { us.push(KICK.length); us.sort((a, b) => a - b); }
    const pos: number[] = [], uv: number[] = [], index: number[] = [], w = across.length;
    for (const u of us) for (const x of across) {
      const v = onSlope(u, x, kickerShape(u, x).h + lift);
      pos.push(v.x, v.y, v.z); uv.push(x / 9, u / 9);
    }
    for (let i = 1; i < us.length; i++) for (let j = 1; j < w; j++) {
      const a = (i - 1) * w + j - 1, b = a + 1, c = a + w, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const kickerParts = (() => {
    const { length: L, back: B, half, side } = KICK;
    const xs: number[] = [];
    for (let j = 0; j <= 3; j++) xs.push(-half - side + (side * j) / 3);
    for (let j = 1; j < 12; j++) xs.push(-half + (2 * half * j) / 12);
    for (let j = 0; j <= 3; j++) xs.push(half + (side * j) / 3);
    const map = snowMap.clone(); map.repeat.set(1, 1); map.needsUpdate = true;
    const body = kickerSurface(0, L + B, 40, 0, 0, 0, 0.012, xs);
    const lip = kickerSurface(L - 0.32, L - 0.04, 3, -half, half, 12, 0.022);
    const pole = new CylinderGeometry(0.03, 0.03, 1.7, 6).translate(0, 0.85, 0);
    const flag = new BufferGeometry();
    flag.setAttribute('position', new BufferAttribute(new Float32Array([0, 1.68, 0, 0, 1.28, 0, 0, 1.48, -0.55]), 3));
    flag.computeVertexNormals();
    return {
      body, lip, pole, flag,
      snow: new MeshStandardMaterial({ color: 0xf7f9fc, map, roughness: 0.9 }),
      dye: new MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.8 }),
      wood: new MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 }),
      cloth: new MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.7, side: DoubleSide }),
    };
  })();
  const kickers = Array.from({ length: 4 }, () => {
    const g = new Group(), body = new Mesh(kickerParts.body, kickerParts.snow), lip = new Mesh(kickerParts.lip, kickerParts.dye);
    body.castShadow = body.receiveShadow = true;
    lip.receiveShadow = true;
    g.add(body, lip);
    for (const side of [-1, 1]) {
      const at = onSlope(KICK.length, side * (KICK.half + KICK.side + 0.4), 0);
      const pole = new Mesh(kickerParts.pole, kickerParts.wood), flag = new Mesh(kickerParts.flag, kickerParts.cloth);
      pole.position.copy(at); flag.position.copy(at);
      pole.castShadow = flag.castShadow = true;
      g.add(pole, flag);
    }
    g.visible = false;
    scene.add(g);
    return g;
  });
  const placeKickers = (down: number) => {
    const i0 = kickerNear(down) - 1;
    kickers.forEach((g, k) => {
      const i = i0 + k;
      g.visible = kickersOn && i >= 0;
      if (g.visible) g.position.copy(onSlope(KICK.first + i * KICK.every, kickerLeft(i)));
    });
  };
  const showKickers = (on: boolean) => { kickersOn = on; if (!on) for (const g of kickers) g.visible = false; };

  // The skier: the mannequin, posed live when ridden (`Rider`) and by the made run when watched, with its downhill skis and poles.
  const base = (window as unknown as { __figureBase?: string }).__figureBase ?? new URL('../figures/', location.href).href;
  const library = await FigureLibrary.load(base);
  const idle = library.clips.find((c) => c.name === 'Idle_Loop')!;
  const source = await library.mannequin();
  const run = makeDownhillRun(source, idle, STEP);
  const live = new Rider(source, idle), model = live.model;
  model.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; } });
  const gear = putOn(model, 'alpine');
  const rider = new Group();
  rider.add(model);
  scene.add(rider);
  const tilt = new Quaternion().setFromAxisAngle(LEFT, ANGLE);
  /**
   * Stands the skier on the slope, facing `facing` (radians to the left of straight down); or `out` over it, its nose `pitch` up (on a
   * ramp, or in the air).
   */
  const standAt = (down: number, left: number, facing: number, out = 0, pitch = 0) => {
    rider.position.copy(onSlope(down, left, out));
    rider.quaternion.copy(tilt).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facing));
    if (pitch) rider.quaternion.multiply(new Quaternion().setFromAxisAngle(LEFT, -pitch));
    rider.updateMatrixWorld(true);
  };
  // The skier's joints where they are in the world, as a body gone limp takes them: its bones', and its skis' tips and tails.
  const jointBones = JOINTS.filter((j) => !j.startsWith('tip') && !j.startsWith('tail')).map((j) => [j, model.getObjectByName(j)!] as const);
  const skiOf = (k: 'l' | 'r') => gear.find((m) => m.parent?.name === `foot_${k}`)!;
  const jointsNow = (): Record<Joint, Vector3> => {
    rider.updateMatrixWorld(true);
    const out = {} as Record<Joint, Vector3>;
    for (const [j, b] of jointBones) out[j] = b.getWorldPosition(new Vector3());
    for (const k of ['l', 'r'] as const) {
      out[`tip_${k}`] = skiOf(k).localToWorld(new Vector3(0, 0.01, 0.8));
      out[`tail_${k}`] = skiOf(k).localToWorld(new Vector3(0, 0.01, -0.78));
    }
    return out;
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
    return mid.addScaledVector(UP, -mid.dot(UP) + groundAt(mid.dot(FALL), mid.dot(LEFT)).h + 0.012);
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
      // (Thrown on along the way it goes, and out the way the skis slide sideways: to the outside of a skidded turn.)
      const go = along(now.way), skiAlong = along(now.ski), slide = go.clone().addScaledVector(skiAlong, -go.dot(skiAlong));
      for (let i = 0; i < Math.round(now.speed * 0.9); i++) {
        const f = flakes[nextFlake++ % SPRAY], from = skiOnSnow(i % 2);
        f.p.copy(from).addScaledVector(go, 0.35).addScaledVector(LEFT, sprayRng.range(-0.8, 0.8)).addScaledVector(UP, 0.04);
        f.v.copy(go).multiplyScalar(now.speed * sprayRng.range(0.5, 1)).addScaledVector(UP, sprayRng.range(1.2, 3.2)).addScaledVector(LEFT, sprayRng.range(-1.5, 1.5)).addScaledVector(slide, now.speed * sprayRng.range(0.2, 0.6));
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
   * chest stays more down the slope than its skis); how far into a tuck, standing tall and braking; its lean into the turn; its
   * poles' flicks, each a time left to run; how high it is over the slope and how fast it rises from it (on a kicker, or in the air);
   * how far it has sunk to take a landing; any turn of the whole body it is still coming out of from one; how far its turn is skidded
   * rather than carved (0 to 1); and how long an arrow key has been held to turn.
   */
  const ride = {
    down: 0, left: 0, way: 0, speed: 0, facing: 0, tuck: 0, tall: 0, brake: 0, brakeSide: 1, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0,
    out: 0, rising: 0, absorb: 0, settle: { spin: 0, flip: 0, left: 0 }, skid: 0, held: 0,
  };
  /**
   * In the air: what it is doing there (`air`, straight air; `flip`, a backflip; `flight`, a ski jumper's; `hop`, too short a time
   * in the air for anything), the spin and the flip it is to make and how far into them it is, how long it has been in the air and how
   * long it was to be, how fast it goes along the slope and across it, where it left the snow, and how far its nose was up as it did.
   */
  interface Air { kind: 'air' | 'flip' | 'flight' | 'hop'; spinTo: number; flipTo: number; spin: number; flip: number; t: number; T: number; vDown: number; vLeft: number; from: Vector3; nose: number; name: string }
  let air: Air | null = null;
  /** Gone limp, and why. */
  let crash: { body: Ragdoll; why: string } | null = null;
  /** The skier's joints as the last two steps left them, and how long the last step was: what a body gone limp goes on from. */
  let joints: Record<Joint, Vector3> | null = null, jointsBefore: Record<Joint, Vector3> | null = null, jointsDt = 1 / 120;
  /** What the rider asks: across (-1 to 1, to the right positive) and up (1 the deepest tuck, -1 standing tallest); and braking. */
  const ask = { x: 0, y: 0 }, want = { x: 0, y: 0, keys: { up: false, down: false, left: false, right: false }, brake: false, brakeKey: false };
  const FLICK = 0.3;
  /** Where across the range a turn begins to skid (it skids wholly at its end), and how far the skis are pivoted across the way then. */
  const SKID_FROM = 0.72, SKID_TURN = deg(38);
  /** The weight's pull into the slope, and along it. */
  const INTO = G * Math.cos(ANGLE), ALONG = G * Math.sin(ANGLE);
  /** How long from now until something `out` over the slope and rising at `rising` comes down onto it. */
  const timeToSnow = (out: number, rising: number) => (rising + Math.sqrt(Math.max(0, rising * rising + 2 * INTO * Math.max(0, out)))) / INTO;
  const keepJoints = (dt: number) => { if (dt <= 0) return; jointsBefore = joints; joints = jointsNow(); jointsDt = dt; };

  /** What a trick is called. */
  const trickName = (a: Air) => {
    const turns = Math.round(Math.abs(a.spinTo) / TURN), spin = turns ? `${turns * 360}` : '';
    if (a.kind === 'hop') return 'Hop';
    if (a.kind === 'flip') return spin ? `Backflip ${spin}` : 'Backflip';
    if (a.kind === 'flight') return spin ? `Flight ${spin}` : 'Ski-jump flight';
    return spin || 'Straight air';
  };
  // What has just happened, said over the picture for a while: a landing, or a fall.
  let told = { text: '', small: '', bad: false, until: 0 };
  const tell = (text: string, small: string, bad: boolean, seconds: number) => { told = { text, small, bad, until: ride.time + seconds }; };

  /** The rider's wishes eased in: across and up, the tuck and standing tall, braking. */
  const easeAsk = (dt: number) => {
    const keys = want.keys, keyed = keys.up || keys.down || keys.left || keys.right;
    // (An arrow key carves at first; held on, it pushes the turn out to the end of the range, into a skid, as the pointer does at
    // the edge of the ring.)
    ride.held = keys.left !== keys.right ? ride.held + dt : 0;
    const pushed = 0.62 + 0.38 * smooth((ride.held - 0.35) / 0.9);
    const tx = keyed ? ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * pushed : want.x, ty = keyed ? (keys.up ? 1 : 0) - (keys.down ? 1 : 0) : want.y;
    ask.x += (tx - ask.x) * ease(dt, 8);
    ask.y += (ty - ask.y) * ease(dt, 8);
    ride.tuck += (Math.max(0, ask.y) - ride.tuck) * ease(dt, 4);
    ride.tall += (Math.max(0, -ask.y) - ride.tall) * ease(dt, 4);
  };

  /**
   * Leaves the snow (the ground fell away under it faster than its weight can bring it down: off a kicker's lip, or its back): what it
   * does in the air is what it was doing as it left, if it is to be in the air long enough for anything.
   */
  const takeOff = (nose: number) => {
    const T = timeToSnow(ride.out, ride.rising), long = T > 0.5;
    const kind: Air['kind'] = !long ? 'hop' : ride.tuck > 0.55 ? 'flight' : ride.tall > 0.5 ? 'flip' : 'air';
    const turns = !long ? 0 : Math.abs(ask.x) > 0.72 ? 2 : Math.abs(ask.x) > 0.3 ? 1 : 0;
    const flat = ride.speed * Math.cos(nose);
    air = {
      kind, spinTo: -Math.sign(ask.x) * turns * TURN, flipTo: kind === 'flip' ? -TURN : 0, spin: 0, flip: 0, t: 0, T,
      vDown: flat * Math.cos(ride.way), vLeft: flat * Math.sin(ride.way), from: new Vector3(ride.down, ride.left, 0), nose, name: '',
    };
    air.name = trickName(air);
  };

  /** Comes down onto the snow: landed, if the turns are near enough made and the blow is not too hard; else gone limp. */
  const land = () => {
    const a = air!, g = groundAt(ride.down, ride.left);
    const blow = Math.max(0, -(ride.rising - g.dDown * a.vDown - g.dLeft * a.vLeft));
    const flipShort = Math.abs(a.flipTo - a.flip), spinShort = Math.abs(a.spinTo - a.spin);
    const far = Math.hypot(ride.down - a.from.x, ride.left - a.from.y);
    air = null;
    if (flipShort > deg(55) || spinShort > deg(75) || blow > 12.5) {
      const why = blow > 12.5 ? 'landed too hard' : flipShort > deg(55) ? (flipShort > deg(200) ? 'landed on its back' : 'short of the flip') : `short of the ${Math.round(Math.abs(a.spinTo) / TURN) * 360}`;
      fall(why);
      return;
    }
    ride.speed = Math.hypot(a.vDown, a.vLeft) * (blow > 9 ? 0.9 : 1);
    ride.way = Math.atan2(a.vLeft, a.vDown);
    ride.out = g.h;
    ride.rising = 0;
    ride.absorb = clamp(0.35 + blow / 10, 0, 1);
    ride.settle = { spin: a.spin - a.spinTo, flip: a.flip - a.flipTo, left: 0.25 };
    if (a.kind !== 'hop') tell(a.name, `${far.toFixed(0)} m, ${a.t.toFixed(1)} s in the air`, false, 2.6);
  };

  /** Goes limp: the body goes on as it was going, turning as it was turning, from where its joints were. */
  const fall = (why: string) => {
    const now = jointsNow();
    crash = { body: new Ragdoll(now, jointsBefore ?? now, jointsDt, groundUnder), why };
    rider.position.set(0, 0, 0);
    rider.quaternion.identity();
    rider.updateMatrixWorld(true);
    live.poseJoints(crash.body.joints());
    tell(`Crashed: ${why}`, 'Restart run with the button, or Enter', true, 1e9);
    reflect();
  };

  /** The run again from the top, going a little. */
  const restart = () => {
    Object.assign(ride, { down: 0, left: 0, way: 0, speed: 7, facing: 0, tuck: 0, tall: 0, brake: 0, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0, out: 0, rising: 0, absorb: 0, skid: 0 });
    ride.settle = { spin: 0, flip: 0, left: 0 };
    Object.assign(ask, { x: 0, y: 0 });
    air = null; crash = null; joints = jointsBefore = null;
    told = { text: '', small: '', bad: false, until: 0 };
    clearRideTracks();
    clearSpray();
    placed = false;
    reflect();
  };

  /** The skier in the air, a step on: thrown, turning as it is making its turns, opening up to land, and down. */
  const stepAir = (dt: number): Now => {
    const a = air!;
    a.t += dt;
    const v = Math.hypot(a.vDown, a.vLeft);
    a.vDown += (ALONG - 0.004 * v * a.vDown) * dt;
    a.vLeft -= 0.004 * v * a.vLeft * dt;
    ride.rising -= INTO * dt;
    ride.down += a.vDown * dt;
    ride.left = clamp(ride.left + a.vLeft * dt, -31, 31);
    ride.out += ride.rising * dt;
    ride.time += dt;
    // Opening up to land, the last few tenths of a second before the snow; a tighter tuck turns it quicker, opening out slower.
    const left = timeToSnow(ride.out - groundAt(ride.down, ride.left).h, ride.rising), open = a.kind === 'hop' ? 0 : 1 - smooth(left / 0.4);
    const quick = (1 + 0.45 * Math.max(0, ask.y) - 0.35 * Math.max(0, -ask.y)) * (1 - 0.5 * open);
    const turned = (now: number, to: number, rate: number) => {
      const short = to - now;
      if (!short) return now;
      const most = rate * TURN * dt * quick * Math.min(1, 0.3 + Math.abs(short) / 1.0) * Math.min(1, (a.t + 0.08) / 0.25);
      return now + Math.sign(short) * Math.min(Math.abs(short), most);
    };
    a.flip = turned(a.flip, a.flipTo, 1.0);
    a.spin = turned(a.spin, a.spinTo, 1.35);
    ride.facing += (ride.way - ride.facing) * ease(dt, 6);
    ride.flickL = ride.flickR = 0;
    live.poseAir({
      tuck: Math.max(0, ask.y), flight: a.kind === 'flight' ? smooth(a.t / 0.3) : 0, open,
      throw: a.kind === 'flip' ? 1 - smooth(a.t / 0.35) : 0, wrap: a.spinTo ? smooth(a.t / 0.2) : 0, ski: ride.way - ride.facing, spin: a.spin, flip: a.flip,
    });
    standAt(ride.down, ride.left, ride.facing, ride.out, a.nose * (1 - smooth(a.t / (0.75 * a.T))));
    keepJoints(dt);
    if (ride.out <= groundAt(ride.down, ride.left).h) land();
    return { down: ride.down, left: ride.left, speed: v, way: Math.atan2(a.vLeft, a.vDown), ski: ride.way, skid: 0, tuck: ride.tuck, brake: 0 };
  };

  /** Gone limp, a step on. */
  const stepFallen = (dt: number): Now => {
    const body = crash!.body, was = body.middle().clone();
    body.step(dt);
    live.poseJoints(body.joints());
    ride.time += dt;
    const at = body.middle(), went = at.clone().sub(was);
    return { down: at.dot(FALL), left: at.dot(LEFT), speed: went.length() / dt, way: ride.way, ski: ride.way, skid: 0, tuck: 0, brake: 0 };
  };

  const stepRide = (dt: number): Now => {
    easeAsk(dt);
    if (crash) return stepFallen(dt);
    if (air) return stepAir(dt);
    const braking = want.brake || want.brakeKey;
    if (braking && ride.brake < 0.05) ride.brakeSide = Math.sign(ride.way || ride.lean) || 1;
    ride.brake += ((braking ? 1 : 0) - ride.brake) * ease(dt, 6);
    // Turning: quicker the faster (a carving ski holds its own curve, some twenty metres across at speed), if never too slowly to come
    // round; wider tucked; none while braking. Pushed out to the ends of the range (asked: "also extreme control range ends with right
    // and/or left turns should make the turns skidded instead of carved"), the turn is skidded: the skis pivoted across the way they
    // go, their tails sliding out, so that the turn comes round quicker than a carve can, flatter on the snow and less leant, scraping
    // and throwing snow and losing speed as it does.
    ride.skid += (smooth((Math.abs(ask.x) - SKID_FROM) / (0.97 - SKID_FROM)) * (1 - ride.brake) - ride.skid) * ease(dt, 5);
    const turning = -ask.x * clamp(ride.speed / 9, 0.5, 1.2) * (1 - 0.35 * ride.tuck) * (1 - ride.brake) * (1 + 0.6 * ride.skid);
    const pivot = Math.sign(turning) * SKID_TURN * ride.skid;
    ride.way = clamp(ride.way + turning * dt, -1.9, 1.9);
    // The piste's edges, its poles thirty metres out: turned back towards the middle near them, and kept off the trees.
    if (Math.abs(ride.left) > 25 && Math.sign(ride.way) === Math.sign(ride.left)) ride.way -= Math.sign(ride.way) * Math.min(Math.abs(ride.way), dt * 2.2);
    // Its speed: its weight down the slope as much as its skis point down it, less the snow's friction, the air's drag (much less
    // tucked, more standing tall), a little lost to every turn, and a great deal to braking; and, going up a kicker, its weight back
    // down the ramp.
    const g0 = groundAt(ride.down, ride.left), nose = Math.atan(g0.dDown * Math.cos(ride.way) + g0.dLeft * Math.sin(ride.way));
    const drag = 0.0065 + (0.0037 - 0.0065) * ride.tuck + (0.012 - 0.0065) * ride.tall;
    const pull = ALONG * Math.cos(ride.way) - 0.04 * INTO - drag * ride.speed ** 2 - 0.05 * Math.abs(turning) * ride.speed - 7 * ride.brake - 6 * Math.abs(Math.sin(pivot)) - INTO * Math.sin(nose);
    ride.speed = Math.max(0, ride.speed + pull * dt);
    ride.down += ride.speed * Math.cos(nose) * Math.cos(ride.way) * dt;
    ride.left = clamp(ride.left + ride.speed * Math.cos(nose) * Math.sin(ride.way) * dt, -31, 31);
    ride.time += dt;
    // Over the snow as high as the snow is; unless it falls away faster than the skier's weight can bring it down after it, and the
    // skier leaves it.
    const g1 = groundAt(ride.down, ride.left), thrown = ride.out + ride.rising * dt - 0.5 * INTO * dt * dt;
    if (g1.h < thrown - 1e-4) {
      ride.out = thrown;
      ride.rising -= INTO * dt;
      takeOff(nose);
      return stepAir(0);
    }
    ride.rising = (g1.h - ride.out) / dt;
    ride.out = g1.h;
    // The lean into the turn that speed and turning ask, as `makeDownhillRun` reckons it; and the inside pole flicked as a turn begins.
    const lean = clamp(Math.atan((ride.speed * turning) / G) / ((48 * Math.PI) / 180), -1.3, 1.3) * (1 - ride.brake) * (1 - 0.4 * ride.skid);
    ride.lean += (lean - ride.lean) * ease(dt, 10);
    const side = Math.abs(ride.lean) > 0.2 ? Math.sign(ride.lean) : 0;
    if (side && side !== ride.leanSide) { if (side > 0) ride.flickL = FLICK; else ride.flickR = FLICK; }
    if (side) ride.leanSide = side;
    ride.flickL = Math.max(0, ride.flickL - dt);
    ride.flickR = Math.max(0, ride.flickR - dt);
    const bump = (left: number) => (left > 0 ? Math.sin((Math.PI * (FLICK - left)) / FLICK) : 0) * (1 - ride.tuck);
    ride.facing += (0.5 * ride.way - ride.facing) * ease(dt, 2);
    const ski = ride.way + pivot + ((ride.brakeSide * 78 * Math.PI) / 180) * ride.brake;
    // Sunk into a landing, coming up out of it; crouched going up a kicker's ramp, the more the steeper; and out of what is left of
    // a turn of the whole body.
    ride.absorb = Math.max(ride.out > 0.05 ? 0.5 * clamp(Math.sin(nose) / 0.34, 0, 1) : 0, ride.absorb - dt * 1.6);
    const settling = smooth(ride.settle.left / 0.25);
    ride.settle.left = Math.max(0, ride.settle.left - dt);
    live.pose({
      s: ride.lean, ski: ski - ride.facing, tuck: ride.tuck, brake: ride.brake, tall: ride.tall, flickL: bump(ride.flickL), flickR: bump(ride.flickR),
      absorb: ride.absorb, spin: ride.settle.spin * settling, flip: ride.settle.flip * settling, skid: ride.skid,
    });
    standAt(ride.down, ride.left, ride.facing, ride.out, nose);
    keepJoints(dt);
    return { down: ride.down, left: ride.left, speed: ride.speed, way: ride.way, ski, skid: Math.abs(Math.sin(ski - ride.way)), tuck: ride.tuck, brake: ride.brake };
  };
  /** What the ridden skier is doing, in words. */
  const doingNow = () => {
    if (crash) return crash.body.still > 0.5 ? 'Down in the snow' : 'Tumbling';
    if (air) return air.kind === 'hop' ? 'In the air' : `${air.name}…`;
    if (ride.brake > 0.5) return 'Braking';
    if (ride.speed < 0.5) return 'Standing';
    if (ride.out > 0.05) return 'Up the kicker';
    const turn = Math.abs(ask.x) > 0.15 ? (ask.x < 0 ? 'turning left' : 'turning right') : '';
    if (ride.skid > 0.5) return `${ride.tuck > 0.5 ? 'Tucked, skidding' : 'Skidding'} ${turn.split(' ')[1]}`;
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
  const brakeButton = $('brake'), restartButton = $('restart');
  restartButton.onclick = () => restart();
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
    $('brakes').hidden = $('pad').hidden = $('restarts').hidden = mode === 'watch';
    restartButton.classList.toggle('on', !!crash);
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
      showKickers(true);
      // (Not to begin in a kicker's snow, if the watched run had got to where one stands.)
      ride.out = groundAt(ride.down, ride.left).h;
      ride.rising = ride.absorb = ride.skid = 0;
      ride.settle = { spin: 0, flip: 0, left: 0 };
    } else { clearRideTracks(); showKickers(false); }
    air = null; crash = null; joints = jointsBefore = null;
    told = { text: '', small: '', bad: false, until: 0 };
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
    if (mode === 'ride' && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { restart(); e.preventDefault(); return; }
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

  // The view, following the skier. It keeps pace with the skier exactly down the slope, and eases only what the view does about it: how
  // far across the slope it follows (so that the turns swing the skier across the picture rather than swinging the view), which way it
  // looks along, and the change from one view to another. (Eased whole, the view had trailed the skier by its speed over the easing's
  // rate, twice over: some twelve metres at speed, so that from beside and above the skier ran ahead of the picture.) Riding, behind
  // and above look most of the way along the way it goes.
  let placed = false;
  const eyeOff = new Vector3(), lookOff = new Vector3(), lastRider = new Vector3(), ahead = FALL.clone();
  let across = 0;
  /** Where the view is about: the skier's feet, or, gone limp, the snow under its hips. */
  const focus = () => { if (!crash) return rider.position.clone(); const p = crash.body.middle(); return onSlope(p.dot(FALL), p.dot(LEFT)); };
  const placeView = (now: Now, dt: number) => {
    const at = focus();
    across += ((mode === 'ride' ? 1 : 0.35) * now.left - across) * (placed ? ease(dt, 3) : 1);
    const follow = onSlope(now.down, across);
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
      // (From above, looking a little behind the skier, so that it is in the upper part of the picture with its tracks below it.)
      else { wantAt.copy(follow).addScaledVector(UP, 32).addScaledVector(ahead, -5); aim.copy(follow).addScaledVector(ahead, -5); camera.up.copy(ahead); }
      eyeOff.lerp(wantAt.sub(at), placed ? ease(dt, 5) : 1);
      lookOff.lerp(aim.sub(at), placed ? ease(dt, 6) : 1);
      camera.position.copy(at).add(eyeOff);
      camera.lookAt(at.clone().add(lookOff));
    }
    lastRider.copy(at);
    placed = true;
    sun.position.copy(at).addScaledVector(sunFrom, 50);
    sun.target.position.copy(at);
  };

  // What has just happened, over the picture.
  const toldBox = $('told'), toldText = toldBox.querySelector('.text') as HTMLElement, toldSmall = toldBox.querySelector('.small') as HTMLElement;
  let toldShown = '';
  const showTold = () => {
    const on = mode === 'ride' && !!told.text && ride.time < told.until, key = on ? `${told.text}|${told.small}|${told.bad}` : '';
    if (key === toldShown) return;
    toldShown = key;
    toldBox.classList.toggle('shown', on);
    document.body.classList.toggle('telling', on);
    toldBox.classList.toggle('bad', told.bad);
    if (on) { toldText.textContent = told.text; toldSmall.textContent = told.small; }
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
      const p = focus();
      at = { down: p.dot(FALL), left: p.dot(LEFT), speed: crash ? 0 : ride.speed, way: ride.way, ski: ride.way, skid: 0, tuck: ride.tuck, brake: ride.brake };
      for (let i = 0; i < steps; i++) at = stepRide(dt / steps);
      const onSnow = !air && !crash;
      if (playing && onSnow) layRide(at);
      stepSpray(playing ? dt : 0, playing && onSnow ? at : null);
      const doing = doingNow();
      if (doing !== shownPart) { shownPart = doing; $('part').textContent = doing; }
      $('clock').textContent = `${ride.time.toFixed(0)} s riding`;
      showPad();
    }
    keepSlopeAbout(at.down, at.left);
    placeView(at, dt);
    showTold();
    $('speed').textContent = (at.speed * 3.6).toFixed(0);
    $('down').textContent = at.down.toFixed(0);
    await renderer.renderAsync(scene, camera);
    requestAnimationFrame(frame);
  };
  // (For a script that drives the page: where it is, and to put it anywhere; riding, what the pointer would ask.)
  (window as unknown as Record<string, unknown>).__slope = {
    seek: (to: number) => { t = to; clearSpray(); placed = false; }, pause: (p: boolean) => { playing = !p; reflect(); }, setView, setMode,
    steer: (x: number, y: number) => { want.x = x; want.y = y; }, brake: (on: boolean) => { want.brake = on; }, ride: () => ({ ...ride }),
    // (Where the skier's hips are in the picture: -1 to 1 across and up it, 0 its middle.)
    onScreen: () => { const p = focus().addScaledVector(UP, 0.9).project(camera); return [+p.x.toFixed(2), +p.y.toFixed(2)]; },
    step: (seconds: number) => { let at: Now | null = null; for (let i = 0; i < Math.round(seconds * 120); i++) at = stepRide(1 / 120); if (at && !air && !crash) layRide(at); placed = false; return { ...ride }; },
    // (Riding: what is happening in the air or on the ground, the kickers, and to put the skier anywhere going anyhow.)
    state: () => ({ air: air && { ...air }, crash: crash && { why: crash.why, still: crash.body.still, at: crash.body.middle().toArray() }, told: { ...told } }),
    kicker: (i: number) => ({ down: KICK.first + i * KICK.every, left: kickerLeft(i), length: KICK.length }),
    put: (o: Partial<typeof ride>) => { Object.assign(ride, o); placed = false; },
    restart, time: () => t, ready: true, run,
  };
  requestAnimationFrame(frame);
}

start().catch((e) => { const s = $('status'); s.hidden = false; s.textContent = `The run could not be made: ${(e as Error)?.message ?? e}`; console.error(e); });
