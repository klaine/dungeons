import { drawStorey } from './buildingPlan';
import { rimAt } from '../core/mountain';
import { footprintOf } from '../core/building';
import { boxValley, edgeAt, hallOnward, joinLine } from '../core/valley';
import { Item, Lever, Place, shoreOf, Site, stairEnds, Way } from '../core/site';

/**
 * The plan map: a clean drawing of a site from above, north up. Drawn from the site document, so
 * it always agrees with the 3D world. This is the first of the map styles; it serves as the
 * minimap and as a readable check on what the generator produced.
 */

export interface PlanOptions {
  /** Which storey to draw: 0, the ground storey, if left out. Places on other storeys are left off; the stairs to them are shown. */
  level?: number;
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
  /** Draw secret doors that are still shut. Off in play, so the map does not give them away. */
  showSecrets?: boolean;
  /** Levers not yet thrown. */
  levers?: Lever[];
  /** Draw at exactly this many pixels square, ignoring the canvas's size on the page. */
  pixels?: number;
  /** Take in the whole valley, with its track and what lies in it, not just the house and the ground before its door. */
  valley?: boolean;
}

const INK = '#2b241c';
const PAPER = '#e9dfc8';
const FLOOR = '#f6efdd';
const COURT = '#cfd9b4';
const DARK = '#b7ab96';
const ACCENT = '#a5432a';
const GLIMPSED = '#ddd2ba';
const KEY_COLOUR: Record<string, string> = { iron: '#6f7781', gold: '#c9961f' };
const WATER = '#8fb4c4';
const TRACK = '#b9a67c';

export function drawPlan(canvas: HTMLCanvasElement, site: Site, opts: PlanOptions = {}): void {
  const ratio = opts.pixels ? opts.pixels / 420 : Math.min(window.devicePixelRatio || 1, 2);
  const cssW = opts.pixels ? 420 : canvas.clientWidth, cssH = opts.pixels ? 420 : canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * ratio) || canvas.height !== Math.round(cssH * ratio)) {
    canvas.width = Math.round(cssW * ratio);
    canvas.height = Math.round(cssH * ratio);
  }
  // A map with no room to be drawn in (hidden, or not yet laid out) is not drawn: sizes worked
  // out from nothing come out negative, and an error here would stop the whole program's loop.
  if (canvas.width < 24 || canvas.height < 24) return;
  const ctx = canvas.getContext('2d')!;
  const T = site.wallThickness;
  const half = T / 2;

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of site.places) {
    x0 = Math.min(x0, p.x0 - T); x1 = Math.max(x1, p.x1 + T);
    z0 = Math.min(z0, p.z0 - T); z1 = Math.max(z1, p.z1 + T);
  }
  const g = opts.valley ? site.grounds : undefined, isle = g ? site.island : undefined, mtn = g ? site.mountain : undefined, vale = g && !isle && !mtn ? site.valley ?? boxValley(g) : undefined;
  // Where a side of the valley lies at any place down it.
  const sideAt = (side: 'w' | 'e', z: number) => edgeAt(vale!, side, z);
  if (g) {
    x0 = Math.min(x0, g.x0 - 5); x1 = Math.max(x1, g.x1 + 5); z1 = Math.max(z1, g.z1 + 5);
    // (An island is seen whole, with a little of the sea all round.)
    if (isle) { z0 = Math.min(z0, g.z0 - 12); x0 -= 7; x1 += 7; z1 += 7; }
    // (So is a mountain top, with its ridge.)
    if (mtn) { z0 = Math.min(z0, g.z0 - 6); }
    // A hall under the hill runs out beyond the valley's edge, and the map is made wide enough to show all of it.
    for (const q of site.grottoes ?? []) {
      if (!q.hall) continue;
      const far = 3.9 + q.hall.drop / 0.5 + 1.6 + q.hall.length - 7 + 3;
      if (q.side === 'w') x0 = Math.min(x0, sideAt('w', q.z) - far); else x1 = Math.max(x1, sideAt('e', q.z) + far);
    }
    // (And to show the cavern under the hill, if there is one.)
    const cavern = opts.visited ? undefined : site.backWay?.deep;
    if (cavern) { x0 = Math.min(x0, cavern.x - cavern.rx - 4); x1 = Math.max(x1, cavern.x + cavern.rx + 4); z0 = Math.min(z0, cavern.z - cavern.rz - 4); z1 = Math.max(z1, cavern.z + cavern.rz + 4); }
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

  // The valley: its floor, the rock that shuts it in, the track, and what lies off the track.
  if (g) {
    // (Its two sides, from the house down to the gap and a little beyond, where it opens out again; the rock is a band along the outside of each.)
    const outline = (grow: number) => {
      ctx.beginPath();
      const end = vale!.mouth + 6;
      for (let z = g.z0; z <= end; z += 1) { const x = X(sideAt('w', z) - grow); if (z === g.z0) ctx.moveTo(x, Z(z)); else ctx.lineTo(x, Z(z)); }
      for (let z = end; z >= g.z0; z -= 1) ctx.lineTo(X(sideAt('e', z) + grow), Z(z));
      ctx.closePath();
      ctx.fill();
    };
    if (isle) {
      // An island: the sea, the land within its coast, less the cove and the channel to it; the cliffs as a band of ink round the edge.
      const coastLine = (grow: number) => {
        ctx.beginPath();
        isle.coast.forEach((r, k) => { const a = (k / isle.coast.length) * Math.PI * 2, x = X(isle.x + Math.cos(a) * (r + grow)), z = Z(isle.z + Math.sin(a) * (r + grow)); if (k) ctx.lineTo(x, z); else ctx.moveTo(x, z); });
        ctx.closePath();
        ctx.fill();
      };
      const c = isle.cove, ux = Math.cos(c.out), uz = Math.sin(c.out);
      const cove = (grow: number) => {
        ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), (c.r - grow) * scale, 0, Math.PI * 2); ctx.fill();
        const w = c.mouth / 2 - grow, far = c.r + 40;
        ctx.beginPath();
        ctx.moveTo(X(c.x - uz * w), Z(c.z + ux * w)); ctx.lineTo(X(c.x + ux * far - uz * w), Z(c.z + uz * far + ux * w));
        ctx.lineTo(X(c.x + ux * far + uz * w), Z(c.z + uz * far - ux * w)); ctx.lineTo(X(c.x + uz * w), Z(c.z - ux * w));
        ctx.closePath(); ctx.fill();
      };
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.55;
      coastLine(2.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COURT;
      coastLine(0);
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.55;
      cove(-2.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = PAPER;
      cove(0);
      // Stacks out in the sea, as rock; the lighthouse as a ring of wall; the castle as a block; the cottages solid.
      ctx.fillStyle = INK;
      for (const q of isle.stacks) { ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(X(q.x), Z(q.z), q.r * scale, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (isle.lighthouse) { ctx.beginPath(); ctx.arc(X(isle.lighthouse.x), Z(isle.lighthouse.z), isle.lighthouse.r * scale, 0, Math.PI * 2); ctx.fill(); }
      if (isle.castle) {
        const k = isle.castle;
        ctx.save(); ctx.translate(X(k.x), Z(k.z)); ctx.rotate(k.facing);
        ctx.globalAlpha = 0.7; ctx.fillRect(-11 * scale, -14 * scale, 22 * scale, 28 * scale); ctx.globalAlpha = 1;
        ctx.restore();
      }
      if (isle.chapel) {
        const k = isle.chapel;
        ctx.save(); ctx.translate(X(k.x), Z(k.z)); ctx.rotate(k.facing);
        ctx.globalAlpha = 0.55; ctx.fillRect(-8 * scale, -4 * scale, 18 * scale, 8 * scale); ctx.globalAlpha = 1;
        ctx.restore();
      }
      if (isle.mansion) {
        // (Drawn solid, as the valley's buildings are, wings and all.)
        const b = isle.mansion.building, turn = b.faces === 'w' ? 1 : -1;
        ctx.globalAlpha = 0.8;
        for (const r of footprintOf(b)) {
          const xs = [b.x - (turn * b.d) / 2 + turn * r.v0, b.x - (turn * b.d) / 2 + turn * r.v1], zs = [b.z + turn * r.u0, b.z + turn * r.u1];
          ctx.fillRect(X(Math.min(...xs)), Z(Math.min(...zs)), Math.abs(xs[1] - xs[0]) * scale, Math.abs(zs[1] - zs[0]) * scale);
        }
        ctx.globalAlpha = 1;
      }
      if (isle.graveyard) {
        const q = isle.graveyard;
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8 * ratio, 0.4 * scale);
        ctx.strokeRect(X(q.x - q.d / 2), Z(q.z - q.w / 2), q.d * scale, q.w * scale);
      }
      for (const h of isle.cottages) {
        ctx.save(); ctx.translate(X(h.x), Z(h.z)); ctx.rotate(h.faces);
        ctx.fillRect(-h.d / 2 * scale, -h.w / 2 * scale, h.d * scale, h.w * scale);
        ctx.restore();
      }
      // The jetty.
      ctx.strokeStyle = INK; ctx.lineWidth = isle.jetty.width * scale;
      ctx.beginPath(); ctx.moveTo(X(isle.jetty.from[0]), Z(isle.jetty.from[1])); ctx.lineTo(X(isle.jetty.to[0]), Z(isle.jetty.to[1])); ctx.stroke();
    } else if (mtn) {
      // A mountain top: the ground within the rim, and the ridge running out from it; the precipices as a band of ink round the edge.
      // Beyond is cloud, left as paper.
      const ground = (grow: number) => {
        ctx.beginPath();
        // (Its rim with the buttresses and gullies on it, which the ring of numbers alone does not hold.)
        for (let k = 0; k < 480; k++) { const a = (k / 480) * Math.PI * 2, r = rimAt(mtn, a), x = X(mtn.x + Math.cos(a) * (r + grow)), z = Z(mtn.z + Math.sin(a) * (r + grow)); if (k) ctx.lineTo(x, z); else ctx.moveTo(x, z); }
        ctx.closePath();
        ctx.fill();
        ctx.lineCap = 'round';
        ctx.lineWidth = (mtn.spur.width * 0.86 + grow * 2) * scale;
        ctx.strokeStyle = ctx.fillStyle as string;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        (mtn.spur.crest ?? [mtn.spur.from, mtn.spur.to]).forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
        ctx.stroke();
        ctx.lineCap = 'butt';
      };
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.55;
      ground(2.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COURT;
      ground(0);
      // The summits, as rings drawn closer together towards their tops; the cairn as a small triangle; the shelter as a block.
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6 * ratio, 0.15 * scale); ctx.globalAlpha = 0.4;
      for (const q of mtn.peaks) for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(X(q.x), Z(q.z), q.r * scale * Math.pow(k / 4, 1.3), 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = INK;
      if (mtn.cairn) { const c = mtn.cairn, r = 2.6 * scale + 2 * ratio; ctx.beginPath(); ctx.moveTo(X(c.x), Z(c.z) - r); ctx.lineTo(X(c.x) + r * 0.9, Z(c.z) + r * 0.6); ctx.lineTo(X(c.x) - r * 0.9, Z(c.z) + r * 0.6); ctx.closePath(); ctx.fill(); }
      if (mtn.shelter) { const q = mtn.shelter; ctx.save(); ctx.translate(X(q.x), Z(q.z)); ctx.rotate(q.facing); ctx.fillRect(-1.5 * scale, -1.8 * scale, 3 * scale, 3.6 * scale); ctx.restore(); }
    } else {
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.55;
    outline(3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COURT;
    outline(0);
    }
    // The ridge the house is built into, which the arms of the valley run past, is rock like the rest.
    if (vale?.ridge) {
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.55;
      rect(vale!.ridge.x0, g.z0 - 6, vale!.ridge.x1, vale!.ridge.z);
      ctx.globalAlpha = 1;
    }
    // Footpaths, as a dotted line.
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8 * ratio, 0.22 * scale);
    ctx.setLineDash([Math.max(1.2 * ratio, 0.35 * scale), Math.max(2 * ratio, 0.6 * scale)]);
    for (const f of site.paths ?? []) {
      ctx.beginPath();
      f.points.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Terraces: the shelf, with ticks down its front as on any map that shows a drop, and the way up as a dotted line.
    for (const t of site.terraces ?? []) {
      const edge = sideAt(t.side, (t.z0 + t.z1) / 2), inw = t.side === 'w' ? 1 : -1, back = edge + inw * 4.2, front = edge + inw * (4.7 + t.depth);
      ctx.fillStyle = FLOOR;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(Math.min(X(back), X(front)), Z(t.z0), Math.abs(X(front) - X(back)), Z(t.z1) - Z(t.z0));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(0.7 * ratio, 0.16 * scale);
      for (let z = t.z0 + 0.5; z < t.z1; z += 1.4) { ctx.beginPath(); ctx.moveTo(X(front), Z(z)); ctx.lineTo(X(front + inw * 0.9), Z(z)); ctx.stroke(); }
      ctx.setLineDash([Math.max(1.5 * ratio, 0.5 * scale), Math.max(1.5 * ratio, 0.5 * scale)]);
      ctx.beginPath();
      const way = edge + inw * 6.1;
      if (t.rise === 'n') { ctx.moveTo(X(way), Z(t.z0 - t.run)); ctx.lineTo(X(way), Z(t.z0)); } else { ctx.moveTo(X(way), Z(t.z1 + t.run)); ctx.lineTo(X(way), Z(t.z1)); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Grottoes: a dark hollow in the rock at the valley's edge.
    for (const q of site.grottoes ?? []) {
      const edge = sideAt(q.side, q.z), inw = q.side === 'w' ? 1 : -1;
      if (q.hall?.great) {
        // A great hall, drawn at its floor: the ledge it is come upon from, the stair down, the screen with the aisle behind it,
        // the chasm with its bridge and its steps, the upper bridge as a broken line, the pillars, and the room off the upper bridge.
        const h = q.hall, gr = q.hall.great, c = gr.chasm, hall0 = 3.9 + h.drop / 0.5 + 1.6, gs = gr.gallery === 's' ? 1 : -1, half = h.width / 2;
        const face = half - 3.4, back = face + 0.9, c1 = c.at + c.width, uc = c.at + c.width / 2;
        const box = (u0: number, u1: number, o0: number, o1: number) => {
          const xa = edge + inw * (7 - hall0 - u0), xb = edge + inw * (7 - hall0 - u1), za = q.z + gs * o0, zb = q.z + gs * o1;
          rect(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb));
        };
        const line = (u0: number, o0: number, u1: number, o1: number) => { ctx.beginPath(); ctx.moveTo(X(edge + inw * (7 - hall0 - u0)), Z(q.z + gs * o0)); ctx.lineTo(X(edge + inw * (7 - hall0 - u1)), Z(q.z + gs * o1)); ctx.stroke(); };
        ctx.fillStyle = INK;
        box(-0.6, h.length + 0.6, -half - 0.6, half + 0.6);
        box(uc - 3.8, uc + 3.8, -half - 8.6, -half);
        box(2.6 - hall0, 0, -1.95, 1.95);
        ctx.fillStyle = DARK;
        box(2.6 - hall0, 0, -1.35, 1.35);
        box(0, h.length, -half, face);
        box(0.6, h.length - 2, back, half);
        box(uc - 3.2, uc + 3.2, -half - 8, -half - 1.5);
        box(uc - 1.2, uc + 1.2, -half - 1.6, -half);
        for (let u = uc - 12 * 3.65; u < h.length - 3; u += 3.65) if (u > 2) box(u - 1.3, u + 1.3, face - 0.05, back + 0.05);
        // The ledge, which is the level of the door: paler than the floor far below it.
        ctx.fillStyle = FLOOR;
        ctx.globalAlpha = 0.55;
        box(0, 6, -half, face);
        ctx.globalAlpha = 1;
        // The chasm, and the bridge over it.
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.8;
        box(c.at, c1, -half, face);
        ctx.globalAlpha = 1;
        ctx.fillStyle = DARK;
        box(c.at - 0.2, c1 + 0.2, -1.5, 1.5);
        ctx.fillStyle = INK;
        const clear = 3.65 * 2.5 - c.width / 2;
        for (const v of [-h.width * 0.27, h.width * 0.27]) {
          for (let u = c.at - clear; u > 8.5; u -= 7.3) box(u - 1.1, u + 1.1, gs * v - 1.1, gs * v + 1.1);
          for (let u = c1 + clear; u < h.length - 7; u += 7.3) box(u - 1.1, u + 1.1, gs * v - 1.1, gs * v + 1.1);
        }
        box(h.length - 3.5, h.length - 1.9, -1.5, 1.5);
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, 0.6 * ratio);
        // Steps: down from the valley, down from the ledge, and up out of the chasm.
        for (let t = 3.9; t < hall0 - 1.6; t += 0.68) { ctx.beginPath(); ctx.moveTo(X(edge + inw * (7 - t)), Z(q.z - 1.35)); ctx.lineTo(X(edge + inw * (7 - t)), Z(q.z + 1.35)); ctx.stroke(); }
        for (let u = 6; u < 6 + gr.deep * 2; u += 0.68) line(u, -half, u, -half + 3);
        ctx.strokeStyle = PAPER;
        for (let o = face - 1.4; o > face - 1.4 - c.depth * 2; o -= 0.68) line(c1 - 1.5, o, c1, o);
        // The upper bridge, overhead.
        ctx.strokeStyle = INK;
        ctx.setLineDash([Math.max(1.5 * ratio, 0.5 * scale), Math.max(1.5 * ratio, 0.5 * scale)]);
        line(uc - 1.3, -half, uc - 1.3, face);
        line(uc + 1.3, -half, uc + 1.3, face);
        ctx.setLineDash([]);
        continue;
      }
      if (q.mine) {
        // A mine: its adit, crosscut and working drawn as cut things are; its spoil heap as a pale tongue with the tramway down it; its shed.
        const m = q.mine, at = (inside: number) => edge + inw * inside, r2 = (i0: number, i1: number, o0: number, o1: number) => rect(Math.min(at(i0), at(i1)), q.z + Math.min(o0, o1), Math.max(at(i0), at(i1)), q.z + Math.max(o0, o1));
        ctx.fillStyle = DARK;
        r2(3, -m.length, -1.1, 1.1);
        r2(-m.length, -m.length - 5.4, -2.7, 2.7);
        r2(-m.cross.at - 0.9, -m.cross.at + 0.9, 0, m.cross.side * m.cross.length);
        ctx.fillStyle = PAPER;
        ctx.globalAlpha = 0.45;
        r2(8, 8 + m.heap, -2.2, 2.2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, 0.5 * ratio);
        ctx.beginPath(); ctx.moveTo(X(at(3)), Z(q.z)); ctx.lineTo(X(at(8 + m.heap - 1)), Z(q.z)); ctx.stroke();
        ctx.fillStyle = INK;
        r2(7.4, 10.4, m.shed * 3.7, m.shed * 6.1);
        continue;
      }
      if (q.hall) {
        // A hall under the hill: its stair and its length drawn as built things are, with its pillars; it runs off beyond the valley's edge.
        const h = q.hall, at = (t: number) => edge + inw * (7 - t), hall0 = 3.9 + h.drop / 0.5 + 1.6;
        ctx.fillStyle = INK;
        rect(Math.min(at(2.6), at(hall0 + h.length + 0.6)), q.z - h.width / 2 - 0.6, Math.max(at(2.6), at(hall0 + h.length + 0.6)), q.z + h.width / 2 + 0.6);
        ctx.fillStyle = DARK;
        rect(Math.min(at(2.6), at(hall0)), q.z - 1.35, Math.max(at(2.6), at(hall0)), q.z + 1.35);
        rect(Math.min(at(hall0), at(hall0 + h.length)), q.z - h.width / 2, Math.max(at(hall0), at(hall0 + h.length)), q.z + h.width / 2);
        ctx.fillStyle = INK;
        for (let u = 3.4; u < h.length - 6.5; u += 4.4) for (const v of [-h.width * 0.27, h.width * 0.27]) rect(at(hall0 + u) - 0.62, q.z + v - 0.62, at(hall0 + u) + 0.62, q.z + v + 0.62);
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, 0.6 * ratio);
        ctx.beginPath();
        for (let t = 3.9; t < hall0 - 1.6; t += 0.68) { ctx.moveTo(X(at(t)), Z(q.z - 1.35)); ctx.lineTo(X(at(t)), Z(q.z + 1.35)); }
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(X(edge - inw * (q.r - 0.3)), Z(q.z), q.r * scale, q.r * 1.2 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(Math.min(X(edge + inw * 4.2), X(edge)), Z(q.z) - 0.9 * scale, Math.abs(X(edge + inw * 4.2) - X(edge)), 1.8 * scale);
      ctx.globalAlpha = 1;
    }
    // The charcoal burners' camp: its clearing as a paler round, the clamps as rings (the one that burns filled), the hut as a dot.
    if (site.camp) {
      const c = site.camp;
      ctx.fillStyle = PAPER;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), c.r * scale, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = Math.max(1, 0.5 * ratio);
      for (const k of c.clamps) { ctx.beginPath(); ctx.arc(X(k.x), Z(k.z), k.r * scale, 0, Math.PI * 2); if (k.state === 'burning') ctx.fill(); else ctx.stroke(); }
      ctx.beginPath(); ctx.arc(X(c.hut.x), Z(c.hut.z), c.hut.r * 0.8 * scale, 0, Math.PI * 2); ctx.fill();
    }
    // What lies under the hill, in broken lines: the way through the hill from a cave of the house; the way down from it; the cavern;
    // and the passage up from the cavern to the cave or the hall in the arm's wall. (Not on the map of someone who is finding the place out.)
    const bw = opts.visited ? undefined : site.backWay, ridge = vale?.ridge;
    if (bw && ridge && vale) {
      const p = site.places[bw.place], dir = bw.side === 'w' ? 1 : -1, rEdge = bw.side === 'w' ? ridge.x0 : ridge.x1, at = (a: number) => rEdge + dir * a;
      const stroke = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)))); ctx.stroke(); };
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.75;
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(1.4 * ratio, 1.2 * scale);
      ctx.setLineDash([Math.max(2.5 * ratio, 1.4 * scale), Math.max(1.5 * ratio, 0.9 * scale)]);
      stroke([[bw.side === 'w' ? p.x0 : p.x1, bw.z], [at(-1), bw.z]]);
      const dp = bw.deep;
      if (dp) {
        const z1 = bw.z + dp.toward * dp.leg;
        stroke([[at(dp.from), bw.z], [at(dp.from), z1], [at(-5), z1], [dp.x + dir * (dp.rx - 1.2), dp.z]]);
        const cave = site.grottoes?.[0];
        if (dp.join && cave) {
          const line = joinLine(vale, cave, dp);
          // (From a hall it begins at the hall's door onward, which is drawn as the hall is.)
          if (cave.hall) { const on = hallOnward(vale, cave, dp.join.toward); line.unshift([on.x, cave.z + dp.join.toward * (cave.hall.width / 2 + (cave.hall.great ? 8 : 0))]); }
          stroke(line);
        }
        ctx.setLineDash([]);
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.ellipse(X(dp.x), Z(dp.z), dp.rx * scale, dp.rz * scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // Streams, drawn before the ponds they run into and out of.
    ctx.strokeStyle = WATER;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of site.streams ?? []) {
      ctx.lineWidth = Math.max(1.2 * ratio, st.width * scale);
      ctx.beginPath();
      st.course.forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (const f of site.features ?? []) {
      if (f.kind === 'pond') {
        // The water covers about the inner three quarters of its hollow, whatever shape that is.
        ctx.fillStyle = WATER;
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) {
          const a = (k / 40) * Math.PI * 2, r = shoreOf(f, Math.cos(a), Math.sin(a)) * 0.75;
          if (k) ctx.lineTo(X(f.x + Math.cos(a) * r), Z(f.z + Math.sin(a) * r)); else ctx.moveTo(X(f.x + r), Z(f.z));
        }
        ctx.fill();
        if (f.isle) {
          ctx.fillStyle = COURT;
          ctx.beginPath();
          ctx.arc(X(f.isle.x), Z(f.isle.z), f.isle.r * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.kind === 'ruin') {
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.2 * ratio, 0.6 * scale);
        ctx.setLineDash([2.2 * scale, 1.2 * scale]);
        ctx.strokeRect(X(f.x - f.r * 0.62), Z(f.z - f.r * 0.5), f.r * 1.24 * scale, f.r * scale);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = INK;
        for (let k = 0; k < 7; k++) {
          ctx.beginPath();
          ctx.arc(X(f.x + Math.cos(k * 0.9) * f.r), Z(f.z + Math.sin(k * 0.9) * f.r), Math.max(1.2 * ratio, 0.45 * scale), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Buildings by the track: shut, so drawn solid, with a paler line for the ridge of a steep roof.
    for (const b of site.buildings ?? []) {
      if (b.plan) {
        // A building that can be gone into is drawn with its rooms, as they are at the level of the ground before its door.
        const turn = b.faces === 'w' ? 1 : -1;
        drawStorey(ctx, b, 0, (u, v) => [X(b.x - (turn * b.d) / 2 + turn * v), Z(b.z + turn * u)], scale);
        continue;
      }
      ctx.fillStyle = INK;
      if (b.style === 'brick') {
        // A building of brick is drawn by all its ground, a church's tower and choir with it; and its ridge, along it or across.
        const turn = b.faces === 'w' ? 1 : -1, xs = (r: { v0: number; v1: number }) => [b.x - (turn * b.d) / 2 + turn * r.v0, b.x - (turn * b.d) / 2 + turn * r.v1];
        for (const r of footprintOf(b)) { const x = xs(r), z = [b.z + turn * r.u0, b.z + turn * r.u1]; rect(Math.min(...x), Math.min(...z), Math.max(...x), Math.max(...z)); }
        ctx.fillStyle = DARK;
        for (const r of footprintOf(b)) { const x = xs(r), z = [b.z + turn * r.u0, b.z + turn * r.u1]; rect(Math.min(...x) + 0.35, Math.min(...z) + 0.35, Math.max(...x) - 0.35, Math.max(...z) - 0.35); }
        ctx.fillStyle = INK;
        if (b.brickwork?.kind === 'gabled' || b.brickwork?.kind === 'store') rect(b.x - b.d / 2, b.z - 0.12, b.x + b.d / 2, b.z + 0.12);
        else rect(b.x - 0.12, b.z - b.w / 2, b.x + 0.12, b.z + b.w / 2);
        continue;
      }
      rect(b.x - b.d / 2, b.z - b.w / 2, b.x + b.d / 2, b.z + b.w / 2);
      ctx.fillStyle = DARK;
      rect(b.x - b.d / 2 + 0.35, b.z - b.w / 2 + 0.35, b.x + b.d / 2 - 0.35, b.z + b.w / 2 - 0.35);
      ctx.fillStyle = INK;
      if (b.style === 'timber' && b.gable) rect(b.x - b.d / 2, b.z - 0.12, b.x + b.d / 2, b.z + 0.12);
      else rect(b.x - 0.12, b.z - b.w / 2 + (b.style === 'imperial' ? b.d / 2 : 0), b.x + 0.12, b.z + b.w / 2 - (b.style === 'imperial' ? b.d / 2 : 0));
    }
    // A tower: its walls in ink as a house's are, its floor within, and its door a gap in one wall.
    for (const t of site.towers ?? []) {
      const wall = 0.9, door = t.door === 'e' ? 1 : -1;
      ctx.fillStyle = INK;
      rect(t.x - t.half - wall, t.z - t.half - wall, t.x + t.half + wall, t.z + t.half + wall);
      ctx.fillStyle = FLOOR;
      rect(t.x - t.half, t.z - t.half, t.x + t.half, t.z + t.half);
      rect(Math.min(t.x + door * t.half, t.x + door * (t.half + wall + 0.1)), t.z - 0.75, Math.max(t.x + door * t.half, t.x + door * (t.half + wall + 0.1)), t.z + 0.75);
    }
    const track = site.track ?? [];
    if (track.length > 1) {
      ctx.strokeStyle = TRACK;
      ctx.lineWidth = Math.max(1.5 * ratio, 2.2 * scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      track.forEach(([tx, tz], k) => (k ? ctx.lineTo(X(tx), Z(tz)) : ctx.moveTo(X(tx), Z(tz))));
      ctx.stroke();
    }
    // Where the track crosses water, and where water comes over the rim.
    for (const st of site.streams ?? []) {
      const c = st.crossing;
      if (c) {
        // Which way the track runs there.
        let ux = 0, uz = 1;
        for (let k = 0; k < track.length - 1; k++) {
          const [ax, az] = track[k], [bx, bz] = track[k + 1];
          if (c.z >= Math.min(az, bz) && c.z <= Math.max(az, bz)) { const l = Math.hypot(bx - ax, bz - az) || 1; ux = (bx - ax) / l; uz = (bz - az) / l; }
        }
        const half = st.width / 2 + 1.2;
        if (c.by === 'ford') {
          // A ford: the water shows over the track, with stones in it.
          ctx.strokeStyle = WATER;
          ctx.lineWidth = Math.max(1.2 * ratio, st.width * scale);
          ctx.beginPath(); ctx.moveTo(X(c.x - uz * 2), Z(c.z + ux * 2)); ctx.lineTo(X(c.x + uz * 2), Z(c.z - ux * 2)); ctx.stroke();
          ctx.fillStyle = INK;
          for (const at of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.arc(X(c.x + ux * at * half), Z(c.z + uz * at * half), Math.max(0.8 * ratio, 0.28 * scale), 0, Math.PI * 2); ctx.fill(); }
        } else {
          // A bridge: its two sides, drawn either side of the track.
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(0.8 * ratio, 0.22 * scale);
          for (const side of [-1.2, 1.2]) {
            ctx.beginPath();
            ctx.moveTo(X(c.x - ux * half - uz * side), Z(c.z - uz * half + ux * side));
            ctx.lineTo(X(c.x + ux * half - uz * side), Z(c.z + uz * half + ux * side));
            ctx.stroke();
          }
        }
      }
      if (st.from === 'fall' && st.course.length > 1) {
        // A fall: a bar across the head of the stream.
        const [ax, az] = st.course[0], [bx, bz] = st.course[1], l = Math.hypot(bx - ax, bz - az) || 1, px = -(bz - az) / l, pz = (bx - ax) / l, w = st.width / 2 + 1;
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1 * ratio, 0.3 * scale);
        ctx.beginPath(); ctx.moveTo(X(ax - px * w), Z(az - pz * w)); ctx.lineTo(X(ax + px * w), Z(az + pz * w)); ctx.stroke();
      }
    }
  }

  // Fog of war: places that have been entered are drawn in full; places seen through an open
  // doorway, arch or window are sketched; everything else is left off the page.
  const shut = opts.shut ?? new Set<number>();
  // A plan is of one storey. Places on another are not on it, and neither is anything in them.
  const storey = opts.level ?? 0, onStorey = (p: Place) => (p.level ?? 0) === storey;
  const entered = (p: Place) => !opts.visited || opts.visited.has(p.id);
  const known = (p: Place) => onStorey(p) && entered(p);
  const glimpsed = new Set<number>();
  if (opts.visited) {
    site.ways.forEach((w, i) => {
      if (shut.has(i) || w.kind === 'stair') return;
      if (opts.visited!.has(w.a) && !opts.visited!.has(w.b)) glimpsed.add(w.b);
      if (opts.visited!.has(w.b) && !opts.visited!.has(w.a)) glimpsed.add(w.a);
    });
  }
  const drawn = (p: Place) => known(p) || (onStorey(p) && glimpsed.has(p.id));
  const hidden = (w: Way, i: number) => w.door?.leaf === 'secret' && shut.has(i) && !opts.showSecrets;
  const wayDrawn = (w: Way, i: number) => w.kind !== 'stair' && !hidden(w, i) && (known(site.places[w.a]) || known(site.places[w.b]));

  // Masonry: every place grown by half a wall, in ink. Low outer walls are drawn thinner.
  for (const p of site.places) {
    if (!drawn(p)) continue;
    ctx.fillStyle = INK;
    ctx.globalAlpha = known(p) ? 1 : 0.35;
    // The ground before the door has no wall round it where it opens onto a valley.
    if (p.role === 'approach' && site.grounds) continue;
    const grow = p.role === 'approach' ? half * 0.6 : half;
    rect(p.x0 - grow, p.z0 - grow, p.x1 + grow, p.z1 + grow);
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
        if (w.kind === 'window' || w.kind === 'stair' || (w.a !== p.id && w.b !== p.id)) continue;
        const side = w.a === p.id ? w.side : ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[w.side];
        const qx = side === 'w' ? p.x0 : side === 'e' ? p.x1 : w.at, qz = side === 'n' ? p.z0 : side === 's' ? p.z1 : w.at;
        ctx.beginPath();
        ctx.arc(X(qx), Z(qz), (w.halfWidth + 0.7) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    if (g && p.role === 'approach') continue;
    ctx.fillStyle = floorOf(p);
    rect(p.x0, p.z0, p.x1, p.z1);
  }

  // Ways: cut through the wall; windows are a thin slot; stairs are ruled across the opening.
  site.ways.forEach((w, index) => {
    if (!wayDrawn(w, index)) return;
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
      ctx.fillStyle = w.door?.lock ? KEY_COLOUR[w.door.lock] : w.door?.leaf === 'secret' ? ACCENT : INK;
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

  // Stairs: the flight ruled across with its treads, and an arrowhead at the end that is higher.
  // Shown on the storey it climbs from and on the one it climbs to, wherever either is known.
  for (const w of site.ways) {
    if (w.kind !== 'stair') continue;
    const lower = site.places[w.a], upper = site.places[w.b];
    if (!((onStorey(lower) && entered(lower)) || (onStorey(upper) && entered(upper)))) continue;
    const to = w.to ?? w.at, dir = to >= w.at ? 1 : -1, wide = w.halfWidth * 2, alongX = w.side === 'n' || w.side === 's';
    const near = w.side === 'n' ? lower.z0 : w.side === 's' ? lower.z1 - wide : w.side === 'w' ? lower.x0 : lower.x1 - wide;
    ctx.fillStyle = FLOOR;
    if (alongX) rect(Math.min(w.at, to), near, Math.max(w.at, to), near + wide); else rect(near, Math.min(w.at, to), near + wide, Math.max(w.at, to));
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 0.6 * ratio);
    ctx.beginPath();
    for (let u = w.at; dir > 0 ? u <= to + 1e-6 : u >= to - 1e-6; u += dir * 0.5) {
      if (alongX) { ctx.moveTo(X(u), Z(near)); ctx.lineTo(X(u), Z(near + wide)); } else { ctx.moveTo(X(near), Z(u)); ctx.lineTo(X(near + wide), Z(u)); }
    }
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    if (alongX) { ctx.moveTo(X(to), Z(near + wide / 2)); ctx.lineTo(X(to - dir * 0.7), Z(near + 0.12)); ctx.lineTo(X(to - dir * 0.7), Z(near + wide - 0.12)); }
    else { ctx.moveTo(X(near + wide / 2), Z(to)); ctx.lineTo(X(near + 0.12), Z(to - dir * 0.7)); ctx.lineTo(X(near + wide - 0.12), Z(to - dir * 0.7)); }
    ctx.fill();
  }

  // Furnishings and marks.
  for (const it of opts.items ?? []) {
    const p = site.places[it.place];
    if (!onStorey(p) && !opts.visited) {
      // Something kept on another storey: marked, smaller and hollow, at the foot or head of the stair that leads to it.
      const stair = site.ways.find((w) => w.kind === 'stair' && (w.a === p.id || w.b === p.id));
      if (stair) {
        const ends = stairEnds(site, stair), at = stair.a === p.id ? ends.head : ends.foot;
        ctx.globalAlpha = 0.55;
        diamond(ctx, X(at[0]), Z(at[1]), Math.max(2.6 * ratio, 0.42 * scale), KEY_COLOUR[it.key]);
        ctx.globalAlpha = 1;
      }
      continue;
    }
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
    if (p.role === 'court' && !p.fallen) {
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

/**
 * Which place a point is in, if any. Where places lie one above another, `y` (the height of
 * the feet) says which: the one whose floor is nearest below. Without it, the one on the ground storey.
 */
export function placeAt(site: Site, x: number, z: number, y?: number): Place | undefined {
  const here = site.places.filter((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
  if (here.length < 2) return here[0];
  if (y === undefined) return here.find((p) => !p.level) ?? here[0];
  // (On a stair the feet are between two floors: they belong to the lower until they are nearly up.)
  return here.filter((p) => p.floor <= y + 0.5).sort((a, b) => b.floor - a.floor)[0] ?? here.sort((a, b) => a.floor - b.floor)[0];
}
