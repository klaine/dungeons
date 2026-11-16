import { CanvasTexture, CircleGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, Texture, Vector2 } from 'three';
import { Rng } from '../core/rng';

/**
 * Still water. A level sheet over a hollow in the ground: dark, nearly a mirror, and thin enough
 * at the edge to show the bed. Its surface is ruffled by a ripple pattern that drifts, which is
 * what breaks the sky's reflection into moving light.
 */

/** A tiling pattern of ripples, as a normal map: a sum of waves that all fit the square exactly. */
function rippleMap(size = 256): Texture {
  const rng = new Rng('ripples');
  const waves: [number, number, number, number][] = [];
  for (let k = 0; k < 22; k++) {
    const fx = rng.int(-9, 9), fy = rng.int(-9, 9);
    if (fx === 0 && fy === 0) continue;
    waves.push([fx, fy, rng.range(0, Math.PI * 2), 1 / Math.hypot(fx, fy) ** 1.1]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    for (const [fx, fy, phase, amp] of waves) {
      const c = Math.cos(fx * u + fy * v + phase) * amp;
      dx += c * fx;
      dy += c * fy;
    }
    const l = Math.hypot(dx * 0.35, dy * 0.35, 1), i = (y * size + x) * 4;
    image.data[i] = 127.5 + (127.5 * -dx * 0.35) / l;
    image.data[i + 1] = 127.5 + (127.5 * -dy * 0.35) / l;
    image.data[i + 2] = 127.5 + 127.5 / l;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

export class Water {
  readonly meshes: Mesh[] = [];
  private ripples = rippleMap();
  private material: MeshStandardMaterial;

  constructor(pools: { x: number; z: number; r: number; level: number }[]) {
    this.ripples.repeat.set(1, 1);
    this.material = new MeshStandardMaterial({
      color: 0x0d2a26, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.84,
      normalMap: this.ripples, normalScale: new Vector2(0.2, 0.2), envMapIntensity: 2.2, depthWrite: false,
    });
    for (const pool of pools) {
      const geometry = new CircleGeometry(pool.r, 40);
      geometry.rotateX(-Math.PI / 2);
      // The ripples are sized in metres, whatever the size of the pool.
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * pool.r * 0.5, (uv.getY(i) - 0.5) * pool.r * 0.5);
      const mesh = new Mesh(geometry, this.material);
      mesh.position.set(pool.x, pool.level, pool.z);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.name = 'water';
      this.meshes.push(mesh);
    }
  }

  update(time: number): void {
    this.ripples.offset.set(time * 0.013, time * 0.008);
  }
}
