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
  /** The `is-dirty` mark standing in for the loan at home while the reader interacts with it (see `syncInteractionMarks`). */
  mark: HTMLElement | null;
}

const moved = new Map<HTMLElement, Moved>();

/* ---- interactions GitHub must see --------------------------------------------- */

/**
 * GitHub refreshes a timeline item in place when the pull request changes
 * (`.js-updatable-content`: a socket message makes it fetch the item's
 * partial and `replaceWith` the whole container), unless the reader is in
 * the middle of something there. Its guard (`hasInteractions` in GitHub's
 * `updatable-content`) looks *inside the container* for the focused element,
 * an open `details` under the last mousedown, a dirty form or input, or an
 * `.is-dirty` class, and skips the refresh with "Failed to update content
 * with interactions". A node on loan to the panel takes those interactions
 * with it: the reader opens a comment's ⋯ menu in the chat, GitHub's guard
 * sees an empty home, the next socket message (on a busy pull request, one
 * every few seconds) replaces the container, and the menu the reader just
 * opened is gone with the node it belonged to. So while a loan has the
 * interactions GitHub would respect, a hidden `.is-dirty` mark stands beside
 * its placeholder at home - the one signal the guard reads that can be set
 * from outside the container - and the refresh waits, as it does for GitHub's
 * own markup. The mark goes as soon as the interaction ends, so the item
 * still refreshes when the reader is done.
 */
const MARK_ATTRIBUTE = 'data-geld-interaction';

function dirtyField(node: Element): boolean {
  for (const field of node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (field instanceof HTMLTextAreaElement && field.value !== field.defaultValue) return true;
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio' ? field.checked !== field.defaultChecked : field.type !== 'hidden' && field.value !== field.defaultValue)) return true;
  }
  return false;
}

/** What GitHub's guard would count as the reader being busy inside `node`, were it still at home. */
function hasInteractions(node: HTMLElement): boolean {
  const active = document.activeElement;
  if (active !== null && active !== document.body && node.contains(active)) return true;
  if (node.matches('details[open]') || node.querySelector('details[open]') !== null) return true;
  return dirtyField(node);
}

function syncInteractionMarks(): void {
  for (const entry of moved.values()) {
    const busy = entry.placeholder.parentNode !== null && hasInteractions(entry.node);
    if (busy && entry.mark === null) {
      entry.mark = document.createElement('span');
      entry.mark.className = 'is-dirty';
      entry.mark.hidden = true;
      entry.mark.setAttribute(MARK_ATTRIBUTE, '');
      entry.placeholder.after(entry.mark);
    } else if (!busy && entry.mark !== null) {
      entry.mark.remove();
      entry.mark = null;
    }
  }
}

let marksInstalled = false;

function installInteractionMarks(): void {
  if (marksInstalled) return;
  marksInstalled = true;
  // `toggle` does not bubble; a capturing listener on the document still sees every details open and close.
  for (const type of ['toggle', 'focusin', 'focusout', 'input', 'change']) document.addEventListener(type, syncInteractionMarks, true);
}

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
    moved.set(node, { node, placeholder, parent, root, hadFolded: node.getAttribute('data-geld-folded'), hadHidden: node.getAttribute('hidden'), mark: null });
    if (root !== null) tell(parent, 'geld:portal-lend');
    node.removeAttribute('data-geld-folded');
    // A folded row carries hidden="until-found"; away from the timeline it must render.
    node.removeAttribute('hidden');
    node.setAttribute(ATTR_TELEPORTED, token);
    slot.append(node);
  }
  installInteractionMarks();
  // A menu moved while open (a chat rebuilt under it) is busy from the start.
  syncInteractionMarks();
}

const restoreHooks: (() => void)[] = [];

/** Run `hook` the next time everything goes home (state a quick view changed on GitHub's nodes). */
export function onRestore(hook: () => void): void {
  restoreHooks.push(hook);
}

/** Stop tracking a loaned node React has already discarded (its parent re-rendered without it). */
export function forgetLoan(node: HTMLElement): void {
  const entry = moved.get(node);
  if (entry === undefined) return;
  moved.delete(node);
  entry.mark?.remove();
  entry.placeholder.remove();
  node.remove();
  if (entry.root !== null) tell(entry.parent, 'geld:portal-return');
}

/** Put every quick-viewed node back where it came from. */
/**
 * GitHub replaced a loaned node where it stood, inside the panel: the classic
 * Resolve is a Turbo form whose response swaps the thread for a fresh
 * `<turbo-frame>` with the new state, and it swaps whatever element it holds
 * a reference to, which is the loan. The replacement is the loan from here
 * on: it carries the token (the page-world portal keys on it) and goes home
 * to the placeholder when the panel lets go. Without this the next rebuild
 * sent the stale node home and the reader saw the Resolve button come back
 * on a thread the server had already resolved.
 */
export function adoptReplacement(oldNode: HTMLElement, newNode: HTMLElement): boolean {
  const entry = moved.get(oldNode);
  if (entry === undefined || newNode.hasAttribute(ATTR_TELEPORTED)) return false;
  const token = oldNode.getAttribute(ATTR_TELEPORTED);
  oldNode.removeAttribute(ATTR_TELEPORTED);
  if (token !== null) newNode.setAttribute(ATTR_TELEPORTED, token);
  moved.delete(oldNode);
  moved.set(newNode, { ...entry, node: newNode });
  return true;
}

/**
 * Send every loan home. With `keep`, loans it answers true for stay where
 * they are (a slot carried whole into the next panel), and so do the restore
 * hooks, since a hook cannot be told apart by loan.
 */
export function restoreAll(keep?: (node: HTMLElement) => boolean): void {
  if (keep === undefined) for (const hook of restoreHooks.splice(0)) hook();
  for (const [key, entry] of [...moved]) {
    if (keep?.(entry.node) === true) continue;
    // A placeholder that is gone means another party already sent the node home (a newer Geld
    // instance reclaiming it) or React removed it; either way it is not ours to touch any more.
    entry.mark?.remove();
    if (entry.placeholder.parentNode !== null) {
      entry.node.removeAttribute(ATTR_TELEPORTED);
      if (entry.hadFolded !== null) entry.node.setAttribute('data-geld-folded', entry.hadFolded);
      if (entry.hadHidden !== null) entry.node.setAttribute('hidden', entry.hadHidden);
      entry.placeholder.replaceWith(entry.node);
    }
    if (entry.root !== null) tell(entry.parent, 'geld:portal-return');
    moved.delete(key);
  }
}

/**
 * Send home nodes another instance of Geld left inside `container` (its
 * panel), by the token their placeholders carry. Without this, removing that
 * panel would take GitHub's comments with it.
 */
export function reclaimOrphans(container: Element, except?: Element): void {
  const orphans = [...container.querySelectorAll<HTMLElement>(`[${ATTR_TELEPORTED}]`)].filter((node) => !moved.has(node) && except?.contains(node) !== true);
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

/**
 * `node.closest(selector)` that never leaves the timeline: a loaned ancestor
 * is crossed at its placeholder, so the ancestors tested are the ones at
 * home, never the panel's (the panel sits inside the description's own
 * timeline row, and a plain `closest` from a loaned comment lands there).
 */
export function closestAtHome(node: Element, selector: string): HTMLElement | null {
  let cursor: Node | null = node;
  while (cursor !== null) {
    if (cursor instanceof HTMLElement) {
      if (cursor.matches(selector)) return cursor;
      const entry = moved.get(cursor);
      if (entry !== undefined) {
        cursor = entry.placeholder.parentNode;
        continue;
      }
    }
    cursor = cursor.parentNode;
  }
  return null;
}

/** Comparator for timeline order by home position. */
export function compareHome(a: Node, b: Node): number {
  const x = homeOf(a);
  const y = homeOf(b);
  // Both inside one loaned subtree (a review row on loan with its threads): their order there is their order
  // at home, so compare them where they are. A comparator that answered 0 here let the sort put them either
  // way round, and the last bot comment - the verdict's source - changed with every pass.
  if (x === y) return a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
  return (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
}

export function teleportedNodes(): readonly HTMLElement[] {
  return [...moved.keys()];
}
