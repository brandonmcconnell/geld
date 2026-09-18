/**
 * Panel actions that talk to GitHub's own controls: tick a task-list
 * checkbox on the (hidden) summary comment, focus a reply box, click
 * Resolve, or post a re-run trigger as a top-level comment.
 */

import { rerunTriggerFor } from '@geld/review';

export function tickSummaryCheckbox(commentRoot: HTMLElement, itemAnchors: readonly string[], checked: boolean): boolean {
  const items = commentRoot.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox, input[type="checkbox"]');
  for (const box of items) {
    const row = box.closest('li, .task-list-item, p, div');
    const text = row?.textContent ?? '';
    if (!itemAnchors.some((anchor) => text.includes(`#${anchor}`) || text.includes(anchor))) continue;
    if (box.checked === checked) return true;
    if (box.disabled) {
      box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      if (box.checked === checked) return true;
    }
    box.click();
    return true;
  }
  return false;
}

export function focusReply(anchor: string): boolean {
  const node = document.getElementById(anchor);
  if (node === null) return false;
  const reply =
    node.querySelector<HTMLElement>('button.js-comment-quote-reply, button[data-testid="comment-reply"]') ??
    node.parentElement?.querySelector<HTMLElement>('button.js-add-inline-comment-reply');
  reply?.click();
  const box = document.querySelector<HTMLTextAreaElement>('textarea#new_comment_field, textarea[name="comment[body]"], textarea[aria-label*="comment" i]');
  box?.focus();
  return true;
}

export function clickResolve(anchor: string): boolean {
  const node = document.getElementById(anchor);
  if (node === null) return false;
  const thread = node.closest('.js-resolvable-timeline-thread-container, [data-testid="review-thread"]');
  const button = thread?.querySelector<HTMLButtonElement>('button[data-resolved-text], button[aria-label*="esolve" i], form.js-resolvable-toggler button');
  if (button === undefined || button === null) return false;
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

export function postTopLevelComment(body: string): boolean {
  const field =
    document.querySelector<HTMLTextAreaElement>('#new_comment_field') ??
    document.querySelector<HTMLTextAreaElement>('textarea[name="comment[body]"]') ??
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="comment" i]');
  if (field === null) return false;
  field.focus();
  field.value = body;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const form = field.closest('form');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.click();
  return submit !== undefined && submit !== null;
}

export function confirmRerun(botId: string): boolean {
  const trigger = rerunTriggerFor(botId);
  if (trigger === null) return false;
  if (!window.confirm(`Post “${trigger}” as a comment to re-run this bot?`)) return false;
  return postTopLevelComment(trigger);
}
