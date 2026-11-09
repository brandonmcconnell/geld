import type { AuthorRules } from '@geld/core';
import { OWN_UI_ATTRIBUTE } from '../dom';
import { loginOfLink } from './login';

/**
 * People (and bots) the digest leaves out: anyone GitHub shows with content
 * hidden as spam or abuse on this pull request, and anyone matching the
 * reader's hidden people list (`hiddenAuthors`). GitHub hides one comment at
 * a time and keeps counting the rest, so a person with one comment marked as
 * spam would still put a verdict and pills in the digest; the reason says
 * something about the person, so the digest leaves all of them out. Outdated,
 * duplicate, resolved and off-topic say something about the comment and
 * leave its author in.
 */

export type GitHubHideReason = 'spam' | 'abuse' | 'off-topic' | 'outdated' | 'duplicate' | 'resolved';

const PERSON_REASONS: ReadonlySet<GitHubHideReason> = new Set<GitHubHideReason>(['spam', 'abuse']);

const MARKED = /\bthis (?:comment|review) (?:was|has been) marked as (spam|abuse|disruptive(?: content)?|off[- ]?topic|outdated|duplicate|resolved)\b/i;

/** GitHub's reason from a hidden comment's header ("This comment was marked as spam."), or null. */
export function hideReasonOf(text: string): GitHubHideReason | null {
  const word = MARKED.exec(text.replace(/\s+/g, ' '))?.[1]?.toLowerCase();
  if (word === undefined) return null;
  if (word.startsWith('disruptive')) return 'abuse';
  if (word.startsWith('off')) return 'off-topic';
  if (word === 'spam' || word === 'abuse' || word === 'outdated' || word === 'duplicate' || word === 'resolved') return word;
  return null;
}

/** One comment or review GitHub shows hidden for a reason about its author. */
export interface MarkedContent {
  readonly login: string;
  readonly bot: boolean;
  readonly avatarSrc: string | null;
  readonly reason: GitHubHideReason;
  /** The comment's or review's id, for showing it in the timeline. */
  readonly anchor: string | null;
  /** The timeline node to fold with the person. */
  readonly root: HTMLElement;
  /** GitHub's own Unhide on it, when the page offers it to the reader. */
  readonly unhide: HTMLElement | null;
}

const HEADERS = 'summary, h3.timeline-comment-header-text, .minimized-comment-header, [data-testid="minimized-comment-header"]';
const CONTAINER = '.review-comment, .js-comment-container, [data-testid="comment-container"], .TimelineItem, .js-minimize-container, .js-timeline-item';
const AUTHOR = 'a.TimelineItem-avatar, a.author, a[data-hovercard-type="user"], img[data-hovercard-url^="/users/"], a[data-testid="avatar-link"], a[href^="/apps/"]';
const ANCHOR = '[id^="pullrequestreview-"], [id^="issuecomment-"], [id^="discussion_r"]';
const EVENT_PEOPLE = 'a[data-hovercard-type="user"], a.author, [data-hovercard-url^="/users/"]';

function isOwn(node: Element): boolean {
  return node.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null;
}

/** GitHub's own Unhide inside a hidden comment: its unminimize form's button, or a control that says Unhide. */
function unhideControlIn(container: Element): HTMLElement | null {
  const form = container.querySelector<HTMLFormElement>('form[action*="unminimize" i], form.js-comment-unminimize, form[class*="unminimize" i]');
  const submit = form?.querySelector<HTMLElement>('button[type="submit"], button:not([type]), input[type="submit"]');
  if (submit !== null && submit !== undefined) return submit;
  for (const control of container.querySelectorAll<HTMLElement>('button, [role="menuitem"]')) {
    if ((control.textContent ?? '').trim().toLowerCase() === 'unhide') return control;
  }
  return null;
}

/** Every comment or review on the page GitHub shows as hidden for spam or abuse, with whose it is. */
export function markedOnGitHub(root: ParentNode = document): readonly MarkedContent[] {
  const found: MarkedContent[] = [];
  const seen = new Set<Element>();
  for (const header of root.querySelectorAll(HEADERS)) {
    if (isOwn(header)) continue;
    const reason = hideReasonOf(header.textContent ?? '');
    if (reason === null || !PERSON_REASONS.has(reason)) continue;
    const container = header.closest(CONTAINER);
    if (container === null || seen.has(container)) continue;
    seen.add(container);
    const link = [...container.querySelectorAll(AUTHOR)].find((candidate) => !header.contains(candidate));
    const login = link === undefined ? null : loginOfLink(link);
    if (login === null || login === '') continue;
    const picture = link?.matches('img') === true ? link : (link?.querySelector('img') ?? container.querySelector('img.avatar'));
    const anchored = header.closest(ANCHOR) ?? container.querySelector(ANCHOR);
    const rootNode = container.closest('.js-timeline-item') ?? container;
    if (!(rootNode instanceof HTMLElement)) continue;
    found.push({
      login,
      bot: login.endsWith('[bot]'),
      avatarSrc: picture?.getAttribute('src') ?? null,
      reason,
      anchor: anchored?.id ?? null,
      root: rootNode,
      unhide: unhideControlIn(container),
    });
  }
  return found;
}

export type HiddenWhy =
  | { readonly by: 'github'; readonly reason: GitHubHideReason; readonly anchors: readonly string[]; readonly unhide: boolean }
  | { readonly by: 'list'; readonly rule: string };

/** Someone the digest leaves out, for the hidden people menu. */
export interface HiddenPerson {
  readonly login: string;
  readonly bot: boolean;
  readonly avatarSrc: string | null;
  readonly why: HiddenWhy;
  /** The reader is peeking: their content is in the digest for this visit. */
  readonly peeking: boolean;
}

interface Entry {
  login: string;
  bot: boolean;
  avatarSrc: string | null;
  why: HiddenWhy;
}

/**
 * The pass's ledger of hidden people: `hides` answers whether a login's
 * content is left out and records whoever it met, so the menu lists only
 * people with something on this pull request.
 */
export class HiddenPeople {
  private readonly entries = new Map<string, Entry>();
  private readonly marked: ReadonlyMap<string, readonly MarkedContent[]>;

  constructor(
    marked: readonly MarkedContent[],
    private readonly rules: AuthorRules,
    private readonly peeking: ReadonlySet<string>,
  ) {
    const byLogin = new Map<string, MarkedContent[]>();
    for (const content of marked) {
      const key = content.login.toLowerCase();
      byLogin.set(key, [...(byLogin.get(key) ?? []), content]);
    }
    this.marked = byLogin;
    for (const [key, contents] of byLogin) {
      const first = contents[0];
      if (first === undefined) continue;
      this.entries.set(key, {
        login: first.login,
        bot: first.bot,
        avatarSrc: contents.find((content) => content.avatarSrc !== null)?.avatarSrc ?? null,
        why: { by: 'github', reason: first.reason, anchors: contents.flatMap((content) => (content.anchor === null ? [] : [content.anchor])), unhide: contents.some((content) => content.unhide !== null) },
      });
    }
  }

  /** Whether `login`'s content stays out of the digest (hidden and not peeked at). */
  hides(login: string, bot: boolean, avatarSrc: string | null = null): boolean {
    if (login === '') return false;
    const key = login.toLowerCase();
    let entry = this.entries.get(key);
    if (entry === undefined) {
      const rule = this.rules.explain(login);
      if (rule === null) return false;
      entry = { login, bot, avatarSrc, why: { by: 'list', rule } };
      this.entries.set(key, entry);
    } else if (entry.avatarSrc === null && avatarSrc !== null) {
      entry.avatarSrc = avatarSrc;
    }
    return !this.peeking.has(key);
  }

  /** Whether anyone with that login is hidden, peeked at or not. */
  isHidden(login: string): boolean {
    return this.entries.has(login.toLowerCase());
  }

  /** Whether a timeline event names someone already hidden and not peeked at ("deleted a comment from X"). */
  namesHidden(event: Element): boolean {
    for (const link of event.querySelectorAll(EVENT_PEOPLE)) {
      const login = loginOfLink(link)?.toLowerCase();
      if (login !== undefined && this.entries.has(login) && !this.peeking.has(login)) return true;
    }
    return false;
  }

  /** Timeline nodes GitHub shows hidden for people who stay hidden, to fold with them. */
  markedRoots(): readonly HTMLElement[] {
    return [...this.marked].filter(([key]) => !this.peeking.has(key)).flatMap(([, contents]) => contents.map((content) => content.root));
  }

  /** GitHub's own Unhide controls on `login`'s hidden content. */
  unhideControls(login: string): readonly HTMLElement[] {
    return (this.marked.get(login.toLowerCase()) ?? []).flatMap((content) => (content.unhide === null ? [] : [content.unhide]));
  }

  people(): readonly HiddenPerson[] {
    return [...this.entries.values()]
      .map((entry) => ({ login: entry.login, bot: entry.bot, avatarSrc: entry.avatarSrc, why: entry.why, peeking: this.peeking.has(entry.login.toLowerCase()) }))
      .sort((a, b) => a.login.localeCompare(b.login));
  }
}

/** The list lines that hide exactly `login` (no wildcard), which Unhide removes. */
export function exactRulesFor(lines: readonly string[], login: string): readonly string[] {
  const wanted = login.toLowerCase();
  return lines.filter((line) => line.trim().replace(/^@/, '').toLowerCase() === wanted);
}
