import { buried, CLASSICAL, classicalEnds, classicalFront, classicalStair, floorOf } from '../core/building';
import { Building } from '../core/site';

/**
 * Floor plans of a building, drawn as an architect draws them: walls solid, floors pale, every
 * door a gap in its wall, every window a thin line across the wall with the glass in it, and the
 * stair with its treads and an arrow up. They are drawn from the site document alone, so they show
 * what the document says and what the builder made of it, which are the same thing.
 */

const INK = '#2b241c', PAPER = '#efe6d0', FLOOR = '#f8f2e2', HALL = '#e7dcc4', LINE = '#6b5f50';

/** How a point of the building, in its own measures, is put on the page. */
export type PageOf = (u: number, v: number) => [number, number];

/** Draws one storey of a building onto `ctx`, with `page` putting its points on the page and `scale` pixels to the metre. */
export function drawStorey(ctx: CanvasRenderingContext2D, b: Building, storey: number, page: PageOf, scale: number, o: { labels?: boolean } = {}): void {
  const plan = b.plan;
  if (!plan) return;
  const { outer: T, spine: SPINE, cross: CROSS, out: OUT } = CLASSICAL, W = b.w, D = b.d;
  const { windows, standL, standR } = classicalFront(b);
  const rect = (u0: number, u1: number, v0: number, v1: number, fill: string) => {
    const [ax, ay] = page(u0, v0), [bx, by] = page(u1, v1);
    ctx.fillStyle = fill;
    ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  };
  const line = (u0: number, v0: number, u1: number, v1: number, colour: string, width: number) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...page(u0, v0));
    ctx.lineTo(...page(u1, v1));
    ctx.stroke();
  };
  // The walls: the whole footprint in ink, then the floors laid over it.
  rect(-W / 2, W / 2, 0, D, INK);
  if (b.portico) rect(standL, standR, -OUT, 0.01, INK);
  for (const r of plan.rooms) rect(r.u0, r.u1, r.v0, r.v1, r.kind === 'front' || r.kind === 'back' ? FLOOR : HALL);
  // Doors between rooms: the wall cut away the width of the door.
  for (const d of plan.doors) {
    const half = (d.line === 'v' ? SPINE : CROSS) / 2 + 0.01;
    if (d.line === 'u') rect(d.at - half, d.at + half, d.c - d.w / 2, d.c + d.w / 2, FLOOR);
    else rect(d.c - d.w / 2, d.c + d.w / 2, d.at - half, d.at + half, FLOOR);
  }
  // Windows and outer doors on this storey: a pale gap the depth of the wall, with the glass drawn as a line across it.
  const frontV = (u: number) => (b.portico && u > standL && u < standR ? -OUT : 0);
  const pane = (u0: number, u1: number, v0: number, v1: number, glassAt: 'u' | 'v') => {
    rect(u0, u1, v0, v1, PAPER);
    if (glassAt === 'v') line(u0, (v0 + v1) / 2, u1, (v0 + v1) / 2, LINE, Math.max(1, scale * 0.04));
    else line((u0 + u1) / 2, v0, (u0 + u1) / 2, v1, LINE, Math.max(1, scale * 0.04));
  };
  const sill = floorOf(b, storey) + (storey === 0 ? 0.85 : 0.6), middle = b.bays >> 1;
  windows.forEach((u, n) => {
    const v0 = frontV(u), door = storey === 0 && n === middle;
    if (door) rect(u - 0.85, u + 0.85, v0 - 0.01, v0 + T + 0.01, FLOOR);
    else pane(u - 0.6, u + 0.6, v0, v0 + T, 'v');
    if (b.backDoor !== undefined && storey === 1 && Math.abs(u - b.backDoor) < 0.05) rect(u - 0.62, u + 0.62, D - T - 0.01, D + 0.01, FLOOR);
    else if (!buried(b, D, sill)) pane(u - 0.6, u + 0.6, D - T, D, 'v');
  });
  for (const v of classicalEnds(b)) {
    if (buried(b, v, sill)) continue;
    pane(-W / 2, -W / 2 + T, v - 0.6, v + 0.6, 'u');
    pane(W / 2 - T, W / 2, v - 0.6, v + 0.6, 'u');
  }
  // The stair: the flight that goes up from this storey, with its treads and an arrow; the landing; and, on the storey above, the well it comes up through.
  const stair = classicalStair(b), { START, TREAD, LANDING, across, strip } = stair;
  const at = (a: number, e: number) => stair.place(a, e);
  const box = (a0: number, a1: number, e0: number, e1: number, fill: string) => {
    const p = at(a0, e0), q = at(a1, e1);
    rect(Math.min(p.u, q.u), Math.max(p.u, q.u), Math.min(p.v, q.v), Math.max(p.v, q.v), fill);
  };
  const tread = (a: number, e0: number, e1: number) => { const p = at(a, e0), q = at(a, e1); line(p.u, p.v, q.u, q.v, LINE, Math.max(1, scale * 0.025)); };
  const f = stair.flights[storey], below = stair.flights[storey - 1];
  if (below) {
    // The well: what comes up from below is seen through it, drawn paler.
    box(START, below.turn + LANDING, 0, across, '#d8ccb2');
    const second = below.steps - below.first;
    for (let j = 0; j <= second; j++) tread(below.turn - j * TREAD, across - strip, across);
  }
  if (f) {
    const second = f.steps - f.first;
    box(START, f.turn, 0, strip, '#e9dfc9');
    box(f.turn, f.turn + LANDING, 0, across, '#e9dfc9');
    box(f.turn - second * TREAD, f.turn, across - strip, across, '#e9dfc9');
    for (let i = 0; i <= f.first; i++) tread(START + i * TREAD, 0, strip);
    for (let j = 0; j <= second; j++) tread(f.turn - j * TREAD, across - strip, across);
    // The arrow: up the first flight, across the landing, and on up the second as far as this storey's drawing goes.
    const path = [at(START + 0.1, strip / 2), at(f.turn + LANDING / 2, strip / 2), at(f.turn + LANDING / 2, across - strip / 2), at(f.turn - second * TREAD * 0.5, across - strip / 2)];
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, scale * 0.05);
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(...page(p.u, p.v)) : ctx.moveTo(...page(p.u, p.v))));
    ctx.stroke();
    const [ex, ey] = page(path[3].u, path[3].v), [fx, fy] = page(path[2].u, path[2].v), ang = Math.atan2(ey - fy, ex - fx), head = scale * 0.35;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - head * Math.cos(ang - 0.45), ey - head * Math.sin(ang - 0.45));
    ctx.lineTo(ex - head * Math.cos(ang + 0.45), ey - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
  }
  if (!o.labels) return;
  ctx.fillStyle = LINE;
  ctx.font = `${Math.max(9, Math.round(scale * 0.42))}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const names: Record<string, string> = { hall: 'hall', stair: 'stair hall', passage: 'passage', front: 'room', back: 'room' };
  for (const r of plan.rooms) {
    const [x, y] = page((r.u0 + r.u1) / 2, r.kind === 'passage' ? r.v0 + 1.4 : (r.v0 + r.v1) / 2);
    const area = (r.u1 - r.u0) * (r.v1 - r.v0);
    ctx.fillText(r.kind === 'front' || r.kind === 'back' ? `${area.toFixed(0)} m²` : names[r.kind], x, y);
  }
}

/** The name of a storey, as plans name them. */
export function storeyName(b: Building, storey: number): string {
  const lower = (b.sunk ?? 0) > 0.5;
  if (storey === 0) return lower ? 'Lower ground floor' : 'Ground floor';
  const n = lower ? storey - 1 : storey;
  return n === 0 ? 'Ground floor' : ['First', 'Second', 'Third', 'Fourth', 'Fifth'][n - 1] + ' floor';
}

/** All the storeys of a building, each drawn as a plan with its name and a scale, on one sheet. */
export function buildingPlans(b: Building, scale = 26): HTMLCanvasElement {
  const pad = 1.6, W = b.w, D = b.d + (b.portico ? CLASSICAL.out : 0) + 0.6;
  const pw = Math.max((W + pad * 2) * scale, 250), ph = (D + pad * 2) * scale + 48;
  const cols = W > 17 ? 1 : 2, rows = Math.ceil(b.storeys / cols);
  const canvas = document.createElement('canvas');
  // (Wide enough for its title, however narrow the building.)
  canvas.width = Math.round(Math.max(pw * cols, 760));
  canvas.height = Math.round(ph * rows + 46);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.font = '600 18px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${b.bays} bays, ${b.storeys} ${b.storeys === 1 ? 'storey' : 'storeys'}, ${W.toFixed(1)} by ${b.d.toFixed(1)} m${b.portico ? ', with a pediment over a forward centre' : ''}${b.sunk ? ', set into rising ground' : ''}`, 14, 12);
  for (let s = 0; s < b.storeys; s++) {
    const ox = (s % cols) * pw, oy = 46 + Math.floor(s / cols) * ph;
    // The front is at the foot of the sheet, as one stands before it.
    const page: PageOf = (u, v) => [ox + pw / 2 + u * scale, oy + 44 + (D + pad - (v + (b.portico ? CLASSICAL.out : 0)) - 0.3) * scale];
    ctx.fillStyle = INK;
    ctx.font = '600 15px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(storeyName(b, s), ox + 14, oy + 4);
    ctx.font = '12px Georgia, serif';
    ctx.fillText(`floor ${floorOf(b, s).toFixed(1)} m up, rooms ${b.heights[s].toFixed(1)} m high`, ox + 14, oy + 23);
    drawStorey(ctx, b, s, page, scale, { labels: true });
    // A scale of five metres, and an arrow for the way in.
    const [sx, sy] = page(-W / 2, -1.0);
    ctx.fillStyle = INK;
    for (let m = 0; m < 5; m++) ctx.fillRect(sx + m * scale, sy, scale, m % 2 ? 2 : 5);
    ctx.font = '12px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('5 m', sx + 5 * scale + 6, sy - 4);
    if (s === 0) {
      const [dx, dy] = page(0, -1.1);
      ctx.textAlign = 'center';
      ctx.fillText('▲ entrance', dx, dy - 2);
    }
  }
  return canvas;
}
