import { firstSentence } from '@geld/review';
import { fetchNonce, pullPathOf, timelineCommentRequest } from './timeline-comment';

export { pullPathOf, timelineCommentRequest };
import { loadWriter, prefetchWriter, writerNow } from './comment-writer';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import type { HeaderStatGroup } from './header-stats';
import { detectHeadSha } from './head-sha';
import type { MergeActions, MergeBox, MergeMethod, StatusAction } from './merge-actions';
import { actionErrorText, autoMergeRequest, closeRequest, draftRequest, fetchMergeBox, METHOD_CONFIRM, METHOD_LABEL, mergeRequest, readMergeActions, queueRequest, readyRequest, reopenRequest, stackQueueRequest, viewerVerdict } from './merge-actions';
import type { PageInfo } from './page';
import { pullRequestStateWords } from './page';
import type { PendingComment } from './pending-review';
import { discardPendingReview, fetchPendingComments, linkOnFilesTab, pendingCountOnPage } from './pending-review';
import { inlineText } from './review/inline-text';
import type { SidebarReviewer, SidebarReviewerState } from './review/crawler';
import { catchUpTimeline } from './review/timeline-catchup';
import type { ReviewTally } from './review-tally';
import type { PullStatus, StackAction, StackChoice, StackGroup, StatusOption } from './status-pill';
import { ATTR_INSTANT_MERGE, rememberStatusHint, removeStatusPills, showMergedPills, STATUS_INFO, stackConfirmWords, stackGroups, statusHint, statusOf, statusOptions, syncStatusPills } from './status-pill';
import { fetchReviewers, REVIEW_BY_HASH, REVIEWS_HASH, reviewLink, standingReviewers, tallyOf, tallyWords } from './review-tally';
import { ICON_ALERT_FILL_12, ICON_CHECK, ICON_CHECK_SEND, ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT, ICON_CODE_REVIEW, ICON_CODE_REVIEW_SEND, ICON_COMMENT, ICON_COMMENT_SEND, ICON_GIT_MERGE, ICON_GIT_MERGE_QUEUE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT, ICON_SPINNER, ICON_TRASH, ICON_TRIANGLE_DOWN, ICON_X, ICON_X_SEND } from './ui/icons';

/**
 * The review controls in the pull request's tab bar, left of the line
 * counts, on every tab: one button group, [✓ | ✗ | 💬], Approve, Request
 * changes and Comment. A click opens the comment box with that verdict
 * chosen, so the box is also the confirmation; ⌘-click (Ctrl-click off a
 * Mac) on ✓ or ✗ sends it at once without a comment, while 💬 always opens
 * the box, being there for the words. GitHub's own Submit review exists
 * only on the Files changed tab and is React's, so this is Geld's, and it
 * sends the request GitHub's dialog sends (`PUT page_data/submit_review`,
 * verified Oct 2026), which needs nothing from that tab. While it is
 * mounted GitHub's button is hidden, so the action shows once.
 */

export type ReviewEvent = 'comment' | 'approve' | 'request changes';

/** What opened the box: a review segment, or the merge or close button. */
type Opener = ReviewEvent | StatusAction;

function isReviewEvent(opener: Opener): opener is ReviewEvent {
  return opener === 'approve' || opener === 'request changes' || opener === 'comment';
}

export interface ReviewSubmission {
  readonly body: string;
  readonly event: ReviewEvent;
  readonly headSha: string;
}

export interface QuickReviewContext {
  readonly page: PageInfo;
  /** The page's header stat groups; the button goes before the tab bar's. */
  readonly groups: readonly HeaderStatGroup[];
  /** The head commit when the review is sent (it may move while the popover is open). */
  readonly headSha: () => string | null;
  /** Whether the conversation digest is on: then `#geld-reviews` waits for its Reviews row rather than settle for the sidebar. */
  readonly digest?: boolean;
}

const GROUP_CLASS = 'geld-quick-review';
const PANEL_CLASS = 'geld-quick-review__panel';
/** On `<html>` while the button is mounted; the stylesheet hides GitHub's own review button under it. */
const ATTR_ACTIVE = 'data-geld-quick-review';
/** On the box holding the button and the counts; the stylesheet centres both on the tabs there. */
const ATTR_HOST = 'data-geld-quick-review-host';
/** On the group while it rides a sticky header: `toolbar` (Files changed, where GitHub's own button would be) or `header` (every other tab). */
const ATTR_PLACE = 'data-geld-place';
/** GitHub's own review control, React's Files changed view or the classic one; hidden while the group is mounted. */
const GITHUB_REVIEW_CONTROL = '[class*="ReviewMenuButton"], details.js-reviews-container';
/** The toolbar that holds it and sticks to the top of the viewport as the diff scrolls. */
const STICKY_TOOLBAR = 'section[class*="stickyHeader"], .js-sticky';
const STICKY_REVIEW_CONTROL = `:is(${STICKY_TOOLBAR}) :is(${GITHUB_REVIEW_CONTROL})`;
/** The compact pull request header the other tabs show once the page header has scrolled away: `display: none` until it sticks. */
const STICKY_PR_HEADER = '[class*="prHeader"][class*="stickyHeader"]';
/** The headers that stay put as the page scrolls, React's and the classic one: a box under a pill there is fixed. */
const STICKY_HEADERS = '[class*="stickyHeader"], .gh-header-sticky';

type Place = 'toolbar' | 'header';
const SUBMITTED_MS = 3000;
/** On the group while the instant key is held: ✓ and ✗ then send on a click, and the stylesheet swaps their glyphs for the sending ones. */
const ATTR_INSTANT = 'data-instant';
/** On the group while comments are pending: ⌘-click on 💬 then submits them, and its glyph says so while the key is held. */
const ATTR_PENDING = 'data-pending';
/** On the segment whose review is on its way: its glyph gives way to a spinner in the same colour. */
const ATTR_SENDING = 'data-sending';
/** On 💬: the kind its box will post (`comment` or `review`), which its glyph shows. */
const ATTR_KIND = 'data-kind';

interface EventInfo {
  readonly value: ReviewEvent;
  readonly label: string;
  /** Whether the pull request's author may take it: GitHub refuses an author's own approval and request for changes. */
  readonly authorMay: boolean;
  /** The segment's glyph. */
  readonly icon: string;
  /** Its glyph while the instant key is held, for the verdicts a ⌘-click sends at once. */
  readonly instantIcon: string | null;
  /** The submit button's look in the comment box, as GitHub colours these verdicts. */
  readonly submitClass: string;
  /** What the controls say for a moment after it went through. */
  readonly done: string;
}

const EVENT_INFO: { readonly [E in ReviewEvent]: EventInfo } = {
  comment: { value: 'comment', label: 'Comment', authorMay: true, icon: ICON_COMMENT, instantIcon: ICON_COMMENT_SEND, submitClass: '', done: 'Review submitted' },
  approve: {
    value: 'approve',
    label: 'Approve',
    authorMay: false,
    icon: ICON_CHECK,
    instantIcon: ICON_CHECK_SEND,
    submitClass: 'btn-primary',
    done: 'Approved',
  },
  'request changes': {
    value: 'request changes',
    label: 'Request changes',
    authorMay: false,
    icon: ICON_X,
    instantIcon: ICON_X_SEND,
    submitClass: 'geld-quick-review__submit--danger',
    done: 'Changes requested',
  },
};

/** The segments, left to right: the verdicts first, the comment last (it carries the pending count). */
const SEGMENT_ORDER: readonly ReviewEvent[] = ['approve', 'request changes', 'comment'];

/** Whether a click asked to send at once, without the box: ⌘ on a Mac, Ctrl elsewhere, on ✓ or ✗, and on 💬 while comments are pending (it then submits them). */
export function isInstantClick(event: ReviewEvent, click: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, mac: boolean, pending = false): boolean {
  return (event !== 'comment' || pending) && (mac ? click.metaKey : click.ctrlKey);
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const INSTANT_KEY = MAC ? '⌘' : 'Ctrl';

/**
 * A segment's tooltip, one entry per line: its verdict and the key for a
 * 1-click review, or what a click does while that key is held.
 */
export function segmentHint(event: ReviewEvent, instantKey: string, held = false, pending = false, kind: CommentKind = 'comment'): readonly string[] {
  const info = EVENT_INFO[event];
  if (event === 'comment') {
    const label = kind === 'review' ? 'Review' : info.label;
    if (!pending) return [label];
    return held ? ['Submit pending comments'] : [label, `${instantKey} 1-click review`];
  }
  if (held) return [`${info.label} without comments`];
  return [info.label, `${instantKey} 1-click review`];
}

/** What GitHub's review dialog sends, from the page's own origin and session. */
export function submitReviewRequest(pullPath: string, submission: ReviewSubmission, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'GitHub-Verified-Fetch': 'true',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (nonce !== '') headers['X-Fetch-Nonce'] = nonce;
  return {
    url: `${pullPath}/page_data/submit_review`,
    init: { method: 'PUT', credentials: 'same-origin', headers, body: JSON.stringify({ body: submission.body, event: submission.event, headSha: submission.headSha }) },
  };
}

/** An approval needs no words; a comment or a request for changes needs them, unless pending comments go with it. */
export function canSubmit(event: ReviewEvent, body: string, pendingComments: boolean): boolean {
  return event === 'approve' || body.trim() !== '' || pendingComments;
}

/** The reason a submission failed, in GitHub's words when it gave any. */
export function reviewErrorText(status: number, payload: unknown): string {
  const said = messageOf(payload);
  return said === null ? `GitHub could not submit the review (HTTP ${status}).` : `GitHub could not submit the review: ${said}`;
}

function messageOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  for (const key of ['error', 'message']) {
    const value: unknown = Reflect.get(payload, key);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  const errors: unknown = Reflect.get(payload, 'errors');
  if (!Array.isArray(errors)) return null;
  const words: string[] = [];
  for (const entry of errors) {
    const said = typeof entry === 'string' ? entry.trim() : messageOf(entry);
    if (said !== null && said !== '') words.push(said);
  }
  return words.length > 0 ? words.join(' ') : null;
}

function viewerLogin(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content.trim() ?? '';
}

/** The pull request's author as the page header names them ("X wants to merge"), in either UI. */
function authorLogin(): string | null {
  const react = [...document.querySelectorAll<HTMLAnchorElement>('[data-component="PageHeader"] a.text-bold[href]')].find((link) => /^\/[^/]+\/?$/.test(link.getAttribute('href') ?? ''));
  const legacy = document.querySelector<HTMLAnchorElement>('.gh-header-meta a.author');
  const login = (react ?? legacy)?.textContent?.trim().replace(/^@/, '') ?? '';
  return login === '' ? null : login;
}

/** The tab bar's line counts: the group in the pull request header (not a diff's, not Geld's narrow mirror). */
function anchorOf(groups: readonly HeaderStatGroup[]): HTMLElement | null {
  for (const group of groups) {
    const host = group.host;
    if (!host.isConnected || host.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    // GitHub hides the header's counts on narrow screens: placed there, the button would be hidden with them while
    // GitHub's own was hidden for it, leaving no way to review. A style read, not a layout one.
    if (!host.checkVisibility()) continue;
    if (host.id === 'diffstat' || host.closest('[data-component="PageHeader"], .gh-header, #partial-discussion-header') !== null) return host;
  }
  return null;
}

const STAND_CLASS = 'geld-quick-review__stand';
const MARK_CLASS = 'geld-quick-review__mark';

/**
 * Where the group stands when the tab bar has no line counts: GitHub leaves them out for a change of binary files only
 * (mintlify/landing#886), its counts wrapper rendered empty, and the group had nowhere to go. A mark of Geld's goes
 * into that wrapper — floated to the row's end, hidden on a narrow header — or, with no wrapper at all, into a stand
 * of Geld's own in its place and shape. Only while it shows, so GitHub's own review button is never hidden with
 * nothing in its place.
 */
function standAnchor(): HTMLElement | null {
  const row = [...document.querySelectorAll<HTMLElement>('[data-component="PageHeader"] [class*="PageHeader-Navigation"]')].find((el) => el.querySelector('nav[class*="TabNav"]') !== null) ?? null;
  if (row === null) {
    removeStand();
    return null;
  }
  let home = row.querySelector<HTMLElement>(':scope > [class*="rightContentWrapper"]');
  if (home === null) {
    home = row.querySelector<HTMLElement>(`:scope > .${STAND_CLASS}`) ?? createElement('div', { class: STAND_CLASS, [OWN_UI_ATTRIBUTE]: '' });
    if (home.parentElement !== row) row.prepend(home);
  } else {
    row.querySelector(`:scope > .${STAND_CLASS}`)?.remove();
  }
  let mark = home.querySelector<HTMLElement>(`:scope > .${MARK_CLASS}`);
  if (mark === null) {
    document.querySelector(`.${MARK_CLASS}`)?.remove();
    mark = createElement('span', { class: MARK_CLASS, [OWN_UI_ATTRIBUTE]: '' });
    home.append(mark);
  }
  return home.checkVisibility() ? mark : null;
}

function removeStand(): void {
  document.querySelector(`.${MARK_CLASS}`)?.remove();
  document.querySelector(`.${STAND_CLASS}`)?.remove();
}

/** What 💬's box posts: a comment on the conversation, or a review (which carries the pending comments). */
export type CommentKind = 'comment' | 'review';

interface Draft {
  body: string;
  event: ReviewEvent;
  /** The reader's choice for 💬's box; null until they make one, when pending comments decide (a review with them, a comment without). */
  kind: CommentKind | null;
}

interface Mounted {
  /** What is placed in the tab bar: the group, with the status line before it. */
  readonly root: HTMLElement;
  readonly segments: { readonly [E in ReviewEvent]: HTMLButtonElement };
  /** Primer's button group holding the segments the reader may use. */
  readonly group: HTMLElement;
  /** "Approved", "Submitting…": what the controls have just done, read out as it changes. */
  readonly status: HTMLElement;
  host: HTMLElement | null;
  /** On the group's top-right corner: the reader's pending comments, as GitHub's button counts them. */
  readonly counter: HTMLElement;
  /** The button the open box came from, for its pressed look and for focus when it closes. */
  opener: Opener | null;
  /** Geld's status pills in the header (and the sticky header), standing in for GitHub's while the reader may change the status. */
  pills: readonly HTMLButtonElement[];
  /** The pill the status menu, or a box chosen from it, came from: the box hangs under it and focus goes back to it. */
  statusOpener: HTMLButtonElement | null;
  statusMenu: HTMLElement | null;
  /** Ends the open status menu's listeners. */
  statusMenuKeys: AbortController | null;
  /** "3 ✓ 1 ✗ 3 💬": how the reviews stand, left of the group, for reading only. */
  readonly tally: HTMLAnchorElement;
  /** The reviewers the tally counts, for its snapshot card. */
  reviewers: readonly SidebarReviewer[];
  /** The review the reader just sent, held over GitHub's reads until `OWN_REVIEW_HOLD_MS` has passed (`heldReview`). */
  ownReview: OwnReview | null;
  /** The snapshot card while it shows, and the timer that shows or hides it. */
  snapshot: HTMLElement | null;
  snapshotTimer: number;
  /** What the merge box last said the reader may do, for {@link mergeFor}; null until read. */
  mergeActions: MergeActions | null;
  mergeFor: string | null;
  /** Each read of the merge box takes the next number: an answer from a read a newer one replaced is dropped, whatever order they land in. */
  mergeRead: number;
  /** The header's state label when the merge box was last read for it: a draft converted or marked ready, a merge or close in place, changes it. */
  stateWords: string | null;
  mergeTimer: number;
  isAuthor: boolean | null;
  pullPath: string;
  context: QuickReviewContext;
  /** The open comment box. */
  panel: HTMLElement | null;
  /** Gives the open box another verdict, keeping its words. */
  retarget: ((event: ReviewEvent) => void) | null;
  /** The open box's own refresh: a send finishing for another box (one closed meanwhile) re-enables this one. */
  panelRefresh: (() => void) | null;
  /** What the open box set up outside itself (the kind menu's window listeners), undone when the box closes. */
  panelCleanup: (() => void) | null;
  /** A review on its way: the controls and the box wait for it. */
  sending: boolean;
  submittedTimer: number;
  /** The pending comments last read for {@link pendingFor}; null until read (or when GitHub could not say). */
  pending: readonly PendingComment[] | null;
  /** The pull request and tab they were read on (`pendingKey`): a tab switched to reads them again, since another may have changed them. */
  pendingFor: string | null;
  /** Stops following the instant key. */
  readonly keys: AbortController;
  /** The tab bar's line counts the group stands before, from the last pass. */
  anchor: HTMLElement | null;
  /** The sticky headers being watched for when they stick (the Files changed toolbar, the compact header), and the watch. */
  toolbar: Element | null;
  header: Element | null;
  readonly stickyWatch: MutationObserver;
  /** Whether the Files changed toolbar is stuck, read from its box on scroll (never on a pass, which must not measure). */
  toolbarStuck: boolean;
}

let mounted: Mounted | null = null;
const drafts = new Map<string, Draft>();

/** A sent box's words go, unless the reader has written others since; the Comment / Review choice is the reader's for the visit and stays. */
function clearDraft(pullPath: string, sent: string): void {
  const draft = drafts.get(pullPath);
  if (draft !== undefined && draft.body !== sent) return;
  drafts.set(pullPath, { body: '', event: 'comment', kind: draft?.kind ?? null });
}

function draftFor(pullPath: string): Draft {
  let draft = drafts.get(pullPath);
  if (draft === undefined) {
    draft = { body: '', event: 'comment', kind: null };
    drafts.set(pullPath, draft);
  }
  return draft;
}

/** Place (or keep) the button before the tab bar's line counts; remove it where it does not belong. */
export function applyQuickReview(enabled: boolean, context: QuickReviewContext): void {
  const pullPath = pullPathOf(window.location.pathname);
  if (!enabled || !context.page.kind.startsWith('pull') || pullPath === null || viewerLogin() === '') {
    removeQuickReview();
    return;
  }
  // The controls' state lives on the pull request page whether or not the review group has somewhere to stand: the
  // status pill in the header needs it, and on narrow screens (GitHub hides the counts) the group stands aside alone.
  const counted = anchorOf(context.groups);
  if (counted !== null) removeStand();
  const anchor = counted ?? standAnchor();
  if (mounted === null) mounted = createControls(pullPath, context);
  if (mounted.pullPath !== pullPath) {
    closePanel();
    hideSnapshot(mounted);
    mounted.pullPath = pullPath;
    mounted.tally.href = `${pullPath}${REVIEWS_HASH}`;
    // The last pull request's merge, close and standing verdict are not this one's: none until its merge box is read.
    mounted.mergeActions = null;
    mounted.stateWords = null;
    showStatus(mounted);
    showVerdict(mounted, null);
    // The last pull request's pending comments are not this one's: none until this one's are read.
    mounted.pending = null;
    // Another pull request's counts (and the reviewers behind them) never stand in for this one's: nothing until its reviews are read.
    mounted.reviewers = [];
    showTally(mounted, { approved: 0, changesRequested: 0, commented: 0 });
  }
  mounted.context = context;
  followReviewHash(context);
  if (mounted.pendingFor !== pendingKey(mounted)) void loadPending(mounted);
  // GitHub turns a draft ready (and back), merges and closes in place: what the reader may do changes with the label.
  const stateWords = pullRequestStateWords();
  const stateChanged = stateWords !== '' && mounted.stateWords !== null && mounted.stateWords !== stateWords;
  if (stateWords !== '') mounted.stateWords = stateWords;
  if (mounted.mergeFor !== pullPath || stateChanged) void loadMergeActions(mounted);
  showCount(mounted);
  showAuthor(mounted);
  showStatus(mounted);
  if (anchor === null) {
    unplace(mounted);
    return;
  }
  mounted.anchor = anchor;
  watchSticky(mounted);
  place(mounted);
  const host = anchor.parentElement;
  if (mounted.host !== host) {
    mounted.host?.removeAttribute(ATTR_HOST);
    mounted.host = host;
  }
  if (host !== null && !host.hasAttribute(ATTR_HOST)) host.setAttribute(ATTR_HOST, '');
  // Written only when it changes: every write is a mutation record, and passes run on mutations.
  if (!document.documentElement.hasAttribute(ATTR_ACTIVE)) document.documentElement.setAttribute(ATTR_ACTIVE, '');
}

function isStuck(element: Element): boolean {
  // React's class is `is-stuck__<hash>`, the classic toolbar's `is-stuck`.
  return [...element.classList].some((name) => name === 'is-stuck' || name.startsWith('is-stuck__'));
}

/**
 * Whether the Files changed toolbar is stuck, from its box: a sticky element
 * stands at its `top` once stuck and below it in its place. GitHub's own
 * `is-stuck` class comes a frame after the toolbar has visibly stuck (its
 * observer reports after paint), the first time noticeably, so the class
 * alone left the toolbar showing without the group for a moment.
 */
function measureToolbarStuck(toolbar: Element): boolean {
  const top = Number.parseFloat(getComputedStyle(toolbar).top);
  return toolbar.getBoundingClientRect().top <= (Number.isFinite(top) ? top : 0) + 0.5;
}

/**
 * Where the group rides while a sticky header shows: the Files changed
 * toolbar just before GitHub's hidden review button, or the end of the
 * compact pull request header's title row the other tabs show; null while neither is
 * stuck, the group in view in the tab bar.
 */
function stickyPlace(state: Mounted): { readonly place: Place; readonly put: (root: HTMLElement) => void; readonly placed: (root: HTMLElement) => boolean } | null {
  const control = document.querySelector<HTMLElement>(STICKY_REVIEW_CONTROL);
  if (control !== null) {
    if (!state.toolbarStuck) return null;
    return { place: 'toolbar', put: (root) => control.insertAdjacentElement('beforebegin', root), placed: (root) => control.previousElementSibling === root };
  }
  const header = document.querySelector<HTMLElement>(STICKY_PR_HEADER);
  if (header === null || !isStuck(header)) return null;
  // Inside the title row, after the title (which gives way), so the row's centred width and padding hold it as the page's content edge.
  const row = header.querySelector<HTMLElement>('[class*="TitleArea"]') ?? header;
  return { place: 'header', put: (root) => row.append(root), placed: (root) => row.lastElementChild === root };
}

/**
 * Follow the sticky headers' class, which GitHub flips as they stick and let
 * go, so the group moves in the same task rather than at the next pass; the
 * compact header shows on that very flip, so the move is never seen.
 */
function watchSticky(state: Mounted): void {
  const toolbar = document.querySelector(STICKY_REVIEW_CONTROL)?.closest(STICKY_TOOLBAR) ?? null;
  const header = document.querySelector(STICKY_PR_HEADER);
  if (toolbar === state.toolbar && header === state.header) return;
  const newToolbar = toolbar !== state.toolbar;
  state.stickyWatch.disconnect();
  state.toolbar = toolbar;
  state.header = header;
  for (const element of [toolbar, header]) if (element !== null) state.stickyWatch.observe(element, { attributes: true, attributeFilter: ['class'] });
  // A page opened (or restored) scrolled down: read the new toolbar's box once, off the pass, which must not measure.
  if (newToolbar) {
    requestAnimationFrame(() => {
      if (mounted === state) followToolbar(state);
    });
  }
}

/** Re-read the toolbar's box (scroll, or its class flipping) and move the group when that changes where it belongs. */
function followToolbar(state: Mounted): void {
  const toolbar = state.toolbar?.isConnected === true ? state.toolbar : null;
  const stuck = toolbar !== null && measureToolbarStuck(toolbar);
  if (stuck !== state.toolbarStuck) {
    state.toolbarStuck = stuck;
    place(state);
  }
}

/** In a stuck header, so it is always to hand while reviewing; otherwise before the tab bar's counts. */
function place(state: Mounted): void {
  // Nothing to stand beside (GitHub hides the counts on narrow screens): GitHub's own button is the one shown.
  if (state.anchor === null) return;
  const sticky = stickyPlace(state);
  if (sticky !== null) {
    if (!sticky.placed(state.root)) sticky.put(state.root);
  } else if (state.anchor !== null && state.anchor.previousElementSibling !== state.root) {
    state.anchor.insertAdjacentElement('beforebegin', state.root);
  }
  const place = sticky?.place ?? null;
  if (state.root.getAttribute(ATTR_PLACE) !== place) {
    if (place === null) state.root.removeAttribute(ATTR_PLACE);
    else state.root.setAttribute(ATTR_PLACE, place);
    positionPanel();
  }
}

/** The review group out of the page (no counts to stand beside), GitHub's own review button back; the state stays. */
function unplace(state: Mounted): void {
  // A box hanging from the group goes with it; one from the status pill stays with the pill.
  if (state.opener !== null && isReviewEvent(state.opener)) closePanel();
  hideSnapshot(state);
  state.anchor = null;
  state.host?.removeAttribute(ATTR_HOST);
  state.host = null;
  if (state.root.isConnected) state.root.remove();
  if (document.documentElement.hasAttribute(ATTR_ACTIVE)) document.documentElement.removeAttribute(ATTR_ACTIVE);
}

export function removeQuickReview(): void {
  if (document.documentElement.hasAttribute(ATTR_ACTIVE)) document.documentElement.removeAttribute(ATTR_ACTIVE);
  removeStand();
  // Pills the hint put in place before the controls were made go too.
  removeStatusPills();
  if (mounted === null) return;
  closePanel();
  closeStatusMenu(mounted);
  window.clearTimeout(mounted.submittedTimer);
  window.clearTimeout(mounted.mergeTimer);
  hideSnapshot(mounted);
  mounted.host?.removeAttribute(ATTR_HOST);
  mounted.keys.abort();
  mounted.stickyWatch.disconnect();
  mounted.root.remove();
  mounted = null;
}

let tipIds = 0;

/**
 * A segment's words in GitHub's own tooltip (the page defines `tool-tip`; one
 * made here is upgraded like its own), read as its description; the
 * segment's name is its `aria-label`. Where the page has no `tool-tip` (an
 * Enterprise version before it) the words are its title. Lines are broken
 * with `<br>`, which the tooltip shows and a screen reader reads as a pause.
 */
function describe(button: HTMLButtonElement, lines: readonly string[]): HTMLElement | null {
  const tip = button.closest(`.${GROUP_CLASS}`)?.querySelector(`[id="${button.id}-tip"]`) ?? null;
  if (tip instanceof HTMLElement) {
    if (tip.textContent !== lines.join('')) tip.replaceChildren(...withBreaks(lines));
    return null;
  }
  // A segment that took the `title` keeps it: a `tool-tip` made later would be attached to nothing.
  if (button.hasAttribute('title') || document.querySelector('tool-tip') === null) {
    button.title = lines.join('\n');
    return null;
  }
  const created = document.createElement('tool-tip');
  for (const [name, value] of Object.entries({ id: `${button.id}-tip`, for: button.id, popover: 'manual', 'data-direction': 's', 'data-type': 'description', class: 'sr-only position-absolute', role: 'tooltip' })) created.setAttribute(name, value);
  created.append(...withBreaks(lines));
  return created;
}

function withBreaks(lines: readonly string[]): (string | HTMLElement)[] {
  return lines.flatMap((line, index) => (index === 0 ? [line] : [document.createElement('br'), line]));
}

function createControls(pullPath: string, context: QuickReviewContext): Mounted {
  const counter = createElement('span', { class: 'geld-quick-review__count', 'aria-hidden': 'true', hidden: '' });
  const status = createElement('span', { class: 'geld-quick-review__status', role: 'status' });
  const tally = createElement('a', { class: 'geld-quick-review__tally', href: `${pullPath}${REVIEWS_HASH}`, hidden: '' });
  const segment = (event: ReviewEvent): HTMLButtonElement => {
    const info = EVENT_INFO[event];
    tipIds += 1;
    return createElement(
      'button',
      { type: 'button', id: `geld-quick-review-${tipIds}`, class: 'btn btn-sm BtnGroup-item geld-quick-review__segment', 'data-event': event, 'aria-label': info.label, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      [
        createElement('span', { class: 'geld-quick-review__glyph' }, [svgFromString(info.icon)]),
        ...(info.instantIcon === null ? [] : [createElement('span', { class: 'geld-quick-review__glyph geld-quick-review__glyph--instant' }, [svgFromString(info.instantIcon)])]),
        // In the glyph's place, in its colour, while this segment's review is on its way.
        createElement('span', { class: 'geld-quick-review__glyph geld-quick-review__glyph--sending' }, [svgFromString(ICON_SPINNER)]),
      ],
    );
  };
  const segments = { approve: segment('approve'), 'request changes': segment('request changes'), comment: segment('comment') };
  // Primer rounds the group's outer corners on `:first-child` / `:last-child`: the tooltips stand beside it, not between.
  const group = createElement('div', { class: 'BtnGroup geld-quick-review__group', role: 'group', 'aria-label': 'Submit review' }, SEGMENT_ORDER.map((event) => segments[event]));
  const tips = SEGMENT_ORDER.flatMap((event) => describe(segments[event], segmentHint(event, INSTANT_KEY)) ?? []);
  // The count is a badge on the group's corner, outside it: inside, Primer's `:last-child` rounding would land on it.
  // Drawn once the reviews are read: the tally arriving later would push the group aside.
  const root = createElement('span', { class: GROUP_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [tally, status, createElement('span', { class: 'geld-quick-review__badged' }, [group, counter]), ...tips]);
  const keys = new AbortController();
  const stickyWatch = new MutationObserver(() => {
    if (mounted !== state) return;
    followToolbar(state);
    place(state);
  });
  const state: Mounted = {
    root,
    segments,
    group,
    status,
    host: null,
    counter,
    opener: null,
    pills: [],
    statusOpener: null,
    statusMenu: null,
    statusMenuKeys: null,
    tally,
    reviewers: [],
    ownReview: null,
    snapshot: null,
    snapshotTimer: 0,
    mergeActions: null,
    mergeFor: null,
    mergeRead: 0,
    stateWords: null,
    mergeTimer: 0,
    isAuthor: null,
    pullPath,
    context,
    panel: null,
    retarget: null,
    panelRefresh: null,
    panelCleanup: null,
    sending: false,
    submittedTimer: 0,
    pending: null,
    pendingFor: null,
    keys,
    anchor: null,
    toolbar: null,
    header: null,
    stickyWatch,
    toolbarStuck: false,
  };
  // Scroll events come before the frame is painted, so a toolbar that sticks on this scroll has the group in that frame.
  window.addEventListener(
    'scroll',
    () => {
      if (mounted === state) followToolbar(state);
    },
    { passive: true, signal: keys.signal },
  );
  followInstantKey(root, keys.signal, () => {
    describeSegments(state);
    showInstantMerge(state);
  });
  armSnapshot(state);
  // Off the conversation GitHub's writer is fetched (the conversation's HTML): when the reader heads for a review segment, not before.
  for (const type of ['pointerenter', 'focusin']) state.group.addEventListener(type, () => prefetchWriter(state.pullPath), { signal: keys.signal });
  // The tally's link from this very tab changes only the hash: resolve it there and then.
  window.addEventListener(
    'hashchange',
    () => {
      // A new target: the last landing's re-landings would pull the page back to the Reviews row.
      landing?.abort();
      landing = null;
      followReviewHash(state.context);
    },
    { signal: keys.signal },
  );
  // What the reader may do changes with checks and reviews landing: read again while the tab is shown, and when it comes back.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (mounted !== state || document.hidden) return;
      void loadMergeActions(state);
      // Pending comments added or discarded in another tab while this one was away.
      void loadPending(state);
    },
    { signal: keys.signal },
  );
  for (const event of SEGMENT_ORDER) {
    segments[event].addEventListener('click', (click) => {
      if (state.sending) return;
      // The instant key wins over the open box: the arrow and the tooltip promised a send. Words waiting in the box are
      // the exception: an empty send would leave them out (and a reload after it would drop them), so the box takes the verdict.
      const wanted = isInstantClick(event, click, MAC, pendingCount(state) > 0);
      const instant = wanted && (drafts.get(state.pullPath)?.body ?? '').trim() === '';
      if (!wanted && state.panel !== null && state.opener === event) {
        closePanel(true);
        return;
      }
      if (!instant) {
        // Another verdict while the box is open: the box stays, words and all, and takes the new verdict.
        if (state.panel !== null && state.retarget !== null) state.retarget(event);
        else openComposer(state, event, null);
        return;
      }
      closePanel();
      const sentFrom = state.pullPath;
      void sendReview(state, event, '').then((failure) => {
        // GitHub may want words for this one (a request for changes with nothing pending): ask for them, with its reason,
        // unless the reader has moved on (another pull request, or no controls): that box would review the wrong one.
        // A refused 💬 was a review of the pending comments: its box opens as a review, whatever the reader's usual choice.
        if (failure !== null && mounted === state && state.pullPath === sentFrom) openComposer(state, event, failure, event === 'comment' ? 'review' : null);
      });
    });
  }
  return state;
}

/**
 * Mark the group while the instant key (⌘ on a Mac, Ctrl elsewhere) is held,
 * so ✓ and ✗ show before the click that they will send at once (their
 * glyphs gain an arrow, their tooltips say so). Read from every key event
 * and from the pointer over the group (the key may have gone down while
 * another window had focus); let go when the window loses focus.
 */
function followInstantKey(root: HTMLElement, signal: AbortSignal, onChange: () => void): void {
  const held = (on: boolean): void => {
    if (root.hasAttribute(ATTR_INSTANT) === on) return;
    root.toggleAttribute(ATTR_INSTANT, on);
    onChange();
  };
  const read = (event: KeyboardEvent | MouseEvent): void => held(MAC ? event.metaKey : event.ctrlKey);
  window.addEventListener('keydown', read, { capture: true, signal });
  window.addEventListener('keyup', read, { capture: true, signal });
  root.addEventListener('pointermove', read, { signal });
  window.addEventListener('blur', () => held(false), { signal });
  // The pills stand in the header, outside the root: the pointer over one reads the key too.
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.target instanceof Element && event.target.closest('button.geld-status-pill') !== null) read(event);
    },
    { passive: true, signal },
  );
}

function describeSegments(state: Mounted): void {
  const held = state.root.hasAttribute(ATTR_INSTANT);
  const pending = pendingCount(state) > 0;
  const kind = commentKindOf(state);
  for (const event of SEGMENT_ORDER) describe(state.segments[event], segmentHint(event, INSTANT_KEY, held, pending, kind));
}

/**
 * On their own pull request the author has only 💬: ✓ and ✗ leave the group
 * (out of the DOM, not hidden, since Primer rounds the group's corners on
 * `:first-child`/`:last-child`). Re-read each pass, the header may come late.
 */
function showAuthor(state: Mounted): void {
  const isAuthor = isAuthorViewing();
  if (state.isAuthor === isAuthor) return;
  state.isAuthor = isAuthor;
  state.group.replaceChildren(...SEGMENT_ORDER.filter((event) => !isAuthor || EVENT_INFO[event].authorMay).map((event) => state.segments[event]));
  // The header said "author" only after a box opened on ✓ or ✗: the box takes Comment, the one verdict left.
  if (isAuthor && state.retarget !== null && (state.opener === 'approve' || state.opener === 'request changes')) state.retarget('comment');
}

const MERGE_REFRESH_MS = 60_000;
/** On ✓ or ✗ while it is the reader's standing verdict: drawn pressed in, still a button that leaves a new review. */
const ATTR_CURRENT = 'data-current';

const CURRENT_FOR: { readonly [S in 'APPROVED' | 'CHANGES_REQUESTED']: ReviewEvent } = { APPROVED: 'approve', CHANGES_REQUESTED: 'request changes' };

/** GitHub keeps one standing verdict per reviewer, their latest approval or request for changes: one of ✓ ✗ is pressed, or neither. */
function showVerdict(state: Mounted, verdict: 'APPROVED' | 'CHANGES_REQUESTED' | null): void {
  const current = verdict === null ? null : CURRENT_FOR[verdict];
  const verdicts: readonly ReviewEvent[] = ['approve', 'request changes'];
  for (const event of verdicts) {
    const button = state.segments[event];
    const on = current === event;
    if (button.hasAttribute(ATTR_CURRENT) === on) continue;
    button.toggleAttribute(ATTR_CURRENT, on);
    button.setAttribute('aria-label', on ? `${EVENT_INFO[event].label} (your current review)` : EVENT_INFO[event].label);
  }
}

/**
 * The reader's own review, shown the moment GitHub accepts it and held over
 * GitHub's reads for a while: the merge box and the Reviewers partial answer
 * from before the review for some seconds after it went through, and read
 * then they took the pressed segment and the tally's count back.
 */
interface OwnReview {
  readonly pullPath: string;
  /** The standing verdict it leaves: the review's own, or for a comment the verdict held before it. */
  readonly verdict: 'APPROVED' | 'CHANGES_REQUESTED' | null;
  readonly at: number;
}

const OWN_REVIEW_HOLD_MS = 90_000;

const OWN_VERDICT: { readonly [E in ReviewEvent]: 'APPROVED' | 'CHANGES_REQUESTED' | null } = { approve: 'APPROVED', 'request changes': 'CHANGES_REQUESTED', comment: null };

function ownState(verdict: 'APPROVED' | 'CHANGES_REQUESTED' | null): SidebarReviewerState {
  return verdict === 'APPROVED' ? 'approved' : verdict === 'CHANGES_REQUESTED' ? 'changes_requested' : 'commented';
}

function heldReview(state: Mounted): OwnReview | null {
  const own = state.ownReview;
  return own !== null && own.pullPath === state.pullPath && Date.now() - own.at < OWN_REVIEW_HOLD_MS ? own : null;
}

/** The verdict the reader just sent, while it is held; a comment leaves the standing verdict to GitHub's read. */
function heldVerdict(state: Mounted): 'APPROVED' | 'CHANGES_REQUESTED' | null {
  return heldReview(state)?.verdict ?? null;
}

/** The reviewers with the reader's held review in place of (or beside) what GitHub's read said of them. */
function withOwnReview(state: Mounted, reviewers: readonly SidebarReviewer[]): readonly SidebarReviewer[] {
  const held = heldReview(state);
  const login = viewerLogin();
  if (held === null || login === '') return reviewers;
  const wanted = ownState(held.verdict);
  const mine = reviewers.find((reviewer) => reviewer.login.toLowerCase() === login.toLowerCase());
  // A comment leaves a standing approval or request for changes standing, as GitHub counts reviews.
  if (mine !== undefined && (mine.state === wanted || (wanted === 'commented' && (mine.state === 'approved' || mine.state === 'changes_requested')))) return reviewers;
  const avatar = document.querySelector<HTMLImageElement>(`img.avatar[alt="@${CSS.escape(login)}" i]`)?.src ?? null;
  const entry: SidebarReviewer = { login: mine?.login ?? login, avatarSrc: mine?.avatarSrc ?? avatar, state: wanted, bot: false };
  return mine === undefined ? [...reviewers, entry] : reviewers.map((reviewer) => (reviewer === mine ? entry : reviewer));
}

/** Hold the review GitHub just accepted and show it now: the verdict pressed in, the tally counting it. */
function showOwnReview(state: Mounted, event: ReviewEvent): void {
  // A comment leaves the standing verdict standing, a held one included: a stale read must not take it back meanwhile.
  const verdict = OWN_VERDICT[event] ?? heldVerdict(state);
  state.ownReview = { pullPath: state.pullPath, verdict, at: Date.now() };
  if (verdict !== null) showVerdict(state, verdict);
  state.reviewers = withOwnReview(state, state.reviewers);
  showTally(state, tallyOf(state.reviewers));
}

/**
 * Read what the reader may do from the merge box (once per pull request and
 * again each minute while the tab is shown, since checks and reviews land
 * meanwhile), then show it.
 */
async function loadMergeActions(state: Mounted): Promise<MergeActions | null> {
  const pullPath = state.pullPath;
  state.mergeFor = pullPath;
  window.clearTimeout(state.mergeTimer);
  state.mergeRead += 1;
  const read = state.mergeRead;
  const current = (): boolean => mounted === state && state.pullPath === pullPath && state.mergeRead === read;
  // Each answer shows when it lands: a slow Reviewers read must not hold back the verdict or the status pill.
  let sidebar: readonly SidebarReviewer[] | null = null;
  const showReviewers = (): void => {
    if (sidebar === null) return;
    state.reviewers = withOwnReview(state, standingReviewers(sidebar, state.mergeActions?.box.verdicts ?? []));
    showTally(state, tallyOf(state.reviewers));
  };
  void fetchReviewers(pullPath).then((reviewers) => {
    if (!current()) return;
    sidebar = reviewers;
    showReviewers();
  });
  const actions = await readMergeActions(pullPath);
  if (!current()) return null;
  if (actions !== null) state.mergeActions = actions;
  showStatus(state);
  showReviewers();
  state.mergeTimer = window.setTimeout(() => {
    if (mounted === state && !document.hidden) void loadMergeActions(state);
  }, MERGE_REFRESH_MS);
  return actions;
}

const TALLY_PARTS: ReadonlyArray<{ readonly key: keyof ReviewTally; readonly icon: string; readonly tone: string }> = [
  { key: 'approved', icon: ICON_CHECK, tone: 'approved' },
  { key: 'changesRequested', icon: ICON_X, tone: 'changes' },
  { key: 'commented', icon: ICON_COMMENT, tone: 'commented' },
];

/** "3 ✓ 1 ✗ 3 💬": each kind of standing review counted, the kinds with none left out, nothing at all with no reviews. */
function showTally(state: Mounted, tally: ReviewTally): void {
  const words = tallyWords(tally);
  if (state.tally.getAttribute('aria-label') === words && state.tally.hidden === (words === '')) return;
  state.tally.replaceChildren(
    ...TALLY_PARTS.filter((part) => tally[part.key] > 0).map((part) =>
      createElement('span', { class: 'geld-quick-review__tally-part', 'data-tone': part.tone }, [createElement('span', {}, [String(tally[part.key])]), svgFromString(part.icon)]),
    ),
  );
  state.tally.setAttribute('aria-label', words);
  state.tally.hidden = words === '';
}

const SNAPSHOT_DELAY_MS = 200;

const SNAPSHOT_STATE: { readonly [S in SidebarReviewer['state']]: { readonly words: string; readonly icon: string; readonly tone: string } } = {
  approved: { words: 'approved', icon: ICON_CHECK, tone: 'approved' },
  changes_requested: { words: 'requested changes', icon: ICON_X, tone: 'changes' },
  commented: { words: 'commented', icon: ICON_COMMENT, tone: 'commented' },
  dismissed: { words: 'commented', icon: ICON_COMMENT, tone: 'commented' },
  awaiting: { words: 'awaiting review', icon: ICON_COMMENT, tone: 'commented' },
};

/**
 * Resting on the tally (or focusing it) shows the reviews behind it: one
 * line per reviewer, their picture, name and standing review, each a link
 * to that review on the conversation. The card hangs under the tally and
 * stays while the pointer is on it.
 */
function armSnapshot(state: Mounted): void {
  const later = (show: boolean): void => snapshotSoon(state, show);
  state.tally.addEventListener('pointerenter', () => later(true), { signal: state.keys.signal });
  state.tally.addEventListener('pointerleave', () => later(false), { signal: state.keys.signal });
  state.tally.addEventListener('focus', () => showSnapshot(state), { signal: state.keys.signal });
  state.tally.addEventListener('blur', () => later(false), { signal: state.keys.signal });
  state.tally.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') hideSnapshot(state);
      else if (event.key === 'Tab' && !event.shiftKey && state.snapshot !== null) {
        const first = state.snapshot.querySelector<HTMLElement>('a');
        if (first === null) return;
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },
    { signal: state.keys.signal },
  );
}

function snapshotSoon(state: Mounted, show: boolean): void {
  window.clearTimeout(state.snapshotTimer);
  state.snapshotTimer = window.setTimeout(() => (show ? showSnapshot(state) : hideSnapshot(state)), SNAPSHOT_DELAY_MS);
}

function showSnapshot(state: Mounted): void {
  window.clearTimeout(state.snapshotTimer);
  if (state.snapshot !== null || state.reviewers.length === 0 || !state.tally.isConnected) return;
  const verdicts = state.mergeActions?.box.verdicts ?? [];
  const card = createElement('div', { class: 'geld-quick-review__snapshot', [OWN_UI_ATTRIBUTE]: '', role: 'group', 'aria-label': 'Reviews' }, [
    ...state.reviewers.map((reviewer) => {
      const look = SNAPSHOT_STATE[reviewer.state];
      const id = verdicts.find((verdict) => verdict.login.toLowerCase() === reviewer.login.toLowerCase())?.id ?? null;
      return createElement('a', { class: 'geld-quick-review__snapshot-row', href: reviewLink(state.pullPath, reviewer.login, id) }, [
        reviewer.avatarSrc === null
          ? createElement('span', { class: 'geld-quick-review__snapshot-avatar', 'aria-hidden': 'true' })
          : createElement('img', { class: `geld-quick-review__snapshot-avatar${reviewer.bot ? ' geld-quick-review__snapshot-avatar--bot' : ''}`, src: reviewer.avatarSrc, alt: '', width: '20', height: '20' }),
        createElement('span', { class: 'geld-quick-review__snapshot-name' }, [reviewer.login]),
        createElement('span', { class: 'geld-quick-review__snapshot-state', 'data-tone': look.tone, role: 'img', 'aria-label': look.words, title: look.words }, [svgFromString(look.icon)]),
      ]);
    }),
  ]);
  card.addEventListener('pointerenter', () => window.clearTimeout(state.snapshotTimer));
  card.addEventListener('pointerleave', () => snapshotSoon(state, false));
  card.addEventListener('focusin', () => window.clearTimeout(state.snapshotTimer));
  card.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || (!card.contains(next) && next !== state.tally)) snapshotSoon(state, false);
  });
  // The card is at the end of the page, not after the tally in the tab order: Tab walks it as if it were.
  card.addEventListener('keydown', (event) => {
    const links = [...card.querySelectorAll<HTMLElement>('a')];
    if (event.key === 'Escape') {
      event.preventDefault();
      // Focus first: the tally's focus would open a new card if this one were already gone.
      state.tally.focus({ preventScroll: true });
      hideSnapshot(state);
    } else if (event.key === 'Tab' && event.shiftKey && document.activeElement === links[0]) {
      event.preventDefault();
      state.tally.focus({ preventScroll: true });
    } else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === links.at(-1)) {
      event.preventDefault();
      hideSnapshot(state);
      state.group.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }
  });
  document.body.append(card);
  state.snapshot = card;
  const rect = state.tally.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - card.offsetWidth - 8));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(rect.bottom + 6)}px`;
  // Fixed, so scrolling the page cannot reach what overflows the window: the list scrolls inside the room left.
  card.style.maxHeight = `${Math.max(120, Math.round(window.innerHeight - rect.bottom - 18))}px`;
  // And it hangs from the tally: when the tally moves with the page, the card goes rather than float over other things.
  window.addEventListener('scroll', () => hideSnapshot(state), { passive: true, once: true, signal: state.keys.signal });
}

/** The login in a reviewer marker; a malformed escape (a hand-edited `%`) reads as no one, so the marker falls back to the Reviews row. */
function loginOfMarker(encoded: string): string {
  try {
    return decodeURIComponent(encoded).toLowerCase();
  } catch {
    return '';
  }
}

function hideSnapshot(state: Mounted): void {
  window.clearTimeout(state.snapshotTimer);
  state.snapshot?.remove();
  state.snapshot = null;
}

/**
 * On the conversation, Geld's review markers resolve once the page holds
 * their target: `#geld-reviews` opens the digest's Reviews row (or brings
 * the sidebar's Reviewers into view), and `#geld-review-by-<login>`
 * becomes that reviewer's latest review's own anchor, which the browser
 * (or the digest, folding the timeline) then lands on. Tried each pass for
 * `HASH_PATIENCE_MS`, since the timeline loads in pieces; a reviewer never
 * found falls back to the reviews.
 */
function followReviewHash(context: QuickReviewContext): void {
  const kind = context.page.kind;
  const hash = window.location.hash;
  if (kind !== 'pull-conversation' || !(hash === REVIEWS_HASH || hash.startsWith(REVIEW_BY_HASH))) {
    hashSince = null;
    return;
  }
  if (hashSince === null || hashSince.hash !== hash) hashSince = { hash, at: Date.now() };
  const patient = Date.now() - hashSince.at < HASH_PATIENCE_MS;
  if (hash.startsWith(REVIEW_BY_HASH)) {
    const login = loginOfMarker(hash.slice(REVIEW_BY_HASH.length));
    const reviews = [...document.querySelectorAll<HTMLElement>('[id^="pullrequestreview-"]')].filter((node) => /^pullrequestreview-\d+$/.test(node.id) && reviewAuthorIs(node, login));
    const latest = reviews.at(-1);
    if (latest !== undefined) {
      hashSince = null;
      window.location.replace(`#${latest.id}`);
      return;
    }
    if (patient) return;
  }
  const row = document.querySelector<HTMLElement>(REVIEWS_ROW);
  // The digest mounts after the controls on a fresh load: while it is on and may still come, the sidebar does not do.
  if (row === null && context.digest === true && patient) return;
  const sidebar = document.querySelector<HTMLElement>('form[id^="pull-request-reviewers-form"], [data-testid="sidebar-reviewers"], [data-testid="reviewers-section"]');
  const target = row ?? sidebar;
  if (target === null) {
    if (!patient) hashSince = null;
    return;
  }
  hashSince = null;
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
  if (row === null) {
    (target.closest('.discussion-sidebar-item') ?? target).scrollIntoView({ block: 'center' });
    return;
  }
  const landRow = (): void => {
    const current = document.querySelector<HTMLElement>(REVIEWS_ROW)?.closest('li');
    if (current !== null && current !== undefined) window.scrollBy({ top: current.getBoundingClientRect().top - LANDING_OFFSET, behavior: 'instant' });
  };
  // Landed before the click: opening a row makes the digest hold it at the viewport top it has at that moment.
  landRow();
  if (row.getAttribute('aria-expanded') !== 'true') row.click();
  // The page above is still settling while the conversation loads, so the row is brought back under the sticky
  // header a few times over the next second, unless the reader scrolls first.
  landing?.abort();
  const settle = new AbortController();
  landing = settle;
  const stop = (): void => settle.abort();
  window.addEventListener('wheel', stop, { once: true, passive: true, signal: settle.signal });
  window.addEventListener('keydown', stop, { once: true, signal: settle.signal });
  for (const delay of [300, 900]) {
    window.setTimeout(() => {
      if (!settle.signal.aborted) landRow();
    }, delay);
  }
}

/** The Reviews row's re-landings in flight: the reader scrolling, or another hash, ends them. */
let landing: AbortController | null = null;

/** Room left above a row brought into view: GitHub's sticky header and a little air. */
const LANDING_OFFSET = 96;

const REVIEWS_ROW = '.geld-review [data-geld-focus="main:reviews"]';

/** A review row's author is `login`: GitHub writes "Name (login)" or the login alone, and links the profile (or the App). */
function reviewAuthorIs(node: Element, login: string): boolean {
  const author = node.querySelector('.author');
  if (author === null) return false;
  const text = (author.textContent ?? '').trim().toLowerCase();
  const href = (author.getAttribute('href') ?? '').toLowerCase();
  return text === login || text.endsWith(`(${login})`) || href === `/${login}`;
}

const HASH_PATIENCE_MS = 15_000;
let hashSince: { readonly hash: string; readonly at: number } | null = null;

/**
 * The header's status pill becomes Geld's menu of the statuses the reader
 * may switch to, once the merge box says there are any, or from the first
 * paint where the reader could the last time in this repository (never on a
 * merged pull request: there is nothing to switch to). ✓ or ✗ stands pressed
 * while it is the reader's own standing verdict.
 */
function showStatus(state: Mounted): void {
  const actions = state.mergeActions;
  if (actions !== null) showVerdict(state, heldVerdict(state) ?? viewerVerdict(actions.box, viewerLogin()));
  const repo = repoOf(state.pullPath);
  const groups = stackMenuOf(actions);
  const options = actions === null ? null : (groups ?? flatStatusOptions(actions));
  // A merged pull request has nothing to switch to whoever reads it: it says nothing about the reader's rights.
  if (options !== null && repo !== null && actions !== null && statusOf(actions.box) !== 'merged') rememberStatusHint(repo, options.length > 0);
  const on = options !== null ? options.length > 0 : repo !== null && statusHint(repo) === true && !/merged/i.test(pullRequestStateWords());
  // While a merge is out the pills stay, whatever a reading meanwhile says (one may already read it merged): its
  // success dresses them as merged until the reload.
  state.pills = syncStatusPills(on || (state.sending && state.pills.length > 0), openFromPill);
  showInstantMerge(state);
  if (state.statusMenu !== null && (state.statusOpener === null || !state.pills.includes(state.statusOpener))) closeStatusMenu(state);
}

/** Every pill's click: a pill may be put in place before the controls are mounted (`reassertStatusPills`). */
function openFromPill(pill: HTMLButtonElement, click: MouseEvent): void {
  if (!pill.hasAttribute('aria-haspopup')) return;
  if (mounted === null) return;
  if (instantMergeReady(mounted) && (MAC ? click.metaKey : click.ctrlKey)) void instantMerge(mounted, pill);
  else toggleStatusMenu(mounted, pill);
}

/**
 * Whether a held ⌘ (Ctrl) makes the pill a 1-click merge: an approved pull
 * request (an approval standing, no request for changes) that GitHub would
 * merge now with its default method. A merge only past the rules (an
 * admin's bypass) never goes in one click: its box asks for GitHub's checkbox.
 */
function instantMergeReady(state: Mounted): boolean {
  const actions = state.mergeActions;
  // A stacked pull request merges the stack below it too: that wants the merge box's sentence, not a 1-click merge.
  if (actions === null || actions.offer !== 'merge' || actions.box.stacked || state.sending) return false;
  const verdicts = actions.box.verdicts;
  return verdicts.some((verdict) => verdict.state === 'APPROVED') && !verdicts.some((verdict) => verdict.state === 'CHANGES_REQUESTED');
}

/** While the key is held over an approved pull request, the pill reads "Merge" in GitHub's merge colour, outlined. */
function showInstantMerge(state: Mounted): void {
  const on = state.root.hasAttribute(ATTR_INSTANT) && instantMergeReady(state);
  const method = state.mergeActions?.box.methods[0] ?? 'SQUASH';
  for (const pill of state.pills) {
    // A merged pill (`showMergedPills`) has no menu and nothing left to merge, whatever the last reading said.
    if (!pill.hasAttribute('aria-haspopup')) continue;
    if (pill.hasAttribute(ATTR_INSTANT_MERGE) === on) continue;
    pill.toggleAttribute(ATTR_INSTANT_MERGE, on);
    if (on) pill.setAttribute('aria-label', `Merge now: ${METHOD_LABEL[method]}`);
    else pill.removeAttribute('aria-label');
  }
}

/**
 * Merge at once with GitHub's default method and the commit it would write,
 * as the merge box would send it; on success the pill turns into GitHub's
 * merged pill before the page reloads, and a refusal opens the merge box with
 * GitHub's reason.
 */
async function instantMerge(state: Mounted, pill: HTMLButtonElement): Promise<void> {
  closeStatusMenu(state);
  closePanel();
  state.statusOpener = pill;
  const pullPath = state.pullPath;
  // What was read may be a minute old: an approval dismissed or changes requested since must not merge in one click.
  for (const each of state.pills) each.setAttribute('aria-busy', 'true');
  const fresh = await readMergeActions(pullPath);
  for (const each of state.pills) each.removeAttribute('aria-busy');
  if (mounted !== state || state.pullPath !== pullPath) return;
  if (fresh !== null) state.mergeActions = fresh;
  showStatus(state);
  if (fresh === null || !instantMergeReady(state)) {
    // No longer an approved pull request GitHub would merge (or GitHub could not say): the reader chooses from the menu.
    if (pill.isConnected) openStatusMenu(state, pill);
    return;
  }
  const box = fresh.box;
  const method = box.methods[0] ?? 'SQUASH';
  const request = mergeRequest(state.pullPath, { method, commitTitle: box.commitTitle, commitMessage: box.commitMessage, authorEmail: box.authorEmail, bypass: false, stacked: box.stacked }, fetchNonce());
  const failed = await sendAction(state, 'merge', request, () => showMerged(state, pullPath));
  if (failed !== null && mounted === state) openMergeBox(state, failed);
}

/**
 * The merge of `pullPath` went through: the pills on the page now, whichever GitHub's header re-rendered meanwhile,
 * shown merged, only while the reader is still on that pull request.
 */
function showMerged(state: Mounted, pullPath: string): void {
  if (mounted !== state || state.pullPath !== pullPath || pullPathOf(window.location.pathname) !== pullPath) return;
  state.pills = syncStatusPills(true, openFromPill);
  showMergedPills(state.pills);
}

/**
 * Before paint, from the controller's mutation callback: a header GitHub
 * (re)rendered gets Geld's pill in the same frame, so its label never shows
 * first and is then pushed aside by the caret. With the controls mounted the
 * merge box decides; before that (the tab bar's counts can render after the
 * header's label) the repository's hint does.
 */
export function reassertStatusPills(): void {
  const pullPath = pullPathOf(window.location.pathname);
  if (pullPath === null) return;
  if (mounted !== null && mounted.pullPath === pullPath) {
    showStatus(mounted);
    return;
  }
  const repo = repoOf(pullPath);
  if (repo !== null && statusHint(repo) === true && viewerLogin() !== '' && !/merged/i.test(pullRequestStateWords())) syncStatusPills(true, openFromPill);
}

function repoOf(pullPath: string): string | null {
  return /^\/([^/]+\/[^/]+)\/pull\//.exec(pullPath)?.[1] ?? null;
}

function toggleStatusMenu(state: Mounted, pill: HTMLButtonElement): void {
  const same = state.statusMenu !== null && state.statusOpener === pill;
  closeStatusMenu(state);
  if (same || state.sending) return;
  closePanel();
  state.statusOpener = pill;
  if (state.mergeActions !== null) {
    openStatusMenu(state, pill);
    return;
  }
  // Opened on the hint before the merge box answered: the menu waits for it.
  void loadMergeActions(state).then(() => {
    if (mounted === state && state.statusOpener === pill && pill.isConnected && state.statusMenu === null) openStatusMenu(state, pill);
  });
}

/**
 * The flat menu. A stacked pull request whose stack could not be read offers no merge and no place in the queue: both
 * go through `enqueue_stack`, which takes every pull request below it, and only the stack says which those are.
 */
function flatStatusOptions(actions: MergeActions): readonly StatusOption[] {
  const options = statusOptions(actions.box, actions.offer, actions.bypass);
  return actions.box.stacked && actions.stack === null ? options.filter((option) => option.action !== 'merge' && option.action !== 'queue') : options;
}

/** A stack's menu, by type, or null for a pull request in no stack or a stack of one (whose menu is `statusOptions`'). */
function stackMenuOf(actions: MergeActions | null): readonly StackGroup[] | null {
  return actions === null || actions.stack === null ? null : stackGroups(actions.stack, actions.box.methods[0] ?? 'SQUASH');
}

/**
 * The status menu, under the pill: each status the reader may switch to
 * (closed last), named by GitHub's words for what it does, its glyph in the
 * status's colour. Merging opens the merge box and closing asks first;
 * marking ready, converting to a draft and reopening go at once, as from
 * GitHub's own controls. In a stack of more than one, each type is a parent
 * whose submenu, beside it on its inline-end side, offers this pull request,
 * it and every one below, or the entire stack.
 */
function openStatusMenu(state: Mounted, pill: HTMLButtonElement): void {
  // Merged meanwhile (`showMergedPills`): a merge or a reading that lands after it opens nothing on it.
  if (!pill.hasAttribute('aria-haspopup')) return;
  const actions = state.mergeActions;
  const groups = stackMenuOf(actions);
  const options = actions === null || groups !== null ? [] : flatStatusOptions(actions);
  if (options.length === 0 && (groups === null || groups.length === 0)) return;
  const menu = createElement('div', { class: 'geld-quick-review__menu geld-quick-review__status-menu', [OWN_UI_ATTRIBUTE]: '', role: 'menu', 'aria-label': 'Change status' });
  const visual = (status: PullStatus, bypass: boolean): HTMLElement =>
    createElement('span', { class: 'geld-quick-review__menu-visual', ...(bypass ? { 'data-bypass': '' } : {}) }, [
      svgFromString(STATUS_INFO[status].icon),
      ...(bypass ? [createElement('span', { class: 'geld-quick-review__menu-badge' }, [svgFromString(ICON_ALERT_FILL_12)])] : []),
    ]);
  for (const option of options) {
    const item = createElement('button', { type: 'button', class: 'geld-quick-review__menu-item', role: 'menuitem', 'data-status': option.status }, [
      visual(option.status, option.bypass === true),
      createElement('span', { class: 'geld-quick-review__menu-label' }, [option.note]),
    ]);
    item.addEventListener('click', () => {
      closeStatusMenu(state);
      chooseStatus(state, option);
    });
    menu.append(item);
  }
  let submenu: HTMLElement | null = null;
  let submenuFor: HTMLButtonElement | null = null;
  const closeSubmenu = (focusParent: boolean): void => {
    submenu?.remove();
    submenuFor?.setAttribute('aria-expanded', 'false');
    if (focusParent) submenuFor?.focus({ preventScroll: true });
    submenu = null;
    submenuFor = null;
  };
  const openSubmenu = (item: HTMLButtonElement, group: StackGroup, focusFirst: boolean): void => {
    if (submenuFor !== item) {
      closeSubmenu(false);
      const sub = createElement('div', { class: 'geld-quick-review__menu geld-quick-review__status-menu geld-quick-review__status-submenu', role: 'menu', 'aria-label': group.note });
      for (const choice of group.choices) {
        const button = createElement('button', { type: 'button', class: 'geld-quick-review__menu-item', role: 'menuitem', 'data-scope': choice.scope }, [createElement('span', { class: 'geld-quick-review__menu-label' }, [choice.label])]);
        button.addEventListener('click', () => {
          closeStatusMenu(state);
          chooseStackChoice(state, group, choice);
        });
        sub.append(button);
      }
      menu.append(sub);
      item.setAttribute('aria-expanded', 'true');
      submenu = sub;
      submenuFor = item;
      placeSubmenu(item, sub);
    }
    if (focusFirst) submenu?.querySelector<HTMLButtonElement>('.geld-quick-review__menu-item')?.focus({ preventScroll: true });
  };
  for (const group of groups ?? []) {
    const item = createElement('button', { type: 'button', class: 'geld-quick-review__menu-item geld-quick-review__menu-parent', role: 'menuitem', 'data-status': group.status, 'data-action': group.action, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [
      visual(group.status, false),
      createElement('span', { class: 'geld-quick-review__menu-label' }, [group.note]),
      createElement('span', { class: 'geld-quick-review__menu-trail', 'aria-hidden': 'true' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
    ]);
    item.addEventListener('click', () => openSubmenu(item, group, true));
    item.addEventListener('pointerenter', () => openSubmenu(item, group, false));
    menu.append(item);
  }
  const keys = new AbortController();
  state.statusMenu = menu;
  state.statusMenuKeys = keys;
  pill.setAttribute('aria-expanded', 'true');
  document.body.append(menu);
  positionStatusMenu(state);
  const items = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>(':scope > .geld-quick-review__menu-item')];
  items()[0]?.focus({ preventScroll: true });
  menu.addEventListener(
    'keydown',
    (event) => {
      const rtl = getComputedStyle(menu).direction === 'rtl';
      const inward = rtl ? 'ArrowLeft' : 'ArrowRight';
      const outward = rtl ? 'ArrowRight' : 'ArrowLeft';
      const active = document.activeElement;
      const inSubmenu = submenu !== null && active instanceof Node && submenu.contains(active);
      if (event.key === 'Escape' && inSubmenu) {
        event.preventDefault();
        closeSubmenu(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeStatusMenu(state);
        pill.focus({ preventScroll: true });
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const list = inSubmenu && submenu !== null ? [...submenu.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item')] : items();
        const at = list.findIndex((item) => item === active);
        list[(at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus({ preventScroll: true });
      } else if (event.key === inward && !inSubmenu && active instanceof HTMLButtonElement && active.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault();
        active.click();
      } else if (event.key === outward && inSubmenu) {
        event.preventDefault();
        closeSubmenu(true);
      }
    },
    { signal: keys.signal },
  );
  // A plain item under the pointer closes a parent's submenu, as moving onto another parent swaps it.
  for (const item of items()) if (item.getAttribute('aria-haspopup') !== 'menu') item.addEventListener('pointerenter', () => closeSubmenu(false), { signal: keys.signal });
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (target instanceof Node && (menu.contains(target) || pill.contains(target))) return;
      closeStatusMenu(state);
    },
    { capture: true, signal: keys.signal },
  );
  // Tabbing out of it closes it, as a click outside does.
  menu.addEventListener(
    'focusout',
    (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (menu.contains(next) || pill.contains(next))) return;
      closeStatusMenu(state);
    },
    { signal: keys.signal },
  );
  window.addEventListener('scroll', () => positionStatusMenu(state), { passive: true, signal: keys.signal });
  window.addEventListener(
    'resize',
    () => {
      positionStatusMenu(state);
      const open = submenu;
      const parent = submenuFor;
      if (open !== null && parent !== null) placeSubmenu(parent, open);
    },
    { signal: keys.signal },
  );
}

/**
 * Beside its parent, on the menu's inline-end side as Primer's submenus open, its first item level with the parent;
 * on the other side when that would leave the viewport, and under the parent, over the rows below it, when neither
 * side has room (a narrow window). Placed again as the window changes size.
 */
function placeSubmenu(item: HTMLElement, submenu: HTMLElement): void {
  submenu.removeAttribute('data-geld-flip');
  submenu.removeAttribute('data-geld-under');
  const style = getComputedStyle(submenu);
  submenu.style.top = `${item.offsetTop - parseFloat(style.paddingTop) - parseFloat(style.borderTopWidth)}px`;
  const fits = (): boolean => {
    const rect = submenu.getBoundingClientRect();
    return rect.left >= 8 && rect.right <= document.documentElement.clientWidth - 8;
  };
  if (fits()) return;
  submenu.setAttribute('data-geld-flip', '');
  if (fits()) return;
  submenu.removeAttribute('data-geld-flip');
  submenu.setAttribute('data-geld-under', '');
  submenu.style.top = `${item.offsetTop + item.offsetHeight}px`;
}

/** Under the pill, its left edge on the pill's, inside the viewport (fixed, and placed again as the page scrolls, so it follows the pill). */
function positionStatusMenu(state: Mounted): void {
  const menu = state.statusMenu;
  const pill = state.statusOpener;
  if (menu === null || pill === null) return;
  const rect = pill.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - menu.offsetWidth - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 4)}px`;
}

function closeStatusMenu(state: Mounted): void {
  if (state.statusMenu === null) return;
  state.statusMenuKeys?.abort();
  state.statusMenuKeys = null;
  state.statusMenu.remove();
  state.statusMenu = null;
  state.statusOpener?.setAttribute('aria-expanded', 'false');
}

function chooseStatus(state: Mounted, option: StatusOption): void {
  if (option.action === 'merge') openMergeBox(state, null, option.bypass === true);
  // The browser's own confirmation, not a box to click through: closing is undone only by reopening.
  else if (option.action === 'close' || option.action === 'queue' || option.action === 'auto') {
    if (window.confirm(CONFIRM_WORDS[option.action])) void runStatus(state, option.action);
    else if (state.statusOpener?.isConnected === true) state.statusOpener.focus({ preventScroll: true });
  } else void runStatus(state, option.action);
}

/**
 * A stack's choice: this pull request alone as the flat menu's item would go; more than one only after the browser's
 * confirmation naming every one.
 */
function chooseStackChoice(state: Mounted, group: StackGroup, choice: StackChoice): void {
  if (choice.targets.length === 1) {
    chooseStatus(state, { status: group.status, action: group.action, note: group.note });
    return;
  }
  if (window.confirm(stackConfirmWords(group.action, choice))) void runStackChoice(state, group.action, choice);
  else if (state.statusOpener?.isConnected === true) state.statusOpener.focus({ preventScroll: true });
}

const STACK_REQUEST: { readonly [A in Exclude<StackAction, 'merge' | 'queue'>]: Request } = { ready: readyRequest, draft: draftRequest, close: closeRequest, reopen: reopenRequest };

const STACK_RETRY: { readonly [A in StackAction]: (count: number) => { readonly icon: string; readonly label: string } } = {
  merge: () => ({ icon: ICON_GIT_MERGE, label: 'Merge stack' }),
  queue: () => ({ icon: ICON_GIT_MERGE_QUEUE, label: 'Merge when ready' }),
  ready: (count) => ({ icon: ICON_GIT_PULL_REQUEST, label: count > 1 ? `Mark ${count} ready for review` : 'Ready for review' }),
  draft: (count) => ({ icon: ICON_GIT_PULL_REQUEST_DRAFT, label: count > 1 ? `Convert ${count} to drafts` : 'Convert to draft' }),
  close: (count) => ({ icon: ICON_GIT_PULL_REQUEST_CLOSED, label: count > 1 ? `Close ${count} pull requests` : 'Close pull request' }),
  reopen: (count) => ({ icon: ICON_GIT_PULL_REQUEST, label: count > 1 ? `Reopen ${count} pull requests` : 'Reopen pull request' }),
};

/**
 * A merge or a place in the queue goes through the top pull request's `enqueue_stack`, which takes every one below it,
 * with GitHub's default method and the commit it would write, read afresh; the rest is one request per pull request,
 * top first. A refusal opens GitHub's reason with a retry of what was left.
 */
async function runStackChoice(state: Mounted, action: StackAction, choice: StackChoice): Promise<void> {
  const nonce = fetchNonce();
  // The pull request it was chosen on: the controls move with the reader to another one, and nothing chosen here may
  // go out from there or dress its pills.
  const pullPath = state.pullPath;
  const here = (): boolean => mounted === state && state.pullPath === pullPath && pullPathOf(window.location.pathname) === pullPath;
  let steps: readonly Step[];
  if (action === 'merge') {
    const first = await fetchMergeBox(choice.via.path, 'SQUASH', false);
    const method = first?.methods[0] ?? 'SQUASH';
    const box = first === null || method === 'SQUASH' ? first : await fetchMergeBox(choice.via.path, method, false);
    if (!here()) return;
    if (box === null) {
      openRetryBox(state, action, actionErrorText(action, 0, null), {
          ...STACK_RETRY.merge(1),
          run: async () => {
            await runStackChoice(state, action, choice);
            return null;
          },
        });
      return;
    }
    steps = [{ number: choice.via.number, request: mergeRequest(choice.via.path, { method, commitTitle: box.commitTitle, commitMessage: box.commitMessage, authorEmail: box.authorEmail, bypass: false, stacked: true }, nonce) }];
  } else if (action === 'queue') steps = [{ number: choice.via.number, request: stackQueueRequest(choice.via.path, nonce) }];
  else {
    const request = STACK_REQUEST[action];
    steps = choice.targets.map((member) => ({ number: member.number, request: request(member.path, nonce) }));
  }
  const done = action === 'merge' ? () => (here() ? showMergedPills(state.pills) : undefined) : undefined;
  let left = steps;
  const send = async (): Promise<string | null> => {
    if (!here()) return null;
    const failed = await sendSteps(state, action, left, done, here);
    if (failed === null) return null;
    left = failed.left;
    return failed.failed;
  };
  const failed = await send();
  if (failed !== null && here()) openRetryBox(state, action, failed, { ...STACK_RETRY[action](left.length), run: send });
}

const CONFIRM_WORDS: { readonly [A in 'close' | 'queue' | 'auto']: string } = {
  close: 'Close this pull request?',
  queue: 'Add this pull request to the merge queue?',
  auto: 'Merge this pull request automatically once its requirements are met?',
};

type Request = (pullPath: string, nonce: string) => { readonly url: string; readonly init: RequestInit };

/** A place in the merge queue: through the stack's own request for a stacked pull request, as GitHub's merge box sends it. */
function queueFor(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return mounted?.mergeActions?.box.stacked === true ? stackQueueRequest(pullPath, nonce) : queueRequest(pullPath, nonce);
}

/** Auto-merge with GitHub's default method and the commit it would write, as read last from the merge box. */
function autoMergeFor(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const box = mounted?.mergeActions?.box;
  return autoMergeRequest(pullPath, { method: box?.methods[0] ?? 'SQUASH', commitTitle: box?.commitTitle ?? '', commitMessage: box?.commitMessage ?? '', authorEmail: box?.authorEmail ?? null }, nonce);
}

const CONFIRM_INFO: { readonly [A in Exclude<StatusAction, 'merge'>]: { readonly icon: string; readonly label: string; readonly request: Request } } = {
  queue: { icon: ICON_GIT_MERGE_QUEUE, label: 'Merge when ready', request: queueFor },
  auto: { icon: ICON_GIT_MERGE, label: 'Enable auto-merge', request: autoMergeFor },
  close: { icon: ICON_GIT_PULL_REQUEST_CLOSED, label: 'Close pull request', request: closeRequest },
  ready: { icon: ICON_GIT_PULL_REQUEST, label: 'Ready for review', request: readyRequest },
  draft: { icon: ICON_GIT_PULL_REQUEST_DRAFT, label: 'Convert to draft', request: draftRequest },
  reopen: { icon: ICON_GIT_PULL_REQUEST, label: 'Reopen pull request', request: reopenRequest },
};

/** Mark ready, convert to a draft, reopen or (confirmed) close at once; a refusal opens the box with GitHub's reason, for another try. */
async function runStatus(state: Mounted, action: Exclude<StatusAction, 'merge'>): Promise<void> {
  const failed = await sendAction(state, action, CONFIRM_INFO[action].request(state.pullPath, fetchNonce()));
  if (failed !== null && mounted === state) openConfirmBox(state, action, failed);
}

function buttonFor(state: Mounted, opener: Opener): HTMLElement | null {
  return isReviewEvent(opener) ? state.segments[opener] : state.statusOpener;
}

function closePanel(restoreFocus = false): void {
  if (mounted === null || mounted.panel === null) return;
  mounted.panelCleanup?.();
  mounted.panelCleanup = null;
  mounted.panel.remove();
  mounted.panel = null;
  mounted.retarget = null;
  mounted.panelRefresh = null;
  const opener = mounted.opener === null ? null : buttonFor(mounted, mounted.opener);
  mounted.opener = null;
  opener?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  window.removeEventListener('resize', positionPanel);
  window.removeEventListener('scroll', positionPanel);
  panelResize?.disconnect();
  panelResize = null;
  if (restoreFocus) opener?.focus();
}

function onOutsidePointer(event: PointerEvent): void {
  if (mounted === null || mounted.panel === null) return;
  const target = event.target;
  if (target instanceof Node && (mounted.panel.contains(target) || mounted.root.contains(target) || mounted.pills.some((pill) => pill.contains(target)))) return;
  closePanel();
}

/**
 * Under the group, its right edge on the group's, inside the viewport: in
 * page coordinates under the tab bar, so it scrolls with the bar, and fixed
 * under the stuck toolbar, which stays put as the page scrolls.
 */
function positionPanel(): void {
  if (mounted === null || mounted.panel === null) return;
  // A box chosen from the status pill hangs under the pill, its left edge on the pill's; the review boxes under the group.
  const pill = mounted.opener !== null && !isReviewEvent(mounted.opener) && mounted.statusOpener?.isConnected === true ? mounted.statusOpener : null;
  const anchor = pill ?? mounted.root;
  if (!anchor.isConnected) return;
  const fixed = pill === null ? mounted.root.hasAttribute(ATTR_PLACE) : pill.closest(STICKY_HEADERS) !== null;
  const rect = anchor.getBoundingClientRect();
  const width = mounted.panel.offsetWidth;
  const left = Math.max(16, Math.min(pill === null ? rect.right - width : rect.left, document.documentElement.clientWidth - width - 16));
  // The box keeps to the room in the window on the side it opens, and Primer's Overlay scrolls its body, so nothing runs
  // off an edge and the buttons in its footer stay in view: under the anchor, or over it when the room below is too
  // little for a useful box and there is more above.
  const below = Math.max(0, Math.round(window.innerHeight - rect.bottom - 20));
  const above = Math.max(0, Math.round(rect.top - 20));
  const up = below < PANEL_ROOM && above > below;
  mounted.panel.style.maxHeight = `${up ? above : below}px`;
  fitField(mounted.panel, up ? above : below);
  const top = up ? rect.top - 4 - mounted.panel.offsetHeight : rect.bottom + 4;
  mounted.panel.style.position = fixed ? 'fixed' : '';
  mounted.panel.style.top = `${Math.round(top + (fixed ? 0 : window.scrollY))}px`;
  mounted.panel.style.left = `${Math.round(left + (fixed ? 0 : window.scrollX))}px`;
}

/** The room under the anchor below which the box opens over it instead, when there is more room there. */
const PANEL_ROOM = 240;

/** The field's shortest cap: below it the box's body scrolls instead. */
const FIELD_MIN = 90;

/**
 * The words' field (or its preview) takes what the box has left once the tabs, the pending comments and the buttons
 * have theirs, and scrolls inside itself past that. GitHub's sizer grows the field and caps it against the window's
 * bottom edge, not the box's, so a long comment otherwise outgrew the box and scrolled under the tabs.
 */
function fitField(panel: HTMLElement, room: number): void {
  const body = panel.querySelector<HTMLElement>(':scope > .Overlay-body');
  const field = [...panel.querySelectorAll<HTMLElement>('textarea, .js-preview-body')].find((el) => el.offsetParent !== null);
  if (body === null || field === undefined) {
    panel.style.removeProperty('--geld-field-max');
    return;
  }
  for (const child of body.children) panelResize?.observe(child);
  const whole = panel.offsetHeight - body.clientHeight + body.scrollHeight;
  const rest = whole - field.offsetHeight;
  const cap = Math.max(FIELD_MIN, Math.floor(room - rest));
  panel.style.setProperty('--geld-field-max', `${cap}px`);
  // GitHub gives the preview the field's height as an inline `min-height` when Preview opens, which would outrank the
  // cap once the room shrinks: the stylesheet takes the smaller of the two, GitHub's value left as it wrote it.
  const previewMin = panel.querySelector<HTMLElement>('.js-preview-body')?.style.minHeight ?? '';
  if (previewMin === '') panel.style.removeProperty('--geld-preview-min');
  else panel.style.setProperty('--geld-preview-min', previewMin);
}

/** Placed again as the box changes size (the writer arriving, a reason shown, pending comments opening): one over its anchor grows upward. */
let panelResize: ResizeObserver | null = null;

function showPanel(state: Mounted, panel: HTMLElement, opener: Opener): void {
  closePanel();
  closeStatusMenu(state);
  state.panel = panel;
  state.opener = opener;
  buttonFor(state, opener)?.setAttribute('aria-expanded', 'true');
  document.body.append(panel);
  panelResize = new ResizeObserver(() => positionPanel());
  panelResize.observe(panel);
  positionPanel();
  document.addEventListener('pointerdown', onOutsidePointer, true);
  window.addEventListener('resize', positionPanel);
  // Its room is the window's: a page scrolled under a box placed in page coordinates moves the box with it, footer and all.
  window.addEventListener('scroll', positionPanel, { passive: true });
}

function isAuthorViewing(): boolean {
  return authorLogin()?.toLowerCase() === viewerLogin().toLowerCase();
}

/** Bumped by every read of the pending comments and by a discard: only the latest read's answer is kept. */
let pendingRead = 0;

/** Read the reader's pending comments for the button's pull request, once per visit and again when the box opens. */
async function loadPending(state: Mounted): Promise<readonly PendingComment[] | null> {
  const pullPath = state.pullPath;
  state.pendingFor = pendingKey(state);
  pendingRead += 1;
  const read = pendingRead;
  const pending = await fetchPendingComments(pullPath);
  if (state.pullPath !== pullPath || pendingRead !== read) return null;
  state.pending = pending;
  showCount(state);
  return pending;
}

function pendingKey(state: Mounted): string {
  return `${state.pullPath} ${state.context.page.kind}`;
}

function pendingCount(state: Mounted): number {
  const onPage = pendingCountOnPage();
  // GitHub's button is live on Files changed (its missing counter means none); a copy elsewhere would not follow a submit.
  if (onPage !== null && state.context.page.kind === 'pull-files') return onPage;
  return state.pending?.length ?? 0;
}

/** GitHub's own count (live on the Files changed tab, where its hidden button tracks new comments), else the last read. */
function showCount(state: Mounted): void {
  const count = pendingCount(state);
  const text = count > 0 ? String(count) : '';
  const changed = state.counter.textContent !== text;
  if (changed) state.counter.textContent = text;
  if (state.counter.hidden !== (count === 0)) state.counter.hidden = count === 0;
  const label = KIND_INFO[commentKindOf(state)].label;
  const name = count > 0 ? `${label}, ${count} pending ${count === 1 ? 'comment' : 'comments'}` : label;
  if (state.segments.comment.getAttribute('aria-label') !== name) state.segments.comment.setAttribute('aria-label', name);
  // With comments pending, 💬 has a 1-click review too: its sending glyph and tooltip follow the count.
  if (state.root.hasAttribute(ATTR_PENDING) !== count > 0) {
    state.root.toggleAttribute(ATTR_PENDING, count > 0);
    describeSegments(state);
  }
  showCommentKind(state);
  // An open box defaults its Comment / Review on the count, and its button must name what a click sends.
  if (changed) state.panelRefresh?.();
}

/** What 💬's box would post now: the reader's choice for this pull request, else a review while comments are pending and a comment otherwise. */
function commentKindOf(state: Mounted): CommentKind {
  return drafts.get(state.pullPath)?.kind ?? (pendingCount(state) > 0 ? 'review' : 'comment');
}

/** 💬 wears the kind its box will post: the comment glyph, or `code-review`'s bubble with brackets for a review. */
function showCommentKind(state: Mounted): void {
  const kind = commentKindOf(state);
  const button = state.segments.comment;
  if (button.getAttribute(ATTR_KIND) === kind) return;
  button.setAttribute(ATTR_KIND, kind);
  const [plain, instant] = button.querySelectorAll('.geld-quick-review__glyph');
  plain?.replaceChildren(svgFromString(kind === 'review' ? ICON_CODE_REVIEW : ICON_COMMENT));
  instant?.replaceChildren(svgFromString(kind === 'review' ? ICON_CODE_REVIEW_SEND : ICON_COMMENT_SEND));
  const label = KIND_INFO[kind].label;
  const count = pendingCount(state);
  button.setAttribute('aria-label', count > 0 ? `${label}, ${count} pending ${count === 1 ? 'comment' : 'comments'}` : label);
  describeSegments(state);
}

/**
 * Send one review. On success the box's draft goes, and the Files changed
 * tab (or any tab with pending comments) reloads: GitHub's view still shows
 * the comments just published as pending until it does. Elsewhere the
 * button says what went through for a moment.
 */
async function sendReview(state: Mounted, event: ReviewEvent, body: string): Promise<string | null> {
  const headSha = state.context.headSha() ?? detectHeadSha();
  if (headSha === null) return 'Could not read the pull request’s head commit. Reload the page and try again.';
  const pullPath = state.pullPath;
  const { url, init } = submitReviewRequest(pullPath, { body, event, headSha }, fetchNonce());
  state.sending = true;
  state.root.setAttribute('aria-busy', 'true');
  state.segments[event].setAttribute(ATTR_SENDING, '');
  window.clearTimeout(state.submittedTimer);
  state.status.textContent = 'Submitting…';
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      return reviewErrorText(response.status, payload);
    }
    // An instant send leaves words saved in the box out on purpose: they stay for the next box.
    if (body !== '') clearDraft(pullPath, body);
    // The reader went on to another pull request meanwhile: that page is neither reloaded nor told this one is done.
    // The controls may still name it while the browser already shows the next one (the controller's route pass is debounced).
    if (state.pullPath !== pullPath || pullPathOf(window.location.pathname) !== pullPath) return null;
    showCommentKind(state);
    // A new verdict replaces the reader's standing one, as GitHub counts reviews; a comment leaves it standing.
    showOwnReview(state, event);
    const published = pendingCount(state) > 0;
    // Files changed still draws the comments just published as pending until it reloads; nothing else needs a reload.
    if (published && state.context.page.kind === 'pull-files') {
      window.location.reload();
      return null;
    }
    showDone(state, EVENT_INFO[event].done);
    if (published) {
      // They went with the review: none are pending now, and a read already on its way must not bring them back.
      pendingRead += 1;
      state.pending = [];
      showCount(state);
    }
    // The review in the conversation as GitHub's live update would put it there (a no-op off the classic conversation).
    void catchUpTimeline();
    void loadMergeActions(state);
    return null;
  } catch {
    return 'GitHub could not submit the review.';
  } finally {
    state.sending = false;
    state.panelRefresh?.();
    state.root.removeAttribute('aria-busy');
    state.segments[event].removeAttribute(ATTR_SENDING);
    if (state.status.textContent === 'Submitting…') state.status.textContent = '';
  }
}

/**
 * Post a plain comment on the pull request. Pending review comments stay
 * pending. On the conversation the page reloads to show it; elsewhere the
 * controls say it went through for a moment.
 */
async function sendComment(state: Mounted, text: string): Promise<string | null> {
  const pullPath = state.pullPath;
  const { url, init } = timelineCommentRequest(pullPath, text, fetchNonce());
  state.sending = true;
  state.root.setAttribute('aria-busy', 'true');
  state.segments.comment.setAttribute(ATTR_SENDING, '');
  window.clearTimeout(state.submittedTimer);
  state.status.textContent = 'Posting…';
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const said = messageOf(payload);
      return said === null ? `GitHub could not post the comment (HTTP ${response.status}).` : `GitHub could not post the comment: ${said}`;
    }
    clearDraft(pullPath, text);
    if (state.pullPath !== pullPath || pullPathOf(window.location.pathname) !== pullPath) return null;
    showCommentKind(state);
    showDone(state, 'Commented');
    // The comment in the conversation as GitHub's live update would put it there; a reload where that cannot be done.
    if (state.context.page.kind === 'pull-conversation') {
      void catchUpTimeline().then((caught) => {
        if (!caught && pullPathOf(window.location.pathname) === pullPath) window.location.reload();
      });
    }
    return null;
  } catch {
    return 'GitHub could not post the comment.';
  } finally {
    state.sending = false;
    state.panelRefresh?.();
    state.root.removeAttribute('aria-busy');
    state.segments.comment.removeAttribute(ATTR_SENDING);
    if (state.status.textContent === 'Posting…') state.status.textContent = '';
  }
}

const COMMENT_KINDS: readonly CommentKind[] = ['comment', 'review'];

const KIND_INFO: { readonly [K in CommentKind]: { readonly label: string; readonly note: string; readonly icon: string } } = {
  comment: { label: 'Comment', note: 'Add to the conversation', icon: ICON_COMMENT },
  review: { label: 'Review', note: 'Submit as a review', icon: ICON_CODE_REVIEW },
};

/**
 * The comment box: the words, the pending comments and Cancel beside a
 * submit button that names the verdict in its colour ("Approve" green,
 * "Request changes" red, "Comment" grey). No title and no choices: the
 * segment that opened it chose the verdict, and another segment changes it
 * in place. After a refused send, GitHub's reason above the buttons.
 */
function openComposer(state: Mounted, initial: ReviewEvent, failure: string | null, kindNow: CommentKind | null = null): void {
  const pullPath = state.pullPath;
  const draft = draftFor(pullPath);
  const allowed = (event: ReviewEvent): ReviewEvent => (isAuthorViewing() && !EVENT_INFO[event].authorMay ? 'comment' : event);
  draft.event = allowed(initial);

  // GitHub's own writer when it is at hand; while it is fetched a placeholder in its shape holds its place, and a plain
  // field stands in only if it cannot be had, so the reader never types into one editor that another then replaces.
  const writer = writerNow(pullPath, draft.body);
  let body = writer?.field ?? plainField(draft.body);
  const placeholder = writer === null ? writerPlaceholder() : null;
  body.hidden = placeholder !== null;
  const focusBody = (): void => (placeholder?.isConnected === true ? placeholder : body).focus({ preventScroll: true });
  const pendingSection = createElement('div', { class: 'geld-quick-review__pending' });
  const error = createElement('p', { class: 'geld-quick-review__error color-fg-danger', role: 'alert', hidden: '' });
  if (failure !== null) {
    error.textContent = failure;
    error.hidden = false;
  }
  const discard = createElement('button', { type: 'button', class: 'btn btn-sm btn-invisible geld-quick-review__discard', hidden: '' }, [svgFromString(ICON_TRASH), 'Discard review']);
  const cancel = createElement('button', { type: 'button', class: 'btn btn-sm btn-invisible' }, ['Cancel']);
  const submit = createElement('button', { type: 'button', class: 'btn btn-sm' });
  // 💬's box posts a plain comment or a review: a split button, the choice behind its caret.
  const kindToggle = createElement('button', { type: 'button', class: 'btn btn-sm BtnGroup-item geld-quick-review__kind-toggle', 'aria-label': 'Comment or review', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [svgFromString(ICON_TRIANGLE_DOWN)]);
  const submitGroup = createElement('div', { class: 'geld-quick-review__submit-group' }, [submit]);
  const kindMenu = createElement('div', { class: 'geld-quick-review__menu', role: 'menu', 'aria-label': 'Comment or review', hidden: '' });
  const bodyBox = createElement('div', { class: 'Overlay-body' }, [...(placeholder === null ? [] : [placeholder]), writer?.element ?? body, pendingSection, error]);
  const panel = createElement('div', { class: `Overlay ${PANEL_CLASS} ${PANEL_CLASS}--writer`, [OWN_UI_ATTRIBUTE]: '', role: 'dialog' }, [
    bodyBox,
    createElement('div', { class: 'Overlay-footer geld-quick-review__footer' }, [discard, createElement('div', { class: 'geld-quick-review__actions' }, [cancel, submitGroup])]),
    kindMenu,
  ]);

  let pendingOpen = false;
  // This box's kind when it was opened for one (a refused review of pending comments), else the reader's choice.
  let opened: CommentKind | null = kindNow;
  const kind = (): CommentKind => opened ?? draft.kind ?? (pendingCount(state) > 0 ? 'review' : 'comment');
  const posting = (): boolean => draft.event === 'comment' && kind() === 'comment';
  const showVerdict = (): void => {
    const info = EVENT_INFO[draft.event];
    const split = draft.event === 'comment';
    submit.className = `btn btn-sm geld-quick-review__submit ${info.submitClass}${split ? ' BtnGroup-item' : ''}`.trim();
    if (!state.sending) submit.textContent = split ? KIND_INFO[kind()].label : info.label;
    submitGroup.classList.toggle('BtnGroup', split);
    if ((submitGroup.lastElementChild === kindToggle) !== split) {
      if (split) submitGroup.append(kindToggle);
      else kindToggle.remove();
    }
    if (!split) closeKindMenu();
    panel.setAttribute('aria-label', split ? KIND_INFO[kind()].label : info.label);
  };
  let menuKeys: AbortController | null = null;
  const closeKindMenu = (): void => {
    kindMenu.hidden = true;
    kindToggle.setAttribute('aria-expanded', 'false');
    menuKeys?.abort();
    menuKeys = null;
  };
  const openKindMenu = (): void => {
    kindMenu.replaceChildren(
      ...COMMENT_KINDS.map((option) => {
        const info = KIND_INFO[option];
        const item = createElement('button', { type: 'button', class: 'geld-quick-review__menu-item', role: 'menuitemradio', 'aria-checked': String(kind() === option) }, [
          createElement('span', { class: 'geld-quick-review__menu-visual' }, [svgFromString(info.icon)]),
          createElement('span', { class: 'geld-quick-review__menu-text' }, [createElement('span', { class: 'geld-quick-review__menu-label' }, [info.label]), createElement('span', { class: 'geld-quick-review__menu-note' }, [info.note])]),
          createElement('span', { class: 'geld-quick-review__menu-check', 'aria-hidden': 'true' }, [svgFromString(ICON_CHECK)]),
        ]);
        item.addEventListener('click', () => {
          draft.kind = option;
          opened = null;
          showCommentKind(state);
          closeKindMenu();
          showVerdict();
          refresh();
          submit.focus({ preventScroll: true });
        });
        return item;
      }),
    );
    kindMenu.hidden = false;
    kindToggle.setAttribute('aria-expanded', 'true');
    // Above the caret, its right edge on the caret's: the box's footer is its last row, and the page may end below it.
    const toggle = kindToggle.getBoundingClientRect();
    kindMenu.style.left = `${Math.round(Math.max(8, toggle.right - kindMenu.offsetWidth))}px`;
    kindMenu.style.top = `${Math.round(Math.max(8, toggle.top - kindMenu.offsetHeight - 4))}px`;
    kindMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    // Fixed where the caret was: when the box moves (the page scrolls, the window changes) it closes rather than stay behind.
    menuKeys = new AbortController();
    window.addEventListener('scroll', closeKindMenu, { passive: true, once: true, signal: menuKeys.signal });
    window.addEventListener('resize', closeKindMenu, { once: true, signal: menuKeys.signal });
  };
  // The list is rebuilt only when what it shows changed, not on every keystroke (which would also reset its scroll).
  let shown: { readonly comments: readonly PendingComment[] | null; readonly count: number; readonly open: boolean } | null = null;
  const refresh = (): void => {
    const pending = pendingCount(state);
    // A plain comment needs words; pending comments do not go with it.
    submit.disabled = state.sending || (posting() ? body.value.trim() === '' : !canSubmit(draft.event, body.value, pending > 0));
    kindToggle.disabled = state.sending;
    discard.hidden = pending === 0;
    discard.disabled = state.sending;
    if (shown !== null && shown.comments === state.pending && shown.count === pending && shown.open === pendingOpen) return;
    shown = { comments: state.pending, count: pending, open: pendingOpen };
    renderPending(pendingSection, pullPath, state.pending, pending, pendingOpen, () => {
      pendingOpen = !pendingOpen;
      refresh();
    });
  };
  const send = async (): Promise<void> => {
    if (submit.disabled) return;
    error.hidden = true;
    submit.textContent = posting() ? 'Posting…' : 'Submitting…';
    const pending = posting() ? sendComment(state, body.value) : sendReview(state, draft.event, body.value);
    refresh();
    const failed = await pending;
    showVerdict();
    if (failed === null) {
      if (state.panel === panel) closePanel(true);
      return;
    }
    error.textContent = failed;
    error.hidden = false;
    refresh();
  };

  // On the box, not the field: GitHub's toolbar writes through `input` too, and the field is swapped when the writer lands.
  bodyBox.addEventListener('input', (event) => {
    if (event.target !== body) return;
    draft.body = body.value;
    refresh();
  });
  panel.addEventListener('keydown', (event) => {
    // GitHub's suggestion lists (mentions, references, saved replies) close on Escape themselves.
    if (event.key === 'Escape' && event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!kindMenu.hidden) {
        closeKindMenu();
        kindToggle.focus({ preventScroll: true });
      } else closePanel(true);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    } else if (!kindMenu.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...kindMenu.querySelectorAll<HTMLElement>('.geld-quick-review__menu-item')];
      const at = items.findIndex((item) => item === document.activeElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus({ preventScroll: true });
    }
  });
  panel.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!kindMenu.hidden && target instanceof Node && !kindMenu.contains(target) && !kindToggle.contains(target)) closeKindMenu();
  });
  cancel.addEventListener('click', () => closePanel(true));
  submit.addEventListener('click', () => void send());
  kindToggle.addEventListener('click', () => {
    if (kindMenu.hidden) openKindMenu();
    else closeKindMenu();
  });
  discard.addEventListener('click', () => {
    // GitHub's own words and its own (native) confirmation, as its Discard review asks.
    if (!window.confirm('Are you sure you want to cancel? You will lose all your pending comments.')) return;
    state.sending = true;
    refresh();
    void discardPendingReview(pullPath).then((done) => {
      state.sending = false;
      state.panelRefresh?.();
      if (!done) {
        error.textContent = 'GitHub could not discard the review.';
        error.hidden = false;
        refresh();
        return;
      }
      closePanel(true);
      // The Files changed tab still draws the discarded comments until it reloads.
      if (state.context.page.kind === 'pull-files') {
        window.location.reload();
        return;
      }
      // A read started before the discard would bring the discarded comments back.
      pendingRead += 1;
      state.pending = [];
      showCount(state);
    });
  });

  showPanel(state, panel, initial);
  state.panelRefresh = () => {
    showVerdict();
    refresh();
  };
  state.panelCleanup = closeKindMenu;
  state.retarget = (event) => {
    draft.event = allowed(event);
    if (state.opener !== null) buttonFor(state, state.opener)?.setAttribute('aria-expanded', 'false');
    state.opener = event;
    state.segments[event].setAttribute('aria-expanded', 'true');
    error.hidden = true;
    showVerdict();
    refresh();
    focusBody();
  };
  showVerdict();
  refresh();
  if (writer !== null) fitWriter(panel, bodyBox, writer.element);
  else if (writerWidth !== null) fitWidth(panel, writerWidth);
  focusBody();
  if (writer === null) {
    const showPlain = (): void => {
      if (placeholder === null || !placeholder.isConnected) return;
      const focused = document.activeElement === placeholder;
      placeholder.remove();
      body.hidden = false;
      if (focused) body.focus({ preventScroll: true });
    };
    const patience = window.setTimeout(showPlain, WRITER_PATIENCE_MS);
    void loadWriter(pullPath, body.value).then((loaded) => {
      window.clearTimeout(patience);
      if (state.panel !== panel || !body.isConnected) return;
      if (loaded === null) {
        showPlain();
        return;
      }
      const plain = body;
      const waited = placeholder?.isConnected === true;
      const focused = document.activeElement === (waited ? placeholder : plain);
      loaded.field.value = plain.value;
      placeholder?.remove();
      plain.replaceWith(loaded.element);
      body = loaded.field;
      fitWriter(panel, bodyBox, loaded.element);
      if (focused) {
        body.focus({ preventScroll: true });
        if (waited) body.setSelectionRange(body.value.length, body.value.length);
        else body.setSelectionRange(plain.selectionStart, plain.selectionEnd, plain.selectionDirection);
      }
    });
  }
  // Comments the reader left with "Start a review" go out with this review, words or not; read them afresh.
  void loadPending(state).then(() => {
    if (state.panel !== panel) return;
    // Pending comments arriving make a review the default for 💬, unless the reader chose already.
    showVerdict();
    refresh();
  });
}

/** How long the box waits for GitHub's writer before the plain field takes its place. */
const WRITER_PATIENCE_MS = 5000;

/** The width the last writer was fitted to, so a box waiting for the next one opens at that width. */
let writerWidth: number | null = null;

/** The writer's shape (Write and Preview, the toolbar, the field) while it is fetched; focusable, so Escape still closes the box. */
function writerPlaceholder(): HTMLElement {
  const bar = (width: number): HTMLElement => createElement('span', { class: 'geld-quick-review__writer-bar', style: `width: ${width}px` });
  return createElement('div', { class: 'geld-quick-review__writer-placeholder', tabindex: '-1', role: 'status', 'aria-label': 'Loading the comment editor' }, [
    createElement('div', { class: 'geld-quick-review__writer-head' }, [bar(56), bar(64), createElement('span', { class: 'geld-quick-review__writer-gap' }), bar(120), bar(96)]),
    createElement('div', { class: 'geld-quick-review__writer-field' }),
  ]);
}

function plainField(text: string): HTMLTextAreaElement {
  const field = createElement('textarea', { class: 'form-control width-full geld-quick-review__body', placeholder: 'Leave a comment', 'aria-label': 'Review comment', rows: '4' });
  field.value = text;
  return field;
}

/** Room past the writer's own width, so its toolbar folds no button into "⋯" and stops short of the box's edge. */
const WRITER_CUSHION = 16;

/** The box as wide as GitHub's writer needs for every toolbar button, plus the cushion, inside the viewport. */
function fitWriter(panel: HTMLElement, bodyBox: HTMLElement, writer: HTMLElement): void {
  writer.style.width = 'max-content';
  const natural = writer.offsetWidth;
  writer.style.width = '';
  const box = getComputedStyle(bodyBox);
  const chrome = panel.offsetWidth - panel.clientWidth + parseFloat(box.paddingLeft) + parseFloat(box.paddingRight);
  writerWidth = Math.round(natural + chrome + WRITER_CUSHION);
  fitWidth(panel, writerWidth);
  // GitHub's toolbar can measure narrower than it lays out (its buttons are sized by its own scripts once in the page):
  // whatever still reaches past the row's edge widens the box by that much, so no button runs off it.
  const row = writer.querySelector('.CommentBox-header');
  if (row === null) return;
  const edge = row.getBoundingClientRect().right;
  const reach = [...row.querySelectorAll<HTMLElement>('button, a[href], summary')].reduce((far, control) => {
    const rect = control.getBoundingClientRect();
    return rect.width > 0 ? Math.max(far, rect.right) : far;
  }, edge);
  const over = Math.ceil(reach - edge);
  if (over <= 0) return;
  writerWidth += over;
  fitWidth(panel, writerWidth);
}

function fitWidth(panel: HTMLElement, width: number): void {
  panel.style.width = `${Math.min(width, document.documentElement.clientWidth - 32)}px`;
  // Measured once: a window narrowed (or zoomed) afterwards still keeps the box, and its buttons, inside it.
  panel.style.maxWidth = 'calc(100vw - 32px)';
  positionPanel();
}

/** The footer every box shares: anything on the left, then Cancel and the action. */
function boxFooter(left: readonly HTMLElement[], cancel: HTMLButtonElement, submit: HTMLButtonElement): HTMLElement {
  return createElement('div', { class: 'Overlay-footer geld-quick-review__footer' }, [...left, createElement('div', { class: 'geld-quick-review__actions' }, [cancel, submit])]);
}

const ACTION_STATUS: { readonly [K in StatusAction]: string } = { merge: 'Merging…', queue: 'Adding to merge queue…', auto: 'Enabling auto-merge…', close: 'Closing…', ready: 'Marking ready…', draft: 'Converting to draft…', reopen: 'Reopening…' };

interface Step {
  /** The pull request it changes, named in a failure among several; null for the page's own alone. */
  readonly number: number | null;
  readonly request: { readonly url: string; readonly init: RequestInit };
}

/** Send a merge, close or ready for review; on success the page reloads, since every part of it (header, timeline, tabs) changes with the state. */
async function sendAction(state: Mounted, kind: StatusAction, request: Step['request'], done: () => void = () => undefined): Promise<string | null> {
  // An answer that comes back after the reader moved to another pull request completes nothing there and reloads nothing.
  const pullPath = state.pullPath;
  const here = (): boolean => mounted === state && state.pullPath === pullPath && pullPathOf(window.location.pathname) === pullPath;
  return (await sendSteps(state, kind, [{ number: null, request }], done, here))?.failed ?? null;
}

/**
 * Each request in turn, stopping at the first GitHub refuses: its reason, and the requests from it on, for another try.
 * Stops quietly, sending nothing more and reloading nothing, once `here` says the reader has left the page it began on.
 */
async function sendSteps(state: Mounted, kind: StatusAction, steps: readonly Step[], done: () => void = () => undefined, here: () => boolean = () => true): Promise<{ readonly failed: string; readonly left: readonly Step[] } | null> {
  state.sending = true;
  state.root.setAttribute('aria-busy', 'true');
  window.clearTimeout(state.submittedTimer);
  state.status.textContent = ACTION_STATUS[kind];
  for (const pill of state.pills) pill.setAttribute('aria-busy', 'true');
  try {
    for (const [index, step] of steps.entries()) {
      if (!here()) return null;
      let failed: string | null;
      try {
        const response = await fetch(step.request.url, step.request.init);
        const payload: unknown = await response.json().catch(() => null);
        const refused = typeof payload === 'object' && payload !== null && Reflect.get(payload, 'status') === 'failed';
        failed = !response.ok || refused ? actionErrorText(kind, response.status, payload) : null;
      } catch {
        failed = actionErrorText(kind, 0, null);
      }
      if (failed !== null) {
        // The ones before it went through: the menu is read again so it offers nothing they already did.
        if (index > 0) void loadMergeActions(state);
        return { failed: step.number === null ? failed : `#${step.number}: ${failed}`, left: steps.slice(index) };
      }
    }
    if (!here()) return null;
    done();
    window.location.reload();
    return null;
  } finally {
    state.sending = false;
    state.panelRefresh?.();
    state.root.removeAttribute('aria-busy');
    for (const pill of state.pills) pill.removeAttribute('aria-busy');
    if (state.status.textContent === ACTION_STATUS[kind]) state.status.textContent = '';
  }
}

/**
 * The merge box: GitHub's choice of method (only those the repository
 * allows the reader, its default first), the commit GitHub would write for
 * it, editable (none for a rebase), and, where only an admin's bypass would
 * take it, GitHub's own checkbox, which the confirmation waits on. Read
 * afresh as it opens, since checks and reviews land meanwhile.
 */
function openMergeBox(state: Mounted, failure: string | null = null, pastRules = false): void {
  const pullPath = state.pullPath;
  const known = state.mergeActions;
  if (known === null || known.offer === null) return;
  const bypass = pastRules || known.offer === 'bypass';
  // Past the rules a queue's repository may allow no direct method otherwise: the box read past them lists them.
  const methods = bypass && known.bypassMethods.length > 0 ? known.bypassMethods : known.box.methods;
  let method: MergeMethod = methods[0] ?? 'SQUASH';
  let box: MergeBox = known.box;
  // The method `box`'s commit was written for: until the chosen method's has come, the confirmation waits.
  let boxFor: MergeMethod = known.box.methods[0] ?? 'SQUASH';
  // False after a failed read: `box` then holds another method's commit, which must not fill the fields.
  let commitFresh = true;
  let edited = false;

  const select = createElement('select', { class: 'form-select select-sm geld-quick-review__method', 'aria-label': 'Merge method' }, methods.map((name) => createElement('option', { value: name }, [METHOD_LABEL[name]])));
  select.hidden = methods.length < 2;
  const title = createElement('input', { type: 'text', class: 'form-control input-sm width-full geld-quick-review__commit-title', 'aria-label': 'Commit message' });
  const message = createElement('textarea', { class: 'form-control width-full geld-quick-review__body geld-quick-review__commit-body', 'aria-label': 'Extended description', rows: '4' });
  const commit = createElement('div', { class: 'geld-quick-review__commit' }, [title, message]);
  const consent = createElement('input', { type: 'checkbox', class: 'geld-quick-review__bypass-box' });
  // GitHub's words for the checkbox in its merge box.
  const bypassRow = createElement('label', { class: 'geld-quick-review__bypass' }, [consent, createElement('span', {}, ['Merge without waiting for requirements to be met (bypass rules)'])]);
  bypassRow.hidden = !bypass;
  // A stacked pull request merges with GitHub's stack merge, which takes every pull request below it too.
  const stackNote = createElement('p', { class: 'geld-quick-review__stack-note color-fg-muted' }, ['Merges every pull request in the stack up to and including this one.']);
  stackNote.hidden = !known.box.stacked;
  const error = createElement('p', { class: 'geld-quick-review__error color-fg-danger', role: 'alert', hidden: '' });
  if (failure !== null) {
    error.textContent = failure;
    error.hidden = false;
  }
  const cancel = createElement('button', { type: 'button', class: 'btn btn-sm btn-invisible' }, ['Cancel']);
  const submit = createElement('button', { type: 'button', class: 'btn btn-sm geld-quick-review__submit' });
  const panel = createElement('div', { class: `Overlay ${PANEL_CLASS}`, [OWN_UI_ATTRIBUTE]: '', role: 'dialog', 'aria-label': 'Merge pull request' }, [
    createElement('div', { class: 'Overlay-body' }, [select, commit, stackNote, bypassRow, error]),
    boxFooter([], cancel, submit),
  ]);

  const fill = (): void => {
    commit.hidden = method === 'REBASE';
    if (!edited) {
      title.value = boxFor === method && commitFresh ? box.commitTitle : '';
      message.value = boxFor === method && commitFresh ? box.commitMessage : '';
    }
  };
  const refresh = (): void => {
    const past = bypass && consent.checked;
    submit.className = `btn btn-sm geld-quick-review__submit ${past ? 'geld-quick-review__submit--danger' : 'btn-primary'}`;
    if (!state.sending) submit.textContent = past ? 'Bypass rules and merge' : METHOD_CONFIRM[method];
    submit.disabled = state.sending || boxFor !== method || (bypass && !consent.checked) || (method !== 'REBASE' && title.value.trim() === '');
  };
  // GitHub writes a different commit for each method (a merge commit names the branch, a squash lists the commits).
  // An answer for a method no longer chosen is dropped; a failed one leaves the fields to the reader.
  const load = (asked: MergeMethod): void => {
    void fetchMergeBox(pullPath, asked, bypass).then((fresh) => {
      if (state.panel !== panel || method !== asked) return;
      commitFresh = fresh !== null;
      if (fresh !== null) box = fresh;
      boxFor = asked;
      fill();
      refresh();
    });
  };
  const send = async (): Promise<void> => {
    if (submit.disabled) return;
    error.hidden = true;
    const pending = sendAction(state, 'merge', mergeRequest(pullPath, { method, commitTitle: title.value, commitMessage: message.value, authorEmail: box.authorEmail, bypass: bypass && consent.checked, stacked: box.stacked }, fetchNonce()), () => showMerged(state, pullPath));
    submit.textContent = 'Merging…';
    refresh();
    const failed = await pending;
    refresh();
    if (failed === null) return;
    error.textContent = failed;
    error.hidden = false;
  };

  select.addEventListener('change', () => {
    const chosen = methods.find((name) => name === select.value);
    if (chosen === undefined) return;
    method = chosen;
    fill();
    refresh();
    load(chosen);
  });
  for (const field of [title, message]) {
    field.addEventListener('input', () => {
      edited = true;
      refresh();
    });
  }
  consent.addEventListener('change', refresh);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel(true);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  });
  cancel.addEventListener('click', () => closePanel(true));
  submit.addEventListener('click', () => void send());

  showPanel(state, panel, 'merge');
  state.panelRefresh = refresh;
  fill();
  refresh();
  (bypass ? consent : submit).focus({ preventScroll: true });
  load(method);
}

/**
 * The box a refused status change opens: GitHub's reason, Cancel and the
 * action again in GitHub's words.
 */
function openConfirmBox(state: Mounted, kind: Exclude<StatusAction, 'merge'>, failure: string | null = null): void {
  const pullPath = state.pullPath;
  const { icon, label, request } = CONFIRM_INFO[kind];
  openRetryBox(state, kind, failure, { icon, label, run: () => sendAction(state, kind, request(pullPath, fetchNonce())) });
}

interface Retry {
  readonly icon: string;
  readonly label: string;
  /** Sends it again: null once it went through (the page reloads), else GitHub's reason. */
  readonly run: () => Promise<string | null>;
}

/** GitHub's reason a change was refused, with a button to try it again. */
function openRetryBox(state: Mounted, kind: StatusAction, failure: string | null, retry: Retry): void {
  const { icon, label } = retry;
  const error = createElement('p', { class: 'geld-quick-review__error color-fg-danger', role: 'alert', hidden: '' });
  if (failure !== null) {
    error.textContent = failure;
    error.hidden = false;
  }
  const cancel = createElement('button', { type: 'button', class: 'btn btn-sm btn-invisible' }, ['Cancel']);
  const submit = createElement('button', { type: 'button', class: 'btn btn-sm geld-quick-review__submit geld-quick-review__confirm-submit', 'data-action': kind }, [svgFromString(icon), label]);
  const panel = createElement('div', { class: `Overlay ${PANEL_CLASS} geld-quick-review__panel--compact`, [OWN_UI_ATTRIBUTE]: '', role: 'dialog', 'aria-label': label }, [
    createElement('div', { class: 'Overlay-body' }, [error]),
    boxFooter([], cancel, submit),
  ]);
  const send = async (): Promise<void> => {
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    const failed = await retry.run();
    submit.disabled = false;
    if (failed === null) return;
    error.textContent = failed;
    error.hidden = false;
    // The box is as wide as its contents: the reason widens it, so it is placed again inside the viewport.
    positionPanel();
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel(true);
    }
  });
  cancel.addEventListener('click', () => closePanel(true));
  submit.addEventListener('click', () => void send());
  showPanel(state, panel, kind);
  submit.focus({ preventScroll: true });
}

/**
 * "Pending comments N" under the words, one line per comment as the
 * digest lists threads: the comment's first sentence, then its file and
 * line, the line leading to the comment on the Files changed tab. Folds,
 * closed at first. Nothing when there are none; the count alone while
 * GitHub's own count is ahead of the list (a comment added on Files changed
 * since the list was read).
 */
function renderPending(section: HTMLElement, pullPath: string, comments: readonly PendingComment[] | null, count: number, open: boolean, onToggle: () => void): void {
  section.replaceChildren();
  section.hidden = count === 0;
  if (count === 0) return;
  const toggle = createElement('button', { type: 'button', class: 'geld-quick-review__pending-toggle', 'aria-expanded': String(open) }, [
    svgFromString(ICON_CHEVRON_DOWN),
    createElement('span', {}, ['Pending comments']),
    createElement('span', { class: 'Counter' }, [String(count)]),
  ]);
  toggle.addEventListener('click', onToggle);
  section.append(toggle);
  if (!open || comments === null) return;
  const tabIsChanges = location.pathname.startsWith(`${pullPath}/changes`) || document.querySelector(`a[href="${pullPath}/changes"]`) !== null;
  const list = createElement('ul', { class: 'geld-quick-review__pending-list' });
  for (const comment of comments) {
    const file = comment.path.split('/').pop() ?? comment.path;
    const where = comment.line === null ? file : `${file}:${comment.line}`;
    const link = createElement('a', { class: 'geld-quick-review__pending-row', href: comment.href === null ? '#' : linkOnFilesTab(comment.href, pullPath, tabIsChanges), title: `${comment.path}${comment.line === null ? '' : `, line ${comment.line}`}` }, [
      createElement('span', { class: 'geld-quick-review__pending-glyph' }, [svgFromString(ICON_COMMENT)]),
      createElement('span', { class: 'geld-quick-review__pending-text' }, inlineText(firstSentence(comment.body))),
      createElement('span', { class: 'geld-quick-review__pending-where' }, [where]),
      ...(comment.outdated ? [createElement('span', { class: 'Label Label--secondary' }, ['Outdated'])] : []),
    ]);
    list.append(createElement('li', {}, [link]));
  }
  section.append(list);
}

function showDone(state: Mounted, words: string): void {
  window.clearTimeout(state.submittedTimer);
  state.status.textContent = words;
  state.submittedTimer = window.setTimeout(() => {
    state.status.textContent = '';
  }, SUBMITTED_MS);
}
