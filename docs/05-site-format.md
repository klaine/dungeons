# 5. The site format

What the tool exports, and how to use it somewhere else. This describes **version 2** of the format, which is what the tool writes today. Version 1 had every place on one plan and every way through a wall. Version 2 adds storeys: a place may have a `level`, and a way may be a `stair`. A reader of version 1 that meets neither will find a version 2 document unchanged; one that ignores them will find two places with the same outline where there is a room over a room.

A generated place leaves the tool as up to four files, all named for the seed:

| File | What it is |
| --- | --- |
| `<seed>.json` | The site document: every place, every way between places, what is locked and what opens it, and a route through. |
| `<seed>.glb` | The built world as a glTF 2.0 model: every stone, with materials. |
| `<seed>-plan.png` | The plan, with a key to the rooms. |
| `<seed>-map.png` | The same plan drawn in ink, as a referee's map. |
| `<seed>-battlemap.jpg` | The built world seen from straight above with the roofs cut away, ruled with a grid. |

The document is the source. The model and the maps are made from it, so they always agree with it and with each other. A game that wants its own look can ignore the model entirely and build from the document; a game that wants the tool's stonework can load the model and use the document to know what it is looking at.

`examples/viewer/` is a small page that does the second of these. It is published beside the tool, at `examples/viewer/`.

![The example viewer: the model cut open, with rooms named from the document and the route drawn through them](images/viewer.jpg)

## Conventions

- Lengths are in metres.
- Axes are right-handed: **+x is east, +y is up, +z is south.** On the maps north is up the page, so x runs right and z runs down.
- Places, ways and levers are referred to by their index in their arrays. A place's `id` is its index.
- The maps number rooms from 1, so room 4 on a map is `places[3]`.
- Numbers are written to four decimal places.

## The site document

```json
{
  "format": "dungeons-site",
  "version": 1,
  "seed": "ink-3",
  "title": "A limestone priory at evening: eleven rooms in a ring round a cloister court, …",
  "setting": { "stone": "limestone", "hour": "evening", "kind": "priory", "condition": "kept" },
  "sun": [-0.6217, 0.5014, 0.6017],
  "wallThickness": 1,
  "top": 9.2,
  "start": 13, "entrance": 4, "goal": 9, "secret": 12,
  "places": [ … ],
  "ways": [ … ],
  "items": [ … ],
  "levers": [ … ],
  "solution": [ … ]
}
```

| Field | Meaning |
| --- | --- |
| `format`, `version` | Always `"dungeons-site"` and the version number. Check both before reading anything else. |
| `seed` | The seed the site was generated from. The same seed in the same version of the tool gives the same site. |
| `title` | One sentence describing the place. |
| `setting.stone` | `limestone`, `sandstone`, `greystone` or `basalt`. |
| `setting.hour` | `morning`, `midday`, `evening`, `sunset`, `dusk` or `night`. The last three were added later; a reader that knows only the first three can treat them as `evening`. |
| `setting.kind` | What the house is called: priory, abbey and so on. Only a name. |
| `setting.condition` | `kept`, `damp` or `forsaken`. A forsaken house may have lost a roof. |
| `setting.cloud` | How much of the sky is cloud, from 0 (clear) to 1 (overcast). May be absent in older documents. |
| `setting.cloudForm` | `heaped` or `layered`: whether that cloud towers or lies in flat banks. May be absent, which means heaped. |
| `setting.mist` | How much mist lies in the low ground, from 0 (none) to 1 (a morning that cannot be seen across). Mostly when the day is young or done, and more in autumn. May be absent. |
| `setting.haze` | How thick the air is with distance, from 0 (the clearest day) to 1 (hills barely there). May be absent. |
| `setting.season` | `spring`, `summer` or `autumn`. It colours what grows: blossom and fresh green, deeper green and drier grass, or gold, rust and straw. |
| `sun` | Unit vector pointing towards the sun. |
| `wallThickness` | Thickness of the wall between two neighbouring places. |
| `top` | Height of the roofline. Courts are open wells down from it. |
| `grounds` | The box that holds the open country that can be walked, as `x0`, `x1`, `z0`, `z1`: from the house front (`z0`) to a little beyond the gap at the valley's foot. It contains the approach. Absent if the site has no more than its approach. |
| `valley` | The shape of that country: `{ z0, step, west, east, mouth }`. `west` and `east` are where the two sides of the valley lie (as `x`) at `z0`, `z0 + step`, `z0 + 2 step` and so on; the rock rises from those lines, its foot three to five metres inside them. `mouth` is the `z` of the gap by which the track leaves; what is recorded beyond it is the country outside, which is seen and not walked. Beyond either end of what is recorded, each side runs straight on. A terrace or a grotto on a side stands against that side's line where it is. `ridge`, `{ x0, x1, z }`, is the ridge the house is built into: high ground from `x0` to `x1`, from the house front at `z` northward without end, which is not valley. Where a side lies further out than the ridge north of `z`, the valley runs on past the house on that side as an arm, closing where the side comes back to the ridge; `z0` is then further north than the house front. A document without `valley` is read as a box that draws in to a gap at its south end. |
| `settlement` | What kind of settlement the valley has: `village`, `hamlet`, `manor`, or absent for none. It is decided first and the rest is placed round it. |
| `keep` | Over a village: `{ x, z, kind }`, a `tower` or a small `castle`, on the shelf of a bay in the valley's side (`valley.bay`: `{ side, z, half, depth, rise, mouth }`; the side line is drawn out round it, its floor rises `rise` over its first two-fifths and is level beyond). The keep's tower is the first of `towers`; a castle's walls stand round it. |
| `stands` | How the house stands: `hill` (built into the end of a ridge, its rooms under the hill; also when absent), `free` (standing free in the valley, walled and roofed, with the valley all round it: `valley` then has no `ridge`, and its sides go round behind the house), or `delve` (no house: the plan under the ridge as caves, `roof` `cave`, its courts caverns with a `shaft`, most ways between caves `natural` clefts; the entrance, the goal, the secret room and rooms with stairs stay built). |
| `paths` | Footpaths, each `{ points, to }`: its points from where it leaves the track to where it ends, and what it leads to (`cave`, `ruin`, `stones`, `pond`, `tower`, `keep`, `mill` or `shrine`, which is the foot of the way up to a terrace with a shrine). May be absent. |
| `track` | The way from the door down the valley, as `[x, z]` points from the door outwards. It is flagged as far as the edge of the approach and a worn track after that. The player arrives at the last point. |
| `features` | Things out in the valley; see below. |
| `streams` | Running water in the valley, if there is any; see below. May be absent. |
| `terraces` | Ground in the valley that stands above its floor and can be climbed to; see below. May be absent. |
| `grottoes` | Caves in the valley's own walls; see below. May be absent. |
| `towers` | Towers that stand by themselves in the valley; see below. May be absent. |
| `buildings` | Other buildings standing in the valley, each in one of two styles; see below. May be absent. |
| `landmarks` | Things standing on the hills beyond the valley, seen on the skyline: each `{ kind, angle, range }`, where `kind` is `castle`, `tower`, `ruin` or `monument`, `angle` is the bearing from the middle of the valley in degrees from the direction of greater x towards greater z, and `range` is `near` (the wooded hills that ring the valley, about 300 m off) or `far` (the mountains behind, about 450 m). It stands on the highest ground at that bearing in that range. May be absent. |
| `start` | The place the player starts in. |
| `entrance` | The first room of the house. |
| `goal` | The place to reach. |
| `secret` | A place hidden behind a secret door, or `-1`. |

### Places

A place is a rectangle of open floor. Walls lie outside it.

```json
{ "id": 0, "role": "passage", "name": "chapter house", "roof": "timber", "light": "torch",
  "x0": 0.5, "x1": 7.4, "z0": 14.5, "z1": 22.1, "floor": 0.51, "wall": 4.2, "axis": "z", "depth": 5 }
```

| Field | Meaning |
| --- | --- |
| `x0`, `x1`, `z0`, `z1` | The interior, west to east and north to south. |
| `floor` | Height of the floor. Floors differ from room to room, and steps in the doorways make up the difference. |
| `wall` | Height of the walls above the floor: to where a vault springs, or to a flat ceiling. |
| `roof` | `barrel` (a stone vault), `timber` (boards on beams), `sky` (open), or `cave` (not built: natural rock all round, and the open floor is an irregular hollow inside the rectangle). |
| `axis` | The direction a barrel vault runs, `x` or `z`. |
| `light` | `day`, `torch`, `dark`, or `glow` (in a cave: growths on the rock that give a faint light). A dark place has no light of its own. |
| `role` | `approach` (the meadow in front of the door), `entrance`, `passage` (an ordinary room on the way through), `court`, `reward` (a dead end worth reaching), or `goal`. |
| `name` | What the place is in the fiction: refectory, dormitory, store. Furnishing follows from it. |
| `depth` | How many places in from the entrance. |
| `fallen` | Present and `true` if the roof has come down. Such a place has `roof: "sky"`. |
| `shaft` | In a cave: a hole in the roof open to the sky, as `x`, `z` and radius `r` at its foot. It widens upwards. Such a chamber has `light: "day"`. |
| `level` | Which storey the place is on. Absent or 0 for the ground storey; 1 for a room over a ground-storey room; -1 for a cellar under one. A place on another storey has the same `x0`, `x1`, `z0`, `z1` as the place it is over or under, and is joined to it by a `stair`. Its `floor` says how high it lies. The maps show the ground storey; rooms on other storeys are listed in the key as over or under the room they belong to. |

### Ways

A way is an opening through the wall between two places.

```json
{ "a": 0, "b": 9, "side": "n", "kind": "door", "at": 4, "halfWidth": 0.85,
  "door": { "leaf": "shut", "lock": "gold" } }
```

| Field | Meaning |
| --- | --- |
| `a`, `b` | The two places. |
| `side` | Which wall of place `a` the way goes through: `n`, `s`, `e` or `w`. |
| `kind` | `door` (a person-sized arch), `arch` (a wide open bay), `window` (cannot be walked through), or `stair`. A stair does not go through a wall. It joins place `a`, the lower, to place `b` directly over it: a straight flight standing in the lower place hard against its `side` wall, rising from `at` to `to` along that wall, and coming up through a well in the floor above. `halfWidth` is half the flight's breadth. Steps rise 0.17 m each; the well has a rail on the two sides that are neither wall nor the head of the stair. |
| `at` | Where the centre of the opening is along the wall: an x coordinate for north and south walls, a z coordinate for east and west. |
| `halfWidth` | Half the width of the opening. |
| `to` | For a stair only: where along the wall its head is, as `at` is where its foot is. |
| `door` | Present if a leaf hangs in the opening. |
| `natural` | Present and `true` for a cleft between two chambers of a cave. It is not built: no arch, no door, no steps. Its floor climbs from one chamber's level to the other's, which may be two metres or more apart: the climb is made on the side of the higher chamber, cut down into that chamber's floor, and is level with the lower chamber where it reaches it. |

To find the opening on the plan, take the wall of `a` named by `side`. For `n` the wall runs from `z0 - wallThickness` to `z0` of place `a`; for `s`, from `z1` to `z1 + wallThickness`; `w` and `e` likewise in x. Along the wall, the opening runs from `at - halfWidth` to `at + halfWidth`.

The height of an opening is not in the document.

A `door` has:

| Field | Meaning |
| --- | --- |
| `leaf` | `shut` (opens when approached, unless held), `open` (standing open), `gate` (a portcullis: it can be seen through, and only its lever raises it), or `secret` (faced in stone to pass for wall; it gives way when pressed). |
| `lock` | `iron` or `gold`: needs that key. |
| `barredFrom` | A place id. The door is barred on that side and opens only from there; afterwards it stays open. |
| `lever` | For a gate: the index in `levers` of the lever that raises it. |

### Items and levers

```json
"items":  [ { "kind": "key", "key": "gold", "place": 10 } ],
"levers": [ { "place": 3, "opens": 3, "x": 17.4, "z": 29.7 } ]
```

An item says which place it is in, not where in the place. The tool puts keys on a chest or a plinth; where that stands is decided when the world is built, and is not in the document. A lever stands on the floor at `x`, `z` in its place, and `opens` is the index of the way whose gate it raises.

### Features

```json
"features": [ { "kind": "pond", "x": 41.2, "z": 88.5, "r": 9.1 }, { "kind": "stones", "x": 12.4, "z": 71.0, "r": 3.8 } ]
```

A `pond` lies in a hollow whose edge is `r` from its middle, or, if it has a `shore`, `r` times each number of `shore` in turn in an even ring of directions starting towards +x and turning towards +z (so a pond can be any rounded shape, from a pool of three metres to a lake of twenty). The water covers about the inner three quarters of the hollow. A pond of any size has a landing stage built out from the bank nearest the track; a pool has none. A lake may have an `isle`: a small island at `x`, `z`, about `r` across its top, standing a little above the water with a tree on it. `stones` is a ring of standing stones of radius `r` on a low rise, with a flat stone in the middle. A `ruin` is the broken walls of a small hut, about `1.2 r` by `r`, with its doorway on the side of the track. A valley holds two of the three, sometimes all. The tool leaves something small to be found at each. Heights are not in the document: the ground is made when the world is built.

```json
"streams": [ { "course": [[77.2, 74.6], [69.4, 75.6], [53.9, 77.3], [46.3, 73.9]], "width": 1.6, "from": "spring", "to": "pond" } ]
```

A stream follows `course`, a line of `[x, z]` points in the order the water runs, and is `width` metres broad. It begins at a `spring` under the rock of the rim, comes over the rim as a `fall`, or runs out of the `pond`, and ends in the `pond`, at a `sink` at the foot of the rim, or `out`: through the gap at the valley's foot, beside the track, and on into the country beyond, where its course goes on some fifty metres past the gap. Most water keeps to one side of the track. A stream that crosses it has a `crossing`: `x` and `z`, where, and `by`, which is `ford` for a brook (stepping stones) or `bridge` for a river. The builder cuts each stream a bed that falls all the way along it, through any rise in the ground, and sets the pond's level by the stream that feeds it, so the document need not know the heights.

```json
"terraces": [ { "side": "e", "z0": 90, "z1": 101.7, "depth": 6, "height": 4.7, "rise": "s", "run": 10.9, "way": "steps" } ],
"grottoes": [ { "side": "w", "z": 80.4, "r": 2.1 } ]
```

A terrace is a shelf of level ground against one of the valley's side walls: `side` is `w` for the wall of lesser x and `e` for the other. Its level part lies from `z0` to `z1` along the valley, stands out `depth` metres from the foot of the wall, and is `height` metres above the valley floor, with a cliff of its own below it. The way up is beyond its `rise` end (`n` is the end towards the house) and runs `run` metres along the wall, rising evenly from the valley floor; `way` says whether it is a `ledge` or `steps` cut in the rock, which are steeper and shorter. A cairn stands at the other end. With `shrine` true, a shrine stands at the lookout at its far end, with wayside crosses up the way to it; otherwise a cairn.

A grotto is a small cave in a side wall, with its mouth at the foot of the wall at `z`. A passage runs in under the hill, beyond the edge of `grounds`, to a chamber about `r` metres across the half of it. It does not join the house.

If a grotto has a `hall`, it is not a cave but a hall cut by hand, and `r` is not used. A doorway at `z` opens on a passage 2.7 metres wide that runs straight out under the hill, at right angles to the wall. Its stair begins 3.1 metres beyond the edge of `grounds` going in from the valley floor's level, and goes down `drop` metres at one in two. The hall begins 1.6 metres beyond the foot of the stair and runs on `length` metres, `width` across, centred on `z`, and `height` to the crown of its roof. Two rows of pillars 1.24 metres square stand 27 hundredths of the width either side of the middle, every 4.4 metres from 3.4 metres in, stopping 6.5 short of the end; the last 5.6 metres are a dais half a metre high with a tomb on it.

```json
"grottoes": [ { "side": "w", "z": 80.4, "r": 2.1, "hall": { "length": 26.1, "width": 12.6, "height": 9.1, "drop": 5.8 } } ]
```

If a hall has `great`, it is a great hall, and is laid out differently. The stair still goes down `drop` metres, but comes out on a ledge 6 metres deep across the near end of the hall, `great.deep` metres above its floor; `height` is from the floor to the crown. Along the hall, distances are from its near end. The side named by `great.gallery` (`n` for lesser z, `s` for greater) is a screen 0.9 metres thick standing 3.4 metres in from that wall, pierced by arched openings 2.6 metres wide every 3.65 metres, in two tiers: behind the upper, at the ledge's level, a gallery; behind the lower, at the floor, an aisle. Along the opposite wall a stair 3 metres wide goes down from the ledge at one in two. A chasm crosses the floor from the stair's wall to the screen, beginning `great.chasm.at` metres along, `width` across and `depth` deep; the last metre and a half of its width is steps that climb out of it, from the screen's end to the other. A bridge 3 metres wide crosses it on the hall's middle line. A second bridge, 2.6 metres wide, crosses the hall at the ledge's level over the middle of the chasm, from an opening of the gallery to a door in the opposite wall, behind which is a room 6.4 metres square. Pillars 2.2 metres square stand 27 hundredths of the hall's width either side of its middle line, the first pair 9.1 metres either side of the middle of the chasm and the rest every 7.3 metres from those. The last 5.6 metres are a dais with a tomb, as in any hall. A round shaft 6 metres across comes down through the roof, leaning towards `sun`, so that its light falls on the middle line 2.4 metres short of the chasm.

```json
"hall": { "length": 57.4, "width": 25.1, "height": 22.4, "drop": 5.5, "great": { "deep": 11.9, "gallery": "n", "chasm": { "at": 34.2, "width": 7.5, "depth": 10 } } }
```

```json
"towers": [ { "x": 27.1, "z": 75.2, "half": 3.1, "storeys": 3, "door": "w" } ]
```

A tower is square, centred on `x`, `z`, and `half` is half its breadth inside; its walls are 0.9 metres thick outside that. It has `storeys` storeys, from three to eight, each 3.06 metres from floor to floor (eighteen steps), and a flat roof above the last with a parapet. Its door is in the middle of the wall named by `door`, `e` for the wall of greater x and `w` for the other. The stairs are inside: the first against the wall of lesser z, rising towards greater x, the next against the opposite wall rising the other way, and so on, each a metre wide. A tower is not one of the `places` and no `way` leads into it: it is not part of the house.

```json
"buildings": [ { "style": "timber", "x": 2.9, "z": 73.2, "w": 7.5, "d": 7.1, "faces": "e", "storeys": 3, "heights": [2.9, 2.6, 2.6], "bays": 3, "colour": [0.78, 0.5, 0.44], "jetty": 0.4, "gable": true } ]
```

A building stands with the middle of its ground at `x`, `z`. `w` is its breadth along its front and `d` its depth from front to back, both outside its walls at the ground; `faces` is the way its front looks, `e` towards greater x or `w` towards lesser, so its breadth lies along z. `storeys` counts the ground storey, and the roof is above the last. `heights` gives the height of each storey from its floor to the floor above, the ground storey first. `bays` is the number of windows in a row across the front. `colour` is the wash on its walls, in linear red, green and blue. Its doors are shut: it is not one of the `places`.

Of the style `timber` (a timber-framed house): it stands on a plinth of 0.3 metres, and its storeys are 2.3 to 3.3 metres high; each upper storey stands `jetty` metres further out over the street than the one below, on the front only; the roof rises at 56 degrees with a gable to the street if `gable` is true, and at 52 degrees with its eaves to the street and dormers in it if not.

Of the style `imperial` (a stuccoed classical building): one to five storeys and three to thirteen bays, always an odd number. A plinth of 0.5 metres, a ground storey of 3.4 to 4.2, a principal storey of 3.8 to 4.8, and further storeys of about 3 each; a cornice and a low wall above it, and a hipped roof at 21 degrees. If `portico` is true the three middle bays stand 0.4 metres forward under pilasters and a pediment. The door is in the middle bay.

A timber house with `wheel`, `{ x, z, y, r }`, is a mill: its waterwheel stands in the stream beside its back wall, its middle at `x`, `z` and `y` above the ground before the door, `r` in radius, its axle square to the back wall. A timber house has `door`, where its door is in the front as a share of the front's breadth from its left end as one stands before it (0.24 or 0.76), and a `plan` in which every room and door names the `storey` it is on: on the ground a `hall` on the door's side and a room (`front`) beside it, with one door between them; on each storey above a landing (`passage`) and two chambers (`front` and `back`), each with a door from the landing. Its walls are 0.56 thick on the ground storey and 0.3 above, and the walls between rooms 0.14; the front of storey *n* is at `v` = -`jetty` × *n*. The stair is not written down: straight flights against the side wall of the hall, each from 1.76 back from the front and 2.9 long, with steps no higher than 0.22.

A classical building can be entered, by the door in its middle bay, and its `plan` gives its rooms. They follow from the rest by rule, and are written down so that whatever reads the document need not know the rule: the middle bay (or the middle three, with a portico or with seven bays or more) is the entrance and the stair; the bays either side are rooms one to three bays broad, alike on both sides; a wall along the middle of the depth divides front rooms from back; and every storey is the same.

```json
"plan": {
  "rooms": [ { "kind": "hall", "u0": -3.68, "u1": 3.68, "v0": 0.35, "v1": 4.6 }, { "kind": "front", "u0": -11.55, "u1": -4.13, "v0": 0.75, "v1": 4.6 } ],
  "doors": [ { "line": "v", "at": 4.85, "c": 0, "w": 2.2, "tall": true }, { "line": "u", "at": -3.98, "c": 2.0, "w": 1.1 } ],
  "walls": { "outer": 0.75, "spine": 0.5, "cross": 0.3 }
}
```

The plan is in the building's own measures: `u` across the front from its middle, to the right as one stands before it, and `v` back from the face of its front wall. A room is its clear floor, inside its walls, and `linings` says how far out from it each of its walls reaches (front, back, left, right): half of a wall it shares with another room, all of an outer wall within the rendered skin. Its `kind` is `hall` (the entrance hall), `stair` (the stair hall behind it), `passage` (a passage through the house with the stair at its far end), `front` or `back`. A door stands in the wall whose middle line is at `at`, which is a `u` if `line` is `u` and a `v` if it is `v`, centred at `c` along that wall and `w` wide; a `tall` one is an arch. `walls` gives the thickness of the outer walls, of the wall down the middle of the depth, and of the walls between rooms. The stair is not written down: it is always two flights and a landing in the `stair` room along its back wall, or at the far end of the `passage`, with steps no higher than 0.17.

A classical building may have `wings`: `[ { "side": 1, "width": 5.4, "length": 14 } ]`. Each reaches back from one end of the main block (`side` -1 for the left end as one stands before the front, 1 for the right), `width` of the main block's breadth from that end inward, and `length` beyond the main block's back wall. One wing makes an L, two a U. The wing's rooms are in the `plan` with `kind` `wing`; the door from the main block into a wing has `through`, the thickness of wall it goes through (all of the main block's back wall and the wing's own lining against it).

A building with `sunk` stands in rising ground: the ground at its back is `sunk` metres higher than before its door, rising along its sides, and its lowest storey has no windows where the ground stands against it. `backDoor` is where across the back wall (as a `u`) a second door opens onto that ground, at the height of the next floor up.

What stands in each bay, which timbers brace which, how the bays of a wing are shared out among rooms, the colour of doors and shutters and of the roof and of each room: these are not in the document. They are worked out by whoever builds it; the tool works them out from the site's seed.

### Islands

A site may be an island in the sea instead of a valley. Then it has `island` and no `valley`; `grounds` is the box that holds the island's coast, `stands` is always `free` (the house stands on the island's high ground), and the track runs from the door down to the end of a jetty, where the player arrives.

```json
"island": {
  "x": 13.2, "z": 90.5, "coast": [138.2, 140.1, "…96 in all"], "sea": -21.2,
  "cove": { "x": 36.4, "z": 191.3, "r": 25.9, "out": 1.344, "mouth": 11.7, "beach": 0.748 },
  "crown": { "x": -20.1, "z": 40.2, "r": 52, "height": 6.1 }, "combe": 57, "level": { "x0": -31.5, "x1": 33.1, "z0": -24.6, "z1": 36.2 },
  "jetty": { "from": [25.7, 163.4], "to": [33.8, 184.5], "width": 3.3 },
  "lighthouse": { "x": 110.8, "z": 24.1, "y": 2.1, "r": 3, "height": 17.6, "door": 2.544 },
  "castle": { "x": -53, "z": 29.8, "y": -0.4, "facing": 3.883 },
  "graveyard": { "x": 41.4, "z": 2.1, "w": 15.2, "d": 10.8 },
  "cottages": [ { "x": 22.1, "z": 140.3, "y": -12.2, "w": 7.9, "d": 5.1, "faces": 2.81, "roof": "thatch", "wash": [0.9, 0.89, 0.84] } ],
  "boats": [ { "x": 30.2, "z": 166.8, "heading": 4.4, "length": 5.1, "afloat": false } ],
  "stacks": [ { "x": 143.3, "z": 16.5, "r": 5.1, "height": 17.1 } ],
  "seaCave": { "x": 14.3, "z": 177.2, "heading": 3.31, "length": 17.5 },
  "mainland": { "bearing": 4.1, "spread": 0.9, "distance": 1380, "height": 0.62 },
  "islets": [ { "x": 640, "z": -210, "r": 31, "height": 14 } ]
}
```

Angles here are in radians, measured from the direction of +x turning towards +z. `coast` is how far the top of the cliffs lies from `x`, `z` in each of an even ring of directions, starting towards +x; between two of them the line is eased. `sea` is the level of the sea; the forecourt is at its own floor, some way above. The cove is a disc of water `r` across the half of it about its `x`, `z`, with a channel `mouth` wide leaving it at the bearing `out` for the open sea; the part of its rim facing back towards the island's middle, `beach` to either side of that bearing, is a beach, and everywhere else the coast is cliff. `crown` is a swell of high ground `height` metres over the forecourt. `combe` is how far the land comes down to the beach, as a hollow. `level` is the ground about the house, kept at the forecourt's floor. `castle.facing` is the bearing from the castle's middle away from its gate. Instead of a castle there may be a `chapel`, `{ x, z, y, facing }`, the ruin of one, its nave running towards `facing`. `mainland.height` scales the country across the water, from low green hills at 0.3 to a snowy range at 1. `graveyard` is the burial ground beside the house, `w` along z and `d` along x, levelled at the forecourt's floor.

The plain shape of the land follows from these by rule (`landAt` in `src/core/island.ts`), and what stands on it is placed on that shape; the builder then wears and carves the cliffs, which moves their edge by a stride or two. Cottages, the lighthouse and the castle stand on ground levelled at their own `y`. The lighthouse can be gone into and climbed; the cottages can be gone into, one room each; the castle is walked round and into its court. Things left to find are at the top of the lighthouse, in the castle's court and at the far end of the sea cave.

### The solution

```json
"solution": [
  { "way": 20, "to": 4, "events": [] },
  { "way": 13, "to": 10, "events": ["take the gold key"] },
  { "way": 12, "to": 9, "events": ["unlock with the gold key"] }
]
```

The shortest route from `start` to `goal` that respects every lock, bar and gate, as found by the tool's solver. Each move goes through `way` into place `to`. `events` are in plain words, for reading, and are one of: `take the <metal> key`, `unlock with the <metal> key`, `lift the bar`, `throw the lever`. Every exported site has a solution; the tool does not show a site without one.

## The model

A binary glTF 2.0 file with its textures inside it. Axes and units are the document's, so a point in the document is the same point in the model with no transform.

**Nodes.** Everything hangs from one node named `site`.

| Name | What it is |
| --- | --- |
| `p<id>_<material>` | The static stonework, woodwork and ground of one place, in one material. `p3_stone` is the stone of `places[3]`. Walls between two places belong to one or the other. |
| `door_<way>` | A door or gate, named for the index of its way. The node's origin is on the hinge line at floor level, so turning it about +y swings the door; a gate is raised by lifting it. It is exported as it stood: open if it was open. |
| `door_<way>_leaf` | The leaf: timber, or stone for a secret door. Gates have no leaf. |
| `door_<way>_fittings_<n>` | Ironwork, the lock plate and the bar, in plain coloured metal. |

**Materials.** Seven, named `stone`, `floor`, `slate`, `rock`, `wood`, `turf` and `leaf`, plus the plain metals of the door fittings. Each has a base colour map, a normal map, and one map carrying occlusion, roughness and metalness in its red, green and blue. The textures repeat. Vertex colours tint the base colour, stone by stone; a loader that ignores `COLOR_0` will show every stone the same shade.

**What is not in the model.**

- Light. The tool bakes indirect light into the vertices for its own shader; that is left out. Light the model yourself, with `sun` and `setting.hour` as a guide, and put lamps in places whose `light` is `torch`.
- Torches, keys, chests' contents, the lever and the relic. Their places are in the document.
- Collision. The stonework is a skin of separate stones in front of solid walls, not a set of closed solids, so cutting through a wall shows it hollow. Either collide with the triangles as they are, or build simple colliders from the document: a box for every wall, with gaps at the ways.

Models are large: around 50 MB and 700,000 to 900,000 triangles for a house of ten rooms, because every stone is geometry.

## The maps

All have north up. `<seed>-plan.png` is a clean plan with numbered rooms and a key. `<seed>-map.png` is the same site drawn in ink with hatching, and shows everything a referee would want: keys, the lever, the secret door and the hidden chamber. Both have a scale; neither is georeferenced, so to lay one over the model use the document.

`<seed>-battlemap.jpg` is a picture of the 3D world, not a drawing. Everything above head height is cut away indoors; courts and open ground are shown whole, in daylight. It has no labels, and the hidden chamber is blacked out as solid wall, so it can be put in front of players. The grid is 1.5 metres (five feet) to a square at 72 pixels a square, fewer if the site is too large for a 4,096-pixel image, and the image's edges fall on grid lines, so it can be dropped into a virtual tabletop and its grid matched by setting the square size alone.

## Versions

`version` goes up whenever a change would make an older reader misread a file: a field removed, renamed or given a different meaning. New optional fields do not change it, so a reader should ignore fields it does not know.

Version 1 describes a single walled house on one level. Storeys, places that are not rectangles, and sites made of several buildings will need a version 2.
