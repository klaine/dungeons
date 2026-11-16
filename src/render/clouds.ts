import { Data3DTexture, LinearFilter, RedFormat, RGFormat, RepeatWrapping, UnsignedByteType } from 'three';

/**
 * The stuff clouds are made of: a block of noise that repeats in every direction, which the sky
 * reads at any point to ask how much cloud is there. Two kinds are stored. The first is the
 * shape: soft billows with rounded cells cut into them, as a cumulus has. The second is finer
 * cells alone, used to fray the edges.
 */
export function cloudNoise(size = 48): Data3DTexture {
  const data = new Uint8Array(size * size * size * 2);
  const hash = (x: number, y: number, z: number, s: number): number => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const wrap = (v: number, period: number) => ((v % period) + period) % period;
  // Smooth noise that repeats every `period` cells.
  const value = (x: number, y: number, z: number, period: number, s: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const at = (dx: number, dy: number, dz: number) => hash(wrap(xi + dx, period), wrap(yi + dy, period), wrap(zi + dz, period), s);
    const lo = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * u + (at(0, 1, 0) - at(0, 0, 0) + (at(0, 0, 0) - at(1, 0, 0) - at(0, 1, 0) + at(1, 1, 0)) * u) * v;
    const hi = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * u + (at(0, 1, 1) - at(0, 0, 1) + (at(0, 0, 1) - at(1, 0, 1) - at(0, 1, 1) + at(1, 1, 1)) * u) * v;
    return lo + (hi - lo) * w;
  };
  // Distance to the nearest of a scatter of points, one to a cell, repeating every `period` cells.
  const cells = (x: number, y: number, z: number, period: number, s: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = wrap(xi + dx, period), cy = wrap(yi + dy, period), cz = wrap(zi + dz, period);
      const px = xi + dx + hash(cx, cy, cz, s) - x, py = yi + dy + hash(cx, cy, cz, s + 1) - y, pz = zi + dz + hash(cx, cy, cz, s + 2) - z;
      best = Math.min(best, px * px + py * py + pz * pz);
    }
    return Math.min(1, Math.sqrt(best));
  };
  let o = 0;
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / size, y = j / size, z = k / size;
    const billow = value(x * 4, y * 4, z * 4, 4, 1) * 0.55 + value(x * 8, y * 8, z * 8, 8, 2) * 0.3 + value(x * 16, y * 16, z * 16, 16, 3) * 0.15;
    const puff = 1 - cells(x * 3, y * 3, z * 3, 3, 7), small = 1 - cells(x * 7, y * 7, z * 7, 7, 11);
    data[o++] = Math.round(255 * Math.min(1, Math.max(0, billow * 0.62 + puff * 0.42 + small * 0.12 - 0.12)));
    data[o++] = Math.round(255 * Math.min(1, Math.max(0, 1 - 0.65 * cells(x * 6, y * 6, z * 6, 6, 21) - 0.45 * cells(x * 12, y * 12, z * 12, 12, 25))));
  }
  const texture = new Data3DTexture(data, size, size, size);
  texture.format = RGFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  void RedFormat;
  return texture;
}
