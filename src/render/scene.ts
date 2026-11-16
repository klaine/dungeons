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
  /** What the leaf is made of. */
  material: 'wood' | 'stone';
  /** The space the shut door fills, for stopping the player. */
  blocker: { min: Vector3; max: Vector3 };
  /** Middle of the doorway, for deciding when the player has come up to it. */
  centre: Vector3;
  /** Which face of the leaf carries the bar, as a sign along the leaf's z; 0 for none. */
  barSide: number;
}

/**
 * Flat cards drawn many times over: grass, flowers, leaves. Each is a small textured sheet; a
 * crown of a tree is a few hundred of them. They are placed by the mesher and drawn by the
 * renderer, and take no part in the bake or in collision.
 */
export interface CardSet {
  /** What is painted on the cards. */
  kind: 'grass' | 'flower' | 'fern' | 'herb' | 'leaf' | 'needle';
  /** A tuft is three upright sheets crossed, standing on its base; a card is one sheet about its middle. */
  shape: 'tuft' | 'card';
  /** Whether the cards cast shadows. */
  shadow: boolean;
  /** Per card: a 4 by 4 transform (column-major), a colour, and the point its shading curves about. */
  matrices: number[];
  colours: number[];
  centres: number[];
}

/** What surrounds the site and is only looked at: far ground, mountains, and everything that grows. */
export interface Scenery {
  /** Unbaked geometry by material name. */
  meshes: Map<string, MeshBuilder>;
  cards: CardSet[];
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
  /** Per room, how many pieces of furniture were placed and why others were refused; for tuning. */
  furnishing?: Record<string, unknown>[];
  /** Doors to hang in the doorways. */
  doors?: DoorDesc[];
  /** Per place, the spot where a thing can be set down: the top of its chest or pedestal. */
  anchors?: Map<number, Vector3>;
  /**
   * Things that give a faint light of their own: growths on the rock of a cave. Each lies where
   * the line from `from` towards `position` first meets rock. Baked, and drawn as points of light.
   */
  glows?: { from: Vector3; position: Vector3; colour: [number, number, number]; strength: number }[];
  scenery?: Scenery;
  /** How many of each kind of plant were set out below the trees, for tuning the rules. */
  planted?: Record<string, number>;
  /** Boxes the player cannot enter: the edge of the world, where no rock happens to stand in the way. */
  fences?: { min: Vector3; max: Vector3 }[];
  /** Points along the way from where the player arrives to the door, for anything that must walk it. */
  track?: [number, number][];
  /** Still water: a level surface over a hollow in the ground. */
  water?: { x: number; z: number; r: number; level: number }[];
  /** Small things left lying about for whoever walks that far. */
  finds?: { at: Vector3; what: string }[];
}
