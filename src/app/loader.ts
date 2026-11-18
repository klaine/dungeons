/**
 * The loading screen. Making a place takes ten seconds or more, nearly all of it in one thread; left alone the page would
 * freeze and the browser would offer to close it. So the work is cut into steps, and between steps this lets the browser
 * paint what has been done and answer anything the person does.
 */
const root = document.getElementById('loader');
const labelEl = document.getElementById('loaderLabel');
const detailEl = document.getElementById('loaderDetail');
const barEl = document.getElementById('loaderBar');
const timeEl = document.getElementById('loaderTime');

const started = performance.now();
let shown = 0;
let lastYield = performance.now();

/** Lets the browser paint and handle input. Cheap to call often: it only really waits if some time has passed since the last. */
export async function breathe(force = false): Promise<void> {
  const now = performance.now();
  if (!force && now - lastYield < 40) return;
  // A frame callback is the surest moment for a paint, but is not delivered to a page in the background; a timer then stands in.
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 60);
  });
  lastYield = performance.now();
}

/** Says what is being done and how far along the whole job is (0 to 1), then lets the page draw it. */
export async function stage(label: string, at: number, detail = ''): Promise<void> {
  // The bar only goes forward: stages that estimate their own share must not make it step back.
  shown = Math.max(shown, Math.min(1, at));
  if (labelEl) labelEl.textContent = label;
  if (detailEl) detailEl.textContent = detail;
  if (barEl) barEl.style.transform = `scaleX(${shown})`;
  if (timeEl) timeEl.textContent = `${((performance.now() - started) / 1000).toFixed(0)} s`;
  await breathe();
}

/** Maps a stage of some part of the work (0 to 1) onto its share of the whole. */
export function share(from: number, to: number) {
  return (f: number) => from + (to - from) * f;
}

/** Takes the screen away, with a short fade. */
export function finish(): void {
  if (!root) return;
  root.classList.add('gone');
  document.body.classList.remove('loading');
  setTimeout(() => { root.hidden = true; }, 600);
}

/** Replaces the label with a failure, and leaves the screen up. */
export function fail(message: string): void {
  if (labelEl) labelEl.textContent = message;
  if (detailEl) detailEl.textContent = 'Reloading the page may help; ?quality=low asks for less.';
  root?.classList.add('failed');
}
