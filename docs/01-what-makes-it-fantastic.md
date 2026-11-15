# 1. What makes a dungeon fantastic

This document defines the target. Everything the generator does should be traceable to something here, and everything here should eventually be something the generator can either build on purpose or measure after the fact.

## The core claim

A fantastic dungeon is **a place with a past, a shape you can learn, and a rhythm you can feel.**

- **Place**: it exists for a reason, something happened to it, and something lives in it now.
- **Shape**: its structure offers real choices, folds back on itself, and rewards the player for building a mental map.
- **Rhythm**: tension and release, cramped and vast, familiar and strange arrive in a deliberate order.

Most procedural dungeons fail in the same way: every local piece is fine, and the whole means nothing. Rooms are shuffled rather than composed. Kate Compton called this the "10,000 bowls of oatmeal" problem — each bowl is mathematically unique and perceptually identical. The cure is intent that flows from the top down: decide what the place is and what the player will do there, then build geometry to serve that.

## 1. Structure: the shape of the adventure

Structure is what the player's mental map is made of. It is the part most generators neglect and the part with the highest payoff.

**Loops, not trees.** A tree-shaped dungeon forces backtracking through emptied rooms and offers no route choice. Loops let the player circle around an obstacle, escape, flank, and arrive at a known room from an unknown direction — the single most satisfying moment in exploration ("oh, *this* is where that door leads"). Jennell Jaquays' classic dungeons are the reference: multiple entrances, loops within loops, several connections between levels, connections that skip a level.

**Choices need information.** Left or right is not a choice; it is a coin flip. A draught and the sound of water from the left, torchlight and voices from the right — that is a choice. Every fork should leak something about what lies beyond: light, sound, smell, a glimpse, a change of material.

**Locks and keys, generalised.** Progress gating gives a dungeon its plot. The "lock" is anything that blocks; the "key" is whatever unblocks it.

| Key | Typical locks | Notes |
|---|---|---|
| Item (key, crank, gem) | Door, mechanism, socket | The plain case |
| Tool or ability (rope, lantern, breath) | Chasm, darkness, flooded tunnel | Reusable; reshapes the whole map |
| State (lever, water level, power) | Gate, drained passage, rotated bridge | Changes rooms already visited |
| Knowledge (a symbol order, a tell) | Combination door, hidden passage | The key is in the player's head |
| Victory (guardian defeated) | Guarded threshold | The lock fights back |
| Direction (drop, one-way door) | A valve rather than a lock | The basis of shortcuts |

The best locks are **seen before their keys are found**. The player carries the question through the dungeon, and finding the key delivers a plan, not just an object.

**Shortcuts that fold the map.** A gate that opens only from the far side, a ladder kicked down, a bridge lowered: after a long excursion the player opens a ten-second route back to the hub. This converts backtracking into mastery and makes the map feel smaller as the player's competence grows.

**A hub and districts.** Kevin Lynch found that people navigate cities by five elements: paths, edges, districts, nodes and landmarks. Dungeons are the same. A recognisable hub to return to, a handful of districts that each feel distinct, hard edges between them (a chasm, a river, a great wall) and a landmark per district make a large dungeon learnable.

**Verticality.** Height is the cheapest source of drama and structure: overlooks, pits, balconies, bridges that cross over a path walked earlier. Seeing a room from above and then entering it at floor level is two experiences from one space.

**Dead ends earn their keep.** Every dead end holds a reward, a secret, a view, a story fragment or a threat. An empty dead end is a small betrayal.

## 2. Spaces: how individual places feel

**Compression and release.** A low crawl that opens into a cathedral-sized cavern works because of the crawl. Size is felt only by contrast, so the sequence of room scales matters more than any single room.

**Prospect and refuge.** People like places where they can see without being seen (Appleton). A ledge above a hall, an alcove off a corridor, a doorway onto a vast space. Refuges are where players stop, plan and breathe.

**Vistas and "weenies".** Show the destination early and from far away: the lit tower across the chasm, the glow at the bottom of the shaft. A visible goal pulls the player through intervening space and makes arrival meaningful.

**Mystery.** The Kaplans' research on environmental preference found people are drawn to scenes that promise more information if they move forward: a bend, a half-open door, light spilling from around a corner. Straight corridors with everything visible are dull; a space that is never fully visible from one point invites exploration.

**Thresholds.** The moment of entry is the moment of attention. Doorways, arches, drops and squeezes should frame what comes next.

**Room identity.** Each room should have a function in the fiction (armoury, cistern, shrine), a function in the adventure (tease, test, rest, reward) and one memorable trait. If the player cannot name a room afterwards, it was filler.

## 3. Rhythm: pacing and variety

- **An intensity curve.** Rising sawtooth: each peak higher than the last, each followed by a trough. Without troughs, peaks do not register.
- **Sanctuaries.** Safe rooms are structure, not absence. They anchor the map and punctuate the journey.
- **Introduce, develop, twist, conclude.** A new element appears alone in a safe context, returns in a harder form, is combined with something else or inverted, and gets a finale. This is the kishōtenketsu pattern Nintendo uses for level design, and it applies to hazards, puzzle mechanics and creatures alike.
- **A novelty schedule.** Something new every few rooms, and nothing repeated more than a few times without variation.

## 4. Surprise

Surprise is the violation of an expectation, so **surprise requires a pattern first**. A generator that is random everywhere surprises no one. The generator has to establish norms (this crypt is orthogonal, symmetrical, torchlit) and then spend a small, deliberate budget on breaking them.

| Kind | Example |
|---|---|
| Spatial | The corridor opens onto a cavern ten times larger than anything so far |
| Structural | The "final" chamber has a hole in the floor, and an older dungeon lies beneath |
| Systemic | Pulling the lever floods the lower level, and familiar rooms become new |
| Narrative | The tomb was sealed from the inside |
| Perceptual | A secret door whose tell was visible all along |

Fair surprise is foreshadowed in hindsight. Secrets have tells. Traps have signs. The twist was hinted at by something the player walked past.

## 5. Puzzles

A puzzle is a lock whose key is understanding.

- **Systemic, not bespoke.** Build puzzles from a small set of elements with consistent rules (water flows and floats, light travels in lines, weight holds plates down, fire burns growth). Consistent rules mean puzzles can be generated, combined and verified.
- **Taught before tested.** The first use of a mechanic is trivially simple and safe.
- **Solvable by construction.** Generate the solution first and build the puzzle around it, then verify with a solver.
- **The dungeon as the puzzle.** The best puzzle is the layout itself: working out that the flooded lower hall and the dry cistern above are connected, and what follows from that.

## 6. Place: history and ecology

Believability comes from cause and effect.

- **Purpose.** It was built as something: a tomb, a mine, a monastery, a prison, a waterworks. Purpose dictates rooms and their arrangement. A mine has shafts, galleries and a hoist; a monastery has cells, a refectory and a scriptorium.
- **History in layers.** Builders, then a catastrophe, then later occupants, then the present. A mine that broke into a natural cavern, was abandoned after a flood and is now home to something that likes the dark is three layers and already a story.
- **Ecology.** Things that live here need water, food and a way in and out. Factions hold territory and have borders.
- **Environmental storytelling.** Small staged scenes do more than text: the barricade built from the wrong side, the skeleton whose hand almost reaches the lever.

A good test: the dungeon's premise fits in one sentence, and that sentence explains most of what the player sees.

## 7. Visual impression

- **Light is the primary material.** Underground, light defines space, mood and direction. Darkness is the default and every light source is a decision. Light guides: players walk towards it.
- **Silhouette and shape language.** Each area should be recognisable in outline: angular and regular, soft and bulbous, shattered and leaning.
- **Palette discipline.** Few colours per area, one accent. The accent marks what matters.
- **Density gradients.** Detail gathers where attention should go and thins out elsewhere. Uniform clutter reads as noise.
- **Scale cues.** A vast space needs something of known size in it to read as vast.
- **Atmosphere.** Fog, dust, drips, spores, heat shimmer. Depth cues make spaces feel large and continuous.
- **The postcard.** Every dungeon needs at least one view worth a screenshot.

---

# What makes a biome fantastic

A biome is not a tileset swap. A biome is **a coherent bundle of geometry, light, material, life, hazard and rules that changes how the player moves, sees and thinks.**

## Properties of a great biome

1. **One big idea.** Each biome has a single sentence that everything else follows from. *In the fungal deep, the only light comes from living things.* *In the drowned halls, the water level is the map.*
2. **It changes the verbs.** A biome that only looks different is wallpaper. Ice makes you slide, water makes you swim and hides the floor, darkness makes light a resource, heat puts a clock on you. The big idea should touch movement, perception or resources.
3. **Five-second identity.** Recognisable at thumbnail size: silhouette, palette, light temperature, density, vertical profile. Recognisable with eyes closed too: each has a soundscape.
4. **Internal variety.** A biome needs its own sub-areas, gradients and landmarks, or it becomes monotonous within minutes. A cavern has a dry upper gallery, a wet streamway, a flowstone grotto and a breakdown chamber.
5. **Cause and effect.** Moss grows where water seeps. Fungi grow where things rot. Ice forms far from the magma. If decoration follows physical fields (moisture, heat, light, age), the result reads as natural even when the player cannot say why.
6. **Its own puzzle and hazard vocabulary.** Each biome contributes mechanics, so a change of biome is a change of problems.
7. **Good borders.** The most interesting places are transitions: the mine gallery that breaks through a cavern wall, tree roots splitting a crypt ceiling, frost creeping along a corridor towards a forge. Biomes should blend along gradients and collide at dramatic seams.

## Biomes as a composition, not a list

Instead of a fixed catalogue, a biome is a point in a space of independent axes. This is what makes combination tractable and gives enormous variety from few parts.

| Axis | Examples | Mainly drives |
|---|---|---|
| **Substrate** | Limestone, basalt, ice, salt, living wood, bone, crystal | Materials, natural cave shapes, palette base |
| **Origin** | Natural, hewn, built, grown, wrong | Shape language: organic, rough-regular, architectural, branching, impossible |
| **Builder culture** | Tomb-makers, miners, monks, engineers | Room types, layout rules, ornament |
| **Condition** | Flooded, frozen, burnt, collapsed, overgrown, corrupted | Hazards, what is blocked, state puzzles |
| **Inhabitants** | Vermin, a faction, a lone horror, nothing at all | Encounters, lairs, traces, barricades |
| **Light regime** | Pitch dark, torchlit, bioluminescent, glowing from below, shafts of daylight | Mood, visibility rules |

"A frozen miners' gallery in basalt, infested, pitch dark" is generated from the axes. Named biomes are curated presets: points in this space where the combination has a strong big idea and has been tuned.

## Starter set

Chosen to be maximally distinct from one another and to exercise different generation techniques.

| Biome | Big idea | Shape | Light | Mechanic it adds |
|---|---|---|---|---|
| **Hewn crypt** | Order imposed on stone; the dead are filed away | Orthogonal, symmetric, tight | Sparse warm torchlight | Doors, keys, pressure plates — the baseline |
| **Living cavern** | Water made this; follow the water | Organic, varied scale, streamways | Pitch dark | Carried light as a resource; climbing and squeezes |
| **Fungal deep** | The only light comes from living things | Soft, bulbous, branching growth | Cool bioluminescence | Spores, growth that reacts to light and fire |
| **Drowned halls** | The water level is the map | Any architecture, half submerged | Caustics, reflections | Raise and drain water to open and close routes |
| **Magma forge** | Light and danger come from below | Industrial, vertical, bridges | Hot glow from beneath | Heat timers, flows that can be diverted or cooled |
| **Crystal geode** | Light travels, bends and can be carried | Faceted, angular, glittering | Refracted beams | Beam-routing puzzles, fragile floors |
| **Root-bound ruin** | The surface is breaking in | Built geometry cracked by organic growth | Shafts of daylight | Growth as bridge and barrier; a second entrance from above |
| **The underneath** | This part was not built for you | Wrong scale, wrong angles | Sourceless | Rules established elsewhere are broken here |

The last one is the designated rule-breaker: a rare deep layer whose job is to be the structural twist.

## The biome arc

A dungeon should travel. Descent is a journey through biomes, and the order tells the story: crypt, then the mine the crypt-builders sealed, then the cavern the miners broke into, then whatever was in the cavern. Two to four biomes per dungeon, with one dominant and one reserved for a late reveal, is a good default.

---

# Tests of "fantastic"

Informal acceptance tests to apply to generated output. The metrics in document 2 are attempts to automate these.

| Test | Question |
|---|---|
| **Sentence** | Can the dungeon be described in one sentence that distinguishes it from the last five? |
| **Sketch** | After exploring, can the player sketch the rough layout from memory? |
| **Postcard** | Is there at least one view worth a screenshot? |
| **Fork** | At each junction, did the player have a reason to prefer one way? |
| **Return** | Did the player come back to a known place by an unknown route at least once? |
| **Question** | Was the player carrying an unanswered question (a locked door, a glimpsed place) for most of the run? |
| **"Wait, what?"** | Was there one moment that broke the pattern? |
| **Second seed** | Do two seeds with the same settings feel like different places, not the same place reshuffled? |

## Sources of these ideas

- Jennell Jaquays' dungeon design (*Caverns of Thracia*, *Dark Tower*) and the later analyses of its non-linear techniques
- Joris Dormans, "Adventures in Level Design: Generating Missions and Spaces for Action Adventure Games" (2010), and his cyclic generation work for *Unexplored*
- Mark Brown's *Boss Keys* series on Zelda dungeon structure
- Kevin Lynch, *The Image of the City*; Jay Appleton, *The Experience of Landscape*; Rachel and Stephen Kaplan, *The Experience of Nature*
- Kate Compton, "So you want to build a generator"
- Brian Walker's *Brogue* (level accretion and "machine" rooms); Derek Yu, *Spelunky*
- Johnn Four's five-room dungeon
