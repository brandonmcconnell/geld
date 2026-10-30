import type { OutlineLine, TestFold, TestSyntax } from '@geld/core';
import { formatCount, outlineTestFolds } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ATTR_LINE, ATTR_LINE_NOTE } from './comment-rows';
import { ICON_CHEVRON_RIGHT } from './icons';

/**
 * Test files read as their titles: every test, declaration and body, folds
 * to one full-width row of Geld's own: the line it starts on (set as GitHub's
 * line numbers are and lined up with them), its title, and at the
 * right what changed in it ("+3 −1"); opened, the test's whole source shows
 * under that row, declaration included. Keyed on
 * GitHub's own line anchors (`diff-<digest>R30` / `L91`, `data-line-anchor`
 * in the React view, `id` in the classic one) like the comment-only rows, so
 * a re-render is simply re-applied. GitHub's nodes are never rewritten: rows
 * are hidden by attribute and the title row is a row of Geld's beside them.
 */

export const ATTR_TEST_FOLD = 'data-geld-test-fold';
const ATTR_TEST_ROW = 'data-geld-test-row';
const ROW_CLASS = 'geld-test-row';
const CODE = '.blob-code-inner, .diff-text-inner';

interface ReadLine {
  readonly line: OutlineLine;
  readonly cell: Element;
  readonly rowElement: HTMLTableRowElement;
}

/** The cell holding a line's code: the anchored cell itself (React), or the next one that holds code (classic number cells). */
function codeCellOf(cell: Element): Element | null {
  if (cell.querySelector(CODE) !== null) return cell;
  for (let next = cell.nextElementSibling; next !== null; next = next.nextElementSibling) {
    if (next.querySelector(CODE) !== null) return next;
  }
  return null;
}

function changeOf(code: Element): 'addition' | 'deletion' | null {
  const marker = code.querySelector('[data-code-marker]')?.getAttribute('data-code-marker');
  if (marker === '+') return 'addition';
  if (marker === '-') return 'deletion';
  for (const word of ['addition', 'deletion'] as const) {
    if (code.classList.contains(`blob-code-${word}`) || code.querySelector(`.diff-text.${word}`) !== null) return word;
  }
  return null;
}

const isHunk = (cell: Element): boolean => /\bhunk\b|-hunk\b|hunk-/.test(cell.className);

interface Found {
  readonly key: string;
  readonly side: 'L' | 'R';
  readonly number: number;
  readonly code: Element;
  readonly change: 'addition' | 'deletion' | null;
}

/**
 * The lines one row shows. The React view names both line numbers on each code cell (`data-diff-line-key`
 * `b:10-l:10-r:10`) and which half it is (`data-diff-side`), but anchors a context line by its new number on both
 * halves, so its keys are made here from those numbers: a context cell is both lines in unified view and its own
 * half's line in split view. The classic view's anchors (`id`, on the number cells) say the side truthfully.
 */
function rowLines(row: HTMLTableRowElement, anchor: string): readonly Found[] {
  const found: Found[] = [];
  const reactCells = [...row.querySelectorAll('[data-diff-line-key]')].filter((cell) => !isHunk(cell) && cell.querySelector(CODE) !== null);
  if (reactCells.length > 0) {
    const split = reactCells.length > 1;
    for (const code of reactCells) {
      const numbers = /l:(\d+)-r:(\d+)/.exec(code.getAttribute('data-diff-line-key') ?? '');
      if (numbers === null) continue;
      const change = changeOf(code);
      const half = code.getAttribute('data-diff-side');
      const sides: readonly ('L' | 'R')[] =
        change === 'deletion' ? ['L'] : change === 'addition' ? ['R'] : split ? [half === 'left' ? 'L' : 'R'] : ['L', 'R'];
      for (const side of sides) {
        const number = Number(side === 'L' ? numbers[1] : numbers[2]);
        found.push({ key: `${side}${number}`, side, number, code, change });
      }
    }
    return found;
  }
  for (const cell of row.querySelectorAll('[id]')) {
    if (!cell.id.startsWith(anchor) || isHunk(cell)) continue;
    const match = /^([LR])(\d+)$/.exec(cell.id.slice(anchor.length));
    const code = match === null ? null : codeCellOf(cell);
    if (match === null || code === null || isHunk(code)) continue;
    const side = match[1] === 'L' ? 'L' : 'R';
    found.push({ key: `${side}${match[2]}`, side, number: Number(match[2]), code, change: changeOf(code) });
  }
  return found;
}

/** Both sides of the file as rendered, each in line order, with the row each line sits in and its run of changes. */
function readSides(root: HTMLElement, anchor: string): { readonly old: ReadLine[]; readonly new: ReadLine[]; readonly signature: string } {
  const old = new Map<string, ReadLine>();
  const next = new Map<string, ReadLine>();
  let run = 0;
  let inChange = false;
  let row = 0;
  const keys: string[] = [];
  for (const rowElement of root.querySelectorAll<HTMLTableRowElement>('tr')) {
    if (rowElement.hasAttribute(OWN_UI_ATTRIBUTE)) continue;
    const found = rowLines(rowElement, anchor);
    if (found.length === 0) continue;
    const changed = found.some(({ change }) => change !== null);
    if (!changed || !inChange) run += 1;
    inChange = changed;
    for (const { key, side, number, code, change } of found) {
      const target = side === 'L' ? old : next;
      if (target.has(key)) continue;
      const text = code.querySelector(CODE)?.textContent ?? '';
      target.set(key, { line: { key, number, text, changed: change === (side === 'L' ? 'deletion' : 'addition'), row, run }, cell: code, rowElement });
      // The words and the markers too: an update can rewrite a line under the same key and the same file element.
      keys.push(`${key}\t${change ?? ''}\t${text}`);
    }
    row += 1;
  }
  const ordered = (lines: Map<string, ReadLine>): ReadLine[] => [...lines.values()].sort((a, b) => a.line.number - b.line.number);
  return { old: ordered(old), new: ordered(next), signature: keys.join('\n') };
}

interface Painted {
  readonly signature: string;
  readonly syntaxes: readonly TestSyntax[];
  /** The whole new file, when the page shows only part of it (`wholeFile`). */
  readonly file: readonly string[] | null;
  readonly folds: readonly TestFold[];
  readonly lines: ReadonlyMap<string, ReadLine>;
}

const painted = new WeakMap<HTMLElement, Painted>();

/**
 * Fold one test file (idempotent). `opened` holds the folds the reader opened on this page (`TestFold.id`, prefixed
 * with the file's anchor); they show their bodies and keep a toggle to fold again.
 */
export function applyTestFolds(root: HTMLElement, anchor: string, syntaxes: readonly TestSyntax[], opened: Set<string>, file: readonly string[] | null = null): void {
  const sides = readSides(root, anchor);
  const cached = painted.get(root);
  const folds =
    cached !== undefined && cached.signature === sides.signature && cached.syntaxes === syntaxes && cached.file === file
      ? cached.folds
      : outlineTestFolds({ old: sides.old.map((read) => read.line), new: sides.new.map((read) => read.line) }, syntaxes, file);
  // The cells and rows are this pass's: switching unified and split views replaces them under the same line keys.
  const lines = new Map<string, ReadLine>();
  for (const read of [...sides.old, ...sides.new]) lines.set(read.line.key, read);
  const state: Painted = { signature: sides.signature, syntaxes, file, folds, lines };
  painted.set(root, state);
  openLinkedFold(anchor, state, opened);
  paint(root, anchor, state, syntaxes, opened);
}

/** The location hash a fold was last opened for, so a fold the reader closes again is not reopened by the same link. */
let linkedHash = '';

/** The reader's opened folds were forgotten (settings changed): a link may open its fold again. */
export function forgetLinkedFold(): void {
  linkedHash = '';
}

/**
 * A link into a test's body (`#diff-<digest>R30`, or a range `…R30-R34`) opens the fold holding it, once per hash:
 * the browser cannot scroll to a row that is not displayed.
 */
function openLinkedFold(anchor: string, state: Painted, opened: Set<string>): void {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith(anchor) || hash === linkedHash) return;
  const keys = [...hash.slice(anchor.length).matchAll(/([LR])(\d+)/g)].map((match) => `${match[1]}${match[2]}`);
  // Every fold holding the line: a test inside a folded suite needs the suite and itself opened.
  const holding = state.folds.filter((candidate) => keys.some((key) => candidate.bodyKeys.includes(key) || candidate.headingKeys.includes(key)));
  if (holding.length === 0) return;
  linkedHash = hash;
  for (const fold of holding) opened.add(`${anchor}:${fold.id}`);
  // The browser gave up on a row that was not displayed when it looked: bring it into view once it is.
  const row = keys.map((key) => state.lines.get(key)?.rowElement).find((element) => element !== undefined);
  if (row !== undefined) window.requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
}

function paint(root: HTMLElement, anchor: string, state: Painted, syntaxes: readonly TestSyntax[], opened: Set<string>): void {
  const folded = new Set<string>();
  for (const fold of state.folds) if (!opened.has(`${anchor}:${fold.id}`)) for (const key of [...fold.headingKeys, ...fold.bodyKeys]) folded.add(key);

  // A row folds only when every line it shows is folded (a split row pairs two lines; a code line never goes with a test's).
  const rowKeys = new Map<HTMLTableRowElement, string[]>();
  for (const [key, read] of state.lines) rowKeys.set(read.rowElement, [...(rowKeys.get(read.rowElement) ?? []), key]);
  const hidden = new Set<HTMLTableRowElement>();
  for (const [row, keys] of rowKeys) if (keys.every((key) => folded.has(key))) hidden.add(row);
  // A test that runs across two hunks folds the edge between them too: its title row stands for the whole test.
  for (const fold of state.folds) {
    if (opened.has(`${anchor}:${fold.id}`)) continue;
    const rows = [...fold.headingKeys, ...fold.bodyKeys].map((key) => state.lines.get(key)).filter((read): read is ReadLine => read !== undefined);
    if (rows.length < 2) continue;
    const top = rows.reduce((first, read) => (read.line.row < first.line.row ? read : first)).rowElement;
    const bottom = rows.reduce((last, read) => (read.line.row > last.line.row ? read : last)).rowElement;
    for (let row = top.nextElementSibling; row !== null && row !== bottom; row = row.nextElementSibling) if (row instanceof HTMLTableRowElement && isHunkRow(row)) hidden.add(row);
  }
  // The note a comment-only run leaves before its first line (comment-rows.ts) goes with its lines when a test folds over them all.
  for (const note of root.querySelectorAll<HTMLTableRowElement>(`tr[${ATTR_LINE_NOTE}]`)) {
    const run: Element[] = [];
    for (let next = note.nextElementSibling; next !== null && (next.hasAttribute(ATTR_LINE) || next.hasAttribute(ATTR_TEST_ROW)); next = next.nextElementSibling) if (next.hasAttribute(ATTR_LINE)) run.push(next);
    if (run.length > 0 && run.every((line) => line instanceof HTMLTableRowElement && hidden.has(line))) hidden.add(note);
  }
  for (const row of root.querySelectorAll<HTMLTableRowElement>(`tr[${ATTR_TEST_FOLD}]`)) if (!hidden.has(row)) row.removeAttribute(ATTR_TEST_FOLD);
  for (const row of hidden) if (row.getAttribute(ATTR_TEST_FOLD) !== 'hidden') row.setAttribute(ATTR_TEST_FOLD, 'hidden');

  const kept = new Set<Element>();
  for (const fold of state.folds) {
    // The test's rows in the order they stand; its title row goes before the first of them.
    const reads = [...fold.headingKeys, ...fold.bodyKeys].map((key) => state.lines.get(key)).filter((read): read is ReadLine => read !== undefined);
    if (reads.length === 0 || fold.bodyKeys.length === 0) continue;
    // Before the first row that folds away with it (a row it shares with code on the other side stays where it is).
    const own = new Set([...fold.headingKeys, ...fold.bodyKeys]);
    const foldable = reads.filter((read) => rowKeys.get(read.rowElement)?.every((key) => own.has(key)) === true);
    const first = (foldable.length > 0 ? foldable : reads).reduce((top, read) => (read.line.row < top.line.row ? read : top));
    // Where it starts on its declaration's side: its new number for a test that stands, its old one for a removed test.
    const side: 'L' | 'R' = fold.headKey.charAt(0) === 'L' ? 'L' : 'R';
    const range = { side, start: fold.start };
    const id = `${anchor}:${fold.id}`;
    if (opened.has(id)) revealMissing(id, fold, state);
    else pressed.delete(id);
    // Above the note of a comment-only run that starts the test, so the note stays beside the lines it names.
    const note = first.rowElement.previousElementSibling;
    const at = note instanceof HTMLTableRowElement && note.hasAttribute(ATTR_LINE_NOTE) ? note : first.rowElement;
    const row = ensureTitleRow(at, id, fold, range, opened.has(id), () => {
      if (opened.has(id)) opened.delete(id);
      else opened.add(id);
      paint(root, anchor, state, syntaxes, opened);
    });
    kept.add(row);
  }
  for (const row of root.querySelectorAll(`[${ATTR_TEST_ROW}]`)) if (!kept.has(row)) row.remove();
  // Folded tests one after another share one border: the rows hidden between them are still siblings, so CSS's `+`
  // cannot tell, and the row says it here.
  for (const row of kept) {
    let previous = row.previousElementSibling;
    while (previous !== null && previous.getAttribute(ATTR_TEST_FOLD) === 'hidden') previous = previous.previousElementSibling;
    const joined = previous !== null && previous.hasAttribute(ATTR_TEST_ROW);
    if (row.hasAttribute('data-joined') !== joined) row.toggleAttribute('data-joined', joined);
  }
  scheduleAlign();
}

/** GitHub's controls that show the lines between and around a file's hunks: the React view's and the classic one's. */
const EXPANDER = 'button[data-direction], .js-expand, button[aria-label^="Expand" i]';

/** Whether a file's diff leaves some of the file out (it has a control to show more): only then is the whole file read. */
export function hasHiddenLines(root: ParentNode): boolean {
  return root.querySelector(`tr ${EXPANDER}`) !== null;
}

function isHunkRow(row: HTMLTableRowElement): boolean {
  return row.querySelector(EXPANDER) !== null || [...row.cells].some(isHunk);
}

function expanderIn(row: Element, directions: readonly string[]): HTMLElement | null {
  const controls = [...row.querySelectorAll<HTMLElement>(EXPANDER)];
  const directionOf = (control: Element): string | null =>
    control.getAttribute('data-direction')?.toLowerCase() ?? /\bexpand\b.*?\b(up|down|all)\b/i.exec(control.getAttribute('aria-label') ?? '')?.[1]?.toLowerCase() ?? null;
  for (const direction of directions) {
    const control = controls.find((candidate) => directionOf(candidate) === direction);
    if (control !== undefined) return control;
  }
  return null;
}

/** The hunk row next to `from` going one way, past Geld's own rows and the test's own: none when other code comes first. */
function hunkRowBeside(from: Element, step: 'previousElementSibling' | 'nextElementSibling', own: ReadonlySet<Element>): HTMLTableRowElement | null {
  for (let row = from[step]; row !== null; row = row[step]) {
    if (!(row instanceof HTMLTableRowElement) || row.hasAttribute(OWN_UI_ATTRIBUTE) || own.has(row)) continue;
    return isHunkRow(row) ? row : null;
  }
  return null;
}

/** An open fold's presses of GitHub's expanders: how many of its lines were missing then, when, and how many so far. */
const pressed = new Map<string, { readonly missing: number; readonly at: number; readonly presses: number }>();
const MAX_PRESSES = 24;
const PRESS_WAIT_MS = 1500;

/**
 * An open test the page shows only part of (`TestFold` keys with no line on the page): press GitHub's own control
 * that shows the lines it lacks, above, below or between its hunks, one press per pass until the whole test is
 * there. GitHub loads the lines; the pass their arrival brings reads them and presses again if some are still
 * missing. A press that brought nothing is tried again after a wait, and a fold presses at most `MAX_PRESSES` times.
 */
function revealMissing(id: string, fold: TestFold, state: Painted): void {
  const keys = [...fold.headingKeys, ...fold.bodyKeys];
  const missing = keys.filter((key) => key.startsWith('R') && !state.lines.has(key)).map((key) => Number(key.slice(1)));
  if (missing.length === 0) {
    pressed.delete(id);
    return;
  }
  const last = pressed.get(id);
  const now = Date.now();
  if (last !== undefined && (last.presses >= MAX_PRESSES || (last.missing === missing.length && now - last.at < PRESS_WAIT_MS))) return;
  const reads = keys.map((key) => state.lines.get(key)).filter((read): read is ReadLine => read !== undefined);
  const shown = reads.filter((read) => read.line.key.startsWith('R'));
  if (shown.length === 0) return;
  const own = new Set<Element>(reads.map((read) => read.rowElement));
  const low = shown.reduce((first, read) => (read.line.number < first.line.number ? read : first));
  const high = shown.reduce((end, read) => (read.line.number > end.line.number ? read : end));
  const gap = missing.find((number) => number > low.line.number && number < high.line.number);
  let control: HTMLElement | null = null;
  if (missing.some((number) => number < low.line.number)) {
    const row = hunkRowBeside(low.rowElement, 'previousElementSibling', own);
    control = row === null ? null : expanderIn(row, ['up', 'all']);
  } else if (gap !== undefined) {
    const before = shown.filter((read) => read.line.number < gap).reduce((end, read) => (read.line.number > end.line.number ? read : end));
    const row = hunkRowBeside(before.rowElement, 'nextElementSibling', own);
    control = row === null ? null : expanderIn(row, ['all', 'up', 'down']);
  } else {
    const row = hunkRowBeside(high.rowElement, 'nextElementSibling', own);
    control = row === null ? null : expanderIn(row, ['down', 'all']);
  }
  if (control === null) return;
  pressed.set(id, { missing: missing.length, at: now, presses: (last?.presses ?? 0) + 1 });
  control.click();
}

let alignFrame: number | null = null;

/** Lines the title rows' ranges up with GitHub's line numbers once per frame, after layout, never on the apply path. */
function scheduleAlign(): void {
  if (alignFrame !== null) return;
  alignFrame = window.requestAnimationFrame(() => {
    alignFrame = null;
    alignRanges();
  });
}

const NUMBER_CELL = ':scope > td.blob-num, :scope > td.diff-line-number, :scope > td.new-diff-line-number';

/** Where one side's line numbers stand in this table: a shown row of GitHub's with a number on that side, read once. */
interface NumberColumn {
  readonly left: number;
  readonly width: number;
  readonly align: string;
  readonly paddingLeft: number;
  readonly paddingRight: number;
  readonly ch: number;
  readonly font: string;
}

function numberColumn(body: Element, side: 'L' | 'R'): NumberColumn | null {
  for (const row of body.querySelectorAll<HTMLTableRowElement>(':scope > tr')) {
    if (row.hasAttribute(OWN_UI_ATTRIBUTE) || row.getAttribute(ATTR_TEST_FOLD) === 'hidden') continue;
    const cells = [...row.querySelectorAll<HTMLTableCellElement>(NUMBER_CELL)];
    if (cells.length < 2) continue;
    const cell = side === 'L' ? cells[0] : cells[cells.length - 1];
    // The classic view draws its numbers from `data-line-number` with a `::before`, so there may be no text to read.
    const text = cell?.textContent?.trim() || cell?.getAttribute('data-line-number') || '';
    if (cell === undefined || !/^\d+$/.test(text)) continue;
    const box = cell.getBoundingClientRect();
    if (box.width === 0) continue;
    const style = getComputedStyle(cell);
    const numbers = style.content === 'none' || style.content === 'normal' ? getComputedStyle(cell, '::before') : style;
    const font = `${numbers.fontWeight || style.fontWeight} ${numbers.fontSize || style.fontSize} ${numbers.fontFamily || style.fontFamily}`;
    const ch = digitWidth(font);
    if (ch === 0) continue;
    return { left: box.left, width: box.width, align: style.textAlign, paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight), ch, font };
  }
  return null;
}

let measure: CanvasRenderingContext2D | null = null;

/** One digit's width in `font` (tabular figures, so every digit is as wide). */
function digitWidth(font: string): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (measure === null) return 0;
  measure.font = font;
  return measure.measureText('0000000000').width / 10;
}

/**
 * Each title row's first number starts where a number of its width stands in GitHub's column above: centred in the
 * React view's cells, right-aligned in the classic view's, in GitHub's own font, so the row's number reads as the number
 * column carried on into the page.
 */
function alignRanges(): void {
  const columns = new Map<string, NumberColumn | null>();
  const bodies = new Map<Element, number>();
  // Every read first, then every write: a write between reads would make the next read lay the table out again.
  const writes: { readonly lines: HTMLElement; readonly offset: string; readonly font: string }[] = [];
  for (const row of document.querySelectorAll<HTMLTableRowElement>(`tr[${ATTR_TEST_ROW}]`)) {
    const body = row.parentElement;
    const lines = row.querySelector<HTMLElement>(`.${ROW_CLASS}__lines`);
    if (body === null || lines === null || row.getClientRects().length === 0) continue;
    const side = row.dataset.side === 'L' ? 'L' : 'R';
    if (!bodies.has(body)) bodies.set(body, bodies.size);
    const key = `${bodies.get(body) ?? 0}:${side}`;
    if (!columns.has(key)) columns.set(key, numberColumn(body, side));
    const column = columns.get(key);
    if (column === null || column === undefined) continue;
    const digits = (row.dataset.start ?? '').length;
    const width = digits * column.ch;
    const start =
      column.align === 'right' || column.align === 'end'
        ? column.left + column.width - column.paddingRight - width
        : column.align === 'left' || column.align === 'start'
          ? column.left + column.paddingLeft
          : column.left + (column.width - width) / 2;
    writes.push({ lines, offset: `${Math.max(0, Math.round((start - row.getBoundingClientRect().left) * 10) / 10)}px`, font: column.font });
  }
  for (const { lines, offset, font } of writes) {
    if (lines.style.marginLeft !== offset) lines.style.marginLeft = offset;
    if (lines.style.font !== font) lines.style.font = font;
  }
}

/** Each title row's current action: a row kept across passes (nothing in it changed) must act on the latest reading of the file. */
const rowActions = new WeakMap<Element, () => void>();

function ensureTitleRow(before: HTMLTableRowElement, id: string, fold: TestFold, range: { readonly side: 'L' | 'R'; readonly start: number }, open: boolean, onToggle: () => void): Element {
  const columns = [...before.cells].reduce((sum, cell) => sum + cell.colSpan, 0) || 1;
  const state = `${open}|${fold.kind}|${fold.status}|${range.side}${range.start}|${fold.additions}|${fold.deletions}|${fold.title}|${fold.previousTitle ?? ''}|${columns}`;
  const existing = before.parentElement?.querySelector(`tr[${ATTR_TEST_ROW}="${CSS.escape(id)}"]`);
  if (existing instanceof HTMLTableRowElement && existing.dataset.state === state) {
    rowActions.set(existing, onToggle);
    if (before.previousElementSibling !== existing) before.before(existing);
    return existing;
  }
  const span = String(range.start);
  const changes: Node[] = [];
  if (fold.additions > 0) changes.push(createElement('span', { class: `${ROW_CLASS}__add` }, [`+${formatCount(fold.additions)}`]));
  if (fold.deletions > 0) changes.push(createElement('span', { class: `${ROW_CLASS}__del` }, [`−${formatCount(fold.deletions)}`]));
  const title = fold.kind === 'hook' ? `${fold.title} hook` : fold.title;
  const changed = [fold.additions > 0 ? `${fold.additions} ${fold.additions === 1 ? 'line' : 'lines'} added` : '', fold.deletions > 0 ? `${fold.deletions} ${fold.deletions === 1 ? 'line' : 'lines'} removed` : ''].filter((part) => part !== '').join(', ');
  const word = fold.status === 'added' ? `new ${fold.kind}` : fold.status === 'removed' ? `removed ${fold.kind}` : fold.status === 'renamed' ? `renamed from ${fold.previousTitle ?? ''}` : '';
  const label = [`${open ? 'Hide' : 'Show'} ${title}`, `from line ${span}`, word, changed].filter((part) => part !== '').join(', ');
  const button = createElement('button', { type: 'button', class: `${ROW_CLASS}__toggle`, 'aria-expanded': String(open), 'aria-label': label, title: fold.previousTitle === undefined ? title : `${title} (was “${fold.previousTitle}”)` }, [
    createElement('span', { class: `${ROW_CLASS}__lines`, 'aria-hidden': 'true' }, [span]),
    createElement('span', { class: `${ROW_CLASS}__title`, 'data-kind': fold.kind, 'aria-hidden': 'true' }, [title]),
    createElement('span', { class: `${ROW_CLASS}__changes`, 'aria-hidden': 'true' }, changes),
    createElement('span', { class: `${ROW_CLASS}__chevron`, 'aria-hidden': 'true' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
  ]);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    rowActions.get(row)?.();
  });
  const row = createElement('tr', { class: ROW_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_TEST_ROW]: id, 'data-state': state, 'data-open': String(open), 'data-side': range.side, 'data-start': String(range.start) }, [
    createElement('td', { class: `${ROW_CLASS}__cell`, colspan: String(columns) }, [button]),
  ]);
  rowActions.set(row, onToggle);
  if (existing !== null && existing !== undefined) existing.remove();
  before.before(row);
  return row;
}

/** Undo everything in `root` (a file, or the document). */
export function clearTestFolds(root: ParentNode): void {
  for (const row of root.querySelectorAll(`[${ATTR_TEST_FOLD}]`)) row.removeAttribute(ATTR_TEST_FOLD);
  for (const row of root.querySelectorAll(`[${ATTR_TEST_ROW}]`)) row.remove();
}
