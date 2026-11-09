import type { AuthorRules } from '@geld/core';
import { OWN_UI_ATTRIBUTE } from '../dom';
import { pageFetch } from '../page-fetch';
import type { BlockScope } from '../blocked-list';
import { fragmentHeaders } from './deeplink';
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
  /** The node id GitHub's Unhide names (`IC_…`, `PRR_…`), which keys the form looked up for it. */
  readonly gid: string | null;
  /** Where GitHub keeps the hidden comment's menu, which holds Unhide for those who may use it. */
  readonly menuSource: { readonly kind: 'menu' | 'content'; readonly url: string } | null;
}

/** GitHub's Unhide form: its action and fields (`_method=put`, the token, `comment_id`). */
export interface UnhideForm {
  readonly action: string;
  readonly fields: readonly (readonly [string, string])[];
}

const HEADERS = 'summary, h3.timeline-comment-header-text, .minimized-comment-header, [data-testid="minimized-comment-header"]';
const CONTAINER = '.review-comment, .js-comment-container, [data-testid="comment-container"], .TimelineItem, .js-minimize-container, .js-timeline-item';
const AUTHOR = 'a.TimelineItem-avatar, a.author, a[data-hovercard-type="user"], img[data-hovercard-url^="/users/"], a[data-testid="avatar-link"], a[href^="/apps/"]';
const ANCHOR = '[id^="pullrequestreview-"], [id^="issuecomment-"], [id^="discussion_r"]';
const EVENT_PEOPLE = 'a[data-hovercard-type="user"], a.author, [data-hovercard-url^="/users/"]';

function isOwn(node: Element): boolean {
  return node.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null;
}

const UNHIDE_FORM = 'form[class*="unminimize" i], form[action*="unminimize" i]';

/** GitHub's Unhide form in `root`, as fields to send: an issue comment's `js-comment-unminimize`, a review's `js-timeline-comment-unminimize`. */
export function unhideFormIn(root: ParentNode): UnhideForm | null {
  const form = root.querySelector(UNHIDE_FORM);
  const action = form?.getAttribute('action') ?? '';
  if (form === null || action === '') return null;
  const fields: (readonly [string, string])[] = [];
  for (const input of form.querySelectorAll('input[name]')) fields.push([input.getAttribute('name') ?? '', input.getAttribute('value') ?? '']);
  return { action, fields };
}

/**
 * Where a hidden comment's Unhide lives. GitHub renders the menu of a hidden comment lazily
 * (`comment_actions_menu?…&minimized=1`), and a hidden review's whole content, menu included, behind
 * one more fragment (`/pull/N/reviews/<id>`), and serves the form only to someone who may unhide.
 */
function menuSourceIn(container: Element): MarkedContent['menuSource'] {
  const menu = (container.querySelector('details-menu[src*="minimized" i]') ?? container.querySelector('.minimized-comment details-menu[src]'))?.getAttribute('src');
  if (menu !== null && menu !== undefined && menu !== '') return { kind: 'menu', url: menu };
  const content = container.querySelector('.minimized-comment include-fragment[src]')?.getAttribute('src');
  if (content !== null && content !== undefined && content !== '') return { kind: 'content', url: content };
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
      gid: header.closest('[data-gid]')?.getAttribute('data-gid') ?? container.closest('[data-gid]')?.getAttribute('data-gid') ?? null,
      menuSource: menuSourceIn(container),
    });
  }
  return found;
}

export type HiddenWhy =
  | { readonly by: 'blocked'; readonly scope: BlockScope }
  | { readonly by: 'github'; readonly reason: GitHubHideReason; readonly anchors: readonly string[]; readonly unhide: boolean }
  | { readonly by: 'list'; readonly rule: string };

/** What a hidden person's review said, as GitHub still counts it: the menu shows it in place of their pill. */
export type HiddenVerdict = 'approved' | 'changes_requested' | 'commented';

/** Someone the digest leaves out, for the hidden people menu. */
export interface HiddenPerson {
  readonly login: string;
  readonly bot: boolean;
  readonly avatarSrc: string | null;
  readonly why: HiddenWhy;
  readonly verdict: HiddenVerdict | null;
  /** The reader is peeking: their content is in the digest for this visit. */
  readonly peeking: boolean;
}

interface Entry {
  login: string;
  bot: boolean;
  avatarSrc: string | null;
  why: HiddenWhy;
  verdict: HiddenVerdict | null;
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
    private readonly blocked: ReadonlyMap<string, BlockScope> = new Map(),
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
        verdict: null,
        why: blocked.has(key) ? { by: 'blocked', scope: blocked.get(key) ?? 'personal' } : { by: 'github', reason: first.reason, anchors: contents.flatMap((content) => (content.anchor === null ? [] : [content.anchor])), unhide: contents.some((content) => unhideFormOf(content) !== null) },
      });
    }
  }

  /** Whether `login`'s content stays out of the digest (hidden and not peeked at). */
  hides(login: string, bot: boolean, avatarSrc: string | null = null): boolean {
    if (login === '') return false;
    const key = login.toLowerCase();
    let entry = this.entries.get(key);
    if (entry === undefined) {
      const scope = this.blocked.get(key);
      const rule = scope === undefined ? this.rules.explain(login) : null;
      if (scope === undefined && rule === null) return false;
      entry = { login, bot, avatarSrc, verdict: null, why: scope !== undefined ? { by: 'blocked', scope } : { by: 'list', rule: rule ?? login } };
      this.entries.set(key, entry);
    } else if (entry.avatarSrc === null && avatarSrc !== null) {
      entry.avatarSrc = avatarSrc;
    }
    return !this.peeking.has(key);
  }

  /** Records a hidden person's review verdict; an approval or a request for changes outranks a comment. */
  noteVerdict(login: string, verdict: HiddenVerdict): void {
    const entry = this.entries.get(login.toLowerCase());
    if (entry === undefined || (verdict === 'commented' && entry.verdict !== null)) return;
    entry.verdict = verdict;
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

  /** `login`'s hidden content GitHub lets the reader unhide, with the form for each. */
  unhideTargets(login: string): readonly { readonly content: MarkedContent; readonly form: UnhideForm }[] {
    return (this.marked.get(login.toLowerCase()) ?? []).flatMap((content) => {
      const form = unhideFormOf(content);
      return form === null ? [] : [{ content, form }];
    });
  }

  people(): readonly HiddenPerson[] {
    return [...this.entries.values()]
      .map((entry) => ({ login: entry.login, bot: entry.bot, avatarSrc: entry.avatarSrc, why: entry.why, verdict: entry.verdict, peeking: this.peeking.has(entry.login.toLowerCase()) }))
      .sort((a, b) => a.login.localeCompare(b.login));
  }
}

/** The list lines that hide exactly `login` (no wildcard), which Unhide removes. */
export function exactRulesFor(lines: readonly string[], login: string): readonly string[] {
  const wanted = login.toLowerCase();
  return lines.filter((line) => line.trim().replace(/^@/, '').toLowerCase() === wanted);
}

const forms = new Map<string, UnhideForm | null>();
const looking = new Set<string>();

function keyOf(content: MarkedContent): string {
  return content.gid ?? content.anchor ?? content.menuSource?.url ?? '';
}

/** The Unhide form for `content`: in the page, or read from its menu (`lookUpUnhideForms`); null when GitHub offers none. */
export function unhideFormOf(content: MarkedContent): UnhideForm | null {
  return unhideFormIn(content.root) ?? forms.get(keyOf(content)) ?? null;
}

async function fetchDocument(url: string): Promise<Document | null> {
  const response = await pageFetch(url, { headers: fragmentHeaders(), credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) return null;
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

/** Reads each hidden comment's menu once per page, so Unhide is offered exactly when GitHub would offer it; `onLanded` when one is found. */
export function lookUpUnhideForms(contents: readonly MarkedContent[], onLanded: () => void): void {
  for (const content of contents) {
    const key = keyOf(content);
    const source = content.menuSource;
    if (key === '' || source === null || forms.has(key) || looking.has(key) || unhideFormIn(content.root) !== null) continue;
    looking.add(key);
    void (async () => {
      let menuUrl: string | null = source.kind === 'menu' ? source.url : null;
      if (source.kind === 'content') {
        const doc = await fetchDocument(source.url);
        const inline = doc === null ? null : unhideFormIn(doc);
        if (inline !== null) return inline;
        menuUrl = doc?.querySelector('details-menu[src]')?.getAttribute('src') ?? null;
      }
      if (menuUrl === null) return null;
      const menu = await fetchDocument(menuUrl);
      return menu === null ? null : unhideFormIn(menu);
    })()
      .catch((): UnhideForm | null => null)
      .then((form) => {
        looking.delete(key);
        forms.set(key, form);
        if (form !== null) onLanded();
      });
  }
}

/** Sends GitHub's own Unhide form; true when GitHub took it. */
export async function sendUnhide(form: UnhideForm): Promise<boolean> {
  const body = new URLSearchParams();
  for (const [name, value] of form.fields) body.append(name, value);
  try {
    const response = await pageFetch(form.action, { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' } });
    return response.ok;
  } catch {
    return false;
  }
}

/** Replaces the unhidden comment with GitHub's own partial for it, as its live update would; false when the page has none to read. */
export async function refreshUnhidden(content: MarkedContent): Promise<boolean> {
  const region = content.root.matches('[data-url*="/partials/"]') ? content.root : content.root.querySelector('[data-url*="/partials/"]');
  const url = region?.getAttribute('data-url');
  if (region === null || url === null || url === undefined) return false;
  const response = await pageFetch(url, { headers: fragmentHeaders(), credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
  if (response === null || !response.ok) return false;
  const template = document.createElement('template');
  template.innerHTML = await response.text();
  const fresh = template.content.firstElementChild;
  if (fresh === null) return false;
  forms.delete(keyOf(content));
  region.replaceWith(fresh);
  return true;
}
