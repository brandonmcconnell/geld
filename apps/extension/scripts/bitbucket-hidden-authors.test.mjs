import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBitbucketAuthorProjection, observedBitbucketAuthors, bitbucketAuthorErrorDiagnostic } from './bitbucket-hidden-authors.mjs';
const UUID = '7177c565-3bb4-44d3-b17b-e791dfb8fed8';
const deploymentAction = { href: 'https://bitbucket.org/atlassian/bitbucket-upload-file/deployments', target: '_blank', newWindowLabelId: '_rh7_' };
const endpoint = 'https://bitbucket.org/!api/2.0/repositories/atlassian/bitbucket-upload-file/pullrequests?q=state%3D%22MERGED%22&pagelen=25&fields=values.id,values.author.uuid,values.author.display_name';
// Protocol projection shape from documented schema plus actual retained public PR27 UUID/name; no live collection response claim.
const fixture = () => ({ values: [{ id: 27, author: { uuid: `{${UUID}}`, display_name: 'Albert Sundjaja' } }, { id: 25, author: { uuid: '{11111111-1111-1111-1111-111111111111}', display_name: 'Albert Sundjaja' } }, { id: 22, author: { account_id: UUID, nickname: 'Albert Sundjaja', display_name: 'Albert Sundjaja' } }] });
test('observes only the exact native or canonical author projection, never arbitrary page/API traffic', () => {
  assert.equal(isBitbucketAuthorProjection(endpoint), true);
  assert.equal(isBitbucketAuthorProjection(endpoint.replace('https://bitbucket.org/!api/', 'https://api.bitbucket.org/')), true);
  for (const value of [endpoint.replace('MERGED', 'OPEN'), endpoint.replace('MERGED', 'merged'), endpoint.replace('atlassian', 'foreign'), endpoint.replace('pagelen=25', 'pagelen=100'), `${endpoint}&page=2`, `${endpoint}&state=OPEN`, `${endpoint}&q=state%3D%22OPEN%22`, endpoint.replace('uuid', 'nickname'), endpoint.replace('https:', 'http:'), endpoint.replace('bitbucket.org/', 'bitbucket.org.evil.example/'), `${endpoint}#next`]) assert.equal(isBitbucketAuthorProjection(value), false, value);
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
  for (const value of [null, {}, { values: [fixture().values[0], fixture().values[0]] }, { values: [{ id: '27' }] }, { values: Array.from({ length: 26 }, (_, id) => ({ id: id + 1 })) }]) assert.throws(() => observedBitbucketAuthors(value, ['27']));
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

test('bounded error diagnostics retain query-validation facts without arbitrary JSON, HTML or credential details', async () => {
  let reads = 0;
  const value = { error: { message: 'Synthetic query validation failure', fields: { pagelen: ['Unsupported requested value'], q: 'Invalid predicate', secret: 'never copy this' }, secret: 'never copy this' }, account: 'never copy this' };
  assert.deepEqual(await bitbucketAuthorErrorDiagnostic({ text: async () => { reads += 1;return JSON.stringify(value); } }), { kind: 'json', message: 'Synthetic query validation failure', fields: { pagelen: ['Unsupported requested value'], q: 'Invalid predicate' } });
  assert.equal(reads, 1);
  assert.deepEqual(await bitbucketAuthorErrorDiagnostic({ text: async () => '<html>login contents</html>' }), { kind: 'non-json', characters: 27 });
  assert.deepEqual(await bitbucketAuthorErrorDiagnostic({ text: async () => 'x'.repeat(4097) }), { kind: 'oversized', characters: 4097 });
  assert.equal((await bitbucketAuthorErrorDiagnostic({ text: async () => JSON.stringify({ error: { message: 'Authorization bearer private' } }) })).message, '[credential details omitted]');
});

test('native relative title links resolve to the same canonical recovery identity and foreign focus stays unproven', async () => {
  const { Window } = await import('happy-dom');const { bitbucketAuthorRowsSnapshot } = await import('./bitbucket-hidden-authors.mjs');
  const window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED', settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const previous = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = window.document;globalThis.location = window.location;globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    // The actual retained PR27 title uses this relative href on both responsive hosts.
    document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></td></tr></tbody></table>';
    const title = document.querySelector('a');title.focus();
    assert.equal(title.getAttribute('href'), '/atlassian/bitbucket-upload-file/pull-requests/27');
    assert.equal(bitbucketAuthorRowsSnapshot().focusedHref, 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27');
    title.href = 'https://foreign.example/atlassian/bitbucket-upload-file/pull-requests/27';assert.equal(bitbucketAuthorRowsSnapshot().focusedHref, null);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }
    window.happyDOM.abort();
  }
});

test('a rejected author response retains bounded diagnostics, stops polling and restores settings without retry or oracle fetch', async () => {
  const { verifyBitbucketHiddenAuthors, bitbucketAuthorRowsSnapshot } = await import('./bitbucket-hidden-authors.mjs');
  const handlers = new Map();const patches = [];let textReads = 0;let projectionRequests = 0;let network = 0;let evidence;
  const previousFetch = globalThis.fetch;globalThis.fetch = () => { network += 1;throw new Error('No oracle fetch allowed'); };
  const request = { url: () => endpoint, method: () => 'GET', initiator: () => ({ stack: { callFrames: [{ url: 'chrome-extension://fixture/content-scripts/bitbucket.js' }] } }) };
  const response = { url: () => endpoint, request: () => request, status: () => 400, text: async () => { textReads += 1;return JSON.stringify({ error: { message: 'Synthetic query validation failure', fields: { pagelen: ['Unsupported requested value'] } } }); }, json: async () => { throw new Error('Failed body must be read only once'); } };
  const snapshot = { rows: [{ id: '27', marked: false, display: 'table-row', deploymentAction }], chips: 0, note: null };
  const page = { on: (name, handler) => handlers.set(name, handler), off: (name) => handlers.delete(name), isClosed: () => false, evaluate: async (fn) => fn === bitbucketAuthorRowsSnapshot ? snapshot : undefined };
  const poll = async (read, accepts) => { for (let count = 0; count < 20; count += 1) { const value = await read();if (accepts(value)) return value; }throw new Error('Protocol poll did not terminate'); };
  try {
    await assert.rejects(verifyBitbucketHiddenAuthors({ page, poll, original: { showListStats: false, hiddenAuthors: [] }, extensionId: 'fixture', pause: async () => undefined, capture: async () => { throw new Error('No hide screenshot before actual success'); }, onProgress: (value) => { evidence = value; }, patchSettings: async (patch) => {
      patches.push(patch);if (patch.hiddenAuthors?.includes(`bitbucket.org/uuid/${UUID}`)) { assert.equal(evidence.baseline.status, 'stable');assert.equal(evidence.baseline.unchangedSamples, 3);projectionRequests += 1;handlers.get('request')(request);handlers.get('response')(response); }
    } }), /Actual author collection must be readable/);
    assert.equal(projectionRequests, 1);assert.equal(network, 0);assert.equal(textReads, 1);
    assert.equal(evidence.status, 'failed');assert.equal(evidence.response.status, 400);assert.equal(evidence.response.errorBody.message, 'Synthetic query validation failure');
    assert.deepEqual(evidence.response.errorBody.fields, { pagelen: ['Unsupported requested value'] });
    assert.match(evidence.requests[0].requestedAt, /Z$/);assert.match(evidence.response.observedAt, /Z$/);
    assert.deepEqual(patches.at(-1), { hiddenAuthors: [], showListStats: false });assert.equal(handlers.size, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test('cleared markers cannot hide stale native display suppression on a later row', async () => {
  const { assertBitbucketAuthorRowsRestored } = await import('./bitbucket-hidden-authors.mjs');
  const before = { rows: [{ id: '27', display: 'table-row', marked: false, nativeIds: ['title27'], nativeLinks: [], hidden: false, inlineStyle: null }, { id: '25', display: 'table-row', marked: false, nativeIds: ['title25'], nativeLinks: [], hidden: false, inlineStyle: null }] };
  assert.doesNotThrow(() => assertBitbucketAuthorRowsRestored(before, structuredClone(before)));
  const stale = structuredClone(before);stale.rows[1].display = 'none';
  assert.throws(() => assertBitbucketAuthorRowsRestored(before, stale), /restore every native row display/);
});

test('actual author helper marks a post-Show settings restore failure as failed and always releases listeners', async () => {
  const { verifyBitbucketHiddenAuthors, bitbucketAuthorRowsSnapshot } = await import('./bitbucket-hidden-authors.mjs');
  const handlers = new Map();let patches = 0;let phase = 'before';let progress;
  const row = { id: '27', deploymentAction, display: 'table-row', marked: false, nativeIds: ['native-title'], nativeLinks: [{ href: '/atlassian/bitbucket-upload-file/pull-requests/27', qa: 'pull-request-row-link' }], hidden: false, inlineStyle: null };
  const before = { rows: [row], chips: 0, note: null };
  const hidden = { ...before, rows: [{ ...row, display: 'none', marked: true }], note: { tag: 'TR', role: 'note', colspan: 3, text: 'Albert Sundjaja Show', style: { fontFamily: 'Native', fontSize: '12px', lineHeight: '16px' }, nativeSmall: { fontFamily: 'Native', fontSize: '12px', lineHeight: '16px' } } };
  const shown = { ...before, focusedHref: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27', showEvent: { trusted: true, ownedShow: true } };
  const request = { url: () => endpoint, method: () => 'GET', initiator: () => ({ stack: { callFrames: [{ url: 'chrome-extension://fixture/content-scripts/bitbucket.js' }] } }) };
  const response = { url: () => endpoint, request: () => request, status: () => 200, json: async () => ({ values: [fixture().values[0]] }) };
  const page = { on: (name, fn) => handlers.set(name, fn), off: (name) => handlers.delete(name), isClosed: () => false,
    evaluate: async (fn) => fn === bitbucketAuthorRowsSnapshot ? (phase === 'hidden' ? hidden : phase === 'shown' ? shown : before) : undefined,
    focus: async () => undefined, keyboard: { press: async () => { phase = 'shown'; } } };
  const poll = async (read, accepts) => { for (let count = 0; count < 20; count += 1) { const value = await read();if (accepts(value)) return value; }throw new Error('Protocol poll did not terminate'); };
  await assert.rejects(verifyBitbucketHiddenAuthors({ page, poll, original: { showListStats: false, hiddenAuthors: [] }, extensionId: 'fixture', pause: async () => undefined, capture: async () => [], onProgress: (value) => { progress = value; }, patchSettings: async (patch) => {
    patches += 1;
    if (patches === 4) throw new Error('Synthetic restore failure');
    if (patch.hiddenAuthors?.includes(`bitbucket.org/uuid/${UUID}`)) { assert.equal(progress.baseline.status, 'stable');phase = 'hidden';handlers.get('request')(request);handlers.get('response')(response); }
    else phase = 'before';
  } }), /Synthetic restore failure/);
  assert.equal(patches, 4);assert.equal(progress.shown.focusedHref, shown.focusedHref);assert.ok(progress.cleared);
  assert.equal(progress.status, 'failed');assert.match(progress.cleanupError, /Synthetic restore failure/);assert.equal(handlers.size, 0);
});

test('retained native deployment hydration is awaited before a stable baseline without exempting its IDs or links', async () => {
  const { Window } = await import('happy-dom');
  const { bitbucketAuthorRowsSnapshot, waitForBitbucketAuthorBaseline, assertBitbucketAuthorRowsRestored } = await import('./bitbucket-hidden-authors.mjs');
  const window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED', settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const previous = Object.fromEntries(['document', 'location', 'getComputedStyle', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = window.document;globalThis.location = window.location;globalThis.getComputedStyle = window.getComputedStyle.bind(window);globalThis.fetch = () => { throw new Error('Baseline must not request provider data'); };
    // Reduced actual run41361235160 row27 structure. Compiled presentation classes omitted.
    document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></td><td colspan="3"><div></div></td><td><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></td></tr></tbody></table>';
    const placeholder = bitbucketAuthorRowsSnapshot();assert.equal(placeholder.rows[0].deploymentAction, null);
    document.querySelector('td[colspan="3"] > div').innerHTML = '<a href="https://bitbucket.org/atlassian/bitbucket-upload-file/deployments" target="_blank"><span aria-hidden="true"><svg role="presentation"></svg></span><span>Add</span><span id="_rh7_">, (opens new window)</span></a>';
    const hydrated = bitbucketAuthorRowsSnapshot();assert.deepEqual(hydrated.rows[0].deploymentAction, deploymentAction);
    assert.deepEqual(hydrated.rows[0].nativeIds, ['_rh7_']);assert.equal(hydrated.rows[0].nativeLinks.length, 3);
    const later = structuredClone(hydrated);later.rows[0].nativeIds.push('native-later-identity');
    const sequence = [placeholder, placeholder, hydrated, later, later, later];let reads = 0;const pauses = [];const progress = {};
    const stable = await waitForBitbucketAuthorBaseline({ read: async () => sequence[reads++], pause: async (ms) => { pauses.push(ms); }, progress,
      poll: async (read, accepts) => { for (let index = 0; index < sequence.length; index += 1) { const value = await read();if (accepts(value)) return value; }throw new Error('Native baseline did not settle'); } });
    assert.equal(reads, 6);assert.deepEqual(pauses, [250, 250, 250, 250, 250]);assert.equal(progress.baseline.status, 'stable');assert.equal(progress.baseline.unchangedSamples, 3);assert.deepEqual(stable, later);
    const removed = structuredClone(stable);removed.rows[0].nativeIds.splice(0, 1);assert.throws(() => assertBitbucketAuthorRowsRestored(stable, removed), /changed native row identities/);
    const changedLink = structuredClone(stable);changedLink.rows[0].nativeLinks[1].href += '/changed';assert.throws(() => assertBitbucketAuthorRowsRestored(stable, changedLink), /changed native row identities/);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }
    window.happyDOM.abort();
  }
});
