// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { FileStats, GeldSettings } from '@geld/core';
import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView } from './types';
import { applyProviderLineFolds, ATTR_PROVIDER_FOLD_ROW, ATTR_PROVIDER_LINE_HIDDEN, clearProviderLineFolds, PROVIDER_LINE_FOLDS_CHANGED } from './line-folds';

interface Line {
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly oldText: string | null;
  readonly newText: string | null;
  readonly kind: ProviderDiffLine['kind'];
}

function added(newLine: number, newText: string): Line { return { oldLine: null, oldText: null, newLine, newText, kind: 'added' }; }
function context(line: number, text: string): Line { return { oldLine: line, newLine: line, oldText: text, newText: text, kind: 'context' }; }
function pair(line: number, oldText: string, newText: string): Line { return { oldLine: line, newLine: line, oldText, newText, kind: 'context' }; }

function fixture(source: readonly Line[], path = 'src/cache.test.ts', commentLines?: FileStats['commentLines']) {
  const root = document.createElement('section');
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  table.append(body);
  root.append(table);
  const lines: ProviderDiffLine[] = [];
  for (const [index, line] of source.entries()) {
    const row = document.createElement('tr');
    row.id = `native-line-${index}`;
    for (const text of [String(line.oldLine ?? ''), line.oldText ?? '', String(line.newLine ?? ''), line.newText ?? '']) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
    lines.push({ ...line, root: row });
  }
  document.body.append(root);
  const entry: ProviderDiffEntry = { path, root, anchor: null, additions: null, deletions: null, readLines: () => lines, expand: () => true, collapse: () => true };
  const view: ProviderDiffView = { kind: 'gitlab-rapid', container: root, entries: [entry], tree: [], treeHost: null, filteredPaths: new Set(), virtualized: false };
  const stats: FileStats = {
    path,
    additions: lines.filter((line) => line.kind === 'added' || (line.oldText !== null && line.newText !== null && line.oldText !== line.newText)).length,
    deletions: lines.filter((line) => line.kind === 'removed' || (line.oldText !== null && line.newText !== null && line.oldText !== line.newText)).length,
    ...(commentLines === undefined ? {} : { commentLines }),
  };
  return { root, lines, entry, view, stats };
}

function settings(overrides: Partial<GeldSettings> = {}): GeldSettings { return { ...DEFAULT_SETTINGS, ...overrides }; }
function hidden(root: HTMLElement): boolean { return root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN); }
function testButtons(root: HTMLElement): HTMLButtonElement[] { return [...root.querySelectorAll<HTMLButtonElement>(`[${ATTR_PROVIDER_FOLD_ROW}^="test:"] button`)]; }
function commentButton(root: HTMLElement): HTMLButtonElement | null { return root.querySelector<HTMLButtonElement>(`[${ATTR_PROVIDER_FOLD_ROW}^="comments:"] button`); }

afterEach(() => { clearProviderLineFolds(); document.body.replaceChildren(); window.location.hash = ''; vi.restoreAllMocks(); });

function frames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++sequence;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
  const flush = (): void => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(0);
  };
  return { request, cancel, flush };
}

function linkedFixture() {
  const file = fixture(["it('linked source', () => {", '  expect(value).toBe(1);', '});'].map((text, index) => added(index + 1, text)));
  const row = file.lines[1]?.root;
  if (row === undefined) throw new Error('Expected linked native row.');
  applyProviderLineFolds(file.view, [file.stats], settings());
  return { ...file, row };
}

describe('linked fold landing', () => {
  it('centers the original hidden row once on the next frame after opening its fold', () => {
    const { request, flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    expect(hidden(file.row)).toBe(true);
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(hidden(file.row)).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(request).toHaveBeenCalledOnce();
    flush();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'auto' });
    applyProviderLineFolds(file.view, [file.stats], settings());
    flush();
    expect(scroll).toHaveBeenCalledOnce();
  });

  it.each(['hash', 'comparison'] as const)('does not move the reader after the requested %s changed before the frame', (change) => {
    const previous = window.location.href;
    try {
      const { flush } = frames();
      const file = linkedFixture();
      const scroll = vi.spyOn(file.row, 'scrollIntoView');
      window.location.hash = '#native-line-1';
      applyProviderLineFolds(file.view, [file.stats], settings());
      if (change === 'hash') window.location.hash = '#another-line';
      else window.location.search = '?diff_id=another-version';
      flush();
      expect(scroll).not.toHaveBeenCalled();
    } finally { window.location.href = previous; }
  });

  it('cancels its pending frame when the hash was removed and a new pass runs', () => {
    const { cancel, flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    window.location.hash = '';
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(cancel).toHaveBeenCalledOnce();
    flush();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not act on a detached row or its replacement with the same native id', () => {
    const { flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    const replacement = document.createElement('tr');
    replacement.id = file.row.id;
    const nextScroll = vi.spyOn(replacement, 'scrollIntoView');
    file.row.replaceWith(replacement);
    flush();
    expect(scroll).not.toHaveBeenCalled();
    expect(nextScroll).not.toHaveBeenCalled();
  });

  it('cancels an old file landing when the native file remounts without closing its opened fold', () => {
    const { cancel, flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    file.root.remove();
    const next = fixture(["it('linked source', () => {", '  expect(value).toBe(1);', '});'].map((text, index) => added(index + 1, text)));
    applyProviderLineFolds(next.view, [next.stats], settings());
    expect(cancel).toHaveBeenCalledOnce();
    expect(next.lines.every((line) => !hidden(line.root))).toBe(true);
    flush();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('cancels its frame when folding is cleared', () => {
    const { cancel, flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    clearProviderLineFolds();
    expect(cancel).toHaveBeenCalledOnce();
    flush();
    expect(scroll).not.toHaveBeenCalled();
    expect(hidden(file.row)).toBe(false);
  });

  it('respects a reader closing the linked fold before its landing frame', () => {
    const { flush } = frames();
    const file = linkedFixture();
    const scroll = vi.spyOn(file.row, 'scrollIntoView');
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    testButtons(file.root)[0]?.click();
    expect(hidden(file.row)).toBe(true);
    flush();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('leaves an already visible unrelated native target to the browser', () => {
    const { request, flush } = frames();
    const file = fixture([added(1, 'export const value = 1;')], 'src/cache.ts');
    const row = file.lines[0]?.root;
    if (row === undefined) throw new Error('Expected visible native row.');
    const scroll = vi.spyOn(row, 'scrollIntoView');
    window.location.hash = '#native-line-0';
    applyProviderLineFolds(file.view, [file.stats], settings());
    flush();
    expect(request).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('provider test outlines', () => {
  it.each([
    ['https://gitlab.com/acme/widgets/-/merge_requests/7/diffs', '[acme/widgets]', false],
    ['https://bitbucket.org/acme/widgets/pull-requests/7/diff', '[acme/widgets]', false],
    ['https://gitlab.com/group/sub/widgets/-/merge_requests/7/diffs', '[gitlab.com/group/sub/widgets]', true],
    ['https://bitbucket.org/acme/widgets/pull-requests/7/diff', '[bitbucket.org/acme/widgets]', true],
  ] as const)('scopes test outlining for %s to the provider-qualified repository', (url, scope, expected) => {
    const previous = window.location.href;
    try {
      window.location.href = url;
      const file = fixture(["describe('custom', () => {", "  it('works', () => {", '    expect(value).toBe(1);', '  });', '});'].map((text, index) => added(index + 1, text)), 'src/custom.ts');
      applyProviderLineFolds(file.view, [file.stats], settings({ categoryPatterns: { tests: [scope, 'src/custom.ts'] } }));
      expect(testButtons(file.root)).toHaveLength(expected ? 1 : 0);
      expect(file.lines.every((line) => hidden(line.root))).toBe(expected);
    } finally { window.location.href = previous; }
  });

  it('folds a whole added suite once and opens its original live source with a native keyboard button', () => {
    const file = fixture(["describe('cache', () => {", "  it('stores values', () => {", '    expect(cache.get()).toBe(1);', '  });', '});'].map((text, index) => added(index + 1, text)));
    const originalRows = [...file.root.querySelectorAll('tbody > tr')];
    const result = applyProviderLineFolds(file.view, [file.stats], settings());
    const buttons = testButtons(file.root);
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button?.textContent).toContain('cache');
    expect(button?.textContent).toContain('+5');
    expect(button?.closest('tr')?.dataset.status).toBe('added');
    expect(button?.closest('td')?.colSpan).toBe(4);
    expect(result).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
    expect(file.lines.every((line) => hidden(line.root))).toBe(true);
    expect(button?.type).toBe('button');
    expect(button?.tabIndex).toBe(0);
    button?.focus();
    expect(document.activeElement).toBe(button);
    button?.click();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    expect([...file.root.querySelectorAll('tbody > tr')].filter((row) => !row.hasAttribute(ATTR_PROVIDER_FOLD_ROW))).toEqual(originalRows);
    button?.click();
    expect(file.lines.every((line) => hidden(line.root))).toBe(true);
  });

  it('retains an existing suite while folding custom test declarations and hooks', () => {
    const file = fixture([
      context(1, "describe('cache', () => {"),
      added(2, "  verify('fresh cache', () => {"), added(3, '    check(cache.empty);'), added(4, '  });'),
      added(5, '  givenEach(() => {'), added(6, '    cache.clear();'), added(7, '  });'),
      context(8, '});'),
    ]);
    applyProviderLineFolds(file.view, [file.stats], settings({ testSyntaxes: ['verify', 'hook: givenEach'] }));
    expect(testButtons(file.root).map((button) => button.textContent)).toEqual([expect.stringContaining('fresh cache'), expect.stringContaining('givenEach hook')]);
    expect(hidden(file.lines[0]?.root ?? file.root)).toBe(false);
    expect(hidden(file.lines[7]?.root ?? file.root)).toBe(false);
  });

  it('folds a whole removed suite with its old-side line and deletion total', () => {
    const file = fixture(["describe('old suite', () => {", "  it('removed', () => {", '    expect(value).toBe(1);', '  });', '});'].map((oldText, index) => ({ oldLine: index + 1, oldText, newLine: null, newText: null, kind: 'removed' })));
    applyProviderLineFolds(file.view, [file.stats], settings());
    const buttons = testButtons(file.root);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('old suite');
    expect(buttons[0]?.textContent).toContain('removed');
    expect(buttons[0]?.textContent).toContain('−5');
    expect(file.lines.every((line) => hidden(line.root))).toBe(true);
  });

  it('pairs renamed tests in split rows and retains both sides change counts', () => {
    const file = fixture([
      pair(1, "it('old name', () => {", "it('new name', () => {"),
      pair(2, '  expect(oldValue).toBe(1);', '  expect(newValue).toBe(2);'),
      context(3, '});'),
    ]);
    applyProviderLineFolds(file.view, [file.stats], settings());
    const button = testButtons(file.root)[0];
    expect(button?.textContent).toContain('new name');
    expect(button?.textContent).toContain('renamed');
    expect(button?.textContent).toContain('+2 −2');
    expect(button?.title).toContain('old name');
    expect(file.lines.every((line) => hidden(line.root))).toBe(true);
  });

  it('never hides the code paired with an old-side test', () => {
    const file = fixture([
      pair(1, "it('removed test', () => {", 'const first = compute();'),
      pair(2, '  expect(oldValue).toBe(1);', 'const second = first + 1;'),
      pair(3, '});', 'export { second };'),
    ]);
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    expect(testButtons(file.root)).toHaveLength(0);
  });

  it('stops at a context gap and labels the outline as displayed source only', () => {
    const file = fixture([
      context(1, "it('partly displayed', () => {"), added(2, '  expect(first()).toBe(1);'),
      { oldLine: null, newLine: null, oldText: null, newText: null, kind: 'hunk' },
      context(20, '  continueWithOtherCode();'), context(21, '});'),
    ]);
    applyProviderLineFolds(file.view, [file.stats], settings());
    const button = testButtons(file.root)[0];
    expect(button?.textContent).toContain('shown lines');
    expect(button?.getAttribute('aria-label')).toContain('Only displayed lines');
    expect(hidden(file.lines[2]?.root ?? file.root)).toBe(false);
    expect(hidden(file.lines[3]?.root ?? file.root)).toBe(false);
    expect(hidden(file.lines[4]?.root ?? file.root)).toBe(false);
  });

  it('reapplies after remount without closing an opened test and reverses a disabled setting', () => {
    const source = ["it('persistent', () => {", '  expect(1).toBe(1);', '});'].map((text, index) => added(index + 1, text));
    const first = fixture(source);
    applyProviderLineFolds(first.view, [first.stats], settings());
    testButtons(first.root)[0]?.click();
    const next = fixture(source);
    first.root.remove();
    applyProviderLineFolds(next.view, [next.stats], settings());
    expect(testButtons(next.root)[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(next.lines.every((line) => !hidden(line.root))).toBe(true);
    applyProviderLineFolds(next.view, [next.stats], settings({ testOutline: false }));
    expect(next.root.querySelector(`[${ATTR_PROVIDER_FOLD_ROW}]`)).toBeNull();
    expect(next.lines.every((line) => !hidden(line.root))).toBe(true);
    expect(first.lines.every((line) => !hidden(line.root))).toBe(true);
  });

  it('opens a native deep-linked source once and then respects the reader closing it', () => {
    const file = fixture(["it('deep link', () => {", '  expect(value).toBe(1);', '});'].map((text, index) => added(index + 1, text)));
    window.location.hash = '#native-line-1';
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(testButtons(file.root)[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    testButtons(file.root)[0]?.click();
    applyProviderLineFolds(file.view, [file.stats], settings());
    expect(testButtons(file.root)[0]?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('provider changed comment lines', () => {
  it('subtracts both split sides only when every displayed side is a changed comment', () => {
    const file = fixture([
      pair(1, 'const liveCode = 1;', '// comment replacing code'),
      pair(2, '// old explanation', '// new explanation'),
      added(3, '// another explanation'),
      context(4, 'const result = 2;'),
    ], 'src/cache.ts', { added: [1, 2, 3], removed: [2] });
    const result = applyProviderLineFolds(file.view, [file.stats], settings({ hideCommentLines: true }));
    expect(result).toEqual({ hiddenAdditions: 2, hiddenDeletions: 1 });
    expect(hidden(file.lines[0]?.root ?? file.root)).toBe(false);
    expect(hidden(file.lines[1]?.root ?? file.root)).toBe(true);
    expect(hidden(file.lines[2]?.root ?? file.root)).toBe(true);
    expect(commentButton(file.root)?.textContent).toContain('3 comment-only lines hidden');
    let changed = 0;
    const listener = (): void => { changed += 1; };
    document.addEventListener(PROVIDER_LINE_FOLDS_CHANGED, listener);
    commentButton(file.root)?.click();
    document.removeEventListener(PROVIDER_LINE_FOLDS_CHANGED, listener);
    expect(changed).toBe(1);
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    expect(applyProviderLineFolds(file.view, [file.stats], settings({ hideCommentLines: true }))).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
  });

  it('keeps unchanged context and unknown split halves visible', () => {
    const file = fixture([
      context(1, '// unchanged context'),
      { oldLine: 2, newLine: 2, oldText: null, newText: '// a new comment', kind: 'context' },
    ], 'src/cache.ts', { added: [1, 2], removed: [1, 2] });
    expect(applyProviderLineFolds(file.view, [file.stats], settings({ hideCommentLines: true }))).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    expect(commentButton(file.root)).toBeNull();
  });

  it('hides comment notes under a test title and restores them when its source opens', () => {
    const file = fixture(["it('comments inside', () => {", '  // rationale', '  expect(true).toBe(true);', '});'].map((text, index) => added(index + 1, text)), 'src/cache.test.ts', { added: [2], removed: [] });
    applyProviderLineFolds(file.view, [file.stats], settings({ hideCommentLines: true }));
    const note = commentButton(file.root)?.closest('tr');
    expect(note?.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN)).toBe(true);
    testButtons(file.root)[0]?.click();
    expect(note?.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN)).toBe(false);
    expect(hidden(file.lines[1]?.root ?? file.root)).toBe(true);
    expect(hidden(file.lines[2]?.root ?? file.root)).toBe(false);
  });

  it('counts only supplied visible files and clears all attributes on disable', () => {
    const file = fixture([added(1, '// hidden comment')], 'src/cache.ts', { added: [1], removed: [] });
    const options = settings({ hideCommentLines: true });
    expect(applyProviderLineFolds(file.view, [file.stats], options).hiddenAdditions).toBe(1);
    expect(applyProviderLineFolds(file.view, [], options)).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
    expect(file.lines.every((line) => !hidden(line.root))).toBe(true);
    expect(file.root.querySelector(`[${ATTR_PROVIDER_FOLD_ROW}]`)).toBeNull();
    applyProviderLineFolds(file.view, [file.stats], options);
    const row = file.lines[0]?.root;
    row?.setAttribute('data-native', 'keep');
    applyProviderLineFolds(file.view, [file.stats], { ...options, enabled: false });
    expect(row?.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN)).toBe(false);
    expect(row?.getAttribute('data-native')).toBe('keep');
  });

  it('keeps title controls stable across identical passes and supports non-table rows', () => {
    const file = fixture([added(1, '// comment')], 'src/cache.ts', { added: [1], removed: [] });
    const line = file.lines[0];
    if (line === undefined) throw new Error('Expected a source row.');
    const root = document.createElement('div');
    root.textContent = '// comment';
    file.root.replaceChildren(root);
    const entry: ProviderDiffEntry = { ...file.entry, readLines: () => [{ ...line, root }] };
    const view: ProviderDiffView = { ...file.view, entries: [entry] };
    const options = settings({ hideCommentLines: true });
    applyProviderLineFolds(view, [file.stats], options);
    const button = commentButton(file.root);
    applyProviderLineFolds(view, [file.stats], options);
    expect(commentButton(file.root)).toBe(button);
    expect(button?.closest(`[${ATTR_PROVIDER_FOLD_ROW}]`)?.tagName).toBe('DIV');
    expect(file.root.querySelectorAll(`[${ATTR_PROVIDER_FOLD_ROW}]`)).toHaveLength(1);
  });
});
