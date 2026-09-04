import type { ChangeTotals } from '../../lib/format';
import { formatCount, pluralize } from '../../lib/format';
import type { HiddenCategory } from '../../lib/matcher';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_BEAKER, ICON_CHEVRON_RIGHT } from './icons';

export const HIDDEN_SECTION_CLASS = 'geld-hidden-section';

export interface HiddenSectionState {
  readonly category: HiddenCategory;
  readonly totals: ChangeTotals;
  readonly expanded: boolean;
  /** Some hidden files could not report their line counts (binary files). */
  readonly statsIncomplete: boolean;
}

interface HiddenSectionParts {
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly summary: HTMLElement;
  readonly additions: HTMLElement;
  readonly deletions: HTMLElement;
  readonly note: HTMLElement;
  readonly toggleLabel: HTMLElement;
}

const parts = new WeakMap<HTMLElement, HiddenSectionParts>();

function build(onToggle: () => void): HiddenSectionParts {
  const summary = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__summary` });
  const additions = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__add` });
  const deletions = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__del` });
  const note = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__note` });
  const stats = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__stats`, 'aria-hidden': 'true' }, [
    additions,
    deletions,
  ]);
  const toggleLabel = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__toggle-label` });
  const toggle = createElement(
    'button',
    { type: 'button', class: `${HIDDEN_SECTION_CLASS}__toggle`, 'aria-expanded': 'false' },
    [toggleLabel, svgFromString(ICON_CHEVRON_RIGHT)],
  );
  toggle.addEventListener('click', onToggle);

  const root = createElement(
    'div',
    {
      class: HIDDEN_SECTION_CLASS,
      [OWN_UI_ATTRIBUTE]: '',
      role: 'region',
      'aria-live': 'polite',
    },
    [
      createElement('div', { class: `${HIDDEN_SECTION_CLASS}__row` }, [
        svgFromString(ICON_BEAKER),
        summary,
        stats,
        note,
        toggle,
      ]),
    ],
  );
  return { root, toggle, summary, additions, deletions, note, toggleLabel };
}

/**
 * Ensure the "N test files hidden" section exists as the last child of the
 * diff container and reflects `state`.
 */
export function renderHiddenSection(
  container: HTMLElement,
  state: HiddenSectionState,
  onToggle: () => void,
): HTMLElement {
  let existing = Array.from(container.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(HIDDEN_SECTION_CLASS),
  );
  let section = existing === undefined ? undefined : parts.get(existing);
  if (existing !== undefined && section === undefined) {
    // Stale node restored from a Turbo/bfcache snapshot: rebuild it.
    existing.remove();
    existing = undefined;
  }
  if (section === undefined) {
    section = build(onToggle);
    parts.set(section.root, section);
    container.append(section.root);
  }

  const { category, totals, expanded } = state;
  const count = pluralize(totals.files, category.noun, category.nounPlural);
  section.summary.textContent = expanded ? `${count} shown below` : `${count} hidden`;
  section.additions.textContent = `+${formatCount(totals.additions)}`;
  section.deletions.textContent = `\u2212${formatCount(totals.deletions)}`;
  section.note.textContent = state.statsIncomplete ? 'some files report no line counts' : '';
  section.note.hidden = !state.statsIncomplete;
  section.toggleLabel.textContent = expanded ? `Hide ${category.nounPlural}` : `Show ${category.nounPlural}`;
  section.toggle.setAttribute('aria-expanded', String(expanded));
  section.root.setAttribute('aria-label', `${count} ${expanded ? 'shown' : 'hidden'} by Geld`);
  section.root.dataset.expanded = String(expanded);
  return section.root;
}

export function removeHiddenSection(container: ParentNode): void {
  for (const element of container.querySelectorAll(`.${HIDDEN_SECTION_CLASS}`)) element.remove();
}
