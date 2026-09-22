/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import { createElement } from '../dom';
import type { GeldSettings } from '@geld/core';
import type { BotVerdictRecord, CommentLane, GeldPrMeta, ReviewItem } from '@geld/review';
import { botTitle, clusterComments, firstSentence, isOpenStatus, isTriggerComment, latestPreviews, parsePreviews, rerunTriggerFor, resolveBotId, verdictsFrom } from '@geld/review';
import type { Preview } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { persist } from '../../lib/context';
import { settingsItem } from '../../lib/storage';
import { clickResolve, copyText, focusReply, isResolvable, openReactions, postTopLevelComments, quoteReply, threadRootOf, tickSummaryCheckbox, timelineRootOf } from './actions';
import { authorOf, avatarSrcFor, avatarSrcForLogin, avatarSrcOf, blockText, normalizeAvatarSrc, crawlCheckRuns, crawlLeftovers, crawlReviews, findIn, latestReviewers, reviewCommentOf, THREAD_SELECTOR } from './crawler';
import type { CrawledComment, CrawledReview } from './crawler';
import type { CommentToClassify, JevDecisions, PreviewToClassify, ThreadToClassify } from './ai';
import { aiPending, aiStateFor, clearAiForPage, jevDecisionsFor, loadAiForPage, previewDecisionKey, runAi, withAi, withJevDone } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, fragmentHeaders, sourceAnchorFromHash } from './deeplink';
import { refDetails, refsVersion, resetRefs } from './refs';
import { diffHashOf, isTrimmedPath, resetWholePaths, wholePath } from './whole-path';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, groupLeftovers, groupTriggers, isFoldedNode, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { ATTR_CTL_SLOT, ATTR_GEAR_SLOT, batchKey, CHECKS_KEY, foldKey, isVerdict, itemKey, mountPanel, PREVIEWS_KEY, renderBatchView, renderCommentsList, renderReviewBody, REVIEWS_KEY, syncSpinners, unmountPanel } from './panel';
import type { Batch, ReviewEntry, ReviewEntryState, ReviewThreadRef } from './panel';
import { hideHoverCard, setHoverProvider, setWhoProvider } from './hovercard';
import type { HoverPreview, WhoCard } from './hovercard';
import { checkCountsFrom, checksSummary, digestMarkdown, isCurrent, itemMarkdown, requiredReviewsFrom } from './panel-model';
import type { MarkdownSubject, RequiredReviews } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, FoldRow, GroupId, PanelHandlers, PanelModel } from './panel';
import { installedBots } from './panel-model';
import { outgoingMentions, renderMentionsView, renderQuickView } from './quick-view';
import { renderChatView, renderCommentChat, sourceFocusKey, threadAnchorOf } from './chat';
import type { ChatHandlers, ChatSource } from './chat';
import { adoptReplacement, closestAtHome, compareHome, forgetLoan, onRestore, restoreAll, teleportInto, wornPiecesOf } from './teleport';

const PRODUCER = { kind: 'crawler' as const, version: '0.1.0', ai: false };
const ZERO_SHA = '0000000000000000000000000000000000000000';
/** "Load more" rounds we click while a deeplinked anchor is still off the page. */
const MAX_LOAD_MORE = 8;
/** "Load more" presses per visit in compact mode (each brings a page of hidden items). */
const MAX_AUTO_LOADS = 40;

interface VisitState {
  fullTimeline: boolean;
  openKey: string | null;
  collapsedGroups: Set<GroupId>;
  pageKey: string;
  generatedAt: string;
  loadMoreTries: number;
  /** A permalink (or find-in-page hit) still to be honoured: open its row and land on it once. */
  pendingAnchor: string | null;
  /** Comment open inside the Reviews row's list. */
  openSubKey: string | null;
  /** Threads (by first-comment anchor) showing the review comment they came from. */
  sourcesShown: Set<string>;
  archivedPreviewsOpen: boolean;
  /** Rounds whose commit rows are unfolded (batch grouping). */
  openCommits: Set<string>;
  /** "At least N approving reviews" as last stated by the merge box; it stops saying so once met. */
  knownRequired: number | null;
  /** The last reading, kept while React re-renders the merge box (a blank pass must not drop the row). */
  lastReviews: RequiredReviews | null;
  /** GitHub's checks list has been asked to render (its gear lives there). */
  checksExpanded: boolean;
  autoLoads: number;
  /** Items marked done here when neither GitHub's Resolve nor a summary checkbox could take it. */
  manualDone: Set<string>;
  /**
   * A thread on loan to the panel just changed state (Resolve was pressed in
   * it): the item row that was open, and until when to wait for the crawl to
   * see the change, so the settled item - and its round, once nothing in it
   * is open - can be closed for the reader.
   */
  settling: { readonly itemKey: string | null; readonly until: number; readonly wasOpen: boolean } | null;
  /**
   * The open comment line's words, as they read when it opened. Its node is on
   * loan to the panel while open, and some of what the crawl reads from it -
   * the first sentence, the time, the avatar - reads differently there (a
   * worn header, a fragment that loads, a body the quick view holds). Any
   * such difference changed the panel's signature, which swapped the panel,
   * returned the loan, re-made it, and read the old words again: content and
   * timestamps blinking for as long as the line stayed open. The line keeps
   * the words it opened with until it closes.
   */
  pinnedEntry: { readonly anchor: string; readonly preview: string; readonly time: string; readonly avatarSrc: string | null } | null;
}

const visit: VisitState = {
  fullTimeline: false,
  openKey: null,
  collapsedGroups: new Set<GroupId>(['done']),
  pageKey: '',
  generatedAt: '',
  loadMoreTries: 0,
  pendingAnchor: null,
  openSubKey: null,
  sourcesShown: new Set<string>(),
  archivedPreviewsOpen: false,
  openCommits: new Set<string>(),
  knownRequired: null,
  lastReviews: null,
  checksExpanded: false,
  autoLoads: 0,
  manualDone: new Set(),
  settling: null,
  pinnedEntry: null,
};

/** The open comment line wears the words it opened with (see `VisitState.pinnedEntry`). */
function pinOpenEntry(entries: readonly ReviewEntry[]): readonly ReviewEntry[] {
  const open = visit.openSubKey;
  if (open === null || open.startsWith('item:')) {
    visit.pinnedEntry = null;
    return entries;
  }
  const current = entries.find((entry) => entry.anchor === open);
  if (current === undefined) return entries;
  if (visit.pinnedEntry === null || visit.pinnedEntry.anchor !== open) {
    visit.pinnedEntry = { anchor: open, preview: current.preview, time: current.time, avatarSrc: current.avatarSrc };
    return entries;
  }
  const pinned = visit.pinnedEntry;
  if (current.preview === pinned.preview && current.time === pinned.time && current.avatarSrc === pinned.avatarSrc) return entries;
  return entries.map((entry) => (entry.anchor === open ? { ...entry, preview: pinned.preview, time: pinned.time, avatarSrc: pinned.avatarSrc } : entry));
}

/**
 * The reviewers GitHub is still waiting on, from the sidebar's "Awaiting
 * requested review from X" controls (the merge box only says "2 pending
 * reviews" behind a collapsed group). Lines with nothing to open.
 */
function awaitingReviewers(): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  for (const control of document.querySelectorAll<HTMLElement>('[aria-label^="Awaiting requested review from" i]')) {
    const login = /from\s+(\S+)/i.exec(control.getAttribute('aria-label') ?? '')?.[1] ?? '';
    if (login === '' || out.some((entry) => entry.author === login)) continue;
    const item = control.closest('.d-flex, li, [data-testid]') ?? control.parentElement;
    const image = item?.querySelector<HTMLImageElement>('img.avatar, img[class*="avatar"]') ?? null;
    out.push({ anchor: `awaiting:${login}`, author: login, avatarSrc: image === null ? avatarSrcForLogin(login) : normalizeAvatarSrc(image.currentSrc || image.getAttribute('src') || ''), state: 'awaiting', preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null });
  }
  return out;
}

/**
 * Threads live in the panel while their rows are open, and GitHub rewrites a
 * thread in place when it is resolved or unresolved (`data-resolved`, or the
 * whole container swapped for its collapsed form). The page-wide observer
 * treats mutations inside the panel as the panel's own, so this one watches
 * the panel for exactly that and re-applies: the crawl then reads the new
 * state, the row turns, and the settled item closes.
 */
let loanWatcher: MutationObserver | null = null;
let loanWatched: Element | null = null;
const THREAD_STATE = '[data-resolved], .js-resolvable-timeline-thread-container, .js-resolvable-thread-contents, .review-thread-component, [data-testid*="thread" i]';

/**
 * Did GitHub change something inside a loaned thread? Resolving rewrites the
 * thread differently per view - `data-resolved` flips, the container is
 * swapped, or only the button's text turns to "Unresolve conversation" - so
 * any mutation inside a loaned thread counts, except the panel's own loans
 * and moves, and edits inside a form (typing a reply is not a state change).
 */
function touchesThreadState(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target === null) return false;
  if (target.closest('form, textarea, [contenteditable]') !== null) return false;
  if (record.type === 'attributes') {
    if (record.attributeName === 'data-resolved') return true;
    return target.closest(`${THREAD_SELECTOR}, ${THREAD_STATE}`) !== null && (record.attributeName === 'aria-pressed' || record.attributeName === 'aria-label' || record.attributeName === 'hidden');
  }
  if (record.type === 'characterData') return target.closest(`${THREAD_SELECTOR}, ${THREAD_STATE}`) !== null;
  // Nodes the panel moves in and out carry the loan token; what GitHub writes does not.
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (node instanceof Element && (node.hasAttribute('data-geld-teleported') || node.closest('.geld-review__qv, .geld-review__thread') === null)) continue;
    if (node instanceof Element && node.hasAttribute('data-geld-ui')) continue;
    return true;
  }
  return false;
}

/**
 * A loaned node swapped in place by GitHub (a Turbo response to Resolve): the
 * element that took its position is the loan now (`adoptReplacement`). Only
 * a swap GitHub made counts: the panel's own moves take a loan out without
 * putting a stranger in its place.
 */
function adoptReplacements(records: readonly MutationRecord[]): void {
  for (const record of records) {
    if (record.type !== 'childList' || !(record.target instanceof Element) || record.target.closest('.geld-review__qv') === null) continue;
    const gone = [...record.removedNodes].find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-geld-teleported'));
    const came = [...record.addedNodes].find((node): node is HTMLElement => node instanceof HTMLElement && !node.hasAttribute('data-geld-teleported') && !node.hasAttribute('data-geld-ui'));
    if (gone !== undefined && came !== undefined) adoptReplacement(gone, came);
  }
}

function watchLoans(root: Element): void {
  if (loanWatched === root) return;
  loanWatcher?.disconnect();
  loanWatched = root;
  loanWatcher ??= new MutationObserver((records) => {
    adoptReplacements(records);
    if (!records.some(touchesThreadState)) return;
    // Only a thread that was open a moment ago can settle: opening an already-resolved thread also mutates its
    // loaned node (GitHub finishes rendering it), and that must not close the row the reader just opened.
    const key = visit.openSubKey?.startsWith('item:') === true ? visit.openSubKey : visit.openKey?.startsWith('item:') === true ? visit.openKey : null;
    const row = key === null ? null : document.querySelector(`.geld-review__row[data-geld-item="${CSS.escape(key.slice('item:'.length))}"]`);
    visit.settling = { itemKey: key, until: Date.now() + 15_000, wasOpen: row !== null && row.getAttribute('data-state') !== 'done' };
    reapplySoon();
  });
  loanWatcher.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-resolved', 'aria-pressed', 'aria-label', 'hidden'] });
}

function unwatchLoans(): void {
  loanWatcher?.disconnect();
  loanWatched = null;
}

/**
 * A Resolve was pressed through the panel: GitHub answers with a round trip
 * (classic) or an optimistic rewrite (React), in the timeline when the
 * thread is folded there, where no observer of the panel sees it. Re-read a
 * few times over the next seconds; each pass is cheap and settles once the
 * crawl sees the new state.
 */
function reapplyAfterResolve(itemKeyHint: string | null, resolving: boolean): void {
  visit.settling = { itemKey: itemKeyHint, until: Date.now() + 15_000, wasOpen: resolving };
  for (const delay of [300, 900, 2000, 4000]) {
    window.setTimeout(() => {
      if (lastSettings !== null && visit.settling !== null) applyReviewOverview(lastSettings);
    }, delay);
  }
}

/** After a thread changed state under the reader: close the item once it is done, and its round once nothing in it is open. */
function settleAfterResolve(meta: GeldPrMeta, batches: readonly Batch[]): void {
  const settling = visit.settling;
  if (settling === null) return;
  if (Date.now() > settling.until || settling.itemKey === null || !settling.wasOpen) {
    visit.settling = null;
    return;
  }
  const item = meta.items.find((entry) => itemKey(entry.id) === settling.itemKey);
  if (item === undefined || isOpenStatus(item.status)) return;
  visit.settling = null;
  const batch = batches.find((entry) => entry.items.includes(item));
  if (batch === undefined || batch.items.every((entry) => !isOpenStatus(entry.status))) {
    // The round is settled: it closes, and by type it joins the settled rounds.
    visit.openKey = null;
    visit.openSubKey = null;
  } else if (visit.openSubKey === settling.itemKey) {
    visit.openSubKey = null;
  } else if (visit.openKey === settling.itemKey) {
    visit.openKey = null;
  }
}

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
  // The merge box's check rows, as the Action would read them from the API: a bot whose run finished green and
  // that flagged nothing is clean, whatever its opening comment said.
  const bots = verdictsFrom(
    crawlCheckRuns(document, headSha),
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
          .filter((entry) => entry.comment.kind !== 'thread' && (entry.author.bot || isTrigger(entry, settings)))
          .map((entry) => entry.comment.anchor),
      ),
      events: crawled.events.map((event) => event.anchor),
    },
  };
}

function foldGroups(meta: GeldPrMeta, settings: GeldSettings, crawled: Crawled): readonly FoldGroup[] {
  if (settings.compactTimeline === 'off' || visit.fullTimeline) return [];
  // Triggers and bots' run-status lines fold without a row; the rest of the bot comments get their rounds.
  const triggerAnchors = new Set(crawled.comments.filter((entry) => (!entry.author.bot && isTrigger(entry, settings)) || isStatusLine(entry)).map((entry) => entry.comment.anchor));
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

/** Where the panel holds `anchor`: the row to open and, for a line inside a round, the line within it. */
interface AnchorSeat {
  readonly key: string;
  readonly sub: string | null;
}

/**
 * The panel row that holds `anchor`: an item's row, a round's (a bot's run
 * summary or a person's review is a line inside its round, and its fold group
 * went silent for that), a fold's, or null when it is not on the page.
 */
function seatFor(anchor: string, meta: GeldPrMeta, groups: readonly FoldGroup[], batches: readonly Batch[]): AnchorSeat | null {
  const item = meta.items.find((entry) => entry.sources.some((source) => source.anchor === anchor));
  if (item !== undefined) return { key: itemKey(item.id), sub: null };
  const batch = batches.find((entry) => [...entry.comments, ...entry.reviews].some((line) => line.anchor === anchor));
  if (batch !== undefined) return { key: batch.key, sub: anchor };
  const group = groupContaining(groups, anchor);
  return group === null || group.silent === true ? null : { key: foldKey(group.key), sub: null };
}

function rowKeyFor(anchor: string, meta: GeldPrMeta, groups: readonly FoldGroup[], batches: readonly Batch[]): string | null {
  return seatFor(anchor, meta, groups, batches)?.key ?? null;
}

/** The timeline rows of an item: each source thread's row (all its comments, reply box and Resolve), once. */
function itemNodes(item: ReviewItem): readonly HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const source of item.sources) {
    const thread = threadRootOf(source.anchor);
    const row = (thread === null ? null : closestAtHome(thread, '.js-timeline-item, .TimelineItem, [data-testid="timeline-row"]')) ?? thread;
    if (row instanceof HTMLElement && !roots.includes(row)) roots.push(row);
  }
  return roots;
}

/**
 * The thread containers of an item, one per source thread. GitHub groups a
 * review's threads on one file under one timeline row; each thread still
 * gets its own frame.
 */
function threadNodes(item: ReviewItem): readonly HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const source of item.sources) {
    const thread = threadRootOf(source.anchor);
    if (thread instanceof HTMLElement && !roots.some((root) => root === thread || root.contains(thread) || thread.contains(root))) roots.push(thread);
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
    avatars.push({ src, bot: source.bot !== undefined || /\[bot\]$/i.test(source.author), login: source.author });
    if (avatars.length === 2) break;
  }
  return avatars;
}

/** Items carry the path as the page wrote it (trimmed for long ones); made whole where the page lets us. */
function withWholePaths(meta: GeldPrMeta): GeldPrMeta {
  if (!meta.items.some((item) => item.path !== undefined && isTrimmedPath(item.path))) return meta;
  return {
    ...meta,
    items: meta.items.map((item) => {
      if (item.path === undefined || !isTrimmedPath(item.path)) return item;
      const anchor = item.sources[0]?.anchor;
      return { ...item, path: completePath(item.path, diffHashOf(anchor === undefined ? null : threadRootOf(anchor)), meta) };
    }),
  };
}

/**
 * Jev's decisions for the pass in progress (empty when Jev is off). With Jev
 * on, these stand in for the deterministic classification below: a comment is
 * a trigger when Jev says so (else when it matches a known trigger phrase), a
 * bot's run-status line folds silently, a finding is marked as one.
 */
let jevNow: JevDecisions = { lanes: new Map(), done: new Map(), previewStatus: new Map() };

function isTrigger(entry: CrawledComment, settings: GeldSettings): boolean {
  // A comment made only of known trigger phrases is one, whatever Jev says; Jev adds the ones the list does not know.
  return isTriggerComment(entry.comment.body, settings.reviewBots) || jevNow.lanes.get(entry.comment.anchor) === 'trigger';
}

/** Bot comments that say only that a run started or ended: nothing to read, so they fold without a row. */
function isStatusLine(entry: CrawledComment): boolean {
  return entry.author.bot && jevNow.lanes.get(entry.comment.anchor) === 'status';
}

function withManualDone(meta: GeldPrMeta): GeldPrMeta {
  if (visit.manualDone.size === 0) return meta;
  return { ...meta, items: meta.items.map((item) => (visit.manualDone.has(item.id) && isOpenStatus(item.status) ? { ...item, status: 'done-manual' } : item)) };
}

function foldRows(groups: readonly FoldGroup[]): readonly FoldRow[] {
  return groups.filter((group) => group.silent !== true).map((group) => {
    const firstAnchor = firstAnchorIn(group.nodes[0] ?? null);
    return {
      key: group.key,
      label: group.label,
      section: group.section ?? 'comments',
      count: group.nodes.length,
      avatarSrc: group.author === null ? null : avatarSrcOf(group.nodes[0] ?? null),
      author: group.author,
      firstAnchor,
      time: timeTextOf(group.nodes[0] ?? null, firstAnchor),
    };
  });
}

function firstAnchorIn(node: HTMLElement | null): string | null {
  if (node === null) return null;
  if (node.id !== '') return node.id;
  return node.querySelector('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [id^="event-"]')?.id ?? null;
}


function composeMeta(found: ReturnType<typeof findSummaryComment>, crawled: GeldPrMeta): { readonly meta: GeldPrMeta; readonly freshness: PanelModel['freshness'] } {
  if (found === null) return { meta: withAi(crawled), freshness: 'local' };
  const usable = usableMeta(found);
  // A digest the Action wrote with AI is the repository's; nothing this device wrote is layered over it.
  const layer = usable.producer.ai ? (meta: GeldPrMeta): GeldPrMeta => meta : withAi;
  if (found.freshness === 'fresh' && usable.truncated !== true) {
    return { meta: layer(usable), freshness: 'fresh' };
  }
  return { meta: layer(mergeWithCrawler(usable, crawled)), freshness: found.freshness };
}

/** The run store's key for a pull request: the page key, prefixed with the host off github.com. */
function aiRunKey(stateKey: string): string {
  return location.host === 'github.com' ? `github:${stateKey}` : `github@${location.host}:${stateKey}`;
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
/** The checks section's text with its loaned content included, so counts read the same open or closed. */
function checksSectionText(): string | null {
  const section = checksSection();
  if (section === null) return null;
  return [blockText(section), ...wornPiecesOf(section).map((piece) => blockText(piece))].join('\n');
}

/** The sidebar's Reviewers block (the Rails form, or the React pane's reviewers section), as text. */
function reviewersSidebarText(): string {
  const block = document.querySelector('form[id^="pull-request-reviewers-form"], [data-testid="sidebar-reviewers"], [data-testid="reviewers-section"]');
  return block instanceof HTMLElement ? blockText(block) : '';
}

function mergeBoxText(): string {
  const section = checksSection();
  // No recognisable container: the checks section's original parent is the merge box in every markup seen so far.
  const home = mergeBox() ?? mergeHomeEl;
  // Block boundaries as line breaks: textContent glues "…59 successful checks" to the next button's
  // "Collapse checks", and the word boundary the count parser needs is gone.
  const parts = [home === null ? '' : blockText(home)];
  if (section !== null && (home === null || !home.contains(section))) parts.push(blockText(section));
  return parts.join('\n');
}

/**
 * Toggle a row without moving it under the pointer: whatever opens or closes
 * above it (a long comment collapsing) is compensated with an instant scroll,
 * and a row that would end up under GitHub's sticky header is brought just
 * below it. The one scroll Geld makes on purpose.
 */
function keepInPlace(focusKey: string, change: () => void): void {
  const before = document.querySelector(`[data-geld-focus="${focusKey}"]`)?.getBoundingClientRect().top ?? null;
  change();
  const after = document.querySelector(`[data-geld-focus="${focusKey}"]`);
  if (!(after instanceof HTMLElement)) return;
  let top = after.getBoundingClientRect().top;
  if (before !== null && Math.abs(top - before) > 1) {
    window.scrollBy({ top: top - before, behavior: 'instant' });
    top = after.getBoundingClientRect().top;
  }
  const sticky = stickyHeaderBottomAt(window.scrollY);
  if (top < sticky) {
    scrollRowTo(top + window.scrollY);
    return;
  }
  revealOpened(after);
}

/**
 * After a toggle held its row still: when the row opened and what it opened
 * runs past the bottom of the viewport, scroll just far enough to show it,
 * and never so far that the row itself leaves the top. A row whose content
 * fits does not move at all, so opening and closing stays where the pointer
 * is; a row opened low on the page (one that another row's collapse left
 * there) comes up only by what is missing. The same rule native tree views
 * follow: reveal if needed, by the least amount.
 */
function revealOpened(control: HTMLElement): void {
  const row = control.closest<HTMLElement>('li');
  if (row === null) return;
  const open = control.getAttribute('aria-expanded') === 'true' || row.hasAttribute('data-open') || row.getAttribute('data-open') === 'true';
  if (!open) return;
  const slot = row.nextElementSibling instanceof HTMLElement && row.nextElementSibling.matches('.geld-review__slot') ? row.nextElementSibling : null;
  const rowTop = row.getBoundingClientRect().top;
  const blockBottom = (slot ?? row).getBoundingClientRect().bottom;
  const gap = 8;
  const overflow = blockBottom + gap - window.innerHeight;
  if (overflow <= 0) return;
  // How far up the row may go: to just under the header as it will stand after the scroll. The header's presence
  // depends on the destination, so the room is settled against the destination it allows.
  const roomAt = (delta: number): number => rowTop - stickyHeaderBottomAt(window.scrollY + delta) - gap;
  let delta = Math.min(overflow, roomAt(overflow));
  if (delta < overflow) delta = Math.min(overflow, roomAt(delta));
  if (delta > 0) window.scrollBy({ top: delta, behavior: 'instant' });
}

/**
 * Scroll so the row whose document top is `rowTop` sits just under GitHub's
 * sticky header, as it will be once the page is there. The header is not on
 * screen while the reader is near the top, so its height cannot be read from
 * the current state, and a scroll that puts the row at the viewport's top edge
 * ends with the header sliding over it. `stickyHeaderBottomAt` says what the
 * header will do at a destination, so the two candidate destinations - under
 * the header, or at the top with no header - are tried where they hold.
 */
function scrollRowTo(rowTop: number): void {
  const gap = 8;
  const withHeader = rowTop - stickyHeaderBottomAt(rowTop) - gap;
  if (stickyHeaderBottomAt(withHeader) > 0) {
    window.scrollTo({ top: withHeader, behavior: 'instant' });
    return;
  }
  const bare = rowTop - gap;
  // No header at either destination: the row goes to the top edge. The header would appear only at the bare
  // destination: stop short of it, where the row sits a header's height down and nothing covers it.
  window.scrollTo({ top: stickyHeaderBottomAt(bare) > 0 ? withHeader : bare, behavior: 'instant' });
}

/**
 * The bottom edge GitHub's sticky pull request header will have once the page
 * is scrolled to `scrollY`, or 0 when it will not be showing. The React header
 * (`use-sticky-header-module__stickyHeader`) is `display: none` until a 1px
 * sentinel (`StickyPullRequestHeader-module__stickyHeaderActivationThreshold`)
 * leaves the viewport above, then a fixed bar; its height is read with the
 * display forced for one synchronous layout, which never paints. The classic
 * header (`.gh-header-sticky`) sticks at its own document position and shows
 * its content with `is-stuck`, measured the same way.
 */
function stickyHeaderBottomAt(scrollY: number): number {
  const react = document.querySelector<HTMLElement>('[class*="use-sticky-header-module__stickyHeader"], [class*="stickyHeader"][class*="PageHeader"]');
  const sentinel = document.querySelector<HTMLElement>('[class*="stickyHeaderActivationThreshold"]');
  if (react !== null && sentinel !== null) {
    const activation = sentinel.getBoundingClientRect().bottom + window.scrollY;
    if (scrollY < activation) return 0;
    return measureHidden(react, () => react.offsetHeight, 'display', 'flex');
  }
  const classic = document.querySelector<HTMLElement>('.gh-header-sticky, .js-sticky');
  if (classic !== null) {
    const activation = classic.getBoundingClientRect().top + window.scrollY;
    if (scrollY < activation) return 0;
    if (classic.classList.contains('is-stuck')) return classic.offsetHeight;
    classic.classList.add('is-stuck');
    const height = classic.offsetHeight;
    classic.classList.remove('is-stuck');
    return height;
  }
  // No sticky header known: whatever is pinned at the top now.
  for (const header of document.querySelectorAll<HTMLElement>('[data-testid="sticky-header"], [class*="StickyHeader"]')) {
    const rect = header.getBoundingClientRect();
    const position = getComputedStyle(header).position;
    if ((position === 'sticky' || position === 'fixed') && rect.top <= 1 && rect.height > 0 && rect.height <= 160) return rect.bottom;
  }
  return 0;
}

/** Read a measurement of `element` with one inline style forced for the read; the style is restored in the same task, so nothing paints. */
function measureHidden(element: HTMLElement, read: () => number, property: 'display', value: string): number {
  if (element.offsetHeight > 0) return read();
  const previous = element.style.getPropertyValue(property);
  element.style.setProperty(property, value);
  const measured = read();
  if (previous === '') element.style.removeProperty(property);
  else element.style.setProperty(property, previous);
  return measured;
}

const MAX_EAGER_FRAGMENTS = 200;
const FRAGMENT_CONCURRENCY = 4;
const requestedFragments = new WeakSet<Element>();
/** Each URL once per visit: a fetched fragment can carry a fragment of its own. */
let requestedUrls = new Set<string>();
let fragmentsInFlight = 0;
let eagerFragments = 0;

/**
 * GitHub minimizes reviews it marked as resolved and leaves their contents —
 * the review's own threads included — behind a lazy `include-fragment` that
 * loads only when scrolled into view, which a folded row never is. Fetch them
 * the way the element would (a few at a time; asking the element itself to
 * go eager made it error out) and put the markup in its place, so the
 * crawler sees every thread.
 */
function loadMinimizedReviews(): void {
  const pending: { readonly fragment: Element; readonly src: string }[] = [];
  const timeline = document.querySelector('.js-discussion, .pull-discussion-timeline') ?? document;
  // Threads first (they are the items), then minimized reviews and comments.
  for (const thread of timeline.querySelectorAll('review-thread-collapsible[data-deferred-content-url], [data-deferred-content-url].js-resolvable-timeline-thread-container')) {
    const fragment = thread.querySelector('include-fragment');
    const src = thread.getAttribute('data-deferred-content-url');
    // A thread whose first comment shows still defers its replies behind the same fragment.
    if (fragment !== null && src !== null && fragment.getAttribute('src') === null && fragment.closest('.dropdown-menu, details-menu, action-menu, [popover]') === null) pending.push({ fragment, src });
  }
  for (const fragment of timeline.querySelectorAll('.minimized-comment include-fragment[src]')) {
    const src = fragment.getAttribute('src');
    if (src !== null) pending.push({ fragment, src });
  }
  for (const { fragment, src } of pending) {
    if (eagerFragments >= MAX_EAGER_FRAGMENTS || fragmentsInFlight >= FRAGMENT_CONCURRENCY) break;
    // Panel-made nodes never hold GitHub fragments; a thread on loan to the panel still does.
    if (requestedFragments.has(fragment) || requestedUrls.has(src) || (fragment.closest('.geld-review') !== null && fragment.closest('[data-geld-teleported]') === null)) continue;
    requestedFragments.add(fragment);
    requestedUrls.add(src);
    eagerFragments += 1;
    fragmentsInFlight += 1;
    void fetchFragment(fragment, src).finally(() => {
      fragmentsInFlight -= 1;
      reapplySoon();
    });
  }
}

async function fetchFragment(fragment: Element, src: string): Promise<void> {
  try {
    const response = await fetch(new URL(src, location.href), { headers: fragmentHeaders(), credentials: 'same-origin' });
    if (!response.ok) return;
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (!fragment.isConnected) return;
    fragment.replaceWith(...[...parsed.body.childNodes].map((node) => document.adoptNode(node)));
  } catch {
    // Left as GitHub's own lazy fragment; it still loads when the reader scrolls to it in the full timeline.
  }
}

let reapplyTimer: number | null = null;
/** Another pass shortly (fetched markup arrived), coalesced. */
function reapplySoon(): void {
  if (reapplyTimer !== null) return;
  reapplyTimer = window.setTimeout(() => {
    reapplyTimer = null;
    if (lastSettings !== null) applyReviewOverview(lastSettings);
  }, 150);
}

let lastSettings: GeldSettings | null = null;

/** Open the row `key` names; an item opens inside its round, `sub` names a line inside a round, and the section holding either unfolds. */
function openRow(key: string, batches: readonly Batch[], grouping: GeldSettings['reviewGrouping'], sub: string | null = null): void {
  if (key.startsWith('item:')) {
    // By push, an open thread has its own row under "Needs attention"; by type it lives inside its round.
    if (grouping === 'batch' && batches.some((entry) => entry.items.some((item) => itemKey(item.id) === key && isOpenStatus(item.status)))) {
      visit.openKey = key;
      visit.openSubKey = null;
      visit.collapsedGroups.delete('open');
      return;
    }
    const batch = batches.find((entry) => entry.items.some((item) => itemKey(item.id) === key));
    if (batch !== undefined) {
      visit.openKey = batch.key;
      visit.openSubKey = key;
      visit.collapsedGroups.delete(batch.items.some((item) => isOpenStatus(item.status)) ? 'open' : 'done');
      return;
    }
  }
  if (key.startsWith('fold:')) visit.collapsedGroups.delete('hidden');
  if (key.startsWith('batch:')) {
    const batch = batches.find((entry) => entry.key === key);
    if (batch !== undefined) {
      visit.collapsedGroups.delete(batch.items.some((item) => isOpenStatus(item.status)) ? 'open' : 'done');
      visit.collapsedGroups.delete('pushes');
    }
    visit.openSubKey = sub;
  }
  visit.openKey = key;
}

/**
 * After a click that opens a row elsewhere in the panel (a bot chip, a
 * source link), bring that row into view if it is not already there: the
 * reader asked to go somewhere, and nothing else tells them where it opened.
 * Instant, and only when needed; a row already on screen stays put.
 */
function revealRow(focusKey: string): void {
  const row = document.querySelector(`[data-geld-focus="${focusKey}"]`);
  if (!(row instanceof HTMLElement)) return;
  const rect = row.getBoundingClientRect();
  const sticky = stickyHeaderBottomAt(window.scrollY);
  if (rect.top >= sticky && rect.bottom <= window.innerHeight) return;
  scrollRowTo(rect.top + window.scrollY);
}

/**
 * Rounds by push. The timeline is walked in home order: a run of commit rows
 * with nothing between them opens a round (they are its pushes, merged), and
 * everything until the next commit — threads, bot run summaries, previews,
 * people's reviews — is what landed for that push. Content before any commit
 * is round 1 with no commits. With no commits on the page there is one round.
 */
function buildBatches(meta: GeldPrMeta, crawled: Crawled, settings: GeldSettings, commitRoots: readonly HTMLElement[], pushRoots: ReadonlySet<HTMLElement>, reviewEntriesAll: readonly ReviewEntry[], previewsAll: readonly Preview[]): readonly Batch[] {
  const triggerAnchors = new Set(crawled.comments.filter((entry) => (!entry.author.bot && isTrigger(entry, settings)) || isStatusLine(entry)).map((entry) => entry.comment.anchor));
  const botAnchors = new Set(meta.fold.comments.filter((anchor) => !triggerAnchors.has(anchor)));
  interface RoundComment {
    readonly anchor: string;
    readonly avatar: string | null;
    readonly author: string;
    readonly node: HTMLElement;
    readonly body: string;
    readonly lane: CommentLane | null;
  }
  interface Round {
    readonly commits: HTMLElement[];
    readonly items: ReviewItem[];
    readonly comments: RoundComment[];
    readonly reviews: ReviewEntry[];
  }
  type Entry = { readonly node: Element; readonly kind: 'commit' } | { readonly node: Element; readonly kind: 'item'; readonly item: ReviewItem } | { readonly node: Element; readonly kind: 'comment'; readonly comment: RoundComment } | { readonly node: Element; readonly kind: 'review'; readonly review: ReviewEntry };
  const entries: Entry[] = commitRoots.map((node) => ({ node, kind: 'commit' as const }));
  const unplaced: Entry[] = [];
  const place = (entry: Entry, node: Element | null): void => {
    if (node === null) unplaced.push(entry);
    else entries.push({ ...entry, node });
  };
  for (const item of meta.items) place({ node: document.documentElement, kind: 'item', item }, itemNodes(item)[0] ?? null);
  for (const entry of crawled.comments) {
    if (!botAnchors.has(entry.comment.anchor) || !entry.author.bot) continue;
    const comment: RoundComment = { anchor: entry.comment.anchor, avatar: entry.avatarSrc ?? avatarSrcForLogin(entry.author.login), author: entry.author.login, node: entry.root, body: entry.comment.body, lane: jevNow.lanes.get(entry.comment.anchor) ?? null };
    place({ node: entry.root, kind: 'comment', comment }, entry.root);
  }
  const itemAnchors = new Set(meta.items.flatMap((item) => item.sources.map((source) => source.anchor)));
  for (const review of reviewEntriesAll) {
    // Threads are items already; a person's verdict or top-level comment is the round's review. A pending request is nothing that landed.
    if (review.state === 'thread' || review.state === 'awaiting' || itemAnchors.has(review.anchor)) continue;
    place({ node: document.documentElement, kind: 'review', review }, entryNodes.get(review.anchor) ?? timelineRootOf(review.anchor));
  }
  entries.sort((a, b) => compareHome(a.node, b.node));
  const rounds: Round[] = [];
  let current: Round | null = null;
  const fresh = (): Round => ({ commits: [], items: [], comments: [], reviews: [] });
  const hasContent = (round: Round): boolean => round.items.length + round.comments.length + round.reviews.length > 0;
  for (const entry of entries) {
    if (entry.kind === 'commit') {
      // A commit after content closes that round and opens the next; consecutive commits share one round.
      if (current === null || hasContent(current)) {
        current = fresh();
        rounds.push(current);
      }
      if (entry.node instanceof HTMLElement) current.commits.push(entry.node);
      continue;
    }
    if (current === null) {
      current = fresh();
      rounds.push(current);
    }
    if (entry.kind === 'item') current.items.push(entry.item);
    else if (entry.kind === 'comment') current.comments.push(entry.comment);
    else current.reviews.push(entry.review);
  }
  // Whatever the page could not place (not loaded yet) goes with the latest round.
  if (unplaced.length > 0) {
    const last = rounds[rounds.length - 1] ?? fresh();
    if (rounds.length === 0) rounds.push(last);
    for (const entry of unplaced) {
      if (entry.kind === 'item') last.items.push(entry.item);
      else if (entry.kind === 'comment') last.comments.push(entry.comment);
      else if (entry.kind === 'review') last.reviews.push(entry.review);
    }
  }
  return rounds.map((round, position) => {
    const avatars: Avatar[] = [];
    const names: string[] = [];
    const seen = new Set<string>();
    // One avatar per account: the page serves the same picture at several sizes, so the login is the key.
    const addAvatar = (avatar: Avatar): void => {
      const key = avatar.login === '' ? avatar.src : avatar.login.toLowerCase();
      if (avatars.some((entry) => (entry.login === '' ? entry.src : entry.login.toLowerCase()) === key)) return;
      avatars.push(avatar);
    };
    const add = (login: string, src: string | null, bot: boolean): void => {
      const label = bot ? botTitleFor(login) : login;
      if (seen.has(label)) return;
      seen.add(label);
      names.push(label);
      if (src !== null) addAvatar({ src, bot, login });
    };
    for (const comment of round.comments) add(comment.author, comment.avatar, true);
    for (const item of round.items) {
      for (const avatar of avatarsFor(item)) addAvatar(avatar);
      for (const source of item.sources) add(source.author, avatarSrcForLogin(source.author), source.bot !== undefined || /\[bot\]$/i.test(source.author));
    }
    for (const review of round.reviews) add(review.author, review.avatarSrc ?? avatarSrcForLogin(review.author), false);
    const commentAnchors = new Set(round.comments.map((comment) => comment.anchor));
    const first = round.comments[0]?.anchor ?? round.items[0]?.sources[0]?.anchor ?? round.reviews[0]?.anchor ?? null;
    const firstNode = first === null ? null : document.getElementById(first);
    // CI is read from the last commit row; a force-push event carries none.
    const lastCommit = [...round.commits].reverse().find((row) => !pushRoots.has(row)) ?? null;
    return {
      key: batchKey(position + 1),
      index: position + 1,
      avatars,
      names,
      items: round.items,
      // Findings first: what the author must act on, before verdicts and reports.
      comments: [...round.comments]
        .sort((a, b) => Number(b.lane === 'finding') - Number(a.lane === 'finding'))
        .map((comment) => ({
          anchor: comment.anchor,
          author: comment.author,
          avatarSrc: comment.avatar,
          state: 'comment',
          preview: firstSentence(comment.body),
          time: timeTextOf(comment.node, comment.anchor),
          hasBody: true,
          done: false,
          replies: 0,
          myReaction: null,
          ...(comment.lane === null ? {} : { lane: comment.lane }),
        })),
      reviews: round.reviews,
      commits: round.commits,
      commitCount: round.commits.filter((row) => !pushRoots.has(row)).length,
      ciGlyph: lastCommit === null ? null : commitCiGlyph(lastCommit),
      committers: committersOf(round.commits),
      previews: previewsAll.filter((entry) => commentAnchors.has(entry.anchor)),
      time: timeTextOf(firstNode ?? round.comments[0]?.node ?? round.commits[round.commits.length - 1] ?? null, first),
      firstAnchor: first,
    };
  });
}

/**
 * Who committed, as GitHub draws them beside the commits: one avatar per
 * login, shaped as GitHub shapes it — `avatar-user` is a circle (a person,
 * or an agent committing as one, like @claude), anything else a square.
 */
function committersOf(commits: readonly HTMLElement[]): readonly Avatar[] {
  const out: Avatar[] = [];
  for (const row of commits) {
    for (const image of [row, ...wornPiecesOf(row)].flatMap((node) => [...node.querySelectorAll<HTMLImageElement>('img.avatar, img.avatar-user, img[class*="avatar"]')])) {
      const login = image.alt.replace(/^@/, '');
      const src = normalizeAvatarSrc(image.currentSrc || image.getAttribute('src') || '');
      if (src === '' || out.some((entry) => (login !== '' ? entry.login.toLowerCase() === login.toLowerCase() : entry.src === src))) continue;
      out.push({ src, login, bot: !image.classList.contains('avatar-user') && !(image.closest('a')?.classList.contains('avatar-user') ?? false) });
    }
  }
  return out;
}

/**
 * The CI state GitHub draws next to the *last* commit of a commit row: its
 * status control (classic: `.commit-build-statuses`, "N / M checks OK" behind
 * a coloured glyph; React: the checks link). A row holds a whole group of
 * commits ("X added 13 commits"), and the push's state is the latest one's -
 * the first control used to be read, so a group whose first commit passed
 * read as green whatever came after. Only GitHub's status controls are read;
 * a commit message that says "error" is not a failed check.
 */
function commitCiGlyph(row: HTMLElement): Batch['ciGlyph'] {
  const scope = [row, ...wornPiecesOf(row)];
  const controls = scope.flatMap((node) => [...node.querySelectorAll<HTMLElement>('.commit-build-statuses > summary, [class*="CommitStatus" i], a[href*="/checks"]:has(.octicon)')]);
  const control = controls[controls.length - 1];
  if (control === undefined) return null;
  return ciStateOf(control);
}

function ciStateOf(control: HTMLElement): Batch['ciGlyph'] {
  if (control.querySelector('.octicon-check, .octicon-check-circle-fill') !== null || control.classList.contains('color-fg-success')) return 'success';
  if (control.querySelector('.octicon-x, .octicon-x-circle-fill') !== null || control.classList.contains('color-fg-danger')) return 'failure';
  if (control.querySelector('.octicon-dot-fill, .octicon-dot, .octicon-in-progress') !== null || control.classList.contains('color-fg-attention')) return 'pending';
  return null;
}

function botTitleFor(login: string): string {
  return botTitle(resolveBotId(login) ?? `custom:${login}`, login);
}

/** The bot's verdict as a sentence for its card. */
function botCardLine(record: BotVerdictRecord): string {
  if (record.verdict === 'running') return 'Reviewing this pull request now';
  if (record.verdict === 'failed') return 'Its review of this pull request failed';
  if (record.verdict === 'clean') return 'Found nothing on this pull request';
  if (record.score !== undefined) return `Scored this pull request ${record.score}/5`;
  if (record.count !== undefined) return `Reported ${record.count} issue${record.count === 1 ? '' : 's'} on this pull request`;
  return 'Reported findings on this pull request';
}

/**
 * What a bot's hovercard would say if GitHub had one: its icon, name, login,
 * its verdict on this pull request when it gave one, and the App's page
 * (GitHub links a `<name>[bot]` login to `/apps/<name>`).
 */
function whoCardFor(login: string, meta: GeldPrMeta, model: PanelModel): WhoCard | null {
  const record = meta.bots.find((bot) => bot.login.toLowerCase() === login.toLowerCase()) ?? null;
  const slug = login.replace(/\[bot\]$/i, '');
  const detail = record === null ? 'GitHub App' : `${botCardLine(record)}${isCurrent(record, meta.headSha) ? '' : ' (an earlier commit)'}`;
  return {
    avatarSrc: (record === null ? null : model.botIconFor(record.id)) ?? avatarSrcForLogin(login),
    name: record === null ? botTitleFor(login) : botTitle(record.id, record.login),
    login,
    bot: true,
    detail,
    href: /\[bot\]$/i.test(login) ? `/apps/${slug}` : `/${login}`,
  };
}

/**
 * Whether a failing check in GitHub's list is one it marks "Required"; null
 * when the list is not rendered or marks nothing (this repository may simply
 * have no required checks, in which case every failure is red anyway).
 */
function requiredFailingIn(section: HTMLElement | null): boolean | null {
  if (section === null) return null;
  const scopes = [section, ...wornPiecesOf(section)];
  const rows = scopes.flatMap((scope) => [...scope.querySelectorAll<HTMLElement>('li, [role="listitem"]')]).filter((row) => row.querySelector('a[href*="check_run_id"], a[href*="/checks"], a[href*="statuses"]') !== null);
  const required = rows.filter((row) => /\bRequired\b/.test(row.textContent ?? ''));
  if (required.length === 0) return null;
  return required.some((row) => row.querySelector('.octicon-x-circle-fill, .octicon-x, .octicon-stop, .octicon-alert-fill, [class*="failure" i], [class*="Failure"]') !== null);
}

/**
 * Every preview the page's bot comments announce, in timeline order; the
 * Action's payload fills in comments the page has not loaded. The page wins
 * for a comment both know (hosts edit their comment in place; the page has
 * the current text).
 */
function previewsOn(crawled: Crawled, meta: GeldPrMeta): readonly Preview[] {
  const fromPage = crawled.comments.filter((entry) => entry.author.bot).flatMap((entry) => parsePreviews(entry.previewDoc));
  const seen = new Set(fromPage.map((entry) => entry.anchor));
  const fromPayload = (meta.previews ?? []).filter((entry) => !seen.has(entry.anchor));
  // Where the parser could not read a status, Jev's reading of the comment stands in (its word is final; it could say "unknown").
  const all = [...fromPage, ...fromPayload].map((entry) => {
    if (entry.status !== 'unknown') return entry;
    const decided = jevNow.previewStatus.get(previewDecisionKey(entry));
    return decided === undefined ? entry : { ...entry, status: decided };
  });
  const home = (anchor: string): Element | null => document.getElementById(anchor);
  return [...all].sort((a, b) => {
    const x = home(a.anchor);
    const y = home(b.anchor);
    if (x === null || y === null) return x === null ? (y === null ? 0 : -1) : 1;
    return compareHome(x, y);
  });
}

/** GitHub's checks-settings gear (and its tooltip) move from the check list into the CI row itself. */
function wearGear(root: HTMLElement): void {
  const target = root.querySelector<HTMLElement>(`[${ATTR_GEAR_SLOT}]`);
  const section = checksSection();
  if (target === null || section === null) return;
  // GitHub renders the list (and its gear) only once expanded; expand it once, folded or not.
  if (visit.checksExpanded === false) {
    section.querySelector<HTMLElement>('button[aria-label="Expand checks"], button[aria-expanded="false"][aria-label*="checks" i]')?.click();
    visit.checksExpanded = true;
  }
  const find = (scope: Element): HTMLElement | null => scope.querySelector<HTMLElement>('button[data-action="open_checks_settings"]');
  const fresh = find(section) ?? wornPiecesOf(section).map(find).find((gear) => gear !== null) ?? null;
  const worn = target.querySelector<HTMLElement>('button[data-action="open_checks_settings"]');
  // Regrouping re-creates the group header, gear included: the one we hold is React's discard. Let it go, take the new one.
  if (worn !== null && fresh !== null && fresh !== worn) {
    for (const stale of [...target.children]) if (stale instanceof HTMLElement) forgetLoan(stale);
    target.replaceChildren();
  } else if (worn !== null) {
    return;
  }
  if (fresh === null) return;
  const tooltip = fresh.nextElementSibling;
  const nodes = tooltip instanceof HTMLElement && tooltip.matches('[data-component="Tooltip"]') ? [fresh, tooltip] : [fresh];
  teleportInto(target, nodes);
}

/** What the crawl read of each top-level comment, for the pinned strip at the top of a thread's chat. */
interface SourceFacts {
  readonly preview: string;
  readonly avatarSrc: string | null;
  readonly login: string;
  readonly bot: boolean;
}

let sourceFacts = new Map<string, SourceFacts>();

/**
 * The comment a thread was posted from: the body of the review that holds
 * it ("Bugbot reviewed … found 3 issues"), else the bot's run summary for
 * this pull request. Pinned at the top of the thread's chat: the strip
 * names it and shows its first line, and unfolds it in place on request.
 */
function threadSourceOf(thread: HTMLElement, item: ReviewItem | undefined, meta: GeldPrMeta): ChatSource | null {
  const source = item?.sources[0];
  const bot = source?.bot;
  const who = bot !== undefined ? botTitle(bot, source?.author ?? '') : source?.author ?? 'the reviewer';
  const describe = (node: HTMLElement, anchor: string, label: string): ChatSource => {
    const facts = sourceFacts.get(anchor);
    return { node, anchor, label, preview: facts?.preview ?? '', avatarSrc: facts?.avatarSrc ?? avatarSrcOf(node), login: facts?.login ?? source?.author ?? '', bot: facts?.bot ?? bot !== undefined };
  };
  // GitHub repeats the review's id on nested wrappers (a minimized review, its permalink); climb to the outermost
  // copy at home and read the comment from the DOM there, not from a map keyed by that id.
  let review = closestAtHome(thread, '[id^="pullrequestreview-"]');
  while (review !== null && review.parentElement !== null) {
    const outer = closestAtHome(review.parentElement, '[id^="pullrequestreview-"]');
    if (outer === null || outer.id !== review.id) break;
    review = outer;
  }
  const reviewNode = review === null ? null : reviewCommentOf(review);
  if (review !== null && reviewNode !== null && !reviewNode.contains(thread)) return describe(reviewNode, review.id, `${who}'s review`);
  const summaryAnchor = bot === undefined ? null : (meta.bots.find((record) => record.id === bot)?.sourceId ?? null);
  const summaryEl = summaryAnchor === null ? null : document.getElementById(summaryAnchor);
  // A bot that writes no review body has a thread comment for its "summary"; that is a thread, not a source.
  if (summaryEl !== null && closestAtHome(summaryEl, THREAD_SELECTOR) !== null) return null;
  const summary = summaryAnchor === null ? null : (entryNodes.get(summaryAnchor) ?? summaryEl?.closest<HTMLElement>('.timeline-comment, .js-comment-container, [data-testid="comment-container"]') ?? null);
  if (summaryAnchor !== null && summary !== null && !summary.contains(thread)) return describe(summary, summaryAnchor, `${who}'s run summary`);
  return null;
}

/** Chat handlers shared by an item opened on its own and inside its round. */
function threadHandlers(item: ReviewItem | undefined, meta: GeldPrMeta, reapply: () => void): ChatHandlers {
  return {
    pathOf: (node) => threadPathOf(node, item, meta),
    onCopy: (text) => void copyText(text),
    sourceOf: (node) => threadSourceOf(node, item, meta),
    sourceOpen: (node) => visit.sourcesShown.has(threadAnchorOf(node)),
    onToggleSource: (node) => {
      const key = threadAnchorOf(node);
      keepInPlace(sourceFocusKey(node), () => {
        if (visit.sourcesShown.has(key)) visit.sourcesShown.delete(key);
        else visit.sourcesShown.add(key);
        reapply();
      });
    },
  };
}

/**
 * A thread's full file path, no line: the item's, else the file header's
 * `data-path`/`title` (its visible text is already ellipsized by GitHub).
 */
function threadPathOf(node: HTMLElement, item: ReviewItem | undefined, meta: GeldPrMeta): string {
  const hash = diffHashOf(node) ?? diffHashOf(closestAtHome(node, '.TimelineItem, .js-timeline-item'));
  if (item?.path !== undefined) return completePath(item.path, hash, meta);
  const header = node.querySelector('.file-header, [data-testid="file-header"]') ?? closestAtHome(node, '.TimelineItem, .js-timeline-item')?.querySelector('.file-header, [data-testid="file-header"]') ?? null;
  const fromAttributes = header?.getAttribute('data-path') ?? header?.querySelector('a[title]')?.getAttribute('title') ?? header?.querySelector('[title]')?.getAttribute('title') ?? null;
  if (fromAttributes !== null && fromAttributes.trim() !== '') return completePath(fromAttributes.trim(), hash, meta);
  return completePath((header?.textContent ?? '').replace(/\s+/g, ' ').trim(), hash, meta);
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

/** The time as GitHub shows it — `relative-time` renders "yesterday" in its shadow root; the light text is the fallback date. */
/**
 * GitHub's wording for each datetime, as it was last seen rendered. A
 * `relative-time` inside a closed minimized comment renders nothing; reading
 * '' there and 'last month' once the comment is opened changed the panel's
 * signature with every toggle, and an open comment line toggled with it.
 */
const shownTimes = new Map<string, string>();

/**
 * The time text last read for a node, by the id it carries (or contains).
 * A node on loan to the panel can have its header worn by a row and its
 * `relative-time` out of reach of any lookup from its home; the words it
 * showed before it moved are the words it still shows. Callers pass the
 * anchor they know: for one pass while a loan is on its way home the
 * comment is neither at home nor worn by anything, so the elements carrying
 * the id are out of reach too, and a lookup from the home node alone found
 * no key to remember the words under — the line's time blinked on close.
 */
const timeByAnchor = new Map<string, string>();

function anchorOf(node: Element): string | null {
  if (/^(issuecomment|pullrequestreview|discussion_r|event|commits-pushed)-/.test(node.id)) return node.id;
  const inner = node.querySelector('[id^="issuecomment-"], [id^="pullrequestreview-"], [id^="discussion_r"], [id^="event-"]');
  return inner === null ? null : inner.id;
}

function timeTextOf(node: Element | null, knownAnchor: string | null = null): string {
  if (node === null) return knownAnchor === null ? '' : (timeByAnchor.get(knownAnchor) ?? '');
  const anchor = knownAnchor ?? anchorOf(node);
  const read = timeTextRead(node);
  if (read !== '') {
    if (anchor !== null) timeByAnchor.set(anchor, read);
    return read;
  }
  return anchor === null ? '' : (timeByAnchor.get(anchor) ?? '');
}

/** GitHub's absolute renderings ("on Sep 20, 2026, 10:18 AM", commit rows): the panel speaks in relative time throughout. */
const ABSOLUTE_TIME = /^on\s|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/i;

function timeTextRead(node: Element): string {
  const el = findIn(node, 'relative-time, time-ago, time');
  if (el === null) return '';
  const datetime = el.getAttribute('datetime') ?? '';
  let shown = (el.shadowRoot?.textContent?.trim() ?? '') || (el.textContent ?? '').trim();
  if (shown !== '' && datetime !== '' && ABSOLUTE_TIME.test(shown)) shown = fallbackTime(datetime) || shown;
  if (shown !== '') {
    if (datetime !== '') shownTimes.set(datetime, shown);
    return shown;
  }
  if (datetime === '') return '';
  return shownTimes.get(datetime) ?? fallbackTime(datetime);
}

/** Close to GitHub's relative wording for a time it has not rendered yet. */
function fallbackTime(datetime: string): string {
  const then = Date.parse(datetime);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(then).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}

/** The comment's ⋯ menu, most specific first; the reaction trigger is a `details` too and must not be taken for it. */
const COMMENT_MENUS = [
  'details.js-comment-header-actions-menu',
  '.timeline-comment-actions details:not(.js-add-reaction):not(.js-reaction-popover-container)',
  '[data-testid="comment-header"] button[aria-label="Show options" i]',
  'button[aria-label="Comment actions" i]',
  'button[aria-label="Show options" i]',
];

function menuOf(container: Element): Element | null {
  for (const selector of COMMENT_MENUS) {
    const hit = findIn(container, selector);
    if (hit !== null && hit.closest('.js-add-reaction, .js-reaction-popover-container') === null) return hit;
  }
  return null;
}

/**
 * Every row wears its comment's own reaction trigger and ⋯ menu, open or
 * closed, so a reaction is one click without opening anything and the menu
 * is GitHub's (Copy link, Quote reply, Edit, Hide, Delete …). A classic
 * `details-menu` gets "Show in timeline" as its first item; Geld's own
 * controls step aside while GitHub's are present.
 */
function wearControls(root: HTMLElement, handlers: PanelHandlers): void {
  for (const slot of root.querySelectorAll<HTMLElement>(`[${ATTR_CTL_SLOT}]`)) {
    if (slot.childElementCount > 0) continue;
    const anchor = slot.getAttribute(ATTR_CTL_SLOT) ?? '';
    const node = entryNodes.get(anchor) ?? document.getElementById(anchor);
    if (node === null || node === undefined) continue;
    const container = node.matches(COMMENT_CONTAINER_SELECTOR) ? node : (node.querySelector(COMMENT_CONTAINER_SELECTOR) ?? node);
    const menuEl = menuOf(container);
    const menu = menuEl === null ? null : (menuEl.closest('details') ?? menuEl);
    if (!(menu instanceof HTMLElement) || menu.closest(THREAD_SELECTOR) !== null) continue;
    teleportInto(slot, [menu]);
    // A classic details-menu takes Geld's items in GitHub's own style; a React menu renders elsewhere on open, so
    // Geld's ⋯ stays beside it.
    const list = menu.querySelector('details-menu, .dropdown-menu, [role="menu"]');
    const merged = list instanceof HTMLElement;
    slot.closest('.geld-review__row')?.setAttribute('data-gh-controls', merged ? 'menu merged' : 'menu');
    if (merged && list.querySelector('[data-geld-injected]') === null) {
      const item = createElement('button', { type: 'button', role: 'menuitem', class: 'dropdown-item geld-review__gh-item', 'data-geld-injected': '' }, ['Show in timeline']);
      item.addEventListener('click', () => handlers.onShowInTimeline(anchor));
      const divider = createElement('div', { role: 'none', class: 'dropdown-divider geld-review__gh-divider', 'data-geld-injected': '' });
      list.prepend(item, divider);
      onRestore(() => {
        item.remove();
        divider.remove();
      });
    }
  }
}

const COMMENT_CONTAINER_SELECTOR = '.js-comment-container, .review-comment, .timeline-comment, .react-issue-comment, [data-testid="comment-container"], [data-testid="comment-viewer-outer-box"], [id^="issuecomment-"], [id^="discussion_r"]';

/** Per open Reviews entry, the node its quick view shows: a review's own comment rather than its whole timeline row. */
let entryNodes = new Map<string, HTMLElement>();

const REACTED_SELECTOR = '.social-reaction-summary-item.user-has-reacted, .comment-reactions button[aria-pressed="true"], [data-testid="reactions"] button[aria-pressed="true"], [class*="reactions" i] button[aria-pressed="true"]';

/** The signed-in user's own reaction on a comment, as GitHub shows it pressed. */
function myReactionOn(anchor: string): string | null {
  const node = document.getElementById(anchor);
  if (node === null) return null;
  const pressed = findIn(node, REACTED_SELECTOR);
  const text = (pressed?.textContent ?? '').trim();
  const emoji = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u.exec(text)?.[0];
  return emoji ?? null;
}

const ENTRY_STATE: Readonly<Record<CrawledReview['state'], ReviewEntryState>> = {
  approved: 'approved',
  changes_requested: 'changes_requested',
  commented: 'commented',
  dismissed: 'dismissed',
};

/**
 * The Reviews row's lines, in timeline order: review verdicts (with their
 * comment when they wrote one), review threads and people's top-level
 * comments — never bots or "@bot review" requests.
 */
function reviewEntries(crawled: Crawled, reviews: readonly CrawledReview[], meta: GeldPrMeta, settings: GeldSettings): readonly ReviewEntry[] {
  const list: ReviewEntry[] = [];
  const reviewedComments = new Set(reviews.flatMap((review) => (review.comment === null ? [] : [review.comment.id, ...[...review.comment.querySelectorAll('[id]')].map((node) => node.id)])).filter((id) => id !== ''));
  for (const review of reviews) {
    if (review.author.bot) continue;
    const body = review.comment === null ? '' : blockTextOf(review.comment);
    list.push({
      anchor: review.anchor,
      author: review.author.login,
      avatarSrc: review.avatarSrc,
      state: ENTRY_STATE[review.state],
      preview: body === '' ? '' : firstSentence(body),
      time: timeTextOf(review.root, review.anchor),
      hasBody: review.comment !== null,
      done: false,
      replies: 0,
      myReaction: null,
    });
  }
  const personReviews = new Set(list.map((entry) => entry.anchor));
  for (const entry of crawled.comments) {
    if (entry.author.bot || isTrigger(entry, settings)) continue;
    const anchor = entry.comment.anchor;
    // A review's own comment is the review's line, wherever quick view has put the comment right now.
    if (reviewedComments.has(anchor) || findIn(entry.root, '[id^="pullrequestreview-"]') !== null) continue;
    const node = document.getElementById(anchor);
    const thread = entry.comment.kind === 'thread';
    // A thread a person posted as part of a review is listed under that review; one inside a bot's review is the
    // bot's (a round lists it), and a review's own comment was skipped above.
    const parent = node === null ? undefined : reviewContainerOf(node)?.id;
    if (parent !== undefined && !(thread && personReviews.has(parent))) continue;
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === anchor));
    list.push({
      anchor,
      author: entry.author.login,
      avatarSrc: entry.avatarSrc,
      state: thread ? 'thread' : 'comment',
      preview: firstSentence(entry.comment.body),
      time: timeTextOf(node, anchor),
      hasBody: true,
      done: thread && (item !== undefined ? !isOpenStatus(item.status) : entry.comment.isResolved === true),
      replies: Math.max(0, (entry.comment.threadAnchors?.length ?? 1) - 1),
      myReaction: null,
      ...(parent === undefined ? {} : { parent }),
    });
  }
  const nodes = new Map(list.map((entry) => [entry.anchor, document.getElementById(entry.anchor)]));
  const before = (a: string, b: string): number => {
    const x = nodes.get(a) ?? null;
    const y = nodes.get(b) ?? null;
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return compareHome(x, y);
  };
  // Every thread posted with a review (a person's or a bot's), for the review's open body; the crawl knows each
  // thread's first comment, its state and its home, which names the review.
  const threadsByReview = new Map<string, ReviewThreadRef[]>();
  for (const entry of crawled.comments) {
    if (entry.comment.kind !== 'thread') continue;
    const node = document.getElementById(entry.comment.anchor);
    const review = node === null ? null : reviewContainerOf(node);
    if (review === null) continue;
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === entry.comment.anchor));
    const refs = threadsByReview.get(review.id) ?? [];
    refs.push({
      anchor: entry.comment.anchor,
      path: threadPathOf(entry.root, item, meta),
      preview: firstSentence(entry.comment.body),
      done: item !== undefined ? !isOpenStatus(item.status) : entry.comment.isResolved === true,
    });
    threadsByReview.set(review.id, refs);
  }
  return list
    .map((entry) => {
      const threads = threadsByReview.get(entry.anchor);
      return { ...entry, myReaction: entry.hasBody ? myReactionOn(entry.anchor) : null, ...(threads === undefined ? {} : { threads }) };
    })
    .sort((a, b) => before(a.anchor, b.anchor));
}

/** The review timeline item (`pullrequestreview-N`, nothing longer) holding `node`, across a loan to the panel. */
function reviewContainerOf(node: Element): HTMLElement | null {
  let cursor: Element | null = node;
  while (cursor !== null) {
    const hit = closestAtHome(cursor, '[id^="pullrequestreview-"]');
    if (hit === null || /^pullrequestreview-\d+$/.test(hit.id)) return hit;
    cursor = hit.parentElement;
  }
  return null;
}

function blockTextOf(node: HTMLElement): string {
  const body = node.querySelector(HOVER_BODY_SELECTOR);
  return body === null ? '' : blockText(body).trim();
}

const HOVER_BODY_SELECTOR = '.js-comment-body, .comment-body:not(.js-preview-body), [data-testid="markdown-body"], [data-testid="comment-body"], .markdown-body:not(.js-preview-body)';

/** What the hover card shows for a collapsed row: its first comment, clamped, plus a way to reply. */
function hoverPreviewFor(row: HTMLElement, meta: GeldPrMeta, groups: readonly FoldGroup[], handlers: PanelHandlers): HoverPreview | null {
  const itemId = row.getAttribute('data-geld-item');
  const foldId = row.getAttribute('data-geld-fold');
  const subAnchor = row.getAttribute('data-geld-sub');
  let anchor: string | null = null;
  let more = 0;
  let onReply: (() => void) | null = null;
  let onOpen: (() => void) | null = null;
  if (subAnchor !== null) {
    // A comment line: a bot's run summary, a person's review or remark. Its card opens the line; a bare verdict
    // (nothing to open, the state name is the row's text) has no card.
    if (subAnchor.startsWith('awaiting:') || row.querySelector('[aria-expanded]') === null) return null;
    anchor = subAnchor;
    onOpen = () => handlers.onToggleSub(subAnchor);
  } else if (itemId !== null) {
    const item = meta.items.find((entry) => entry.id === itemId);
    if (item === undefined) return null;
    anchor = item.sources[0]?.anchor ?? null;
    more = item.sources.length - 1;
    onReply = () => handlers.onReply(item.id);
    const first = anchor;
    onOpen = () => (first === null ? undefined : handlers.onOpenAnchor(first));
  } else if (foldId !== null) {
    const group = groups.find((entry) => entry.key === foldId);
    const first = group?.nodes[0] ?? null;
    if (first === null) return null;
    anchor = first.id !== '' ? first.id : first.querySelector('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [id^="event-"]')?.id ?? null;
    more = (group?.nodes.length ?? 1) - 1;
    onOpen = () => handlers.onToggle(foldKey(foldId));
  }
  if (anchor === null || onOpen === null) return null;
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
    time: timeTextOf(node, anchor),
    body: preview instanceof HTMLElement ? preview : null,
    more,
    onReply,
    onOpen,
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
  // The Reviews and Previews rows render their own lists; the panel itself stands in for "something to show".
  if (key === REVIEWS_KEY || key === PREVIEWS_KEY || key.startsWith('batch:')) return [document.documentElement];
  if (key === CHECKS_KEY) {
    const section = checksSection();
    if (section === null) return [];
    // The React merge box: GitHub renders the check list only once expanded, and its
    // section header repeats what the row says, so the expandable content is shown alone.
    const content = section.querySelector<HTMLElement>('[class*="MergeBoxExpandable-module__expandableWrapper"]');
    return [content ?? section];
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

/** Every path in the PR's diff, when the controller has it; with the page's own untrimmed paths, the pool `wholePath` guesses from. */
let diffPaths: readonly string[] | null = null;

/** Paths known whole: the diff's, and every untrimmed one the page shows (other threads' headers, items). */
function knownPaths(meta: GeldPrMeta): readonly string[] {
  const known = new Set<string>(diffPaths ?? []);
  for (const item of meta.items) if (item.path !== undefined && !isTrimmedPath(item.path)) known.add(item.path);
  for (const link of document.querySelectorAll('.file-header a, a.text-mono.Link--primary')) {
    const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '' && text.includes('/') && !text.includes(' ') && !isTrimmedPath(text)) known.add(text);
  }
  return [...known];
}

/** A trimmed path made whole when it can be (see whole-path.ts), else as it was. */
function completePath(path: string, hash: string | null, meta: GeldPrMeta): string {
  if (!isTrimmedPath(path)) return path;
  return wholePath(path, hash, knownPaths(meta), reapplySoon);
}

/**
 * A slot is rendered when it is new, and again when a quick view inside it
 * has lost its node: React swaps GitHub's own sections (the checks list on
 * every status poll), and the page-world portal then takes the loaned node
 * out of the slot along with its placeholder. A slot carried across a panel
 * rebuild would otherwise stay empty until something else changed.
 */
function slotNeedsRender(slot: HTMLElement): boolean {
  if (slot.childElementCount === 0) return true;
  return [...slot.querySelectorAll<HTMLElement>('.geld-review__qv')].some((view) => view.childElementCount === 0);
}

export function applyReviewOverview(settings: GeldSettings, paths?: readonly string[] | null): void {
  if (paths !== undefined) diffPaths = paths;
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
    visit.loadMoreTries = 0;
    visit.pendingAnchor = sourceAnchorFromHash(location.hash);
    visit.openSubKey = null;
    visit.sourcesShown = new Set<string>();
    visit.archivedPreviewsOpen = false;
    visit.openCommits = new Set<string>();
    visit.knownRequired = null;
    resetRefs();
    resetWholePaths();
    timeByAnchor.clear();
    visit.lastReviews = null;
    visit.checksExpanded = false;
    visit.autoLoads = 0;
    eagerFragments = 0;
    requestedUrls = new Set();
    visit.manualDone = new Set();
    checksSectionEl = null;
    mergeHomeEl = null;
    // This device's AI run for the pull request, if any; the pass re-applies once it is read.
    loadAiForPage(aiRunKey(page.stateKey), reapplySoon);
  }
  lastSettings = settings;
  const crawledDom = crawlConversation();
  const rawComments: readonly RawComment[] = crawledDom.comments.map((entry) => entry.comment);
  sourceFacts = new Map(crawledDom.comments.filter((entry) => entry.comment.kind !== 'thread').map((entry) => [entry.comment.anchor, { preview: firstSentence(entry.comment.body), avatarSrc: entry.avatarSrc, login: entry.author.login, bot: entry.author.bot }]));
  const found = findSummaryComment(document);
  hideSummary(found?.root ?? null);
  const headSha = detectHeadSha() ?? found?.meta.headSha ?? ZERO_SHA;
  // Jev first, from its cache: what it has said about the top-level comments decides what is a trigger below.
  const topLevel: CommentToClassify[] = crawledDom.comments.filter((entry) => entry.comment.kind !== 'thread').map((entry) => ({ anchor: entry.comment.anchor, author: entry.author.login, bot: entry.author.bot, body: entry.comment.body }));
  jevNow = jevDecisionsFor(settings, topLevel, [], reapplySoon);
  const crawled = buildFromComments(crawledDom, settings, headSha, visit.generatedAt);
  const composed = composeMeta(found, crawled);
  // Then the threads, now that items exist: whether the replies say a thread is done.
  const bodies = new Map(crawledDom.comments.map((entry) => [entry.comment.anchor, { author: entry.author.login, body: entry.comment.body }] as const));
  const threads: ThreadToClassify[] = composed.meta.items
    .filter((item) => isOpenStatus(item.status) && item.sources.length > 1)
    .map((item) => ({ itemId: item.id, ...(item.path === undefined ? {} : { path: item.path }), comments: item.sources.map((source) => bodies.get(source.anchor) ?? { author: source.author, body: '' }) }));
  // Previews whose status the parser left unknown are asked about with the same request.
  const docText = new Map(crawledDom.comments.map((entry) => [entry.comment.anchor, entry.previewDoc.text] as const));
  const unknownPreviews: PreviewToClassify[] = crawledDom.comments
    .filter((entry) => entry.author.bot)
    .flatMap((entry) => parsePreviews(entry.previewDoc))
    .filter((entry) => entry.status === 'unknown')
    .map((entry) => ({ preview: entry, text: docText.get(entry.anchor) ?? '' }));
  jevNow = jevDecisionsFor(settings, topLevel, threads, reapplySoon, unknownPreviews);
  const meta = withWholePaths(withManualDone(withJevDone(composed.meta, jevNow.done)));

  const viewingAnchor = sourceAnchorFromHash(location.hash);
  if (viewingAnchor !== null && document.getElementById(viewingAnchor) === null && visit.loadMoreTries < MAX_LOAD_MORE) {
    if (clickLoadMore()) visit.loadMoreTries += 1;
  }
  const groups = [...foldGroups(meta, settings, crawledDom)];
  const compacting = settings.compactTimeline !== 'off';
  const hidingTimeline = compacting && !visit.fullTimeline;
  // Compact mode folds everything, so everything must be on the page: keep pressing GitHub's "Load more", and
  // fetch the reviews GitHub minimized ("marked as resolved") — their threads are behind lazy fragments that
  // would only load when scrolled into view, which a folded row never is.
  if (hidingTimeline && visit.autoLoads < MAX_AUTO_LOADS && clickLoadMore()) visit.autoLoads += 1;
  if (hidingTimeline) loadMinimizedReviews();
  // In compact mode the review threads live in their rows and GitHub's checks section in the CI row:
  // both fold out of the page, so nothing below is left to reveal or scroll to.
  const reviews = crawlReviews();
  entryNodes = new Map(reviews.filter((review) => review.comment !== null).map((review) => [review.anchor, review.comment ?? review.root]));
  const awaiting = awaitingReviewers();
  const comments = pinOpenEntry([...awaiting, ...reviewEntries(crawledDom, reviews, meta, settings)]);
  const allPreviews = previewsOn(crawledDom, meta);
  const foldTargets: FoldGroup[] = [...groups];
  if (hidingTimeline) {
    for (const item of meta.items) foldTargets.push({ key: itemKey(item.id), label: item.title, author: null, nodes: itemNodes(item) });
    const checksNode = checksSection();
    if (checksNode !== null) foldTargets.push({ key: CHECKS_KEY, label: 'CI checks', author: null, nodes: [checksNode] });
    // Review verdicts ("X approved these changes") live under the Reviews row.
    const reviewRoots = unique(reviews.filter((review) => !review.author.bot).map((review) => review.root).filter((root) => !meta.items.some((item) => itemNodes(item).includes(root))));
    if (reviewRoots.length > 0) foldTargets.push({ key: REVIEWS_KEY, label: 'Reviews', author: null, nodes: reviewRoots });
    // People's top-level comments are listed under Reviews; the summary comment is the panel's own source.
    const commentRoots = comments.filter((entry) => entry.state === 'comment').map((entry) => timelineRootOf(entry.anchor)).filter((root): root is HTMLElement => root !== null);
    if (commentRoots.length > 0) foldTargets.push({ key: `${REVIEWS_KEY}:comments`, label: 'Comments', author: null, nodes: unique(commentRoots), silent: true });
    const summaryRoot = found?.root ?? null;
    if (summaryRoot !== null) foldTargets.push({ key: 'summary', label: '', author: null, nodes: [timelineRootOf(summaryRoot.id) ?? summaryRoot], silent: true });
  }
  // Whatever is left in the timeline — commits, mentions, bots' bare "reviewed" lines — folds too, so nothing
  // stands under the panel but the merge box; commits and mentions get rows in the activity section.
  const claimed = new Set<HTMLElement>(foldTargets.flatMap((group) => [...group.nodes]));
  const leftoverList = crawlLeftovers(claimed);
  if (hidingTimeline) {
    const leftovers = groupLeftovers(leftoverList);
    groups.push(...leftovers);
    foldTargets.push(...leftovers);
  }
  // Rounds: what landed between two pushes. A push is a run of commit rows or a force-push event (after a force-push
  // GitHub lists no commits, only "force-pushed from a to b"). Bot run summaries belong to their round rather than to rows of their own.
  const pushRoots = new Set(leftoverList.filter((entry) => entry.kind === 'push').map((entry) => entry.root));
  const commitRoots = leftoverList.filter((entry) => entry.kind === 'commit' || entry.kind === 'push').map((entry) => entry.root);
  const batches = buildBatches(meta, crawledDom, settings, commitRoots, pushRoots, comments, allPreviews).map((batch) => {
    const pinnedComments = pinOpenEntry(batch.comments);
    return pinnedComments === batch.comments ? batch : { ...batch, comments: pinnedComments };
  });
  settleAfterResolve(meta, batches);
  const batchedAnchors = new Set(batches.flatMap((batch) => batch.comments.map((entry) => entry.anchor)));
  // By node, not by looking the anchor up: GitHub repeats an id (a review inside its minimized wrapper), and
  // getElementById would answer with whichever copy comes first in the document.
  const batchedRoots = new Set(crawledDom.comments.filter((entry) => batchedAnchors.has(entry.comment.anchor)).map((entry) => entry.root));
  for (const [index, group] of groups.entries()) {
    if (!group.key.startsWith('bot:')) continue;
    if (!group.nodes.every((node) => batchedRoots.has(node) || [...batchedAnchors].some((anchor) => node.id === anchor || node.querySelector(`#${CSS.escape(anchor)}`) !== null))) continue;
    const silent = { ...group, silent: true };
    groups[index] = silent;
    const target = foldTargets.indexOf(group);
    if (target >= 0) foldTargets[target] = silent;
  }
  // A permalink (or a find-in-page hit) opens its row here rather than revealing the original down the page.
  if (visit.pendingAnchor !== null && hidingTimeline) {
    const seat = seatFor(visit.pendingAnchor, meta, groups, batches);
    if (seat !== null) openRow(seat.key, batches, settings.reviewGrouping, seat.sub);
  }
  const fixFor = (item: ReviewItem): SuggestedFix | null => (fixVisible(item.fix, settings.suggestedFixes) ? item.fix : null);
  // An item lives inside its round's row: opening it opens the round and the item within.
  const openRowLocal = (key: string, sub: string | null = null): void => openRow(key, batches, settings.reviewGrouping, sub);
  const subject = subjectOf();
  const boxText = mergeBoxText();
  const ringSource = checksSection()?.querySelector('svg[viewBox="0 0 100 100"]') ?? null;
  const checksRing = ringSource instanceof SVGElement ? cloneRing(ringSource) : null;
  // The merge box states the requirement only while unmet; the sidebar's Reviewers block ("At least 1 approving
  // review is required to merge this pull request") keeps stating it while the PR is open. A merged or closed PR
  // states it nowhere, so the row there says "N approved" rather than a fraction.
  const stated = /at least\s+(\d+)\s+approving review/i.exec(`${boxText}\n${reviewersSidebarText()}`)?.[1];
  if (stated !== undefined) visit.knownRequired = Number.parseInt(stated, 10);
  // A re-requested reviewer is awaited again: GitHub sets their earlier verdict aside (the merge box stops saying
  // "changes requested"), and so does the row, for the tint and the count alike.
  const awaited = new Set(awaiting.map((entry) => entry.author.toLowerCase()));
  const reviewers = latestReviewers(reviews).filter((entry) => !awaited.has(entry.login.toLowerCase()));
  for (const record of meta.reviewers) if (!awaited.has(record.login.toLowerCase()) && !reviewers.some((entry) => entry.login === record.login)) reviewers.push(record);
  const requestable = installedBots(meta, document, rawComments);
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
    batches,
    requestable,
    summaryAnchorFor: (botId) => meta.bots.find((bot) => bot.id === botId)?.sourceId ?? null,
    botIconFor: (botId) => iconByBot.get(botId) ?? avatarSrcFor(meta.bots.find((bot) => bot.id === botId)?.sourceId ?? ''),
    checks: checkCountsFrom(checksSectionText() ?? boxText),
    requiredFailing: requiredFailingIn(checksSection()),
    previews: latestPreviews(allPreviews),
    grouping: settings.reviewGrouping,
    openCommits: visit.openCommits,
    ai: aiStateFor(meta, rawComments, settings),
    archivedPreviewsOpen: visit.archivedPreviewsOpen,
    avatarForAnchor: (anchor) => crawledDom.comments.find((entry) => entry.comment.anchor === anchor)?.avatarSrc ?? avatarSrcFor(anchor),
    checksRing,
    comments,
    openSubKey: visit.openSubKey,
    openSources: visit.sourcesShown,
    refsVersion: refsVersion(),
    running: meta.bots.some((bot) => bot.verdict === 'running'),
    reviews: (visit.lastReviews = requiredReviewsFrom(boxText, reviewers, { knownRequired: visit.knownRequired }) ?? visit.lastReviews),
    myReactionFor: (anchor) => myReactionOn(anchor),
    timeFor: (anchor) => timeTextOf(document.getElementById(anchor), anchor),
    avatarsFor,
    resolvable: itemResolvable,
    hiddenCount: groups.filter((group) => group.silent !== true).reduce((sum, group) => sum + group.nodes.length, 0),
    aiPending: aiPending(),
    fixFor,
  };
  const reapply = (): void => applyReviewOverview(settings);
  const panelHandlers: PanelHandlers = {
    onToggle: (key) => {
      keepInPlace(`main:${key}`, () => {
        visit.openKey = visit.openKey === key ? null : key;
        reapply();
      });
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
      if (thread !== undefined && clickResolve(thread.anchor)) {
        reapplyAfterResolve(itemKey(item.id), done);
        return;
      }
      if (found !== null && tickSummaryCheckbox(found.root, item.sources.map((source) => source.anchor), done)) return;
      if (done) visit.manualDone.add(id);
      else visit.manualDone.delete(id);
      reapply();
    },
    onReply: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      const anchor = item === undefined ? null : firstThreadAnchor(item);
      if (anchor === null) return;
      openRowLocal(itemKey(id));
      reapply();
      focusReply(anchor);
    },
    onQuoteReply: (id) => {
      const item = meta.items.find((entry) => entry.id === id);
      const anchor = item === undefined ? null : firstThreadAnchor(item);
      if (anchor === null) return;
      openRowLocal(itemKey(id));
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
      keepInPlace(`main:sub:${anchor}`, () => {
        visit.openSubKey = visit.openSubKey === anchor ? null : anchor;
        reapply();
      });
    },
    onGrouping: (grouping) => {
      // Persisted like any setting; the controller's settings watch re-applies with the new value, in place.
      persist(settingsItem.patch({ reviewGrouping: grouping }));
    },
    onToggleCommits: (batchKey) => {
      keepInPlace(`commits:${batchKey}`, () => {
        if (visit.openCommits.has(batchKey)) visit.openCommits.delete(batchKey);
        else visit.openCommits.add(batchKey);
        reapply();
      });
    },
    onToggleArchivedPreviews: () => {
      keepInPlace('notes:previews', () => {
        visit.archivedPreviewsOpen = !visit.archivedPreviewsOpen;
        reapply();
      });
    },
    onResolveAnchor: (anchor, done) => {
      if (!clickResolve(anchor)) return;
      const owner = meta.items.find((item) => item.sources.some((source) => source.anchor === anchor));
      reapplyAfterResolve(owner === undefined ? null : itemKey(owner.id), done);
    },
    onRunAi: () => {
      void runAi(meta, rawComments, settings, reapply).then((run) => {
        if (run.changed) reapply();
      });
    },
    onClearAi: () => {
      void clearAiForPage().then(reapply);
    },
    onReact: (anchor) => {
      // Open whatever row holds the comment, then GitHub's own picker inside it.
      const sub = comments.find((entry) => entry.anchor === anchor && entry.hasBody);
      const seat = seatFor(anchor, meta, groups, batches);
      if (sub !== undefined && (visit.openKey === REVIEWS_KEY || seat === null)) {
        visit.openKey = REVIEWS_KEY;
        visit.openSubKey = anchor;
      } else {
        if (seat === null) return;
        openRowLocal(seat.key, seat.sub);
      }
      reapply();
      openReactions(anchor);
    },
    onShowInTimeline: (anchor) => {
      visit.fullTimeline = true;
      visit.openKey = null;
      reapply();
      // The browser's own fragment jump; with the timeline shown there is nothing folded to bounce off.
      location.hash = anchor;
    },
    onOpenAnchor: (anchor) => {
      // Held by a row here? Open it and bring it into view. Otherwise let the browser take the reader to it in the timeline.
      const seat = hidingTimeline ? seatFor(anchor, meta, groups, batches) : null;
      if (seat === null) {
        location.hash = anchor;
        return;
      }
      openRowLocal(seat.key, seat.sub);
      reapply();
      revealRow(`main:${seat.sub === null ? (visit.openSubKey ?? visit.openKey) : `sub:${seat.sub}`}`);
    },
  };
  const mounted = mountPanel(model, panelHandlers);
  if (mounted !== null) watchLoans(mounted.root);
  else unwatchLoans();

  if (mounted?.slot !== null && mounted?.slot !== undefined && visit.openKey !== null) {
    const nodes = quickViewFor(visit.openKey, meta, groups);
    if (nodes.length === 0) {
      visit.openKey = null;
      restoreAll();
    } else if (slotNeedsRender(mounted.slot)) {
      if (visit.openKey === REVIEWS_KEY) {
        const nested = renderCommentsList(mounted.slot, model, panelHandlers);
        const openEntry = model.comments.find((entry) => entry.anchor === visit.openSubKey) ?? null;
        const verdict = openEntry !== null && isVerdict(openEntry) ? openEntry : null;
        // A person's review thread opens in the same frame as a bot's (path head, the first comment, the rest and
        // the reply behind a bar), never as the raw timeline row, which for a review is the whole review with every
        // thread it holds.
        const thread = openEntry?.state === 'thread' ? threadRootOf(openEntry.anchor) : null;
        // A verdict's body is its own comment (never its whole row) plus its threads, or a note that it has neither.
        const subNode = visit.openSubKey === null ? null : (entryNodes.get(visit.openSubKey) ?? (verdict === null && thread === null ? timelineRootOf(visit.openSubKey) : null));
        if (nested !== null && verdict !== null) {
          renderReviewBody(nested, verdict, subNode, panelHandlers);
        } else if (nested !== null && thread !== null) {
          const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === openEntry?.anchor));
          renderChatView(nested, [thread], threadHandlers(item, meta, reapply));
        } else if (nested !== null && subNode !== null) {
          renderCommentChat(nested, subNode);
        } else if (visit.openSubKey !== null && subNode === null) {
          visit.openSubKey = null;
        }
      } else if (visit.openKey.startsWith('batch:')) {
        const batch = batches.find((entry) => entry.key === visit.openKey);
        if (batch !== undefined) {
          const view = renderBatchView(mounted.slot, batch, model, panelHandlers);
          // By push: the round's commit rows, unfolded under their heading (they keep the commit-hover breakdown).
          if (view.commitsSlot !== null) renderQuickView(view.commitsSlot, batch.commits);
          // A review's own comment, not its whole row ("X reviewed · View reviewed changes" says nothing here).
          const openEntry = view.openComment === null ? null : (batch.reviews.find((entry) => entry.anchor === view.openComment) ?? null);
          const verdict = openEntry !== null && isVerdict(openEntry) ? openEntry : null;
          const thread = openEntry?.state === 'thread' ? threadRootOf(openEntry.anchor) : null;
          const commentNode = view.openComment === null ? null : (entryNodes.get(view.openComment) ?? (verdict === null && thread === null ? timelineRootOf(view.openComment) : null));
          if (view.nested !== null && verdict !== null) {
            renderReviewBody(view.nested, verdict, commentNode, panelHandlers);
          } else if (view.nested !== null && thread !== null) {
            const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === openEntry?.anchor));
            renderChatView(view.nested, [thread], threadHandlers(item, meta, reapply));
          } else if (view.nested !== null && commentNode !== null) {
            renderCommentChat(view.nested, commentNode);
          } else if (view.nested !== null && view.openItem !== null) {
            const item = view.openItem;
            renderChatView(view.nested, threadNodes(item), threadHandlers(item, meta, reapply));
          } else if (visit.openSubKey !== null && view.openItem === null && commentNode === null) {
            visit.openSubKey = null;
          }
        }
      } else if (visit.openKey === CHECKS_KEY) {
        renderQuickView(mounted.slot, nodes);
      } else if (visit.openKey === foldKey('mentions')) {
        renderMentionsView(mounted.slot, nodes, outgoingMentions(document.querySelector('[data-geld-attached] .comment-body, [data-geld-attached] .markdown-body, [data-geld-attached] [data-testid="markdown-body"]')), (href) => refDetails(href, reapplySoon));
      } else if (visit.openKey.startsWith('item:')) {
        // Each review thread in its own frame: path with a copy button, the first comment, and a bar that
        // reveals the rest of the thread and the reply box.
        const item = meta.items.find((entry) => itemKey(entry.id) === visit.openKey);
        renderChatView(mounted.slot, item === undefined ? nodes : threadNodes(item), threadHandlers(item, meta, reapply));
      } else {
        renderQuickView(mounted.slot, nodes);
      }
    }
  } else {
    restoreAll();
  }
  if (mounted !== null) {
    wearControls(mounted.root, panelHandlers);
    wearGear(mounted.root);
    // Spinners rendered into the slot after the mount (preview lines, a round's CI glyph) join the same phase.
    syncSpinners(mounted.root);
  }
  setHoverProvider((row) => hoverPreviewFor(row, meta, groups, panelHandlers));
  setWhoProvider((login) => whoCardFor(login, meta, model));
  applyFolds(foldTargets, new Set());
  // The browser's fragment jump went to the original's (now empty) place in
  // the timeline; the one correction Geld makes is to land on the row that
  // holds it, once, instantly.
  const pendingKey = visit.pendingAnchor === null ? null : rowKeyFor(visit.pendingAnchor, meta, groups, batches);
  if (visit.pendingAnchor !== null && mounted !== null && ((pendingKey !== null && (visit.openKey === pendingKey || visit.openSubKey === pendingKey)) || visit.loadMoreTries >= MAX_LOAD_MORE)) {
    const subFocus = visit.openSubKey === null ? null : visit.openSubKey.startsWith('item:') ? visit.openSubKey : `sub:${visit.openSubKey}`;
    const row = visit.openKey === null ? null : mounted.root.querySelector(`[data-geld-focus="main:${subFocus ?? visit.openKey}"]`);
    if (row instanceof HTMLElement && hidingTimeline) row.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (row !== null || document.getElementById(visit.pendingAnchor) !== null || visit.loadMoreTries >= MAX_LOAD_MORE) visit.pendingAnchor = null;
  }
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);
  if (hidingTimeline) document.documentElement.setAttribute('data-geld-timeline', 'compact');

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
  setWhoProvider(null);
  unwatchLoans();
  visit.settling = null;
  unmountPanel();
  hideSummary(null);
  applyFolds([], new Set());
  collapseDescription(false);
  setFullTimeline(false);
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
