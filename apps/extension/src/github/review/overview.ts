/**
 * Conversation-tab orchestrator: read the summary (or crawl), render the
 * panel above the first timeline item, hide folded activity, quick-view the
 * open row's real nodes, honour deeplinks. Idempotent; GitHub's React
 * remounts are handled by applying again. Never scrolls the page.
 */

import { createElement } from '../dom';
import type { GeldSettings } from '@geld/core';
import type { BotVerdictRecord, GeldPrMeta, ReviewItem } from '@geld/review';
import { botTitle, clusterComments, firstSentence, isOpenStatus, isTriggerComment, rerunTriggerFor, resolveBotId, verdictsFrom } from '@geld/review';
import { detectHeadSha } from '../head-sha';
import { describePage } from '../page';
import { clickResolve, copyText, focusReply, isResolvable, openReactions, postTopLevelComments, quoteReply, threadRootOf, tickSummaryCheckbox, timelineRootOf } from './actions';
import { authorOf, avatarSrcFor, avatarSrcForLogin, avatarSrcOf, blockText, crawlLeftovers, crawlReviews, findIn, latestReviewers, THREAD_SELECTOR } from './crawler';
import type { CrawledReview } from './crawler';
import { aiPending, consolidateInBrowser, resetAiForVisit, withAi } from './ai';
import { crawlConversation } from './crawler';
import { clickLoadMore, sourceAnchorFromHash } from './deeplink';
import { applyFolds, collapseDescription, groupBotRuns, groupDoneHumans, groupLeftovers, groupTriggers, isFoldedNode, setFullTimeline } from './fold';
import type { FoldGroup } from './fold';
import { ATTR_SUMMARY, findSummaryComment, mergeWithCrawler, usableMeta } from './meta-source';
import { ATTR_CTL_SLOT, ATTR_GEAR_SLOT, batchKey, CHECKS_KEY, foldKey, itemKey, mountPanel, renderBatchView, renderCommentsList, REVIEWS_KEY, unmountPanel } from './panel';
import type { Batch, ReviewEntry, ReviewEntryState } from './panel';
import { hideHoverCard, setHoverProvider, setWhoProvider } from './hovercard';
import type { HoverPreview, WhoCard } from './hovercard';
import { checkCountsFrom, checksSummary, digestMarkdown, isCurrent, itemMarkdown, requiredReviewsFrom } from './panel-model';
import type { MarkdownSubject, RequiredReviews } from './panel-model';
import { fixVisible } from '@geld/review';
import type { RawComment, SuggestedFix } from '@geld/review';
import type { Avatar, FoldRow, GroupId, PanelHandlers, PanelModel } from './panel';
import { installedBots } from './panel-model';
import { outgoingMentions, renderMentionsView, renderQuickView, renderThreadsView, revealThreadFor } from './quick-view';
import { compareHome, forgetLoan, onRestore, restoreAll, teleportInto, wornPiecesOf } from './teleport';

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
  rewriteStarted: boolean;
  pageKey: string;
  generatedAt: string;
  loadMoreTries: number;
  /** A permalink (or find-in-page hit) still to be honoured: open its row and land on it once. */
  pendingAnchor: string | null;
  /** Comment open inside the Reviews row's list. */
  openSubKey: string | null;
  /** "At least N approving reviews" as last stated by the merge box; it stops saying so once met. */
  knownRequired: number | null;
  /** The last reading, kept while React re-renders the merge box (a blank pass must not drop the row). */
  lastReviews: RequiredReviews | null;
  /** GitHub's checks list has been asked to render (its gear lives there). */
  checksExpanded: boolean;
  autoLoads: number;
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
  knownRequired: null,
  lastReviews: null,
  checksExpanded: false,
  autoLoads: 0,
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
    avatars.push({ src, bot: source.bot !== undefined || /\[bot\]$/i.test(source.author), login: source.author });
    if (avatars.length === 2) break;
  }
  return avatars;
}

function withManualDone(meta: GeldPrMeta): GeldPrMeta {
  if (visit.manualDone.size === 0) return meta;
  return { ...meta, items: meta.items.map((item) => (visit.manualDone.has(item.id) && isOpenStatus(item.status) ? { ...item, status: 'done-manual' } : item)) };
}

function foldRows(groups: readonly FoldGroup[]): readonly FoldRow[] {
  return groups.filter((group) => group.silent !== true).map((group) => ({
    key: group.key,
    label: group.label,
    section: group.section ?? 'comments',
    count: group.nodes.length,
    avatarSrc: group.author === null ? null : avatarSrcOf(group.nodes[0] ?? null),
    author: group.author,
    firstAnchor: firstAnchorIn(group.nodes[0] ?? null),
    time: timeTextOf(group.nodes[0] ?? null),
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
/** The checks section's text with its loaned content included, so counts read the same open or closed. */
function checksSectionText(): string | null {
  const section = checksSection();
  if (section === null) return null;
  return [blockText(section), ...wornPiecesOf(section).map((piece) => blockText(piece))].join('\n');
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
  const sticky = stickyHeaderBottom();
  if (top < sticky) window.scrollBy({ top: top - sticky - 8, behavior: 'instant' });
}

function stickyHeaderBottom(): number {
  const header = document.querySelector('.gh-header-sticky.is-stuck, .js-sticky.is-stuck, [class*="StickyHeader"], [data-testid="sticky-header"]');
  return header instanceof HTMLElement && header.getBoundingClientRect().height > 0 ? header.getBoundingClientRect().bottom : 0;
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
    if (fragment !== null && src !== null && fragment.getAttribute('src') === null && thread.querySelector('[id^="discussion_r"]') === null) pending.push({ fragment, src });
  }
  for (const fragment of timeline.querySelectorAll('.minimized-comment include-fragment[src]')) {
    const src = fragment.getAttribute('src');
    if (src !== null) pending.push({ fragment, src });
  }
  for (const { fragment, src } of pending) {
    if (eagerFragments >= MAX_EAGER_FRAGMENTS || fragmentsInFlight >= FRAGMENT_CONCURRENCY) break;
    if (requestedFragments.has(fragment) || requestedUrls.has(src) || fragment.closest('.geld-review') !== null) continue;
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
    const response = await fetch(new URL(src, location.href), { headers: { Accept: 'text/html; fragment', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
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

/** Open the row `key` names; an item opens inside its round, and the section holding either unfolds. */
function openRow(key: string, batches: readonly Batch[]): void {
  if (key.startsWith('item:')) {
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
    if (batch !== undefined) visit.collapsedGroups.delete(batch.items.some((item) => isOpenStatus(item.status)) ? 'open' : 'done');
  }
  visit.openKey = key;
}

/**
 * Rounds by push: each commit row in the timeline closes a round; threads and
 * bot run summaries fall into the round of the last commit before them. With
 * no commits on the page there is one round.
 */
function buildBatches(meta: GeldPrMeta, crawled: Crawled, settings: GeldSettings, commitRoots: readonly HTMLElement[]): readonly Batch[] {
  const commits = [...commitRoots].sort(compareHome);
  const roundOf = (node: Element | null): number => {
    if (node === null) return commits.length;
    let count = 0;
    for (const commit of commits) if (compareHome(commit, node) < 0) count += 1;
    return count;
  };
  const triggerAnchors = new Set(crawled.comments.filter((entry) => !entry.author.bot && isTriggerComment(entry.comment.body, settings.reviewBots)).map((entry) => entry.comment.anchor));
  const botAnchors = new Set(meta.fold.comments.filter((anchor) => !triggerAnchors.has(anchor)));
  interface RoundComment {
    readonly anchor: string;
    readonly avatar: string | null;
    readonly author: string;
    readonly node: HTMLElement;
    readonly body: string;
  }
  const rounds = new Map<number, { items: ReviewItem[]; comments: RoundComment[] }>();
  const at = (index: number): { items: ReviewItem[]; comments: RoundComment[] } => {
    const existing = rounds.get(index);
    if (existing !== undefined) return existing;
    const fresh = { items: [], comments: [] };
    rounds.set(index, fresh);
    return fresh;
  };
  for (const item of meta.items) at(roundOf(itemNodes(item)[0] ?? null)).items.push(item);
  for (const entry of crawled.comments) {
    if (!botAnchors.has(entry.comment.anchor) || !entry.author.bot) continue;
    at(roundOf(entry.root)).comments.push({ anchor: entry.comment.anchor, avatar: entry.avatarSrc ?? avatarSrcForLogin(entry.author.login), author: entry.author.login, node: entry.root, body: entry.comment.body });
  }
  return [...rounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, round], position) => {
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
      const first = round.comments[0]?.anchor ?? round.items[0]?.sources[0]?.anchor ?? null;
      const firstNode = first === null ? null : document.getElementById(first);
      return {
        key: batchKey(position + 1),
        index: position + 1,
        avatars,
        names,
        items: round.items,
        comments: round.comments.map((comment) => ({
          anchor: comment.anchor,
          author: comment.author,
          avatarSrc: comment.avatar,
          state: 'comment',
          preview: firstSentence(comment.body),
          time: timeTextOf(comment.node),
          hasBody: true,
          done: false,
          replies: 0,
          myReaction: null,
        })),
        time: timeTextOf(firstNode ?? round.comments[0]?.node ?? null),
        firstAnchor: first,
      };
    });
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

/** A thread's file path (with line), from the item or the thread's own file header. */
function threadPathOf(node: HTMLElement, item: ReviewItem | undefined): string {
  const header = node.querySelector('.file-header a, .file-header, [data-testid="file-header"], summary code, [class*="FileHeader"] a');
  const fromNode = (header?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (fromNode !== '') return fromNode;
  return item?.path === undefined ? '' : item.line === undefined ? item.path : `${item.path}:${item.line}`;
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
function timeTextOf(node: Element | null): string {
  const el = node === null ? null : findIn(node, 'relative-time, time-ago, time');
  if (el === null) return '';
  const shown = el.shadowRoot?.textContent?.trim() ?? '';
  return shown !== '' ? shown : (el.textContent ?? '').trim();
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
  const reviewedComments = new Set(reviews.map((review) => review.comment?.id ?? review.comment?.querySelector('[id]')?.id ?? ''));
  for (const review of reviews) {
    if (review.author.bot) continue;
    const body = review.comment === null ? '' : blockTextOf(review.comment);
    list.push({
      anchor: review.anchor,
      author: review.author.login,
      avatarSrc: review.avatarSrc,
      state: ENTRY_STATE[review.state],
      preview: body === '' ? '' : firstSentence(body),
      time: timeTextOf(review.root),
      hasBody: review.comment !== null,
      done: false,
      replies: 0,
      myReaction: null,
    });
  }
  for (const entry of crawled.comments) {
    if (entry.author.bot || isTriggerComment(entry.comment.body, settings.reviewBots)) continue;
    const anchor = entry.comment.anchor;
    if (reviewedComments.has(anchor) || entry.root.querySelector('[id^="pullrequestreview-"]') !== null) continue;
    const item = meta.items.find((candidate) => candidate.sources.some((source) => source.anchor === anchor));
    const thread = entry.comment.kind === 'thread';
    list.push({
      anchor,
      author: entry.author.login,
      avatarSrc: entry.avatarSrc,
      state: thread ? 'thread' : 'comment',
      preview: firstSentence(entry.comment.body),
      time: timeTextOf(document.getElementById(anchor)),
      hasBody: true,
      done: thread && (item !== undefined ? !isOpenStatus(item.status) : entry.comment.isResolved === true),
      replies: Math.max(0, (entry.comment.threadAnchors?.length ?? 1) - 1),
      myReaction: null,
    });
  }
  const nodes = new Map(list.map((entry) => [entry.anchor, document.getElementById(entry.anchor)]));
  const before = (a: string, b: string): number => {
    const x = nodes.get(a) ?? null;
    const y = nodes.get(b) ?? null;
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return compareHome(x, y);
  };
  return list.map((entry) => ({ ...entry, myReaction: entry.hasBody ? myReactionOn(entry.anchor) : null })).sort((a, b) => before(a.anchor, b.anchor));
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
  let anchor: string | null = null;
  let more = 0;
  let onReply: (() => void) | null = null;
  let onOpen: (() => void) | null = null;
  if (itemId !== null) {
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
    time: timeTextOf(node),
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
  // The Reviews row renders its own list; the panel itself stands in for "something to show".
  if (key === REVIEWS_KEY || key.startsWith('batch:')) return [document.documentElement];
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
    visit.knownRequired = null;
    visit.lastReviews = null;
    visit.checksExpanded = false;
    visit.autoLoads = 0;
    eagerFragments = 0;
    requestedUrls = new Set();
    visit.manualDone = new Set();
    checksSectionEl = null;
    mergeHomeEl = null;
    resetAiForVisit();
  }
  lastSettings = settings;
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
  const comments = reviewEntries(crawledDom, reviews, meta, settings);
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
  // Rounds: what landed between two pushes. Bot run summaries belong to their round rather than to rows of their own.
  const commitRoots = leftoverList.filter((entry) => entry.kind === 'commit').map((entry) => entry.root);
  const batches = buildBatches(meta, crawledDom, settings, commitRoots);
  const batchedAnchors = new Set(batches.flatMap((batch) => batch.comments.map((entry) => entry.anchor)));
  for (const [index, group] of groups.entries()) {
    if (!group.key.startsWith('bot:')) continue;
    if (!group.nodes.every((node) => [...batchedAnchors].some((anchor) => node.id === anchor || node.contains(document.getElementById(anchor))))) continue;
    const silent = { ...group, silent: true };
    groups[index] = silent;
    const target = foldTargets.indexOf(group);
    if (target >= 0) foldTargets[target] = silent;
  }
  // A permalink (or a find-in-page hit) opens its row here rather than revealing the original down the page.
  if (visit.pendingAnchor !== null && hidingTimeline) {
    const key = rowKeyFor(visit.pendingAnchor, meta, groups);
    if (key !== null) openRow(key, batches);
  }
  const fixFor = (item: ReviewItem): SuggestedFix | null => (fixVisible(item.fix, settings.suggestedFixes) ? item.fix : null);
  // An item lives inside its round's row: opening it opens the round and the item within.
  const openRowLocal = (key: string): void => openRow(key, batches);
  const subject = subjectOf();
  const boxText = mergeBoxText();
  const ringSource = checksSection()?.querySelector('svg[viewBox="0 0 100 100"]') ?? null;
  const checksRing = ringSource instanceof SVGElement ? cloneRing(ringSource) : null;
  entryNodes = new Map(reviews.filter((review) => review.comment !== null).map((review) => [review.anchor, review.comment ?? review.root]));
  const stated = /at least\s+(\d+)\s+approving review/i.exec(boxText)?.[1];
  if (stated !== undefined) visit.knownRequired = Number.parseInt(stated, 10);
  const reviewers = [...latestReviewers(reviews)];
  for (const record of meta.reviewers) if (!reviewers.some((entry) => entry.login === record.login)) reviewers.push(record);
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
    batches,
    requestable,
    summaryAnchorFor: (botId) => meta.bots.find((bot) => bot.id === botId)?.sourceId ?? null,
    botIconFor: (botId) => iconByBot.get(botId) ?? avatarSrcFor(meta.bots.find((bot) => bot.id === botId)?.sourceId ?? ''),
    checks: checkCountsFrom(checksSectionText() ?? boxText),
    checksRing,
    comments,
    openSubKey: visit.openSubKey,
    running: meta.bots.some((bot) => bot.verdict === 'running'),
    reviews: (visit.lastReviews = requiredReviewsFrom(boxText, reviewers, { knownRequired: visit.knownRequired }) ?? visit.lastReviews),
    myReactionFor: (anchor) => myReactionOn(anchor),
    timeFor: (anchor) => timeTextOf(document.getElementById(anchor)),
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
      openRowLocal(itemKey(id));
      reapply();
      revealThreadFor(anchor);
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
    onResolveAnchor: (anchor) => {
      clickResolve(anchor);
    },
    onReact: (anchor) => {
      // Open whatever row holds the comment, then GitHub's own picker inside it.
      const sub = comments.find((entry) => entry.anchor === anchor && entry.hasBody);
      if (sub !== undefined && (visit.openKey === REVIEWS_KEY || rowKeyFor(anchor, meta, groups) === null)) {
        visit.openKey = REVIEWS_KEY;
        visit.openSubKey = anchor;
      } else {
        const key = rowKeyFor(anchor, meta, groups);
        if (key === null) return;
        openRowLocal(key);
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
      // Held by a row here? Open it. Otherwise let the browser take the reader to it in the timeline.
      const key = hidingTimeline ? rowKeyFor(anchor, meta, groups) : null;
      if (key === null) {
        location.hash = anchor;
        return;
      }
      openRowLocal(key);
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
      if (visit.openKey === REVIEWS_KEY) {
        const nested = renderCommentsList(mounted.slot, model, panelHandlers);
        const subNode = visit.openSubKey === null ? null : (entryNodes.get(visit.openSubKey) ?? timelineRootOf(visit.openSubKey));
        if (nested !== null && subNode !== null) {
          renderQuickView(nested, [subNode]);
        } else if (visit.openSubKey !== null && subNode === null) {
          visit.openSubKey = null;
        }
      } else if (visit.openKey.startsWith('batch:')) {
        const batch = batches.find((entry) => entry.key === visit.openKey);
        if (batch !== undefined) {
          const view = renderBatchView(mounted.slot, batch, model, panelHandlers);
          const commentNode = view.openComment === null ? null : timelineRootOf(view.openComment);
          if (view.nested !== null && commentNode !== null) {
            renderQuickView(view.nested, [commentNode]);
          } else if (view.nested !== null && view.openItem !== null) {
            const item = view.openItem;
            renderThreadsView(view.nested, itemNodes(item), {
              pathOf: (node) => threadPathOf(node, item),
              onCopy: (text) => void copyText(text),
              onReply: (node) => {
                const anchor = node.querySelector('[id^="discussion_r"], [id^="issuecomment-"]')?.id ?? null;
                if (anchor !== null) focusReply(anchor);
              },
            });
          } else if (visit.openSubKey !== null && view.openItem === null && commentNode === null) {
            visit.openSubKey = null;
          }
        }
      } else if (visit.openKey === CHECKS_KEY) {
        renderQuickView(mounted.slot, nodes);
      } else if (visit.openKey === foldKey('mentions')) {
        renderMentionsView(mounted.slot, nodes, outgoingMentions(document.querySelector('[data-geld-attached] .comment-body, [data-geld-attached] .markdown-body, [data-geld-attached] [data-testid="markdown-body"]')));
      } else if (visit.openKey.startsWith('item:')) {
        // Each review thread in its own frame: path with a copy button, the first comment, and a bar that
        // reveals the rest of the thread and the reply box.
        const item = meta.items.find((entry) => itemKey(entry.id) === visit.openKey);
        renderThreadsView(mounted.slot, nodes, {
          pathOf: (node) => threadPathOf(node, item),
          onCopy: (text) => void copyText(text),
          onReply: (node) => {
            const anchor = node.querySelector('[id^="discussion_r"], [id^="issuecomment-"]')?.id ?? null;
            if (anchor !== null) focusReply(anchor);
          },
        });
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
  }
  setHoverProvider((row) => hoverPreviewFor(row, meta, groups, panelHandlers));
  setWhoProvider((login) => whoCardFor(login, meta, model));
  applyFolds(foldTargets, new Set());
  // The browser's fragment jump went to the original's (now empty) place in
  // the timeline; the one correction Geld makes is to land on the row that
  // holds it, once, instantly.
  const pendingKey = visit.pendingAnchor === null ? null : rowKeyFor(visit.pendingAnchor, meta, groups);
  if (visit.pendingAnchor !== null && mounted !== null && ((pendingKey !== null && (visit.openKey === pendingKey || visit.openSubKey === pendingKey)) || visit.loadMoreTries >= MAX_LOAD_MORE)) {
    const row = visit.openKey === null ? null : mounted.root.querySelector(`[data-geld-focus="main:${visit.openSubKey ?? visit.openKey}"]`);
    if (row instanceof HTMLElement && hidingTimeline) row.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (row !== null || document.getElementById(visit.pendingAnchor) !== null || visit.loadMoreTries >= MAX_LOAD_MORE) visit.pendingAnchor = null;
  }
  collapseDescription(settings.compactTimeline === 'minimal' && settings.collapseDescription && !visit.fullTimeline);
  setFullTimeline(visit.fullTimeline);
  if (hidingTimeline) document.documentElement.setAttribute('data-geld-timeline', 'compact');

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
  setWhoProvider(null);
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
