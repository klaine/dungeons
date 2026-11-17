# Dungeons

A browser tool that generates places for adventure and lets you walk through them: a house of
rooms and caves built stone by stone, in a valley you can walk, with maps and exports. TypeScript,
Vite, three.js. It is drawn with three.js's WebGPU renderer, which falls back to WebGL 2 by itself
where a browser has no WebGPU (`?webgl` forces that). So nothing here is written in GLSL or WGSL:
materials and post-processing are node materials built with three's shading language (`three/tsl`),
and the one renderer serves both. The exception is the procedural textures, whose recipes are GLSL
painted once at start by a small WebGL renderer of their own (`textures.ts`). No server; it is published to GitHub Pages from the `gh-pages` branch by a workflow
on every push to the default branch.

## Where things are written down

- `docs/03-plan.md`: what is built, milestone by milestone, what was asked for, and what is missing. Read "Where things stand" and "Direction received" first.
- `docs/04-look.md`: how it is drawn, the rules for what grows where, and the outdoor target.
- `docs/05-site-format.md`: the site document and what is exported.
- `README.md`: how to run it, controls, URL parameters.

Keep these up to date in the same commit as the change they describe.

## Running and checking

- `npm install`, then `npm run dev` and open the address it prints. `?seed=<text>` picks the place; `?nointro` skips the opening card; `?nobake` skips the light bake. `?cam=x,y,z,yaw,pitch` puts the camera somewhere and leaves it flying there, for pictures; `V` toggles flying while walking about.
- `npm run lab` opens the material lab (`lab/materials.html`) on port 5178: a small stage with a cliff, boulders, ground with a track, trees and grass, made by the game's code and drawn with the game's materials. Saving `siteMaterial.ts`, `vegetation.ts` or `textures.ts` swaps the new materials in where they stand (a small plugin in `vite.config.ts` sees to it); `K` keeps a picture to wipe against the live one. Work on rock, ground and leaf materials there first, then look in a valley. See the README.
- `npm run typecheck` and `npm run build` must pass before a commit.
- `npm run check` (`tools/sites.ts`): generates sites and confirms each is connected and completable. Run it after any change to `src/core`.
- `npm run range`: regenerates `public/range.html`, the report of what the generator makes.
- `npx tsx tools/land.ts 12`: builds the valley, its cliffs and boulders for twelve seeds without a browser, and reports rock standing in the doorway, numbers that are not numbers, and build time. Run it after any change to the rock or the ground.
- `npx tsx tools/island.ts 4`: the same for islands (`?place=island`). Run it after any change to `src/core/island.ts`, `src/render/island.ts`, `coast.ts` or `islandPlanting.ts`.
- `npx tsx tools/mountain.ts 4`: the same for mountain tops (`?place=mountain`). Run it after any change to `src/core/mountain.ts` or `src/render/mountain.ts`; add `peak eroded` for mountains with worn land (`?terrain=eroded`).
- `npx tsx tools/terrain.ts 3 peak <folder> 1.5 [top|country]`: shaded relief of each mountain's land, plain beside worn, as PNG files; for judging and tuning the wear (`WEAR`, `COUNTRY_WEAR`, `NEAR_WEAR` in `mountain.ts`) by eye. `WEAR='{"cut":30}'` before it tries other settings without editing.
- `tools/browser/*.cjs`: drive the real program with the player's body (walk every doorway, play to the end, try to leave the valley). See `tools/browser/README.md`. Run `play.cjs` on a few seeds after any change to the mesher, collision or game.

## How the code is laid out

- `src/core`: the site document (`site.ts`, now version 2: places may lie one above another, joined by stairs), the generator (`generate.ts`), the shape of the valley (`valley.ts`: its two sides as lines, and how far any point is inside them), the island that a site may be instead of a valley (`island.ts`: its coast, cove and the plain shape of its land, and what is placed on it), the mountain top that a site may be instead (`mountain.ts`: its rim, ridge, summits, way and climb, and the plain shape of its land; or, with `?terrain=eroded`, that shape worn, and the country round about made the same way), land made the common way (`terrain.ts`: lattices of heights, Quilez's eroded fBM and ridged noise, wear by water drops and by frost), the plans of buildings (`building.ts`), locks, keys and the solver (`mission.ts`). No rendering.
- `src/render`: site to geometry (`siteMesher.ts`, `geom/`; an island's land, sea cliffs and mainland in `island.ts`, a mountain top's rock, paths, shelter, cairns and the peaks round about in `mountain.ts`, its jetty, cottages, boats, lighthouse and castle in `coast.ts`, what grows on it in `islandPlanting.ts`, and the sea in `sea.ts`), materials and textures, the light bake (`bake/`), vegetation, water, post-processing. Rock is in `geom/rock.ts` (carving a solid from a function: marching cubes for caves, an edge-keeping carver for rock in the open) and `geom/rockForms.ts` (the functions: beds, joints, facets, boulders, and the wearing-down of cliffs); trees are grown in `planting.ts`. Buildings that stand free in the valley are made in `buildings.ts`, of plain solids and not of masonry, one function to a style. The hills beyond the valley are one sheet laid in `landscape.ts` and drawn with the far-land material in `siteMaterial.ts`; haze, mist and cloud are in `post.ts`. Level ground has its own material too (`makeGroundMaterial`), which draws turf, earth, shingle and the track from what the sheet says at each point.
- `src/app`: the program: main loop, player, game rules, touch, sound.
- `src/maps`, `src/export`, `src/gallery`, `examples/viewer`: maps, exports, the gallery page, and a viewer for exported files.

## Conventions

- Everything a generated place contains is decided in `src/core` and recorded in the site document; the mesher realises it. Maps and exports read the document.
- Stones and timber are closed solids: no face is left open, top or bottom.
- Random choices use `Rng.fork(label)` so that adding a choice does not reshuffle existing sites.
- Comments say why. Plain prose, no jargon.

## What has been measured, and what has not

Measured again after the move to WebGPU (November 2026, same desktop, in the app's embedded browser,
at 1252 by 737, drawing frames back to back): about 10 milliseconds with a lake in view and about
13 looking down the track; a site builds in 6 to 8 seconds. (Since then valleys have taken a shape of their own and grown. Measured on 16 November 2026: building the valley's land and rock alone, without a browser (`tools/land.ts`), took 9 to 11 seconds at the old size and takes 12.5 to 15 at the new, about half as large again in area. Drawing from the arrival point, timed in a pane that was not shown, cost the same at both sizes within the noise of the measure; there are about a sixth more vegetation cards.) (Islands, measured on 17 November 2026 without a browser in a cloud container with four cores (`tools/island.ts`): an island's land, rock, buildings and planting take 19 to 25 seconds, against a valley's 16 on the same machine; it has some 560,000 to 900,000 triangles of rock and 60,000 to 150,000 cards. No frame has been timed on an island; the person who asked for islands tried them in their own browser, from a build published as a page, and reported that they load and run with good performance; their screen showed an island built in 39 seconds, its light baked in 33, and 144 frames a second, which is the browser's cap, with 1.3 million triangles and 81,000 cards drawn.) (Mountain tops, measured on 17 November 2026 on the desktop: building one without a browser (`tools/mountain.ts`) takes 57 to 75 seconds, about two thirds of it carving rock, with 1.2 to 1.5 million triangles of rock; `DBG_T=1` before the command says how long each stage took. In the embedded browser one built in 41 seconds and its light baked in 36; frames drawn back to back at 1024 by 768 in a pane that was not shown took about 3 milliseconds, which has not been checked in a shown pane.) The WebGL 2 fallback draws the same
picture but has not been timed. The paragraph below is the earlier WebGL renderer, kept for comparison.

Measured in November 2026 on a desktop with a Radeon RX 6800, in the app's embedded browser: a
site builds in 5 to 6 seconds (it was 2 before the cliffs were carved; about 1.4 seconds of it is
the valley rim, and the water and its stones added the last second) and its light bakes in 15 to 22
seconds. With a lake in view, a frame at 1063 by 650 took about 15 milliseconds, of which some 6 are
the second drawing of the scene that the water mirrors; away from water it took 8 to 10. (At 1298
by 849 the same view with water took 20, of which 8 are the mirror; the haze, the mist, the far
land's material and its eight thousand trees together are about 1.5 of it; looking down the track,
with no water in view, it took 15, with the ground's new material in it.) Those are
times for drawing frames back to back, not a frame rate seen in play, which sat at the browser's
cap (144, later 60). An iPad was reported to run the earlier, lighter scene well on high; it has not
been tried since the cliffs, the trees with branches, the doubled leaf count, the clouds, the
mirroring water, the haze and the far hills went in, and that is the first thing to try. Sound has been measured for level but
still never listened to.

The scene is now about a million triangles in the site, 450,000 to 600,000 in rock, and 280,000 to
340,000 vegetation cards, of which some 200,000 are leaves (thinned to three quarters and to half at the
medium and low levels of detail).
