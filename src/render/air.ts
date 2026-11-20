import { Color, CubeCamera, DirectionalLight, HalfFloatType, LinearMipmapLinearFilter, PerspectiveCamera, Scene, Vector3 } from 'three';
import { CubeRenderTarget, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { rtt } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { cloudNoise } from './clouds';
import { Atmosphere, smoothOverFrames } from './post';

/**
 * The sky and the air, as the game draws them about a place and the world's pages draw them over the world (`docs/06-world.md`, *The
 * world as the game*, step 3: one renderer). What differs between them is said where it is called: how big the sky is, how thick the
 * air is with distance, where the floor is that cloud and mist are reckoned from. Everything else, the sky's painting, the clouds, the
 * hollows of what is seen, the smoothing over frames, the glow, the weather, is this one code, so that what is done for the game's
 * places is done for the world too.
 */

/**
 * How much detail to draw. Chosen on the game's opening card and remembered (`dungeons.quality`); a parameter in the address overrides
 * any one setting. Touch devices start a step lower, since their screens are dense and their graphics modest.
 * (`ao`: whether the hollows of what is seen darken it, see `occlusion` in `post.ts`. `mirror`: how many points high still water's
 * picture is at most, see `Water.update`; it was as high as the view, and is now at most half a common screen's at high.)
 */
export const QUALITY = {
  low: { dpr: 1, tex: 512, rays: 12, grass: 40, bloom: 0, leaves: 0.5, clouds: 0, mirror: 0, ao: 0 },
  medium: { dpr: 1.25, tex: 1024, rays: 16, grass: 55, bloom: 1, leaves: 0.75, clouds: 16, mirror: 384, ao: 1 },
  high: { dpr: 1.5, tex: 1024, rays: 32, grass: 80, bloom: 1, leaves: 1, clouds: 28, mirror: 512, ao: 1 },
  // As high, with surfaces painted at 2048: four times the painting time and about a gigabyte of video memory, for desktops with room to spare.
  ultra: { dpr: 1.5, tex: 2048, rays: 32, grass: 80, bloom: 1, leaves: 1, clouds: 28, mirror: 1080, ao: 1 },
};
export type QualityName = keyof typeof QUALITY;

/** The level of detail asked for in the address, else the one last chosen in the game, else high (medium on a touch screen). */
export function qualityChosen(params: URLSearchParams): QualityName {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const remembered = (() => { try { return localStorage.getItem('dungeons.quality'); } catch { return null; } })();
  const wanted = params.get('quality') ?? remembered ?? (coarse ? 'medium' : 'high');
  return (wanted in QUALITY ? wanted : 'high') as QualityName;
}

/** The light of the hour: the sun's colour and strength, the sky's colours, where the sun's disc is (after sunset, not where the light comes from), and how far into night. */
export interface Daylight {
  colour: Color; intensity: number;
  sky: { zenith: number[]; horizon: number[] };
  disc?: number[];
  night: number;
}

/** The sky's mean colour, which shaded cloud, the sea's deeps and the air at a distance are made from. */
export const skyMean = (d: Daylight) => [0, 1, 2].map((c) => 0.55 * d.sky.zenith[c] + 0.45 * d.sky.horizon[c]);

/**
 * The sky, drawn for where the sun itself is. Its own painted clouds are used only when the real ones are turned off (`clouds`); its
 * sun's disc only in the sky seen, not the one the light and the air's picture of it are taken from.
 */
export function skyMesh(sunDir: Vector3, d: Daylight, o: { clouds: boolean; disc: boolean; size?: number }): SkyMesh {
  const sky = new SkyMesh();
  sky.scale.setScalar(o.size ?? 10000);
  sky.turbidity.value = 3.2;
  sky.rayleigh.value = 1.4;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.82;
  if (d.disc) sky.sunPosition.value.set(d.disc[0], d.disc[1], d.disc[2]).normalize();
  else sky.sunPosition.value.copy(sunDir);
  sky.cloudCoverage.value = o.clouds ? 0 : 0.32;
  sky.cloudDensity.value = 0.5;
  sky.showSunDisc.value = o.disc ? 1 : 0;
  return sky;
}

/**
 * The picture, made in steps: the scene; the air put into it (`Atmosphere`, with `clouds` steps through the cloud, the hollows of
 * what is seen if `occlusion`, wet ground mirroring what stands about it if `mirrors`); smoothed over the frames if `temporal` (else
 * each point is drawn four times: see `smoothOverFrames`); the glow of what is very bright added if `bloom`; and last the eye's
 * adjustment to light and the screen's colours, which the pipeline does itself. (The air is drawn once into a picture of its own,
 * which the smoothing and the glow then read; otherwise it would be worked out again for each. It is smoothed before the glow is
 * added, so that the glow is of the smooth picture.)
 */
export function airPipeline(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, o: { clouds: number; occlusion: boolean; temporal: boolean; mirrors: boolean; bloom: boolean }): { atmosphere: Atmosphere; pipeline: RenderPipeline } {
  const pipeline = new RenderPipeline(renderer);
  const atmosphere = new Atmosphere(scene, camera, renderer, Math.max(1, o.clouds), { occlusion: o.occlusion, temporal: o.temporal, mirrors: o.mirrors });
  const aired = rtt(atmosphere.node);
  const smooth: typeof aired = o.temporal ? smoothOverFrames(aired, atmosphere, camera) : aired;
  pipeline.outputNode = o.bloom ? smooth.add(bloom(smooth, 0.14, 0.5, 1.8)) : smooth;
  return { atmosphere, pipeline };
}

/**
 * The air lit for the hour: the sun's and the sky's light in it; the clouds, if drawn (`clouds` steps), as bright as a white wall in
 * the same light where lit and the sky's colour where shaded; after sunset the night's own sky; and what the land fades into at a
 * distance, which is the sky itself low down in whatever direction is looked in: so the sky without the sun's disc (`envScene`) is
 * drawn once into a small picture that the haze reads.
 */
export function lightAir(atmosphere: Atmosphere, renderer: WebGPURenderer, envScene: Scene, d: Daylight, o: { clouds: number; cloud: number }): void {
  const u = atmosphere.uniforms, mean = skyMean(d);
  u.uSunColor.value.set(d.colour.r, d.colour.g, d.colour.b).multiplyScalar(d.intensity * 1.7);
  u.uSkyColor.value.set(mean[0], mean[1], mean[2]).multiplyScalar(1.75);
  if (o.clouds > 0) {
    u.tCloud.value = cloudNoise(64);
    u.uCloudOn.value = 1;
    u.uCloudCover.value = o.cloud;
    u.uCloudSun.value.set(d.colour.r, d.colour.g, d.colour.b).multiplyScalar(d.intensity * 0.19);
    u.uCloudAir.value.set(mean[0], mean[1], mean[2]).multiplyScalar(0.95);
    u.uShade.value = d.night > 0.2 ? 0.35 : 0.55;
  }
  if (d.disc) {
    // After sunset the daytime sky gives next to nothing, and the night's own is added.
    u.uSkyZenith.value.set(d.sky.zenith[0], d.sky.zenith[1], d.sky.zenith[2]);
    u.uSkyHorizon.value.set(d.sky.horizon[0], d.sky.horizon[1], d.sky.horizon[2]);
    u.uGlowDir.value.set(d.disc[0], d.disc[1], d.disc[2]);
    u.uGlow.value.set(0.55, 0.22, 0.14).multiplyScalar(d.night > 0.9 ? 0.05 : 1);
    u.uNight.value = d.night;
  }
  const skyPicture = new CubeRenderTarget(64, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  new CubeCamera(1, 20000, skyPicture).update(renderer, envScene);
  u.tSky.value = skyPicture.texture;
  u.uAirOn.value = 1;
}

/** The weather: how much of the sky is cloud and whether it heaps up or lies in banks, how much mist lies in the low ground, how thick the air is with distance, and rain, 0 to 1. */
export interface Weather { cloud: number; layered: boolean; mist: number; haze: number; rain?: number }

/**
 * The weather put into the air (and the sun dimmed behind rain): all of it read by the air as it is drawn, so it can be changed as one
 * watches. `floor` is the ground the cloud's height and the mist are reckoned from; `low` a low sun, which has more air to shine
 * through; `deck` a sea of cloud below (a mountain top), above which the air is thin and clear and the cloud below is the mist;
 * `groundLow` the lowest ground there is mist on; `thin` how much thinner the haze is than a valley's (the world's pages, where the
 * eye sees ten kilometres, not one).
 */
export function weatherOf(atmosphere: Atmosphere, sun: DirectionalLight, d: Daylight, w0: Weather, o: { floor: number; low: boolean; deck?: boolean; groundLow?: number; thin?: number }): void {
  // (Rain comes out of heavy cloud, low and in banks; the air is thick with it; and the sun is behind it.)
  const r = w0.rain ?? 0;
  const w = { ...w0, cloud: r > 0 ? Math.max(w0.cloud, 0.7 + 0.3 * r) : w0.cloud, layered: w0.layered || r > 0.3, haze: Math.min(1, w0.haze + 0.4 * r), mist: Math.max(w0.mist, 0.3 * r) };
  sun.intensity = d.intensity * (1 - 0.72 * r);
  const u = atmosphere.uniforms, { floor, low, deck } = o, { haze, mist, layered } = w;
  u.uSunColor.value.set(d.colour.r, d.colour.g, d.colour.b).multiplyScalar(d.intensity * 1.7 * (1 - 0.72 * r));
  u.uCloudCover.value = w.cloud;
  // Haze: thin enough that the valley is clear across, thick enough that each range of hills
  // is paler than the one in front of it. A low sun has more air to shine through.
  // (Above a sea of cloud the air is thin and clear: the haze of the low country is under the cloud.)
  // (And it lies thickest in the valleys far below, which is what makes them blue.)
  const thin = o.thin ?? 1;
  u.uHaze.value.set((0.00014 + 0.001 * haze * haze) * thin * (low ? 1.35 : 1) * (deck ? 0.75 : 1), 320, deck ? floor - 420 : floor);
  // Mist: a few metres deep on the valley floor, from a veil to a fog.
  u.uMist.value.set(mist < 0.08 ? 0 : 0.045 * mist * mist, 2.2 + 3.2 * mist, floor - 0.4);
  u.uMistLow.value = o.groundLow !== undefined ? o.groundLow - 0.5 : -1e6;
  // And in the country beyond the valley, on its own higher ground, from some way out.
  u.uMistFar.value.set(mist < 0.08 ? 0 : 0.006 * mist, 14 + 8 * mist, floor + 26, 175);
  // (On a mountain top the cloud below is the mist, and there is no other: a veil over the cloud made a grey sea of it.)
  if (deck) { u.uMist.value.x = 0; u.uMistFar.value.x = 0; }
  // The haze is alight towards the sun only while the sun is up.
  if (!d.disc || d.disc[1] > 0) u.uGlare.value.set(d.colour.r, d.colour.g, d.colour.b).multiplyScalar(d.intensity * 0.018 * (0.4 + haze) * (1 - 0.8 * r));
  else u.uGlare.value.set(0, 0, 0);
  // In flat banks cloud is a thin layer, low, and the more of it there is the lower it hangs. Heaped, it stands high and tall:
  // fair-weather cloud has its flat base some eight hundred metres up and heaps a kilometre or two over it, the most when the sky
  // is half covered and more, when the heaps have the warmth and the room to tower; as the sky closes over they hang lower. (It
  // was a layer three hundred and sixty metres deep two or three hundred metres up, whatever the day: small soft heaps, hanging
  // low over the roofs like smoke, never the towers of a summer's afternoon.)
  const c = w.cloud, sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // (Banks are some two hundred and thirty metres deep, in a layer of four hundred and twenty, each riding at its own height in it:
  // see `layerAt` in `post.ts`. They were one layer a hundred and fifty metres deep, everywhere at one height: flat slabs.)
  if (layered) {
    u.uCloudBase.value = floor + 300 - 150 * c;
    u.uCloudTop.value = u.uCloudBase.value + 420;
  } else {
    u.uCloudBase.value = floor + 600 + 350 * (1 - c) - 250 * r;
    u.uCloudTop.value = u.uCloudBase.value + 700 + 1400 * sm(0.2, 0.55, c) * (1 - 0.5 * sm(0.75, 1, c));
  }
  u.uCloudFlat.value = layered ? 1 : 0;
  // And far over it, when the weather is fair or changing, thin streaks of ice cloud.
  u.uCirrus.value = r > 0 ? 0 : (layered ? 0.25 : 0.6) * sm(0.08, 0.35, c) * (1 - sm(0.7, 0.92, c));
}

/** The wind carries the clouds across, slowly, and turns them over as they go: each frame, at `time` seconds. */
export function driftClouds(atmosphere: Atmosphere, time: number): void {
  atmosphere.uniforms.uCloudDrift.value.set(time * 0.0042, time * 0.0006, time * 0.0017);
}

/**
 * How many textures a program may read at once, if asked for when the device is made (a program may read sixteen unless more are
 * asked for). The ground's material reads sixteen already, with the sun's shadow, the torches' and the sky's picture; the sun's shadow
 * read near and far (`SunShadow`) needs one more. Most graphics cards allow far more. Sixteen with WebGL (`webgl`).
 */
export async function textureRoom(webgl: boolean): Promise<number> {
  if (webgl) return 16;
  try { return (await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }))?.limits.maxSampledTexturesPerShaderStage ?? 16; } catch { return 16; }
}
