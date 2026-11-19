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
| `node tools/browser/jetty.cjs <seed> …` | Walks out along the landing stage and reports the player's height at each step, to show they stayed on the deck. |
| `node tools/browser/stage.cjs <job.json \| folder>` | Pictures of buildings of brick on a stage of their own, in a plain setting (the valley put out of sight, the game's sky, sun and materials kept): rows of houses dealt as a town deals them, each row of one country's clay, from the poses given; Hanseatic brick houses and churches, or canal houses (`"style": "canal"`, with `want` fixing what is asked of each). Given a folder, it loads a valley once and photographs every job put into it. See the head of the script for the job's form; it wants a development server with hot reloading off, on port 5174. |

`play.cjs` and `roam.cjs` play islands with `PLACE=island`, and take another port with `PORT`.

They launch Chromium with a software renderer, so they work without a graphics card, slowly: a
site takes one to three minutes. On a machine with a graphics card, set `REAL_GPU=1` to open a
window and use it instead (in PowerShell: `$env:REAL_GPU=1; node tools/browser/play.cjs ink-7`).
