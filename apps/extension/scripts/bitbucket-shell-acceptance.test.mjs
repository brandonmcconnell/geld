import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { assertBitbucketShellCounts, currentBitbucketShellHead, observeBitbucketShellFixture, parseObservedBitbucketShellMetadata } from './bitbucket-shell-acceptance.mjs';

// Synthetic API evidence exercises the live harness's refusal boundary. These are neither
// public commit IDs nor browser/provider proof; no browser or network is used by this suite.
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
