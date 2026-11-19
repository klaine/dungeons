// The building lab: buildings of the town's two styles made by the game's own generator and shown plainly, lit by a sun and a sky,
// for judging their shapes without building a whole place. Open /lab/buildingRows.html on the dev server. The address chooses:
// `?style=imperial|timber`, `bays`, `storeys`, `heights=4.8,3.3,3.3`, `wings=0|1|2`, `towers=0|1|2|3`, `extra` (storeys of the towers),
// `pediment=0`, `arch=-1|1` (a carriage way at that end), `entrances=3,9` (the bays of its doors), `brick=stucco|bare` (in the row, every
// other building), and `seed`; (brick is drawn here in a plain brown, without the game's texture); with none, a row of classical buildings is dealt their variations as the town deals them. `turn` turns them all, in degrees.
// `?style=canal` shows canal houses: a row along a canal, and a second row facing it across the water (`rows=1` for one), each house
// dealt as a town deals them, or with any of its choices fixed from the address: `gable=spout|stepped|neck|bell|cornice|raised|all` (all:
// a house of each in turn), `crown=triangle|segment|scroll|flat`, `tiers`, `bays`, `storeys`, `w`, `d`, `ornament=0..3`,
// `windows=cross|small|large`, `front=brick|painted`, `kind=house|warehouse`, `stoop` (metres), `basement=0|1`, `lean` (per metre),
// `pui=0|1`, `hoist=0|1`, `door` (its bay), `clay=red|buff`; `n` houses to a row. `?style=brick` shows a row of Hanseatic houses
// dealt as a valley's town deals them (`kind=gabled|eaves|store`, `deep`). Canal and brick houses are planned within and built so,
// unless `shut=1`; `cut=<height>` cuts away everything above that height, to look down into a storey (and `cam` to look from over it).
import { AmbientLight, BufferGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Plane, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBuilding } from '../src/render/buildings';
import { buildingPlans } from '../src/maps/buildingPlan';
import { MeshBuilder } from '../src/render/geom/meshBuilder';
import { classicalVariations, planClassical, planTimber } from '../src/core/building';
import { Rng } from '../src/core/rng';
import { CanalWant, dealCanalHouse, planCanal } from '../src/core/canal';
import { dealBrickHouse, planBrick } from '../src/core/brick';
import type { Building } from '../src/core/site';

const q = new URLSearchParams(location.search), num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0.62, 0.72, 0.82);
scene.add(new HemisphereLight(0xc8dcf0, 0x6a5a48, 1.2), new AmbientLight(0xffffff, 0.15));
const sun = new DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-60, 90, 70); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 400 });
scene.add(sun);
const ground = new Mesh(new PlaneGeometry(600, 600), new MeshStandardMaterial({ color: 0x8a8670, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const q0 = new URLSearchParams(location.search), cut = q0.has('cut') ? [new Plane(new Vector3(0, -1, 0), Number(q0.get('cut')))] : [];
renderer.localClippingEnabled = cut.length > 0;
const looks: Record<string, { roughness: number; metalness?: number; color?: number; clear?: boolean }> = { pane: { roughness: 0.05, color: 0x8fa0a6, clear: true }, paneLit: { roughness: 0.05, color: 0x8fa0a6, clear: true }, glass: { roughness: 0.15, metalness: 0.4 }, window: { roughness: 0.3 }, metal: { roughness: 0.45, metalness: 0.3 }, brick: { roughness: 0.9, color: 0x6e4430 }, redBrick: { roughness: 0.9, color: 0x8a4434 }, buffBrick: { roughness: 0.9, color: 0xc49a62 } };
/** Builds a building at the origin facing -x (its own way), and lays it in the scene turned to face `turn` at (`x`, `z`). */
function show(b: Building, x: number, z: number, turn: number, rng: Rng) {
  const meshes = new Map<string, MeshBuilder>();
  buildBuilding({ ...b, x: 0, z: 0, faces: 'w' }, 0, (m) => { if (!meshes.has(m)) meshes.set(m, new MeshBuilder()); return meshes.get(m)!; }, rng, [0.8, 0.78, 0.72], false);
  for (const [name, m] of meshes) {
    const g: BufferGeometry = m.build();
    const look = looks[name], clear = !!look?.clear;
    const mesh = new Mesh(g, new MeshStandardMaterial({ vertexColors: !clear, roughness: look?.roughness ?? 0.85, metalness: look?.metalness ?? 0, color: look?.color ?? 0xffffff, transparent: clear, opacity: clear ? 0.18 : 1, depthWrite: !clear, clippingPlanes: cut, clipShadows: true }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.rotation.y = -(turn - Math.PI); mesh.position.set(x, 0, z);
    scene.add(mesh);
  }
}

/** Builds a building with the middle of its front at (`fx`, `fz`), facing `turn`; and keeps where it stands, for `inside`. */
const fronts: { b: Building; fx: number; fz: number; turn: number }[] = [];
function front(b: Building, fx: number, fz: number, turn: number, rng: Rng) {
  show(b, fx - (b.d / 2) * Math.cos(turn), fz - (b.d / 2) * Math.sin(turn), turn, rng);
  fronts.push({ b, fx, fz, turn });
}
const style = q.get('style') ?? 'imperial', seed = q.get('seed') ?? 'lab', turn = (num('turn', 90) * Math.PI) / 180;
const made: string[] = [];
const classical = (r: Rng, bays: number, storeys: number): Building => {
  const heights = [3.8, 4.4, ...Array.from({ length: storeys - 2 }, () => 3.2)].slice(0, storeys);
  return { style: 'imperial', x: 0, z: 0, w: bays * 2.55 + 1.6, d: 10.6, faces: 'w', storeys, heights, bays, colour: r.pick([[0.9, 0.76, 0.42], [0.86, 0.62, 0.56], [0.62, 0.74, 0.62], [0.6, 0.68, 0.78]] as [number, number, number][]), portico: bays >= 7 || bays === 5 };
};
if (style === 'canal') {
  // Canal houses, wall against wall along a quay; across the water, another row facing them.
  const want: CanalWant = {};
  const word = <K extends keyof CanalWant>(key: K) => { if (q.has(key)) (want as Record<string, unknown>)[key] = q.get(key); };
  const count = <K extends keyof CanalWant>(key: K) => { if (q.has(key)) (want as Record<string, unknown>)[key] = Number(q.get(key)); };
  (['crown', 'windows', 'front', 'kind', 'clay'] as const).forEach(word);
  (['tiers', 'bays', 'storeys', 'w', 'd', 'ornament', 'stoop', 'lean', 'door'] as const).forEach(count);
  if (q.has('basement')) want.basement = q.get('basement') === '1';
  if (q.has('hoist')) want.hoist = q.get('hoist') === '1';
  if (q.get('pui') === '0') want.pui = null;
  const gables = ['spout', 'stepped', 'neck', 'bell', 'cornice', 'raised'] as const, all = q.get('gable') === 'all';
  if (q.has('gable') && !all) want.gable = q.get('gable') as CanalWant['gable'];
  const n = num('n', all ? 6 : 10), canal = 16, quay = 5;
  const water = new Mesh(new PlaneGeometry(240, canal), new MeshStandardMaterial({ color: 0x2c4248, roughness: 0.15, metalness: 0.2 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.03, quay + canal / 2); scene.add(water);
  for (let row = 0; row < (num('rows', 2) === 1 ? 1 : 2); row++) {
    const facing = row ? -Math.PI / 2 : Math.PI / 2, z = row ? 2 * quay + canal : 0, dir = row ? -1 : 1;
    const houses: Building[] = [];
    for (let k = 0; k < n; k++) {
      const r = new Rng(`${seed}/${row}/${k}`), w: CanalWant = { ...want, ...(all ? { gable: gables[k % 6] } : {}) };
      if (q.get('pui') === '1') w.pui = [0.1, 0.2, 0.13];
      const deal = dealCanalHouse(r, { want: w });
      if (!deal) continue;
      const b: Building = { ...deal, x: 0, z: 0, faces: 'w' }, plan = q.get('shut') === '1' ? null : planCanal(b);
      if (plan) b.plan = plan;
      houses.push(b);
    }
    const length = houses.reduce((sum, b) => sum + b.w, 0);
    let s = -length / 2;
    for (const [k, b] of houses.entries()) {
      front(b, dir * (s + b.w / 2), z, facing, new Rng(`${seed}/${row}/${k}/build`));
      s += b.w;
      const c = b.canalwork!;
      if (!row) made.push(`${k}: ${b.plan ? '' : 'shut, '}${c.kind === 'warehouse' ? 'warehouse, ' : ''}${c.gable}${c.gable === 'stepped' || c.gable === 'neck' ? ` ${c.tiers}` : ''} ${c.crown}, ${b.bays} bays ${b.w} m, ${b.storeys} storeys, ornament ${c.ornament}, ${c.windows}, ${c.front}${c.pui ? ', pui' : ''}, stoop ${c.stoop}${c.basement ? ' over a basement' : ''}, lean ${c.lean}`);
    }
  }
} else if (style === 'brick') {
  // Hanseatic houses side by side, their fronts on one line, as a valley's town deals them, each planned within.
  const n = num('n', 8), kind = q.get('kind') as 'gabled' | 'eaves' | 'store' | null, houses: Building[] = [];
  for (let k = 0; k < n; k++) {
    const b: Building = { ...dealBrickHouse(new Rng(`${seed}/${k}`), num('deep', 13), kind ?? undefined), x: 0, z: 0, faces: 'w' }, plan = q.get('shut') === '1' ? null : planBrick(b);
    if (plan) b.plan = plan;
    houses.push(b);
  }
  let s = -houses.reduce((sum, b) => sum + b.w, 0) / 2;
  for (const [k, b] of houses.entries()) {
    front(b, s + b.w / 2, 0, Math.PI / 2, new Rng(`${seed}/${k}/build`));
    s += b.w;
    const w = b.brickwork!;
    made.push(`${k}: ${b.plan ? '' : 'shut, '}${w.kind} ${w.gable}, ${b.w} by ${b.d} m, storeys ${b.heights.join('/')}${b.plan ? `, rooms ${[...new Set(b.plan.rooms.map((r) => r.kind))].join(' ')}` : ''}`);
  }
} else if (style === 'wooden') {
  // Classical houses of wood: long and low on their basements, one storey or two; and an L, as at a street corner.
  const tints: [number, number, number][] = [[0.8, 0.55, 0.18], [0.55, 0.2, 0.12], [0.86, 0.72, 0.36], [0.62, 0.68, 0.58], [0.72, 0.74, 0.72], [0.85, 0.6, 0.52]];
  for (let k = 0; k < 4; k++) {
    const r = new Rng(`${seed}/${k}`), storeys = k === 1 ? 2 : 1, w = [18, 14, 13, 20][k], bays = Math.round((w - 2) / 2.2);
    const b: Building = { style: 'wooden', x: 0, z: 0, w, d: r.range(8, 10), faces: 'w', storeys, heights: storeys === 1 ? [3.3] : [3.2, 3.0], bays, colour: tints[(k + (seed.length % 3)) % tints.length], basement: r.range(0.9, 1.5), endDoor: r.chance(0.5) ? -1 : 1, dormers: k === 3 ? 0 : r.int(1, 3) };
    if (k === 2) { b.wings = [{ side: 1, width: 8, length: 10 }]; b.endDoor = -1; }
    show(b, ((k % 2) - 0.5) * 34, Math.floor(k / 2) * 34 - 17, turn, r);
    made.push(`${k}: ${w} m, ${storeys} storey${storeys > 1 ? 's' : ''}${b.wings ? ', an L' : ''}, ${b.dormers} dormers`);
  }
} else if (style === 'timber') {
  for (let k = 0; k < 5; k++) {
    const r = new Rng(`${seed}/${k}`), storeys = r.pick([2, 3, 3, 4]);
    const b: Building = { style: 'timber', x: 0, z: 0, w: r.range(6, 8.6), d: r.range(6.5, 8.5), faces: 'w', storeys, heights: [3, ...Array.from({ length: storeys - 1 }, () => 2.6)], bays: 3, colour: [0.82, 0.62, 0.3], jetty: 0.4, gable: r.chance(0.6), door: 0.24 };
    b.plan = planTimber(b);
    show(b, (k - 2) * 12, 0, turn, r);
  }
} else if (q.has('bays') || q.has('wings') || q.has('towers')) {
  // One building, as asked.
  const r = new Rng(seed), b = classical(r, num('bays', 11), num('storeys', 3)), wings = num('wings', 2);
  if (wings) b.wings = (wings === 2 ? [-1, 1] as const : [1] as const).map((side) => ({ side, width: 7.6, length: num('length', 12) }));
  if (q.get('pediment') === '0') b.pediment = false;
  if (q.has('arch')) b.arch = { side: num('arch', 1) < 0 ? -1 : 1 };
  if (q.has('entrances')) b.entrances = q.get('entrances')!.split(',').map(Number);
  if (q.has('heights')) { b.heights = q.get('heights')!.split(',').map(Number); b.storeys = b.heights.length; }
  if (q.get('brick') === 'stucco' || q.get('brick') === 'bare') b.brick = q.get('brick') as 'stucco' | 'bare';
  const n = num('towers', 0), extra = num('extra', 2);
  if (n) b.towers = [{ corner: 'front', side: -1, size: 6, extra }, { corner: 'front', side: 1, size: 6, extra }, { corner: 'wing', side: 1, size: 6, extra: Math.min(3, extra + 1) }].slice(0, n) as Building['towers'];
  b.plan = planClassical(b, r.fork('plan'));
  show(b, 0, 0, turn, r);
  made.push(JSON.stringify({ pediment: b.pediment, towers: b.towers }));
} else {
  // A row of them, each dealt its variations as the town deals them.
  for (let k = 0; k < 6; k++) {
    const r = new Rng(`${seed}/${k}`), bays = r.pick([7, 9, 9, 11]), b = classical(r, bays, r.pick([2, 3, 3, 4]));
    if (r.chance(0.6)) b.wings = (r.chance(0.6) ? [-1, 1] as const : [r.chance(0.5) ? -1 : 1] as const).map((side) => ({ side: side as -1 | 1, width: 7.2, length: r.range(8, 13) }));
    classicalVariations(b, r.fork('variations'));
    if (!b.wings && r.chance(0.6)) b.arch = { side: r.chance(0.5) ? -1 : 1 };
    if ((q.get('brick') === 'stucco' || q.get('brick') === 'bare') && k % 2 === 0) b.brick = q.get('brick') as 'stucco' | 'bare';
    b.plan = planClassical(b, r.fork('plan'));
    show(b, ((k % 3) - 1) * 42, Math.floor(k / 3) * 46 - 23, turn, r);
    made.push(`${k}: ${bays} bays, storeys ${b.heights.join('/')}${b.wings ? `, ${b.wings.length === 2 ? 'U' : 'L'}` : ''}${b.arch ? ', carriage way' : ''}${b.entrances ? `, doors in bays ${b.entrances.join(' ')}` : ''}${b.pediment === false ? ', no pediment' : ''}${b.brick ? `, brick (${b.brick})` : ''}${b.towers ? `, towers ${b.towers.map((t) => `${t.corner}${t.side > 0 ? 'R' : 'L'}+${t.extra}`).join(' ')}` : ''}`);
  }
}
document.getElementById('note')!.textContent = made.join(' · ');
// `sheet=k`: the floor plans of the `k`th house of the first row, as the game's maps draw them, over the scene.
if (q.has('sheet') && fronts[num('sheet', 0)]?.b.plan) {
  const c = buildingPlans(fronts[num('sheet', 0)].b, num('scale', 26));
  Object.assign(c.style, { position: 'fixed', left: '0', top: '40px', maxWidth: '100%', zIndex: '2' });
  document.body.appendChild(c);
}
const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 2000);
let cam = (q.get('cam') ?? (style === 'canal' ? '-34,5,13,8,10,2' : style === 'brick' ? '0,14,46,0,10,0' : '-70,55,95,0,8,0')).split(',').map(Number);
// `inside=k,storey,a,e`: stand in the `k`th house of the first row on that storey, at eye height, `a` of the way back from its front and
// `e` of the way across from its left (as one faces it), looking toward its front.
if (q.has('inside')) {
  const [k, storey = 0, a = 0.6, e = 0.5] = q.get('inside')!.split(',').map(Number), f = fronts[k], b = f.b;
  const floor = (b.style === 'canal' ? b.canalwork!.stoop : 0.32) + b.heights.slice(0, storey).reduce((x, h) => x + h, 0), ox = Math.cos(f.turn), oz = Math.sin(f.turn);
  const back = -(0.5 + a * (b.d - 1)), across = (e - 0.5) * (b.w - 1.2), px = f.fx + ox * back + oz * across, pz = f.fz + oz * back - ox * across;
  cam = [px, floor + 1.62, pz, f.fx + oz * across, floor + 1.4, f.fz - ox * across];
}
camera.position.set(cam[0], cam[1], cam[2]);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(cam[3], cam[4], cam[5]); controls.update();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
(window as unknown as { __ready: boolean }).__ready = true;
