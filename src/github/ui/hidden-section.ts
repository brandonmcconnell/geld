import { formatCount, pluralize } from '../../lib/format';
import type { HiddenBreakdown } from '../breakdown';
import { categoryChips, hiddenNoun, hiddenNounPlural } from '../breakdown';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_BEAKER, ICON_CHEVRON_RIGHT, ICON_EYE_CLOSED } from './icons';
import type { HiddenCategory } from '../../lib/categories';

export const HIDDEN_SECTION_CLASS = 'geld-hidden-section';

export interface HiddenSectionState {
  readonly breakdown: HiddenBreakdown;
  readonly activeCategories: readonly HiddenCategory[];
  readonly expanded: boolean;
  /** Number of hidden files that still have an unchecked "Viewed" control. */
  readonly unviewedCount: number;
}

export interface HiddenSectionHandlers {
  readonly onToggle: () => void;
  readonly onMarkViewed: () => void;
}

interface HiddenSectionParts {
  readonly root: HTMLElement;
  readonly icon: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly summary: HTMLElement;
  readonly chips: HTMLElement;
  readonly additions: HTMLElement;
  readonly deletions: HTMLElement;
  readonly note: HTMLElement;
  readonly toggleLabel: HTMLElement;
  readonly markViewed: HTMLButtonElement;
}

const parts = new WeakMap<HTMLElement, HiddenSectionParts>();

function build(handlers: HiddenSectionHandlers): HiddenSectionParts {
  const icon = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__icon` });
  const summary = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__summary` });
  const chips = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__chips` });
  const additions = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__add` });
  const deletions = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__del` });
  const note = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__note` });
  const stats = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__stats`, 'aria-hidden': 'true' }, [additions, deletions]);
  const toggleLabel = createElement('span', { class: `${HIDDEN_SECTION_CLASS}__toggle-label` });
  const toggle = createElement(
    'button',
    { type: 'button', class: `${HIDDEN_SECTION_CLASS}__toggle`, 'aria-expanded': 'false' },
    [toggleLabel, svgFromString(ICON_CHEVRON_RIGHT)],
  );
  toggle.addEventListener('click', handlers.onToggle);

  const markViewed = createElement(
    'button',
    { type: 'button', class: `${HIDDEN_SECTION_CLASS}__viewed`, hidden: '' },
    ['Mark as viewed'],
  );
  markViewed.addEventListener('click', handlers.onMarkViewed);

  const root = createElement(
    'div',
    { class: HIDDEN_SECTION_CLASS, [OWN_UI_ATTRIBUTE]: '', role: 'region', 'aria-live': 'polite' },
    [createElement('div', { class: `${HIDDEN_SECTION_CLASS}__row` }, [icon, summary, chips, stats, note, toggle, markViewed])],
  );
  return { root, icon, toggle, summary, chips, additions, deletions, note, toggleLabel, markViewed };
}

/**
 * Ensure the "N files hidden" section exists as the last child of the diff
 * container and reflects `state`.
 */
export function renderHiddenSection(
  container: HTMLElement,
  state: HiddenSectionState,
  handlers: HiddenSectionHandlers,
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
    section = build(handlers);
    parts.set(section.root, section);
    container.append(section.root);
  }

  const { breakdown, expanded, activeCategories } = state;
  const single = breakdown.categories.length === 1 ? breakdown.categories[0]?.category : undefined;
  // "6 test files hidden" for one category; "9 files hidden" plus chips otherwise.
  const noun = single?.noun ?? (activeCategories.length === 1 ? hiddenNoun(activeCategories) : 'file');
  const nounPlural = single?.nounPlural ?? (activeCategories.length === 1 ? hiddenNounPlural(activeCategories) : 'files');
  const toggleNoun = single?.nounPlural ?? hiddenNounPlural(activeCategories);
  const count = pluralize(breakdown.totals.files, noun, nounPlural);

  const iconMarkup = single?.id === 'tests' || (single === undefined && activeCategories.length === 1) ? ICON_BEAKER : ICON_EYE_CLOSED;
  if (section.icon.dataset.icon !== iconMarkup) {
    section.icon.dataset.icon = iconMarkup;
    section.icon.replaceChildren(svgFromString(iconMarkup));
  }

  section.summary.textContent = expanded ? `${count} shown below` : `${count} hidden`;
  const chips = categoryChips(breakdown);
  section.chips.textContent = chips;
  section.chips.hidden = chips === '';
  section.additions.textContent = `+${formatCount(breakdown.totals.additions)}`;
  section.deletions.textContent = `\u2212${formatCount(breakdown.totals.deletions)}`;
  section.note.textContent = breakdown.incomplete ? 'some files report no line counts' : '';
  section.note.hidden = !breakdown.incomplete;
  section.toggleLabel.textContent = expanded ? `Hide ${toggleNoun}` : `Show ${toggleNoun}`;
  section.toggle.setAttribute('aria-expanded', String(expanded));
  section.markViewed.hidden = state.unviewedCount === 0;
  section.markViewed.textContent =
    state.unviewedCount === 0
      ? ''
      : state.unviewedCount === breakdown.totals.files
        ? 'Mark as viewed'
        : `Mark ${formatCount(state.unviewedCount)} as viewed`;
  section.root.setAttribute('aria-label', `${count} ${expanded ? 'shown' : 'hidden'} by Geld`);
  section.root.dataset.expanded = String(expanded);
  return section.root;
}

export function removeHiddenSection(container: ParentNode): void {
  for (const element of container.querySelectorAll(`.${HIDDEN_SECTION_CLASS}`)) element.remove();
}
