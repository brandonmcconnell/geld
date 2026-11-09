/**
 * Whether the off line's subtitle fits: the line keeps to one row, decided
 * from widths pretext measures (canvas, no layout) against the line's width
 * as a ResizeObserver reports it, never from a breakpoint.
 */

import { DIGEST_VIEW_OPTIONS } from './digest-view';
import { textWidth } from './path-fit';

// Mirrored in style.css: `.geld-view-choice__option` (10px padding, 1px border), `.geld-view-label` (4px gap,
// 14px marks), `.geld-digest-off` (12px gap, 16px emblem).
const OPTION_CHROME = 22;
const PART_GAP = 4;
const MARK = 14;
const BAR_GAP = 12;
const BRAND = 16;
/** Canvas and layout can round a word differently by a fraction: never decide on the last pixel. */
const SLACK = 2;

export const ATTR_VIEW_SUBTITLE = 'data-geld-view-subtitle';
export const OFF_TITLE = 'The Geld digest is off.';
export const OFF_SUBTITLE = ' Reviews, bots, CI and threads at a glance.';

/** Text widths at the line's 12px: semibold (the title, and the pressed option, every option measured so) and regular. */
export interface Measures {
  readonly bold: (text: string) => number;
  readonly regular: (text: string) => number;
}

/** The segmented control's width: what shows of each option (words read only by screen readers take none). */
export function choiceWidth(measure: (text: string) => number): number {
  return DIGEST_VIEW_OPTIONS.reduce((total, option) => {
    const parts = option.parts.filter((part) => part.kind === 'mark' || part.spoken !== true);
    const inner = parts.reduce((sum, part) => sum + (part.kind === 'mark' ? MARK : measure(part.text)), 0);
    return total + OPTION_CHROME + inner + PART_GAP * Math.max(0, parts.length - 1);
  }, 0);
}

/** The subtitle shows only while the whole line, subtitle included, fits on one row. */
export function offLineSubtitleFits(width: number, measure: Measures): boolean {
  return BRAND + BAR_GAP + measure.bold(OFF_TITLE) + measure.regular(OFF_SUBTITLE) + BAR_GAP + choiceWidth(measure.bold) + SLACK <= width;
}

let observer: ResizeObserver | null = null;

export function fitOffLineOnResize(bar: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target;
      if (!(target instanceof HTMLElement) || !target.isConnected) {
        observer?.unobserve(target);
        continue;
      }
      const width = entry.contentRect.width;
      if (width === 0) continue;
      // The line is set at 12px throughout; only the family comes from the page.
      const family = getComputedStyle(target).fontFamily;
      const fits = offLineSubtitleFits(width, { bold: (text) => textWidth(text, `600 12px ${family}`), regular: (text) => textWidth(text, `400 12px ${family}`) });
      const value = fits ? 'show' : 'hide';
      if (target.getAttribute(ATTR_VIEW_SUBTITLE) !== value) target.setAttribute(ATTR_VIEW_SUBTITLE, value);
    }
  });
  observer.observe(bar);
}
