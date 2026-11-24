import { Group, Material, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { Rng } from '../core/rng';
import type { Site } from '../core/site';
import type { Way } from '../core/way';
import type { WorldPlace } from '../core/world';
import type { SiteFrame } from '../core/worldLand';
import { drawInkWorld, inkFrame, WorldMap } from '../maps/inkWorld';
import { drawPlan, placeAt } from '../maps/plan';
import { layBoat } from '../render/coast';
import { Kit } from '../render/geom/kit';
import { intoSite } from '../render/placePack';

/**
 * Getting about a world, as step 4 of the world as the game has it (`docs/06-world.md`): its ink map, with the ways and the places
 * standing, where the walker is, and a place clicked on gone to (`WalkMap`); the plan of the place one is in, in the corner, as the game
 * draws it (`PlacePlan`); riding along the ways, faster than walking (`Rider`); and the ferry, the game's boat over the sea from a
 * harbour to an island (`Ferry`).
 */

const MAP_PIXELS = 1800;

/** The world's ink map, drawn once; over it the ways and the places standing, and the walker; a place clicked on is gone to. */
export class WalkMap {
  private readonly panel: HTMLDivElement;
  private readonly sheet: HTMLCanvasElement;
  private readonly over: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  private drawnAt = -Infinity;
  constructor(private readonly world: WorldMap, private readonly o: { places: WorldPlace[]; go: (spec: string) => void; reached: () => Set<string> }) {
    const css = document.createElement('style');
    css.textContent = `#walkmap { position: fixed; inset: 0; z-index: 6; background: rgba(12, 11, 10, 0.6); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
      #walkmap[hidden] { display: none; }
      #walkmap .sheet { position: relative; line-height: 0; box-shadow: 0 6px 30px rgba(0, 0, 0, 0.5); }
      #walkmap canvas { display: block; max-width: calc(100vw - 24px); max-height: calc(100vh - 56px); width: auto; height: auto; }
      #walkmap canvas.over { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; cursor: pointer; }
      #walkmap p { margin: 0; padding: 3px 10px; border-radius: 6px; background: rgba(20, 18, 16, 0.75); color: #ece6da; font: 13px/1.4 system-ui, sans-serif; }
      #placeplan { position: fixed; right: 16px; top: 64px; width: 190px; height: 190px; border-radius: 4px; cursor: pointer; z-index: 3; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
      #placeplan.big { width: min(72vmin, 620px); height: min(72vmin, 620px); }
      #placeplan[hidden] { display: none; }`;
    document.head.appendChild(css);
    this.panel = document.createElement('div');
    this.panel.id = 'walkmap'; this.panel.hidden = true;
    const holder = document.createElement('div'); holder.className = 'sheet';
    this.sheet = document.createElement('canvas'); this.sheet.setAttribute('aria-label', 'Ink map of the world');
    this.over = document.createElement('canvas'); this.over.className = 'over';
    holder.append(this.sheet, this.over);
    const note = document.createElement('p');
    note.textContent = 'Click a place to go there (its name in red once you have been to it) · M or Escape to close';
    this.panel.append(holder, note);
    document.body.appendChild(this.panel);
    this.over.addEventListener('click', (e) => this.clicked(e));
    this.panel.addEventListener('click', (e) => { if (e.target === this.panel) this.toggle(false); });
  }

  get open(): boolean { return !this.panel.hidden; }

  /** Opens or closes it; the sheet is drawn the first time. */
  toggle(open?: boolean): void {
    const show = open ?? this.panel.hidden;
    this.panel.hidden = !show;
    if (show && !this.base) {
      this.base = document.createElement('canvas');
      drawInkWorld(this.base, this.world, { pixels: MAP_PIXELS });
      this.sheet.width = this.base.width; this.sheet.height = this.base.height;
      this.sheet.getContext('2d')!.drawImage(this.base, 0, 0);
    }
    if (show) document.exitPointerLock?.();
  }

  /** The ways walked (in red-brown, a path dotted), the places standing and reached, and the walker, while it is open (a few times a second). */
  update(now: number, me: Vector3, yaw: number, ways: Way[], standing: string[]): void {
    if (!this.open || !this.base || now - this.drawnAt < 250) return;
    this.drawnAt = now;
    const c = this.over, k = inkFrame(this.world.plan, MAP_PIXELS), u = MAP_PIXELS / 2400;
    c.width = this.sheet.width; c.height = this.sheet.height;
    const g = c.getContext('2d')!;
    g.save(); g.beginPath(); g.rect(k.edge, k.head, c.width - 2 * k.edge, k.msz); g.clip();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const w of ways) {
      g.beginPath();
      w.points.forEach(([x, z], i) => (i ? g.lineTo(k.X(x), k.Z(z)) : g.moveTo(k.X(x), k.Z(z))));
      g.strokeStyle = 'rgba(241, 234, 219, 0.8)'; g.lineWidth = 6 * u; g.setLineDash([]); g.stroke();
      g.strokeStyle = '#8a3a22'; g.lineWidth = (w.half > 1 ? 3.2 : 2) * u; g.setLineDash(w.half > 1 ? [] : [7 * u, 5 * u]); g.stroke();
    }
    g.setLineDash([]);
    const reached = this.o.reached();
    for (const q of this.o.places) {
      const spec = `${q.kind}${q.n}`, a = k.X(q.x), b = k.Z(q.z), on = standing.includes(spec);
      g.beginPath(); g.arc(a, b, (on ? 15 : 11) * u, 0, Math.PI * 2);
      g.fillStyle = on ? 'rgba(165, 67, 42, 0.35)' : 'rgba(241, 234, 219, 0.5)'; g.fill();
      g.lineWidth = 2.5 * u; g.strokeStyle = reached.has(spec) ? '#a5432a' : '#2b241c'; g.stroke();
    }
    // The walker: an arrow the way they face.
    const a = k.X(me.x), b = k.Z(me.z), fx = -Math.sin(yaw), fz = -Math.cos(yaw), r = 18 * u;
    g.beginPath(); g.arc(a, b, r * 1.5, 0, Math.PI * 2); g.fillStyle = 'rgba(241, 234, 219, 0.75)'; g.fill();
    g.beginPath(); g.moveTo(a + fx * r, b + fz * r); g.lineTo(a - fx * r * 0.6 + fz * r * 0.6, b - fz * r * 0.6 - fx * r * 0.6); g.lineTo(a - fx * r * 0.25, b - fz * r * 0.25); g.lineTo(a - fx * r * 0.6 - fz * r * 0.6, b - fz * r * 0.6 + fx * r * 0.6); g.closePath();
    g.fillStyle = '#1d1a17'; g.fill();
    g.restore();
  }

  /** The place nearest a click, within a little of its mark, gone to. */
  private clicked(e: MouseEvent): void {
    if (!this.base) return;
    const rect = this.over.getBoundingClientRect(), sx = ((e.clientX - rect.left) / rect.width) * this.over.width, sz = ((e.clientY - rect.top) / rect.height) * this.over.height;
    const k = inkFrame(this.world.plan, MAP_PIXELS);
    let best: WorldPlace | null = null, bd = 60 * (MAP_PIXELS / 2400);
    for (const q of this.o.places) { const d = Math.hypot(k.X(q.x) - sx, k.Z(q.z) - sz); if (d < bd) { bd = d; best = q; } }
    if (best) { this.toggle(false); this.o.go(`${best.kind}${best.n}`); }
  }
}

/** What the plan of the place one is in is drawn from: its site, its frame in the world, and how its game stands. */
export interface PlanOf {
  site: Site; frame: SiteFrame;
  game?: { visited: Set<number>; shut: Set<number>; items: Site['items']; levers: Site['levers'] };
}

/** The plan of the place one is in, in the corner, as the game draws it as one goes (`drawPlan`): click it for a larger one. */
export class PlacePlan {
  private readonly canvas: HTMLCanvasElement;
  private drawnAt = -Infinity;
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'placeplan'; this.canvas.hidden = true; this.canvas.width = this.canvas.height = 380;
    this.canvas.setAttribute('aria-label', 'Plan of the place you are in');
    this.canvas.addEventListener('click', () => this.canvas.classList.toggle('big'));
    document.body.appendChild(this.canvas);
  }

  /** Drawn a few times a second while one is in a place; hidden out of every place. */
  update(now: number, at: PlanOf | null, me: Vector3, yaw: number): void {
    if (!at) { this.canvas.hidden = true; return; }
    this.canvas.hidden = false;
    if (now - this.drawnAt < 200) return;
    this.drawnAt = now;
    const f = at.frame, [x, z] = intoSite(f, me.x, me.z), y = me.y - (f.base - f.floor), here = placeAt(at.site, x, z, y);
    const big = this.canvas.classList.contains('big');
    drawPlan(this.canvas, at.site, {
      player: { x, z, yaw: yaw + f.turn }, labels: big,
      visited: at.game?.visited, shut: at.game?.shut, items: at.game?.items, levers: at.game?.levers,
      valley: (here?.role ?? 'approach') === 'approach', level: here?.level ?? 0,
      pixels: big ? 760 : 380,
    });
  }
}

/** A way's points with how far along each lies, for riding it. */
interface Along { way: Way; s: number[] }
const alongOf = (way: Way): Along => {
  const s = [0];
  for (let k = 1; k < way.points.length; k++) s.push(s[k - 1] + Math.hypot(way.points[k][0] - way.points[k - 1][0], way.points[k][1] - way.points[k - 1][1]));
  return { way, s };
};
const pointAt = (a: Along, s: number): [number, number] => {
  const p = a.way.points, n = p.length;
  if (s <= 0) return p[0];
  if (s >= a.s[n - 1]) return p[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a.s[m] <= s) lo = m; else hi = m; }
  const t = (s - a.s[lo]) / Math.max(1e-6, a.s[hi] - a.s[lo]);
  return [p[lo][0] + (p[hi][0] - p[lo][0]) * t, p[lo][1] + (p[hi][1] - p[lo][1]) * t];
};

/**
 * Riding along the ways, faster than walking for the kilometres between places (`R`): carried along the way one stands on, the way one
 * faces, at a cart's pace (four times a walk; with Shift, a gallop's), looking about as one likes; at a way's end, on along another that
 * goes on from there, if one does. Stopped by `R` again, by walking, by coming into a place, or at the end of the ways.
 */
export class Rider {
  private on: { a: Along; s: number; dir: 1 | -1; from: Way } | null = null;
  private alongs = new Map<Way, Along>();
  get riding(): boolean { return !!this.on; }

  /** Starts riding the way nearest (within a few metres), the way one faces along it; or stops. Says whether one is riding now. */
  toggle(ways: Way[], me: Vector3, yaw: number): boolean {
    if (this.on) { this.on = null; return false; }
    let best: { a: Along; s: number; d: number; k: number } | null = null;
    for (const w of ways) {
      const a = this.along(w), p = w.points;
      for (let k = 1; k < p.length; k++) {
        const ax = p[k - 1][0], az = p[k - 1][1], dx = p[k][0] - ax, dz = p[k][1] - az, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((me.x - ax) * dx + (me.z - az) * dz) / l2)) : 0, d = Math.hypot(me.x - ax - dx * t, me.z - az - dz * t);
        if (d < (best?.d ?? 8)) best = { a, s: a.s[k - 1] + (a.s[k] - a.s[k - 1]) * t, d, k };
      }
    }
    if (!best) return false;
    const p = best.a.way.points, dx = p[best.k][0] - p[best.k - 1][0], dz = p[best.k][1] - p[best.k - 1][1];
    const dir: 1 | -1 = dx * -Math.sin(yaw) + dz * -Math.cos(yaw) >= 0 ? 1 : -1;
    this.on = { a: best.a, s: best.s, dir, from: best.a.way };
    return true;
  }

  stop(): void { this.on = null; }

  /** Carried on by `dt` seconds: where one is now on the level, and which way one goes; null when one has stopped. */
  step(dt: number, ways: Way[], fast: boolean): { x: number; z: number; heading: number } | null {
    const o = this.on;
    if (!o) return null;
    // (The ways are graded again as places come and go: ride the one that is the same line, as it now is.)
    if (!ways.includes(o.a.way)) { const same = ways.find((w) => w.points === o.a.way.points); if (same) o.a = this.along(same); else { this.on = null; return null; } }
    o.s += o.dir * (fast ? 30 : 13) * dt;
    const end = o.a.s[o.a.s.length - 1];
    if (o.s < 0 || o.s > end) {
      // At the end: on along another way going on from here, the one that goes on most nearly straight; else stop.
      const [ex, ez] = pointAt(o.a, o.s < 0 ? 0 : end), back = pointAt(o.a, o.s < 0 ? 12 : end - 12), hx = ex - back[0], hz = ez - back[1];
      let next: { a: Along; s: number; dir: 1 | -1; score: number } | null = null;
      for (const w of ways) {
        if (w === o.a.way) continue;
        const a = this.along(w), p = w.points;
        for (let k = 0; k < p.length; k++) {
          if (Math.hypot(p[k][0] - ex, p[k][1] - ez) > 14) continue;
          for (const dir of [1, -1] as const) {
            const q = pointAt(a, a.s[k] + dir * 12), gx = q[0] - p[k][0], gz = q[1] - p[k][1];
            const score = (gx * hx + gz * hz) / (Math.hypot(gx, gz) * Math.hypot(hx, hz) + 1e-6);
            if ((k === 0 && dir < 0) || (k === p.length - 1 && dir > 0)) continue;
            if (!next || score > next.score) next = { a, s: a.s[k], dir, score };
          }
        }
      }
      if (!next || next.score < -0.2) { this.on = null; return null; }
      this.on = { a: next.a, s: next.s, dir: next.dir, from: o.from };
      return this.step(0, ways, fast);
    }
    const [x, z] = pointAt(o.a, o.s), ahead = pointAt(o.a, o.s + o.dir * 6);
    return { x, z, heading: Math.atan2(-(ahead[0] - x), -(ahead[1] - z)) };
  }

  private along(w: Way): Along { let a = this.alongs.get(w); if (!a) this.alongs.set(w, (a = alongOf(w))); return a; }
}

/**
 * The ferry: the game's own boat (`layBoat`), rowed out over the sea from a harbour to an island along the world's ferry (`ways` of the
 * kind `ferry`), the walker sitting in her, and back; boarded with `R` at either end, on the shore. Carried at twelve metres a second (with
 * Shift, twice that), a few kilometres in a few minutes,
 * rising and falling a little with the swell; set ashore at the far end.
 */
export class Ferry {
  private boat: Group | null = null;
  private on: { a: Along; s: number; dir: 1 | -1 } | null = null;
  private readonly lines: Along[];
  constructor(ferries: [number, number][][], private readonly scene: Scene, private readonly materials: () => Record<string, Material> | null) {
    this.lines = ferries.map((points) => alongOf({ points, heights: points.map(() => 0), half: 2 }));
  }
  get sailing(): boolean { return !!this.on; }

  /** Boards the ferry whose end is near (within some forty metres), bound for its other end; says whether one is aboard. */
  board(me: Vector3): boolean {
    if (this.on) return true;
    for (const a of this.lines) {
      const p = a.way.points, n = p.length;
      if (Math.hypot(p[0][0] - me.x, p[0][1] - me.z) < 40) { this.on = { a, s: 0, dir: 1 }; break; }
      if (Math.hypot(p[n - 1][0] - me.x, p[n - 1][1] - me.z) < 40) { this.on = { a, s: a.s[n - 1], dir: -1 }; break; }
    }
    if (!this.on) return false;
    this.boat ??= this.build();
    this.scene.add(this.boat);
    return true;
  }

  /** Whether a ferry's end is near enough to board. */
  near(me: Vector3): boolean {
    return this.lines.some((a) => { const p = a.way.points; return Math.hypot(p[0][0] - me.x, p[0][1] - me.z) < 40 || Math.hypot(p[p.length - 1][0] - me.x, p[p.length - 1][1] - me.z) < 40; });
  }

  /** Rowed on by `dt` seconds: where the walker sits now (`landed` at the far end, where they are set ashore), or null if not aboard. */
  step(dt: number, time: number, fast = false): { x: number; y: number; z: number; heading: number; landed: boolean } | null {
    const o = this.on;
    if (!o || !this.boat) return null;
    const end = o.a.s[o.a.s.length - 1];
    o.s += o.dir * (fast ? 24 : 12) * dt;
    const done = o.s <= 0 || o.s >= end;
    const s = Math.min(end, Math.max(0, o.s)), [x, z] = pointAt(o.a, s), ahead = pointAt(o.a, s + o.dir * 6), heading = Math.atan2(-(ahead[0] - x), -(ahead[1] - z));
    const swell = 0.12 * Math.sin(time * 1.3 + x * 0.05);
    this.boat.position.set(x, swell, z); this.boat.rotation.set(0.03 * Math.sin(time * 1.1), heading, 0.04 * Math.sin(time * 0.9));
    if (done) { this.on = null; this.scene.remove(this.boat); }
    return { x, y: 0.55 + swell, z, heading, landed: done };
  }

  /** The boat, built once at the world's origin, heading along -z, of whatever the places are made of, or plain wood. */
  private build(): Group {
    const kit = new Kit('ferry'), g = new Group();
    layBoat(kit, (m) => kit.mesh(m), { x: 0, z: 0, heading: 0, length: 5.4, afloat: true }, 0, 0, () => 0, new Rng('ferry'));
    const mats = this.materials();
    for (const [key, b] of kit.meshes) {
      if (!b.vertexCount) continue;
      const name = key.split('|').pop()!, m = new Mesh(b.build(), mats?.[name] ?? new MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8, vertexColors: true }));
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }
}
