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
const clones = new Set<HTMLElement>();

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
export function teleportInto(slot: HTMLElement, nodes: readonly HTMLElement[]): boolean {
  let live = true;
  for (const node of nodes) {
    if (moved.has(node) || node.parentElement === slot) continue;
    if (isReactManaged(node)) {
      const clone = node.cloneNode(true);
      if (!(clone instanceof HTMLElement)) continue;
      stripIds(clone);
      clone.removeAttribute('data-geld-folded');
      clone.removeAttribute('hidden');
      clone.setAttribute(ATTR_CLONE, '');
      clones.add(clone);
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
  for (const clone of clones) clone.remove();
  clones.clear();
}

export function teleportedNodes(): readonly HTMLElement[] {
  return [...moved.keys()];
}
