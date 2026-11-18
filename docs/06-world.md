# 6. The world

A world is one stretch of country, eight kilometres square, in which every kind of place is found
rather than drawn, four of each: islands in its sea, valley heads in its upland, mountain tops in its
range, and later other kinds in its low country. Its hills are four to six hundred metres high. Each
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

The answer given before starting: yes. Valleys and islands were already found, not drawn: each in
a frame of its own made by noise and worn (`highlands.ts`, `archipelago.ts`), drawn from a pool of
such frames. Only the mountain top was the other way round, its top drawn first and the country made
round it (`mountain.ts`); but that country is already made as a world needs to be, coarse and then
finer near the mountain. What was missing was one land holding them all.

The first world was forty-eight kilometres square, with mountains of two kilometres and twelve places
of each kind. It was brought down to eight kilometres and hills of four to six hundred metres, as
asked, so that its land can be had at a metre where it is walked (below).

## What a world holds

All in `src/core/world.ts`, decided from the world's seed alone; nothing in it depends on which
place asks for it.

- **The plan** (`planWorld`): inland is north, turned up to 17 degrees either way, so the sea and its
  islands lie to the south and the hills to the north; where the coast lies (some 700 metres of open
  sea, then a shelf 1.3 to 1.9 kilometres broad); how broad the low country (0.4 to 1.4 kilometres)
  and the upland (1.8 to 2.6) are, the range taking the rest; a great bay; how deep and how far
  inland its fjords are cut; and what is planned rather than left to the noise: one to three great
  peaks, six to eight islands and five summits (below).
- **The zones.** Going inland: open sea; a shelf with islands on it; the coast; the low country;
  the upland; the range. Every point belongs to each zone in a share (`zonesAt`), the shares adding
  to one and blending over a few hundred metres where zones meet. The boundaries wander: the coast in
  bays and headlands a kilometre or two across, the foot of the upland so far that in places it comes
  down to the sea and the low country is gone.
- **The great bay and the fjords.** The bay is the coast pushed back inland over a stretch 1.5 to
  2.5 kilometres broad at its mouth and as deep, furthest along its middle (which wanders) and rounded
  at its head. Only the coast is moved: the upland and the range stand where they would without it, so
  the bay cuts past the low country into high ground, and its sides and head are steep. Its floor is
  reckoned as the shelf's near the coast, so it is shallow and has islands in it. Fjords are cut
  wherever the coast is high ground: the upland's straths, which run inland, are carried on under the
  sea between their walls for 0.9 to 1.8 kilometres, deepest at their mouths; where low country lies in
  front of one, its carved floor is cut off from the sea and holds a long loch instead.
- **The land**: each zone has a land of its own, and a point's height is each zone's land in the
  share it belongs to that zone (`worldShape`). One sea level for all of it; heights in metres over
  the sea.

  | Zone | Its land | Heights |
  |---|---|---|
  | Open sea, shelf and bay | The archipelago's own land (as `archipelago.ts`), lowered to stand in the world's sea, sparser and deeper further out; and the planned islands | islands 20–80 m, sea floor to −170 |
  | Low country | Long gentle swells rising from the shore to the foot of the upland | 0 to about 60 m |
  | Upland | Straths a kilometre or so apart running inland, and between them the glens of the valleys' frame (`highlands.ts`), branching, coming down into the straths | floors 40–150 m, tops to 350 |
  | Range | Great valleys running inland, crossing and joining; side valleys down into them; massifs and cols along the ridges; a mass under each great peak and each planned summit | floors 90–200 m, summits 400–600, great peaks 650–800 |

- **Planned islands and summits.** At this size the shelf's noise makes islets by the hundred at the
  world's one sea level but few of the size an island's house wants (200 to 400 metres across, a
  shoulder 18 to 34 metres over the sea, well in from the cliffs): the islands' own frames find theirs
  by trying twenty sea levels. And the range is narrow, and of the summits its noise makes few stand
  alone with a ridge to come up by. So, as the great peaks were from the first, six to eight islands
  and five summits are planned: an island a cliffed coast, a broad shoulder at a house's height and a
  hill on it, its coast wandering so no two are alike; a summit a mass drawn out along the way its
  ridge runs down towards the coast, the side valleys and crests quieter on it so the ridge comes down
  whole. The searches still find them, and turn down what does not suit.
- **Worn**, on a lattice of 8 metres, a thousand and one points a side, by the same water and frost
  as every other land (`terrain.ts`), so that rivers cut real valleys. The shelf and the floor of the
  sea are spared here (its islands are worn in the tiles; and what the rivers bring down would build
  sills across the fjords). Its shape from before the wear is kept too: the tiles need it.
- **Water.** The sea is whatever lies below its level joined to the world's edge. Then the water is
  followed: hollows are filled to where they would spill, each point drains to its steepest neighbour
  downhill, and what drains through each point is counted (`drain`). A hollow deeper than fifteen
  metres has an outlet cut from its lowest point out through where it would spill, as a river cuts a
  gorge (`breach`); shallower ones are lakes. Rivers are drawn from where forty hectares drain through a
  point, down to the sea.
- **Cover**: what lies at each point, from its height, its slope, how wet it is and its zone:
  sea, lake, shore, marsh, fields, pasture, forest, heath, rock or snow (`COVER`). Fields on gentle low
  ground; woods on slopes and in patches, thinning up the upland, whose higher ground is heath with the
  woods down in its glens; heath above the trees (the treeline wanders about 300 metres); rock where it
  is steep or high; snow lying late only on the great peaks.
- **Tiles**: a finer lattice, 5 metres (as the islands' and the valleys' own frames are), in tiles
  2.4 kilometres square on a fixed grid, a tile every two kilometres, each reaching 200 metres over
  its neighbours (`worldTile`). A tile is the world's fine shape (more octaves of each zone's noise)
  with what the world's wear did laid on it, so the rivers keep their valleys; worn again at its own
  scale; and drained. Because the grid is the world's, a tile's land is the same whichever place asks.
- **Places**, looked for where their kind of land is, four hundred metres in from the world's edge at
  least; each list best first, four of each kept, the search stopping when it has them:
  - *Islands*: in the tiles where the shelf has land, by the islands' own search (`findIslands`),
    told that the sea stands at the world's level instead of trying twenty levels of its own. One
    house to an island.
  - *Valley heads*: in the tiles of the upland, by the valleys' own search (`findValleys`) on the
    tile's drainage. No two within seven hundred metres.
  - *Mountain tops*: on the world's lattice, in the range: a summit with nothing higher within 300
    metres, standing alone over the cloud (nothing higher joined to it above a level forty metres under
    its top, within 1.2 kilometres), 180 metres or more over the valleys a kilometre off, not on a great
    peak, with a ridge down from it that a way could come up (falling steadily for 450 metres along a
    crest, the ground lower on both hands). The mountain top as a site was made for a country three
    times as high; when one is fitted to these, its cloud and the valleys under it come down to suit.
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
`tools/browser/worldmap.cjs` saves both pictures.

![The ink map of a world](images/world-ink.jpg)

## Measured

Without a browser, in a cloud container with four cores (`npx tsx tools/world.ts`), November 2026:
a world builds in 24 to 30 seconds: its shape 1.6 to 2, the wear by water and frost on the world's
lattice about 10, following the water 1, the cover 0.5, and five to eight tiles for islands and valley
heads 11 to 16 (each some two seconds, nearly all of it the wear). In the browser (Chromium, headless,
same machine) the world page makes and draws one in 23 to 28. Four worlds tried (`w0` to `w3`) each
gave four islands, four valley heads and four mountain tops, ten or eleven towns and 24 to 30 rivers.

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

1. **The world, and its map.** *Done*: everything above. Nothing in the game reads a world yet.
2. **Land streamed in at a metre, meshed by its detail.** The world's land to a metre, made where it
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
4. **Mountain tops fitted to the world's summits.** The mountain top's rim, ridge and summits laid on
   the summit found, turned to its ridge, at this country's scale (its cloud forty to sixty metres under
   the top, the valleys three hundred metres under that, not seven hundred); its country the world's.
5. **One far land, from the world.** From a place, the rest of the world and the land beyond its edge
   (the shape continued, unworn), in place of the three kinds of far sheet each place has now.
6. **The map leads to the places**, and **more kinds of place** where the world has room (the low
   country, the coast).

## Open questions

- **How the squares are kept.** Heights to a centimetre in sixteen bits are half a megabyte a square of
  512 metres; the whole world 128 megabytes, if every square were visited. Kept by the browser for the
  world's seed, and dropped when another world is wanted, or kept for a few worlds.
- **Whether the tiles of 5 metres are still needed** once the squares at a metre are: the searches for
  islands and valley heads are written for 5 metres, and the squares are made from them.
- **Whether a place's own land should be changed where it was found.** An island's cliffs are cut and
  its house's ground levelled in the island's own land; seen from elsewhere, the world shows the island as
  found. With the squares at a metre, that cutting could be done in the squares themselves.
