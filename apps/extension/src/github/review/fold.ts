/**
 * Hide bot comments / low-signal events (and, in minimal mode, human
 * comments on done items) without removing them. Nothing is inserted into
 * the timeline: the panel at the top lists every fold as one row, and
 * expanding a row brings the real nodes up (see teleport.ts). Hidden nodes
 * keep their ids, so GitHub's Resolve and permalinks keep working.
 */

import { botTitle, resolveBotId } from '@geld/review';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';
import { isTeleported } from './teleport';

export const ATTR_FOLDED = 'data-geld-folded';
const ATTR_VISIT = 'data-geld-timeline';

export interface FoldGroup {
  readonly key: string;
  readonly label: string;
  /** Login the group belongs to (bot runs), for the row's avatar. */
  readonly author: string | null;
  readonly nodes: readonly HTMLElement[];
  /** Folded without a row of its own: a bot's bare "reviewed" line says nothing the bot chips do not. */
  readonly silent?: boolean;
  /** Which panel section lists the row: comments (default) or the activity section. */
  readonly section?: 'activity';
}

export function clearFolds(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>(`[${ATTR_FOLDED}]`)) setFolded(node, false);
}

/**
 * Folded nodes get `hidden="until-found"`: the browser's find-in-page still
 * searches them and fires `beforematch` (handled in overview.ts, which
 * reveals that fold) — a collapsed timeline that Ctrl+F can see through.
 * Where `until-found` is unsupported the attribute degrades to plain hidden.
 */
function setFolded(node: HTMLElement, hidden: boolean): void {
  if (hidden) {
    if (node.getAttribute(ATTR_FOLDED) !== 'hidden') node.setAttribute(ATTR_FOLDED, 'hidden');
    if (node.getAttribute('hidden') !== 'until-found') node.setAttribute('hidden', 'until-found');
  } else if (node.hasAttribute(ATTR_FOLDED)) {
    node.removeAttribute(ATTR_FOLDED);
    if (node.getAttribute('hidden') === 'until-found') node.removeAttribute('hidden');
  }
}

export function isFoldedNode(node: Element): boolean {
  return node.getAttribute(ATTR_FOLDED) === 'hidden';
}

/**
 * Hide every node of every group except those in `revealed` groups or being
 * quick-viewed; un-hide anything that no longer belongs to a group.
 */
export function applyFolds(groups: readonly FoldGroup[], revealed: ReadonlySet<string>): void {
  const keep = new Set<HTMLElement>();
  for (const group of groups) {
    const hidden = !revealed.has(group.key);
    for (const node of group.nodes) {
      // The description's row hosts the panel; folding it would fold the panel. Whatever claims it is wrong.
      if (node.querySelector('[data-geld-review-panel], [data-geld-attached]') !== null) continue;
      keep.add(node);
      setFolded(node, hidden && !isTeleported(node));
    }
  }
  for (const node of document.querySelectorAll<HTMLElement>(`[${ATTR_FOLDED}]`)) {
    if (!keep.has(node)) setFolded(node, false);
  }
}

export function setFullTimeline(on: boolean, root: HTMLElement = document.documentElement): void {
  if (on) root.setAttribute(ATTR_VISIT, 'full');
  else root.removeAttribute(ATTR_VISIT);
}

export function isFullTimeline(root: HTMLElement = document.documentElement): boolean {
  return root.getAttribute(ATTR_VISIT) === 'full';
}

/** Consecutive nodes that share a bot login, plus a leftover events group. */
export function groupBotRuns(
  comments: readonly { readonly author: string; readonly anchor: string; readonly root: HTMLElement }[],
  botAnchors: ReadonlySet<string>,
  events: readonly { readonly anchor: string; readonly root: HTMLElement }[],
): readonly FoldGroup[] {
  const groups: FoldGroup[] = [];
  let run: { author: string; nodes: HTMLElement[]; anchors: string[] } | null = null;
  const flush = (): void => {
    if (run === null || run.nodes.length === 0) return;
    const count = run.nodes.length;
    const name = botTitle(resolveBotId(run.author) ?? `custom:${run.author}`, run.author);
    const label = `${count} ${name} comment${count === 1 ? '' : 's'}`;
    groups.push({ key: `bot:${run.anchors[0] ?? run.author}`, label, author: run.author, nodes: run.nodes });
    run = null;
  };
  const seen = new Set<HTMLElement>();
  for (const comment of comments) {
    if (!botAnchors.has(comment.anchor)) {
      flush();
      continue;
    }
    if (seen.has(comment.root)) continue;
    seen.add(comment.root);
    if (run !== null && run.author === comment.author) {
      run.nodes.push(comment.root);
      run.anchors.push(comment.anchor);
    } else {
      flush();
      run = { author: comment.author, nodes: [comment.root], anchors: [comment.anchor] };
    }
  }
  flush();
  const eventNodes = events.map((event) => event.root).filter((node) => !seen.has(node));
  if (eventNodes.length > 0) {
    groups.push({
      key: 'events',
      label: `${eventNodes.length} timeline event${eventNodes.length === 1 ? '' : 's'}`,
      author: null,
      nodes: eventNodes,
      section: 'activity',
    });
  }
  return groups;
}

/** The rest of the timeline, by kind: commits and mentions get rows in the activity section; bots' bare review lines fold silently. */
export function groupLeftovers(leftovers: ReadonlyArray<{ readonly kind: 'commit' | 'mention' | 'review-event' | 'noise' | 'pending' | 'other'; readonly root: HTMLElement }>): readonly FoldGroup[] {
  const by = (kind: (typeof leftovers)[number]['kind']): HTMLElement[] => leftovers.filter((entry) => entry.kind === kind).map((entry) => entry.root);
  const groups: FoldGroup[] = [];
  const commits = by('commit');
  if (commits.length > 0) groups.push({ key: 'commits', label: `${commits.length} commit${commits.length === 1 ? '' : 's'}`, author: null, nodes: commits, section: 'activity' });
  const mentions = by('mention');
  if (mentions.length > 0) groups.push({ key: 'mentions', label: `${mentions.length} mention${mentions.length === 1 ? '' : 's'}`, author: null, nodes: mentions, section: 'activity' });
  const silent = by('review-event');
  if (silent.length > 0) groups.push({ key: 'bot-reviews', label: '', author: null, nodes: silent, silent: true });
  // "X added 2 commits" headers say nothing the commits row does not; a minimized comment still fetching its
  // content is not yet anything — listing it would only have it change kind (and the counts) a moment later.
  const noise = [...by('noise'), ...by('pending')];
  if (noise.length > 0) groups.push({ key: 'noise', label: '', author: null, nodes: noise, silent: true });
  const other = by('other');
  if (other.length > 0) groups.push({ key: 'misc', label: `${other.length} other timeline item${other.length === 1 ? '' : 's'}`, author: null, nodes: other, section: 'activity' });
  return groups;
}

/**
 * Comments that only ask a bot to run ("@greptileai", "bugbot run", or several of those): folded without a row.
 * They carry nothing a reader needs — the bots' answers are in their rounds, and the re-run control posts new ones.
 */
export function groupTriggers(
  comments: readonly { readonly anchor: string; readonly root: HTMLElement }[],
  triggerAnchors: ReadonlySet<string>,
): FoldGroup | null {
  const nodes = [...new Set(comments.filter((comment) => triggerAnchors.has(comment.anchor)).map((comment) => comment.root))];
  if (nodes.length === 0) return null;
  return { key: 'triggers', label: '', author: null, nodes, silent: true };
}

export function groupDoneHumans(
  comments: readonly { readonly author: string; readonly anchor: string; readonly root: HTMLElement }[],
  doneAnchors: ReadonlySet<string>,
): FoldGroup | null {
  const nodes = [...new Set(comments.filter((comment) => doneAnchors.has(comment.anchor) && !comment.author.endsWith('[bot]')).map((comment) => comment.root))];
  if (nodes.length === 0) return null;
  return { key: 'done-human', label: `${nodes.length} comment${nodes.length === 1 ? '' : 's'} on done items`, author: null, nodes };
}

export function collapseDescription(on: boolean): void {
  const body =
    document.querySelector('.js-comment-container .js-comment-body') ??
    document.querySelector('[data-testid="issue-body"] .markdown-body') ??
    document.querySelector('.timeline-comment .comment-body');
  if (!(body instanceof HTMLElement)) return;
  if (!on) {
    body.removeAttribute('data-geld-desc');
    body.parentElement?.querySelector('.geld-review-desc')?.remove();
    return;
  }
  if (body.hasAttribute('data-geld-desc')) return;
  body.setAttribute('data-geld-desc', 'collapsed');
  const toggle = createElement('button', { type: 'button', class: 'geld-review-desc', [OWN_UI_ATTRIBUTE]: '' }, ['Show full description']);
  toggle.addEventListener('click', () => {
    const collapsed = body.getAttribute('data-geld-desc') === 'collapsed';
    body.setAttribute('data-geld-desc', collapsed ? 'open' : 'collapsed');
    toggle.textContent = collapsed ? 'Show less' : 'Show full description';
  });
  body.insertAdjacentElement('afterend', toggle);
}
