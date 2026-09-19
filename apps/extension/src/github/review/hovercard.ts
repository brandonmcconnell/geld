/**
 * Hover preview for a collapsed row: after a short rest on the row, a card
 * shows who wrote the comment, when, a clamped copy of its rendered body,
 * how many more messages the thread holds, and a Reply button that opens
 * the row with the reply box. One card for the page, positioned fixed under
 * the row (above when there is no room), never scrolling anything.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_REPLY } from '../ui/icons';

export const HOVER_DELAY_MS = 300;
/** Leaving the row toward the card: the card waits this long for the pointer to arrive. */
export const LEAVE_GRACE_MS = 350;
let leaveTimer: number | null = null;
const CARD_CLASS = 'geld-review-hovercard';

export interface HoverPreview {
  readonly avatarSrc: string | null;
  readonly name: string;
  readonly bot: boolean;
  readonly time: string;
  /** The comment's rendered body, already cloned; shown clamped. */
  readonly body: HTMLElement | null;
  /** Further messages in the thread beyond the one shown. */
  readonly more: number;
  readonly onReply: (() => void) | null;
  /** Open the row: one more way in, always offered. */
  readonly onOpen: () => void;
}

export type HoverProvider = (row: HTMLElement) => HoverPreview | null;

let provider: HoverProvider | null = null;
let card: HTMLElement | null = null;
let timer: number | null = null;
let currentRow: HTMLElement | null = null;
let installed = false;

export function setHoverProvider(next: HoverProvider | null): void {
  provider = next;
  install();
}

function rowOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>('.geld-review__row[data-geld-item], .geld-review__row[data-geld-fold]');
  return row !== null && !row.hasAttribute('data-open') ? row : null;
}

function hide(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = null;
  currentRow = null;
  card?.remove();
  card = null;
}

/** Hide after a grace period unless the pointer reaches the card (or comes back to the row) first. */
function hideSoon(): void {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(hide, LEAVE_GRACE_MS);
}

function stay(): void {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = null;
}

function show(row: HTMLElement): void {
  const preview = provider?.(row) ?? null;
  if (preview === null) return;
  hide();
  currentRow = row;
  const head = createElement('div', { class: `${CARD_CLASS}__head` });
  if (preview.avatarSrc !== null) {
    head.append(createElement('img', { class: `${CARD_CLASS}__avatar`, 'data-kind': preview.bot ? 'bot' : 'user', src: preview.avatarSrc, alt: '', width: '20', height: '20' }));
  }
  head.append(createElement('span', { class: `${CARD_CLASS}__name` }, [preview.name]));
  if (preview.bot) head.append(createElement('span', { class: `${CARD_CLASS}__bot` }, ['bot']));
  if (preview.time !== '') head.append(createElement('span', { class: `${CARD_CLASS}__time` }, [preview.time]));
  // Capped and faded rather than line-clamped: tables and code blocks ignore line clamps.
  const body = createElement('div', { class: `${CARD_CLASS}__body` });
  if (preview.body !== null) body.append(preview.body);
  const foot = createElement('div', { class: `${CARD_CLASS}__foot` });
  if (preview.more > 0) foot.append(createElement('span', { class: `${CARD_CLASS}__more` }, [`+ ${preview.more} more message${preview.more === 1 ? '' : 's'}`]));
  const open = createElement('button', { type: 'button', class: `${CARD_CLASS}__open` }, [preview.more > 0 ? 'See full thread' : 'See full comment']);
  open.addEventListener('click', () => {
    hide();
    preview.onOpen();
  });
  foot.append(open);
  if (preview.onReply !== null) {
    const reply = createElement('button', { type: 'button', class: `${CARD_CLASS}__reply` }, [svgFromString(ICON_REPLY), createElement('span', {}, ['Reply'])]);
    const onReply = preview.onReply;
    reply.addEventListener('click', () => {
      hide();
      onReply();
    });
    foot.append(reply);
  }
  card = createElement('div', { class: CARD_CLASS, [OWN_UI_ATTRIBUTE]: '', role: 'tooltip' }, [head, body, foot]);
  card.addEventListener('mouseenter', stay);
  card.addEventListener('mouseleave', (event) => {
    if (rowOf(event.relatedTarget) !== currentRow) hideSoon();
  });
  document.body.append(card);
  // Fade only what is actually cut off.
  if (body.scrollHeight > body.clientHeight + 1) body.setAttribute('data-clipped', '');
  place(row, card);
}

function place(row: HTMLElement, node: HTMLElement): void {
  const rect = row.getBoundingClientRect();
  const width = Math.min(440, Math.max(280, rect.width - 80));
  node.style.width = `${width}px`;
  node.style.left = `${Math.max(8, Math.min(rect.left + 40, window.innerWidth - width - 8))}px`;
  const height = node.getBoundingClientRect().height;
  const below = rect.bottom + 6;
  node.style.top = below + height <= window.innerHeight - 8 ? `${below}px` : `${Math.max(8, rect.top - height - 6)}px`;
}

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'mouseover',
    (event) => {
      const row = rowOf(event.target);
      if (row === null) {
        if (card !== null && event.target instanceof Node && card.contains(event.target)) {
          stay();
          return;
        }
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        return;
      }
      if (row === currentRow) {
        stay();
        return;
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => show(row), HOVER_DELAY_MS);
    },
    true,
  );
  document.addEventListener(
    'mouseout',
    (event) => {
      const row = rowOf(event.target);
      if (row === null) return;
      const to = event.relatedTarget;
      if (to instanceof Node && (row.contains(to) || (card?.contains(to) ?? false))) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (currentRow === row) hideSoon();
    },
    true,
  );
  // The card is viewport-positioned; scrolling moves the row, so follow it (and drop the card once the row is off screen).
  document.addEventListener(
    'scroll',
    () => {
      if (card === null || currentRow === null) return;
      const rect = currentRow.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) hide();
      else place(currentRow, card);
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'mousedown',
    (event) => {
      if (card !== null && event.target instanceof Node && card.contains(event.target)) return;
      hide();
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}

export function hideHoverCard(): void {
  hide();
}
