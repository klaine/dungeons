# 3. The tool and the plan

## What we are building

A browser tool that generates places for adventure — delves, strongholds, settlements, wild places and composites of them — and presents each as a 3D world to walk through and as 2D maps.

**The workbench** is for making sites and understanding why they came out as they did.

- Seed and brief controls; presets; a shareable URL per site
- A view per pipeline layer: premise card, mission graph, space graph, plan map
- Map overlays: zones and biomes, critical path, locks and keys, intensity, fields, sightlines
- Re-roll a single layer while holding the others fixed
- A metrics panel, and a gallery of candidates to compare

**The explorer** is for being there.

- First-person 3D in WebGL with physically based materials, baked and real-time lighting, fog and weather
- Working doors, keys, mechanisms and state changes
- A fly-over camera for seeing the whole site
- An automap that fills in as the player explores

**The assets** are what leaves the tool.

- 2D maps in several styles, per storey, with layers and a numbered key
- The 3D scene as glTF with its materials
- The site document as JSON, carrying the structure a game needs: places, ways, locks, roles

The workbench matters as much as the explorer. Generators are tuned by looking at many outputs and at every intermediate layer; without that visibility quality stalls.

## Scope

In scope for the first version: a single site with a walkable extent up to a few hundred metres across, 15 to 60 places, one to four storeys and two to four biomes; exploration and puzzle gating.

Out of scope for now: combat systems, character progression, multiplayer, a continuous overworld joining sites, authored narrative text, mobile browsers. Threats and inhabitants exist in the data model as abstract placeholders with an intensity value, so a game can interpret them later.

## Technology

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Data-model heavy; types are the schema |
| Build | Vite | Fast iteration, static output |
| Hosting | Static site, no backend | Everything runs in the browser; a seed is the save file |
| Generator core | Pure TypeScript, no DOM | Runs in a web worker, and in Node for tests and batch analysis |
| Randomness | Seeded generator, one stream per layer | Determinism, independent re-rolls |
| 3D | three.js on WebGL 2, with custom shaders for materials | Mature, large ecosystem, glTF export, full control of the shading |
| Light baking | Ray tracing against the generated geometry in web workers, stored per vertex | The world is static after generation; dense geometry makes vertices a fine enough carrier |
| Textures | Procedural material recipes rendered on the GPU; scanned sets accepted | Seedable, variable, nothing to license |
| 2D maps | Canvas and SVG | Raster and vector output from the same code |
| Tests | Vitest, with property tests across many seeds | Invariants such as "always completable" need thousands of cases |

The renderer and baking choices are being proven by the look milestone (M1) before anything depends on them.

Proposed layout, one package with enforced boundaries:

```
src/
  core/        generator; no DOM, no rendering imports
    rng/  premise/  setting/  mission/  topology/  layout/  geometry/
    history/  population/  dressing/  lighting/  critique/  model/
  content/     data: biomes, site grammars, archetypes, cycle patterns, blueprints, materials
  render/      meshing builders, material shaders, light baking, scene assembly
  maps/        map styles
  export/      json, gltf, images
  app/         workbench and explorer UI
tools/         batch runs, expressive range analysis
docs/
```

## Milestones

3D comes first. The look is proven on hand-assembled scenes before any generator exists, so that the visual target is real and every later milestone is judged in the world it will ship in. Structure follows, and then kinds of site are added one at a time, each a full vertical slice.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| **M0** | Foundations | Project scaffold, seeded randomness, first-person explorer shell | A seed in the URL produces the same world every time. **Done.** |
| **M1** | Look | Hand-assembled test scenes (sunlit courtyard and arcade; torchlit vaulted hall) built from the kit of parts, procedural materials, baked and real-time lighting, fog with light shafts, eye adaptation | The proofs in document 4 are met at the target frame rate, or the approach is changed. **Done** for the first pass: ran at 30 to 38 frames a second on an M1 iPad Pro, and natural rock is in. |
| **M2** | First generated site | Site document, a first generator (rooms in a loop round a court, entered from a forecourt), a mesher from site to stone, a walk test of every way, a plan map | Any seed gives a different place that can be walked end to end. **Done**, in its first small form. |
| **M3** | Structure | Premise record, cyclic mission generator with four or five cycle patterns, locks and keys with working doors, a solver, mission graph view, structural metrics | 1,000 seeds are all completable; graphs show nested loops, gating and shortcuts; metrics vary meaningfully across seeds. **Mostly done:** several plan shapes, locks, keys, barred doors, a solver, a goal, a simple setting and selection among candidates are in. There is no graph view yet, the premise is only stone, hour and name, and the cycle patterns are fixed plans, not a general grammar. |
| **M4** | Biomes and history | Biome definitions as data, built and natural generators, fields, field-driven materials, two or three enclosed biomes with transitions, dressing, the lighting layer | Zones are distinguishable at a glance; damp, age and wear are visible and make sense; the Touch test passes. **Started:** rooms have uses and furniture, the house has a condition, and a forsaken one has lost a roof. Biomes are not yet data, and there are no zones within a site. |
| **M5** | Open air | Setting layer, terrain, sky and weather, vegetation, the wild-place grammar, hard and soft edges, viewshed planning, entrances between outside and underground | A ruin in a forest with a delve beneath can be walked end to end; the Approach test passes |
| **M6** | Strongholds and settlements | Castle and town grammars, storeys, roofs, shells and interiors, wall-walks, rooftops and cellars as layers | A castle above its village can be generated and entered by more than one route |
| **M7** | Wonder | State-change cycles, systemic puzzle elements, blueprints, secrets with tells, signature set pieces, the surprise budget, more biomes | The "Wait, what?" test passes; each site has a describable signature |
| **M8** | Judgement | Batch runner, expressive range plots, generate-and-select, candidate gallery | The Second seed test passes routinely; weak seeds are filtered before the user sees them |
| **M9** | Assets | Ink and illustrated map styles, layered map export, glTF export, versioned document schema, a minimal example of loading a site in a game engine | A generated site and its maps are usable outside the tool. **Started:** the site document exports as JSON, the plan as a PNG with a key to its rooms, and the built world as a glTF model. Other map styles and an engine example are not done. |

## Where things stand

- **Generated sites.** A seed produces a walled house of five to twelve rooms with a forecourt in front and a sanctum at the far end. The plan is one of several arrangements of loops: a ring, a ring round a cloister court, two rings side by side, two rings one behind the other, or rooms off a central gallery joined along the flanks. Any of them may leave one room on a loop open to the sky as a court to cross. Side chambers hang off the loops, some two deep. Rooms vary from narrow passages to halls, floors step up and down through the doorways, and roofs are stone vaults or timber. Structure is built from cycles from the start, so most sites have two or more loops. Every place is still a rectangle.
- **Rooms with a use.** Larger rooms are given a purpose — refectory, dormitory, chapter house, kitchen, store, workshop, scriptorium — and furnished for it from closed blocks of planking: tables and benches, rows of beds, barrels, crates, shelves, desks. A piece is set down only where it is clear of doorways and of everything already placed, and only if every doorway in the room can still be reached from every other; that last check is what keeps furniture from walling off a route.
- **Condition.** A house is kept, damp or forsaken. Damp raises the wet line on the walls. A forsaken house has lost about two fifths of its furniture and one of its roofs: that room lies open to the sky, overgrown, with the fallen blocks still on the floor.
- **Setting.** Each seed fixes what the house is built of (limestone, sandstone, greystone or basalt), the time of day (morning, midday or evening, which sets the sun's height, direction and colour and the sky's), and what it is called. The stone tints all masonry and the rock of any cave.
- **Best of several.** Six sites are drafted for each seed and the one with the richest structure is kept, scored on loops, how much longer the true route is than the direct one, keys, a barred door, a court, a cave, a sensible number of dark rooms and variety of roofs. After selection nearly every site has two or more loops and most have two keys.
- **Caves.** About two in five sites have a dead-end chamber that is not a room at all but a natural cave the builders broke into and walled off: rock walls, floor and ceiling carved from a density function, a door set in a patch of masonry, and no light but the player's own. Keys can be hidden in them.
- **The mission.** Each site is given something to overcome. The sanctum is locked and wants a gold key, which is hidden somewhere that takes finding, by preference a dead end and sometimes a dark one. About half the time that room is itself locked with an iron lock, with the iron key elsewhere. About a third of the time one way out of the entrance hall cannot be passed at first, and becomes a shortcut once the player has gone round. It is either a door barred on its far side, or a portcullis whose lever stands just beyond it: the player can see through the bars into the room they cannot yet enter. The lever is the first thing in the game that changes somewhere else when used. Other doorways are hung with doors standing open or shut, or left as plain arches.
- **Proof of completion.** A solver searches over where the player is, which keys they hold, which bars they have lifted and which levers they have thrown, and every generated site must have a solution or it is rejected. Nothing the player does can be undone, so a site that can be completed from the start can be completed from anywhere.
- **Play.** Everything is done by walking: coming up to a door tries it, walking up to a key takes it, reaching the chest in the sanctum ends the run. Lock plates are the colour of their key.
- **Checks.** A batch tool (`npx tsx tools/sites.ts`) generates hundreds of sites and confirms each is connected, can be completed, and has no doorway too steep for its stairs. In the browser, a walk test moves the player's body through every door and arch in both directions, and a playthrough test follows the solver's route with the player's body, letting doors and keys respond as in play.
- **Export.** From the Export menu: the site document as JSON (with the solver's route), the plan as a PNG with a numbered key, and the 3D model as a binary glTF with its textures and stone tints. The model reloads through the standard glTF loader with every mesh intact; a ten-room site is about 45 MB. Baked light is not in the model.
- **Map.** A plan of the site is drawn from the same document and shown as a minimap. It fills in as the player explores: places entered are drawn in full, places seen through an open doorway are sketched, the rest is left off. Shut doors and keys seen but not taken are marked.
- **Light and dark.** Each place is lit by day, by torches, or deliberately left dark; the player carries a small light for the dark ones. The plan map shades unlit rooms.
- **Lighting many rooms.** Four shadow-casting lights are shared among all torches and follow the player; rooms further off are lit by baked bounce light only until the player comes near.
- **The hand-built scene** is kept as a fixed test bed for the look, at `?scene=test`.

## Risks

| Risk | Mitigation |
|---|---|
| The target look is not reachable at an acceptable frame rate in a browser | The look spike comes second, before generation depends on rendering decisions; quality tiers; baking instead of per-frame cost |
| Baking light takes too long after each generation | Progressive refinement while the player walks; cheaper storage first; bake per zone and reuse when only dressing is re-rolled |
| Procedural materials look synthetic | Start with a few and make them excellent; keep the path for scanned texture sets open |
| Embedding looped graphs in space fails or produces stretched layouts | Coarse-grid embedding with early rejection; layout-aware cycle patterns; cheap retries |
| Open terrain does not hold the graph: players walk around the structure | Hard and soft edges generated from the graph; a walkability check outdoors as a hard constraint |
| Castles and towns need far more authored content than delves | One kind per milestone; shells for most buildings; a parameterised kit of parts shared across cultures |
| Output is valid but samey | Expressive range analysis from M1 onwards; premise, setting and signature drive differences top-down |
| Metrics are optimised and the result gets worse | Treat metrics as filters for bad output; tune against human judgement of walked sites |
| History passes break completability | Mission edges are protected or become the cause of locks; the solver runs after every mutating layer |
| Scope | Each milestone is a complete slice that can be judged; later kinds of site can be deferred without wasting earlier work |

## Decisions

### Settled

- **Presentation.** A 3D world in WebGL, plus 2D maps as assets in their own right.
- **Order.** 3D first. The look is built and proven before the generator.
- **Visual direction.** Physically based materials with normal maps, and lighting treated as a first-class part of generation. Not a low-poly style: geometry is dense, and anything that should catch light on an edge is modelled rather than faked.
- **Range.** Any place of adventure: underground, castles, towns and open country.

### Still open

Defaults are what the plan currently assumes.

1. **Texture sourcing.** Default: procedural materials first, with scanned sets accepted where a recipe falls short. The alternative is to lean on scanned libraries from the start, which looks good sooner but varies less and adds download weight.
2. **Hardware floor.** Default: desktop browsers on a mid-range laptop at 60 frames per second, with a lower tier for integrated graphics. Phones are not targeted.
3. **What the eventual game does.** Default: exploration and puzzles, with threats as abstract placeholders. Combat would add needs to population and to space (arenas, cover).
4. **Camera.** Default: first person, plus a fly-over. Third person would add a character and constrain tight interiors.
5. **Site size.** Default: a 20 to 40 minute site, up to a few hundred metres across. Much larger sites would bring streaming and level-of-detail work forward.
