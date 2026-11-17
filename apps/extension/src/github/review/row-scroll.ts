import { holdRow } from './hold';
import { stickyHeaderBottomAt } from './sticky';

/**
 * Toggle a row and leave the page where it is unless the row would end up
 * above the viewport's top (under GitHub's sticky header): a tall row closing
 * above it can carry it off the top, and then it is brought just under the
 * header. Anywhere else on screen it stays where the toggle left it, since
 * compensating every move bounced the page between rows.
 */
export function keepInPlace(focusKey: string, change: () => void): void {
  change();
  const after = document.querySelector(`[data-geld-focus="${focusKey}"]`);
  if (!(after instanceof HTMLElement)) return;
  const top = after.getBoundingClientRect().top;
  if (top < stickyHeaderBottomAt(window.scrollY)) scrollRowTo(top + window.scrollY);
  // From here until the reader scrolls, the row stays where it landed whatever arrives above it.
  holdRow(focusKey);
}

/**
 * After a jump to a row (`revealRow`): when the row opened and what it opened
 * runs past the bottom of the viewport, scroll just far enough to show it,
 * and never so far that the row itself leaves the top. A row whose content
 * fits does not move at all. The same rule native tree views follow: reveal
 * if needed, by the least amount.
 */
export function revealOpened(control: HTMLElement): void {
  const row = control.closest<HTMLElement>('li');
  if (row === null) return;
  const open = control.getAttribute('aria-expanded') === 'true' || row.hasAttribute('data-open') || row.getAttribute('data-open') === 'true';
  if (!open) return;
  const slot = row.nextElementSibling instanceof HTMLElement && row.nextElementSibling.matches('.geld-review__slot') ? row.nextElementSibling : null;
  const rowTop = row.getBoundingClientRect().top;
  const blockBottom = (slot ?? row).getBoundingClientRect().bottom;
  const gap = 8;
  const overflow = blockBottom + gap - window.innerHeight;
  if (overflow <= 0) return;
  // How far up the row may go: to just under the header as it will stand after the scroll. The header's presence
  // depends on the destination, so the room is settled against the destination it allows.
  const roomAt = (delta: number): number => rowTop - stickyHeaderBottomAt(window.scrollY + delta) - gap;
  let delta = Math.min(overflow, roomAt(overflow));
  if (delta < overflow) delta = Math.min(overflow, roomAt(delta));
  if (delta > 0) window.scrollBy({ top: delta, behavior: 'instant' });
}

/**
 * Scroll so the row whose document top is `rowTop` sits just under GitHub's
 * sticky header, as it will be once the page is there. The header is not on
 * screen while the reader is near the top, so its height cannot be read from
 * the current state, and a scroll that puts the row at the viewport's top edge
 * ends with the header sliding over it. `stickyHeaderBottomAt` says what the
 * header will do at a destination, so the two candidate destinations - under
 * the header, or at the top with no header - are tried where they hold.
 */
export function scrollRowTo(rowTop: number): number {
  const destination = rowDestination(rowTop);
  window.scrollTo({ top: destination, behavior: 'instant' });
  return destination;
}

/** The scroll position that puts a row whose document top is `rowTop` just under the sticky header (see `scrollRowTo`). */
export function rowDestination(rowTop: number): number {
  const gap = 8;
  const withHeader = rowTop - stickyHeaderBottomAt(rowTop) - gap;
  if (stickyHeaderBottomAt(withHeader) > 0) return withHeader;
  const bare = rowTop - gap;
  // No header at either destination: the row goes to the top edge. The header would appear only at the bare
  // destination: stop short of it, where the row sits a header's height down and nothing covers it.
  return stickyHeaderBottomAt(bare) > 0 ? withHeader : bare;
}
