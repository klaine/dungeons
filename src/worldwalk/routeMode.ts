import { Vector3 } from 'three';
import { RouteEnd } from '../core/route';
import { Site } from '../core/site';
import { SQUARE, squareCount, squareOrigin, TileGrid } from '../core/stream';
import { trackField, Way, WayIndex } from '../core/way';
import { COVER } from '../core/world';
import { drawFootprint, Footprint, footprintOf } from '../maps/footprint';
import { drawInkWorld, inkFrame, InkArea, WorldMap } from '../maps/inkWorld';
import type { WorldPlaces } from './places';

/**
 * The walk page as the route page (`lab/route.html`; asked: "lets try this with one traversable path from a town to a valley"): one
 * way from a coastal town to the valley head nearest it, laid and graded in the world's worker (`route.ts`), its bed cut into the
 * squares at a metre and drawn as a cart track; the walker set down on the town's quay facing along it and kept within a corridor
 * about it (`?broad=`, 300 metres unless asked); squares made only within reach of the corridor, the world's own lattice beyond; a
 * small map of the way; an ink map of the stretch of country the way crosses, with both places and the land about them, the way in red
 * and the walker on it (the world's own ink map, `drawInkWorld`, of that stretch alone; `M` or the Map button); and, while one walks,
 * both places laid out for the game in a worker of their own (`placesWorker.ts`), drawn on the ink map as they are built (their
 * streets, buildings and grounds), and kept in the browser, so that entering either from here builds it without making the world or
 * laying it out again (in a build only: in development nothing is kept).
 */

/** What the world's worker sends back for a route: every town's way to its nearest valley head, and the one to walk with its bed. */
export interface RouteReply {
  routes: { from: RouteEnd; to: RouteEnd; length: number }[];
  route: { from: RouteEnd; to: RouteEnd; line: [number, number][]; length: number } | null;
  way: Way | null;
  climb: { up: number; down: number; steepest: number } | null;
}

/** How fast the walker goes, metres a second, walking and running: the game's own body's pace (`Player`). */
const PACE = { walk: 3.2, run: 6.5 };
/** How much country the ink map shows beyond the way and its two places, metres; and how broad the sheet is drawn, pixels. */
const INK_MARGIN = 450, INK_PIXELS = 1800;

export class RouteWalk {
  readonly way: Way;
  readonly ix: WayIndex;
  readonly from: RouteEnd;
  readonly to: RouteEnd;
  readonly length: number;
  readonly half: number;
  private readonly along: number[] = [0];
  private readonly wanted = new Set<string>();
  private readonly map: HTMLCanvasElement | null;
  /** Where along the way the walker is, how far off its middle, and whether the corridor's edge held them this frame. */
  s = 0;
  off = 0;
  held = false;
  /** How the laying out of the two places for the game goes, as said to the walker; and which are ready. */
  ahead = '';
  ready = new Set<string>();
  private builder: WorldPlaces | null = null;
  /** The places laid out ahead, as footprints for the ink map; the ink map's sheet once drawn, and the stretch it shows. */
  private prints: Footprint[] = [];
  private inkBase: HTMLCanvasElement | null = null;
  private inkArea: InkArea | null = null;
  private world: WorldMap | null = null;

  constructor(private readonly reply: RouteReply & { route: NonNullable<RouteReply['route']>; way: Way }, private readonly o: { seed: string; grid: TileGrid; broad: number; beyond: number; game: string; size?: { x: number; z: number } }) {
    this.way = reply.way; this.ix = new WayIndex(reply.way); this.from = reply.route.from; this.to = reply.route.to;
    this.length = reply.route.length; this.half = o.broad / 2;
    const p = this.way.points;
    for (let k = 1; k < p.length; k++) this.along.push(this.along[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
    // The squares within reach of the corridor: its half-breadth and as far again beyond (`?beyond=`), so that the land seen over its edge
    // is the land at a metre, and only further off the world's own lattice.
    const [SX, SZ] = squareCount(o.grid), reach = this.half + o.beyond;
    for (const [x, z] of p) {
      for (let j = Math.floor((z - reach + o.grid.hz) / SQUARE.size); j <= Math.floor((z + reach + o.grid.hz) / SQUARE.size); j++)
        for (let i = Math.floor((x - reach + o.grid.hx) / SQUARE.size); i <= Math.floor((x + reach + o.grid.hx) / SQUARE.size); i++) {
          if (i < 0 || j < 0 || i >= SX || j >= SZ) continue;
          const [x0, z0] = squareOrigin(o.grid, i, j), d = Math.hypot(Math.max(0, x0 - x, x - x0 - SQUARE.size), Math.max(0, z0 - z, z - z0 - SQUARE.size));
          if (d <= reach) this.wanted.add(`${i},${j}`);
        }
    }
    this.map = document.getElementById('routemap') as HTMLCanvasElement | null;
  }

  /** Where the walker starts: on the town's quay, a few metres along the way, facing along it. */
  start(): { x: number; z: number; yaw: number } {
    const p = this.way.points, a = p[Math.min(2, p.length - 1)], b = p[Math.min(8, p.length - 1)];
    return { x: a[0], z: a[1], yaw: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) };
  }

  /** Whether a square is wanted at all: within reach of the corridor. */
  wantsSquare(i: number, j: number): boolean { return this.wanted.has(`${i},${j}`); }
  get squaresInReach(): number { return this.wanted.size; }

  /** The ground's track field at a point: how far to one side of the way's middle, plus a hundred; nothing off it. */
  track(x: number, z: number): number { return trackField([this.ix], x, z); }

  /**
   * What lies at a point for what grows there: on the way's bed and a little either side, shingle, where nothing grows; trees kept
   * further off, so that none stands in the way or leans over it.
   */
  coverFor(coverAt: (x: number, z: number) => number, clear: number): (x: number, z: number) => number {
    return (x, z) => { const n = this.ix.near(x, z); return n && n.d < this.way.half + clear ? COVER.shore : coverAt(x, z); };
  }

  /** The nearest point of the way's middle line: how far along it, and how far off. */
  private nearest(x: number, z: number): { s: number; d: number; px: number; pz: number } {
    const p = this.way.points;
    let best = { s: 0, d: Infinity, px: p[0][0], pz: p[0][1] };
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0], az = p[k - 1][1], dx = p[k][0] - ax, dz = p[k][1] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0, px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { s: this.along[k - 1] + (this.along[k] - this.along[k - 1]) * t, d, px, pz };
    }
    return best;
  }

  /** Keeps the walker within the corridor: if they have gone further from the way's middle than half its breadth, back onto its edge. */
  keepIn(me: Vector3): void {
    const n = this.nearest(me.x, me.z);
    this.held = n.d > this.half;
    if (this.held) { const k = this.half / n.d; me.x = n.px + (me.x - n.px) * k; me.z = n.pz + (me.z - n.pz) * k; }
    this.s = n.s; this.off = Math.min(n.d, this.half);
  }

  /** Whether the walker has come to the valley head: near the end of the way. */
  get arrived(): boolean { return this.length - this.s < 40; }

  /** The lines the page's panel shows about the way. */
  lines(): string[] {
    const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`), left = Math.max(0, this.length - this.s), c = this.reply.climb;
    const mins = (m: number, v: number) => { const s = m / v; return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`; };
    return [
      `${this.from.name} to ${this.to.name}: ${km(this.length)}${c ? `, up ${Math.round(c.up)} m and down ${Math.round(c.down)} m, at steepest ${(c.steepest * 100).toFixed(0)}%` : ''}`,
      this.arrived ? `You have come to ${this.to.name}.` : `${km(this.s)} walked, ${km(left)} to go: ${mins(left, PACE.walk)} walking, ${mins(left, PACE.run)} running`,
      this.held ? `The corridor is ${Math.round(this.half * 2)} m broad: this is its edge.` : `${Math.round(this.off)} m off the way, in a corridor ${Math.round(this.half * 2)} m broad`,
      [this.to, this.from].some((e) => this.ready.has(`${e.kind}${e.n}`)) ? `Laid out for the game: ${[this.to, this.from].filter((e) => this.ready.has(`${e.kind}${e.n}`)).map((e) => e.name).join(' and ')}.` : '',
    ].filter(Boolean);
  }

  /** The menu of every town's way to its nearest valley head, and the links into the game at either end. */
  wire(): void {
    const menu = document.getElementById('where') as HTMLSelectElement | null;
    if (menu) {
      const spec = (e: RouteEnd) => `${e.kind}${e.n}`;
      menu.innerHTML = this.reply.routes.map((r) => `<option value="${spec(r.from)}|${spec(r.to)}">${r.from.name} to ${r.to.name}, ${(r.length / 1000).toFixed(2)} km</option>`).join('');
      menu.value = `${spec(this.from)}|${spec(this.to)}`;
      if (menu.value !== `${spec(this.from)}|${spec(this.to)}`) menu.insertAdjacentHTML('afterbegin', `<option value="${spec(this.from)}|${spec(this.to)}" selected>${this.from.name} to ${this.to.name}, ${(this.length / 1000).toFixed(2)} km</option>`);
      menu.addEventListener('change', () => {
        const [from, to] = menu.value.split('|');
        location.hash = new URLSearchParams({ world: this.o.seed, from, to }).toString(); location.reload();
      });
    }
    const link = (id: string, e: RouteEnd) => {
      const a = document.getElementById(id) as HTMLAnchorElement | null;
      if (!a) return;
      a.textContent = `Enter ${e.name}`;
      a.href = `${this.o.game}#${new URLSearchParams({ world: this.o.seed, place: e.kind === 'coast' ? 'town' : e.kind, n: String(e.n) })}`;
      a.hidden = false;
    };
    link('enter-from', this.from);
    link('enter-to', this.to);
  }

  /** Marks the link into the valley head when the walker has come to it. */
  markArrival(): void { document.getElementById('enter-to')?.classList.toggle('ready', this.arrived); }

  /**
   * Lays out both places for the game while one walks, the place the way goes to first, in the worker that builds places into the world
   * (`WorldPlaces`: the world made there once, for both), and keeps them in the browser with the world and its tiles, where the game finds
   * them (`worldStore.ts`). The valley head at the way's end is built into the world besides, as one comes near it, and laid out then;
   * here only what is not. Each layout is drawn on the ink map as it comes. (In development nothing is kept.)
   */
  layOutAhead(builder: WorldPlaces): void {
    this.builder = builder;
    const was = builder.onSite;
    builder.onSite = (kind, n, site) => {
      was?.(kind, n, site);
      this.ready.add(`${kind}${n}`);
      try { const fp = footprintOf(site as Site); if (fp) { this.prints.push(fp); this.composeInk(); } } catch { /* (no footprint: the map does without) */ }
    };
    builder.layOut([`${this.to.kind}${this.to.n}`, `${this.from.kind}${this.from.n}`]);
  }

  /** The small map: the corridor, the way, its two ends, and the walker, north up. */
  drawMap(me: Vector3, yaw: number): void {
    const c = this.map;
    if (!c) return;
    const css = c.clientWidth || 160, dpr = Math.min(2, devicePixelRatio || 1), px = Math.round(css * dpr);
    if (c.width !== px) { c.width = px; c.height = px; }
    const g = c.getContext('2d');
    if (!g) return;
    const p = this.way.points;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = this.half + 20, span = Math.max(x1 - x0, z1 - z0) + 2 * pad, k = px / span, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const at = (x: number, z: number): [number, number] => [px / 2 + (x - cx) * k, px / 2 + (z - cz) * k];
    g.clearRect(0, 0, px, px);
    const line = (width: number, colour: string) => {
      g.beginPath(); p.forEach(([x, z], i) => { const [a, b] = at(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
      g.lineWidth = width; g.strokeStyle = colour; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    };
    line(this.half * 2 * k, 'rgba(224, 176, 112, 0.22)');
    line(Math.max(2, 2 * dpr), 'rgba(232, 226, 214, 0.95)');
    const dot = (x: number, z: number, colour: string) => { const [a, b] = at(x, z); g.beginPath(); g.arc(a, b, 4.5 * dpr, 0, Math.PI * 2); g.fillStyle = colour; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#0c0b0a'; g.stroke(); };
    dot(this.from.x, this.from.z, '#e8e2d6');
    dot(this.to.x, this.to.z, '#e0b070');
    // (The walker, an arrow the way they face: forward is (-sin yaw, -cos yaw) in the world, east to the right and south down.)
    const [a, b] = at(me.x, me.z), fx = -Math.sin(yaw), fz = -Math.cos(yaw), r = 7 * dpr;
    g.beginPath(); g.moveTo(a + fx * r, b + fz * r); g.lineTo(a - fx * r * 0.6 + fz * r * 0.55, b - fz * r * 0.6 - fx * r * 0.55); g.lineTo(a - fx * r * 0.6 - fz * r * 0.55, b - fz * r * 0.6 + fx * r * 0.55); g.closePath();
    g.fillStyle = '#ff6040'; g.fill();
  }

  /** The world, for the ink map (what the world's worker handed the page). */
  setWorld(map: WorldMap | null): void { this.world = map; }

  /** Opens or closes the ink map; drawn the first time it is opened. */
  toggleInk(open?: boolean): void {
    const panel = document.getElementById('inkpanel');
    if (!panel) return;
    const show = open ?? panel.hidden;
    panel.hidden = !show;
    document.getElementById('mapbutton')?.setAttribute('aria-pressed', String(show));
    if (show && !this.inkBase) this.drawInk();
  }

  /** The ink map of the stretch: the way and its two places with `INK_MARGIN` about them, drawn once, then the places' footprints over it. */
  private drawInk(): void {
    if (!this.world) return;
    const p = this.way.points, xs = [...p.map((q) => q[0]), this.from.x, this.to.x], zs = [...p.map((q) => q[1]), this.from.z, this.to.z];
    const hx = this.world.plan.hx, hz = this.world.plan.hz;
    const area: InkArea = { x0: Math.max(-hx, Math.min(...xs) - INK_MARGIN), x1: Math.min(hx, Math.max(...xs) + INK_MARGIN), z0: Math.max(-hz, Math.min(...zs) - INK_MARGIN), z1: Math.min(hz, Math.max(...zs) + INK_MARGIN) };
    const c = this.reply.climb, km = (this.length / 1000).toFixed(2);
    const base = document.createElement('canvas');
    drawInkWorld(base, this.world, {
      pixels: INK_PIXELS,
      stretch: {
        area, route: p, routeName: `The way, ${km} km`,
        title: `From ${this.from.name} to ${this.to.name}`,
        subtitle: `the way from the harbour up to the valley head, ${km} kilometres${c ? `, rising ${Math.round(c.up)} metres` : ''}; in the country of ${this.world.name}`,
      },
    });
    this.inkBase = base; this.inkArea = area;
    this.composeInk();
  }

  /** The sheet, and over it the places laid out ahead so far. */
  private composeInk(): void {
    const ink = document.getElementById('ink') as HTMLCanvasElement | null, me = document.getElementById('inkme') as HTMLCanvasElement | null;
    if (!ink || !this.inkBase || !this.inkArea || !this.world) return;
    ink.width = this.inkBase.width; ink.height = this.inkBase.height;
    if (me) { me.width = ink.width; me.height = ink.height; }
    const g = ink.getContext('2d')!, k = inkFrame(this.world.plan, INK_PIXELS, this.inkArea);
    g.drawImage(this.inkBase, 0, 0);
    // (Clipped to the map's own frame, as the world page's footprints are to the world's.)
    g.save(); g.beginPath(); g.rect(k.edge, k.head, ink.width - 2 * k.edge, k.msz); g.clip();
    for (const fp of this.prints) drawFootprint(g, fp, (x, z) => [k.X(x), k.Z(z)], { ink: '#9a2a1c', scale: Math.max(0.8, INK_PIXELS / 2400), strong: true });
    g.restore();
  }

  /** Where the walker is on the ink map, an arrow the way they face, while it is open. */
  drawInkWalker(me: Vector3, yaw: number): void {
    const c = document.getElementById('inkme') as HTMLCanvasElement | null, panel = document.getElementById('inkpanel');
    if (!c || !panel || panel.hidden || !this.inkArea || !this.world) return;
    const g = c.getContext('2d')!, k = inkFrame(this.world.plan, INK_PIXELS, this.inkArea), u = INK_PIXELS / 2400;
    g.clearRect(0, 0, c.width, c.height);
    const a = k.X(me.x), b = k.Z(me.z), fx = -Math.sin(yaw), fz = -Math.cos(yaw), r = 16 * u;
    g.beginPath(); g.arc(a, b, r * 1.5, 0, Math.PI * 2); g.fillStyle = 'rgba(241, 234, 219, 0.7)'; g.fill();
    g.beginPath(); g.moveTo(a + fx * r, b + fz * r); g.lineTo(a - fx * r * 0.6 + fz * r * 0.6, b - fz * r * 0.6 - fx * r * 0.6); g.lineTo(a - fx * r * 0.25, b - fz * r * 0.25); g.lineTo(a - fx * r * 0.6 - fz * r * 0.6, b - fz * r * 0.6 + fx * r * 0.6); g.closePath();
    g.fillStyle = '#1d1a17'; g.fill();
  }
}
