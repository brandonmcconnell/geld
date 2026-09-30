/**
 * Quick view: the real timeline nodes of a row (GitHub's checks list, the
 * commit rows of a push, an event row) moved into the slot under the row
 * (teleport.ts) and compacted by CSS. GitHub sees its own DOM, so its
 * controls behave exactly as they do in the timeline (teleport.ts keeps
 * React-owned nodes working too). Conversations open as chats (chat.ts).
 */

import { createElement, svgFromString } from '../dom';
import type { RefDetails, RefState } from './refs';
import { ICON_CHECK, ICON_GIT_COMPARE, ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT, ICON_ISSUE_CLOSED, ICON_ISSUE_OPENED, ICON_LINK, ICON_X } from '../ui/icons';
import { openMinimized } from './chat';
import { commitDate } from './commit-dates';
import { compareHome, onRestore, teleportInto } from './teleport';
import { relativeTimeElement } from './time';

/**
 * Fill `slot` with `nodes`. `onChange` runs when something a row shows
 * arrives later (a commit's date), so the caller can render again.
 */
export interface QuickViewContext {
  /** The pull request's head, so a merge of it need not name the commit. */
  readonly headSha?: string;
}

export function renderQuickView(slot: HTMLElement, nodes: readonly HTMLElement[], onChange: () => void = () => undefined, context: QuickViewContext = {}): void {
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  teleportInto(list, nodes);
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  openMinimized(list);
  compactForcePushes(list);
  compactEvents(list, context.headSha ?? null);
  timeCommitRows(list, onChange);
}

const ATTR_EVENT_HIDDEN = 'data-geld-event-hidden';

const COMMIT_ROWS = '.js-commits-list-item, [data-testid="commit-row"], [data-testid="timeline-commit-row"], .TimelineItem:has(> .TimelineItem-badge .octicon-git-commit)';

/** Whether any commit row follows `event` in the timeline (wherever either sits right now). */
function commitsAfter(event: HTMLElement): boolean {
  const timeline = document.querySelector('.js-discussion, [data-testid="issue-timeline-container"], [data-testid="pull-request-timeline"], .pull-discussion-timeline') ?? document;
  for (const commit of timeline.querySelectorAll<HTMLElement>(COMMIT_ROWS)) {
    if (compareHome(event, commit) < 0) return true;
  }
  return false;
}

/** "68 of 69 checks passed", "18 checks passed", "1 check failed": what GitHub writes under a merge. */
function checksOf(text: string): { readonly passed: number; readonly total: number } | null {
  const partial = /(\d+) of (\d+) checks? passed/i.exec(text);
  if (partial?.[1] !== undefined && partial[2] !== undefined) return { passed: Number(partial[1]), total: Number(partial[2]) };
  const all = /(\d+) checks? passed/i.exec(text);
  if (all?.[1] !== undefined) return { passed: Number(all[1]), total: Number(all[1]) };
  return null;
}

/**
 * Timeline events set like the commit rows around them: the actor's picture,
 * what happened in the fewest words, GitHub's own buttons inline after the
 * words (as the Compare button sits on a force-push), and the time in the
 * right-hand column. The sentence is hidden, not removed, and everything is
 * undone when the node goes home.
 *
 * - A merge reads "merged into main", the commit named only when it is not
 *   the pull request's head (then something landed after what was merged),
 *   with the checks as a glyph and counts ("✓ 68 / 69") rather than a
 *   sentence, and "View details" shortened to "Details".
 * - A branch deletion or restore, a close or reopen: the same shape.
 * - Anything else (labels, assignees, review requests) keeps GitHub's words,
 *   centred on the row, its time moved to the column.
 */
function compactEvents(list: HTMLElement, headSha: string | null): void {
  for (const row of list.querySelectorAll<HTMLElement>('.TimelineItem')) {
    const body = row.querySelector<HTMLElement>(':scope > .TimelineItem-body');
    if (body === null || body.querySelector('.geld-review__push, .geld-review__event') !== null || row.querySelector('.js-commits-list-item, code.js-commit-sha, .comment-body') !== null) continue;
    const time = body.querySelector('relative-time[datetime], time-ago[datetime], time[datetime]');
    const when = time?.getAttribute('datetime') ?? null;
    const text = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
    const kind = /\bmerged (?:commit|pull request|this)\b/i.test(text) ? 'merged' : /\bdeleted the\b/i.test(text) ? 'deleted' : /\brestored the\b/i.test(text) ? 'restored' : /\breopened this\b/i.test(text) ? 'reopened' : /\bclosed this\b/i.test(text) ? 'closed' : null;
    const undo: Array<() => void> = [];
    const hide = (element: Element): void => {
      element.setAttribute(ATTR_EVENT_HIDDEN, '');
      undo.push(() => element.removeAttribute(ATTR_EVENT_HIDDEN));
    };
    // The time link goes: the column has it.
    const timeLink = time?.closest('a') ?? time;
    if (timeLink !== null && timeLink !== undefined) hide(timeLink);
    const words = createElement('span', { class: 'geld-review__event-words' });
    const line = createElement('div', { class: 'geld-review__event' });
    if (kind !== null) {
      const avatarLink = body.querySelector<HTMLAnchorElement>('a:has(> img.avatar), a:has(> img.avatar-user), a:has(> img[class*="avatar"])');
      const avatarImg = body.querySelector<HTMLImageElement>('img.avatar, img.avatar-user, img[class*="avatar"]');
      if (avatarLink !== null && avatarImg !== null) {
        // GitHub's hovercard attributes on a copy of the link, so who did it is one hover away; the name itself is not repeated.
        const who = avatarLink.cloneNode(false);
        if (who instanceof HTMLElement) {
          who.className = 'geld-review__event-who';
          who.append(createElement('img', { class: 'geld-review__push-avatar', src: avatarImg.currentSrc || avatarImg.src, alt: avatarImg.alt, width: '20', height: '20' }));
          line.append(who);
        }
      }
      line.append(words);
      const ref = (node: Element | null): HTMLElement | null => (node === null ? null : createElement('code', { class: 'geld-review__event-ref' }, [(node.textContent ?? '').replace(/\s+/g, '').trim()]));
      if (kind === 'merged') {
        const sha = body.querySelector<HTMLAnchorElement>('a[href*="/commit/"]');
        const shaText = (sha?.textContent ?? '').trim();
        // The merge commit is named only when it is not what the pull request ends on: the branch head itself (a
        // rebase or fast-forward), or with nothing pushed after the merge. A squash or merge commit differs from
        // the head by nature, so the timeline decides: a commit row after the merge event means the name matters.
        const isHead = headSha !== null && shaText !== '' && headSha.toLowerCase().startsWith(shaText.toLowerCase());
        words.append('merged ');
        if (sha !== null && !isHead && commitsAfter(row)) words.append(createElement('a', { href: sha.href, class: 'geld-review__event-ref-link' }, [createElement('code', { class: 'geld-review__event-ref' }, [shaText])]), ' ');
        const target = ref(body.querySelector('.base-ref'));
        if (target !== null) words.append('into ', target);
        else words.append('this');
        const checks = checksOf(text);
        if (checks !== null) {
          const passed = checks.passed === checks.total;
          line.append(
            createElement('span', { class: 'geld-review__event-checks', 'data-state': passed ? 'success' : 'failure', role: 'img', 'aria-label': `${checks.passed} of ${checks.total} checks passed` }, [
              svgFromString(passed ? ICON_CHECK : ICON_X),
              createElement('span', {}, [`${checks.passed} / ${checks.total}`]),
            ]),
          );
        }
      } else if (kind === 'deleted' || kind === 'restored') {
        const branch = ref(body.querySelector('.commit-ref, .branch-name, code'));
        words.append(`${kind} the `);
        if (branch !== null) words.append(branch, ' branch');
        else words.append('branch');
      } else {
        words.append(`${kind} this`);
      }
      // GitHub's own controls (View details, Revert, Restore branch) move into the line, after the words, and back home after.
      for (const control of body.querySelectorAll<HTMLElement>(':scope > button, :scope > form, :scope > a.btn, :scope > .btn, :scope > details, :scope > .float-right')) {
        const parent = control.parentNode;
        const next = control.nextSibling;
        undo.push(() => parent?.insertBefore(control, next));
        control.classList.add('geld-review__event-control');
        undo.push(() => control.classList.remove('geld-review__event-control'));
        const shown = control.querySelector('.Details-content--shown');
        if (shown !== null && /^view details$/i.test((shown.textContent ?? '').trim())) {
          const original = shown.textContent;
          shown.textContent = 'Details';
          undo.push(() => {
            shown.textContent = original;
          });
        }
        line.append(control);
      }
      // What the sentence was in: everything of the body but the controls we took and the fragment below the fold.
      for (const child of [...body.children]) {
        if (child === line || child.classList.contains('Details-content--hidden') || child.hasAttribute(ATTR_EVENT_HIDDEN)) continue;
        hide(child);
      }
    }
    if (when !== null) line.append(relativeTimeElement(when, TIME_CLASS));
    if (kind === null && when === null) continue;
    if (kind === null) line.classList.add('geld-review__event--time-only');
    // First in the body: the checks list a merge unfolds ("Details") stays below the line.
    body.prepend(line);
    onRestore(() => {
      line.remove();
      for (const step of undo.reverse()) step();
    });
  }
}

const ATTR_PUSH_HIDDEN = 'data-geld-push-hidden';
const TIME_CLASS = 'geld-review__commit-time';

/**
 * When each commit was made, at the end of its row. GitHub's commit rows say
 * nothing about time while the force-push rows between them do, so the list
 * read as if every commit had landed with the push after it. The dates come
 * from the Commits tab (commit-dates.ts); until they land the row has no
 * time, and `onChange` brings them in on a later pass (the caller runs this
 * on every pass; a row already timed is left alone). Undone when the node
 * goes home.
 */
export function timeCommitRows(list: HTMLElement, onChange: () => void): void {
  for (const row of list.querySelectorAll<HTMLElement>('.TimelineItem, .js-commits-list-item')) {
    if (row.querySelector(`.${TIME_CLASS}`) !== null || row.querySelector('.geld-review__push') !== null) continue;
    const link = row.querySelector<HTMLAnchorElement>('a[href*="/commits/"]');
    const sha = /\/commits\/([0-9a-f]{7,40})(?:[/?#]|$)/i.exec(link?.getAttribute('href') ?? '')?.[1];
    if (link === null || sha === undefined) continue;
    const date = commitDate(sha, onChange);
    if (date === null) continue;
    // The row's one line: GitHub's flex row holding avatar, message, badge and SHA (its wrapper on the React page).
    const line = link.closest<HTMLElement>('.d-flex.flex-md-row, .d-flex.flex-row, [class*="commit-row"], .TimelineItem-body') ?? row;
    const time = relativeTimeElement(date, TIME_CLASS);
    line.append(time);
    onRestore(() => time.remove());
  }
}

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
    // The push's time, as the commit rows around it get theirs (timeCommitRows), from GitHub's own sentence.
    const when = body.querySelector('relative-time[datetime], time-ago[datetime], time[datetime]')?.getAttribute('datetime') ?? null;
    const row = createElement('div', { class: 'geld-review__push' }, [
      ...(avatar === null ? [] : [createElement('img', { class: 'geld-review__push-avatar', src: avatar.currentSrc || avatar.src, alt: avatar.alt, width: '20', height: '20' })]),
      createElement('a', { class: 'geld-review__push-verb Link--secondary', href: verb.href }, ['force-pushed']),
      ...(compare === undefined
        ? []
        : [createElement('a', { class: 'geld-review__push-compare', href: compare.href, 'aria-label': 'Compare the two heads', title: 'Compare' }, [svgFromString(ICON_GIT_COMPARE), createElement('span', {}, ['Compare'])])]),
      createElement('span', { class: 'geld-review__push-shas' }, shas.length === 2 && shas[0] !== undefined && shas[1] !== undefined ? [sha(shas[0]), createElement('span', { class: 'geld-review__push-arrow', 'aria-hidden': 'true' }, ['→']), sha(shas[1])] : shas.map(sha)),
      ...(when === null ? [] : [relativeTimeElement(when, TIME_CLASS)]),
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
