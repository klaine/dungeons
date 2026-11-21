/**
 * The figure lab (`lab/figures.html`, `npm run figures`): a small stage for trying the figures of `src/figures/` without building a world.
 * Steps, a ramp and a steep one, ledges of 0.6, 1.0, 1.25 and 1.6 metres, a platform to jump down from, a bench and bedrolls. Figures are
 * steered from behind by the keys, with the view following the one chosen, or sent about by pointing; any clip can be played on them.
 *
 * Keys: WASD or the arrows to move, Shift to run (held, it gathers into a sprint), Space to jump (or climb a ledge in front), C to crouch,
 * E to sit or lie down on what is near, X to get up or stop, 1 to 9 for a few clips, Tab for the next figure, T for slow time, P to
 * pause.
 * Pointing: on a figure chooses it; on the ground sends the chosen one there (Shift: running); on a seat or a bedroll, to sit or lie.
 * Dragging turns the view about the figure; the wheel brings it nearer.
 */
import { SKI_RUN } from '../src/figures/alpine';
import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Ray, Raycaster, RepeatWrapping, RingGeometry, Scene, SphereGeometry,
  SkinnedMesh, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshBVH } from 'three-mesh-bvh';
import { Figure, type Pace, type Spot } from '../src/figures/figure';
import { BODIES, FigureLibrary } from '../src/figures/library';

const query = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const foot = document.getElementById('foot') as HTMLDivElement;

// ------------------------------------------------------------------ the stage

interface Seat extends Spot { centre: Vector3; half: Vector2; taken: Figure | null; kind: 'seat' | 'bed' }

/** A closed solid from its triangles, each turned to face away from its middle (every solid here is convex). */
function solid(points: number[][]): BufferGeometry {
  const c = new Vector3();
  for (const p of points) c.add(new Vector3(p[0], p[1], p[2]));
  c.divideScalar(points.length);
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const a = new Vector3(...points[i]), b = new Vector3(...points[i + 1]), d = new Vector3(...points[i + 2]);
    const n = b.clone().sub(a).cross(d.clone().sub(a)), mid = a.clone().add(b).add(d).divideScalar(3);
    if (n.dot(mid.sub(c)) < 0) out.push(...points[i], ...points[i + 2], ...points[i + 1]);
    else out.push(...points[i], ...points[i + 1], ...points[i + 2]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  g.computeVertexNormals();
  return g;
}

/** A ramp over x0…x1, rising along z from z0 (at the ground) to z1 (at `h`); or along x when `alongX`. */
function ramp(x0: number, x1: number, z0: number, z1: number, h: number, alongX = false): BufferGeometry {
  const P = (x: number, y: number, z: number) => (alongX ? [z, y, x] : [x, y, z]);
  const a = P(x0, 0, z0), b = P(x1, 0, z0), c = P(x1, 0, z1), d = P(x0, 0, z1), e = P(x0, h, z1), f = P(x1, h, z1);
  return solid([a, b, c, a, c, d, a, b, f, a, f, e, d, c, f, d, f, e, a, d, e, b, c, f]);
}

/** A box from (x0, y0, z0) to (x1, y1, z1). */
function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function checker(a: string, b: string, n = 2): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64 * n;
  const x = c.getContext('2d')!;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? a : b; x.fillRect(i * 64, j * 64, 64, 64); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildStage(scene: Scene) {
  const solids: BufferGeometry[] = [];
  const ground = checker('#5d6650', '#56604a');
  ground.repeat.set(40, 40);
  const stone = new MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
  const stoneDark = new MeshStandardMaterial({ color: 0x7c776f, roughness: 0.92 });
  const wood = new MeshStandardMaterial({ color: 0x7a5434, roughness: 0.75 });
  const add = (g: BufferGeometry, m: MeshStandardMaterial, collide = true) => {
    const mesh = new Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) solids.push(g);
    return mesh;
  };
  // The ground: a slab, so that nothing falls through its face.
  const floor = add(block(-40, -1, -40, 40, 0, 40), new MeshStandardMaterial({ map: ground, roughness: 0.95 }));
  // (Its top in squares of a metre, for judging whether feet slide.)
  floor.castShadow = false;

  // A stair of six steps of 0.17 up to a platform at 1.02.
  for (let i = 1; i <= 6; i++) add(block(-9, 0, -0.3 * i, -7, 0.17 * i, -0.3 * (i - 1)), i % 2 ? stone : stoneDark);
  add(block(-9.5, 0, -4.8, -6, 1.02, -1.8), stone);
  // Ledges side by side: one to jump onto, two to climb, one too high.
  const ledges = [0.6, 1.0, 1.25, 1.6];
  ledges.forEach((h, i) => add(block(-3 + i * 1.6, 0, -4.5, -1.4 + i * 1.6, h, -2), i % 2 ? stoneDark : stone));
  // A ramp of fifteen degrees up to a platform at 1.5, and a steeper one of thirty-five down its far side; from the platform, a drop.
  const rise = 1.5, run15 = rise / Math.tan((15 * Math.PI) / 180), run35 = rise / Math.tan((35 * Math.PI) / 180);
  add(ramp(5, 7.5, 0, -run15, rise), stone);
  add(block(5, 0, -run15 - 3, 9, rise, -run15), stoneDark);
  add(ramp(-run15 - 3, -run15, 9 + run35, 9, rise, true), stone);

  // A bench, its seat at 0.45, its back to the stage.
  const seats: Seat[] = [];
  {
    const cx = -6, cz = 5, w = 1.8, d = 0.45, top = 0.45;
    add(block(cx - w / 2, top - 0.06, cz - d / 2, cx + w / 2, top, cz + d / 2), wood);
    for (const s of [-1, 1]) add(block(cx + s * (w / 2 - 0.12) - 0.05, 0, cz - d / 2 + 0.03, cx + s * (w / 2 - 0.12) + 0.05, top - 0.06, cz + d / 2 - 0.03), wood);
    add(block(cx - w / 2, top, cz - d / 2 - 0.05, cx + w / 2, top + 0.48, cz - d / 2 + 0.01), wood);
    // (Sitting, the clip's hips are a third of a metre behind its feet: the feet stand that far before the middle of the seat.)
    for (const x of [cx - 0.45, cx + 0.45]) seats.push({ kind: 'seat', centre: new Vector3(x, top, cz), half: new Vector2(0.4, d / 2 + 0.1), feet: new Vector3(x, 0, cz + 0.31), facing: 0, taken: null });
  }
  // Bedrolls on the ground: lying, the clip's head is 0.9 behind where its feet stood and its feet 0.55 before it.
  const roll = new MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.95 });
  for (const x of [5.5, 6.6]) {
    const m = add(block(x - 0.35, 0, 3.6, x + 0.35, 0.04, 5.6), roll, false);
    m.castShadow = false;
    seats.push({ kind: 'bed', centre: new Vector3(x, 0.04, 4.6), half: new Vector2(0.45, 1.1), feet: new Vector3(x, 0, 4.77), facing: 0, lift: 0.035, taken: null });
  }

  // Everything solid, as one mesh with its tree of bounds: what the bodies stand on and are stopped by.
  let count = 0;
  for (const g of solids) count += (g.index ? g.index.count : g.attributes.position.count);
  const pos = new Float32Array(count * 3);
  let at = 0;
  for (const g of solids) {
    const p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i++) { const k = idx ? idx.getX(i) : i; pos[at++] = p.getX(k); pos[at++] = p.getY(k); pos[at++] = p.getZ(k); }
  }
  const all = new BufferGeometry();
  all.setAttribute('position', new BufferAttribute(pos, 3));
  return { bvh: new MeshBVH(all), seats, ledges };
}

// ------------------------------------------------------------------ the program

async function start(): Promise<void> {
  const forceWebGL = query.has('webgl');
  const renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(query.get('dpr')) || 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(0x8fb0cc);
  const camera = new PerspectiveCamera(50, 1, 0.05, 2000);
  // The sky: a dome shaded from pale at the horizon to blue overhead. (Nothing here is lit by it; it is for seeing the figures against.)
  {
    const dome = new SphereGeometry(900, 32, 16), colour = new Float32Array(dome.attributes.position.count * 3);
    const low = new Color(0xd9e2e6), high = new Color(0x6f98c4), c = new Color();
    for (let i = 0; i < dome.attributes.position.count; i++) {
      c.lerpColors(low, high, Math.min(1, Math.max(0, dome.attributes.position.getY(i) / 900) ** 0.6));
      colour.set([c.r, c.g, c.b], i * 3);
    }
    dome.setAttribute('color', new BufferAttribute(colour, 3));
    scene.add(new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
  }
  const sunDir = new Vector3(0.55, 0.62, 0.38).normalize();
  scene.add(new HemisphereLight(0xc4d6ea, 0x5a5444, 1.3));
  const sun = new DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
  scene.add(sun, sun.target);

  const stage = buildStage(scene);
  const down = new Vector3(0, -1, 0);
  const world = {
    colliders: stage.bvh,
    heightAt: (x: number, z: number, top: number) => {
      const hit = stage.bvh.raycastFirst(new Ray(new Vector3(x, top, z), down), DoubleSide);
      return hit ? hit.point.y : null;
    },
  };

  foot.textContent = 'Loading the figures…';
  const base = new URL('../figures/', location.href).href;
  const library = await FigureLibrary.load(base);

  // ---------------------------------------------------------------- figures
  const figures: Figure[] = [];
  const kinds = new Map<Figure, string>();
  let chosen: Figure | null = null;
  const ring = new Mesh(new RingGeometry(0.42, 0.5, 40), new MeshStandardMaterial({ color: 0xe0b070, emissive: 0x6a4a18, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const mark = new Mesh(new RingGeometry(0.1, 0.18, 24), new MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666, transparent: true, opacity: 0 }));
  mark.rotation.x = -Math.PI / 2;
  scene.add(mark);
  let markFade = 0;

  async function addFigure(kind: string, at?: Vector3): Promise<Figure> {
    const rig = await library.body(kind);
    // (Mannequins added more than once are told apart by colour.)
    const sameKind = [...kinds.values()].filter((k) => k === kind).length;
    if (sameKind) rig.model.traverse((o) => {
      const m = (o as SkinnedMesh).material as MeshStandardMaterial | undefined;
      if (m && m.name === 'M_Main') { const c = m.clone(); c.color.offsetHSL((sameKind * 0.17) % 1, 0, 0); (o as SkinnedMesh).material = c; }
    });
    const place = at ?? new Vector3(-1 + figures.length * 1.2, 0, 7);
    const f = new Figure(rig, world, place, Math.PI);
    scene.add(f.root);
    figures.push(f);
    kinds.set(f, kind);
    renderWho();
    return f;
  }

  function choose(f: Figure | null): void {
    if (chosen && chosen !== f) chosen.drive(new Vector2(), 'walk');
    chosen = f;
    renderWho();
  }

  // ---------------------------------------------------------------- the view, following the chosen figure
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 1.2;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 1.1, 7);
  camera.position.set(0, 3.2, 12.5);
  const followed = new Vector3();
  let follow = true;

  // ---------------------------------------------------------------- the keys
  const keys = new Set<string>();
  let shiftSince = 0, slow = false, paused = false;
  const QUICK = ['Interact', 'PickUp_Table', 'Yes', 'Idle_No_Loop', 'Dance_Loop', 'Roll_RM', 'Punch_Jab', 'Death01', 'Idle_Talking_Loop'];
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    keys.add(e.code);
    if (e.code === 'Tab') { e.preventDefault(); if (figures.length) choose(figures[(figures.indexOf(chosen!) + 1) % figures.length]); }
    if (!chosen || e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); chosen.jump(); }
    if (e.code === 'KeyC') chosen.toggleCrouch();
    if (e.code === 'KeyE') useNearest(chosen);
    if (e.code === 'KeyX') chosen.standUp();
    if (e.code === 'KeyT') { slow = !slow; renderWho(); }
    if (e.code === 'KeyP') paused = !paused;
    if (e.code === 'KeyF') follow = !follow;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) chosen.play(QUICK[n - 1]);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  /** The pace the keys and the pointer ask for. */
  const pace = (now: number): Pace => {
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (!shift) { shiftSince = 0; return state.pace; }
    if (!shiftSince) shiftSince = now;
    return now - shiftSince > 1600 ? 'sprint' : 'run';
  };

  const fwd = new Vector3(), right = new Vector3(), dir = new Vector2();
  function steerChosen(now: number): void {
    if (!chosen) return;
    let f = 0, r = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    dir.set(fwd.x * f + right.x * r, fwd.z * f + right.z * r);
    if (dir.lengthSq() > 0) dir.normalize();
    // (Moving by the keys, the pace is walking unless Shift is held; the pace chosen in the panel is for sending figures about.)
    const p = keys.has('ShiftLeft') || keys.has('ShiftRight') ? pace(now) : 'walk';
    chosen.drive(dir, p);
  }

  /** The seat or bedroll nearest a figure, free and within reach; or null. */
  function nearestSpot(f: Figure, kind?: 'seat' | 'bed', reach = 4): Seat | null {
    let best: Seat | null = null, bestD = reach;
    for (const s of stage.seats) {
      if ((s.taken && s.taken !== f) || (kind && s.kind !== kind)) continue;
      const d = s.feet.distanceTo(f.body.position);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function takeSpot(f: Figure, s: Seat, p: Pace): void {
    for (const o of stage.seats) if (o.taken === f) o.taken = null;
    s.taken = f;
    const scale = f.rig.scale;
    // (A larger figure's hips sit further behind its feet.)
    const spot: Spot = { feet: s.feet.clone().add(new Vector3(0, 0, (scale - 1) * (s.kind === 'seat' ? 0.33 : 0.2))), facing: s.facing, lift: s.lift };
    if (s.kind === 'seat') f.sitOn(spot, p); else f.lieOn(spot, p);
  }

  function useNearest(f: Figure): void {
    if (['seated', 'asleep', 'sitting', 'lyingDown'].includes(f.state)) { f.standUp(); return; }
    const s = nearestSpot(f);
    if (s) takeSpot(f, s, 'walk');
  }

  // ---------------------------------------------------------------- pointing
  const raycaster = new Raycaster();
  let press: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, moved: false }; canvas.focus(); });
  canvas.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true; });
  canvas.addEventListener('pointerup', (e) => {
    const p = press;
    press = null;
    if (!p || p.moved || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2), camera);
    const ray = raycaster.ray;
    // A figure: as a post 1.8 high where it stands.
    let hitFigure: Figure | null = null, nearest = Infinity;
    for (const f of figures) {
      const a = f.root.position, b = a.clone().add(new Vector3(0, 1.75, 0)), onRay = new Vector3(), onPost = new Vector3();
      const d2 = ray.distanceSqToSegment(a, b, onRay, onPost);
      const along = onRay.distanceTo(ray.origin);
      if (d2 < 0.35 * 0.35 && along < nearest) { nearest = along; hitFigure = f; }
    }
    const hit = stage.bvh.raycastFirst(ray, DoubleSide);
    if (hitFigure && (!hit || hit.distance > nearest)) { choose(hitFigure); return; }
    if (!hit || !chosen) return;
    const run: Pace = e.shiftKey ? 'run' : state.pace;
    for (const s of stage.seats) {
      if (Math.abs(hit.point.x - s.centre.x) < s.half.x && Math.abs(hit.point.z - s.centre.z) < s.half.y && hit.point.y < s.centre.y + 0.6) {
        if (!s.taken || s.taken === chosen) { takeSpot(chosen, s, run); return; }
      }
    }
    for (const o of stage.seats) if (o.taken === chosen) o.taken = null;
    chosen.goTo(hit.point, run);
    mark.position.copy(hit.point).add(new Vector3(0, 0.02, 0));
    markFade = 1.5;
  });

  // ---------------------------------------------------------------- the panel
  const state = { pace: 'walk' as Pace };
  panel.innerHTML = `
    <h2>Figures</h2>
    <div class="buttons" id="add"></div>
    <div class="buttons who" id="who"></div>
    <div class="state" id="doing"></div>
    <h2>Chosen</h2>
    <div class="buttons" id="acts">
      <button data-a="sit">Sit</button><button data-a="lie">Lie down</button><button data-a="up">Get up</button>
      <button data-a="crouch">Crouch</button><button data-a="jump">Jump</button><button data-a="remove">Remove</button>
    </div>
    <div class="buttons" id="paces">Sent at <button data-p="walk">walk</button><button data-p="run">run</button><button data-p="sprint">sprint</button></div>
    <div class="checks"><label><input type="checkbox" id="slow"> slow time (T)</label><label><input type="checkbox" id="follow" checked> follow (F)</label></div>
    <h2>Clips</h2>
    <div id="clips"></div>
    <p class="note">By Quaternius, CC0: the free Universal Animation Libraries 1 and 2 and Universal Base Characters.</p>`;
  const add = panel.querySelector('#add')!;
  for (const b of BODIES) {
    const btn = document.createElement('button');
    btn.textContent = `+ ${b.label}`;
    btn.onclick = async () => { const f = await addFigure(b.id); choose(f); };
    add.appendChild(btn);
  }
  const who = panel.querySelector('#who')!, doing = panel.querySelector('#doing')!;
  function renderWho(): void {
    who.innerHTML = '';
    figures.forEach((f, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${BODIES.find((k) => k.id === kinds.get(f))?.label ?? ''}`;
      b.classList.toggle('on', f === chosen);
      b.onclick = () => choose(f);
      who.appendChild(b);
    });
    for (const b of panel.querySelectorAll<HTMLButtonElement>('#paces button')) b.classList.toggle('on', b.dataset.p === state.pace);
    (panel.querySelector('#slow') as HTMLInputElement).checked = slow;
    (panel.querySelector('#follow') as HTMLInputElement).checked = follow;
  }
  panel.querySelector('#acts')!.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (!a || !chosen) return;
    if (a === 'sit' || a === 'lie') { const s = nearestSpot(chosen, a === 'sit' ? 'seat' : 'bed', 60); if (s) takeSpot(chosen, s, state.pace); }
    if (a === 'up') chosen.standUp();
    if (a === 'crouch') chosen.toggleCrouch();
    if (a === 'jump') chosen.jump();
    if (a === 'remove') {
      const f = chosen;
      scene.remove(f.root);
      figures.splice(figures.indexOf(f), 1);
      for (const s of stage.seats) if (s.taken === f) s.taken = null;
      kinds.delete(f);
      choose(figures[0] ?? null);
    }
  });
  panel.querySelector('#paces')!.addEventListener('click', (e) => {
    const p = (e.target as HTMLElement).dataset.p as Pace | undefined;
    if (p) { state.pace = p; renderWho(); }
  });
  panel.querySelector('#slow')!.addEventListener('change', (e) => { slow = (e.target as HTMLInputElement).checked; });
  panel.querySelector('#follow')!.addEventListener('change', (e) => { follow = (e.target as HTMLInputElement).checked; });
  // The clips, in groups by what they are for.
  const GROUPS: [string, RegExp][] = [
    ['Going about', /^(Idle_Loop|Walk|Run|Jog|Sprint|Crouch|Swim|Zombie|Slide|Roll|NinjaJump|Jump|ClimbUp)/],
    ['Skiing', /^Ski_/],
    ['Resting', /^(Sitting|LayToIdle|Idle_(FoldArms|Rail|Lantern|Torch|Talking|TalkingPhone|No))/],
    ['Work', /^(Interact|PickUp|Chest|Consume|Farm|Fixing|TreeChopping|Push|Driving|Walk_Carry)/],
    ['Fighting', /^(Sword|Shield|Idle_Shield|Melee|Punch|Pistol|Spell|OverhandThrow|Hit|Death)/],
    ['Other', /./],
  ];
  const clipsBox = panel.querySelector('#clips')!;
  const placed = new Set<string>();
  for (const [title, re] of GROUPS) {
    const names = library.names.filter((n) => !placed.has(n) && re.test(n)).sort();
    if (!names.length) continue;
    const h = document.createElement('h3');
    h.textContent = title;
    const box = document.createElement('div');
    box.className = 'clips';
    for (const n of names) {
      placed.add(n);
      const b = document.createElement('button');
      b.textContent = n.replace(/_Loop$/, ' ↻').replace(/_/g, ' ');
      b.title = n;
      b.onclick = () => { chosen?.play(n); canvas.focus(); };
      box.appendChild(b);
    }
    // (And the downhill turns with every jump between them, one after another, a turn or two apart.)
    if (title === 'Skiing') {
      const b = document.createElement('button');
      b.textContent = 'Run with jumps ↻';
      b.title = 'The downhill turns, and each jump in turn between them: a pop, a kicker, a 360, a cliff drop, a backflip';
      b.onclick = () => { chosen?.chain(SKI_RUN); canvas.focus(); };
      box.appendChild(b);
    }
    clipsBox.append(h, box);
  }

  // ---------------------------------------------------------------- the first figures
  choose(await addFigure('mannequin', new Vector3(0, 0, 7)));
  await addFigure('base-woman', new Vector3(1.6, 0, 7.4));
  followed.copy(chosen!.root.position);
  // (For drivers in `tools/browser/`: the figures, the stage and the view.)
  Object.assign(window, { figureLab: { figures, stage, camera, controls, choose, takeSpot, pause: (on: boolean) => { paused = on; }, ready: true } });

  // ---------------------------------------------------------------- size and the loop
  const resize = () => {
    const narrow = window.innerWidth <= 720;
    const w = Math.max(200, window.innerWidth - (narrow ? 0 : 280)), h = Math.max(160, window.innerHeight - (narrow ? panel.offsetHeight : 0));
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now(), frames = 0, fpsAt = last, fps = 0;
  const help = 'WASD move · Shift run · Space jump/climb · C crouch · E sit/lie · X get up · 1–9 clips · Tab next · T slow · P pause · drag to turn the view · point to send';
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (slow) dt *= 0.25;
    steerChosen(now);
    if (!paused) for (const f of figures) f.update(dt);
    if (chosen) {
      // The view goes along with the chosen figure, keeping its own angle and distance; it can still be turned about it.
      const p = chosen.root.position;
      if (follow) {
        const d = p.clone().sub(followed);
        if (d.length() < 5) { camera.position.add(d); controls.target.add(d); } else controls.target.set(p.x, p.y + 1.1, p.z);
      }
      followed.copy(p);
      ring.visible = true;
      ring.position.set(p.x, p.y + 0.02, p.z);
      sun.position.copy(p).addScaledVector(sunDir, 30);
      sun.target.position.copy(p);
    } else ring.visible = false;
    markFade = Math.max(0, markFade - dt);
    (mark.material as MeshStandardMaterial).opacity = Math.min(1, markFade) * 0.9;
    controls.update();
    renderer.render(scene, camera);
    frames++;
    if (now - fpsAt > 500) { fps = (frames * 1000) / (now - fpsAt); frames = 0; fpsAt = now; }
    if (chosen) doing.textContent = `${chosen.doing}${chosen.busy ? ' (sent)' : ''}`;
    foot.innerHTML = `${help}\n<span class="dim">${figures.length} figure${figures.length === 1 ? '' : 's'} · ${fps.toFixed(0)} frames a second${slow ? ' · slow time' : ''}${paused ? ' · paused (P)' : ''}${forceWebGL ? ' · WebGL 2' : ''}</span>`;
  });
}

start().catch((err) => {
  foot.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
