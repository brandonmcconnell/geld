/**
 * Hiding in the virtualised files view (`DiffView.virtualized`).
 *
 * Rows there are mounted as the page scrolls, between passes of the
 * controller, so an attribute written on apply would let a hidden file paint
 * at its estimated height for a frame before it vanished. The file tree lists
 * every file with a link to its `#diff-<digest>` anchor, and each mounted row
 * is the element wrapping the region that carries that id, so the hiding is
 * declared once, in a stylesheet keyed on the anchors: a hidden row is never
 * painted, measures 0, and the virtualiser closes the rows below over it.
 * The selectors hang off the container's `data-geld-virtual` and stop
 * matching while the diff is expanded ("Show hidden files").
 */

import { OWN_UI_ATTRIBUTE } from '../dom';

const STYLE_ID = 'geld-virtual-hidden';

export const ATTR_VIRTUAL = 'data-geld-virtual';

function ruleFor(anchor: string): string {
  return `[data-geld-container][${ATTR_VIRTUAL}]:not([data-geld-expanded]) > :has(> [id="${CSS.escape(anchor)}"]) { display: none !important; }`;
}

/** Declare `anchors` hidden; rewrites the sheet only when the set changed. */
export function applyVirtualHiddenStyles(anchors: readonly string[]): void {
  const text = anchors.map(ruleFor).join('\n');
  let style = document.getElementById(STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style?.remove();
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute(OWN_UI_ATTRIBUTE, '');
    (document.head ?? document.documentElement).append(style);
  }
  if (style.textContent !== text) style.textContent = text;
}

export function removeVirtualHiddenStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}
