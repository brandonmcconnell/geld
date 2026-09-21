/**
 * Hover cards for the panel. After a short rest on a collapsed row, a card
 * shows who wrote the comment, when, a clamped copy of its rendered body,
 * how many more messages the thread holds, and a Reply button that opens
 * the row with the reply box. Resting on a bot's avatar or chip shows a
 * small identity card instead — GitHub has no hovercard for Apps (its own
 * bot author links carry none and `/users/<bot>/hovercard` is a 404), so
 * this stands in: icon, name, login, what it reported, and a link to the
 * App. People's avatars carry GitHub's own hovercard attributes and show
 * GitHub's card; ours steps aside for it. One card for the page, positioned
 * fixed under the host (above when there is no room), never scrolling
 * anything.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_REPLY } from '../ui/icons';

export const HOVER_DELAY_MS = 300;
/** Leaving the host toward the card: the card waits this long for the pointer to arrive. */
export const LEAVE_GRACE_MS = 350;
/** How long the pointer may rest inside the safe triangle, off both host and card, before the card lets go. */
export const TRIANGLE_GRACE_MS = 600;
/** The gap between the pointer and a row card's near edge. */
const CARD_OFFSET = 14;
/** On an element whose hover shows an identity card; the value is the login. */
export const ATTR_WHO = 'data-geld-who';
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

/** Who a bot is: what its (missing) GitHub hovercard would say. */
export interface WhoCard {
  readonly avatarSrc: string | null;
  readonly name: string;
  readonly login: string;
  readonly bot: boolean;
  /** One line under the name: the verdict on this pull request, or what kind of account it is. */
  readonly detail: string;
  /** The App's (or profile's) page. */
  readonly href: string | null;
}

export type HoverProvider = (row: HTMLElement) => HoverPreview | null;
export type WhoProvider = (login: string, host: HTMLElement) => WhoCard | null;

let provider: HoverProvider | null = null;
let whoProvider: WhoProvider | null = null;
let card: HTMLElement | null = null;
let timer: number | null = null;
let current: HTMLElement | null = null;
let installed = false;
/** Where the pointer last was, to find the host's replacement after the panel is rebuilt under an open card. */
let pointer: { readonly x: number; readonly y: number } | null = null;
/** Where the pointer was when it last left the current host: the apex of the safe triangle. */
let leavePoint: { readonly x: number; readonly y: number } | null = null;
let triangleTimer: number | null = null;
/** The host the pointer is over while it crosses the triangle; shown if the pointer settles there. */
let pendingHost: HTMLElement | null = null;

/**
 * Is `p` inside the triangle from the leave point to the card's near edge?
 * Moving from a row toward its card crosses the rows between; as long as the
 * pointer keeps heading for the card it is not a new hover.
 */
function inSafeTriangle(p: { readonly x: number; readonly y: number }): boolean {
  if (card === null || leavePoint === null) return false;
  const rect = card.getBoundingClientRect();
  // The near edge is whichever vertical edge faces the leave point; a small margin forgives a shaky hand.
  const edgeX = leavePoint.x <= rect.left ? rect.left : leavePoint.x >= rect.right ? rect.right : null;
  if (edgeX === null) return false;
  const a = leavePoint;
  const b = { x: edgeX, y: rect.top - 6 };
  const c = { x: edgeX, y: rect.bottom + 6 };
  const sign = (p1: typeof a, p2: typeof a, p3: typeof a): number => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function clearTriangle(): void {
  if (triangleTimer !== null) window.clearTimeout(triangleTimer);
  triangleTimer = null;
  pendingHost = null;
}

export function setHoverProvider(next: HoverProvider | null): void {
  provider = next;
  install();
}

export function setWhoProvider(next: WhoProvider | null): void {
  whoProvider = next;
  install();
}

function rowKey(row: Element): string | null {
  return row.getAttribute('data-geld-item') ?? row.getAttribute('data-geld-fold') ?? row.getAttribute('data-geld-sub');
}

function rowOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  // Any collapsed line that stands for a comment: an item, a fold, or a comment line (`data-geld-sub`) - a bot's run
  // summary, a person's review or remark, in the Reviews row or inside a round.
  const row = target.closest<HTMLElement>('.geld-review__row[data-geld-item], .geld-review__row[data-geld-fold], .geld-review__row[data-geld-sub]');
  return row !== null && !row.hasAttribute('data-open') ? row : null;
}

/** What the pointer is resting on: an identity host first (it sits inside rows), else a collapsed row. */
function hostOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const who = target.closest<HTMLElement>(`[${ATTR_WHO}]`);
  if (who !== null) return who;
  // A person's avatar shows GitHub's card; no row preview under it.
  if (target.closest('[data-hovercard-url]') !== null && rowOf(target) !== null) return null;
  return rowOf(target);
}

function hide(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = null;
  clearTriangle();
  leavePoint = null;
  current = null;
  card?.remove();
  card = null;
}

/** Hide after a grace period unless the pointer reaches the card (or comes back to the host) first. */
function hideSoon(): void {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(hide, LEAVE_GRACE_MS);
}

function stay(): void {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = null;
  clearTriangle();
}

function show(host: HTMLElement): void {
  const login = host.getAttribute(ATTR_WHO);
  if (login !== null) showWho(host, login);
  else showRow(host);
}

function mount(host: HTMLElement, node: HTMLElement, width: number): void {
  node.addEventListener('mouseenter', stay);
  node.addEventListener('mouseleave', (event) => {
    if (hostOf(event.relatedTarget) !== current) hideSoon();
  });
  document.body.append(node);
  place(host, node, width);
}

function showWho(host: HTMLElement, login: string): void {
  const who = whoProvider?.(login, host) ?? null;
  if (who === null) return;
  hide();
  current = host;
  const head = createElement('div', { class: `${CARD_CLASS}__head` });
  if (who.avatarSrc !== null) {
    head.append(createElement('img', { class: `${CARD_CLASS}__avatar`, 'data-kind': who.bot ? 'bot' : 'user', src: who.avatarSrc, alt: '', width: '20', height: '20' }));
  }
  head.append(createElement('span', { class: `${CARD_CLASS}__name` }, [who.name]));
  if (who.bot) head.append(createElement('span', { class: `${CARD_CLASS}__bot` }, ['bot']));
  const lines = createElement('div', { class: `${CARD_CLASS}__who` });
  if (who.login !== who.name) lines.append(createElement('div', { class: `${CARD_CLASS}__login` }, [who.login]));
  if (who.detail !== '') lines.append(createElement('div', { class: `${CARD_CLASS}__detail` }, [who.detail]));
  const children: Node[] = [head, lines];
  if (who.href !== null) {
    children.push(createElement('div', { class: `${CARD_CLASS}__foot` }, [createElement('a', { class: `${CARD_CLASS}__open`, href: who.href }, [who.bot ? 'View the App' : 'View profile'])]));
  }
  card = createElement('div', { class: `${CARD_CLASS} ${CARD_CLASS}--who`, [OWN_UI_ATTRIBUTE]: '', role: 'tooltip' }, children);
  mount(host, card, 240);
}

function showRow(row: HTMLElement): void {
  const preview = provider?.(row) ?? null;
  if (preview === null) return;
  hide();
  current = row;
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
  const rect = row.getBoundingClientRect();
  mount(row, card, Math.min(440, Math.max(280, rect.width - 80)));
  // Fade only what is actually cut off.
  if (body.scrollHeight > body.clientHeight + 1) body.setAttribute('data-clipped', '');
}

/**
 * The panel is rebuilt while GitHub streams the page in; a card open over
 * it then points at a host that is no longer in the document, and measuring
 * that gives (0, 0) — the card would land in the corner of the viewport.
 * Find the host's replacement under the pointer (same login, or the row
 * with the same key); failing that, the card goes.
 */
export function rehostHoverCard(): void {
  if (card === null || current === null || current.isConnected) return;
  const under = pointer === null ? null : hostOf(document.elementFromPoint(pointer.x, pointer.y));
  const same =
    under !== null &&
    (current.hasAttribute(ATTR_WHO)
      ? under.getAttribute(ATTR_WHO) === current.getAttribute(ATTR_WHO)
      : rowKey(under) === rowKey(current));
  if (!same || under === null) {
    hide();
    return;
  }
  current = under;
  place(under, card, card.getBoundingClientRect().width);
}

function place(host: HTMLElement, node: HTMLElement, width: number): void {
  if (!host.isConnected) {
    rehostHoverCard();
    return;
  }
  const rect = host.getBoundingClientRect();
  node.style.width = `${width}px`;
  if (host.hasAttribute(ATTR_WHO) || pointer === null) {
    // Under an avatar or chip the card hangs from the host.
    node.style.left = `${Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 8))}px`;
    const height = node.getBoundingClientRect().height;
    const below = rect.bottom + 6;
    node.style.top = below + height <= window.innerHeight - 8 ? `${below}px` : `${Math.max(8, rect.top - height - 6)}px`;
    return;
  }
  // A row's card sits beside the pointer, not under the row: the rows are a column, and a card hanging below
  // covered the next rows so the pointer could not travel down the list. Right of the pointer, or left of it
  // when the right edge is near; its top on the row's top, kept inside the viewport.
  const rightOf = pointer.x + CARD_OFFSET;
  const fitsRight = rightOf + width <= window.innerWidth - 8;
  node.style.left = `${fitsRight ? rightOf : Math.max(8, pointer.x - CARD_OFFSET - width)}px`;
  const height = node.getBoundingClientRect().height;
  node.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
}

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'mouseover',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      const host = hostOf(event.target);
      if (host === null) {
        if (card !== null && event.target instanceof Node && card.contains(event.target)) {
          stay();
          return;
        }
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        // GitHub's own hovercard is about to open (a person's avatar): step aside.
        if (event.target instanceof Element && event.target.closest('[data-hovercard-url]') !== null) hide();
        return;
      }
      if (host === current) {
        stay();
        return;
      }
      // Crossing another row on the way to the open card: the card stays and this row waits; it is shown only if
      // the pointer settles on it (or leaves the triangle).
      if (card !== null && leavePoint !== null && inSafeTriangle(pointer)) {
        pendingHost = host;
        return;
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => show(host), HOVER_DELAY_MS);
    },
    true,
  );
  // While a card is open, every move decides: inside the card or the triangle it stays; elsewhere it lets go.
  document.addEventListener(
    'mousemove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (card === null || current === null || leavePoint === null) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && (card.contains(target) || current.contains(target))) {
        leavePoint = null;
        stay();
        return;
      }
      if (inSafeTriangle(pointer)) return;
      // Off the path: the row under the pointer takes over now, or the card goes.
      const under = hostOf(target);
      leavePoint = null;
      clearTriangle();
      if (under !== null && under !== current) show(under);
      else hideSoon();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'mouseout',
    (event) => {
      const host = hostOf(event.target);
      if (host === null) return;
      const to = event.relatedTarget;
      if (to instanceof Node && (host.contains(to) || (card?.contains(to) ?? false))) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (current === host) {
        if (card !== null && !host.hasAttribute(ATTR_WHO)) {
          // A row's card sits beside the pointer: leaving the row toward it crosses other rows. The triangle from
          // here to the card's near edge keeps the card; the pointer resting off the path this long lets it go.
          leavePoint = { x: event.clientX, y: event.clientY };
          if (triangleTimer !== null) window.clearTimeout(triangleTimer);
          triangleTimer = window.setTimeout(() => {
            const settled = pendingHost;
            leavePoint = null;
            clearTriangle();
            if (card !== null && pointer !== null && card.contains(document.elementFromPoint(pointer.x, pointer.y))) return;
            if (settled !== null && settled.isConnected && pointer !== null && hostOf(document.elementFromPoint(pointer.x, pointer.y)) === settled) show(settled);
            else hideSoon();
          }, TRIANGLE_GRACE_MS);
          return;
        }
        hideSoon();
      }
    },
    true,
  );
  // The card is viewport-positioned; scrolling moves the host, so follow it (and drop the card once the host is off screen).
  document.addEventListener(
    'scroll',
    () => {
      if (card === null || current === null) return;
      if (!current.isConnected) {
        rehostHoverCard();
        return;
      }
      const rect = current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) hide();
      else place(current, card, card.getBoundingClientRect().width);
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
