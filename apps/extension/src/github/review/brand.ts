import emblem from '../../../../../assets/brand/geld-logomark-grid.svg?raw';
import { svgFromString } from '../dom';

/** Set while the selection holds the emblem, so the stylesheet can invert it as selected text inverts. */
export const ATTR_BRAND_SELECTED = 'data-geld-selected';

const BRAND_SELECTOR = '[data-geld-brand]';

/**
 * The Geld emblem in the text colour around it, so GitHub's light and dark themes recolour it. It is the 14-unit grid
 * mark, which lands on whole pixels where the 24 × 25 one cannot.
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
  selecting = ranges.length > 0;
  for (const mark of document.querySelectorAll(BRAND_SELECTOR)) {
    mark.toggleAttribute(ATTR_BRAND_SELECTED, ranges.some((range) => range.intersectsNode(mark)));
  }
}

/**
 * The same for emblems just mounted, asked only while a selection is held: reading the selection brings layout up to
 * date, and a panel mounted while GitHub renders the page forced a whole-page layout each time.
 */
export function syncNewBrandMarks(): void {
  if (selecting) syncBrandSelection();
}

/** The grid mark's straight edges all fall on 2-unit steps of its 14 units: 7 cells, each needing whole device pixels. */
const BRAND_CELLS = 7;
/** 120% of the 14px mark, which stays in the glyph column's 16px box (mirrored in the stylesheet). */
const BRAND_WANTED_PX = 16.8;
const BRAND_BOX_PX = 16;

export interface BrandFit {
  /** The mark's side in CSS pixels. */
  size: number;
  /** Its offset from the box's top left corner, so it starts on a whole device pixel as near centred as that allows. */
  shift: number;
}

/** The sharp size nearest 120% at this device pixel ratio: one cell is a whole number of device pixels. */
export function brandFit(ratio: number): BrandFit {
  const dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const cell = Math.max(1, Math.round((BRAND_WANTED_PX * dpr) / BRAND_CELLS));
  const size = (cell * BRAND_CELLS) / dpr;
  const shift = Math.round(((BRAND_BOX_PX - size) / 2) * dpr) / dpr;
  return { size, shift };
}

let scaleQuery: MediaQueryList | null = null;

function applyBrandFit(): void {
  const { size, shift } = brandFit(window.devicePixelRatio);
  const root = document.documentElement.style;
  root.setProperty('--geld-brand-size', `${size}px`);
  root.setProperty('--geld-brand-shift', `${shift}px`);
  scaleQuery?.removeEventListener('change', applyBrandFit);
  // Zoom and moving the window to another screen change the ratio; a query for the current one fires when it does.
  scaleQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  scaleQuery.addEventListener('change', applyBrandFit);
}

export function watchBrandScale(): void {
  if (scaleQuery === null) applyBrandFit();
}

export function stopWatchingBrandScale(): void {
  if (scaleQuery === null) return;
  scaleQuery.removeEventListener('change', applyBrandFit);
  scaleQuery = null;
  const root = document.documentElement.style;
  root.removeProperty('--geld-brand-size');
  root.removeProperty('--geld-brand-shift');
}

/** Whether the selection last read was not collapsed; nothing is selected when a page opens. */
let selecting = false;
let watching = false;

export function watchBrandSelection(): void {
  if (watching) return;
  watching = true;
  document.addEventListener('selectionchange', syncBrandSelection);
}

export function stopWatchingBrandSelection(): void {
  if (!watching) return;
  watching = false;
  selecting = false;
  document.removeEventListener('selectionchange', syncBrandSelection);
  for (const mark of document.querySelectorAll(BRAND_SELECTOR)) mark.removeAttribute(ATTR_BRAND_SELECTED);
}
