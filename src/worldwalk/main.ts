import { BufferAttribute, InstancedMesh, Material, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { Hour, SKIES } from '../core/site';
import { FINE, FineSquare, SQUARE, squareCount, squareOrigin, TileData, TileGrid, tilesFor } from '../core/stream';
import { HeightField } from '../core/terrain';
import { WORLD_SIZE, WorldPlace } from '../core/world';
import { MeshBuilder } from '../render/geom/meshBuilder';
import { layTerrain } from '../render/landscape';
import { squareBuilders } from '../render/streamMesh';
import { cullCards, treeGrownMap, treeLevels, vegetationUniforms } from '../render/vegetation';
import { cardsOf, farTrees, groundLook, growLow, growTrees, makeLight, makeMaterials, meshOf, Season, treesIn, woodDepth } from './dress';
import { worldMapOf, WorldData as HandedWorld } from '../worldmap/worldData';
import { Player } from '../app/player';
import { WorldColliders } from './body';
import { RouteReply, RouteWalk } from './routeMode';
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
 *
 * The same page is the route page (`lab/route.html`, its body marked `data-walk="route"`): one way from a coastal town to a valley
 * head walked in a corridor about it (`routeMode.ts`); `?from=coast1&to=valley1` (else the shortest town's way), `?broad=` the
 * corridor's breadth (300 metres), `?beyond=` how far past its edge squares are made (200).
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
/**
 * How far about the walker grass grows (in blocks of `LOW`), and painted trees stand (in blocks of a square). Trees are drawn three ways
 * (whole, grown more simply with a trunk, its main limbs and fewer, larger sprays, and as one painted card), each tree giving way from
 * one to the next at a distance of its own within the bands `treeLevels` sets (`vegetation.ts`): 110 to 150 metres from whole to simple,
 * 300 to 360 from simple to painted. So the blocks of each way are grown out a little past where it can be seen, and both ways stand
 * in a block within a band, the shader drawing each tree one way or the other (`WHOLE`, `SIMPLE_FROM`, `MID`: how near a block must
 * lie to be grown whole, and how far from and how near to be grown simply). (Each block had changed whole at once, at 120 and 320
 * metres, and painted squares were painted again whenever a block changed: the more detailed trees came in a block a frame, where one
 * could see them come.)
 */
const LOW = 32, GRASS = 90, FAR_TREES = 1800, BEYOND = 6;
const WHOLE = treeLevels.uNear.value.y + treeLevels.uSoft.value + BEYOND, SIMPLE_FROM = treeLevels.uNear.value.x - treeLevels.uSoft.value - BEYOND, MID = treeLevels.uFar.value.y + treeLevels.uSoft.value + BEYOND;
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
  // (The route page's own world, where its body names one: the world with the shortest way from a town to a valley head found.)
  const seed = named || params.get('world') || document.body.dataset.world || 'w2', sz = (params.get('size') ?? '').split('x').map(Number);
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
  // Which blocks of trees are grown, whole and simply, for the shader (`treeGrownMap`): made before any material that draws trees.
  const grownMap = treeGrownMap((size ?? WORLD_SIZE).x / 2, (size ?? WORLD_SIZE).z / 2, LOW);
  const materials: Record<string, Material> = makeMaterials(Number(params.get('tex')) || 1024);
  const W = await coming;
  const worldMs = performance.now() - t0, { field, grid } = W, [SX, SZ] = squareCount(grid);
  const light = makeLight(renderer, scene, camera, hour, Math.min(1, Math.max(0, Number(params.get('haze') ?? 0.4))));
  // (The houses' grounds, fitted to the land: made on it in every square they reach.)
  const grounds = W.places.flatMap((q) => (q.ground ? [q.ground] : []));
  const coverAt = (x: number, z: number) => W.cover[Math.min(field.nz - 1, Math.max(0, Math.round((z - field.z0) / field.cell))) * field.nx + Math.min(field.nx - 1, Math.max(0, Math.round((x - field.x0) / field.cell)))];
  // (On the route page, the way's track: how far to one side of its middle, which the ground's material draws as ruts and bare earth.)
  let trackAt: ((x: number, z: number) => number) | null = null;
  const plainLook = groundLook(coverAt, W.plan.n % 997);
  const look: typeof plainLook = { ...plainLook, turf: (x, z, y, slope) => { const c = plainLook.turf(x, z, y, slope); if (trackAt) c[3] = trackAt(x, z); return c; } };
  // (What grows reads what lies at a point through these: on the route page, nothing grows on the way, nor trees close beside it.)
  let growCover = coverAt, treeCover = coverAt;
  // The sea: one sheet at its level, out beyond the world's edge, smooth enough to show the sky.
  const water = new MeshStandardNodeMaterial({ color: 0x0b2430, roughness: 0.07, metalness: 0 });
  const sea = new Mesh(new PlaneGeometry(grid.hx * 2 + 24000, grid.hz * 2 + 24000), water);
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.05; sea.receiveShadow = true;
  scene.add(sea);
  const drop = (meshes: (Mesh | InstancedMesh)[]) => { for (const m of meshes) { scene.remove(m); m.geometry.dispose(); } };

  // ---- tiles and squares, from the workers
  const tiles = new Map<string, TileData>(), tileWait = new Map<string, Promise<TileData>>(), tileResolve = new Map<string, (t: TileData) => void>();
  let routeReply: ((m: RouteReply) => void) | null = null;
  worldWorker.onmessage = (e) => {
    if (e.data.type === 'tile') { const t = e.data.tile as TileData, key = `${t.i},${t.j}`; tiles.set(key, t); tileResolve.get(key)?.(t); }
    else if (e.data.type === 'route') routeReply?.(e.data as RouteReply);
  };
  // The route page: the way to walk, laid and graded in the world's worker, before any square is asked for, since each is made with its bed.
  const game = document.querySelector<HTMLMetaElement>('meta[name="dungeons-game"]')?.content || './index.html';
  const reply = document.body.dataset.walk === 'route'
    ? await new Promise<RouteReply>((resolve) => { routeReply = resolve; hud.textContent = 'Laying the way…'; worldWorker.postMessage({ type: 'route', from: params.get('from'), to: params.get('to') }); })
    : null;
  const route = reply?.route && reply.way
    ? new RouteWalk({ ...reply, route: reply.route, way: reply.way }, { seed, grid, broad: Math.max(40, Number(params.get('broad')) || 300), beyond: params.has('beyond') ? Math.max(0, Number(params.get('beyond'))) : 200, game, size })
    : null;
  if (reply && !route) hud.textContent = 'This world has no way from a town to a valley head to walk.';
  const ways = route ? [route.way] : [];
  if (route) {
    trackAt = (x, z) => route.track(x, z); growCover = route.coverFor(coverAt, 0.8); treeCover = route.coverFor(coverAt, 4);
    // (The ink map of the stretch the way crosses: from what the world's worker handed over, which is all the ink map needs.)
    route.setWorld(worldMapOf(W as unknown as HandedWorld));
    document.getElementById('mapbutton')?.addEventListener('click', (e) => { e.preventDefault(); route.toggleInk(); (e.currentTarget as HTMLElement).blur(); });
    document.getElementById('inkpanel')?.addEventListener('click', () => route.toggleInk(false));
  }
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
  // (Not on the route page: the tussocks and rills of the half metre would be laid on the way's bed too.)
  let fineOn = !route && readFine();
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
    if (colliders.covers(m.x0, m.z0, m.x0 + SQUARE.size, m.z0 + SQUARE.size)) landVersion++;
    squares.set(key, { i: m.i, j: m.j, x0: m.x0, z0: m.z0, heights: m.heights, errors: m.errors, meshes: null, level: -1, triangles: 0, fine: null, fineShown: false, fineWanted: false });
  };
  const request = async (i: number, j: number) => {
    const key = `${i},${j}`, worker = pool.find((p) => !p.busy);
    if (!worker || pending.has(key) || squares.has(key)) return;
    worker.busy = true; pending.add(key);
    const need = tilesFor(grid, i, j), data = await Promise.all(need.map(([a, b]) => tile(a, b)));
    const send = data.filter((t) => !worker.has.has(`${t.i},${t.j}`));
    for (const t of send) worker.has.add(`${t.i},${t.j}`);
    worker.w.postMessage({ i, j, seed: W.plan.n, grid, need, tiles: send, grounds, ways });
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

  // ---- what grows: about the walker, grass, flowers and whole trees; further, trees grown simply; beyond, painted trees
  const lows = new Map<string, InstancedMesh[]>(), nears = new Map<string, (Mesh | InstancedMesh)[]>(), mids = new Map<string, (Mesh | InstancedMesh)[]>(), fars = new Map<string, { at: Vector3; meshes: InstancedMesh[] }>();
  // How far inside the world's woods each point lies: a wood is close in its heart and thins to its edge, with single trees past it
  // and bramble, bushes and young trees along it (`treesIn`, `growTrees`).
  const depthAt = woodDepth(W.cover, field.nx, field.nz, field.x0, field.z0, field.cell);
  let counts = { tufts: 0, trees: 0, farTrees: 0 };
  const lowBlock = (bx: number, bz: number) => {
    const x0 = bx * LOW, z0 = bz * LOW, sets = growLow(x0, z0, LOW, heightAt, growCover, W.plan.n % 997, season), meshes = cardsOf(sets);
    for (const m of meshes) scene.add(m);
    lows.set(`${bx},${bz}`, meshes);
    counts.tufts += sets.reduce((s, q) => s + q.matrices.length / 16, 0);
  };
  /** A block's trees grown whole (with the bramble, bushes and young trees of any wood's edge in it), or simply. */
  const treeBlock = (bx: number, bz: number, simply = false) => {
    const key = `${bx},${bz}`, x0 = bx * LOW, z0 = bz * LOW, trees = treesIn(x0, z0, LOW, treeCover, heightAt, W.plan.n, depthAt), out: (Mesh | InstancedMesh)[] = [];
    const level = simply ? 'simple' : 'whole';
    const { wood, sets, owners } = growTrees(trees, heightAt, season, simply, simply ? undefined : { x0, z0, size: LOW, coverAt: treeCover, depthAt, seed: W.plan.n });
    for (const [name, b] of wood) {
      if (!b.triangleCount) continue;
      // (Each point of wood says which tree it is, for the level it is drawn at: `aTree`.)
      const m = meshOf(b, materials[`${name}:${level}`], hour);
      m.geometry.setAttribute('aTree', new BufferAttribute(owners.get(name)!, 4));
      out.push(m);
    }
    out.push(...cardsOf(sets, level));
    // (Those grown simply are beyond the sun's shadows about the walker, and cast none.)
    for (const m of out) { if (simply) m.castShadow = false; scene.add(m); }
    if (!simply) { counts.trees += trees.length; nears.set(key, out); light.redraw(); } else mids.set(key, out);
    rising.set(`${level}:${key}`, { bi: bx, bj: bz, level, t0: performance.now() });
  };
  /** Blocks of trees just grown, coming in over `RISE` milliseconds (`treeGrownMap`); and one let go of, gone at once. */
  const RISE = 600, rising = new Map<string, { bi: number; bj: number; level: 'whole' | 'simple'; t0: number }>();
  const letGo = (bi: number, bj: number, level: 'whole' | 'simple') => { rising.delete(`${level}:${bi},${bj}`); grownMap.set(bi, bj, level, 0); };
  /** Painted trees in a square's ground: all of them, each drawn so only beyond where it is drawn simply (`treeShare`). Made once. */
  const farTreeBlock = (i: number, j: number) => {
    const [x0, z0] = squareOrigin(grid, i, j), key = `${i},${j}`, at = me.clone();
    const trees = treesIn(x0, z0, SQUARE.size, treeCover, heightAt, W.plan.n, depthAt);
    const meshes = cardsOf(farTrees(trees, heightAt, season), 'painted');
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
  const startAt = place(params.get('at') ?? (W.places.find((q) => q.kind === 'valley') ? 'valley1' : `${W.places[0]?.kind ?? 'valley'}1`));
  // The game's own body (`Player`): its pace, its weight, the steps it climbs and its jump, walking on the land as it is drawn and stopped
  // by the trunks of trees (`WorldColliders`: a patch of ground about it, made again as it goes). The first step of the world becoming
  // the game (`docs/06-world.md`, *The world as the game*); the walk had been a camera slid over the ground.
  let landVersion = 0;
  const colliders = new WorldColliders(heightAt, (x0, z0, x1) => treesIn(x0, z0, x1 - x0, treeCover, heightAt, W.plan.n, depthAt).map((t) => ({ x: t.x, z: t.z, r: Math.max(0.2, t.girth * 1.1) })));
  const player = new Player(camera, canvas, colliders);
  player.flySpeed = [40, 160];
  player.fallTo = -1e4;
  const EYE = 1.68, me = player.position;
  /** Puts the walker at a point, on the ground there (or, flying, so high over it). */
  const teleport = (x: number, z: number, yawTo = player.yaw, pitchTo = player.pitch, lift = player.flying ? 20 : EYE) => {
    colliders.follow(x, z, landVersion);
    player.place(new Vector3(x, Math.max(heightAt(x, z), player.flying ? 0 : -1e9) + lift, z), yawTo, pitchTo);
  };
  // Where the walker may be: within the world; within the way's corridor on the route page; not out in the sea, which stops one at the
  // depth of a knee (flying, over it, but not under the water); and never under the ground, where land that has come in finer than it
  // was walked on could leave one.
  let dryX = startAt.x, dryZ = startAt.z;
  player.constrain = (p) => {
    p.x = Math.max(-grid.hx, Math.min(grid.hx, p.x)); p.z = Math.max(-grid.hz, Math.min(grid.hz, p.z));
    if (route) route.keepIn(p);
    const ground = heightAt(p.x, p.z);
    if (player.flying) { p.y = Math.max(p.y, Math.max(ground, 0) + 0.3); return; }
    if (ground < -0.5) { p.x = dryX; p.z = dryZ; } else { dryX = p.x; dryZ = p.z; }
    // (The body's round foot stands at or over the ground on any slope; thirty centimetres under it, it has sunk.)
    const under = heightAt(p.x, p.z);
    if (p.y < under - 0.3) p.y = under;
  };
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
    const playAt = (spec: string) => {
      const m = spec.match(/^(valley|island|mountain|coast)(\d)$/);
      if (play) play.hidden = !m;
      if (play && m) play.href = `${game}#${new URLSearchParams({ world: seed, place: m[1] === 'coast' ? 'town' : m[1], n: m[2] })}`;
    };
    if (route) route.wire();
    else if (where) {
      const KIND: Record<string, string> = { island: 'island', valley: 'valley head', mountain: 'mountain top', coast: 'coastal town' };
      where.innerHTML = W.places.map((q) => `<option value="${q.kind}${q.n}">${q.name}, ${KIND[q.kind]}</option>`).join('');
      const start = params.get('at') ?? '';
      if (W.places.some((q) => `${q.kind}${q.n}` === start)) where.value = start;
      where.addEventListener('change', () => { const to = place(where.value); teleport(to.x, to.z); playAt(where.value); where.blur(); });
      playAt(where.value);
    } else playAt('');
  }
  let placeIndex = 0;
  if (params.has('fly')) player.fly(true);
  if (route) { const at = route.start(); dryX = at.x; dryZ = at.z; teleport(at.x, at.z, at.yaw, -0.05); } else teleport(startAt.x, startAt.z, 0, -0.05);
  const nextPlace = () => {
    // (On the route page there is only the way: no going on to other places.)
    if (!W.places.length || route) return;
    const q = W.places[placeIndex++ % W.places.length], menu = document.getElementById('where') as HTMLSelectElement | null;
    // (By the menu, where there is one, so that it and the link to the game follow.)
    if (menu) { menu.value = `${q.kind}${q.n}`; menu.dispatchEvent(new Event('change')); } else teleport(q.x, q.z);
  };
  // (Touch drives the same body: the stick its pace, dragging its look, the buttons its flying.)
  const touch = new WalkTouch(canvas, { look: (a, b) => player.look(a, b), next: nextPlace, fly: () => { player.fly(!player.flying); return player.flying; } });
  touch.flying(player.flying);
  // The box for ground at half a metre: what grows is grown again on the ground as it will now be.
  const setFine = (on: boolean) => {
    if (on === fineOn) return;
    fineOn = on;
    try { localStorage.setItem('walk.fine', on ? '1' : '0'); } catch { /* (not kept: a private window, or a page shown inside another) */ }
    for (const meshes of [...lows.values(), ...nears.values(), ...mids.values()]) drop(meshes);
    for (const f of fars.values()) drop(f.meshes);
    lows.clear(); nears.clear(); mids.clear(); fars.clear(); rising.clear(); grownMap.clear();
    counts = { tufts: 0, trees: 0, farTrees: 0 };
  };
  {
    const box = document.getElementById('fine') as HTMLInputElement | null;
    if (box) { box.checked = fineOn; box.addEventListener('change', () => { setFine(box.checked); box.blur(); }); }
  }
  const wireframe = (on: boolean) => { for (const k of ['turf', 'rock']) (materials[k] as MeshStandardNodeMaterial).wireframe = on; };
  // (Walking, running, jumping and flying, `V`, are the body's own keys; these are the page's.)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // (On the route page M is the ink map, and T the triangles.)
    if (e.code === (route ? 'KeyT' : 'KeyM') && !e.repeat) wireframe(!(materials.turf as MeshStandardNodeMaterial).wireframe);
    if (route && e.code === 'KeyM' && !e.repeat) route.toggleInk();
    if (route && e.code === 'Escape') route.toggleInk(false);
    // (Numbers for valley heads, with Shift for islands; P for the next place of any kind. Ctrl with a number changes the browser's tab.)
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit && !e.ctrlKey && !e.metaKey && !e.altKey && !route) {
      const spec = `${e.shiftKey ? 'island' : 'valley'}${digit[1]}`, menu = document.getElementById('where') as HTMLSelectElement | null;
      if (menu && W.places.some((q) => `${q.kind}${q.n}` === spec)) { menu.value = spec; menu.dispatchEvent(new Event('change')); } else { const to = place(spec); teleport(to.x, to.z); }
      e.preventDefault();
    }
    if (e.code === 'KeyP' && !e.repeat) nextPlace();
  });

  // ---- the loop
  const frames: number[] = [];
  let last = performance.now(), rebuilt = 0, shown = 0, tick = 0, metering = false, exposure = -1, exposureTarget = 0.5, layingAhead = false;
  const begun = last;
  /** The squares within reach of where one stands. */
  function* squaresWanted(): Generator<string> {
    const ci = Math.floor((me.x + grid.hx) / SQUARE.size), cj = Math.floor((me.z + grid.hz) / SQUARE.size), r = Math.ceil(NEAR / SQUARE.size) + 1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < SX && j < SZ && distTo(i, j) < NEAR && (!route || route.wantsSquare(i, j))) yield `${i},${j}`;
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
    return { frameMs: ms, squares: squares.size, pending: pending.size, tiles: tiles.size, squareTriangles: tris + fineTriangles, fineOn, fine, finePending: finePending.size, fineTriangles, fineMsMiddle: fineSorted[Math.floor(fineSorted.length / 2)] ?? 0, drawnTriangles: renderer.info.render.triangles, levels, squareMsMiddle: sorted[Math.floor(sorted.length / 2)] ?? 0, worldMs, rebuilt, x: me.x, z: me.z, y: camera.position.y, yaw: player.yaw, pitch: player.pitch, flying: player.flying, grounded: player.grounded, patches: colliders.made, patchMs: colliders.lastMs, lowBlocks: lows.size, treeBlocks: nears.size, midBlocks: mids.size, farTreeCards: farCount, ...counts };
  };
  const wantedLow = () => blocksNear(GRASS).filter(([i, j]) => squaresUnder(i * LOW, j * LOW, LOW));
  /** How far the furthest corner of a block lies from where one stands, on the level. */
  const blockFar = (i: number, j: number) => Math.hypot(Math.max(Math.abs(i * LOW - me.x), Math.abs((i + 1) * LOW - me.x)), Math.max(Math.abs(j * LOW - me.z), Math.abs((j + 1) * LOW - me.z)));
  const wantedTrees = () => blocksNear(WHOLE).filter(([i, j]) => squaresUnder(i * LOW, j * LOW, LOW));
  const wantedMids = () => blocksNear(MID).filter(([i, j]) => blockFar(i, j) > SIMPLE_FROM && squaresUnder(i * LOW, j * LOW, LOW));
  /** The squares that want painted trees, and have none yet. */
  const paintedMissing = () => {
    const out: [number, number][] = [], ci = Math.floor((me.x + grid.hx) / SQUARE.size), cj = Math.floor((me.z + grid.hz) / SQUARE.size), r = Math.ceil(FAR_TREES / SQUARE.size);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < SX && j < SZ && distTo(i, j) <= FAR_TREES && !fars.has(`${i},${j}`)) out.push([i, j]);
    // (Nearest first: they stand in for nearer ways not yet grown, so the near ones are wanted first. Made in the order of the map,
    // from its north-west corner, the woods about the walker were bare ground for as long as the far squares took.)
    return out.sort((a, b) => distTo(a[0], a[1]) - distTo(b[0], b[1]));
  };
  (window as unknown as { __walk: unknown }).__walk = {
    stats, wireframe,
    /** On the route page: opens or closes the ink map of the stretch. */
    ink: (open?: boolean) => route?.toggleInk(open),
    /** On the route page: how far along the way, its length, whether arrived, and how the places ahead are being laid out. */
    route: () => (route ? { s: route.s, length: route.length, off: route.off, arrived: route.arrived, ahead: route.ahead, ready: [...route.ready], squares: route.squaresInReach, from: route.from, to: route.to, way: route.way } : null),
    /** Ground at half a metre near the walker, or not. */
    fine: (on: boolean) => { setFine(on); const box = document.getElementById('fine') as HTMLInputElement | null; if (box) box.checked = on; },
    /** Goes to a place by its kind and number: `valley1`, `island2`, `mountain3`. */
    to: (spec: string) => { const p = place(spec); teleport(p.x, p.z); },
    /** Puts the walker at `x`, `z`, the eye `y` over the ground there (as tall as one stands, unless given), facing `yaw` and looking `pitch`, flying or not. */
    goto: (x: number, z: number, y?: number, yawTo?: number, pitchTo?: number, fly?: boolean) => {
      if (fly !== undefined && fly !== player.flying) { player.fly(fly); touch.flying(fly); }
      teleport(x, z, yawTo ?? player.yaw, pitchTo ?? player.pitch, y ?? (player.flying ? 20 : EYE));
    },
    /** What is not yet in, of what `settled` waits for (for scripts that find it waiting). */
    unsettled: () => ({ pending: pending.size, finePending: finePending.size, squares: [...squaresWanted()].filter((k) => { const q = squares.get(k); return !(q && (q.fineWanted ? q.fineShown : !!q.meshes)); }).length, grass: wantedLow().filter(([i, j]) => !lows.has(`${i},${j}`)).length, trees: wantedTrees().filter(([i, j]) => !nears.has(`${i},${j}`)).length, simpler: wantedMids().filter(([i, j]) => !mids.has(`${i},${j}`)).length, painted: paintedMissing().length, far: farDirty.size }),
    settled: () => pending.size === 0 && finePending.size === 0 && [...squaresWanted()].every((k) => { const s = squares.get(k); return s && (s.fineWanted ? s.fineShown : !!s.meshes); }) && wantedLow().every(([i, j]) => lows.has(`${i},${j}`)) && wantedTrees().every(([i, j]) => nears.has(`${i},${j}`)) && wantedMids().every(([i, j]) => mids.has(`${i},${j}`)) && paintedMissing().length === 0 && farDirty.size === 0,
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; frames.push(dt * 1000); if (frames.length > 90) frames.shift();
    // Moving: the game's body, on the ground about it (made again as it goes), or flying; where it may be is `player.constrain`.
    player.analog.set(touch.move.x, touch.move.y); player.analogRun = touch.move.run; player.analogRise = touch.move.rise;
    // (Not while flying: at a hundred and sixty metres a second the patch would be made again several times a second for nothing.
    // Coming down, `constrain` stands the body on the ground, and the next frame makes the patch there.)
    if (!player.flying) colliders.follow(me.x, me.z, landVersion);
    player.update(dt);
    if (touch.shownFlying !== player.flying) touch.flying(player.flying);
    // (The two places laid out for the game ahead, once the squares about the start are in, or after twenty seconds: not before, so
    // that the worker that does it, making the world again, does not slow the first squares.)
    if (route && !layingAhead && (now - begun > 20000 || (squares.size >= 6 && pending.size === 0))) { layingAhead = true; void route.layOutAhead(); }
    const groundY = heightAt(me.x, me.z);
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
          if (colliders.covers(sq.x0, sq.z0, sq.x0 + SQUARE.size, sq.z0 + SQUARE.size)) landVersion++;
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
      if (sq.fine) { for (const p of sq.fine) drop(p.meshes ?? []); if (sq.fineShown && colliders.covers(sq.x0, sq.z0, sq.x0 + SQUARE.size, sq.z0 + SQUARE.size)) landVersion++; sq.fine = null; sq.fineShown = false; }
    }
    // The far land: a block or two a frame, where squares have come or gone; and the air's maps of it, once it is all in.
    let farBudget = 2;
    for (const key of farDirty) { if (farBudget-- <= 0) break; farDirty.delete(key); buildFar(key); }
    if (!landDrawn && farDirty.size === 0) { landDrawn = true; light.land([...farMeshes.values()].flat(), new Vector3(-grid.hx, -150, -grid.hz), new Vector3(grid.hx, 900, grid.hz)); }
    // What grows: a block of grass and one of trees a frame, nearest first; painted trees a square or two; what is far let go.
    for (const [i, j] of wantedLow()) if (!lows.has(`${i},${j}`)) { lowBlock(i, j); break; }
    for (const [i, j] of wantedTrees()) if (!nears.has(`${i},${j}`)) { treeBlock(i, j); break; }
    {
      let midBudget = 2;
      for (const [i, j] of wantedMids()) if (!mids.has(`${i},${j}`)) { treeBlock(i, j, true); if (--midBudget <= 0) break; }
    }
    for (const [k, meshes] of lows) { const [i, j] = k.split(',').map(Number); if (Math.hypot((i + 0.5) * LOW - me.x, (j + 0.5) * LOW - me.z) > GRASS + 60) { drop(meshes); lows.delete(k); } }
    // Trees: each level let go of well past where it is drawn, and, while kept, not drawn at all where every tree in the block is
    // drawn the other way (the shader would draw it into nothing, at the cost of its points).
    const blockNear = (i: number, j: number) => Math.hypot(Math.max(0, i * LOW - me.x, me.x - (i + 1) * LOW), Math.max(0, j * LOW - me.z, me.z - (j + 1) * LOW));
    for (const [k, meshes] of nears) {
      const [i, j] = k.split(',').map(Number), d = blockNear(i, j);
      if (d > WHOLE + 40) { drop(meshes); nears.delete(k); letGo(i, j, 'whole'); continue; }
      for (const m of meshes) m.visible = d < WHOLE - BEYOND;
    }
    for (const [k, meshes] of mids) {
      const [i, j] = k.split(',').map(Number), d = blockNear(i, j), far = blockFar(i, j);
      if (d > MID + 50 || far < SIMPLE_FROM - 20) { drop(meshes); mids.delete(k); letGo(i, j, 'simple'); continue; }
      for (const m of meshes) m.visible = far > SIMPLE_FROM + BEYOND && d < MID - BEYOND;
    }
    {
      let farTreeBudget = 2;
      for (const [i, j] of paintedMissing()) { farTreeBlock(i, j); if (--farTreeBudget <= 0) break; }
      // (Painted trees are drawn however near, where no nearer way is grown yet: see `treeGrownMap`.)
      for (const [k, f] of fars) { const [i, j] = k.split(',').map(Number); if (distTo(i, j) > FAR_TREES + 300) { drop(f.meshes); fars.delete(k); } }
    }
    // Blocks of trees just grown come in, and the shader is told.
    for (const [k, r] of rising) { const t = (now - r.t0) / RISE; grownMap.set(r.bi, r.bj, r.level, t); if (t >= 1) rising.delete(k); }
    grownMap.flush();
    vegetationUniforms.uTime.value = now / 1000;
    const cards = [...[...lows.values()].flat(), ...[...nears.values(), ...mids.values()].flat().filter((m): m is InstancedMesh => (m as InstancedMesh).isInstancedMesh)];
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
      if (route) { route.drawMap(me, player.yaw); route.markArrival(); route.drawInkWalker(me, player.yaw); }
      hud.textContent = (route ? `${route.lines().join('\n')}\n\n` : '') + `${W.name}: world made in ${(worldMs / 1000).toFixed(0)} s · ${hour}, ${season}\n` +
        `frame ${st.frameMs.toFixed(1)} ms · drawn ${st.drawnTriangles.toLocaleString()} triangles\n` +
        `squares ${st.squares} (${st.pending} coming), ${st.squareTriangles.toLocaleString()} triangles; a square ${st.squareMsMiddle.toFixed(0)} ms in a worker (${cores} at work)\n` +
        (fineOn ? `at half a metre ${st.fine} (${st.finePending} coming), ${st.fineTriangles.toLocaleString()} triangles; four ${st.fineMsMiddle.toFixed(0)} ms\n` : '') +
        `grass in ${st.lowBlocks} blocks · ${st.treeBlocks} blocks of whole trees, ${st.midBlocks} of simpler · ${st.farTreeCards.toLocaleString()} painted trees\n` +
        `at ${me.x.toFixed(0)}, ${me.z.toFixed(0)}, ground ${groundY.toFixed(1)} m${player.flying ? ', flying' : ''}`;
    }
  };
  renderer.setAnimationLoop((now: number) => { try { frame(now); } catch (e) { hud.textContent = `Fault: ${(e as Error).message}`; console.error(e); } });
}

start().catch((e) => { hud.textContent = `Could not start: ${(e as Error).message}`; console.error(e); });
