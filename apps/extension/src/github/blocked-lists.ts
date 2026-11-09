import { pluralize } from '@geld/core';
import type { BlockedBy } from './blocked-list';
import { blockedWords } from './review/panel';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import type { ListSurface } from './list-surfaces';
import { ATTR_AUTHOR } from './pr-authors';

/**
 * Lists leave out what a blocked person opened: pull requests, issues and
 * discussions alike, in whatever state the list shows. One quiet row at the
 * foot of the list says how many ("2 pull requests by blocked users hidden")
 * with Show, which lays them out under that row, each with a Blocked label
 * beside its author, and Hide puts them away again. Nothing is moved: the list
 * becomes a flex column and the rows and the note take their places by `order`,
 * as the files tab gathers hidden files, so GitHub's own nodes stay where
 * GitHub put them. Shown is for the visit only, and a list GitHub re-renders is
 * simply laid out again.
 */

const ATTR_ROW = 'data-geld-blocked-row';
const ATTR_LIST = 'data-geld-blocked-list';
const ATTR_SHOWN = 'data-geld-blocked-shown';
const ATTR_NOTE = 'data-geld-blocked-note';
const ATTR_LABEL = 'data-geld-blocked-row-label';
const ITEM_PATH = /^\/[^/]+\/[^/]+\/(pull|issues|discussions)\/\d+\/?$/;

type Kind = 'pull' | 'issues' | 'discussions';

interface BlockedRow {
  readonly row: HTMLElement;
  readonly kind: Kind;
  readonly author: string;
  readonly surface: ListSurface;
}

const NOUNS: Readonly<Record<Kind, readonly [string, string]>> = {
  pull: ['pull request', 'pull requests'],
  issues: ['issue', 'issues'],
  discussions: ['discussion', 'discussions'],
};

/** Each list row a title link names, on the surfaces that read an author, with its author and what kind of item it is. */
function rowsWithAuthors(surfaces: readonly ListSurface[]): readonly { readonly row: HTMLElement; readonly kind: Kind; readonly author: string | null; readonly owner: string; readonly surface: ListSurface }[] {
  const found = new Map<HTMLElement, { readonly row: HTMLElement; readonly kind: Kind; readonly author: string | null; readonly owner: string; readonly surface: ListSurface }>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"], a[href*="/issues/"], a[href*="/discussions/"]')) {
    if (link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null || link.matches('.issue-link, .js-issue-link') || (link.textContent ?? '').trim() === '') continue;
    let url: URL;
    try {
      url = new URL(link.href, location.origin);
    } catch {
      continue;
    }
    const kind = url.origin === location.origin ? ITEM_PATH.exec(url.pathname)?.[1] : undefined;
    if (kind !== 'pull' && kind !== 'issues' && kind !== 'discussions') continue;
    for (const surface of surfaces) {
      if (surface.spec.authors.length === 0) continue;
      const row = surface.rowOf(link);
      if (row === null || found.has(row)) continue;
      found.set(row, { row, kind, author: surface.authorOf(row), owner: url.pathname.split('/')[1] ?? '', surface });
      break;
    }
  }
  return [...found.values()];
}

function labelAuthor(row: HTMLElement, author: string, by: BlockedBy): void {
  if (row.querySelector(`[${ATTR_LABEL}]`) !== null) return;
  const lower = author.toLowerCase();
  const link = [...row.querySelectorAll('a')].find((candidate) => {
    const words = `${candidate.getAttribute('title') ?? ''} ${candidate.getAttribute('aria-label') ?? ''} ${candidate.getAttribute('data-hovercard-url') ?? ''} ${candidate.textContent ?? ''}`.toLowerCase();
    return words.includes(`opened by ${lower}`) || words.includes(`author ${lower}`) || words.includes(`/users/${lower}/`) || (candidate.textContent ?? '').trim().toLowerCase() === lower;
  });
  if (link === undefined) return;
  link.after(createElement('span', { class: 'Label Label--secondary geld-blocked-label', [OWN_UI_ATTRIBUTE]: '', [ATTR_LABEL]: '', title: blockedWords(by) }, ['Blocked']));
}

function noteText(rows: readonly BlockedRow[], shown: boolean): string {
  const kinds = new Set(rows.map((row) => row.kind));
  const only = kinds.size === 1 ? [...kinds][0] : undefined;
  const [one, many] = only === undefined ? ['item', 'items'] : NOUNS[only];
  return `${pluralize(rows.length, one, many)} by blocked users${shown ? '' : ' hidden'}`;
}

/** Each list's blocked rows as of the last pass, for its note's button. */
const latest = new WeakMap<HTMLElement, readonly BlockedRow[]>();

function syncNote(list: HTMLElement, rows: readonly BlockedRow[]): void {
  latest.set(list, rows);
  const shown = list.hasAttribute(ATTR_SHOWN);
  let note = list.querySelector<HTMLElement>(`:scope > [${ATTR_NOTE}]`);
  if (note === null) {
    const button = createElement('button', { type: 'button', class: 'geld-blocked-note__toggle' });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      list.toggleAttribute(ATTR_SHOWN);
      syncNote(list, latest.get(list) ?? []);
    });
    const inner = createElement('div', { class: 'geld-blocked-note', role: 'note' }, [createElement('span', { class: 'geld-blocked-note__text' }), button]);
    note = list instanceof HTMLUListElement || list instanceof HTMLOListElement ? createElement('li', { class: 'geld-blocked-note-item' }, [inner]) : inner;
    note.setAttribute(OWN_UI_ATTRIBUTE, '');
    note.setAttribute(ATTR_NOTE, '');
    list.append(note);
  }
  const text = noteText(rows, shown);
  const label = note.querySelector('.geld-blocked-note__text');
  if (label !== null && label.textContent !== text) label.textContent = text;
  const toggle = note.querySelector('.geld-blocked-note__toggle');
  const word = shown ? 'Hide' : 'Show';
  if (toggle !== null && toggle.textContent !== word) toggle.textContent = word;
  for (const { row } of rows) {
    const value = shown ? 'shown' : 'hidden';
    if (row.getAttribute(ATTR_ROW) !== value) row.setAttribute(ATTR_ROW, value);
  }
}

/** `blockedIn(owner)` is who is blocked in that owner's repositories: a list across organizations (`/pulls`) holds several. */
export function applyBlockedListHiding(blockedIn: (owner: string) => ReadonlyMap<string, BlockedBy>, surfaces: readonly ListSurface[]): void {
  const byList = new Map<HTMLElement, BlockedRow[]>();
  const seen = new Set<HTMLElement>();
  for (const { row, kind, author, owner, surface } of rowsWithAuthors(surfaces)) {
    const list = row.parentElement;
    if (list === null) continue;
    seen.add(list);
    // A row the hidden-people list already hides is that list's note's to show, so it gets no second hiding here.
    const scope = author === null || row.getAttribute(ATTR_AUTHOR) === 'hidden' ? undefined : blockedIn(owner).get(author.toLowerCase());
    if (author === null || scope === undefined) {
      if (row.hasAttribute(ATTR_ROW)) row.removeAttribute(ATTR_ROW);
      row.querySelector(`[${ATTR_LABEL}]`)?.remove();
      continue;
    }
    labelAuthor(row, author, scope);
    byList.set(list, [...(byList.get(list) ?? []), { row, kind, author, surface }]);
  }
  for (const list of document.querySelectorAll<HTMLElement>(`[${ATTR_LIST}]`)) seen.add(list);
  for (const list of seen) {
    const rows = byList.get(list);
    if (rows === undefined) {
      list.removeAttribute(ATTR_LIST);
      list.removeAttribute(ATTR_SHOWN);
      list.querySelector(`:scope > [${ATTR_NOTE}]`)?.remove();
      continue;
    }
    if (!list.hasAttribute(ATTR_LIST)) list.setAttribute(ATTR_LIST, '');
    syncNote(list, rows);
  }
}

export function removeBlockedListHiding(): void {
  for (const node of document.querySelectorAll(`[${ATTR_NOTE}], [${ATTR_LABEL}]`)) node.remove();
  for (const node of document.querySelectorAll(`[${ATTR_ROW}]`)) node.removeAttribute(ATTR_ROW);
  for (const node of document.querySelectorAll(`[${ATTR_LIST}], [${ATTR_SHOWN}]`)) {
    node.removeAttribute(ATTR_LIST);
    node.removeAttribute(ATTR_SHOWN);
  }
}
