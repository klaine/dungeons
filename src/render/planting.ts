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
const E = new Euler();
const P = new Vector3();
const S = new Vector3();

export type Colour = [number, number, number];

export class Planting {
  readonly grass: CardSet = { kind: 'grass', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly flowers: CardSet = { kind: 'flower', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly ferns: CardSet = { kind: 'fern', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly herbs: CardSet = { kind: 'herb', shape: 'tuft', shadow: false, matrices: [], colours: [], centres: [] };
  readonly leaves: CardSet = { kind: 'leaf', shape: 'card', shadow: true, matrices: [], colours: [], centres: [] };
  readonly needles: CardSet = { kind: 'needle', shape: 'card', shadow: true, matrices: [], colours: [], centres: [] };

  get sets(): CardSet[] {
    return [this.grass, this.flowers, this.ferns, this.herbs, this.leaves, this.needles].filter((s) => s.matrices.length > 0);
  }

  private push(set: CardSet, colour: Colour, cx: number, cy: number, cz: number): void {
    for (let k = 0; k < 16; k++) set.matrices.push(M.elements[k]);
    set.colours.push(colour[0], colour[1], colour[2]);
    set.centres.push(cx, cy, cz);
  }

  /** A tuft standing on the ground: grass, or flowers on their stems. Lit as the ground is. */
  tuft(set: CardSet, x: number, y: number, z: number, width: number, height: number, yaw: number, colour: Colour): void {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, yaw, 0)), S.set(width, height, width));
    this.push(set, colour, x, y - 1000, z);
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

  /** A conifer: tiers of boughs that droop, wide at the foot and closing to a point. */
  conifer(x: number, base: number, z: number, height: number, radius: number, tiers: number, colour: (rng: Rng) => Colour, rng: Rng): void {
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
        this.push(this.needles, colour(rng), x, y - 1.2 - r, z);
      }
    }
    // The leader: two upright cards crossed.
    for (const yaw of [0, Math.PI / 2]) {
      M.compose(P.set(x, base + height * 0.96, z), Q.setFromEuler(E.set(0, yaw + rng.range(0, 1), 0)), S.set(radius * 0.5, height * 0.2, 1));
      this.push(this.needles, colour(rng), x, base + height * 0.6, z);
    }
  }
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
