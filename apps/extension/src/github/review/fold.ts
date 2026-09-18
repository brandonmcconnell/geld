/**
 * Hide bot comments / low-signal events (and, in minimal mode, human
 * comments on done items) without removing them, so GitHub's Resolve and
 * quick-view teleport still work. Each fold is one accordion row.
 */

import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export const ATTR_FOLDED = 'data-geld-folded';
export const FOLD_CLASS = 'geld-review-fold';

export interface FoldGroup {
  readonly key: string;
  readonly label: string;
  readonly nodes: readonly HTMLElement[];
}

const ATTR_VISIT = 'data-geld-timeline';
const ATTR_FOLD_SIG = 'data-geld-fold-sig';

export function clearFolds(root: ParentNode = document): void {
  for (const node of root.querySelectorAll(`[${ATTR_FOLDED}]`)) node.removeAttribute(ATTR_FOLDED);
  for (const fold of root.querySelectorAll(`.${FOLD_CLASS}`)) fold.remove();
  if (root instanceof Document) root.documentElement.removeAttribute('data-geld-fold-sig');
  else document.documentElement.removeAttribute('data-geld-fold-sig');
}

function insertFold(group: FoldGroup, expanded: boolean): void {
  const first = group.nodes[0];
  if (first === undefined || first.parentElement === null) return;
  const row = createElement('div', { class: FOLD_CLASS, [OWN_UI_ATTRIBUTE]: '', 'data-geld-fold': group.key });
  const button = createElement('button', { type: 'button', class: 'geld-review-fold__btn' }, [
    expanded ? `Hide ${group.label}` : group.label,
  ]);
  button.setAttribute('aria-expanded', String(expanded));
  row.append(button);
  first.parentElement.insertBefore(row, first);
  const apply = (open: boolean): void => {
    button.textContent = open ? `Hide ${group.label}` : group.label;
    button.setAttribute('aria-expanded', String(open));
    for (const node of group.nodes) {
      if (open) node.removeAttribute(ATTR_FOLDED);
      else node.setAttribute(ATTR_FOLDED, 'hidden');
    }
  };
  apply(expanded);
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    apply(open);
  });
}

function foldSignature(groups: readonly FoldGroup[], expandedKeys: ReadonlySet<string>): string {
  return groups
    .map((group) => {
      const ids = group.nodes.map((node) => node.id).join(',');
      return `${group.key}:${group.nodes.length}:${ids}:${expandedKeys.has(group.key) ? '1' : '0'}`;
    })
    .join('|');
}

export function applyFolds(groups: readonly FoldGroup[], expandedKeys: ReadonlySet<string>): void {
  const signature = foldSignature(groups, expandedKeys);
  if (document.documentElement.getAttribute(ATTR_FOLD_SIG) === signature) return;
  clearFolds();
  document.documentElement.setAttribute(ATTR_FOLD_SIG, signature);
  for (const group of groups) {
    if (group.nodes.length === 0) continue;
    insertFold(group, expandedKeys.has(group.key));
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
    const label = `${count} comment${count === 1 ? '' : 's'} from ${run.author}`;
    groups.push({ key: `bot:${run.anchors[0] ?? run.author}`, label, nodes: run.nodes });
    run = null;
  };
  for (const comment of comments) {
    if (!botAnchors.has(comment.anchor)) {
      flush();
      continue;
    }
    if (run !== null && run.author === comment.author) {
      run.nodes.push(comment.root);
      run.anchors.push(comment.anchor);
    } else {
      flush();
      run = { author: comment.author, nodes: [comment.root], anchors: [comment.anchor] };
    }
  }
  flush();
  if (events.length > 0) {
    groups.push({
      key: 'events',
      label: `${events.length} event${events.length === 1 ? '' : 's'}`,
      nodes: events.map((event) => event.root),
    });
  }
  return groups;
}

export function groupDoneHumans(
  comments: readonly { readonly author: string; readonly anchor: string; readonly root: HTMLElement }[],
  doneAnchors: ReadonlySet<string>,
): FoldGroup | null {
  const nodes = comments.filter((comment) => doneAnchors.has(comment.anchor) && !comment.author.endsWith('[bot]')).map((comment) => comment.root);
  if (nodes.length === 0) return null;
  return { key: 'done-human', label: `${nodes.length} comment${nodes.length === 1 ? '' : 's'} on done items`, nodes };
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
  if (body.getAttribute('data-geld-desc') === 'collapsed') return;
  body.setAttribute('data-geld-desc', 'collapsed');
  const toggle = createElement('button', { type: 'button', class: 'geld-review-desc', [OWN_UI_ATTRIBUTE]: '' }, ['Show full']);
  toggle.addEventListener('click', () => {
    const collapsed = body.getAttribute('data-geld-desc') === 'collapsed';
    body.setAttribute('data-geld-desc', collapsed ? 'open' : 'collapsed');
    toggle.textContent = collapsed ? 'Show less' : 'Show full';
  });
  body.insertAdjacentElement('afterend', toggle);
}
