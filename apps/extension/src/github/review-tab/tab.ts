/**
 * Geld's tabs in GitHub's pull request tab bar, after Files changed: Review
 * and Diagram. Each is a clone of the Files changed tab (so it wears
 * whatever GitHub's markup wears on both experiences) with its own words,
 * icon, href and, for Review, a counter, stamped as Geld's own so the
 * controller ignores its mutations. GitHub has no `/pull/N/review` route, so
 * the tabs point at the files page at `#review` and `#diagram`; on the files
 * page itself the switch is a `pushState`, the DOM staying as it is, and
 * anywhere else a navigation.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import type { ReviewTabMode } from '../page';
import { DIAGRAM_TAB_HASH, REVIEW_TAB_HASH } from '../page';
import { ICON_CHECKLIST, ICON_WORKFLOW } from '../ui/icons';

const ATTR_TAB = 'data-geld-review-tab-link';
const ATTR_WAS_CURRENT = 'data-geld-was-current';
/** The class tokens that marked the Files changed tab selected, space-joined, so they can go back (and onto a Geld tab while it is up). */
const ATTR_WAS_SELECTED = 'data-geld-was-selected';

/** Where a tab click goes: GitHub's files view, or one of Geld's tabs. */
export type TabTarget = 'files' | ReviewTabMode;

/**
 * A class that says "selected" on a tab: Primer's `selected`, or the React
 * header's hashed `…-module__selected__g5kH0` (Oct 2026). The React header
 * sets both the class and `aria-current`, and re-renders them back, so the
 * link is watched while a Geld tab is up.
 */
function isSelectedClass(token: string): boolean {
  return token === 'selected' || /(^|__)selected(__|$)/i.test(token);
}
/** The tab bar: the classic `tabnav` (files page, Oct 2026), the React header's "Pull request navigation" (conversation page). */
const NAV = 'nav[aria-label="Pull request tabs"], nav[aria-label="Pull request navigation"], nav.tabnav-tabs, .tabnav-tabs';
const FILES_TAB = /\/pull\/\d+\/(?:files|changes)(?:[/?#]|$)/;

/** GitHub's own Files changed tab link in the tab bar, when the bar is on the page. */
export function filesTabLink(): HTMLAnchorElement | null {
  for (const nav of document.querySelectorAll(NAV)) {
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
      if (FILES_TAB.test(link.getAttribute('href') ?? '')) return link;
    }
  }
  return null;
}

/** A Geld tab's URL from the Files changed tab's (keeps `?w=1` and the `/files` or `/changes` spelling GitHub uses). */
export function reviewTabUrl(filesHref: string, mode: ReviewTabMode = 'review'): URL {
  const url = new URL(filesHref, location.origin);
  url.hash = mode === 'review' ? REVIEW_TAB_HASH : DIAGRAM_TAB_HASH;
  return url;
}

export interface ReviewTabLinkState {
  /** Which Geld tab the page shows now, or null for GitHub's files view (or another PR page). */
  readonly active: ReviewTabMode | null;
  /** "3/12" once a plan exists, else null. */
  readonly counter: string | null;
  /** On the files page the tabs switch views in place; `null` leaves the links plain navigations. */
  readonly onSwitch: ((target: TabTarget) => void) | null;
}

/** The slot of a tab: its `li` when the bar is a list, else the link itself. */
function slotOf(link: HTMLAnchorElement): HTMLElement {
  const parent = link.parentElement;
  return parent instanceof HTMLLIElement ? parent : link;
}

/** Take the selected look off GitHub's Files changed tab (remembering it), or give it back. Idempotent. */
function markSelected(link: HTMLAnchorElement, selected: boolean): void {
  if (selected) {
    if (link.hasAttribute(ATTR_WAS_CURRENT)) link.setAttribute('aria-current', link.getAttribute(ATTR_WAS_CURRENT) ?? 'page');
    for (const token of (link.getAttribute(ATTR_WAS_SELECTED) ?? '').split(' ')) if (token !== '') link.classList.add(token);
    link.removeAttribute(ATTR_WAS_CURRENT);
    link.removeAttribute(ATTR_WAS_SELECTED);
    return;
  }
  const current = link.getAttribute('aria-current');
  if (current !== null) {
    link.setAttribute(ATTR_WAS_CURRENT, current);
    link.removeAttribute('aria-current');
  }
  const selectedTokens = [...link.classList].filter(isSelectedClass);
  if (selectedTokens.length > 0) {
    const known = (link.getAttribute(ATTR_WAS_SELECTED) ?? '').split(' ').filter((token) => token !== '');
    link.setAttribute(ATTR_WAS_SELECTED, [...new Set([...known, ...selectedTokens])].join(' '));
    for (const token of selectedTokens) link.classList.remove(token);
  }
}

/** The selected classes GitHub uses on this tab bar: what the Files changed tab wears or wore. */
function selectedClassesOf(files: HTMLAnchorElement): readonly string[] {
  const worn = [...files.classList].filter(isSelectedClass);
  const remembered = (files.getAttribute(ATTR_WAS_SELECTED) ?? '').split(' ').filter((token) => token !== '');
  const tokens = [...new Set([...worn, ...remembered])];
  return tokens.length > 0 ? tokens : ['selected'];
}

let filesWatcher: { readonly link: HTMLAnchorElement; readonly observer: MutationObserver } | null = null;

/** While a Geld tab is up, React may render the Files changed tab selected again; take it off at once. */
function watchFilesTab(files: HTMLAnchorElement, active: boolean): void {
  if (!active || filesWatcher?.link !== files) {
    filesWatcher?.observer.disconnect();
    filesWatcher = null;
  }
  if (!active || filesWatcher !== null) return;
  const observer = new MutationObserver(() => {
    if (files.getAttribute('aria-current') !== null || [...files.classList].some(isSelectedClass)) markSelected(files, false);
  });
  observer.observe(files, { attributes: true, attributeFilter: ['class', 'aria-current'] });
  filesWatcher = { link: files, observer };
}

interface TabSpec {
  readonly mode: ReviewTabMode;
  readonly word: string;
  readonly icon: string;
  readonly iconClass: string;
}

const TABS: readonly TabSpec[] = [
  { mode: 'review', word: 'Review', icon: ICON_CHECKLIST, iconClass: 'octicon-checklist' },
  { mode: 'diagram', word: 'Diagram', icon: ICON_WORKFLOW, iconClass: 'octicon-workflow' },
];

/** Put Geld's tabs after Files changed (once), and keep their state current. Idempotent per pass. */
export function ensureReviewTabLink(state: ReviewTabLinkState): void {
  const files = filesTabLink();
  if (files === null) return;
  const filesSlot = slotOf(files);
  const bar = filesSlot.parentElement;
  if (bar === null) return;
  switcher = state.onSwitch;
  const selectedClasses = selectedClassesOf(files);
  let after: HTMLElement = filesSlot;
  for (const spec of TABS) {
    let own = bar.querySelector<HTMLElement>(`[${ATTR_TAB}="${spec.mode}"]`);
    if (own === null) {
      own = buildTab(filesSlot, spec);
      after.insertAdjacentElement('afterend', own);
    }
    after = own;
    const link = own instanceof HTMLAnchorElement ? own : own.querySelector<HTMLAnchorElement>('a');
    if (link === null) continue;
    const url = reviewTabUrl(files.href, spec.mode);
    link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
    link.dataset.geldSwitch = state.onSwitch === null ? '' : 'inplace';
    if (state.active === spec.mode) {
      link.setAttribute('aria-current', 'page');
      for (const token of selectedClasses) link.classList.add(token);
    } else {
      link.removeAttribute('aria-current');
      for (const token of [...link.classList].filter(isSelectedClass)) link.classList.remove(token);
    }
    const counter = link.querySelector<HTMLElement>(`.${COUNTER_CLASS}`);
    if (counter !== null) {
      const words = spec.mode === 'review' ? state.counter : null;
      counter.hidden = words === null;
      if (counter.textContent !== (words ?? '')) counter.textContent = words ?? '';
    }
  }
  markSelected(files, state.active === null);
  watchFilesTab(files, state.active !== null);
}

const COUNTER_CLASS = 'geld-review-tab-link__counter';
let switcher: ((target: TabTarget) => void) | null = null;

/** A clone of the Files changed tab with Geld's words: the same classes, so it wears GitHub's styling on either experience. */
function buildTab(filesSlot: HTMLElement, spec: TabSpec): HTMLElement {
  const slot = filesSlot.cloneNode(true);
  if (!(slot instanceof HTMLElement)) return createElement('span');
  slot.setAttribute(OWN_UI_ATTRIBUTE, '');
  slot.setAttribute(ATTR_TAB, spec.mode);
  slot.removeAttribute('id');
  const link = slot instanceof HTMLAnchorElement ? slot : slot.querySelector<HTMLAnchorElement>('a');
  if (link === null) return slot;
  for (const attribute of ['id', 'aria-current', 'data-turbo-frame', 'data-pjax', 'data-hotkey', 'data-hydro-click', 'data-hydro-click-hmac', 'data-selected-links', 'data-tab-item', 'data-testid', 'data-discover', ATTR_WAS_CURRENT, ATTR_WAS_SELECTED]) link.removeAttribute(attribute);
  for (const token of [...link.classList].filter(isSelectedClass)) link.classList.remove(token);
  // GitHub's counter element keeps its class (so it looks like the neighbours'), the words and icon are Geld's.
  const githubCounter = [...link.querySelectorAll<HTMLElement>('*')].find((element) => /\bCounter\b/.test(element.className) || element.getAttribute('data-component') === 'CounterLabel' || /counter/i.test(element.id));
  const counter = githubCounter ?? createElement('span', { class: 'Counter' });
  counter.classList.add(COUNTER_CLASS);
  counter.removeAttribute('id');
  counter.removeAttribute('title');
  counter.textContent = '';
  counter.hidden = true;
  const icon = link.querySelector('svg');
  const ours = svgFromString(spec.icon);
  if (icon !== null) {
    // Keep GitHub's sizing classes on the icon, swap the drawing.
    ours.setAttribute('class', `${icon.getAttribute('class') ?? 'octicon'} ${spec.iconClass}`.replace(/octicon-file-diff/, '').trim());
    icon.replaceWith(ours);
  }
  // Every text node that is not inside the counter becomes the tab's word once; the rest go.
  let named = false;
  const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Text && !counter.contains(node)) texts.push(node);
  for (const text of texts) {
    if (text.nodeValue?.trim() === '') continue;
    if (named) text.nodeValue = '';
    else {
      text.nodeValue = text.nodeValue?.replace(/\S[\s\S]*\S|\S/, spec.word) ?? spec.word;
      named = true;
    }
  }
  if (!named) {
    link.append(` ${spec.word} `);
  }
  if (!link.contains(counter)) link.append(' ', counter);
  link.setAttribute('aria-label', spec.word);
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (switcher === null) return;
    event.preventDefault();
    event.stopPropagation();
    switcher(spec.mode);
  });
  return slot;
}

/**
 * The Files changed tab, clicked while a Geld tab is up: switch back in
 * place rather than letting GitHub reload the page it already has.
 */
export function interceptFilesTab(onSwitch: (target: TabTarget) => void): () => void {
  const handler = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]') ?? null;
    if (link === null || link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null || link !== filesTabLink()) return;
    event.preventDefault();
    event.stopPropagation();
    onSwitch('files');
  };
  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}

export function removeReviewTabLink(): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${ATTR_TAB}]`)) element.remove();
  filesWatcher?.observer.disconnect();
  filesWatcher = null;
  const files = filesTabLink();
  if (files !== null) markSelected(files, true);
  switcher = null;
}
