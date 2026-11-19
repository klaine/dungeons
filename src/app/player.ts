import { Box3, Line3, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * First-person walking: gravity and a capsule that slides along the site geometry. Mouse and keyboard
 * are handled here; other inputs (touch) drive it through `analog`, `look` and `jump`.
 */

const RADIUS = 0.28;
const HEIGHT = 1.8;
const EYE = 1.68;
const GRAVITY = 22;
/** The highest step taken in a stride. Steps up to about 0.17 are ridden up by the round foot alone; this is for the rest. */
const STEP_UP = 0.34;
/** How long a stride is tried when stepping up: see `stepUp`. */
const STEP_REACH = 0.16;

export class Player {
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Movement from an analogue stick: x right, y back, length up to 1. */
  readonly analog = new Vector2();
  analogRun = false;
  /**
   * Flying: no weight and nothing solid, moving the way one looks. For seeing a place whole, and
   * for taking pictures of it from where no one could stand. `V` turns it on and off.
   */
  flying = false;
  /** Below this the player has fallen out of the world, and is put back where they came in. Lower where there is ground far down: a hall under the hill, a chasm. */
  fallTo = -8;
  /** Boxes that stop the player while active, such as shut doors. */
  readonly blockers: { min: Vector3; max: Vector3; active: boolean }[] = [];
  private jumpQueued = false;
  private velocity = new Vector3();
  private onGround = false;
  /** Whether the player is standing on something, and whether they are running: for footsteps. */
  get grounded(): boolean { return this.onGround; }
  running = false;
  private keys = new Set<string>();
  private spawn = new Vector3();
  private segment = new Line3();
  private box = new Box3();
  private triPoint = new Vector3();
  private capPoint = new Vector3();

  constructor(private camera: PerspectiveCamera, private dom: HTMLElement, private bvh: MeshBVH) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.locked) dom.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      document.body.classList.toggle('walking', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.look(-e.movementX * 0.0022, -e.movementY * 0.0022);
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyV' && !e.repeat) this.fly(!this.flying);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dPitch));
  }

  jump(): void {
    this.jumpQueued = true;
  }

  /** Takes to the air, or comes down: on landing the player drops from wherever they are. */
  fly(on: boolean): void {
    this.flying = on;
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    document.body.classList.toggle('flying', on);
  }

  /** Places the player with their eyes at `eye`. */
  place(eye: Vector3, yaw: number, pitch = 0): void {
    this.position.set(eye.x, eye.y - EYE, eye.z);
    this.spawn.copy(this.position);
    this.yaw = yaw;
    this.pitch = pitch;
    this.velocity.set(0, 0, 0);
    this.syncCamera();
  }

  update(dt: number): void {
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.analogRun;
    if (this.flying) {
      this.flyBy(dt, run);
      return;
    }
    const speed = run ? 6.5 : 3.2;
    this.running = run;
    let fx = 0, fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    const keyLen = Math.hypot(fx, fz) || 1;
    fx = fx / keyLen + this.analog.x;
    fz = fz / keyLen + this.analog.y;
    const len = Math.max(1, Math.hypot(fx, fz));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ((fx * cos + fz * sin) / len) * speed;
    const wz = ((-fx * sin + fz * cos) / len) * speed;
    // Ease towards the wanted velocity so starts and stops are not abrupt.
    const k = 1 - Math.exp(-dt * (this.onGround ? 14 : 3));
    this.velocity.x += (wx - this.velocity.x) * k;
    this.velocity.z += (wz - this.velocity.z) * k;
    if (this.onGround && (this.keys.has('Space') || this.jumpQueued)) {
      this.velocity.y = 5.2;
      this.onGround = false;
    }
    this.jumpQueued = false;

    const steps = 4;
    for (let i = 0; i < steps; i++) this.step(dt / steps);
    if (this.position.y < this.fallTo) {
      this.position.copy(this.spawn);
      this.velocity.set(0, 0, 0);
    }
    this.syncCamera();
  }

  /** Moving while flying: forward is where the eye points, up and down included; Space rises, C sinks. */
  private flyBy(dt: number, fast: boolean): void {
    let fx = 0, fz = 0, up = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    if (this.keys.has('Space') || this.jumpQueued) up += 1;
    if (this.keys.has('KeyC')) up -= 1;
    this.jumpQueued = false;
    fx += this.analog.x; fz += this.analog.y;
    const speed = fast ? 28 : 9;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    // Forward is along the line of sight; sideways stays level.
    const wx = (fx * cy + fz * sy * cp) * speed, wy = (-fz * sp + up) * speed, wz = (-fx * sy + fz * cy * cp) * speed;
    const k = 1 - Math.exp(-dt * 10);
    this.velocity.x += (wx - this.velocity.x) * k;
    this.velocity.y += (wy - this.velocity.y) * k;
    this.velocity.z += (wz - this.velocity.z) * k;
    this.position.addScaledVector(this.velocity, dt);
    this.onGround = false;
    this.running = false;
    this.syncCamera();
  }

  /**
   * Pushes a body standing at `at` out of whatever it is in: the site, and shut doors. Returns
   * how far it had to go. `from` is where it stood before, which says which way to leave a door
   * that it has got inside.
   */
  private pushOut(at: Vector3, from: Vector3): Vector3 {
    const seg = this.segment;
    seg.start.set(at.x, at.y + RADIUS, at.z);
    seg.end.set(at.x, at.y + HEIGHT - RADIUS, at.z);
    const before = seg.start.clone();
    this.box.makeEmpty();
    this.box.expandByPoint(seg.start);
    this.box.expandByPoint(seg.end);
    this.box.min.addScalar(-RADIUS);
    this.box.max.addScalar(RADIUS);

    this.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(this.box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, this.triPoint, this.capPoint);
        if (d < RADIUS) {
          const push = this.capPoint.sub(this.triPoint).normalize().multiplyScalar(RADIUS - d);
          seg.start.add(push);
          seg.end.add(push);
        }
        return false;
      },
    });

    // Shut doors and the like: push the body out sideways.
    for (const b of this.blockers) {
      if (!b.active || seg.start.y - RADIUS > b.max.y || seg.end.y + RADIUS < b.min.y) continue;
      const nx = Math.min(b.max.x, Math.max(b.min.x, seg.start.x));
      const nz = Math.min(b.max.z, Math.max(b.min.z, seg.start.z));
      let dx = seg.start.x - nx, dz = seg.start.z - nz;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d < 1e-5) {
        // Inside the box: leave by the nearer face across its thin dimension.
        const thinX = b.max.x - b.min.x < b.max.z - b.min.z;
        const mid = thinX ? (b.min.x + b.max.x) / 2 : (b.min.z + b.max.z) / 2;
        const out = (thinX ? from.x : from.z) >= mid ? 1 : -1;
        const half = (thinX ? b.max.x - b.min.x : b.max.z - b.min.z) / 2 + RADIUS;
        if (thinX) { dx = mid + out * half - seg.start.x; dz = 0; } else { dz = mid + out * half - seg.start.z; dx = 0; }
        seg.start.x += dx; seg.end.x += dx; seg.start.z += dz; seg.end.z += dz;
      } else {
        const push = (RADIUS - d) / d;
        seg.start.x += dx * push; seg.end.x += dx * push; seg.start.z += dz * push; seg.end.z += dz * push;
      }
    }
    return seg.start.clone().sub(before);
  }

  private step(dt: number): void {
    const start = this.position.clone(), wasGround = this.onGround, wantX = this.velocity.x, wantZ = this.velocity.z;
    this.velocity.y += (this.onGround ? -2 : -GRAVITY) * dt;
    this.position.addScaledVector(this.velocity, dt);

    const delta = this.pushOut(this.position, start);
    // Standing needs something reasonably level underfoot; a face steeper than about sixty
    // degrees pushes sideways more than up, and is a wall to slide off, not ground to climb.
    this.onGround = delta.y > Math.abs(dt * this.velocity.y * 0.25) && delta.y > delta.length() * 0.45;
    this.position.add(delta);
    if (this.onGround) {
      this.velocity.y = Math.max(0, this.velocity.y);
    } else if (delta.lengthSq() > 1e-10) {
      // Remove the part of the velocity that points into what was hit.
      delta.normalize();
      this.velocity.addScaledVector(delta, -Math.min(0, delta.dot(this.velocity)));
    }
    if (wasGround) this.stepUp(start, wantX * dt, wantZ * dt);
  }

  /**
   * Stepping up. The round foot of the body rides up a step of a hand and a half by itself; a
   * higher one stops it dead, though anyone would step onto it without thinking. So when a body
   * on its feet is stopped going forward, it tries the move again from a step higher, and if it
   * gets on that way, and there is ground under it there, it stands on that ground.
   */
  private stepUp(start: Vector3, wx: number, wz: number): void {
    const want = Math.hypot(wx, wz);
    if (want < 1e-4) return;
    const along = (p: Vector3) => ((p.x - start.x) * wx + (p.z - start.z) * wz) / want;
    if (along(this.position) > want * 0.6) return;
    // The foot is round, and the edge of a step stops it while its middle is still a hand's
    // breadth short of that edge. So the stride tried from higher up is a longer one, long
    // enough to bring the middle of the foot nearly over the edge.
    const reach = Math.max(want, STEP_REACH), k = reach / want;
    // (Under a low ceiling, as at the foot of a steep stair, a stride a whole step higher strikes it; then one a little over the
    // highest step there is, which still clears an ordinary stair's riser.)
    for (const rise of [STEP_UP, 0.25]) if (this.tryStep(start, wx * k, wz * k, rise, reach, want, along)) return;
  }

  /** Tries the stride from `rise` higher: see `stepUp`. Whether the body was put on what it met. */
  private tryStep(start: Vector3, dx: number, dz: number, rise: number, reach: number, want: number, along: (p: Vector3) => number): boolean {
    const up = start.clone().add(new Vector3(dx, rise, dz));
    up.add(this.pushOut(up, start));
    if (along(up) < reach * 0.8) return false;
    // Then it is let down a little at a time until it meets something, so that what it meets is
    // met from above: let down all at once it would be deep in the step's edge, and be pushed
    // back out of its face instead of up onto its top.
    const down = up.clone();
    let lift: Vector3 | null = null;
    // (A graze is not a footing: where the foot only just touches, as it may on the edge of a step when let down by whole
    // steps of four centimetres, it is let down further, until it meets the step firmly. Taking the graze for the footing, and then
    // refusing it as too slight to stand on, had made whether a stair could be climbed depend on how its rise fell against those
    // four centimetres: a body climbed one flight and stood stuck at the second step of the next.)
    for (let fall = 0; fall < rise + 0.06 && !lift; fall += 0.04) {
      down.y -= 0.04;
      const push = this.pushOut(down, up);
      if (push.lengthSq() > 0.004 * 0.004) lift = push;
    }
    // (Onto something that can be stood on: a step, not the edge of a wall.)
    if (!lift || lift.y < 0.004 || lift.y < Math.hypot(lift.x, lift.z) * 1.5) return false;
    down.add(lift);
    if (down.y < start.y + 0.02 || along(down) < want * 0.5) return false;
    this.position.copy(down);
    this.onGround = true;
    this.velocity.y = 0;
    return true;
  }

  private syncCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + EYE, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
