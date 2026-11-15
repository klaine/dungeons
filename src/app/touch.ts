import { Player } from './player';

/**
 * Touch controls: a thumb stick that appears wherever the left side of the screen is touched,
 * look by dragging on the right side, and a jump button. Pushing the stick well past its rim runs.
 */

const STICK_RADIUS = 56;
const RUN_AT = 1.45;
const LOOK_SPEED = 0.0042;

export class TouchControls {
  private moveId = -1;
  private lookId = -1;
  private originX = 0;
  private originY = 0;
  private lastX = 0;
  private lastY = 0;
  private base: HTMLElement;
  private knob: HTMLElement;

  constructor(private dom: HTMLElement, private player: Player) {
    this.base = document.createElement('div');
    this.base.id = 'stick';
    this.knob = document.createElement('div');
    this.knob.id = 'knob';
    this.base.appendChild(this.knob);
    const jump = document.createElement('button');
    jump.id = 'jump';
    jump.type = 'button';
    jump.textContent = 'Jump';
    jump.setAttribute('aria-label', 'Jump');
    document.body.append(this.base, jump);

    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) document.body.classList.add('touch');

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      document.body.classList.add('touch', 'touched');
      if (e.clientX < window.innerWidth * 0.45 && this.moveId < 0) {
        this.moveId = e.pointerId;
        this.originX = e.clientX;
        this.originY = e.clientY;
        this.base.style.left = `${e.clientX}px`;
        this.base.style.top = `${e.clientY}px`;
        this.base.classList.add('on');
        this.setStick(0, 0);
      } else if (this.lookId < 0) {
        this.lookId = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else {
        return;
      }
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.moveId) {
        this.setStick(e.clientX - this.originX, e.clientY - this.originY);
      } else if (e.pointerId === this.lookId) {
        player.look(-(e.clientX - this.lastX) * LOOK_SPEED, -(e.clientY - this.lastY) * LOOK_SPEED);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId === this.moveId) {
        this.moveId = -1;
        this.base.classList.remove('on', 'run');
        player.analog.set(0, 0);
        player.analogRun = false;
      } else if (e.pointerId === this.lookId) {
        this.lookId = -1;
      }
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.body.classList.add('touch', 'touched');
      player.jump();
    });
  }

  private setStick(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    const reach = dist / STICK_RADIUS;
    const scale = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    // A small dead zone so a resting thumb does not creep.
    const amount = reach < 0.12 ? 0 : Math.min(1, reach);
    const inv = dist > 0 ? amount / dist : 0;
    this.player.analog.set(dx * inv, dy * inv);
    this.player.analogRun = reach > RUN_AT;
    this.base.classList.toggle('run', this.player.analogRun);
  }
}
