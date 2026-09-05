/**
 * Shorten a file path to fit a width by cutting out the middle, so both where
 * a file lives and what it is called stay legible ("packages/wxt/…/init.test.ts").
 * The file name is kept whole for as long as it fits on its own; only then is
 * it shortened in the middle too. Widths come from canvas text measurement in
 * the element's own font, so no layout is thrashed.
 */

const ELLIPSIS = '\u2026';

let canvas: CanvasRenderingContext2D | null = null;

function measurer(font: string): ((text: string) => number) | null {
  canvas ??= document.createElement('canvas').getContext('2d');
  if (canvas === null) return null;
  canvas.font = font;
  const context = canvas;
  return (text) => context.measureText(text).width;
}

function cutMiddle(text: string, keep: number): string {
  if (keep >= text.length) return text;
  if (keep <= 0) return ELLIPSIS;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}${ELLIPSIS}${tail > 0 ? text.slice(text.length - tail) : ''}`;
}

/** Largest `keep` in [0, text.length] for which `render(keep)` fits. */
function widest(text: string, fits: (candidate: string) => boolean, render: (keep: number) => string): string {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(render(mid))) low = mid;
    else high = mid - 1;
  }
  return render(low);
}

export function middleTruncate(path: string, maxWidth: number, font: string): string {
  const measure = measurer(font);
  if (measure === null || maxWidth <= 0) return path;
  const fits = (candidate: string): boolean => measure(candidate) <= maxWidth;
  if (fits(path)) return path;

  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);

  // Keep the name whole and squeeze the directory: "packages/wxt/…/tests/init.test.ts".
  if (directory !== '' && fits(`${ELLIPSIS}/${name}`)) {
    return widest(directory, fits, (keep) => `${cutMiddle(directory, keep)}/${name}`);
  }
  // Even the bare name is too long: shorten the name itself in the middle.
  return widest(name, fits, (keep) => cutMiddle(name, keep));
}

/**
 * Apply {@link middleTruncate} to an element whose full text is stored in
 * `data-full`; call after layout (the element must be visible to have a width).
 */
export function fitMiddleTruncated(element: HTMLElement): void {
  const full = element.dataset.full ?? element.textContent ?? '';
  element.dataset.full = full;
  const width = element.clientWidth;
  if (width === 0) return;
  const style = getComputedStyle(element);
  const text = middleTruncate(full, width, style.font);
  if (element.textContent !== text) element.textContent = text;
  element.title = text === full ? '' : full;
}
