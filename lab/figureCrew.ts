// Figures in the building lab: added as buildings are, from the panel, and chosen by clicking them. A chosen figure is given orders from
// a palette over the picture: an order that wants a place (walk there, sit on that, chop that tree, talk to that figure) waits for a
// click on the picture; the others are done at once. Figures find their way round what is set out, through doors, up stairs and onto
// ledges and rocks (`src/figures/nav.ts`), over everything solid the lab has built (`src/figures/solids.ts`, kept up by the lab).
import {
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PerspectiveCamera, Ray, RingGeometry, Scene, SkinnedMesh,
  MeshStandardMaterial, Vector2, Vector3,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Figure, type Pace, type Spot } from '../src/figures/figure';
import { BODIES, FigureLibrary } from '../src/figures/library';
import { Nav } from '../src/figures/nav';
import { Solids } from '../src/figures/solids';

/** An order on the palette: what it is called, and whether it wants a place clicked, and what it does there. */
interface OrderKind {
  id: string;
  label: string;
  group: string;
  /** `point`: done at a place clicked; `here`: done where the figure stands, turned to face a place clicked; `now`: done at once. */
  target: 'point' | 'here' | 'now';
  clip?: string;
  /** How far from the place clicked it stands to do it, metres. */
  reach?: number;
  /** The key that arms it. */
  key?: string;
  note: string;
}

const ORDERS: OrderKind[] = [
  { id: 'walk', label: 'Walk', group: 'Go', target: 'point', key: '1', note: 'Click where to walk to. It finds its way round buildings, through doors, up stairs and onto ledges.' },
  { id: 'run', label: 'Run', group: 'Go', target: 'point', key: '2', note: 'Click where to run to.' },
  { id: 'sneak', label: 'Sneak', group: 'Go', target: 'point', key: '3', note: 'Click where to creep to, crouched.' },
  { id: 'jump', label: 'Jump', group: 'Go', target: 'now', note: 'Jumps where it stands, or climbs a ledge in front of it.' },
  { id: 'sit', label: 'Sit', group: 'Rest', target: 'point', key: '4', note: 'Click something at the height of a seat: a bench, a step, a low wall, a stone.' },
  { id: 'sleep', label: 'Sleep', group: 'Rest', target: 'point', key: '5', note: 'Click where to lie down and sleep.' },
  { id: 'up', label: 'Get up', group: 'Rest', target: 'now', note: 'Gets up from where it sits or lies.' },
  { id: 'use', label: 'Use', group: 'Work', target: 'point', clip: 'Interact', reach: 0.6, key: '6', note: 'Click a door, a latch, anything to be worked by hand.' },
  { id: 'chop', label: 'Chop', group: 'Work', target: 'point', clip: 'TreeChopping_Loop', reach: 0.85, note: 'Click a tree to fell, or a log.' },
  { id: 'plant', label: 'Plant', group: 'Work', target: 'point', clip: 'Farm_PlantSeed', reach: 0.45, note: 'Click the ground to sow.' },
  { id: 'water', label: 'Water', group: 'Work', target: 'point', clip: 'Farm_Watering', reach: 0.7, note: 'Click what to water.' },
  { id: 'harvest', label: 'Reap', group: 'Work', target: 'point', clip: 'Farm_Harvest', reach: 0.6, note: 'Click what to reap.' },
  { id: 'mend', label: 'Mend', group: 'Work', target: 'point', clip: 'Fixing_Kneeling', reach: 0.65, note: 'Click what to mend, kneeling at it.' },
  { id: 'open', label: 'Open', group: 'Work', target: 'point', clip: 'Chest_Open', reach: 0.6, note: 'Click a chest or a box to open.' },
  { id: 'lift', label: 'Lift', group: 'Work', target: 'point', clip: 'PickUp_Table', reach: 0.55, note: 'Click what to pick up.' },
  { id: 'push', label: 'Push', group: 'Work', target: 'point', clip: 'Push_Loop', reach: 0.5, note: 'Click a wall or a load to push against.' },
  { id: 'talk', label: 'Talk', group: 'People', target: 'point', clip: 'Idle_Talking_Loop', reach: 1.1, key: '7', note: 'Click another figure to talk with (it turns to talk back), or a place to talk at.' },
  { id: 'nod', label: 'Nod', group: 'People', target: 'now', clip: 'Yes', note: '' },
  { id: 'no', label: 'No', group: 'People', target: 'now', clip: 'Idle_No_Loop', note: '' },
  { id: 'arms', label: 'Wait', group: 'People', target: 'now', clip: 'Idle_FoldArms_Loop', note: '' },
  { id: 'lantern', label: 'Lantern', group: 'People', target: 'now', clip: 'Idle_Lantern_Loop', note: '' },
  { id: 'dance', label: 'Dance', group: 'People', target: 'now', clip: 'Dance_Loop', note: '' },
  { id: 'punch', label: 'Punch', group: 'Fight', target: 'point', clip: 'Punch_Cross', reach: 0.75, key: '8', note: 'Click a figure to punch (it is hit), or a place.' },
  { id: 'sword', label: 'Sword', group: 'Fight', target: 'point', clip: 'Sword_Regular_Combo', reach: 1.3, note: 'Click a figure to strike at (it blocks), or a place.' },
  { id: 'throw', label: 'Throw', group: 'Fight', target: 'here', clip: 'OverhandThrow', note: 'Click what to throw at: it throws from where it stands.' },
  { id: 'roll', label: 'Roll', group: 'Fight', target: 'here', clip: 'Roll_RM', note: 'Click which way to roll.' },
  { id: 'block', label: 'Block', group: 'Fight', target: 'now', clip: 'Sword_Block', note: '' },
  { id: 'fall', label: 'Fall', group: 'Fight', target: 'now', clip: 'Death01', note: 'Falls down, and stays down until given another order.' },
  // (Played where it stands, with skis and poles to carry: see `src/figures/skiing.ts`.)
  { id: 'skiClassic', label: 'Cross-country', group: 'Ski', target: 'now', clip: 'Ski_Classic_Loop', note: '' },
  { id: 'skiDownhill', label: 'Downhill', group: 'Ski', target: 'now', clip: 'Ski_Downhill_Loop', note: '' },
  { id: 'skiJump', label: 'Ski jump', group: 'Ski', target: 'now', clip: 'Ski_Jump', note: '' },
  { id: 'stop', label: 'Stop', group: '', target: 'now', key: '0', note: '' },
];
const MOVES = new Set(['walk', 'run', 'sneak']);
/** What a figure struck at does, and how long after the blow begins. */
const STRUCK: Record<string, [string, number]> = { Punch_Cross: ['Hit_Chest', 0.35], Sword_Regular_Combo: ['Sword_Block', 0.25], OverhandThrow: ['Hit_Head', 0.75] };

export interface CrewHost {
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  /** Everything solid that the lab has built, kept up by it. */
  solids: Solids;
  /** Where the figures' files are. */
  base: string;
  say(text: string, kind?: 'good' | 'bad' | 'dim', seconds?: number): void;
  /** Figures have been chosen or let go of: the lab lets go of the building it had chosen, and shows the figure on its panel. */
  chosen(): void;
  /** Where the middle of the view meets the ground. */
  viewCentre(): Vector3;
}

interface Kept { kind: string; at: [number, number, number]; facing: number }
const KEPT = 'dungeons.lab.buildings.figures';

const angleOf = (dx: number, dz: number) => Math.atan2(dx, dz);

export class Crew {
  readonly figures: Figure[] = [];
  readonly chosen: Figure[] = [];
  readonly nav: Nav;
  readonly kinds = new Map<Figure, string>();
  /** The order a click on the picture gives the chosen figures. */
  armed: OrderKind = ORDERS[0];
  /** Whether the view goes along with the chosen figure. */
  follow = true;
  private library: Promise<FigureLibrary> | null = null;
  private readonly rings = new Map<Figure, Mesh>();
  private readonly ways = new Map<Figure, Line>();
  private readonly mark: Mesh;
  private markFade = 0;
  private followed = new Vector3();
  private struck: { at: number; who: Figure; by: Figure; clip: string }[] = [];
  private time = 0;
  private keptAt = 0;
  private lastKept = '';
  private turning: { from: Vector3; to: Vector3; target0: Vector3; target1: Vector3; t: number } | null = null;
  readonly palette: HTMLDivElement;
  private hint!: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(private readonly host: CrewHost) {
    this.nav = new Nav(host.solids);
    this.mark = new Mesh(new RingGeometry(0.16, 0.26, 28), new MeshBasicMaterial({ color: 0xf2ead9, transparent: true, opacity: 0, depthWrite: false }));
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.renderOrder = 2;
    host.scene.add(this.mark);
    this.palette = this.makePalette();
  }

  private lib(): Promise<FigureLibrary> {
    if (!this.library) this.library = FigureLibrary.load(this.host.base);
    return this.library;
  }

  get world() {
    const s = this.host.solids;
    return { colliders: s, heightAt: (x: number, z: number, top: number) => s.heightAt(x, z, top), route: (from: Vector3, to: Vector3) => this.nav.route(from, to) };
  }

  // ---------------------------------------------------------------- adding, choosing, taking away

  /** Adds a figure of a kind (`BODIES`), standing at `at` or on the nearest floor to the middle of the view. */
  async add(kind: string, at?: Vector3, facing?: number, choose = true): Promise<Figure> {
    if (!this.figures.length) this.host.say('Bringing the figures in…', 'dim', 4);
    const lib = await this.lib();
    const rig = await lib.body(kind);
    // (Mannequins of one kind are told apart by colour.)
    const same = [...this.kinds.values()].filter((k) => k === kind).length;
    if (same) rig.model.traverse((o) => {
      const m = (o as SkinnedMesh).material as MeshStandardMaterial | undefined;
      if (m && m.name === 'M_Main') { const c = m.clone(); c.color.offsetHSL((same * 0.17) % 1, 0, 0); (o as SkinnedMesh).material = c; }
    });
    const where = at ?? this.freeNear(this.host.viewCentre());
    const toEye = this.host.camera.position.clone().sub(where);
    const f = new Figure(rig, this.world, where, facing ?? angleOf(toEye.x, toEye.z));
    this.host.scene.add(f.root);
    this.figures.push(f);
    this.kinds.set(f, kind);
    if (choose) this.choose([f]);
    this.keep(true);
    return f;
  }

  /** A floor near `p` with room to stand, a little apart from the figures already there. */
  private freeNear(p: Vector3): Vector3 {
    for (let r = 0; r < 12; r += 0.8) {
      for (let k = 0; k < Math.max(1, Math.round(r * 5)); k++) {
        const a = (k / Math.max(1, Math.round(r * 5))) * Math.PI * 2, q = new Vector3(p.x + Math.sin(a) * r, 0, p.z + Math.cos(a) * r);
        const y = this.host.solids.heightAt(q.x, q.z, p.y + 30);
        if (y === null) continue;
        q.y = y;
        if (this.figures.some((f) => f.body.position.distanceTo(q) < 0.9)) continue;
        // (Room over it to stand.)
        const over = this.host.solids.heightAt(q.x, q.z, y + 1.85);
        if (over !== null && over > y + 0.3) continue;
        return q;
      }
    }
    return p.clone();
  }

  remove(f: Figure): void {
    const i = this.figures.indexOf(f);
    if (i < 0) return;
    this.figures.splice(i, 1);
    this.host.scene.remove(f.root);
    this.kinds.delete(f);
    this.forget(f);
    if (this.chosen.includes(f)) this.choose(this.chosen.filter((c) => c !== f));
    this.keep(true);
  }

  private forget(f: Figure): void {
    for (const m of [this.rings.get(f), this.ways.get(f)]) if (m) this.host.scene.remove(m);
    this.rings.delete(f); this.ways.delete(f);
  }

  /** Chooses these figures (none: lets go of them). The view is turned to look down on them from above. */
  choose(list: Figure[], look = true): void {
    const before = this.chosen.length;
    this.chosen.length = 0;
    this.chosen.push(...list);
    for (const f of [...this.rings.keys()]) if (!list.includes(f)) this.forget(f);
    this.palette.hidden = !list.length;
    if (list.length && !MOVES.has(this.armed.id)) this.arm(ORDERS[0]);
    this.refreshPalette();
    if (list.length && look && (!before || list.length === 1)) this.lookDown(list[0]);
    if (list.length) this.followed.copy(list[0].root.position);
    this.host.chosen();
  }

  /** Turns the view, over half a second, to look down on a figure from some sixty degrees above, from the side the view looked from. */
  lookDown(f: Figure): void {
    const c = this.host.controls, cam = this.host.camera, at = f.root.position.clone().add(new Vector3(0, 0.9, 0));
    const away = cam.position.clone().sub(c.target).setY(0);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    const far = Math.min(24, Math.max(13, cam.position.distanceTo(c.target))), up = 1.0;
    const to = at.clone().addScaledVector(away, far * Math.cos(up)).add(new Vector3(0, far * Math.sin(up), 0));
    this.turning = { from: cam.position.clone(), to, target0: c.target.clone(), target1: at, t: 0 };
  }

  /** The figure a ray from the eye meets first (taken as a post as tall as it is where it stands), and how far along the ray. */
  figureAt(ray: Ray): { figure: Figure; far: number } | null {
    let best: { figure: Figure; far: number } | null = null;
    for (const f of this.figures) {
      const a = f.root.position, b = a.clone().add(new Vector3(0, 1.75 * f.rig.scale, 0)), onRay = new Vector3(), onPost = new Vector3();
      const d2 = ray.distanceSqToSegment(a, b, onRay, onPost), far = onRay.distanceTo(ray.origin);
      if (d2 < 0.38 * 0.38 && (!best || far < best.far)) best = { figure: f, far };
    }
    return best;
  }

  /** Stands a figure on the floor nearest `p`: for moving one by hand. */
  put(f: Figure, p: Vector3): void {
    const y = this.host.solids.heightAt(p.x, p.z, p.y + 2) ?? p.y;
    f.stop();
    f.body.stand(new Vector3(p.x, y, p.z), 0);
  }

  // ---------------------------------------------------------------- orders

  arm(o: OrderKind): void {
    this.armed = o;
    this.refreshPalette();
  }

  /** Arms an order by its name (`walk`, `sit`, `chop`, …): for drivers. */
  armById(id: string): void { const o = ORDERS.find((x) => x.id === id); if (o) { if (o.target === 'now') this.now(o); else this.arm(o); } }

  /** Takes back an order armed that is not a way of going, back to walking or as it went last. Whether there was one. */
  disarm(): boolean {
    if (MOVES.has(this.armed.id)) return false;
    this.arm(ORDERS.find((x) => x.id === (this.lastMove ?? 'walk')) ?? ORDERS[0]);
    return true;
  }

  /** Gives an order that is done at once, to every figure chosen. */
  private now(o: OrderKind): void {
    for (const f of this.chosen) {
      if (o.id === 'stop') f.stop();
      else if (o.id === 'up') f.standUp();
      else if (o.id === 'jump') { if (f.state !== 'ground') f.stop(); f.jump(); }
      else if (o.clip) { if (['seated', 'asleep'].includes(f.state)) f.stop(); f.play(o.clip); }
    }
  }

  /** The armed order (or, with `move`, the way of going armed or walking), carried out by the chosen figures at what the ray meets. */
  orderAt(ray: Ray, move = false): boolean {
    if (!this.chosen.length) return false;
    const o = move ? (MOVES.has(this.armed.id) ? this.armed : ORDERS[0]) : this.armed;
    if (o.target === 'now') return false;
    const other = this.figureAt(ray), hit = this.host.solids.first(ray, 2000);
    const onFigure = other && !this.chosen.includes(other.figure) && (!hit || other.far < hit.distance + 0.5) ? other.figure : null;
    const point = onFigure ? onFigure.body.position.clone() : hit?.point;
    if (!point) return false;
    this.mark.position.copy(point).add(new Vector3(0, 0.03, 0));
    this.markFade = 1.6;
    const many = this.chosen.length, pace: Pace = o.id === 'run' ? 'run' : 'walk';
    let could = 0;
    this.chosen.forEach((f, i) => {
      // (Several sent together go each to its own place about the point, in a ring, not all to the one point.)
      const ring = (r: number) => { if (many === 1) return point.clone(); const a = (i / many) * Math.PI * 2; return point.clone().add(new Vector3(Math.sin(a) * r, 0, Math.cos(a) * r)); };
      if (['seated', 'asleep', 'act'].includes(f.state) || f.crouched !== (o.id === 'sneak')) { f.stop(); f.crouched = o.id === 'sneak'; }
      if (MOVES.has(o.id)) { if (f.goTo(ring(0.5 + many * 0.15), pace)) could++; return; }
      if (o.id === 'sleep') { const p = ring(1.0); if (f.lieOn({ feet: p, facing: this.facingTo(f, p), lift: 0 }, pace)) could++; return; }
      if (o.id === 'sit') { if (this.sit(f, point, i - (many - 1) / 2)) could++; return; }
      if (o.target === 'here') { const p = f.body.position; f.doHere(angleOf(point.x - p.x, point.z - p.z), o.clip!); could++; return; }
      // Done at the place: stood short of it by the order's reach, facing it; several spread about it.
      const from = f.body.position, toward = new Vector3(from.x - point.x, 0, from.z - point.z);
      if (toward.lengthSq() < 1e-4) toward.set(0, 0, 1);
      const a = angleOf(toward.x, toward.z) + (many > 1 ? (i - (many - 1) / 2) * 0.7 : 0), reach = (o.reach ?? 0.6) * f.rig.scale;
      const stand = new Vector3(point.x + Math.sin(a) * reach, point.y, point.z + Math.cos(a) * reach);
      const ground = this.host.solids.heightAt(stand.x, stand.z, Math.max(point.y, from.y) + 1.2);
      if (ground !== null) stand.y = ground;
      const spot: Spot = { feet: stand, facing: angleOf(point.x - stand.x, point.z - stand.z) };
      const then = onFigure ? () => this.atFigure(f, onFigure, o) : undefined;
      if (f.doAt(spot, o.clip!, pace, then)) could++;
    });
    if (!could) this.host.say(`${many > 1 ? 'They' : 'It'} cannot get there, and ${many > 1 ? 'go' : 'goes'} as near as ${many > 1 ? 'they' : 'it'} can`, 'bad', 4);
    // (Ways of going stay armed; anything else is done once, and then clicks walk again.)
    if (!MOVES.has(o.id) && !move) this.arm(ORDERS.find((x) => MOVES.has(x.id) && x.id === (this.lastMove ?? 'walk')) ?? ORDERS[0]);
    else if (MOVES.has(o.id)) this.lastMove = o.id;
    return true;
  }
  private lastMove: string | null = null;

  /** What a figure does on coming up to another it was sent to: talks with it, or strikes at it. */
  private atFigure(f: Figure, other: Figure, o: OrderKind): void {
    f.play(o.clip!);
    const p = other.body.position, q = f.body.position;
    if (o.id === 'talk') { if (!['seated', 'asleep'].includes(other.state)) other.doHere(angleOf(q.x - p.x, q.z - p.z), 'Idle_Talking_Loop'); return; }
    const s = STRUCK[o.clip!];
    if (s) this.struck.push({ at: this.time + s[1], who: other, by: f, clip: s[0] });
  }

  /**
   * Sits on what is at `point`, if it is at the height of a seat over a floor beside it: the figure stands with its back to it, on that
   * floor, on the side it comes from where it can. `shift` moves it along the seat, for several sitting on one.
   */
  private sit(f: Figure, point: Vector3, shift: number): boolean {
    const s = this.host.solids, from = f.body.position, u = new Vector2(from.x - point.x, from.z - point.z);
    if (u.lengthSq() < 1e-4) u.set(0, 1);
    u.normalize();
    const back = 0.31 * f.rig.scale;
    for (const turn of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2, Math.PI]) {
      const c = Math.cos(turn), sn = Math.sin(turn), dx = u.x * c - u.y * sn, dz = u.x * sn + u.y * c;
      const along = new Vector2(-dz, dx).multiplyScalar(shift * 0.7);
      const seat = new Vector3(point.x + along.x, point.y, point.z + along.y);
      const top = s.heightAt(seat.x, seat.z, point.y + 0.3);
      if (top === null || Math.abs(top - point.y) > 0.25) continue;
      const feet = new Vector3(seat.x + dx * back, 0, seat.z + dz * back);
      const ground = s.heightAt(feet.x, feet.z, top - 0.15);
      if (ground === null) continue;
      const high = top - ground;
      if (high < 0.32 || high > 0.62) continue;
      // (Room to stand where the feet go.)
      const over = s.heightAt(feet.x, feet.z, ground + 1.8);
      if (over !== null && over > ground + 0.1) continue;
      feet.y = ground;
      // (The clips sit on a seat 0.45 high; a higher or lower one raises or lowers the figure as it sits.)
      return f.sitOn({ feet, facing: angleOf(dx, dz), lift: Math.max(-0.1, Math.min(0.14, high - 0.45 * f.rig.scale)) });
    }
    this.host.say('Nothing to sit on there: click a bench, a step, a low wall or a stone at the height of a seat', 'bad', 5);
    return false;
  }

  private facingTo(f: Figure, p: Vector3): number { const q = f.body.position; return angleOf(p.x - q.x, p.z - q.z); }

  // ---------------------------------------------------------------- each frame

  update(dt: number): void {
    this.time += dt;
    for (const f of this.figures) f.update(dt);
    for (const s of this.struck.filter((x) => x.at <= this.time)) {
      const p = s.who.body.position, q = s.by.body.position;
      if (!['seated', 'asleep'].includes(s.who.state)) s.who.doHere(angleOf(q.x - p.x, q.z - p.z), s.clip);
    }
    this.struck = this.struck.filter((x) => x.at > this.time);
    // The ring under each figure chosen, and the way it is going by.
    for (const f of this.chosen) {
      let ring = this.rings.get(f);
      if (!ring) {
        ring = new Mesh(new RingGeometry(0.42, 0.5, 40), new MeshBasicMaterial({ color: 0xe0b070, transparent: true, opacity: 0.9, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2;
        this.host.scene.add(ring); this.rings.set(f, ring);
      }
      ring.position.copy(f.root.position).add(new Vector3(0, 0.04, 0));
      // (Seen from far off, larger, so that it can still be found.)
      ring.scale.setScalar(Math.max(1, this.host.camera.position.distanceTo(ring.position) / 18));
      const way = f.way;
      let line = this.ways.get(f);
      if (way.length) {
        if (!line) { line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xf2ead9, transparent: true, opacity: 0.75, depthTest: false })); line.renderOrder = 3; line.frustumCulled = false; this.host.scene.add(line); this.ways.set(f, line); }
        const pts = [f.root.position, ...way].flatMap((p) => [p.x, p.y + 0.06, p.z]);
        line.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
        line.visible = true;
      } else if (line) line.visible = false;
    }
    this.markFade = Math.max(0, this.markFade - dt);
    (this.mark.material as MeshBasicMaterial).opacity = Math.min(1, this.markFade) * 0.9;
    this.mark.visible = this.markFade > 0;
    this.mark.scale.setScalar(Math.max(1, this.host.camera.position.distanceTo(this.mark.position) / 14));
    // The view: turned to look down, then going along with the figure chosen first.
    const c = this.host.controls, cam = this.host.camera;
    if (this.turning) {
      const t = (this.turning.t = Math.min(1, this.turning.t + dt / 0.6)), k = t * t * (3 - 2 * t);
      cam.position.lerpVectors(this.turning.from, this.turning.to, k);
      c.target.lerpVectors(this.turning.target0, this.turning.target1, k);
      if (t >= 1) this.turning = null;
      if (this.chosen[0]) this.followed.copy(this.chosen[0].root.position);
    } else if (this.chosen.length && this.follow) {
      const p = this.chosen[0].root.position, d = p.clone().sub(this.followed);
      if (d.lengthSq() < 25) { cam.position.add(d); c.target.add(d); }
      this.followed.copy(p);
    }
    if (this.time - this.keptAt > 3) this.keep();
    this.refreshHint();
  }

  // ---------------------------------------------------------------- kept in the browser

  /** Keeps what figures there are and where they stand, now (`force`) or when anything has changed. */
  keep(force = false): void {
    this.keptAt = this.time;
    const list: Kept[] = this.figures.map((f) => ({ kind: this.kinds.get(f)!, at: f.body.position.toArray().map((v) => Math.round(v * 100) / 100) as [number, number, number], facing: Math.round(f.facing * 100) / 100 }));
    const s = JSON.stringify(list);
    if (!force && s === this.lastKept) return;
    this.lastKept = s;
    try { localStorage.setItem(KEPT, s); } catch { /* storage refused */ }
  }

  /** The figures kept last time, if any were. */
  static kept(): Kept[] | null {
    try { const v = JSON.parse(localStorage.getItem(KEPT) ?? 'null'); return Array.isArray(v) ? v.filter((k) => BODIES.some((b) => b.id === k.kind) && Array.isArray(k.at)) : null; } catch { return null; }
  }

  async bringBack(list: Kept[]): Promise<void> {
    for (const k of list) await this.add(k.kind, new Vector3(...k.at), k.facing, false);
  }

  // ---------------------------------------------------------------- the palette

  private makePalette(): HTMLDivElement {
    const box = document.createElement('div');
    box.id = 'orders';
    box.hidden = true;
    const groups = new Map<string, HTMLDivElement>();
    const rows = document.createElement('div');
    rows.className = 'groups';
    box.appendChild(rows);
    for (const o of ORDERS) {
      let g = groups.get(o.group);
      if (!g) {
        g = document.createElement('div');
        g.className = 'group';
        if (o.group) { const h = document.createElement('span'); h.className = 'label'; h.textContent = o.group; g.appendChild(h); }
        rows.appendChild(g);
        groups.set(o.group, g);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      if (o.key) { const k = document.createElement('kbd'); k.textContent = o.key; b.appendChild(k); }
      b.title = o.note || o.label;
      if (o.target === 'now') b.classList.add('now');
      b.addEventListener('click', () => { if (o.target === 'now') this.now(o); else this.arm(o); b.blur(); });
      g.appendChild(b);
      this.buttons.set(o.id, b);
    }
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    box.appendChild(this.hint);
    return box;
  }

  private refreshPalette(): void {
    for (const [id, b] of this.buttons) b.classList.toggle('on', id === this.armed.id);
    this.refreshHint(true);
  }

  private hintSaid = '';
  private refreshHint(force = false): void {
    if (!this.chosen.length) return;
    const who = this.chosen.length === 1 ? BODIES.find((b) => b.id === this.kinds.get(this.chosen[0]))?.label ?? 'Figure' : `${this.chosen.length} figures`;
    const doing = this.chosen.length === 1 ? this.chosen[0].doing : this.chosen.map((f) => f.doing.split(' ')[0]).join(', ');
    const text = `${who}: ${doing}. ${this.armed.note}`;
    if (!force && text === this.hintSaid) return;
    this.hintSaid = text;
    this.hint.textContent = text;
  }

  /** Arms the order whose key is `key` (or does it, if it is done at once). Whether there was one. */
  key(key: string): boolean {
    const o = ORDERS.find((x) => x.key === key);
    if (!o || !this.chosen.length) return false;
    if (o.target === 'now') this.now(o); else this.arm(o);
    return true;
  }
}
