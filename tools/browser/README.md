# Checks in a browser

These drive the real program in a headless browser, with the player's own body, and report what
happened. They need Playwright with Chromium (`npm install --no-save playwright` and
`npx playwright install chromium`), and the development server running on port 5173
(`npx vite --port 5173 --strictPort`).

| Script | What it does |
|---|---|
| `node tools/browser/play.cjs <seed> …` | Walks every doorway in both directions, then follows the solver's route from where the player arrives to the end of the game. |
| `node tools/browser/roam.cjs <seed> …` | Drives the player at the edges of the valley from thirty-six directions, jumping, and reports anyone who got out or fell through. Then walks to each thing left in the valley and checks it is picked up. |
| `node tools/browser/jetty.cjs <seed> …` | Walks out along the landing stage and reports the player's height at each step, to show they stayed on the deck. |

They launch Chromium with a software renderer, so they work without a graphics card, slowly: a
site takes one to three minutes. On a machine with a graphics card, set `REAL_GPU=1` to open a
window and use it instead (in PowerShell: `$env:REAL_GPU=1; node tools/browser/play.cjs ink-7`).
