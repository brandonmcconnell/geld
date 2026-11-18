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
/** Names the animation that carries an arriving or leaving part past the viewport's edge, on top of the block's. */
export const PAST_EDGE_ID = 'geld-bar-past-edge';
/**
 * On the bar's metadata (label, number, title) while a part inside it is carried past the edge: GitHub's metadata is
 * `overflow: hidden`, and the label leaves its box on the left, so the box's own sliding edge cut it off. The stylesheet
 * lets it overflow to the left only; the row's own `overflow: hidden` is the edge the parts disappear at.
 */
const ATTR_REACH = 'data-geld-bar-reach';
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
  const carry = direction === 'left' ? carryNow(element) : null;
  if (carry !== null) inheritedCarry.set(ghost, carry);
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

interface Carry {
  /** The part's own animation: the block's slide with the carry folded in, or for a part nested in a block member, the carry alone. */
  readonly animation: Animation;
  readonly from: number;
  readonly to: number;
}
type Carries = Map<Element, { readonly from: number; readonly to: number }>;
/** Each part's carry past the edge while it runs, so a takeover, a replacement or a ghost goes on from where it has got to. */
const carrying = new Map<Element, Carry>();
/** Where the carry of the part a ghost was cloned from had got to: the ghost leaves from there. */
const inheritedCarry = new WeakMap<Element, number>();

function carryNow(element: Element): number | null {
  const carry = carrying.get(element);
  if (carry === undefined) return null;
  if (carry.animation.playState === 'finished') return carry.to;
  // The carry shares its animation's timing, so the animation's eased progress is the carry's too.
  const progress = carry.animation.effect?.getComputedTiming().progress;
  return typeof progress === 'number' ? carry.from + (carry.to - carry.from) * progress : null;
}

let lastParts: Map<PartKind, Element> | null = null;
let running: Animation[] = [];
/** The block the running slide carries. */
let carried: readonly Element[] = [];
/** Block members a nested part is carried out of, which may overflow to the left meanwhile. */
let reaching: readonly Element[] = [];

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
  carried = [];
  carrying.clear();
  for (const holder of reaching) holder.removeAttribute(ATTR_REACH);
  reaching = [];
}

/** Where every running carry has got to, for the slide that takes the running one over; `replaced` maps a new node to the one it replaced. */
function ongoingCarries(replaced: ReadonlyMap<Element, Element>): Carries {
  const ongoing: Carries = new Map();
  for (const [element, carry] of carrying) {
    const now = carryNow(element);
    if (now !== null && element.isConnected) ongoing.set(element, { from: now, to: carry.to });
  }
  for (const [fresh, old] of replaced) {
    const carry = carrying.get(old);
    const now = carryNow(old);
    if (carry !== undefined && now !== null) ongoing.set(fresh, { from: now, to: carry.to });
  }
  return ongoing;
}

/**
 * The block travels only as far as the number's new place, which leaves the parts it carries out just left of where the
 * block rests (and starts the arriving ones there), in the bar's padding, in view. So those parts also travel by how far
 * their right edge must go to clear the row's left edge (GitHub clips the row there), as a group, from where they rest.
 */
function edgeShift(inner: HTMLElement, parts: readonly Element[], offset: number): number {
  const right = Math.max(...parts.map((part) => part.getBoundingClientRect().right));
  return Number.isFinite(right) ? Math.min(0, inner.getBoundingClientRect().left - (right + offset)) : 0;
}

/**
 * Before paint, after the parts and Geld's pill are in place: the bar's left side gained or lost parts, so the block
 * slides from where its title stood on screen to where it stands now, the new parts coming in from the page's edge with
 * it, or the ghosts of the old ones carried out to it before they go. One animation for the whole block, measured from
 * the title (three layout reads, only when parts come or go), and taken over from wherever a running one has got to when
 * React adds or drops its parts in a second commit. A part replaced by another of its kind (GitHub re-rendering its bar,
 * GitHub's label giving way to Geld's pill) moves nothing at rest; mid-slide it is taken along from where the slide has
 * got to, or it would stand at its place while the rest of the block slid on.
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
  if (before === null || !motionAllowed()) return;
  const moved = added.length > 0 || removed.length > 0;
  const replaced = new Map<Element, Element>();
  for (const [kind, part] of now) {
    const old = before.get(kind);
    if (old !== undefined && old !== part) replaced.set(part, old);
  }
  // A label replaced inside the metadata leaves the block's own members as they were, but not its carry.
  const carriedAway = [...replaced.values()].some((old) => carrying.has(old));
  if (!moved && !carriedAway && (running.length === 0 || blockOf(inner).every((element) => carried.includes(element)))) return;
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
  const carries = ongoingCarries(replaced);
  cancelRunning();
  const ghosts = leftGhosts(inner);
  // Taking a running exit over, its ghosts are still on their way out.
  if (removed.length === 0 && (moved || ghosts.length === 0)) {
    for (const ghost of ghosts) ghost.remove();
    const from = seen - anchor.getBoundingClientRect().left;
    const shift = edgeShift(inner, newcomers, from);
    for (const part of newcomers) carries.set(part, { from: shift, to: 0 });
    slide(inner, from, 0, BAR_ENTER, null, carries);
    return;
  }
  const withGhosts = anchor.getBoundingClientRect().left;
  const leaving = ghosts.filter((ghost) => fresh.includes(ghost));
  hold(ghosts, true);
  const without = anchor.getBoundingClientRect().left;
  hold(ghosts, false);
  const to = without - withGhosts;
  const shift = edgeShift(inner, leaving, to);
  for (const ghost of leaving) carries.set(ghost, { from: inheritedCarry.get(ghost) ?? 0, to: shift });
  slide(inner, seen - withGhosts, to, BAR_LEAVE, ghosts, carries);
}

/**
 * One plain animation per element, so the compositor runs them all: an additive one, or two on one element, Chrome
 * runs on the main thread, where GitHub's re-render as the bar sticks stalled the slide for frames at a time.
 */
function slide(inner: HTMLElement, from: number, to: number, timing: typeof BAR_ENTER | typeof BAR_LEAVE, ghosts: readonly HTMLElement[] | null, carries: Carries): void {
  const done = (): void => {
    // In the frame the block arrives, before paint: the ghosts go as the layout closes up under the same offset.
    for (const ghost of ghosts ?? []) ghost.remove();
    cancelRunning();
  };
  const visible = [...carries].filter(([element, carry]) => element.isConnected && (Math.abs(carry.from) >= 0.5 || Math.abs(carry.to) >= 0.5));
  if ((Math.abs(from - to) < 0.5 && visible.length === 0) || typeof Element.prototype.animate !== 'function') {
    done();
    return;
  }
  const block = blockOf(inner);
  const animate = (element: Element, start: number, end: number, carry: { readonly from: number; readonly to: number } | undefined): Animation => {
    const animation = element.animate([{ translate: `${start}px 0` }, { translate: `${end}px 0` }], { ...timing, fill: 'forwards', ...(carry === undefined ? {} : { id: PAST_EDGE_ID }) });
    // Taken over or cancelled, it rejects `finished`, which nothing waits on.
    animation.finished.catch(() => undefined);
    if (carry !== undefined) carrying.set(element, { animation, from: carry.from, to: carry.to });
    return animation;
  };
  const carryOf = (element: Element) => visible.find(([part]) => part === element)?.[1];
  carried = block;
  running = block.map((element) => {
    const carry = carryOf(element);
    return animate(element, from + (carry?.from ?? 0), to + (carry?.to ?? 0), carry);
  });
  const holders: Element[] = [];
  for (const [element, carry] of visible) {
    if (block.some((member) => member === element)) continue;
    const holder = block.find((member) => member.contains(element));
    if (holder === undefined) continue;
    running.push(animate(element, carry.from, carry.to, carry));
    if (!holders.includes(holder)) holders.push(holder);
  }
  for (const holder of holders) holder.setAttribute(ATTR_REACH, '');
  reaching = holders;
  const first = running[0];
  if (first === undefined) return;
  const mine = running;
  first.addEventListener('finish', () => {
    if (running === mine) done();
  });
}
