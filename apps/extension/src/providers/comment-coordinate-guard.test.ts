// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatcher, DEFAULT_SETTINGS, parseUnifiedDiff } from '@geld/core';
import { breakdownFromFiles } from '../github/breakdown';
import { applyProviderLineFolds, ATTR_PROVIDER_FOLD_ROW, ATTR_PROVIDER_LINE_HIDDEN, clearProviderLineFolds } from './line-folds';
import { providerDiffSourceFacts, providerOutlineContext, providerSourceSubject } from './source-facts';
import type { ProviderNativeNewSource } from './source-facts';
import type { ProviderDiffLine, ProviderDiffResult, ProviderDiffView, ProviderReviewPage } from './types';

const HEAD = 'd03aadd2c95a94ecbe229896b29c9dcda009a916';
const BASE = '311fea1fc538c493e1f1fc92232024455d7c4388';
const NATIVE_BASE = '636156f5e68dcf5f882f0920f36a61682e47f548';
const PATH = 'app/graphql/mutations/boards/issues/issue_move_list.rb';
const COMMENT = '          # The move service returns nil, not an error, when the lists are not on the board or the user cannot move it.';
const CODE = "          return ['Item could not be moved. Check the list IDs and your permissions on this board.'] if result.nil?";
const settings = { ...DEFAULT_SETTINGS, hideCommentLines: true, testOutline: false };

// Original !266334 added text; shifted coordinates model a later merge tree, not the observed immutable C871 snapshot.
function fixture(shifted = false) {
  const files = parseUnifiedDiff(`diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n@@ -110,0 +110,2 @@\n+${COMMENT}\n+${CODE}\n`);
  expect(files[0]?.commentLines).toEqual({ added: [110], removed: [] });
  const url = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
  window.location.href = `${url}/diffs?diff_id=2158520123`;
  const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/gitlab' }, number: '266334', url, diffPageUrl: window.location.href, diffUrl: `${url}.diff`, kind: 'diff', headSha: HEAD, version: 'diff_id=2158520123' };
  const root = document.createElement('article');const table = document.createElement('table');const body = document.createElement('tbody');root.append(table);table.append(body);document.body.append(root);
  const rows = [COMMENT, CODE].map((text, index): ProviderDiffLine => {
    const row = document.createElement('tr');const cell = document.createElement('td');cell.textContent = text;row.append(cell);body.append(row);
    return { root: row, oldLine: null, oldText: null, newLine: (shifted ? 109 : 110) + index, newText: text, kind: 'added' };
  });
  const target = { id: '2159233785', headSha: shifted ? 'e'.repeat(40) : HEAD, startSha: NATIVE_BASE, mergeHead: shifted };
  const facts = providerDiffSourceFacts(page, { kind: 'gitlab-review', headSha: HEAD, baseSha: BASE, diffId: '2158520123', commitId: null, projectPath: page.repository.path, target: null }, [{ path: PATH, newPath: PATH }]);
  if (facts === null) throw new Error('Expected acquisition facts');
  const witness: ProviderNativeNewSource = { subject: providerSourceSubject(page), repository: page.repository, path: PATH, headSha: target.headSha, comparison: { kind: 'gitlab-review', sourceId: '2158520123', sourceHeadSha: HEAD, baseSha: NATIVE_BASE, startSha: NATIVE_BASE, target } };
  const read = vi.fn(() => witness);const current = vi.fn(() => true);
  const frame = vi.fn(() => ({ key: target.headSha, current, read }));
  const view: ProviderDiffView = { kind: 'protocol', container: root, entries: [{ path: PATH, root, anchor: null, additions: 2, deletions: 0, readLines: () => rows, expand: () => true, collapse: () => true }], tree: [], treeHost: null, filteredPaths: new Set(), virtualized: false, readNewSourceFrame: frame };
  const result: ProviderDiffResult = { files, revision: 'unchanged-source-comparison', complete: true, sourceFacts: facts };
  const apply = (source: ProviderDiffResult = result) => applyProviderLineFolds(view, source.files, settings, providerOutlineContext(page, source, view));
  const hidden = () => rows.map((row) => row.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN));
  const button = () => root.querySelector<HTMLButtonElement>(`[${ATTR_PROVIDER_FOLD_ROW}^="comments:"] button`);
  return { page, root, rows, view, result, facts, witness, read, current, frame, apply, hidden, button };
}

afterEach(() => { clearProviderLineFolds();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('comment coordinates across native comparison trees', () => {
  it('keeps aligned comment hiding when whole-source authority is absent for other reasons', () => {
    const file = fixture();
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    expect(file.apply()).toEqual({ hiddenAdditions: 1, hiddenDeletions: 0 });
    expect(file.hidden()).toEqual([true, false]);
  });

  it('declines shifted comment coordinates without changing acquired stats, semantic counts or request demand', () => {
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const file = fixture(true);const original = JSON.stringify(file.result);
    const semantic = () => breakdownFromFiles(file.result.files, createMatcher(settings), true);
    const before = semantic();
    expect(file.apply()).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
    expect(file.hidden()).toEqual([false, false]);expect(file.button()).toBeNull();
    expect(JSON.stringify(file.result)).toBe(original);expect(semantic()).toEqual(before);
    expect(file.frame).toHaveBeenCalledTimes(1);expect(file.read).toHaveBeenCalledTimes(1);expect(file.current).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the comment-coordinate veto when the actual249 target projection now grants immutable new-file authority', () => {
    const file = fixture(true);const native = file.witness.comparison;const acquired = file.facts.comparison;
    if (native.kind !== 'gitlab-review' || acquired.kind !== 'gitlab-review') throw new Error('Expected review comparison');
    // Real target fields; the shifted line coordinates remain a protocol counterexample, not an observed249 row mapping.
    const target = { id: '2159449928', headSha: '8a882c3325b0e851b859d78ad11486aa3a24112c', startSha: '3ac6e8921566e0ea84d6313b43b1582a46493d1a', mergeHead: true };
    file.read.mockReturnValue({ ...file.witness, headSha: target.headSha, comparison: { ...native, target, baseSha: target.startSha, startSha: target.startSha } });
    const result = { ...file.result, sourceFacts: { ...file.facts, comparison: { ...acquired, target } } };
    const context = providerOutlineContext(file.page, result, file.view);
    expect(context.newSources.get(file.root)?.headSha).toBe(target.headSha);
    expect(context.commentCoordinateMismatches?.has(file.root)).toBe(true);
    const before = JSON.stringify(result);const semantic = breakdownFromFiles(result.files, createMatcher(settings), true);
    expect(applyProviderLineFolds(file.view, result.files, settings, context)).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });
    expect(file.hidden()).toEqual([false, false]);expect(file.button()).toBeNull();
    expect(JSON.stringify(result)).toBe(before);
    expect(breakdownFromFiles(result.files, createMatcher(settings), true)).toEqual(semantic);
  });

  it('retains the explicit legacy unknown policy when complete source facts disappear, then releases it on renewed mismatch proof', () => {
    const file = fixture(true);
    file.apply();expect(file.hidden()).toEqual([false, false]);
    const legacy: ProviderDiffResult = { files: file.result.files, revision: file.result.revision, complete: true };
    file.apply(legacy);expect(file.hidden()).toEqual([false, true]);
    file.apply();expect(file.hidden()).toEqual([false, false]);
  });

  it.each(['owner', 'subject', 'source', 'path', 'short-head'])('does not turn unknown %s evidence into a mismatch veto', (kind) => {
    const file = fixture(true);const native = file.witness.comparison;
    if (native.kind !== 'gitlab-review') throw new Error('Expected review comparison');
    file.read.mockReturnValue({ ...file.witness,
      ...(kind === 'owner' ? { repository: { ...file.page.repository, path: 'other/fork' } } : {}),
      ...(kind === 'subject' ? { subject: { ...file.witness.subject, version: 'other-selection' } } : {}),
      ...(kind === 'source' ? { comparison: { ...native, sourceId: '123' } } : {}),
      ...(kind === 'path' ? { path: 'other.rb' } : {}),
      ...(kind === 'short-head' ? { headSha: 'eeeeeee' } : {}),
    });
    expect(providerOutlineContext(file.page, file.result, file.view).commentCoordinateMismatches?.has(file.root) ?? false).toBe(false);
    file.apply();expect(file.hidden()).toEqual([false, true]);
  });

  it('drops negative evidence when the batched native frame changes before completion', () => {
    const file = fixture(true);file.current.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const context = providerOutlineContext(file.page, file.result, file.view);
    expect(context.commentCoordinateMismatches?.has(file.root) ?? false).toBe(false);expect(context.newSources.size).toBe(0);
    applyProviderLineFolds(file.view, file.result.files, settings, context);
    expect(file.hidden()).toEqual([false, true]);
  });

  it('makes retired comment toggles inert even if a stale owner reconnects their old markup', () => {
    const file = fixture(true);
    const legacy: ProviderDiffResult = { files: file.result.files, revision: file.result.revision, complete: true };
    file.apply(legacy);
    const button = file.button();const oldRow = button?.closest('tr');
    if (button === null || oldRow === null || oldRow === undefined) throw new Error('Expected original comment toggle');
    button.click();expect(file.hidden()).toEqual([false, false]);
    file.apply();expect(oldRow.isConnected).toBe(false);
    button.click();expect(file.hidden()).toEqual([false, false]);
    file.rows[0]?.root.before(oldRow);
    button.click();expect(file.hidden()).toEqual([false, false]);
    file.apply();expect(file.hidden()).toEqual([false, false]);
  });
});
