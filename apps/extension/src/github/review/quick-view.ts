/**
 * Slim inline view of a review item or a fold: for each comment, one compact
 * card (avatar, login, time) holding the comment's *real* body element,
 * moved from the timeline (teleport.ts), plus the thread's own reply
 * control so answering happens right here. Nothing else of the timeline
 * item — header chrome, rails, gutters — comes along.
 */

import { createElement } from '../dom';
import { threadRootOf } from './actions';
import { authorOf, avatarSrcOf } from './crawler';
import { isReactManaged, teleportInto } from './teleport';

const BODY_SELECTOR = '.js-comment-body, .comment-body:not(.js-preview-body), [data-testid="markdown-body"], [data-testid="comment-body"], .markdown-body:not(.js-preview-body)';
const REPLY_SELECTOR = '.review-thread-reply, .js-inline-comment-form-container, form.js-inline-comment-form, [data-testid="review-thread-reply"]';

export type QuickViewTarget =
  | { readonly kind: 'comments'; readonly anchors: readonly string[] }
  | { readonly kind: 'nodes'; readonly nodes: readonly HTMLElement[] };

interface CommentParts {
  readonly node: HTMLElement;
  readonly body: HTMLElement | null;
  readonly login: string;
  readonly bot: boolean;
  readonly avatarSrc: string | null;
  readonly time: string;
}

function partsOf(node: HTMLElement): CommentParts {
  const body = node.querySelector(BODY_SELECTOR);
  const author = authorOf(node);
  const time = node.querySelector('relative-time, time-ago, time');
  return {
    node,
    body: body instanceof HTMLElement ? body : null,
    login: author?.login ?? '',
    bot: author?.bot ?? false,
    avatarSrc: avatarSrcOf(node),
    time: (time?.textContent ?? '').trim(),
  };
}

function card(parts: CommentParts, anchor: string): HTMLElement {
  const head = createElement('div', { class: 'geld-review__qv-head' });
  if (parts.avatarSrc !== null) {
    head.append(createElement('img', { class: 'geld-review__avatar', 'data-kind': parts.bot ? 'bot' : 'user', src: parts.avatarSrc, alt: '', width: '20', height: '20' }));
  }
  head.append(createElement('a', { class: 'geld-review__qv-login', href: `#${anchor}` }, [parts.login.replace(/\[bot\]$/i, '') || 'ghost']));
  if (parts.bot) head.append(createElement('span', { class: 'geld-review__qv-bot' }, ['bot']));
  if (parts.time !== '') head.append(createElement('span', { class: 'geld-review__qv-time' }, [parts.time]));
  return createElement('div', { class: 'geld-review__qv-comment', 'data-geld-qv': anchor }, [head, createElement('div', { class: 'geld-review__qv-body' })]);
}

const COMMENT_ID = /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+)$/;

/**
 * Comment nodes inside a timeline row, outermost per id. GitHub puts the
 * same `issuecomment-N` id on a comment group and the comment inside it;
 * both would otherwise become a card, the inner one without a timestamp.
 */
function commentNodesIn(root: HTMLElement): readonly HTMLElement[] {
  if (COMMENT_ID.test(root.id)) return [root];
  const matches = [...root.querySelectorAll<HTMLElement>('[id^="discussion_r"], [id^="issuecomment-"], [id^="pullrequestreview-"]')].filter((node) => COMMENT_ID.test(node.id));
  const seen = new Set<string>();
  return matches.filter((node) => {
    if (seen.has(node.id) || matches.some((other) => other !== node && other.contains(node))) return false;
    seen.add(node.id);
    return true;
  });
}

/** Fill `slot` for `target`. Returns false when a comment could only be shown as a read-only clone. */
export function renderQuickView(slot: HTMLElement, target: QuickViewTarget): boolean {
  let live = true;
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  /** Thread root → its reply control, placed after all of the thread's comments. */
  const replyHosts = new Map<HTMLElement, HTMLElement>();

  const addComment = (node: HTMLElement): void => {
    const parts = partsOf(node);
    if (parts.body === null) {
      // No recognisable body (an event, a condensed row): bring the node itself.
      const holder = createElement('div', { class: 'geld-review__qv-raw' });
      list.append(holder);
      if (!teleportInto(holder, [node])) live = false;
      return;
    }
    const entry = card(parts, node.id);
    list.append(entry);
    const bodyHost = entry.querySelector<HTMLElement>('.geld-review__qv-body');
    if (bodyHost !== null && !teleportInto(bodyHost, [parts.body])) live = false;
    const root = threadRootOf(node.id);
    if (root !== null && !replyHosts.has(root)) {
      const reply = root.querySelector(REPLY_SELECTOR) ?? root.querySelector('.review-thread-reply-button')?.parentElement ?? null;
      if (reply instanceof HTMLElement && !isReactManaged(reply)) replyHosts.set(root, reply);
    }
  };
  // The thread's reply control goes after its last comment, not after the first.
  const placeReplies = (): void => {
    for (const reply of replyHosts.values()) {
      const host = createElement('div', { class: 'geld-review__qv-reply' });
      list.append(host);
      teleportInto(host, [reply]);
    }
  };

  if (target.kind === 'comments') {
    const seen = new Set<string>();
    for (const anchor of target.anchors) {
      const node = document.getElementById(anchor);
      if (!(node instanceof HTMLElement) || seen.has(anchor)) continue;
      seen.add(anchor);
      addComment(node);
    }
  } else {
    for (const node of target.nodes) {
      const comments = commentNodesIn(node);
      if (comments.length === 0) addComment(node);
      else for (const comment of comments) addComment(comment);
    }
  }
  placeReplies();
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  return live;
}
