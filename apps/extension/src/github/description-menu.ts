import type { BlockedBy } from './blocked-list';
import { blockedUsersUrl } from './blocked-list';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { subtreeSettled } from './react-hydration';
import { pullRequestNodeId } from './review/edit-times';
import { OVERVIEW_DESCRIPTION } from './review/overview-page';
import { fetchNonce, pullPathOf } from './timeline-comment';
import { ICON_BLOCKED, ICON_COPY, ICON_KEBAB_HORIZONTAL, ICON_LINK, ICON_LINK_EXTERNAL, ICON_REPORT } from './ui/icons';

/**
 * The Overview's description box has an Edit pencil and no ⋯, where the conversation's description has GitHub's menu
 * and every Overview comment has one with Report and Block user: so a reader could not block the person who opened
 * the pull request from it. Geld's ⋯ stands beside the pencil with what the conversation's offers (Copy link, Copy
 * Markdown) and what GitHub's Overview comment menus offer about the author (Report content, Block user, Block user
 * from the organization), sending the requests GitHub's own dialogs send (read from its bundles, Nov 2026).
 */

export interface DescriptionMenuContext {
  /** The signed-in reader's login, '' signed out. */
  readonly viewer: string;
  /** Who opened the pull request. */
  readonly author: string | null;
  /** The repository's owner, the organisation an org block is from. */
  readonly owner: string;
  /** Whether the reader's Blocked users lists were read (github.com only), so a block can be told from none. */
  readonly blocksKnown: boolean;
  readonly blocked: BlockedBy | null;
  /** GitHub showed the reader the organisation's Blocked users page: they own or moderate it. */
  readonly mayBlockFromOrg: boolean;
}

export type DescriptionAction = 'copy-link' | 'copy-markdown' | 'report' | 'block' | 'unblock' | 'block-org' | 'org-blocks';

/** What the menu offers, in GitHub's order: copying first, then what is about the author. */
export function descriptionActions(context: DescriptionMenuContext): readonly DescriptionAction[] {
  const actions: DescriptionAction[] = ['copy-link', 'copy-markdown'];
  const { author, viewer } = context;
  if (viewer === '' || author === null || author === '' || author.toLowerCase() === viewer.toLowerCase()) return actions;
  actions.push('report');
  // An App's account is no person to block, and Copilot's never is in GitHub's own menus either.
  if (!context.blocksKnown || author.toLowerCase().endsWith('[bot]') || author.toLowerCase() === 'copilot') return actions;
  actions.push(context.blocked?.personal === true ? 'unblock' : 'block');
  if (context.mayBlockFromOrg) actions.push(context.blocked?.org === true ? 'org-blocks' : 'block-org');
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
 * What GitHub's block dialogs send: a personal block to `/settings/blocked_users` (login, the content it came from and
 * where to return), an organisation's to `/organizations/<org>/settings/blocked_users` with a duration ("0": until
 * unblocked), its comments left shown and no notification, as the dialog's defaults leave them.
 */
export function blockRequest(scope: 'personal' | 'org', login: string, owner: string, contentId: string | null, returnTo: string, nonce: string): PageRequest {
  const body = new URLSearchParams();
  if (scope === 'org') body.append('duration', '0');
  if (contentId !== null) body.append('content_id', contentId);
  body.append('login', login);
  if (scope === 'personal') body.append('return_to', returnTo);
  const url = scope === 'personal' ? '/settings/blocked_users' : `/organizations/${encodeURIComponent(owner)}/settings/blocked_users`;
  return { url, init: { method: 'POST', credentials: 'same-origin', headers: verifiedHeaders(nonce), body, redirect: 'follow' } };
}

/** GitHub's personal unblock: a DELETE of the person's entry in the reader's Blocked users. */
export function unblockRequest(login: string, nonce: string): PageRequest {
  return { url: `/settings/blocked_users/${encodeURIComponent(login)}`, init: { method: 'DELETE', credentials: 'same-origin', headers: verifiedHeaders(nonce), redirect: 'follow' } };
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
  readonly danger?: boolean;
  readonly href?: string;
  readonly run?: () => void;
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
        items.push({ label: 'Copy link', icon: ICON_LINK, run: () => void navigator.clipboard.writeText(pullUrl()) });
        break;
      case 'copy-markdown':
        items.push({ label: 'Copy Markdown', icon: ICON_COPY, run: () => void copyMarkdown() });
        break;
      case 'report':
        items.push({ label: 'Report content', icon: ICON_REPORT, href: reportContentUrl(location.origin, pullUrl(), author) });
        break;
      case 'block':
        items.push({ label: 'Block user', icon: ICON_BLOCKED, danger: true, run: () => void block('personal', context) });
        break;
      case 'unblock':
        items.push({ label: 'Unblock user', icon: ICON_BLOCKED, run: () => void unblock(author) });
        break;
      case 'block-org':
        items.push({ label: 'Block user from organization', icon: ICON_BLOCKED, danger: true, run: () => void block('org', context) });
        break;
      case 'org-blocks':
        items.push({ label: 'Manage organization blocks', icon: ICON_LINK_EXTERNAL, href: blockedUsersUrl('org', context.owner) });
        break;
    }
  }
  return items;
}

/** The description's Markdown from the data GitHub's Overview reads it from (`page_data/description`, its `body`). */
async function copyMarkdown(): Promise<void> {
  const pull = pullPathOf(location.pathname);
  if (pull === null) return;
  const text = (async (): Promise<string> => {
    const response = await pageFetch(`${pull}/page_data/description`, { credentials: 'same-origin', headers: { Accept: 'application/json', ...verifiedHeaders(fetchNonce()) } });
    if (!response.ok) return '';
    const data: unknown = JSON.parse(await response.text());
    return typeof data === 'object' && data !== null && 'body' in data && typeof data.body === 'string' ? data.body : '';
  })();
  // Chrome lets a write that waits on the answer through only when it is handed the promise inside the click.
  const blob = text.then((body) => new Blob([body], { type: 'text/plain' }));
  if (typeof ClipboardItem === 'function') {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).catch(async () => navigator.clipboard.writeText(await text));
  } else await navigator.clipboard.writeText(await text);
}

async function block(scope: 'personal' | 'org', context: DescriptionMenuContext): Promise<void> {
  const login = context.author;
  if (login === null) return;
  const words =
    scope === 'personal'
      ? `Block ${login}?\n\nBlocking ${login} prevents them from interacting with your repositories, such as opening or commenting on pull requests or issues, starring, forking, or watching.`
      : `Block ${login} from the ${context.owner} organization?\n\nBlocking a user prevents them from interacting with repositories of this organization, such as opening or commenting on pull requests or issues. The block lasts until you unblock them, and their comments stay shown.`;
  if (!window.confirm(words)) return;
  const request = blockRequest(scope, login, context.owner, pullRequestNodeId(), pullUrl(), fetchNonce());
  const response = await pageFetch(request.url, request.init).catch(() => null);
  if (response?.ok === true) location.reload();
  else window.alert(`GitHub did not block ${login}${response === null ? '' : ` (${response.status})`}. Try again from their profile or your Blocked users settings.`);
}

async function unblock(login: string): Promise<void> {
  if (login === '' || !window.confirm(`Unblock ${login}?`)) return;
  const request = unblockRequest(login, fetchNonce());
  const response = await pageFetch(request.url, request.init).catch(() => null);
  if (response?.ok === true) location.reload();
  else window.alert(`GitHub did not unblock ${login}${response === null ? '' : ` (${response.status})`}. Try again from your Blocked users settings.`);
}

function openMenu(button: HTMLButtonElement): void {
  closeMenu();
  if (current === null) return;
  const element = createElement('div', { class: 'geld-quick-review__menu geld-desc-menu', [OWN_UI_ATTRIBUTE]: '', role: 'menu', 'aria-label': LABEL, tabindex: '-1' });
  const items: HTMLElement[] = [];
  for (const entry of itemsFor(current)) {
    if (entry === 'divider') {
      element.append(createElement('div', { class: 'geld-desc-menu__divider', role: 'separator' }));
      continue;
    }
    const content = [createElement('span', { class: 'geld-quick-review__menu-visual', 'aria-hidden': 'true' }, [svgFromString(entry.icon)]), createElement('span', { class: 'geld-quick-review__menu-label' }, [entry.label])];
    const attributes = { class: 'geld-quick-review__menu-item', role: 'menuitem', ...(entry.danger === true ? { 'data-danger': '' } : {}) };
    const node = entry.href !== undefined ? createElement('a', { ...attributes, href: entry.href, target: '_blank', rel: 'noopener' }, content) : createElement('button', { ...attributes, type: 'button' }, content);
    node.addEventListener('click', () => {
      closeMenu();
      button.focus({ preventScroll: true });
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
    const left = Math.max(8, Math.min(rect.right - element.offsetWidth, document.documentElement.clientWidth - element.offsetWidth - 8));
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(rect.bottom + 4)}px`;
  };
  place();
  items[0]?.focus({ preventScroll: true });
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
        items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus({ preventScroll: true });
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
