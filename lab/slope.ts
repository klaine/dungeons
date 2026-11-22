/**
 * A run down a world's mountainside or a groomed slope (`lab/slope.html`), watched or ridden.
 *
 * Watched (asked: "make the demo run be such that it hits tricks in the jumps: 720, backflip, backflip 360, tucked jump; both with
 * human and horse skiers"): the run ridden as below, by a pilot in place of the pointer, and kept to be played back: carving down
 * between the kickers, and off the four of them a 720, a backflip, a backflip with a 360 and a ski jumper's flight, then on to the foot
 * of the run; moved about in by the timeline of its parts, played at its own speed or slower. (It began as the downhill turns of
 * `src/figures/alpine.ts` driven by what a skier does over some forty seconds, `makeDownhillRun`, with no kickers.)
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
 * up as it brakes; seen from behind, beside, above (where the tracks' shape shows best) or, watching, from anywhere.
 *
 * Where (asked: "now lets make this have a 100m wide nearland slice of our actual winter gameworld starting on high slopes at suitable
 * location, no buildings or locations"): a run found in the game's world, `w2` (`?world=` another, for which `tools/skiRun.ts` has
 * made a slice), down from the foot of its range across the upland below, a hundred metres broad, in winter (`slopeLand.ts`); or, with
 * `?land=groomed`, the groomed slope the page began with, a plane at sixteen degrees going on for ever. Everything that moves is
 * worked out in the world's own terms, over whatever land it is on: where it is, east and south, and how high the snow is there; the
 * pull of its weight down whatever way the snow falls under it; thrown off a kicker or a knoll as any body is, and landing on the
 * land as it lies. The run's line is only for the edges, the views and where the kickers stand.
 */
import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide,
  Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PCFSoftShadowMap, PerspectiveCamera, Quaternion, RepeatWrapping, Scene, SkinnedMesh, SRGBColorSpace, Vector3,
} from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { abs, float, Fn, If, int, length, Loop, max, min, mix, mrt, output, pass, renderOutput, screenSize, smoothstep, uniform, uv, vec2, vec4, velocity } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FigureLibrary } from '../src/figures/library';
import { putOn } from '../src/figures/gear';
import { type AirControls, type RideControls, Rider } from '../src/figures/alpine';
import { type BodySpec, type Ground, HUMAN, humanSpec, JOINTS, Ragdoll } from '../src/figures/ragdoll';
import { Horse, horseAirPose, horseRidePose, type HorseSkis, saddlePose } from '../src/figures/horse';
import { Rng } from '../src/core/rng';
import { readSlice } from '../src/core/skiSlice';
import { type Frame, type GameLook, groomedLand, type Land, sliceLand } from './slopeLand';
import { doneGenerating, generateTextureSet } from '../src/render/textures';
import { farUniforms, makeFarMaterial, makeSnowMaterial, siteUniforms, snowUniforms } from '../src/render/siteMaterial';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const query = new URLSearchParams(location.search);

const G = 9.81, UP = new Vector3(0, 1, 0);
/** Along the run (where it goes at `f`) and to its left, level. */
const runDir = (f: { dx: number; dz: number }) => new Vector3(f.dx, 0, f.dz), runLeft = (f: { dx: number; dz: number }) => new Vector3(f.dz, 0, -f.dx);
/** Which way, level, a skier goes whose way is `way` (radians to the left of the run's own way at `f`). */
const along = (way: number, f: { dx: number; dz: number }) => runDir(f).multiplyScalar(Math.cos(way)).addScaledVector(runLeft(f), Math.sin(way));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const TURN = 2 * Math.PI, deg = (d: number) => (d * Math.PI) / 180;
/** A soft round blot on a tile of `size` that repeats: drawn again across each edge it crosses, so that the tile shows no seams. */
const blot = (g: CanvasRenderingContext2D, size: number, colour: string, x: number, y: number, r: number) => {
  g.fillStyle = colour;
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    if (x + dx + r < 0 || x + dx - r > size || y + dy + r < 0 || y + dy - r > size) continue;
    g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill();
  }
};

/**
 * The kickers on the ridden slope: the foot of the first so far down it, one every so far after it, each set across the piste at its
 * own place; a ramp so long, rising to a lip so high, curving up as the power of the way along it (steepest at the lip, some twenty
 * degrees over the slope), and behind the lip a steep back down to the snow; so broad across its top, its sides sloping down. On a
 * world's run, each is put where the land after it falls away enough to land on, up to `shift` further down than its turn.
 */
const KICK = { first: 70, every: 130, length: 7, height: 1.5, power: 1.7, back: 2.4, half: 2.5, side: 1.2, shift: 60 };
const kickLefts = new Map<number, number>();
const kickerLeft = (i: number, most = 14) => { let v = kickLefts.get(i); if (v === undefined) { v = new Rng(`kicker ${i}`).range(-1, 1); kickLefts.set(i, v); } return v * most; };
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
/** The demo run's frames are kept a thirtieth of a second apart. */
const STEP = 1 / 30;

/** Where the skier is and what it is doing, now: watched or ridden. */
interface Now { down: number; left: number; speed: number; way: number; ski: number; skid: number; tuck: number; brake: number }

async function start() {
  const canvas = $<HTMLCanvasElement>('view');
  // (Its picture is drawn through a pipeline of its own, smoothed there: the canvas's own four times over is not wanted.)
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: query.has('webgl') });
  await renderer.init();
  // (How finely: see *Resolution*, below.)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  scene.background = new Color(0xa9c8e8);
  const camera = new PerspectiveCamera(50, 1, 0.1, 1200);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;

  // Light: the sky's, and a sun low across the slope, so that the snow has a grain and the skier a shadow.
  const sky = new HemisphereLight(0xd6e6ff, 0xf3f6fb, 1.15);
  scene.add(sky);
  const sun = new DirectionalLight(0xfff4e6, 2.3);
  const sunFrom = new Vector3(-0.55, 0.75, -0.35).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // The snow: groomed corduroy faintly lined along the run, a little uneven in tone; and loose snow off the run, unlined.
  const snowMap = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!, rng = new Rng('snow');
    g.fillStyle = '#f2f5f9'; g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 4) { g.fillStyle = `rgba(150,170,200,${0.05 + rng.range(0, 0.04)})`; g.fillRect(x, 0, 1.5, 512); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '160,180,210'},${rng.range(0.15, 0.4)})`; g.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(1, 3), rng.range(1, 3)); }
    for (let i = 0; i < 24; i++) blot(g, 512, `rgba(170,190,215,${rng.range(0.008, 0.02)})`, rng.range(0, 512), rng.range(0, 512), rng.range(60, 160));
    const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const powderMap = (() => {
    // (Faint, and fine: any blotch or grain that stands out shows the tile repeating, seen from far off or from above.)
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!, rng = new Rng('powder');
    g.fillStyle = '#f4f7fb'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 70; i++) blot(g, 512, `rgba(165,185,212,${rng.range(0.008, 0.022)})`, rng.range(0, 512), rng.range(0, 512), rng.range(25, 120));
    for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${rng.chance(0.6) ? '255,255,255' : '170,188,214'},${rng.range(0.08, 0.22)})`; g.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(0.8, 2), rng.range(0.8, 2)); }
    const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();

  // The land: a world's run, from its slice beside the page; or the groomed slope (`?land=groomed`, or when the slice cannot be had).
  // (Its slice is fetched from beside the page, or, in a page made whole, carried in it.)
  type LandKind = 'world' | 'groomed';
  const world = query.get('world') ?? 'w2', lands = new Map<string, Land>();
  // The world's run drawn with the game's own materials for land, in their lighter winter forms (`GameLook`; *Snow*, `?snow=plain`
  // for the plain look the page had before). Their textures are painted when first wanted, at 512 (`?tex=` another size).
  type SnowLook = 'game' | 'plain';
  let snowLook: SnowLook = query.get('snow') === 'plain' ? 'plain' : 'game', gameLook: GameLook | null = null;
  const gameLookOf = (): GameLook => {
    if (gameLook) return gameLook;
    const size = Number(query.get('tex')) || 512;
    const turf = generateTextureSet('ground', size, 17), scree = generateTextureSet('scree', size, 23);
    doneGenerating();
    // (A whole winter: snow wherever the ground holds it, near and far; and the sky's light, which no bake brings here, as the game
    // has it before its bake arrives.)
    snowUniforms.uSnow.value = 1;
    farUniforms.uFarSnow.value = 1;
    const skyLight: [number, number, number] = [0.6, 0.68, 0.8];
    siteUniforms.uFallback.value.set(...skyLight);
    gameLook = { snow: makeSnowMaterial(turf, scree), far: makeFarMaterial({ light: query.get('relief') !== '1' }), sky: skyLight };
    return gameLook;
  };
  let sliceText: string | null | undefined;
  const landOf = async (kind: LandKind): Promise<Land> => {
    const key = kind === 'world' ? `world:${snowLook}` : kind;
    let made = lands.get(key);
    if (made) return made;
    if (kind === 'world') {
      const carried = (window as unknown as { __slopeFiles?: Record<string, string> }).__slopeFiles?.[`${world}.json`];
      const base = (window as unknown as { __slopeBase?: string }).__slopeBase ?? new URL('../slopes/', location.href).href;
      if (sliceText === undefined) sliceText = carried ?? await fetch(`${base}${world}.json`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
      // (Without its slice, the groomed slope.)
      made = sliceText ? sliceLand(readSlice(sliceText), snowMap, powderMap, snowLook === 'game' ? gameLookOf() : undefined) : await landOf('groomed');
    } else made = groomedLand(snowMap);
    lands.set(key, made);
    return made;
  };
  let landKind: LandKind = query.get('land') === 'groomed' || location.hash === '#groomed' ? 'groomed' : 'world';
  $('status').textContent = landKind === 'world' ? `Laying the snow on the run in ${world}…` : 'Making the run…';
  await new Promise((r) => setTimeout(r, 30));
  let land = await landOf(landKind);
  /** Shows a land: its snow and country, and the air's haze as far as it reaches. */
  const showLand = () => {
    for (const l of lands.values()) l.group.removeFromParent();
    scene.add(land.group);
    // (A world's mountainside is lit by a lower sun and less of the sky, so that its slopes shade one from another: lit as the groomed
    // slope is, its snow was white all over and its shape could not be read.)
    sunFrom.set(...land.sun).normalize();
    sky.intensity = land.sky;
    scene.fog = new Fog(0xc9dcee, land.fog[0], land.fog[1]);
    camera.far = land.fog[1] + 400;
    camera.updateProjectionMatrix();
    canvas.setAttribute('aria-label', land.length === Infinity ? 'A skier going down a groomed slope' : `A skier going down a run ${land.about}, ${land.name}`);
  };
  showLand();

  // The kickers, watched and ridden: each where the land lets it stand (`Land.kickable`), its shape laid on the land
  // as it lies there; a few about the skier at a time. The snow's height anywhere is the land's, with a kicker's on it where there is one.
  let kickersOn = false;
  interface Kicker { i: number; s: number; left: number; x: number; z: number; dx: number; dz: number; group?: Group }
  const kickerAt = new Map<number, Kicker | null>();
  const kickerOf = (i: number): Kicker | null => {
    if (kickerAt.has(i)) return kickerAt.get(i)!;
    let k: Kicker | null = null;
    const length = KICK.length + KICK.back;
    for (let shift = 0; shift <= (land.length === Infinity ? 0 : KICK.shift) && !k; shift += 6) {
      // (Across the skiable path at its own place, a few metres in from either edge.)
      const s = KICK.first + i * KICK.every + shift, [lo, hi] = land.edges(s), left = (lo + hi) / 2 + kickerLeft(i, Math.min(14, (hi - lo) / 2 - 6));
      if (land.kickable(s, left, length)) { const p = land.at(s, left); k = { i, s, left, ...p }; }
    }
    kickerAt.set(i, k);
    return k;
  };
  let kicks: Kicker[] = [];
  /** A kicker's height at a point, if one is under it. */
  const bumpAt = (x: number, z: number) => {
    let h = 0;
    for (const k of kicks) { const rx = x - k.x, rz = z - k.z; h = Math.max(h, kickerShape(rx * k.dx + rz * k.dz, rx * k.dz - rz * k.dx).h); }
    return h;
  };
  /** The snow's height at a point, and how it rises east and south there (over `e` metres); and which way is up from it. */
  const ground = (x: number, z: number) => land.height(x, z) + bumpAt(x, z);
  const slopeAt = (x: number, z: number, e = 0.3): [number, number] => [(ground(x + e, z) - ground(x - e, z)) / (2 * e), (ground(x, z + e) - ground(x, z - e)) / (2 * e)];
  const normalAt = (x: number, z: number, e = 0.3) => { const [gx, gz] = slopeAt(x, z, e); return new Vector3(-gx, 1, -gz).normalize(); };
  /** The ground under a point anywhere, for a body gone limp: how far over it the point is, and which way is up from it. */
  const groundUnder: Ground = (p) => {
    const up = normalAt(p.x, p.z);
    return { above: (p.y - ground(p.x, p.z)) * up.y, up };
  };
  // Each kicker drawn as its shape in snow on the land under it, the lip dyed blue across its top, a flag either side of the lip.
  const kickerSurface = (k: Kicker, u0: number, u1: number, nu: number, x0: number, x1: number, nx: number, lift: number, xs?: number[]) => {
    const across = xs ?? Array.from({ length: nx + 1 }, (_, j) => x0 + ((x1 - x0) * j) / nx), us: number[] = [];
    for (let i = 0; i <= nu; i++) us.push(u0 + ((u1 - u0) * i) / nu);
    if (u1 > KICK.length && u0 < KICK.length && !us.includes(KICK.length)) { us.push(KICK.length); us.sort((a, b) => a - b); }
    const pos: number[] = [], uv: number[] = [], index: number[] = [], w = across.length;
    for (const u of us) for (const x of across) {
      const px = k.x + k.dx * u + k.dz * x, pz = k.z + k.dz * u - k.dx * x;
      pos.push(px, land.height(px, pz) + kickerShape(u, x).h + lift, pz); uv.push(x / 9, u / 9);
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
    const pole = new CylinderGeometry(0.03, 0.03, 1.7, 6).translate(0, 0.85, 0);
    const flag = new BufferGeometry();
    flag.setAttribute('position', new BufferAttribute(new Float32Array([0, 1.68, 0, 0, 1.28, 0, 0, 1.48, -0.55]), 3));
    flag.computeVertexNormals();
    const map = snowMap.clone(); map.repeat.set(1, 1); map.needsUpdate = true;
    return {
      pole, flag,
      snow: new MeshStandardMaterial({ color: 0xf7f9fc, map, roughness: 0.9 }),
      dye: new MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.8 }),
      wood: new MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 }),
      cloth: new MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.7, side: DoubleSide }),
    };
  })();
  const buildKicker = (k: Kicker) => {
    const { length: L, back: B, half, side } = KICK, xs: number[] = [];
    for (let j = 0; j <= 3; j++) xs.push(-half - side + (side * j) / 3);
    for (let j = 1; j < 12; j++) xs.push(-half + (2 * half * j) / 12);
    for (let j = 0; j <= 3; j++) xs.push(half + (side * j) / 3);
    const g = new Group(), body = new Mesh(kickerSurface(k, 0, L + B, 40, 0, 0, 0, 0.012, xs), kickerParts.snow), lip = new Mesh(kickerSurface(k, L - 0.32, L - 0.04, 3, -half, half, 12, 0.022), kickerParts.dye);
    body.castShadow = body.receiveShadow = true;
    lip.receiveShadow = true;
    g.add(body, lip);
    for (const s of [-1, 1]) {
      const x = s * (half + side + 0.4), px = k.x + k.dx * L + k.dz * x, pz = k.z + k.dz * L - k.dx * x;
      const pole = new Mesh(kickerParts.pole, kickerParts.wood), flag = new Mesh(kickerParts.flag, kickerParts.cloth);
      pole.position.set(px, land.height(px, pz), pz); flag.position.copy(pole.position);
      // (The flag flies back up the run, as the old slope's did.)
      flag.rotation.y = Math.atan2(k.dx, k.dz);
      pole.castShadow = flag.castShadow = true;
      g.add(pole, flag);
    }
    scene.add(g);
    k.group = g;
  };
  /** The kickers about `s`: one behind, the next two ahead; built when first come near, and let go of once far behind. */
  const placeKickers = (s: number) => {
    const i0 = Math.floor((s - KICK.first) / KICK.every) - 1, near: Kicker[] = [];
    for (let i = Math.max(0, i0); i <= i0 + 3; i++) { const k = kickerOf(i); if (k && k.s < land.length) near.push(k); }
    for (const k of kickerAt.values()) if (k?.group && !near.includes(k)) {
      k.group.removeFromParent();
      k.group.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.geometry !== kickerParts.pole && m.geometry !== kickerParts.flag) m.geometry.dispose(); });
      k.group = undefined;
    }
    if (kickersOn) for (const k of near) if (!k.group) buildKicker(k);
    kicks = kickersOn ? near : [];
  };
  const showKickers = (on: boolean) => { kickersOn = on; placeKickers(ride.down); };

  // The skier: the adventurer, posed live (`Rider`), ridden or as the demo run was kept, with its downhill skis and poles.
  const base = (window as unknown as { __figureBase?: string }).__figureBase ?? new URL('../figures/', location.href).href;
  const library = await FigureLibrary.load(base);
  const idle = library.clips.find((c) => c.name === 'Idle_Loop')!;
  // (The skier, and a horse's rider, an adventurer: a ranger's clothes on a base body, `src/figures/outfit.ts`; `?body=mannequin`
  // for the plain mannequin, or any other body's name.)
  const source = await library.source(query.get('body') ?? 'adventurer');
  const live = new Rider(source, idle), model = live.model;
  const shade = (m: Object3D) => m.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; } });
  shade(model);
  const gear = putOn(model, 'alpine');
  // The horse (asked: "a rigged horse model; fantasy/imaginary way for the horse have skis, two bindings per ski - left and right ski
  // (or as an option for horse skiing: four short skis!); same skiing actions, tricks and animations adapted for this skiing horse;
  // with a rider on back or just the horse skiing option"), on a long pair of skis or four short ones (`src/figures/horse.ts`); and the
  // rider for its back, another mannequin, with poles long enough to reach the snow from the saddle.
  const horse = new Horse(query.get('skis') === 'four' ? 'four' : 'pair');
  const jockey = new Rider(source, idle);
  shade(jockey.model);
  putOn(jockey.model, 'mounted');
  const rider = new Group();
  scene.add(rider);
  const basis = new Matrix4();
  /**
   * Stands the skier at `p`, upright to `up` (the snow's, under it), facing `facing` (radians to the left of the run's way at `f`);
   * its nose `pitch` further up (just off a kicker's lip, in the air).
   */
  const standAt = (p: Vector3, up: Vector3, facing: number, f: Frame | { dx: number; dz: number }, pitch = 0) => {
    const ahead = along(facing, f), fwd = ahead.addScaledVector(up, -ahead.dot(up)).normalize(), side = up.clone().cross(fwd).normalize();
    rider.position.copy(p);
    rider.quaternion.setFromRotationMatrix(basis.makeBasis(side, up, fwd));
    if (pitch) rider.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch));
    rider.updateMatrixWorld(true);
  };
  // A person's joints where they are in the world, as a body gone limp takes them: its bones', and its skis' tips and tails.
  const humanJoints = (m: Object3D, skis: Object3D[] | null): Record<string, Vector3> => {
    rider.updateMatrixWorld(true);
    const out: Record<string, Vector3> = {};
    for (const j of JOINTS) if (!j.startsWith('tip') && !j.startsWith('tail')) out[j] = m.getObjectByName(j)!.getWorldPosition(new Vector3());
    if (skis) (['l', 'r'] as const).forEach((k, i) => {
      out[`tip_${k}`] = skis[i].localToWorld(new Vector3(0, 0.01, 0.8));
      out[`tail_${k}`] = skis[i].localToWorld(new Vector3(0, 0.01, -0.78));
    });
    return out;
  };
  const personSkis = (['l', 'r'] as const).map((k) => gear.find((m) => m.parent?.name === `foot_${k}`)!);
  /** Puts a spot on the snow (or on a kicker's), a finger's breadth over it. */
  const onSnow = (p: Vector3) => { p.y = ground(p.x, p.z) + 0.02; return p; };
  const feet = ['foot_l', 'foot_r'].map((n) => model.getObjectByName(n)!), toes = ['ball_l', 'ball_r'].map((n) => model.getObjectByName(n)!);

  /**
   * What is skiing, and what it is asked to do: posed for the ride and for the air (the demo run's frames keep how it was posed); how far its body faces round
   * with its way (a person's chest stays down the slope, a horse goes where its skis go); where each of its skis is (the middles, to lay
   * their tracks from); and the bodies it is made of, for a fall (a horse and its rider are two, and part).
   */
  interface Body { spec: BodySpec; joints(): Record<string, Vector3>; poseJoints(p: Record<string, Vector3>): void }
  interface Skier { object: Object3D; facing: number; ride(c: RideControls): void; air(c: AirControls): void; skis(): Vector3[]; bodies(): Body[] }
  type Who = 'person' | 'horse' | 'mounted';
  const personBody: Body = { spec: HUMAN, joints: () => humanJoints(model, personSkis), poseJoints: (p) => live.poseJoints(p) };
  const horseBody: Body = { get spec() { return horse.spec(); }, joints: () => horse.joints(), poseJoints: (p) => horse.poseJoints(p) };
  const jockeyBody: Body = { spec: humanSpec(false), joints: () => humanJoints(jockey.model, null), poseJoints: (p) => jockey.poseJoints(p) };
  const airSaddle = (c: AirControls) => saddlePose({ s: 0, brake: 0, tall: 0, flickL: 0, flickR: 0, ...c });
  const skiers: Record<Who, Skier> = {
    person: {
      object: model, facing: 0.5,
      ride: (c) => live.pose(c), air: (c) => live.poseAir(c),
      skis: () => [0, 1].map((k) => feet[k].getWorldPosition(new Vector3()).add(toes[k].getWorldPosition(new Vector3())).multiplyScalar(0.5)),
      bodies: () => [personBody],
    },
    horse: {
      object: horse.model, facing: 0.85,
      ride: (c) => horse.pose(horseRidePose(c)), air: (c) => horse.pose(horseAirPose(c, horse.skis === 'four')),
      skis: () => horse.skiMiddles(), bodies: () => [horseBody],
    },
    mounted: {
      object: horse.model, facing: 0.85,
      ride: (c) => { horse.pose(horseRidePose(c)); jockey.posePose(saddlePose(c)); },
      air: (c) => { horse.pose(horseAirPose(c, horse.skis === 'four')); jockey.posePose(airSaddle(c)); },
      skis: () => horse.skiMiddles(), bodies: () => [horseBody, jockeyBody],
    },
  };
  let who: Who = (['horse', 'mounted'] as Who[]).find((w) => w === query.get('skier')) ?? 'person', skier = skiers[who];
  /** The rider back in its saddle, if there is one. */
  const seat = () => { if (who === 'mounted') horse.saddle.add(jockey.model); else jockey.model.removeFromParent(); horse.setTack(who === 'mounted'); };
  /** The reins from the bit to the rider's hands, as they are now; none once the rider is thrown. */
  const reinsNow = () => { if (who === 'mounted') { rider.updateMatrixWorld(true); horse.setReins(crash ? null : ['hand_l', 'hand_r'].map((n) => jockey.model.getObjectByName(n)!.getWorldPosition(new Vector3()))); } };
  rider.add(skier.object);
  seat();


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
  /** Writes the `j`th step of a strip: the ski's middle, the way it went (against the run's way at `f`), and how broad it is (half). */
  const lay = (mesh: Mesh, j: number, at: Vector3, way: number, half: number, f: { dx: number; dz: number }) => {
    const across = along(way + Math.PI / 2, f).multiplyScalar(half);
    (mesh.geometry.getAttribute('position') as BufferAttribute).set([...onSnow(at.clone().add(across)).toArray(), ...onSnow(at.clone().sub(across)).toArray()], j * 6);
    const c = groove.clone().lerp(scraped, Math.min(1, (half - 0.035) * 2.5));
    (mesh.geometry.getAttribute('color') as BufferAttribute).set([c.r, c.g, c.b, c.r, c.g, c.b], j * 6);
  };
  const halfOf = (skid: number) => 0.035 + 0.75 * skid;
  // The demo run's: worked out for the whole run (again for each skier), then shown as far as the skier has got. As many strips as the
  // skier has skis: two, or a horse's four short ones. (Room for four minutes of it.)
  const watchTracks = [0, 1, 2, 3].map(() => strip(3600));
  let watchSkis = 2;
  // The ridden run's: laid as the skier goes, a step every thirty centimetres; the oldest let go of when the strip is full.
  const RIDE_STEPS = 2400, rideTracks = [0, 1, 2, 3].map(() => strip(RIDE_STEPS));
  let rideLaid = 0, rideSkis = 2;
  const lastLaid = new Vector3();
  const layRide = (now: Now) => {
    const at = skier.skis().map(onSnow);
    if (rideLaid && at[0].distanceTo(lastLaid) < 0.3) return;
    lastLaid.copy(at[0]);
    rideSkis = at.length;
    if (rideLaid === RIDE_STEPS) {
      for (const m of rideTracks) for (const name of ['position', 'color']) { const arr = (m.geometry.getAttribute(name) as BufferAttribute).array as Float32Array; arr.copyWithin(0, (RIDE_STEPS / 2) * 6); }
      rideLaid = RIDE_STEPS / 2;
    }
    at.forEach((p, k) => lay(rideTracks[k], rideLaid, p, now.way, halfOf(now.skid), here));
    rideLaid++;
    rideTracks.forEach((m, k) => { m.geometry.getAttribute('position').needsUpdate = true; m.geometry.getAttribute('color').needsUpdate = true; m.geometry.setDrawRange(0, k < rideSkis ? Math.max(0, rideLaid - 1) * 6 : 0); });
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
      const go = along(now.way, here), skiAlong = along(now.ski, here), slide = go.clone().addScaledVector(skiAlong, -go.dot(skiAlong)), spots = skier.skis(), aside = runLeft(here);
      for (let i = 0; i < Math.round(now.speed * 0.9); i++) {
        const f = flakes[nextFlake++ % SPRAY], from = onSnow(spots[i % spots.length].clone());
        f.p.copy(from).addScaledVector(go, 0.35).addScaledVector(aside, sprayRng.range(-0.8, 0.8)).addScaledVector(UP, 0.04);
        f.v.copy(go).multiplyScalar(now.speed * sprayRng.range(0.5, 1)).addScaledVector(UP, sprayRng.range(1.2, 3.2)).addScaledVector(aside, sprayRng.range(-1.5, 1.5)).addScaledVector(slide, now.speed * sprayRng.range(0.2, 0.6));
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
   * The ridden skier: where it is (east, south and up, in the scene), and how fast it is rising there (as the snow under it rose over
   * its last step), and where that is against the run (`down` along it, `left` across it); which way it goes against the run's own way there, and how fast; the facing of its body (half the way it goes, lagging,
   * so that its chest stays more down the run than its skis); how far into a tuck, standing tall and braking; its lean into the turn;
   * its poles' flicks, each a time left to run; how high the kicker under it is, if it is on one; how far it has sunk to take a
   * landing; any turn of the whole body it is still coming out of from one; how far its turn is skidded rather than carved (0 to 1);
   * how long an arrow key has been held to turn; and whether it has come to the end of the run.
   */
  const ride = {
    x: 0, y: 0, z: 0, vy: 0, down: 0, left: 0, way: 0, speed: 0, facing: 0, tuck: 0, tall: 0, brake: 0, brakeSide: 1, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0,
    out: 0, absorb: 0, settle: { spin: 0, flip: 0, left: 0 }, skid: 0, held: 0, ended: false,
  };
  /** Where the skier is against the run, as its last step left it. */
  let here: Frame = land.frame(0, 0);
  /**
   * How the last step posed the skier, on the snow or in the air; and whether to pose it at all (not while the demo run is flown,
   * but where a frame of it is kept).
   */
  let posed: { air: boolean; c: RideControls | AirControls } = { air: false, c: { s: 0, ski: 0, tuck: 0, brake: 0, tall: 0, flickL: 0, flickR: 0 } }, quiet = false;
  /**
   * In the air: what it is doing there (`air`, straight air; `flip`, a backflip; `flight`, a ski jumper's; `hop`, too short a time
   * in the air for anything), the spin and the flip it is to make and how far into them it is, how long it has been in the air and how
   * long it was to be, how fast it goes and which way, where it left the snow, and how far its nose was up over the land as it did.
   */
  interface Air { kind: 'air' | 'flip' | 'flight' | 'hop'; spinTo: number; flipTo: number; spin: number; flip: number; t: number; T: number; v: Vector3; from: Vector3; nose: number; name: string }
  let air: Air | null = null;
  /** Gone limp, every body of it (a horse and its rider each their own), and why. */
  let crash: { dolls: { body: Body; doll: Ragdoll }[]; why: string } | null = null;
  /** The skier's bodies' joints as the last two steps left them, and how long the last step was: what a body gone limp goes on from. */
  let joints: Record<string, Vector3>[] | null = null, jointsBefore: Record<string, Vector3>[] | null = null, jointsDt = 1 / 120;
  /** What the rider asks: across (-1 to 1, to the right positive) and up (1 the deepest tuck, -1 standing tallest); and braking. */
  const ask = { x: 0, y: 0 }, want = { x: 0, y: 0, keys: { up: false, down: false, left: false, right: false }, brake: false, brakeKey: false };
  const FLICK = 0.3;
  /** Where across the range a turn begins to skid (it skids wholly at its end), and how far the skis are pivoted across the way then. */
  const SKID_FROM = 0.72, SKID_TURN = deg(38);
  /** How long from now until something at `p` going at `v` comes down onto the snow, its weight bringing it down as it goes. */
  const timeToSnow = (p: Vector3, v: Vector3) => {
    const q = p.clone(), w = v.clone(), dt = 1 / 60;
    for (let t = dt; t < 6; t += dt) { w.y -= G * dt; q.addScaledVector(w, dt); if (q.y <= ground(q.x, q.z)) return t; }
    return 6;
  };
  const keepJoints = (dt: number) => { if (dt <= 0) return; jointsBefore = joints; joints = skier.bodies().map((b) => b.joints()); jointsDt = dt; };
  /**
   * Where the skier now is against the run: its way and its body's facing kept as they were in the world as the run's own way turns
   * under it; kept on the skiable path, inside its edges and between its top and its foot (and, in the air, going no further out).
   */
  const keepOn = () => {
    let f = land.frame(ride.x, ride.z, ride.down);
    const [lo, hi] = land.edges(f.s), end = land.length + 20;
    if (f.left < lo + 1 || f.left > hi - 1 || f.s < -20 || f.s > end) {
      const s = clamp(f.s, -20, end), left = clamp(f.left, lo + 1, hi - 1), p = land.at(s, left);
      ride.x = p.x; ride.z = p.z;
      if (air && left !== f.left) { const out = runLeft(f).multiplyScalar(Math.sign(f.left - left)), o = air.v.dot(out); if (o > 0) air.v.addScaledVector(out, -o); }
      f = { ...f, s, left };
    }
    const turned = Math.atan2(f.dx * here.dz - f.dz * here.dx, f.dx * here.dx + f.dz * here.dz);
    ride.way -= turned; ride.facing -= turned;
    here = f; ride.down = f.s; ride.left = f.left;
  };

  /** What a trick is called. */
  const trickName = (a: Air) => {
    const turns = Math.round(Math.abs(a.spinTo) / TURN), spin = turns ? `${turns * 360}` : '';
    if (a.kind === 'hop') return 'Hop';
    if (a.kind === 'flip') return spin ? `Backflip ${spin}` : 'Backflip';
    if (a.kind === 'flight') return spin ? `Flight ${spin}` : 'Ski-jump flight';
    // (A horse's straight air is a show jumper's.)
    return spin || (who === 'person' ? 'Straight air' : 'Show jump');
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
   * Leaves the snow (the ground fell away under it faster than its weight can bring it down: off a kicker's lip, or its back, or the
   * crest of a knoll taken fast), going at `v`, its nose `nose` up over the land: what it does in the air is what it was doing as it
   * left, if it is to be in the air long enough for anything.
   */
  const takeOff = (v: Vector3, nose: number) => {
    const from = new Vector3(ride.x, ride.y, ride.z), T = timeToSnow(from, v), long = T > 0.5;
    const kind: Air['kind'] = !long ? 'hop' : ride.tuck > 0.55 ? 'flight' : ride.tall > 0.5 ? 'flip' : 'air';
    const turns = !long ? 0 : Math.abs(ask.x) > 0.72 ? 2 : Math.abs(ask.x) > 0.3 ? 1 : 0;
    air = { kind, spinTo: -Math.sign(ask.x) * turns * TURN, flipTo: kind === 'flip' ? -TURN : 0, spin: 0, flip: 0, t: 0, T, v, from, nose, name: '' };
    air.name = trickName(air);
  };

  /** Comes down onto the snow: landed, if the turns are near enough made and the blow (how fast it comes into the snow) not too hard; else gone limp. */
  const land_ = () => {
    const a = air!, up = normalAt(ride.x, ride.z, 0.5), into = a.v.dot(up), blow = Math.max(0, -into);
    const flipShort = Math.abs(a.flipTo - a.flip), spinShort = Math.abs(a.spinTo - a.spin);
    const far = Math.hypot(ride.x - a.from.x, ride.z - a.from.z);
    air = null;
    if (flipShort > deg(55) || spinShort > deg(75) || blow > 12.5) {
      const why = blow > 12.5 ? 'landed too hard' : flipShort > deg(55) ? (flipShort > deg(200) ? 'landed on its back' : 'short of the flip') : `short of the ${Math.round(Math.abs(a.spinTo) / TURN) * 360}`;
      fall(why);
      return;
    }
    // (Going on as it was going, along the snow: what of its going was into the snow is taken up in the landing.)
    const along_ = a.v.clone().addScaledVector(up, -into);
    ride.speed = along_.length() * (blow > 9 ? 0.9 : 1);
    ride.way = Math.atan2(along_.dot(runLeft(here)), along_.dot(runDir(here)));
    ride.y = ground(ride.x, ride.z);
    ride.vy = risingHere();
    ride.out = bumpAt(ride.x, ride.z);
    ride.absorb = clamp(0.35 + blow / 10, 0, 1);
    ride.settle = { spin: a.spin - a.spinTo, flip: a.flip - a.flipTo, left: 0.25 };
    if (a.kind !== 'hop') tell(a.name, `${far.toFixed(0)} m, ${a.t.toFixed(1)} s in the air`, false, 2.6);
  };

  /** Goes limp: the body goes on as it was going, turning as it was turning, from where its joints were. */
  const fall = (why: string) => {
    const bodies = skier.bodies(), now = bodies.map((b) => b.joints()), going = along(ride.way, here);
    crash = {
      dolls: bodies.map((body, i) => {
        let before = jointsBefore?.[i] ?? now[i];
        // (A rider is thrown on over the horse's head as the horse stops: given that much more of a start, forward and up.)
        if (i > 0) { const thrown = going.clone().multiplyScalar(1.5).addScaledVector(UP, 2.2).multiplyScalar(jointsDt); before = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.clone().sub(thrown)])); }
        return { body, doll: new Ragdoll(body.spec, now[i], before, jointsDt, groundUnder) };
      }),
      why,
    };
    rider.position.set(0, 0, 0);
    rider.quaternion.identity();
    rider.updateMatrixWorld(true);
    // (Out of the saddle: its own body now, in the world.)
    if (who === 'mounted') rider.add(jockey.model);
    for (const { body, doll } of crash.dolls) body.poseJoints(doll.joints());
    tell(`Crashed: ${why}`, 'Restart run with the button, or Enter', true, 1e9);
    reflect();
  };

  /** How fast the skier rises going on along the snow as it lies where the skier is (falls, going down it). */
  const risingHere = () => {
    const go = along(ride.way, here), [gx, gz] = slopeAt(ride.x, ride.z, 1), rise = gx * go.x + gz * go.z;
    return (ride.speed * rise) / Math.hypot(1, rise);
  };
  /** Puts the skier at `down` along the run and `left` across it, on the snow, going on as the snow lies there. */
  const putAt = (down: number, left: number) => {
    const p = land.at(down, left);
    ride.x = p.x; ride.z = p.z;
    here = land.frame(p.x, p.z, down);
    ride.down = here.s; ride.left = here.left;
    ride.y = ground(p.x, p.z);
    ride.vy = risingHere();
  };
  /** The skier back at the top, going a little. */
  const resetRide = () => {
    Object.assign(ride, { way: 0, speed: 7, facing: 0, tuck: 0, tall: 0, brake: 0, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0, out: 0, absorb: 0, skid: 0, ended: false, held: 0 });
    here = land.frame(0, 0);
    putAt(0, 0);
    ride.settle = { spin: 0, flip: 0, left: 0 };
    Object.assign(ask, { x: 0, y: 0 });
    air = null; crash = null; joints = jointsBefore = null;
    seat();
    told = { text: '', small: '', bad: false, until: 0 };
  };
  /** The run again from the top, going a little. */
  const restart = () => {
    resetRide();
    clearRideTracks();
    clearSpray();
    placed = false;
    reflect();
  };

  /** The skier in the air, a step on: thrown, turning as it is making its turns, opening up to land, and down. */
  const stepAir = (dt: number): Now => {
    const a = air!;
    a.t += dt;
    const v = a.v.length();
    a.v.y -= G * dt;
    a.v.addScaledVector(a.v, -0.004 * v * dt);
    ride.x += a.v.x * dt; ride.y += a.v.y * dt; ride.z += a.v.z * dt;
    keepOn();
    ride.time += dt;
    // Opening up to land, the last few tenths of a second before the snow; a tighter tuck turns it quicker, opening out slower.
    const left = timeToSnow(new Vector3(ride.x, ride.y, ride.z), a.v), open = a.kind === 'hop' ? 0 : 1 - smooth(left / 0.4);
    const quick = (1 + 0.45 * Math.max(0, ask.y) - 0.35 * Math.max(0, -ask.y)) * (1 - 0.5 * open);
    const turned = (now: number, to: number, rate: number) => {
      const short = to - now;
      if (!short) return now;
      const most = rate * TURN * dt * quick * Math.min(1, 0.3 + Math.abs(short) / 1.0) * Math.min(1, (a.t + 0.08) / 0.25);
      return now + Math.sign(short) * Math.min(Math.abs(short), most);
    };
    a.flip = turned(a.flip, a.flipTo, 1.0);
    a.spin = turned(a.spin, a.spinTo, 1.35);
    const way = Math.atan2(a.v.dot(runLeft(here)), a.v.dot(runDir(here)));
    ride.way = way;
    ride.facing += (way - ride.facing) * ease(dt, 6);
    ride.flickL = ride.flickR = 0;
    posed = { air: true, c: {
      tuck: Math.max(0, ask.y), flight: a.kind === 'flight' ? smooth(a.t / 0.3) : 0, open,
      throw: a.kind === 'flip' ? 1 - smooth(a.t / 0.35) : 0, wrap: a.spinTo ? smooth(a.t / 0.2) : 0, ski: ride.way - ride.facing, spin: a.spin, flip: a.flip,
    } };
    if (!quiet) skier.air(posed.c as AirControls);
    // (Upright to the land under it, smoothed over some metres; its nose up as it left the lip, coming level over the flight.)
    standAt(new Vector3(ride.x, ride.y, ride.z), normalAt(ride.x, ride.z, 1.5), ride.facing, here, a.nose * (1 - smooth(a.t / (0.75 * a.T))));
    if (!quiet) keepJoints(dt);
    if (ride.y <= ground(ride.x, ride.z)) land_();
    return { down: here.s, left: here.left, speed: Math.hypot(a.v.x, a.v.z), way, ski: ride.way, skid: 0, tuck: ride.tuck, brake: 0 };
  };

  /** Gone limp, a step on. */
  const stepFallen = (dt: number): Now => {
    const was = fallenAt();
    for (const { body, doll } of crash!.dolls) { doll.step(dt); body.poseJoints(doll.joints()); }
    ride.time += dt;
    const at = fallenAt(), went = at.clone().sub(was), f = land.frame(at.x, at.z, ride.down);
    return { down: f.s, left: f.left, speed: went.length() / dt, way: ride.way, ski: ride.way, skid: 0, tuck: 0, brake: 0 };
  };
  /** Where what has fallen is, for the view to follow: the first of its bodies (a horse, not the rider thrown from it). */
  const fallenAt = () => crash!.dolls[0].doll.middle().clone();
  /** How long all of it has lain still. */
  const stillFor = () => Math.min(...crash!.dolls.map((d) => d.doll.still));

  const stepRide = (dt: number): Now => {
    easeAsk(dt);
    if (crash) return stepFallen(dt);
    if (air) return stepAir(dt);
    // (At the foot of the run it brakes to a stop by itself.)
    const braking = want.brake || want.brakeKey || ride.ended;
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
    // The skiable path's edges, marked by its poles: turned back towards its middle near them (the nearer, the narrower the path), and
    // kept off them.
    const [lo, hi] = land.edges(ride.down), near = Math.min(8, (hi - lo) / 4);
    if ((ride.left > hi - near && ride.way > 0) || (ride.left < lo + near && ride.way < 0)) ride.way -= Math.sign(ride.way) * Math.min(Math.abs(ride.way), dt * 2.2);
    // Its speed: its weight pulling it down the snow as much as the snow falls the way it goes, less the snow's friction (its weight
    // into the snow), the air's drag (much less tucked, more standing tall), a little lost to every turn, and a great deal to braking.
    // (Going up a kicker, or a rise, its weight pulls it back.)
    const go = along(ride.way, here), [gx, gz] = slopeAt(ride.x, ride.z), rise = gx * go.x + gz * go.z, level = 1 / Math.hypot(1, rise);
    // (How steeply a kicker under it rises over the land, from just behind: not across its lip, to its steep back.)
    const into = G / Math.hypot(1, gx, gz), e = 0.3;
    const nose = Math.atan((bumpAt(ride.x, ride.z) - bumpAt(ride.x - go.x * e, ride.z - go.z * e)) / e);
    const drag = 0.0065 + (0.0037 - 0.0065) * ride.tuck + (0.012 - 0.0065) * ride.tall;
    const pull = -G * rise * level - 0.04 * into - drag * ride.speed ** 2 - 0.05 * Math.abs(turning) * ride.speed - 7 * ride.brake - 6 * Math.abs(Math.sin(pivot));
    ride.speed = Math.max(0, ride.speed + pull * dt);
    ride.x += go.x * ride.speed * level * dt; ride.z += go.z * ride.speed * level * dt;
    ride.time += dt;
    // On the snow as high as the snow is where it went; unless the snow falls away faster than the skier's weight can bring it down
    // after it (by more than the snow gives underfoot), and the skier leaves it, rising as it was over its last step (up a kicker's
    // ramp, off its lip). (Judged where it went, before it is kept on the path: moved back in from an edge, onto snow higher or lower,
    // it would have seemed to rise or fall as fast as it was moved, and been thrown.)
    const g1 = ground(ride.x, ride.z), thrown = ride.y + ride.vy * dt - 0.5 * G * dt * dt;
    if (g1 < thrown - 0.03) {
      ride.y = thrown;
      keepOn();
      takeOff(go.clone().multiplyScalar(ride.speed * level).setY(ride.vy - G * dt), nose);
      return stepAir(0);
    }
    ride.vy = clamp((g1 - ride.y) / dt, -ride.speed, ride.speed);
    keepOn();
    ride.y = ground(ride.x, ride.z);
    ride.out = bumpAt(ride.x, ride.z);
    // The lean into the turn that speed and turning ask, as `makeDownhillRun` reckons it; and the inside pole flicked as a turn begins.
    const lean = clamp(Math.atan((ride.speed * turning) / G) / ((48 * Math.PI) / 180), -1.3, 1.3) * (1 - ride.brake) * (1 - 0.4 * ride.skid);
    ride.lean += (lean - ride.lean) * ease(dt, 10);
    const side = Math.abs(ride.lean) > 0.2 ? Math.sign(ride.lean) : 0;
    if (side && side !== ride.leanSide) { if (side > 0) ride.flickL = FLICK; else ride.flickR = FLICK; }
    if (side) ride.leanSide = side;
    ride.flickL = Math.max(0, ride.flickL - dt);
    ride.flickR = Math.max(0, ride.flickR - dt);
    const bump = (left: number) => (left > 0 ? Math.sin((Math.PI * (FLICK - left)) / FLICK) : 0) * (1 - ride.tuck);
    ride.facing += (skier.facing * ride.way - ride.facing) * ease(dt, 2);
    const ski = ride.way + pivot + ((ride.brakeSide * 78 * Math.PI) / 180) * ride.brake;
    // Sunk into a landing, coming up out of it; crouched going up a kicker's ramp, the more the steeper; and out of what is left of
    // a turn of the whole body.
    ride.absorb = Math.max(ride.out > 0.05 ? 0.5 * clamp(Math.sin(nose) / 0.34, 0, 1) : 0, ride.absorb - dt * 1.6);
    const settling = smooth(ride.settle.left / 0.25);
    ride.settle.left = Math.max(0, ride.settle.left - dt);
    posed = { air: false, c: {
      s: ride.lean, ski: ski - ride.facing, tuck: ride.tuck, brake: ride.brake, tall: ride.tall, flickL: bump(ride.flickL), flickR: bump(ride.flickR),
      absorb: ride.absorb, spin: ride.settle.spin * settling, flip: ride.settle.flip * settling, skid: ride.skid,
    } };
    if (!quiet) skier.ride(posed.c as RideControls);
    // (Upright to the snow under it, smoothed over half a metre, as skis bridge what is smaller.)
    standAt(new Vector3(ride.x, ride.y, ride.z), normalAt(ride.x, ride.z, 0.5), ride.facing, here);
    if (!quiet) keepJoints(dt);
    // At the foot of a world's run: brought to a stop there.
    if (!ride.ended && ride.down > land.length - 30) { ride.ended = true; tell('The foot of the run', `${land.fall.toFixed(0)} m vertical in ${ride.time.toFixed(0)} s · Restart run, or Enter`, false, 1e9); }
    return { down: ride.down, left: ride.left, speed: ride.speed, way: ride.way, ski, skid: Math.abs(Math.sin(ski - ride.way)), tuck: ride.tuck, brake: ride.brake };
  };
  /** What the ridden skier is doing, in words. */
  const doingNow = () => {
    if (crash) return stillFor() > 0.5 ? 'Down in the snow' : 'Tumbling';
    if (air) return air.kind === 'hop' ? 'In the air' : `${air.name}…`;
    if (ride.brake > 0.5) return who === 'person' ? 'Braking' : 'Sliding stop';
    if (ride.speed < 0.5) return ride.ended ? 'At the foot of the run' : 'Standing';
    if (ride.out > 0.05) return 'Up the kicker';
    const turn = Math.abs(ask.x) > 0.15 ? (ask.x < 0 ? 'turning left' : 'turning right') : '';
    if (ride.skid > 0.5) return `${ride.tuck > 0.5 ? 'Tucked, skidding' : 'Skidding'} ${turn.split(' ')[1]}`;
    const stance = ride.tuck > 0.5 ? 'Tucked' : ride.tall > 0.5 ? 'Standing tall' : '';
    if (stance && turn) return `${stance}, ${turn}`;
    if (stance) return stance;
    return turn ? `Carving ${turn.split(' ')[1]}` : 'Running straight';
  };

  // ---------------------------------------------------------------- the demo run
  /**
   * The run watched (asked: "make the demo run be such that it hits tricks in the jumps: 720, backflip, backflip 360, tucked jump; both
   * with human and horse skiers"): the ride itself, flown by a pilot in place of the pointer, kept a thirtieth of a second at a time
   * and played back. Between the kickers it carves down the skiable path, a turn every two seconds or so, wider the faster it goes,
   * held towards the path's middle; from some seventy metres before each it lines up on the kicker, going at the speed it means to
   * take it at, and takes off in the stance that makes the trick asked of that kicker: neither tucked nor tall and turning hard, a 720;
   * standing tall, a backflip; tall and turning, a backflip with a 360; tucked, a ski jumper's flight. In the air it tucks, which turns
   * it quicker, so that it comes round in time; it opens up to land by itself. A kicker it does not land its trick off (short of it,
   * or fallen) is flown again from the start of its approach, at another speed. After the last it carves on to the foot of the run
   * (on the groomed slope, some way on, and brakes to a stop). Each skier, a person, a horse, a horse and its rider, is flown for
   * itself (a horse's body faces round with its skis more than a person's); the same pilot and the same tricks.
   */
  type Stance = 'spin' | 'flip' | 'flip spin' | 'tuck';
  const DEMO_TRICKS: { name: string; stance: Stance; side: number }[] = [
    { name: '720', stance: 'spin', side: 1 }, { name: 'Backflip', stance: 'flip', side: 0 },
    { name: 'Backflip 360', stance: 'flip spin', side: -1 }, { name: 'Ski-jump flight', stance: 'tuck', side: 0 },
  ];
  /** The speeds a kicker is taken at, the first first, the others if that one does not make its trick. */
  const DEMO_SPEEDS = [17, 20, 14, 23, 11, 26];
  interface DemoFrame { p: Vector3; q: Quaternion; air: boolean; c: RideControls | AirControls; now: Now }
  interface Demo { frames: DemoFrame[]; parts: { label: string; from: number; to: number }[]; length: number; landed: string[]; tries: number[]; fell: string | null; flown: string[] }
  const demos = new Map<Land, Map<Who, Demo>>();
  /** The kickers that stand on the run, from the top, as many as `n`. */
  const standing = (n: number) => { const out: Kicker[] = []; for (let i = 0; i < 60 && out.length < n; i++) { const k = kickerOf(i); if (k && k.s < land.length) out.push(k); } return out; };
  /** Flies the demo run on the land as it is, for the skier as it is. */
  const flyDemo = (): Demo => {
    const kicked = standing(DEMO_TRICKS.length).filter((k) => k.s + 40 < land.length), was = kicks;
    // (Every kicker under it as it goes, without drawing any.)
    kicks = standing(kicked.length + 2);
    resetRide();
    Object.assign(want, { x: 0, y: 0, brake: false, brakeKey: false });
    for (const key of Object.keys(want.keys) as (keyof typeof want.keys)[]) want.keys[key] = false;
    const frames: DemoFrame[] = [], labels: string[] = [], landed: string[] = [], tries: number[] = [], flown: string[] = [];
    let k = 0, phase = 0, settle = 0, label = 'Off from the top', fell: string | null = null, stopAt = Infinity, last = '', step = 0;
    // (Where the approach to the kicker now ahead began, to fly it again from there.)
    let from: { k: number; step: number; ride: typeof ride; ask: typeof ask; here: Frame; frames: number; landed: number; phase: number } | null = null;
    /** Each kicker's flight, as it went: at what speed, off the lip how fast, and how it came down. */
    let off = '';
    const note = (how: string) => { flown.push(`${DEMO_TRICKS[k]?.name ?? 'Carving'} at ${DEMO_SPEEDS[tries[k] ?? 0]}: ${off}${how}`); off = ''; };
    const again = () => {
      if (!from || from.k !== k || tries[k] >= DEMO_SPEEDS.length - 1) return false;
      Object.assign(ride, structuredClone(from.ride));
      Object.assign(ask, from.ask);
      here = { ...from.here };
      air = null; crash = null; joints = jointsBefore = null;
      seat();
      frames.length = labels.length = from.frames;
      landed.length = from.landed;
      phase = from.phase; step = from.step; settle = 0;
      tries[k]++;
      return true;
    };
    /** How hard to turn to go the way `wantWay` (radians to the left of the run's way): a carve, short of a skid, unless asked. */
    const steer = (wantWay: number, gain = 2.6, most = 0.68) => clamp((ride.way - wantWay) * gain, -most, most);
    const dt = 1 / 120;
    for (let spent = 0; spent < 600 * 120; spent++, step++) {
      const kick = kicked[k], trick = DEMO_TRICKS[k];
      // (Where it is against the kicker ahead, in the kicker's own frame: how far along its ramp from its lip, and how far left of
      // its middle. Against the run instead, where the run bends near a kicker set across it, the skier seemed past the lip while
      // still on the ramp.)
      const toLip = kick ? KICK.length - ((ride.x - kick.x) * kick.dx + (ride.z - kick.z) * kick.dz) : Infinity;
      want.brake = false;
      if (air) {
        // (Tucked in the air, whatever it left in: it turns quicker so, and comes round in time.)
        want.x = 0; want.y = 1;
        if (air.kind !== 'hop') label = air.name;
      } else if (kick && toLip < -1) {
        // Past a kicker: on to the next, if it made its trick; or the approach flown again.
        note(last ? `landed the ${last}` : 'no trick');
        if (last !== trick.name && again()) continue;
        k++; settle = 0.7; from = null;
      } else if (settle > 0) {
        settle -= dt; want.x = 0; want.y = 0;
      } else if (kick && toLip < 75) {
        // Lining up on it, at the speed it is to be taken at; and at the lip, the stance that makes its trick.
        if (!from || from.k !== k) { tries[k] ??= 0; last = ''; from = { k, step, ride: structuredClone(ride), ask: { ...ask }, here: { ...here }, frames: frames.length, landed: landed.length, phase }; }
        const tLip = toLip / Math.max(ride.speed, 1), speed = DEMO_SPEEDS[tries[k]];
        // (Turned towards the kicker's middle, the nearer the more; its way and its offset against the kicker's own way.)
        const go = along(ride.way, here), kd = runDir(kick), kl = runLeft(kick), off = (ride.x - kick.x) * kl.x + (ride.z - kick.z) * kl.z;
        const way = Math.atan2(go.dot(kl), go.dot(kd)), aim = clamp(Math.atan2(-off, Math.max(toLip, 6)) * 1.3, -0.45, 0.45);
        want.x = clamp((way - aim) * 3, -0.6, 0.6);
        want.y = ride.speed < speed - 1 ? 1 : ride.speed > speed + 1 ? -0.5 : 0.3;
        want.brake = ride.speed > speed + 4 && toLip > 25;
        label = `Up to the kicker: ${trick.name}`;
        if ((trick.stance === 'flip' || trick.stance === 'flip spin') && tLip < 0.75) want.y = -1;
        if (trick.stance === 'spin' && tLip < 0.7) want.y = 0;
        if (trick.stance === 'tuck' && tLip < 1.2) want.y = 1;
        if ((trick.stance === 'tuck' || trick.stance === 'flip') && tLip < 0.4) want.x = 0;
        if (trick.stance === 'spin' && tLip < 0.25) want.x = trick.side;
        if (trick.stance === 'flip spin' && tLip < 0.3) want.x = 0.55 * trick.side;
      } else {
        // Carving down between them.
        phase += (dt * Math.PI) / 1.9;
        const [lo, hi] = land.edges(ride.down), mid = (lo + hi) / 2, half = Math.max(6, (hi - lo) / 2);
        const amp = clamp(0.3 + (ride.speed - 15) * 0.06, 0.2, 0.8);
        want.x = steer(amp * Math.sin(phase) + clamp((mid - ride.left) / half, -1, 1) * 0.3);
        want.y = ride.speed < 12 ? 0.8 : ride.speed > 21 ? -0.4 : 0;
        label = k < kicked.length ? 'Carving' : 'On to the foot';
        // (On a slope that goes on for ever, brought to a stop some way past the last kicker.)
        if (k >= kicked.length && land.length === Infinity) {
          if (stopAt === Infinity) stopAt = ride.down + 40;
          if (ride.down > stopAt) { want.brake = true; label = 'Stopping'; }
        }
      }
      const keep = step % 4 === 0, wasAir = air;
      quiet = !keep;
      const now = stepRide(dt);
      if (air && !wasAir && air.kind !== 'hop' && from?.k === k) off = `off at ${(ride.speed * 3.6).toFixed(0)} km/h, ${air.name}, ${air.T.toFixed(2)} s up; `;
      if (wasAir && !air && !crash && wasAir.kind !== 'hop') { landed.push(wasAir.name); last = wasAir.name; }
      if (keep) { frames.push({ p: rider.position.clone(), q: rider.quaternion.clone(), air: posed.air, c: { ...posed.c }, now: { ...now } }); labels.push(label); }
      if (crash) { note(`fell, ${crash.why}`); if (again()) continue; fell = crash.why; break; }
      if ((ride.ended || stopAt < Infinity) && ride.speed < 0.3) break;
    }
    quiet = false;
    // (The run's parts: each stretch kept under one name.)
    const parts: Demo['parts'] = [];
    labels.forEach((l, i) => { const p = parts[parts.length - 1]; if (p && p.label === l) p.to = (i + 1) * STEP; else parts.push({ label: l, from: i * STEP, to: (i + 1) * STEP }); });
    resetRide();
    kicks = was;
    return { frames, parts, length: Math.max(STEP, (frames.length - 1) * STEP), landed, tries, fell, flown };
  };
  let demo: Demo = { frames: [], parts: [], length: STEP, landed: [], tries: [], fell: null, flown: [] };
  /** The demo run for this land and skier, flown when first wanted (and then kept). */
  const demoFor = () => {
    let forLand = demos.get(land);
    if (!forLand) demos.set(land, (forLand = new Map()));
    let d = forLand.get(who);
    if (!d) forLand.set(who, (d = flyDemo()));
    return d;
  };
  /** The numbers of two frames, so far from the first to the second. */
  const between = <T extends object>(a: T, b: T, k: number): T => {
    const o = { ...a } as Record<string, unknown>;
    for (const key of Object.keys(a)) { const x = (a as Record<string, unknown>)[key], y = (b as Record<string, unknown>)[key]; if (typeof x === 'number' && typeof y === 'number') o[key] = x + (y - x) * k; }
    return o as T;
  };
  /** Puts the skier where the demo run has it at time `t`, in its pose then; and says where it is and what it is doing. */
  const watchPose = (t: number): Now => {
    const fs = demo.frames, last = fs.length - 1, f = clamp(t / STEP, 0, last), i = Math.min(Math.max(0, last - 1), Math.floor(f)), k = f - i, a = fs[i], b = fs[Math.min(last, i + 1)];
    rider.position.lerpVectors(a.p, b.p, k);
    rider.quaternion.slerpQuaternions(a.q, b.q, k);
    const near = k < 0.5 ? a : b, c = a.air === b.air ? between(a.c, b.c, k) : near.c;
    if (near.air) skier.air(c as AirControls); else skier.ride(c as RideControls);
    rider.updateMatrixWorld(true);
    return between(a.now, b.now, k);
  };
  /** The demo run's tracks: each ski's middle every other frame, laid as it went; nothing while it is in the air. */
  const layWatchTracks = () => {
    const fs = demo.frames, was = kicks;
    kicks = standing(DEMO_TRICKS.length + 2);
    for (let i = 0, j = 0; i < fs.length && j < 3600; i += 2, j++) {
      const now = watchPose(i * STEP), spots = skier.skis(), f = land.at(now.down, now.left);
      watchSkis = spots.length;
      spots.forEach((p, s) => lay(watchTracks[s], j, onSnow(p), now.way, fs[i].air ? 0 : halfOf(now.skid), f));
    }
    kicks = was;
    for (const m of watchTracks) { m.geometry.getAttribute('position').needsUpdate = true; m.geometry.getAttribute('color').needsUpdate = true; }
  };
  const showWatchTracks = (t: number | null) => watchTracks.forEach((m, k) => m.geometry.setDrawRange(0, t === null || k >= watchSkis ? 0 : Math.max(0, Math.floor(t / (2 * STEP))) * 6));

  // ---------------------------------------------------------------- what is shown, and how it is moved about in
  type Mode = 'watch' | 'ride';
  type View = 'behind' | 'beside' | 'above' | 'free';
  let mode = 'watch' as Mode;
  let t = 0, playing = true, rate = 1, view = 'behind' as View, scrubbing = false;
  const rates: [string, number][] = [['¼×', 0.25], ['½×', 0.5], ['1×', 1]];
  const views: [string, View, string][] = [['Behind', 'behind', 'B'], ['Beside', 'beside', 'S'], ['Above', 'above', 'A'], ['Free', 'free', 'F']];
  const modes: [string, Mode, string][] = [['Watch', 'watch', 'Watch the demo run: a 720, a backflip, a backflip 360 and a ski jumper\'s flight off its four kickers'], ['Ride', 'ride', 'Ride it yourself: point to steer']];
  const button = (parent: string, label: string, onclick: () => void, title?: string) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; b.onclick = onclick; $(parent).appendChild(b); return b; };
  const modeButtons = modes.map(([label, m, title]) => button('modes', label, () => setMode(m), title));
  const whos: [string, Who][] = [['Person', 'person'], ['Horse', 'horse'], ['Horse & rider', 'mounted']];
  const skiSets: [string, HorseSkis, string][] = [['Two long', 'pair', 'A long ski under each side, the fore and hind hooves bound to it'], ['Four short', 'four', 'A short ski under each hoof']];
  const whoButtons = whos.map(([label, w]) => button('skiers', label, () => setSkier(w)));
  // The land: the world's run, or the groomed slope; changed where the skier is, the demo run flown on the new land and riding
  // begun again from its top.
  const landKinds: [string, LandKind, string][] = [['World run', 'world', `A run down the game's world, ${world}`], ['Groomed', 'groomed', 'A groomed slope at sixteen degrees, going on for ever']];
  const landButtons = landKinds.map(([label, k, title]) => button('lands', label, () => { void setLand(k); }, title));
  const snowLooks: [string, SnowLook, string][] = [['Game', 'game', "The game's own snow, rock and far country, in lighter winter forms"], ['Plain', 'plain', 'Plain snow and rock: lighter still']];
  const snowButtons = snowLooks.map(([label, k, title]) => button('snows', label, () => { if (k !== snowLook) { snowLook = k; if (landKind === 'world') void setLand('world', true); else reflect(); } }, title));
  const setLand = async (kind: LandKind, again = false) => {
    if (kind === landKind && !again) return;
    $('status').hidden = false;
    $('status').textContent = kind === 'world' ? `Laying the snow on the run in ${world}…` : 'Making the run…';
    await new Promise((r) => setTimeout(r, 30));
    const next = await landOf(kind);
    $('status').hidden = true;
    for (const k of kickerAt.values()) if (k?.group) { k.group.removeFromParent(); k.group = undefined; }
    kickerAt.clear();
    kicks = [];
    landKind = kind;
    land = next;
    showLand();
    if (mode === 'ride') restart();
    else { await useDemo(); t = 0; placed = false; clearSpray(); }
    try { history.replaceState(null, '', kind === 'groomed' ? '#groomed' : location.pathname + location.search); } catch { /* (not where the page may not change its address) */ }
    reflect();
  };
  const skiButtons = skiSets.map(([label, k, title]) => button('skisets', label, () => setSkier(who, k), title));
  const rateButtons = rates.map(([label, r]) => button('rates', label, () => { rate = r; reflect(); }));
  const viewButtons = views.map(([label, v, key]) => button('views', label, () => setView(v), `${label} (${key})`));
  const brakeButton = $('brake'), restartButton = $('restart');
  restartButton.onclick = () => restart();
  const line = $('line'), head = line.querySelector('.head') as HTMLElement;
  // The demo run's parts along the timeline, and its seconds ticked off under them, five at a time.
  let bands: HTMLElement[] = [], shownPart = '';
  const buildTimeline = () => {
    for (const b of bands) b.remove();
    bands = demo.parts.map((part) => {
      const d = document.createElement('div'); d.className = 'band';
      d.style.left = `${(part.from / demo.length) * 100}%`; d.style.width = `${((part.to - part.from) / demo.length) * 100}%`;
      const s = document.createElement('span'); s.textContent = part.label; d.title = part.label; d.appendChild(s);
      line.insertBefore(d, head);
      return d;
    });
    line.style.setProperty('--ticks', String(demo.length / 5));
    line.setAttribute('aria-valuemax', demo.length.toFixed(1));
    shownPart = '';
  };
  /**
   * The demo run for the land and the skier as they are, flown if it has not been (a second or so, said while it is), its timeline
   * laid along the foot and its tracks on the snow.
   */
  const useDemo = async () => {
    if (!demos.get(land)?.has(who)) {
      $('status').hidden = false;
      $('status').textContent = 'Flying the demo run…';
      await new Promise((r) => setTimeout(r, 30));
    }
    const d = demoFor();
    $('status').hidden = true;
    if (d !== demo) { demo = d; buildTimeline(); t = Math.min(t, demo.length - 0.01); }
    layWatchTracks();
    showWatchTracks(mode === 'watch' ? t : null);
  };
  const reflect = () => {
    $('play').textContent = playing ? 'Pause' : 'Play';
    modeButtons.forEach((b, i) => b.classList.toggle('on', modes[i][1] === mode));
    rateButtons.forEach((b, i) => b.classList.toggle('on', rates[i][1] === rate));
    viewButtons.forEach((b, i) => { b.classList.toggle('on', views[i][1] === view); b.hidden = mode === 'ride' && views[i][1] === 'free'; });
    $('rates').hidden = line.hidden = mode === 'ride';
    $('brakes').hidden = $('pad').hidden = $('restarts').hidden = mode === 'watch';
    restartButton.classList.toggle('on', !!crash);
    whoButtons.forEach((b, i) => b.classList.toggle('on', whos[i][1] === who));
    skiButtons.forEach((b, i) => b.classList.toggle('on', skiSets[i][1] === horse.skis));
    $('skisets').hidden = who === 'person';
    $('name').textContent = ['Downhill run', land.short, { person: '', horse: 'horse', mounted: 'horse and rider' }[who], mode === 'ride' ? 'riding' : ''].filter(Boolean).join(' · ');
    landButtons.forEach((b, i) => b.classList.toggle('on', landKinds[i][1] === landKind));
    snowButtons.forEach((b, i) => b.classList.toggle('on', snowLooks[i][1] === snowLook));
    $('snows').hidden = landKind !== 'world';
    $('of').textContent = land.fall === Infinity ? '' : ` of ${land.fall.toFixed(0)}`;
    document.body.classList.toggle('riding', mode === 'ride');
  };
  $('play').onclick = () => { playing = !playing; reflect(); };
  // (Free: the view turned about the skier by hand, and carried along with it; only watching, as riding the pointer steers.)
  const setView = (v: View) => { view = mode === 'ride' && v === 'free' ? 'behind' : v; controls.enabled = view === 'free'; camera.up.set(0, 1, 0); placed = false; reflect(); };
  const setMode = (m: Mode) => {
    if (m === mode) return;
    if (m === 'ride') {
      // Ridden from where the demo run had got to, going as it went (or, if it was in the air there, from where it comes down).
      let i = clamp(Math.round(t / STEP), 0, demo.frames.length - 1);
      while (i < demo.frames.length - 1 && demo.frames[i].air) i++;
      const s = demo.frames[i].now;
      Object.assign(ride, { way: s.way, speed: s.speed, facing: 0, tuck: s.tuck, tall: 0, brake: 0, lean: 0, leanSide: 0, flickL: 0, flickR: 0, time: 0, ended: false });
      Object.assign(ask, { x: 0, y: s.tuck });
      Object.assign(want, { x: 0, y: s.tuck, brake: false, brakeKey: false });
      showWatchTracks(null);
      clearRideTracks();
      playing = true;
      // (On the snow where the demo run had got to; on a kicker's, if one stands there.)
      putAt(s.down, s.left);
      placeKickers(ride.down);
      ride.y = ground(ride.x, ride.z);
      ride.vy = risingHere();
      ride.out = bumpAt(ride.x, ride.z);
      ride.absorb = ride.skid = 0;
      ride.settle = { spin: 0, flip: 0, left: 0 };
    } else clearRideTracks();
    air = null; crash = null; joints = jointsBefore = null;
    told = { text: '', small: '', bad: false, until: 0 };
    mode = m;
    // (Back to watching: the demo run for the skier there is now, flown if a new skier was chosen while riding.)
    if (m === 'watch') { seat(); void useDemo(); }
    clearSpray();
    setView(view);
    placed = false;
  };
  /**
   * Another skier, or the horse on other skis: watching, the demo run flown for it (once; then kept) and its tracks laid; riding, it
   * goes on from where the last was (or from the top, if that one lay fallen).
   */
  const setSkier = (w: Who, skis: HorseSkis = horse.skis) => {
    if (w === who && skis === horse.skis) return;
    skier.object.removeFromParent();
    if (skis !== horse.skis) horse.setSkis(skis);
    who = w;
    skier = skiers[w];
    rider.add(skier.object);
    seat();
    joints = jointsBefore = null;
    if (mode === 'ride' && crash) restart();
    if (air) { air = null; ride.y = ground(ride.x, ride.z); ride.vy = risingHere(); }
    if (mode === 'watch') void useDemo();
    clearRideTracks();
    clearSpray();
    placed = false;
    reflect();
  };
  const seek = (x: number) => { const r = line.getBoundingClientRect(); t = clamp(((x - r.left) / r.width) * demo.length, 0, demo.length - 0.01); clearSpray(); };
  line.addEventListener('pointerdown', (e) => { scrubbing = true; line.setPointerCapture(e.pointerId); seek(e.clientX); });
  line.addEventListener('pointermove', (e) => { if (scrubbing) seek(e.clientX); });
  line.addEventListener('pointerup', () => { scrubbing = false; });
  line.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { t = clamp(t + (e.key === 'ArrowRight' ? 1 : -1), 0, demo.length - 0.01); clearSpray(); e.preventDefault(); } });

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
    if (e.target instanceof HTMLInputElement) return;
    if (k === ' ') { playing = !playing; reflect(); e.preventDefault(); } else if (k === 'r') setMode(mode === 'ride' ? 'watch' : 'ride'); else if (k === 'h') setBare(!document.body.classList.contains('bare')); else if (v) setView(v[1]);
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
  let placed = false, distance = 1;
  const eyeOff = new Vector3(), lookOff = new Vector3(), lastRider = new Vector3(), ahead = new Vector3(0, 0, 1);
  let across = 0;
  /** Where the view is about: the skier's feet, or, gone limp, the snow under its hips. */
  const focus = () => { if (!crash) return rider.position.clone(); const p = fallenAt(); return p.setY(ground(p.x, p.z)); };
  /** A point on the snow, or so far over it. */
  const over = (p: Vector3, up: number) => p.setY(ground(p.x, p.z) + up);
  const placeView = (now: Now, dt: number) => {
    const at = focus(), f = land.at(now.down, 0);
    across += ((mode === 'ride' ? 1 : 0.35) * now.left - across) * (placed ? ease(dt, 3) : 1);
    const p = land.at(now.down, across), follow = new Vector3(p.x, at.y, p.z), down = runDir(f), aside = runLeft(f);
    ahead.lerp(mode === 'ride' ? down.clone().lerp(along(now.way, f), 0.65).normalize() : down, placed ? ease(dt, 2) : 1).setY(0).normalize();
    if (view === 'free') {
      if (!placed) { camera.position.copy(at).addScaledVector(UP, 3 * distance).addScaledVector(aside, 6 * distance).addScaledVector(down, -6 * distance); controls.target.copy(at); }
      else camera.position.add(at.clone().sub(lastRider));
      controls.target.copy(at).addScaledVector(UP, 0.9);
      controls.update();
      // (Not let under the snow: on a world's land the hills about can stand over the skier.)
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
    } else {
      // (Each kept over the snow where it is: on a world's land the snow behind and beside the skier can lie well above it.)
      const wantAt = new Vector3(), aim = new Vector3();
      // (Each as far off as the *Distance* slider says, from half as far to three times.)
      const d = distance;
      if (view === 'behind') { over(wantAt.copy(follow).addScaledVector(ahead, -9 * d), 3.4 * d); over(aim.copy(follow).addScaledVector(ahead, 6), 0.6); wantAt.y = Math.max(wantAt.y, at.y + 1.6 * d); }
      // (From the side and a little behind, back far enough to see the slope it is on as well as the skier.)
      else if (view === 'beside') { over(wantAt.copy(follow).addScaledVector(aside, 14 * d).addScaledVector(down, -4 * d), 2.2 * d); wantAt.y = Math.max(wantAt.y, at.y + 0.8 * d); aim.copy(at).addScaledVector(UP, 0.9); }
      // (From above, looking a little behind the skier, so that it is in the upper part of the picture with its tracks below it.)
      else { wantAt.copy(follow).addScaledVector(ahead, -5).setY(at.y + 32 * d); aim.copy(follow).addScaledVector(ahead, -5).setY(at.y); camera.up.copy(ahead); }
      eyeOff.lerp(wantAt.sub(at), placed ? ease(dt, 5) : 1);
      lookOff.lerp(aim.sub(at), placed ? ease(dt, 6) : 1);
      camera.position.copy(at).add(eyeOff);
      // (Never under the snow, whatever the easing has done.)
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.6);
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

  // The picture (asked: "can we cheaply make background a bit blurry and add some motion blur?"): the scene drawn once with how far
  // each point of it moved across the picture since the last frame; each point smeared along that way, over eight samples, as a
  // camera's shutter open a sixtieth of a second would smear it (the frames' own length taken out, so that it smears alike at any
  // rate, and never more than a twenty-fifth of the picture); and what lies well beyond the skier mixed with a blurred picture drawn
  // at half the size, the more the further, so that the background is a little out of focus. *Blur* turns both off, and the plain
  // picture is drawn. (Nothing about as far off as the skier is smeared: the view keeps the skier still in the picture, and its
  // skinned body's motion comes out wrong when the whole of it moves across the picture. A smear that would leave out what lies much
  // nearer than the point smeared, so that the skier is not streaked over the snow behind it, read nothing from the depths at other
  // points of the picture and drew the near snow black; it is not done.)
  // (Drawn once to a point, its edges smoothed after (FXAA), not drawn four times over at each (`?msaa=1` for that): four times over cost
  // more than half of a frame drawn in software, and what the blur smears and softens needs none of it.)
  const msaa = query.get('msaa') === '1';
  const scenePass = pass(scene, camera, { samples: msaa ? 4 : 0 });
  scenePass.setMRT(mrt({ output, velocity }));
  const picture = scenePass.getTextureNode('output'), moved = scenePass.getTextureNode('velocity').xy;
  const uShutter = uniform(1), uFocus = uniform(10), uBlur = uniform(1);
  type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const depthHere: N = scenePass.getViewZNode().negate();
  const streak: N = moved.mul(uShutter).mul(smoothstep(0.12, 0.4, abs(depthHere.sub(uFocus)).div(uFocus)));
  const smear: N = streak.mul(min(1, max(length(streak), 1e-5).reciprocal().mul(0.04)));
  // (Not at all where nothing moves across the picture by as much as a tenth of a point: the skier, and everything while it stands.)
  const smeared: N = Fn(() => {
    const sum = vec4(0).toVar();
    If(length(smear.mul(screenSize)).greaterThan(0.1), () => {
      Loop({ start: int(0), end: int(8), type: 'int' }, ({ i }: { i: N }) => {
        sum.addAssign(picture.sample(uv().add(smear.mul(float(i).div(7).sub(0.5)))));
      });
      sum.divAssign(8);
    }).Else(() => { sum.assign(picture.sample(uv())); });
    return sum;
  })();
  const soft = gaussianBlur(picture, vec2(1, 1), 3, { resolutionScale: 0.5 });
  const away = smoothstep(uFocus.mul(2.2), uFocus.mul(9), depthHere).mul(min(0.95, uBlur.mul(0.85)));
  const pipeline = new RenderPipeline(renderer);
  if (msaa) pipeline.outputNode = mix(smeared, soft, away);
  else { pipeline.outputColorTransform = false; pipeline.outputNode = fxaa(renderOutput(mix(smeared, soft, away))); }
  // (With no blur, the scene alone, smoothed the same way: drawn straight to the canvas, it had its four times over, and cost more
  // than with the blur.)
  const sharp = new RenderPipeline(renderer), sharpPass = pass(scene, camera, { samples: msaa ? 4 : 0 });
  if (msaa) sharp.outputNode = sharpPass;
  else { sharp.outputColorTransform = false; sharp.outputNode = fxaa(renderOutput(sharpPass)); }
  // (How much, by *Blur*: from none, the plain picture drawn, to twice as much; `?blur=` too.)
  let blurLevel = query.has('blur') ? clamp(Number(query.get('blur')) || 0, 0, 2) : 1;
  // Hiding the menus and the text, `H` too; the distance of the views from the skier. (Kept in this browser for next time, where it may.)
  const keep = (k: string, v: string) => { try { localStorage.setItem(`slope.${k}`, v); } catch { /* (not kept) */ } };
  const kept = (k: string) => { try { return localStorage.getItem(`slope.${k}`); } catch { return null; } };
  const bareButton = $('bare'), distanceInput = $<HTMLInputElement>('distance');
  const setBare = (on: boolean) => { document.body.classList.toggle('bare', on); bareButton.textContent = on ? 'Show menus' : 'Hide menus'; bareButton.title = on ? 'Show the menus and the text (H)' : 'Hide the menus and the text (H)'; keep('bare', on ? '1' : '0'); };
  bareButton.onclick = () => setBare(!document.body.classList.contains('bare'));
  const setDistance = (d: number) => { distance = clamp(d, 0.5, 3); distanceInput.value = String(distance); $('distanceOut').textContent = `${distance.toFixed(1)}×`; keep('distance', String(distance)); };
  distanceInput.addEventListener('input', () => setDistance(Number(distanceInput.value)));
  const blurInput = $<HTMLInputElement>('blur');
  const setBlur = (b: number) => { blurLevel = clamp(b, 0, 2); blurInput.value = String(blurLevel); $('blurOut').textContent = blurLevel ? `${blurLevel.toFixed(1)}×` : 'off'; keep('blur', String(blurLevel)); };
  blurInput.addEventListener('input', () => setBlur(Number(blurInput.value)));
  const keptBlur = kept('blur');
  setBlur(query.has('blur') || keptBlur === null ? blurLevel : Number(keptBlur));
  setDistance(Number(kept('distance') ?? 1) || 1);
  setBare(kept('bare') === '1');

  // How finely the picture is drawn (asked: "find how to best optimize the performance still with reasonable visual tradeoffs"):
  // what a frame costs goes nearly as the number of points drawn, so the surest saving there is. *Auto* (unless `?res=` says
  // otherwise) watches how long frames take: kept slower than sixty a second (or than the screen's own rate, if that is lower) for
  // half a second, it draws at fewer points, a step at a time, down to half as many each way; with room to spare for some seconds,
  // a step back up. Each step is held a while before the next, so that it does not hunt. *Full*, *¾* and *½* fix it. (Full is the
  // screen's own fineness, but never more than twice the page's.)
  type Res = 'auto' | 1 | 0.75 | 0.5;
  const fullRatio = Math.min(devicePixelRatio, 2), resChoices: [string, Res][] = [['Auto', 'auto'], ['Full', 1], ['¾', 0.75], ['½', 0.5]];
  const asRes = (v: string | null): Res | undefined => (v === 'auto' ? 'auto' : resChoices.find(([, r]) => String(r) === v)?.[1]);
  let res: Res = asRes(query.get('res')) ?? asRes(kept('res')) ?? 'auto', autoScale = 1;
  const auto = { best: Infinity, slow: 0, slowFrames: 0, fast: 0, hold: 0 };
  const resButtons = resChoices.map(([label, r]) => button('resolutions', label, () => setRes(r), r === 'auto' ? 'Fewer points drawn while frames come slowly' : `Draw at ${label === 'Full' ? 'the screen\'s own' : label} fineness`));
  const applyRatio = () => {
    const s = res === 'auto' ? autoScale : res;
    renderer.setPixelRatio(fullRatio * s);
    fit();
    resButtons.forEach((b, i) => { b.classList.toggle('on', resChoices[i][1] === res); if (resChoices[i][1] === 'auto') b.textContent = res === 'auto' && autoScale < 0.995 ? `Auto ${Math.round(autoScale * 100)}%` : 'Auto'; });
  };
  const setRes = (r: Res) => { res = r; keep('res', String(r)); Object.assign(auto, { slow: 0, slowFrames: 0, fast: 0, hold: 1500 }); applyRatio(); };
  /** Watches a frame's length, in milliseconds, and draws at fewer points or more as frames keep coming slowly or with room to spare. */
  const adapt = (interval: number) => {
    // (A gap of more than a second is the page put aside, not a slow frame. And a single long frame, as when shaders are made, is not
    // slowness: it takes three in a row.)
    if (res !== 'auto' || interval > 1000 || document.hidden) return;
    auto.best = Math.min(auto.best * 1.0005, interval);
    const target = Math.max(auto.best, 1000 / 62);
    auto.hold -= interval;
    if (interval > target * 1.3) { auto.slow += interval; auto.slowFrames++; auto.fast = 0; } else { auto.slow = Math.max(0, auto.slow - interval * 0.5); auto.slowFrames = 0; auto.fast = interval < target * 1.12 ? auto.fast + interval : 0; }
    if (auto.slow > 500 && auto.slowFrames >= 3 && autoScale > 0.5 && auto.hold <= 0) { autoScale = Math.max(0.5, autoScale * 0.85); Object.assign(auto, { slow: 0, slowFrames: 0, fast: 0, hold: 1200 }); applyRatio(); }
    else if (auto.fast > 4000 && autoScale < 1 && auto.hold <= 0) { autoScale = Math.min(1, autoScale * 1.1); Object.assign(auto, { slow: 0, fast: 0, hold: 3000 }); applyRatio(); }
  };
  applyRatio();
  addEventListener('resize', fit);
  fit();
  setView('behind');
  showKickers(true);
  await useDemo();
  reflect();
  $('status').hidden = true;

  let then = performance.now(), benching = false;
  const fixedDt = Number(query.get('dt')) || 0;
  const frame = async () => {
    if (benching) { requestAnimationFrame(frame); return; }
    // (`?dt=` steps every frame by so many seconds whatever time has passed: for pictures, made by a browser too slow to keep pace.)
    const now = performance.now(), dt = fixedDt || Math.min(0.1, (now - then) / 1000);
    adapt(now - then);
    then = now;
    let at: Now;
    if (mode === 'watch') {
      if (playing && !scrubbing) {
        t += dt * rate;
        if (t >= demo.length) { t = 0; clearSpray(); placed = false; }
      }
      at = watchPose(t);
      here = { ...land.at(at.down, at.left), s: at.down, left: at.left };
      showWatchTracks(t);
      stepSpray(playing && !scrubbing ? dt * rate : 0, playing && !scrubbing ? at : null);
      const parts = demo.parts, part = parts.find((p) => t >= p.from && t < p.to) ?? parts[parts.length - 1];
      if (part && part.label !== shownPart) { shownPart = part.label; $('part').textContent = part.label; bands.forEach((b, i) => b.classList.toggle('now', parts[i] === part)); }
      $('clock').textContent = `${t.toFixed(1)} s of ${demo.length.toFixed(0)}`;
      head.style.left = `${(t / demo.length) * 100}%`;
      line.setAttribute('aria-valuenow', t.toFixed(1));
    } else {
      // (Stepped in small steps, so that a slow frame does not throw the skier off its line.)
      const steps = playing ? Math.ceil(dt / (1 / 120)) : 0;
      const p = focus(), f = land.frame(p.x, p.z, ride.down);
      at = { down: f.s, left: f.left, speed: crash ? 0 : ride.speed, way: ride.way, ski: ride.way, skid: 0, tuck: ride.tuck, brake: ride.brake };
      for (let i = 0; i < steps; i++) at = stepRide(dt / steps);
      const onSnow = !air && !crash;
      if (playing && onSnow) layRide(at);
      stepSpray(playing ? dt : 0, playing && onSnow ? at : null);
      const doing = doingNow();
      if (doing !== shownPart) { shownPart = doing; $('part').textContent = doing; }
      $('clock').textContent = `${ride.time.toFixed(0)} s riding`;
      document.body.classList.toggle('hinted', ride.time > 12);
      showPad();
    }
    land.keepAbout(rider.position.x, rider.position.z);
    land.lod?.(camera.position.x, camera.position.z);
    if (kickersOn) placeKickers(at.down);
    placeView(at, dt);
    reinsNow();
    showTold();
    $('speed').textContent = (at.speed * 3.6).toFixed(0);
    // (How far down, as height come down from the top: vertical metres, as the world's heights have it.)
    $('down').textContent = Math.max(0, land.drop(focus().y)).toFixed(0);
    if (blurLevel > 0) {
      uShutter.value = clamp(1 / 60 / Math.max(dt, 1e-3), 0.005, 3) * blurLevel;
      uBlur.value = blurLevel;
      uFocus.value = Math.max(3, camera.position.distanceTo(rider.position));
      pipeline.render();
    } else sharp.render();
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
    state: () => ({ air: air && { ...air }, crash: crash && { why: crash.why, still: stillFor(), at: fallenAt().toArray(), bodies: crash.dolls.map((d) => d.doll.middle().toArray()) }, told: { ...told } }),
    // (The `i`th kicker that stands, counting from the top; and where the skier is put, by how far down the run and across it.)
    kicker: (i: number) => { const all = Array.from({ length: 60 }, (_, k) => kickerOf(k)).filter((k): k is Kicker => !!k && k.s < land.length); const k = all[i] ?? all[0]; return { down: k.s, left: k.left, length: KICK.length }; },
    put: (o: Partial<typeof ride>) => { Object.assign(ride, o); if (o.down !== undefined || o.left !== undefined) { putAt(ride.down, ride.left); placeKickers(ride.down); ride.y = ground(ride.x, ride.z); ride.vy = risingHere(); } placed = false; },
    land: () => ({ name: land.name, length: land.length, half: land.half, about: land.about }),
    setSkier: (w: Who, skis?: HorseSkis) => setSkier(w, skis), who: () => who,
    // (The view from so far east, up and south of the skier, looking at it: for pictures.)
    lookFrom: (dx: number, dy: number, dz: number) => { view = 'free'; controls.enabled = true; const at = focus(); camera.position.copy(at).add(new Vector3(dx, dy, dz)); controls.target.copy(at).addScaledVector(UP, 0.9); controls.update(); lastRider.copy(at); placed = true; },
    // (For a script measuring what each part of the picture costs: the present view drawn `frames` times, each waited for to be done,
    // with some things changed for the while; how long a frame took, in milliseconds, and what was drawn. `hide` names parts of the
    // land (`run`, `about`, `country`, `firs`, `far firs`, `poles`) or `skier`.)
    bench: async (o: { frames?: number; ratio?: number; blur?: number; shadows?: boolean; shadowSize?: number; firShadows?: boolean; hide?: string[] }) => {
      const was = { ratio: renderer.getPixelRatio(), blur: blurLevel, shadows: sun.castShadow, size: sun.shadow.mapSize.x };
      const hidden: Object3D[] = [];
      for (const name of o.hide ?? []) { const m = name === 'skier' ? rider : land.group.getObjectByName(name); if (m && m.visible) { m.visible = false; hidden.push(m); } }
      const firs = land.group.getObjectByName('firs'), firsCast = firs?.castShadow;
      if (firs && o.firShadows !== undefined) firs.castShadow = o.firShadows;
      if (o.ratio) { renderer.setPixelRatio(o.ratio); fit(); }
      const wasRes = res;
      res = 1;
      if (o.blur !== undefined) blurLevel = o.blur;
      if (o.shadows !== undefined) sun.castShadow = o.shadows;
      if (o.shadowSize) { sun.shadow.mapSize.set(o.shadowSize, o.shadowSize); sun.shadow.map?.dispose(); (sun.shadow as unknown as { map: unknown }).map = null; }
      const backend = (renderer as unknown as { backend: { gl?: WebGL2RenderingContext; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } } }).backend;
      const done = async () => { if (backend.gl) backend.gl.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, new Uint8Array(4)); else await backend.device?.queue.onSubmittedWorkDone(); };
      const draw = (p: RenderPipeline) => { if (blurLevel > 0) { uShutter.value = 0.3 * blurLevel; uBlur.value = blurLevel; uFocus.value = Math.max(3, camera.position.distanceTo(rider.position)); p.render(); } else sharp.render(); };
      const p = pipeline;
      // (Each drawn in a frame of the browser's own, as the page's frames are: the renderer counts frames by them, and the scene's
      // picture is drawn once a frame, so that drawn twice within one only the blur was drawn again. The page's own frames wait. The
      // first frame after a change makes its shaders, and is not counted.)
      benching = true;
      const tick = () => new Promise((r) => requestAnimationFrame(r));
      await tick(); draw(p); await done();
      const frames = o.frames ?? 4;
      let ms = 0;
      for (let i = 0; i < frames; i++) { await tick(); const t0 = performance.now(); draw(p); await done(); ms += performance.now() - t0; }
      ms /= frames;
      const info = { triangles: renderer.info.render.triangles, calls: renderer.info.render.drawCalls };
      benching = false;
      for (const m of hidden) m.visible = true;
      if (firs) firs.castShadow = firsCast!;
      if (o.ratio) { renderer.setPixelRatio(was.ratio); fit(); }
      res = wasRes;
      blurLevel = was.blur; sun.castShadow = was.shadows;
      if (o.shadowSize) { sun.shadow.mapSize.set(was.size, was.size); sun.shadow.map?.dispose(); (sun.shadow as unknown as { map: unknown }).map = null; }
      return { ms: +ms.toFixed(1), ...info };
    },
    // (What was drawn in the last frame.)
    drawn: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.drawCalls }),
    setLand: (k: LandKind) => setLand(k),
    restart, time: () => t, ready: true,
    // (The demo run as flown for the skier now: how long, its parts, the tricks it landed, how many times each kicker was flown again.)
    demo: () => ({ length: demo.length, parts: demo.parts, landed: demo.landed, tries: demo.tries, fell: demo.fell, flown: demo.flown }),
  };
  requestAnimationFrame(frame);
}

start().catch((e) => { const s = $('status'); s.hidden = false; s.textContent = `The run could not be made: ${(e as Error)?.message ?? e}`; console.error(e); });
