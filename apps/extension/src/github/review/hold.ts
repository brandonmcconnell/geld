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
/** The last correction and how many times in a row it has been the same one (see `applyHold`). */
let lastDelta = 0;
let repeats = 0;
/** The same correction this many times in a row means something else keeps scrolling the page: let it. */
const MAX_REPEATS = 3;

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

function release(): void {
  hold = null;
  repeats = 0;
}

function userRelease(): void {
  userMoved = true;
  release();
}

function install(): void {
  if (installed) return;
  installed = true;
  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('wheel', userRelease, options);
  window.addEventListener('touchstart', userRelease, options);
  window.addEventListener('mousedown', userRelease, options);
  window.addEventListener(
    'keydown',
    (event) => {
      if (SCROLL_KEYS.has(event.key) && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) userRelease();
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
  userMoved = false;
  const element = elementOf(key);
  if (element === null) {
    hold = null;
    return;
  }
  hold = { key, top: element.getBoundingClientRect().top };
  repeats = 0;
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
    if (Math.abs(delta) <= 1) return;
    // The same correction again and again means another scroller (the browser's fragment anchor while the page
    // loads, a script of GitHub's) insists on its position: a tug of war the reader sees as the page jumping.
    // It wins; the hold ends.
    if (Math.abs(delta - lastDelta) <= 2) {
      repeats += 1;
      if (repeats >= MAX_REPEATS) {
        release();
        return;
      }
    } else {
      repeats = 0;
    }
    lastDelta = delta;
    window.scrollBy({ top: delta, behavior: 'instant' });
  });
}

/**
 * Whether the reader has scrolled by their own hand since the last hold began.
 * The landing's final correction after load (overview.ts) must not run once
 * the reader has moved the page themselves, but the hold also releases on its
 * own when another scroller wins the tug of war (`MAX_REPEATS`), which is not
 * the reader — so that path is told apart here.
 */
let userMoved = false;

/** True until the next `holdRow`: the reader scrolled by hand (wheel, touch, key, mouse) since the last hold began. */
export function readerScrolled(): boolean {
  return userMoved;
}

let onPanelResize: (() => void) | null = null;

/**
 * Watch `panel` for size changes (late content inside a slot) and correct the
 * held row after each; `onResize` runs first, in the same callback, for work
 * that must see the new layout before the correction (the permalink's anchor
 * margins, which the browser reads on its very next layout).
 */
export function watchPanelForHold(panel: Element, onResize: (() => void) | null = null): void {
  if (typeof ResizeObserver === 'undefined') return;
  onPanelResize = onResize;
  panelObserver ??= new ResizeObserver(() => {
    onPanelResize?.();
    applyHold();
  });
  panelObserver.disconnect();
  panelObserver.observe(panel);
}

export function releaseHold(): void {
  hold = null;
  panelObserver?.disconnect();
}
