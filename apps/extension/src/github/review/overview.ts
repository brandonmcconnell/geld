/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import type { GeldSettings } from '@geld/core';
import type { GeldPrMeta, ReviewItem } from '@geld/review';
import { clusterComments, isOpenStatus, isTriggerComment, rerunTriggerFor, verdictsFrom } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { clickResolve, copyText, focusReply, isResolvable, postTopLevelComments, tickSummaryCheckbox } from './actions';
import { avatarSrcFor, avatarSrcOf } from './crawler';
import { aiPending, consolidateInBrowser, resetAiForVisit, withAi } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, groupTriggers, isFoldedNode, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { CHECKS_KEY, foldKey, itemKey, mountPanel, unmountPanel } from './panel';
import { checkCountsFrom, checksSummary, digestMarkdown, itemMarkdown, requiredReviewsFrom } from './panel-model';
import type { MarkdownSubject } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, FoldRow, GroupId, PanelModel } from './panel';
import { installedBots } from './panel-model';
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
  rewriteStarted: false,
  pageKey: '',
  generatedAt: '',
  loadMoreTries: 0,
  revealedFolds: new Set(),
  manualDone: new Set(),
};

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
      // Bot run summaries, bot review bodies and "@bot review" requests fold; review threads are items, never hidden.
      comments: unique(
        crawled.comments
          .filter((entry) => entry.comment.kind !== 'thread' && (entry.author.bot || isTriggerComment(entry.comment.body, settings.reviewBots)))
          .map((entry) => entry.comment.anchor),
      ),
      events: crawled.events.map((event) => event.anchor),
    },
  };
}

function foldGroups(meta: GeldPrMeta, settings: GeldSettings, crawled: Crawled): readonly FoldGroup[] {
  if (settings.compactTimeline === 'off' || visit.fullTimeline) return [];
  const triggerAnchors = new Set(crawled.comments.filter((entry) => !entry.author.bot && isTriggerComment(entry.comment.body, settings.reviewBots)).map((entry) => entry.comment.anchor));
  const botAnchors = new Set(meta.fold.comments.filter((anchor) => !triggerAnchors.has(anchor)));
  const commentRefs = crawled.comments.map((entry) => ({ author: entry.comment.author, anchor: entry.comment.anchor, root: entry.root }));
  const groups = [...groupBotRuns(commentRefs, botAnchors, [])];
  const triggers = groupTriggers(commentRefs, triggerAnchors);
  if (triggers !== null) groups.push(triggers);
  const eventGroup = groupBotRuns([], new Set(), crawled.events);
  groups.push(...eventGroup);
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


function composeMeta(found: ReturnType<typeof findSummaryComment>, crawled: GeldPrMeta): { readonly meta: GeldPrMeta; readonly freshness: PanelModel['freshness'] } {
  if (found === null) return { meta: withAi(crawled), freshness: 'local' };
  const usable = usableMeta(found);
  if (found.freshness === 'fresh' && usable.truncated !== true) {
    return { meta: withAi(usable), freshness: 'fresh' };
  }
  return { meta: withAi(mergeWithCrawler(usable, crawled)), freshness: found.freshness };
}

/**
 * GitHub's merge box: the checks list and the review requirements live
 * there, in either the legacy Rails markup or the React partial. The CI row
 * shows its counts and, opened, the section itself (read-only clone).
 */
const MERGE_BOX_SELECTOR =
  'react-partial[partial-name*="merge" i], [data-testid="mergebox-partial"], #partial-pull-merging, .pull-merging, .js-pull-merging, .mergeability-details, .merge-pr, .js-merge-pr';
const CHECK_HEADING = /^\d+\s+(?:in progress|action required|timed out|[a-z]+)\s+checks?$/i;

function mergeBox(): HTMLElement | null {
  const box = document.querySelector(MERGE_BOX_SELECTOR);
  return box instanceof HTMLElement ? box : null;
}

/** The checks section, remembered once found: quick view moves it out of the merge box, and the counts must keep reading from it. */
let checksSectionEl: HTMLElement | null = null;
/** Where that section came from — the merge box — so its text can be read while the section is away. */
let mergeHomeEl: HTMLElement | null = null;

/**
 * The merge box's checks section, located by its own headings ("1 in
 * progress check", "8 successful checks") rather than by container
 * markup, which differs between the Rails and React merge boxes: the
 * nearest ancestor that holds every such heading, stopping before the
 * merge box itself.
 */
function checksSection(): HTMLElement | null {
  if (checksSectionEl !== null && checksSectionEl.isConnected) return checksSectionEl;
  const headings = [...document.querySelectorAll<HTMLElement>('button, summary, h2, h3, h4, span, p, div')].filter(
    (node) => node.childElementCount <= 2 && CHECK_HEADING.test((node.textContent ?? '').replace(/\s+/g, ' ').trim()) && node.closest('.geld-review') === null,
  );
  const first = headings[0];
  if (first === undefined) return null;
  const box = mergeBox();
  let ancestor: HTMLElement | null = first.parentElement;
  while (ancestor !== null && ancestor !== box && ancestor !== document.body && !headings.every((heading) => ancestor?.contains(heading) === true)) {
    ancestor = ancestor.parentElement;
  }
  if (ancestor === null || ancestor === document.body) return null;
  // Legacy merge boxes list one "check" per row: step out to the section that also holds the rows.
  let section = ancestor;
  while (section.parentElement !== null && section.parentElement !== box && section.parentElement !== document.body && section.matches('button, summary, h2, h3, h4, span, p')) {
    section = section.parentElement;
  }
  checksSectionEl = section === box ? null : section;
  if (checksSectionEl !== null) mergeHomeEl = box ?? checksSectionEl.parentElement;
  return checksSectionEl;
}

/** Merge box text plus the checks section's, wherever quick view has put it. */
function mergeBoxText(): string {
  const section = checksSection();
  // No recognisable container: the checks section's original parent is the merge box in every markup seen so far.
  const home = mergeBox() ?? mergeHomeEl;
  const parts = [home?.textContent ?? ''];
  if (section !== null && (home === null || !home.contains(section))) parts.push(section.textContent ?? '');
  return parts.join('\n');
}

function subjectOf(): MarkdownSubject | null {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(location.pathname);
  if (match === null) return null;
  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;
  return { owner, repo, number: Number.parseInt(number, 10), origin: location.origin };
}

/** What an open row shows in its slot: the item's comments, a fold's nodes, or the merge box's checks. */
function quickViewFor(key: string, meta: GeldPrMeta, groups: readonly FoldGroup[]): QuickViewTarget | null {
  if (key === CHECKS_KEY) {
    const section = checksSection();
    return section === null ? null : { kind: 'nodes', nodes: [section] };
  }
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
    checksSectionEl = null;
    mergeHomeEl = null;
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
  // In compact mode GitHub's checks section lives in the CI row instead of the merge box.
  const checksNode = settings.compactTimeline === 'off' || visit.fullTimeline ? null : checksSection();
  const foldTargets: readonly FoldGroup[] = checksNode === null ? groups : [...groups, { key: CHECKS_KEY, label: 'CI checks', author: null, nodes: [checksNode] }];
  // A permalinked comment stays where the browser scrolled to: its fold is
  // revealed in place rather than pulled up into the panel.
  const revealed = new Set<string>(visit.revealedFolds);
  if (viewingAnchor !== null) {
    const group = groupContaining(groups, viewingAnchor);
    if (group !== null) revealed.add(group.key);
  }
  const compacting = settings.compactTimeline !== 'off';
  const fixFor = (item: ReviewItem): SuggestedFix | null => (fixVisible(item.fix, settings.suggestedFixes) ? item.fix : null);
  const subject = subjectOf();
  const boxText = mergeBoxText();
  const requestable = installedBots(meta, document);
  const iconByBot = new Map(requestable.map((bot) => [bot.id, bot.iconSrc]));

  const model: PanelModel = {
    meta,
    freshness: composed.freshness,
    truncated: meta.truncated === true,
    openKey: visit.openKey,
    collapsedGroups: visit.collapsedGroups,
    fullTimeline: visit.fullTimeline,
    compacting,
    nudge: found === null,
    viewingAnchor,
    folds: foldRows(groups),
    requestable,
    summaryAnchorFor: (botId) => meta.bots.find((bot) => bot.id === botId)?.sourceId ?? null,
    botIconFor: (botId) => iconByBot.get(botId) ?? avatarSrcFor(meta.bots.find((bot) => bot.id === botId)?.sourceId ?? ''),
    checks: checkCountsFrom(checksSection()?.textContent ?? boxText),
    reviews: requiredReviewsFrom(boxText, meta.reviewers),
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
      const bodies = new Map(crawledDom.comments.map((entry) => [entry.comment.anchor, entry.comment.body]));
      const status: string[] = [];
      if (model.checks !== null) status.push(`CI: ${checksSummary(model.checks)}`);
      if (model.reviews !== null) status.push(`Reviews: ${model.reviews.changesRequested ? 'changes requested' : `${model.reviews.approvals}/${model.reviews.required} approvals`}`);
      void copyText(
        digestMarkdown(meta, subject, (item) => fixFor(item) !== null, {
          status,
          excerptFor: (anchor) => {
            const body = bodies.get(anchor);
            if (body === undefined) return null;
            const flat = body.replace(/\s+/g, ' ').trim();
            return flat.length > 280 ? `${flat.slice(0, 277)}…` : flat;
          },
        }),
      );
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
    onRequest: (botIds) => {
      const triggers = botIds.map((id) => rerunTriggerFor(id)).filter((trigger): trigger is string => trigger !== null);
      void postTopLevelComments(triggers);
    },
    onOpenAnchor: (anchor) => {
      // Folded here? Open its row. Otherwise let the browser take the reader to it in the timeline.
      const group = compacting && !visit.fullTimeline ? groupContaining(groups, anchor) : null;
      if (group === null) {
        location.hash = anchor;
        return;
      }
      visit.collapsedGroups.delete('hidden');
      visit.openKey = foldKey(group.key);
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
  applyFolds(foldTargets, revealed);
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
