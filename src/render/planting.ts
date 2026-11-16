import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder } from './geom/meshBuilder';
import { CardSet } from './scene';

/**
 * Planting: everything that grows, placed as cards. A card is a small flat sheet with leaves or
 * blades painted on it; grass is tufts of three crossed sheets, and the crown of a tree is a
 * cloud of a few hundred leaf cards round its branches. The mesher decides where things grow and
 * writes one transform per card; the renderer draws them all in a handful of calls.
 */

const M = new Matrix4();
const Q = new Quaternion();
const Q2 = new Quaternion();
const E = new Euler();
const P = new Vector3();
const S = new Vector3();

export type Colour = [number, number, number];

export class Planting {
  readonly grass: CardSet = { kind: 'grass', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly flowers: CardSet = { kind: 'flower', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly ferns: CardSet = { kind: 'fern', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly herbs: CardSet = { kind: 'herb', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly reeds: CardSet = { kind: 'reed', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly leaves: CardSet = { kind: 'leaf', shape: 'card', shadow: true, matrices: [], colours: [], centres: [] };
  readonly needles: CardSet = { kind: 'needle', shape: 'card', shadow: true, matrices: [], colours: [], centres: [] };
  /** Whole trees, each painted on one tuft of cards: for hillsides too far off for anything more. */
  readonly firs: CardSet = { kind: 'fir', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly farTrees: CardSet = { kind: 'tree', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };

  get sets(): CardSet[] {
    return [this.grass, this.flowers, this.ferns, this.herbs, this.reeds, this.leaves, this.needles, this.firs, this.farTrees].filter((s) => s.matrices.length > 0);
  }

  /** Adds a card whose place and size have just been composed, with its colour and the point its shading curves about. */
  pushCard(set: CardSet, colour: Colour, cx: number, cy: number, cz: number): void {
    this.push(set, colour, cx, cy, cz);
  }

  /**
   * While this is set, nothing that is planted is kept. It is for leaving a place bare without
   * disturbing what is drawn for it: whatever would have grown there is worked out as before,
   * so everything planted afterwards comes out as it did.
   */
  muted = false;

  private push(set: CardSet, colour: Colour, cx: number, cy: number, cz: number): void {
    if (this.muted) return;
    for (let k = 0; k < 16; k++) set.matrices.push(M.elements[k]);
    set.colours.push(colour[0], colour[1], colour[2]);
    set.centres.push(cx, cy, cz);
  }

  /** A tuft standing on the ground: grass, or flowers on their stems. Lit as the ground is. */
  tuft(set: CardSet, x: number, y: number, z: number, width: number, height: number, yaw: number, colour: Colour): void {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, yaw, 0)), S.set(width, height, width));
    this.push(set, colour, x, y - 1000, z);
  }

  /** A whole tree far off, as one tuft: shaded as a rounded body about a point a third of the way up it. */
  farTree(fir: boolean, x: number, y: number, z: number, width: number, height: number, yaw: number, colour: Colour): void {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, yaw, 0)), S.set(width, height, width));
    this.push(fir ? this.firs : this.farTrees, colour, x, y + height * 0.35, z);
  }

  /**
   * A mass of leaves: cards scattered through an ellipsoid, thicker towards its surface, each
   * facing its own way. They are shaded as parts of one rounded body, about a point low inside it,
   * so a crown is light on top and dark beneath however its cards happen to lie.
   */
  crown(cx: number, cy: number, cz: number, rx: number, ry: number, cards: number, size: number, colour: (rng: Rng) => Colour, rng: Rng): void {
    for (let k = 0; k < cards; k++) {
      // A direction evenly over the sphere, and a distance that favours the outside.
      const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      const d = Math.pow(rng.next(), 0.42);
      const x = cx + Math.cos(a) * s * rx * d, y = cy + u * ry * d, z = cz + Math.sin(a) * s * rx * d;
      const w = size * rng.range(0.75, 1.3);
      M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rng.range(-1.2, 1.2), rng.range(0, Math.PI * 2), rng.range(-0.5, 0.5))), S.set(w, w, w));
      this.push(this.leaves, colour(rng), cx, cy - ry * 0.55, cz);
    }
  }

  /** One card set where it is told: its size, how it is tipped and turned, its colour, and the point its shading curves about. */
  card(set: CardSet, x: number, y: number, z: number, size: number, tipX: number, tipY: number, roll: number, colour: Colour, sx: number, sy: number, sz: number): void {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(tipX, tipY, roll)), S.set(size, size, size));
    this.push(set, colour, sx, sy, sz);
  }

  /** A spray of leaves about a twig: a few cards in a flattened ball, shaded about the point given. */
  spray(cx: number, cy: number, cz: number, rx: number, ry: number, cards: number, size: number, colour: (rng: Rng) => Colour, rng: Rng, sx: number, sy: number, sz: number): void {
    for (let k = 0; k < cards; k++) {
      const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u), d = Math.pow(rng.next(), 0.5);
      // Most sprays are small; one in five is a larger bough that fills the crown behind them.
      const w = size * (k % 5 === 0 ? rng.range(1.5, 2.1) : rng.range(0.75, 1.3));
      // Leaves turn their faces to the sky more than to the side.
      M.compose(P.set(cx + Math.cos(a) * s * rx * d, cy + u * ry * d, cz + Math.sin(a) * s * rx * d), Q.setFromEuler(E.set(-Math.PI / 2 + rng.range(-0.9, 0.9), rng.range(0, Math.PI * 2), rng.range(-0.7, 0.7))), S.set(w, w, w));
      this.push(this.leaves, colour(rng), sx, sy, sz);
    }
  }

  /** A broadleaved tree: a main crown and a few lesser ones about it, so the outline is lumpy. */
  broadleaf(x: number, base: number, z: number, height: number, spread: number, cards: number, colour: (rng: Rng) => Colour, rng: Rng, cardScale = 1): void {
    const top = base + height;
    this.crown(x, top - spread * 0.25, z, spread, spread * 0.78, Math.round(cards * 0.5), spread * 0.62 * cardScale, colour, rng);
    const lobes = 3 + rng.int(0, 2);
    for (let k = 0; k < lobes; k++) {
      const a = rng.range(0, Math.PI * 2), out = spread * rng.range(0.5, 0.85);
      this.crown(x + Math.cos(a) * out, top - spread * rng.range(0.5, 1.0), z + Math.sin(a) * out, spread * 0.6, spread * 0.48, Math.round((cards * 0.5) / lobes), spread * 0.55 * cardScale, colour, rng);
    }
  }

  /**
   * A conifer: tiers of boughs that droop, wide at the foot and closing to a point. Given wood
   * to build with, each bough of a near tree gets the branch that carries it, and a second
   * sheet of needles hanging beneath, so that it is not a flat fan when seen from the side.
   */
  conifer(x: number, base: number, z: number, height: number, radius: number, tiers: number, colour: (rng: Rng) => Colour, rng: Rng, wood?: { mesh: MeshBuilder; bark: Colour; detail: number }): void {
    const skirt = base + height * 0.16;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      const y = skirt + (height - (skirt - base)) * f * 0.94;
      const r = radius * Math.pow(1 - f, 0.8) + 0.25;
      const around = Math.max(3, Math.round(3 + 4 * (1 - f)));
      const turn = rng.range(0, Math.PI * 2);
      for (let k = 0; k < around; k++) {
        const a = turn + (k / around) * Math.PI * 2 + rng.range(-0.25, 0.25);
        // Each bough is a card lying outwards from the trunk and hanging at its tip.
        const droop = 0.42 + 0.3 * (1 - f) + rng.range(-0.1, 0.1);
        Q.setFromEuler(E.set(-Math.PI / 2 + droop, -a + Math.PI / 2, 0, 'YXZ'));
        const len = r * 1.25 * rng.range(0.85, 1.15);
        M.compose(P.set(x + Math.cos(a) * r * 0.5, y - r * 0.2, z + Math.sin(a) * r * 0.5), Q, S.set(len * 0.95, len, len));
        const tint = colour(rng);
        this.push(this.needles, tint, x, y - 1.2 - r, z);
        if (wood && wood.detail > 0.5) {
          // The card runs from the trunk, at its top edge, out and down to the tip of the bough.
          const cx = x + Math.cos(a) * r * 0.5, cy = y - r * 0.2, cz = z + Math.sin(a) * r * 0.5;
          const ux = -Math.cos(a) * Math.cos(droop), uy = Math.sin(droop), uz = -Math.sin(a) * Math.cos(droop);
          const from = new Vector3(x, cy + uy * len * 0.5 + 0.05, z), to = new Vector3(cx - ux * len * 0.18, cy - uy * len * 0.18, cz - uz * len * 0.18);
          const mid = from.clone().lerp(to, 0.5).setY((from.y + to.y) / 2 + len * 0.03);
          const thick = 0.02 + 0.035 * (1 - f);
          // Dark, as wood is under its own needles, and stopping short of the tip, where the bough is all needle.
          layLimb(wood.mesh, [from, mid, to], [thick, thick * 0.75, thick * 0.4], 3, [wood.bark[0] * 0.6, wood.bark[1] * 0.6, wood.bark[2] * 0.6], t + k, (h) => 0.3 + 0.2 * Math.min(1, Math.max(0, (h - base) / height)));
          // The second sheet: the same bough turned on edge, narrower, and a little darker for hanging under the first.
          M.compose(P.set(cx, cy - len * 0.06, cz), Q.multiply(Q2.setFromAxisAngle(UP, Math.PI / 2)), S.set(len * 0.5, len * 0.9, len));
          this.push(this.needles, [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8], x, y - 1.2 - r, z);
        }
      }
    }
    // The leader: two upright cards crossed.
    for (const yaw of [0, Math.PI / 2]) {
      M.compose(P.set(x, base + height * 0.96, z), Q.setFromEuler(E.set(0, yaw + rng.range(0, 1), 0)), S.set(radius * 0.5, height * 0.2, 1));
      this.push(this.needles, colour(rng), x, base + height * 0.6, z);
    }
  }
}

export interface TreeOptions {
  /** An oak has a short trunk and wide limbs; an ash a tall one, with a leader and rising branches. */
  kind: 'oak' | 'ash';
  /** 1 for a tree that can be walked up to, falling to 0 for one far off, which is drawn more simply. */
  detail: number;
  /** How many leaf cards to hang on it, and how large each is, in metres. */
  cards: number;
  cardSize: number;
  leaf: (rng: Rng) => Colour;
  bark: Colour;
  /** For wood that is not baked: gives each point its share of the sky, less up among the leaves. */
  shaded?: boolean;
  /** Where to build roots and other small wood that nobody should be stopped by. */
  soft?: MeshBuilder;
}

const UP = new Vector3(0, 1, 0);

/**
 * A length of trunk or branch: a tube through the given points, round, tapering, closed at both
 * ends. Bark is wrapped round it a whole number of times, so it meets itself without a seam.
 */
export function layLimb(mesh: MeshBuilder, points: Vector3[], radii: number[], sides: number, colour: Colour, along: number, open: ((y: number) => number) | null): void {
  const side = new Vector3(), fore = new Vector3(), dir = new Vector3();
  const rows: number[][] = [];
  let v = along;
  const wraps = Math.max(1, Math.round((Math.PI * 2 * radii[0]) / 0.7));
  for (let j = 0; j < points.length; j++) {
    dir.subVectors(points[Math.min(points.length - 1, j + 1)], points[Math.max(0, j - 1)]).normalize();
    // Any two directions square to the limb will do, so long as they turn little from ring to ring.
    if (j === 0) side.crossVectors(dir, Math.abs(dir.y) > 0.9 ? fore.set(1, 0, 0) : UP).normalize();
    else side.addScaledVector(dir, -side.dot(dir)).normalize();
    fore.crossVectors(dir, side);
    if (j > 0) v += points[j].distanceTo(points[j - 1]);
    const row: number[] = [], p = points[j], r = radii[j];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = side.x * c + fore.x * s, ny = side.y * c + fore.y * s, nz = side.z * c + fore.z * s;
      const tone = 0.82 + 0.3 * (((i * 7 + j * 3) % 5) / 5);
      const id = mesh.addVertex(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, (i / sides) * wraps, v / 0.7, colour[0] * tone, colour[1] * tone, colour[2] * tone);
      if (open) mesh.setOpen(id, open(p.y));
      row.push(id);
    }
    rows.push(row);
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < sides; i++) {
    mesh.addTriangle(rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]);
    mesh.addTriangle(rows[j][i], rows[j + 1][i + 1], rows[j][i + 1]);
  }
  // Closed at both ends: a point in the middle of each, joined to its ring.
  for (const [j, flip] of [[0, true], [points.length - 1, false]] as const) {
    dir.subVectors(points[Math.min(points.length - 1, j + 1)], points[Math.max(0, j - 1)]).normalize();
    if (flip) dir.negate();
    const p = points[j], tip = mesh.addVertex(p.x + dir.x * radii[j] * 0.5, p.y + dir.y * radii[j] * 0.5, p.z + dir.z * radii[j] * 0.5, dir.x, dir.y, dir.z, 0.5, v / 0.7, colour[0], colour[1], colour[2]);
    if (open) mesh.setOpen(tip, open(p.y));
    for (let i = 0; i < sides; i++) {
      if (flip) mesh.addTriangle(tip, rows[j][i], rows[j][i + 1]);
      else mesh.addTriangle(tip, rows[j][i + 1], rows[j][i]);
    }
  }
}

/**
 * Grows a broadleaved tree: a trunk that divides into limbs, the limbs into branches and the
 * branches into twigs, each thinner and shorter than what bears it and reaching for the light,
 * with leaves hung in sprays on the twigs. The wood is real geometry, so limbs show through the
 * crown as they do on a tree; the leaves are cards, as before, but placed where there are twigs
 * to carry them, so the crown has the lumps and gaps of the branching under it.
 * Returns how far the crown reaches from the trunk.
 */
export function growTree(planting: Planting, wood: MeshBuilder, x: number, base: number, z: number, height: number, girth: number, o: TreeOptions, rng: Rng): number {
  const levels = o.detail > 0.6 ? 4 : o.detail > 0.25 ? 3 : 2;
  const oak = o.kind === 'oak';
  const heart = new Vector3(x, base + height * 0.62, z);
  const open = o.shaded ? (y: number) => 0.95 - 0.5 * Math.min(1, Math.max(0, (y - base - height * 0.25) / (height * 0.35))) : null;
  const tips: { at: Vector3; reach: number }[] = [];
  // Where the last branches leave the ones that bear them: the inside of the crown.
  const inner: { at: Vector3; reach: number }[] = [];
  let spread = 0;
  const any = new Vector3();
  const branch = (from: Vector3, dir: Vector3, length: number, radius: number, level: number) => {
    const steps = level === 0 ? 4 : level >= levels - 1 ? 2 : 3;
    const points = [from.clone()], radii = [radius];
    const d = dir.clone(), p = from.clone();
    // The trunk spreads into the ground at its foot.
    if (level === 0) { points[0].y -= 0.4; radii[0] = radius * 1.55; points.push(from.clone().setY(from.y + 0.25)); radii.push(radius * 1.15); }
    const taper = level === 0 ? 0.3 : 0.4;
    for (let s = 1; s <= steps; s++) {
      // It wanders as it grows, and turns upward: less so for a trunk, which was never in shade.
      const gnarl = (oak ? 0.2 : 0.1) * (level === 0 ? 0.35 : 1);
      d.add(any.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(gnarl));
      d.y += level === 0 ? 0 : oak ? 0.1 : 0.16;
      d.normalize();
      p.addScaledVector(d, length / steps);
      points.push(p.clone());
      radii.push(radius * (1 - (taper * s) / steps));
    }
    const sides = level === 0 ? (o.detail > 0.5 ? 9 : 6) : level === 1 ? (o.detail > 0.5 ? 6 : 4) : level === 2 ? 4 : 3;
    layLimb(wood, points, radii, sides, o.bark, rng.range(0, 3), open);
    const end = points[points.length - 1], endRadius = radii[radii.length - 1];
    spread = Math.max(spread, Math.hypot(end.x - x, end.z - z));
    if (level >= levels) {
      tips.push({ at: end.clone(), reach: length });
      tips.push({ at: points[points.length - 2].clone().lerp(end, 0.2), reach: length });
      return;
    }
    if (level === levels - 1) inner.push({ at: end.clone(), reach: length });
    // Where it divides. An ash keeps a leader going nearly straight on; an oak does not.
    const forks = level === 0 ? (oak ? 3 + rng.int(0, 1) : 3) : 2 + (rng.chance(oak ? 0.45 : 0.25) ? 1 : 0);
    const turn = rng.range(0, Math.PI * 2);
    // Two directions square to this one, to spread the forks about.
    const a = new Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? any.set(1, 0, 0) : UP).normalize(), b = new Vector3().crossVectors(d, a);
    for (let k = 0; k < forks; k++) {
      const leader = !oak && k === 0;
      const lean = leader ? rng.range(0.05, 0.2) : level === 0 ? (oak ? rng.range(0.6, 1.0) : rng.range(0.7, 0.95)) : rng.range(0.45, 0.8);
      const az = turn + (k / forks) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const nd = d.clone().multiplyScalar(Math.cos(lean)).addScaledVector(a, Math.sin(lean) * Math.cos(az)).addScaledVector(b, Math.sin(lean) * Math.sin(az));
      const share = leader ? 0.82 : forks === 2 ? 0.74 : 0.64;
      const nl = level === 0 ? height * (oak ? 0.32 : leader ? 0.3 : 0.24) * rng.range(0.85, 1.15) : length * rng.range(0.62, 0.8);
      branch(end, nd, nl, endRadius * share, level + 1);
    }
    // An ash also puts out branches from the side of its trunk, below the top.
    if (!oak && level === 0) {
      for (let k = 0; k < 3; k++) {
        const f = 0.5 + 0.14 * k + rng.range(-0.04, 0.04), at = points[1].clone().lerp(end, f), az = turn + 1 + k * 2.3 + rng.range(-0.4, 0.4);
        branch(at, new Vector3(Math.cos(az) * 0.8, 0.6, Math.sin(az) * 0.8).normalize(), height * 0.2 * rng.range(0.85, 1.15), radius * 0.38, 2);
      }
    }
  };
  const lean = oak ? 0.1 : 0.05;
  branch(new Vector3(x, base, z), new Vector3(rng.range(-lean, lean), 1, rng.range(-lean, lean)).normalize(), height * (oak ? 0.3 : 0.48), girth, 0);
  // Roots: the trunk does not go into the ground like a post, but spreads into it.
  if (o.soft && o.detail > 0.6) {
    const roots = 4 + rng.int(0, 2), turn = rng.range(0, Math.PI * 2);
    for (let k = 0; k < roots; k++) {
      const a = turn + (k / roots) * Math.PI * 2 + rng.range(-0.3, 0.3), out = girth * rng.range(2.1, 3.3), c = Math.cos(a), s = Math.sin(a);
      // Each leaves the trunk a little way up, runs out along the ground and goes under.
      layLimb(o.soft, [new Vector3(x + c * girth * 0.4, base + girth * 1.3, z + s * girth * 0.4), new Vector3(x + c * out * 0.5, base + girth * 0.3, z + s * out * 0.5), new Vector3(x + c * out, base - girth * 0.7, z + s * out)],
        [girth * 0.6, girth * 0.4, girth * 0.2], 5, o.bark, rng.range(0, 3), open);
    }
  }
  // Leaves: a spray about each twig, shaded half as a body of its own and half as part of the
  // whole crown. A crown is dark inside and beneath, where its own leaves keep the light out,
  // and bright at its edge: each spray is tinted by how deep in the crown it hangs.
  let crownReach = 1;
  for (const tip of tips) crownReach = Math.max(crownReach, tip.at.distanceTo(heart));
  const hang = (list: { at: Vector3; reach: number }[], cards: number, size: number, dim: number) => {
    const each = Math.max(1, Math.round(cards / list.length));
    for (const tip of list) {
      const r = Math.min(1.6, 0.3 + tip.reach * 0.55);
      const depth = Math.min(1, tip.at.distanceTo(heart) / crownReach);
      const light = dim * (0.5 + 0.5 * depth * depth) * (tip.at.y < heart.y ? 0.82 : 1);
      const centre = tip.at.clone().lerp(heart, 0.5);
      planting.spray(tip.at.x, tip.at.y, tip.at.z, r, r * 0.65, each, size, (q) => { const c = o.leaf(q); return [c[0] * light, c[1] * light, c[2] * light]; }, rng, centre.x, centre.y - r, centre.z);
      spread = Math.max(spread, Math.hypot(tip.at.x - x, tip.at.z - z) + r * 0.7);
    }
  };
  hang(tips, o.cards * 0.78, o.cardSize, 1);
  // Larger, darker boughs fill the inside, so the sky does not show through the middle of the tree.
  if (inner.length) hang(inner, o.cards * 0.22, o.cardSize * 1.7, 0.62);
  return spread;
}

export interface ConiferOptions {
  /** A spruce is a spire clothed to the ground in drooping boughs; a pine a bare stem with a rounded head. */
  kind: 'spruce' | 'pine';
  detail: number;
  needle: (rng: Rng) => Colour;
  bark: Colour;
  shaded?: boolean;
  /** Where branches go: wood that is drawn but stops nobody. */
  soft: MeshBuilder;
}

const BX = new Vector3(), BY = new Vector3(), BZ = new Vector3();

/**
 * Grows a conifer. The trunk goes straight up, tapering. Branches leave it in whorls, a ring of
 * them every half metre or so: on a spruce the low ones are long and hang, the high ones short
 * and rising, and every one turns up at its tip; on a pine there are none for half its height,
 * and those above reach up and out into a rounded head. Needles are sprays laid along each
 * branch, some flat and some hanging, darker by the trunk and lighter at the tips where the
 * year's growth is. Returns how far the boughs reach.
 */
export function growConifer(planting: Planting, wood: MeshBuilder, x: number, base: number, z: number, height: number, radius: number, girth: number, o: ConiferOptions, rng: Rng): number {
  const pine = o.kind === 'pine';
  const open = o.shaded ? (y: number) => 0.9 - 0.45 * Math.min(1, Math.max(0, (y - base) / (height * 0.5))) : null;
  // The trunk, with a little sway in it.
  const lean = [rng.range(-0.02, 0.02), rng.range(-0.02, 0.02)], bow = rng.range(-0.25, 0.25), bowAt = rng.range(0, Math.PI * 2);
  const axis = (t: number): Vector3 => new Vector3(x + lean[0] * height * t + Math.cos(bowAt) * bow * Math.sin(t * Math.PI) * 0.5, base + height * t, z + lean[1] * height * t + Math.sin(bowAt) * bow * Math.sin(t * Math.PI) * 0.5);
  const stem: Vector3[] = [axis(0).setY(base - 0.4), axis(0.02)], radii = [girth * 1.5, girth * 1.12];
  for (let k = 1; k <= 6; k++) { stem.push(axis((k / 6) * 0.97)); radii.push(girth * (1 - 0.9 * (k / 6)) + 0.012); }
  layLimb(wood, stem, radii, o.detail > 0.5 ? 8 : 5, o.bark, rng.range(0, 3), open);

  const crownFrom = pine ? rng.range(0.5, 0.62) : rng.range(0.08, 0.2);
  const spacing = (pine ? 0.6 : 0.42 + height * 0.012) / Math.max(0.45, o.detail);
  const whorls = Math.max(4, Math.round((height * (0.97 - crownFrom)) / spacing));
  const dir = new Vector3(), tip = new Vector3(), at = new Vector3();
  let reach = 0, turn = rng.range(0, Math.PI * 2);
  const bough = (from: Vector3, az: number, rise: number, length: number, f: number, thick: number) => {
    // Out from the trunk, then turning upward towards its tip.
    dir.set(Math.cos(az) * Math.cos(rise), Math.sin(rise), Math.sin(az) * Math.cos(rise));
    const mid = from.clone().addScaledVector(dir, length * 0.55);
    tip.set(Math.cos(az) * Math.cos(rise + 0.4), Math.sin(rise + 0.4), Math.sin(az) * Math.cos(rise + 0.4));
    const end = mid.clone().addScaledVector(tip, length * 0.45);
    if (o.detail > 0.5 && thick > 0.012) layLimb(o.soft, [from, mid, end], [thick, thick * 0.6, thick * 0.2], 3, [o.bark[0] * 0.7, o.bark[1] * 0.7, o.bark[2] * 0.7], f * 9, open ? (y) => open(y) * 0.6 : null);
    reach = Math.max(reach, Math.hypot(end.x - x, end.z - z));
    // Sprays of needles along it: more of them, and wider, the longer the bough.
    const sprays = Math.max(pine ? 3 : 2, Math.round(length / (pine ? 0.42 : 0.55) * Math.min(1, 0.45 + o.detail * 0.6)));
    for (let k = 0; k < sprays; k++) {
      const t = pine ? 0.3 + 0.75 * ((k + rng.next()) / sprays) : (k + 0.35 + 0.5 * rng.next()) / sprays;
      if (t < 0.55) at.copy(from).lerp(mid, t / 0.55); else at.copy(mid).lerp(end, Math.min(1.1, (t - 0.55) / 0.45));
      const along = t < 0.55 ? dir : tip;
      // The card lies along the bough, its top edge towards the trunk; flat on a pine, and on a
      // spruce flat or hanging by turns, since spruce twigs hang from the branch like a curtain.
      BY.copy(along).negate();
      BX.crossVectors(BY, UP).normalize();
      BZ.crossVectors(BX, BY);
      const roll = !pine && k % 2 === 1 ? rng.range(0.9, 1.35) * (rng.chance(0.5) ? 1 : -1) : rng.range(-0.45, 0.45);
      const size = (pine ? rng.range(0.95, 1.5) : (0.5 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))) * Math.min(1.5, 0.55 + length * 0.42)) * (o.detail > 0.5 ? 1 : 1.5);
      M.makeBasis(BX, BY, BZ);
      Q.setFromRotationMatrix(M).multiply(Q2.setFromAxisAngle(UP, roll));
      M.compose(P.set(at.x, at.y - (Math.abs(roll) > 0.8 ? size * 0.22 : 0), at.z), Q, S.set(size * 0.9, size * 1.1, size));
      const c = o.needle(rng), light = (0.5 + 0.5 * t) * (0.85 + 0.3 * f);
      planting.pushCard(planting.needles, [c[0] * light, c[1] * light, c[2] * light], x, from.y - 0.8 - length * 0.5, z);
    }
  };
  for (let w = 0; w < whorls; w++) {
    const f = (w + 0.5) / whorls, from = axis(crownFrom + (0.97 - crownFrom) * f);
    const around = pine ? 4 + rng.int(0, 1) : o.detail > 0.5 ? 5 : 4;
    turn += pine ? rng.range(0.8, 2.2) : 0.63;
    for (let k = 0; k < around; k++) {
      // Now and then a branch is missing, as on any tree that has stood in wind.
      if (rng.chance(0.08)) continue;
      const az = turn + (k / around) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const length = pine ? radius * (0.45 + 0.75 * Math.sin(Math.PI * Math.pow(f, 0.75))) * rng.range(0.75, 1.1) : (radius * (Math.pow(1 - f, 0.9) * 0.95 + 0.07)) * rng.range(0.8, 1.12);
      const rise = pine ? rng.range(0.15, 0.55) : -0.42 + 0.72 * f + rng.range(-0.1, 0.1);
      bough(from, az, rise, length, f, (pine ? 0.035 : 0.014 + 0.03 * (1 - f)) * (girth / 0.2));
    }
  }
  // A pine keeps the stubs of the branches it has shed; a spruce has dead twigs under its skirt.
  if (o.detail > 0.6) {
    for (let k = 0, n = pine ? 5 : 3; k < n; k++) {
      const t = pine ? rng.range(0.18, crownFrom) : rng.range(0.04, crownFrom + 0.03), from = axis(t), az = rng.range(0, Math.PI * 2), len = rng.range(0.3, pine ? 0.9 : 1.4);
      layLimb(o.soft, [from, from.clone().add(dir.set(Math.cos(az) * len, rng.range(-0.15, 0.1) * len, Math.sin(az) * len))], [girth * 0.14, girth * 0.05], 3, [o.bark[0] * 0.6, o.bark[1] * 0.6, o.bark[2] * 0.6], k, open);
    }
  }
  // The leader: two upright sprays crossed at the very top.
  for (const yaw of [0, Math.PI / 2]) {
    const top = axis(0.985);
    M.compose(P.set(top.x, top.y, top.z), Q.setFromEuler(E.set(0, yaw + turn, 0)), S.set(radius * (pine ? 0.7 : 0.42), height * (pine ? 0.1 : 0.16), 1));
    planting.pushCard(planting.needles, o.needle(rng), x, base + height * 0.6, z);
  }
  return reach;
}

/** A plain tapering trunk for a tree that is only looked at: a few sides, no bark relief. */
export function layTrunk(mesh: MeshBuilder, x: number, base: number, z: number, height: number, girth: number, colour: Colour, lean: [number, number] = [0, 0]): void {
  const sides = 6, rings = 3;
  const ids: number[][] = [];
  for (let j = 0; j <= rings; j++) {
    const f = j / rings, r = girth * (1 - 0.6 * f), y = base - 0.4 + (height + 0.4) * f;
    const row: number[] = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const tone = 0.8 + 0.3 * ((i * 7 + j * 3) % 5) / 5;
      row.push(mesh.addVertex(x + lean[0] * f + Math.cos(a) * r, y, z + lean[1] * f + Math.sin(a) * r, Math.cos(a), 0.1, Math.sin(a), i * 0.5, y * 0.6, colour[0] * tone, colour[1] * tone, colour[2] * tone));
    }
    ids.push(row);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    mesh.addTriangle(ids[j][i], ids[j + 1][i], ids[j + 1][i + 1]);
    mesh.addTriangle(ids[j][i], ids[j + 1][i + 1], ids[j][i + 1]);
  }
}
