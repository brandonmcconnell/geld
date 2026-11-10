import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Window } from 'happy-dom';
import { tsImport } from 'tsx/esm/api';
import { RENDERED_NOTES_FIXTURE as F } from './gitlab-rendered-notes-acceptance.mjs';
import { beginGitLabAuthorReuseProbe, endGitLabAuthorReuseProbe, gitLabAuthorReuseProbe, verifyGitLabAuthorReuse, verifyGitLabAuthorReuseThemes } from './gitlab-author-reuse-acceptance.mjs';

const { createGitLabAuthorPresentationReader } = await tsImport('../src/gitlab/author-presentation.ts', import.meta.url);
// Node has no CSS renderer. Omit side-effect styles for this structural integration only.
const styles = registerHooks({ load(url, context, nextLoad) {
  const source = new URL(url);
  if (source.protocol === 'file:' && source.pathname.endsWith('.svg') && source.searchParams.has('raw')) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(source, 'utf8'))}`, shortCircuit: true };
  return source.pathname.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
let renderProviderReviewPanel;
try { ({ renderProviderReviewPanel } = await tsImport('../src/providers/review-panel.ts', import.meta.url)); }
finally { styles.deregister(); }
const HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
const SRC = 'https://secure.gravatar.com/avatar/764bc228e577e24c3cff9ebe7f925395da6a6f792e8a5bc76d7517fd5f06d6ff?s=80&d=identicon';

function source(id) { return { id, anchor: `note_${id}`, url: `${F.url}#note_${id}`, author: { id: F.author, login: F.login, automated: true }, body: `Synthetic source body ${id}`, createdAt: '2026-05-25T08:20:46.148Z', updatedAt: '2026-05-26T09:00:41.330Z' }; }
function originalHeader(id = '3381334808') {
  // Reduced actual MR272 summary header/account. Bodies, timestamps and dimensions in these tests
  // are explicitly synthetic protocol inputs, not installed paint or target-header evidence.
  return `<li id="note_${id}" data-note-id="${id}" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-avatar"><a href="/${F.login}" data-user-id="${F.author}" data-username="${F.login}" class="gl-avatar-link js-user-link"><img src="${SRC}" class="gl-avatar gl-avatar-circle gl-avatar-s32" alt="****"></a></div><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a href="/${F.login}" data-user-id="${F.author}" data-username="${F.login}" class="author-name-link js-user-link"><span data-testid="author-name">****</span></a><span class="author-username"><a href="/${F.login}" class="author-username-link"><span class="note-headline-light">@${F.login}</span></a></span><time datetime="2026-05-25T08:20:46.148Z">Original time</time></div><div class="note-actions"><span class="gl-badge badge badge-neutral"><span class="gl-badge-content">Developer</span></span></div></div><div class="note-body"><div class="note-text md">Retained native summary fixture</div></div></div></div></li>`;
}

async function domFixture(run) {
  const window = new Window({ url: F.url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = { document: window.document, location: window.location, window, Element: window.Element, HTMLElement: window.HTMLElement, HTMLDetailsElement: window.HTMLDetailsElement, HTMLImageElement: window.HTMLImageElement, Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window) };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let panel;
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    window.fetch = () => { throw new Error('Author reuse protocol must never fetch.'); };
    window.HTMLElement.prototype.getBoundingClientRect = function () { return new window.DOMRect(0, 0, parseFloat(this.style.width || '200'), parseFloat(this.style.height || '20')); };
    window.HTMLImageElement.prototype.getBoundingClientRect = function () { return new window.DOMRect(0, 0, Number(this.dataset.syntheticWidth ?? parseFloat(this.style.width || '31.5')), Number(this.dataset.syntheticHeight ?? parseFloat(this.style.height || '30.5'))); };
    // Normalize the UA STRONG default while native styles are omitted. This is not font acceptance.
    document.body.innerHTML = '<style>strong { font-weight: inherit; }</style>' + originalHeader();
    const app = document.createElement('article');app.setAttribute('data-rapid-diffs', '');app.setAttribute('data-app-data', JSON.stringify({ mr_path: '/whitebox-aero/whitebox/-/merge_requests/272', project_path: 'whitebox-aero/whitebox', iid: 272, versions: { source_versions: [{ id: 1855648093, latest: true, selected: true, is_merge_head: false, head_sha: HEAD }] } }));document.body.prepend(app);
    const summary = source('3381334808');const findings = F.ids.map(source);
    const input = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: F.iid, headSha: HEAD }, threads: findings.map((comment) => ({ id: `discussion-${comment.id}`, anchor: comment.anchor, url: comment.url, resolved: true, outdated: true, stateKnown: true, comments: [comment] })) };
    const host = document.createElement('section');document.body.append(host);
    panel = renderProviderReviewPanel(host, input, { comments: [summary], authorPresentation: createGitLabAuthorPresentationReader(input, [summary], document) });
    const selected = [summary, ...findings].map((comment) => ({ id: comment.id, url: comment.url, author: { id: F.author, username: F.login, bot: true, userType: 'project_bot' }, createdAt: comment.createdAt, updatedAt: comment.updatedAt, bodySha256: createHash('sha256').update(comment.body).digest('hex'), resolved: true, active: false }));
    const records = F.ids.map((id) => selected.find((record) => record.id === id));
    return await run({ window, records, selected, probe: () => gitLabAuthorReuseProbe(records) });
  } finally {
    delete globalThis.__geldAuthorReuseNative;panel?.destroy();
    for (const [key, descriptor] of previous) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
    await window.happyDOM.abort();
  }
}

function protocol(selected, options = {}) {
  const page = new EventEmitter();const item = {};let opens = 0;let osDark = false;const emulations = [];
  const fixture = { metadata: [{ sha: HEAD, diffHead: HEAD, projectId: F.project, noteableId: F.review, iid: F.iid, webUrl: F.url }], discussions: [{ discussionCount: 36, noteCount: 40, nextCursor: null, selected }], errors: [], providerMutations: [], aiRequests: [] };
  const settings = { aiEnabled: false, enabled: true, trustedReviewAccounts: ['gitlab.com/whitebox-aero/whitebox greptile 37628862'] };
  const readDigest = () => ({ selectedHead: HEAD, items: [...document.querySelectorAll('[data-geld-item]')].map((node) => ({ id: node.dataset.geldItem, state: node.dataset.state })), bots: [], sources: [...document.querySelectorAll('article[data-geld-source-id]')].map((node) => ({ id: node.dataset.geldSourceId, body: node.querySelector('.geld-provider-review__body')?.innerHTML })) });
  const request = (path, extension = false) => ({ method: () => 'GET', url: () => `https://gitlab.com${path}`, initiator: () => extension ? { stack: { callFrames: [{ url: 'chrome-extension://installed/content-scripts/content.js' }] } } : undefined });
  page.url = () => location.href;page.isClosed = () => false;
  window.matchMedia = (query) => ({ matches: query === '(prefers-color-scheme: dark)' && osDark });
  page.emulateMediaFeatures = async (features) => {
    emulations.push(features);
    if (features.length === 0 && options.restoreFailure) throw new Error('Synthetic media restoration failed');
    osDark = features.some((feature) => feature.name === 'prefers-color-scheme' && feature.value === 'dark');
    // Explicit synthetic first-party theme response, not a production class mutation or native-paint claim.
    if ((!options.nativeKeepsLight || features.length === 0) && !(features.length === 0 && options.ignoreRestore)) document.documentElement.classList.toggle('gl-dark', osDark);
    if (document.documentElement.dataset.syntheticTheme !== undefined) syntheticNativeThemeColors();
    if (osDark) options.onDark?.({ fixture, page, request, settings });
    else options.onRestore?.({ fixture, page, request, settings });
  };
  page.evaluate = async (fn, ...args) => {
    const value = fn(...args);
    if (fn === endGitLabAuthorReuseProbe && osDark) {
      if (options.lateThemeChange) { document.documentElement.classList.add('gl-dark');syntheticNativeThemeColors(); }
      if (options.laterPaletteDrift) document.querySelector('[data-testid="author-name"]').style.color = 'rgb(1, 2, 3)';
    }
    if (fn === endGitLabAuthorReuseProbe && options.cleanupFailure) throw new Error('Synthetic post-restoration cleanup failure');
    return value;
  };
  const services = { fixture, head: HEAD, extensionId: 'installed', readDigest, assertSources: (value, previous) => { assert.equal(value.selectedHead, HEAD);if (previous) assert.deepEqual(value.sources, previous.sources); }, readSettings: async () => settings,
    openReviewAncestors: async (_page, selector) => {
      opens += 1;let count = 0;
      for (let node = document.querySelector(selector)?.parentElement; node; node = node.parentElement) if (node instanceof HTMLDetailsElement && !node.open) { node.open = true;count += 1; }
      if (options.onOpen && opens === 1) options.onOpen({ fixture, page, request, settings });
      return count;
    }, poll: async (read, accepts) => { const value = await read();assert.equal(accepts(value), true, `Independent author comparison did not align: ${item.authorReuse?.lastComparisonError}`);return value; }, pause: async () => {},
  };
  const run = () => verifyGitLabAuthorReuse(page, item, services);
  const runThemes = () => verifyGitLabAuthorReuseThemes(page, item, services);
  return { page, item, run, runThemes, fixture, emulations };
}

test('independent DOM oracle consumes the real account reader and shared renderer without inventing finding headers', () => domFixture(async ({ probe, selected }) => {
  const beforeNative = document.getElementById('note_3381334808').outerHTML;
  const before = probe();assert.equal(before.native.name.text, '****');assert.equal(before.native.valid, true);
  for (const finding of before.findings) { assert.equal(finding.nativeCount, 0);assert.equal(finding.invalidAnchorCount, 0);assert.equal(finding.name.text, '****');assert.equal(finding.alias.text, `@${F.login}`);assert.deepEqual(finding.badges, []);assert.equal(finding.avatar.width, 31.5); }
  const details = [...document.querySelectorAll('.geld-provider-review details')].map((node) => [node, node.open]);
  const f = protocol(selected);const proof = await f.run();assert.equal(proof.status, 'passed');assert.equal(proof.comparison.native.sameNode, true);assert.match(proof.scope, /No absent finding native paint/);assert.match(proof.avatarCoverage, /measured mounted native donor/);
  assert.deepEqual(proof.sourceGets, []);assert.equal(proof.cleanup.stateRemoved, true);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
  assert.equal(document.getElementById('note_3381334808').outerHTML, beforeNative);for (const [node, open] of details) assert.equal(node.open, open);
}));

for (const [label, change] of [
  ['wrong name', () => { document.querySelector('article[data-geld-source-id] [data-geld-author-name]').textContent = 'Guessed service'; }],
  ['borrowed badge', () => { const badge = document.createElement('span');badge.dataset.geldAuthorBadge = '';badge.textContent = 'Developer';document.querySelector('article[data-geld-source-id] .geld-provider-review__byline').append(badge); }],
  ['wrong profile', () => { document.querySelector('article[data-geld-source-id] [data-geld-author-profile]').href = 'https://gitlab.com/someone'; }],
  ['wrong source tuple', () => { document.querySelector('article[data-geld-source-id]').dataset.geldSourceId = '1'; }],
  ['copied native ID', () => { document.querySelector('article[data-geld-source-id]').id = `note_${F.ids[0]}`; }],
  ['duplicate donor', () => { document.body.append(document.getElementById('note_3381334808').cloneNode(true)); }],
]) test(`independent oracle fails ${label} without accepting it as unavailable`, () => domFixture(async ({ selected }) => {
  change();const f = protocol(selected);await assert.rejects(f.run());assert.equal(f.item.authorReuse.status, 'failed');assert.equal(f.page.listenerCount('request'), 0);
}));

for (const [label, onOpen] of [
  ['changed body', () => { document.querySelector('article[data-geld-source-id] .geld-provider-review__body').textContent = 'Changed source'; }],
  ['changed API tuple', ({ fixture }) => { fixture.discussions[0].selected[1].bodySha256 = 'a'.repeat(64); }],
  ['head changed', () => { const node = document.querySelector('[data-app-data]');const data = JSON.parse(node.dataset.appData);data.versions.source_versions[0].head_sha = 'b'.repeat(40);node.dataset.appData = JSON.stringify(data); }],
  ['native donor remount', () => { const node = document.getElementById('note_3381334808');node.replaceWith(node.cloneNode(true)); }],
  ['wrong avatar dimensions', () => { document.querySelector('article[data-geld-source-id] [data-geld-author-avatar]').dataset.syntheticWidth = '70'; }],
  ['hidden author', () => { document.querySelector('article[data-geld-source-id] [data-geld-author-name]').hidden = true; }],
  ['recognized source request', ({ page, request }) => { page.emit('request', request('/whitebox-aero/whitebox/-/merge_requests/272/discussions.json')); }],
  ['extension-attributed request', ({ page, request }) => { page.emit('request', request('/api/native-unknown', true)); }],
  ['provider write', ({ fixture }) => { fixture.providerMutations.push({ method: 'POST' }); }],
  ['paid request', ({ fixture }) => { fixture.aiRequests.push('Unwanted AI'); }],
  ['settings changed', ({ settings }) => { settings.enabled = false; }],
]) test(`full phase fails ${label}, retains diagnosis and always releases its listener/state`, () => domFixture(async ({ selected }) => {
  const f = protocol(selected, { onOpen });await assert.rejects(f.run());assert.equal(f.item.authorReuse.status, 'failed');assert.equal(f.item.authorReuse.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

test('a genuine late native finding makes reuse unavailable while malformed copied IDs remain failures', () => domFixture(async ({ selected }) => {
  document.body.insertAdjacentHTML('beforeend', originalHeader(F.ids[0]));
  const f = protocol(selected);const proof = await f.run();assert.equal(proof.status, 'unavailable');assert.match(proof.reason, /finding now has native DOM/);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

test('unknown native traffic is evidence rather than false source attribution', () => domFixture(async ({ selected }) => {
  const f = protocol(selected, { onOpen: ({ page, request }) => page.emit('request', request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json')) });
  const proof = await f.run();assert.equal(proof.status, 'passed');assert.deepEqual(proof.sourceGets, []);assert.equal(proof.otherGets.length, 1);assert.equal(proof.otherGets[0].attribution, 'native_or_unattributed');
}));

test('a successful comparison followed by failed cleanup never retains passed status', () => domFixture(async ({ selected }) => {
  const f = protocol(selected, { cleanupFailure: true });await assert.rejects(f.run(), /post-restoration cleanup failure/);assert.equal(f.item.authorReuse.status, 'failed');assert.match(f.item.authorReuse.cleanupError, /post-restoration/);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

test('a nonmeasurable native avatar stays explicitly uncovered without guessed dimensions', () => domFixture(async ({ selected }) => {
  document.querySelector('#note_3381334808 img').dataset.syntheticWidth = '0';
  const f = protocol(selected);const proof = await f.run();assert.equal(proof.status, 'passed');assert.match(proof.avatarCoverage, /^Unavailable:/);
}));

test('cleanup refuses to restore owned state on another review route while clearing retained references', () => domFixture(async () => {
  beginGitLabAuthorReuseProbe();window.location.href = F.url.replace('/272', '/273');assert.throws(endGitLabAuthorReuseProbe, /navigated/);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));


test('late genuine native mounting is unavailable while a late copied ID fails', () => domFixture(async ({ selected }) => {
  const f = protocol(selected, { onOpen: () => document.body.insertAdjacentHTML('beforeend', originalHeader(F.ids[0])) });
  const proof = await f.run();assert.equal(proof.status, 'unavailable');assert.match(proof.reason, /mounted during comparison/);assert.equal(proof.cleanup.stateRemoved, true);assert.equal(f.page.listenerCount('request'), 0);
}));

test('a late malformed owned ID cannot mask account-reuse failure as fixture unavailability', () => domFixture(async ({ selected }) => {
  const f = protocol(selected, { onOpen: () => { document.querySelector('article[data-geld-source-id]').id = `note_${F.ids[0]}`; } });
  await assert.rejects(f.run());assert.equal(f.item.authorReuse.status, 'failed');assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

function syntheticNativeTheme({ unchangedColors = false } = {}) {
  document.documentElement.classList.add('gl-system');
  document.documentElement.dataset.syntheticTheme = unchangedColors ? 'unchanged' : 'changing';syntheticNativeThemeColors();
}
function syntheticNativeThemeColors() {
  // HappyDOM does not recompute descendant CSS after ancestor-class changes. These explicit test-only
  // effective colors model the native event; the installed helper only reads untouched native styles.
  const dark = document.documentElement.classList.contains('gl-dark') && document.documentElement.dataset.syntheticTheme !== 'unchanged';
  for (const node of document.querySelectorAll('[data-testid="author-name"], [data-geld-author-name]')) if (!node.hasAttribute('data-synthetic-frozen-color')) node.style.color = dark ? 'rgb(236, 236, 239)' : 'rgb(58, 56, 63)';
  for (const node of document.querySelectorAll('.note-headline-light, .geld-provider-review__byline > .geld-provider-review__muted')) node.style.color = dark ? 'rgb(170, 169, 175)' : 'rgb(98, 97, 104)';
}

test('three independent phases compare actual synthetic native color changes and restore the full original signature', () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected);const proof = await f.runThemes();
  assert.equal(proof.status, 'passed');assert.equal(proof.nativeThemeChanged, true);assert.equal(proof.darkAcceptance, 'native_scheme_observed');
  assert.equal(f.item.authorReuse, proof.phases.light);assert.deepEqual(Object.keys(proof.phases), ['light', 'dark', 'restored']);
  for (const phase of Object.values(proof.phases)) { assert.equal(phase.status, 'passed');assert.equal(phase.listenerDisposed, true);assert.equal(phase.cleanup.stateRemoved, true);assert.equal(phase.comparison.native.sameNode, true);assert.equal(phase.comparison.native.sameThemeNode, true); }
  assert.notEqual(proof.phases.light.comparison.native.name.typography.color, proof.phases.dark.comparison.native.name.typography.color);
  assert.deepEqual(proof.phases.light.comparison.findings.map((finding) => finding.sourceTuple), proof.phases.dark.comparison.findings.map((finding) => finding.sourceTuple));
  assert.deepEqual(proof.phases.light.comparison.native.name, proof.phases.restored.comparison.native.name);
  assert.equal(proof.mediaCleared, true);assert.equal(proof.mediaRestored, true);assert.deepEqual(proof.cleanup, { stateRemoved: true, sameNative: true });assert.equal(proof.listenerDisposed, true);
  assert.deepEqual(f.emulations, [[{ name: 'prefers-color-scheme', value: 'dark' }], []]);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseThemesNative, undefined);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

for (const options of [{ nativeKeepsLight: true }, { unchangedColors: true }]) test(`OS preference or gl-dark class alone cannot earn native dark acceptance: ${JSON.stringify(options)}`, () => domFixture(async ({ selected }) => {
  syntheticNativeTheme(options);const f = protocol(selected, options);const proof = await f.runThemes();assert.equal(proof.status, 'unavailable');assert.equal(proof.darkAcceptance, 'unavailable');assert.equal(proof.nativeThemeChanged, false);assert.equal(proof.phases.dark.status, 'passed');assert.equal(proof.phases.restored.status, 'passed');assert.equal(proof.mediaRestored, true);assert.equal(proof.listenerDisposed, true);
}));

test('a frozen owned light color fails the dark comparison while media, phase listeners and disclosures still restore', () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const node = document.querySelector('article [data-geld-author-name]');node.dataset.syntheticFrozenColor = '';
  const f = protocol(selected);await assert.rejects(f.runThemes());const proof = f.item.authorReuseThemes;
  assert.equal(proof.status, 'failed');assert.equal(proof.phases.light.status, 'passed');assert.equal(proof.phases.dark.status, 'failed');assert.equal(proof.phases.restored.status, 'passed');assert.equal(proof.mediaRestored, true);assert.equal(proof.cleanup.stateRemoved, true);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseThemesNative, undefined);
}));

test('a light phase comparison followed by a later native dark change cannot earn dark acceptance', () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected, { nativeKeepsLight: true, lateThemeChange: true });await assert.rejects(f.runThemes(), /Later theme evidence differs/);
  const proof = f.item.authorReuseThemes;assert.equal(proof.status, 'failed');assert.equal(proof.phases.dark.status, 'passed');assert.equal(proof.phases.dark.comparison.theme.dark, false);assert.equal(proof.darkMeasurement.theme.dark, true);assert.equal(proof.nativeThemeChanged, false);assert.notEqual(proof.darkAcceptance, 'native_scheme_observed');assert.equal(proof.phases.restored.status, 'passed');assert.equal(proof.mediaRestored, true);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);
}));

test('a later changed native palette cannot replace the validated dark comparison even when gl-dark remains selected', () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected, { laterPaletteDrift: true });await assert.rejects(f.runThemes(), /Later theme evidence differs/);
  const proof = f.item.authorReuseThemes;assert.equal(proof.status, 'failed');assert.equal(proof.phases.dark.comparison.theme.dark, true);assert.equal(proof.darkMeasurement.theme.dark, true);assert.equal(proof.phases.restored.status, 'passed');assert.equal(proof.mediaRestored, true);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);
}));

for (const [label, onDark] of [
  ['donor remount between phases', () => { const node = document.getElementById('note_3381334808');node.replaceWith(node.cloneNode(true)); }],
  ['native selected head drift', () => { const node = document.querySelector('[data-app-data]');const value = JSON.parse(node.dataset.appData);value.versions.source_versions[0].head_sha = 'b'.repeat(40);node.dataset.appData = JSON.stringify(value); }],
  ['source acquisition in the transition gap', ({ page, request }) => { page.emit('request', request('/whitebox-aero/whitebox/-/merge_requests/272/discussions.json')); }],
  ['settings drift across phases', ({ settings }) => { settings.enabled = false; }],
  ['source fingerprint drift across phases', ({ fixture }) => { fixture.discussions[0].selected[1].bodySha256 = 'b'.repeat(64); }],
]) test(`theme wrapper fails ${label} instead of accepting independent phases in a changed context`, () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected, { onDark });await assert.rejects(f.runThemes());const proof = f.item.authorReuseThemes;assert.equal(proof.status, 'failed');assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseThemesNative, undefined);assert.equal(globalThis.__geldAuthorReuseNative, undefined);
}));

test('incidental transition JSON retains unknown attribution without becoming a zero-HTTP or native-source claim', () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected, { onDark: ({ page, request }) => page.emit('request', request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json')) });const proof = await f.runThemes();assert.equal(proof.status, 'passed');assert.deepEqual(proof.sourceGets, []);assert.equal(proof.otherGets.length, 1);assert.equal(proof.otherGets[0].attribution, 'native_or_unattributed');assert.deepEqual(proof.phases.dark.otherGets, []);
}));

for (const options of [{ restoreFailure: true }, { ignoreRestore: true }]) test(`failed media or native-signature restoration cannot retain a successful dark status: ${JSON.stringify(options)}`, () => domFixture(async ({ selected }) => {
  syntheticNativeTheme();const f = protocol(selected, options);await assert.rejects(f.runThemes());const proof = f.item.authorReuseThemes;assert.equal(proof.status, 'failed');assert.equal(proof.phases.dark.status, 'passed');assert.ok(proof.restorationError);assert.equal(proof.mediaRestored, false);assert.equal(proof.listenerDisposed, true);assert.equal(f.page.listenerCount('request'), 0);assert.equal(globalThis.__geldAuthorReuseThemesNative, undefined);
}));
