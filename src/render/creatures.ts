import { BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Object3D, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Rng } from '../core/rng';
import { makeCreatureMaterial } from './siteMaterial';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { float, length, smoothstep, uv, vec4 } = TSL as N;

/** Where a flock grazes: about a point, within `r` metres of it, `count` of them. */
export interface FlockSpot { x: number; z: number; r: number; count: number }

/**
 * Sheep. Hill sheep of the black-faced kind, white in the fleece, black in the face and legs, as on the islands and in the hill
 * country. Each grazes where it stands with its head down, now and then lifts it, and every so often wanders a few strides to
 * fresh grass, never far from the rest; whoever comes within a few strides sends it trotting off, and it settles again further
 * away. They are drawn as two meshes of many copies each, one for the body and one for the head, so that a flock costs two draws;
 * where each stands and how its head hangs is worked out each frame from a little state of its own. Nothing is stopped by them.
 */
export class Flocks {
  readonly group = new Group();
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly sheep: {
    x: number; z: number; heading: number; turnTo: number; speed: number; head: number; headTo: number;
    mode: 'graze' | 'walk' | 'flee'; timer: number; tx: number; tz: number; flock: number; size: number; bob: number;
  }[] = [];
  private readonly flocks: { x: number; z: number; r: number; grid: Float32Array; x0: number; z0: number; n: number; ok: Uint8Array }[] = [];
  private readonly rng: Rng;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly o = new Object3D();

  /**
   * `groundAt` says how high the ground is at a point; `free` whether a sheep may stand there (not in water, on a track's stones,
   * in a house). The ground under each flock is read once, on a lattice a metre apart, and kept.
   */
  constructor(spots: FlockSpot[], seed: string, groundAt: (x: number, z: number) => number, free: (x: number, z: number) => boolean) {
    this.rng = new Rng(`flocks/${seed}`);
    const r = this.rng;
    for (const spot of spots) {
      // The ground the flock may wander over, with a margin: a metre apart, and whether each point is fit to stand on.
      const reach = spot.r + 10, n = Math.ceil(reach * 2) + 1, x0 = spot.x - reach, z0 = spot.z - reach;
      const grid = new Float32Array(n * n), ok = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = groundAt(x0 + i, z0 + j);
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i, slope = Math.max(Math.abs(grid[k + 1] - grid[k - 1]), Math.abs(grid[k + n] - grid[k - n])) / 2;
        // (Not up anything steeper than a sheep path goes, nor where there is no ground.)
        ok[k] = slope < 0.55 && grid[k] > -500 && free(x0 + i, z0 + j) ? 1 : 0;
      }
      const f = this.flocks.length;
      this.flocks.push({ x: spot.x, z: spot.z, r: spot.r, grid, x0, z0, n, ok });
      for (let c = 0; c < spot.count; c++) {
        let x = spot.x, z = spot.z;
        for (let tries = 0; tries < 30; tries++) {
          const a = r.range(0, Math.PI * 2), d = Math.sqrt(r.next()) * spot.r * 0.7;
          if (this.fit(f, spot.x + Math.cos(a) * d, spot.z + Math.sin(a) * d)) { x = spot.x + Math.cos(a) * d; z = spot.z + Math.sin(a) * d; break; }
        }
        const heading = r.range(0, Math.PI * 2);
        this.sheep.push({ x, z, heading, turnTo: heading, speed: 0, head: 0.9, headTo: 0.9, mode: 'graze', timer: r.range(2, 14), tx: x, tz: z, flock: f, size: r.range(0.88, 1.1), bob: r.range(0, 10) });
      }
    }
    const count = Math.max(1, this.sheep.length);
    const material = makeCreatureMaterial();
    this.bodies = new InstancedMesh(bodyGeometry(), material, count);
    this.heads = new InstancedMesh(headGeometry(), material, count);
    // A soft dark patch under each, where the sky's light is kept off the grass: what sets a thing on the ground and not over it.
    const shadowMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    shadowMaterial.colorNode = vec4(0, 0, 0, float(0.42).mul(smoothstep(0.5, 0.12, length(uv().sub(0.5)))));
    const disc = new PlaneGeometry(1.5, 1.0);
    disc.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(disc, shadowMaterial, count);
    this.shadows.renderOrder = 1;
    // Each fleece a little its own: cream, greyer, browner with peat, and the odd one darker.
    const tint = new Color();
    this.sheep.forEach((_, i) => {
      const k = r.next(), t = r.range(0.86, 1.06);
      if (k < 0.08) tint.setRGB(0.42 * t, 0.36 * t, 0.3 * t);
      else if (k < 0.3) tint.setRGB(0.9 * t, 0.86 * t, 0.76 * t);
      else tint.setRGB(t, 0.97 * t, 0.9 * t);
      this.bodies.setColorAt(i, tint);
      this.heads.setColorAt(i, new Color(1, 1, 1));
    });
    for (const mesh of [this.bodies, this.heads, this.shadows]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.group.name = `sheep:${this.sheep.length}`;
    this.update(0, 0, new Vector3(1e9, 0, 1e9));
  }

  get count(): number { return this.sheep.length; }

  /** The ground at a point of flock `f`'s lattice, between its points. */
  private heightAt(f: number, x: number, z: number): number {
    const fl = this.flocks[f], fx = Math.min(fl.n - 1.001, Math.max(0, x - fl.x0)), fz = Math.min(fl.n - 1.001, Math.max(0, z - fl.z0));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, g = fl.grid, n = fl.n;
    return (g[j * n + i] * (1 - tx) + g[j * n + i + 1] * tx) * (1 - tz) + (g[(j + 1) * n + i] * (1 - tx) + g[(j + 1) * n + i + 1] * tx) * tz;
  }

  /** Whether a sheep of flock `f` may stand at a point. */
  private fit(f: number, x: number, z: number): boolean {
    const fl = this.flocks[f], i = Math.round(x - fl.x0), j = Math.round(z - fl.z0);
    if (i < 1 || j < 1 || i >= fl.n - 1 || j >= fl.n - 1) return false;
    return fl.ok[j * fl.n + i] === 1;
  }

  update(dt: number, time: number, player: Vector3): void {
    const r = this.rng;
    dt = Math.min(dt, 0.1);
    this.sheep.forEach((sh, i) => {
      const fl = this.flocks[sh.flock];
      const near = Math.hypot(player.x - sh.x, player.z - sh.z);
      // Whoever comes within a few strides is trotted away from; and not let near again until they have gone some way off.
      if (near < 6.5 && sh.mode !== 'flee') {
        const away = Math.atan2(sh.z - player.z, sh.x - player.x) + r.range(-0.5, 0.5);
        for (let tries = 0; tries < 8; tries++) {
          const d = r.range(8, 13), tx = sh.x + Math.cos(away) * d, tz = sh.z + Math.sin(away) * d;
          if (this.fit(sh.flock, tx, tz) && Math.hypot(tx - fl.x, tz - fl.z) < fl.r + 8) { sh.tx = tx; sh.tz = tz; sh.mode = 'flee'; break; }
        }
      }
      sh.timer -= dt;
      if (sh.mode === 'graze') {
        // Head down, cropping; now and then it lifts it and looks about, and turns where it stands.
        if (sh.timer < 0) {
          if (r.chance(0.45)) {
            // Off to fresh grass a few strides away, towards the rest of the flock if it has strayed.
            for (let tries = 0; tries < 10; tries++) {
              const a = r.range(0, Math.PI * 2), d = r.range(2, 7), back = Math.hypot(sh.x - fl.x, sh.z - fl.z) > fl.r * 0.7 ? 0.5 : 0;
              const tx = sh.x + Math.cos(a) * d + (fl.x - sh.x) * back * 0.3, tz = sh.z + Math.sin(a) * d + (fl.z - sh.z) * back * 0.3;
              if (this.fit(sh.flock, tx, tz) && Math.hypot(tx - fl.x, tz - fl.z) < fl.r) { sh.tx = tx; sh.tz = tz; sh.mode = 'walk'; break; }
            }
          } else {
            sh.headTo = r.chance(0.3) ? -0.15 : 0.9;
            sh.turnTo = sh.heading + r.range(-0.8, 0.8);
          }
          sh.timer = r.range(3, 14);
        }
      }
      if (sh.mode !== 'graze') {
        const dx = sh.tx - sh.x, dz = sh.tz - sh.z, d = Math.hypot(dx, dz);
        sh.turnTo = Math.atan2(dz, dx);
        sh.headTo = sh.mode === 'flee' ? -0.25 : 0.15;
        const want = sh.mode === 'flee' ? 2.3 : 0.55;
        sh.speed += (want - sh.speed) * Math.min(1, dt * 3);
        if (d < 0.4 || sh.timer < -20) { sh.mode = 'graze'; sh.timer = r.range(4, 12); sh.headTo = 0.9; }
      } else sh.speed *= Math.max(0, 1 - dt * 5);
      // Turn towards where it is going, not on the spot all at once.
      let turn = sh.turnTo - sh.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      sh.heading += turn * Math.min(1, dt * (sh.mode === 'flee' ? 5 : 2));
      // (Forward only as far as it faces the way: it does not slide sideways.)
      const forward = sh.speed * Math.max(0, Math.cos(turn));
      const nx = sh.x + Math.cos(sh.heading) * forward * dt, nz = sh.z + Math.sin(sh.heading) * forward * dt;
      if (this.fit(sh.flock, nx, nz)) { sh.x = nx; sh.z = nz; } else if (sh.mode !== 'graze') { sh.mode = 'graze'; sh.timer = r.range(2, 6); }
      sh.head += (sh.headTo - sh.head) * Math.min(1, dt * 2.5);
      // Stood on the ground, pitched to its slope from the front feet to the back.
      const len = 0.42 * sh.size, cx = Math.cos(sh.heading), cz = Math.sin(sh.heading);
      const yf = this.heightAt(sh.flock, sh.x + cx * len, sh.z + cz * len), yb = this.heightAt(sh.flock, sh.x - cx * len, sh.z - cz * len), y = (yf + yb) / 2;
      const pitch = Math.atan2(yf - yb, len * 2);
      const step = sh.speed > 0.1 ? Math.abs(Math.sin(time * (sh.mode === 'flee' ? 11 : 6) + sh.bob)) * 0.035 * Math.min(1, sh.speed) : 0;
      this.o.position.set(sh.x, y + step, sh.z);
      this.o.rotation.set(0, 0, 0);
      this.o.rotateY(-sh.heading + Math.PI / 2);
      this.o.rotateX(-pitch);
      this.o.scale.setScalar(sh.size);
      this.o.updateMatrix();
      this.bodies.setMatrixAt(i, this.o.matrix);
      // The head, at the front of the body, hung down to the grass or lifted.
      this.m.copy(this.o.matrix);
      this.q.setFromAxisAngle(this.v.set(1, 0, 0), sh.head);
      const headM = new Matrix4().compose(this.v.set(0, 0.62, 0.48), this.q, this.s.set(1, 1, 1));
      this.m.multiply(headM);
      this.heads.setMatrixAt(i, this.m);
      this.o.position.set(sh.x, y + 0.03, sh.z);
      this.o.rotation.set(0, -sh.heading + Math.PI / 2, 0);
      this.o.updateMatrix();
      this.shadows.setMatrixAt(i, this.o.matrix);
    });
    // A little apart from one another: two that come within a stride are eased apart.
    for (let a = 0; a < this.sheep.length; a++) for (let b = a + 1; b < this.sheep.length; b++) {
      const p = this.sheep[a], q = this.sheep[b];
      if (p.flock !== q.flock) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 1.0) {
        const push = (1.0 - d) * 0.5 * Math.min(1, dt * 4), ux = dx / d, uz = dz / d;
        if (this.fit(p.flock, p.x - ux * push, p.z - uz * push)) { p.x -= ux * push; p.z -= uz * push; }
        if (this.fit(q.flock, q.x + ux * push, q.z + uz * push)) { q.x += ux * push; q.z += uz * push; }
      }
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}

/** A lump of something, as a rounded shape scaled and placed, coloured. */
function lump(r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, colour: [number, number, number], rough = 0, seed = 1): BufferGeometry {
  const g = new IcosahedronGeometry(r, 2);
  const p = g.getAttribute('position') as BufferAttribute;
  // (Knobbly, as wool is: each point pushed out or in a little.)
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + rough * Math.sin(vx * 23.1 + seed) * Math.sin(vy * 19.7 + seed * 2) * Math.sin(vz * 21.3 + seed * 3);
    p.setXYZ(i, vx * sx * k + x, vy * sy * k + y, vz * sz * k + z);
  }
  g.computeVertexNormals();
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const shade = 0.92 + 0.08 * Math.sin(i * 1.7); c[i * 3] = colour[0] * shade; c[i * 3 + 1] = colour[1] * shade; c[i * 3 + 2] = colour[2] * shade; }
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A sheep's body, standing, facing +z, its feet at y = 0: the fleece, four legs and a short tail. */
function bodyGeometry(): BufferGeometry {
  const wool: [number, number, number] = [0.78, 0.75, 0.68], leg: [number, number, number] = [0.07, 0.065, 0.06];
  const parts = [
    lump(1, 0.3, 0.27, 0.48, 0, 0.62, 0, wool, 0.06, 1),
    lump(1, 0.24, 0.22, 0.22, 0, 0.7, 0.28, wool, 0.08, 2),
    lump(1, 0.25, 0.23, 0.24, 0, 0.66, -0.3, wool, 0.08, 3),
    lump(1, 0.12, 0.1, 0.12, 0, 0.6, -0.5, wool, 0.1, 4),
  ];
  for (const [x, z] of [[0.15, 0.3], [-0.15, 0.3], [0.15, -0.3], [-0.15, -0.3]]) parts.push(lump(1, 0.045, 0.24, 0.045, x, 0.24, z, leg, 0, 5));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** Its head, hinged at the neck (the origin), hanging forward along +z: a long black face, ears out to the sides, and a woolly poll. */
function headGeometry(): BufferGeometry {
  const face: [number, number, number] = [0.05, 0.045, 0.042], wool: [number, number, number] = [0.74, 0.71, 0.64];
  const parts = [
    lump(1, 0.09, 0.1, 0.1, 0, 0, 0.04, wool, 0.08, 6),
    lump(1, 0.075, 0.09, 0.17, 0, -0.02, 0.2, face, 0, 7),
    lump(1, 0.06, 0.016, 0.03, 0.11, 0.03, 0.12, face, 0, 8),
    lump(1, 0.06, 0.016, 0.03, -0.11, 0.03, 0.12, face, 0, 9),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}
