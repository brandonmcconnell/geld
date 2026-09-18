/**
 * Panel actions that talk to GitHub's own controls: tick a task-list
 * checkbox on the (hidden) summary comment, open a thread's reply box,
 * click Resolve, or post a review-request trigger as a top-level comment.
 * None of these scroll the page; focus is taken with `preventScroll`.
 */

const TIMELINE_ROOT = '.js-timeline-item, .TimelineItem, [data-testid="timeline-row"], .js-comment-container';

export function timelineRootOf(anchor: string): HTMLElement | null {
  const node = document.getElementById(anchor);
  if (node === null) return null;
  const root = node.closest(TIMELINE_ROOT);
  return root instanceof HTMLElement ? root : node;
}

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

/** Open the reply box of the thread that holds `anchor` and focus it without scrolling. */
export function focusReply(anchor: string): boolean {
  const root = timelineRootOf(anchor);
  if (root === null) return false;
  // Quick view may have moved the reply control into the panel's slot.
  const scopes: ParentNode[] = [root, ...document.querySelectorAll('.geld-review__qv-reply')];
  const find = <T extends Element>(selector: string): T | null => {
    for (const scope of scopes) {
      const hit = scope.querySelector<T>(selector);
      if (hit !== null) return hit;
    }
    return null;
  };
  const opener = find<HTMLElement>(
    '.review-thread-reply-button, button.js-inline-comment-form-reply, button[data-testid="comment-reply"], .js-comment-quote-reply, button[aria-label^="Reply" i]',
  );
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

const RESOLVE_SELECTOR = 'button[data-resolved-text], form.js-resolvable-toggler button, button[aria-label*="esolve conversation" i], button[name="resolve"]';

/** GitHub's Resolve/Unresolve for the thread holding `anchor`, wherever quick view may have moved it. */
export function clickResolve(anchor: string): boolean {
  const root = timelineRootOf(anchor);
  if (root === null) return false;
  const button = root.querySelector<HTMLButtonElement>(RESOLVE_SELECTOR) ?? document.querySelector<HTMLButtonElement>(`.geld-review__slot-body ${RESOLVE_SELECTOR}`);
  if (button === null) return false;
  button.click();
  return true;
}

export function isResolvable(anchor: string): boolean {
  const root = timelineRootOf(anchor);
  return root !== null && (root.querySelector(RESOLVE_SELECTOR) !== null || document.querySelector(`.geld-review__slot-body ${RESOLVE_SELECTOR}`) !== null);
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
  field.focus({ preventScroll: true });
  field.value = body;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const form = field.closest('form');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.click();
  return submit !== undefined && submit !== null;
}
