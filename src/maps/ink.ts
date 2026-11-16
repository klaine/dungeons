import { Rng, valueNoise2 } from '../core/rng';
import { OPPOSITE, Place, Site, Way } from '../core/site';

/**
 * The ink map: the same site as the plan, drawn the way a referee's map is drawn by hand. Open
 * floor is left as bare paper inside a heavy wobbling line, and the solid ground around it is
 * filled with short hatching that fades out a little way from the walls. Everything is drawn from
 * the site document and the seed, so the same site always gives the same drawing.
 *
 * Nothing here is traced from the 3D world: the map shows what the document says, which is why it
 * can be made for a site that has never been built.
 */

export interface InkOptions {
  /** Width of the map in pixels. */
  pixels?: number;
  /** Number the rooms. */
  labels?: boolean;
  /** Show what a player should not see at the start: the hidden chamber, keys and levers. */
  secrets?: boolean;
  /** Extra paper left blank beneath the map, in pixels, for a key to be written on. */
  below?: number;
}

type Pt = [number, number];

const INK = '#1d1a17';
const PAPER = '#f1eadb';
const FLOOR = '#fdfaf2';
const GROUND = '#f3f0df';
const ACCENT = '#9c3b25';
const KEY_COLOUR: Record<string, string> = { iron: '#7b8590', gold: '#cf9f2c' };

/** Breaks a polygon into short pieces and pushes each point off line a little, as a hand does. */
function wobble(poly: Pt[], amp: number, seed: number, step = 0.5, freq = 1.1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      out.push([
        x + (valueNoise2(x * freq, z * freq, seed) - 0.5) * 2 * amp,
        z + (valueNoise2(x * freq + 31.7, z * freq - 12.3, seed + 5) - 0.5) * 2 * amp,
      ]);
    }
  }
  return out;
}

const rectPoly = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

function blob(cx: number, cz: number, rx: number, rz: number, seed: number, rough: number, points = 44): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const r = 1 - rough + rough * 2 * valueNoise2(Math.cos(a) * 1.7 + 9, Math.sin(a) * 1.7 + 9, seed);
    out.push([cx + Math.cos(a) * rx * r, cz + Math.sin(a) * rz * r]);
  }
  return out;
}

/** Where a way meets the edge of one of its places, and the direction pointing into that place. */
function mouth(site: Site, w: Way, placeId: number): { x: number; z: number; nx: number; nz: number } {
  const p = site.places[placeId];
  const side = w.a === placeId ? w.side : OPPOSITE[w.side];
  if (side === 'n') return { x: w.at, z: p.z0, nx: 0, nz: 1 };
  if (side === 's') return { x: w.at, z: p.z1, nx: 0, nz: -1 };
  if (side === 'w') return { x: p.x0, z: w.at, nx: 1, nz: 0 };
  return { x: p.x1, z: w.at, nx: -1, nz: 0 };
}

/** The strip of wall a way passes through: its extent on the plan. */
function gap(site: Site, w: Way, grow = 0): { x0: number; x1: number; z0: number; z1: number; alongX: boolean } {
  const a = site.places[w.a], T = site.wallThickness;
  const alongX = w.side === 'n' || w.side === 's';
  const wall = w.side === 'n' ? a.z0 - T : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0 - T;
  const lo = w.at - w.halfWidth, hi = w.at + w.halfWidth;
  return alongX
    ? { x0: lo, x1: hi, z0: wall - grow, z1: wall + T + grow, alongX }
    : { x0: wall - grow, x1: wall + T + grow, z0: lo, z1: hi, alongX };
}

/** Draws the map, title and all, onto a canvas sized to fit. Returns the height the map itself takes. */
export function drawInk(canvas: HTMLCanvasElement, site: Site, opts: InkOptions = {}): number {
  const W = opts.pixels ?? 2000;
  const u = W / 2000;                       // one unit of line weight
  const secrets = opts.secrets ?? true;
  const rng = new Rng(site.seed).fork('ink');
  const seed = Math.floor(rng.next() * 1e6);
  const T = site.wallThickness;

  // The map is of the ground storey: rooms over it and cellars under it are named in the key, not drawn.
  const shown = (p: Place) => !p.level && (secrets || p.id !== site.secret);
  const wayShown = (w: Way) => w.kind !== 'stair' && (secrets || w.door?.leaf !== 'secret');
  const places = site.places.filter(shown);

  // ---- the page: a heading, the map, then a scale and a compass
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of places) {
    x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1);
    z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1);
  }
  const margin = 3.2;
  x0 -= margin; x1 += margin; z0 -= margin; z1 += margin;
  const head = 190 * u, foot = 150 * u, edge = 50 * u;
  const scale = (W - 2 * edge) / (x1 - x0);
  const H = Math.round(head + (z1 - z0) * scale + foot);
  const page = H + Math.round(opts.below ?? 0);
  canvas.width = W;
  canvas.height = page;
  const ctx = canvas.getContext('2d')!;
  const X = (x: number) => edge + (x - x0) * scale;
  const Z = (z: number) => head + (z - z0) * scale;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, page);
  // Paper: faint mottling, darker towards the edges.
  for (let k = 0; k < 2600 * (page / H); k++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(120,96,60,0.035)' : 'rgba(255,255,255,0.09)';
    const r = rng.range(4, 26) * u;
    ctx.beginPath();
    ctx.ellipse(rng.range(0, W), rng.range(0, page), r, r * rng.range(0.4, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  const shade = ctx.createRadialGradient(W / 2, page / 2, Math.min(W, page) * 0.35, W / 2, page / 2, Math.hypot(W, page) * 0.56);
  shade.addColorStop(0, 'rgba(90,70,40,0)');
  shade.addColorStop(1, 'rgba(90,70,40,0.16)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, page);

  // ---- the shapes of open floor
  interface Shape { poly: Pt[]; place?: Place; kind: 'room' | 'court' | 'cave' | 'ground' | 'way' }
  const shapes: Shape[] = [];
  for (const p of places) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (p.role === 'approach') {
      // Open ground in a hollow: straight where it meets the house, ragged everywhere else.
      const base = wobble(rectPoly(p.x0, p.z0, p.x1, p.z1), 0.04, seed, 0.6);
      const poly = base.map(([x, z]): Pt => {
        const away = Math.min(1, Math.max(0, (z - p.z0) / 2.5));
        const corner = Math.min(1, Math.min(x - p.x0, p.x1 - x) / 4) * Math.min(1, (p.z1 - z) / 4);
        const pull = (1 - Math.min(1, Math.max(0, corner) * 4)) * 1.6 * away;
        const dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz) || 1;
        const ragged = (valueNoise2(x * 0.35, z * 0.35, seed + 3) - 0.5) * 2.4 + (valueNoise2(x * 1.4, z * 1.4, seed + 4) - 0.5) * 0.5;
        return [x + ((dx / d) * pull + ragged * (dx / d)) * away, z + ((dz / d) * pull + ragged * (dz / d)) * away];
      });
      shapes.push({ poly, place: p, kind: 'ground' });
    } else if (p.roof === 'cave') {
      shapes.push({ poly: blob(cx, cz, (p.x1 - p.x0) / 2 - 0.25, (p.z1 - p.z0) / 2 - 0.25, seed + p.id * 13, 0.13), place: p, kind: 'cave' });
      // A bay running in from each way, so the cave always joins its doors.
      for (const w of site.ways) {
        if (w.kind === 'window' || !wayShown(w) || (w.a !== p.id && w.b !== p.id)) continue;
        const m = mouth(site, w, p.id);
        const tx = m.x + (cx - m.x) * 0.6, tz = m.z + (cz - m.z) * 0.6;
        const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz) || 1;
        const px = (-dz / d) * (w.halfWidth + 0.45), pz = (dx / d) * (w.halfWidth + 0.45);
        const quad: Pt[] = [[m.x + px, m.z + pz], [tx + px, tz + pz], [tx - px, tz - pz], [m.x - px, m.z - pz]];
        shapes.push({ poly: wobble(quad, 0.16, seed + p.id, 0.45, 1.3), kind: 'cave' });
        shapes.push({ poly: blob(m.x + m.nx * 0.5, m.z + m.nz * 0.5, w.halfWidth + 0.55, w.halfWidth + 0.55, seed + w.at, 0.1, 18), kind: 'cave' });
      }
    } else {
      shapes.push({ poly: wobble(rectPoly(p.x0, p.z0, p.x1, p.z1), 0.045, seed), place: p, kind: p.roof === 'sky' ? 'court' : 'room' });
    }
  }
  site.ways.forEach((w) => {
    if (w.kind === 'window' || !wayShown(w) || !shown(site.places[w.a]) || !shown(site.places[w.b])) return;
    const g = gap(site, w, 0.14);
    shapes.push({ poly: rectPoly(g.x0, g.z0, g.x1, g.z1), kind: 'way' });
  });

  const trace = (poly: Pt[]) => {
    ctx.beginPath();
    poly.forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.closePath();
  };

  // ---- hatching: the solid ground, drawn only near open floor so it fades into bare paper
  const reach = (x: number, z: number): number => {
    let best = Infinity;
    for (const p of places) {
      const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
      const d = Math.hypot(dx, dz) + (p.role === 'approach' ? 0.9 : 0);
      if (d < best) best = d;
    }
    return best;
  };
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cell = 0.82;
  for (let gz = z0; gz < z1; gz += cell) for (let gx = x0; gx < x1; gx += cell) {
    const hx = gx + rng.range(0.1, 0.7) * cell, hz = gz + rng.range(0.1, 0.7) * cell;
    const angle = rng.range(0, Math.PI);
    const count = rng.int(3, 4);
    const far = 1.25 + 1.5 * valueNoise2(hx * 0.45, hz * 0.45, seed + 9);
    if (reach(hx, hz) > far) continue;
    const ax = Math.cos(angle), az = Math.sin(angle);
    ctx.lineWidth = Math.max(1, rng.range(1.5, 2.1) * u);
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const off = (k - (count - 1) / 2) * 0.2;
      const len = rng.range(0.34, 0.47);
      const mx = hx - az * off + rng.range(-0.03, 0.03), mz = hz + ax * off + rng.range(-0.03, 0.03);
      ctx.moveTo(X(mx - ax * len), Z(mz - az * len));
      ctx.lineTo(X(mx + ax * len), Z(mz + az * len));
    }
    ctx.stroke();
  }

  // ---- the wall line: every shape stroked heavily, then every shape filled, which leaves only
  // the outside half of the stroke round the union of them all
  const wall = Math.max(2.5, 0.125 * scale);
  ctx.strokeStyle = INK;
  for (const s of shapes) {
    ctx.lineWidth = (s.kind === 'ground' ? 0.62 : 1) * wall * 2;
    trace(s.poly);
    ctx.stroke();
  }
  for (const s of shapes) {
    ctx.fillStyle = s.kind === 'ground' ? GROUND : FLOOR;
    trace(s.poly);
    ctx.fill();
  }

  // ---- what the floor is made of
  const thin = Math.max(1, 1.3 * u);
  for (const s of shapes) {
    const p = s.place;
    if (!p) continue;
    ctx.save();
    trace(s.poly);
    ctx.clip();
    const r = rng.fork(`floor/${p.id}`);
    if (s.kind === 'room') {
      // Flagstones: a ruled grid, drawn unsteadily and with gaps.
      ctx.strokeStyle = 'rgba(29,26,23,0.2)';
      ctx.lineWidth = thin;
      const g = 1.5;
      const line = (ax: number, az: number, bx: number, bz: number) => {
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75);
        for (let k = 0; k < n; k++) {
          if (r.chance(0.1)) continue;
          const f0 = k / n, f1 = (k + 1) / n;
          const j = () => r.range(-0.025, 0.025);
          ctx.beginPath();
          ctx.moveTo(X(ax + (bx - ax) * f0 + j()), Z(az + (bz - az) * f0 + j()));
          ctx.lineTo(X(ax + (bx - ax) * f1 + j()), Z(az + (bz - az) * f1 + j()));
          ctx.stroke();
        }
      };
      for (let x = Math.ceil(p.x0 / g) * g; x < p.x1; x += g) line(x, p.z0, x, p.z1);
      for (let z = Math.ceil(p.z0 / g) * g; z < p.z1; z += g) line(p.x0, z, p.x1, z);
      if (p.light === 'dark') {
        // Unlit: a wash of slanting lines.
        ctx.strokeStyle = 'rgba(29,26,23,0.2)';
        ctx.lineWidth = thin;
        const span = p.x1 - p.x0 + (p.z1 - p.z0);
        ctx.beginPath();
        for (let d = 0; d < span; d += 0.42) {
          ctx.moveTo(X(p.x0 + d), Z(p.z0));
          ctx.lineTo(X(p.x0 + d - (p.z1 - p.z0)), Z(p.z1));
        }
        ctx.stroke();
      }
    } else {
      // Open ground and cave floor: stippled, and turf has tufts of grass.
      const area = (p.x1 - p.x0) * (p.z1 - p.z0);
      ctx.fillStyle = 'rgba(29,26,23,0.42)';
      for (let k = 0; k < area * (s.kind === 'cave' ? 1.6 : 1.1); k++) {
        ctx.beginPath();
        ctx.arc(X(r.range(p.x0, p.x1)), Z(r.range(p.z0, p.z1)), r.range(0.7, 1.5) * u, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.kind === 'ground' || (s.kind === 'court' && !p.fallen)) {
        ctx.strokeStyle = 'rgba(29,26,23,0.6)';
        ctx.lineWidth = thin;
        for (let k = 0; k < area * (s.kind === 'ground' ? 0.2 : 0.1); k++) {
          const tx = r.range(p.x0 + 0.4, p.x1 - 0.4), tz = r.range(p.z0 + 0.4, p.z1 - 0.4);
          ctx.beginPath();
          for (const lean of [-0.14, 0, 0.14]) {
            ctx.moveTo(X(tx + lean * 0.6), Z(tz));
            ctx.lineTo(X(tx + lean * 1.8), Z(tz - r.range(0.16, 0.26)));
          }
          ctx.stroke();
        }
      }
      if (s.kind === 'cave') {
        ctx.strokeStyle = 'rgba(29,26,23,0.5)';
        ctx.lineWidth = thin;
        for (let k = 0; k < area * 0.16; k++) {
          const a = r.range(0, Math.PI * 2);
          ctx.beginPath();
          ctx.arc(X(r.range(p.x0, p.x1)), Z(r.range(p.z0, p.z1)), r.range(0.08, 0.2) * scale, a, a + r.range(1.4, 2.6));
          ctx.stroke();
        }
      }
    }
    if (p.fallen) {
      // What came down: stones lying where they fell.
      ctx.strokeStyle = INK;
      ctx.fillStyle = FLOOR;
      ctx.lineWidth = Math.max(1, 1.8 * u);
      const n = Math.round((p.x1 - p.x0) * (p.z1 - p.z0) * 0.3);
      for (let k = 0; k < n; k++) {
        const bx = r.range(p.x0 + 0.5, p.x1 - 0.5), bz = r.range(p.z0 + 0.5, p.z1 - 0.5), br = r.range(0.14, 0.42);
        trace(blob(bx, bz, br, br * r.range(0.6, 1), seed + k * 7 + p.id, 0.2, 7));
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // The path across the approach, from the door of the house to the edge of the page.
  const approach = places.find((p) => p.role === 'approach');
  if (approach) {
    const front = site.ways.find((w) => w.kind !== 'window' && (w.a === approach.id || w.b === approach.id));
    if (front) {
      const m = mouth(site, front, approach.id);
      ctx.strokeStyle = 'rgba(29,26,23,0.55)';
      ctx.lineWidth = Math.max(1, 1.6 * u);
      ctx.setLineDash([7 * u, 9 * u]);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let d = 0.3; d < approach.z1 - approach.z0 - 1.2; d += 0.5) {
          const sway = (valueNoise2(d * 0.3, 2, seed) - 0.5) * 1.2 * Math.min(1, d / 4);
          const px = m.x + sway + side * (front.halfWidth + 0.25), pz = m.z + m.nz * d;
          if (d < 0.4) ctx.moveTo(X(px), Z(pz)); else ctx.lineTo(X(px), Z(pz));
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // ---- doors, windows and stairs
  const doorLine = Math.max(1.5, 2.4 * u);
  site.ways.forEach((w) => {
    if (!wayShown(w) || !shown(site.places[w.a]) || !shown(site.places[w.b])) return;
    const a = site.places[w.a], b = site.places[w.b];
    const g = gap(site, w);
    const mid = g.alongX ? (g.z0 + g.z1) / 2 : (g.x0 + g.x1) / 2;
    const bar = (thickness: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = INK;
      ctx.lineWidth = doorLine;
      const h = thickness / 2;
      const rx = g.alongX ? g.x0 : mid - h, rz = g.alongX ? mid - h : g.z0;
      const rw = g.alongX ? g.x1 - g.x0 : thickness, rh = g.alongX ? thickness : g.z1 - g.z0;
      ctx.fillRect(X(rx), Z(rz), rw * scale, rh * scale);
      ctx.strokeRect(X(rx), Z(rz), rw * scale, rh * scale);
    };
    if (w.kind === 'window') {
      // A window: the wall line broken by a narrow slot.
      ctx.fillStyle = PAPER;
      ctx.fillRect(X(g.x0), Z(g.z0), (g.x1 - g.x0) * scale, (g.z1 - g.z0) * scale);
      ctx.strokeStyle = INK;
      ctx.lineWidth = doorLine;
      ctx.strokeRect(X(g.x0), Z(g.z0), (g.x1 - g.x0) * scale, (g.z1 - g.z0) * scale);
      ctx.beginPath();
      if (g.alongX) { ctx.moveTo(X(g.x0), Z(mid)); ctx.lineTo(X(g.x1), Z(mid)); }
      else { ctx.moveTo(X(mid), Z(g.z0)); ctx.lineTo(X(mid), Z(g.z1)); }
      ctx.stroke();
      return;
    }
    // Steps: ruled across the opening, one line a step.
    const steps = Math.round(Math.abs(a.floor - b.floor) / 0.17);
    if (steps > 0) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.beginPath();
      for (let k = 1; k <= steps; k++) {
        const t = k / (steps + 1);
        if (g.alongX) { const z = g.z0 + (g.z1 - g.z0) * t; ctx.moveTo(X(g.x0), Z(z)); ctx.lineTo(X(g.x1), Z(z)); }
        else { const x = g.x0 + (g.x1 - g.x0) * t; ctx.moveTo(X(x), Z(g.z0)); ctx.lineTo(X(x), Z(g.z1)); }
      }
      ctx.stroke();
    }
    const door = w.door;
    if (!door || door.leaf === 'open') return;
    if (door.leaf === 'gate') {
      // A portcullis: a row of bars seen end on.
      ctx.fillStyle = INK;
      const n = Math.max(3, Math.round((w.halfWidth * 2) / 0.3));
      for (let k = 0; k < n; k++) {
        const t = w.at - w.halfWidth + ((k + 0.5) / n) * w.halfWidth * 2;
        ctx.beginPath();
        ctx.arc(g.alongX ? X(t) : X(mid), g.alongX ? Z(mid) : Z(t), Math.max(2, 0.075 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (door.leaf === 'secret') {
      // A secret door: the wall carried across, marked with an S.
      bar(T + 0.02, PAPER);
      ctx.fillStyle = ACCENT;
      ctx.font = `italic 700 ${Math.max(12 * u, 0.95 * scale)}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', g.alongX ? X(w.at) : X(mid), g.alongX ? Z(mid) : Z(w.at));
      return;
    }
    bar(0.34, door.lock ? KEY_COLOUR[door.lock] : FLOOR);
    if (door.barredFrom !== undefined) {
      // Barred: a heavy stroke on the side it opens from.
      const toA = door.barredFrom === w.a;
      const sign = (w.side === 'n' || w.side === 'w') === toA ? 1 : -1;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(3, 0.11 * scale);
      ctx.beginPath();
      const off = mid + sign * 0.34;
      if (g.alongX) { ctx.moveTo(X(g.x0 + 0.12), Z(off)); ctx.lineTo(X(g.x1 - 0.12), Z(off)); }
      else { ctx.moveTo(X(off), Z(g.z0 + 0.12)); ctx.lineTo(X(off), Z(g.z1 - 0.12)); }
      ctx.stroke();
    }
  });

  // ---- what stands in the rooms, and their numbers
  for (const p of places) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (p.role === 'court' && !p.fallen) {
      // The well.
      ctx.strokeStyle = INK;
      ctx.fillStyle = FLOOR;
      ctx.lineWidth = Math.max(1.5, 2.6 * u);
      trace(blob(cx, cz, 0.95, 0.95, seed + 21, 0.03, 26));
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(29,26,23,0.78)';
      trace(blob(cx, cz, 0.58, 0.58, seed + 22, 0.04, 20));
      ctx.fill();
    }
    if (p.role === 'goal') star(ctx, X(cx), Z(cz), Math.max(8 * u, 0.85 * scale), ACCENT);
    if (secrets && p.id === site.secret) star(ctx, X(cx), Z(cz), Math.max(6 * u, 0.5 * scale), ACCENT);
  }
  if (secrets) {
    for (const it of site.items) {
      const p = site.places[it.place];
      key(ctx, X((p.x0 + p.x1) / 2), Z((p.z0 + p.z1) / 2), Math.max(7 * u, 0.42 * scale), KEY_COLOUR[it.key]);
    }
    for (const l of site.levers) {
      const r = Math.max(5 * u, 0.3 * scale);
      ctx.fillStyle = INK;
      ctx.fillRect(X(l.x) - r / 2, Z(l.z) - r / 2, r, r);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = Math.max(2 * u, 0.13 * scale);
      ctx.beginPath();
      ctx.moveTo(X(l.x), Z(l.z));
      ctx.lineTo(X(l.x) + r * 1.4, Z(l.z) - r * 1.4);
      ctx.stroke();
    }
  }
  if (opts.labels ?? true) {
    ctx.font = `italic ${Math.max(15 * u, 1.05 * scale)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of places) {
      if (p.role === 'approach') continue;
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      const busy = p.role === 'goal' || p.role === 'court' || p.id === site.secret || (secrets && site.items.some((it) => it.place === p.id));
      // Step the number aside from whatever is drawn in the middle: down, or along in a shallow room.
      const deep = p.z1 - p.z0 >= 4.6;
      const lx = X(cx - (busy && !deep ? Math.min(2.1, (p.x1 - p.x0) / 2 - 0.7) : 0));
      const lz = Z(cz + (busy && deep ? Math.min(1.7, (p.z1 - p.z0) / 2 - 0.75) : 0));
      // Clear the paper behind the number so the floor's lines do not run through it.
      ctx.fillStyle = FLOOR;
      ctx.beginPath();
      ctx.arc(lx, lz, Math.max(11 * u, 0.62 * scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(String(p.id + 1), lx, lz + 1.5 * u);
    }
  }

  // ---- heading
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${54 * u}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(site.seed, edge, 86 * u, W - 2 * edge);
  ctx.font = `italic ${27 * u}px Georgia, 'Times New Roman', serif`;
  wrap(ctx, site.title, W - 2 * edge).slice(0, 2).forEach((text, k) => ctx.fillText(text, edge, (130 + k * 36) * u));
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 2 * u);

  // ---- scale: five metres to a block
  const sy = H - foot * 0.5, sx = edge;
  ctx.font = `${22 * u}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 ? PAPER : INK;
    ctx.fillRect(sx + k * 5 * scale, sy, 5 * scale, 12 * u);
    ctx.strokeRect(sx + k * 5 * scale, sy, 5 * scale, 12 * u);
  }
  ctx.fillStyle = INK;
  for (let k = 0; k <= 4; k++) ctx.fillText(k === 4 ? '20 metres' : String(k * 5), sx + k * 5 * scale, sy - 10 * u);

  // ---- compass: north is up the page
  const kx = W - edge - 56 * u, ky = H - foot * 0.52, kr = 44 * u;
  ctx.beginPath();
  ctx.moveTo(kx, ky - kr); ctx.lineTo(kx + kr * 0.3, ky + kr * 0.6); ctx.lineTo(kx, ky + kr * 0.3); ctx.lineTo(kx - kr * 0.3, ky + kr * 0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(kx, ky - kr); ctx.lineTo(kx + kr * 0.3, ky + kr * 0.6); ctx.lineTo(kx, ky + kr * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 ${26 * u}px Georgia, 'Times New Roman', serif`;
  ctx.fillText('N', kx, ky - kr - 10 * u);
  return H;
}

/** Breaks a sentence into lines no wider than `width`. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
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

/** A key: a ring, a shaft and two teeth, in its metal with an ink edge. */
function key(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  const path = () => {
    ctx.beginPath();
    ctx.arc(x - r * 0.9, y, r * 0.55, 0, Math.PI * 2);
    ctx.moveTo(x - r * 0.35, y);
    ctx.lineTo(x + r * 1.5, y);
    ctx.moveTo(x + r * 0.85, y);
    ctx.lineTo(x + r * 0.85, y + r * 0.6);
    ctx.moveTo(x + r * 1.35, y);
    ctx.lineTo(x + r * 1.35, y + r * 0.6);
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.62;
  path();
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = r * 0.3;
  path();
  ctx.stroke();
}
