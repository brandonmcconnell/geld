/**
 * Quick view: the real timeline nodes of a row — a review thread with
 * every comment, its reactions, its per-comment ⋯ menus and the
 * collapsible reply box with Resolve; a bot's comment; an event row —
 * moved into the slot under the row (teleport.ts) and compacted by CSS.
 * GitHub sees its own DOM, so replying, resolving, reacting and editing
 * behave exactly as they do in the timeline (teleport.ts keeps React-owned
 * nodes working too).
 */

import { createElement } from '../dom';
import { onRestore, teleportInto } from './teleport';

const COMMENT_CONTAINER = '.js-comment-container, .review-comment, .timeline-comment, .react-issue-comment, [data-testid="comment-container"], [data-testid="comment-viewer-outer-box"], [id^="issuecomment-"], [id^="discussion_r"]';
const BODY_SELECTOR = '.js-comment-body, .comment-body:not(.js-preview-body), [data-testid="markdown-body"], [data-testid="comment-body"], .markdown-body:not(.js-preview-body)';

/** Fill `slot` with `nodes`. */
export function renderQuickView(slot: HTMLElement, nodes: readonly HTMLElement[]): void {
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  teleportInto(list, nodes);
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  // A minimized comment opens here (the row is the reader's choice to look); GitHub's state comes back with the node.
  for (const details of list.querySelectorAll<HTMLDetailsElement>('.minimized-comment details, details.minimized-comment')) {
    if (details.open) continue;
    details.open = true;
    onRestore(() => {
      details.open = false;
    });
  }
}

/**
 * The first comment's header — everything in its container that comes before
 * the body: author, time, "bot"/"Member" labels, reactions trigger, ⋯ menu —
 * so the row can wear it and the body reads as the row's content. Works on
 * the classic markup (header pieces are siblings before the body, one or two
 * levels up) and the React one ([data-testid="comment-header"]).
 */
export function commentHeaderPieces(node: HTMLElement): readonly HTMLElement[] {
  const container = node.matches(COMMENT_CONTAINER) ? node : node.querySelector<HTMLElement>(COMMENT_CONTAINER);
  if (container === null) return [];
  const body = container.querySelector<HTMLElement>(BODY_SELECTOR);
  if (body === null) return [];
  // A minimized comment ("This comment has been minimized · Show comment") is a <details>; its summary is its
  // header, and pulled out of the details it would leave GitHub's toggle broken and both labels showing.
  const details = body.closest('details');
  if (details !== null && node.contains(details)) return [];
  const pieces: HTMLElement[] = [];
  let cursor: HTMLElement = body;
  while (cursor !== container && cursor.parentElement !== null) {
    for (let sibling = cursor.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling.hidden || sibling instanceof HTMLTemplateElement || sibling.matches('script, style, .file-header, .blob-wrapper, .diff-table')) continue;
      pieces.unshift(sibling);
    }
    cursor = cursor.parentElement;
  }
  return pieces;
}

/** Move the first comment's header into the row's head slot (a body-only comment reads as the row's own content). */
export function wearHeader(headSlot: HTMLElement, node: HTMLElement): void {
  const pieces = commentHeaderPieces(node);
  if (pieces.length === 0) {
    headSlot.remove();
    return;
  }
  teleportInto(headSlot, pieces);
  // Only a header with controls of its own (⋯, reactions) stands in for the row's; words alone are hidden.
  if (headSlot.querySelector('button, summary, details') !== null) headSlot.closest('.geld-review__row')?.setAttribute('data-head', '');
}
