import { Site } from '../core/site';
import { HeightField } from '../core/terrain';
import { WorldPlace } from '../core/world';
import { adoptTile, adoptWorldLand, knownWorldLand, placeSeed, tilesNear, WORLD_REACH, WorldLand } from '../core/worldLand';
import { WorldMap } from '../maps/inkWorld';
import { WorldData, worldMapOf } from '../worldmap/worldData';
import { WorldShelf, worldShelf } from './worldStore';

/** A place's layout kept in the browser, laid out beforehand (`placesWorker.ts`): its house's seed with it. */
export interface KeptSite { kind: WorldPlace['kind']; n: number; seed: string; site: Site }

/** The layouts kept of a world's places, those the world's page built beforehand. */
export async function keptSites(shelf: WorldShelf | null, places: WorldPlace[]): Promise<KeptSite[]> {
  if (!shelf) return [];
  const out: KeptSite[] = [];
  for (const q of places) {
    const kept = await shelf.get<{ seed: string; site: Site | null }>(`site:${q.kind}${q.n}`);
    if (kept?.site) out.push({ kind: q.kind, n: q.n, seed: kept.seed, site: kept.site });
  }
  return out;
}

/**
 * A place in a world, for the game (`?world=<seed>&place=valley&n=2`, `docs/06-world.md` step 3):
 * the world made in a worker (the walk page's own, `worldWorker.ts`), so the page goes on painting
 * through the half minute it takes; then the tiles of 5 metres about the place, a second or two each;
 * all taken up here (`adoptWorldLand`), so that the site built on the place reads the world's land.
 * What was made is kept in the browser (`worldStore.ts`), and read back the next time.
 */
export async function loadWorldPlace(seed: string, kind: WorldPlace['kind'], n: number, report: (text: string) => void): Promise<{ land: WorldLand; place: WorldPlace; map: WorldMap | null; sites: KeptSite[] }> {
  const worker = new Worker(new URL('../worldwalk/worldWorker.ts', import.meta.url), { type: 'module' });
  const shelf = await worldShelf(seed);
  let workerHas = false, map: WorldMap | null = null;
  try {
    let land = knownWorldLand(seed);
    if (!land) {
      const kept = await shelf?.get<WorldData>('world');
      if (kept) report('The world, as kept from before');
      const data = kept ?? await new Promise<WorldData>((resolve, reject) => {
        worker.onerror = (e) => reject(new Error(e.message || 'the world could not be made'));
        worker.onmessage = (e) => {
          if (e.data.type === 'progress') report(e.data.text);
          else if (e.data.type === 'world') resolve(e.data.world);
        };
        worker.postMessage({ type: 'world', seed });
        workerHas = true;
      });
      if (!kept) await shelf?.set('world', data);
      map = worldMapOf(data);
      const f = new HeightField(data.field.x0, data.field.z0, data.field.cell, data.field.nx, data.field.nz);
      f.data.set(data.field.data);
      land = adoptWorldLand({ seed, hx: data.plan.hx, hz: data.plan.hz, field: f, tiles: new Map(), places: data.places, lakes: data.lakes });
    }
    const place = land.places.find((q) => q.kind === kind && q.n === n);
    if (!place) {
      const has = land.places.filter((q) => q.kind === kind).length;
      const many = { valley: 'valley heads', island: 'islands', mountain: 'mountain tops', coast: 'coastal towns' }[kind];
      throw new Error(`World “${seed}” has ${has ? `only ${has} ${many}` : `no ${many}`}, not a number ${n}.`);
    }
    // (About an island, its tiles as far as its far shore and beyond, since the site reads all of its coast.)
    const [cx, cz, r] = place.island ? [place.island.cu, place.island.cv, WORLD_REACH + place.island.reach] : [place.x, place.z, WORLD_REACH];
    const need = tilesNear(land, cx, cz, r).filter(([i, j]) => !land!.tiles.has(`${i},${j}`));
    for (let k = 0; k < need.length; k++) {
      report(`Making the land about ${place.name} at five metres (${k + 1} of ${need.length})`);
      const [i, j] = need[k];
      const kept = await shelf?.get<Parameters<typeof adoptTile>[1]>(`${i},${j}`);
      // (A tile is made from the world, which only the worker holds: where the world was kept, the worker makes it first.)
      // (If the worker cannot make it, the place is built without it: its share of the land is the world's lattice of 8 metres.)
      const tile = kept ?? await new Promise<Parameters<typeof adoptTile>[1] | null>((resolve) => {
        worker.onmessage = (e) => { if (e.data.type === 'tile') resolve(e.data.tile); else if (e.data.type === 'progress') report(e.data.text); };
        worker.onerror = (e) => { console.error('a tile of the world could not be made:', e.message); resolve(null); };
        if (!workerHas) { worker.postMessage({ type: 'world', seed }); workerHas = true; }
        worker.postMessage({ type: 'tile', i, j });
      });
      if (!tile) break;
      if (!kept) await shelf?.set(`${i},${j}`, tile);
      adoptTile(land, tile);
    }
    // (The layouts the world's page built beforehand: the game's own place's, if its house is the one built, and every place's footprint.)
    return { land, place, map, sites: await keptSites(shelf, land.places) };
  } finally {
    worker.terminate();
  }
}
