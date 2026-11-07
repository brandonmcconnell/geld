import emblem from '../../../../../assets/brand/geld-logomark-grid.svg?raw';
import { svgFromString } from '../dom';

/** Set while the selection holds the emblem, so the stylesheet can invert it as selected text inverts. */
export const ATTR_BRAND_SELECTED = 'data-geld-selected';

const BRAND_SELECTOR = '[data-geld-brand]';

/**
 * The Geld emblem in the text colour around it, so GitHub's light and dark themes recolour it. At the rows' 16px
 * glyph size it is the 14-unit grid mark at 1px per unit, which lands on whole pixels where the 24 × 25 one cannot.
 */
export function brandMark(className: string): HTMLElement {
  const svg = svgFromString(emblem.replace(/fill="#000000"/, 'fill="currentColor"'));
  for (const name of ['role', 'aria-label']) svg.removeAttribute(name);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const mark = document.createElement('span');
  mark.className = className;
  mark.setAttribute('data-geld-brand', '');
  mark.append(svg);
  return mark;
}

/**
 * Marks every emblem the current selection reaches; an image is no text, so `::selection` never paints it.
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
