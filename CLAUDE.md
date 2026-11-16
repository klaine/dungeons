# Dungeons

A browser tool that generates places for adventure and lets you walk through them: a house of
rooms and caves built stone by stone, in a valley you can walk, with maps and exports. TypeScript,
Vite, three.js. No server; it is published to GitHub Pages from the `gh-pages` branch by a workflow
on every push to the default branch.

## Where things are written down

- `docs/03-plan.md`: what is built, milestone by milestone, what was asked for, and what is missing. Read "Where things stand" and "Direction received" first.
- `docs/04-look.md`: how it is drawn, the rules for what grows where, and the outdoor target.
- `docs/05-site-format.md`: the site document and what is exported.
- `README.md`: how to run it, controls, URL parameters.

Keep these up to date in the same commit as the change they describe.

## Running and checking

- `npm install`, then `npm run dev` and open the address it prints. `?seed=<text>` picks the place; `?nointro` skips the opening card; `?nobake` skips the light bake.
- `npm run typecheck` and `npm run build` must pass before a commit.
- `npm run check` (`tools/sites.ts`): generates sites and confirms each is connected and completable. Run it after any change to `src/core`.
- `npm run range`: regenerates `public/range.html`, the report of what the generator makes.
- `tools/browser/*.cjs`: drive the real program with the player's body (walk every doorway, play to the end, try to leave the valley). See `tools/browser/README.md`. Run `play.cjs` on a few seeds after any change to the mesher, collision or game.

## How the code is laid out

- `src/core`: the site document (`site.ts`), the generator (`generate.ts`), locks, keys and the solver (`mission.ts`). No rendering.
- `src/render`: site to geometry (`siteMesher.ts`, `geom/`), materials and textures, the light bake (`bake/`), vegetation, water, post-processing.
- `src/app`: the program: main loop, player, game rules, touch, sound.
- `src/maps`, `src/export`, `src/gallery`, `examples/viewer`: maps, exports, the gallery page, and a viewer for exported files.

## Conventions

- Everything a generated place contains is decided in `src/core` and recorded in the site document; the mesher realises it. Maps and exports read the document.
- Stones and timber are closed solids: no face is left open, top or bottom.
- Random choices use `Rng.fork(label)` so that adding a choice does not reshuffle existing sites.
- Comments say why. Plain prose, no jargon.

## What has never been checked

Development so far was on a machine with no graphics card. Frame rate, bake time and feel on real
hardware are unmeasured for the current scene (about a million triangles and 100,000 to 140,000
vegetation cards). Sound was measured for level but never listened to. Treat both as the first
things to look at on a real machine.
