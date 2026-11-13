import emblem from '../../../../../assets/brand/geld-logomark-grid.svg?raw';
import emblem100 from '../../../../../assets/brand/digest-emblem/1x.svg?raw';
import emblem125 from '../../../../../assets/brand/digest-emblem/1.25x.svg?raw';
import emblem150 from '../../../../../assets/brand/digest-emblem/1.5x.svg?raw';
import emblem175 from '../../../../../assets/brand/digest-emblem/1.75x.svg?raw';
import emblem200 from '../../../../../assets/brand/digest-emblem/2x.svg?raw';
import emblem225 from '../../../../../assets/brand/digest-emblem/2.25x.svg?raw';
import emblem250 from '../../../../../assets/brand/digest-emblem/2.5x.svg?raw';
import emblem300 from '../../../../../assets/brand/digest-emblem/3x.svg?raw';
import emblem350 from '../../../../../assets/brand/digest-emblem/3.5x.svg?raw';
import emblem400 from '../../../../../assets/brand/digest-emblem/4x.svg?raw';
import { svgFromString } from '../dom';

/** Set while the selection holds the emblem, so the stylesheet can invert it as selected text inverts. */
export const ATTR_BRAND_SELECTED = 'data-geld-selected';

const BRAND_SELECTOR = '[data-geld-brand]';
const ATTR_FITTED = 'data-geld-brand-fitted';

/** One drawing of `assets/brand/digest-emblem/`, its viewBox in device pixels. */
export interface EmblemArt {
  ratio: number;
  width: number;
  height: number;
  svg: string;
}

function art(ratio: number, svg: string): EmblemArt {
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  return { ratio, width: Number(box?.[1] ?? 0), height: Number(box?.[2] ?? 0), svg };
}

export const DIGEST_EMBLEMS: readonly EmblemArt[] = [
  art(1, emblem100),
  art(1.25, emblem125),
  art(1.5, emblem150),
  art(1.75, emblem175),
  art(2, emblem200),
  art(2.25, emblem225),
  art(2.5, emblem250),
  art(3, emblem300),
  art(3.5, emblem350),
  art(4, emblem400),
];

/** The height the digest's drawings are made for, in CSS pixels, in the glyph column's 16px box (`.geld-review__brand`). */
const EMBLEM_PX = 18;
const EMBLEM_BOX_PX = 16;
/** Past this from 18px no drawing fits, as when zoomed far out, and the nearest is scaled to 18px instead. */
const EMBLEM_SLACK_PX = 2.5;

export interface EmblemFit {
  art: EmblemArt;
  /** Size and offset from the box's top left corner, in CSS pixels. */
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * The drawing whose device pixels come nearest 18 CSS pixels at this ratio, shown at one device pixel per unit, so every
 * straight edge is a whole pixel, and placed on a whole device pixel as near the box's centre as that allows.
 */
export function emblemFit(ratio: number, arts: readonly EmblemArt[] = DIGEST_EMBLEMS): EmblemFit {
  const dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const off = (candidate: EmblemArt): number => Math.abs(candidate.height / dpr - EMBLEM_PX);
  const best = arts.reduce((nearest, candidate) => (off(candidate) < off(nearest) ? candidate : nearest));
  if (off(best) > EMBLEM_SLACK_PX) {
    const height = EMBLEM_PX;
    const width = (best.width * height) / best.height;
    return { art: best, width, height, left: (EMBLEM_BOX_PX - width) / 2, top: (EMBLEM_BOX_PX - height) / 2 };
  }
  const place = (size: number): number => Math.round((EMBLEM_BOX_PX * dpr - size) / 2) / dpr;
  return { art: best, width: best.width / dpr, height: best.height / dpr, left: place(best.width), top: place(best.height) };
}

function drawn(source: string): SVGElement {
  const svg = svgFromString(source.replace(/fill="#000000"/, 'fill="currentColor"'));
  for (const name of ['role', 'aria-label']) svg.removeAttribute(name);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

function fittedEmblem(): SVGElement {
  const fit = emblemFit(window.devicePixelRatio);
  const svg = drawn(fit.art.svg);
  svg.style.setProperty('width', `${fit.width}px`);
  svg.style.setProperty('height', `${fit.height}px`);
  svg.style.setProperty('left', `${fit.left}px`);
  svg.style.setProperty('top', `${fit.top}px`);
  return svg;
}

/**
 * The Geld emblem in the text colour around it, so GitHub's light and dark themes recolour it. `fitted` draws the
 * digest's own pixel art for the screen's ratio (`emblemFit`); otherwise it is the 14-unit grid mark, which lands on
 * whole pixels at 14px where the 24 × 25 one cannot.
 */
export function brandMark(className: string, options: { fitted?: boolean } = {}): HTMLElement {
  const mark = document.createElement('span');
  mark.className = className;
  mark.setAttribute('data-geld-brand', '');
  if (options.fitted === true) {
    mark.setAttribute(ATTR_FITTED, '');
    mark.append(fittedEmblem());
  } else {
    mark.append(drawn(emblem));
  }
  return mark;
}

let scaleQuery: MediaQueryList | null = null;

function refitEmblems(): void {
  for (const mark of document.querySelectorAll(`[${ATTR_FITTED}]`)) mark.replaceChildren(fittedEmblem());
  armScaleQuery();
}

function armScaleQuery(): void {
  scaleQuery?.removeEventListener('change', refitEmblems);
  // Zoom and moving the window to another screen change the ratio; a query for the current one fires when it does.
  scaleQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  scaleQuery.addEventListener('change', refitEmblems);
}

export function watchBrandScale(): void {
  if (scaleQuery === null) armScaleQuery();
}

export function stopWatchingBrandScale(): void {
  scaleQuery?.removeEventListener('change', refitEmblems);
  scaleQuery = null;
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
