// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeGitLabPage } from '../gitlab/page';
import { readGitLabDiff } from '../gitlab/diff';
import { describeBitbucketCommitPage, describeBitbucketPage } from '../bitbucket/page';
import { readBitbucketDiff } from '../bitbucket/diff';
import { isProviderReviewPage } from './types';
import type { ProviderDiffResult } from './types';
import { parseProviderDiffSourceFacts, providerDiffSourceFacts, providerOutlineContext, providerSourcePath } from './source-facts';

const HEAD = 'd03aadd2c95a94ecbe229896b29c9dcda009a916';
const MERGE = 'c871624e0566c7c7e39649a7fc2a2c436e631198';
const BASE = '311fea1fc538c493e1f1fc92232024455d7c4388';
const START = '6794d2ce9d2787c30f2d685a2a1bcf13dd0bbfe8';
const PATH = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
const URL = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';

// Reduced original native fields from installed runs 41370784127 (merge head) and 41375273914 (source head).
function gitlab(renderedHead = MERGE, native?: { readonly id: string; readonly base: string; readonly start: string }) {
  window.location.href = `${URL}/diffs?diff_id=2158520123`;
  const targetId = native?.id ?? (renderedHead === HEAD ? '2158520123' : '2159233785');
  const targetStart = native?.start ?? START;
  const target = { id: targetId, headSha: renderedHead, startSha: targetStart, mergeHead: renderedHead !== HEAD };
  const app = document.createElement('article');app.setAttribute('data-rapid-diffs', '');
  const appData = { project_path: 'gitlab-org/gitlab', mr_path: '/gitlab-org/gitlab/-/merge_requests/266334', is_fork: 'false', versions: {
    source_versions: [{ id: 2158520123, selected: true, head_sha: HEAD, base_sha: BASE, start_sha: START }],
    target_versions: [{ id: Number(targetId), selected: true, head_sha: renderedHead, start_sha: targetStart, is_merge_head: target.mergeHead }],
  } };
  app.setAttribute('data-app-data', JSON.stringify(appData));
  const list = document.createElement('div');list.setAttribute('data-diffs-list', '');
  const root = document.createElement('diff-file');root.id = 'native-file';
  const data = { new_path: PATH, old_path: PATH, diff_refs: { base_sha: native?.base ?? BASE, start_sha: targetStart, head_sha: renderedHead },
    blob_raw_path: `/gitlab-org/gitlab/-/raw/${renderedHead}/${PATH}`, diff_lines_path: `/gitlab-org/gitlab/-/blob/${renderedHead}/${PATH}/diff_lines` };
  root.setAttribute('data-file-data', JSON.stringify(data));list.append(root);app.append(list);document.body.append(app);
  const page = describeGitLabPage(new globalThis.URL(window.location.href), document);
  const view = readGitLabDiff(document);
  if (page === null || !isProviderReviewPage(page) || view === null) throw new Error('Missing native fixture');
  const sourceFacts = providerDiffSourceFacts(page, { kind: 'gitlab-review', headSha: HEAD, baseSha: BASE, diffId: '2158520123', commitId: null, projectPath: 'gitlab-org/gitlab', target }, [{ path: PATH, newPath: PATH }]);
  if (sourceFacts === null) throw new Error('Missing acquisition facts');
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 32, deletions: 0, status: 'modified' }], complete: true, revision: 'opaque-comparison-token', sourceFacts };
  return { page, view, root, app, appData, data, result, sourceFacts };
}

afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('exact rendered new-side binding', () => {
  // Original native target/resource fields from run41387372601; a matching acquired target is projected, not a retained HTTP response.
  const latestHead = '8a882c3325b0e851b859d78ad11486aa3a24112c';
  const latestStart = '3ac6e8921566e0ea84d6313b43b1582a46493d1a';
  const latestNative = { id: '2159449928', base: latestStart, start: latestStart };

  it('binds the original full native merge tree independently of the acquired diff old base', () => {
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const file = gitlab(latestHead, latestNative);
    expect(file.sourceFacts.comparison).toMatchObject({ headSha: HEAD, baseSha: BASE });
    expect(file.data.diff_refs.base_sha).not.toBe(BASE);
    const before = JSON.stringify(file.result);
    const context = providerOutlineContext(file.page, file.result, file.view);
    expect(context.newSources.get(file.root)).toMatchObject({ repository: file.page.repository, path: PATH, headSha: latestHead });
    expect(context.newSources.get(file.root)?.headSha).not.toBe(HEAD);
    expect(context.commentCoordinateMismatches?.has(file.root)).toBe(true);
    expect(JSON.stringify(file.result)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['target', 'raw', 'context', 'source', 'owner'])('still rejects contradictory %s identity for the same base-divergent native merge tree', (kind) => {
    const file = gitlab(latestHead, latestNative);
    const comparison = file.sourceFacts.comparison;
    if (comparison.kind !== 'gitlab-review' || comparison.target === null) throw new Error('Expected selected GitLab target');
    const sourceFacts = { ...file.sourceFacts, comparison: { ...comparison,
      ...(kind === 'target' ? { target: { ...comparison.target, headSha: HEAD } } : {}),
      ...(kind === 'source' ? { diffId: '2151401827' } : {}),
    } };
    if (kind === 'raw') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, blob_raw_path: file.data.blob_raw_path.replace(latestHead, HEAD) }));
    if (kind === 'context') file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, diff_lines_path: file.data.diff_lines_path.replace(latestHead, HEAD) }));
    if (kind === 'owner') file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, project_path: 'other/fork' }));
    expect(providerOutlineContext(file.page, { ...file.result, sourceFacts }, file.view).newSources.size).toBe(0);
  });

  it.each([HEAD, MERGE])('binds the actual native %s, keeping acquired source D03 distinct', (head) => {
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const file = gitlab(head);
    const context = providerOutlineContext(file.page, file.result, file.view);
    expect(file.result.sourceFacts?.comparison.headSha).toBe(HEAD);
    expect(context.newSources.get(file.root)).toMatchObject({ repository: file.page.repository, path: PATH, headSha: head });
    expect(context.newSources.get(file.root)?.key).toContain(head);
    expect(context.commentCoordinateMismatches?.has(file.root)).toBe(head !== HEAD);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never promotes matching source D03 statistics into unseen C871 authority without selected-target facts', () => {
    const file = gitlab();
    const comparison = file.sourceFacts.comparison;
    if (comparison.kind !== 'gitlab-review') throw new Error('Expected GitLab comparison');
    const counts = { files: file.result.files, revision: file.result.revision, complete: true };
    for (const result of [counts, { ...file.result, sourceFacts: { ...file.sourceFacts, comparison: { ...comparison, target: null } } }]) {
      expect(providerOutlineContext(file.page, result, file.view).newSources.size).toBe(0);
    }
    const source = gitlab(HEAD);
    expect(providerOutlineContext(source.page, file.result, source.view).newSources.size).toBe(0);
  });

  it.each(['true', true, undefined, 'unknown'])('leaves fork or unknown project mapping %s unavailable', (isFork) => {
    const file = gitlab();
    file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, is_fork: isFork }));
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
  });

  it('rejects short project slugs, foreign raw ownership and inconsistent native target refs', () => {
    const file = gitlab();
    file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, project_path: 'gitlab' }));
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, mr_path: '/gitlab-org/gitlab/-/merge_requests/266335' }));
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    file.app.setAttribute('data-app-data', JSON.stringify(file.appData));
    for (const data of [
      { ...file.data, blob_raw_path: `https://evil.example/gitlab-org/gitlab/-/raw/${MERGE}/${PATH}` },
      { ...file.data, diff_lines_path: `/other/fork/-/blob/${MERGE}/${PATH}/diff_lines` },
      { ...file.data, diff_refs: { ...file.data.diff_refs, head_sha: HEAD } },
      { ...file.data, diff_refs: { ...file.data.diff_refs, start_sha: BASE } },
    ]) {
      file.root.setAttribute('data-file-data', JSON.stringify(data));
      expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    }
  });

  it('rejects changed routes, recycled roots, filtered entries, deleted files and partial acquisition', () => {
    const file = gitlab();
    expect(providerOutlineContext(file.page, { ...file.result, complete: false }, file.view).newSources.size).toBe(0);
    expect(providerOutlineContext(file.page, { ...file.result, files: [{ path: PATH, additions: 0, deletions: 3, status: 'deleted' }] }, file.view).newSources.size).toBe(0);
    expect(providerOutlineContext(file.page, file.result, { ...file.view, filteredPaths: new Set([PATH]) }).newSources.size).toBe(0);
    file.root.setAttribute('data-file-data', JSON.stringify({ ...file.data, new_path: 'other.test.rb', blob_raw_path: file.data.blob_raw_path.replace(PATH, 'other.test.rb'), diff_lines_path: file.data.diff_lines_path.replace(PATH, 'other.test.rb') }));
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    file.root.setAttribute('data-file-data', JSON.stringify(file.data));
    window.location.href = file.page.diffPageUrl.replace('266334', '266335');
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
    file.root.remove();
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
  });

  it('changes lifecycle identity for actual native target changes even while the source/version URL stays fixed', () => {
    const merge = gitlab();
    const first = providerOutlineContext(merge.page, merge.result, merge.view);
    document.body.replaceChildren();
    const source = gitlab(HEAD);
    const second = providerOutlineContext(source.page, merge.result, source.view);
    expect(first.subjectKey).not.toBe(second.subjectKey);
    expect(second.newSources.size).toBe(0);
    expect(providerOutlineContext(source.page, source.result, source.view).subjectKey).toBe(second.subjectKey);
  });

  it.each(['description', 'note', 'form', 'editor', 'inert'])('never grants authority to matching authored or inert %s markup', (scope) => {
    const file = gitlab();
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(1);
    const wrapper = document.createElement(scope === 'form' ? 'form' : 'section');
    if (scope === 'description') wrapper.setAttribute('data-testid', 'description-content');
    if (scope === 'note') wrapper.setAttribute('data-testid', 'noteable-note-container');
    if (scope === 'editor') wrapper.setAttribute('contenteditable', 'true');
    if (scope === 'inert') wrapper.setAttribute('inert', '');
    file.app.before(wrapper);wrapper.append(file.app);
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
  });

  it('ignores forged note-local file hooks inside an otherwise valid native frame', () => {
    const file = gitlab();const note = document.createElement('li');note.setAttribute('data-testid', 'noteable-note-container');
    file.root.before(note);note.append(file.root);
    expect(providerOutlineContext(file.page, file.result, file.view).newSources.size).toBe(0);
  });

  it('reads one global GitLab frame for multiple files and always re-reads original local file data', () => {
    const file = gitlab();
    const otherPath = 'spec/other.test.rb';const other = file.root.cloneNode(true);
    if (!(other instanceof HTMLElement)) throw new Error('Missing cloned native file');
    other.id = 'native-other';
    const otherData = { ...file.data, new_path: otherPath, old_path: otherPath, blob_raw_path: file.data.blob_raw_path.replace(PATH, otherPath), diff_lines_path: file.data.diff_lines_path.replace(PATH, otherPath) };
    other.setAttribute('data-file-data', JSON.stringify(otherData));file.root.after(other);
    const view = readGitLabDiff(document);if (view === null) throw new Error('Missing view');
    const result = { ...file.result, files: [...file.result.files, { path: otherPath, additions: 1, deletions: 0 }], sourceFacts: { ...file.sourceFacts, newPaths: [...file.sourceFacts.newPaths, { path: otherPath, newPath: otherPath }] } };
    const serialized = file.app.getAttribute('data-app-data');
    const parse = vi.spyOn(JSON, 'parse');const scan = vi.spyOn(document, 'querySelectorAll');
    const context = providerOutlineContext(file.page, result, view);
    expect(context.newSources.size).toBe(2);
    expect(context.commentCoordinateMismatches?.size).toBe(2);
    expect(parse.mock.calls.filter(([value]) => value === serialized)).toHaveLength(1);
    expect(scan.mock.calls.filter(([selector]) => selector === '[data-rapid-diffs][data-app-data]')).toHaveLength(1);
    other.setAttribute('data-file-data', JSON.stringify({ ...otherData, diff_refs: { ...otherData.diff_refs, head_sha: HEAD } }));
    expect(providerOutlineContext(file.page, result, view).newSources.has(other)).toBe(false);
    expect(providerOutlineContext(file.page, result, view).newSources.has(file.root)).toBe(true);
    const frame = view.readNewSourceFrame?.();if (frame === null || frame === undefined) throw new Error('Missing frame');
    const localRead = vi.fn(frame.read);
    const countsOnly: ProviderDiffResult = { files: result.files, revision: result.revision, complete: true };
    expect(providerOutlineContext(file.page, countsOnly, { ...view, readNewSourceFrame: () => ({ ...frame, read: localRead }) }).newSources.size).toBe(0);
    expect(localRead).not.toHaveBeenCalled();
    const current = vi.fn(frame.current);
    const interrupted = { ...view, readNewSourceFrame: () => ({ ...frame, current, read: (entry: typeof view.entries[number]) => {
      const witness = frame.read(entry);file.app.setAttribute('data-app-data', JSON.stringify({ ...file.appData, file_by_file_mode: true }));return witness;
    } }) };
    const interruptedContext = providerOutlineContext(file.page, result, interrupted);
    expect(interruptedContext.newSources.size).toBe(0);
    expect(interruptedContext.commentCoordinateMismatches?.size).toBe(0);
    expect(current).toHaveBeenCalledTimes(2);
    expect(frame.current()).toBe(false);
  });

  it('retains standalone acquisition facts but leaves absent native project ownership unavailable', () => {
    const file = gitlab(HEAD);
    for (const url of [
      `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}`,
      `https://gitlab.com/gitlab-org/gitlab/-/compare/${BASE}...${HEAD}?from_project_id=777`,
    ]) {
      window.location.href = url;
      file.app.setAttribute('data-app-data', JSON.stringify({ reload_stream_url: `${url.split('?')[0]}/diffs_stream`, diffs_stats_endpoint: `${url.split('?')[0]}/diffs_stats`, diff_files_endpoint: `${url.split('?')[0]}/diff_files_metadata` }));
      const page = describeGitLabPage(new globalThis.URL(url), document);
      if (page === null || page.kind !== 'commit' && page.kind !== 'compare') throw new Error('Missing standalone page');
      const facts = providerDiffSourceFacts(page, { kind: page.kind === 'commit' ? 'gitlab-commit' : 'gitlab-compare', headSha: HEAD, baseSha: page.kind === 'commit' ? null : BASE }, [{ path: PATH, newPath: PATH }]);
      if (facts === null) throw new Error('Missing standalone facts');
      expect(facts.comparison.headSha).toBe(HEAD);
      expect(providerOutlineContext(page, { ...file.result, sourceFacts: facts }, file.view).newSources.size).toBe(0);
    }
  });

  it('binds a full immutable Bitbucket commit but never its headless PR or abbreviated route', () => {
    const url = `https://bitbucket.org/acme/widgets/commits/${HEAD}`;window.location.href = url;
    const container = document.createElement('div');container.setAttribute('role', 'region');container.setAttribute('aria-label', 'Diff');
    const root = document.createElement('div');const anchor = document.createElement('div');anchor.id = `chg-${PATH}`;
    const article = document.createElement('article');article.setAttribute('data-qa', 'branch-diff-file');root.append(anchor, article);container.append(root);
    const main = document.createElement('main');main.setAttribute('role', 'main');
    const heading = document.createElement('h1');heading.setAttribute('data-qa', 'page-header');heading.textContent = HEAD.slice(0, 7);
    const group = document.createElement('div');group.setAttribute('role', 'group');const link = document.createElement('a');link.textContent = 'View source';link.href = `/acme/widgets/src/${HEAD}/`;group.append(link);main.append(heading, group, container);document.body.append(main);
    const other = root.cloneNode(true);if (!(other instanceof HTMLElement)) throw new Error('Missing other file');
    const otherAnchor = other.querySelector('div[id]');if (otherAnchor === null) throw new Error('Missing native anchor');otherAnchor.id = 'chg-spec/other.test.rb';container.append(other);
    const page = describeBitbucketCommitPage(new globalThis.URL(url));const view = readBitbucketDiff(document);
    if (page === null || view === null) throw new Error('Missing Bitbucket fixture');
    const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-commit', headSha: HEAD, baseSha: null }, [{ path: PATH, newPath: PATH }, { path: 'spec/other.test.rb', newPath: 'spec/other.test.rb' }]);
    if (facts === null) throw new Error('Missing facts');
    const result: ProviderDiffResult = { ...gitlabResult(), files: [...gitlabResult().files, { path: 'spec/other.test.rb', additions: 1, deletions: 0 }], sourceFacts: facts };
    const scan = vi.spyOn(main, 'querySelectorAll');
    const context = providerOutlineContext(page, result, view);
    expect(context.newSources.get(root)?.headSha).toBe(HEAD);
    expect(context.newSources.size).toBe(2);
    expect(scan.mock.calls.filter(([selector]) => selector === 'div[role="group"] > a[href]')).toHaveLength(1);
    expect(scan.mock.calls.filter(([selector]) => selector === 'h1[data-qa="page-header"]')).toHaveLength(1);
    const held = view.readNewSourceFrame?.();if (held === null || held === undefined) throw new Error('Missing held frame');
    const authored = document.createElement('div');authored.className = 'ak-renderer-document';
    group.before(authored);authored.append(group);
    expect(held.current()).toBe(false);
    expect(providerOutlineContext(page, result, view).newSources.size).toBe(0);
    authored.before(group);authored.remove();
    const fakeHeader = heading.cloneNode(true);if (!(fakeHeader instanceof HTMLElement)) throw new Error('Missing copied header');
    const note = document.createElement('section');note.setAttribute('data-testid', 'comment');note.append(fakeHeader);heading.replaceWith(note);
    expect(providerOutlineContext(page, result, view).newSources.size).toBe(0);
    note.replaceWith(heading);

    link.href = `/acme/widgets/src/${MERGE}/`;
    expect(held.current()).toBe(false);
    expect(providerOutlineContext(page, result, view).newSources.size).toBe(0);
    link.href = `/acme/widgets/src/${HEAD}/`;
    const short = describeBitbucketCommitPage(new globalThis.URL(url.replace(HEAD, HEAD.slice(0, 12))));
    if (short === null) throw new Error('Missing short route');
    window.location.href = short.url;
    expect(providerOutlineContext(short, result, view).newSources.size).toBe(0);
    const pr = describeBitbucketPage(new globalThis.URL('https://bitbucket.org/acme/widgets/pull-requests/42'));
    if (pr === null) throw new Error('Missing PR');
    window.location.href = pr.diffPageUrl;
    const prFacts = providerDiffSourceFacts(pr, { kind: 'bitbucket-review', headSha: HEAD, baseSha: BASE, sourceRepository: 'acme/widgets', topic: true }, [{ path: PATH, newPath: PATH }]);
    if (prFacts === null) throw new Error('Missing PR facts');
    expect(providerOutlineContext(pr, { ...result, sourceFacts: prFacts }, view).newSources.size).toBe(0);
  });
});

function gitlabResult(): ProviderDiffResult { return { files: [{ path: PATH, additions: 1, deletions: 0, status: 'modified' }], complete: true, revision: `opaque:${HEAD}` }; }

describe('serialized source facts are validated rather than inferred', () => {
  it.each([39, 41, 63, 65])('rejects a %i-character SHA without altering the count result', (length) => {
    const file = gitlab();
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, comparison: { ...file.sourceFacts.comparison, headSha: 'a'.repeat(length) } })).toBeNull();
  });

  it('accepts exactly 64 hexadecimal characters and rejects cross-provider subject substitution', () => {
    const file = gitlab();const sha = 'a'.repeat(64);
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, subject: { ...file.sourceFacts.subject, headSha: sha }, comparison: { ...file.sourceFacts.comparison, headSha: sha } })?.comparison.headSha).toBe(sha);
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, comparison: { kind: 'bitbucket-commit', headSha: HEAD, baseSha: null } })).toBeNull();
    expect(providerDiffSourceFacts({ ...file.page, provider: 'bitbucket' }, file.sourceFacts.comparison, file.sourceFacts.newPaths)).toBeNull();
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, subject: { ...file.sourceFacts.subject, url: `${URL}#note_1` } })).toBeNull();
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, newPaths: [{ path: PATH, newPath: PATH }, { path: PATH, newPath: 'other.rb' }] })).toBeNull();
  });

  it.each(['../test.rb', '/test.rb', 'spec//test.rb', 'spec/./test.rb', 'spec/../test.rb', 'spec\\test.rb', 'spec/\0test.rb'])('rejects untrusted new path %s', (newPath) => {
    const file = gitlab();
    expect(providerSourcePath(newPath)).toBe(false);
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, newPaths: [{ path: PATH, newPath }] })).toBeNull();
  });

  it('preserves literal percent characters without treating them as encoded path separators', () => {
    const file = gitlab();
    expect(parseProviderDiffSourceFacts({ ...file.sourceFacts, newPaths: [{ path: 'spec/a%2Fb.rb', newPath: 'spec/a%2Fb.rb' }] })?.newPaths[0]?.newPath).toBe('spec/a%2Fb.rb');
  });
});
