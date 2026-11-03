import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { BITBUCKET_UI_PR as URL, assertBitbucketUiSource, prepareBitbucketUiTransition, bitbucketUiTransitionState, bitbucketUiNativeInventory, verifyBitbucketUiContinuity } from './bitbucket-ui-continuity.mjs';
const source = () => ({ schema: 2, key: JSON.stringify([JSON.stringify(['bitbucket', 'https://bitbucket.org', 'atlassian/bitbucket-upload-file']), URL, 'current', null]), storedAt: 1,
  revision: `${'a'.repeat(40)}..${'b'.repeat(40)}`, files: [{ path: 'test/test.py', additions: 3, deletions: 2 }, { path: 'src/main.py', additions: 7, deletions: 1 }],
  sourceFacts: { subject: { url: URL, repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'atlassian/bitbucket-upload-file' }, version: 'current', headSha: null }, comparison: { kind: 'bitbucket-review', topic: true, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) } } });
const state = () => ({ repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'atlassian/bitbucket-upload-file' }, hasDiff: true, onDiffPage: true, all: { files: 2, additions: 10, deletions: 3 } });

test('complete cached source pins the same review and sums actual files instead of PR27 constants', () => {
  assert.deepEqual(assertBitbucketUiSource([source()], state()), source());
  for (const mutate of [s => { s.files.pop(); }, s => { s.files[0].path = 'not-the-test'; }, s => { s.revision = 'other'; }, s => { s.sourceFacts.subject.url += '/wrong'; }, s => { s.files[0].additions = -1; }]) {
    const value = source();mutate(value);assert.throws(() => assertBitbucketUiSource([value], state()));
  }
  assert.throws(() => assertBitbucketUiSource([source()], { ...state(), all: { files: 2, additions: 46, deletions: 29 } }));
});

function protocol(options = {}) {
  const item = {}, checkpoints = [], calls = [];
  let clicked = false, closed = false;
  const page = {
    url: () => clicked ? `${URL}/diff` : URL,
    isClosed: () => closed,
    $eval: async () => options.wrongHead ? 'c'.repeat(40) : 'b'.repeat(40),
    evaluate: async (fn, cleanup) => {
      if (fn === bitbucketUiNativeInventory) return { sameNative: !options.nativeChanged, files: source().files.map(file => ({ path: file.path, href: '#chg-' + file.path })) };
      if (fn === prepareBitbucketUiTransition) { calls.push('lease');return { href: `${URL}/diff` }; }
      if (fn === bitbucketUiTransitionState) { if (cleanup) calls.push('cleanup');return { sameDocument: !options.reload, url: `${URL}/diff`, clicks: [{ trusted: !options.untrusted, href: `${URL}/diff`, same: true }] }; }
      throw Error('Unexpected protocol evaluation');
    },
    evaluateHandle: async () => ({ asElement: () => ({ click: async () => { calls.push('click');clicked = true;if (options.budgetAtClick) { closed = true;throw Error('budget cap'); } } }), dispose: async () => { calls.push('dispose'); } }),
  };
  const context = {
    verifyDigest: async (actual) => { assert.equal(actual, page);calls.push('digest'); },
    readState: async actual => { assert.equal(actual, page);return state(); },
    readSource: async () => { const value = source();if (options.cacheCanary) value.privateCanary = 'CACHE_CANARY_NOT_FOR_DIAGNOSTICS';if (clicked && options.changed) value.files[0].status = 'modified';if (options.timestampRefreshed) value.storedAt = clicked ? calls.includes('filter') ? 3 : 2 : 1;return [value]; },
    verifyFiltering: async (actual, record, fixture) => { assert.equal(actual, page);assert.equal(record, item);assert.deepEqual(fixture.source.files, source().files);calls.push('filter');if (options.filterError) throw Error('filter failed'); },
    poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value));return value; },
    quota: () => ({ limit: 40, activeWithinHour: options.budget ? 40 : 26 }),
    guard: () => { if (options.budget) throw Error('budget cap'); },
    checkpoint: async () => checkpoints.push(structuredClone(item.uiContinuity)),
  };
  return { item, calls, checkpoints, run: () => verifyBitbucketUiContinuity(page, item, context) };
}

test('one-page protocol checkpoints digest before one native click and verifies the same source', async () => {
  const f = protocol();assert.equal((await f.run()).status, 'passed');
  assert.deepEqual(f.calls, ['digest', 'lease', 'click', 'dispose', 'filter', 'cleanup']);
  assert.equal(f.checkpoints[0].digest.status, 'passed');assert.equal(f.checkpoints[0].navigationAttempts, 0);
  assert.equal(f.item.uiContinuity.diff.status, 'passed');assert.equal(f.item.uiContinuity.navigationAttempts, 1);
});
test('cache refresh timestamps may advance while every semantic source field stays identical', async () => {
  const f = protocol({ timestampRefreshed: true });
  assert.equal((await f.run()).status, 'passed');
  assert.deepEqual(f.item.uiContinuity.cacheStorageTimes, { initial: 1, afterTransition: 2, afterFiltering: 3 });
});
for (const [name, options] of [['budget before navigation', { budget: true }], ['budget during navigation', { budgetAtClick: true }], ['full reload', { reload: true }], ['untrusted activation', { untrusted: true }], ['changed cache', { changed: true }], ['different digest head', { wrongHead: true }], ['failed filtering', { filterError: true }], ['native node replaced', { nativeChanged: true }]]) test(`keeps digest checkpoint but never claims continuity after ${name}`, async () => {
  const f = protocol(options);await assert.rejects(f.run());assert.equal(f.item.uiContinuity.status, 'incomplete');assert.equal(f.item.uiContinuity.digest.status, 'passed');assert.equal(f.item.uiContinuity.diff.status, 'incomplete');assert.ok(f.item.uiContinuity.navigationAttempts <= 1);
  if (options.budget) assert.equal(f.calls.includes('click'), false);
});

test('native lease selects the visible original Files link, records input and detects document replacement', () => {
  const window = new Window({ url: URL });
  const previous = Object.fromEntries(['document', 'location', 'Element', 'getComputedStyle'].map(key => [key, globalThis[key]]));
  try {
    globalThis.document = window.document;globalThis.location = window.location;globalThis.Element = window.Element;globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    document.body.innerHTML = `<nav><a role="tab" id="pull-request-tabs-1" href="${URL}/diff">Files</a></nav><div data-geld-ui><a role="tab" id="pull-request-tabs-1" href="${URL}/diff">Forged</a></div>`;
    const link = document.querySelector('nav a');link.getBoundingClientRect = () => ({ width: 100, height: 30 });link.style.visibility = 'visible';
    assert.deepEqual(prepareBitbucketUiTransition(), { href: `${URL}/diff` });
    globalThis.__geldBitbucketUiContinuity.listener({ target: link, isTrusted: true });
    window.location.href = `${URL}/diff`;
    assert.equal(bitbucketUiTransitionState().sameDocument, true);assert.equal(bitbucketUiTransitionState().clicks[0].trusted, true);
    globalThis.document = new Window().document;assert.equal(bitbucketUiTransitionState().sameDocument, false);
    bitbucketUiTransitionState(true);assert.equal(globalThis.__geldBitbucketUiContinuity, undefined);
  } finally { delete globalThis.__geldBitbucketUiContinuity;for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key];else globalThis[key] = value; }window.close(); }
});

// Run the actual shared filtering orchestration offline, including its exact settings cleanup.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const harness = readFileSync(new globalThis.URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const filtering = harness.slice(harness.indexOf('async function bitbucketFiltering('), harness.indexOf('\nasync function categoryInteraction('));
function filterProtocol(fail = false, patternPresent = true) {
  const saved = { enabled: true, unrelated: 'preserved', ...(patternPresent ? { categoryPatterns: { tests: ['old'], locks: ['keep'] } } : {}) };
  let settings = structuredClone(saved), mode = 'original';
  const all = state().all;
  const value = () => ({ ...state(), all, hiddenCount: mode === 'none' ? 0 : 1, visible: mode === 'none' ? all : { files: 1, additions: 7, deletions: 1 }, categories: [{ id: 'tests', paths: ['test/test.py'] }] });
  const native = () => ({ files: value().visible.files, additions: value().visible.additions, deletions: value().visible.deletions, hidden: mode === 'none' ? [] : [{ path: 'test/test.py', mode: 'closed', display: 'none' }] });
  const chrome = { storage: { sync: { get: async () => ({ settings: structuredClone(settings) }), set: async values => { settings = values.settings;mode = 'original'; } } } };
  const context = {
    assert, chrome, BITBUCKET_UI_PATH: 'test/test.py', SETTINGS_KEY: 'settings',
    options: { evaluate: async (fn, ...args) => fn(...args) },
    patchSettings: async patch => { settings = { ...settings, ...patch };mode = patch.categoryPatterns.tests[0] === '!**/*' ? 'none' : 'selected'; },
    waitTotals: async (_page, expectedAll, expectedVisible, hidden) => { assert.deepEqual(expectedAll, all);assert.deepEqual(expectedVisible, value().visible);assert.equal(hidden, value().hiddenCount);return value(); },
    tabState: async () => value(), bitbucketDom: async () => native(),
    poll: async (read, accepts) => { const result = await read();assert.ok(accepts(result));return result; },
    headerHintsEvidence: async () => ({ nativeIds: ['native-file-control'] }),
    providerUiProbe: () => {}, assertVisibleProviderCounts: (_probe, totals) => assert.deepEqual(totals, value().visible),
    capture: async () => ({}), categoryInteraction: async () => { if (fail) throw Error('category failure');return {}; },
    installedHover: async () => ({ text: 'actual totals' }), responsiveHover: async () => ({}), reducedMotionProbe: async () => ({}),
    bitbucketNativeStyles: async () => ({}), pause: async () => {},
  };
  // options.evaluate normally executes in the installed extension page's realm.
  context.options.evaluate = async (fn, ...args) => vm.runInNewContext(`(${fn.toString()})(...args)`, { chrome, args });
  const run = vm.runInNewContext(`(${filtering})`, context);
  const page = { evaluate: async () => ({}), $eval: async () => `${value().visible.files} files changed. Added ${value().visible.additions} lines. Removed ${value().visible.deletions} lines`, emulateMediaFeatures: async () => {} };
  return { run: () => run(page, {}, { source: source(), originalState: value() }), settings: () => settings, saved };
}
test('generalized filtering uses observed totals and restores exact pattern presence and unrelated settings', async () => {
  for (const present of [true, false]) {
    const f = filterProtocol(false, present);await f.run();assert.deepEqual(f.settings(), f.saved);
  }
});
test('generalized filtering restores settings after a real category-check failure', async () => {
  const f = filterProtocol(true);await assert.rejects(f.run(), /category failure/);assert.deepEqual(f.settings(), f.saved);
});

test('native inventory requires actual anchors and tree links and detects replaced nodes', () => {
  const window = new Window({ url: `${URL}/diff` });
  const previous = globalThis.document;
  try {
    globalThis.document = window.document;
    document.body.innerHTML = '<div id="file-tree"><ul role="list"><li><a href="#chg-test%2Ftest.py">test.py</a></li></ul></div><section role="region" aria-label="Diff"><div><div id="chg-test/test.py"></div><article data-qa="branch-diff-file"><label>Viewed<input type="checkbox"></label></article></div></section>';
    globalThis.__geldBitbucketUiContinuity = { document };
    const initial = bitbucketUiNativeInventory(true);
    assert.deepEqual(initial.files, [{ path: 'test/test.py', anchor: 'chg-test/test.py', href: '#chg-test%2Ftest.py', viewed: false }]);
    assert.equal(initial.sameNative, true);
    document.querySelector('#file-tree a').replaceWith(document.querySelector('#file-tree a').cloneNode(true));
    assert.equal(bitbucketUiNativeInventory().sameNative, false);
  } finally { delete globalThis.__geldBitbucketUiContinuity;if (previous === undefined) delete globalThis.document;else globalThis.document = previous;window.close(); }
});

test('native file hydration may add an unchecked Viewed control while preserving existing source nodes', () => {
  const window = new Window({ url: `${URL}/diff` });const previous = globalThis.document;
  try {
    globalThis.document = window.document;
    document.body.innerHTML = '<div id="file-tree"><ul role="list"><li><a href="#chg-test%2Ftest.py">test.py</a></li></ul></div><section role="region" aria-label="Diff"><div><div id="chg-test/test.py"></div></div></section>';
    globalThis.__geldBitbucketUiContinuity = { document };
    assert.equal(bitbucketUiNativeInventory(true).files[0].viewed, null);
    document.querySelector('[role="region"] > div').insertAdjacentHTML('beforeend', '<article data-qa="branch-diff-file"><label>Viewed<input type="checkbox"></label></article>');
    const hydrated = bitbucketUiNativeInventory();assert.equal(hydrated.sameNative, true);assert.deepEqual(hydrated.hydratedControls, ['test/test.py']);assert.equal(hydrated.files[0].viewed, false);
    document.querySelector('input').checked = true;assert.equal(bitbucketUiNativeInventory().sameNative, false);
    document.querySelector('input').checked = false;bitbucketUiNativeInventory(true);
    document.querySelector('input').replaceWith(document.querySelector('input').cloneNode(true));assert.equal(bitbucketUiNativeInventory().sameNative, false);
  } finally { delete globalThis.__geldBitbucketUiContinuity;if (previous === undefined) delete globalThis.document;else globalThis.document = previous;window.close(); }
});
test('changed-cache errors never serialize cache contents into diagnostics', async () => {
  const f = protocol({ changed: true, cacheCanary: true });
  await assert.rejects(f.run(), error => { assert.match(error.message, /same complete cached source/);assert.doesNotMatch(String(error.stack), /CACHE_CANARY_NOT_FOR_DIAGNOSTICS/);return true; });
  assert.doesNotMatch(JSON.stringify(f.item), /CACHE_CANARY_NOT_FOR_DIAGNOSTICS/);
});
