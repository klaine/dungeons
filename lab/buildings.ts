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
  ACESFilmicToneMapping, Box3, Color, CubeCamera, DirectionalLight, GridHelper, Group, HalfFloatType, InterleavedBufferAttribute, LinearMipmapLinearFilter,
  Material, Mesh, PCFShadowMap, PerspectiveCamera, Plane, Ray, Raycaster, RenderTarget, Scene, SRGBColorSpace, Vector2, Vector3,
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
import { makeSiteMaterial, makeWindowMaterial, siteUniforms, windowUniforms } from '../src/render/siteMaterial';
import { doneGenerating, generateTextureSet } from '../src/render/textures';
import { buildItem, deal, documentOf, eavesOf, Item, Kind, KIND_ORDER, KINDS, normalise, RANGES, Shape, stoneColour } from './buildingKinds';

type Tool = 'move' | 'extrude' | 'scale';
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
}
const KEY = 'dungeons.lab.buildings';
const query = new URLSearchParams(location.search);
const STONES: Stone[] = ['limestone', 'sandstone', 'greystone', 'basalt'];
const DEFAULTS: State = {
  items: [], next: 1, selected: null, tool: 'move', hour: 'morning', stone: 'greystone', snap: 0.5, turnSnap: 15,
  grid: true, clay: false, air: true, panel: true, cam: null,
};
/** An item read from storage or a file, made safe: a kind the lab knows, numbers that are numbers, and a shape its kind can be. */
function readItem(o: Partial<Item> & { building?: Building }, id: number): Item | null {
  if (!o || !KIND_ORDER.includes(o.kind as Kind)) return null;
  const kind = o.kind as Kind, num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const shape = o.shape ?? (o.building ? (({ x, z, faces, plan, ...rest }) => rest)(o.building) : deal(kind, String(o.seed ?? id)));
  const scale = Array.isArray(o.scale) && o.scale.length === 3 ? (o.scale.map((v) => Math.min(5, Math.max(0.2, num(v, 1)))) as [number, number, number]) : [1, 1, 1] as [number, number, number];
  try {
    return { id, kind, seed: String(o.seed ?? `s${id}`), x: num(o.x, 0), z: num(o.z, 0), turn: num(o.turn, 0), scale, inn: !!o.inn, shape: normalise(kind, shape as Shape) };
  } catch { return null; }
}
const state: State = (() => {
  let kept: Partial<State> = {};
  if (!query.has('fresh')) try { kept = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* nothing kept */ }
  const s: State = { ...DEFAULTS, ...kept, items: [] };
  for (const o of kept.items ?? []) { const it = readItem(o, s.next); if (it) { s.items.push(it); s.next++; } }
  if (!(s.hour in SKIES)) s.hour = 'morning';
  if (!STONES.includes(s.stone)) s.stone = 'greystone';
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
  const size = Number(query.get('tex')) || 1024;
  // (The same recipes with the same seeds as `main.ts`, so that every surface is the game's.)
  const T = {
    stone: generateTextureSet('stone', size, 3), wood: generateTextureSet('wood', size, 5), moss: generateTextureSet('moss', size / 2, 9),
    plaster: generateTextureSet('plaster', size, 41), tile: generateTextureSet('tile', size, 43),
    redBrick: generateTextureSet('redBrick', size, 73), buffBrick: generateTextureSet('buffBrick', size, 79),
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
    metal: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.25, roughness: 0.5 }),
    copper: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.45, roughness: 0.86, mossScale: 2.5 }),
    glass: makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.12, roughness: 0.1 }),
  };
  /** Windows with a lamp behind them glow once the light is going, as in the game; by day they are glass. */
  const lampsAt = (hour: Hour) => (hour === 'night' ? 0.5 : hour === 'dusk' ? 0.55 : hour === 'sunset' ? 0.4 : 0);
  const windows = () => {
    materials.window?.dispose();
    const lamps = lampsAt(state.hour);
    materials.window = lamps ? makeWindowMaterial() : makeSiteMaterial(T.plaster, T.moss, { normalScale: 0.12, roughness: 0.1, paint: [0.04, 0.055, 0.075] });
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
  const meshOf = (name: string, builder: MeshBuilder): Mesh => {
    const mesh = new Mesh(builder.build(), materialOf(name));
    mesh.name = name;
    mesh.castShadow = name !== 'glass' && name !== 'window';
    mesh.receiveShadow = true;
    const open = new Float32Array(builder.vertexCount);
    for (let i = 0; i < open.length; i++) open[i] = builder.openAt(i);
    mesh.userData = { material: name, open };
    skyLight(mesh);
    return mesh;
  };

  // ------------------------------------------------------------------ the square
  const groundGroup = new Group();
  scene.add(groundGroup);
  let ground: Mesh | null = null;
  const lay = () => {
    if (ground) { groundGroup.remove(ground); ground.geometry.dispose(); }
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
  interface Built { holder: Group; meshes: Mesh[]; box: Box3; rects: { u0: number; u1: number; v0: number; v1: number }[]; sig: string; ms: number; triangles: number }
  const built = new Map<number, Built>();
  const dirty = new Set<number>();
  const world = new Group();
  scene.add(world);
  const itemOf = (id: number | null) => (id === null ? undefined : state.items.find((it) => it.id === id));
  const selectedItem = () => itemOf(state.selected);
  const sigOf = (it: Item) => JSON.stringify([it.kind, it.seed, it.shape, !!it.inn, state.stone]);
  /** Puts what is built of an item where the item says it stands, turned and scaled. (Built facing `w`, its front towards -x: a quarter turn more faces it to +z.) */
  const placeItem = (it: Item) => {
    const b = built.get(it.id);
    if (!b) return;
    b.holder.position.set(it.x, 0, it.z);
    b.holder.rotation.set(0, Math.PI / 2 + rad(it.turn), 0);
    b.holder.scale.set(it.scale[2], it.scale[1], it.scale[0]);
    b.holder.updateMatrixWorld(true);
  };
  /** Builds an item again from its document. If the builder fails, what was there stays, and the reason is shown. */
  const rebuild = (it: Item): boolean => {
    const builders = new Map<string, MeshBuilder>(), t0 = performance.now();
    try {
      buildItem(it, state.stone, (m) => { let x = builders.get(m); if (!x) builders.set(m, (x = new MeshBuilder())); return x; });
    } catch (e) {
      console.error(e);
      say(`${KINDS[it.kind].name} could not be built as it is: ${(e as Error).message}`, 'bad', 20);
      return false;
    }
    let b = built.get(it.id);
    if (!b) { b = { holder: new Group(), meshes: [], box: new Box3(), rects: [], sig: '', ms: 0, triangles: 0 }; world.add(b.holder); built.set(it.id, b); }
    for (const m of b.meshes) { b.holder.remove(m); m.geometry.dispose(); }
    b.meshes = []; b.box.makeEmpty(); b.triangles = 0;
    for (const [name, builder] of builders) {
      if (!builder.vertexCount) continue;
      const m = meshOf(name, builder);
      b.holder.add(m); b.meshes.push(m);
      b.box.union(m.geometry.boundingBox!);
      b.triangles += (m.geometry.index?.count ?? 0) / 3;
    }
    b.rects = footprintOf({ ...it.shape, x: 0, z: 0, faces: 'w' } as Building);
    b.sig = sigOf(it); b.ms = performance.now() - t0;
    placeItem(it);
    changed(true);
    return true;
  };
  /** Brings what is built into line with what is set out: new items built, changed ones built again (in the loop, a few at a time), gone ones taken away. */
  const sync = () => {
    for (const [id, b] of built) if (!itemOf(id)) { world.remove(b.holder); for (const m of b.meshes) m.geometry.dispose(); built.delete(id); dirty.delete(id); }
    for (const it of state.items) { const b = built.get(it.id); if (!b || b.sig !== sigOf(it)) dirty.add(it.id); else placeItem(it); }
    changed(true);
  };
  const dress = () => {
    for (const b of built.values()) for (const m of b.meshes) m.material = materialOf(m.userData.material);
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
  const add = (kind: Kind, o: { follow?: boolean; seed?: string; x?: number; z?: number; turn?: number } = {}): Item => {
    const seed = o.seed ?? Math.random().toString(36).slice(2, 8), at = viewCentre();
    const it: Item = { id: state.next++, kind, seed, x: o.x ?? at.x, z: o.z ?? at.z, turn: o.turn ?? 0, scale: [1, 1, 1], inn: false, shape: deal(kind, seed, state.stone) };
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
  const street = () => {
    const at = viewCentre(), rng = Math.random().toString(36).slice(2, 6);
    let prev: Item | null = null;
    for (let k = 0; k < 7; k++) {
      const kind = (['gabled', 'gabled', 'gabled', 'gabled', 'eaves', 'eaves', 'store'] as Kind[])[Math.floor(Math.random() * 7)], seed = `${rng}${k}`;
      const it: Item = { id: state.next++, kind, seed, x: at.x, z: at.z, turn: 0, scale: [1, 1, 1], shape: deal(kind, seed, state.stone) };
      if (prev) besides(prev, it, Math.random() < 0.15 ? 3.5 : 0);
      else { const span = 60; it.x = at.x - span / 2; }
      state.items.push(it);
      prev = it;
    }
    sync(); select(prev!.id); commit();
    say('A street of seven houses, dealt as a town deals them', 'good');
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
  const snapshot = () => JSON.stringify({ items: state.items, next: state.next, selected: state.selected });
  function commit() {
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
    state.items = o.items; state.next = o.next; state.selected = o.selected;
    placing = null;
    sync(); renderSelected(); remember(); reflectTools();
  };
  const undo = () => { if (at > 0) { at--; restore(history[at]); say('Undone', 'dim', 2); } };
  const redo = () => { if (at < history.length - 1) { at++; restore(history[at]); say('Done again', 'dim', 2); } };

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
    const grounds = state.items.map((it) => ({ id: it.id, g: groundOf(it, 0.08) }));
    for (let i = 0; i < grounds.length; i++) for (let j = i + 1; j < grounds.length; j++) {
      if (grounds[i].g.some((a) => grounds[j].g.some((c) => overlaps(a, c)))) clashes.push([grounds[i].id, grounds[j].id]);
    }
  };
  const drawOver = () => {
    const chosen = selectedItem(), clashing = new Set(clashes.flat());
    let others = '', clash = '', mine = '', ring = '', stems = '';
    for (const it of state.items) {
      const d = groundOf(it).map((r) => polyline(r, true)).join('');
      if (it === chosen) mine += d; else if (clashing.has(it.id)) clash += d; else if (state.tool !== 'move' || state.items.length < 40) others += d;
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
  /** Shows on the panel what everything now is. */
  function reflect() { for (const r of selRefreshers) r(); }
  const reflectScene = () => { for (const r of sceneRefreshers) r(); };
  const fmt = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2));
  const slider = (parent: HTMLElement, list: (() => void)[], label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, o: { title?: string; done?: () => void } = {}) => {
    const row = el('div', parent); row.className = 'row';
    const l = el('label', row, label); if (o.title) l.title = row.title = o.title;
    const input = el('input', row); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    const out = el('output', row);
    const show = () => { const v = get(); input.value = String(v); out.textContent = fmt(v, step); };
    input.addEventListener('input', () => { set(Number(input.value)); reflect(); show(); });
    input.addEventListener('change', () => { o.done?.(); input.blur(); });
    list.push(show); show();
  };
  const stepper = (parent: HTMLElement, list: (() => void)[], label: string, get: () => number, set: (v: number) => void, by = 1, title?: string) => {
    const row = el('div', parent); row.className = 'row wide';
    const l = el('label', row, label); if (title) l.title = row.title = title;
    const box = el('div', row); box.className = 'step';
    const less = el('button', box, '−'), out = el('output', box), more = el('button', box, '+');
    less.addEventListener('click', () => { set(get() - by); });
    more.addEventListener('click', () => { set(get() + by); });
    const show = () => { out.textContent = String(get()); };
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
  buttons(panel, [['A street of brick', street, 'Seven houses wall to wall, dealt as a town deals them']]);

  // The building chosen.
  el('h2', panel, 'Selected');
  const selBox = el('div', panel);
  function renderSelected() {
    selBox.innerHTML = '';
    selRefreshers = [];
    const it = selectedItem();
    if (!it) { el('p', selBox, 'Nothing is selected. Tap a building, or add one.').className = 'note'; return; }
    const R = RANGES, list = selRefreshers;
    el('h3', selBox, KINDS[it.kind].name);
    el('p', selBox, KINDS[it.kind].note).className = 'note';
    buttons(selBox, [
      ['Deal anew', () => { it.seed = Math.random().toString(36).slice(2, 8); it.shape = deal(it.kind, it.seed, state.stone); dirty.add(it.id); renderSelected(); commit(); }, 'Another of its kind, dealt as the generator deals one'],
      ['New details', () => { it.seed = Math.random().toString(36).slice(2, 8); dirty.add(it.id); commit(); }, 'The same measures; the builder’s own choices made again: door colours, lit rooms, how rooms are dealt'],
    ]);
    buttons(selBox, [
      ['Next door', () => nextDoor(false), 'N. A new one of its kind beside it, wall to wall, its front on the same line'],
      ['Copy beside', () => nextDoor(true), 'D. The same again beside it'],
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
      wash();
    } else if (it.kind === 'church') {
      const c = () => bw().church!;
      ints('Bays', () => s().bays, (t, v) => bays(t, v, 0), 1, 'bays', 'Bays of the nave, buttress to buttress');
      num('Length', [R.church.bays[0] * R.church.pitch[0], R.church.bays[1] * R.church.pitch[1]], () => s().w, (t, v) => { t.w = v; }, 'The nave from end to end', 0.1);
      num('Breadth', R.church.d, () => s().d, (t, v) => { t.d = v; });
      num('Walls', R.church.wall, () => s().heights[0], (t, v) => { t.heights = [v]; }, 'How high the nave walls stand');
      ints('Towers', () => c().towers, (t, v) => { t.brickwork!.church!.towers = v === 2 ? 2 : 1; }, 1, 'w', 'Two need a nave fifteen metres broad');
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
  choice<Stone>(panel, sceneRefreshers, 'Stone', STONES.map((s): [string, Stone] => [s, s]), () => state.stone, (v) => { state.stone = v; lay(); dress(); sync(); remember(); }, 'The country’s stone: plinths, steps and the paving');
  choice<number>(panel, sceneRefreshers, 'Move by', [['Freely', 0], ['10 cm', 0.1], ['25 cm', 0.25], ['50 cm', 0.5], ['1 m', 1], ['2 m', 2]], () => state.snap, (v) => { state.snap = v; remember(); });
  choice<number>(panel, sceneRefreshers, 'Turn by', [['Freely', 0], ['5°', 5], ['15°', 15], ['45°', 45], ['90°', 90]], () => state.turnSnap, (v) => { state.turnSnap = v; remember(); }, 'Holding Shift while turning turns freely');
  checks(panel, sceneRefreshers, [
    ['grid', () => state.grid, (v) => { state.grid = v; grid.visible = v; remember(); }, 'A line every metre'],
    ['clay', () => state.clay, (v) => { state.clay = v; dress(); remember(); }, 'C. Everything in one plain grey: the shapes alone'],
    ['air', () => state.air, (v) => { state.air = v; atmosphere.uniforms.uEnabled.value = v ? 1 : 0; remember(); }, 'Haze and the light in the air, as the game draws them'],
  ]);
  grid.visible = state.grid;
  el('h3', panel, 'Views');
  buttons(panel, [['F Frame', () => frame(), 'Brings the selected building, or all of them, into view'], ['Front', () => look('front')], ['Corner', () => look('corner')], ['Above', () => look('above')]]);
  el('h3', panel, 'Saved');
  buttons(panel, [
    ['Save file', () => saveFile(), 'Saves what is set out as a file: each building as a site document of the game, with where it stands'],
    ['Copy', () => copyDoc(), 'Copies the same as text, to paste somewhere else; pasting such text here opens it'],
    ['Open file', () => fileInput.click(), 'Opens a file saved here, in place of what is set out'],
  ]);
  buttons(panel, [['Clear all', () => { state.items = []; state.selected = null; sync(); renderSelected(); commit(); }], ['Start again', () => { demo(); sync(); renderSelected(); commit(); frame(); }, 'The buildings the lab starts with']]);
  el('p', panel, 'Drag a building to move it. Drag the ground to turn the view; right drag or two fingers slide it; the wheel or a pinch closes in. M move and turn, E extrude, S scale; [ ] turn a step; arrows nudge; Delete; D copy beside, N next door; Z undo, Shift Z redo; Esc lets go; P hides this panel. All of it is kept in this browser.').className = 'note';

  // The tools, over the picture.
  const toolButtons: Record<string, HTMLButtonElement> = {};
  const toolDef: [string, string, () => void, string][] = [
    ['move', 'Move & turn', () => setTool('move'), 'M. Drag a building to move it; drag the knob on its ring to turn it'],
    ['extrude', 'Extrude', () => setTool('extrude'), 'E. Drag the arrows on its faces to change its measures'],
    ['scale', 'Scale', () => setTool('scale'), 'S. Drag a corner to scale it all, a face to stretch it one way'],
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
    for (const t of ['move', 'extrude', 'scale']) toolButtons[t].classList.toggle('on', state.tool === t);
    toolButtons.undo.disabled = at <= 0;
    toolButtons.redo.disabled = at >= history.length - 1;
  }
  const setTool = (t: Tool) => { state.tool = t; reflectTools(); remember(); };
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
    lab: 'dungeons building lab', version: 1, stone: state.stone, hour: state.hour,
    note: 'Each building: the lab\'s own record (kind, seed, x, z, turn in degrees with 0 facing +z, scale along breadth, height, depth) and `building`, the site document the game builds it from, at the origin facing w.',
    items: state.items.map((it) => ({ ...it, building: documentOf(it) })),
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
      state.items = items; state.selected = null;
      lay(); sync(); renderSelected(); reflectScene(); commit(); frame(true);
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
  window.addEventListener('keydown', (e) => {
    if (!ready) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
    else if (k === 's') setTool('scale');
    else if (k === 'f') frame(!it);
    else if (k === 'c') { state.clay = !state.clay; dress(); reflectScene(); remember(); }
    else if (k === 'p' || k === 'tab') { e.preventDefault(); togglePanel(); }
    else if (!it) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(it.id); }
    else if (k === 'd') nextDoor(true);
    else if (k === 'n') nextDoor(false);
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
  ready = true;

  // ------------------------------------------------------------------ the loop
  let last = performance.now(), fps = 60, tick = 0, metering = false, exposure = -1, exposureTarget = 0.5, told = 0;
  const drawn = { triangles: 0 };
  let wantPicture: ((url: string) => void) | null = null;
  const step = (now: number) => {
    // (The first frames can be stamped a little before the loop began: no frame is shorter than nothing.)
    const raw = (now - last) / 1000, dt = Math.min(0.1, Math.max(0, raw));
    last = now;
    if (raw > 0.001) fps += (1 / raw - fps) * 0.05;
    // What has changed is built again: the selected building first, and as many others as there is time for in a frame.
    if (dirty.size) {
      const begun = performance.now(), order = [...dirty].sort((a, b) => (b === state.selected ? 1 : 0) - (a === state.selected ? 1 : 0));
      for (const id of order) {
        if (performance.now() - begun > 30) break;
        dirty.delete(id);
        const it = itemOf(id);
        if (it) rebuild(it);
      }
    }
    if (tick % 10 === 0) findClashes();
    controls.update();
    if (shadowsDue > 0) { shadowsDue--; sun.shadow.needsUpdate = true; }
    if (staticAt && now > staticAt && !held && !press?.moved) {
      staticAt = 0;
      atmosphere.updateStatic([...(ground ? [ground] : []), ...[...built.values()].flatMap((b) => b.meshes)], sunDir, near.min, near.max);
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
        el('div', foot, `${KINDS[it.kind].name}: ${s.w.toFixed(1)} by ${s.d.toFixed(1)} m, ${it.kind === 'church' ? `${s.bays} bays` : `${s.storeys} storey${s.storeys > 1 ? 's' : ''}, ${s.bays} bays`}${scaled}; built in ${b.ms.toFixed(0)} ms, ${Math.round(b.triangles).toLocaleString()} triangles`);
      }
      el('div', foot, `${fps.toFixed(0)} frames a second · ${(drawn.triangles / 1e6).toFixed(2)} million triangles drawn · ${state.items.length} building${state.items.length === 1 ? '' : 's'} · ${state.hour}, ${state.stone}`).className = 'dim';
    }
  };
  renderer.setAnimationLoop((now: number) => { try { step(now); } catch (e) { console.error(e); } });

  // For driving the lab from a script: add, choose, move the camera, and take a picture of what is drawn.
  (window as unknown as Record<string, unknown>).__lab = {
    state, camera, controls, built,
    add: (kind: Kind, o?: { seed?: string; x?: number; z?: number; turn?: number }) => add(kind, o).id,
    select, setTool, frame, look, placeCamera: (from: number[], to: number[]) => placeCamera(new Vector3(...from), new Vector3(...to)),
    reshape: (id: number, f: (s: Shape) => void) => { const it = itemOf(id); if (it) { const t = clone(it.shape); f(t); it.shape = normalise(it.kind, t); dirty.add(id); renderSelected(); commit(); } },
    capture: () => new Promise<string>((done) => { wantPicture = done; }),
    pending: () => dirty.size,
    ready: true,
  };
}

start().catch((e) => { console.error(e); say(String(e?.message ?? e), 'bad', 600); foot.textContent = String(e?.message ?? e); });
