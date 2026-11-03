// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeGitLabPage } from './page';
import { readGitLabDiff } from './diff';
import { providerDiffSourceFacts, providerOutlineContext } from '../providers/source-facts';
import type { ProviderDiffResult } from '../providers/types';
import { ProviderWholeSourceCache } from '../providers/whole-source';
import type { ProviderWholeSourceBody, ProviderWholeSourceLease } from '../providers/whole-source';

// Reduced original standalone body/app/header fields from public13215ca4 commit/compare captures
// and installed41344932874 db314bf4 commit. No private HTML, authored body or credentials are required.
const HEAD = '13215ca460cd4f75d3765a882ef486aa2dacf549';
const BASE = '34ef0d2e2808bf3a7347b1b4352ac8babdfb645c';
const PATH = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
const OWNER = 'gitlab-org/gitlab';
const PREFIX = `/${OWNER}/-/`;
const BODY = ['data-project-full-path', 'data-project-id', 'data-page', 'data-page-type-id'];

beforeEach(() => { document.body.replaceChildren();for (const name of BODY) document.body.removeAttribute(name); });
afterEach(() => { document.body.replaceChildren();for (const name of BODY) document.body.removeAttribute(name);vi.restoreAllMocks();vi.unstubAllGlobals(); });

function fixture(kind: 'commit' | 'compare' = 'commit', straight = false, head = HEAD) {
  const route = kind === 'commit' ? `commit/${head}` : `compare/${BASE}...${head}`;
  window.location.href = `https://gitlab.com${PREFIX}${route}${straight ? '?straight=true' : ''}`;
  document.body.setAttribute('data-project-full-path', OWNER);document.body.setAttribute('data-project-id', '278964');document.body.setAttribute('data-page', `projects:${kind}:show`);
  if (kind === 'commit') document.body.setAttribute('data-page-type-id', head);
  const params = kind === 'commit' ? '' : `?from=${BASE}${straight ? '&straight=true' : ''}&to=${head}`;
  const prefix = `${PREFIX}${kind === 'commit' ? `commit/${head}` : 'compare'}/`;
  const appData = {
    diffs_stream_url: kind === 'commit' ? null : `${prefix}diffs_stream${params}&view=inline`,
    reload_stream_url: `${prefix}diffs_stream${params}`, diffs_stats_endpoint: `${prefix}diffs_stats${params}`,
    diff_files_endpoint: `${prefix}diff_files_metadata${params}`, diff_file_endpoint: `${prefix}diff_file${params}`,
    diff_view_type: 'inline', ...(kind === 'commit' ? { noteable_type: 'Commit' } : {}),
  };
  const main = document.createElement('main');main.id = 'content-body';document.body.append(main);
  let compare: HTMLElement | null = null;
  if (kind === 'compare') {
    compare = document.createElement('div');compare.setAttribute('data-gitlab-vue3-app', 'CompareAppRoot');
    compare.innerHTML = `<div data-testid="base-layout-content"><form method="POST" action="${PREFIX}compare" class="js-signature-container"><input type="hidden" name="to_project_id" value="278964"><input type="hidden" name="to" value="${head}"><input type="hidden" name="from_project_id" value="278964"><input type="hidden" name="from" value="${BASE}"><input type="radio" name="straight" value="false" ${straight ? '' : 'checked'}><input type="radio" name="straight" value="true" ${straight ? 'checked' : ''}></form></div>`;
    main.append(compare);
  }
  const app = document.createElement('article');app.setAttribute('data-rapid-diffs', '');app.setAttribute('data-app-data', JSON.stringify(appData));main.append(app);
  const list = document.createElement('div');list.setAttribute('data-diffs-list', '');app.append(list);
  const root = document.createElement('diff-file');root.id = 'native-file';
  const data = { viewer: 'text_inline', old_path: PATH, new_path: PATH, diff_lines_path: `${PREFIX}blob/${head}/${PATH}/diff_lines` };
  root.setAttribute('data-file-data', JSON.stringify(data));
  root.innerHTML = `<article class="rd-diff-file"><div class="rd-diff-file-header-sticky"><header class="rd-diff-file-header" data-testid="rd-diff-file-header" aria-label="Diff file controls"><div class="rd-diff-file-header-main"><h2 class="rd-diff-file-title"><a class="rd-diff-file-link has-tooltip" title="Open file in new tab" target="_blank" href="${PREFIX}blob/${head}/${PATH}">${PATH}</a></h2></div></header></div></article>`;list.append(root);
  const link = root.querySelector<HTMLAnchorElement>('a.rd-diff-file-link');
  const page = describeGitLabPage(new URL(window.location.href), document);const view = readGitLabDiff(document);
  if (page === null || page.kind !== 'commit' && page.kind !== 'compare' || view === null || link === null) throw new Error('Missing standalone fixture');
  const sourceFacts = providerDiffSourceFacts(page, { kind: kind === 'commit' ? 'gitlab-commit' : 'gitlab-compare', headSha: head, baseSha: kind === 'commit' ? null : BASE }, [{ path: PATH, newPath: PATH }]);
  if (sourceFacts === null) throw new Error('Missing acquisition facts');
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 32, deletions: 0, status: 'modified' }], complete: true, revision: 'retained-full-ref-projection', sourceFacts };
  return { page, view, app, appData, root, data, link, compare, result, context: () => providerOutlineContext(page, result, view) };
}

const formats: readonly (readonly ['commit' | 'compare', boolean])[] = [['commit', false], ['compare', false], ['compare', true]];
it.each(formats)('joins the actual retained missing-MR-field %s format, straight=%s, to complete new-head/path facts without a request', (kind, straight) => {
  const read = vi.fn();vi.stubGlobal('fetch', read);const f = fixture(kind, straight);const before = document.body.outerHTML;
  expect(f.context().newSources.get(f.root)).toMatchObject({ repository: f.page.repository, headSha: HEAD, path: PATH });
  expect(document.body.outerHTML).toBe(before);expect(read).not.toHaveBeenCalled();
});
it('accepts the separate actual installed db314bf4 full commit projection', () => {
  const f = fixture('commit', false, 'db314bf4bb01ddcca61c32bc212e86bb82287f33');expect(f.context().newSources.get(f.root)?.headSha).toBe('db314bf4bb01ddcca61c32bc212e86bb82287f33');
});
it.each(formats)('preserves the existing rich native %s witness, straight=%s, without requiring the distinct absent-owner format', (kind, straight) => {
  const f = fixture(kind, straight);
  f.app.setAttribute('data-app-data', JSON.stringify({ project_path: OWNER, versions: { source_versions: [] } }));
  f.root.setAttribute('data-file-data', JSON.stringify({ ...f.data, blob_raw_path: `${PREFIX}raw/${HEAD}/${PATH}`, diff_refs: { head_sha: HEAD } }));
  for (const field of BODY) document.body.removeAttribute(field);f.compare?.remove();f.link.remove();
  expect(f.context().newSources.get(f.root)).toMatchObject({ headSha: HEAD, path: PATH });
});
it.each(['data-project-full-path', 'data-project-id', 'data-page', 'data-page-type-id'])('does not substitute URL or authored owner fields for missing %s', (field) => {
  const f = fixture();document.body.removeAttribute(field);const authored = document.createElement('div');authored.className = 'note-text md';authored.setAttribute(field, field === 'data-project-full-path' ? OWNER : HEAD);document.body.append(authored);expect(f.context().newSources.size).toBe(0);
});
it.each([['data-project-full-path', 'other/fork'], ['data-project-id', '0'], ['data-page', 'projects:merge_requests:show'], ['data-page-type-id', BASE], ['data-page-type-id', HEAD.slice(0, 8)]])('rejects contradictory native body %s=%s', (field, value) => {
  const f = fixture();document.body.setAttribute(field, value);expect(f.context().newSources.size).toBe(0);
});
it.each([null, '', 'gitlab', 'other/fork', {}])('never repairs a present contradictory app owner %j', (owner) => {
  const f = fixture();f.app.setAttribute('data-app-data', JSON.stringify({ ...f.appData, project_path: owner }));expect(f.context().newSources.size).toBe(0);
});
it('never repairs a failed present-owner rich witness through the otherwise valid absent-owner structure', () => {
  const f = fixture();f.app.setAttribute('data-app-data', JSON.stringify({ ...f.appData, project_path: OWNER }));
  expect(f.context().newSources.size).toBe(0);
  f.root.setAttribute('data-file-data', JSON.stringify({ ...f.data, blob_raw_path: `${PREFIX}raw/${BASE}/${PATH}`, diff_refs: { head_sha: HEAD } }));expect(f.context().newSources.size).toBe(0);
});
it.each([{ versions: {} }, { mr_path: `/${OWNER}/-/merge_requests/1` }, { is_fork: true }, { noteable_type: 'MergeRequest' }])('rejects mixed MR or fork fields in the distinct absent-owner format: %j', (fields) => {
  const f = fixture();f.app.setAttribute('data-app-data', JSON.stringify({ ...f.appData, ...fields }));expect(f.context().newSources.size).toBe(0);
});
it('requires the independent full commit body identity rather than promoting a short route or symbolic ref', () => {
  const f = fixture();window.location.href = f.page.url.replace(HEAD, HEAD.slice(0, 8));expect(f.context().newSources.size).toBe(0);
});
it.each(['other owner', 'other head', 'duplicate query', 'foreign origin', 'credentials', 'fragment', 'missing'])('rejects %s in original immutable app endpoints', (fault) => {
  const f = fixture();const endpoint = f.appData.diff_files_endpoint;
  const value = fault === 'other owner' ? endpoint.replace(OWNER, 'other/fork') : fault === 'other head' ? endpoint.replace(HEAD, BASE) : fault === 'duplicate query' ? endpoint + '?w=0&w=0' : fault === 'foreign origin' ? 'https://evil.example' + endpoint : fault === 'credentials' ? 'https://user:password@gitlab.com' + endpoint : fault === 'fragment' ? endpoint + '#unscoped' : null;
  f.app.setAttribute('data-app-data', JSON.stringify({ ...f.appData, diff_files_endpoint: value }));expect(f.context().newSources.size).toBe(0);
});
it.each(['raw wrong head', 'raw wrong owner', 'raw null', 'refs wrong head', 'refs null', 'refs malformed base', 'lines wrong path', 'short lines head'])('rejects present %s instead of repairing it through a matching header', (fault) => {
  const f = fixture();const additions = fault === 'raw wrong head' ? { blob_raw_path: `${PREFIX}raw/${BASE}/${PATH}` } : fault === 'raw wrong owner' ? { blob_raw_path: `/other/fork/-/raw/${HEAD}/${PATH}` } : fault === 'raw null' ? { blob_raw_path: null } : fault === 'refs wrong head' ? { diff_refs: { head_sha: BASE } } : fault === 'refs null' ? { diff_refs: null } : fault === 'refs malformed base' ? { diff_refs: { head_sha: HEAD, base_sha: 'short' } } : fault === 'lines wrong path' ? { diff_lines_path: `${PREFIX}blob/${HEAD}/other_spec.rb/diff_lines` } : { diff_lines_path: f.data.diff_lines_path.replace(HEAD, HEAD.slice(0, 8)) };
  f.root.setAttribute('data-file-data', JSON.stringify({ ...f.data, ...additions }));expect(f.context().newSources.size).toBe(0);
});
it('cross-checks optional valid raw/ref fields without changing their new-side semantics', () => {
  const f = fixture();f.root.setAttribute('data-file-data', JSON.stringify({ ...f.data, blob_raw_path: `${PREFIX}raw/${HEAD}/${PATH}`, diff_refs: { head_sha: HEAD, base_sha: BASE, start_sha: BASE } }));expect(f.context().newSources.size).toBe(1);
});
it.each(['duplicate', 'foreign', 'wrong head', 'query', 'authored', 'gone'])('rejects %s generated header identity', (fault) => {
  const f = fixture();if (fault === 'duplicate') f.link.after(f.link.cloneNode(true));else if (fault === 'foreign') f.link.href = 'https://evil.example' + f.link.getAttribute('href');else if (fault === 'wrong head') f.link.href = f.link.href.replace(HEAD, BASE);else if (fault === 'query') f.link.href += '?ref=' + HEAD;else if (fault === 'authored') f.link.closest('article')?.classList.add('md');else f.link.remove();expect(f.context().newSources.size).toBe(0);
});
it.each(['note', 'form', 'inert', 'hidden', 'owned'])('never grants the matching native app inside %s scope', (scope) => {
  const f = fixture();const wrapper = document.createElement(scope === 'form' ? 'form' : 'div');if (scope === 'note') wrapper.className = 'note-text';if (scope === 'inert') wrapper.inert = true;if (scope === 'hidden') wrapper.hidden = true;if (scope === 'owned') wrapper.setAttribute('data-geld-ui', '');f.app.before(wrapper);wrapper.append(f.app);expect(f.context().newSources.size).toBe(0);
});
it.each(['to_project_id', 'from_project_id', 'to', 'from'])('rejects stale or foreign native compare %s', (name) => {
  const f = fixture('compare');const input = f.compare?.querySelector<HTMLInputElement>(`input[name="${name}"]`);if (input === null || input === undefined) throw new Error('Missing native field');input.value = name.endsWith('project_id') ? '999' : BASE === input.value ? HEAD : BASE;expect(f.context().newSources.size).toBe(0);
});
it('does not inherit a comparison from cross-project parameters, duplicate selections or an authored compare form', () => {
  const f = fixture('compare');const held = f.view.readNewSourceFrame?.();expect(held?.current()).toBe(true);const input = f.compare?.querySelector('input[name="to"]');if (input === null || input === undefined) throw new Error('Missing selection');input.after(input.cloneNode(true));expect(held?.current()).toBe(false);expect(f.context().newSources.size).toBe(0);input.nextElementSibling?.remove();f.compare?.classList.add('md');expect(f.context().newSources.size).toBe(0);
  f.compare?.classList.remove('md');window.location.href += '?from_project_id=278964';expect(f.context().newSources.size).toBe(0);
});
it('captures live native compare values/checked state and never interacts with the original form', () => {
  const f = fixture('compare');const submit = vi.fn();f.compare?.querySelector('form')?.addEventListener('submit', submit);const held = f.view.readNewSourceFrame?.();const radio = f.compare?.querySelector<HTMLInputElement>('input[name="straight"][value="true"]');if (radio === null || radio === undefined) throw new Error('Missing native mode');radio.checked = true;expect(held?.current()).toBe(false);expect(f.context().newSources.size).toBe(0);expect(submit).not.toHaveBeenCalled();
});
it.each(['body owner', 'body object', 'app data', 'app parent', 'duplicate app', 'URL', 'form identity'])('retires a held comparison frame after %s changes', (fault) => {
  const f = fixture('compare');const held = f.view.readNewSourceFrame?.();expect(held?.current()).toBe(true);
  if (fault === 'body owner') document.body.setAttribute('data-project-full-path', 'other/fork');else if (fault === 'body object') document.body.replaceWith(document.body.cloneNode(true));else if (fault === 'app data') f.app.setAttribute('data-app-data', JSON.stringify({ ...f.appData, reload_stream_url: '/other/fork/-/compare/diffs_stream' }));else if (fault === 'app parent') { const wrapper = document.createElement('div');f.app.before(wrapper);wrapper.append(f.app); }else if (fault === 'duplicate app') f.app.after(f.app.cloneNode(true));else if (fault === 'URL') window.location.href += '#different-visit';else { const form = f.compare?.querySelector('form');form?.replaceWith(form.cloneNode(true)); }
  expect(held?.current()).toBe(false);
});
it('rechecks live file data and the original generated href on each read and during a read', () => {
  const f = fixture();const held = f.view.readNewSourceFrame?.();const entry = f.view.entries[0];if (held === undefined || held === null || entry === undefined) throw new Error('Missing native frame');expect(held.read(entry)).not.toBeNull();f.link.href = f.link.href.replace(HEAD, BASE);expect(held.read(entry)).toBeNull();f.link.href = `${PREFIX}blob/${HEAD}/${PATH}`;
  const get = f.link.getAttribute.bind(f.link);vi.spyOn(f.link, 'getAttribute').mockImplementation((name) => { const value = get(name);if (name === 'href') f.link.replaceWith(f.link.cloneNode(true));return value; });expect(held.read(entry)).toBeNull();
});
it('preserves complete/new-path/deleted/filtered guards even with an affirmative standalone owner', () => {
  const f = fixture();const withoutFacts: ProviderDiffResult = { files: f.result.files, complete: true, revision: f.result.revision };
  expect(providerOutlineContext(f.page, { ...f.result, complete: false }, f.view).newSources.size).toBe(0);expect(providerOutlineContext(f.page, withoutFacts, f.view).newSources.size).toBe(0);expect(providerOutlineContext(f.page, { ...f.result, files: [{ path: PATH, status: 'deleted', additions: 0, deletions: 32 }] }, f.view).newSources.size).toBe(0);expect(providerOutlineContext(f.page, f.result, { ...f.view, filteredPaths: new Set([PATH]) }).newSources.size).toBe(0);
});
it('batches document identity scans instead of repeating them for every standalone file', () => {
  const f = fixture('compare');const extra = f.root.cloneNode(true);if (!(extra instanceof HTMLElement)) throw new Error('Missing native file clone');extra.id = 'second-native-file';f.root.after(extra);
  const otherPath = 'spec/other_spec.rb';extra.setAttribute('data-file-data', JSON.stringify({ ...f.data, old_path: otherPath, new_path: otherPath, diff_lines_path: f.data.diff_lines_path.replace(PATH, otherPath) }));const link = extra.querySelector<HTMLAnchorElement>('a.rd-diff-file-link');if (link === null) throw new Error('Missing other native header');link.href = `${PREFIX}blob/${HEAD}/${otherPath}`;
  const scan = vi.spyOn(document, 'querySelectorAll');const one = f.context();expect(one.newSources.size).toBe(1);
  const first = scan.mock.calls.filter(([selector]) => selector === '[data-rapid-diffs][data-app-data]').length;scan.mockClear();
  const view = readGitLabDiff(document);if (view === null || f.result.sourceFacts === undefined) throw new Error('Missing remounted diff');const both = providerOutlineContext(f.page, { ...f.result, files: [...f.result.files, { path: otherPath, additions: 1, deletions: 0 }], sourceFacts: { ...f.result.sourceFacts, newPaths: [...f.result.sourceFacts.newPaths, { path: otherPath, newPath: otherPath }] } }, view);expect(both.newSources.size).toBe(2);
  expect(scan.mock.calls.filter(([selector]) => selector === '[data-rapid-diffs][data-app-data]')).toHaveLength(first);
});

function lease(f: ReturnType<typeof fixture>): ProviderWholeSourceLease {
  const initial = f.context();const revision = initial.newSources.get(f.root);if (revision === undefined) throw new Error('No exact source lease');
  return { revision, root: f.root, subjectKey: initial.subjectKey, current: () => { const context = f.context();return context.subjectKey === initial.subjectKey && context.newSources.get(f.root)?.key === revision.key; } };
}
it('does not dispatch a queued whole-body reader after owner authority changes', async () => {
  const f = fixture();const read = vi.fn(async () => ({ lines: ['immutable'], bytes: 9 }));const cache = new ProviderWholeSourceCache(read);const pending = cache.load(lease(f), new AbortController().signal);document.body.setAttribute('data-project-full-path', 'other/fork');await expect(pending).rejects.toMatchObject({ name: 'AbortError' });expect(read).not.toHaveBeenCalled();cache.destroy();
});
it('rejects an asynchronous body when native compare selection changes, while unchanged leases may use the bounded cache', async () => {
  const f = fixture('compare');let finish: ((body: ProviderWholeSourceBody) => void) | undefined;const read = vi.fn(() => new Promise<ProviderWholeSourceBody>((resolve) => { finish = resolve; }));const cache = new ProviderWholeSourceCache(read);const pending = cache.load(lease(f), new AbortController().signal);await Promise.resolve();if (finish === undefined) throw new Error('Reader did not start');const input = f.compare?.querySelector<HTMLInputElement>('input[name="to"]');if (input === null || input === undefined) throw new Error('Missing selection');input.value = BASE;finish({ lines: ['immutable'], bytes: 9 });await expect(pending).rejects.toMatchObject({ name: 'AbortError' });cache.destroy();
  document.body.replaceChildren();for (const name of BODY) document.body.removeAttribute(name);const next = fixture();const success = vi.fn(async () => ({ lines: ['immutable'], bytes: 9 }));const ready = new ProviderWholeSourceCache(success);const valid = lease(next);await expect(ready.load(valid, new AbortController().signal)).resolves.toMatchObject({ lines: ['immutable'] });await ready.load(valid, new AbortController().signal);expect(success).toHaveBeenCalledTimes(1);next.link.href = next.link.href.replace(HEAD, BASE);await expect(ready.load(valid, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });expect(success).toHaveBeenCalledTimes(1);ready.destroy();
});
