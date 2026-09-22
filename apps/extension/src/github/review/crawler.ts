/**
 * Deterministic PR conversation model from the timeline DOM. Same item
 * shape as the Action, so the panel layout does not change when a summary
 * comment is missing or stale. Review threads are read as threads (one
 * item, all replies as sources, GitHub's resolved/outdated state), issue
 * comments and review bodies as single comments.
 */

import type { PreviewDoc, RawCheckRun, RawComment, ReviewerRecord, ReviewerState, ThreadPeer } from '@geld/review';
import { looksLikeSummaryBody } from '@geld/review';
import { closestAtHome, compareHome, wornPiecesOf } from './teleport';

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

/**
 * The comment's own body. A review row (`pullrequestreview-N`) wraps its
 * threads, whose comments are items of their own; a body found inside a
 * thread is theirs, not the review's, so a bot's bare "reviewed" row is not
 * a comment (and does not vanish from the count when its thread moves).
 */
/** Block text where each table row is one `| a | b |` line (a rendered table's cells would otherwise each be a line). */
export function textWithTableRows(body: HTMLElement): string {
  const clone = body.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return blockText(body);
  for (const row of clone.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim());
    const line = document.createElement('div');
    line.textContent = `| ${cells.join(' | ')} |`;
    row.replaceWith(line);
  }
  return blockText(clone);
}

/**
 * The comment's own body - never one of its threads' - wherever quick view
 * has put it. A review's comment is loaned to the panel while its line is
 * open, and the id-bearing node at home then holds only a placeholder; read
 * from the home alone, the review looked bodiless, was dropped from the
 * crawl, and with it went the open line (and the bot's verdict source), so
 * the panel re-rendered without it, the loan came home, the next crawl found
 * it again, and so on: content and times blinking for as long as it was open.
 */
function bodyElementOf(root: Element): HTMLElement | null {
  const scopes: Element[] = [root, ...wornPiecesOf(root)];
  for (const scope of scopes) {
    const candidates = scope.matches(BODY_SELECTOR) ? [scope, ...scope.querySelectorAll(BODY_SELECTOR)] : [...scope.querySelectorAll(BODY_SELECTOR)];
    for (const body of candidates) {
      if (!(body instanceof HTMLElement)) continue;
      const thread = closestAtHome(body, THREAD_SELECTOR);
      if (thread !== null && thread !== root && (root.contains(thread) || scopes.some((piece) => piece.contains(thread)))) continue;
      return body;
    }
  }
  return null;
}

const BLOCK = /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR|DETAILS|SUMMARY|SECTION|ARTICLE|UL|OL|TABLE|HR|BR|BUTTON)$/;

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
  const row = closestAtHome(node, '.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]') ?? closestAtHome(node, '.js-comment-container');
  if (row instanceof HTMLElement) return row;
  if (node instanceof HTMLElement) return node;
  return node.parentElement ?? node.ownerDocument.documentElement;
}

/** Avatar for a comment: inside the node, else in its timeline row (issue comments keep it in a sibling column). */
/**
 * One URL per picture: GitHub serves the same avatar at several sizes
 * (`s=40`, `s=48`, `s=60`, `s=80`…) and which copy is found depends on where
 * the node is at the moment - a loaned comment's header shows one size, its
 * row at home another. The size is pinned so the same account always reads
 * as the same string; nothing in the panel draws an avatar above 40px.
 */
export function normalizeAvatarSrc(src: string): string {
  if (src === '') return src;
  try {
    const url = new URL(src, location.href);
    if (!/(^|\.)avatars\.githubusercontent\.com$/i.test(url.hostname)) return src;
    if (url.searchParams.has('s')) url.searchParams.set('s', '80');
    return url.toString();
  } catch {
    return src;
  }
}

export function avatarSrcOf(node: Element | null): string | null {
  if (node === null) return null;
  const scopes: Element[] = [node];
  const row = closestAtHome(node, '.TimelineItem, .js-timeline-item, [data-testid="timeline-row"]');
  if (row !== null && row !== node) scopes.push(row);
  for (const scope of scopes) {
    const img = find(scope, AVATAR_SELECTOR);
    const src = (img instanceof HTMLImageElement ? img.currentSrc : '') || img?.getAttribute('src') || '';
    if (src !== '') return normalizeAvatarSrc(src);
  }
  return null;
}

export function avatarSrcFor(anchor: string): string | null {
  return avatarSrcOf(document.getElementById(anchor));
}

/** Any avatar the page shows for `login` — the reviewers sidebar, another comment, a hovercard link. */
export function avatarSrcForLogin(login: string): string | null {
  const bare = login.replace(/\[bot\]$/i, '');
  const selectors = [`img[alt="@${bare}"]`, `a[href="/${bare}"] img`, `a[href$="/${bare}"][data-hovercard-type] img`, `img[alt="${bare}"]`, `a[href="/apps/${bare}"] img`];
  for (const selector of selectors) {
    const img = document.querySelector(selector);
    const src = (img instanceof HTMLImageElement ? img.currentSrc : '') || img?.getAttribute('src') || '';
    if (src !== '') return normalizeAvatarSrc(src);
  }
  return null;
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
  /** The comment's rendered body as text, links and images — what the preview parser reads. */
  readonly previewDoc: PreviewDoc;
}

/**
 * A `PreviewDoc` from a rendered comment body: block text plus every link
 * and image in it. Table rows are written as `| cell | cell |` lines, the
 * shape the markdown side has, so the parser reads a status beside its
 * project either way.
 */
export function previewDocOf(node: Element, author: string, anchor: string): PreviewDoc {
  const body = bodyElementOf(node);
  const time = node.querySelector('relative-time[datetime]')?.getAttribute('datetime') ?? undefined;
  const doc: PreviewDoc = {
    author,
    anchor,
    text: body === null ? '' : textWithTableRows(body),
    links: body === null ? [] : [...body.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => ({ href: link.href, text: (link.textContent ?? '').replace(/\s+/g, ' ').trim() })),
    // GitHub proxies comment images through camo; the original URL (what the parsers recognise) is in data-canonical-src.
    images: body === null ? [] : [...body.querySelectorAll<HTMLImageElement>('img')].map((image) => ({ src: image.getAttribute('data-canonical-src') ?? image.getAttribute('src') ?? '', alt: image.alt })),
  };
  return time === undefined ? doc : { ...doc, updatedAt: time };
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
    const timelineNode = closestAtHome(container, '.js-timeline-item, .TimelineItem') ?? container;
    comments.push({
      comment: withLocation(base, pathLineOf(container)),
      root: timelineNode instanceof HTMLElement ? timelineNode : first,
      author,
      avatarSrc: avatarSrcOf(first),
      previewDoc: previewDocOf(first, author.login, first.id),
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
    comments.push({ comment: withLocation(base, pathLineOf(node)), root: timelineRootOf(node), author, avatarSrc: avatarSrcOf(node), previewDoc: previewDocOf(node, author.login, node.id) });
  }

  const events: CrawledEvent[] = [];
  for (const node of root.querySelectorAll(EVENT_SELECTOR)) {
    if (!/^event-\d+$/.test(node.id) || node.closest(THREAD_SELECTOR) !== null) continue;
    // A force-push is a push, not an event: it opens a round like a run of commits does (crawlLeftovers lists it).
    if (isForcePushRow(node)) continue;
    events.push({ anchor: node.id, root: timelineRootOf(node) });
  }
  // Timeline order, not document order: a node shown in the panel is above the timeline right now.
  const byHome = (a: string, b: string): number => {
    const x = root.querySelector(`[id="${a}"]`);
    const y = root.querySelector(`[id="${b}"]`);
    return x === null || y === null ? 0 : compareHome(x, y);
  };
  comments.sort((a, b) => byHome(a.comment.anchor, b.comment.anchor));
  events.sort((a, b) => byHome(a.anchor, b.anchor));
  return { comments, events };
}

export interface CrawledLeftover {
  readonly kind: LeftoverKind;
  readonly root: HTMLElement;
}

/** `push` is a force-push event ("X force-pushed the branch from a to b"): a push with no commit rows of its own. */
export type LeftoverKind = 'commit' | 'push' | 'mention' | 'review-event' | 'noise' | 'pending' | 'other';

const FORCE_PUSH_ROW = '.TimelineItem:has(.octicon-repo-push), [data-testid="force-pushed-event"], [class*="ForcePush"]';

/** "X force-pushed the branch from a to b": GitHub's row for a push that replaced the branch's commits. */
export function isForcePushRow(row: Element): boolean {
  return (row.matches(FORCE_PUSH_ROW) || row.querySelector('.octicon-repo-push') !== null) && /\bforce-pushed\b/i.test(row.textContent ?? '');
}

const COMMIT_ROW = '.js-commit-group, .TimelineItem:has(.js-commits-list-item), [data-testid="commit-row"], [data-testid="timeline-commit-row"], .TimelineItem:has(> .TimelineItem-badge .octicon-git-commit), [class*="CommitRow"]';
const MENTION_ROW = '.TimelineItem:has(.octicon-cross-reference), [data-testid="cross-referenced-event"], [class*="CrossReferencedEvent"]';

/**
 * Every timeline row not already accounted for — commits, cross-references,
 * bots' bare "reviewed" rows, anything else — so compact mode can fold the
 * whole timeline and offer each kind its own place in the panel.
 */
export function crawlLeftovers(claimed: ReadonlySet<HTMLElement>, root: ParentNode = document): readonly CrawledLeftover[] {
  const list: CrawledLeftover[] = [];
  const timeline = root.querySelector('.js-discussion, [data-testid="issue-timeline-container"], [data-testid="pull-request-timeline"], .pull-discussion-timeline');
  if (timeline === null) return list;
  const ROW = '.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]';
  const rows = timeline.querySelectorAll<HTMLElement>(ROW);
  for (const row of rows) {
    // Rows on loan sit inside the panel right now; they still belong to the timeline. Panel-made rows do not.
    if (row.closest('.geld-review') !== null && row.closest('[data-geld-teleported]') === null) continue;
    if (row.closest('form') !== null) continue;
    // Leaf rows: a `.js-timeline-item` wrapper may hold several `.TimelineItem`s (a force-push next to a mention),
    // each of which stands or folds on its own. A wrapper whose rows are on loan to the panel is still a wrapper.
    // Except a minimized comment ("This comment was marked as resolved · Show comment"): its rows sit inside a
    // closed <details>, invisible whatever we do to them; the visible thing is the wrapper, so that is the leaf.
    const innerRows = [...row.querySelectorAll<HTMLElement>(ROW)];
    const minimized = innerRows.length > 0 && innerRows.every((inner) => inner.closest('.minimized-comment') !== null && row.contains(inner.closest('.minimized-comment')));
    if (!minimized && (innerRows.length > 0 || wornPiecesOf(row).length > 0)) continue;
    if ([...claimed].some((node) => node === row || node.contains(row) || (!minimized && row.contains(node)))) continue;
    // The description card (which hosts the panel, and through it whatever is on loan) and the new-comment form are the page's own.
    // (A thread's own reply box is a `comment[body]` textarea too; only the page's new-comment form counts.)
    if (row.querySelector('.geld-review, [data-geld-attached], form.js-new-comment-form, textarea[name="comment[body]"]:not(.js-inline-comment-form textarea, .review-thread-component textarea, .js-resolvable-timeline-thread-container textarea, .minimized-comment textarea)') !== null) continue;
    if ([...row.querySelectorAll<HTMLElement>('[id^="issue-"]')].some((node) => /^issue-\d+$/.test(node.id))) continue;
    // An emptied wrapper (its rows loaded elsewhere, or a spent "Load more") is nothing to list.
    if ((row.textContent ?? '').trim() === '' && row.querySelector('img, svg') === null) continue;
    let kind: CrawledLeftover['kind'] = 'other';
    if (row.querySelector('a[href^="#commits-pushed-"], [id^="commits-pushed-"]') !== null || /\badded \d+ commits?\b/.test(row.textContent ?? '')) kind = 'noise';
    else if (row.querySelector('.minimized-comment include-fragment[src]') !== null) kind = 'pending';
    // What someone minimized (resolved, outdated, off-topic) is noise here; its comment, once loaded, is crawled on its own.
    else if (minimized || row.querySelector('.minimized-comment') !== null) kind = 'noise';
    else if (row.matches(COMMIT_ROW) || row.querySelector('.js-commits-list-item, code.js-commit-sha, a[href*="/commits/"]') !== null) kind = 'commit';
    else if (isForcePushRow(row)) kind = 'push';
    else if (row.matches(MENTION_ROW) || row.querySelector('.octicon-cross-reference, [id^="ref-pullrequest-"], [id^="ref-issue-"]') !== null) kind = 'mention';
    else if (row.querySelector('[id^="pullrequestreview-"]') !== null) kind = 'review-event';
    list.push({ kind, root: row });
  }
  return list;
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

/** A review's own comment ("left a comment"), wherever quick view has put it; never one of its threads' comments. */
export function reviewCommentOf(review: Element): HTMLElement | null {
  // The comment may be on loan to a panel row right now; its placeholder still sits here.
  const candidates = [...review.querySelectorAll<HTMLElement>(REVIEW_COMMENT), ...wornPiecesOf(review).flatMap((piece) => (piece.matches(REVIEW_COMMENT) ? [piece] : [...piece.querySelectorAll<HTMLElement>(REVIEW_COMMENT)]))];
  return candidates.find((candidate) => candidate.closest(THREAD_SELECTOR) === null && bodyElementOf(candidate) !== null) ?? null;
}

/** Every review verdict in the timeline (`pullrequestreview-N`), with its comment when it has one. */
/** Each review's verdict as last read with its header sentence in reach (see `crawlReviews`). */
const stateByReview = new Map<string, CrawledReviewState>();
/**
 * Each review's own comment as last found. For one pass while a loan is on
 * its way home the comment is neither at home nor worn by anything, and a
 * read then said "no comment": the line lost its words, its time and its
 * chevron for a frame. A comment once found is the review's until it leaves
 * the document.
 */
const commentByReview = new Map<string, HTMLElement>();

export function crawlReviews(root: ParentNode = document): readonly CrawledReview[] {
  const reviews: CrawledReview[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLElement>('[id^="pullrequestreview-"]')) {
    if (!/^pullrequestreview-\d+$/.test(node.id) || seen.has(node.id) || node.closest('form') !== null) continue;
    seen.add(node.id);
    const author = authorOf(node);
    if (author === null) continue;
    const knownComment = commentByReview.get(node.id);
    const comment = reviewCommentOf(node) ?? (knownComment !== undefined && knownComment.isConnected ? knownComment : null);
    if (comment !== null) commentByReview.set(node.id, comment);
    // The verdict sentence sits in the row's own header; the comment's words must not vote. Read from the row at
    // home *and* whatever of it is on loan, and remembered: a review's verdict does not change while the page is
    // open, and a read that finds no sentence (the header is worn by a panel row) must not demote it to "commented".
    const read = reviewStateOf([node, ...wornPiecesOf(node)].map((scope) => textOutside(scope, comment)).join(' '));
    const remembered = stateByReview.get(node.id);
    const state = read === 'commented' && remembered !== undefined ? remembered : read;
    stateByReview.set(node.id, state);
    reviews.push({
      anchor: node.id,
      author,
      avatarSrc: avatarSrcOf(node) ?? avatarSrcForLogin(author.login),
      state,
      createdAt: createdAtOf(node),
      root: timelineRootOf(node),
      comment,
    });
  }
  return reviews.sort((a, b) => {
    const x = document.getElementById(a.anchor);
    const y = document.getElementById(b.anchor);
    return x === null || y === null ? 0 : compareHome(x, y);
  });
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

/**
 * The merge box's check rows as check runs, read from each row's state
 * glyph (GitHub's octicon names its state) and name, wherever the rows are
 * (the merge box, or the panel's CI slot on loan). Commit statuses count
 * too: Devin reports through one, with no "Successful in" text, and its
 * verdict is the glyph. The Action reads these from the API; the browser
 * has only the page.
 */
export function crawlCheckRuns(root: ParentNode = document, headSha = ''): readonly RawCheckRun[] {
  const out: RawCheckRun[] = [];
  const seen = new Set<string>();
  for (const row of root.querySelectorAll<HTMLElement>('li:has([class*="StatusCheckRow"]), .merge-status-item')) {
    const name = (row.querySelector('[class*="StatusCheckRow"] h4 a span, [class*="StatusCheckRow"] h4 a, .merge-status-item strong, .merge-status-item .text-emphasized')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (name === '' || seen.has(name)) continue;
    const glyph = row.querySelector('[class*="LeadingVisual"] svg.octicon, .merge-status-icon svg.octicon, svg.octicon');
    const state = glyph === null ? null : checkStateOfGlyph(glyph.getAttribute('class') ?? '');
    if (state === null) continue;
    seen.add(name);
    out.push({ name, status: state.status, conclusion: state.conclusion, sha: headSha });
  }
  return out;
}

/** GitHub's octicon for a check row, as a run's status and conclusion; null for a glyph that is not a state. */
function checkStateOfGlyph(classes: string): { readonly status: string; readonly conclusion: string | null } | null {
  if (/octicon-check\b|octicon-check-circle/.test(classes)) return { status: 'completed', conclusion: 'success' };
  if (/octicon-x\b|octicon-x-circle/.test(classes)) return { status: 'completed', conclusion: 'failure' };
  if (/octicon-stop|octicon-circle-slash/.test(classes)) return { status: 'completed', conclusion: 'cancelled' };
  if (/octicon-skip/.test(classes)) return { status: 'completed', conclusion: 'skipped' };
  if (/octicon-alert/.test(classes)) return { status: 'completed', conclusion: 'action_required' };
  if (/octicon-square-fill|octicon-square\b/.test(classes)) return { status: 'completed', conclusion: 'neutral' };
  if (/octicon-dot|octicon-clock|octicon-hourglass|octicon-sync|octicon-in-progress/.test(classes)) return { status: 'in_progress', conclusion: null };
  return null;
}
