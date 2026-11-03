import assert from 'node:assert/strict';
import test from 'node:test';
import { SHARED_SETTINGS_NATIVE_ORACLES, assertPatternOnlySettings, restoreCategoryPatterns, settingsRequestEvidence, sharedSettingsSourceIdentity, sharedSettingsSampleValid } from './three-provider-settings.mjs';

const original = { enabled: true, aiEnabled: false, autoViewed: {}, hideWhitespace: false, repoConfigs: 'never', categories: { tests: true }, categoryPatterns: {}, futureSetting: { preserved: true } };
const SHA = '9777bca47119a91758bde1209ac14e6076ffbf23';
const BB = { all: { files: 1, additions: 2, deletions: 0 }, visible: { files: 1, additions: 2, deletions: 0 }, hidden: 0, repo: 'atlassian/bitbucket-upload-file', sha: SHA };
const oracles = { ...Object.fromEntries(Object.entries(SHARED_SETTINGS_NATIVE_ORACLES).map(([provider, value]) => [provider, { ...value, repo: provider === 'gitlab' ? 'gitlab-org/gitlab' : 'wxt-dev/wxt' }])), bitbucket: BB };
function sample(provider, mode = 'baseline') {
  const oracle = oracles[provider]; const all = mode === 'all'; const totals = all ? { files: 0, additions: 0, deletions: 0 } : oracle.visible;
  // Offline protocol fixtures use actual retained totals/marker conventions; they are not a rendered/native browser proof.
  return { state: { repo: oracle.repo, ...(provider === 'github' ? {} : { repository: { provider, origin: provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org', path: oracle.repo } }), allowed: true, hasDiff: true, onDiffPage: true, all: oracle.all, visible: totals, hiddenCount: all ? oracle.all.files : oracle.hidden, expanded: all, categories: all ? [{ id: 'tests', count: oracle.all.files }] : [] },
    dom: { provider, url: `https://${provider === 'bitbucket' ? 'bitbucket.org' : provider + '.com'}/${oracle.repo}`, hidden: false, headerIdentity: { id: 'native-header' }, nativeLinks: ['/original/source'], nativeCheckboxes: [{ id: 'viewed', name: 'viewed', checked: false }],
      headers: provider === 'bitbucket' ? [{ files: totals.files }, { files: totals.files }] : [{ ...totals }],
      files: Array.from({ length: oracle.all.files }, (_, index) => ({ id: `native-${index}`, path: `file${index}`, head: provider === 'gitlab' ? SHA : null, hidden: all ? provider === 'github' ? 'hidden' : 'open' : null, display: 'block' })),
      groups: all ? [{ expanded: true, toggleExpanded: 'true', toggleLabel: 'Hide tests', ...(provider === 'github' ? { sectionExpanded: 'true' } : {}) }] : [] },
    ...(provider === 'bitbucket' ? { source: { status: 'ready', sha: SHA, totals: BB.all } } : {}) };
}

test('retained GL/GH oracles stay independent from extension state and preserve exact fixture totals', () => {
  assert.deepEqual(SHARED_SETTINGS_NATIVE_ORACLES.gitlab.all, { files: 3, additions: 36, deletions: 0 });
  assert.deepEqual(SHARED_SETTINGS_NATIVE_ORACLES.github.all, { files: 18, additions: 93, deletions: 53 });
  assert.equal(SHARED_SETTINGS_NATIVE_ORACLES.github.evidenceRun, '41348268807');
});
for (const provider of ['gitlab', 'github', 'bitbucket']) test(`${provider} accepts the default/zero/restored count contract and rejects fake semantic/native zero`, () => {
  for (const mode of ['baseline', 'all', 'restored']) assert.equal(sharedSettingsSampleValid(provider, sample(provider, mode), oracles[provider], mode), true);
  const wrongNative = sample(provider, 'all'); wrongNative.dom.headers[0].files = 1;
  assert.equal(sharedSettingsSampleValid(provider, wrongNative, oracles[provider], 'all'), false);
  const wrongAll = sample(provider, 'all'); wrongAll.state.all = { files: 0, additions: 0, deletions: 0 };
  assert.equal(sharedSettingsSampleValid(provider, wrongAll, oracles[provider], 'all'), false);
  const wrongLines = sample(provider, 'all'); wrongLines.state.visible.additions = 1;
  assert.equal(sharedSettingsSampleValid(provider, wrongLines, oracles[provider], 'all'), false);
  const lostFile = sample(provider, 'all'); lostFile.dom.files.pop();
  assert.equal(sharedSettingsSampleValid(provider, lostFile, oracles[provider], 'all'), false);
  const closed = sample(provider, 'all'); closed.state.expanded = false;
  assert.equal(sharedSettingsSampleValid(provider, closed, oracles[provider], 'all'), false);
});

test('Bitbucket requires both native counters, actual complete pinned SHA and visible original all-hidden source', () => {
  for (const edit of [
    (value) => { value.source.sha = 'f'.repeat(40); },
    (value) => { value.source.status = 'unavailable'; },
    (value) => { value.dom.headers.pop(); },
    (value) => { value.dom.files[0].display = 'none'; },
    (value) => { value.state.repository.origin = 'https://other.example'; },
  ]) { const value = sample('bitbucket', 'all'); edit(value); assert.equal(sharedSettingsSampleValid('bitbucket', value, BB, 'all'), false); }
});

test('only categoryPatterns may change, including future settings, AI, Viewed and whitespace/source policy', () => {
  assert.doesNotThrow(() => assertPatternOnlySettings({ ...original, categoryPatterns: { tests: ['**/*'] } }, original));
  for (const changes of [{ enabled: false }, { aiEnabled: true }, { autoViewed: { tests: true } }, { hideWhitespace: true }, { repoConfigs: 'ask' }, { futureSetting: { preserved: false } }]) {
    assert.throws(() => assertPatternOnlySettings({ ...original, ...changes }, original), /other than categoryPatterns/);
  }
});

test('cleanup restores only exact pattern presence/value without overwriting unrelated latest fields', () => {
  const current = { ...original, categoryPatterns: { tests: ['**/*'] }, unrelatedConcurrentField: 42 };
  assert.deepEqual(restoreCategoryPatterns(current, original), { ...original, unrelatedConcurrentField: 42 });
  const absent = { enabled: true, aiEnabled: false, autoViewed: {} };
  const { categoryPatterns: _patterns, ...expectedAbsent } = current;
  assert.deepEqual(restoreCategoryPatterns(current, absent), expectedAbsent);
  assert.equal(Object.hasOwn(restoreCategoryPatterns(current, absent), 'categoryPatterns'), false);
});

test('source fingerprints allow classification changes but retain native IDs, head, owners, links and Viewed flags', () => {
  const baseline = sample('gitlab').dom; const allHidden = sample('gitlab', 'all').dom;
  assert.deepEqual(sharedSettingsSourceIdentity(allHidden), sharedSettingsSourceIdentity(baseline));
  for (const edit of [(dom) => { dom.files[0].id = 'different'; }, (dom) => { dom.files[0].head = 'f'.repeat(40); }, (dom) => { dom.nativeLinks.push('/changed'); }, (dom) => { dom.nativeCheckboxes[0].checked = true; }]) {
    const changed = structuredClone(baseline); edit(changed); assert.notDeepEqual(sharedSettingsSourceIdentity(changed), sharedSettingsSourceIdentity(baseline));
  }
});

const EXTENSION = 'abcdefghijklmnopabcdefghijklmnop';
const REQUEST_URL = 'https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/commit/9777bca47119?fields=hash%2Crepository.full_name';
test('nested actual extension initiator frames identify source demand without additional classification requests', () => {
  const request = settingsRequestEvidence({ url: REQUEST_URL, method: 'GET', initiator: { stack: { callFrames: [{ url: 'https://bitbucket.org/native.js' }], parent: { callFrames: [{ url: `chrome-extension://${EXTENSION}/content-scripts/bitbucket.js` }] } } } }, EXTENSION);
  assert.equal(request.extensionInitiator, true); assert.equal(request.signature, 'client-identity-projection');
  assert.equal(request.transport, 'native-same-origin');
});
test('native/unattributed traffic remains evidence even if its URL resembles an extension signature', () => {
  for (const initiator of [undefined, { stack: { callFrames: [{ url: 'https://bitbucket.org/native.js' }] } }, { stack: { callFrames: [{ url: `chrome-extension://wrong-id/content.js` }] } }]) {
    const request = settingsRequestEvidence({ url: REQUEST_URL, method: 'GET', initiator }, EXTENSION);
    assert.equal(request.extensionInitiator, false); assert.equal(request.attribution, 'native-or-unattributed'); assert.equal(request.signature, 'client-identity-projection');
  }
  assert.equal(settingsRequestEvidence({ url: 'https://example.com/!api/2.0/repositories/a/b/diff/abc', method: 'GET' }, EXTENSION), null);
});

// Execute only the real orchestration function with offline browser/storage protocol doubles.
// This never imports/runs the browser-launching harness and is not installed-provider evidence.
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const orchestration = harness.slice(harness.indexOf('async function verifyThreeSiteCommitSettings('), harness.indexOf('async function bitbucketCommitCounts('));
function flow({ failCapture = false, injectedRequest = null } = {}) {
  let settings = structuredClone(original); const writes = []; const pages = []; const abort = new AbortController();
  const GL = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123';
  const GH = 'https://github.com/wxt-dev/wxt/pull/2544/files';
  class Page extends EventEmitter {
    constructor(site, url) { super(); this.site = site; this.currentUrl = url; this.closed = false; this.id = pages.length + 1; pages.push(this); }
    url() { return this.currentUrl; }
    isClosed() { return this.closed; }
    async close() { this.closed = true; this.emit('close'); }
    async bringToFront() {}
    async setViewport() {}
    async goto(url) { this.currentUrl = url; this.site = url === GL ? 'gitlab' : 'github'; return { status: () => 200 }; }
    async evaluate() { return false; }
  }
  const bb = new Page('bitbucket', 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/9777bca47119');
  const chrome = { storage: { sync: { get: async () => ({ settings: structuredClone(settings) }), set: async ({ settings: next }) => { settings = structuredClone(next); writes.push(structuredClone(next)); } } }, tabs: { query: async () => pages.map((page) => ({ id: page.id, windowId: 1, url: page.url() })) } };
  const mode = () => settings.categoryPatterns?.tests?.[0] === '**/*' ? 'all' : 'baseline';
  const poll = async (read, accept, label) => { const value = await read(); assert.ok(accept(value), label); return value; };
  const dom = (page) => ({ ...sample(page.site, mode()).dom, url: page.url() });
  const source = { status: 'ready', sha: SHA, totals: BB.all, provenance: { metadata: ['already-observed'], diffstat: ['already-observed'] } };
  let injected = false;
  const deps = { assert, SHARED_SETTINGS_NATIVE_ORACLES, assertPatternOnlySettings, restoreCategoryPatterns, settingsRequestEvidence, sharedSettingsSourceIdentity, sharedSettingsSampleValid,
    observeBitbucketBudget: () => () => undefined,
    options: { evaluate: async (callback, ...args) => callback(...args) }, chrome, SETTINGS_KEY: 'settings', extensionId: EXTENSION, currentCaseAbort: abort,
    browser: { newPage: async () => new Page('unknown', 'about:blank') }, GL_MIXED: GL, GH_FILES: GH, cooldowns: new Map(), errorText: (error) => error.message,
    providerOf: (url) => url.startsWith('https://bitbucket.org') ? 'bitbucket' : url.startsWith('https://gitlab.com') ? 'gitlab' : url.startsWith('https://github.com') ? 'github' : null,
    safeUrl: (url) => url, quotaHeaders: () => ({}), retryAfter: () => 1000, closedTarget: () => false,
    tabState: async (page) => sample(page.site, mode()).state, threeSiteBitbucketDom: async (page) => dom(page), crossSettingsDom: async (page) => dom(page),
    authObservation: async () => ({ signedIn: false }), poll, pollStable: poll, WAIT_MS: 100,
    patchSettings: async (patch) => { await chrome.storage.sync.set({ settings: { ...settings, ...patch } }); },
    capture: async (_page, name) => {
      if (mode() === 'all' && !injected && injectedRequest !== null) {
        injected = true;
        bb.emit('request', { url: () => REQUEST_URL, method: () => 'GET', initiator: () => injectedRequest, postData: () => null });
      }
      if (failCapture && mode() === 'all') throw new Error('Offline screenshot failure');
      return { screenshot: `${name}.png` };
    },
  };
  const verify = new Function(...Object.keys(deps), `return (${orchestration});`)(...Object.values(deps));
  const item = {};
  return { run: () => verify(bb, item, source, { snapshot: () => structuredClone(source) }), item, pages, writes, bb, abort, settings: () => settings };
}

test('orchestration changes patterns only across three tabs and records unattributed native background traffic', async () => {
  const run = flow({ injectedRequest: { stack: { callFrames: [{ url: 'https://bitbucket.org/native.js' }] } } });
  await run.run();
  assert.deepEqual(run.settings(), original);
  assert.equal(run.item.threeSiteSettings.stages.length, 3);
  assert.ok(run.item.threeSiteSettings.stages.every((stage) => stage.tabs.length === 3));
  assert.equal(run.item.threeSiteSettings.nativeOrUnattributedRequests.length, 1);
  assert.deepEqual(run.item.threeSiteSettings.extensionRequests, []);
  assert.ok(run.writes.every((settings) => { assertPatternOnlySettings(settings, original); return true; }));
  assert.ok(run.pages.slice(1).every((page) => page.closed)); assert.equal(run.bb.closed, false);
  assert.equal(run.bb.listenerCount('request'), 0);
});

test('a failed screenshot still restores exactly the original patterns and closes both counterparts', async () => {
  const run = flow({ failCapture: true });
  await assert.rejects(run.run(), /Offline screenshot failure/);
  assert.deepEqual(run.settings(), original);
  assert.ok(run.pages.slice(1).every((page) => page.closed)); assert.equal(run.bb.closed, false);
  assert.equal(run.item.threeSiteSettings.cleanupSettings.restored, true); assert.equal(run.bb.listenerCount('request'), 0);
});

test('additional extension-attributed Bitbucket source demand aborts immediately and cannot leave all-hidden settings behind', async () => {
  const run = flow({ injectedRequest: { stack: { callFrames: [{ url: `chrome-extension://${EXTENSION}/content-scripts/bitbucket.js` }] } } });
  await assert.rejects(run.run(), /extension-attributed Bitbucket source request/);
  assert.equal(run.abort.signal.aborted, true); assert.equal(run.bb.closed, true);
  assert.deepEqual(run.settings(), original); assert.ok(run.pages.slice(1).every((page) => page.closed));
  assert.equal(run.item.threeSiteSettings.extensionRequests.length, 1); assert.equal(run.bb.listenerCount('request'), 0);
});

test('the existing rolling40 guard counts main and counterpart traffic together and stops exactly at the unchanged limit', () => {
  const budgetFunction = harness.slice(harness.indexOf('function observeBitbucketBudget('), harness.indexOf('async function runCase('));
  const requestTimes = [Date.now() - 61 * 60 * 1000]; const abort = new AbortController(); const cooldowns = new Map(); const item = {}; const report = { quotaPolicy: { conservativeObservedRequestBudget: 40 } };
  const deps = { bitbucketApi: (url) => url.startsWith('https://bitbucket.org/!api/2.0/'), bitbucketApiRequests: 0, bitbucketRequestTimes: requestTimes, report, BITBUCKET_ANONYMOUS_COOLDOWN_MS: 62 * 60 * 1000, cooldowns };
  const observe = new Function(...Object.keys(deps), `return (${budgetFunction});`)(...Object.values(deps));
  class Page extends EventEmitter { closed = false; async close() { this.closed = true; } }
  const main = new Page(); const counterpart = new Page(); const stopMain = observe(main, item, abort); const stopCounterpart = observe(counterpart, item, abort);
  const request = { url: () => REQUEST_URL };
  for (let index = 0; index < 39; index += 1) main.emit('request', request);
  assert.equal(item.observedBitbucketApiRequests, 39); assert.equal(requestTimes.length, 39); assert.equal(abort.signal.aborted, false);
  counterpart.emit('request', request);
  assert.equal(item.observedBitbucketApiRequests, 40); assert.equal(report.observedBitbucketApiRequests, 40); assert.equal(requestTimes.length, 40);
  assert.equal(abort.signal.aborted, true); assert.equal(counterpart.closed, true); assert.equal(main.closed, false);
  assert.equal(item.holdReason, 'conservative_anonymous_api_budget'); assert.ok(cooldowns.get('bitbucket') > Date.now() + 60 * 60 * 1000);
  stopMain(); stopCounterpart(); assert.equal(main.listenerCount('request'), 0); assert.equal(counterpart.listenerCount('request'), 0);
});
