import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { GITLAB_FILE_SEARCH as fixture, gitLabFileSearchSnapshot, assertGitLabFileSearchScope, verifyGitLabFileSearch } from './gitlab-file-search.mjs';

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

function nativeFixture() {
  // Reduced retained native structure with explicit unit-only geometry, not browser acceptance.
  document.body.innerHTML = `<section data-testid="file-tree-container"><input type="search" data-testid="diff-tree-search" aria-label="Search (e.g. *.vue) (F)"><nav class="mr-tree-list" aria-label="File tree"><div data-testid="file-row-container"><a data-testid="file-row" data-file-row="${fixture.anchor}" href="${fixture.url}&file_path=${encodeURIComponent(fixture.path)}#${fixture.anchor}">issue_move_list_spec.rb</a></div></nav><nav class="geld-provider-categories" data-geld-ui><section class="geld-provider-category" data-active="true"><button class="geld-provider-category-header" aria-expanded="true">Tests (1 test)</button><button class="geld-provider-category-folder" aria-expanded="false"><span class="geld-provider-category-folder-label">${fixture.path.slice(0, fixture.path.lastIndexOf('/'))}</span></button><ul hidden><li data-geld-category-path="${fixture.path}"><a aria-current="true" href="#${fixture.anchor}">test</a></li></ul></section></nav></section><diff-file id="${fixture.anchor}"><details data-file-body open><table><tbody><tr><td class="rd-line-text">RSpec.describe IssueMoveList</td></tr></tbody></table><input type="checkbox" id="viewed" disabled></details></diff-file>`;
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
  let query = '';let selected = false;let collapsed = false;let active = false;let focused = false;let shift = false;let proof = false;let nativeSelected = false;let cleaned = false;
  const calls = [];const events = [];
  const read = () => ({
    url: fixture.url + (selected ? `${nativeSelected ? '&file_path=' + encodeURIComponent(fixture.path) : ''}#${fixture.anchor}` : ''),
    unique: { host: 1, input: 1, nav: 1, roots: 1 },
    search: { value: query, label: 'Search (e.g. *.vue) (F)', visible: true, focused },
    native: { paths: options.unfilteredResults ? [fixture.path, 'app/another.rb'] : [fixture.path], resultCount: 1, visible: Boolean(query), listMarker: query ? null : 'native', anchor: fixture.anchor },
    owned: { count: query ? 0 : 1, active: active ? 'true' : 'false', current: selected && !(options.currentLost && nativeSelected && !query) ? 'true' : null, folder: { label: fixture.path.slice(0, fixture.path.lastIndexOf('/')), expanded: collapsed && !(options.collapseReset && nativeSelected && !query) ? 'false' : 'true' }, headers: [{ text: 'Essential (2 files)', expanded: active ? 'false' : 'true' }, { text: 'Tests (1 test)', expanded: active ? 'true' : 'false' }] },
    source: { id: fixture.anchor, path: fixture.path, head: fixture.head, review: '019271d5e9aaae129d85f3585c16c1acf7a767cd', raw: options.changedSource && nativeSelected ? 'changed payload' : 'original payload', boxes: [{ id: 'viewed', checked: false }], visible: active, open: active, codeVisible: active, codeInViewport: active },
    identity: proof ? { input: !options.replacedInput || !query, host: true, nav: true, root: true, boxes: true } : null,
    events: [...events],
  });
  const page = {
    isClosed: () => false,
    evaluate: async (fn) => { if (fn === gitLabFileSearchSnapshot) return read();if (String(fn).includes('delete globalThis.__geldFileSearchProof')) { cleaned = true;return; }proof = true; },
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
      press: async (key) => { calls.push(key);if (key === 'Enter') active = true;if (key === 'Tab') focused = shift;if (key === 'Backspace') query = ''; },
    },
  };
  const progress = {};
  const dependencies = { progress, poll: async (get, accepts, label) => { const value = await get();assert.ok(accepts(value), label);return value; }, capture: async (_page, name) => ({ name }), totals: async () => ({ all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 } }) };
  return { page, dependencies, progress, calls, cleaned: () => cleaned, query: () => query };
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
]) test(`protocol rejects ${name} and performs cleanup`, async () => {
  const p = protocol(options);await assert.rejects(verifyGitLabFileSearch(p.page, p.dependencies));
  assert.equal(p.cleaned(), true);assert.equal(p.query(), '');
});
