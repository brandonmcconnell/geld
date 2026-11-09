/**
 * Pills give way to the room they have, in two steps. A status row's pills
 * (the bots row, the reports row) say mark · name · detail · light; a row too
 * narrow for that whole line used to wrap its pills onto a second line. Now
 * the row is measured: when its pills do not fit on one line, every pill
 * drops its name first (the mark still says who: "clean", "5/5", "passed"
 * stay), and only when even that does not fit, its detail too (mark and
 * light alone). The decision is per row — the bots row may be at the first
 * step while the reports row, with one pill, keeps everything — and is made
 * when a panel is built and again whenever its width changes (a
 * `ResizeObserver` on the panel), not at a fixed breakpoint: how much fits
 * depends on how many pills there are and how long their words run.
 *
 * The Geld row at the top of the digest is fitted the same way, in one step:
 * when its summary and its buttons would wrap, every button drops its words
 * and keeps its mark (`data-geld-fit-tools` = "icons"), its tooltip still
 * naming it.
 *
 * The measurement: the children's widths plus the gaps between them against
 * the row's content width, read with the row set to each step in turn; the
 * stylesheet does the hiding. Three layouts at most per row, on a handful of
 * elements. It runs in the observer's callback, after the browser's own
 * layout and before paint, never on the apply path: there, every pass forced
 * a layout of the whole page while GitHub was still rendering it.
 */

import { ATTR_FIT, ATTR_FIT_TOOLS } from './panel';

const FITS: ReadonlyArray<{ readonly attr: string; readonly steps: readonly string[] }> = [
  { attr: ATTR_FIT, steps: ['names', 'details'] },
  { attr: ATTR_FIT_TOOLS, steps: ['icons'] },
];

function overflows(row: HTMLElement): boolean {
  const children = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  if (children.length === 0) return false;
  const style = getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const room = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  const wanted = children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * (children.length - 1);
  // Half a pixel of slack: subpixel widths round either way, and a pill a hair over the edge still fits.
  return wanted > room + 0.5;
}

/** Set `row`'s step to the first at which its children fit on one line. */
function fitRow(row: HTMLElement, attr: string, steps: readonly string[]): void {
  row.setAttribute(attr, '');
  for (const step of steps) {
    if (!overflows(row)) return;
    row.setAttribute(attr, step);
  }
}

function fitAll(root: HTMLElement): void {
  for (const { attr, steps } of FITS) {
    for (const row of root.querySelectorAll<HTMLElement>(`[${attr}]`)) fitRow(row, attr, steps);
  }
}

let observer: ResizeObserver | null = null;
let observed: HTMLElement | null = null;
let lastWidth = -1;

/**
 * Fit every pill row under `root` once it is laid out, and again whenever
 * `root` changes width. One root is watched at a time (the panel is rebuilt
 * as one element, and its rows only change with it); a rebuild hands the
 * watch to the new one.
 */
export function fitChips(root: HTMLElement): void {
  if (observed === root) return;
  observer?.disconnect();
  observed = root;
  lastWidth = -1;
  if (typeof ResizeObserver === 'undefined') {
    fitAll(root);
    return;
  }
  observer ??= new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined || observed === null || entry.target !== observed) return;
    const width = entry.contentRect.width;
    // Only a change of width means a change of room; a height change (a row opening) does not.
    if (Math.abs(width - lastWidth) < 0.5) return;
    lastWidth = width;
    fitAll(observed);
  });
  observer.observe(root);
}

/** Stop watching (the panel is gone). */
export function stopFittingChips(): void {
  observer?.disconnect();
  observed = null;
  lastWidth = -1;
}
