import { BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, HemisphereLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { valueNoise2 } from '../core/rng';
import { SQUARE, squareCount, squareOrigin, TileData, TileGrid, tilesFor } from '../core/stream';
import { HeightField } from '../core/terrain';
import { COVER, WorldPlace } from '../core/world';
import { squareMesh } from '../render/streamMesh';

/**
 * A walk over a world's land at a metre, streamed in (`docs/06-world.md`, step 2): to try the
 * streaming and the meshing by detail and distance, not yet the game. The world is made in a
 * worker; squares of 256 metres are made in a few more, nearest first, as one walks; each is meshed
 * true to within a distance that grows with how far off it lies, and meshed again as one comes
 * nearer or goes away; beyond them the world's own lattice of 8 metres, with holes where squares lie.
 *
 * `?world=<seed>`, `?size=6x10`, `?at=valley1` (or `island2`, `mountain3`, or `x,z`); `?radius=` how
 * far squares are made (700 metres unless asked); `?webgl` as in the game.
 */

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const NEAR = Number(params.get('radius')) || 700, DROP = NEAR + 300;
/** The distances a square may be meshed to, finest first: one is chosen by how far off it lies. */
const LEVELS = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];
const levelFor = (d: number) => { const want = Math.max(0.02, d * 0.0016); const k = LEVELS.findIndex((e) => e >= want); return k < 0 ? LEVELS.length - 1 : k; };

interface WorldData { plan: { seed: string; n: number; hx: number; hz: number }; name: string; places: WorldPlace[]; field: HeightField; cover: Uint8Array; sea: Uint8Array; grid: TileGrid }
interface Sq { i: number; j: number; x0: number; z0: number; heights: Float32Array; errors: Float32Array; mesh: Mesh | null; level: number; triangles: number }

const SKY = new Color(0x9ab6cf);
const COLOUR: Record<number, [number, number, number]> = {
  [COVER.sea]: [0.45, 0.43, 0.36], [COVER.lake]: [0.4, 0.42, 0.36], [COVER.shore]: [0.72, 0.66, 0.5], [COVER.marsh]: [0.42, 0.47, 0.33],
  [COVER.fields]: [0.62, 0.6, 0.36], [COVER.pasture]: [0.42, 0.55, 0.27], [COVER.forest]: [0.2, 0.33, 0.17], [COVER.moor]: [0.47, 0.41, 0.32],
  [COVER.rock]: [0.5, 0.49, 0.47], [COVER.snow]: [0.93, 0.94, 0.96],
};
const lin = (c: number) => Math.pow(c, 2.2);

async function start(): Promise<void> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL: params.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, Number(params.get('dpr')) || 2));
  renderer.setSize(innerWidth, innerHeight);
  const scene = new Scene(), camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 9000);
  scene.background = SKY; scene.fog = new Fog(SKY, 1500, 8000);
  const sun = new DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(-0.5, 0.75, 0.43);
  scene.add(sun, new HemisphereLight(0xbcd2e8, 0x5a5040, 0.9));
  const ground = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const water = new MeshStandardNodeMaterial({ color: 0x2f4f66, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.86 });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ---- the world, from its worker
  const seed = params.get('world') || 'w2', sz = (params.get('size') ?? '').split('x').map(Number);
  const size = sz.length === 2 && sz.every((v) => v >= 2 && v <= 20) ? { x: sz[0] * 1000, z: sz[1] * 1000 } : undefined;
  const worldWorker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  const W: WorldData = await new Promise((resolve) => {
    worldWorker.onmessage = (e) => {
      if (e.data.type === 'progress') { hud.textContent = `${e.data.text}…`; return; }
      const d = e.data.world, f = new HeightField(d.field.x0, d.field.z0, d.field.cell, d.field.nx, d.field.nz);
      f.data.set(d.field.data);
      resolve({ ...d, field: f });
    };
    worldWorker.postMessage({ type: 'world', seed, size });
  });
  const worldMs = performance.now() - t0, { field, grid } = W, [SX, SZ] = squareCount(grid);
  // (The houses' grounds, fitted to the land: made on it in every square they reach.)
  const grounds = W.places.flatMap((q) => (q.ground ? [q.ground] : []));
  const coverAt = (x: number, z: number) => W.cover[Math.min(field.nz - 1, Math.max(0, Math.round((z - field.z0) / field.cell))) * field.nx + Math.min(field.nx - 1, Math.max(0, Math.round((x - field.x0) / field.cell)))];
  /** The ground's colour: what lies there, by the world's lattice; rock where it is steep; sand at the water's edge; and a little unevenness. */
  const colourAt = (x: number, z: number, y: number, slope: number): [number, number, number] => {
    let c = COLOUR[coverAt(x, z)];
    if (y < 1.2) c = COLOUR[COVER.shore];
    const rock = Math.min(1, Math.max(0, (slope - 0.65) / 0.35)), v = 0.88 + 0.24 * valueNoise2(x * 0.13, z * 0.13, 5);
    return [lin((c[0] + (0.5 - c[0]) * rock) * v), lin((c[1] + (0.49 - c[1]) * rock) * v), lin((c[2] + (0.47 - c[2]) * rock) * v)];
  };
  // The sea: one sheet at its level, out beyond the world's edge.
  const sea = new Mesh(new PlaneGeometry(grid.hx * 2 + 20000, grid.hz * 2 + 20000), water);
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);

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
  for (const p of pool) p.w.onmessage = (e) => {
    const m = e.data, key = `${m.i},${m.j}`;
    p.busy = false; pending.delete(key); squareMs.push(m.ms);
    squares.set(key, { i: m.i, j: m.j, x0: m.x0, z0: m.z0, heights: m.heights, errors: m.errors, mesh: null, level: -1, triangles: 0 });
    farDirty.add(blockOf(m.i, m.j));
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

  // ---- the far land: the world's own lattice, in blocks of four squares by four, read every 32 metres, with holes where squares lie
  const BLOCK = 4, FAR = 32, farMeshes = new Map<string, Mesh>(), farDirty = new Set<string>();
  const blockOf = (i: number, j: number) => `${Math.floor(i / BLOCK)},${Math.floor(j / BLOCK)}`;
  for (let bj = 0; bj < Math.ceil(SZ / BLOCK); bj++) for (let bi = 0; bi < Math.ceil(SX / BLOCK); bi++) farDirty.add(`${bi},${bj}`);
  const buildFar = (key: string) => {
    const [bi, bj] = key.split(',').map(Number), pos: number[] = [], nrm: number[] = [], col: number[] = [], index: number[] = [], per = SQUARE.size / FAR + 1;
    for (let j = bj * BLOCK; j < Math.min(SZ, (bj + 1) * BLOCK); j++) for (let i = bi * BLOCK; i < Math.min(SX, (bi + 1) * BLOCK); i++) {
      if (squares.get(`${i},${j}`)?.mesh) continue;
      const [x0, z0] = squareOrigin(grid, i, j), base = pos.length / 3;
      for (let b = 0; b < per; b++) for (let a = 0; a < per; a++) {
        const x = x0 + a * FAR, z = z0 + b * FAR, y = field.smoothAt(x, z), gx = (field.smoothAt(x + 8, z) - field.smoothAt(x - 8, z)) / 16, gz = (field.smoothAt(x, z + 8) - field.smoothAt(x, z - 8)) / 16, l = Math.hypot(gx, 1, gz);
        // (A metre low, so that where a square lies beside it the square's own ground is what shows.)
        pos.push(x, y - 1, z); nrm.push(-gx / l, 1 / l, -gz / l); col.push(...colourAt(x, z, y, Math.hypot(gx, gz)));
      }
      for (let b = 0; b < per - 1; b++) for (let a = 0; a < per - 1; a++) { const k = base + b * per + a; index.push(k, k + per, k + 1, k + 1, k + per, k + per + 1); }
    }
    const old = farMeshes.get(key);
    if (old) { scene.remove(old); old.geometry.dispose(); farMeshes.delete(key); }
    if (!index.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3)); g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(index); g.computeBoundingSphere();
    const m = new Mesh(g, ground);
    scene.add(m); farMeshes.set(key, m);
  };

  // ---- where one stands, and walking
  /** The height of the ground at a point: from its square, where there is one, else from the world's lattice. */
  const heightAt = (x: number, z: number): number => {
    const i = Math.floor((x + grid.hx) / SQUARE.size), j = Math.floor((z + grid.hz) / SQUARE.size), s = squares.get(`${i},${j}`);
    if (!s) return field.smoothAt(x, z);
    const fx = Math.min(SQUARE.n - 1.001, Math.max(0, x - s.x0)), fz = Math.min(SQUARE.n - 1.001, Math.max(0, z - s.z0)), a = Math.floor(fx), b = Math.floor(fz), tx = fx - a, tz = fz - b, n = SQUARE.n, h = s.heights;
    return h[b * n + a] * (1 - tx) * (1 - tz) + h[b * n + a + 1] * tx * (1 - tz) + h[(b + 1) * n + a] * (1 - tx) * tz + h[(b + 1) * n + a + 1] * tx * tz;
  };
  const place = (spec: string): Vector3 => {
    const m = spec.match(/^(valley|island|mountain)(\d)$/), q = m ? W.places.find((p) => p.kind === m[1] && p.n === Number(m[2])) : undefined;
    if (q) return new Vector3(q.x, 0, q.z);
    const xz = spec.split(',').map(Number);
    return xz.length === 2 && xz.every(Number.isFinite) ? new Vector3(xz[0], 0, xz[1]) : new Vector3(W.places[0]?.x ?? 0, 0, W.places[0]?.z ?? 0);
  };
  const me = place(params.get('at') ?? 'valley1');
  let yaw = 0, pitch = -0.05, flying = params.has('fly'), lift = 1.7;
  const keys = new Set<string>();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === 'KeyV' && !e.repeat) { flying = !flying; lift = flying ? Math.max(lift, 20) : 1.7; }
    if (e.code === 'KeyM' && !e.repeat) ground.wireframe = !ground.wireframe;
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit) { const kind = e.ctrlKey ? 'mountain' : e.shiftKey ? 'island' : 'valley', to = place(`${kind}${digit[1]}`); me.set(to.x, 0, to.z); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code));
  canvas.addEventListener('click', () => canvas.requestPointerLock());
  window.addEventListener('mousemove', (e: MouseEvent) => { if (document.pointerLockElement !== canvas) return; yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022)); });

  // ---- the loop
  const frames: number[] = [];
  let last = performance.now(), rebuilt = 0, shown = 0;
  const stats = () => {
    let tris = 0, levels = LEVELS.map(() => 0);
    for (const s of squares.values()) if (s.mesh) { tris += s.triangles; levels[s.level]++; }
    const ms = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0, sorted = [...squareMs].sort((a, b) => a - b);
    return { frameMs: ms, squares: squares.size, pending: pending.size, tiles: tiles.size, squareTriangles: tris, drawnTriangles: renderer.info.render.triangles, levels, squareMsMiddle: sorted[Math.floor(sorted.length / 2)] ?? 0, worldMs, rebuilt, x: me.x, z: me.z };
  };
  (window as unknown as { __walk: unknown }).__walk = { stats, goto: (x: number, z: number, y?: number, yawTo?: number, pitchTo?: number, fly?: boolean) => { me.set(x, 0, z); if (yawTo !== undefined) yaw = yawTo; if (pitchTo !== undefined) pitch = pitchTo; if (fly !== undefined) flying = fly; if (y !== undefined) lift = y; }, settled: () => pending.size === 0 && [...squaresWanted()].every((k) => squares.get(k)?.mesh), wireframe: (on: boolean) => { ground.wireframe = on; },
    probe: () => { const i = Math.floor((me.x + grid.hx) / SQUARE.size), j = Math.floor((me.z + grid.hz) / SQUARE.size), s = squares.get(`${i},${j}`); const box = s?.mesh?.geometry.boundingSphere; return { i, j, has: !!s, level: s?.level, x0: s?.x0, z0: s?.z0, h: heightAt(me.x, me.z), field: field.smoothAt(me.x, me.z), sphere: box ? [box.center.x, box.center.y, box.center.z, box.radius] : null, far: farMeshes.size, farDirty: farDirty.size }; } };
  /** The squares within reach of where one stands. */
  function* squaresWanted(): Generator<string> {
    const ci = Math.floor((me.x + grid.hx) / SQUARE.size), cj = Math.floor((me.z + grid.hz) / SQUARE.size), r = Math.ceil(NEAR / SQUARE.size) + 1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= 0 && j >= 0 && i < SX && j < SZ && distTo(i, j) < NEAR) yield `${i},${j}`;
  }
  /** How far a square's nearest point lies from where one stands, on the level. */
  const distTo = (i: number, j: number) => { const [x0, z0] = squareOrigin(grid, i, j); return Math.hypot(Math.max(0, x0 - me.x, me.x - x0 - SQUARE.size), Math.max(0, z0 - me.z, me.z - z0 - SQUARE.size)); };
  const tick = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now; frames.push(dt * 1000); if (frames.length > 90) frames.shift();
    // Moving: along the ground, or flying where one looks.
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight'), speed = flying ? (run ? 160 : 40) : run ? 12 : 4.5;
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    me.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt; me.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt;
    me.x = Math.max(-grid.hx, Math.min(grid.hx, me.x)); me.z = Math.max(-grid.hz, Math.min(grid.hz, me.z));
    if (flying) lift = Math.max(1.7, lift + ((keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0)) * speed * dt);
    const groundY = heightAt(me.x, me.z);
    camera.position.set(me.x, Math.max(groundY, 0) + lift, me.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    // Streaming: ask for what is near and missing, nearest first; let go of what is far.
    const wanted = [...squaresWanted()].map((k) => { const [i, j] = k.split(',').map(Number); return { k, i, j, d: distTo(i, j) }; }).sort((a, b) => a.d - b.d);
    for (const q of wanted) if (!squares.has(q.k) && !pending.has(q.k)) void request(q.i, q.j);
    for (const [k, sq] of squares) if (distTo(sq.i, sq.j) > DROP) { if (sq.mesh) { scene.remove(sq.mesh); sq.mesh.geometry.dispose(); } squares.delete(k); farDirty.add(blockOf(sq.i, sq.j)); }
    // Meshing: each square to the distance its own distance calls for; a few a frame, nearest first, so no frame waits long.
    let budget = 3;
    for (const q of wanted) {
      const sq = squares.get(q.k);
      if (!sq || budget <= 0) continue;
      const level = levelFor(q.d);
      if (level === sq.level) continue;
      const m = squareMesh(sq.x0, sq.z0, sq.heights, sq.errors, LEVELS[level], colourAt);
      if (sq.mesh) { scene.remove(sq.mesh); sq.mesh.geometry.dispose(); } else farDirty.add(blockOf(sq.i, sq.j));
      sq.mesh = new Mesh(m.geometry, ground); sq.level = level; sq.triangles = m.triangles; scene.add(sq.mesh);
      budget--; rebuilt++;
    }
    // The far land: a block or two a frame, where squares have come or gone.
    let farBudget = 2;
    for (const key of farDirty) { if (farBudget-- <= 0) break; farDirty.delete(key); buildFar(key); }
    renderer.render(scene, camera);
    if (now - shown > 250) {
      shown = now;
      const st = stats();
      hud.textContent = `${W.name}: world made in ${(worldMs / 1000).toFixed(0)} s\n` +
        `frame ${st.frameMs.toFixed(1)} ms · drawn ${st.drawnTriangles.toLocaleString()} triangles\n` +
        `squares ${st.squares} (${st.pending} coming), ${st.squareTriangles.toLocaleString()} triangles; a square ${st.squareMsMiddle.toFixed(0)} ms in a worker (${cores} at work)\n` +
        `meshed to ${LEVELS.map((e, k) => `${e * 100} cm: ${st.levels[k]}`).join(', ')}\n` +
        `at ${me.x.toFixed(0)}, ${me.z.toFixed(0)}, ground ${groundY.toFixed(1)} m${flying ? ', flying' : ''}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

start().catch((e) => { hud.textContent = `Could not start: ${(e as Error).message}`; });
