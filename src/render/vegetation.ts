import {
  CanvasTexture, DoubleSide, InstancedBufferAttribute, InstancedMesh, MeshDepthMaterial, MeshStandardMaterial,
  PlaneGeometry, BufferGeometry, RGBADepthPacking, SRGBColorSpace, StaticDrawUsage, Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { CardSet } from './scene';

/**
 * Drawing what grows. Each kind of card has one small painted texture and one material; every
 * card of that kind in the scene is drawn together. The paint is pale and takes its colour from
 * the card, so one texture serves spring green, dry yellow and blossom alike.
 */

export const vegetationUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

function canvasOf(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

const grey = (v: number, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

/** Paints the texture for one kind of card. Light and dark only: colour comes from the card. */
export function paintCards(kind: CardSet['kind'], seed = 1): Texture {
  const size = 256;
  const [canvas, ctx] = canvasOf(size);
  const rng = new Rng(`cards/${kind}/${seed}`);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  if (kind === 'grass') {
    // Blades from the foot of the card, leaning and tapering, lighter towards the tip.
    for (let k = 0; k < 70; k++) {
      const x0 = rng.range(0.08, 0.92) * size, h = Math.pow(rng.next(), 0.6) * 0.95 * size, lean = rng.range(-0.22, 0.22) * size;
      const tone = rng.range(0.55, 1.0);
      const steps = 7;
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps, f1 = (s + 1) / steps;
        ctx.strokeStyle = grey(tone * (0.55 + 0.45 * f1));
        ctx.lineWidth = Math.max(1, (1 - f0) * rng.range(3.5, 6.5));
        ctx.beginPath();
        ctx.moveTo(x0 + lean * f0 * f0, size - h * f0);
        ctx.lineTo(x0 + lean * f1 * f1, size - h * f1);
        ctx.stroke();
      }
    }
  } else if (kind === 'flower') {
    for (let k = 0; k < 9; k++) {
      const x0 = rng.range(0.15, 0.85) * size, h = rng.range(0.45, 0.92) * size, lean = rng.range(-0.1, 0.1) * size;
      // The stem is drawn very dark, so that the card's colour barely shows on it.
      ctx.strokeStyle = grey(0.16);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x0, size);
      ctx.quadraticCurveTo(x0, size - h * 0.5, x0 + lean, size - h);
      ctx.stroke();
      const r = rng.range(7, 12);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + k;
        ctx.fillStyle = grey(rng.range(0.85, 1));
        ctx.beginPath();
        ctx.ellipse(x0 + lean + Math.cos(a) * r * 0.7, size - h + Math.sin(a) * r * 0.7, r * 0.62, r * 0.4, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'leaf') {
    // A spray of leaves filling a rough disc, with twigs behind them.
    ctx.strokeStyle = grey(0.3);
    ctx.lineWidth = 3;
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a) * size * 0.4, size / 2 + Math.sin(a) * size * 0.4);
      ctx.stroke();
    }
    for (let k = 0; k < 420; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 0.47 * size * (0.78 + 0.22 * Math.sin(a * 5 + seed));
      const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
      const len = rng.range(6, 11), turn = rng.range(0, Math.PI * 2);
      ctx.fillStyle = grey(rng.range(0.42, 1.0));
      ctx.beginPath();
      ctx.ellipse(x, y, len, len * 0.5, turn, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = grey(0.4, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(turn) * len, y - Math.sin(turn) * len);
      ctx.lineTo(x + Math.cos(turn) * len, y + Math.sin(turn) * len);
      ctx.stroke();
    }
  } else {
    // A conifer bough seen from above: a stem up the card with side shoots, all bristling with
    // needles, broad at the foot of the card (the trunk end is at the top).
    const shoot = (x0: number, y0: number, x1: number, y1: number, width: number) => {
      ctx.strokeStyle = grey(0.28);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 3.2);
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
      for (let k = 0; k < n; k++) {
        const f = k / n, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
        for (const side of [-1, 1]) {
          ctx.strokeStyle = grey(rng.range(0.45, 1.0));
          ctx.lineWidth = rng.range(1.6, 2.6);
          const l = width * rng.range(0.7, 1.1);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (nx / nl) * side * l + (x1 - x0) * 0.06, y + (ny / nl) * side * l + (y1 - y0) * 0.06);
          ctx.stroke();
        }
      }
    };
    shoot(size / 2, 6, size / 2, size - 8, 15);
    for (let k = 0; k < 9; k++) {
      const f = 0.12 + 0.8 * (k / 9), y = 6 + (size - 14) * f, reach = (0.16 + 0.3 * f) * size;
      for (const side of [-1, 1]) shoot(size / 2, y, size / 2 + side * reach * rng.range(0.8, 1.05), y + reach * rng.range(0.45, 0.75), 12);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function shapeGeometry(shape: CardSet['shape']): BufferGeometry {
  if (shape === 'card') return new PlaneGeometry(1, 1);
  // Three upright sheets through one line, a third of a turn apart, with their feet on the ground.
  const sheets = [0, 1, 2].map((k) => {
    const g = new PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    g.rotateY((k * Math.PI) / 3);
    return g;
  });
  return mergeGeometries(sheets);
}

/** How far off grass and flowers are still drawn. They shrink into the ground over the last third. */
export const vegetationRange = { value: 75 };

/**
 * Builds the meshes for a set of cards. The cards are sorted into square blocks of ground, one
 * mesh to a block, so that blocks out of view are not drawn at all; blocks of grass and flowers
 * too far away to matter are dropped as well (see `cullCards`).
 */
export function makeCards(set: CardSet, texture: Texture): InstancedMesh[] {
  const ground = set.kind === 'grass' || set.kind === 'flower';
  const block = ground ? 24 : 48;
  const base = shapeGeometry(set.shape);
  const sway = ground ? 0.07 : set.kind === 'leaf' ? 0.035 : 0.02;
  const material = new MeshStandardMaterial({
    map: texture, alphaTest: 0.42, side: DoubleSide, roughness: 0.82, metalness: 0, alphaToCoverage: true,
  });
  // The sky lights leaves from all round, but as blue as it is it would turn them teal.
  material.envMapIntensity = 0.55;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = vegetationUniforms.uTime;
    shader.uniforms.uWind = vegetationUniforms.uWind;
    shader.uniforms.uRange = vegetationRange;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec3 aCentre; uniform float uTime; uniform float uWind; uniform float uRange;`)
      // Shade every card as part of one rounded body about its centre, not as a flat sheet.
      .replace('#include <defaultnormal_vertex>', /* glsl */ `#include <defaultnormal_vertex>
{
  vec4 cardWorld = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  transformedNormal = normalize( ( viewMatrix * vec4( normalize( cardWorld.xyz - aCentre ), 0.0 ) ).xyz );
}`)
      // Wind: the free end of each card moves, the fixed end does not.
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
{
  vec3 at = instanceMatrix[3].xyz;
  float free = ${set.shape === 'tuft' ? 'uv.y * uv.y' : '1.0'};
  float gust = sin( uTime * 1.3 + at.x * 0.21 + at.z * 0.17 ) + 0.5 * sin( uTime * 2.9 + at.x * 0.6 - at.z * 0.45 );
  transformed.x += free * gust * ${sway.toFixed(3)} * uWind;
  transformed.z += free * cos( uTime * 1.7 + at.z * 0.3 ) * ${(sway * 0.6).toFixed(3)} * uWind;
  ${ground ? 'transformed *= 1.0 - smoothstep( uRange * 0.66, uRange, distance( cameraPosition, at ) );' : ''}
}`);
    shader.fragmentShader = shader.fragmentShader
      // Light comes through a leaf as well as off it. Seen against the sun a crown glows, and its
      // shaded side is not black. The light used here has already been through the shadow map,
      // so leaves in shade stay dark.
      .replace('#include <lights_physical_pars_fragment>', /* glsl */ `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float against = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 3.0 );
  float behind = saturate( -dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI * vec3( 1.2, 1.25, 0.55 ) * ( against * 0.9 + behind * 0.22 );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`)
      // A two-sided material turns the normal round on back faces; these normals must not turn.
      .replace('#include <normal_fragment_begin>', /* glsl */ `#include <normal_fragment_begin>
normal = normalize( vNormal );`)
      // Leaves and blades are matt. Left alone, every card would mirror the sky at a glancing
      // angle, and a meadow seen from head height is all glancing angles: it turns pale and blue.
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
reflectedLight.indirectSpecular = vec3( 0.0 );
reflectedLight.directSpecular *= 0.2;`);
  };
  material.customProgramCacheKey = () => `cards4-${set.shape}-${sway}-${ground}`;
  const depth = set.shadow ? new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: texture, alphaTest: 0.42 }) : null;

  // Which block each card falls in.
  const count = set.matrices.length / 16;
  const blocks = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(set.matrices[i * 16 + 12] / block)},${Math.floor(set.matrices[i * 16 + 14] / block)}`;
    let list = blocks.get(key);
    if (!list) blocks.set(key, (list = []));
    list.push(i);
  }
  const meshes: InstancedMesh[] = [];
  for (const list of blocks.values()) {
    const n = list.length;
    const matrices = new Float32Array(n * 16), colours = new Float32Array(n * 3), centres = new Float32Array(n * 3);
    list.forEach((i, k) => {
      for (let c = 0; c < 16; c++) matrices[k * 16 + c] = set.matrices[i * 16 + c];
      for (let c = 0; c < 3; c++) { colours[k * 3 + c] = set.colours[i * 3 + c]; centres[k * 3 + c] = set.centres[i * 3 + c]; }
    });
    // Each block has its own geometry object, sharing the shape's buffers, because the centres are per card.
    const geometry = new BufferGeometry();
    geometry.setIndex(base.getIndex());
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, base.getAttribute(name));
    geometry.setAttribute('aCentre', new InstancedBufferAttribute(centres, 3));
    const mesh = new InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
    (mesh.instanceMatrix.array as Float32Array).set(matrices);
    mesh.instanceColor = new InstancedBufferAttribute(colours, 3);
    mesh.name = `cards:${set.kind}`;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.castShadow = set.shadow;
    if (depth) mesh.customDepthMaterial = depth;
    mesh.matrixAutoUpdate = false;
    mesh.userData.ground = ground;
    meshes.push(mesh);
  }
  return meshes;
}

/** Hides blocks of grass and flowers that are wholly beyond the range at which they are drawn. */
export function cullCards(meshes: InstancedMesh[], eye: { x: number; y: number; z: number }): void {
  for (const m of meshes) {
    if (!m.userData.ground) continue;
    const s = m.boundingSphere!;
    m.visible = Math.hypot(s.center.x - eye.x, s.center.y - eye.y, s.center.z - eye.z) - s.radius < vegetationRange.value;
  }
}
