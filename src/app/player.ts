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

export class Player {
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Movement from an analogue stick: x right, y back, length up to 1. */
  readonly analog = new Vector2();
  analogRun = false;
  private jumpQueued = false;
  private velocity = new Vector3();
  private onGround = false;
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
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
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
    const speed = run ? 6.5 : 3.2;
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
    if (this.position.y < -8) {
      this.position.copy(this.spawn);
      this.velocity.set(0, 0, 0);
    }
    this.syncCamera();
  }

  private step(dt: number): void {
    this.velocity.y += (this.onGround ? -2 : -GRAVITY) * dt;
    this.position.addScaledVector(this.velocity, dt);

    const seg = this.segment;
    seg.start.set(this.position.x, this.position.y + RADIUS, this.position.z);
    seg.end.set(this.position.x, this.position.y + HEIGHT - RADIUS, this.position.z);
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

    const delta = seg.start.clone().sub(before);
    this.onGround = delta.y > Math.abs(dt * this.velocity.y * 0.25);
    this.position.add(delta);
    if (this.onGround) {
      this.velocity.y = Math.max(0, this.velocity.y);
    } else if (delta.lengthSq() > 1e-10) {
      // Remove the part of the velocity that points into what was hit.
      delta.normalize();
      this.velocity.addScaledVector(delta, -Math.min(0, delta.dot(this.velocity)));
    }
  }

  private syncCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + EYE, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
