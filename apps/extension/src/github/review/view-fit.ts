/**
 * What the view choice and the line around it can say in the room they have,
 * decided from widths pretext measures (canvas, no layout) against the box's
 * width as a ResizeObserver reports it. Both views' words ("Digest + Timeline")
 * show only where they fit without wrapping, and the off line's subtitle only
 * where the whole line still fits on one row.
 */

import { DIGEST_VIEW_OPTIONS } from './digest-view';
import { textWidth } from './path-fit';

// Mirrored in style.css: `.geld-view-choice__option` (10px padding, 1px border), `.geld-view-label` (4px gap,
// 14px marks), `.geld-review__intro` (16px gap, 280px text basis), `.geld-review__intro-actions` (8px gap),
// `.geld-review__intro-dismiss` (10px padding, 1px border), `.geld-digest-off` (12px gap, 16px emblem).
const OPTION_CHROME = 22;
const PART_GAP = 4;
const MARK = 14;
const INTRO_GAP = 16;
const INTRO_TEXT_BASIS = 280;
const ACTIONS_GAP = 8;
const BAR_GAP = 12;
const BRAND = 16;
/** Canvas and layout can round a word differently by a fraction: never decide on the last pixel. */
const SLACK = 2;

export const ATTR_VIEW_WORDS = 'data-geld-view-words';
export const ATTR_VIEW_SUBTITLE = 'data-geld-view-subtitle';
export const OFF_TITLE = 'The Geld digest is off.';
export const OFF_SUBTITLE = ' Reviews, bots, CI and threads at a glance.';
export const INTRO_KEEP = 'Got it';

/** Text widths at the control's 12px: semibold (the pressed option, every option measured so), medium, regular. */
export interface Measures {
  readonly bold: (text: string) => number;
  readonly medium: (text: string) => number;
  readonly regular: (text: string) => number;
}

/** The segmented control's width with or without the optional words (the pressed option's weight for every option). */
export function choiceWidth(measure: (text: string) => number, words: boolean): number {
  return DIGEST_VIEW_OPTIONS.reduce((total, option) => {
    const parts = option.parts.filter((part) => words || part.kind === 'mark' || part.optional !== true);
    const inner = parts.reduce((sum, part) => sum + (part.kind === 'mark' ? MARK : measure(part.text)), 0);
    return total + OPTION_CHROME + inner + PART_GAP * Math.max(0, parts.length - 1);
  }, 0);
}

/** The off line's steps, most said first: the first that fits on one row wins, else the last (which may wrap). */
export function fitOffLine(width: number, measure: Measures): { readonly subtitle: boolean; readonly words: boolean } {
  const title = measure.bold(OFF_TITLE);
  const subtitle = measure.regular(OFF_SUBTITLE);
  const least = { subtitle: false, words: false };
  const steps = [{ subtitle: true, words: true }, { subtitle: true, words: false }, { subtitle: false, words: true }, least];
  return steps.find((step) => BRAND + BAR_GAP + title + (step.subtitle ? subtitle : 0) + BAR_GAP + choiceWidth(measure.bold, step.words) + SLACK <= width) ?? least;
}

/**
 * The intro's words: shown when the control and "Got it" still fit beside the text, or, once they sit on a row
 * of their own anyway, when they fit across it; never when they alone push the control under the text.
 */
export function fitIntro(width: number, measure: Measures): boolean {
  const keep = OPTION_CHROME + measure.medium(INTRO_KEEP);
  const actions = (words: boolean): number => choiceWidth(measure.bold, words) + ACTIONS_GAP + keep + SLACK;
  const beside = (words: boolean): boolean => INTRO_TEXT_BASIS + INTRO_GAP + actions(words) <= width;
  if (beside(true)) return true;
  if (beside(false)) return false;
  return actions(true) <= width;
}

type Fit = (element: HTMLElement, width: number, measure: Measures) => void;

const fits = new WeakMap<Element, Fit>();
let observer: ResizeObserver | null = null;

function measuresOf(element: Element): Measures {
  // Every part is set at 12px (the control, the intro, the off line); only the family comes from the page.
  const family = getComputedStyle(element).fontFamily;
  return {
    bold: (text) => textWidth(text, `600 12px ${family}`),
    medium: (text) => textWidth(text, `500 12px ${family}`),
    regular: (text) => textWidth(text, `400 12px ${family}`),
  };
}

function watch(element: HTMLElement, fit: Fit): void {
  if (typeof ResizeObserver === 'undefined') return;
  fits.set(element, fit);
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target;
      if (!(target instanceof HTMLElement) || !target.isConnected) {
        observer?.unobserve(target);
        continue;
      }
      const width = entry.contentRect.width;
      if (width === 0) continue;
      fits.get(target)?.(target, width, measuresOf(target));
    }
  });
  observer.observe(element);
}

function setFlag(element: HTMLElement, name: string, show: boolean): void {
  const value = show ? 'show' : 'hide';
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function fitOffLineOnResize(bar: HTMLElement): void {
  watch(bar, (element, width, measure) => {
    const step = fitOffLine(width, measure);
    setFlag(element, ATTR_VIEW_SUBTITLE, step.subtitle);
    setFlag(element, ATTR_VIEW_WORDS, step.words);
  });
}

export function fitIntroOnResize(intro: HTMLElement): void {
  watch(intro, (element, width, measure) => setFlag(element, ATTR_VIEW_WORDS, fitIntro(width, measure)));
}
