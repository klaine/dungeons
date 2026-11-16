import {
  CanvasTexture, DoubleSide, InstancedBufferAttribute, InstancedMesh,
  PlaneGeometry, BufferGeometry, SRGBColorSpace, StaticDrawUsage, Texture,
} from 'three';
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { CardSet } from './scene';

/**
 * Drawing what grows. Each kind of card has one small painted texture and one material; every
 * card of that kind in the scene is drawn together. The paint is pale and takes its colour from
 * the card, so one texture serves spring green, dry yellow and blossom alike.
 */

// (The pieces of shader program used below, taken untyped: see the note in `siteMaterial.ts`.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { Fn, attribute, cameraPosition, cos, diffuseColor, distance, dot, float, mix, normalView, normalize, positionLocal, positionViewDirection, positionWorld, sin, smoothstep, transformNormalToView, uniform, uv, vec3 } = TSL as N;

export const vegetationUniforms: { uTime: { value: number }; uWind: { value: number } } = { uTime: uniform(0), uWind: uniform(1) };

/**
 * How light falls on a leaf. Light comes through a leaf as well as off it: seen against the sun
 * a crown glows, and its shaded side is not black. (The light used here has already been
 * through the shadow map, so leaves in shade stay dark.) And leaves and blades are matt: left
 * alone, every card would mirror the sky at a glancing angle, and a meadow seen from head
 * height is all glancing angles; it turns pale and blue.
 */
class LeafLighting extends (PhysicalLightingModel as N) {
  constructor(private readonly through: number) {
    super();
  }

  direct(data: N, builder: N): void {
    super.direct(data, builder);
    const against = dot(positionViewDirection.negate(), data.lightDirection).clamp().pow(3);
    const behind = dot(normalView, data.lightDirection).negate().clamp();
    data.reflectedLight.directDiffuse.addAssign(data.lightColor.mul(diffuseColor.rgb).mul(vec3(1.2, 1.25, 0.55)).mul(against.mul(0.9).add(behind.mul(0.22))).mul(this.through / Math.PI));
  }

  indirect(builder: N): void {
    super.indirect(builder);
    const reflected = builder.context.reflectedLight;
    reflected.indirectSpecular.assign(vec3(0));
    reflected.directSpecular.mulAssign(0.2);
  }
}

function canvasOf(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

const grey = (v: number, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

/** Paints the texture for one kind of card. Light and dark only: colour comes from the card. */
export function paintCards(kind: CardSet['kind'], seed = 1): Texture {
  // Leaves are looked at closely and are worth four times the paint.
  const size = kind === 'leaf' ? 512 : 256;
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
  } else if (kind === 'fern') {
    // Fronds arching out from the foot of the card, each a midrib with leaflets down both sides.
    for (let k = 0; k < 7; k++) {
      const lean = (k / 6 - 0.5) * 1.9 + rng.range(-0.12, 0.12), reach = rng.range(0.62, 0.95) * size, tone = rng.range(0.6, 1.0);
      let x = size / 2, y = size - 2, dir = -Math.PI / 2 + lean * 0.55;
      const steps = 22;
      for (let s = 0; s < steps; s++) {
        const f = s / steps, nx = x + Math.cos(dir) * (reach / steps), ny = y + Math.sin(dir) * (reach / steps);
        ctx.strokeStyle = grey(tone * 0.55);
        ctx.lineWidth = 2.2 * (1 - f) + 0.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        // Leaflets: longest a third of the way up, dwindling to the tip.
        const len = size * 0.085 * Math.sin(Math.min(1, f * 1.5 + 0.12) * Math.PI) * (1.15 - f * 0.5) + 2;
        for (const side of [-1, 1]) {
          ctx.strokeStyle = grey(tone * rng.range(0.75, 1.0));
          ctx.lineWidth = 3.2 * (1 - f * 0.6);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + Math.cos(dir + side * 1.25) * len, ny + Math.sin(dir + side * 1.25) * len);
          ctx.stroke();
        }
        x = nx; y = ny;
        dir += lean * 0.055;
      }
    }
  } else if (kind === 'herb') {
    // Tall stems with leaves low down and a flat head of small flowers at the top of each.
    for (let k = 0; k < 6; k++) {
      const x0 = rng.range(0.2, 0.8) * size, h = rng.range(0.6, 0.96) * size, lean = rng.range(-0.12, 0.12) * size;
      ctx.strokeStyle = grey(0.3);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, size);
      ctx.quadraticCurveTo(x0, size - h * 0.5, x0 + lean, size - h);
      ctx.stroke();
      for (let l = 0; l < 5; l++) {
        const f = rng.range(0.08, 0.6), side = l % 2 ? 1 : -1, len = rng.range(16, 30) * (1 - f * 0.7);
        ctx.fillStyle = grey(rng.range(0.4, 0.6));
        ctx.beginPath();
        ctx.ellipse(x0 + lean * f * f + side * len * 0.5, size - h * f - len * 0.15, len * 0.55, len * 0.2, -side * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const spread = rng.range(16, 26);
      for (let d = 0; d < 26; d++) {
        const a = rng.range(Math.PI, Math.PI * 2), r = Math.sqrt(rng.next()) * spread;
        ctx.fillStyle = grey(rng.range(0.85, 1));
        ctx.beginPath();
        ctx.arc(x0 + lean + Math.cos(a) * r, size - h + Math.sin(a) * r * 0.45 + 3, rng.range(2.2, 3.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'reed') {
    // Reeds: tall narrow blades from the foot of the card to its top, arching a little at the
    // tip, and among them stems that carry a dark head of seed.
    for (let k = 0; k < 46; k++) {
      const x0 = rng.range(0.1, 0.9) * size, h = rng.range(0.55, 0.98) * size, lean = rng.range(-0.16, 0.16) * size, tone = rng.range(0.5, 1.0);
      const steps = 10, wide = rng.range(2.6, 4.6);
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps, f1 = (s + 1) / steps;
        ctx.strokeStyle = grey(tone * (0.5 + 0.5 * f1));
        ctx.lineWidth = Math.max(1, (1 - f0 * 0.85) * wide);
        ctx.beginPath();
        ctx.moveTo(x0 + lean * f0 * f0 * f0, size - h * f0);
        ctx.lineTo(x0 + lean * f1 * f1 * f1, size - h * f1);
        ctx.stroke();
      }
    }
    for (let k = 0; k < 7; k++) {
      const x0 = rng.range(0.15, 0.85) * size, h = rng.range(0.7, 0.95) * size, lean = rng.range(-0.05, 0.05) * size;
      ctx.strokeStyle = grey(0.5);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, size); ctx.lineTo(x0 + lean, size - h); ctx.stroke();
      ctx.fillStyle = grey(0.2);
      ctx.beginPath();
      ctx.ellipse(x0 + lean, size - h + size * 0.02, size * 0.014, size * 0.055, lean * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'leaf') {
    // A spray: a twig across the card with lesser twigs off it, and on them leaves that can be
    // told apart, each with a pointed tip, a midrib, and one half a little darker than the other.
    const leaf = (x: number, y: number, turn: number, len: number, tone: number) => {
      const wide = len * rng.range(0.34, 0.46), c = Math.cos(turn), s = Math.sin(turn);
      const at = (u: number, v: number): [number, number] => [x + c * u * len - s * v * wide, y + s * u * len + c * v * wide];
      for (const half of [-1, 1]) {
        ctx.fillStyle = grey(tone * (half < 0 ? 0.8 : 1));
        ctx.beginPath();
        ctx.moveTo(...at(0, 0));
        ctx.bezierCurveTo(...at(0.25, half * 1.1), ...at(0.7, half * 0.8), ...at(1, 0));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = grey(tone * 0.62, 0.8);
      ctx.lineWidth = Math.max(1, size / 256);
      ctx.beginPath(); ctx.moveTo(...at(0, 0)); ctx.lineTo(...at(0.95, 0)); ctx.stroke();
    };
    const twig = (x0: number, y0: number, dir: number, reach: number, width: number, depth: number) => {
      const steps = Math.max(3, Math.round(reach / (size * 0.05)));
      let x = x0, y = y0, d = dir;
      for (let k = 0; k < steps; k++) {
        const f = k / steps, nx = x + Math.cos(d) * (reach / steps), ny = y + Math.sin(d) * (reach / steps);
        ctx.strokeStyle = grey(0.26);
        ctx.lineWidth = width * (1 - 0.7 * f);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
        d += rng.range(-0.22, 0.22);
        if (depth > 0 && k > 0 && k % 2 === 0) twig(x, y, d + (k % 4 ? 1 : -1) * rng.range(0.6, 1.0), reach * rng.range(0.35, 0.5) * (1 - f * 0.4), width * 0.6, depth - 1);
        // Leaves stand off the twig to either side, turned a little forward, and one at the end.
        for (const side of [-1, 1]) if (rng.chance(0.85)) leaf(x, y, d + side * rng.range(0.5, 1.1), size * rng.range(0.085, 0.125), rng.range(0.5, 1.0));
      }
      leaf(x, y, d, size * rng.range(0.09, 0.13), rng.range(0.6, 1.0));
    };
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
      twig(size / 2, size / 2, a, size * rng.range(0.3, 0.42), size * 0.018, 1);
    }
  } else if (kind === 'needle') {
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
  } else if (kind === 'fir') {
    // A whole fir: a spire of drooping tiers, widest near the foot, each lighter at its edge.
    // Painted solid, because it is only ever seen small, and what is thin would vanish.
    ctx.fillStyle = grey(0.3);
    ctx.fillRect(size * 0.485, size * 0.82, size * 0.03, size * 0.18);
    for (let k = 0; k < 13; k++) {
      const f = k / 12, y = size * (0.04 + 0.84 * f), half = size * (0.03 + 0.4 * Math.pow(f, 0.85)) * rng.range(0.85, 1.1), drop = size * 0.085;
      for (const side of [-1, 1]) {
        ctx.fillStyle = grey(rng.range(0.5, 0.72) + 0.25 * (1 - f));
        ctx.beginPath();
        ctx.moveTo(size / 2, y - drop * 0.6);
        ctx.quadraticCurveTo(size / 2 + side * half * 0.6, y - drop * 0.1, size / 2 + side * half, y + drop * rng.range(0.7, 1.2));
        ctx.lineTo(size / 2 + side * half * 0.5, y + drop * 0.55);
        ctx.lineTo(size / 2, y + drop * 0.9);
        ctx.fill();
      }
    }
  } else if (kind === 'tree') {
    // A whole broadleaved tree: a short trunk and a crown of rounded masses, lighter above.
    ctx.fillStyle = grey(0.28);
    ctx.fillRect(size * 0.475, size * 0.66, size * 0.05, size * 0.34);
    for (let k = 0; k < 46; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()), x = size * (0.5 + 0.34 * d * Math.cos(a)), y = size * (0.4 + 0.3 * d * Math.sin(a));
      ctx.fillStyle = grey(0.5 + 0.45 * (1 - y / (size * 0.72)) + rng.range(-0.08, 0.08));
      ctx.beginPath();
      ctx.ellipse(x, y, size * rng.range(0.07, 0.13), size * rng.range(0.06, 0.1), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'thrift') {
    // Thrift: a low cushion of fine dark leaves, and over it round heads of flowers on bare stems.
    for (let k = 0; k < 60; k++) {
      const x0 = size * (0.5 + rng.range(-0.38, 0.38)), h = size * rng.range(0.12, 0.3), lean = rng.range(-0.15, 0.15) * size;
      ctx.strokeStyle = grey(rng.range(0.12, 0.2));
      ctx.lineWidth = rng.range(2, 3.5);
      ctx.beginPath(); ctx.moveTo(x0, size); ctx.lineTo(x0 + lean, size - h); ctx.stroke();
    }
    for (let k = 0; k < 11; k++) {
      const x0 = size * (0.5 + rng.range(-0.3, 0.3)), h = size * rng.range(0.45, 0.88), lean = rng.range(-0.12, 0.12) * size;
      ctx.strokeStyle = grey(0.22);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, size); ctx.quadraticCurveTo(x0, size - h * 0.6, x0 + lean, size - h); ctx.stroke();
      const r = size * rng.range(0.045, 0.065);
      for (let d = 0; d < 24; d++) {
        const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * r;
        ctx.fillStyle = grey(rng.range(0.75, 1));
        ctx.beginPath(); ctx.arc(x0 + lean + Math.cos(a) * rr, size - h + Math.sin(a) * rr, rng.range(2.5, 4), 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (kind === 'marram') {
    // Marram: stiff blades rolled tight against the wind, arching over from a dense foot, pale at their tips.
    for (let k = 0; k < 64; k++) {
      const x0 = size * (0.5 + rng.range(-0.3, 0.3)), h = rng.range(0.55, 0.98) * size, lean = rng.range(-0.42, 0.42) * size;
      const steps = 9, wide = rng.range(2.2, 3.6), tone = rng.range(0.55, 1);
      for (let st = 0; st < steps; st++) {
        const f0 = st / steps, f1 = (st + 1) / steps;
        ctx.strokeStyle = grey(tone * (0.45 + 0.55 * f1));
        ctx.lineWidth = Math.max(1, (1 - f0 * 0.9) * wide);
        ctx.beginPath();
        ctx.moveTo(x0 + lean * f0 * f0, size - h * f0 + lean * 0.12 * f0 * f0 * f0 * Math.sign(lean) * Math.sign(lean));
        ctx.lineTo(x0 + lean * f1 * f1, size - h * f1 + Math.abs(lean) * 0.25 * f1 * f1 * f1);
        ctx.stroke();
      }
    }
  } else if (kind === 'gorse') {
    // Gorse: a dense rounded mass of spines on green shoots, darker within, bristling at its edge.
    for (let k = 0; k < 520; k++) {
      const a = rng.range(Math.PI * 1.02, Math.PI * 1.98), d = Math.pow(rng.next(), 0.6);
      const cx = size / 2 + Math.cos(a) * d * size * 0.46, cy = size * 0.98 + Math.sin(a) * d * size * 0.9;
      const len = rng.range(5, 13), dir = a + rng.range(-0.6, 0.6);
      ctx.strokeStyle = grey((0.25 + 0.75 * d) * rng.range(0.55, 1));
      ctx.lineWidth = rng.range(1.4, 2.6);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(dir) * len, cy + Math.sin(dir) * len); ctx.stroke();
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
export const vegetationRange: { value: number } = uniform(75);

/**
 * Builds the meshes for a set of cards. The cards are sorted into square blocks of ground, one
 * mesh to a block, so that blocks out of view are not drawn at all; blocks of grass and flowers
 * too far away to matter are dropped as well (see `cullCards`).
 */
export function makeCards(set: CardSet, texture: Texture): InstancedMesh[] {
  // Whole trees stand far off, are never dropped for distance, and are drawn in large lots.
  const whole = set.kind === 'fir' || set.kind === 'tree';
  const ground = set.kind !== 'leaf' && set.kind !== 'needle' && !whole;
  const block = whole ? 220 : ground ? 24 : 48;
  const base = shapeGeometry(set.shape);
  const sway = whole ? 0.004 : ground ? 0.07 : set.kind === 'leaf' ? 0.035 : 0.02;
  const material = new MeshStandardNodeMaterial({
    map: texture, alphaTest: 0.42, side: DoubleSide, roughness: 0.82, metalness: 0, alphaToCoverage: true,
  });
  // The sky lights leaves from all round, but as blue as it is it would turn them teal.
  material.envMapIntensity = 0.55;
  const uTime = vegetationUniforms.uTime as N, uWind = vegetationUniforms.uWind as N, uRange = vegetationRange as N;
  // Where each card stands, and how large it is.
  const at: N = attribute('aAt', 'vec4');
  // Wind: the free end of each card moves, the fixed end does not. And grass and flowers shrink into the ground as they near the end of their range.
  material.positionNode = Fn(() => {
    const p: N = positionLocal.toVar();
    const free: N = set.shape === 'tuft' ? uv().y.mul(uv().y) : float(1);
    const gust = sin(uTime.mul(1.3).add(at.x.mul(0.21)).add(at.z.mul(0.17))).add(sin(uTime.mul(2.9).add(at.x.mul(0.6)).sub(at.z.mul(0.45))).mul(0.5));
    p.x.addAssign(free.mul(gust).mul(uWind).mul(at.w).mul(sway));
    p.z.addAssign(free.mul(cos(uTime.mul(1.7).add(at.z.mul(0.3)))).mul(uWind).mul(at.w).mul(sway * 0.6));
    if (ground) p.assign(mix(p, at.xyz, smoothstep(uRange.mul(0.66), uRange, distance(cameraPosition, at.xyz))));
    return p;
  })();
  // Shade every card as part of one rounded body about its centre, not as a flat sheet. (A normal
  // given like this is not turned round on back faces, which a two-sided material would do to its own.)
  material.normalNode = transformNormalToView(normalize(positionWorld.sub(attribute('aCentre', 'vec3'))));
  (material as N).setupLightingModel = () => new LeafLighting(whole ? 0.25 : 1);

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
    const matrices = new Float32Array(n * 16), colours = new Float32Array(n * 3), centres = new Float32Array(n * 3), stands = new Float32Array(n * 4);
    list.forEach((i, k) => {
      for (let c = 0; c < 16; c++) matrices[k * 16 + c] = set.matrices[i * 16 + c];
      for (let c = 0; c < 3; c++) stands[k * 4 + c] = set.matrices[i * 16 + 12 + c];
      stands[k * 4 + 3] = Math.hypot(set.matrices[i * 16], set.matrices[i * 16 + 1], set.matrices[i * 16 + 2]);
      for (let c = 0; c < 3; c++) { colours[k * 3 + c] = set.colours[i * 3 + c]; centres[k * 3 + c] = set.centres[i * 3 + c]; }
    });
    // Each block has its own geometry object, sharing the shape's buffers, because the centres are per card.
    const geometry = new BufferGeometry();
    geometry.setIndex(base.getIndex());
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, base.getAttribute(name));
    geometry.setAttribute('aCentre', new InstancedBufferAttribute(centres, 3));
    geometry.setAttribute('aAt', new InstancedBufferAttribute(stands, 4));
    const mesh = new InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
    (mesh.instanceMatrix.array as Float32Array).set(matrices);
    mesh.instanceColor = new InstancedBufferAttribute(colours, 3);
    mesh.name = `cards:${set.kind}`;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.castShadow = set.shadow;
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
