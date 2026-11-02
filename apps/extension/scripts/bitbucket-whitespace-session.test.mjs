import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { BITBUCKET_WHITESPACE_URL as URL, bitbucketWhitespaceBudget as budget, bitbucketWhitespaceAwait, bitbucketConnectRead, bitbucketNativeReadPost, bitbucketWhitespaceSettings as settingsScope, bitbucketWhitespaceResource as resource, observeBitbucketWhitespace, qualifyBitbucketWhitespace as qualify, bitbucketWhitespaceProbe as probe, verifyBitbucketWhitespace as verify } from './bitbucket-whitespace-session.mjs';
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
  await scope.prepare();assert.equal(value.value.hideWhitespace, false);assert.equal(value.value.prOverview, false);assert.equal(value.value.autoUpdatePatterns, false);
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

function protocol({ fullCycle = false, leak = false, untrusted = false, fail = false, remount = false, settledMutation = false, frameUnavailable = false, closeRace = false, closeOpenFailure = false, checkpoint: checkpointHook = async () => {} } = {}) {
  let dialog = false, setting = false, phase = 'baseline', closed = false, restored = false, disposed = false, generation = 0, preserved = true;const events = [], calls = [], rows = phaseRecords('baseline', false).filter(r => r.owner === 'native');
  const state = () => ({ originalPage: true, originalsPreserved: preserved, rowsPreserved: preserved, viewedPreserved: preserved, samePaths: true, viewedSemanticsPreserved: true, settledMounted: true, busy: false, forbiddenInputs: 0, overflow: false, events: [...events], dialogCount: dialog ? 1 : 0, checkbox: dialog ? { checked: leak && setting ? false : true } : null, cancelAvailable: dialog, totals: TOTALS });
  const settings = { current: async () => ({ hideWhitespace: setting }), hide: async v => { setting = v;if (remount) preserved = false;calls.push('settings:' + v);rows.push(...phaseRecords(phase, v)); }, restore: async value => { assert.equal(value, true);restored = true;calls.push('restored'); } };
  const page = { isClosed: () => closed, close: async () => { if (closeOpenFailure) throw Error('Still open');closed = true;calls.push('closed');if (closeRace) throw Error('Already closing'); }, evaluate: async (_f, action) => { if (_f !== probe) return !frameUnavailable;if (action === 'dispose') return { released: true };if (action === 'begin') return { begun: true, generation };if (action === 'candidate') return { stable: true, generation };if (action === 'rebind') { generation++;preserved = true;return { rebound: true, generation, originalsReplaced: remount, rowsReplaced: remount, viewedReplaced: remount }; }return state(); }, evaluateHandle: async (_f, _action, which) => ({ asElement: () => ({ evaluate: async () => true, click: async () => { events.push({ control: which, trusted: !untrusted });dialog = which === 'opener';if (remount && phase !== 'baseline') preserved = false;calls.push(which);if (phase === 'open') rows.push(...phaseRecords(phase, false));if (phase === 'cancel') rows.push(...phaseRecords(phase, true)); } }), dispose: async () => {} }) };
  const observer = { evidence: { providerWrites: 0, overflow: false }, records: () => rows, idle: () => ({ pending: 0, observed: rows.length }), phase: v => { phase = v; }, flush: async () => {}, dispose: async () => { disposed = true; } };
  const progress = {};const poll = async (read, accept) => { if (fail && phase === 'hide') throw Error('SECRET_FAILURE');for (let attempt = 0; attempt < 3; attempt++) { const v = await read();if (accept(v)) return v; }assert.fail('Protocol poll failed'); };
  return { run: () => verify(page, { settings, observer, progress, poll, readState: async () => { if (settledMutation) preserved = false;return { hasDiff: true, all: TOTALS, visible: TOTALS }; }, guardBudget: () => {}, fullCycle, checkpoint: checkpointHook }), progress, calls, finished: () => ({ closed, restored, disposed }) };
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
const NEW_APP = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.5ff3a9b1c1755f86e976fb46708c460744f6ad56.js';
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
  assert.deepEqual(atAbort[0], { origin: 'https://bitbucket.org', path: '/!api/internal/workspaces/%7B02b941e3-cfaa-40f9-9a58-cec53e20bdc3%7D/connect/addons/access_token', method: 'POST', owner: 'native', phase: 'baseline', code: 'NATIVE_POST_PATH' });
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

const STARTUP_FIELDS = '+*.commit_status.updated_on,+*.commit_status.description,+*.commit_status.name';
const STARTUP_PATHS = {
  signature: 'https://bitbucket.org/!api/internal/atlassian/bitbucket-upload-file/signature-statuses/',
  commit_status: 'https://bitbucket.org/!api/internal/repositories/atlassian/bitbucket-upload-file/commits/statuses/?fields=' + encodeURIComponent(STARTUP_FIELDS),
  run_eligibility: 'https://bitbucket.org/!api/internal/repositories/%7B02b941e3-cfaa-40f9-9a58-cec53e20bdc3%7D/%7Be763018c-1ab1-4d2d-ae2b-9feb70af3997%7D/pipelines-config/run-eligibility',
};
function startupRequest(kind, options = {}) {
  const body = kind === 'run_eligibility' ? '{}' : kind === 'signature' ? JSON.stringify({ hashes: [H, B] }) : `commits=${H}&commits=${B}`;
  return connectRequest({ url: STARTUP_PATHS[kind], body,
    headers: { accept: kind === 'commit_status' ? '*/*' : 'application/json', 'content-type': kind === 'commit_status' ? 'text/plain;charset=UTF-8' : 'application/json', 'x-requested-with': 'XMLHttpRequest', 'x-bitbucket-frontend': 'frontbucket' }, ...options });
}
for (const app of [APP, NEW_APP]) test('both exact audited native app revisions qualify all four metadata reads: ' + app.slice(-43), () => {
  const requests = [connectRequest({ frames: [{ url: app }] }), ...['signature', 'commit_status', 'run_eligibility'].map(kind => startupRequest(kind, { frames: [{ url: app }] }))];
  for (const request of requests) assert.equal(bitbucketNativeReadPost(request).allowed, true);
  assert.equal(bitbucketNativeReadPost(startupRequest('run_eligibility', { frames: [{ url: app }], body: '{"run":true}' })).allowed, false);
});
for (const app of [APP.replace(/app\.[^.]+/, 'app.' + '0'.repeat(40)), APP.replace('https:', 'http:'), APP.replace('.net/', '.net.evil.test/'), APP.replace('https://', 'https://user:PRIVATE_PASSWORD@'), APP + '?PRIVATE_QUERY', APP + '#PRIVATE_FRAGMENT', APP + '.map', APP.replace('/assets/', '/PRIVATE_PATH/')]) test('unknown and lookalike native app URLs do not qualify read POSTs: ' + app.slice(-45), () => {
  const result = bitbucketNativeReadPost(startupRequest('signature', { frames: [{ url: app, functionName: 'PRIVATE_FUNCTION' }] }));
  assert.equal(result.allowed, false);assert.equal(result.code, 'NATIVE_POST_INITIATOR');assert.equal(result.diagnostic.auditedMatch, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.ok(result.diagnostic.nativeAppPaths.every(path => /^\/assets\/app\.[a-f0-9]{40}\.js$/.test(path)));
});
test('audited app mixed with any extension frame is denied and retains only safe initiator facts', async () => {
  for (const frames of [[{ url: NEW_APP }, { url: 'chrome-extension://other/PRIVATE_SCRIPT.js' }], [{ url: 'chrome-extension://installed/PRIVATE_SCRIPT.js' }, { url: APP }]]) {
    const request = startupRequest('signature', { frames }), result = bitbucketNativeReadPost(request);
    assert.equal(result.allowed, false);assert.equal(result.diagnostic.auditedMatch, true);assert.equal(result.diagnostic.extensionPresent, true);assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  }
  const request = connectRequest({ frames: [{ url: NEW_APP }] });request.initiator = () => ({ stack: { callFrames: [{ url: NEW_APP }], parent: { callFrames: [{ url: 'chrome-extension://other/PRIVATE_SCRIPT.js' }] } } });
  const page = new EventEmitter(), progress = {}, abort = new AbortController();page.close = async () => {};
  const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);page.emit('request', request);
  assert.equal(abort.signal.aborted, true);assert.equal(progress.blockedWrites[0].code, 'CONNECT_INITIATOR');
  assert.deepEqual(progress.blockedWrites[0].diagnostic.nativeAppPaths, ['/assets/' + NEW_APP.split('/').at(-1)]);
  assert.equal(progress.blockedWrites[0].diagnostic.extensionPresent, true);assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);await observer.dispose();
});
test('truncated initiator diagnostics retain the existing bounded lookup behavior', () => {
  const request = startupRequest('signature', { frames: [{ url: NEW_APP }, ...Array.from({ length: 255 }, () => ({ url: 'https://bitbucket.org/PRIVATE_NAME' })), { url: 'chrome-extension://other/PRIVATE_SCRIPT' }] });
  const captured = startupRequest('signature', { frames: request.initiator().stack.callFrames });
  captured.initiator = () => ({ stack: { ...request.initiator().stack, callFrames: [{ url: 'chrome-extension://other/PRIVATE_SCRIPT' }, ...request.initiator().stack.callFrames] } });
  const frames = bitbucketNativeReadPost(captured);assert.equal(frames.allowed, false);assert.equal(frames.diagnostic.framesTruncated, true);assert.equal(frames.diagnostic.auditedMatch, true);
  assert.equal(bitbucketNativeReadPost(request).allowed, true);
  let stack = { callFrames: [{ url: 'chrome-extension://other/PRIVATE_SCRIPT' }] };
  for (let depth = 0; depth < 8; depth++) stack = { callFrames: depth === 7 ? [{ url: APP }] : [], parent: stack };
  request.initiator = () => ({ stack });const deep = bitbucketNativeReadPost(request);
  assert.equal(deep.allowed, true);
  stack.callFrames.unshift({ url: 'chrome-extension://other/PRIVATE_SCRIPT' });const rejected = bitbucketNativeReadPost(request);
  assert.equal(rejected.allowed, false);assert.equal(rejected.diagnostic.stackTruncated, true);assert.equal(JSON.stringify(rejected).includes('PRIVATE_'), false);
});
test('initiator diagnostics cap native app paths without exposing arbitrary frame details', () => {
  const unknown = Array.from({ length: 6 }, (_, index) => ({ url: APP.replace(/app\.[^.]+/, 'app.' + String(index).padStart(40, '0')) }));
  const result = bitbucketNativeReadPost(startupRequest('signature', { frames: [...unknown, { url: NEW_APP }, { url: 'chrome-extension://installed/PRIVATE_SCRIPT', functionName: 'PRIVATE_NAME' }] }));
  assert.equal(result.allowed, false);assert.equal(result.diagnostic.nativeAppPaths.length, 4);assert.equal(result.diagnostic.appPathsTruncated, true);
  assert.equal(result.diagnostic.auditedMatch, true);assert.equal(result.diagnostic.extensionPresent, true);assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});
for (const kind of ['signature', 'commit_status', 'run_eligibility']) test('audited native startup ' + kind + ' POST is classified as metadata read', () => {
  const value = bitbucketNativeReadPost(startupRequest(kind));assert.equal(value.allowed, true);assert.equal(value.code, `AUDITED_${kind.toUpperCase()}_READ`);
});
test('all four audited startup reads pass together without weakening mutation guards', async () => {
  const page = new EventEmitter(), progress = {}, abort = new AbortController();page.close = async () => {};
  const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);
  for (const request of [connectRequest(), ...['signature', 'commit_status', 'run_eligibility'].map(kind => startupRequest(kind))]) page.emit('request', request);
  assert.equal(progress.nativeReadPosts.length, 4);assert.equal(progress.providerWrites, 0);assert.equal(abort.signal.aborted, false);
  page.emit('request', startupRequest('run_eligibility', { url: STARTUP_PATHS.run_eligibility.replace('pipelines-config/run-eligibility', 'pipelines/'), body: JSON.stringify({ target: { type: 'pipeline_ref_target' } }) }));
  assert.equal(progress.providerWrites, 1);assert.equal(progress.blockedWrites[0].code, 'NATIVE_POST_PATH');assert.equal(abort.signal.aborted, true);await observer.dispose();
});
for (const kind of ['signature', 'commit_status', 'run_eligibility']) {
  for (const mutation of ['method', 'origin', 'workspace', 'query', 'initiator', 'headers', 'body']) test(`${kind} metadata exception rejects changed ${mutation}`, () => {
    const original = startupRequest(kind);let options = {};
    if (mutation === 'method') options.method = 'PUT';
    if (mutation === 'origin') options.url = STARTUP_PATHS[kind].replace('bitbucket.org', 'example.test');
    if (mutation === 'workspace') options.url = STARTUP_PATHS[kind].replace('atlassian', 'foreign').replace('02b941e3', '12b941e3');
    if (mutation === 'query') options.url = STARTUP_PATHS[kind] + (kind === 'commit_status' ? '&' : '?') + 'write=true';
    if (mutation === 'initiator') options.frames = [{ url: 'chrome-extension://installed/worker.js' }, { url: APP }];
    if (mutation === 'headers') options.headers = { ...original.headers(), 'x-bitbucket-frontend': 'unknown' };
    if (mutation === 'body') options.body = kind === 'run_eligibility' ? '{"run":true}' : kind === 'signature' ? '{"hashes":["PRIVATE_VALUE"],"write":true}' : 'commits=PRIVATE_VALUE&delete=true';
    assert.equal(bitbucketNativeReadPost(startupRequest(kind, options)).allowed, false);
  });
}
test('startup body diagnostics contain only known schema facts and bounded counts', async () => {
  for (const [kind, body, expected] of [
    ['run_eligibility', '{"PRIVATE_FIELD":"PRIVATE_VALUE"}', { bodyKind: 'object', keyCount: 1, emptyObject: false }],
    ['signature', '{"hashes":["PRIVATE_HASH"]}', { bodyKind: 'object', keyCount: 1, hashesArray: true, hashCount: 1, validHashCount: 0 }],
    ['commit_status', 'PRIVATE_FIELD=PRIVATE_HASH', { pairCount: 1, validHashCount: 0, hasOtherFields: true }],
  ]) {
    const page = new EventEmitter(), progress = {}, abort = new AbortController();page.close = async () => {};
    const observer = observeBitbucketWhitespace(page, progress, 'installed', abort);page.emit('request', startupRequest(kind, { body }));
    assert.equal(abort.signal.aborted, true);assert.deepEqual(progress.blockedWrites[0].diagnostic, expected);assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);await observer.dispose();
  }
});
test('commit status read supports both audited browser string and explicit form media types', () => {
  for (const type of ['text/plain;charset=UTF-8', 'application/x-www-form-urlencoded; charset=UTF-8']) {
    const headers = { ...startupRequest('commit_status').headers(), 'content-type': type };
    assert.equal(bitbucketNativeReadPost(startupRequest('commit_status', { headers })).allowed, true);
  }
});
test('bulk startup reads reject oversized or non-hash values while retaining empty-list source semantics', () => {
  assert.equal(bitbucketNativeReadPost(startupRequest('signature', { body: '{"hashes":[]}' })).allowed, true);
  assert.equal(bitbucketNativeReadPost(startupRequest('commit_status', { body: '' })).allowed, true);
  assert.equal(bitbucketNativeReadPost(startupRequest('signature', { body: JSON.stringify({ hashes: Array(101).fill(H) }) })).allowed, false);
  assert.equal(bitbucketNativeReadPost(startupRequest('commit_status', { body: Array(101).fill(`commits=${H}`).join('&') })).allowed, false);
  assert.equal(bitbucketNativeReadPost(startupRequest('signature', { body: '{"hashes":[7]}' })).allowed, false);
});

test('a never-settling response body fails in five seconds, checkpoints and cannot be adopted late', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new EventEmitter(), progress = {}, checkpoints = [], observer = observeBitbucketWhitespace(page, progress, 'installed', new AbortController(), { checkpoint: async code => { checkpoints.push(code); } });
  const request = { url: () => API + 'pullrequests/22', method: () => 'GET', redirectChain: () => [], initiator: () => ({ stack: { callFrames: [{ url: APP }] } }) };
  let resolveBody;const body = new Promise(resolve => { resolveBody = resolve; });
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200, headers: () => ({}), buffer: () => body });
  const flushed = observer.flush();t.mock.timers.tick(5000);await flushed;
  assert.equal(progress.requests[0].error, 'RESPONSE_BUFFER_TIMEOUT');assert.equal(progress.requests[0].qualified, undefined);assert.deepEqual(checkpoints, ['response_failure']);assert.equal(observer.idle().pending, 0);
  resolveBody(Buffer.from(JSON.stringify({ id: 22 })));await Promise.resolve();await Promise.resolve();
  assert.equal(progress.requests[0].error, 'RESPONSE_BUFFER_TIMEOUT');assert.equal(progress.requests[0].bytes, undefined);assert.equal(progress.requests[0].qualified, undefined);await observer.dispose();
});
test('observer disposal is bounded and never qualifies a released response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new EventEmitter(), progress = {}, observer = observeBitbucketWhitespace(page, progress, 'installed', new AbortController());
  const request = { url: () => API + 'pullrequests/22', method: () => 'GET', redirectChain: () => [] };let resolveBody;
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200, headers: () => ({}), buffer: () => new Promise(resolve => { resolveBody = resolve; }) });
  await Promise.resolve();const disposed = observer.dispose();resolveBody(Buffer.from('{}'));await disposed;
  assert.equal(progress.released, true);assert.equal(progress.requests[0].qualified, undefined);assert.equal(progress.requests[0].error, 'RESPONSE_RELEASED');
});
test('bounded local operation handles hung promises and abort without exposing external errors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = bitbucketWhitespaceAwait(() => new Promise(() => {}), { ms: 25, code: 'UNIT_WAIT_TIMEOUT' });
  t.mock.timers.tick(25);await assert.rejects(waiting, { code: 'UNIT_WAIT_TIMEOUT' });
  const abort = new AbortController();let executed = false;abort.abort(Error('PRIVATE_REASON'));
  await assert.rejects(bitbucketWhitespaceAwait(() => { executed = true; }, { signal: abort.signal }), { code: 'WHITESPACE_CASE_ABORTED' });assert.equal(executed, false);
});
test('phase checkpoints precede native input and settings writes and record completed cleanup', async () => {
  const events = [];const p = protocol({ checkpoint: async stage => { events.push({ stage, calls: [...p.calls] }); } });await p.run();
  assert.deepEqual(events.map(value => value.stage), ['baseline', 'baseline_settings', 'activation', 'hidden_responses', 'settings_restore', 'final', 'cleanup', 'complete']);
  assert.deepEqual(events[1].calls, []);assert.deepEqual(events[2].calls, ['opener', 'cancel']);
  assert.equal(events[3].calls.includes('settings:true'), true);
  assert.deepEqual(events.at(-1).calls.slice(-2), ['closed', 'restored']);
});

test('timed-out settings write must settle before exact raw restoration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value = { present: false }, releaseWrite, began = false;
  const pending = new Promise(resolve => { releaseWrite = resolve; });
  const scope = settingsScope({ progress: {}, read: async () => structuredClone(value), write: async next => { if (next.value?.hideWhitespace === true) { began = true;await pending; }value = structuredClone(next); } });
  await scope.prepare();const hidden = assert.rejects(scope.hide(true), { code: 'SETTINGS_WRITE_TIMEOUT' });
  for (let n = 0; n < 20 && !began; n++) await Promise.resolve();assert.equal(began, true);
  t.mock.timers.tick(5000);await hidden;
  let restored = false;const restoration = scope.restore(true).then(() => { restored = true; });await Promise.resolve();assert.equal(restored, false);
  releaseWrite();await restoration;assert.deepEqual(value, { present: false });
});
test('a settings write that never settles leaves restoration explicitly unconfirmed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value = { present: false }, began = false;const progress = {};
  const scope = settingsScope({ progress, read: async () => structuredClone(value), write: async next => { if (next.value?.hideWhitespace === true) { began = true;return new Promise(() => {}); }value = structuredClone(next); } });
  await scope.prepare();const hidden = assert.rejects(scope.hide(true), { code: 'SETTINGS_WRITE_TIMEOUT' });
  for (let n = 0; n < 20 && !began; n++) await Promise.resolve();t.mock.timers.tick(5000);await hidden;
  const restoration = assert.rejects(scope.restore(true), { code: 'SETTINGS_PENDING_TIMEOUT' });t.mock.timers.tick(5000);await restoration;
  assert.notEqual(progress.restored, true);assert.equal(value.present, true);assert.equal(value.value.hideWhitespace, false);
});

test('an abort before the queued operation starts prevents that operation', async () => {
  const abort = new AbortController();let called = false;
  const waiting = bitbucketWhitespaceAwait(() => { called = true; }, { signal: abort.signal });abort.abort(Error('PRIVATE_REASON'));
  await assert.rejects(waiting, { code: 'WHITESPACE_CASE_ABORTED' });assert.equal(called, false);
});

test('failed final checkpoint cannot leave the verifier marked passed', async () => {
  const p = protocol({ checkpoint: async stage => { if (stage === 'complete') throw Error('PRIVATE_CHECKPOINT_FAILURE'); } });
  await assert.rejects(p.run(), { code: 'CHECKPOINT_TIMEOUT' });assert.equal(p.progress.status, 'failed');assert.equal(p.progress.failure, 'CHECKPOINT_TIMEOUT');assert.equal(p.progress.cleanup.failures.includes('CHECKPOINT_TIMEOUT'), true);assert.equal(JSON.stringify(p.progress).includes('PRIVATE_'), false);
});

test('actual checkpoint reports remain running until cleanup completes', async () => {
  const { readFileSync } = await import('node:fs');const vm = await import('node:vm');
  const source = readFileSync(new globalThis.URL('./browser-e2e.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('let reportWrite;'), source.indexOf('function sourceFailureProvider('));
  const item = { name: 'bitbucket-whitespace-session', status: 'passed', inProgress: true };
  const report = { cases: [item], infrastructureErrors: [] };const snapshots = [];
  const save = vm.runInNewContext(`${code};saveReport`, { report, cooldowns: new Map(), bitbucketRequestTimes: [], focus: item.name, artifacts: '/artifacts', resolve: (...parts) => parts.join('/'), writeFile: async (_path, raw) => snapshots.push(JSON.parse(raw)) });
  await save();assert.equal(snapshots[0].status, 'running');assert.equal(snapshots[0].finishedAt, undefined);
  item.inProgress = false;await save();assert.equal(snapshots[1].status, 'completed_with_unsupported_features');assert.equal(typeof snapshots[1].finishedAt, 'string');
});

test('timed-out checkpoint callers cannot release the actual report-write queue or overtake the final save', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { readFileSync } = await import('node:fs');const vm = await import('node:vm');
  const source = readFileSync(new globalThis.URL('./browser-e2e.mjs', import.meta.url), 'utf8');
  const saveCode = source.slice(source.indexOf('let reportWrite;'), source.indexOf('function sourceFailureProvider('));
  const start = source.indexOf('  const checkpoint = async stage => {', source.indexOf('async function runBitbucketWhitespaceCase()'));
  const checkpointCode = source.slice(start, source.indexOf('  const active = ', start));
  const item = { name: 'bitbucket-whitespace-session', status: 'running', inProgress: true };
  const report = { cases: [item], infrastructureErrors: [] }, writes = [];
  let release, started, active = 0, maxActive = 0, persisted;
  const pending = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
  const { save, checkpoint } = vm.runInNewContext(`${saveCode}
${checkpointCode}
({ save: saveReport, checkpoint })`, {
    item, report, cooldowns: new Map(), bitbucketRequestTimes: [], focus: item.name, artifacts: '/artifacts',
    resolve: (...parts) => parts.join('/'), wait: (operation, code, ms) => bitbucketWhitespaceAwait(operation, { code, ms }),
    writeFile: async (_path, raw) => {
      const snapshot = JSON.parse(raw);writes.push(snapshot);active++;maxActive = Math.max(active, maxActive);
      if (writes.length === 1) { started();await pending; }
      persisted = snapshot;active--;
    },
  });
  const first = assert.rejects(checkpoint('progress'), { code: 'CHECKPOINT_TIMEOUT' });await began;
  t.mock.timers.tick(5000);await first;
  item.inProgress = false;item.status = 'passed';
  const finalCheckpoint = assert.rejects(checkpoint('complete'), { code: 'CHECKPOINT_TIMEOUT' });
  for (let n = 0; n < 5; n++) await Promise.resolve();
  t.mock.timers.tick(5000);await finalCheckpoint;
  const finalSave = save(); // The top-level final save must use the same underlying queue.
  for (let n = 0; n < 5; n++) await Promise.resolve();
  assert.equal(writes.length, 1);assert.equal(active, 1);
  release();await finalSave;
  assert.equal(writes.length, 3);assert.equal(maxActive, 1);
  assert.equal(writes[0].status, 'running');
  assert.equal(writes[1].status, 'completed_with_unsupported_features');
  assert.equal(persisted.status, 'completed_with_unsupported_features');
  assert.equal(persisted.cases[0].inProgress, false);assert.equal(typeof persisted.finishedAt, 'string');
});

test('whitespace step deadline leaves the job time to upload checkpoint evidence', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync(new globalThis.URL('../../../.github/workflows/browser-e2e.yml', import.meta.url), 'utf8');
  assert.match(workflow, /timeout-minutes: \$\{\{ needs\.select-public-verification\.outputs\.focus == 'bitbucket-whitespace-session' && 5 \|\| 15 \}\}/);
});

async function installedLifecycle(context) {
  const { readFileSync } = await import('node:fs');const vm = await import('node:vm');
  const code = readFileSync(new globalThis.URL('./browser-e2e.mjs', import.meta.url), 'utf8');
  const start = code.indexOf('async function prepareInstalledBrowserSettings()'), end = code.indexOf('\nasync function patchSettings(', start);
  assert.ok(start >= 0 && end > start);
  return new vm.Script(code.slice(start, end) + ';({prepare:prepareInstalledBrowserSettings,close:closeInstalledBrowser})').runInNewContext({ bitbucketWhitespaceAwait, errorText: error => error.message, ...context });
}

test('only whitespace skips the redundant global settings write and checkpoints installation', async () => {
  for (const focus of ['bitbucket-whitespace-session', 'github']) {
    const report = { infrastructureErrors: [] };let patched = 0, saved = 0;
    const lifecycle = await installedLifecycle({ focus, report, patchSettings: async () => { patched++;return { enabled: true }; }, saveReport: async () => { saved++; } });
    await lifecycle.prepare();assert.equal(patched, focus === 'github' ? 1 : 0);assert.equal(saved, focus === 'github' ? 0 : 1);
    if (focus === 'bitbucket-whitespace-session') { assert.equal(report.startup.stage, 'installed');assert.equal(report.startup.settingsPreparation, 'dedicated_bounded_case'); }
    else assert.deepEqual(report.settings, { enabled: true });
  }
});
test('whitespace saves before a hung browser close and terminates only its owned process', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [], snapshots = [], report = { infrastructureErrors: [] }, owned = new EventEmitter();
  Object.assign(owned, { pid: 321, exitCode: null, signalCode: null, kill(signal) { events.push(signal);this.signalCode = signal;this.emit('exit');return true; } });
  const lifecycle = await installedLifecycle({ focus: 'bitbucket-whitespace-session', report,
    saveReport: async () => { events.push('save:' + report.whitespaceBrowserTeardown.stage);snapshots.push(structuredClone(report)); },
    browser: { process: () => owned, close: () => { events.push('close');return new Promise(() => {}); }, disconnect: async () => { events.push('disconnect'); } },
  });
  const closing = lifecycle.close();for (let n = 0; n < 30 && !events.includes('close'); n++) await Promise.resolve();assert.deepEqual(events.slice(0, 2), ['save:before_close', 'close']);
  t.mock.timers.tick(5000);await closing;
  assert.deepEqual(events, ['save:before_close', 'close', 'disconnect', 'SIGTERM', 'save:after_close']);
  assert.equal(report.infrastructureErrors[0], 'WHITESPACE_BROWSER_CLOSE_TIMEOUT');assert.equal(report.whitespaceBrowserTeardown.ownedProcessExited, true);
  assert.equal(snapshots[0].whitespaceBrowserTeardown.stage, 'before_close');assert.equal(snapshots.at(-1).whitespaceBrowserTeardown.stage, 'after_close');
});
test('whitespace escalates only the returned owned process after a failed graceful exit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [], report = { infrastructureErrors: [] }, owned = new EventEmitter();
  Object.assign(owned, { pid: 321, exitCode: null, signalCode: null, kill(signal) { signals.push(signal);if (signal === 'SIGKILL') { this.signalCode = signal;this.emit('exit'); }return true; } });
  let closeStarted = false;
  const lifecycle = await installedLifecycle({ focus: 'bitbucket-whitespace-session', report, saveReport: async () => {}, browser: { process: () => owned, close: () => { closeStarted = true;return new Promise(() => {}); }, disconnect: async () => {} } });
  const closing = lifecycle.close();for (let n = 0; n < 30 && !closeStarted; n++) await Promise.resolve();t.mock.timers.tick(5000);
  for (let n = 0; n < 50 && signals.length === 0; n++) await Promise.resolve();assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(1000);await closing;assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);assert.equal(report.whitespaceBrowserTeardown.ownedProcessExited, true);
});
test('other focuses retain their existing close-then-save behavior without forced process teardown', async () => {
  const report = { infrastructureErrors: [] }, events = [];let finish;
  const lifecycle = await installedLifecycle({ focus: 'github', report, saveReport: async () => { events.push('save'); }, browser: { close: () => { events.push('close');return new Promise(resolve => { finish = resolve; }); }, process: () => { assert.fail('Unrelated focus inspected an owned process'); } } });
  const closing = lifecycle.close();for (let n = 0; n < 5; n++) await Promise.resolve();assert.deepEqual(events, ['close']);finish();await closing;
  assert.deepEqual(events, ['close', 'save']);assert.equal(report.whitespaceBrowserTeardown, undefined);
});
