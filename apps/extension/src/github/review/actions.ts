/**
 * Panel actions delegate to GitHub's own controls so every side effect
 * (form submit, Turbo refresh, optimistic UI) is GitHub's, not ours: the
 * thread's Resolve/Unresolve button, its Reply control, the task-list
 * checkbox on the (hidden) summary comment, the new-comment form for a
 * bot trigger. None of these scroll the page; focus uses `preventScroll`.
 */

import { THREAD_SELECTOR, timelineRootOf as rowOf } from './crawler';

export function timelineRootOf(anchor: string): HTMLElement | null {
  const node = document.getElementById(anchor);
  return node === null ? null : rowOf(node);
}

/** The review-thread container that holds `anchor`, or the comment's timeline row. */
export function threadRootOf(anchor: string): HTMLElement | null {
  const node = document.getElementById(anchor);
  if (node === null) return null;
  const thread = node.closest(THREAD_SELECTOR) ?? node.closest('.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]');
  return thread instanceof HTMLElement ? thread : node;
}

/** Where a thread's controls are: its container, wherever quick view has put it (ids travel with the node). */
function scopesFor(anchor: string): readonly ParentNode[] {
  const thread = threadRootOf(anchor);
  return thread === null ? [] : [thread];
}

function buttonsIn(scope: ParentNode): readonly HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('button, summary, input[type="submit"]')];
}

function textOf(node: HTMLElement): string {
  return (node.textContent ?? node.getAttribute('aria-label') ?? node.getAttribute('value') ?? '').replace(/\s+/g, ' ').trim();
}

const RESOLVE = /^(un)?resolve conversation$/i;

function resolveButton(anchor: string): HTMLElement | null {
  for (const scope of scopesFor(anchor)) {
    const hit =
      buttonsIn(scope).find((button) => RESOLVE.test(textOf(button)) || RESOLVE.test(button.getAttribute('aria-label') ?? '')) ??
      scope.querySelector<HTMLElement>('button[data-resolved-text], form[action*="/resolve"] button, form[action*="/unresolve"] button, button[name="resolve"]');
    if (hit !== undefined && hit !== null) return hit;
  }
  return null;
}

export function isResolvable(anchor: string): boolean {
  return resolveButton(anchor) !== null;
}

/** Click GitHub's Resolve/Unresolve for the thread holding `anchor`. */
export function clickResolve(anchor: string): boolean {
  const button = resolveButton(anchor);
  if (button === null) return false;
  button.click();
  return true;
}

export function tickSummaryCheckbox(commentRoot: HTMLElement, itemAnchors: readonly string[], checked: boolean): boolean {
  const items = commentRoot.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox, input[type="checkbox"]');
  for (const box of items) {
    const row = box.closest('li, .task-list-item, p, div');
    const links = [...(row?.querySelectorAll('a[href^="#"]') ?? [])].map((link) => (link.getAttribute('href') ?? '').slice(1));
    if (!itemAnchors.some((anchor) => links.includes(anchor))) continue;
    if (box.checked === checked) return true;
    // GitHub disables the box for readers without write access; a click still
    // reaches its task-list handler when the user can edit.
    box.click();
    return box.checked === checked;
  }
  return false;
}

/** The thread's collapsed "Reply…" control (never a comment's "Quote reply" menu item, which sits earlier in the DOM). */
const REPLY_OPENER = '.review-thread-reply-button, button.js-inline-comment-form-reply, button.js-toggle-inline-comment-form, button[data-testid="comment-reply"], button[aria-label^="Reply" i]';

/** Open the reply box of the thread that holds `anchor` and focus it without scrolling. */
export function focusReply(anchor: string): boolean {
  const scopes = scopesFor(anchor);
  if (scopes.length === 0) return false;
  const find = <T extends Element>(selector: string): T | null => {
    for (const scope of scopes) {
      const hit = scope.querySelector<T>(selector);
      if (hit !== null) return hit;
    }
    return null;
  };
  const opener = find<HTMLElement>(REPLY_OPENER) ?? buttonsIn(scopes[0] ?? document).find((button) => /^reply\b/i.test(textOf(button)) && !button.matches('[role="menuitem"]')) ?? null;
  opener?.click();
  const focusBox = (): boolean => {
    const box = find<HTMLTextAreaElement>('textarea');
    if (box === null) return false;
    box.focus({ preventScroll: true });
    return true;
  };
  if (focusBox()) return true;
  window.setTimeout(focusBox, 150);
  return opener !== null;
}

/** GitHub's "Quote reply" from a comment's own ⋯ menu; the comment may be in the panel's quick view. */
export function quoteReply(anchor: string): boolean {
  const comment = document.getElementById(anchor);
  if (comment === null) return false;
  const button = comment.querySelector<HTMLElement>('.js-comment-quote-reply, [role="menuitem"][data-testid*="quote" i], button[aria-label*="Quote" i]');
  if (button === null) return false;
  button.click();
  return true;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

/**
 * Post several trigger comments one after another: each bot wants its own
 * comment, and GitHub's form only accepts the next one once it has cleared.
 */
export async function postTopLevelComments(bodies: readonly string[]): Promise<number> {
  let posted = 0;
  for (const body of bodies) {
    if (!postTopLevelComment(body)) break;
    posted += 1;
    const cleared = await waitForCommentForm(6000);
    if (!cleared) break;
  }
  return posted;
}

function waitForCommentForm(timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      const field = document.querySelector<HTMLTextAreaElement>('#new_comment_field, textarea[name="comment[body]"]');
      if (field !== null && field.value === '' && !field.disabled) {
        resolve(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 250);
    };
    window.setTimeout(tick, 400);
  });
}

export function postTopLevelComment(body: string): boolean {
  const field =
    document.querySelector<HTMLTextAreaElement>('#new_comment_field') ??
    document.querySelector<HTMLTextAreaElement>('textarea[name="comment[body]"]') ??
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="comment" i]');
  if (field === null) return false;
  field.focus({ preventScroll: true });
  field.value = body;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const form = field.closest('form');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.click();
  return submit !== undefined && submit !== null;
}
