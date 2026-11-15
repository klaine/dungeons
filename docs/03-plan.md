# 3. The tool and the plan

## What we are building

A browser tool with two faces over one generator.

**The workbench** is for making dungeons and understanding why they came out as they did.

- Seed and brief controls; presets; a shareable URL per dungeon
- A view per pipeline layer: premise card, mission graph, space graph, 2D map
- Map overlays: zones and biomes, critical path, locks and keys, intensity, fields, sightlines
- Re-roll a single layer while holding the others fixed
- A metrics panel, and a gallery of candidates to compare

**The explorer** is for being in the dungeon.

- Walk it with fog of war, working doors, keys, mechanisms and state changes
- 2D top-down first, then first-person 3D with light, fog and height
- The automap fills in as the player explores

**Export** makes the result usable elsewhere: the dungeon document as JSON, a map image, a 3D mesh (glTF) and tilemaps.

The workbench matters as much as the explorer. Generators are tuned by looking at many outputs and at every intermediate layer; without that visibility quality stalls.

## Scope

In scope for the first version: a single dungeon site of roughly 15 to 60 rooms on one to four levels, two to four biomes, exploration and puzzle gating.

Out of scope for now: combat systems, character progression, multiplayer, an overworld, authored narrative text. Threats exist in the data model as abstract placeholders with an intensity value, so a game can interpret them later.

## Technology

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Data-model heavy; types are the schema |
| Build | Vite | Fast iteration, static output |
| Hosting | Static site, no backend | Everything runs in the browser; a seed is the save file |
| Generator core | Pure TypeScript, no DOM | Runs in a web worker, in Node for tests and batch analysis |
| Randomness | Seeded generator, one stream per layer | Determinism, independent re-rolls |
| 2D views | Canvas | Simple, fast, good for overlays |
| 3D view | three.js | Mature, large ecosystem, glTF export built in |
| Tests | Vitest, with property tests across many seeds | Invariants such as "always completable" need thousands of cases |

Proposed layout, one package with enforced boundaries:

```
src/
  core/        generator; no DOM, no rendering imports
    rng/  premise/  mission/  topology/  layout/  geometry/
    history/  population/  dressing/  critique/  model/
  content/     data: biomes, archetypes, cycle patterns, blueprints
  export/      json, gltf, tilemap, image
  app/         workbench and explorer UI
    views/  explore2d/  explore3d/
tools/         batch runs, expressive range analysis
docs/
```

## Milestones

Structure comes first, on purpose. A dungeon with a great graph and plain rectangles is fun; a beautiful dungeon with a dull graph is not. Each milestone ends with something that can be looked at and judged.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| **M0** | Foundations | Project scaffold, seeded randomness, dungeon document types, empty workbench shell, test harness | A seed in the URL produces a stable placeholder document |
| **M1** | Structure | Premise record, cyclic mission generator with four or five cycle patterns, lock and key solver, mission graph view, structural metrics | 1,000 seeds are all completable; graphs show nested loops, gating and shortcuts; metrics vary meaningfully across seeds |
| **M2** | Space | Topology, coarse-grid layout, rectangular rooms and corridors on the cell grid, 2D map with overlays, top-down exploration with fog of war, doors and keys | A dungeon can be played from entrance to goal in 2D, and the Fork, Return and Question tests can be judged by hand |
| **M3** | Biomes | Biome definitions as data, built and natural geometry generators, fields, two or three biomes with transitions, dressing and 2D lighting | Zones are distinguishable at thumbnail size; a cave reads as a cave and a crypt as a crypt |
| **M4** | Depth | Height in the grid, meshing, first-person 3D exploration with lights and fog, overlooks and vistas | The Postcard test can be passed; an overlook cycle works as intended |
| **M5** | Wonder | State-change cycles, systemic puzzle elements, blueprints, secrets with tells, signature set pieces, the surprise budget, more biomes | The "Wait, what?" test can be passed; each dungeon has a describable signature |
| **M6** | Judgement | Batch runner, expressive range plots, generate-and-select, candidate gallery | The Second seed test passes routinely; weak seeds are filtered before the user sees them |
| **M7** | Assets | Versioned document schema, glTF and tilemap export, a minimal example of loading a dungeon in a game engine | A generated dungeon runs outside the tool |

A short 3D spike during M2 is planned to confirm the cell-grid representation meshes well before much is built on it.

## Risks

| Risk | Mitigation |
|---|---|
| Embedding looped graphs in space fails or produces ugly, stretched layouts | Coarse-grid embedding with early rejection; keep cycle patterns layout-aware; accept retries since early layers are cheap |
| Output is valid but samey | Expressive range analysis from M1 onwards; premise and signature set pieces drive differences top-down |
| Metrics are optimised and the result gets worse | Treat metrics as filters for bad output; tune against human judgement of walked dungeons |
| History passes break completability | Mission edges are protected or become the cause of locks; the solver runs after every mutating layer |
| Too much authored content is needed | Start with few, well-made pieces; composition axes multiply them |
| 3D look falls short without art assets | Lean on lighting, fog, silhouette and flat-shaded stylisation, which suit procedural geometry |

## Open decisions

These shape the plan and are worth settling before M2. Defaults are what the plan currently assumes.

1. **How should exploration feel?** Default: both, 2D top-down first and first-person 3D from M4. A 3D-first route is possible but slows structural iteration.
2. **What is the target for game assets?** A specific engine (Godot, Unity, a web game on three.js) decides which exports matter. Default: engine-neutral JSON plus glTF.
3. **Visual direction?** Default: stylised, flat-shaded low-poly carried by lighting and atmosphere, with no dependence on texture art. Alternatives are pixel-art tiles or a more realistic look.
4. **What does the eventual game do?** Exploration and puzzles only, or combat too? Default: exploration first, with threats as abstract placeholders.
5. **How big is a dungeon?** Default: a 20 to 40 minute site of 15 to 60 rooms. Sprawling megadungeons or multi-site worlds would move layout and streaming concerns earlier.
