import type { ChangeTotals } from '../../lib/format';
import { formatCount, pluralize } from '../../lib/format';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export interface StatsBreakdown {
  readonly visible: ChangeTotals;
  readonly hidden: ChangeTotals;
  readonly all: ChangeTotals;
  /** Plural noun for the hidden category, e.g. "test files". */
  readonly nounPlural: string;
}

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
  document.body.append(tooltip);
  return tooltip;
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
  element.replaceChildren(
    createElement('div', { class: 'geld-tooltip__title' }, ['Line counts']),
    row(`Excluding ${breakdown.nounPlural}`, breakdown.visible, true),
    row(`Including ${breakdown.nounPlural}`, breakdown.all, false),
    row(`${breakdown.nounPlural[0]?.toUpperCase() ?? ''}${breakdown.nounPlural.slice(1)} only`, breakdown.hidden, false),
  );
}

function position(host: HTMLElement): void {
  const element = ensureTooltip();
  const hostRect = host.getBoundingClientRect();
  element.hidden = false;
  const tipRect = element.getBoundingClientRect();
  const margin = 8;
  let left = hostRect.left + hostRect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  let top = hostRect.bottom + 6;
  let placement = 'below';
  if (top + tipRect.height > window.innerHeight - margin) {
    top = hostRect.top - tipRect.height - 6;
    placement = 'above';
  }
  element.style.left = `${Math.round(left + window.scrollX)}px`;
  element.style.top = `${Math.round(top + window.scrollY)}px`;
  element.dataset.placement = placement;
  const arrowX = hostRect.left + hostRect.width / 2 - left;
  element.style.setProperty('--geld-arrow-x', `${Math.round(arrowX)}px`);
}

function show(host: HTMLElement): void {
  const breakdown = providers.get(host)?.() ?? null;
  if (breakdown === null) return;
  activeHost = host;
  render(breakdown);
  position(host);
}

export function hideTooltip(): void {
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
