import { Vector3 } from 'three';
import { Mass } from './geom/kit';
import { MeshBuilder } from './geom/meshBuilder';

/** What the renderer needs to show a place, whether assembled by hand or meshed from a generated site. */

export interface TorchSpec {
  position: Vector3;
  /** Unit vector from the wall towards the room. */
  out: Vector3;
  /** If given, this is no torch on a wall but an open fire on the ground at `position`, its flame this many times a torch's. */
  fire?: number;
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
  kind: 'grass' | 'flower' | 'fern' | 'herb' | 'reed' | 'leaf' | 'needle' | 'pine' | 'fir' | 'tree' | 'thrift' | 'marram' | 'gorse' | 'bloom';
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

/**
 * The sea round an island: its level, the island's middle, and how high the bed lies under it on
 * a lattice about the island (beyond the lattice it is deep). The renderer draws the water from
 * it: clear over sand, dark where it is deep, and breaking white where it comes in on the shore.
 */
export interface SeaDesc {
  level: number;
  x: number;
  z: number;
  bed: { x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array };
  /** Points at the foot of the cliffs where the swell breaks into spray, each with the way out to sea. */
  spray?: { x: number; z: number; nx: number; nz: number }[];
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
  sun?: {
    colour: [number, number, number]; intensity: number; sky: { zenith: number[]; horizon: number[]; ground: number[] };
    /** Where the sun itself stands, if not where the light comes from; how far the stars are out; how far eyes open; how much cloud. */
    disc?: [number, number, number]; night?: number; eyes?: number; cloud?: number;
    /** The air: whether cloud lies in flat banks, how much mist is in the low ground and how much haze in the distance (each 0 to 1), and how high the valley floor is, which the mist lies on. */
    layered?: boolean; mist?: number; haze?: number; floor?: number;
  };
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
  /**
   * Still water: a level surface over a hollow in the ground. `outline` is its edge as x and z in
   * turn, going round; without one it is a disc of radius `r`.
   */
  water?: { x: number; z: number; r: number; level: number; outline?: number[] }[];
  /** Running water: the middle of its surface as x, y and z in turn, from where it rises to where it ends, and its breadth. Optionally how far it reaches to the left and right of each point and how much of it shows there (0 to 1). */
  streams?: { line: number[]; width: number; banks?: number[]; fade?: number[] }[];
  /** Where water comes down over the rim: the pool at its foot, how far it falls, and how broad the stream is. */
  falls?: { x: number; y: number; z: number; height: number; width: number }[];
  /** Boxes of space that are underground though outside the house: no mist lies in them and no daylight reaches them. */
  unders?: { min: Vector3; max: Vector3 }[];
  /** A box about the cavern under the hill and the passage to it: no sky and no mist in it, as in `unders`, but kept apart from them so that the two are not made one box with open air between. */
  underDeep?: { min: Vector3; max: Vector3 };
  /** Where smoke rises out of doors, from what height, and how high it is drawn. */
  smokes?: { x: number; y: number; z: number; height: number }[];
  /** The lowest open ground of the valley: mist lies no lower than a little under this. */
  groundLow?: number;
  /** The lowest floor there is anywhere, if it is lower than the places' own floors and the halls under the hill: nobody has fallen out of the world who is above it. */
  lowest?: number;
  /** What stands on the far hills, and where: for checks and pictures. */
  landmarks?: { kind: string; x: number; y: number; z: number }[];
  /** Shafts of daylight coming down into a hall under the hill: where each begins, which way it goes, how far, and how broad. The air in them is lit. */
  sunShafts?: { top: Vector3; down: Vector3; length: number; radius: number }[];
  /** High places that can be climbed to: where the cairn stands on each, and how far above the valley floor. */
  lookouts?: { x: number; y: number; z: number; height: number }[];
  /** Where the track crosses running water, how it gets over, and how high the water stands there. */
  crossings?: { x: number; z: number; by: 'ford' | 'bridge'; level: number }[];
  /** What the land far off is covered with in this season: the colour of its woods and of its open ground. */
  far?: { wood: [number, number, number]; grass: [number, number, number]; sward?: [number, number, number]; bare?: [number, number, number, number] };
  /** The sea, if the place is an island. */
  sea?: SeaDesc;
  /** The sea of cloud, if the place is a mountain top: the level of its top, and how high its billows stand above and below that. Drawn with the air. */
  deck?: { level: number; billow: number };
  /** How much snow lies, from 0 for none to 1 for the whole of winter: the materials lay it on whatever is level enough to hold it. */
  snow?: number;
  /** Above what level snow lies more thickly, and how much more: so that in summer what is left of it is on the heights. */
  snowLine?: [number, number];
  /** Where gulls wheel, off the cliffs. */
  birds?: { x: number; y: number; z: number }[];
  /** Where a lighthouse's lamp is, whose beam turns at dusk and by night. */
  beacon?: { x: number; y: number; z: number };
  /** Small things left lying about for whoever walks that far. */
  finds?: { at: Vector3; what: string }[];
}
