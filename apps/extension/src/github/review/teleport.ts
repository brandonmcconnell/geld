/**
 * Quick view: bring a timeline item to the panel instead of scrolling the
 * page to it. The real node is moved (a comment node holds its place so it
 * can go back), which keeps GitHub's own Reply/Resolve/react/edit controls
 * working — they are the same elements.
 *
 * GitHub renders more and more of the page with React, and a React-owned
 * node on loan needs two things React does not do by itself: its original
 * parent must survive React's `insertBefore(x, loanedNode)` / `removeChild`
 * on its next commit, and events inside the loaned node must still reach the
 * React root's listener. Both can only be done in the page's own JavaScript
 * world, so they live in `entrypoints/portal.content.ts`; this module tells
 * it what is on loan through DOM events and marks nodes and placeholders
 * with a shared token.
 */

export const ATTR_TELEPORTED = 'data-geld-teleported';
const PLACEHOLDER_PREFIX = 'geld:quick-view:';
let nextToken = 0;

const REACT_ROOT = 'react-app, react-partial, [data-react-app], [data-reactroot]';

interface Moved {
  readonly node: HTMLElement;
  readonly placeholder: Comment;
  readonly parent: Node;
  /** The React root the node came from, when it did. */
  readonly root: Element | null;
  readonly hadFolded: string | null;
  readonly hadHidden: string | null;
}

const moved = new Map<HTMLElement, Moved>();

export function isTeleported(node: Element): boolean {
  return node.hasAttribute(ATTR_TELEPORTED);
}

/* ---- the page-world half ----------------------------------------------------- */

/**
 * `entrypoints/portal.content.ts` runs in the page's own world and, told by
 * these events, guards a loaned React node's parent and forwards events from
 * the loaned node to its React root. Without it (a browser without MAIN-world
 * scripts) everything still works except React's own controls inside a
 * loaned node.
 */
function tell(parent: Node, type: 'geld:portal-lend' | 'geld:portal-return'): void {
  parent.dispatchEvent(new Event(type, { bubbles: true }));
}

/* ---- moving ---------------------------------------------------------------- */

/** The React root a node belongs to — through the loan when it sits inside a node already on loan. */
function reactRootOf(node: Element): Element | null {
  const direct = node.closest(REACT_ROOT);
  if (direct !== null) return direct;
  const outer = node.parentElement?.closest(`[${ATTR_TELEPORTED}]`) ?? null;
  return outer instanceof HTMLElement ? (moved.get(outer)?.root ?? null) : null;
}

/** Show `nodes` inside `slot`; each keeps its live controls. */
export function teleportInto(slot: HTMLElement, nodes: readonly HTMLElement[]): void {
  for (const node of nodes) {
    if (moved.has(node) || node.parentElement === slot) continue;
    const parent = node.parentNode;
    if (parent === null) continue;
    // The token ties node and placeholder together in the DOM itself, so another Geld instance
    // (a re-injected content script taking over) can still send the node home.
    nextToken += 1;
    const token = String(nextToken);
    const placeholder = document.createComment(PLACEHOLDER_PREFIX + token);
    const root = reactRootOf(node);
    node.replaceWith(placeholder);
    moved.set(node, { node, placeholder, parent, root, hadFolded: node.getAttribute('data-geld-folded'), hadHidden: node.getAttribute('hidden') });
    if (root !== null) tell(parent, 'geld:portal-lend');
    node.removeAttribute('data-geld-folded');
    // A folded row carries hidden="until-found"; away from the timeline it must render.
    node.removeAttribute('hidden');
    node.setAttribute(ATTR_TELEPORTED, token);
    slot.append(node);
  }
}

const restoreHooks: (() => void)[] = [];

/** Run `hook` the next time everything goes home (state a quick view changed on GitHub's nodes). */
export function onRestore(hook: () => void): void {
  restoreHooks.push(hook);
}

/** Put every quick-viewed node back where it came from. */
export function restoreAll(): void {
  for (const hook of restoreHooks.splice(0)) hook();
  for (const entry of moved.values()) {
    // A placeholder that is gone means another party already sent the node home (a newer Geld
    // instance reclaiming it) or React removed it; either way it is not ours to touch any more.
    if (entry.placeholder.parentNode !== null) {
      entry.node.removeAttribute(ATTR_TELEPORTED);
      if (entry.hadFolded !== null) entry.node.setAttribute('data-geld-folded', entry.hadFolded);
      if (entry.hadHidden !== null) entry.node.setAttribute('hidden', entry.hadHidden);
      entry.placeholder.replaceWith(entry.node);
    }
    if (entry.root !== null) tell(entry.parent, 'geld:portal-return');
  }
  moved.clear();
}

/**
 * Send home nodes another instance of Geld left inside `container` (its
 * panel), by the token their placeholders carry. Without this, removing that
 * panel would take GitHub's comments with it.
 */
export function reclaimOrphans(container: Element): void {
  const orphans = [...container.querySelectorAll<HTMLElement>(`[${ATTR_TELEPORTED}]`)].filter((node) => !moved.has(node));
  if (orphans.length === 0) return;
  const placeholders = new Map<string, Comment>();
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  for (let comment = walker.nextNode(); comment !== null; comment = walker.nextNode()) {
    const text = comment.nodeValue ?? '';
    if (text.startsWith(PLACEHOLDER_PREFIX) && comment instanceof Comment) placeholders.set(text.slice(PLACEHOLDER_PREFIX.length), comment);
  }
  // Deepest first, so a worn header goes back into its comment before the comment goes home.
  for (const node of orphans.reverse()) {
    const placeholder = placeholders.get(node.getAttribute(ATTR_TELEPORTED) ?? '');
    node.removeAttribute(ATTR_TELEPORTED);
    if (placeholder !== undefined && placeholder.parentNode !== null) placeholder.replaceWith(node);
  }
}

/**
 * Moved nodes whose home is inside `root` — a comment's header pieces worn by
 * a panel row while the comment itself still stands in the timeline. The
 * crawler reads them as if they had never left.
 */
export function wornPiecesOf(root: Element): readonly HTMLElement[] {
  const pieces: HTMLElement[] = [];
  const homes: Element[] = [root];
  // Transitive: a header worn by a row may itself belong to a comment that is on loan.
  for (const home of homes) {
    for (const entry of moved.values()) {
      if (pieces.includes(entry.node) || entry.placeholder.parentNode === null || !home.contains(entry.placeholder)) continue;
      pieces.push(entry.node);
      homes.push(entry.node);
    }
  }
  return pieces;
}

/**
 * Where `node` belongs in the timeline: itself, or — when it or an ancestor is
 * on loan — the placeholder holding that place (through nested loans). Sorting
 * by this keeps the crawl, the bot groups and the bot chips in timeline order
 * while nodes sit in the panel; document order would put them first.
 */
export function homeOf(node: Node): Node {
  let cursor: Node | null = node;
  while (cursor !== null) {
    if (cursor instanceof HTMLElement) {
      const entry = moved.get(cursor);
      if (entry !== undefined) return homeOf(entry.placeholder);
    }
    cursor = cursor.parentNode;
  }
  return node;
}

/** Comparator for timeline order by home position. */
export function compareHome(a: Node, b: Node): number {
  const x = homeOf(a);
  const y = homeOf(b);
  if (x === y) return 0;
  return (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
}

export function teleportedNodes(): readonly HTMLElement[] {
  return [...moved.keys()];
}
