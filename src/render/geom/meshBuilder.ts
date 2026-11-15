import { BufferAttribute, BufferGeometry } from 'three';

/** Vertex layout shared by all site geometry. */
export const FIELD_MOSS = 0;
export const FIELD_WET = 1;
export const FIELD_SOOT = 2;
export const FIELD_MORTAR = 3;

class GrowF32 {
  data: Float32Array;
  length = 0;
  constructor(initial: number) {
    this.data = new Float32Array(initial);
  }
  ensure(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  trimmed(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

/** Accumulates indexed triangles with position, normal, uv, colour and a four-channel field. */
export class MeshBuilder {
  private pos = new GrowF32(3 << 14);
  private nrm = new GrowF32(3 << 14);
  private uv = new GrowF32(2 << 14);
  private col = new GrowF32(3 << 14);
  private fld = new GrowF32(4 << 14);
  private idx: number[] = [];
  vertexCount = 0;

  addVertex(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    r: number, g: number, b: number,
    f0 = 0, f1 = 0, f2 = 0, f3 = 0,
  ): number {
    const i = this.vertexCount++;
    this.pos.ensure(3);
    this.nrm.ensure(3);
    this.uv.ensure(2);
    this.col.ensure(3);
    this.fld.ensure(4);
    const p = this.pos, n = this.nrm, t = this.uv, c = this.col, f = this.fld;
    p.data[p.length++] = px; p.data[p.length++] = py; p.data[p.length++] = pz;
    n.data[n.length++] = nx; n.data[n.length++] = ny; n.data[n.length++] = nz;
    t.data[t.length++] = u; t.data[t.length++] = v;
    c.data[c.length++] = r; c.data[c.length++] = g; c.data[c.length++] = b;
    f.data[f.length++] = f0; f.data[f.length++] = f1; f.data[f.length++] = f2; f.data[f.length++] = f3;
    return i;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.trimmed(), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.trimmed(), 3));
    g.setAttribute('uv', new BufferAttribute(this.uv.trimmed(), 2));
    g.setAttribute('color', new BufferAttribute(this.col.trimmed(), 3));
    g.setAttribute('aField', new BufferAttribute(this.fld.trimmed(), 4));
    const n = this.vertexCount;
    // Baked light: per colour channel, a constant term and a direction term; plus sky and sun visibility.
    g.setAttribute('aSHr', new BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aSHg', new BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aSHb', new BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aBake', new BufferAttribute(new Float32Array(n * 2), 2));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
