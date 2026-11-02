/**
 * The clock beside an edited comment's time, in a chat's byline and in a
 * row alike: the time beside it is the edit's (the comment as it reads now),
 * and the clock says when the comment was first posted. With the comment's
 * edit-history log known, the clock is GitHub's own "edited" dropdown: a
 * `details-menu.js-comment-edit-history-menu` loading that log, as GitHub's
 * header has it, so the page's elements list the revisions and GitHub's
 * delegated `details-menu-select` handler opens the chosen one in its own
 * dialog. The content script only builds the markup; the page upgrades it.
 */

import { createElement, svgFromString } from '../dom';
import { ICON_HISTORY } from '../ui/icons';
import { absoluteTimeText } from './time';

let editedIds = 0;

/** "Originally posted Oct 8, 2026, 5:08 PM"; "Edited Oct 8, 2026, 5:08 PM" when the posting time is not known. */
export function editedWords(editedAt: string, postedAt: string | null): string {
  const absolute = absoluteTimeText(postedAt ?? editedAt);
  return `${postedAt === null ? 'Edited' : 'Originally posted'}${absolute === '' ? '' : ` ${absolute}`}`;
}

/** GitHub's own tooltip for `id` when the page defines `tool-tip`, else null (the mark then carries a `title`). */
function tooltip(id: string, words: string): HTMLElement | null {
  // The content script's world has no `customElements` to ask (Chrome leaves it null there); a page that defines
  // `tool-tip` has rendered some of its own by now (the header's), so their presence stands for the definition.
  if (document.querySelector('tool-tip') === null) return null;
  const tip = document.createElement('tool-tip');
  for (const [name, value] of Object.entries({ for: id, popover: 'manual', 'data-direction': 'n', 'data-type': 'description', class: 'sr-only position-absolute', role: 'tooltip' })) tip.setAttribute(name, value);
  tip.textContent = words;
  return tip;
}

/** GitHub's edit-history menu for `log`, as its comment header renders it: the list loads when the menu opens. */
function historyMenu(log: string): HTMLElement {
  const menu = document.createElement('details-menu');
  menu.className = 'dropdown-menu dropdown-menu-sw width-auto py-0 js-comment-edit-history-menu';
  menu.setAttribute('src', log);
  menu.setAttribute('preload', '');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('style', 'max-width: 352px; z-index: 99;');
  const fragment = document.createElement('include-fragment');
  fragment.setAttribute('aria-label', 'Loading…');
  fragment.setAttribute('style', 'min-width: 100px;');
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
  if (nonce !== '') fragment.setAttribute('data-nonce', nonce);
  fragment.append(createElement('span', { class: 'geld-review__edited-loading' }, ['Loading edit history…']));
  menu.append(fragment);
  return menu;
}

/**
 * The clock for a comment edited at `editedAt` and first posted at `postedAt`. With `log`, a click opens GitHub's
 * edit history for the comment; without it, the clock only says when the comment was posted.
 */
export function editedMark(editedAt: string, postedAt: string | null, log: string | null = null): HTMLElement {
  editedIds += 1;
  const id = `geld-edited-${editedIds}`;
  const words = editedWords(editedAt, postedAt);
  const tip = tooltip(id, words);
  if (log === null) {
    const mark = createElement('span', { id, class: 'geld-review__edited', role: 'img', 'aria-label': words, ...(tip === null ? { title: words } : {}) }, [svgFromString(ICON_HISTORY)]);
    return tip === null ? mark : createElement('span', { class: 'geld-review__edited-wrap' }, [mark, tip]);
  }
  const summary = createElement(
    'summary',
    { id, class: 'geld-review__edited geld-review__edited--menu', 'aria-haspopup': 'menu', role: 'button', 'aria-label': `${words}. Show edit history`, ...(tip === null ? { title: words } : {}) },
    [svgFromString(ICON_HISTORY)],
  );
  const details = createElement('details', { class: 'details-overlay details-reset d-inline-block dropdown geld-review__edited-wrap' }, [summary, historyMenu(log)]);
  if (tip !== null) details.append(tip);
  return details;
}
