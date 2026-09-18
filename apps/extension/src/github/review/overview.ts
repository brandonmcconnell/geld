/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import type { GeldSettings } from '@geld/core';
import type { GeldPrMeta, ReviewItem } from '@geld/review';
import { clusterComments, firstSentence, isOpenStatus, isTriggerComment, rerunTriggerFor, verdictsFrom } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { clickResolve, copyText, focusReply, isResolvable, postTopLevelComments, quoteReply, threadRootOf, tickSummaryCheckbox, timelineRootOf } from './actions';
import { authorOf, avatarSrcFor, avatarSrcOf } from './crawler';
import { aiPending, consolidateInBrowser, resetAiForVisit, withAi } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, groupTriggers, isFoldedNode, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { CHECKS_KEY, foldKey, itemKey, mountPanel, renderCommentsList, REVIEWS_KEY, unmountPanel } from './panel';
import type { HumanComment } from './panel';
import { hideHoverCard, setHoverProvider } from './hovercard';
import type { HoverPreview } from './hovercard';
import { checkCountsFrom, checksSummary, digestMarkdown, itemMarkdown, requiredReviewsFrom } from './panel-model';
import type { MarkdownSubject } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, FoldRow, GroupId, PanelHandlers, PanelModel } from './panel';
import { installedBots } from './panel-model';
import { renderQuickView } from './quick-view';
import { restoreAll, syncClones } from './teleport';

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
  /** A permalink (or find-in-page hit) still to be honoured: open its row and land on it once. */
  pendingAnchor: string | null;
  /** Comment open inside the Reviews row's list. */
  openSubKey: string | null;
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
  pendingAnchor: null,
  openSubKey: null,
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

/** The panel row that holds `anchor`: an item's row, a fold's, or null when it is not on the page. */
function rowKeyFor(anchor: string, meta: GeldPrMeta, groups: readonly FoldGroup[]): string | null {
  const item = meta.items.find((entry) => entry.sources.some((source) => source.anchor === anchor));
  if (item !== undefined) return itemKey(item.id);
  const group = groupContaining(groups, anchor);
  return group === null ? null : foldKey(group.key);
}

/** The timeline rows of an item: each source thread's row (all its comments, reply box and Resolve), once. */
function itemNodes(item: ReviewItem): readonly HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const source of item.sources) {
    const thread = threadRootOf(source.anchor);
    const row = thread?.closest('.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]') ?? thread;
    if (row instanceof HTMLElement && !roots.includes(row)) roots.push(row);
  }
  return roots;
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
  '[data-testid="mergebox-border-container"], react-partial[partial-name*="merge" i], [data-testid="mergebox-partial"], #partial-pull-merging, .pull-merging, .js-pull-merging, .mergeability-details, .merge-pr, .js-merge-pr';
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
  // The React merge box labels its sections; nothing else on the page carries this label.
  const labelled = document.querySelector('section[aria-label="Checks"]');
  if (labelled instanceof HTMLElement && labelled.closest('.geld-review') === null) {
    checksSectionEl = labelled;
    mergeHomeEl = mergeBox() ?? labelled.parentElement;
    return checksSectionEl;
  }
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

/** GitHub's 32px status ring, shrunk to the row's 16px lead. */
function cloneRing(source: SVGElement): SVGElement {
  const ring = source.cloneNode(true);
  if (!(ring instanceof SVGElement)) return source;
  ring.setAttribute('width', '16');
  ring.setAttribute('height', '16');
  ring.removeAttribute('style');
  for (const circle of ring.querySelectorAll<SVGElement>('circle')) circle.style.transition = 'none';
  return ring;
}

function timeTextOf(node: Element | null): string {
  return (node?.querySelector('relative-time, time-ago, time')?.textContent ?? '').trim();
}

/** People's comments for the Reviews row: threads (resolvable) and top-level comments (not), never bots or review requests. */
function humanComments(crawled: Crawled, meta: GeldPrMeta, settings: GeldSettings): readonly HumanComment[] {
  const list: HumanComment[] = [];
  for (const entry of crawled.comments) {
    if (entry.author.bot || isTriggerComment(entry.comment.body, settings.reviewBots)) continue;
    const anchor = entry.comment.anchor;
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === anchor));
    const resolvable = entry.comment.kind === 'thread';
    list.push({
      anchor,
      author: entry.author.login,
      avatarSrc: entry.avatarSrc,
      title: firstSentence(entry.comment.body),
      time: timeTextOf(document.getElementById(anchor)),
      resolvable,
      done: resolvable && (item !== undefined ? !isOpenStatus(item.status) : entry.comment.isResolved === true),
      replies: Math.max(0, (entry.comment.threadAnchors?.length ?? 1) - 1),
    });
  }
  return list;
}

const HOVER_BODY_SELECTOR = '.js-comment-body, .comment-body:not(.js-preview-body), [data-testid="markdown-body"], [data-testid="comment-body"], .markdown-body:not(.js-preview-body)';

/** What the hover card shows for a collapsed row: its first comment, clamped, plus a way to reply. */
function hoverPreviewFor(row: HTMLElement, meta: GeldPrMeta, groups: readonly FoldGroup[], handlers: PanelHandlers): HoverPreview | null {
  const itemId = row.getAttribute('data-geld-item');
  const foldId = row.getAttribute('data-geld-fold');
  let anchor: string | null = null;
  let more = 0;
  let onReply: (() => void) | null = null;
  if (itemId !== null) {
    const item = meta.items.find((entry) => entry.id === itemId);
    if (item === undefined) return null;
    anchor = item.sources[0]?.anchor ?? null;
    more = item.sources.length - 1;
    onReply = () => handlers.onReply(item.id);
  } else if (foldId !== null) {
    const group = groups.find((entry) => entry.key === foldId);
    const first = group?.nodes[0] ?? null;
    if (first === null) return null;
    anchor = first.id !== '' ? first.id : first.querySelector('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [id^="event-"]')?.id ?? null;
    more = (group?.nodes.length ?? 1) - 1;
  }
  if (anchor === null) return null;
  const node = document.getElementById(anchor);
  if (node === null) return null;
  const author = authorOf(node);
  const body = node.querySelector(HOVER_BODY_SELECTOR);
  const preview = body instanceof HTMLElement ? body.cloneNode(true) : null;
  if (preview instanceof HTMLElement) {
    preview.removeAttribute('id');
    for (const child of preview.querySelectorAll('[id]')) child.removeAttribute('id');
  }
  return {
    avatarSrc: avatarSrcOf(node),
    name: (author?.login ?? 'ghost').replace(/\[bot\]$/i, ''),
    bot: author?.bot ?? false,
    time: timeTextOf(node),
    body: preview instanceof HTMLElement ? preview : null,
    more,
    onReply,
  };
}

function subjectOf(): MarkdownSubject | null {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(location.pathname);
  if (match === null) return null;
  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;
  return { owner, repo, number: Number.parseInt(number, 10), origin: location.origin };
}

/** What an open row shows in its slot: the item's thread(s), a fold's nodes, or the merge box's checks. */
function quickViewFor(key: string, meta: GeldPrMeta, groups: readonly FoldGroup[]): readonly HTMLElement[] {
  // The Reviews row renders its own list; the panel itself stands in for "something to show".
  if (key === REVIEWS_KEY) return [document.documentElement];
  if (key === CHECKS_KEY) {
    const section = checksSection();
    return section === null ? [] : [section];
  }
  if (key.startsWith('fold:')) return groups.find((group) => foldKey(group.key) === key)?.nodes ?? [];
  const item = meta.items.find((entry) => itemKey(entry.id) === key);
  return item === undefined ? [] : itemNodes(item);
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
    visit.pendingAnchor = sourceAnchorFromHash(location.hash);
    visit.openSubKey = null;
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
  const compacting = settings.compactTimeline !== 'off';
  const hidingTimeline = compacting && !visit.fullTimeline;
  // In compact mode the review threads live in their rows and GitHub's checks section in the CI row:
  // both fold out of the page, so nothing below is left to reveal or scroll to.
  const foldTargets: FoldGroup[] = [...groups];
  if (hidingTimeline) {
    for (const item of meta.items) foldTargets.push({ key: itemKey(item.id), label: item.title, author: null, nodes: itemNodes(item) });
    const checksNode = checksSection();
    if (checksNode !== null) foldTargets.push({ key: CHECKS_KEY, label: 'CI checks', author: null, nodes: [checksNode] });
  }
  // A permalink (or a find-in-page hit) opens its row here rather than revealing the original down the page.
  if (visit.pendingAnchor !== null && hidingTimeline) {
    const key = rowKeyFor(visit.pendingAnchor, meta, groups);
    if (key !== null) {
      visit.openKey = key;
      if (key.startsWith('fold:')) visit.collapsedGroups.delete('hidden');
      else if (!isOpenStatus(meta.items.find((item) => itemKey(item.id) === key)?.status ?? 'open')) visit.collapsedGroups.delete('done');
    }
  }
  const fixFor = (item: ReviewItem): SuggestedFix | null => (fixVisible(item.fix, settings.suggestedFixes) ? item.fix : null);
  const subject = subjectOf();
  const boxText = mergeBoxText();
  const ringSource = checksSection()?.querySelector('svg[viewBox="0 0 100 100"]') ?? null;
  const checksRing = ringSource instanceof SVGElement ? cloneRing(ringSource) : null;
  const comments = humanComments(crawledDom, meta, settings);
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
    checksRing,
    comments,
    openSubKey: visit.openSubKey,
    running: meta.bots.some((bot) => bot.verdict === 'running'),
    reviews: requiredReviewsFrom(boxText, meta.reviewers),
    avatarsFor,
    resolvable: itemResolvable,
    hiddenCount: groups.reduce((sum, group) => sum + group.nodes.length, 0),
    aiPending: aiPending(),
    fixFor,
  };
  const reapply = (): void => applyReviewOverview(settings);
  const panelHandlers: PanelHandlers = {
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
    onQuoteReply: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      const anchor = item === undefined ? null : firstThreadAnchor(item);
      if (anchor === null) return;
      visit.openKey = itemKey(id);
      reapply();
      quoteReply(anchor);
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
    onToggleSub: (anchor) => {
      visit.openSubKey = visit.openSubKey === anchor ? null : anchor;
      reapply();
    },
    onResolveAnchor: (anchor) => {
      clickResolve(anchor);
    },
    onShowInTimeline: (anchor) => {
      visit.fullTimeline = true;
      visit.openKey = null;
      reapply();
      // The browser's own fragment jump; with the timeline shown there is nothing folded to bounce off.
      location.hash = anchor;
    },
    onOpenAnchor: (anchor) => {
      // Held by a row here? Open it. Otherwise let the browser take the reader to it in the timeline.
      const key = hidingTimeline ? rowKeyFor(anchor, meta, groups) : null;
      if (key === null) {
        location.hash = anchor;
        return;
      }
      if (key.startsWith('fold:')) visit.collapsedGroups.delete('hidden');
      visit.openKey = key;
      reapply();
    },
  };
  const mounted = mountPanel(model, panelHandlers);

  if (mounted?.slot !== null && mounted?.slot !== undefined && visit.openKey !== null) {
    const nodes = quickViewFor(visit.openKey, meta, groups);
    if (nodes.length === 0) {
      visit.openKey = null;
      restoreAll();
    } else if (mounted.slot.childElementCount === 0) {
      // The React merge box renders its check list only once expanded: ask GitHub to expand before mirroring it.
      if (visit.openKey === CHECKS_KEY) nodes[0]?.querySelector<HTMLElement>('button[aria-label="Expand checks"], button[aria-expanded="false"][aria-label*="checks" i]')?.click();
      if (visit.openKey === REVIEWS_KEY) {
        const nested = renderCommentsList(mounted.slot, model, panelHandlers);
        const subNode = visit.openSubKey === null ? null : timelineRootOf(visit.openSubKey);
        if (nested !== null && subNode !== null) renderQuickView(nested, [subNode]);
        else if (visit.openSubKey !== null && subNode === null) visit.openSubKey = null;
      } else {
        renderQuickView(mounted.slot, nodes);
      }
    } else {
      syncClones();
    }
  } else {
    restoreAll();
  }
  setHoverProvider((row) => hoverPreviewFor(row, meta, groups, panelHandlers));
  applyFolds(foldTargets, new Set());
  // The browser's fragment jump went to the original's (now empty) place in
  // the timeline; the one correction Geld makes is to land on the row that
  // holds it, once, instantly.
  if (visit.pendingAnchor !== null && mounted !== null && (visit.openKey === rowKeyFor(visit.pendingAnchor, meta, groups) || visit.loadMoreTries >= MAX_LOAD_MORE)) {
    const row = visit.openKey === null ? null : mounted.root.querySelector(`[data-geld-focus="main:${visit.openKey}"]`);
    if (row instanceof HTMLElement && hidingTimeline) row.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (row !== null || document.getElementById(visit.pendingAnchor) !== null || visit.loadMoreTries >= MAX_LOAD_MORE) visit.pendingAnchor = null;
  }
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
 * Find-in-page (or a fragment jump) matched inside a folded node
 * (`hidden="until-found"`): the browser has already dropped the attribute.
 * Rather than leaving the original revealed down the page, open the panel
 * row that holds it, where the reader will land.
 */
export function onReviewBeforeMatch(event: Event, settings: GeldSettings): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const node = target.closest('[data-geld-folded]');
  if (node === null || !isFoldedNode(node)) return;
  if (describePage(new URL(window.location.href)).kind !== 'pull-conversation') return;
  const anchor = node.id !== '' ? node.id : node.querySelector('[id^="discussion_r"], [id^="issuecomment-"], [id^="pullrequestreview-"], [id^="event-"]')?.id ?? null;
  if (anchor === null) return;
  visit.pendingAnchor = anchor;
  visit.loadMoreTries = MAX_LOAD_MORE;
  applyReviewOverview(settings);
}

export function teardownReviewOverview(): void {
  hideHoverCard();
  setHoverProvider(null);
  unmountPanel();
  hideSummary(null);
  applyFolds([], new Set());
  collapseDescription(false);
  setFullTimeline(false);
  visit.rewriteStarted = false;
  visit.openKey = null;
  visit.pageKey = '';
  visit.pendingAnchor = null;
}

export function onReviewHashChange(settings: GeldSettings): void {
  if (describePage(new URL(window.location.href)).kind !== 'pull-conversation') return;
  const anchor = sourceAnchorFromHash(location.hash);
  if (anchor !== null) {
    visit.loadMoreTries = 0;
    visit.pendingAnchor = anchor;
  }
  applyReviewOverview(settings);
}
