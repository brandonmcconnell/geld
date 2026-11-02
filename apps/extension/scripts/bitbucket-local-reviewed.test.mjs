import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { tsImport } from 'tsx/esm/api';
import { Window } from 'happy-dom';
import { BITBUCKET_LOCAL_REVIEW, createLocalReviewOracle, localReviewProbe, localReviewRecord, localReviewStorageScope, localReviewWrite, observeLocalReview, verifyBitbucketLocalReview } from './bitbucket-local-reviewed.mjs';

const { buildProviderReviewItems, isOpenStatus } = await tsImport('@geld/review', import.meta.url);
// Node has no stylesheet renderer; this test uses the real shared panel's state and controls.
const styles = registerHooks({ load(url, context, next) {
  return new URL(url).pathname.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
} });
let renderProviderReviewPanel;
try { ({ renderProviderReviewPanel } = await tsImport('../src/providers/review-panel.ts', import.meta.url)); }
finally { styles.deregister(); }

const HEAD = 'a'.repeat(40);const FINGERPRINT = '1'.repeat(64);
const REVIEW_KEY = 'bitbucket@https://bitbucket.org:atlassian%2Fbitbucket-upload-file!22';
const API = 'https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/';
const metadata = (ref = HEAD) => ({ id: 22, state: 'MERGED', source: { repository: { full_name: 'atlassian/bitbucket-upload-file' }, commit: { hash: ref } }, destination: { repository: { full_name: 'atlassian/bitbucket-upload-file' } } });
function readyOracle() { const value = createLocalReviewOracle();value.observe(`${API}pullrequests/22`, metadata());value.observe(`${API}pullrequests/22`, metadata());return value; }

test('the actual shared review model moves an outdated local mark to done and Undo preserves native outdated state', () => {
  const window = new Window({ url: BITBUCKET_LOCAL_REVIEW, settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const globals = { document: window.document, window, location: window.location, HTMLElement: window.HTMLElement, HTMLDetailsElement: window.HTMLDetailsElement, HTMLImageElement: window.HTMLImageElement, Element: window.Element, Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window) };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let panel;
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const comment = { id: '471253038', anchor: 'comment-471253038', url: `${BITBUCKET_LOCAL_REVIEW}/_/diff#comment-471253038`, author: { id: 'native-user', login: 'reviewer' }, body: 'A retained outdated review comment', createdAt: '2024-02-13T12:00:00Z' };
    const input = { subject: { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', id: '22', headSha: HEAD }, threads: [{ id: '471253038', anchor: comment.anchor, url: comment.url, resolved: false, outdated: true, stateKnown: true, comments: [comment] }], checks: [], reviewers: [] };
    const [native] = buildProviderReviewItems(input);assert.equal(native.status, 'outdated');assert.equal(isOpenStatus(native.status), true);
    const sourceBefore = JSON.stringify(input);const host = document.createElement('section');document.body.append(host);
    const options = (reviewed) => ({ localReviewed: { ids: new Set(reviewed ? [native.id] : []), pending: new Set(), set: () => undefined } });
    panel = renderProviderReviewPanel(host, input, options(false));
    const item = () => panel.element.querySelector('[data-geld-item]');
    assert.equal(item().dataset.state, 'outdated');assert.equal(item().closest('[data-geld-review-group]').dataset.geldReviewGroup, 'outdated');
    panel.update(input, options(true));
    assert.equal(item().dataset.state, 'done-manual');assert.equal(item().closest('[data-geld-review-group]').dataset.geldReviewGroup, 'done');
    assert.equal(item().querySelector('[data-geld-local-reviewed]').getAttribute('aria-pressed'), 'true');
    assert.equal(item().querySelector('[data-geld-local-review-notice]').textContent, 'Reviewed on this device. Native status: Outdated.');
    panel.update(input, options(false));
    assert.equal(item().dataset.state, 'outdated');assert.equal(item().closest('[data-geld-review-group]').dataset.geldReviewGroup, 'outdated');
    assert.equal(item().querySelector('[data-geld-local-review-notice]'), null);assert.equal(JSON.stringify(input), sourceBefore);
  } finally {
    panel?.destroy();for (const [key, descriptor] of previous) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }window.happyDOM.abort();
  }
});

test('the source oracle needs repeated current-visit metadata and actual full commit resolution', () => {
  const oracle = createLocalReviewOracle();const prefix = HEAD.slice(0, 12);
  oracle.observe(`${API}pullrequests/22`, metadata(prefix));assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(`${API}pullrequests/22`, metadata(prefix));assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(`${API}commit/${prefix}?fields=hash`, { hash: HEAD });assert.equal(oracle.snapshot().headSha, HEAD);
  oracle.reset();assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(`${API}pullrequests/22`, metadata(), 0);assert.equal(oracle.snapshot().observations, 0);
});

test('canonical native API alias supplies the same read-only source identity', () => {
  const oracle = createLocalReviewOracle();const url = `${API}pullrequests/22`.replace('https://api.bitbucket.org/2.0/', 'https://bitbucket.org/!api/2.0/');
  oracle.observe(url, metadata());oracle.observe(url, metadata());assert.equal(oracle.snapshot().headSha, HEAD);
});

for (const change of ['different-head', 'different-review', 'foreign-source', 'foreign-destination', 'invalid-state', 'invalid-ref', 'overflow']) test(`the source oracle rejects ${change}`, () => {
  const oracle = readyOracle();const value = metadata();
  if (change === 'different-head') value.source.commit.hash = 'b'.repeat(40);
  if (change === 'different-review') value.id = 23;
  if (change === 'foreign-source') value.source.repository.full_name = 'someone/fork';
  if (change === 'foreign-destination') value.destination.repository.full_name = 'someone/else';
  if (change === 'invalid-state') value.state = 'unknown';
  if (change === 'invalid-ref') value.source.commit.hash = 'not-a-commit';
  for (let n = 0; n < (change === 'overflow' ? 33 : 1); n++) oracle.observe(`${API}pullrequests/22`, value);
  assert.equal(oracle.snapshot().status, 'unavailable');
});

test('unrelated and credential-bearing resource URLs cannot contribute source authority', () => {
  const oracle = createLocalReviewOracle();
  for (const url of [`${API}pullrequests/23`, `${API}pullrequests/22?fields=source`, `${API}pullrequests/22#x`, `${API}pullrequests/22`.replace('api.bitbucket.org', 'api.bitbucket.org.evil.test'), `${API}pullrequests/22`.replace('https://', 'https://user:secret@')]) oracle.observe(url, metadata());
  assert.equal(oracle.snapshot().observations, 0);
});

test('provider write guard distinguishes review/API writes from anonymous native analytics', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(localReviewWrite(`${API}pullrequests/22/comments`, method), true);
    assert.equal(localReviewWrite(`${BITBUCKET_LOCAL_REVIEW}/approve`, method), true);
    assert.equal(localReviewWrite('https://bitbucket.org/!api/2.0/somewhere', method), true);
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(localReviewWrite(`${API}pullrequests/22/comments`, method), false);
  assert.equal(localReviewWrite('https://bitbucket.org/analytics', 'POST'), false);
  assert.equal(localReviewWrite('https://example.test/2.0/', 'POST'), false);
});

function stored(present = false) { return { settings: { present: true, value: { enabled: false, custom: { keep: 1 } } }, marks: present ? { present: true, value: { original: ['opaque', 1] } } : { present: false }, synchronizedMarks: { present: false } }; }
for (const present of [false, true]) test(`storage scope restores exact original ${present ? 'present' : 'absent'} raw local value after close`, async () => {
  let current = stored(present);const original = structuredClone(current);const progress = {};
  const scope = localReviewStorageScope({ read: async () => structuredClone(current), write: async (value) => { current = structuredClone(value); }, progress });
  await scope.prepare();assert.equal(current.settings.value.enabled, true);assert.equal(current.settings.value.prOverview, true);assert.equal(current.settings.value.quickReview, false);assert.equal(current.settings.value.showListStats, false);assert.deepEqual(current.marks, { present: false });assert.deepEqual(current.settings.value.custom, { keep: 1 });
  await assert.rejects(scope.restore(false), /Close/);assert.equal(progress.restored, undefined);
  await scope.restore(true);assert.deepEqual(current, original);assert.equal(progress.restored, true);
});

test('storage scope preserves absent settings and refuses a synchronized local-mark key', async () => {
  let current = { ...stored(), settings: { present: false } };const original = structuredClone(current);
  const scope = localReviewStorageScope({ read: async () => current, write: async (value) => { current = value; }, progress: {} });
  await scope.prepare();await scope.restore(true);assert.deepEqual(current, original);
  current.synchronizedMarks = { present: true, value: {} };let writes = 0;
  await assert.rejects(localReviewStorageScope({ read: async () => current, write: async () => { writes++; }, progress: {} }).prepare(), /sync storage/);assert.equal(writes, 0);
});

function markedStorage() { return { ...stored(), marks: { present: true, value: { [JSON.stringify([REVIEW_KEY, HEAD])]: { reviewKey: REVIEW_KEY, headSha: HEAD, updatedAt: 1, items: { ri_a: FINGERPRINT } } } } }; }
test('storage evidence requires a scoped SHA256 fingerprint, never source text', () => {
  const storage = markedStorage();assert.equal(localReviewRecord(storage, 'ri_a', HEAD), FINGERPRINT);assert.throws(() => localReviewRecord(storage, 'ri_a', 'b'.repeat(40)), /Unexpected/);
  const record = Object.values(storage.marks.value)[0];record.items.ri_a = 'Original secret source text';assert.throws(() => localReviewRecord(storage, 'ri_a', HEAD));
  record.items.ri_a = FINGERPRINT;record.body = 'extra source';assert.throws(() => localReviewRecord(storage, 'ri_a', HEAD));
});
test('storage evidence rejects additional foreign buckets or items and omits malformed raw values from errors', () => {
  const storage = markedStorage();const record = Object.values(storage.marks.value)[0];
  record.items.ri_other = FINGERPRINT;assert.throws(() => localReviewRecord(storage, 'ri_a', HEAD), /Unexpected/);delete record.items.ri_other;
  storage.marks.value[JSON.stringify([REVIEW_KEY, 'b'.repeat(40)])] = { ...record, headSha: 'b'.repeat(40) };
  assert.throws(() => localReviewRecord(storage, 'ri_a', HEAD), /Unexpected/);
  const malformed = markedStorage();Object.values(malformed.marks.value)[0].items.ri_a = 'RAW_PRIVATE_CANARY';
  assert.throws(() => localReviewRecord(malformed, 'ri_a', HEAD), (error) => error.message === 'Invalid local review fingerprint' && !String(error).includes('RAW_PRIVATE_CANARY'));
  assert.equal(localReviewRecord(stored(), 'ri_a', HEAD), null);
  assert.equal(localReviewRecord({ ...stored(), marks: { present: true, value: {} } }, 'ri_a', HEAD), null);
});

function dom() {
  const window = new Window({ url: BITBUCKET_LOCAL_REVIEW, settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const before = new Map(['document', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.document = window.document;globalThis.location = window.location;
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\'>';
  document.body.innerHTML = `<section data-qa="pull-request-overview-activity-content"><header data-qa="bk-file__header" data-testid="file-header"><span data-qa="bk-filepath">.changes/next-release/patch-20240213112019723332.json</span><span>Outdated</span></header><article id="comment-471253038" data-testid="comment"><header data-testid="comment-header"><a href="${BITBUCKET_LOCAL_REVIEW}#comment-471253038">Timestamp</a></header><div data-testid="comment-content"><div class="ak-renderer-document">Internal maintenance: Update tests to access token auth.</div></div></article></section><section class="geld-provider-review" data-state="partial"><details data-geld-review-group="outdated"><details data-geld-item="ri_a" data-state="outdated"><button data-geld-local-reviewed="ri_a" aria-pressed="false">Mark reviewed</button><article data-geld-source="comment-471253038"><div class="geld-provider-review__body"><div class="ak-renderer-document">Internal maintenance: Update tests to access token auth.</div></div><header class="geld-provider-review__byline"><a href="${BITBUCKET_LOCAL_REVIEW}/_/diff#comment-471253038">View original</a></header></article></details></details></section>`;
  return () => { localReviewProbe('dispose');for (const [key, descriptor] of before) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }window.happyDOM.abort(); };
}
test('DOM lease retains native identity and records synthetic clicks as untrusted', () => {
  const close = dom();try {
    assert.equal(localReviewProbe('install').nativeUnchanged, true);
    document.querySelector('[data-geld-local-reviewed]').click();assert.equal(localReviewProbe().untrustedClicks, 1);assert.equal(localReviewProbe().trustedClicks, 0);
    document.querySelector('[data-geld-item]').setAttribute('data-state', 'outdated');assert.equal(localReviewProbe().nativeUnchanged, true);
    const original = document.getElementById('comment-471253038');original.replaceWith(original.cloneNode(true));assert.equal(localReviewProbe().nativeUnchanged, false);
  } finally { close(); }
});
for (const change of ['body', 'link', 'header', 'sign-in', 'route', 'owned-native', 'duplicate-source', 'duplicate-native', 'duplicate-bootstrap', 'duplicate-control', 'control-owner']) test(`DOM lease rejects changed ${change}`, () => {
  const close = dom();try {
    localReviewProbe('install');
    if (change === 'body') document.querySelector('#comment-471253038 .ak-renderer-document').textContent = 'Changed';
    if (change === 'link') document.querySelector('#comment-471253038 a').href = `${BITBUCKET_LOCAL_REVIEW}#elsewhere`;
    if (change === 'header') document.querySelector('[data-qa="bk-filepath"]').textContent = 'different.ts';
    if (change === 'sign-in') document.getElementById('bb-bootstrap').setAttribute('data-current-user', '{"isAuthenticated":true}');
    if (change === 'route') location.href = BITBUCKET_LOCAL_REVIEW.replace('/22', '/23');
    if (change === 'owned-native') document.getElementById('comment-471253038').setAttribute('data-geld-ui', '');
    if (change === 'duplicate-source') document.querySelector('.geld-provider-review').append(document.querySelector('[data-geld-source]').cloneNode(true));
    if (change === 'duplicate-native') document.body.append(document.getElementById('comment-471253038').cloneNode(true));
    if (change === 'duplicate-bootstrap') document.head.append(document.getElementById('bb-bootstrap').cloneNode(true));
    if (change === 'duplicate-control') document.querySelector('[data-geld-item]').append(document.querySelector('[data-geld-local-reviewed]').cloneNode(true));
    if (change === 'control-owner') document.querySelector('[data-geld-local-reviewed]').setAttribute('data-geld-local-reviewed', 'other');
    assert.notEqual(localReviewProbe()?.nativeUnchanged, true);
  } finally { close(); }
});

test('response observer makes no source request and disposes its listeners', async () => {
  const handlers = new Map();let closed = false;const abort = new AbortController();const progress = {};
  const page = { on: (key, value) => handlers.set(key, value), off: (key) => handlers.delete(key), close: async () => { closed = true; } };
  const observed = observeLocalReview(page, progress, abort);
  const response = () => {
    const request = { url: () => `${API}pullrequests/22`, method: () => 'GET' };handlers.get('request')(request);
    return { url: request.url, request: () => request, status: () => 200, text: async () => JSON.stringify(metadata()) };
  };
  handlers.get('response')(response());handlers.get('response')(response());await observed.flush();assert.equal(observed.oracle.snapshot().headSha, HEAD);
  const late = response();observed.oracle.reset();handlers.get('response')(late);await observed.flush();assert.equal(observed.oracle.snapshot().observations, 0);
  handlers.get('request')({ url: () => `${API}pullrequests/22/comments`, method: () => 'POST' });assert.equal(abort.signal.aborted, true);assert.equal(closed, true);assert.equal(progress.providerWrites, 1);
  await observed.dispose();assert.equal(handlers.size, 0);
});

function protocol(failure) {
  let pressed = false;let clicked = 0;let installs = 0;let reloads = 0;const calls = [];const oracle = readyOracle();
  const native = { id: 'comment-471253038', text: 'Internal maintenance: Update tests to access token auth.', link: `${BITBUCKET_LOCAL_REVIEW}#comment-471253038`, path: '.changes/next-release/patch-20240213112019723332.json', outdated: true };
  const sample = () => ({ native: { ...native }, nativeUnchanged: failure !== 'source-change' || !pressed, itemId: 'ri_a', pressed: String(pressed), disabled: false, state: pressed && failure !== 'stale-owned-state' ? 'done-manual' : 'outdated', group: pressed && failure !== 'stale-owned-state' ? 'done' : 'outdated', notice: pressed ? 'Reviewed on this device. Native status: Outdated.' : null, body: native.text, links: [`${BITBUCKET_LOCAL_REVIEW}/_/diff#comment-471253038`], checks: [], bots: [], quickActions: 0, aiControls: 0, trustedClicks: clicked, untrustedClicks: 0 });
  const page = {
    evaluate: async (fn, operation) => {
      assert.equal(fn, localReviewProbe);calls.push(operation ?? 'read');if (operation === 'install') installs++;
      const value = sample();if (failure === 'reload-install-state' && operation === 'install' && installs === 2) { value.state = 'outdated';value.group = 'outdated'; }
      return value;
    },
    click: async () => { pressed = !pressed;clicked++; },
    reload: async () => { calls.push('reload');reloads++;clicked = 0;if (failure === 'lost-reload') pressed = false;oracle.observe(`${API}pullrequests/22`, metadata());oracle.observe(`${API}pullrequests/22`, metadata()); },
  };
  const item = { localReviewTraffic: { providerWrites: failure === 'write' ? 1 : 0 } };
  const run = () => verifyBitbucketLocalReview(page, item, {
    observer: { oracle, flush: async () => undefined },
    readStorage: async () => pressed ? markedStorage() : stored(),
    poll: async (read, accepts) => { const result = await read();if (!accepts(result)) throw new Error('Protocol readiness refused');return result; },
    openReviewAncestors: async () => { calls.push('open'); }, budget: () => ({ available: failure !== 'budget' }),
  });
  return { run, item, calls, counts: () => ({ installs, reloads }) };
}
test('actual orchestration verifies both trusted inputs, persisted fingerprint, reload and native status separately', async () => {
  const fixture = protocol();const result = await fixture.run();assert.equal(result.status, 'passed');assert.equal(fixture.item.localReviewed.status, 'passed');
  assert.deepEqual(fixture.counts(), { installs: 2, reloads: 1 });assert.equal(fixture.item.localReviewed.undone.state, 'outdated');
  assert.equal(fixture.item.localReviewed.marked.state, 'done-manual');assert.equal(fixture.item.localReviewed.reloaded.group, 'done');
  assert.equal(fixture.item.localReviewed.reloaded.pressed, 'true');assert.equal(fixture.item.localReviewed.undone.pressed, 'false');assert.equal(fixture.calls.filter((call) => call === 'dispose').length, 2);
});
for (const failure of ['source-change', 'lost-reload', 'write', 'budget', 'stale-owned-state', 'reload-install-state']) test(`orchestration cannot pass after ${failure}`, async () => {
  const fixture = protocol(failure);await assert.rejects(fixture.run());assert.notEqual(fixture.item.localReviewed.status, 'passed');
});

test('the literal local-reviewed focus is isolated and cleanup follows page close', () => {
  const text = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(text)[1];const cases = new vm.Script(`(${literal})`).runInNewContext();
  assert.deepEqual(Array.from(cases['bitbucket-local-reviewed']), ['bitbucket-local-reviewed']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'bitbucket-local-reviewed') assert.equal(selected.includes('bitbucket-local-reviewed'), false);
  assert.match(text, /localReviewOnly && focus !== 'bitbucket-local-reviewed'/);assert.match(text, /if \(localReviewOnly\) item.artifacts/);
  const close = text.indexOf('await page.close();', text.indexOf('  } finally {', text.indexOf('async function runCase')));
  assert.ok(close > 0);assert.ok(text.indexOf('await localReviewSettings.restore(', close) > close);
  assert.match(text, /localReviewSettings.restore\(page === undefined \|\| page.isClosed\(\)\)/);
});

test('actual runCase redacts unknown failures and console data while restoring private raw values after closure', async () => {
  const source = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function runCase('), source.indexOf('\nasync function crossSettingsDom('));
  const canary = 'UNTRUSTED_PRIVATE_CANARY';const events = [];const handlers = new Map();let closed = false;
  let storage = { ...stored(true), marks: { present: true, value: { untouched: canary } } };const original = structuredClone(storage);
  const page = { on: (key, fn) => { const values = handlers.get(key) ?? [];values.push(fn);handlers.set(key, values); },
    off: (key, fn) => handlers.set(key, (handlers.get(key) ?? []).filter((value) => value !== fn)),
    setViewport: async () => undefined, bringToFront: async () => undefined, isClosed: () => closed,
    close: async () => { events.push('close');closed = true; },
    goto: async () => { for (const fn of handlers.get('console') ?? []) fn({ type: () => 'log', text: () => canary });for (const fn of handlers.get('pageerror') ?? []) fn(new Error(canary));return { status: () => 200 }; }, url: () => BITBUCKET_LOCAL_REVIEW };
  const report = { cases: [], infrastructureErrors: [], quotaPolicy: { conservativeObservedRequestBudget: 40 } };
  const context = { bitbucketBudgetHold: vm.runInNewContext('(' + source.slice(source.indexOf('function bitbucketBudgetHold('), source.indexOf('async function inheritCooldowns(')) + ')'),
    assert, AbortController, Date, Set, Map, WeakMap, focus: 'bitbucket-local-reviewed', FOCUSED_CASES: { 'bitbucket-local-reviewed': ['bitbucket-local-reviewed'] }, report, cooldowns: new Map(), bitbucketRequestTimes: [], localReviewCases: new WeakMap(), currentCaseAbort: undefined,
    providerOf: () => 'bitbucket', options: { evaluate: async (_fn, value) => { if (value === undefined) return structuredClone(storage);events.push(closed ? 'restore' : 'prepare');storage = structuredClone(value); } },
    localReviewStorageScope, observeLocalReview, browser: { newPage: async () => page }, observeBitbucketBudget: () => undefined,
    safeUrl: (value) => value, errorText: (error) => error.message, closedTarget: () => false,
    capture: async () => { throw new Error('Generic capture must be suppressed'); }, saveReport: async () => undefined, console: { log: () => undefined },
  };
  vm.createContext(context);new vm.Script(`${code}\nglobalThis.run = runCase;`).runInContext(context);
  await context.run('bitbucket-local-reviewed', BITBUCKET_LOCAL_REVIEW, async () => { throw new Error(canary); });
  assert.equal(report.cases[0].status, 'failed');assert.equal(JSON.stringify(report).includes(canary), false);
  assert.deepEqual(storage, original);assert.ok(events.indexOf('close') < events.indexOf('restore'));
  assert.equal(report.cases[0].suppressedNativeConsoleCount, 1);assert.equal(report.cases[0].suppressedNativePageErrorCount, 1);
  assert.equal(report.cases[0].localReviewStorage.restored, true);
});
