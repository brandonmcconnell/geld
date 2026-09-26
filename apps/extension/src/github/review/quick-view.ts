/**
 * Quick view: the real timeline nodes of a row (GitHub's checks list, the
 * commit rows of a push, an event row) moved into the slot under the row
 * (teleport.ts) and compacted by CSS. GitHub sees its own DOM, so its
 * controls behave exactly as they do in the timeline (teleport.ts keeps
 * React-owned nodes working too). Conversations open as chats (chat.ts).
 */

import { createElement, svgFromString } from '../dom';
import type { RefDetails, RefState } from './refs';
import { ICON_GIT_COMPARE, ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT, ICON_ISSUE_CLOSED, ICON_ISSUE_OPENED, ICON_LINK } from '../ui/icons';
import { openMinimized } from './chat';
import { onRestore, teleportInto } from './teleport';

/** Fill `slot` with `nodes`. */
export function renderQuickView(slot: HTMLElement, nodes: readonly HTMLElement[]): void {
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  teleportInto(list, nodes);
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  openMinimized(list);
  compactForcePushes(list);
}

const ATTR_PUSH_HIDDEN = 'data-geld-push-hidden';

/**
 * A force-push event, set like the commit rows around it. GitHub's sentence —
 * "brandonmcconnell force-pushed the brandon/feature branch from b1a5c29 to
 * 4010a15 · Compare · 2 days ago" — repeats what every row here shares (the
 * actor's name beside their avatar, the branch, the time) around the three
 * links that matter. Those links are lifted into one line: the avatar,
 * "force-pushed" (GitHub's link), a Compare button, and on the right the two
 * SHAs, the later one standing where the commit rows put theirs. The sentence
 * is hidden, not removed, and everything is undone when the node goes home.
 */
function compactForcePushes(list: HTMLElement): void {
  for (const body of list.querySelectorAll<HTMLElement>('.TimelineItem-body')) {
    if (body.querySelector('.geld-review__push') !== null) continue;
    const links = [...body.querySelectorAll<HTMLAnchorElement>('a')];
    const verb = links.find((link) => /^force-pushed$/i.test(link.textContent?.trim() ?? ''));
    if (verb === undefined) continue;
    const shas = links.filter((link) => link.querySelector('code') !== null && /^[0-9a-f]{7,}$/i.test(link.textContent?.trim() ?? ''));
    const compare = links.find((link) => /^compare$/i.test(link.textContent?.trim() ?? ''));
    const avatar = body.querySelector<HTMLImageElement>('img.avatar, img[class*="avatar"]');
    const line = body.querySelector<HTMLElement>('.d-flex') ?? body;
    const hidden = [...line.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    for (const child of hidden) child.setAttribute(ATTR_PUSH_HIDDEN, '');
    const sha = (link: HTMLAnchorElement): HTMLElement => createElement('code', { class: 'geld-review__push-sha' }, [createElement('a', { href: link.href, class: 'Link--secondary' }, [link.textContent?.trim() ?? ''])]);
    const row = createElement('div', { class: 'geld-review__push' }, [
      ...(avatar === null ? [] : [createElement('img', { class: 'geld-review__push-avatar', src: avatar.currentSrc || avatar.src, alt: avatar.alt, width: '20', height: '20' })]),
      createElement('a', { class: 'geld-review__push-verb Link--secondary', href: verb.href }, ['force-pushed']),
      ...(compare === undefined
        ? []
        : [createElement('a', { class: 'geld-review__push-compare', href: compare.href, 'aria-label': 'Compare the two heads', title: 'Compare' }, [svgFromString(ICON_GIT_COMPARE), createElement('span', {}, ['Compare'])])]),
      createElement('span', { class: 'geld-review__push-shas' }, shas.length === 2 && shas[0] !== undefined && shas[1] !== undefined ? [sha(shas[0]), createElement('span', { class: 'geld-review__push-arrow', 'aria-hidden': 'true' }, ['→']), sha(shas[1])] : shas.map(sha)),
    ]);
    line.append(row);
    onRestore(() => {
      row.remove();
      for (const child of hidden) child.removeAttribute(ATTR_PUSH_HIDDEN);
    });
  }
}

function refStateOf(href: string, badgeText: string): RefState {
  const text = badgeText.toLowerCase();
  const pull = href.includes('/pull/');
  if (/merged/.test(text)) return 'merged';
  if (/draft/.test(text)) return 'draft';
  if (/closed|not planned|done|completed/.test(text)) return pull ? 'closed' : 'issue-closed';
  if (/open/.test(text)) return pull ? 'open' : 'issue-open';
  return 'unknown';
}

const REF_ICON: Readonly<Record<RefState, string>> = {
  open: ICON_GIT_PULL_REQUEST,
  closed: ICON_GIT_PULL_REQUEST_CLOSED,
  merged: ICON_GIT_MERGE,
  draft: ICON_GIT_PULL_REQUEST_DRAFT,
  'issue-open': ICON_ISSUE_OPENED,
  'issue-closed': ICON_ISSUE_CLOSED,
  unknown: ICON_LINK,
};

export interface MentionLine {
  readonly href: string;
  readonly ref: string;
  readonly title: string;
  readonly state: RefState;
  /** The mentioner's avatar link (GitHub's, cloned: its hovercard attributes work anywhere). */
  readonly avatar: HTMLElement | null;
  readonly time: string;
}

/** One line per reference in a cross-reference row ("This was referenced" rows hold several). */
export function mentionLinesOf(node: HTMLElement): readonly MentionLine[] {
  const refs = [...node.querySelectorAll<HTMLElement>('[id^="ref-pullrequest-"], [id^="ref-issue-"]')];
  const blocks = refs.length > 0 ? refs : [node];
  const time = node.querySelector('relative-time, time-ago, time');
  const when = time?.shadowRoot?.textContent?.trim() || (time?.textContent ?? '').trim();
  const avatarLink = node.querySelector<HTMLElement>('a[data-hovercard-type="user"]:has(img), a.author:has(img), a:has(> img.avatar)');
  const avatarImg = node.querySelector<HTMLImageElement>('img.avatar, img[data-testid="github-avatar"], img[class*="avatar" i]');
  const lines: MentionLine[] = [];
  for (const block of blocks) {
    const links = [...block.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"], a[href*="/issues/"], a[data-hovercard-type="pull_request"], a[data-hovercard-type="issue"]')].filter((link) => (link.textContent ?? '').trim() !== '' && !/^#\d+$/.test((link.textContent ?? '').trim()));
    const link = links.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0];
    if (link === undefined) continue;
    const href = link.getAttribute('href') ?? '';
    const match = /\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(href);
    const state = block.querySelector('.State, [data-testid="issue-state"], [class*="StateLabel"], [class*="State-"]');
    let avatar: HTMLElement | null = null;
    if (avatarLink !== null) {
      const cloned = avatarLink.cloneNode(false);
      if (cloned instanceof HTMLElement && avatarImg !== null) {
        cloned.className = 'geld-review__mention-who';
        cloned.append(createElement('img', { class: 'geld-review__avatar', 'data-kind': 'user', src: avatarImg.currentSrc || avatarImg.getAttribute('src') || '', alt: avatarImg.alt, width: '20', height: '20' }));
        avatar = cloned;
      }
    }
    lines.push({
      href,
      ref: match === null ? '' : `${match[1]}/${match[2]}#${match[3]}`,
      title: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
      state: refStateOf(href, state?.textContent ?? ''),
      avatar,
      time: when,
    });
  }
  return lines;
}

const STATE_LABEL: Readonly<Record<RefState, string>> = {
  open: 'Open pull request',
  closed: 'Closed pull request',
  merged: 'Merged pull request',
  draft: 'Draft pull request',
  'issue-open': 'Open issue',
  'issue-closed': 'Closed issue',
  unknown: 'Issue or pull request',
};

/** The line as the page gave it, completed from GitHub's hovercard when that has landed: its real title, its state. */
function completeLine(line: MentionLine, lookup: RefLookup): MentionLine {
  const found = lookup(line.href);
  if (found === null) return line;
  return { ...line, title: found.title, state: line.state === 'unknown' || found.state !== 'unknown' ? found.state : line.state };
}

/** On the commits list's grid: state glyph, avatar (or its space), `owner/repo#N` and the title as one link, time. */
function mentionRow(line: MentionLine): HTMLElement {
  const isPull = line.state === 'unknown' ? line.href.includes('/pull/') : !line.state.startsWith('issue');
  const anchor = createElement('a', { class: 'geld-review__mention-link', href: line.href, 'data-hovercard-type': isPull ? 'pull_request' : 'issue', 'data-hovercard-url': `${line.href.replace(/[#?].*$/, '')}/hovercard` }, [
    ...(line.ref === '' ? [] : [createElement('span', { class: 'geld-review__mention-ref' }, [line.ref])]),
    createElement('span', { class: 'geld-review__mention-title' }, [line.title]),
  ]);
  const row = createElement('li', { class: 'geld-review__mention', 'data-state': line.state }, [
    createElement('span', { class: 'geld-review__mention-state', role: 'img', 'aria-label': STATE_LABEL[line.state], title: STATE_LABEL[line.state] }, [svgFromString(REF_ICON[line.state])]),
    line.avatar ?? createElement('span', { class: 'geld-review__mention-who', 'aria-hidden': 'true' }),
    anchor,
  ]);
  if (line.time !== '') row.append(createElement('span', { class: 'geld-review__time' }, [line.time]));
  return row;
}

export type RefLookup = (href: string) => RefDetails | null;

/**
 * Cross-references as lines — who, the state icon, `owner/repo#N` and the
 * title (the only part that truncates) as one link with GitHub's hovercard,
 * then when — under two headings: what mentions this PR, and what this PR's
 * description mentions. Rendered from the rows rather than moving them: a
 * mention row is all chrome.
 */
export function renderMentionsView(slot: HTMLElement, nodes: readonly HTMLElement[], outgoing: readonly MentionLine[] = [], lookup: RefLookup = () => null): void {
  const incoming = nodes.flatMap((node) => mentionLinesOf(node));
  const wrap = createElement('div', { class: 'geld-review__mentions-wrap' });
  const section = (label: string, lines: readonly MentionLine[]): void => {
    if (lines.length === 0) return;
    wrap.append(createElement('div', { class: 'geld-review__subhead geld-review__subhead--flush' }, [label]));
    const list = createElement('ul', { class: 'geld-review__mentions', role: 'list' });
    for (const line of lines) list.append(mentionRow(completeLine(line, lookup)));
    wrap.append(list);
  };
  section('Where this PR is mentioned', incoming);
  section('What this PR mentions', outgoing);
  slot.replaceChildren(wrap);
  if (wrap.childElementCount === 0) slot.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
}

/** Who wrote the description, for the lines of what it mentions. */
export interface MentionAuthor {
  readonly login: string;
  readonly avatarSrc: string;
}

/**
 * Issues and PRs the description links to (`a.issue-link`), as mention
 * lines. The mentioner is the description's author, whose picture GitHub
 * puts nowhere near those links, so the line is given it here with
 * GitHub's hovercard, like the pictures on the lines that mention this PR.
 */
export function outgoingMentions(description: Element | null, author: MentionAuthor | null = null): readonly MentionLine[] {
  if (description === null) return [];
  const seen = new Set<string>();
  const lines: MentionLine[] = [];
  const who = (): HTMLElement | null =>
    author === null
      ? null
      : createElement('a', { class: 'geld-review__mention-who', href: `/${author.login}`, 'data-hovercard-type': 'user', 'data-hovercard-url': `/users/${encodeURIComponent(author.login)}/hovercard` }, [
          createElement('img', { class: 'geld-review__avatar', 'data-kind': 'user', src: author.avatarSrc, alt: `@${author.login}`, width: '20', height: '20' }),
        ]);
  for (const link of description.querySelectorAll<HTMLAnchorElement>('a.issue-link[href], a[data-hovercard-type="pull_request"][href], a[data-hovercard-type="issue"][href]')) {
    const href = link.getAttribute('href') ?? '';
    const match = /\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(href);
    if (match === null || seen.has(href)) continue;
    seen.add(href);
    const title = (link.getAttribute('title') ?? link.getAttribute('aria-label') ?? link.textContent ?? '').replace(/\s+/g, ' ').trim();
    lines.push({ href, ref: `${match[1]}/${match[2]}#${match[4]}`, title: title === '' || /^#?\d+$/.test(title) ? '' : title, state: 'unknown', avatar: who(), time: '' });
  }
  return lines;
}
