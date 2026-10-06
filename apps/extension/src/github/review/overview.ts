/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import { createElement } from '../dom';
import type { GeldSettings } from '@geld/core';
import type { BotVerdictRecord, CommentLane, GeldPrMeta, ReviewItem, ReviewerRecord, ReviewerState } from '@geld/review';
import { botAppAvatar, botById, botsTriggeredBy, botTitle, checkReporterAvatar, clusterComments, firstSentence, isOpenStatus, isStatusLineComment, isTriggerComment, latestPreviews, latestReports, parseBotBody, parsePreviews, reportsFrom, reportsFromChecks, rerunTriggerFor, resolveBotId, verdictsFrom } from '@geld/review';
import type { Preview } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { phase, phaseSince } from '../../lib/perf';
import { persist } from '../../lib/context';
import { settingsItem } from '../../lib/storage';
import { clickResolve, copyText, focusReply, isResolvable, openReactions, postTopLevelComments, quoteReply, threadRootOf, tickSummaryCheckbox, timelineRootOf } from './actions';
import { authorOf, avatarSrcFor, avatarSrcForLogin, avatarSrcOf, blockText, createdAtOf, forgetThreads, normalizeAvatarSrc, crawlCheckRuns, crawlLeftovers, crawlReviews, crawlSidebarReviewers, findIn, latestReviewers, reviewCommentOf, revisionMarker, THREAD_SELECTOR } from './crawler';
import type { CrawledComment, CrawledReview, SidebarReviewer } from './crawler';
import type { CommentToClassify, JevDecisions, PreviewToClassify, ThreadToClassify } from './ai';
import { aiPending, aiStateFor, clearAiForPage, jevDecisionsFor, loadAiForPage, previewDecisionKey, runAi, withAi, withJevDone } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, fragmentHeaders, hasLoadMore, sourceAnchorFromHash } from './deeplink';
import { commitTimes, isRewritten } from './commit-dates';
import { editedAt, editsVersion, resetEditTimes, revisionAsOf } from './edit-times';
import { relativeTimeText } from './time';
import { refDetails, refsVersion, resetRefs } from './refs';
import { diffHashOf, isTrimmedPath, resetWholePaths, wholePath } from './whole-path';
import { applyFolds, closureKindOf, collapseDescription, groupBotRuns, groupClosures, groupDoneHumans, groupLeftovers, groupTriggers, isFoldedNode, markSeen, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { ATTR_CTL_SLOT, ATTR_GEAR_SLOT, ATTR_TIME_FOR, batchKey, panelSignature, CHECKS_KEY, foldKey, isVerdict, itemKey, mountPanel, PREVIEWS_KEY, renderBatchView, renderCommentsList, renderReportsList, REPORTS_KEY, reviewerGroups, REVIEWS_KEY, syncSpinners, unmountPanel } from './panel';
import type { Batch, ReviewEntry, ReviewEntryState, ReviewThreadRef } from './panel';
import { hideHoverCard, setHoverProvider, setReportProvider, setWhoProvider } from './hovercard';
import type { HoverPreview, ReportCard, WhoCard } from './hovercard';
import { knownMarkShape } from './mark-shape';
import { allResolved, checkCountsFrom, checksSummary, digestMarkdown, isCurrent, itemMarkdown, requiredReviewsFrom } from './panel-model';
import type { MarkdownSubject, RequiredReviews } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, CheckAvatar, FoldRow, GroupId, PanelHandlers, PanelModel } from './panel';
import type { RepoBotsHint } from './panel-model';
import { NO_REPO_BOTS, requestableBots } from './panel-model';
import { outgoingMentions, renderMentionsView, renderQuickView, timeCommitRows } from './quick-view';
import { redressComposer, renderChatView, renderCommentChat, sourceFocusKey, threadAnchorOf } from './chat';
import type { ChatByline } from './chat';
import { viaBotOf } from './via';
import type { ChatHandlers, ChatSource } from './chat';
import { quietClick } from './quiet-click';
import { fitChips, stopFittingChips } from './fit-chips';
import { applyHold, holdRow, releaseHold, watchPanelForHold } from './hold';
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
  /** The anchor this visit already landed on, and the row it landed in: the browser revealing it again (`beforematch`) must not move the page. */
  landedAnchor: string | null;
  landedFocusKey: string | null;
  /** Comment open inside the Reviews row's list. */
  openSubKey: string | null;
  /** Threads (by first-comment anchor) showing the review comment they came from. */
  sourcesShown: Set<string>;
  archivedPreviewsOpen: boolean;
  /** Rounds whose commit rows are unfolded (batch grouping). */
  openCommits: Set<string>;
  openPreviews: Set<string>;
  /** The row a click elsewhere landed on, while its flash runs (`stampFlash`). */
  flash: { readonly key: string; readonly startedAt: number } | null;
  /**
   * Since when the open line's conversation has been missing from the crawl.
   * GitHub swaps a thread's node when a reply posts (classic: a Turbo
   * replacement), and a pass that runs between the old node leaving and the
   * new one landing sees no thread; closing the line on that pass shut the
   * conversation the reader had just written into. The line is kept for a
   * grace period and only given up once the conversation stays gone.
   */
  openSubMissingSince: number | null;
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
  /**
   * Bots asked to run again from a chat's Rerun button, with when: the
   * button spins from the click, before the trigger comment is on the page
   * and the crawl reads the bot as running (see `RERUN_PENDING_MS`).
   */
  rerunPending: Map<string, number>;
}

const visit: VisitState = {
  fullTimeline: false,
  openKey: null,
  collapsedGroups: new Set<GroupId>(['done']),
  pageKey: '',
  generatedAt: '',
  loadMoreTries: 0,
  pendingAnchor: null,
  landedAnchor: null,
  landedFocusKey: null,
  openSubKey: null,
  sourcesShown: new Set<string>(),
  archivedPreviewsOpen: false,
  openCommits: new Set<string>(),
  openPreviews: new Set<string>(),
  flash: null,
  openSubMissingSince: null,
  knownRequired: null,
  lastReviews: null,
  checksExpanded: false,
  autoLoads: 0,
  manualDone: new Set(),
  settling: null,
  pinnedEntry: null,
  rerunPending: new Map(),
};

/** A Rerun click shows as running for this long on its own; by then the trigger comment is on the page or the post failed. */
const RERUN_PENDING_MS = 30_000;

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
 * reviews" behind a collapsed group). Lines with nothing to open. Read from
 * the sidebar block first; the bare controls are the fallback for a sidebar
 * whose rows the block read did not recognise.
 */
function awaitingReviewers(sidebar: readonly SidebarReviewer[]): ReviewEntry[] {
  const out: ReviewEntry[] = sidebar.filter((reviewer) => reviewer.state === 'awaiting').map((reviewer) => sidebarEntry(reviewer, 'awaiting'));
  for (const control of document.querySelectorAll<HTMLElement>('[aria-label^="Awaiting requested review from" i]')) {
    const login = /from\s+(\S+)/i.exec(control.getAttribute('aria-label') ?? '')?.[1] ?? '';
    if (login === '' || out.some((entry) => entry.author === login)) continue;
    const item = control.closest('.d-flex, li, [data-testid]') ?? control.parentElement;
    const image = item?.querySelector<HTMLImageElement>('img.avatar, img[class*="avatar"]') ?? null;
    out.push({ anchor: `awaiting:${login}`, author: login, avatarSrc: image === null ? avatarSrcForLogin(login) : normalizeAvatarSrc(image.currentSrc || image.getAttribute('src') || ''), state: 'awaiting', preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null });
  }
  return out;
}

/** A person's verdict as the sidebar states it, for the approvals count; null for a bot, an awaited reviewer or a dismissed review. */
function sidebarVerdict(reviewer: SidebarReviewer): ReviewerState | null {
  if (reviewer.bot) return null;
  switch (reviewer.state) {
    case 'approved':
    case 'changes_requested':
    case 'commented':
      return reviewer.state;
    default:
      return null;
  }
}

/** A line made from the sidebar alone: who, their picture, the verdict's glyph; no words, no time, nothing to open. */
function sidebarEntry(reviewer: SidebarReviewer, state: ReviewEntryState): ReviewEntry {
  return { anchor: `${state === 'awaiting' ? 'awaiting' : 'sidebar'}:${reviewer.login}`, author: reviewer.login, avatarSrc: reviewer.avatarSrc, state, preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null };
}

/**
 * The verdicts the sidebar knows that the timeline has not shown yet: a line
 * per such reviewer, so the open Reviews row says "X approved" the moment
 * the page is up rather than after the review's row has been fetched from
 * the end of a long conversation. The timeline's own line for the same
 * verdict replaces it as it lands (words, time, threads and all); a
 * dismissed review is nothing to list.
 */
function provisionalReviewLines(sidebar: readonly SidebarReviewer[], entries: readonly ReviewEntry[]): readonly ReviewEntry[] {
  const out: ReviewEntry[] = [];
  for (const reviewer of sidebar) {
    if (reviewer.bot || reviewer.state === 'awaiting' || reviewer.state === 'dismissed') continue;
    const login = reviewer.login.toLowerCase();
    if (entries.some((entry) => entry.author.toLowerCase() === login && entry.state === reviewer.state)) continue;
    out.push(sidebarEntry(reviewer, reviewer.state));
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
/** Where loaned nodes are shown: the quick view and the chats (a chat's body, its pinned context, the composer's side slot). */
const LOAN_VIEWS = '.geld-review__qv, .geld-review__chat';

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
  // A clock ticking in the light DOM (`time-ago`, older markup) is words, not state.
  if (record.type !== 'attributes' && target.closest('relative-time, time-ago, time') !== null) return false;
  if (record.type === 'attributes') {
    if (record.attributeName === 'data-resolved') return true;
    return target.closest(`${THREAD_SELECTOR}, ${THREAD_STATE}`) !== null && (record.attributeName === 'aria-pressed' || record.attributeName === 'aria-label' || record.attributeName === 'hidden');
  }
  if (record.type === 'characterData') return target.closest(`${THREAD_SELECTOR}, ${THREAD_STATE}`) !== null;
  // Nodes the panel moves in and out carry the loan token; what GitHub writes does not.
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (node instanceof Element && (node.hasAttribute('data-geld-teleported') || node.closest(LOAN_VIEWS) === null)) continue;
    if (node instanceof Element && node.hasAttribute('data-geld-ui')) continue;
    // Text the panel writes into its own cells (a time refreshed) is not GitHub's doing either.
    if (!(node instanceof Element) && target.closest('[data-geld-teleported]') === null) continue;
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
function adoptReplacements(records: readonly MutationRecord[]): boolean {
  let adopted = false;
  for (const record of records) {
    if (record.type !== 'childList' || !(record.target instanceof Element) || record.target.closest(LOAN_VIEWS) === null) continue;
    const gone = [...record.removedNodes].find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-geld-teleported'));
    const came = [...record.addedNodes].find((node): node is HTMLElement => node instanceof HTMLElement && !node.hasAttribute('data-geld-teleported') && !node.hasAttribute('data-geld-ui'));
    if (gone === undefined || came === undefined || !adoptReplacement(gone, came)) continue;
    adopted = true;
    // The composer's Resolve form swapped for a fresh one: it arrives in GitHub's words and is dressed where it stands.
    if (came.matches('form') && came.closest('.geld-review__composer-side') !== null) redressComposer(came);
  }
  return adopted;
}

function watchLoans(root: Element): void {
  if (loanWatched === root) return;
  loanWatcher?.disconnect();
  loanWatched = root;
  loanWatcher ??= new MutationObserver((records) => {
    // A swap GitHub made of a loaned node *is* the thread changing state (the classic Resolve answers with the
    // whole thread, resolved, in a fresh `<turbo-frame>`). Adoption hands the loan token to the newcomer, and
    // `touchesThreadState` reads a token as the panel's own move — so the adoption itself has to say "changed";
    // judged after it, the record read as nothing, and the resolved thread sat open in the row until a rebuild
    // for some other reason sent the loan home (mint#12367).
    const swapped = adoptReplacements(records);
    if (!swapped && !records.some(touchesThreadState)) return;
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
      if (visit.settling !== null) reapplyNow();
    }, delay);
  }
}

/**
 * The line open inside a round (`openSubKey`) follows its conversation: the
 * rounds are rebuilt from the timeline on every pass, and while the page is
 * still loading a comment can land in a different round than the pass
 * before (new commit rows between it and the last push). The round that
 * holds it now is the one that opens, so the reader's open comment stays
 * open instead of closing because its round was no longer the open one.
 */
function reseatOpenLine(batches: readonly Batch[]): void {
  const sub = visit.openSubKey;
  if (sub === null || visit.openKey === null || !visit.openKey.startsWith('batch:')) return;
  const holds = (batch: Batch): boolean => batch.items.some((item) => itemKey(item.id) === sub) || batch.comments.some((entry) => entry.anchor === sub) || batch.reviews.some((entry) => entry.anchor === sub);
  const current = batches.find((batch) => batch.key === visit.openKey);
  if (current !== undefined && holds(current)) return;
  const home = batches.find(holds);
  if (home !== undefined) visit.openKey = home.key;
}

/** How long an open line's conversation may be absent from the crawl before the line is given up. */
const OPEN_LINE_GRACE_MS = 5000;

/** Note the open line's conversation as missing this pass; true once it has been missing for the whole grace period. */
function openLineStillMissing(): boolean {
  const now = Date.now();
  visit.openSubMissingSince ??= now;
  if (now - visit.openSubMissingSince < OPEN_LINE_GRACE_MS) {
    // Another look shortly: the swapped-in node is usually there within a frame or two.
    reapplySoon();
    return false;
  }
  visit.openSubMissingSince = null;
  return true;
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

/**
 * The bots a run is waiting on, with when it was asked for: a person's trigger comment ("@greptileai", "bugbot
 * run") or the bot's own "Starting…" line, read in timeline order so the latest ask per bot wins. Only such a
 * bot's earlier summary is worth asking the edit log about (edit-times.ts): a bot that reports a re-run by
 * rewriting that summary posts nothing new, and the edit after the ask is the report.
 */
function runsAskedFor(comments: readonly RawComment[], extraLogins: readonly string[]): ReadonlyMap<string, number> {
  const asked = new Map<string, number>();
  for (const comment of comments) {
    if (comment.kind === 'thread') continue;
    const at = Date.parse(comment.createdAt);
    if (Number.isNaN(at)) continue;
    const bot = resolveBotId(comment.author, extraLogins);
    if (bot === null) {
      if (isTriggerComment(comment.body, extraLogins)) for (const entry of botsTriggeredBy(comment.body, extraLogins)) asked.set(entry.id, at);
    } else if (isStatusLineComment(comment.body)) {
      asked.set(bot, at);
    } else {
      asked.delete(bot);
    }
  }
  return asked;
}

function buildFromComments(crawled: Crawled, settings: GeldSettings, headSha: string, generatedAt: string): GeldPrMeta {
  const comments = crawled.comments.map((entry) => entry.comment);
  const items = clusterComments(comments, settings.reviewBots);
  const asked = runsAskedFor(comments, settings.reviewBots);
  // The merge box's check rows, as the Action would read them from the API: a bot whose run finished green and
  // that flagged nothing is clean, whatever its opening comment said.
  const bots = verdictsFrom(
    crawlCheckRuns(document, headSha),
    crawled.comments.map(({ comment, author }) => {
      const bot = author.bot ? resolveBotId(author.login, settings.reviewBots) : null;
      const askedAt = bot === null ? undefined : asked.get(bot);
      // A bot summary posted before a run was asked for: its edit time says whether that run has reported into it.
      const node = comment.kind !== 'thread' && askedAt !== undefined && Date.parse(comment.createdAt) < askedAt ? document.getElementById(comment.anchor) : null;
      const edited = node === null ? null : editedAt(node, reapplySoon);
      return {
        author: comment.author,
        body: comment.body,
        anchor: comment.anchor,
        ...(comment.createdAt === '' ? {} : { createdAt: comment.createdAt }),
        ...(comment.reactedBy === undefined ? {} : { reactedBy: comment.reactedBy }),
        ...(edited === null ? {} : { editedAt: edited }),
        ...(comment.kind === 'thread' && comment.isResolved !== undefined ? { resolved: comment.isResolved } : {}),
      };
    }),
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

/** Each state-change event paired with the comment left with it (fold.ts), and the anchors those pairs take out of the other lists. */
function closureGroups(crawled: Crawled): { readonly groups: readonly FoldGroup[]; readonly paired: ReadonlySet<string> } {
  const events = crawled.events.map((event) => ({ anchor: event.anchor, root: event.root, kind: closureKindOf(event.root), actor: authorOf(event.root)?.login ?? '', at: Date.parse(findIn(event.root, 'relative-time, time-ago, time')?.getAttribute('datetime') ?? '') }));
  const comments = crawled.comments.map((entry) => ({ author: entry.author.login, bot: entry.author.bot, anchor: entry.comment.anchor, root: entry.root, at: Date.parse(entry.comment.createdAt), preview: firstSentence(entry.comment.body), kind: entry.comment.kind }));
  return groupClosures(events, comments);
}

function foldGroups(meta: GeldPrMeta, settings: GeldSettings, crawled: Crawled, paired: ReadonlySet<string>): readonly FoldGroup[] {
  if (settings.compactTimeline === 'off' || visit.fullTimeline) return [];
  // Triggers and bots' run-status lines fold without a row; the rest of the bot comments get their rounds.
  const triggerAnchors = new Set(crawled.comments.filter((entry) => (!entry.author.bot && isTrigger(entry, settings)) || isStatusLine(entry)).map((entry) => entry.comment.anchor));
  const botAnchors = new Set(meta.fold.comments.filter((anchor) => !triggerAnchors.has(anchor)));
  const commentRefs = crawled.comments.map((entry) => ({ author: entry.comment.author, anchor: entry.comment.anchor, root: entry.root }));
  const groups = [...groupBotRuns(commentRefs, botAnchors, [])];
  const triggers = groupTriggers(commentRefs, triggerAnchors);
  if (triggers !== null) groups.push(triggers);
  const eventGroup = groupBotRuns([], new Set(), crawled.events.filter((event) => !paired.has(event.anchor)));
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
    // A row headlined by its state change keeps that change's time, not the first event's.
    const headlineNode = group.headline === undefined ? null : (group.nodes.find((node) => node.id === group.headline?.anchor) ?? null);
    return {
      key: group.key,
      label: group.label,
      section: group.section ?? 'comments',
      count: group.nodes.length,
      avatarSrc: group.author === null ? null : avatarSrcOf(group.nodes[0] ?? null),
      author: group.author,
      firstAnchor,
      time: headlineNode === null ? timeTextOf(group.nodes[0] ?? null, firstAnchor) : timeTextOf(headlineNode, headlineNode.id),
      timeAnchor: headlineNode === null ? firstAnchor : headlineNode.id,
      ...(group.closure === undefined ? {} : { closure: group.closure }),
      ...(group.headline === undefined ? {} : { headline: group.headline }),
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
 * The pass in which the search last came up empty. A merged pull request
 * has no checks heading at all, and the search by headings reads the text
 * of every button, span, paragraph and div it looks at; the section is
 * asked for several times per pass, so one miss answers for the whole pass
 * and the next pass looks again.
 */
let checksMissedInPass = -1;
let reviewPass = 0;

/**
 * The merge box's checks section, located by its own headings ("1 in
 * progress check", "8 successful checks") rather than by container
 * markup, which differs between the Rails and React merge boxes: the
 * nearest ancestor that holds every such heading, stopping before the
 * merge box itself.
 */
function checksSection(): HTMLElement | null {
  if (checksSectionEl !== null && checksSectionEl.isConnected) return checksSectionEl;
  if (checksMissedInPass === reviewPass) return null;
  // The React merge box labels its sections; nothing else on the page carries this label.
  const labelled = document.querySelector('section[aria-label="Checks"]');
  if (labelled instanceof HTMLElement && labelled.closest('.geld-review') === null) {
    checksSectionEl = labelled;
    mergeHomeEl = mergeBox() ?? labelled.parentElement;
    return checksSectionEl;
  }
  const box = mergeBox();
  // The headings live in the merge box when the page has one Geld recognises (the ancestor walk below stops there
  // anyway); only a merge box in markup not seen before is searched for across the page.
  const headings = [...(box ?? document).querySelectorAll<HTMLElement>('button, summary, h2, h3, h4, span, p, div')].filter(
    (node) => node.childElementCount <= 2 && CHECK_HEADING.test((node.textContent ?? '').replace(/\s+/g, ' ').trim()) && node.closest('.geld-review') === null,
  );
  const first = headings[0];
  if (first === undefined) {
    checksMissedInPass = reviewPass;
    return null;
  }
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
  if (top < sticky) scrollRowTo(top + window.scrollY);
  else revealOpened(after);
  // From here until the reader scrolls, the row stays where it landed whatever arrives above it.
  holdRow(focusKey);
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
function scrollRowTo(rowTop: number): number {
  const destination = rowDestination(rowTop);
  window.scrollTo({ top: destination, behavior: 'instant' });
  return destination;
}

/** The scroll position that puts a row whose document top is `rowTop` just under the sticky header (see `scrollRowTo`). */
function rowDestination(rowTop: number): number {
  const gap = 8;
  const withHeader = rowTop - stickyHeaderBottomAt(rowTop) - gap;
  if (stickyHeaderBottomAt(withHeader) > 0) return withHeader;
  const bare = rowTop - gap;
  // No header at either destination: the row goes to the top edge. The header would appear only at the bare
  // destination: stop short of it, where the row sits a header's height down and nothing covers it.
  return stickyHeaderBottomAt(bare) > 0 ? withHeader : bare;
}

/**
 * Make the browser's own fragment scroll agree with ours. Until the document
 * has finished loading, Chrome keeps scrolling the URL's `#anchor` element to
 * the top edge on every layout (its fragment anchor is dismissed only by the
 * reader scrolling or the load ending). That element is the carrier of the
 * id Chrome found when the page was navigated to, before the panel existed:
 * GitHub repeats a review's id on its `js-updatable-content` shell and the
 * comment group inside it, and after the landing the group is on loan in
 * the row's chat while the shell stays home, so each of Chrome's scrolls
 * moved the page to one of them and the hold moved it back: the page
 * ping-ponged for as long as it kept loading, ten or twenty seconds on a
 * long conversation. A `scroll-margin-top` on every carrier of exactly its
 * distance from the landing (negative when it sits above, which CSS allows)
 * makes Chrome's scroll land where the row's landing does, so its repeats
 * are no-ops. Re-measured every pass while loading, since content landing
 * above moves the carriers; a hidden carrier has no box and is skipped
 * (`alignRevealWithLanding` handles the one Chrome is about to reveal).
 */
function alignAnchorCarriers(anchor: string, focusKey: string): void {
  const row = document.querySelector(`[data-geld-focus="${focusKey}"]`);
  if (!(row instanceof HTMLElement)) return;
  const destination = rowDestination(row.getBoundingClientRect().top + window.scrollY);
  for (const carrier of document.querySelectorAll(`[id="${CSS.escape(anchor)}"]`)) {
    if (!(carrier instanceof HTMLElement) || carrier.getClientRects().length === 0) continue;
    carrier.style.scrollMarginTop = `${Math.round(carrier.getBoundingClientRect().top + window.scrollY - destination)}px`;
  }
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
/** A fetch that failed (a 5xx, a blip) is tried again after this long, not on the next pass. */
const FRAGMENT_RETRY_MS = 30_000;
const requestedFragments = new WeakSet<Element>();
/**
 * What each fetched URL put in the page. A URL is fetched again only once
 * none of those nodes is in the document any more: GitHub replaces every
 * timeline item from its partial on the next socket message about the pull
 * request (`js-updatable-content`), and the partial carries a resolved
 * thread as its header with the comments deferred behind the same URL, so
 * the thread the crawl had just read vanishes until that URL is fetched
 * once more. Keyed by URL rather than "once per visit", which also keeps a
 * fragment that carries a fragment of its own from looping: what it put in
 * the page is connected, so the URL stays satisfied.
 */
let fetchedFragments = new Map<string, readonly Node[]>();
let fragmentsInFlight = new Set<string>();
let failedFragments = new Map<string, number>();
let eagerFragments = 0;
/** Cancels the fetches in flight: an answer for a page that is gone, or for a copy of this script that retired, is not wanted. */
let fragmentAbort = new AbortController();

function resetFragments(): void {
  fragmentAbort.abort();
  fragmentAbort = new AbortController();
  eagerFragments = 0;
  fetchedFragments = new Map();
  fragmentsInFlight = new Set();
  failedFragments = new Map();
}

/** Whether `src` is in the page right now: fetched and still standing, in flight, or failed too recently to try again. */
function fragmentSatisfied(src: string): boolean {
  if (fragmentsInFlight.has(src)) return true;
  const failedAt = failedFragments.get(src);
  if (failedAt !== undefined && Date.now() - failedAt < FRAGMENT_RETRY_MS) return true;
  const nodes = fetchedFragments.get(src);
  return nodes !== undefined && nodes.some((node) => node.isConnected);
}

/**
 * GitHub minimizes reviews it marked as resolved and leaves their contents —
 * the review's own threads included — behind a lazy `include-fragment` that
 * loads only when scrolled into view, which a folded row never is. Fetch them
 * the way the element would (a few at a time; asking the element itself to
 * go eager made it error out) and put the markup in its place, so the
 * crawler sees every thread.
 */
function loadMinimizedReviews(): void {
  for (const { fragment, src } of deferredFragments()) {
    if (eagerFragments >= MAX_EAGER_FRAGMENTS || fragmentsInFlight.size >= FRAGMENT_CONCURRENCY) break;
    if (!fragmentWanted(fragment, src)) continue;
    requestedFragments.add(fragment);
    fragmentsInFlight.add(src);
    eagerFragments += 1;
    void fetchFragment(fragment, src).finally(() => {
      fragmentsInFlight.delete(src);
      fragmentLanded();
    });
  }
}

/** The timeline's lazy fragments that hold conversation (threads' comments, minimized reviews and comments), in timeline order. */
function deferredFragments(): readonly { readonly fragment: Element; readonly src: string }[] {
  const pending: { readonly fragment: Element; readonly src: string }[] = [];
  const timeline = document.querySelector('.js-discussion, .pull-discussion-timeline') ?? document;
  // Threads first (they are the items), then minimized reviews and comments.
  for (const thread of timeline.querySelectorAll('review-thread-collapsible[data-deferred-content-url], [data-deferred-content-url].js-resolvable-timeline-thread-container')) {
    const fragment = thread.querySelector('include-fragment');
    const src = thread.getAttribute('data-deferred-content-url');
    // A thread whose first comment shows still defers its replies behind the same fragment. GitHub's element sets
    // the fragment's `src` when the pointer rests on the header (preload); lazy, it then waits to be scrolled into
    // view, which a folded thread never is, so a fragment with a `src` still needs fetching here.
    if (fragment !== null && src !== null && fragment.closest('.dropdown-menu, details-menu, action-menu, [popover]') === null) pending.push({ fragment, src });
  }
  for (const fragment of timeline.querySelectorAll('.minimized-comment include-fragment[src]')) {
    const src = fragment.getAttribute('src');
    // Inside a comment that has loaded, the fragments left are its edit form and saved replies, not the comment.
    const minimized = fragment.closest('.minimized-comment');
    const comment = fragment.closest('.js-comment, [id^="discussion_r"], [id^="issuecomment-"], [id^="pullrequestreview-"]');
    if (src !== null && !(minimized !== null && comment !== null && minimized.contains(comment))) pending.push({ fragment, src });
  }
  return pending;
}

/** Whether `fragment` still needs fetching: not asked for, not in the page, not in flight or failed a moment ago. */
function fragmentWanted(fragment: Element, src: string): boolean {
  // Panel-made nodes never hold GitHub fragments; a thread on loan to the panel still does.
  return !requestedFragments.has(fragment) && !fragmentSatisfied(src) && !(fragment.closest('.geld-review') !== null && fragment.closest('[data-geld-teleported]') === null);
}

/**
 * Whether the timeline is still being read: fragments on their way or yet
 * to be asked for, or a "Load more" this visit will still press. While it
 * is, the Reviews row's heading comes from the sidebar (complete from the
 * start) and its lines fill in; the row says so with a small in-progress
 * mark instead of a count it does not have yet. Only the compact timeline
 * fetches everything; with it off the lazy fragments stay GitHub's, and
 * nothing here is "still coming".
 */
function timelineIngesting(hidingTimeline: boolean): boolean {
  if (fragmentsInFlight.size > 0) return true;
  if (!hidingTimeline) return false;
  if (visit.autoLoads < MAX_AUTO_LOADS && hasLoadMore()) return true;
  if (eagerFragments >= MAX_EAGER_FRAGMENTS) return false;
  return deferredFragments().some(({ fragment, src }) => fragmentWanted(fragment, src));
}

/**
 * The fragment standing for `src` right now: the one asked for, or, when
 * GitHub replaced its container while the answer was on its way, the fresh
 * one in the replacement (a deferred thread's `include-fragment`, or a
 * minimized comment's).
 */
function liveFragmentFor(fragment: Element, src: string): Element | null {
  if (fragment.isConnected) return fragment;
  for (const container of document.querySelectorAll(`[data-deferred-content-url="${CSS.escape(src)}"]`)) {
    const inner = container.querySelector('include-fragment');
    if (inner !== null && inner.closest('.geld-review__qv, .geld-review__chat') === null) return inner;
  }
  return document.querySelector(`include-fragment[src="${CSS.escape(src)}"]`);
}

/**
 * A fetched fragment is in the page. The next fetches start at once (the
 * queue used to move only when a pass ran), and the render waits for the
 * burst to settle: dozens of threads land a few hundred milliseconds apart
 * on a long conversation, and a rebuild per landing sent the open chat
 * home and back each time, which read as the page flickering for the
 * first seconds. One render per {@link FRAGMENT_SETTLE_MS} of quiet, and
 * at least one every {@link FRAGMENT_RENDER_MAX_MS} while they keep coming.
 */
const FRAGMENT_SETTLE_MS = 400;
const FRAGMENT_RENDER_MAX_MS = 1500;
let fragmentRenderTimer: number | null = null;
let fragmentRenderSince = 0;

function fragmentLanded(): void {
  // Torn down since the fetch began (the reader left the conversation, or a newer copy of this script took the
  // page over): nothing to render, and asking for more fragments would start the whole cycle again — a retired
  // copy used to keep fetching and remounting its own panel over the live one's for as long as fragments
  // remained, and the two panels, each rebuilt from its own memory of what was open, took turns on the page.
  if (lastSettings === null) return;
  if (lastSettings.compactTimeline !== 'off' && !visit.fullTimeline) loadMinimizedReviews();
  const now = Date.now();
  if (fragmentRenderTimer !== null) {
    // The burst has gone on long enough: let the pending render happen.
    if (now - fragmentRenderSince >= FRAGMENT_RENDER_MAX_MS) return;
    window.clearTimeout(fragmentRenderTimer);
  } else {
    fragmentRenderSince = now;
  }
  const wait = Math.min(FRAGMENT_SETTLE_MS, Math.max(0, fragmentRenderSince + FRAGMENT_RENDER_MAX_MS - now));
  fragmentRenderTimer = window.setTimeout(() => {
    fragmentRenderTimer = null;
    reapplyNow();
  }, wait);
}

async function fetchFragment(fragment: Element, src: string): Promise<void> {
  const { signal } = fragmentAbort;
  try {
    const response = await fetch(new URL(src, location.href), { headers: fragmentHeaders(), credentials: 'same-origin', signal });
    if (!response.ok) {
      failedFragments.set(src, Date.now());
      return;
    }
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const target = liveFragmentFor(fragment, src);
    // Gone, and nothing stands in its place: GitHub's own load got there first, or the container is on its way.
    if (target === null) return;
    const nodes = [...parsed.body.childNodes].map((node) => document.adoptNode(node));
    target.replaceWith(...nodes);
    failedFragments.delete(src);
    fetchedFragments.set(src, nodes);
  } catch {
    // Cancelled (see `resetFragments`): not a failure of the fetch, and nobody is waiting for it.
    if (signal.aborted) return;
    // Left as GitHub's own lazy fragment; it still loads when the reader scrolls to it in the full timeline.
    failedFragments.set(src, Date.now());
  }
}

let reapplyTimer: number | null = null;
/**
 * A pass was asked for while the tab was hidden (a fragment landed, a loaned
 * thread changed, a Resolve round trip answered). Nothing runs in a hidden
 * tab; the controller's catch-up pass on `visibilitychange` takes this flag
 * and re-applies before the tab paints.
 */
let deferredWhileHidden = false;

/** The panel's current render signature plus what is open, for the harness's scope check (`GeldController.checkScope`). */
export function reviewSignature(): string {
  return `${panelSignature()}|${visit.openKey ?? ''}|${visit.openSubKey ?? ''}`;
}

/** Whether a pass was deferred while hidden; clears the flag. */
export function takeReviewDeferred(): boolean {
  const was = deferredWhileHidden;
  deferredWhileHidden = false;
  return was;
}

/** The pass itself, unless nobody is looking (then it is noted for the catch-up). */
function reapplyNow(): void {
  if (lastSettings === null) return;
  if (document.hidden) {
    deferredWhileHidden = true;
    return;
  }
  applyReviewOverview(lastSettings);
}

/** Another pass shortly (fetched markup arrived), coalesced. */
function reapplySoon(): void {
  if (lastSettings === null) return;
  if (document.hidden) {
    deferredWhileHidden = true;
    return;
  }
  if (reapplyTimer !== null) return;
  reapplyTimer = window.setTimeout(() => {
    reapplyTimer = null;
    reapplyNow();
  }, 150);
}

/**
 * The settings of the pass that mounted the overview, and the sign that it
 * is mounted at all: `null` from `teardownReviewOverview` on. Every
 * re-apply that an asynchronous answer asks for (a fetched fragment, Jev, a
 * Resolve round trip, the AI run) checks it first, so a torn-down overview
 * — the controller stopped because a newer copy of the content script took
 * the page over, or the reader left the conversation — stays torn down.
 */
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
 * After a click that opens a row elsewhere in the panel (a bot chip, a line
 * in the Reviews index), bring that row into view if it is not already
 * there: the reader asked to go somewhere, and nothing else tells them where
 * it opened. A row off screen or under the sticky header goes just under the
 * header; a row on screen whose opened content runs past the fold comes up
 * by what is missing and no further (`revealOpened`), so a thread that
 * landed low in the viewport shows its chat without its own row leaving the
 * top. Instant, and only when needed.
 */
function revealRow(focusKey: string): void {
  const row = document.querySelector(`[data-geld-focus="${focusKey}"]`);
  if (!(row instanceof HTMLElement)) return;
  const rect = row.getBoundingClientRect();
  const sticky = stickyHeaderBottomAt(window.scrollY);
  if (rect.top < sticky || rect.bottom > window.innerHeight) scrollRowTo(rect.top + window.scrollY);
  else revealOpened(row);
  holdRow(focusKey);
  visit.flash = { key: focusKey, startedAt: performance.now() };
  stampFlash();
}

const ATTR_FLASH = 'data-geld-flash';
/** The flash animation's length (style.css `geld-review-flash`). */
const FLASH_MS = 1600;

/**
 * A click on one row that lands the reader on another (a pointer line, a
 * report pill, a thread chip) tints the destination row and lets the tint
 * fade, the way GitHub lights a targeted comment and chat apps a linked
 * message, so the eye finds where the panel went. The attribute drives a
 * CSS animation. The panel is rebuilt a few times right after a row opens
 * (the chat's loans land), each time with new row elements, so the flash is
 * remembered on the visit and stamped again after every mount for as long
 * as it runs, picking the animation up where it was.
 */
function stampFlash(): void {
  const flash = visit.flash;
  if (flash === null) return;
  const elapsed = performance.now() - flash.startedAt;
  if (elapsed >= FLASH_MS) {
    visit.flash = null;
    return;
  }
  const control = document.querySelector(`[data-geld-focus="${flash.key}"]`);
  const row = control instanceof HTMLElement ? (control.closest<HTMLElement>('li') ?? control) : null;
  if (row === null || row.hasAttribute(ATTR_FLASH)) return;
  row.style.animationDelay = `-${Math.round(elapsed)}ms`;
  row.setAttribute(ATTR_FLASH, '');
  row.addEventListener(
    'animationend',
    () => {
      row.removeAttribute(ATTR_FLASH);
      row.style.removeProperty('animation-delay');
    },
    { once: true },
  );
}

/**
 * Rounds by push. The timeline is walked in home order: a run of commit rows
 * with nothing between them opens a round (they are its pushes, merged), and
 * everything until the next commit — threads, bot run summaries, previews,
 * people's reviews — is what landed for that push. Content before any commit
 * is round 1 with no commits. With no commits on the page there is one round.
 */
/**
 * A commit row stands in the timeline where GitHub lists it, and GitHub
 * lists a pull request's commits by the push that put *the commit as it is
 * now* on the branch. A rebase (or an amend, a cherry-pick) rewrites every
 * commit, so after one the whole list stands at the rebase and the earlier
 * pushes — which the reviews between them answered — have no row left in
 * the timeline (mint#11561: a week of push-and-review cycles read as one
 * round once the branch was rebased). The commit's authored date survives
 * the rewrite (the Commits tab says both), so a rewritten commit is seated
 * in the timeline's order where it was made: before the first entry dated
 * after it. A commit made and pushed as it is keeps GitHub's position, which
 * is the push itself; a force-push row is a dated boundary of its own. The
 * dates arrive once per visit; until they do, every commit stands where
 * GitHub put it.
 */
function seatRewrittenCommits<T extends { readonly node: Element; readonly kind: string }>(entries: T[], pushRoots: ReadonlySet<HTMLElement>): void {
  const moved: { readonly entry: T; readonly at: number }[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.kind !== 'commit' || (entry.node instanceof HTMLElement && pushRoots.has(entry.node))) continue;
    const sha = /\/commits\/([0-9a-f]{7,40})(?:[/?#]|$)/i.exec(entry.node.querySelector('a[href*="/commits/"]')?.getAttribute('href') ?? '')?.[1];
    if (sha === undefined) continue;
    const times = commitTimes(sha, reapplySoon);
    if (times === null || !isRewritten(times)) continue;
    moved.push({ entry, at: Date.parse(times.authored) });
    entries.splice(index, 1);
  }
  if (moved.length === 0) return;
  moved.sort((a, b) => a.at - b.at);
  // Each entry's own date (a force-push row's, a comment's, a thread's first comment's); a commit row has none.
  const dated = entries.map((entry) => (entry.kind === 'commit' && !(entry.node instanceof HTMLElement && pushRoots.has(entry.node)) ? Number.NaN : Date.parse(createdAtOf(entry.node))));
  let cursor = 0;
  for (const { entry, at } of moved) {
    while (cursor < entries.length) {
      const date = dated[cursor];
      if (date !== undefined && !Number.isNaN(date) && date > at) break;
      cursor += 1;
    }
    entries.splice(cursor, 0, entry);
    dated.splice(cursor, 0, at);
    cursor += 1;
  }
}

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
    /** A host's preview comments: the round's previews (pills), never bot comment lines. */
    readonly previewComments: RoundComment[];
    readonly reviews: ReviewEntry[];
  }
  type Entry =
    | { readonly node: Element; readonly kind: 'commit' }
    | { readonly node: Element; readonly kind: 'item'; readonly item: ReviewItem }
    | { readonly node: Element; readonly kind: 'comment' | 'preview'; readonly comment: RoundComment }
    | { readonly node: Element; readonly kind: 'review'; readonly review: ReviewEntry };
  const previewAnchors = new Set(previewsAll.map((entry) => entry.anchor));
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
    // A comment that announces a preview (ready, failed, refused) is that preview: it shows as a pill, not a line.
    place({ node: entry.root, kind: previewAnchors.has(entry.comment.anchor) ? 'preview' : 'comment', comment }, entry.root);
  }
  const itemAnchors = new Set(meta.items.flatMap((item) => item.sources.map((source) => source.anchor)));
  for (const review of reviewEntriesAll) {
    // Threads are items already; a person's verdict or top-level comment is the round's review. A pending request is nothing that landed.
    if (review.state === 'thread' || review.state === 'awaiting' || itemAnchors.has(review.anchor)) continue;
    place({ node: document.documentElement, kind: 'review', review }, entryNodes.get(review.anchor) ?? timelineRootOf(review.anchor));
  }
  entries.sort((a, b) => compareHome(a.node, b.node));
  seatRewrittenCommits(entries, pushRoots);
  const rounds: Round[] = [];
  let current: Round | null = null;
  const fresh = (): Round => ({ commits: [], items: [], comments: [], previewComments: [], reviews: [] });
  const hasContent = (round: Round): boolean => round.items.length + round.comments.length + round.previewComments.length + round.reviews.length > 0;
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
    else if (entry.kind === 'preview') current.previewComments.push(entry.comment);
    else if (entry.kind === 'review') current.reviews.push(entry.review);
  }
  // Whatever the page could not place (not loaded yet) goes with the latest round.
  if (unplaced.length > 0) {
    const last = rounds[rounds.length - 1] ?? fresh();
    if (rounds.length === 0) rounds.push(last);
    for (const entry of unplaced) {
      if (entry.kind === 'item') last.items.push(entry.item);
      else if (entry.kind === 'comment') last.comments.push(entry.comment);
      else if (entry.kind === 'preview') last.previewComments.push(entry.comment);
      else if (entry.kind === 'review') last.reviews.push(entry.review);
    }
  }
  // A round is known by the push that opened it (the first commit row's anchor, `commits-pushed-<sha>`, or the
  // force-push event's id), else by its first comment; only a round with neither falls back to its position.
  const identity = (round: Round, position: number): string => {
    for (const row of round.commits) {
      const id = /^(commits-pushed-|event-)/.test(row.id) ? row.id : (row.querySelector('[id^="commits-pushed-"], [id^="event-"]')?.id ?? '');
      if (id !== '') return id;
      const sha = /\/commits\/([0-9a-f]{7,40})/.exec(row.querySelector('a[href*="/commits/"]')?.getAttribute('href') ?? '')?.[1];
      if (sha !== undefined) return `commit-${sha}`;
    }
    const first = round.comments[0]?.anchor ?? round.items[0]?.sources[0]?.anchor ?? round.reviews[0]?.anchor ?? round.previewComments[0]?.anchor;
    return first ?? `at-${position + 1}`;
  };
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
    for (const comment of round.previewComments) add(comment.author, comment.avatar, true);
    for (const item of round.items) {
      for (const avatar of avatarsFor(item)) addAvatar(avatar);
      for (const source of item.sources) add(source.author, avatarSrcForLogin(source.author), source.bot !== undefined || /\[bot\]$/i.test(source.author));
    }
    for (const review of round.reviews) add(review.author, review.avatarSrc ?? avatarSrcForLogin(review.author), false);
    const previewAnchorsHere = new Set(round.previewComments.map((comment) => comment.anchor));
    const first = round.comments[0]?.anchor ?? round.items[0]?.sources[0]?.anchor ?? round.reviews[0]?.anchor ?? round.previewComments[0]?.anchor ?? null;
    const firstNode = first === null ? null : document.getElementById(first);
    // CI is read from the last commit row; a force-push event carries none.
    const lastCommit = [...round.commits].reverse().find((row) => !pushRoots.has(row)) ?? null;
    // The round's threads by the bot that wrote the comment: a run summary leads to its findings as a person's
    // review leads to its threads (same count on the line, same chips under the opened bubble).
    const sameBot = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase() || (resolveBotId(a) !== null && resolveBotId(a) === resolveBotId(b));
    const threadsBy = (author: string): ReviewThreadRef[] =>
      round.items.flatMap((item) => {
        const source = item.sources.find((candidate) => candidate.kind === 'thread' && sameBot(candidate.author, author)) ?? item.sources.find((candidate) => sameBot(candidate.author, author));
        return source === undefined ? [] : [{ anchor: source.anchor, done: !isOpenStatus(item.status) }];
      });
    return {
      key: batchKey(identity(round, position)),
      index: position + 1,
      avatars,
      names,
      items: round.items,
      // Findings first: what the author must act on, before verdicts and reports.
      comments: [...round.comments]
        .sort((a, b) => Number(b.lane === 'finding') - Number(a.lane === 'finding'))
        .map((comment) => {
          const threads = threadsBy(comment.author);
          return {
            anchor: comment.anchor,
            author: comment.author,
            avatarSrc: comment.avatar,
            state: 'comment' as const,
            preview: firstSentence(comment.body),
            time: timeTextOf(comment.node, comment.anchor),
            hasBody: true,
            done: false,
            replies: 0,
            myReaction: null,
            ...(comment.lane === null ? {} : { lane: comment.lane }),
            ...(threads.length === 0 ? {} : { threads }),
          };
        }),
      reviews: round.reviews,
      commits: round.commits,
      commitCount: round.commits.filter((row) => !pushRoots.has(row)).length,
      ciGlyph: lastCommit === null ? null : commitCiGlyph(lastCommit),
      committers: committersOf(round.commits),
      previews: previewsAll.filter((entry) => previewAnchorsHere.has(entry.anchor)),
      time: timeTextOf(firstNode ?? round.comments[0]?.node ?? round.previewComments[0]?.node ?? round.commits[round.commits.length - 1] ?? null, first),
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
  if (record.verdict === 'failed') return record.reason === undefined ? 'Its review of this pull request failed' : `Did not review this pull request: ${record.reason}`;
  const scored = record.score === undefined ? '' : `Scored this pull request ${record.score}/5`;
  if (record.verdict === 'clean') return scored === '' ? 'Found nothing on this pull request' : `${scored} and found nothing`;
  if (allResolved(record)) return scored === '' ? 'Everything it found on this pull request is resolved' : `${scored}, everything it found is resolved`;
  const issues = record.count === undefined ? null : `${record.count} issue${record.count === 1 ? '' : 's'}`;
  if (scored !== '') return issues === null ? scored : `${scored}, ${issues} still open`;
  if (issues !== null) return `Reported ${issues} on this pull request`;
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
    const expand = section.querySelector<HTMLElement>('button[aria-label="Expand checks"], button[aria-expanded="false"][aria-label*="checks" i]');
    if (expand !== null) quietClick(expand);
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
  readonly createdAt: string;
  /** The review bot the comment is by, when it is one's. */
  readonly botId: string | null;
  /** A bot's report of a run (its summary or review body): not a status line, not a trigger, not a thread. */
  readonly summary: boolean;
}

let sourceFacts = new Map<string, SourceFacts>();

/**
 * A bot posts its run summary and its threads moments apart, in either
 * order (Greptile's summary leads its review by seconds; CodeRabbit's
 * walkthrough follows); a summary this long after a thread is the next
 * run's.
 */
const SUMMARY_LAG_MS = 10 * 60 * 1000;
/** A bot finishes writing its summary in the moments after it posts the run's threads; edits this soon after count as the run's reading. */
const RUN_SETTLE_MS = 5 * 60 * 1000;

/**
 * The bot's run summary a thread came from: the bot's latest summary written
 * by the thread's time (give or take the lag above). Bots rewrite that one
 * comment run after run, so a thread from an earlier run has a summary that
 * may since say something else — `revisionAsOf` reads it as it was.
 */
function botSummaryFor(botId: string, threadAt: number): { readonly anchor: string; readonly facts: SourceFacts } | null {
  let best: { readonly anchor: string; readonly facts: SourceFacts } | null = null;
  for (const [anchor, facts] of sourceFacts) {
    if (facts.botId !== botId || !facts.summary) continue;
    const at = Date.parse(facts.createdAt);
    if (Number.isNaN(at) || (!Number.isNaN(threadAt) && at > threadAt + SUMMARY_LAG_MS)) continue;
    if (best === null || at > Date.parse(best.facts.createdAt)) best = { anchor, facts };
  }
  return best;
}

/**
 * The comment a thread was posted from: the body of the review that holds
 * it ("Bugbot reviewed … found 3 issues"), else the bot's run summary in
 * effect when the thread was opened. Pinned at the top of the thread's
 * chat: the strip names it and shows its first line, and unfolds it in
 * place on request. A bot's source carries how it read at the thread's time
 * (`ChatSource.revision`): bots edit their summaries between runs, and the
 * page's node may by now report a later run.
 */
function threadSourceOf(thread: HTMLElement, item: ReviewItem | undefined, meta: GeldPrMeta): ChatSource | null {
  const source = item?.sources[0];
  const bot = source?.bot;
  const who = bot !== undefined ? botTitle(bot, source?.author ?? '') : source?.author ?? 'the reviewer';
  const firstComment = thread.querySelector('[id^="discussion_r"], [id^="issuecomment-"]') ?? thread;
  const threadAt = Date.parse(createdAtOf(firstComment));
  const describe = (node: HTMLElement, anchor: string, label: string): ChatSource => {
    const facts = sourceFacts.get(anchor);
    const isBot = facts?.bot ?? bot !== undefined;
    const revision = isBot && !Number.isNaN(threadAt) ? revisionAsOf(node, anchor, threadAt, RUN_SETTLE_MS, reapplySoon) : null;
    // A bot's summary from well before the thread is an earlier run's (this run posted none): the strip says when.
    const summaryAt = facts === undefined ? NaN : Date.parse(facts.createdAt);
    const earlier = isBot && !Number.isNaN(threadAt) && !Number.isNaN(summaryAt) && threadAt - summaryAt > SUMMARY_LAG_MS && facts !== undefined ? facts.createdAt : null;
    return {
      node,
      anchor,
      label,
      preview: facts?.preview ?? '',
      avatarSrc: facts?.avatarSrc ?? avatarSrcOf(node),
      login: facts?.login ?? source?.author ?? '',
      bot: isBot,
      ...(revision === null ? {} : { revision }),
      ...(earlier === null ? {} : { earlier }),
    };
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
  if (bot === undefined) return null;
  // The bot's summary as of the thread (by time), else the bot's latest word when it is not itself a thread: a bot
  // that writes no review body has a thread comment for its "summary", and that is a thread, not a source.
  const summaryAnchor = botSummaryFor(bot, threadAt)?.anchor ?? meta.bots.find((record) => record.id === bot)?.sourceId ?? null;
  const summaryEl = summaryAnchor === null ? null : document.getElementById(summaryAnchor);
  if (summaryEl !== null && closestAtHome(summaryEl, THREAD_SELECTOR) !== null) return null;
  const summary = summaryAnchor === null ? null : (entryNodes.get(summaryAnchor) ?? summaryEl?.closest<HTMLElement>('.timeline-comment, .js-comment-container, [data-testid="comment-container"]') ?? null);
  if (summaryAnchor !== null && summary !== null && !summary.contains(thread)) return describe(summary, summaryAnchor, `${who}'s run summary`);
  return null;
}

/**
 * The avatar GitHub draws beside a merge box check row, by the check's name,
 * and its shape: GitHub squares the marks of GitHub Apps and organisations
 * (`data-square` on the React avatar, no `avatar-user` on the classic one)
 * and rounds those of users and OAuth Apps (Chromatic's statuses come from
 * one). The page is the only place that knows which.
 */
/**
 * The mark for a check report: the service's App mark when the registry knows
 * it, else the merge box row's picture unless that is a person's. The row
 * shows the account that posted the status, which for a service connected
 * through someone's authorization (Chromatic, Vercel, Codecov as OAuth Apps)
 * is that person, and a bot's pill must never wear a face.
 */
function checkAvatarOf(reporterId: string, name: string): CheckAvatar | null {
  const mark = checkReporterAvatar(reporterId);
  if (mark !== null) return { src: mark, round: false };
  for (const row of document.querySelectorAll<HTMLElement>('li:has([class*="StatusCheckRow"]), .merge-status-item')) {
    const title = (row.querySelector('[class*="StatusCheckRow"] h4 a span, [class*="StatusCheckRow"] h4 a, .merge-status-item strong, .merge-status-item .text-emphasized')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title !== name) continue;
    const img = row.querySelector<HTMLImageElement>('img[data-testid="github-avatar"], img.avatar');
    const src = img?.getAttribute('src') ?? null;
    if (img === null || src === null) return null;
    if (isPersonAvatar(src, img)) return null;
    const square = img.hasAttribute('data-square') || (img.classList.contains('avatar') && !img.classList.contains('avatar-user'));
    return { src, round: !square };
  }
  return null;
}

/** GitHub serves people's avatars from `/u/<id>` (Apps from `/in/`, OAuth Apps from `/oa/`); `avatar-user` is its class for them. */
function isPersonAvatar(src: string, img: Element): boolean {
  if (img.classList.contains('avatar-user')) return true;
  try {
    return /^\/u\//.test(new URL(src, 'https://github.com').pathname);
  } catch {
    return false;
  }
}

/** Any avatar the page shows beside one of the bot's logins (a review comment of its own, a reviewer entry, a hovercard link). */
/** The avatar of the bot's run summary, only when that comment is the bot's own (not a person's trigger). */
function botSourceAvatar(botId: string, meta: GeldPrMeta): string | null {
  const sourceId = meta.bots.find((bot) => bot.id === botId)?.sourceId;
  if (sourceId === undefined) return null;
  const facts = sourceFacts.get(sourceId);
  if (facts === undefined || !facts.bot || resolveBotId(facts.login) !== botId) return null;
  return avatarSrcFor(sourceId);
}

function botAppAvatarFor(botId: string): string | null {
  const bot = botById(botId);
  return bot === null ? null : botAppAvatar(bot);
}

function botAvatarByLogin(botId: string): string | null {
  for (const login of botById(botId)?.logins ?? []) {
    const src = avatarSrcForLogin(login);
    if (src !== null) return src;
  }
  return null;
}

/** The pull request's author, from the page header (the description card when the header is not there). */
function prAuthorLogin(): string | null {
  const header = document.querySelector('.gh-header-meta a.author, [data-testid="issue-metadata-author"] a, .gh-header-meta a[data-hovercard-type="user"]');
  const login = header === null ? null : (header.textContent ?? '').trim().replace(/^@/, '');
  if (login !== null && login !== '') return login;
  const card = document.querySelector('[data-geld-attached]');
  return card === null ? null : (authorOf(card)?.login ?? null);
}

/**
 * A review bot's run summary gets Geld's Rerun control on its byline (a bot
 * with a trigger phrase only): the one place to ask for another run from
 * the comment, where Greptile puts its own Retrigger badge — which the chat
 * hides, so there is one control and it behaves like the request menu's.
 * Running (the bot's verdict, or a click a moment ago) is shown on the
 * button itself; a click then asks before posting a second trigger.
 */
function withRerun(byline: ChatByline, author: string, meta: GeldPrMeta, settings: GeldSettings, reapply: () => void): ChatByline {
  if (!byline.bot) return byline;
  const id = resolveBotId(author, settings.reviewBots);
  const trigger = id === null ? null : rerunTriggerFor(id);
  if (id === null || trigger === null) return byline;
  const pending = visit.rerunPending.get(id);
  const running = meta.bots.some((bot) => bot.id === id && bot.verdict === 'running') || (pending !== undefined && Date.now() - pending < RERUN_PENDING_MS);
  return {
    ...byline,
    rerun: {
      bot: botTitle(id, author),
      running,
      onRerun: () => {
        visit.rerunPending.set(id, Date.now());
        void postTopLevelComments([trigger]).then(() => reapplySoon());
        reapply();
      },
    },
  };
}

/** A byline with what GitHub's header says beyond the name: the "Author" label and the App the comment came through. */
function dressByline(byline: ChatByline, anchor: string | null): ChatByline {
  const author = prAuthorLogin();
  // An App's own comment carries the App as its "via" too (GitHub pairs the avatar with itself and hides the pair);
  // only a person's comment posted through an App wears the mark.
  const via = anchor === null || byline.bot ? null : viaBotOf(timelineRootOf(anchor));
  return {
    ...byline,
    ...(anchor === null ? {} : { timeAnchor: anchor }),
    ...(author !== null && author.toLowerCase() === byline.login.toLowerCase() ? { author: true } : {}),
    ...(via === null ? {} : { via }),
  };
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

/**
 * Rewrite the panel's time cells from the page's clocks, and nothing else: no
 * crawl, no model, no signature. GitHub's `relative-time` ticks inside its
 * shadow root, which no observer of the page sees, so the panel's copies of
 * those words went stale until some other change happened to re-render the
 * row; `scheduleTimeRefresh` runs this every few seconds while the tab is
 * shown — the clocks tick once a minute, each at its own second, and a fixed
 * minute between reads left a cell a whole minute behind the clock it
 * copies (the page said "17 minutes ago" under a row still saying 16); the
 * pass is a handful of text reads, so a short cadence costs nothing. A
 * light-DOM clock tick (older markup, `time-ago`) reaches it straight from
 * the controller.
 */
export function refreshReviewTimes(): number {
  let changed = 0;
  for (const cell of document.querySelectorAll<HTMLElement>(`[${ATTR_TIME_FOR}]`)) {
    const anchor = cell.getAttribute(ATTR_TIME_FOR);
    if (anchor === null) continue;
    const text = timeTextOf(document.getElementById(anchor), anchor);
    if (text === '' || text === cell.textContent) continue;
    cell.textContent = text;
    changed += 1;
  }
  return changed;
}

const TIME_REFRESH_MS = 10_000;
let timeRefreshTimer: number | null = null;

/** Keep the cells current while the panel is up; a hidden tab skips the pass (its return re-renders anyway). */
function scheduleTimeRefresh(): void {
  timeRefreshTimer ??= window.setInterval(() => {
    if (!document.hidden) refreshReviewTimes();
  }, TIME_REFRESH_MS);
}

function stopTimeRefresh(): void {
  if (timeRefreshTimer !== null) window.clearInterval(timeRefreshTimer);
  timeRefreshTimer = null;
}

/** GitHub's absolute renderings ("on Sep 20, 2026, 10:18 AM", commit rows): the panel speaks in relative time throughout. */
const ABSOLUTE_TIME = /^on\s|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/i;

function timeTextRead(node: Element): string {
  const el = findIn(node, 'relative-time, time-ago, time');
  if (el === null) return '';
  const datetime = el.getAttribute('datetime') ?? '';
  let shown = (el.shadowRoot?.textContent?.trim() ?? '') || (el.textContent ?? '').trim();
  if (shown !== '' && datetime !== '' && ABSOLUTE_TIME.test(shown)) shown = relativeTimeText(datetime) || shown;
  if (shown !== '') {
    if (datetime !== '') shownTimes.set(datetime, shown);
    return shown;
  }
  if (datetime === '') return '';
  return shownTimes.get(datetime) ?? relativeTimeText(datetime);
}

/** Close to GitHub's relative wording for a time it has not rendered yet. */

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
  // Every thread posted with a review (a person's or a bot's), counted on the review's line; the crawl knows each
  // thread's first comment, its state and its home, which names the review.
  const threadsByReview = new Map<string, ReviewThreadRef[]>();
  for (const entry of crawled.comments) {
    if (entry.comment.kind !== 'thread') continue;
    const node = document.getElementById(entry.comment.anchor);
    const review = node === null ? null : reviewContainerOf(node);
    if (review === null) continue;
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === entry.comment.anchor));
    const refs = threadsByReview.get(review.id) ?? [];
    refs.push({ anchor: entry.comment.anchor, done: item !== undefined ? !isOpenStatus(item.status) : entry.comment.isResolved === true });
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
/**
 * A report pill's card: the reporter as its mark and name, the report's
 * state, project and words, and for a comment report a clamped copy of the
 * comment itself (the alerts table, the failing tests); a check report has
 * no comment, and the card leads to the service's page instead.
 */
function reportCardFor(anchor: string, model: PanelModel, handlers: PanelHandlers): ReportCard | null {
  const report = model.reports.latest.find((entry) => entry.anchor === anchor) ?? null;
  if (report === null) return null;
  const check = report.url !== undefined;
  const avatar = check ? checkAvatarOf(report.reporter, anchor.replace(/^check:/, '')) : null;
  const avatarSrc = avatar?.src ?? model.avatarForAnchor(anchor) ?? (report.author === '' ? null : avatarSrcForLogin(report.author));
  const node = check ? null : document.getElementById(anchor);
  const bodyNode = node?.querySelector(HOVER_BODY_SELECTOR) ?? null;
  const body = bodyNode instanceof HTMLElement ? bodyNode.cloneNode(true) : null;
  if (body instanceof HTMLElement) {
    body.removeAttribute('id');
    for (const child of body.querySelectorAll('[id]')) child.removeAttribute('id');
  }
  const slug = report.author.replace(/\[bot\]$/i, '');
  return {
    avatarSrc,
    round: avatar?.round ?? (avatarSrc !== null && knownMarkShape(avatarSrc) === 'round'),
    name: report.title,
    login: report.author,
    time: model.timeFor(anchor),
    project: report.project ?? null,
    headline: report.headline,
    state: report.state,
    body: body instanceof HTMLElement ? body : null,
    href: report.url ?? null,
    appHref: slug === '' ? null : `/apps/${slug}`,
    onOpen: () => handlers.onOpenReport(anchor),
  };
}

function hoverPreviewFor(row: HTMLElement, meta: GeldPrMeta, groups: readonly FoldGroup[], handlers: PanelHandlers): HoverPreview | null {
  const itemId = row.getAttribute('data-geld-item');
  const foldId = row.getAttribute('data-geld-fold');
  const subAnchor = row.getAttribute('data-geld-sub');
  let anchor: string | null = null;
  let more = 0;
  let onReply: (() => void) | null = null;
  let onOpen: (() => void) | null = null;
  if (subAnchor !== null) {
    // A comment line: a bot's run summary, a person's review or remark. Its card opens the line, or, for a line in
    // the Reviews index, goes where the line points; a bare verdict (nothing to open, the state name is the row's
    // text) has no card.
    if (subAnchor.startsWith('awaiting:') || subAnchor.startsWith('sidebar:')) return null;
    const pointer = row.hasAttribute('data-pointer');
    if (!pointer && row.querySelector('[aria-expanded]') === null) return null;
    anchor = subAnchor;
    onOpen = pointer ? () => handlers.onOpenAnchor(subAnchor) : () => handlers.onToggleSub(subAnchor);
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
  if (key === REVIEWS_KEY || key === PREVIEWS_KEY || key === REPORTS_KEY || key.startsWith('batch:')) return [document.documentElement];
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
  return [...slot.querySelectorAll<HTMLElement>('.geld-review__qv, .geld-review__chat-body')].some((view) => view.childElementCount === 0);
}

/** What the repository says about its review bots (declared in its config, config files found), from the controller. */
let repoBots: RepoBotsHint = NO_REPO_BOTS;

export function applyReviewOverview(settings: GeldSettings, paths?: readonly string[] | null, bots?: RepoBotsHint): void {
  phase('review', () => applyReviewOverviewPass(settings, paths, bots));
}

function applyReviewOverviewPass(settings: GeldSettings, paths?: readonly string[] | null, bots?: RepoBotsHint): void {
  reviewPass += 1;
  if (paths !== undefined) diffPaths = paths;
  if (bots !== undefined) repoBots = bots;
  const page = describePage(new URL(window.location.href));
  if (page.kind !== 'pull-conversation' || !settings.enabled || !settings.prOverview) {
    // Nothing mounted (a files page, a list): the page-wide cleanup queries have nothing to find.
    if (visit.pageKey !== '') teardownReviewOverview();
    return;
  }
  lastSettings = settings;
  if (visit.pageKey !== page.stateKey) {
    restoreAll();
    visit.pageKey = page.stateKey;
    visit.generatedAt = new Date().toISOString();
    visit.openKey = null;
    visit.collapsedGroups = new Set<GroupId>(['done']);
    visit.fullTimeline = false;
    visit.loadMoreTries = 0;
    visit.pendingAnchor = sourceAnchorFromHash(location.hash);
    visit.landedAnchor = null;
    visit.landedFocusKey = null;
    visit.openSubKey = null;
    visit.sourcesShown = new Set<string>();
    visit.archivedPreviewsOpen = false;
    visit.openCommits = new Set<string>();
    visit.openPreviews = new Set<string>();
    visit.flash = null;
    visit.openSubMissingSince = null;
    visit.knownRequired = null;
    resetRefs();
    resetWholePaths();
    releaseHold();
    timeByAnchor.clear();
    visit.lastReviews = null;
    visit.checksExpanded = false;
    visit.autoLoads = 0;
    resetFragments();
    forgetThreads();
    resetEditTimes();
    visit.manualDone = new Set();
    visit.rerunPending = new Map();
    checksSectionEl = null;
    mergeHomeEl = null;
    // This device's AI run for the pull request, if any; the pass re-applies once it is read.
    loadAiForPage(aiRunKey(page.stateKey), reapplySoon);
  }
  const crawledDom = phase('crawl', crawlConversation);
  const rawComments: readonly RawComment[] = crawledDom.comments.map((entry) => entry.comment);
  sourceFacts = new Map(
    crawledDom.comments
      .filter((entry) => entry.comment.kind !== 'thread')
      .map((entry) => {
        const botId = entry.author.bot ? resolveBotId(entry.author.login, settings.reviewBots) : null;
        // What `verdictsFrom` counts as a bot's report: not a status line or a trigger, and from a coding agent that
        // also chats (Replicas) only a review-shaped comment.
        const parsed = botId === null ? null : parseBotBody(entry.comment.body, botId.startsWith('custom:') ? '' : botId);
        const reviewShaped = parsed === null || botById(botId ?? '')?.conversational !== true || parsed.count !== null || parsed.score !== null || parsed.clean;
        const summary = botId !== null && reviewShaped && !isStatusLineComment(entry.comment.body) && !isTriggerComment(entry.comment.body, settings.reviewBots);
        return [entry.comment.anchor, { preview: firstSentence(entry.comment.body), avatarSrc: entry.avatarSrc, login: entry.author.login, bot: entry.author.bot, createdAt: entry.comment.createdAt, botId, summary }];
      }),
  );
  const found = phase('summary', () => findSummaryComment(document));
  hideSummary(found?.root ?? null);
  const headSha = phase('head-sha', () => detectHeadSha() ?? found?.meta.headSha ?? ZERO_SHA);
  // Jev first, from its cache: what it has said about the top-level comments decides what is a trigger below.
  const topLevel: CommentToClassify[] = crawledDom.comments.filter((entry) => entry.comment.kind !== 'thread').map((entry) => ({ anchor: entry.comment.anchor, author: entry.author.login, bot: entry.author.bot, body: entry.comment.body }));
  jevNow = phase('jev', () => jevDecisionsFor(settings, topLevel, [], reapplySoon));
  const composed = phase('cluster', () => composeMeta(found, buildFromComments(crawledDom, settings, headSha, visit.generatedAt)));
  // Then the threads, now that items exist: whether the replies say a thread is done.
  const bodies = new Map(crawledDom.comments.map((entry) => [entry.comment.anchor, { author: entry.author.login, body: entry.comment.body }] as const));
  const threads: ThreadToClassify[] = composed.meta.items
    .filter((item) => isOpenStatus(item.status) && item.sources.length > 1)
    .map((item) => ({ itemId: item.id, ...(item.path === undefined ? {} : { path: item.path }), comments: item.sources.map((source) => bodies.get(source.anchor) ?? { author: source.author, body: '' }) }));
  // Previews whose status the parser left unknown are asked about with the same request.
  const docText = new Map(crawledDom.comments.map((entry) => [entry.comment.anchor, entry.previewDoc.text] as const));
  const unknownPreviews: PreviewToClassify[] = phase('preview-parse', () =>
    crawledDom.comments
      .filter((entry) => entry.author.bot)
      .flatMap((entry) => parsePreviews(entry.previewDoc))
      .filter((entry) => entry.status === 'unknown')
      .map((entry) => ({ preview: entry, text: docText.get(entry.anchor) ?? '' })),
  );
  jevNow = phase('jev', () => jevDecisionsFor(settings, topLevel, threads, reapplySoon, unknownPreviews));
  const meta = phase('paths', () => withWholePaths(withManualDone(withJevDone(composed.meta, jevNow.done))));

  const viewingAnchor = sourceAnchorFromHash(location.hash);
  if (viewingAnchor !== null && document.getElementById(viewingAnchor) === null && visit.loadMoreTries < MAX_LOAD_MORE) {
    if (clickLoadMore()) visit.loadMoreTries += 1;
  }
  const compacting = settings.compactTimeline !== 'off';
  const hidingTimeline = compacting && !visit.fullTimeline;
  // "X closed this" with the comment X left as they did: one row, the comment its content.
  const closures = phase('closures', () => (hidingTimeline ? closureGroups(crawledDom) : { groups: [], paired: new Set<string>() }));
  const groups = phase('folds', () => [...foldGroups(meta, settings, crawledDom, closures.paired), ...closures.groups]);
  // Compact mode folds everything, so everything must be on the page: keep pressing GitHub's "Load more", and
  // fetch the reviews GitHub minimized ("marked as resolved") — their threads are behind lazy fragments that
  // would only load when scrolled into view, which a folded row never is.
  if (hidingTimeline && visit.autoLoads < MAX_AUTO_LOADS && clickLoadMore()) visit.autoLoads += 1;
  if (hidingTimeline) loadMinimizedReviews();
  // In compact mode the review threads live in their rows and GitHub's checks section in the CI row:
  // both fold out of the page, so nothing below is left to reveal or scroll to.
  const reviews = phase('reviews', crawlReviews);
  entryNodes = new Map(reviews.filter((review) => review.comment !== null).map((review) => [review.anchor, review.comment ?? review.root]));
  // The sidebar's Reviewers block: every reviewer's latest verdict from the first paint, while the timeline's
  // reviews are still being fetched from its end (see `timelineIngesting`).
  const sidebar = phase('sidebar', crawlSidebarReviewers);
  const awaiting = phase('awaiting', () => awaitingReviewers(sidebar));
  // A comment left with a close or reopen belongs to that row, not to the Reviews list or a round.
  const timelineEntries = phase('entries', () => reviewEntries(crawledDom, reviews, meta, settings).filter((entry) => !closures.paired.has(entry.anchor)));
  // The rounds are the timeline's; the sidebar's provisional lines (no row behind them yet) are the Reviews row's alone.
  const roundEntries = [...awaiting, ...timelineEntries];
  const comments = pinOpenEntry([...roundEntries, ...provisionalReviewLines(sidebar, timelineEntries)]);
  const ingesting = timelineIngesting(hidingTimeline);
  const allPreviews = phase('previews', () => previewsOn(crawledDom, meta));
  // Reporter bots' reports (test failures on their runners, coverage), read from the page's comments in timeline order.
  // ...and the services that report through a check whose Details lead to their site (Chromatic), read from the merge box.
  const allReports = phase('reports', () => [
    ...reportsFrom(crawledDom.comments.filter((entry) => entry.author.bot).map((entry) => ({ author: entry.author.login, body: entry.comment.body, anchor: entry.comment.anchor, ...(entry.comment.createdAt === '' ? {} : { createdAt: entry.comment.createdAt }) }))),
    ...reportsFromChecks(crawlCheckRuns(document, headSha)),
  ]);
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
  const leftoverList = phase('leftovers', () => crawlLeftovers(claimed));
  if (hidingTimeline) {
    const leftovers = groupLeftovers(leftoverList);
    groups.push(...leftovers);
    foldTargets.push(...leftovers);
  }
  // Rounds: what landed between two pushes. A push is a run of commit rows or a force-push event (after a force-push
  // GitHub lists no commits, only "force-pushed from a to b"). Bot run summaries belong to their round rather than to rows of their own.
  const pushRoots = new Set(leftoverList.filter((entry) => entry.kind === 'push').map((entry) => entry.root));
  const commitRoots = leftoverList.filter((entry) => entry.kind === 'commit' || entry.kind === 'push').map((entry) => entry.root);
  const batches = phase('batches', () =>
    buildBatches(meta, crawledDom, settings, commitRoots, pushRoots, roundEntries, allPreviews).map((batch) => {
      const pinnedComments = pinOpenEntry(batch.comments);
      return pinnedComments === batch.comments ? batch : { ...batch, comments: pinnedComments };
    }),
  );
  settleAfterResolve(meta, batches);
  reseatOpenLine(batches);
  // A round's bot comment lines and its preview pills both stand for their comments: neither needs a fold row too.
  const batchedAnchors = new Set(batches.flatMap((batch) => [...batch.comments.map((entry) => entry.anchor), ...batch.previews.map((entry) => entry.anchor)]));
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
  const modelStart = performance.now();
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
  // The sidebar's verdicts first — GitHub's own latest-per-reviewer, complete from the start — then the
  // timeline's and the payload's for anyone the sidebar does not list.
  const reviewers: ReviewerRecord[] = sidebar.flatMap((reviewer) => {
    const state = sidebarVerdict(reviewer);
    return state === null ? [] : [{ login: reviewer.login, state }];
  });
  const settled = new Set(sidebar.filter((reviewer) => !reviewer.bot).map((reviewer) => reviewer.login.toLowerCase()));
  for (const record of latestReviewers(reviews)) if (!awaited.has(record.login.toLowerCase()) && !settled.has(record.login.toLowerCase())) reviewers.push(record);
  for (const record of meta.reviewers) if (!awaited.has(record.login.toLowerCase()) && !settled.has(record.login.toLowerCase()) && !reviewers.some((entry) => entry.login === record.login)) reviewers.push(record);
  const requestable = phase('bots', () => requestableBots(meta, document, rawComments, repoBots));
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
    // A bot's mark, from wherever the page shows it: an avatar captioned with one of its logins (Bugbot's review
    // comments are by cursor[bot]; unambiguous, so first), its run summary's avatar when the summary is the bot's
    // own comment (a `running` verdict's source is the trigger comment, whose avatar is the person who asked),
    // the App avatar nearest its `/apps/<slug>` link or check row (`requestableBots`), else GitHub's mark for the
    // App, by its id.
    botIconFor: (botId) => botAvatarByLogin(botId) ?? botSourceAvatar(botId, meta) ?? iconByBot.get(botId) ?? botAppAvatarFor(botId),
    checks: checkCountsFrom(checksSectionText() ?? boxText),
    requiredFailing: requiredFailingIn(checksSection()),
    previews: latestPreviews(allPreviews),
    reports: latestReports(allReports),
    grouping: settings.reviewGrouping,
    openCommits: visit.openCommits,
    openPreviews: visit.openPreviews,
    ai: aiStateFor(meta, rawComments, settings),
    archivedPreviewsOpen: visit.archivedPreviewsOpen,
    avatarForAnchor: (anchor) => crawledDom.comments.find((entry) => entry.comment.anchor === anchor)?.avatarSrc ?? avatarSrcFor(anchor),
    checkAvatarFor: (reporterId, name) => checkAvatarOf(reporterId, name),
    checksRing,
    comments,
    reviewerGroups: reviewerGroups(comments, sidebar),
    ingesting,
    openSubKey: visit.openSubKey,
    openSources: visit.sourcesShown,
    refsVersion: refsVersion(),
    editsVersion: editsVersion(),
    running: meta.bots.some((bot) => bot.verdict === 'running'),
    reviews: (visit.lastReviews = requiredReviewsFrom(boxText, reviewers, { knownRequired: visit.knownRequired }) ?? visit.lastReviews),
    myReactionFor: (anchor) => myReactionOn(anchor),
    timeFor: (anchor) => timeTextOf(document.getElementById(anchor), anchor),
    avatarsFor,
    resolvable: itemResolvable,
    hiddenCount: groups.filter((group) => group.silent !== true).reduce((sum, group) => sum + group.nodes.length, 0),
    sinceLastVisit: hidingTimeline ? revisionMarker(leftoverList) : null,
    aiPending: aiPending(),
    fixFor,
  };
  // Asynchronous answers (the AI run's progress and end) re-apply through the mounted check, never past a teardown.
  const reapply = (): void => reapplyNow();
  const panelHandlers: PanelHandlers = {
    onToggle: (key) => {
      keepInPlace(`main:${key}`, () => {
        visit.openKey = visit.openKey === key ? null : key;
        // The line open inside the row that just closed belongs to that row. Left standing, the next pass
        // re-seated the open key into the round that holds it, and the round the reader clicked closed under
        // them while the other opened.
        visit.openSubKey = null;
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
    onRequestMenuClosed: () => reapplySoon(),
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
    onOpenReport: (anchor) => {
      keepInPlace(`main:${REPORTS_KEY}`, () => {
        // The pill of the report already open closes it; any other opens the row to that report.
        const wasOpen = visit.openKey === REPORTS_KEY && visit.openSubKey === anchor;
        visit.openKey = REPORTS_KEY;
        visit.openSubKey = wasOpen ? null : anchor;
        reapply();
      });
      revealRow(`main:sub:${anchor}`);
    },
    onTogglePreviews: (batchKey) => {
      keepInPlace(`previews:${batchKey}`, () => {
        if (visit.openPreviews.has(batchKey)) visit.openPreviews.delete(batchKey);
        else visit.openPreviews.add(batchKey);
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
      // Open the row that holds the comment, then GitHub's own picker inside it.
      const seat = seatFor(anchor, meta, groups, batches);
      if (seat === null) return;
      openRowLocal(seat.key, seat.sub);
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
      // A review that wrote nothing but opened threads has nothing of its own to show: the reader who asked for it
      // (from the Reviews index, from its line in the round) lands on its first thread, which is the conversation.
      const entry = comments.find((candidate) => candidate.anchor === anchor);
      const target = entry !== undefined && !entry.hasBody && isVerdict(entry) ? (entry.threads?.[0]?.anchor ?? anchor) : anchor;
      // Held by a row here? Open it and bring it into view. Otherwise let the browser take the reader to it in the timeline.
      const seat = hidingTimeline ? seatFor(target, meta, groups, batches) : null;
      if (seat === null) {
        location.hash = target;
        return;
      }
      openRowLocal(seat.key, seat.sub);
      reapply();
      revealRow(`main:${seat.sub === null ? (visit.openSubKey ?? visit.openKey) : `sub:${seat.sub}`}`);
    },
  };
  phaseSince('model', modelStart);
  const mounted = phase('panel', () => mountPanel(model, panelHandlers, { holdRebuild: fragmentRenderTimer !== null }));
  scheduleTimeRefresh();
  if (mounted !== null) {
    watchLoans(mounted.root);
    watchPanelForHold(mounted.root, () => {
      if (visit.landedAnchor !== null && visit.landedFocusKey !== null && document.readyState !== 'complete') alignAnchorCarriers(visit.landedAnchor, visit.landedFocusKey);
    });
    stampFlash();
  } else {
    unwatchLoans();
    releaseHold();
  }

  const slotsStart = performance.now();
  if (mounted?.slot !== null && mounted?.slot !== undefined && visit.openKey !== null) {
    const nodes = quickViewFor(visit.openKey, meta, groups);
    if (nodes.length === 0) {
      // An open thread row (by push) whose thread is momentarily out of the crawl keeps its row through the grace.
      if (!visit.openKey.startsWith('item:') || openLineStillMissing()) {
        visit.openKey = null;
        restoreAll();
      }
    } else if (slotNeedsRender(mounted.slot)) {
      if (visit.openKey === REVIEWS_KEY) {
        // An index of people's reviews; each line points at the round where its conversation opens.
        renderCommentsList(mounted.slot, model, panelHandlers);
      } else if (visit.openKey === REPORTS_KEY) {
        // The reporters' latest reports; the open line's comment stands under it as a one-bubble chat (a check's
        // report has no comment: the list shows its detail itself).
        const view = renderReportsList(mounted.slot, model, panelHandlers);
        const report = view.openComment === null ? null : (model.reports.latest.find((entry) => entry.anchor === view.openComment) ?? null);
        const commentNode = view.openComment === null ? null : (entryNodes.get(view.openComment) ?? timelineRootOf(view.openComment));
        if (view.nested !== null && report !== null && commentNode !== null) {
          const byline = dressByline({ login: report.author, bot: true, avatarSrc: model.avatarForAnchor(report.anchor), time: model.timeFor(report.anchor) }, report.anchor);
          renderCommentChat(view.nested, commentNode, byline);
        } else if (visit.openSubKey !== null && (view.openComment !== null || !model.reports.latest.some((entry) => entry.anchor === visit.openSubKey))) {
          // A comment that left the page, or a report no longer among the latest: nothing to keep open.
          visit.openSubKey = null;
        }
      } else if (visit.openKey.startsWith('batch:')) {
        const batch = batches.find((entry) => entry.key === visit.openKey);
        if (batch !== undefined) {
          const view = renderBatchView(mounted.slot, batch, model, panelHandlers);
          // By push: the round's commit rows, unfolded under their heading (they keep the commit-hover breakdown).
          if (view.commitsSlot !== null) renderQuickView(view.commitsSlot, batch.commits, reapplySoon);
          // A review's own comment, not its whole row ("X reviewed · View reviewed changes" says nothing here), as
          // a one-bubble chat; a bot's run summary and a person's remark the same way; a thread as its chat.
          const openEntry = view.openComment === null ? null : ([...batch.reviews, ...batch.comments].find((entry) => entry.anchor === view.openComment) ?? null);
          const thread = openEntry?.state === 'thread' ? threadRootOf(openEntry.anchor) : null;
          const commentNode = view.openComment === null ? null : (entryNodes.get(view.openComment) ?? (thread === null ? timelineRootOf(view.openComment) : null));
          if (view.nested !== null && thread !== null) {
            const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === openEntry?.anchor));
            renderChatView(view.nested, [thread], threadHandlers(item, meta, reapply));
          } else if (view.nested !== null && commentNode !== null) {
            const byline = openEntry === null ? null : withRerun(dressByline({ login: openEntry.author, bot: /\[bot\]$/i.test(openEntry.author), avatarSrc: openEntry.avatarSrc, time: openEntry.time }, openEntry.anchor), openEntry.author, meta, settings, reapply);
            // The threads the review came with, by file, leading to their rows.
            const links = (openEntry?.threads ?? []).map((thread) => {
              const root = threadRootOf(thread.anchor);
              const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === thread.anchor));
              return { anchor: thread.anchor, path: root === null ? '' : threadPathOf(root, item, meta), ...(item?.line === undefined ? {} : { line: item.line }), preview: firstSentence(bodies.get(thread.anchor)?.body ?? ''), done: thread.done };
            });
            renderCommentChat(view.nested, commentNode, byline, links, panelHandlers.onOpenAnchor);
          } else if (view.nested !== null && view.openItem !== null) {
            const item = view.openItem;
            renderChatView(view.nested, threadNodes(item), threadHandlers(item, meta, reapply));
          } else if (visit.openSubKey !== null && view.openItem === null && commentNode === null) {
            if (openLineStillMissing()) visit.openSubKey = null;
          } else {
            visit.openSubMissingSince = null;
          }
        }
      } else if (visit.openKey === CHECKS_KEY) {
        renderQuickView(mounted.slot, nodes);
      } else if (visit.openKey.startsWith(foldKey('closure:'))) {
        // The comment left with the change, as a one-comment chat without a byline: the row above is its header
        // (who, when, GitHub's ⋯), as with any other single comment; the event itself is that row.
        const group = groups.find((entry) => foldKey(entry.key) === visit.openKey);
        const comment = group?.nodes[0];
        if (group !== undefined && comment !== undefined) {
          renderCommentChat(mounted.slot, comment, null);
        } else {
          renderQuickView(mounted.slot, nodes);
        }
      } else if (visit.openKey === foldKey('mentions')) {
        const card = document.querySelector('[data-geld-attached]');
        const cardAuthor = card === null ? null : authorOf(card);
        const cardAvatar = card === null ? null : avatarSrcOf(card);
        renderMentionsView(
          mounted.slot,
          nodes,
          outgoingMentions(document.querySelector('[data-geld-attached] .comment-body, [data-geld-attached] .markdown-body, [data-geld-attached] [data-testid="markdown-body"]'), cardAuthor === null || cardAvatar === null ? null : { login: cardAuthor.login, avatarSrc: cardAvatar }),
          (href) => refDetails(href, reapplySoon),
        );
      } else if (visit.openKey.startsWith('item:')) {
        // Each review thread as its chat: the path, the hunk, the comment it came from pinned, every message.
        const item = meta.items.find((entry) => itemKey(entry.id) === visit.openKey);
        renderChatView(mounted.slot, item === undefined ? nodes : threadNodes(item), threadHandlers(item, meta, reapply));
      } else {
        // The Commits fold among these: its rows get their dates as they land.
        renderQuickView(mounted.slot, nodes, reapplySoon, { headSha: meta.headSha });
      }
    }
  } else {
    restoreAll();
  }
  phaseSince('slots', slotsStart);
  if (mounted !== null) {
    phase('dress', () => {
      wearControls(mounted.root, panelHandlers);
      wearGear(mounted.root);
      // Spinners rendered into the slot after the mount (preview lines, a round's CI glyph) join the same phase.
      syncSpinners(mounted.root);
      // The bots' and reports' pills give way to the room the row has (names first, then details).
      fitChips(mounted.root);
      // Commit rows on loan get their dates once those land (the slot itself is not rebuilt for that).
      timeCommitRows(mounted.root, reapplySoon);
    });
  }
  setHoverProvider((row) => hoverPreviewFor(row, meta, groups, panelHandlers));
  setWhoProvider((login) => whoCardFor(login, meta, model));
  setReportProvider((anchor) => reportCardFor(anchor, model, panelHandlers));
  phase('apply-folds', () => applyFolds(foldTargets, new Set()));
  // The browser's fragment jump went to the original's (now empty) place in
  // the timeline; the one correction Geld makes is to land on the row that
  // holds it, once, instantly, just under GitHub's sticky header rather than
  // at the viewport's top edge, where the header would slide over it.
  const pendingKey = visit.pendingAnchor === null ? null : rowKeyFor(visit.pendingAnchor, meta, groups, batches);
  if (visit.pendingAnchor !== null && mounted !== null && ((pendingKey !== null && (visit.openKey === pendingKey || visit.openSubKey === pendingKey)) || visit.loadMoreTries >= MAX_LOAD_MORE)) {
    const subFocus = visit.openSubKey === null ? null : visit.openSubKey.startsWith('item:') ? visit.openSubKey : `sub:${visit.openSubKey}`;
    const row = visit.openKey === null ? null : mounted.root.querySelector(`[data-geld-focus="main:${subFocus ?? visit.openKey}"]`);
    // Landed once per anchor: the browser revealing the same anchor again (`beforematch`, when a live update put
    // the comment home into a folded row for a moment) opens the row but must not move a page the reader may
    // have scrolled since.
    if (row instanceof HTMLElement && hidingTimeline && visit.landedAnchor !== visit.pendingAnchor) {
      visit.landedAnchor = visit.pendingAnchor;
      scrollRowTo(row.getBoundingClientRect().top + window.scrollY);
      const focusKey = `main:${subFocus ?? visit.openKey}`;
      visit.landedFocusKey = focusKey;
      alignAnchorCarriers(visit.pendingAnchor, focusKey);
      holdRow(focusKey);
      // The panel opened this row on its own (a permalink, the comment the reader just posted elsewhere): the same
      // tint a click that lands elsewhere gets, so the eye finds what opened.
      visit.flash = { key: focusKey, startedAt: performance.now() };
      stampFlash();
    }
    if (row !== null || document.getElementById(visit.pendingAnchor) !== null || visit.loadMoreTries >= MAX_LOAD_MORE) visit.pendingAnchor = null;
  }
  // While the page still loads, Chrome's fragment anchor is alive: keep its scroll pointed at the landing.
  if (visit.landedAnchor !== null && visit.landedFocusKey !== null && document.readyState !== 'complete') alignAnchorCarriers(visit.landedAnchor, visit.landedFocusKey);
  const tailStart = performance.now();
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);
  if (hidingTimeline) document.documentElement.setAttribute('data-geld-timeline', 'compact');
  // Everything on the page has been read: what GitHub inserts from here on waits for the next pass.
  markSeen();
  // The row the reader opened stays put under whatever this pass moved above it.
  applyHold();
  phaseSince('tail', tailStart);
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
  // The browser revealing the home row of an anchor this visit already landed on: its fragment anchor (bound to
  // this row when the page was navigated to, before the panel existed; GitHub repeats a review's id on the row
  // and the comment inside) is about to scroll the row into view. Point that scroll at the landing instead.
  if (anchor === visit.landedAnchor && visit.landedFocusKey !== null) alignRevealWithLanding(node, anchor, visit.landedFocusKey);
  visit.pendingAnchor = anchor;
  visit.loadMoreTries = MAX_LOAD_MORE;
  applyReviewOverview(settings);
}

/**
 * Chrome's fragment anchor scrolls so that its element's top, less the
 * element's `scroll-margin-top`, meets the viewport's top. The element here
 * is a folded timeline row about to be revealed; measured with its `hidden`
 * lifted (the browser lifts it right after this event anyway), the margin
 * that maps that scroll onto the landed row's position is its distance from
 * the landing (negative when the row sits below it, which CSS allows). The
 * pass that follows folds the row again; the browser's scroll then lands
 * where the reader already is, and nothing moves.
 */
function alignRevealWithLanding(node: Element, anchor: string, focusKey: string): void {
  // Measured with the row revealed (the browser lifts `hidden` right after this event anyway); the pass that
  // follows folds it again, and the browser's scroll then lands where the reader already is.
  node.removeAttribute('hidden');
  alignAnchorCarriers(anchor, focusKey);
}

export function teardownReviewOverview(): void {
  // First: nothing asked for earlier may run after this. Pending passes are dropped, fetches in flight cancelled,
  // and every later callback finds the overview unmounted (`lastSettings`).
  lastSettings = null;
  deferredWhileHidden = false;
  if (reapplyTimer !== null) window.clearTimeout(reapplyTimer);
  reapplyTimer = null;
  if (fragmentRenderTimer !== null) window.clearTimeout(fragmentRenderTimer);
  fragmentRenderTimer = null;
  resetFragments();
  hideHoverCard();
  releaseHold();
  setHoverProvider(null);
  setWhoProvider(null);
  setReportProvider(null);
  unwatchLoans();
  stopTimeRefresh();
  visit.settling = null;
  stopFittingChips();
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
  // Posting a comment makes GitHub point the URL at it. When the new comment already stands inside the open row
  // (the reply box the reader just used is in its chat, so the comment landed there), the reader is looking at
  // it: nothing to seek, open or scroll to — seating it afresh closed the round around it and reopened a row
  // under the pointer. The pass below only moves the target ring onto it.
  const node = anchor === null ? null : document.getElementById(anchor);
  if (anchor !== null && !(node !== null && node.closest('.geld-review') !== null)) {
    visit.loadMoreTries = 0;
    visit.pendingAnchor = anchor;
    // The reader asked for it (a click on a permalink): it lands even if this visit landed on it before.
    if (visit.landedAnchor === anchor) visit.landedAnchor = null;
  }
  applyReviewOverview(settings);
}
