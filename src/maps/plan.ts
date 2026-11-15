import { Place, Site } from '../core/site';

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
}

const INK = '#2b241c';
const PAPER = '#e9dfc8';
const FLOOR = '#f6efdd';
const COURT = '#cfd9b4';
const DARK = '#b7ab96';
const ACCENT = '#a5432a';

export function drawPlan(canvas: HTMLCanvasElement, site: Site, opts: PlanOptions = {}): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
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
  ctx.globalAlpha = 0.9;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  // Masonry: every place grown by half a wall, in ink. Low outer walls are drawn thinner.
  ctx.fillStyle = INK;
  for (const p of site.places) {
    const g = p.role === 'approach' ? half * 0.6 : half;
    rect(p.x0 - g, p.z0 - g, p.x1 + g, p.z1 + g);
  }
  // Floors: open ground tinted green, unlit rooms shaded.
  const floorOf = (p: Place) => (p.roof === 'sky' ? COURT : p.light === 'dark' ? DARK : FLOOR);
  for (const p of site.places) {
    ctx.fillStyle = floorOf(p);
    rect(p.x0, p.z0, p.x1, p.z1);
  }

  // Ways: cut through the wall; windows are a thin slot; stairs are ruled across the opening.
  for (const w of site.ways) {
    const a = site.places[w.a], b = site.places[w.b];
    const alongX = w.side === 'n' || w.side === 's';
    const wall = w.side === 'n' ? a.z0 - T : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0 - T;
    const lo = w.at - w.halfWidth, hi = w.at + w.halfWidth;
    if (w.kind === 'window') {
      ctx.fillStyle = FLOOR;
      if (alongX) rect(lo, wall + T * 0.35, hi, wall + T * 0.65);
      else rect(wall + T * 0.35, lo, wall + T * 0.65, hi);
      continue;
    }
    ctx.fillStyle = a.roof === 'sky' && b.roof === 'sky' ? COURT : a.light === 'dark' && b.light === 'dark' ? DARK : FLOOR;
    if (alongX) rect(lo, wall - 0.05, hi, wall + T + 0.05);
    else rect(wall - 0.05, lo, wall + T + 0.05, hi);
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
  }

  // Furnishings and marks.
  for (const p of site.places) {
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
      ctx.fillText(String(p.id + 1), X(cx), Z(cz) + (p.role === 'goal' || p.role === 'court' ? 1.6 * scale : 0));
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
