import { HeightField } from '../core/terrain';
import { WorldPlace } from '../core/world';
import { adoptTile, adoptWorldLand, knownWorldLand, tilesNear, WORLD_REACH, WorldLand } from '../core/worldLand';

/**
 * A place in a world, for the game (`?world=<seed>&place=valley&n=2`, `docs/06-world.md` step 3):
 * the world made in a worker (the walk page's own, `worldWorker.ts`), so the page goes on painting
 * through the half minute it takes; then the tiles of 5 metres about the place, a second or two each;
 * all taken up here (`adoptWorldLand`), so that the site built on the place reads the world's land.
 */
export async function loadWorldPlace(seed: string, kind: WorldPlace['kind'], n: number, report: (text: string) => void): Promise<{ land: WorldLand; place: WorldPlace }> {
  const worker = new Worker(new URL('../worldwalk/worldWorker.ts', import.meta.url), { type: 'module' });
  try {
    let land = knownWorldLand(seed);
    if (!land) {
      const data = await new Promise<{ plan: { hx: number; hz: number }; places: WorldPlace[]; field: { x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array } }>((resolve, reject) => {
        worker.onerror = (e) => reject(new Error(e.message || 'the world could not be made'));
        worker.onmessage = (e) => {
          if (e.data.type === 'progress') report(e.data.text);
          else if (e.data.type === 'world') resolve(e.data.world);
        };
        worker.postMessage({ type: 'world', seed });
      });
      const f = new HeightField(data.field.x0, data.field.z0, data.field.cell, data.field.nx, data.field.nz);
      f.data.set(data.field.data);
      land = adoptWorldLand({ seed, hx: data.plan.hx, hz: data.plan.hz, field: f, tiles: new Map(), places: data.places });
    }
    const place = land.places.find((q) => q.kind === kind && q.n === n);
    if (!place) {
      const has = land.places.filter((q) => q.kind === kind).length;
      throw new Error(`World “${seed}” has ${has ? `only ${has} ${kind === 'valley' ? 'valley heads' : kind === 'island' ? 'islands' : 'mountain tops'}` : `no ${kind === 'valley' ? 'valley heads' : kind === 'island' ? 'islands' : 'mountain tops'}`}, not a number ${n}.`);
    }
    // (About an island, its tiles as far as its far shore and beyond, since the site reads all of its coast.)
    const [cx, cz, r] = place.island ? [place.island.cu, place.island.cv, WORLD_REACH + place.island.reach] : [place.x, place.z, WORLD_REACH];
    const need = tilesNear(land, cx, cz, r).filter(([i, j]) => !land!.tiles.has(`${i},${j}`));
    for (let k = 0; k < need.length; k++) {
      report(`Making the land about ${place.name} at five metres (${k + 1} of ${need.length})`);
      const [i, j] = need[k];
      const tile = await new Promise<Parameters<typeof adoptTile>[1]>((resolve) => {
        worker.onmessage = (e) => { if (e.data.type === 'tile') resolve(e.data.tile); };
        worker.postMessage({ type: 'tile', i, j });
      });
      adoptTile(land, tile);
    }
    return { land, place };
  } finally {
    worker.terminate();
  }
}
