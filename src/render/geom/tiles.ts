import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three';

/**
 * Cuts a mesh's geometry into tiles of the ground, `size` metres square, each triangle going to the tile its middle falls in, so
 * that each tile can be left out of a frame on its own. A whole town's stone, or plaster, or timber, was one mesh, whose bounds
 * took in the whole town: it was never outside the view, and every triangle of it went to the graphics card every frame, wherever
 * one looked. Cut into tiles, what is behind the eye or off to the side is not drawn, and what is drawn is drawn nearest first,
 * so that less is painted over. Every attribute is carried over as it was laid, the light's fourteen numbers side by side in
 * one buffer as `MeshBuilder` lays them. A mesh too small to be worth cutting is given back whole.
 */
export function tileGeometry(g: BufferGeometry, size: number, least = 3000): BufferGeometry[] {
  const index = g.getIndex(), pos = g.getAttribute('position') as BufferAttribute;
  if (!index || index.count / 3 < least) return [g];
  const tris = index.count / 3, ix = index.array as ArrayLike<number>;
  const tiles = new Map<string, number[]>();
  for (let t = 0; t < tris; t++) {
    const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2];
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(t);
  }
  if (tiles.size < 2) return [g];
  const plain = Object.entries(g.attributes).filter(([, at]) => !(at as InterleavedBufferAttribute).isInterleavedBufferAttribute) as [string, BufferAttribute][];
  const woven = Object.entries(g.attributes).filter(([, at]) => (at as InterleavedBufferAttribute).isInterleavedBufferAttribute) as [string, InterleavedBufferAttribute][];
  const source = woven.length ? woven[0][1].data : null;
  const out: BufferGeometry[] = [];
  const remap = new Int32Array(pos.count).fill(-1);
  for (const list of tiles.values()) {
    const used: number[] = [];
    const idx = new Uint32Array(list.length * 3);
    list.forEach((t, k) => {
      for (let c = 0; c < 3; c++) {
        const v = ix[t * 3 + c];
        if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
        idx[k * 3 + c] = remap[v];
      }
    });
    const piece = new BufferGeometry();
    for (const [name, at] of plain) {
      const n = at.itemSize, from = at.array as Float32Array, to = new Float32Array(used.length * n);
      used.forEach((v, k) => { for (let c = 0; c < n; c++) to[k * n + c] = from[v * n + c]; });
      piece.setAttribute(name, new BufferAttribute(to, n, at.normalized));
    }
    if (source) {
      const stride = source.stride, from = source.array as Float32Array, to = new Float32Array(used.length * stride);
      used.forEach((v, k) => { for (let c = 0; c < stride; c++) to[k * stride + c] = from[v * stride + c]; });
      const buffer = new InterleavedBuffer(to, stride);
      for (const [name, at] of woven) piece.setAttribute(name, new InterleavedBufferAttribute(buffer, at.itemSize, at.offset, at.normalized));
    }
    piece.setIndex(new BufferAttribute(idx, 1));
    piece.computeBoundingBox();
    piece.computeBoundingSphere();
    for (const v of used) remap[v] = -1;
    out.push(piece);
  }
  return out;
}
