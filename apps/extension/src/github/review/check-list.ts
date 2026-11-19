import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { actionMenuOpenFor, closeActionMenu, openActionMenu } from '../ui/action-menu';
import {
  ICON_ALERT_FILL,
  ICON_ARROW_RIGHT,
  ICON_CHECK,
  ICON_CHEVRON_RIGHT,
  ICON_DOT_FILL,
  ICON_GEAR,
  ICON_IN_PROGRESS,
  ICON_KEBAB_HORIZONTAL,
  ICON_SKIP,
  ICON_SQUARE_FILL,
  ICON_STOP,
  ICON_X_CIRCLE_FILL,
} from '../ui/icons';
import {
  checkGroupOf,
  checkGroups,
  checkListSignature,
  checkLookOf,
  checkRowLabel,
  checkWords,
  checkWordsItalic,
  GROUPING_STORAGE_KEY,
  headingsShown,
  parseExpanded,
  parseGrouping,
} from './check-list-model';
import type { CheckGlyph, CheckGroup, CheckGrouping } from './check-list-model';
import type { CrawledCheckRun } from './crawler';
import { relativeTimeElement } from './time';

export const ATTR_CHECK_LIST = 'data-geld-check-list';

const ATTR_GEAR = 'data-geld-check-gear';
const ATTR_SIGNATURE = 'data-sig';
// Mirrors panel.ts `ATTR_FOCUS`: the key a rebuilt panel gives focus back by.
const ATTR_FOCUS = 'data-geld-focus';
const CLASS = 'geld-checks';

const GLYPHS: Readonly<Record<CheckGlyph, string>> = {
  alert: ICON_ALERT_FILL,
  stop: ICON_STOP,
  check: ICON_CHECK,
  x: ICON_X_CIRCLE_FILL,
  dot: ICON_DOT_FILL,
  running: ICON_IN_PROGRESS,
  square: ICON_SQUARE_FILL,
  skip: ICON_SKIP,
};

const GLYPH_WORDS: Readonly<Record<CheckGlyph, string>> = {
  alert: 'Action required',
  stop: 'Cancelled',
  check: 'Successful',
  x: 'Failing',
  dot: 'Pending',
  running: 'In progress',
  square: 'Neutral',
  skip: 'Skipped',
};

interface Drawn {
  readonly slot: HTMLElement;
  readonly runs: readonly CrawledCheckRun[];
  readonly onChange: () => void;
}

const drawn = new WeakMap<HTMLElement, Drawn>();
const scrolled = new WeakMap<HTMLElement, number>();
let tipIds = 0;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the choice holds for this drawing only.
  }
}

function currentGrouping(): CheckGrouping {
  return parseGrouping(stored(GROUPING_STORAGE_KEY));
}

/** A square icon button in GitHub's shape, named by GitHub's own `tool-tip` where the page has one. */
function tippedButton(markup: string, words: string, attributes: Readonly<Record<string, string>>): { readonly wrap: HTMLElement; readonly button: HTMLButtonElement } {
  const button = createElement('button', { type: 'button', class: 'geld-desc-menu__button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', ...attributes }, [svgFromString(markup)]);
  const wrap = createElement('span', { class: `${CLASS}__tip-wrap`, [OWN_UI_ATTRIBUTE]: '' }, [button]);
  if (document.querySelector('tool-tip') === null) {
    button.setAttribute('aria-label', words);
    button.title = words;
    return { wrap, button };
  }
  tipIds += 1;
  const id = `geld-checks-tip-${tipIds}`;
  button.id = id;
  button.setAttribute('aria-labelledby', `${id}-tip`);
  const tip = document.createElement('tool-tip');
  for (const [name, value] of Object.entries({ id: `${id}-tip`, for: id, popover: 'manual', 'data-direction': 's', 'data-type': 'label', class: 'sr-only position-absolute', role: 'tooltip' })) {
    tip.setAttribute(name, value);
  }
  tip.textContent = words;
  wrap.append(tip);
  return { wrap, button };
}

function wordsOf(run: CrawledCheckRun): HTMLElement | null {
  const classes = `${CLASS}__words${checkWordsItalic(run) ? ` ${CLASS}__words--waiting` : ''}`;
  if (checkGroupOf(run) === 'in_progress' && run.startedAt !== undefined) {
    return createElement('span', { class: classes }, ['Started ', relativeTimeElement(run.startedAt, `${CLASS}__time`)]);
  }
  const words = checkWords(run);
  return words === '' ? null : createElement('span', { class: classes }, [words]);
}

interface RowLayout {
  readonly anyRequired: boolean;
  readonly anyDetails: boolean;
  readonly scroller: HTMLElement;
  readonly onChange: () => void;
}

function rowOf(run: CrawledCheckRun, layout: RowLayout): HTMLElement {
  const look = checkLookOf(run);
  const state = createElement('span', { class: `${CLASS}__state`, 'data-tone': look.tone, role: 'img', 'aria-label': GLYPH_WORDS[look.glyph] }, [svgFromString(GLYPHS[look.glyph])]);
  const picture =
    run.avatarUrl === undefined
      ? createElement('span', { class: `${CLASS}__picture ${CLASS}__picture--none`, 'aria-hidden': 'true' })
      : createElement('img', { class: `${CLASS}__picture`, src: run.avatarUrl, alt: '', width: '20', height: '20', decoding: 'async' });
  if (run.avatarBackground !== undefined) picture.style.backgroundColor = run.avatarBackground;
  const name = run.detailsUrl === undefined ? createElement('span', { class: `${CLASS}__name` }, [run.name]) : createElement('a', { class: `${CLASS}__name`, href: run.detailsUrl }, [run.name]);
  const words = wordsOf(run);
  const text = createElement('span', { class: `${CLASS}__text` }, words === null ? [name] : [name, words]);
  const row = createElement('li', { class: `${CLASS}__row`, 'aria-label': checkRowLabel(run.name, checkWords(run)) }, [state, picture, text]);
  // GitHub names a check in a tooltip only while its name is cut short.
  row.addEventListener('pointerenter', () => {
    if (name.scrollWidth > name.clientWidth) name.title = run.name;
    else name.removeAttribute('title');
  });
  if (layout.anyRequired) {
    const required = createElement('span', { class: `${CLASS}__required` }, ['Required']);
    if (run.required !== true) {
      required.setAttribute('aria-hidden', 'true');
      required.style.visibility = 'hidden';
    }
    row.append(required);
  }
  if (layout.anyDetails) {
    const actions = createElement('span', { class: `${CLASS}__actions` });
    const details = run.detailsUrl;
    if (details !== undefined) {
      const { wrap, button } = tippedButton(ICON_KEBAB_HORIZONTAL, 'More actions', { [ATTR_FOCUS]: `checks-more:${run.name}` });
      button.classList.add(`${CLASS}__more`);
      button.addEventListener('click', () => {
        if (actionMenuOpenFor(button)) closeActionMenu();
        else openActionMenu(button, [{ label: 'View details', icon: ICON_ARROW_RIGHT, href: details }], { label: 'More actions', scroller: layout.scroller, onClose: layout.onChange });
      });
      actions.append(wrap);
    }
    row.append(actions);
  }
  return row;
}

function groupOf(group: CheckGroup, headings: boolean, layout: RowLayout): HTMLElement {
  const bodyId = `geld-checks-group-${group.id}`;
  const open = !headings || group.id === 'all' || parseExpanded(stored(group.storageKey));
  const rows = createElement(
    'ul',
    { class: `${CLASS}__rows`, role: 'list' },
    group.runs.map((run) => rowOf(run, layout)),
  );
  const body = createElement('div', { class: `${CLASS}__group-body`, id: bodyId, role: 'group', 'aria-label': `${group.label} checks`, 'data-open': String(open) }, [
    createElement('div', { class: `${CLASS}__group-clip` }, [rows]),
  ]);
  const section = createElement('section', { class: `${CLASS}__group`, 'data-group': group.id });
  if (headings && group.id === 'all') {
    section.append(createElement('div', { class: `${CLASS}__group-head` }, [createElement('span', { class: `${CLASS}__count` }, [group.heading])]));
  } else if (headings) {
    const toggle = createElement(
      'button',
      {
        type: 'button',
        class: `${CLASS}__group-toggle`,
        'aria-expanded': String(open),
        'aria-controls': bodyId,
        'aria-label': `${open ? 'Collapse' : 'Expand'} ${group.label} group`,
        [ATTR_FOCUS]: `checks-group:${group.id}`,
      },
      [createElement('span', {}, [group.heading]), svgFromString(ICON_CHEVRON_RIGHT)],
    );
    toggle.addEventListener('click', () => {
      const next = body.getAttribute('data-open') !== 'true';
      body.setAttribute('data-open', String(next));
      toggle.setAttribute('aria-expanded', String(next));
      toggle.setAttribute('aria-label', `${next ? 'Collapse' : 'Expand'} ${group.label} group`);
      store(group.storageKey, JSON.stringify(next));
    });
    section.append(createElement('div', { class: `${CLASS}__group-head` }, [toggle]));
  }
  section.append(body);
  return section;
}

function focusKeyIn(slot: HTMLElement): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !slot.contains(active)) return null;
  return active.closest(`[${ATTR_FOCUS}]`)?.getAttribute(ATTR_FOCUS) ?? null;
}

/**
 * The head's checks drawn as GitHub's merge box lists them, where the page has no checks list to lend (a merged or
 * closed pull request, a merge box not yet expanded): the same groups, order, rows, sizes and scrolling.
 */
export function renderCheckList(slot: HTMLElement, runs: readonly CrawledCheckRun[], onChange: () => void): void {
  const grouping = currentGrouping();
  const groups = checkGroups(runs, grouping);
  const root = createElement('div', { class: CLASS, [ATTR_CHECK_LIST]: '', [ATTR_SIGNATURE]: checkListSignature(runs, grouping) });
  const layout: RowLayout = {
    anyRequired: runs.some((run) => run.required === true),
    anyDetails: runs.some((run) => run.detailsUrl !== undefined),
    scroller: root,
    onChange,
  };
  const headings = headingsShown(groups, grouping);
  const body = createElement(
    'div',
    { class: `${CLASS}__body` },
    groups.map((group) => groupOf(group, headings, layout)),
  );
  if (groups.length === 0) body.append(createElement('p', { class: `${CLASS}__empty` }, ['No checks reported yet.']));
  root.append(body);
  root.addEventListener('scroll', () => scrolled.set(slot, root.scrollTop), { passive: true });
  drawn.set(root, { slot, runs, onChange });
  const focusKey = focusKeyIn(slot);
  const top = scrolled.get(slot) ?? 0;
  slot.replaceChildren(root);
  if (top > 0) root.scrollTop = top;
  if (focusKey !== null) {
    const again = [...root.querySelectorAll<HTMLElement>(`[${ATTR_FOCUS}]`)].find((node) => node.getAttribute(ATTR_FOCUS) === focusKey);
    again?.focus({ preventScroll: true });
  }
}

/** Whether the list in `slot` was drawn from other checks, or another grouping, than these. */
export function checkListStale(slot: HTMLElement, runs: readonly CrawledCheckRun[]): boolean {
  const root = slot.querySelector(`[${ATTR_CHECK_LIST}]`);
  return root !== null && root.getAttribute(ATTR_SIGNATURE) !== checkListSignature(runs, currentGrouping());
}

function regroup(grouping: CheckGrouping): void {
  if (grouping === currentGrouping()) return;
  store(GROUPING_STORAGE_KEY, grouping);
  for (const root of document.querySelectorAll<HTMLElement>(`[${ATTR_CHECK_LIST}]`)) {
    const entry = drawn.get(root);
    if (entry !== undefined) renderCheckList(entry.slot, entry.runs, entry.onChange);
  }
}

/** Geld's own checks-settings gear, standing where GitHub's is worn while the page has a checks list. */
export function placeCheckListGear(target: HTMLElement, onChange: () => void): void {
  if (target.querySelector(`[${ATTR_GEAR}]`) !== null || target.childElementCount > 0) return;
  const { wrap, button } = tippedButton(ICON_GEAR, 'Checks settings', { [ATTR_GEAR]: '', [ATTR_FOCUS]: 'checks-gear' });
  button.addEventListener('click', () => {
    if (actionMenuOpenFor(button)) {
      closeActionMenu();
      return;
    }
    const grouping = currentGrouping();
    openActionMenu(
      button,
      [
        { label: 'Group by status', checked: grouping === 'grouped', run: () => regroup('grouped') },
        { label: 'No grouping', checked: grouping === 'ungrouped', run: () => regroup('ungrouped') },
      ],
      { label: 'Checks settings', onClose: onChange },
    );
  });
  target.append(wrap);
}

export function removeCheckListGear(target: HTMLElement): void {
  const button = target.querySelector<HTMLElement>(`[${ATTR_GEAR}]`);
  if (button === null) return;
  if (actionMenuOpenFor(button)) closeActionMenu();
  (button.closest(`.${CLASS}__tip-wrap`) ?? button).remove();
}
