# 2. How to generate it

This document defines the generation approach: principles, the pipeline, the pieces that get combined, the data model and how quality is measured. "Dungeon" and "site" are used interchangeably for any place of adventure: delve, stronghold, settlement, wild place or a composite of these.

## Principles

1. **Intent flows down, detail flows up.** Decide what the place is and what the player does there before placing a single wall. Geometry serves structure; structure serves premise.
2. **Author the vocabulary, generate the sentences.** People hand-author small reusable pieces — structural patterns, site grammars, room archetypes, biome definitions, material recipes, set-piece blueprints. The generator composes them. Quality comes from the pieces; variety comes from the combination.
3. **Build it, break it, move in.** Generate the place as its builders made it, then apply history (collapse, flood, growth, weather), then let inhabitants adapt it. Order of generation mirrors order of events, which is why the result reads as a place with a past.
4. **Graph first, even outdoors.** Every site is a graph of places joined by ways. Underground the walls enforce it. In the open, terrain and construction are generated to enforce it.
5. **Guarantee by construction, verify by solver.** Structure is generated so that it is completable, and then a solver checks anyway. Nothing ships that cannot be finished.
6. **Generate many, keep the best.** Early layers are cheap. Produce hundreds of candidate structures, score them, and spend expensive work only on survivors.
7. **Surprise is budgeted.** Norms are established per site and per biome; a small explicit budget is spent on violating them.
8. **Everything is deterministic and inspectable.** One seed reproduces one site. Every layer is a data artefact that can be viewed, saved and re-rolled independently.
9. **Logic is separate from looks.** The site is a renderer-independent document. The 3D world, the 2D maps and a game-engine export are all views of the same data.

## The pipeline

Each layer consumes the layers above and produces a data artefact. Each derives its own random stream from the master seed and its layer name, so re-rolling the dressing does not disturb the layout.

| # | Layer | Question it answers | Output | Main techniques |
|---|---|---|---|---|
| 0 | **Brief** | What was asked for? | Kind of site, size, tone, biome preferences, constraints | User input, presets |
| 1 | **Premise** | Who built it, what happened, who is here now? | Builders, purpose, events, occupants, biome arc, the signature set piece, the twist | Weighted tables, tag grammar |
| 2 | **Setting** | Where does it sit in the world? | Parts of the site and their kinds, landform, climate, sky, the site boundary | Landform templates, coarse terrain sketch |
| 3 | **Mission** | What does the player do, in what order? | Graph of beats with locks, keys and pacing targets | Cyclic generation, graph rewriting |
| 4 | **Topology** | Which places exist and how do they connect? | Space graph: places, ways, zones, storeys | Site grammars, pattern expansion |
| 5 | **Layout** | Where is each place in space? | Footprints, positions, elevations, fitted to terrain | Coarse-grid embedding, least-cost paths, constraint relaxation |
| 6 | **Geometry** | What is the exact shape? | Terrain and the span grid: floors, ceilings, walls, openings, roofs | Per-origin generators: shape grammar, cellular automata, noise, erosion, agents |
| 7 | **History** | What did time do to it? | Fields (moisture, heat, decay, growth, wear), collapse, water, vegetation | Field simulation, flow, growth algorithms |
| 8 | **Population** | What is in it that matters to play? | Doors, keys, mechanisms, puzzles, threats, rewards, secrets | Role-driven placement, distance maps, blueprints |
| 9 | **Dressing** | What fills and covers it? | Props, vegetation, material assignments, vignettes, ambience | Field-driven scatter, local pattern synthesis |
| 10 | **Lighting** | How is it lit? | Light sources placed for play and mood, sky settings, baked light | Role-driven placement, light baking |
| 11 | **Critique** | Is it valid, and is it good? | Pass or fail, metrics, annotations | Solver, graph and visibility analysis |
| 12 | **Export** | How is it consumed? | Document, 3D scene, 2D maps | Meshing, serialisers, map renderers |

Geometry meshing, materials, lighting and map rendering are described in [document 4](04-look.md).

### Premise

The premise is a small structured record, not prose. It picks a builder culture and purpose, one or two historical events, current occupants, the biome arc, one signature set piece (the thing this site will be remembered for) and optionally a twist. Every later layer reads it: purpose selects room and building types, events select conditions and locks, occupants select population, the signature gets reserved space in the layout.

A templated one-sentence description is generated from it. If the sentence is dull, the site probably will be, which makes the premise the cheapest place to reject a candidate.

### Setting

The setting places the site in a landscape and decides what it is made of.

- **Parts.** A site has one or more parts, each of one kind: "a keep on a crag", "the village below it", "the caves beneath". Parts become groups of zones, each generated by its kind's grammar and joined to the others by ways.
- **Landform.** Hilltop, valley floor, cliff edge, river bend, coast, forest interior. A coarse terrain sketch fixes high ground, water and the direction of approach.
- **Climate and sky.** Season, weather and time of day, which later drive vegetation, weathering and the light regime.
- **Boundary.** What ends the site on each side, in the fiction: sea, cliff, river, forest wall, fog.

Wholly underground sites have a trivial setting: an entrance and nothing else.

### Mission, built from cycles

This is the heart of the approach and follows Joris Dormans' cyclic generation, the technique behind *Unexplored*.

A site is not built from rooms. It is built from **cycles**: two paths between a start and a goal, where the relationship between the paths is the gameplay. Loops are therefore not added afterwards; they are the unit of construction.

| Cycle pattern | Path A | Path B | Experience |
|---|---|---|---|
| **Lock and key** | Short, ends at a locked door seen early | Long, holds the key | Carrying a question; a plan when the key appears |
| **Shortcut** | Long and dangerous | Short, opens only from the far side | Folding the map; mastery |
| **Two ways** | Dangerous and direct | Safe and long, or hidden | An informed choice |
| **Tease** | A view of the reward across a gap | The route that eventually reaches it | Anticipation |
| **Overlook** | A high place above the arena | The descent into it | Planning from prospect |
| **Hidden bypass** | The obvious hard route | A secret that skips it | Reward for attention |
| **State change** | A route that is closed | A mechanism elsewhere that opens it and closes another | Rereading known space |
| **Gauntlet and return** | A one-way plunge | The climb back out | Commitment |

Generation starts from one top-level cycle (entrance to goal) and repeatedly rewrites: a path segment is replaced by a nested cycle, a place is expanded into a hub with spokes, a lock is strengthened by putting its key behind another lock. Rewrites are chosen to meet the brief's size and the pacing target. Each node carries a beat role (tease, test, rest, reward, reveal, climax) and an intensity value, which later layers honour.

Key and lock dependencies form a partial order. By always placing a key in a region reachable without its own lock, the mission is completable by construction.

Cycle patterns do not know what kind of site they are in. Each site grammar supplies the realisation:

| Pattern | In a delve | In a stronghold | In a settlement | In the wild |
|---|---|---|---|---|
| Lock and key | Sealed door, key in a side crypt | Portcullis, winch in the gatehouse above | Locked guildhall, key with the absent warden | Raised drawbridge at the gorge, mechanism on the far bank |
| Shortcut | Gate barred from the far side | Postern unbolted from within | Cellar door onto the back alley | Rope ladder dropped from a ledge |
| Overlook | Balcony over a hall | Wall-walk above the ward | Rooftop above the square | Ridge above the valley floor |
| Hidden bypass | Secret passage behind a tomb | Sewer outflow under the curtain wall | Attics joined across the row | Sea cave at low tide |
| Tease | Treasure seen through a grille | The keep across the moat | A lit window in a shut house | The ruin on the island |

### Topology and site grammars

The mission graph says what happens; the space graph says where. They are not the same graph. One mission beat may become several places, several beats may share one, and extra places are added for texture: connectors, vestibules, side chambers, yards, clearings, secrets.

The space graph is made of **places** and **ways**, and a grammar per kind of site decides which exist:

| Kind | Grammar | Places | Ways | Natural locks |
|---|---|---|---|---|
| Delve | Cycles expanded into rooms and passages | Rooms, chambers, galleries | Corridors, stairs, shafts, squeezes | Doors, collapses, water, darkness |
| Stronghold | Wards nested around a keep, towers along the walls, gatehouses on the ways between | Wards, towers, halls, the keep, cellars | Gates, wall-walks, stairs, posterns | Gates, portcullises, drawbridges, height |
| Settlement | Streets grown from gates and landmarks, blocks divided into plots, landmark buildings on squares | Squares, streets, yards, enterable buildings | Streets, alleys, bridges, rooftops, sewers | Walls, gates, private doors, the river |
| Wild place | Points of interest joined by trails over the terrain | Clearings, summits, shores, ruins, groves | Trails, fords, passes, ledges | Cliffs, water, thickets, weather |

Zones are assigned here. Contiguous groups of places become districts, each with a biome from the premise's arc, a landmark and edges between them. Zones also carry a storey: rooftops, ground and cellars are separate layers of the graph joined by stairs, ladders, drops and hatches.

**Which buildings can be entered.** In a settlement or stronghold, buildings with a mission role, landmarks and a share of the rest get full interiors. Others are shells: correct from outside, closed in the fiction. This keeps the cost of a town bounded and makes an open door mean something.

### Layout

Layout places the graph in space, in two steps:

1. **Coarse placement** on a low-resolution grid, where each cell holds one place or connector and edges link adjacent cells. This makes planar embedding of loops tractable and gives an early, cheap rejection point.
2. **Refinement**: each coarse cell is given a footprint and an elevation according to its archetype and intensity (rest places small and enclosed, set pieces vast), then positions are relaxed to close gaps and align connections.

Where there is terrain, site and terrain negotiate. Strongholds claim high ground, settlements follow water and roads, trails follow least-cost paths between points of interest, and the terrain is then adjusted to the site: platforms levelled, terraces cut, a ditch dug where the wall needs one.

Verticality is assigned deliberately at this stage: overlook cycles need height differences, descents follow the biome arc, and the signature set piece gets the largest volume or the highest ground.

### Open space

In open terrain nothing forces the graph, so the terrain is built to express it.

- **Ways become landscape.** Every edge of the space graph is realised as something walkable and visible: a trail, a ford, a pass, a causeway, a street.
- **Non-edges become landscape too.** Where two places are close but not connected, something is put between them: a cliff, water, a wall, a thicket.
- **Hard and soft edges.** Hard edges cannot be crossed. Soft edges can, at a cost: slow ground, lost sight, no trail. Soft edges make open sites feel free while still shaping where players go, and they are where hidden bypasses live.
- **Sightlines are planned.** Landmarks and the goal are placed where they can be seen from the approach and from hubs, and checked by computing viewsheds. Terrain folds and tree cover are added where mystery is wanted.

### Geometry

Geometry generators are selected by the biome's **origin** axis. Each fills a footprint and honours its required openings.

| Origin | Generator | Character |
|---|---|---|
| Built | Shape grammar: symmetric subdivision, colonnades, alcoves, storeys, roofs from footprints | Regular, legible, proportioned |
| Hewn | Agent tunnelling with rough-regular galleries and props | Functional, following seams |
| Natural, enclosed | Cellular automata and noise blended with a flow-carved streamway | Organic, varied scale |
| Natural, open | Layered noise shaped by the setting's sketch, then erosion and flow | Ridges, valleys, drainage that makes sense |
| Grown | Branching growth (space colonisation, aggregation) | Soft, tendril-like; also trees and roots |
| Wrong | Any of the above with broken parameters | Unsettling |

Archetypes sit above these: a vault, a gallery, a shaft, a gatehouse, a tower, a hall house, a market square, a clearing, a ledge path. An archetype is a parameterised recipe with named sockets (entrances, a focal point, an overlook position) that higher layers can target.

### History

Scalar fields are computed over the site and drive everything organic, including the surface materials:

- **Moisture** flows downhill from sources, pools in basins and seeps through walls.
- **Heat** radiates from magma and hearths and falls off with distance.
- **Light** from the sky, openings and persistent sources.
- **Decay** from age, moisture, exposure and structural span.
- **Growth** where moisture and light, or moisture and rot, allow it.
- **Wear** along the routes that feet have used.

Then events from the premise are applied: sections collapse where decay is high, water fills to a level, growth invades, fire leaves soot and missing roofs.

History and mission interact in one important way. A collapse must not break the mission, and the neatest resolution is that **history is where locks come from**. The collapsed corridor is the lock; the detour is the cycle. Mission edges marked as locked request a physical cause from the history layer, and the history layer is forbidden from blocking edges the mission needs open.

### Population

Gameplay entities are placed by role, not at random. The mission graph already says which place holds the key, which door is locked and where the rest point is. Remaining placement uses distance maps (the furthest point from the entrance, the least-visited corner) and **blueprints** in the style of *Brogue*'s machines: small authored recipes such as "altar room holding a key, guarded by a trap whose tell is visible from the door" that claim a place and fill it coherently.

Secrets always get tells. Forks always get information leaks: a sound source, a light, a material change placed where the fork can perceive it.

### Dressing

Props, vegetation and material assignments are scattered according to fields and biome tables, with density gathered around focal points. Local pattern synthesis (wave function collapse or similar) is useful here for wall and floor detail, where local coherence matters and global structure is already fixed from above. Vignettes — small authored story scenes — are spent sparingly from the surprise budget.

### Lighting

Lights are placed for play first and mood second. The mission and population layers request them by role: a guide light at the far end of a dark hall, a leak at a fork, a focal light on the signature, warmth in a sanctuary. The biome's light regime then fills in and sets colour, and the setting supplies the sky. Because the world is static once generated, indirect light is baked. See [document 4](04-look.md).

### Critique

See "Quality model" below.

## Technique catalogue

Each technique has a place. None is the answer on its own.

| Technique | Good at | Poor at | Used in |
|---|---|---|---|
| Cyclic generation, graph rewriting | Purposeful loops, gating, pacing | Geometry | Mission, topology |
| Site grammars | Castles, towns and wild places with believable organisation | Novel organisation | Topology, layout |
| Constraint solving | Hard guarantees, puzzle validity | Scale, speed | Layout, puzzles, validation |
| Shape grammars | Architecture with proportion | Organic forms | Built geometry |
| Cellular automata, noise | Caves, natural variation | Guaranteed connectivity, intent | Natural geometry, fields |
| Erosion and flow simulation | Terrain and water that make sense | Meeting gameplay constraints unaided | Open terrain, history |
| Agents and growth algorithms | Tunnels, roads, roots, trees, rivers | Global structure | Hewn and grown geometry, streets, vegetation |
| Field simulation | Believable cause and effect | Gameplay intent | History, dressing, materials |
| Wave function collapse | Local coherence from examples | Global structure | Dressing, detail |
| Authored blueprints and vaults | Hand-made quality, set pieces | Variety, if overused | Population, signature places |
| Distance, visibility and viewshed maps | Placement, vistas, pacing analysis | — | Layout, population, critique |
| Search over seeds, quality-diversity | Picking good and varied output | Needs good metrics | Critique, selection |

A language model could later write names and lore text from the premise record. It is not part of the core generator, which stays deterministic and offline.

## Spatial representation

The site has to hold caves under hills, storeys in buildings, bridges over streets and walks along the tops of walls, and still be easy to analyse and to draw as a map. The canonical form is a **span grid**.

- The site is a horizontal grid of columns, about a metre across.
- Each column holds a short list of **spans**: a walkable floor height, the clear height above it, and what the span belongs to (place, zone, storey, surface material, flags).
- Open ground is a span whose ceiling is the sky. A two-storey house over a cellar is three spans. A cave under a hillside is one span below the terrain span.

This is the same idea navigation-mesh builders use to describe walkable space. It is chosen because it is centred on what matters for play (where can someone stand, and what is above them), handles every kind of site with one structure, slices cleanly into a 2D map per storey, and is cheap to analyse for reachability and sightlines.

The span grid is the logical truth, not the visible one. Visible geometry is derived from it by meshing passes that depend on origin: crisp walls, arches and roofs for built parts; smooth, irregular surfaces for natural ones; a continuous terrain surface outdoors. A metre grid underneath does not mean a blocky world on screen.

The space graph stays attached, so every span knows its place, every place knows its mission role, and a game can ask "which places are on the critical path" without re-deriving it.

## Data model sketch

```ts
interface Site {
  version: 1;
  seed: string;
  brief: Brief;                 // what was asked for
  premise: Premise;             // builders, purpose, events, occupants, biome arc, signature, twist
  setting: Setting;             // parts, landform, climate, sky, boundary
  mission: MissionGraph;        // beats, locks, keys, intensity targets
  space: SpaceGraph;            // places, ways, zones
  spans: SpanGrid;              // walkable spans per column
  fields: Record<FieldName, Float32Array>;  // moisture, heat, light, decay, growth, wear
  entities: Entity[];           // doors, keys, mechanisms, props, plants, lights, threats, each with a role
  annotations: Annotations;     // critical path, landmarks, vistas, metrics
}

interface Zone {
  id: ZoneId;
  part: PartId;                 // which part of the site
  kind: 'delve' | 'stronghold' | 'settlement' | 'wild';
  biome: BiomeId;
  storey: number;               // cellars, ground, upper floors, rooftops
}

interface Place {
  id: PlaceId;
  zone: ZoneId;
  archetype: ArchetypeId;       // vault, gallery, ward, tower, square, clearing, ...
  enclosure: 'open' | 'roofed' | 'underground';
  fiction: string;              // armoury, cistern, market, ford
  beat: BeatRole;               // tease, test, rest, reward, reveal, climax, connector
  intensity: number;            // 0..1 pacing target
  footprint: Polygon; elevation: number;
  tags: string[];               // landmark, signature, secret, sanctuary, shell
}

interface Way {
  a: PlaceId; b: PlaceId;
  kind: 'open' | 'door' | 'gate' | 'stairs' | 'drop' | 'squeeze' | 'bridge'
      | 'trail' | 'ford' | 'ladder' | 'secret';
  edge: 'hard' | 'soft';        // soft ways can be left; hard ones cannot
  lock?: LockId;                // what blocks it and what unblocks it
  oneWay?: 'a-to-b' | 'b-to-a';
  leak?: Cue[];                 // what a player at one end perceives of the other
}

interface Span {
  floor: number; clear: number; // floor height and headroom; clear = Infinity under sky
  place: PlaceId; material: MaterialId; flags: number;
}

interface BiomeDef {
  id: string; bigIdea: string;
  axes: { setting; substrate; climate?; origin; culture?; condition?; light };
  geometry: GeneratorRef[];     // generators and parameters
  materials: MaterialRule[];    // surfaces and how fields blend them
  flora: ScatterRule[]; dressing: ScatterRule[];
  lighting: LightRegime; atmosphere: Atmosphere; sound: SoundRef[];
  mechanics: MechanicId[];      // verbs, hazards and puzzle elements it contributes
  landmarks: BlueprintId[];
  borders: Record<BiomeId, TransitionRule>;
}
```

Biomes, site grammars, archetypes, cycle patterns, materials and blueprints are data, so adding content does not mean changing the generator.

## Quality model

### Hard constraints

A site that fails any of these is discarded or repaired.

- The goal is reachable from the entrance under lock and key rules.
- No softlocks: no reachable state from which the goal becomes unreachable (one-way drops and consumable keys are the usual culprits).
- Every required place is reachable; every key is obtainable before its lock is needed.
- Geometry matches the graph: every way is physically traversable, and there are no unintended hard connections. Outdoors this means walking the terrain to confirm that hard edges really are impassable.

Checked by a state-space solver over (position, keys held, world state).

### Measured qualities

Each maps to a principle from document 1.

| Quality | Metric |
|---|---|
| Loops | Number of independent cycles; distribution of loop lengths |
| Non-linearity | Critical path length against total places; share of optional content |
| Choice | Junctions with two or more unexplored exits; share of those with an information leak |
| Gating | Number of locks; average span between seeing a lock and obtaining its key |
| Backtracking | Longest forced return walk once shortcuts are open |
| Legibility | Presence of a hub (centrality); a landmark per zone; distinctness of zones |
| Dead ends | Share of dead ends with a payoff |
| Pacing | Fit between measured intensity along the critical path and the target curve |
| Contrast | Variance of volume; largest adjacent size ratio; alternation of inside and outside |
| Verticality | Elevation range; number of overlooks and crossings; use of storeys |
| Vistas | Long sightlines ending on a landmark or goal; places seen before they are reached |
| Approach | Share of the site and number of landmarks visible from the entrance; ways in that can be seen |
| Mystery | Average share of a place hidden from its entrances; outdoors, share of the site hidden from any one point |
| Boundary | Share of the site's edge closed by something with a cause in the fiction |
| Novelty | Places between first appearances of new elements; longest run without one |
| Surprise | Budget spent: scale outliers, structural twist, state changes, vignettes |

### Using the metrics

- **Selection.** Generate many candidates at the cheap layers, score, continue with the best.
- **Expressive range analysis.** Run thousands of seeds, plot the metric distributions, and look at what the generator can and cannot produce (Smith and Whitehead's method). A generator whose output clusters in one corner of the space is producing oatmeal, whatever any single output looks like.
- **Diversity.** Offer the user varied good results rather than the top-scoring one repeated: keep the best candidate from each region of metric space.

Metrics are instruments, not the goal. They flag bad output reliably and good output only roughly. The tests in document 1, applied by a person walking the site, remain the final judge, and metric weights should be tuned against those judgements.
