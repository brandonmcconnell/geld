/**
 * Find the Geld summary comment on a PR conversation page, parse and
 * validate it, and decide freshness against the page's head SHA.
 */

import type { GeldPrMeta, ParseResult } from '@geld/review';
import { ALLOWED_SUMMARY_AUTHORS, isAllowedSummaryAuthor, parseSummaryElement, PAYLOAD_CARRIER_SELECTOR, SUMMARY_HEADING } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { authorOf as crawlAuthor } from './crawler';

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
  const author = crawlAuthor(root);
  if (author !== null) return author.login;
  const href = root.querySelector('a[href*="/apps/"]')?.getAttribute('href') ?? '';
  if (href.includes('github-actions')) return 'github-actions[bot]';
  return '';
}

function commentRootFrom(carrier: Element): HTMLElement | null {
  const root = carrier.closest('.js-comment-container, .js-timeline-item, .TimelineItem, [id^="issuecomment-"]');
  return root instanceof HTMLElement ? root : carrier.parentElement;
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
  // The payload's carrier (an empty span's title), else the fence older summaries carried it in.
  const carriers = [...doc.querySelectorAll(`${PAYLOAD_CARRIER_SELECTOR}, pre[lang="geld"], [class*="highlight-source-geld"] pre`)];
  for (const carrier of carriers) {
    const root = commentRootFrom(carrier);
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

/**
 * The payload's bots with the page's word on what is running now. The Action
 * wrote its verdicts at one moment; a check that started since (CI, the
 * bot's own site), or a request posted since, is on the page and not in the
 * payload, and a run the payload saw running may have ended. Only that
 * transition is taken from the page — the Action's settled verdicts stand,
 * read from the API the page does not have.
 */
export function withLiveRuns(payload: readonly GeldPrMeta['bots'][number][], crawled: readonly GeldPrMeta['bots'][number][]): GeldPrMeta['bots'] {
  const live = new Map(crawled.map((bot) => [bot.id, bot]));
  const out = payload.map((bot) => {
    const now = live.get(bot.id);
    if (now === undefined) return bot;
    if (now.verdict === 'running' && bot.verdict !== 'running') return now;
    if (bot.verdict === 'running' && now.verdict !== 'running' && now.verdict !== 'loading') return now;
    return bot;
  });
  const known = new Set(payload.map((bot) => bot.id));
  return [...out, ...crawled.filter((bot) => bot.verdict === 'running' && !known.has(bot.id))];
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
    bots: payload.bots.length > 0 ? withLiveRuns(payload.bots, crawled.bots) : crawled.bots,
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
