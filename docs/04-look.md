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

### Skin and solid

Visible geometry is only a skin: the faces a player can see, with nothing behind them. Light needs to know where the solid is, for two reasons found in practice.

- **Buried vertices.** Patches overlap at inside corners, so some vertices sit inside a wall or under a floor. Left alone they collect light from wherever their rays escape to, often the open sky, and it smears onto the visible surface next to them as a bright rim. The bake is given the solid volumes behind the skin; a vertex whose rays mostly hit solid mass or the backs of surfaces is treated as buried and takes its light from visible neighbours.
- **Thin shadows.** A skin shadows itself unreliably, so sunlight would catch stone edges inside a closed room. The same solid volumes are drawn into the sun's shadow map from their sunward side, which gives walls and roofs real thickness.

In the hand-assembled scene the solids are listed alongside the skin. In generated sites they come for free: the span grid already says which space is open and which is not.

**Solid things are closed things.** Any free-standing or projecting piece — a coping, a sill, a merlon, a step, a beam, a chest — is built with all six of its faces, including ones that seem hidden against a wall or floor. Leaving out faces "the player cannot see" was tried and was wrong twice: undersides of overhanging stones showed the sky through them. The few extra hidden faces cost little; a see-through stone costs the whole illusion.

Walls are cut exactly at openings. Vertices of a wall that fall inside an opening are moved to its edge, so the stones simply end there; a triangle is left out only if all its corners were inside, or if its corners were moved to opposite sides and it would stretch across. This matters most for a secret door, where no band of dressed stone hides the cut.

Two smaller measures keep the skin closed: every stone has a plain backing sheet just behind its mortar, slightly larger than the stone, so no pixel-wide gaps show between neighbours; and where a wall is cut for an opening, triangles touching the hole are left out and the dressed stones round the opening cover the edge.

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
| Ground cover: grass, flowers, low bushes | In place, as instanced cards with wind. Thin at the foot of the banks. |
| Trees with leafy crowns, several kinds, one in blossom | In place. Crowns are clouds of leaf cards shaded about a common centre; firs are tiers of bough cards. Trunks are plain, without branches. |
| Land running to the horizon | In place: a fine sheet over the valley and its rim, which can be walked, a coarse one out to 250 metres, and a ring of mountains to 750. |
| Rock: cliffs, outcrops, boulders, standing stones | Shaped and placed, with a rock material of its own: plates split by cracks, bedding and lichen. The shapes themselves are still smooth at the scale of a hand; the relief is all in the material. |
| Leaves lit from behind | In place. Light that has passed the shadow map is let through each card, strongest when the leaf is seen against the sun. |
| A worn earth path, and ground that is more than one texture | Partly. The track down the valley is turf tinted to earth, with no grass on it; the ground has a material of its own, a fine mat with earth in the low places, but still only the one. |
| Water | A pond: a level sheet, dark and nearly a mirror, with drifting ripples. It does not show the bed through shallow water, has no shoreline foam or wet edge, and no running water. |
| Things built outdoors: fences, steps, bridges, jetties | A landing stage and a post-and-rail fence, in plain squared timber. No steps or bridges. |
| Haze and light shafts through the trees | Haze is in place. The fog does not yet know about the trees, so there are no shafts between them. |
| Keeping the cost down | Cards are sorted into blocks of ground so that those out of view are not drawn, and grass and flowers shrink away and stop being drawn beyond a distance set by the level of detail (40, 55 or 80 metres). Three levels of detail, chosen on the opening card, also set the pixel ratio, texture size, bake rays and bloom. Distant trees have fewer, larger cards. No impostors. None of this has been measured on a real graphics card. |

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
