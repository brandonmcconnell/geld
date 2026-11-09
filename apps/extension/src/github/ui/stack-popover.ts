/**
 * A Related work stack row opens GitHub's own stack popover, the one the header's "11/14" badge opens, beside the row.
 * Nothing of GitHub's is moved or copied: the row presses the badge, and while the popover is open the row carries the
 * popover's CSS anchor name too. Primer positions it with anchor positioning (`position-anchor` on the popover,
 * `anchor-name` on the badge), and of two elements with one anchor name the later in the page wins, so the popover
 * stands by the row. Closed, the row gives the name back and the badge opens it in the header as before. Where the
 * browser has no anchor positioning, the popover opens in the header, which is still the stack.
 */

const BADGE = 'button[class*="stackBadge"]';
const OVERLAY = '[data-component="AnchoredOverlay"]';

/** The header's stack badge: the one that shows, else the first, whose popover the row's anchor seats all the same. */
export function stackBadge(): HTMLButtonElement | null {
  const badges = [...document.querySelectorAll<HTMLButtonElement>(BADGE)];
  return badges.find((badge) => badge.getClientRects().length > 0) ?? badges[0] ?? null;
}

const isOpen = (badge: HTMLButtonElement): boolean => badge.getAttribute('aria-expanded') === 'true';

/** The popover the badge opened: Primer's overlay anchored on the badge's name. */
function popoverOf(badge: HTMLButtonElement): HTMLElement | null {
  const name = badge.style.getPropertyValue('anchor-name');
  const overlays = [...document.querySelectorAll<HTMLElement>(OVERLAY)];
  return overlays.find((overlay) => name !== '' && overlay.style.getPropertyValue('position-anchor') === name) ?? null;
}

interface Opened {
  readonly row: HTMLElement;
  readonly badge: HTMLButtonElement;
  readonly abort: AbortController;
  scroll: { readonly x: number; readonly y: number };
}

let opened: Opened | null = null;

/** Gives the anchor name back once the row that holds it has left the page: the sidebar redrawn, or replaced by GitHub. */
export function syncStackPopover(): void {
  if (opened !== null && !opened.row.isConnected) releaseStackPopover();
}

/** The row gives the anchor name back. Exported for teardown. */
export function releaseStackPopover(): void {
  if (opened === null) return;
  opened.abort.abort();
  opened.row.style.removeProperty('anchor-name');
  opened.row.setAttribute('aria-expanded', 'false');
  opened = null;
}

/**
 * Once the badge's popover is in the page, the row takes its anchor name. Pressed from inside the row's click, React
 * renders the popover after the click returns, so it is waited for with an observer, whose callback runs before the
 * frame paints: the popover never shows by the header first.
 */
function seatWhenOpen(row: HTMLElement, badge: HTMLButtonElement): void {
  if (seat(row, badge)) return;
  const watch = new MutationObserver(() => {
    if (seat(row, badge) || !isOpen(badge)) stop();
  });
  const stop = (): void => {
    watch.disconnect();
    window.clearTimeout(timer);
  };
  const timer = window.setTimeout(stop, SEAT_PATIENCE_MS);
  watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'aria-expanded'] });
}

const SEAT_PATIENCE_MS = 1000;

function seat(row: HTMLElement, badge: HTMLButtonElement): boolean {
  if (opened?.row === row) return true;
  const popover = popoverOf(badge);
  const name = popover?.style.getPropertyValue('position-anchor') ?? '';
  if (popover === null || name === '' || !isOpen(badge)) return false;
  const abort = new AbortController();
  const state: Opened = { row, badge, abort, scroll: { x: window.scrollX, y: window.scrollY } };
  opened = state;
  row.style.setProperty('anchor-name', name);
  row.setAttribute('aria-expanded', 'true');
  window.addEventListener('scroll', () => {
    if (opened === state && isOpen(badge)) state.scroll = { x: window.scrollX, y: window.scrollY };
  }, { passive: true, signal: abort.signal });
  // Primer hands focus back to the badge when the popover closes (Escape), which scrolls to the header: the focus goes
  // to the row that opened it instead, and the page stays where it was, before the frame paints.
  badge.addEventListener('focus', () => {
    if (opened !== state || isOpen(badge)) return;
    const { x, y } = state.scroll;
    releaseStackPopover();
    row.focus({ preventScroll: true });
    window.scrollTo(x, y);
  }, { signal: abort.signal });
  const watch = new MutationObserver(() => {
    if (opened !== state) return;
    if (!badge.isConnected || !row.isConnected) releaseStackPopover();
    // Closed without focus coming back (a click elsewhere, a pull request chosen): the name goes back a frame later,
    // after the focus Primer may still return.
    else if (!isOpen(badge)) requestAnimationFrame(() => opened === state && !isOpen(badge) && releaseStackPopover());
  });
  watch.observe(badge, { attributes: true, attributeFilter: ['aria-expanded'] });
  abort.signal.addEventListener('abort', () => watch.disconnect());
  return true;
}

/**
 * A plain click on `row` opens GitHub's stack popover beside it, and a click while it is open from here closes it.
 * A click with a modifier, or on a page with no stack badge, follows the row's link to the stack's page.
 */
export function attachStackPopover(row: HTMLAnchorElement): void {
  if (stackBadge() !== null) {
    row.setAttribute('aria-haspopup', 'dialog');
    row.setAttribute('aria-expanded', 'false');
  }
  let openAtPress = false;
  // Primer closes the popover on a press outside it, which this row is, before the click: the press says whether
  // this click is closing it, so it is not opened again.
  row.addEventListener('pointerdown', () => {
    openAtPress = opened?.row === row && isOpen(opened.badge);
  });
  row.addEventListener('click', (event) => {
    // Read and cleared on every click, kept or not, and trusted only for a click a press made (Enter's has no press,
    // `detail` 0): a modified click, or a press dragged off the row, would otherwise leave it for the next one.
    const pressedOpen = openAtPress && event.detail > 0;
    openAtPress = false;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const badge = stackBadge();
    if (badge === null) return;
    event.preventDefault();
    const wasOpen = pressedOpen || (opened?.row === row && isOpen(badge));
    if (wasOpen) {
      if (isOpen(badge)) badge.click();
      return;
    }
    if (isOpen(badge)) badge.click();
    badge.click();
    seatWhenOpen(row, badge);
  });
}
