/**
 * Deterministic PR conversation model from the timeline DOM. Same item
 * shape as the Action, so the panel layout does not change when a summary
 * comment is missing or stale. Review threads are read as threads (one
 * item, all replies as sources, GitHub's resolved/outdated state), issue
 * comments and review bodies as single comments.
 */

import type { RawComment, ReviewerRecord, ReviewerState, ThreadPeer } from '@geld/review';
import { looksLikeSummaryBody } from '@geld/review';
import { wornPiecesOf } from './teleport';

const ANCHOR = /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+)$/;
const COMMENT_SELECTOR = '[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"]';
const EVENT_SELECTOR = '[id^="event-"]';
export const THREAD_SELECTOR = '.js-resolvable-timeline-thread-container, [data-testid="review-thread"], .review-thread-component';
const BODY_SELECTOR = '.js-comment-body, .comment-body:not(.js-preview-body), [data-testid="markdown-body"], [data-testid="comment-body"], .markdown-body:not(.js-preview-body)';
const AVATAR_SELECTOR = 'img.avatar, img[data-testid="github-avatar"], img[class*="avatar" i], a[data-hovercard-type] img';

export interface Author {
  readonly login: string;
  readonly bot: boolean;
}

/**
 * GitHub shows an App as "cursor" plus a "bot" label, linked to `/apps/cursor`;
 * the API (and the Action) know the same account as `cursor[bot]`.
 */
/**
 * `root.querySelector`, also looking through header pieces a panel row is
 * wearing on the comment's behalf (teleport.ts), so a worn comment still
 * has an author, a time and an avatar for the crawler.
 */
export function findIn(root: Element, selector: string): Element | null {
  return find(root, selector);
}

function find(root: Element, selector: string): Element | null {
  const own = root.querySelector(selector);
  if (own !== null) return own;
  for (const piece of wornPiecesOf(root)) {
    if (piece.matches(selector)) return piece;
    const inside = piece.querySelector(selector);
    if (inside !== null) return inside;
  }
  return null;
}

export function authorOf(root: Element): Author | null {
  const link =
    find(root, 'a.author') ??
    find(root, 'a[data-testid="author-link"]') ??
    find(root, 'a[data-hovercard-type="user"]') ??
    find(root, 'a[data-hovercard-type="organization"]') ??
    find(root, 'a[href^="/apps/"]');
  if (link === null) return null;
  const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/^@/, '');
  if (text === '') return null;
  const href = link.getAttribute('href') ?? '';
  const labelled = [...(link.parentElement?.querySelectorAll('.Label, [data-testid="bot-label"]') ?? [])].some((label) => /^bot$/i.test((label.textContent ?? '').trim()));
  const bot = /\[bot\]$/i.test(text) || href.startsWith('/apps/') || labelled;
  return { login: bot && !/\[bot\]$/i.test(text) ? `${text}[bot]` : text, bot };
}

function bodyElementOf(root: Element): HTMLElement | null {
  const body = root.querySelector(BODY_SELECTOR);
  return body instanceof HTMLElement ? body : null;
}

const BLOCK = /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR|DETAILS|SUMMARY|SECTION|ARTICLE|UL|OL|TABLE|HR|BR)$/;

/**
 * Text with the line breaks the markup implies. `textContent` glues a
 * heading to the paragraph after it ("Greptile SummaryScore 4/5"), and
 * `innerText` needs layout, which hidden nodes do not have.
 */
export function blockText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (!(node instanceof Element)) return;
    const block = BLOCK.test(node.tagName);
    if (block) parts.push('\n');
    for (const child of node.childNodes) walk(child);
    if (block) parts.push('\n');
  };
  walk(root);
  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textOf(body: HTMLElement | null): string {
  return body === null ? '' : blockText(body);
}

/** The whole timeline row (avatar column included); the comment card only when there is no row. */
export function timelineRootOf(node: Element): HTMLElement {
  const row = node.closest('.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]') ?? node.closest('.js-comment-container');
  if (row instanceof HTMLElement) return row;
  if (node instanceof HTMLElement) return node;
  return node.parentElement ?? node.ownerDocument.documentElement;
}

/** Avatar for a comment: inside the node, else in its timeline row (issue comments keep it in a sibling column). */
export function avatarSrcOf(node: Element | null): string | null {
  if (node === null) return null;
  const scopes: Element[] = [node];
  const row = node.closest('.TimelineItem, .js-timeline-item, [data-testid="timeline-row"]');
  if (row !== null && row !== node) scopes.push(row);
  for (const scope of scopes) {
    const img = find(scope, AVATAR_SELECTOR);
    const src = (img instanceof HTMLImageElement ? img.currentSrc : '') || img?.getAttribute('src') || '';
    if (src !== '') return src;
  }
  return null;
}

export function avatarSrcFor(anchor: string): string | null {
  return avatarSrcOf(document.getElementById(anchor));
}

function pathLineOf(root: Element): { readonly path?: string; readonly line?: number } {
  const fileLink = root.querySelector('a[href*="/files"][href*="#"], a[href*="/blob/"], [data-path]');
  const href = fileLink?.getAttribute('href') ?? '';
  const dataPath = fileLink?.getAttribute('data-path') ?? root.getAttribute('data-path') ?? '';
  const fromHref = /[?&]path=([^&]+)/.exec(href) ?? /blob\/[^/]+\/([^#?]+)/.exec(href);
  const pathText = (fileLink?.textContent ?? '').trim();
  const path =
    dataPath !== '' ? dataPath : pathText !== '' && !pathText.includes(' ') ? pathText : fromHref?.[1] !== undefined ? decodeURIComponent(fromHref[1]) : undefined;
  const lineHint = /[LR](\d+)/.exec(href) ?? /\bline (\d+)\b/i.exec(root.textContent ?? '');
  const parsed = lineHint?.[1] !== undefined ? Number.parseInt(lineHint[1], 10) : Number.NaN;
  const line = Number.isFinite(parsed) ? parsed : undefined;
  if (path !== undefined && line !== undefined) return { path, line };
  if (path !== undefined) return { path };
  if (line !== undefined) return { line };
  return {};
}

function kindOf(id: string): RawComment['kind'] {
  if (id.startsWith('discussion_r')) return 'thread';
  if (id.startsWith('pullrequestreview-')) return 'review';
  return 'comment';
}

function isResolvedThread(container: Element): boolean {
  if (container.getAttribute('data-resolved') === 'true') return true;
  for (const control of container.querySelectorAll('button, summary, span.Label')) {
    const text = (control.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (/^unresolve conversation$/i.test(text) || /^resolved$/i.test(text)) return true;
  }
  return false;
}

function isOutdatedThread(container: Element): boolean {
  if (container.querySelector('.outdated-comment-label, [data-testid="outdated-label"]') !== null) return true;
  return [...container.querySelectorAll('.Label')].some((label) => /^outdated$/i.test((label.textContent ?? '').trim()));
}

/** A rendered comment worth listing: real anchor id, an author, a non-empty body, not part of a form. */
function usable(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement) || !ANCHOR.test(node.id)) return false;
  if (node.closest('form') !== null) return false;
  const body = bodyElementOf(node);
  if (body === null || (body.textContent ?? '').trim() === '' || /^nothing to preview$/i.test((body.textContent ?? '').trim())) return false;
  return authorOf(node) !== null;
}

export interface CrawledEvent {
  readonly anchor: string;
  readonly root: HTMLElement;
}

export interface CrawledComment {
  readonly comment: RawComment;
  /** Timeline node to hide when this comment is folded (the thread container for review threads). */
  readonly root: HTMLElement;
  readonly author: Author;
  readonly avatarSrc: string | null;
}

function withLocation(base: RawComment, extra: { readonly path?: string; readonly line?: number }): RawComment {
  if (extra.path !== undefined && extra.line !== undefined) return { ...base, path: extra.path, line: extra.line };
  if (extra.path !== undefined) return { ...base, path: extra.path };
  if (extra.line !== undefined) return { ...base, line: extra.line };
  return base;
}

function createdAtOf(node: Element): string {
  return find(node, 'relative-time, time-ago, time')?.getAttribute('datetime') ?? '';
}

export function crawlConversation(root: ParentNode = document): {
  readonly comments: readonly CrawledComment[];
  readonly events: readonly CrawledEvent[];
} {
  const comments: CrawledComment[] = [];
  const seen = new Set<string>();

  for (const container of root.querySelectorAll(THREAD_SELECTOR)) {
    const nodes = [...container.querySelectorAll('[id^="discussion_r"]')].filter(usable);
    const first = nodes[0];
    if (first === undefined) continue;
    const peers: ThreadPeer[] = [];
    for (const node of nodes) {
      seen.add(node.id);
      const author = authorOf(node);
      if (author === null) continue;
      peers.push({ anchor: node.id, kind: 'thread', author: author.login, body: textOf(bodyElementOf(node)) });
    }
    const author = authorOf(first);
    const lead = peers[0];
    if (author === null || lead === undefined) continue;
    const base: RawComment = {
      anchor: first.id,
      kind: 'thread',
      author: author.login,
      body: lead.body,
      createdAt: createdAtOf(first),
      isResolved: isResolvedThread(container),
      isOutdated: isOutdatedThread(container),
      threadAnchors: peers,
    };
    const timelineNode = container.closest('.js-timeline-item, .TimelineItem') ?? container;
    comments.push({
      comment: withLocation(base, pathLineOf(container)),
      root: timelineNode instanceof HTMLElement ? timelineNode : first,
      author,
      avatarSrc: avatarSrcOf(first),
    });
  }

  for (const node of root.querySelectorAll(COMMENT_SELECTOR)) {
    // GitHub repeats a comment's id on the group and the comment inside; document order gives the outermost first.
    if (!usable(node) || seen.has(node.id)) continue;
    seen.add(node.id);
    const author = authorOf(node);
    if (author === null) continue;
    const body = textOf(bodyElementOf(node));
    if (looksLikeSummaryBody(body)) continue;
    const base: RawComment = { anchor: node.id, kind: kindOf(node.id), author: author.login, body, createdAt: createdAtOf(node) };
    comments.push({ comment: withLocation(base, pathLineOf(node)), root: timelineRootOf(node), author, avatarSrc: avatarSrcOf(node) });
  }

  const events: CrawledEvent[] = [];
  for (const node of root.querySelectorAll(EVENT_SELECTOR)) {
    if (!/^event-\d+$/.test(node.id) || node.closest(THREAD_SELECTOR) !== null) continue;
    events.push({ anchor: node.id, root: timelineRootOf(node) });
  }
  return { comments, events };
}

export type CrawledReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface CrawledReview {
  readonly anchor: string;
  readonly author: Author;
  readonly avatarSrc: string | null;
  readonly state: CrawledReviewState;
  readonly createdAt: string;
  /** The timeline row holding the review. */
  readonly root: HTMLElement;
  /** The review's own comment ("left a comment"), when it wrote one; never a thread comment. */
  readonly comment: HTMLElement | null;
}

const REVIEW_COMMENT = '.timeline-comment, .js-comment-container, [data-testid="comment-container"]';

function reviewStateOf(text: string): CrawledReviewState {
  if (/\bapproved\b/i.test(text)) return 'approved';
  if (/\brequested changes\b/i.test(text)) return 'changes_requested';
  if (/\bdismissed\b/i.test(text)) return 'dismissed';
  return 'commented';
}

/** Every review verdict in the timeline (`pullrequestreview-N`), with its comment when it has one. */
export function crawlReviews(root: ParentNode = document): readonly CrawledReview[] {
  const reviews: CrawledReview[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLElement>('[id^="pullrequestreview-"]')) {
    if (!/^pullrequestreview-\d+$/.test(node.id) || seen.has(node.id) || node.closest('form') !== null) continue;
    seen.add(node.id);
    const author = authorOf(node);
    if (author === null) continue;
    // The comment may be on loan to a panel row right now; its placeholder still sits here.
    const candidates = [...node.querySelectorAll<HTMLElement>(REVIEW_COMMENT), ...wornPiecesOf(node).flatMap((piece) => (piece.matches(REVIEW_COMMENT) ? [piece] : [...piece.querySelectorAll<HTMLElement>(REVIEW_COMMENT)]))];
    const comment = candidates.find((candidate) => candidate.closest(THREAD_SELECTOR) === null && bodyElementOf(candidate) !== null) ?? null;
    reviews.push({
      anchor: node.id,
      author,
      avatarSrc: avatarSrcOf(node),
      // The verdict sentence sits in the row's own header; the comment's words must not vote.
      state: reviewStateOf(textOutside(node, comment)),
      createdAt: createdAtOf(node),
      root: timelineRootOf(node),
      comment,
    });
  }
  return reviews;
}

function textOutside(root: Element, excluded: Element | null): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if (excluded === null || !excluded.contains(text)) parts.push(text.nodeValue ?? '');
  }
  return parts.join(' ');
}

/** Each reviewer's latest verdict, for the approvals count. */
export function latestReviewers(reviews: readonly CrawledReview[]): readonly ReviewerRecord[] {
  const latest = new Map<string, ReviewerState>();
  for (const review of reviews) {
    if (review.author.bot) continue;
    if (review.state === 'dismissed') {
      latest.delete(review.author.login);
      continue;
    }
    // A plain comment does not withdraw an earlier verdict.
    if (review.state === 'commented' && latest.has(review.author.login)) continue;
    latest.set(review.author.login, review.state);
  }
  return [...latest].map(([login, state]) => ({ login, state }));
}
