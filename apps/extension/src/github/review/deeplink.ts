/**
 * `#discussion_r123` (and friends) opens the matching digest item and
 * scrolls the source into view. If GitHub has not loaded that part of the
 * timeline yet, click "Load more" and retry.
 */

const LOAD_MORE = 'button[data-testid="load-more-timeline"], .ajax-pagination-btn, button.js-ajax-pagination-btn';

export function sourceAnchorFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, '');
  return /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+|event-\d+)$/.test(id) ? id : null;
}

export function clickLoadMore(root: ParentNode = document): boolean {
  const button = root.querySelector<HTMLButtonElement>(LOAD_MORE);
  if (button === null || button.disabled) return false;
  button.click();
  return true;
}

export function revealAnchor(anchor: string, attempts = 8): boolean {
  const node = document.getElementById(anchor);
  if (node !== null) {
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.setAttribute('data-geld-flash', '');
    window.setTimeout(() => node.removeAttribute('data-geld-flash'), 1400);
    return true;
  }
  if (attempts <= 0) return false;
  if (!clickLoadMore()) return false;
  window.setTimeout(() => revealAnchor(anchor, attempts - 1), 400);
  return false;
}

export function itemIdForAnchor(metaItems: readonly { readonly id: string; readonly sources: readonly { readonly anchor: string }[] }[], anchor: string): string | null {
  return metaItems.find((item) => item.sources.some((source) => source.anchor === anchor))?.id ?? null;
}
