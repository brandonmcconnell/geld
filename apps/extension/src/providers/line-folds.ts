import type { FileStats, GeldSettings, OutlineLine, TestFold } from '@geld/core';
import { CATEGORY_IDS, createMatcher, describeRepository, formatCount, outlineTestFolds, testSyntaxesFrom } from '@geld/core';
import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView } from './types';
import './line-folds.css';

export const PROVIDER_LINE_FOLDS_CHANGED = 'geld:provider-line-folds-changed';
export const ATTR_PROVIDER_LINE_HIDDEN = 'data-geld-provider-line-hidden';
export const ATTR_PROVIDER_FOLD_ROW = 'data-geld-provider-fold-row';

interface ReadLine {
  readonly line: OutlineLine;
  readonly root: HTMLElement;
}

interface ReadRow {
  readonly root: HTMLElement;
  readonly keys: ReadonlySet<string>;
  readonly changed: ReadonlySet<string>;
  readonly opaque: boolean;
  readonly hunk: boolean;
}

interface Reading {
  readonly old: readonly OutlineLine[];
  readonly new: readonly OutlineLine[];
  readonly lines: ReadonlyMap<string, ReadLine>;
  readonly rows: readonly ReadRow[];
  readonly signature: string;
}

interface Visit {
  readonly opened: Set<string>;
  readonly shown: Set<string>;
  linkedHash: string;
}

interface FoldRow {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  action: () => void;
}

interface Painted {
  readonly root: HTMLElement;
  readonly visit: Visit;
  readonly managed: Set<HTMLElement>;
  readonly notes: Map<string, FoldRow>;
  signature: string;
  folds: readonly TestFold[];
}

interface CommentRun {
  readonly key: string;
  readonly rows: readonly ReadRow[];
  readonly count: number;
}

const painted = new Map<HTMLElement, Painted>();
const visits = new Map<string, Visit>();

function setAttribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function rowRoot(line: ProviderDiffLine): HTMLElement {
  return line.root.closest('tr') ?? line.root;
}

function readLines(entry: ProviderDiffEntry): Reading {
  const rows = new Map<HTMLElement, { keys: Set<string>; changed: Set<string>; opaque: boolean; hunk: boolean; index: number }>();
  const lines = new Map<string, ReadLine>();
  let run = 0;
  let changing = false;
  const signature: string[] = [];
  for (const shown of entry.readLines?.() ?? []) {
    const root = rowRoot(shown);
    if (!entry.root.contains(root) || root.hasAttribute('data-geld-ui')) continue;
    let row = rows.get(root);
    if (row === undefined) {
      row = { keys: new Set(), changed: new Set(), opaque: false, hunk: shown.kind === 'hunk', index: rows.size };
      rows.set(root, row);
    }
    if (shown.kind === 'hunk') {
      row.hunk = true;
      changing = false;
      continue;
    }
    const replaced = shown.oldText !== null && shown.newText !== null && shown.oldText !== shown.newText;
    const changed = replaced || shown.kind === 'added' || shown.kind === 'removed';
    if (!changed || !changing) run += 1;
    changing = changed;
    const side = (prefix: 'L' | 'R', number: number | null, text: string | null, isChanged: boolean): void => {
      if (number === null && text === null) return;
      if (number === null || text === null || !Number.isSafeInteger(number) || number <= 0) {
        row.opaque = true;
        return;
      }
      const key = `${prefix}${number}`;
      row.keys.add(key);
      if (isChanged) row.changed.add(key);
      const found = lines.get(key);
      if (found === undefined) lines.set(key, { root, line: { key, number, text, changed: isChanged, row: row.index, run } });
      else if (found.line.text !== text || found.line.changed !== isChanged) row.opaque = true;
      signature.push(`${row.index}:${key}:${isChanged}:${text}`);
    };
    side('L', shown.oldLine, shown.oldText, replaced || shown.kind === 'removed');
    side('R', shown.newLine, shown.newText, replaced || shown.kind === 'added');
  }
  const bySide = (side: string): OutlineLine[] => [...lines.values()].filter((read) => read.line.key.startsWith(side)).map((read) => read.line).sort((a, b) => a.number - b.number);
  return {
    old: bySide('L'), new: bySide('R'), lines,
    rows: [...rows].map(([root, row]) => ({ root, keys: row.keys, changed: row.changed, opaque: row.opaque, hunk: row.hunk })),
    signature: signature.join('\n'),
  };
}

function adjacent(before: HTMLElement, after: HTMLElement): boolean {
  if (before.parentElement !== after.parentElement) return false;
  let next = before.nextElementSibling;
  while (next?.hasAttribute('data-geld-ui') === true) next = next.nextElementSibling;
  return next === after;
}

function commentRuns(reading: Reading, facts: FileStats, enabled: boolean): readonly CommentRun[] {
  if (!enabled || facts.commentLines === undefined) return [];
  const wanted = new Set([...facts.commentLines.added.map((line) => `R${line}`), ...facts.commentLines.removed.map((line) => `L${line}`)]);
  const runs: CommentRun[] = [];
  let run: ReadRow[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first === undefined) return;
    const keys = new Set(run.flatMap((row) => [...row.keys]));
    runs.push({ key: `comments:${[...keys].join(',')}`, rows: run, count: keys.size });
    run = [];
  };
  for (const row of reading.rows) {
    const eligible = !row.opaque && !row.hunk && row.keys.size > 0 && [...row.keys].every((key) => wanted.has(key) && row.changed.has(key));
    if (!eligible) { flush(); continue; }
    const previous = run[run.length - 1];
    if (previous !== undefined && !adjacent(previous.root, row.root)) flush();
    run.push(row);
  }
  flush();
  return runs;
}

function ownNode<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute('data-geld-ui', '');
  node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function ensureFoldRow(state: Painted, key: string, before: HTMLElement, action: () => void): FoldRow {
  let note = state.notes.get(key);
  if (note !== undefined && note.root.parentElement !== before.parentElement) { note.root.remove(); state.notes.delete(key); note = undefined; }
  if (note === undefined) {
    const button = ownNode('button', 'geld-provider-line-fold__toggle');
    button.type = 'button';
    const root = before instanceof HTMLTableRowElement ? ownNode('tr', 'geld-provider-line-fold') : ownNode(before.tagName === 'LI' ? 'li' : 'div', 'geld-provider-line-fold');
    root.setAttribute(ATTR_PROVIDER_FOLD_ROW, key);
    if (root instanceof HTMLTableRowElement && before instanceof HTMLTableRowElement) {
      const cell = ownNode('td', 'geld-provider-line-fold__cell');
      cell.colSpan = [...before.cells].reduce((sum, current) => sum + current.colSpan, 0) || 1;
      cell.append(button);
      root.append(cell);
    } else root.append(button);
    const created: FoldRow = { root, button, action };
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.root.isConnected) created.action();
    });
    note = created;
    state.notes.set(key, note);
  }
  note.action = action;
  if (before.previousElementSibling !== note.root) before.before(note.root);
  return note;
}

function span(className: string, text: string): HTMLElement {
  return ownNode('span', `geld-provider-line-fold__${className}`, text);
}

function testRow(note: FoldRow, fold: TestFold, open: boolean, partial: boolean): void {
  const title = fold.kind === 'hook' ? `${fold.title} hook` : fold.title;
  const status = fold.status === 'unchanged' ? '' : fold.status;
  const additions = fold.additions > 0 ? `+${formatCount(fold.additions)}` : '';
  const deletions = fold.deletions > 0 ? `−${formatCount(fold.deletions)}` : '';
  const counts = [additions, deletions].filter(Boolean).join(' ');
  const label = [`${open ? 'Hide' : 'Show'} ${title}`, `from line ${fold.start}`, status, counts, partial ? 'Only displayed lines are available' : ''].filter(Boolean).join(', ');
  const signature = JSON.stringify([label, fold.previousTitle]);
  note.button.setAttribute('aria-expanded', String(open));
  note.root.dataset.kind = fold.kind;
  note.root.dataset.status = fold.status;
  if (note.button.dataset.signature === signature) return;
  note.button.dataset.signature = signature;
  note.button.setAttribute('aria-label', label);
  note.button.title = fold.previousTitle === undefined ? title : `${title} (was ${fold.previousTitle})`;
  const name = span('title', title);
  const changes = span('changes', counts);
  const pieces = [span('line', String(fold.start)), name];
  if (status !== '') pieces.push(span('status', status));
  if (partial) pieces.push(span('partial', 'shown lines'));
  pieces.push(changes, span('chevron', open ? '▾' : '▸'));
  note.button.replaceChildren(...pieces);
}

function isPartial(fold: TestFold, reading: Reading): boolean {
  const side = fold.headKey.startsWith('L') ? reading.old : reading.new;
  const keys = new Set([...fold.headingKeys, ...fold.bodyKeys]);
  const last = side.findLastIndex((line) => keys.has(line.key));
  const end = side[last];
  const after = side[last + 1];
  if (end === undefined) return true;
  if (after !== undefined && after.number !== end.number + 1) return true;
  const root = reading.lines.get(end.key)?.root;
  const index = reading.rows.findIndex((row) => row.root === root);
  return index >= 0 && reading.rows[index + 1]?.hunk === true;
}

function followHash(state: Painted, reading: Reading, runs: readonly CommentRun[]): void {
  const hash = window.location.hash;
  if (hash === '' || hash === state.visit.linkedHash) return;
  let anchor: string;
  try { anchor = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(anchor);
  if (target === null || !state.root.contains(target)) return;
  const row = reading.rows.find((entry) => entry.root === target || entry.root.contains(target));
  if (row === undefined) return;
  state.visit.linkedHash = hash;
  for (const fold of state.folds) if ([...fold.headingKeys, ...fold.bodyKeys].some((key) => row.keys.has(key))) state.visit.opened.add(fold.id);
  for (const run of runs) if (run.rows.includes(row)) state.visit.shown.add(run.key);
}

function paint(state: Painted, reading: Reading, runs: readonly CommentRun[]): { hiddenAdditions: number; hiddenDeletions: number } {
  const folded = new Set(state.folds.filter((fold) => !state.visit.opened.has(fold.id)).flatMap((fold) => [...fold.headingKeys, ...fold.bodyKeys]));
  const tests = new Set(reading.rows.filter((row) => !row.opaque && !row.hunk && row.keys.size > 0 && [...row.keys].every((key) => folded.has(key))).map((row) => row.root));
  const comments = new Set(runs.filter((run) => !state.visit.shown.has(run.key)).flatMap((run) => run.rows.map((row) => row.root)));
  const hidden = new Set([...tests, ...comments]);
  for (const row of state.managed) if (!hidden.has(row)) { setAttribute(row, ATTR_PROVIDER_LINE_HIDDEN, null); state.managed.delete(row); }
  for (const row of hidden) { setAttribute(row, ATTR_PROVIDER_LINE_HIDDEN, ''); state.managed.add(row); }
  const kept = new Set<string>();
  const repaint = (): void => { paint(state, reading, runs); document.dispatchEvent(new CustomEvent(PROVIDER_LINE_FOLDS_CHANGED)); };
  for (const run of runs) {
    const first = run.rows[0];
    if (first === undefined) continue;
    const open = state.visit.shown.has(run.key);
    const note = ensureFoldRow(state, run.key, first.root, () => {
      if (state.visit.shown.has(run.key)) state.visit.shown.delete(run.key);
      else state.visit.shown.add(run.key);
      repaint();
    });
    kept.add(run.key);
    const label = `${formatCount(run.count)} comment-only ${run.count === 1 ? 'line' : 'lines'}${open ? '' : ' hidden'} · ${open ? 'Hide' : 'Show'}`;
    if (note.button.textContent !== label) note.button.textContent = label;
    note.button.setAttribute('aria-expanded', String(open));
    setAttribute(note.root, ATTR_PROVIDER_LINE_HIDDEN, run.rows.every((row) => tests.has(row.root)) ? '' : null);
  }
  const byRoot = new Map(reading.rows.map((row) => [row.root, row]));
  for (const fold of state.folds) {
    const keys = new Set([...fold.headingKeys, ...fold.bodyKeys]);
    if (fold.bodyKeys.length === 0) continue;
    const reads = reading.rows.filter((row) => !row.opaque && !row.hunk && row.keys.size > 0 && [...row.keys].every((key) => keys.has(key)));
    const first = reads[0];
    if (first === undefined) continue;
    const previous = first.root.previousElementSibling;
    const at = previous instanceof HTMLElement && previous.hasAttribute(ATTR_PROVIDER_FOLD_ROW) && previous.getAttribute(ATTR_PROVIDER_FOLD_ROW)?.startsWith('comments:') === true ? previous : first.root;
    const note = ensureFoldRow(state, `test:${fold.id}`, at, () => {
      if (state.visit.opened.has(fold.id)) state.visit.opened.delete(fold.id);
      else state.visit.opened.add(fold.id);
      repaint();
    });
    kept.add(`test:${fold.id}`);
    testRow(note, fold, state.visit.opened.has(fold.id), isPartial(fold, reading));
  }
  for (const [key, note] of state.notes) if (!kept.has(key)) { note.root.remove(); state.notes.delete(key); }
  const counted = new Set<string>();
  for (const root of comments) for (const key of byRoot.get(root)?.changed ?? []) counted.add(key);
  return {
    hiddenAdditions: [...counted].filter((key) => key.startsWith('R')).length,
    hiddenDeletions: [...counted].filter((key) => key.startsWith('L')).length,
  };
}

function clearPainted(state: Painted): void {
  for (const row of state.managed) setAttribute(row, ATTR_PROVIDER_LINE_HIDDEN, null);
  for (const note of state.notes.values()) note.root.remove();
  state.notes.clear();
  state.managed.clear();
}

export function applyProviderLineFolds(view: ProviderDiffView, files: readonly FileStats[], settings: GeldSettings): { hiddenAdditions: number; hiddenDeletions: number } {
  if (!settings.enabled || (!settings.hideCommentLines && !settings.testOutline)) { clearProviderLineFolds(); return { hiddenAdditions: 0, hiddenDeletions: 0 }; }
  const facts = new Map(files.map((file) => [file.path, file]));
  const categories = Object.fromEntries(CATEGORY_IDS.map((id) => [id, id === 'tests']));
  const matcher = settings.testOutline ? createMatcher({ ...settings, categories, customCategories: [], hideLargeDiffs: false }, describeRepository(window.location.href)?.path ?? null) : null;
  const syntaxes = testSyntaxesFrom(settings.testSyntaxes);
  const active = new Set<HTMLElement>();
  let hiddenAdditions = 0;
  let hiddenDeletions = 0;
  for (const entry of view.entries) {
    const file = facts.get(entry.path);
    if (file === undefined || entry.readLines === undefined || view.filteredPaths.has(entry.path)) continue;
    active.add(entry.root);
    const visitKey = `${window.location.origin}${window.location.pathname}:${entry.path}`;
    let visit = visits.get(visitKey);
    if (visit === undefined) { visit = { opened: new Set(), shown: new Set(), linkedHash: '' }; visits.set(visitKey, visit); }
    let state = painted.get(entry.root);
    if (state === undefined || state.visit !== visit) {
      if (state !== undefined) clearPainted(state);
      state = { root: entry.root, visit, managed: new Set(), notes: new Map(), signature: '', folds: [] };
      painted.set(entry.root, state);
    }
    const reading = readLines(entry);
    const outline = matcher?.categorize(entry.path)?.id === 'tests';
    const signature = JSON.stringify([reading.signature, outline, settings.testSyntaxes]);
    if (state.signature !== signature) {
      state.signature = signature;
      state.folds = outline ? outlineTestFolds(reading, syntaxes) : [];
    }
    const runs = commentRuns(reading, file, settings.hideCommentLines);
    followHash(state, reading, runs);
    const counts = paint(state, reading, runs);
    hiddenAdditions += counts.hiddenAdditions;
    hiddenDeletions += counts.hiddenDeletions;
  }
  for (const [root, state] of painted) if (!active.has(root)) { clearPainted(state); painted.delete(root); }
  return { hiddenAdditions, hiddenDeletions };
}

export function clearProviderLineFolds(): void {
  for (const state of painted.values()) clearPainted(state);
  painted.clear();
  visits.clear();
}
