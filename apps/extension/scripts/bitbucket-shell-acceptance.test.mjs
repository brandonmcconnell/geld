import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { assertBitbucketShellCounts, currentBitbucketShellHead, observeBitbucketShellFixture, parseObservedBitbucketShellMetadata, verifyBitbucketShellSource, verifyBitbucketShellUnpainted, verifyBitbucketShell, bitbucketShellProbe } from './bitbucket-shell-acceptance.mjs';

// Synthetic API evidence exercises the live harness's refusal boundary. These are neither
// public commit IDs nor browser/provider proof; no browser or network is used by this suite.
import { bitbucketPipelineVisitProbe } from './bitbucket-pipeline-visit.mjs';
import { bitbucketPipelineConsentProbe } from './bitbucket-pipeline-consent.mjs';
import { bitbucketSyntaxSettingsProbe } from './bitbucket-syntax-settings.mjs';
const REPO = 'atlassian/bitbucket-upload-file';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const API = `https://bitbucket.org/!api/2.0/repositories/${REPO}`;

function metadata(head = HEAD, base = BASE) {
  return { id: 27, state: 'MERGED', source: { repository: { full_name: REPO }, commit: { hash: head } },
    destination: { repository: { full_name: REPO }, commit: { hash: base } } };
}

function evidence() {
  return { metadata: [parseObservedBitbucketShellMetadata(metadata())], partialMetadata: [], commits: [],
    pins: [{ sourceRepo: REPO, head: HEAD, base: BASE, resource: 'diff', status: 200 }], errors: [], mutations: [] };
}

function observer(t) {
  const page = new EventEmitter();const item = {};
  observeBitbucketShellFixture(page, item, { safeUrl: (url) => url, extensionId: 'synthetic-extension' });
  t.after(() => page.emit('close'));
  const request = (url, method = 'GET') => ({ url: () => url, method: () => method });
  return { page, value: item.shellNativeSources,
    request: (url, method) => page.emit('request', request(url, method)),
    response: (url, body, status = 200) => page.emit('response', { url: () => url, request: () => request(url), status: () => status,
      headers: () => ({}), json: async () => body }),
    flush: () => new Promise(setImmediate) };
}

function pinUrl(head = HEAD, base = BASE) {
  return `${API}/diff/${REPO}:${head}%0D${base}?from_pullrequest_id=27&topic=true`;
}

function observeComplete(value) {
  value.response(`${API}/pullrequests/27`, metadata());
  value.response(pinUrl(), {});
}

test('matching current metadata and immutable comparisons establish one source without requiring an HTTP observation count', () => {
  const value = evidence();
  value.metadata.push(parseObservedBitbucketShellMetadata(metadata()));
  value.pins.push({ ...value.pins[0], resource: 'diffstat' });
  const result = currentBitbucketShellHead(value);
  assert.equal(result.head, HEAD);assert.equal(result.base, BASE);assert.equal(result.sourceRepo, REPO);
});

test('abbreviated current source and destination require exact observed resolution in the correct repositories', () => {
  const value = evidence();value.metadata = [parseObservedBitbucketShellMetadata(metadata(HEAD.slice(0, 12), BASE.slice(0, 12)))];
  assert.throws(() => currentBitbucketShellHead(value), /exact pinned head/);
  value.commits.push({ repo: 'other/fork', ref: HEAD.slice(0, 12), hash: HEAD });
  assert.throws(() => currentBitbucketShellHead(value), /exact pinned head/);
  value.commits.push({ repo: REPO, ref: HEAD.slice(0, 12), hash: HEAD });
  assert.throws(() => currentBitbucketShellHead(value), /exact pinned base/);
  value.commits.push({ repo: REPO, ref: BASE.slice(0, 12), hash: BASE });
  assert.equal(currentBitbucketShellHead(value).head, HEAD);
});

test('a commit response cannot make a contradictory abbreviation agree with the pinned head', () => {
  const value = evidence();value.metadata[0].head = HEAD.slice(0, 12);value.pins[0].head = BASE;
  value.commits.push({ repo: REPO, ref: HEAD.slice(0, 12), hash: BASE });
  assert.throws(() => currentBitbucketShellHead(value), /exact pinned head/);
});

for (const [name, changed] of [
  ['head', { head: 'c'.repeat(40) }], ['base', { base: 'c'.repeat(40) }], ['source repository', { sourceRepo: 'other/fork' }],
]) test(`mixed immutable comparison ${name} refuses a cross-snapshot source`, () => {
  const value = evidence();value.pins.push({ ...value.pins[0], ...changed });
  assert.throws(() => currentBitbucketShellHead(value), /comparison changed/);
});

test('mixed current metadata cannot reuse an earlier pinned source', () => {
  const value = evidence();value.metadata.push(parseObservedBitbucketShellMetadata(metadata('c'.repeat(40))));
  assert.throws(() => currentBitbucketShellHead(value), /exact pinned head/);
});

for (const [name, changed] of [
  ['PR number', { id: '28' }], ['state', { state: 'OPEN' }], ['destination', { destinationRepo: 'other/fork' }],
]) test(`current metadata with another ${name} is refused`, () => {
  const value = evidence();Object.assign(value.metadata[0], changed);
  assert.throws(() => currentBitbucketShellHead(value));
});

for (const name of ['metadata', 'pins']) test(`missing ${name} does not manufacture a source proof`, () => {
  const value = evidence();value[name] = [];
  assert.throws(() => currentBitbucketShellHead(value), /current PR metadata.*immutable diff/);
});

test('provider mutations and unreadable source observations block acceptance', () => {
  const value = evidence();value.mutations.push({ method: 'POST' });
  assert.throws(() => currentBitbucketShellHead(value), /provider mutation/);
  value.mutations = [];value.errors.push({ error: 'Native source body unavailable' });
  assert.throws(() => currentBitbucketShellHead(value), /could not be read/);
});

test('partial metadata retains both supplied repository names even without head fields', () => {
  const partial = parseObservedBitbucketShellMetadata({ source: { repository: { full_name: 'other/fork' } }, destination: { repository: { full_name: REPO } } });
  assert.equal(partial.sourceRepo, 'other/fork');assert.equal(partial.destinationRepo, REPO);assert.equal(partial.head, null);assert.equal(partial.base, null);
});

for (const side of ['source', 'destination']) test(`a later partial ${side} repository change cannot be silently dropped`, () => {
  const value = evidence();value.partialMetadata.push(parseObservedBitbucketShellMetadata({ [side]: { repository: { full_name: 'other/fork' } } }));
  assert.throws(() => currentBitbucketShellHead(value), new RegExp(`partial ${side} repository changed`));
});

test('legitimate partial identity fields agree with the full source and omitted fields stay optional', () => {
  const value = evidence();value.partialMetadata.push(parseObservedBitbucketShellMetadata({ source: { repository: { full_name: REPO }, commit: { hash: HEAD.slice(0, 12) } } }));
  assert.equal(currentBitbucketShellHead(value).head, HEAD);
  value.partialMetadata.push(parseObservedBitbucketShellMetadata({ destination: { commit: { hash: 'c'.repeat(12) } } }));
  assert.throws(() => currentBitbucketShellHead(value), /partial current base changed/);
});

for (const [name, body] of [
  ['source object', { source: null }], ['destination object', { destination: [] }],
  ['source repository object', { source: { repository: null } }], ['destination repository object', { destination: { repository: 'other/fork' } }],
  ['source repository name', { source: { repository: { full_name: null } } }], ['destination repository name', { destination: { repository: { full_name: false } } }],
  ['empty repository name', { source: { repository: { full_name: '' } } }], ['nested repository path', { source: { repository: { full_name: 'other/nested/repo' } } }],
  ['commit object', { source: { commit: null } }], ['commit hash', { source: { commit: { hash: null } } }],
  ['nonhex hash', { source: { commit: { hash: 'not-a-hash' } } }], ['unsupported hash length', { source: { commit: { hash: 'a'.repeat(41) } } }],
  ['PR id type', { id: '27' }], ['PR state type', { state: null }],
]) test(`malformed present ${name} is rejected instead of treated as an omitted field`, () => {
  assert.throws(() => parseObservedBitbucketShellMetadata(body), /Malformed present/);
});

test('observed native metadata, commit resolutions and encoded immutable comparison URLs bind the exact source', async (t) => {
  const observed = observer(t);
  observed.response(`${API}/pullrequests/27`, metadata(HEAD.slice(0, 12), BASE.slice(0, 12)));
  for (const hash of [HEAD, BASE]) observed.response(`${API}/commit/${hash.slice(0, 12)}?fields=hash`, { hash });
  observed.response(pinUrl(), {});
  await observed.flush();
  assert.equal(observed.value.pins.length, 1);assert.equal(observed.value.commits.length, 2);
  assert.equal(currentBitbucketShellHead(observed.value).head, HEAD);
});

test('observed partial repository changes remain scoped and malformed-present responses become evidence errors', async (t) => {
  const observed = observer(t);observeComplete(observed);await observed.flush();
  observed.response(`${API}/pullrequests/27?fields=source.repository.full_name`, { source: { repository: { full_name: 'other/fork' } } });
  await observed.flush();
  assert.equal(observed.value.partialMetadata[0].sourceRepo, 'other/fork');
  assert.throws(() => currentBitbucketShellHead(observed.value), /partial source repository changed/);
  observed.response(`${API}/pullrequests/27?fields=destination.repository.full_name`, { destination: { repository: { full_name: null } } });
  await observed.flush();
  assert.equal(observed.value.partialMetadata.length, 1);assert.equal(observed.value.errors.length, 1);
  assert.throws(() => currentBitbucketShellHead(observed.value), /could not be read/);
});

test('an observed commit body inconsistent with the actual requested short ref is rejected', async (t) => {
  const observed = observer(t);
  observed.response(`${API}/pullrequests/27`, metadata(HEAD.slice(0, 12)));
  observed.response(`${API}/commit/${HEAD.slice(0, 12)}?fields=hash`, { hash: BASE });
  observed.response(pinUrl(BASE), {});
  await observed.flush();
  assert.equal(observed.value.commits.length, 0);assert.equal(observed.value.errors.length, 1);
  assert.match(observed.value.errors[0].error, /requested hash\/ref/);
  assert.throws(() => currentBitbucketShellHead(observed.value), /could not be read/);
});

test('other hosts, reviews, fragments and non-topic comparisons cannot supply immutable proof', async (t) => {
  const observed = observer(t);
  observed.response(`${API}/pullrequests/27`, metadata());
  for (const url of [pinUrl().replace('bitbucket.org', 'example.org'), pinUrl().replace('from_pullrequest_id=27', 'from_pullrequest_id=28'), pinUrl() + '#fragment', pinUrl().replace('topic=true', 'topic=false')]) observed.response(url, {});
  await observed.flush();
  assert.equal(observed.value.pins.length, 0);
  assert.throws(() => currentBitbucketShellHead(observed.value), /immutable diff/);
});

test('the passive observer records provider writes and removes its listeners at page close', async (t) => {
  const observed = observer(t);observeComplete(observed);await observed.flush();
  observed.request(`${API}/pullrequests/27/comments`, 'POST');
  assert.equal(observed.value.mutations.length, 1);
  assert.throws(() => currentBitbucketShellHead(observed.value), /provider mutation/);
  observed.page.emit('close');
  assert.equal(observed.page.listenerCount('request'), 0);assert.equal(observed.page.listenerCount('response'), 0);
});

test('count/state invariants reject drift in the post-screenshot snapshot', () => {
  const counts = { files: 5, additions: 46, deletions: 29 };
  const state = { hasDiff: true, onDiffPage: true, all: { ...counts }, visible: { ...counts }, hiddenCount: 0, repo: REPO,
    repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: REPO } };
  assert.doesNotThrow(() => assertBitbucketShellCounts(counts, state, { ...counts }, structuredClone(state)));
  assert.throws(() => assertBitbucketShellCounts(counts, state, { ...counts, additions: 47 }, structuredClone(state)), /Native additions changed/);
  const hidden = structuredClone(state);hidden.visible.files = 4;
  assert.throws(() => assertBitbucketShellCounts(counts, state, counts, hidden), /tab visible changed/);
  assert.throws(() => assertBitbucketShellCounts(counts, state, counts, { ...state, repo: 'other/fork' }), /tab repo changed/);
  assert.throws(() => assertBitbucketShellCounts(counts, state, counts, { ...state, hasDiff: false }), /lost its complete diff/);
});

// Synthetic complete source/range protocol. Equality samples below are not browser colors.
const SHELL_COMMAND = `if [ ! -d ".changes/next-release" ]; then echo "Next release file missing, make sure to run 'semversioner add-change'"; exit 1; fi`;
function completeSourceProbe() {
  const lines = [...Array.from({ length: 30 }, (_, index) => '# synthetic prefix ' + index), 'check-next-release: &check-next-release', '  step:', '    script:', '    - ' + SHELL_COMMAND, '', 'following:', '  script: []'];
  const rows = lines.map((text, index) => ({ old: index + 1, next: index + 1, text, rowId: 'row' + index, links: index === 33 ? [['#Lbitbucket-pipelines.ymlT34', 'To line 34']] : [] }));
  const ranges = [['keyword', 'if', 0], ['keyword', 'then', SHELL_COMMAND.indexOf('then')], ['keyword', 'fi', SHELL_COMMAND.length - 2], ['built_in', 'echo', SHELL_COMMAND.indexOf('echo')], ['built_in', 'exit', SHELL_COMMAND.indexOf('exit')], ['string', '".changes/next-release"', SHELL_COMMAND.indexOf('"')]].map(([scope, word, offset]) => ({ scope, rowId: rows[33].rowId, start: 6 + offset, end: 6 + offset + word.length }));
  return { url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff', file: 'chg-bitbucket-pipelines.yml', heading: 'bitbucket-pipelines.yml', actualStep: true, prefixOld: 37, prefixNext: 37, oldSource: rows, newSource: rows, rows, ranges, invalidRanges: [], prePaintSeen: true, preserved: true, nativeIds: ['Lbitbucket-pipelines.ymlT34'], colors: Object.fromEntries(['keyword', 'built_in', 'string'].map((scope) => [scope, { native: 'synthetic-token', nativeNormalized: scope, pseudoNormalized: scope }])) };
}
test('full valid source verifier returns a fingerprint of the exact validated native-prefix text', () => {
  const value = completeSourceProbe();const before = structuredClone(value);
  const result = verifyBitbucketShellSource(value);
  assert.equal(result.sourceFingerprint, createHash('sha256').update(value.newSource.map((row) => row.text).join('\n') + '\n').digest('hex'));
  assert.equal(result.rangeCount, 6);assert.deepEqual(value, before);
});
for (const [name, change] of [
  ['wrong command', (p) => { p.rows[33].text = '    - echo incorrect'; }],
  ['incomplete native prefix', (p) => { p.prefixNext = 36; }],
  ['invalid native range', (p) => { p.invalidRanges.push({ scope: 'keyword' }); }],
  ['YAML prefix range', (p) => { p.ranges.push({ scope: 'string', rowId: p.rows[33].rowId, start: 0, end: 5 }); }],
  ['range escapes actual source prefix', (p) => { p.ranges.push({ scope: 'string', rowId: p.rows[36].rowId, start: 0, end: 1 }); }],
  ['source references changed', (p) => { p.preserved = false; }],
  ['no prepaint evidence', (p) => { p.prePaintSeen = false; }],
  ['actual palette mismatch', (p) => { p.colors.string.pseudoNormalized = 'different'; }],
]) test('full source verifier refuses ' + name, () => { const value = completeSourceProbe();change(value);assert.throws(() => verifyBitbucketShellSource(value)); });

for (const status of ['native_disabled', 'unavailable']) {
  function unpainted() { return { ...completeSourceProbe(), ownedCount: 0, ranges: [], viewed: [{ checked: false, disabled: false }] }; }
  test(`${status} acceptance requires preserved prepaint source and Viewed both before and after capture`, () => {
    const baseline = unpainted();const before = unpainted();const after = structuredClone(before);
    verifyBitbucketShellUnpainted({ status }, before, baseline);verifyBitbucketShellUnpainted({ status }, after, baseline);
    for (const [name, mutate] of [
      ['prepaint', (value) => { value.prePaintSeen = false; }], ['preservation', (value) => { value.preserved = false; }],
      ['invalid range', (value) => { value.invalidRanges.push({}); }], ['actual source', (value) => { value.rows[33].text = 'changed'; }],
      ['Viewed', (value) => { value.viewed[0].checked = true; }], ['zero count hiding real ranges', (value) => { value.ranges.push({}); }],
      ['native-off colors', (value) => { value.ownedCount = 22; }],
    ]) {
      const changed = unpainted();mutate(changed);assert.throws(() => verifyBitbucketShellUnpainted({ status }, changed, baseline), name);
      verifyBitbucketShellUnpainted({ status }, before, baseline);assert.throws(() => verifyBitbucketShellUnpainted({ status }, changed, baseline), `after capture: ${name}`);
    }
    assert.throws(() => verifyBitbucketShellUnpainted({ status: 'native_enabled' }, before, baseline));
  });
}

test('actual focused verifier retains its raw expanded candidate when unknown native preference still has owned colors', async () => {
  const page = new EventEmitter();const item = {};const phases = [];let selected = false;let expanded = false;const review = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
  const painted = completeSourceProbe();painted.url = review + '#chg-bitbucket-pipelines.yml';painted.ownedCount = 6;painted.colors.string.pseudoNormalized = 'mismatch';
  const baseline = { ...painted, prefixOld: 18, prefixNext: 16, ownedCount: 0, rows: [...painted.rows, { old: 18, next: 16, text: '          - docker' }, { old: 29, next: 27, text: '          - pipe: atlassian/git-secrets-scan:3.0.0' }], controls: [{ visible: true, previous: [18, 16], next: [29, 27] }] };
  page.url = () => selected ? painted.url : review;page.isClosed = () => false;page.$$ = async () => [];
  page.evaluate = async (fn, action) => {
    if (action === 'cleanup') { phases.push('cleanup:' + fn.name);return null; }
    if (fn === bitbucketPipelineConsentProbe) { phases.push('consent');return { status: 'not_present', url: page.url() }; }
    if (fn === bitbucketPipelineVisitProbe) return action === 'click-result' ? { trusted: true, sameLink: true, sameParent: true, href: '#chg-bitbucket-pipelines.yml' } : { sameSource: true, heading: 'bitbucket-pipelines.yml', selected, url: page.url(), pinned: selected ? page.url() : null };
    if (fn === bitbucketSyntaxSettingsProbe) { phases.push('settings-source:' + action);assert.equal(selected, true);return { sameSource: true, sourceRows: 4, url: page.url(), viewed: [false], dialogCount: 0, events: [] }; }
    assert.equal(fn, bitbucketShellProbe);phases.push('shell:' + action);
    if (action === 'scroll' || action === 'arm') return { matches: 1 };
    if (action === 'click-result') return { trusted: true, url: page.url(), qa: 'pr-diff-show-more-lines-below', aria: 'Show more lines below', previous: [18, 16], next: [29, 27] };
    return expanded ? painted : baseline;
  };
  page.evaluateHandle = async (fn) => { const handle = { asElement: () => handle, dispose: async () => {}, click: async () => { if (fn === bitbucketPipelineVisitProbe) selected = true;else expanded = true; } };return handle; };
  observeBitbucketShellFixture(page, item, { safeUrl: (value) => value, extensionId: 'synthetic' });
  const response = (url, body) => page.emit('response', { url: () => url, request: () => ({ method: () => 'GET' }), status: () => 200, headers: () => ({}), json: async () => body });
  response(`${API}/pullrequests/27`, metadata());response(pinUrl(), {});
  const counts = { files: 5, additions: 46, deletions: 29 };const state = { hasDiff: true, onDiffPage: true, all: counts, visible: counts, hiddenCount: 0 };
  try {
    await assert.rejects(verifyBitbucketShell(page, item, { poll: async (read, accept) => { const value = await read();assert.equal(accept(value), true);return value; }, bitbucketDom: async () => counts, tabState: async () => state, guardBudget: () => ({ remaining: 24 }), prepareConsent: true, freshAnonymousProfile: true }), /positively observed native Syntax/);
    assert.equal(item.shellSyntax.unknownPreference, painted);assert.equal(item.shellSyntax.expanded, null);assert.equal(item.shellSyntax.status, 'failed');assert.equal(item.shellSyntax.contextMechanics.status, 'passed');assert.equal(item.shellSyntax.consent.status, 'not_present');
    assert.ok(phases.indexOf('consent') < phases.indexOf('shell:undefined'));assert.ok(phases.indexOf('cleanup:bitbucketPipelineConsentProbe') < phases.indexOf('shell:undefined'));assert.equal(phases.filter((value) => value === 'settings-source:setup').length, 2);
  } finally { page.emit('close'); }
});

function unpaintedProtocol({ knownOff = false, drift = null } = {}) {
  const page = new EventEmitter();const item = {};let selected = false;let expanded = false;let settingsOpen = false;let captured = false;
  const review = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
  const source = { ...completeSourceProbe(), url: review + '#chg-bitbucket-pipelines.yml', ownedCount: 0, ranges: [], viewed: [{ checked: false, disabled: false }] };
  const counts = { files: 5, additions: 46, deletions: 29 };const state = { hasDiff: true, onDiffPage: true, all: counts, visible: counts, hiddenCount: 0 };
  const baseline = { ...source, prefixOld: 18, prefixNext: 16, rows: [...source.rows, { old: 18, next: 16, text: '          - docker' }, { old: 29, next: 27, text: '          - pipe: atlassian/git-secrets-scan:3.0.0' }], controls: [{ visible: true, previous: [18, 16], next: [29, 27] }] };
  const handle = (click) => ({ asElement() { return this; }, evaluate: async () => {}, dispose: async () => {}, click: async () => click() });
  page.url = () => selected ? source.url : review;page.isClosed = () => false;
  page.$$ = async () => knownOff ? [handle(() => { settingsOpen = true; })] : [];
  page.evaluate = async (fn, action) => {
    if (action === 'cleanup') return null;
    if (fn === bitbucketPipelineVisitProbe) return action === 'click-result' ? { trusted: true, sameLink: true, sameParent: true, href: '#chg-bitbucket-pipelines.yml' } : { sameSource: true, heading: 'bitbucket-pipelines.yml', selected, url: page.url(), pinned: selected ? page.url() : null };
    if (fn === bitbucketSyntaxSettingsProbe) {
      if (['opener', 'opener-hit', 'arm'].includes(action)) return true;
      if (action === 'click-result') return { trusted: true, url: page.url() };
      return { sameSource: true, dialogCount: settingsOpen ? 1 : 0, ready: settingsOpen, cancelAvailable: settingsOpen, checkbox: { checked: false }, preferences: [{ name: 'enableSyntaxHighlighting', checked: false }], events: [] };
    }
    assert.equal(fn, bitbucketShellProbe);
    if (action === 'scroll' || action === 'arm') return { matches: 1 };
    if (action === 'click-result') return { trusted: true, url: page.url(), qa: 'pr-diff-show-more-lines-below', aria: 'Show more lines below', previous: [18, 16], next: [29, 27] };
    const result = structuredClone(expanded ? source : baseline);
    if (captured) {
      if (drift === 'Viewed') result.viewed[0].checked = true;
      if (drift === 'preservation') result.preserved = false;
      if (drift === 'prepaint') result.prePaintSeen = false;
      if (drift === 'invalidRange') result.invalidRanges.push({});
      if (drift === 'source') result.rows[33].text = 'changed';
      if (drift === 'owned') result.ownedCount = 22;
    }
    return result;
  };
  page.evaluateHandle = async (fn) => handle(() => { if (fn === bitbucketPipelineVisitProbe) selected = true;else if (fn === bitbucketSyntaxSettingsProbe) settingsOpen = false;else expanded = true; });
  observeBitbucketShellFixture(page, item, { safeUrl: (value) => value, extensionId: 'synthetic' });
  const response = (url, body) => page.emit('response', { url: () => url, request: () => ({ method: () => 'GET' }), status: () => 200, headers: () => ({}), json: async () => body });
  response(`${API}/pullrequests/27`, metadata());response(pinUrl(), {});
  const dependencies = { poll: async (read, accept) => { const value = await read();assert.equal(accept(value), true);return value; }, bitbucketDom: async () => ({ ...counts, ...(captured && drift === 'counts' ? { additions: 47 } : {}) }), tabState: async () => structuredClone(state), guardBudget: () => ({ remaining: 24 }), capture: async (_page, name) => { if (name.startsWith('bitbucket-pipeline-native-')) { captured = true;if (drift === 'head') item.shellNativeSources.metadata.push({ ...metadata(), sourceRepo: REPO, destinationRepo: REPO, head: BASE, base: BASE }); }return {}; } };
  return { item, run: () => verifyBitbucketShell(page, item, dependencies), cleanup: () => page.emit('close') };
}

for (const knownOff of [true, false]) {
  test(`whole unpainted protocol keeps ${knownOff ? 'known off' : 'unknown'} distinct with source/Viewed/count checks after capture`, async () => {
    const p = unpaintedProtocol({ knownOff });try { const proof = await p.run();assert.equal(proof.status, knownOff ? 'native_disabled' : 'unavailable');assert.equal(proof.nativeSettings.status, knownOff ? 'native_disabled' : 'unavailable');assert.equal(proof.unpaintedAfterCapture.prePaintSeen, true);assert.equal(proof.unpaintedAfterCapture.preserved, true);assert.equal(proof.unpaintedAfterCapture.ownedCount, 0);assert.deepEqual(proof.unpaintedAfterCapture.viewed, proof.default.viewed);assert.equal(proof.selection, null);assert.equal(proof.expanded, null);assert.ok(proof.counts.afterCapture); } finally { p.cleanup(); }
  });
  for (const drift of ['Viewed', 'preservation', 'prepaint', 'invalidRange', 'source', 'owned', 'counts', 'head']) test(`whole ${knownOff ? 'off' : 'unknown'} protocol rejects post-capture ${drift}`, async () => {
    const p = unpaintedProtocol({ knownOff, drift });try { await assert.rejects(p.run());assert.equal(p.item.shellSyntax.status, 'failed');assert.ok(p.item.shellSyntax.error); } finally { p.cleanup(); }
  });
}
