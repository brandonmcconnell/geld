import type { CommentLines } from '@geld/core';
import { formatCount } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

/**
 * Collapses comment-only changed lines inside a visible file's diff table. Each
 * run of consecutive collapsed rows gets a note row ("3 comment-only lines
 * hidden · Show") in its place; clicking it reveals the run for the rest of
 * the visit. Everything is keyed on GitHub's own line anchors
 * (`diff-<digest>R30` / `L91`), which both the classic and the React view
 * carry on their cells, so a re-render is simply re-applied.
 */

export const ATTR_LINE = 'data-geld-line';
const ATTR_NOTE = 'data-geld-line-note';
const ATTR_RUN = 'data-geld-run';
const NOTE_CLASS = 'geld-line-note';

/** Cells that identify a line: React puts the anchor in `data-line-anchor`, the classic view in `id`. */
function anchoredCells(row: Element, anchor: string): readonly { readonly cell: Element; readonly key: string }[] {
  const cells: { cell: Element; key: string }[] = [];
  for (const cell of row.querySelectorAll('[data-line-anchor], [id]')) {
    const key = cell.getAttribute('data-line-anchor') ?? cell.id;
    if (key.startsWith(anchor) && /^[LR]\d+$/.test(key.slice(anchor.length))) cells.push({ cell, key });
  }
  return cells;
}

function lineCell(root: Element, anchor: string, side: 'L' | 'R', line: number): Element | null {
  const key = `${anchor}${side}${line}`;
  return root.querySelector(`[data-line-anchor="${key}"]`) ?? root.querySelector(`[id="${key}"]`);
}

/**
 * Apply (idempotently) to one file's rendered diff. `shownRuns` holds the run
 * keys the user has opened on this page; those rows stay visible.
 */
export function applyCommentRows(root: HTMLElement, anchor: string, lines: CommentLines, shownRuns: Set<string>): void {
  const wanted = new Set<string>();
  for (const line of lines.added) wanted.add(`${anchor}R${line}`);
  for (const line of lines.removed) wanted.add(`${anchor}L${line}`);

  // Candidate rows: every row holding one of the wanted lines. A split-view
  // row pairs a left and a right line; it is collapsed only when every line it
  // shows is comment-only, so no code line ever disappears with a comment.
  const rows = new Set<HTMLTableRowElement>();
  for (const line of lines.added) addRow(rows, lineCell(root, anchor, 'R', line));
  for (const line of lines.removed) addRow(rows, lineCell(root, anchor, 'L', line));

  const collapsible = new Set<HTMLTableRowElement>();
  for (const row of rows) {
    const cells = anchoredCells(row, anchor);
    if (cells.length > 0 && cells.every(({ key }) => wanted.has(key))) collapsible.add(row);
  }

  // Rows we marked earlier that no longer qualify (a re-render moved lines, the diff changed) are released.
  for (const row of root.querySelectorAll<HTMLTableRowElement>(`tr[${ATTR_LINE}]`)) {
    if (!collapsible.has(row)) row.removeAttribute(ATTR_LINE);
  }

  // Group into runs of consecutive rows (in DOM order) and place one note before each.
  const validRuns = new Set<string>();
  for (const table of tablesOf(collapsible)) {
    let run: HTMLTableRowElement[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const first = run[0];
      if (first !== undefined) {
        const key = `${anchoredCells(first, anchor)[0]?.key ?? anchor}`;
        validRuns.add(key);
        const shown = shownRuns.has(key);
        for (const row of run) row.setAttribute(ATTR_LINE, shown ? 'shown' : 'hidden');
        const rows = run;
        if (shown) {
          first.parentElement?.querySelector(`[${ATTR_NOTE}][${ATTR_RUN}="${key}"]`)?.remove();
        } else {
          ensureNote(first, key, rows.length, () => {
            shownRuns.add(key);
            for (const row of rows) row.setAttribute(ATTR_LINE, 'shown');
            first.parentElement?.querySelector(`[${ATTR_NOTE}][${ATTR_RUN}="${key}"]`)?.remove();
          });
        }
      }
      run = [];
    };
    for (const row of table.rows) {
      if (row.hasAttribute(ATTR_NOTE)) continue;
      if (collapsible.has(row)) run.push(row);
      else flush();
    }
    flush();
  }
  // Notes whose run is gone.
  for (const note of root.querySelectorAll<HTMLElement>(`[${ATTR_NOTE}]`)) {
    if (!validRuns.has(note.getAttribute(ATTR_RUN) ?? '')) note.remove();
  }
}

function addRow(rows: Set<HTMLTableRowElement>, cell: Element | null): void {
  const row = cell?.closest('tr');
  if (row instanceof HTMLTableRowElement) rows.add(row);
}

function tablesOf(rows: ReadonlySet<HTMLTableRowElement>): ReadonlySet<HTMLTableElement> {
  const tables = new Set<HTMLTableElement>();
  for (const row of rows) {
    const table = row.closest('table');
    if (table !== null) tables.add(table);
  }
  return tables;
}

function ensureNote(first: HTMLTableRowElement, key: string, count: number, onShow: () => void): void {
  const previous = first.previousElementSibling;
  if (previous instanceof HTMLElement && previous.getAttribute(ATTR_RUN) === key) {
    const text = previous.querySelector(`.${NOTE_CLASS}__text`);
    if (text !== null) text.textContent = noteText(count);
    return;
  }
  const columns = Math.max(1, first.cells.length);
  const button = createElement('button', { type: 'button', class: `${NOTE_CLASS}__show` }, ['Show']);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onShow();
  });
  const cell = createElement('td', { class: `${NOTE_CLASS}__cell`, colspan: String(columns) }, [
    createElement('span', { class: `${NOTE_CLASS}__text` }, [noteText(count)]),
    button,
  ]);
  const note = createElement('tr', { class: NOTE_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_NOTE]: '', [ATTR_RUN]: key }, [cell]);
  first.insertAdjacentElement('beforebegin', note);
}

function noteText(count: number): string {
  return `${formatCount(count)} comment-only ${count === 1 ? 'line' : 'lines'} hidden`;
}

/** Undo everything in `root` (a file, or the document). */
export function clearCommentRows(root: ParentNode): void {
  for (const row of root.querySelectorAll(`[${ATTR_LINE}]`)) row.removeAttribute(ATTR_LINE);
  for (const note of root.querySelectorAll(`[${ATTR_NOTE}]`)) note.remove();
}
