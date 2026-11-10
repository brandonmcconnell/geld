import { formatCount, pluralize } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { element } from './dom';
import type { ProviderHeaderTarget } from './types';
import './header-hints.css';

interface HeaderHint {
  root: HTMLElement;
  readonly label: HTMLElement;
  lines: HTMLElement | null;
  additions: HTMLElement | null;
  deletions: HTMLElement | null;
  showAdditions: boolean;
  showDeletions: boolean;
}

function visible(node: HTMLElement | null): boolean {
  if (node === null || !node.isConnected || node.closest('[hidden], [inert]') !== null) return false;
  const view = node.ownerDocument.defaultView;
  if (view === null) return false;
  // Bitbucket's visible numbers intentionally sit inside an aria-hidden presentation wrapper.
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0'
      || style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') return false;
  }
  const box = node.getBoundingClientRect();
  return box.width > 1 && box.height > 1;
}

export class ProviderHeaderHints {
  private readonly hints = new Map<HTMLElement, HeaderHint>();
  private latest: { targets: readonly ProviderHeaderTarget[]; label: string | null; totals: ChangeTotals | undefined } | null = null;
  private view: Window | null = null;
  private sizeObserver: ResizeObserver | null = null;
  private readonly observed = new Set<Element>();
  private readonly resize = (): void => {
    const latest = this.latest;
    if (latest !== null) this.update(latest.targets, latest.label, latest.totals);
  };

  update(targets: readonly ProviderHeaderTarget[], label: string | null, totals?: ChangeTotals): void {
    this.latest = { targets, label, totals };
    const active = new Set<HTMLElement>();
    for (const target of targets) {
      const host = target.hintHost;
      if (host === undefined || !host.isConnected || host.closest('[data-geld-ui],[hidden],[inert]') !== null || active.has(host)) continue;
      const hidden = host.closest('[aria-hidden="true"]');
      if (hidden !== null && (hidden !== target.presentationRoot || hidden.parentElement?.closest('[aria-hidden="true"]') !== null)) continue;
      const showAdditions = totals !== undefined && !visible(target.additions);
      const showDeletions = totals !== undefined && !visible(target.deletions);
      if (label === null && totals === undefined) continue;
      active.add(host);
      let hint = this.hints.get(host);
      if (hint === undefined || hint.root.parentElement !== host) {
        hint?.root.remove();
        const labelNode = element('span', '', 'geld-provider-header-hidden-count');
        labelNode.setAttribute('role', 'note');
        const root = totals === undefined ? labelNode : element('span', '', 'geld-provider-header-stats');
        hint = { root, label: labelNode, lines: null, additions: target.additions, deletions: target.deletions, showAdditions, showDeletions };
        this.hints.set(host, hint);
      }
      hint.additions = target.additions;
      hint.deletions = target.deletions;
      const keyboardOwner = (target.keyboardHoverHosts ?? []).some((owner) => owner.contains(host));
      if (label !== null) {
        if (hint.label.textContent !== label) hint.label.textContent = label;
        const description = /\bhidden$/.test(label) ? label : `${label} hidden`;
        if (hint.label.getAttribute('aria-label') !== description) hint.label.setAttribute('aria-label', description);
      }
      if (totals !== undefined) {
        if (hint.root === hint.label) hint.root = element('span', '', 'geld-provider-header-stats');
        if (hint.lines === null) hint.lines = element('span', '', 'geld-provider-header-line-counts');
        if (!hint.lines.hasAttribute('role')) hint.lines.setAttribute('role', 'note');
        const words: string[] = [];
        const counts: HTMLElement[] = [];
        if (showAdditions) {
          const count = element('span', `+${formatCount(totals.additions)}`, 'geld-provider-header-line-counts__add');
          count.setAttribute('aria-hidden', 'true');
          counts.push(count);
          words.push(`Added ${pluralize(totals.additions, 'line', 'lines')}`);
        }
        if (showDeletions) {
          const count = element('span', `−${formatCount(totals.deletions)}`, 'geld-provider-header-line-counts__del');
          count.setAttribute('aria-hidden', 'true');
          counts.push(count);
          words.push(`Removed ${pluralize(totals.deletions, 'line', 'lines')}`);
        }
        const text = words.join('. ') + '.';
        if (hint.lines.getAttribute('aria-label') !== text) hint.lines.setAttribute('aria-label', text);
        if (hint.lines.textContent !== counts.map(count => count.textContent).join('')) hint.lines.replaceChildren(...counts);
        if (label === null) hint.label.remove();
        else if (hint.label.parentElement !== hint.root) hint.root.append(hint.label);
        if (showAdditions || showDeletions) {
          if (hint.lines.parentElement !== hint.root) hint.root.append(hint.lines);
        } else hint.lines.remove();
        const hidden = label === null && !showAdditions && !showDeletions;
        if (hint.root.hidden !== hidden) hint.root.hidden = hidden;
        hint.label.tabIndex = -1;
      } else if (hint.root !== hint.label) {
        const previous = hint.root;
        hint.root = hint.label;
        previous.remove();
        hint.lines = null;
      }
      hint.showAdditions = showAdditions;
      hint.showDeletions = showDeletions;
      hint.root.tabIndex = keyboardOwner || target.presentationRoot !== undefined ? -1 : 0;
      const before = target.hintBefore?.parentElement === host ? target.hintBefore : null;
      if (hint.root.parentElement !== host || hint.root.nextSibling !== before) host.insertBefore(hint.root, before);
    }
    for (const [host, hint] of this.hints) if (!active.has(host)) { hint.root.remove(); this.hints.delete(host); }
    const view = targets.find(target => target.hintHost?.isConnected)?.hintHost?.ownerDocument.defaultView ?? null;
    if (this.view !== view) {
      this.view?.removeEventListener('resize', this.resize);
      this.view = view;
      this.view?.addEventListener('resize', this.resize, { passive: true });
    }
    if (this.sizeObserver === null && typeof ResizeObserver !== 'undefined') this.sizeObserver = new ResizeObserver(this.resize);
    const observed = new Set<Element>();
    for (const target of targets) for (const node of [target.hintHost, target.additions, target.deletions]) {
      if (node?.isConnected) observed.add(node);
    }
    for (const node of this.observed) if (!observed.has(node)) { this.sizeObserver?.unobserve(node); this.observed.delete(node); }
    for (const node of observed) if (!this.observed.has(node)) { this.sizeObserver?.observe(node); this.observed.add(node); }
  }

  forTarget(target: ProviderHeaderTarget): HTMLElement | null {
    const hint = target.hintHost === undefined ? undefined : this.hints.get(target.hintHost)?.root;
    return hint?.isConnected === true ? hint : null;
  }

  needsRepair(): boolean {
    return [...this.hints].some(([host, hint]) => host.isConnected && hint.root.parentElement !== host);
  }

  clear(): void {
    for (const hint of this.hints.values()) hint.root.remove();
    this.hints.clear();
    this.latest = null;
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.observed.clear();
    this.view?.removeEventListener('resize', this.resize);
    this.view = null;
  }
}
