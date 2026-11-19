import { Site } from '../core/site';
import { outlineOf } from '../core/town';
import { siteFrame, toWorld } from '../core/worldLand';

/**
 * A place's footprint in its world, for the world's ink map: what was built there, laid where the place lies in the world
 * (`siteFrame`), in the world's own coordinates (metres east and south of its middle). `ground` is the ground the place takes,
 * as one ring: a valley's two sides from the house to the gap, an island's coast, a mountain top's rim (a town has none). `solid`
 * are what is built, each a ring: the house's rooms, the buildings and, in a town, its storehouses and shacks. `ways` are lines:
 * the track and paths, a town's streets, its quay and moles. Nothing for a place not built in a world.
 */
export interface Footprint { ground: [number, number][]; solid: [number, number][][]; ways: [number, number][][] }

export function footprintOf(site: Site): Footprint | null {
  const f = siteFrame(site);
  if (!f) return null;
  const w = (x: number, z: number) => toWorld(f, x, z);
  const rect = (x0: number, z0: number, x1: number, z1: number) => [w(x0, z0), w(x1, z0), w(x1, z1), w(x0, z1)];
  /** A ring of distances from a point, an even ring of directions from +x towards +z. */
  const ring = (x: number, z: number, r: number[]) => r.map((d, k) => { const a = (k / r.length) * Math.PI * 2; return w(x + Math.cos(a) * d, z + Math.sin(a) * d); });
  /** A thing of `w` by `d` turned by `turn` about its middle. */
  const turned = (x: number, z: number, wd: number, dp: number, turn: number) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const u = (a * wd) / 2, v = (b * dp) / 2; return w(x + c * u - s * v, z + s * u + c * v); });
  };
  let ground: [number, number][] = [];
  const v = site.valley, i = site.island, m = site.mountain, t = site.town;
  if (v) {
    const n = Math.round((v.mouth - v.z0) / v.step) + 1, west: [number, number][] = [], east: [number, number][] = [];
    for (let k = 0; k < n && k < v.west.length; k++) { const z = v.z0 + k * v.step; west.push(w(v.west[k], z)); east.push(w(v.east[k], z)); }
    ground = [...west, ...east.reverse()];
  } else if (i) ground = ring(i.x, i.z, i.coast);
  else if (m) ground = ring(m.x, m.z, m.rim);
  // (A town has none: its land is the whole box it was laid in, nearly a kilometre, which drew as a great slab over the map; its
  // streets, quay, moles and buildings show it well enough.)
  const solid: [number, number][][] = [];
  // (The house's rooms, a storey at a time, those on the ground only: the rest stand over them.)
  for (const q of site.places) if (q.role !== 'approach' && (q.level ?? 0) === 0) solid.push(rect(q.x0, q.z0, q.x1, q.z1));
  for (const b of [...(site.buildings ?? []), ...(t?.buildings ?? [])]) for (const r of outlineOf(b)) solid.push(r.map(([x, z]) => w(x, z)));
  for (const s of t?.storehouses ?? []) solid.push(turned(s.x, s.z, s.w, s.d, s.turn));
  for (const s of t?.shacks ?? []) solid.push(turned(s.x, s.z, s.w, s.d, s.turn));
  for (const c of i?.cottages ?? []) solid.push(turned(c.x, c.z, c.w, c.d, c.faces));
  const ways: [number, number][][] = [];
  if (site.track) ways.push(site.track.map(([x, z]) => w(x, z)));
  for (const p of site.paths ?? []) ways.push(p.points.map(([x, z]) => w(x, z)));
  for (const s of t?.streets ?? []) ways.push(s.line.map(([x, , z]) => w(x, z)));
  if (t) { ways.push([w(t.quay.x0, t.quay.z), w(t.quay.x1, t.quay.z)]); for (const mo of t.moles) ways.push(mo.line.map(([x, z]) => w(x, z))); }
  return { ground, solid, ways };
}

/**
 * Draws a footprint on a map whose point for a point of the world is `at`: the ground in a wash with a thin edge, the ways as fine
 * lines, what is built in solid ink. `strong` for the place one is in.
 */
export function drawFootprint(ctx: CanvasRenderingContext2D, fp: Footprint, at: (x: number, z: number) => [number, number], o: { ink: string; scale: number; strong?: boolean }): void {
  const path = (pts: [number, number][], close: boolean) => {
    ctx.beginPath();
    pts.forEach(([x, z], k) => { const [px, py] = at(x, z); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    if (close) ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (fp.ground.length > 2) {
    path(fp.ground, true);
    ctx.globalAlpha = o.strong ? 0.16 : 0.1; ctx.fillStyle = o.ink; ctx.fill();
    ctx.globalAlpha = o.strong ? 0.85 : 0.55; ctx.strokeStyle = o.ink; ctx.lineWidth = Math.max(0.6, 1.1 * o.scale); ctx.setLineDash([4 * o.scale, 3 * o.scale]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalAlpha = o.strong ? 0.75 : 0.5; ctx.strokeStyle = o.ink; ctx.lineWidth = Math.max(0.5, 0.8 * o.scale);
  for (const l of fp.ways) if (l.length > 1) { path(l, false); ctx.stroke(); }
  ctx.globalAlpha = o.strong ? 0.95 : 0.7; ctx.fillStyle = o.ink;
  for (const r of fp.solid) { path(r, true); ctx.fill(); }
  ctx.restore();
}
