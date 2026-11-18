import { Rng, valueNoise2 } from '../core/rng';
import { rimAt } from '../core/mountain';
import { footprintOf } from '../core/building';
import { boxValley, edgeAt } from '../core/valley';
import { coastLine, inHarbour, nearLine, outlineOf, outsideBlock, outsideRect, riverAt, townBounds, townGround } from '../core/town';
import { shoreOf, Site } from '../core/site';

/**
 * The ink map of the whole place, in the hand of the ink map of the house: the valley shut in by its rock, the island ringed by its
 * cliffs in the sea, or the mountain top above its precipices in the cloud; and on it the house, the track and the paths, the water,
 * the buildings and what else the site document holds. Drawn from the document and the seed alone, so the same site always gives
 * the same drawing. (The woods are not in the document, being decided where the place is built, and are not drawn.)
 *
 * Its conventions are an old map's: the edge of the land a heavy wobbling line; rock round a valley in short hatching that fades
 * away from it; cliffs and precipices as hachures, strokes running down the fall, longer where the fall is higher; the sea in lines
 * following the coast at widening distances; cloud as scalloped banks; a track as a pair of lines, a path dotted.
 */

type Pt = [number, number];
const INK = '#1d1a17';
const PAPER = '#f1eadb';
const WATER = '#5f7d8a';

export function drawInkCountry(canvas: HTMLCanvasElement, site: Site, opts: { pixels?: number } = {}): number {
  const g = site.grounds;
  if (!g) return 0;
  const W = opts.pixels ?? 2000, u = W / 2000;
  const rng = new Rng(site.seed).fork('ink country'), seed = Math.floor(rng.next() * 1e6);
  const isle = site.island, mtn = site.mountain, town = site.town, vale = !isle && !mtn && !town ? site.valley ?? boxValley(g) : undefined;
  const F = site.places.find((p) => p.role === 'approach')?.floor ?? 0, tb = town ? townBounds(town, 50) : undefined;
  const house = site.places.filter((p) => p.role !== 'approach' && !p.level);
  const T = site.wallThickness;

  // ---- the land, as polygons in the ground's own measures
  const land: Pt[][] = [];
  let spurLine: Pt[] = [];
  if (isle) {
    const n = isle.coast.length;
    land.push(Array.from({ length: n }, (_, k): Pt => { const a = (k / n) * Math.PI * 2, r = isle.coast[k]; return [isle.x + Math.cos(a) * r, isle.z + Math.sin(a) * r]; }));
  } else if (mtn) {
    land.push(Array.from({ length: 480 }, (_, k): Pt => { const a = (k / 480) * Math.PI * 2, r = rimAt(mtn, a); return [mtn.x + Math.cos(a) * r, mtn.z + Math.sin(a) * r]; }));
    spurLine = (mtn.spur.crest ?? [[...mtn.spur.from, 0], [...mtn.spur.to, 0]]).map(([x, z]): Pt => [x, z]);
  } else if (town) {
    // A town: the land north of its coast, within the part of it drawn.
    const coast = coastLine(town, F, tb!.x0, tb!.x1, tb!.z0, tb!.z1, 2);
    land.push([...coast, [tb!.x1, tb!.z0], [tb!.x0, tb!.z0]]);
  } else if (vale) {
    const end = vale.mouth + 6, west: Pt[] = [], east: Pt[] = [];
    for (let z = g.z0 - 2; z <= end; z += 1.5) { west.push([edgeAt(vale, 'w', z), z]); east.push([edgeAt(vale, 'e', z), z]); }
    land.push([...west, ...east.reverse()]);
  }
  // The bounds: all of the land, with a margin of what lies round it.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const poly of land) for (const [x, z] of poly) grow(x, z);
  for (const [x, z] of spurLine) grow(x, z);
  for (const p of house) { grow(p.x0 - T, p.z0 - T); grow(p.x1 + T, p.z1 + T); }
  if (tb) { grow(tb.x0, tb.z0); grow(tb.x1, tb.z1); }
  const margin = isle ? 30 : mtn ? 34 : town ? 0 : 24;
  x0 -= margin; x1 += margin; z0 -= margin * (vale ? 0.6 : 1); z1 += margin * (vale ? 0.4 : 1);

  const head = 150 * u, foot = 130 * u, edge = 50 * u;
  const scale = (W - 2 * edge) / (x1 - x0), H = Math.round(head + (z1 - z0) * scale + foot);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const X = (x: number) => edge + (x - x0) * scale, Z = (z: number) => head + (z - z0) * scale;
  const wob = (poly: Pt[], amp: number, closed = true, step = 1.2): Pt[] => {
    const out: Pt[] = [];
    const n = closed ? poly.length : poly.length - 1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let j = 0; j < k; j++) {
        const x = ax + ((bx - ax) * j) / k, z = az + ((bz - az) * j) / k;
        out.push([x + (valueNoise2(x * 0.3, z * 0.3, seed) - 0.5) * 2 * amp, z + (valueNoise2(x * 0.3 + 17, z * 0.3 - 9, seed + 1) - 0.5) * 2 * amp]);
      }
    }
    if (!closed) out.push(poly[poly.length - 1]);
    return out;
  };
  const path = (poly: Pt[], closed = true) => {
    ctx.beginPath();
    poly.forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    if (closed) ctx.closePath();
  };

  // ---- paper
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 2600; k++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(120,96,60,0.035)' : 'rgba(255,255,255,0.09)';
    const r = rng.range(4, 26) * u;
    ctx.beginPath();
    ctx.ellipse(rng.range(0, W), rng.range(0, H), r, r * rng.range(0.4, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  const shade = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  shade.addColorStop(0, 'rgba(90,70,40,0)');
  shade.addColorStop(1, 'rgba(90,70,40,0.16)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // ---- where the land is, and how far any point lies outside it: drawn into a mask, then measured on a coarse grid
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const mc = mask.getContext('2d')!;
  mc.fillStyle = '#fff';
  mc.strokeStyle = '#fff';
  for (const poly of land) { mc.beginPath(); poly.forEach(([x, z], k) => (k ? mc.lineTo(X(x), Z(z)) : mc.moveTo(X(x), Z(z)))); mc.closePath(); mc.fill(); }
  if (mtn && spurLine.length > 1) {
    mc.lineWidth = mtn.spur.width * 0.86 * scale; mc.lineCap = 'round'; mc.lineJoin = 'round';
    mc.beginPath(); spurLine.forEach(([x, z], k) => (k ? mc.lineTo(X(x), Z(z)) : mc.moveTo(X(x), Z(z)))); mc.stroke();
  }
  const C = Math.max(4, Math.round(6 * u)), gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const px = mc.getImageData(0, 0, W, H).data, dist = new Float32Array(gw * gh).fill(1e9), queue: number[] = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const sx = Math.min(W - 1, i * C + (C >> 1)), sy = Math.min(H - 1, j * C + (C >> 1));
    if (px[(sy * W + sx) * 4] > 128) { dist[j * gw + i] = 0; queue.push(j * gw + i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], i = c % gw, j = (c - i) / gw;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const n = nj * gw + ni;
      if (dist[n] > dist[c] + 1) { dist[n] = dist[c] + 1; queue.push(n); }
    }
  }
  // (In metres: a grid step is C pixels; the walk on the grid overstates a diagonal a little, which a hand's map can bear.)
  const outside = (x: number, z: number) => { const i = Math.floor(X(x) / C), j = Math.floor(Z(z) / C); return i < 0 || j < 0 || i >= gw || j >= gh ? 1e9 : (dist[j * gw + i] * C) / scale; };

  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /** Short strokes in a little bundle, as rock and rough ground are hatched. */
  const bundle = (x: number, z: number, angle: number, len: number, count: number) => {
    const ax = Math.cos(angle), az = Math.sin(angle), bx = -az, bz = ax;
    ctx.lineWidth = Math.max(1, rng.range(1.4, 2) * u);
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const o = (k - (count - 1) / 2) * 7 * u / scale, l = len * rng.range(0.75, 1.1) / 2;
      ctx.moveTo(X(x + bx * o - ax * l), Z(z + bz * o - az * l));
      ctx.lineTo(X(x + bx * o + ax * l), Z(z + bz * o + az * l));
    }
    ctx.stroke();
  };

  // ---- what lies outside the land
  if (vale) {
    // Rock: hatching in bundles near the edge of the valley, thinning out away from it.
    const cell = 30 * u / scale;
    for (let z = z0; z < z1; z += cell) for (let x = x0; x < x1; x += cell) {
      const hx = x + rng.range(0.1, 0.9) * cell, hz = z + rng.range(0.1, 0.9) * cell, d = outside(hx, hz);
      const reach = 10 + 9 * valueNoise2(hx * 0.06, hz * 0.06, seed + 3);
      if (d <= 0.3 || d > reach || rng.chance(Math.max(0, d / reach - 0.35))) continue;
      bundle(hx, hz, rng.range(0, Math.PI), 22 * u / scale, rng.int(3, 4));
    }
  }
  if (isle) {
    // The sea: lines following the coast, further apart the further out, broken here and there.
    const n = isle.coast.length;
    ctx.strokeStyle = WATER;
    for (const [k, out] of [[0, 2.2], [1, 5], [2, 9], [3, 14.5]] as const) {
      ctx.lineWidth = Math.max(1, (2.4 - k * 0.4) * u);
      ctx.setLineDash([(60 - k * 8) * u, (6 + k * 7) * u]);
      const ring = Array.from({ length: n }, (_, i): Pt => { const a = (i / n) * Math.PI * 2, r = isle.coast[i] + out; return [isle.x + Math.cos(a) * r, isle.z + Math.sin(a) * r]; });
      path(wob(ring, 0.5 + k * 0.3, true, 2.5));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
    // Stacks out in the sea: rocks, hatched.
    // (Each a rock with its edge inked and hachures falling from it to the water.)
    for (const q of isle.stacks) {
      const r = Math.max(3 * u / scale, q.r), rock = Array.from({ length: 11 }, (_, k): Pt => { const a = (k / 11) * Math.PI * 2, f = 0.7 + 0.5 * valueNoise2(q.x + Math.cos(a) * 2, q.z + Math.sin(a) * 2, seed + 7); return [q.x + Math.cos(a) * r * f, q.z + Math.sin(a) * r * f]; });
      ctx.fillStyle = PAPER; ctx.lineWidth = Math.max(1.5, 2.2 * u);
      path(rock); ctx.fill(); ctx.stroke();
      ctx.lineWidth = Math.max(1, 1.1 * u);
      for (let k = 0; k < 11; k += 1) {
        const [x, z] = rock[k], dx = x - q.x, dz = z - q.z, d = Math.hypot(dx, dz) || 1, len = rng.range(0.5, 1.1);
        ctx.beginPath(); ctx.moveTo(X(x), Z(z)); ctx.lineTo(X(x + (dx / d) * len), Z(z + (dz / d) * len)); ctx.stroke();
      }
    }
  }
  if (town) {
    // The sea: lines following the coast, further apart the further out, broken here and there.
    ctx.strokeStyle = WATER;
    for (const [k, out] of [[0, 2.5], [1, 6], [2, 11], [3, 18]] as const) {
      ctx.lineWidth = Math.max(1, (2.4 - k * 0.4) * u);
      ctx.setLineDash([(60 - k * 8) * u, (6 + k * 7) * u]);
      path(wob(land[0].slice(0, -2).map(([x, z]): Pt => [x, z + out]), 0.5 + k * 0.3, false, 2.5), false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
  }
  /** Hachures down a fall from an edge: strokes running out from it, the longer the higher the fall, in a band round it. */
  const hachures = (poly: Pt[], closed: boolean, length: (k: number) => number, spacing: number) => {
    ctx.lineWidth = Math.max(1, 1.5 * u);
    const n = poly.length;
    let carry = 0;
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % n], l = Math.hypot(bx - ax, bz - az) || 1;
      for (let t = carry; t < l; t += spacing) {
        const x = ax + ((bx - ax) * t) / l, z = az + ((bz - az) * t) / l;
        let nx = -(bz - az) / l, nz = (bx - ax) / l;
        // (Pointing away from the land.)
        if (outside(x + nx * 1.5, z + nz * 1.5) < outside(x - nx * 1.5, z - nz * 1.5)) { nx = -nx; nz = -nz; }
        if (outside(x + nx * 1.5, z + nz * 1.5) <= 0.1) continue;
        const len = length(k) * rng.range(0.7, 1.15);
        ctx.beginPath();
        ctx.moveTo(X(x + nx * 0.4), Z(z + nz * 0.4));
        ctx.lineTo(X(x + nx * len + rng.range(-0.3, 0.3)), Z(z + nz * len + rng.range(-0.3, 0.3)));
        ctx.stroke();
      }
      carry = (carry + spacing - (l % spacing)) % spacing;
    }
  };
  if (isle) {
    const n = isle.coast.length;
    hachures(land[0], true, (k) => 1.2 + 3.2 * (1 - (isle.edge?.[Math.floor((k / land[0].length) * n)] ?? 0)), 9 * u / scale);
  }
  if (town) {
    // Where the coast stands high, it is cliff: hachures down to the water, the longer the higher.
    const coast = land[0].slice(0, -2);
    hachures(coast, false, (k) => { const [x, z] = coast[k]; const h = townGround(town, F, x, z - 3) - town.sea; return h < 3 ? 0 : 1 + Math.min(5, h / 5); }, 7 * u / scale);
  }
  if (mtn) {
    // The precipices under the rim, and down either side of the ridge; then cloud below, in banks.
    // (Two rows, as an engraver hatches a great fall: long strokes, and short ones between them.)
    const fall = (k: number) => mtn.drop[Math.floor((k / 480) * mtn.drop.length)] ?? 80;
    hachures(land[0], true, (k) => 7 + Math.min(22, fall(k) / 9), 11 * u / scale);
    hachures(land[0], true, (k) => 3 + Math.min(8, fall(k) / 25), 11 * u / scale);
    if (spurLine.length > 1) {
      for (const side of [-1, 1]) {
        const edgeLine = spurLine.map(([x, z], k): Pt => {
          const [ax, az] = spurLine[Math.max(0, k - 1)], [bx, bz] = spurLine[Math.min(spurLine.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1;
          return [x - ((bz - az) / l) * side * mtn.spur.width * 0.43, z + ((bx - ax) / l) * side * mtn.spur.width * 0.43];
        });
        hachures(edgeLine, false, () => 5, 10 * u / scale);
      }
    }
    ctx.lineWidth = Math.max(1, 1.6 * u);
    for (let k = 0; k < 60; k++) {
      const x = rng.range(x0, x1), z = rng.range(z0, z1), d = outside(x, z);
      if (d < 18 || d > 1e8) continue;
      // A bank of cloud: a row of scallops along a line, open below.
      const r = rng.range(2, 4.5), n = rng.int(3, 6);
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const cx = x + (i - n / 2) * r * 1.5; ctx.moveTo(X(cx - r), Z(z)); ctx.arc(X(cx), Z(z), r * scale, Math.PI, 0); }
      ctx.stroke();
    }
  }
  if (vale) {
    // Down from the valley's sides: hachures, the crags.
    const end = vale.mouth + 6;
    for (const side of ['w', 'e'] as const) {
      const line: Pt[] = [];
      for (let z = g.z0 - 2; z <= end; z += 1.5) line.push([edgeAt(vale, side, z), z]);
      hachures(line, false, () => 2.6, 9 * u / scale);
    }
  }

  // ---- the land itself: paper, with its edge in a heavy line
  ctx.fillStyle = PAPER;
  for (const poly of land) { path(poly); ctx.fill(); }
  ctx.lineWidth = Math.max(2, 4.2 * u);
  ctx.strokeStyle = INK;
  if (vale) {
    const end = vale.mouth + 6;
    for (const side of ['w', 'e'] as const) {
      const line: Pt[] = [];
      for (let z = g.z0 - 2; z <= end; z += 1.5) line.push([edgeAt(vale, side, z), z]);
      path(wob(line, 0.35, false), false);
      ctx.stroke();
    }
  } else {
    for (const poly of land) { path(wob(poly, 0.35)); ctx.stroke(); }
  }
  if (mtn && spurLine.length > 1) {
    // The ridge: paper over the hachures, its two edges in the heavy line.
    ctx.strokeStyle = PAPER; ctx.lineWidth = mtn.spur.width * 0.86 * scale;
    path(spurLine, false); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, 3.4 * u);
    for (const side of [-1, 1]) {
      const edgeLine = spurLine.map(([x, z], k): Pt => {
        const [ax, az] = spurLine[Math.max(0, k - 1)], [bx, bz] = spurLine[Math.min(spurLine.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1;
        return [x - ((bz - az) / l) * side * mtn.spur.width * 0.43, z + ((bx - ax) / l) * side * mtn.spur.width * 0.43];
      });
      path(wob(edgeLine, 0.3, false), false); ctx.stroke();
    }
  }
  if (isle) {
    // The cove: water inside it, with its mouth to the sea.
    const c = isle.cove;
    ctx.fillStyle = PAPER;
    ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), c.r * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, 3.4 * u);
    ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), c.r * scale, c.out + 0.5, c.out - 0.5 + Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = WATER; ctx.lineWidth = Math.max(1, 1.4 * u);
    for (const k of [0.55, 0.8]) { ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), c.r * k * scale, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = INK;
  }
  // (In a town: not on what the town has made, its blocks, streets, square, fields, harbour and river.)
  const inPoly = (pts: [number, number][], x: number, z: number) => { let inside = false; for (let a = 0, c = pts.length - 1; a < pts.length; c = a++) { const [xa, za] = pts[a], [xc, zc] = pts[c]; if ((za > z) !== (zc > z) && x < ((xc - xa) * (z - za)) / (zc - za) + xa) inside = !inside; } return inside; };
  const inTownWork = (x: number, z: number) => !!town && (town.blocks.some((b) => outsideBlock(b, x, z) < 3) || outsideRect(town.square, x, z) < 3 || outsideRect(town.level, x, z) < 3
    || town.streets.some((s0) => nearLine(s0.line, x, z).off < s0.width / 2 + 2) || town.fields.some((f) => inPoly(f.corners, x, z)) || inHarbour(town, x, z) || (!!town.river && riverAt(town, x, z).off < riverAt(town, x, z).half + 3));
  // Rough ground on the land: a scatter of little ticks, as a hand marks grass.
  ctx.lineWidth = Math.max(1, 1.2 * u);
  for (let k = 0; k < 900; k++) {
    const x = rng.range(x0, x1), z = rng.range(z0, z1);
    if (outside(x, z) > 0 || house.some((p) => x > p.x0 - 3 && x < p.x1 + 3 && z > p.z0 - 3 && z < p.z1 + 3)) continue;
    if (town && (inTownWork(x, z))) continue;
    const s = 5 * u;
    ctx.beginPath();
    ctx.moveTo(X(x) - s, Z(z)); ctx.lineTo(X(x) - s * 0.4, Z(z) - s * 1.2);
    ctx.moveTo(X(x), Z(z)); ctx.lineTo(X(x), Z(z) - s * 1.6);
    ctx.moveTo(X(x) + s, Z(z)); ctx.lineTo(X(x) + s * 0.4, Z(z) - s * 1.2);
    ctx.stroke();
  }

  // ---- water on the land
  for (const st of site.streams ?? []) {
    if (st.course.length < 2) continue;
    const line = wob(st.course.map(([x, z]): Pt => [x, z]), 0.2, false, 1.5);
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(3 * u, st.width * scale + 3 * u);
    path(line, false); ctx.stroke();
    ctx.strokeStyle = PAPER; ctx.lineWidth = Math.max(1.2 * u, st.width * scale);
    path(line, false); ctx.stroke();
  }
  for (const f of site.features ?? []) {
    if (f.kind !== 'pond') continue;
    const shore = Array.from({ length: 48 }, (_, k): Pt => { const a = (k / 48) * Math.PI * 2, r = shoreOf(f, Math.cos(a), Math.sin(a)) * 0.75; return [f.x + Math.cos(a) * r, f.z + Math.sin(a) * r]; });
    ctx.fillStyle = PAPER; path(shore); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, 3 * u); path(wob(shore, 0.2)); ctx.stroke();
    // Ripples: short level strokes across the water.
    ctx.strokeStyle = WATER; ctx.lineWidth = Math.max(1, 1.3 * u);
    const r = shoreOf(f, 1, 0) * 0.75;
    for (let k = 0; k < 14; k++) {
      const x = f.x + rng.range(-r, r) * 0.7, z = f.z + rng.range(-r, r) * 0.6;
      ctx.beginPath(); ctx.moveTo(X(x - 1.2), Z(z)); ctx.quadraticCurveTo(X(x), Z(z) - 3 * u, X(x + 1.2), Z(z)); ctx.stroke();
    }
    if (f.isle) { ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, 2.4 * u); ctx.beginPath(); ctx.arc(X(f.isle.x), Z(f.isle.z), f.isle.r * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  // ---- ways: the track as a pair of lines, paths dotted
  const track = site.track ?? [];
  if (track.length > 1) {
    for (const side of [-1, 1]) {
      const line = track.map(([x, z], k): Pt => {
        const [ax, az] = track[Math.max(0, k - 1)], [bx, bz] = track[Math.min(track.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1;
        return [x - ((bz - az) / l) * side * 1.3, z + ((bx - ax) / l) * side * 1.3];
      });
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.6 * u);
      path(wob(line, 0.12, false, 2), false); ctx.stroke();
    }
  }
  const dotted = (pts: Pt[]) => {
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.4, 2.4 * u); ctx.setLineDash([2 * u, 9 * u]);
    path(pts, false); ctx.stroke(); ctx.setLineDash([]);
  };
  for (const f of site.paths ?? []) dotted(f.points.map(([x, z]): Pt => [x, z]));
  if (isle?.way) dotted(isle.way.map(([x, z]): Pt => [x, z]));
  if (mtn?.way) dotted(mtn.way.map(([x, z]): Pt => [x, z]));
  if (mtn?.climb) dotted(mtn.climb.map(([x, z]): Pt => [x, z]));

  // ---- built things: solid, as shut buildings are drawn
  ctx.fillStyle = INK;
  const turned = (x: number, z: number, turn: number, w: number, d: number) => { ctx.save(); ctx.translate(X(x), Z(z)); ctx.rotate(turn); ctx.fillRect((-d / 2) * scale, (-w / 2) * scale, d * scale, w * scale); ctx.restore(); };
  for (const b of site.buildings ?? []) {
    const turn = b.faces === 'w' ? 1 : -1;
    for (const r of footprintOf(b)) {
      const xs = [b.x - (turn * b.d) / 2 + turn * r.v0, b.x - (turn * b.d) / 2 + turn * r.v1], zs = [b.z + turn * r.u0, b.z + turn * r.u1];
      ctx.fillRect(X(Math.min(...xs)), Z(Math.min(...zs)), Math.abs(xs[1] - xs[0]) * scale, Math.abs(zs[1] - zs[0]) * scale);
    }
  }
  for (const t of site.towers ?? []) ctx.fillRect(X(t.x - t.half - 0.9), Z(t.z - t.half - 0.9), (t.half + 0.9) * 2 * scale, (t.half + 0.9) * 2 * scale);
  if (isle) {
    for (const h of isle.cottages) turned(h.x, h.z, h.faces, h.w, h.d);
    if (isle.castle) turned(isle.castle.x, isle.castle.z, isle.castle.facing, 28, 22);
    if (isle.chapel) turned(isle.chapel.x, isle.chapel.z, isle.chapel.facing, 8, 18);
    if (isle.mansion) {
      const b = isle.mansion.building, turn = b.faces === 'w' ? 1 : -1;
      for (const r of footprintOf(b)) {
        const xs = [b.x - (turn * b.d) / 2 + turn * r.v0, b.x - (turn * b.d) / 2 + turn * r.v1], zs = [b.z + turn * r.u0, b.z + turn * r.u1];
        ctx.fillRect(X(Math.min(...xs)), Z(Math.min(...zs)), Math.abs(xs[1] - xs[0]) * scale, Math.abs(zs[1] - zs[0]) * scale);
      }
    }
    if (isle.lighthouse) { ctx.beginPath(); ctx.arc(X(isle.lighthouse.x), Z(isle.lighthouse.z), isle.lighthouse.r * scale, 0, Math.PI * 2); ctx.fill(); }
    // The jetty: a pair of lines out into the water.
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, isle.jetty.width * scale);
    ctx.beginPath(); ctx.moveTo(X(isle.jetty.from[0]), Z(isle.jetty.from[1])); ctx.lineTo(X(isle.jetty.to[0]), Z(isle.jetty.to[1])); ctx.stroke();
  }
  if (town) {
    const poly = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], k) => (k ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)))); ctx.closePath(); };
    /** Parallel strokes across a shape, `gap` pixels apart, at an angle; dashed for rows of plants, if `dash` is given. */
    const hatch = (pts: [number, number][], gap: number, angle: number, width: number, colour = INK, dash: number[] = []) => {
      ctx.save(); poly(pts); ctx.clip();
      const xs = pts.map((p0) => X(p0[0])), zs = pts.map((p0) => Z(p0[1])), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 2;
      const ax = Math.cos(angle), az = Math.sin(angle);
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      for (let o = -R; o <= R; o += gap) { ctx.moveTo(cx - az * o - ax * R, cz + ax * o - az * R); ctx.lineTo(cx - az * o + ax * R, cz + ax * o + az * R); }
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    };
    const dots = (pts: [number, number][], gap: number, r: number, colour = INK) => {
      ctx.save(); poly(pts); ctx.clip(); ctx.fillStyle = colour;
      const xs = pts.map((p0) => p0[0]), zs = pts.map((p0) => p0[1]), step = gap / scale;
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) for (let x = Math.min(...xs) + ((Math.round(z / step) % 2) * step) / 2; x <= Math.max(...xs); x += step) { ctx.beginPath(); ctx.arc(X(x), Z(z), r, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    const band = (line: [number, number, number][] | [number, number][], half: number): [number, number][] => {
      const left: [number, number][] = [], right: [number, number][] = [];
      line.forEach(([x, z], k) => { const [ax, az] = line[Math.max(0, k - 1)], [bx, bz] = line[Math.min(line.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l, nz = (bx - ax) / l; left.push([x + nx * half, z + nz * half]); right.push([x - nx * half, z - nz * half]); });
      return [...left, ...right.reverse()];
    };
    // (What is on the land is kept within the land's edge, and the map's: fields reach beyond the part of the country drawn.)
    ctx.save(); path(land[0]); ctx.clip();
    // Fields: each hatched as it is grown, along its length; grain in close lines, roots and vines in dashed rows, an orchard in dots,
    // pasture and fallow left to the ticks of grass.
    for (const f of town.fields) {
      const c = f.corners, angle = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]), ink = 'rgba(29,26,23,0.5)';
      if (f.crop === 'wheat' || f.crop === 'barley' || f.crop === 'oats') hatch(c, 6 * u, angle, Math.max(0.8, 0.9 * u), ink);
      else if (f.crop === 'roots') hatch(c, 10 * u, angle, Math.max(0.8, 1.1 * u), ink, [6 * u, 4 * u]);
      else if (f.crop === 'vines') hatch(c, 9 * u, angle + Math.PI / 2, Math.max(0.8, 1 * u), ink, [2 * u, 3 * u]);
      else if (f.crop === 'orchard') dots(c, 14 * u, 2.4 * u, ink);
      ctx.strokeStyle = 'rgba(29,26,23,0.35)'; ctx.lineWidth = Math.max(0.8, 0.8 * u); poly(c); ctx.stroke();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.2 * u);
    for (const w of town.walls) { path(w.line.map(([x, z]): Pt => [x, z]), false); ctx.stroke(); }
    // The streets: paper between their edges, stippled as they are laid (setts in close dots, gravel finer, beaten earth sparse
    // and faint; flags plain), their edges inked.
    for (const s0 of town.streets) {
      if (s0.kind === 'path') { ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.1 * u); ctx.setLineDash([5 * u, 4 * u]); path(s0.line.map(([x, z]): Pt => [x, z]), false); ctx.stroke(); ctx.setLineDash([]); continue; }
      const shape = band(s0.line, s0.width / 2), surf = s0.surface ?? (s0.kind === 'track' ? 'dirt' : 'setts');
      ctx.fillStyle = PAPER; poly(shape); ctx.fill();
      if (surf === 'setts') dots(shape, 5 * u, 0.9 * u, 'rgba(29,26,23,0.45)');
      else if (surf === 'gravel') dots(shape, 3.5 * u, 0.6 * u, 'rgba(29,26,23,0.35)');
      else if (surf === 'dirt') dots(shape, 9 * u, 0.8 * u, 'rgba(90,60,30,0.4)');
    }
    for (const s0 of town.streets) {
      if (s0.kind === 'path') continue;
      for (const side of [-1, 1]) {
        const line = s0.line.map(([x, z], k): Pt => {
          const [ax, az] = s0.line[Math.max(0, k - 1)], [bx, bz] = s0.line[Math.min(s0.line.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1;
          return [x - ((bz - az) / l) * side * s0.width / 2, z + ((bx - ax) / l) * side * s0.width / 2];
        });
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, (s0.kind === 'track' ? 1.1 : 1.5) * u);
        path(line, false); ctx.stroke();
      }
    }
    // The square: flagged, a fine grid; its stalls, its fountain; the stair up to the house's terrace in steps.
    {
      const sq = town.square, c: [number, number][] = [[sq.x0, sq.z0], [sq.x1, sq.z0], [sq.x1, sq.z1], [sq.x0, sq.z1]];
      ctx.fillStyle = PAPER; poly(c); ctx.fill();
      hatch(c, 9 * u, 0, Math.max(0.6, 0.6 * u), 'rgba(29,26,23,0.25)'); hatch(c, 9 * u, Math.PI / 2, Math.max(0.6, 0.6 * u), 'rgba(29,26,23,0.25)');
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.8 * u); poly(c); ctx.stroke();
      ctx.fillStyle = INK;
      for (const st of town.stalls) turned(st.x, st.z, st.turn + Math.PI / 2, st.w, st.d);
      const s1 = town.stair;
      ctx.lineWidth = Math.max(0.8, 1 * u);
      for (let z = s1.z0; z <= s1.z1; z += 0.6) { ctx.beginPath(); ctx.moveTo(X(s1.x0), Z(z)); ctx.lineTo(X(s1.x1), Z(z)); ctx.stroke(); }
      ctx.strokeRect(X(s1.x0), Z(s1.z0), (s1.x1 - s1.x0) * scale, (s1.z1 - s1.z0) * scale);
    }
    // The river: paper between its banks, with lines of its flow; walls in the town drawn heavy and double, banks of earth light; its
    // bridges across it, stone with its parapets, timber with its rails.
    if (town.river) {
      const rv = town.river, line = rv.line.map(([x, z]): [number, number] => [x, z]);
      // (Its two banks, each point at the river's own half breadth there.)
      const L: [number, number][] = [], R: [number, number][] = [];
      line.forEach(([x, z], k) => { const [ax, az] = line[Math.max(0, k - 1)], [bx, bz] = line[Math.min(line.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l, nz = (bx - ax) / l, h = rv.width[k] / 2; L.push([x + nx * h, z + nz * h]); R.push([x - nx * h, z - nz * h]); });
      ctx.fillStyle = PAPER; poly([...L, ...[...R].reverse()]); ctx.fill();
      ctx.strokeStyle = WATER; ctx.lineWidth = Math.max(0.8, 1 * u);
      for (const f of [-0.45, -0.15, 0.15, 0.45]) {
        const flow = line.map(([x, z], k): Pt => { const [ax, az] = line[Math.max(0, k - 1)], [bx, bz] = line[Math.min(line.length - 1, k + 1)], l = Math.hypot(bx - ax, bz - az) || 1; return [x - ((bz - az) / l) * f * rv.width[k], z + ((bx - ax) / l) * f * rv.width[k]]; });
        ctx.setLineDash([14 * u, 9 * u]); path(wob(flow, 0.3, false, 3), false); ctx.stroke();
      }
      ctx.setLineDash([]);
      // (Each bank in stretches, walled or of earth, each stretch from one point to the next sharing its ends with the next stretch.)
      for (const bank of [L, R]) for (let k = 0; k + 1 < line.length;) {
        let e = k + 1;
        while (e + 1 < line.length && rv.walled[e] === rv.walled[k]) e++;
        const piece = bank.slice(k, e + 1) as Pt[];
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, (rv.walled[k] ? 2.4 : 1.4) * u);
        path(rv.walled[k] ? piece : wob(piece, 0.4, false, 2), false); ctx.stroke();
        k = e;
      }
      // Weirs: a line across where the water steps down.
      ctx.lineWidth = Math.max(1, 1.6 * u);
      for (let k = 0; k + 1 < line.length; k++) if (rv.line[k][2] - rv.line[k + 1][2] > 0.5) { ctx.beginPath(); ctx.moveTo(X(L[k + 1][0]), Z(L[k + 1][1])); ctx.lineTo(X(R[k + 1][0]), Z(R[k + 1][1])); ctx.stroke(); }
      for (const b of rv.bridges) {
        const dx = Math.cos(b.heading), dz = Math.sin(b.heading), nx = -dz, nz = dx, hs = b.span / 2 + 0.6, hw = b.width / 2;
        const deck: [number, number][] = [[b.x - dx * hs + nx * hw, b.z - dz * hs + nz * hw], [b.x + dx * hs + nx * hw, b.z + dz * hs + nz * hw], [b.x + dx * hs - nx * hw, b.z + dz * hs - nz * hw], [b.x - dx * hs - nx * hw, b.z - dz * hs - nz * hw]];
        ctx.fillStyle = PAPER; poly(deck); ctx.fill();
        if (b.kind === 'timber') hatch(deck, 3 * u, b.heading + Math.PI / 2, Math.max(0.6, 0.7 * u), 'rgba(29,26,23,0.5)');
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, (b.kind === 'stone' ? 3 : 1.4) * u);
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(X(b.x - dx * hs + nx * hw * sd), Z(b.z - dz * hs + nz * hw * sd)); ctx.lineTo(X(b.x + dx * hs + nx * hw * sd), Z(b.z + dz * hs + nz * hw * sd)); ctx.stroke(); }
      }
    }
    ctx.restore();
    // The harbour's water: short ripples in rows; and the boats in it, and drawn up on the shore.
    if (town.harbour) {
      ctx.save(); poly(town.harbour); ctx.clip();
      ctx.strokeStyle = WATER; ctx.lineWidth = Math.max(0.8, 1 * u);
      const xs = town.harbour.map((p0) => p0[0]), zs = town.harbour.map((p0) => p0[1]);
      for (let z = Math.min(...zs) + 3; z < Math.max(...zs); z += 14 / scale * u) for (let x = Math.min(...xs) + (valueNoise2(z, 3, seed) * 20) / scale; x < Math.max(...xs); x += (34 * u) / scale) {
        const l = (10 + 8 * valueNoise2(x * 0.2, z * 0.2, seed + 5)) * u;
        ctx.beginPath(); ctx.moveTo(X(x), Z(z)); ctx.quadraticCurveTo(X(x) + l / 2, Z(z) - 3 * u, X(x) + l, Z(z)); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = INK;
    for (const bt of town.boats) {
      const hx = Math.cos(bt.heading) * bt.length / 2, hz = Math.sin(bt.heading) * bt.length / 2, w = bt.length * (bt.masts ? 0.14 : 0.2);
      ctx.beginPath(); ctx.moveTo(X(bt.x + hx), Z(bt.z + hz));
      ctx.quadraticCurveTo(X(bt.x - hz * (w / (bt.length / 2))), Z(bt.z + hx * (w / (bt.length / 2))), X(bt.x - hx), Z(bt.z - hz));
      ctx.quadraticCurveTo(X(bt.x + hz * (w / (bt.length / 2))), Z(bt.z - hx * (w / (bt.length / 2))), X(bt.x + hx), Z(bt.z + hz));
      ctx.fill();
    }
    // The buildings: classical ones close-hatched, timber and wooden ones hatched the other way and more openly, each outlined; the
    // storehouses and the shacks solid.
    for (const b of town.buildings) for (const o of outlineOf(b)) {
      ctx.fillStyle = PAPER; poly(o); ctx.fill();
      if (b.style === 'imperial') hatch(o, 2.6 * u, Math.PI / 4, Math.max(0.7, 0.9 * u));
      else hatch(o, 3.6 * u, -Math.PI / 4, Math.max(0.6, 0.8 * u));
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.4 * u); poly(o); ctx.stroke();
    }
    ctx.fillStyle = INK;
    for (const s0 of town.storehouses) turned(s0.x, s0.z, s0.turn, s0.w, s0.d);
    for (const s0 of town.shacks) turned(s0.x, s0.z, s0.turn, s0.w, s0.d);
    // The quay and the moles as broad ink; the light and the fountain as rings; the outlook; the hall's portal.
    ctx.strokeStyle = INK; ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(2, 1.4 * scale);
    const mouth = town.river ? town.river.line[town.river.line.length - 1][0] : null, mh = town.river ? town.river.width[town.river.width.length - 1] / 2 : 0;
    for (const [a0, a1] of mouth !== null ? [[town.quay.x0, mouth - mh], [mouth + mh, town.quay.x1]] : [[town.quay.x0, town.quay.x1]]) { ctx.beginPath(); ctx.moveTo(X(a0), Z(town.quay.z)); ctx.lineTo(X(a1), Z(town.quay.z)); ctx.stroke(); }
    for (const w of town.wharves) { path(w.line.map(([x, z]): Pt => [x, z]), false); ctx.stroke(); }
    for (const m of town.moles) { ctx.lineWidth = Math.max(2, m.width * scale); path(m.line.map(([x, z]): Pt => [x, z]), false); ctx.stroke(); }
    if (town.light) { ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(X(town.light.x), Z(town.light.z), town.light.r * scale, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = Math.max(1.5, 2 * u); ctx.stroke(); }
    if (town.fountain) { ctx.fillStyle = PAPER; ctx.lineWidth = Math.max(1, 1.6 * u); ctx.beginPath(); ctx.arc(X(town.fountain.x), Z(town.fountain.z), town.fountain.r * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (town.outlook) { ctx.lineWidth = Math.max(1.5, 2 * u); ctx.beginPath(); ctx.arc(X(town.outlook.x), Z(town.outlook.z), 6 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(X(town.outlook.x), Z(town.outlook.z), 2.2 * scale, 0, Math.PI * 2); ctx.fill(); }
    if (town.hall) { const [hx, hz] = town.hall.stair[0], r = 7 * u; ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(X(hx), Z(hz), r, Math.PI, 0); ctx.lineTo(X(hx) + r, Z(hz) + r * 0.6); ctx.lineTo(X(hx) - r, Z(hz) + r * 0.6); ctx.closePath(); ctx.fill(); }
    // Names, in the hand of the title, small: the square, the harbour, the river, the outlook, the hall.
    const label = (text: string, x: number, z: number, size = 22, angle = 0) => {
      ctx.save(); ctx.translate(X(x), Z(z)); ctx.rotate(angle); ctx.font = `italic ${size * u}px Georgia, 'Times New Roman', serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 5 * u; ctx.strokeStyle = PAPER; ctx.strokeText(text, 0, 0); ctx.fillStyle = INK; ctx.fillText(text, 0, 0); ctx.restore();
    };
    label('Market Square', (town.square.x0 + town.square.x1) / 2, town.square.z1 - 4);
    if (town.harbour) { const xs = town.harbour.map((p0) => p0[0]), zs = town.harbour.map((p0) => p0[1]); label('Harbour', (Math.min(...xs) + Math.max(...xs)) / 2, (town.quay.z + Math.max(...zs)) / 2, 28); }
    if (town.river) {
      // (Where it runs between the town's top and the map's.)
      const top = Math.min(...town.blocks.map((b) => b.z0)), rl = town.river.line, mid = (top + z0) / 2 + 20;
      const k = Math.min(rl.length - 3, Math.max(2, rl.reduce((m, p0, i) => (Math.abs(p0[1] - mid) < Math.abs(rl[m][1] - mid) ? i : m), 0))), [ax, az] = rl[k - 2], [bx, bz] = rl[k + 2];
      let angle = Math.atan2(Z(bz) - Z(az), X(bx) - X(ax)); if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
      label('the River', rl[k][0] + 14, rl[k][1], 22, angle);
    }
    if (town.outlook) label('Outlook', town.outlook.x, town.outlook.z - 12, 20);
    if (town.hall) label('the Hall', town.hall.stair[0][0], town.hall.stair[0][1] - 10, 20);
  }
  if (mtn) {
    // Summits as hachured rings; the cairn on the highest as a small triangle; the shelter solid.
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.3 * u);
    for (const q of mtn.peaks) for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, r0 = q.r * 0.18, r1 = q.r * 0.42;
      ctx.beginPath(); ctx.moveTo(X(q.x + Math.cos(a) * r0), Z(q.z + Math.sin(a) * r0)); ctx.lineTo(X(q.x + Math.cos(a) * r1), Z(q.z + Math.sin(a) * r1)); ctx.stroke();
    }
    if (mtn.cairn) { const c = mtn.cairn, r = 9 * u; ctx.beginPath(); ctx.moveTo(X(c.x), Z(c.z) - r); ctx.lineTo(X(c.x) + r * 0.9, Z(c.z) + r * 0.6); ctx.lineTo(X(c.x) - r * 0.9, Z(c.z) + r * 0.6); ctx.closePath(); ctx.fill(); }
    if (mtn.shelter) turned(mtn.shelter.x, mtn.shelter.z, mtn.shelter.facing, 3.6, 3);
  }

  // ---- the house: its walls solid, its rooms paper, its courts open to the sky lightly hatched
  ctx.fillStyle = INK;
  for (const p of house) ctx.fillRect(X(p.x0 - T), Z(p.z0 - T), (p.x1 - p.x0 + 2 * T) * scale, (p.z1 - p.z0 + 2 * T) * scale);
  for (const p of house) {
    ctx.fillStyle = p.roof === 'cave' ? '#d9d0bd' : PAPER;
    ctx.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * scale, (p.z1 - p.z0) * scale);
    if (p.roof === 'sky') {
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 0.9 * u);
      ctx.save(); ctx.beginPath(); ctx.rect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * scale, (p.z1 - p.z0) * scale); ctx.clip();
      for (let d = -(p.z1 - p.z0); d < p.x1 - p.x0; d += 1.4) { ctx.beginPath(); ctx.moveTo(X(p.x0 + d), Z(p.z1)); ctx.lineTo(X(p.x0 + d + (p.z1 - p.z0)), Z(p.z0)); ctx.stroke(); }
      ctx.restore();
    }
  }
  // (Doors between rooms as gaps in the walls, so the house reads as a house and not a block.)
  ctx.fillStyle = PAPER;
  for (const w of site.ways) {
    if (w.kind === 'window' || w.kind === 'stair' || site.places[w.a].level || site.places[w.b].level) continue;
    const a = site.places[w.a], alongX = w.side === 'n' || w.side === 's', wall = w.side === 'n' ? a.z0 - T : w.side === 's' ? a.z1 : w.side === 'e' ? a.x1 : a.x0 - T;
    if (alongX) ctx.fillRect(X(w.at - w.halfWidth), Z(wall), w.halfWidth * 2 * scale, T * scale);
    else ctx.fillRect(X(wall), Z(w.at - w.halfWidth), T * scale, w.halfWidth * 2 * scale);
  }

  // ---- heading, scale and the north point
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic ${44 * u}px Georgia, 'Times New Roman', serif`;
  const name = isle ? 'The island' : mtn ? 'The mountain top' : town ? 'The town' : 'The valley';
  ctx.fillText(name, W / 2, 80 * u);
  ctx.font = `${24 * u}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(site.title.replace(/\.$/, ''), W / 2, 118 * u, W - 2 * edge);
  // A scale of so many metres, a round number near a fifth of the width.
  const want = (x1 - x0) / 5, step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => s >= want * 0.6) ?? 500;
  const sx = edge + 20 * u, sy = H - 60 * u;
  ctx.lineWidth = Math.max(1.5, 2.5 * u);
  ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + step * scale, sy); ctx.moveTo(sx, sy - 8 * u); ctx.lineTo(sx, sy + 8 * u); ctx.moveTo(sx + step * scale, sy - 8 * u); ctx.lineTo(sx + step * scale, sy + 8 * u); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = `italic ${22 * u}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(`${step} metres`, sx + step * scale + 14 * u, sy + 8 * u);
  const nx = W - edge - 40 * u, ny = H - 70 * u, r = 26 * u;
  ctx.beginPath(); ctx.moveTo(nx, ny - r); ctx.lineTo(nx + r * 0.38, ny + r * 0.6); ctx.lineTo(nx, ny + r * 0.25); ctx.lineTo(nx - r * 0.38, ny + r * 0.6); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = `${24 * u}px Georgia, 'Times New Roman', serif`;
  ctx.fillText('N', nx, ny - r - 10 * u);
  return H;
}
