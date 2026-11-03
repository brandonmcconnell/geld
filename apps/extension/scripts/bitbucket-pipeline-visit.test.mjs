import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { EventEmitter } from 'node:events';
import { assertBitbucketPipelineURL, BITBUCKET_PIPELINE_REVIEW as REVIEW, pipelineBudgetPreflight, pipelineSettingsScope, bitbucketPipelineAssetMetadata, bitbucketPipelineVisitProbe as visit, prepareBitbucketPipelineVisit } from './bitbucket-pipeline-visit.mjs';
import { bitbucketShellProbe, observeBitbucketShellFixture, verifyBitbucketShell } from './bitbucket-shell-acceptance.mjs';
import { bitbucketSyntaxSettingsProbe } from './bitbucket-syntax-settings.mjs';
const SELECTED = REVIEW + '#chg-bitbucket-pipelines.yml';

for (const url of [REVIEW, SELECTED, REVIEW + '#chg-pipe%2Fpipe.py']) test(`same review qualifies without rewriting native selection: ${url}`, () => assert.equal(assertBitbucketPipelineURL(url), url));
for (const url of [REVIEW.replace('https:', 'http:'), REVIEW.replace('bitbucket.org', 'example.org'), REVIEW.replace('/27/', '/28/'), REVIEW + '?context=8', REVIEW.replace('https://', 'https://user:secret@'), REVIEW + '/']) test(`different subject/search/credentials rejected: ${url}`, () => assert.throws(() => assertBitbucketPipelineURL(url)));
test('an exact pinned native fragment cannot drift', () => { assert.equal(assertBitbucketPipelineURL(SELECTED, SELECTED), SELECTED);assert.throws(() => assertBitbucketPipelineURL(REVIEW, SELECTED), /Pinned/);assert.throws(() => assertBitbucketPipelineURL(REVIEW + '#chg-pipe%2Fpipe.py', SELECTED), /Pinned/); });
test('fourteen free cannot fund the measured focused navigation plus reserve', () => { const value = pipelineBudgetPreflight(26, 40);assert.equal(value.remaining, 14);assert.equal(value.available, false);assert.equal(value.allowance, 16);assert.equal(value.minimumFree, 5); });
test('preflight admits24 free using measured16 plus five, retaining40 cap', () => { assert.equal(pipelineBudgetPreflight(0, 40).available, true);assert.equal(pipelineBudgetPreflight(19, 40).available, true);assert.equal(pipelineBudgetPreflight(20, 40).available, false);assert.equal(pipelineBudgetPreflight(16, 40).available, true);assert.match(pipelineBudgetPreflight(16, 40).basis, /Consent, Settings and later selection costs remain unmeasured/);assert.throws(() => pipelineBudgetPreflight(0, 60)); });

for (const original of [undefined, {}, { enabled: true, prOverview: true, quickReview: true, categoryPatterns: { tests: ['*.test.ts'] }, futureSetting: { empty: [] } }, { quickReview: false }]) test(`settings scope restores raw presence and all unrelated values: ${JSON.stringify(original)}`, async () => {
 let value = structuredClone(original);const writes = [];const progress = {};
 const scope = pipelineSettingsScope({ progress, readSettings: async () => structuredClone(value), writeSettings: async (next) => { writes.push(structuredClone(next));value = structuredClone(next); } });
 await scope.prepare();assert.equal(value.prOverview, false);assert.equal(value.quickReview, false);
 assert.deepEqual(Object.fromEntries(Object.entries(value).filter(([key]) => !['prOverview', 'quickReview'].includes(key))), Object.fromEntries(Object.entries(original ?? {}).filter(([key]) => !['prOverview', 'quickReview'].includes(key))));
 await scope.restore(true);assert.deepEqual(value, original);assert.equal(progress.restoration, 'restored');assert.equal(writes.length, 2);
});
test('settings never restore while native page remains open', async () => { let value = {};let writes = 0;const progress = {};const scope = pipelineSettingsScope({ progress, readSettings: async () => value, writeSettings: async (next) => { value = next;writes++; } });await scope.prepare();await assert.rejects(scope.restore(false), /Close the pipeline page/);assert.equal(writes, 1);assert.equal(progress.restoration, 'failed'); });
test('unexpected unrelated settings changes fail rather than get overwritten', async () => { let value = { future: 1 };let writes = 0;const scope = pipelineSettingsScope({ progress: {}, readSettings: async () => value, writeSettings: async (next) => { value = next;writes++; } });await scope.prepare();value.future = 2;await assert.rejects(scope.restore(true), /do not overwrite/);assert.equal(value.future, 2);assert.equal(writes, 1); });
test('readback corruption is a failed scoped preparation', async () => { const scope = pipelineSettingsScope({ progress: {}, readSettings: async () => ({ enabled: false }), writeSettings: async () => {} });await assert.rejects(scope.prepare(), /Only scoped review flags/); });

let window;const originals = new Map();
beforeEach(() => {
 window = new Window({ url: REVIEW + '#chg-pipe%2Fpipe.py' });
 for (const key of ['document', 'location', 'Element', 'Node', 'Text', 'NodeFilter', 'MutationObserver', 'CSS', 'getComputedStyle', 'getSelection']) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));Object.defineProperty(globalThis, key, { configurable: true, value: ['getComputedStyle', 'getSelection'].includes(key) ? window[key].bind(window) : window[key] }); }
});
afterEach(() => { visit('cleanup');bitbucketShellProbe('cleanup');bitbucketSyntaxSettingsProbe('cleanup');for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor);else delete globalThis[key]; }window.happyDOM.abort(); });
function fixture() {
 document.body.innerHTML = '<div id="file-tree"><ul role="list"><li><a href="#chg-bitbucket-pipelines.yml">bitbucket-pipelines.yml</a></li></ul></div><div><div id="chg-bitbucket-pipelines.yml"></div><article data-qa="branch-diff-file"><h2 data-qa="bk-filepath">bitbucket-pipelines.yml</h2><div data-qa="code-line"><span data-key="code-line-number" data-old-line-number="1" data-new-line-number="1"></span><span data-line-type=" ">image:</span></div></article></div>';
 return document.querySelector('#file-tree a');
}
test('native Pipeline selection retains original link/source and actual selected URL', () => { const link = fixture();const html = link.outerHTML;assert.equal(visit().selected, false);location.hash = '#chg-bitbucket-pipelines.yml';const pin = visit('pin');assert.equal(pin.url, SELECTED);assert.equal(pin.pinned, SELECTED);assert.equal(pin.sameSource, true);assert.equal(link.outerHTML, html);assert.equal(visit().pinned, SELECTED); });
test('synthetic clicks remain explicitly untrusted', () => { const link = fixture();visit('arm');link.click();assert.equal(visit('click-result').trusted, false); });
test('a genuine-looking duplicate native link is ambiguous, owned clone is excluded', () => { const link = fixture();const clone = link.cloneNode(true);link.after(clone);assert.equal(visit(), null);clone.dataset.geldUi = '';assert.equal(visit().sameSource, true); });
test('source remount or a later fragment change invalidates pinned visit', () => { const link = fixture();location.hash = '#chg-bitbucket-pipelines.yml';visit('pin');location.hash = '#chg-pipe%2Fpipe.py';assert.equal(visit(), null);location.hash = '#chg-bitbucket-pipelines.yml';link.replaceWith(link.cloneNode(true));assert.equal(visit(), null); });
test('another review or search state cannot prepare native Pipeline selection', () => { fixture();location.href = REVIEW.replace('/27/', '/28/');assert.equal(visit(), null);location.href = REVIEW + '?context=8';assert.equal(visit(), null); });
test('shell source probe accepts actual Pipeline fragment then refuses later URL drift', () => { fixture();location.hash = '#chg-bitbucket-pipelines.yml';assert.equal(bitbucketShellProbe().url, SELECTED);location.hash = '#chg-pipe%2Fpipe.py';assert.equal(bitbucketShellProbe(), null); });
test('native Settings source setup binds the expected selected URL', () => { fixture();location.hash = '#chg-bitbucket-pipelines.yml';assert.equal(bitbucketSyntaxSettingsProbe('setup', SELECTED).sameSource, true);location.hash = '#chg-pipe%2Fpipe.py';assert.equal(bitbucketSyntaxSettingsProbe().sameSource, false); });
test('native Settings setup refuses a different expected URL before storing evidence', () => { fixture();location.hash = '#chg-bitbucket-pipelines.yml';assert.equal(bitbucketSyntaxSettingsProbe('setup', REVIEW), null);assert.equal(bitbucketSyntaxSettingsProbe(), null); });

const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const runCaseBody = harness.slice(harness.indexOf('async function runCase('), harness.indexOf('\nasync function runBitbucketWhitespaceCase('));
function runner({ focus = 'bitbucket-pipeline-shell', active = 0, closeFailure = false, restoreFailure = false, bodyFailure = false, assetCleanupFailure = false } = {}) {
 const order = [];let value = { enabled: true, future: { retained: true } };const original = structuredClone(value);let closed = false;const report = { cases: [], infrastructureErrors: [], quotaPolicy: { conservativeObservedRequestBudget: 40 } };
 const page = { setViewport: async () => {}, bringToFront: async () => {}, on: () => {}, once: () => {}, url: () => SELECTED, isClosed: () => closed, goto: async () => { order.push('navigate');assert.equal(value.prOverview, false);assert.equal(value.quickReview, false);assert.ok(order.includes('asset-observe'));return { status: () => 200 }; }, close: async () => { order.push('close');if (closeFailure) throw Error('Synthetic close failure');closed = true; } };
 const context = { bitbucketBudgetHold: vm.runInNewContext('(' + harness.slice(harness.indexOf('function bitbucketBudgetHold('), harness.indexOf('async function inheritCooldowns(')) + ')'), assert, report, focus, FOCUSED_CASES: { 'bitbucket-pipeline-shell': ['bitbucket-pipeline-shell'] }, AbortController, structuredClone,
  providerOf: () => 'bitbucket', cooldowns: new Map(), bitbucketRequestTimes: Array(active).fill(Date.now()), currentCaseAbort: undefined, SETTINGS_KEY: 'settings', extensionId: 'synthetic-extension',
  pipelineBudgetPreflight, pipelineSettingsScope, observeBitbucketPipelineMainAsset: () => { order.push('asset-observe');return { dispose: async () => { order.push('asset-dispose');if (assetCleanupFailure) throw Error('Synthetic asset cleanup failure'); } }; }, closedTarget: () => false, observeBitbucketBudget: () => () => {}, observeBitbucketShellFixture: () => { order.push('observe'); },
  options: { evaluate: async (fn, key, saved) => { if (String(fn).includes('chrome.storage.sync.get')) return structuredClone(value);if (closed && restoreFailure) throw Error('Synthetic restoration failure');order.push(closed ? 'restore' : 'scope');value = structuredClone(saved); } },
  browser: { newPage: async () => { order.push('create');assert.equal(value.prOverview, false);assert.equal(value.quickReview, false);return page; } },
  capture: async (target, name, config) => { order.push(['capture', name, config.fullPage]);return {}; }, authObservation: async () => ({ signedIn: false }),
  safeUrl: (url) => url, errorText: (error) => error.message, saveReport: async () => { order.push('save'); }, console: { log() {} },
 };
 const run = new vm.Script(`(${runCaseBody})`).runInNewContext(context);
 return { run: () => run('bitbucket-pipeline-shell', REVIEW, async () => { order.push('body');if (bodyFailure) throw Error('Synthetic body failure');return { status: 'passed' }; }), report, order, original, current: () => value };
}
test('actual runner scopes before page creation and restores exact raw settings only after close', async () => { const r = runner();await r.run();assert.equal(r.report.cases[0].status, 'passed');assert.deepEqual(r.current(), r.original);assert.ok(r.order.indexOf('scope') < r.order.indexOf('create'));assert.ok(r.order.indexOf('asset-dispose') < r.order.indexOf('close'));assert.ok(r.order.indexOf('close') < r.order.indexOf('restore'));assert.deepEqual(r.order.find(Array.isArray), ['capture', 'bitbucket-pipeline-shell', false]); });
test('optional asset cleanup rejection cannot bypass actual page close and exact settings restoration', async () => { const r = runner({ assetCleanupFailure: true });await r.run();assert.deepEqual(r.current(), r.original);assert.ok(r.order.indexOf('asset-dispose') < r.order.indexOf('close'));assert.ok(r.order.indexOf('close') < r.order.indexOf('restore'));assert.equal(r.report.cases[0].nativeMainAsset.status, 'unavailable');assert.match(r.report.cases[0].nativeMainAsset.cleanup.error, /asset cleanup failure/); });
for (const focus of ['all', 'regression', 'github']) test(`actual runner excludes pipeline navigation from ${focus}`, async () => { const r = runner({ focus });await r.run();assert.equal(r.report.cases[0].status, 'not_selected');assert.deepEqual(r.order, ['save']); });
test('actual runner holds14 free before settings/page creation', async () => { const r = runner({ active: 26 });await r.run();assert.equal(r.report.cases[0].status, 'failed');assert.equal(r.report.cases[0].navigationSuppressedByBudget, true);assert.deepEqual(r.order, ['save']); });
test('actual runner uses viewport artifacts and restores after failed verification', async () => { const r = runner({ bodyFailure: true });await r.run();assert.equal(r.report.cases[0].status, 'failed');assert.deepEqual(r.current(), r.original);assert.deepEqual(r.order.find(Array.isArray), ['capture', 'bitbucket-pipeline-shell-failed', false]); });
test('actual runner retains cleanup failure rather than restoring while native page remains open', async () => { const r = runner({ closeFailure: true });await r.run();assert.equal(r.report.cases[0].status, 'failed');assert.equal(r.current().prOverview, false);assert.equal(r.current().quickReview, false);assert.equal(r.order.includes('restore'), false);assert.equal(r.report.infrastructureErrors.length, 1);assert.equal(r.report.cases[0].pipelineSettings.restoration, 'failed'); });
test('actual runner records restoration rejection and saves the failed case', async () => { const r = runner({ restoreFailure: true });await r.run();assert.equal(r.report.cases[0].status, 'failed');assert.match(r.report.cases[0].cleanupError, /restoration failure/);assert.equal(r.report.infrastructureErrors.length, 1);assert.equal(r.order.at(-1), 'save'); });


test('native Pipeline preparation refuses synthetic input before pinning or advancing', async () => {
 const link = fixture();const progress = {};let polls = 0;
 const page = { url: () => location.href, evaluate: async (fn, ...args) => fn(...args), evaluateHandle: async (fn, ...args) => { const target = fn(...args);assert.equal(target, link);return { asElement: () => ({ click: async () => target.click() }), dispose: async () => {} }; } };
 await assert.rejects(prepareBitbucketPipelineVisit(page, { progress, poll: async () => { polls++; }, guardBudget: () => ({ remaining: 14 }), assertHead: () => {} }), /strictly equal/);
 assert.equal(progress.input.trusted, false);assert.equal(polls, 0);assert.equal(visit().pinned, null);
});

test('native Pipeline preparation stops stale source identity before a click', async () => {
 const link = fixture();let clicks = 0;link.addEventListener('click', () => clicks++);
 const page = { url: () => location.href, evaluate: async () => { throw Error('Source must stop before observation'); } };
 await assert.rejects(prepareBitbucketPipelineVisit(page, { progress: {}, guardBudget: () => ({}), assertHead: () => { throw Error('Stale immutable source'); } }), /Stale immutable source/);assert.equal(clicks, 0);
});

for (const [active, available] of [[35, true], [36, false]]) test(`actual context guard retains strict five-free minimum at${active} active`, () => {
 const body = /function guardBitbucketShellBudget\(\) \{[\s\S]*?\n\}/.exec(harness)?.[0];assert.ok(body);
 const guard = new vm.Script(`(${body})`).runInNewContext({ assert, currentCaseAbort: undefined, cooldowns: new Map(), bitbucketRequestTimes: Array(active).fill(Date.now()), report: { quotaPolicy: { conservativeObservedRequestBudget: 40 } } });
 if (available) assert.equal(guard().buffer, 4);else assert.throws(guard, /Insufficient carried rolling request buffer/);
});


for (const changed of ['budget', 'head']) test(`native preparation rechecks ${changed} after asynchronous handle acquisition and disposes without clicking`, async () => {
 fixture();let late = false;let clicks = 0;let disposed = 0;let guards = 0;
 const page = { url: () => location.href, evaluate: async (fn, ...args) => fn(...args), evaluateHandle: async (fn, ...args) => { const target = fn(...args);assert.ok(target);late = true;return { asElement: () => ({ click: async () => { clicks++;target.click(); } }), dispose: async () => { disposed++; } }; } };
 await assert.rejects(prepareBitbucketPipelineVisit(page, { progress: {}, poll: async () => { throw Error('Must not poll after a stale guard'); },
  guardBudget: () => { guards++;if (late && changed === 'budget') throw Error('Budget changed while awaiting native handle');return { remaining: 8 }; },
  assertHead: () => { if (late && changed === 'head') throw Error('Head changed while awaiting native handle'); },
 }), changed === 'budget' ? /Budget changed/ : /Head changed/);
 assert.equal(clicks, 0);assert.equal(disposed, 1);assert.equal(guards, 2);assert.equal(visit('click-result'), null);
});

for (const cleanupThrows of [false, true]) test(`actual shell finally cleans an armed visit when preparation throws, shell cleanup throws=${cleanupThrows}`, async () => {
 fixture();const page = new EventEmitter();const item = {};const cleanups = [];const activeClicks = new Set();
 const add = document.addEventListener.bind(document);const remove = document.removeEventListener.bind(document);
 document.addEventListener = (name, callback, options) => { if (name === 'click') activeClicks.add(callback);return add(name, callback, options); };
 document.removeEventListener = (name, callback, options) => { if (name === 'click') activeClicks.delete(callback);return remove(name, callback, options); };
 page.url = () => location.href;page.isClosed = () => false;
 page.evaluate = async (fn, ...args) => { if (args[0] === 'cleanup') { cleanups.push(fn.name);if (cleanupThrows && fn === bitbucketShellProbe) throw Error('Synthetic shell probe cleanup failure'); }return fn(...args); };
 page.evaluateHandle = async () => { assert.equal(activeClicks.size, 1);throw Error('Synthetic native handle acquisition failure'); };
 observeBitbucketShellFixture(page, item, { safeUrl: (url) => url, extensionId: 'synthetic-extension' });
 const api = 'https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file';const head = 'a'.repeat(40);const base = 'b'.repeat(40);
 const response = (url, body) => page.emit('response', { url: () => url, request: () => ({ method: () => 'GET' }), status: () => 200, headers: () => ({}), json: async () => body });
 response(`${api}/pullrequests/27`, { id: 27, state: 'MERGED', source: { repository: { full_name: 'atlassian/bitbucket-upload-file' }, commit: { hash: head } }, destination: { repository: { full_name: 'atlassian/bitbucket-upload-file' }, commit: { hash: base } } });
 response(`${api}/diff/atlassian/bitbucket-upload-file:${head}%0D${base}?from_pullrequest_id=27&topic=true`, {});
 try {
  await assert.rejects(verifyBitbucketShell(page, item, { guardBudget: () => ({ remaining: 8 }) }), cleanupThrows ? /probe cleanup failed/ : /handle acquisition failure/);
  assert.deepEqual(cleanups, ['bitbucketShellProbe', 'bitbucketPipelineVisitProbe']);assert.equal(activeClicks.size, 0);assert.equal(globalThis.__geldBitbucketPipelineVisit, undefined);assert.equal(item.shellSyntax.status, 'failed');assert.equal(item.shellNativeSources.phase, 'after_shell_verification');
  if (cleanupThrows) assert.deepEqual(item.shellSyntax.cleanupErrors, ['Synthetic shell probe cleanup failure']);
 } finally { page.emit('close'); }
 assert.equal(page.listenerCount('request'), 0);assert.equal(page.listenerCount('response'), 0);
});

function assetMetadata(resources) {
 const read = new vm.Script(`(${bitbucketPipelineAssetMetadata.toString()})`).runInNewContext({ document, URL, performance: { getEntriesByType: (kind) => { assert.equal(kind, 'resource');return resources; } } });return read();
}
test('passive static metadata preserves only exact observed safe first-party script URLs without executing or requesting them', () => {
 const origin = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net';
 document.body.innerHTML = `<script src="${origin}/assets/main.12345678.js"></script><script src="${origin}/assets/query.js?session=secret"></script><script src="https://unknown.example/assets/other.js"></script><script src="https://user:secret@bitbucket.org/assets/credentials.js"></script><div data-geld-ui><script src="${origin}/assets/owned.js"></script></div>`;
 const html = document.body.innerHTML;const value = assetMetadata([{ name: `${origin}/assets/main.12345678.js`, initiatorType: 'script' }, { name: `${origin}/assets/runtime.12345678.js`, initiatorType: 'script' }, { name: `${origin}/assets/not-script.js`, initiatorType: 'fetch' }, { name: 'https://bitbucket.org/!api/2.0/repositories/repo/path', initiatorType: 'script' }]);
 assert.equal(value.records.length, 2);assert.equal(value.records[0].url, `${origin}/assets/main.12345678.js`);assert.equal(value.records[0].basis.length, 2);assert.equal(value.records[1].url, `${origin}/assets/runtime.12345678.js`);assert.equal(value.truncated, false);assert.equal(document.body.innerHTML, html);assert.doesNotMatch(JSON.stringify(value), /session|secret|unknown.example|owned.js|not-script.js|!api/);
});
test('passive static metadata bounds record count, source length and total retained characters', () => {
 const prefix = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/';
 const value = assetMetadata(Array.from({ length: 120 }, (_, index) => ({ name: `${prefix}chunk-${index}.js`, initiatorType: 'script' })));
 assert.equal(value.records.length, 100);assert.equal(value.truncated, true);
 const large = assetMetadata(Array.from({ length: 100 }, (_, index) => ({ name: `${prefix}${'a'.repeat(1800)}-${index}.js`, initiatorType: 'script' })));
 assert.ok(large.characters <= 60000 && large.records.length < 100);assert.equal(large.truncated, true);
 const unsafe = assetMetadata([{ name: `${prefix}${'a'.repeat(2100)}.js`, initiatorType: 'script' }, { name: `${prefix}normal.js#secret`, initiatorType: 'script' }]);assert.equal(unsafe.records.length, 0);
});
