/**
 * Quick view: bring a timeline item to the panel instead of scrolling the
 * page to it. The real node is moved (a comment node holds its place so it
 * can go back), which keeps GitHub's own Reply/Resolve controls working.
 * Inside a `<react-app>` island moving a node would break React's next
 * reconcile, so those are shown as a read-only deep clone instead.
 */

export const ATTR_TELEPORTED = 'data-geld-teleported';
const ATTR_CLONE = 'data-geld-clone';

interface Moved {
  readonly node: HTMLElement;
  readonly placeholder: Comment;
  readonly hadFolded: string | null;
  readonly hadHidden: string | null;
}

const moved = new Map<HTMLElement, Moved>();
/** Read-only clones of React-owned nodes, with the source they mirror and the markup they were taken from. */
const clones = new Map<HTMLElement, { readonly source: HTMLElement; snapshot: string }>();

export function isReactManaged(node: Element): boolean {
  return node.closest('react-app, react-partial, [data-react-app], [data-reactroot]') !== null;
}

export function isTeleported(node: Element): boolean {
  return node.hasAttribute(ATTR_TELEPORTED);
}

function stripIds(root: Element): void {
  root.removeAttribute('id');
  for (const child of root.querySelectorAll('[id]')) child.removeAttribute('id');
  for (const field of root.querySelectorAll('textarea, input, button')) {
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement || field instanceof HTMLButtonElement) field.disabled = true;
  }
}

/** Show `nodes` inside `slot`. Returns whether every node kept its live controls. */
export interface TeleportOptions {
  /**
   * Move React-owned nodes too instead of cloning them. Safe only for a node whose
   * siblings never change (React patches a moved node in place; it throws when it
   * inserts a sibling relative to one that is no longer in its parent).
   */
  readonly live?: boolean;
}

export function teleportInto(slot: HTMLElement, nodes: readonly HTMLElement[], options: TeleportOptions = {}): boolean {
  let live = true;
  for (const node of nodes) {
    if (moved.has(node) || node.parentElement === slot) continue;
    if (!(options.live ?? false) && isReactManaged(node)) {
      const clone = cloneOf(node);
      clones.set(clone, { source: node, snapshot: node.innerHTML });
      slot.append(clone);
      live = false;
      continue;
    }
    const placeholder = document.createComment('geld:quick-view');
    node.replaceWith(placeholder);
    moved.set(node, { node, placeholder, hadFolded: node.getAttribute('data-geld-folded'), hadHidden: node.getAttribute('hidden') });
    node.removeAttribute('data-geld-folded');
    // A folded row carries hidden="until-found"; away from the timeline it must render.
    node.removeAttribute('hidden');
    node.setAttribute(ATTR_TELEPORTED, '');
    slot.append(node);
  }
  return live;
}

function cloneOf(node: HTMLElement): HTMLElement {
  const clone = node.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error('Expected an element clone');
  stripIds(clone);
  clone.removeAttribute('data-geld-folded');
  clone.removeAttribute('hidden');
  clone.removeAttribute('inert');
  for (const hidden of clone.querySelectorAll('[inert], [style*="visibility: hidden"]')) {
    hidden.removeAttribute('inert');
    if (hidden instanceof HTMLElement) hidden.style.visibility = '';
  }
  clone.setAttribute(ATTR_CLONE, '');
  return clone;
}

/** React re-rendered a cloned source (checks expanded, a status changed): refresh the clone in place. Returns whether anything changed. */
export function syncClones(): boolean {
  let changed = false;
  for (const [clone, entry] of clones) {
    if (!entry.source.isConnected || !clone.isConnected) continue;
    const markup = entry.source.innerHTML;
    if (markup === entry.snapshot) continue;
    const fresh = cloneOf(entry.source);
    clone.replaceWith(fresh);
    clones.delete(clone);
    clones.set(fresh, { source: entry.source, snapshot: markup });
    changed = true;
  }
  return changed;
}

/** Put every quick-viewed node back where it came from and drop clones. */
export function restoreAll(): void {
  for (const entry of moved.values()) {
    entry.node.removeAttribute(ATTR_TELEPORTED);
    if (entry.hadFolded !== null) entry.node.setAttribute('data-geld-folded', entry.hadFolded);
    if (entry.hadHidden !== null) entry.node.setAttribute('hidden', entry.hadHidden);
    if (entry.placeholder.parentNode !== null) entry.placeholder.replaceWith(entry.node);
    else entry.node.remove();
  }
  moved.clear();
  for (const clone of clones.keys()) clone.remove();
  clones.clear();
}

/**
 * Moved nodes whose home is inside `root` — a comment's header pieces worn by
 * a panel row while the comment itself still stands in the timeline. The
 * crawler reads them as if they had never left.
 */
export function wornPiecesOf(root: Element): readonly HTMLElement[] {
  const pieces: HTMLElement[] = [];
  for (const entry of moved.values()) {
    if (entry.placeholder.parentNode !== null && root.contains(entry.placeholder)) pieces.push(entry.node);
  }
  return pieces;
}

export function teleportedNodes(): readonly HTMLElement[] {
  return [...moved.keys()];
}
