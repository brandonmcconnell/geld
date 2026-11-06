// @vitest-environment happy-dom
import type { DigestView } from '@geld/core';
import { describe, expect, it } from 'vitest';
import { DIGEST_VIEW_OPTIONS, viewChoice } from './digest-view';

describe('viewChoice', () => {
  it('offers the three views in order with the current one pressed', () => {
    const choice = viewChoice('digest-timeline', () => undefined);
    const buttons = [...choice.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Digest only', 'Digest and timeline', 'GitHub only']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons.map((button) => button.title)).toEqual(DIGEST_VIEW_OPTIONS.map((option) => option.hint));
  });

  it('reports every press, the current view included, which is how the intro is answered as it is', () => {
    const chosen: DigestView[] = [];
    const choice = viewChoice('digest', (view) => chosen.push(view));
    for (const button of choice.querySelectorAll('button')) button.click();
    expect(chosen).toEqual(['digest', 'digest-timeline', 'github']);
  });
});
