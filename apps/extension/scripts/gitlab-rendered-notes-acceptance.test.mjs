import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Window } from 'happy-dom';
import { tsImport } from 'tsx/esm/api';
import { RENDERED_NOTES_FIXTURE as F, captureGitLabRenderedNote, gitLabRenderedNotesProbe, verifyGitLabRenderedNotes } from './gitlab-rendered-notes-acceptance.mjs';

const { renderGitLabComment } = await tsImport('../src/gitlab/comment-render.ts', import.meta.url);
const HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
// Reduced observed finding formats. The full same-response raw/native corpus is covered by rendered-notes.test.ts.
const html = [
  '<p dir="auto"><a href="#"><img alt="P2" src="data:image/gif;base64,AA==" data-src="https://user-content.gitlab-static.net/badge"></a> Using a branch name as <code>rev</code> makes the entry point at a mutable ref.</p>\n<div class="gl-relative markdown-code-block js-markdown-code"><pre class="code highlight js-syntax-highlight language-suggestion"><code class="js-render-suggestion"><span id="LC1" class="line">insta360 = {rev = "8d6fdc4acb176faf2b4449f5be90af59d4390372"}</span></code></pre></div>',
  '<p dir="auto"><a href="#"><img alt="P2" src="data:image/gif;base64,AA=="></a> <strong>Implementation not visible in this PR\'s diff</strong></p>\n<p dir="auto">The implementation lives in the <code>insta360</code> package.</p>',
  '<p dir="auto"><a href="#"><img alt="P1" src="data:image/gif;base64,AA=="></a> <strong>Missing transitive dependency for git-sourced plugin</strong></p>\n<p dir="auto">The old <code>whitebox-plugin-device-insta360 0.1.28</code> entry declared the dependency.</p>',
];
function nativeNote(index = 0) {
  const id = F.ids[index];
  return { id: Number(id), note: `<a href="#"><img alt="P2" src="https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg"></a> Raw finding ${id} with \`rev\`.`, note_html: html[index],
    noteable_type: 'MergeRequest', noteable_id: Number(F.review), noteable_iid: Number(F.iid), project_id: Number(F.project), system: false,
    author: { id: Number(F.author), username: F.login, bot: true, user_type: 'project_bot' }, noteable_note_url: `${F.url}#note_${id}`,
    created_at: '2026-05-25T08:20:46.148Z', updated_at: '2026-05-26T09:00:41.330Z' };
}
function records() { return F.ids.map((_, index) => captureGitLabRenderedNote(nativeNote(index))); }

test('independent capture binds rendered HTML to the observed native tuple while hashing raw semantics separately', () => {
  const note = nativeNote();const value = captureGitLabRenderedNote(note);
  assert.equal(value.status, 'available');assert.equal(value.bodySha256, createHash('sha256').update(note.note).digest('hex'));assert.equal(value.htmlSha256, createHash('sha256').update(note.note_html).digest('hex'));
  assert.equal(value.html, note.note_html);assert.equal(value.url, note.noteable_note_url);assert.equal(captureGitLabRenderedNote({ ...note, id: '3381334808' }), null);
});
for (const [label, patch] of [
  ['wrong project', { project_id: 1 }], ['wrong MR', { noteable_id: 1 }], ['wrong IID', { noteable_iid: 1 }], ['wrong native type', { noteable_type: 'Issue' }],
  ['system note', { system: true }], ['wrong author', { author: { id: 1, username: F.login, bot: true, user_type: 'project_bot' } }],
  ['renamed account', { author: { id: Number(F.author), username: 'greptile', bot: true, user_type: 'project_bot' } }],
  ['foreign permalink', { noteable_note_url: 'https://elsewhere.invalid/#note_3381334872' }], ['missing raw body', { note: undefined }],
  ['invalid date', { updated_at: 'not a native timestamp' }], ['missing HTML', { note_html: undefined }], ['oversized HTML', { note_html: 'x'.repeat(256 * 1024 + 1) }],
]) test(`independent capture marks ${label} unavailable instead of inventing a source`, () => {
  const value = captureGitLabRenderedNote({ ...nativeNote(), ...patch });assert.equal(value.status, 'unavailable');assert.ok(value.reason);
});

async function domFixture(run) {
  const window = new Window({ url: F.url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = { document: window.document, location: window.location, Element: window.Element, HTMLElement: window.HTMLElement, Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window) };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    // Synthetic protocol geometry only. Installed presentation remains a separate acceptance result.
    window.Element.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 300, 20);
    document.body.innerHTML = `<div id="js-vue-mr-discussions" data-noteable-type="MergeRequest" data-noteable-data='{"diff_head_sha":"${HEAD}"}'></div><section class="geld-provider-review"></section>`;
    const values = records();
    for (const [index, record] of values.entries()) {
      const row = document.createElement('article');row.className = 'geld-provider-review__source';row.dataset.geldSource = `note_${record.id}`;
      const byline = document.createElement('div');byline.className = 'geld-provider-review__byline';const link = document.createElement('a');link.href = record.url;byline.append(link);
      const body = document.createElement('div');body.className = 'geld-provider-review__body';row.append(byline, body);document.querySelector('section').append(row);
      const note = nativeNote(index);const comment = { id: record.id, anchor: `note_${record.id}`, url: record.url, body: note.note, createdAt: record.createdAt, updatedAt: record.updatedAt, author: { id: F.author, login: F.login, automated: true } };
      assert.equal(renderGitLabComment(comment, body, document, { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: F.iid, headSha: HEAD }, projectId: F.project, noteableId: F.review, comment, html: record.html }), true);
    }
    return await run({ window, values, probe: () => gitLabRenderedNotesProbe(values) });
  } finally {
    for (const [key, descriptor] of previous) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
    await window.happyDOM.abort();
  }
}

test('independent inert semantics match the real product renderer without copying controls or loading badge resources', () => domFixture(async ({ probe }) => {
  const value = probe();assert.equal(value.panelCount, 1);
  for (const finding of value.findings) {
    assert.deepEqual(finding.actual, finding.expected);assert.equal(finding.nativeCount, 0);assert.equal(finding.apiRootCount, 1);assert.equal(finding.presented, true);assert.equal(finding.resourcesOrControls, 0);assert.equal(finding.literalBadgeHtml, false);
  }
  assert.ok(value.findings[0].expected.pre.length > 0);assert.equal(value.findings[0].expected.inlineCode[0], 'rev');assert.ok(value.findings[1].expected.emphasis[0].text.includes('Implementation not visible'));
}));

test('DOM probe reports wrong code, raw fallback, duplicate API homes, hidden ancestors and native late mounts', () => domFixture(async ({ probe }) => {
  const first = document.querySelector('article');first.querySelector('p code').textContent = 'different ref';assert.notDeepEqual(probe().findings[0].actual, probe().findings[0].expected);
  const body = first.querySelector('.geld-provider-review__body');body.replaceChildren(document.createTextNode(nativeNote().note));let value = probe().findings[0];assert.equal(value.apiRootCount, 0);assert.equal(value.literalBadgeHtml, true);
  const next = document.querySelectorAll('article')[1];const root = next.querySelector('[data-geld-rendered-source]');root.parentElement.append(root.cloneNode(true));assert.equal(probe().findings[1].apiRootCount, 2);
  document.querySelectorAll('article')[2].style.opacity = '0';assert.equal(probe().findings[2].presented, false);
  const original = document.createElement('div');original.id = `note_${F.ids[0]}`;document.body.append(original);assert.equal(probe().findings[0].nativeCount, 0);assert.equal(probe().findings[0].invalidAnchorCount, 1);
}));

function mountNativeFinding() {
  const root = document.createElement('div');root.id = `note_${F.ids[0]}`;root.dataset.testid = 'noteable-note-container';
  root.innerHTML = `<div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="${F.author}" data-username="${F.login}">Greptile</a></div></div><div class="note-body"><div class="note-text md"><p>Native source</p></div></div></div></div>`;
  document.body.append(root);return root;
}
async function verifyActualDom(values, item) {
  const page = new EventEmitter();page.url = () => F.url;page.evaluate = async (fn, ...args) => fn(...args);
  const digest = { selectedHead: HEAD, items: [{ id: 'same-native-item', state: 'resolved' }], bots: [{ id: 'greptile', state: 'clean' }] };
  try {
    return await verifyGitLabRenderedNotes(page, item, { fixture: { metadata: [{ sha: HEAD, diffHead: HEAD, projectId: F.project, noteableId: F.review, iid: F.iid, webUrl: F.url }], discussions: [{ discussionCount: 36, noteCount: 40, nextCursor: null, selected: values.map((rendered) => ({ id: rendered.id, rendered })) }], errors: [], providerMutations: [], aiRequests: [] },
      head: HEAD, extensionId: 'installed', readDigest: async () => digest, assertSources: (value) => assert.equal(value.selectedHead, HEAD), readSettings: async () => ({ aiEnabled: false, trustedReviewAccounts: ['gitlab.com/whitebox-aero/whitebox greptile 37628862'] }),
      openReviewAncestors: async () => 0, poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value));return value; }, capture: async () => ({}) });
  } finally { assert.equal(page.listenerCount('request'), 0); }
}

test('only an independently bound unique native header/body outside owned content can make the phase unavailable', () => domFixture(async ({ values, probe }) => {
  mountNativeFinding();const finding = probe().findings[0];assert.equal(finding.nativeCount, 1);assert.equal(finding.invalidAnchorCount, 0);
  const item = {};assert.equal((await verifyActualDom(values, item)).status, 'unavailable');
}));

for (const shape of ['owned root ID', 'owned fake native header', 'unbound native root', 'wrong native author', 'duplicate native roots', 'native plus owned copied ID', 'native plus owned resource']) test(`actual probe cannot mask ${shape} as fixture unavailability`, () => domFixture(async ({ values, probe }) => {
  const owned = document.querySelector('[data-geld-rendered-source="api"]');
  if (shape === 'owned root ID') owned.id = `note_${F.ids[0]}`;
  else if (shape === 'owned fake native header') owned.append(mountNativeFinding());
  else if (shape === 'unbound native root') { const node = document.createElement('div');node.id = `note_${F.ids[0]}`;node.dataset.testid = 'noteable-note-container';document.body.append(node); }
  else {
    const native = mountNativeFinding();
    if (shape === 'wrong native author') native.querySelector('.author-name-link').setAttribute('data-user-id', '999');
    if (shape === 'duplicate native roots') document.body.append(native.cloneNode(true));
    if (shape === 'native plus owned copied ID') owned.id = `note_${F.ids[0]}`;
    if (shape === 'native plus owned resource') { const image = document.createElement('img');image.alt = 'Copied control resource';owned.append(image); }
  }
  const finding = probe().findings[0];assert.ok(finding.invalidAnchorCount > 0 || finding.resourcesOrControls > 0);
  const item = {};await assert.rejects(verifyActualDom(values, item));assert.equal(item.renderedFindings.status, 'failed');assert.equal(item.renderedFindings.listenerDisposed, true);
}));

// Explicit synthetic browser protocol: no browser traffic, authenticated actions or native pixels are inferred.
function protocol(options = {}) {
  const page = new EventEmitter();const item = {};const values = records();let reads = 0;let captures = 0;let opens = 0;
  const fixture = { metadata: [{ sha: HEAD, diffHead: HEAD, projectId: F.project, noteableId: F.review, iid: F.iid, webUrl: F.url }], discussions: [{ discussionCount: 36, noteCount: 40, nextCursor: null, selected: values.map((rendered) => ({ id: rendered.id, bodySha256: rendered.bodySha256, resolved: true, active: false, rendered })) }], errors: [], providerMutations: [], aiRequests: [], commandSourceGets: [{ old: 'must not be counted as phase traffic' }] };
  if (options.missingRecord) fixture.discussions[0].selected.pop();
  if (options.invalidHtml) fixture.discussions[0].selected[0].rendered = { status: 'unavailable', reason: 'Rendered HTML unavailable' };
  if (options.wrongMetadata) fixture.metadata[0].projectId = '1';
  const settings = { enabled: true, aiEnabled: false, trustedReviewAccounts: ['gitlab.com/whitebox-aero/whitebox greptile 37628862'], untouched: 'retained' };
  const digest = () => ({ selectedHead: reads > 1 && options.headChanged ? 'b'.repeat(40) : HEAD, sources: [{ id: F.ids[0], body: 'Same raw-source projection', status: 'resolved', outdated: true }], items: [{ id: 'ri_observed', state: 'resolved', sources: F.ids.map((id) => `note_${id}`) }], bots: [{ id: 'greptile', state: reads > 1 && options.verdictChanged ? 'unknown' : 'clean' }] });
  const sample = () => ({ url: F.url, panelCount: 1, findings: values.map((record, index) => {
    const semantics = { text: `P2 Finding ${record.id}`, paragraphs: [`P2 Finding ${record.id}`], inlineCode: ['rev'], pre: index === 0 && !options.fixturePreMissing ? ['exact suggestion'] : [], emphasis: index > 0 ? [{ tag: 'strong', text: 'Actual title' }] : [] };
    return { id: record.id, nativeCount: options.nativePresent || options.nativeLate && reads > 1 ? 1 : 0, invalidAnchorCount: options.copiedId ? 1 : 0, articleCount: 1, apiRootCount: options.missingApi && index === 0 ? 0 : 1,
      expected: semantics, actual: options.wrongSemantics && index === 0 ? { ...semantics, inlineCode: ['wrong ref'] } : semantics,
      oracleUnsupported: false, presented: !options.hidden, permalinks: [record.url], literalBadgeHtml: !!options.literalHtml, resourcesOrControls: options.resource ? 1 : 0 };
  }) });
  page.url = () => reads > 1 && options.navigation ? F.url.replace('/272', '/273') : F.url;
  page.evaluate = async () => { reads += 1;return sample(); };
  const observed = (path) => ({ method: () => 'GET', url: () => `https://gitlab.com${path}` });
  const run = () => verifyGitLabRenderedNotes(page, item, { fixture, head: HEAD, extensionId: 'installed', readDigest: async () => digest(),
    assertSources: (value, previous) => { assert.equal(value.selectedHead, HEAD);if (previous) assert.deepEqual(value.sources, previous.sources); }, readSettings: async () => ({ ...settings, ...(reads > 1 && options.bindingChanged ? { trustedReviewAccounts: [] } : {}) }),
    openReviewAncestors: async () => {
      opens += 1;
      if (options.sourceGet) page.emit('request', observed('/whitebox-aero/whitebox/-/merge_requests/272/discussions.json'));
      if (options.incidental) page.emit('request', observed('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json'));
      if (options.sourceChanged) fixture.discussions[0].selected[0].bodySha256 = 'changed';
      if (options.mutation) fixture.providerMutations.push({ method: 'POST' });
      if (options.ai) fixture.aiRequests.push('AI requested');
      return 2;
    }, poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value), 'Required independent rendered semantics absent');return value; },
    capture: async () => { captures += 1;if (options.captureFailure) throw new Error('Capture failed');return { screenshot: 'installed-only.png' }; },
  });
  return { page, item, run, opens: () => opens, captures: () => captures };
}

test('protocol preserves source/head/item/verdict snapshots, uses separate phase traffic, captures and disposes listener', async () => {
  const f = protocol();const proof = await f.run();assert.equal(proof.status, 'passed');assert.equal(f.opens(), 3);assert.equal(f.captures(), 1);
  assert.deepEqual(proof.beforeDigest, proof.afterDigest);assert.deepEqual(proof.beforeCapture, proof.afterCapture);assert.deepEqual(proof.sourceGets, []);assert.deepEqual(proof.otherGets, []);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);
});
for (const [label, options] of [['missing source record', { missingRecord: true }], ['missing captured HTML', { invalidHtml: true }], ['changed fixture no longer contains a suggestion PRE', { fixturePreMissing: true }], ['mounted native original', { nativePresent: true }], ['native mounting during probe', { nativeLate: true }]]) test(`${label} is explicitly unavailable, never an API-rendering pass`, async () => {
  const f = protocol(options);const value = await f.run();assert.equal(value.status, 'unavailable');assert.ok(value.reason);assert.equal(f.captures(), 0);assert.equal(f.page.listenerCount('request'), 0);
});
for (const [label, options] of [
  ['known-absent missing API body', { missingApi: true }], ['wrong inline code', { wrongSemantics: true }], ['raw literal badge HTML', { literalHtml: true }], ['hydrated resource/control', { resource: true }], ['hidden API body', { hidden: true }],
  ['source edited', { sourceChanged: true }], ['head changed', { headChanged: true }], ['verdict changed', { verdictChanged: true }], ['binding changed', { bindingChanged: true }], ['route changed', { navigation: true }],
  ['wrong metadata project', { wrongMetadata: true }], ['recognized acquisition', { sourceGet: true }], ['native write', { mutation: true }], ['paid request', { ai: true }], ['capture failure', { captureFailure: true }],
  ['owned copied ID despite mounted native source', { nativePresent: true, copiedId: true }], ['owned resource despite mounted native source', { nativePresent: true, resource: true }],
]) test(`protocol fails ${label}, retaining samples and releasing its own listener`, async () => {
  const f = protocol(options);await assert.rejects(f.run());assert.equal(f.item.renderedFindings.status, 'failed');assert.equal(f.item.renderedFindings.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);
  if (options.missingApi || options.wrongSemantics) assert.equal(f.item.renderedFindings.samples.length, 1);
});

test('incidental phase traffic is retained as unknown, without turning it into native attribution or a zero-HTTP claim', async () => {
  const f = protocol({ incidental: true });const value = await f.run();assert.equal(value.status, 'passed');assert.deepEqual(value.sourceGets, []);assert.equal(value.otherGets.length, 3);assert.ok(value.otherGets.every((record) => record.attribution === 'native_or_unattributed'));
});
