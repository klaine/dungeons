import {
  Camera, DepthTexture, DoubleSide, FloatType, HalfFloatType, Matrix4, MeshBasicMaterial, NearestFilter, Object3D,
  OrthographicCamera, PerspectiveCamera, Scene, ShaderMaterial, UnsignedByteType, UnsignedIntType, Vector3, Vector4,
  WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Renders the scene, then marches each view ray through the air to add fog that is lit by the sun
 * where the sun reaches. That is what makes shafts of light visible through doors and windows.
 *
 * Two depth maps of the static site are rendered once: one from the sun, to know where its light
 * reaches, and one from straight above, to know where the air is under open sky.
 *
 * The same pass makes the sky's weather. Clouds are a layer of air some hundreds of metres up
 * whose thickness at any point is read from a block of noise that drifts with the wind. Looking
 * up, each view ray is marched through the layer, and at every step a second, shorter march
 * towards the sun finds how much cloud the light came through: so clouds have lit sides, dark
 * bases and bright edges against the sun. Looking at the land, the same question is asked of the
 * line from each point to the sun, and the answer is the shadow of the cloud passing over it.
 * After dark the stars and the moon are drawn here too, behind the clouds.
 */

const MAX_LIGHTS = 4;

export interface FogLight {
  position: Vector3;
  color: Vector3;
}

export class AtmospherePass extends Pass {
  readonly sceneTarget: WebGLRenderTarget;
  readonly uniforms: Record<string, { value: any }>;
  private quad: FullScreenQuad;
  private sunDepth: WebGLRenderTarget;
  private skyDepth: WebGLRenderTarget;
  private frame = 0;
  private meterTarget = new WebGLRenderTarget(16, 9, { type: UnsignedByteType, depthBuffer: false });
  private meterPixels = new Uint8Array(16 * 9 * 4);
  private meterQuad: FullScreenQuad;

  constructor(private scene: Scene, private camera: PerspectiveCamera, width: number, height: number, cloudSteps = 28) {
    super();
    this.sceneTarget = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 });
    this.sceneTarget.depthTexture = new DepthTexture(width, height, UnsignedIntType);
    this.sunDepth = depthTarget(2048);
    this.skyDepth = depthTarget(1024);

    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      tSunDepth: { value: this.sunDepth.depthTexture },
      tSkyDepth: { value: this.skyDepth.depthTexture },
      uInvProj: { value: new Matrix4() },
      uInvView: { value: new Matrix4() },
      uSunVP: { value: new Matrix4() },
      uSkyVP: { value: new Matrix4() },
      uCamPos: { value: new Vector3() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Vector3(1, 1, 1) },
      uSkyColor: { value: new Vector3(0.5, 0.6, 0.8) },
      uDensity: { value: 0.012 },
      uIndoorDensity: { value: 2.6 },
      uFrame: { value: 0 },
      uEnabled: { value: 1 },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
      // The weather. With no block of noise given, there are no clouds.
      tCloud: { value: null },
      uCloudOn: { value: 0 },
      uCloudCover: { value: 0.45 },
      uCloudBase: { value: 260 },
      uCloudTop: { value: 620 },
      uCloudDrift: { value: new Vector3() },
      uCloudSun: { value: new Vector3(3, 3, 3) },
      uCloudAir: { value: new Vector3(0.5, 0.6, 0.8) },
      uShade: { value: 0.5 },
      // The sky after dark: its own faint light, the glow where the sun went down, stars and moon.
      uSkyZenith: { value: new Vector3() },
      uSkyHorizon: { value: new Vector3() },
      uGlowDir: { value: new Vector3(0, 0, 1) },
      uGlow: { value: new Vector3() },
      uNight: { value: 0 },
    };

    this.quad = new FullScreenQuad(new ShaderMaterial({
      uniforms: this.uniforms,
      defines: { MAX_LIGHTS, STEPS: 40, CLOUD_STEPS: cloudSteps },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    }));

    this.meterQuad = new FullScreenQuad(new ShaderMaterial({
      uniforms: { tColor: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
void main() {
  float sum = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
    vec3 c = texture2D(tColor, vUv + o * vec2(1.0 / 16.0, 1.0 / 9.0)).rgb;
    sum += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0003));
  }
  gl_FragColor = vec4(vec3(clamp((sum / 16.0 + 12.0) / 16.0, 0.0, 1.0)), 1.0);
}`,
      depthTest: false,
      depthWrite: false,
    }));
  }

  /**
   * Average brightness of the last frame drawn, as a log-average of luminance weighted towards
   * the centre of view. Drives exposure, the way eyes adjust between sunlight and torchlight.
   */
  measure(renderer: WebGLRenderer): number {
    this.drawMeter(renderer);
    renderer.readRenderTargetPixels(this.meterTarget, 0, 0, 16, 9, this.meterPixels);
    return this.meterValue();
  }

  /** As `measure`, without stalling the frame: the answer arrives a frame or two later. */
  async measureAsync(renderer: WebGLRenderer): Promise<number> {
    this.drawMeter(renderer);
    await renderer.readRenderTargetPixelsAsync(this.meterTarget, 0, 0, 16, 9, this.meterPixels);
    return this.meterValue();
  }

  private drawMeter(renderer: WebGLRenderer): void {
    (this.meterQuad.material as ShaderMaterial).uniforms.tColor.value = this.sceneTarget.texture;
    renderer.setRenderTarget(this.meterTarget);
    this.meterQuad.render(renderer);
    renderer.setRenderTarget(null);
  }

  private meterValue(): number {
    let sum = 0, wsum = 0;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 8, dy = (y - 4) / 4.5;
      const w = 1.2 - 0.7 * Math.min(1, dx * dx + dy * dy);
      sum += (this.meterPixels[(y * 16 + x) * 4] / 255) * w;
      wsum += w;
    }
    return Math.pow(2, (sum / wsum) * 16 - 12);
  }

  /** Renders the two static depth maps. Call again if the site or the sun changes. */
  updateStatic(renderer: WebGLRenderer, statics: Object3D[], sunDir: Vector3, min: Vector3, max: Vector3): void {
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const radius = max.clone().sub(min).length() / 2;
    const override = new MeshBasicMaterial({ side: DoubleSide });
    const hidden: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o !== this.scene && o.visible && !o.children.length && !statics.includes(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const prevBg = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = override;

    const shoot = (target: WebGLRenderTarget, dir: Vector3, up: Vector3, vp: Matrix4) => {
      const cam = new OrthographicCamera(-radius, radius, radius, -radius, 0.5, radius * 2 + 1);
      cam.position.copy(centre).addScaledVector(dir, radius + 0.5);
      cam.up.copy(up);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.scene, cam);
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    };
    const shadowsWere = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    shoot(this.sunDepth, sunDir, new Vector3(0, 1, 0), this.uniforms.uSunVP.value);
    shoot(this.skyDepth, new Vector3(0, 1, 0), new Vector3(0, 0, -1), this.uniforms.uSkyVP.value);
    renderer.shadowMap.enabled = shadowsWere;
    renderer.setRenderTarget(null);

    this.scene.overrideMaterial = null;
    this.scene.background = prevBg;
    for (const o of hidden) o.visible = true;
    override.dispose();
    this.uniforms.uSunDir.value.copy(sunDir);
  }

  setLights(lights: FogLight[]): void {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = lights[i];
      if (l) {
        this.uniforms.uLightPos.value[i].set(l.position.x, l.position.y, l.position.z, 1);
        this.uniforms.uLightCol.value[i].copy(l.color);
      } else {
        this.uniforms.uLightPos.value[i].set(0, 0, 0, 0);
        this.uniforms.uLightCol.value[i].set(0, 0, 0);
      }
    }
  }

  override setSize(width: number, height: number): void {
    this.sceneTarget.setSize(width, height);
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, _readBuffer: WebGLRenderTarget): void {
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera as Camera);

    const u = this.uniforms;
    u.tColor.value = this.sceneTarget.texture;
    u.tDepth.value = this.sceneTarget.depthTexture;
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.uFrame.value = this.frame++ % 64;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.sceneTarget.dispose();
    this.sunDepth.dispose();
    this.skyDepth.dispose();
    this.meterTarget.dispose();
    this.meterQuad.dispose();
    this.quad.dispose();
  }
}

function depthTarget(size: number): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(size, size, { depthBuffer: true });
  rt.texture.minFilter = NearestFilter;
  rt.texture.magFilter = NearestFilter;
  rt.depthTexture = new DepthTexture(size, size, FloatType);
  rt.depthTexture.minFilter = NearestFilter;
  rt.depthTexture.magFilter = NearestFilter;
  return rt;
}

/**
 * The clouds, as shader code: what they are made of and how a line of sight is walked through
 * them. It is used where the sky is drawn and again where still water mirrors it, so that the
 * clouds in a lake are the clouds over it.
 */
export const CLOUDS = /* glsl */ `
uniform sampler3D tCloud;
uniform float uCloudCover, uCloudBase, uCloudTop;
uniform vec3 uCloudDrift, uCloudSun, uCloudAir, uSunDir;

float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// How thick the cloud is at a point, as the light lost per metre. Clouds have flat bases and
// rounded tops, cover as much of the sky as the day calls for, and are frayed at their edges.
float cloudAt(vec3 p, bool fine) {
  float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 q = p / 1150.0 + uCloudDrift;
  float shape = texture(tCloud, q).r;
  // The more of the sky the day gives to cloud, the lower the bar a piece of air must clear to
  // be cloud. The bar rises with height, so a cloud is broad at its flat base and only its
  // strongest parts tower; and nothing hangs below the base.
  // (The numbers are measured from the noise: at its base, cloud covers the share of sky asked for.)
  float bar = 0.535 - 0.33 * uCloudCover + 0.26 * pow(h, 1.4) + 0.6 * (1.0 - smoothstep(0.0, 0.07, h));
  if (shape < bar - 0.1) return 0.0;
  // Smaller billows on the large ones give it the knobbly outline of a heap of cloud.
  shape -= (1.0 - texture(tCloud, q * 3.9 + 0.37).g) * 0.2 - 0.07;
  float d = (shape - bar) / 0.1;
  if (d <= 0.0) return 0.0;
  // And its edges are eaten away by finer noise still; the body of the cloud is left whole.
  if (fine) d -= (1.0 - texture(tCloud, q * 12.3 + 0.11).g) * (1.0 - min(d, 1.0)) * 0.8;
  return clamp(d, 0.0, 1.0) * 0.036;
}

// The share of sunlight a cloud takes from a point on the land: 0 under clear sky.
float cloudShade(vec3 p) {
  if (uSunDir.y < 0.04) return 0.0;
  float through = 0.0;
  for (int j = 0; j < 3; j++) {
    float h = mix(uCloudBase, uCloudTop, 0.22 + 0.22 * float(j));
    through += cloudAt(p + uSunDir * ((h - p.y) / uSunDir.y), false);
  }
  through *= (uCloudTop - uCloudBase) / 3.0 / max(uSunDir.y, 0.2);
  return 1.0 - exp(-through * 1.1);
}

// Clouds along a line of sight: the light they send, and the share of what is behind them
// that still comes through.
vec4 cloudMarch(vec3 ro, vec3 rd, float jitter) {
  if (rd.y < 0.015) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = max((uCloudBase - ro.y) / rd.y, 0.0), t1 = min((uCloudTop - ro.y) / rd.y, 14000.0);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = (t1 - t0) / float(CLOUD_STEPS);
  float t = t0 + dt * jitter;
  float toSun = dot(rd, uSunDir);
  // Light goes mostly forward through cloud, so edges towards the sun are bright.
  float phase = min(0.55 + 3.2 * mix(phaseHG(toSun, 0.7), phaseHG(toSun, -0.15), 0.25), 2.4);
  float left = 1.0;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = cloudAt(p, true);
    if (d > 0.0) {
      float through = 0.0;
      for (int j = 1; j <= 4; j++) through += cloudAt(p + uSunDir * (28.0 * float(j) * float(j) * 0.5), false);
      // Cloud passes on far more light than its thickness alone would let through: it scatters, and scatters again.
      through *= 9.0;
      float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
      vec3 light = uCloudSun * phase * (exp(-through) * 0.8 + exp(-through * 0.2) * 0.2) + uCloudAir * (0.5 + 0.6 * h);
      float a = 1.0 - exp(-d * dt);
      lit += left * a * light;
      left *= 1.0 - a;
      if (left < 0.02) break;
    }
    t += dt;
  }
  // Far cloud sinks into the haze at the horizon.
  float near = exp(-t0 / 9000.0) * smoothstep(0.015, 0.1, rd.y);
  return vec4(lit * near, mix(1.0, left, near));
}

`;

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tSunDepth;
uniform sampler2D tSkyDepth;
uniform mat4 uInvProj, uInvView, uSunVP, uSkyVP;
uniform vec3 uCamPos, uSunColor, uSkyColor;
uniform float uDensity, uIndoorDensity, uFrame, uEnabled;
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec3 uLightCol[MAX_LIGHTS];
uniform float uCloudOn, uShade, uNight;
uniform vec3 uSkyZenith, uSkyHorizon, uGlowDir, uGlow;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// 1 where the point is nearer the map's eye than the first surface, i.e. lit or under open sky.
float seen(sampler2D map, mat4 vp, vec3 p, float bias) {
  vec4 c = vp * vec4(p, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  return step(s.z - bias, texture2D(map, s.xy).x);
}

${CLOUDS}
void main() {
  // The sun's disc is thousands of times brighter than anything else; left alone, bloom spreads it over the whole view.
  vec3 col = min(texture2D(tColor, vUv).rgb, vec3(6.0));
  if (uEnabled < 0.5) { gl_FragColor = vec4(col, 1.0); return; }
  float depth = texture2D(tDepth, vUv).x;
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = (uInvView * vec4(v.xyz / v.w, 1.0)).xyz;
  vec3 rd = wp - uCamPos;
  float dist = length(rd);
  rd /= dist;
  if (depth > 0.999999) {
    // Open sky. After sunset it has a faint light of its own, a glow where the sun went down,
    // and stars; then the moon; then the clouds in front of all of them.
    float up = clamp(rd.y, 0.0, 1.0);
    col += mix(uSkyHorizon, uSkyZenith, pow(up, 0.45));
    col += uGlow * pow(max(dot(normalize(rd.xz), normalize(uGlowDir.xz)), 0.0), 4.0) * exp(-up * 5.5);
    if (uNight > 0.0) {
      vec3 g = rd * 190.0, c = floor(g), f = fract(g) - 0.5;
      float star = fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      col += vec3(0.9, 0.95, 1.1) * step(0.9972, star) * smoothstep(0.32, 0.0, length(f)) * (0.25 + 1.6 * fract(star * 91.7)) * uNight * smoothstep(0.02, 0.25, rd.y);
      float moon = smoothstep(0.99982, 0.99988, dot(rd, uSunDir)) * step(0.5, uNight);
      col = mix(col, vec3(1.5, 1.62, 1.85) * (0.82 + 0.18 * fract(sin(dot(floor(rd * 900.0), vec3(12.9, 78.2, 37.7))) * 4375.5)), moon);
    }
    if (uCloudOn > 0.5) { vec4 cloud = cloudMarch(uCamPos, rd, ign(gl_FragCoord.xy)); col = col * cloud.a + cloud.rgb; }
  } else if (uCloudOn > 0.5 && uShade > 0.0) {
    // Land: the shadow of whatever cloud stands between it and the sun, where the sun would
    // otherwise reach it and it lies under the sky.
    vec3 at = wp - rd * 0.08;
    float sun = seen(tSunDepth, uSunVP, at, 0.0025), sky = seen(tSkyDepth, uSkyVP, at, 0.0025);
    col *= 1.0 - uShade * cloudShade(wp) * mix(0.35, 1.0, sun) * sky;
  }
  float tMax = min(dist, 45.0);
  float dt = tMax / float(STEPS);
  float t = dt * ign(gl_FragCoord.xy + uFrame * 5.588);
  float c = dot(rd, uSunDir);
  float phase = mix(phaseHG(c, 0.55), 0.0796, 0.35);
  vec3 scatter = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCamPos + rd * t;
    float sky = seen(tSkyDepth, uSkyVP, p, 0.0006);
    float sun = seen(tSunDepth, uSunVP, p, 0.0006);
    // Still air indoors holds more dust than the open courtyard.
    float dens = uDensity * mix(uIndoorDensity, 1.0, sky) * exp(-max(p.y, 0.0) * 0.06);
    vec3 light = uSunColor * sun * phase + uSkyColor * sky * 0.0796;
    scatter += trans * light * dens * dt;
    trans *= exp(-dens * dt);
    t += dt;
  }
  // Glow round local lights: closed-form integral of inverse-square falloff along the ray.
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (uLightPos[i].w < 0.5) continue;
    vec3 q = uLightPos[i].xyz - uCamPos;
    float b = dot(q, rd);
    float h = sqrt(max(dot(q, q) - b * b, 0.03));
    float integral = (atan((tMax - b) / h) - atan(-b / h)) / h;
    scatter += uLightCol[i] * integral * uDensity * uIndoorDensity * 0.0796;
  }
  gl_FragColor = vec4(col * trans + scatter, 1.0);
}`;
