import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { BITBUCKET_COMMIT_LIST, BITBUCKET_COMMIT_LINK_SETTINGS, commitLinkFilteredRows, bitbucketCommitLinksSnapshot, bitbucketCommitLinkState, commitLinkSettingsScope, verifyBitbucketCommitLinks } from './bitbucket-commit-links.mjs';
import { createBitbucketCommitOracle } from './bitbucket-commit-oracle.mjs';

const KNOWN = '9777bca47119a91758bde1209ac14e6076ffbf23';
const OTHER = 'a'.repeat(40);
const link = (ref = OTHER, attrs = '') => `<a href="/atlassian/bitbucket-upload-file/commits/${ref}" ${attrs}>${ref.slice(0, 8)}</a>`;
const keys = ['document', 'location', 'getComputedStyle', 'innerWidth', 'innerHeight'];
const globals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let window;
beforeEach(() => {
  window = new Window({ url: BITBUCKET_COMMIT_LIST });
  for (const [key, value] of Object.entries({ document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1024, innerHeight: 768 })) Object.defineProperty(globalThis, key, { configurable: true, value });
});
afterEach(() => {
  delete globalThis.__geldCommitLinksProof;
  for (const [key, descriptor] of globals) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
  window.happyDOM.abort();
});

function geometry() {
  const anchors = [...document.querySelectorAll('a')];
  // Explicit unit-only geometry. No browser-native layout or trusted input is claimed by these tests.
  for (const [index, anchor] of anchors.entries()) anchor.getBoundingClientRect = () => ({ left: 100, top: 120 + index * 25, width: 100, height: 20 });
  document.elementFromPoint = (x, y) => anchors.find((anchor) => { const rect = anchor.getBoundingClientRect();return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height; }) ?? document.body;
}

test('selects the actually observed known commit within a native semantic surface and creates no marker or node', () => {
  document.body.innerHTML = `<nav>${link(KNOWN)}</nav><main><table><tbody><tr><td>${link(OTHER)}</td></tr><tr><td>${link(KNOWN.slice(0, 12), 'id="known"')}</td></tr></tbody></table></main>`;
  geometry();const before = document.body.innerHTML;
  const snapshot = bitbucketCommitLinksSnapshot();
  assert.equal(snapshot.selected.ref, KNOWN.slice(0, 12));assert.equal(document.querySelector(snapshot.selected.selector), document.getElementById('known'));
  assert.equal(snapshot.links.length, 2);assert.equal(document.body.innerHTML, before);
});

test('prefers a real full SHA when the known fixture is absent without guessing or navigating to it', () => {
  document.body.innerHTML = `<div role="main">${link('b'.repeat(12))}${link(OTHER, 'id="full"')}</div>`;geometry();
  assert.equal(document.querySelector(bitbucketCommitLinksSnapshot().selected.selector), document.getElementById('full'));
});

for (const wrapper of ['div data-geld-ui', 'form', 'div role="dialog"', 'div role="tooltip"', 'div popover', 'div contenteditable="true"', 'nav', 'aside', 'header']) test(`excludes a native-looking link inside ${wrapper}`, () => {
  document.body.innerHTML = `<main><${wrapper}>${link(KNOWN)}</${wrapper.split(' ')[0]}></main>`;geometry();
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
});

for (const attrs of ['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="opacity:0"']) test(`does not select a concealed original link under ${attrs}`, () => {
  document.body.innerHTML = `<main><div ${attrs}>${link(KNOWN)}</div></main>`;geometry();
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
});

test('requires actual viewport ownership and declines unknown surfaces or changed routes', () => {
  document.body.innerHTML = `<main>${link()}</main>`;geometry();document.elementFromPoint = () => document.body;
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
  document.body.innerHTML = `<div>${link()}</div>`;geometry();assert.equal(bitbucketCommitLinksSnapshot().selected, null);
  window.history.replaceState(null, '', '/atlassian/bitbucket-upload-file/commits/' + OTHER);
  assert.match(bitbucketCommitLinksSnapshot().unavailable, /route changed/);
});

test('refuses another repository, credentials, query/hash variants and invalid commit lengths', () => {
  document.body.innerHTML = `<main>${link('a'.repeat(41))}<a href="https://evil.example/atlassian/bitbucket-upload-file/commits/${OTHER}">external</a><a href="https://user:secret@bitbucket.org/atlassian/bitbucket-upload-file/commits/${OTHER}">credential</a><a href="/another/repo/commits/${OTHER}">other</a><a href="/atlassian/bitbucket-upload-file/commits/${OTHER}?topic=true">query</a><a href="/atlassian/bitbucket-upload-file/commits/${OTHER}#note">fragment</a></main>`;geometry();
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
});

test('reports complete original text/parent identity and native ARIA associations separately from Geld', () => {
  document.body.innerHTML = `<main>${link()}</main><div id="native-tip" role="tooltip">Native card</div>`;
  const node = document.querySelector('a');const parent = node.parentElement;
  globalThis.__geldCommitLinksProof = { node, parent, selector: 'main a', text: node.textContent, events: [] };
  node.setAttribute('aria-describedby', 'native-tip geld-provider-count-tooltip');
  assert.equal(bitbucketCommitLinkState().sameText, true);assert.equal(bitbucketCommitLinkState().nativeCards.length, 1);
  node.append('Changed source');assert.equal(bitbucketCommitLinkState().sameText, false);
});

function protocol(options = {}) {
  const selected = { selector: 'main > table > tbody > tr > td > a', href: `${BITBUCKET_COMMIT_LIST}${OTHER}`, raw: `${BITBUCKET_COMMIT_LIST}${OTHER}`, ref: OTHER, text: 'Actual native commit' };
  const oracle = createBitbucketCommitOracle();
  oracle.observe(`https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/commit/${OTHER}`, { hash: OTHER });
  if (!options.incomplete) oracle.observe(`https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/diffstat/${OTHER}?pagelen=100`, { size: 2, values: [{ new: { path: options.noReadme ? 'other.md' : 'README.md' }, lines_added: 2, lines_removed: 1 }, { new: { path: 'pipe/pipe.py' }, lines_added: 3, lines_removed: 0 }] });
  const events = [];const calls = [];const keyboard = [];let focused = false;let dismissed = false;let shift = false;let cleanups = 0;let listener = null;let writes = 0;
  const original = { enabled: true, aiEnabled: false, categories: {}, autoViewed: {}, ...(options.patternsAbsent ? {} : { categoryPatterns: { generated: ['preserved/**'] } }) };
  let saved = structuredClone(original);
  const actualURL = options.canonical ? `${BITBUCKET_COMMIT_LIST}branch/master` : BITBUCKET_COMMIT_LIST;
  const branch = options.canonical ? { selector: '[data-testid="ref-selector-trigger"]', label: 'Filter by ref: master', text: 'master' } : null;
  const state = () => ({ url: calls.length > 0 && options.navigation ? options.navigation : actualURL, branch: branch === null ? null : { ...branch, unique: true, sameNode: !options.branchReplaced || calls.length === 0, sameParent: true, label: calls.length > 0 && options.branchChanged ? 'Filter by ref: another' : branch.label }, sameNode: !options.replaced || calls.length === 0, sameParent: true, sameText: !options.changedText || calls.length === 0, href: selected.href, raw: selected.raw, text: selected.text, focused: options.missingFocus ? undefined : focused, activeElement: { tag: focused ? 'A' : 'TH', href: focused ? selected.raw : null }, events: [...events], nativeCards: [] });
  const page = {
    isClosed: () => false,
    keyboard: {
      down: async (key) => { assert.equal(key, 'Shift');keyboard.push('Shift down');shift = true; },
      press: async (key) => {
        assert.equal(key, 'Tab');assert.equal(shift, true);keyboard.push('Tab');
        if (options.departureThrows) throw new Error('Keyboard departure failed');
        if (!options.noDeparture) { focused = false;dismissed = false; }
        if (!options.noFocusout) events.push({ type: 'focusout', trusted: !options.untrustedFocusout });
        if (options.departureNavigation) options.navigation = `${actualURL}?changed=1`;
        if (options.departureReplacement) options.replaced = true;
        if (options.departureRefChange) options.branchChanged = true;
      },
      up: async (key) => { assert.equal(key, 'Shift');keyboard.push('Shift up');shift = false; },
    },
    on: (_type, fn) => { listener = fn; }, off: (_type, fn) => { assert.equal(listener, fn);listener = null; },
    evaluate: async (fn) => {
      if (fn === bitbucketCommitLinksSnapshot) return { actualURL, branch, selected: options.noFixture ? null : selected, links: [] };
      if (fn === bitbucketCommitLinkState) return state();
      if (fn.toString().includes('delete globalThis')) cleanups += 1;
      if (fn.toString().includes('events.length = 0')) events.length = 0;
    },
  };
  const item = {};
  const run = () => verifyBitbucketCommitLinks(page, item, { oracle, extensionId: 'installed',
    readSettings: async () => structuredClone(saved),
    writeSettings: async (value) => { writes += 1;saved = structuredClone(value);if (writes === 1 && options.writeFailure) throw new Error('Pattern write failed');if (writes === 2 && options.restoreFailure) throw new Error('Pattern restore failed');if (writes === 2 && options.restoreMismatch) saved.categoryPatterns = { tests: ['wrong/**'] }; },
    guardBudget: () => ({ available: !options.budget && !(options.filteredBudget && writes > 0), remaining: options.budget || options.filteredBudget && writes > 0 ? 7 : 12, minimumReserve: 8 }),
    poll: async (read, accept, label) => { const value = await read();assert.ok(accept(value), label);return value; },
    installedHover: async (_page, selector, input, _name, _anchor, config) => {
      assert.equal(selector, selected.selector);assert.equal(config.verifyUnobscured, true);calls.push(input);
      if (options.nativeCard) throw new Error('Native card retained ownership. Count popup not observed.');
      // Explicit protocol simulation of the product's existing Escape/focus lifecycle;
      // these unit event records make no installed-browser trusted-input claim.
      if (input === 'pointer' && dismissed && focused) throw new Error('Escape dismissal remains while the source keeps focus');
      if (input === 'keyboard') { focused = true;dismissed = true; }

      events.push({ type: input === 'pointer' ? 'mouseover' : 'focusin', trusted: !options.untrusted && !(options.filteredUntrusted && writes > 0) });
      const filtered = saved.categoryPatterns?.tests?.[0] === 'README.md';
      const phase = writes === 0 ? 'baseline' : filtered ? 'filtered' : 'restored';
      const rows = [
        { label: 'Essential', files: filtered ? '1 file' : '2 files', additions: filtered ? '+3' : '+5', deletions: filtered ? '−0' : '−1' },
        { label: 'Tests', files: filtered ? '1 file' : '0 files', additions: filtered ? '+2' : '+0', deletions: filtered ? '−1' : '−0' },
        { label: 'Total', files: '2 files', additions: '+5', deletions: '−1' },
      ];
      if (input === 'pointer' && options.wrongPointer || input === 'keyboard' && options.wrongKeyboard || options.wrongPhase === phase) rows[0].additions = '+99';
      if (options.wrongTests && filtered) rows[1].deletions = '−0';
      if (options.filteredNavigation && filtered) options.navigation = `${actualURL}?changed=1`;
      if (options.sourceDrift && filtered) oracle.observe(`https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/commit/${OTHER}`, { hash: 'b'.repeat(40) });
      if (listener && options.sourceRequest) listener({ url: () => `https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/diffstat/${OTHER}`, method: () => 'GET', initiator: () => options.sourceRequest === 'extension' ? { stack: { callFrames: [{ url: 'chrome-extension://installed/content-scripts/bitbucket.js' }] } } : undefined });
      if (phase !== 'baseline') assert.ok(config.expectedRows, 'Filtered/restored waits must bind actual row expectations');
      return { rows, described: true, escapeDismissed: true,
        visibility: { beforeScreenshot: { unobscured: !options.occluded }, afterScreenshot: { unobscured: true } },
        ...(input === 'keyboard' ? { keyboardNavigation: { started: true, stops: [{ target: !options.missedTab }] } } : {}),
      };
    },
  });
  return { run, item, calls, keyboard, original, saved: () => saved, listener: () => listener, writes: () => writes, cleanups: () => cleanups };
}

test('protocol requires the original trusted pointer and real Tab path against its independent complete response oracle', async () => {
  const f = protocol();assert.equal((await f.run()).status, 'passed');
  assert.deepEqual(f.calls, ['pointer', 'keyboard', 'pointer', 'keyboard', 'pointer', 'keyboard']);assert.equal(f.item.commitLinks.oracle.sha, OTHER);assert.equal(f.cleanups(), 1);
});

for (const [name, options] of [['unknown layout', { noFixture: true }], ['source reserve', { budget: true }], ['incomplete source', { incomplete: true }], ['native card ownership', { nativeCard: true }]]) test(`${name} remains unavailable without an oracle GET or second candidate`, async () => {
  const f = protocol(options);assert.equal((await f.run()).status, 'unavailable');
  assert.equal(f.calls.includes('keyboard'), false);
  if (options.noFixture || options.budget) assert.equal(f.calls.length, 0);
});

for (const [name, options] of [['wrong pointer count', { wrongPointer: true }], ['wrong keyboard count', { wrongKeyboard: true }], ['replacement native node', { replaced: true }], ['changed original text', { changedText: true }], ['untrusted input', { untrusted: true }], ['occluded cells', { occluded: true }], ['missed real Tab', { missedTab: true }]]) test(`observed ${name} fails instead of becoming optional unavailable`, async () => {
  const f = protocol(options);await assert.rejects(f.run());assert.equal(f.item.commitLinks.status, 'failed');assert.equal(f.cleanups(), 1);
});

test('scopes real shared settings and restores the exact original values only after page closure', async () => {
  const original = { enabled: false, repoConfigs: 'always', showListStats: false, aiEnabled: true, categoryPatterns: { tests: ['keep/*'] } };
  let saved = structuredClone(original);const progress = {};
  const scope = commitLinkSettingsScope({ readSettings: async () => structuredClone(saved), writeSettings: async (value) => { saved = structuredClone(value); }, progress });
  await scope.prepare();assert.deepEqual(saved, { ...original, ...BITBUCKET_COMMIT_LINK_SETTINGS });
  await assert.rejects(scope.restore(false));assert.equal(progress.restoration, 'failed');assert.equal(saved.repoConfigs, 'never');
  await scope.restore(true);assert.deepEqual(saved, original);assert.equal(progress.restoration, 'restored');
});

test('a partially failed settings preparation still restores captured originals, while restore mismatches fail', async () => {
  const original = { enabled: false, repoConfigs: 'ask', aiEnabled: false };let saved = original;let rejectOnce = true;const progress = {};
  const scope = commitLinkSettingsScope({ readSettings: async () => saved, writeSettings: async (value) => { saved = value;if (rejectOnce) { rejectOnce = false;throw new Error('Native settings unavailable'); } }, progress });
  await assert.rejects(scope.prepare());await scope.restore(true);assert.deepEqual(saved, original);
  const broken = commitLinkSettingsScope({ readSettings: async () => saved, writeSettings: async () => {}, progress });
  await assert.rejects(broken.prepare());saved = { ...saved, enabled: true };await assert.rejects(broken.restore(true));assert.equal(progress.restoration, 'failed');
});

const MASTER_LIST = `${BITBUCKET_COMMIT_LIST}branch/master`;
const masterRef = () => '<div data-qa="commit-list-filters"><div data-qa="ref-selector"><p role="presentation"><button type="button" data-testid="ref-selector-trigger" aria-haspopup="true" aria-expanded="false" aria-label="Filter by ref: master">master</button></p></div></div>';

test('accepts only the actual canonical master listing and its verified original native ref control', () => {
  window.history.replaceState(null, '', MASTER_LIST);
  // Reduced original structure retained by run41366452688, with explicit unit-only link geometry.
  document.body.innerHTML = `<main>${masterRef()}<table><tbody><tr><td>${link(OTHER)}</td></tr></tbody></table></main>`;geometry();
  const before = document.body.innerHTML;const discovery = bitbucketCommitLinksSnapshot();
  assert.equal(discovery.actualURL, MASTER_LIST);assert.equal(discovery.url, MASTER_LIST);assert.equal(discovery.selected.ref, OTHER);
  assert.deepEqual({ label: discovery.branch.label, text: discovery.branch.text }, { label: 'Filter by ref: master', text: 'master' });
  assert.equal(document.querySelector(discovery.branch.selector), document.querySelector('[data-testid="ref-selector-trigger"]'));
  assert.equal(document.body.innerHTML, before);
});

for (const shape of ['absent', 'wrong ref label', 'wrong ref text', 'duplicate', 'form', 'owned', 'outside main', 'disabled']) test(`canonical master listing fails closed for ${shape} native ref binding`, () => {
  window.history.replaceState(null, '', MASTER_LIST);
  document.body.innerHTML = `<main>${masterRef()}${link()}</main>`;geometry();
  const button = document.querySelector('button');
  if (shape === 'absent') button.remove();
  if (shape === 'wrong ref label') button.setAttribute('aria-label', 'Filter by ref: development');
  if (shape === 'wrong ref text') button.textContent = 'development';
  if (shape === 'duplicate') button.parentElement.append(button.cloneNode(true));
  if (shape === 'form') { const form = document.createElement('form');button.replaceWith(form);form.append(button); }
  if (shape === 'owned') button.setAttribute('data-geld-ui', '');
  if (shape === 'outside main') document.body.append(button.closest('[data-qa="commit-list-filters"]'));
  if (shape === 'disabled') button.disabled = true;
  const result = bitbucketCommitLinksSnapshot();assert.equal(result.actualURL, MASTER_LIST);assert.equal(result.selected, null);assert.match(result.unavailable, /master ref selector/);
});

for (const route of [BITBUCKET_COMMIT_LIST.replace('atlassian', 'foreign'), `${BITBUCKET_COMMIT_LIST}branch/development`, `${MASTER_LIST}/`, `${MASTER_LIST}?page=2`, `${MASTER_LIST}#note`, `${BITBUCKET_COMMIT_LIST}${OTHER}`, MASTER_LIST.replace('bitbucket.org', 'foreign.example'), MASTER_LIST.replace('https://', 'https://user:password@')]) test(`records but rejects nonfixture document URL ${route}`, () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: route } });
  try { const result = bitbucketCommitLinksSnapshot();assert.equal(result.actualURL, new URL(route).href);assert.equal(result.selected, null);assert.match(result.unavailable, /route changed/); }
  finally { Object.defineProperty(globalThis, 'location', originalLocation); }
});

test('tracks the actual original native branch-control identity and selected text without copying it', () => {
  window.history.replaceState(null, '', MASTER_LIST);document.body.innerHTML = `<main>${masterRef()}${link()}</main>`;geometry();
  const discovery = bitbucketCommitLinksSnapshot();const node = document.querySelector(discovery.selected.selector);const branch = document.querySelector(discovery.branch.selector);
  globalThis.__geldCommitLinksProof = { node, parent: node.parentElement, selector: discovery.selected.selector, text: node.textContent, events: [], branch: { ...discovery.branch, node: branch, parent: branch.parentElement } };
  assert.equal(bitbucketCommitLinkState().branch.sameNode, true);assert.equal(bitbucketCommitLinkState().branch.unique, true);
  branch.textContent = 'development';assert.equal(bitbucketCommitLinkState().branch.text, 'development');
  branch.replaceWith(branch.cloneNode(true));assert.equal(bitbucketCommitLinkState().branch.sameNode, false);
});

test('canonical-route pointer and real-Tab protocol stays bound to discovery.actualURL rather than requested URL', async () => {
  const fixture = protocol({ canonical: true });assert.equal((await fixture.run()).status, 'passed');
  assert.equal(fixture.item.commitLinks.discovery.actualURL, MASTER_LIST);assert.deepEqual(fixture.calls, ['pointer', 'keyboard', 'pointer', 'keyboard', 'pointer', 'keyboard']);assert.equal(fixture.cleanups(), 1);
});
for (const navigation of [BITBUCKET_COMMIT_LIST, `${MASTER_LIST}?changed=1`, `${MASTER_LIST}#note`, `${BITBUCKET_COMMIT_LIST}branch/other`, `${BITBUCKET_COMMIT_LIST}${OTHER}`, MASTER_LIST.replace('bitbucket.org', 'foreign.example')]) test(`after-discovery navigation to ${navigation} fails with listener cleanup`, async () => {
  const fixture = protocol({ canonical: true, navigation });await assert.rejects(fixture.run());assert.equal(fixture.item.commitLinks.status, 'failed');assert.equal(fixture.cleanups(), 1);
});
for (const options of [{ canonical: true, branchReplaced: true }, { canonical: true, branchChanged: true }, { canonical: true, nativeCard: true, navigation: BITBUCKET_COMMIT_LIST }]) test(`native ref/visit drift fails even when a hover is unavailable: ${JSON.stringify(options)}`, async () => {
  const fixture = protocol(options);await assert.rejects(fixture.run());assert.equal(fixture.item.commitLinks.status, 'failed');assert.equal(fixture.cleanups(), 1);
});

test('does not ignore a present nonmaster or ambiguous native selected ref on the original listing route', () => {
  document.body.innerHTML = `<main>${masterRef()}${link()}</main>`;geometry();
  document.querySelector('button').setAttribute('aria-label', 'Filter by ref: development');
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
  document.body.innerHTML = `<main>${masterRef()}${masterRef().replace('Filter by ref: master', 'Filter by ref: development')}${link()}</main>`;geometry();
  assert.equal(bitbucketCommitLinksSnapshot().selected, null);
});

const actualOracle = () => ({ status: 'ready', totals: { files: 5, additions: 21, deletions: 11 }, files: [
  { path: '.changes/0.7.5.json', additions: 10, deletions: 0 },
  { path: '.changes/next-release/patch-20250701070558543229.json', additions: 0, deletions: 4 },
  { path: 'CHANGELOG.md', additions: 4, deletions: 0 },
  { path: 'README.md', additions: 6, deletions: 6 },
  { path: 'pipe.yml', additions: 1, deletions: 1 },
] });

test('derives nonzero category subtraction from retained actual 212 per-file oracle, with conserved totals', () => {
  assert.deepEqual(commitLinkFilteredRows(actualOracle()), [
    { label: 'Essential', files: '4 files', additions: '+15', deletions: '−5' },
    { label: 'Tests', files: '1 file', additions: '+6', deletions: '−6' },
    { label: 'Total', files: '5 files', additions: '+21', deletions: '−11' },
  ]);
  const changed = actualOracle();changed.files[3].additions = 9;changed.totals.additions = 24;
  assert.equal(commitLinkFilteredRows(changed)[1].additions, '+9');assert.equal(commitLinkFilteredRows(changed)[0].additions, '+15');
});

for (const invalid of ['missing README', 'duplicate README', 'zero additions', 'zero deletions', 'mismatched total', 'negative lines', 'not ready']) test(`positive category proof rejects ${invalid} source rather than guessing totals`, () => {
  const source = actualOracle();
  if (invalid === 'missing README') source.files[3].path = 'elsewhere/README.md';
  if (invalid === 'duplicate README') source.files[2].path = 'README.md';
  if (invalid === 'zero additions') { source.totals.additions -= source.files[3].additions;source.files[3].additions = 0; }
  if (invalid === 'zero deletions') { source.totals.deletions -= source.files[3].deletions;source.files[3].deletions = 0; }
  if (invalid === 'mismatched total') source.totals.deletions += 1;
  if (invalid === 'negative lines') source.files[0].additions = -1;
  if (invalid === 'not ready') source.status = 'unavailable';
  assert.throws(() => commitLinkFilteredRows(source));
});

test('pattern-only protocol preserves other settings and original categoryPatterns absence, rehovers pointer and Tab after restoration', async () => {
  const fixture = protocol({ canonical: true, patternsAbsent: true });assert.equal((await fixture.run()).status, 'passed');
  const evidence = fixture.item.commitLinks.categorySubtraction;
  assert.equal(evidence.status, 'passed');assert.equal(evidence.restoration, 'restored');assert.equal(evidence.sourceGetCount, 0);
  assert.deepEqual(evidence.filteredSettings, { ...fixture.original, categoryPatterns: { tests: ['README.md'] } });
  assert.deepEqual(evidence.filtered.pointer.rows, evidence.expectedRows);assert.deepEqual(evidence.filtered.keyboard.rows, evidence.expectedRows);
  assert.deepEqual(evidence.restored.pointer.rows, fixture.item.commitLinks.pointer.rows);assert.deepEqual(evidence.restored.keyboard.rows, fixture.item.commitLinks.pointer.rows);
  assert.deepEqual(fixture.saved(), fixture.original);assert.equal(Object.hasOwn(fixture.saved(), 'categoryPatterns'), false);assert.equal(fixture.listener(), null);assert.equal(fixture.writes(), 2);
});

for (const [name, options] of [
  ['wrong filtered Essential count', { wrongPhase: 'filtered' }], ['wrong filtered Tests count', { wrongTests: true }],
  ['wrong restored rows', { wrongPhase: 'restored' }], ['filtered route drift', { filteredNavigation: true }],
  ['changed immutable source', { sourceDrift: true }], ['failed partial pattern write', { writeFailure: true }],
  ['restore write failure', { restoreFailure: true }], ['restore readback mismatch', { restoreMismatch: true }],
  ['positively extension-attributed source GET', { sourceRequest: 'extension' }],
  ['lost eight-request reserve before filtered intent', { filteredBudget: true }], ['new untrusted filtered input', { filteredUntrusted: true }],
]) test(`${name} fails the whole case, preserves evidence and releases listeners`, async () => {
  const fixture = protocol(options);await assert.rejects(fixture.run());
  assert.equal(fixture.item.commitLinks.status, 'failed');assert.equal(fixture.item.commitLinks.categorySubtraction.status, 'failed');assert.equal(fixture.listener(), null);assert.equal(fixture.cleanups(), 1);
  if (options.restoreFailure || options.restoreMismatch) assert.equal(fixture.item.commitLinks.categorySubtraction.restoration, 'failed');
  else { assert.equal(fixture.item.commitLinks.categorySubtraction.restoration, 'restored');assert.deepEqual(fixture.saved(), fixture.original); }
});

test('missing positively observed README fails before changing settings', async () => {
  const fixture = protocol({ noReadme: true });await assert.rejects(fixture.run(), /exactly observed README/);
  assert.equal(fixture.item.commitLinks.status, 'failed');assert.equal(fixture.writes(), 0);assert.equal(fixture.listener(), null);
});

test('missing source initiator stays native-or-unattributed evidence and does not become a zero-GET claim', async () => {
  const fixture = protocol({ sourceRequest: 'unknown' });assert.equal((await fixture.run()).status, 'passed');
  const evidence = fixture.item.commitLinks.categorySubtraction;
  assert.equal(evidence.sourceGetCount, 4);assert.deepEqual(evidence.extensionRequests, []);assert.equal(evidence.nativeOrUnattributedRequests.length, 4);
  assert.ok(evidence.nativeOrUnattributedRequests.every((request) => request.attribution === 'native-or-unattributed'));
});

test('records actual original-source focus and departure target without changing native nodes', () => {
  document.body.innerHTML = `<main><button type="button">Native preceding control</button>${link()}</main>`;
  const node = document.querySelector('a');const parent = node.parentElement;
  globalThis.__geldCommitLinksProof = { node, parent, selector: 'main a', text: node.textContent, events: [] };
  const before = document.body.innerHTML;node.focus();const focused = bitbucketCommitLinkState();
  assert.equal(focused.focused, true);assert.equal(focused.activeElement.tag, 'A');assert.equal(focused.activeElement.href, node.getAttribute('href'));
  document.querySelector('button').focus();const departed = bitbucketCommitLinkState();
  assert.equal(departed.focused, false);assert.equal(departed.activeElement.tag, 'BUTTON');assert.equal(departed.activeElement.text, 'Native preceding control');
  assert.equal(departed.sameNode, true);assert.equal(departed.sameParent, true);assert.equal(document.body.innerHTML, before);
});

test('source-backed Escape dismissal requires genuine Shift+Tab focus departure before each later pointer phase', async () => {
  const fixture = protocol({ canonical: true });assert.equal((await fixture.run()).status, 'passed');
  assert.deepEqual(fixture.keyboard, ['Shift down', 'Tab', 'Shift up', 'Shift down', 'Tab', 'Shift up']);
  for (const phase of ['filtered', 'restored']) {
    const departure = fixture.item.commitLinks.categorySubtraction[phase].pointerDeparture;
    assert.equal(departure.status, 'departed');assert.equal(departure.before.focused, true);assert.equal(departure.before.activeElement.tag, 'A');
    assert.equal(departure.after.focused, false);assert.equal(departure.after.activeElement.tag, 'TH');assert.equal(departure.after.sameNode, true);
    assert.deepEqual(departure.after.events, [{ type: 'focusout', trusted: true }]);
    assert.equal(departure.after.url, MASTER_LIST);assert.equal(departure.after.branch.sameNode, true);
  }
});

for (const [name, options] of [
  ['focus remains on dismissed source', { noDeparture: true }], ['no recorded source focusout', { noFocusout: true }],
  ['untrusted source focusout', { untrustedFocusout: true }], ['unknown native focus', { missingFocus: true }],
  ['keyboard command fails', { departureThrows: true }], ['document changes during departure', { departureNavigation: true }],
  ['source replaced during departure', { departureReplacement: true }], ['native ref changes during departure', { canonical: true, departureRefChange: true }],
]) test(`${name} fails before filtered pointer input, restores settings and releases listeners`, async () => {
  const fixture = protocol(options);await assert.rejects(fixture.run());
  assert.equal(fixture.item.commitLinks.status, 'failed');assert.equal(fixture.item.commitLinks.categorySubtraction.status, 'failed');
  assert.deepEqual(fixture.calls, ['pointer', 'keyboard']);assert.equal(fixture.item.commitLinks.categorySubtraction.restoration, 'restored');
  assert.deepEqual(fixture.saved(), fixture.original);assert.equal(fixture.listener(), null);assert.equal(fixture.cleanups(), 1);
  if (!options.missingFocus) assert.deepEqual(fixture.keyboard, ['Shift down', 'Tab', 'Shift up']);
});
