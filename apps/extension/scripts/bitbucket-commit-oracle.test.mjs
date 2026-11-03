import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { bitbucketParentCommitSnapshot, createBitbucketCommitOracle, commitHoverTotal } from './bitbucket-commit-oracle.mjs';

const SHA = 'a'.repeat(40);
const BASE = 'https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file';
const file = (path, additions, deletions) => ({ new: { path }, lines_added: additions, lines_removed: deletions });
const metadata = (oracle) => oracle.observe(`${BASE}/commit/${SHA.slice(0, 12)}?fields=hash,repository.full_name`, { hash: SHA, repository: { full_name: 'atlassian/bitbucket-upload-file' } });
const globals = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
let window;
beforeEach(() => {
  window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/9777bca47119' });
  globalThis.document = window.document;globalThis.location = window.location;globalThis.getComputedStyle = window.getComputedStyle.bind(window);
});
afterEach(() => {
  for (const [key, value] of Object.entries(globals)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  window.happyDOM.abort();
});

test('derives immutable commit totals only after all already-issued diffstat pages arrive', () => {
  const oracle = createBitbucketCommitOracle();metadata(oracle);
  const next = `${BASE}/diffstat/${SHA}?pagelen=100&page=2`;
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { size: 2, page: 1, pagelen: 100, values: [file('src/app.py', 7, 2)], next });
  assert.equal(oracle.snapshot(SHA.slice(0, 12)).status, 'unavailable');
  oracle.observe(next, { size: 2, page: 2, pagelen: 100, values: [file('tests/test_app.py', 3, 1)] });
  const result = oracle.snapshot(SHA.slice(0, 12));
  assert.equal(result.status, 'ready');assert.equal(result.sha, SHA);
  assert.deepEqual(result.totals, { files: 2, additions: 10, deletions: 3 });
  assert.equal(result.provenance.diffstat.length, 2);
});

test('accepts the observed same-origin API transport without changing repository identity', () => {
  const oracle = createBitbucketCommitOracle();
  oracle.observe(`https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/commit/${SHA}`, { hash: SHA });
  oracle.observe(`https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/diffstat/${SHA}?pagelen=100`, { values: [] });
  assert.deepEqual(oracle.snapshot(SHA).totals, { files: 0, additions: 0, deletions: 0 });
});

test('does not infer a count from a file heading, a parent hash, a different repository or another commit', () => {
  const oracle = createBitbucketCommitOracle();
  oracle.observe(`${BASE}/commit/${SHA}`, { hash: 'b'.repeat(40), parents: [{ hash: SHA }] });
  oracle.observe(`${BASE.replace('bitbucket-upload-file', 'other')}/commit/${SHA}`, { hash: SHA });
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('app.py', 2, 0)] });
  assert.equal(oracle.snapshot(SHA).status, 'unavailable');
});

test('rejects incomplete, cyclic, duplicate-path and revision-changing diffstat chains', () => {
  for (const mode of ['cycle', 'foreign', 'duplicate', 'invalid']) {
    const oracle = createBitbucketCommitOracle();metadata(oracle);
    const first = `${BASE}/diffstat/${SHA}?pagelen=100`;
    const values = mode === 'duplicate' ? [file('x', 1, 0), file('x', 2, 0)] : mode === 'invalid' ? [file('x', -1, 0)] : [file('x', 1, 0)];
    oracle.observe(first, { values, ...(mode === 'cycle' ? { next: first } : mode === 'foreign' ? { next: `${BASE}/diffstat/${'b'.repeat(40)}?page=2` } : {}) });
    assert.equal(oracle.snapshot(SHA).status, 'unavailable', mode);
  }
});

test('rejects conflicting complete native counts and never treats page2 as the full commit', () => {
  const oracle = createBitbucketCommitOracle();metadata(oracle);
  oracle.observe(`${BASE}/diffstat/${SHA}?page=2&pagelen=100`, { values: [file('late', 3, 0)] });
  assert.equal(oracle.snapshot(SHA).status, 'unavailable');
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('x', 1, 0)] });
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=50`, { values: [file('x', 2, 0)] });
  assert.equal(oracle.snapshot(SHA).status, 'unavailable');
});

test('requires a declared total size to agree with a complete page chain even when next is missing', () => {
  for (const size of [0, 2]) {
    const oracle = createBitbucketCommitOracle();metadata(oracle);
    oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { size, values: [file('x', 1, 0)] });
    assert.equal(oracle.snapshot(SHA).status, 'unavailable');
  }
  const oracle = createBitbucketCommitOracle();metadata(oracle);
  const next = `${BASE}/diffstat/${SHA}?pagelen=100&page=2`;
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { size: 2, page: 1, values: [file('x', 1, 0)], next });
  oracle.observe(next, { size: 3, page: 2, values: [file('y', 1, 0)] });
  assert.equal(oracle.snapshot(SHA).status, 'unavailable');
});

test('rejects malformed present size and page metadata instead of treating it as absent', () => {
  for (const fields of [{ size: null }, { size: '1' }, { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { page: null }, { page: '1' }, { page: 0 }, { page: 2 }, { pagelen: null }, { pagelen: '100' }, { pagelen: 0 }]) {
    const oracle = createBitbucketCommitOracle();metadata(oracle);
    oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('x', 1, 0)], ...fields });
    assert.equal(oracle.snapshot(SHA).status, 'unavailable', JSON.stringify(fields));
  }
});

test('rejects unsafe aggregate line counts even when each source entry is a safe integer', () => {
  for (const values of [[file('x', Number.MAX_SAFE_INTEGER, 0), file('y', 1, 0)], [file('x', 0, Number.MAX_SAFE_INTEGER), file('y', 0, 1)]]) {
    const oracle = createBitbucketCommitOracle();metadata(oracle);
    oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { size: 2, values });
    assert.equal(oracle.snapshot(SHA).status, 'unavailable');
  }
});

test('keeps a changing short-ref identity and an inconsistent immutable response unverified', () => {
  const oracle = createBitbucketCommitOracle();metadata(oracle);
  oracle.observe(`${BASE}/commit/${SHA.slice(0, 12)}?fields=hash,repository.full_name`, { hash: SHA.slice(0, 12) + 'b'.repeat(28) });
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('x', 1, 0)] });
  assert.equal(oracle.snapshot(SHA.slice(0, 12)).status, 'unavailable');
  const changed = createBitbucketCommitOracle();metadata(changed);
  changed.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('x', 1, 0)] });
  changed.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [file('x', 2, 0)] });
  assert.equal(changed.snapshot(SHA).status, 'unavailable');
});

test('reads the actual Total row rather than essential counts or unrelated tooltip numbers', () => {
  assert.deepEqual(commitHoverTotal([{ label: 'Essential', files: '1 file', additions: '+7', deletions: '−2' }, { label: 'Total', files: '2 files', additions: '+10', deletions: '−3' }]), { files: 2, additions: 10, deletions: 3 });
  assert.equal(commitHoverTotal([{ label: 'Total', files: '2 reviews', additions: '+10', deletions: '−3' }]), null);
});

test('retains only the five permitted cache headers from already-observed successful responses', () => {
  const oracle = createBitbucketCommitOracle();
  const headers = { 'Cache-Control': 'no-cache', ETag: '"commit-version"', Age: '0', Date: 'Sun, 01 Nov 2026 23:01:00 GMT', Vary: 'Accept', 'Set-Cookie': 'not-retained', Authorization: 'not-retained' };
  oracle.observe(`${BASE}/commit/${SHA}`, { hash: SHA }, headers);
  oracle.observe(`${BASE}/diffstat/${SHA}?pagelen=100`, { values: [] }, headers);
  const expected = { 'cache-control': 'no-cache', etag: '"commit-version"', age: '0', date: headers.Date, vary: 'Accept' };
  assert.deepEqual(oracle.evidence.metadata[0].cacheHeaders, expected);
  assert.deepEqual(oracle.evidence.diffstat[0].cacheHeaders, expected);
  assert.equal(JSON.stringify(oracle.evidence).includes('not-retained'), false);
});

test('does not accept a partial cursor page or a changed comparison query as the full commit', () => {
  const oracle = createBitbucketCommitOracle();metadata(oracle);
  oracle.observe(`${BASE}/diffstat/${SHA}?cursor=next`, { values: [file('late', 3, 0)] });
  oracle.observe(`${BASE}/diffstat/${SHA}?topic=true`, { values: [file('other-base', 6, 0)] });
  assert.equal(oracle.snapshot(SHA).status, 'unavailable');
});

test('uses the real relative parent link only within the observed native Details and parent-commit context', () => {
  const parent = '4eded8cb0a4a3cf5f249d1bab75e90078eba2058';
  // Reduced native snapshot from installed run41327802465, with unit-only layout geometry.
  document.body.innerHTML = `<div id="details" role="tab" data-testid="sidebar-tab-details" aria-controls="panel">Details</div><div id="panel" role="tabpanel" aria-labelledby="details"><div data-testid="expanded-CommitCard"><section><h2><button aria-expanded="true" aria-controls="parents">1 parent commit</button></h2><div id="parents"><a href="${parent}" target="_self">4eded8c</a></div></section></div></div>`;
  const link = document.querySelector('a');link.getBoundingClientRect = () => ({ left: 800, top: 200, width: 80, height: 20 });document.elementFromPoint = () => link;
  const before = document.body.innerHTML;
  assert.deepEqual(bitbucketParentCommitSnapshot()?.links.map(({ raw, sha, visible }) => ({ raw, sha, visible })), [{ raw: parent, sha: parent, visible: true }]);
  assert.equal(document.body.innerHTML, before);
  document.elementFromPoint = () => document.body;
  assert.equal(bitbucketParentCommitSnapshot()?.links[0].visible, false);
  link.setAttribute('data-geld-ui', '');
  assert.equal(bitbucketParentCommitSnapshot()?.links.length, 0);
  link.removeAttribute('data-geld-ui');
  document.getElementById('panel').setAttribute('aria-labelledby', 'other');
  assert.equal(bitbucketParentCommitSnapshot(), null);
});
