import { Item, Lever, Place, Site, Way } from '../core/site';

/**
 * The plan map: a clean drawing of a site from above, north up. Drawn from the site document, so
 * it always agrees with the 3D world. This is the first of the map styles; it serves as the
 * minimap and as a readable check on what the generator produced.
 */

export interface PlanOptions {
  /** Where the player is and which way they face (yaw as used by the camera). */
  player?: { x: number; z: number; yaw: number };
  /** Draw room numbers. */
  labels?: boolean;
  /** Places the player has been in. When given, the rest of the site stays hidden until found. */
  visited?: Set<number>;
  /** Ways whose door is shut at the moment, by index. */
  shut?: Set<number>;
  /** Keys still lying where they were left. */
  items?: Item[];
  /** Levers not yet thrown. */
  levers?: Lever[];
  /** Draw at exactly this many pixels square, ignoring the canvas's size on the page. */
  pixels?: number;
}

const INK = '#2b241c';
const PAPER = '#e9dfc8';
const FLOOR = '#f6efdd';
const COURT = '#cfd9b4';
const DARK = '#b7ab96';
const ACCENT = '#a5432a';
const GLIMPSED = '#ddd2ba';
const KEY_COLOUR: Record<string, string> = { iron: '#6f7781', gold: '#c9961f' };

export function drawPlan(canvas: HTMLCanvasElement, site: Site, opts: PlanOptions = {}): void {
  const ratio = opts.pixels ? opts.pixels / 420 : Math.min(window.devicePixelRatio || 1, 2);
  const cssW = opts.pixels ? 420 : canvas.clientWidth, cssH = opts.pixels ? 420 : canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * ratio) || canvas.height !== Math.round(cssH * ratio)) {
    canvas.width = Math.round(cssW * ratio);
    canvas.height = Math.round(cssH * ratio);
  }
  const ctx = canvas.getContext('2d')!;
  const T = site.wallThickness;
  const half = T / 2;

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of site.places) {
    x0 = Math.min(x0, p.x0 - T); x1 = Math.max(x1, p.x1 + T);
    z0 = Math.min(z0, p.z0 - T); z1 = Math.max(z1, p.z1 + T);
  }
  const pad = 10 * ratio;
  const scale = Math.min((canvas.width - 2 * pad) / (x1 - x0), (canvas.height - 2 * pad) / (z1 - z0));
  const ox = (canvas.width - (x1 - x0) * scale) / 2 - x0 * scale;
  const oz = (canvas.height - (z1 - z0) * scale) / 2 - z0 * scale;
  const X = (x: number) => x * scale + ox;
  const Z = (z: number) => z * scale + oz;
  const rect = (ax: number, az: number, bx: number, bz: number) => ctx.fillRect(X(ax), Z(az), (bx - ax) * scale, (bz - az) * scale);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = opts.pixels ? 1 : 0.9;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  // Fog of war: places that have been entered are drawn in full; places seen through an open
  // doorway, arch or window are sketched; everything else is left off the page.
  const shut = opts.shut ?? new Set<number>();
  const known = (p: Place) => !opts.visited || opts.visited.has(p.id);
  const glimpsed = new Set<number>();
  if (opts.visited) {
    site.ways.forEach((w, i) => {
      if (shut.has(i)) return;
      if (opts.visited!.has(w.a) && !opts.visited!.has(w.b)) glimpsed.add(w.b);
      if (opts.visited!.has(w.b) && !opts.visited!.has(w.a)) glimpsed.add(w.a);
    });
  }
  const drawn = (p: Place) => known(p) || glimpsed.has(p.id);
  const wayDrawn = (w: Way) => known(site.places[w.a]) || known(site.places[w.b]);

  // Masonry: every place grown by half a wall, in ink. Low outer walls are drawn thinner.
  for (const p of site.places) {
    if (!drawn(p)) continue;
    ctx.fillStyle = INK;
    ctx.globalAlpha = known(p) ? 1 : 0.35;
    const g = p.role === 'approach' ? half * 0.6 : half;
    rect(p.x0 - g, p.z0 - g, p.x1 + g, p.z1 + g);
  }
  ctx.globalAlpha = 1;
  // Floors: open ground tinted green, unlit rooms shaded.
  const floorOf = (p: Place) => (!known(p) ? GLIMPSED : p.roof === 'sky' ? COURT : p.light === 'dark' ? DARK : FLOOR);
  for (const p of site.places) {
    if (!drawn(p)) continue;
    if (p.roof === 'cave') {
      // Solid rock, with a rough oval of open floor and a bay towards each way in.
      ctx.fillStyle = INK;
      ctx.globalAlpha = known(p) ? 0.82 : 0.3;
      rect(p.x0, p.z0, p.x1, p.z1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = floorOf(p);
      ctx.beginPath();
      ctx.ellipse(X((p.x0 + p.x1) / 2), Z((p.z0 + p.z1) / 2), ((p.x1 - p.x0) / 2 - 0.4) * scale, ((p.z1 - p.z0) / 2 - 0.4) * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const w of site.ways) {
        if (w.kind === 'window' || (w.a !== p.id && w.b !== p.id)) continue;
        const side = w.a === p.id ? w.side : ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[w.side];
        const qx = side === 'w' ? p.x0 : side === 'e' ? p.x1 : w.at, qz = side === 'n' ? p.z0 : side === 's' ? p.z1 : w.at;
        ctx.beginPath();
        ctx.arc(X(qx), Z(qz), (w.halfWidth + 0.7) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    ctx.fillStyle = floorOf(p);
    rect(p.x0, p.z0, p.x1, p.z1);
  }

  // Ways: cut through the wall; windows are a thin slot; stairs are ruled across the opening.
  site.ways.forEach((w, index) => {
    if (!wayDrawn(w)) return;
    const a = site.places[w.a], b = site.places[w.b];
    const alongX = w.side === 'n' || w.side === 's';
    const wall = w.side === 'n' ? a.z0 - T : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0 - T;
    const lo = w.at - w.halfWidth, hi = w.at + w.halfWidth;
    if (w.kind === 'window') {
      ctx.fillStyle = FLOOR;
      if (alongX) rect(lo, wall + T * 0.35, hi, wall + T * 0.65);
      else rect(wall + T * 0.35, lo, wall + T * 0.65, hi);
      return;
    }
    ctx.fillStyle = FLOOR;
    if (alongX) rect(lo, wall - 0.05, hi, wall + T + 0.05);
    else rect(wall - 0.05, lo, wall + T + 0.05, hi);
    // A shut door is a stroke across the opening, in the colour of its lock if it has one.
    if (shut.has(index)) {
      ctx.fillStyle = w.door?.lock ? KEY_COLOUR[w.door.lock] : INK;
      if (alongX) rect(lo, wall + T * 0.36, hi, wall + T * 0.64);
      else rect(wall + T * 0.36, lo, wall + T * 0.64, hi);
      return;
    }
    const steps = Math.round(Math.abs(a.floor - b.floor) / 0.17);
    if (steps > 0) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 0.6 * ratio);
      ctx.beginPath();
      for (let k = 1; k <= steps; k++) {
        const t = wall + (T * k) / (steps + 1);
        if (alongX) { ctx.moveTo(X(lo), Z(t)); ctx.lineTo(X(hi), Z(t)); }
        else { ctx.moveTo(X(t), Z(lo)); ctx.lineTo(X(t), Z(hi)); }
      }
      ctx.stroke();
    }
  });

  // Furnishings and marks.
  for (const it of opts.items ?? []) {
    const p = site.places[it.place];
    if (!known(p)) continue;
    diamond(ctx, X((p.x0 + p.x1) / 2), Z((p.z0 + p.z1) / 2), Math.max(3.5 * ratio, 0.6 * scale), KEY_COLOUR[it.key]);
  }
  for (const l of opts.levers ?? []) {
    if (!known(site.places[l.place])) continue;
    // A lever: a small square with a stroke leaning out of it.
    const r = Math.max(3 * ratio, 0.34 * scale);
    ctx.fillStyle = INK;
    ctx.fillRect(X(l.x) - r / 2, Z(l.z) - r / 2, r, r);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(1.5 * ratio, 0.14 * scale);
    ctx.beginPath();
    ctx.moveTo(X(l.x), Z(l.z));
    ctx.lineTo(X(l.x) + r * 1.3, Z(l.z) - r * 1.3);
    ctx.stroke();
  }
  for (const p of site.places) {
    if (!known(p)) continue;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (p.role === 'court') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 0.8 * ratio);
      ctx.beginPath();
      ctx.arc(X(cx), Z(cz), 0.9 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.role === 'goal') star(ctx, X(cx), Z(cz), Math.max(4 * ratio, 0.9 * scale), ACCENT);
    if (opts.labels && p.role !== 'approach') {
      ctx.fillStyle = INK;
      ctx.font = `${Math.max(9 * ratio, 1.1 * scale)}px ui-serif, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Step the number aside where something else is drawn in the middle of the room.
      const busy = p.role === 'goal' || p.role === 'court' || (opts.items ?? []).some((it) => it.place === p.id);
      ctx.fillText(String(p.id + 1), X(cx), Z(cz) + (busy ? Math.min(1.6, (p.z1 - p.z0) / 2 - 0.7) * scale : 0));
    }
  }

  if (opts.player) {
    const { x, z, yaw } = opts.player;
    const r = Math.max(4.5 * ratio, 0.8 * scale);
    // Yaw 0 faces north (up the page) and grows anticlockwise seen from above.
    ctx.save();
    ctx.translate(X(x), Z(z));
    ctx.rotate(-yaw);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.7, r * 0.8);
    ctx.lineTo(0, r * 0.4);
    ctx.lineTo(-r * 0.7, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const d = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.sin(a) * d, y - Math.cos(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

/** Which place a point is in, if any. */
export function placeAt(site: Site, x: number, z: number): Place | undefined {
  return site.places.find((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
}
