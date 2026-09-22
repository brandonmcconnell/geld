/**
 * Quick view: the real timeline nodes of a row — a review thread with
 * every comment, its reactions, its per-comment ⋯ menus and the
 * collapsible reply box with Resolve; a bot's comment; an event row —
 * moved into the slot under the row (teleport.ts) and compacted by CSS.
 * GitHub sees its own DOM, so replying, resolving, reacting and editing
 * behave exactly as they do in the timeline (teleport.ts keeps React-owned
 * nodes working too).
 */

import { createElement, svgFromString } from '../dom';
import type { RefDetails, RefState } from './refs';
import { fitPathInto } from './path-fit';
import { ICON_CHEVRON_DOWN, ICON_COMMENT, ICON_COPY, ICON_GIT_COMPARE, ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT, ICON_ISSUE_CLOSED, ICON_ISSUE_OPENED, ICON_LINK, ICON_LINK_EXTERNAL, ICON_REPLY } from '../ui/icons';
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

/** A minimized comment opens here (the row is the reader's choice to look); GitHub's state comes back with the node. */
function openMinimized(list: HTMLElement): void {
  // Only the minimizing <details> itself — a comment's ⋯ menu and reaction picker are <details> too.
  for (const details of list.querySelectorAll<HTMLDetailsElement>('.minimized-comment > details, details.minimized-comment')) {
    if (details.open) continue;
    details.open = true;
    onRestore(() => {
      details.open = false;
    });
  }
}

const THREAD_COMMENT = '.review-comment, .js-comment, [data-testid="review-thread-comment"], [id^="discussion_r"]';
const REPLY_AREA = '.review-thread-reply, .js-inline-comment-form-container, .js-resolvable-timeline-thread-form, [data-testid="thread-reply"], [data-testid="review-thread-reply"], form.js-inline-comment-form';
const ATTR_MORE = 'data-geld-thread-more';
const ATTR_REPLY = 'data-geld-thread-reply';

/**
 * Threads the reader has opened past the bar ("Show N more comments", Reply),
 * by first-comment anchor, for the visit. The panel is rebuilt whenever
 * anything in it changes (check counts tick every few seconds on a busy PR),
 * and a frame rendered afresh came back collapsed: a thread the reader had
 * just opened folded shut under them, again and again.
 */
const openedThreads = new Set<string>();

export function resetOpenedThreads(): void {
  openedThreads.clear();
}

export interface ThreadSource {
  /** The review comment (or bot run summary) the thread came from, on the page. */
  readonly node: HTMLElement;
  /** "Bugbot's review comment". */
  readonly label: string;
}

export interface ThreadsViewHandlers {
  readonly pathOf: (node: HTMLElement) => string;
  readonly onCopy: (text: string) => void;
  /** Reveal the thread and open GitHub's reply box for it. */
  readonly onReply: (node: HTMLElement) => void;
  /** The comment this thread was posted from, when the page has one. */
  readonly sourceOf: (node: HTMLElement) => ThreadSource | null;
  /** Whether that source is unfolded inside the frame. */
  readonly sourceOpen: (node: HTMLElement) => boolean;
  readonly onToggleSource: (node: HTMLElement) => void;
}

/** Focus key of a frame's source toggle, so a rebuild returns focus to it. */
export function sourceFocusKey(node: HTMLElement): string {
  return `source:${threadAnchorOf(node)}`;
}

/** The thread's first comment anchor (its identity across rebuilds). */
export function threadAnchorOf(node: HTMLElement): string {
  return node.querySelector('[id^="discussion_r"], [id^="issuecomment-"]')?.id ?? node.id;
}

/**
 * An item's review threads, each in its own frame: the file path with a copy
 * button, the first comment, and a bar offering the rest of the thread and a
 * reply. Only the outermost comments count as "more" — a thread's comments
 * are siblings, but GitHub repeats ids on wrappers.
 */
export function renderThreadsView(slot: HTMLElement, nodes: readonly HTMLElement[], handlers: ThreadsViewHandlers): void {
  const list = createElement('div', { class: 'geld-review__qv geld-review__qv--threads' });
  slot.replaceChildren(list);
  const pathEls: [HTMLElement, string][] = [];
  for (const node of nodes) {
    const frame = createElement('div', { class: 'geld-review__thread', 'data-geld-thread': 'collapsed' });
    const path = handlers.pathOf(node);
    const source = handlers.sourceOf(node);
    if (path !== '' || source !== null) {
      const actions = createElement('span', { class: 'geld-review__thread-actions' });
      if (source !== null) {
        // Where this thread came from: the bot's review comment, unfolded inside the frame on demand.
        const open = handlers.sourceOpen(node);
        const toggle = createElement('button', { type: 'button', class: 'geld-review__thread-source-btn', 'aria-pressed': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} ${source.label}`, title: `${open ? 'Hide' : 'Show'} ${source.label}`, 'data-geld-focus': sourceFocusKey(node) }, [
          svgFromString(ICON_COMMENT),
          createElement('span', {}, ['Source']),
          svgFromString(ICON_CHEVRON_DOWN),
        ]);
        toggle.addEventListener('click', () => handlers.onToggleSource(node));
        actions.append(toggle);
      }
      const copy = createElement('button', { type: 'button', class: 'geld-review__icon geld-review__thread-copy', 'aria-label': 'Copy path', title: 'Copy path' }, [svgFromString(ICON_COPY)]);
      copy.addEventListener('click', () => handlers.onCopy(path));
      actions.append(copy);
      // GitHub's own file link goes to the diff in Files changed; the path text here stays text.
      const fileHref = node.querySelector<HTMLAnchorElement>('.file-header a[href], review-thread-collapsible a[href*="/files"], a[href*="/files#diff-"], a[href*="/files/"][href*="#diff"]')?.getAttribute('href') ?? null;
      if (fileHref !== null) {
        actions.append(createElement('a', { class: 'geld-review__icon geld-review__thread-open', href: fileHref, 'aria-label': 'Open in Files changed', title: 'Open in Files changed' }, [svgFromString(ICON_LINK_EXTERNAL)]));
      }
      const pathEl = createElement('code', { class: 'geld-review__thread-path' });
      frame.append(createElement('div', { class: 'geld-review__thread-head' }, [pathEl, actions]));
      pathEls.push([pathEl, path]);
    }
    if (source !== null && handlers.sourceOpen(node)) {
      const sourceBody = createElement('div', { class: 'geld-review__thread-source-body geld-review__qv' });
      frame.append(createElement('div', { class: 'geld-review__thread-source' }, [createElement('div', { class: 'geld-review__thread-source-label' }, [source.label]), sourceBody]));
      teleportInto(sourceBody, [source.node]);
    }
    const body = createElement('div', { class: 'geld-review__thread-body' });
    frame.append(body);
    teleportInto(body, [node]);
    // A resolved thread arrives collapsed (GitHub's own header + a hidden body); the frame is the header here.
    for (const hiddenBody of node.querySelectorAll<HTMLElement>('[data-target="review-thread-collapsible.body"][hidden], .js-resolvable-timeline-thread-container > [hidden]')) {
      hiddenBody.removeAttribute('hidden');
      onRestore(() => hiddenBody.setAttribute('hidden', ''));
    }
    // GitHub loads a resolved thread's replies only when its own toggle runs, by giving the placeholder inside
    // the body its URL; revealing the body directly would leave that placeholder spinning forever.
    const deferred = node.getAttribute('data-deferred-content-url') ?? node.querySelector('[data-deferred-content-url]')?.getAttribute('data-deferred-content-url') ?? null;
    if (deferred !== null) {
      for (const fragment of node.querySelectorAll('include-fragment:not([src])')) {
        if (fragment.closest('.dropdown-menu, details-menu, action-menu, [popover]') !== null) continue;
        fragment.setAttribute('src', deferred);
        break;
      }
    }
    const comments = outermostComments(node);
    const more = Math.max(0, comments.length - 1);
    for (const comment of comments.slice(1)) comment.setAttribute(ATTR_MORE, '');
    for (const reply of node.querySelectorAll(REPLY_AREA)) reply.setAttribute(ATTR_REPLY, '');
    onRestore(() => {
      for (const marked of node.querySelectorAll(`[${ATTR_MORE}], [${ATTR_REPLY}]`)) {
        marked.removeAttribute(ATTR_MORE);
        marked.removeAttribute(ATTR_REPLY);
      }
    });
    // The bar stands in for the rest of the thread; once that shows (GitHub's own reply control with it), the bar goes.
    const bar = createElement('div', { class: 'geld-review__thread-bar' });
    const anchor = threadAnchorOf(node);
    const reveal = (): void => {
      openedThreads.add(anchor);
      frame.setAttribute('data-geld-thread', 'open');
      bar.remove();
    };
    if (openedThreads.has(anchor)) {
      frame.setAttribute('data-geld-thread', 'open');
      list.append(frame);
      continue;
    }
    if (more > 0) {
      const show = createElement('button', { type: 'button', class: 'geld-review__thread-more' }, [`Show ${more} more comment${more === 1 ? '' : 's'}`]);
      show.addEventListener('click', reveal);
      bar.append(show);
    }
    const reply = createElement('button', { type: 'button', class: 'geld-review__thread-reply' }, [svgFromString(ICON_REPLY), createElement('span', {}, ['Reply'])]);
    reply.addEventListener('click', () => {
      reveal();
      handlers.onReply(node);
    });
    bar.append(reply);
    frame.append(bar);
    list.append(frame);
  }
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  // Fitted once the frames have their width: file name whole, the start first, "…" for what does not fit.
  for (const [element, path] of pathEls) fitPathInto(element, path);
}

/** Open the frame holding `anchor` (the rest of the thread and GitHub's reply control), as its bar would. */
export function revealThreadFor(anchor: string): void {
  const node = document.getElementById(anchor);
  const frame = node?.closest<HTMLElement>('.geld-review__thread') ?? null;
  if (frame === null) return;
  const threadNode = frame.querySelector<HTMLElement>('.geld-review__thread-body > *');
  openedThreads.add(threadNode === null ? anchor : threadAnchorOf(threadNode));
  frame.setAttribute('data-geld-thread', 'open');
  frame.querySelector('.geld-review__thread-bar')?.remove();
}

function outermostComments(thread: HTMLElement): readonly HTMLElement[] {
  const all = [...thread.querySelectorAll<HTMLElement>(THREAD_COMMENT)].filter((node) => node.closest('form') === null && node.querySelector('.comment-body, .js-comment-body, [data-testid="comment-body"], .markdown-body') !== null);
  return all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
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

/** Issues and PRs the description links to (`a.issue-link`), as mention lines without a mentioner. */
export function outgoingMentions(description: Element | null): readonly MentionLine[] {
  if (description === null) return [];
  const seen = new Set<string>();
  const lines: MentionLine[] = [];
  for (const link of description.querySelectorAll<HTMLAnchorElement>('a.issue-link[href], a[data-hovercard-type="pull_request"][href], a[data-hovercard-type="issue"][href]')) {
    const href = link.getAttribute('href') ?? '';
    const match = /\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(href);
    if (match === null || seen.has(href)) continue;
    seen.add(href);
    const title = (link.getAttribute('title') ?? link.getAttribute('aria-label') ?? link.textContent ?? '').replace(/\s+/g, ' ').trim();
    lines.push({ href, ref: `${match[1]}/${match[2]}#${match[4]}`, title: title === '' || /^#?\d+$/.test(title) ? '' : title, state: 'unknown', avatar: null, time: '' });
  }
  return lines;
}
