/**
 * Where a digest row goes when a toggle carried it off the top, on every host. A host says where its sticky header
 * ends at a given scroll position (`headerBottomAt`), since a header may appear or vanish with the scroll.
 */

const GAP = 8;

/** The scroll position that puts a row whose document top is `rowTop` just under the host's sticky header. */
export function rowDestinationUnder(rowTop: number, headerBottomAt: (scrollY: number) => number): number {
  const withHeader = rowTop - headerBottomAt(rowTop) - GAP;
  if (headerBottomAt(withHeader) > 0) return withHeader;
  const bare = rowTop - GAP;
  // No header at either destination: the row goes to the top edge. The header would appear only at the bare
  // destination: stop short of it, where the row sits a header's height down and nothing covers it.
  return headerBottomAt(bare) > 0 ? withHeader : bare;
}

/**
 * After a row toggled: leave the page where it is unless the row ended up above the viewport's top (under the
 * host's sticky header), and then bring it just under the header. Anywhere else it stays where the toggle left it,
 * since compensating every move bounced the page between rows (GitHub #725).
 */
export function settleToggledRow(row: HTMLElement, headerBottomAt: (scrollY: number) => number): boolean {
  const view = row.ownerDocument.defaultView;
  if (view === null) return false;
  const top = row.getBoundingClientRect().top;
  if (top >= headerBottomAt(view.scrollY)) return false;
  view.scrollTo({ top: rowDestinationUnder(top + view.scrollY, headerBottomAt), behavior: 'instant' });
  return true;
}

/**
 * Where the page's own fixed or sticky bars end at the top of the viewport now: the bars stacked from the top edge
 * down (a site header, then a sticky tab bar), read from what stands there. For a host with no measured header of
 * its own; the answer holds for the current scroll position only.
 */
export function stickyBarsBottom(doc: Document, ignore?: Element): number {
  const view = doc.defaultView;
  if (view === null || typeof doc.elementsFromPoint !== 'function') return 0;
  let bottom = 0;
  for (let step = 0; step < 4; step += 1) {
    const y = bottom + 1;
    if (y >= view.innerHeight / 2) break;
    let next = bottom;
    for (const element of doc.elementsFromPoint(view.innerWidth / 2, y)) {
      if (ignore?.contains(element) === true) continue;
      const position = view.getComputedStyle(element).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      const box = element.getBoundingClientRect();
      if (box.top <= y && box.bottom > next) next = box.bottom;
    }
    if (next <= bottom) break;
    bottom = next;
  }
  return bottom;
}
