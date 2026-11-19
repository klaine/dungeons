import { Site } from '../core/site';
import { siteFrame, SiteFrame, toWorld } from '../core/worldLand';
import { drawFootprint, Footprint, footprintOf } from '../maps/footprint';
import { drawInkWorld, inkFrame, WorldMap } from '../maps/inkWorld';
import { KeptSite } from './worldPlace';

const RED = '#9a2a1c', INK = '#1d1a17';

/**
 * The world's ink map in the game, for a place built in a world (`M` a second time, from the plan made large): the world about the
 * place, with the place's footprint on it where it lies (`footprintOf`), the footprints of the world's other places that were built
 * beforehand on the world's page, and the player, an arrow the way they face; a kilometre and four fifths across at the least, kept within the world's edges. The map itself is drawn once, the first time it is
 * shown; what is over it, as often as the plan is.
 */
export class WorldView {
  private ink: HTMLCanvasElement | null = null;
  private readonly frame: SiteFrame;
  private readonly own: Footprint | null;
  private readonly others: Footprint[];
  private readonly ink2: ReturnType<typeof inkFrame>;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: WorldMap, site: Site, kept: KeptSite[], here: { kind: string; n: number }) {
    this.frame = siteFrame(site)!;
    this.own = footprintOf(site);
    this.others = kept.filter((k) => !(k.kind === here.kind && k.n === here.n)).map((k) => footprintOf(k.site)).filter((f): f is Footprint => !!f);
    this.ink2 = inkFrame(map.plan);
  }

  /** Whether the map has been drawn yet: the first drawing holds the page still for a second or two. */
  get ready(): boolean { return !!this.ink; }

  draw(player: { x: number; z: number; yaw: number }): void {
    if (!this.ink) { this.ink = document.createElement('canvas'); drawInkWorld(this.ink, this.map); }
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.max(1, Math.round(c.clientWidth * dpr)), H = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d')!, k = this.ink2;
    // What is taken in: a kilometre and four fifths about the place at the least, or all of its footprint with room about it; and
    // not past the world's edge where it can be helped (near the edge the view ran off the world into the map's key).
    const [pu, pv] = toWorld(this.frame, this.frame.hx, this.frame.hz), hx = this.map.plan.hx, hz = this.map.plan.hz;
    let reach = 900;
    for (const [x, z] of this.own?.ground ?? []) reach = Math.max(reach, Math.hypot(x - pu, z - pv) * 1.35);
    const metres = (2 * reach) / Math.min(W, H), halfU = (W / 2) * metres, halfV = (H / 2) * metres;
    const cu = halfU < hx ? Math.min(hx - halfU, Math.max(-hx + halfU, pu)) : 0, cv = halfV < hz ? Math.min(hz - halfV, Math.max(-hz + halfV, pv)) : 0;
    const at = (x: number, z: number): [number, number] => [W / 2 + (x - cu) / metres, H / 2 + (z - cv) / metres];
    // The map, the piece of it about the place, scaled to the view.
    const sx = k.X(cu - (W / 2) * metres), sy = k.Z(cv - (H / 2) * metres), sw = (W * metres) * k.scale, sh = (H * metres) * k.scale;
    ctx.fillStyle = '#f1eadb';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.ink, sx, sy, sw, sh, 0, 0, W, H);
    const px = dpr * Math.max(0.8, Math.min(2, 2.2 / metres));
    for (const f of this.others) drawFootprint(ctx, f, at, { ink: RED, scale: px });
    if (this.own) drawFootprint(ctx, this.own, at, { ink: RED, scale: px, strong: true });
    // The player: an arrow the way they face, turned into the world as the place is.
    const [wx, wz] = toWorld(this.frame, player.x, player.z), [qx, qy] = at(wx, wz);
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), cs = Math.cos(this.frame.turn), sn = Math.sin(this.frame.turn);
    const dx = cs * fx - sn * fz, dz = sn * fx + cs * fz, a = Math.atan2(dz, dx), r = 9 * dpr;
    ctx.save();
    ctx.translate(qx, qy); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.7, r * 0.6); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.7, -r * 0.6); ctx.closePath();
    ctx.fillStyle = INK; ctx.strokeStyle = '#f1eadb'; ctx.lineWidth = 2 * dpr; ctx.stroke(); ctx.fill();
    ctx.restore();
    // And how far a kilometre is, in the corner.
    const km = 1000 / metres, y = H - 14 * dpr, x0 = 14 * dpr;
    ctx.fillStyle = INK; ctx.fillRect(x0, y, km, 3 * dpr);
    ctx.font = `italic ${12 * dpr}px Georgia, serif`; ctx.fillText('one kilometre', x0, y - 6 * dpr);
  }
}
