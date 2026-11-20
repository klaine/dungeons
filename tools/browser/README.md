# Checks in a browser

These drive the real program in a headless browser, with the player's own body, and report what
happened. They need Playwright with Chromium (`npm install --no-save playwright` and
`npx playwright install chromium`), and the development server running on port 5173
(`npx vite --port 5173 --strictPort`).

| Script | What it does |
|---|---|
| `node tools/browser/play.cjs <seed> …` | Walks every doorway in both directions, then follows the solver's route from where the player arrives to the end of the game. |
| `node tools/browser/roam.cjs <seed> …` | Drives the player at the edges of the valley from thirty-six directions, jumping, and reports anyone who got out or fell through. Then walks to each thing left in the valley and checks it is picked up. |
| `node tools/browser/lighthouse.cjs <seed> …` | On islands: walks in at the lighthouse door, up the stair round the newel, out onto the gallery and round to the spyglass, and reports how far it got. |
| `node tools/browser/walk.cjs <folder> <seed> [place …]` | On the walk page (`walk.html`), goes to each place (`valley1`, `island2`, `mountain3`), waits until the land about it is streamed in and meshed, reports how long that took and the triangles, and keeps three pictures: from forty metres up, and from above as it is and as its triangles. |
| `node tools/browser/worldmap.cjs <folder> <seed> …` | Makes each world on the world page (`world.html`) and saves its ink map and its relief as PNG files. Needs no graphics: the maps are drawn in two dimensions. |
| `node tools/browser/jetty.cjs <seed> …` | Walks out along the landing stage and reports the player's height at each step, to show they stayed on the deck. |
| `node tools/browser/houses.cjs <seed> …` | Walks into houses of brick and canal houses with the player's body: up the stoop or straight in at the front door, to the foot of the stair, up each flight and back along the well to the next, to the top storey; a spread of the houses of every plan, `HOUSES` of them (6). `PLACE=town` (the default) walks a harbour town's canal houses, `PLACE=valley` a valley given a town of brick. Reports how far each got, and its feet's height at the end against the top floor. |
| `node tools/browser/crew.cjs <folder>` | On the building lab (`lab/buildings.html`, port 5179): figures given orders as a click would give them, on the lab's own buildings: round the classical building to behind it, in at its door and up its stair to the first and second floors and out again, onto rock painted on the square, onto the bench before a timber house to sit, and one figure talking to another and punching it; says of each whether it came to what it should. |
| `node tools/browser/figures.cjs <folder>` | On the figure lab (`lab/figures.html`, port 5180): the figures' three paces and creeping, sitting on the bench and lying on a bedroll and getting up, climbing the ledges of 1.0 and 1.25 and not that of 1.6, sent onto a ledge, up the stair and the ramp, a hard landing off the platform, and clips that carry a figure along; says of each whether it came to what it should, and keeps pictures. The figures are stepped by the script, so slow drawing does not matter. |
| `node tools/browser/stage.cjs <job.json \| folder>` | Pictures of buildings of brick on a stage of their own, in a plain setting (the valley put out of sight, the game's sky, sun and materials kept): rows of houses dealt as a town deals them, each row of one country's clay, from the poses given; Hanseatic brick houses and churches, or canal houses (`"style": "canal"`, with `want` fixing what is asked of each). Given a folder, it loads a valley once and photographs every job put into it. See the head of the script for the job's form; it wants a development server with hot reloading off, on port 5174. |

`play.cjs` and `roam.cjs` play islands with `PLACE=island`, and take another port with `PORT`. `play.cjs` builds on a world's places with `WORLD=w2` (`PLACE=town` for its coastal towns), each seed given as `seed:n` for the `n`th place of the kind (`WORLD=w2 node tools/browser/play.cjs land0:1 land1:2`); a world takes some minutes more in software.

They launch Chromium with a software renderer, so they work without a graphics card, slowly: a
site takes one to three minutes. On a machine with a graphics card, set `REAL_GPU=1` to open a
window and use it instead (in PowerShell: `$env:REAL_GPU=1; node tools/browser/play.cjs ink-7`).
