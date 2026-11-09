// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonCard } from './person-hovercard';
import { removePersonHovercards, syncPersonHovercards } from './person-hovercard';

/** GitHub's shared user hovercard, open on a person (Nov 2026 shape, reduced). */
const HOVERCARD = `
  <div class="js-hovercard-content" data-hovercard-target-url="/users/someone/hovercard">
    <div class="Popover-message"><div class="position-relative"><div>someone</div></div></div>
  </div>`;

const form = document.createElement('form');

function card(overrides: Partial<PersonCard>): ReadonlyMap<string, PersonCard> {
  return new Map([['someone', { words: 'Blocked by you', blocked: { org: false, personal: true }, hideForms: () => [form], unhide: null, ...overrides }]]);
}

const buttons = (): string[] => [...document.querySelectorAll('.geld-person-card button')].map((button) => button.textContent ?? '');

afterEach(() => {
  removePersonHovercards();
  document.body.innerHTML = '';
});

describe('syncPersonHovercards', () => {
  it('gains Unhide on an open card once GitHub’s Unhide form lands', () => {
    document.body.innerHTML = HOVERCARD;
    syncPersonHovercards(card({}));
    expect(buttons()).toEqual(['Hide their comment']);
    syncPersonHovercards(card({ unhide: () => undefined }));
    expect(buttons()).toEqual(['Hide their comment', 'Unhide']);
  });

  it('keeps the reason the reader picked when the card is made again', () => {
    document.body.innerHTML = HOVERCARD;
    syncPersonHovercards(card({}));
    document.querySelector<HTMLButtonElement>('.geld-person-card button')?.click();
    const select = document.querySelector('.geld-person-card select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('no reason picker');
    select.value = 'SPAM';
    syncPersonHovercards(card({ unhide: () => undefined }));
    const kept = document.querySelector('.geld-person-card select');
    expect(kept instanceof HTMLSelectElement ? kept.value : null).toBe('SPAM');
    expect(buttons()).toEqual(['Hide', 'Unhide']);
  });
});
