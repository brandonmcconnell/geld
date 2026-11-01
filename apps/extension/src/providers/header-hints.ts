import { element } from './dom';
import type { ProviderHeaderTarget } from './types';

export class ProviderHeaderHints {
  private readonly hints = new Map<HTMLElement, HTMLElement>();

  update(targets: readonly ProviderHeaderTarget[], label: string | null): void {
    const active = new Set<HTMLElement>();
    if (label !== null) for (const target of targets) {
      const host = target.hintHost;
      if (host === undefined || !host.isConnected || host.closest('[data-geld-ui],[hidden],[aria-hidden="true"],[inert]') !== null || active.has(host)) continue;
      active.add(host);
      let hint = this.hints.get(host);
      if (hint === undefined || hint.parentElement !== host) {
        hint?.remove();
        hint = element('span', '', 'geld-provider-header-hidden-count');
        hint.setAttribute('role', 'note');
        this.hints.set(host, hint);
      }
      if (hint.textContent !== label) hint.textContent = label;
      hint.tabIndex = (target.keyboardHoverHosts ?? []).some((owner) => owner.contains(host)) ? -1 : 0;
      const description = /\bhidden$/.test(label) ? label : `${label} hidden`;
      if (hint.getAttribute('aria-label') !== description) hint.setAttribute('aria-label', description);
      const before = target.hintBefore?.parentElement === host ? target.hintBefore : null;
      if (hint.parentElement !== host || hint.nextSibling !== before) host.insertBefore(hint, before);
    }
    for (const [host, hint] of this.hints) if (!active.has(host)) { hint.remove(); this.hints.delete(host); }
  }

  forTarget(target: ProviderHeaderTarget): HTMLElement | null {
    const hint = target.hintHost === undefined ? undefined : this.hints.get(target.hintHost);
    return hint?.isConnected === true ? hint : null;
  }

  needsRepair(): boolean {
    return [...this.hints].some(([host, hint]) => host.isConnected && hint.parentElement !== host);
  }

  clear(): void {
    for (const hint of this.hints.values()) hint.remove();
    this.hints.clear();
  }
}
