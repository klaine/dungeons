# 4. The look: 3D world and 2D maps

The site document from the generator is turned into two kinds of visual asset: a 3D world to walk through in the browser, and 2D maps. This document defines the target for both and the approach to reaching it.

## Target

A first-person 3D world in WebGL with physically based materials, normal-mapped surfaces and lighting good enough that screenshots are worth taking. Grounded and believable in its materials, heightened in its lighting and colour.

The standard to hold: **a generated place should not look generated.** No visible grid, no visibly repeating texture, no uniform lighting, no flat walls meeting at perfect corners.

## Principles

1. **Light first.** Lighting is the largest single contributor to how good a scene looks, and the one most often left as an afterthought in generated worlds. It gets its own pipeline layer and its own budget.
2. **Form before surface.** Normal maps add grain, not shape. Edges need bevels, walls need plinths and cornices, blocks need to sit slightly proud or shy of each other, rubble gathers at the foot of a ruin. Silhouette is geometry's job.
3. **Fields drive surfaces.** The history layer already knows where it is damp, old, hot, overgrown and well-trodden. Those fields choose and blend materials, which is what ties the look to the place's story.
4. **Hide the machine.** Break up tiling, vary instances, jitter what would be regular, and never let the underlying grid show.
5. **One document, many views.** The 3D world and every map style are rendered from the same data and always agree.

## Geometry: from spans to meshes

The span grid is logical. Separate builders turn it into visible geometry, selected by each zone's origin.

| Builder | Input | Output |
|---|---|---|
| **Terrain** | Open-air spans, material weights | Continuous ground surface with level of detail; cliffs given real rock faces rather than stretched slopes |
| **Architecture** | Built spans, storeys, openings | Walls with thickness, floors, vaults and ceilings, stairs, roofs derived from footprints |
| **Natural rock** | Hewn and natural enclosed spans | Smooth irregular surfaces extracted from a density field, so caves have curves and overhangs |
| **Kit of parts** | Sockets from archetypes and openings | Arches, columns, door and window frames, battlements, beams, railings |
| **Vegetation** | Growth field, flora rules | Trees grown procedurally, undergrowth and ground cover as instances, ivy and roots following surfaces |
| **Ruin** | Decay field, events | Broken wall tops, missing roofs, fallen blocks, rubble |
| **Water** | Water level and flow from history | Surfaces for pools, rivers and flooded spans |

The kit of parts is itself procedural and parameterised by builder culture, so one arch recipe yields a pointed arch for one culture and a round one for another. Seams between builders (a cave breaking into a cellar, a wall founded on rock) are handled explicitly, since those borders are where sites are most interesting.

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

How the bake is stored (per vertex, in lightmaps or in a probe grid) is the main technical question for the look and is settled by experiment early; see "What must be proven early".

### Atmosphere and finish

- Fog with depth and height, lit by the sun and by local lights, so shafts of light are visible in dusty and misty air.
- A physically based sky, with the same sky lighting the scene.
- Particles as part of each biome: dust motes, spores, embers, rain, snow, insects, drifting leaves.
- Water with reflection, refraction, depth colour and caustics on nearby surfaces.
- Bloom on what glows, contact shadows in corners, film-like tone mapping, and a colour grade per biome so each has its own palette on screen.

### Light as a design tool

Lights are placed by the generator for reasons (see the lighting layer in document 2): to pull the player forward, to leak information at a fork, to mark what matters, to make a sanctuary feel safe. Darkness is used as deliberately as light. A scene lit evenly everywhere is a failed scene.

## Performance

The target is a steady 60 frames per second in a desktop browser on a mid-range laptop, with quality tiers above and below.

- **The space graph is the visibility structure.** Places and ways are rooms and portals, so what cannot be seen is cheaply skipped underground and indoors.
- Static geometry merged per zone; repeated things (props, plants, kit parts, rubble) drawn as instances.
- Levels of detail for terrain, vegetation and distant buildings.
- Generation and baking in background workers so the view stays responsive.
- Textures generated at the resolution the tier calls for.

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

## What must be proven early

Before much generation is built on top, a hand-assembled test scene has to show the target look is reachable in a browser. Two scenes: a torchlit vaulted hall, and a courtyard under a low sun with a doorway into shadow.

1. A procedural material with convincing normal, roughness and height, blended by a field.
2. Baked indirect light that makes the hall and the arcade read as lit by bounce, computed in the browser in acceptable time.
3. Sun shadows outdoors and a few shadowed local lights indoors at the target frame rate.
4. Fog with visible shafts of light.
5. Span grid to mesh for both built and natural geometry, with no visible grid.
6. The same scenes drawn as a plan map and a rendered map.
