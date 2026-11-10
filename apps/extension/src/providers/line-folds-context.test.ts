// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffResult, ProviderDiffView, ProviderReviewPage } from './types';
import { applyProviderLineFolds, ATTR_PROVIDER_FOLD_ROW, ATTR_PROVIDER_LINE_HIDDEN, clearProviderLineFolds } from './line-folds';
import { providerOutlineContext } from './source-facts';

function fixture() {
  const root = document.createElement('section');const table = document.createElement('table');const body = document.createElement('tbody');root.append(table);table.append(body);
  const lines: ProviderDiffLine[] = ["it('keeps ownership', () => {", '  expect(value).toBe(1);', '});'].map((newText, index) => {
    const row = document.createElement('tr');const cell = document.createElement('td');cell.textContent = newText;row.append(cell);body.append(row);
    return { root: row, oldLine: null, oldText: null, newLine: index + 1, newText, kind: 'added' };
  });
  document.body.append(root);
  const entry: ProviderDiffEntry = { path: 'src/cache.test.ts', root, anchor: null, additions: 3, deletions: 0, readLines: () => lines, expand: () => true, collapse: () => true };
  const view: ProviderDiffView = { kind: 'gitlab-rapid', container: root, entries: [entry], tree: [], treeHost: null, filteredPaths: new Set(), virtualized: false };
  const result: ProviderDiffResult = { files: [{ path: entry.path, additions: 3, deletions: 0 }], complete: true, revision: 'snapshot' };
  const url = 'https://gitlab.com/acme/widgets/-/merge_requests/42';
  const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/widgets' }, number: '42', url, diffPageUrl: `${url}/diffs?diff_id=1`, diffUrl: `${url}.diff`, kind: 'diff', headSha: 'a'.repeat(40), version: 'diff_id=1' };
  const apply = (selected: ProviderReviewPage = page): void => { applyProviderLineFolds(view, result.files, DEFAULT_SETTINGS, providerOutlineContext(selected, result, view)); };
  const button = (): HTMLButtonElement => { const value = root.querySelector<HTMLButtonElement>(`[${ATTR_PROVIDER_FOLD_ROW}^="test:"] button`);if (value === null) throw new Error('Missing fold');return value; };
  const hidden = (): boolean => lines[1]?.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN) === true;
  return { root, view, result, page, apply, button, hidden };
}

afterEach(() => { clearProviderLineFolds();document.body.replaceChildren();window.location.hash = ''; });

describe('provider comparison scoped shown-line folds', () => {
  it('retains a manual open on ordinary refresh but never carries it into another selected version or head', () => {
    const file = fixture();file.apply();expect(file.hidden()).toBe(true);
    file.button().click();expect(file.hidden()).toBe(false);file.apply();expect(file.hidden()).toBe(false);
    file.apply({ ...file.page, version: 'diff_id=2' });expect(file.hidden()).toBe(true);
    file.button().click();expect(file.hidden()).toBe(false);
    file.apply({ ...file.page, version: 'diff_id=2', headSha: 'b'.repeat(40) });expect(file.hidden()).toBe(true);
  });

  it('reacquires mounted rows and preserves same-comparison choices across a native root remount', () => {
    const first = fixture();first.apply();first.button().click();first.root.remove();
    const second = fixture();second.apply();expect(second.hidden()).toBe(false);
    expect(second.button().isConnected).toBe(true);
    expect(first.root.querySelector(`[${ATTR_PROVIDER_FOLD_ROW}]`)).toBeNull();
    expect(second.result.sourceFacts).toBeUndefined();
  });
});
