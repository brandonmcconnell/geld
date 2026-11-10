import type { FileStats, GeldSettings, OutlineLine, TestFold } from '@geld/core';
import { CATEGORY_IDS, createMatcher, describeRepository, formatCount, outlineTestFolds, providerRepositoryScope, testSyntaxesFrom } from '@geld/core';
import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView } from './types';
import type { ProviderOutlineContext } from './source-facts';
import './line-folds.css';
import type { ProviderWholeTestSession } from './whole-test-context';

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
  linkedWhole: number | null;
  suppressedHash: string | null;
}

interface FoldRow {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  action: (trusted: boolean) => void;
}

interface Painted {
  readonly root: HTMLElement;
  readonly visit: Visit;
  readonly managed: Set<HTMLElement>;
  readonly notes: Map<string, FoldRow>;
  signature: string;
  folds: readonly TestFold[];
  linkedFrame: number | null;
  entry: ProviderDiffEntry;
  whole: ProviderWholeTestSession | undefined;
  wholeToken: number | null;
  focus: { readonly key: string; readonly button: HTMLButtonElement } | null;
}

interface CommentRun {
  readonly key: string;
  readonly rows: readonly ReadRow[];
  readonly count: number;
}

const painted = new Map<HTMLElement, Painted>();
let focusDocument: Document | null = null;
const clearPendingFocus = (event: Event): void => { if (event.isTrusted) for (const state of painted.values()) state.focus = null; };
function observeOutlineFocus(): void {
  if (focusDocument !== null) return;focusDocument = document;
  focusDocument.addEventListener('pointerdown', clearPendingFocus, true);focusDocument.addEventListener('keydown', clearPendingFocus, true);
}
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
      signature.push(`${row.index}:hunk`);
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

function hasStatePreservingMove(parent: HTMLElement): parent is HTMLElement & { moveBefore(node: Node, before: Node | null): void } {
  return 'moveBefore' in parent && typeof parent.moveBefore === 'function';
}

function ensureFoldRow(state: Painted, key: string, before: HTMLElement, action: (trusted: boolean) => void): FoldRow {
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
      if (painted.get(state.root) === state && state.notes.get(key) === created && button.isConnected && root.contains(button) && state.root.contains(root)) created.action(event.isTrusted === true);
    });
    note = created;
    state.notes.set(key, note);
  }
  note.action = action;
  if (before.previousElementSibling !== note.root) {
    const parent = before.parentElement;
    const moveDocument = document, moveURL = moveDocument.URL;
    const focused = moveDocument.activeElement === note.button;
    let ordinaryMove = false;
    if (note.root.isConnected && parent !== null && note.root.parentElement === parent && hasStatePreservingMove(parent)) {
      try { parent.moveBefore(note.root, before); }
      catch { if (before.previousElementSibling !== note.root) { ordinaryMove = true;before.before(note.root); } }
    } else { ordinaryMove = true;before.before(note.root); }
    // Ordinary connected DOM moves can blur a button. Preserve only focus held immediately before our own move.
    if (ordinaryMove && focused && document === moveDocument && moveDocument.URL === moveURL && state.root.ownerDocument === moveDocument
      && moveDocument.activeElement === moveDocument.body && painted.get(state.root) === state && state.notes.get(key) === note
      && note.button.isConnected && note.root.contains(note.button) && state.root.contains(note.root)
      && note.root.parentElement === parent && before.parentElement === parent && before.previousElementSibling === note.root) note.button.focus({ preventScroll: true });
  }
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
  if ([...fold.headingKeys, ...fold.bodyKeys].some((key) => key.startsWith('R') && !reading.lines.has(key))) return true;
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
  const sameHash = hash === state.visit.linkedHash;
  if (sameHash && state.wholeToken === state.visit.linkedWhole) return;
  if (!sameHash) state.visit.suppressedHash = null;
  cancelLinkedScroll(state);
  if (hash === '') { state.visit.linkedHash = '';state.visit.linkedWhole = state.wholeToken;return; }
  let anchor: string;
  try { anchor = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(anchor);
  if (target === null || !state.root.contains(target)) { state.visit.linkedHash = '';state.visit.linkedWhole = null;return; }
  const row = reading.rows.find((entry) => entry.root === target || entry.root.contains(target));
  if (row === undefined) return;
  state.visit.linkedHash = hash;state.visit.linkedWhole = state.wholeToken;
  if (state.visit.suppressedHash === hash) return;
  let revealed = false;
  for (const fold of state.folds) if ([...fold.headingKeys, ...fold.bodyKeys].some((key) => row.keys.has(key))) {
    if (!state.visit.opened.has(fold.id)) revealed = true;
    state.visit.opened.add(fold.id);
  }
  for (const run of runs) if (!sameHash && run.rows.includes(row)) {
    if (!state.visit.shown.has(run.key)) revealed = true;
    state.visit.shown.add(run.key);
  }
  if (!revealed) return;
  const href = window.location.href;
  const signature = state.signature;
  // The browser could not land on a folded row; retry once after this pass releases it.
  state.linkedFrame = window.requestAnimationFrame(() => {
    state.linkedFrame = null;
    if (window.location.href !== href || state.visit.linkedHash !== hash || painted.get(state.root) !== state || state.signature !== signature) return;
    if (!state.root.isConnected || !row.root.isConnected || !state.root.contains(row.root) || document.getElementById(anchor) !== target || !row.root.contains(target)) return;
    if (row.root.closest(`[${ATTR_PROVIDER_LINE_HIDDEN}], [hidden], [aria-hidden="true"], [inert]`) !== null) return;
    row.root.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
}

function cancelLinkedScroll(state: Painted): void {
  if (state.linkedFrame !== null) window.cancelAnimationFrame(state.linkedFrame);
  state.linkedFrame = null;
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
    const note = ensureFoldRow(state, `test:${fold.id}`, at, (trusted) => {
      const opening = !state.visit.opened.has(fold.id);
      if (opening) { state.visit.opened.add(fold.id);state.visit.suppressedHash = null; }
      else {
        state.visit.opened.delete(fold.id);state.whole?.cancelReveal(state.entry);
        try {
          const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
          const row = target === null ? undefined : reading.rows.find((item) => item.root === target || item.root.contains(target));
          if (row !== undefined && [...row.keys].some((key) => keys.has(key))) state.visit.suppressedHash = window.location.hash;
        } catch { /* A malformed source fragment supplies no reveal intent. */ }
      }
      repaint();
      if (opening && trusted && document.activeElement === note.button) state.focus = { key: `test:${fold.id}`, button: note.button };
      if (!opening) state.focus = null;
      if (opening && trusted) state.whole?.reveal(state.entry, fold, () => painted.get(state.root) === state && state.visit.opened.has(fold.id));
    });
    kept.add(`test:${fold.id}`);
    testRow(note, fold, state.visit.opened.has(fold.id), isPartial(fold, reading));
  }
  for (const [key, note] of state.notes) if (!kept.has(key)) { note.root.remove(); state.notes.delete(key); }
  const pending = state.focus;
  if (pending !== null && state.wholeToken !== null) {
    const replacement = state.notes.get(pending.key)?.button;
    if (replacement === undefined || document.activeElement !== document.body && document.activeElement !== pending.button) state.focus = null;
    else if (!pending.button.isConnected && replacement.isConnected && state.root.contains(replacement)) {
      replacement.focus({ preventScroll: true });state.focus = { key: pending.key, button: replacement };
    }
  }
  const counted = new Set<string>();
  for (const root of comments) for (const key of byRoot.get(root)?.changed ?? []) counted.add(key);
  return {
    hiddenAdditions: [...counted].filter((key) => key.startsWith('R')).length,
    hiddenDeletions: [...counted].filter((key) => key.startsWith('L')).length,
  };
}

function clearPainted(state: Painted): void {
  cancelLinkedScroll(state);
  for (const row of state.managed) setAttribute(row, ATTR_PROVIDER_LINE_HIDDEN, null);
  for (const note of state.notes.values()) note.root.remove();
  state.notes.clear();
  state.managed.clear();
}

export function applyProviderLineFolds(view: ProviderDiffView, files: readonly FileStats[], settings: GeldSettings, context?: ProviderOutlineContext, whole?: ProviderWholeTestSession): { hiddenAdditions: number; hiddenDeletions: number } {
  if (!settings.enabled || (!settings.hideCommentLines && !settings.testOutline)) { whole?.retain(new Set());clearProviderLineFolds(); return { hiddenAdditions: 0, hiddenDeletions: 0 }; }
  if (whole !== undefined) observeOutlineFocus();
  const facts = new Map(files.map((file) => [file.path, file]));
  const categories = Object.fromEntries(CATEGORY_IDS.map((id) => [id, id === 'tests']));
  const repository = describeRepository(window.location.href);
  const scope = repository === null ? null : providerRepositoryScope(repository);
  const matcher = settings.testOutline ? createMatcher({ ...settings, categories, customCategories: [], hideLargeDiffs: false }, scope) : null;
  const syntaxes = testSyntaxesFrom(settings.testSyntaxes);
  const active = new Set<HTMLElement>();
  const wholeRoots = new Set<HTMLElement>();
  let hiddenAdditions = 0;
  let hiddenDeletions = 0;
  for (const entry of view.entries) {
    const file = facts.get(entry.path);
    if (file === undefined || entry.readLines === undefined || view.filteredPaths.has(entry.path)) continue;
    active.add(entry.root);
    const visitKey = JSON.stringify([context?.subjectKey ?? `${window.location.origin}${window.location.pathname}`, entry.path]);
    let visit = visits.get(visitKey);
    if (visit === undefined) { visit = { opened: new Set(), shown: new Set(), linkedHash: '', linkedWhole: null, suppressedHash: null }; visits.set(visitKey, visit); }
    let state = painted.get(entry.root);
    if (state === undefined || state.visit !== visit) {
      if (state !== undefined) clearPainted(state);
      state = { root: entry.root, visit, managed: new Set(), notes: new Map(), signature: '', folds: [], linkedFrame: null, entry, whole, wholeToken: null, focus: null };
      painted.set(entry.root, state);
    }
    state.entry = entry;state.whole = whole;
    const reading = readLines(entry);
    const outline = matcher?.categorize(entry.path)?.id === 'tests';
    if (outline) { wholeRoots.add(entry.root);whole?.mount(entry); }
    const full = outline ? whole?.source(entry) ?? null : null;state.wholeToken = full?.token ?? null;
    const signature = JSON.stringify([reading.signature, outline, settings.testSyntaxes, context?.newSources.get(entry.root)?.key ?? null, full?.token ?? null]);
    if (state.signature !== signature) {
      state.signature = signature;
      state.folds = outline ? outlineTestFolds(reading, syntaxes, full?.lines ?? null) : [];
    }
    const runs = commentRuns(reading, file, settings.hideCommentLines && context?.commentCoordinateMismatches?.has(entry.root) !== true);
    followHash(state, reading, runs);
    const counts = paint(state, reading, runs);
    hiddenAdditions += counts.hiddenAdditions;
    hiddenDeletions += counts.hiddenDeletions;
  }
  whole?.retain(wholeRoots);
  for (const [root, state] of painted) if (!active.has(root)) { clearPainted(state); painted.delete(root); }
  return { hiddenAdditions, hiddenDeletions };
}

export function clearProviderLineFolds(): void {
  for (const state of painted.values()) clearPainted(state);
  painted.clear();
  visits.clear();
  focusDocument?.removeEventListener('pointerdown', clearPendingFocus, true);focusDocument?.removeEventListener('keydown', clearPendingFocus, true);focusDocument = null;
}
