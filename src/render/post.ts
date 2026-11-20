import {
  CubeTexture, Data3DTexture, DepthTexture, DoubleSide, FloatType, MaterialBlending, Matrix4, MeshBasicMaterial, NearestFilter, Object3D,
  OrthographicCamera, PerspectiveCamera, RedFormat, Scene, UnsignedByteType, Vector3, Vector4, WebGPUCoordinateSystem,
} from 'three';
import { BlendMode, NodeBuilder, NodeMaterial, QuadMesh, RenderTarget, WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/**
 * Draws the scene, then follows each line of sight through the air to add fog that is lit by the
 * sun where the sun reaches. That is what makes shafts of light visible through doors and windows.
 *
 * Two depth maps of the static site are drawn once: one from the sun, to know where its light
 * reaches, and one from straight above, to know where the air is under open sky.
 *
 * The same step makes the sky's weather. Clouds are a layer of air some hundreds of metres up
 * whose thickness at any point is read from a block of noise that drifts with the wind. Looking
 * up, each line of sight is walked through the layer, and at every step a second, shorter walk
 * towards the sun finds how much cloud the light came through: so clouds have lit sides, dark
 * bases and bright edges against the sun. Looking at the land, the same question is asked of the
 * line from each point to the sun, and the answer is the shadow of the cloud passing over it.
 * After dark the stars and the moon are drawn here too, behind the clouds.
 *
 * And it is what gives the land its distance. Fog that is walked through reaches only a stone's
 * throw from the eye; beyond that the air is reckoned, not walked: how much of it lies along
 * each line of sight, thinning with height, and with it how far the land there has faded into
 * the colour of the sky behind it. So one ridge stands paler than the ridge in front, mist
 * lies in the low ground with the hilltops standing out of it, and cloud is in front of
 * whatever it is nearer than, peaks included.
 *
 * All of it is written as a program of nodes, which the renderer turns into whatever its
 * graphics interface wants, WebGPU or WebGL 2.
 */

// (The pieces of shader program used below, taken untyped: see the note in `siteMaterial.ts`.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const {
  Break, Fn, If, Loop, abs, clamp, cubeTexture, dot, exp, float, floor, fract, getScreenPosition, getViewPosition, length, log2, max, min, mix, mrt, normalize,
  output, pass, perspectiveDepthToViewZ, positionPrevious, reflect, velocity, pow, reference, screenCoordinate, screenSize, screenUV, select, sin, smoothstep, sqrt, step, texture, texture3D, uniform,
  uniformArray, uv, vec2, vec3, vec4,
} = TSL as N;

const MAX_LIGHTS = 4;
const STEPS = 40;

export interface FogLight {
  position: Vector3;
  color: Vector3;
}

const one = (x: N): N => float(1).sub(x);

/**
 * The sky's weather and the air at a distance, as pieces of program: what clouds are made of and
 * how a line of sight is walked through them; and how much air lies along a line of sight, and
 * what colour distance takes. They are used where the picture is finished and again where still
 * water mirrors the sky, so that the clouds in a lake are the clouds over it.
 */
export function skyParts(u: Record<string, N>, cloudSteps: number) {
  const phaseHG: N = Fn(([c, g]: [N, N]) => {
    const g2 = g.mul(g);
    return one(g2).div(pow(g2.add(1).sub(g.mul(c).mul(2)), 1.5).mul(12.566));
  });
  const noise = (at: N): N => u.tCloud.sample(at).level(0);

  // How thick the cloud is at a point, as the light lost per metre. Clouds have flat bases and
  // rounded tops, cover as much of the sky as the day calls for, and are frayed at their edges.
  // (`fine`, where given, is how much of the finest fraying to take, 0 to 1: none where the walk's steps are too long to see it, or
  // it only speckles.)
  // (`billow` is how much of the smaller billows to take, 0 to 1: less far off, where only the broad shapes are seen, and where a
  // line of sight grazing the layer caught them at a different place from one point of the picture to the next.)
  // (`edge` is how soft its edge is, as the share of the noise's range over which it goes from none to whole: 0.1 for the cloud as
  // seen, wider for its shadow, which is softened by the sun's breadth and the thin cloud at its rim.)
  // (`weather` is the noise read at the large sizes about the point, from `weatherAt`: it changes only over kilometres, so where the
  // cloud is asked about at several points close together, as for its shadow and the light that reaches into it, it is read once.)
  // Cloud in flat banks is the same cloud drawn out one way, in a layer too thin to heap up. (Read faster upward, so that what there
  // is of the layer's depth has lumps and hollows in its top, and is not a slab.)
  const cloudQ = (p: N): N => p.mul(vec3(mix(1, 0.4, u.uCloudFlat), mix(1, 2.2, u.uCloudFlat), mix(1, 1.2, u.uCloudFlat))).div(1150).add(u.uCloudDrift);
  // The block of noise repeats every kilometre or so, and small heaps showed it, lying in rows towards the horizon, each like the
  // last. So the same noise is read eight times larger as well (`x`): where it is high the heaps gather and stand closer, where it is
  // low the sky opens, and the lesser noise is pushed about by it, so that no two kilometres are laid out alike. And larger still
  // (`y`), for the weather over some kilometres: whether it is for scattered small heaps or great ones alone (see below).
  const weatherAt = (p: N): N => {
    const q0 = cloudQ(p).toVar();
    return vec2(noise(q0.mul(vec3(0.13, 0.4, 0.13)).add(0.71)).r, noise(q0.mul(vec3(0.071, 0.3, 0.071)).add(vec3(0.37, 0.12, 0.83))).g);
  };
  // How high a point stands in the cloud's layer, 0 at its base and 1 at its top. Heaped cloud has its base at one height
  // everywhere, as it does, where the air rising from the ground cools enough to make cloud. Banks are not so: the layer about
  // (`uCloudBase` to `uCloudTop`) holds them, each a little more than half its depth, the base of one lower and of the next higher,
  // rising and falling over a couple of kilometres with the larger noise (`weather.x`); so that a bank lies over one ridge and the
  // next stands higher, and the far range's peaks go into some and stand clear of others. (All at one height, they were slabs.)
  const layerAt = (p: N, weather: N): N => {
    const span = u.uCloudTop.sub(u.uCloudBase), rise = smoothstep(0.3, 0.72, weather.x).mul(u.uCloudFlat).mul(0.45);
    return p.y.sub(u.uCloudBase).sub(span.mul(rise)).div(span.mul(one(u.uCloudFlat.mul(0.45))));
  };
  const cloudOf = (fine: boolean): N => Fn(([p, fineW, billow, edge, weather]: [N, N, N, N, N]) => {
    const thick: N = float(0).toVar();
    const h: N = layerAt(p, weather).toVar();
    If(h.greaterThan(0).and(h.lessThan(1)), () => {
      const q0: N = cloudQ(p).toVar();
      const big: N = weather.x, spread: N = weather.y;
      const q: N = q0.add(vec3(big.sub(0.5).mul(0.9), 0, big.sub(0.5).mul(-0.7))).toVar();
      // Nor are all heaps one size, as when the noise was read at one size alone: the heaps it makes are cells of a lattice, nine to a
      // block, so all were alike and lay in ranks towards the horizon, as on a quilt. So the noise is read again, turned and at less
      // than half the size, and the cloud is wherever either reading has it: lesser heaps, a few hundred metres across, scattered
      // between the great ones and running into them, on lattices that never line up. How many of the lesser stand depends on the
      // weather over some kilometres (`spread`): here fair-weather cumulus dot the sky, there great heaps stand alone with lanes of
      // clear sky between; and how much of the sky is cloud there rises and falls with it too. (The last small number keeps the share
      // of sky covered what it was with one reading, measured over forty kilometres of it.)
      const turned: N = vec3(q.x.mul(0.8).sub(q.z.mul(0.6)), q.y, q.x.mul(0.6).add(q.z.mul(0.8))).mul(2.1).add(vec3(0.41, 0.17, 0.63));
      const lesser: N = noise(turned).r.sub(mix(0.16, 0.03, smoothstep(0.3, 0.75, spread)));
      const shape: N = max(noise(q).r, lesser).add(big.sub(0.5).mul(0.28)).add(spread.sub(0.5).mul(0.24)).add(0.01).toVar();
      // The more of the sky the day gives to cloud, the lower the bar a piece of air must clear to
      // be cloud. The bar rises with height, so a cloud is broad at its flat base and only its
      // strongest parts tower; and nothing hangs below the base.
      // (The numbers are measured from the noise: at its base, cloud covers the share of sky asked for.)
      const bar: N = float(0.535).sub(u.uCloudCover.mul(0.33)).add(pow(h, 1.4).mul(0.26)).add(one(smoothstep(0, 0.07, h)).mul(0.6)).toVar();
      If(shape.greaterThanEqual(bar.sub(0.1)), () => {
        // Smaller billows on the large ones give it the knobbly outline of a heap of cloud.
        shape.subAssign(one(noise(q.mul(3.9).add(0.37)).g).mul(0.2).sub(0.07).mul(billow));
        const d: N = shape.sub(bar).div(edge).toVar();
        // (Air near a cloud but not in it says so, as a whisker less than nothing, so that the walk can take short steps there and
        // not stride over a cloud's thin edge, which one point of the picture caught and the next missed, drawing it as a speckle.)
        if (fine) thick.assign(-1e-6);
        If(d.greaterThan(0), () => {
          // And its edges are eaten away by finer noise still; the body of the cloud is left whole.
          if (fine) d.subAssign(one(noise(q.mul(12.3).add(0.11)).g).mul(one(min(d, 1))).mul(0.8).mul(fineW));
          thick.assign(clamp(d, 0, 1).mul(0.036));
        });
      });
    });
    return thick;
  });
  const cloudFine = cloudOf(true), cloudCoarse = cloudOf(false);

  // The share of sunlight a cloud takes from a point on the land: 0 under clear sky.
  // (Asked of the cloud at three heights in the layer, towards the sun; or at one, `thin`, for the air, which asks at six points along
  // every line of sight and only wants the shafts of light between the heaps' shadows.)
  const cloudShadeOf = (heights: number[]): N => Fn(([p]: [N]) => {
    const shade: N = float(0).toVar();
    If(u.uSunDir.y.greaterThanEqual(0.04), () => {
      const toward = (f: number): N => p.add(u.uSunDir.mul(mix(u.uCloudBase, u.uCloudTop, f).sub(p.y).div(u.uSunDir.y)));
      const weather: N = weatherAt(toward(0.44)).toVar();
      const through: N = float(0).toVar();
      for (const f of heights) {
        // (Read with a soft edge and fewer billows: the shadow of a cloud is not cut out sharp, as the cloud is against the sky. The sun
        // is not a point, and the thin cloud at a heap's rim lets much of it through: under a heap a kilometre up, the shadow's edge is
        // some tens of metres wide.)
        through.addAssign(cloudCoarse(toward(f), float(0), float(0.4), float(0.34), weather));
      }
      through.mulAssign(u.uCloudTop.sub(u.uCloudBase).div(heights.length).div(max(u.uSunDir.y, 0.2)));
      shade.assign(one(exp(through.mul(-1.1))));
    });
    return shade;
  });
  const cloudShade = cloudShadeOf([0.22, 0.44, 0.66]), cloudShadeThin = cloudShadeOf([0.4]);

  // Clouds along a line of sight, as far as `reach`: the light they send, and the share of what
  // is behind them that still comes through.
  // (The light the cloud sends, and the share of what is behind that comes through it: before far cloud is sunk into the haze.)
  const cloudRaw: N = Fn(([ro, rd, jitter, reach]: [N, N, N, N]) => {
    const out: N = vec4(0, 0, 0, 1).toVar();
    If(rd.y.greaterThanEqual(0.015), () => {
      // (As far as some twenty kilometres: cloud that stands high is seen a long way off.)
      // (And each step no longer than some hundred and seventy metres: with the steps of half a kilometre a low line of sight
      // took through a layer two kilometres deep, the cloud was a speckle. A line that low is through the cloud long before.)
      const t0: N = max(u.uCloudBase.sub(ro.y).div(rd.y), 0).toVar(), t1: N = min(min(u.uCloudTop.sub(ro.y).div(rd.y), t0.add(170 * cloudSteps)), reach).toVar();
      If(t1.greaterThan(t0), () => {
        const dt: N = t1.sub(t0).div(cloudSteps).toVar(), t: N = t0.add(dt.mul(jitter)).toVar();
        const toSun: N = dot(rd, u.uSunDir).toVar();
        const deepen: N = max(u.uCloudTop.sub(u.uCloudBase).div(360), 1).pow(0.6).toVar(), away: N = one(max(toSun, 0)).mul(0.45).toVar();
        // (The walk goes in long steps through clear air and, from the first step that finds cloud, goes back most of a step and on
        // in sixth steps: cloud is so thick that one long step into it was nearly the whole of what was seen, and whether that step
        // fell at the cloud's skin or well inside, on its lit side or its shaded, differed from one point of the picture to the next,
        // which drew the cloud as a speckle. A little more of the walk is allowed for the shorter steps.)
        // (Near cloud too, not only in it; and once the air is clear again for three short steps, the long steps take up again.)
        const stride: N = dt.toVar(), shortened: N = float(0).toVar(), clearFor: N = float(0).toVar();
        // Light goes mostly forward through cloud, so edges towards the sun are bright.
        const phase: N = min(mix(phaseHG(toSun, float(0.7)), phaseHG(toSun, float(-0.15)), 0.25).mul(3.2).add(0.55), 2.4).toVar();
        const left: N = float(1).toVar(), lit: N = vec3(0).toVar();
        Loop(Math.round(cloudSteps * 1.4), () => {
          const p: N = ro.add(rd.mul(t)).toVar();
          const billow: N = one(smoothstep(7000, 20000, t).mul(0.65));
          const weather: N = weatherAt(p).toVar();
          const d: N = cloudFine(p, one(smoothstep(70, 160, stride)), billow, float(0.1), weather).toVar();
          If(d.notEqual(0).and(shortened.lessThan(0.5)), () => {
            shortened.assign(1);
            clearFor.assign(0);
            t.subAssign(stride.mul(0.8));
            stride.assign(dt.div(6));
          }).ElseIf(d.equal(0), () => {
            clearFor.addAssign(shortened);
            If(clearFor.greaterThan(2.5), () => { shortened.assign(0); clearFor.assign(0); stride.assign(dt); });
          }).ElseIf(d.greaterThan(0), () => {
            clearFor.assign(0);
            // How much cloud lies between here and the sun: four points towards it, each the cloud's thickness there times the length
            // of the walk it stands for, so that it is a depth of cloud and not a count of points. (Counted as points, as it was, no
            // depth of cloud ever took more than three quarters of the sun's light, and a heap's base was as bright as a third of
            // its sunlit side: soft, even and white all over. The walk goes as much further as the layer is deeper, so that a tower
            // shades its own far side.)
            const through: N = float(0).toVar();
            for (let j = 1; j <= 4; j++) through.addAssign(cloudCoarse(p.add(u.uSunDir.mul(deepen.mul(14 * j * j))), float(0), billow, float(0.1), weather).mul(deepen.mul(14 * (2 * j - 1))));
            const h = clamp(layerAt(p, weather), 0, 1);
            // Light that has come so far through cloud has been scattered, and scattered again, many times: some of it still comes
            // on, more softly the deeper it has come, which is the glow in a heap's shaded side and the grey of its base. (Three
            // shares of it, each taken as through thinner cloud than the last.)
            // (More of it than at first, which left a heap's inside a quarter as bright as its sunlit skin, and every cloud grey.)
            const sunT: N = exp(through.mul(-0.3)).mul(0.5).add(exp(through.mul(-0.08)).mul(0.32)).add(exp(through.mul(-0.025)).mul(0.18));
            // (Where the sun's light has only just come in, at a heap's sunward skin, it has not yet been scattered towards the eye: seen
            // from away from the sun those edges are darker than what lies a little inside them, which is what draws each billow.)
            const powder: N = mix(1, min(one(exp(through.mul(-0.6))).mul(1.5), 1.1), away);
            // (And a heap is lit from the open sky above far more than from below: its flat base is the darkest of it.)
            const light = u.uCloudSun.mul(phase).mul(powder).mul(sunT).add(u.uCloudAir.mul(h.mul(0.7).add(0.5)));
            const a: N = one(exp(d.mul(stride).negate())).toVar();
            lit.addAssign(light.mul(left).mul(a));
            left.mulAssign(one(a));
            If(left.lessThan(0.02), () => { Break(); });
          });
          t.addAssign(stride);
          If(t.greaterThan(t1), () => { Break(); });
        });
        out.assign(vec4(lit, left));
      });
    });
    return out;
  });
  // High streaks of ice cloud, some seven kilometres up: thin, drawn out by the wind into long strands, and lit by the sun as the
  // heaps are, brightest towards it. Over them nothing; under them the heaps. The light they send, and how much they hide.
  const cirrus: N = Fn(([ro, rd]: [N, N]) => {
    const out: N = vec4(0, 0, 0, 0).toVar();
    If(u.uCirrus.greaterThan(0).and(rd.y.greaterThan(0.012)), () => {
      const t: N = float(7200).sub(ro.y).div(rd.y), at: N = ro.xz.add(rd.xz.mul(t)).toVar();
      const q: N = vec3(at.x.div(15000), 0.31, at.y.div(4200)).add(u.uCloudDrift.mul(0.35)).toVar();
      // (Strands, but broad and soft ones: read finer and more drawn out, they were scratches, like rain on a window.)
      const broad: N = noise(q).r, fine: N = noise(vec3(q.x.mul(1.9), 0.77, q.z.mul(3.2))).g;
      const a: N = smoothstep(0.52, 0.86, broad.mul(0.85).add(fine.mul(0.25)).add(u.uCirrus.mul(0.3)).sub(0.15)).mul(u.uCirrus).mul(smoothstep(0.015, 0.14, rd.y)).mul(0.42).toVar();
      const light: N = u.uCloudSun.mul(phaseHG(dot(rd, u.uSunDir), float(0.6)).mul(2.2).add(0.45)).add(u.uCloudAir.mul(0.7));
      out.assign(vec4(light.mul(a), a));
    });
    return out;
  });
  // How much of a cloud along a line of sight is seen as cloud, and not lost in the haze at the horizon.
  const cloudNear = (ro: N, rd: N): N => exp(max(u.uCloudBase.sub(ro.y).div(max(rd.y, 0.015)), 0).div(-16000)).mul(smoothstep(0.015, 0.1, rd.y));
  // Clouds against the sky: far cloud fades into the sky behind it.
  const cloudMarch: N = Fn(([ro, rd, jitter, reach]: [N, N, N, N]) => {
    const raw: N = cloudRaw(ro, rd, jitter, reach).toVar(), near: N = cloudNear(ro, rd).toVar();
    return vec4(raw.rgb.mul(near), mix(1, raw.a, near));
  });
  // Clouds in front of the land: far cloud fades into the colour of the haze, but still hides what is behind it. (Faded into
  // nothing, as against the sky, it let the far mountains show through a cloud that stood in front of them.)
  const cloudOver: N = Fn(([ro, rd, jitter, reach, air]: [N, N, N, N, N]) => {
    const raw: N = cloudRaw(ro, rd, jitter, reach).toVar(), near: N = cloudNear(ro, rd).toVar();
    return vec4(raw.rgb.mul(near).add(air.mul(one(raw.a)).mul(one(near))), raw.a);
  });

  // What the sky has after sunset that the daytime sky does not: a faint light of its own, and a glow where the sun went down.
  const skyAfterDark: N = Fn(([rd]: [N]) => {
    const up: N = clamp(rd.y, 0, 1).toVar();
    const flat = rd.xz.div(max(length(rd.xz), 0.0001)), glowFlat = u.uGlowDir.xz.div(max(length(u.uGlowDir.xz), 0.0001));
    return mix(u.uSkyHorizon, u.uSkyZenith, pow(up, 0.45)).add(u.uGlow.mul(pow(max(dot(flat, glowFlat), 0), 4)).mul(exp(up.mul(-5.5))));
  });

  // The colour distance takes: the sky a little above the horizon, that way.
  const airColour: N = Fn(([rd]: [N]) => {
    const low: N = normalize(vec3(rd.x, max(rd.y, 0).mul(0.25).add(0.07), rd.z)).toVar();
    const sky: N = u.tSky.sample(low).level(2).rgb.toVar();
    // Towards the sun the sky is many times brighter than anything can be shown; it is brought
    // down whole, keeping its colour, or the haze there would go through every colour to white.
    return sky.mul(min(1, float(1.25).div(max(max(sky.r, sky.g), max(sky.b, 0.001))))).add(skyAfterDark(low));
  });

  // How much air of one layer lies along a line of sight between two distances. A layer is
  // (thickness at its own level, the height over which it thins to a third, its level).
  const airAlong: N = Fn(([layer, y, dy, ta, tb]: [N, N, N, N, N]) => {
    const air: N = float(0).toVar();
    If(tb.greaterThan(ta).and(layer.x.greaterThan(0)), () => {
      const ya: N = max(y.add(dy.mul(ta)).sub(layer.z).div(layer.y), -1).toVar(), yb: N = max(y.add(dy.mul(tb)).sub(layer.z).div(layer.y), -1).toVar();
      const thick = select(abs(yb.sub(ya)).lessThan(0.001), exp(ya.negate()), exp(ya.negate()).sub(exp(yb.negate())).div(yb.sub(ya)));
      air.assign(layer.x.mul(thick).mul(tb.sub(ta)));
    });
    return air;
  });

  // All the air beyond `from` along a line of sight that ends at `reach`: x is haze, y is mist.
  const airBeyond: N = Fn(([ro, rd, from, reach, hazeTo]: [N, N, N, N, N]) => {
    const haze = airAlong(u.uHaze, ro.y, rd.y, float(0), hazeTo);
    const mist: N = airAlong(u.uMist, ro.y, rd.y, from, reach).mul(0.85).toVar();
    // The far country's mist begins where a line of sight leaves the valley.
    const o: N = ro.xz.sub(u.uAirCentre.xz).toVar();
    const a: N = dot(rd.xz, rd.xz).toVar(), b: N = dot(o, rd.xz).toVar(), c: N = dot(o, o).sub(u.uMistFar.w.mul(u.uMistFar.w)).toVar();
    const leaves = select(c.greaterThan(0), 0, select(a.lessThan(1e-6), 1e9, b.negate().add(sqrt(max(b.mul(b).sub(a.mul(c)), 0))).div(max(a, 1e-6))));
    mist.addAssign(airAlong(u.uMistFar.xyz, ro.y, rd.y, max(leaves, from), reach));
    return vec2(haze, mist);
  });

  return { phaseHG, cloudShade, cloudShadeThin, cloudMarch, cloudOver, cirrus, skyAfterDark, airColour, airAlong, airBeyond };
}

export class Atmosphere {
  /** The settings of the air and the weather, each with a `value` that may be changed at any time. */
  readonly uniforms: Record<string, N>;
  /** The scene as it is drawn before any air is put in it: its colours and its depths. */
  readonly scenePass: N;
  /** The finished picture, before the glow of bright things and the eye's adjustment to light. */
  readonly node: N;
  /** The sky's weather and the air, for whatever else must draw them (see `skyParts`). */
  readonly sky: ReturnType<typeof skyParts>;
  private sunDepth: RenderTarget;
  private skyDepth: RenderTarget;
  private frame = 0;
  private meterTarget = new RenderTarget(16, 9, { type: UnsignedByteType, depthBuffer: false });
  private meterQuad: QuadMesh;

  /** Whether the picture is smoothed over the frames (`temporal`, below). */
  readonly temporal: boolean;

  /**
   * `occlusion`: whether the light from all round is taken from what lies in the hollows of what is seen (see below); on unless asked not to.
   *
   * `temporal`: whether the finished picture is to be smoothed over the frames, each drawn from a fraction of a point aside from the
   * last and laid over what went before (see `smoothOverFrames`). If so the scene is drawn once to each point of the picture, not four
   * times, and with it how far each point has moved on the screen since the frame before; and whatever is reckoned from a pattern of
   * noise across the picture, the steps through cloud and mist and the hollows of what is seen, takes a new pattern each frame, so that
   * the patterns are averaged away. Otherwise each point is drawn four times, so that edges are smooth and leaves cut out by coverage.
   */
  constructor(private scene: Scene, private camera: PerspectiveCamera, private renderer: WebGPURenderer, cloudSteps = 28, o: { occlusion?: boolean; temporal?: boolean; mirrors?: boolean } = {}) {
    const temporal = (this.temporal = o.temporal === true);
    this.scenePass = pass(scene, camera, { samples: temporal ? 0 : 4 });
    // (And beside them, how nearly a mirror each point is and which way it faces, where its material says so: see `mirrors` below.)
    const mirrors = temporal && o.mirrors !== false;
    if (temporal) {
      // (How nearly a mirror, as the length of the way it faces in the view: `mirrorOf`. Laid over what is under it as the material is,
      // so that what is drawn through, rain, glass, smoke, which says nothing (and so says it with no opacity), leaves what is under it.)
      const mirrorOf: N = Fn((builder: N) => builder.material?.userData?.mirror ?? vec4(0.5, 0.5, 0.5, 0))();
      const outputs: N = mrt(mirrors ? { output, velocity, gloss: mirrorOf } : { output, velocity });
      if (mirrors) outputs.setBlendMode('gloss', new BlendMode(MaterialBlending));
      this.scenePass.setMRT(outputs);
      if (mirrors) this.scenePass.getTexture('gloss').type = UnsignedByteType;
    }
    this.sunDepth = depthTarget(2048);
    this.skyDepth = depthTarget(1024);

    const u: Record<string, N> = (this.uniforms = {
      // (Read as it is when the air is drawn: smoothed over the frames, the camera is moved a fraction of a point aside for each, while
      // the picture is made, and the depths drawn so are to be read with the camera as it was drawn with.)
      uInvProj: uniform(new Matrix4()).onRenderUpdate((_: unknown, self: N) => { self.value.copy(camera.projectionMatrixInverse); }),
      uProj: uniform(new Matrix4()).onRenderUpdate((_: unknown, self: N) => { self.value.copy(camera.projectionMatrix); }),
      // Whether wet ground mirrors what stands about it (see `mirrors`), 1 or 0.
      uMirrors: uniform(1),
      uInvView: uniform(new Matrix4()),
      uSunVP: uniform(new Matrix4()),
      uSkyVP: uniform(new Matrix4()),
      uCamPos: uniform(new Vector3()),
      uSunDir: uniform(new Vector3(0, 1, 0)),
      uSunColor: uniform(new Vector3(1, 1, 1)),
      uSkyColor: uniform(new Vector3(0.5, 0.6, 0.8)),
      uDensity: uniform(0.012),
      uIndoorDensity: uniform(2.6),
      uFrame: uniform(0),
      uEnabled: uniform(1),
      uLightPos: uniformArray(Array.from({ length: MAX_LIGHTS }, () => new Vector4())),
      uLightCol: uniformArray(Array.from({ length: MAX_LIGHTS }, () => new Vector3())),
      // The weather. Until a block of noise is given there are no clouds.
      tCloud: texture3D(blankNoise()),
      uCloudOn: uniform(0),
      uCloudCover: uniform(0.45),
      uCloudBase: uniform(260),
      uCloudTop: uniform(620),
      uCloudDrift: uniform(new Vector3()),
      uCloudSun: uniform(new Vector3(3, 3, 3)),
      uCloudAir: uniform(new Vector3(0.5, 0.6, 0.8)),
      uShade: uniform(0.5),
      // The sky after dark: its own faint light, the glow where the sun went down, stars and moon.
      uSkyZenith: uniform(new Vector3()),
      uSkyHorizon: uniform(new Vector3()),
      uGlowDir: uniform(new Vector3(0, 0, 1)),
      uGlow: uniform(new Vector3()),
      uNight: uniform(0),
      // The air at a distance. Until a picture of the sky is given there is none.
      tSky: cubeTexture(new CubeTexture()),
      uAirOn: uniform(0),
      uHaze: uniform(new Vector3(0.0004, 300, 0)),
      uMist: uniform(new Vector3(0, 4, 0)),
      uMistFar: uniform(new Vector4(0, 10, 24, 170)),
      // How much of the sun's own light the mist scatters, besides the air's colour (`?mistsun=`).
      uMistSun: uniform(0.4),
      // (The mist has a floor: it lies on the valley's ground and does not sink into what is dug beneath it.)
      uMistLow: uniform(-1e6),
      uAirCentre: uniform(new Vector3()),
      uGlare: uniform(new Vector3()),
      uCloudFlat: uniform(0),
      // How much of the sky the high streaks of ice cloud cover, 0 to 1.
      uCirrus: uniform(0),
      // A box of space that is underground though it is outside the house: no daylight, no mist.
      uUnderMin: uniform(new Vector3(1, 1, 1)),
      uUnderMax: uniform(new Vector3(0, 0, 0)),
      // (A second such box: about the cavern under the hill and the passage to it, which lie apart from any hall.)
      uUnder2Min: uniform(new Vector3(1, 1, 1)),
      uUnder2Max: uniform(new Vector3(0, 0, 0)),
      // A shaft of daylight under the hill: where it begins and how broad it is; which way it goes and how far; its light.
      uShaftTop: uniform(new Vector4(0, 0, 0, 0)),
      uShaftDown: uniform(new Vector4(0, -1, 0, 0)),
      uShaftCol: uniform(new Vector3()),
      // What little light the air of such a hall holds everywhere, from the day let into it.
      uUnderAir: uniform(new Vector3()),
      // A sea of cloud below, on a mountain: the level of its top, how high its billows stand, and whether there is one; its sunlit and its shaded colour.
      uDeck: uniform(new Vector4(0, 8, 0, 0)),
      // (Its fourth number is how broken it is, 0 to 1.) Its breaks: the bar the noise must clear to open one, and how deep the cloud's walls stand round it, in billows.
      uDeckGap: uniform(new Vector4(0.6, 7, 0, 0)),
      // The mountain, for the shadow it throws on the cloud: its body as a round tower narrowing upward (its middle's x and z, how broad its
      // top is, the top's level; how broad it is at the cloud), and its summit as a cone on that (x, z, how broad at its foot, how high its point).
      uShadeBody: uniform(new Vector4(0, 0, 0, 0)),
      uShadeFoot: uniform(0),
      uShadePeak: uniform(new Vector4(0, 0, 0, 0)),
      uDeckSun: uniform(new Vector3(2, 2, 2)),
      // The ridge the way comes up out of the cloud by (x, z of one end and of the other), over which no heaps of cloud stand.
      uDeckSpur: uniform(new Vector4(0, 0, 0, 0)),
      uDeckAir: uniform(new Vector3(0.6, 0.7, 0.8)),
      // How much of the light from all round the hollows of what is seen take away, 0 to 1 (see `occlusion` below).
      uAo: uniform(o.occlusion === false ? 0 : 1),
    });
    const sky = (this.sky = skyParts(u, cloudSteps));
    const colourOf: N = this.scenePass.getTextureNode('output'), depthOf: N = this.scenePass.getTextureNode('depth');
    const gpu = renderer.coordinateSystem === WebGPUCoordinateSystem;

    // 1 where a point is nearer one of the two maps' eyes than the first surface that eye sees: lit, or under open sky.
    const seen = (map: DepthTexture, vp: N, p: N, bias: number): N => {
      const c: N = vp.mul(vec4(p, 1));
      const s: N = c.xyz.div(c.w).toVar();
      // (A picture's first row is its top one. How depths run differs between the two graphics interfaces.)
      const at = vec2(s.x.mul(0.5).add(0.5), s.y.mul(-0.5).add(0.5));
      const deep = gpu ? s.z : s.z.mul(0.5).add(0.5);
      const inside = abs(s.x).lessThan(1).and(abs(s.y).lessThan(1));
      // (Past the picture's far end, only what the picture holds between shades a point: its own depth there, compared with the empty
      // picture behind everything, said it was shaded, and the air down-sun of the place's box was dark.)
      return select(inside, step(min(deep, 1).sub(bias), (texture(map, at) as N).level(0)), 1);
    };
    const ign = (p: N): N => fract(fract(dot(p, vec2(0.06711056, 0.00583715))).mul(52.9829189));

    /**
     * The hollows of what is seen. Light comes from all round, and less of it gets in among the blades of a meadow, under a
     * crown, into the crease where a wall stands on the ground or a boulder lies on it, than onto what stands open: without that
     * a meadow is a green sheet and a stone sits on the grass as if laid there after. The bake gives the house its hollows, and
     * rock its pits from its texture; nothing gave them to what grows, to the ground about what stands on it, or to anything not
     * baked. So how much of the sky each point of the picture sees past what is next to it is reckoned from the picture's depths
     * (horizon-based occlusion, `GTAONode`), over a couple of metres about it, at half the picture's size; and smoothed over a few
     * of those points, only among points at about the same depth, so that a blade of grass against the meadow behind it does not
     * take the meadow's shade, nor the meadow the blade's. On the GPU it costs next to nothing (some 0.03 ms at 1024 by 768).
     * It takes away from all the light, not only that from the sky, as it is laid on the finished picture: in the sun's light,
     * where most of a point's light comes straight from the sun, it is taken at a little over half its strength.
     */
    const occlusion = o.occlusion !== false;
    const occlusionAt: N = (() => {
      if (!occlusion) return () => float(1);
      const hollows: N = (gtao as N)(depthOf, null, camera);
      hollows.resolutionScale = 0.5;
      hollows.radius.value = 2;
      hollows.thickness.value = 3;
      hollows.scale.value = 1.5;
      hollows.samples.value = 12;
      // (Smoothed over the frames, its pattern of directions is turned each frame, and the frames average it out.)
      hollows.useTemporalFiltering = temporal;
      const shade: N = hollows.getTextureNode();
      const near: N = reference('near', 'float', camera), far: N = reference('far', 'float', camera);
      const deep = (at: N): N => perspectiveDepthToViewZ(depthOf.sample(at).x, near, far).negate();
      return (): N => {
        const step2: N = vec2(2).div(screenSize).toVar(), z0: N = deep(screenUV).toVar();
        // (What matches no point about it at its own depth, a blade one point wide against what is behind it, is taken as open.)
        const sum: N = float(0.15).toVar(), weight: N = float(0.15).toVar();
        for (const [dx, dy, w0] of [[-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1], [0, 0, 0.5]]) {
          const at: N = screenUV.add(step2.mul(vec2(dx, dy))).toVar();
          const w: N = exp(abs(deep(at).sub(z0)).div(z0.mul(0.03).add(0.03)).negate()).mul(w0);
          sum.addAssign(shade.sample(at).r.mul(w));
          weight.addAssign(w);
        }
        return sum.div(weight);
      };
    })();
    // How thick the mist is at a point near the eye. It lies in drifts, not evenly.
    const mistAt = (p: N): N => {
      const d = u.uMist.x.mul(exp(max(p.y.sub(u.uMist.z).div(u.uMist.y), -1).negate()));
      const drifts = select(u.uCloudOn.greaterThan(0.5), smoothstep(0.28, 0.72, u.tCloud.sample(p.mul(vec3(0.021, 0.05, 0.021)).add(u.uCloudDrift.mul(9))).level(0).r).mul(1.7), 0.85);
      return select(u.uMist.x.greaterThan(0), d.mul(drifts).mul(smoothstep(u.uMistLow.sub(1.5), u.uMistLow, p.y)), 0);
    };

    /**
     * The sea of cloud. Its top is a surface of billows, broad and slow ones with smaller ones on
     * them, drifting with the wind, which a line of sight from above is walked down to: what it
     * meets is lit as a surface, white where it faces the sun and grey-blue in its troughs, and
     * whatever lies beyond it is hidden, gradually for a few tens of metres, so that rock going
     * down into it fades into it and is not cut off at a line. From inside it, the air is cloud:
     * thick enough to see no more than a stone's throw, thinner towards its top.
     */
    // Where the cloud is broken: 0 where it is whole, 1 in the middle of a break. Breaks are great ragged holes and lanes, miles
    // apart; there are none about the mountain itself, which stands in the cloud, nor so far off that no land is drawn under them.
    const deckOpen = (xz: N): N => {
      const wide = u.tCloud.sample(vec3(xz.x.div(5300), 0.47, xz.y.div(5300)).add(u.uCloudDrift.mul(vec3(0.12, 0, 0.12)))).level(0).r;
      const ragged = u.tCloud.sample(vec3(xz.x.div(1250), 0.71, xz.y.div(1250)).add(u.uCloudDrift.mul(vec3(0.4, 0, 0.4)))).level(0).g;
      const out: N = length(xz.sub(u.uAirCentre.xz));
      // (The further from the mountain, the more broken: the cloud lies thickest against the heights.)
      const bar: N = u.uDeckGap.x.sub(smoothstep(700, 2800, out).mul(u.uDeckGap.z));
      return smoothstep(bar, bar.add(0.07), wide.add(ragged.sub(0.5).mul(0.16))).mul(smoothstep(430, 640, out)).mul(one(smoothstep(4600, 6000, out))).mul(step(0.01, u.uDeck.w));
    };
    const deckHeight = (xz: N): N => deckWhole(xz).sub(deckOpen(xz).mul(u.uDeck.y).mul(u.uDeckGap.y));
    const deckWhole = (xz: N): N => {
      // (Three sizes: great swells a mile across, heaps a few hundred metres across on them, and billows on those.)
      const vast = u.tCloud.sample(vec3(xz.x.div(3400), 0.13, xz.y.div(3400)).add(u.uCloudDrift.mul(vec3(0.3, 0, 0.3)))).level(0).r;
      const big = u.tCloud.sample(vec3(xz.x.div(900), 0.31, xz.y.div(900)).add(u.uCloudDrift.mul(vec3(0.6, 0, 0.6)))).level(0).r;
      const small = u.tCloud.sample(vec3(xz.x.div(210), 0.67, xz.y.div(210)).add(u.uCloudDrift.mul(vec3(1.7, 0, 1.7)))).level(0).r;
      // And here and there, where a great swell and a heap coincide, the cloud towers up: heads standing well over the rest.
      const tower = pow(smoothstep(0.5, 0.78, big), 2).mul(smoothstep(0.38, 0.7, vast)).mul(u.uDeck.y.mul(2.6));
      // And on all that, heaps: domes some hundreds of metres across standing tens of metres over the sea, rounded over the top and
      // falling steeply between, with smaller heads on them, as the tops of a sea of cloud are; banked up against the mountain as
      // well. Not over the ridge the way comes up out of the cloud by, where the player would be kept in the fog a long while.
      // (Without them its top was a sheet with swells in it a few metres high: from above, a flat white disc with the mountain in it.)
      const sa: N = u.uDeckSpur.xy, sb: N = u.uDeckSpur.zw, along: N = sb.sub(sa), l2: N = max(dot(along, along), 1);
      const onSpur: N = length(xz.sub(sa.add(along.mul(clamp(dot(xz.sub(sa), along).div(l2), 0, 1)))));
      const room: N = select(l2.greaterThan(2), smoothstep(45, 170, onSpur), float(1));
      // (Read from the same noise as the swells and billows, which costs nothing more: a line of sight reads this some fifty times.)
      const heapN: N = big;
      const heap: N = sqrt(smoothstep(0.46, 0.84, big.add(vast.sub(0.5).mul(0.3)))).toVar();
      const heads: N = sqrt(smoothstep(0.5, 0.86, small)).mul(smoothstep(0.15, 0.6, heap));
      // (Against the mountain it banks up, as cloud driven against a cliff does, in heaps of its own.)
      const toBody: N = select(u.uShadeBody.z.greaterThan(0.5), length(xz.sub(u.uShadeBody.xy)).sub(u.uShadeFoot), float(1e4));
      const bank: N = smoothstep(260, 15, toBody).mul(heapN.mul(0.7).add(0.3)).mul(3.2);
      const heaped: N = heap.mul(5.5).add(heads.mul(2.2)).add(bank).mul(u.uDeck.y).mul(room);
      return u.uDeck.x.add(smoothstep(0.3, 0.72, vast).mul(2).sub(1).mul(u.uDeck.y)).add(smoothstep(0.3, 0.72, big).mul(2).sub(1).mul(u.uDeck.y)).add(smoothstep(0.3, 0.72, small).mul(2).sub(1).mul(u.uDeck.y.mul(0.62))).add(tower).add(heaped);
    };
    // (The same with its smallest knobs on, for how it is lit where it is looked at: too fine to matter to where a line of sight meets it.)
    const deckFine = (xz: N): N => deckHeight(xz).add(u.tCloud.sample(vec3(xz.x.div(64), 0.87, xz.y.div(64)).add(u.uCloudDrift.mul(vec3(3.1, 0, 3.1)))).level(0).g.sub(0.5).mul(u.uDeck.y.mul(0.5)));
    // (Built where it is called, inside the program of the picture: it gives back two things.)
    const deckOver = (ro: N, rd: N, reach: N, jitter: N): { out: N; far: N } => {
      // x, y, z: the colour of what is seen of the cloud; w: how much of what lies behind is hidden. And how far off it is.
      const out: N = vec4(0, 0, 0, 0).toVar(), far: N = float(0).toVar();
      const amp: N = u.uDeck.y.mul(2.7).toVar();
      const here: N = deckHeight(ro.xz).toVar();
      If(ro.y.lessThan(here), () => {
        // Inside it: it thins towards its top; and a line of sight that goes up out of it leaves it.
        const deep: N = here.sub(ro.y).toVar();
        const thick: N = smoothstep(0, 14, deep).mul(0.075).add(0.012).toVar();
        const leaves: N = select(rd.y.greaterThan(0.002), deep.div(rd.y), float(1e9));
        const through: N = min(reach, leaves).toVar();
        const lightness: N = smoothstep(-5, 40, deep).oneMinus().mul(0.5).add(0.45);
        out.assign(vec4(u.uDeckAir.mul(1.1).add(u.uDeckSun.mul(0.35)).mul(lightness), one(exp(through.mul(thick).negate()))));
        far.assign(0);
      }).ElseIf(rd.y.lessThan(-0.0004), () => {
        const top: N = u.uDeck.x.add(amp.mul(2.05)).add(u.uDeck.y.mul(7.7)), bottom: N = u.uDeck.x.sub(amp).sub(u.uDeck.y.mul(u.uDeckGap.y).mul(step(0.01, u.uDeck.w)));
        const t0: N = max(top.sub(ro.y).div(rd.y), 0).toVar();
        const tBottom: N = bottom.sub(ro.y).div(rd.y).toVar();
        const t1: N = min(min(tBottom, reach), 40000).toVar();
        If(t1.greaterThan(t0), () => {
          // Walked from where the line of sight comes down past the highest billows to where it passes the lowest, or meets the land.
          const dt: N = t1.sub(t0).div(38).toVar(), t: N = t0.add(dt.mul(jitter.mul(0.5))).toVar();
          const prev: N = ro.y.add(rd.y.mul(t)).sub(deckHeight(ro.xz.add(rd.xz.mul(t)))).toVar();
          const hit: N = float(-1).toVar();
          // (And the cloud's top is not a hard skin: over it lies a fringe a few metres deep, thinning upward, which the line of sight
          // gathers on its way down, so the heaps' edges against what is behind them are soft.)
          // (The fringe is taken as deep as one step of the walk falls, if that is more than its few metres, and as thin in proportion,
          // or the steps, tens of metres long for a line of sight that grazes the cloud, catch it or miss it in bands. And none over a
          // break, where there is no cloud.)
          const fringe: N = float(0).toVar(), fall: N = max(dt.mul(rd.y.negate()).mul(1.2), 6).toVar();
          Loop(38, () => {
            t.addAssign(dt);
            const p: N = ro.add(rd.mul(t)).toVar();
            const gap: N = deckOpen(p.xz).toVar();
            const d: N = p.y.sub(deckWhole(p.xz).sub(gap.mul(u.uDeck.y).mul(u.uDeckGap.y))).toVar();
            If(d.lessThan(0), () => {
              hit.assign(t.sub(dt.mul(d.div(d.sub(prev)))));
              Break();
            });
            fringe.addAssign(exp(d.div(fall).negate()).mul(dt).mul(float(6).div(fall)).mul(one(smoothstep(0.3, 0.8, gap))));
            prev.assign(d);
          });
          // (A line of sight that reaches the lowest billows without meeting the land is in the cloud there, whatever the walk found.)
          If(hit.lessThan(0).and(tBottom.lessThan(reach)), () => { hit.assign(min(tBottom, 40000)); });
          If(hit.greaterThan(0), () => {
            const p: N = ro.add(rd.mul(hit)).toVar();
            // (Near the eye its knobs are seen; far off they are smaller than a point of the picture, and left out.)
            const e: N = mix(7, 22, smoothstep(150, 1200, hit)).toVar(), knobs: N = one(smoothstep(300, 1500, hit)).toVar();
            const hAt = (q: N): N => mix(deckHeight(q), deckFine(q), knobs);
            const hx: N = hAt(p.xz.add(vec2(e, 0))).sub(hAt(p.xz.sub(vec2(e, 0)))), hz: N = hAt(p.xz.add(vec2(0, e))).sub(hAt(p.xz.sub(vec2(0, e))));
            const n: N = normalize(vec3(hx.negate(), e.mul(2), hz.negate())).toVar();
            const here2: N = deckHeight(p.xz).toVar();
            const hh: N = here2.sub(u.uDeck.x).div(max(u.uDeck.y, 0.1)).toVar();
            // The heaps shade one another: towards the sun, a little way off and further, is the cloud higher than the sun's light comes in at?
            const sunFlat: N = max(length(u.uSunDir.xz), 0.05), sunWay: N = u.uSunDir.xz.div(sunFlat), rise: N = u.uSunDir.y.div(sunFlat);
            let shaded: N = float(0);
            for (const d of [38, 130, 380]) shaded = max(shaded, smoothstep(0, u.uDeck.y.mul(0.7), deckHeight(p.xz.add(sunWay.mul(d))).sub(here2.add(rise.mul(d)))));
            // Lit as cloud is: much of the sun's light comes through and round it, so even what faces away is not dark; the troughs hold shadow.
            // And the mountain shades the cloud: its shadow lies out across the sea, miles long when the sun is low. Up the line to the sun
            // from this point, at a few heights, is the line inside the mountain's body, or its summit?
            let cast: N = float(0);
            const upTo = (h: N): N => p.xz.add(u.uSunDir.xz.mul(h.sub(here2).div(max(u.uSunDir.y, 0.03))));
            for (let k = 1; k <= 4; k++) {
              const h: N = mix(here2, u.uShadeBody.w, k / 4.3), broad: N = mix(u.uShadeFoot, u.uShadeBody.z, clamp(h.sub(u.uDeck.x).div(max(u.uShadeBody.w.sub(u.uDeck.x), 1)), 0, 1));
              cast = max(cast, one(smoothstep(broad.mul(0.8), broad.mul(1.12), length(upTo(h).sub(u.uShadeBody.xy)))));
            }
            for (let k = 1; k <= 3; k++) {
              const h: N = mix(u.uShadeBody.w, u.uShadePeak.w, k / 3.6), broad: N = u.uShadePeak.z.mul(u.uShadePeak.w.sub(h)).div(max(u.uShadePeak.w.sub(u.uShadeBody.w), 1));
              cast = max(cast, one(smoothstep(broad.mul(0.7), broad.mul(1.15), length(upTo(h).sub(u.uShadePeak.xy)))));
            }
            cast = cast.mul(step(0.5, u.uShadeBody.z)).mul(smoothstep(0.02, 0.1, u.uSunDir.y));
            const sun: N = max(dot(n, u.uSunDir), 0).mul(0.75).add(0.25).mul(smoothstep(-0.05, 0.08, u.uSunDir.y)).mul(one(shaded.mul(0.72))).mul(one(cast.mul(0.82)));
            const hollow: N = smoothstep(-1.5, 1.4, hh).mul(0.62).add(0.38);
            const edge: N = sky.phaseHG(dot(rd, u.uSunDir), float(0.6)).mul(0.6);
            const colour: N = u.uDeckSun.mul(sun.mul(hollow).add(edge.mul(0.25))).add(u.uDeckAir.mul(n.y.mul(0.3).add(0.42)).mul(hollow));
            // (In a break there is no cloud: thinning to nothing towards its middle, with the cloud's walls standing round it.)
            out.assign(vec4(colour, one(exp(reach.sub(hit).div(-16))).mul(one(smoothstep(0.5, 0.95, deckOpen(p.xz))))));
            far.assign(hit);
          });
          // The fringe: lit as the cloud's tops are, a little paler, laid over whatever the line of sight met or went on to.
          const veil: N = one(exp(fringe.mul(-0.012))).mul(0.6).toVar();
          If(veil.greaterThan(0.002), () => {
            const tint: N = u.uDeckSun.mul(0.62).add(u.uDeckAir.mul(0.55));
            out.assign(vec4(mix(select(out.w.greaterThan(0), out.xyz, tint), tint, veil), max(out.w, veil)));
          });
        });
      });
      return { out, far };
    };
    /**
     * Mirrors in wet ground. Water standing in a rut or between setts, and wet setts and flags, mirror what stands about them: the
     * houses across the street, the lamps, a lit window at dusk. The ground's material mirrored only the sky (the picture of it that
     * lights everything), so that a wet street was a sheet of pale grey sheen with nothing in it. Now the material says, beside its
     * colour, how nearly a mirror each point is and which way it faces (`mirror` in `makeGroundMaterial`), and here the line of sight
     * is turned at each such point as a mirror turns it, and walked through the picture's depths, in steps that lengthen as it goes,
     * until it passes behind what the picture shows: what is there is what the point mirrors. It is mixed in as much as such a surface
     * mirrors at that angle (little looking down on it, much looking along it), in place of the sky the material put there. What is
     * not in the picture, behind the eye or off its edge, is not mirrored, and the mirroring fades out towards the picture's edges. A
     * surface not quite a mirror (wet stone, not water) has the way it faces stirred a little each frame, which the frames smooth
     * into a blurred mirroring.
     */
    const mirrored = (col: N, view: N, depth: N, dither: N): void => {
      const glossOf: N = this.scenePass.getTextureNode('gloss');
      const near: N = reference('near', 'float', camera), far: N = reference('far', 'float', camera);
      If(depth.lessThan(0.999999).and(u.uMirrors.greaterThan(0.5)), () => {
        const g0: N = glossOf.sample(screenUV).level(0).rgb.mul(2).sub(1).toVar(), strength: N = length(g0).toVar();
        If(strength.greaterThan(0.04), () => {
          const g: N = vec4(g0.div(strength), min(strength, 1)).toVar();
          const v: N = normalize(view).toVar();
          const stir: N = vec3(ign(screenCoordinate.xy.add(u.uFrame.mul(7.13))), ign(screenCoordinate.xy.add(u.uFrame.mul(3.31)).add(17.7)), 0.5).sub(0.5);
          const n: N = normalize(g.xyz.add(stir.mul(one(g.a).mul(0.22)))).toVar();
          const r: N = reflect(v, n).toVar();
          const hit: N = float(0).toVar(), at: N = vec2(0).toVar();
          const t: N = float(0.06).add(dither.mul(0.12)).toVar(), stride: N = float(0.22).toVar();
          Loop(30, () => {
            const q: N = view.add(r.mul(t)).toVar();
            If(q.z.greaterThan(near.negate()), () => { Break(); });
            const s: N = getScreenPosition(q, u.uProj).toVar();
            If(s.x.lessThan(0).or(s.x.greaterThan(1)).or(s.y.lessThan(0)).or(s.y.greaterThan(1)), () => { Break(); });
            const behind: N = perspectiveDepthToViewZ(depthOf.sample(s).level(0).x, near, far).sub(q.z).toVar();
            // (Behind what the picture shows, but not far behind: a line of sight that passes well behind a post has gone past it.)
            If(behind.greaterThan(0).and(behind.lessThan(stride.mul(1.5).add(0.15))), () => {
              hit.assign(1);
              at.assign(s);
              Break();
            });
            t.addAssign(stride);
            stride.mulAssign(1.16);
          });
          If(hit.greaterThan(0.5), () => {
            const edge: N = min(min(at.x, one(at.x)), min(at.y, one(at.y)));
            const fade: N = smoothstep(0, 0.07, edge).mul(one(smoothstep(35, 70, t))).mul(smoothstep(0.25, -0.05, r.z));
            const cosT: N = clamp(dot(v.negate(), n), 0, 1);
            const fresnel: N = pow(one(cosT), 5).mul(0.98).add(0.02);
            const seen: N = min(colourOf.sample(at).level(0).rgb, vec3(6));
            // (What the material put there: the sky, as the air's colour that way is near enough to.)
            const rw: N = u.uInvView.mul(vec4(r, 0)).xyz;
            const sky0: N = select(u.uAirOn.greaterThan(0.5), sky.airColour(rw), u.uSkyColor.mul(0.5)).mul(0.6);
            col.assign(max(col.add(seen.sub(sky0).mul(fresnel).mul(g.a).mul(fade)), vec3(0)));
          });
        });
      });
    };
    this.node = Fn(() => {
      // The sun's disc is thousands of times brighter than anything else; left alone, bloom spreads it over the whole view.
      const col: N = min(colourOf.rgb, vec3(6)).toVar();
      const out: N = vec4(col, 1).toVar();
      If(u.uEnabled.greaterThan(0.5), () => {
        const depth: N = depthOf.toVar();
        // (A point of open sky beside far land is taken as land, as far off as the nearest of it. Along a skyline the picture's colour is
        // smoothed, part land and part sky, but its depth is one or the other; where the depth says sky, the land's share of the colour
        // would be left without its haze, and a far ridge would be drawn with a bright line along it, through any cloud in front.)
        If(depth.greaterThan(0.999999), () => {
          const px: N = vec2(1).div(screenSize).toVar();
          const near = min(min(depthOf.sample(screenUV.add(vec2(px.x, 0))).x, depthOf.sample(screenUV.sub(vec2(px.x, 0))).x), min(depthOf.sample(screenUV.add(vec2(0, px.y))).x, depthOf.sample(screenUV.sub(vec2(0, px.y))).x));
          // (Only far land: near things, a tree against the sky, have no haze to lose, and the open sky's own mist about them would be lost instead.)
          const far: N = length(getViewPosition(screenUV, near, u.uInvProj)).toVar();
          If(near.lessThan(0.999999).and(far.greaterThan(300)), () => { depth.assign(near); });
        });
        const view: N = getViewPosition(screenUV, depth, u.uInvProj);
        const wp: N = u.uInvView.mul(vec4(view, 1)).xyz.toVar();
        const dist: N = length(wp.sub(u.uCamPos)).toVar();
        const rd: N = wp.sub(u.uCamPos).div(dist).toVar();
        const open: N = depth.greaterThan(0.999999).toVar();
        const dither: N = ign(temporal ? screenCoordinate.xy.add(u.uFrame.mul(5.588)) : screenCoordinate.xy).toVar();
        // Where what stands against the sky meets it, a point of the picture is part sky and part what stands there in its colour, but
        // has one depth, the near thing's or the sky's; and the cloud is drawn only where the depth says sky. So the sky's share of the
        // one was left without its cloud, and the near thing's share of the other had cloud put over it: every roof and branch against
        // white cloud had a rim of blue sky about it, or of cloud across its edge. At such an edge, then, the share that is sky is
        // reckoned from the colours either side of it, the sky's on one side and the near thing's on the other (`edgeSky`, -1 where
        // there is no edge), and the cloud is put over that share alone.
        const edgeSky: N = float(-1).toVar(), edgeCol: N = vec3(0).toVar();
        If(u.uCloudOn.greaterThan(0.5), () => {
          const step2: N = vec2(1).div(screenSize).toVar();
          const at = (dx: number, dy: number): N => screenUV.add(step2.mul(vec2(dx, dy)));
          const openAt = (dx: number, dy: number): N => step(0.999999, depthOf.sample(at(dx, dy)).x);
          const oL: N = openAt(-1, 0).toVar(), oR: N = openAt(1, 0).toVar(), oU: N = openAt(0, -1).toVar(), oD: N = openAt(0, 1).toVar();
          const across: N = abs(oL.sub(oR)).greaterThan(0.5), upDown: N = abs(oU.sub(oD)).greaterThan(0.5);
          If(across.or(upDown), () => {
            const skyUV: N = select(across, select(oL.greaterThan(0.5), at(-1, 0), at(1, 0)), select(oU.greaterThan(0.5), at(0, -1), at(0, 1)));
            const nearUV: N = select(across, select(oL.greaterThan(0.5), at(1, 0), at(-1, 0)), select(oU.greaterThan(0.5), at(0, 1), at(0, -1)));
            const S: N = min(colourOf.sample(skyUV).rgb, vec3(6)).toVar(), O: N = min(colourOf.sample(nearUV).rgb, vec3(6));
            const so: N = S.sub(O).toVar();
            edgeSky.assign(clamp(dot(col.sub(O), so).div(max(dot(so, so), 1e-4)), 0, 1));
            edgeCol.assign(S);
          });
        });
        // (What the sky's colour `S` becomes with the high cloud and the heaps over it, less what it was.)
        const cloudOverSky = (S: N, ci: N, cloud: N): N => S.mul(one(ci.a)).add(ci.rgb).mul(cloud.a).add(cloud.rgb).sub(S);
        // The hollows of what is seen (`occlusionAt`), before any air is put in front of them: less in the sun's light.
        if (occlusion) {
          If(open.not().and(u.uAo.greaterThan(0)), () => {
            const sunlit = seen(this.sunDepth.depthTexture!, u.uSunVP, wp.sub(rd.mul(0.08)), 0.0025);
            col.mulAssign(mix(1, occlusionAt(), u.uAo.mul(mix(1, 0.55, sunlit))));
          });
        }
        If(open, () => {
          // Open sky. After sunset it has a faint light of its own, a glow where the sun went down,
          // and stars; then the moon; then the clouds in front of all of them.
          col.addAssign(sky.skyAfterDark(rd));
          If(u.uNight.greaterThan(0), () => {
            const g: N = rd.mul(190).toVar(), cell: N = floor(g).toVar(), f: N = fract(g).sub(0.5);
            const star: N = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453)).toVar();
            col.addAssign(vec3(0.9, 0.95, 1.1).mul(step(0.9972, star)).mul(one(smoothstep(0, 0.32, length(f)))).mul(fract(star.mul(91.7)).mul(1.6).add(0.25)).mul(u.uNight).mul(smoothstep(0.02, 0.25, rd.y)));
            const moon = smoothstep(0.99982, 0.99988, dot(rd, u.uSunDir)).mul(step(0.5, u.uNight));
            col.assign(mix(col, vec3(1.5, 1.62, 1.85).mul(fract(sin(dot(floor(rd.mul(900)), vec3(12.9, 78.2, 37.7))).mul(4375.5)).mul(0.18).add(0.82)), moon));
          });
          If(u.uCloudOn.greaterThan(0.5), () => {
            const ci: N = sky.cirrus(u.uCamPos, rd).toVar();
            const cloud: N = sky.cloudMarch(u.uCamPos, rd, dither, float(1e9)).toVar();
            // (At an edge, over the sky's share alone.)
            col.addAssign(select(edgeSky.lessThan(0), cloudOverSky(col, ci, cloud), cloudOverSky(edgeCol, ci, cloud).mul(edgeSky)));
          });
        }).ElseIf(u.uCloudOn.greaterThan(0.5).and(u.uShade.greaterThan(0)), () => {
          // Land: the shadow of whatever cloud stands between it and the sun, where the sun would
          // otherwise reach it and it lies under the sky.
          const at: N = wp.sub(rd.mul(0.08)).toVar();
          const sun = seen(this.sunDepth.depthTexture!, u.uSunVP, at, 0.0025), open2 = seen(this.skyDepth.depthTexture!, u.uSkyVP, at, 0.0025);
          // (Not what mirrors the sky, as the sea does: the sky it shows is not shaded by the cloud's shadow on it, and a cloud's shadow
          // on the water was a dark blot as on a field.)
          const mirrorShare: N = mirrors ? min(length(this.scenePass.getTextureNode('gloss').sample(screenUV).level(0).rgb.mul(2).sub(1)), 1).mul(0.85) : float(0);
          col.mulAssign(one(u.uShade.mul(sky.cloudShade(wp)).mul(mix(0.35, 1, sun)).mul(open2).mul(one(mirrorShare))));
        });
        // And on the near thing's side of an edge, the cloud over the sky's share of it.
        If(open.not().and(edgeSky.greaterThan(0.02)), () => {
          const ci: N = sky.cirrus(u.uCamPos, rd).toVar();
          const cloud: N = sky.cloudMarch(u.uCamPos, rd, dither, float(1e9)).toVar();
          col.addAssign(cloudOverSky(edgeCol, ci, cloud).mul(edgeSky));
        });
        if (mirrors) mirrored(col, view, depth, dither);
        const tMax: N = min(dist, 45).toVar();
        const dt: N = tMax.div(STEPS).toVar();
        const t: N = dt.mul(ign(screenCoordinate.xy.add(u.uFrame.mul(5.588)))).toVar();
        const c: N = dot(rd, u.uSunDir).toVar();
        const phase: N = mix(sky.phaseHG(c, float(0.55)), 0.0796, 0.35).toVar();
        const scatter: N = vec3(0).toVar(), trans: N = float(1).toVar();
        const air: N = select(u.uAirOn.greaterThan(0.5), sky.airColour(rd), vec3(0)).toVar();
        // Whether the walk ended under the sky: if it did, the mist goes on from there.
        const outside: N = float(1).toVar();
        Loop(STEPS, () => {
          const p: N = u.uCamPos.add(rd.mul(t)).toVar();
          const open3: N = seen(this.skyDepth.depthTexture!, u.uSkyVP, p, 0.0006).toVar();
          const sun: N = seen(this.sunDepth.depthTexture!, u.uSunVP, p, 0.0006).toVar();
          const held: N = vec3(0).toVar();
          // (Under the hill, though outside the house and off both maps: no sky and no sun there either.)
          const under1 = p.x.greaterThan(u.uUnderMin.x).and(p.y.greaterThan(u.uUnderMin.y)).and(p.z.greaterThan(u.uUnderMin.z)).and(p.x.lessThan(u.uUnderMax.x)).and(p.y.lessThan(u.uUnderMax.y)).and(p.z.lessThan(u.uUnderMax.z));
          const under2 = p.x.greaterThan(u.uUnder2Min.x).and(p.y.greaterThan(u.uUnder2Min.y)).and(p.z.greaterThan(u.uUnder2Min.z)).and(p.x.lessThan(u.uUnder2Max.x)).and(p.y.lessThan(u.uUnder2Max.y)).and(p.z.lessThan(u.uUnder2Max.z));
          If(under1.or(under2), () => {
            open3.assign(0); sun.assign(0); held.assign(u.uUnderAir);
          });
          // Still air indoors holds more dust than the open courtyard.
          const dens: N = u.uDensity.mul(mix(u.uIndoorDensity, 1, open3)).mul(exp(max(p.y, 0).mul(-0.06))).toVar();
          const light = u.uSunColor.mul(sun).mul(phase).add(u.uSkyColor.mul(open3).mul(0.0796)).add(held);
          // Mist is out of doors only, and is a little darker where the house's shadow lies through it. And it scatters the sun itself,
          // most of it forward: looking towards a low sun through mist it glows, and lies in shafts between the shadows of houses and
          // trees. (Lit by the air's colour alone, a misty morning street looked clear, and the shafts were faint.)
          const mist: N = select(u.uAirOn.greaterThan(0.5), mistAt(p).mul(open3), 0).toVar();
          scatter.addAssign(light.mul(dens).add(air.mul(mist).mul(mix(0.55, 1, sun))).add(u.uSunColor.mul(sun).mul(phase).mul(mist).mul(u.uMistSun)).mul(trans).mul(dt));
          trans.mulAssign(exp(dens.add(mist).mul(dt).negate()));
          outside.assign(open3);
          t.addAssign(dt);
        });
        // How far the line of sight goes before it meets the land, or the sea of cloud; and whether it ends in open sky.
        const seenTo: N = dist.toVar(), clear: N = select(open, float(1), float(0)).toVar();
        If(u.uDeck.z.greaterThan(0.5), () => {
          const deck = deckOver(u.uCamPos, rd, select(open, float(1e9), dist), dither);
          col.assign(mix(col, deck.out.xyz, deck.out.w));
          // (Where the cloud hides what is behind it, the air is reckoned only as far as the cloud.)
          If(deck.out.w.greaterThan(0.5), () => { seenTo.assign(deck.far); clear.assign(0); });
        });
        If(u.uAirOn.greaterThan(0.5), () => {
          // Beyond that walk, the air is reckoned. Open sky has its own haze already and takes only the mist.
          const thick: N = sky.airBeyond(u.uCamPos, rd, tMax, select(clear.greaterThan(0.5), 1e5, seenTo), select(clear.greaterThan(0.5), 0, seenTo)).toVar();
          const through: N = exp(thick.x.negate().sub(thick.y.mul(outside))).toVar();
          // Towards a low sun the haze itself is alight: but not where the heaps' shadows lie across the air between, so that the
          // light comes down in shafts through the gaps between them. (Read at six points along the line of sight, from a stone's
          // throw to some kilometres off, each farther than the last, as far as the land or the cloud's base.)
          const sunlitAir: N = float(1).toVar();
          If(u.uCloudOn.greaterThan(0.5).and(u.uShade.greaterThan(0)).and(c.greaterThan(0)), () => {
            const upTo: N = min(select(clear.greaterThan(0.5), float(1e5), seenTo), select(rd.y.greaterThan(0.01), u.uCloudBase.sub(u.uCamPos.y).div(max(rd.y, 0.01)), float(1e5))).toVar();
            const s: N = float(0).toVar(), n: N = float(0).toVar();
            for (let k = 0; k < 6; k++) {
              const tk: N = float(90).mul(pow(2.1, dither.add(k))), inside: N = step(tk, upTo);
              s.addAssign(one(sky.cloudShadeThin(u.uCamPos.add(rd.mul(min(tk, upTo))))).mul(inside));
              n.addAssign(inside);
            }
            sunlitAir.assign(select(n.greaterThan(0), s.div(max(n, 1)), float(1)));
          });
          col.assign(col.mul(through).add(air.mul(one(through))).add(u.uGlare.mul(sky.phaseHG(c, float(0.76))).mul(one(exp(thick.x.mul(-1.5)))).mul(mix(0.1, 1, sunlitAir))));
          // Cloud that is nearer than the land stands in front of it: so peaks go up into cloud.
          If(clear.lessThan(0.5).and(u.uCloudOn.greaterThan(0.5)), () => {
            const cloud: N = sky.cloudOver(u.uCamPos, rd, dither, seenTo, air).toVar();
            col.assign(col.mul(cloud.a).add(cloud.rgb));
          });
        });
        // Glow round local lights: how much of each line of sight lies near a lamp, reckoned outright.
        for (let i = 0; i < MAX_LIGHTS; i++) {
          const lp: N = u.uLightPos.element(i);
          const q: N = lp.xyz.sub(u.uCamPos).toVar();
          const b: N = dot(q, rd).toVar();
          const h: N = sqrt(max(dot(q, q).sub(b.mul(b)), 0.03)).toVar();
          const integral = tMax.sub(b).div(h).atan().sub(b.negate().div(h).atan()).div(h);
          scatter.addAssign(u.uLightCol.element(i).mul(integral).mul(u.uDensity).mul(u.uIndoorDensity).mul(0.0796).mul(step(0.5, lp.w)));
        }
        // A shaft of daylight under the hill: the dust in it is lit. How much of the line of sight
        // lies inside the shaft is reckoned outright, a round column cut off at both ends and at
        // whatever is looked at; so it is brightest seen through its middle and fades to its edges.
        If(u.uShaftTop.w.greaterThan(0), () => {
          const ax: N = u.uShaftDown.xyz, oc: N = u.uCamPos.sub(u.uShaftTop.xyz).toVar();
          const h0: N = dot(oc, ax).toVar(), hd: N = dot(rd, ax).toVar();
          const across: N = rd.sub(ax.mul(hd)).toVar(), from: N = oc.sub(ax.mul(h0)).toVar();
          const qa: N = dot(across, across).toVar(), qb: N = dot(across, from).toVar();
          // (Twice: the shaft itself, and a wider, fainter round of air about it that its light spills into.)
          for (const [wide, share] of [[1, 1], [2.1, 0.16]]) {
            const r = u.uShaftTop.w.mul(wide);
            const disc: N = qb.mul(qb).sub(qa.mul(dot(from, from).sub(r.mul(r)))).toVar();
            If(qa.greaterThan(1e-5).and(disc.greaterThan(0)), () => {
              const root = sqrt(disc);
              const t0: N = qb.negate().sub(root).div(qa).toVar(), t1: N = qb.negate().add(root).div(qa).toVar();
              If(abs(hd).greaterThan(1e-4), () => {
                const ta: N = h0.negate().div(hd).toVar(), tb: N = u.uShaftDown.w.sub(h0).div(hd).toVar();
                t0.assign(max(t0, min(ta, tb)));
                t1.assign(min(t1, max(ta, tb)));
              });
              t0.assign(max(t0, 0));
              t1.assign(min(t1, dist));
              If(t1.greaterThan(t0), () => {
                // Dust is not even: it hangs in slow drifts, which is what makes a shaft look like air.
                // And a line of sight that only clips the rim counts for less than its length, so the rim is soft.
                const mid: N = u.uCamPos.add(rd.mul(t0.add(t1).mul(0.5)));
                const drift = u.tCloud.sample(mid.mul(vec3(0.06, 0.018, 0.06)).add(u.uCloudDrift.mul(14))).level(0).r.mul(1.1).add(0.45);
                const soft = min(1, t1.sub(t0).div(r.mul(2)));
                scatter.addAssign(u.uShaftCol.mul(share).mul(t1.sub(t0)).mul(soft).mul(drift).mul(mix(sky.phaseHG(hd, float(0.5)), 0.0796, 0.6)));
              });
            });
          }
        });
        out.assign(vec4(col.mul(trans).add(scatter), 1));
      });
      return out;
    })();

    // The meter: how bright the scene is, sixteen readings across and nine down.
    const meter = new NodeMaterial();
    meter.depthTest = false;
    meter.depthWrite = false;
    meter.fragmentNode = Fn(() => {
      const sum: N = float(0).toVar();
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const o = vec2((i + 0.5) / 4 - 0.5, (j + 0.5) / 4 - 0.5).mul(vec2(1 / 16, 1 / 9));
        sum.addAssign(log2(max(dot(colourOf.sample(uv().add(o)).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0003)));
      }
      return vec4(vec3(clamp(sum.div(16).add(12).div(16), 0, 1)), 1);
    })();
    this.meterQuad = new QuadMesh(meter);
  }

  /** The picture of the place from the sun (`updateStatic`): its depths, and from a point of the world to where it is in it. */
  get sunMap(): { depth: DepthTexture; vp: N } {
    return { depth: this.sunDepth.depthTexture!, vp: this.uniforms.uSunVP };
  }

  /** To be called before each picture is drawn: where the eye is. */
  update(): void {
    const u = this.uniforms;
    // (The camera has been moved this frame, but its matrix is brought up to date only when the scene is drawn, after this: read
    // as it was, the sky, the cloud and the haze were drawn from where the eye was a frame ago, and slid against the land whenever
    // the view turned or moved.)
    this.camera.updateWorldMatrix(true, false);
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.uFrame.value = this.frame++ % 64;
  }

  /**
   * Average brightness of the last picture drawn, as a log-average of luminance weighted towards
   * the centre of view. Drives exposure, the way eyes adjust between sunlight and torchlight.
   * The answer arrives a frame or two later: nothing can be read back from the graphics card at once.
   */
  async measure(): Promise<number> {
    const renderer = this.renderer, was = renderer.getRenderTarget();
    renderer.setRenderTarget(this.meterTarget);
    this.meterQuad.render(renderer);
    renderer.setRenderTarget(was);
    const pixels = (await renderer.readRenderTargetPixelsAsync(this.meterTarget, 0, 0, 16, 9)) as Uint8Array;
    let sum = 0, wsum = 0;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 8, dy = (y - 4) / 4.5;
      const w = 1.2 - 0.7 * Math.min(1, dx * dx + dy * dy);
      sum += (pixels[(y * 16 + x) * 4] / 255) * w;
      wsum += w;
    }
    return Math.pow(2, (sum / wsum) * 16 - 12);
  }

  /**
   * Draws the two static depth maps. Call again if the site or the sun changes.
   *
   * `statics` are drawn into both: the house and the solids behind its skin. What else throws a shadow out of doors goes into the
   * sun's alone (`more.sun`: the land, its rock, what is built on it, trunks and boughs; and `more.own`, drawn with their own
   * materials so that what is cut out of a card is cut out of its shadow too: the crowns of trees). Without them the air was lit by
   * the sun in the shadow of every cliff, building and tree, and mist in the morning lay as bright under a wood as over a meadow;
   * with them it is dark there, and where the sun comes in between trunks and through gaps in the crowns the mist is lit in shafts.
   * (Nor did the shadow of a cloud know where the land was already in shade, and darkened it twice.) The map of what is under open
   * sky is left as it was: from above, a crown is not a roof, and mist lies under trees as it does in the open.
   */
  updateStatic(statics: Object3D[], sunDir: Vector3, min: Vector3, max: Vector3, more: { sun?: Object3D[]; own?: Object3D[] } = {}): void {
    const renderer = this.renderer;
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const radius = max.clone().sub(min).length() / 2;
    const override = new MeshBasicMaterial({ side: DoubleSide });
    const sun = more.sun ?? [], own = more.own ?? [];
    const keep = new Set<Object3D>([...statics, ...sun, ...own]);
    const hidden: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o !== this.scene && o.visible && !o.children.length && !keep.has(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    // (Each set shown only while it is being drawn, and left as it was found.)
    const was = new Map<Object3D, boolean>([...keep].map((o) => [o, o.visible]));
    const show = (list: Object3D[], on: boolean) => { for (const o of list) o.visible = on && was.get(o)!; };
    const prevBg = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = override;

    const shoot = (target: RenderTarget, dir: Vector3, up: Vector3, vp: Matrix4, then?: (cam: OrthographicCamera) => void) => {
      const cam = new OrthographicCamera(-radius, radius, radius, -radius, 0.5, radius * 2 + 1);
      cam.position.copy(centre).addScaledVector(dir, radius + 0.5);
      cam.up.copy(up);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.scene, cam);
      then?.(cam);
      // (Taken after the drawing: the renderer sets the camera to its own graphics interface's way of reckoning depth.)
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    };
    const shadowsWere = renderer.shadowMap.enabled, clearWas = renderer.autoClear;
    renderer.shadowMap.enabled = false;
    show(own, false);
    shoot(this.sunDepth, sunDir, new Vector3(0, 1, 0), this.uniforms.uSunVP.value, own.length ? (cam) => {
      // The crowns, each with its own material, over what is already drawn.
      show(statics, false); show(sun, false); show(own, true);
      this.scene.overrideMaterial = null;
      renderer.autoClear = false;
      renderer.render(this.scene, cam);
      renderer.autoClear = clearWas;
      this.scene.overrideMaterial = override;
      show(own, false); show(statics, true);
    } : undefined);
    show(sun, false);
    shoot(this.skyDepth, new Vector3(0, 1, 0), new Vector3(0, 0, -1), this.uniforms.uSkyVP.value);
    renderer.shadowMap.enabled = shadowsWere;
    renderer.setRenderTarget(null);

    this.scene.overrideMaterial = null;
    this.scene.background = prevBg;
    for (const o of hidden) o.visible = true;
    show(statics, true); show(sun, true); show(own, true);
    override.dispose();
    this.uniforms.uSunDir.value.copy(sunDir);
  }

  setLights(lights: FogLight[]): void {
    const at = this.uniforms.uLightPos.array as Vector4[], colour = this.uniforms.uLightCol.array as Vector3[];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = lights[i];
      if (l) {
        at[i].set(l.position.x, l.position.y, l.position.z, 1);
        colour[i].copy(l.color);
      } else {
        at[i].set(0, 0, 0, 0);
        colour[i].set(0, 0, 0);
      }
    }
  }

  dispose(): void {
    this.sunDepth.dispose();
    this.skyDepth.dispose();
    this.meterTarget.dispose();
  }
}

function depthTarget(size: number): RenderTarget {
  const rt = new RenderTarget(size, size, { depthBuffer: true });
  rt.texture.minFilter = NearestFilter;
  rt.texture.magFilter = NearestFilter;
  rt.depthTexture = new DepthTexture(size, size, FloatType);
  rt.depthTexture.minFilter = NearestFilter;
  rt.depthTexture.magFilter = NearestFilter;
  return rt;
}

/** A block of noise with nothing in it, to stand where the clouds' noise will be put. */
function blankNoise(): Data3DTexture {
  const blank = new Data3DTexture(new Uint8Array(1), 1, 1, 1);
  blank.format = RedFormat;
  blank.needsUpdate = true;
  return blank;
}

/**
 * The finished picture smoothed over the frames (temporal anti-aliasing, three's `TRAANode`). Each frame is drawn from a fraction of
 * a point aside from the last, in a round of thirty-two, and laid over what was drawn before, moved to where each point of it now is;
 * where what was there before is not what is there now (something has come out from behind something else, or moved too far), the
 * new frame is taken alone. So an edge is drawn at many places within its point and comes out smooth, a fine line of leaves or rail
 * does not flicker in and out as the view moves, and the patterns of noise that the cloud, the mist and the hollows are reckoned
 * through, a new one each frame, are averaged into a smooth whole: on a plain wall they showed as a fine stipple.
 */
export function smoothOverFrames(picture: N, atmosphere: Atmosphere, camera: PerspectiveCamera): N {
  const p: N = atmosphere.scenePass;
  return traa(picture, p.getTextureNode('depth'), p.getTextureNode('velocity'), camera);
}

/**
 * Readies what is drawn to be smoothed over the frames (see `smoothOverFrames`): each point of the picture is drawn once, so nothing
 * is cut out by coverage, which needs several (a leaf cut so is drawn as far out as its picture has any opacity at all, and the
 * crowns came out heavy); it is cut at its edge instead, which the frames, each drawn a fraction of a point aside, then smooth. And
 * what is moved into place by a program of its own (cards of leaves and grass set out on the land, birds, the sea's waves) is said
 * to have been where it is now in the frame before as well: otherwise how far it had moved on the screen was reckoned from where its
 * card lies before it is set out, nowhere near, and the frames before were thrown away there, which is where they are most needed.
 * (The sway of a leaf in the wind from one frame to the next is far less than a point.) And what is coloured by a program of its own
 * (water, the sea, spray, flames) has that program made its output, not the whole of what it draws: three gives such a program a
 * picture of one colour to draw into, and drawn so into the scene, which now has two (the colour, and how far each point has moved),
 * it was refused and nothing at all was drawn.
 *
 * (Nor is what is set out by such a program and drawn many times over, as the cards are, given three's copy of where each of its
 * many was the frame before: it is not wanted, its place being said as above, and it cost a buffer more than the graphics card
 * allows the sprigs of leaves, which then were not drawn, and a copy of every card's place on every frame.)
 */
export function readyForSmoothing(scene: Object3D): void {
  const builder = NodeBuilder.prototype as N;
  if (!builder.heldStillKnown) {
    const was = builder.needsPreviousData;
    builder.needsPreviousData = function (this: N): boolean {
      return was.call(this) && !(this.object?.isInstancedMesh && this.material?.positionNode?.heldStill);
    };
    builder.heldStillKnown = true;
  }
  const seen = new Set<object>();
  scene.traverse((o) => {
    const list = (o as N).material;
    for (const m of Array.isArray(list) ? list : list ? [list] : []) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.alphaToCoverage) { m.alphaToCoverage = false; m.needsUpdate = true; }
      if (m.fragmentNode && !m.fragmentNode.isOutputStructNode) {
        m.outputNode = m.fragmentNode;
        m.fragmentNode = null;
        m.needsUpdate = true;
      }
      const placed: N = m.positionNode;
      if (placed && !placed.heldStill) {
        const held: N = Fn(() => {
          const at: N = vec3(placed).toVar();
          positionPrevious.assign(at);
          return at;
        })();
        held.heldStill = true;
        m.positionNode = held;
      }
    }
  });
}
