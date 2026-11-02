import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { GITLAB_FILE_SEARCH as fixture, gitLabFileSearchSnapshot, gitLabFileSearchSelection, assertGitLabFileSearchScope, verifyGitLabFileSearch } from './gitlab-file-search.mjs';

const keys = ['document', 'location', 'getComputedStyle', 'innerWidth', 'innerHeight'];
const globals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let window;
beforeEach(() => {
  window = new Window({ url: fixture.url });
  for (const [key, value] of Object.entries({ document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1440, innerHeight: 1000 })) Object.defineProperty(globalThis, key, { configurable: true, value });
});
afterEach(() => {
  delete globalThis.__geldFileSearchProof;
  for (const [key, descriptor] of globals) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
  window.happyDOM.abort();
});

function nativeApp(merge = false) {
  const source = { id: Number(fixture.version), head_sha: fixture.head, selected: true, href: new URL(fixture.url).pathname + '?diff_id=' + fixture.version, is_merge_head: false, version_index: 2 };
  const target = merge ? { ...source, id: 2158521027, head_sha: '13215ca460cd4f75d3765a882ef486aa2dacf549', href: new URL(fixture.url).pathname, is_merge_head: true, is_head: true, is_base: false } : { ...source, href: new URL(fixture.url).pathname, is_head: false, is_base: true };
  return { path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, sourceVersions: [source], targetVersions: [target] };
}
function mountNativeApp(app = nativeApp()) {
  const node = document.createElement('article');node.setAttribute('data-rapid-diffs', '');node.setAttribute('data-app-data', JSON.stringify({ mr_path: app.path, iid: app.iid, versions: { source_versions: app.sourceVersions, target_versions: app.targetVersions } }));document.body.prepend(node);
}

function nativeFixture() {
  // Reduced retained native structure with explicit unit-only geometry, not browser acceptance.
  document.body.innerHTML = `<section data-testid="file-tree-container"><input type="search" data-testid="diff-tree-search" aria-label="Search (e.g. *.vue) (F)"><nav class="mr-tree-list" aria-label="File tree"><div data-testid="file-row-container"><a data-testid="file-row" data-file-row="${fixture.anchor}" href="${fixture.url}&file_path=${encodeURIComponent(fixture.path)}#${fixture.anchor}">issue_move_list_spec.rb</a></div></nav><nav class="geld-provider-categories" data-geld-ui><section class="geld-provider-category" data-active="true"><button class="geld-provider-category-header" aria-expanded="true">Tests (1 test)</button><button class="geld-provider-category-folder" aria-expanded="false"><span class="geld-provider-category-folder-label">${fixture.path.slice(0, fixture.path.lastIndexOf('/'))}</span></button><ul hidden><li data-geld-category-path="${fixture.path}"><a aria-current="true" href="#${fixture.anchor}">test</a></li></ul></section></nav></section><diff-file id="${fixture.anchor}"><details data-file-body open><table><tbody><tr><td class="rd-line-text">RSpec.describe IssueMoveList</td></tr></tbody></table><input type="checkbox" id="viewed" disabled></details></diff-file>`;
  mountNativeApp();
  document.querySelector('diff-file').setAttribute('data-file-data', JSON.stringify({ new_path: fixture.path, diff_refs: { head_sha: fixture.head }, code_review_id: '019271d5e9aaae129d85f3585c16c1acf7a767cd' }));
  for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => ({ left: 20, right: 140, top: 20, bottom: 40, x: 20, y: 20, width: 120, height: 20 });
}

test('reads actual native search/result/diff provenance and the custom owned folder without changing source', () => {
  nativeFixture();const before = document.body.innerHTML;
  const value = gitLabFileSearchSnapshot(fixture);assertGitLabFileSearchScope(value);
  assert.equal(value.native.resultCount, 1);assert.equal(value.native.anchor, fixture.anchor);
  assert.equal(value.owned.current, 'true');assert.equal(value.owned.folder.expanded, 'false');
  assert.equal(value.source.open, true);assert.equal(value.source.codeVisible, true);assert.equal(value.source.codeInViewport, true);
  assert.equal(document.body.innerHTML, before);
});

test('binds a retained merge-result rendering separately from the pinned source revision', () => {
  nativeFixture();document.querySelector('[data-rapid-diffs]').remove();mountNativeApp(nativeApp(true));
  const root = document.querySelector('diff-file');const data = JSON.parse(root.getAttribute('data-file-data'));data.diff_refs.head_sha = nativeApp(true).targetVersions[0].head_sha;root.setAttribute('data-file-data', JSON.stringify(data));
  const snapshot = gitLabFileSearchSnapshot(fixture);assertGitLabFileSearchScope(snapshot);
  const selection = gitLabFileSearchSelection(snapshot);
  assert.equal(selection.source.id, 2158520123);assert.equal(selection.source.head_sha, fixture.head);
  assert.equal(selection.target.id, 2158521027);assert.notEqual(selection.target.head_sha, fixture.head);
});

for (const [name, mutate] of [
  ['missing versions', (app) => { delete app.sourceVersions; }],
  ['malformed source array', (app) => { app.sourceVersions = {}; }],
  ['malformed target record', (app) => { app.targetVersions = [null]; }],
  ['ambiguous selected source', (app) => { app.sourceVersions.push({ ...app.sourceVersions[0], id: 1 }); }],
  ['ambiguous selected target', (app) => { app.targetVersions.push({ ...app.targetVersions[0], id: 1 }); }],
  ['duplicate source ID', (app) => { app.sourceVersions.push({ ...app.sourceVersions[0], selected: false }); }],
  ['duplicate target ID', (app) => { app.targetVersions.push({ ...app.targetVersions[0], selected: false }); }],
  ['nonboolean selection flag', (app) => { app.sourceVersions[0].selected = 'true'; }],
  ['malformed native ID', (app) => { app.sourceVersions[0].id = '02158520123'; }],
  ['malformed MR iid', (app) => { app.iid = [266334]; }],
  ['missing source head', (app) => { delete app.sourceVersions[0].head_sha; }],
  ['malformed unselected source head', (app) => { app.sourceVersions.push({ ...app.sourceVersions[0], id: 1, selected: false, head_sha: 123 }); }],
  ['another pinned source', (app) => { app.sourceVersions[0].id = 1; }],
  ['conflicting pinned source head', (app) => { app.sourceVersions[0].head_sha = 'a'.repeat(40); }],
  ['conflicting same-version target head', (app) => { app.targetVersions[0].head_sha = 'a'.repeat(40); }],
  ['conflicting unselected source/target heads', (app) => { app.sourceVersions.push({ ...app.sourceVersions[0], id: 1, selected: false });app.targetVersions.push({ ...app.targetVersions[0], id: 1, selected: false, head_sha: 'a'.repeat(40) }); }],
  ['conflicting unselected source/target kinds', (app) => { app.sourceVersions.push({ ...app.sourceVersions[0], id: 1, selected: false });app.targetVersions.push({ ...app.targetVersions[0], id: 1, selected: false, is_merge_head: true }); }],
  ['unknown target kind', (app) => { delete app.targetVersions[0].is_merge_head; }],
  ['unexplained different target revision', (app) => { app.targetVersions[0].id = 1; }],
  ['different source href revision', (app) => { app.sourceVersions[0].href = '/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=1'; }],
  ['external target href', (app) => { app.targetVersions[0].href = 'https://evil.example/gitlab-org/gitlab/-/merge_requests/266334/diffs'; }],
]) test(`rejects ${name} instead of guessing source/target provenance`, () => {
  nativeFixture();const snapshot = gitLabFileSearchSnapshot(fixture);mutate(snapshot.app);
  assert.throws(() => assertGitLabFileSearchScope(snapshot));
});

test('does not adopt projected clones or a changed native result revision as original search results', () => {
  nativeFixture();const link = document.querySelector('[data-file-row]');
  link.closest('[data-testid="file-row-container"]').setAttribute('data-geld-ui', '');
  assert.equal(gitLabFileSearchSnapshot(fixture).native.resultCount, 0);
  link.parentElement.removeAttribute('data-geld-ui');link.href = link.href.replace(fixture.version, '123');
  assert.equal(gitLabFileSearchSnapshot(fixture).native.resultCount, 0);
});

for (const [name, mutate] of [
  ['another MR', () => window.history.replaceState(null, '', '/gitlab-org/gitlab/-/merge_requests/1/diffs?diff_id=' + fixture.version)],
  ['changed selected revision', () => window.history.replaceState(null, '', '/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=123')],
  ['conflicting native head', () => document.querySelector('diff-file').setAttribute('data-file-data', JSON.stringify({ new_path: fixture.path, diff_refs: { head_sha: 'a'.repeat(40) } }))],
  ['duplicate original search', () => document.querySelector('input').after(document.querySelector('input').cloneNode(true))],
  ['missing file body provenance', () => document.querySelector('diff-file').setAttribute('data-file-data', '{}')],
]) test(`scope rejects ${name}`, () => {
  nativeFixture();mutate();assert.throws(() => assertGitLabFileSearchScope(gitLabFileSearchSnapshot(fixture)));
});

test('requires exact original native input, list, root and checkbox identities once bound', () => {
  nativeFixture();
  const host = document.querySelector('section');const input = host.querySelector('input');const nav = host.querySelector('nav');const root = document.querySelector('diff-file');
  globalThis.__geldFileSearchProof = { host, hostParent: host.parentElement, input, inputParent: input.parentElement, nav, navParent: nav.parentElement, root, rootParent: root.parentElement, boxes: [...root.querySelectorAll('input')], events: [] };
  assertGitLabFileSearchScope(gitLabFileSearchSnapshot(fixture));
  const replacement = input.cloneNode(true);replacement.getBoundingClientRect = input.getBoundingClientRect;input.replaceWith(replacement);assert.throws(() => assertGitLabFileSearchScope(gitLabFileSearchSnapshot(fixture)), /Original native nodes/);
});

function protocol(options = {}) {
  let query = options.initialQuery ?? '';let selected = false;let collapsed = false;let active = false;let focused = false;let shift = false;let proof = false;let nativeSelected = false;let cleaned = false;
  const calls = [];const events = [];let filterReads = 0;
  const polls = [];
  const read = () => {
    if (query) filterReads += 1;
    return ({
    app: options.targetChanged && nativeSelected ? nativeApp(true) : { ...nativeApp(), ...(options.targetMetadataChanged && nativeSelected ? { targetVersions: [{ ...nativeApp().targetVersions[0], is_base: false }] } : {}), ...(options.sourceMetadataChanged && nativeSelected ? { sourceVersions: [{ ...nativeApp().sourceVersions[0], version_index: 3 }] } : {}) },
    url: (options.filterNavigation && query ? fixture.url.replace('/266334/', '/266335/') : fixture.url) + (selected ? `${nativeSelected ? '&file_path=' + encodeURIComponent(fixture.path) : ''}#${fixture.anchor}` : ''),
    unique: { host: 1, input: 1, nav: 1, roots: 1 },
    search: { value: query, label: 'Search (e.g. *.vue) (F)', visible: true, focused },
    native: { paths: options.unfilteredResults || query && filterReads <= (options.pendingReads ?? 0) ? [fixture.path, 'app/another.rb'] : [fixture.path], resultCount: 1, visible: Boolean(query), listMarker: query ? null : 'native', anchor: fixture.anchor },
    owned: { count: query ? 0 : 1, active: active ? 'true' : 'false', current: selected && !(options.currentLost && nativeSelected && !query) ? 'true' : null, folder: { label: fixture.path.slice(0, fixture.path.lastIndexOf('/')), expanded: collapsed && !(options.collapseReset && nativeSelected && !query) ? 'false' : 'true' }, headers: [{ text: 'Essential (2 files)', expanded: active ? 'false' : 'true' }, { text: 'Tests (1 test)', expanded: active ? 'true' : 'false' }] },
    source: { id: fixture.anchor, path: fixture.path, head: fixture.head, review: '019271d5e9aaae129d85f3585c16c1acf7a767cd', raw: options.changedSource && nativeSelected ? 'changed payload' : 'original payload', boxes: [{ id: 'viewed', checked: false }], visible: active, open: active, codeVisible: active, codeInViewport: active },
    identity: proof ? { input: (!options.replacedInput || !query) && !(options.pendingIdentityChanged && query && filterReads === 2), host: true, nav: true, root: true, boxes: true } : null,
    events: [...events],
  }); };
  const page = {
    isClosed: () => false,
    evaluate: async (fn) => { if (fn === gitLabFileSearchSnapshot) return read();if (String(fn).includes('delete globalThis.__geldFileSearchProof')) { if (options.listenerRemovalFails) throw new Error('Listener cleanup failed');cleaned = true;return { hadProof: proof, removedTypes: proof ? ['click', 'focusin', 'focusout', 'input', 'keydown'] : [], proofAbsent: true }; }proof = true; },
    $eval: async (_selector, fn) => String(fn).includes('unobstructed') ? { unique: 1, unobstructed: !options.obstructed } : undefined,
    click: async (selector) => {
      calls.push(selector);
      if (selector.includes('diff-tree-search')) { focused = true;return; }
      if (selector.includes('category-folder')) { collapsed = true;return; }
      if (selector.includes('data-file-row')) { nativeSelected = true;events.push({ type: 'click', native: fixture.anchor, trusted: !options.untrustedNative });return; }
      if (selector.includes('category-native-row')) selected = true;
    },
    keyboard: {
      down: async (key) => { if (key === 'Shift') shift = true; },
      up: async (key) => { if (key === 'Shift') shift = false; },
      type: async (text) => { calls.push(`type:${text}`);query = text;events.push({ type: 'input', input: true, trusted: !options.untrustedInput }); },
      press: async (key) => { calls.push(key);if (key === 'Enter') active = true;if (key === 'Tab') focused = shift;if (key === 'Backspace') { if (!options.noClearKey) events.push({ type: 'keydown', trusted: true, input: true, key: 'Backspace', value: query });if (!options.noClear) query = '';if (!options.noClearInput) events.push({ type: 'input', trusted: true, input: true, key: null, value: query }); } },
    },
  };
  const progress = {};
  const dependencies = { progress, poll: async (get, accepts, label) => { for (let index = 0; index < 6; index += 1) { const value = await get();polls.push({ label, paths: value.native.paths });if (accepts(value)) return value; }throw new Error(`Protocol deadline: ${label}`); }, capture: async (_page, name) => { if (options.captureThrows) throw new Error('Capture failed');return { name }; }, totals: async () => ({ all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 } }) };
  return { page, dependencies, progress, calls, polls, cleaned: () => cleaned, query: () => query };
}

test('protocol uses real input paths and demands collapsed/current recovery with source identity, then removes instrumentation', async () => {
  const p = protocol();await verifyGitLabFileSearch(p.page, p.dependencies);
  assert.equal(p.progress.restored.owned.folder.expanded, 'false');assert.equal(p.progress.restored.owned.current, 'true');
  assert.ok(p.calls.includes('Tab'));assert.ok(p.calls.includes('type:' + fixture.query));assert.ok(p.calls.includes('KeyA'));assert.ok(p.calls.includes('Backspace'));
  assert.equal(p.cleaned(), true);assert.equal(p.query(), '');assert.match(p.progress.proof, /Not browser Ctrl\+F/);
});

for (const [name, options] of [
  ['folder preferences reset', { collapseReset: true }],
  ['old current-file preference lost', { currentLost: true }],
  ['native source mutated', { changedSource: true }],
  ['native input replaced', { replacedInput: true }],
  ['untrusted typing', { untrustedInput: true }],
  ['untrusted native result click', { untrustedNative: true }],
  ['obstructed action', { obstructed: true }],
  ['unfiltered native results', { unfilteredResults: true }],
  ['selected target changed during search', { targetChanged: true }],
  ['native target metadata changed at the same head', { targetMetadataChanged: true }],
  ['native source metadata changed at the same head', { sourceMetadataChanged: true }],
]) test(`protocol rejects ${name} and performs cleanup`, async () => {
  const p = protocol(options);await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.equal(p.cleaned(), true);
  const unsafe = options.changedSource || options.replacedInput || options.targetChanged || options.targetMetadataChanged || options.sourceMetadataChanged;
  assert.equal(p.query(), unsafe ? fixture.query : '');
});


test('protocol waits through pending unrelated rows to the exact native result before activating it', async () => {
  const p = protocol({ pendingReads: 3 });await verifyGitLabFileSearch(p.page, p.dependencies);
  assert.deepEqual(p.progress.searchPending.native.paths, [fixture.path, 'app/another.rb']);
  assert.deepEqual(p.progress.search.native.paths, [fixture.path]);
  assert.ok(p.polls.filter((poll) => poll.label.includes('settles to') && poll.paths.length > 1).length >= 3);
  assert.equal(p.progress.clear.status, 'verified');assert.equal(p.progress.cleanup.status, 'verified');
  assert.equal(p.progress.cleanup.after.owned.folder.expanded, 'false');
  assert.equal(p.progress.cleanup.after.owned.current, 'true');
  assert.equal(p.progress.cleanup.listeners.proofAbsent, true);
  assert.ok(p.progress.clear.events.some((event) => event.type === 'input' && event.trusted && event.value === ''));
});

test('permanently unrelated rows fail the deadline, preserve the last observation and record real finally cleanup', async () => {
  const p = protocol({ unfilteredResults: true });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies), /Protocol deadline/);
  assert.deepEqual(p.progress.searchLatest.native.paths, [fixture.path, 'app/another.rb']);
  assert.equal(p.progress.search, undefined);assert.equal(p.progress.activated, undefined);
  assert.equal(p.progress.cleanupClear.status, 'verified');assert.equal(p.progress.cleanup.status, 'verified');
  assert.equal(p.progress.cleanup.after.search.value, '');assert.equal(p.progress.cleanup.after.owned.folder.expanded, 'false');
  assert.ok(p.progress.cleanupClear.events.some((event) => event.type === 'keydown' && event.trusted && event.key === 'Backspace'));
  assert.equal(p.cleaned(), true);
});

test('pending observations enforce original ownership before a later matching result can pass', async () => {
  const p = protocol({ pendingReads: 3, pendingIdentityChanged: true });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.equal(p.progress.searchLatest.identity.input, false);assert.equal(p.progress.search, undefined);assert.equal(p.cleaned(), true);
});

test('changed subject during pending search never clears a different native input', async () => {
  const p = protocol({ filterNavigation: true });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.equal(p.progress.cleanup.status, 'skipped_changed_scope');assert.equal(p.calls.includes('Backspace'), false);assert.equal(p.cleaned(), true);
});

test('a preexisting native query stays untouched when preparation refuses the fixture', async () => {
  const p = protocol({ initialQuery: 'original reader search' });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies), /must start empty/);
  assert.equal(p.progress.cleanup.status, 'skipped_unowned_query');assert.equal(p.calls.includes('Backspace'), false);assert.equal(p.query(), 'original reader search');
});

for (const [name, options] of [
  ['missing trusted clear input', { noClearInput: true }],
  ['missing trusted Backspace', { noClearKey: true }],
  ['query refuses to clear', { noClear: true }],
  ['listener removal fails', { listenerRemovalFails: true }],
]) test(`cleanup does not conceal ${name}`, async () => {
  const p = protocol(options);await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  if (options.noClear || options.listenerRemovalFails) assert.equal(p.progress.cleanup.status, 'failed');
  else assert.equal(p.progress.clear.status, 'pending');
  if (!options.listenerRemovalFails) assert.equal(p.cleaned(), true);
});

test('an unrelated original failure is retained while finally clears the actual native query', async () => {
  const p = protocol({ captureThrows: true });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies), /Capture failed/);
  assert.equal(p.progress.cleanupClear.status, 'verified');assert.equal(p.progress.cleanup.status, 'verified');assert.equal(p.query(), '');assert.equal(p.cleaned(), true);
});
