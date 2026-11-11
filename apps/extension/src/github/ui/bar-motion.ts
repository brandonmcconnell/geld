import { createElement, OWN_UI_ATTRIBUTE } from '../dom';
import { PERSISTENT_BAR_INNER } from '../persistent-bar';

/**
 * What enters a sticky header slides in by the stylesheet's `@starting-style`; what leaves it is gone from the bar at
 * once (React removes GitHub's parts, Geld moves its own back to the tab row), so a copy of it stays behind to slide out:
 * a ghost, inert and Geld's, that removes itself when its animation ends.
 */
export type GhostDirection = 'down' | 'left';

const ATTR_GHOST = 'data-geld-ghost';
/** Past the stylesheet's exit animation: the ghost goes then even when no `animationend` came (a hidden tab, a style change). */
const GHOST_MS = 320;
/**
 * Attributes Geld's and GitHub's code find live controls by, which a ghost must not answer to: a ghost tab switcher read
 * as the bar still stuck. The counts' stand-in mark stays, for the spacing the stylesheet keys on it; code skips ghosts.
 */
const LIVE_MARKS = ['id', 'data-testid', 'data-geld-status-pill', 'data-geld-focus', 'aria-labelledby', 'aria-describedby', 'aria-controls'];

/** GitHub's parts the bar shows only while it stands for the page header (its tabs scrolled under it). */
const BAR_LEFT_PARTS = '[data-testid="mini-header-tab-switcher-trigger"], [class*="navigationDivider"]';
const BAR_STATE_LABEL = '[data-component="StateLabel"], button:has(> [data-component="StateLabel"])';

export function motionAllowed(): boolean {
  // Where nothing slides in (no `@starting-style`), nothing slides out either.
  if (!('CSSStartingStyleRule' in globalThis)) return false;
  return typeof window.matchMedia !== 'function' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isGhost(element: Element): boolean {
  return element.hasAttribute(ATTR_GHOST);
}

function inertCopy(element: Element): HTMLElement | null {
  const copy = element.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return null;
  for (const node of [copy, ...copy.querySelectorAll('*')]) for (const name of LIVE_MARKS) node.removeAttribute(name);
  for (const node of copy.querySelectorAll('tool-tip, [popover], [role="tooltip"]')) node.remove();
  return copy;
}

/**
 * A ghost is the copy itself, in its place among its siblings so every rule spacing it still holds, except one with
 * content leaving left: that copy goes whole inside a box of Geld's that narrows to nothing with the copy held at its right
 * edge, so it slides out behind the box's left edge as the parts after it close up, rather than being cut by its own edge.
 * An empty part (the divider) has nothing to cut, and GitHub spaces it as the bar's own child, which a box would undo.
 * The parent's gap goes with a left ghost (`--geld-ghost-gap`), or the title would close up short and snap at the end.
 */
function ghostOf(element: Element, direction: GhostDirection, parent: Element): HTMLElement | null {
  const copy = inertCopy(element);
  if (copy === null) return null;
  const ghost = direction === 'left' && element.childNodes.length > 0 ? createElement('span', {}, [copy]) : copy;
  if (direction === 'left') {
    const gap = Number.parseFloat(getComputedStyle(parent).columnGap);
    if (Number.isFinite(gap) && gap > 0) ghost.style.setProperty('--geld-ghost-gap', `${gap}px`);
  }
  ghost.setAttribute(ATTR_GHOST, direction);
  ghost.setAttribute(OWN_UI_ATTRIBUTE, '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    ghost.remove();
  };
  ghost.addEventListener('animationend', (event) => {
    if (event.target === ghost) remove();
  });
  window.setTimeout(remove, GHOST_MS);
  return ghost;
}

/** Leave a copy of `element` where it stands, sliding out, before the caller moves or removes it. */
export function leaveGhost(element: HTMLElement, direction: GhostDirection): void {
  const parent = element.parentElement;
  if (parent === null || !element.isConnected || !motionAllowed()) return;
  const ghost = ghostOf(element, direction, parent);
  if (ghost !== null) element.before(ghost);
}

/**
 * Before paint, from the controller's mutation callback: GitHub's tab switcher, its divider and the state label React
 * has just taken out of its bar (the tabs back in view) are put back as ghosts in the places they left, sliding out to
 * the left. A label Geld hides behind its pill is left alone: the pill leaves as a ghost of its own (`syncStatusPills`).
 */
export function ghostBarDepartures(records: readonly MutationRecord[]): void {
  if (!motionAllowed()) return;
  // Backwards, undoing the removals in turn: React drops the divider before the switcher, and each record's siblings are
  // as they stood when its node went.
  for (const record of [...records].reverse()) {
    if (record.type !== 'childList' || record.removedNodes.length === 0) continue;
    const parent = record.target;
    if (!(parent instanceof HTMLElement) || !parent.isConnected) continue;
    const inner = parent.matches(PERSISTENT_BAR_INNER);
    if (!inner && !parent.matches(`${PERSISTENT_BAR_INNER} > [class*="metadata"]`)) continue;
    const parts = inner ? BAR_LEFT_PARTS : BAR_STATE_LABEL;
    const ghosts: HTMLElement[] = [];
    for (const node of record.removedNodes) {
      if (!(node instanceof HTMLElement) || !node.matches(parts) || node.hasAttribute('data-geld-status-hidden') || isGhost(node)) continue;
      const ghost = ghostOf(node, 'left', parent);
      if (ghost !== null) ghosts.push(ghost);
    }
    if (ghosts.length === 0) continue;
    const next = record.nextSibling?.parentNode === parent ? record.nextSibling : null;
    const previous = record.previousSibling?.parentNode === parent ? record.previousSibling : null;
    const fragment = document.createDocumentFragment();
    fragment.append(...ghosts);
    parent.insertBefore(fragment, next ?? previous?.nextSibling ?? parent.firstChild);
  }
}
