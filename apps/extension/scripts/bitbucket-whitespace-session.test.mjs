import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { BITBUCKET_WHITESPACE_URL as URL, bitbucketWhitespaceBudget as budget, bitbucketConnectRead, bitbucketWhitespaceSettings as settingsScope, bitbucketWhitespaceResource as resource, observeBitbucketWhitespace, qualifyBitbucketWhitespace as qualify, bitbucketWhitespaceProbe as probe, verifyBitbucketWhitespace as verify } from './bitbucket-whitespace-session.mjs';
const API = 'https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/';
const H = 'a'.repeat(40), B = 'b'.repeat(40);
const FILES = [{ path: 'test/test.py', additions: 2, deletions: 1 }];
const TOTALS = { files: 1, additions: 2, deletions: 1 };

function phaseRecords(phase = 'hide', mode = true) {
  const common = { phase, mode, qualified: true, method: 'GET', status: 200, validChain: true };
  return [
    { ...common, owner: 'extension', kind: 'pr', sourceRef: H, baseRef: B, sequence: 0 },
    ...['native', 'extension'].flatMap((owner, index) => ['diff', 'diffstat'].map((kind, n) => ({ ...common, owner, kind, sequence: 1 + index * 2 + n, head: H, base: B, firstNativeRoute: owner === 'native', redirected: false, files: structuredClone(FILES), totals: TOTALS }))),
    { ...common, owner: 'extension', kind: 'pr', sourceRef: H, baseRef: B, sequence: 5 },
  ];
}

test('forecast uses actual16 baseline, eight own reads and no native context/cache discount', () => {
  const value = budget(12);assert.equal(value.available, true);assert.equal(value.demand, 30);assert.equal(value.limit, 47);assert.equal(value.buffer, 5);assert.equal(budget(13).available, false);
  assert.equal(budget(0, { fullCycle: true }).available, false);assert.equal(budget(0, { fullCycle: true }).demand, 60);
  for (const input of [-1, NaN, Infinity, '0']) assert.throws(() => budget(input));
});
for (const original of [{ present: false }, { present: true, value: { hideWhitespace: true, custom: { secret: 'unchanged' } } }]) test('raw settings and presence restore only after page close', async () => {
  let value = structuredClone(original);const progress = {};const scope = settingsScope({ read: async () => structuredClone(value), write: async v => { value = structuredClone(v); }, progress });
  await scope.prepare();assert.equal(value.value.hideWhitespace, false);assert.equal(value.value.prOverview, false);
  await scope.hide(true);assert.equal(value.value.hideWhitespace, true);assert.deepEqual(value.value.custom, original.value?.custom);
  await assert.rejects(scope.restore(false), { code: 'CLOSE_BEFORE_RESTORE' });await scope.restore(true);assert.deepEqual(value, original);assert.equal(progress.pageClosedBeforeRestore, true);
});
test('scope refuses unrelated concurrent settings drift before applying hide change', async () => {
  let value = { present: false };const scope = settingsScope({ read: async () => structuredClone(value), write: async v => { value = structuredClone(v); }, progress: {} });await scope.prepare();value.value.other = true;await assert.rejects(scope.hide(true), { code: 'SETTINGS_CHANGED' });
});
test('native and immutable own routes retain independent mode and reference identity', () => {
  assert.equal(resource(`${API}pullrequests/22/diff?ignore_whitespace=true`).nativeRoute, true);assert.equal(resource(`${API}pullrequests/22/diff?ignore_whitespace=true`).mode, true);
  assert.equal(resource(`${API}diff/atlassian/bitbucket-upload-file:${H}%0D${B}?topic=true`).mode, false);
  for (const url of [`${API}pullrequests/23/diff`, `${API}pullrequests/22/diff?ignore_whitespace=1`, `${API}pullrequests/22/diff?ignore_whitespace=true&ignore_whitespace=false`, `${API}pullrequests/22/diff#hash`, `${API}pullrequests/22/diff`.replace('https://', 'https://secret@')]) assert.equal(resource(url), null);
});
test('independent current native and own response pairs prove matching mode without a product acknowledgement', () => {
  const value = qualify(phaseRecords(), 'hide', true);assert.equal(value.head, H);assert.deepEqual(value.totals, TOTALS);assert.equal(value.native.length, 2);assert.equal(value.own.length, 2);
});
for (const [name, alter] of [
  ['missing native response', r => r.splice(1, 1)], ['wrong native mode', r => { r[1].mode = false; }],
  ['mismatched diffstat counts', r => { r[2].files[0].additions++; }], ['foreign head', r => { r[3].head = B; }],
  ['missing metadata after', r => r.pop()], ['previous-phase response', r => { r[1].phase = 'baseline'; }],
  ['unqualified native route', r => { r[1].firstNativeRoute = false; }], ['redirected own source', r => { r[3].redirected = true; }],
]) test('oracle rejects ' + name, () => { const rows = phaseRecords();alter(rows);assert.throws(() => qualify(rows, 'hide', true)); });

test('observer passively parses bounded actual response bodies and never sends requests', async () => {
  const page = new EventEmitter(), progress = {}, abort = new AbortController();const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);observer.phase('hide');
  const diff = 'diff --git a/test/test.py b/test/test.py\n--- a/test/test.py\n+++ b/test/test.py\n@@ -1 +1,2 @@\n-old\n+new\n+next\n';
  const request = { url: () => `${API}pullrequests/22/diff?ignore_whitespace=true`, method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: 'https://bitbucket.org/app.js' }] } }) };
  page.emit('request', request);page.emit('response', { request: () => request, url: request.url, status: () => 200, headers: () => ({ 'content-type': 'text/plain' }), buffer: async () => Buffer.from(diff) });await observer.flush();
  assert.deepEqual(observer.records()[0].files, FILES);assert.equal(observer.records()[0].owner, 'native');assert.equal(observer.records()[0].qualified, true);assert.equal(abort.signal.aborted, false);await observer.dispose();assert.equal(page.listenerCount('request'), 0);
});
test('actual API writes and429 abort the observer without retaining response messages', async () => {
  for (const writing of [true, false]) {
    const page = new EventEmitter(), progress = {}, abort = new AbortController(), observer = observeBitbucketWhitespace(page, progress, 'installed', abort);let closed = false;page.close = async () => { closed = true; };
    const r = { url: () => `${API}pullrequests/22/diff`, method: () => writing ? 'POST' : 'GET', redirectChain: () => [] };page.emit('request', r);
    if (!writing) page.emit('response', { request: () => r, status: () => 429 });
    assert.equal(abort.signal.aborted, true);assert.equal(progress.providerWrites, writing ? 1 : 0);assert.equal(closed, writing);await observer.dispose();
  }
});

function dom() {
  const w = new Window({ url: URL, settings: { enableJavaScriptEvaluation: false } });
  w.document.head.innerHTML = `<meta id="bb-bootstrap" data-current-user='{"isAuthenticated":false}'>`;
  w.document.body.innerHTML = '<a id="pull-request-tabs-1" role="tab"><div><span><span>1</span></span></div></a><div id="file-tree"><div><div><h5>Lines updated</h5><span>+2</span><span>−1</span></div></div></div><div id="pull-request-tabs-1-tab" role="tabpanel"><button type="button" aria-live="polite">Global diff settings</button><div role="region" aria-label="Diff"><div><div id="chg-test/test.py"></div><div><article data-qa="branch-diff-file"><label>Viewed<input type="checkbox" disabled></label><span data-qa="code-line">source</span></article></div></div></div></div>';
  const old = new Map();for (const [k, value] of Object.entries({ document: w.document, Element: w.Element, location: w.location, getComputedStyle: w.getComputedStyle.bind(w) })) { old.set(k, Object.getOwnPropertyDescriptor(globalThis, k));Object.defineProperty(globalThis, k, { value, configurable: true }); }
  const addDialog = checked => { const d = w.document.createElement('div');d.setAttribute('role', 'dialog');d.innerHTML = '<form><label id="diff-settings-ignore-whitespace-toggle-label" for="diff-settings-ignore-whitespace-toggle">Whitespace changes<input id="diff-settings-ignore-whitespace-toggle" type="checkbox" name="shouldIgnoreWhitespace" value="shouldIgnoreWhitespace"></label><button type="button">Cancel</button><button type="submit">Save</button></form>';w.document.body.append(d);d.querySelector('input').checked = checked;for (const n of [d, ...d.querySelectorAll('*')]) n.getBoundingClientRect = () => ({ width: 20, height: 20 });return d; };
  return { w, addDialog, close() { probe('dispose');for (const [k, value] of old) if (value) Object.defineProperty(globalThis, k, value);else delete globalThis[k];w.happyDOM.abort(); } };
}
test('native probe reads only original known checkbox, retaining Viewed identity and rejecting duplicate fields', () => {
  const d = dom();try { assert.equal(probe('bind').originalsPreserved, true);const dialog = d.addDialog(true);const before = d.w.document.body.innerHTML;assert.equal(probe().checkbox.checked, true);assert.equal(d.w.document.body.innerHTML, before);dialog.querySelector('input').after(dialog.querySelector('input').cloneNode());assert.equal(probe().checkbox, null);assert.equal(probe('target', 'cancel').textContent, 'Cancel'); } finally { d.close(); }
});
for (const changed of ['node', 'value']) test('Viewed ' + changed + ' drift is not hidden by native reload allowance', () => {
  const d = dom();try { probe('bind');const box = d.w.document.querySelector('article input');if (changed === 'node') box.replaceWith(box.cloneNode());else box.checked = true;assert.equal(probe().viewedPreserved, false); } finally { d.close(); }
});

function protocol({ fullCycle = false, leak = false, untrusted = false, fail = false, remount = false, settledMutation = false, frameUnavailable = false, closeRace = false, closeOpenFailure = false } = {}) {
  let dialog = false, setting = false, phase = 'baseline', closed = false, restored = false, disposed = false, generation = 0, preserved = true;const events = [], calls = [], rows = phaseRecords('baseline', false).filter(r => r.owner === 'native');
  const state = () => ({ originalPage: true, originalsPreserved: preserved, rowsPreserved: preserved, viewedPreserved: preserved, samePaths: true, viewedSemanticsPreserved: true, settledMounted: true, busy: false, forbiddenInputs: 0, overflow: false, events: [...events], dialogCount: dialog ? 1 : 0, checkbox: dialog ? { checked: leak && setting ? false : true } : null, cancelAvailable: dialog, totals: TOTALS });
  const settings = { current: async () => ({ hideWhitespace: setting }), hide: async v => { setting = v;if (remount) preserved = false;calls.push('settings:' + v);rows.push(...phaseRecords(phase, v)); }, restore: async value => { assert.equal(value, true);restored = true;calls.push('restored'); } };
  const page = { isClosed: () => closed, close: async () => { if (closeOpenFailure) throw Error('Still open');closed = true;calls.push('closed');if (closeRace) throw Error('Already closing'); }, evaluate: async (_f, action) => { if (_f !== probe) return !frameUnavailable;if (action === 'dispose') return { released: true };if (action === 'begin') return { begun: true, generation };if (action === 'candidate') return { stable: true, generation };if (action === 'rebind') { generation++;preserved = true;return { rebound: true, generation, originalsReplaced: remount, rowsReplaced: remount, viewedReplaced: remount }; }return state(); }, evaluateHandle: async (_f, _action, which) => ({ asElement: () => ({ evaluate: async () => true, click: async () => { events.push({ control: which, trusted: !untrusted });dialog = which === 'opener';if (remount && phase !== 'baseline') preserved = false;calls.push(which);if (phase === 'open') rows.push(...phaseRecords(phase, false));if (phase === 'cancel') rows.push(...phaseRecords(phase, true)); } }), dispose: async () => {} }) };
  const observer = { evidence: { providerWrites: 0, overflow: false }, records: () => rows, idle: () => ({ pending: 0, observed: rows.length }), phase: v => { phase = v; }, flush: async () => {}, dispose: async () => { disposed = true; } };
  const progress = {};const poll = async (read, accept) => { if (fail && phase === 'hide') throw Error('SECRET_FAILURE');for (let attempt = 0; attempt < 3; attempt++) { const v = await read();if (accept(v)) return v; }assert.fail('Protocol poll failed'); };
  return { run: () => verify(page, { settings, observer, progress, poll, readState: async () => { if (settledMutation) preserved = false;return { hasDiff: true, all: TOTALS, visible: TOTALS }; }, guardBudget: () => {}, fullCycle }), progress, calls, finished: () => ({ closed, restored, disposed }) };
}
test('bounded public sequence stops with Settings open, no Save, and closes before raw restore', async () => {
  const p = protocol();await p.run();assert.deepEqual(p.calls, ['opener', 'cancel', 'settings:true', 'opener', 'closed', 'restored']);assert.deepEqual(p.finished(), { closed: true, restored: true, disposed: true });assert.equal(p.progress.scope, 'first_activation_and_native_settings_restore');assert.equal(p.progress.opened.checkbox.checked, true);
});
test('full cycle offline driver verifies Cancel reapply and false restore without a Save path', async () => {
  const p = protocol({ fullCycle: true });await p.run();assert.deepEqual(p.progress.phases.map(p => p.phase), ['hide', 'open', 'cancel', 'show']);assert.equal(p.calls.includes('settings:false'), true);assert.equal(p.calls.includes('Save'), false);
});
for (const option of ['leak', 'untrusted', 'fail']) test('protocol rejects ' + option + ' and always closes before exact cleanup', async () => {
  const p = protocol({ [option]: true });await assert.rejects(p.run());assert.deepEqual(p.finished(), { closed: true, restored: true, disposed: true });assert.equal(p.progress.status, 'failed');assert.equal(JSON.stringify(p.progress).includes('SECRET_FAILURE'), false);
});

test('native compare URLs need the exact advertised native metadata link, not an extension acknowledgement', () => {
  const records = phaseRecords();for (const r of records.filter(r => r.owner === 'native')) { r.firstNativeRoute = false;r.routeKey = r.kind; }
  assert.throws(() => qualify(records, 'hide', true), { code: 'NATIVE_ADVERTISED_PAIR' });
  records.unshift({ kind: 'pr', owner: 'native', sourceRef: H, baseRef: B, sequence: -1, qualified: true, method: 'GET', status: 200, validChain: true, nativeLinks: ['diff', 'diffstat'].map(kind => ({ kind, routeKey: kind })) });
  assert.equal(qualify(records, 'hide', true).head, H);
  records[0].nativeLinks[0].routeKey = 'other';assert.throws(() => qualify(records, 'hide', true));
});
test('new contradictory metadata, response errors and wrong startup mode revoke an otherwise valid proof', () => {
  for (const wrong of [{ kind: 'pr', owner: 'native', sourceRef: B, baseRef: H, qualified: true, method: 'GET', status: 200, validChain: true }, { error: 'RESPONSE_UNQUALIFIED' }, { phase: 'hide', owner: 'extension', kind: 'diff', mode: false }]) {
    const records = phaseRecords();records.push(wrong);assert.throws(() => qualify(records, 'hide', true));
  }
});

test('wrong-mode own startup request is rejected before counting a later correct response', async () => {
  const page = new EventEmitter(), progress = {}, abort = new AbortController();let closed = false;page.close = async () => { closed = true; };
  const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);observer.phase('hide');
  page.emit('request', { url: () => `${API}diff/atlassian/bitbucket-upload-file:${H}%0D${B}`, method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: 'chrome-extension://installed/background.js' }] } }) });
  assert.equal(closed, true);assert.equal(abort.signal.aborted, true);assert.equal(progress.requests[0].error, 'WRONG_MODE_STARTUP');await observer.dispose();
});

test('a reused abbreviated ref cannot be retroactively resolved to a different full hash', () => {
  const records = phaseRecords();for (const r of records.filter(r => r.kind === 'pr')) r.sourceRef = H.slice(0, 12);
  records.push({ kind: 'resolve', ref: H.slice(0, 12), hash: H, qualified: true, method: 'GET', status: 200, validChain: true });
  assert.equal(qualify(records, 'hide', true).head, H);
  records.push({ kind: 'resolve', ref: H.slice(0, 12), hash: H.slice(0, 12) + 'c'.repeat(28), qualified: true, method: 'GET', status: 200, validChain: true });
  assert.throws(() => qualify(records, 'hide', true), { code: 'RESOLUTION_CONFLICT' });
});
test('304 requires the same exact request key, owner and body as a prior qualified200', async () => {
  for (const variation of ['same', 'missing', 'different-url', 'different-body', 'different-owner']) {
    const page = new EventEmitter(), progress = {}, observer = observeBitbucketWhitespace(page, progress, 'installed', new AbortController());
    const emit = async (status, url, hash, extension = false) => {
      const r = { url: () => url, method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: extension ? 'chrome-extension://installed/worker.js' : 'https://bitbucket.org/app.js' }] } }) };
      page.emit('request', r);page.emit('response', { request: () => r, status: () => status, headers: () => ({ 'content-type': 'application/json' }), buffer: async () => Buffer.from(JSON.stringify({ hash })) });await observer.flush();
    };
    const url = `${API}commit/${H.slice(0, 12)}?fields=hash`;
    if (variation !== 'missing') await emit(200, url, H);
    await emit(304, variation === 'different-url' ? url + '&fields=repository' : url, variation === 'different-body' ? H.slice(0, 12) + 'c'.repeat(28) : H, variation === 'different-owner');
    const last = observer.records().at(-1);assert.equal(last.qualified === true, variation === 'same', variation);assert.equal(last.cacheBasis, variation === 'same' ? 'same_key_prior200_same_body' : undefined);await observer.dispose();
  }
});

for (const change of ['name', 'value', 'label', 'disabled']) test('native checkbox declines mismatched ' + change + ' instead of reading another setting', () => {
  const d = dom();try { probe('bind');const dialog = d.addDialog(true);const field = dialog.querySelector('input');
    if (change === 'name') field.name = 'other';if (change === 'value') field.value = 'other';if (change === 'disabled') field.disabled = true;
    if (change === 'label') field.parentElement.firstChild.textContent = 'Another setting';
    assert.equal(probe().checkbox, null);
  } finally { d.close(); }
});

test('absence of an extension initiator is not positive native request evidence', async () => {
  for (const [frame, owner] of [[null, 'unknown'], ['https://elsewhere.test/app.js', 'unknown'], ['https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.hash.js', 'native'], ['chrome-extension://installed/background.js', 'extension']]) {
    const page = new EventEmitter(), observer = observeBitbucketWhitespace(page, {}, 'installed', new AbortController());
    page.emit('request', { url: () => `${API}pullrequests/22/diff`, method: () => 'GET', redirectChain: () => [], initiator: () => frame === null ? {} : { stack: { callFrames: [{ url: frame }] } } });
    assert.equal(observer.records()[0].owner, owner);await observer.dispose();
  }
});

test('a later200 response cannot qualify an earlier304 whose body finishes last', async () => {
  const page = new EventEmitter(), observer = observeBitbucketWhitespace(page, {}, 'installed', new AbortController());
  const url = `${API}commit/${H.slice(0, 12)}?fields=hash`;
  const request = () => ({ url: () => url, method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: 'https://bitbucket.org/app.js' }] } }) });
  const first = request(), second = request();page.emit('request', first);page.emit('request', second);
  const bytes = Buffer.from(JSON.stringify({ hash: H }));let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const response = (r, status, body) => ({ request: () => r, status: () => status, headers: () => ({}), buffer: () => body });
  page.emit('response', response(second, 304, delayed));
  page.emit('response', response(first, 200, Promise.resolve(bytes)));
  await new Promise(resolve => setImmediate(resolve));assert.equal(observer.records()[0].qualified, true);
  release(bytes);await observer.flush();assert.equal(observer.records()[1].qualified, undefined);assert.equal(observer.records()[1].error, 'CACHE_PROVENANCE');await observer.dispose();
});

test('equal counts do not override conflicting comparison topic or pull request IDs', () => {
  for (const [field, expected, changed] of [['topic', 'true', 'false'], ['pullRequest', '22', '23']]) {
    const records = phaseRecords();for (const r of records) r[field] = expected;
    records[1].firstNativeRoute = false;records[1].routeKey = 'advertised';records[1][field] = changed;
    records.unshift({ kind: 'pr', owner: 'native', sourceRef: H, baseRef: B, sequence: -1, qualified: true, method: 'GET', status: 200, validChain: true, nativeLinks: [{ kind: 'diff', routeKey: 'advertised', [field]: expected }] });
    assert.throws(() => qualify(records, 'hide', true));
  }
});
test('query classifier retains comparison semantics separately from presentation parameters', () => {
  const value = resource(`${API}diff/atlassian/bitbucket-upload-file:${H}%0D${B}?topic=true&from_pullrequest_id=22&context=3&ignore_whitespace=true`);
  assert.equal(value.topic, 'true');assert.equal(value.pullRequest, '22');assert.equal(value.mode, true);
  assert.equal(resource(`${API}pullrequests/22/diff?topic=false`).pullRequest, '22');
  for (const query of ['topic=true&topic=false', 'from_pullrequest_id=22&from_pullrequest_id=23', 'topic=unknown']) assert.equal(resource(`${API}pullrequests/22/diff?${query}`), null);
});

test('genuine native article replacement is leased only at an explicit matching transition', () => {
  const d = dom();try {
    probe('bind');const begun = probe('begin', 'hide');assert.equal(begun.begun, true);
    const article = d.w.document.querySelector('article');article.replaceWith(article.cloneNode(true));
    const during = probe();assert.equal(during.originalsPreserved, false);assert.equal(during.viewedPreserved, false);assert.equal(during.viewedSemanticsPreserved, true);
    assert.equal(probe('rebind', { phase: 'open', generation: begun.generation, paths: ['test/test.py'] }), null);
    assert.equal(probe('rebind', { phase: 'hide', generation: begun.generation, paths: ['other.py'] }), null);
    assert.equal(probe('candidate').stable, false);assert.equal(probe('candidate').stable, true);
    const rebound = probe('rebind', { phase: 'hide', generation: begun.generation, paths: ['test/test.py'] });assert.equal(rebound.rebound, true);assert.equal(rebound.originalsReplaced, true);
    assert.equal(probe().originalsPreserved, true);assert.equal(probe().viewedPreserved, true);
    assert.equal(probe('rebind', { phase: 'hide', generation: begun.generation, paths: ['test/test.py'] }), null);
    d.w.document.querySelector('[data-qa="code-line"]').firstChild.textContent = 'changed';assert.equal(probe().rowsPreserved, false);
    assert.equal(probe('begin', 'open'), null);
  } finally { d.close(); }
});
for (const change of ['viewed', 'path', 'frame', 'epoch']) test('native transition cannot adopt changed ' + change, () => {
  const d = dom();try {
    probe('bind');const begun = probe('begin', 'hide');
    if (change === 'viewed') d.w.document.querySelector('article input').checked = true;
    if (change === 'path') d.w.document.querySelector('[id="chg-test/test.py"]').id = 'chg-other.py';
    if (change === 'frame') d.w.document.querySelector('meta').setAttribute('data-current-user', '{"isAuthenticated":true}');
    const value = probe('rebind', { phase: 'hide', generation: begun.generation + (change === 'epoch' ? 1 : 0), paths: ['test/test.py'] });assert.equal(value, null);
  } finally { d.close(); }
});
test('readiness diagnostic is bounded and contains only native structure flags', () => {
  const d = dom();try { const value = probe('diagnostic');assert.equal(value.exactURL, true);assert.equal(value.panelCount, 1);assert.equal(value.articleCount, 1);assert.equal(value.bound, false);assert.equal(JSON.stringify(value).includes('source'), false);assert.equal(JSON.stringify(value).includes('data-current-user'), false); } finally { d.close(); }
});
test('protocol permits replacement only after fresh native response proof, then returns to strict settled checks', async () => {
  const p = protocol({ remount: true });await p.run();assert.equal(p.progress.generations.length, 2);assert.equal(p.progress.generations.every(g => g.rebound && g.originalsReplaced), true);
  const changed = protocol({ remount: true, settledMutation: true });await assert.rejects(changed.run(), { code: 'SETTLED_NATIVE_CHANGED' });
  const missingProof = protocol({ remount: true, fail: true });await assert.rejects(missingProof.run());assert.equal(missingProof.progress.generations, undefined);
});
test('restored native mode must still match the already verified full comparison', () => {
  const records = phaseRecords('open', false);assert.equal(qualify(records, 'open', false, { own: false, expected: { head: H, base: B } }).totals.files, 1);
  records[1].head = B;assert.throws(() => qualify(records, 'open', false, { own: false, expected: { head: H, base: B } }), { code: 'NATIVE_REFS' });
});

test('a delayed native remount after a fresh response restarts candidate stability before rebind', () => {
  const d = dom();try {
    probe('bind');const token = probe('begin', 'hide');
    assert.equal(probe('candidate').stable, false); // First post-response old-DOM sample.
    assert.equal(probe('rebind', { phase: 'hide', generation: token.generation, paths: ['test/test.py'] }), null);
    const article = d.w.document.querySelector('article');article.replaceWith(article.cloneNode(true)); // Queued native commit.
    assert.equal(probe('rebind', { phase: 'hide', generation: token.generation, paths: ['test/test.py'] }), null);
    assert.equal(probe('candidate').stable, false); // New identities retire old sample.
    assert.equal(probe('candidate').stable, true);
    const rebound = probe('rebind', { phase: 'hide', generation: token.generation, paths: ['test/test.py'] });assert.equal(rebound.rebound, true);assert.equal(rebound.originalsReplaced, true);
    assert.equal(probe().rowsPreserved, true);
  } finally { d.close(); }
});
test('row content changing after the last candidate sample cannot be adopted', () => {
  const d = dom();try {
    probe('bind');const token = probe('begin', 'hide');probe('candidate');probe('candidate');
    d.w.document.querySelector('[data-qa="code-line"]').firstChild.textContent = 'late changed native content';
    assert.equal(probe('rebind', { phase: 'hide', generation: token.generation, paths: ['test/test.py'] }), null);
    assert.equal(probe('candidate').stable, false);assert.equal(probe('candidate').stable, true);
  } finally { d.close(); }
});

test('missing native render ticks fail finitely and still close before raw restore', async () => {
  const p = protocol({ frameUnavailable: true });await assert.rejects(p.run(), { code: 'NATIVE_RENDER_TICKS' });assert.deepEqual(p.finished(), { closed: true, restored: true, disposed: true });
});

const CONNECT = 'https://bitbucket.org/!api/internal/workspaces/%7B02b941e3-cfaa-40f9-9a58-cec53e20bdc3%7D/connect/modules';
const APP = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.6ea3303b1b2659fcb5ca5dc82e17933a815f4108.js';
function connectRequest(options = {}) {
  const target = options.target ?? { type: 'repository', full_name: 'atlassian/bitbucket-upload-file', name: 'bitbucket-upload-file', links: { self: { href: API.slice(0, -1) } } };
  const body = options.body ?? JSON.stringify([{ target, modules: ['webItems:org.bitbucket.repository.navigation'] }]);
  return { url: () => options.url ?? CONNECT, method: () => options.method ?? 'POST', postData: () => body,
    headers: () => options.headers ?? { accept: 'application/json', 'content-type': 'application/json' },
    initiator: () => ({ stack: { callFrames: options.frames ?? [{ url: APP }] } }), redirectChain: () => [] };
}

test('only the audited fixed-workspace native JSON module lookup is exempted as a read POST', () => {
  const value = bitbucketConnectRead(connectRequest());assert.deepEqual(value, { allowed: true, code: 'AUDITED_CONNECT_METADATA_READ', entries: 1, moduleCount: 1 });
  assert.equal(bitbucketConnectRead(connectRequest({ url: CONNECT + '?app_key%5B0%5D=known-addon&module_key=review-panel' })).allowed, true);
  const target = { type: 'pullrequest', id: 22, links: { self: { href: API + 'pullrequests/22' } }, source: { repository: { full_name: 'atlassian/bitbucket-upload-file' } } };
  assert.equal(bitbucketConnectRead(connectRequest({ target })).allowed, true);
  assert.equal(bitbucketConnectRead(connectRequest({ body: JSON.stringify([{ target, modules: [] }]) })).allowed, true);
});
for (const [name, options] of [
  ['different endpoint', { url: CONNECT.replace('/modules', '/addons/access_token') }],
  ['different workspace', { url: CONNECT.replace('02b941e3', '12b941e3') }],
  ['different origin', { url: CONNECT.replace('bitbucket.org', 'api.bitbucket.org') }],
  ['mutation method', { method: 'PUT' }], ['unknown query', { url: CONNECT + '?delete=true' }],
  ['unqualified native source', { frames: [{ url: 'https://bitbucket.org/unrelated.js' }] }],
  ['extension initiator', { frames: [{ url: 'chrome-extension://installed/background.js' }, { url: APP }] }],
  ['unknown content type', { headers: { accept: 'application/json', 'content-type': 'text/plain' } }],
  ['invalid JSON', { body: '{broken' }], ['wrong outer body', { body: '{}' }],
  ['extra operation', { body: JSON.stringify([{ target: {}, modules: [], delete: true }]) }],
  ['foreign repository', { target: { type: 'repository', full_name: 'someone/private', links: { self: { href: API.slice(0, -1) } } } }],
  ['foreign pull request', { target: { type: 'pullrequest', id: 23, links: { self: { href: API + 'pullrequests/23' } } } }],
  ['missing self source', { target: { type: 'repository', full_name: 'atlassian/bitbucket-upload-file' } }],
  ['unrecognized module selector', { body: JSON.stringify([{ target: {}, modules: ['delete'] }]) }],
]) test('read POST exemption rejects ' + name, () => { assert.equal(bitbucketConnectRead(connectRequest(options)).allowed, false); });

test('native read POST does not trigger write abort, while blocked receipts precede abort without body/query values', async () => {
  const page = new EventEmitter(), progress = {}, abort = new AbortController();let closed = false;page.close = async () => { closed = true; };
  const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);page.emit('request', connectRequest());
  assert.equal(abort.signal.aborted, false);assert.equal(progress.providerWrites, 0);assert.equal(progress.nativeReadPosts.length, 1);
  let atAbort;abort.signal.addEventListener('abort', () => { atAbort = structuredClone(progress.blockedWrites); });
  page.emit('request', connectRequest({ url: CONNECT.replace('/modules', '/addons/access_token') + '?SECRET_QUERY', body: 'SECRET_BODY' }));
  assert.equal(closed, true);assert.equal(progress.providerWrites, 1);assert.equal(atAbort.length, 1);
  assert.deepEqual(atAbort[0], { origin: 'https://bitbucket.org', path: '/!api/internal/workspaces/%7B02b941e3-cfaa-40f9-9a58-cec53e20bdc3%7D/connect/addons/access_token', method: 'POST', owner: 'native', phase: 'baseline', code: 'CONNECT_PATH' });
  assert.equal(JSON.stringify(progress).includes('SECRET_'), false);await observer.dispose();
});

test('response failures retain fixed body, JSON and source reasons instead of raw error text', async () => {
  for (const [mode, expected] of [['buffer', 'RESPONSE_BUFFER_FAILED'], ['json', 'RESPONSE_JSON_FAILED'], ['source', 'PR_SOURCE']]) {
    const page = new EventEmitter(), progress = {}, observer = observeBitbucketWhitespace(page, progress, 'installed', new AbortController());
    const request = { url: () => API + 'pullrequests/22', method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: APP }] } }) };
    page.emit('request', request);page.emit('response', { request: () => request, status: () => 200, headers: () => ({}), buffer: async () => { if (mode === 'buffer') throw Error('PRIVATE_ERROR');return Buffer.from(mode === 'json' ? 'PRIVATE_JSON_ERROR' : '{}'); } });
    await observer.flush();assert.equal(progress.requests[0].error, expected);assert.equal(progress.failures[0].code, expected);assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);await observer.dispose();
  }
});


test('observer-initiated page-close race is successful cleanup when the page actually closes', async () => {
  const p = protocol({ closeRace: true });await p.run();assert.deepEqual(p.finished(), { closed: true, restored: true, disposed: true });assert.deepEqual(p.progress.cleanup.failures, []);
});
test('failed close that leaves page open remains a hard cleanup failure', async () => {
  const p = protocol({ closeOpenFailure: true });await assert.rejects(p.run(), { code: 'CLEANUP_FAILED' });assert.equal(p.finished().closed, false);assert.ok(p.progress.cleanup.failures.includes('PAGE_CLOSE'));assert.ok(p.progress.cleanup.failures.includes('SETTINGS_RESTORE'));
});


test('external response error codes are not serialized as trusted diagnostic reasons', async () => {
  const page = new EventEmitter(), progress = {}, observer = observeBitbucketWhitespace(page, progress, 'installed', new AbortController());
  const request = { url: () => API + 'pullrequests/22', method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: APP }] } }) };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200, headers: () => ({}), buffer: async () => { throw Object.assign(Error('PRIVATE_MESSAGE'), { code: 'PRIVATE_CANARY' }); } });
  await observer.flush();assert.equal(progress.requests[0].error, 'RESPONSE_BUFFER_FAILED');assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);await observer.dispose();
});


test('unexpected Connect targets produce bounded known-shape diagnostics, never unknown values', async () => {
  const page = new EventEmitter(), progress = {}, abort = new AbortController();page.close = async () => {};
  const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);
  page.emit('request', connectRequest({ target: { type: 'PRIVATE_TYPE', uuid: 'PRIVATE_UUID', full_name: 'PRIVATE_NAME', id: 'PRIVATE_ID', links: { self: { href: 'https://api.bitbucket.org/PRIVATE_PATH' } } } }));
  assert.equal(abort.signal.aborted, true);assert.deepEqual(progress.blockedWrites[0].diagnostic, { targetKind: 'other', selfRepositoryMatches: false, selfPullrequestMatches: false, repositoryNameMatches: false, pullrequestIdMatches: false, nestedRepositoryMatches: false, sourceRepositoryMatches: false, workspaceUuidMatches: false });
  assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);await observer.dispose();
  const workspace = bitbucketConnectRead(connectRequest({ target: { type: 'workspace', uuid: '{02b941e3-cfaa-40f9-9a58-cec53e20bdc3}' } }));
  assert.equal(workspace.allowed, false);assert.equal(workspace.diagnostic.targetKind, 'workspace');assert.equal(workspace.diagnostic.workspaceUuidMatches, true);
});
