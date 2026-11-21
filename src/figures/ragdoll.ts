import { Vector3 } from 'three';

/**
 * A body gone limp (asked: "landing badly activates ragdoll physics"): the joints of a figure as loose points, each with its weight,
 * held at the lengths its bones had when it fell by links between them, falling under its weight onto the ground, sliding and
 * tumbling on it until the snow's friction stops it. Stepped by positions (each step moves every point as it was going, then puts the
 * links back to their lengths and the points out of the ground, a few times over, and takes how far each went as its new speed), which
 * keeps steady at any step and with any number of links. What it is drawn with is the figure's own skeleton, put through the points
 * (`Poser.poseJoints`).
 *
 * The trunk is held nearly stiff by links across it (hips to shoulders, shoulder to shoulder, the head to both shoulders), though it may
 * bend a little; arms and legs bend freely at elbows and knees, if never folded quite flat; and each foot is held fast in its boot, with
 * its ski: ankle, ball, knee and the ski's tip and tail one stiff piece, so that a ski lies on the snow as a ski does.
 */

/** The joints, by the names of their bones; and the ski's tip and tail on each foot. */
export const JOINTS = [
  'pelvis', 'spine_03', 'Head',
  'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
  'tip_l', 'tail_l', 'tip_r', 'tail_r',
] as const;
export type Joint = (typeof JOINTS)[number];

/** How far each point stands off the ground at the least: the head and the hips are round, the rest thinner. */
const RADIUS: Partial<Record<Joint, number>> = { Head: 0.11, pelvis: 0.11, spine_03: 0.12, thigh_l: 0.09, thigh_r: 0.09 };
const radiusOf = (j: Joint) => RADIUS[j] ?? (j.startsWith('tip') || j.startsWith('tail') ? 0.02 : 0.06);

interface Link { a: number; b: number; length: number; stiff: number; least: boolean }

/** What the ground is under a point: how far the point is above it (negative, in it) and which way is up from it. */
export type Ground = (p: Vector3) => { above: number; up: Vector3 };

export class Ragdoll {
  readonly points: Vector3[];
  private readonly speeds: Vector3[];
  private readonly links: Link[] = [];
  private stillFor = 0;
  /** How long it has been nearly still; and how long since it fell. */
  get still(): number { return this.stillFor; }
  time = 0;

  /**
   * From where the joints are now and where they were `dt` seconds before (so that it goes on as it was going, turning as it was turning).
   * `friction`: of the body on the ground, against its weight.
   */
  constructor(now: Record<Joint, Vector3>, before: Record<Joint, Vector3>, dt: number, private readonly ground: Ground, private readonly friction = 0.55) {
    this.points = JOINTS.map((j) => now[j].clone());
    this.speeds = JOINTS.map((j) => now[j].clone().sub(before[j]).divideScalar(dt));
    // (Whatever of it is in the ground as it falls, a ski's tip dug in or a hand, the whole lifted out of it first: pushed out point by
    // point in one step, the rest of it was yanked up after them and thrown high into the air.)
    let deepest = 0, up = new Vector3(0, 1, 0);
    JOINTS.forEach((j, n) => { const g0 = ground(this.points[n]), into = radiusOf(j) - g0.above; if (into > deepest) { deepest = into; up = g0.up; } });
    if (deepest > 0) for (const p of this.points) p.addScaledVector(up, deepest);
    const i = (j: Joint) => JOINTS.indexOf(j);
    const link = (a: Joint, b: Joint, stiff = 1, least = false, share = 1) => {
      this.links.push({ a: i(a), b: i(b), length: this.points[i(a)].distanceTo(this.points[i(b)]) * share, stiff, least });
    };
    // The trunk: the spine and the neck, and braced across.
    link('pelvis', 'spine_03'); link('spine_03', 'Head');
    link('upperarm_l', 'upperarm_r'); link('thigh_l', 'thigh_r');
    for (const k of ['l', 'r'] as const) {
      link('spine_03', `upperarm_${k}`); link('pelvis', `thigh_${k}`);
      link('Head', `upperarm_${k}`, 0.6); link('pelvis', `upperarm_${k}`, 0.5); link('spine_03', `thigh_${k}`, 0.5);
    }
    link('upperarm_l', 'thigh_r', 0.3); link('upperarm_r', 'thigh_l', 0.3);
    for (const k of ['l', 'r'] as const) {
      // The limbs, and how near their ends may come (never folded flat).
      link(`upperarm_${k}`, `lowerarm_${k}`); link(`lowerarm_${k}`, `hand_${k}`);
      link(`thigh_${k}`, `calf_${k}`); link(`calf_${k}`, `foot_${k}`);
      const arm = this.points[i(`upperarm_${k}`)].distanceTo(this.points[i(`lowerarm_${k}`)]) + this.points[i(`lowerarm_${k}`)].distanceTo(this.points[i(`hand_${k}`)]);
      const leg = this.points[i(`thigh_${k}`)].distanceTo(this.points[i(`calf_${k}`)]) + this.points[i(`calf_${k}`)].distanceTo(this.points[i(`foot_${k}`)]);
      this.links.push({ a: i(`upperarm_${k}`), b: i(`hand_${k}`), length: arm * 0.35, stiff: 1, least: true });
      this.links.push({ a: i(`thigh_${k}`), b: i(`foot_${k}`), length: leg * 0.4, stiff: 1, least: true });
      // The boot and its ski, one stiff piece with the shin.
      const boot: Joint[] = [`calf_${k}`, `foot_${k}`, `ball_${k}`, `tip_${k}`, `tail_${k}`];
      for (let a = 0; a < boot.length; a++) for (let b = a + 1; b < boot.length; b++) if (!(a === 0 && b === 1)) link(boot[a], boot[b]);
    }
  }

  /** Where joint `j` is now. */
  at(j: Joint): Vector3 { return this.points[JOINTS.indexOf(j)]; }
  /** Every joint, by name. */
  joints(): Record<Joint, Vector3> { return Object.fromEntries(JOINTS.map((j, n) => [j, this.points[n]])) as Record<Joint, Vector3>; }
  /** The middle of the body (its hips). */
  middle(): Vector3 { return this.at('pelvis'); }
  /** How fast its quickest point is going. */
  quickest(): number { return Math.max(...this.speeds.map((v) => v.length())); }

  /** Moves it on by `dt` seconds: its weight, the air, the links, the ground and the ground's friction. */
  step(dt: number, g = 9.81): void {
    const was = this.points.map((p) => p.clone());
    for (let n = 0; n < this.points.length; n++) {
      const v = this.speeds[n];
      v.y -= g * dt;
      v.multiplyScalar(1 - 0.03 * dt);
      this.points[n].addScaledVector(v, dt);
    }
    const d = new Vector3();
    const pushed = new Float32Array(this.points.length);
    for (let pass = 0; pass < 10; pass++) {
      for (const l of this.links) {
        const a = this.points[l.a], b = this.points[l.b];
        d.copy(b).sub(a);
        const len = d.length();
        if (len < 1e-9 || (l.least && len >= l.length)) continue;
        d.multiplyScalar(((len - l.length) / len) * 0.5 * l.stiff);
        a.add(d); b.sub(d);
      }
      JOINTS.forEach((j, n) => {
        const g0 = this.ground(this.points[n]), into = radiusOf(j) - g0.above;
        if (into > 0) { this.points[n].addScaledVector(g0.up, into); pushed[n] += into; }
      });
    }
    // The new speeds, from how far each point went; and where the ground pushed a point out, nothing of that push kept as a speed
    // away from the ground, and its speed along the ground slowed by friction, as hard as it was pushed (its weight, and any blow).
    const along = new Vector3();
    for (let n = 0; n < this.points.length; n++) {
      const v = this.speeds[n].copy(this.points[n]).sub(was[n]).divideScalar(dt);
      if (!pushed[n]) continue;
      const up = this.ground(this.points[n]).up, out = v.dot(up), blow = pushed[n] / dt;
      if (out > 0) v.addScaledVector(up, -Math.min(out, blow));
      along.copy(v).addScaledVector(up, -v.dot(up));
      const sliding = along.length();
      if (sliding > 1e-6) v.addScaledVector(along, -Math.min(1, (this.friction * blow) / sliding));
    }
    this.time += dt;
    this.stillFor = this.quickest() < 0.25 ? this.stillFor + dt : 0;
  }
}
