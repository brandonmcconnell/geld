// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import { breakdownFromFiles } from '../github/breakdown';
import { readGitLabDiff } from '../gitlab/diff';
import { describeGitLabPage } from '../gitlab/page';
import { providerDiffSourceFacts, providerOutlineContext } from './source-facts';
import type { ProviderDiffResult } from './types';

const H = 'd03aadd2c95a94ecbe229896b29c9dcda009a916';
const B = '311fea1fc538c493e1f1fc92232024455d7c4388';
const S = '6794d2ce9d2787c30f2d685a2a1bcf13dd0bbfe8';
const M = 'fb1b96d9a4f9262622a164ee4b8122ae39e3fdee';
const MS = '599ec77bb61cb73d484dd314895971f4421dd939';
const PATH = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
const URL = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const presentation = { id: '2159504012', headSha: M, startSha: MS, mergeHead: true };

// Actual257 native and observed HTTP projection fields; this complete local fixture does not claim which response the product consumed.
function fixture(merge = false) {
  window.location.href = `${URL}/diffs?diff_id=2158520123`;
  const target = merge ? presentation : { id: '2158520123', headSha: H, startSha: S, mergeHead: false };
  const appData = { project_path: 'gitlab-org/gitlab', mr_path: '/gitlab-org/gitlab/-/merge_requests/266334', is_fork: 'false', versions: {
    source_versions: [{ id: 2158520123, selected: true, head_sha: H, base_sha: B, start_sha: S }],
    target_versions: [{ id: Number(target.id), selected: true, head_sha: target.headSha, start_sha: target.startSha, is_merge_head: target.mergeHead }],
  } };
  const app = document.createElement('article');app.setAttribute('data-rapid-diffs', '');app.setAttribute('data-app-data', JSON.stringify(appData));
  const list = document.createElement('div');list.setAttribute('data-diffs-list', '');app.append(list);
  const root = document.createElement('diff-file');root.id = 'native-source-file';list.append(root);
  const data = { new_path: PATH, old_path: PATH, diff_refs: { head_sha: target.headSha, base_sha: merge ? MS : B, start_sha: target.startSha }, blob_raw_path: `/gitlab-org/gitlab/-/raw/${target.headSha}/${PATH}`, diff_lines_path: `/gitlab-org/gitlab/-/blob/${target.headSha}/${PATH}/diff_lines` };
  root.setAttribute('data-file-data', JSON.stringify(data));document.body.append(app);
  const page = describeGitLabPage(new globalThis.URL(window.location.href), document), view = readGitLabDiff(document);
  if (page === null || view === null) throw new Error('Missing native projection');
  const facts = providerDiffSourceFacts(page, { kind: 'gitlab-review', headSha: H, baseSha: B, diffId: '2158520123', commitId: null, projectPath: 'gitlab-org/gitlab', target: presentation }, [{ path: PATH, newPath: PATH }]);
  if (facts === null || facts.comparison.kind !== 'gitlab-review') throw new Error('Missing acquired projection');
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 32, deletions: 0, status: 'modified', commentLines: { added: [107, 112], removed: [] } }], complete: true, revision: 'projected-source-comparison', sourceFacts: facts };
  return { page, view, app, appData, root, data, facts, result };
}

afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('native exact source-head variant', () => {
  it('binds the current native source D03 rather than the independently observed API presentation fb1b', () => {
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const file = fixture();const before = JSON.stringify(file.result);const matcher = createMatcher(DEFAULT_SETTINGS);
    const semantic = breakdownFromFiles(file.result.files, matcher, true);
    const context = providerOutlineContext(file.page, file.result, file.view);
    expect(context.newSources.get(file.root)).toMatchObject({ repository: file.page.repository, path: PATH, headSha: H });
    expect(context.newSources.get(file.root)?.headSha).not.toBe(M);
    expect(context.commentCoordinateMismatches?.has(file.root)).toBe(false);
    expect(JSON.stringify(file.result)).toBe(before);expect(breakdownFromFiles(file.result.files, matcher, true)).toEqual(semantic);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['native-id', 'native-mode', 'native-head', 'native-start', 'source-id', 'source-head', 'owner', 'fork', 'raw', 'context', 'path', 'missing-target', 'missing-project', 'commit', 'inventory', 'incomplete', 'filtered', 'selection', 'detached'])('declines contradictory %s evidence without borrowing API presentation authority', (kind) => {
    const file = fixture();const comparison = file.facts.comparison;
    if (comparison.kind !== 'gitlab-review') throw new Error('Expected comparison');
    const target = file.appData.versions.target_versions[0];if (target === undefined) throw new Error('Expected target');
    if (['native-id', 'native-mode', 'native-head'].includes(kind)) file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, versions: { ...file.appData.versions, target_versions: [{ ...target,
      ...(kind === 'native-id' ? { id: 2151401827 } : {}), ...(kind === 'native-mode' ? { is_merge_head: true } : {}), ...(kind === 'native-head' ? { head_sha: M } : {}),
    }] } }));
    if (kind === 'native-start') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, diff_refs: { ...file.data.diff_refs, start_sha: B } }));
    if (kind === 'owner') file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, project_path: 'other/fork' }));
    if (kind === 'fork') file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, is_fork: 'true' }));
    if (kind === 'raw') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, blob_raw_path: file.data.blob_raw_path.replace(H, M) }));
    if (kind === 'context') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, diff_lines_path: file.data.diff_lines_path.replace(H, M) }));
    if (kind === 'path') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, new_path: 'other.test.rb' }));
    if (kind === 'selection') window.location.href = `${URL}/diffs?diff_id=2151401827`;
    if (kind === 'detached') file.root.remove();
    const sourceFacts = { ...file.facts, ...(kind === 'inventory' ? { newPaths: [] } : {}), comparison: { ...comparison,
      ...(kind === 'source-id' ? { diffId: '2151401827' } : {}), ...(kind === 'source-head' ? { headSha: M } : {}),
      ...(kind === 'missing-target' ? { target: null } : {}), ...(kind === 'missing-project' ? { projectPath: null } : {}), ...(kind === 'commit' ? { commitId: H } : {}),
    } };
    const result = { ...file.result, sourceFacts, complete: kind !== 'incomplete' };
    const view = kind === 'filtered' ? { ...file.view, filteredPaths: new Set([PATH]) } : file.view;
    expect(providerOutlineContext(file.page, result, view).newSources.size).toBe(0);
  });

  it('requires a full native start ref even if a typed boundary reports matching opaque starts', () => {
    const file = fixture(), frame = file.view.readNewSourceFrame?.();if (frame === null || frame === undefined) throw new Error('Missing frame');
    const read = (entry: typeof file.view.entries[number]) => {
      const witness = frame.read(entry);if (witness === null || witness.comparison.kind !== 'gitlab-review') return witness;
      return { ...witness, comparison: { ...witness.comparison, startSha: 'branch-name', target: { ...witness.comparison.target, startSha: 'branch-name' } } };
    };
    expect(providerOutlineContext(file.page, file.result, { ...file.view, readNewSourceFrame: () => ({ ...frame, read }) }).newSources.size).toBe(0);
  });

  it('drops the new source branch when the batched frame changes before completion', () => {
    const file = fixture(), frame = file.view.readNewSourceFrame?.();if (frame === null || frame === undefined) throw new Error('Missing frame');
    const current = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(providerOutlineContext(file.page, file.result, { ...file.view, readNewSourceFrame: () => ({ ...frame, current }) }).newSources.size).toBe(0);
  });

  it('keeps a matching native merge target strict and its separate comment-coordinate veto true', () => {
    const file = fixture(true);const before = JSON.stringify(file.result), matcher = createMatcher(DEFAULT_SETTINGS), semantic = breakdownFromFiles(file.result.files, matcher, true);
    const context = providerOutlineContext(file.page, file.result, file.view);
    expect(context.newSources.get(file.root)?.headSha).toBe(M);expect(context.commentCoordinateMismatches?.has(file.root)).toBe(true);
    expect(JSON.stringify(file.result)).toBe(before);expect(breakdownFromFiles(file.result.files, matcher, true)).toEqual(semantic);
  });

  it.each(['id', 'head', 'start', 'mode', 'native-start'])('preserves strict native MERGE target rejection for %s mismatch', (kind) => {
    const file = fixture(true), comparison = file.facts.comparison;
    if (comparison.kind !== 'gitlab-review' || comparison.target === null) throw new Error('Missing acquired merge target');
    const target = { ...comparison.target,
      ...(kind === 'id' ? { id: '2158520123' } : {}), ...(kind === 'head' ? { headSha: H } : {}),
      ...(kind === 'start' ? { startSha: S } : {}), ...(kind === 'mode' ? { mergeHead: false } : {}),
    };
    if (kind === 'native-start') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, diff_refs: { ...file.data.diff_refs, start_sha: S } }));
    expect(providerOutlineContext(file.page, { ...file.result, sourceFacts: { ...file.facts, comparison: { ...comparison, target } } }, file.view).newSources.size).toBe(0);
  });
});
