/**
 * Touch for the walk, after the game's own (`src/app/touch.ts`): a thumb stick that appears wherever
 * the left of the screen is touched (pushed well past its rim, it runs), looking about by dragging on
 * the right, and buttons to fly, to rise and sink while flying, and to go on to the next place. The
 * game's drives its player; this one leaves what it reads in `move` for the walk to use each frame.
 */

const STICK_RADIUS = 56;
const RUN_AT = 1.45;
const LOOK_SPEED = 0.0042;

export interface WalkActions {
  /** Turns the head: yaw and pitch, in radians. */
  look: (dYaw: number, dPitch: number) => void;
  /** Starts or stops flying; says whether one now flies. */
  fly: () => boolean;
  /** Goes on to the next place. */
  next: () => void;
}

export class WalkTouch {
  /** What the thumbs ask for: across (right) and back, each to 1 at most; whether to run; and up or down while flying, 1 to -1. */
  readonly move = { x: 0, y: 0, run: false, rise: 0 };
  private moveId = -1;
  private lookId = -1;
  private originX = 0;
  private originY = 0;
  private lastX = 0;
  private lastY = 0;
  private base: HTMLElement;
  private knob: HTMLElement;
  private flyButton: HTMLButtonElement;

  constructor(dom: HTMLElement, actions: WalkActions) {
    this.base = document.createElement('div');
    this.base.id = 'stick';
    this.knob = document.createElement('div');
    this.knob.id = 'knob';
    this.base.appendChild(this.knob);
    const button = (id: string, text: string, label: string) => {
      const b = document.createElement('button');
      b.id = id; b.type = 'button'; b.textContent = text; b.className = 'pad';
      b.setAttribute('aria-label', label);
      return b;
    };
    this.flyButton = button('fly', 'Fly', 'Fly or walk');
    this.flyButton.setAttribute('aria-pressed', 'false');
    const up = button('up', 'Up', 'Rise'), down = button('down', 'Down', 'Sink'), next = button('next', 'Next', 'Go to the next place');
    document.body.append(this.base, this.flyButton, up, down, next);
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) document.body.classList.add('touch');

    const tapped = () => document.body.classList.add('touch', 'touched');
    this.flyButton.addEventListener('pointerdown', (e) => { e.preventDefault(); tapped(); this.flying(actions.fly()); });
    next.addEventListener('pointerdown', (e) => { e.preventDefault(); tapped(); actions.next(); });
    // Up and down are held, not tapped: they work for as long as a finger stays on them.
    for (const [b, rise] of [[up, 1], [down, -1]] as const) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); tapped(); b.setPointerCapture(e.pointerId); this.move.rise = rise; });
      const stop = () => { if (this.move.rise === rise) this.move.rise = 0; };
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('lostpointercapture', stop);
    }

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      tapped();
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
        actions.look(-(e.clientX - this.lastX) * LOOK_SPEED, -(e.clientY - this.lastY) * LOOK_SPEED);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.moveId) {
        this.moveId = -1;
        this.base.classList.remove('on', 'run');
        this.move.x = this.move.y = 0;
        this.move.run = false;
      } else if (e.pointerId === this.lookId) {
        this.lookId = -1;
      }
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Shows whether one flies, on the button and in the page (Up and Down are shown only then). */
  flying(on: boolean): void {
    this.flyButton.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('flying', on);
    if (!on) this.move.rise = 0;
  }

  private setStick(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy), reach = dist / STICK_RADIUS, scale = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    // (A small dead zone, so that a resting thumb does not creep.)
    const amount = reach < 0.12 ? 0 : Math.min(1, reach), inv = dist > 0 ? amount / dist : 0;
    this.move.x = dx * inv;
    this.move.y = dy * inv;
    this.move.run = reach > RUN_AT;
    this.base.classList.toggle('run', this.move.run);
  }
}
