/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel, fold the timeline, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again.
 */

import type { GeldSettings } from '@geld/core';
import { repoFromPathname } from '@geld/core';
import type { GeldPrMeta, ReviewItem } from '@geld/review';
import { clusterComments, isOpenStatus, verdictsFrom } from '@geld/review';
import { reviewNudgeDismissedItem } from '../../lib/local-state';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { confirmRerun, copyText, tickSummaryCheckbox } from './actions';
import { cachedRewrite, maybeRewriteBotTitles } from './ai';
import { crawlConversation } from './crawler';
import { itemIdForAnchor, revealAnchor, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { digestText, mountPanel, unmountPanel } from './panel';
import type { PanelModel } from './panel';

const PRODUCER = { kind: 'crawler' as const, version: '0.1.0', ai: false };
const ZERO_SHA = '0000000000000000000000000000000000000000';

interface VisitState {
  fullTimeline: boolean;
  openItemId: string | null;
  expandedFolds: Set<string>;
  nudgeDismissed: Record<string, boolean>;
  rewriteStarted: boolean;
  pageKey: string;
  generatedAt: string;
}

const visit: VisitState = {
  fullTimeline: false,
  openItemId: null,
  expandedFolds: new Set(),
  nudgeDismissed: {},
  rewriteStarted: false,
  pageKey: '',
  generatedAt: '',
};

void reviewNudgeDismissedItem.getValue().then((value) => {
  visit.nudgeDismissed = { ...value };
});

function hideSummary(root: HTMLElement | null): void {
  for (const node of document.querySelectorAll(`[${ATTR_SUMMARY}]`)) node.removeAttribute(ATTR_SUMMARY);
  if (root !== null) root.setAttribute(ATTR_SUMMARY, 'hidden');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildFromComments(
  crawled: ReturnType<typeof crawlConversation>,
  settings: GeldSettings,
  headSha: string,
  generatedAt: string,
): GeldPrMeta {
  const comments = crawled.comments.map((entry) => entry.comment);
  const items = clusterComments(comments, settings.reviewBots);
  const bots = verdictsFrom(
    [],
    comments.map((comment) => ({ author: comment.author, body: comment.body, anchor: comment.anchor })),
    headSha,
    settings.reviewBots,
  );
  return {
    v: 1,
    generatedAt,
    headSha,
    producer: PRODUCER,
    items,
    bots,
    reviewers: [],
    fold: {
      comments: unique(crawled.comments.filter((entry) => entry.comment.author.endsWith('[bot]')).map((entry) => entry.comment.anchor)),
      events: crawled.events.map((event) => event.anchor),
    },
  };
}

function hashItemId(items: readonly ReviewItem[]): string | null {
  const anchor = sourceAnchorFromHash(location.hash);
  if (anchor === null) return null;
  return itemIdForAnchor(items, anchor);
}

function foldGroups(meta: GeldPrMeta, settings: GeldSettings, crawled: ReturnType<typeof crawlConversation>): readonly FoldGroup[] {
  if (settings.compactTimeline === 'off' || visit.fullTimeline) return [];
  const botAnchors = new Set(meta.fold.comments);
  const commentRefs = crawled.comments.map((entry) => ({ author: entry.comment.author, anchor: entry.comment.anchor, root: entry.root }));
  const groups = [...groupBotRuns(commentRefs, botAnchors, crawled.events)];
  if (settings.compactTimeline === 'minimal') {
    const doneAnchors = new Set(
      meta.items.filter((item) => !isOpenStatus(item.status)).flatMap((item) => item.sources.map((source) => source.anchor)),
    );
    const humans = groupDoneHumans(commentRefs, doneAnchors);
    if (humans !== null) groups.push(humans);
  }
  return groups;
}

function expandedFoldKeys(groups: readonly FoldGroup[], anchor: string | null): ReadonlySet<string> {
  const keys = new Set(visit.expandedFolds);
  if (anchor === null) return keys;
  for (const group of groups) {
    if (group.nodes.some((node) => node.id === anchor || node.querySelector(`#${CSS.escape(anchor)}`) !== null)) {
      keys.add(group.key);
    }
  }
  return keys;
}

function withCachedTitles(meta: GeldPrMeta): GeldPrMeta {
  let changed = false;
  const items = meta.items.map((item) => {
    const update = cachedRewrite(item.id);
    if (update === null || item.rewritten) return item;
    changed = true;
    return {
      ...item,
      title: update.title,
      rewritten: true,
      ...(update.severity === undefined ? {} : { severity: update.severity }),
    };
  });
  return changed ? { ...meta, items } : meta;
}

function composeMeta(
  found: ReturnType<typeof findSummaryComment>,
  crawled: GeldPrMeta,
): { readonly meta: GeldPrMeta; readonly freshness: PanelModel['freshness'] } {
  if (found === null) return { meta: withCachedTitles(crawled), freshness: 'local' };
  const usable = usableMeta(found);
  if (found.freshness === 'fresh' && usable.truncated !== true) {
    return { meta: withCachedTitles(usable), freshness: 'fresh' };
  }
  return { meta: withCachedTitles(mergeWithCrawler(usable, crawled)), freshness: found.freshness };
}

export function applyReviewOverview(settings: GeldSettings): void {
  const page = describePage(new URL(window.location.href));
  if (page.kind !== 'pull-conversation' || !settings.enabled || !settings.prOverview) {
    teardownReviewOverview();
    return;
  }
  const crawledDom = crawlConversation();
  const found = findSummaryComment(document);
  hideSummary(found?.root ?? null);
  if (visit.pageKey !== page.stateKey) {
    visit.pageKey = page.stateKey;
    visit.generatedAt = new Date().toISOString();
    visit.openItemId = null;
    visit.fullTimeline = false;
    visit.expandedFolds = new Set();
    visit.rewriteStarted = false;
  }
  const headSha = detectHeadSha() ?? found?.meta.headSha ?? ZERO_SHA;
  const crawled = buildFromComments(crawledDom, settings, headSha, visit.generatedAt);
  const composed = composeMeta(found, crawled);
  const viewingAnchor = sourceAnchorFromHash(location.hash);
  visit.openItemId = hashItemId(composed.meta.items) ?? visit.openItemId;
  const repo = repoFromPathname(window.location.pathname) ?? '';
  const model: PanelModel = {
    meta: composed.meta,
    freshness: composed.freshness,
    truncated: composed.meta.truncated === true,
    openItemId: visit.openItemId,
    fullTimeline: visit.fullTimeline,
    nudge: found === null && visit.nudgeDismissed[repo] !== true,
    viewingAnchor,
  };
  mountPanel(model, {
    onToggleItem: (id) => {
      visit.openItemId = visit.openItemId === id ? null : id;
      applyReviewOverview(settings);
    },
    onTick: (id, checked) => {
      const item = composed.meta.items.find((entry) => entry.id === id);
      if (item === undefined || found === null) return;
      tickSummaryCheckbox(
        found.root,
        item.sources.map((source) => source.anchor),
        checked,
      );
    },
    onCopy: () => {
      void copyText(digestText(composed.meta));
    },
    onFullTimeline: () => {
      visit.fullTimeline = !visit.fullTimeline;
      setFullTimeline(visit.fullTimeline);
      applyReviewOverview(settings);
    },
    onRerun: (botId) => {
      confirmRerun(botId);
    },
    onDismissNudge: () => {
      visit.nudgeDismissed = { ...visit.nudgeDismissed, [repo]: true };
      void reviewNudgeDismissedItem.setValue(visit.nudgeDismissed);
      applyReviewOverview(settings);
    },
    onShowInTimeline: (anchor) => {
      const groups = foldGroups(composed.meta, settings, crawledDom);
      for (const group of groups) {
        if (group.nodes.some((node) => node.id === anchor || node.querySelector(`#${CSS.escape(anchor)}`) !== null)) {
          visit.expandedFolds.add(group.key);
        }
      }
      applyReviewOverview(settings);
      revealAnchor(anchor);
    },
  });
  const groups = foldGroups(composed.meta, settings, crawledDom);
  applyFolds(visit.fullTimeline || settings.compactTimeline === 'off' ? [] : groups, expandedFoldKeys(groups, viewingAnchor));
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);
  if (viewingAnchor !== null) revealAnchor(viewingAnchor);
  if (!visit.rewriteStarted && !composed.meta.producer.ai) {
    visit.rewriteStarted = true;
    void maybeRewriteBotTitles(composed.meta.items, settings).then((rewritten) => {
      if (rewritten.length === 0) return;
      applyReviewOverview(settings);
    });
  }
}

export function teardownReviewOverview(): void {
  unmountPanel();
  hideSummary(null);
  applyFolds([], new Set());
  collapseDescription(false);
  setFullTimeline(false);
  visit.rewriteStarted = false;
  visit.pageKey = '';
}

export function onReviewHashChange(settings: GeldSettings): void {
  if (describePage(new URL(window.location.href)).kind !== 'pull-conversation') return;
  applyReviewOverview(settings);
}
