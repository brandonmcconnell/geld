/**
 * Deterministic PR conversation model from the timeline DOM. Same item
 * shape as the Action, so the panel layout does not change when a summary
 * comment is missing or stale.
 */

import type { RawComment } from '@geld/review';
import { looksLikeSummaryBody } from '@geld/review';
import { looksLikeBotLogin } from '@geld/review';

const COMMENT_SELECTOR = '[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"]';
const EVENT_SELECTOR = '[id^="event-"]';

function authorOf(root: Element): string {
  const link =
    root.querySelector('a.author') ??
    root.querySelector('a[data-hovercard-type="user"]') ??
    root.querySelector('a[data-testid="github-avatar"]') ??
    root.querySelector('a[href^="/"][data-hovercard-url]');
  const text = (link?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text !== '') return text.replace(/^@/, '');
  const label = root.getAttribute('data-author') ?? root.querySelector('[data-anointed-login], img.avatar')?.getAttribute('alt');
  return (label ?? 'ghost').replace(/^@/, '').trim() || 'ghost';
}

function bodyOf(root: Element): string {
  const body =
    root.querySelector('.js-comment-body') ??
    root.querySelector('.comment-body') ??
    root.querySelector('[data-testid="markdown-body"]') ??
    root.querySelector('.markdown-body');
  return (body?.textContent ?? '').trim();
}

function pathLineOf(root: Element): { readonly path?: string; readonly line?: number } {
  const fileLink = root.querySelector('a[href*="/files"][href*="#"], a[href*="/blob/"]');
  const href = fileLink?.getAttribute('href') ?? '';
  const fromHref = /[?&]path=([^&]+)/.exec(href) ?? /blob\/[^/]+\/([^#?]+)/.exec(href);
  const pathText = (fileLink?.textContent ?? '').trim();
  const path = pathText !== '' && !pathText.includes(' ') ? pathText : fromHref?.[1] !== undefined ? decodeURIComponent(fromHref[1]) : undefined;
  const lineHint = /[LR](\d+)/.exec(href) ?? /:(\d+)\b/.exec(root.textContent ?? '');
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

function timelineRoot(node: Element): HTMLElement {
  const item = node.closest('.js-timeline-item, .TimelineItem, [data-testid="timeline-row"], .js-comment-container');
  if (item instanceof HTMLElement) return item;
  if (node instanceof HTMLElement) return node;
  return node.parentElement ?? node.ownerDocument.documentElement;
}

export interface CrawledEvent {
  readonly anchor: string;
  readonly root: HTMLElement;
}

export interface CrawledComment {
  readonly comment: RawComment;
  readonly root: HTMLElement;
}

export function crawlConversation(root: ParentNode = document): {
  readonly comments: readonly CrawledComment[];
  readonly events: readonly CrawledEvent[];
} {
  const comments: CrawledComment[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll(COMMENT_SELECTOR)) {
    const id = node.id;
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const body = bodyOf(node);
    if (looksLikeSummaryBody(body)) continue;
    if (body.trim() === '' && id.startsWith('pullrequestreview-')) continue;
    const extra = pathLineOf(node);
    const base: RawComment = {
      anchor: id,
      kind: kindOf(id),
      author: authorOf(node),
      body,
      createdAt: node.querySelector('relative-time, time-ago, time')?.getAttribute('datetime') ?? '',
    };
    const comment: RawComment =
      extra.path !== undefined && extra.line !== undefined
        ? { ...base, path: extra.path, line: extra.line }
        : extra.path !== undefined
          ? { ...base, path: extra.path }
          : extra.line !== undefined
            ? { ...base, line: extra.line }
            : base;
    comments.push({ comment, root: timelineRoot(node) });
  }
  const events: CrawledEvent[] = [];
  for (const node of root.querySelectorAll(EVENT_SELECTOR)) {
    if (node.id === '') continue;
    events.push({ anchor: node.id, root: timelineRoot(node) });
  }
  return { comments, events };
}

export function botCommentAnchors(comments: readonly CrawledComment[]): readonly string[] {
  return comments.filter((entry) => looksLikeBotLogin(entry.comment.author)).map((entry) => entry.comment.anchor);
}
