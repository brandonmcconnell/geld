/**
 * How pull requests look, as one choice of three (`DigestView`): Geld's digest
 * with GitHub's timeline folded into it, the digest above GitHub's whole
 * timeline, or GitHub's page alone. Offered by the digest's intro and its View
 * menu, and by the line under the description while the digest is off, so the
 * way back in is always where the reader left it.
 */

import type { DigestView } from '@geld/core';
import { DIGEST_VIEWS } from '@geld/core';
import { createElement } from '../dom';

export interface DigestViewOption {
  readonly view: DigestView;
  readonly label: string;
  readonly hint: string;
}

export const DIGEST_VIEW_OPTIONS: readonly DigestViewOption[] = DIGEST_VIEWS.map((view) => {
  if (view === 'digest') return { view, label: 'Digest only', hint: 'Geld’s digest, with GitHub’s timeline folded into it' };
  if (view === 'digest-timeline') return { view, label: 'Digest and timeline', hint: 'Geld’s digest above GitHub’s full timeline' };
  return { view, label: 'GitHub only', hint: 'GitHub’s own page, with the digest off' };
});

export function digestViewLabel(view: DigestView): string {
  return DIGEST_VIEW_OPTIONS.find((option) => option.view === view)?.label ?? view;
}

/**
 * The three views as a segmented control, the current one pressed. A press on
 * the current view still counts as a choice: it is how the intro is answered
 * without changing anything.
 */
export function viewChoice(current: DigestView, onChoose: (view: DigestView) => void, focusKey: (view: DigestView) => Readonly<Record<string, string>> = () => ({})): HTMLElement {
  const group = createElement('div', { class: 'geld-view-choice', role: 'group', 'aria-label': 'How pull requests look' });
  for (const option of DIGEST_VIEW_OPTIONS) {
    const pressed = option.view === current;
    const button = createElement('button', { type: 'button', class: 'geld-view-choice__option', 'aria-pressed': String(pressed), title: option.hint, ...focusKey(option.view) }, [option.label]);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onChoose(option.view);
    });
    group.append(button);
  }
  return group;
}
