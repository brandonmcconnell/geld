/**
 * How the Overview's top card stands, on `<html>` so the stylesheet dresses it from GitHub's first frame: `digest`
 * joins its status row to the description, `folded` (Digest view) also folds its mini statuses into the digest.
 *
 * Settings load asynchronously, and GitHub can paint the card before they arrive, so the last decision is kept in the
 * page's own storage and applied synchronously when the content script starts (`applyTopCardHint`), as the status
 * pill's hint is; the controller corrects it before paint once the settings are known.
 */
export type TopCard = 'digest' | 'folded';

const ATTR_TOP_CARD = 'data-geld-top-card';
const HINT_KEY = 'geld:top-card';

let remembered: TopCard | 'off' | null = null;

export function setTopCard(state: TopCard | null): void {
  const html = document.documentElement;
  if (state === null) html.removeAttribute(ATTR_TOP_CARD);
  else if (html.getAttribute(ATTR_TOP_CARD) !== state) html.setAttribute(ATTR_TOP_CARD, state);
}

/** What the settings say, for the next page load's first frame. Written only when it changes. */
export function rememberTopCard(state: TopCard | 'off'): void {
  if (remembered === state) return;
  remembered = state;
  try {
    window.localStorage.setItem(HINT_KEY, state);
  } catch {
    // Storage full or blocked: the next load dresses the card once the settings arrive, a little later.
  }
}

/** On a pull request page, the last decision before anything else runs. The stylesheet matches only the Overview's markup. */
export function applyTopCardHint(path: string = window.location.pathname): void {
  if (!/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(path)) return;
  let hint: string | null = null;
  try {
    hint = window.localStorage.getItem(HINT_KEY);
  } catch {
    return;
  }
  if (hint === 'digest' || hint === 'folded') {
    remembered = hint;
    setTopCard(hint);
  }
}
