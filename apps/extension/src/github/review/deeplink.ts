/**
 * `#discussion_r123` (and friends) picks the digest item that source
 * belongs to. The browser's own fragment navigation does the scrolling —
 * Geld never scrolls the page. If GitHub has not loaded that part of the
 * timeline yet, its "Load more" control is clicked so the target appears.
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

export function itemIdForAnchor(metaItems: readonly { readonly id: string; readonly sources: readonly { readonly anchor: string }[] }[], anchor: string): string | null {
  return metaItems.find((item) => item.sources.some((source) => source.anchor === anchor))?.id ?? null;
}
