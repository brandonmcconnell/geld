import type { BlockChoices, BlockScope } from './block-dialog';
import { BLOCK_DURATIONS, openBlockDialog, openUnblockDialog } from './block-dialog';
import type { BlockedBy } from './blocked-list';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { subtreeSettled } from './react-hydration';
import { pullRequestNodeId } from './review/edit-times';
import { OVERVIEW_DESCRIPTION } from './review/overview-page';
import { fetchNonce, pullPathOf } from './timeline-comment';
import { ICON_COPY, ICON_KEBAB_HORIZONTAL, ICON_LINK, ICON_OCTAGON_BLOCKED, ICON_REPORT } from './ui/icons';

/**
 * The Overview's description box has an Edit pencil and no ⋯, where the conversation's description has GitHub's menu
 * and every Overview comment has one with Report and Block user: so a reader could not block the person who opened
 * the pull request from it. Geld's ⋯ stands beside the pencil with what the conversation's offers (Copy link, Copy
 * Markdown) and what GitHub's Overview comment menus offer about the author (Report content, Block user, Block user
 * from the organization, and unblocking), sending the requests GitHub's own dialogs and settings pages send.
 */

export interface DescriptionMenuContext {
  /** The signed-in reader's login, '' signed out. */
  readonly viewer: string;
  /** Who opened the pull request. */
  readonly author: string | null;
  /** The repository's owner, the organisation an org block is from. */
  readonly owner: string;
  /** Whether the reader's own Blocked users list was read (github.com only), so a block can be told from none. */
  readonly blocksKnown: boolean;
  readonly blocked: BlockedBy | null;
  /** GitHub showed the reader the organisation's Blocked users page: they own or moderate it. */
  readonly mayBlockFromOrg: boolean;
}

export type DescriptionAction = 'copy-link' | 'copy-markdown' | 'report' | 'block' | 'unblock' | 'block-org' | 'unblock-org';

/** What the menu offers, in GitHub's order: copying first, then what is about the author. */
export function descriptionActions(context: DescriptionMenuContext): readonly DescriptionAction[] {
  const actions: DescriptionAction[] = ['copy-link', 'copy-markdown'];
  const { author, viewer } = context;
  if (viewer === '' || author === null || author === '' || author.toLowerCase() === viewer.toLowerCase()) return actions;
  actions.push('report');
  // An App's account is no person to block, and Copilot's never is in GitHub's own menus either.
  if (author.toLowerCase().endsWith('[bot]') || author.toLowerCase() === 'copilot') return actions;
  if (context.blocksKnown) actions.push(context.blocked?.personal === true ? 'unblock' : 'block');
  if (context.mayBlockFromOrg) actions.push(context.blocked?.org === true ? 'unblock-org' : 'block-org');
  return actions;
}

/** GitHub's report form for the pull request, as its Overview comment menus link it. */
export function reportContentUrl(origin: string, pullUrl: string, author: string): string {
  return `${origin}/contact/report-content?content_url=${encodeURIComponent(pullUrl)}&report=${author}+(user)`;
}

export interface PageRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function verifiedHeaders(nonce: string): Record<string, string> {
  const headers: Record<string, string> = { 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' };
  if (nonce !== '') headers['X-Fetch-Nonce'] = nonce;
  return headers;
}

/**
 * What GitHub's block dialogs send, in their order: a personal block to `/settings/blocked_users` (login, the content it
 * came from, where to return, the note, whether to close their content), an organisation's to
 * `/organizations/<org>/settings/blocked_users` with the duration ("0": until unblocked), whether to hide their comments
 * and why, the note, whether to notify them and whether to close their content.
 */
export function blockRequest(scope: BlockScope, login: string, owner: string, contentId: string | null, returnTo: string, choices: BlockChoices, nonce: string): PageRequest {
  const body = new URLSearchParams();
  if (scope === 'org') body.append('duration', BLOCK_DURATIONS[choices.duration].value);
  if (contentId !== null) body.append('content_id', contentId);
  body.append('login', login);
  if (scope === 'personal') body.append('return_to', returnTo);
  if (scope === 'org' && choices.hideReason !== null) {
    body.append('hide_comments', 'on');
    body.append('hidden_reason', choices.hideReason);
  }
  if (choices.note.trim() !== '') body.append('note', choices.note);
  if (scope === 'org' && choices.notify) body.append('send_notification', 'on');
  if (choices.closeContent) body.append('close_content', '1');
  const url = scope === 'personal' ? '/settings/blocked_users' : `/organizations/${encodeURIComponent(owner)}/settings/blocked_users`;
  return { url, init: { method: 'POST', credentials: 'same-origin', headers: verifiedHeaders(nonce), body, redirect: 'follow' } };
}

/** GitHub's unblock, as its Blocked users settings pages send it: a DELETE of the person's entry (their `actionUrl`). */
export function unblockRequest(scope: BlockScope, login: string, owner: string, nonce: string): PageRequest {
  const list = scope === 'personal' ? '/settings/blocked_users' : `/organizations/${encodeURIComponent(owner)}/settings/blocked_users`;
  return { url: `${list}/${encodeURIComponent(login)}`, init: { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json', ...verifiedHeaders(nonce) }, redirect: 'follow' } };
}

const ATTR_MENU = 'data-geld-desc-menu';
const BUTTON_CLASS = 'geld-desc-menu__button';
const META = `${OVERVIEW_DESCRIPTION} [class*="editMetadata"]`;
const LABEL = 'More actions for the description';

let current: DescriptionMenuContext | null = null;
let open: { readonly element: HTMLElement; readonly button: HTMLButtonElement; readonly keys: AbortController } | null = null;
let buttonIds = 0;

/** The menu's button in the description's top row, beside GitHub's Edit pencil, each pass; null takes it away. */
export function syncDescriptionMenu(context: DescriptionMenuContext | null): void {
  const meta = context === null ? null : document.querySelector(META);
  // A menu whose button left the row (GitHub drew it anew) would still offer the old page's author: it closes with it.
  if (open !== null && (meta === null || !meta.contains(open.button))) closeMenu();
  for (const stray of document.querySelectorAll(`[${ATTR_MENU}]`)) if (stray.parentElement !== meta) stray.remove();
  if (context === null || meta === null) {
    current = null;
    closeMenu();
    return;
  }
  // The row is React's: nothing of Geld's goes in before React has hydrated it (`react-hydration.ts`).
  if (!subtreeSettled(meta)) return;
  current = context;
  if (meta.querySelector(`:scope > [${ATTR_MENU}]`) !== null) return;
  meta.append(createButton());
}

export function removeDescriptionMenu(): void {
  syncDescriptionMenu(null);
}

function createButton(): HTMLElement {
  buttonIds += 1;
  const button = createElement('button', { type: 'button', id: `geld-desc-menu-${buttonIds}`, class: BUTTON_CLASS, 'aria-label': LABEL, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [svgFromString(ICON_KEBAB_HORIZONTAL)]);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (open?.button === button) closeMenu();
    else openMenu(button);
  });
  const wrap = createElement('span', { class: 'geld-desc-menu__wrap', [OWN_UI_ATTRIBUTE]: '', [ATTR_MENU]: '' }, [button]);
  if (document.querySelector('tool-tip') === null) button.title = LABEL;
  else {
    const tip = document.createElement('tool-tip');
    for (const [name, value] of Object.entries({ for: button.id, popover: 'manual', 'data-direction': 's', 'data-type': 'label', class: 'sr-only position-absolute' })) tip.setAttribute(name, value);
    tip.textContent = LABEL;
    wrap.append(tip);
  }
  return wrap;
}

interface Item {
  readonly label: string;
  readonly icon: string;
  readonly href?: string;
  readonly run?: () => void;
  /** Opens a dialog, which takes focus. */
  readonly dialog?: boolean;
}

function pullUrl(): string {
  return `${location.origin}${pullPathOf(location.pathname) ?? location.pathname}`;
}

function itemsFor(context: DescriptionMenuContext): readonly (Item | 'divider')[] {
  const author = context.author ?? '';
  const items: (Item | 'divider')[] = [];
  let divided = false;
  for (const action of descriptionActions(context)) {
    if ((action === 'report' || action === 'block' || action === 'unblock') && !divided) {
      items.push('divider');
      divided = true;
    }
    switch (action) {
      case 'copy-link':
        items.push({ label: 'Copy link', icon: ICON_LINK, run: () => void copyLink() });
        break;
      case 'copy-markdown':
        items.push({ label: 'Copy Markdown', icon: ICON_COPY, run: () => void copyMarkdown() });
        break;
      case 'report':
        items.push({ label: 'Report content', icon: ICON_REPORT, href: reportContentUrl(location.origin, pullUrl(), author) });
        break;
      case 'block':
        items.push({ label: 'Block user for you', icon: ICON_OCTAGON_BLOCKED, dialog: true, run: () => block('personal', context) });
        break;
      case 'unblock':
        items.push({ label: 'Unblock user for you', icon: ICON_OCTAGON_BLOCKED, dialog: true, run: () => unblock('personal', context) });
        break;
      case 'block-org':
        items.push({ label: 'Block user for org', icon: ICON_OCTAGON_BLOCKED, dialog: true, run: () => block('org', context) });
        break;
      case 'unblock-org':
        items.push({ label: 'Unblock user for org', icon: ICON_OCTAGON_BLOCKED, dialog: true, run: () => unblock('org', context) });
        break;
    }
  }
  return items;
}

async function copyLink(): Promise<void> {
  await navigator.clipboard.writeText(pullUrl()).catch(() => window.alert('The link could not be copied. Try again.'));
}

/** The description's Markdown from the data GitHub's Overview reads it from (`page_data/description`, its `body`). */
async function copyMarkdown(): Promise<void> {
  const pull = pullPathOf(location.pathname);
  if (pull === null) return;
  const text = (async (): Promise<string> => {
    const response = await pageFetch(`${pull}/page_data/description`, { credentials: 'same-origin', headers: { Accept: 'application/json', ...verifiedHeaders(fetchNonce()) } });
    if (!response.ok) throw new Error(`http-${response.status}`);
    const data: unknown = JSON.parse(await response.text());
    if (typeof data !== 'object' || data === null || !('body' in data) || typeof data.body !== 'string') throw new Error('no-body');
    return data.body;
  })();
  try {
    if (typeof ClipboardItem === 'function') {
      // Chrome lets a write that waits on the answer through only when it is handed the promise inside the click.
      const blob = text.then((body) => new Blob([body], { type: 'text/plain' }));
      // A write refused before it reads the text leaves this rejection to nobody; the fallback below reports it.
      blob.catch(() => undefined);
      const written = await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(
        () => true,
        () => false,
      );
      if (written) return;
    }
    // A text that never came rejects here, before anything is written: the reader's clipboard keeps what it had.
    await navigator.clipboard.writeText(await text);
  } catch {
    window.alert('GitHub did not send the description’s Markdown, so nothing was copied. Try again.');
  }
}

/** What a failed block or unblock request says in its dialog. */
function failureWords(verb: string, response: Response | null): string {
  return `GitHub did not ${verb} this user${response === null ? '' : ` (${response.status})`}. Please try again.`;
}

function block(scope: BlockScope, context: DescriptionMenuContext): void {
  const login = context.author;
  if (login === null) return;
  openBlockDialog({
    scope,
    login,
    org: context.owner,
    contentUrl: pullUrl(),
    returnFocus: menuButton(),
    onBlock: async (choices) => {
      const request = blockRequest(scope, login, context.owner, pullRequestNodeId(), pullUrl(), choices, fetchNonce());
      const response = await pageFetch(request.url, request.init).catch(() => null);
      if (response?.ok !== true) return failureWords('block', response);
      location.reload();
      return null;
    },
  });
}

function unblock(scope: BlockScope, context: DescriptionMenuContext): void {
  const login = context.author;
  if (login === null) return;
  openUnblockDialog({
    scope,
    login,
    org: context.owner,
    returnFocus: menuButton(),
    onUnblock: async () => {
      const request = unblockRequest(scope, login, context.owner, fetchNonce());
      const response = await pageFetch(request.url, request.init).catch(() => null);
      if (response?.ok !== true) return failureWords('unblock', response);
      location.reload();
      return null;
    },
  });
}

function menuButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${ATTR_MENU}] button`);
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Whether any of the button is in the window: a menu whose button scrolled out of it closes rather than float off-screen. */
export function buttonInView(button: { readonly top: number; readonly bottom: number }, viewport: number): boolean {
  return button.bottom >= 0 && button.top <= viewport;
}

/** Where the menu opens: under its button as GitHub's do, above it when only above has the room, and never past the window. */
export function menuPlacement(button: { readonly top: number; readonly bottom: number }, height: number, viewport: number): { readonly top: number; readonly maxHeight: number } {
  const below = Math.max(0, viewport - button.bottom - MENU_GAP - VIEWPORT_MARGIN);
  const above = Math.max(0, button.top - MENU_GAP - VIEWPORT_MARGIN);
  if (height <= below || below >= above) return { top: button.bottom + MENU_GAP, maxHeight: below };
  const shown = Math.min(height, above);
  return { top: button.top - MENU_GAP - shown, maxHeight: above };
}

/** The menu's scroll offset that shows an item, moving as little as possible: focus never scrolls a capped menu by itself, since `preventScroll` keeps the page still. */
export function scrollToShow(scrollTop: number, viewHeight: number, itemTop: number, itemHeight: number): number {
  if (itemTop < scrollTop) return itemTop;
  if (itemTop + itemHeight > scrollTop + viewHeight) return itemTop + itemHeight - viewHeight;
  return scrollTop;
}

function openMenu(button: HTMLButtonElement): void {
  closeMenu();
  if (current === null) return;
  const element = createElement('div', { class: 'geld-desc-menu', [OWN_UI_ATTRIBUTE]: '', role: 'menu', 'aria-label': LABEL, tabindex: '-1' });
  const items: HTMLElement[] = [];
  for (const entry of itemsFor(current)) {
    if (entry === 'divider') {
      element.append(createElement('div', { class: 'geld-desc-menu__divider', role: 'separator' }));
      continue;
    }
    const content = [createElement('span', { class: 'geld-desc-menu__visual', 'aria-hidden': 'true' }, [svgFromString(entry.icon)]), createElement('span', { class: 'geld-desc-menu__label' }, [entry.label])];
    const attributes = { class: 'geld-desc-menu__item', role: 'menuitem' };
    const node = entry.href !== undefined ? createElement('a', { ...attributes, href: entry.href, target: '_blank', rel: 'noopener' }, content) : createElement('button', { ...attributes, type: 'button' }, content);
    node.addEventListener('click', () => {
      closeMenu();
      // A dialog takes focus and gives it back on close: focused now, the button's tooltip would show over the dialog.
      if (entry.dialog !== true) button.focus({ preventScroll: true });
      entry.run?.();
    });
    items.push(node);
    element.append(node);
  }
  const keys = new AbortController();
  open = { element, button, keys };
  button.setAttribute('aria-expanded', 'true');
  document.body.append(element);
  const place = (): void => {
    if (!button.isConnected) {
      closeMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    if (!buttonInView(rect, document.documentElement.clientHeight)) {
      closeMenu();
      return;
    }
    const left = Math.max(8, Math.min(rect.right - element.offsetWidth, document.documentElement.clientWidth - element.offsetWidth - 8));
    element.style.left = `${Math.round(left)}px`;
    element.style.maxHeight = '';
    const { top, maxHeight } = menuPlacement(rect, element.offsetHeight, document.documentElement.clientHeight);
    element.style.top = `${Math.round(top)}px`;
    element.style.maxHeight = `${Math.floor(maxHeight)}px`;
  };
  place();
  const focusItem = (item: HTMLElement | undefined): void => {
    if (item === undefined) return;
    item.focus({ preventScroll: true });
    element.scrollTop = scrollToShow(element.scrollTop, element.clientHeight, item.offsetTop, item.offsetHeight);
  };
  focusItem(items[0]);
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        button.focus({ preventScroll: true });
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const at = items.findIndex((item) => item === document.activeElement);
        focusItem(items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]);
      }
    },
    { signal: keys.signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (target instanceof Node && (element.contains(target) || button.contains(target))) return;
      closeMenu();
    },
    { capture: true, signal: keys.signal },
  );
  element.addEventListener(
    'focusout',
    (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (element.contains(next) || button.contains(next))) return;
      closeMenu();
    },
    { signal: keys.signal },
  );
  window.addEventListener('scroll', place, { passive: true, signal: keys.signal });
  window.addEventListener('resize', place, { signal: keys.signal });
}

function closeMenu(): void {
  if (open === null) return;
  open.keys.abort();
  open.element.remove();
  open.button.setAttribute('aria-expanded', 'false');
  open = null;
}
