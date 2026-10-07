/**
 * The Review tab in GitHub's pull request tab bar, after Files changed. A
 * clone of the Files changed tab (so it wears whatever GitHub's markup wears
 * on both experiences) with its own words, icon, href and counter, stamped
 * as Geld's own so the controller ignores its mutations. GitHub has no
 * `/pull/N/review` route, so the tab points at the files page at
 * `#review`; on the files page itself the switch is a `pushState`, the
 * DOM staying as it is, and anywhere else a navigation.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { REVIEW_TAB_HASH } from '../page';
import { ICON_CHECKLIST } from '../ui/icons';

const ATTR_TAB = 'data-geld-review-tab-link';
const ATTR_WAS_CURRENT = 'data-geld-was-current';
/** The class tokens that marked the Files changed tab selected, space-joined, so they can go back (and onto the Review tab while it is up). */
const ATTR_WAS_SELECTED = 'data-geld-was-selected';

/**
 * A class that says "selected" on a tab: Primer's `selected`, or the React
 * header's hashed `…-module__selected__g5kH0` (Oct 2026). The React header
 * sets both the class and `aria-current`, and re-renders them back, so the
 * link is watched while the Review view is up.
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

/** The Review tab's URL from the Files changed tab's (keeps `?w=1` and the `/files` or `/changes` spelling GitHub uses). */
export function reviewTabUrl(filesHref: string): URL {
  const url = new URL(filesHref, location.origin);
  url.hash = REVIEW_TAB_HASH;
  return url;
}

export interface ReviewTabLinkState {
  /** The Review view is what the page shows now. */
  readonly active: boolean;
  /** "3/12" once a plan exists, else null. */
  readonly counter: string | null;
  /** On the files page the tab switches views in place; `null` leaves the link a plain navigation. */
  readonly onSwitch: ((toReview: boolean) => void) | null;
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

/** While the Review view is up, React may render the Files changed tab selected again; take it off at once. */
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

/** Put the Review tab after Files changed (once), and keep its state current. Idempotent per pass. */
export function ensureReviewTabLink(state: ReviewTabLinkState): void {
  const files = filesTabLink();
  if (files === null) return;
  const filesSlot = slotOf(files);
  let own = filesSlot.parentElement?.querySelector<HTMLElement>(`[${ATTR_TAB}]`) ?? null;
  if (own === null) {
    own = buildTab(filesSlot);
    filesSlot.insertAdjacentElement('afterend', own);
  }
  const link = own instanceof HTMLAnchorElement ? own : own.querySelector<HTMLAnchorElement>('a');
  if (link === null) return;
  const url = reviewTabUrl(files.href);
  link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
  link.dataset.geldSwitch = state.onSwitch === null ? '' : 'inplace';
  switcher = state.onSwitch;
  const selectedClasses = selectedClassesOf(files);
  if (state.active) {
    link.setAttribute('aria-current', 'page');
    for (const token of selectedClasses) link.classList.add(token);
    markSelected(files, false);
  } else {
    link.removeAttribute('aria-current');
    for (const token of [...link.classList].filter(isSelectedClass)) link.classList.remove(token);
    markSelected(files, true);
  }
  watchFilesTab(files, state.active);
  const counter = link.querySelector<HTMLElement>(`.${COUNTER_CLASS}`);
  if (counter !== null) {
    counter.hidden = state.counter === null;
    if (counter.textContent !== (state.counter ?? '')) counter.textContent = state.counter ?? '';
  }
}

const COUNTER_CLASS = 'geld-review-tab-link__counter';
let switcher: ((toReview: boolean) => void) | null = null;

/** A clone of the Files changed tab with Geld's words: the same classes, so it wears GitHub's styling on either experience. */
function buildTab(filesSlot: HTMLElement): HTMLElement {
  const slot = filesSlot.cloneNode(true);
  if (!(slot instanceof HTMLElement)) return createElement('span');
  slot.setAttribute(OWN_UI_ATTRIBUTE, '');
  slot.setAttribute(ATTR_TAB, '');
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
  const ours = svgFromString(ICON_CHECKLIST);
  if (icon !== null) {
    // Keep GitHub's sizing classes on the icon, swap the drawing.
    ours.setAttribute('class', `${icon.getAttribute('class') ?? 'octicon'} octicon-checklist`.replace(/octicon-file-diff/, '').trim());
    icon.replaceWith(ours);
  }
  // Every text node that is not inside the counter becomes "Review" once; the rest go.
  let named = false;
  const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Text && !counter.contains(node)) texts.push(node);
  for (const text of texts) {
    if (text.nodeValue?.trim() === '') continue;
    if (named) text.nodeValue = '';
    else {
      text.nodeValue = text.nodeValue?.replace(/\S[\s\S]*\S|\S/, 'Review') ?? 'Review';
      named = true;
    }
  }
  if (!named) {
    link.append(' Review ');
  }
  if (!link.contains(counter)) link.append(' ', counter);
  link.setAttribute('aria-label', 'Review');
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (switcher === null) return;
    event.preventDefault();
    event.stopPropagation();
    switcher(true);
  });
  return slot;
}

/**
 * The Files changed tab, clicked while the Review view is up: switch back
 * in place rather than letting GitHub reload the page it already has.
 */
export function interceptFilesTab(onSwitch: (toReview: boolean) => void): () => void {
  const handler = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]') ?? null;
    if (link === null || link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null || link !== filesTabLink()) return;
    event.preventDefault();
    event.stopPropagation();
    onSwitch(false);
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
