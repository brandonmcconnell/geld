/**
 * Hold a row where the reader put it. Opening a row is followed by content
 * that lands late (a review's threads fetched from GitHub, images in a
 * comment, another round streaming in above), and each arrival pushed the
 * row the reader had just opened down the page. From the moment a row opens
 * until the reader scrolls on their own, the row's top stays at the same
 * viewport position: whatever grows or shrinks above it is compensated with
 * an instant scroll, the same correction `keepInPlace` makes once at the
 * toggle, kept up for as long as the reader has not moved.
 *
 * The reader's own scrolling releases the hold: a wheel turn, a touch, a
 * scroll key, a mouse press (a scrollbar drag starts with one, and so does
 * the next click in the panel, which sets a hold of its own). Programmatic
 * scrolls, ours included, never release it, and a hold on a row that has
 * left the document ends by itself.
 */

interface Hold {
  readonly key: string;
  readonly top: number;
}

let hold: Hold | null = null;
let installed = false;
let frame: number | null = null;
let panelObserver: ResizeObserver | null = null;

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

function release(): void {
  hold = null;
}

function install(): void {
  if (installed) return;
  installed = true;
  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('wheel', release, options);
  window.addEventListener('touchstart', release, options);
  window.addEventListener('mousedown', release, options);
  window.addEventListener(
    'keydown',
    (event) => {
      if (SCROLL_KEYS.has(event.key) && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) release();
    },
    options,
  );
}

function elementOf(key: string): HTMLElement | null {
  const element = document.querySelector(`[data-geld-focus="${key}"]`);
  return element instanceof HTMLElement ? element : null;
}

/** Keep the row with focus key `key` where it is now (its current viewport top) until the reader scrolls. */
export function holdRow(key: string): void {
  install();
  const element = elementOf(key);
  if (element === null) {
    hold = null;
    return;
  }
  hold = { key, top: element.getBoundingClientRect().top };
}

/**
 * Put the held row back at its top, if something moved it. Called after
 * every pass and whenever the panel's size changes; a frame is coalesced so
 * a burst of arrivals is one correction.
 */
export function applyHold(): void {
  if (hold === null || frame !== null) return;
  frame = window.requestAnimationFrame(() => {
    frame = null;
    if (hold === null) return;
    const element = elementOf(hold.key);
    if (element === null) {
      hold = null;
      return;
    }
    const delta = element.getBoundingClientRect().top - hold.top;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
  });
}

/** Watch `panel` for size changes (late content inside a slot) and correct the held row after each. */
export function watchPanelForHold(panel: Element): void {
  if (typeof ResizeObserver === 'undefined') return;
  panelObserver ??= new ResizeObserver(() => applyHold());
  panelObserver.disconnect();
  panelObserver.observe(panel);
}

export function releaseHold(): void {
  hold = null;
  panelObserver?.disconnect();
}
