import { AnimationClip, AnimationMixer, Bone, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';

/**
 * A run made rather than taken from the packs (asked: "the running animation looks super silly, make a better one"). The packs' only
 * running clips, a jog and a sprint, are keyed in a cartoon's way: the jog sinks the hips a fifth of a metre below standing and bobs
 * them a quarter of a metre a step, swings the hands half a metre ahead, and strides five metres a cycle, so that at a run's pace it
 * goes at some 110 steps a minute, a slow lope; the sprint is the same, crouched. People who run go at 160 to 190 steps a minute.
 *
 * This one is made on the figures' own skeleton, a cycle at a time, from how people run (Novacheck's review, 1998; and what is seen
 * of runners from the side): the foot that bears the body stays where it came down, the leg over it bent at the knee, solved for
 * each instant so that it reaches from the hip to the foot without the foot sliding; the hips lowest a little after the foot comes
 * down and highest in the air between steps, the leap from one foot to the other a true throw, up and down; the heel lifting as the
 * body passes over the foot, until only the ball and the toes are left on the ground; the free leg folding up behind, the heel coming
 * up under the seat, then the thigh driving forward and the shin reaching out to come down a little ahead of the hips. The pelvis
 * turns with the legs and the chest against it, the arms swing against the legs with the elbows bent near a right angle, the trunk
 * leans a little forward and the head stays level. Its stride is whatever the feet cover: `strideOf`.
 *
 * The left foot comes down at `LEFT_DOWN` of the cycle and the right half a cycle later, as in the packs' walk, jog and sprint, so
 * that a walk blends into this run, and this run into the sprint, with the feet in step.
 */
export interface RunStyle {
  /** The clip's name. */
  name: string;
  /** The speed it is made for, in metres a second. */
  speed: number;
  /** Steps a minute. */
  cadence: number;
  /** How far ahead of the hip the ball of the foot comes down, and how far behind it it leaves the ground, in metres. */
  reach: number;
  push: number;
  /** How far the heel is lifted (the foot's pitch) as it leaves the ground, in degrees. */
  heel: number;
  /** How far forward the thigh is at the height of its swing, from upright; and how far the knee is bent as it folds, in degrees. */
  thigh: number;
  knee: number;
  /** How far forward the pelvis and the chest lean, in degrees. */
  tilt: number;
  lean: number;
  /** How far the pelvis turns either way, and the chest against it, in degrees. */
  turn: number;
  chest: number;
  /** How far the upper arm swings either way about where it hangs, a little behind upright; and the elbow's bend, about which it closes and opens. */
  arm: number;
  armBack: number;
  elbow: number;
  elbowSwing: number;
}

/** How far the arms are let down from level, out at the sides as the skeleton rests, to hang a little out from the body, in degrees. */
const HANG = 78;

/** Where in the cycle the left foot comes down. */
export const LEFT_DOWN = 0.05;

export const RUN: RunStyle = {
  name: 'Run_Loop', speed: 4.6, cadence: 178, reach: 0.3, push: 0.35, heel: 45, thigh: 40, knee: 100, tilt: 8, lean: 7,
  turn: 6, chest: 7, arm: 30, armBack: 8, elbow: 82, elbowSwing: 12,
};
export const SPRINT: RunStyle = {
  name: 'RunFast_Loop', speed: 7.0, cadence: 190, reach: 0.3, push: 0.4, heel: 50, thigh: 55, knee: 118, tilt: 11, lean: 11,
  turn: 7, chest: 9, arm: 42, armBack: 10, elbow: 78, elbowSwing: 16,
};

/** How far a cycle (two steps) carries the body: its speed over the time of two steps. */
export const strideOf = (s: RunStyle): number => (s.speed * 120) / s.cadence;

const G = 9.81, rad = (d: number) => (d * Math.PI) / 180;
const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
/** A cubic from (0, a) with slope `da` to (1, b) with slope `db`. */
const hermite = (t: number, a: number, da: number, b: number, db: number) => {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da + (-2 * t3 + 3 * t2) * b + (t3 - t2) * db;
};
/**
 * A smooth curve through keys `[t, value]`, never going past the keys either side of it (each key's slope is the harmonic mean of
 * the slopes to its neighbours, or level where it is a peak or a trough: Fritsch and Carlson's), with the slopes at its ends given.
 */
const keyed = (t: number, keys: [number, number][], start: number, end: number): number => {
  const n = keys.length, slopes = keys.map((_, i) => {
    if (i === 0) return start;
    if (i === n - 1) return end;
    const a = (keys[i][1] - keys[i - 1][1]) / (keys[i][0] - keys[i - 1][0]), b = (keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1], h = t1 - t0;
  return hermite((t - t0) / h, v0, slopes[i] * h, v1, slopes[i + 1] * h);
};

/** What `makeRun` found of the clip it made: for checking it. */
export interface RunMade {
  clip: AnimationClip;
  stride: number;
  /** The hips' height over the ground where the foot comes down; the most the leg was stretched, as a share of its length. */
  hips: number;
  stretch: number;
  /** How far a foot slid while it bore the body, and how near the ground the free foot came, in metres. */
  slide: number;
  clearance: number;
  /** The most the knee bent in the swing, in degrees. */
  kneeMost: number;
}

/**
 * Makes a run of the given style on `model`'s skeleton (the mannequin that the clips are made for), from its pose at rest in `base`
 * (the idle's first frame: arms hanging, hands loose), which is kept for everything the run does not move (the fingers).
 */
export function makeRun(source: Object3D, base: AnimationClip, s: RunStyle, frames = 36): RunMade {
  const model = cloneRigged(source);
  const bone = (n: string) => { const b = model.getObjectByName(n); if (!b) throw new Error(`a figure without ${n}`); return b as Bone; };
  const bones: Bone[] = [];
  model.traverse((o) => { if ((o as Bone).isBone) bones.push(o as Bone); });
  // The base pose is the skeleton as it rests, upright, its feet flat and straight ahead and its arms out level, which is the same on
  // either side (the idle's is not: it stands with its weight on one leg, a foot turned out and a hand ahead of the other), with the
  // arms let down to hang (`HANG`, below) and only the fingers taken from the idle's first frame, loosely curled as a runner's are.
  // Read in the figure's own frame: forward +z, up +y, its left +x.
  model.updateMatrixWorld(true);
  const W0 = new Map(bones.map((b) => [b, b.getWorldQuaternion(new Quaternion())]));
  const basePos = new Map(bones.map((b) => [b, b.position.clone()]));
  const restLocal = new Map(bones.map((b) => [b, b.quaternion.clone()]));
  const mixer = new AnimationMixer(model);
  mixer.clipAction(base).play();
  mixer.update(0);
  const finger = /thumb|index|middle|ring|pinky/;
  const baseLocal = new Map(bones.map((b) => [b, (finger.test(b.name) ? b.quaternion : restLocal.get(b)!).clone()]));
  for (const b of bones) { b.quaternion.copy(restLocal.get(b)!); b.position.copy(basePos.get(b)!); }
  model.updateMatrixWorld(true);
  const P0 = (n: string) => bone(n).getWorldPosition(new Vector3());
  const side = (k: 'l' | 'r') => {
    const hip = P0(`thigh_${k}`), knee = P0(`calf_${k}`), ankle = P0(`foot_${k}`), ball = P0(`ball_${k}`), toe = P0(`ball_leaf_${k}`);
    return {
      k, sign: k === 'l' ? 1 : -1, thighLen: hip.distanceTo(knee), shinLen: knee.distanceTo(ankle),
      dThigh: knee.clone().sub(hip).normalize(), dShin: ankle.clone().sub(knee).normalize(), dFoot: ball.clone().sub(ankle).normalize(), dToe: toe.clone().sub(ball).normalize(),
      // (Where the ankle is from the ball of the foot, standing flat; and how high the ball stands.)
      ankleFromBall: ankle.clone().sub(ball), ballUp: ball.y,
    };
  };
  const legs = [side('l'), side('r')];
  // (Where the foot comes down and leaves is reckoned from the hip joint, over the ground.)
  const pelvisAt = P0('pelvis'), hipZ = P0('thigh_l').z;
  // The foot flat on the ground in the base pose, as the rest pose has it. (Its length from the ankle to the ball.)
  const T = 120 / s.cadence, v = s.speed, stance = (s.reach + s.push) / v, beta = stance / T, flight = T / 2 - stance;
  if (flight <= 0.01) throw new Error(`${s.name}: no time in the air between steps`);
  const vUp = (G * flight) / 2, sink = (vUp * stance) / Math.PI;

  const pelvis = bone('pelvis'), root = pelvis.parent!;
  const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
  const qx = (a: number) => new Quaternion().setFromAxisAngle(X, a), qy = (a: number) => new Quaternion().setFromAxisAngle(Y, a), qz = (a: number) => new Quaternion().setFromAxisAngle(Z, a);
  /** Puts a bone at a rotation in the figure's frame, given its parent's. */
  const setWorld = (b: Object3D, w: Quaternion, parentW: Quaternion) => { b.quaternion.copy(parentW.clone().invert().multiply(w)); };
  const worldOf = (b: Object3D) => b.getWorldQuaternion(new Quaternion());
  /** The rotation that takes a bone's direction in the base pose to `dir`, put before its rotation in the base pose. */
  const aimed = (b: Bone, from: Vector3, dir: Vector3) => new Quaternion().setFromUnitVectors(from, dir.clone().normalize()).multiply(W0.get(b)!);
  const cyc = (p: number) => ((p % 1) + 1) % 1;

  /** The pelvis and everything above it at phase `p`, with the hips at height `h`. */
  const upper = (p: number, h: number) => {
    for (const b of bones) { b.quaternion.copy(baseLocal.get(b)!); b.position.copy(basePos.get(b)!); }
    const c = Math.cos(2 * Math.PI * (p - LEFT_DOWN)), mid = Math.cos(2 * Math.PI * (p - LEFT_DOWN - beta / 2));
    // (Its left side forward as the left foot comes down; dropping on the side of the free leg; a little over the foot that bears it.)
    const dPelvis = qy(-rad(s.turn) * c).multiply(qx(rad(s.tilt))).multiply(qz(rad(3) * mid));
    const at = new Vector3(0.014 * mid, h, pelvisAt.z);
    root.updateMatrixWorld(true);
    pelvis.position.copy(root.worldToLocal(at));
    setWorld(pelvis, dPelvis.clone().multiply(W0.get(pelvis)!), worldOf(root));
    // The chest turned against the pelvis (its right shoulder forward as the left foot comes down), leaning; the head level.
    const chest = (k: number) => qy(rad(s.chest) * c * k).multiply(qx(rad(s.lean) * (0.6 + 0.4 * k)));
    const spines = ['spine_01', 'spine_02', 'spine_03'], dSpine = [chest(0.3), chest(0.65), chest(1)];
    let parentW = dPelvis.clone().multiply(W0.get(pelvis)!);
    spines.forEach((n, i) => { const b = bone(n), w = dSpine[i].clone().multiply(W0.get(b)!); setWorld(b, w, parentW); parentW = w; });
    const dChest = dSpine[2];
    const neck = bone('neck_01'), head = bone('Head'), wNeck = qx(rad(s.lean * 0.4)).multiply(W0.get(neck)!), wHead = qx(rad(2)).multiply(W0.get(head)!);
    setWorld(neck, wNeck, parentW); setWorld(head, wHead, wNeck);
    // The arms: each swinging against the leg on its own side, the elbow bent, closing as the arm comes forward.
    for (const k of ['l', 'r'] as const) {
      const fwd = k === 'r' ? c : -c, sway = Math.cos(2 * Math.PI * (p - LEFT_DOWN - 0.03)) * (k === 'r' ? 1 : -1);
      const clav = bone(`clavicle_${k}`), up = bone(`upperarm_${k}`), low = bone(`lowerarm_${k}`), hand = bone(`hand_${k}`);
      const wClav = dChest.clone().multiply(W0.get(clav)!);
      setWorld(clav, wClav, parentW);
      // The arm let down from level to hang a little out from the side, its palm to the thigh: a turn about the figure's forward. Then
      // swung: forward is a turn about the figure's left, the arm hanging down, a negative one; a little across the body as it comes
      // forward. The elbow bent forward from hanging, and the wrist a little.
      const hang = qz(rad(HANG) * (k === 'l' ? -1 : 1));
      const swing = rad(-s.armBack + s.arm * sway), inward = rad(6) * Math.max(0, sway) * (k === 'l' ? -1 : 1);
      const swung = dChest.clone().multiply(qy(inward)).multiply(qx(-swing));
      const wUp = swung.clone().multiply(hang).multiply(W0.get(up)!);
      setWorld(up, wUp, wClav);
      const bend = rad(s.elbow + s.elbowSwing * fwd), bent = swung.clone().multiply(qx(-bend)), wLow = bent.clone().multiply(hang).multiply(W0.get(low)!);
      setWorld(low, wLow, wUp);
      setWorld(hand, bent.clone().multiply(qx(rad(-8))).multiply(hang).multiply(W0.get(hand)!), wLow);
    }
    model.updateMatrixWorld(true);
  };

  /** A leg put so that its segments point along the given directions (thigh, shin, foot, toes). */
  const putLeg = (L: (typeof legs)[number], dThigh: Vector3, dShin: Vector3, dFoot: Vector3, dToe: Vector3) => {
    const thigh = bone(`thigh_${L.k}`), calf = bone(`calf_${L.k}`), foot = bone(`foot_${L.k}`), ball = bone(`ball_${L.k}`);
    const wT = aimed(thigh, L.dThigh, dThigh), wC = aimed(calf, L.dShin, dShin), wF = aimed(foot, L.dFoot, dFoot), wB = aimed(ball, L.dToe, dToe);
    setWorld(thigh, wT, worldOf(pelvis)); setWorld(calf, wC, wT); setWorld(foot, wF, wC); setWorld(ball, wB, wF);
  };
  const hipOf = (L: (typeof legs)[number]) => bone(`thigh_${L.k}`).getWorldPosition(new Vector3());
  /**
   * The bearing leg, its ball planted at `ballAt` with the heel lifted by `lift`: its knee found so that thigh and shin reach from the
   * hip to the ankle, bent forward. Gives back the thigh's and the knee's angles (forward from upright; how far bent) and how far the
   * leg was stretched, as a share of its length.
   */
  const plant = (L: (typeof legs)[number], ballAt: Vector3, lift: number) => {
    const ankle = ballAt.clone().add(L.ankleFromBall.clone().applyQuaternion(qx(lift)));
    const hip = hipOf(L), d = ankle.clone().sub(hip), len = d.length(), most = (L.thighLen + L.shinLen) * 0.995, reach = Math.min(len, most);
    const u = d.clone().normalize(), w = u.clone().cross(X).normalize();
    const cosA = (L.thighLen ** 2 + reach ** 2 - L.shinLen ** 2) / (2 * L.thighLen * reach), a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const knee = hip.clone().addScaledVector(u, Math.cos(a) * L.thighLen).addScaledVector(w, Math.sin(a) * L.thighLen);
    const end = hip.clone().addScaledVector(u, reach);
    const dT = knee.clone().sub(hip), dS = end.clone().sub(knee);
    const dF = L.ankleFromBall.clone().negate().applyQuaternion(qx(lift));
    // (The toes stay flat on the ground as the heel lifts.)
    putLeg(L, dT, dS, dF, L.dToe.clone());
    const thighA = Math.atan2(dT.z, -dT.y), shinA = Math.atan2(dS.z, -dS.y);
    return { thighA, kneeA: thighA - shinA, stretch: len / (L.thighLen + L.shinLen) };
  };
  /** The free leg, by its thigh's angle forward from upright, the knee's bend, the foot's pitch (heel up) and the toes'. */
  const swingLeg = (L: (typeof legs)[number], thighA: number, kneeA: number, pitch: number, toePitch: number) => {
    const shinA = thighA - kneeA, dT = new Vector3(0, -Math.cos(thighA), Math.sin(thighA)), dS = new Vector3(0, -Math.cos(shinA), Math.sin(shinA));
    const dF = L.ankleFromBall.clone().negate().applyQuaternion(qx(pitch));
    putLeg(L, dT, dS, dF, L.dToe.clone().applyQuaternion(qx(toePitch)));
  };

  /** How high the hips are at phase `p`, for hips `h0` high where a foot comes down: lowest under the bearing foot, thrown between. */
  const hipsAt = (p: number, h0: number) => {
    const t = cyc(p - LEFT_DOWN) % 0.5 * T;
    if (t < stance) return h0 - sink * Math.sin((Math.PI * t) / stance);
    const f = t - stance;
    return h0 + vUp * f - (G * f * f) / 2;
  };
  /** Where a foot is in its cycle: bearing (`u` of the way through) or free (`w` of the way through). */
  const legPhase = (L: (typeof legs)[number], p: number) => {
    const tau = cyc(p - LEFT_DOWN - (L.k === 'r' ? 0.5 : 0));
    return tau < beta ? { bearing: true, u: tau / beta } : { bearing: false, u: (tau - beta) / (1 - beta) };
  };
  /** The heel's lift while the foot bears the body: flat, then rising from a little before the body is over it. */
  const liftAt = (u: number) => rad(s.heel) * smooth((u - 0.42) / 0.58);
  const ballOf = (L: (typeof legs)[number], u: number) => new Vector3(L.sign * 0.078, L.ballUp, hipZ + s.reach - v * u * stance);

  // The hips as high as the legs allow: the leg stretched to no more than its length anywhere under the body.
  let h0 = pelvisAt.y;
  for (let tries = 0; tries < 200; tries++, h0 -= 0.003) {
    let most = 0;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20, p = LEFT_DOWN + u * beta;
      upper(p, hipsAt(p, h0));
      most = Math.max(most, plant(legs[0], ballOf(legs[0], u), liftAt(u)).stretch);
    }
    if (most <= 0.99) break;
  }

  // The bearing leg's angles where the foot comes down and leaves, and how fast they change there, for the free leg to meet them.
  const angles = (u: number) => { const p = LEFT_DOWN + u * beta; upper(p, hipsAt(p, h0)); return plant(legs[0], ballOf(legs[0], u), liftAt(u)); };
  const du = 0.01, swingTime = (1 - beta) * T, stanceTime = beta * T;
  const down = angles(0), down2 = angles(du), off = angles(1), off2 = angles(1 - du);
  const rate = (a: number, b: number) => ((a - b) / (du * stanceTime)) * swingTime;
  const offShin = off.thighA - off.kneeA, downShin = down.thighA - down.kneeA;
  const top = rad(s.thigh), fold = rad(s.knee);
  /**
   * The free leg's angles `w` of the way through its swing: thigh, knee, and the foot's pitch. As runners swing a leg: the thigh, still
   * going back as the foot leaves, comes forward to its height four fifths through and draws back a little to come down; the knee
   * folds at once, the heel coming up under the seat a little before halfway, and stays well bent while the thigh drives forward,
   * opening only in the last fifth to reach out for the ground.
   */
  const swingAt = (w: number) => {
    const thighA = keyed(w, [[0, off.thighA], [0.08, off.thighA - rad(2)], [0.45, (off.thighA + top) * 0.45], [0.8, top], [1, down.thighA]], rate(off.thighA, off2.thighA) * 0.3, rate(down2.thighA, down.thighA) * 0.5);
    // (The first fold quick, a third of the way in a tenth of the swing, so that the foot is off the ground at once and does not trail.)
    const kneeA = keyed(w, [[0, off.kneeA], [0.1, off.kneeA + (fold - off.kneeA) * 0.38], [0.42, fold], [0.62, fold * 0.9], [0.8, fold * 0.68], [1, down.kneeA]], ((fold - off.kneeA) * 0.38) / 0.1, 0);
    // The foot: from the push, easing to hang a little pointed, then flat to come down. (Its pitch heel-up, against the shin's lean.)
    const shinA = thighA - kneeA, pushRel = rad(s.heel) + offShin, landRel = downShin;
    const rel = w < 0.5 ? pushRel + (rad(10) - pushRel) * smooth(w / 0.5) : rad(10) + (landRel - rad(10)) * smooth((w - 0.6) / 0.4);
    return { thighA, kneeA, pitch: -shinA + rel };
  };

  // The frames: every bone's turn, and the hips' place.
  const times: number[] = [], rot = new Map(bones.map((b) => [b, [] as number[]])), hipsPos: number[] = [];
  let slide = 0, clearance = Infinity, kneeMost = 0, stretch = 0;
  const planted = new Map<string, Vector3>();
  for (let i = 0; i <= frames; i++) {
    const p = i / frames;
    upper(p, hipsAt(p, h0));
    for (const L of legs) {
      const lp = legPhase(L, p);
      if (lp.bearing) {
        stretch = Math.max(stretch, plant(L, ballOf(L, lp.u), liftAt(lp.u)).stretch);
      } else {
        const a = swingAt(lp.u);
        kneeMost = Math.max(kneeMost, a.kneeA);
        // (The toes, flat on the ground as the foot left it, come into line with the foot as it lifts.)
        swingLeg(L, a.thighA, a.kneeA, a.pitch, a.pitch * smooth(lp.u / 0.2));
      }
    }
    model.updateMatrixWorld(true);
    // (Checked: the bearing ball where it came down, the ground carried back at the run's speed; the free foot clear of the ground.)
    for (const L of legs) {
      const lp = legPhase(L, p), ballW = bone(`ball_${L.k}`).getWorldPosition(new Vector3());
      if (lp.bearing) {
        const ground = ballW.clone().setZ(ballW.z + v * lp.u * stance), key = `${L.k}`;
        if (lp.u === 0 || !planted.has(key)) planted.set(key, ground);
        slide = Math.max(slide, ground.distanceTo(planted.get(key)!));
      } else if (lp.u > 0.08 && lp.u < 0.92) {
        for (const n of [`ball_${L.k}`, `ball_leaf_${L.k}`, `foot_${L.k}`]) clearance = Math.min(clearance, bone(n).getWorldPosition(new Vector3()).y - (n.startsWith('foot') ? 0.09 : 0));
      }
    }
    times.push(p * T);
    for (const b of bones) rot.get(b)!.push(...b.quaternion.toArray());
    hipsPos.push(...pelvis.position.toArray());
  }
  const tracks = [new VectorKeyframeTrack(`${pelvis.name}.position`, times, hipsPos), ...bones.map((b) => new QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot.get(b)!))];
  return { clip: new AnimationClip(s.name, T, tracks), stride: strideOf(s), hips: h0, stretch, slide, clearance, kneeMost: (kneeMost * 180) / Math.PI };
}
