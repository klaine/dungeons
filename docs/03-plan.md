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
| Light baking | Ray tracing against the generated geometry, in workers or on the GPU | The world is static after generation |
| Textures | Procedural material recipes rendered on the GPU; scanned sets accepted | Seedable, variable, nothing to license |
| 2D maps | Canvas and SVG | Raster and vector output from the same code |
| Tests | Vitest, with property tests across many seeds | Invariants such as "always completable" need thousands of cases |

The renderer and baking choices are confirmed or changed by the look spike (M2) before anything depends on them.

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

Two things carry the most risk and the most value: the structure of the adventure, and the look. They are independent, so they are tackled first and side by side. Kinds of site are then added one at a time, each a full vertical slice.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| **M0** | Foundations | Project scaffold, seeded randomness, site document types, empty workbench shell, test harness | A seed in the URL produces a stable placeholder document |
| **M1** | Structure | Premise record, cyclic mission generator with four or five cycle patterns, lock and key solver, mission graph view, structural metrics | 1,000 seeds are all completable; graphs show nested loops, gating and shortcuts; metrics vary meaningfully across seeds |
| **M2** | Look spike | Two hand-assembled test scenes (torchlit hall; sunlit courtyard), span grid to mesh, first procedural materials, baked and real-time lighting, fog, plan and rendered maps of both | The six proofs in document 4 are met at the target frame rate, or the approach is changed |
| **M3** | First delve | Topology, layout and geometry for an underground site; walkable in 3D with doors and keys; plan map and automap | A generated delve can be played from entrance to goal, and the Fork, Return and Question tests can be judged by walking it |
| **M4** | Biomes and history | Biome definitions as data, built and natural generators, fields, field-driven materials, two or three enclosed biomes with transitions, dressing, the lighting layer | Zones are distinguishable at a glance; damp, age and wear are visible and make sense; the Touch test passes |
| **M5** | Open air | Setting layer, terrain, sky and weather, vegetation, the wild-place grammar, hard and soft edges, viewshed planning, entrances between outside and underground | A ruin in a forest with a delve beneath can be walked end to end; the Approach test passes |
| **M6** | Strongholds and settlements | Castle and town grammars, storeys, roofs, shells and interiors, wall-walks, rooftops and cellars as layers | A castle above its village can be generated and entered by more than one route |
| **M7** | Wonder | State-change cycles, systemic puzzle elements, blueprints, secrets with tells, signature set pieces, the surprise budget, more biomes | The "Wait, what?" test passes; each site has a describable signature |
| **M8** | Judgement | Batch runner, expressive range plots, generate-and-select, candidate gallery | The Second seed test passes routinely; weak seeds are filtered before the user sees them |
| **M9** | Assets | Ink and illustrated map styles, layered map export, glTF export, versioned document schema, a minimal example of loading a site in a game engine | A generated site and its maps are usable outside the tool |

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
- **Visual direction.** Physically based materials with normal maps, and lighting treated as a first-class part of generation.
- **Range.** Any place of adventure: underground, castles, towns and open country.

### Still open

Defaults are what the plan currently assumes.

1. **Texture sourcing.** Default: procedural materials first, with scanned sets accepted where a recipe falls short. The alternative is to lean on scanned libraries from the start, which looks good sooner but varies less and adds download weight.
2. **Hardware floor.** Default: desktop browsers on a mid-range laptop at 60 frames per second, with a lower tier for integrated graphics. Phones are not targeted.
3. **What the eventual game does.** Default: exploration and puzzles, with threats as abstract placeholders. Combat would add needs to population and to space (arenas, cover).
4. **Camera.** Default: first person, plus a fly-over. Third person would add a character and constrain tight interiors.
5. **Site size.** Default: a 20 to 40 minute site, up to a few hundred metres across. Much larger sites would bring streaming and level-of-detail work forward.
