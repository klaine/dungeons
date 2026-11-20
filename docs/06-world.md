# 6. The world

A world is one stretch of country, six kilometres east and west by ten from the sea to the hills (its
size is a setting: `?size=8x8` on the world page, `SIZE=8x8` before `tools/world.ts`), in which every
kind of place is found rather than drawn, as many as the land holds up to four of each: islands in its sea, valley heads in its upland, mountain tops in its
range, and later other kinds in its low country. Its mountains stand up to 800 metres. Each
place keeps its own detailed land, made when someone goes there; the world is what lies between
them and round about them, and what is seen from them.

This document says what a world holds, how it is made, what has been measured, and the plan for
joining the places to it, with the land streamed in at a metre where it is walked.

## What was asked

The notes, as given:

- "Would it be possible to generate such terrains that the same 'world iteration' could contain areas for all locations? each separately of course then having the detailed close area"
- "so we would need to generate a 'world' height map which would contain: islands; coast; placeholder for forest / farmlands / plains?; valley; mountain tops"
- "Yes proceed! and write a plan as well. I will want also ink map of the world as a deliverable showing the spots for each and imaginary roads(?) or paths(?)"
- "would prefer orientation of having the ocean and islands in south and mountains in the north"
- "how could we have a large bay on the world map extending inland and having possibly fjord coasts also?"
- "would some kind of mesh optimization be good to have for the terrain? more triangles where there is detail and combine into larger triangles where there is little detail?"
- "could we have mesh optimization AND way smaller total world size, lets say 8km x 8 km with 4 locations of each type? 8000x8000 1 pixel per meter?"
- "maybe the overall scale would have to come down, from 1.5-2km tall mountains to 400-600m tall? ... no need to make all at once ... some kind of streaming / adaptive detail"
- "would 6x10 rectangular instead of 8x8 straight square be better?", then "ok target default 6x10 and do the 1 m streaming"

The answer given before starting: yes. Valleys and islands were already found, not drawn: each in
a frame of its own made by noise and worn (`highlands.ts`, `archipelago.ts`), drawn from a pool of
such frames. Only the mountain top was the other way round, its top drawn first and the country made
round it (`mountain.ts`); but that country is already made as a world needs to be, coarse and then
finer near the mountain. What was missing was one land holding them all.

The first world was forty-eight kilometres square, with mountains of two kilometres and twelve places
of each kind. It was brought down to eight kilometres and hills of four to six hundred metres, as
asked, so that its land can be had at a metre where it is walked (below); then made six kilometres by
ten, the long way from the sea to the hills, so that each zone has more depth (the range most, which
had been the tightest fit: 3.2 kilometres, not 2.6) and the world is a journey from the islands up to
the summits.

## What a world holds

All in `src/core/world.ts`, decided from the world's seed alone; nothing in it depends on which
place asks for it.

- **The plan** (`planWorld`): inland is north, turned up to 17 degrees either way, so the sea and its
  islands lie to the south and the hills to the north; where the coast lies (some 800 metres of open
  sea, then a shelf 1.7 to 2.3 kilometres broad); how broad the low country (0.6 to 1.8 kilometres)
  and the upland (2.4 to 3.2) are, the range taking the rest, some 3.2 (these for a world ten kilometres
  deep; for another, in proportion); and where a great bay comes in. Nothing else is planned: no peak,
  no island, no place.
- **The zones.** Going inland: open sea; a shelf; the coast; the low country; the upland; the range.
  Every point belongs to each zone in a share (`zonesAt`), the shares adding to one and blending over a
  few hundred metres where zones meet. The boundaries wander: the coast in bays and headlands a kilometre
  or two across, the foot of the upland so far that in places it comes down to the sea. The zones say
  only how fast the ground rises there and how far the sea has come up over it.
- **The land: lifted, and worn by its rivers** ("yes lets fix how the land is made"). The land is made
  as land is made: on a lattice of 24 metres (251 points by 417), the ground is lifted, at a rate each
  zone sets, and worn by the river through each point in proportion to the ground draining through it
  and the fall to the next point down (the stream power law), over some seven million years in steps of
  fifty thousand (`liftAndErode` in `terrain.ts`, solved as Braun and Willett showed, from the outlets
  upward, so that a step may be long; Cordonnier and others made land this way in 2016). The rivers end
  in the open sea beyond the shelf. Between them the slopes creep down. Each point's water goes to a
  neighbour downhill chosen afresh each step, the steeper the likelier (always the steepest, the water ran
  only along the lattice's eight ways and the ridges came out squared to them); a river wears only where
  two and a half hectares or more drain through, and above that it is hillside, which only creeps (wearing
  every point, the hillsides were cut into combs of gullies). Then every height is brought in proportion
  so that the highest three points in a thousand stand at 650 metres; and then the mountains are raised,
  the ground over 250 metres the more the higher it stands (as the cube of the square root of its height
  over that), until the highest summit stands at 800, so that the coast, the low country and the fells
  stay as they were and only the mountains rise higher over them ("should the maximum mountain height be
  scaled to around 800m for more dramatic looks?"; raising every height alike, tried, made the fells a
  quarter steeper and rockier and moved the places found).

  | Zone | How fast it rises | What comes of it |
  |---|---|---|
  | Range | 0.6 to 1.6 millimetres a year, more in some stretches, so its mountains stand in massifs | branching valleys and sharp ridges; summits 650 to 800 m, the highest at 800, the floors of its valleys 100 to 250 |
  | Upland | about 0.3, uneven | fells cut by the range's rivers and their own; tops 250 to 400 |
  | Low country | about 0.07 | gentle ground the rivers cross, 0 to 80 m |
  | Shelf | 0.03, and more in patches at two sizes, some 700 and 260 metres across | the patches rise into hills, which the sea leaves as an archipelago, islands of every size |
  | The bay | an eighth as fast as about it, and the shelf in front of its mouth not at all | low ground running far inland for the sea to come into, open to the sea |

  Then the sea comes up over it (`drownAt`): nothing inland of the coast, 35 metres over the shelf, more
  beyond it, 30 more over the bay; so the shore is where the land's own shape meets the sea: valleys
  drowned into inlets, spurs left as headlands, hills as islands. Then, on the world's lattice of 8 metres,
  detail finer than the land at 24 holds, next to nothing on level ground (on a valley's floor, more of it
  dammed the floor with sills into lakes one after another) and some metres on the steep; worn by water
  drops and frost as before. What this took the place of: zones each with a land of noise, two families of
  drawn valley lines, a bay sunk as a hollow, fjords cut down the lines, and planned peaks, islands and
  summits. The great peaks are now found: a map names the three highest summits, each the highest ground
  within a kilometre.
- **Only found places.** Every place is found in the land as the land came out; none is planned
  ("no planned locations, only found! if only two locations are found for island or other type, then
  be it"; then "if the great peaks are planned, remove them").
- **Worn** by water drops and frost on the lattice of 8 metres (751 points by 1,251), as every other land
  is (`terrain.ts`), the floor of the sea spared, and nothing built up more than six metres. Its shape
  from before the drops is kept too.
- **Water.** The sea is whatever lies below its level joined to the world's edge. Then the water is
  followed: hollows are filled to where they would spill, each point drains to its steepest neighbour
  downhill, and what drains through each point is counted (`drain`). A hollow deeper than four metres
  keeps its water as a loch; a shallower one has an outlet cut from its lowest point out through where
  it would spill, as a river cuts through a low sill (`breach`). Rivers are drawn from where forty hectares drain through a
  point, down to the sea.
- **Cover**: what lies at each point, from its height, its slope, how wet it is and its zone:
  sea, lake, shore, marsh, fields, pasture, forest, heath, rock or snow (`COVER`). Fields on gentle low
  ground; woods on slopes and in patches, thinning up the upland, whose higher ground is heath with the
  woods down in its glens; heath above the trees (the treeline wanders about 300 metres); rock where it
  is steep or high; snow lying late only on the highest summits.
- **Tiles**: a finer lattice, 5 metres (as the islands' and the valleys' own frames are), in tiles
  2.4 kilometres square on a fixed grid, a tile every two kilometres (three by five), each reaching 200
  metres over its neighbours (`worldTile`). A tile is the world's land as worn, with detail laid on finer
  than 8 metres holds (more on the steep); worn again at its own scale; and drained. Because the grid is the world's, a tile's land is the same whichever place asks.
- **Places**, looked for where their kind of land is, four hundred metres in from the world's edge at
  least; each list best first, up to four of each kept, the search stopping when it has them, and
  however few it has when the land is searched through. A place asks the land for ground a house can
  stand on and a way to it, not for a shape; and its house's ground is fitted to the land found
  (`fit.ts`, below):
  - *Islands*: every island the land made (land standing out of the sea, apart from the mainland and
    the world's edge, on the world's own lattice, so none is lost where it crosses a tile's edge) of
    six hectares or more and no more than twenty-five, whatever its shape (three was the least, until one of three or four, a hundred metres from its middle to its furthest shore, had no room for any house and a cove); on each, the house where its ground fits best,
    well in from the cliffs, a little up from the sea, facing its landing; the landing the nearest shore
    gentle enough to come ashore and walk up (rising no more than four in ten), or the gentlest if none
    is. One house to an island. (Before, an island had to be of a size, near round, with a shoulder at a
    set height, level within twelve metres; few were.) (Twenty-five hectares at most since the game
    builds on them: it builds an island whole, its cliffs all round and what grows over all of it, and
    the cost grows faster than the land; one of 55 hectares made six and a half million triangles of
    rock and took eight minutes. Of six worlds, `w2` now holds two islands, `w4` one, the rest none.)
  - *Valley heads*: in the tiles of the upland, by the valleys' own search (`findValleys`) on the
    tile's drainage, their ground fitted there; turned down if more than three metres of earth would
    have to move on average. No two within seven hundred metres.
  - *Mountain tops*: on the world's lattice, in the range: a summit with nothing higher within 300
    metres, standing alone over the cloud (nothing higher joined to it above a level forty metres under
    its top, within 1.2 kilometres), 180 metres or more over the valleys a kilometre off, with a ridge
    down from it that a way could come up (falling steadily for 450 metres along a crest, the ground
    lower on both hands); and the hospice's ground on a shoulder of that ridge, 40 to 320 metres along it
    from the summit, its front turned down the ridge, where it fits best and stands some fifty metres or
    more under the summit (the flattest ground is on the summit's own dome, a few metres under it, and a
    hospice there had hardly a summit to climb to; taken still where nothing lower will do).
  - *Coastal towns* (asked: "Include the coastal towns also"; then "That doesnt seem to be the proper
    coastal town format we developed in another session earlier"): where on the mainland's shore (the land
    joined over dry ground to the world's northern edge, so not an island's) the harbour town (`town.ts`)
    would stand, judged by the town's own search (`findTowns` in `coastland.ts`) on the world's lattice of
    eight metres, for a house of middling size: open water before the quay, a quay's line neither high nor
    drowned, low ground behind rising gently for the square and its streets, the house's ground a few metres
    over the square, country rising behind; better with a headland beside it and land on either hand, so
    that the harbour lies in a bay. Seven hundred metres in from the world's edges and nine hundred apart;
    recorded as the town's search found it (`WorldPlace.town`), `x` and `z` the middle of its quay. Named as
    harbours are. Every world tried has four. (They were first sought where a stream came down to the
    shore, and built as a valley whose foot was the shore, since the harbour town, made at the same time on
    another branch, was not yet in this one.)
- **Grounds fitted to the land** (`fit.ts`; asked: "locations need to be adaptable, best found location
  can be then slightly flattened or smoothed in places for a town or other needs if must, but terraced
  adaptations are good also"). A house's ground, 46 metres across by 62 deep, is made level where the
  land is near level, and terraced where it slopes: one, two or three level steps down its depth, each at
  the middle height of the land under it (which moves the least earth), no step higher than three metres,
  a terrace more counted as worth half a metre of earth moved. Round it the land is eased back into its
  own shape over a bank half again as broad as it is high (six metres at least), so nothing stands as a
  cliff. Each ground is made on the land in the squares at a metre (after their wear; each point's height
  a function of where it lies alone, so neighbouring squares still meet), and drawn on the ink map to
  scale, with its terraces and, on an island, the dotted way up from the landing.
- **Towns**, as placeholders for what the low country will one day hold: a harbour at a river's
  mouth, the nearer the islands the better; up to two market towns on rivers in the low country; up to
  eight villages by water on fields and pasture.
- **Ways**: roads joining the towns by the shortest set of links; tracks from the villages and the
  valley heads to the nearest way; paths up each mountain top's ridge and from its foot to the nearest
  way; ferries from the harbour to each island, round the land. Each laid over the land as a walker or
  a cart would: round a hill rather than over it, along a slope rather than up it, across a river
  where it must, onto a way already made where one goes the right way.
- **Names** (`names.ts`): the world, its sea, its bay, its upland and its range, the great peaks, every
  town, every place. Each drawn from a stream of its own keyed by what it names and where it is, to fifty
  metres, so that a place keeps its name whatever else the world finds or loses (drawn one after another,
  as they first were, every name after a place gained or lost was another).

## The ink map

`world.html` makes a world in a worker (`src/worldmap/`) and draws it (`src/maps/inkWorld.ts`), in
the hand of the place's own ink map: the coast a firm line with the sea in lines following it; the
relief in hachures, heavier where it is steeper, higher, and turned away from the light, none on the
snow; woods as little trees, fields as strips, heath and marsh by their marks; rivers and lakes; roads
as a pair of lines, tracks single, paths dotted, ferries broken lines over the water; towns as huddles
of buildings. The places of adventure are in red and listed under the map with the key. The names of
the sea, the bay, the upland and the range are lettered across them, each near its zone's middle where
it covers no mark or name. **Relief** shows the same world as shaded relief coloured by cover. A
kilometre's scale; the frame barred every half kilometre. `?world=<seed>` names the world;
`tools/browser/worldmap.cjs` saves both pictures. Over the map, each place found is listed with two
ways to it: **Build a house here** opens the game on it (`?world=<seed>&place=<kind>&n=<k>`), and **Walk
the land** the walk page there; the walk page has a **Build a house here** of its own, for the place its
menu shows; and the game, built on a world's place, has a **World map** link back.

![The ink map of a world](images/world-ink.jpg)

## Measured

Without a browser, in a cloud container with four cores (`npx tsx tools/world.ts`), November 2026,
six kilometres by ten, the land lifted and worn by its rivers: a world builds in 34 to 41 seconds: the
lifting and wearing 7 to 9, the shape on the lattice of 8 metres 1, the wear by drops and frost on it
about 10, following the water 1, the cover 0.5, and eight to ten tiles for islands and valley heads 15 to
17. In the browser (headless) the world page made and drew `w3` in 35. Five worlds (`w0` to `w4`) gave
four valley heads each and four mountain tops each (one gave two before the creep was mended), and
islands 0, 0, 0, 1 and 0: the sea now leaves hills as islands of every size, but most of them a kilometre
and more across, larger than the island's search will take (it wants 200 to 400 metres across and a
shoulder at a set height), which is the next thing (*Where next*). The squares at a metre made from this
land still meet their neighbours exactly (96 shared edges about `w0`'s places).

Then with places that fit the land (islands looked for on the world's own lattice, any shape and size;
grounds fitted): a world in 23 to 32 seconds (fewer tiles are made now); six worlds gave islands 0, 2, 3,
2, 1 and 1, valley heads four each, mountain tops 2, 4, 2, 4, 4 and 3. Of the places of three worlds
(`w1`, `w2`, `w3`), most valley heads stand on one level, moving 0.2 to 1 metre of earth on average; the
hospices on one to three terraces, moving 1 to 2.4; islands on one level, or three terraces down a slope,
moving 0.2 to 0.8, their landings 40 to 190 metres off. The squares at a metre with the grounds made on
them still meet their neighbours exactly (108 shared edges about `w2`'s places).

Before, with the land drawn (zones of noise, drawn valley lines): 20 to 28 seconds; with only found
places, valley heads four each, islands 0 to 2 and mountain tops 0 to 3.

What the time goes on, nine tenths of it: the drops of water that wear the land, a million on the
world's lattice and some quarter of a million on each tile. (Since fewer: a third as many on the world's
lattice and an eighth on a tile. A drop to every point, wearing two points wide, combed every slope of the fells
and mountains into gullies all alike, close together, and a tile combed them again, closer; asked: "the
creases / ripples in the mountains or fells look a bit too frequent and uniform". Fewer and broader, following
the ground more closely, they gather into fewer gullies of different sizes, and a tile only softens what the
world wore; and nothing is built up more than a metre, where a drop running up the far side of a valley's floor
had put down all it carried in a line along it. And then: "the gullies can be deep, but I'd prefer not so
frequent", and "I would also prefer the landscape mountains to be a bit more rugged and sharp than round fell
style". Lifted and worn by its rivers alone, the high ground comes out in round ridges like worms, all alike;
the rivers' valleys made closer, or the creep less, only folded the mountains into an even maze, and sharpening
the land as it was did little. So the high ground is given crests of its own as it is shaped (`crestsAt`):
ridged noise at two sizes, 380 and 150 metres, a hundred and thirty-five metres at the most, nothing below 120
metres and all of it from some 470 up; sharp crests and spurs at no even spacing, as harder and softer rock
would leave them, into which the drops wear fewer gullies. Every world's places moved with the land: `w0`, `w1`
and `w2` still have four valley heads, three or four mountain tops and four coastal towns each, and `w2` three
islands.) What could be done about it: keep a world
once made (in the browser's storage), so only the first visit pays; wear the tiles side by side, a
worker to a core, since each is made alone; fewer drops; or the drops run on the graphics card.

**Land at a metre** (measured on 512-metre squares of a world, about a valley head, an island and a
mountain top, before the world was made smaller): shaping one takes about half a second and wearing it
two, so some two and a half seconds a square. Eight kilometres at a metre is 64 million points, about
250 such squares: ten minutes on one core and 256 megabytes of heights alone; which is why it is to be
streamed and not made at once.

**Meshing land at a metre by its detail** (a hierarchy of right triangles, as Mapbox's Martini makes
them, split only where the ground departs from a triangle by more than a tolerance), against the 524,000
triangles of the full grid on each square:

| Tolerance | Valley | Island | Mountain |
|---|---|---|---|
| 2 cm | 72% | 70% | 89% |
| 5 cm | 54% | 51% | 78% |
| 10 cm | 40% | 35% | 64% |
| 25 cm | 24% | 17% | 39% |

Where the land really has detail at a metre, a mesh true to it saves less than one might hope; the
saving comes from distance, the tolerance growing as the ground lies further off.

What it took to make the land drain, for whoever changes it next: the range made of ridged noise's
crests alone filled its hollows as lakes, 29% of the first world. Valleys made as networks of ridged
noise turned over had floors that rose and fell along their length. Valleys made where smooth noise
crosses its middle had level floors but closed in rings round hills. The great valleys and the straths
are now level lines of the distance along the coast, pushed about by noise too gently to close, in two
families turned apart so that they cross and join; and every lesser network fades out on the floor of
the greater. A count of one world's hollows deeper than 160 metres went from 94 to 3. `breach` cuts
what is left.

## The plan, in steps

Each step is a slice that can be judged on its own. Nothing a site already makes changes until a
world is asked for: a world is a mode, `?world=<seed>`, beside the seeds already seen.

1. **The world, and its map.** *Done*: everything above. The game reads it since step 3.
2. **Land streamed in at a metre, meshed by its detail.** *Done as a test, on a page of its own*
   (below, *The land at a metre*); the game does not use it yet. As planned: the world's land to a metre, made where it
   is wanted and not before: squares of 256 or 512 metres on a fixed grid (so a square is the same
   whoever asks), each made from the 5-metre tile under it as that is made from the world (its fine
   shape, with what the coarser wear did laid on it, worn again at its own scale), drained, and kept
   once made (in the browser's storage, as heights to a centimetre or so). Each square meshed by its
   detail, its tolerance by how far it lies from the player (a couple of centimetres near, a quarter of a
   metre a hundred metres off, more beyond), and meshed again as the player moves; neighbours at
   different tolerances closed by skirts hanging from their edges, or by sharing their edges' points.
   Squares made in workers, a core each, so the page never waits on one. What is planted, the track
   and the wet and bare ground are read from the same squares, so they agree with the mesh. Checks:
   frame time and triangles as the player walks, against the valley's sheet of 1.2 metres; the seams
   seen close; the time a square takes in a worker.
3. **Valleys and islands built from the world.** With `?world=<seed>&place=island&n=3` (or `valley`),
   the site is made on the third island (valley head) of that world, its house still from its own seed,
   its land the streamed squares instead of a pooled frame and its own lattices; the island's sea at
   the world's level. Checks: `tools/island.ts` and `tools/land.ts` with a world, the browser scripts.
   *Done, from the world's tiles of 5 metres rather than the squares at a metre* (below, *Places built in
   the world*).
4. **Mountain tops fitted to the world's summits.** The mountain top's rim, ridge and summits laid on
   the summit found, turned to its ridge, at this country's scale (its cloud forty to sixty metres under
   the top, the valleys three hundred metres under that, not seven hundred); its country the world's.
   *Done, the near way* (below, *Places built in the world*): the top as the game draws it, laid on the
   world's summit, its country the world's. *Then the land's way* (19 November 2026): the top's land the world's,
   the house's ground fitted into it, the ridge and the climb laid on what is there (*Places built in the world*).
5. **One far land, from the world.** From a place, the rest of the world and the land beyond its edge
   (the shape continued, unworn), in place of the three kinds of far sheet each place has now.
6. **The map leads to the places**, and **more kinds of place** where the world has room (the low
   country, the coast). *Done, the map's links and coastal towns* (above).

## The land at a metre

`src/core/stream.ts` makes the land a square at a time: 256 metres on a side, 257 points a side at a
metre, on a fixed grid from the world's north-west corner. A square is the world's tiles of 5 metres
under it, each weighed by how far inside its own lattice the point lies, so that across the strip
where two tiles overlap (each worn alone, and differing there) the land passes from one to the other;
then detail finer than the tiles hold (`detailAt`: knolls and hollows tens of metres across, a metre
or two high where the ground is rough, less where it is gentle, and small unevenness on that); then a
light wear by water and frost at a metre, made over the square and a strip of 24 metres about it, and
faded out over the last 20 metres towards the square's edge. So along its edge a square is the plain
function of the tiles and the detail, which its neighbour shares, and the two meet exactly. Then how
far each point may be left out of a mesh (`errorsOf`: the square cut into right triangles, each split
at the middle of its long side, down to a metre, as Mapbox's Martini makes them).

`src/render/streamMesh.ts` meshes a square true to within a given distance (`meshTriangles`), with
normals from the ground at a metre whatever the mesh keeps, and a skirt six metres deep hanging from
its edge, which fills the slit where a neighbour meshed to another distance keeps other points along
the same edge.

`walk.html` (`src/worldwalk/`) is the page to try it on, not the game: the world made in a worker,
which then makes its tiles as they are asked for; squares made in a few more workers, a core each,
nearest first, within 700 metres of where one stands (`?radius=`); each meshed to a distance chosen
by how far off it lies (2 centimetres within a dozen metres, 5 within thirty, 10, 20, 40, 80 and 160
centimetres at 60, 125, 250, 500 and a thousand), and meshed again, a few a frame, as one moves;
squares let go of beyond a kilometre; beyond them the world's lattice of 8 metres, read every 32, in
blocks of a kilometre with holes where squares are, a metre low. One walks on the squares' heights
(or flies, `V`, rising with Space and sinking with `C`); two menus choose the world (`#w3` after the
address does too) and the place to go to, `P` goes on to the next place, `1` to `4` to the valley heads
and with Shift to the islands; `M` shows the triangles. By touch (`touch.ts`, after the game's own): a
thumb stick wherever the left of the screen is touched, pushed well past its rim to run; looking about by
dragging on the right; buttons to fly, to rise and sink while flying, and to go on to the next place.
`tools/stream.ts` makes squares about each place without a browser and checks that neighbours meet;
`tools/browser/walk.cjs` walks the page to places and keeps pictures.

**Drawn as the game draws** ("2 first": the game's ground, grass and trees on the walk page, to judge the
land as it will look before anything is built on it; `src/worldwalk/dress.ts`). The game's own textures
and materials, made as `main.ts` makes them: each square meshed as the game's turf and rock (a triangle
to rock where it is steep, as the valley's sheet is laid, `squareBuilders`), with the colours and the four
fields the ground material reads, from what the world says lies at each point: pasture the valley's turf;
hay fields paler and yellower; heath brown, the purple of heather in it; marsh wet; the floor of a wood
under litter; the shore bare sand and shingle; bare earth and stones where it grows steep. The far land the
same, laid every 32 metres. Lit by the sky as the game lights what it does not bake, the sun with shadows
over 160 metres about the walker, the game's sky, its air (`Atmosphere`, with haze thinner than a valley's,
since here the eye sees ten kilometres) and its pipeline, the eye adjusting to the picture. What grows:
grass, flowers, ferns and reeds grown about the walker out to 90 metres, in blocks of 32 (as the lab's meadow
is grown: thick in pasture, tall and pale in hay, short and brown or purple on heath, sparse in woods, none
on rock, shingle or water; flowers by kind in drifts of their own that overlap, grass in seed where it stands
long, and bracken in stands on the dry banks of the pasture and the heath, as the game's meadows have them); trees
where the world has woods (`treesIn`: one to a cell of seven metres, close in a wood's heart, with now and then
a second in the cell, and thinning tree by tree towards its edge, from some 200 a hectare in the heart to 70 in
its last ten metres; past the edge single trees in the pasture and on the heath, some 40 a hectare in the first
ten metres out and fewer further, and a few anywhere in the open; how far inside a wood a point lies worked out
once for the whole world from its cover, `woodDepth`; the trees at an edge a little shorter; oak and ash low
down, spruce and pine higher, pine alone near the treeline; the same trees whoever asks), with bramble, bushes
and young trees in a belt along every wood's edge near by. Trees are drawn three ways: whole as the valley's are,
grown more simply (a trunk and its main limbs, with a sixth as many leaf sprays, each larger; asked: "the trees
change too near to very low detail fillers ... there needs to be something between"), and as single painted
cards out to 1.8 kilometres, as the valley's far hillsides have them. Each tree gives way from whole to simple
at a distance of its own between 110 and 150 metres, and from simple to painted between 300 and 360 (`treeLevels`
in `vegetation.ts`), its cards shrinking to nothing where they stand over four metres either way as the next
way's grow from nothing in the same place, and its wood changing once at the middle; every way of a tree reads
the tree's own foot and number (`aTree`, given to its cards and to every point of its wood), so the two ways of
a tree always add up to one tree. Each way's blocks are grown a little past where it is seen, both ways standing
in a block within a band, and the painted cards are made once a square, for every tree in it. The shader is told
which blocks are grown each way (`treeGrownMap`, a texture of the world in blocks of 32 metres): a tree whose
nearer way is not grown yet is drawn the next way out until it is, so that nothing is missing at the start, after
going somewhere at once, or flying fast (in the first try without it, a wood seen from above was bare ground past
the whole trees until its simpler blocks came in), and a block just grown comes in over some 0.6 seconds. (A block of 32
metres used to stand whole or simply, never both, changing whole at once at 120 and 320 metres, a block a frame,
and the painted squares were painted again whenever one of their blocks changed: asked, "the pop in of more
detailed trees is too evident!") `?hour=`, `?season=`, `?haze=`, `?tex=`.
Not yet: water but the sea (lakes and rivers are not drawn), snow, roads on the ground but the route page's
way, the places' houses; nor the game's far material (`makeFarMaterial`), which paints its own woods from the lie
of the land rather than the world's, so the far land here is the near ground's material laid every 32 metres.

**At half a metre** (asked: "add touch controls and maybe a toggle to build with higher 0.5m
resolution?"). The page's box **Half-metre ground** (`?fine`, `?fine=0`; the browser remembers it) splits
each square within 150 metres of the walker into four of 128 metres at half a metre, and lets them go
again beyond 230 (`refineSquare` in `stream.ts`, made in the same workers). The land at a metre has no
detail finer than a metre (the valley tried at 0.8 metres looked as it did at 1.2), so made again at half
a metre it would look the same: the half metre brings its own. A square's heights are drawn out between
its points (Catmull-Rom, each way in turn, reading only points of the square, so along an edge only the
edge); tussocks and stones are laid on (`fineAt`: bumps some two metres across and up to a hand high,
thicker in some patches than others, a function of where a point lies alone); and rills are worn at half
a metre, cutting 35 centimetres at most and filling 20, faded out over the last 12 metres towards the
square's edge. None of it is laid on the houses' grounds (`groundsOpen` in `fit.ts`: none on a ground, all
of it six metres beyond), which are in the square already; laying the grounds a second time moved their
banks by up to 73 centimetres. So finer squares meet each other exactly, and meet a square at a metre to
within the tussocks, which the skirts hide. A split square is drawn only once all four quarters are meshed
(each to its own distance, `squareBuilders` with the spacing given), and the square at a metre is drawn
again before they are let go of, so no hole shows between. Grass and trees wait for the ground they stand
on to be what it will be drawn as, and are grown again when the box is changed.

*Measured*, November 2026, in the cloud container of four cores, on `w2`:

- A square takes 0.32 to 0.41 seconds to make (without a browser; 0.37 to 0.40 in a worker of the
  page). 147 edges shared between neighbouring squares about the twelve places differed by nothing.
- Split into four at half a metre (`tools/stream.ts`, the nine squares about the first place, an
  island): 0.85 to 0.98 seconds a square. The 60 edges the quarters share differed by nothing. From the
  squares at a metre they were made from, at the points both have: 16 centimetres at most along the
  squares' outer edges (the tussocks); inside, 3.7 centimetres on the whole and 40 at most (a rill). Of a
  quarter's full lattice (131,072 triangles over a quarter of the ground), a mesh true to 2 centimetres
  keeps 58%; to 5, 30%; 10, 11%; 20, 3%.
- Of the 131,072 triangles of a square's full lattice, a mesh true to 2 centimetres keeps 84%; to 5,
  68%; 10, 53%; 20, 36%; 40, 19%; 80, 6%; 160, 1%. (More than measured before the detail was laid on:
  the ground at a metre now has a metre's worth of detail in it.)
- In the page (Chromium, headless, drawing in software), the world ready in 22 seconds; then about a
  valley head 33 squares made and meshed in 7 seconds, holding 495,000 triangles, of which 297,000
  were drawn in the view; about an island 33 squares in 8 seconds, 444,000 (360,000 drawn); about a
  mountain top 38 in 13 seconds, 658,000 (441,000 drawn). (A valley's walked ground in the game is
  some 500,000 triangles of turf and scree at 1.2 metres, over a smaller area.) No frame has been timed
  on a graphics card: software drawing says nothing of it. `REAL_GPU=1 node tools/browser/walk.cjs
  <folder> w2 valley1` does it on a machine with one.

Not done: keeping squares once made (the browser's storage); the land beyond the squares is the world's
lattice of 8 metres, which can lie some metres off the tiles' land where they meet, a step the skirts
may not hide far off.

## Places built in the world

Asked: "make the locations adapt and the game work with this kind of world creation". The game builds
its places on a world's when asked (`?world=w2&n=2`, with `place=island` for an island): the world made
in a worker (the walk page's, `worldWorker.ts`) while the surfaces are painted, then the world's tiles of
5 metres about the place, each a second or two (`src/app/worldPlace.ts`); then the site, as it is built
anywhere, on that land. A world once made, and its tiles, are kept in the browser (`worldStore.ts`, the last
three worlds), so that going on to another place of the same world does not make it again; they are kept
under the name of the program's own module, which in a build carries a hash of its code, so a world made by
code since changed is never read back (in development nothing is kept).

The seam was already there: a found valley read its land from an upland made by noise, a found island
from a sea of islands, each through a frame (`terrain`: a point of the land under the house, a turn, the
land's height there). A world is a third such land (`src/core/worldLand.ts`): its tiles where they are
made, each weighed by how far inside its own lattice a point lies, as the squares at a metre weigh them;
the world's lattice of 8 metres for the share of a tile not made, so that it passes from one to the other
without a seam; and beyond the world's edge the world in a mirror laid along it, but the open sea beyond its southern edge. The frame's point and
turn are the world's own coordinates and the place's turn as the world found it (a valley head turned to
run south from the house; an island's house turned to face its landing), and the land is at its own
height: an upland's glens were three tenths of theirs, since its hills stood two hundred metres sheer, but
a world's are its own, and the rest of the world must meet them. A world valley's hills are the world's out
to the far land's last ring, three kilometres off; an island's land across the water is the rest of the
world, its mainland and its other islands.

What the places had to give. An island's coast was read where the land stands three to sixteen metres
over the sea, its core nine metres up: written for islands whose house stands twenty to thirty metres over
the sea. A world's islands are lower (the first of `w2` puts its house eight metres up), and nothing on it
stood high enough to be read as land. The heights are now in proportion to how high the house's ground
stands, against twenty-four metres (`cliffScale` in `island.ts`): a low island has a low coast of rock a
metre to five high, which is what low islands have. A house is still the site's own seed's, so its size is
not the world's; a draft that will not go on the place (its cove will not fit, say) gives way to the next
best draft of the same seed, and if none will, the place says why rather than quietly being made elsewhere.

A mountain top (`place=mountain`) is now the world's land, as the islands and the valley heads are. Until
19 November 2026 the game drew its top whole, an oval plateau with precipices round it, a drawn ridge and a
drawn summit horn, stretched from the house to the world's summit and set down on the world wherever it stood the
higher: a platform out of all proportion to the house, and a seam all round it ("the platform where the 'house' is,
is way too large"; "i want this location to seamlessly fade/blend into the 'real world'"). Now its land is the world's
(`worldTop` in `mountain.ts`): the house's level ground cut and made up to the forecourt's floor where the world found
ground for the hospice, and eased back into the land over a bank half again as broad as it is high, as `fit.ts` eases
a fitted ground; and the summit, its ridges and its flanks as the world has them, with a little finer detail and a
light wearing on the top's own lattice. What the layout leans on is read from that land rather than drawn: the rim is
where the ground reached from the top's middle falls more than ten metres under the forecourt, within a band some
sixty-five metres either side of the line from the house up to the summit; the drops are how far the land falls in the
thirty metres past it; the ridge the way comes up is the way of least effort over the land (`worldDescent`) from the
head of the top to the first ground fifty-five to seventy-five metres under the forecourt and a hundred and sixty metres
off, climbing and steep descents and gullies made dear, so that it keeps to a crest where there is one; and the cloud
lies over where it arrives, some thirty to forty metres under the house. (The ridge the world found, from the summit
through the hospice's ground, seldom falls far below the house: followed, it went into a saddle and up the next
mountain.) The climb to the summit keeps to the land it rises over: of the routes tried, the one whose even grade lies
nearest the land. Left out, as drawn things on land that is not drawn: the cleft across the ridge with its bridge, the
lesser drawn summits, and the needles. The rock is carved only where the land is steep, on the top and its ridge and
twenty-four metres off them; further off it is laid as a sheet. Beyond, the country round about is the world's, read from its
tiles and its lattice directly (read through a lattice of twenty-four metres, as the drawn country is, the nearest
mountains were blurred and rounded); and where the near ground ends, over a band of fifty metres inside its edge, it
breaks up into the far land in patches a couple of metres across, the far land laid under it there (`nearFarCut` in
`siteMaterial.ts`), so that no straight edge shows. No far range is drawn, since the world has its own, and its sea is
the water.

A coastal town (`?world=w2&place=town&n=2`; `place=coast`, as the first links said, is the same) is the
harbour town (`town.ts`), laid on the world's land instead of a coast country of its own: the house on its
terrace at the head of the market square, the harbour with its quay, moles and light, where the player
arrives, the streets and blocks, shacks and storehouses, fields, woods and the outlook, all as a town is
anywhere. Its tiles of five metres are made about the world's spot, and the town's search is run again on
them, within three hundred metres of it, for this house's own square and ground; the best spot there nearest
the world's is taken, or failing any, the world's own (`inWorldSpot` in `town.ts`). Its land is the world's
(`frameAt`: the world's sea is at nought, as the coast country's is), made fine and worn again by the town as
its own country is, and the country seen from it is the world's. Four houses built on `w2`'s four coastal
towns without a browser (`WORLD=w2 npx tsx tools/town.ts 4`) were sound, each laid out in 9 to 18 seconds and
built in 20 to 34, with 44 to 150 timber-framed houses, 4 to 28 classical, and their quays 20 to 230 metres
from the world's spots.

**Worlds by default, places built beforehand, and the world's map in the game.** Asked: "'Worlds' should be now the default
mode"; "Can we show built locations footprint on the ink map also during game? when player is in a location"; and "on the entry
page also add a button that enables the player to prebuild all the found locations for the world. Then switching between them
should be quicker and the ink map could show all the footprints". The game now builds on a world's place unless `?world=none`
asks for a place of its own; with no world named, `w2`'s. In a world each place's house is its own (`placeSeed`: the world's seed
and the place's kind and number), unless a `seed` is given, so that the same place is the same house wherever it is gone to from;
**New place** goes on to the world's next place, of the same kind and then of the next, and the button for another kind passes
over kinds the world has none of. A place's footprint (`footprintOf` in `maps/footprint.ts`) is what was built there, laid where
the place lies in the world by its frame (`siteFrame` in `worldLand.ts`: the forecourt's middle for a valley, the level ground's
for an island or a mountain top, the quay's for a town, over the world's point, turned): the ground it takes (a valley's sides
from the house to the gap, an island's coast, a mountain top's rim; a town's is its streets and buildings), its ways (track and paths, a town's streets,
quay and moles) and what stands on it (the house's rooms on the ground, buildings, storehouses, shacks, cottages). In the game `M`
enlarges the plan and then shows the world's ink map about the place (`WorldView` in `app/worldView.ts`; a kilometre and four fifths
across at the least, kept within the world's edges): the place's footprint, the footprints of the world's other places built beforehand, and the player, an arrow
the way they face; it zooms, by the wheel or `+` and `-`, out to the whole world and back; another place clicked on it (near its mark, or inside its footprint if it was built) is gone to, its house its own, and on the world page a place clicked on the ink map, or **Go there** on its card, opens the game on it (asked: "how do jump into any of the locations after the build all is completed? and how do i return to the world map page from ingame to choose another location?"; **World map** in the game's row of buttons opens the world page); the map is drawn the first time it is shown, which holds the page a moment. The world page's **Build every
place** runs `placesWorker.ts`: the world made again as the game's worker makes it, then every place laid out as the game would,
its tiles of five metres with it, all handed to the page and kept in the browser (`worldStore.ts`), each place's footprint drawn
on the map as it comes and its card marked; the game, going to a place whose house was built so, takes its layout from the browser
and neither makes the world nor its tiles nor lays it out again. The browser's store is kept under the address of that worker,
whose name in a build carries a hash of its code, the world's and the generator's, so the game and the world page keep in one
place and nothing made by older code is read back. The world's data handed over and kept now carries what its ink map needs
(`WorldData` in `worldmap/worldData.ts`), which the game draws too.

**The world's lakes about a place.** A world records each lake as a body of water: a point in it, the level
of its surface, and its shore as a ring of points where rays from that point first leave it (`World.lakes`).
About a place built in the world they are drawn out to three kilometres, at their own levels, in the place's
own frame, as still water that does not mirror (a mirror is a second drawing of the scene, and a lake a
kilometre off is not worth one): the water shows only where the land lies under it, so each fills its own
hollow. `w2`'s places have six to twenty-one each, its islands none. A town's frame lays the middle of its quay
on the world's point, and its lakes are laid by that (asked: "ok implement the lakes as well"): `w2`'s four coastal
towns have six to eighteen each within three kilometres. Within the tiles' reach, a kilometre and a half or so
about a place, the lakes had been under the land: a tile is the world's land worn again at five metres, and its
drops laid down what they carried in the still water, filling every lake some ten metres over its surface. A
tile's wear now spares the world's lakes, and less and less for twenty metres or so past their shores, so that a
shore is worn land (`worldTile`); putting the beds back after the wear instead left them in pits with banks ten
metres high, on the world's eight-metre squares. The tile's streams are worked out over the lakes' surfaces. Every
lake about `w2`'s fourth town now lies three to four metres deep at its point, its shores sloping one in five to
one in three, two in five at the steepest. Since the drops wander differently over the whole tile when any of it
is spared, the valley heads, which are looked for on the tiles, came out other than they were: of `w2`'s four,
only Strath Normere is still one, now the first, with Glen Valvie, Glen Selmere and Rosdendale; all four built
sound without a browser. Its rivers are not drawn: the largest are a few metres across, and from a place the land about
it is read at five and eight metres.

Measured, November 2026, in the cloud container of four cores: the four valley heads of `w2` each built
(`WORLD=w2 npx tsx tools/land.ts 4`) with nothing wrong, laid out in 0.1 to 6 seconds (the tiles about it
made first) and built in 18 to 23, with 730,000 to 950,000 triangles of rock; its first island laid out in
8 and built in 38, 513,000 of rock; its second found room for a cove on the third draft of its house. In the
browser, drawing in software, the game built the house at the first valley head of `w2` from the world in some ten minutes, of
which the world was about one. Its four mountain tops built without fault, laid out in 13 to 23 seconds
and built in 63 to 102, with 2.5 to 3.8 million triangles of rock, the summits 50 to 60 metres over the
forecourts, and 19 on the one whose only ground for a hospice is on its summit's dome (the same seed's top
drawn alone has 3.7 million and takes 94). In the browser, drawing in software, houses at three world valley
heads, on a world island and on two world summits were played through to the end (`WORLD=w2 node
tools/browser/play.cjs`, with `PLACE=island` or `mountain`). In a second world, `w4`, its four valley heads,
its one island and its first two summits built without fault too (valleys 29 to 37 seconds and 0.7 to 1
million triangles of rock; the island 85 and 1 million; the summits 83 and 100, and 2.7 and 3.7 million). Not yet: the squares
at a metre under a place (the
site reads the tiles at 5 metres, as it read its upland at 5, and lays its own detail); a world's lakes and
rivers in its places.

## A way between places

Asked: "if we were to build traversable roads between the destinations (like sailable way from an island to nearest town and from a
town to nearest valley and from there to the nearest mountain location), lets say 200-400m wide path following playable areas, how long
would the routes be in km?", "These would be mostly just traversal where the next area can be built and loaded while travelling
there?"; then "I think town-to-town routes would be realistic also to have", "so nothing should be totally unlinked; valley to valley
would be ok"; then "lets try this with one traversable path from a town to a valley? find a shorter such a route and deploy it as a
page accessible in a ./lab/ folder path", and "inkmap for the area covering the route and a bit of the surroundings of the locations
in one map".

**How long the ways are.** Measured on six worlds (`w0` to `w5`) with the world's own way of laying a track (`leastPath` on its lattice
of 16 metres, the cost of a step rising with the square of its slope, a bridge counted as ninety metres more, water not crossed;
ferries over water only). From an island's landing to the nearest town's quay by sea, 0.6 to 1.8 kilometres (only `w2` and `w4` have
islands); from a town to the valley head nearest it by way, 0.7 to 6.9, some 2.7 in the middle; from a valley head's mouth to the
foot of the nearest mountain top's ridge, 3.6 to 8.1, some 5.6 in the middle, climbing 390 to 920 metres, with 450 metres more up the
ridge. Over land a way is 1 to 3 times as long as the line between its ends, the mountains' the most. A network joining every place
(roads between the towns, the shortest set of links; each valley head and mountain top joined to whatever of it is cheapest to reach,
which is another valley's way for one or two valley heads in each world and another mountain's for most mountain tops; each island by
sea to its nearest town) left nothing unjoined in any of the six: 22 to 28 kilometres over land and up to 3.6 by sea, a corridor of 300
metres about it some 6 to 8 square kilometres, a sixth of the world's land, some 200 to 240 squares of 256 metres. Along it, the average
journey between two places is 6.6 to 8.2 kilometres and the longest 13 to 18. Towns on either side of the bay are 6 to 11 kilometres
apart by road and 2 to 4 by sea; towns on the same shore 1 to 3. The nearest place to any place along the network is 0.6 to 3
kilometres off for a town (1.5 in the middle), 1 to 4 for a valley head (2), 1.1 to 5.4 for a mountain top (2.5): so the next place is
always several minutes off on foot, longer than the half minute to a minute and a half a place takes to lay out and build, but often
close enough to be seen from the last.

**The way, as built** (`src/core/route.ts`, `src/core/way.ts`). `townValleyRoutes` lays, for each coastal town, the way from its quay
to every valley head's house and keeps the shortest; `layRoute` lays one between any two places, as the world's tracks are laid, its
line smoothed and its points set four metres apart. `wayOf` grades its bed on the land the squares at a metre are made from (the
world's tiles of 5 metres, blended where they overlap), drawn out smooth along the way over some thirty metres either side, the land's
own height at its ends, where it comes onto the places' grounds. `withWay` makes the bed in the land: level across for 2.4 metres either
side of its middle and a shoulder of 0.6, then a bank out to the land as it was, half again as broad as it is high, from two metres to
sixteen. It is a function of where a point lies and of the land there alone, so that every square it passes through makes it alike,
and squares still meet exactly; it is laid after a square's wear and before the houses' grounds, which a way comes onto as they lie.
Each point of the bed and four metres either side is kept in the square's mesh to half a metre (`keep` in `errorsOf`), so that it is
kept in every mesh within some 250 metres: the ground's material reads the track from a number that changes by a metre to the metre
across it (how far to one side of the middle, plus a hundred, as a valley's track has it), and a triangle broader than the track would
smear that number over the grass. The page fills that number in and keeps grass off the bed and trees four metres back from it.

**The route page** (`lab/route.html`, published with the tool; the walk page's program with its body marked `data-walk="route"`,
`src/worldwalk/routeMode.ts`). The world `w0` unless another is chosen, and in it the shortest town's way to a valley head, or any
town's (the menu, or `?from=coast2&to=valley2`). The walker is set down on the town's quay facing along the way, and held within a
corridor about it (`?broad=`, 300 metres); squares are made only within reach of the corridor and as far again beyond its edge
(`?beyond=`, 200 metres), the world's own lattice further off. A panel says how far has been walked and how far is left, a small map
shows the way, the corridor and the walker, and on coming to the valley head the link into it lights. **Map** (or `M`) opens an ink
map of the stretch of country the way crosses, the world's own ink map (`drawInkWorld` with an `area`, at the scale that fills the
sheet with it: its hachures, woods, fields, heath, rivers and the world's other ways) of the way and its two places with 450 metres
about them, the way in red, the walker on it, and both places' streets, buildings and grounds as they are laid out. While one walks,
once the squares about the start are in, both places are laid out for the game in a worker of their own (`placesWorker.ts`, asked only
for those two, the valley head first), and kept in the browser with the world and its tiles, as the world page's *Build every place*
keeps them; **Enter** at either end opens the game on that place, which then neither makes the world nor lays the place out, but
builds what was laid out (in a build only: in development nothing is kept, and the places are laid out only for the map).

*Measured* (`npx tsx tools/route.ts w0`, without a browser, in the cloud container of four cores): every town's way to its nearest
valley head laid in 0.7 seconds for the four towns of `w0`; the shortest, from Halhaven to Strath Norith, 0.93 kilometres as against
0.88 as the crow flies, rising 47 metres, at its steepest 8.7% over twenty metres; graded in 2 seconds (most of it making two tiles).
The 17 squares a corridor of 300 metres touches meet exactly along their 25 shared edges; on the bed the land is the bed's height to the
millimetre; the bed is cut 1.1 metres into the land at most and built 1.1 metres over it; a square takes 612 milliseconds in the middle
with the way through it and 588 without; keeping the bed's points in the mesh adds some 7% of triangles at 20 centimetres, 26% at 40,
and almost nothing nearer, where the mesh keeps them anyway. In the browser (Chromium, headless, drawing in software, so slowly that
grass and trees come in at seconds a block, so that its frames say nothing of a real one) the page made the world and laid the way in
73 to 78 seconds; the 18 squares within 700 metres of the start (of the 26 within reach of the corridor) were made and meshed in a
minute or two more; from the quay the way showed as a cart track, ruts and bare earth, grass along its verges and none on its bed;
put four hundred metres off the way, the walker was held at the corridor's edge, 150 metres from its middle; and both places were laid
out ahead and kept in 195 seconds, while the page was drawing. Not yet tried on a graphics card.

*Not yet:* the places themselves are not drawn on the page, only their grounds in the land, and they are built only on entering them;
nothing marks the corridor's edge on the ground (the panel and the small map say where it is); the half-metre ground is off on this page,
since its tussocks and rills would be laid on the bed too; a way crosses a river where it must without a bridge drawn, and goes round
lakes; and only a way from a town to a valley head is laid for walking, though `layRoute` lays one between any two places over land.

## The world as the game

Asked: "so adapt the game engine to this, as this would eventually become the game (instead of current single locations)". The
game builds one place at a time, whole (`src/app/main.ts`: a site laid out, meshed, its light baked, walked by the body in its one
mesh), and goes from one to another by loading a page. The world as the game is the walk over the world's land streamed in at a metre
(`src/worldwalk/`), with the places built into it as one comes to them, and the game's rules in each. It is made in steps, each of which
leaves both the game and the walk working:

1. **The game's body in the world.** *Done:* the walk and route pages move the game's own body (`Player`: its pace, 3.2 metres a second
   and 6.5 running, its weight, the steps it climbs, its jump, `V` to fly), not a camera slid over the ground. What it walks on and is
   stopped by is a set of meshes asked in turn (`Colliders`, which a site's one mesh is too), here `WorldColliders`
   (`src/worldwalk/body.ts`): a patch of ground 64 metres across at a metre about the body, from the land as it is drawn, made again when
   the body has gone a quarter of the way to its edge or land under it has come in finer; and the trunks of the trees on it, each a
   six-sided post (bushes and young trees stop nobody, as in the game). The page keeps the body in the world, in the way's corridor on
   the route page, out of the sea (which stops one at the depth of a knee), and never under the ground. Touch drives the same body.
   *Checked* without a browser (`npx tsx tools/body.ts w0`): the body ran the whole way from Halhaven to Strath Norith, 0.93 kilometres,
   in 141 seconds against 143 at its running pace, never stopped; then straight through a wood 160 metres deep and back, coming no nearer
   a trunk's bark than its own breadth; never more than 6 centimetres under the ground or 14 over it; a patch takes some 5 milliseconds
   (43 at most).
2. **Places built into the world.** *Done, for every kind* (`src/worldwalk/places.ts`, `src/render/placePack.ts`): within 1.5
   kilometres of a valley head, a harbour town, an island or a mountain top the walk and route pages have it laid out and built in a worker of their own (`placesWorker.ts`, which
   keeps its world between requests: the world made there once), meshed as the game meshes it (`meshSite`), its far land and the
   painted trees on it left out, and everything turned into the world's coordinates (its frame: a turn about its forecourt, and its
   heights shifted to the world's), so that light baked in the world's directions reads as it should; its solid part gathered there into
   one mesh with its tree of bounds, sent as numbers; and the height of its land read all round the edge of the square it was laid over
   (its sheet of turf), every two metres; what stands about its house cut into tiles of 64 metres there, as the game cuts it, so that what
   is out of view is not drawn. On the page its meshes are made with the game's materials, some six milliseconds' worth a frame, lit as the game
   lights what it does not bake, with its grass, flowers, leaves and water; then its house's light is baked as the game bakes it, in
   workers, its lamps and fires baked in. It is built in the page's season and at its hour, whatever its own seed gave it (its leaves
   came out autumn's in a summer world). The world's squares are made with the place's hole (`Hole`, `withHole` in `stream.ts`):
   inside its square a little under the place's own land and not drawn (`squareBuilders`'s `skip`), outside it brought to the place's
   land at the edge over a band of thirty metres and three times more the height the place's land stands off the world's at that point
   of the edge (`gap`, measured in the worker: behind a valley's head it stands up to some thirty metres over the world's, and over
   thirty metres it was a cliff; taken from each point's own height instead, a way's bed and the grass beside it were brought in by
   different shares, and the way stood up as a causeway). A way through the band is graded again on the land as the place leaves it
   (`wayThroughHoles`), its bed the land's own near the edge, and the squares meet the place first and cut the way in after, the bed
   fading out over the last twenty-five metres (the place's land can fall steeply across a way's breadth, and a level bed stood off it
   by metres). The far land, what grows and the body's ground patch leave the square to the place; the body walks on the place's solid
   part there; and the way's corridor gives way to it. Past
   2.3 kilometres it is let go of, and all about it made again. The layouts are kept as the world page keeps them, so that the game,
   entering the place from the route page, does not lay it out again. *Checked* without a browser (`npx tsx tools/places.ts w0`): Strath
   Norith laid out and built in 35 seconds (31 of them meshing), 4.8 million triangles, over a square 495 metres a side; 27 squares about
   it with its hole still meet exactly; along the square's edge the world's land stands within 3 centimetres of the place's on the whole
   and 47 at worst; the band is nowhere steeper than the land was of itself (133% at most against 159%), and much steeper than one in
   two over 0.6% of it; the way through it tilts across its bed by 5 centimetres at most over four metres; the body, walked from
   Halhaven's quay along the way, crossed into the valley after 104 seconds and came to the house in 142, never more than a few
   centimetres into or over what it stood on. In the browser (headless, drawing in software, at 480 by 270), the valley was built in the
   worker within two minutes of the page opening, its 54 meshes put in a few a frame, its light baked; no fault reported.

   *Then towns, islands and mountain tops.* A harbour town and an island bring their sea: the world's sea is now the game's (`Sea`, in
   `worldSea.ts`: the swell, the road of glitter, light through the crests, the shallows seen into, white where it breaks), laid in rings
   about the walker over the world's own land as its bed, 1.6 kilometres square, and laid again when the walker has gone 600 metres;
   where a place with a sea of its own stands, its sea is drawn instead, about it, with its harbour's and its cliffs' own bed (turned into
   the world's axes in the worker) and spray. A town brings the brown brick of its classical buildings, and a mountain top its frost-split
   talus, which the places' materials now have. A mountain top's land does not fill the square it was laid over: it stops where the game's
   cloud would hide it (some 34 metres under the cloud's top) and where its rock is carved, and below that the world's land must go on;
   round Elith Fell's square, 792 of 886 heights found no land of the place's under them. So a place whose edge is not all land has a
   hole that follows its land instead (`HoleGrid` in `stream.ts`, made by `gridHole` in the worker): a lattice of a metre in the
   world's own axes, each point holding how far it lies outside the place's land, the place's height there, and how far that stands off
   the world's land at the nearest point of its edge; read for every point of a square as the square's edge is (`holeAt`), so the same
   `withHole` brings the world's land in. The land is found by looking down on the place's sheet, scree and carved rock (its rock only
   where it stands no more than twelve metres over the world's land: a mountain's needles stand out of its cloud on nothing the world has,
   and the world's land drawn up to their tops made cones of them; below, down to forty, for the place's land is worn deeper than the
   world's by ten metres and more in places, and cut off at twelve both ways the rock counted in patches); taken in by a point all round, so that the world's land runs in under the
   place's; its hollows filled (where the house stands, the sheet is left out). Just outside, the place's height is carried on down the
   world's own slope (held level from the edge, the world's land was brought up to a shelf on a mountainside; read every two metres,
   the edge could not follow a carved cliff). *Checked* (`npx tsx tools/places.ts w0 mountain 1`, the join alone; the edge now measured
   as how far the world's land lies from the nearest of the place's within a metre and a half, not straight up, which on a slope four
   times as steep as it is broad differs by four): Elith Fell laid out and built in 110 seconds, 3.5 million triangles; its land stands
   off the world's at its edge by up to 13 metres (worn on its own lattice, lower than the world's by four and a half on the whole), and
   the world's land lies within 10 centimetres of it on the whole; 4 of 400 points of the edge lie more than a metre from it, at worst
   3.3, at the foot of a carved crag where the rock stands over the land. The band about it is steeper than one in two, and half as
   steep again as the land was, over 8.4% of it: the land is brought down some metres over a band some tens of metres broad on slopes
   already steep. Halhaven (`w0 coast 1`, 6.0 million triangles over a square 919 by 525 metres) and Selrin Island (`w2 island 1`, 2.7
   million, 458 by 275) join as a valley does: 2 centimetres on the whole, 6 and 8 at worst, the band nowhere much steeper than the land.
   Strath Norith's join and the body's walk into it are as before (2 centimetres on the whole, 46 at worst; the house reached in 142
   seconds).

   At most two places stand in the world at once, the nearest: a nearer one wanted takes the place of the furthest, once that one is
   in and lies 300 metres further off than it (`MOST`, `YIELD` in `places.ts`). On the route page's first world, from Halhaven's quay,
   three came within reach together, Halhaven, Strath Norith and Falyhaven, two towns and a valley head of 6.0, 4.8 and 5.2 million
   triangles: more than a modest machine holds.
3. **One renderer.** *Done, for the sky and the air.* The game's sky, its air and its weather are now one code (`src/render/air.ts`),
   which the game and the walk and route pages both call: the sky painted for the hour (`skyMesh`); the picture made in steps
   (`airPipeline`: the air put into the scene with the game's clouds, the hollows of what is seen darkened, wet ground mirroring, smoothed
   over the frames, the glow of what is bright); the air lit for the hour (`lightAir`); the weather (`weatherOf`: cloud heaped or in
   banks and how much, mist, haze, rain); and the clouds drifting (`driftClouds`). So the world now has what the game was given while
   the world was being made: clouds of many sizes, heaped high or in banks, with soft-edged shadows on the land, ice cloud over them,
   mist that glows towards a low sun, the frames smoothed into one another, rain with its rings on water and wet ground. The levels of
   detail are the game's (`QUALITY`, chosen on the game's opening card and remembered; `?quality=` and each of its settings in the
   address), and the sun's shadow is the game's (`SunShadow`): drawn finely in a square of 128 metres about the eye wherever it goes, and
   beyond that read from the air's picture taken from the sun over the whole world, so that a mountain's shadow falls on the valley
   under it. What differs is said where it is called: the world's air is thinner (the eye sees ten kilometres, not one), its floor is the
   sea, its sky twice as large. The places' water mirrors the sky and cloud as the game's does. The world's weather is fair unless the
   address says otherwise (`?cloud=`, `?layered=1`, `?mist=`, `?haze=`, `?rain=`). *Not yet:* the town's street lamps and the rooms'
   lamps as lights, night's own lights, smoke, birds and sheep; the game's tone choices; its lantern.

   *Looked at with a graphics card* (20 November 2026: an Apple M2 Pro laptop, its 16 gigabytes shared by the processor and the card,
   in the app's embedded browser at 1103 by 955, WebGPU on Metal; the route page on `w0` from Halhaven's quay, at the high level of
   detail). With Halhaven and Strath Norith standing and their light baked, a frame drawn back to back and waited for on the card
   (`__walk.time()`) took 51 milliseconds, some 11 of them the program's and 41 the card's, and the browser's own frames came as far
   apart. With every mesh in the scene hidden it still took 32: the picture's own steps (the clouds, the air, the hollows, the
   smoothing, the glow, the sun's maps), not yet told apart. The places' meshes were some 16 (Halhaven's, in view; Strath Norith lay
   behind) and the cards 4. Two places standing are too heavy for such a machine: the page's heap held 4.1 of the 4.4 gigabytes it may
   have (139 megabytes before the places came), its process 5.9 and the browser's graphics process 3.5, and with other programs open
   the machine was eleven gigabytes into its swap. Every point of a place's meshes is kept in the page after it has gone to the card,
   with its light, some 124 bytes a point at about two points to a triangle: a gigabyte and a half for Halhaven alone, and as much
   again on the card. *Mended:* each mesh's points now go to the card as it is made, as drawing it first would send them, and the
   page's copies are let go of (`toCard` in `places.ts`; the house's once its light is baked); only the index is kept, which the view
   of the triangles needs. With the same two places standing the page's process then held 3.4 gigabytes, not 5.9. Each place still
   keeps its solid part and its tree of bounds for the body, some 130 megabytes for a valley head and 320 for Halhaven. (Chrome's own
   count of the heap, `performance.memory`, takes in the page's workers too: it rose to six gigabytes while a house's light was baked,
   each of the six bake workers holding the house and its bounds, and the next place was built in its own worker at the same time, and
   fell back after. Places let go of are collected: a count of them, `WorldPlaces.collected`, went up by one each time.) (A frame first timed at a millisecond and a half: three's count of frames had not gone on, so only the last of
   the picture's steps was drawn again. And the page's own frame time then read thirteen milliseconds, the timing's frames left in its
   average.)

   The sun's shadow near the eye is right: in the near square every stall, tree and fountain and the obelisk throws its shadow on the
   paving. Far off, the places throw none: from 110 metres nothing in Halhaven's square threw a shadow that had from 50. The air's
   picture from the sun, which the shadow is read from beyond the near square, is drawn once, when the far land is first all in, over
   the whole world at some 5.7 metres a point, and holds only the world's land; a place that comes later is never drawn into it, nor is
   the far land as it changes. *Mended:* a third picture from the sun lies between the two (`SunPicture` in `sunShadow.ts`): a
   kilometre square about the walker, 2048 points across, half a metre a point as the game's town has it, of what is on its layer, the
   places standing and the squares of land near the walker. It is drawn again when the walker has gone a hundred metres, and when a
   place or land within its reach has come or gone, then no oftener than every three seconds; and read, without a filter as the far
   picture is, between the near square and its own edge, where it can only darken the far picture's reading, which still holds the
   mountain whose shadow falls from kilometres off. From 110 metres the obelisk, the fountain, the stalls and the lamp posts of
   Halhaven's square throw their shadows again. It costs no more than a millisecond or two a frame, within the measure's noise
   (`?midshadow=0` leaves it out). Trees are not in it yet: their crowns are cards.

   Found and mended. *The sea:* the world's flat sheet of sea lay 0.6 metres under the game's sea over all of it, and the swell's
   troughs go down 0.82 metres, so the dark sheet showed through in ovals, each ringed with the foam the sea draws against anything
   standing in it; and the game's sea, drawn as seen into, saw the sheet under it everywhere instead of its bed. The sheet is now a ring
   beyond the sea's disc of 3.4 kilometres, moved with its middle (`SEA_RING` in `worldSea.ts`). *Flickering in a town*, seen by the
   person who asked: the house's terrace walls are built the wrong way about (their frame faces out into the square, where `masonry`
   wants it facing into the wall, as the quay's and the moles' do), so the square sees the backs of the stones, which lay in one plane
   with the back of the dark block of joints behind them, and the block came through in patches that changed from frame to frame. The
   block now stops short of the stones' backs and ends as it does of their faces. And the walls are built again, the right way about.
   Measured on thirteen towns, the ground at the terrace's edge had never been sharp: read smoothly from a lattice of a metre and a half,
   it fell to the square over some three metres about the edge, and stood up to 0.66 metres over the square against the wall's foot
   in front, and lay up to 0.96 metres under the floor just behind the balustrade. The ground is now made sharp where the terrace is
   walled (`terraceGround` and `terraceWalls` in `core/town.ts`, read by `townGround`, which the drawing and the maps read and the
   layout does not): the floor within, and without, the land carried straight in from four metres out, as it slopes there. Its sheet
   is still laid in triangles of 1.2 metres, so the one across the edge slopes within that either side; the walls stand astride the
   edge over all of it, 1.25 metres out and as far in, their dressed faces to the square and the lanes, coped on top, the balustrade
   at their outer edge and round the corners, the front's walls ending inside the stair's cheeks. The ground at the walls' faces is
   now level with the square and the floor, in all thirteen towns. And the glass of a classical building's basement windows lay in one plane with the block of stone under its
   ground floor, 0.2 metres in; it is now 0.15 in, before the block and behind the bars. Both are the game's own builders, so the game's
   towns had them too. Still flickering a little: some three thousand small pieces of stone lying flush on one large stone face beside
   that same building, not yet traced.

   *Checked again without a browser, the same day:* `tools/places.ts w0` as before (Strath Norith's land within 3 centimetres of the
   world's at its edge on the whole and 47 at worst; the body into the valley after 104 seconds and to the house in 142), and
   `w0 mountain 1` as before (Elith Fell's within 10 centimetres on the whole and 3.3 metres at worst, 4 of 400 points of the edge more
   than a metre off, the band steeper than one in two over 8.4% of it), built in 54 seconds; `tools/town.ts 3`, all sound. `npm run
   check` passes every valley head and island and fails two mountain tops (`peak-check-48`, `-49`: the gallery way breaks, rising 3.8
   and 2.3 metres over two) and two towns (`town-check-13`, `-14`: a building in the street); `tools/buildingLab.ts 300` fails one
   classical building and two canal houses (a point that is not a number). None is of this work: the lab's three fail alike on the
   state before it, and the check's four are in code this branch has not changed from the default branch's. After the terrace's ground and walls
   were changed: the towns' part of the check (`tools/sites.ts 200 town`, 25 towns) fails the same two and no more; `tools/town.ts`
   builds sound; `tools/places.ts w0 coast 1`, Halhaven's land within 2 centimetres of the world's at its edge on the whole and 6 at
   worst, as before.

   *The walk page to Elith Fell*, pressing P from place to place, with all the above: Strath Norith stood and was baked 40 seconds
   after it was asked for, Norishdale 86 (6.2 million triangles; the worker was building another meanwhile), Strath Talston, Haledale
   and Elith Fell some 40 each, the mountain's light baked in 32. A frame drawn back to back at each place's door: 38, 38, 36, 38 and
   31 milliseconds, two places standing at most of them. (In the same run the route page's frame at Halhaven's quay took 57 to 58,
   against 51 earlier: the machine was by then twelve gigabytes into its swap.) *The mountain's edge:* the two lands meet without
   ledges, but along the top of the face below Elith Fell's south-western rim the sky shows through in small gaps between the world's
   land and the place's carved rock: the hole that follows a mountain's land is found looking straight down on it, and where the
   place's carved face stands off the world's land seen from the side, nothing closes the gap. Close under that rim the world's land in
   the band is near upright and its material stretched into stripes over large flat triangles. And the place's rock is the site's own
   warm bedded stone, the world's a cooler grey, so a line runs round under the plateau where one meets the other. Not yet mended.
   Still to look at: how the picture's 32 milliseconds divide among its steps, and the other levels of detail; a small flicker on the
   front of one timber-framed house some sixty metres across Halhaven's square, not yet traced.
4. **The game in the world.** Each place's mission (keys, locks, the goal) as the game has it now; the maps (the world's, and the
   place's plan); sound; the ways joining every place (towns to towns, valleys to valleys, mountains to valleys, islands by sea), and
   a boat for the sea legs; and something faster than walking for the kilometres between.
5. **The world's own light, water and rock.** How much sky each point of the land sees, worked out in the workers that make the squares
   (from the heights about it), for the land between places that no bake reaches; lakes and rivers; the crags near the walker carved.
6. **The world the default.** The game's own page opens on the world; single places stay, for making and checking them.

## Where next: the land, and places that fit it

Asked: "do we need better noise/fractal/erosion algorithm for terrain? also we should adapt the
locations maybe better to the landscapes generated somehow; the location layouts should be anyway
adaptable".

**The land.** *Done: it is now lifted and worn by its rivers, as described above.* What it was made of before: value noise summed in octaves (plain, Quilez's eroded, and ridged),
its coordinates warped; worn by drops of water and by frost on each lattice; the great valleys and the
straths drawn as two families of wandering lines running inland, the bay a sunk hollow, the fjords cut
down the straths, and hollows breached where they would not drain. What shows of its limits: the
drainage is drawn, not formed, and its valleys come at an even spacing two ways; the shelf's islands come
out of one noise with a narrow range of sizes, few of a house's size at the one sea level; value noise
keeps something of its lattice, and the drops, worn at one scale within fixed limits, cut gullies all
alike. The one change that would answer most of it is to make the land as land is made: lift and
erosion by rivers, solved together (Cordonnier, Braun, Cani and others, "Large Scale Terrain Generation
from Tectonic Uplift and Fluvial Erosion", 2016): the ground lifted at a rate the zones set (fast under
the range, slow by the coast, sinking at sea), each point worn by the river through it in proportion to
the ground draining through it and the fall, step after step, with the slopes crept down between; so
that rivers branch as rivers do, ridges stand between them, valleys drain to the sea by their own making,
and a sea level drowns their mouths into inlets and their hilltops into islands of every size. It would
take the place of the drawn valley lines, the bay's hollow, the fjords' cuts and most of the breaching;
the drops would stay for the finer wear. On a lattice of 16 metres (some 235,000 points) a step is some
tens of milliseconds, and a hundred or two steps are needed: seconds, as the wear takes now. Smaller
things: gradient noise in place of value noise where the lattice shows; at a metre, detail laid along
the way water runs rather than the same every way.

**Places that fit the land.** *Begun: the searches ask for ground a house can stand on, and its ground
is fitted (levelled, terraced) to the land found, as above. The places' own layouts (where the sites put
their cottages, ways, landings and the rest) are still each site's own, and are fitted when the sites are
built from the world (step 3).* As it was: each kind of place still wants a shape: an island of so many hundred
metres with a shoulder at a set height, level within twelve metres over the house's ground; a valley head
with walls and a fall; a mountain top drawn whole, its rim and ridge and summits. The land is searched for
that shape, and seldom has it. The other way round: find ground a house can stand on and a way to come to
it, and let the place take its layout from what is there: the house's level ground fitted to the flattest
ground near, terraced where it must be, and the plan of the house chosen from several to suit it; the
landing in the nearest sheltered cove the coast actually has; the way up a ridge the land actually has, or
round the hill if it has none; the outbuildings where there is room. So a search asks less (ground that
can be built on, and a way to it) and finds more, and every place is the land's. This is step 3 below, and
it should come before step 4: the mountain top, which was drawn whole, was the furthest from it. (Since 19 November 2026
its land is the world's, its house's ground fitted into it, and its ridge the one the land has: below.)

## Open questions

- **How the squares are kept.** Heights to a centimetre in sixteen bits are half a megabyte a square of
  512 metres; the whole world 128 megabytes, if every square were visited. Kept by the browser for the
  world's seed, and dropped when another world is wanted, or kept for a few worlds.
- **Whether the tiles of 5 metres are still needed** once the squares at a metre are: the searches for
  islands and valley heads are written for 5 metres, and the squares are made from them.
- **Whether a place's own land should be changed where it was found.** An island's cliffs are cut and
  its house's ground levelled in the island's own land; seen from elsewhere, the world shows the island as
  found. With the squares at a metre, that cutting could be done in the squares themselves.
