/**
 * How pull requests look, as one choice of three (`DigestView`): Geld's digest
 * with GitHub's timeline folded into it, GitHub's timeline alone, or both.
 * Offered by the digest's intro and its View menu, and by the line under the
 * description while the digest is off, so the way back in is always where
 * the reader left it. Each view is named by marks first (Geld's, GitHub's)
 * and a word; both's words show only where they fit (`view-fit.ts`).
 */

import type { DigestView } from '@geld/core';
import { createElement, svgFromString } from '../dom';
import { ICON_MARK_GITHUB } from '../ui/icons';
import { brandMark } from './brand';

export type ViewPart =
  | { readonly kind: 'mark'; readonly brand: 'geld' | 'github' }
  /** `optional`: words that give way when the choice is short of room. */
  | { readonly kind: 'text'; readonly text: string; readonly optional?: boolean };

export interface DigestViewOption {
  readonly view: DigestView;
  /** The view in words, for labels and the View control's name. */
  readonly label: string;
  readonly hint: string;
  readonly parts: readonly ViewPart[];
}

const GELD: ViewPart = { kind: 'mark', brand: 'geld' };
const GITHUB: ViewPart = { kind: 'mark', brand: 'github' };

export const DIGEST_VIEW_OPTIONS: readonly DigestViewOption[] = [
  { view: 'digest', label: 'Digest', hint: 'Geld’s digest, with GitHub’s timeline folded into it', parts: [GELD, { kind: 'text', text: 'Digest' }] },
  { view: 'github', label: 'Timeline', hint: 'GitHub’s own timeline, with the digest off', parts: [GITHUB, { kind: 'text', text: 'Timeline' }] },
  {
    view: 'digest-timeline',
    label: 'Digest + Timeline',
    hint: 'Geld’s digest above GitHub’s full timeline',
    parts: [GELD, { kind: 'text', text: 'Digest', optional: true }, { kind: 'text', text: '+' }, GITHUB, { kind: 'text', text: 'Timeline', optional: true }],
  },
];

export function digestViewLabel(view: DigestView): string {
  return DIGEST_VIEW_OPTIONS.find((option) => option.view === view)?.label ?? view;
}

function viewMark(brand: 'geld' | 'github'): HTMLElement {
  if (brand === 'geld') {
    const mark = brandMark('geld-view-mark');
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', 'Geld');
    return mark;
  }
  const svg = svgFromString(ICON_MARK_GITHUB);
  svg.setAttribute('aria-hidden', 'true');
  return createElement('span', { class: 'geld-view-mark', role: 'img', 'aria-label': 'GitHub' }, [svg]);
}

/** A view's marks and words, in a row. */
export function viewLabel(option: DigestViewOption): HTMLElement {
  return createElement(
    'span',
    { class: 'geld-view-label' },
    option.parts.map((part) => (part.kind === 'mark' ? viewMark(part.brand) : createElement('span', { class: part.optional === true ? 'geld-view-label__words' : 'geld-view-label__text' }, [part.text]))),
  );
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
    const button = createElement('button', { type: 'button', class: 'geld-view-choice__option', 'aria-pressed': String(pressed), title: option.hint, 'data-view': option.view, ...focusKey(option.view) }, [viewLabel(option)]);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onChoose(option.view);
    });
    group.append(button);
  }
  return group;
}
