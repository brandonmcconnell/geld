// @vitest-environment happy-dom
import type { DigestView } from '@geld/core';
import { computeAccessibleName } from 'dom-accessibility-api';
import { describe, expect, it } from 'vitest';
import { DIGEST_VIEW_OPTIONS, viewChoice } from './digest-view';
import { choiceWidth, offLineSubtitleFits, OFF_SUBTITLE, OFF_TITLE } from './view-fit';
import type { Measures } from './view-fit';

/** Every option's computed accessible name, so an `aria-label` on a button or a part counts as it would for a screen reader. */
function names(choice: HTMLElement): string[] {
  document.body.replaceChildren(choice);
  return [...choice.querySelectorAll('button')].map((button) => computeAccessibleName(button));
}

/** What a sighted reader sees in each option: marks by their label, words unless they are for screen readers only. */
function shown(choice: HTMLElement): string[] {
  return [...choice.querySelectorAll('button')].map((button) =>
    [...button.querySelectorAll('.geld-view-label > :not(.geld-sr-only)')].map((part) => part.getAttribute('aria-label') ?? part.textContent).join(' '),
  );
}

describe('viewChoice', () => {
  it('names the views by marks and a word, digest, timeline, then both, with the current one pressed', () => {
    const choice = viewChoice('digest-timeline', () => undefined);
    const buttons = [...choice.querySelectorAll('button')];
    expect(names(choice)).toEqual(['Geld Digest', 'GitHub Timeline', 'Geld Digest + GitHub Timeline']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(buttons.map((button) => button.title)).toEqual(DIGEST_VIEW_OPTIONS.map((option) => option.hint));
  });

  it('shows both as its two marks around a plus, its words for screen readers alone', () => {
    expect(shown(viewChoice('digest', () => undefined))).toEqual(['Geld Digest', 'GitHub Timeline', 'Geld + GitHub']);
  });

  it('reports every press, the current view included, which is how the intro is answered as it is', () => {
    const chosen: DigestView[] = [];
    const choice = viewChoice('digest', (view) => chosen.push(view));
    for (const button of choice.querySelectorAll('button')) button.click();
    expect(chosen).toEqual(['digest', 'github', 'digest-timeline']);
  });
});

describe('off line fit', () => {
  // Every character 6px wide, whatever the weight: easy sums.
  const char = (text: string): number => text.length * 6;
  const measure: Measures = { bold: char, regular: char };

  it('measures what shows, not the words only screen readers hear', () => {
    // Digest: 22 chrome + 14 mark + 4 gap + 36. Timeline: 22 + 14 + 4 + 48. Both: 22 + 14 + 4 + 6 + 4 + 14.
    expect(choiceWidth(char)).toBe(76 + 88 + 64);
  });

  it('keeps the subtitle only while the whole line fits on one row', () => {
    // 16px emblem, two 12px gaps, 2px slack.
    const whole = 16 + 12 + char(OFF_TITLE) + char(OFF_SUBTITLE) + 12 + choiceWidth(char) + 2;
    expect(offLineSubtitleFits(whole, measure)).toBe(true);
    expect(offLineSubtitleFits(whole - 1, measure)).toBe(false);
  });
});
