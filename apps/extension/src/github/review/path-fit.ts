/**
 * A file path in a box narrower than itself: the file name always shows,
 * then as much of the start as fits, then whatever trailing directories fit
 * — "apps/dashboard/components/content-editor/…/CustomComponent/Format.ts".
 * Widths come from pretext (canvas measurement, no layout), so the fit is
 * decided before the text is painted and again on resize without reflow.
 */

import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';

const ELLIPSIS = '…';

/** The canvas font shorthand for an element's computed text style. */
export function fontOf(element: Element): string {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

export function textWidth(text: string, font: string): number {
  return measureNaturalWidth(prepareWithSegments(text, font));
}

/**
 * The longest form of `path` no wider than `maxWidth`: every segment when
 * it fits; else the file name plus the most segments that do, taken from
 * the start first and from the end second, the gap marked with one "…".
 */
export function fitPath(path: string, maxWidth: number, measure: (text: string) => number): string {
  if (path === '' || maxWidth <= 0) return path;
  const fits = (text: string): boolean => measure(text) <= maxWidth;
  if (fits(path)) return path;
  const parts = path.split('/');
  const file = parts.pop() ?? path;
  let best = `${ELLIPSIS}/${file}`;
  let bestScore = -1;
  for (let head = parts.length; head >= 0; head -= 1) {
    for (let tail = parts.length - head; tail >= 0; tail -= 1) {
      if (head + tail === parts.length) continue;
      // More segments win; among equals, one that keeps the directory the file lives in; then more from the start.
      const score = (head + tail) * 2 + (tail > 0 ? 1 : 0);
      if (score <= bestScore) continue;
      const candidate = [...parts.slice(0, head), ELLIPSIS, ...parts.slice(parts.length - tail), file].join('/');
      if (!fits(candidate)) continue;
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Keep `element`'s text fitted to its own width: full path now, refitted
 * whenever the element is resized. The full path stays in `title`.
 */
export function fitPathInto(element: HTMLElement, path: string): void {
  element.title = path;
  const apply = (): void => {
    const width = element.clientWidth;
    if (width === 0) return;
    const font = fontOf(element);
    const fitted = fitPath(path, width, (text) => textWidth(text, font));
    if (element.textContent !== fitted) element.textContent = fitted;
  };
  // With the full text in, an overflowing box is exactly as wide as the space it has.
  element.textContent = path;
  apply();
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => {
    if (!element.isConnected) {
      observer.disconnect();
      return;
    }
    // Measure against the space, not against the already shortened text.
    element.textContent = path;
    apply();
  });
  observer.observe(element);
}
