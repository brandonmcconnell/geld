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
import { clickResolve, copyText, focusReply, isResolvable, postTopLevelComment, tickSummaryCheckbox } from './actions';
import { avatarSrcFor, avatarSrcOf } from './crawler';
import { aiPending, consolidateInBrowser, resetAiForVisit, withAi } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, isFoldedNode, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { foldKey, itemKey, mountPanel, unmountPanel } from './panel';
import { digestMarkdown, itemMarkdown } from './panel-model';
import type { MarkdownSubject } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, FoldRow, GroupId, PanelModel, RequestableBot } from './panel';
import type { QuickViewTarget } from './quick-view';
import { renderQuickView } from './quick-view';
import { restoreAll } from './teleport';

const PRODUCER = { kind: 'crawler' as const, version: '0.1.0', ai: false };
const ZERO_SHA = '0000000000000000000000000000000000000000';
/** "Load more" rounds we click while a deeplinked anchor is still off the page. */
const MAX_LOAD_MORE = 8;

interface VisitState {
  fullTimeline: boolean;
  openKey: string | null;
  collapsedGroups: Set<GroupId>;
  nudgeDismissed: Record<string, boolean>;
  rewriteStarted: boolean;
  pageKey: string;
  generatedAt: string;
  loadMoreTries: number;
  /** Folds revealed in place for this visit (find-in-page hit one of their nodes). */
  revealedFolds: Set<string>;
  /** Items marked done here when neither GitHub's Resolve nor a summary checkbox could take it. */
  manualDone: Set<string>;
}

const visit: VisitState = {
  fullTimeline: false,
  openKey: null,
  collapsedGroups: new Set<GroupId>(['done']),
  nudgeDismissed: {},
  rewriteStarted: false,
  pageKey: '',
  generatedAt: '',
  loadMoreTries: 0,
  revealedFolds: new Set(),
  manualDone: new Set(),
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
      // Bot run summaries and bot review bodies fold; review threads are items, never hidden.
      comments: unique(crawled.comments.filter((entry) => entry.author.bot && entry.comment.kind !== 'thread').map((entry) => entry.comment.anchor)),
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

function avatarsFor(item: ReviewItem): readonly Avatar[] {
  const seen = new Set<string>();
  const avatars: Avatar[] = [];
  for (const source of item.sources) {
    if (seen.has(source.author)) continue;
    const src = avatarSrcFor(source.anchor);
    if (src === null) continue;
    seen.add(source.author);
    avatars.push({ src, bot: source.bot !== undefined || /\[bot\]$/i.test(source.author) });
    if (avatars.length === 2) break;
  }
  return avatars;
}

function withManualDone(meta: GeldPrMeta): GeldPrMeta {
  if (visit.manualDone.size === 0) return meta;
  return { ...meta, items: meta.items.map((item) => (visit.manualDone.has(item.id) && isOpenStatus(item.status) ? { ...item, status: 'done-manual' } : item)) };
}

function foldRows(groups: readonly FoldGroup[]): readonly FoldRow[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.nodes.length,
    avatarSrc: group.author === null ? null : avatarSrcOf(group.nodes[0] ?? null),
    firstAnchor: firstAnchorIn(group.nodes[0] ?? null),
  }));
}

function firstAnchorIn(node: HTMLElement | null): string | null {
  if (node === null) return null;
  if (node.id !== '') return node.id;
  return node.querySelector('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [id^="event-"]')?.id ?? null;
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

function composeMeta(found: ReturnType<typeof findSummaryComment>, crawled: GeldPrMeta): { readonly meta: GeldPrMeta; readonly freshness: PanelModel['freshness'] } {
  if (found === null) return { meta: withAi(crawled), freshness: 'local' };
  const usable = usableMeta(found);
  if (found.freshness === 'fresh' && usable.truncated !== true) {
    return { meta: withAi(usable), freshness: 'fresh' };
  }
  return { meta: withAi(mergeWithCrawler(usable, crawled)), freshness: found.freshness };
}

function subjectOf(): MarkdownSubject | null {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(location.pathname);
  if (match === null) return null;
  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;
  return { owner, repo, number: Number.parseInt(number, 10), origin: location.origin };
}

/** What an open row shows in its slot: the item's comments, or a fold's nodes. */
function quickViewFor(key: string, meta: GeldPrMeta, groups: readonly FoldGroup[]): QuickViewTarget | null {
  if (key.startsWith('fold:')) {
    const nodes = groups.find((group) => foldKey(group.key) === key)?.nodes ?? [];
    return nodes.length === 0 ? null : { kind: 'nodes', nodes };
  }
  const item = meta.items.find((entry) => itemKey(entry.id) === key);
  if (item === undefined) return null;
  const anchors = item.sources.map((source) => source.anchor).filter((anchor) => document.getElementById(anchor) !== null);
  return anchors.length === 0 ? null : { kind: 'comments', anchors };
}

function itemResolvable(item: ReviewItem): boolean {
  const thread = item.sources.find((source) => source.kind === 'thread');
  return thread !== undefined && isResolvable(thread.anchor);
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
    visit.collapsedGroups = new Set<GroupId>(['done']);
    visit.fullTimeline = false;
    visit.rewriteStarted = false;
    visit.loadMoreTries = 0;
    visit.revealedFolds = new Set();
    visit.manualDone = new Set();
    resetAiForVisit();
  }
  const crawledDom = crawlConversation();
  const found = findSummaryComment(document);
  hideSummary(found?.root ?? null);
  const headSha = detectHeadSha() ?? found?.meta.headSha ?? ZERO_SHA;
  const crawled = buildFromComments(crawledDom, settings, headSha, visit.generatedAt);
  const composed = composeMeta(found, crawled);
  const meta = withManualDone(composed.meta);

  const viewingAnchor = sourceAnchorFromHash(location.hash);
  if (viewingAnchor !== null && document.getElementById(viewingAnchor) === null && visit.loadMoreTries < MAX_LOAD_MORE) {
    if (clickLoadMore()) visit.loadMoreTries += 1;
  }
  const groups = foldGroups(meta, settings, crawledDom);
  // A permalinked comment stays where the browser scrolled to: its fold is
  // revealed in place rather than pulled up into the panel.
  const revealed = new Set<string>(visit.revealedFolds);
  if (viewingAnchor !== null) {
    const group = groupContaining(groups, viewingAnchor);
    if (group !== null) revealed.add(group.key);
  }
  const compacting = settings.compactTimeline !== 'off';
  const repo = repoFromPathname(window.location.pathname) ?? '';
  const fixFor = (item: ReviewItem): SuggestedFix | null => (fixVisible(item.fix, settings.suggestedFixes) ? item.fix : null);
  const subject = subjectOf();

  const model: PanelModel = {
    meta,
    freshness: composed.freshness,
    truncated: meta.truncated === true,
    openKey: visit.openKey,
    collapsedGroups: visit.collapsedGroups,
    fullTimeline: visit.fullTimeline,
    compacting,
    nudge: found === null && visit.nudgeDismissed[repo] !== true,
    viewingAnchor,
    folds: foldRows(groups),
    requestable: requestableBots(meta),
    avatarsFor,
    resolvable: itemResolvable,
    hiddenCount: groups.reduce((sum, group) => sum + group.nodes.length, 0),
    aiPending: aiPending(),
    fixFor,
  };
  const reapply = (): void => applyReviewOverview(settings);
  const mounted = mountPanel(model, {
    onToggle: (key) => {
      visit.openKey = visit.openKey === key ? null : key;
      reapply();
    },
    onToggleGroup: (group) => {
      if (visit.collapsedGroups.has(group)) visit.collapsedGroups.delete(group);
      else visit.collapsedGroups.add(group);
      if (visit.openKey !== null && ((group === 'hidden' && visit.openKey.startsWith('fold:')) || (group !== 'hidden' && visit.openKey.startsWith('item:')))) {
        visit.openKey = null;
      }
      reapply();
    },
    onCopyLink: (anchor) => {
      void copyText(`${location.origin}${location.pathname}#${anchor}`);
    },
    onStatus: (id, done) => {
      const item = meta.items.find((entry) => entry.id === id);
      if (item === undefined) return;
      // GitHub's own control first (Resolve carries every side effect the site has),
      // then the summary's task-list checkbox (the Action records done-manual), and
      // as a last resort this visit's own memory so the row still answers.
      const thread = item.sources.find((source) => source.kind === 'thread');
      if (thread !== undefined && clickResolve(thread.anchor)) return;
      if (found !== null && tickSummaryCheckbox(found.root, item.sources.map((source) => source.anchor), done)) return;
      if (done) visit.manualDone.add(id);
      else visit.manualDone.delete(id);
      reapply();
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
      void copyText(digestMarkdown(meta, subject, (item) => fixFor(item) !== null));
    },
    onCopyItem: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      if (item !== undefined) void copyText(itemMarkdown(item, subject, fixFor(item) !== null));
    },
    onCopyFix: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      const fix = item === undefined ? null : fixFor(item);
      if (fix !== null) void copyText(fix.text);
    },
    onFullTimeline: () => {
      visit.fullTimeline = !visit.fullTimeline;
      if (visit.openKey?.startsWith('fold:') === true) visit.openKey = null;
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
    const target = quickViewFor(visit.openKey, meta, groups);
    if (target === null) {
      visit.openKey = null;
      restoreAll();
    } else if (mounted.slot.childElementCount === 0) {
      renderQuickView(mounted.slot, target);
    }
  } else {
    restoreAll();
  }
  applyFolds(groups, revealed);
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);

  if (!visit.rewriteStarted && !meta.producer.ai) {
    visit.rewriteStarted = true;
    const comments: readonly RawComment[] = crawledDom.comments.map((entry) => entry.comment);
    void consolidateInBrowser(meta, comments, settings, reapply).then(() => {
      // Sources arrive in pages; another pass may find new items to ask about.
      visit.rewriteStarted = false;
    });
  }
}

/**
 * Find-in-page matched inside a folded node (`hidden="until-found"`): the
 * browser has already dropped the attribute; keep that fold revealed so the
 * next pass does not hide the match again.
 */
export function onReviewBeforeMatch(event: Event, settings: GeldSettings): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const node = target.closest('[data-geld-folded]');
  if (node === null || !isFoldedNode(node)) return;
  const page = describePage(new URL(window.location.href));
  if (page.kind !== 'pull-conversation') return;
  const crawledDom = crawlConversation();
  const headSha = detectHeadSha() ?? ZERO_SHA;
  const meta = buildFromComments(crawledDom, settings, headSha, visit.generatedAt);
  for (const group of foldGroups(meta, settings, crawledDom)) {
    if (group.nodes.some((candidate) => candidate === node || candidate.contains(node))) visit.revealedFolds.add(group.key);
  }
  applyReviewOverview(settings);
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
  visit.revealedFolds = new Set();
}

export function onReviewHashChange(settings: GeldSettings): void {
  if (describePage(new URL(window.location.href)).kind !== 'pull-conversation') return;
  const anchor = sourceAnchorFromHash(location.hash);
  if (anchor !== null) visit.loadMoreTries = 0;
  applyReviewOverview(settings);
}
