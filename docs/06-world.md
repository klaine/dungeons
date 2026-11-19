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
    three hectares or more and no more than twenty-five, whatever its shape; on each, the house where its ground fits best,
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
  town, every place.

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
the land** the walk page there; and the game, built on a world's place, has a **World map** link back.

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
world's lattice and some quarter of a million on each tile. What could be done about it: keep a world
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
   world's summit, its country the world's.
5. **One far land, from the world.** From a place, the rest of the world and the land beyond its edge
   (the shape continued, unworn), in place of the three kinds of far sheet each place has now.
6. **The map leads to the places**, and **more kinds of place** where the world has room (the low
   country, the coast).

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
on rock, shingle or water); trees where the world has woods (one to a cell of seven metres there, a few in
pasture and heath; oak and ash low down, spruce and pine higher, pine alone near the treeline; the same trees
whoever asks, `treesIn`), grown whole out to 120 metres as the valley's are, and beyond as single painted
cards out to 1.8 kilometres, as the valley's far hillsides have them. `?hour=`, `?season=`, `?haze=`, `?tex=`.
Not yet: water but the sea (lakes and rivers are not drawn), snow, tracks and roads on the ground, the
places' houses.

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

A mountain top (`place=mountain`) is the furthest from the land's way round: the game draws its top whole,
its rim, the precipices under it, the ridge the way comes up and its crest, the summits, and wears that.
So it is laid on the world rather than read from it. The house's level ground goes where the world found
the hospice's, turned so that the ridge runs south from it as the drawn ridge does; the first summit is
the world's, where it is and as high over the forecourt as it is; the top is drawn out along the line from
the house to the summit, as broad as a top drawn alone, so that the summit stands on it; the cloud lies as
the game lays it, under where the player arrives at the ridge's foot. Beyond the top the country round
about is the world's (`countryShape` in `mountain.ts`), not worn again, with the drawn top standing on it
where it is the higher; no far range is drawn, since the world has its own, and its sea is the water.

Measured, November 2026, in the cloud container of four cores: the four valley heads of `w2` each built
(`WORLD=w2 npx tsx tools/land.ts 4`) with nothing wrong, laid out in 0.1 to 6 seconds (the tiles about it
made first) and built in 18 to 23, with 730,000 to 950,000 triangles of rock; its first island laid out in
8 and built in 38, 513,000 of rock; its second found room for a cove on the third draft of its house. In the
browser, drawing in software, the game built the house at Strath Cal from the world in some ten minutes, of
which the world was about one. Its first two mountain tops built without fault, laid out in 15 and 24
seconds and built in 92 and 123, with 3.2 and 4.2 million triangles of rock, the summits 58 and 60 metres
over the forecourts (the same seed's top drawn alone has 3.7 million and takes 94). Not yet: the squares
at a metre under a place (the
site reads the tiles at 5 metres, as it read its upland at 5, and lays its own detail); a world's lakes and
rivers in its places.

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
it should come before step 4: the mountain top, which is now drawn whole, is the furthest from it.

## Open questions

- **How the squares are kept.** Heights to a centimetre in sixteen bits are half a megabyte a square of
  512 metres; the whole world 128 megabytes, if every square were visited. Kept by the browser for the
  world's seed, and dropped when another world is wanted, or kept for a few worlds.
- **Whether the tiles of 5 metres are still needed** once the squares at a metre are: the searches for
  islands and valley heads are written for 5 metres, and the squares are made from them.
- **Whether a place's own land should be changed where it was found.** An island's cliffs are cut and
  its house's ground levelled in the island's own land; seen from elsewhere, the world shows the island as
  found. With the squares at a metre, that cutting could be done in the squares themselves.
