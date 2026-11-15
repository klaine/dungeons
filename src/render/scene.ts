import { Vector3 } from 'three';
import { Mass } from './geom/kit';
import { MeshBuilder } from './geom/meshBuilder';

/** What the renderer needs to show a place, whether assembled by hand or meshed from a generated site. */

export interface TorchSpec {
  position: Vector3;
  /** Unit vector from the wall towards the room. */
  out: Vector3;
}

export interface SceneDescription {
  /**
   * Geometry, keyed by "group|material". Each key becomes one mesh, so grouping by place lets
   * the renderer skip places that are out of view.
   */
  meshes: Map<string, MeshBuilder>;
  /** Solid volumes behind the visible skin, for the light bake and for shadows. */
  masses: Mass[];
  torches: TorchSpec[];
  sunDir: Vector3;
  spawn: { position: Vector3; yaw: number };
  bounds: { min: Vector3; max: Vector3 };
  blocks: number;
  /** A one-line description to show the player. */
  title?: string;
}
