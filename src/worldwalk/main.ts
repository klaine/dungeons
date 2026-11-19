import { InstancedMesh, Material, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { Hour, SKIES } from '../core/site';
import { FINE, FineSquare, SQUARE, squareCount, squareOrigin, TileData, TileGrid, tilesFor } from '../core/stream';
import { HeightField } from '../core/terrain';
import { WorldPlace } from '../core/world';
import { MeshBuilder } from '../render/geom/meshBuilder';
import { layTerrain } from '../render/landscape';
import { squareBuilders } from '../render/streamMesh';
import { cullCards, vegetationUniforms } from '../render/vegetation';
import { cardsOf, farTrees, groundLook, growLow, growTrees, makeLight, makeMaterials, meshOf, Season, treesIn } from './dress';
import { WalkTouch } from './touch';

/**
 * A walk over a world's land at a metre, streamed in (`docs/06-world.md`), drawn as the game draws:
 * its ground and rock materials, its grass, flowers and trees, its sky, sun and haze (`dress.ts`).
 * To judge the land as it will look before anything is built on it. The world is made in a worker;
 * squares of 256 metres are made in a few more, nearest first, as one walks; each is meshed true to
 * within a distance that grows with how far off it lies, and meshed again as one comes nearer or goes
 * away; beyond them the world's own lattice. Grass and flowers are grown about the walker, trees whole
 * near by and as painted cards beyond.
 *
 * `?world=<seed>`, `?size=6x10`, `?at=valley1` (or `island2`, `mountain3`, or `x,z`); `?radius=` how
 * far squares are made (700 metres unless asked); `?hour=` and `?season=`, `?haze=` (0 to 1), `?tex=`
 * (texture size); `?webgl` as in the game. The world may be named after a `#` too (`#w3`), since a page
 * shown inside another, as an artifact is, keeps a plain name there and nothing else; and the page's two
 * menus choose the world and the place.
 *
 * Its box "Half-metre ground" (or `?fine`, `?fine=0`) splits the squares near the walker into four
 * at half a metre (`refineSquare`), with tussocks, stones and rills a metre at the most at it; it is
 * remembered in the browser. With touch, a thumb stick on the left, looking by dragging on the right,
 * and buttons to fly, rise, sink and go on (`touch.ts`).
 */

const params = new URLSearchParams(location.search);
// (Settings may follow a `#` too, `#world=w2&at=valley1`, as the world page's links give them; a plain `#w2` names the world alone.)
if (location.hash.includes('=')) for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params.set(k, v);
const hud = document.getElementById('hud')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const NEAR = Number(params.get('radius')) || 700, DROP = NEAR + 300;
/** The distances a square may be meshed to, finest first: one is chosen by how far off it lies. */
const LEVELS = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];
const levelFor = (d: number) => { const want = Math.max(0.02, d * 0.0016); const k = LEVELS.findIndex((e) => e >= want); return k < 0 ? LEVELS.length - 1 : k; };
/** How near the walker squares are split into four at half a metre, and how far off they are let go of again. */
const FINE_NEAR = 150, FINE_DROP = 230;
/** How far about the walker grass grows (in blocks of `LOW`), whole trees stand (in blocks of `LOW`), and painted trees (in blocks of a square). */
const LOW = 32, GRASS = 90, TREES = 120, FAR_TREES = 1800;
const hour: Hour = (params.get('hour') as Hour) in SKIES ? (params.get('hour') as Hour) : 'morning';
const season: Season = (['spring', 'summer', 'autumn'] as const).find((s) => s === params.get('season')) ?? 'summer';

interface WorldData { plan: { seed: string; n: number; hx: number; hz: number }; name: string; places: WorldPlace[]; field: HeightField; cover: Uint8Array; sea: Uint8Array; grid: TileGrid }
interface Sq {
  i: number; j: number; x0: number; z0: number; heights: Float32Array; errors: Float32Array; meshes: Mesh[] | null; level: number; triangles: number;
  /** Its four quarters at half a metre, once made; whether they are what is drawn (and walked on) in its place; and whether they are wanted. */
  fine: Part[] | null; fineShown: boolean; fineWanted: boolean;
}
interface Part extends FineSquare { meshes: Mesh[] | null; level: number; triangles: number }
const readFine = (): boolean => {
  if (params.has('fine')) return params.get('fine') !== '0';
  try { return localStorage.getItem('walk.fine') === '1'; } catch { return false; }
};

async function start(): Promise<void> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: params.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Number(params.get('dpr')) || 1.5));
  renderer.setSize(innerWidth, innerHeight);
  const scene = new Scene(), camera = new PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 14000);
  camera.layers.enable(1);
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ---- the world, from its worker; and meanwhile the surfaces painted
  const named = /^[A-Za-z0-9-]{1,24}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : '';
  const seed = named || params.get('world') || 'w2', sz = (params.get('size') ?? '').split('x').map(Number);
  const size = sz.length === 2 && sz.every((v) => v >= 2 && v <= 20) ? { x: sz[0] * 1000, z: sz[1] * 1000 } : undefined;
  const worldWorker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  const coming: Promise<WorldData> = new Promise((resolve) => {
    worldWorker.onmessage = (e) => {
      if (e.data.type === 'progress') { hud.textContent = `${e.data.text}…`; return; }
      const d = e.data.world, f = new HeightField(d.field.x0, d.field.z0, d.field.cell, d.field.nx, d.field.nz);
      f.data.set(d.field.data);
      resolve({ ...d, field: f });
    };
    worldWorker.postMessage({ type: 'world', seed, size });
  });
  const materials: Record<string, Material> = makeMaterials(Number(params.get('tex')) || 1024);
  const W = await coming;
  const worldMs = performance.now() - t0, { field, grid } = W, [SX, SZ] = squareCount(grid);
  const light = makeLight(renderer, scene, camera, hour, Math.min(1, Math.max(0, Number(params.get('haze') ?? 0.4))));
  // (The houses' grounds, fitted to the land: made on it in every square they reach.)
  const grounds = W.places.flatMap((q) => (q.ground ? [q.ground] : []));
  const coverAt = (x: number, z: number) => W.cover[Math.min(field.nz - 1, Math.max(0, Math.round((z - field.z0) / field.cell))) * field.nx + Math.min(field.nx - 1, Math.max(0, Math.round((x - field.x0) / field.cell)))];
  const look = groundLook(coverAt, W.plan.n % 997);
  // The sea: one sheet at its level, out beyond the world's edge, smooth enough to show the sky.
  const water = new MeshStandardNodeMaterial({ color: 0x0b2430, roughness: 0.07, metalness: 0 });
  const sea = new Mesh(new PlaneGeometry(grid.hx * 2 + 24000, grid.hz * 2 + 24000), water);
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.05; sea.receiveShadow = true;
  scene.add(sea);
  const drop = (meshes: (Mesh | InstancedMesh)[]) => { for (const m of meshes) { scene.remove(m); m.geometry.dispose(); } };

  // ---- tiles and squares, from the workers
  const tiles = new Map<string, TileData>(), tileWait = new Map<string, Promise<TileData>>(), tileResolve = new Map<string, (t: TileData) => void>();
  worldWorker.onmessage = (e) => { if (e.data.type === 'tile') { const t = e.data.tile as TileData, key = `${t.i},${t.j}`; tiles.set(key, t); tileResolve.get(key)?.(t); } };
  const tile = (i: number, j: number): Promise<TileData> => {
    const key = `${i},${j}`;
    if (tiles.has(key)) return Promise.resolve(tiles.get(key)!);
    let p = tileWait.get(key);
    if (!p) { p = new Promise((r) => tileResolve.set(key, r)); tileWait.set(key, p); worldWorker.postMessage({ type: 'tile', i, j }); }
    return p;
  };
  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const pool = Array.from({ length: cores }, () => ({ w: new Worker(new URL('./squareWorker.ts', import.meta.url), { type: 'module' }), busy: false, has: new Set<string>() }));
  const squares = new Map<string, Sq>(), pending = new Set<string>(), squareMs: number[] = [];
  const finePending = new Set<string>(), fineMs: number[] = [];
  let fineOn = readFine();
  for (const p of pool) p.w.onmessage = (e) => {
    const m = e.data, key = `${m.i},${m.j}`;
    p.busy = false;
    if (m.type === 'fine') {
      finePending.delete(key); fineMs.push(m.ms);
      const sq = squares.get(key);
      if (sq && fineOn) sq.fine = (m.quarters as FineSquare[]).map((q) => ({ ...q, meshes: null, level: -1, triangles: 0 }));
      return;
    }
    pending.delete(key); squareMs.push(m.ms);
    squares.set(key, { i: m.i, j: m.j, x0: m.x0, z0: m.z0, heights: m.heights, errors: m.errors, meshes: null, level: -1, triangles: 0, fine: null, fineShown: false, fineWanted: false });
  };
  const request = async (i: number, j: number) => {
    const key = `${i},${j}`, worker = pool.find((p) => !p.busy);
    if (!worker || pending.has(key) || squares.has(key)) return;
    worker.busy = true; pending.add(key);
    const need = tilesFor(grid, i, j), data = await Promise.all(need.map(([a, b]) => tile(a, b)));
    const send = data.filter((t) => !worker.has.has(`${t.i},${t.j}`));
    for (const t of send) worker.has.add(`${t.i},${t.j}`);
    worker.w.postMessage({ i, j, seed: W.plan.n, grid, need, tiles: send, grounds });
  };
  /** Asks a worker to split a square into four at half a metre, from its own heights. */
  const requestFine = (sq: Sq) => {
    const key = `${sq.i},${sq.j}`, worker = pool.find((p) => !p.busy);
    if (!worker || finePending.has(key)) return;
    worker.busy = true; finePending.add(key);
    const heights = sq.heights.slice();
    worker.w.postMessage({ type: 'fine', i: sq.i, j: sq.j, x0: sq.x0, z0: sq.z0, heights, seed: W.plan.n, grounds }, [heights.buffer]);
  };
  const squareAt = (x: number, z: number) => squares.get(`${Math.floor((x + grid.hx) / SQUARE.size)},${Math.floor((z + grid.hz) / SQUARE.size)}`);
  /** A height from a square's lattice, at a point given in its points from its north-west corner. */
  const sample = (h: Float32Array, fx: number, fz: number): number => {
    const n = SQUARE.n, cx = Math.min(n - 1.001, Math.max(0, fx)), cz = Math.min(n - 1.001, Math.max(0, fz)), a = Math.floor(cx), b = Math.floor(cz), tx = cx - a, tz = cz - b;
    return h[b * n + a] * (1 - tx) * (1 - tz) + h[b * n + a + 1] * tx * (1 - tz) + h[(b + 1) * n + a] * (1 - tx) * tz + h[(b + 1) * n + a + 1] * tx * tz;
  };
  /** The height of the ground at a point: from what is drawn there, its square or the square's quarter at half a metre, else from the world's lattice. */
  const heightAt = (x: number, z: number): number => {
    const s = squareAt(x, z);
    if (!s) return field.smoothAt(x, z);
    if (s.fineShown && s.fine) {
      const q = s.fine[(x - s.x0 >= FINE.size ? 1 : 0) + (z - s.z0 >= FINE.size ? 2 : 0)];
      return sample(q.heights, (x - q.x0) / FINE.cell, (z - q.z0) / FINE.cell);
    }
    return sample(s.heights, x - s.x0, z - s.z0);
  };
  /**
   * Whether every square under a stretch of ground is in, at the fineness it is wanted at: what grows
   * there is grown on the ground as it will be drawn.
   */
  const squaresUnder = (x0: number, z0: number, s: number) => [[x0, z0], [x0 + s - 0.01, z0], [x0, z0 + s - 0.01], [x0 + s - 0.01, z0 + s - 0.01]].every(([x, z]) => { const q = squareAt(x, z); return q && q.fineWanted === q.fineShown; });

  // ---- the far land: the world's own lattice, read every 32 metres, in blocks of four squares by four, with holes where squares lie
  const BLOCK = 4, FAR = 32, farMeshes = new Map<string, Mesh[]>(), farDirty = new Set<string>();
  const blockOf = (i: number, j: number) => `${Math.floor(i / BLOCK)},${Math.floor(j / BLOCK)}`;
  for (let bj = 0; bj < Math.ceil(SZ / BLOCK); bj++) for (let bi = 0; bi < Math.ceil(SX / BLOCK); bi++) farDirty.add(`${bi},${bj}`);
  let landDrawn = false;
  const buildFar = (key: string) => {
    const [bi, bj] = key.split(',').map(Number), turf = new MeshBuilder(), rock = new MeshBuilder();
    // (A metre low, so that where a square lies beside it the square's own ground is what shows.)
    const low = (x: number, z: number) => field.smoothAt(x, z) - 1;
    for (let j = bj * BLOCK; j < Math.min(SZ, (bj + 1) * BLOCK); j++) for (let i = bi * BLOCK; i < Math.min(SX, (bi + 1) * BLOCK); i++) {
      const sq = squares.get(`${i},${j}`);
      if (sq && (sq.meshes || sq.fineShown)) continue;
      const [x0, z0] = squareOrigin(grid, i, j);
      layTerrain(turf, rock, low, {
        area: { x0, x1: x0 + SQUARE.size, z0, z1: z0 + SQUARE.size }, cell: FAR, skip: () => false, seed: 7, stone: [0.6, 0.58, 0.56], turfScale: 2.3, rockScale: 0.4, bare: 0.6,
        colour: (x, z) => look.turf(x, z, field.smoothAt(x, z), Math.hypot(field.smoothAt(x + 8, z) - field.smoothAt(x - 8, z), field.smoothAt(x, z + 8) - field.smoothAt(x, z - 8)) / 16),
        rock: (tone) => { const c = look.rock(0, 0, 0); return [c[0] * tone * 1.6, c[1] * tone * 1.6, c[2] * tone * 1.6]; },
      });
    }
    drop(farMeshes.get(key) ?? []);
    farMeshes.delete(key);
    const made = [turf, rock].flatMap((b, k) => (b.triangleCount ? [meshOf(b, k ? materials.rock : materials.turf, hour)] : []));
    for (const m of made) { m.castShadow = false; scene.add(m); }
    farMeshes.set(key, made);
  };

  // ---- what grows: about the walker, grass, flowers and whole trees; beyond, painted trees
  const lows = new Map<string, InstancedMesh[]>(), nears = new Map<string, (Mesh | InstancedMesh)[]>(), fars = new Map<string, { at: Vector3; meshes: InstancedMesh[] }>();
  let counts = { tufts: 0, trees: 0, farTrees: 0 };
  const lowBlock = (bx: number, bz: number) => {
    const x0 = bx * LOW, z0 = bz * LOW, sets = growLow(x0, z0, LOW, heightAt, coverAt, W.plan.n % 997, season), meshes = cardsOf(sets);
    for (const m of meshes) scene.add(m);
    lows.set(`${bx},${bz}`, meshes);
    counts.tufts += sets.reduce((s, q) => s + q.matrices.length / 16, 0);
  };
  const treeBlock = (bx: number, bz: number) => {
    const x0 = bx * LOW, z0 = bz * LOW, trees = treesIn(x0, z0, LOW, coverAt, heightAt, W.plan.n), out: (Mesh | InstancedMesh)[] = [];
    if (trees.length) {
      const { wood, sets } = growTrees(trees, heightAt, season);
      for (const [name, b] of wood) if (b.triangleCount) out.push(meshOf(b, materials[name], hour));
      out.push(...cardsOf(sets));
      for (const m of out) scene.add(m);
      counts.trees += trees.length;
    }
    nears.set(`${bx},${bz}`, out);
    light.redraw();
  };
  /** Painted trees in a square's ground, all but those near enough to stand whole. */
  const farTreeBlock = (i: number, j: number) => {
    const [x0, z0] = squareOrigin(grid, i, j), key = `${i},${j}`, at = me.clone();
    const trees = treesIn(x0, z0, SQUARE.size, coverAt, heightAt, W.plan.n).filter((t) => Math.hypot(t.x - at.x, t.z - at.z) > TREES - 10);
    drop(fars.get(key)?.meshes ?? []);
    const meshes = cardsOf(farTrees(trees, heightAt, season));
    for (const m of meshes) { m.castShadow = false; scene.add(m); }
    fars.set(key, { at, meshes });
  };

  // ---- where one stands, and walking
  const place = (spec: string): Vector3 => {
    const m = spec.match(/^(valley|island|mountain|coast)(\d)$/), q = m ? W.places.find((p) => p.kind === m[1] && p.n === Number(m[2])) : undefined;
    if (q) return new Vector3(q.x, 0, q.z);
    const xz = spec.split(',').map(Number);
    return xz.length === 2 && xz.every(Number.isFinite) ? new Vector3(xz[0], 0, xz[1]) : new Vector3(W.places[0]?.x ?? 0, 0, W.places[0]?.z ?? 0);
  };
  const me = place(params.get('at') ?? (W.places.find((q) => q.kind === 'valley') ? 'valley1' : `${W.places[0]?.kind ?? 'valley'}1`));
  // The menus: which world (the page made again for it), and which of its places to go to.
  {
    const worlds = document.getElementById('worlds') as HTMLSelectElement | null, where = document.getElementById('where') as HTMLSelectElement | null;
    if (worlds) {
      const list = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'];
      if (!list.includes(seed)) list.unshift(seed);
      worlds.innerHTML = list.map((s) => `<option value="${s}"${s === seed ? ' selected' : ''}>World ${s}</option>`).join('');
      worlds.addEventListener('change', () => { location.hash = worlds.value; location.reload(); });
    }
    // The game, built on the place chosen: where it is, as the page's head says (`<meta name="dungeons-game">`), or the usual file.
    const play = document.getElementById('play') as HTMLAnchorElement | null;
    const game = document.querySelector<HTMLMetaElement>('meta[name="dungeons-game"]')?.content || './index.html';
    const playAt = (spec: string) => {
      const m = spec.match(/^(valley|island|mountain|coast)(\d)$/);
      if (play) play.hidden = !m;
      if (play && m) play.href = `${game}#${new URLSearchParams({ world: seed, place: m[1] === 'coast' ? 'town' : m[1], n: m[2] })}`;
    };
    if (where) {
      const KIND: Record<string, string> = { island: 'island', valley: 'valley head', mountain: 'mountain top', coast: 'coastal town' };
      where.innerHTML = W.places.map((q) => `<option value="${q.kind}${q.n}">${q.name}, ${KIND[q.kind]}</option>`).join('');
      const start = params.get('at') ?? '';
      if (W.places.some((q) => `${q.kind}${q.n}` === start)) where.value = start;
      where.addEventListener('change', () => { const to = place(where.value); me.set(to.x, 0, to.z); playAt(where.value); where.blur(); });
      playAt(where.value);
    } else playAt('');
  }
  let placeIndex = 0;
  let yaw = 0, pitch = -0.05, flying = params.has('fly'), lift = 1.7;
  const keys = new Set<string>();
  const nextPlace = () => {
    if (!W.places.length) return;
    const q = W.places[placeIndex++ % W.places.length], menu = document.getElementById('where') as HTMLSelectElement | null;
    // (By the menu, where there is one, so that it and the link to the game follow.)
    if (menu) { menu.value = `${q.kind}${q.n}`; menu.dispatchEvent(new Event('change')); } else me.set(q.x, 0, q.z);
  };
  const turn = (dYaw: number, dPitch: number) => { yaw += dYaw; pitch = Math.max(-1.5, Math.min(1.5, pitch + dPitch)); };
  const touch = new WalkTouch(canvas, { look: turn, next: nextPlace, fly: () => toggleFly() });
  function toggleFly(): boolean { flying = !flying; lift = flying ? Math.max(lift, 20) : 1.7; touch.flying(flying); return flying; }
  touch.flying(flying);
  // The box for ground at half a metre: what grows is grown again on the ground as it will now be.
  const setFine = (on: boolean) => {
    if (on === fineOn) return;
    fineOn = on;
    try { localStorage.setItem('walk.fine', on ? '1' : '0'); } catch { /* (not kept: a private window, or a page shown inside another) */ }
    for (const meshes of [...lows.values(), ...nears.values()]) drop(meshes);
    for (const f of fars.values()) drop(f.meshes);
    lows.clear(); nears.clear(); fars.clear();
    counts = { tufts: 0, trees: 0, farTrees: 0 };
  };
  {
    const box = document.getElementById('fine') as HTMLInputElement | null;
    if (box) { box.checked = fineOn; box.addEventListener('change', () => { setFine(box.checked); box.blur(); }); }
  }
  const wireframe = (on: boolean) => { for (const k of ['turf', 'rock']) (materials[k] as MeshStandardNodeMaterial).wireframe = on; };
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === 'KeyV' && !e.repeat) toggleFly();
    if (e.code === 'KeyM' && !e.repeat) wireframe(!(materials.turf as MeshStandardNodeMaterial).wireframe);
    // (Numbers for valley heads, with Shift for islands; P for the next place of any kind. Ctrl with a number changes the browser's tab.)
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const spec = `${e.shiftKey ? 'island' : 'valley'}${digit[1]}`, menu = document.getElementById('where') as HTMLSelectElement | null;
      if (menu && W.places.some((q) => `${q.kind}${q.n}` === spec)) { menu.value = spec; menu.dispatchEvent(new Event('change')); } else { const to = place(spec); me.set(to.x, 0, to.z); }
      e.preventDefault();
    }
    if (e.code === 'KeyP' && !e.repeat) nextPlace();
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code));
  // (The mouse is caught to look with; a finger is left to the touch controls.)
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    try { (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined); } catch { /* (refused: some frames do) */ }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => { if (document.pointerLockElement === canvas) turn(-e.movementX * 0.0022, -e.movementY * 0.0022); });

  // ---- the loop
  const frames: number[] = [];
  let last = performance.now(), rebuilt = 0, shown = 0, tick = 0, metering = false, exposure = -1, exposureTarget = 0.5;
  /** The squares within reach of where one stands. */
  function* squaresWanted(): Generator<string> {
    const ci = Math.floor((me.x + grid.hx) / SQUARE.size), cj = Math.floor((me.z + grid.hz) / SQUARE.size), r = Math.ceil(NEAR / SQUARE.size) + 1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < SX && j < SZ && distTo(i, j) < NEAR) yield `${i},${j}`;
  }
  /** How far the nearest point of a stretch of ground lies from where one stands, on the level; and of a square. */
  const distRect = (x0: number, z0: number, s: number) => Math.hypot(Math.max(0, x0 - me.x, me.x - x0 - s), Math.max(0, z0 - me.z, me.z - z0 - s));
  const distTo = (i: number, j: number) => { const [x0, z0] = squareOrigin(grid, i, j); return distRect(x0, z0, SQUARE.size); };
  /** The blocks of `LOW` metres within `r` of where one stands, nearest first. */
  const blocksNear = (r: number): [number, number, number][] => {
    const out: [number, number, number][] = [], c = Math.ceil(r / LOW) + 1, bx = Math.floor(me.x / LOW), bz = Math.floor(me.z / LOW);
    for (let j = bz - c; j <= bz + c; j++) for (let i = bx - c; i <= bx + c; i++) {
      const d = Math.hypot(Math.max(0, i * LOW - me.x, me.x - (i + 1) * LOW), Math.max(0, j * LOW - me.z, me.z - (j + 1) * LOW));
      if (d < r && Math.abs(i * LOW) < grid.hx + LOW && Math.abs(j * LOW) < grid.hz + LOW) out.push([i, j, d]);
    }
    return out.sort((a, b) => a[2] - b[2]);
  };
  const stats = () => {
    let tris = 0;
    const levels = LEVELS.map(() => 0);
    let fine = 0, fineTriangles = 0;
    for (const s of squares.values()) {
      if (s.meshes) { tris += s.triangles; levels[s.level]++; }
      if (s.fineShown && s.fine) { fine++; for (const p of s.fine) fineTriangles += p.triangles; }
    }
    const ms = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0, sorted = [...squareMs].sort((a, b) => a - b), fineSorted = [...fineMs].sort((a, b) => a - b);
    let farCount = 0;
    for (const f of fars.values()) for (const m of f.meshes) farCount += m.count;
    return { frameMs: ms, squares: squares.size, pending: pending.size, tiles: tiles.size, squareTriangles: tris + fineTriangles, fineOn, fine, finePending: finePending.size, fineTriangles, fineMsMiddle: fineSorted[Math.floor(fineSorted.length / 2)] ?? 0, drawnTriangles: renderer.info.render.triangles, levels, squareMsMiddle: sorted[Math.floor(sorted.length / 2)] ?? 0, worldMs, rebuilt, x: me.x, z: me.z, y: camera.position.y, yaw, pitch, flying, lowBlocks: lows.size, treeBlocks: nears.size, farTreeCards: farCount, ...counts };
  };
  const wantedLow = () => blocksNear(GRASS).filter(([i, j]) => squaresUnder(i * LOW, j * LOW, LOW));
  const wantedTrees = () => blocksNear(TREES).filter(([i, j]) => squaresUnder(i * LOW, j * LOW, LOW));
  (window as unknown as { __walk: unknown }).__walk = {
    stats, wireframe,
    /** Ground at half a metre near the walker, or not. */
    fine: (on: boolean) => { setFine(on); const box = document.getElementById('fine') as HTMLInputElement | null; if (box) box.checked = on; },
    /** Goes to a place by its kind and number: `valley1`, `island2`, `mountain3`. */
    to: (spec: string) => { const p = place(spec); me.set(p.x, 0, p.z); },
    goto: (x: number, z: number, y?: number, yawTo?: number, pitchTo?: number, fly?: boolean) => { me.set(x, 0, z); if (yawTo !== undefined) yaw = yawTo; if (pitchTo !== undefined) pitch = pitchTo; if (fly !== undefined) flying = fly; if (y !== undefined) lift = y; },
    settled: () => pending.size === 0 && finePending.size === 0 && [...squaresWanted()].every((k) => { const s = squares.get(k); return s && (s.fineWanted ? s.fineShown : !!s.meshes); }) && wantedLow().every(([i, j]) => lows.has(`${i},${j}`)) && wantedTrees().every(([i, j]) => nears.has(`${i},${j}`)) && farDirty.size === 0,
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; frames.push(dt * 1000); if (frames.length > 90) frames.shift();
    // Moving: along the ground, or flying where one looks.
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.move.run, speed = flying ? (run ? 160 : 40) : run ? 12 : 4.5;
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) - touch.move.y, s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.move.x;
    me.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt; me.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt;
    me.x = Math.max(-grid.hx, Math.min(grid.hx, me.x)); me.z = Math.max(-grid.hz, Math.min(grid.hz, me.z));
    if (flying) lift = Math.max(1.7, lift + ((keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0) + touch.move.rise) * speed * dt);
    const groundY = heightAt(me.x, me.z);
    camera.position.set(me.x, Math.max(groundY, 0) + lift, me.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    // Streaming: ask for what is near and missing, nearest first; let go of what is far.
    const wanted = [...squaresWanted()].map((k) => { const [i, j] = k.split(',').map(Number); return { k, i, j, d: distTo(i, j) }; }).sort((a, b) => a.d - b.d);
    // (Near squares are split into four at half a metre when that is asked for, once they are in; nearest first, among the rest.)
    for (const q of wanted) {
      const sq = squares.get(q.k);
      if (!sq) { if (!pending.has(q.k)) void request(q.i, q.j); continue; }
      sq.fineWanted = fineOn && q.d < (sq.fine || sq.fineShown || finePending.has(q.k) ? FINE_DROP : FINE_NEAR);
      if (sq.fineWanted && !sq.fine) requestFine(sq);
    }
    for (const [k, sq] of squares) if (distTo(sq.i, sq.j) > DROP) {
      drop(sq.meshes ?? []);
      for (const p of sq.fine ?? []) drop(p.meshes ?? []);
      squares.delete(k); farDirty.add(blockOf(sq.i, sq.j));
    }
    // Meshing: each square to the distance its own distance calls for; a few a frame, nearest first, so no frame waits long.
    let budget = 2;
    for (const q of wanted) {
      if (budget <= 0) break;
      const sq = squares.get(q.k);
      if (!sq) continue;
      if (sq.fineWanted && sq.fine) {
        // Its four quarters at half a metre, each to its own distance; drawn in its place once all four are made.
        for (const p of sq.fine) {
          const level = levelFor(distRect(p.x0, p.z0, FINE.size));
          if (level === p.level || budget <= 0) continue;
          const m = squareBuilders(p.x0, p.z0, p.heights, p.errors, LEVELS[level], look, 0.72, FINE.cell);
          const meshes = [meshOf(m.turf, materials.turf, hour), meshOf(m.rock, materials.rock, hour)];
          drop(p.meshes ?? []);
          if (sq.fineShown) for (const mesh of meshes) scene.add(mesh);
          p.meshes = meshes; p.level = level; p.triangles = m.triangles;
          budget--; rebuilt++;
          if (sq.fineShown && q.d < 200) light.redraw();
        }
        if (!sq.fineShown && sq.fine.every((p) => p.meshes)) {
          for (const p of sq.fine) for (const mesh of p.meshes!) scene.add(mesh);
          if (sq.meshes) drop(sq.meshes); else farDirty.add(blockOf(sq.i, sq.j));
          sq.meshes = null; sq.level = -1; sq.fineShown = true;
          light.redraw();
        }
        continue;
      }
      // At a metre: made again when it is wanted at another distance, or back from half a metre.
      const level = levelFor(q.d);
      if (level !== sq.level || !sq.meshes) {
        const m = squareBuilders(sq.x0, sq.z0, sq.heights, sq.errors, LEVELS[level], look);
        if (sq.meshes) drop(sq.meshes); else if (!sq.fineShown) farDirty.add(blockOf(sq.i, sq.j));
        sq.meshes = [meshOf(m.turf, materials.turf, hour), meshOf(m.rock, materials.rock, hour)];
        for (const mesh of sq.meshes) scene.add(mesh);
        sq.level = level; sq.triangles = m.triangles;
        budget--; rebuilt++;
        if (q.d < 200) light.redraw();
      }
      // (Its quarters let go of only once it is drawn at a metre again, so that no hole shows between.)
      if (sq.fine) { for (const p of sq.fine) drop(p.meshes ?? []); sq.fine = null; sq.fineShown = false; }
    }
    // The far land: a block or two a frame, where squares have come or gone; and the air's maps of it, once it is all in.
    let farBudget = 2;
    for (const key of farDirty) { if (farBudget-- <= 0) break; farDirty.delete(key); buildFar(key); }
    if (!landDrawn && farDirty.size === 0) { landDrawn = true; light.land([...farMeshes.values()].flat(), new Vector3(-grid.hx, -150, -grid.hz), new Vector3(grid.hx, 900, grid.hz)); }
    // What grows: a block of grass and one of trees a frame, nearest first; painted trees a square or two; what is far let go.
    for (const [i, j] of wantedLow()) if (!lows.has(`${i},${j}`)) { lowBlock(i, j); break; }
    for (const [i, j] of wantedTrees()) if (!nears.has(`${i},${j}`)) { treeBlock(i, j); break; }
    for (const [k, meshes] of lows) { const [i, j] = k.split(',').map(Number); if (Math.hypot((i + 0.5) * LOW - me.x, (j + 0.5) * LOW - me.z) > GRASS + 60) { drop(meshes); lows.delete(k); } }
    for (const [k, meshes] of nears) { const [i, j] = k.split(',').map(Number); if (Math.hypot((i + 0.5) * LOW - me.x, (j + 0.5) * LOW - me.z) > TREES + 60) { drop(meshes); nears.delete(k); } }
    {
      let farTreeBudget = 2;
      const ci = Math.floor((me.x + grid.hx) / SQUARE.size), cj = Math.floor((me.z + grid.hz) / SQUARE.size), r = Math.ceil(FAR_TREES / SQUARE.size);
      for (let j = cj - r; j <= cj + r && farTreeBudget > 0; j++) for (let i = ci - r; i <= ci + r && farTreeBudget > 0; i++) {
        if (i < 0 || j < 0 || i >= SX || j >= SZ || distTo(i, j) > FAR_TREES) continue;
        const had = fars.get(`${i},${j}`);
        // (Made again where the walker has gone far enough that trees near them then, left out as standing whole, are now far again; or near ones are.)
        if (had && (distTo(i, j) > TREES + 200 || had.at.distanceTo(me) < 40)) continue;
        farTreeBlock(i, j); farTreeBudget--;
      }
      for (const [k, f] of fars) { const [i, j] = k.split(',').map(Number); if (distTo(i, j) > FAR_TREES + 300) { drop(f.meshes); fars.delete(k); } }
    }
    vegetationUniforms.uTime.value = now / 1000;
    const cards = [...[...lows.values()].flat(), ...[...nears.values()].flat().filter((m): m is InstancedMesh => (m as InstancedMesh).isInstancedMesh)];
    cullCards(cards, camera.position);
    light.follow(me, groundY);
    light.atmosphere.update();
    light.pipeline.render();
    // The eye adjusts to the picture, as in the game.
    if (tick++ % 6 === 0 && !metering) {
      metering = true;
      light.atmosphere.measure().then((lum) => { exposureTarget = Math.min(light.eyes, Math.max(0.3, 0.36 * Math.pow(lum, -0.43))); metering = false; }, () => { metering = false; });
    }
    exposure = exposure < 0 ? exposureTarget : exposure + (exposureTarget - exposure) * (1 - Math.exp(-dt * (exposureTarget < exposure ? 3.5 : 1.1)));
    renderer.toneMappingExposure = exposure;
    if (now - shown > 250) {
      shown = now;
      const st = stats();
      hud.textContent = `${W.name}: world made in ${(worldMs / 1000).toFixed(0)} s · ${hour}, ${season}\n` +
        `frame ${st.frameMs.toFixed(1)} ms · drawn ${st.drawnTriangles.toLocaleString()} triangles\n` +
        `squares ${st.squares} (${st.pending} coming), ${st.squareTriangles.toLocaleString()} triangles; a square ${st.squareMsMiddle.toFixed(0)} ms in a worker (${cores} at work)\n` +
        (fineOn ? `at half a metre ${st.fine} (${st.finePending} coming), ${st.fineTriangles.toLocaleString()} triangles; four ${st.fineMsMiddle.toFixed(0)} ms\n` : '') +
        `grass in ${st.lowBlocks} blocks · ${st.treeBlocks} blocks of whole trees · ${st.farTreeCards.toLocaleString()} painted trees\n` +
        `at ${me.x.toFixed(0)}, ${me.z.toFixed(0)}, ground ${groundY.toFixed(1)} m${flying ? ', flying' : ''}`;
    }
  };
  renderer.setAnimationLoop((now: number) => { try { frame(now); } catch (e) { hud.textContent = `Fault: ${(e as Error).message}`; console.error(e); } });
}

start().catch((e) => { hud.textContent = `Could not start: ${(e as Error).message}`; console.error(e); });
