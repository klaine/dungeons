import {
  AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight,
  ShaderMaterial, TorusGeometry, Vector3,
} from 'three';

/** A wall torch: an iron-bound brand on a bracket, an animated flame, and a shadow-casting light. */

export class Torch {
  readonly group = new Group();
  readonly light: PointLight;
  readonly flamePosition = new Vector3();
  private flame: ShaderMaterial;
  private phase: number;
  private baseIntensity: number;

  constructor(position: Vector3, out: Vector3, phase: number, intensity: number) {
    this.phase = phase;
    this.baseIntensity = intensity;
    const iron = new MeshStandardMaterial({ color: new Color(0.05, 0.045, 0.04), roughness: 0.55, metalness: 0.9, envMapIntensity: 0.05 });
    const wood = new MeshStandardMaterial({ color: new Color(0.12, 0.07, 0.04), roughness: 0.9, envMapIntensity: 0.05 });

    // The brand leans out from the wall; its head is at `position`.
    const lean = 0.42;
    const brand = new Mesh(new CylinderGeometry(0.045, 0.024, 0.62, 10), wood);
    const axis = new Vector3(0, Math.cos(lean), 0).addScaledVector(out, Math.sin(lean)).normalize();
    brand.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis);
    brand.position.copy(position).addScaledVector(axis, -0.31);
    const head = new Mesh(new CylinderGeometry(0.062, 0.05, 0.14, 10), iron);
    head.quaternion.copy(brand.quaternion);
    head.position.copy(position).addScaledVector(axis, -0.06);
    const ring = new Mesh(new TorusGeometry(0.055, 0.012, 6, 14), iron);
    ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis);
    ring.position.copy(position).addScaledVector(axis, -0.36);
    const arm = new Mesh(new CylinderGeometry(0.014, 0.014, 0.3, 6), iron);
    arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), out);
    arm.position.copy(ring.position).addScaledVector(out, -0.13);
    for (const m of [brand, head, ring, arm]) {
      m.castShadow = false;
      this.group.add(m);
    }

    this.flamePosition.copy(position).addScaledVector(axis, 0.16);
    this.flame = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPhase: { value: phase }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Face the camera, staying upright.
  vec3 centre = (modelMatrix * vec4(0., 0., 0., 1.)).xyz;
  vec3 toCam = cameraPosition - centre; toCam.y = 0.; toCam = normalize(toCam);
  vec3 right = vec3(toCam.z, 0., -toCam.x);
  vec3 wp = centre + right * position.x + vec3(0., 1., 0.) * position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
}`,
      fragmentShader: /* glsl */ `
varying vec2 vUv;
uniform float uTime, uPhase, uGain;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2. - 1.;
  float t = uTime + uPhase * 10.;
  float up = (p.y + 1.) * .5;
  float n = noise(vec2(p.x * 3., p.y * 2.2 - t * 3.2)) * .6 + noise(vec2(p.x * 7., p.y * 5. - t * 5.5)) * .4;
  p.x += (n - .5) * .5 * up + sin(t * 2.3 + p.y * 3.) * .06 * up;
  float width = mix(.52, .05, pow(up, 1.25));
  float body = 1. - smoothstep(width * .35, width, abs(p.x));
  body *= smoothstep(-1., -.72, p.y) * (1. - smoothstep(.25, .95, p.y + (n - .5) * .7));
  float core = body * body * (1. - smoothstep(-.5, .35, p.y));
  vec3 col = mix(vec3(1., .16, .01), vec3(1., .55, .12), body) * body * 2.2;
  col += vec3(1., .85, .55) * core * 4.;
  gl_FragColor = vec4(col * uGain, body);
}`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const quad = new Mesh(new PlaneGeometry(0.4, 0.7), this.flame);
    quad.position.copy(this.flamePosition);
    quad.frustumCulled = false;
    this.group.add(quad);

    this.light = new PointLight(new Color(1.0, 0.6, 0.3), intensity, 0, 2);
    this.light.position.copy(position).addScaledVector(out, 0.36).add(new Vector3(0, 0.26, 0));
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.08;
    this.light.shadow.camera.far = 24;
    this.light.shadow.bias = -0.003;
    this.light.shadow.normalBias = 0.03;
    this.light.shadow.autoUpdate = false;
    this.light.shadow.needsUpdate = true;
    this.group.add(this.light);
  }

  update(time: number): void {
    const t = time * 7 + this.phase * 31;
    const flicker = 0.86 + 0.09 * Math.sin(t) + 0.05 * Math.sin(t * 2.7 + 1.3) + 0.04 * Math.sin(t * 5.1 + 0.4);
    this.light.intensity = this.baseIntensity * flicker;
    this.flame.uniforms.uTime.value = time;
    this.flame.uniforms.uGain.value = flicker;
  }
}
