/**
 * Pills give way to the room they have, in two steps. A status row's pills
 * (the bots row, the reports row) say mark · name · detail · light; a row too
 * narrow for that whole line used to wrap its pills onto a second line. Now
 * the row is measured: when its pills do not fit on one line, every pill
 * drops its name first (the mark still says who: "clean", "5/5", "passed"
 * stay), and only when even that does not fit, its detail too (mark and
 * light alone). The decision is per row — the bots row may be at the first
 * step while the reports row, with one pill, keeps everything — and is made
 * again whenever the panel's width changes (a `ResizeObserver` on the
 * panel), not at a fixed breakpoint: how much fits depends on how many pills
 * there are and how long their words run.
 *
 * The measurement: the pills' widths plus the gaps between them against the
 * row's width, read with the row set to each step in turn (`data-geld-fit`
 * = "" · "names" · "details"); the stylesheet does the hiding. Three layouts
 * at most per row per pass, on a handful of elements.
 */

import { ATTR_FIT } from './panel';

const STEPS = ['names', 'details'] as const;

function overflows(row: HTMLElement): boolean {
  const children = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  if (children.length === 0) return false;
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  const wanted = children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * (children.length - 1);
  // Half a pixel of slack: subpixel widths round either way, and a pill a hair over the edge still fits.
  return wanted > row.clientWidth + 0.5;
}

/** Set `row`'s step to the first at which its pills fit on one line. */
function fitRow(row: HTMLElement): void {
  row.setAttribute(ATTR_FIT, '');
  for (const step of STEPS) {
    if (!overflows(row)) return;
    row.setAttribute(ATTR_FIT, step);
  }
}

let observer: ResizeObserver | null = null;
let observed: Element | null = null;
let lastWidth = -1;

/**
 * Fit every pill row under `root` now, and again whenever `root` changes
 * width. One root is watched at a time (the panel is rebuilt as one
 * element); a rebuild hands the watch to the new one.
 */
export function fitChips(root: HTMLElement): void {
  for (const row of root.querySelectorAll<HTMLElement>(`[${ATTR_FIT}]`)) fitRow(row);
  if (observed === root) return;
  observer?.disconnect();
  observed = root;
  lastWidth = root.getBoundingClientRect().width;
  if (typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined || observed === null) return;
    const width = entry.contentRect.width;
    // Only a change of width means a change of room; a height change (a row opening) does not.
    if (Math.abs(width - lastWidth) < 0.5) return;
    lastWidth = width;
    for (const row of observed.querySelectorAll<HTMLElement>(`[${ATTR_FIT}]`)) fitRow(row);
  });
  observer.observe(root);
}

/** Stop watching (the panel is gone). */
export function stopFittingChips(): void {
  observer?.disconnect();
  observed = null;
  lastWidth = -1;
}
