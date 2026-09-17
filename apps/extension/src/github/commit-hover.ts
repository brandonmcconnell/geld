import type { PathMatcher, RepoRule } from '@geld/core';
import { decideRepo } from '@geld/core';
import { breakdownFromFiles, hiddenNounPlural, statsBreakdown } from './breakdown';
import type { DiffFetchState, DiffSource } from './diff-source';
import { isOwnElement } from './dom';
import type { Subject } from './subject';
import { commitSubjectFrom } from './subject';
import { hideTooltip, showBreakdownTooltip, showTooltipMessage, tooltipHost } from './ui/tooltip';

/**
 * Line counts for the commits a page links to — the conversation timeline
 * and the Commits tab of a pull request, a branch's commit list — shown as
 * the breakdown tooltip on the commit link itself.
 *
 * A PR can list hundreds of commits, so nothing is fetched up front and a
 * pointer passing over a link costs nothing: a link has to be hovered for
 * `HOVER_INTENT_MS` (or focused) before its `.diff` is requested, and the
 * tooltip follows when the diff lands. Everything is delegated from the
 * document — no per-link listeners, so the size of the list does not matter.
 */

/** How long the pointer rests on a commit link before Geld counts it. */
export const HOVER_INTENT_MS = 300;
const ATTR_HELD_TITLE = 'data-geld-held-title';

export interface CommitHoverOptions {
  readonly matcherFor: (repo: string) => PathMatcher;
  readonly repoRules: readonly RepoRule[];
  readonly diffSource: DiffSource;
  readonly hideCommentLines: boolean;
}

interface Target {
  readonly link: HTMLAnchorElement;
  readonly subject: Subject;
}

let options: CommitHoverOptions | null = null;
let bound = false;
/** The commit link under the pointer (or focused), whether or not intent has been shown yet. */
let hovered: Target | null = null;
let intentTimer: ReturnType<typeof setTimeout> | null = null;
/** The link whose tooltip is up (or on its way); `hovered.link` once intent is established. */
let armed: Target | null = null;
/** What the tooltip currently shows for `armed`, so a re-apply with nothing new does not redraw it. */
let presented: DiffFetchState | null = null;

/** The commit a link names, unless GitHub already explains it with a hovercard (which Geld rewrites instead). */
function targetOf(node: EventTarget | null): Target | null {
  if (!(node instanceof Element)) return null;
  const link = node.closest<HTMLAnchorElement>('a[href]');
  if (link === null || isOwnElement(link)) return null;
  if ((link.getAttribute('data-hovercard-url') ?? '').includes('/commit/')) return null;
  let url: URL;
  try {
    url = new URL(link.href, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return null;
  const subject = commitSubjectFrom(url.pathname);
  return subject === null ? null : { link, subject };
}

function clearIntent(): void {
  if (intentTimer !== null) clearTimeout(intentTimer);
  intentTimer = null;
}

/**
 * GitHub gives commit message links a `title` with the full message, and the
 * browser's own tooltip for it would land on top of Geld's. Hold the title
 * while Geld's tooltip is up and give it back after.
 */
function holdTitle(link: HTMLAnchorElement): void {
  const title = link.getAttribute('title');
  if (title === null) return;
  link.setAttribute(ATTR_HELD_TITLE, title);
  link.removeAttribute('title');
}

function releaseTitle(link: HTMLAnchorElement): void {
  const title = link.getAttribute(ATTR_HELD_TITLE);
  if (title === null) return;
  link.setAttribute('title', title);
  link.removeAttribute(ATTR_HELD_TITLE);
}

function disarm(): void {
  clearIntent();
  if (armed !== null) {
    if (tooltipHost() === armed.link) hideTooltip();
    releaseTitle(armed.link);
  }
  armed = null;
  presented = null;
}

/** Show (or refresh) the tooltip for the armed link from whatever the diff source has now. */
function present(): void {
  if (armed === null || options === null) return;
  const { link, subject } = armed;
  if (!decideRepo(options.repoRules, subject.repo).allowed) return;
  const state = options.diffSource.request(subject.diffUrl, subject.sha);
  if (state === presented) return;
  presented = state;
  switch (state.status) {
    case 'ready': {
      const matcher = options.matcherFor(subject.repo);
      const { all, hidden } = breakdownFromFiles(state.files, matcher, options.hideCommentLines);
      showBreakdownTooltip(link, statsBreakdown(all, hidden, hiddenNounPlural(matcher.activeCategories, hidden), matcher.activeCategories));
      return;
    }
    case 'idle':
    case 'loading':
      showTooltipMessage(link, 'Counting\u2026');
      return;
    case 'failed':
      showTooltipMessage(link, state.reason === 'rate-limited' ? 'GitHub is rate limiting diffs \u2014 try again shortly' : 'Line counts unavailable for this commit');
      return;
  }
}

function arm(): void {
  clearIntent();
  if (hovered === null) return;
  armed = hovered;
  presented = null;
  holdTitle(armed.link);
  present();
}

function enter(target: Target, immediate: boolean): void {
  if (hovered?.link === target.link) return;
  if (armed !== null && armed.link !== target.link) disarm();
  else clearIntent();
  hovered = target;
  if (immediate) arm();
  else intentTimer = setTimeout(arm, HOVER_INTENT_MS);
}

function leave(): void {
  hovered = null;
  disarm();
}

function onMouseOver(event: MouseEvent): void {
  const target = targetOf(event.target);
  // A move within the hovered link resolves to the same link; anything else is a leave.
  if (target === null) leave();
  else enter(target, false);
}

function onMouseOut(event: MouseEvent): void {
  if (hovered === null) return;
  const to = event.relatedTarget;
  if (to instanceof Node && hovered.link.contains(to)) return;
  if (!hovered.link.contains(event.target instanceof Node ? event.target : null)) return;
  leave();
}

function onFocusIn(event: FocusEvent): void {
  const target = targetOf(event.target);
  if (target !== null) enter(target, true);
}

function onFocusOut(event: FocusEvent): void {
  if (hovered !== null && event.target === hovered.link) leave();
}

/**
 * Enable commit tooltips with the current options; called on every apply so
 * an armed link whose diff has just arrived (the diff source re-applies) gets
 * its tooltip filled in.
 */
export function applyCommitHover(next: CommitHoverOptions): void {
  options = next;
  if (!bound) {
    bound = true;
    document.addEventListener('mouseover', onMouseOver, { capture: true, passive: true });
    document.addEventListener('mouseout', onMouseOut, { capture: true, passive: true });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
  }
  if (armed !== null) {
    if (!armed.link.isConnected) disarm();
    else present();
  }
}

export function removeCommitHover(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[${ATTR_HELD_TITLE}]`)) releaseTitle(link);
  if (bound) {
    document.removeEventListener('mouseover', onMouseOver, { capture: true });
    document.removeEventListener('mouseout', onMouseOut, { capture: true });
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    bound = false;
  }
  leave();
  options = null;
}
