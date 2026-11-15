import { Vector3 } from 'three';
import { fbm2, Rng } from '../core/rng';
import { Place, Side, Site, SKIES, Way } from '../core/site';
import { buildDoorLeaf } from './doorLeaf';
import { indoorField, outdoorFieldAt } from './fields';
import { Frame, Kit, Opening } from './geom/kit';
import { MasonryStyle } from './geom/masonry';
import { carveRock, smin } from './geom/rock';
import { beam, plank, stoneStyles } from './geom/styles';
import { DoorDesc, SceneDescription, TorchSpec } from './scene';

/**
 * Turns a site document into geometry, using the kit of parts.
 *
 * Each place gets a floor, four wall faces with holes for its ways, and a roof by type. Each way
 * gets dressed stone round its opening, a threshold, and stairs where the floors differ. Solid
 * mass is recorded behind every wall and above every roof.
 */

const STEP = 0.17;
const SIDES: Side[] = ['n', 's', 'e', 'w'];
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

interface Hole extends Opening {
  way: Way;
  /** Centre in world coordinates along the wall. */
  at: number;
}

export function meshSite(site: Site): SceneDescription {
  const kit = new Kit(site.seed);
  const rng = new Rng(site.seed).fork('mesh');
  const T = site.wallThickness;
  const places = site.places;
  const { ashlar, dressed, vaultStone, flag, hallFlag, coping, tint: stoneTint } = stoneStyles(site.setting.stone);
  const sky = SKIES[site.setting.hour];

  // ------------------------------------------------------------------ helpers
  /** The wall face of a place on one side, looking into the place, lengthened by `e` at both ends. */
  const frameOf = (p: Place, side: Side, e: number): Frame => {
    switch (side) {
      case 'n': return kit.frame(p.x0 - e, p.z0, p.x1 + e, p.z0);
      case 's': return kit.frame(p.x1 + e, p.z1, p.x0 - e, p.z1);
      case 'w': return kit.frame(p.x0, p.z1 + e, p.x0, p.z0 - e);
      case 'e': return kit.frame(p.x1, p.z0 - e, p.x1, p.z1 + e);
    }
  };
  /** Converts a world coordinate along a wall into a distance along its frame. */
  const alongFrame = (p: Place, side: Side, at: number, e: number): number => {
    switch (side) {
      case 'n': return at - (p.x0 - e);
      case 's': return p.x1 + e - at;
      case 'w': return p.z1 + e - at;
      case 'e': return at - (p.z0 - e);
    }
  };
  const flip: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const sideOf = (w: Way, p: Place): Side => (w.a === p.id ? w.side : flip[w.side]);

  const shape = (w: Way): { y0: number; ys: number } => {
    const lo = Math.min(places[w.a].floor, places[w.b].floor);
    const hi = Math.max(places[w.a].floor, places[w.b].floor);
    if (w.kind === 'window') return { y0: hi + 1.55, ys: hi + 2.35 };
    return { y0: lo - 0.1, ys: hi + (w.kind === 'arch' ? 1.9 : 2.0) };
  };
  const holesOn = (p: Place, side: Side, e: number): Hole[] =>
    site.ways.filter((w) => (w.a === p.id || w.b === p.id) && sideOf(w, p) === side)
      .map((w) => ({ way: w, at: w.at, c: alongFrame(p, side, w.at, e), w: w.halfWidth, ...shape(w) }));

  const span = (p: Place) => (p.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0);
  const isEndWall = (p: Place, side: Side) => (p.axis === 'x') === (side === 'e' || side === 'w');
  const wallTop = (p: Place, side: Side): number => {
    if (p.roof === 'barrel') return p.floor + p.wall + (isEndWall(p, side) ? span(p) / 2 + 0.3 : 0.12);
    if (p.roof === 'timber') return p.floor + p.wall + 0.1;
    if (p.roof === 'cave') return p.floor + p.wall + 1.3;
    if (p.role === 'approach') return side === 'n' ? site.top : p.floor + p.wall;
    return site.top;
  };

  /** A box given in a wall's own terms: along it, up, and through it away from the place. */
  const wallBox = (f: Frame, u0: number, u1: number, y0: number, y1: number, t0: number, t1: number) => {
    const a = f.a.clone().addScaledVector(f.dir, u0).addScaledVector(f.normal, -t0);
    const b = f.a.clone().addScaledVector(f.dir, u1).addScaledVector(f.normal, -t1);
    return { min: V(Math.min(a.x, b.x), y0, Math.min(a.z, b.z)), max: V(Math.max(a.x, b.x), y1, Math.max(a.z, b.z)) };
  };
  // ------------------------------------------------------------------ torches, decided first so soot can follow them
  const torchesByPlace = new Map<number, TorchSpec[]>();
  const pilasterSlots = new Map<number, { pos: number; side: Side; clear: boolean }[]>();
  for (const p of places) {
    const slots: { pos: number; side: Side; clear: boolean }[] = [];
    if (p.roof === 'barrel') {
      const a0 = p.axis === 'x' ? p.x0 : p.z0;
      const length = p.axis === 'x' ? p.x1 - p.x0 : p.z1 - p.z0;
      const ribs = Math.max(0, Math.round(length / 3.4) - 1);
      const sides: Side[] = p.axis === 'x' ? ['n', 's'] : ['w', 'e'];
      for (let k = 1; k <= ribs; k++) {
        const pos = a0 + (length * k) / (ribs + 1);
        for (const side of sides) {
          const clear = !holesOn(p, side, 0).some((h) => Math.abs(h.at - pos) < h.w + 0.95);
          slots.push({ pos, side, clear });
        }
      }
    }
    pilasterSlots.set(p.id, slots);

    const list: TorchSpec[] = [];
    if (p.roof !== 'sky') {
      const area = (p.x1 - p.x0) * (p.z1 - p.z0);
      // Torches where the site asks for them; a daylit room gets one only if it is large; a dark room, none.
      const want = p.light === 'torch' ? (area < 22 ? 1 : area < 50 ? 2 : 3) : p.light === 'day' && area >= 40 ? 1 : 0;
      // Candidates: the front of each free pilaster, else the middle of each wall that has room.
      const candidates: TorchSpec[] = [];
      const inward: Record<Side, Vector3> = { n: V(0, 0, 1), s: V(0, 0, -1), w: V(1, 0, 0), e: V(-1, 0, 0) };
      const onWall = (side: Side, at: number, off: number): TorchSpec => {
        const out = inward[side];
        const base = side === 'n' ? V(at, 0, p.z0) : side === 's' ? V(at, 0, p.z1) : side === 'w' ? V(p.x0, 0, at) : V(p.x1, 0, at);
        return { position: base.addScaledVector(out, off).setY(p.floor + 2.25), out };
      };
      for (const s of slots) if (s.clear) candidates.push(onWall(s.side, s.pos, 0.5));
      // Plain wall: the middle if it is free, and the quarter points, clear of doors and corners.
      for (const side of SIDES) {
        const lo = side === 'n' || side === 's' ? p.x0 : p.z0;
        const len = side === 'n' || side === 's' ? p.x1 - p.x0 : p.z1 - p.z0;
        const holes = holesOn(p, side, 0);
        for (const frac of [0.5, 0.25, 0.75]) {
          const at = lo + len * frac;
          const clear = !holes.some((h) => Math.abs(h.at - at) < h.w + 0.8) && at - lo > 0.7 && lo + len - at > 0.7;
          const taken = slots.some((s) => s.side === side && Math.abs(s.pos - at) < 0.9);
          if (clear && !taken) candidates.push(onWall(side, at, 0.24));
        }
      }
      // Spread them out: take the candidate farthest from those already chosen.
      while (list.length < want && candidates.length) {
        let best = 0, bestScore = -1;
        candidates.forEach((c, i) => {
          const score = list.length ? Math.min(...list.map((t) => t.position.distanceTo(c.position))) : rng.next();
          if (score > bestScore) { bestScore = score; best = i; }
        });
        list.push(candidates.splice(best, 1)[0]);
      }
    }
    torchesByPlace.set(p.id, list);
  }

  const doors: DoorDesc[] = [];
  const anchors = new Map<number, Vector3>();

  // ------------------------------------------------------------------ places
  const house = places.filter((p) => p.role !== 'approach');
  const houseX0 = Math.min(...house.map((p) => p.x0)) - T / 2;
  const houseX1 = Math.max(...house.map((p) => p.x1)) + T / 2;
  for (const p of places) {
    kit.group = `p${p.id}`;
    const open = p.roof === 'sky';
    kit.field = open ? outdoorFieldAt(p.floor) : indoorField(torchesByPlace.get(p.id)!, p.floor);
    const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const roofY = p.floor + p.wall;

    const cave = p.roof === 'cave';
    if (cave) {
      kit.mass(V(p.x0, p.floor - 1.6, p.z0), V(p.x1, p.floor - 0.7, p.z1));
    } else {
      kit.slab('floor', p.x0 - 0.1, p.z0 - 0.1, p.x1 + 0.1, p.z1 + 0.1, p.floor, open ? flag : hallFlag);
      kit.mass(V(p.x0, p.floor - 1.2, p.z0), V(p.x1, p.floor - 0.035, p.z1));
    }

    // Walls, and the solid behind them.
    for (const side of SIDES) {
      const top = wallTop(p, side);
      if (p.role === 'approach' && side === 'n') {
        // The house front: one face across the whole width of the house, not just the forecourt.
        const f = kit.frame(houseX0 - 2, p.z0, houseX1 + 2, p.z0);
        const openings = holesOn(p, side, 0).map((h) => ({ ...h, c: h.at - (houseX0 - 2) }));
        kit.wallFace('stone', f, p.floor - 0.1, top, ashlar, { openings });
        continue;
      }
      const f = frameOf(p, side, 0.1);
      const mid = f.length / 2;
      const R = span(p) / 2;
      const end = p.roof === 'barrel' && isEndWall(p, side);
      // A cave has masonry only where the builders walled it off to hang a door.
      if (!cave || holesOn(p, side, 0).length) {
        kit.wallFace('stone', f, cave ? p.floor - 0.6 : p.floor - 0.1, top, ashlar, {
          openings: holesOn(p, side, 0.1),
          keep: end ? (u, y) => y < roofY + 0.3 || Math.hypot(u - mid, y - roofY) < R + 0.45 : undefined,
        });
      }
      // Solid behind the wall, one wall's thickness deep; beyond that is another place or the outside.
      const ext = T / 2 + 0.02;
      kit.wallMass(frameOf(p, side, ext), T, p.floor - 1.2, p.roof === 'sky' ? top : site.top, holesOn(p, side, ext));
    }

    // Roof.
    if (cave) {
      // Open air is an uneven dome over a rough oval floor, with a bay reaching each doorway.
      const doors = SIDES.flatMap((side) => holesOn(p, side, 0).map((h) => ({ side, at: h.at, w: h.w })));
      const doorPoint = (d: { side: Side; at: number }) => (d.side === 'n' ? [d.at, p.z0] : d.side === 's' ? [d.at, p.z1] : d.side === 'w' ? [p.x0, d.at] : [p.x1, d.at]);
      const walled = new Set(doors.map((d) => d.side));
      const rx = dx / 2 - 0.35, rz = dz / 2 - 0.35, rMin = Math.min(rx, rz);
      const s1 = rng.range(0, 50), s2 = rng.range(0, 50);
      const shape = (x: number, z: number): { e: number; nearDoor: number } => {
        let e = (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * rMin;
        e += (fbm2(x * 0.5 + s1, z * 0.5 + s2, 3) - 0.5) * 1.5;
        // Keep clear of the sides that have no wall to hide the edge of the rock.
        let limit = Infinity;
        if (!walled.has('n')) limit = Math.min(limit, z - p.z0);
        if (!walled.has('s')) limit = Math.min(limit, p.z1 - z);
        if (!walled.has('w')) limit = Math.min(limit, x - p.x0);
        if (!walled.has('e')) limit = Math.min(limit, p.x1 - x);
        e = Math.min(e, limit - 0.25);
        let nearDoor = Infinity;
        for (const d of doors) {
          const [qx, qz] = doorPoint(d);
          const dd = Math.hypot(x - qx, z - qz);
          nearDoor = Math.min(nearDoor, dd);
          e = Math.max(e, d.w + 0.9 - dd);
        }
        return { e, nearDoor };
      };
      const density = (x: number, y: number, z: number): number => {
        let { e, nearDoor } = shape(x, z);
        // Ledges and hollows a hand's breadth to a pace across, so the walls are not smooth.
        e += (fbm2(x * 1.9 + y * 1.1 + s1, z * 1.9 - y * 0.8 + s2, 3) - 0.5) * 0.5 * Math.min(1, nearDoor / 1.5);
        const settle = Math.min(1, Math.max(0, (nearDoor - 1.3) / 1.6));
        const floorY = p.floor - 0.006 + (fbm2(x * 0.8 + s2, z * 0.8 + s1, 3) - 0.5) * 0.34 * settle;
        const dome = Math.pow(Math.min(1, Math.max(0, e / rMin)), 0.55);
        let ceilY = p.floor + p.wall * (0.5 + 0.5 * dome) + (fbm2(x * 0.65 + s1 + 9, z * 0.65 + s2, 3) - 0.5) * 0.9;
        ceilY = Math.max(ceilY, p.floor + 3.5 - nearDoor * 0.5);
        const air = smin(smin(e, y - floorY, 0.35), ceilY - y, 0.5);
        // Whatever the noise does, the rock must close before it reaches the edge of the space
        // being carved, except towards a masonry wall, which hides the edge.
        let edge = Math.min(p.floor + p.wall + 1.2 - y, y - (p.floor - 0.6));
        if (!walled.has('n')) edge = Math.min(edge, z - p.z0);
        if (!walled.has('s')) edge = Math.min(edge, p.z1 - z);
        if (!walled.has('w')) edge = Math.min(edge, x - p.x0);
        if (!walled.has('e')) edge = Math.min(edge, p.x1 - x);
        return Math.min(air, edge - 0.2);
      };
      const wet = indoorField([], p.floor);
      carveRock(kit.mesh('rock'), density, {
        min: V(p.x0 - 0.14, p.floor - 0.6, p.z0 - 0.14), max: V(p.x1 + 0.14, p.floor + p.wall + 1.2, p.z1 + 0.14),
        cell: 0.28, uvScale: 0.45,
        shade: (q, n, field) => {
          wet(q, n, field);
          // Beds of slightly different stone, tilted; darker where water has stood.
          const bed = fbm2((q.y + q.x * 0.18) * 2.6, q.z * 0.15 + s1, 3);
          const blot = fbm2(q.x * 0.9 + s2, q.z * 0.9 + q.y * 0.7, 3);
          const tone = 0.72 + 0.4 * bed + 0.24 * blot;
          return [0.8 * tone * stoneTint[0], 0.74 * tone * stoneTint[1], 0.65 * tone * stoneTint[2]];
        },
      });
      kit.mass(V(p.x0 - T / 2, p.floor + p.wall + 1.25, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
    } else if (p.roof === 'barrel') {
      const R = span(p) / 2;
      const axis = p.axis === 'x' ? V(1, 0, 0) : V(0, 0, 1);
      const start = p.axis === 'x' ? V(p.x0 - 0.1, roofY, cz) : V(cx, roofY, p.z0 - 0.1);
      const length = (p.axis === 'x' ? dx : dz) + 0.2;
      kit.barrelVault('stone', start, axis, length, R, vaultStone);
      kit.mass(V(p.x0 - T / 2, roofY + R + 0.06, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));

      const slots = pilasterSlots.get(p.id)!;
      for (const pos of new Set(slots.map((s) => s.pos))) {
        kit.rib('stone', p.axis === 'x' ? V(pos, roofY, cz) : V(cx, roofY, pos), axis, R, 0.52, 0.3, dressed);
      }
      for (const s of slots) {
        // In the wall's own terms: along it, and out of the wall into the room (negative depth).
        const f = frameOf(p, s.side, 0);
        const u = alongFrame(p, s.side, s.pos, 0);
        if (s.clear) {
          const b = wallBox(f, u - 0.26, u + 0.26, p.floor - 0.1, roofY - 0.2, 0.05, -0.3);
          kit.box('stone', b.min, b.max, ashlar);
        }
        const c = wallBox(f, u - 0.33, u + 0.33, roofY - 0.2, roofY + 0.02, 0.05, -0.37);
        kit.box('stone', c.min, c.max, coping, coping, 'impost');
      }
    } else if (p.roof === 'timber') {
      const alongX = dx >= dz;
      if (alongX) kit.plane('wood', V(p.x0 - 0.1, roofY, p.z0 - 0.1), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), dx + 0.2, dz + 0.2, plank);
      else kit.plane('wood', V(p.x0 - 0.1, roofY, p.z0 - 0.1), V(0, 0, 1), V(1, 0, 0), V(0, -1, 0), dz + 0.2, dx + 0.2, plank);
      const long = alongX ? dx : dz;
      const count = Math.max(2, Math.round(long / 1.05));
      for (let k = 0; k < count; k++) {
        const at = (alongX ? p.x0 : p.z0) + (long * (k + 0.5)) / count;
        if (alongX) kit.box('wood', V(at - 0.1, roofY - 0.27, p.z0 - 0.1), V(at + 0.1, roofY, p.z1 + 0.1), beam, beam, 'beam');
        else kit.box('wood', V(p.x0 - 0.1, roofY - 0.27, at - 0.1), V(p.x1 + 0.1, roofY, at + 0.1), beam, beam, 'beam');
      }
      kit.mass(V(p.x0 - T / 2, roofY + 0.08, p.z0 - T / 2), V(p.x1 + T / 2, site.top, p.z1 + T / 2));
    } else if (p.role === 'approach') {
      // Low outer walls with a coping and merlons; the house front rises behind.
      for (const side of ['s', 'e', 'w'] as Side[]) {
        const f = frameOf(p, side, 0.1);
        const y = p.floor + p.wall;
        const cap = wallBox(f, 0, f.length, y, y + 0.12, -0.12, 0.6);
        kit.box('stone', cap.min, cap.max, coping, coping);
        for (let u = 0.6; u < f.length - 1.2; u += 1.9) {
          const m = wallBox(f, u, u + 1.0, y + 0.12, y + 1.0, -0.04, 0.5);
          kit.box('stone', m.min, m.max, ashlar, coping);
        }
      }
    }

    // Furnishings by role.
    if (p.role === 'court') {
      const wx = cx + (dx > 6 ? rng.range(-0.8, 0.8) : 0), wz = cz + (dz > 6 ? rng.range(-0.8, 0.8) : 0);
      const y = p.floor;
      kit.roundWall('stone', wx, wz, 0.95, y - 0.1, y + 0.85, { ...ashlar, length: [0.45, 0.6] }, false, { open: { v1: true } });
      kit.roundWall('stone', wx, wz, 0.68, y - 2.5, y + 0.85, { ...ashlar, length: [0.35, 0.5] }, true, { open: { v1: true } });
      kit.ring('stone', wx, wz, 0.68, 0.95, y + 0.85, { ...dressed, length: [0.5, 0.65] });
    }
    if ((p.role === 'goal' || p.role === 'reward') && !cave) {
      // A stone chest against the wall opposite the way in; the goal's is larger and raised.
      const door = site.ways.find((w) => w.kind === 'door' && (w.a === p.id || w.b === p.id));
      const far = door ? flip[sideOf(door, p)] : 'n';
      const f = frameOf(p, far, 0);
      const u = f.length / 2;
      // The grand arrangement needs room in front of it; a small chamber gets the plain one.
      const room = far === 'n' || far === 's' ? dz : dx;
      const big = p.role === 'goal' && room >= 4.6;
      const half = Math.min(big ? 1.1 : 0.7, f.length / 2 - 0.6);
      let y = p.floor;
      if (big) {
        const plinth = wallBox(f, u - half - 0.5, u + half + 0.5, y - 0.02, y + STEP, -0.5, -2.3);
        kit.box('floor', plinth.min, plinth.max, { ...hallFlag, course: [STEP + 0.02, STEP + 0.02], length: [0.8, 1.3] }, hallFlag, 'step');
        y += STEP;
      }
      const near = big ? 0.95 : 0.35, deep = big ? 0.9 : 0.65;
      const body = wallBox(f, u - half, u + half, y, y + (big ? 0.85 : 0.6), -near, -(near + deep));
      kit.box('stone', body.min, body.max, { ...dressed, length: [0.7, 1.1], course: [0.4, 0.45] });
      const lid = wallBox(f, u - half - 0.1, u + half + 0.1, body.max.y, body.max.y + 0.17, -(near - 0.1), -(near + deep + 0.1));
      kit.box('stone', lid.min, lid.max, { ...coping, length: [1.1, 1.3], course: [0.17, 0.17] }, { ...coping, length: [2.4, 2.4], course: [1.2, 1.2] }, 'lid');
      anchors.set(p.id, V((lid.min.x + lid.max.x) / 2, lid.max.y, (lid.min.z + lid.max.z) / 2));
    } else if (site.items.some((it) => it.place === p.id)) {
      // Something is kept here and there is no chest: a pedestal in the middle of the floor.
      kit.box('stone', V(cx - 0.3, p.floor - 0.4, cz - 0.3), V(cx + 0.3, p.floor + 0.14, cz + 0.3), coping, coping, 'base');
      kit.box('stone', V(cx - 0.22, p.floor + 0.14, cz - 0.22), V(cx + 0.22, p.floor + 0.92, cz + 0.22), { ...dressed, length: [0.44, 0.44] }, coping, 'shaft');
      kit.box('stone', V(cx - 0.3, p.floor + 0.92, cz - 0.3), V(cx + 0.3, p.floor + 1.04, cz + 0.3), coping, coping, 'cap');
      anchors.set(p.id, V(cx, p.floor + 1.04, cz));
    }

    // Ways are built once, from the side of their first place.
    for (const w of site.ways) {
      if (w.a !== p.id) continue;
      const q = places[w.b];
      const f = frameOf(p, w.side, 0.1);
      const c = alongFrame(p, w.side, w.at, 0.1);
      const op: Opening = { c, w: w.halfWidth, ...shape(w) };
      kit.openingTrim('stone', f, op, T, dressed, 'both');
      if (w.kind === 'window') {
        const sill = wallBox(f, c - w.halfWidth - 0.22, c + w.halfWidth + 0.22, op.y0 - 0.14, op.y0, -0.07, T + 0.07);
        kit.box('stone', sill.min, sill.max, coping, coping);
        continue;
      }
      const lo = Math.min(p.floor, q.floor), hi = Math.max(p.floor, q.floor);
      const sill = wallBox(f, c - w.halfWidth - 0.1, c + w.halfWidth + 0.1, lo, lo, 0.1, T - 0.1);
      kit.slab('floor', sill.min.x, sill.min.z, sill.max.x, sill.max.z, lo, { ...hallFlag, course: [0.7, 0.8], length: [0.9, 1.3] });
      // Stairs inside the thickness of the wall, rising towards the higher floor.
      const steps = Math.round((hi - lo) / STEP);
      const tread = (T - 0.2) / Math.max(1, steps);
      const stepStyle: MasonryStyle = { ...hallFlag, course: [STEP, STEP], length: [0.8, 1.3] };
      for (let k = 1; k <= steps; k++) {
        const lowIsHere = p.floor <= q.floor;
        const t0 = lowIsHere ? 0.1 + (k - 1) * tread : 0.1;
        const t1 = lowIsHere ? T - 0.1 : T - 0.1 - (k - 1) * tread;
        const b = wallBox(f, c - w.halfWidth - 0.05, c + w.halfWidth + 0.05, lo + STEP * (k - 1), lo + STEP * k, t0, t1);
        kit.box('floor', b.min, b.max, stepStyle, hallFlag, 'step');
      }
      // A door leaf, hung at the higher side so it stands on the top stair and swings away from the steps.
      if (w.door) {
        const highIsHere = p.floor > q.floor;
        const t = highIsHere ? 0.2 : T - 0.2;
        const towardsHigh = highIsHere ? f.normal.clone() : f.normal.clone().negate();
        const lw = w.halfWidth - 0.02;
        const hingeLow = rng.chance(0.5);
        const d = hingeLow ? f.dir.clone() : f.dir.clone().negate();
        const hinge = f.a.clone().addScaledVector(f.dir, hingeLow ? c - lw : c + lw).addScaledVector(f.normal, -t).setY(hi + 0.006);
        const yaw = Math.atan2(-d.z, d.x);
        const faces = Math.sign(Math.sin(yaw) * towardsHigh.x + Math.cos(yaw) * towardsHigh.z) || 1;
        const barred = w.door.barredFrom;
        const block = wallBox(f, c - w.halfWidth, c + w.halfWidth, hi - 0.3, hi + 3.2, t - 0.14, t + 0.14);
        // A door that starts shut is baked shut, so a locked room does not fill with its neighbour's light.
        if (w.door.leaf === 'shut') {
          const slab = wallBox(f, c - w.halfWidth - 0.05, c + w.halfWidth + 0.05, hi - 0.3, hi + 3.2, t - 0.03, t + 0.03);
          kit.mass(slab.min, slab.max);
        }
        doors.push({
          way: site.ways.indexOf(w), hinge, yaw, swing: -faces * 1.62, halfWidth: lw, spring: 2.0, thickness: 0.07,
          leaf: buildDoorLeaf(`${site.seed}/door${site.ways.indexOf(w)}`, lw, 2.0, 0.07),
          blocker: block,
          centre: f.a.clone().addScaledVector(f.dir, c).addScaledVector(f.normal, -t).setY(hi + 1.2),
          barSide: barred === undefined ? 0 : (barred === (highIsHere ? p.id : q.id) ? faces : -faces),
        });
      }
    }
  }

  // ------------------------------------------------------------------ result
  const min = V(Infinity, -3, Infinity), max = V(-Infinity, site.top + 2, -Infinity);
  for (const p of places) {
    min.x = Math.min(min.x, p.x0 - 3); min.z = Math.min(min.z, p.z0 - 3);
    max.x = Math.max(max.x, p.x1 + 3); max.z = Math.max(max.z, p.z1 + 3);
  }
  const approach = places.find((p) => p.role === 'approach') ?? places[site.entrance];
  return {
    meshes: kit.meshes,
    masses: kit.masses,
    torches: [...torchesByPlace.values()].flat(),
    sunDir: V(site.sun[0], site.sun[1], site.sun[2]),
    spawn: { position: V((approach.x0 + approach.x1) / 2, approach.floor + 1.7, approach.z1 - 1.6), yaw: 0 },
    bounds: { min, max },
    blocks: kit.blocks,
    title: site.title,
    sun: { colour: sky.colour, intensity: sky.intensity, sky: { zenith: sky.zenith, horizon: sky.horizon, ground: sky.ground } },
    doors,
    anchors,
  };
}
