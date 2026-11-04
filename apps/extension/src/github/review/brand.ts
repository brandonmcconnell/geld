import wordmark from '../../../../../assets/brand/geld-logo.svg?raw';
import { svgFromString } from '../dom';

/** Set while the selection holds the wordmark, so the stylesheet can invert it as selected text inverts. */
export const ATTR_BRAND_SELECTED = 'data-geld-selected';

const BRAND_SELECTOR = '[data-geld-brand]';

/** The Geld wordmark drawn in the text colour around it, so GitHub's light and dark themes recolour it. */
export function brandMark(className: string): HTMLElement {
  const svg = svgFromString(wordmark.replace(/fill="#000000"/, 'fill="currentColor"'));
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('focusable', 'false');
  const mark = document.createElement('span');
  mark.className = className;
  mark.setAttribute('data-geld-brand', '');
  mark.append(svg);
  return mark;
}

/**
 * Marks every wordmark the current selection reaches; an image is no text, so `::selection` never paints it.
 * Read from the ranges: Chrome's `Selection.containsNode` answers false for a node with no text, an inline SVG.
 */
export function syncBrandSelection(): void {
  const selection = document.getSelection();
  const ranges: Range[] = [];
  if (selection !== null && !selection.isCollapsed) {
    for (let index = 0; index < selection.rangeCount; index += 1) ranges.push(selection.getRangeAt(index));
  }
  for (const mark of document.querySelectorAll(BRAND_SELECTOR)) {
    mark.toggleAttribute(ATTR_BRAND_SELECTED, ranges.some((range) => range.intersectsNode(mark)));
  }
}

let watching = false;

export function watchBrandSelection(): void {
  if (watching) return;
  watching = true;
  document.addEventListener('selectionchange', syncBrandSelection);
}

export function stopWatchingBrandSelection(): void {
  if (!watching) return;
  watching = false;
  document.removeEventListener('selectionchange', syncBrandSelection);
  for (const mark of document.querySelectorAll(BRAND_SELECTOR)) mark.removeAttribute(ATTR_BRAND_SELECTED);
}
