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

`play.cjs` and `roam.cjs` play islands with `PLACE=island`, and take another port with `PORT`.

They launch Chromium with a software renderer, so they work without a graphics card, slowly: a
site takes one to three minutes. On a machine with a graphics card, set `REAL_GPU=1` to open a
window and use it instead (in PowerShell: `$env:REAL_GPU=1; node tools/browser/play.cjs ink-7`).
