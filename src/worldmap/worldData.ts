import { HeightField } from '../core/terrain';
import { TILE, World } from '../core/world';
import { WorldMap } from '../maps/inkWorld';

/**
 * What a page is handed of a world made in a worker, and what is kept of it in the browser (`worldStore.ts`): its land on its
 * lattice of 8 metres, its places and lakes, and what its ink map needs (`WorldMap`), which the game draws too, with the
 * footprints of the places built in it; and the grid of its tiles.
 */
export interface WorldData {
  plan: World['plan']; name: string; regions: World['regions']; peakNames: string[]; peaks: World['peaks'];
  places: World['places']; towns: World['towns']; lakes: World['lakes']; rivers: World['rivers']; ways: World['ways'];
  field: { x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array };
  cover: Uint8Array; sea: Uint8Array; lake: Float32Array;
  grid: { stride: number; over: number; hx: number; hz: number };
}

/** Copies, not handed over: the world stays where it was made, its tiles made from it. */
export function worldData(w: World): WorldData {
  const f = w.field;
  return {
    plan: w.plan, name: w.name, regions: w.regions, peakNames: w.peakNames, peaks: w.peaks,
    places: w.places, towns: w.towns, lakes: w.lakes, rivers: w.rivers, ways: w.ways,
    field: { x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data: f.data.slice() },
    cover: w.cover.slice(), sea: w.sea.slice(), lake: w.lake.slice(),
    grid: { stride: TILE.stride, over: TILE.over, hx: w.plan.hx, hz: w.plan.hz },
  };
}

/** The ink map's world from what was handed over; nothing where it was kept by an older page without it. */
export function worldMapOf(d: WorldData): WorldMap | null {
  if (!d.sea || !d.lake || !d.cover || !d.rivers || !d.ways || !d.regions) return null;
  const field = new HeightField(d.field.x0, d.field.z0, d.field.cell, d.field.nx, d.field.nz);
  field.data.set(d.field.data);
  return { plan: d.plan, name: d.name, regions: d.regions, peakNames: d.peakNames, peaks: d.peaks, field, sea: d.sea, lake: d.lake, cover: d.cover, rivers: d.rivers, places: d.places, towns: d.towns, ways: d.ways };
}
