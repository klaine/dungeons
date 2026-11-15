import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import { layMasonry, MasonryStyle } from './geom/masonry';
import { MeshBuilder } from './geom/meshBuilder';

/**
 * A door leaf: upright planks with a round head to fit an arched doorway, closed on every side.
 *
 * Built in its own coordinates, hinge at the origin: x runs across the door from the hinge,
 * y is up, and the leaf is centred on z = 0. The renderer places and swings it.
 */

const board: MasonryStyle = {
  course: [0.18, 0.26], length: [6, 7], joint: 0.003, bevel: 0.006, depth: 0.01, proud: 0.004, relief: 0.003,
  maxSeg: 0.3, chip: 0, tint: [0.92, 0.88, 0.82], tintVar: 0.22, hueVar: 0.05, mortar: [0.08, 0.06, 0.04], uvScale: 0.55,
};

export function buildDoorLeaf(seed: string, halfWidth: number, spring: number, thickness: number): MeshBuilder {
  const mesh = new MeshBuilder();
  const rng = new Rng(seed);
  const w = halfWidth;
  const top = spring + w;
  // Pull anything outside the round head back onto it, so the boards end on the arch.
  const clamp = (uv: [number, number]) => {
    const dy = uv[0] - spring;
    if (dy <= 0) return;
    const dx = uv[1] - w;
    const d = Math.hypot(dx, dy);
    if (d > w) {
      uv[0] = spring + (dy * w) / d;
      uv[1] = w + (dx * w) / d;
    }
  };
  for (const side of [1, -1]) {
    // Boards run up the door: u is height, v is across.
    layMasonry(mesh, (u, v, p: Vector3, n: Vector3) => {
      p.set(v, u, (side * thickness) / 2);
      n.set(0, 0, side);
    }, { u0: 0, u1: top, v0: 0, v1: 2 * w, style: board, rng: rng.fork(`face${side}`), clampUV: clamp, open: { u0: true, u1: true, v0: true, v1: true } });
  }
  // The edge all the way round, as four runs so the corners stay square.
  const edge = (length: number, at: (u: number, p: Vector3, n: Vector3) => void, label: string) => {
    layMasonry(mesh, (u, v, p: Vector3, n: Vector3) => { at(u, p, n); p.z = v; }, {
      u0: 0, u1: length, v0: -thickness / 2, v1: thickness / 2, style: { ...board, length: [0.4, 0.6], course: [thickness, thickness] },
      rng: rng.fork(label), singleCourse: true, open: { u0: true, u1: true, v0: true, v1: true },
    });
  };
  edge(2 * w, (u, p, n) => { p.set(u, 0, 0); n.set(0, -1, 0); }, 'bottom');
  edge(spring, (u, p, n) => { p.set(2 * w, u, 0); n.set(1, 0, 0); }, 'free');
  edge(spring, (u, p, n) => { p.set(0, u, 0); n.set(-1, 0, 0); }, 'hinge');
  edge(Math.PI * w, (u, p, n) => {
    const a = u / w;
    n.set(Math.cos(a), Math.sin(a), 0);
    p.set(w + w * n.x, spring + w * n.y, 0);
  }, 'head');
  return mesh;
}
