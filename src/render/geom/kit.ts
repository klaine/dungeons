import { Vector3 } from 'three';
import { Rng } from '../../core/rng';
import { MeshBuilder } from './meshBuilder';
import { layMasonry, MasonryStyle, PatchOptions, Surface } from './masonry';

/**
 * The kit of parts: walls with arched openings, vaults, ribs, boxes and round walls, all built by
 * laying blocks on surfaces. Scenes are assembled from these calls today; the site mesher will call
 * the same functions later.
 *
 * Junction rule: at concave junctions patches overlap (floors run under walls, walls run past
 * corners), and at convex corners patches meet exactly with eased edges. This keeps the shell closed.
 */

export type FieldFn = (p: Vector3, n: Vector3, out: Float32Array) => number;

export interface Opening {
  /** Centre, measured along the face from its start. */
  c: number;
  /** Half width. */
  w: number;
  /** Bottom of the opening. Doors should start below the floor. */
  y0: number;
  /** Height at which the round arch springs. */
  ys: number;
}

export interface Frame {
  a: Vector3;
  dir: Vector3;
  normal: Vector3;
  length: number;
}

export interface Mass {
  min: Vector3;
  max: Vector3;
}

const UP = new Vector3(0, 1, 0);
const BAND = 0.32;
const RAISE = 0.03;
/** Masses stop this far short of visible faces, behind mortar and backing. */
const MASS_INSET = 0.035;

export function planeSurface(origin: Vector3, uDir: Vector3, vDir: Vector3, normal: Vector3): Surface {
  return (u, v, p, n) => {
    p.copy(origin).addScaledVector(uDir, u).addScaledVector(vDir, v);
    n.copy(normal);
  };
}

/** u runs along the axis; v is arc length, starting at `side` and turning towards `up`. */
export function cylinderSurface(centre: Vector3, axis: Vector3, side: Vector3, up: Vector3, radius: number, inward: boolean): Surface {
  return (u, v, p, n) => {
    const t = v / radius;
    const c = Math.cos(t), s = Math.sin(t);
    n.set(side.x * c + up.x * s, side.y * c + up.y * s, side.z * c + up.z * s);
    p.copy(centre).addScaledVector(axis, u).addScaledVector(n, radius);
    if (inward) n.negate();
  };
}

export function openingSdf(o: Opening, u: number, y: number): number {
  const dx = Math.abs(u - o.c);
  if (y >= o.ys) return Math.hypot(dx, y - o.ys) - o.w;
  return Math.max(dx - o.w, o.y0 - y);
}

function outlineLength(o: Opening): number {
  return 2 * (o.ys - o.y0) + Math.PI * o.w;
}

/** Point and outward direction on an opening's outline: up one jamb, round the arch, down the other. */
function outline(o: Opening, t: number, out: { u: number; y: number; ou: number; oy: number }): void {
  const h = o.ys - o.y0;
  const arc = Math.PI * o.w;
  if (t < h) {
    out.u = o.c - o.w; out.y = o.y0 + t; out.ou = -1; out.oy = 0;
  } else if (t < h + arc) {
    const th = Math.PI - (t - h) / o.w;
    out.ou = Math.cos(th); out.oy = Math.sin(th);
    out.u = o.c + o.w * out.ou; out.y = o.ys + o.w * out.oy;
  } else {
    out.u = o.c + o.w; out.y = o.ys - (t - h - arc); out.ou = 1; out.oy = 0;
  }
}

export class Kit {
  readonly meshes = new Map<string, MeshBuilder>();
  /**
   * Where the solid is. Visible geometry is only a skin, so the light bake needs to be told what
   * lies behind it: a vertex that ends up inside or behind solid mass is buried, and takes its
   * light from visible neighbours instead of from whatever its rays happen to reach.
   */
  readonly masses: Mass[] = [];
  field: FieldFn | undefined;
  blocks = 0;
  private counter = 0;

  constructor(readonly seed: string) {}

  mesh(material: string): MeshBuilder {
    let m = this.meshes.get(material);
    if (!m) {
      m = new MeshBuilder();
      this.meshes.set(material, m);
    }
    return m;
  }

  private rng(label: string): Rng {
    return new Rng(`${this.seed}/${label}/${this.counter++}`);
  }

  patch(material: string, surface: Surface, opts: Omit<PatchOptions, 'rng' | 'field'> & { field?: FieldFn }): void {
    this.blocks += layMasonry(this.mesh(material), surface, { field: this.field, ...opts, rng: this.rng(material) });
  }

  mass(min: Vector3, max: Vector3): void {
    if (max.x - min.x > 0.01 && max.y - min.y > 0.01 && max.z - min.z > 0.01) this.masses.push({ min: min.clone(), max: max.clone() });
  }

  /** The solid behind a wall face: everything within `thickness` of it, except the openings. */
  wallMass(f: Frame, thickness: number, y0: number, y1: number, openings: Opening[] = []): void {
    const i = MASS_INSET;
    const add = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.02 || v1 - v0 < 0.02) return;
      const p = f.a.clone().addScaledVector(f.dir, u0).addScaledVector(f.normal, -i);
      const q = f.a.clone().addScaledVector(f.dir, u1).addScaledVector(f.normal, -(thickness - i));
      this.mass(new Vector3(Math.min(p.x, q.x), v0, Math.min(p.z, q.z)), new Vector3(Math.max(p.x, q.x), v1, Math.max(p.z, q.z)));
    };
    // Openings that overlap along the wall form a column, handled bottom to top.
    const sorted = [...openings].sort((a, b) => a.c - a.w - (b.c - b.w));
    const columns: Opening[][] = [];
    for (const op of sorted) {
      const last = columns[columns.length - 1];
      if (last && op.c - op.w < Math.max(...last.map((o) => o.c + o.w))) last.push(op);
      else columns.push([op]);
    }
    let u = 0;
    for (const col of columns) {
      const left = Math.min(...col.map((o) => o.c - o.w)) - i;
      const right = Math.max(...col.map((o) => o.c + o.w)) + i;
      add(u, left, y0, y1);
      let bottom = y0;
      for (const op of [...col].sort((a, b) => a.y0 - b.y0)) {
        add(left, right, bottom, op.y0 - i);
        const top = op.ys + op.w + i;
        add(left, op.c - op.w - i, Math.max(bottom, op.y0 - i), top);
        add(op.c + op.w + i, right, Math.max(bottom, op.y0 - i), top);
        bottom = top;
      }
      add(left, right, bottom, y1);
      u = right;
    }
    add(u, f.length, y0, y1);
  }

  frame(ax: number, az: number, bx: number, bz: number): Frame {
    const a = new Vector3(ax, 0, az);
    const dir = new Vector3(bx - ax, 0, bz - az);
    const length = dir.length();
    dir.multiplyScalar(1 / length);
    // Faces to the left of the direction of travel when seen from above with +z towards the viewer.
    const normal = new Vector3().crossVectors(dir, UP);
    return { a, dir, normal, length };
  }

  /** One face of a wall, from a to b, facing `frame.normal`, with holes left for openings. */
  wallFace(material: string, f: Frame, y0: number, y1: number, style: MasonryStyle, o: {
    openings?: Opening[];
    keep?: (u: number, y: number) => boolean;
    open?: PatchOptions['open'];
    courseKey?: string;
    u0?: number; u1?: number;
  } = {}): void {
    const openings = o.openings ?? [];
    const target = BAND * 0.5;
    const sd = (u: number, y: number) => {
      let d = Infinity;
      for (const op of openings) d = Math.min(d, openingSdf(op, u, y));
      return d;
    };
    this.patch(material, planeSurface(f.a, f.dir, UP, f.normal), {
      u0: o.u0 ?? 0, u1: o.u1 ?? f.length, v0: y0, v1: y1, style,
      courseKey: o.courseKey ?? 'wall',
      open: o.open,
      keep: (bu0, bv0, bu1, bv1) => {
        if (o.keep && !o.keep((bu0 + bu1) / 2, (bv0 + bv1) / 2)) return false;
        if (!openings.length) return true;
        return !(sd(bu0, bv0) < target && sd(bu1, bv0) < target && sd(bu0, bv1) < target && sd(bu1, bv1) < target
          && sd((bu0 + bu1) / 2, (bv0 + bv1) / 2) < target);
      },
      hole: openings.length ? (u, v) => sd(u, v) < -0.005 : undefined,
      clampUV: openings.length ? (uv) => {
        for (let it = 0; it < 3; it++) {
          const d = sd(uv[0], uv[1]);
          if (d >= target - 1e-4) return;
          const e = 0.002;
          let gx = sd(uv[0] + e, uv[1]) - sd(uv[0] - e, uv[1]);
          let gy = sd(uv[0], uv[1] + e) - sd(uv[0], uv[1] - e);
          const gl = Math.hypot(gx, gy);
          if (gl < 1e-9) { gx = 0; gy = 1; } else { gx /= gl; gy /= gl; }
          uv[0] += gx * (target - d);
          uv[1] += gy * (target - d);
        }
      } : undefined,
    });
  }

  /** The dressed stones round an opening: a raised band on one or both faces, and the reveal through the wall. */
  openingTrim(material: string, f: Frame, op: Opening, thickness: number, style: MasonryStyle, bands: 'front' | 'both' | 'back'): void {
    const T = outlineLength(op);
    const key = `trim/${this.counter}`;
    const o = { u: 0, y: 0, ou: 0, oy: 0 };
    const back: Frame = {
      a: f.a.clone().addScaledVector(f.dir, f.length).addScaledVector(f.normal, -thickness),
      dir: f.dir.clone().negate(),
      normal: f.normal.clone().negate(),
      length: f.length,
    };
    const band = (fr: Frame, opn: Opening) => {
      this.patch(material, (u, v, p, n) => {
        outline(opn, u, o);
        p.copy(fr.a).addScaledVector(fr.dir, o.u + o.ou * v).addScaledVector(UP, o.y + o.oy * v);
        n.copy(fr.normal);
      }, { u0: 0, u1: T, v0: 0, v1: BAND, style, singleCourse: true, splitKey: key, open: { v0: true }, raise: RAISE, skirt: 0.02 });
    };
    const mirrored: Opening = { ...op, c: f.length - op.c };
    if (bands === 'front' || bands === 'both') band(f, op);
    if (bands === 'back' || bands === 'both') band(back, mirrored);
    const frontRaise = bands === 'back' ? 0 : RAISE;
    const backRaise = bands === 'front' ? 0 : RAISE;
    this.patch(material, (u, v, p, n) => {
      outline(op, u, o);
      p.copy(f.a).addScaledVector(f.dir, o.u).addScaledVector(UP, o.y).addScaledVector(f.normal, -v);
      n.set(0, 0, 0).addScaledVector(f.dir, -o.ou).addScaledVector(UP, -o.oy);
    }, { u0: 0, u1: T, v0: -frontRaise, v1: thickness + backRaise, style, singleCourse: true, splitKey: key, open: { v0: true, v1: true } });
  }

  /** A flat patch. Edges are jointed unless listed in `open`. */
  plane(material: string, origin: Vector3, uDir: Vector3, vDir: Vector3, normal: Vector3, ulen: number, vlen: number, style: MasonryStyle, o: Partial<PatchOptions> = {}): void {
    this.patch(material, planeSurface(origin, uDir, vDir, normal), { u0: 0, u1: ulen, v0: 0, v1: vlen, style, ...o });
  }

  /** Horizontal patch facing up or down, spanning x0..x1 and z0..z1. */
  slab(material: string, x0: number, z0: number, x1: number, z1: number, y: number, style: MasonryStyle, facing: 1 | -1 = 1, o: Partial<PatchOptions> = {}): void {
    this.plane(material, new Vector3(x0, y, z0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, facing, 0), x1 - x0, z1 - z0, style, o);
  }

  /**
   * An axis-aligned block of masonry with eased arrises. `faces` lists the sides to build:
   * x and X are the low and high x sides, and likewise y, Y, z, Z.
   */
  box(material: string, min: Vector3, max: Vector3, faces: string, style: MasonryStyle, topStyle: MasonryStyle = style, courseKey = 'wall'): void {
    const open = { u0: true, u1: true, v0: true, v1: true };
    const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
    const inset = new Vector3(MASS_INSET, MASS_INSET, MASS_INSET);
    this.mass(min.clone().add(inset), max.clone().sub(inset));
    const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
    const side = (origin: Vector3, uDir: Vector3, normal: Vector3, ulen: number) => {
      this.patch(material, (u, v, p, n) => {
        p.copy(origin).addScaledVector(uDir, u);
        p.y = v;
        n.copy(normal);
      }, { u0: 0, u1: ulen, v0: min.y, v1: max.y, style, open, courseKey });
    };
    if (faces.includes('z')) side(new Vector3(min.x, 0, min.z), X, new Vector3(0, 0, -1), sx);
    if (faces.includes('Z')) side(new Vector3(min.x, 0, max.z), X, new Vector3(0, 0, 1), sx);
    if (faces.includes('x')) side(new Vector3(min.x, 0, min.z), Z, new Vector3(-1, 0, 0), sz);
    if (faces.includes('X')) side(new Vector3(max.x, 0, min.z), Z, new Vector3(1, 0, 0), sz);
    if (faces.includes('Y')) this.plane(material, new Vector3(min.x, max.y, min.z), X, Z, new Vector3(0, 1, 0), sx, sz, topStyle, { open });
    if (faces.includes('y')) this.plane(material, new Vector3(min.x, min.y, min.z), X, Z, new Vector3(0, -1, 0), sx, sz, topStyle, { open });
    void sy;
  }

  /** The inside of a half-round vault. `start` is on the axis at springing height. */
  barrelVault(material: string, start: Vector3, axis: Vector3, length: number, radius: number, style: MasonryStyle): void {
    const side = new Vector3().crossVectors(UP, axis).normalize();
    this.patch(material, cylinderSurface(start, axis, side, UP, radius, true), {
      u0: 0, u1: length, v0: 0, v1: Math.PI * radius, style, courseKey: 'vault',
    });
  }

  /** A half-round arch of rectangular section under a vault: soffit and two cheeks. */
  rib(material: string, centre: Vector3, axis: Vector3, radius: number, width: number, depth: number, style: MasonryStyle): void {
    const side = new Vector3().crossVectors(UP, axis).normalize();
    const start = centre.clone().addScaledVector(axis, -width / 2);
    const inner = radius - depth;
    const key = `rib/${this.counter}`;
    this.patch(material, (u, v, p, n) => {
      // Here u runs round the arch and v across its width, so stones split along the arch.
      const t = u / inner;
      n.set(0, 0, 0).addScaledVector(side, Math.cos(t)).addScaledVector(UP, Math.sin(t));
      p.copy(start).addScaledVector(axis, v).addScaledVector(n, inner);
      n.negate();
    }, { u0: 0, u1: Math.PI * inner, v0: 0, v1: width, style, singleCourse: true, splitKey: key, open: { v0: true, v1: true } });
    for (const sgn of [-1, 1]) {
      const at = centre.clone().addScaledVector(axis, (sgn * width) / 2);
      this.patch(material, (u, v, p, n) => {
        const t = u / inner;
        n.set(0, 0, 0).addScaledVector(side, Math.cos(t)).addScaledVector(UP, Math.sin(t));
        p.copy(at).addScaledVector(n, inner + v);
        n.copy(axis).multiplyScalar(sgn);
      }, { u0: 0, u1: Math.PI * inner, v0: 0, v1: depth, style, singleCourse: true, splitKey: key, open: { v0: true, v1: true } });
    }
  }

  /** A round wall such as a well head. Faces outwards or inwards. */
  roundWall(material: string, cx: number, cz: number, radius: number, y0: number, y1: number, style: MasonryStyle, inward: boolean, o: Partial<PatchOptions> = {}): void {
    this.patch(material, (u, v, p, n) => {
      const t = u / radius;
      n.set(Math.cos(t), 0, Math.sin(t));
      p.set(cx + n.x * radius, v, cz + n.z * radius);
      if (inward) n.negate();
    }, { u0: 0, u1: 2 * Math.PI * radius, v0: y0, v1: y1, style, ...o });
  }

  /** A flat ring facing up, such as the coping of a well. */
  ring(material: string, cx: number, cz: number, r0: number, r1: number, y: number, style: MasonryStyle): void {
    const rm = (r0 + r1) / 2;
    this.patch(material, (u, v, p, n) => {
      const t = u / rm;
      p.set(cx + Math.cos(t) * v, y, cz + Math.sin(t) * v);
      n.set(0, 1, 0);
    }, { u0: 0, u1: 2 * Math.PI * rm, v0: r0, v1: r1, style, singleCourse: true, open: { v0: true, v1: true } });
  }
}
