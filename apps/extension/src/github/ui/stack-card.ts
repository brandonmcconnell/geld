import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import type { PageStack, StackPullState } from '../stack';
import { ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT } from './icons';

/**
 * The card a Related work stack row opens on hover or focus: the stack as GitHub's own stack popover lists it (the
 * header's "11/14" button), its title linking to the stack's page and one line per pull request, top first, the
 * page's own marked. Drawn by Geld from the stack GitHub embeds: GitHub's popover belongs to its header's React tree.
 */

const CARD_CLASS = 'geld-stack-card';
const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 200;
const GAP = 8;
const MARGIN = 8;

const STATE: Readonly<Record<StackPullState, { readonly icon: string; readonly word: string }>> = {
  open: { icon: ICON_GIT_PULL_REQUEST, word: 'Open' },
  draft: { icon: ICON_GIT_PULL_REQUEST_DRAFT, word: 'Draft' },
  merged: { icon: ICON_GIT_MERGE, word: 'Merged' },
  closed: { icon: ICON_GIT_PULL_REQUEST_CLOSED, word: 'Closed' },
};

/** The card's markup. Exported for its test. */
export function stackCard(stack: PageStack): HTMLElement {
  const title = createElement('a', { class: `${CARD_CLASS}__title`, href: stack.path }, [`Stack #${stack.number}`]);
  const count = stack.position === null ? null : createElement('span', { class: `${CARD_CLASS}__count` }, [`${stack.position} of ${stack.size}`]);
  const items = stack.pulls.map((pull) => {
    const glyph = svgFromString(STATE[pull.state].icon);
    glyph.classList.add(`${CARD_CLASS}__state`);
    glyph.setAttribute('data-state', pull.state);
    glyph.setAttribute('aria-label', STATE[pull.state].word);
    glyph.setAttribute('role', 'img');
    const meta = [`#${pull.number}`, pull.headBranch].filter((part) => part !== '').join(' · ');
    const link = createElement('a', { class: `${CARD_CLASS}__link`, href: pull.path, ...(pull.current ? { 'aria-current': 'page' } : {}) }, [
      glyph,
      createElement('span', { class: `${CARD_CLASS}__text` }, [
        createElement('span', { class: `${CARD_CLASS}__pull` }, [pull.title || `#${pull.number}`]),
        createElement('span', { class: `${CARD_CLASS}__meta` }, [meta]),
      ]),
    ]);
    return createElement('li', { class: `${CARD_CLASS}__item` }, [link]);
  });
  return createElement('div', { class: CARD_CLASS, role: 'dialog', 'aria-label': `Stack #${stack.number}`, [OWN_UI_ATTRIBUTE]: '' }, [
    createElement('div', { class: `${CARD_CLASS}__header` }, [title, ...(count === null ? [] : [count])]),
    createElement('ul', { class: `${CARD_CLASS}__list` }, items),
  ]);
}

interface Shown {
  readonly host: HTMLElement;
  readonly card: HTMLElement;
  readonly abort: AbortController;
}

let shown: Shown | null = null;
let showTimer: number | null = null;
let hideTimer: number | null = null;

function clearTimers(): void {
  if (showTimer !== null) window.clearTimeout(showTimer);
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  showTimer = null;
  hideTimer = null;
}

export function hideStackCard(): void {
  clearTimers();
  if (shown === null) return;
  shown.abort.abort();
  shown.card.remove();
  shown.host.removeAttribute('aria-expanded');
  shown = null;
}

/** Under the row, its right edge on the row's (the sidebar is at the page's right), inside the viewport. */
function place(card: HTMLElement, host: HTMLElement): void {
  const row = host.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const left = Math.max(MARGIN, Math.min(row.right - width, window.innerWidth - width - MARGIN));
  const below = row.bottom + GAP;
  const top = below + height <= window.innerHeight - MARGIN || row.top - GAP - height < MARGIN ? below : row.top - GAP - height;
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
}

/** The card's links, in order: its title, then one per pull request. */
const linksOf = (card: HTMLElement): HTMLAnchorElement[] => [...card.querySelectorAll<HTMLAnchorElement>('a[href]')];

/** Focus back on the opener, which must not open the card again for it. */
let returning = false;

function returnFocus(host: HTMLElement): void {
  returning = true;
  host.focus();
  returning = false;
}

/**
 * Keys inside the card: arrows move between its links, the first one's Up returns to the opener, and Escape or Tab
 * closes the card with focus back on the opener (the card is appended to the body, so Tab would leave the page).
 */
function cardKeys(event: KeyboardEvent, card: HTMLElement, host: HTMLElement): void {
  const links = linksOf(card);
  const index = links.findIndex((link) => link === document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) returnFocus(host);
    else links[Math.min(next, links.length - 1)]?.focus();
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    hideStackCard();
    returnFocus(host);
  }
}

function show(host: HTMLElement, stack: () => PageStack | null): void {
  clearTimers();
  if (shown?.host === host) return;
  hideStackCard();
  const current = stack();
  if (current === null || !host.isConnected) return;
  const card = stackCard(current);
  document.body.append(card);
  place(card, host);
  // Within the list only: `scrollIntoView` would scroll the page too, and that scroll would close the card.
  const list = card.querySelector<HTMLElement>(`.${CARD_CLASS}__list`);
  const mark = card.querySelector<HTMLElement>('[aria-current="page"]');
  if (list !== null && mark !== null) list.scrollTop = Math.max(0, mark.offsetTop - list.offsetTop - (list.clientHeight - mark.offsetHeight) / 2);
  host.setAttribute('aria-expanded', 'true');
  const abort = new AbortController();
  card.addEventListener('mouseenter', clearTimers, { signal: abort.signal });
  card.addEventListener('mouseleave', () => hideSoon(), { signal: abort.signal });
  card.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || (!card.contains(event.relatedTarget) && !host.contains(event.relatedTarget))) hideSoon();
  }, { signal: abort.signal });
  card.addEventListener('keydown', (event) => cardKeys(event, card, host), { signal: abort.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !card.contains(document.activeElement)) hideStackCard();
  }, { signal: abort.signal });
  // The page scrolling moves the opener away; the card's own list scrolling does not.
  window.addEventListener('scroll', (event) => {
    if (!(event.target instanceof Node) || !card.contains(event.target)) hideStackCard();
  }, { signal: abort.signal, passive: true, capture: true });
  shown = { host, card, abort };
}

/** Closes a card whose opener has left the page: the sidebar redrawn, or replaced by GitHub. */
export function syncStackCard(): void {
  if (shown !== null && !shown.host.isConnected) hideStackCard();
}

function hideSoon(): void {
  if (showTimer !== null) window.clearTimeout(showTimer);
  showTimer = null;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideStackCard, HIDE_DELAY_MS);
}

/**
 * Hover or focus on `host` opens the card, read from `stack` at that moment; leaving both closes it. From the opener,
 * Down moves focus into the card, to the page's own pull request.
 */
export function attachStackCard(host: HTMLElement, stack: () => PageStack | null): void {
  host.setAttribute('aria-haspopup', 'dialog');
  host.setAttribute('aria-keyshortcuts', 'ArrowDown');
  host.addEventListener('mouseenter', () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
    if (shown?.host === host) return;
    if (showTimer !== null) window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(host, stack), SHOW_DELAY_MS);
  });
  host.addEventListener('mouseleave', () => hideSoon());
  host.addEventListener('focus', () => {
    if (!returning) show(host, stack);
  });
  host.addEventListener('blur', (event) => {
    if (!(event.relatedTarget instanceof Node) || !shown?.card.contains(event.relatedTarget)) hideSoon();
  });
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    show(host, stack);
    if (shown?.host !== host) return;
    const card = shown.card;
    (card.querySelector<HTMLAnchorElement>('[aria-current="page"]') ?? linksOf(card)[0])?.focus();
  });
}
