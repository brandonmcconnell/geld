/**
 * A comment a person posted through a GitHub App (a review left via
 * Replicas, a comment via a CI bot) wears the App's mark in the corner of
 * their picture on GitHub's timeline, linking to the App. The chat's byline
 * wears the same small mark, and the person's hovercard says which App it
 * was, with the link: GitHub's own user hovercard is one shared element
 * refilled per hover, so while a marked avatar or name is under the pointer
 * the card for that login gets a "via" line appended once its body lands.
 */

import { createElement } from '../dom';

export interface ViaBot {
  /** The App's name, as GitHub's alt text has it ("Replicas Connector"). */
  readonly name: string;
  readonly src: string;
  readonly href: string;
}

const VIA_LINE_CLASS = 'geld-review__via-line';
/** How long after the pointer leaves the mark its login stays armed: GitHub opens the card a beat later. */
const DISARM_MS = 600;

let armed: { readonly login: string; readonly via: ViaBot } | null = null;
let disarmTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

/** The App a comment was posted through, read from the timeline row's avatar pair; null when posted directly. */
export function viaBotOf(root: Element | null): ViaBot | null {
  if (root === null) return null;
  const link = root.querySelector<HTMLAnchorElement>('.avatar-parent-child a[href*="/apps/"]');
  const img = link?.querySelector<HTMLImageElement>('img.avatar-child, img');
  if (link === null || link === undefined || img === null || img === undefined) return null;
  const name = (img.getAttribute('alt') ?? '').trim();
  const src = img.getAttribute('src') ?? '';
  if (name === '' || src === '') return null;
  return { name, src, href: link.href };
}

/** Arm the hovercard for `login` while `element` is under the pointer; the first time, start watching the card. */
export function armViaHovercard(element: HTMLElement, login: string, via: ViaBot): void {
  element.addEventListener('mouseenter', () => {
    if (disarmTimer !== null) clearTimeout(disarmTimer);
    disarmTimer = null;
    armed = { login, via };
    decorateCards();
  });
  element.addEventListener('mouseleave', () => {
    if (disarmTimer !== null) clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => {
      armed = null;
      disarmTimer = null;
    }, DISARM_MS);
  });
  watchCards();
}

function watchCards(): void {
  if (observer !== null) return;
  observer = new MutationObserver(() => {
    if (armed !== null) decorateCards();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hovercard-target-url', 'style'] });
}

function decorateCards(): void {
  if (armed === null) return;
  const wanted = `/users/${armed.login}/hovercard`.toLowerCase();
  for (const card of document.querySelectorAll<HTMLElement>('.js-hovercard-content')) {
    if ((card.getAttribute('data-hovercard-target-url') ?? '').toLowerCase() !== wanted) continue;
    if (card.querySelector(`.${VIA_LINE_CLASS}`) !== null) continue;
    // The card's rows live in the body's `position-relative` box; the line joins them as one more row.
    const rows = card.querySelector<HTMLElement>('.Popover-message .position-relative') ?? card.querySelector<HTMLElement>('.Popover-message');
    if (rows === null || rows.childElementCount === 0) continue;
    rows.append(viaLine(armed.via));
  }
}

function viaLine(via: ViaBot): HTMLElement {
  return createElement('div', { class: `d-flex flex-items-center f6 mt-2 ${VIA_LINE_CLASS}` }, [
    createElement('span', { class: 'geld-review__via-word' }, ['Posted via']),
    createElement('a', { class: 'geld-review__via-app', href: via.href, target: '_blank', rel: 'noreferrer' }, [createElement('img', { class: 'geld-review__via-icon', src: via.src, alt: '', width: '16', height: '16' }), via.name]),
  ]);
}
