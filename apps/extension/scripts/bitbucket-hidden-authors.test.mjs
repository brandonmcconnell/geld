import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBitbucketAuthorProjection, observedBitbucketAuthors } from './bitbucket-hidden-authors.mjs';
const UUID = '7177c565-3bb4-44d3-b17b-e791dfb8fed8';
const endpoint = 'https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/pullrequests?state=MERGED&pagelen=100&fields=values.id,values.author.uuid,values.author.display_name';
// Protocol projection shape from documented schema plus actual retained public PR27 UUID/name; no live collection response claim.
const fixture = () => ({ values: [{ id: 27, author: { uuid: `{${UUID}}`, display_name: 'Albert Sundjaja' } }, { id: 25, author: { uuid: '{11111111-1111-1111-1111-111111111111}', display_name: 'Albert Sundjaja' } }, { id: 22, author: { account_id: UUID, nickname: 'Albert Sundjaja', display_name: 'Albert Sundjaja' } }] });
test('observes only the exact native or canonical author projection, never arbitrary page/API traffic', () => {
  assert.equal(isBitbucketAuthorProjection(endpoint), true);
  assert.equal(isBitbucketAuthorProjection(endpoint.replace('https://bitbucket.org/!api/', 'https://api.bitbucket.org/')), true);
  for (const value of [endpoint.replace('MERGED', 'OPEN'), endpoint.replace('MERGED', 'merged'), endpoint.replace('atlassian', 'foreign'), endpoint.replace('100', '25'), `${endpoint}&page=2`, `${endpoint}&state=OPEN`, endpoint.replace('uuid', 'nickname'), endpoint.replace('https:', 'http:'), endpoint.replace('bitbucket.org/', 'bitbucket.org.evil.example/'), `${endpoint}#next`]) assert.equal(isBitbucketAuthorProjection(value), false, value);
});
test('exact returned ID/UUID mapping separates same-name users and unknown account_id/nickname-only records', () => {
  const actual = observedBitbucketAuthors(fixture(), ['27', '25', '22']);
  assert.deepEqual(actual.expectedHiddenIds, ['27']);
  assert.equal(actual.authors.find((author) => author.id === '25').name, 'Albert Sundjaja');
  assert.equal(actual.authors.find((author) => author.id === '22').uuid, null);
});
test('only current visible IDs count and a missing fixture identity cannot become a successful author proof', () => {
  const actual = observedBitbucketAuthors(fixture(), ['27']);assert.equal(actual.authors.length, 1);
  for (const value of [{ values: [] }, { values: [{ id: 27, author: { nickname: 'Albert', account_id: UUID } }] }, { values: [{ id: 27, author: { uuid: '{11111111-1111-1111-1111-111111111111}' } }] }]) assert.throws(() => observedBitbucketAuthors(value, ['27']));
});
test('ambiguous IDs, invalid collection shape and an oversized response fail the actual-response proof', () => {
  for (const value of [null, {}, { values: [fixture().values[0], fixture().values[0]] }, { values: [{ id: '27' }] }, { values: Array.from({ length: 101 }, (_, id) => ({ id: id + 1 })) }]) assert.throws(() => observedBitbucketAuthors(value, ['27']));
});

test('semantic popup descendants are recorded separately while ARIA-associated hidden labels remain strict native identities', async () => {
  const { Window } = await import('happy-dom');
  const { bitbucketAuthorRowsSnapshot } = await import('./bitbucket-hidden-authors.mjs');
  const window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED', settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const previous = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = window.document;globalThis.location = window.location;globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td><span id="stable-title" aria-describedby="_r1q_-tooltip"><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">PR27</a></span><div id="popover-ris" role="tooltip" popover="hint"><span id="popup-child">Native popup protocol fixture</span></div><span id="_r1q_-tooltip" hidden>Native ARIA label protocol fixture</span></td></tr></tbody></table>';
    const row = bitbucketAuthorRowsSnapshot().rows[0];
    assert.deepEqual(row.nativeIds, ['stable-title', '_r1q_-tooltip']);
    assert.deepEqual(row.transientNativePopups, [{ id: 'popover-ris', role: 'tooltip', popover: 'hint', ids: ['popover-ris', 'popup-child'] }]);
    assert.deepEqual(row.ariaAssociations[0].related, [{ id: '_r1q_-tooltip', exists: true, tag: 'SPAN', role: null, popover: null, hidden: true }]);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }
    window.happyDOM.abort();
  }
});
