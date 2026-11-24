import { generateWorldPlace } from '../core/generate';
import { Site } from '../core/site';
import { tilesAt, TileData } from '../core/stream';
import { TILE, World, worldSteps } from '../core/world';
import { landOfWorld, siteFrame, toWorld, WorldLand } from '../core/worldLand';
import { legTo, NetLine, networkLines } from '../core/route';
import { packPlace, packTransfer } from '../render/placePack';
import { worldData } from './worldData';

/**
 * Builds every place a world found, beforehand (the world's page, *Build every place*): the world made as the game's worker makes it,
 * then each place's layout as the game would lay it out, its house the place's own (`placeSeed`), and each tile of 5 metres made for
 * them. All handed to the page as it comes, to be kept in the browser (`worldStore.ts`), where the game finds them: going to a place
 * built beforehand, it neither makes the world nor its tiles nor lays the place out, but builds what was laid out.
 *
 * Asked with `build`, it builds those places too, as the walk and route pages want them standing in the world (`packPlace`): each laid
 * out as above, then meshed, made ready, and handed over as a `pack`. The world is kept between requests, so a page asks one place at
 * a time and the world is made once.
 */
let made: { key: string; w: World; land: WorldLand; sent: Set<string>; net?: NetLine[] } | null = null;
self.onmessage = (e: MessageEvent<{ seed: string; size?: { x: number; z: number }; only?: string[]; build?: string[]; season?: Site['setting']['season']; winterAbove?: number; hour?: Site['setting']['hour'] }>) => {
  const { seed, size, only, build, season, winterAbove, hour } = e.data, key = `${seed}@${size?.x ?? ''}x${size?.z ?? ''}`;
  if (!made || made.key !== key) {
    const steps = worldSteps(seed, size);
    let w: World;
    for (;;) {
      const s = steps.next();
      if (!s.done) { self.postMessage({ type: 'progress', text: s.value }); continue; }
      w = s.value;
      break;
    }
    made = { key, w, land: landOfWorld(w), sent: new Set() };
    self.postMessage({ type: 'world', world: worldData(w) });
  }
  const { w, land, sent } = made;
  // (Only those asked for, in the order asked, where a page wants only some laid out ahead: the route page, the place it goes to first.)
  const specs = build ?? only;
  const places = specs ? specs.flatMap((spec) => w.places.filter((q) => `${q.kind}${q.n}` === spec)) : w.places;
  places.forEach((q, k) => {
    self.postMessage({ type: 'progress', text: `Laying out ${q.name}`, done: k, total: places.length });
    let site: Site | null = null, why = '', house = '';
    try { ({ seed: house, site } = generateWorldPlace(seed, q.kind === 'coast' ? 'town' : q.kind, q.n)); } catch (err) { why = (err as Error).message; }
    // (The tiles made for it, each handed over once.)
    for (const [tk, t] of land.tiles) {
      if (sent.has(tk)) continue;
      sent.add(tk);
      const [i, j] = tk.split(',').map(Number), f = t.field, data = f.data.slice();
      self.postMessage({ type: 'tile', tile: { i, j, ox: t.ox, oz: t.oz, x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, data } }, { transfer: [data.buffer] });
    }
    self.postMessage({ type: 'site', kind: q.kind, n: q.n, seed: house, site, why });
    if (build && site) {
      self.postMessage({ type: 'progress', text: `Building ${q.name}`, done: k, total: places.length });
      try {
        // (In the season and at the hour of the page it stands in: its leaves, its grass, its lamps. The layout kept for the game is its own.)
        // (And a mountain top whose house stands over the page's snow line is built in winter, as the game builds one: its rock buried
        // under the snow, cornices over its rim, snow on its stair, nothing growing but a few dry heads of grass; `winterAbove`.)
        const frame = siteFrame(site), wintry = q.kind === 'mountain' && winterAbove !== undefined && !!frame && frame.base >= winterAbove;
        const built: Site = { ...site, setting: { ...site.setting, ...(wintry ? { season: 'winter' as const } : season ? { season } : {}), ...(hour ? { hour } : {}) } };
        // (The world's own land, as the squares at a metre are made from it: for how far the place's stands off it at its edge.)
        const grid = { stride: TILE.stride, over: TILE.over, hx: w.plan.hx, hz: w.plan.hz };
        const read = [...land.tiles.values()].map((t) => ({ t: { ox: t.ox, oz: t.oz } as TileData, f: t.field }));
        // (A castle's valley's leg, from where its road begins out to the world's ways, as the walk page lays it (`legTo`): cleared
        // and drawn as a track over the place's own land, `packPlace`'s `clear`.)
        let clear: [number, number][] | undefined;
        // (And a mountain top's, from where its own way down the ridge ends, where the player arrives.)
        const sf = siteFrame(built), tr = q.kind === 'mountain' ? built.mountain?.way?.map(([x, z]) => [x, z] as [number, number]) : built.track;
        if ((q.kind === 'valley' || q.kind === 'mountain') && sf && tr?.length && made) { made.net ??= networkLines(w); clear = legTo(w, made.net, (([x, z]) => ({ x, z }))(toWorld(sf, tr[tr.length - 1][0], tr[tr.length - 1][1]))) ?? undefined; }
        const pack = packPlace(built, { kind: q.kind, n: q.n, name: q.name }, (x, z) => tilesAt(read, grid, x, z), { clear, path: q.kind === 'mountain' });
        self.postMessage({ type: 'pack', kind: q.kind, n: q.n, pack }, { transfer: packTransfer(pack) });
      } catch (err) { self.postMessage({ type: 'pack', kind: q.kind, n: q.n, pack: null, why: (err as Error).message }); }
    }
  });
  self.postMessage({ type: 'done' });
};
