import type { OutlineLine, TestFold, TestSyntax } from '@geld/core';
import { formatCount, outlineTestFolds } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

/**
 * Test files read as their titles: every test's body folds under its
 * declaration row, with a toggle on that row that says how much is folded
 * and what changed in it ("12 lines · +3 −1", "new", "renamed"). Keyed on
 * GitHub's own line anchors (`diff-<digest>R30` / `L91`, `data-line-anchor`
 * in the React view, `id` in the classic one) like the comment-only rows, so
 * a re-render is simply re-applied. GitHub's nodes are never rewritten: rows
 * are hidden by attribute and the toggle stands beside the code, not in it.
 */

export const ATTR_TEST_FOLD = 'data-geld-test-fold';
const ATTR_TOGGLE = 'data-geld-test-toggle';
const TOGGLE_CLASS = 'geld-test-fold';
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
      keys.push(key);
    }
    row += 1;
  }
  const ordered = (lines: Map<string, ReadLine>): ReadLine[] => [...lines.values()].sort((a, b) => a.line.number - b.line.number);
  return { old: ordered(old), new: ordered(next), signature: keys.join(',') };
}

interface Painted {
  readonly signature: string;
  readonly syntaxes: readonly TestSyntax[];
  readonly folds: readonly TestFold[];
  readonly lines: ReadonlyMap<string, ReadLine>;
}

const painted = new WeakMap<HTMLElement, Painted>();

/**
 * Fold one test file (idempotent). `opened` holds the folds the reader opened on this page (`TestFold.id`, prefixed
 * with the file's anchor); they show their bodies and keep a toggle to fold again.
 */
export function applyTestFolds(root: HTMLElement, anchor: string, syntaxes: readonly TestSyntax[], opened: Set<string>): void {
  const sides = readSides(root, anchor);
  const cached = painted.get(root);
  const folds =
    cached !== undefined && cached.signature === sides.signature && cached.syntaxes === syntaxes
      ? cached.folds
      : outlineTestFolds({ old: sides.old.map((read) => read.line), new: sides.new.map((read) => read.line) }, syntaxes);
  // The cells and rows are this pass's: switching unified and split views replaces them under the same line keys.
  const lines = new Map<string, ReadLine>();
  for (const read of [...sides.old, ...sides.new]) lines.set(read.line.key, read);
  const state: Painted = { signature: sides.signature, syntaxes, folds, lines };
  painted.set(root, state);
  openLinkedFold(anchor, state, opened);
  paint(root, anchor, state, syntaxes, opened);
}

/** The location hash a fold was last opened for, so a fold the reader closes again is not reopened by the same link. */
let linkedHash = '';

/**
 * A link into a test's body (`#diff-<digest>R30`, or a range `…R30-R34`) opens the fold holding it, once per hash:
 * the browser cannot scroll to a row that is not displayed.
 */
function openLinkedFold(anchor: string, state: Painted, opened: Set<string>): void {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith(anchor) || hash === linkedHash) return;
  const keys = [...hash.slice(anchor.length).matchAll(/([LR])(\d+)/g)].map((match) => `${match[1]}${match[2]}`);
  const fold = state.folds.find((candidate) => keys.some((key) => candidate.bodyKeys.includes(key)));
  if (fold === undefined) return;
  linkedHash = hash;
  opened.add(`${anchor}:${fold.id}`);
  // The browser gave up on a row that was not displayed when it looked: bring it into view once it is.
  const row = keys.map((key) => state.lines.get(key)?.rowElement).find((element) => element !== undefined);
  if (row !== undefined) window.requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
}

function paint(root: HTMLElement, anchor: string, state: Painted, syntaxes: readonly TestSyntax[], opened: Set<string>): void {
  const folded = new Set<string>();
  for (const fold of state.folds) if (!opened.has(`${anchor}:${fold.id}`)) for (const key of fold.bodyKeys) folded.add(key);

  // A row folds only when every line it shows is folded (a split row pairs two lines; a code line never goes with a test's).
  const rowKeys = new Map<HTMLTableRowElement, string[]>();
  for (const [key, read] of state.lines) rowKeys.set(read.rowElement, [...(rowKeys.get(read.rowElement) ?? []), key]);
  const hidden = new Set<HTMLTableRowElement>();
  for (const [row, keys] of rowKeys) if (keys.every((key) => folded.has(key))) hidden.add(row);
  for (const row of root.querySelectorAll<HTMLTableRowElement>(`tr[${ATTR_TEST_FOLD}]`)) if (!hidden.has(row)) row.removeAttribute(ATTR_TEST_FOLD);
  for (const row of hidden) if (row.getAttribute(ATTR_TEST_FOLD) !== 'hidden') row.setAttribute(ATTR_TEST_FOLD, 'hidden');

  const toggles = new Set<Element>();
  for (const fold of state.folds) {
    const head = state.lines.get(fold.headKey);
    if (head === undefined) continue;
    const rows = new Set<HTMLTableRowElement>();
    for (const key of fold.bodyKeys) {
      const row = state.lines.get(key)?.rowElement;
      if (row !== undefined) rows.add(row);
    }
    if (rows.size === 0) continue;
    const id = `${anchor}:${fold.id}`;
    const open = opened.has(id);
    const toggle = ensureToggle(head.cell, id, fold, rows.size, open, () => {
      if (opened.has(id)) opened.delete(id);
      else opened.add(id);
      paint(root, anchor, state, syntaxes, opened);
    });
    toggles.add(toggle);
  }
  for (const toggle of root.querySelectorAll(`[${ATTR_TOGGLE}]`)) if (!toggles.has(toggle)) toggle.remove();
}

/** Each toggle's current action: a button kept across passes (its label unchanged) must act on the latest reading of the file. */
const toggleActions = new WeakMap<Element, () => void>();

const STATUS_WORD: Readonly<Record<TestFold['status'], string | null>> = { added: 'new', removed: 'removed', renamed: 'renamed', modified: null, unchanged: null };

function ensureToggle(cell: Element, id: string, fold: TestFold, rows: number, open: boolean, onToggle: () => void): Element {
  const existing = [...cell.children].find((child) => child.getAttribute(ATTR_TOGGLE) === id);
  const label = open ? 'Fold' : `${formatCount(rows)} ${rows === 1 ? 'line' : 'lines'}`;
  const state = `${open}|${label}|${fold.status}|${fold.additions}|${fold.deletions}`;
  if (existing instanceof HTMLElement && existing.dataset.state === state) {
    toggleActions.set(existing, onToggle);
    return existing;
  }
  const parts: Node[] = [createElement('span', { class: `${TOGGLE_CLASS}__chevron`, 'aria-hidden': 'true' }, [open ? '▾' : '▸']), createElement('span', { class: `${TOGGLE_CLASS}__label` }, [label])];
  if (!open && fold.additions > 0) parts.push(createElement('span', { class: `${TOGGLE_CLASS}__add` }, [`+${formatCount(fold.additions)}`]));
  if (!open && fold.deletions > 0) parts.push(createElement('span', { class: `${TOGGLE_CLASS}__del` }, [`−${formatCount(fold.deletions)}`]));
  const word = STATUS_WORD[fold.status];
  if (!open && word !== null) parts.push(createElement('span', { class: `${TOGGLE_CLASS}__status`, 'data-status': fold.status }, [word]));
  const title = fold.previousTitle === undefined ? fold.title : `${fold.title} (was “${fold.previousTitle}”)`;
  const button = createElement(
    'button',
    {
      type: 'button',
      class: TOGGLE_CLASS,
      [OWN_UI_ATTRIBUTE]: '',
      [ATTR_TOGGLE]: id,
      'data-state': state,
      'aria-expanded': String(open),
      'aria-label': open ? `Fold ${title}` : `Show ${title}: ${label}`,
      title: open ? 'Fold this test' : 'Show this test’s source',
    },
    parts,
  );
  toggleActions.set(button, onToggle);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleActions.get(button)?.();
  });
  if (existing !== undefined) existing.replaceWith(button);
  // First in the cell and floated right: after GitHub's code it would wrap under a long line in the React view.
  else cell.prepend(button);
  return button;
}

/** Undo everything in `root` (a file, or the document). */
export function clearTestFolds(root: ParentNode): void {
  for (const row of root.querySelectorAll(`[${ATTR_TEST_FOLD}]`)) row.removeAttribute(ATTR_TEST_FOLD);
  for (const toggle of root.querySelectorAll(`[${ATTR_TOGGLE}]`)) toggle.remove();
}
