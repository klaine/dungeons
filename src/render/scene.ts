import { Vector3 } from 'three';
import { Mass } from './geom/kit';
import { MeshBuilder } from './geom/meshBuilder';

/** What the renderer needs to show a place, whether assembled by hand or meshed from a generated site. */

export interface TorchSpec {
  position: Vector3;
  /** Unit vector from the wall towards the room. */
  out: Vector3;
}

/** A door leaf to hang: where its hinge is, how it swings, and what it blocks while shut. */
export interface DoorDesc {
  /** Index into the site's ways. */
  way: number;
  /** Foot of the hinge. */
  hinge: Vector3;
  /** Rotation about the vertical that lays the leaf across the opening. */
  yaw: number;
  /** Signed angle added when the door stands open. */
  swing: number;
  halfWidth: number;
  spring: number;
  thickness: number;
  /** Geometry in the leaf's own coordinates; see `buildDoorLeaf`. A gate has none: it is a grille of bars. */
  leaf: MeshBuilder | null;
  /** The space the shut door fills, for stopping the player. */
  blocker: { min: Vector3; max: Vector3 };
  /** Middle of the doorway, for deciding when the player has come up to it. */
  centre: Vector3;
  /** Which face of the leaf carries the bar, as a sign along the leaf's z; 0 for none. */
  barSide: number;
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
  /** The sun's colour and strength and the sky's radiance, if they differ from the defaults. */
  sun?: { colour: [number, number, number]; intensity: number; sky: { zenith: number[]; horizon: number[]; ground: number[] } };
  /** A one-line description to show the player. */
  title?: string;
  /** Doors to hang in the doorways. */
  doors?: DoorDesc[];
  /** Per place, the spot where a thing can be set down: the top of its chest or pedestal. */
  anchors?: Map<number, Vector3>;
}
