/**
 * The site document: what a generated place is, independent of how it is drawn.
 *
 * A site is a set of rectangular places, joined by ways. In the first version of this document
 * every place stood on one shared plan and every way went through the wall between two of them.
 * In the second, places may also lie one above another, on storeys, and a way may be a stair
 * that climbs from a place to the one over it. Axes: +x east, +y up, +z south; lengths in metres.
 */

export type Side = 'n' | 's' | 'e' | 'w';

export type Roof =
  /** A half-round stone vault along the place's long axis. */
  | 'barrel'
  /** A flat ceiling of boards on beams. */
  | 'timber'
  /** Open to the sky. */
  | 'sky'
  /** Not built at all: a natural cave, with rock for walls, floor and ceiling. */
  | 'cave';

export type Role = 'approach' | 'entrance' | 'passage' | 'court' | 'reward' | 'goal';

/**
 * How a place is lit. Darkness is a choice the generator makes, not a failure to place lights:
 * a dark room is somewhere the player's own light matters.
 */
export type Lighting =
  /** Open to the sky, or lit through windows and arches from a court. */
  | 'day'
  /** Torches on the walls. */
  | 'torch'
  /** Nothing. Only what the player carries, and what spills in through the doors. */
  | 'dark'
  /** In a cave: growths on the rock that give a faint light of their own. */
  | 'glow';

export interface Place {
  id: number;
  role: Role;
  roof: Roof;
  light: Lighting;
  /** Interior extent. Walls lie outside it. */
  x0: number; x1: number; z0: number; z1: number;
  /** Floor height. */
  floor: number;
  /** Height of the walls above the floor: to the springing of a vault, or to a flat ceiling. */
  wall: number;
  /** Direction a barrel vault runs. */
  axis: 'x' | 'z';
  /** Steps from the entrance, counted in places. */
  depth: number;
  /** What the place is in the fiction. Furnishing follows from it. */
  name: string;
  /** The roof has come down: open to the sky, with what fell still lying there. */
  fallen?: boolean;
  /** In a cave: a hole in the roof, open to the sky above the hill, that lets daylight down. */
  shaft?: { x: number; z: number; r: number };
  /**
   * Which storey the place is on: 0, or left out, for the ground storey that all the places of
   * version 1 stand on; 1 for a room over one of those; -1 for a cellar under one. A place on
   * another storey has the same outline as the place it is over or under, and is reached from
   * it by a stair.
   */
  level?: number;
}

/** Keys are told apart by their metal. */
export type KeyId = 'iron' | 'gold';

/** A door leaf hung in a doorway, and what stops it opening. */
export interface DoorSpec {
  /**
   * Shut doors open when approached, unless something holds them. Open ones are just standing open.
   * A gate is a portcullis: it can be seen through, and only its lever raises it. A secret door
   * is faced in stone to pass for wall, and gives way when pressed.
   */
  leaf: 'shut' | 'open' | 'gate' | 'secret';
  /** Index into the site's levers of the one that raises this gate. */
  lever?: number;
  /** Needs this key. */
  lock?: KeyId;
  /** Barred on the side of this place: it opens only from there, and stays open afterwards. */
  barredFrom?: number;
}

/** Something to pick up. */
export interface Item {
  kind: 'key';
  key: KeyId;
  place: number;
}

/** A lever standing on the floor of a place, which raises a gate somewhere. */
export interface Lever {
  place: number;
  /** Index into the site's ways of the gate it raises. */
  opens: number;
  x: number;
  z: number;
}

export interface Way {
  /** Place ids. `side` is the wall of place `a` that the way passes through. */
  a: number;
  b: number;
  side: Side;
  door?: DoorSpec;
  /**
   * A door is a person-sized arch; an arch is a wide open bay; a window cannot be walked through.
   * A stair does not go through a wall at all. It joins a place (`a`, the lower) to the place
   * directly over it (`b`): a straight flight inside the lower place, hard against its `side`
   * wall, rising from `at` along that wall to `to`, where it comes up through the floor above.
   * `halfWidth` is half the breadth of the flight.
   */
  kind: 'door' | 'arch' | 'window' | 'stair';
  /** Position of the centre along the wall: an x coordinate for north and south walls, z for east and west. */
  at: number;
  halfWidth: number;
  /** For a stair: where along the wall its head is, as `at` is where its foot is. */
  to?: number;
  /**
   * A way between two chambers of a cave: a cleft in the rock, not something built. It has no
   * door and no steps; its floor slopes from the one chamber's level to the other's.
   */
  natural?: boolean;
}

/** Something out in the valley. */
export interface Feature {
  /**
   * A pond lies in a hollow, with a landing stage built out into it from the side nearest the
   * track. Stones are a ring of standing stones on a low rise, with a flat stone in the middle.
   * A ruin is what is left of a small stone hut: broken walls, and a doorway on the side of the track.
   */
  kind: 'pond' | 'stones' | 'ruin';
  x: number;
  z: number;
  /** Radius: of the hollow the pond lies in, of the ring, or of the ground the ruin stands on. */
  r: number;
  /**
   * For a pond: its outline. How far the edge of its hollow lies from the middle in each of an
   * even ring of directions, starting towards +x and turning towards +z, as a share of `r`.
   * Left out, the pond is round. A pond may be a pool a few paces across or a lake that fills
   * its side of the valley; its shore bends away from the track and from whatever else is there.
   */
  shore?: number[];
  /** For a lake: a small island in it, as where its middle is and how far it is across its top. */
  isle?: { x: number; z: number; r: number };
}

/**
 * Running water. It rises at a spring under the rock, or runs out of a pond; it ends in a pond,
 * or goes to ground in a sink at the foot of the rim. The builder cuts it a bed that falls all
 * the way, so it never runs uphill, however the ground lies.
 */
/**
 * A terrace: a shelf of level ground standing out from one of the valley's side walls, part-way
 * up it, with a cliff of its own below and the rest of the wall behind. It is reached by a
 * ledge that rises along the wall from the valley floor, beginning beyond one end of it. From
 * the top the whole valley can be seen, and something has been left at its far end.
 */
export interface Terrace {
  /** Which side wall it stands against: `w` is the side of lesser x. */
  side: 'w' | 'e';
  /** Its level part lies from `z0` to `z1` along the valley. */
  z0: number;
  z1: number;
  /** How far it stands out from the foot of the wall, and how high above the valley floor, in metres. */
  depth: number;
  height: number;
  /** Which end the way up is at (`n` is towards the house), and how far the way up runs along the wall beyond that end. */
  rise: 'n' | 's';
  run: number;
  /** What the way up is: a ledge the rock happens to offer, or steps somebody cut in it, which are steeper and shorter. */
  way: 'ledge' | 'steps';
  /** Whether the lookout at its far end is a shrine, which pilgrims climb to, with wayside crosses up the way to it; otherwise there is a cairn. */
  shrine?: boolean;
}

/**
 * A grotto: a cave in one of the valley's side walls. Most are small and natural; some are halls cut by hand (see `hall`). Its mouth is at the foot of the
 * wall, at `z` along the valley; a passage runs in under the hill to a chamber about `r` across
 * the half of it. It has nothing to do with the house. Something glows in it, and something was left there.
 */
export interface Grotto {
  side: 'w' | 'e';
  z: number;
  r: number;
  /**
   * If present, this is no natural cave but a hall hewn under the hill, and `r` is not used.
   * A squared doorway in the rock face opens on a broad stair that goes down `drop` metres, and
   * at its foot is the hall: `length` metres on from there, `width` across, `height` to the
   * crown of its roof, with two rows of pillars down it and a tomb on a dais at the far end.
   * It is lit by torches on the pillars and by nothing else.
   */
  hall?: {
    length: number; width: number; height: number; drop: number;
    /**
     * If present, the hall is one of the great ones, and the stair does not come down to its
     * floor but out onto a ledge across its near end, `deep` metres above the floor: the hall
     * is first seen from above, whole. (`height` is still from the floor to the crown.) From the
     * ledge a stair goes down along one side wall; along the other, the side named by `gallery`
     * (`n` is the side of lesser z), runs a gallery behind an arcade at the ledge's level, with
     * an aisle under it. A chasm crosses the floor from `chasm.at` metres into the hall, `width`
     * across and `depth` deep, with a bridge over it at the floor and another at the level of
     * the gallery; steps cut in its far side climb out of it. Daylight comes down a shaft in
     * the roof and falls where the lower bridge begins.
     */
    great?: { deep: number; gallery: 'n' | 's'; chasm: { at: number; width: number; depth: number } };
  };
}

/**
 * A building that stands by itself in the valley and is seen from outside: a house, an inn, a
 * lodge. It has a style, which decides how it is made and of what, and a few measures; the rest
 * (where each timber goes, what stands in each window) is worked out by whoever builds it, from
 * these and from the site's seed. Its doors are shut: nothing in it is part of the house's mission.
 *
 * `x`, `z` is the middle of the ground it stands on; `w` is its breadth along its front and `d`
 * its depth from front to back, both outside its walls. `faces` is the way its front looks: `e`
 * towards greater x, `w` towards lesser. `storeys` counts the ground storey; the roof is above the
 * last. `heights` is how high each storey is, from its floor to the floor above, the ground storey
 * first; they differ from building to building and from storey to storey, as they do in a real
 * street. `bays` is how many windows stand in a row across the front. `colour` is the wash on its
 * walls, or what fills the spaces between its timbers.
 *
 * Of the style `timber`: a framed house of posts, rails and braces on a ground storey of plastered
 * stone, as in the old towns of Alsace and the Moselle. Each upper storey stands `jetty` metres
 * further out over the street than the one below; `gable` says whether a gable of the steep tiled
 * roof faces the street (true) or its eaves do, with dormers in the roof (false).
 *
 * Of the style `imperial`: a stuccoed classical building of the early nineteenth century, as on
 * the market squares of the northern capitals. A rusticated ground storey, tall windows in even
 * rows above it, a heavy cornice and a low metal roof; with `portico`, the middle bays stand
 * forward under pilasters and a pediment.
 */
/**
 * The plan of a building's rooms: alike on every storey, except where a room or a door names the
 * one `storey` it is on (a timber house is planned storey by storey). Everything is in the building's own
 * measures: `u` across the front from its middle, to the right as seen from outside; `v` back
 * from the face of the front wall. A room is its clear floor, inside its walls.
 */
export interface BuildingPlan {
  /**
   * `linings` is how far each of the room's walls reaches out from its floor before it meets the
   * next room's or the rendered skin outside, in the order front, back, left, right (as `v0`,
   * `v1`, `u0`, `u1`): half a wall between rooms, all of an outer wall within its skin.
   */
  rooms: { kind: 'hall' | 'stair' | 'passage' | 'front' | 'back' | 'wing'; u0: number; u1: number; v0: number; v1: number; linings: [number, number, number, number]; storey?: number }[];
  /** Doorways between rooms: in the wall whose middle line is at `at` (a `u` if `line` is `u`, a `v` if `v`), centred at `c` along it, `w` wide; `tall` for an arch into a stair hall. */
  doors: { line: 'u' | 'v'; at: number; c: number; w: number; tall?: boolean; through?: number; storey?: number }[];
  /** The thickness of the outer walls, of the wall down the middle of the depth, and of the walls between rooms. */
  walls: { outer: number; spine: number; cross: number };
}

export interface Building {
  style: 'timber' | 'imperial';
  x: number;
  z: number;
  w: number;
  d: number;
  faces: 'e' | 'w';
  storeys: number;
  heights: number[];
  bays: number;
  colour: [number, number, number];
  jetty?: number;
  gable?: boolean;
  /** Of a timber house: where its door is in the front, as a share of the front's breadth from its left end as one stands before it. */
  door?: number;
  /**
   * Of a mill: its waterwheel, standing in the stream beside its back wall: where the wheel's
   * middle is (`x`, `z`, and `y` above the ground before the mill's door), and its radius. The
   * axle runs through the back wall, square to it.
   */
  wheel?: { x: number; z: number; y: number; r: number };
  portico?: boolean;
  /**
   * For a building set into rising ground: how much higher the ground stands at its back than
   * before its door. Its lowest storey is then half a basement, open to the front and buried at
   * the back, and it has a second door in the back wall, at `backDoor` across it, onto the ground there.
   */
  sunk?: number;
  backDoor?: number;
  /**
   * Wings reaching back from the ends of the main block, making the building an L (one) or a U
   * (two) about a court behind it. `side` is -1 for the left end as one stands before it and 1
   * for the right; `width` is how much of the main block's breadth the wing takes, from its end
   * inward; `length` is how far it reaches back beyond the main block. It has the main block's storeys.
   */
  wings?: { side: -1 | 1; width: number; length: number }[];
  /** Its rooms, if it has any that can be gone into. */
  plan?: BuildingPlan;
}

/**
 * A tower: a square building of stone standing by itself in the valley, not far from the track.
 * Inside it is one room to a storey, `half` metres from its middle to each wall, and a stair
 * from each storey to the next, the flights against the north and south walls by turns. The
 * last flight comes out on a flat roof with a parapet. The door is in the wall named, on the
 * ground; there are slit windows above. It is no part of the house and has nothing to do with
 * its doors and keys.
 */
export interface Tower {
  x: number;
  z: number;
  half: number;
  storeys: number;
  door: 'e' | 'w';
}

export interface Stream {
  /** The line it follows, in order from where it begins to where it ends. */
  course: [number, number][];
  /** How broad it is, in metres: a brook is one or two, a small river three or four. */
  width: number;
  /** Where it begins: at a spring under the rim, over the rim as a waterfall, or out of the pond. */
  from: 'spring' | 'fall' | 'pond';
  /** Where it ends: in the pond; going to ground in a sink at the foot of the rock; or out of the valley by the gap at its foot, beside the track (`out`). */
  to: 'pond' | 'sink' | 'out';
  /** Where it crosses the track, if it does, and how the track gets over: stepping stones through a brook, a timber bridge over a river. */
  crossing?: { x: number; z: number; by: 'ford' | 'bridge' };
}

/** How far the edge of a pond's hollow is from its middle in the direction of (dx, dz), in metres. */
export function shoreOf(f: Feature, dx: number, dz: number): number {
  if (!f.shore || !f.shore.length) return f.r;
  const n = f.shore.length, a = ((Math.atan2(dz, dx) / (Math.PI * 2)) * n + n) % n;
  const i = Math.floor(a), t = a - i, u = t * t * (3 - 2 * t);
  return f.r * (f.shore[i % n] + (f.shore[(i + 1) % n] - f.shore[i % n]) * u);
}

/**
 * The shape of the valley: where its two sides lie, the west (lesser x) and the east, at every
 * `step` metres down its length from `z0`, which is the front of the house. The rock rises from
 * those lines. `mouth` is how far down the gap is by which the track leaves; what is recorded
 * beyond it is the country outside, which is seen and not walked.
 */
export interface Valley {
  z0: number;
  step: number;
  west: number[];
  east: number[];
  mouth: number;
  /**
   * The ridge the house is built into: high ground from `x0` to `x1` across, from the house front
   * at `z` northward without end. The valley does not stop at the house: where a side lies
   * further out than the ridge north of the house front, the valley runs on past the house on
   * that side as an arm, which closes at its head where the side comes back to the ridge.
   */
  ridge?: { x0: number; x1: number; z: number };
  /**
   * A bay in one side, below a village's keep: centred at `z`, `half` along the valley either way,
   * and reaching `depth` out beyond `mouth`, the line the side ran along before. Its floor rises
   * `rise` over the first two-fifths of it, as a ramp, and is level beyond, a shelf for the keep.
   */
  bay?: { side: 'w' | 'e'; z: number; half: number; depth: number; rise: number; mouth: number };
}

/**
 * An island: the other kind of place there is besides a valley. The house stands on high ground
 * at one end of it, and the rest is turf and heather falling to the sea in cliffs, except where a
 * cove is cut into its side, round as a bowl, with a narrow mouth to the open sea and a beach at
 * its head, where boats come in. Everything is measured from `x`, `z`, the island's middle.
 *
 * `coast` is how far the top of the cliffs lies from the middle in each of an even ring of
 * directions, starting towards +x and turning towards +z. `sea` is the level of the sea; the
 * house's forecourt is at its own floor, some way above it. The cove is a disc of water `r`
 * across the half of it, joined to the open sea by a channel `mouth` wide, which leaves it at
 * the bearing `out` (radians, measured as `coast` is). Its beach is the part of its rim facing
 * back into the island, `beach` radians to either side of that.
 */
export interface Island {
  x: number;
  z: number;
  coast: number[];
  sea: number;
  cove: { x: number; z: number; r: number; out: number; mouth: number; beach: number };
  /**
   * How the island is come to. At a `beach`, the land comes down to the head of the cove through a
   * hollow, and a jetty runs out from the sand. At a `stair`, the cove is walled all round by cliff:
   * a stone quay stands at the foot of it, and a stair cut in the rock (`stair`) climbs the cove's
   * wall from the quay to the top, turning back on itself where it runs out of room.
   */
  landing?: 'beach' | 'stair';
  /** The stair cut in the cliff, as points `[x, z, y]` from its foot on the quay to its head on the top, a stride or so apart. */
  stair?: [number, number, number][];
  /**
   * The way from the door to the landing (to the head of the stair, or the head of the jetty), as
   * points `[x, z, y]`: the ground is cut and made up to this level along it, so that it never
   * climbs more steeply than a path can, whatever the land does about it.
   */
  way?: [number, number, number][];
  /** Summits: high ground rising `height` metres over the forecourt's floor about `x`, `z`, falling away over `r`, steep and broken. */
  peaks?: { x: number; z: number; r: number; height: number }[];
  /** How far the land comes down towards the sea near the coast in each of the directions `coast` is given for, 0 to 1: at 1 it runs down to a low rocky shore, at 0 it ends in the full height of the cliff. */
  edge?: number[];
  /** The island's back, a rise of `height` metres over the forecourt's level, round `x`, `z`, falling away over `r`. */
  crown: { x: number; z: number; r: number; height: number };
  /** How far up from the beach the land comes down to it, in metres: the hollow the village stands in. */
  combe: number;
  /** The ground about the house, kept level at the forecourt's floor: the house and its forecourt, with room to walk round. */
  level: { x0: number; x1: number; z0: number; z1: number };
  /** A jetty of stone from the beach out into the cove, from `from` to `to`, `width` across, on which the player arrives. */
  jetty: { from: [number, number]; to: [number, number]; width: number };
  /**
   * A lighthouse on a headland: a round tower `r` across the half of it at its foot, `height` to
   * the gallery round its lantern, its door towards `door` (radians), with a keeper's cottage
   * against it, on ground levelled at `y`. It can be gone into, and a stair winds up inside it to the gallery.
   */
  lighthouse?: { x: number; z: number; y: number; r: number; height: number; door: number };
  /** The ruin of a castle on another headland, facing `facing` (radians), solid and walked round, not gone into. */
  castle?: { x: number; z: number; y: number; facing: number };
  /**
   * Or a mansion: a stuccoed classical house of the kind a valley may have for its manor, made by
   * the same rules (see `Building`, style `imperial`), standing back from a headland with its
   * front to the sea, on ground levelled for it at `y`. It can be gone into.
   */
  mansion?: { building: Building; y: number };
  /** Or, on an island with no castle, the ruin of a chapel on that headland: its west front standing and its walls broken down, its east end towards `facing`. */
  chapel?: { x: number; z: number; y: number; facing: number };
  /**
   * The monks' burial ground, beside the house on the forecourt's level: a walled rectangle
   * `w` along z and `d` along x, its middle at `x`, `z`, with a gap in its wall on the side
   * towards the house, headstones in rows, and a high cross of stone.
   */
  graveyard?: { x: number; z: number; w: number; d: number };
  /**
   * Fishermen's cottages on the slope above the beach: low, of whitewashed rubble, thatched or
   * slated, a chimney at one gable. `w` along the front and `d` deep, outside the walls; the front
   * looks towards `faces` (radians); `y` is the ground levelled for it. Each is one room, and its door stands open.
   */
  cottages: { x: number; z: number; y: number; w: number; d: number; faces: number; roof: 'thatch' | 'slate'; wash: [number, number, number] }[];
  /** Boats drawn up on the beach, or moored in the cove: where, which way the bow points, and how long. */
  boats: { x: number; z: number; heading: number; length: number; afloat: boolean }[];
  /** Pillars of rock standing out of the sea off the cliffs: where, how broad at the foot, how high their tops stand over the sea. */
  stacks: { x: number; z: number; r: number; height: number }[];
  /** A cave in the cliff of the cove, entered dry-shod from the end of its beach at `x`, `z`, running in towards `heading` for `length` metres. */
  seaCave?: { x: number; z: number; heading: number; length: number };
  /** The mainland, seen across the water: its nearest shore lies `distance` metres off at the bearing `bearing` (radians), and it spans `spread` radians either way. `height` scales its hills and mountains: low green country at 0.3, a snowy range at 1. */
  mainland: { bearing: number; spread: number; distance: number; height?: number };
  /** Small islands between, seen and not reached. */
  islets: { x: number; z: number; r: number; height: number }[];
}

export interface Site {
  seed: string;
  places: Place[];
  ways: Way[];
  items: Item[];
  levers: Lever[];
  /** A place hidden behind a secret door, with something in it worth finding; -1 if there is none. */
  secret: number;
  /**
   * The open country that can be walked, the approach included: the box that holds the valley,
   * from the house front at its north to the gap at its south. Absent in a site that has no more
   * than its approach.
   */
  grounds?: { x0: number; x1: number; z0: number; z1: number };
  /** The shape of that country, of which `grounds` is only the box that holds it. */
  valley?: Valley;
  /** If present, the site is not a valley at all but an island in the sea, and `valley` is absent. */
  island?: Island;
  /**
   * How the house stands: built into the end of a ridge, its rooms under the hill with courts
   * open through it (`hill`, and so when absent); standing free in the valley, walled and
   * roofed, with the valley all round it (`free`); or no house at all but a delve (`delve`): the
   * same plan under the same ridge, but its rooms are caves and its courts caverns lit from
   * shafts, and only where something had to be built (the way in, the sanctum, a room with a
   * stair, a secret door, a door to hang) is there masonry. Its front is the rock of the ridge,
   * with a built portal in it for the door.
   */
  stands?: 'hill' | 'free' | 'delve';
  /**
   * The way from the door down the valley, as points from the door outwards. Flags as far as the
   * edge of the approach and a worn track after that. The player arrives at the last point.
   */
  track?: [number, number][];
  /** Things in the valley worth walking to. */
  features?: Feature[];
  /**
   * Footpaths: worn lines in the turf, narrower than the track, from it to something off it.
   * Each is its points in order from where it leaves the track, and what it leads to.
   */
  paths?: { points: [number, number][]; to: 'cave' | 'ruin' | 'stones' | 'pond' | 'tower' | 'keep' | 'mill' | 'shrine' | 'lighthouse' | 'castle' | 'chapel' | 'mansion' }[];
  /** Running water in the valley, if there is any. */
  streams?: Stream[];
  /** Ground in the valley that stands above its floor and can be climbed to. */
  terraces?: Terrace[];
  /** Caves in the valley's own walls, entered from its floor. */
  grottoes?: Grotto[];
  /** Buildings that stand by themselves in the valley. */
  towers?: Tower[];
  /** Buildings standing in the valley, apart from the house: see `Building`. */
  buildings?: Building[];
  /**
   * What kind of settlement the valley has, decided before anything else is put in it: a
   * village along the track with a keep above it, a hamlet of a few houses, a manor house of
   * the classical kind, or none.
   */
  settlement?: 'village' | 'hamlet' | 'manor';
  /**
   * The keep over a village: a tower, or a tower within the curtain walls of a small castle, on
   * the shelf of a bay in the valley's side (see `Valley.bay`), up a ramp from the village. The
   * tower is in `towers`, and can be gone into and climbed. `x` and `z` are the middle of the castle.
   */
  keep?: { x: number; z: number; kind: 'tower' | 'castle' };
  /**
   * Things standing on the hills beyond the valley, to be seen on the skyline: a castle, a lone
   * tower, the ruin of an abbey, or a monument. `angle` is the bearing from the middle of the
   * valley, in degrees from the direction of greater x towards greater z; `range` is `near`
   * for the wooded hills that ring the valley, `far` for the mountains behind them. Whoever
   * builds it puts it on the highest ground at that bearing in that range.
   */
  landmarks?: { kind: 'castle' | 'tower' | 'ruin' | 'monument'; angle: number; range: 'near' | 'far' }[];
  /** Where the player starts. */
  start: number;
  /** Thickness of the walls between places. */
  wallThickness: number;
  /** Height of the roofline; courts are open wells down from it. */
  top: number;
  entrance: number;
  goal: number;
  setting: Setting;
  /** Unit vector towards the sun. */
  sun: [number, number, number];
  /** One sentence describing the place. */
  title: string;
}

export type Stone = 'limestone' | 'sandstone' | 'greystone' | 'basalt';
export type Hour = 'morning' | 'midday' | 'evening' | 'sunset' | 'dusk' | 'night';

/** Where and when: what the place is built of, what it is called, and the time of day. */
export interface Setting {
  stone: Stone;
  hour: Hour;
  /** What kind of house it is, for its name. */
  kind: string;
  /** How it has fared: looked after, left to the wet, or abandoned long enough for a roof to fall. */
  condition: 'kept' | 'damp' | 'forsaken';
  /** The time of year, which colours everything that grows. */
  season?: 'spring' | 'summer' | 'autumn';
  /** How much of the sky is cloud, from 0 for clear to 1 for overcast. Clouds drift, and shade what is under them. */
  cloud?: number;
  /** Whether that cloud is heaped up or lies in flat banks. */
  cloudForm?: 'heaped' | 'layered';
  /** How much mist lies in the low ground, from 0 for none to 1 for a morning you cannot see across. */
  mist?: number;
  /** How thick the air is with distance, from 0 for the clearest day to 1 for hills that are barely there. */
  haze?: number;
}

/**
 * The light at each time of day, in the renderer's light units.
 *  - `sun` is where the strongest light comes from, and `colour` and `intensity` what it is: the
 *    sun by day, the glow where it went down at dusk, the moon at night.
 *  - `disc` is where the sun itself stands, for drawing the sky; below the horizon after sunset.
 *    Left out, it is where the light comes from.
 *  - `zenith`, `horizon` and `ground` are how bright the sky is overhead and at its edge, and the
 *    light thrown up by the land.
 *  - `night` is how far the stars are out, 0 to 1, and `eyes` how far eyes open in the dark: the
 *    most that exposure may rise to.
 */
export interface Sky {
  sun: [number, number, number];
  colour: [number, number, number];
  intensity: number;
  zenith: number[];
  horizon: number[];
  ground: number[];
  disc?: [number, number, number];
  night?: number;
  eyes?: number;
}

export const SKIES: Record<Hour, Sky> = {
  morning: { sun: [0.5, 0.62, 0.6], colour: [1.0, 0.88, 0.72], intensity: 11, zenith: [0.16, 0.3, 0.62], horizon: [0.66, 0.72, 0.8], ground: [0.09, 0.08, 0.07] },
  midday: { sun: [-0.12, 0.9, 0.42], colour: [1.0, 0.96, 0.9], intensity: 12.5, zenith: [0.14, 0.28, 0.66], horizon: [0.6, 0.72, 0.88], ground: [0.1, 0.09, 0.08] },
  evening: { sun: [-0.62, 0.5, 0.6], colour: [1.0, 0.7, 0.46], intensity: 9.5, zenith: [0.14, 0.22, 0.5], horizon: [0.8, 0.62, 0.48], ground: [0.08, 0.07, 0.06] },
  // The sun a hand's breadth above the hills: long shadows, red light, a sky going from gold to deep blue.
  sunset: { sun: [-0.8, 0.17, 0.57], colour: [1.0, 0.46, 0.2], intensity: 7.5, zenith: [0.07, 0.1, 0.26], horizon: [0.9, 0.46, 0.24], ground: [0.06, 0.045, 0.035], eyes: 2 },
  // The sun gone: no shadows to speak of, a band of rose where it went down, and the first stars.
  dusk: { sun: [-0.78, 0.26, 0.57], colour: [0.9, 0.55, 0.5], intensity: 0.9, zenith: [0.022, 0.032, 0.085], horizon: [0.2, 0.13, 0.15], ground: [0.02, 0.018, 0.02], disc: [-0.8, -0.07, 0.59], night: 0.35, eyes: 3.2 },
  // Moonlight: cold, faint, with shadows; every lit window and torch counts for much more.
  night: { sun: [0.42, 0.72, 0.55], colour: [0.62, 0.74, 1.0], intensity: 0.5, zenith: [0.006, 0.009, 0.024], horizon: [0.014, 0.018, 0.034], ground: [0.006, 0.006, 0.008], disc: [-0.5, -0.6, 0.62], night: 1, eyes: 4.5 },
};

/** How each time of day is put in a sentence. */
export const WHEN: Record<Hour, string> = { morning: 'in the morning', midday: 'at midday', evening: 'at evening', sunset: 'at sunset', dusk: 'at dusk', night: 'by night' };

export const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Ways that can be walked through, as an adjacency list. */
export function neighbours(site: Site): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const p of site.places) adj.set(p.id, []);
  for (const w of site.ways) {
    if (w.kind === 'window') continue;
    adj.get(w.a)!.push(w.b);
    adj.get(w.b)!.push(w.a);
  }
  return adj;
}

/**
 * Where a stair is stood at to go up it, and where one stands having come up: a stride before
 * its foot on the lower floor, and a stride beyond its head on the upper, each in the middle of
 * the flight's breadth. Walking from one to the other in a straight line is walking the stair.
 */
export function stairEnds(site: Site, w: Way): { foot: [number, number]; head: [number, number] } {
  const p = site.places[w.a], to = w.to ?? w.at, dir = to >= w.at ? 1 : -1, off = w.halfWidth;
  const at = (u: number): [number, number] => (w.side === 'n' ? [u, p.z0 + off] : w.side === 's' ? [u, p.z1 - off] : w.side === 'w' ? [p.x0 + off, u] : [p.x1 - off, u]);
  return { foot: at(w.at - dir * 0.6), head: at(to + dir * 0.6) };
}

/** Number of independent loops in the walkable graph: edges minus places plus one, for a connected site. */
export function loopCount(site: Site): number {
  const edges = site.ways.filter((w) => w.kind !== 'window');
  const pairs = new Set(edges.map((w) => `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`));
  return pairs.size - site.places.length + 1;
}

/** Whether every place can be reached on foot from the entrance. */
export function allReachable(site: Site): boolean {
  const adj = neighbours(site);
  const seen = new Set<number>([site.entrance]);
  const queue = [site.entrance];
  while (queue.length) {
    for (const n of adj.get(queue.pop()!)!) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === site.places.length;
}
