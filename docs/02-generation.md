# 2. How to generate it

This document defines the generation approach: principles, the pipeline, the pieces that get combined, the data model and how quality is measured.

## Principles

1. **Intent flows down, detail flows up.** Decide what the place is and what the player does there before placing a single wall. Geometry serves structure; structure serves premise.
2. **Author the vocabulary, generate the sentences.** People hand-author small reusable pieces — structural patterns, room archetypes, biome definitions, set-piece blueprints. The generator composes them. Quality comes from the pieces; variety comes from the combination.
3. **Build it, break it, move in.** Generate the place as its builders made it, then apply history (collapse, flood, growth), then let inhabitants adapt it. Order of generation mirrors order of events, which is why the result reads as a place with a past.
4. **Guarantee by construction, verify by solver.** Structure is generated so that it is completable, and then a solver checks anyway. Nothing ships that cannot be finished.
5. **Generate many, keep the best.** Early layers are cheap. Produce hundreds of candidate structures, score them, and spend expensive work only on survivors.
6. **Surprise is budgeted.** Norms are established per dungeon and per biome; a small explicit budget is spent on violating them.
7. **Everything is deterministic and inspectable.** One seed reproduces one dungeon. Every layer is a data artefact that can be viewed, saved and re-rolled independently.
8. **Logic is separate from looks.** The dungeon is a renderer-independent document. A 2D map, a 3D walk-through and a game-engine export are all views of the same data.

## The pipeline

Each layer consumes the layers above and produces a data artefact. Each derives its own random stream from the master seed and its layer name, so re-rolling the dressing does not disturb the layout.

| # | Layer | Question it answers | Output | Main techniques |
|---|---|---|---|---|
| 0 | **Brief** | What was asked for? | Size, tone, difficulty, biome preferences, constraints | User input, presets |
| 1 | **Premise** | Who built it, what happened, who is here now? | Builders, purpose, events, occupants, biome arc, the signature set piece, the twist | Weighted tables, tag grammar |
| 2 | **Mission** | What does the player do, in what order? | Graph of beats with locks, keys and pacing targets | Cyclic generation, graph rewriting |
| 3 | **Topology** | Which rooms exist and how do they connect? | Space graph: rooms, connections, zones, levels | Graph refinement, pattern expansion |
| 4 | **Layout** | Where is each room in space? | Footprints, positions, elevations | Coarse-grid embedding, constraint relaxation |
| 5 | **Geometry** | What is the exact shape? | Cell grid with floor and ceiling heights, walls, openings | Per-origin generators: shape grammar, cellular automata, noise, agents |
| 6 | **History** | What did time do to it? | Fields (moisture, heat, decay, growth), collapse, water, vegetation | Field simulation, flow, growth algorithms |
| 7 | **Population** | What is in it that matters to play? | Doors, keys, mechanisms, puzzles, threats, rewards, secrets | Role-driven placement, distance maps, blueprints |
| 8 | **Dressing** | What does it look and sound like? | Props, lights, materials, vignettes, ambience | Field-driven scatter, local pattern synthesis |
| 9 | **Critique** | Is it valid, and is it good? | Pass or fail, metrics, annotations | Solver, graph and visibility analysis |
| 10 | **Export** | How is it consumed? | JSON, 2D map, 3D mesh, tilemap | Meshing, serialisers |

### Layer 1: premise

The premise is a small structured record, not prose. It picks a builder culture and purpose, one or two historical events, current occupants, the biome arc, one signature set piece (the thing this dungeon will be remembered for) and optionally a twist. Every later layer reads it: purpose selects room types, events select conditions and locks, occupants select population, the signature gets reserved space in the layout.

A templated one-sentence description is generated from it. If the sentence is dull, the dungeon probably will be, which makes the premise the cheapest place to reject a candidate.

### Layer 2: mission, built from cycles

This is the heart of the approach and follows Joris Dormans' cyclic generation, the technique behind *Unexplored*.

A dungeon is not built from rooms. It is built from **cycles**: two paths between a start and a goal, where the relationship between the paths is the gameplay. Loops are therefore not added afterwards; they are the unit of construction.

| Cycle pattern | Path A | Path B | Experience |
|---|---|---|---|
| **Lock and key** | Short, ends at a locked door seen early | Long, holds the key | Carrying a question; a plan when the key appears |
| **Shortcut** | Long and dangerous | Short, opens only from the far side | Folding the map; mastery |
| **Two ways** | Dangerous and direct | Safe and long, or hidden | An informed choice |
| **Tease** | A view of the reward across a gap | The route that eventually reaches it | Anticipation |
| **Overlook** | A balcony above the arena | The descent into it | Planning from prospect |
| **Hidden bypass** | The obvious hard route | A secret that skips it | Reward for attention |
| **State change** | A route that is closed | A mechanism elsewhere that opens it and closes another | Rereading known space |
| **Gauntlet and return** | A one-way plunge | The climb back out | Commitment |

Generation starts from one top-level cycle (entrance to goal) and repeatedly rewrites: a path segment is replaced by a nested cycle, a room is expanded into a hub with spokes, a lock is strengthened by putting its key behind another lock. Rewrites are chosen to meet the brief's size and the pacing target. Each node carries a beat role (tease, test, rest, reward, reveal, climax) and an intensity value, which later layers honour.

Key and lock dependencies form a partial order. By always placing a key in a region reachable without its own lock, the mission is completable by construction.

### Layers 3 and 4: topology and layout

The mission graph says what happens; the space graph says where. They are not the same graph. One mission beat may become several rooms, several beats may share a room, and extra rooms are added for texture: connectors, vestibules, optional side chambers, secrets.

Zones are assigned here. Contiguous groups of rooms become districts, each with a biome from the premise's arc, a landmark and edges between them.

Layout places the graph in space. The plan is a two-step embedding:

1. **Coarse placement** on a low-resolution grid, where each cell holds one room or connector and edges link adjacent cells. This makes planar embedding of loops tractable and gives an early, cheap rejection point.
2. **Refinement**: each coarse cell is given a footprint and an elevation according to its room archetype and intensity (rest rooms small and enclosed, set pieces vast), then positions are relaxed to close gaps and align connections.

Verticality is assigned deliberately at this stage: overlook cycles need height differences, descents follow the biome arc, and the signature set piece gets the largest volume.

### Layer 5: geometry

Geometry generators are selected by the biome's **origin** axis. Each fills a footprint and honours its required openings.

| Origin | Generator | Character |
|---|---|---|
| Built | Shape grammar: symmetric subdivision, colonnades, alcoves, apses | Regular, legible, proportioned |
| Hewn | Agent tunnelling with rough-regular galleries and props | Functional, following seams |
| Natural | Cellular automata and noise blended with a flow-carved streamway | Organic, varied scale |
| Grown | Branching growth (space colonisation, aggregation) | Soft, tendril-like |
| Wrong | Any of the above with broken parameters | Unsettling |

Room archetypes sit above these: a vault, a gallery, a shaft, a bridge room, a grotto. An archetype is a parameterised recipe with named sockets (entrances, a focal point, an overlook position) that higher layers can target.

### Layer 6: history

Scalar fields are computed over the grid and drive everything organic:

- **Moisture** flows downhill from sources and pools in basins.
- **Heat** radiates from magma and falls off with distance.
- **Light** from openings and persistent sources.
- **Decay** from age, moisture and structural span.
- **Growth** where moisture and light, or moisture and rot, allow it.

Then events from the premise are applied: sections collapse where decay is high, water fills to a level, growth invades.

History and mission interact in one important way. A collapse must not break the mission, and the neatest resolution is that **history is where locks come from**. The collapsed corridor is the lock; the detour is the cycle. Mission edges marked as locked request a physical cause from the history layer, and the history layer is forbidden from blocking edges the mission needs open.

### Layer 7: population

Gameplay entities are placed by role, not at random. The mission graph already says which room holds the key, which door is locked and where the rest point is. Remaining placement uses distance maps (the furthest point from the entrance, the least-visited corner) and **blueprints** in the style of *Brogue*'s machines: small authored recipes such as "altar room holding a key, guarded by a trap whose tell is visible from the door" that claim a room and fill it coherently.

Secrets always get tells. Forks always get information leaks: a sound source, a light, a material change placed where the fork can perceive it.

### Layer 8: dressing

Props, materials and lights are scattered according to fields and biome tables, with density gathered around focal points. Local pattern synthesis (wave function collapse or similar) is useful here for wall and floor detail, where local coherence matters and global structure is already fixed from above. Vignettes — small authored story scenes — are spent sparingly from the surprise budget.

### Layer 9: critique

See "Quality model" below.

## Technique catalogue

Each technique has a place. None is the answer on its own.

| Technique | Good at | Poor at | Used in |
|---|---|---|---|
| Cyclic generation, graph rewriting | Purposeful loops, gating, pacing | Geometry | Mission, topology |
| Constraint solving | Hard guarantees, puzzle validity | Scale, speed | Layout, puzzles, validation |
| Shape grammars | Architecture with proportion | Organic forms | Built geometry |
| Cellular automata, noise | Caves, natural variation | Guaranteed connectivity, intent | Natural geometry, fields |
| Agents and growth algorithms | Tunnels, roots, veins, rivers | Global structure | Hewn and grown geometry, history |
| Field simulation | Believable cause and effect | Gameplay intent | History, dressing |
| Wave function collapse | Local coherence from examples | Global structure | Dressing, detail |
| Authored blueprints and vaults | Hand-made quality, set pieces | Variety, if overused | Population, signature rooms |
| Distance and visibility maps | Placement, vistas, pacing analysis | — | Population, critique |
| Search over seeds, quality-diversity | Picking good and varied output | Needs good metrics | Critique, selection |

A language model could later write names and lore text from the premise record. It is not part of the core generator, which stays deterministic and offline.

## Spatial representation

The canonical spatial form is a **2.5D cell grid**: each cell has a floor height, a ceiling height, a material, a room id and flags, and discrete levels can be stacked.

This is chosen because it gives real verticality (overlooks, pits, ledges, vast chambers, bridges on stacked levels) while remaining readable as a 2D map, cheap to analyse, simple to mesh into 3D and easy to export as tilemaps. Full voxels would allow overhangs and true 3D caves at a large cost in complexity; free-form polygons would make analysis and export harder. Smoothness for natural caves is a meshing concern, not a representation concern.

The grid is never the only truth. The space graph stays attached, so every cell knows its room, every room knows its mission role, and a game can ask "which rooms are on the critical path" without re-deriving it.

## Data model sketch

```ts
interface Dungeon {
  version: 1;
  seed: string;
  brief: Brief;                 // what was asked for
  premise: Premise;             // builders, purpose, events, occupants, biome arc, signature, twist
  mission: MissionGraph;        // beats, locks, keys, intensity targets
  space: SpaceGraph;            // rooms, connections, zones, levels
  grid: CellGrid;               // 2.5D cells, per level
  fields: Record<FieldName, Float32Array>;  // moisture, heat, light, decay, growth
  entities: Entity[];           // doors, keys, mechanisms, props, lights, threats, each with a role
  annotations: Annotations;     // critical path, landmarks, vistas, metrics
}

interface Room {
  id: RoomId;
  zone: ZoneId;                 // district; carries the biome
  archetype: ArchetypeId;       // vault, gallery, shaft, grotto, ...
  fiction: string;              // armoury, cistern, shrine
  beat: BeatRole;               // tease, test, rest, reward, reveal, climax, connector
  intensity: number;            // 0..1 pacing target
  footprint: Rect; elevation: number;
  tags: string[];               // landmark, signature, secret, sanctuary
}

interface Connection {
  a: RoomId; b: RoomId;
  kind: 'open' | 'door' | 'stairs' | 'drop' | 'squeeze' | 'bridge' | 'secret';
  lock?: LockId;                // what blocks it and what unblocks it
  oneWay?: 'a-to-b' | 'b-to-a';
  leak?: Cue[];                 // what a player at one end perceives of the other
}

interface BiomeDef {
  id: string; bigIdea: string;
  axes: { substrate; origin; culture?; condition?; light };
  geometry: GeneratorRef[];     // generators and parameters
  palette: Palette; atmosphere: Atmosphere; sound: SoundRef[];
  mechanics: MechanicId[];      // verbs, hazards and puzzle elements it contributes
  dressing: ScatterRule[];      // props keyed to fields
  landmarks: BlueprintId[];
  borders: Record<BiomeId, TransitionRule>;
}
```

Biomes, archetypes, cycle patterns and blueprints are data, so adding content does not mean changing the generator.

## Quality model

### Hard constraints

A dungeon that fails any of these is discarded or repaired.

- The goal is reachable from the entrance under lock and key rules.
- No softlocks: no reachable state from which the goal becomes unreachable (one-way drops and consumable keys are the usual culprits).
- Every required room is reachable; every key is obtainable before its lock is needed.
- Geometry matches the graph: every connection is physically traversable and there are no unintended ones.

Checked by a state-space solver over (position, keys held, world state).

### Measured qualities

Each maps to a principle from document 1.

| Quality | Metric |
|---|---|
| Loops | Number of independent cycles; distribution of loop lengths |
| Non-linearity | Critical path length against total rooms; share of optional content |
| Choice | Junctions with two or more unexplored exits; share of those with an information leak |
| Gating | Number of locks; average span between seeing a lock and obtaining its key |
| Backtracking | Longest forced return walk once shortcuts are open |
| Legibility | Presence of a hub (centrality); a landmark per zone; distinctness of zones |
| Dead ends | Share of dead ends with a payoff |
| Pacing | Fit between measured intensity along the critical path and the target curve |
| Contrast | Variance of room volume; largest adjacent size ratio |
| Verticality | Elevation range; number of overlooks and crossings |
| Vistas | Long sightlines ending on a landmark or goal; places seen before they are reached |
| Mystery | Average share of a room hidden from its entrances |
| Novelty | Rooms between first appearances of new elements; longest run without one |
| Surprise | Budget spent: scale outliers, structural twist, state changes, vignettes |

### Using the metrics

- **Selection.** Generate many candidates at the cheap layers, score, continue with the best.
- **Expressive range analysis.** Run thousands of seeds, plot the metric distributions, and look at what the generator can and cannot produce (Smith and Whitehead's method). A generator whose output clusters in one corner of the space is producing oatmeal, whatever any single output looks like.
- **Diversity.** Offer the user varied good results rather than the top-scoring one repeated: keep the best candidate from each region of metric space.

Metrics are instruments, not the goal. They flag bad output reliably and good output only roughly. The tests in document 1, applied by a person walking the dungeon, remain the final judge, and metric weights should be tuned against those judgements.
