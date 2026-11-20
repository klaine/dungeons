import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Colliders } from '../app/player';

/**
 * What the game's body (`Player`) walks on and is stopped by in a world streamed in, rather than in one site built whole: the first
 * step of the world becoming the game (`docs/06-world.md`, *The world as the game*). In a site everything solid is one mesh with its
 * tree of bounds (`MeshBVH`), made once. Here what is solid changes as one goes, so it is a set of such meshes, each asked in turn:
 *  - a patch of ground about the walker, 64 metres across at a metre, from the land as it is drawn (`heightAt`: the squares at a metre,
 *    or their quarters at half a metre, or the world's lattice where no square is in yet), made again when the walker has gone a quarter
 *    of the way to its edge, or when land under it has come in or changed;
 *  - the trunks of the trees standing on it, each a six-sided post (bushes and young trees stop nobody, as in the game);
 *  - and anything else given (`others`): a place built into the world (`WorldPlaces`), whose ground the patch leaves out (`skip`).
 */

/** A trunk to be stopped by: where it stands, how thick, and the ground at its foot. */
export interface Trunk { x: number; z: number; r: number }

const PATCH = 64, CELL = 1, MOVE = PATCH / 4, TRUNK_HEIGHT = 3.2;

export class WorldColliders implements Colliders {
  private patch: { bvh: MeshBVH; x: number; z: number; version: number } | null = null;
  /** Other solid things in the world: each a mesh in world coordinates with its tree of bounds. */
  readonly others: MeshBVH[] = [];
  /** How long the last patch took to make, milliseconds; and how many have been made. */
  lastMs = 0;
  made = 0;

  /** `skip`: where the patch leaves the ground out, to something else that is there instead (a place standing in the world, in `others`). */
  constructor(private readonly heightAt: (x: number, z: number) => number, private readonly trunksIn: (x0: number, z0: number, x1: number, z1: number) => Trunk[], private readonly skip: (x: number, z: number) => boolean = () => false) {}

  shapecast(callbacks: Parameters<MeshBVH['shapecast']>[0]): boolean {
    if (this.patch) this.patch.bvh.shapecast(callbacks);
    for (const b of this.others) b.shapecast(callbacks);
    return false;
  }

  /** Makes the patch again about (`x`, `z`) if the walker has gone far enough from its middle, or the land under it is newer (`version`). */
  follow(x: number, z: number, version: number): void {
    const p = this.patch;
    if (p && p.version === version && Math.abs(x - p.x) < MOVE && Math.abs(z - p.z) < MOVE) return;
    const t0 = performance.now();
    // (On a whole metre, so that the patch's points are the land's own points at a metre and not drawn between them.)
    const cx = Math.round(x), cz = Math.round(z), x0 = cx - PATCH / 2, z0 = cz - PATCH / 2, n = PATCH / CELL + 1;
    const trunks = this.trunksIn(x0, z0, x0 + PATCH, z0 + PATCH);
    const SIDES = 6, ground = n * n, posts = trunks.length * SIDES * 2;
    const pos = new Float32Array((ground + posts) * 3), index: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, px = x0 + i * CELL, pz = z0 + j * CELL;
      pos[k * 3] = px; pos[k * 3 + 1] = this.heightAt(px, pz); pos[k * 3 + 2] = pz;
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      if (this.skip(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL)) continue;
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    trunks.forEach((t, q) => {
      const base = ground + q * SIDES * 2, y = this.heightAt(t.x, t.z);
      // (Its corners a little outside the trunk's round, so that its flat faces lie on it: with the corners on it, the body came a
      // few centimetres into the bark between them.)
      const out = t.r / Math.cos(Math.PI / SIDES);
      for (let s = 0; s < SIDES; s++) {
        const a = (s / SIDES) * Math.PI * 2, px = t.x + Math.cos(a) * out, pz = t.z + Math.sin(a) * out;
        pos.set([px, y - 0.4, pz], (base + s) * 3);
        pos.set([px, y + TRUNK_HEIGHT, pz], (base + SIDES + s) * 3);
      }
      for (let s = 0; s < SIDES; s++) {
        const a = base + s, b = base + ((s + 1) % SIDES), c = a + SIDES, d = b + SIDES;
        index.push(a, b, c, b, d, c);
      }
    });
    // (A patch wholly inside a place has no triangles of its own; the tree of bounds wants one, so a speck far under the ground.)
    if (!index.length) { pos.set([x0, -1e4, z0, x0 + 0.01, -1e4, z0, x0, -1e4, z0 + 0.01], 0); index.push(0, 1, 2); }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(index);
    this.patch = { bvh: new MeshBVH(g), x: cx, z: cz, version };
    this.lastMs = performance.now() - t0;
    this.made++;
  }

  /** The stretch of ground the patch covers, for knowing whether new land lies under it. */
  covers(x0: number, z0: number, x1: number, z1: number): boolean {
    const p = this.patch;
    return !!p && x1 > p.x - PATCH / 2 && x0 < p.x + PATCH / 2 && z1 > p.z - PATCH / 2 && z0 < p.z + PATCH / 2;
  }
}
