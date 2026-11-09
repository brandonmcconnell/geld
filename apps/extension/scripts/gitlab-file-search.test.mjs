import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { GITLAB_FILE_SEARCH as fixture, gitLabFileSearchSnapshot, bindGitLabFileSearchProof, markGitLabFileSearchPhase, gitLabFileSearchSelection, assertGitLabFileSearchScope, verifyGitLabFileSearch } from './gitlab-file-search.mjs';

const keys = ['document', 'location', 'getComputedStyle', 'innerWidth', 'innerHeight', 'Element', 'KeyboardEvent', 'window'];
const globals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let window;
beforeEach(() => {
  window = new Window({ url: fixture.url });
  for (const [key, value] of Object.entries({ document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1440, innerHeight: 1000, Element: window.Element, KeyboardEvent: window.KeyboardEvent, window })) Object.defineProperty(globalThis, key, { configurable: true, value });
});
afterEach(() => {
  globalThis.__geldFileSearchProof?.releaseDiagnostics?.();
  if (globalThis.__geldFileSearchProof?.listen !== undefined) for (const type of ['click', 'focusin', 'focusout', 'input', 'keydown']) document.removeEventListener(type, globalThis.__geldFileSearchProof.listen, true);
  delete globalThis.__geldFileSearchProof;
  for (const [key, descriptor] of globals) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
  window.happyDOM.abort();
});

function nativeApp(merge = false) {
  const source = { id: Number(fixture.version), head_sha: fixture.head, selected: true, href: new URL(fixture.url).pathname + '?diff_id=' + fixture.version, is_merge_head: false, version_index: 2 };
  const target = merge ? { ...source, id: 2158521027, head_sha: '13215ca460cd4f75d3765a882ef486aa2dacf549', href: new URL(fixture.url).pathname, is_merge_head: true, is_head: true, is_base: false } : { ...source, href: new URL(fixture.url).pathname, is_head: false, is_base: true };
  return { path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, fileByFileMode: false, sourceVersions: [source], targetVersions: [target] };
}
function mountNativeApp(app = nativeApp()) {
  const node = document.createElement('article');node.setAttribute('data-rapid-diffs', '');node.setAttribute('data-app-data', JSON.stringify({ mr_path: app.path, iid: app.iid, file_by_file_mode: app.fileByFileMode, versions: { source_versions: app.sourceVersions, target_versions: app.targetVersions } }));document.body.prepend(node);
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
  const calls = [];const events = [];let filterReads = 0;let remounted = false;
  const polls = [];
  const read = () => {
    if (query) filterReads += 1;
    return ({
    app: options.targetChanged && nativeSelected ? nativeApp(true) : { ...nativeApp(), ...(Object.hasOwn(options, 'mode') ? { fileByFileMode: options.mode } : {}), ...(options.modeChanges && nativeSelected ? { fileByFileMode: true } : {}), ...(options.targetMetadataChanged && nativeSelected ? { targetVersions: [{ ...nativeApp().targetVersions[0], is_base: false }] } : {}), ...(options.sourceMetadataChanged && nativeSelected ? { sourceVersions: [{ ...nativeApp().sourceVersions[0], version_index: 3 }] } : {}) },
    url: (options.filterNavigation && query ? fixture.url.replace('/266334/', '/266335/') : fixture.url) + (selected ? `${nativeSelected && (options.presentFilePath || options.wrongFilePath || options.duplicateFilePath) ? '&file_path=' + encodeURIComponent(options.wrongFilePath ? 'other.rb' : fixture.path) + (options.duplicateFilePath ? '&file_path=' + encodeURIComponent(fixture.path) : '') : ''}#${fixture.anchor}` : ''),
    unique: { host: 1, input: 1, nav: 1, roots: 1 },
    search: { value: query, label: 'Search (e.g. *.vue) (F)', visible: true, focused },
    native: { paths: options.unfilteredResults || query && filterReads <= (options.pendingReads ?? 0) ? [fixture.path, 'app/another.rb'] : [fixture.path], resultCount: 1, active: options.nativeAlreadyActive || nativeSelected && !options.missingNativeActive, visible: Boolean(query), listMarker: query ? null : 'native', anchor: fixture.anchor, href: `${fixture.url}&file_path=${encodeURIComponent(fixture.path)}#${fixture.anchor}` },
    owned: { count: query ? 0 : 1, active: active ? 'true' : 'false', current: selected && !(options.currentLost && nativeSelected && !query) ? 'true' : null, folder: { label: fixture.path.slice(0, fixture.path.lastIndexOf('/')), expanded: collapsed && !(options.collapseReset && nativeSelected && !query) ? 'false' : 'true' }, headers: [{ text: 'Essential (2 files)', expanded: active ? 'false' : 'true' }, { text: 'Tests (1 test)', expanded: active ? 'true' : 'false' }] },
    source: { id: fixture.anchor, path: fixture.path, head: fixture.head, review: '019271d5e9aaae129d85f3585c16c1acf7a767cd', raw: options.changedSource && nativeSelected ? 'changed payload' : 'original payload', boxes: [{ id: 'viewed', checked: false }], visible: active, open: active, codeVisible: active, codeInViewport: active },
    identity: proof ? { input: !remounted && (!options.replacedInput || !query) && !(options.pendingIdentityChanged && query && filterReads === 2), host: !remounted, nav: !remounted, root: true, boxes: true } : null,
    events: [...events],
  }); };
  const nativeHref = `${fixture.url}&file_path=${encodeURIComponent(fixture.path)}#${fixture.anchor}`;
  let handleDisposed = false;
  const page = {
    evaluateHandle: async (fn, received, mode) => {
      assert.equal(fn, gitLabFileSearchSnapshot);assert.equal(received, fixture);assert.equal(mode, 'target');
      return {
        asElement: () => options.noUniqueTarget ? null : {
          evaluate: async (fn) => String(fn).includes('unobstructed') ? { connected: !options.targetDisconnected, original: true, href: options.targetRetargeted ? fixture.url : nativeHref, anchor: fixture.anchor, rect: { width: 100, height: 32 }, inViewport: true, unobstructed: !options.targetObstructed } : undefined,
          click: async () => page.click('a[data-file-row]'),
        },
        dispose: async () => { handleDisposed = true; },
      };
    },
    isClosed: () => false,
    evaluate: async (fn, label) => { if (fn === gitLabFileSearchSnapshot) return read();if (fn === markGitLabFileSearchPhase) { calls.push(`phase:${label}`);return; }if (String(fn).includes('delete globalThis.__geldFileSearchProof')) { if (options.listenerRemovalFails) throw new Error('Listener cleanup failed');cleaned = true;return { hadProof: proof, removedTypes: proof ? ['click', 'focusin', 'focusout', 'input', 'keydown'] : [], proofAbsent: true }; }proof = true; },
    $eval: async (_selector, fn) => String(fn).includes('unobstructed') ? { unique: 1, unobstructed: !options.obstructed } : undefined,
    click: async (selector) => {
      calls.push(selector);
      if (selector.includes('diff-tree-search')) { focused = true;return; }
      if (selector.includes('category-folder')) { collapsed = true;return; }
      if (selector.includes('data-file-row')) { nativeSelected = true;events.push({ type: 'click', native: fixture.anchor, nativeHref, trusted: !options.untrustedNative });return; }
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
  const dependencies = { progress, poll: async (get, accepts, label) => { for (let index = 0; index < 6; index += 1) { const value = await get();polls.push({ label, paths: value.native.paths });if (accepts(value)) return value; }throw new Error(`Protocol deadline: ${label}`); }, capture: async (_page, name) => { if (options.captureThrows) throw new Error('Capture failed');if (options.remountDuringCapture) remounted = true;return { name }; }, totals: async () => ({ all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 } }) };
  return { page, dependencies, progress, calls, polls, handleDisposed: () => handleDisposed, cleaned: () => cleaned, query: () => query };
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
  const unsafe = options.changedSource || options.replacedInput || options.targetChanged || options.targetMetadataChanged || options.sourceMetadataChanged || options.modeChanges;
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


function pooledFixture() {
  nativeFixture();
  const nav = document.querySelector('nav.mr-tree-list');
  const paths = ['app/graphql/mutations/boards/issues/issue_move_list.rb', fixture.path];
  const ids = ['2384b693797296a4feb5371e4c1a775b92dbbeb4', fixture.anchor];
  nav.innerHTML = `<div class="vue-recycle-scroller ready direction-vertical" style="overflow-y:auto"><div class="vue-recycle-scroller__item-wrapper" style="overflow-x:hidden;overflow-y:hidden">${paths.map((path, index) => `<div class="vue-recycle-scroller__item-view" style="transform:translateY(${index === 0 ? -9999 : 32}px)"><div data-testid="file-row-container"><a data-testid="file-row" data-file-row="${ids[index]}" href="${fixture.url}&file_path=${encodeURIComponent(path)}#${ids[index]}">${path}</a></div></div>`).join('')}</div></div>`;
  const scroller = nav.querySelector('.vue-recycle-scroller');const wrapper = scroller.firstElementChild;
  const views = [...wrapper.children];const anchors = views.map((view) => view.querySelector('a'));
  const box = (top, height = 32) => ({ left: 20, right: 300, top, bottom: top + height, width: 280, height });
  for (const node of [scroller, wrapper]) {
    node.getBoundingClientRect = () => box(100, 200);
    for (const [key, value] of Object.entries({ clientWidth: 280, clientHeight: 200, clientLeft: 0, clientTop: 0 })) Object.defineProperty(node, key, { configurable: true, value });
  }
  for (const [index, view] of views.entries()) {
    for (const node of [view, ...view.querySelectorAll('*')]) node.getBoundingClientRect = () => box(index === 0 ? -9899 : 132);
  }
  const realStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: (node) => new Proxy(realStyle(node), { get: (style, key) => key === 'transform' && node.style.transform === 'translateY(-9999px)' ? 'matrix(1, 0, 0, 1, 0, -9999)' : Reflect.get(style, key) }) });
  return { nav, scroller, wrapper, views, anchors, paths, box, realStyle };
}

test('reports every native pool row and excludes only positively parked clipped unused views', () => {
  const f = pooledFixture();const before = document.body.innerHTML;
  const snapshot = gitLabFileSearchSnapshot(fixture);
  assert.deepEqual(snapshot.native.paths, [fixture.path]);assert.equal(snapshot.native.domCount, 2);assert.equal(snapshot.native.excludedCount, 1);
  const parked = snapshot.native.rows[0];assert.equal(parked.reason, 'verified_native_unused_pool');assert.equal(parked.rect.width > 0, true);assert.equal(parked.pool.chain, true);
  assert.ok(parked.clips.some((clip) => clip.nativeWrapper && clip.overflowY === 'hidden'));
  assert.equal(snapshot.native.visible, true);assert.equal(gitLabFileSearchSnapshot(fixture, 'target'), f.anchors[1]);
  assert.equal(document.body.innerHTML, before);
});

for (const [name, mutate] of [
  ['active unrelated row outside viewport', (f) => { f.views[0].style.transform = 'translateY(3200px)'; }],
  ['unverified pool ancestor', (f) => { f.wrapper.className = 'another-wrapper'; }],
  ['unready native scroller', (f) => { f.scroller.classList.remove('ready'); }],
  ['computed transform disagreement', (f) => { Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: f.realStyle }); }],
  ['no actual native clipping', (f) => { f.wrapper.style.overflowX = 'visible';f.wrapper.style.overflowY = 'visible';f.scroller.style.overflowY = 'visible'; }],
  ['unmeasured clipping box', (f) => { Object.defineProperty(f.wrapper, 'clientHeight', { value: 0 });Object.defineProperty(f.scroller, 'clientHeight', { value: 0 }); }],
  ['sentinel view still inside clipping box', (f) => { f.views[0].getBoundingClientRect = () => f.box(100);f.anchors[0].getBoundingClientRect = () => f.box(100); }],
  ['unknown native source href', (f) => { f.anchors[0].href = 'https://other.example/unknown'; }],
]) test(`never drops ${name} to manufacture a singleton`, () => {
  const f = pooledFixture();mutate(f);const snapshot = gitLabFileSearchSnapshot(fixture);
  assert.equal(snapshot.native.rows[0].included, true);assert.equal(snapshot.native.paths.length, 2);
  assert.equal(gitLabFileSearchSnapshot(fixture, 'target'), null);
});

test('keeps a parked duplicate target visible in diagnostics while selecting only the included original', () => {
  const f = pooledFixture();f.anchors[0].href = f.anchors[1].href;f.anchors[0].setAttribute('data-file-row', fixture.anchor);
  const snapshot = gitLabFileSearchSnapshot(fixture);
  assert.equal(snapshot.native.domTargetCount, 2);assert.equal(snapshot.native.resultCount, 1);assert.deepEqual(snapshot.native.paths, [fixture.path]);
  assert.equal(gitLabFileSearchSnapshot(fixture, 'target'), f.anchors[1]);
  f.views[0].style.transform = 'translateY(0px)';
  assert.equal(gitLabFileSearchSnapshot(fixture).native.resultCount, 2);assert.equal(gitLabFileSearchSnapshot(fixture, 'target'), null);
});

test('records source-backed native model indicators without changing or adopting Vue private state', () => {
  nativeFixture();const input = document.querySelector('input');const wrapper = document.createElement('div');wrapper.className = 'gl-search-box-by-type';input.before(wrapper);wrapper.append(input);
  const clear = document.createElement('button');clear.className = 'gl-search-box-by-type-clear';clear.title = 'Clear search';wrapper.append(clear);
  const toggle = document.createElement('button');toggle.dataset.testid = 'tree-view-toggle';toggle.setAttribute('aria-current', 'true');document.querySelector('section').prepend(toggle);
  document.querySelector('nav.mr-tree-list').classList.add('tree-list-blobs');
  clear.getBoundingClientRect = input.getBoundingClientRect;
  const before = document.body.innerHTML;const model = gitLabFileSearchSnapshot(fixture).native.model;
  assert.equal(model.treeViewSelected, 'true');assert.match(model.navClass, /tree-list-blobs/);assert.equal(model.clearButtons.length, 1);assert.equal(model.clearButtons[0].title, 'Clear search');
  assert.equal(document.body.innerHTML, before);
});

for (const [name, options] of [
  ['no unique current included target', { noUniqueTarget: true }],
  ['target recycled to another URL', { targetRetargeted: true }],
  ['target disconnected after lookup', { targetDisconnected: true }],
  ['target obstructed before click', { targetObstructed: true }],
]) test(`trusted native click rejects ${name} and releases its element handle`, async () => {
  const p = protocol(options);await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.equal(p.progress.activated, undefined);assert.equal(p.handleDisposed(), true);assert.equal(p.progress.failureBeforeCleanup.search.value, fixture.query);
  assert.ok(p.progress.failureArtifacts);assert.equal(p.progress.cleanup.status, 'verified');
});


test('read-only event diagnostics capture default prevention after propagation without claiming trusted input', async () => {
  nativeFixture();bindGitLabFileSearchProof(fixture);
  const input = document.querySelector('input');
  input.addEventListener('input', (event) => event.preventDefault());
  input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
  const observation = globalThis.__geldFileSearchProof.events.at(-1);
  assert.equal(observation.defaultPrevented, false);assert.notEqual(observation.trusted, true);assert.equal(observation.cancelable, true);
  assert.equal(observation.defaultPreventedFinal, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observation.defaultPreventedFinal, true);
});


for (const mode of [true, undefined, null, 'false', 0]) test(`rejects unverified native all-files mode ${String(mode)}`, () => {
  nativeFixture();const snapshot = gitLabFileSearchSnapshot(fixture);snapshot.app.fileByFileMode = mode;
  assert.throws(() => assertGitLabFileSearchScope(snapshot), /all-files mode/);
});

for (const [name, options] of [
  ['hash-only native all-files location', {}],
  ['matching present linked file query', { presentFilePath: true }],
]) test(`accepts ${name} only with independent native active-file transition`, async () => {
  const p = protocol(options);await verifyGitLabFileSearch(p.page, p.dependencies);
  assert.equal(p.progress.nativeClick.before.native.active, false);assert.equal(p.progress.activated.native.active, true);
  assert.equal(new URL(p.progress.activated.url).searchParams.get('file_path'), options.presentFilePath ? fixture.path : null);
  assert.equal(p.progress.cleanup.status, 'verified');
  assert.ok(p.calls.includes('phase:native-click:start'));assert.ok(p.calls.includes('phase:native-click:end'));
  assert.ok(p.calls.includes('phase:capture:gitlab-file-search-native-results:start'));assert.ok(p.calls.includes('phase:capture:gitlab-file-search-native-results:end'));
});

for (const [name, options] of [
  ['conflicting current file path', { wrongFilePath: true }],
  ['ambiguous repeated file path', { duplicateFilePath: true }],
  ['missing native active transition', { missingNativeActive: true }],
  ['already active native fixture', { nativeAlreadyActive: true }],
  ['mode changes during selection', { modeChanges: true }],
  ['sidebar remount during actual capture', { remountDuringCapture: true }],
]) test(`retains strict failure for ${name}`, async () => {
  const p = protocol(options);await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.ok(p.progress.failure.message);assert.equal(p.progress.proof, undefined);assert.equal(p.cleaned(), true);
  if (options.remountDuringCapture) assert.equal(p.progress.cleanup.status, 'failed');
});

test('preserves original activation and cleanup failures independently', async () => {
  const p = protocol({ missingNativeActive: true, noClear: true });await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies), AggregateError);
  assert.match(p.progress.failure.message, /native all-files result/);assert.equal(p.progress.cleanup.status, 'failed');assert.ok(p.progress.cleanupError);
});

test('readonly native lifecycle logs replaced nodes without adopting them as originals', async () => {
  nativeFixture();bindGitLabFileSearchProof(fixture);markGitLabFileSearchPhase('capture:unit:start');
  const proof = globalThis.__geldFileSearchProof;const original = proof.host;
  const replacement = original.cloneNode(true);for (const node of [replacement, ...replacement.querySelectorAll('*')]) node.getBoundingClientRect = original.getBoundingClientRect;original.replaceWith(replacement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const trace = proof.trace.find((entry) => entry.reason === 'native-identity-change');
  assert.ok(trace);assert.equal(trace.phase, 'capture:unit:start');assert.equal(trace.identity.host, false);assert.equal(trace.identity.root, true);
  assert.equal(proof.host, original);assert.equal(proof.host.isConnected, false);
  assert.throws(() => assertGitLabFileSearchScope(gitLabFileSearchSnapshot(fixture)), /Original native nodes/);
  const released = proof.releaseDiagnostics();assert.equal(released.mutationObserverReleased, true);assert.equal(released.windowResizeReleased, true);assert.equal(released.timersReleased, true);
});

test('lifecycle sampling is bounded and does not mutate native nodes or infer breakpoint state', () => {
  nativeFixture();bindGitLabFileSearchProof(fixture);const before = document.body.innerHTML;
  for (let index = 0; index < 100; index += 1) markGitLabFileSearchPhase(`unit:${index}`);
  const proof = globalThis.__geldFileSearchProof;assert.equal(proof.trace.length, 80);assert.equal(proof.traceTruncated, true);assert.equal(document.body.innerHTML, before);
  assert.equal(proof.trace[0].mode, false);assert.equal(proof.trace[0].originalNodes, true);assert.equal(proof.trace[0].viewport.width, 1440);
});


test('native current-file presentation requires the original row and link active classes together', () => {
  const f = pooledFixture();
  assert.equal(gitLabFileSearchSnapshot(fixture).native.active, false);
  f.anchors[1].classList.add('is-active');assert.equal(gitLabFileSearchSnapshot(fixture).native.active, false);
  f.anchors[1].parentElement.classList.add('is-active');assert.equal(gitLabFileSearchSnapshot(fixture).native.active, true);
});

test('readonly panel-width chronology records measured changes and disposes observers', () => {
  nativeFixture();
  const parent = document.createElement('div');parent.className = 'js-static-panel-inner';const panel = document.createElement('main');panel.id = 'content-body';parent.append(panel);document.body.append(parent);
  let width = 1000;Object.defineProperty(panel, 'clientWidth', { get: () => width });panel.getBoundingClientRect = () => ({ width, height: 800 });
  let resizeCallback;let observed;let disconnected = false;
  window.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe(node) { observed = node; }
    disconnect() { disconnected = true; }
  };
  bindGitLabFileSearchProof(fixture);const proof = globalThis.__geldFileSearchProof;const source = document.body.innerHTML;
  assert.equal(observed, panel);markGitLabFileSearchPhase('capture:unit:start');width = 700;
  resizeCallback([{ target: panel, contentRect: { width: 700 } }]);
  const record = proof.trace.find((entry) => entry.reason === 'native-panel-width');
  assert.equal(record.panel.clientWidth, 700);assert.equal(record.panel.observedContentWidth, 700);assert.equal(record.originalNodes, true);
  assert.equal(record.phase, 'capture:unit:start');assert.equal(document.body.innerHTML, source);assert.equal(proof.host, document.querySelector('[data-testid="file-tree-container"]'));
  assert.equal(proof.releaseDiagnostics().resizeObserverReleased, true);assert.equal(disconnected, true);
});
