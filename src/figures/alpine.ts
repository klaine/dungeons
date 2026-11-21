import { AnimationClip, Object3D, Quaternion, Vector3 } from 'three';
import { SKI_THICK } from './gear';
import { keyed, Poser, qx, qy, qz, rad, type Side, smooth } from './posing';

/**
 * Downhill skiing, and jumps that go with it (asked for: "animations for few different kind of downhill skiing jumps that you see
 * could be chained together with the downhill skiing (off a cliff, off a man made jump/kicker, ..?)"). Made in code on the figures'
 * skeleton as the run is (`posing.ts`), carrying the downhill skis and poles (`gear.ts`).
 *
 * A skier's pose is a handful of numbers (`AlpinePose`): how high the hips are and where; how the pelvis and the chest are turned and
 * leant; the head; each arm's swing and bend; each foot's place, and its ski's turn, pitch and edge; and the whole body turned (a spin
 * about the upright, a flip about its left) and lifted off the snow. The downhill turns are a loop of such poses; each jump a run of
 * them keyed in time, which begins and ends with the turns' own pose where one turn gives way to the next (`linkPose`), so that the
 * jump can be put between turns and the turns go on after it (`AFTER`, and `Figure.play`, which waits for that moment in the turns).
 *
 * - `Ski_Pop`: a hop off a roller or a bump, the everyday jump: a crouch, a spring, the knees drawn up for half a second, a landing
 *   taken in the legs.
 * - `Ski_Kicker`: straight air off a kicker, a built jump: crouched on the ramp, a pop, the knees drawn up in a tuck in the air for well
 *   over a second, the legs let down to land, the landing absorbed.
 * - `Ski_Kicker_360`: off a kicker, a full turn about the upright: the chest wound up the other way on the ramp, let go at the take-off,
 *   the turn made tucked, and the skis straight down the slope again to land.
 * - `Ski_Backflip`: off a kicker, a full turn over backwards: the arms and head thrown back at the take-off, tucked to turn quicker,
 *   opened to land.
 * - `Ski_Cliff_Drop`: off the edge of a drop: slower to the edge, rolled off with a small pop, a long fall laid forward over the skis
 *   with the arms reaching ahead and the eyes on the landing, which is taken low, the hips almost to the boots.
 *
 * Each is played in place, as the turns are: the body's height over the snow is the clip's (a jump goes up and comes down where it
 * began), and the slope, the ramp and the drop are not there.
 */

export interface AlpineArm { swing: number; bend: number; wrist: number; hang: number; inward: number }
export interface AlpineFoot { x: number; z: number; up: number; yaw: number; pitch: number; edge: number }
export interface AlpinePose {
  /** The pelvis's height over the snow (before the lift), and how far it is to the left and forward of where it rests. */
  hips: number;
  hipsX: number;
  hipsZ: number;
  pelvisYaw: number;
  pelvisRoll: number;
  pelvisPitch: number;
  chestYaw: number;
  chestRoll: number;
  lean: number;
  neck: number;
  head: number;
  /** Each arm: swung forward in the chest's frame, the elbow's bend and the wrist's (radians); how far let down from level (degrees); in across the body. */
  arms: Record<Side, AlpineArm>;
  /**
   * Each foot: the ball of the foot `x` to the left and `z` ahead of the hip, `up` over the snow; its ski (fast to the boot) turned to
   * the left by `yaw`, pitched nose down by `pitch`, rolled onto its right edge by `edge`.
   */
  feet: Record<Side, AlpineFoot>;
  /** The whole body turned about the upright (`spin`, to the left) and about its left (`flip`, forward) round its middle, and lifted. */
  spin: number;
  flip: number;
  lift: number;
}

const X = new Vector3(1, 0, 0);
const cyc = (p: number) => ((p % 1) + 1) % 1;

/** Puts the figure in a pose. Gives back how far the legs were stretched, as a share of their length (more than 0.995: not reached). */
export function poseAlpine(P: Poser, a: AlpinePose): number {
  P.begin();
  const turned = a.spin !== 0 || a.flip !== 0, R = turned ? qy(a.spin).multiply(qx(a.flip)) : new Quaternion();
  // (Its middle, which it turns about: a little over the pelvis.)
  const pivot = new Vector3(a.hipsX, a.hips + 0.12, P.pelvisAt.z + a.hipsZ);
  const place = (v: Vector3) => (turned ? v.sub(pivot).applyQuaternion(R).add(pivot) : v).setY(v.y + a.lift);
  const by = (q: Quaternion) => (turned ? R.clone().multiply(q) : q);
  const dPelvis = by(qy(a.pelvisYaw).multiply(qz(a.pelvisRoll)).multiply(qx(a.pelvisPitch)));
  P.pelvis(place(new Vector3(a.hipsX, a.hips, P.pelvisAt.z + a.hipsZ)), dPelvis);
  const chest = (k: number) => by(qy(a.chestYaw * k).multiply(qz(a.chestRoll * k)).multiply(qx(a.lean * (0.8 + 0.2 * k))));
  P.trunk(dPelvis, [chest(0.3), chest(0.65), chest(1)], by(qx(a.neck)), by(qx(a.head)));
  for (const k of ['l', 'r'] as const) P.arm(k, a.arms[k]);
  P.update();
  let stretch = 0;
  for (const k of ['l', 'r'] as const) {
    const L = P.legs[k], f = a.feet[k];
    const ball = new Vector3(f.x, L.ballUp + SKI_THICK + f.up, P.hipZ + f.z);
    let from = L.ankleFromBall.clone();
    if (f.pitch) from = from.applyQuaternion(qx(f.pitch));
    const ankle = place(ball.clone().add(from.applyQuaternion(qy(f.yaw))));
    const toDir = (v: Vector3) => (turned ? v.applyQuaternion(R) : v);
    const hinge = toDir(X.clone().applyQuaternion(qy(f.yaw)));
    const got = P.reachLeg(k, ankle, toDir(P.footDir(k, f.pitch, f.yaw)), toDir(P.toeDir(k, f.pitch, f.yaw)), { hinge, roll: f.edge });
    stretch = Math.max(stretch, got.stretch);
  }
  P.update();
  return stretch;
}

/** A pose `w` of the way from `a` to `b`, every number of it. */
function mix<T>(a: T, b: T, w: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * w) as T;
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(a as object)) out[k] = mix((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], w);
  return out as T;
}
const clonePose = (a: AlpinePose): AlpinePose => mix(a, a, 0);

// ------------------------------------------------------------------ the turns

/** The turns' cycle: a turn to the left, then one to the right, in this many seconds. */
export const TURNS = 2.2;
const lean = rad(34);
/** How far into a turn and which way: up to 1 at the middle of the left one (the first half), down to -1 at the middle of the right. */
const turnOf = (p: number) => Math.sin(2 * Math.PI * p);
/** The skis turned across the slope (to the left, positive), a little after the body leans; and on their edges (left edges down, negative). */
const yawOf = (p: number) => rad(20) * Math.sin(2 * Math.PI * (p - 0.1)), edgeOf = (p: number) => -rad(32) * Math.sin(2 * Math.PI * (p - 0.04));
/** The inside pole's flick to the snow, as a turn begins: the left's just before the left turn, the right's half a cycle on. */
const flick = (k: Side, p: number) => { const d = cyc(p - (k === 'l' ? 0.96 : 0.46) + 0.5) - 0.5; return Math.exp(-((d / 0.055) ** 2)); };

/**
 * The turns at phase `p` of their cycle, the hips `h` high where they are lowest. Sat lower than a skier walking would stand, the knees
 * well bent and the shins pressed forward into the boots, the hips back over the heels and the trunk forward to balance them, the
 * hands ahead; the hips lowest in the turn and rising between, turned a little with the skis and dropped on the inside; the chest
 * square down the slope, tilted back over the outside ski; the feet swung out from under the body, away from the turn, the inside
 * foot a little ahead.
 */
export function turnsPose(p: number, h: number): AlpinePose {
  const s = turnOf(p), y = yawOf(p), r = edgeOf(p);
  const arm = (k: Side): AlpineArm => { const f = flick(k, p); return { swing: rad(32) + lean + rad(14) * f, bend: rad(48), wrist: rad(34) - rad(55) * f, hang: 62, inward: rad(4) * (k === 'l' ? -1 : 1) }; };
  const foot = (k: Side): AlpineFoot => { const sign = k === 'l' ? 1 : -1; return { x: sign * 0.12 - 0.3 * s, z: 0.2 + 0.07 * s * sign, up: 0, yaw: y, pitch: 0, edge: r }; };
  return {
    hips: h + 0.05 * (1 - Math.abs(s)), hipsX: 0, hipsZ: -0.06, pelvisYaw: 0.45 * y, pelvisRoll: -rad(11) * s, pelvisPitch: rad(24),
    chestYaw: -0.1 * y, chestRoll: rad(7) * s, lean, neck: rad(16), head: rad(6), arms: { l: arm('l'), r: arm('r') }, feet: { l: foot('l'), r: foot('r') },
    spin: 0, flip: 0, lift: 0,
  };
}

/** The hips as high as the legs allow in the turns: the highest at which no leg is stretched past 0.85 of its length. */
function turnsHeight(P: Poser): number {
  let h = P.pelvisAt.y;
  const stretchAt = (h2: number) => { let most = 0; for (let i = 0; i < 24; i++) most = Math.max(most, poseAlpine(P, turnsPose(i / 24, h2))); return most; };
  for (let i = 0; i < 300 && stretchAt(h) > 0.85; i++) h -= 0.004;
  return h;
}

/** What was found of a clip made: for checking it. */
export interface AlpineMade {
  clip: AnimationClip;
  /** The most a leg was stretched while on the snow, as a share of its length; how far a foot went into the snow while on it, and how near the snow a ski's ends came while in the air (metres). */
  stretch: number;
  sunk: number;
  clearance: number;
}

/** How far into the snow (negative) or over it the lowest of a foot's ball, its toes, and its ski's tip and tail are, now. */
function skiOver(P: Poser, k: Side, ski = true): number {
  const ball = P.at(`ball_${k}`), toe = P.at(`ball_leaf_${k}`), dir = toe.clone().sub(ball).normalize();
  let low = Math.min(ball.y - 0.015, toe.y - 0.012) - SKI_THICK;
  // (The ski runs on along the toes' line, 0.88 ahead of the ball and 0.8 behind it, its sole a hand under the ball.)
  if (ski) for (const reach of [0.88, -0.8]) low = Math.min(low, ball.y + dir.y * reach - 0.015 - SKI_THICK);
  return low;
}

export function makeDownhillSki(source: Object3D, base: AnimationClip, frames = 64): AlpineMade {
  const P = new Poser(source, base), h0 = turnsHeight(P);
  let stretch = 0, sunk = 0;
  for (let i = 0; i <= frames; i++) {
    const p = i / frames;
    stretch = Math.max(stretch, poseAlpine(P, turnsPose(p, h0)));
    for (const k of ['l', 'r'] as const) sunk = Math.max(sunk, -skiOver(P, k, false));
    P.keep(p * TURNS);
  }
  return { clip: P.clip('Ski_Downhill_Loop', TURNS), stretch, sunk, clearance: Infinity };
}

// ------------------------------------------------------------------ the jumps

/** Which clip goes on after a jump: the turns. */
export const AFTER: Record<string, string> = {};
/** The jumps, in the order they are offered. */
export const JUMPS = ['Ski_Pop', 'Ski_Kicker', 'Ski_Kicker_360', 'Ski_Backflip', 'Ski_Cliff_Drop'] as const;
for (const j of JUMPS) AFTER[j] = 'Ski_Downhill_Loop';
/** A run down the hill with every jump in it, a turn or two between them (`Figure.chain`). */
export const SKI_RUN = ['Ski_Downhill_Loop', 'Ski_Pop', 'Ski_Kicker', 'Ski_Kicker_360', 'Ski_Cliff_Drop', 'Ski_Backflip'];
/**
 * Where in the turns a jump may begin: where one turn gives way to the next, at these shares of their cycle; the jump begins in the
 * turns' pose at the first of them (`linkPose`), and the other is near enough to it, the same turned the other way, to fade across.
 */
export const LINKS = [0, 0.5];
/** The turns' pose where a jump begins and ends. */
const linkPose = (h: number) => turnsPose(LINKS[0], h);

/** The straight run to a jump: skis flat and straight down the slope, the stance and arms of the turns, nothing leant. */
function straightPose(h: number): AlpinePose {
  const a = turnsPose(0.25, h), arm = (k: Side): AlpineArm => ({ ...a.arms[k], swing: rad(32) + lean, wrist: rad(34) });
  return {
    ...a, hips: h + 0.02, pelvisYaw: 0, pelvisRoll: 0, chestYaw: 0, chestRoll: 0, arms: { l: arm('l'), r: arm('r') },
    feet: { l: { x: 0.12, z: 0.2, up: 0, yaw: 0, pitch: 0, edge: 0 }, r: { x: -0.12, z: 0.2, up: 0, yaw: 0, pitch: 0, edge: 0 } },
  };
}

/**
 * A jump: how long it is, when it leaves the snow and meets it again, and its pose at every time, from the straight run's; and, for one
 * that goes off an edge, how fast it goes forward at every time (the figure is carried along by it, and falls where the ground does).
 */
interface JumpPlan {
  length: number;
  off: number;
  on: number;
  pose(t: number, run: AlpinePose): AlpinePose;
  speed?: (t: number) => number;
}
const G = 9.81;
/** The height thrown up between leaving the snow at `off` and meeting it again at `on`: a body's, with nothing but its weight on it. */
const thrown = (t: number, off: number, on: number) => { if (t <= off || t >= on) return 0; const u = t - off, T = on - off; return (G * T * u) / 2 - (G * u * u) / 2; };
const at = (t: number, keys: [number, number][]) => keyed(t, keys, 0, 0);
const deg = (keys: [number, number][]): [number, number][] => keys.map(([t, v]) => [t, rad(v)]);
/** Every number of a pose that is a turn, eased between keys given in degrees. */
const both = (a: AlpinePose, f: (s: Side, arm: AlpineArm, foot: AlpineFoot) => void) => { for (const k of ['l', 'r'] as const) f(k, a.arms[k], a.feet[k]); };

/**
 * The common parts of a jump off the snow: the crouch before it (`down`, how far the hips sink, at `t0`), the spring at `off` and the
 * landing at `on` taken in the legs (`absorb`, how far the hips sink), with the knees drawn up in the air by `tuck` (the feet lifted
 * that far, the hips with them a little) and the skis' tips up a little.
 */
function airborne(a: AlpinePose, t: number, o: { t0: number; off: number; on: number; down: number; tuck: number; absorb: number; recover: number }): AlpinePose {
  const { t0, off, on } = o, mid = (off + on) / 2;
  a.hips += at(t, [[t0 - 0.25, 0], [t0, -o.down], [off, 0.06], [off + 0.12, 0], [on - 0.05, 0.02], [on + 0.12, -o.absorb], [on + o.recover, 0]]);
  const tuck = at(t, [[off, 0], [off + 0.18, o.tuck * 0.8], [mid, o.tuck], [on - 0.2, o.tuck * 0.6], [on - 0.04, 0]]);
  a.hips -= tuck * 0.25;
  both(a, (_k, _arm, f) => { f.up += tuck; f.z += tuck * 0.15; f.pitch += at(t, deg([[off, 0], [off + 0.2, -8], [on - 0.25, -6], [on, 0]])); });
  a.lift = thrown(t, off, on);
  return a;
}

const PLANS: Record<(typeof JUMPS)[number], JumpPlan> = {
  // A hop off a roller: half a second in the air.
  Ski_Pop: {
    length: 2.0, off: 0.72, on: 1.22,
    pose(t, run) {
      const a = airborne(clonePose(run), t, { t0: 0.58, off: 0.72, on: 1.22, down: 0.1, tuck: 0.12, absorb: 0.13, recover: 0.4 });
      both(a, (_k, arm) => { arm.hang += at(t, [[0.7, 0], [0.85, -16], [1.15, -14], [1.4, 0]]); arm.swing += at(t, deg([[0.7, 0], [0.85, 8], [1.3, 0]])); });
      return a;
    },
  },
  // Straight air off a kicker, tucked, well over a second in the air.
  Ski_Kicker: {
    length: 3.2, off: 0.95, on: 2.25,
    pose(t, run) {
      const a = airborne(clonePose(run), t, { t0: 0.78, off: 0.95, on: 2.25, down: 0.09, tuck: 0.3, absorb: 0.18, recover: 0.5 });
      // (The chest coming up a little in the tuck, the arms forward and out for balance.)
      a.lean += at(t, deg([[0.95, 0], [1.2, -8], [2.0, -8], [2.25, 0], [2.4, 6], [2.8, 0]]));
      both(a, (_k, arm) => { arm.hang += at(t, [[0.9, 0], [1.15, -22], [2.0, -20], [2.35, 0]]); arm.swing += at(t, deg([[0.9, 0], [1.1, 16], [2.1, 12], [2.4, 0]])); });
      return a;
    },
  },
  // A full turn about the upright, to the left, wound up the other way on the ramp.
  Ski_Kicker_360: {
    length: 3.4, off: 1.0, on: 2.35,
    pose(t, run) {
      const off = 1.0, on = 2.35;
      const a = airborne(clonePose(run), t, { t0: 0.8, off, on, down: 0.09, tuck: 0.28, absorb: 0.18, recover: 0.5 });
      // The chest wound to the right before the take-off, then leading the turn; the arms in close as it turns.
      a.chestYaw += at(t, deg([[0.45, 0], [0.85, -38], [off, -30], [off + 0.2, 18], [on - 0.3, 10], [on, 0]]));
      a.pelvisYaw += at(t, deg([[0.45, 0], [0.85, -14], [off + 0.15, 6], [on, 0]]));
      both(a, (_k, arm) => { arm.hang += at(t, [[0.9, 0], [off + 0.15, 10], [on - 0.25, 10], [on, 0]]); arm.bend += at(t, deg([[0.9, 0], [off + 0.15, 30], [on - 0.25, 30], [on, 0]])); });
      // (Slow as it leaves the ramp and as it lands, quickest between; the skis straight down the slope again by the landing.)
      const u = Math.min(1, Math.max(0, (t - off) / (on - 0.08 - off)));
      a.spin = u >= 1 ? 0 : 2 * Math.PI * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI) * 0.7);
      return a;
    },
  },
  // A full turn over backwards: thrown back, tucked, opened to land.
  Ski_Backflip: {
    length: 3.8, off: 1.05, on: 2.6,
    pose(t, run) {
      const off = 1.05, on = 2.6;
      const a = airborne(clonePose(run), t, { t0: 0.85, off, on, down: 0.1, tuck: 0.42, absorb: 0.2, recover: 0.55 });
      // The arms swung up and back and the head back at the take-off; the chest up out of its lean while it turns.
      both(a, (_k, arm) => { arm.swing += at(t, deg([[0.85, 0], [off + 0.1, 70], [off + 0.5, 40], [on - 0.3, 10], [on, 0]])); arm.hang += at(t, [[0.85, 0], [off + 0.1, -30], [on - 0.3, -10], [on, 0]]); });
      a.lean += at(t, deg([[0.85, 0], [off + 0.1, -26], [on - 0.35, -14], [on, 0], [on + 0.15, 8], [on + 0.5, 0]]));
      a.head += at(t, deg([[0.85, 0], [off + 0.1, -30], [off + 0.6, -10], [on - 0.2, 10], [on + 0.3, 0]]));
      a.lift = thrown(t, off, on) * 1.15;
      // (Backwards is a negative turn about its left; quicker when tucked, between.)
      const u = Math.min(1, Math.max(0, (t - off) / (on - 0.1 - off)));
      a.flip = u >= 1 ? 0 : -2 * Math.PI * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI) * 0.75);
      return a;
    },
  },
  // Off the edge of a drop: rolled off with a small pop, a long hang laid forward over the skis, taken low. Carried forward three metres
  // a second from the approach until after the landing, so that played near an edge it goes over it (`DROPS`).
  Ski_Cliff_Drop: {
    length: 3.7, off: 1.0, on: 2.45,
    speed: (t) => at(t, [[0.3, 0], [0.7, 3], [2.45, 3], [3.3, 0]]),
    pose(t, run) {
      const off = 1.0, on = 2.45;
      const a = airborne(clonePose(run), t, { t0: 0.85, off, on, down: 0.05, tuck: 0.12, absorb: 0.3, recover: 0.7 });
      // (Not thrown up: dropped. Here, where the snow does not fall away under it, a small lift and a long, slow coming down.)
      a.lift = at(t, [[off, 0], [off + 0.22, 0.3], [off + 0.6, 0.34], [on - 0.45, 0.22], [on, 0]]);
      a.lean += at(t, deg([[0.6, 0], [off, 8], [off + 0.4, 12], [on - 0.2, 6], [on + 0.2, 14], [on + 0.7, 0]]));
      a.head += at(t, deg([[0.6, 0], [off, 20], [on - 0.1, 24], [on + 0.5, 0]]));
      // The arms reaching ahead and out; the skis' tips kept up, the feet a little ahead of the body.
      both(a, (_k, arm, f) => {
        arm.swing += at(t, deg([[0.6, 0], [off + 0.1, 28], [on - 0.1, 30], [on + 0.3, 14], [on + 0.8, 0]]));
        arm.hang += at(t, [[0.6, 0], [off + 0.1, -26], [on, -22], [on + 0.8, 0]]);
        f.z += at(t, [[off, 0], [off + 0.3, 0.12], [on - 0.1, 0.1], [on + 0.3, 0]]);
        f.pitch += at(t, deg([[off, 0], [off + 0.3, -6], [on - 0.5, -3], [on - 0.25, 0]]));
      });
      return a;
    },
  },
};

/**
 * Makes a jump: from the turns' pose where a turn gives way to the next, into the straight run to the jump, the jump, and back into
 * that pose of the turns at its end.
 */
export function makeAlpineJump(source: Object3D, base: AnimationClip, name: (typeof JUMPS)[number], step = 1 / 30): AlpineMade {
  const P = new Poser(source, base), h0 = turnsHeight(P), plan = PLANS[name], link = linkPose(h0), run = straightPose(h0);
  let stretch = 0, sunk = 0, clearance = Infinity, went = 0;
  const travel: number[] = [];
  for (let t = 0; t <= plan.length + 1e-6; t += step) {
    if (plan.speed) { travel.push(went); went += plan.speed(t + step / 2) * step; }
    const w = Math.min(smooth(t / 0.35), smooth((plan.length - t) / 0.45));
    const pose = mix(link, plan.pose(t, run), w);
    // (A turn about the upright or over is not eased into the turns' pose: it is whole by then.)
    pose.spin = plan.pose(t, run).spin;
    pose.flip = plan.pose(t, run).flip;
    const s = poseAlpine(P, pose);
    if (t < plan.off || t > plan.on) {
      stretch = Math.max(stretch, s);
      for (const k of ['l', 'r'] as const) sunk = Math.max(sunk, -skiOver(P, k, false));
    } else if (t > plan.off + 0.12 && t < plan.on - 0.12) for (const k of ['l', 'r'] as const) clearance = Math.min(clearance, skiOver(P, k));
    P.keep(Math.min(t, plan.length));
  }
  return { clip: P.clip(name, plan.length, plan.speed ? travel : undefined), stretch, sunk, clearance };
}

/**
 * Jumps that go off an edge, and how the figure plays one where the ground falls away under it: once its body leaves the ground, the
 * clip is held at `hold` (the hang, laid forward over the skis) while it falls, the clip's own small lift there taken off (`lift`) as the
 * fall is the body's; when it meets the ground again, the clip goes on from `land`. On level ground it plays through, a small hop.
 */
export const DROPS: Record<string, { hold: number; land: number; lift: number }> = {};
{
  const plan = PLANS.Ski_Cliff_Drop, hold = plan.off + 0.45;
  DROPS.Ski_Cliff_Drop = { hold, land: plan.on, lift: plan.pose(hold, turnsPose(0, 0.8)).lift };
}

/** The downhill turns and every jump, made on `source` from its idle's first frame. */
export function makeAlpineClips(source: Object3D, base: AnimationClip): AnimationClip[] {
  return [makeDownhillSki(source, base).clip, ...JUMPS.map((j) => makeAlpineJump(source, base, j).clip)];
}
