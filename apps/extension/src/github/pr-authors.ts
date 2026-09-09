import type { AuthorRules } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import type { ListRow } from './pr-list';
import { findRows } from './pr-list';

/**
 * Hides pull requests in lists by who opened them (the `hiddenAuthors`
 * setting): the rows get `data-geld-author="hidden"` and one note per list
 * says how many by whom, with a "Show" that reveals them for the visit.
 * Applied on every pass like everything else, so a list that re-renders or
 * paginates is simply re-hidden. Where the author is written per GitHub UI is
 * `list-surfaces.ts`'s business.
 */

export const ATTR_AUTHOR = 'data-geld-author';
const ATTR_NOTE = 'data-geld-author-note';
const ATTR_SHOWN = 'data-geld-authors-shown';
const NOTE_CLASS = 'geld-author-note';

/** The element holding a list's rows (their common parent), where the note goes. */
function listOf(row: HTMLElement): HTMLElement {
  return row.parentElement ?? row;
}

export function applyAuthorHiding(rules: AuthorRules): void {
  if (rules.isEmpty) {
    removeAuthorHiding();
    return;
  }
  const hiddenByList = new Map<HTMLElement, { rows: ListRow[]; authors: Set<string> }>();
  const seenLists = new Set<HTMLElement>();
  for (const item of findRows()) {
    const author = item.surface.authorOf(item.row);
    // Surfaces without an author (the stack popover) are left alone.
    if (author === null && item.surface.id === 'stack-popover') continue;
    const list = listOf(item.row);
    seenLists.add(list);
    if (author === null || !rules.hides(author)) {
      item.row.removeAttribute(ATTR_AUTHOR);
      continue;
    }
    const bucket = hiddenByList.get(list) ?? { rows: [], authors: new Set<string>() };
    bucket.rows.push(item);
    bucket.authors.add(author);
    hiddenByList.set(list, bucket);
  }
  for (const list of seenLists) {
    const bucket = hiddenByList.get(list);
    const note = list.querySelector<HTMLElement>(`:scope > [${ATTR_NOTE}]`);
    if (bucket === undefined) {
      note?.remove();
      continue;
    }
    const shown = list.hasAttribute(ATTR_SHOWN);
    for (const item of bucket.rows) item.row.setAttribute(ATTR_AUTHOR, shown ? 'shown' : 'hidden');
    if (shown) {
      note?.remove();
      continue;
    }
    const authors = [...bucket.authors].sort();
    const text = `${pluralize(bucket.rows.length, 'pull request', 'pull requests')} by ${authors.length > 3 ? `${authors.slice(0, 3).join(', ')} and ${formatCount(authors.length - 3)} more` : authors.join(', ')} hidden`;
    if (note !== null) {
      const label = note.querySelector(`.${NOTE_CLASS}__text`);
      if (label !== null && label.textContent !== text) label.textContent = text;
      continue;
    }
    const button = createElement('button', { type: 'button', class: `${NOTE_CLASS}__show` }, ['Show']);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      list.setAttribute(ATTR_SHOWN, '');
      for (const row of list.querySelectorAll<HTMLElement>(`[${ATTR_AUTHOR}="hidden"]`)) row.setAttribute(ATTR_AUTHOR, 'shown');
      list.querySelector(`:scope > [${ATTR_NOTE}]`)?.remove();
    });
    const first = bucket.rows[0]?.row ?? null;
    const created = createElement('div', { class: NOTE_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_NOTE]: '', role: 'note' }, [
      createElement('span', { class: `${NOTE_CLASS}__text` }, [text]),
      button,
    ]);
    // Where the first hidden row sits, so the note reads in context (a `li` list gets a `li` note).
    if (list instanceof HTMLUListElement || list instanceof HTMLOListElement) {
      const wrapper = createElement('li', { [OWN_UI_ATTRIBUTE]: '', [ATTR_NOTE]: '', role: 'listitem', class: `${NOTE_CLASS}-item` }, [created]);
      created.removeAttribute(ATTR_NOTE);
      (first ?? list.firstElementChild)?.insertAdjacentElement('beforebegin', wrapper);
    } else {
      (first ?? list.firstElementChild)?.insertAdjacentElement('beforebegin', created);
    }
  }
}

export function removeAuthorHiding(): void {
  for (const row of document.querySelectorAll(`[${ATTR_AUTHOR}]`)) row.removeAttribute(ATTR_AUTHOR);
  for (const note of document.querySelectorAll(`[${ATTR_NOTE}]`)) note.remove();
  for (const list of document.querySelectorAll(`[${ATTR_SHOWN}]`)) list.removeAttribute(ATTR_SHOWN);
}
