import type { GitLabNativeNoteCapabilities, GitLabNativeThreadCapabilities } from './review';
import type { ProviderReviewInput } from '@geld/review';
import { mapProviderSourceSelection, selectionMatches, selectionRanges } from '../providers/source-selection';
import type { ProviderSourceActionContext } from '../providers/source-selection';

export type GitLabThreadAction = 'reply' | 'resolve' | 'reopen' | 'react' | 'edit' | 'quote' | 'menu';

export interface GitLabThreadTarget {
  readonly discussionId: string;
  readonly noteId: string;
  readonly url: string;
}

export interface GitLabThreadActionOptions {
  readonly signedIn: boolean;
  readonly onReveal?: (target: GitLabThreadTarget) => boolean | void | Promise<boolean | void>;
  readonly context?: ProviderSourceActionContext;
}

export interface GitLabThreadActionDescriptor {
  readonly kind: GitLabThreadAction;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
  activate(context?: ProviderSourceActionContext): Promise<boolean>;
}

const LABELS: Readonly<Record<GitLabThreadAction, string>> = {
  reply: 'Reply', resolve: 'Resolve thread', reopen: 'Reopen thread', react: 'Add reaction', edit: 'Edit comment', quote: 'Quote reply', menu: 'Comment actions',
};

function validTarget(target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities): boolean {
  return /^[a-f0-9]{8,64}$/.test(target.discussionId) && /^[1-9]\d*$/.test(target.noteId)
    && target.discussionId === permissions.discussionId && permissions.notes.some((note) => note.noteId === target.noteId);
}

function sameNativeReview(doc: Document, target: GitLabThreadTarget): boolean {
  try {
    const source = new URL(target.url);
    const current = new URL(doc.URL);
    const review = (url: URL): string | null => /^(.*\/-\/merge_requests\/[1-9]\d*)(?:\/diffs)?\/?$/.exec(url.pathname)?.[1] ?? null;
    return ['https:', 'http:'].includes(source.protocol) && source.username === '' && source.password === '' && source.origin === current.origin
      && review(source) !== null && review(source) === review(current) && source.hash === `#note_${target.noteId}`;
  } catch { return false; }
}

function ownedElement(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.closest('[data-geld-ui]') === null;
}

function discussion(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return [...doc.querySelectorAll<HTMLElement>('[data-testid="discussion-content"][data-discussion-id]')]
    .find((element) => element.getAttribute('data-discussion-id') === target.discussionId && ownedElement(element)) ?? null;
}

function noteElement(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  const element = doc.getElementById(`note_${target.noteId}`);
  if (!ownedElement(element) || !element.matches('[data-testid="noteable-note-container"]')) return null;
  const parent = element.closest('[data-discussion-id]');
  return parent === null || parent.getAttribute('data-discussion-id') === target.discussionId ? element : null;
}

function enabled(button: HTMLElement | null): button is HTMLElement {
  return button !== null && button.isConnected && !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true'
    && button.closest('[hidden], [aria-hidden="true"], [inert]') === null;
}

function buttonIn(root: ParentNode | null, selector: string): HTMLElement | null {
  const element = root?.querySelector<HTMLElement>(selector) ?? null;
  return element === null ? null : element.matches('button, [role="button"], [role="menuitem"]') ? element : element.querySelector<HTMLElement>('button, [role="button"], [role="menuitem"]');
}

function nativeNotePermissions(target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities): GitLabNativeNoteCapabilities | null {
  return permissions.notes.find((note) => note.noteId === target.noteId) ?? null;
}

function replyField(doc: Document, target: GitLabThreadTarget): HTMLTextAreaElement | null {
  const root = discussion(doc, target) ?? noteElement(doc, target);
  const field = root?.querySelector<HTMLTextAreaElement>('textarea[data-testid="reply-field"]') ?? null;
  return field !== null && !field.disabled && !field.readOnly && field.closest('[hidden], [aria-hidden="true"], [inert]') === null ? field : null;
}

function replyControl(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return buttonIn(noteElement(doc, target), 'button[data-track-label="reply_comment_button"], button.js-reply-button');
}

function menuControl(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return buttonIn(noteElement(doc, target), '.more-actions button[data-testid="base-dropdown-toggle"]');
}

function menuOf(doc: Document, toggle: HTMLElement): HTMLElement | null {
  const id = toggle.getAttribute('aria-controls');
  if (id === null || /\s/.test(id)) return null;
  const menu = doc.getElementById(id);
  if (!ownedElement(menu)) return null;
  const owner = toggle.closest('.more-actions');
  if (owner !== null && menu.closest('.more-actions') === owner) return menu;
  const labelled = [menu, ...menu.querySelectorAll<HTMLElement>('[aria-labelledby]')]
    .some((node) => (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).includes(toggle.id));
  return toggle.id !== '' && labelled ? menu : null;
}

function editControl(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  const direct = buttonIn(noteElement(doc, target), 'button.js-note-edit');
  if (enabled(direct)) return direct;
  const toggle = menuControl(doc, target);
  return toggle === null ? null : buttonIn(menuOf(doc, toggle), '[data-testid="edit-note-action"]');
}

function resolveControl(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return buttonIn(discussion(doc, target), '[data-testid="resolve-discussion-button"]');
}

function reactionControl(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return buttonIn(noteElement(doc, target), '[data-testid="note-emoji-button"]');
}

function bodyOf(doc: Document, target: GitLabThreadTarget): HTMLElement | null {
  return noteElement(doc, target)?.querySelector<HTMLElement>('.note-body .note-text') ?? null;
}

function currentResolved(doc: Document, target: GitLabThreadTarget): boolean | null {
  const value = discussion(doc, target)?.getAttribute('data-discussion-resolved');
  return value === 'true' ? true : value === 'false' ? false : null;
}

function hasPermission(kind: GitLabThreadAction, target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities, options: GitLabThreadActionOptions): boolean {
  if (!validTarget(target, permissions)) return false;
  if (kind === 'menu') return true;
  if (!options.signedIn) return false;
  const note = nativeNotePermissions(target, permissions);
  if (kind === 'edit') return note?.canEdit === true;
  if (kind === 'react') return note?.canReact === true;
  if (kind === 'resolve' || kind === 'reopen') return permissions.resolvable && permissions.canResolve;
  return true;
}

function available(kind: GitLabThreadAction, doc: Document, target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities, options: GitLabThreadActionOptions): boolean {
  if (!hasPermission(kind, target, permissions, options) || !sameNativeReview(doc, target)) return false;
  if (kind === 'reply') return replyField(doc, target) !== null || enabled(replyControl(doc, target));
  if (kind === 'quote') return discussion(doc, target) !== null && bodyOf(doc, target) !== null && (replyField(doc, target) !== null || enabled(replyControl(doc, target)));
  if (kind === 'resolve' || kind === 'reopen') return currentResolved(doc, target) === (kind === 'reopen') && enabled(resolveControl(doc, target));
  if (kind === 'react') return enabled(reactionControl(doc, target));
  if (kind === 'edit') return enabled(editControl(doc, target)) || enabled(menuControl(doc, target));
  return enabled(menuControl(doc, target));
}

async function waitFor<T>(doc: Document, read: () => T | null, current: () => boolean = () => true): Promise<T | null> {
  if (!current()) return null;
  const present = read();
  if (present !== null) return present;
  const view = doc.defaultView;
  if (view === null) return null;
  return new Promise((resolve) => {
    const observer = new view.MutationObserver(() => {
      if (!current()) { finish(null); return; }
      const next = read();
      if (next !== null) finish(next);
    });
    const timer = view.setTimeout(() => finish(null), 1500);
    const finish = (value: T | null): void => {
      observer.disconnect();
      view.clearTimeout(timer);
      resolve(value);
    };
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  });
}

async function quoteReply(doc: Document, target: GitLabThreadTarget, options: GitLabThreadActionOptions, current: () => boolean): Promise<boolean> {
  const root = discussion(doc, target);
  const body = bodyOf(doc, target);
  const view = doc.defaultView;
  const selection = doc.getSelection();
  if (root === null || body === null || view === null || selection === null) return false;
  const saved = selectionRanges(doc);
  const focused = doc.activeElement;
  const bodyText = body.textContent;
  const selectedHere = selection.rangeCount > 0 && !selection.isCollapsed && body.contains(selection.anchorNode) && body.contains(selection.focusNode);
  const excerpt = options.context?.selection;
  let replacement: Range | null = null;
  if (!selectedHere && excerpt !== undefined) {
    replacement = mapProviderSourceSelection(excerpt, body, target.noteId, `note_${target.noteId}`, target.url);
    if (replacement === null) return false;
  } else if (!selectedHere) {
    replacement = doc.createRange();
    replacement.selectNodeContents(body);
  }
  if (!current()) return false;
  if (replacement !== null) {
    selection.removeAllRanges();
    selection.addRange(replacement);
  }
  const applied = selectionRanges(doc);
  const here = (): boolean => current() && discussion(doc, target) === root && bodyOf(doc, target) === body && body.textContent === bodyText;
  root.dispatchEvent(new view.CustomEvent('quoteReply', { bubbles: true }));
  const field = await waitFor(doc, () => replyField(doc, target), here);
  if (!here()) return false;
  if (field !== null) {
    if (doc.activeElement === field) return true;
    if (!selectionMatches(doc, applied) || doc.activeElement !== focused) return false;
    field.focus();
    return true;
  }
  if (replacement !== null && selectionMatches(doc, applied) && doc.activeElement === focused) {
    selection.removeAllRanges();
    for (const range of saved) {
      if (range.commonAncestorContainer.isConnected) selection.addRange(range);
    }
  }
  return false;
}

export async function activateGitLabThreadAction(kind: GitLabThreadAction, doc: Document, target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities, options: GitLabThreadActionOptions): Promise<boolean> {
  if (!hasPermission(kind, target, permissions, options) || !sameNativeReview(doc, target)) return false;
  const visit = doc.URL.split('#')[0];
  const current = (): boolean => doc.URL.split('#')[0] === visit && sameNativeReview(doc, target) && options.context?.current?.() !== false;
  if (!current()) return false;
  const beforeReveal = kind === 'quote' ? selectionRanges(doc) : [];
  const focused = doc.activeElement;
  if (options.onReveal !== undefined && await options.onReveal(target) === false) return false;
  if (!current()) return false;
  if (kind === 'quote' && (!selectionMatches(doc, beforeReveal) || doc.activeElement !== focused)) return false;
  if (!available(kind, doc, target, permissions, options)) return false;
  if (kind === 'quote') return quoteReply(doc, target, options, current);
  if (kind === 'reply') {
    if (replyField(doc, target) === null) replyControl(doc, target)?.click();
    const field = await waitFor(doc, () => replyField(doc, target));
    if (doc.URL.split('#')[0] !== visit) return false;
    field?.focus();
    return field !== null;
  }
  if (kind === 'edit') {
    let control = editControl(doc, target);
    if (!enabled(control)) {
      const toggle = menuControl(doc, target);
      if (!enabled(toggle)) return false;
      toggle.click();
      control = await waitFor(doc, () => {
        const candidate = editControl(doc, target);
        return enabled(candidate) ? candidate : null;
      });
    }
    if (doc.URL.split('#')[0] !== visit || !enabled(control)) return false;
    control.click();
    const field = await waitFor(doc, () => noteElement(doc, target)?.querySelector<HTMLTextAreaElement>('textarea:not([disabled]):not([readonly])') ?? null);
    if (doc.URL.split('#')[0] !== visit) return false;
    field?.focus();
    return field !== null;
  }
  const control = kind === 'react' ? reactionControl(doc, target) : kind === 'menu' ? menuControl(doc, target) : resolveControl(doc, target);
  if (!enabled(control)) return false;
  control.click();
  return true;
}

export function readGitLabThreadActions(doc: Document, target: GitLabThreadTarget, permissions: GitLabNativeThreadCapabilities, options: GitLabThreadActionOptions): readonly GitLabThreadActionDescriptor[] {
  const resolved = currentResolved(doc, target) ?? permissions.resolved;
  const kinds: readonly GitLabThreadAction[] = ['reply', resolved ? 'reopen' : 'resolve', 'react', 'edit', 'quote', 'menu'];
  return kinds.map((kind) => {
    const canActivate = available(kind, doc, target, permissions, options);
    return {
      kind,
      label: LABELS[kind],
      available: canActivate,
      ...(!canActivate ? { reason: !options.signedIn && kind !== 'menu' ? 'Sign in to GitLab to use this action.' : 'This action is unavailable in the original GitLab thread.' } : {}),
      activate: (context) => activateGitLabThreadAction(kind, doc, target, permissions, context === undefined ? options : { ...options, context }),
    };
  });
}

export function syncGitLabNativeReviewState(input: ProviderReviewInput, doc: Document): ProviderReviewInput {
  let changed = false;
  const threads = input.threads.map((thread) => {
    const note = thread.comments[0];
    if (note === undefined) return thread;
    const root = discussion(doc, { discussionId: thread.id, noteId: note.id, url: note.url });
    if (root?.getAttribute('data-discussion-resolvable') !== 'true') return thread;
    const state = root.getAttribute('data-discussion-resolved');
    if (state !== 'true' && state !== 'false') return thread;
    const resolved = state === 'true';
    if (resolved === thread.resolved) return thread;
    changed = true;
    return { ...thread, resolved };
  });
  return changed ? { ...input, threads } : input;
}
