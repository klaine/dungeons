# 4. The look: 3D world and 2D maps

The site document from the generator is turned into two kinds of visual asset: a 3D world to walk through in the browser, and 2D maps. This document defines the target for both and the approach to reaching it.

## Target

A first-person 3D world in WebGL with physically based materials, normal-mapped surfaces and lighting good enough that screenshots are worth taking. Grounded and believable in its materials, heightened in its lighting and colour.

The standard to hold: **a generated place should not look generated.** No visible grid, no visibly repeating texture, no uniform lighting, no flat walls meeting at perfect corners.

## Principles

1. **Light first.** Lighting is the largest single contributor to how good a scene looks, and the one most often left as an afterthought in generated worlds. It gets its own pipeline layer and its own budget.
2. **Form before surface.** Normal maps add grain, not shape. This is not a low-poly look: every stone is its own piece of geometry with a bevelled edge and a recessed mortar joint, sitting slightly proud or shy of its neighbours. Walls get plinths and cornices; rubble gathers at the foot of a ruin. Anything that should cast a shadow or catch a highlight on its edge is modelled. A modest courtyard and hall comes to several thousand stones and several hundred thousand triangles, which current hardware draws easily.
3. **Fields drive surfaces.** The history layer already knows where it is damp, old, hot, overgrown and well-trodden. Those fields choose and blend materials, which is what ties the look to the place's story.
4. **Hide the machine.** Break up tiling, vary instances, jitter what would be regular, and never let the underlying grid show.
5. **One document, many views.** The 3D world and every map style are rendered from the same data and always agree.

## Geometry: from spans to meshes

The span grid is logical. Separate builders turn it into visible geometry, selected by each zone's origin.

| Builder | Input | Output |
|---|---|---|
| **Terrain** | Open-air spans, material weights | Continuous ground surface with level of detail; cliffs given real rock faces rather than stretched slopes |
| **Architecture** | Built spans, storeys, openings | Walls with thickness, floors, vaults and ceilings, stairs, roofs derived from footprints |
| **Natural rock** | A function giving how far inside open air each point is | Smooth irregular surfaces extracted with marching cubes, so caves have curves and overhangs. Built: see below |
| **Kit of parts** | Sockets from archetypes and openings | Arches, columns, door and window frames, battlements, beams, railings |
| **Vegetation** | Growth field, flora rules | Trees grown procedurally, undergrowth and ground cover as instances, ivy and roots following surfaces |
| **Ruin** | Decay field, events | Broken wall tops, missing roofs, fallen blocks, rubble |
| **Water** | Water level and flow from history | Surfaces for pools, rivers and flooded spans |

The kit of parts is itself procedural and parameterised by builder culture, so one arch recipe yields a pointed arch for one culture and a round one for another. Seams between builders (a cave breaking into a cellar, a wall founded on rock) are handled explicitly, since those borders are where sites are most interesting.

### Natural rock

Where masonry is laid stone by stone on a surface, rock is carved. A cave is described by a function that is positive in open air and negative in rock: an uneven dome over a rough oval floor, with a bay reaching towards each doorway, roughened by noise at two scales. The surface between air and rock is extracted with marching cubes at about a quarter of a metre.

- **Texture without stretching.** Each triangle takes its texture from the direction it mostly faces: floor and ceiling from above, walls from the side. Triangles do not share vertices, so neighbouring triangles can differ. Shading stays smooth because normals come from the function itself.
- **Winding from the tables, never from the slope.** Where two parts of the function meet in a crease, its slope can point the wrong way. A triangle wound by the slope then faces away and leaves a hole to the sky. Winding is fixed by the marching cubes tables.
- **Closed by construction.** Whatever the noise does, the rock is forced solid before it reaches the edge of the volume being carved, except towards a masonry wall, which hides the edge.
- **Where rock meets masonry.** A cave has masonry only on the side where the builders walled it off to hang a door. That wall is laid as usual; the rock runs a little way past its plane and the wall hides the join.

Rock strata are tinted per vertex in tilted beds. Caves are unlit: they are places for the carried light.

### Cliffs, boulders and scree

Out of doors the rock is made in three steps, each of which the next depends on.

1. **Beds.** Each kind of stone has a character: how thick its beds are, how far apart its upright joints, how much one bed differs from the next, whether it weathers round or breaks sharp. Limestone is thick level beds in blocks; sandstone thin beds of very different hardness, worn round; greystone massive and angular; basalt close upright joints. Beds dip a little and roll, and come in runs: a few hard ones together, then a few soft.
2. **Wearing.** The wall round the valley starts as a smooth rise, steeper than rock would stand. It is then worn on a lattice of heights the way frost wears a cliff: wherever rock stands steeper than its bed can hold, some comes away and lands on the lowest ground beside it; wherever that debris lies steeper than it can, it slides on. Soft beds fall back into ledges, hard ones are left as faces, and scree gathers at the foot. Most of what falls is taken to have weathered away, or the scree would bury the cliff. The lowest four or five metres are always sound rock, so the wall begins with a face too high to scramble up.
3. **Carving.** The worn heights are carved as a solid on a lattice of 30 centimetres, in a band round the valley and across its head, in a way that keeps edges sharp (below). Where the ground is steep and bare, the surface is moved out or back from where the heights put it by the rock's relief: soft beds cut back under hard ones; each step of a few beds brought upright, so the face goes up in treads and risers; the beds split into blocks by joints (cells in three dimensions, kept in layers), each block standing a little proud or shy and a few missing; broad buttresses and gullies; and, in stone that breaks sharp, flat faces meeting in edges. The face is moved sideways, never up and down: that is what lets a bed overhang the one below, and keeps the top of a cliff from breaking into teeth.

The meadow before the door and the scarp either side of it are carved the same way from the same lattice and baked with the house; the rest of the rim is not baked, and takes its light from the open sky, dimmed in cracks and under overhangs by feeling for rock in front of each point. Every carved patch ends on the lines of the sheet of ground beyond it, so the two meet without a join.

**Keeping edges.** Marching cubes, which carves the caves, puts the surface's points on the edges of the sampling cells and joins them, so a corner inside a cell is cut straight across and everything comes out rounded to the size of a cell. Rock in the open is carved another way (dual contouring). Each cell the surface passes through gets one point, placed where the surface's faces meet: every crossing of the cell's edges gives a spot the surface goes through and the way it faces there, each such pair is a plane, and the point is put where the planes come closest to meeting. On a flat face that is anywhere on the face; on a crease it is on the crease; at a corner it is the corner. Points of neighbouring cells are joined across every lattice edge the surface crosses. A ledge, the edge of a block or the meeting of two fracture faces then comes out as a true edge at the same lattice size and the same cost. Shading keeps them: the faces round each point are gathered into groups lying within 36 degrees of each other, and each group is shaded as one smooth surface, so a face is smooth and an edge is an edge. Pieces of land are sampled one cell beyond their own edge so that neighbours make identical points along it, and are closed exactly to the edge where they meet the plain sheet of ground.

A boulder is a block bounded by flat faces, as rock that has split along beds and joints is: a few planes round it, two for its beds, corners knocked off, sometimes a crack right through, the beds showing as grooves round its sides, and the same faceting or rounding as the cliffs. Scree is a dozen such shapes carved once and set down by the hundred wherever the wearing left debris, with larger blocks among them; the ground under it has a texture of its own.

**The rock material.** Carved rock has no texture coordinates worth having, so its texture is laid on from three sides by position and blended by which way the surface faces: nothing stretches on any slope or under any overhang. The texture is a broken surface: flat faces at three sizes meeting in sharp edges, pits, grain, a few hairline cracks. It is read twice more: very large, for slow changes of tone, so no repeat shows; and four times enlarged for the normal map alone, which gives faces a stride across that the carved surface is too coarse to hold an edge on. On steep faces the shader draws thin beds within the thick ones and dark streaks where water runs down. Moss and damp come from per-vertex fields, as on masonry.

**Mountains.** (For a long time the sheet of the mountains was wound the wrong way and drawn inside out, so that every slope facing the eye was thrown away and only the far sides of ridges showed. If mountains ever look like teeth standing in a pale lake, look at that first.) The far ring is ridged noise summed the way water would have it: each finer layer counts for less where the layers before it are already steep, which leaves sharp crests with long flanks and gullies between. No layer is finer than the sheet can draw where it lies, or it would come out as needles; the sheet is coarser further off, so the far side of the range is plainer. Cover goes by height and slope: forest low down and higher up the gullies, pasture, bare rock in bands where it is steep, scree below the faces, snow on what is high and not too steep.

## Materials

Every surface uses a physically based material: base colour, normal, roughness, ambient occlusion and height, with metalness and emission where relevant.

**Where textures come from.** The primary source is a procedural material library: recipes that generate tiling texture sets on the GPU from noise and pattern functions, with normal maps derived from the generated height. This suits the project. Materials are seedable and can vary per site and per culture, nothing has to be licensed or downloaded, and the generator can ask for "this masonry, but older and wetter". The pipeline also accepts ordinary scanned texture sets, so openly licensed libraries can be dropped in where a recipe is not good enough.

Starter library: ashlar, rubble masonry, brick, cobbles, flagstones, plaster, timber planks and beams, thatch, roof tile and slate, wrought iron, living rock in two or three types, earth, mud, sand, gravel, grass, leaf litter, moss, bark, snow and ice.

**Putting them on generated geometry.**

- World-aligned and triplanar projection, so nothing needs hand-made texture coordinates and courses of masonry run true around corners.
- Layered blending by field: a base material with moss where it is damp and lit, dark staining where water runs, soot where there is fire, lichen where it is exposed, dust where nothing walks, polish where everything does. Blends follow the height map so moss sits in the joints before it covers the stone.
- Wetness as a modifier: darker and smoother near water and after rain.
- Anti-repetition: stochastic tiling and large-scale colour variation so no pattern is visible across a big wall or hillside.
- Depth: parallax on strongly relieved surfaces such as cobbles and rough masonry.
- Decals for the particular: cracks, leaks, scorch marks, bloodstains, chalk marks.

## Lighting

### Light regimes

| Setting | Key light | Fill | Character |
|---|---|---|---|
| Open air | Sun or moon with shadows across the whole view | Sky, by time of day and weather | Long shadows, aerial haze, changing colour through the day |
| Interior | Daylight through openings; fires, candles and lanterns | Light bounced from floors and walls | Pools and shafts; warm against cool |
| Underground | Placed sources and whatever the player carries | Almost none, which is the point | Darkness as the default; every light is a decision |

### Approach

Once generated, the world is static, and that is the opportunity. Soft indirect light — sun bouncing off a courtyard floor into an arcade, torchlight warming a vault — is what makes a scene look real, and it is too costly to compute every frame in a browser. It can be computed once.

- **Baked indirect light and occlusion**, calculated after generation by tracing rays against the site's geometry, progressively and in the background so the player can start walking while it refines.
- **Real-time direct light** for the sun and for the nearest few sources, with shadows, so flames flicker and the carried light moves.
- **A probe volume** carrying the baked light to anything that moves.
- **Many small lights** handled by baking the distant ones and keeping only the nearby ones live.

**How the bake is stored.** Per vertex. Because every stone is modelled, vertices are never more than a few tens of centimetres apart, which is fine enough for soft indirect light and avoids unwrapping generated geometry for lightmaps. Crevices such as mortar joints get their own vertices, so they darken naturally.

Each vertex stores, per colour channel, a constant term and a direction term, so that the light a surface receives still depends on which way the normal map tilts it. For a vertex whose hemisphere is sampled uniformly with N rays of incoming radiance L along directions d:

- constant term E0 = (π / 2) · mean(L)
- direction term E1 = π · mean(L · d)
- light received by a surface with normal n: E0 + E1 · n

The bake also records how much sky each vertex sees and what share of the day it is in direct sun. Moss grows where there is sky but little sun, and sky reflections are suppressed where the sky cannot be seen.

A final pass averages nearby vertices that face the same way to remove sampling noise.

**Not every vertex is traced.** A stone has about forty vertices and only a handful are on its face; the rest shape its bevel, its mortar edge and its backing sheet. Light is traced for the face vertices only. The others copy from the nearest face vertex of the same stone, darkened towards the joint, which is where the joint's shadow comes from. This made the bake about seven times faster (230 seconds to 33 on the test scene, same settings) with no visible loss.

### The roof of the house

The house is built into the hill, and its roof is the hill: turf lying a hand's breadth above the top of the walls, swelling and dipping over the vaults, level only where it meets the front wall and the edge of anything open to the sky. Thin soil over stone grows no trees, so it carries rough grass, heather in mounds and a bush here and there. The front wall is finished with a coping, and every court, roofless room and shaft has a kerb of stone round its mouth. The sheet of turf is drawn back to the line of the wall top and out of every opening, so that it ends exactly where masonry begins.

For a long time this turf lay fifteen centimetres *below* the top of the solid volumes that cast the building's shadow, and so was in shadow always: from above, the house was a black shape. Nobody saw it until there was a way to fly. Whatever is laid over the house must lie above those volumes.

### Skin and solid

Visible geometry is only a skin: the faces a player can see, with nothing behind them. Light needs to know where the solid is, for two reasons found in practice.

- **Buried vertices.** Patches overlap at inside corners, so some vertices sit inside a wall or under a floor. Left alone they collect light from wherever their rays escape to, often the open sky, and it smears onto the visible surface next to them as a bright rim. The bake is given the solid volumes behind the skin; a vertex whose rays mostly hit solid mass or the backs of surfaces is treated as buried and takes its light from visible neighbours.
- **Thin shadows.** A skin shadows itself unreliably, so sunlight would catch stone edges inside a closed room. The same solid volumes are drawn into the sun's shadow map from their sunward side, which gives walls and roofs real thickness.

In the hand-assembled scene the solids are listed alongside the skin. In generated sites they come for free: the span grid already says which space is open and which is not.

**Solid things are closed things.** Any free-standing or projecting piece — a coping, a sill, a merlon, a step, a beam, a chest — is built with all six of its faces, including ones that seem hidden against a wall or floor. Leaving out faces "the player cannot see" was tried and was wrong twice: undersides of overhanging stones showed the sky through them. The few extra hidden faces cost little; a see-through stone costs the whole illusion.

Walls are cut exactly at openings. Vertices of a wall that fall inside an opening are moved to its edge, so the stones simply end there; a triangle is left out only if all its corners were inside, or if its corners were moved to opposite sides and it would stretch across. This matters most for a secret door, where no band of dressed stone hides the cut.

Two smaller measures keep the skin closed: every stone has a plain backing sheet just behind its mortar, slightly larger than the stone, so no pixel-wide gaps show between neighbours; and where a wall is cut for an opening, triangles touching the hole are left out and the dressed stones round the opening cover the edge.

### Hours and weather

There are six hours. Morning, midday and evening have the sun well up. At **sunset** it stands a hand's breadth above the hills: long shadows, red light, a sky from gold to deep blue. At **dusk** it has gone: what light there is comes weakly from where it went down, the sky keeps a faint light of its own with a band of rose at the horizon, and the first stars are out. At **night** the strongest light is the moon, cold and faint but casting shadows, under a sky of stars. Each hour gives the real-time light, the bake and the fog their sun and sky, and says how far the eye may open in the dark, which is what keeps night dark without making it black. After sunset the sky is drawn for where the sun really is, below the horizon, while the light comes from the afterglow or the moon.

Clouds have volume. They are a layer of air from 260 to 620 metres up whose thickness at any point is read from a block of noise that repeats in every direction and drifts with the wind: billows with rounded cells cut into them for the shape, finer cells to knot the outline and fray the edges. A piece of air is cloud if the noise there clears a bar; the bar is lower the more cloud the day has, rises with height so that a cloud is broad at its flat base and only its strongest parts tower, and was set by measuring the noise, so that the share of sky asked for is the share covered. Looking up, each view ray is marched through the layer, and at every step a shorter march towards the sun finds how much cloud the light came through, so clouds have lit sides, dark bases and bright edges against the sun, and take the colour of the hour. Looking at the land, the same question is asked of the line from each point to the sun: that is the shadow of the cloud, which drifts over the valley as the cloud does. It dims only what the sun would otherwise reach under open sky. Each site has its own amount of cloud, from nearly clear to heavy.

On a desktop graphics card the clouds cost too little to measure. At the lowest level of detail they are turned off and the sky's older painted clouds are used.

### Atmosphere and finish

- Fog with depth and height, lit by the sun and by local lights, so shafts of light are visible in dusty and misty air.
- A physically based sky, with the same sky lighting the scene.
- Particles as part of each biome: dust motes, spores, embers, rain, snow, insects, drifting leaves.
- Water with reflection, refraction, depth colour and caustics on nearby surfaces.
- Bloom on what glows, contact shadows in corners, film-like tone mapping, and a colour grade per biome so each has its own palette on screen.

### Things that move

Doors swing, so they cannot be baked with the walls. Each door leaf is built like the masonry (boards with joints, closed on every side) and takes its share of baked light from the building just in front of each face. Doors do not cast shadows, because all shadow maps are drawn once.

Small loose things — iron fittings, torch brands, keys — get a faint fixed ambient light and the real lights, and nothing else. Without that they are lit by the open sky wherever they are, indoors included, and glow white.

### Darkness and the carried light

Not every place is lit, and that is decided, not left to chance. The site document records how each place is lit: by day (open to the sky, or reached by a court's light through windows and arches), by torches, or not at all. The generator leaves some rooms dark on purpose — side chambers more often than passages, and never two in a row, so there is always light ahead to walk towards.

The player carries a light for those rooms: small, warm, held low and to one side so that it models surfaces instead of flattening them, and weak enough that torchlit rooms still read as torchlit. It can be lowered. It casts no shadows yet, because that would mean redrawing a shadow map of the whole site every frame.

### Light as a design tool

Lights are placed by the generator for reasons (see the lighting layer in document 2): to pull the player forward, to leak information at a fork, to mark what matters, to make a sanctuary feel safe. Darkness is used as deliberately as light. A scene lit evenly everywhere is a failed scene.

## Performance

The target is a steady 60 frames per second in a desktop browser on a mid-range laptop, with quality tiers above and below.

- **The space graph is the visibility structure.** Places and ways are rooms and portals, so what cannot be seen is cheaply skipped underground and indoors.
- Static geometry merged per zone; repeated things (props, plants, kit parts, rubble) drawn as instances.
- Levels of detail for terrain, vegetation and distant buildings.
- Generation and baking in background workers so the view stays responsive.
- Textures generated at the resolution the tier calls for.

## Open air: the target and where it stands

The target for outdoor scenes is the look of a well-made open-world game: a wooded valley under a hazy sky, with long grass and flowers underfoot, leafy trees and dark firs, one species in blossom for colour, mossy boulders and outcrops, a worn path, water, and mountains fading into the distance. Two reference pictures supplied for the project show this; they are not kept in the repository.

What that takes, and what is in place:

| Ingredient | State |
|---|---|
| Ground cover: grass, flowers, ferns, tall herbs, heather, thicket | In place, as instanced cards with wind, each placed by rule; see *What grows where* below. |
| Trees with leafy crowns, several kinds, one in blossom | In place. A broadleaf is grown: a trunk dividing into limbs, branches and twigs, each thinner and shorter than what bears it and turning up towards the light, as real geometry with a bark material; leaves are sprays of cards hung on the twigs, so the crown has the lumps and gaps of the branching under it. Two habits, a spreading one and a tall one with a leader; one tree in six is old, half as tall again and twice as thick. Roots spread from the foot of each near tree. A crown is dark inside and beneath and bright at its edge: each spray is tinted by how deep it hangs, and larger, darker boughs fill the middle. Bushes are small trees of many stems. Conifers are grown too: a straight tapering trunk with branches leaving it in whorls, each carrying sprays of needles laid along it, some flat and some hanging, darker by the trunk and lighter at the tips. A spruce is clothed to the ground, its low boughs long and drooping, its high ones short and rising, every one turned up at the tip; a pine is bare for half its height, with the stubs of shed branches, and has a rounded head of rising boughs. Pines stand in patches among the spruce. Far off, a conifer is still a trunk and tiers of bough cards. Trunks lie where they fell and stumps stand in the shade of the wood. Small wood (roots, bushes, low boughs) is drawn but stops nobody. Still missing: any difference between kinds of leaf, and plants on the cliff ledges. |
| Land running to the horizon | In place: the valley and its rim, which can be walked, a coarse sheet out to 250 metres, and a ring of mountains to 800 with ridges, gullies, forest and snow. |
| Rock: cliffs, outcrops, boulders, standing stones | In place: see *Cliffs, boulders and scree* above. The cliffs are bedded, stepped and jointed, different for each kind of stone, with scree at the foot. Edges are kept sharp in the carving itself, so ledges, blocks and fracture faces have real corners; nothing smaller than the 30 centimetre lattice can be carved, and below that the texture carries the detail. |
| Leaves lit from behind | In place. Light that has passed the shadow map is let through each card, strongest when the leaf is seen against the sun. |
| A worn earth path, and ground that is more than one texture | Partly. The track down the valley is turf tinted to earth, with no grass on it; the ground has a material of its own, a fine mat with earth in the low places, but still only the one. |
| Water | Still water is a mirror. The scene is drawn a second time as the water would show it, upside down, and laid on the surface, so the far bank, the trees and the mountains stand in the lake; the clouds, which are not things in the scene, are marched again along the reflected line of sight wherever the picture shows open sky. Two sets of ripples bend the picture a little. Water mirrors nearly everything at a glancing angle and little looked straight down on, and at its shallow edge it is clear, so the bed shows: gravel and mud, with rocks half in the water. A lake may have an island with a tree. Running water is the same water, moving. It is a ribbon laid down the course of its stream, falling as the bed falls and reaching on each side as far as the bank stands above it, so its edge is the bank's. It borrows the still water's picture, reading it where its own line of sight would meet the level sheet: far things then stand in it exactly, near ones a little out of place. (A valley with a stream and no pond keeps a mirror for the stream alone, which is never itself drawn.) Its ripples are longer down the current than across and travel down it at two speeds; it is shallow, so the bed shows all the way across: dark wet gravel, with cobbles lying in it and along its edges, which nobody trips on. Where the bed falls steeply the water breaks white. Where a stream meets a pond it comes to the pond's level, quietens, and fades out over the pond's own surface, so there is no line between them; it does the same at its spring and its sink. Low plants, and running water itself, are left out of the mirror's picture, which saves a tenth of the frame. Nothing has a wet edge, running water takes no shadow, and the mirror shows no haze. At the lowest level of detail still water mirrors the sky alone, and running water a sky and a dark line of land that are worked out, not seen. |
| Things built outdoors: fences, steps, bridges, jetties | A landing stage and a post-and-rail fence, in plain squared timber. No steps or bridges. |
| Haze and light shafts through the trees | Haze is in place. The fog does not yet know about the trees, so there are no shafts between them. |
| Keeping the cost down | Cards are sorted into blocks of ground so that those out of view are not drawn, and grass and flowers shrink away and stop being drawn beyond a distance set by the level of detail (40, 55 or 80 metres). Three levels of detail, chosen on the opening card, also set the pixel ratio, texture size, bake rays, bloom and the share of leaf cards drawn. Distant trees have fewer branches and fewer, larger cards. No impostors. On a desktop graphics card the frame rate sits at the browser's cap; a tablet has not been tried with the present scene. |

### What grows where

Nothing below the trees is scattered at random. The lie of the land is reduced to four numbers at every point, each from 0 to 1, and every plant is placed by them.

| Number | High where |
|---|---|
| Shade | Under the crowns of trees, and at the foot of the valley's southern rim, which faces away from the sun |
| Wet | On low ground, at the margins of water, and at the shaded foot of rock, where water gathers; less everywhere in a dry season |
| Wear | Along the track, before the door, and about the things people visit |
| Thin | On slopes and against rock, where the soil is shallow |

| Plant | Grows where | Why |
|---|---|---|
| Grass | Everywhere there is soil and light. Its height goes as `0.45 + 1.1 wet`, cut down by wear, deep shade and thin soil: from under 20 centimetres where it is trodden to about 75 by water | Long grass is moist open ground that nobody walks on; a lawn is trodden ground; under trees there is little of it |
| Reeds | In beds wherever the water is shallow and the bank low, from 30 centimetres above the water line to 60 below it, in patches, taller than a man, with heads of seed. The side the landing stage is on is left open | A pond is known from a distance by its reeds |
| Meadow grass | Over the turf grass, knee-high and close where the ground is moist and nobody walks; none where it is dry, trodden, dark or stony | With the turf grass under it the ground is covered, not dotted |
| Ivy | On the front of the house, from the foot of the wall upward, spreading as it climbs and narrowing to its tip, clear of doors and windows. A kept house has a little, a forsaken one is half covered; in autumn some has turned red | It is what a wall left alone grows first |
| Flowers | In sun, with some moisture, away from wear, in drifts | |
| Ferns | Shade above 0.45, where shade and wet together pass 0.85 | They take the place of grass on the woodland floor |
| Tall herbs | Open (shade under 0.3), wet above 0.5, good soil, in drifts | The rank growth of a damp meadow: by the pond and in the hollows |
| Heather and its like | Thin dry soil in sun | Low mounds against boulders and under the rim; in flower from summer |
| Thicket | Shade between 0.18 and 0.5: the edge of the wood | Bushes want the light of the open and the shelter of the trees, and get both at the margin. Young trees come up among them |
| Nettles and docks | The ground about a ruin | Where people lived the soil is rich |

The same numbers colour the grass: green where it is wet, straw where it is dry.

Leaves and blades must be matt. With the standard material every card mirrors the sky at a glancing angle, and a meadow seen from head height is all glancing angles: it turned pale and blue until the mirror term was removed.

## 2D maps

Maps are assets in their own right, for use in games, on virtual tabletops and in print, and they double as the in-tool navigation aid.

| Style | Description | Use |
|---|---|---|
| **Plan** | Clean technical drawing with optional overlays for zones, critical path, locks, fields and metrics | The workbench; debugging |
| **Ink** | Hand-drawn look: wobbly line, hatching around walls, simple symbols | Printable adventure maps |
| **Illustrated** | Parchment, shaded relief, drawn trees and roofs, labels | Handouts, site overviews |
| **Rendered** | Top-down orthographic render of the 3D scene with its lighting, roofs and ceilings removed | Battle maps for tabletop play |
| **Automap** | Minimal, revealed as explored | In the explorer |

Common to all styles:

- One sheet per storey (cellars, ground, upper floors, rooftops), plus a site overview for open-air sites with relief shading and contours.
- Layers that can be toggled and exported separately: ground, walls, objects, water, vegetation, grid, labels, secrets.
- A numbered key generated from the site document: each place's name, fiction and contents.
- Output as vector and raster images, with an optional grid at a chosen scale.
- Optional export of walls, doors and lights in a form virtual tabletops can import.

## Where the look stands

A first scene exists: a walled courtyard with an arcade and a well, and a doorway into a barrel-vaulted hall lit by four torches. It is assembled by hand from the kit of parts, which is the code the site mesher will call later.

| Proof | State |
|---|---|
| Procedural material with normal, roughness and height, blended by a field | Stone, wood and moss recipes; moss, damp and soot driven by fields and by the bake |
| Baked indirect light computed in the browser | Working, in web workers, shown progressively |
| Sun shadows, and shadowed local lights | Working; all shadow maps are drawn once because the world is static |
| Fog with visible shafts of light | Working, by marching view rays against a sun depth map |
| Target frame rate | Not measured: development so far has been on a software renderer without a graphics card |
| Site to mesh, built and natural | Working for rectangular rooms, courts and caves; the span grid itself is not built yet |
| Maps | Plan, ink and the automap are working, each drawn from the site document, and the rendered style is taken from the 3D scene. The illustrated style, layers and vector output are not started. |

Also in place: eye adaptation measured from the image, and first-person walking with collision.

Known weaknesses, in rough order of importance:

- The stone reads as clean and new. It needs stronger weathering, more variation between stones, and broken or missing pieces.
- Moss is a flat overlay. It should have its own relief and gather more convincingly in joints.
- Nothing is in the rooms: no doors, furniture, debris or plants.
- Torch flames are simple animated cards and there are no particles in the air.
- Bake time grows with the size of the place. It is seven times faster than it was, but a large site on a tablet is still a wait.

## What must be proven early

Before much generation is built on top, a hand-assembled test scene has to show the target look is reachable in a browser. Two scenes: a torchlit vaulted hall, and a courtyard under a low sun with a doorway into shadow.

1. A procedural material with convincing normal, roughness and height, blended by a field.
2. Baked indirect light that makes the hall and the arcade read as lit by bounce, computed in the browser in acceptable time.
3. Sun shadows outdoors and a few shadowed local lights indoors at the target frame rate.
4. Fog with visible shafts of light.
5. Span grid to mesh for both built and natural geometry, with no visible grid.
6. The same scenes drawn as a plan map and a rendered map.
