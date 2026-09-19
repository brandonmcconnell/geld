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

const GUARDED = new WeakSet<HTMLFormElement>();
/** The form last pressed and when: GitHub replaces it with the rows once they arrive, so while it is still on the page a load is in flight. */
let pressed: { readonly form: HTMLFormElement; readonly at: number } | null = null;
const PRESS_TIMEOUT_MS = 15_000;

/**
 * Press GitHub's "Load more". The classic control is a submit button in an
 * `ajax-pagination` form whose native action is `…/timeline_more_items`:
 * GitHub's own JS intercepts the submit and swaps the form for the fetched
 * rows, but if it is pressed before that JS has attached — Geld runs at
 * document_start — the browser submits for real and the page ends up on a
 * URL that does not exist. So: never before the page is complete, and a
 * submit nobody prevented is stopped here and fetched the same way GitHub
 * would, the form replaced with what comes back.
 */
export function clickLoadMore(root: ParentNode = document): boolean {
  if (document.readyState !== 'complete') return false;
  const button = root.querySelector<HTMLButtonElement>(LOAD_MORE);
  if (button === null || button.disabled) return false;
  const form = button.form;
  // One press per load: the button is not disabled while GitHub fetches, and a page streaming in applies many
  // times a second — pressing on each pass spent the whole budget on one control before its rows had arrived.
  if (form !== null && pressed !== null && pressed.form === form && pressed.form.isConnected && Date.now() - pressed.at < PRESS_TIMEOUT_MS) return false;
  if (form !== null) pressed = { form, at: Date.now() };
  if (form !== null && !GUARDED.has(form)) {
    GUARDED.add(form);
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      void loadMoreOurselves(form);
    });
  }
  button.click();
  return true;
}

async function loadMoreOurselves(form: HTMLFormElement): Promise<void> {
  const url = new URL(form.action, location.href);
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
  if (!response.ok) return;
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const nodes = [...parsed.body.childNodes].map((node) => document.adoptNode(node));
  form.replaceWith(...nodes);
}

export function itemIdForAnchor(metaItems: readonly { readonly id: string; readonly sources: readonly { readonly anchor: string }[] }[], anchor: string): string | null {
  return metaItems.find((item) => item.sources.some((source) => source.anchor === anchor))?.id ?? null;
}
