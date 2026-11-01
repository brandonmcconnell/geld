import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGitLabRoundScope, assertRoundSingleHomes, assertRoundSources, gitLabRoundSnapshot } from './round-attention-acceptance.mjs';
const headSha = 'd03aadd2c95a94ecbe229896b29c9dcda009a916';
const scope = { headSha, diffPageUrl: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123' };
const baseline = () => ({ url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334', head: headSha, selected: { headSha, versionId: '2158520123' }, items: ['open', 'needs-reply', 'addressed', 'outdated', 'resolved', 'done-manual'].map((state, index) => ({ id: `ri_${index}`, state, attention: false, sources: [{ anchor: `note_${index + 1}`, id: String(index + 1), url: `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334#note_${index + 1}`, body: 'Native words', native: { id: `note_${index + 1}`, sameNode: true } }] })) });
const grouped = () => ({ ...baseline(), items: baseline().items.map((item) => ({ ...item, attention: ['open', 'needs-reply', 'addressed', 'outdated'].includes(item.state) })) });
test('presentation acceptance preserves all sources and uses existing four-open-status membership', () => {
  assert.doesNotThrow(() => assertRoundSingleHomes(baseline(), grouped()));
  assert.doesNotThrow(() => assertRoundSources(baseline(), baseline()));
  const wrong = grouped();wrong.items[3].attention = false;
  assert.throws(() => assertRoundSingleHomes(baseline(), wrong));
});
test('source/body/native identity changes and duplicated source homes fail the acceptance oracle', () => {
  for (const field of ['body', 'url', 'id']) { const changed = grouped();changed.items[0].sources[0][field] = 'Changed';assert.throws(() => assertRoundSingleHomes(baseline(), changed)); }
  const replaced = grouped();replaced.items[0].sources[0].native.sameNode = false;assert.throws(() => assertRoundSources(baseline(), replaced));
  const duplicated = grouped();duplicated.items.push(duplicated.items[0]);assert.throws(() => assertRoundSingleHomes(baseline(), duplicated));
});
test('native selected head, version and review scope must exactly match the previously observed source', () => {
  assert.doesNotThrow(() => assertGitLabRoundScope(baseline(), scope));
  for (const changed of [{ ...baseline(), head: 'f'.repeat(40) }, { ...baseline(), selected: null }, { ...baseline(), selected: { headSha, versionId: 'older' } }, { ...baseline(), url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/1' }]) assert.throws(() => assertGitLabRoundScope(changed, scope));
});
test('actual-shaped native source/version DOM yields original source provenance without loading resources', async () => {
  const { Window } = await import('happy-dom');const w = new Window({ url: baseline().url, settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const previous = Object.fromEntries(['document', 'location'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    globalThis.document = w.document;globalThis.location = w.location;
    const native = document.createElement('li');native.id = 'note_4118584957';native.innerHTML = '<div class="note-body"><div class="note-text">Actual-shaped source words</div></div>';document.body.append(native);
    const app = document.createElement('div');app.setAttribute('data-rapid-diffs', '');app.setAttribute('data-app-data', JSON.stringify({ mr_path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, versions: { source_versions: [{ id: 2158520123, head_sha: headSha, selected: true, latest: true }] } }));document.body.append(app);
    const panel = document.createElement('section');panel.className = 'geld-provider-review';panel.setAttribute('data-geld-review-head', headSha);panel.innerHTML = '<details data-geld-item="ri_one" data-state="open"><article data-geld-source="note_4118584957" data-geld-source-id="4118584957"><div class="geld-provider-review__body">Source words</div></article></details>';document.body.append(panel);
    const result = gitLabRoundSnapshot();assertGitLabRoundScope(result, scope);
    assert.equal(result.items[0].sources[0].native.id, native.id);assert.equal(result.items[0].sources[0].native.body, 'Actual-shaped source words');assert.equal(document.getElementById(native.id), native);
  } finally { for (const [name, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete globalThis[name];else Object.defineProperty(globalThis, name, descriptor); }w.happyDOM.abort(); }
});

function protocol(options = {}) {
  const listeners = new Map();let grouping = 'type';let attention = null;let opened = false;let focused = false;let input = null;let cleanup = false;let proof;let changes = 0;
  const read = () => {
    const value = baseline();value.items = [value.items[0]];value.items[0].sources[0].createdAt = '2026-10-29T16:52:16.580Z';
    value.items[0].attention = grouping === 'batch';value.items[0].open = opened;value.items[0].focused = focused;value.attention = attention;
    value.rounds = grouping === 'batch' ? [{ id: '4135374883', label: 'Push round 1 · Latest recorded push', at: '2026-11-01T11:59:15.345Z' }] : [];
    value.boundary = { time: '2026-11-01T11:59:15.345Z', commits: [{ sha: headSha, project: 'gitlab-org/gitlab', url: `${baseline().url}/diffs?commit_id=${headSha}` }] };
    value.input = input;
    if (input !== null && options.headDrift) value.head = 'f'.repeat(40);
    if (input !== null && options.changedSource) value.items[0].sources[0].body = 'Changed source';
    return value;
  };
  const page = { on: (name, listener) => listeners.set(name, listener), off: (name) => listeners.delete(name), isClosed: () => false,
    evaluate: async (fn) => fn === gitLabRoundSnapshot ? read() : undefined,
    click: async (selector) => { if (selector.includes('review-attention')) attention = false;else opened = !opened; },
    $eval: async () => undefined, focus: async () => undefined,
    keyboard: { press: async (key) => { assert.equal(key, 'Enter');attention = true;opened = true;focused = true;input = { trusted: options.untrusted !== true, detail: 0 };if (options.extraGet) listeners.get('request')({ method: () => 'GET', url: () => `${baseline().url}/discussions.json` }); } },
  };
  return { listeners, result: () => proof, cleanup: () => cleanup, run: async () => {
    const { verifyGitLabRoundAttention } = await import('./round-attention-acceptance.mjs');const item = {};
    try { return await verifyGitLabRoundAttention(page, item, { ...scope, readSettings: async () => ({ reviewGrouping: 'type' }),
      patchSettings: async ({ reviewGrouping }) => { changes++;if (changes === 3) { cleanup = true;if (options.cleanupFailure) throw Error('Synthetic settings restore failure'); }grouping = reviewGrouping;attention = grouping === 'batch' ? true : null; },
      poll: async (read, accepts) => { for (let i = 0; i < 3; i++) { const value = await read();if (accepts(value)) return value; }throw Error('Synthetic state did not satisfy protocol'); },
      openReviewAncestors: async () => 1,capture: async () => ({ synthetic: true }),
    }); } finally { proof = item.roundAttention; }
  } };
}
test('synthetic protocol checks typed history, trusted keyboard, single homes and successful settings cleanup', async () => {
  const fixture = protocol();const proof = await fixture.run();assert.equal(proof.status, 'passed');assert.equal(fixture.cleanup(), true);assert.equal(fixture.listeners.size, 0);
});
for (const [label, options] of [['untrusted keyboard click', { untrusted: true }], ['source/head drift', { headDrift: true }], ['changed source words', { changedSource: true }], ['new source acquisition', { extraGet: true }], ['settings cleanup failure', { cleanupFailure: true }]]) test(`synthetic protocol rejects ${label} and cleans up listeners/settings`, async () => {
  const fixture = protocol(options);await assert.rejects(fixture.run());assert.equal(fixture.result().status, 'failed');assert.equal(fixture.cleanup(), true);assert.equal(fixture.listeners.size, 0);
  if (options.cleanupFailure) assert.match(fixture.result().cleanupError, /Synthetic settings restore failure/);
});
