// The building lab: a plain square, apart from the game, where buildings of every kind the game
// builds can be set out, moved, turned, scaled and reshaped. Open /lab/buildings.html on the dev
// server (`npm run buildings`), or on the published site.
//
// Every building is made by the game's own builders from a site document (see `buildingKinds.ts`),
// and drawn with the game's own materials, sky, sun and air, so what is seen here is what a valley
// would show. What the lab adds is the hand: a building is dragged where it is to stand, turned on a
// ring, scaled as a whole, or reshaped by its measures, either on the panel or by dragging arrows on
// its faces ("extruding" it: its breadth, its depth, its storeys, its wings, its tower, its spire),
// and each change is built again at once. What is set out is kept in the browser, can be undone, and
// can be saved as a file of site documents and opened again.
import {
  MOUSE, ACESFilmicToneMapping, Box3, BufferAttribute, Color, CubeCamera, DirectionalLight, GridHelper, Group, HalfFloatType, InterleavedBufferAttribute, LinearMipmapLinearFilter,
  InstancedMesh, Line, LineBasicMaterial, BufferGeometry, Material, Matrix4, Mesh, PCFShadowMap, PerspectiveCamera, Plane, Ray, Raycaster, RenderTarget, Scene, SRGBColorSpace, Texture, Vector2, Vector3,
} from 'three';
import { CubeRenderTarget, MeshStandardNodeMaterial, PMREMGenerator, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { rtt } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { churchParts } from '../src/core/brick';
import { footprintOf } from '../src/core/building';
import { Building, Hour, SKIES, Stone } from '../src/core/site';
import { solids as plainSolids } from '../src/render/buildings';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { Atmosphere } from '../src/render/post';
import { makeGroundMaterial, makePaneMaterial, makeRockMaterial, makeSiteMaterial, makeWindowMaterial, siteUniforms, windowUniforms } from '../src/render/siteMaterial';
import { cullCards, makeCards, paintCards, vegetationRange, vegetationUniforms } from '../src/render/vegetation';
import { CardSet } from '../src/render/scene';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { GROUND_PAINTS, natureKit, Painted, PLANT_PAINTS, Season, SEASONS, TREES } from './nature';
import { doneGenerating, generateTextureSet } from '../src/render/textures';
import { ALL_KINDS, buildGround, buildItem, deal, dealCharacter, dealTree, documentOf, eavesOf, isNature, Item, Kind, KIND_ORDER, KINDS, liftOf, nearOf, normalise, RANGES, roomOf, shackOf, Shape, standsIn, stoneColour } from './buildingKinds';
import { crownOf, TREE_RANGES } from './nature';
import { dealDress, PLAIN_DRESS } from '../src/core/building';
import { Rng } from '../src/core/rng';
import type { ClassicalDress } from '../src/core/site';

type Tool = 'move' | 'extrude' | 'scale' | 'paint';
type Colour = [number, number, number];

// ------------------------------------------------------------------ what is set out, and remembered
interface State {
  items: Item[];
  /** The number the next building added is given. */
  next: number;
  selected: number | null;
  tool: Tool;
  hour: Hour;
  stone: Stone;
  /** How far a building moves at a time when dragged, in metres (0: freely); and how far it turns, in degrees. */
  snap: number;
  turnSnap: number;
  grid: boolean;
  clay: boolean;
  air: boolean;
  panel: boolean;
  /** The camera: where it is and what it looks at. */
  cam: number[] | null;
  /** Whether what is drawn over the picture to work with is shown: the grid, outlines, knobs, rings and the brush. Off, the picture alone. */
  overlays: boolean;
  /** The season: the green of the leaves, and how dry the grass is. */
  season: Season;
  /** What has been laid with the brushes (see `Painted` in `nature.ts`). */
  paint: Painted;
  /** The brush: what it lays (on the ground, plants, or rock), which of each, whether it digs rock, and its radius in metres. */
  brush: { layer: 'ground' | 'plants' | 'rock'; ground: number; plant: number; dig: boolean; size: number };
}
const KEY = 'dungeons.lab.buildings';
const query = new URLSearchParams(location.search);
const STONES: Stone[] = ['limestone', 'sandstone', 'greystone', 'basalt'];
const DEFAULTS: State = {
  items: [], next: 1, selected: null, tool: 'move', hour: 'morning', stone: 'greystone', snap: 0.5, turnSnap: 15,
  grid: true, clay: false, air: true, panel: true, cam: null, overlays: true, season: 'summer',
  paint: { ground: [], plants: [], rock: [] }, brush: { layer: 'ground', ground: 3, plant: 0, dig: false, size: 2 },
};
/** What was painted, read from storage or a file, made safe: lists of lists of numbers, and no more of them than can be built. */
const readPaint = (o: unknown): Painted => {
  const list = (v: unknown, n: number, most: number) => (Array.isArray(v) ? v.filter((d) => Array.isArray(d) && d.length >= n && d.slice(0, n).every((x) => typeof x === 'number' && Number.isFinite(x))).slice(-most) as number[][] : []);
  const p = (o ?? {}) as Partial<Painted>;
  return { ground: list(p.ground, 5, 20000), plants: list(p.plants, 7, 6000), rock: list(p.rock, 5, 3000) };
};
/** An item read from storage or a file, made safe: a kind the lab knows, numbers that are numbers, and a shape its kind can be. */
function readItem(o: Partial<Item> & { building?: Building }, id: number): Item | null {
  if (!o || !ALL_KINDS.includes(o.kind as Kind)) return null;
  const kind = o.kind as Kind, num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const shape = o.shape ?? (o.building ? (({ x, z, faces, plan, ...rest }) => rest)(o.building) : deal(kind, String(o.seed ?? id)));
  const scale = Array.isArray(o.scale) && o.scale.length === 3 ? (o.scale.map((v) => Math.min(5, Math.max(0.2, num(v, 1)))) as [number, number, number]) : [1, 1, 1] as [number, number, number];
  try {
    return { id, kind, seed: String(o.seed ?? `s${id}`), x: num(o.x, 0), z: num(o.z, 0), turn: num(o.turn, 0), scale, inn: !!o.inn, shape: normalise(kind, shape as Shape) };
  } catch { return null; }
}
// While the page opens, a note says so; it is taken away once the first pictures are drawn. Found on opening, the page did not get
// that far last time (the browser threw it out: on a phone, for want of memory), and what was set out then may be what did it. So
// it starts from the lab's own buildings instead, and keeps what was there to be brought back by a button.
const OPENING = `${KEY}.opening`, BEFORE = `${KEY}.before`;
const failedOpening = (() => { try { const t = Number(localStorage.getItem(OPENING)); return t > 0 && Date.now() - t < 6 * 3600e3; } catch { return false; } })();
const state: State = (() => {
  let kept: Partial<State> = {};
  if (!query.has('fresh')) try { kept = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* nothing kept */ }
  if (failedOpening && kept.items?.length) { try { localStorage.setItem(BEFORE, JSON.stringify(kept)); } catch { /* storage full */ } kept = { ...kept, items: [], selected: null, cam: null }; }
  const s: State = { ...DEFAULTS, ...kept, items: [] };
  for (const o of kept.items ?? []) { const it = readItem(o, s.next); if (it) { s.items.push(it); s.next++; } }
  if (!(s.hour in SKIES)) s.hour = 'morning';
  if (!STONES.includes(s.stone)) s.stone = 'greystone';
  if (!SEASONS.includes(s.season)) s.season = 'summer';
  s.paint = readPaint(s.paint);
  s.brush = { ...DEFAULTS.brush, ...(s.brush ?? {}) };
  if (!['ground', 'plants', 'rock'].includes(s.brush.layer)) s.brush.layer = 'ground';
  if (!['move', 'extrude', 'scale', 'paint'].includes(s.tool)) s.tool = 'move';
  if (query.get('hour')! in SKIES) s.hour = query.get('hour') as Hour;
  if (!s.items.some((it) => it.id === s.selected)) s.selected = null;
  return s;
})();
const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or refused */ } };

// ------------------------------------------------------------------ the page
const canvas = document.getElementById('view') as HTMLCanvasElement;
const over = document.getElementById('over') as unknown as SVGSVGElement;
const panel = document.getElementById('panel')!, foot = document.getElementById('foot')!, toolbar = document.getElementById('tools')!;
const fileInput = document.getElementById('file') as HTMLInputElement;
const said: { text: string; kind: 'good' | 'bad' | 'dim'; until: number } = { text: 'Starting', kind: 'dim', until: Infinity };
const say = (text: string, kind: 'good' | 'bad' | 'dim' = 'dim', seconds = 8) => { said.text = text; said.kind = kind; said.until = performance.now() + seconds * 1000; };
{
  // (What goes wrong in a shader program is reported to the console, not thrown: the last such report is shown on the page too.)
  const was = console.error.bind(console);
  console.error = (...a: unknown[]) => { was(...a); say(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 400), 'bad', 30); };
  window.addEventListener('error', (e) => say(e.message, 'bad', 30));
  window.addEventListener('unhandledrejection', (e) => say(String(e.reason?.message ?? e.reason), 'bad', 30));
}
const rad = (deg: number) => (deg * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
/** An iPad or an iPhone (an iPad says it is a Mac, but a Mac has no touch screen). */
const appleTouch = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const coarse = matchMedia('(pointer: coarse)').matches;
/** A phone: a touch screen too small for a tablet. Its memory is the shortest of all. */
const phone = coarse && Math.min(screen.width, screen.height) < 600;
/** The page's host, when it is shown as an artifact on claude.ai: what it lets the page do, such as offer a file to save. */
const host = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const frameWait = () => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));
/** Which way a building's front looks, and which way its breadth runs from its left end to its right as seen from before it, on the ground. */
const axesOf = (turn: number) => { const t = rad(turn); return { front: new Vector3(Math.sin(t), 0, Math.cos(t)), along: new Vector3(Math.cos(t), 0, -Math.sin(t)) }; };
/** How far the ground a building stands on reaches along its breadth, either side of its middle (a church's towers and choir included). */
const spanOf = (it: Item) => { const r = footprintOf({ ...it.shape, x: 0, z: 0, faces: 'w' } as Building); return { lo: Math.min(...r.map((q) => q.u0)), hi: Math.max(...r.map((q) => q.u1)) }; };
/** Sets `next` beside `prev`, wall to wall to its right as one stands before it, turned the same way, with their fronts on one line. */
function besides(prev: Item, next: Item, gap = 0): void {
  const { front, along } = axesOf(prev.turn), a = spanOf(prev), b = spanOf(next);
  next.turn = prev.turn;
  const line = new Vector3(prev.x, 0, prev.z).addScaledVector(front, (prev.shape.d / 2) * prev.scale[2]);
  const at = line.addScaledVector(along, a.hi * prev.scale[0] - b.lo * next.scale[0] + gap).addScaledVector(front, (-next.shape.d / 2) * next.scale[2]);
  next.x = Math.round(at.x * 100) / 100; next.z = Math.round(at.z * 100) / 100;
}

async function start(): Promise<void> {
  // (On an iPad or iPhone the picture is drawn with WebGL 2, which is what has been tried there; `?webgpu` asks for WebGPU anyway.)
  const forceWebGL = query.has('webgl') || (appleTouch && !query.has('webgpu'));
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  // If the browser takes the graphics card away (a phone short of memory does), what is set out is kept and the page opens again,
  // rather than standing there blank.
  renderer.onDeviceLost = () => {
    remember();
    foot.textContent = 'The browser took the graphics memory back. Opening again, with what was set out…';
    setTimeout(() => location.reload(), 1200);
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(query.get('dpr')) || 1.5));
  const narrow = () => window.innerWidth <= 720;
  /** The picture's size: beside the panel on a broad screen, above it on a narrow one. */
  const viewSize = () => ({
    w: Math.max(200, window.innerWidth - (state.panel && !narrow() ? 280 : 0)),
    h: Math.max(160, window.innerHeight - (state.panel && narrow() ? panel.offsetHeight : 0)),
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 4000);
  camera.layers.enable(1);

  // ------------------------------------------------------------------ the pointer on the picture
  // (Listened for before the camera's controls are made, so that a press on a building can be taken from them: the building moves, and
  // the view does not turn.)
  const raycaster = new Raycaster();
  const rayAt = (x: number, y: number): Ray => {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2), camera);
    return raycaster.ray.clone();
  };
  /** Where a line from the eye meets level ground at the height `y`. */
  const levelAt = (ray: Ray, y = 0): Vector3 | null => {
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
  };
  let press: { pointer: number; x: number; y: number; id: number | null; moved: boolean; height: number; grab: Vector3; from: [number, number] } | null = null;
  let placing: number | null = null;
  // (Nothing is answered until the first buildings are built.)
  let ready = false;
  let handing = false, lastAt: [number, number] = [0, 0];
  canvas.addEventListener('pointerdown', (e) => {
    if (!ready || handing) return;
    // With the brush in hand a press lays what it holds; a second finger takes the stroke back and the two are the view's.
    if (state.tool === 'paint' && placing === null) {
      if (stroke && e.pointerType === 'touch' && stroke.pointer !== e.pointerId) {
        const first = stroke.pointer;
        paintCancel();
        handing = true;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: first, pointerType: 'touch', isPrimary: true, clientX: lastAt[0], clientY: lastAt[1], button: 0, buttons: 1, bubbles: true }));
        handing = false;
        return;
      }
      if (!stroke && paintDown(e)) { lastAt = [e.clientX, e.clientY]; e.stopImmediatePropagation(); return; }
      if (stroke) return;
    }
    if (press && press.id !== null && e.pointerType === 'touch' && press.pointer !== e.pointerId) {
      // A second finger while one is on a building: the two are a pinch or a slide of the view, not a move. The building goes back to
      // where it was, and the first finger is handed to the view's controls as if it had come down on the ground, then this one.
      const it = itemOf(press.id);
      if (it && press.moved) { it.x = press.from[0]; it.z = press.from[1]; placeItem(it); changed(false); reflect(); }
      const first = press;
      press = null;
      handing = true;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: first.pointer, pointerType: 'touch', isPrimary: true, clientX: lastAt[0], clientY: lastAt[1], button: 0, buttons: 1, bubbles: true }));
      handing = false;
      return;
    }
    if (press) { if (press.id !== null) e.stopImmediatePropagation(); return; }
    if (e.button !== 0) return;
    const ray = rayAt(e.clientX, e.clientY);
    if (placing !== null) { e.stopImmediatePropagation(); placed(); return; }
    const hit = pick(ray);
    press = { pointer: e.pointerId, x: e.clientX, y: e.clientY, id: hit?.id ?? null, moved: false, height: 0, grab: new Vector3(), from: [0, 0] };
    lastAt = [e.clientX, e.clientY];
    if (!hit) return;
    // A press on a building is the building's: it is chosen, and dragging it moves it over the ground, its point under the pointer.
    e.stopImmediatePropagation();
    canvas.setPointerCapture(e.pointerId);
    select(hit.id);
    const it = itemOf(hit.id)!;
    press.height = Math.max(0, hit.point.y);
    press.grab.copy(hit.point);
    press.from = [it.x, it.z];
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ready) return;
    if (state.tool === 'paint' && placing === null) {
      if (stroke?.pointer === e.pointerId) lastAt = [e.clientX, e.clientY];
      if (e.pointerType === 'mouse') canvas.style.cursor = 'crosshair';
      paintMove(e);
      return;
    }
    brushRing.visible = false;
    if (placing !== null && !press) {
      const p = levelAt(rayAt(e.clientX, e.clientY)), it = itemOf(placing);
      if (p && it) { it.x = snapped(p.x); it.z = snapped(p.z); placeItem(it); changed(false); reflect(); }
      return;
    }
    if (press?.pointer === e.pointerId) lastAt = [e.clientX, e.clientY];
    if (!press || press.pointer !== e.pointerId) {
      if (!press && e.pointerType === 'mouse') canvas.style.cursor = pick(rayAt(e.clientX, e.clientY)) ? 'grab' : '';
      return;
    }
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true;
    if (press.id === null || !press.moved) return;
    const it = itemOf(press.id), p = levelAt(rayAt(e.clientX, e.clientY), press.height);
    if (!it || !p) return;
    canvas.style.cursor = 'grabbing';
    it.x = snapped(press.from[0] + p.x - press.grab.x);
    it.z = snapped(press.from[1] + p.z - press.grab.z);
    placeItem(it);
    changed(false);
    reflect();
  });
  const release = (e: PointerEvent) => {
    if (paintUp(e)) return;
    if (!press || press.pointer !== e.pointerId) return;
    if (press.id !== null) { if (press.moved) commit(); canvas.style.cursor = 'grab'; }
    else if (!press.moved) select(null);
    press = null;
  };
  // (Let go of anywhere: a drag of the view may end over the panel.)
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 2;
  controls.maxDistance = 700;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = false;
  // (Not under the ground.)
  controls.maxPolarAngle = Math.PI * 0.495;

  // ------------------------------------------------------------------ surfaces, made as the game makes them
  foot.textContent = 'Painting surfaces…';
  await frameWait();
  // (Each surface is kept twice, as pixels and on the graphics card: some 210 MB at 1024 for the seven, a quarter of it at 512,
  // which on a phone's screen looks much the same.)
  const size = Number(query.get('tex')) || (phone ? 512 : 1024);
  // (The same recipes with the same seeds as `main.ts`, so that every surface is the game's.)
  const T = {
    stone: generateTextureSet('stone', size, 3), wood: generateTextureSet('wood', size, 5), moss: generateTextureSet('moss', size / 2, 9),
    plaster: generateTextureSet('plaster', size, 41), tile: generateTextureSet('tile', size, 43),
    redBrick: generateTextureSet('redBrick', size, 73), buffBrick: generateTextureSet('buffBrick', size, 79),
    // (The brown brick of the towns' classical buildings, laid in running bond: what a classical front of brick is built of.)
    brick: generateTextureSet('brick', size, 83),
  };
  doneGenerating();
  const materials: Record<string, Material> = {
    stone: makeSiteMaterial(T.stone, T.moss, { normalScale: 1.0 }),
    floor: makeSiteMaterial(T.stone, T.moss, { normalScale: 1.2 }),
    wood: makeSiteMaterial(T.wood, T.moss, { normalScale: 1.0 }),
    leaf: makeSiteMaterial(T.moss, T.moss, { normalScale: 2.4 }),
    plaster: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.8 }),
    tile: makeSiteMaterial(T.tile, T.moss, { normalScale: 1.3, mossScale: 3 }),
    redBrick: makeSiteMaterial(T.redBrick, T.moss, { normalScale: 1.1, mossScale: 2.2 }),
    buffBrick: makeSiteMaterial(T.buffBrick, T.moss, { normalScale: 1.1, mossScale: 2.2 }),
    brick: makeSiteMaterial(T.brick, T.moss, { normalScale: 1.1, mossScale: 3 }),
    metal: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.25, roughness: 0.5 }),
    copper: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.45, roughness: 0.86, mossScale: 2.5 }),
    glass: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.12, roughness: 0.1 }),
    // (Clear glass, for the windows of a building that can be entered, as in the game.)
    pane: makePaneMaterial(),
  };
  /** Windows with a lamp behind them glow once the light is going, as in the game; by day they are glass. */
  const lampsAt = (hour: Hour) => (hour === 'night' ? 0.5 : hour === 'dusk' ? 0.55 : hour === 'sunset' ? 0.4 : 0);
  const windows = () => {
    materials.window?.dispose();
    const lamps = lampsAt(state.hour);
    materials.window = lamps ? makeWindowMaterial() : makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.12, roughness: 0.1, paint: [0.04, 0.055, 0.075] });
    if (materials.paneLit && materials.paneLit !== materials.pane) materials.paneLit.dispose();
    materials.paneLit = lamps ? makePaneMaterial(true) : materials.pane;
    windowUniforms.uLit.value = lamps;
  };
  windows();
  siteUniforms.uBake.value = 1;
  const clay = new MeshStandardNodeMaterial({ color: new Color(0.42, 0.41, 0.4), roughness: 0.92, metalness: 0 });
  const materialOf = (name: string) => (state.clay ? clay : materials[name] ?? materials.stone);

  // ------------------------------------------------------------------ light from the sky, as the game gives what it does not bake
  /** Writes into a mesh's points the share of the whole sky's light that reaches each, from how much of the sky it sees. */
  const skyLight = (mesh: Mesh) => {
    const S = SKIES[state.hour], L = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
    const g = mesh.geometry, open = mesh.userData.open as Float32Array;
    const sh = (['aSHr', 'aSHg', 'aSHb'] as const).map((n) => g.getAttribute(n) as InterleavedBufferAttribute), bk = g.getAttribute('aBake') as InterleavedBufferAttribute;
    for (let i = 0; i < open.length; i++) {
      const o = 0.3 + 0.7 * open[i];
      for (let c = 0; c < 3; c++) sh[c].setXYZW(i, (Math.PI / 2) * L[c] * o, 0, (Math.PI / 2) * L[c] * 0.8 * o, 0);
      bk.setXY(i, o, 0.6);
    }
    sh[0].data.needsUpdate = true;
  };
  /**
   * Lets go of a mesh that is done with: its buffers on the graphics card, and its points here too. Disposing the geometry frees the
   * first, but the renderer goes on holding the geometry itself after the mesh has left the scene, and with it every array it was
   * made of: dragging the largest classical building's sliders about kept each of its old builds, 66 MB apiece, until there was no
   * memory left on a phone. So the arrays are emptied as well; nothing draws the mesh again.
   */
  const EMPTY = new Float32Array(0);
  const letGo = (m: Mesh) => {
    const g = m.geometry;
    g.dispose();
    for (const a of Object.values(g.attributes)) {
      if ((a as InterleavedBufferAttribute).isInterleavedBufferAttribute) (a as InterleavedBufferAttribute).data.array = EMPTY;
      else (a as BufferAttribute).array = EMPTY;
    }
    if (g.index) g.index.array = new Uint32Array(0);
    m.userData.open = EMPTY;
  };
  const meshOf = (name: string, builder: MeshBuilder): Mesh => {
    const mesh = new Mesh(builder.build(), materialOf(name));
    mesh.name = name;
    mesh.castShadow = name !== 'glass' && name !== 'window' && name !== 'pane' && name !== 'paneLit';
    mesh.receiveShadow = true;
    const open = new Float32Array(builder.vertexCount);
    for (let i = 0; i < open.length; i++) open[i] = builder.openAt(i);
    mesh.userData = { material: name, open };
    skyLight(mesh);
    return mesh;
  };

  // ------------------------------------------------------------------ what grows and what lies about
  // (Their surfaces are painted only when first wanted, by a tree, a boulder or a brush: until then the lab costs what it did.)
  let natureMade = false;
  const natureSurfaces = () => {
    if (natureMade) return;
    natureMade = true;
    // (The same recipes with the same seeds as `main.ts`; on a touch screen at 512, as a phone's are, since ten more surfaces are some
    // 120 MB at 1024 and a tablet's memory is what ran out before.)
    const n = query.get('tex') ? size : coarse || appleTouch ? Math.min(size, 512) : size;
    const N = {
      rock: generateTextureSet('rock', n, 13), ground: generateTextureSet('ground', n, 17), scree: generateTextureSet('scree', n, 23),
      bark: generateTextureSet('bark', n, 29), barkAsh: generateTextureSet('barkAsh', n, 59), barkPine: generateTextureSet('barkPine', n, 61), barkFir: generateTextureSet('barkFir', n, 67),
      soil: generateTextureSet('soil', n, 31), litter: generateTextureSet('litter', n, 37), thatch: generateTextureSet('thatch', n, 47),
    };
    doneGenerating();
    Object.assign(materials, {
      rock: makeRockMaterial(N.rock, T.moss),
      turf: makeGroundMaterial(N.ground, N.soil, N.scree, N.litter, N.thatch, T.moss),
      bark: makeSiteMaterial(N.bark, T.moss, { normalScale: 2.2, mossScale: 2.5, matt: true, deep: 0.06 }),
      barkAsh: makeSiteMaterial(N.barkAsh, T.moss, { normalScale: 1.6, mossScale: 2.5, matt: true, deep: 0.02, hollow: 0.5 }),
      barkPine: makeSiteMaterial(N.barkPine, T.moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.04, hollow: 0.35 }),
      barkFir: makeSiteMaterial(N.barkFir, T.moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.03, hollow: 0.6 }),
    });
    vegetationRange.value = 120;
  };
  /**
   * Leaves, grass and flowers are cards, drawn as the game draws them. Their shading needs where each stands in the world, so those of
   * a tree are not carried by its holder: they are kept as grown about its foot, and moved to where it stands whenever it is moved.
   */
  const cardGroup = new Group();
  scene.add(cardGroup);
  const allCards = new Set<InstancedMesh>(), cardTextures = new Map<string, Texture>();
  const makeCardMeshes = (sets: CardSet[]): InstancedMesh[] => {
    natureSurfaces();
    const out: InstancedMesh[] = [];
    for (const set of sets) {
      if (!set.matrices.length) continue;
      let tex = cardTextures.get(set.kind);
      if (!tex) cardTextures.set(set.kind, (tex = paintCards(set.kind)));
      for (const m of makeCards(set, tex)) { m.frustumCulled = false; cardGroup.add(m); allCards.add(m); out.push(m); }
    }
    return out;
  };
  const dropCards = (meshes: InstancedMesh[]) => {
    for (const m of meshes) { cardGroup.remove(m); allCards.delete(m); m.geometry.dispose(); (m.material as Material).dispose(); m.dispose(); }
  };
  const localOf = new WeakMap<object, Float32Array>();
  const placeCards = (meshes: InstancedMesh[], H: Matrix4) => {
    const seen = new Set<object>(), m4 = new Matrix4(), v = new Vector3(), k = Math.cbrt(Math.abs(H.determinant()));
    // (The layers of one block, near sprigs and far sprays, have attributes of their own over one array: each array is moved once,
    // and every attribute over it sent again. Moved once for each, the sprigs stood off the tree by as far again as it had moved.)
    const move = (attr: BufferAttribute, size: number, kind: 'matrix' | 'point' | 'stand') => {
      attr.needsUpdate = true;
      const out = attr.array as Float32Array;
      if (seen.has(out)) return;
      seen.add(out);
      let local = localOf.get(out);
      if (!local) localOf.set(out, (local = out.slice()));
      for (let i = 0; i < local.length / size; i++) {
        if (kind === 'matrix') m4.fromArray(local, i * 16).premultiply(H).toArray(out, i * 16);
        else { v.fromArray(local, i * size).applyMatrix4(H).toArray(out, i * size); if (kind === 'stand') out[i * 4 + 3] = local[i * 4 + 3] * k; }
      }
    };
    for (const m of meshes) {
      move(m.instanceMatrix as unknown as BufferAttribute, 16, 'matrix');
      const at = m.geometry.getAttribute('aAt'), centre = m.geometry.getAttribute('aCentre');
      if (at) move(at as BufferAttribute, 4, 'stand');
      if (centre) move(centre as BufferAttribute, 3, 'point');
      m.computeBoundingSphere();
    }
  };
  // The painted layers: the ground's sheet (in place of the plain paving once anything is laid on it), plants, and rock.
  const natureLayer = new Group();
  scene.add(natureLayer);
  const layers = { ground: null as Mesh | null, rock: null as Mesh | null, plants: [] as Mesh[], cards: [] as InstancedMesh[] };
  let kit: ReturnType<typeof natureKit> | null = null, kitFor = '';
  const kitOf = () => { const k = `${state.stone} ${state.season}`; if (!kit || kitFor !== k) { kit = natureKit({ stone: state.stone, season: state.season }); kitFor = k; } return kit; };

  // ------------------------------------------------------------------ the square
  const groundGroup = new Group();
  scene.add(groundGroup);
  let ground: Mesh | null = null;
  const lay = () => {
    if (ground) { groundGroup.remove(ground); letGo(ground); }
    const b = new MeshBuilder(), c = stoneColour(state.stone);
    // (A paving of the country's stone, broad enough that its edge is seldom seen.)
    plainSolids(() => b).block('floor', new Vector3(-400, -0.4, -400), new Vector3(400, 0, 400), [c[0] * 0.66, c[1] * 0.66, c[2] * 0.66]);
    ground = meshOf('floor', b);
    ground.castShadow = false;
    groundGroup.add(ground);
  };
  lay();
  const grid = new GridHelper(240, 240, 0x6b6253, 0x4a443a);
  for (const m of [grid.material].flat()) { m.transparent = true; m.opacity = 0.32; m.depthWrite = false; }
  grid.position.y = 0.015;
  scene.add(grid);

  // ------------------------------------------------------------------ buildings
  /** What is built of an item: its meshes, the box they fill, the ground it stands on, what it was built from, when and how long it took. */
  interface Built { holder: Group; meshes: Mesh[]; cards: InstancedMesh[]; box: Box3; rects: { u0: number; u1: number; v0: number; v1: number }[]; sig: string; ms: number; at: number; triangles: number }
  const built = new Map<number, Built>();
  const dirty = new Set<number>();
  const world = new Group();
  scene.add(world);
  const itemOf = (id: number | null) => (id === null ? undefined : state.items.find((it) => it.id === id));
  const selectedItem = () => itemOf(state.selected);
  // (What stands close about a building is part of what it is built from: a window that would look into another building is left out,
  // and comes back when that one is moved away.)
  const nearItem = (it: Item) => nearOf(it, state.items);
  /** How high a thing rises over the square: what was built of it, or near enough until it is built. (To half a metre, so that its own small changes do not grow the trees about it again.) */
  const topOf = (q: Item) => { const b = built.get(q.id); const top = b && !b.box.isEmpty() ? b.box.max.y * q.scale[1] : eavesOf(q) * q.scale[1] + 4; return Math.ceil((top + liftOf(q)) * 2) / 2; };
  // (And a tree's room: what stands about it, which its boughs keep out of, so that one moved up to a wall grows again against it.)
  const roomItem = (it: Item) => (it.kind === 'tree' ? roomOf(it, state.items, topOf, state.paint.rock) : undefined);
  const sigOf = (it: Item) => JSON.stringify([it.kind, it.seed, it.shape, !!it.inn, state.stone, nearItem(it) ?? null, it.kind === 'tree' ? [state.season, roomItem(it)] : '']);
  /** Puts what is built of an item where the item says it stands, turned and scaled. (Built facing `w`, its front towards -x: a quarter turn more faces it to +z.) */
  const placeItem = (it: Item) => {
    const b = built.get(it.id);
    if (!b) return;
    // (Set up by half its fall, where the ground falls along its front, so that the lower end of its sloping ground meets the square.)
    b.holder.position.set(it.x, liftOf(it), it.z);
    b.holder.rotation.set(0, Math.PI / 2 + rad(it.turn), 0);
    b.holder.scale.set(it.scale[2], it.scale[1], it.scale[0]);
    b.holder.updateMatrixWorld(true);
    if (b.cards.length) placeCards(b.cards, b.holder.matrixWorld);
  };
  /** Builds an item again from its document. If the builder fails, what was there stays, and the reason is shown. */
  const rebuild = (it: Item): boolean => {
    const builders = new Map<string, MeshBuilder>(), t0 = performance.now();
    let made: { cards?: CardSet[] } = {};
    try {
      const into = (m: string) => { let x = builders.get(m); if (!x) builders.set(m, (x = new MeshBuilder())); return x; };
      if (isNature(it.kind)) natureSurfaces();
      made = buildItem(it, state.stone, into, nearItem(it), state.season, roomItem(it));
      const c = stoneColour(state.stone);
      buildGround(it, into, [c[0] * 0.66, c[1] * 0.66, c[2] * 0.66]);
    } catch (e) {
      console.error(e);
      say(`${KINDS[it.kind].name} could not be built as it is: ${(e as Error).message}`, 'bad', 20);
      return false;
    }
    let b = built.get(it.id);
    if (!b) { b = { holder: new Group(), meshes: [], cards: [], box: new Box3(), rects: [], sig: '', ms: 0, at: 0, triangles: 0 }; world.add(b.holder); built.set(it.id, b); }
    for (const m of b.meshes) { b.holder.remove(m); letGo(m); }
    dropCards(b.cards);
    b.cards = made.cards?.length ? makeCardMeshes(made.cards) : [];
    b.meshes = []; b.box.makeEmpty(); b.triangles = 0;
    for (const [name, builder] of builders) {
      if (!builder.vertexCount) continue;
      const m = meshOf(name, builder);
      b.holder.add(m); b.meshes.push(m);
      b.box.union(m.geometry.boundingBox!);
      b.triangles += (m.geometry.index?.count ?? 0) / 3;
    }
    b.rects = footprintOf({ ...it.shape, x: 0, z: 0, faces: 'w' } as Building);
    b.sig = sigOf(it); b.ms = performance.now() - t0; b.at = performance.now();
    placeItem(it);
    changed(true);
    return true;
  };
  /** Marks to be built again every building whose neighbours have come or gone close enough to shut a window of it, or open one. */
  const neighbours = () => { for (const it of state.items) { const b = built.get(it.id); if (b && b.sig !== sigOf(it)) dirty.add(it.id); } };
  /** Brings what is built into line with what is set out: new items built, changed ones built again (in the loop, a few at a time), gone ones taken away. */
  const sync = () => {
    for (const [id, b] of built) if (!itemOf(id)) { world.remove(b.holder); for (const m of b.meshes) letGo(m); dropCards(b.cards); built.delete(id); dirty.delete(id); }
    for (const it of state.items) { const b = built.get(it.id); if (!b || b.sig !== sigOf(it)) dirty.add(it.id); else placeItem(it); }
    changed(true);
  };
  const dress = () => {
    for (const b of built.values()) for (const m of b.meshes) m.material = materialOf(m.userData.material);
    for (const m of natureLayer.children as Mesh[]) m.material = materialOf(m.userData.material);
    if (ground) ground.material = materialOf('floor');
    shadowsDue = 3;
  };
  /** Rays from the eye against the ground each building stands on, raised to its height: the nearest building met, and where. */
  const pick = (ray: Ray): { id: number; point: Vector3 } | null => {
    let best: { id: number; point: Vector3; far: number } | null = null;
    const local = new Ray(), at = new Vector3(), box = new Box3();
    for (const [id, b] of built) {
      const it = itemOf(id);
      if (!it || b.box.isEmpty()) continue;
      local.copy(ray).applyMatrix4(b.holder.matrixWorld.clone().invert());
      for (const r of b.rects) {
        box.min.set(-it.shape.d / 2 + r.v0, b.box.min.y, r.u0);
        box.max.set(-it.shape.d / 2 + r.v1, b.box.max.y, r.u1);
        if (!local.intersectBox(box, at)) continue;
        const p = at.clone().applyMatrix4(b.holder.matrixWorld), far = p.distanceTo(ray.origin);
        if (!best || far < best.far) best = { id, point: p, far };
      }
    }
    return best;
  };

  // ------------------------------------------------------------------ light
  const sunDir = new Vector3();
  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  // (Half as fine on a touch screen, where memory is shorter: some five centimetres a texel over a square of a hundred metres.)
  sun.shadow.mapSize.setScalar(coarse ? 2048 : 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);
  const makeSky = (disc: boolean) => {
    const sky = new SkyMesh();
    sky.scale.setScalar(10000);
    sky.turbidity.value = 3.2; sky.rayleigh.value = 1.4; sky.mieCoefficient.value = 0.004; sky.mieDirectionalG.value = 0.82;
    sky.cloudCoverage.value = 0.2; sky.cloudDensity.value = 0.5;
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
  { const aired = rtt(atmosphere.node); pipeline.outputNode = aired.add(bloom(aired, 0.14, 0.5, 1.8)); }

  /** The part of the square that is lit closely and casts shadows: all that is set out, and a margin. */
  const near = { min: new Vector3(-30, -1, -30), max: new Vector3(30, 30, 30) };
  let shadowsDue = 3, staticAt = 0;
  const aimSun = () => {
    const box = new Box3();
    for (const b of built.values()) if (!b.box.isEmpty()) box.union(b.box.clone().applyMatrix4(b.holder.matrixWorld));
    if (box.isEmpty()) box.set(new Vector3(-20, 0, -20), new Vector3(20, 20, 20));
    box.expandByScalar(6);
    box.min.y = Math.min(box.min.y, -1);
    near.min.copy(box.min); near.max.copy(box.max);
    const centre = box.getCenter(new Vector3()), radius = box.getSize(new Vector3()).length() / 2;
    sun.position.copy(centre).addScaledVector(sunDir, radius + 5);
    sun.target.position.copy(centre);
    sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: radius * 2 + 10 });
    sun.shadow.camera.updateProjectionMatrix();
    atmosphere.uniforms.uAirCentre.value.copy(centre);
  };
  /** Something set out has moved or been built again: shadows are drawn again, and the air's picture of what stands, once things settle. */
  function changed(rebuilt: boolean) {
    shadowsDue = Math.max(shadowsDue, 2);
    aimSun();
    if (rebuilt || !staticAt) staticAt = performance.now() + 400;
  }
  const light = () => {
    const S = SKIES[state.hour], d = S.sun, l = Math.hypot(d[0], d[1], d[2]);
    sunDir.set(d[0] / l, d[1] / l, d[2] / l);
    sun.color.setRGB(S.colour[0], S.colour[1], S.colour[2]);
    sun.intensity = S.intensity;
    for (const k of [sky, envSky]) if (S.disc) k.sunPosition.value.set(S.disc[0], S.disc[1], S.disc[2]).normalize(); else k.sunPosition.value.copy(sunDir);
    env?.dispose();
    env = pmrem.fromScene(envScene, 0, 1, 20000);
    scene.environment = env.texture;
    skyCamera.update(renderer, envScene);
    const mean = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]), u = atmosphere.uniforms, low = state.hour === 'sunset' || state.hour === 'dusk', night = S.night ?? 0;
    siteUniforms.uFallback.value.set(mean[0] * 0.9, mean[1] * 0.82, mean[2] * 0.71);
    u.uSunColor.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 1.7);
    u.uSkyColor.value.set(mean[0], mean[1], mean[2]).multiplyScalar(1.75);
    u.tSky.value = skyPicture.texture;
    u.uAirOn.value = 1;
    u.uHaze.value.set((0.00014 + 0.001 * 0.25) * (low ? 1.35 : 1), 320, 0);
    if (!S.disc || S.disc[1] > 0) u.uGlare.value.set(S.colour[0], S.colour[1], S.colour[2]).multiplyScalar(S.intensity * 0.018 * 0.9); else u.uGlare.value.set(0, 0, 0);
    u.uSkyZenith.value.set(S.zenith[0], S.zenith[1], S.zenith[2]);
    u.uSkyHorizon.value.set(S.horizon[0], S.horizon[1], S.horizon[2]);
    if (S.disc) { u.uGlowDir.value.set(S.disc[0], S.disc[1], S.disc[2]); u.uGlow.value.set(0.55, 0.22, 0.14).multiplyScalar(night > 0.9 ? 0.05 : 1); } else u.uGlow.value.set(0, 0, 0);
    u.uNight.value = night;
    u.uDensity.value = 0.0018;
    u.uIndoorDensity.value = 14;
    u.uEnabled.value = state.air ? 1 : 0;
    for (const b of built.values()) for (const m of b.meshes) skyLight(m);
    if (ground) skyLight(ground);
    aimSun();
    shadowsDue = 3;
    staticAt = performance.now();
  };

  // ------------------------------------------------------------------ choosing, adding, taking away
  const select = (id: number | null) => {
    if (state.selected === id) return;
    state.selected = id;
    renderSelected();
    remember();
  };
  /** Where the middle of the view meets the ground: where a building added from the panel first stands. */
  const viewCentre = () => {
    const p = levelAt(new Ray(camera.position.clone(), controls.target.clone().sub(camera.position).normalize())) ?? controls.target.clone();
    return { x: snapped(p.x), z: snapped(p.z) };
  };
  const add = (kind: Kind, o: { follow?: boolean; seed?: string; x?: number; z?: number; turn?: number; shape?: (seed: string) => Shape } = {}): Item => {
    const seed = o.seed ?? Math.random().toString(36).slice(2, 8), at = viewCentre();
    const it: Item = { id: state.next++, kind, seed, x: o.x ?? at.x, z: o.z ?? at.z, turn: o.turn ?? 0, scale: [1, 1, 1], inn: false, shape: o.shape ? o.shape(seed) : deal(kind, seed, state.stone) };
    state.items.push(it);
    sync();
    rebuild(it); dirty.delete(it.id);
    if (!o.follow && o.x === undefined) findRoom(it);
    state.selected = null;
    select(it.id);
    // With a mouse, what is added follows the pointer until a click puts it down; by touch it stands in the middle of the view, to be dragged.
    if (o.follow) { placing = it.id; say(`${KINDS[kind].name}: click where it is to stand. Esc takes it back.`, 'dim', 12); }
    else commit();
    return it;
  };
  /** Moves a building that would stand in another to the nearest clear ground, looking first on the side towards the eye. */
  const findRoom = (it: Item) => {
    const x0 = it.x, z0 = it.z, toEye = Math.atan2(camera.position.x - x0, camera.position.z - z0);
    const clear = () => { const mine = groundOf(it, 0.08); return !state.items.some((q) => q !== it && groundOf(q, 0.08).some((a) => mine.some((c) => overlaps(a, c)))); };
    for (let r = 0; r <= 90; r += 3) {
      const n = r ? Math.ceil((2 * Math.PI * r) / 6) : 1;
      for (let k = 0; k < n; k++) {
        // (Round from the side towards the eye, both ways at once.)
        const a = toEye + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((2 * Math.PI) / n);
        it.x = snapped(x0 + Math.sin(a) * r); it.z = snapped(z0 + Math.cos(a) * r);
        placeItem(it);
        if (clear()) { changed(false); return; }
      }
    }
    it.x = x0; it.z = z0; placeItem(it);
  };
  const placed = () => { if (placing === null) return; placing = null; say('Put down', 'good', 2); commit(); };
  const remove = (id: number | null) => {
    const it = itemOf(id);
    if (!it) return;
    state.items = state.items.filter((q) => q !== it);
    if (placing === id) placing = null;
    state.selected = null;
    sync(); renderSelected(); commit();
  };
  /** Another of the same beside it: `same` keeps every measure, otherwise a new one of its kind is dealt. */
  const nextDoor = (same: boolean) => {
    const prev = selectedItem();
    if (!prev) return;
    const seed = Math.random().toString(36).slice(2, 8);
    const it: Item = same ? { ...clone(prev), id: state.next++, seed } : { ...clone(prev), id: state.next++, seed, scale: [1, 1, 1], inn: false, shape: deal(prev.kind, seed, state.stone) };
    besides(prev, it);
    state.items.push(it);
    sync(); state.selected = null; select(it.id); commit();
  };
  /** A street front of brick, dealt as a town deals one: mostly merchants' houses, now and then a broad house or a warehouse, wall to wall. */
  const street = (of: 'brick' | 'canal') => {
    const at = viewCentre(), rng = Math.random().toString(36).slice(2, 6);
    let prev: Item | null = null;
    for (let k = 0; k < (of === 'canal' ? 8 : 7); k++) {
      const kind = of === 'canal' ? 'canal' : (['gabled', 'gabled', 'gabled', 'gabled', 'eaves', 'eaves', 'store'] as Kind[])[Math.floor(Math.random() * 7)], seed = `${rng}${k}`;
      const it: Item = { id: state.next++, kind, seed, x: at.x, z: at.z, turn: 0, scale: [1, 1, 1], shape: deal(kind, seed, state.stone) };
      // (Canal houses stand wall against wall; now and then a street of brick has a lane between.)
      if (prev) besides(prev, it, of === 'brick' && Math.random() < 0.15 ? 3.5 : 0);
      else { const span = 60; it.x = at.x - span / 2; }
      state.items.push(it);
      prev = it;
    }
    sync(); select(prev!.id); commit();
    say(of === 'canal' ? 'Eight canal houses, dealt as a town deals them' : 'A street of seven houses, dealt as a town deals them', 'good');
  };
  const demo = (): void => {
    state.items = [];
    const put = (kind: Kind, seed: string, x: number, z: number, turn: number, shape?: (s: Shape) => void, inn = false): Item => {
      const s = deal(kind, seed, state.stone);
      shape?.(s);
      const it: Item = { id: state.next++, kind, seed, x, z, turn, scale: [1, 1, 1], inn, shape: normalise(kind, s, 'bays') };
      state.items.push(it);
      return it;
    };
    put('classical', 'lab1', 0, -6, 0, (s) => { s.bays = 9; s.w = 9 * 2.55 + 1.6; s.storeys = 3; s.heights = [3.8, 4.4, 3.2]; s.portico = true; s.d = 10.6; s.wings = [{ side: -1, width: 6.6, length: 11 }, { side: 1, width: 6.6, length: 11 }]; });
    put('timber', 'lab2', -29, 9, 32, (s) => { s.gable = true; s.storeys = 3; }, true);
    put('timber', 'lab3', -32, -3, 40, (s) => { s.gable = false; });
    put('wooden', 'lab9', -13, 25, 8, (s) => { s.w = 15; s.bays = 6; s.dormers = 2; s.storeys = 1; s.heights = [3.4]; s.basement = 1.2; });
    put('shack', 'lab10', 9, 27, -12, (s) => { s.shack!.roof = 'tin'; s.shack!.lean = false; });
    put('shack', 'lab11', 15, 29, -28, (s) => { s.shack!.roof = 'boards'; s.shack!.lean = true; });
    let prev = put('gabled', 'lab4', 23, 13, -20, (s) => { s.brickwork!.gable = 'stepped'; });
    for (const [kind, seed, gable] of [['gabled', 'lab5', 'volute'], ['eaves', 'lab6', 'plain'], ['gabled', 'lab7', 'piers']] as [Kind, string, 'stepped' | 'piers' | 'volute' | 'plain'][]) {
      const it = put(kind, seed, 0, 0, 0, (s) => { s.brickwork!.gable = gable; });
      besides(prev, it);
      prev = it;
    }
    state.selected = state.items[0].id;
  };

  // ------------------------------------------------------------------ undoing
  const history: string[] = [];
  let at = -1;
  const snapshot = () => JSON.stringify({ items: state.items, next: state.next, selected: state.selected, paint: state.paint });
  function commit() {
    // (What was painted grows again where what stands about it has changed: a wood beside a building just moved.)
    if (state.paint.plants.length) paintLayers();
    const s = snapshot();
    if (history[at] !== s) {
      history.splice(at + 1);
      history.push(s);
      if (history.length > 200) history.shift();
      at = history.length - 1;
    }
    remember();
    reflectTools();
  }
  const restore = (s: string) => {
    const o = JSON.parse(s);
    state.items = o.items; state.next = o.next; state.selected = o.selected; state.paint = readPaint(o.paint);
    placing = null;
    sync(); paintLayers(); renderSelected(); remember(); reflectTools();
  };
  const undo = () => { if (at > 0) { at--; restore(history[at]); say('Undone', 'dim', 2); } };
  const redo = () => { if (at < history.length - 1) { at++; restore(history[at]); say('Done again', 'dim', 2); } };

  /** How far a tree's crown reaches from its trunk, in its own measures. */
  const crownOfTree = (q: Item) => crownOf(q.shape.tree!);

  // ------------------------------------------------------------------ the brushes
  // Laid on the square with the Paint tool (see `nature.ts`): a stroke is a trail of dabs, each where the pointer met the square or
  // rock. The ground is laid again as the stroke goes, as often as that can be done without holding the page up; plants and rock when
  // it is let go, since a wood or a hill takes a moment to grow or carve.
  const DOWN = new Vector3(0, -1, 0), downRay = new Raycaster();
  (downRay as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
  /** How high plants stand at a point: on rock where there is rock, on the square elsewhere. Nothing grows inside a building. */
  const heightAt = (x: number, z: number): number | null => {
    if (state.items.some((it) => !isNature(it.kind) && standsIn(it, x, z, 0.25))) return null;
    if (layers.rock) { downRay.set(new Vector3(x, 500, z), DOWN); const hit = downRay.intersectObject(layers.rock, false)[0]; if (hit) return hit.point.y; }
    return 0;
  };
  const layGround = () => {
    if (layers.ground) { natureLayer.remove(layers.ground); letGo(layers.ground); layers.ground = null; }
    if (state.paint.ground.length) { natureSurfaces(); layers.ground = meshOf('turf', kitOf().groundSheet(state.paint.ground)); layers.ground.castShadow = false; natureLayer.add(layers.ground); }
  };
  const carveRocks = () => {
    if (layers.rock) { natureLayer.remove(layers.rock); letGo(layers.rock); layers.rock = null; }
    const mass = state.paint.rock.length ? kitOf().carveMass(state.paint.rock) : null;
    if (!mass) return;
    natureSurfaces();
    const m = meshOf('rock', mass);
    (m.geometry as unknown as { boundsTree: MeshBVH }).boundsTree = new MeshBVH(m.geometry);
    m.raycast = acceleratedRaycast;
    natureLayer.add(m);
    layers.rock = m;
  };
  const growPlants = () => {
    for (const m of layers.plants) { natureLayer.remove(m); letGo(m); }
    dropCards(layers.cards);
    layers.plants = []; layers.cards = [];
    if (!state.paint.plants.length) return;
    natureSurfaces();
    // (Their boughs keep out of the buildings and the boulders, as a tree set out does; the rock they grow on, they stand on.)
    const solid = state.items.filter((it) => it.kind !== 'tree');
    const made = kitOf().growPainted(state.paint.plants, heightAt, (p) => p.y > -1 && solid.some((it) => p.y < topOf(it) + 0.3 && standsIn(it, p.x, p.z, 0.35)));
    for (const [name, builder] of made.meshes) if (builder.vertexCount) { const m = meshOf(name, builder); natureLayer.add(m); layers.plants.push(m); }
    layers.cards = makeCardMeshes(made.cards);
  };
  let paintedSig = { ground: '', rock: '', plants: '' };
  /** Lays again whatever of what was painted has changed since it was last laid. Returns how long that took, in milliseconds. */
  const paintLayers = (): number => {
    const t0 = performance.now(), P = state.paint;
    const standing = state.items.filter((it) => it.kind !== 'tree').map((it) => [it.kind, it.x, it.z, it.turn, it.scale, it.shape.w, it.shape.d, topOf(it)]);
    const sig = { ground: JSON.stringify([P.ground, state.stone]), rock: JSON.stringify([P.rock, state.stone]), plants: JSON.stringify([P.plants, P.rock, state.season, state.stone, P.plants.length ? standing : 0]) };
    if (sig.ground !== paintedSig.ground) layGround();
    if (sig.rock !== paintedSig.rock) carveRocks();
    if (sig.plants !== paintedSig.plants) growPlants();
    paintedSig = sig;
    changed(true);
    return performance.now() - t0;
  };
  // The brush's ring on the ground, as large as it is.
  // (A line round and back to its start: the renderer draws no loops.)
  const brushRing = new Line(new BufferGeometry().setFromPoints(Array.from({ length: 73 }, (_, i) => new Vector3(Math.cos((i / 72) * Math.PI * 2), 0, Math.sin((i / 72) * Math.PI * 2)))), new LineBasicMaterial({ color: 0xe3b56b, transparent: true, opacity: 0.95, depthTest: false }));
  brushRing.visible = false;
  brushRing.renderOrder = 10;
  scene.add(brushRing);
  /** Where the brush is: where the pointer meets rock (with plants or rock in hand) or else the square; and which way that faces. */
  const brushPoint = (e: PointerEvent): { p: Vector3; n: Vector3 } | null => {
    const ray = rayAt(e.clientX, e.clientY);
    if (state.brush.layer !== 'ground' && layers.rock) {
      downRay.ray.copy(ray);
      const hit = downRay.intersectObject(layers.rock, false)[0];
      if (hit) return { p: hit.point.clone(), n: hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new Vector3(0, 1, 0) };
    }
    const p = levelAt(ray);
    return p && Math.abs(p.x) < 400 && Math.abs(p.z) < 400 ? { p, n: new Vector3(0, 1, 0) } : null;
  };
  let stroke: { pointer: number; last: Vector3 | null; id: number; before: string } | null = null, groundDue = 0;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  /** Whether a dab takes away (plants) or digs (rock): as chosen, or the other way with Shift held. */
  const digging = (e: { shiftKey: boolean }) => state.brush.layer !== 'ground' && state.brush.dig !== e.shiftKey;
  const dab = (at: { p: Vector3; n: Vector3 }, dig: boolean) => {
    const B = state.brush, r = B.size, P = state.paint, p = at.p;
    if (B.layer === 'ground') P.ground.push([round2(p.x), round2(p.z), round2(r), B.ground, stroke!.id]);
    else if (B.layer === 'plants') {
      if (dig) P.plants = P.plants.filter((d) => Math.hypot(d[0] - p.x, d[2] - p.z) > r);
      else P.plants.push([round2(p.x), round2(p.y), round2(p.z), round2(r), B.plant, 0, Math.floor(Math.random() * 1e9)]);
    } else {
      // (Rock stands out of what it is laid on by half the brush, or is sunk into it to dig: so a mass is built up stroke by stroke.)
      const c = p.clone().addScaledVector(at.n, r * (dig ? -0.3 : 0.5));
      P.rock.push([round2(c.x), round2(c.y), round2(c.z), round2(r), dig ? -1 : 1]);
    }
    stroke!.last = p.clone();
  };
  function paintDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const at = brushPoint(e);
    if (!at) return false;
    const ids = state.paint.ground.map((d) => d[4]);
    stroke = { pointer: e.pointerId, last: null, id: (ids.length ? Math.max(...ids) : 0) + 1, before: JSON.stringify(state.paint) };
    canvas.setPointerCapture(e.pointerId);
    dab(at, digging(e));
    if (state.brush.layer === 'ground') { paintLayers(); groundDue = performance.now() + 150; }
    return true;
  }
  function paintMove(e: PointerEvent) {
    const at = brushPoint(e);
    brushRing.visible = !!at && state.overlays;
    if (at) { brushRing.position.set(at.p.x, at.p.y + 0.04, at.p.z); brushRing.scale.setScalar(state.brush.size); }
    if (!stroke || stroke.pointer !== e.pointerId || !at) return;
    if (stroke.last && at.p.distanceTo(stroke.last) < Math.max(0.2, state.brush.size * (state.brush.layer === 'ground' ? 0.3 : 0.6))) return;
    dab(at, digging(e));
    if (state.brush.layer === 'ground' && performance.now() > groundDue) { const ms = paintLayers(); groundDue = performance.now() + Math.max(120, ms * 2); }
  }
  function paintUp(e: PointerEvent): boolean {
    if (!stroke || stroke.pointer !== e.pointerId) return false;
    stroke = null;
    const ms = paintLayers();
    say(`Laid in ${ms.toFixed(0)} ms`, 'dim', 3);
    commit();
    return true;
  }
  /** Takes back the stroke being drawn. */
  function paintCancel() {
    if (!stroke) return;
    state.paint = readPaint(JSON.parse(stroke.before));
    stroke = null;
    paintLayers();
  }

  // ------------------------------------------------------------------ snapping
  function snapped(v: number) { return state.snap ? Math.round(v / state.snap) * state.snap : Math.round(v * 100) / 100; }
  const turned = (v: number, free = false) => { const t = state.turnSnap && !free ? Math.round(v / state.turnSnap) * state.turnSnap : Math.round(v * 10) / 10; return ((((t + 180) % 360) + 360) % 360) - 180; };

  // ------------------------------------------------------------------ the knobs: turning, extruding, scaling
  // A knob stands at a point of the selected building; dragged, it moves along a line (an arrow on a face, which changes one of the
  // building's measures, or a scale), or round the building on the ground (the ring, which turns it). The knobs are drawn over the
  // picture, so they are the same size near and far and are easy to take with a finger.
  /** A point in the building's own measures (`u` across its front, `y` up, `v` back from its front), and a direction, in the world. */
  const worldAt = (it: Item, u: number, y: number, v: number) => new Vector3(-it.shape.d / 2 + v, y, u).applyMatrix4(built.get(it.id)!.holder.matrixWorld);
  const AXES = { u: new Vector3(0, 0, 1), v: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0) };
  const worldDir = (it: Item, axis: keyof typeof AXES, sign = 1) => AXES[axis].clone().multiplyScalar(sign).applyQuaternion(built.get(it.id)!.holder.quaternion).normalize();
  /** How many metres of the world one metre of the building's own measure is, along one of its axes. */
  const stretchOf = (it: Item, axis: keyof typeof AXES) => (axis === 'u' ? it.scale[0] : axis === 'y' ? it.scale[1] : it.scale[2]);

  interface Knob {
    id: string; label: string; at: Vector3; colour: string;
    /** Dragged along a line: its axis in the building, and which way along it is outward. Or round the building, on the ground. */
    axis?: keyof typeof AXES; sign?: number; ring?: boolean;
    /** From the item as it was when the drag began and how far the knob has been dragged (in the building's own metres along its axis), the item now. */
    drag: (it: Item, start: Item, by: number, e: PointerEvent) => void;
  }
  /** Reshapes from the start: one measure changed, the shape brought back within what its kind can be, and the building moved so that the face opposite the one dragged stays where it was. */
  const reshape = (it: Item, start: Item, change: (s: Shape) => void, keep?: { axis: 'u' | 'v'; sign: number; of: (s: Shape) => number }, asked: 'w' | 'bays' = 'w') => {
    const s = clone(start.shape);
    change(s);
    it.shape = normalise(it.kind, s, asked);
    if (keep) {
      const grew = keep.of(it.shape) - keep.of(start.shape), dir = worldDir(it, keep.axis, keep.sign);
      it.x = Math.round((start.x + dir.x * (grew / 2) * stretchOf(it, keep.axis)) * 100) / 100;
      it.z = Math.round((start.z + dir.z * (grew / 2) * stretchOf(it, keep.axis)) * 100) / 100;
    }
    dirty.add(it.id);
  };
  const AMBER = '#e0b070', BLUE = '#8cc4ff', GREEN = '#a8dc8c', ROSE = '#ff9fb0';
  const knobsOf = (it: Item): Knob[] => {
    const b = built.get(it.id);
    if (!b || b.box.isEmpty()) return [];
    const s = it.shape, W = s.w, D = s.d, E = eavesOf(it), top = b.box.max.y, out: Knob[] = [];
    if (state.tool === 'move') {
      // The ring: its knob stands before the front, and wherever it is dragged round, the front looks that way.
      const centre = new Vector3(it.x, 0, it.z), reach = ringOf(it);
      out.push({ id: 'turn', label: `${Math.round(it.turn)}°`, colour: AMBER, ring: true, at: centre.clone().addScaledVector(axesOf(it.turn).front, reach),
        drag: (q, _start, _by, e) => { const p = levelAt(rayAt(e.clientX, e.clientY)); if (p) { q.turn = turned(deg(Math.atan2(p.x - q.x, p.z - q.z)), e.shiftKey); placeItem(q); changed(false); } } });
      return out;
    }
    if (state.tool === 'paint') return out;
    if (state.tool === 'scale') {
      // Corners scale the whole; the knobs on the faces stretch it one way only; the one on top, upward.
      const sc = (q: Item, start: Item, k: number[], by: number, extent: number, e: PointerEvent) => {
        const f = Math.max(0.05, (extent + by) / Math.max(0.5, extent));
        const step = e.shiftKey ? 0.01 : 0.05;
        q.scale = start.scale.map((v, i) => (k.includes(i) ? Math.min(5, Math.max(0.2, Math.round((v * f) / step) * step)) : v)) as [number, number, number];
        placeItem(q); changed(false);
      };
      for (const [cu, cv] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
        const u = (cu * W) / 2, v = cv * D, p = worldAt(it, u, 0, v), centre = new Vector3(it.x, 0, it.z);
        out.push({ id: `corner${cu}${cv}`, label: cu > 0 && cv === 0 ? `×${it.scale[0].toFixed(2)}` : '', colour: AMBER, at: p,
          drag: (q, start, _by, e) => {
            // (A corner is dragged on the ground: how far it is now from the middle, against how far it was.)
            const g = levelAt(rayAt(e.clientX, e.clientY));
            if (!g) return;
            const was = Math.hypot(p.x - centre.x, p.z - centre.z), now = Math.hypot(g.x - centre.x, g.z - centre.z);
            const f = start.scale.map((v) => v * (now / Math.max(0.5, was)));
            const step = e.shiftKey ? 0.01 : 0.05, k = f[0] / start.scale[0];
            q.scale = start.scale.map((v) => Math.min(5, Math.max(0.2, Math.round((v * k) / step) * step))) as [number, number, number];
            placeItem(q); changed(false);
          } });
      }
      out.push(
        { id: 'stretchU', label: 'breadth', colour: BLUE, at: worldAt(it, W / 2, E / 2, D / 2), axis: 'u', sign: 1, drag: (q, st, by, e) => sc(q, st, [0], by * st.scale[0], (W / 2) * st.scale[0], e) },
        { id: 'stretchV', label: 'depth', colour: BLUE, at: worldAt(it, 0, E / 2, D), axis: 'v', sign: 1, drag: (q, st, by, e) => sc(q, st, [2], by * st.scale[2], (D / 2) * st.scale[2], e) },
        { id: 'stretchY', label: 'height', colour: BLUE, at: worldAt(it, 0, top, D / 2), axis: 'y', sign: 1, drag: (q, st, by, e) => sc(q, st, [1], by * st.scale[1], top * st.scale[1], e) },
      );
      return out;
    }
    // (A tree is extruded by its top, which makes it taller, and the edge of its crown, which spreads it; a boulder by its top.)
    if (it.kind === 'tree') {
      const t = s.tree!, wideOf = (q: Item) => crownOfTree(q);
      out.push({ id: 'height', label: `${t.height.toFixed(1)} m`, colour: GREEN, at: worldAt(it, 0, top + 0.4, D / 2), axis: 'y', sign: 1, drag: (q, st, by) => reshape(q, st, (x) => { x.tree!.height = st.shape.tree!.height + by; }) });
      out.push({ id: 'spread', label: 'spread', colour: AMBER, at: worldAt(it, wideOf(it), Math.min(top * 0.6, 8), D / 2), axis: 'u', sign: 1, drag: (q, st, by) => reshape(q, st, (x) => { x.tree!.wide = st.shape.tree!.wide * (1 + by / Math.max(1, wideOf(st))); }) });
      // (The trunk, by a knob at its side at the height of a hand: dragged out, it grows thicker.)
      out.push({ id: 'trunk', label: 'trunk', colour: AMBER, at: worldAt(it, t.girth + 0.25, Math.min(1.3, top * 0.3), D / 2), axis: 'u', sign: 1, drag: (q, st, by) => reshape(q, st, (x) => { x.tree!.girth = st.shape.tree!.girth + by * 0.25; }) });
      return out;
    }
    if (it.kind === 'boulder') {
      out.push({ id: 'size', label: `${s.boulder!.size.toFixed(1)} m`, colour: GREEN, at: worldAt(it, 0, top + 0.3, D / 2), axis: 'y', sign: 1, drag: (q, st, by) => reshape(q, st, (x) => { x.boulder!.size = st.shape.boulder!.size + by * 1.4; }) });
      return out;
    }
    // Extruding: each face's arrow changes the measure it stands on, and the building is built again as it goes.
    const mid = Math.min(E / 2, 6);
    const church = it.kind === 'church';
    out.push(
      { id: 'right', label: church ? 'length' : 'width', colour: AMBER, at: worldAt(it, W / 2, mid, D / 2), axis: 'u', sign: 1,
        drag: (q, st, by) => reshape(q, st, (t) => { t.w = st.shape.w + by; }, { axis: 'u', sign: 1, of: (t) => t.w }) },
      { id: 'left', label: church ? 'length' : 'width', colour: AMBER, at: worldAt(it, -W / 2, mid, D / 2), axis: 'u', sign: -1,
        drag: (q, st, by) => reshape(q, st, (t) => { t.w = st.shape.w + by; }, { axis: 'u', sign: -1, of: (t) => t.w }) },
      { id: 'front', label: church ? 'breadth' : 'depth', colour: AMBER, at: worldAt(it, 0, mid, 0), axis: 'v', sign: -1,
        drag: (q, st, by) => reshape(q, st, (t) => { t.d = st.shape.d + by; }, { axis: 'v', sign: -1, of: (t) => t.d }) },
      { id: 'back', label: church ? 'breadth' : 'depth', colour: AMBER, at: worldAt(it, 0, mid, D), axis: 'v', sign: 1,
        drag: (q, st, by) => reshape(q, st, (t) => { t.d = st.shape.d + by; }, { axis: 'v', sign: 1, of: (t) => t.d }) },
    );
    if (church) {
      const c = s.brickwork!.church!, parts = churchParts({ ...s, x: 0, z: 0, faces: 'w' } as Building), tw = parts.towers[0], tu = (tw.u0 + tw.u1) / 2, tv = (tw.v0 + tw.v1) / 2;
      out.push({ id: 'wall', label: 'walls', colour: GREEN, at: worldAt(it, 0, s.heights[0] + 0.3, D), axis: 'y', sign: 1, drag: (q, st, by) => reshape(q, st, (t) => { t.heights = [st.shape.heights[0] + by]; }) });
      out.push({ id: 'tower', label: 'tower', colour: GREEN, at: worldAt(it, tu, c.height, tv), axis: 'y', sign: 1, drag: (q, st, by) => reshape(q, st, (t) => { t.brickwork!.church!.height = st.shape.brickwork!.church!.height + by; }) });
      if (c.spire !== 'saddle') out.push({ id: 'spire', label: 'spire', colour: GREEN, at: worldAt(it, tu, c.height + c.spireHeight, tv), axis: 'y', sign: 1, drag: (q, st, by) => reshape(q, st, (t) => { t.brickwork!.church!.spireHeight = st.shape.brickwork!.church!.spireHeight + by; }) });
      const ch = parts.choir, away = parts.away;
      out.push({ id: 'choir', label: 'choir', colour: GREEN, at: worldAt(it, away > 0 ? ch.u1 + ch.apse : ch.u0 - ch.apse, Math.min(6, s.heights[0] / 2), (ch.v0 + ch.v1) / 2), axis: 'u', sign: away,
        drag: (q, st, by) => reshape(q, st, (t) => { t.brickwork!.church!.choirLength = st.shape.brickwork!.church!.choirLength + by; }) });
      return out;
    }
    if (it.kind === 'shack') return out;
    // Storeys: dragged up a storey's height, one more; down, one fewer.
    out.push({ id: 'storeys', label: `${s.storeys} storeys`, colour: GREEN, at: worldAt(it, 0, top + 0.6, D / 2), axis: 'y', sign: 1,
      drag: (q, st, by) => reshape(q, st, (t) => { const h = st.shape.heights[st.shape.heights.length - 1] ?? 3; t.storeys = st.shape.storeys + Math.round(by / h); }) });
    if (it.kind === 'gabled' || it.kind === 'store' || it.kind === 'eaves') {
      // The roof's pitch, by a knob halfway up its slope (on a gable, its left slope; on an eaves house, the slope to the street): higher is steeper.
      const half = (it.kind === 'eaves' ? D : W) / 4, tan = Math.tan(rad(s.brickwork!.pitch)), y = E + half * tan;
      out.push({ id: 'pitch', label: `${Math.round(s.brickwork!.pitch)}°`, colour: ROSE, at: it.kind === 'eaves' ? worldAt(it, 0, y, half) : worldAt(it, -W / 2 + half, y, 0), axis: 'y', sign: 1,
        drag: (q, st, by) => reshape(q, st, (t) => { t.brickwork!.pitch = deg(Math.atan(Math.max(0.1, y + by - E) / half)); }) });
    }
    for (const g of s.wings ?? []) {
      const u = g.side * (W / 2 - g.width / 2);
      out.push({ id: `wing${g.side}`, label: 'wing', colour: ROSE, at: worldAt(it, u, mid, D + g.length), axis: 'v', sign: 1,
        drag: (q, st, by) => reshape(q, st, (t) => { const w = t.wings!.find((x) => x.side === g.side)!; w.length = st.shape.wings!.find((x) => x.side === g.side)!.length + by; }) });
    }
    return out;
  };
  /** The ring's radius about the middle of a building: just clear of its farthest corner. */
  const ringOf = (it: Item) => {
    const b = built.get(it.id)!, s = it.shape;
    let r = 2;
    for (const q of b.rects) for (const [u, v] of [[q.u0, q.v0], [q.u1, q.v0], [q.u0, q.v1], [q.u1, q.v1]]) r = Math.max(r, Math.hypot(u * it.scale[0], (v - s.d / 2) * it.scale[2]));
    return r + 1.6;
  };

  // The drag of a knob: from where the pointer first met the plane through the knob that holds its line and faces the eye.
  let held: { knob: Knob; start: Item; plane: Plane; from: Vector3; axisW: Vector3; pointer: number } | null = null;
  const takeKnob = (knob: Knob, e: PointerEvent) => {
    const it = selectedItem();
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const view = camera.getWorldDirection(new Vector3());
    let axisW = new Vector3(0, 1, 0), plane = new Plane(new Vector3(0, 1, 0), 0);
    if (knob.axis) {
      axisW = worldDir(it, knob.axis, knob.sign ?? 1);
      const n = axisW.clone().cross(view.clone().cross(axisW));
      plane = new Plane().setFromNormalAndCoplanarPoint(n.lengthSq() > 1e-6 ? n.normalize() : view.clone().negate(), knob.at);
    }
    const from = rayAt(e.clientX, e.clientY).intersectPlane(plane, new Vector3()) ?? knob.at.clone();
    held = { knob, start: clone(it), plane, from, axisW, pointer: e.pointerId };
  };
  const dragKnob = (e: PointerEvent) => {
    if (!held || held.pointer !== e.pointerId) return;
    const it = selectedItem();
    if (!it) return;
    let by = 0;
    if (held.knob.axis) {
      const p = rayAt(e.clientX, e.clientY).intersectPlane(held.plane, new Vector3());
      if (!p) return;
      by = p.sub(held.from).dot(held.axisW) / stretchOf(held.start, held.knob.axis);
    }
    held.knob.drag(it, held.start, by, e);
    reflect();
  };
  const letKnobGo = (e: PointerEvent) => { if (!held || held.pointer !== e.pointerId) return; held = null; commit(); renderSelected(); };

  // ------------------------------------------------------------------ what is drawn over the picture
  const NS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(NS, 'g'), knobLayer = document.createElementNS(NS, 'g');
  over.append(lines, knobLayer);
  const paths: Record<string, SVGPathElement> = {};
  for (const [name, stroke, width, dash] of [['others', 'rgba(232,226,214,.35)', 1, ''], ['clash', '#ff7a5c', 2, '5 4'], ['chosen', AMBER, 2, ''], ['ring', 'rgba(255,255,255,.55)', 1.5, '3 5'], ['stems', 'rgba(255,255,255,.75)', 1.5, '']] as const) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', String(width));
    if (dash) p.setAttribute('stroke-dasharray', dash);
    lines.appendChild(p);
    paths[name] = p;
  }
  const knobEls = new Map<string, { g: SVGGElement; dot: SVGCircleElement; text: SVGTextElement; knob: Knob }>();
  let screen = { w: 1, h: 1 };
  const toScreen = (p: Vector3): [number, number] | null => {
    const q = p.clone().project(camera);
    return q.z > 1 || q.z < -1 ? null : [((q.x + 1) / 2) * screen.w, ((1 - q.y) / 2) * screen.h];
  };
  const polyline = (pts: Vector3[], closed: boolean) => {
    const s = pts.map(toScreen);
    let d = '';
    for (let i = 0; i < s.length - (closed ? 0 : 1); i++) {
      const a = s[i], c = s[(i + 1) % s.length];
      if (a && c) d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
    }
    return d;
  };
  /** The corners of the ground each building stands on, in the world, rectangle by rectangle (shrunk a little, so that houses wall to wall do not count as standing in one another). */
  const groundOf = (it: Item, shrink = 0): Vector3[][] => {
    const b = built.get(it.id);
    if (!b) return [];
    return b.rects.map((r) => [[r.u0 + shrink, r.v0 + shrink], [r.u1 - shrink, r.v0 + shrink], [r.u1 - shrink, r.v1 - shrink], [r.u0 + shrink, r.v1 - shrink]].map(([u, v]) => worldAt(it, u, 0.04, v)));
  };
  /** Whether two four-sided figures on the ground overlap: there is no line between them along any of their sides' directions. */
  const overlaps = (a: Vector3[], c: Vector3[]) => {
    for (const poly of [a, c]) for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4], nx = q.z - p.z, nz = p.x - q.x;
      const range = (pts: Vector3[]) => pts.reduce((m, r) => { const t = r.x * nx + r.z * nz; return [Math.min(m[0], t), Math.max(m[1], t)]; }, [Infinity, -Infinity]);
      const ra = range(a), rc = range(c);
      if (ra[1] <= rc[0] || rc[1] <= ra[0]) return false;
    }
    return true;
  };
  let clashes: [number, number][] = [];
  const findClashes = () => {
    clashes = [];
    // (Trees and stones stand where they like: a building beside a tree is not standing in it.)
    const grounds = state.items.filter((it) => !isNature(it.kind)).map((it) => ({ id: it.id, g: groundOf(it, 0.08) }));
    for (let i = 0; i < grounds.length; i++) for (let j = i + 1; j < grounds.length; j++) {
      if (grounds[i].g.some((a) => grounds[j].g.some((c) => overlaps(a, c)))) clashes.push([grounds[i].id, grounds[j].id]);
    }
  };
  const drawOver = () => {
    const chosen = selectedItem(), clashing = new Set(clashes.flat());
    let others = '', clash = '', mine = '', ring = '', stems = '';
    for (const it of state.items) {
      const d = groundOf(it).map((r) => polyline(r, true)).join('');
      if (it === chosen) mine += d; else if (clashing.has(it.id)) clash += d; else if (!isNature(it.kind) && state.tool !== 'paint' && (state.tool !== 'move' || state.items.length < 40)) others += d;
    }
    if (chosen && clashing.has(chosen.id)) clash += groundOf(chosen).map((r) => polyline(r, true)).join('');
    const knobs = chosen && placing === null ? knobsOf(chosen) : [];
    for (const k of knobs) {
      if (k.ring && chosen) {
        const c = new Vector3(chosen.x, 0.05, chosen.z), r = ringOf(chosen);
        ring += polyline(Array.from({ length: 72 }, (_, i) => c.clone().add(new Vector3(Math.sin((i / 72) * Math.PI * 2) * r, 0, Math.cos((i / 72) * Math.PI * 2) * r))), true);
        stems += polyline([c, k.at], false);
      } else if (k.axis && chosen) {
        // (The stem shows the line the knob moves along: from a point on the face, a little way outward.)
        const dir = worldDir(chosen, k.axis, k.sign ?? 1), size = Math.max(1.2, camera.position.distanceTo(k.at) * 0.05);
        stems += polyline([k.at, k.at.clone().addScaledVector(dir, size)], false);
      }
    }
    paths.others.setAttribute('d', others); paths.clash.setAttribute('d', clash); paths.chosen.setAttribute('d', mine);
    paths.ring.setAttribute('d', ring); paths.stems.setAttribute('d', stems);
    // The knobs: kept from frame to frame, so that one being dragged is not taken from under the pointer.
    const wanted = new Set<string>();
    for (const k of knobs) {
      let at = k.at;
      if (k.axis && chosen) at = k.at.clone().addScaledVector(worldDir(chosen, k.axis, k.sign ?? 1), Math.max(1.2, camera.position.distanceTo(k.at) * 0.05));
      const s = toScreen(at);
      if (!s) continue;
      wanted.add(k.id);
      let e = knobEls.get(k.id);
      if (!e) {
        const g = document.createElementNS(NS, 'g'), dot = document.createElementNS(NS, 'circle'), text = document.createElementNS(NS, 'text'), reach = document.createElementNS(NS, 'circle');
        g.setAttribute('class', 'knob');
        // (What the finger takes is broader than what is drawn: a clear ring round the knob.)
        reach.setAttribute('r', coarse ? '26' : '13'); reach.setAttribute('fill', 'transparent');
        g.appendChild(reach);
        dot.setAttribute('r', coarse ? '13' : '8');
        dot.setAttribute('stroke', 'rgba(0,0,0,.65)'); dot.setAttribute('stroke-width', '1.5');
        text.setAttribute('x', coarse ? '18' : '14'); text.setAttribute('y', '4');
        g.append(dot, text);
        knobLayer.appendChild(g);
        e = { g, dot, text, knob: k };
        const entry = e;
        g.addEventListener('pointerdown', (ev) => takeKnob(entry.knob, ev));
        g.addEventListener('pointermove', dragKnob);
        g.addEventListener('pointerup', letKnobGo);
        g.addEventListener('pointercancel', letKnobGo);
        knobEls.set(k.id, e);
      }
      if (!held || held.knob.id !== k.id) e.knob = k;
      // (A knob on a face turned away from the eye is drawn faint: it belongs to the far side, though it is drawn over the near one.)
      const away = !!chosen && !!k.axis && k.axis !== 'y' && worldDir(chosen, k.axis, k.sign ?? 1).dot(k.at.clone().sub(camera.position)) > 0;
      e.g.setAttribute('opacity', away ? '0.45' : '1');
      e.g.setAttribute('transform', `translate(${s[0].toFixed(1)} ${s[1].toFixed(1)})`);
      e.dot.setAttribute('fill', k.colour);
      e.text.textContent = k.label;
    }
    for (const [id, e] of knobEls) if (!wanted.has(id) && held?.knob.id !== id) { e.g.remove(); knobEls.delete(id); }
  };

  // ------------------------------------------------------------------ the panel
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };
  const sceneRefreshers: (() => void)[] = [];
  let selRefreshers: (() => void)[] = [];
  /**
   * Which controls the panel shows for a building: those of its kind, one height to a storey, wings only on a broad front, a
   * tower's side only where there is one tower, and so on. When a change alters this (a storey dragged away by its arrow,
   * wings gone with bays), the panel is laid out again; while a slider on it is held, once it is let go.
   */
  const layoutOf = (it: Item | undefined) => {
    if (!it) return '';
    const s = it.shape, bw = s.brickwork;
    // (A canal house's panel has a control for its door in each bay, and others that come and go with its gable, front, shutters and shop front.)
    const cw = s.canalwork, canal = cw ? [s.bays, cw.gable, cw.front, !!cw.shutters, !!cw.pui] : null;
    return JSON.stringify([it.id, it.kind, s.storeys, s.heights.length, s.bays >= 7, s.bays >= 11, s.portico, s.pediment, s.wings?.length ?? 0, s.towers?.length ?? 0, bw?.gable, bw?.rendered, bw?.church?.towers, bw?.church?.spire, canal]);
  };
  let shownLayout = '', sliding = false;
  /** Shows on the panel what everything now is. (One control that cannot show itself does not stop the rest.) */
  function reflect() {
    if (!sliding && layoutOf(selectedItem()) !== shownLayout) { renderSelected(); return; }
    for (const r of selRefreshers) try { r(); } catch (e) { console.warn(e); }
  }
  const reflectScene = () => { for (const r of sceneRefreshers) try { r(); } catch (e) { console.warn(e); } };
  const fmt = (v: number, step: number) => (!Number.isFinite(v) ? '–' : step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2));
  const read = (get: () => number) => { try { return Number(get()); } catch { return NaN; } };
  const slider = (parent: HTMLElement, list: (() => void)[], label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, o: { title?: string; done?: () => void } = {}) => {
    const row = el('div', parent); row.className = 'row';
    const l = el('label', row, label); if (o.title) l.title = row.title = o.title;
    const input = el('input', row); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    const out = el('output', row);
    // (A slider whose measure the building no longer has is shown empty until the panel is laid out again.)
    const show = () => { const v = read(get), ok = Number.isFinite(v); input.disabled = !ok; if (ok) input.value = String(v); out.textContent = fmt(v, step); };
    input.addEventListener('input', () => { sliding = true; if (Number.isFinite(read(get))) set(Number(input.value)); reflect(); show(); });
    input.addEventListener('change', () => { sliding = false; o.done?.(); input.blur(); reflect(); });
    list.push(show); show();
  };
  const stepper = (parent: HTMLElement, list: (() => void)[], label: string, get: () => number, set: (v: number) => void, by = 1, title?: string) => {
    const row = el('div', parent); row.className = 'row wide';
    const l = el('label', row, label); if (title) l.title = row.title = title;
    const box = el('div', row); box.className = 'step';
    const less = el('button', box, '−'), out = el('output', box), more = el('button', box, '+');
    less.addEventListener('click', () => { const v = read(get); if (Number.isFinite(v)) set(v - by); });
    more.addEventListener('click', () => { const v = read(get); if (Number.isFinite(v)) set(v + by); });
    const show = () => { const v = read(get); out.textContent = Number.isFinite(v) ? String(v) : '–'; };
    list.push(show); show();
  };
  const choice = <T extends string | number>(parent: HTMLElement, list: (() => void)[], label: string, options: [string, T][], get: () => T, set: (v: T) => void, title?: string) => {
    const row = el('div', parent); row.className = 'row wide';
    const l = el('label', row, label); if (title) l.title = row.title = title;
    const select = el('select', row);
    for (const [name, value] of options) el('option', select, name).value = String(value);
    select.addEventListener('change', () => { const o = options.find(([, v]) => String(v) === select.value); if (o) set(o[1]); select.blur(); });
    const show = () => { select.value = String(get()); };
    list.push(show); show();
  };
  const checks = (parent: HTMLElement, list: (() => void)[], items: [string, () => boolean, (v: boolean) => void, string?][]) => {
    const row = el('div', parent); row.className = 'checks';
    for (const [label, get, set, title] of items) {
      const l = el('label', row); if (title) l.title = title;
      const input = el('input', l); input.type = 'checkbox';
      l.appendChild(document.createTextNode(label));
      input.addEventListener('change', () => { set(input.checked); input.blur(); });
      list.push(() => { input.checked = get(); });
    }
    for (const r of list.slice(-items.length)) r();
  };
  const buttons = (parent: HTMLElement, items: [string, (e: MouseEvent) => void, string?][]) => {
    const row = el('div', parent); row.className = 'buttons';
    return items.map(([label, act, title]) => { const b = el('button', row, label); if (title) b.title = title; b.addEventListener('click', (e) => { act(e); b.blur(); }); return b; });
  };
  const hex = (c: Colour) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  const unhex = (h: string): Colour => [1, 3, 5].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 100) / 100) as Colour;

  // What can be added.
  el('h2', panel, 'Add a building');
  const addRow = el('div', panel); addRow.className = 'buttons';
  for (const kind of KIND_ORDER) {
    const b = el('button', addRow, KINDS[kind].name);
    b.title = KINDS[kind].note;
    // (A click with the mouse puts the new building on the pointer; a tap stands it in the middle of the view.)
    b.addEventListener('click', (e) => { add(kind, { follow: (e as PointerEvent).pointerType === 'mouse' }); b.blur(); });
  }
  buttons(panel, [
    ['Palace', (e) => { add('classical', { follow: (e as PointerEvent).pointerType === 'mouse', shape: (seed) => dealCharacter('palace', seed) }); }, 'A long classical front on a high base, its middle under columns and a pediment, pavilions at its ends, the ground falling along it'],
    ['Plain block', (e) => { add('classical', { follow: (e as PointerEvent).pointerType === 'mouse', shape: (seed) => dealCharacter('plain', seed) }); }, 'A classical block with nothing on it but its windows, its bands and its cornice'],
  ]);
  buttons(panel, [['Brick street', () => street('brick'), 'Seven houses wall to wall, dealt as a town deals them'], ['Canal row', () => street('canal'), 'Eight canal houses wall to wall, dealt as a town deals them']]);
  el('h2', panel, 'Trees & stones');
  const TREE_NAMES: Record<(typeof TREES)[number], string> = { oak: 'Oak', ash: 'Ash', 'old oak': 'Old oak', spruce: 'Spruce', pine: 'Pine', 'coast pine': 'Coast pine', bush: 'Bush' };
  buttons(panel, [
    ...TREES.map((k): [string, (e: MouseEvent) => void, string] => [TREE_NAMES[k], (e) => { add('tree', { follow: (e as PointerEvent).pointerType === 'mouse', shape: (seed) => dealTree(k, seed) }); }, `A${k === 'oak' || k === 'old oak' || k === 'ash' ? 'n' : ''} ${k}, grown as the valley grows them`]),
    ['Boulder', (e) => { add('boulder', { follow: (e as PointerEvent).pointerType === 'mouse' }); }, 'A boulder of the country’s stone'],
  ]);
  // The brushes: what each lays, and how large it is.
  el('h2', panel, 'Paint');
  const paintBox = el('div', panel);
  let paintList: (() => void)[] = [];
  const GROUND_NAMES: Record<(typeof GROUND_PAINTS)[number], string> = { flags: 'Erase', setts: 'Setts', gravel: 'Gravel', turf: 'Turf', earth: 'Earth', mud: 'Mud', track: 'Track', path: 'Path' };
  const PLANT_NAMES: Record<(typeof PLANT_PAINTS)[number], string> = { grass: 'Grass', flowers: 'Flowers', ferns: 'Ferns', reeds: 'Reeds', wood: 'Mixed wood', oak: 'Oak', ash: 'Ash', spruce: 'Spruce', pine: 'Pine', bush: 'Bush' };
  const clearPaint = (what: keyof Painted, name: string) => { if (!state.paint[what].length) return; state.paint = { ...state.paint, [what]: [] }; paintLayers(); commit(); say(`${name} cleared`, 'dim', 4); };
  function renderPaint() {
    paintBox.innerHTML = '';
    paintList = [];
    const B = state.brush, list = paintList;
    choice<'ground' | 'plants' | 'rock'>(paintBox, list, 'Brush', [['Ground', 'ground'], ['Plants', 'plants'], ['Rock', 'rock']], () => B.layer, (v) => { B.layer = v; if (state.tool !== 'paint') setTool('paint'); renderPaint(); remember(); });
    if (B.layer === 'ground') choice<number>(paintBox, list, 'Surface', GROUND_PAINTS.map((g, i): [string, number] => [GROUND_NAMES[g], i]), () => B.ground, (v) => { B.ground = v; remember(); }, 'Erase takes back what was laid, to the square’s own paving. A track or a path follows the stroke.');
    else if (B.layer === 'plants') choice<number>(paintBox, list, 'Plants', PLANT_PAINTS.map((g, i): [string, number] => [PLANT_NAMES[g], i]), () => B.plant, (v) => { B.plant = v; remember(); }, 'Low things in drifts; trees one by one at their distance; a wood a mixture of them');
    if (B.layer !== 'ground') checks(paintBox, list, [[B.layer === 'rock' ? 'Dig' : 'Erase', () => B.dig, (v) => { B.dig = v; remember(); }, 'Or hold Shift while painting']]);
    slider(paintBox, list, 'Size', 0.3, 20, 0.1, () => B.size, (v) => { B.size = v; brushRing.scale.setScalar(v); remember(); }, { title: 'Brush radius in metres ([ and ])' });
    buttons(paintBox, [['Clear ground', () => clearPaint('ground', 'Ground')], ['Clear plants', () => clearPaint('plants', 'Plants')], ['Clear rock', () => clearPaint('rock', 'Rock')]]);
    el('p', paintBox, 'Paint (B), then drag on the square. Right drag turns the view; two fingers by touch.').className = 'note';
  }
  renderPaint();

  // The building chosen.
  el('h2', panel, 'Selected');
  const selBox = el('div', panel);
  function renderSelected() {
    selBox.innerHTML = '';
    selRefreshers = [];
    const it = selectedItem();
    shownLayout = layoutOf(it);
    sliding = false;
    if (!it) { el('p', selBox, 'Nothing is selected. Tap a building, or add one.').className = 'note'; return; }
    const R = RANGES, list = selRefreshers;
    el('h3', selBox, KINDS[it.kind].name);
    el('p', selBox, KINDS[it.kind].note).className = 'note';
    buttons(selBox, [
      ['Deal anew', () => { it.seed = Math.random().toString(36).slice(2, 8); it.shape = it.kind === 'tree' ? dealTree(it.shape.tree!.kind, it.seed) : deal(it.kind, it.seed, state.stone); dirty.add(it.id); renderSelected(); commit(); }, 'Another of its kind, dealt as the generator deals one'],
      ['New details', () => { it.seed = Math.random().toString(36).slice(2, 8); dirty.add(it.id); commit(); }, 'The same measures; the builder’s own choices made again: door colours, lit rooms, how rooms are dealt'],
    ]);
    buttons(selBox, [
      ['Next door', () => nextDoor(false), 'N. A new one of its kind beside it, wall to wall, its front on the same line'],
      ['Copy beside', () => nextDoor(true), 'Shift N. The same again beside it'],
      ['Delete', () => remove(it.id), 'Delete or Backspace'],
    ]);
    // Where it stands.
    el('h3', selBox, 'Place');
    const moved = () => { placeItem(it); changed(false); };
    slider(selBox, list, 'Across', -150, 150, 0.1, () => it.x, (v) => { it.x = v; moved(); }, { done: commit, title: 'x, in metres' });
    slider(selBox, list, 'Along', -150, 150, 0.1, () => it.z, (v) => { it.z = v; moved(); }, { done: commit, title: 'z, in metres' });
    slider(selBox, list, 'Turn', -180, 180, 1, () => it.turn, (v) => { it.turn = v; moved(); }, { done: commit, title: 'Which way the front looks, in degrees. [ and ] turn it a step.' });
    el('h3', selBox, 'Scale');
    slider(selBox, list, 'Whole', 0.2, 5, 0.01, () => it.scale[1], (v) => { const k = v / it.scale[1]; it.scale = it.scale.map((s) => Math.min(5, Math.max(0.2, Math.round(s * k * 100) / 100))) as [number, number, number]; moved(); }, { done: commit, title: 'Scales everything about it alike: windows, bricks and all' });
    slider(selBox, list, 'Breadth', 0.2, 5, 0.01, () => it.scale[0], (v) => { it.scale[0] = v; moved(); }, { done: commit, title: 'Stretches it along its front' });
    slider(selBox, list, 'Height', 0.2, 5, 0.01, () => it.scale[1], (v) => { it.scale[1] = v; moved(); }, { done: commit });
    slider(selBox, list, 'Depth', 0.2, 5, 0.01, () => it.scale[2], (v) => { it.scale[2] = v; moved(); }, { done: commit, title: 'Stretches it from front to back' });
    buttons(selBox, [['True size', () => { it.scale = [1, 1, 1]; moved(); reflect(); commit(); }, 'Takes the scale away']]);
    el('p', selBox, 'Scale stretches the building as it is built. The measures below build it again at its true size: a broader front gets more windows, a taller one more storeys.').className = 'note';

    // Its measures, by kind. Each change is brought back within what the kind can be, and the building is built again.
    el('h3', selBox, 'Measures');
    const s = () => it.shape;
    const change = (f: (t: Shape) => void, asked: 'w' | 'bays' = 'w', again = false) => {
      const t = clone(it.shape); f(t); it.shape = normalise(it.kind, t, asked); dirty.add(it.id);
      if (again) { renderSelected(); commit(); }
    };
    const num = (label: string, range: readonly number[], get: () => number, set: (t: Shape, v: number) => void, title?: string, step = 0.05) =>
      slider(selBox, list, label, range[0], range[1], step, get, (v) => change((t) => set(t, v)), { done: commit, title });
    const ints = (label: string, get: () => number, set: (t: Shape, v: number) => void, by = 1, asked: 'w' | 'bays' = 'w', title?: string) =>
      stepper(selBox, list, label, get, (v) => change((t) => set(t, v), asked, true), by, title);
    /** More or fewer bays, each as broad as they were: the front grows or shrinks by as many. (`margin` is what the front has beyond its bays.) */
    const bays = (t: Shape, v: number, margin: number) => { t.w = ((t.w - margin) / Math.max(1, t.bays)) * v + margin; t.bays = v; };
    const pick = <T extends string | number>(label: string, options: [string, T][], get: () => T, set: (t: Shape, v: T) => void, title?: string) =>
      choice(selBox, list, label, options, get, (v) => change((t) => set(t, v), 'w', true), title);
    const tick = (items: [string, () => boolean, (t: Shape, v: boolean) => void, string?][]) =>
      checks(selBox, list, items.map(([label, get, set, title]): [string, () => boolean, (v: boolean) => void, string?] => [label, get, (v: boolean) => change((t) => set(t, v), 'w', true), title]));
    const heights = (range: readonly number[], first = 'Ground storey') => s().heights.forEach((_, i) =>
      num(i ? `Storey ${i + 1}` : first, range, () => s().heights[i], (t, v) => { t.heights[i] = v; }, 'From its floor to the floor above, in metres'));
    const wash = () => {
      const row = el('div', selBox); row.className = 'row wide';
      el('label', row, 'Wash');
      const input = el('input', row); input.type = 'color';
      input.addEventListener('input', () => change((t) => { t.colour = unhex(input.value); }));
      input.addEventListener('change', commit);
      list.push(() => { input.value = hex(s().colour); }); input.value = hex(s().colour);
    };
    const bw = () => s().brickwork!;
    const doors: [string, number][] = it.kind === 'timber' ? [['Left', 0.24], ['Middle', 0.5], ['Right', 0.76]] : [['Left', 0.28], ['Middle', 0.5], ['Right', 0.72]];
    const brickMake = (roofRange: readonly number[]) => {
      tick([['Rendered', () => bw().rendered, (t, v) => { t.brickwork!.rendered = v; }, 'Its front plastered and washed, what is moulded on it white'],
        ['Glazed bands', () => bw().glazed, (t, v) => { t.brickwork!.glazed = v; }, 'Bands of dark glazed brick at the floors and under the gable']]);
      if (bw().rendered) wash();
      pick('Clay', [['Red', 'red'], ['Buff', 'buff']], () => bw().clay, (t, v) => { t.brickwork!.clay = v; });
      num('Roof pitch', roofRange, () => bw().pitch, (t, v) => { t.brickwork!.pitch = v; }, 'How steep the roof is, in degrees', 0.5);
      pick('Roof', [['Red tiles', 'red'], ['Dark tiles', 'dark'], ['Copper', 'copper']], () => bw().roof, (t, v) => { t.brickwork!.roof = v; });
    };
    if (it.kind === 'timber') {
      num('Width', R.timber.w, () => s().w, (t, v) => { t.w = v; });
      num('Depth', R.timber.d, () => s().d, (t, v) => { t.d = v; });
      ints('Storeys', () => s().storeys, (t, v) => { t.storeys = v; });
      heights(R.timber.height);
      ints('Windows', () => s().bays, (t, v) => { t.bays = v; }, 1, 'w', 'Windows across the front of each framed storey');
      num('Jetty', R.timber.jetty, () => s().jetty ?? 0.35, (t, v) => { t.jetty = v; }, 'How far each storey stands out over the one below', 0.01);
      tick([['Gable to the street', () => !!s().gable, (t, v) => { t.gable = v; }, 'Its gable to the front; otherwise its eaves, with dormers'], ['Burnt out', () => !!s().burnt, (t, v) => { t.burnt = v; }]]);
      checks(selBox, list, [['Inn, with a sign', () => !!it.inn, (v) => { it.inn = v; dirty.add(it.id); commit(); }]]);
      pick('Door', doors, () => s().door ?? 0.24, (t, v) => { t.door = v; });
      wash();
    } else if (it.kind === 'classical') {
      ints('Bays', () => s().bays, (t, v) => bays(t, v, R.classical.margin), 2, 'bays', 'Windows across the front: always odd, so that the door has the middle one');
      num('Width', [R.classical.bays[0] * R.classical.pitch[0] + R.classical.margin, R.classical.bays[1] * R.classical.pitch[1] + R.classical.margin], () => s().w, (t, v) => { t.w = v; }, 'Wider than its bays can fill, and it has more', 0.1);
      num('Depth', R.classical.d, () => s().d, (t, v) => { t.d = v; });
      ints('Storeys', () => s().storeys, (t, v) => { t.storeys = v; });
      heights(R.classical.height);
      tick([['Portico', () => !!s().portico, (t, v) => { t.portico = v; }, 'The middle three bays stand forward under pilasters and a pediment (five bays or more)']]);
      if (s().bays >= 7) {
        const side = () => { const w = s().wings ?? []; return w.length === 2 ? 'both' : w.length ? (w[0].side < 0 ? 'left' : 'right') : 'none'; };
        pick('Wings', [['None', 'none'], ['Left', 'left'], ['Right', 'right'], ['Both', 'both']], side, (t, v) => {
          const width = t.wings?.[0]?.width ?? Math.min(7, t.w / 2 - 4), length = t.wings?.[0]?.length ?? 10;
          t.wings = v === 'none' ? undefined : (v === 'both' ? [-1, 1] : [v === 'left' ? -1 : 1]).map((g) => ({ side: g as -1 | 1, width, length }));
        }, 'Wings reaching back from its ends about a court: an L, or a U');
        if (s().wings?.length) {
          num('Wing width', R.classical.wingWidth, () => s().wings![0].width, (t, v) => { for (const g of t.wings!) g.width = v; });
          num('Wing length', R.classical.wingLength, () => s().wings![0].length, (t, v) => { for (const g of t.wings!) g.length = v; }, 'How far the wings reach back; each has its own arrow too', 0.1);
        }
      } else el('p', selBox, 'Seven bays or more can have wings.').className = 'note';
      // The variations the town deals.
      if (s().portico) tick([['Pediment', () => s().pediment !== false, (t, v) => { t.pediment = v ? undefined : false; }, 'Over the middle that stands forward; without it the cornice runs straight across']]);
      if (s().bays >= 11) pick('Entrances', [['One', 1], ['Two', 2], ['Three', 3]], () => s().entrances?.length ?? 1, (t, v) => { t.entrances = v > 1 ? Array.from({ length: v }, () => 0) : undefined; }, 'Doors along a long front, each with its own hall and stair');
      if (!s().wings?.length) pick('Carriage way', [['None', 'none'], ['Left end', 'left'], ['Right end', 'right']], () => (s().arch ? (s().arch!.side < 0 ? 'left' : 'right') : 'none'), (t, v) => { t.arch = v === 'none' ? undefined : { side: v === 'left' ? -1 : 1 }; }, 'An arch through the two bays at an end, to the yard behind (where there is room before the first door)');
      pick('Walls', [['Washed stucco', 'wash'], ['Brick, stucco dressings', 'stucco'], ['Bare brick', 'bare']], () => s().brick ?? 'wash', (t, v) => { t.brick = v === 'wash' ? undefined : v; });
      if (s().wings?.length) {
        const towerKind = () => { const q = s().towers ?? []; if (!q.length) return 'none'; const f = q.some((x) => x.corner === 'front'), w = q.some((x) => x.corner === 'wing'); return f && w ? 'all' : f ? 'front' : 'wings'; };
        pick('Towers', [['None', 'none'], ['Front corners', 'front'], ['Wing ends', 'wings'], ['Front and a wing', 'all']], towerKind, (t, v) => {
          const extra = t.towers?.[0]?.extra ?? 2, size = 5.6, front = (side: -1 | 1) => ({ corner: 'front' as const, side, size, extra }), wing = (side: -1 | 1) => ({ corner: 'wing' as const, side, size, extra });
          const sides = (t.wings ?? []).map((g) => g.side);
          t.towers = v === 'none' ? undefined : v === 'front' ? [front(-1), front(1)] : v === 'wings' ? sides.map(wing) : [front(-1), front(1), wing(sides[0])];
        }, 'Towers at its corners, rising over the cornice');
        if (s().towers?.length) ints('Tower storeys', () => s().towers![0].extra, (t, v) => { for (const q of t.towers!) q.extra = v; }, 1, 'w', 'How many storeys the towers rise over the cornice');
      }
      wash();
      // How it is dressed: from a plain block to a palace on a sloping square.
      el('h3', selBox, 'Dress');
      const newSeed = () => Math.random().toString(36).slice(2, 8);
      buttons(selBox, [
        ['Palace', () => { it.seed = newSeed(); it.shape = dealCharacter('palace', it.seed); dirty.add(it.id); renderSelected(); commit(); }, 'Deals it again as a palace'],
        ['Plain', () => { it.seed = newSeed(); it.shape = dealCharacter('plain', it.seed); dirty.add(it.id); renderSelected(); commit(); }, 'Deals it again as a plain block'],
        ['Deal dress', () => change((t) => { delete t.dress; dealDress(t as Building, new Rng(newSeed()).fork('dress'), { raise: 1.8, columns: true }); }, 'w', true), 'Keeps its measures and dresses it as a place might'],
      ]);
      const dd = (): ClassicalDress => ({ ...PLAIN_DRESS, ...(s().dress ?? {}) });
      const dressed = (f: (d: ClassicalDress) => void) => (t: Shape) => { const d = { ...PLAIN_DRESS, ...(t.dress ?? {}) }; f(d); t.dress = d; };
      pick('Style', [['Empire', 'empire'], ['Renaissance', 'quoins'], ['Nordic', 'lesenes'], ['Bare', 'bare']], () => dd().style, (t, v) => dressed((d) => { d.style = v; })(t), 'Empire: corner strips, window heads. Renaissance: quoins, eared frames. Nordic: lesenes, plain frames. Bare: no ornament.');
      if (s().portico) {
        ints('Middle bays', () => dd().centre, (t, v) => dressed((d) => { d.centre = v; })(t), 2, 'w', 'How many bays of the middle stand forward: three to nine');
        pick('Middle', [['Pilasters', 'pilasters'], ['Columns', 'columns']], () => dd().order, (t, v) => dressed((d) => { d.order = v; })(t), 'Columns stand clear of the wall through the upper storeys, on the ground storey brought forward');
      }
      ints('Pavilions', () => dd().pavilions, (t, v) => dressed((d) => { d.pavilions = v; })(t), 1, 'w', 'Bays at each end standing forward under pilasters of their own');
      pick('Arched windows', [['None', 0], ['Ground floor', 1], ['Two floors', 2]], () => dd().arches, (t, v) => dressed((d) => { d.arches = v as 0 | 1 | 2; })(t), 'Windows (and doors) with round heads');
      pick('Window heads', [['Frame only', 'plain'], ['Cornice', 'cornice'], ['Alternating', 'alternate'], ['Pediments', 'pediments']], () => dd().heads, (t, v) => dressed((d) => { d.heads = v; })(t), 'Over the windows of the principal storey');
      tick([
        ['Rusticated', () => dd().rusticated, (t, v) => dressed((d) => { d.rusticated = v; })(t), 'The ground storey cut in courses'],
        ['Wreaths', () => dd().frieze, (t, v) => dressed((d) => { d.frieze = v; })(t), 'A wreath in the frieze over each window'],
        ['Balustrade', () => dd().balustrade, (t, v) => dressed((d) => { d.balustrade = v; })(t), 'Along the top of the cornice, before the roof'],
        ['Flagpole', () => dd().flag, (t, v) => dressed((d) => { d.flag = v; })(t)],
      ]);
      if (s().portico && s().pediment !== false) pick('Pediment', [['Window', 'window'], ['Oculus', 'oculus'], ['Clock', 'clock'], ['Plain', 'plain']], () => dd().tympanum, (t, v) => dressed((d) => { d.tympanum = v; })(t));
      pick('Roof', [['Dealt', 'dealt'], ['Grey metal', 'grey'], ['Green metal', 'green'], ['Red metal', 'red'], ['Black metal', 'black'], ['Copper', 'copper'], ['Red tiles', 'tiles'], ['Dark tiles', 'dark']], () => dd().roof, (t, v) => dressed((d) => { d.roof = v; })(t));
      if (s().portico || s().bays >= 7) pick('Doors', [['One', 1], ['Three', 3]], () => dd().doors, (t, v) => dressed((d) => { d.doors = v as 1 | 3; })(t), 'Three side by side into the one hall');
      num('Base', R.classical.plinth, () => dd().plinth, (t, v) => dressed((d) => { d.plinth = v; })(t), 'Floor height over the ground at the door; from 1 m a basement with windows', 0.05);
      num('Slope', [-4.3, 4.3], () => dd().fall, (t, v) => dressed((d) => { d.fall = v; })(t), 'How much lower the ground is at the right end than the left (negative: the left is lower), up to what the base allows', 0.05);
    } else if (it.kind === 'wooden') {
      const RW = R.wooden;
      num('Width', RW.w, () => s().w, (t, v) => { t.w = v; t.bays = Math.max(3, Math.round((v - 2) / 2.2)); }, 'A little over two metres to a window: more windows as it grows', 0.1);
      num('Depth', RW.d, () => s().d, (t, v) => { t.d = v; });
      ints('Storeys', () => s().storeys, (t, v) => { t.storeys = v; });
      heights(RW.height);
      ints('Windows', () => s().bays, (t, v) => { t.bays = v; }, 1, 'w', 'Windows across the front');
      num('Basement', RW.basement, () => s().basement ?? 1.1, (t, v) => { t.basement = v; }, 'How high its granite basement stands, and its floor with it', 0.05);
      pick('Door', [['Left end', -1], ['Right end', 1]], () => s().endDoor ?? -1, (t, v) => { t.endDoor = v; }, 'The door is in an end wall, near the front, up steps under a little roof');
      ints('Dormers', () => s().dormers ?? 0, (t, v) => { t.dormers = v; }, 1, 'w', 'Half-round dormers in the front slope of the roof');
      const side = () => { const g = s().wings?.[0]; return g ? (g.side < 0 ? 'left' : 'right') : 'none'; };
      pick('Wing', [['None', 'none'], ['Left', 'left'], ['Right', 'right']], side, (t, v) => { t.wings = v === 'none' ? undefined : [{ side: v === 'left' ? -1 : 1, width: t.wings?.[0]?.width ?? 7, length: t.wings?.[0]?.length ?? 9 }]; }, 'A wing reaching back from one end: an L, as at a street corner');
      if (s().wings?.length) {
        num('Wing width', RW.wingWidth, () => s().wings![0].width, (t, v) => { t.wings![0].width = v; });
        num('Wing length', RW.wingLength, () => s().wings![0].length, (t, v) => { t.wings![0].length = v; }, undefined, 0.1);
      }
      wash();
    } else if (it.kind === 'canal') {
      const cw = () => s().canalwork!, RC = R.canal, gable = cw().gable;
      /** A colour of what the house is made of or painted, by a picker. */
      const tint = (label: string, get: () => Colour, set: (t: Shape, v: Colour) => void) => {
        const row = el('div', selBox); row.className = 'row wide';
        el('label', row, label);
        const input = el('input', row); input.type = 'color';
        input.addEventListener('input', () => change((t) => set(t, unhex(input.value))));
        input.addEventListener('change', commit);
        list.push(() => { input.value = hex(get()); }); input.value = hex(get());
      };
      pick('Kind', [['House', 'house'], ['Warehouse', 'warehouse']], () => cw().kind, (t, v) => { t.canalwork!.kind = v; }, 'A warehouse has lower storeys, loading doors under the hoist and shutters');
      pick('Gable', [['Spout', 'spout'], ['Stepped', 'stepped'], ['Neck', 'neck'], ['Bell', 'bell'], ['Cornice', 'cornice'], ['Raised', 'raised']], () => cw().gable, (t, v) => { t.canalwork!.gable = v; if (v === 'stepped') t.canalwork!.tiers = Math.max(3, t.canalwork!.tiers); }, 'The outline over the eaves, oldest to latest');
      if (gable === 'stepped' || gable === 'neck') ints(gable === 'stepped' ? 'Steps' : 'Tiers', () => cw().tiers, (t, v) => { t.canalwork!.tiers = v; }, 1, 'w', gable === 'stepped' ? 'Steps a side: two to five' : 'One neck, or a broader one under a narrower');
      if (gable !== 'cornice') pick('Crown', [['Triangle', 'triangle'], ['Segment', 'segment'], ['Scroll', 'scroll'], ['Flat', 'flat']], () => cw().crown, (t, v) => { t.canalwork!.crown = v; }, 'On top of the gable');
      pick('Ornament', [['Plain', 0], ['Bands', 1], ['Carved', 2], ['Rich', 3]], () => cw().ornament, (t, v) => { t.canalwork!.ornament = v as 0 | 1 | 2 | 3; }, 'Plain: flat arches. Bands: stone bands, keystones. Carved: garlands, crowned windows, vases. Rich: pilasters and a balustrade too.');
      pick('Windows', [['Cross', 'cross'], ['Small panes', 'small'], ['Large panes', 'large']], () => cw().windows, (t, v) => { t.canalwork!.windows = v; });
      pick('Front', [['Brick', 'brick'], ['Painted', 'painted']], () => cw().front, (t, v) => { t.canalwork!.front = v; });
      if (cw().front === 'painted') wash();
      else pick('Clay', [['Red', 'red'], ['Buff', 'buff']], () => cw().clay, (t, v) => { t.canalwork!.clay = v; });
      num('Width', [RC.bays[0] * RC.pitch[0] + RC.margin, RC.bays[1] * RC.pitch[1] + RC.margin], () => s().w, (t, v) => { t.w = v; }, 'A broader front gets more bays', 0.05);
      ints('Bays', () => s().bays, (t, v) => { t.bays = v; }, 1, 'bays', 'Windows across: one to seven');
      num('Depth', RC.d, () => s().d, (t, v) => { t.d = v; });
      ints('Storeys', () => s().storeys, (t, v) => { t.storeys = v; });
      heights(RC.height, 'Ground floor');
      num('Stoop', RC.stoop, () => cw().stoop, (t, v) => { t.canalwork!.stoop = v; }, 'Floor height over the street, up steps; a high one runs along the front', 0.05);
      num('Lean', RC.lean, () => cw().lean, (t, v) => { t.canalwork!.lean = v; }, 'How far the front leans out per metre of height', 0.001);
      pick('Door', Array.from({ length: s().bays }, (_, i): [string, number] => [`Bay ${i + 1}`, i]), () => cw().door, (t, v) => { t.canalwork!.door = v; });
      num('Roof pitch', RC.roof, () => cw().pitch, (t, v) => { t.canalwork!.pitch = v; }, 'In degrees', 0.5);
      pick('Roof', [['Red tiles', 'red'], ['Dark tiles', 'dark']], () => cw().roof, (t, v) => { t.canalwork!.roof = v; });
      tick([
        ['Basement', () => cw().basement, (t, v) => { t.canalwork!.basement = v; }, 'Low windows at the foot of the front'],
        ['Hoist', () => cw().hoist, (t, v) => { t.canalwork!.hoist = v; }, 'A hoist beam over the top hatch'],
        ['Shutters', () => !!cw().shutters, (t, v) => { t.canalwork!.shutters = v ? [0.1, 0.22, 0.14] : null; }],
        ['Shop front', () => !!cw().pui, (t, v) => { t.canalwork!.pui = v ? [0.1, 0.2, 0.13] : null; }, 'A timber ground floor with great windows'],
      ]);
      tint('Frames', () => cw().frame, (t, v) => { t.canalwork!.frame = v; });
      tint('Door paint', () => cw().paint, (t, v) => { t.canalwork!.paint = v; });
      tint('Trim', () => cw().trim, (t, v) => { t.canalwork!.trim = v; });
      if (cw().shutters) tint('Shutter paint', () => cw().shutters!, (t, v) => { t.canalwork!.shutters = v; });
      if (cw().pui) tint('Shop paint', () => cw().pui!, (t, v) => { t.canalwork!.pui = v; });
    } else if (it.kind === 'tree') {
      const tr = () => s().tree!, R2 = TREE_RANGES[tr().kind];
      pick('Kind', TREES.map((k): [string, (typeof TREES)[number]] => [k[0].toUpperCase() + k.slice(1), k]), () => tr().kind, (t, v) => { t.tree = { ...dealTree(v, it.seed).tree!, leaf: t.tree!.leaf }; });
      num('Height', R2.height, () => tr().height, (t, v) => { t.tree!.height = v; }, 'From its foot to its top, in metres', 0.1);
      num('Trunk', R2.girth, () => tr().girth, (t, v) => { t.tree!.girth = v; }, 'How thick its trunk is at the foot, in metres', 0.005);
      num(tr().kind === 'spruce' || tr().kind.endsWith('pine') ? 'Spread' : 'Reach', R2.wide, () => tr().wide, (t, v) => { t.tree!.wide = v; }, 'How far its boughs reach out', 0.01);
      ints('Leaves', () => tr().leaf + 1, (t, v) => { t.tree!.leaf = v - 1; }, 1, 'w', 'Which of the season’s greens: one to four');
    } else if (it.kind === 'boulder') {
      num('Size', RANGES.boulder.size, () => s().boulder!.size, (t, v) => { t.boulder!.size = v; }, 'How far across, near enough, in metres; the Scale tool flattens or stretches it', 0.05);
    } else if (it.kind === 'shack') {
      const sh = () => s().shack!;
      num('Width', R.shack.w, () => s().w, (t, v) => { t.w = v; });
      num('Depth', R.shack.d, () => s().d, (t, v) => { t.d = v; });
      pick('Roof', [['Tarred boards', 'boards'], ['Tin', 'tin'], ['Turf', 'turf']], () => sh().roof, (t, v) => { t.shack!.roof = v; });
      tick([['One slope', () => sh().lean, (t, v) => { t.shack!.lean = v; }, 'Its roof falls one way, from front to back']]);
      num('On posts', R.shack.stilts, () => sh().stilts, (t, v) => { t.shack!.stilts = v; }, 'How high its floor stands on posts; nothing is on the ground', 0.05);
      wash();
    } else if (it.kind === 'church') {
      const c = () => bw().church!;
      ints('Bays', () => s().bays, (t, v) => bays(t, v, 0), 1, 'bays', 'Bays of the nave, buttress to buttress');
      num('Length', [R.church.bays[0] * R.church.pitch[0], R.church.bays[1] * R.church.pitch[1]], () => s().w, (t, v) => { t.w = v; }, 'The nave from end to end', 0.1);
      num('Breadth', R.church.d, () => s().d, (t, v) => { t.d = v; });
      num('Walls', R.church.wall, () => s().heights[0], (t, v) => { t.heights = [v]; }, 'How high the nave walls stand');
      ints('Towers', () => c().towers, (t, v) => { t.brickwork!.church!.towers = v >= 2 ? 2 : 1; }, 1, 'w', 'Two need a nave fifteen metres broad');
      if (c().towers === 1) num('Tower side', R.church.side, () => c().side, (t, v) => { t.brickwork!.church!.side = v; });
      num('Tower height', [s().heights[0] + R.church.tower[0], s().heights[0] + R.church.tower[1]], () => c().height, (t, v) => { t.brickwork!.church!.height = v; }, 'The tower’s walls, to the foot of the spire', 0.1);
      pick('Spire', [['Needle', 'needle'], ['Corner spirelets', 'corners'], ['Saddle roof', 'saddle']], () => c().spire, (t, v) => { t.brickwork!.church!.spire = v; });
      if (c().spire !== 'saddle') num('Spire height', c().spire === 'needle' ? [12, 36] : [10, 24], () => c().spireHeight, (t, v) => { t.brickwork!.church!.spireHeight = v; }, undefined, 0.1);
      pick('Tower end', [['Left', -1], ['Right', 1]], () => c().end, (t, v) => { t.brickwork!.church!.end = v; });
      pick('Choir', [['Apse', 'apse'], ['Flat end', 'flat']], () => c().choir, (t, v) => { t.brickwork!.church!.choir = v; });
      num('Choir length', R.church.choir, () => c().choirLength, (t, v) => { t.brickwork!.church!.choirLength = v; }, undefined, 0.1);
      pick('Gable', [['Stepped', 'stepped'], ['Piers', 'piers']], () => bw().gable, (t, v) => { t.brickwork!.gable = v; });
      ints('Steps', () => bw().steps, (t, v) => { t.brickwork!.steps = v; });
      pick('Niches', [['White', 'white'], ['Brick', 'brick']], () => bw().niches, (t, v) => { t.brickwork!.niches = v; });
      tick([['Glazed bands', () => bw().glazed, (t, v) => { t.brickwork!.glazed = v; }]]);
      pick('Clay', [['Red', 'red'], ['Buff', 'buff']], () => bw().clay, (t, v) => { t.brickwork!.clay = v; });
      num('Roof pitch', [46, 62], () => bw().pitch, (t, v) => { t.brickwork!.pitch = v; }, undefined, 0.5);
      pick('Roof', [['Copper', 'copper'], ['Red tiles', 'red'], ['Dark tiles', 'dark']], () => bw().roof, (t, v) => { t.brickwork!.roof = v; });
    } else {
      const RR = it.kind === 'gabled' ? R.gabled : it.kind === 'eaves' ? R.eaves : R.store;
      if (it.kind === 'eaves') {
        ints('Bays', () => s().bays, (t, v) => bays(t, v, R.eaves.margin), 1, 'bays', 'Windows across the front');
        num('Width', [R.eaves.bays[0] * R.eaves.pitch[0] + R.eaves.margin, R.eaves.bays[1] * R.eaves.pitch[1] + R.eaves.margin], () => s().w, (t, v) => { t.w = v; }, 'Wider than its bays can fill, and it has more', 0.1);
      } else num('Width', (RR as typeof R.gabled).w, () => s().w, (t, v) => { t.w = v; });
      num('Depth', RR.d, () => s().d, (t, v) => { t.d = v; });
      ints('Storeys', () => s().storeys, (t, v) => { t.storeys = v; });
      heights(RR.height);
      if (it.kind === 'gabled') {
        pick('Gable', [['Stepped', 'stepped'], ['Between piers', 'piers'], ['Curved tiers', 'volute'], ['Plain', 'plain']], () => bw().gable, (t, v) => { t.brickwork!.gable = v; });
        if (bw().gable !== 'plain') ints(bw().gable === 'stepped' ? 'Steps' : bw().gable === 'piers' ? 'Spaces' : 'Tiers', () => bw().steps, (t, v) => { t.brickwork!.steps = v; }, 1, 'w', bw().gable === 'piers' ? 'Spaces between the piers either side of the middle one' : undefined);
        if (bw().gable !== 'piers') ints('Windows', () => s().bays, (t, v) => { t.bays = v; }, 1, 'w', 'Windows across each storey');
        if (bw().gable === 'stepped' || bw().gable === 'piers') pick('Niches', [['White', 'white'], ['Brick', 'brick'], ['None', 'none']], () => bw().niches, (t, v) => { t.brickwork!.niches = v; }, 'The upper windows in tall pointed recesses');
        pick('Door', doors, () => bw().door, (t, v) => { t.brickwork!.door = v; });
        brickMake(R.gabled.pitch);
      } else if (it.kind === 'eaves') {
        pick('Middle gable', [['Plain', 'plain'], ['Curved', 'volute'], ['Stepped', 'stepped']], () => bw().gable, (t, v) => { t.brickwork!.gable = v; }, 'The small gable over the middle bays');
        if (bw().gable !== 'plain') ints('Steps', () => bw().steps, (t, v) => { t.brickwork!.steps = v; });
        brickMake(R.eaves.roof);
      } else {
        ints('Columns', () => s().bays, (t, v) => { t.bays = v; }, 2, 'w', 'Columns of windows, the loading doors in the middle one');
        pick('Gable', [['Stepped', 'stepped'], ['Plain', 'plain']], () => bw().gable, (t, v) => { t.brickwork!.gable = v; });
        ints('Steps', () => bw().steps, (t, v) => { t.brickwork!.steps = v; });
        pick('Niches', [['White', 'white'], ['Brick', 'brick'], ['None', 'none']], () => bw().niches, (t, v) => { t.brickwork!.niches = v; });
        brickMake(R.store.pitch);
      }
    }
    el('p', selBox, 'In Extrude (E), drag the arrows on its faces: width, depth, storeys, wings, the roof’s pitch; on a church its tower, spire and choir.').className = 'note';
  }

  // The scene.
  el('h2', panel, 'Scene');
  choice<Hour>(panel, sceneRefreshers, 'Hour', (Object.keys(SKIES) as Hour[]).map((h): [string, Hour] => [h, h]), () => state.hour, (v) => { state.hour = v; windows(); dress(); light(); remember(); });
  choice<Stone>(panel, sceneRefreshers, 'Stone', STONES.map((s): [string, Stone] => [s, s]), () => state.stone, (v) => { state.stone = v; lay(); dress(); sync(); paintLayers(); remember(); }, 'The country’s stone: plinths, steps and the paving, boulders and rock');
  choice<Season>(panel, sceneRefreshers, 'Season', SEASONS.map((s): [string, Season] => [s[0].toUpperCase() + s.slice(1), s]), () => state.season, (v) => { state.season = v; sync(); paintLayers(); remember(); }, 'The green of the leaves, and how dry the grass is');
  choice<number>(panel, sceneRefreshers, 'Move by', [['Freely', 0], ['10 cm', 0.1], ['25 cm', 0.25], ['50 cm', 0.5], ['1 m', 1], ['2 m', 2]], () => state.snap, (v) => { state.snap = v; remember(); });
  choice<number>(panel, sceneRefreshers, 'Turn by', [['Freely', 0], ['5°', 5], ['15°', 15], ['45°', 45], ['90°', 90]], () => state.turnSnap, (v) => { state.turnSnap = v; remember(); }, 'Holding Shift while turning turns freely');
  checks(panel, sceneRefreshers, [
    ['overlays', () => state.overlays, (v) => { state.overlays = v; showOverlays(); remember(); }, 'H. The grid, outlines, knobs, rings and the brush: off, the picture alone'],
    ['grid', () => state.grid, (v) => { state.grid = v; showOverlays(); remember(); }, 'A line every metre'],
    ['clay', () => state.clay, (v) => { state.clay = v; dress(); remember(); }, 'C. Everything in one plain grey: the shapes alone'],
    ['air', () => state.air, (v) => { state.air = v; atmosphere.uniforms.uEnabled.value = v ? 1 : 0; remember(); }, 'Haze and the light in the air, as the game draws them'],
  ]);
  /** Shows or hides what is drawn over the picture to work with. */
  function showOverlays() {
    grid.visible = state.grid && state.overlays;
    over.style.display = state.overlays ? '' : 'none';
    if (!state.overlays) brushRing.visible = false;
  }
  showOverlays();
  el('h3', panel, 'Views');
  buttons(panel, [['F Frame', () => frame(), 'Brings the selected building, or all of them, into view'], ['Front', () => look('front')], ['Corner', () => look('corner')], ['Above', () => look('above')]]);
  el('h3', panel, 'Saved');
  buttons(panel, [
    ['Save file', () => saveFile(), 'Saves what is set out as a file: each building as a site document of the game, with where it stands'],
    ['Copy', () => copyDoc(), 'Copies the same as text, to paste somewhere else; pasting such text here opens it'],
    ['Open file', () => fileInput.click(), 'Opens a file saved here, in place of what is set out'],
  ]);
  {
    let before: string | null = null;
    try { before = localStorage.getItem(BEFORE); } catch { /* storage refused */ }
    if (before) {
      const text = before;
      const [b] = buttons(panel, [['Bring back the last layout', () => { try { localStorage.removeItem(BEFORE); } catch { /* storage refused */ } b.parentElement?.remove(); openText(text, 'the last layout'); }, 'What was set out when the page last failed to open']]);
    }
  }
  buttons(panel, [['Clear all', () => { state.items = []; state.selected = null; state.paint = { ground: [], plants: [], rock: [] }; sync(); paintLayers(); renderSelected(); commit(); }], ['Start again', () => { demo(); sync(); renderSelected(); commit(); frame(); }, 'The buildings the lab starts with']]);
  el('p', panel, 'Drag a building to move it. Drag the ground to turn the view; right drag or two fingers slide it; the wheel or a pinch closes in. W A S D, Space and Q fly the view, Shift faster. M move and turn, E extrude, R scale, B paint; [ ] turn a step; arrows nudge; Delete; N next door, Shift N copy beside; Z undo, Shift Z redo; Esc lets go; H hides the grid, outlines and knobs; P hides this panel. All of it is kept in this browser.').className = 'note';

  // The tools, over the picture.
  const toolButtons: Record<string, HTMLButtonElement> = {};
  const toolDef: [string, string, () => void, string][] = [
    ['move', 'Move & turn', () => setTool('move'), 'M. Drag a building to move it; drag the knob on its ring to turn it'],
    ['extrude', 'Extrude', () => setTool('extrude'), 'E. Drag the arrows on its faces to change its measures'],
    ['scale', 'Scale', () => setTool('scale'), 'R. Drag a corner to scale it all, a face to stretch it one way'],
    ['paint', 'Paint', () => setTool(state.tool === 'paint' ? 'move' : 'paint'), 'B. Paint ground, plants or rock'],
    ['gap', '', () => {}, ''],
    ['undo', 'Undo', undo, 'Z'], ['redo', 'Redo', redo, 'Shift Z'],
    ['gap2', '', () => {}, ''],
    ['frame', 'Frame', () => frame(!selectedItem()), 'F. Brings the selected building, or all of them, into view'],
    ['panel', 'Panel', () => togglePanel(), 'P'],
  ];
  for (const [id, label, act, title] of toolDef) {
    if (id.startsWith('gap')) { el('span', toolbar).className = 'gap'; continue; }
    const b = el('button', toolbar, label); b.title = title;
    b.addEventListener('click', () => { act(); b.blur(); });
    toolButtons[id] = b;
  }
  function reflectTools() {
    for (const t of ['move', 'extrude', 'scale', 'paint']) toolButtons[t].classList.toggle('on', state.tool === t);
    toolButtons.undo.disabled = at <= 0;
    toolButtons.redo.disabled = at >= history.length - 1;
  }
  const setTool = (t: Tool) => {
    state.tool = t;
    // (With the brush in hand the left button paints; the right turns the view, the wheel closes in.)
    controls.mouseButtons = t === 'paint' ? { LEFT: -1 as unknown as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    if (t !== 'paint') { brushRing.visible = false; canvas.style.cursor = ''; }
    reflectTools(); renderPaint(); remember();
  };
  const togglePanel = () => { state.panel = !state.panel; document.body.classList.toggle('bare', !state.panel); fit(); remember(); };

  // ------------------------------------------------------------------ the camera
  const keepCamera = () => { state.cam = [...camera.position.toArray(), ...controls.target.toArray()]; remember(); };
  controls.addEventListener('end', keepCamera);
  const placeCamera = (from: Vector3, to: Vector3) => { camera.position.copy(from); controls.target.copy(to); controls.update(); keepCamera(); };
  /** What is looked at: the selected building, or all of them; as a box in the world. */
  const subject = (all = false) => {
    const box = new Box3(), it = selectedItem();
    for (const [id, b] of built) if ((all || !it || id === it.id) && !b.box.isEmpty()) box.union(b.box.clone().applyMatrix4(b.holder.matrixWorld));
    if (box.isEmpty()) box.set(new Vector3(-10, 0, -10), new Vector3(10, 10, 10));
    return box;
  };
  function frame(all = false) {
    const box = subject(all), centre = box.getCenter(new Vector3()), r = box.getSize(new Vector3()).length() / 2;
    const away = camera.position.clone().sub(controls.target).normalize();
    if (away.y < 0.15) away.y = 0.3;
    placeCamera(centre.clone().addScaledVector(away.normalize(), (r / Math.sin(rad(camera.fov / 2))) * 0.95), centre);
  }
  function look(how: 'front' | 'corner' | 'above') {
    const box = subject(), centre = box.getCenter(new Vector3()), r = box.getSize(new Vector3()).length() / 2, far = (r / Math.sin(rad(camera.fov / 2))) * 0.95;
    const it = selectedItem(), front = it ? axesOf(it.turn).front : new Vector3(0, 0, 1), along = it ? axesOf(it.turn).along : new Vector3(1, 0, 0);
    const dir = how === 'above' ? new Vector3(0, 1, 0.02).addScaledVector(front, 0.02) : how === 'front' ? front.clone().setY(0.18) : front.clone().add(along.clone().multiplyScalar(0.8)).setY(0.45);
    placeCamera(centre.clone().addScaledVector(dir.normalize(), far), centre);
  }

  // ------------------------------------------------------------------ saving and opening
  const docText = () => JSON.stringify({
    lab: 'dungeons building lab', version: 1, stone: state.stone, hour: state.hour, season: state.season,
    note: 'Each building: the lab\'s own record (kind, seed, x, z, turn in degrees with 0 facing +z, scale along breadth, height, depth) and `building`, the site document the game builds it from, at the origin facing w.',
    // (A shack is no building of the site document: it is saved as the town keeps one.)
    // (Trees and boulders are no buildings: their measures are all there is of them.)
    items: state.items.map((it) => (it.kind === 'shack' ? { ...it, shack: shackOf(it) } : isNature(it.kind) ? it : { ...it, building: documentOf(it) })),
    // (What was painted, as the brushes laid it: see document 5.)
    paint: state.paint,
  }, null, 1);
  // (Shown as an artifact, the page may not start a download itself: its host offers the file to the reader, who says yes or no.)
  type Downloads = { save(o: { filename: string; data: string }): Promise<unknown> };
  const downloads = host ? (host.use('downloads') as Promise<Downloads | null>).catch(() => null) : null;
  const saveFile = async () => {
    const text = docText(), n = state.items.length;
    if (downloads) {
      const d = await downloads;
      if (!d) { say('Saving a file is not offered here. Copy puts the same text on the clipboard.', 'bad', 12); return; }
      try { await d.save({ filename: 'buildings.json', data: text }); say(`Saved ${n} buildings`, 'good'); }
      catch (e) { const code = (e as { code?: string }).code; say(code === 'declined' ? 'Not saved' : `Not saved (${code ?? (e as Error).message}). Copy puts the same text on the clipboard.`, code === 'declined' ? 'dim' : 'bad', 10); }
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'buildings.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say(`Saved ${n} buildings`, 'good');
  };
  const copyDoc = () => {
    navigator.clipboard.writeText(docText()).then(
      () => say(`Copied ${state.items.length} buildings. Paste the text here, in any copy of the lab, to open them.`, 'good', 8),
      () => say('The clipboard was refused here. Save file writes the same text to a file.', 'bad', 10),
    );
  };
  /** Opens what was saved, in place of what is set out. */
  const openText = (text: string, from: string) => {
    try {
      const doc = JSON.parse(text), list = Array.isArray(doc) ? doc : doc.items;
      if (!Array.isArray(list)) throw new Error('no buildings in it');
      const items = list.map((o: Partial<Item>) => readItem(o, state.next++)).filter((x): x is Item => !!x);
      if (!items.length) throw new Error('no building in it the lab knows');
      if (STONES.includes(doc.stone)) state.stone = doc.stone;
      if (SEASONS.includes(doc.season)) state.season = doc.season;
      state.items = items; state.selected = null; state.paint = readPaint(doc.paint);
      lay(); sync(); paintLayers(); renderSelected(); reflectScene(); commit(); frame(true);
      say(`Opened ${items.length} buildings from ${from}${items.length < list.length ? `; ${list.length - items.length} could not be read` : ''}. Undo goes back.`, 'good');
    } catch (e) { say(`${from} could not be opened: ${(e as Error).message}`, 'bad', 15); }
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) openText(await f.text(), f.name);
  });
  // Text pasted anywhere but into a field is opened, if it is what the lab saves.
  window.addEventListener('paste', (e) => {
    if (!ready || e.target instanceof HTMLInputElement) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (/"lab"\s*:\s*"dungeons building lab"/.test(text)) { e.preventDefault(); openText(text, 'what was pasted'); }
  });

  // ------------------------------------------------------------------ keys
  // The camera flies on keys held, as in the material lab: W A S D along the ground the way the view looks, Space and Q up and down,
  // Shift faster. (Taken from `code`, so that it is the same keys whatever the keyboard's letters.)
  const flying = new Set<string>(), FLY: Record<string, true> = { KeyW: true, KeyA: true, KeyS: true, KeyD: true, KeyQ: true, Space: true };
  let shiftHeld = false;
  window.addEventListener('keydown', (e) => { shiftHeld = e.shiftKey; }, true);
  window.addEventListener('keyup', (e) => { shiftHeld = e.shiftKey; if (flying.delete(e.code) && !flying.size) keepCamera(); });
  window.addEventListener('blur', () => { if (flying.size) { flying.clear(); keepCamera(); } });
  window.addEventListener('keydown', (e) => {
    if (!ready) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (FLY[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); flying.add(e.code); return; }
    const k = e.key.toLowerCase(), it = selectedItem();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape') {
      if (placing !== null) { const id = placing; placing = null; state.items = state.items.filter((q) => q.id !== id); state.selected = null; sync(); renderSelected(); say('Taken back', 'dim', 2); commit(); }
      else select(null);
    } else if (k === 'z') { if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') redo();
    else if (k === 'm') setTool('move');
    else if (k === 'e') setTool('extrude');
    else if (k === 'r') setTool('scale');
    else if (k === 'b') setTool(state.tool === 'paint' ? 'move' : 'paint');
    else if ((k === '[' || k === ']') && state.tool === 'paint') { state.brush.size = Math.min(20, Math.max(0.3, Math.round(state.brush.size * (k === ']' ? 1.25 : 0.8) * 10) / 10)); brushRing.scale.setScalar(state.brush.size); renderPaint(); remember(); }
    else if (k === 'f') frame(!it);
    else if (k === 'c') { state.clay = !state.clay; dress(); reflectScene(); remember(); }
    else if (k === 'h') { state.overlays = !state.overlays; showOverlays(); reflectScene(); remember(); }
    else if (k === 'p' || k === 'tab') { e.preventDefault(); togglePanel(); }
    else if (!it) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(it.id); }
    else if (k === 'n') nextDoor(e.shiftKey);
    else if (k === '[' || k === ']') { it.turn = turned(it.turn + (k === ']' ? -1 : 1) * (state.turnSnap || 15)); placeItem(it); changed(false); reflect(); commit(); }
    else if (k.startsWith('arrow')) {
      e.preventDefault();
      // (Along the ground as the view looks: up is away from the eye.)
      const ahead = controls.target.clone().sub(camera.position).setY(0).normalize(), aside = new Vector3(-ahead.z, 0, ahead.x), step = e.shiftKey ? 0.1 : state.snap || 0.5;
      const go = k === 'arrowup' ? ahead : k === 'arrowdown' ? ahead.negate() : k === 'arrowright' ? aside : aside.negate();
      it.x = snapped(it.x + go.x * step); it.z = snapped(it.z + go.z * step);
      placeItem(it); changed(false); reflect();
      clearTimeout(nudged); nudged = window.setTimeout(commit, 500);
    }
  });
  let nudged = 0;

  // ------------------------------------------------------------------ fitting the page
  const fit = () => {
    const { w, h } = viewSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    screen = { w, h };
    over.setAttribute('width', String(w)); over.setAttribute('height', String(h));
    over.style.width = `${w}px`; over.style.height = `${h}px`;
    foot.style.bottom = h < window.innerHeight ? `${window.innerHeight - h + 10}px` : 'calc(10px + env(safe-area-inset-bottom, 0px))';
    foot.style.right = `${window.innerWidth - w + 12}px`;
  };
  window.addEventListener('resize', fit);
  document.body.classList.toggle('bare', !state.panel);
  fit();

  // ------------------------------------------------------------------ first making
  try { localStorage.setItem(OPENING, String(Date.now())); } catch { /* storage refused */ }
  if (!state.items.length) demo();
  const t0 = performance.now();
  for (const it of state.items) rebuild(it);
  dirty.clear();
  light();
  renderSelected();
  reflectScene();
  commit();
  if (state.cam) placeCamera(new Vector3(...state.cam.slice(0, 3)), new Vector3(...state.cam.slice(3)));
  else placeCamera(new Vector3(2, 31, 84), new Vector3(4, 1, 0));
  say(`${state.items.length} buildings built in ${(performance.now() - t0).toFixed(0)} ms`, 'dim', 6);
  if (failedOpening) say('The page did not finish opening last time, so it starts from the lab’s own buildings. “Bring back the last layout” under Saved opens yours again.', 'bad', 30);
  // (What was painted, laid as it was left; and the tool in hand as it was.)
  paintLayers();
  setTool(state.tool);
  ready = true;

  // ------------------------------------------------------------------ the loop
  let last = performance.now(), fps = 60, tick = 0, metering = false, exposure = -1, exposureTarget = 0.5, told = 0;
  const drawn = { triangles: 0 };
  let wantPicture: ((url: string) => void) | null = null;
  const step = (now: number) => {
    // (The first frames can be stamped a little before the loop began: no frame is shorter than nothing.)
    const raw = (now - last) / 1000, dt = Math.min(0.1, Math.max(0, raw));
    if (flying.size) {
      // (As fast as the eye is far from what it looks at, so that close in it creeps and far out it covers ground.)
      const ahead = controls.target.clone().sub(camera.position).setY(0), far = camera.position.distanceTo(controls.target);
      if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
      ahead.normalize();
      const aside = new Vector3(-ahead.z, 0, ahead.x), go = new Vector3();
      if (flying.has('KeyW')) go.add(ahead); if (flying.has('KeyS')) go.sub(ahead);
      if (flying.has('KeyD')) go.add(aside); if (flying.has('KeyA')) go.sub(aside);
      if (flying.has('Space')) go.y += 1; if (flying.has('KeyQ')) go.y -= 1;
      if (go.lengthSq() > 0) {
        go.normalize().multiplyScalar(Math.max(4, far * 0.9) * (shiftHeld ? 3 : 1) * dt);
        if (camera.position.y + go.y < 0.5) go.y = 0.5 - camera.position.y;
        camera.position.add(go); controls.target.add(go);
      }
    }
    last = now;
    if (raw > 0.001) fps += (1 / raw - fps) * 0.05;
    // What has changed is built again: the selected building first, and as many others as there is time for in a frame.
    if (dirty.size) {
      const begun = performance.now(), order = [...dirty].sort((a, b) => (b === state.selected ? 1 : 0) - (a === state.selected ? 1 : 0));
      for (const id of order) {
        if (performance.now() - begun > 30) break;
        // (A building is built again no sooner than half as long again as it took to build, after it was last built: a large one dragged
        // through its measures is built a few times a second, not every frame, so that its old geometry can be let go of before the next
        // is made. The largest, a classical front of fifteen bays and six storeys, is some 70 MB a time, and an iPad's memory is short.)
        // While a slider, a knob or a building is held, what is held is built again a few times a second at most, and nothing else.
        const b = built.get(id), holding = sliding || !!held || !!press?.moved;
        if (holding && id !== state.selected) continue;
        if (b && performance.now() - b.at < (holding ? Math.max(250, b.ms * 2) : Math.max(60, b.ms * 1.5))) continue;
        dirty.delete(id);
        const it = itemOf(id);
        if (it) rebuild(it);
      }
    }
    if (tick % 10 === 0) { findClashes(); neighbours(); }
    vegetationUniforms.uTime.value = now / 1000;
    if (allCards.size) cullCards([...allCards], camera.position);
    controls.update();
    if (shadowsDue > 0) { shadowsDue--; sun.shadow.needsUpdate = true; }
    if (staticAt && now > staticAt && !held && !press?.moved) {
      staticAt = 0;
      atmosphere.updateStatic([...(ground && ground.visible ? [ground] : []), ...[...built.values()].flatMap((b) => b.meshes), ...(natureLayer.children as Mesh[])], sunDir, near.min, near.max);
    }
    atmosphere.update();
    pipeline.render();
    { const info = renderer.info.render as unknown as { triangles: number }; drawn.triangles = info.triangles; }
    if (wantPicture) { const give = wantPicture; wantPicture = null; give(canvas.toDataURL('image/png')); }
    drawOver();
    const eyes = SKIES[state.hour].eyes ?? 1.7;
    if (tick % 6 === 0 && !metering) {
      metering = true;
      atmosphere.measure().then((lum) => { exposureTarget = Math.min(eyes, Math.max(0.3, 0.36 * Math.pow(lum, -0.43))); metering = false; }, () => { metering = false; });
    }
    exposure = exposure < 0 ? exposureTarget : exposure + (exposureTarget - exposure) * (1 - Math.exp(-dt * (exposureTarget < exposure ? 3.5 : 1.1)));
    renderer.toneMappingExposure = exposure;
    tick++;
    // (Five pictures drawn: the buildings and the surfaces are on the graphics card, which is where opening fails if it fails.)
    if (tick === 5) try { localStorage.removeItem(OPENING); } catch { /* storage refused */ }
    if (now - told > 300) {
      told = now;
      if (performance.now() > said.until) said.text = '';
      foot.innerHTML = '';
      if (said.text) el('div', foot, said.text).className = said.kind;
      if (clashes.length) {
        const name = (id: number) => KINDS[itemOf(id)?.kind ?? 'timber'].name.toLowerCase();
        el('div', foot, `Standing in one another: ${clashes.slice(0, 3).map(([a, b]) => `${name(a)} and ${name(b)}`).join('; ')}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''}`).className = 'bad';
      }
      const it = selectedItem(), b = it && built.get(it.id);
      if (it && b) {
        const s = it.shape, scaled = it.scale.some((v) => v !== 1) ? `, scaled ${it.scale.map((v) => v.toFixed(2)).join(' × ')}` : '';
        const what = it.kind === 'tree' ? `${s.tree!.kind}, ${s.tree!.height.toFixed(1)} m tall` : it.kind === 'boulder' ? `${s.boulder!.size.toFixed(1)} m across` : `${s.w.toFixed(1)} by ${s.d.toFixed(1)} m, ${it.kind === 'church' ? `${s.bays} bays` : `${s.storeys} storey${s.storeys > 1 ? 's' : ''}, ${s.bays} bays`}`;
        el('div', foot, `${KINDS[it.kind].name}: ${what}${scaled}; built in ${b.ms.toFixed(0)} ms, ${Math.round(b.triangles).toLocaleString()} triangles${b.cards.length ? ` and ${b.cards.reduce((n, m) => n + m.count, 0).toLocaleString()} cards` : ''}`);
      }
      el('div', foot, `${fps.toFixed(0)} frames a second · ${(drawn.triangles / 1e6).toFixed(2)} million triangles drawn · ${state.items.length} building${state.items.length === 1 ? '' : 's'} · ${state.hour}, ${state.stone}`).className = 'dim';
    }
  };
  renderer.setAnimationLoop((now: number) => { try { step(now); } catch (e) { console.error(e); } });

  // For driving the lab from a script: add, choose, move the camera, and take a picture of what is drawn.
  (window as unknown as Record<string, unknown>).__lab = {
    state, camera, controls, built, renderer,
    add: (kind: Kind, o?: { seed?: string; x?: number; z?: number; turn?: number; character?: 'palace' | 'plain' }) => add(kind, { ...o, shape: o?.character ? (seed) => dealCharacter(o.character!, seed) : undefined }).id,
    select, setTool, frame, look, placeCamera: (from: number[], to: number[]) => placeCamera(new Vector3(...from), new Vector3(...to)),
    reshape: (id: number, f: (s: Shape) => void) => { const it = itemOf(id); if (it) { const t = clone(it.shape); f(t); it.shape = normalise(it.kind, t); dirty.add(id); renderSelected(); commit(); } },
    // (A stroke laid from a script as the brush lays one: `layer` ground, plants or rock, `which` the number of what it lays, through points [x, z].)
    stroke: (o: { layer: 'ground' | 'plants' | 'rock'; which?: number; size?: number; dig?: boolean; points: [number, number][] }) => {
      const B = state.brush;
      B.layer = o.layer; if (o.which !== undefined) { if (o.layer === 'ground') B.ground = o.which; else B.plant = o.which; } B.size = o.size ?? B.size;
      const ids = state.paint.ground.map((d) => d[4]);
      stroke = { pointer: -1, last: null, id: (ids.length ? Math.max(...ids) : 0) + 1, before: JSON.stringify(state.paint) };
      // (Dabs along the line between the points, as close together as the brush lays them.)
      const gap = Math.max(0.2, B.size * (o.layer === 'ground' ? 0.3 : 0.6)), pts: [number, number][] = [o.points[0]];
      for (let k = 1; k < o.points.length; k++) {
        const [ax, az] = o.points[k - 1], [bx, bz] = o.points[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / gap));
        for (let t = 1; t <= n; t++) pts.push([ax + ((bx - ax) * t) / n, az + ((bz - az) * t) / n]);
      }
      for (const [x, z] of pts) { const y = o.layer === 'ground' ? 0 : heightAt(x, z) ?? 0; dab({ p: new Vector3(x, y, z), n: new Vector3(0, 1, 0) }, !!o.dig); }
      stroke = null;
      const ms = paintLayers(); commit(); renderPaint();
      return ms;
    },
    remove, clear: () => { state.items = []; state.selected = null; sync(); renderSelected(); commit(); },
    capture: () => new Promise<string>((done) => { wantPicture = done; }),
    pending: () => dirty.size,
    ready: true,
  };
}

start().catch((e) => { console.error(e); say(String(e?.message ?? e), 'bad', 600); foot.textContent = String(e?.message ?? e); });
