/**
 * Bakes indirect light for a static site.
 *
 * Direct light from the sun and local lights is drawn in real time. What is baked is everything
 * else: light from the sky, and light bounced off surfaces. The result is stored per vertex as a
 * constant term and a direction term per colour channel, so normal maps still shape it.
 *
 * Work is spread over web workers and reported progressively, so the site can be walked while
 * the bake refines.
 */

export interface BakeLights {
  /** Unit vector towards the sun. */
  sunDir: [number, number, number];
  /** Sun irradiance on a surface facing it. */
  sunE: [number, number, number];
  /** Sky radiance at the zenith and horizon, and the radiance of whatever lies below the horizon. */
  sky: { zenith: number[]; horizon: number[]; ground: number[] };
  /**
   * Lamps. The light that falls straight from a lamp is normally left out of the result, because a
   * real light draws it; a lamp marked `keep` has no real light, and its direct light is baked in.
   */
  points: { pos: number[]; intensity: number[]; range: number; size: number; keep?: boolean }[];
}

export interface BakeInput {
  positions: Float32Array;
  normals: Float32Array;
  /** Diffuse reflectance per vertex, linear RGB. */
  albedo: Float32Array;
  index: Uint32Array;
  /** For each vertex, the vertex whose baked light it takes (itself if it is traced), and a multiplier. */
  source: Int32Array;
  scale: Float32Array;
  /** Axis-aligned solid volumes, six numbers each: min then max. */
  masses: Float32Array;
  lights: BakeLights;
  rays: number;
  bounces: number;
  workers: number;
}

export interface BakeResult {
  /** Twelve floats per vertex: for R, G and B, a constant and a three-component direction term. */
  sh: Float32Array;
  /** Share of the sky each vertex can see. */
  skyVis: Float32Array;
  /** Share of the day each vertex is in direct sun. */
  sunVis: Float32Array;
}

type Progress = (label: string, fraction: number) => void;

class Pool {
  private workers: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.workers.push(new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' }));
    }
  }

  /** Sends one message to every worker and waits for each to answer. */
  broadcast(make: () => { msg: unknown; transfer?: Transferable[] }): Promise<void> {
    return Promise.all(this.workers.map((w) => new Promise<void>((resolve, reject) => {
      w.onmessage = () => resolve();
      w.onerror = (e) => reject(new Error(`bake worker: ${e.message}`));
      const { msg, transfer } = make();
      w.postMessage(msg, transfer ?? []);
    }))).then(() => undefined);
  }

  /** Runs jobs across the pool, handing each result to `onResult`. */
  run<J, R>(jobs: J[], onResult: (r: R) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let next = 0;
      let done = 0;
      if (!jobs.length) resolve();
      for (const w of this.workers) {
        const feed = () => {
          if (next < jobs.length) w.postMessage(jobs[next++]);
        };
        w.onmessage = (e: MessageEvent<R>) => {
          onResult(e.data);
          if (++done === jobs.length) resolve();
          else feed();
        };
        w.onerror = (e) => reject(new Error(`bake worker: ${e.message}`));
        feed();
      }
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}

export async function bake(input: BakeInput, onProgress: Progress, onPartial?: (r: BakeResult) => void): Promise<BakeResult> {
  const n = input.positions.length / 3;
  // Only some vertices are traced; the rest copy from one of those. See MeshBuilder.bakePlan.
  const carriers: number[] = [];
  const slot = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (input.source[i] === i) {
      slot[i] = carriers.length;
      carriers.push(i);
    }
  }
  const m = carriers.length;
  const carrierList = new Uint32Array(carriers);
  const pool = new Pool(input.workers);
  const chunk = 3000;
  const ranges: [number, number][] = [];
  for (let s = 0; s < m; s += chunk) ranges.push([s, Math.min(m, s + chunk)]);
  /** Spreads per-carrier values, `width` numbers each, to every vertex. */
  const spread = (from: Float32Array, to: Float32Array, width: number, scaled: boolean) => {
    for (let i = 0; i < n; i++) {
      const c = slot[input.source[i]] * width;
      const k = scaled ? input.scale[i] : 1;
      for (let j = 0; j < width; j++) to[i * width + j] = from[c + j] * k;
    }
  };

  try {
    onProgress('Preparing light bake', 0);
    const solid = withMasses(input);
    await pool.broadcast(() => ({
      msg: { type: 'init', positions: solid.positions.slice(), normals: input.normals.slice(), index: solid.index.slice(), lights: input.lights, firstMassVertex: n, carriers: carrierList.slice() },
    }));

    // Direct light, needed only as the source of the first bounce.
    const directC = new Float32Array(m * 3);
    const sunVisC = new Float32Array(m);
    const keptC = new Float32Array(m * 12);
    let done = 0;
    await pool.run(
      ranges.map(([start, end]) => ({ type: 'direct', start, end, salt: 11 })),
      (r: { start: number; E: Float32Array; sunVis: Float32Array; kept: Float32Array }) => {
        directC.set(r.E, r.start * 3);
        keptC.set(r.kept, r.start * 12);
        sunVisC.set(r.sunVis, r.start);
        onProgress('Tracing direct light', ++done / ranges.length);
      },
    );
    const direct = new Float32Array(n * 3);
    const sunVis = new Float32Array(n);
    spread(directC, direct, 3, true);
    spread(sunVisC, sunVis, 1, false);
    const kept = new Float32Array(n * 12);
    spread(keptC, kept, 12, true);

    const sh = new Float32Array(n * 12);
    const skyVis = new Float32Array(n);
    const skyVisC = new Float32Array(m);
    const validC = new Uint8Array(m);
    const indirect = new Float32Array(n * 3);
    const radiosity = new Float32Array(n * 3);

    for (let bounce = 0; bounce < input.bounces; bounce++) {
      for (let i = 0; i < n * 3; i++) radiosity[i] = ((direct[i] + indirect[i]) * input.albedo[i]) / Math.PI;
      await pool.broadcast(() => ({ msg: { type: 'radiosity', radiosity: radiosity.slice() } }));
      done = 0;
      const shC = new Float32Array(m * 12);
      await pool.run(
        ranges.map(([start, end]) => ({ type: 'gather', start, end, rays: input.rays, salt: 101 + bounce * 13 })),
        (r: { start: number; sh: Float32Array; skyVis: Float32Array; valid: Uint8Array }) => {
          shC.set(r.sh, r.start * 12);
          skyVisC.set(r.skyVis, r.start);
          validC.set(r.valid, r.start);
          onProgress(`Gathering bounced light, pass ${bounce + 1} of ${input.bounces}`, ++done / ranges.length);
        },
      );
      spread(smooth(input, carrierList, shC, validC), sh, 12, true);
      spread(skyVisC, skyVis, 1, false);
      for (let i = 0; i < n; i++) {
        const nx = input.normals[i * 3], ny = input.normals[i * 3 + 1], nz = input.normals[i * 3 + 2];
        for (let c = 0; c < 3; c++) {
          const o = i * 12 + c * 4;
          indirect[i * 3 + c] = Math.max(0, sh[o] + sh[o + 1] * nx + sh[o + 2] * ny + sh[o + 3] * nz);
        }
      }
      // Direct light from lamps that nothing else draws goes in last, after it has served as a
      // source of bounces, so that it is not counted twice.
      for (let i = 0; i < n * 12; i++) sh[i] += kept[i];
      if (onPartial && bounce < input.bounces - 1) onPartial({ sh: sh.slice(), skyVis, sunVis });
    }
    return { sh, skyVis, sunVis };
  } finally {
    pool.dispose();
  }
}

/** Appends the solid masses to the geometry as boxes, after all real vertices. */
function withMasses(input: BakeInput): { positions: Float32Array; index: Uint32Array } {
  const boxes = input.masses.length / 6;
  const n = input.positions.length / 3;
  const positions = new Float32Array(input.positions.length + boxes * 24);
  const index = new Uint32Array(input.index.length + boxes * 36);
  positions.set(input.positions);
  index.set(input.index);
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (let b = 0; b < boxes; b++) {
    const m = input.masses.subarray(b * 6, b * 6 + 6);
    for (let c = 0; c < 8; c++) {
      const o = input.positions.length + (b * 8 + c) * 3;
      positions[o] = m[c & 1 ? 3 : 0];
      positions[o + 1] = m[c & 2 ? 4 : 1];
      positions[o + 2] = m[c & 4 ? 5 : 2];
    }
    quads.forEach((q, k) => {
      const o = input.index.length + b * 36 + k * 6;
      const v = q.map((c) => n + b * 8 + c);
      index.set([v[0], v[1], v[2], v[0], v[2], v[3]], o);
    });
  }
  return { positions, index };
}

/**
 * Removes sampling noise by averaging each traced vertex with close neighbours that face the same
 * way, and fills vertices buried inside other geometry from visible neighbours. Works on the
 * traced vertices only; `sh` and `valid` are indexed by position in `carriers`.
 */
function smooth(input: BakeInput, carriers: Uint32Array, sh: Float32Array, valid: Uint8Array): Float32Array {
  const { positions: p, normals: nr } = input;
  const m = carriers.length;
  const cell = 0.25;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
  for (let k = 0; k < m; k++) {
    if (valid[k] !== 1) continue;
    const i = carriers[k];
    const h = key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    let list = grid.get(h);
    if (!list) grid.set(h, (list = []));
    list.push(k);
  }
  const out = new Float32Array(sh.length);
  const acc = new Float64Array(12);
  for (let k = 0; k < m; k++) {
    const i = carriers[k];
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const radius = valid[k] === 1 ? 0.42 : 0.6;
    const r2 = radius * radius;
    const reach = Math.ceil(radius / cell);
    acc.fill(0);
    let wsum = 0;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
      const list = grid.get(((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791));
      if (!list) continue;
      for (const q of list) {
        const j = carriers[q];
        const ex = p[j * 3] - x, ey = p[j * 3 + 1] - y, ez = p[j * 3 + 2] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > r2) continue;
        const nd = nr[i * 3] * nr[j * 3] + nr[i * 3 + 1] * nr[j * 3 + 1] + nr[i * 3 + 2] * nr[j * 3 + 2];
        if (nd < 0.75) continue;
        const w = (1 - d2 / r2) * nd + 1e-4;
        for (let c = 0; c < 12; c++) acc[c] += sh[q * 12 + c] * w;
        wsum += w;
      }
    }
    if (wsum > 0) for (let c = 0; c < 12; c++) out[k * 12 + c] = acc[c] / wsum;
    else for (let c = 0; c < 12; c++) out[k * 12 + c] = sh[k * 12 + c];
  }
  return out;
}
