import { Group, Vector2, Vector3 } from 'three';
import type { Rider } from './alpine';
import { Horse, HOOF_REST, HORSE_LEGS, type Hoof, type HorseLeg, type HorsePose, mixHorse, restHorsePose, saddlePose } from './horse';

/**
 * A horse going about on its own hooves (asked, after the skiing horse: "continue with crucial missing things like horse regular
 * movement"): standing, walking, trotting, cantering and galloping, steered or sent to a place, carrying a rider or not, over whatever
 * ground is under it.
 *
 * Its gaits are made in code, as its skiing is, on the horse of `horse.ts`, each by how a horse's legs go in it: the order in which
 * the hooves come down and how long each stays down (the walk's four beats, each hoof alone, left hind, left fore, right hind, right
 * fore; the trot's two, the diagonal pairs together with a moment in the air between; the canter's three, on the right lead, left
 * hind, then right hind and left fore together, then right fore, then all in the air; the gallop's four, quick, hind and hind, fore
 * and fore, and a long moment in the air). A hoof on the ground stays where it came down, the body going on over it; off the ground
 * it is lifted and brought forward, its toe tipped down as the leg folds (the fore leg's knee and the hind leg's hock), to come down
 * ahead again. The body rises and falls with each beat, rocks fore and aft in the canter and the gallop, leans into a turn; the head
 * nods with the stride, the neck is stretched lower and longer the faster it goes, the ears go back and the tail goes up. It goes as
 * fast as it is asked, gaining speed and losing it as a horse can, and the gait follows the speed, each held a little past where the
 * next begins so that it does not change back and forth, and faded into the next.
 *
 * Standing, it breathes, swishes its tail now and then, moves its head and flicks its ears, and rests a hind leg on the toe.
 *
 * Its hooves stand on the ground where they are (`HeightAt`), each its own height, and its body is carried at their middle, pitched
 * as the ground under its fore and hind hooves lies; it goes up and down ramps and stairs, but a step up of more than 0.4 a stride
 * ahead (a ledge), a drop of more than 0.6, or a slope steeper than 32 degrees stops it, and it turns where it stands.
 *
 * A rider sits in its saddle (`saddlePose`) holding the reins: sat at the walk and the canter, rising to the trot on one beat of the
 * two, and crouched up out of the saddle at the gallop.
 */

export type HorseGait = 'stand' | 'walk' | 'trot' | 'canter' | 'gallop';
type Going = Exclude<HorseGait, 'stand'>;

const rad = (d: number) => (d * Math.PI) / 180;
const cyc = (p: number) => ((p % 1) + 1) % 1;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A gait: its natural speed and the time of a stride there; how much of the stride each hoof is down, and when it comes down. */
interface Gait {
  speed: number;
  cycle: number;
  duty: number;
  at: Record<HorseLeg, number>;
  /**
   * How high the fore and hind hooves are lifted, and how far their toes are tipped as the legs fold. (A fore leg folded at the knee
   * carries its hoof high, up by the other leg's knee: folded nearly square, the cannon lies forward from the hoof, and lower than
   * that the shoulder could not reach down to the knee.)
   */
  lift: [number, number];
  fold: [number, number];
  /** How far the body rises and falls, and how many times a stride; how far it rocks fore and aft; how far the neck nods. */
  bob: number;
  beats: number;
  rock: number;
  nod: number;
  /** How it carries itself: lower, the neck lowered (stretched out), the head, the ears back, the tail up. */
  carry: { height: number; neck: number; head: number; ears: number; tail: number };
}
export const GAITS: Record<Going, Gait> = {
  walk: {
    speed: 1.7, cycle: 1.1, duty: 0.62, at: { h_l: 0, f_l: 0.25, h_r: 0.5, f_r: 0.75 }, lift: [0.17, 0.1], fold: [rad(55), rad(35)],
    bob: 0.012, beats: 2, rock: rad(0.8), nod: rad(5), carry: { height: -0.01, neck: rad(10), head: rad(5), ears: 0, tail: 0.05 },
  },
  trot: {
    speed: 3.8, cycle: 0.72, duty: 0.4, at: { f_l: 0, h_r: 0, f_r: 0.5, h_l: 0.5 }, lift: [0.36, 0.16], fold: [rad(85), rad(50)],
    bob: 0.035, beats: 2, rock: rad(1), nod: rad(2), carry: { height: -0.03, neck: rad(4), head: rad(12), ears: 0.1, tail: 0.3 },
  },
  canter: {
    speed: 6.5, cycle: 0.62, duty: 0.27, at: { h_l: 0, h_r: 0.2, f_l: 0.2, f_r: 0.38 }, lift: [0.54, 0.18], fold: [rad(90), rad(55)],
    bob: 0.05, beats: 1, rock: rad(5), nod: rad(9), carry: { height: -0.04, neck: rad(14), head: rad(6), ears: 0.2, tail: 0.45 },
  },
  gallop: {
    speed: 12, cycle: 0.46, duty: 0.22, at: { h_l: 0, h_r: 0.1, f_l: 0.34, f_r: 0.44 }, lift: [0.5, 0.22], fold: [rad(100), rad(65)],
    bob: 0.045, beats: 1, rock: rad(5), nod: rad(11), carry: { height: -0.08, neck: rad(28), head: rad(-8), ears: 0.55, tail: 0.8 },
  },
};
/** The longest a hoof's stretch on the ground can be, its leg swept from ahead of the shoulder or hip to behind it. */
const REACH = 0.95;
/** The time of a stride at speed `v` in a gait: a little quicker the faster within it, and no longer than the legs can sweep. */
const cycleAt = (g: Gait, v: number) => Math.min(g.cycle * (g.speed / Math.max(0.3, v)) ** 0.4, REACH / (Math.max(0.3, v) * g.duty));
/** The speeds the gaits change at, going up and coming down. */
const UP: [Going, number][] = [['trot', 2.6], ['canter', 5.0], ['gallop', 9.0]];
const DOWN: [Going, number][] = [['walk', 2.2], ['trot', 4.4], ['canter', 8.2]];
const ORDER: HorseGait[] = ['stand', 'walk', 'trot', 'canter', 'gallop'];

/** Where the ground is under a point, by its x and z, no higher than `top`; null where there is none. */
export type HeightAt = (x: number, z: number, top: number) => number | null;

export class Steed {
  readonly root = new Group();
  readonly horse = new Horse('pair');
  /** Where it stands, which way it faces (radians about the upright from +z towards +x: its left), and how fast it goes. */
  readonly position: Vector3;
  heading: number;
  speed = 0;
  gait: HorseGait = 'stand';
  private rider: Rider | null = null;
  private phase = 0;
  private turning = 0;
  private time = 0;
  private fading: { gait: HorseGait; phase: number; left: number } | null = null;
  private readonly want = { dir: new Vector2(), speed: 0, to: null as Vector3 | null, toSpeed: 0 };
  /** Stopped by ground it cannot go onto; and how long the way straight where it was sent has been shut. */
  blocked = false;
  private stuck = 0;
  /** The pose it was last given (for drivers that check it). */
  last: HorsePose | null = null;

  constructor(private readonly heightAt: HeightAt, at: Vector3, heading = 0) {
    this.position = at.clone();
    this.heading = heading;
    this.horse.model.traverse((o) => { o.castShadow = true; });
    this.root.add(this.horse.model);
    this.update(0);
  }

  /** Puts a rider in its saddle, or takes it off (null). */
  mount(rider: Rider | null): void {
    if (this.rider) this.rider.model.removeFromParent();
    this.rider = rider;
    if (rider) this.horse.saddle.add(rider.model);
    // (Saddled and bridled when ridden.)
    this.horse.setTack(!!rider);
  }
  get ridden(): boolean { return !!this.rider; }

  /** Asked to go in the direction `dir` (on the ground, x and z) at `speed`; no direction, to stop. Any place it was sent to is let go. */
  drive(dir: Vector2, speed: number): void {
    if (dir.lengthSq() > 1e-6) { this.want.dir.copy(dir).normalize(); this.want.speed = speed; this.want.to = null; }
    else if (!this.want.to) this.want.speed = 0;
  }
  /** Sent to a place, at `speed` most of the way, slowing to come in. */
  goTo(p: Vector3, speed: number): void { this.want.to = p.clone(); this.want.toSpeed = speed; this.blocked = false; }
  /** Going somewhere it was sent. */
  get busy(): boolean { return !!this.want.to; }
  get doing(): string {
    const said = { stand: 'Standing', walk: 'Walking', trot: 'Trotting', canter: 'Cantering', gallop: 'Galloping' }[this.gait];
    return this.blocked ? `Stopped: ${this.why}` : said;
  }

  update(dt: number): void {
    this.time += dt;
    // Where it would go, and how fast.
    let dir: Vector2 | null = null, speed = 0;
    if (this.want.to) {
      const d = new Vector2(this.want.to.x - this.position.x, this.want.to.z - this.position.z), far = d.length();
      if (far < 0.6) this.want.to = null;
      // (Coming in, no faster than it can stop in: a gallop comes down through the canter and the trot to a walk.)
      else { dir = d.normalize(); speed = Math.min(this.want.toSpeed, Math.max(1.2, Math.sqrt(2 * 3.5 * far) * 0.8)); }
    } else if (this.want.speed > 0) { dir = this.want.dir; speed = this.want.speed; }
    // Turning towards it: quickly at a walk, more widely the faster it goes; facing well away, it slows almost to a stop to come round.
    let off = 0;
    if (dir) {
      off = wrap(Math.atan2(dir.x, dir.y) - this.heading);
      const most = this.speed < 2.5 ? 2.0 : this.speed < 5 ? 1.3 : this.speed < 9 ? 0.9 : 0.6;
      this.turning = clamp(off * 3, -most, most);
      if (Math.abs(off) > 1.1) speed = Math.min(speed, 0.7);
    } else this.turning *= Math.max(0, 1 - dt * 6);
    this.heading = wrap(this.heading + this.turning * dt);
    this.speed += clamp(speed - this.speed, -4.5 * dt, 2.6 * dt);
    const fwd = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), left = new Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    // Ground it cannot go up stops it: a step up of more than 0.3 within a stride ahead (a ledge), or a slope steeper than 32 degrees
    // (a ramp it can walk, a stair of steps as a house's, but not a wall); or no ground at all.
    // (Stopped, it can still turn where it stands; sent somewhere, it gives up only when the way straight there stays shut.)
    const toward = this.want.to ? Math.hypot(this.want.to.x - this.position.x, this.want.to.z - this.position.z) : Infinity;
    this.blocked = (this.speed > 0.05 || speed > 0) && !this.canGo(fwd, clamp(toward + 0.4, 0.5, 1.9));
    if (this.blocked) {
      this.speed = 0;
      this.stuck = Math.abs(off) < 0.3 ? this.stuck + dt : 0;
      if (this.stuck > 1.2) this.want.to = null;
    } else this.stuck = 0;
    this.position.addScaledVector(fwd, this.speed * dt);
    // The gait the speed asks for, held a little past where the next begins.
    const next = this.gaitFor(this.speed, speed);
    if (next !== this.gait) { this.fading = { gait: this.gait, phase: this.phase, left: 0.35 }; this.gait = next; }
    if (this.gait !== 'stand') this.phase = cyc(this.phase + dt / cycleAt(GAITS[this.gait], this.speed));
    // The pose: the gait's, faded from the last one's; then stood on the ground where its hooves are.
    let a = this.poseOf(this.gait, this.phase);
    if (this.fading) {
      this.fading.left -= dt;
      if (this.fading.gait !== 'stand') this.fading.phase = cyc(this.fading.phase + dt / cycleAt(GAITS[this.fading.gait as Going], Math.max(0.5, this.speed)));
      if (this.fading.left <= 0) this.fading = null;
      else a = mixHorse(this.poseOf(this.fading.gait, this.fading.phase), a, smooth(1 - this.fading.left / 0.35));
    }
    a.roll -= 0.8 * Math.atan((this.speed * this.turning) / 9.81);
    a.neckYaw += 0.3 * this.turning;
    const hooves = a.hooves!, under: number[] = [];
    for (const leg of HORSE_LEGS) {
      const h = hooves[leg], spot = this.position.clone().addScaledVector(left, h.x).addScaledVector(fwd, h.z);
      under.push(this.heightAt(spot.x, spot.z, this.position.y + 0.8) ?? this.position.y);
    }
    const fore = (under[0] + under[1]) / 2, hind = (under[2] + under[3]) / 2;
    this.position.y = (fore + hind) / 2;
    HORSE_LEGS.forEach((leg, i) => { hooves[leg].y += under[i] - this.position.y; });
    a.pitch += Math.atan2(hind - fore, 1.1);
    this.horse.pose(a);
    this.last = a;
    if (this.rider) this.rider.posePose(saddlePose(this.riding()));
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.heading, 0);
    this.root.updateMatrixWorld(true);
    // The reins, from the bit to the rider's hands as they are now.
    if (this.rider) this.horse.setReins(['hand_l', 'hand_r'].map((n) => this.rider!.model.getObjectByName(n)!.getWorldPosition(new Vector3())));
  }

  /**
   * Whether the ground ahead, as far as `reach`, can be gone onto: looked at every 0.2 (closer than a stair's treads, so that no two
   * steps fall between two looks as one high one), no rise of more than 0.4 from one look to the next, no drop of more than 0.6, and
   * no steeper than 32 degrees from where it stands.
   */
  private canGo(fwd: Vector3, reach = 1.9): boolean {
    let was = this.position.y;
    for (let d = 0.5; d <= reach + 1e-6; d += 0.2) {
      // (Looked down at from well over its head: from just over where it stands, a look from inside a block of stone would find the
      // ground under the block.)
      const at = this.position.clone().addScaledVector(fwd, d), y = this.heightAt(at.x, at.z, was + 2.5);
      this.why = y === null ? 'no ground ahead' : y - was > 0.4 ? 'a ledge too high ahead' : was - y > 0.6 ? 'a drop ahead' : Math.abs(y - this.position.y) / d > Math.tan((32 * Math.PI) / 180) ? 'too steep ahead' : '';
      if (this.why) return false;
      was = y!;
    }
    return true;
  }
  /** Why the way ahead was last found shut. */
  why = '';

  private gaitFor(v: number, asked: number): HorseGait {
    if (v < 0.12 && asked === 0) return 'stand';
    let i = Math.max(1, ORDER.indexOf(this.gait));
    for (const [g, at] of UP) if (ORDER.indexOf(g) === i + 1 && v > at) i++;
    for (const [g, at] of DOWN) if (ORDER.indexOf(g) === i - 1 && v < at) i--;
    return ORDER[i];
  }

  /** The pose of a gait at a share of its stride, on level ground. */
  private poseOf(gait: HorseGait, phase: number): HorsePose {
    const a = restHorsePose(), t = this.time;
    const hooves = {} as Record<HorseLeg, Hoof>;
    if (gait === 'stand') {
      // Breathing, the head moving, the ears flicking, the tail swished now and then; a hind leg rested on its toe.
      a.height = -0.02 - 0.006 * (1 + Math.sin(1.3 * t));
      a.roll = rad(1.5);
      a.neck = rad(12) + rad(3) * Math.sin(0.5 * t);
      a.head = rad(6) + rad(5) * Math.sin(0.31 * t);
      a.neckYaw = rad(6) * Math.sin(0.23 * t);
      a.ears = 0.15 + 0.3 * Math.max(0, Math.sin(0.9 * t) * Math.sin(2.3 * t));
      a.tail = 0.05;
      a.tailYaw = 0.45 * Math.sin(2.2 * t) * Math.max(0, Math.sin(0.4 * t)) ** 2;
      for (const leg of HORSE_LEGS) hooves[leg] = { ...HOOF_REST[leg] };
      hooves.h_r = { ...HOOF_REST.h_r, y: 0.035, z: HOOF_REST.h_r.z + 0.08, pitch: rad(28) };
      a.hooves = hooves;
      return a;
    }
    const g = GAITS[gait], cycle = cycleAt(g, Math.max(0.3, this.speed)), stretch = Math.min(REACH, Math.max(0.3, this.speed) * cycle * g.duty);
    for (const leg of HORSE_LEGS) {
      const isFore = leg[0] === 'f', rest = HOOF_REST[leg], p = cyc(phase - g.at[leg]), mid = rest.z + (isFore ? 0.02 : -0.03);
      if (p < g.duty) {
        // Down: where it came down, the body going on over it; the heel lifting as it is about to leave the ground.
        const u = p / g.duty;
        hooves[leg] = { x: rest.x, y: 0, z: mid + stretch / 2 - stretch * u, pitch: rad(9) * smooth((u - 0.8) / 0.2) };
      } else {
        // In the air: lifted and brought forward, the leg folded and the toe tipped down, unfolding to reach ahead and come down.
        const u = (p - g.duty) / (1 - g.duty), up = Math.sin(Math.PI * u);
        hooves[leg] = {
          x: rest.x, y: g.lift[isFore ? 0 : 1] * up ** (isFore ? 0.8 : 1), z: mid - stretch / 2 + stretch * smooth(u),
          pitch: g.fold[isFore ? 0 : 1] * Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 0.8,
        };
      }
    }
    a.hooves = hooves;
    const c = g.carry, beat = 2 * Math.PI * g.beats * (phase - g.duty / 2);
    a.height = c.height - g.bob * Math.cos(beat);
    a.pitch = g.rock * Math.sin(2 * Math.PI * (phase - 0.15));
    a.neck = c.neck + g.nod * Math.sin(beat + 0.6);
    a.head = c.head;
    a.ears = c.ears;
    a.tail = c.tail + 0.08 * Math.sin(beat);
    return a;
  }

  /** What its rider is doing: sat, rising to the trot, crouched at the gallop, leant into the turn with it. */
  private riding() {
    const g = this.gait, lean = clamp(0.8 * Math.atan((this.speed * this.turning) / 9.81) / rad(30), -1, 1);
    const post = g === 'trot' ? Math.max(0, Math.sin(2 * Math.PI * this.phase)) ** 0.7 : 0;
    return { s: lean, ski: 0, tuck: g === 'gallop' ? 0.7 : g === 'canter' ? 0.15 : 0, brake: 0, tall: g === 'walk' || g === 'stand' ? 0.3 : 0, flickL: 0, flickR: 0, reins: 1, post };
  }
}
