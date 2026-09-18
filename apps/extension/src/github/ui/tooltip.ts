import type { ChangeTotals } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import type { StatsBreakdown } from '../breakdown';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export type { StatsBreakdown } from '../breakdown';

type BreakdownProvider = () => StatsBreakdown | null;

interface TooltipBinding {
  readonly anchor: HTMLElement;
  readonly provider: BreakdownProvider;
}

const providers = new WeakMap<HTMLElement, TooltipBinding>();
let tooltip: HTMLElement | null = null;
let activeHost: HTMLElement | null = null;

/** One shared tooltip element; the active host points at it with `aria-describedby`. */
const TOOLTIP_ID = 'geld-line-counts';
const TOOLTIP_ANCHOR_ATTRIBUTE = 'data-geld-tooltip-anchor';

function ensureTooltip(): HTMLElement {
  if (tooltip !== null && tooltip.isConnected) return tooltip;
  tooltip = createElement('div', {
    class: 'geld-tooltip',
    id: TOOLTIP_ID,
    role: 'tooltip',
    [OWN_UI_ATTRIBUTE]: '',
    hidden: '',
  });
  document.body.append(tooltip);
  return tooltip;
}

/**
 * One line of the breakdown. The cells are grid items (the row is
 * `display: contents`); the whitespace between them creates no grid item —
 * any other text would — but keeps a screen reader from running
 * "Excluding test files12 files+42−26" together. "−" is U+2212, read "minus".
 */
function row(label: string, totals: ChangeTotals): HTMLElement {
  // Comment-only lines live inside files that stay visible, so a row of lines
  // alone has no file count of its own to show.
  const files = totals.files === 0 && totals.additions + totals.deletions > 0 ? '' : pluralize(totals.files, 'file', 'files');
  return createElement('div', { class: 'geld-tooltip__row' }, [
    createElement('span', { class: 'geld-tooltip__label' }, [label]),
    ' ',
    createElement('span', { class: 'geld-tooltip__files' }, [files]),
    ' ',
    createElement('span', { class: 'geld-tooltip__add' }, [`+${formatCount(totals.additions)}`]),
    ' ',
    createElement('span', { class: 'geld-tooltip__del' }, [`\u2212${formatCount(totals.deletions)}`]),
    ' ',
  ]);
}

/**
 * The breakdown reads top to bottom as a sum: what is left to review, then
 * each thing Geld set aside, a rule, and the total GitHub prints.
 */
function render(breakdown: StatsBreakdown): void {
  const element = ensureTooltip();
  const hiddenRows = breakdown.categories.map((entry) => row(entry.category.title, entry.totals));
  if (breakdown.lines.additions + breakdown.lines.deletions > 0) {
    hiddenRows.push(row('Comments', { files: 0, additions: breakdown.lines.additions, deletions: breakdown.lines.deletions }));
  }
  if (breakdown.filtered.files > 0) hiddenRows.push(row('Filtered by GitHub', breakdown.filtered));
  // Nothing set aside: still say what would have been ("Tests · 0 files").
  if (hiddenRows.length === 0) hiddenRows.push(row(breakdown.emptyTitle, breakdown.hidden));
  element.replaceChildren(
    row('Essential', breakdown.visible),
    ...hiddenRows,
    createElement('div', { class: 'geld-tooltip__rule', role: 'separator' }),
    row('Total', breakdown.all),
  );
}

/** Distance the tooltip keeps from the edges of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Gap between the host and the tooltip; the bordered caret is 7px tall. */
const HOST_GAP = 8;
/**
 * Place the tooltip next to `host`, inside the viewport. The tooltip is
 * `position: fixed`, so the coordinates are viewport coordinates and the box
 * can never widen the document: the "N tests" host sits at the far right of
 * GitHub's header, and an absolutely positioned box clamped against
 * `window.innerWidth` — which includes the vertical scrollbar — used to poke
 * under that scrollbar and give the page a horizontal one. The viewport is
 * measured on `documentElement`, which excludes scrollbars.
 */
/** A host that left the DOM, or is no longer rendered, has nothing to point a tooltip at. */
function hostGone(host: HTMLElement): boolean {
  return !host.isConnected || host.getClientRects().length === 0;
}

function position(host: HTMLElement): void {
  if (hostGone(host)) {
    hideTooltip();
    return;
  }
  const element = ensureTooltip();
  const boundAnchor = providers.get(host)?.anchor;
  const anchor = boundAnchor?.isConnected === true ? boundAnchor : host;
  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  element.hidden = false;
  const tipRect = element.getBoundingClientRect();
  const anchorCentre = anchorRect.left + anchorRect.width / 2;
  const bounds = horizontalBounds(host, tipRect.width, viewportWidth);
  const left = Math.max(bounds.left, Math.min(anchorCentre - tipRect.width / 2, bounds.right - tipRect.width));
  let top = anchorRect.bottom + HOST_GAP;
  let placement = 'below';
  if (top + tipRect.height > viewportHeight - VIEWPORT_MARGIN) {
    top = anchorRect.top - tipRect.height - HOST_GAP;
    placement = 'above';
  }
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.dataset.placement = placement;
  // The box may slide to stay on screen; the caret still points at the centre
  // of the one underlined count rather than the centre of the whole host.
  element.style.setProperty('--geld-arrow-x', `${Math.round(anchorCentre - left)}px`);
}

/**
 * The horizontal extent the tooltip stays within: the host's content column
 * rather than the viewport, so it never hangs past the edge of the content
 * around it. That column is the widest ancestor that is still inset from the
 * viewport on both sides — GitHub's centred, max-width page container, or the
 * diff column beside the file tree — and wide enough to hold the tooltip;
 * full-bleed wrappers do not qualify. The viewport, with a margin, otherwise.
 */
function horizontalBounds(host: HTMLElement, tipWidth: number, viewportWidth: number): { readonly left: number; readonly right: number } {
  let column: DOMRect | null = null;
  for (let element = host.parentElement; element !== null && element !== document.body; element = element.parentElement) {
    const rect = element.getBoundingClientRect();
    if (rect.width < tipWidth || rect.left < VIEWPORT_MARGIN || rect.right > viewportWidth - VIEWPORT_MARGIN) continue;
    if (column === null || rect.width > column.width) column = rect;
  }
  if (column !== null) return { left: column.left, right: column.right };
  return { left: VIEWPORT_MARGIN, right: Math.max(VIEWPORT_MARGIN + tipWidth, viewportWidth - VIEWPORT_MARGIN) };
}

/** Keep a fixed tooltip glued to its host while the page scrolls or resizes. */
function follow(): void {
  if (activeHost !== null) position(activeHost);
}

/**
 * GitHub's React lists re-render rows wholesale (the merge box's stack list
 * does when the PR's state changes), removing the hovered host from under the
 * open tooltip: `mouseleave` never fires for a removed element and the
 * `position: fixed` box would sit at its last coordinates, or snap to the
 * viewport's corner once `follow` measured an empty rect. While a tooltip is
 * up, the document is watched and the tooltip closes the moment its host is
 * detached or hidden; a replacement host gets its own tooltip on hover.
 */
let hostWatcher: MutationObserver | null = null;
let hostCheck: number | null = null;

function checkHost(): void {
  hostCheck = null;
  if (activeHost !== null && hostGone(activeHost)) hideTooltip();
}

function watchHost(): void {
  hostWatcher ??= new MutationObserver(() => {
    // Coalesce a burst of mutations into one check, after React has finished the commit.
    hostCheck ??= requestAnimationFrame(checkHost);
  });
  hostWatcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
}

function unwatchHost(): void {
  hostWatcher?.disconnect();
  if (hostCheck !== null) cancelAnimationFrame(hostCheck);
  hostCheck = null;
}

/** Escape dismisses the tooltip without moving the pointer or focus (WCAG 1.4.13). */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') hideTooltip();
}

/** A single line in place of the breakdown when the counts cannot be had. */
function renderMessage(message: string): void {
  ensureTooltip().replaceChildren(createElement('div', { class: 'geld-tooltip__message' }, [message]));
}

/**
 * What the breakdown will look like before the diff is in: the rows whose
 * labels are already known, with Primer-style skeleton bars for the numbers.
 * A commit rarely touches more than one hidden category, so the shape is at
 * most Essential + one hidden row + Total, however many categories are on;
 * with nothing filtered it is a single row of counts.
 */
export interface LoadingShape {
  /** Whether any category is active, i.e. whether there is a hidden row and a total at all. */
  readonly hasHidden: boolean;
  /** The hidden row's title when only one category is on; otherwise it is a bar too. */
  readonly hiddenTitle: string | null;
}

function skeleton(cell: string, width: string): HTMLElement {
  return createElement('span', { class: `geld-tooltip__${cell}` }, [createElement('span', { class: `geld-tooltip__skeleton geld-tooltip__skeleton--${width}` })]);
}

function skeletonRow(label: string | null): HTMLElement {
  return createElement('div', { class: 'geld-tooltip__row' }, [
    label === null ? skeleton('label', 'label') : createElement('span', { class: 'geld-tooltip__label' }, [label]),
    ' ',
    skeleton('files', 'files'),
    ' ',
    skeleton('add', 'add'),
    ' ',
    skeleton('del', 'del'),
    ' ',
  ]);
}

function renderLoading(shape: LoadingShape): void {
  const rows = shape.hasHidden
    ? [skeletonRow('Essential'), skeletonRow(shape.hiddenTitle), createElement('div', { class: 'geld-tooltip__rule', role: 'separator' }), skeletonRow('Total')]
    : [skeletonRow('Essential')];
  ensureTooltip().replaceChildren(...rows, createElement('span', { class: 'geld-sr-only' }, ['Counting']));
}

type TooltipContent = StatsBreakdown | { readonly message: string } | { readonly loading: LoadingShape };

function present(host: HTMLElement, content: TooltipContent): void {
  if (activeHost === null) {
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
    document.addEventListener('keydown', onKeyDown, true);
    watchHost();
  }
  if (activeHost !== null && activeHost !== host) describe(activeHost, false);
  activeHost = host;
  if ('loading' in content) renderLoading(content.loading);
  else if ('message' in content) renderMessage(content.message);
  else render(content);
  position(host);
  // A host that vanished between the hover and now closed the tooltip in position().
  if (activeHost === host) describe(host, true);
}

function show(host: HTMLElement): void {
  const breakdown = providers.get(host)?.provider() ?? null;
  if (breakdown === null) return;
  present(host, breakdown);
}

/**
 * Show the tooltip for `host` right now, without binding hover listeners —
 * for hosts whose hovering is decided elsewhere (commit links, which wait for
 * hover intent and for the diff to arrive). `hideTooltip` closes it.
 */
export function showBreakdownTooltip(host: HTMLElement, breakdown: StatsBreakdown): void {
  present(host, breakdown);
}

export function showTooltipMessage(host: HTMLElement, message: string): void {
  present(host, { message });
}

/** Skeleton rows in the breakdown's shape while a commit's diff is on its way. */
export function showTooltipLoading(host: HTMLElement, shape: LoadingShape): void {
  present(host, { loading: shape });
}

/** The element the tooltip is currently shown for, if any. */
export function tooltipHost(): HTMLElement | null {
  return activeHost;
}

export function hideTooltip(): void {
  if (activeHost !== null) {
    window.removeEventListener('scroll', follow, { capture: true });
    window.removeEventListener('resize', follow);
    document.removeEventListener('keydown', onKeyDown, true);
    unwatchHost();
    describe(activeHost, false);
  }
  activeHost = null;
  if (tooltip !== null) tooltip.hidden = true;
}

/**
 * Point the host's `aria-describedby` at the tooltip while it is shown for
 * that host (the element is shared, so its text is only this host's then),
 * keeping any ids GitHub already lists there.
 */
function describe(host: HTMLElement, on: boolean): void {
  const ids = (host.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id !== '' && id !== TOOLTIP_ID);
  if (on) ids.push(TOOLTIP_ID);
  if (ids.length === 0) host.removeAttribute('aria-describedby');
  else host.setAttribute('aria-describedby', ids.join(' '));
}

/**
 * Show a breakdown tooltip while hovering or focusing `host`. Calling this
 * again for the same host simply swaps the data provider.
 */
export function attachBreakdownTooltip(host: HTMLElement, anchor: HTMLElement, provider: BreakdownProvider): void {
  const previous = providers.get(host);
  const alreadyBound = previous !== undefined;
  if (previous?.anchor !== anchor) previous?.anchor.removeAttribute(TOOLTIP_ANCHOR_ATTRIBUTE);
  providers.set(host, { anchor, provider });
  anchor.setAttribute(TOOLTIP_ANCHOR_ATTRIBUTE, '');
  if (alreadyBound) {
    if (activeHost === host) show(host);
    return;
  }
  host.setAttribute('data-geld-stat-host', '');
  if (!host.hasAttribute('tabindex')) {
    host.setAttribute('tabindex', '0');
    host.setAttribute('data-geld-added-tabindex', '');
  }
  host.addEventListener('mouseenter', () => show(host));
  host.addEventListener('mouseleave', hideTooltip);
  host.addEventListener('focus', () => show(host));
  host.addEventListener('blur', hideTooltip);
}

export function detachBreakdownTooltip(host: HTMLElement): void {
  // Listeners stay bound but become inert once the provider is gone.
  providers.get(host)?.anchor.removeAttribute(TOOLTIP_ANCHOR_ATTRIBUTE);
  providers.delete(host);
  host.removeAttribute('data-geld-stat-host');
  if (host.hasAttribute('data-geld-added-tabindex')) {
    host.removeAttribute('tabindex');
    host.removeAttribute('data-geld-added-tabindex');
  }
  if (activeHost === host) hideTooltip();
}

export function removeTooltipElement(): void {
  hideTooltip();
  tooltip?.remove();
  tooltip = null;
}
