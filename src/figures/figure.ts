import { AnimationAction, AnimationClip, AnimationMixer, Group, LoopOnce, LoopRepeat, Vector2, Vector3 } from 'three';
import { Player, type Colliders } from '../app/player';
import { type Move, type Rigged, travelAt } from './library';
import { RUN, SPRINT, strideOf } from './gait';
import type { Route } from './nav';

/**
 * A figure: a body that can be steered or sent somewhere, carried by the game's own body (`Player`: its capsule, its weight, the steps it
 * climbs) and drawn by a rigged model playing the clips of `library.ts`.
 *
 * Going about, the model plays a blend of idle, walk, run and sprint (or crouched idle and walk) weighted by how fast the body really
 * goes, and every gait is kept at the same point of its stride and played at the rate that makes its feet keep pace with the ground:
 * the figure's speed over the length of a stride. So feet do not slide whatever the speed, and a walk gathers into a run without a
 * stumble. Off its feet it plays a jump or a fall, then lands. Anything else (sitting on a seat, lying down on a bedroll and getting up,
 * climbing onto a ledge, a roll, any clip at all) is a state of its own, which the figure leaves when it is moved again.
 *
 * Forward is +z in the model's frame: a figure facing `facing` looks along (sin facing, 0, cos facing).
 */

/** How fast a figure goes at each pace, metres a second: a run and a sprint at the speeds their gaits are made for (`gait.ts`). */
export const PACES = { walk: 1.3, run: RUN.speed, sprint: SPRINT.speed, crouch: 0.9 };
export type Pace = 'walk' | 'run' | 'sprint';

/**
 * The gaits: their clip, and the ground it covers in one cycle (two steps) at the mannequin's size. The walk's and the crouched walk's
 * measured in the packs' clips with their root moving (`UAL1_Standard_RM.glb`): what the walk covers in its 1.33 seconds. The run and
 * the sprint are made, not the packs' (whose jog and sprint loped and crouched, and looked silly: see `gait.ts`), and cover what their
 * feet do.
 */
const GAITS = {
  idle: { clip: 'Idle_Loop', stride: 0 },
  walk: { clip: 'Walk_Loop', stride: 1.3 },
  run: { clip: RUN.name, stride: strideOf(RUN) },
  sprint: { clip: SPRINT.name, stride: strideOf(SPRINT) },
  crouchIdle: { clip: 'Crouch_Idle_Loop', stride: 0 },
  crouchWalk: { clip: 'Crouch_Fwd_Loop', stride: 1.5 },
} as const;
type Gait = keyof typeof GAITS;
const GAIT_CLIPS = new Set<string>(Object.values(GAITS).map((g) => g.clip));

/** What the figure is doing. */
export type FigureState = 'ground' | 'air' | 'land' | 'act' | 'align' | 'sitting' | 'seated' | 'rising' | 'lyingDown' | 'asleep' | 'gettingUp' | 'climb';

/** What a figure needs to know of the place it is in. */
export interface FigureWorld {
  colliders: Colliders;
  /** The height of the highest thing solid under (`x`, `z`) and below `top`, or null where there is nothing. */
  heightAt(x: number, z: number, top: number): number | null;
  /** A way from where a figure stands to where it is sent (`nav.ts`); without one, it goes straight. */
  route?(from: Vector3, to: Vector3): Route | null;
}

/** Somewhere to sit or lie: where the feet go, and which way the figure faces there. A bedroll's figure lies with its head behind it. */
export interface Spot { feet: Vector3; facing: number; lift?: number }

/** Being sent somewhere: the way there (each point in turn), how fast, how near is there, and what to do on arrival. */
interface Order { path: Vector3[]; at: number; pace: number; near: number; then: (() => void) | null; best: number; since: number; hopped: number }

/**
 * The climb onto a ledge (`ClimbUp_1m_RM`) is a vault from a run: it starts with the ledge's face this far ahead of the feet (where the
 * clip's hand comes down on its edge), rises a metre, and ends 1.68 metres on. Ledges from 0.75 to 1.3 metres are climbed, the clip's
 * rise stretched to fit.
 */
const CLIMB = { clip: 'ClimbUp_1m_RM', reach: 0.72, low: 0.75, high: 1.3, look: 1.15 };

/** The states in which the body is held still, or moved by hand, rather than going by itself. */
const FROZEN = new Set<FigureState>(['align', 'sitting', 'seated', 'rising', 'lyingDown', 'asleep', 'gettingUp', 'climb']);

const FALL_HARD = 7.5; // metres a second downwards at landing, from a fall of some 1.3 metres: a heavy landing
const tmp = new Vector3(), tmp2 = new Vector3();
const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export class Figure {
  /** Stands at the feet, turned to face: what is added to the scene. */
  readonly root = new Group();
  readonly body: Player;
  readonly mixer: AnimationMixer;
  facing = 0;
  state: FigureState = 'ground';
  /** Where the controller wants it to go, metres a second over the ground (x, z): zero to stand. Ignored while an order is followed. */
  readonly want = new Vector2();
  crouched = false;
  /** Shown in the lab: what it is doing in words. */
  doing = 'standing';

  private readonly gaits = new Map<Gait, AnimationAction>();
  private readonly copies = new Map<string, AnimationClip>();
  private readonly special = new Map<AnimationAction, { w: number; to: number; rate: number }>();
  private loco = { w: 1, to: 1, rate: 4 };
  private crouch = 0;
  private phase = 0;
  private stateTime = 0;
  private offGround = 0;
  private fallSpeed = 0;
  private current: AnimationAction | null = null;
  private currentMove: Move | null = null;
  private order: Order | null = null;
  private spot: Spot | null = null;
  private climbFrom = new Vector3();
  private climbRise = 1;
  private climbShift = 0;
  private shown = new Vector3();
  private lift = 0;
  private holdUntil = 0;
  private stay = false;

  constructor(readonly rig: Rigged, private readonly world: FigureWorld, at: Vector3, facing = 0) {
    this.root.add(rig.model);
    this.mixer = new AnimationMixer(rig.model);
    this.body = new Player(null, null, world.colliders);
    this.body.steer = new Vector2();
    this.body.stand(at);
    this.facing = facing;
    this.shown.copy(at);
    for (const [g, d] of Object.entries(GAITS) as [Gait, (typeof GAITS)[Gait]][]) {
      const a = this.mixer.clipAction(this.move(d.clip).clip);
      a.setLoop(LoopRepeat, Infinity);
      // (Walking gaits are put at a point of their stride by hand each frame; the idle plays by itself.)
      if (d.stride) a.timeScale = 0;
      a.play();
      a.setEffectiveWeight(0);
      this.gaits.set(g, a);
    }
    this.place();
  }

  private move(name: string): Move {
    const m = this.rig.moves.get(name);
    if (!m) throw new Error(`no clip ${name}`);
    return m;
  }

  // ------------------------------------------------------------------ what it is told

  /** Moves with the controller: `dir` is the way over the ground (unit or zero), at `pace`. Sending it somewhere is forgotten. */
  drive(dir: Vector2, pace: Pace): void {
    const speed = this.crouched ? PACES.crouch : PACES[pace];
    this.want.copy(dir).multiplyScalar(speed);
    if (dir.lengthSq() > 0) {
      this.order = null;
      this.wake();
    }
  }

  /**
   * Sends it to `to`, at `pace`, by the way the world finds (round what stands in the way, through doors, up stairs, over ledges); `then`
   * is done on arrival, which is within `near` of it. Where `to` cannot be reached it goes as near as it can, and does nothing there.
   * Whether it can get there.
   */
  goTo(to: Vector3, pace: Pace = 'walk', then: (() => void) | null = null, near = 0.1): boolean {
    this.wake();
    const r = this.world.route?.(this.body.position, to);
    const path = r?.points.length ? r.points.map((q) => q.clone()) : [to.clone()];
    // (A way that ends within some half a metre of the place, on its level, gets there: the place for the feet before a seat lies closer
    // to it than the body can come, and is reached as the figure turns to sit.)
    const end = path[path.length - 1], close = Math.hypot(end.x - to.x, end.z - to.z) < Math.max(near, 0.3) + 0.6 && Math.abs(end.y - to.y) < 0.45;
    const reached = !r || r.reached || close;
    this.order = { path, at: 0, pace: this.crouched ? PACES.crouch : PACES[pace], near: reached ? near : 0.3, then: reached ? then : () => { this.doing = 'as near as it could get'; }, best: Infinity, since: 0, hopped: 0 };
    return reached;
  }

  /** Where it is going: the last point of its way. */
  get goal(): Vector3 | null { return this.order ? this.order.path[this.order.path.length - 1] : null; }
  /** The way it is going by, from where it is. */
  get way(): Vector3[] { return this.order ? this.order.path.slice(this.order.at) : []; }

  /** Goes to `spot`, turns to face as it says, and plays `clip` there (`then` instead, if given). */
  doAt(spot: Spot, clip: string, pace: Pace = 'walk', then?: () => void): boolean {
    return this.goTo(spot.feet, pace, () => this.align(spot, then ?? (() => this.play(clip))), 0.3);
  }

  /** Turns where it stands to face `facing`, and plays `clip`. */
  doHere(facing: number, clip: string): void {
    this.wake();
    this.order = null;
    if (this.state !== 'ground') this.toGround(0.2);
    this.align({ feet: this.body.position.clone(), facing }, () => this.play(clip));
  }

  /** Stops whatever it is doing or going to, and stands; or gets up from where it sits or lies. */
  stop(): void {
    this.order = null;
    this.want.set(0, 0);
    if (this.crouched) this.crouched = false;
    if (['seated', 'sitting', 'asleep', 'lyingDown'].includes(this.state)) this.standUp();
    else if (this.state === 'act' || this.state === 'land') this.toGround(0.25);
  }

  /**
   * Goes to a seat and sits on it. (Its feet stand closer to the seat than the body, a post as broad as the figure, can come: it walks
   * up to the seat, and is then set where it is to stand, as it turns.)
   */
  sitOn(seat: Spot, pace: Pace = 'walk'): boolean {
    return this.goTo(seat.feet, pace, () => this.align(seat, 'sitting'), 0.45);
  }

  /** Goes to a bedroll, or any ground, and lies down there, to sleep. */
  lieOn(bed: Spot, pace: Pace = 'walk'): boolean {
    return this.goTo(bed.feet, pace, () => this.align(bed, 'lyingDown'), 0.3);
  }

  /** Gets up from where it sits or lies; or stops what it plays. */
  standUp(): void {
    if (this.state === 'seated' || this.state === 'sitting') this.enter('rising');
    else if (this.state === 'asleep' || this.state === 'lyingDown') this.enter('gettingUp');
    else if (this.state === 'act') this.toGround(0.3);
  }

  /** Jumps; or, facing a ledge it can climb, climbs it. */
  jump(): void {
    if (this.state !== 'ground' || !this.body.grounded) return;
    if (this.climbIfLedge()) return;
    this.body.jump();
    this.enter('air');
    this.show(this.move('Jump_Start'), 0.08, LoopOnce, 0.12);
  }

  toggleCrouch(): void { this.crouched = !this.crouched; }

  /**
   * Plays any clip. A looping one plays until the figure is moved; one played once ends back on its feet, unless it is to `stay` (a fall
   * to the ground). A clip that carries its root along moves the body with it.
   */
  play(name: string, stay = /Death/.test(name)): void {
    if (!this.rig.moves.has(name)) return;
    if (this.state === 'seated' || this.state === 'asleep') return;
    this.order = null;
    const m = this.move(name), loop = /_Loop$/.test(name);
    this.stay = stay;
    this.enter('act');
    this.show(m, 0.2, loop ? LoopRepeat : LoopOnce);
    this.doing = name.replace(/_/g, ' ').replace(/ Loop$/, '').toLowerCase();
  }

  /** Whether it is following an order. */
  get busy(): boolean { return !!this.order; }

  // ------------------------------------------------------------------ each frame

  update(dt: number): void {
    this.stateTime += dt;
    const free = !FROZEN.has(this.state);
    const steer = this.body.steer!;
    steer.set(0, 0);

    switch (this.state) {
      case 'ground': this.onGround(dt, steer); break;
      case 'air': this.inAir(dt, steer); break;
      case 'land':
        if (this.stateTime > this.holdUntil) {
          steer.copy(this.want);
          if (this.want.lengthSq() > 0.01 || this.order || this.stateTime > this.holdUntil + 0.5) this.toGround(0.2);
        }
        break;
      case 'act': this.acting(steer); break;
      case 'align': this.aligning(dt); break;
      // (A seat higher or lower than the clips' raises or lowers the figure as it sits down, and back as it gets up.)
      case 'sitting': this.lift = (this.spot?.lift ?? 0) * Math.min(1, this.stateTime / (this.clipTime() * 0.7)); if (this.done()) { this.show(this.move('Sitting_Idle_Loop'), 0.25, LoopRepeat); this.enter('seated'); } break;
      case 'rising': this.lift = (this.spot?.lift ?? 0) * Math.max(0, 1 - this.stateTime / (this.clipTime() * 0.6)); if (this.done()) { this.lift = 0; this.body.stand(this.body.position, this.facing); this.toGround(0.25); } break;
      case 'lyingDown': this.lift = (this.spot?.lift ?? 0) * Math.min(1, this.stateTime / this.clipTime()); if (this.done()) this.enter('asleep'); break;
      case 'gettingUp': this.lift = (this.spot?.lift ?? 0) * Math.max(0, 1 - this.stateTime / (this.clipTime() * 0.5)); if (this.done()) { this.lift = 0; this.toGround(0.25); } break;
      case 'climb': this.climbing(); break;
      default: break;
    }

    if (free) {
      this.body.update(dt);
    }
    this.blend(dt);
    this.mixer.update(dt);
    this.place(dt);
  }

  // ------------------------------------------------------------------ the states

  private enter(state: FigureState): void {
    this.state = state;
    this.stateTime = 0;
    if (state === 'air') { this.fallSpeed = 0; this.doing = 'in the air'; }
    if (state === 'sitting') { this.doing = 'sitting down'; this.show(this.move('Sitting_Enter'), 0.2, LoopOnce); }
    if (state === 'seated') this.doing = 'sitting';
    if (state === 'rising') { this.doing = 'getting up'; this.show(this.move('Sitting_Exit'), 0.2, LoopOnce); }
    if (state === 'lyingDown') { this.doing = 'lying down'; this.show(this.move('LayToIdle'), 0.25, LoopOnce, undefined, -1); }
    if (state === 'asleep') this.doing = 'asleep';
    if (state === 'gettingUp') { this.doing = 'getting up'; this.show(this.move('LayToIdle'), 0.15, LoopOnce); }
  }

  private toGround(fade: number): void {
    this.state = 'ground';
    this.stateTime = 0;
    this.current = null;
    this.currentMove = null;
    this.loco.to = 1;
    this.loco.rate = 1 / fade;
    for (const s of this.special.values()) { s.to = 0; s.rate = 1 / fade; }
  }

  /** Whether the clip of the present state has played through. */
  private done(): boolean { return this.stateTime >= this.clipTime() - 0.02; }
  private clipTime(): number { return this.current ? this.current.getClip().duration / Math.abs(this.current.timeScale || 1) : 0; }

  /** Moved again while lying, sitting or playing something: the figure gets up first, or stops. */
  private wake(): void {
    if (this.state === 'seated' || this.state === 'asleep') this.standUp();
    else if (this.state === 'act' || this.state === 'land') this.toGround(0.2);
  }

  private onGround(dt: number, steer: Vector2): void {
    const o = this.order;
    if (o) {
      const p = this.body.position;
      // (On to the next point of the way once near enough this one, and on the same floor: a stair can pass under its own top.)
      while (o.at < o.path.length - 1 && Math.hypot(o.path[o.at].x - p.x, o.path[o.at].z - p.z) < 0.45 && Math.abs(o.path[o.at].y - p.y) < 0.7) { o.at++; o.best = Infinity; o.since = 0; }
      const to = o.path[o.at], last = o.at === o.path.length - 1, dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
      if (last && d < o.near) {
        this.order = null;
        o.then?.();
        return;
      }
      // (Slowing to a stop over the last metres, at most as fast as the pace and never so slow that it does not get there.)
      const speed = last ? Math.min(o.pace, Math.max(0.6, d * 1.6)) : o.pace;
      steer.set((dx / d) * speed, (dz / d) * speed);
      // Stopped short by something: a ledge it can climb is climbed, one a little too high to step onto is hopped onto; anything else,
      // it gives up after a while.
      if (d < o.best - 0.05) { o.best = d; o.since = 0; } else o.since += dt;
      if (o.since > 0.3 && this.climbIfLedge(Math.atan2(dx, dz))) return;
      if (o.since > 0.3 && o.hopped < 3 && this.hopIfStep(Math.atan2(dx, dz))) { o.hopped++; o.since = 0; return; }
      if (o.since > 2) { this.order = null; this.doing = 'stuck'; }
    } else steer.copy(this.want);
    if (!this.body.grounded) {
      this.offGround += dt;
      // (Going down a stair the body leaves each step for a moment: it is in the air only with the ground well below it, or for long.)
      const p = this.body.position, below = this.offGround > 0.15 ? this.world.heightAt(p.x, p.z, p.y + 0.05) : null;
      if (this.offGround > 0.15 && (below === null || p.y - below > 0.6 || this.offGround > 0.6)) { this.enter('air'); this.show(this.move('Jump_Loop'), 0.3, LoopRepeat); }
    } else this.offGround = 0;
    const s = Math.hypot(this.body.motion.x, this.body.motion.z);
    if (this.state === 'ground') this.doing = s < 0.2 ? (this.crouched ? 'crouching' : 'standing') : `${this.crouched ? 'creeping' : s < 2.2 ? 'walking' : s < 5.5 ? 'running' : 'sprinting'} ${s.toFixed(1)} m/s`;
  }

  private inAir(dt: number, steer: Vector2): void {
    const o = this.order;
    if (o) {
      const p = this.body.position, to = o.path[o.at], dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz) || 1;
      steer.set((dx / d) * o.pace, (dz / d) * o.pace);
    } else steer.copy(this.want);
    this.fallSpeed = Math.max(this.fallSpeed, -this.body.motion.y);
    // (The jump's own clip is the whole of a hop; a longer time in the air falls into the clip that is held in the air.)
    if (this.current?.getClip().name === 'Jump_Start' && this.stateTime > 0.62) this.show(this.move('Jump_Loop'), 0.35, LoopRepeat);
    if (this.stateTime < 0.05 || !this.body.grounded) return;
    const moving = this.want.lengthSq() > 0.25 || !!this.order;
    if (this.fallSpeed > FALL_HARD) {
      this.enter('land');
      this.holdUntil = 0.55;
      this.doing = 'landing hard';
      this.show(this.move('Jump_Land'), 0.08, LoopOnce);
    } else if (moving) {
      this.toGround(0.15);
    } else {
      this.enter('land');
      this.holdUntil = 0.25;
      this.doing = 'landing';
      this.show(this.move('Jump_Land'), 0.1, LoopOnce, 0.02, 1.5);
    }
    void dt;
  }

  private acting(steer: Vector2): void {
    const a = this.current, m = this.currentMove;
    if (!a || !m) { this.toGround(0.2); return; }
    if (this.want.lengthSq() > 0.01 || this.order) { this.toGround(0.25); return; }
    if (m.travel) {
      // The clip's own travel, as a speed for the body to go at: a roll goes as far as it would, and stops at a wall.
      const t = a.time, h = 1 / 60, f = this.facing;
      travelAt(m.travel, t + h, tmp);
      travelAt(m.travel, Math.max(0, t - h), tmp2);
      const lx = (tmp.x - tmp2.x) / (2 * h) * (t < m.clip.duration ? 1 : 0), lz = (tmp.z - tmp2.z) / (2 * h) * (t < m.clip.duration ? 1 : 0);
      steer.set(lx * Math.cos(f) + lz * Math.sin(f), -lx * Math.sin(f) + lz * Math.cos(f));
    }
    if (a.loop === LoopOnce && this.done() && !this.stay) this.toGround(0.3);
  }

  /** Comes to stand exactly where it sits or lies (or does anything at a spot), facing the right way, before doing so. */
  private align(spot: Spot, then: FigureState | (() => void)): void {
    this.spot = spot;
    this.alignTo = then;
    this.enter('align');
    this.doing = 'turning';
  }
  private alignTo: FigureState | (() => void) = 'sitting';

  private aligning(dt: number): void {
    const s = this.spot!, k = 1 - Math.exp(-dt * 12);
    const turn = angleTo(this.facing, s.facing);
    this.facing += turn * k;
    this.body.position.lerp(s.feet, k);
    if (Math.abs(turn) < 0.05 || this.stateTime > 0.6) {
      this.facing = s.facing;
      this.body.stand(s.feet, this.facing);
      const then = this.alignTo;
      if (typeof then === 'function') { this.toGround(0.1); then(); } else this.enter(then);
    }
  }

  /** Climbs, if there is a ledge of the right height ahead (towards `towards`, or where it faces). Whether it did. */
  private climbIfLedge(towards = this.facing): boolean {
    const p = this.body.position, fx = Math.sin(towards), fz = Math.cos(towards);
    let face = -1, top = 0;
    for (let d = 0.3; d <= CLIMB.look; d += 0.05) {
      const h = this.world.heightAt(p.x + fx * d, p.z + fz * d, p.y + 2.2);
      if (h !== null && h - p.y > 0.45) { face = d; top = h - p.y; break; }
    }
    // (A rock's side is rounded: its height is the highest it rises just beyond where its face begins, not where it first passes the knee.)
    if (face >= 0) for (let d = face; d <= face + 0.5; d += 0.05) {
      const h = this.world.heightAt(p.x + fx * d, p.z + fz * d, p.y + 2.2);
      if (h !== null) top = Math.max(top, h - p.y);
    }
    if (face < 0 || top < CLIMB.low || top > CLIMB.high) return false;
    // (Something to stand on beyond the edge, near enough level with it: on rock, a little up or down.)
    const beyond = this.world.heightAt(p.x + fx * (face + 0.5), p.z + fz * (face + 0.5), p.y + 2.2);
    if (beyond === null || beyond - p.y - top > 0.4 || beyond - p.y - top < -0.35) return false;
    // (Sent somewhere, it goes on there once it has climbed.)
    this.facing = towards;
    this.climbFrom.copy(p);
    this.climbRise = top;
    this.climbShift = face - CLIMB.reach;
    this.enter('climb');
    this.doing = 'climbing';
    this.show(this.move(CLIMB.clip), 0.1, LoopOnce);
    return true;
  }

  /** Hops, if there is a ledge ahead (towards `towards`) too high to step onto and too low to climb. Whether it did. */
  private hopIfStep(towards: number): boolean {
    const p = this.body.position, fx = Math.sin(towards), fz = Math.cos(towards);
    for (let d = 0.3; d <= 0.8; d += 0.05) {
      const h = this.world.heightAt(p.x + fx * d, p.z + fz * d, p.y + 1.6);
      if (h === null || h - p.y < 0.25) continue;
      if (h - p.y > 0.7) return false;
      this.facing = towards;
      this.body.jump();
      this.enter('air');
      this.show(this.move('Jump_Start'), 0.08, LoopOnce, 0.12);
      return true;
    }
    return false;
  }

  private climbing(): void {
    const a = this.current!, m = this.currentMove!, f = this.facing, end = this.done();
    const t = end ? m.clip.duration : Math.min(a.time, m.clip.duration);
    travelAt(m.travel!, t, tmp);
    // (The clip rises a metre; a ledge higher or lower stretches its rise. Too far off the ledge at the start, it closes the gap
    // in its first strides.)
    const along = tmp.z + this.climbShift * Math.min(1, t / 0.2), up = tmp.y * this.climbRise;
    this.body.position.set(this.climbFrom.x + Math.sin(f) * along + Math.cos(f) * tmp.x, this.climbFrom.y + up, this.climbFrom.z + Math.cos(f) * along - Math.sin(f) * tmp.x);
    if (end) {
      this.body.stand(this.body.position, f);
      this.toGround(0.2);
    }
  }

  // ------------------------------------------------------------------ the model

  /**
   * Shows `m` over whatever is shown, fading in over `fade` seconds: from `start` seconds into it, at `rate` (backwards when less than
   * nought, from its end).
   */
  private show(m: Move, fade: number, loop: typeof LoopOnce | typeof LoopRepeat, start?: number, rate = 1): void {
    // (A gait's clip played for itself is a copy, so as not to be the gait's own action, whose weight and time the blend sets.)
    let clip = m.clip;
    if (GAIT_CLIPS.has(clip.name)) {
      let own = this.copies.get(clip.name);
      if (!own) { own = clip.clone(); this.copies.set(clip.name, own); }
      clip = own;
    }
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(loop, loop === LoopOnce ? 1 : Infinity);
    a.clampWhenFinished = true;
    a.timeScale = rate;
    a.time = start ?? (rate < 0 ? m.clip.duration : 0);
    a.play();
    for (const [b, s] of this.special) { s.to = b === a ? 1 : 0; s.rate = 1 / fade; }
    const s = this.special.get(a);
    if (s) { s.to = 1; s.rate = 1 / fade; } else this.special.set(a, { w: 0, to: 1, rate: 1 / fade });
    this.loco.to = 0;
    this.loco.rate = 1 / fade;
    this.current = a;
    this.currentMove = m;
  }

  /** The weights of every clip shown, and where the gaits are in their stride. */
  private blend(dt: number): void {
    const ease = (s: { w: number; to: number; rate: number }) => {
      s.w += Math.sign(s.to - s.w) * Math.min(Math.abs(s.to - s.w), s.rate * dt);
    };
    ease(this.loco);
    let total = this.loco.w;
    for (const [a, s] of this.special) {
      ease(s);
      if (s.w <= 0 && s.to === 0) { a.stop(); this.special.delete(a); continue; }
      total += s.w;
    }
    const norm = total > 0 ? 1 / total : 0;
    for (const [a, s] of this.special) a.setEffectiveWeight(s.w * norm);

    this.crouch += Math.sign((this.crouched ? 1 : 0) - this.crouch) * Math.min(Math.abs((this.crouched ? 1 : 0) - this.crouch), dt * 4);
    const loco = this.loco.w * norm, c = this.crouch;
    const speed = this.state === 'ground' ? Math.hypot(this.body.motion.x, this.body.motion.z) : 0;
    const w = new Map<Gait, number>();
    const { walk, run, sprint } = PACES;
    if (speed < 0.6) { const k = speed / 0.6; w.set('idle', 1 - k); w.set('walk', k); }
    else if (speed < walk) w.set('walk', 1);
    else if (speed < run) { const k = (speed - walk) / (run - walk); w.set('walk', 1 - k); w.set('run', k); }
    else if (speed < sprint) { const k = (speed - run) / (sprint - run); w.set('run', 1 - k); w.set('sprint', k); }
    else w.set('sprint', 1);
    const cw = Math.min(1, speed / 0.4);
    let stride = 0, sum = 0;
    for (const g of Object.keys(GAITS) as Gait[]) {
      const crouchGait = g === 'crouchIdle' || g === 'crouchWalk';
      const own = crouchGait ? (g === 'crouchWalk' ? cw : 1 - cw) * c : (w.get(g) ?? 0) * (1 - c);
      this.gaits.get(g)!.setEffectiveWeight(own * loco);
      if (GAITS[g].stride && own > 0) { stride += own * GAITS[g].stride; sum += own; }
    }
    if (sum > 0 && speed > 0.01) this.phase = (this.phase + (speed * dt) / ((stride / sum) * this.rig.scale)) % 1;
    for (const g of ['walk', 'run', 'sprint', 'crouchWalk'] as Gait[]) {
      const a = this.gaits.get(g)!;
      a.time = this.phase * a.getClip().duration;
    }
  }

  /**
   * Puts the model where the body is, facing the way it goes. Where the body is moved at once rather than going there (lifted up a step,
   * pushed out of a seat it got up from), the model follows over a few hundredths of a second instead of jumping with it; going along
   * steadily it keeps with the body, since it is moved on at the body's speed first.
   */
  private place(dt = 0): void {
    const m = this.body.motion, s = Math.hypot(m.x, m.z);
    if (this.state === 'ground' && s > 0.25) {
      const k = 1 - Math.exp(-dt * (s > 5 ? 7 : 10));
      this.facing += angleTo(this.facing, Math.atan2(m.x, m.z)) * k;
    }
    const p = this.body.position;
    if (FROZEN.has(this.state) || dt === 0) this.shown.copy(p);
    else {
      this.shown.addScaledVector(m, dt).lerp(p, 1 - Math.exp(-dt * 16));
      if (this.shown.distanceToSquared(p) > 1) this.shown.copy(p);
    }
    this.root.position.set(this.shown.x, this.shown.y + this.lift, this.shown.z);
    this.root.rotation.y = this.facing;
  }
}
