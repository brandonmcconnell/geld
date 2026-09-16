import type { ChangeTotals } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import type { StatsBreakdown } from '../breakdown';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export type { StatsBreakdown } from '../breakdown';

type BreakdownProvider = () => StatsBreakdown | null;

const providers = new WeakMap<HTMLElement, BreakdownProvider>();
let tooltip: HTMLElement | null = null;
let activeHost: HTMLElement | null = null;

function ensureTooltip(): HTMLElement {
  if (tooltip !== null && tooltip.isConnected) return tooltip;
  tooltip = createElement('div', {
    class: 'geld-tooltip',
    role: 'tooltip',
    [OWN_UI_ATTRIBUTE]: '',
    hidden: '',
  });
  adoptDarkTheme(tooltip);
  document.body.append(tooltip);
  return tooltip;
}

/**
 * The tooltip is dark whatever the page is, so its `+N` / `−M` must be the
 * colours GitHub uses on dark backgrounds — in the user's own dark theme, so
 * a colourblind palette (blue/orange) carries over. Primer scopes every
 * theme's tokens by attribute selector, and GitHub loads the selected light
 * and dark theme sheets together, so giving the element the dark mode and
 * theme attributes resolves the dark set inside it even on a light page.
 * When the selected dark theme's sheet is not present, the tokens would
 * silently inherit the page's light values instead; then the stylesheet's
 * default dark palette applies.
 */
function adoptDarkTheme(element: HTMLElement): void {
  const html = document.documentElement;
  const dark = html.getAttribute('data-dark-theme') ?? 'dark';
  element.setAttribute('data-color-mode', 'dark');
  element.setAttribute('data-dark-theme', dark);
  if (!scopeResolves(dark, html.getAttribute('data-light-theme') ?? 'light')) element.setAttribute('data-geld-theme-fallback', '');
}

/**
 * Whether Primer's dark scope really yields the dark theme here: a probe in
 * the dark scope and one in the light scope must disagree on a token. When
 * the dark theme's sheet is absent the dark probe just inherits the page's
 * values and matches the light one. Markup-independent — GitHub bundles the
 * base themes and lazy-loads the accessible variants, so a `<link>` check
 * would misjudge the former.
 */
function scopeResolves(dark: string, light: string): boolean {
  const probe = (attributes: Record<string, string>): string => {
    const element = createElement('div', { ...attributes, hidden: '' });
    document.body.append(element);
    const value = getComputedStyle(element).getPropertyValue('--fgColor-success').trim();
    element.remove();
    return value;
  };
  const inDark = probe({ 'data-color-mode': 'dark', 'data-dark-theme': dark });
  const inLight = probe({ 'data-color-mode': 'light', 'data-light-theme': light });
  return inDark !== '' && inDark !== inLight;
}

function row(label: string, totals: ChangeTotals, emphasised: boolean): HTMLElement {
  return createElement('div', { class: `geld-tooltip__row${emphasised ? ' geld-tooltip__row--strong' : ''}` }, [
    createElement('span', { class: 'geld-tooltip__label' }, [label]),
    createElement('span', { class: 'geld-tooltip__files' }, [pluralize(totals.files, 'file', 'files')]),
    createElement('span', { class: 'geld-tooltip__add' }, [`+${formatCount(totals.additions)}`]),
    createElement('span', { class: 'geld-tooltip__del' }, [`\u2212${formatCount(totals.deletions)}`]),
  ]);
}

function render(breakdown: StatsBreakdown): void {
  const element = ensureTooltip();
  const capitalised = `${breakdown.nounPlural[0]?.toUpperCase() ?? ''}${breakdown.nounPlural.slice(1)}`;
  element.replaceChildren(
    createElement('div', { class: 'geld-tooltip__title' }, ['Line counts']),
    row(`Excluding ${breakdown.nounPlural}`, breakdown.visible, true),
    row(`Including ${breakdown.nounPlural}`, breakdown.all, false),
    row(`${capitalised} only`, breakdown.hidden, false),
    ...breakdown.categories.map((entry) => row(` ${entry.category.title}`, entry.totals, false)),
  );
}

/** Distance the tooltip keeps from the edges of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Gap between the host and the tooltip; leaves room for the arrow. */
const HOST_GAP = 6;
/** The arrow is 12px wide and must stay clear of the rounded corners. */
const ARROW_INSET = 12;

/**
 * Place the tooltip next to `host`, inside the viewport. The tooltip is
 * `position: fixed`, so the coordinates are viewport coordinates and the box
 * can never widen the document: the "N tests" host sits at the far right of
 * GitHub's header, and an absolutely positioned box clamped against
 * `window.innerWidth` — which includes the vertical scrollbar — used to poke
 * under that scrollbar and give the page a horizontal one. The viewport is
 * measured on `documentElement`, which excludes scrollbars.
 */
function position(host: HTMLElement): void {
  const element = ensureTooltip();
  const hostRect = host.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  element.hidden = false;
  const tipRect = element.getBoundingClientRect();
  const hostCentre = hostRect.left + hostRect.width / 2;
  const bounds = horizontalBounds(host, tipRect.width, viewportWidth);
  const left = Math.max(bounds.left, Math.min(hostCentre - tipRect.width / 2, bounds.right - tipRect.width));
  let top = hostRect.bottom + HOST_GAP;
  let placement = 'below';
  if (top + tipRect.height > viewportHeight - VIEWPORT_MARGIN) {
    top = hostRect.top - tipRect.height - HOST_GAP;
    placement = 'above';
  }
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.dataset.placement = placement;
  const arrowX = Math.max(ARROW_INSET, Math.min(hostCentre - left, tipRect.width - ARROW_INSET));
  element.style.setProperty('--geld-arrow-x', `${Math.round(arrowX)}px`);
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

function show(host: HTMLElement): void {
  const breakdown = providers.get(host)?.() ?? null;
  if (breakdown === null) return;
  if (activeHost === null) {
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
  }
  activeHost = host;
  render(breakdown);
  position(host);
}

export function hideTooltip(): void {
  if (activeHost !== null) {
    window.removeEventListener('scroll', follow, { capture: true });
    window.removeEventListener('resize', follow);
  }
  activeHost = null;
  if (tooltip !== null) tooltip.hidden = true;
}

/**
 * Show a breakdown tooltip while hovering or focusing `host`. Calling this
 * again for the same host simply swaps the data provider.
 */
export function attachBreakdownTooltip(host: HTMLElement, provider: BreakdownProvider): void {
  const alreadyBound = providers.has(host);
  providers.set(host, provider);
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
