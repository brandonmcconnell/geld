import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CODERABBIT_FIXTURE as F, createCodeRabbitFixtureOracle, codeRabbitRequestObservation, observeCodeRabbitFixture, assertCodeRabbitSource, assertCodeRabbitRequestSource, verifyCodeRabbitCommands } from './gitlab-coderabbit-acceptance.mjs';

const SHA = 'a'.repeat(40);
const API = 'https://gitlab.com/api/v4/projects/ark-bitcoin%2Fbark/merge_requests/2117';
const DISCUSSIONS = F.url + '/discussions.json?per_page=100&notes_filter=0&persist_filter=false';
const EXTENSION = 'abcdefghijklmnopabcdefghijklmnop';
const metadata = () => ({ iid: 2117, web_url: F.url, sha: SHA, diff_refs: { head_sha: SHA }, state: 'merged' });
// Compact protocol fixtures, not a substitute for a live CodeRabbit comment/account corpus.
const note = (id = Number(F.note)) => ({ id, note: 'Walkthrough and original source words', system: false, noteable_note_url: `${F.url}#note_${id}`, author: { id: Number(F.author), username: F.login, bot: true, user_type: 'project_bot' }, created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z' });
const discussion = (id = 'one', notes = [note()]) => ({ id, notes, resolved: false, active: true });
function ready() { const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, [discussion()]);return oracle; }

test('requires one actual200 metadata body and a complete cursor chain;304 alone is not a fabricated body', () => {
  const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 304, null);oracle.observe(DISCUSSIONS, 200, [discussion()], { 'x-next-page-cursor': 'next' });
  assert.equal(oracle.snapshot().status, 'unavailable');oracle.observe(API, 200, metadata());assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(DISCUSSIONS + '&cursor=next', 200, [discussion('two', [note(3436707544)])]);
  const result = oracle.snapshot();assert.equal(result.status, 'ready');assert.equal(result.discussions, 2);assert.equal(result.notes, 2);assert.deepEqual(result.pages, ['page:1', 'cursor:next']);
  assert.equal(oracle.evidence.metadataResponses[0].status, 304);assert.equal(oracle.evidence.metadata.length, 1);
});
test('also validates ordered numeric page continuation without inventing a complete first page', () => {
  const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, [discussion()], { 'x-next-page': '2' });assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(DISCUSSIONS + '&page=2', 200, [discussion('two', [note(3436707544)])]);assert.equal(oracle.snapshot().status, 'ready');
});
for (const [name, change] of [
  ['vendor alias instead of native account', (value) => { value.author.username = 'coderabbitai'; }],
  ['different durable author', (value) => { value.author.id = 99; }],
  ['human/nonautomated account', (value) => { value.author.bot = false;value.author.user_type = 'human'; }],
  ['system activity', (value) => { value.system = true; }],
  ['foreign permalink', (value) => { value.noteable_note_url = F.url.replace('/2117', '/2118') + '#note_' + F.note; }],
]) test(`${name} cannot establish the actual fixture even with a vendor-shaped body`, () => {
  const oracle = createCodeRabbitFixtureOracle();const source = note();change(source);source.note = '<!-- CodeRabbit --> @coderabbitai review';oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, [discussion('one', [source])]);assert.equal(oracle.snapshot().status, 'unavailable');
});
test('rejects conflicting metadata, duplicate/cyclic sources and changed already-observed pages', () => {
  const moved = ready();moved.observe(API, 200, { ...metadata(), sha: 'b'.repeat(40), diff_refs: { head_sha: 'b'.repeat(40) } });assert.equal(moved.snapshot().status, 'unavailable');
  const repeated = ready();repeated.observe(DISCUSSIONS + '&cursor=two', 200, [discussion('one')], { 'x-next-page-cursor': 'two' });assert.equal(repeated.snapshot().status, 'unavailable');
  const changed = ready();changed.observe(DISCUSSIONS, 200, [discussion('one', [{ ...note(), note: 'Edited source' }])]);assert.equal(changed.snapshot().status, 'unavailable');
  const duplicate = createCodeRabbitFixtureOracle();duplicate.observe(API, 200, metadata());duplicate.observe(DISCUSSIONS, 200, [discussion('one'), discussion('two')]);assert.equal(duplicate.snapshot().status, 'unavailable');
});
test('foreign routes, native20 previews, malformed source bodies and oversized pages never establish completion', () => {
  for (const url of [API.replace('ark-bitcoin', 'foreign'), DISCUSSIONS.replace('per_page=100', 'per_page=20'), DISCUSSIONS + '&unknown=1']) {
    const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(url, 200, [discussion()]);assert.equal(oracle.snapshot().status, 'unavailable');
  }
  for (const value of [{ values: [] }, Array.from({ length: 101 }, () => discussion()), [{ id: 'one' }], [discussion('one', [{ ...note(), note: 'x'.repeat(1_000_001) }])]]) {
    const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, value);assert.equal(oracle.snapshot().status, 'unavailable');
  }
});
test('copy acquisition classification separates actual extension/owned source reads from incidental first-party reports', () => {
  assert.equal(codeRabbitRequestObservation({ url: API, method: 'GET' }, EXTENSION).source, true);
  const extension = codeRabbitRequestObservation({ url: 'https://gitlab.com/api/v4/users/123', method: 'GET', initiator: { stack: { callFrames: [], parent: { callFrames: [{ url: `chrome-extension://${EXTENSION}/content-scripts/gitlab.js` }] } } } }, EXTENSION);
  assert.equal(extension.attribution, 'extension_frame_observed');assert.equal(extension.source, true);
  assert.equal(codeRabbitRequestObservation({ url: F.url + '/test_reports.json', method: 'GET' }, EXTENSION).source, false);
  assert.equal(codeRabbitRequestObservation({ url: 'https://other.example/api/v4/users', method: 'GET' }, EXTENSION), null);
});
test('observer reads already-issued response bodies without fetching and disposes its listeners', async () => {
  const page = new EventEmitter();const item = {};const fixture = observeCodeRabbitFixture(page, item, EXTENSION);
  for (const [url, value] of [[API, metadata()], [DISCUSSIONS, [discussion()]]]) page.emit('response', { url: () => url, status: () => 200, headers: () => ({}), json: async () => value });
  await Promise.resolve();await Promise.resolve();assert.equal(fixture.snapshot().status, 'ready');fixture.copyPhase(true);
  page.emit('request', { url: () => F.url + '/test_reports.json', method: () => 'GET', initiator: () => null });assert.equal(fixture.evidence.copyOtherGets.length, 1);assert.deepEqual(fixture.evidence.copySourceGets, []);
  fixture.dispose();assert.equal(page.listenerCount('request'), 0);assert.equal(page.listenerCount('response'), 0);
});

function dom() {
  return { items: [{ id: 'ri_source', state: 'resolved', sources: [`note_${F.note}`] }], url: F.url, state: 'partial', head: SHA, nativeHead: SHA, aiRunControls: 0, source: { anchor: `note_${F.note}`, body: '<p>Original words</p>', links: [`${F.url}#note_${F.note}`] },
    native: { exists: true, body: '<p>Native words</p>', authorId: F.author, login: F.login, href: '/' + F.login, sameNode: true },
    requests: [{ source: `${F.url}#note_${F.note}` }], requestNative: { anchor: `note_${F.note}`, exists: true, body: '<p>Native words</p>', authorId: F.author, login: F.login, sameNode: true } };
}
test('the command source needs actual same-account native author/body/root and a known canonical note link', () => {
  const snapshot = ready().snapshot();const before = dom();assertCodeRabbitSource(before, snapshot);assertCodeRabbitRequestSource(before, snapshot);
  for (const mutate of [(value) => { value.native.sameNode = false; }, (value) => { value.native.body = 'Replaced words'; }, (value) => { value.head = 'b'.repeat(40); }]) { const after = dom();mutate(after);assert.throws(() => assertCodeRabbitSource(after, snapshot, before)); }
  for (const mutate of [(value) => { value.requestNative.sameNode = false; }, (value) => { value.requestNative.authorId = '99'; }, (value) => { value.requests[0].source = F.url + '#note_99'; }]) { const after = dom();mutate(after);assert.throws(() => assertCodeRabbitRequestSource(after, snapshot, before)); }
});
for (const sourceState of ['missing metadata', 'incomplete cursor chain', 'invalid metadata']) test(`${sourceState} returns case unavailable only after settings/listener cleanup, without clipboard access`, async () => {
  const original = { aiEnabled: false, trustedReviewAccounts: [], trustedSummaryPublishers: [] };const events = [];let permission = false;
  const oracle = createCodeRabbitFixtureOracle();
  if (sourceState !== 'missing metadata') oracle.observe(API, 200, sourceState === 'invalid metadata' ? { ...metadata(), web_url: F.url.replace('/2117', '/2118') } : metadata());
  oracle.observe(DISCUSSIONS, 200, [discussion()], sourceState === 'incomplete cursor chain' ? { 'x-next-page-cursor': 'unobserved-page' } : {});
  assert.equal(oracle.snapshot().status, 'unavailable');
  const fixture = { ...oracle, copyPhase() {}, dispose() { events.push('disposed'); } };const item = {};
  const result = await verifyCodeRabbitCommands({ isClosed: () => true }, item, { fixture, context: { overridePermissions: async () => { permission = true; } }, readSettings: async () => original,
    poll: async (read, valid) => { assert.equal(valid(await read()), false);throw new Error(`Actual fixture unavailable: ${sourceState}`); }, restoreTrust: async (value) => { assert.deepEqual(value, original);events.push('settings restored'); } });
  assert.equal(result.status, 'unavailable');assert.match(result.reason, /Actual fixture unavailable/);assert.equal(item.codeRabbitCommands.status, 'unavailable');assert.equal(item.codeRabbitCommands.settingsRestored, true);
  assert.deepEqual(events, ['settings restored', 'disposed']);assert.equal(permission, false);assert.equal(item.codeRabbitCommands.fixture, undefined);assert.deepEqual(item.codeRabbitCommands.actions, []);
});
for (const failure of ['settings', 'listener']) test(`unavailable fixture plus ${failure} cleanup failure throws and marks failed rather than unavailable/passed`, async () => {
  const original = { aiEnabled: false, trustedReviewAccounts: [] };const item = {};const events = [];
  const fixture = { snapshot: () => ({ status: 'unavailable' }), copyPhase() {}, dispose() { events.push('disposed');if (failure === 'listener') throw new Error('Listener cleanup failed'); } };
  await assert.rejects(verifyCodeRabbitCommands({ isClosed: () => true }, item, { fixture, readSettings: async () => original,
    poll: async (read, valid) => { assert.equal(valid(await read()), false);throw new Error('Missing native metadata'); },
    restoreTrust: async () => { events.push('settings cleanup');if (failure === 'settings') throw new Error('Settings cleanup failed'); } }), /CodeRabbit clipboard\/trust cleanup failed/);
  assert.deepEqual(events, ['settings cleanup', 'disposed']);assert.equal(item.codeRabbitCommands.status, 'failed');assert.equal(item.codeRabbitCommands.cleanupErrors.length, 1);assert.equal(item.codeRabbitCommands.fixture, undefined);
});
test('CodeRabbit focus is literal, selectable alone and excluded from default/all extra acquisition', () => {
  const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];const map = new vm.Script(`(${literal})`).runInNewContext();
  assert.deepEqual(Array.from(map['gitlab-coderabbit']), ['gitlab-coderabbit-digest']);assert.equal(map.regression.includes('gitlab-coderabbit-digest'), false);
  assert.match(harness, /name === 'gitlab-coderabbit-digest' && focus === 'all'/);
  const workflow = readFileSync(new URL('../../../.github/workflows/browser-e2e.yml', import.meta.url), 'utf8');assert.match(workflow, /- gitlab-coderabbit\n/);assert.match(workflow, /'gitlab-coderabbit'/);
});

test('retained web discussions string-ID shape and actual100+12 cursor pagination are accepted', () => {
  // Native note3436654383 fields retained November1; body deliberately omitted, padding is protocol-only.
  const native = { id: '3436654383', system: false, noteable_note_url: 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117#note_3436654383',
    author: { id: 38968537, username: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe', bot: true, user_type: 'project_bot' },
    created_at: '2026-06-09T10:02:51.459Z', updated_at: '2026-06-13T15:20:20.557Z', note: 'Protocol fixture; original public bot body is not copied here.' };
  const cursor = "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNi0xNSAxMzozMzo0OS4xNTU1NTIwMDAgKzAwMDAiLCJpZCI6IjM0NTYzNjg2MTUiLCJfa2QiOiJuIn0=";
  const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());
  oracle.observe(DISCUSSIONS, 200, Array.from({ length: 100 }, (_, index) => discussion(`first-${index}`, index === 0 ? [native] : [])), { 'x-next-page-cursor': cursor });
  assert.equal(oracle.snapshot().status, 'unavailable');
  oracle.observe(DISCUSSIONS + '&cursor=' + encodeURIComponent(cursor), 200, Array.from({ length: 12 }, (_, index) => discussion(`second-${index}`, [])));
  assert.equal(oracle.snapshot().status, 'ready');assert.equal(oracle.snapshot().discussions, 112);assert.equal(oracle.snapshot().source.id, '3436654383');
});
for (const id of ['', 0, '0', '03436654383', '3.436654383e9', '3436654383 ', Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1)]) test(`rejects ambiguous/noncanonical native note identity ${JSON.stringify(id)}`, () => {
  const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, [discussion('one', [{ ...note(), id }])]);assert.equal(oracle.snapshot().status, 'unavailable');
});

// Offline browser/storage protocol doubles exercise failure cleanup and call ordering only.
// These are not an installed CodeRabbit result and do not replace the real UI/clipboard assertions.
function commandFlow({ permissionFailure = false, captureFailure = false, sourceFailure = false } = {}) {
  const initial = { aiEnabled: false, trustedReviewAccounts: [], trustedSummaryPublishers: [], untouched: { original: true } };let settings = structuredClone(initial);
  let trusted = false;let held = false;let commandHeld = false;let mode = 'Incremental review';let clipboard = 'Original clipboard';let status = '';let input = null;let granted = false;let cleared = false;let disposed = false;let withdrew = false;
  const oracle = ready();const snapshot = oracle.snapshot();const fixture = { ...oracle, copyPhase() {}, dispose() { disposed = true; } };
  const snapshotDom = () => ({ ...dom(), nativeHead: sourceFailure ? 'b'.repeat(40) : SHA, native: { ...dom().native, sameNode: held ? true : null },
    requestNative: { ...dom().requestNative, sameNode: commandHeld ? true : null }, bots: trusted ? [{ id: 'coderabbit', state: 'unknown', text: 'Observed bound account' }] : [],
    requests: trusted ? [{ source: `${F.url}#note_${F.note}`, summary: 'Prepare CodeRabbit request', preview: mode === 'Full review' ? '@coderabbitai full review' : '@coderabbitai review', copyDisabled: false, commentDisabled: true, commentTitle: 'Sign in to GitLab to open the native comment writer.', status,
      modes: ['Incremental review', 'Full review'].map((text) => ({ text, pressed: String(text === mode) })) }] : [] });
  const copy = (detail) => { clipboard = mode === 'Full review' ? '@coderabbitai full review' : '@coderabbitai review';status = 'Command copied. Paste it into the native comment writer and post when ready.';input = { trusted: true, detail }; };
  const page = { isClosed: () => false,
    evaluate: async (callback, arg) => {
      if (callback.name === 'codeRabbitDomProbe') return snapshotDom();
      const source = String(callback);
      if (/=>\s*globalThis\.__geldCodeRabbitInput/.test(source)) return input;
      if (source.includes('navigator.clipboard.readText')) return clipboard;
      if (source.includes('navigator.clipboard.writeText')) { clipboard = arg;return; }
      if (source.includes('document.getElementById')) { if (source.includes('__geldCodeRabbitCommandNative')) commandHeld = true;else held = true; }
    },
    $eval: async (selector) => selector.includes('__never__') ? null : selector.includes('confirmation') ? { visible: true, text: `${F.login} CodeRabbit` } : { summary: 'Identify reviewer', metadata: `${F.author} ${F.login} gitlab.com/ark-bitcoin/bark` },
    $: async () => ({ evaluate: async () => { input = null; }, click: async () => copy(1), focus: async () => {}, dispose: async () => {} }),
    keyboard: { press: async (key) => { assert.equal(key, 'Enter');copy(0); } }, bringToFront: async () => {},
  };
  const poll = async (read, valid, label) => { const value = await read();assert.ok(valid(value), label);return value; };
  const item = {};
  const run = () => verifyCodeRabbitCommands(page, item, { fixture,
    context: { overridePermissions: async (origin, permissions) => { assert.equal(origin, 'https://gitlab.com');assert.ok(permissions.includes('clipboard-write'));granted = true;if (permissionFailure) throw new Error('Clipboard permission denied'); }, clearPermissionOverrides: async () => { cleared = true; } },
    poll, openReviewAncestors: async () => [],
    clickReviewButton: async (_page, _selector, label) => { if (label === 'Trust') { trusted = true;settings.trustedReviewAccounts = [`gitlab.com/ark-bitcoin/bark coderabbit ${F.author}`]; } else if (label.endsWith('review')) { mode = label;status = ''; }return { label }; },
    readSettings: async () => structuredClone(settings), withdrawTrust: async () => { withdrew = true;trusted = false;settings.trustedReviewAccounts = [];return { bindingRemoved: true }; },
    restoreTrust: async (original) => { settings.trustedReviewAccounts = original.trustedReviewAccounts;trusted = false; },
    capture: async () => { if (captureFailure) throw new Error('Screenshot failed');return { screenshot: 'offline-protocol-only.png' }; },
  });
  return { run, item, initial, settings: () => settings, clipboard: () => clipboard, cleanup: () => ({ granted, cleared, disposed, withdrew }) };
}
test('offline orchestration preserves both exact previews/trusted input modes and clears clipboard permissions/settings', async () => {
  const flow = commandFlow();await flow.run();assert.equal(flow.item.codeRabbitCommands.status, 'passed');
  assert.deepEqual(flow.item.codeRabbitCommands.actions.map(({ expected, input, event }) => ({ expected, input, detail: event.detail })), [{ expected: '@coderabbitai review', input: 'pointer', detail: 1 }, { expected: '@coderabbitai full review', input: 'keyboard', detail: 0 }]);
  assert.deepEqual(flow.settings(), flow.initial);assert.equal(flow.clipboard(), 'Original clipboard');assert.deepEqual(flow.cleanup(), { granted: true, cleared: true, disposed: true, withdrew: true });
});
test('a product/native-head mismatch after confirmed fixture still throws and marks failed', async () => {
  const flow = commandFlow({ sourceFailure: true });await assert.rejects(flow.run());
  assert.equal(flow.item.codeRabbitCommands.fixture.status, 'ready');assert.equal(flow.item.codeRabbitCommands.status, 'failed');assert.deepEqual(flow.settings(), flow.initial);assert.equal(flow.cleanup().disposed, true);assert.equal(flow.cleanup().granted, false);
});
for (const failure of ['permissionFailure', 'captureFailure']) test(`${failure} cannot leave a trusted binding or granted clipboard permission behind`, async () => {
  const flow = commandFlow({ [failure]: true });await assert.rejects(flow.run(), failure === 'permissionFailure' ? /Clipboard permission denied/ : /Screenshot failed/);
  assert.equal(flow.item.codeRabbitCommands.status, 'failed');assert.deepEqual(flow.settings(), flow.initial);assert.equal(flow.cleanup().cleared, true);assert.equal(flow.cleanup().disposed, true);
});

for (const [type, id] of [['LabelNote', '13a1d4815cdbb1b78d5fdb1eeec7e8f7ebf7c03d'], ['StateNote', '5b15017103440af5f7324d5d12831a0feb02edcf']]) test(`actual typed system ${type} SHA identity is pagination data, never a reviewer/comment candidate`, () => {
  const oracle = createCodeRabbitFixtureOracle();oracle.observe(API, 200, metadata());oracle.observe(DISCUSSIONS, 200, [discussion()], { 'x-next-page-cursor': 'events' });
  // Retained event type/id/system shape; body/other account fields are synthetic and not corpus claims.
  const event = { ...note(), id, type, system: true, noteable_note_url: F.url + '#note_' + id };
  oracle.observe(DISCUSSIONS + '&cursor=events', 200, [discussion(id, [event])]);
  assert.deepEqual(oracle.evidence.errors, []);assert.equal(oracle.snapshot().status, 'ready');assert.equal(oracle.snapshot().notes, 2);assert.equal(oracle.snapshot().accountNotes.length, 1);
  const invalid = createCodeRabbitFixtureOracle();invalid.observe(API, 200, metadata());invalid.observe(DISCUSSIONS, 200, [discussion(id, [{ ...event, system: false }])]);assert.equal(invalid.snapshot().status, 'unavailable');
});
