/**
 * The review panel grows out of the bottom of the pull request description:
 * same border, the description's bottom corners squared off, the panel's
 * top ones too. Inside, it borrows the merge box's checks list — a heading
 * per group ("2 open items ⌄"), then one line per item: status icon,
 * poster avatar, bold title, muted detail, and on the right view / reply /
 * a ⋯ menu. Rows are an accordion (one open at a time); the open row's
 * slot shows the slim quick view (quick-view.ts). The Geld summary comment
 * itself is hidden — its content is this.
 */

import type { BotVerdictRecord, CommentLane, GeldPrMeta, Preview, Report, ReportPart, ReviewItem } from '@geld/review';
import { previewHostById, reportsHealth } from '@geld/review';
import { botTitle, doneItemCount, isOpenStatus, resolveBotId } from '@geld/review';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import type { RevisionMarker } from './crawler';
import { ICON_ALERT, ICON_CHECK_CIRCLE_FILL, ICON_FILE_DIFF, ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT, ICON_CIRCLE, ICON_COMMENT, ICON_COMMENT_DISCUSSION, ICON_COPY, ICON_CROSS_REFERENCE, ICON_DOT_FILL, ICON_GIT_COMMIT, ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_HISTORY, ICON_IN_PROGRESS, ICON_KEBAB_HORIZONTAL, ICON_LINK_EXTERNAL, ICON_LIST_FILTER, ICON_REPO_PUSH, ICON_REPORT, ICON_ROCKET, ICON_SKIP, ICON_SPARKLE_FILL, ICON_SYNC, ICON_X_CIRCLE_FILL } from '../ui/icons';
import { authorLabels, botDetail, botHealth, checksHealth, checksSummary, checksTone, checksTotal, isCurrent, reviewsHealth, reviewsLabel, splitItems, statusBadge, toneOf, verdictLabel } from './panel-model';
import type { CheckCounts, Health, InstalledBot, RequiredReviews, Tone } from './panel-model';
import type { SuggestedFix } from '@geld/review';
import type { AiState } from './ai';
import { formatSyncAge } from '../../ui/sync-age';
import type { Closure, ClosureKind, EventHeadline } from './fold';
import { headlineText } from './fold';
import { reclaimOrphans, restoreAll } from './teleport';
import { ATTR_REPORT, ATTR_WHO, rehostHoverCard } from './hovercard';
import type { ReviewerCandidate } from './reviewers';
import { shapeMark } from './mark-shape';
import { inlineText } from './inline-text';

export const PANEL_CLASS = 'geld-review';
export const ATTR_PANEL = 'data-geld-review-panel';
/** On the description card the panel is attached to (squares its bottom corners). */
export const ATTR_ATTACHED = 'data-geld-attached';
const ATTR_SIG = 'data-geld-review-sig';
const ATTR_SLOT = 'data-geld-slot';
/**
 * On a time cell: the anchor whose `relative-time` it repeats, so the cells
 * can be refreshed on their own when the clocks tick (`refreshReviewTimes`)
 * without a crawl or a render.
 */
export const ATTR_TIME_FOR = 'data-geld-time-for';

/**
 * A row of pills that gives way in two steps when the row is short of room
 * (`fit-chips.ts`): first every pill's name (the mark says who), then its
 * detail (the light says how it went). The bots row and the reports row;
 * the previews row keeps its names, which are the deployments' and say what
 * the mark cannot.
 */
export const ATTR_FIT = 'data-geld-fit';

/** The mounted panel's render signature (what `mountPanel` compared last), or '' without a panel: for the harness's scope check. */
export function panelSignature(): string {
  return document.querySelector(`[${ATTR_SIG}]`)?.getAttribute(ATTR_SIG) ?? '';
}

/** A row's time cell for `anchor`, or null when the page shows no time for it. */
function timeCell(model: PanelModel, anchor: string): HTMLElement | null {
  const time = model.timeFor(anchor);
  return time === '' ? null : createElement('span', { class: `${PANEL_CLASS}__time`, [ATTR_TIME_FOR]: anchor }, [time]);
}

export type GroupId = 'open' | 'done' | 'hidden' | 'activity' | 'pushes';

export interface FoldRow {
  readonly key: string;
  readonly label: string;
  /** Comments section (bot comments, review requests) or the activity section (commits, mentions, events). */
  readonly section: 'comments' | 'activity';
  readonly count: number;
  readonly avatarSrc: string | null;
  /** Login of the one account whose comments the fold holds, when it is one account's. */
  readonly author: string | null;
  readonly firstAnchor: string | null;
  /** When the fold holds one comment: its time, as the page shows it. */
  readonly time: string;
  /** The id whose clock `time` was read from (the headline event's, else the first node's), so the cell can follow the clock's ticks. */
  readonly timeAnchor: string | null;
  /** The timeline events' state change (fold.ts `EventHeadline`): the row reads "merged into main" with who did it. */
  readonly headline?: EventHeadline;
  /** A state change paired with its comment (fold.ts `Closure`): the row reads "X closed this" with the comment's first line. */
  readonly closure?: Closure;
}


export interface Avatar {
  readonly src: string;
  readonly bot: boolean;
  /** The account's login (`cursor[bot]` for an App); '' when the page did not say. */
  readonly login: string;
}

/**
 * A review round: everything the bots (and reviewers) posted between two
 * pushes — their run summaries and the threads they opened. The reader
 * works round by round; a round is done when every thread in it is.
 */
export interface Batch {
  readonly key: string;
  /** 1-based, in timeline order. */
  readonly index: number;
  readonly avatars: readonly Avatar[];
  /** Who posted: bot names, then people. */
  readonly names: readonly string[];
  readonly items: readonly ReviewItem[];
  /** Run summaries and other top-level comments in the round, as lines for its list. */
  readonly comments: readonly ReviewEntry[];
  /** People's verdicts and top-level comments that landed in the round. */
  readonly reviews: readonly ReviewEntry[];
  /** The commit rows and force-push events of the push(es) that opened the round, in timeline order; empty for content before any push. */
  readonly commits: readonly HTMLElement[];
  /** How many of `commits` are commit rows (the rest are force-push events). */
  readonly commitCount: number;
  /** CI as GitHub draws it beside the round's last commit; null when the page shows none. */
  readonly ciGlyph: 'success' | 'failure' | 'pending' | null;
  /** Who committed in the push, as GitHub draws them beside the commits (its `avatar-user` class decides the shape). */
  readonly committers: readonly Avatar[];
  /** Preview deployments announced in the round. */
  readonly previews: readonly Preview[];
  readonly time: string;
  readonly firstAnchor: string | null;
}

/**
 * Row key of a round, from what identifies it on the page rather than from
 * its position: the timeline streams in for seconds after the panel first
 * renders, and a "Load more" that brings commit rows between existing
 * content renumbers every round after them. A positional key then named a
 * different round, and the one the reader had open closed under them.
 */
export function batchKey(id: string): string {
  return `batch:${id}`;
}

/** `awaiting`: a reviewer GitHub is still waiting on (the sidebar's "Awaiting requested review from X"); a line with nothing to open. */
export type ReviewEntryState = 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'thread' | 'comment' | 'awaiting';

/** One line under the Reviews row: a review verdict, a review thread, a person's top-level comment or a pending request. */
export interface ReviewEntry {
  readonly anchor: string;
  readonly author: string;
  readonly avatarSrc: string | null;
  readonly state: ReviewEntryState;
  /** The comment's first line; empty for a bare verdict. */
  readonly preview: string;
  readonly time: string;
  /** Whether there is a comment to open under the line. */
  readonly hasBody: boolean;
  /** A review thread: GitHub can resolve it. */
  readonly done: boolean;
  /** Replies in the thread beyond the first comment. */
  readonly replies: number;
  /** The emoji the signed-in user reacted with, when they did. */
  readonly myReaction: string | null;
  /** What kind of comment Jev judged this to be, when it was asked. */
  readonly lane?: CommentLane;
  /** A review thread posted as part of a person's review: that review's anchor. The line is listed under it. */
  readonly parent?: string;
  /** A review verdict's threads, or a bot run summary's findings in its round. The line counts them; each is a row of its own in the round. */
  readonly threads?: readonly ReviewThreadRef[];
}

/** One of a review's threads, for the count on its line. */
export interface ReviewThreadRef {
  readonly anchor: string;
  readonly done: boolean;
}

/** A check row's avatar: GitHub rounds a user's or an OAuth App's, squares a GitHub App's or an organisation's. */
export interface CheckAvatar {
  readonly src: string;
  readonly round: boolean;
}

/** A verdict line made from the sidebar before the timeline showed the review (`sidebar:<login>`): a fact with no row behind it yet. */
export function isProvisional(entry: ReviewEntry): boolean {
  return entry.anchor.startsWith('sidebar:');
}

/** A person's verdict on the changes (not a thread, a plain comment or a pending request). */
export function isVerdict(entry: ReviewEntry): boolean {
  return entry.state === 'approved' || entry.state === 'changes_requested' || entry.state === 'commented' || entry.state === 'dismissed';
}

/**
 * Whether the line opens: only on a comment of its own, as a one-bubble
 * chat. A verdict without words is a line with a glyph and, when it came
 * with threads, a count of them: the threads are rows of their own in the
 * same round, so nothing here repeats them.
 */
export function entryOpens(entry: ReviewEntry): boolean {
  return entry.hasBody;
}

/** The reviewers on the Reviews row's heading, one group per state, in the order the groups are shown. */
export type ReviewerGroupState = 'approved' | 'changes_requested' | 'commented' | 'awaiting';

export interface ReviewerGroup {
  readonly state: ReviewerGroupState;
  readonly reviewers: readonly Avatar[];
}

/** What the sidebar's Reviewers block says of one reviewer (crawler.ts's `SidebarReviewer`, as the heading needs it). */
export interface SidebarVerdict {
  readonly login: string;
  readonly avatarSrc: string | null;
  readonly state: ReviewerGroupState | 'dismissed';
  readonly bot: boolean;
}

/**
 * Each reviewer once, by their latest verdict: a later comment-only review
 * does not withdraw an approval or a request for changes (as GitHub counts
 * them), a re-request puts them back among the awaited. People's top-level
 * comments are not reviews and stay off the heading. The sidebar's word on a
 * reviewer is final — it is GitHub's own latest-per-reviewer, there from the
 * first paint, while the timeline's reviews are still being fetched — and
 * the timeline only adds reviewers the sidebar does not list.
 */
export function reviewerGroups(entries: readonly ReviewEntry[], sidebar: readonly SidebarVerdict[] = []): readonly ReviewerGroup[] {
  const statuses = reviewerStatuses(entries, sidebar);
  const order: readonly Exclude<ReviewerGroupState, 'awaiting'>[] = ['approved', 'changes_requested', 'commented'];
  const groups: ReviewerGroup[] = order.flatMap((state) => {
    const reviewers = statuses.filter((status) => status.verdict === state).map((status) => status.avatar);
    return reviewers.length === 0 ? [] : [{ state, reviewers }];
  });
  const awaited = statuses.filter((status) => status.awaiting).map((status) => status.avatar);
  if (awaited.length > 0) groups.push({ state: 'awaiting', reviewers: awaited });
  return groups;
}

/** One person's standing with the pull request: the verdict they gave, if any, and whether GitHub awaits them. */
export interface ReviewerStatus {
  readonly login: string;
  readonly avatar: Avatar;
  readonly verdict: Exclude<ReviewerGroupState, 'awaiting'> | null;
  readonly awaiting: boolean;
  /** The timeline's anchor for the verdict, when the page has it (a sidebar-only verdict has none yet). */
  readonly anchor: string | null;
}

/**
 * Every person once, in the order they first appear (the sidebar's first):
 * the verdict they gave and whether they are awaited. A pending request is a
 * fact beside any verdict, not instead of it — a reviewer who approved and
 * was asked again still counts as approving (GitHub's merge box: "1
 * approval, 1 pending review") while the sidebar names only the request, so
 * the timeline supplies their verdict. The sidebar's stated verdict is final;
 * a comment-only review sets no verdict aside; GitHub's dismissal leaves none.
 */
export function reviewerStatuses(entries: readonly ReviewEntry[], sidebar: readonly SidebarVerdict[] = []): readonly ReviewerStatus[] {
  const byLogin = new Map<string, { login: string; avatar: Avatar; verdict: Exclude<ReviewerGroupState, 'awaiting'> | null; awaiting: boolean; anchor: string | null; settled: boolean }>();
  const slot = (login: string, avatarSrc: string | null): NonNullable<ReturnType<typeof byLogin.get>> => {
    const key = login.toLowerCase();
    let record = byLogin.get(key);
    if (record === undefined) {
      record = { login, avatar: { src: avatarSrc ?? '', bot: false, login }, verdict: null, awaiting: false, anchor: null, settled: false };
      byLogin.set(key, record);
    } else if (record.avatar.src === '' && avatarSrc !== null && avatarSrc !== '') {
      record.avatar = { ...record.avatar, src: avatarSrc };
    }
    return record;
  };
  for (const reviewer of sidebar) {
    if (reviewer.bot) continue;
    const record = slot(reviewer.login, reviewer.avatarSrc);
    if (reviewer.state === 'awaiting') {
      record.awaiting = true;
      continue;
    }
    record.settled = true;
    if (reviewer.state !== 'dismissed') record.verdict = reviewer.state;
  }
  for (const entry of entries) {
    if (entry.state === 'thread' || entry.state === 'comment' || entry.state === 'dismissed') continue;
    const record = slot(entry.author, entry.avatarSrc);
    if (entry.state === 'awaiting') {
      record.awaiting = true;
      continue;
    }
    if (record.settled) {
      // The sidebar said the verdict; the timeline still names where it is.
      if (record.verdict === entry.state && record.anchor === null && !isProvisionalAnchor(entry.anchor)) record.anchor = entry.anchor;
      continue;
    }
    if (entry.state === 'commented' && record.verdict !== null && record.verdict !== 'commented') continue;
    record.verdict = entry.state;
    record.anchor = isProvisionalAnchor(entry.anchor) ? null : entry.anchor;
  }
  return [...byLogin.values()].map(({ login, avatar, verdict, awaiting, anchor }) => ({ login, avatar, verdict, awaiting, anchor }));
}

/** A line made from the sidebar alone (overview.ts `sidebarEntry`) carries no timeline anchor. */
function isProvisionalAnchor(anchor: string): boolean {
  return anchor.startsWith('sidebar:') || anchor.startsWith('awaiting:');
}

export interface PanelModel {
  readonly meta: GeldPrMeta;
  readonly freshness: 'fresh' | 'stale' | 'partial' | 'local';
  readonly truncated: boolean;
  /** GitHub's "New changes since you last viewed" marker, when the timeline has one: the summary strip links to that diff. */
  readonly sinceLastVisit: RevisionMarker | null;
  /** `item:<id>` or `fold:<key>`; at most one row is open. */
  readonly openKey: string | null;
  readonly collapsedGroups: ReadonlySet<GroupId>;
  readonly fullTimeline: boolean;
  readonly compacting: boolean;
  readonly nudge: boolean;
  readonly viewingAnchor: string | null;
  readonly folds: readonly FoldRow[];
  readonly batches: readonly Batch[];
  readonly requestable: readonly InstalledBot[];
  /** Bot run summaries (verdict comments) an open item can link to, by bot id. */
  readonly summaryAnchorFor: (botId: string) => string | null;
  /** What this bot's chip opens: its own source, or — while it runs (its source is then the shared trigger line) — its latest real summary, else nothing. */
  readonly botOpenAnchor: (bot: BotVerdictRecord) => string | null;
  /** The page's icon for a bot (from its `/apps/` link or comments). */
  readonly botIconFor: (botId: string) => string | null;
  /** CI checks as the merge box reports them; null when the page has no checks section. */
  readonly checks: CheckCounts | null;
  /** Whether a failing check is one GitHub marks Required; null when the list does not say. */
  readonly requiredFailing: boolean | null;
  /** Preview deployments: the latest per project, and the ones they superseded. */
  readonly previews: { readonly latest: readonly Preview[]; readonly archived: readonly Preview[] };
  /** Reporter bots' reports (test failures, coverage): the latest per reporter, the earlier ones left in their rounds. */
  readonly reports: { readonly latest: readonly Report[]; readonly archived: readonly Report[] };
  /** Whether the archived previews are unfolded inside the Previews row. */
  readonly archivedPreviewsOpen: boolean;
  /** How the main list is arranged (`reviewGrouping`). */
  readonly grouping: 'type' | 'batch';
  /** Rounds whose commit rows are unfolded (batch grouping). */
  readonly openCommits: ReadonlySet<string>;
  /** Rounds whose Previews line is unfolded into the per-preview list. */
  readonly openPreviews: ReadonlySet<string>;
  /** Where the in-browser AI stands for this pull request: the control in the Geld row and its notices. */
  readonly ai: AiState;
  /** The avatar GitHub shows beside the check named `name` in the merge box (the service's mark) and its shape, or null. */
  readonly checkAvatarFor: (reporterId: string, name: string) => CheckAvatar | null;
  /** The page's avatar for the bot that posted the comment at `anchor` (the host's mark). */
  readonly avatarForAnchor: (anchor: string) => string | null;
  /** GitHub's own status ring from the merge box, cloned, when it has one. */
  readonly checksRing: SVGElement | null;
  readonly reviews: RequiredReviews | null;
  /** Review verdicts, threads and people's comments, in timeline order, for the Reviews row's list. */
  readonly comments: readonly ReviewEntry[];
  /** The Reviews row's heading: each reviewer once, by latest verdict, the sidebar's word first (`reviewerGroups`). */
  readonly reviewerGroups: readonly ReviewerGroup[];
  /** Each person's standing, for the Reviews row's request menu (`reviewerStatuses`). */
  readonly reviewerStatuses: readonly ReviewerStatus[];
  /** Whether the page lets the reader ask for reviews (GitHub's own form is there). */
  readonly canRequestReviewers: boolean;
  /** Whether GitHub's merge box offers its review actions here (dismiss, re-request): an open pull request the reader can act on. */
  readonly canDismissReviews: boolean;
  /**
   * The timeline is still being read (fragments on their way, a "Load more"
   * still to press): the heading is complete — it comes from the sidebar —
   * but the lines and the comment count are not yet, and the row says so.
   */
  readonly ingesting: boolean;
  /** Anchor of the comment open inside the Reviews row's list (one level of nesting). */
  readonly openSubKey: string | null;
  /** Threads (by first-comment anchor) whose frame shows the comment they came from. */
  readonly openSources: ReadonlySet<string>;
  /** Bumps when a looked-up issue/PR title lands, so the mentions view is rebuilt with it. */
  readonly refsVersion: number;
  /** Bumps when a comment's edit history or an old revision lands, so an open chat's pinned source is rebuilt with it. */
  readonly editsVersion: number;
  /** A review bot is still running: the re-run control spins. */
  readonly running: boolean;
  /** Avatars (up to two) for a row, read from the source comments on the page. */
  readonly avatarsFor: (item: ReviewItem) => readonly Avatar[];
  /** Timeline nodes hidden by compaction (for the "show full timeline" row). */
  readonly hiddenCount: number;
  /** Item ids (and `tldr`) the model is working on: those rows shimmer. */
  readonly aiPending: ReadonlySet<string>;
  /** The suggested fix to show for an item under the user's preference, if any. */
  readonly fixFor: (item: ReviewItem) => SuggestedFix | null;
  /** The signed-in user's reaction on the comment at `anchor`, read from the page. */
  readonly myReactionFor: (anchor: string) => string | null;
  /** The comment's time as the page shows it ("yesterday"). */
  readonly timeFor: (anchor: string) => string;
  /** Whether GitHub offers Resolve for this item's thread (else the ⋯ menu says "Mark done"). */
  readonly resolvable: (item: ReviewItem) => boolean;
}

export interface PanelHandlers {
  readonly onToggle: (key: string) => void;
  readonly onToggleGroup: (group: GroupId) => void;
  readonly onStatus: (itemId: string, done: boolean) => void;
  readonly onReply: (itemId: string) => void;
  /** GitHub's own "Quote reply" on the item's first comment. */
  readonly onQuoteReply: (itemId: string) => void;
  readonly onCopy: () => void;
  readonly onCopyLink: (anchor: string) => void;
  readonly onCopyItem: (itemId: string) => void;
  readonly onCopyFix: (itemId: string) => void;
  readonly onFullTimeline: () => void;
  /** Post the trigger comment of each bot, in order. */
  readonly onRequest: (botIds: readonly string[]) => void;
  /** The Request a review menu closed: the panel may have held back a rebuild while it was open. */
  readonly onRequestMenuClosed: () => void;
  /** Everyone who can be asked to review, as GitHub's own menu lists them (fetched when the people menu first needs it). */
  readonly loadReviewerCandidates: () => Promise<readonly ReviewerCandidate[] | null>;
  /** Ask these people (user ids) and teams (team ids) to review; someone who reviewed is asked again. */
  readonly onRequestReviewers: (userIds: readonly number[], teamIds: readonly number[]) => void;
  /** Open GitHub's dismiss dialog for `login`'s review. */
  readonly onDismissReview: (login: string) => void;
  /** Ask `login` to review again. */
  readonly onReRequestReview: (login: string) => void;
  /** Show the comment at `anchor` where the reader is: inside compact view when it is folded there, else in the timeline. */
  readonly onOpenAnchor: (anchor: string) => void;
  /** Leave compact view for the full timeline and jump to `anchor` there. */
  readonly onShowInTimeline: (anchor: string) => void;
  /** Open or close a comment inside the Reviews row's list. */
  readonly onToggleSub: (anchor: string) => void;
  /** Unfold or fold the archived previews. */
  readonly onToggleArchivedPreviews: () => void;
  /** Unfold or fold a round's commit rows (batch grouping). */
  readonly onToggleCommits: (batchKey: string) => void;
  readonly onTogglePreviews: (batchKey: string) => void;
  /** Open the Reports row to the report at `anchor` (its comment opens under its line); the pill of the report already open closes it. */
  readonly onOpenReport: (anchor: string) => void;
  /** Change how the list is grouped (persisted as the `reviewGrouping` setting). */
  readonly onGrouping: (grouping: 'type' | 'batch') => void;
  /** Resolve/unresolve the thread holding `anchor` (GitHub's own button). */
  readonly onResolveAnchor: (anchor: string, done: boolean) => void;
  /** Open the row holding `anchor` and GitHub's reaction picker for its first comment. */
  readonly onReact: (anchor: string) => void;
  /** Run the model for this pull request now (the AI control). */
  readonly onRunAi: () => void;
  /** Forget this device's run: the repository's Action writes the digest with AI now. */
  readonly onClearAi: () => void;
}

export function itemKey(id: string): string {
  return `item:${id}`;
}

export function foldKey(key: string): string {
  return `fold:${key}`;
}

/** Row key for the CI checks row; its slot shows GitHub's own checks section. */
export const CHECKS_KEY = 'checks';
/** Row key for the Reviews row; its slot lists people's comments. */
export const REVIEWS_KEY = 'reviews';
/** Row key for the Previews row; its slot lists every preview deployment. */
export const PREVIEWS_KEY = 'previews';
/** Row key for the Reports row; its slot lists the reporter bots' latest reports, each opening in place. */
export const REPORTS_KEY = 'reports';
/** The Reports row's label, long and short. */
export const REPORTS_LABEL: readonly [string, string] = ['Reports', 'Reports'];
const NUDGE_CLASS = 'geld-review-nudge';

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

/**
 * The panel is rebuilt as the page streams in, and a freshly mounted spinner
 * would start its turn from the top - the reader sees the CI spinner jump
 * back. Pinning every spin animation's start to the document timeline's
 * origin puts each mount at the phase one continuous spinner would be at,
 * whenever the browser gets to its first frame.
 */
export function syncSpinners(root: Element): void {
  // GitHub's own spinners in the check rows on loan too: a Primer spinner starts at a fixed negative delay, so one
  // remounted on every status poll showed the same frame each time and read as frozen. Pinned to the document
  // timeline, a remount continues the turn where the last one left off.
  for (const spinner of root.querySelectorAll(`.octicon-in-progress, .${PANEL_CLASS}__icon--spin .octicon, [class*="Spinner-SpinnerAnimation"]`)) {
    for (const animation of spinner.getAnimations()) animation.startTime = 0;
  }
}

function iconButton(markup: string, label: string, extra: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  return createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon`, 'aria-label': label, title: label, ...extra }, [icon(markup)]);
}

/**
 * The panel is rebuilt on every change, so the control the user just used
 * is a new element. Each focusable control carries a stable key; after a
 * rebuild focus returns to the same key (without scrolling). Besides being
 * right for keyboard users, the focused element is the browser's preferred
 * scroll anchor, which keeps the row under the pointer put while the
 * content that opened under it settles.
 */
const ATTR_FOCUS = 'data-geld-focus';
/** Marks the span in an open row that receives the comment's header. */
export const ATTR_HEAD_SLOT = 'data-geld-head-slot';
/** Marks the span in the open CI row that receives GitHub's checks-settings gear. */
export const ATTR_GEAR_SLOT = 'data-geld-gear-slot';
/** Marks the span in a row that receives the comment's own reaction trigger and ⋯ menu, open or closed. */
export const ATTR_CTL_SLOT = 'data-geld-ctl';

/** Where GitHub's own per-comment controls (reaction trigger, ⋯) sit in a row, whether it is open or not. */
/** Where a comment's own ⋯ is worn once found. `held`: the square is kept while empty, so the time beside it does not move. */
function controlSlot(anchor: string, held = false): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__ctl-slot${held ? ` ${PANEL_CLASS}__ctl-slot--held` : ''}`, [ATTR_CTL_SLOT]: anchor });
}

function focusKeyOf(root: Element | null): string | null {
  if (root === null) return null;
  const active = document.activeElement;
  if (!(active instanceof Element) || !root.contains(active)) return null;
  return active.closest(`[${ATTR_FOCUS}]`)?.getAttribute(ATTR_FOCUS) ?? null;
}

function restoreFocus(root: Element, key: string | null): void {
  if (key === null) return;
  const target = root.querySelector<HTMLElement>(`[${ATTR_FOCUS}="${key}"]`);
  target?.focus({ preventScroll: true });
}

/**
 * A person's avatar carries GitHub's own hovercard attributes (its script
 * picks them up on any element, `img` included); a bot's carries Geld's
 * identity-card hook, since GitHub has no hovercard for Apps.
 */
function whoAttributes(login: string, bot: boolean): Readonly<Record<string, string>> {
  if (login === '') return {};
  // Only an App (`…[bot]`) lacks GitHub's card; a bot-like person's account has one.
  if (bot && /\[bot\]$/i.test(login)) return { [ATTR_WHO]: login };
  return { 'data-hovercard-type': 'user', 'data-hovercard-url': `/users/${encodeURIComponent(login)}/hovercard` };
}

function avatarImg(entry: Avatar): HTMLElement {
  return createElement('img', { class: `${PANEL_CLASS}__avatar`, 'data-kind': entry.bot ? 'bot' : 'user', src: entry.src, alt: '', width: '20', height: '20', loading: 'lazy', ...whoAttributes(entry.login, entry.bot) });
}

/** Bots and Apps are rounded squares on GitHub, people are circles; the same pictures the page shows. */
function avatarStack(avatars: readonly Avatar[], fallback: string, bot: boolean, max = 2): HTMLElement {
  const stack = createElement('span', { class: `${PANEL_CLASS}__avatars`, 'aria-hidden': 'true' });
  if (avatars.length === 0) {
    stack.append(createElement('span', { class: `${PANEL_CLASS}__avatar ${PANEL_CLASS}__avatar--letter`, 'data-kind': bot ? 'bot' : 'user' }, [fallback.charAt(0).toUpperCase() || '?']));
    return stack;
  }
  for (const entry of avatars.slice(0, max)) stack.append(avatarImg(entry));
  return stack;
}

/** The row's chevron. A real button so a click on it opens the row; `tabindex=-1` because the main button is the keyboard stop. */
function chevron(open: boolean, onToggle: () => void): HTMLElement {
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__chevron`, 'data-open': String(open), tabindex: '-1', 'aria-label': open ? 'Collapse' : 'Expand', 'aria-expanded': String(open) }, [icon(ICON_CHEVRON_DOWN)]);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle();
  });
  return button;
}

/**
 * A pointer row's chevron points right: the row does not open here, it
 * takes the reader to the one place where its conversation opens (a thread
 * inside a push goes to its Needs attention row, a review in the Reviews
 * index to its round).
 */
function pointerChevron(onGo: () => void): HTMLElement {
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__chevron ${PANEL_CLASS}__chevron--pointer`, tabindex: '-1', 'aria-label': 'Open where it lives' }, [icon(ICON_CHEVRON_RIGHT)]);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onGo();
  });
  return button;
}


/** The check counts with their own state glyphs: "✕ 1 failing · ✓ 8 successful · ⊘ 3 skipped". */
function checksBreakdown(counts: CheckCounts): HTMLElement {
  const parts: ReadonlyArray<{ readonly count: number; readonly label: string; readonly state: string; readonly glyph: string }> = [
    { count: counts.failure, label: 'failing', state: 'failure', glyph: ICON_X_CIRCLE_FILL },
    { count: counts.queued, label: 'pending', state: 'queued', glyph: ICON_DOT_FILL },
    { count: counts.pending, label: 'in progress', state: 'pending', glyph: ICON_IN_PROGRESS },
    { count: counts.success, label: 'successful', state: 'success', glyph: ICON_CHECK_CIRCLE_FILL },
    { count: counts.skipped, label: 'skipped', state: 'skipped', glyph: ICON_SKIP },
    { count: counts.neutral, label: 'neutral', state: 'neutral', glyph: ICON_CIRCLE },
  ];
  const detail = createElement('span', { class: `${PANEL_CLASS}__detail ${PANEL_CLASS}__checks-breakdown` });
  for (const part of parts) {
    if (part.count === 0) continue;
    detail.append(createElement('span', { class: `${PANEL_CLASS}__check-part`, 'data-state': part.state }, [icon(part.glyph), String(part.count), createElement('span', { class: `${PANEL_CLASS}__check-label` }, [` ${part.label}`])]));
  }
  return detail;
}

function statusIcon(item: ReviewItem): SVGElement {
  if (!isOpenStatus(item.status)) return icon(ICON_CHECK_CIRCLE_FILL);
  if (item.status === 'needs-reply') return icon(ICON_DOT_FILL);
  return icon(ICON_CIRCLE);
}

interface MenuEntry {
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
}

let menusInstalled = false;

/** A click anywhere outside an open ⋯ / ⟳ menu closes it, like GitHub's own menus. */
function installMenuDismissal(): void {
  if (menusInstalled) return;
  menusInstalled = true;
  document.addEventListener(
    'mousedown',
    (event) => {
      for (const open of document.querySelectorAll<HTMLDetailsElement>(`.${PANEL_CLASS}__menu[open]`)) {
        if (!(event.target instanceof Node) || !open.contains(event.target)) open.removeAttribute('open');
      }
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const open of document.querySelectorAll<HTMLDetailsElement>(`.${PANEL_CLASS}__menu[open]`)) open.removeAttribute('open');
  });
}

function menu(entries: readonly MenuEntry[], focusKey: string): HTMLElement {
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'More actions', title: 'More actions', role: 'button', [ATTR_FOCUS]: `menu:${focusKey}` }, [icon(ICON_KEBAB_HORIZONTAL)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list`, role: 'menu' });
  for (const entry of entries) {
    const node =
      entry.href !== undefined
        ? createElement('a', { class: `${PANEL_CLASS}__menu-item`, role: 'menuitem', href: entry.href }, [entry.label])
        : createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item`, role: 'menuitem' }, [entry.label]);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      details.removeAttribute('open');
      entry.onSelect?.();
    });
    list.append(node);
  }
  details.append(summary, list);
  return details;
}

/**
 * `pointer`: the thread opens elsewhere (its Needs attention row, by push)
 * and this row only takes the reader there, so it wears a right-pointing
 * chevron and never a slot of its own.
 */
function itemRow(item: ReviewItem, model: PanelModel, handlers: PanelHandlers, nested = false, pointer = false): HTMLElement {
  const key = itemKey(item.id);
  const open = !pointer && (nested ? model.openSubKey === key : model.openKey === key);
  const done = !isOpenStatus(item.status);
  const first = item.sources[0];
  const bot = first?.bot !== undefined || /\[bot\]$/i.test(first?.author ?? '');

  const status = createElement(
    'button',
    { type: 'button', class: `${PANEL_CLASS}__status`, 'aria-label': done ? 'Reopen' : 'Mark done', title: done ? 'Reopen' : 'Mark done', 'aria-pressed': String(done), [ATTR_FOCUS]: `status:${key}` },
    [statusIcon(item)],
  );
  status.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onStatus(item.id, !done);
  });

  const detailBits: string[] = [];
  if (item.path !== undefined) detailBits.push(item.line === undefined ? item.path : `${item.path}:${item.line}`);
  detailBits.push(authorLabels(item).join(', '));
  if (item.sources.length > 1) detailBits.push(`${item.sources.length} comments`);
  const pending = model.aiPending.has(item.id);
  // A pointer row's focus key differs from the canonical row's, so a reveal or a focus restore lands on the latter.
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, ...(pointer ? {} : { 'aria-expanded': String(open) }), [ATTR_FOCUS]: pointer ? `main:ptr:${key}` : `main:${key}` }, [
    createElement('span', { class: `${PANEL_CLASS}__title`, ...(pending ? { 'data-pending': '', title: 'Geld is consolidating this item' } : {}) }, inlineText(item.title)),
    createElement('span', { class: `${PANEL_CLASS}__detail` }, [detailBits.join(' · ')]),
  ]);
  const anchorOfItem = first?.anchor ?? null;
  const toggle = (): void => {
    if (pointer) {
      if (anchorOfItem !== null) handlers.onOpenAnchor(anchorOfItem);
      return;
    }
    if (nested) handlers.onToggleSub(key);
    else handlers.onToggle(key);
  };
  mainClickToggles(main, toggle);

  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (item.rewritten) right.append(createElement('span', { class: `${PANEL_CLASS}__ai`, title: 'Title written by Geld from the sources' }, ['AI']));
  const badge = statusBadge(item.status);
  if (badge !== null) right.append(createElement('span', { class: `${PANEL_CLASS}__pill`, 'data-badge': item.status }, [badge]));
  if (first !== undefined) {
    const time = timeCell(model, first.anchor);
    if (time !== null) right.append(time);
  }
  const entries: MenuEntry[] = [];
  const resolvable = model.resolvable(item);
  entries.push({
    label: resolvable ? (done ? 'Unresolve conversation' : 'Resolve conversation') : done ? 'Reopen' : 'Mark done',
    onSelect: () => handlers.onStatus(item.id, !done),
  });
  entries.push({ label: 'Quote reply', onSelect: () => handlers.onQuoteReply(item.id) });
  entries.push({ label: 'Copy as Markdown', onSelect: () => handlers.onCopyItem(item.id) });
  if (model.fixFor(item) !== null) entries.push({ label: 'Copy suggested fix', onSelect: () => handlers.onCopyFix(item.id) });
  if (first !== undefined) {
    const anchor = first.anchor;
    entries.push({ label: 'Show in timeline', onSelect: () => handlers.onShowInTimeline(anchor) });
    entries.push({ label: 'Copy link', onSelect: () => handlers.onCopyLink(anchor) });
  }
  right.append(menu(entries, key), pointer ? pointerChevron(toggle) : chevron(open, toggle));

  const row = createElement(
    'li',
    { class: `${PANEL_CLASS}__row`, 'data-geld-item': item.id, 'data-state': done ? 'done' : item.status, 'data-severity': item.severity, ...(done ? { 'data-tone': 'good' } : {}), ...(pointer ? { 'data-pointer': '' } : {}) },
    [status, avatarStack(model.avatarsFor(item), first?.author ?? '', bot), main, right],
  );
  rowClickToggles(row, toggle);
  if (open) row.setAttribute('data-open', '');
  if (model.viewingAnchor !== null && item.sources.some((source) => source.anchor === model.viewingAnchor)) row.setAttribute('data-viewing', '');
  return row;
}

function foldRowEl(fold: FoldRow, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const key = foldKey(fold.key);
  const open = model.openKey === key;
  // A state change reads as a line: who, then the first words of the comment they left with it. The glyph on the
  // left says what they did (closed, merged, reopened), so the words "closed this" are for screen readers alone,
  // where the button's name would otherwise be a login and a quote. The timeline events row reads its state change
  // in words (who merged, into what), the count beside it.
  const headline = fold.headline;
  const asLine = fold.closure !== undefined || headline !== undefined;
  const mainChildren: Node[] =
    fold.closure !== undefined
      ? [
          createElement('span', { class: `${PANEL_CLASS}__name` }, [fold.author ?? '']),
          createElement('span', { class: 'geld-sr-only' }, [` ${fold.closure.kind} this `]),
          ...(fold.closure.preview === '' ? [] : [createElement('span', { class: `${PANEL_CLASS}__preview` }, inlineText(fold.closure.preview))]),
        ]
      : headline !== undefined
        ? [
            ...(headline.actor === '' ? [] : [createElement('span', { class: `${PANEL_CLASS}__name` }, [headline.actor])]),
            createElement('span', { class: `${PANEL_CLASS}__preview ${PANEL_CLASS}__preview--verdict` }, [headlineText(headline)]),
            createElement('span', { class: `${PANEL_CLASS}__preview ${PANEL_CLASS}__preview--count` }, [fold.label]),
          ]
        : [createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--plain` }, [fold.label])];
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main${asLine ? ` ${PANEL_CLASS}__main--entry` : ''}`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${key}` }, mainChildren);
  const toggle = (): void => handlers.onToggle(key);
  mainClickToggles(main, toggle);
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (fold.time !== '') right.append(createElement('span', { class: `${PANEL_CLASS}__time`, ...(fold.timeAnchor === null ? {} : { [ATTR_TIME_FOR]: fold.timeAnchor }) }, [fold.time]));
  if (fold.firstAnchor !== null) {
    const anchor = fold.firstAnchor;
    // A single comment (a closure's is one: the event beside it has no menu) wears GitHub's own ⋯ (Copy link,
    // Quote reply, Edit, Hide, Delete) with Show in timeline added; Geld's small menu stands in until it arrives,
    // and for groups.
    if ((fold.count === 1 || fold.closure !== undefined) && fold.avatarSrc !== null) right.append(controlSlot(anchor));
    right.append(menu([{ label: 'Show in timeline', onSelect: () => handlers.onShowInTimeline(anchor) }, { label: 'Copy link', onSelect: () => handlers.onCopyLink(anchor) }], key));
  } else {
    // Keeps the times of rows without a menu in line with those that have one.
    right.append(createElement('span', { class: `${PANEL_CLASS}__spacer`, 'aria-hidden': 'true' }));
  }
  right.append(chevron(open, toggle));
  // A state change wears the pull request's own state glyph in the state's colour (merged purple, closed red,
  // reopened green), as GitHub draws it.
  const state = fold.closure?.kind ?? headline?.kind ?? null;
  const glyph =
    state === null
      ? createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(FOLD_GLYPH[fold.key] ?? ICON_COMMENT_DISCUSSION)])
      : createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--verdict`, 'data-pr-state': state, role: 'img', 'aria-label': STATE_LABEL[state] }, [icon(STATE_ICON[state])]);
  // Who: the closure's commenter, or the headline's actor; a person's picture is round and carries GitHub's hovercard.
  const who = headline === undefined ? { src: fold.avatarSrc, login: fold.author ?? '', bot: fold.closure === undefined } : { src: headline.avatarSrc, login: headline.actor, bot: false };
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--fold${asLine ? ` ${PANEL_CLASS}__row--sub` : ''}`, 'data-geld-fold': fold.key, 'data-section': fold.section }, [
    glyph,
    ...(who.src === null ? [] : [avatarStack([{ src: who.src, bot: who.bot, login: who.login }], fold.label, who.bot)]),
    main,
    right,
  ]);
  if (open) row.setAttribute('data-open', '');
  rowClickToggles(row, toggle);
  return row;
}

const FOLD_GLYPH: Readonly<Record<string, string>> = { events: ICON_HISTORY, commits: ICON_GIT_COMMIT, mentions: ICON_CROSS_REFERENCE };
const STATE_ICON: Readonly<Record<ClosureKind, string>> = { merged: ICON_GIT_MERGE, closed: ICON_GIT_PULL_REQUEST_CLOSED, reopened: ICON_GIT_PULL_REQUEST };
const STATE_LABEL: Readonly<Record<ClosureKind, string>> = { merged: 'Merged', closed: 'Closed', reopened: 'Reopened' };

/** "Push 03 · 2 commits" — the round named by what opened it; numbers padded to the widest so the column lines up. */
function pushLabel(batch: Batch, total: number): string {
  if (batch.commits.length === 0) return 'Earlier';
  return `Push ${String(batch.index).padStart(String(total).length, '0')} · ${pushContents(batch)}`;
}

/** "2 commits", "force-push", or "2 commits · force-push" for a round that had both. */
function pushContents(batch: Batch): string {
  const forced = batch.commits.length - batch.commitCount;
  const parts = [batch.commitCount > 0 ? plural(batch.commitCount, 'commit') : '', forced > 0 ? (forced === 1 ? 'force-push' : `${forced} force-pushes`) : ''];
  return parts.filter((part) => part !== '').join(' · ');
}

const CI_WORDS: Readonly<Record<'success' | 'failure' | 'pending', string>> = { success: 'checks passed', failure: 'checks failed', pending: 'checks running' };

function pushTone(batch: Batch, allDone: boolean): Tone | null {
  const open = batch.items.some((item) => isOpenStatus(item.status));
  if (batch.ciGlyph === 'failure' || open) return 'bad';
  if (batch.ciGlyph === 'success') return 'good';
  return allDone ? 'good' : null;
}

function batchProgress(batch: Batch): { readonly done: number; readonly total: number } {
  return { done: batch.items.filter((item) => !isOpenStatus(item.status)).length, total: batch.items.length };
}

/** The meter from the Geld row — a bar that fills as threads resolve, then "d/t resolved" — shown only once there is something to measure. */
function progressMeter(done: number, total: number, noun: string): HTMLElement {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const progress = createElement('span', { class: `${PANEL_CLASS}__progress`, title: total === 0 ? `No ${noun}s yet` : `${done} of ${total} ${total === 1 ? noun : `${noun}s`} resolved` });
  if (total > 0) progress.append(createElement('span', { class: `${PANEL_CLASS}__meter`, 'aria-hidden': 'true' }, [createElement('i', { style: `width:${percent}%` })]));
  progress.append(total === 0 ? createElement('span', {}, [`No ${noun}s`]) : createElement('span', {}, [`${done}/${total} `, createElement('span', { class: `${PANEL_CLASS}__progress-word` }, ['resolved'])]));
  return progress;
}

/** A small pill with the comment glyph and a count, as the Reviews row wears. */
function countChip(count: number, label: string): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__count-chip`, title: label }, [icon(ICON_COMMENT_DISCUSSION), createElement('span', {}, [String(count)])]);
}

/**
 * GitHub's own in-progress mark (the spinning ring the CI breakdown uses),
 * small, after a row's content: what is shown is real, more is on its way.
 * Not a skeleton — the sidebar's verdicts are the page's from the start —
 * and not a bare spinner in the content's place either.
 */
function ingestingMark(label: string): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__ingesting`, role: 'img', 'aria-label': label, title: label }, [icon(ICON_IN_PROGRESS)]);
}

/**
 * A round's row: progress glyph, who posted (their avatars say it — no
 * names), "Round N", the meter for its threads, a chip with how many run
 * summaries it holds, when.
 */
function batchRow(batch: Batch, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const open = model.openKey === batch.key;
  const { done, total } = batchProgress(batch);
  const allDone = total > 0 && done === total;
  const lead =
    total === 0
      ? createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_COMMENT_DISCUSSION)])
      : createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--progress`, role: 'img', 'aria-label': `${done} of ${total} threads resolved`, 'data-done': String(allDone) }, [icon(allDone ? ICON_CHECK_CIRCLE_FILL : ICON_CIRCLE)]);
  const byPush = model.grouping === 'batch';
  const mainChildren: Node[] = [createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--plain` }, [byPush ? pushLabel(batch, model.batches.length) : `Round ${batch.index}`])];
  // By push the row reads left to right: who pushed, how CI ended, how the threads stand, how many comments, previews.
  if (byPush && batch.committers.length > 0) mainChildren.push(avatarStack(batch.committers, '', false, batch.committers.length));
  if (byPush && batch.ciGlyph !== null) {
    const ci: Readonly<Record<'success' | 'failure' | 'pending', readonly [string, string]>> = { success: [ICON_CHECK_CIRCLE_FILL, 'CI passed'], failure: [ICON_X_CIRCLE_FILL, 'CI failed'], pending: [ICON_IN_PROGRESS, 'CI running'] };
    const [glyph, label] = ci[batch.ciGlyph];
    mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__health`, 'data-ci': batch.ciGlyph, role: 'img', 'aria-label': `${label} on this push's last commit`, title: `${label} on this push's last commit` }, [icon(glyph)]));
  }
  if (total > 0 && byPush && allDone) mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__health`, 'data-health': 'good', role: 'img', 'aria-label': `${total} of ${total} threads resolved`, title: 'All threads resolved' }, [icon(ICON_CHECK_CIRCLE_FILL)]));
  else if (total > 0) mainChildren.push(progressMeter(done, total, 'thread'));
  const commentCount = batch.comments.length + batch.reviews.filter((entry) => entry.hasBody).length + batch.items.reduce((sum, item) => sum + item.sources.length, 0);
  if (commentCount > 0) mainChildren.push(countChip(commentCount, `${plural(commentCount, 'comment')} in this round`));
  // The push's one preview is its pill - a link to it, as on the Previews row. Several are counted instead, as the
  // hosts' marks and "N previews" set inline like the committers' avatars beside them: not a pill, since it is not
  // a link, and a click on it opens the push like the rest of the row.
  const [onlyPreview] = batch.previews;
  if (byPush && onlyPreview !== undefined && batch.previews.length === 1) {
    mainChildren.push(previewPill(onlyPreview, model));
  } else if (byPush && batch.previews.length > 1) {
    const hosts: string[] = [];
    for (const entry of batch.previews) {
      const src = model.avatarForAnchor(entry.anchor);
      if (src !== null && !hosts.includes(src)) hosts.push(src);
    }
    mainChildren.push(
      createElement('span', { class: `${PANEL_CLASS}__deploy-sum`, 'aria-hidden': 'true' }, [
        createElement('span', { class: `${PANEL_CLASS}__deploy-sum-hosts` }, hosts.slice(0, 3).map((src) => createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src, alt: '', width: '16', height: '16' }))),
        createElement('span', { class: `${PANEL_CLASS}__deploy-sum-text` }, [plural(batch.previews.length, 'preview')]),
      ]),
    );
  }
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--batch`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${batch.key}`, title: batch.names.join(', ') }, mainChildren);
  const toggle = (): void => handlers.onToggle(batch.key);
  mainClickToggles(main, toggle);
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (batch.time !== '') right.append(createElement('span', { class: `${PANEL_CLASS}__time` }, [batch.time]));
  if (batch.firstAnchor !== null) {
    const anchor = batch.firstAnchor;
    right.append(menu([{ label: 'Show in timeline', onSelect: () => handlers.onShowInTimeline(anchor) }, { label: 'Copy link', onSelect: () => handlers.onCopyLink(anchor) }], batch.key));
  }
  right.append(chevron(open, toggle));
  // By push, one solid mark says "a push" and the row's facts follow; by type the round's progress glyph and posters lead.
  // A push is red while CI failed or a thread is open, green once CI passed (or, with no CI to read, once its threads
  // are all resolved) and nothing is open, and plain while CI is still running with nothing to resolve. A comment
  // that lands later and opens a thread turns a green push red again.
  const tone: Tone | null = byPush ? pushTone(batch, allDone) : allDone ? 'good' : null;
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--batch`, 'data-geld-batch': batch.key, 'data-state': allDone ? 'done' : total === 0 ? 'none' : 'open', ...toneAttr(tone) }, [
    ...(byPush ? [createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_REPO_PUSH)])] : [lead, avatarStack(batch.avatars, batch.names[0] ?? '', true, batch.avatars.length)]),
    main,
    right,
  ]);
  if (open) row.setAttribute('data-open', '');
  rowClickToggles(row, toggle);
  return row;
}

/**
 * An open round: people's reviews first, then its bot comments, then its
 * threads under two headings — unresolved first, resolved after — and (by
 * push) its commits, all as rows that open one at a time (`openSubKey`: a comment's anchor or an
 * item key). Returns the nested slot and what is open in it.
 */
export function renderBatchView(slot: HTMLElement, batch: Batch, model: PanelModel, handlers: PanelHandlers): { readonly nested: HTMLElement | null; readonly openItem: ReviewItem | null; readonly openComment: string | null; readonly commitsSlot: HTMLElement | null } {
  const list = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--sub ${PANEL_CLASS}__rows--threads`, role: 'list' });
  let nested: HTMLElement | null = null;
  let openItem: ReviewItem | null = null;
  let openComment: string | null = null;
  let commitsSlot: HTMLElement | null = null;
  const byPush = model.grouping === 'batch';
  // The previews this round deployed (or failed to), as the Previews row has them: the pills on one line that
  // unfolds into a line per preview (status, picture, name, host and state, Open, Inspect, when). A host's comment
  // is its preview, never a bot comment line.
  if (batch.previews.length > 0) {
    const open = model.openPreviews.has(batch.key);
    const toggle = (): void => handlers.onTogglePreviews(batch.key);
    const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--status`, 'aria-expanded': String(open), [ATTR_FOCUS]: `previews:${batch.key}`, 'aria-label': plural(batch.previews.length, 'preview') }, [
      createElement('span', { class: `${PANEL_CLASS}__status-content ${PANEL_CLASS}__deploys` }, batch.previews.map((entry) => previewPill(entry, model))),
    ]);
    mainClickToggles(main, toggle);
    const health = previewHealth(batch.previews);
    const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--sub ${PANEL_CLASS}__row--status ${PANEL_CLASS}__row--previews`, 'data-health': health, ...toneAttr(alarmTone(health)) }, [
      createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_ROCKET)]),
      rowLabel('Previews', 'Previews'),
      main,
      createElement('span', { class: `${PANEL_CLASS}__right` }, [chevron(open, toggle)]),
    ]);
    if (open) row.setAttribute('data-open', '');
    rowClickToggles(row, toggle);
    list.append(row);
    if (open) for (const entry of batch.previews) list.append(previewLine(entry, model));
  }
  const section = (label: string, items: readonly ReviewItem[]): void => {
    if (items.length === 0) return;
    list.append(subhead(label, items.some((item) => isOpenStatus(item.status)) ? ICON_CIRCLE : ICON_CHECK_CIRCLE_FILL));
    for (const item of items) {
      // By push an open thread's one home is its Needs attention row; the push lists it and points there.
      const pointer = byPush && isOpenStatus(item.status);
      list.append(itemRow(item, model, handlers, true, pointer));
      if (!pointer && model.openSubKey === itemKey(item.id)) {
        const body = createElement('div', { class: `${PANEL_CLASS}__slot-body` });
        const notes = notesFor(item, model, handlers);
        list.append(createElement('li', { class: `${PANEL_CLASS}__slot ${PANEL_CLASS}__slot--sub` }, notes === null ? [body] : [notes, body]));
        nested = body;
        openItem = item;
      }
    }
  };
  // People's verdicts and remarks that landed in the round, in either grouping, first: a review is the verdict on
  // the round and the threads are its detail, so the reader sees "looks good, a few nits" before the nits. The
  // header counts them and shows their avatars (the Reviews row still lists every review across the PR).
  if (batch.reviews.length > 0) {
    // A person's verdict is a review; their top-level comment is a comment, and the heading says which it lists.
    const verdicts = batch.reviews.filter((entry) => entry.state !== 'comment').length;
    const remarks = batch.reviews.length - verdicts;
    const label = [verdicts > 0 ? plural(verdicts, 'review') : '', remarks > 0 ? plural(remarks, 'comment') : ''].filter((part) => part !== '').join(' · ');
    list.append(subhead(label, verdicts > 0 ? ICON_COMMENT_DISCUSSION : ICON_COMMENT));
    const entries = orderEntries(batch.reviews);
    const reserve = entries.some(entryOpens);
    for (const entry of entries) {
      const { row, open } = entryRow(entry, model, handlers, reserve);
      list.append(row);
      if (open) {
        const sub = nestedSlot();
        list.append(sub.item);
        nested = sub.body;
        openComment = entry.anchor;
      }
    }
  }
  if (batch.comments.length > 0) {
    // The round's bot comments (run summaries, deploy notes) before its threads, as lines that open one at a
    // time — right there, not behind another toggle: a round is already two clicks in. A run's summary says what
    // the threads below it are about, as a person's review does.
    list.append(subhead(plural(batch.comments.length, 'bot comment'), ICON_COMMENT));
    for (const entry of batch.comments) {
      const { row, open } = entryRow(entry, model, handlers);
      list.append(row);
      if (open) {
        const sub = nestedSlot();
        list.append(sub.item);
        nested = sub.body;
        openComment = entry.anchor;
      }
    }
  }
  const unresolved = batch.items.filter((item) => isOpenStatus(item.status));
  const resolved = batch.items.filter((item) => !isOpenStatus(item.status));
  section(plural(unresolved.length, 'unresolved thread'), unresolved);
  section(plural(resolved.length, 'resolved thread'), resolved);
  if (byPush && batch.commits.length > 0) {
    // The push itself, last: its commit rows unfold under a heading like the bot comments do.
    const open = model.openCommits.has(batch.key);
    const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__notes-btn ${PANEL_CLASS}__notes-btn--commits`, 'aria-expanded': String(open), [ATTR_FOCUS]: `commits:${batch.key}` }, [
      icon(batch.commitCount > 0 ? ICON_GIT_COMMIT : ICON_REPO_PUSH),
      // The push's CI state in words, next to what it applies to: the reason a push is red when nothing inside it says so.
      createElement('span', {}, [`${pushContents(batch)}${batch.ciGlyph === null ? '' : ` · ${CI_WORDS[batch.ciGlyph]}`}`]),
      icon(ICON_CHEVRON_DOWN),
    ]);
    button.addEventListener('click', () => handlers.onToggleCommits(batch.key));
    list.append(createElement('li', { class: `${PANEL_CLASS}__subhead ${PANEL_CLASS}__notes`, 'data-open': String(open) }, [button]));
    if (open) {
      commitsSlot = createElement('div', { class: `${PANEL_CLASS}__slot-body ${PANEL_CLASS}__commits-body` });
      list.append(createElement('li', { class: `${PANEL_CLASS}__slot ${PANEL_CLASS}__slot--sub`, 'data-kind': 'commits' }, [commitsSlot]));
    }
  }
  slot.replaceChildren(list);
  return { nested, openItem, openComment, commitsSlot };
}

/** A sub-list heading on the header grid: a glyph in the glyph column, the words where the headers' words start. */
function subhead(label: string, glyph: string): HTMLElement {
  return createElement('li', { class: `${PANEL_CLASS}__subhead` }, [createElement('span', { class: `${PANEL_CLASS}__subhead-glyph`, 'aria-hidden': 'true' }, [icon(glyph)]), createElement('span', {}, [label])]);
}

/** The slot under an open comment line: one comment, its header worn by the line above. */
function nestedSlot(): { readonly item: HTMLElement; readonly body: HTMLElement } {
  const body = createElement('div', { class: `${PANEL_CLASS}__slot-body` });
  return { item: createElement('li', { class: `${PANEL_CLASS}__slot ${PANEL_CLASS}__slot--sub`, 'data-solo': '' }, [body]), body };
}

/** Clicking anywhere in the row that is not a control (avatars, blank space) toggles it, like the title does. */
/**
 * A row's main button toggles it - except when the click was on a link it
 * holds (a preview pill, a bot chip): that click opens the link, and only
 * the link. Without this a preview pill opened the preview *and* flipped
 * the row, since the pill sits inside the button and its click bubbled up.
 */
function mainClickToggles(main: HTMLElement, toggle: () => void): void {
  main.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) return;
    toggle();
  });
}

function rowClickToggles(row: HTMLElement, toggle: () => void): void {
  // The stylesheet gives the whole row the pointer: every part of it opens the row unless it is a control of its own.
  row.setAttribute('data-toggles', '');
  row.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('button, a, details, summary, input, textarea, [contenteditable], [data-geld-ctl], [data-geld-gear-slot]') !== null) return;
    toggle();
  });
}

/** "2 hours ago", from the sync-age wording, for when the model last ran here. */
function ranAgo(iso: string): string {
  const age = formatSyncAge(Date.parse(iso));
  return age.compact === 'now' ? 'just now' : `${age.compact} ago`;
}

/**
 * The AI control in the Geld row: the sparkle beside where the model stands
 * for this pull request. "Triage with AI" before a run, "AI · 2 hrs ago" after
 * one (stale or failed runs say so in the notice below), the sparkle alone
 * while it runs and on narrow panels. Nothing when AI is switched off in the
 * settings, and nothing when the repository's Action already writes the digest
 * with AI: there is nothing for this device to add.
 */
function aiButton(state: AiState, handlers: PanelHandlers): HTMLElement | null {
  if (state.kind === 'off' || state.kind === 'app') return null;
  const label = state.kind === 'ready' ? 'Triage with AI' : state.kind === 'running' ? 'AI is reading…' : `AI · ${ranAgo(state.ranAt)}`;
  const title =
    state.kind === 'ready'
      ? 'Ask the model to title the open bot threads and write a summary. Kept on this device only.'
      : state.kind === 'running'
        ? 'The model is reading the open threads'
        : state.kind === 'stale'
          ? 'Comments or threads arrived since the model last ran here. Run it again for the new ones.'
          : state.kind === 'failed'
            ? `The last run could not get an answer: ${state.error}`
            : 'Run the model again';
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__ai-btn`, 'data-state': state.kind, 'aria-label': `${label}. ${title}`, title, [ATTR_FOCUS]: 'ai', ...(state.kind === 'running' ? { 'aria-busy': 'true', disabled: '' } : {}) }, [
    icon(ICON_SPARKLE_FILL),
    createElement('span', { class: `${PANEL_CLASS}__ai-label` }, [label]),
  ]);
  button.addEventListener('click', () => handlers.onRunAi());
  return button;
}

/**
 * A notice under the Geld row when the reader should decide something about
 * AI: new comments since it last ran here, a run that failed, or a repository
 * whose Action now writes the digest with AI while this device still holds its
 * own run. Copy uses no dashes or semicolons.
 */
function aiNotice(state: AiState, handlers: PanelHandlers): HTMLElement | null {
  const notice = (text: string, action: string, onAction: () => void, tone: 'attention' | 'danger' | 'accent'): HTMLElement => {
    const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__ai-notice-btn` }, [action]);
    button.addEventListener('click', onAction);
    return createElement('div', { class: `${PANEL_CLASS}__ai-notice`, 'data-tone': tone, role: 'status' }, [
      createElement('span', { class: `${PANEL_CLASS}__ai-notice-glyph`, 'aria-hidden': 'true' }, [icon(ICON_SPARKLE_FILL)]),
      createElement('span', { class: `${PANEL_CLASS}__ai-notice-text` }, [text]),
      button,
    ]);
  };
  if (state.kind === 'stale') return notice(`New comments or threads have arrived since Geld AI last ran here ${ranAgo(state.ranAt)}.`, 'Triage the new changes', () => handlers.onRunAi(), 'attention');
  if (state.kind === 'failed') return notice(`Geld AI could not get an answer ${ranAgo(state.ranAt)}: ${state.error}`, 'Try again', () => handlers.onRunAi(), 'danger');
  if (state.kind === 'app' && state.hasLocal) {
    return notice('This repository now writes its digest with Geld AI through its GitHub Action. The digest you see is that one. Clear the run kept on this device to keep it that way.', 'Clear my local run', () => handlers.onClearAi(), 'accent');
  }
  return null;
}

const GROUPING_LABEL: Readonly<Record<PanelModel['grouping'], string>> = { type: 'Type', batch: 'Push' };

/**
 * The grouping control in the Geld row: the list-filter mark (the one sign
 * for filter, sort and group) beside the current choice, "Type" or "Push";
 * on narrow panels the mark alone, as an icon button like the copy button
 * beside it. Choosing the other arrangement rebuilds the list and keeps the choice.
 */
function groupingMenu(model: PanelModel, handlers: PanelHandlers): HTMLElement {
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__grouping` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__grouping-btn`, role: 'button', 'aria-label': `Grouped by ${GROUPING_LABEL[model.grouping].toLowerCase()}. Change grouping`, title: 'Group the digest by', [ATTR_FOCUS]: 'grouping' }, [
    icon(ICON_LIST_FILTER),
    createElement('span', { class: `${PANEL_CLASS}__grouping-label` }, [GROUPING_LABEL[model.grouping]]),
  ]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list`, role: 'menu' }, [createElement('div', { class: `${PANEL_CLASS}__menu-title` }, ['Group the digest by'])]);
  const options: ReadonlyArray<{ readonly value: PanelModel['grouping']; readonly label: string; readonly hint: string }> = [
    { value: 'type', label: 'Type', hint: 'Bots, CI, reviews, rounds, activity' },
    { value: 'batch', label: 'Push', hint: 'What landed between two pushes' },
  ];
  for (const option of options) {
    const chosen = option.value === model.grouping;
    const item = createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item ${PANEL_CLASS}__menu-item--choice`, role: 'menuitemradio', 'aria-checked': String(chosen) }, [
      createElement('span', { class: `${PANEL_CLASS}__menu-check`, 'aria-hidden': 'true' }, [icon(chosen ? ICON_CHECK_CIRCLE_FILL : ICON_CIRCLE)]),
      createElement('span', { class: `${PANEL_CLASS}__menu-text` }, [createElement('span', {}, [option.label]), createElement('span', { class: `${PANEL_CLASS}__menu-hint` }, [option.hint])]),
    ]);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      details.removeAttribute('open');
      if (option.value !== model.grouping) handlers.onGrouping(option.value);
    });
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

/** Geld's own notes for an open item — merged context and the fix — above the moved comments. */
function notesFor(item: ReviewItem, model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  const fix = model.fixFor(item);
  if (item.context === undefined && fix === null) return null;
  const notes = createElement('div', { class: `${PANEL_CLASS}__notes` });
  if (item.context !== undefined) notes.append(createElement('p', { class: `${PANEL_CLASS}__context` }, [item.context]));
  if (fix !== null) {
    const head = createElement('div', { class: `${PANEL_CLASS}__fix-head` }, [
      createElement('span', {}, [fix.source === 'ai' ? 'Suggested fix (Geld)' : fix.source === 'bot' ? 'Suggested fix (bot)' : 'Suggested fix']),
    ]);
    const copy = iconButton(ICON_COPY, 'Copy fix');
    copy.addEventListener('click', () => handlers.onCopyFix(item.id));
    head.append(copy);
    notes.append(head, createElement('pre', { class: `${PANEL_CLASS}__fix` }, [createElement('code', {}, [fix.text])]));
  }
  return notes;
}

function slotRow(key: string, notes: HTMLElement | null = null, kind: string | null = null): HTMLElement {
  const body = createElement('div', { class: `${PANEL_CLASS}__slot-body` });
  const attrs: Record<string, string> = { class: `${PANEL_CLASS}__slot`, [ATTR_SLOT]: key };
  if (kind === 'solo') attrs['data-solo'] = '';
  else if (kind !== null) attrs['data-kind'] = kind;
  return createElement('li', attrs, notes === null ? [body] : [notes, body]);
}

function groupHeading(id: GroupId, label: string, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const collapsed = model.collapsedGroups.has(id);
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__group-btn`, 'aria-expanded': String(!collapsed), [ATTR_FOCUS]: `group:${id}` }, [
    createElement('span', {}, [label]),
    icon(ICON_CHEVRON_DOWN),
  ]);
  button.addEventListener('click', () => handlers.onToggleGroup(id));
  return createElement('li', { class: `${PANEL_CLASS}__group`, 'data-group': id }, [button]);
}

function plural(count: number, noun: string, nounPlural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nounPlural}`;
}




/* ---- status rows: review bots · CI checks · required reviews -------------- */

const HEALTH_ICON: Readonly<Record<Health, string>> = {
  good: ICON_CHECK_CIRCLE_FILL,
  warn: ICON_DOT_FILL,
  bad: ICON_X_CIRCLE_FILL,
  pending: ICON_DOT_FILL,
};

function healthGlyph(health: Health, label: string, glyph: string = HEALTH_ICON[health]): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__health`, 'data-health': health, role: 'img', 'aria-label': label, title: label }, [icon(glyph)]);
}

function anchorLink(anchor: string, label: string, handlers: PanelHandlers, children: Node[], extra: Readonly<Record<string, string>>): HTMLElement {
  const link = createElement('a', { class: `${PANEL_CLASS}__bot`, href: `#${anchor}`, 'aria-label': label, ...extra }, children);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    handlers.onOpenAnchor(anchor);
  });
  return link;
}

/**
 * One bot: its icon, name, detail and a traffic-light glyph; clicking opens
 * its run summary where the reader is. Resting on it shows the identity
 * card (the verdict is in there too, so no native tooltip competes with it).
 */
function botChip(bot: BotVerdictRecord, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const health = botHealth(bot);
  const current = isCurrent(bot, model.meta.headSha);
  const label = `${verdictLabel(bot)}${current ? '' : ' (earlier commit)'}`;
  const children: Node[] = [];
  const iconSrc = model.botIconFor(bot.id);
  if (iconSrc !== null) children.push(createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src: iconSrc, alt: '', width: '16', height: '16' }));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-name` }, [botTitle(bot.id, bot.login)]));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-detail` }, [botDetail(bot)]));
  // A run that did not happen (refused, or broken) wears the warning triangle, not a verdict's light: nothing was
  // reviewed, and the chip opens the bot's own words on why.
  const glyph = healthGlyph(health, label, bot.verdict === 'failed' ? ICON_ALERT : HEALTH_ICON[health]);
  glyph.removeAttribute('title');
  children.push(glyph);
  const who = whoAttributes(bot.login, true);
  // The anchor this chip opens is the bot's own (`botOpenAnchor`), never a trigger line shared with other bots it
  // was requested alongside: a running chip opens this bot's latest summary, or is inert when it has posted none.
  const open = model.botOpenAnchor(bot);
  if (open !== null) return anchorLink(open, label, handlers, children, who);
  return createElement('span', { class: `${PANEL_CLASS}__bot`, ...who, ...(current ? {} : { 'data-current': 'false' }) }, children);
}

/** What a bot's line in the request menu says about its last run here, and whether it is ticked to begin with. */
interface BotRunState {
  readonly health: Health | null;
  readonly word: string;
  /** Ticked when the menu opens: a failed run, or one on an earlier commit. */
  readonly preselect: boolean;
}

function botRunState(bot: InstalledBot, model: PanelModel): BotRunState {
  const record = model.meta.bots.find((entry) => entry.id === bot.id);
  if (record === undefined) return { health: null, word: 'Not run', preselect: false };
  const health = botHealth(record);
  if (health === 'pending') return { health, word: record.verdict === 'loading' ? 'Loading' : 'Running', preselect: false };
  if (!isCurrent(record, model.meta.headSha)) return { health, word: 'Earlier commit', preselect: true };
  // A refused run ("disabled for this repository") is Skipped, and not ticked: asking again changes nothing until
  // the bot's setup does.
  if (record.verdict === 'failed' && record.reason !== undefined) return { health, word: 'Skipped', preselect: false };
  const word = health === 'bad' ? 'Failed' : health === 'warn' ? 'Findings' : 'Passed';
  return { health, word, preselect: health === 'bad' };
}

/** How Geld knows the bot is here, for the line's tooltip. */
function presenceWords(bot: InstalledBot): string {
  switch (bot.presence) {
    case 'seen':
      return 'Active on this pull request';
    case 'declared':
      return 'Declared in .github/geld.yml';
    case 'configured':
      return `Configured in the repository (${bot.configFile ?? ''})`;
    case 'other':
      return 'Not seen on this repository';
  }
}

/**
 * Request a review: a checkbox per bot, with what its last run here said
 * (failed, findings, passed, running, on an earlier commit, not run), so
 * the reader can run only the ones that need it. Failed and stale runs
 * start ticked. Bots with a sign of being here (active on the page,
 * declared by the repository, configured in it) are listed first; the rest
 * of the registry waits behind "Other bots", since a trigger for a bot that
 * is not installed is a public comment with a handle in it. Run posts one
 * trigger comment per ticked bot; Cancel, Escape or a click outside closes.
 */
function requestMenu(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  if (model.requestable.length === 0) return null;
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__request` });
  // The ⋯ every row wears; while a bot runs it turns into the spinning sync glyph, which is the news.
  const summary = createElement(
    'summary',
    { class: `${PANEL_CLASS}__icon${model.running ? ` ${PANEL_CLASS}__icon--spin` : ''}`, 'aria-label': model.running ? 'A review is running · Request a review' : 'Request a review', title: model.running ? 'A review is running' : 'Request a review', role: 'button', [ATTR_FOCUS]: 'rerun' },
    [icon(model.running ? ICON_SYNC : ICON_KEBAB_HORIZONTAL)],
  );
  summary.addEventListener('click', (event) => event.stopPropagation());
  // Closed by Run, Cancel, Escape or a click outside: whatever changed meanwhile renders now.
  details.addEventListener('toggle', () => {
    if (!details.open) handlers.onRequestMenuClosed();
  });
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list ${PANEL_CLASS}__request-list` });
  list.append(createElement('div', { class: `${PANEL_CLASS}__menu-title` }, ['Request a review']));

  const checks = new Map<string, HTMLInputElement>();
  const run = createElement('button', { type: 'button', class: `btn btn-sm btn-primary ${PANEL_CLASS}__request-run` }, ['Run']);
  const syncRun = (): void => {
    const picked = [...checks.values()].filter((input) => input.checked).length;
    run.textContent = picked === 0 ? 'Run' : picked === 1 ? `Run ${model.requestable.find((bot) => checks.get(bot.id)?.checked === true)?.label ?? ''}` : `Run ${picked} bots`;
    run.toggleAttribute('disabled', picked === 0);
  };
  const line = (bot: InstalledBot): HTMLElement => {
    const state = botRunState(bot, model);
    const input = createElement('input', { type: 'checkbox', class: `${PANEL_CLASS}__request-check`, 'aria-label': `${bot.label}, ${state.word.toLowerCase()}` });
    input.checked = state.preselect;
    checks.set(bot.id, input);
    input.addEventListener('change', syncRun);
    // The same mark the bot's chip wears: `botIconFor` looks beyond the `/apps/` link `requestableBots` saw (the run
    // summary's avatar, a review comment of the bot's); a bot with no picture on the page gets an empty square.
    const iconSrc = model.botIconFor(bot.id) ?? bot.iconSrc;
    const mark = iconSrc !== null ? createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src: iconSrc, alt: '', width: '16', height: '16' }) : createElement('span', { class: `${PANEL_CLASS}__bot-icon ${PANEL_CLASS}__bot-icon--blank`, 'aria-hidden': 'true' });
    const stateNode = createElement('span', { class: `${PANEL_CLASS}__request-state`, ...(state.health === null ? {} : { 'data-health': state.health }) }, [
      ...(state.health === null ? [] : [createElement('span', { class: `${PANEL_CLASS}__health`, 'data-health': state.health, 'aria-hidden': 'true' }, [icon(HEALTH_ICON[state.health])])]),
      state.word,
    ]);
    const label = createElement('label', { class: `${PANEL_CLASS}__request-item`, title: `Posts \u201c${bot.trigger}\u201d · ${presenceWords(bot)}`, 'data-presence': bot.presence }, [input, mark, createElement('span', { class: `${PANEL_CLASS}__menu-text` }, [bot.label]), stateNode]);
    label.addEventListener('click', (event) => event.stopPropagation());
    return label;
  };

  const present = model.requestable.filter((bot) => bot.presence !== 'other');
  const others = model.requestable.filter((bot) => bot.presence === 'other');
  for (const bot of present) list.append(line(bot));
  if (others.length > 0) {
    if (present.length === 0) {
      // Nothing points at any bot here: the registry is the list.
      for (const bot of others) list.append(line(bot));
    } else {
      const more = createElement('details', { class: `${PANEL_CLASS}__request-more` });
      const moreSummary = createElement('summary', { class: `${PANEL_CLASS}__request-more-summary` }, [icon(ICON_CHEVRON_RIGHT), `Other bots (${others.length})`]);
      moreSummary.addEventListener('click', (event) => event.stopPropagation());
      more.append(moreSummary, ...others.map(line));
      list.append(more);
    }
  }

  list.append(createElement('div', { class: `${PANEL_CLASS}__request-sep`, role: 'separator' }));
  const cancel = createElement('button', { type: 'button', class: `btn btn-sm ${PANEL_CLASS}__request-cancel` }, ['Cancel']);
  run.addEventListener('click', (event) => {
    event.stopPropagation();
    const ids = model.requestable.filter((bot) => checks.get(bot.id)?.checked === true).map((bot) => bot.id);
    details.removeAttribute('open');
    if (ids.length > 0) handlers.onRequest(ids);
  });
  cancel.addEventListener('click', (event) => {
    event.stopPropagation();
    details.removeAttribute('open');
  });
  list.append(createElement('div', { class: `${PANEL_CLASS}__request-footer` }, [run, cancel]));
  syncRun();
  details.append(summary, list);
  return details;
}

/** How a person's standing reads in the people menu: glyph(s) and a word, "approved · awaiting" when both hold. */
function statusWords(status: ReviewerStatus): { readonly glyphs: readonly string[]; readonly words: string; readonly health: Health | null } {
  const glyphs: string[] = [];
  const parts: string[] = [];
  if (status.verdict !== null) {
    glyphs.push(ENTRY_GLYPH[status.verdict]);
    parts.push(REVIEWER_GROUP_WORD[status.verdict]);
  }
  if (status.awaiting) {
    glyphs.push(ICON_DOT_FILL);
    parts.push('awaiting');
  }
  const health: Health | null = status.verdict === 'approved' ? 'good' : status.verdict === 'changes_requested' ? 'bad' : status.awaiting ? 'pending' : null;
  return { glyphs, words: parts.join(' · '), health };
}

/**
 * Request a review, for people: the Reviews row's ⋯. Everyone with a
 * standing — a verdict given, a request pending — is listed first with it
 * (ticking someone who reviewed asks them again, which is how GitHub itself
 * re-requests); "Other reviewers" opens the rest, as GitHub's own menu lists
 * them, behind a search box that filters as you type and takes the arrow
 * keys, Enter to tick and Escape to close. Request posts GitHub's own form
 * once with everyone ticked; Cancel, Escape or a click outside closes.
 */
function reviewersMenu(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  if (!model.canRequestReviewers) return null;
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__request ${PANEL_CLASS}__people` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'Request a review', title: 'Request a review', role: 'button', [ATTR_FOCUS]: 'reviewers' }, [icon(ICON_KEBAB_HORIZONTAL)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  details.addEventListener('toggle', () => {
    if (!details.open) handlers.onRequestMenuClosed();
  });
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list ${PANEL_CLASS}__request-list` });
  list.append(createElement('div', { class: `${PANEL_CLASS}__menu-title` }, ['Request a review']));

  /** Ticked people by login (lower-case); candidates carry the ids the form wants. */
  const ticked = new Map<string, HTMLInputElement>();
  const picked = (): string[] => [...ticked.entries()].filter(([, input]) => input.checked).map(([login]) => login);
  const request = createElement('button', { type: 'button', class: `btn btn-sm btn-primary ${PANEL_CLASS}__request-run` }, ['Request']);
  const syncRequest = (): void => {
    const count = picked().length;
    request.textContent = count === 0 ? 'Request' : count === 1 ? 'Request review' : `Request ${count} reviews`;
    request.toggleAttribute('disabled', count === 0);
  };
  const personLine = (login: string, avatarSrc: string, name: string, status: ReviewerStatus | null, title: string): HTMLElement => {
    const key = login.toLowerCase();
    const input = ticked.get(key) ?? createElement('input', { type: 'checkbox', class: `${PANEL_CLASS}__request-check`, 'aria-label': login });
    ticked.set(key, input);
    input.addEventListener('change', syncRequest);
    const picture = avatarSrc !== '' ? createElement('img', { class: `${PANEL_CLASS}__bot-icon ${PANEL_CLASS}__people-avatar`, src: avatarSrc, alt: '', width: '16', height: '16' }) : createElement('span', { class: `${PANEL_CLASS}__bot-icon ${PANEL_CLASS}__bot-icon--blank`, 'aria-hidden': 'true' });
    const children: Node[] = [input, picture, createElement('span', { class: `${PANEL_CLASS}__menu-text` }, [login, ...(name === '' || name === login ? [] : [createElement('span', { class: `${PANEL_CLASS}__people-name` }, [name])])])];
    if (status !== null) {
      const { glyphs, words, health } = statusWords(status);
      if (glyphs.length > 0) {
        children.push(
          createElement('span', { class: `${PANEL_CLASS}__request-state ${PANEL_CLASS}__people-state`, ...(health === null ? {} : { 'data-health': health }), title: words }, [
            ...glyphs.map((glyph) => createElement('span', { class: `${PANEL_CLASS}__people-glyph`, 'aria-hidden': 'true' }, [icon(glyph)])),
            createElement('span', { class: `${PANEL_CLASS}__people-words` }, [words]),
          ]),
        );
      }
    }
    const label = createElement('label', { class: `${PANEL_CLASS}__request-item ${PANEL_CLASS}__people-item`, title, 'data-login': login }, children);
    label.addEventListener('click', (event) => event.stopPropagation());
    return label;
  };

  const standing = model.reviewerStatuses;
  for (const status of standing) {
    const { words } = statusWords(status);
    list.append(personLine(status.login, status.avatar.src, '', status, status.verdict !== null ? `Asks ${status.login} to review again · ${words}` : `${status.login} · ${words}`));
  }
  if (standing.length === 0) list.append(createElement('div', { class: `${PANEL_CLASS}__menu-hint ${PANEL_CLASS}__people-hint` }, ['Nobody has been asked yet.']));

  // Other reviewers: the search box and the list, filled from GitHub's candidates when first opened.
  const more = createElement('details', { class: `${PANEL_CLASS}__request-more ${PANEL_CLASS}__people-more` });
  const moreSummary = createElement('summary', { class: `${PANEL_CLASS}__request-more-summary` }, [icon(ICON_CHEVRON_RIGHT), 'Other reviewers']);
  moreSummary.addEventListener('click', (event) => event.stopPropagation());
  const listboxId = `geld-people-${Math.random().toString(36).slice(2, 8)}`;
  const search = createElement('input', { type: 'text', class: `${PANEL_CLASS}__people-search`, placeholder: 'Type or choose a user', 'aria-label': 'Type or choose a user', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listboxId, 'aria-autocomplete': 'list' });
  const options = createElement('div', { class: `${PANEL_CLASS}__people-options`, id: listboxId, role: 'listbox', 'aria-label': 'Other reviewers' });
  const hint = createElement('div', { class: `${PANEL_CLASS}__menu-hint ${PANEL_CLASS}__people-hint`, 'aria-live': 'polite' });
  more.append(moreSummary, createElement('div', { class: `${PANEL_CLASS}__people-filter` }, [search]), hint, options);
  list.append(more);

  let candidates: readonly ReviewerCandidate[] | null = null;
  let loading = false;
  const ids = new Map<string, { readonly id: number; readonly team: boolean }>();
  const rows: HTMLElement[] = [];
  let active = -1;
  const visibleRows = (): HTMLElement[] => rows.filter((row) => !row.hidden);
  const setActive = (index: number): void => {
    const shown = visibleRows();
    active = shown.length === 0 ? -1 : Math.max(0, Math.min(index, shown.length - 1));
    for (const [position, row] of shown.entries()) {
      row.toggleAttribute('data-active', position === active);
      row.setAttribute('aria-selected', String(position === active));
    }
    const current = shown[active];
    if (current !== undefined) {
      search.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const filter = (): void => {
    const needle = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const haystack = row.getAttribute('data-search') ?? '';
      row.hidden = needle !== '' && !haystack.includes(needle);
      if (!row.hidden) shown += 1;
    }
    if (candidates !== null) hint.textContent = shown === 0 ? 'Nothing to show' : '';
    setActive(needle === '' ? -1 : 0);
  };
  const fill = (found: readonly ReviewerCandidate[]): void => {
    const standingLogins = new Set(standing.map((entry) => entry.login.toLowerCase()));
    for (const candidate of found) {
      ids.set(candidate.login.toLowerCase(), { id: candidate.id, team: candidate.team });
      if (standingLogins.has(candidate.login.toLowerCase())) {
        // Already listed above with their standing; the form still needs their id, which is now known.
        continue;
      }
      const row = personLine(candidate.login, candidate.avatar, candidate.name, null, candidate.suggested ? `${candidate.login} · suggested` : candidate.login);
      row.id = `${listboxId}-${rows.length}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('data-search', `${candidate.login} ${candidate.name}`.toLowerCase());
      if (candidate.suggested) row.setAttribute('data-suggested', '');
      rows.push(row);
      options.append(row);
    }
    hint.textContent = rows.length === 0 ? 'Nobody else to ask.' : '';
    filter();
  };
  const load = (): void => {
    if (candidates !== null || loading) return;
    loading = true;
    hint.textContent = 'Loading…';
    void handlers.loadReviewerCandidates().then((found) => {
      loading = false;
      candidates = found ?? [];
      if (found === null) {
        hint.textContent = 'GitHub did not list anyone.';
        return;
      }
      fill(found);
    });
  };
  more.addEventListener('toggle', () => {
    if (!more.open) return;
    load();
    window.requestAnimationFrame(() => search.focus({ preventScroll: true }));
  });
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const current = visibleRows()[active];
      const input = current?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (input !== undefined && input !== null) {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (event.key === 'Escape') {
      if (search.value !== '') {
        event.preventDefault();
        event.stopPropagation();
        search.value = '';
        filter();
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : rows.length);
    }
  });
  // Clicks in the box stay in the box: the row toggle above must not see them.
  search.addEventListener('click', (event) => event.stopPropagation());

  list.append(createElement('div', { class: `${PANEL_CLASS}__request-sep`, role: 'separator' }));
  const cancel = createElement('button', { type: 'button', class: `btn btn-sm ${PANEL_CLASS}__request-cancel` }, ['Cancel']);
  request.addEventListener('click', (event) => {
    event.stopPropagation();
    const chosen = picked();
    if (chosen.length === 0) return;
    const go = (): void => {
      const users: number[] = [];
      const teams: number[] = [];
      for (const login of chosen) {
        const known = ids.get(login);
        if (known === undefined) continue;
        (known.team ? teams : users).push(known.id);
      }
      details.removeAttribute('open');
      if (users.length + teams.length > 0) handlers.onRequestReviewers(users, teams);
    };
    // Someone listed by their standing alone has no id yet: GitHub's list supplies it.
    if (chosen.every((login) => ids.has(login))) go();
    else {
      request.toggleAttribute('disabled', true);
      request.textContent = 'Requesting…';
      void handlers.loadReviewerCandidates().then((found) => {
        for (const candidate of found ?? []) ids.set(candidate.login.toLowerCase(), { id: candidate.id, team: candidate.team });
        go();
      });
    }
  });
  cancel.addEventListener('click', (event) => {
    event.stopPropagation();
    details.removeAttribute('open');
  });
  list.append(createElement('div', { class: `${PANEL_CLASS}__request-footer` }, [request, cancel]));
  syncRequest();
  details.append(summary, list);
  return details;
}

/** GitHub's own status ring: one arc per state, in its colours, drawn around a 16px circle. */
function checksRing(counts: CheckCounts): SVGElement {
  const total = checksTotal(counts);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(`${PANEL_CLASS}__ring`);
  let offset = 0;
  const segments: ReadonlyArray<readonly [keyof CheckCounts, number]> = [
    ['success', counts.success],
    ['failure', counts.failure],
    ['queued', counts.queued],
    ['pending', counts.pending],
    ['skipped', counts.skipped],
    ['neutral', counts.neutral],
  ];
  for (const [state, count] of segments) {
    if (count === 0 || total === 0) continue;
    const length = (count / total) * circumference;
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', '8');
    arc.setAttribute('cy', '8');
    arc.setAttribute('r', String(r));
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', '2.5');
    arc.setAttribute('stroke-dasharray', `${length} ${circumference - length}`);
    arc.setAttribute('stroke-dashoffset', String(-offset));
    arc.setAttribute('transform', 'rotate(-90 8 8)');
    arc.setAttribute('data-state', state);
    svg.append(arc);
    offset += length;
  }
  return svg;
}

/** A status row's label with the short form narrow layouts show instead ("Review bots" / "Bots"). */
function rowLabel(long: string, short: string): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__label` }, [createElement('span', { class: `${PANEL_CLASS}__label-long` }, [long]), createElement('span', { class: `${PANEL_CLASS}__label-short`, 'aria-hidden': 'true' }, [short])]);
}

function toneAttr(tone: Tone | null): Readonly<Record<string, string>> {
  return tone === null ? {} : { 'data-tone': tone };
}

/**
 * Status rows tint only for what needs the reader: three adjacent rows in
 * three hues read as a traffic light, and green or amber there repeats what
 * the glyph already says. Settled rows in the list below keep their green.
 */
function alarmTone(health: Health): Tone | null {
  return toneOf(health) === 'bad' ? 'bad' : null;
}

function statusRow(label: [string, string], lead: Node, content: Node[], right: Node[], extra: Readonly<Record<string, string>> = {}, fit = false): HTMLElement {
  return createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, ...extra }, [
    createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [lead]),
    rowLabel(label[0], label[1]),
    createElement('span', { class: `${PANEL_CLASS}__status-content`, ...(fit ? { [ATTR_FIT]: '' } : {}) }, content),
    createElement('span', { class: `${PANEL_CLASS}__right` }, right),
  ]);
}

/**
 * The status rows, in the order a reader triages a pull request: who has
 * reviewed (people), what the review bots said, what the reporters found,
 * whether CI passed, and where the previews are.
 */
function statusRows(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  const rows = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--status`, role: 'list' });
  if (model.reviews !== null || model.comments.length > 0 || model.reviewerGroups.length > 0 || model.ingesting) {
    const health: Health = model.reviews === null ? 'pending' : reviewsHealth(model.reviews);
    const content: Node[] = [];
    // The words carry only what the reviewer groups cannot: how many approvals the repository asks for. Without
    // a stated requirement (merged and closed PRs never state one) the groups alone say who did what. Narrow
    // screens keep just the fraction.
    if (model.reviews !== null && model.reviews.required !== null) {
      const fraction = `${model.reviews.approvals}/${model.reviews.required}`;
      content.push(
        createElement('span', { class: `${PANEL_CLASS}__status-text` }, [
          createElement('span', { class: `${PANEL_CLASS}__label-long` }, [`${fraction} approvals`]),
          createElement('span', { class: `${PANEL_CLASS}__label-short`, 'aria-hidden': 'true' }, [fraction]),
        ]),
      );
    }
    // Every reviewer, grouped by their latest verdict: the state's glyph, their avatars, how many (the words go on
    // narrow screens; the glyph says it).
    const verdictOf = new Map(model.reviewerGroups.filter((group) => group.state !== 'awaiting').flatMap((group) => group.reviewers.map((reviewer) => [reviewer.login.toLowerCase(), REVIEWER_GROUP_WORD[group.state]] as const)));
    for (const group of model.reviewerGroups) {
      // Someone awaited who already gave a verdict was asked again; their verdict still stands in its own group.
      const names = group.reviewers
        .map((reviewer) => {
          const verdict = group.state === 'awaiting' ? verdictOf.get(reviewer.login.toLowerCase()) : undefined;
          return verdict === undefined ? reviewer.login : `${reviewer.login} (asked again; ${verdict})`;
        })
        .join(', ');
      const label = `${group.reviewers.length} ${REVIEWER_GROUP_WORD[group.state]}`;
      content.push(
        createElement('span', { class: `${PANEL_CLASS}__reviewers`, 'data-state': group.state, title: `${REVIEWER_GROUP_TITLE[group.state]}: ${names}`, role: 'img', 'aria-label': `${label}: ${names}` }, [
          createElement('span', { class: `${PANEL_CLASS}__reviewers-glyph`, 'aria-hidden': 'true' }, [icon(ENTRY_GLYPH[group.state])]),
          avatarStack(group.reviewers.filter((reviewer) => reviewer.src !== ''), group.reviewers[0]?.login ?? '', false, group.reviewers.length),
          createElement('span', { class: `${PANEL_CLASS}__status-text ${PANEL_CLASS}__reviewers-text`, 'aria-hidden': 'true' }, [label]),
        ]),
      );
    }
    const open = model.openKey === REVIEWS_KEY;
    if (content.length === 0) content.push(createElement('span', { class: `${PANEL_CLASS}__status-text` }, [model.ingesting ? 'Reading reviews…' : 'No reviews yet']));
    // Only comments count here; a bare verdict is already in the approvals.
    const count = model.comments.filter((entry) => entry.hasBody).length;
    if (count > 0) content.push(countChip(count, `${plural(count, 'review comment')} from people`));
    // The verdicts above are whole (the sidebar's); the comments are still arriving from the timeline.
    if (model.ingesting) content.push(ingestingMark('Still reading the timeline: review comments are on their way'));
    const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--status`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${REVIEWS_KEY}` }, [
      createElement('span', { class: `${PANEL_CLASS}__status-content` }, content),
    ]);
    mainClickToggles(main, () => handlers.onToggle(REVIEWS_KEY));
    const right: Node[] = [];
    if (model.reviews !== null) right.push(healthGlyph(health, reviewsLabel(model.reviews)));
    const people = reviewersMenu(model, handlers);
    if (people !== null) right.push(people);
    right.push(chevron(open, () => handlers.onToggle(REVIEWS_KEY)));
    const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, 'data-health': health, ...toneAttr(alarmTone(health)) }, [
      createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_COMMENT_DISCUSSION)]),
      rowLabel('Reviews', 'Reviews'),
      main,
      createElement('span', { class: `${PANEL_CLASS}__right` }, right),
    ]);
    if (open) row.setAttribute('data-open', '');
    rowClickToggles(row, () => handlers.onToggle(REVIEWS_KEY));
    rows.append(row);
    if (open) rows.append(slotRow(REVIEWS_KEY, null, 'list'));
  }
  if (model.meta.bots.length > 0 || model.requestable.length > 0) {
    const worst: Health = model.meta.bots.map(botHealth).reduce<Health>((acc, health) => (acc === 'bad' || health === 'bad' ? 'bad' : acc === 'warn' || health === 'warn' ? 'warn' : acc === 'pending' || health === 'pending' ? 'pending' : 'good'), 'good');
    const chips = model.meta.bots.map((bot) => botChip(bot, model, handlers));
    const menu = requestMenu(model, handlers);
    rows.append(
      statusRow(
        ['Review bots', 'Bots'],
        icon(HEALTH_ICON[model.meta.bots.length === 0 ? 'pending' : worst]),
        chips.length === 0 ? [createElement('span', { class: `${PANEL_CLASS}__status-text` }, [model.ingesting ? 'Reading reviews…' : 'No reviews yet']), ...(model.ingesting ? [ingestingMark('Still reading the timeline: bot reviews are on their way')] : [])] : chips,
        menu === null ? [] : [menu],
        { 'data-health': model.meta.bots.length === 0 ? 'pending' : worst, ...toneAttr(alarmTone(model.meta.bots.length === 0 ? 'pending' : worst)) },
        chips.length > 0,
      ),
    );
  }
  if (model.reports.latest.length > 0) rows.append(...reportsRow(model, handlers));
  if (model.checks !== null) {
    const health = checksHealth(model.checks);
    const open = model.openKey === CHECKS_KEY;
    // The breakdown is the information; the total and a second overall glyph on the right only repeated it.
    const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${CHECKS_KEY}`, 'aria-label': checksSummary(model.checks) }, [checksBreakdown(model.checks)]);
    mainClickToggles(main, () => handlers.onToggle(CHECKS_KEY));
    const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, 'data-health': health, ...toneAttr(checksTone(model.checks, model.requiredFailing) === 'bad' ? 'bad' : null) }, [
      createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [model.checksRing ?? checksRing(model.checks)]),
      rowLabel('CI checks', 'CI'),
      main,
      createElement('span', { class: `${PANEL_CLASS}__right` }, [
        createElement('span', { class: `${PANEL_CLASS}__gear-slot`, [ATTR_GEAR_SLOT]: '' }),
        chevron(open, () => handlers.onToggle(CHECKS_KEY)),
      ]),
    ]);
    if (open) row.setAttribute('data-open', '');
    rowClickToggles(row, () => handlers.onToggle(CHECKS_KEY));
    rows.append(row);
    if (open) rows.append(slotRow(CHECKS_KEY, null, 'checks'));
  }
  if (model.previews.latest.length > 0) rows.append(...previewsRow(model, handlers));
  return rows.childElementCount === 0 ? null : rows;
}

const PREVIEW_STATUS_LABEL: Readonly<Record<Preview['status'], string>> = {
  ready: 'Ready',
  building: 'Building',
  failed: 'Failed',
  skipped: 'Skipped',
  unknown: '',
};

function previewHealth(previews: readonly Preview[]): Health {
  if (previews.some((entry) => entry.status === 'failed')) return 'bad';
  if (previews.some((entry) => entry.status === 'building')) return 'pending';
  if (previews.some((entry) => entry.status === 'ready')) return 'good';
  return 'pending';
}

/** The glyph a preview's state wears, the same one the CI breakdown and the per-preview line use. */
const PREVIEW_GLYPH: Readonly<Record<Preview['status'], string>> = {
  ready: ICON_CHECK_CIRCLE_FILL,
  failed: ICON_X_CIRCLE_FILL,
  building: ICON_IN_PROGRESS,
  skipped: ICON_SKIP,
  unknown: ICON_CIRCLE,
};

function previewGlyph(status: Preview['status']): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__health`, 'data-preview-status': status, role: 'img', 'aria-label': PREVIEW_STATUS_LABEL[status] || 'Preview' }, [icon(PREVIEW_GLYPH[status])]);
}

/**
 * One preview as a pill: the host's mark, the project, its state glyph (as the bots' pills wear their light); a
 * link to the preview. A skipped deployment has nowhere to go: its pill is faded, says so on hover, and is not
 * a link — the line below keeps the Inspect link.
 */
function previewPill(entry: Preview, model: PanelModel): HTMLElement {
  const host = previewHostById(entry.host);
  const label = `${host?.title ?? 'Preview'} · ${entry.project}${PREVIEW_STATUS_LABEL[entry.status] === '' ? '' : ` · ${PREVIEW_STATUS_LABEL[entry.status]}`}${entry.reason === undefined ? '' : ` · ${entry.reason}`}`;
  const children: Node[] = [];
  const avatar = model.avatarForAnchor(entry.anchor);
  if (avatar !== null) children.push(markImg(avatar, false));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-name ${PANEL_CLASS}__deploy-name` }, [entry.project]));
  children.push(previewGlyph(entry.status));
  const attrs = { class: `${PANEL_CLASS}__bot ${PANEL_CLASS}__deploy`, 'data-status': entry.status, 'aria-label': label, title: label };
  if (entry.url === null) return createElement('span', attrs, children);
  return createElement('a', { ...attrs, href: entry.url, target: '_blank', rel: 'noreferrer' }, children);
}

/**
 * The Previews row: a pill per current preview (they wrap), the row's
 * health from theirs; open, one line per preview — host, project, status,
 * Open and Logs links, when — then the superseded ones behind "Archived".
 */
function previewsRow(model: PanelModel, handlers: PanelHandlers): readonly HTMLElement[] {
  const open = model.openKey === PREVIEWS_KEY;
  const health = previewHealth(model.previews.latest);
  // The pills sit in the row like the bots' do (wrapping when there are many); open, the list has one line each.
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--status`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${PREVIEWS_KEY}`, 'aria-label': plural(model.previews.latest.length, 'preview') }, [
    createElement('span', { class: `${PANEL_CLASS}__status-content ${PANEL_CLASS}__deploys` }, model.previews.latest.map((entry) => previewPill(entry, model))),
  ]);
  mainClickToggles(main, () => handlers.onToggle(PREVIEWS_KEY));
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, 'data-health': health, ...toneAttr(alarmTone(health)) }, [
    createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_ROCKET)]),
    rowLabel('Previews', 'Previews'),
    main,
    createElement('span', { class: `${PANEL_CLASS}__right` }, [chevron(open, () => handlers.onToggle(PREVIEWS_KEY))]),
  ]);
  if (open) row.setAttribute('data-open', '');
  rowClickToggles(row, () => handlers.onToggle(PREVIEWS_KEY));
  if (!open) return [row];
  const slot = slotRow(PREVIEWS_KEY, null, 'list');
  const body = slot.querySelector<HTMLElement>(`.${PANEL_CLASS}__slot-body`);
  if (body !== null) renderPreviewsList(body, model, handlers);
  return [row, slot];
}

function previewLine(entry: Preview, model: PanelModel): HTMLElement {
  const host = previewHostById(entry.host);
  const avatar = model.avatarForAnchor(entry.anchor);
  const lead = createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--verdict`, 'data-preview-status': entry.status, role: 'img', 'aria-label': PREVIEW_STATUS_LABEL[entry.status] || 'Preview' }, [icon(PREVIEW_GLYPH[entry.status])]);
  const mainChildren: Node[] = [createElement('span', { class: `${PANEL_CLASS}__name` }, [entry.project])];
  mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__deploy-host` }, [`${host?.title ?? 'Preview'}${PREVIEW_STATUS_LABEL[entry.status] === '' ? '' : ` · ${PREVIEW_STATUS_LABEL[entry.status].toLowerCase()}`}`]));
  // The host's own words for why there is nothing to open ("X is not a member of the team"), truncating before the links.
  if (entry.reason !== undefined) mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__deploy-reason`, title: entry.reason }, [entry.reason]));
  const main = createElement('span', { class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--entry ${PANEL_CLASS}__main--static` }, mainChildren);
  const right = createElement('span', { class: `${PANEL_CLASS}__right ${PANEL_CLASS}__right--links` });
  if (entry.url !== null) right.append(createElement('a', { class: `${PANEL_CLASS}__deploy-link`, href: entry.url, target: '_blank', rel: 'noreferrer' }, ['Open ', icon(ICON_LINK_EXTERNAL)]));
  // With a reason the link is the host's remedy (add the member, request access), not a build log.
  if (entry.inspectUrl !== null) right.append(createElement('a', { class: `${PANEL_CLASS}__deploy-link ${PANEL_CLASS}__deploy-link--muted`, href: entry.inspectUrl, target: '_blank', rel: 'noreferrer' }, [entry.status === 'failed' ? (entry.reason !== undefined ? 'Fix' : 'Logs') : 'Inspect']));
  const previewTime = timeCell(model, entry.anchor);
  if (previewTime !== null) right.append(previewTime);
  return createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--sub ${PANEL_CLASS}__row--preview`, 'data-state': entry.status }, [
    lead,
    avatarStack(avatar === null ? [] : [{ src: avatar, bot: true, login: '' }], host?.title ?? '', true),
    main,
    right,
  ]);
}

/* ---- Reports: reporter bots' latest reports ------------------------------- */

const REPORT_GLYPH: Readonly<Record<Report['state'], string>> = {
  failed: ICON_X_CIRCLE_FILL,
  passed: ICON_CHECK_CIRCLE_FILL,
  info: ICON_DOT_FILL,
};

const REPORT_STATE_LABEL: Readonly<Record<Report['state'], string>> = {
  failed: 'Failed',
  passed: 'Passed',
  info: 'Reported',
};

/**
 * A service's mark in a pill, framed in the shape of its picture: GitHub
 * squares every App's avatar, but a disc on transparent corners (Chromatic's)
 * showed that square frame around a circle, so the picture itself decides
 * (`shapeMark`), the page's own rounding (a person's) taken as read.
 */
function markImg(src: string, roundOnPage: boolean): HTMLElement {
  const img = createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src, alt: '', width: '16', height: '16' });
  shapeMark(img, src, roundOnPage);
  return img;
}

/** The one word a report pill says when its words are only a verdict ("Quality Gate passed"): the state, as a bot chip says "clean". */
const REPORT_STATE_WORD: Readonly<Record<Report['state'], string>> = {
  failed: 'failed',
  passed: 'passed',
  info: 'reported',
};

/**
 * One report as a pill, shaped like a bot chip: the reporter's mark, its
 * name, then the project (when the report has one) and the numbers in its
 * own words ("Codecov patch 62.50%", "Chromatic mint 3 changes") or the
 * state word when the words are only a verdict ("Socket passed"), and the
 * state glyph. Clicking it opens the row to that report's line (the comment
 * opens under it), as a bot chip opens its line in the round. A report
 * posted as a check has no comment: its pill is a link to the service's
 * page for it, as a preview pill is to the deployment, and like that one it
 * only opens the link; the row opens from its chevron or its blank space.
 * Short of room the name goes first and the detail after it (`fitChips`),
 * so two Codecov pills still read "patch 62.50%" and "project 80.12%".
 */
function reportPill(entry: Report, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const subject = entry.project === undefined ? entry.title : `${entry.title} · ${entry.project}`;
  const label = `${subject} · ${entry.headline} · ${REPORT_STATE_LABEL[entry.state]}`;
  const children: Node[] = [];
  const avatar = reportAvatar(entry, model);
  if (avatar !== null) children.push(markImg(avatar.src, avatar.round));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-name` }, [entry.title]));
  if (entry.project !== undefined) children.push(createElement('span', { class: `${PANEL_CLASS}__bot-detail ${PANEL_CLASS}__report-project` }, [entry.project]));
  // The pill says the numbers ("4 changes", "✗ 2 ✓ 41"), the line under it the service's sentence; with only a
  // verdict to say, the state's word says it beside the light.
  if (entry.short === undefined) children.push(createElement('span', { class: `${PANEL_CLASS}__bot-detail` }, [entry.headline]));
  else if (entry.short.length === 0) children.push(createElement('span', { class: `${PANEL_CLASS}__bot-detail` }, [REPORT_STATE_WORD[entry.state]]));
  else for (const part of entry.short) children.push(reportPart(part));
  children.push(createElement('span', { class: `${PANEL_CLASS}__health`, 'data-report-state': entry.state, role: 'img', 'aria-label': REPORT_STATE_LABEL[entry.state] }, [icon(REPORT_GLYPH[entry.state])]));
  // The pill's hover card (hovercard.ts, `ATTR_REPORT`) says who reported and what; a native title would open beside it.
  const attrs = { class: `${PANEL_CLASS}__bot ${PANEL_CLASS}__deploy ${PANEL_CLASS}__report`, 'data-state': entry.state, 'aria-label': label, [ATTR_REPORT]: entry.anchor };
  // A link pill is a link and nothing else, as a preview pill is: the click opens the service's page in its tab
  // and leaves the row as it was (`mainClickToggles` and `rowClickToggles` ignore clicks on links for the same reason).
  if (entry.url !== undefined) return createElement('a', { ...attrs, href: entry.url, target: '_blank', rel: 'noreferrer' }, children);
  const pill = createElement('button', { type: 'button', ...attrs }, children);
  pill.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onOpenReport(entry.anchor);
  });
  return pill;
}

const PART_GLYPH: Readonly<Record<NonNullable<ReportPart['glyph']>, string>> = { x: ICON_X_CIRCLE_FILL, check: ICON_CHECK_CIRCLE_FILL, dot: ICON_DOT_FILL };

/** One piece of a pill's short form: its glyph in its tone, then the words. */
function reportPart(part: ReportPart): HTMLElement {
  const children: Node[] = [];
  if (part.glyph !== undefined) children.push(createElement('span', { class: `${PANEL_CLASS}__report-glyph`, 'data-tone': part.tone ?? 'muted', 'aria-hidden': 'true' }, [icon(PART_GLYPH[part.glyph])]));
  children.push(createElement('span', {}, [part.text]));
  return createElement('span', { class: `${PANEL_CLASS}__bot-detail ${PANEL_CLASS}__report-part`, ...(part.tone === undefined ? {} : { 'data-tone': part.tone }) }, children);
}

/**
 * The Reports row, shown only when a reporter has posted: a pill per
 * reporter's latest report, red while one reports failures; open, one line
 * per report that opens the comment in place, so the failing tests and
 * their logs are right there.
 */
function reportsRow(model: PanelModel, handlers: PanelHandlers): readonly HTMLElement[] {
  const open = model.openKey === REPORTS_KEY;
  const health: Health = reportsHealth(model.reports.latest);
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--status`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${REPORTS_KEY}`, 'aria-label': plural(model.reports.latest.length, 'report') }, [
    createElement('span', { class: `${PANEL_CLASS}__status-content ${PANEL_CLASS}__deploys`, [ATTR_FIT]: '' }, model.reports.latest.map((entry) => reportPill(entry, model, handlers))),
  ]);
  mainClickToggles(main, () => handlers.onToggle(REPORTS_KEY));
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, 'data-health': health, ...toneAttr(alarmTone(health)) }, [
    createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_REPORT)]),
    rowLabel(REPORTS_LABEL[0], REPORTS_LABEL[1]),
    main,
    createElement('span', { class: `${PANEL_CLASS}__right` }, [chevron(open, () => handlers.onToggle(REPORTS_KEY))]),
  ]);
  if (open) row.setAttribute('data-open', '');
  rowClickToggles(row, () => handlers.onToggle(REPORTS_KEY));
  if (!open) return [row];
  return [row, slotRow(REPORTS_KEY, null, 'list')];
}

/**
 * One report as a line: state glyph, the reporter's picture, its title and
 * headline, the time, the comment's own ⋯ and a chevron; open
 * (`openSubKey` is its anchor) the comment stands under it as a one-bubble
 * chat. A report posted as a check has no comment: its line names the
 * service and project, Open leads to the service's page for it (the check's
 * Details), as a preview line's Open leads to the deployment, and open it
 * shows the service's whole sentence, which the line cuts short.
 */
function reportLine(entry: Report, model: PanelModel, handlers: PanelHandlers): { readonly row: HTMLElement; readonly open: boolean } {
  const avatar = reportAvatar(entry, model);
  const lead = createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--verdict`, 'data-report-state': entry.state, role: 'img', 'aria-label': REPORT_STATE_LABEL[entry.state] }, [icon(REPORT_GLYPH[entry.state])]);
  const picture = avatarStack(avatar === null ? [] : [{ src: avatar.src, bot: !avatar.round, login: entry.author }], entry.title, true);
  // The picture takes the shape of its mark, as the pill's does.
  const pictureImg = picture.querySelector('img');
  if (avatar !== null && pictureImg !== null) shapeMark(pictureImg, avatar.src, avatar.round);
  const open = model.openSubKey === entry.anchor;
  const act = (): void => handlers.onToggleSub(entry.anchor);
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--entry`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:sub:${entry.anchor}` }, [
    createElement('span', { class: `${PANEL_CLASS}__name` }, [entry.title]),
    ...(entry.url !== undefined && entry.project !== undefined ? [createElement('span', { class: `${PANEL_CLASS}__deploy-host` }, [entry.project])] : []),
    createElement('span', { class: `${PANEL_CLASS}__preview` }, [entry.headline]),
  ]);
  mainClickToggles(main, act);
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (entry.url !== undefined) right.append(createElement('a', { class: `${PANEL_CLASS}__deploy-link`, href: entry.url, target: '_blank', rel: 'noreferrer' }, ['Open ', icon(ICON_LINK_EXTERNAL)]));
  const time = timeCell(model, entry.anchor);
  if (time !== null) right.append(time);
  if (entry.url === undefined) right.append(controlSlot(entry.anchor, true));
  right.append(chevron(open, act));
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--sub ${PANEL_CLASS}__row--report`, 'data-geld-sub': entry.anchor, 'data-state': entry.state }, [lead, picture, main, right]);
  if (open) row.setAttribute('data-open', '');
  if (model.viewingAnchor === entry.anchor) row.setAttribute('data-viewing', '');
  rowClickToggles(row, act);
  return { row, open };
}

/** What a check's report says in full, under its line: the service's sentence (the line's Open is the way to its page). */
function reportDetail(entry: Report): HTMLElement {
  return createElement('p', { class: `${PANEL_CLASS}__report-detail` }, [entry.headline]);
}

/** The reporter's mark: the comment's avatar (a bot's, square) for a bot's report, the check's avatar in its shape for a check's. */
function reportAvatar(entry: Report, model: PanelModel): CheckAvatar | null {
  if (entry.url !== undefined) return model.checkAvatarFor(entry.reporter, entry.anchor.replace(/^check:/, ''));
  const src = model.avatarForAnchor(entry.anchor);
  return src === null ? null : { src, round: false };
}

/**
 * The Reports row's list: one line per latest report. An open check report
 * shows its detail here; an open comment report's comment renders in the
 * returned slot (`openComment` names it; null when the open line is a check's).
 */
export function renderReportsList(slot: HTMLElement, model: PanelModel, handlers: PanelHandlers): { readonly nested: HTMLElement | null; readonly openComment: string | null } {
  const list = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--sub`, role: 'list' });
  let nested: HTMLElement | null = null;
  let openComment: string | null = null;
  for (const entry of model.reports.latest) {
    const { row, open } = reportLine(entry, model, handlers);
    list.append(row);
    if (!open) continue;
    const sub = nestedSlot();
    list.append(sub.item);
    if (entry.url !== undefined) {
      sub.body.append(reportDetail(entry));
    } else {
      nested = sub.body;
      openComment = entry.anchor;
    }
  }
  slot.replaceChildren(list);
  return { nested, openComment };
}

function renderPreviewsList(slot: HTMLElement, model: PanelModel, handlers: PanelHandlers): void {
  const list = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--sub`, role: 'list' });
  for (const entry of model.previews.latest) list.append(previewLine(entry, model));
  if (model.previews.archived.length > 0) {
    const open = model.archivedPreviewsOpen;
    const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__notes-btn ${PANEL_CLASS}__notes-btn--commits`, 'aria-expanded': String(open), [ATTR_FOCUS]: 'notes:previews' }, [
      icon(ICON_HISTORY),
      createElement('span', {}, [`${plural(model.previews.archived.length, 'archived preview')} from earlier pushes`]),
      icon(ICON_CHEVRON_DOWN),
    ]);
    button.addEventListener('click', () => handlers.onToggleArchivedPreviews());
    list.append(createElement('li', { class: `${PANEL_CLASS}__subhead ${PANEL_CLASS}__notes`, 'data-open': String(open) }, [button]));
    if (open) for (const entry of model.previews.archived) list.append(previewLine(entry, model));
  }
  slot.replaceChildren(list);
}

const ENTRY_GLYPH: Readonly<Record<Exclude<ReviewEntryState, 'thread'>, string>> = {
  approved: ICON_CHECK_CIRCLE_FILL,
  changes_requested: ICON_X_CIRCLE_FILL,
  commented: ICON_COMMENT,
  dismissed: ICON_COMMENT,
  comment: ICON_COMMENT,
  awaiting: ICON_DOT_FILL,
};

/** "2 approved", "1 requested changes" — GitHub's own words; nothing is "rejected". */
const REVIEWER_GROUP_WORD: Readonly<Record<ReviewerGroupState, string>> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  commented: 'commented',
  awaiting: 'awaiting',
};

const REVIEWER_GROUP_TITLE: Readonly<Record<ReviewerGroupState, string>> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Reviewed with comments',
  awaiting: 'Awaiting review',
};

const ENTRY_LABEL: Readonly<Record<ReviewEntryState, string>> = {
  approved: 'Approved',
  changes_requested: 'Requested changes',
  commented: 'Reviewed',
  dismissed: 'Review dismissed',
  comment: 'Commented',
  thread: 'Review thread',
  awaiting: 'Awaiting review',
};


/**
 * The Reviews row's list is an index of people's reviews: one line per
 * verdict, remark or pending request (state glyph, avatar, name, the first
 * line, how many threads it came with, the time) pointing at the round where
 * it opens. Threads are not listed here: each is a row in its round, counted
 * on its review's line. Nothing opens in this list, so it never repeats a
 * conversation the rounds already hold.
 */
export function renderCommentsList(slot: HTMLElement, model: PanelModel, handlers: PanelHandlers): void {
  const list = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--sub`, role: 'list' });
  const entries = orderEntries(model.comments.filter((entry) => entry.state !== 'thread'));
  if (entries.length === 0) list.append(createElement('li', { class: `${PANEL_CLASS}__empty` }, [model.ingesting ? 'Reading reviews…' : 'No reviews yet.']));
  for (const entry of entries) list.append(entryRow(entry, model, handlers, true, 'pointer').row);
  // Lines are still arriving from the timeline (the verdicts above are whole: the sidebar's).
  if (model.ingesting && entries.length > 0) list.append(createElement('li', { class: `${PANEL_CLASS}__empty ${PANEL_CLASS}__empty--ingesting` }, [ingestingMark('Still reading the timeline'), 'Reading the rest of the timeline…']));
  slot.replaceChildren(list);
}

/**
 * One line for a review verdict, a person's remark or a bot's run summary:
 * state glyph, avatar, name, the first line, then the time, GitHub's own ⋯
 * (worn from the comment) and a chevron. In a round the line opens to its
 * one-bubble chat (`openSubKey` is its anchor); as a `pointer` (the Reviews
 * index) it takes the reader to that round instead. `reserveChevron`: some
 * sibling line has a chevron, so a line without one leaves that square blank
 * and its ⋯ and time stay in the column.
 */
function entryRow(entry: ReviewEntry, model: PanelModel, handlers: PanelHandlers, reserveChevron = false, mode: 'open' | 'pointer' = 'open'): { readonly row: HTMLElement; readonly open: boolean } {
  const pointer = mode === 'pointer';
  const threadCount = entry.threads?.length ?? 0;
  // A verdict without words but with threads is a way to them: in its round the line points at its first thread
  // (the others stand right beside it), so a review is never a dead line. A pending request is a fact, not a
  // conversation: nothing to open, nowhere to go.
  const opens = !pointer && entryOpens(entry);
  // A line the sidebar alone vouches for (the review's row is not on the page yet) has nowhere to go either.
  const goes = entry.state !== 'awaiting' && !isProvisional(entry) && (pointer || (!opens && isVerdict(entry) && threadCount > 0));
  const open = opens && model.openSubKey === entry.anchor;
  const bot = /\[bot\]$/i.test(entry.author);
  const lead =
    entry.state === 'thread'
      ? (() => {
          const status = createElement(
            'button',
            { type: 'button', class: `${PANEL_CLASS}__status`, 'aria-label': entry.done ? 'Unresolve' : 'Resolve', title: entry.done ? 'Unresolve conversation' : 'Resolve conversation', 'aria-pressed': String(entry.done), [ATTR_FOCUS]: `status:sub:${entry.anchor}` },
            [icon(entry.done ? ICON_CHECK_CIRCLE_FILL : ICON_CIRCLE)],
          );
          status.addEventListener('click', (event) => {
            event.stopPropagation();
            handlers.onResolveAnchor(entry.anchor, !entry.done);
          });
          return status;
        })()
      : entry.lane === 'finding'
        ? createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--verdict`, 'data-verdict': 'finding', title: 'A finding to act on', role: 'img', 'aria-label': 'A finding to act on' }, [icon(ICON_ALERT)])
        : createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--verdict`, 'data-verdict': entry.state, title: ENTRY_LABEL[entry.state], role: 'img', 'aria-label': ENTRY_LABEL[entry.state] }, [icon(ENTRY_GLYPH[entry.state])]);
  const firstThread = entry.threads?.[0]?.anchor ?? null;
  const act = (): void => {
    if (pointer) handlers.onOpenAnchor(entry.anchor);
    else if (goes && firstThread !== null) handlers.onOpenAnchor(firstThread);
    else handlers.onToggleSub(entry.anchor);
  };
  const mainChildren: Node[] = [createElement('span', { class: `${PANEL_CLASS}__name` }, [bot ? botTitle(resolveBotId(entry.author) ?? `custom:${entry.author}`, entry.author) : entry.author])];
  // A verdict without words shows only the name: the glyph already says approved / requested changes.
  if (entry.preview !== '') mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__preview` }, inlineText(entry.preview)));
  else if (entry.state === 'awaiting') mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__preview ${PANEL_CLASS}__preview--verdict` }, ['awaiting review']));
  if (entry.replies > 0) mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__pill` }, [plural(entry.replies, 'reply', 'replies')]));
  // How many threads the review (or a bot's run summary) came with: they are rows of their own in its round, this is the count.
  if ((isVerdict(entry) || entry.state === 'comment') && threadCount > 0) mainChildren.push(createElement('span', { class: `${PANEL_CLASS}__pill` }, [plural(threadCount, 'thread')]));
  const focusKey = goes ? `main:ptr:${entry.anchor}` : `main:sub:${entry.anchor}`;
  const main =
    opens || goes
      ? createElement('button', { type: 'button', class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--entry`, ...(opens ? { 'aria-expanded': String(open) } : {}), [ATTR_FOCUS]: focusKey }, mainChildren)
      : createElement('span', { class: `${PANEL_CLASS}__main ${PANEL_CLASS}__main--entry ${PANEL_CLASS}__main--static`, [ATTR_FOCUS]: focusKey }, mainChildren);
  if (opens || goes) mainClickToggles(main, act);
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (entry.time !== '') right.append(createElement('span', { class: `${PANEL_CLASS}__time`, [ATTR_TIME_FOR]: entry.anchor }, [entry.time]));
  // The times read as one column: a line with fewer squares after its time than a sibling leaves the missing
  // ones blank. In a round an opening line has a ⋯ and a chevron (two squares); in the Reviews index every line
  // that goes somewhere has one chevron and nothing else.
  const spacer = (): HTMLElement => createElement('span', { class: `${PANEL_CLASS}__spacer`, 'aria-hidden': 'true' });
  // In the Reviews index a person's verdict wears a ⋯ (dismiss, ask again, show in timeline, copy link), so every
  // line there has two squares: the ⋯ or its blank, then the chevron or its blank.
  const reviewMenu = pointer && !bot && isVerdict(entry) && !isProvisional(entry) ? reviewActions(entry, model, handlers) : null;
  const siblingSquares = reserveChevron ? 2 : 0;
  if (pointer) {
    right.append(reviewMenu ?? spacer());
    if (goes) right.append(pointerChevron(act));
    else if (siblingSquares === 2) right.append(spacer());
  } else if (goes) {
    // A verdict with threads beside reviews with comments: the ⋯ square stays blank, the chevron lines up.
    if (siblingSquares === 2) right.append(spacer());
    right.append(pointerChevron(act));
  } else if (entry.hasBody) {
    right.append(controlSlot(entry.anchor, true), chevron(open, act));
  } else {
    for (let square = 0; square < siblingSquares; square += 1) right.append(spacer());
  }
  const row = createElement(
    'li',
    { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--sub`, 'data-geld-sub': entry.anchor, 'data-state': entry.state === 'thread' ? (entry.done ? 'done' : 'open') : entry.state, ...(goes ? { 'data-pointer': '' } : {}) },
    [lead, avatarStack(entry.avatarSrc === null ? [] : [{ src: entry.avatarSrc, bot, login: entry.author }], entry.author, bot), main, right],
  );
  if (open) row.setAttribute('data-open', '');
  // The line holding the comment the URL points at wears the target ring with its slot, as the item rows do.
  if (!pointer && model.viewingAnchor === entry.anchor) row.setAttribute('data-viewing', '');
  if (opens || goes) rowClickToggles(row, act);
  return { row, open };
}

/**
 * The ⋯ on a person's verdict in the Reviews index: what GitHub lets the
 * reader do with it (dismiss it — GitHub asks the reason in its own dialog —
 * or ask the reviewer again) and the two ways to it (the timeline, a link).
 */
function reviewActions(entry: ReviewEntry, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const entries: MenuEntry[] = [];
  if (model.canDismissReviews && (entry.state === 'approved' || entry.state === 'changes_requested')) entries.push({ label: 'Dismiss review', onSelect: () => handlers.onDismissReview(entry.author) });
  if (model.canRequestReviewers) entries.push({ label: 'Re-request review', onSelect: () => handlers.onReRequestReview(entry.author) });
  entries.push({ label: 'Show in timeline', onSelect: () => handlers.onShowInTimeline(entry.anchor) });
  entries.push({ label: 'Copy link', onSelect: () => handlers.onCopyLink(entry.anchor) });
  return menu(entries, `review:${entry.anchor}`);
}

/** Lines with something to open (or to go to) first, then bare verdicts and pending requests; each run keeps its timeline order. */
function orderEntries(entries: readonly ReviewEntry[]): readonly ReviewEntry[] {
  const holds = (entry: ReviewEntry): boolean => entry.hasBody || (entry.threads?.length ?? 0) > 0;
  return [...entries.filter(holds), ...entries.filter((entry) => !holds(entry))];
}

function signatureOf(model: PanelModel): string {
  return JSON.stringify({
    freshness: model.freshness,
    truncated: model.truncated,
    openKey: model.openKey,
    collapsed: [...model.collapsedGroups].sort(),
    fullTimeline: model.fullTimeline,
    compacting: model.compacting,
    nudge: model.nudge,
    viewingAnchor: model.viewingAnchor,
    generatedAt: model.meta.generatedAt,
    headSha: model.meta.headSha,
    items: model.meta.items.map(
      (item) =>
        `${item.id}:${item.status}:${item.title}:${item.path ?? ''}:${item.context ?? ''}:${model.fixFor(item)?.text ?? ''}:${model.avatarsFor(item).map((entry) => entry.src).join(',')}:${model.resolvable(item) ? 'r' : ''}:${item.rewritten ? 'ai' : ''}:${item.sources[0] === undefined ? '' : `${model.timeFor(item.sources[0].anchor)}:${model.myReactionFor(item.sources[0].anchor) ?? ''}`}`,
    ),
    hiddenCount: model.hiddenCount,
    sinceLastVisit: model.sinceLastVisit === null ? '' : `${model.sinceLastVisit.href}:${model.sinceLastVisit.commits}`,
    pending: [...model.aiPending].sort(),
    ai: model.ai,
    tldr: model.meta.summary?.tldr ?? '',
    bots: model.meta.bots.map((bot) => `${bot.id}:${bot.verdict}:${bot.count ?? ''}:${bot.score ?? ''}:${bot.severity ?? ''}:${bot.reviewedSha}:${bot.sourceId ?? ''}`),
    reviewers: model.meta.reviewers.map((reviewer) => `${reviewer.login}:${reviewer.state}`),
    folds: model.folds.map((fold) => `${fold.key}:${fold.section}:${fold.count}:${fold.avatarSrc ?? ''}:${fold.time}:${fold.closure?.preview ?? ''}:${fold.headline === undefined ? '' : `${fold.headline.kind}${fold.headline.actor}${fold.headline.target ?? ''}${fold.headline.avatarSrc ?? ''}`}`),
    batches: model.batches.map((batch) => `${batch.key}:${batch.items.map((item) => `${item.id}${item.status}`).join(',')}:${batch.comments.map((entry) => `${entry.anchor}${entry.preview}${entry.time}${(entry.threads ?? []).map((thread) => `${thread.anchor}${thread.done ? 'd' : 'o'}`).join('')}`).join(',')}:${batch.reviews.map((entry) => `${entry.anchor}${entry.state}${(entry.threads ?? []).map((thread) => `${thread.anchor}${thread.done ? 'd' : 'o'}`).join('')}`).join(',')}:${batch.commits.length}/${batch.commitCount}:${batch.ciGlyph ?? ''}:${batch.previews.map((entry) => `${entry.anchor}${entry.status}`).join(',')}:${batch.time}:${batch.avatars.map((a) => a.src).join(',')}`),
    grouping: model.grouping,
    openCommits: [...model.openCommits].sort(),
    openPreviews: [...model.openPreviews].sort(),
    reports: model.reports.latest.map((entry) => `${entry.anchor}${entry.state}${entry.headline}${entry.project ?? ''}${(entry.short ?? []).map((part) => part.text).join('|')}`),
    requestable: model.requestable.map((bot) => `${bot.id}:${bot.presence}:${model.botIconFor(bot.id) ?? ''}`),
    checks: model.checks,
    requiredFailing: model.requiredFailing,
    previews: [...model.previews.latest, ...model.previews.archived].map((entry) => `${entry.anchor}:${entry.host}:${entry.project}:${entry.status}:${entry.url ?? ''}:${model.avatarForAnchor(entry.anchor) ?? ''}`),
    archivedPreviewsOpen: model.archivedPreviewsOpen,
    ring: model.checksRing?.outerHTML.length ?? 0,
    reviews: model.reviews,
    comments: model.comments.map((entry) => `${entry.anchor}:${entry.state}:${entry.done ? 'd' : 'o'}:${entry.preview}:${entry.time}:${entry.replies}:${entry.myReaction ?? ''}:${entry.avatarSrc ?? ''}:${entry.parent ?? ''}:${(entry.threads ?? []).map((thread) => `${thread.anchor}${thread.done ? 'd' : 'o'}`).join('|')}`),
    reviewerGroups: model.reviewerGroups.map((group) => `${group.state}:${group.reviewers.map((reviewer) => `${reviewer.login}${reviewer.src}`).join(',')}`),
    reviewerStatuses: model.reviewerStatuses.map((status) => `${status.login}:${status.verdict ?? ''}:${status.awaiting ? 'a' : ''}:${status.anchor ?? ''}`),
    canRequestReviewers: model.canRequestReviewers,
    canDismissReviews: model.canDismissReviews,
    ingesting: model.ingesting,
    openSubKey: model.openSubKey,
    openSources: [...model.openSources].sort(),
    refs: model.refsVersion,
    edits: model.editsVersion,
    running: model.running,
    icons: model.meta.bots.map((bot) => model.botIconFor(bot.id) ?? ''),
  });
}

/**
 * The description's bordered card. The panel is inserted right after it,
 * inside the same column, so the two read as one box.
 */
function descriptionCard(): HTMLElement | null {
  const classic =
    document.querySelector<HTMLElement>('.js-discussion > .js-timeline-item .timeline-comment') ??
    document.querySelector<HTMLElement>('#discussion_bucket .js-comment-container .timeline-comment');
  if (classic !== null) return classic;
  const react = document.querySelector<HTMLElement>('[data-testid="issue-body"]');
  if (react !== null) return react.closest<HTMLElement>('[data-testid="issue-body-viewer"], [class*="IssueBody"]') ?? react;
  return document.querySelector<HTMLElement>('.timeline-comment');
}

export interface MountedPanel {
  readonly root: HTMLElement;
  /** Body of the open row's slot, or null when nothing is open. */
  readonly slot: HTMLElement | null;
}

/**
 * Put `node` where `target` is, keeping what a plain move loses: a scroll
 * box's position and running animations (`Element.moveBefore`, Chrome 133+;
 * elsewhere a plain move, which is what happened before anyway).
 */
function movePreservingState(node: HTMLElement, target: HTMLElement): void {
  const parent = target.parentElement;
  if (parent === null) return;
  const mover: unknown = Reflect.get(parent, 'moveBefore');
  if (typeof mover === 'function') {
    try {
      Reflect.apply(mover, parent, [node, target]);
      target.remove();
      return;
    } catch {
      // Fall through to a plain move.
    }
  }
  target.replaceWith(node);
}

/** On the panel root: what was open when it was built, so a held rebuild can tell a click from late content. */
const ATTR_OPEN = 'data-geld-review-open';

export interface MountOptions {
  /**
   * Content is still landing in bursts (deferred threads, four fetches at a
   * time): keep the panel that stands while the open row is the same, and
   * rebuild once the burst has settled. A rebuild per landing sent the open
   * chat home and back every few hundred milliseconds.
   */
  readonly holdRebuild?: boolean;
}

export function mountPanel(model: PanelModel, handlers: PanelHandlers, options: MountOptions = {}): MountedPanel | null {
  const existing = document.querySelector<HTMLElement>(`.${PANEL_CLASS}[${ATTR_PANEL}]`);
  const signature = signatureOf(model);
  const openNow = `${model.openKey ?? ''}|${model.openSubKey ?? ''}`;
  if (existing !== null && existing.isConnected) {
    const slot = existing.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`);
    if (existing.getAttribute(ATTR_SIG) === signature) return { root: existing, slot };
    if (options.holdRebuild === true && existing.getAttribute(ATTR_OPEN) === openNow) return { root: existing, slot };
    // Someone is typing in GitHub's reply box inside the slot: a rebuild would move it and drop focus. Wait.
    const active = document.activeElement;
    if (slot !== null && active instanceof Element && slot.contains(active) && active.matches('textarea, input, [contenteditable]')) return { root: existing, slot };
    // The Request a review menu is open with boxes ticked: a rebuild would close it and lose the picks. Wait.
    if (existing.querySelector(`.${PANEL_CLASS}__request[open]`) !== null) return { root: existing, slot };
  }
  const card = descriptionCard();
  if (card === null) return null;
  const focusKey = focusKeyOf(existing);
  // The open CI checks slot holds GitHub's own live section: a scroll box with spinners in it, always current on
  // its own. Sending it home and taking it back on every rebuild (the counts tick every few seconds on a busy
  // PR) reset its scroll position and restarted every spinner at the same frame, so they looked frozen and the
  // list jumped to its top. It is carried into the new panel instead, with a move that keeps its state.
  const carried = existing !== null && model.openKey === CHECKS_KEY ? existing.querySelector<HTMLElement>(`[${ATTR_SLOT}="${CHECKS_KEY}"] > .${PANEL_CLASS}__slot-body`) : null;
  // Quick-viewed nodes live inside the old panel; send them home before it goes.
  restoreAll(carried === null ? undefined : (node) => carried.contains(node));
  if (existing !== null) reclaimOrphans(existing, carried ?? undefined);
  for (const stale of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) {
    if (stale !== card) stale.removeAttribute(ATTR_ATTACHED);
  }
  card.setAttribute(ATTR_ATTACHED, '');
  // Read before anything moves: this forces a layout, and a layout with the old panel gone and the new one not
  // yet in makes the browser's scroll anchoring shift the page up by the panel's height — and it does not shift
  // it back when the new panel lands. The old panel is replaced in one mutation below, never removed first.
  // The description card may hang past the timeline rail (`ml-n3`); share its horizontal geometry.
  const cardStyle = getComputedStyle(card);
  const cardMargins = { left: cardStyle.marginLeft, right: cardStyle.marginRight };

  const { open, done } = splitItems(model.meta.items);
  const total = model.meta.items.length;
  const doneCount = doneItemCount(model.meta.items);
  const waiting = model.meta.items.filter((item) => item.status === 'needs-reply').length;

  /* Summary strip: the meter only once there is something to measure. */
  const summary = createElement('div', { class: `${PANEL_CLASS}__summary` }, [createElement('span', { class: `${PANEL_CLASS}__brand` }, ['Geld']), progressMeter(doneCount, total, 'review item')]);
  if (waiting > 0) summary.append(createElement('span', { class: `${PANEL_CLASS}__chip`, 'data-tone': 'attention' }, [`${waiting} need${waiting === 1 ? 's' : ''} a reply`]));
  // GitHub's revision marker, said here instead of as a timeline row: a button to that diff (the marker's own
  // "View changes" URL), the same small button the timeline's Compare and Details are; the count is its tooltip.
  if (model.sinceLastVisit !== null) {
    const title = model.sinceLastVisit.commits > 0 ? `${plural(model.sinceLastVisit.commits, 'new commit')} since you last viewed this pull request` : 'New changes since you last viewed this pull request';
    summary.append(createElement('a', { class: `btn btn-sm ${PANEL_CLASS}__since-visit`, href: model.sinceLastVisit.href, title, 'aria-label': title, [ATTR_FOCUS]: 'since-last-visit' }, [icon(ICON_FILE_DIFF), createElement('span', {}, ['New changes'])]));
  }
  if (model.freshness === 'stale' || model.freshness === 'partial') summary.append(createElement('span', { class: `${PANEL_CLASS}__fresh` }, ['Updating…']));
  const tools = createElement('div', { class: `${PANEL_CLASS}__tools` });
  const aiControl = aiButton(model.ai, handlers);
  if (aiControl !== null) tools.append(aiControl);
  tools.append(groupingMenu(model, handlers));
  const copy = iconButton(ICON_COPY, 'Copy digest as Markdown', { [ATTR_FOCUS]: 'copy' });
  copy.addEventListener('click', () => handlers.onCopy());
  tools.append(copy);
  const head = createElement('div', { class: `${PANEL_CLASS}__head` }, [summary, tools]);
  const aiNote = aiNotice(model.ai, handlers);
  const status = statusRows(model, handlers);
  const tldrPending = model.aiPending.has('tldr');
  const tldr =
    model.meta.summary !== undefined
      ? createElement('p', { class: `${PANEL_CLASS}__tldr`, ...(tldrPending ? { 'data-pending': '' } : {}) }, [model.meta.summary.tldr])
      : tldrPending
        ? createElement('p', { class: `${PANEL_CLASS}__tldr`, 'data-pending': '', 'aria-label': 'Writing the summary' }, [
            createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 78%' }),
            createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 52%' }),
          ])
        : null;

  /* Groups */
  const rows = createElement('ul', { class: `${PANEL_CLASS}__rows`, role: 'list' });
  const appendBatches = (batches: readonly Batch[]): void => {
    for (const batch of batches) {
      rows.append(batchRow(batch, model, handlers));
      if (model.openKey === batch.key) rows.append(slotRow(batch.key, null, 'list'));
    }
  };
  if (model.grouping === 'batch') {
    // By push: the open threads first, wherever they landed, then every round newest first.
    const openItems = model.meta.items.filter((item) => isOpenStatus(item.status));
    if (openItems.length > 0) {
      rows.append(groupHeading('open', `Needs attention · ${plural(openItems.length, 'open thread')}`, model, handlers));
      if (!model.collapsedGroups.has('open')) {
        for (const item of openItems) {
          rows.append(itemRow(item, model, handlers));
          if (model.openKey === itemKey(item.id)) rows.append(slotRow(model.openKey));
        }
      }
    }
    rows.append(groupHeading('pushes', plural(model.batches.length, 'push', 'pushes'), model, handlers));
    if (!model.collapsedGroups.has('pushes')) appendBatches([...model.batches].reverse());
  }
  // Rounds with a thread still open come first and stay open; settled rounds fold away by default. By type a round
  // is its review content, so a run of commits that nothing followed (the last pushes of a PR nobody has reviewed
  // yet) is no round at all - its commits are in the Commits fold. By push the same run is a push and stays.
  const withContent = model.batches.filter((batch) => batch.items.length + batch.comments.length + batch.reviews.length + batch.previews.length > 0);
  const attention = model.grouping === 'batch' ? [] : withContent.filter((batch) => batch.items.some((item) => isOpenStatus(item.status)));
  const settled = model.grouping === 'batch' ? [] : withContent.filter((batch) => !attention.includes(batch));
  if (attention.length > 0) {
    rows.append(groupHeading('open', `${plural(attention.length, 'round')} to review · ${plural(open.length, 'open thread')}`, model, handlers));
    if (!model.collapsedGroups.has('open')) appendBatches(attention);
  }
  if (settled.length > 0) {
    rows.append(groupHeading('done', done.length > 0 ? plural(done.length, 'resolved thread') : plural(settled.length, 'settled round'), model, handlers));
    if (!model.collapsedGroups.has('done')) appendBatches(settled);
  }
  if (!model.fullTimeline && model.grouping !== 'batch') {
    // Comments that need nothing from the reader (bot run summaries, review requests), then the timeline's activity.
    const other = model.folds.filter((fold) => fold.section === 'comments');
    const activity = model.folds.filter((fold) => fold.section === 'activity');
    const appendFolds = (folds: readonly FoldRow[]): void => {
      for (const fold of folds) {
        rows.append(foldRowEl(fold, model, handlers));
        // One comment under its row (a closure's too: its event is the row): the row is the header, the slot the body.
        if (model.openKey === foldKey(fold.key)) rows.append(slotRow(model.openKey, null, fold.count === 1 || fold.closure !== undefined ? 'solo' : null));
      }
    };
    if (other.length > 0) {
      rows.append(groupHeading('hidden', plural(other.reduce((sum, fold) => sum + fold.count, 0), 'other item'), model, handlers));
      if (!model.collapsedGroups.has('hidden')) appendFolds(other);
    }
    if (activity.length > 0) {
      rows.append(groupHeading('activity', 'Other activity', model, handlers));
      if (!model.collapsedGroups.has('activity')) appendFolds(activity);
    }
  }

  const panel = createElement('section', { class: PANEL_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_PANEL]: '', [ATTR_SIG]: signature, [ATTR_OPEN]: openNow, 'aria-label': 'Geld review digest' }, [
    head,
    ...(aiNote === null ? [] : [aiNote]),
    ...(status === null ? [] : [status]),
    ...(tldr === null ? [] : [tldr]),
    rows,
  ]);

  /* Footer */
  if (model.truncated) {
    panel.append(createElement('div', { class: `${PANEL_CLASS}__foot` }, [createElement('p', { class: `${PANEL_CLASS}__note` }, ['The summary was truncated. The rest of the discussion is still in the timeline.'])]));
  }
  if (model.compacting && (model.hiddenCount > 0 || model.fullTimeline)) {
    // The one control for the timeline itself, shaped like GitHub's own "N hidden items · Load more" bar.
    const toggle = createElement('button', { type: 'button', class: `${PANEL_CLASS}__timeline-btn`, 'aria-pressed': String(model.fullTimeline), [ATTR_FOCUS]: 'timeline' }, [
      model.fullTimeline ? 'Compact timeline' : `Show ${plural(model.hiddenCount, 'hidden item')} in the timeline`,
    ]);
    toggle.addEventListener('click', () => handlers.onFullTimeline());
    panel.append(createElement('div', { class: `${PANEL_CLASS}__timeline` }, [toggle]));
  }

  panel.style.marginLeft = cardMargins.left;
  panel.style.marginRight = cardMargins.right;
  const freshBody = carried === null ? null : panel.querySelector<HTMLElement>(`[${ATTR_SLOT}="${CHECKS_KEY}"] > .${PANEL_CLASS}__slot-body`);
  if (existing !== null && existing.parentNode !== null) {
    if (carried !== null && freshBody !== null) {
      // Both panels in the document for the move, so the carried body never leaves it; the old panel goes after.
      existing.before(panel);
      movePreservingState(carried, freshBody);
      existing.remove();
    } else {
      existing.replaceWith(panel);
    }
  } else {
    card.insertAdjacentElement('afterend', panel);
  }
  syncSpinners(panel);
  // A card open over the old panel points at a host that just left the document.
  rehostHoverCard();
  // Below the box, not in it: a quiet, persistent pointer to the Action while this repository lacks it.
  const oldNudge = document.querySelector(`.${NUDGE_CLASS}`);
  if (model.nudge) {
    const nudge = createElement('p', { class: NUDGE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, ['Built from this page. Add the Geld Action to this repository and the digest is ready before the page opens. ']);
    nudge.append(createElement('a', { class: `${NUDGE_CLASS}__link`, href: 'https://www.geld.sh/how-it-works#summary', target: '_blank', rel: 'noreferrer' }, ['See how']), document.createTextNode('.'));
    // The card hangs over the timeline rail (ml-n3) and covers it; plain text cannot, so start it past the rail.
    nudge.style.marginRight = cardMargins.right;
    if (oldNudge !== null) {
      // Same reason as the panel: swapped in place, and its indent carried over so no layout is forced here.
      nudge.style.paddingLeft = oldNudge instanceof HTMLElement ? oldNudge.style.paddingLeft : '';
      oldNudge.replaceWith(nudge);
      if (nudge.style.paddingLeft === '') nudge.style.paddingLeft = `${railIndent(nudge)}px`;
    } else {
      panel.insertAdjacentElement('afterend', nudge);
      nudge.style.paddingLeft = `${railIndent(nudge)}px`;
    }
  } else {
    oldNudge?.remove();
  }
  restoreFocus(panel, focusKey);
  return { root: panel, slot: panel.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`) };
}

/** Pixels from the nudge's left edge to just past the timeline rail (GitHub draws it at a TimelineItem's left edge). */
function railIndent(nudge: HTMLElement): number {
  const item = document.querySelector('.js-discussion .TimelineItem, .js-timeline-item .TimelineItem, .TimelineItem, [class*="TimelineItem"]');
  if (!(item instanceof HTMLElement)) return 24;
  const rail = item.getBoundingClientRect().left + 2;
  return Math.max(0, Math.round(rail - nudge.getBoundingClientRect().left) + 14);
}

export function unmountPanel(): void {
  restoreAll();
  const panel = document.querySelector(`.${PANEL_CLASS}[${ATTR_PANEL}]`);
  if (panel !== null) reclaimOrphans(panel);
  panel?.remove();
  document.querySelector(`.${NUDGE_CLASS}`)?.remove();
  for (const card of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) card.removeAttribute(ATTR_ATTACHED);
}

