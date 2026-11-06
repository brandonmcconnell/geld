// @vitest-environment happy-dom
import type { DigestView } from '@geld/core';
import { describe, expect, it } from 'vitest';
import { DIGEST_VIEW_OPTIONS, viewChoice } from './digest-view';
import { choiceWidth, fitIntro, fitOffLine, OFF_SUBTITLE, OFF_TITLE } from './view-fit';
import type { Measures } from './view-fit';

/** Every option's accessible name as a screen reader builds it: marks by their label, words by their text. */
function names(choice: HTMLElement): string[] {
  return [...choice.querySelectorAll('button')].map((button) =>
    [...button.querySelectorAll('.geld-view-label > *')].map((part) => part.getAttribute('aria-label') ?? part.textContent).join(' '),
  );
}

describe('viewChoice', () => {
  it('names the views by marks and a word, digest, timeline, then both, with the current one pressed', () => {
    const choice = viewChoice('digest-timeline', () => undefined);
    const buttons = [...choice.querySelectorAll('button')];
    expect(names(choice)).toEqual(['Geld Digest', 'GitHub Timeline', 'Geld Digest + GitHub Timeline']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(buttons.map((button) => button.title)).toEqual(DIGEST_VIEW_OPTIONS.map((option) => option.hint));
    // Only both's words give way when the choice is short of room.
    expect([...choice.querySelectorAll('.geld-view-label__words')].map((words) => words.textContent)).toEqual(['Digest', 'Timeline']);
  });

  it('reports every press, the current view included, which is how the intro is answered as it is', () => {
    const chosen: DigestView[] = [];
    const choice = viewChoice('digest', (view) => chosen.push(view));
    for (const button of choice.querySelectorAll('button')) button.click();
    expect(chosen).toEqual(['digest', 'github', 'digest-timeline']);
  });
});

describe('view fit', () => {
  // Every character 6px wide, whatever the weight: easy sums.
  const char = (text: string): number => text.length * 6;
  const measure: Measures = { bold: char, medium: char, regular: char };
  const withWords = choiceWidth(char, true);
  const marksOnly = choiceWidth(char, false);
  // 16px emblem, two 12px gaps, 2px slack.
  const line = (subtitle: boolean, words: boolean): number => 16 + 12 + char(OFF_TITLE) + (subtitle ? char(OFF_SUBTITLE) : 0) + 12 + (words ? withWords : marksOnly) + 2;

  it('measures both views words only when asked to', () => {
    // "Digest" and "Timeline" (14 characters) and the two gaps before them.
    expect(withWords - marksOnly).toBe(14 * 6 + 2 * 4);
  });

  it('keeps the off line on one row, dropping both views words first and then the subtitle', () => {
    expect(fitOffLine(line(true, true), measure)).toEqual({ subtitle: true, words: true });
    expect(fitOffLine(line(true, true) - 1, measure)).toEqual({ subtitle: true, words: false });
    expect(fitOffLine(line(true, false) - 1, measure)).toEqual({ subtitle: false, words: true });
    expect(fitOffLine(line(false, true) - 1, measure)).toEqual({ subtitle: false, words: false });
    expect(fitOffLine(100, measure)).toEqual({ subtitle: false, words: false });
  });

  it('shows the intro words only where they do not push the control under the text', () => {
    const actions = (words: boolean): number => (words ? withWords : marksOnly) + 8 + 22 + char('Got it') + 2;
    const beside = (words: boolean): number => 280 + 16 + actions(words);
    expect(fitIntro(beside(true), measure)).toBe(true);
    // Room beside the text for the marks alone: the words would move the control to a row of its own.
    expect(fitIntro(beside(true) - 1, measure)).toBe(false);
    // Already on a row of its own: the words when they fit across it.
    expect(fitIntro(actions(true), measure)).toBe(true);
    expect(fitIntro(actions(true) - 1, measure)).toBe(false);
  });
});
