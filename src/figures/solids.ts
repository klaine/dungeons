import { Box3, DoubleSide, Matrix4, Ray, Vector3 } from 'three';
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';
import type { Colliders } from '../app/player';

/**
 * Everything solid that figures go among, as a set of parts: each a tree of bounds made once in its own frame, and where that frame
 * stands in the world, read afresh each frame (`refresh`). So a building dragged across a square is not made again as it moves: only
 * where it stands changes. What the bodies ask of it (`Colliders`, the triangles near them) is answered in the world's frame, and so
 * are rays: the height of what is underfoot, every surface over a point (for finding paths, `nav.ts`), and whether a way between two
 * points is blocked.
 */

export interface SolidPart {
  bvh: MeshBVH;
  /** Where its own frame stands in the world. Changed in place by its owner (an object's `matrixWorld`); read on `refresh`. */
  matrix: Matrix4;
  /** A level sheet (a square's paving): paths over it need ask no rays of it. */
  level?: boolean;
}

interface Kept extends SolidPart { box: Box3; inverse: Matrix4; seen: number; identity: boolean }

export interface Hit { point: Vector3; distance: number; /** How much the surface met faces up (the y of its normal in the world). */ up: number }

const tri = new ExtendedTriangle(), box = new Box3(), ray = new Ray(), worldBox = new Box3(), v = new Vector3();
/** A number that changes when a matrix does, near enough. */
const markOf = (m: Matrix4) => { const e = m.elements; let s = 0; for (let i = 0; i < 16; i++) s += e[i] * (i + 1.37); return s; };

export class Solids implements Colliders {
  private readonly parts = new Map<unknown, Kept>();
  /** Bumped whenever something solid comes, goes or moves: paths found before then may no longer hold. */
  version = 0;

  set(key: unknown, part: SolidPart): void {
    if (!part.bvh.geometry.boundingBox) part.bvh.geometry.computeBoundingBox();
    this.parts.set(key, { ...part, box: new Box3(), inverse: new Matrix4(), seen: NaN, identity: false });
    this.refresh(true);
  }

  delete(key: unknown): void { if (this.parts.delete(key)) this.version++; }
  has(key: unknown): boolean { return this.parts.has(key); }
  keys(): unknown[] { return [...this.parts.keys()]; }

  /** Reads where every part now stands. Whether anything had moved. */
  refresh(force = false): boolean {
    let moved = force;
    for (const p of this.parts.values()) {
      const mark = markOf(p.matrix);
      if (mark === p.seen && !force) continue;
      p.seen = mark;
      p.inverse.copy(p.matrix).invert();
      p.identity = p.matrix.equals(new Matrix4());
      p.box.copy(p.bvh.geometry.boundingBox!).applyMatrix4(p.matrix);
      moved = true;
    }
    if (moved) this.version++;
    return moved;
  }

  /** The parts whose bounds meet `b`, but for level sheets: what may stand in the way there. */
  within(b: Box3): SolidPart[] {
    const out: SolidPart[] = [];
    for (const p of this.parts.values()) if (!p.level && p.box.intersectsBox(b)) out.push(p);
    return out;
  }

  /** The highest level sheet under (x, z), if one is: the ground where nothing else stands. */
  levelAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const p of this.parts.values()) if (p.level && x >= p.box.min.x && x <= p.box.max.x && z >= p.box.min.z && z <= p.box.max.z) best = Math.max(best ?? -Infinity, p.box.max.y);
    return best;
  }

  shapecast(callbacks: Parameters<MeshBVH['shapecast']>[0]): boolean {
    const cb = callbacks as unknown as { intersectsBounds: (b: Box3, ...rest: unknown[]) => unknown; intersectsTriangle: (t: ExtendedTriangle, ...rest: unknown[]) => unknown };
    for (const p of this.parts.values()) {
      if (!cb.intersectsBounds(p.box, false, 0, 0, 0)) continue;
      if (p.identity) { p.bvh.shapecast(callbacks); continue; }
      const m = p.matrix;
      p.bvh.shapecast({
        intersectsBounds: (b: Box3, ...rest: unknown[]) => cb.intersectsBounds(box.copy(b).applyMatrix4(m), ...rest),
        intersectsTriangle: (t: ExtendedTriangle, ...rest: unknown[]) => {
          tri.a.copy(t.a).applyMatrix4(m); tri.b.copy(t.b).applyMatrix4(m); tri.c.copy(t.c).applyMatrix4(m);
          tri.needsUpdate = true;
          return cb.intersectsTriangle(tri, ...rest);
        },
      } as unknown as Parameters<MeshBVH['shapecast']>[0]);
    }
    return false;
  }

  /** Every surface a ray meets within `far`, nearest first; of `among` alone if given. */
  hits(r: Ray, far = Infinity, among?: SolidPart[]): Hit[] {
    const out: Hit[] = [];
    const end = v.copy(r.direction).multiplyScalar(Math.min(far, 1e4)).add(r.origin);
    worldBox.makeEmpty().expandByPoint(r.origin).expandByPoint(end);
    for (const p of (among ?? [...this.parts.values()]) as Kept[]) {
      if (!p.box.intersectsBox(worldBox)) continue;
      ray.copy(r);
      if (!p.identity) ray.applyMatrix4(p.inverse);
      for (const h of p.bvh.raycast(ray, DoubleSide)) {
        const point = h.point.clone();
        if (!p.identity) point.applyMatrix4(p.matrix);
        const distance = point.distanceTo(r.origin);
        if (distance > far) continue;
        const n = h.face ? h.face.normal.clone() : new Vector3(0, 1, 0);
        if (!p.identity) n.transformDirection(p.matrix);
        // (Seen from below a face turned down is met; seen from above, one turned up. Either way `up` is how it faces the sky.)
        out.push({ point, distance, up: n.y });
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** The nearest surface a ray meets within `far`, or null. */
  first(r: Ray, far = Infinity, among?: SolidPart[]): Hit | null {
    let best: Hit | null = null;
    const end = v.copy(r.direction).multiplyScalar(Math.min(far, 1e4)).add(r.origin);
    worldBox.makeEmpty().expandByPoint(r.origin).expandByPoint(end);
    for (const p of (among ?? [...this.parts.values()]) as Kept[]) {
      if (!p.box.intersectsBox(worldBox)) continue;
      ray.copy(r);
      if (!p.identity) ray.applyMatrix4(p.inverse);
      const h = p.bvh.raycastFirst(ray, DoubleSide);
      if (!h) continue;
      const point = h.point.clone();
      if (!p.identity) point.applyMatrix4(p.matrix);
      const distance = point.distanceTo(r.origin);
      if (distance > far || (best && distance >= best.distance)) continue;
      const n = h.face ? h.face.normal.clone() : new Vector3(0, 1, 0);
      if (!p.identity) n.transformDirection(p.matrix);
      best = { point, distance, up: n.y };
    }
    return best;
  }

  /** The height of the highest thing under (x, z) and below `top`, or null. */
  heightAt(x: number, z: number, top: number): number | null {
    const h = this.first(new Ray(new Vector3(x, top, z), new Vector3(0, -1, 0)));
    return h ? h.point.y : null;
  }

  /** Whether anything solid is inside a box in the world (a slab between two places, say): of `among` alone if given. */
  inBox(b: Box3, among?: SolidPart[]): boolean {
    for (const p of (among ?? [...this.parts.values()]) as Kept[]) {
      if (!p.box.intersectsBox(b)) continue;
      // (Asked in the part's own frame: the box, carried there by the inverse of where the part stands.)
      if (p.bvh.intersectsBox(b, p.inverse)) return true;
    }
    return false;
  }

  /** Whether anything solid lies on the straight way from `a` to `b`. */
  blocked(a: Vector3, b: Vector3, among?: SolidPart[]): boolean {
    const d = b.clone().sub(a), far = d.length();
    if (far < 1e-6) return false;
    return !!this.first(new Ray(a.clone(), d.divideScalar(far)), far, among);
  }
}
