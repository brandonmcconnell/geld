import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createInitialOnSourceQualifier, observeInitialOnSource, initialOnBrowserRead, initialOnActorProbe, parseInitialOnPatch, reconcileInitialOnInventory } from './bitbucket-initial-on-source.mjs';
import { observedBitbucketShellIdentity, bitbucketShellProbe, flushObservedBitbucketShell, observeBitbucketShellFixture } from './bitbucket-shell-acceptance.mjs';
import { prepareInitialNativeOnSource } from './bitbucket-initial-native-on.mjs';
import { bitbucketPipelineVisitProbe } from './bitbucket-pipeline-visit.mjs';
import { bitbucketSyntaxSettingsProbe } from './bitbucket-syntax-settings.mjs';
import { bitbucketPipelineConsentProbe } from './bitbucket-pipeline-consent.mjs';

const retained = JSON.parse(readFileSync(new URL('./fixtures/bitbucket-native-syntax-rows.json', import.meta.url), 'utf8'));
const H = retained.source.head, B = 'c522201d16c0142bd10bf7e606e72851d9669eb0', REPO = 'atlassian/bitbucket-upload-file';
const REVIEW = `https://bitbucket.org/${REPO}/pull-requests/27/diff`, API = `https://bitbucket.org/!api/2.0/repositories/${REPO}`;
const rows = retained.original.map(({ semantic: s }, rowId) => ({ old: s.numbers[0][0] === null ? null : Number(s.numbers[0][0]), next: s.numbers[0][1] === null ? null : Number(s.numbers[0][1]), kind: s.kind, text: s.text, rowId, ids: s.ids, links: s.links }));
const meta = () => ({ id: '27', state: 'MERGED', sourceRepo: REPO, destinationRepo: REPO, head: H.slice(0, 12), base: B.slice(0, 12) });
const rawMeta = () => ({ id: 27, state: 'MERGED', source: { repository: { full_name: REPO }, commit: { hash: H.slice(0, 12) } }, destination: { repository: { full_name: REPO }, commit: { hash: B.slice(0, 12) } } });
const pipelinePatch = () => { const n = rows.find((r) => r.next === 34);return `diff --git a/bitbucket-pipelines.yml b/bitbucket-pipelines.yml\nindex aaaaaaa..bbbbbbb 100644\n--- a/bitbucket-pipelines.yml\n+++ b/bitbucket-pipelines.yml\n@@ -29,0 +34,1 @@\n+${n.text}\n`; };
// Synthetic bounded API fixture: path/count inventory is fabricated protocol data, never live source acceptance.
const fixture = () => {
  const other = [['a', 15, 10], ['b', 10, 10], ['c', 10, 5], ['d', 10, 4]];
  const patch = pipelinePatch() + other.map(([path, plus, minus]) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${minus} +1,${plus} @@\n${Array(minus).fill('-old').concat(Array(plus).fill('+new')).join('\n')}\n`).join('');
  const stats = { size: 5, page: 1, pagelen: 100, values: [{ new: { path: 'bitbucket-pipelines.yml' }, lines_added: 1, lines_removed: 0 }, ...other.map(([path, plus, minus]) => ({ new: { path }, lines_added: plus, lines_removed: minus }))] };
  return { patch, stats };
};
function protocol(fault = {}) {
  const page = new EventEmitter();const mainFrame = {};page.mainFrame = () => mainFrame;let active = 8, count = 0, id = 0, url = REVIEW;const purposes = [], guards = [], actor = [];
  const item = { shellNativeSources: { metadata: [meta()], partialMetadata: [], pins: [], errors: [], commits: [], mutations: [] } };
  const identity = new WeakMap();const identifyRequest = (r) => { if (!identity.has(r)) identity.set(r, ++id);return identity.get(r); };
  const session = observeInitialOnSource(page, item, { extensionId: 'unit', identifyRequest });
  const emit = (u, status, options = {}) => { const req = { url: () => u, method: () => 'GET', redirectChain: () => options.redirect ? [{}] : [], frame: () => fault.unknownFrame ? null : fault.foreignFrame || options.foreignFrame ? {} : mainFrame, resourceType: () => fault.resourceType ?? 'fetch', initiator: () => ({ type: 'script', stack: { callFrames: [{ url: 'https://bitbucket.org/static/native.js' }] } }) };if (fault.unknownRedirect) delete req.redirectChain;page.emit('request', req);const res = { request: () => req, url: () => u, status: () => status, headers: () => ({}), json: async () => JSON.parse(options.text ?? '{}') };page.emit('response', res);return req; };
  for (const kind of ['diff', 'diffstat']) if (fault.absent !== kind) emit(`${API}/${kind}/${REPO}:${H.slice(0, 12)}%0D${B.slice(0, 12)}?topic=true`, fault.nativeStatus ?? 200);
  page.url = () => url;page.isClosed = () => false;
  page.evaluate = async (fn, args) => {
    if (fn === initialOnActorProbe) { actor.push(args);return !fault.actor; }
    assert.equal(fn, initialOnBrowserRead);if (fault.browserFailure) throw Error('PRIVATE_NATIVE_FIELD_OR_PATCH');assert.equal(fault.requireArticle, undefined, 'The tuple stage has no native article prerequisite');count++;active++;purposes.push(args.url);
    if (fault.abortOn === count) fault.controller.abort();if (fault.routeOn === count) url += '?changed';
    const { patch, stats } = fixture();const path = decodeURIComponent(new URL(args.url).pathname);let body;
    if (path.includes('/commit/')) { const ref = path.split('/').at(-1);body = { hash: H.startsWith(ref) ? H : B };if (fault.hash && count === (fault.hashAt ?? 1)) body.hash = fault.hash;if (fault.repo) body.repository = { full_name: fault.repo }; }
    else if (path.endsWith('/pullrequests/27')) { body = rawMeta();if (fault.fresh) fault.fresh(body); }
    else if (path.includes('/diffstat/')) { body = stats;if (fault.stats) fault.stats(body); }
    else { body = fault.patch ?? patch; }
    const text = fault.malformedJSON && args.json ? '{INVALID_PRIVATE_NATIVE_FIELD' : typeof body === 'string' ? body : JSON.stringify(body);if (!fault.missingReceipt) emit(args.url, fault.status ?? 200, { redirect: fault.redirect, text });if (fault.duplicateReceipt) emit(args.url, 200);
    return { url: fault.responseURL ?? args.url, status: fault.status ?? 200, text, bytes: Buffer.byteLength(text) };
  };
  const deps = { poll: async (read, accept) => { const value = await read();assert.ok(accept(value), 'Synthetic readiness unavailable');return value; }, signal: fault.controller?.signal, guardBudget: () => { guards.push(active);return { budget: 40, observedWithinRollingHour: fault.exhaustAt && count >= fault.exhaustAt ? 25 : active }; }, settings: { current: async (v) => { assert.equal(v, false); } }, tabState: async () => ({ allowed: !!fault.active, hasDiff: !!fault.active }), flush: async () => {} };
  const qualifier = createInitialOnSourceQualifier(page, item, deps);
  const probe = { file: 'chg-bitbucket-pipelines.yml', heading: 'bitbucket-pipelines.yml', rows, ownedCount: 0 };
  return { page, item, session, deps, qualifier, probe, purposes, guards, actor, emit, count: () => count, setURL: (value) => { url = value; } };
}

test('explicit master-off tuple uses4 browser-observed reads before any article, then3 fresh reads before enable; passive guard still rejects initial prefix-only receipts', async () => {
  const p = protocol();assert.throws(() => observedBitbucketShellIdentity(p.item.shellNativeSources), /immutable/);
  const identity = await p.qualifier.qualify();assert.deepEqual([identity.head, identity.base], [H, B]);assert.equal(p.count(), 4);assert.deepEqual(p.actor.slice(0, 2), ['begin', 'read']);
  p.qualifier.reconcile(p.probe);assert.equal(p.item.initialOnSourceQualification.sourceRelation.patchRows, 1);assert.equal(p.item.initialOnSourceQualification.sourceRelation.additionalNativeContextRows, 54);
  const afterQualification = p.count();for (let i = 0; i < 100; i++) p.qualifier.current();assert.equal(p.count(), afterQualification, 'DOM polling/current reads never fetch');
  await p.qualifier.beforeEnable();assert.equal(p.count(), 7);p.qualifier.assertEnableReserve();assert.equal(p.item.initialOnSourceQualification.readCount, 7);
  const proof = p.item.initialOnSourceQualification;assert.equal(proof.reads.every((r) => r.requestId && r.sha256.length === 64 && r.status === 'qualified'), true);assert.equal(proof.requests.filter((r) => r.purpose !== null).length, 7);assert.equal(proof.comparisons.filter((r) => r.purpose !== null).length, 2);assert.deepEqual(p.item.shellNativeSources.pins, []);assert.match(identity.basis, /NOT NATIVE FULL-HEAD/);
  await assert.rejects(p.qualifier.qualify(), /retry/);await assert.rejects(p.qualifier.beforeEnable(), /retry/);assert.equal(p.count(), 7);p.page.emit('close');assert.equal(p.page.listenerCount('request'), 0);assert.equal(p.page.listenerCount('response'), 0);assert.equal(proof.cleanup, 'detached_on_page_close');
});
for (const fault of [{ absent: 'diff' }, { absent: 'diffstat' }, { nativeStatus: 304 }, { actor: true }, { active: true }]) test(`missing original native/actor/inactive prerequisites produce zero qualifier reads:${JSON.stringify(fault)}`, async () => { const p = protocol(fault);await assert.rejects(p.qualifier.qualify());assert.equal(p.count(), 0); });
for (const hash of ['a'.repeat(40), ...[41, 50, 63].map((n) => H + 'a'.repeat(n - 40)), H.slice(0, 12), H.toUpperCase()]) test(`bad authoritative resolution is rejected without retry:${hash.length}/${hash.slice(0, 8)}`, async () => { const p = protocol({ hash });await assert.rejects(p.qualifier.qualify());assert.equal(p.count(), 1);await assert.rejects(p.qualifier.qualify(), /retry/);assert.equal(p.count(), 1); });
for (const fault of [{ repo: 'foreign/repository' }, { status: 401 }, { status: 429 }, { redirect: true }, { responseURL: `${API}/commit/foreign` }, { missingReceipt: true }, { duplicateReceipt: true }, { routeOn: 1 }]) test(`API/observed-response trust failure stops bounded public acquisition:${JSON.stringify(fault)}`, async () => { const p = protocol(fault);await assert.rejects(p.qualifier.qualify());assert.ok(p.count() <= 2); });
for (const change of [(s) => { s.next = 'https://evil.invalid/next'; }, (s) => { s.size = 6; }, (s) => { s.page = 2; }, (s) => { s.values[0].lines_added = 2; }, (s) => { s.values[0].new.path = 'foreign'; }]) test('incomplete/mismatched one-page inventory declines with no pagination/fanout', async () => { const p = protocol({ stats: change });await assert.rejects(p.qualifier.qualify());assert.equal(p.count(), 4); });
test('incomplete patch and unsupported binary decline before stat read', async () => { for (const patch of [fixture().patch.split('\n').slice(0, -2).join('\n') + '\n', 'diff --git a/a b/a\nBinary files a/a and b/a differ\n']) { const p = protocol({ patch });await assert.rejects(p.qualifier.qualify());assert.equal(p.count(), 3); } });
for (const mutate of [(p) => { p.rows[0].text += ' '; }, (p) => { p.rows[0].old = 99; }, (p) => { p.heading = 'foreign'; }, (p) => { p.ownedCount = 1; }, (p) => { p.rows.reverse(); }]) test('exact original native55-row relation rejects changed text/coordinate/owner/paint/order', async () => { const p = protocol();await p.qualifier.qualify();const source = structuredClone(p.probe);mutate(source);assert.throws(() => p.qualifier.reconcile(source));await assert.rejects(p.qualifier.beforeEnable());assert.equal(p.count(), 4); });
test('a valid retained native vector must still contain each exact supplied API hunk row', async () => { const p = protocol({ patch: fixture().patch.replace('+    - if [', '+    - WRONG [') });await p.qualifier.qualify();assert.throws(() => p.qualifier.reconcile(p.probe), /API hunk/); });
for (const fresh of [(m) => { m.source.commit.hash = 'f'.repeat(12); }, (m) => { m.destination.repository.full_name = 'other/repo'; }, (m) => { m.id = 28; }, (m) => { m.state = 'OPEN'; }]) test('pre-enable current review/tuple mutation never enables or rereads after failure', async () => { const p = protocol({ fresh });await p.qualifier.qualify();p.qualifier.reconcile(p.probe);await assert.rejects(p.qualifier.beforeEnable());assert.ok(p.count() <= 7);assert.throws(() => p.qualifier.assertEnableReserve());const count = p.count();await assert.rejects(p.qualifier.beforeEnable());assert.equal(p.count(), count); });
test('same-prefix resolution changed before enable rejects exact fulltuple, not prefix equality', async () => { const p = protocol({ hash: H.slice(0, 12) + 'f'.repeat(28), hashAt: 6 });await p.qualifier.qualify();p.qualifier.reconcile(p.probe);await assert.rejects(p.qualifier.beforeEnable(), /tuple/);assert.equal(p.count(), 7);assert.throws(() => p.qualifier.assertEnableReserve()); });
test('native current metadata/full response disagreement or route drift invalidates explicit proof without requests', async () => { for (const mutate of [(p) => { p.item.shellNativeSources.metadata.push({ ...meta(), head: 'f'.repeat(12) }); }, (p) => { p.emit(`${API}/diff/${REPO}:${'f'.repeat(40)}%0D${B}?from_pullrequest_id=27&topic=true`, 200); }, (p) => p.setURL(REVIEW + '?changed')]) { const p = protocol();await p.qualifier.qualify();mutate(p);assert.throws(() => p.qualifier.current());assert.equal(p.count(), 4); } });
test('remaining seven-read plan plus8 restore+8 cold allowance is checked immediately before every request', async () => { const p = protocol({ exhaustAt: 1 });await assert.rejects(p.qualifier.qualify(), /remaining reads/);assert.equal(p.count(), 1);assert.equal(p.guards.length, 2); });
test('case abort prevents any next read and is observed immediately after pending browser work', async () => { const controller = new AbortController();const p = protocol({ controller, abortOn: 1 });await assert.rejects(p.qualifier.qualify(), /abort/i);assert.equal(p.count(), 1);const prior = protocol({ controller });await assert.rejects(prior.qualifier.qualify());assert.equal(prior.count(), 0); });

test('strict parser validates hunk lengths and exact inventory independently', () => { const f = fixture();const parsed = parseInitialOnPatch(f.patch);assert.equal(parsed.length, 5);assert.equal(reconcileInitialOnInventory(parsed, f.stats).length, 5);for (const patch of [f.patch + '+trailing\n', f.patch.replace('@@ -1,10 +1,15 @@', '@@ -1,11 +1,15 @@'), f.patch.replace('b/bitbucket-pipelines.yml', 'b/other')]) assert.throws(() => parseInitialOnPatch(patch)); });

function installBrowser(f) {
  const prior = Object.fromEntries(['location', 'fetch', 'document', '__geldInitialOnSourceActor'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: REVIEW } });Object.defineProperty(globalThis, 'fetch', { configurable: true, value: f });
  return () => { for (const [k, d] of Object.entries(prior)) { if (d) Object.defineProperty(globalThis, k, d);else delete globalThis[k]; } };
}
test('actual browser reader uses Window receiver, public no-store/omit/manual GET, bounded stream and abort cleanup', async () => {
  let options, calls = 0;const restore = installBrowser(function (url, o) { assert.equal(this, globalThis);assert.equal(url, `${API}/commit/${H.slice(0, 12)}?fields=hash`);options = o;calls++;return Promise.resolve({ status: 200, redirected: false, url, headers: new Headers({ 'content-type': 'application/json' }), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{}'));c.close(); } }) }); });
  try {
    const result = await initialOnBrowserRead({ url: `${API}/commit/${H.slice(0, 12)}?fields=hash`, maxBytes: 10, json: true });assert.equal(result.text, '{}');assert.equal(calls, 1);assert.equal(options.method, 'GET');assert.equal(options.credentials, 'omit');assert.equal(options.cache, 'no-store');assert.equal(options.redirect, 'manual');assert.equal(options.signal.aborted, true);
  } finally { restore(); }
});
for (const kind of ['status', 'redirect', 'responseURL', 'type', 'length', 'stream']) test(`actual browser reader rejects${kind} without retry`, async () => {
  let calls = 0, cancelled = false;const restore = installBrowser(async (url) => { calls++;return { status: kind === 'status' ? 429 : 200, redirected: kind === 'redirect', url: kind === 'responseURL' ? 'https://evil.invalid/' : url, headers: new Headers({ 'content-type': kind === 'type' ? 'text/html' : 'application/json', ...(kind === 'length' ? { 'content-length': '100' } : {}) }), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(kind === 'stream' ? '12345678901' : '{}'));if (kind !== 'stream') c.close(); }, cancel() { cancelled = true; } }) }; });
  try { await assert.rejects(initialOnBrowserRead({ url: `${API}/commit/${H.slice(0, 12)}?fields=hash`, maxBytes: 10, json: true }));assert.equal(calls, 1);if (kind === 'stream') assert.equal(cancelled, true, 'Oversized pending body must actually be cancelled'); } finally { restore(); }
});
test('browser reader rejects arbitrary origins/resources and actor lease has no article prerequisite, invalidates exact bootstrap/route changes, clears safely', async () => {
  const window = new Window();let calls = 0;const restore = installBrowser(async () => { calls++;throw Error('Unexpected fetch'); });Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  try {
    for (const url of ['https://api.bitbucket.org/2.0/user', 'https://evil.invalid/!api/2.0/repositories/a/b', `${API}/pullrequests/28`, `${API}/commit/${'a'.repeat(50)}`]) await assert.rejects(initialOnBrowserRead({ url, maxBytes: 10, json: true }));assert.equal(calls, 0);
    document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\' data-target-workspace-uuid="uuid">';assert.equal(document.querySelector('article'), null);assert.equal(initialOnActorProbe('begin'), true);assert.equal(initialOnActorProbe(), true);document.querySelector('meta').setAttribute('data-current-user', '{"isAuthenticated":true}');assert.equal(initialOnActorProbe(), false);assert.equal(initialOnActorProbe('cleanup'), true);assert.equal(globalThis.__geldInitialOnSourceActor, undefined);
  } finally { restore();window.happyDOM.abort(); }
});


test('actual first-use preparation explicitly qualifies before original file selection, expands actual native rows and reconciles before forms without API polling', async () => {
  const p = protocol();p.item.initialNativeOn = {};const before = p.item.shellNativeSources;observeBitbucketShellFixture(p.page, p.item, { safeUrl: (v) => v, extensionId: 'unit' });Object.assign(p.item.shellNativeSources, before);
  const apiEvaluate = p.page.evaluate;let selected = false, expanded = false;const actions = [];
  const url = REVIEW + '#chg-bitbucket-pipelines.yml';
  const prefix = (side) => { const a = rows.filter((r) => r[side] !== null);let i = 0;while (i < a.length && a[i][side] === i + 1) i++;return a.slice(0, i); };
  const base = { url, heading: 'bitbucket-pipelines.yml', file: 'chg-bitbucket-pipelines.yml', rows, prefixOld: 18, prefixNext: 16, ownedCount: 0, invalidRanges: [], controls: [{ visible: true, previous: [18, 16], next: [29, 27] }] };
  const final = { ...base, oldSource: prefix('old'), newSource: prefix('next'), prefixOld: prefix('old').at(-1).old, prefixNext: prefix('next').at(-1).next, actualStep: true };
  p.page.evaluate = async (fn, action) => {
    if (fn === initialOnActorProbe || fn === initialOnBrowserRead) return apiEvaluate(fn, action);
    if (action === 'cleanup') return null;
    if (fn === bitbucketPipelineVisitProbe) { assert.equal(p.count(), 4, 'No file/article selection probe before complete API tuple qualification');if (action === 'click-result') return { trusted: true, sameLink: true, sameParent: true, href: '#chg-bitbucket-pipelines.yml' };return { url, selected, sameSource: true, pinned: selected ? url : null, heading: 'bitbucket-pipelines.yml' }; }
    if (fn === bitbucketPipelineConsentProbe) return { status: 'not_present', url };
    if (fn === bitbucketSyntaxSettingsProbe) return { url, sameSource: true, sourceRows: 44, viewed: [false], events: [] };
    assert.equal(fn, bitbucketShellProbe);if (action === 'scroll' || action === 'arm') return { matches: 1 };if (action === 'click-result') return { trusted: true, url, qa: 'pr-diff-show-more-lines-below', aria: 'Show more lines below', previous: [18, 16], next: [29, 27] };return structuredClone(expanded ? final : base);
  };
  p.page.evaluateHandle = async (fn) => ({ asElement: () => ({ click: async () => { assert.equal(p.count(), 4);if (fn === bitbucketPipelineVisitProbe) { selected = true;p.setURL(url);actions.push('trusted-native-file'); }else { expanded = true;actions.push('trusted-native-context'); } } }), dispose: async () => {} });
  const settings = { current: async (active) => { assert.equal(active, false); } };
  const deps = { ...p.deps, settings, sourceQualifier: p.qualifier, freshAnonymousProfile: true, tabState: async () => ({ allowed: false, hasDiff: false }), bitbucketDom: async () => ({ files: 5, additions: 46, deletions: 29 }) };
  try {
    const visit = await prepareInitialNativeOnSource(p.page, p.item, deps);assert.equal(visit.url, url);assert.equal(visit.head.head, H);assert.deepEqual(actions, ['trusted-native-file', 'trusted-native-context']);assert.equal(p.count(), 4);assert.equal(p.item.initialOnSourceQualification.status, 'api_tuple_and_original_native_rows_qualified');assert.equal(p.item.initialNativeOn.preparation.status, 'prepared');await flushObservedBitbucketShell(p.page);
    assert.equal(p.item.shellNativeSources.pins.length, 2, 'Actual helper requests naturally appear in the passive observer, never fabricated');assert.equal(p.item.initialOnSourceQualification.comparisons.filter((v) => v.purpose !== null).length, 2);assert.match(visit.head.basis, /CASE-ONLY/);
  } finally { p.page.emit('close'); }
});


test('positively attributed early product reads veto preparation but cold demand is allowed only after guarded enable boundary', async () => {
  const before = protocol();before.item.shellNativeSources.requests = [{ extensionInitiator: true, method: 'GET' }];await assert.rejects(before.qualifier.qualify(), /before first enable/);assert.equal(before.count(), 0);
  const late = protocol();await late.qualifier.qualify();late.qualifier.reconcile(late.probe);late.item.shellNativeSources.requests = [{ extensionInitiator: true, method: 'GET' }];await assert.rejects(late.qualifier.beforeEnable(), /before first enable/);assert.equal(late.count(), 4);
  const cold = protocol();await cold.qualifier.qualify();cold.qualifier.reconcile(cold.probe);await cold.qualifier.beforeEnable();cold.qualifier.assertEnableReserve();cold.item.shellNativeSources.requests = [{ extensionInitiator: true, method: 'GET' }];assert.equal(cold.qualifier.current().head, H);assert.equal(cold.count(), 7);assert.throws(() => cold.qualifier.assertEnableReserve());
});


for (const fault of [{ foreignFrame: true }, { unknownFrame: true }, { unknownRedirect: true }, { resourceType: 'xhr' }]) test(`explicit read rejects absent/foreign main-frame or original fetch provenance:${JSON.stringify(fault)}`, async () => {
  const p = protocol(fault);await assert.rejects(p.qualifier.qualify(), /bounded response validation/);assert.equal(p.count(), 1);assert.equal(p.item.initialOnSourceQualification.reads[0].status, 'failed');
});
test('malformed JSON has a fixed report/error and never serializes invalid native field text', async () => {
  const p = protocol({ malformedJSON: true });await assert.rejects(p.qualifier.qualify(), (error) => { assert.doesNotMatch(String(error), /INVALID_PRIVATE/);return true; });assert.doesNotMatch(JSON.stringify(p.item.initialOnSourceQualification), /INVALID_PRIVATE|rawPatch|text/);assert.equal(p.count(), 1);
});
test('a competing same-purpose request invalidates the explicit proof even before its response arrives', async () => {
  const p = protocol();await p.qualifier.qualify();const r = p.item.initialOnSourceQualification.requests.find((r) => r.purpose === 'initial_source_resolution');p.item.initialOnSourceQualification.requests.push({ ...r, requestId: 999 });assert.throws(() => p.qualifier.current(), /Competing browser request/);assert.equal(p.count(), 4);
});


test('browser stream/evaluation rejection produces a fixed report without native exception text', async () => { const p = protocol({ browserFailure: true });await assert.rejects(p.qualifier.qualify(), (error) => { assert.doesNotMatch(String(error), /PRIVATE_NATIVE_FIELD_OR_PATCH/);return true; });assert.doesNotMatch(JSON.stringify(p.item.initialOnSourceQualification), /PRIVATE_NATIVE_FIELD_OR_PATCH/);assert.equal(p.item.initialOnSourceQualification.reads.length, 1); });

test('same source head and a different valid same-prefix base cannot borrow the retained OLD/context-row oracle', async () => { const p = protocol({ hash: B.slice(0, 12) + 'f'.repeat(28), hashAt: 2 });await assert.rejects(p.qualifier.qualify(), /retained old-context/);assert.equal(p.count(), 2);assert.equal(p.item.initialOnSourceQualification.reads.some((r) => r.purpose === 'initial_pinned_diff'), false); });

test('later passive worker comparisons retain tuple checks without inheriting explicit main-frame fetch requirements', async () => { const p = protocol();await p.qualifier.qualify();p.qualifier.reconcile(p.probe);await p.qualifier.beforeEnable();p.qualifier.assertEnableReserve();const url = `${API}/diff/${REPO}:${H}%0D${B}?from_pullrequest_id=27&topic=true`;p.emit(url, 200, { foreignFrame: true });assert.equal(p.item.initialOnSourceQualification.requests.at(-1).mainFrame, false);assert.equal(p.item.initialOnSourceQualification.requests.at(-1).purpose, null);assert.equal(p.qualifier.current().head, H);assert.equal(p.count(), 7); });


test('standard old/new EOF no-newline annotations preserve real hunk rows, coordinates, text and counts', () => {
  const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n';
  const [file] = parseInitialOnPatch(patch);assert.deepEqual(file.rows, [{ old: 1, next: null, kind: '-', text: 'old' }, { old: null, next: 1, kind: '+', text: 'new' }]);assert.equal(file.additions, 1);assert.equal(file.deletions, 1);assert.deepEqual(file.noNewline, { old: true, next: true });
  for (const bad of [patch.replace('-old\n', '\\ No newline at end of file\n-old\n'), patch.replace('-old\n\\ No newline at end of file', '-old\n\\ No newline at end of file\n\\ No newline at end of file'), patch.replace('@@ -1 +1 @@', '@@ -1,2 +1 @@').replace('+new', '-later\n+new'), patch.replace('@@ -1 +1 @@', '@@ -1 +1,2 @@').replace('+new\n\\ No newline at end of file', '+new\n\\ No newline at end of file\n+later')]) assert.throws(() => parseInitialOnPatch(bad));
});
test('actual passive observer retains a fixed failure for explicit malformed JSON without weakening its identity guard or leaking the body', async () => {
  const p = protocol({ malformedJSON: true });const before = p.item.shellNativeSources;observeBitbucketShellFixture(p.page, p.item, { safeUrl: (value) => value, extensionId: 'unit', redactErrors: true });Object.assign(p.item.shellNativeSources, before);
  try { await assert.rejects(p.qualifier.qualify());await flushObservedBitbucketShell(p.page);assert.equal(p.item.shellNativeSources.errors.length, 1);assert.equal(p.item.shellNativeSources.errors[0].error, 'Observed source response validation failed');assert.doesNotMatch(JSON.stringify(p.item), /INVALID_PRIVATE_NATIVE_FIELD/);assert.throws(() => observedBitbucketShellIdentity(p.item.shellNativeSources)); }
  finally { p.page.emit('close'); }
});
