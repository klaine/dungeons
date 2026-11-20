import { Mesh, Scene, Vector3 } from 'three';
import { Hour, SKIES } from '../core/site';
import { HeightField } from '../core/terrain';
import { Atmosphere } from '../render/post';
import { SeaDesc } from '../render/scene';
import { Sea, SEA_EDGE } from '../render/sea';

/**
 * The world's sea, drawn as the game draws a place's (`Sea`: the swell lifting it, a road of glitter, light through the crests, the
 * shallows seen into, white where it breaks), not as one flat dark sheet: part of the world and the game sharing one renderer
 * (`docs/06-world.md`, *The world as the game*, step 3). The game's sea is a disc of rings about a middle, finest near it, over a
 * lattice of its bed; so here it is laid about the walker over the world's own land as its bed (`BED` metres square, read from the
 * world's lattice of eight metres), and laid again when the walker has gone `MOVE` from its middle. Where a place with a sea of its
 * own stands in the world (a harbour town, an island: `override`), that place's sea is drawn instead, about the place, with its
 * harbour's and its cliffs' own bed and spray. Beyond the disc, three and a half kilometres out, the world's flat sheet is left,
 * a little under it: a ring about the disc's middle, moved with it (`sheet`), so that nothing lies under the disc but the bed.
 */
const BED = 1600, MOVE = 600;
/** Where the world's flat sheet of sea begins, metres from the game's sea's middle: a little inside the disc's edge, under it. */
export const SEA_RING = SEA_EDGE - 20;

export class WorldSea {
  private sea: Sea | null = null;
  private at = new Vector3(Infinity, 0, Infinity);
  private placeSea: SeaDesc | null = null;
  private built: SeaDesc | null = null;
  /** How long laying the sea last took, milliseconds. */
  lastMs = 0;

  constructor(private readonly o: { scene: Scene; atmosphere: Atmosphere; field: HeightField; hour: Hour; sheet: Mesh }) {}

  /** A place's own sea to draw instead of the world's, or none (the place let go of). */
  override(desc: SeaDesc | null): void { this.placeSea = desc; }

  /** Each frame: laid again where the walker has gone far from its middle (or a place's sea comes or goes); its swell moved on. */
  update(me: Vector3, time: number): void {
    const want = this.placeSea;
    // (A place's sea is laid once, about the place, and stays while it stands; the world's is laid again as the walker goes.)
    const stale = want ? this.built !== want : this.built !== null || Math.hypot(me.x - this.at.x, me.z - this.at.z) > MOVE;
    if (stale) this.lay(want ?? this.worldSea(me), me, !!want);
    this.sea?.update(time);
  }

  /** The world's sea about a point: its level nothing, its bed the world's land on its lattice. */
  private worldSea(me: Vector3): SeaDesc {
    const f = this.o.field, cell = f.cell, n = Math.round(BED / cell) + 1, x0 = Math.round((me.x - BED / 2) / cell) * cell, z0 = Math.round((me.z - BED / 2) / cell) * cell;
    const data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = f.at(x0 + i * cell, z0 + j * cell);
    return { level: 0, x: x0 + BED / 2, z: z0 + BED / 2, bed: { x0, z0, cell, nx: n, nz: n, data } };
  }

  private lay(desc: SeaDesc, me: Vector3, place: boolean): void {
    const t0 = performance.now();
    if (this.sea) { this.o.scene.remove(this.sea.mesh); this.sea.mesh.geometry.dispose(); }
    // (Coloured by the sky of the hour, as the game colours a place's sea.)
    const S = SKIES[this.o.hour], mean = [0, 1, 2].map((c) => 0.55 * S.zenith[c] + 0.45 * S.horizon[c]);
    this.sea = new Sea(desc, {
      deep: [0, 1, 2].map((c) => mean[c] * [0.05, 0.16, 0.2][c] + 0.002),
      shallow: [0, 1, 2].map((c) => (0.5 * S.zenith[c] + 0.5 * S.horizon[c]) * [0.18, 0.5, 0.48][c]),
      foam: [0, 1, 2].map((c) => 0.55 * S.horizon[c] + 0.1 * S.colour[c] * S.intensity),
    });
    this.sea.attach(this.o.atmosphere);
    this.o.scene.add(this.sea.mesh);
    this.o.sheet.position.set(desc.x, this.o.sheet.position.y, desc.z);
    this.built = place ? desc : null;
    this.at.set(me.x, 0, me.z);
    this.lastMs = performance.now() - t0;
  }
}
