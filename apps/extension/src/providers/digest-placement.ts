export function placeProviderDigest(host: HTMLElement, panel: HTMLElement, description: HTMLElement | null, above: boolean): void {
  const afterDescription = !above && description !== null && host.contains(description);
  const before = afterDescription ? null : host.firstChild;
  if (before === panel || afterDescription && host.lastChild === panel) return;
  const active = panel.ownerDocument.activeElement;
  const focused = active instanceof HTMLElement && panel.contains(active) ? active : null;
  host.insertBefore(panel, before);
  focused?.focus({ preventScroll: true });
}
