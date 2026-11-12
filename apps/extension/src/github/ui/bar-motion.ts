import { OWN_UI_ATTRIBUTE } from '../dom';
import { PERSISTENT_BAR_INNER } from '../persistent-bar';

/**
 * GitHub's bar over the new pull request page gains its tab switcher, a divider and the state label (Geld's pill) when
 * its tabs scroll under it, and loses them when they come back, all in one frame. The left side moves as one block:
 * those parts, the number and the title travel together on one translate, in from the page's edge and back out to it
 * (`animateBarGroup`). On the right, the review group and the counts rise in by the stylesheet's `@starting-style`.
 * What leaves is gone from the bar at once, so a copy of it stays behind until it is out of sight: a ghost, inert and
 * Geld's, that the block carries out (left) or that sinks away by itself (down).
 */
export type GhostDirection = 'down' | 'left';

const ATTR_GHOST = 'data-geld-ghost';
const ATTR_KIND = 'data-geld-ghost-kind';
/** Read once by `animateBarGroup`: a ghost made since then is this change's. */
const ATTR_SEEN = 'data-geld-ghost-seen';
/** Out of the layout for a moment, to read where the title stood without it (the stylesheet hides it). */
const ATTR_HOLD = 'data-geld-bar-hold';
/** Past every exit: a ghost goes then even when nothing removed it (a hidden tab, a style change). */
const GHOST_MS = 600;
/**
 * Attributes Geld's and GitHub's code find live controls by, which a ghost must not answer to: a ghost tab switcher read
 * as the bar still stuck. The counts' stand-in mark stays, for the spacing the stylesheet keys on it; code skips ghosts.
 */
const LIVE_MARKS = ['id', 'data-testid', 'data-geld-status-pill', 'data-geld-focus', 'aria-labelledby', 'aria-describedby', 'aria-controls'];

/** Mirrored in the stylesheet's sticky-header block, so both sides of the bar move on one clock. */
export const BAR_ENTER = { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;
export const BAR_LEAVE = { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } as const;

type PartKind = 'switcher' | 'divider' | 'label';

/** GitHub's parts the bar shows only while it stands for the page header, as children of its inner row or its metadata. */
const PARTS: readonly (readonly [PartKind, string])[] = [
  ['switcher', ':scope > [data-testid="mini-header-tab-switcher-trigger"]'],
  ['divider', ':scope > [class*="navigationDivider"]:not([data-geld-ghost])'],
  ['label', ':scope > [class*="metadata"] > :is([data-component="StateLabel"], button:has(> [data-component="StateLabel"]), button[data-geld-status-pill]):not([data-geld-status-hidden], [data-geld-ghost])'],
];
const BAR_LEFT_PARTS = '[data-testid="mini-header-tab-switcher-trigger"], [class*="navigationDivider"]';
const BAR_STATE_LABEL = '[data-component="StateLabel"], button:has(> [data-component="StateLabel"])';

export function motionAllowed(): boolean {
  // Where the right side cannot slide in (no `@starting-style`), neither side moves.
  if (!('CSSStartingStyleRule' in globalThis)) return false;
  return typeof window.matchMedia !== 'function' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isGhost(element: Element): boolean {
  return element.hasAttribute(ATTR_GHOST);
}

function kindOf(element: Element): PartKind {
  if (element.matches('[data-testid="mini-header-tab-switcher-trigger"]')) return 'switcher';
  return element.matches('[class*="navigationDivider"]') ? 'divider' : 'label';
}

/** A copy in the element's place among its siblings, so every rule spacing it still holds. */
function ghostOf(element: Element, direction: GhostDirection): HTMLElement | null {
  const ghost = element.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) return null;
  for (const node of [ghost, ...ghost.querySelectorAll('*')]) for (const name of LIVE_MARKS) node.removeAttribute(name);
  for (const node of ghost.querySelectorAll('tool-tip, [popover], [role="tooltip"]')) node.remove();
  ghost.setAttribute(ATTR_GHOST, direction);
  if (direction === 'left') ghost.setAttribute(ATTR_KIND, kindOf(element));
  ghost.setAttribute(OWN_UI_ATTRIBUTE, '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.addEventListener('animationend', (event) => {
    if (event.target === ghost) ghost.remove();
  });
  window.setTimeout(() => ghost.remove(), GHOST_MS);
  return ghost;
}

/** Leave a copy of `element` where it stands, before the caller moves or removes it. */
export function leaveGhost(element: HTMLElement, direction: GhostDirection): void {
  if (element.parentElement === null || !element.isConnected || !motionAllowed()) return;
  const ghost = ghostOf(element, direction);
  if (ghost !== null) element.before(ghost);
}

/**
 * Before paint, from the controller's mutation callback: GitHub's tab switcher, its divider and the state label React
 * has just taken out of its bar (the tabs back in view) are put back as ghosts in the places they left, for the block to
 * carry out. A label Geld hides behind its pill is left alone: the pill leaves as a ghost of its own (`syncStatusPills`).
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
      const ghost = ghostOf(node, 'left');
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

let lastParts: Map<PartKind, Element> | null = null;
let running: Animation[] = [];

function partsOf(inner: HTMLElement): Map<PartKind, Element> {
  const parts = new Map<PartKind, Element>();
  for (const [kind, selector] of PARTS) {
    const part = inner.querySelector(selector);
    if (part !== null) parts.set(kind, part);
  }
  return parts;
}

function leftGhosts(inner: HTMLElement): HTMLElement[] {
  return [...inner.querySelectorAll<HTMLElement>(`[${ATTR_GHOST}="left"]`)];
}

/** Everything on the bar's left: its inner row's children before the actions, the metadata with its label among them. */
function blockOf(inner: HTMLElement): HTMLElement[] {
  const block: HTMLElement[] = [];
  for (const child of inner.children) {
    if (child.matches('[class*="actions"]')) break;
    if (child instanceof HTMLElement) block.push(child);
  }
  return block;
}

function hold(elements: readonly Element[], on: boolean): void {
  for (const element of elements) element.toggleAttribute(ATTR_HOLD, on);
}

function cancelRunning(): void {
  for (const animation of running) animation.cancel();
  running = [];
}

/**
 * Before paint, after the parts and Geld's pill are in place: the bar's left side gained or lost parts, so the block
 * slides from where its title stood on screen to where it stands now, the new parts coming in from the page's edge with
 * it, or the ghosts of the old ones carried out to it before they go. One animation for the whole block, measured from
 * the title (three layout reads, only when parts come or go), and taken over from wherever a running one has got to when
 * React adds or drops its parts in a second commit. A part replaced by another of its kind (GitHub re-rendering its bar,
 * GitHub's label giving way to Geld's pill) moves nothing.
 */
export function animateBarGroup(): void {
  const inner = document.querySelector<HTMLElement>(PERSISTENT_BAR_INNER);
  if (inner === null) {
    lastParts = null;
    return;
  }
  const now = partsOf(inner);
  const before = lastParts;
  lastParts = now;
  const fresh = [...inner.querySelectorAll<HTMLElement>(`[${ATTR_GHOST}="left"]:not([${ATTR_SEEN}])`)];
  for (const ghost of fresh) ghost.setAttribute(ATTR_SEEN, '');
  const added = [...now.keys()].filter((kind) => before?.has(kind) !== true);
  const removed = [...(before?.keys() ?? [])].filter((kind) => !now.has(kind));
  for (const ghost of fresh) if (before === null || !removed.some((kind) => ghost.getAttribute(ATTR_KIND) === kind)) ghost.remove();
  if (before === null || (added.length === 0 && removed.length === 0) || !motionAllowed()) return;
  const anchor = inner.querySelector<HTMLElement>(':scope > [class*="metadata"] > [class*="number"]') ?? inner.querySelector<HTMLElement>(':scope > [class*="metadata"] > [class*="title"]');
  if (anchor === null) {
    cancelRunning();
    for (const ghost of leftGhosts(inner)) ghost.remove();
    return;
  }
  const newcomers = added.flatMap((kind) => now.get(kind) ?? []);
  hold(newcomers, true);
  const seen = anchor.getBoundingClientRect().left;
  hold(newcomers, false);
  cancelRunning();
  const ghosts = leftGhosts(inner);
  if (removed.length === 0) {
    for (const ghost of ghosts) ghost.remove();
    slide(blockOf(inner), seen - anchor.getBoundingClientRect().left, 0, BAR_ENTER, null);
    return;
  }
  const withGhosts = anchor.getBoundingClientRect().left;
  hold(ghosts, true);
  const without = anchor.getBoundingClientRect().left;
  hold(ghosts, false);
  slide(blockOf(inner), seen - withGhosts, without - withGhosts, BAR_LEAVE, ghosts);
}

function slide(block: readonly HTMLElement[], from: number, to: number, timing: typeof BAR_ENTER | typeof BAR_LEAVE, ghosts: readonly HTMLElement[] | null): void {
  const done = (): void => {
    // In the frame the block arrives, before paint: the ghosts go as the layout closes up under the same offset.
    for (const ghost of ghosts ?? []) ghost.remove();
    cancelRunning();
  };
  if (Math.abs(from - to) < 0.5 || typeof Element.prototype.animate !== 'function') {
    done();
    return;
  }
  running = block.map((element) => {
    const animation = element.animate([{ translate: `${from}px 0` }, { translate: `${to}px 0` }], { ...timing, fill: 'forwards' });
    // Taken over or cancelled, it rejects `finished`, which nothing waits on.
    animation.finished.catch(() => undefined);
    return animation;
  });
  const first = running[0];
  if (first === undefined) return;
  const mine = running;
  first.addEventListener('finish', () => {
    if (running === mine) done();
  });
}
