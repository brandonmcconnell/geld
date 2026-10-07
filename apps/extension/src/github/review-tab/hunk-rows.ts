/**
 * Inside a diff on loan to a step, the rows of hunks that belong to other
 * steps are folded: each run becomes one note row ("14 lines belong to step
 * 3, Results list · Show"), the way `ui/comment-rows.ts` folds comment-only
 * lines. Rows are mapped to hunks by the line anchors GitHub stamps on their
 * cells (`diff-<digest>R30` / `L91`, in `data-line-anchor` on the React view
 * and `id` on the classic one) against the hunk ranges from the diff; a row
 * with no anchored cell (a hunk header, an expander) goes with the row after
 * it. GitHub's DOM is never rewritten: attributes and one inserted row.
 */

import type { DiffHunk } from '@geld/core';
import { formatCount } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export const ATTR_STEP_ROW = 'data-geld-step-row';
const ATTR_NOTE = 'data-geld-step-note';
const ATTR_RUN = 'data-geld-step-run';
const NOTE_CLASS = 'geld-step-note';

/** Where a hunk index not in the step belongs, for the note's words. */
export interface OtherStep {
  readonly index: number;
  readonly title: string;
}

interface FoldOptions {
  readonly anchor: string;
  readonly hunks: readonly DiffHunk[];
  /** Hunk indices the step owns in this file; every other hunk folds. */
  readonly keep: ReadonlySet<number>;
  readonly stepOf: (hunk: number) => OtherStep | null;
  readonly shownRuns: Set<string>;
}

function anchoredLines(row: Element, anchor: string): readonly { readonly side: 'L' | 'R'; readonly line: number }[] {
  const lines: { side: 'L' | 'R'; line: number }[] = [];
  for (const cell of row.querySelectorAll('[data-line-anchor], [id]')) {
    const key = cell.getAttribute('data-line-anchor') ?? cell.id;
    if (!key.startsWith(anchor)) continue;
    const match = /^([LR])(\d+)$/.exec(key.slice(anchor.length));
    if (match?.[1] === 'L' || match?.[1] === 'R') lines.push({ side: match[1], line: Number(match[2]) });
  }
  return lines;
}

/** The hunk a line falls in: new-file numbers against new ranges, old-file numbers against old ranges. */
function hunkOf(hunks: readonly DiffHunk[], side: 'L' | 'R', line: number): number | null {
  for (const hunk of hunks) {
    const start = side === 'R' ? hunk.newStart : hunk.oldStart;
    const length = side === 'R' ? hunk.newLines : hunk.oldLines;
    // A hunk header's own line is its start; a pure deletion's new side has zero lines but still owns its start.
    if (line >= start && line < start + Math.max(1, length)) return hunk.index;
  }
  return null;
}

/** Fold the rows of other steps' hunks inside one rendered file (idempotent). */
export function foldOtherHunks(root: HTMLElement, options: FoldOptions): void {
  const tables = [...root.querySelectorAll('table')].filter((table) => table.closest(`[${OWN_UI_ATTRIBUTE}]`) === null);
  const validRuns = new Set<string>();
  for (const table of tables) {
    // Pass 1: the hunk of every body row (GitHub's `thead` is a screen-reader header, clipped away, so a note
    // placed there would be too); unanchored rows take the next anchored row's.
    const rows = [...table.tBodies].flatMap((body) => [...body.rows]).filter((row) => !row.hasAttribute(ATTR_NOTE));
    const columns = Math.max(1, ...rows.map((row) => [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)));
    const hunkByRow = new Map<HTMLTableRowElement, number | null>();
    let pending: HTMLTableRowElement[] = [];
    for (const row of rows) {
      const lines = anchoredLines(row, options.anchor);
      if (lines.length === 0) {
        pending.push(row);
        continue;
      }
      let hunk: number | null = null;
      for (const entry of lines) {
        hunk = hunkOf(options.hunks, entry.side, entry.line);
        if (hunk !== null) break;
      }
      hunkByRow.set(row, hunk);
      for (const earlier of pending) hunkByRow.set(earlier, hunk);
      pending = [];
    }
    // Trailing unanchored rows (an expander at the end) belong to the last hunk seen.
    const lastRow = rows[rows.length - 1];
    const last = lastRow === undefined ? null : (hunkByRow.get(lastRow) ?? null);
    for (const row of pending) hunkByRow.set(row, last);

    // Pass 2: runs of rows whose hunk the step does not own.
    let run: HTMLTableRowElement[] = [];
    let runHunk: number | null = null;
    const flush = (): void => {
      const first = run[0];
      if (first !== undefined && runHunk !== null) {
        const key = `${options.anchor}#${runHunk}:${anchoredLines(first, options.anchor)[0]?.line ?? 0}`;
        validRuns.add(key);
        const shown = options.shownRuns.has(key);
        for (const row of run) row.setAttribute(ATTR_STEP_ROW, shown ? 'shown' : 'hidden');
        const rowsOfRun = run;
        const other = options.stepOf(runHunk);
        if (shown) first.parentElement?.querySelector(`[${ATTR_NOTE}][${ATTR_RUN}="${key}"]`)?.remove();
        else {
          ensureNote(first, key, rowsOfRun.length, other, columns, () => {
            options.shownRuns.add(key);
            for (const row of rowsOfRun) row.setAttribute(ATTR_STEP_ROW, 'shown');
            first.parentElement?.querySelector(`[${ATTR_NOTE}][${ATTR_RUN}="${key}"]`)?.remove();
          });
        }
      }
      run = [];
      runHunk = null;
    };
    for (const row of rows) {
      const hunk = hunkByRow.get(row) ?? null;
      const fold = hunk !== null && !options.keep.has(hunk);
      if (fold && (runHunk === null || runHunk === hunk)) {
        run.push(row);
        runHunk = hunk;
        continue;
      }
      flush();
      if (fold) {
        run.push(row);
        runHunk = hunk;
      } else row.removeAttribute(ATTR_STEP_ROW);
    }
    flush();
  }
  for (const note of root.querySelectorAll<HTMLElement>(`[${ATTR_NOTE}]`)) {
    if (!validRuns.has(note.getAttribute(ATTR_RUN) ?? '')) note.remove();
  }
}

function ensureNote(first: HTMLTableRowElement, key: string, count: number, other: OtherStep | null, columns: number, onShow: () => void): void {
  const previous = first.previousElementSibling;
  if (previous instanceof HTMLElement && previous.getAttribute(ATTR_RUN) === key) {
    const text = previous.querySelector(`.${NOTE_CLASS}__text`);
    if (text !== null) text.textContent = noteText(count, other);
    return;
  }
  const button = createElement('button', { type: 'button', class: `${NOTE_CLASS}__show` }, ['Show']);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onShow();
  });
  const cell = createElement('td', { class: `${NOTE_CLASS}__cell`, colspan: String(columns) }, [createElement('span', { class: `${NOTE_CLASS}__text` }, [noteText(count, other)]), button]);
  const note = createElement('tr', { class: NOTE_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_NOTE]: '', [ATTR_RUN]: key }, [cell]);
  first.insertAdjacentElement('beforebegin', note);
}

function noteText(count: number, other: OtherStep | null): string {
  const lines = `${formatCount(count)} ${count === 1 ? 'line belongs' : 'lines belong'}`;
  return other === null ? `${lines} to another step` : `${lines} to step ${other.index + 1}, ${other.title}`;
}

/** Undo everything in `root` (a file, or the document). */
export function clearFoldedHunks(root: ParentNode): void {
  for (const row of root.querySelectorAll(`[${ATTR_STEP_ROW}]`)) row.removeAttribute(ATTR_STEP_ROW);
  for (const note of root.querySelectorAll(`[${ATTR_NOTE}]`)) note.remove();
}
