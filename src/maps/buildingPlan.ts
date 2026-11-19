import { blinded, buried, CLASSICAL, classicalArch, classicalEnds, classicalFront, classicalStairs, dressOf, entranceBays, floorOf, footprintOf, frontAt, TIMBER, timberFloor, timberFront, timberStair, timberWindows, wingWindows } from '../core/building';
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
  if (b.style === 'timber') { drawTimberStorey(ctx, b, storey, page, scale, o); return; }
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
  for (const r of footprintOf(b)) rect(r.u0, r.u1, r.v0, r.v1, INK);
  // (A room or door named for one storey is drawn on that one alone: over a carriage way, the rooms above it.)
  const here = <T extends { storey?: number }>(q: T) => q.storey === undefined || q.storey === storey;
  for (const r of plan.rooms.filter(here)) rect(r.u0, r.u1, r.v0, r.v1, r.kind === 'front' || r.kind === 'back' || r.kind === 'wing' ? FLOOR : HALL);
  // Doors between rooms: the wall cut away the width of the door.
  for (const d of plan.doors.filter(here)) {
    const half = (d.through ?? (d.line === 'v' ? SPINE : CROSS)) / 2 + 0.01;
    if (d.line === 'u') rect(d.at - half, d.at + half, d.c - d.w / 2, d.c + d.w / 2, FLOOR);
    else rect(d.c - d.w / 2, d.c + d.w / 2, d.at - half, d.at + half, FLOOR);
  }
  // Windows and outer doors on this storey: a pale gap the depth of the wall, with the glass drawn as a line across it.
  // (Where the middle or a pavilion stands forward, its windows are in its own wall.)
  const frontV = (u: number) => -frontAt(b, u);
  void standL; void standR; void OUT;
  const pane = (u0: number, u1: number, v0: number, v1: number, glassAt: 'u' | 'v') => {
    rect(u0, u1, v0, v1, PAPER);
    if (glassAt === 'v') line(u0, (v0 + v1) / 2, u1, (v0 + v1) / 2, LINE, Math.max(1, scale * 0.04));
    else line((u0 + u1) / 2, v0, (u0 + u1) / 2, v1, LINE, Math.max(1, scale * 0.04));
  };
  const sill = floorOf(b, storey) + (storey === 0 ? 0.85 : 0.6), middle = b.bays >> 1;
  // The carriage way's arch, front and back, on the ground storey: open the arch's breadth, with no window in it.
  const arch = storey === 0 ? classicalArch(b) : null;
  if (arch) for (const [v0, v1] of [[-0.01, T + 0.01], [D - T - 0.01, D + 0.01]]) rect(arch.u - arch.w / 2, arch.u + arch.w / 2, v0, v1, HALL);
  windows.forEach((u, n) => {
    if (arch && Math.abs(u - arch.u) < arch.w / 2 + 0.7) return;
    const v0 = frontV(u), door = storey === 0 && entranceBays(b).includes(n);
    if (door) rect(u - 0.85, u + 0.85, v0 - 0.01, v0 + T + 0.01, FLOOR);
    else if (!blinded(b, u, v0, 0, -1, sill)) pane(u - 0.6, u + 0.6, v0, v0 + T, 'v');
    if (b.backDoor !== undefined && storey === 1 && Math.abs(u - b.backDoor) < 0.05) rect(u - 0.62, u + 0.62, D - T - 0.01, D + 0.01, FLOOR);
    else if (!buried(b, D, sill, u) && !blinded(b, u, D, 0, 1, sill) && !(b.wings ?? []).some((g) => g.side * u > W / 2 - g.width - 0.3)) pane(u - 0.6, u + 0.6, D - T, D, 'v');
  });
  for (const v of classicalEnds(b)) {
    // (Each end on its own: where the ground falls along the front, one end may have a window where the other has none.)
    if (!buried(b, v, sill, -W / 2) && !blinded(b, -W / 2, v, -1, 0, sill)) pane(-W / 2, -W / 2 + T, v - 0.6, v + 0.6, 'u');
    if (!buried(b, v, sill, W / 2) && !blinded(b, W / 2, v, 1, 0, sill)) pane(W / 2 - T, W / 2, v - 0.6, v + 0.6, 'u');
  }
  for (const g of b.wings ?? []) {
    const { along, across } = wingWindows(b, g), outer = g.side * W / 2, inner = g.side * (W / 2 - g.width);
    for (const v of along) if (!buried(b, v, sill, outer)) {
      if (!blinded(b, outer, v, g.side, 0, sill)) pane(Math.min(outer, outer - g.side * T), Math.max(outer, outer - g.side * T), v - 0.6, v + 0.6, 'u');
      if (!blinded(b, inner, v, -g.side, 0, sill)) pane(Math.min(inner, inner + g.side * T), Math.max(inner, inner + g.side * T), v - 0.6, v + 0.6, 'u');
    }
    for (const u of across) if (!buried(b, D + g.length, sill, u) && !blinded(b, u, D + g.length, 0, 1, sill)) pane(u - 0.6, u + 0.6, D + g.length - T, D + g.length, 'v');
  }
  // The stair: the flight that goes up from this storey, with its treads and an arrow; the landing; and, on the storey above, the well it comes up through.
  // (One behind each entrance.)
  for (const stair of classicalStairs(b)) {
  const { START, TREAD, LANDING, across, strip } = stair;
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
  }
  if (!o.labels) return;
  ctx.fillStyle = LINE;
  ctx.font = `${Math.max(9, Math.round(scale * 0.42))}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const names: Record<string, string> = { hall: 'hall', stair: 'stair hall', passage: 'passage', front: 'room', back: 'room', wing: 'room', carriage: 'carriage way' };
  for (const r of plan.rooms.filter(here)) {
    const [x, y] = page((r.u0 + r.u1) / 2, r.kind === 'passage' ? r.v0 + 1.4 : (r.v0 + r.v1) / 2);
    const area = (r.u1 - r.u0) * (r.v1 - r.v0);
    ctx.fillText(r.kind === 'front' || r.kind === 'back' || r.kind === 'wing' ? `${area.toFixed(0)} m²` : names[r.kind], x, y);
  }
}

/** One storey of a timber house: drawn as the classical ones are, but each storey has its own rooms, and stands further out over the street than the one below. */
function drawTimberStorey(ctx: CanvasRenderingContext2D, b: Building, storey: number, page: PageOf, scale: number, o: { labels?: boolean }): void {
  const plan = b.plan!, W = b.w, D = b.d, front = timberFront(b, storey), t = storey === 0 ? TIMBER.ground : TIMBER.wall, stair = timberStair(b);
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
  rect(-W / 2, W / 2, front, D, INK);
  const rooms = plan.rooms.filter((r) => r.storey === storey);
  for (const r of rooms) rect(r.u0, r.u1, r.v0, r.v1, r.kind === 'front' || r.kind === 'back' ? FLOOR : HALL);
  for (const d of plan.doors) if (d.storey === storey) {
    const half = TIMBER.partition / 2 + 0.01;
    if (d.line === 'u') rect(d.at - half, d.at + half, d.c - d.w / 2, d.c + d.w / 2, FLOOR); else rect(d.c - d.w / 2, d.c + d.w / 2, d.at - half, d.at + half, FLOOR);
  }
  // Windows, wall by wall, each given along its wall from its left end as seen from outside; and the door.
  const glass = Math.max(1, scale * 0.04);
  timberWindows(b, storey).forEach((wall, i) => {
    for (const [s0, s1] of wall) {
      if (i === 0) { rect(-W / 2 + s0, -W / 2 + s1, front, front + t, PAPER); line(-W / 2 + s0, front + t / 2, -W / 2 + s1, front + t / 2, LINE, glass); }
      else if (i === 2) { rect(W / 2 - s1, W / 2 - s0, D - t, D, PAPER); line(W / 2 - s1, D - t / 2, W / 2 - s0, D - t / 2, LINE, glass); }
      else {
        const u0 = i === 1 ? W / 2 - t : -W / 2, v0 = i === 1 ? front + s0 : D - s1, v1 = i === 1 ? front + s1 : D - s0;
        rect(u0, u0 + t, v0, v1, PAPER);
        line(u0 + t / 2, v0, u0 + t / 2, v1, LINE, glass);
      }
    }
  });
  if (storey === 0) { const u = -W / 2 + W * (b.door ?? 0.24); rect(u - 0.42, u + 0.42, -0.01, t + 0.01, HALL); }
  // The stair: the flight that goes up from here, with its treads and an arrow; or, on the top floor, the well it comes up through.
  const f = stair.flights[storey], mid = (stair.u0 + stair.u1) / 2;
  if (f || storey > 0) {
    rect(stair.u0, stair.u1, stair.v0, stair.v1, f ? '#e9dfc9' : '#d8ccb2');
    const g = f ?? stair.flights[storey - 1];
    for (let i = 0; i < g.steps; i++) line(stair.u0, stair.v0 + i * g.tread, stair.u1, stair.v0 + i * g.tread, LINE, Math.max(1, scale * 0.025));
  }
  if (f) {
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = Math.max(1, scale * 0.05);
    const [ax, ay] = page(mid, stair.v0 + 0.1), [bx, by] = page(mid, stair.v1 - 0.3), head = scale * 0.3, ang = Math.atan2(by - ay, bx - ax);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45)); ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
  }
  if (!o.labels) return;
  ctx.fillStyle = LINE;
  ctx.font = `${Math.max(9, Math.round(scale * 0.42))}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of rooms) {
    const hall = r.kind === 'hall' || r.kind === 'passage';
    // (The hall's name is written at its front, clear of the stair; a room has its area.)
    const [x, y] = page(hall ? (stair.side < 0 ? Math.max(r.u0, stair.u1) + r.u1 : r.u0 + Math.min(r.u1, stair.u0)) / 2 : (r.u0 + r.u1) / 2, hall ? r.v1 - 0.5 : (r.v0 + r.v1) / 2);
    ctx.fillText(hall ? (storey === 0 ? 'hall' : 'landing') : `${((r.u1 - r.u0) * (r.v1 - r.v0)).toFixed(0)} m²`, x, y);
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
  const timber = b.style === 'timber', jut = timber ? -timberFront(b, b.storeys - 1) : 0;
  // (How far the front stands forward at the most: the middle, with the base of its columns, or a pavilion.)
  const forward = b.style === 'imperial' ? Math.max(b.portico ? CLASSICAL.out + (dressOf(b).order === 'columns' ? CLASSICAL.columns : 0) : 0, dressOf(b).pavilions ? CLASSICAL.pavilion : 0) : 0;
  const pad = 1.6 + jut, W = b.w, D = b.d + forward + 0.6 + Math.max(0, ...(b.wings ?? []).map((g) => g.length));
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
  ctx.fillText(timber
    ? `Timber-framed, ${b.storeys} storeys, ${W.toFixed(1)} by ${b.d.toFixed(1)} m, ${b.gable ? 'gable' : 'eaves'} to the street`
    : `${b.bays} bays, ${b.storeys} ${b.storeys === 1 ? 'storey' : 'storeys'}, ${W.toFixed(1)} by ${b.d.toFixed(1)} m${b.wings ? (b.wings.length === 2 ? ', U-shaped' : ', L-shaped') : ''}${b.portico ? ', pediment' : ''}${b.sunk ? ', on a slope' : ''}`, 14, 12);
  for (let s = 0; s < b.storeys; s++) {
    const ox = (s % cols) * pw, oy = 46 + Math.floor(s / cols) * ph;
    // The front is at the foot of the sheet, as one stands before it.
    const page: PageOf = (u, v) => [ox + pw / 2 + u * scale, oy + 44 + (D + pad - (v + forward) - 0.3) * scale];
    ctx.fillStyle = INK;
    ctx.font = '600 15px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(storeyName(b, s), ox + 14, oy + 4);
    ctx.font = '12px Georgia, serif';
    ctx.fillText(`floor ${(timber ? timberFloor(b, s) : floorOf(b, s)).toFixed(1)} m up, rooms ${b.heights[s].toFixed(1)} m high`, ox + 14, oy + 23);
    drawStorey(ctx, b, s, page, scale, { labels: true });
    // A scale of five metres, and an arrow for the way in.
    const [sx, sy] = page(-W / 2, (timber ? -1.45 : -1.0) - jut);
    ctx.fillStyle = INK;
    for (let m = 0; m < 5; m++) ctx.fillRect(sx + m * scale, sy, scale, m % 2 ? 2 : 5);
    ctx.font = '12px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('5 m', sx + 5 * scale + 6, sy - 4);
    if (s === 0) {
      const [dx, dy] = page(timber ? -W / 2 + W * (b.door ?? 0.24) : 0, timber ? -0.75 : -1.1);
      ctx.textAlign = 'center';
      ctx.fillText('▲ entrance', dx, dy - 2);
    }
  }
  return canvas;
}
