/**
 * Find the Geld summary comment on a PR conversation page, parse and
 * validate it, and decide freshness against the page's head SHA.
 */

import type { GeldPrMeta, ParseResult } from '@geld/review';
import { ALLOWED_SUMMARY_AUTHORS, isAllowedSummaryAuthor, parseSummaryElement, SUMMARY_HEADING } from '@geld/review';
import { detectHeadSha } from '../head-sha';

export const ATTR_SUMMARY = 'data-geld-summary';

export type MetaFreshness = 'fresh' | 'stale' | 'partial';

export interface FoundSummary {
  readonly root: HTMLElement;
  readonly author: string;
  readonly meta: GeldPrMeta;
  readonly freshness: MetaFreshness;
  readonly missingAnchors: readonly string[];
}

function authorOf(root: Element): string {
  const link = root.querySelector('a.author, a[data-hovercard-type="user"], a[href*="/apps/"]');
  const text = (link?.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/^@/, '');
  if (text !== '') return text;
  const href = link?.getAttribute('href') ?? '';
  if (href.includes('github-actions')) return 'github-actions[bot]';
  if (/\/apps\/geld(?:-sh)?(?:\/|$)/.test(href)) return 'geld[bot]';
  return '';
}

function commentRootFrom(pre: Element): HTMLElement | null {
  const root = pre.closest('.js-comment-container, .js-timeline-item, .TimelineItem, [id^="issuecomment-"]');
  return root instanceof HTMLElement ? root : pre.parentElement;
}

function collectAnchors(meta: GeldPrMeta): readonly string[] {
  const anchors: string[] = [];
  for (const item of meta.items) {
    for (const source of item.sources) anchors.push(source.anchor);
  }
  return [...anchors, ...meta.fold.comments, ...meta.fold.events];
}

function missingAnchorsOf(meta: GeldPrMeta, doc: Document): readonly string[] {
  return collectAnchors(meta).filter((anchor) => doc.getElementById(anchor) === null);
}

export function findSummaryComment(doc: Document = document): FoundSummary | null {
  const pres = [...doc.querySelectorAll('pre[lang="geld"], [class*="highlight-source-geld"] pre')];
  for (const pre of pres) {
    const root = commentRootFrom(pre);
    if (root === null) continue;
    const author = authorOf(root);
    if (!isAllowedSummaryAuthor(author)) {
      if (author !== '' && headingLooksLikeSummary(root)) {
        console.warn('[geld] Ignoring review summary from', author, '— allowed:', ALLOWED_SUMMARY_AUTHORS.join(', '));
      }
      continue;
    }
    const parsed = parseSummaryElement(root);
    if (!parsed.ok) continue;
    return present(root, author, parsed, doc);
  }
  return null;
}

function headingLooksLikeSummary(root: Element): boolean {
  return (root.textContent ?? '').includes(SUMMARY_HEADING);
}

function present(root: HTMLElement, author: string, parsed: Extract<ParseResult<GeldPrMeta>, { ok: true }>, doc: Document): FoundSummary {
  const missing = missingAnchorsOf(parsed.value, doc);
  const head = detectHeadSha();
  const shaMatch = head === null || parsed.value.headSha.toLowerCase() === head.toLowerCase() || head.toLowerCase().startsWith(parsed.value.headSha.toLowerCase());
  const freshness: MetaFreshness = !shaMatch ? 'stale' : missing.length > 0 ? 'partial' : 'fresh';
  return { root, author, meta: parsed.value, freshness, missingAnchors: missing };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Combine a (possibly stale or truncated) payload with what the timeline currently shows. */
export function mergeWithCrawler(payload: GeldPrMeta, crawled: GeldPrMeta): GeldPrMeta {
  const seen = new Set(payload.items.flatMap((item) => item.sources.map((source) => source.anchor)));
  const extra = crawled.items.filter((item) => item.sources.some((source) => !seen.has(source.anchor)));
  const stillTruncated = payload.truncated === true && extra.length === 0;
  const merged: GeldPrMeta = {
    v: 1,
    generatedAt: payload.generatedAt,
    headSha:
      crawled.headSha !== '' && crawled.headSha !== '0000000000000000000000000000000000000000' ? crawled.headSha : payload.headSha,
    producer: payload.producer,
    items: extra.length === 0 ? payload.items : [...payload.items, ...extra],
    bots: payload.bots.length > 0 ? payload.bots : crawled.bots,
    reviewers: payload.reviewers.length > 0 ? payload.reviewers : crawled.reviewers,
    fold: {
      comments: unique([...payload.fold.comments, ...crawled.fold.comments]),
      events: unique([...payload.fold.events, ...crawled.fold.events]),
    },
  };
  return stillTruncated ? { ...merged, truncated: true } : merged;
}

/** Drop items (and fold ids) whose anchors are not on the page. */
export function usableMeta(found: Pick<FoundSummary, 'meta' | 'missingAnchors'>): GeldPrMeta {
  if (found.missingAnchors.length === 0) return found.meta;
  const missing = new Set(found.missingAnchors);
  for (const anchor of missing) console.warn('[geld] Summary item refers to missing anchor', anchor);
  return {
    ...found.meta,
    items: found.meta.items.filter((item) => item.sources.every((source) => !missing.has(source.anchor))),
    fold: {
      comments: found.meta.fold.comments.filter((anchor) => !missing.has(anchor)),
      events: found.meta.fold.events.filter((anchor) => !missing.has(anchor)),
    },
  };
}
