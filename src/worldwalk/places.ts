import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, InterleavedBuffer, InterleavedBufferAttribute, Material, Mesh, Object3D, Ray, Scene, Vector3 } from 'three';
import { Game, GameUi } from '../app/game';
import type { BlockerFrame, Player } from '../app/player';
import type { Site } from '../core/site';
import type { DoorDesc, SceneDescription } from '../render/scene';
import { MeshBVH } from 'three-mesh-bvh';
import type { WebGPURenderer } from 'three/webgpu';
import { worldShelf, WorldShelf } from '../app/worldStore';
import { Hour, SKIES } from '../core/site';
import { Hole, holeAt } from '../core/stream';
import { WorldPlace } from '../core/world';
import { bake } from '../render/bake/bake';
import type { Atmosphere } from '../render/post';
import { intoSite, type PackedMesh, type PlaceGame, type PlacePack } from '../render/placePack';
import { Birds } from '../render/birds';
import { Beacon } from '../render/beacon';
import { Flocks } from '../render/creatures';
import { Fireflies } from '../render/fireflies';
import { gatherTorches, Torch } from '../render/torch';
import type { SeaDesc } from '../render/scene';
import { makePaneMaterial, makePropMaterial, makeRockMaterial, makeSiteMaterial, makeStainedMaterial, makeWindowMaterial, setLamps, windowUniforms } from '../render/siteMaterial';
import { generateTextureSet } from '../render/textures';
import { Water } from '../render/water';
import { SunPicture } from '../render/sunShadow';
import placesWorker from '../worldmap/placesWorker?worker&url';
import { WorldColliders } from './body';
import { cardsOf } from './dress';

/**
 * Places built into the world as the walker comes to them: step 2 of the world becoming the game (`docs/06-world.md`, *The world as
 * the game*). A place within `NEAR` of the walker is laid out and built in a worker of its own (`placesWorker.ts`, `packPlace`: the
 * world made there once, then the place meshed as the game meshes it, its far land left out, and turned into the world's coordinates);
 * here its meshes are made with the game's materials, a few a frame so that the picture does not stall, lit as the game lights what it
 * does not bake, and then its house baked as the game bakes it (`bake`, in workers). The world's land is cut away under the square the
 * place was laid over and brought to meet the place's at its edge (`Hole`, given to the squares' workers); nothing of the world grows
 * inside it; the body walks on and is stopped by the place's solid part (its tree of bounds made in the worker). Let go of again past
 * `FAR`. Layouts are kept in the browser as the world page keeps them (`worldStore.ts`), so that the game, entering the place, does
 * not lay it out again.
 *
 * Every kind: a valley head, a harbour town, an island and a mountain top. What a place has beyond the square of land it was laid over
 * is left out (a mountain top's far cairns stood on peaks the world has otherwise); an island's or a town's own sea is drawn in place of
 * the world's while it stands (`onSea`).
 */

/** How near a place must be to be built, and how far off it is let go of, metres from where it was found. */
const NEAR = 1500, FAR = 2300;
/**
 * How many places stand in the world at once, at most. (Three came within reach together on the route page's first world, two towns and a
 * valley head, sixteen million triangles: more than a modest machine holds. A nearer one wanted takes the place of the furthest, once
 * that one is in and is well further off than it, `YIELD` metres, so that walking between two the two are not built by turns.)
 */
const MOST = 2, YIELD = 300;
/** The kinds of place built into the world. (A mountain top's sea of cloud under it is not drawn: in a world it would lie over all of it.) */
const KINDS: WorldPlace['kind'][] = ['valley', 'coast', 'island', 'mountain'];
/** How light each kind of surface is on the whole, for the bake (as the game has it). */
const MEAN_ALBEDO: Record<string, number> = { brick: 0.3, stone: 0.6, floor: 0.6, slate: 0.6, wood: 0.25, rock: 0.6, rockSheet: 0.6, scree: 0.45, bark: 0.3, barkAsh: 0.35, barkPine: 0.35, barkFir: 0.3, turf: 0.12, leaf: 0.1, redBrick: 0.3, buffBrick: 0.45 };

/** How bright the lamps and lit windows are at an hour, as the game has it (none by day). */
export const lampsAt = (hour: Hour) => (hour === 'night' ? 0.5 : hour === 'dusk' ? 0.55 : hour === 'sunset' ? 0.4 : 0);

/**
 * The street lamps' light on what is about them, switched on before anything is drawn when they are lit at the hour: whether a material
 * reads them is settled when it is first drawn (`setLamps`), and the places with lamps come later. Where they lie is given as places
 * come and go (`WorldPlaces`); until then, one lamp far off. Only where the card can read one more texture, as in the game.
 */
export function lightLamps(hour: Hour, room: number): void {
  if (lampsAt(hour) && room >= 20) setLamps([[1e7, 0, 1e7]], lampsAt(hour) * 16, true);
}

/** What lives and burns in a place standing in the world, made from its pack (`PlaceLife`): moved each frame, let go of with it. */
interface Living { birds: Birds | null; flocks: Flocks | null; torches: Torch[]; flames: Object3D | null; beacon: Beacon | null; fireflies: Fireflies | null }

/** A place's game as it is played in the world (`playing`): the rules, the group they are drawn in, and who stands in for the walker. */
interface Playing { game: Game; group: Group; proxy: { position: Vector3; blockers: Player['blockers'] }; frame: BlockerFrame }

interface Built {
  spec: string; place: WorldPlace; pack: PlacePack;
  meshes: (Mesh | InstancedMesh)[]; cards: InstancedMesh[]; water: Water | null; bvh: MeshBVH; life: Living | null; play: Playing | null;
  /** The meshes still to be made and put in, a few a frame; and how the bake goes. */
  todo: PackedMesh[]; baked: 'waiting' | 'baking' | 'done' | 'failed';
}

export class WorldPlaces {
  /** How many places let go of have been collected, for checking that none is held on to (`letGo`). */
  static collected = 0;
  private static readonly gone = new FinalizationRegistry<string>(() => { WorldPlaces.collected++; });
  private worker: Worker | null = null;
  private queue: { build?: string[]; only?: string[] }[] = [];
  private busy = false;
  private built = new Map<string, Built>();
  private asked = new Set<string>();
  private materials: Record<string, Material> | null = null;
  private painting: Promise<void> | null = null;
  private shelf: Promise<WorldShelf | null>;
  private keeping: Promise<unknown> = Promise.resolve();
  /** What is being done, for the page's panel. */
  status = '';
  /** The walker's body, whose position the places' games read and whose blocks their shut doors are (`playing`). */
  player: Player | null = null;
  /** Called with each place's layout as it comes, whether built or only laid out (for the route page's ink map and links). */
  onSite: ((kind: string, n: number, site: unknown) => void) | null = null;
  /** Called when the holes change: the page makes again the squares and what grows about them. */
  onHoles: ((changed: Hole) => void) | null = null;
  /** Called with a place's own sea when one with a sea stands, and with nothing when it goes. */
  onSea: ((sea: SeaDesc | null) => void) | null = null;
  private t0 = performance.now();

  constructor(private readonly o: { seed: string; size?: { x: number; z: number }; scene: Scene; renderer: WebGPURenderer; lamps?: boolean; keep?: boolean; ui?: (place: string) => GameUi; colliders: WorldColliders; places: WorldPlace[]; hour: Hour; season: string; texSize: number; turf: Material; sunDir: Vector3; atmosphere: Atmosphere }) {
    this.shelf = worldShelf(o.seed);
  }

  /** The holes of the places standing in the world now. */
  holes(): Hole[] { return [...this.built.values()].filter((b) => b.todo.length === 0).map((b) => b.pack.hole); }
  /** Whether a point lies inside a place standing in the world (so that its own land, not the world's, is under it). */
  inside(x: number, z: number, by = 0): boolean { for (const b of this.built.values()) if (b.todo.length === 0 && holeAt(b.pack.hole, x, z).out < -by) return true; return false; }
  /** The height of a place's ground under a point, looking down from `from`: for a walker a place has come to stand under. */
  groundAt(x: number, z: number, from: number): number | null {
    const ray = new Ray(new Vector3(x, from, z), new Vector3(0, -1, 0));
    for (const b of this.built.values()) if (b.todo.length === 0 && holeAt(b.pack.hole, x, z).out < 0) { const hit = b.bvh.raycastFirst(ray, DoubleSide); if (hit) return hit.point.y; }
    return null;
  }
  /** The level of the sea of a place standing at a point (a town's, an island's), or none. */
  seaAt(x: number, z: number): number | null {
    for (const b of this.built.values()) if (b.todo.length === 0 && b.pack.sea && holeAt(b.pack.hole, x, z).out < 0) return b.pack.sea.level;
    return null;
  }
  /** The cards of the places standing, for the page's culling (grass and leaves drawn two ways near the eye). */
  cards(): InstancedMesh[] { return [...this.built.values()].flatMap((b) => b.cards); }

  /** Lays out places for the game only, keeping them (the route page's two ends). */
  layOut(specs: string[]): void { this.send({ only: specs.filter((s) => !this.asked.has(s)) }); }

  private send(msg: { build?: string[]; only?: string[] }): void {
    if (!(msg.build ?? msg.only)?.length) return;
    this.queue.push(msg);
    this.next();
  }

  private next(): void {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    if (!this.worker) {
      this.worker = new Worker(placesWorker, { type: 'module' });
      this.worker.onmessage = (e) => this.heard(e.data);
      this.worker.onerror = (e) => { this.status = `The places could not be built: ${e.message}`; this.busy = false; };
    }
    this.worker.postMessage({ seed: this.o.seed, size: this.o.size, season: this.o.season, hour: this.o.hour, ...this.queue.shift()! });
  }

  private keep(what: string, value: unknown): void { this.keeping = this.keeping.then(async () => (await this.shelf)?.set(what, value)); }

  private heard(m: { type: string; [k: string]: unknown }): void {
    const secs = () => Math.round((performance.now() - this.t0) / 1000);
    if (m.type === 'progress') { this.status = `${m.text}… ${secs()} s`; return; }
    if (m.type === 'world') { this.keep('world', m.world); return; }
    if (m.type === 'tile') { const t = m.tile as { i: number; j: number }; this.keep(`${t.i},${t.j}`, t); return; }
    if (m.type === 'site') { this.keep(`site:${m.kind}${m.n}`, { seed: m.seed, site: m.site }); if (m.site) this.onSite?.(m.kind as string, m.n as number, m.site); return; }
    if (m.type === 'pack') {
      const spec = `${m.kind}${m.n}`, place = this.o.places.find((q) => `${q.kind}${q.n}` === spec), pack = m.pack as PlacePack | null;
      if (!pack || !place) { this.status = `${place?.name ?? spec} could not be built: ${m.why ?? ''}`; return; }
      this.status = `${place.name} built in the worker (meshed in ${(pack.ms.mesh / 1000).toFixed(0)} s, ${(pack.triangles / 1e6).toFixed(1)} million triangles); putting it in…`;
      void this.stand(spec, place, pack);
      return;
    }
    if (m.type === 'done') { this.busy = false; this.next(); }
  }

  /** Each frame: what to build and let go of, the meshes of a place coming in, its water. */
  update(me: Vector3, now: number, camera: Parameters<Water['update']>[1], viewHeight: number): void {
    this.updateBody(me, now, camera, viewHeight);
    this.lastLife = now / 1000;
  }
  /** When the living things were last moved, seconds. */
  private lastLife = 0;

  private updateBody(me: Vector3, now: number, camera: Parameters<Water['update']>[1], viewHeight: number): void {
    // The nearest place not built within reach, one at a time.
    let want: WorldPlace | null = null, best = NEAR;
    for (const q of this.o.places) {
      const spec = `${q.kind}${q.n}`, d = Math.hypot(q.x - me.x, q.z - me.z);
      if (!KINDS.includes(q.kind) || this.asked.has(spec)) continue;
      if (d < best) { best = d; want = q; }
    }
    if (want && this.asked.size >= MOST) {
      let far: [string, Built] | null = null, farOff = -1;
      for (const [spec, b] of this.built) { const d = Math.hypot(b.place.x - me.x, b.place.z - me.z); if (d > farOff) { farOff = d; far = [spec, b]; } }
      if (far && this.built.size >= this.asked.size && far[1].todo.length === 0 && farOff > best + YIELD) this.letGo(far[0], far[1]);
      else want = null;
    }
    if (want && ![...this.built.values()].some((b) => b.todo.length)) {
      const spec = `${want.kind}${want.n}`;
      this.asked.add(spec);
      this.t0 = performance.now();
      this.send({ build: [spec] });
      // (The materials painted meanwhile, while the worker builds: a surface a frame or so.)
      void this.paint();
    }
    for (const [spec, b] of this.built) {
      if (Math.hypot(b.place.x - me.x, b.place.z - me.z) > FAR) { this.letGo(spec, b); continue; }
      // A few meshes a frame, so that no frame waits long on them: then the cards and the water, then the bake.
      if (b.todo.length && this.materials) {
        // (Some six milliseconds' worth a frame: the land and trees about the place come cut into tiles of 64 metres, some hundreds.)
        const t = performance.now();
        do this.make(b, b.todo.shift()!); while (b.todo.length && performance.now() - t < 6);
        if (!b.todo.length) this.finish(spec, b);
      }
      b.water?.update(now / 1000, camera, viewHeight);
      const l = b.life, t = now / 1000;
      if (b.play) {
        // (The walker taken into the place's own ways, where its rules are played.)
        const [sx, sz] = intoSite(b.pack.life.frame, me.x, me.z);
        b.play.proxy.position.set(sx, me.y - b.play.frame.dy, sz);
        b.play.game.update(Math.min(0.1, Math.max(0, t - this.lastLife)), t);
      }
      if (l) {
        l.birds?.update(t); l.beacon?.update(t);
        l.flocks?.update(Math.min(0.1, Math.max(0, t - this.lastLife)), t, me);
        for (const torch of l.torches) torch.update(t);
        l.fireflies?.update(t, camera as unknown as Parameters<Fireflies['update']>[1], true, Math.min(0.1, Math.max(0, t - this.lastLife)));
      }
    }
  }

  /** The surfaces a place is built of that the walk does not paint itself, painted once, one at a time with a frame between. */
  private paint(): Promise<void> {
    if (this.painting) return this.painting;
    const frame = () => new Promise<void>((r) => setTimeout(r, 16)), size = this.o.texSize;
    this.painting = (async () => {
      const set: Record<string, ReturnType<typeof generateTextureSet>> = {};
      for (const [name, seed, half] of [['moss', 9, true], ['stone', 3], ['wood', 5], ['rock', 13], ['scree', 23], ['plaster', 41], ['thatch', 47], ['tile', 43], ['redBrick', 73], ['buffBrick', 79], ['brick', 83], ['talus', 71], ['bark', 29], ['barkAsh', 59], ['barkPine', 61], ['barkFir', 67]] as [Parameters<typeof generateTextureSet>[0], number, boolean?][]) {
        set[name] = generateTextureSet(name, half ? size / 2 : size, seed);
        await frame();
      }
      const moss = set.moss, hour = this.o.hour;
      const lamps = lampsAt(hour);
      windowUniforms.uLit.value = lamps;
      // (As the game makes them, `src/app/main.ts`; to be one set for both when the world and the place share one renderer, step 3.)
      const m: Record<string, Material> = {
        stone: makeSiteMaterial(set.stone, moss, { normalScale: 1.0, bevel: 0.02, chips: true, weather: true }),
        floor: makeSiteMaterial(set.stone, moss, { normalScale: 1.2 }),
        slate: makeSiteMaterial(set.stone, moss, { normalScale: 0.7, roughness: 0.8 }),
        wood: makeSiteMaterial(set.wood, moss, { normalScale: 1.0, bevel: 0.012, chips: true, timber: true, weather: true }),
        rock: makeRockMaterial(set.rock, moss),
        rockSheet: makeRockMaterial(set.rock, moss, { relief: true }),
        scree: makeSiteMaterial(set.scree, moss, { normalScale: 1.6, matt: true, fades: 'near' }),
        // (On a mountain top what lies loose is rock split by frost, cornered and flat-faced: `make` draws a mountain's scree with it.)
        talus: makeSiteMaterial(set.talus, moss, { normalScale: 1.6, matt: true, fades: 'near' }),
        bark: makeSiteMaterial(set.bark, moss, { normalScale: 2.2, mossScale: 2.5, matt: true, deep: 0.06 }),
        barkAsh: makeSiteMaterial(set.barkAsh, moss, { normalScale: 1.6, mossScale: 2.5, matt: true, deep: 0.02, hollow: 0.5 }),
        barkPine: makeSiteMaterial(set.barkPine, moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.04, hollow: 0.35 }),
        barkFir: makeSiteMaterial(set.barkFir, moss, { normalScale: 2, mossScale: 2.5, matt: true, deep: 0.03, hollow: 0.6 }),
        turf: this.o.turf,
        leaf: makeSiteMaterial(moss, moss, { normalScale: 2.4 }),
        plaster: makeSiteMaterial(set.plaster, moss, { normalScale: 0.8, render: true, weather: true }),
        tile: makeSiteMaterial(set.tile, moss, { normalScale: 1.3, mossScale: 3, roof: true }),
        redBrick: makeSiteMaterial(set.redBrick, moss, { normalScale: 1.1, mossScale: 2.2, bond: 'wendish', weather: true }),
        buffBrick: makeSiteMaterial(set.buffBrick, moss, { normalScale: 1.1, mossScale: 2.2, bond: 'wendish', weather: true }),
        // (The brown brick of a town's classical buildings, in running bond.)
        brick: makeSiteMaterial(set.brick, moss, { normalScale: 1.1, mossScale: 3, bond: 'running', weather: true }),
        metal: makeSiteMaterial(set.plaster, moss, { normalScale: 0.25, roughness: 0.5 }),
        copper: makeSiteMaterial(set.plaster, moss, { normalScale: 0.45, roughness: 0.86, mossScale: 2.5 }),
        glass: makeSiteMaterial(set.plaster, moss, { normalScale: 0.12, roughness: 0.1 }),
        pane: makePaneMaterial(),
        thatch: makeSiteMaterial(set.thatch, moss, { normalScale: 1.6, mossScale: 2 }),
        lamp: makePropMaterial({ color: new Color(0.95, 0.9, 0.75), roughness: 0.15, metalness: 0, emissive: new Color(1, 0.82, 0.5), emissiveIntensity: 0.4 }),
        stained: makeStainedMaterial(),
      };
      m.window = lamps ? makeWindowMaterial() : makeSiteMaterial(set.plaster, moss, { normalScale: 0.12, roughness: 0.1, paint: [0.04, 0.055, 0.075] });
      m.paneLit = lamps ? makePaneMaterial(true) : m.pane;
      this.materials = m;
    })();
    return this.painting;
  }

  /** A place built: kept until its meshes are made, a few a frame (`update`). */
  private async stand(spec: string, place: WorldPlace, pack: PlacePack): Promise<void> {
    await this.paint();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pack.solid.position, 3));
    geo.setIndex(new BufferAttribute(pack.solid.index, 1));
    const bvh = MeshBVH.deserialize(pack.solid.bvh, geo, { setIndex: true });
    this.built.set(spec, { spec, place, pack, meshes: [], cards: [], water: null, bvh, life: null, play: null, todo: [...pack.meshes], baked: 'waiting' });
  }

  /** One mesh of a place, made and put in, lit as the game lights what it does not bake (the house's light baked afterwards). */
  private make(b: Built, p: PackedMesh): void {
    const n = p.position.length / 3, g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p.position, 3));
    g.setAttribute('normal', new BufferAttribute(p.normal, 3));
    g.setAttribute('uv', new BufferAttribute(p.uv, 2));
    g.setAttribute('color', new BufferAttribute(p.color, 3));
    g.setAttribute('aField', new BufferAttribute(p.field, 4));
    const light = new InterleavedBuffer(new Float32Array(n * 14), 14);
    g.setAttribute('aSHr', new InterleavedBufferAttribute(light, 4, 0));
    g.setAttribute('aSHg', new InterleavedBufferAttribute(light, 4, 4));
    g.setAttribute('aSHb', new InterleavedBufferAttribute(light, 4, 8));
    g.setAttribute('aBake', new InterleavedBufferAttribute(light, 2, 12));
    g.setAttribute('aEdge', new BufferAttribute(p.edge, 4, true));
    g.setIndex(new BufferAttribute(p.index, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    // The light of what is not baked (as the game's main program reckons it for what stands about a place): the sky's, and the light
    // thrown up from sunlit ground, by each point's share of the sky; indoors a dim light from the windows; under the hill, its own.
    const S = SKIES[this.o.hour], L = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]), up = Math.max(0, this.o.sunDir.y);
    const G = [0, 1, 2].map((c) => (0.2 * (0.6 * S.intensity * S.colour[c] * up + Math.PI * 0.9 * L[c])) / Math.PI), a = light.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      if (p.own) { for (let c = 0; c < 3; c++) for (let q = 0; q < 4; q++) a[o + c * 4 + q] = p.own[i * 13 + c * 4 + q]; a[o + 12] = 0; a[o + 13] = 0.6 + 0.4 * p.own[i * 13 + 12]; continue; }
      if (p.open[i] < 0) { for (let c = 0; c < 3; c++) a[o + c * 4] = 0.22 * (Math.PI / 2) * (0.6 * L[c] + 1.4 * G[c]); a[o + 12] = 0.05; a[o + 13] = 0.6; continue; }
      const open = 0.3 + 0.7 * p.open[i];
      for (let c = 0; c < 3; c++) { a[o + c * 4] = (Math.PI / 2) * (L[c] + G[c]) * open; a[o + c * 4 + 2] = (Math.PI / 2) * (L[c] * 0.8 - G[c]) * open; }
      a[o + 12] = open; a[o + 13] = 0.6;
    }
    const mesh = new Mesh(g, this.materials![b.place.kind === 'mountain' && p.material === 'scree' ? 'talus' : p.material] ?? this.materials!.stone);
    mesh.name = `place:${p.key}`;
    mesh.castShadow = !['pane', 'paneLit', 'glass', 'window'].includes(p.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    // (And into the finer picture from the sun about the walker, so that it throws its shadow beyond the near square too.)
    if (mesh.castShadow) mesh.layers.enable(SunPicture.LAYER);
    this.o.scene.add(mesh);
    b.meshes.push(mesh);
    // (What the bake reads is kept until it is done; the rest goes to the card now, its light being all it will have.)
    if (p.baked) mesh.userData.packed = p; else this.toCard(mesh);
  }

  /**
   * Sends a mesh's points to the card now, as drawing it first would, and lets the page's copies of them go. Kept in the page once the
   * card had them, a place's points (some 124 bytes each, with their light, and about two to a triangle) came to a gigabyte and a half
   * for a harbour town, and two places standing filled the page's heap to within a tenth of its limit. Each array is left as an empty
   * one of its kind, which is all three reads of it from then on (the kind gives the format the card reads it in). The index is kept:
   * the view of the triangles makes its edges from it. (Three's WebGPU renderer does nothing with `onUpload`; the call is the one its
   * drawing makes, `Attributes.update`, which sends a buffer the first time and again whenever its version has gone on.)
   */
  private toCard(mesh: Mesh): void {
    // (`?keep=1` keeps them, for looking into a place's meshes from the console.)
    if (this.o.keep) return;
    const sent = (this.o.renderer as unknown as { _attributes: { update(buffer: BufferAttribute | InterleavedBuffer, type: number): void } })._attributes;
    const seen = new Set<BufferAttribute | InterleavedBuffer>();
    for (const a of Object.values(mesh.geometry.attributes)) {
      const buffer = (a as InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as InterleavedBufferAttribute).data : (a as BufferAttribute);
      if (seen.has(buffer) || !buffer.array.length) continue;
      seen.add(buffer);
      sent.update(buffer, 1 /* AttributeType.VERTEX */);
      buffer.array = new (buffer.array.constructor as new (n: number) => typeof buffer.array)(0);
    }
  }

  /** Its meshes all in: its cards, its water, its solid part for the body, its hole in the world's land; then its house's light baked. */
  private finish(spec: string, b: Built): void {
    for (const c of cardsOf(b.pack.cards)) { this.o.scene.add(c); b.cards.push(c); b.meshes.push(c); }
    // (The pack's own lists of them let go of: the meshes and cards hold what they need.)
    b.pack.meshes = []; b.pack.cards = [];
    const S = SKIES[this.o.hour], life = b.pack.life;
    if (b.pack.water?.length || b.pack.streams?.length || life.smokes.length) {
      b.water = new Water(b.pack.water ?? [], b.pack.streams ?? [], {
        mirror: 0, zenith: S.zenith, horizon: S.horizon, falls: b.pack.falls, smokes: life.smokes,
        land: S.ground.map((v) => v * 0.45),
        foam: [0, 1, 2].map((c) => 0.6 * S.horizon[c] + 0.12 * S.colour[c] * S.intensity),
        deep: [(0.55 * S.zenith[0] + 0.45 * S.horizon[0]) * 0.06 + 0.002, (0.55 * S.zenith[1] + 0.45 * S.horizon[1]) * 0.17 + 0.003, (0.55 * S.zenith[2] + 0.45 * S.horizon[2]) * 0.11 + 0.003],
      });
      // (Mirroring the sky and the cloud as the game's water does: given its program before it comes into the scene.)
      b.water.mirrorSky(this.o.atmosphere);
      for (const m of b.water.meshes) { this.o.scene.add(m); b.meshes.push(m); }
    }
    b.life = this.living(b);
    b.play = this.playing(b);
    this.o.colliders.others.push(b.bvh);
    this.onHoles?.(b.pack.hole);
    this.lamps();
    if (b.pack.sea) this.onSea?.(b.pack.sea);
    this.status = `${b.place.name} stands in the world (${(b.pack.triangles / 1e6).toFixed(1)} million triangles); its light being baked…`;
    this.bakeHouse(b);
  }

  /**
   * A place's game, played in the world as the game plays it (`Game`): its doors that open, are locked, barred or hidden, its keys to
   * pick up, its levers, the goal at its heart, its hidden relic and what lies about to be found. The rules are the game's own and run
   * in the site's own ways: they are drawn in a group set in the place's frame, the walker taken into those ways each frame for them
   * (a stand-in with the walker's position there), and the doors' blocks handed to the walker's body with the frame they lie in.
   */
  private playing(b: Built): Playing | null {
    const player = this.player, g = b.pack.game, materials = this.materials;
    if (!player || !g || !materials) return null;
    const f = b.pack.life.frame, frame: BlockerFrame = { u: f.u, v: f.v, hx: f.hx, hz: f.hz, turn: f.turn, dy: f.base - f.floor };
    // (The group's own turn and offset are the frame's: a point of the site, turned about the frame's point and set down at its place.)
    const group = new Group(), c = Math.cos(f.turn), sn = Math.sin(f.turn);
    group.rotation.y = -f.turn;
    group.position.set(f.u - (c * f.hx - sn * f.hz), frame.dy, f.v - (sn * f.hx + c * f.hz));
    this.o.scene.add(group);
    const V = (q: [number, number, number]) => new Vector3(q[0], q[1], q[2]);
    const doors: DoorDesc[] = g.doors.map((o) => ({
      way: o.way, hinge: V(o.hinge), yaw: o.yaw, swing: o.swing, halfWidth: o.halfWidth, spring: o.spring, thickness: o.thickness, material: o.material,
      blocker: { min: V(o.blocker.min), max: V(o.blocker.max) }, centre: V(o.centre), barSide: o.barSide,
      leaf: o.leaf ? ({ build: () => this.leafGeometry(o.leaf!) } as unknown as DoorDesc['leaf']) : null,
    }));
    const desc = { doors, anchors: new Map(g.anchors.map(([id, x, y, z]) => [id, new Vector3(x, y, z)])), finds: g.finds.map((q) => ({ at: V(q.at), what: q.what })) } as unknown as SceneDescription;
    const proxy = { position: new Vector3(), blockers: [] as Player['blockers'] };
    const ui = this.o.ui?.(b.place.name) ?? { toast: () => undefined, keysChanged: () => undefined, won: () => undefined };
    const game = new Game(g.site as Site, desc, group as unknown as Scene, materials, proxy as unknown as Player, ui);
    for (const k of proxy.blockers) { k.frame = frame; player.blockers.push(k); }
    return { game, group, proxy, frame };
  }

  /** A door's leaf from its arrays, lit as what is indoors is lit in the world (`make`): it is never baked. */
  private leafGeometry(l: NonNullable<PlaceGame['doors'][number]['leaf']>): BufferGeometry {
    const g = new BufferGeometry(), n = l.position.length / 3;
    g.setAttribute('position', new BufferAttribute(l.position, 3));
    g.setAttribute('normal', new BufferAttribute(l.normal, 3));
    g.setAttribute('uv', new BufferAttribute(l.uv, 2));
    g.setAttribute('color', new BufferAttribute(l.color, 3));
    g.setAttribute('aField', new BufferAttribute(l.field, 4));
    g.setAttribute('aEdge', new BufferAttribute(l.edge, 4, true));
    const S = SKIES[this.o.hour], L = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]), up = Math.max(0, this.o.sunDir.y);
    const G = [0, 1, 2].map((c) => (0.2 * (0.6 * S.intensity * S.colour[c] * up + Math.PI * 0.9 * L[c])) / Math.PI);
    const light = new InterleavedBuffer(new Float32Array(n * 14), 14), a = light.array as Float32Array;
    for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) a[i * 14 + c * 4] = 0.22 * (Math.PI / 2) * (0.6 * L[c] + 1.4 * G[c]); a[i * 14 + 12] = 0.05; a[i * 14 + 13] = 0.6; }
    g.setAttribute('aSHr', new InterleavedBufferAttribute(light, 4, 0));
    g.setAttribute('aSHg', new InterleavedBufferAttribute(light, 4, 4));
    g.setAttribute('aSHb', new InterleavedBufferAttribute(light, 4, 8));
    g.setAttribute('aBake', new InterleavedBufferAttribute(light, 2, 12));
    g.setIndex(new BufferAttribute(l.index, 1));
    return g;
  }

  /**
   * What lives and burns in a place, as the game makes it (`src/app/main.ts`): its smoke is drawn with its water (`finish`); here its
   * birds, gulls off a coast's cliffs or choughs off a mountain's precipices; its sheep or goats, stood on the place's solid part and
   * kept out of its rooms, its ponds and its sea; its torches, candles and fires, their flames flickering (their light is baked in, as
   * none is lit here); and at dusk and by night its lighthouse's beam and, on a warm evening, its fireflies.
   */
  private living(b: Built): Living {
    const l = b.pack.life, S = SKIES[this.o.hour], scene = this.o.scene, seed = `${this.o.seed}/${b.spec}`;
    const birds = l.birds.length ? new Birds(l.birds, seed, S.intensity * 0.55 + 0.4, l.birdKind) : null;
    if (birds) scene.add(birds.mesh);
    let flocks: Flocks | null = null;
    if (l.flocks.length) {
      const down = new Ray(new Vector3(), new Vector3(0, -1, 0));
      const groundAt = (x: number, z: number) => { down.origin.set(x, 5000, z); return b.bvh.raycastFirst(down, DoubleSide)?.point.y ?? -1000; };
      const rooms = l.rooms.map(([x0, x1, z0, z1]) => [x0 - 2, x1 + 2, z0 - 2, z1 + 2]), water = b.pack.water ?? [], sea = b.pack.sea?.level;
      const free = (x: number, z: number) => {
        const [sx, sz] = intoSite(l.frame, x, z);
        if (rooms.some((r) => sx > r[0] && sx < r[1] && sz > r[2] && sz < r[3])) return false;
        if (water.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 1.5)) return false;
        return sea === undefined || groundAt(x, z) > sea + 0.8;
      };
      flocks = new Flocks(l.flocks, seed, groundAt, free, l.flockKind);
      scene.add(flocks.group);
    }
    const torches = l.torches.map((t, i) => new Torch(new Vector3(...t.position), new Vector3(...t.out), i * 0.37 + 0.1, t.fire, t.flames?.map((q) => new Vector3(...q))));
    const flames = torches.length ? gatherTorches(torches) : null;
    if (flames) scene.add(flames);
    const lit = this.o.hour === 'night' ? 0.22 : this.o.hour === 'dusk' ? 0.1 : this.o.hour === 'sunset' ? 0.035 : 0;
    const beacon = l.beacon && lit ? new Beacon(l.beacon, lit) : null;
    if (beacon) scene.add(beacon.group);
    const warm = (this.o.hour === 'dusk' || this.o.hour === 'night') && (this.o.season === 'spring' || this.o.season === 'summer');
    const fireflies = warm && l.fireflies.length ? new Fireflies(l.fireflies, seed, this.o.hour === 'night' ? 1.6 : 2.4) : null;
    if (fireflies) scene.add(fireflies.mesh);
    return { birds, flocks, torches, flames, beacon, fireflies };
  }

  /** The street lamps of every place standing, for their light on what is about them (`lightLamps`), when they are lit. */
  private lamps(): void {
    const level = lampsAt(this.o.hour);
    if (!level || !this.o.lamps) return;
    const all = [...this.built.values()].filter((b) => b.life).flatMap((b) => b.pack.life.lamps);
    setLamps(all.length ? all : [[1e7, 0, 1e7]], level * 16, true);
  }

  /** The house's light, baked as the game bakes it: in workers, the place's own lamps and fires baked in, since none is lit here. */
  private bakeHouse(b: Built): void {
    const parts = b.meshes.filter((m): m is Mesh => (m as Mesh).isMesh && !!(m.userData.packed as PackedMesh | undefined)?.baked);
    let vertices = 0, indices = 0;
    for (const m of parts) { vertices += m.geometry.getAttribute('position').count; indices += m.geometry.getIndex()!.count; }
    if (!vertices) { b.baked = 'done'; return; }
    const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), albedo = new Float32Array(vertices * 3), index = new Uint32Array(indices);
    const source = new Int32Array(vertices), scale = new Float32Array(vertices), offsets: number[] = [];
    let vo = 0, io = 0;
    for (const m of parts) {
      const p = m.userData.packed as PackedMesh, n = p.position.length / 3;
      offsets.push(vo);
      positions.set(p.position, vo * 3); normals.set(p.normal, vo * 3);
      const k = MEAN_ALBEDO[p.material] ?? 0.5;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) albedo[(vo + i) * 3 + c] = Math.min(0.95, p.color[i * 3 + c] * k);
        source[vo + i] = (p.source ? p.source[i] : i) + vo; scale[vo + i] = p.scale ? p.scale[i] : 1;
      }
      for (let i = 0; i < p.index.length; i++) index[io++] = p.index[i] + vo;
      vo += n;
    }
    const S = SKIES[this.o.hour], d = this.o.sunDir;
    const apply = (r: { sh: Float32Array; skyVis: Float32Array; sunVis: Float32Array }) => {
      parts.forEach((m, k) => {
        const light = (m.geometry.getAttribute('aSHr') as InterleavedBufferAttribute).data, a = light.array as Float32Array, o = offsets[k], n = m.geometry.getAttribute('position').count;
        for (let i = 0; i < n; i++) { a.set(r.sh.subarray((o + i) * 12, (o + i) * 12 + 12), i * 14); a[i * 14 + 12] = r.skyVis[o + i]; a[i * 14 + 13] = r.sunVis[o + i]; }
        light.needsUpdate = true;
      });
    };
    b.baked = 'baking';
    const started = performance.now();
    bake(
      { positions, normals, albedo, index, source, scale, masses: b.pack.masses, rays: 16, bounces: 2, workers: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2)),
        lights: { sunDir: [d.x, d.y, d.z], sunE: [S.colour[0] * S.intensity, S.colour[1] * S.intensity, S.colour[2] * S.intensity], sky: { zenith: S.zenith, horizon: S.horizon, ground: S.ground }, points: b.pack.lights } },
      (label, f) => { this.status = `${b.place.name}: ${label.toLowerCase()} ${Math.round(f * 100)}%`; },
      apply,
    ).then((r) => { apply(r); b.baked = 'done'; this.status = `${b.place.name} stands in the world, its light baked in ${((performance.now() - started) / 1000).toFixed(0)} s.`; })
      .catch((e) => { console.error(e); b.baked = 'failed'; this.status = `${b.place.name} stands in the world; its light could not be baked.`; })
      // (Its light final, the house's meshes go to the card as the rest went, unless the place was let go of meanwhile.)
      .finally(() => { if (this.built.get(b.spec) !== b) return; for (const m of parts) { delete m.userData.packed; this.toCard(m); } });
  }

  /** Lets a place go: its meshes, its solid part, its hole. (It is built again if one comes back.) */
  private letGo(spec: string, b: Built): void {
    for (const m of b.meshes) { this.o.scene.remove(m); (m as Mesh).geometry?.dispose(); }
    if (b.life) for (const o of [b.life.birds?.mesh, b.life.flocks?.group, b.life.flames, b.life.beacon?.group, b.life.fireflies?.mesh]) if (o) this.o.scene.remove(o);
    if (b.play) {
      this.o.scene.remove(b.play.group);
      const blockers = this.player?.blockers;
      if (blockers) for (const k of b.play.proxy.blockers) { const i = blockers.indexOf(k); if (i >= 0) blockers.splice(i, 1); }
    }
    const k = this.o.colliders.others.indexOf(b.bvh);
    if (k >= 0) this.o.colliders.others.splice(k, 1);
    this.built.delete(spec);
    this.asked.delete(spec);
    WorldPlaces.gone.register(b.pack, spec);
    this.lamps();
    this.onHoles?.(b.pack.hole);
    // (Its sea goes with it; another standing place's, if there is one, is drawn instead.)
    if (b.pack.sea) this.onSea?.([...this.built.values()].find((o) => o.pack.sea && o.todo.length === 0)?.pack.sea ?? null);
  }

  /** For scripts: what stands, and how. */
  report(): { spec: string; name: string; meshes: number; todo: number; baked: string; triangles: number; hole: { cx: number; cz: number; hx: number; hz: number } }[] {
    return [...this.built.values()].map((b) => ({ spec: b.spec, name: b.place.name, meshes: b.meshes.length, todo: b.todo.length, baked: b.baked, triangles: b.pack.triangles, hole: { cx: b.pack.hole.cx, cz: b.pack.hole.cz, hx: b.pack.hole.hx, hz: b.pack.hole.hz } }));
  }
}
