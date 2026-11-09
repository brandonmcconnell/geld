/**
 * `#discussion_r123` (and friends) picks the digest item that source
 * belongs to. The browser's own fragment navigation does the scrolling —
 * Geld never scrolls the page. If GitHub has not loaded that part of the
 * timeline yet, its "Load more" control is clicked so the target appears.
 */

import { COUNT_PATTERN, parseCount } from '@geld/core';
import { quietClick } from './quiet-click';

const HIDDEN_ITEMS_TEXT = new RegExp(String.raw`(${COUNT_PATTERN})\s+(?:hidden|remaining)\s+items?\b`, 'i');
const LOAD_MORE = 'button[data-testid="load-more-timeline"], .ajax-pagination-btn, button.js-ajax-pagination-btn';

/**
 * The Overview's own control for the older entries (Nov 2026): a Primer button "Load previous comments" in the Comments
 * section with the count it hides in a counter label ("237"), `data-loading` while a page of about 25 entries comes, and
 * no form. Marked once found (`ATTR_LOAD_PREVIOUS`), so the stylesheet can hide it while Geld presses it.
 */
export const ATTR_LOAD_PREVIOUS = 'data-geld-load-previous';
const LOAD_PREVIOUS_LABEL = /^\s*Load (?:previous|older|more) comments\b/i;

function overviewLoadPrevious(root: ParentNode): HTMLButtonElement | null {
  const section = root.querySelector('h2#overview-comments')?.closest('section') ?? null;
  if (section === null) return null;
  for (const button of section.querySelectorAll<HTMLButtonElement>('button')) {
    if (!LOAD_PREVIOUS_LABEL.test(button.querySelector('[data-component="text"]')?.textContent ?? button.textContent ?? '')) continue;
    if (!button.hasAttribute(ATTR_LOAD_PREVIOUS)) button.setAttribute(ATTR_LOAD_PREVIOUS, '');
    return button;
  }
  return null;
}

function overviewLoading(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute('data-loading') === 'true' || button.getAttribute('aria-disabled') === 'true';
}

/** The count the Overview's button shows ("237"); empty while a page loads, when GitHub drops its counter label. */
function previousCount(button: HTMLButtonElement): string {
  return button.querySelector('[data-component="CounterLabel"]')?.textContent?.trim() ?? '';
}

/** The Overview's button pressed, when, and the count it showed then: it stays in the page, so a press counts only until its page has come. */
let pressedPrevious: { readonly button: HTMLButtonElement; readonly at: number; readonly count: string } | null = null;
/** How long a press counts before GitHub has marked its button loading: React flips it in the press's own render. */
const PREVIOUS_GRACE_MS = 1000;

function previousPending(now: number): boolean {
  if (pressedPrevious === null || !pressedPrevious.button.isConnected) return false;
  if (overviewLoading(pressedPrevious.button)) return now - pressedPrevious.at < PRESS_TIMEOUT_MS;
  // A page that came between two passes changed the count: the next may be asked for at once, not after the grace.
  return previousCount(pressedPrevious.button) === pressedPrevious.count && now - pressedPrevious.at < PREVIOUS_GRACE_MS;
}

export function sourceAnchorFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, '');
  return /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+|event-\d+)$/.test(id) ? id : null;
}

const GUARDED = new WeakSet<HTMLFormElement>();

/**
 * The headers GitHub's own fragment loader sends. The page carries a fetch
 * nonce (`meta[name="fetch-nonce"]`); markup GitHub renders for a request
 * that names it embeds the same nonce on its `include-fragment`s, and every
 * later load from that markup (a comment's ⋯ menu, a thread's replies) is
 * validated against the page's. Markup fetched *without* the nonce carries
 * a foreign one, and those later loads answer 403 — "Uh oh! There was an
 * error while loading" inside the menu.
 */
export function fragmentHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' };
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
  if (nonce !== '') {
    headers['X-Fetch-Nonce'] = nonce;
    headers['X-Fetch-Nonce-To-Validate'] = nonce;
  }
  return headers;
}
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
/**
 * A "Load more" Geld pressed is still on its way: the form stands, showing GitHub's "Loading…" rather than its count,
 * until the rows land and replace it.
 */
export function loadMorePending(): boolean {
  return loadMorePendingUntil() !== null;
}

/** When the press on its way stops counting as one (a load that failed and left its form), or null with none. */
export function loadMorePendingUntil(now = Date.now()): number | null {
  if (pressed !== null && pressed.form.isConnected && now - pressed.at < PRESS_TIMEOUT_MS) return pressed.at + PRESS_TIMEOUT_MS;
  if (pressedPrevious !== null && previousPending(now)) return pressedPrevious.at + (overviewLoading(pressedPrevious.button) ? PRESS_TIMEOUT_MS : PREVIOUS_GRACE_MS);
  return null;
}

/** A press that never landed: its form still stands after the press timed out (the load failed), or the Overview's button still loads. */
export function loadMoreStalled(now = Date.now()): boolean {
  if (pressed !== null && pressed.form.isConnected && now - pressed.at >= PRESS_TIMEOUT_MS) return true;
  return pressedPrevious !== null && pressedPrevious.button.isConnected && overviewLoading(pressedPrevious.button) && now - pressedPrevious.at >= PRESS_TIMEOUT_MS;
}

/** How many items GitHub's "Load more" says it still hides ("169 hidden items" beside the button); 0 with none. */
export function hiddenTimelineItems(root: ParentNode = document): number {
  const scopes = new Set<Element>();
  for (const button of root.querySelectorAll<HTMLElement>(LOAD_MORE)) {
    const scope = button.closest('form') ?? button.parentElement;
    if (scope !== null) scopes.add(scope);
  }
  let total = 0;
  for (const scope of scopes) {
    total += parseCount(HIDDEN_ITEMS_TEXT.exec(scope.textContent ?? '')?.[1]) ?? 0;
  }
  // The Overview's counter label is the count alone; while a page loads it is gone, and that reads as 0 like a classic press.
  const previous = overviewLoadPrevious(root);
  if (previous !== null) total += parseCount(previousCount(previous)) ?? 0;
  return total;
}

/**
 * Whether a "Load more" still stands in the page, pressable or not: the timeline is incomplete while one does. The
 * Overview's reads as none to press while it loads, and a load that stalls there must not read as everything loaded.
 */
export function loadMoreStanding(root: ParentNode = document): boolean {
  return root.querySelector(LOAD_MORE) !== null || overviewLoadPrevious(root) !== null;
}

/** Whether the timeline still ends in a "Load more" that can be pressed (the Overview's while it is not already loading). */
export function hasLoadMore(root: ParentNode = document): boolean {
  const button = root.querySelector<HTMLButtonElement>(LOAD_MORE);
  if (button !== null && !button.disabled) return true;
  const previous = overviewLoadPrevious(root);
  return previous !== null && !overviewLoading(previous);
}

export function clickLoadMore(root: ParentNode = document, now = Date.now()): boolean {
  if (document.readyState !== 'complete') return false;
  const button = root.querySelector<HTMLButtonElement>(LOAD_MORE);
  if (button === null || button.disabled) return pressLoadPrevious(root, now);
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
  // Pressed on Geld's behalf: GitHub must not read it as the reader clicking away from the permalink they opened.
  quietClick(button);
  return true;
}

/** The Overview's "Load previous comments", one press per page: its button stands while the page comes and after. */
function pressLoadPrevious(root: ParentNode, now: number): boolean {
  const button = overviewLoadPrevious(root);
  if (button === null || overviewLoading(button) || previousPending(now)) return false;
  pressedPrevious = { button, at: now, count: previousCount(button) };
  quietClick(button);
  return true;
}

async function loadMoreOurselves(form: HTMLFormElement): Promise<void> {
  const url = new URL(form.action, location.href);
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') url.searchParams.set(key, value);
  const response = await fetch(url, { headers: fragmentHeaders(), credentials: 'same-origin' });
  if (!response.ok) return;
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const nodes = [...parsed.body.childNodes].map((node) => document.adoptNode(node));
  form.replaceWith(...nodes);
}

export function itemIdForAnchor(metaItems: readonly { readonly id: string; readonly sources: readonly { readonly anchor: string }[] }[], anchor: string): string | null {
  return metaItems.find((item) => item.sources.some((source) => source.anchor === anchor))?.id ?? null;
}
