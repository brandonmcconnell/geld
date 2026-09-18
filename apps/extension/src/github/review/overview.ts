/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import type { GeldSettings } from '@geld/core';
import { repoFromPathname } from '@geld/core';
import type { GeldPrMeta, ReviewItem } from '@geld/review';
import { botTitle, clusterComments, isOpenStatus, rerunTriggerFor, verdictsFrom } from '@geld/review';
import { reviewNudgeDismissedItem } from '../../lib/local-state';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { clickResolve, copyText, focusReply, postTopLevelComment, tickSummaryCheckbox, timelineRootOf } from './actions';
import { cachedRewrite, maybeRewriteBotTitles } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { digestText, foldKey, itemKey, mountPanel, unmountPanel } from './panel';
import type { FoldRow, PanelModel, RequestableBot } from './panel';
import { restoreAll, teleportInto } from './teleport';

const PRODUCER = { kind: 'crawler' as const, version: '0.1.0', ai: false };
const ZERO_SHA = '0000000000000000000000000000000000000000';
/** "Load more" rounds we click while a deeplinked anchor is still off the page. */
const MAX_LOAD_MORE = 8;

interface VisitState {
  fullTimeline: boolean;
  openKey: string | null;
  showDone: boolean;
  nudgeDismissed: Record<string, boolean>;
  rewriteStarted: boolean;
  pageKey: string;
  generatedAt: string;
  loadMoreTries: number;
}

const visit: VisitState = {
  fullTimeline: false,
  openKey: null,
  showDone: false,
  nudgeDismissed: {},
  rewriteStarted: false,
  pageKey: '',
  generatedAt: '',
  loadMoreTries: 0,
};

void reviewNudgeDismissedItem.getValue().then((value) => {
  visit.nudgeDismissed = { ...value };
});

function hideSummary(root: HTMLElement | null): void {
  for (const node of document.querySelectorAll(`[${ATTR_SUMMARY}]`)) {
    if (node !== root) node.removeAttribute(ATTR_SUMMARY);
  }
  if (root !== null && root.getAttribute(ATTR_SUMMARY) !== 'hidden') root.setAttribute(ATTR_SUMMARY, 'hidden');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

type Crawled = ReturnType<typeof crawlConversation>;

function buildFromComments(crawled: Crawled, settings: GeldSettings, headSha: string, generatedAt: string): GeldPrMeta {
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

function foldGroups(meta: GeldPrMeta, settings: GeldSettings, crawled: Crawled): readonly FoldGroup[] {
  if (settings.compactTimeline === 'off' || visit.fullTimeline) return [];
  const botAnchors = new Set(meta.fold.comments);
  const commentRefs = crawled.comments.map((entry) => ({ author: entry.comment.author, anchor: entry.comment.anchor, root: entry.root }));
  const groups = [...groupBotRuns(commentRefs, botAnchors, crawled.events)];
  if (settings.compactTimeline === 'minimal') {
    const doneAnchors = new Set(meta.items.filter((item) => !isOpenStatus(item.status)).flatMap((item) => item.sources.map((source) => source.anchor)));
    const humans = groupDoneHumans(commentRefs, doneAnchors);
    if (humans !== null) groups.push(humans);
  }
  return groups;
}

function groupContaining(groups: readonly FoldGroup[], anchor: string): FoldGroup | null {
  const target = document.getElementById(anchor);
  if (target === null) return null;
  return groups.find((group) => group.nodes.some((node) => node === target || node.contains(target))) ?? null;
}

function avatarSrcOf(root: Element | null): string | null {
  if (root === null) return null;
  const img = root.querySelector<HTMLImageElement>('img.avatar, img[data-testid="github-avatar"], img[class*="avatar" i], a[data-hovercard-type] img');
  const src = img?.currentSrc || img?.getAttribute('src') || null;
  return src === null || src === '' ? null : src;
}

function avatarsFor(item: ReviewItem): readonly string[] {
  const seen = new Set<string>();
  const srcs: string[] = [];
  for (const source of item.sources) {
    if (seen.has(source.author)) continue;
    const node = document.getElementById(source.anchor);
    const src = avatarSrcOf(node);
    if (src === null) continue;
    seen.add(source.author);
    srcs.push(src);
    if (srcs.length === 2) break;
  }
  return srcs;
}

function foldRows(groups: readonly FoldGroup[]): readonly FoldRow[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.nodes.length,
    avatarSrc: group.author === null ? null : avatarSrcOf(group.nodes[0] ?? null),
  }));
}

/** Bots seen on this pull request that can be re-run with a comment trigger. */
function requestableBots(meta: GeldPrMeta): readonly RequestableBot[] {
  const bots: RequestableBot[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...meta.bots.map((bot) => ({ id: bot.id, login: bot.login })),
    ...meta.items.flatMap((item) => item.sources.flatMap((source) => (source.bot === undefined ? [] : [{ id: source.bot, login: source.author }]))),
  ];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    const trigger = rerunTriggerFor(candidate.id);
    if (trigger === null) continue;
    seen.add(candidate.id);
    bots.push({ id: candidate.id, label: botTitle(candidate.id, candidate.login), trigger });
  }
  return bots;
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

function composeMeta(found: ReturnType<typeof findSummaryComment>, crawled: GeldPrMeta): { readonly meta: GeldPrMeta; readonly freshness: PanelModel['freshness'] } {
  if (found === null) return { meta: withCachedTitles(crawled), freshness: 'local' };
  const usable = usableMeta(found);
  if (found.freshness === 'fresh' && usable.truncated !== true) {
    return { meta: withCachedTitles(usable), freshness: 'fresh' };
  }
  return { meta: withCachedTitles(mergeWithCrawler(usable, crawled)), freshness: found.freshness };
}

/** Timeline nodes an open row brings into its slot. */
function nodesForKey(key: string, meta: GeldPrMeta, groups: readonly FoldGroup[]): readonly HTMLElement[] {
  if (key.startsWith('fold:')) return groups.find((group) => foldKey(group.key) === key)?.nodes ?? [];
  const item = meta.items.find((entry) => itemKey(entry.id) === key);
  if (item === undefined) return [];
  const roots: HTMLElement[] = [];
  for (const source of item.sources) {
    const root = timelineRootOf(source.anchor);
    if (root !== null && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

function firstThreadAnchor(item: ReviewItem): string | null {
  return item.sources.find((source) => source.kind === 'thread')?.anchor ?? item.sources[0]?.anchor ?? null;
}

export function applyReviewOverview(settings: GeldSettings): void {
  const page = describePage(new URL(window.location.href));
  if (page.kind !== 'pull-conversation' || !settings.enabled || !settings.prOverview) {
    teardownReviewOverview();
    return;
  }
  if (visit.pageKey !== page.stateKey) {
    restoreAll();
    visit.pageKey = page.stateKey;
    visit.generatedAt = new Date().toISOString();
    visit.openKey = null;
    visit.showDone = false;
    visit.fullTimeline = false;
    visit.rewriteStarted = false;
    visit.loadMoreTries = 0;
  }
  const crawledDom = crawlConversation();
  const found = findSummaryComment(document);
  hideSummary(found?.root ?? null);
  const headSha = detectHeadSha() ?? found?.meta.headSha ?? ZERO_SHA;
  const crawled = buildFromComments(crawledDom, settings, headSha, visit.generatedAt);
  const composed = composeMeta(found, crawled);
  const meta = composed.meta;

  const viewingAnchor = sourceAnchorFromHash(location.hash);
  if (viewingAnchor !== null && document.getElementById(viewingAnchor) === null && visit.loadMoreTries < MAX_LOAD_MORE) {
    if (clickLoadMore()) visit.loadMoreTries += 1;
  }
  const groups = foldGroups(meta, settings, crawledDom);
  // A permalinked comment stays where the browser scrolled to: its fold is
  // revealed in place rather than pulled up into the panel.
  const revealed = new Set<string>();
  if (viewingAnchor !== null) {
    const group = groupContaining(groups, viewingAnchor);
    if (group !== null) revealed.add(group.key);
  }
  const compacting = settings.compactTimeline !== 'off';
  const repo = repoFromPathname(window.location.pathname) ?? '';

  const model: PanelModel = {
    meta,
    freshness: composed.freshness,
    truncated: meta.truncated === true,
    openKey: visit.openKey,
    showDone: visit.showDone,
    fullTimeline: visit.fullTimeline,
    compacting,
    nudge: found === null && visit.nudgeDismissed[repo] !== true,
    viewingAnchor,
    folds: foldRows(groups),
    requestable: requestableBots(meta),
    avatarsFor,
  };
  const reapply = (): void => applyReviewOverview(settings);
  const mounted = mountPanel(model, {
    onToggle: (key) => {
      visit.openKey = visit.openKey === key ? null : key;
      reapply();
    },
    onStatus: (id, done) => {
      const item = meta.items.find((entry) => entry.id === id);
      if (item === undefined) return;
      const thread = item.sources.find((source) => source.kind === 'thread');
      const resolvedByGitHub = thread !== undefined && clickResolve(thread.anchor);
      if (!resolvedByGitHub && found !== null) {
        tickSummaryCheckbox(
          found.root,
          item.sources.map((source) => source.anchor),
          done,
        );
      }
    },
    onReply: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      const anchor = item === undefined ? null : firstThreadAnchor(item);
      if (anchor === null) return;
      visit.openKey = itemKey(id);
      reapply();
      focusReply(anchor);
    },
    onCopy: () => {
      void copyText(digestText(meta));
    },
    onFullTimeline: () => {
      visit.fullTimeline = !visit.fullTimeline;
      if (visit.openKey?.startsWith('fold:') === true) visit.openKey = null;
      reapply();
    },
    onToggleDone: () => {
      visit.showDone = !visit.showDone;
      reapply();
    },
    onRequest: (botId) => {
      const trigger = rerunTriggerFor(botId);
      if (trigger !== null) postTopLevelComment(trigger);
    },
    onDismissNudge: () => {
      visit.nudgeDismissed = { ...visit.nudgeDismissed, [repo]: true };
      void reviewNudgeDismissedItem.setValue(visit.nudgeDismissed);
      reapply();
    },
  });

  if (mounted?.slot !== null && mounted?.slot !== undefined && visit.openKey !== null) {
    const nodes = nodesForKey(visit.openKey, meta, groups);
    if (nodes.length === 0) {
      visit.openKey = null;
      restoreAll();
    } else {
      teleportInto(mounted.slot, nodes);
    }
  } else {
    restoreAll();
  }
  applyFolds(groups, revealed);
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);

  if (!visit.rewriteStarted && !meta.producer.ai) {
    visit.rewriteStarted = true;
    void maybeRewriteBotTitles(meta.items, settings).then((rewritten) => {
      if (rewritten.length > 0) reapply();
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
  visit.openKey = null;
  visit.pageKey = '';
}

export function onReviewHashChange(settings: GeldSettings): void {
  if (describePage(new URL(window.location.href)).kind !== 'pull-conversation') return;
  const anchor = sourceAnchorFromHash(location.hash);
  if (anchor !== null) visit.loadMoreTries = 0;
  applyReviewOverview(settings);
}
