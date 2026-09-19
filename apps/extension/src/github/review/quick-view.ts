/**
 * Quick view: the real timeline nodes of a row — a review thread with
 * every comment, its reactions, its per-comment ⋯ menus and the
 * collapsible reply box with Resolve; a bot's comment; an event row —
 * moved into the slot under the row (teleport.ts) and compacted by CSS.
 * GitHub sees its own DOM, so replying, resolving, reacting and editing
 * behave exactly as they do in the timeline (teleport.ts keeps React-owned
 * nodes working too).
 */

import { createElement, svgFromString } from '../dom';
import { ICON_COPY, ICON_REPLY } from '../ui/icons';
import { onRestore, teleportInto } from './teleport';

/** Fill `slot` with `nodes`. */
export function renderQuickView(slot: HTMLElement, nodes: readonly HTMLElement[]): void {
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  teleportInto(list, nodes);
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  openMinimized(list);
}

/** A minimized comment opens here (the row is the reader's choice to look); GitHub's state comes back with the node. */
function openMinimized(list: HTMLElement): void {
  for (const details of list.querySelectorAll<HTMLDetailsElement>('.minimized-comment details, details.minimized-comment')) {
    if (details.open) continue;
    details.open = true;
    onRestore(() => {
      details.open = false;
    });
  }
}

const THREAD_COMMENT = '.review-comment, .js-comment, [data-testid="review-thread-comment"], [id^="discussion_r"]';
const REPLY_AREA = '.review-thread-reply, .js-inline-comment-form-container, .js-resolvable-timeline-thread-form, [data-testid="thread-reply"], [data-testid="review-thread-reply"], form.js-inline-comment-form';
const ATTR_MORE = 'data-geld-thread-more';
const ATTR_REPLY = 'data-geld-thread-reply';

export interface ThreadsViewHandlers {
  readonly pathOf: (node: HTMLElement) => string;
  readonly onCopy: (text: string) => void;
  /** Reveal the thread and open GitHub's reply box for it. */
  readonly onReply: (node: HTMLElement) => void;
}

/**
 * An item's review threads, each in its own frame: the file path with a copy
 * button, the first comment, and a bar offering the rest of the thread and a
 * reply. Only the outermost comments count as "more" — a thread's comments
 * are siblings, but GitHub repeats ids on wrappers.
 */
export function renderThreadsView(slot: HTMLElement, nodes: readonly HTMLElement[], handlers: ThreadsViewHandlers): void {
  const list = createElement('div', { class: 'geld-review__qv geld-review__qv--threads' });
  slot.replaceChildren(list);
  for (const node of nodes) {
    const frame = createElement('div', { class: 'geld-review__thread', 'data-geld-thread': 'collapsed' });
    const path = handlers.pathOf(node);
    if (path !== '') {
      const copy = createElement('button', { type: 'button', class: 'geld-review__icon geld-review__thread-copy', 'aria-label': 'Copy path', title: 'Copy path' }, [svgFromString(ICON_COPY)]);
      copy.addEventListener('click', () => handlers.onCopy(path.replace(/:\d+$/, '')));
      frame.append(createElement('div', { class: 'geld-review__thread-head' }, [createElement('code', { class: 'geld-review__thread-path' }, [path]), copy]));
    }
    const body = createElement('div', { class: 'geld-review__thread-body' });
    frame.append(body);
    teleportInto(body, [node]);
    const comments = outermostComments(node);
    const more = Math.max(0, comments.length - 1);
    for (const comment of comments.slice(1)) comment.setAttribute(ATTR_MORE, '');
    for (const reply of node.querySelectorAll(REPLY_AREA)) reply.setAttribute(ATTR_REPLY, '');
    onRestore(() => {
      for (const marked of node.querySelectorAll(`[${ATTR_MORE}], [${ATTR_REPLY}]`)) {
        marked.removeAttribute(ATTR_MORE);
        marked.removeAttribute(ATTR_REPLY);
      }
    });
    const bar = createElement('div', { class: 'geld-review__thread-bar' });
    const reveal = (): void => frame.setAttribute('data-geld-thread', 'open');
    if (more > 0) {
      const show = createElement('button', { type: 'button', class: 'geld-review__thread-more' }, [`Show ${more} more comment${more === 1 ? '' : 's'}`]);
      show.addEventListener('click', () => {
        reveal();
        show.remove();
      });
      bar.append(show);
    }
    const reply = createElement('button', { type: 'button', class: 'geld-review__thread-reply' }, [svgFromString(ICON_REPLY), createElement('span', {}, ['Reply'])]);
    reply.addEventListener('click', () => {
      reveal();
      bar.remove();
      handlers.onReply(node);
    });
    bar.append(reply);
    frame.append(bar);
    list.append(frame);
  }
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
}

function outermostComments(thread: HTMLElement): readonly HTMLElement[] {
  const all = [...thread.querySelectorAll<HTMLElement>(THREAD_COMMENT)].filter((node) => node.closest('form') === null && node.querySelector('.comment-body, .js-comment-body, [data-testid="comment-body"], .markdown-body') !== null);
  return all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
}
