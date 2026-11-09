import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { BITBUCKET_COMMIT_LIST, BITBUCKET_COMMIT_LINK_SETTINGS, bitbucketCommitLinksSnapshot, bitbucketCommitLinkState, commitLinkSettingsScope, verifyBitbucketCommitLinks } from './bitbucket-commit-links.mjs';
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
  if (!options.incomplete) oracle.observe(`https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/diffstat/${OTHER}?pagelen=100`, { size: 1, values: [{ new: { path: 'pipe/pipe.py' }, lines_added: 2, lines_removed: 0 }] });
  const events = [];const calls = [];let cleanups = 0;
  const actualURL = options.canonical ? `${BITBUCKET_COMMIT_LIST}branch/master` : BITBUCKET_COMMIT_LIST;
  const branch = options.canonical ? { selector: '[data-testid="ref-selector-trigger"]', label: 'Filter by ref: master', text: 'master' } : null;
  const state = () => ({ url: calls.length > 0 && options.navigation ? options.navigation : actualURL, branch: branch === null ? null : { ...branch, unique: true, sameNode: !options.branchReplaced || calls.length === 0, sameParent: true, label: calls.length > 0 && options.branchChanged ? 'Filter by ref: another' : branch.label }, sameNode: !options.replaced || calls.length === 0, sameParent: true, sameText: !options.changedText || calls.length === 0, href: selected.href, raw: selected.raw, text: selected.text, events, nativeCards: [] });
  const page = {
    isClosed: () => false,
    evaluate: async (fn) => {
      if (fn === bitbucketCommitLinksSnapshot) return { actualURL, branch, selected: options.noFixture ? null : selected, links: [] };
      if (fn === bitbucketCommitLinkState) return state();
      if (fn.toString().includes('delete globalThis')) cleanups += 1;
    },
  };
  const item = {};
  const run = () => verifyBitbucketCommitLinks(page, item, { oracle,
    guardBudget: () => ({ available: !options.budget, remaining: options.budget ? 7 : 12, minimumReserve: 8 }),
    poll: async (read, accept, label) => { const value = await read();assert.ok(accept(value), label);return value; },
    installedHover: async (_page, selector, input, _name, _anchor, config) => {
      assert.equal(selector, selected.selector);assert.equal(config.verifyUnobscured, true);calls.push(input);
      if (options.nativeCard) throw new Error('Native card retained ownership. Count popup not observed.');
      events.push({ type: input === 'pointer' ? 'mouseover' : 'focusin', trusted: !options.untrusted });
      const additions = input === 'pointer' && options.wrongPointer || input === 'keyboard' && options.wrongKeyboard ? '+99' : '+2';
      return { rows: [{ label: 'Total', files: '1 file', additions, deletions: '−0' }], described: true, escapeDismissed: true,
        visibility: { beforeScreenshot: { unobscured: !options.occluded }, afterScreenshot: { unobscured: true } },
        ...(input === 'keyboard' ? { keyboardNavigation: { started: true, stops: [{ target: !options.missedTab }] } } : {}),
      };
    },
  });
  return { run, item, calls, cleanups: () => cleanups };
}

test('protocol requires the original trusted pointer and real Tab path against its independent complete response oracle', async () => {
  const f = protocol();assert.equal((await f.run()).status, 'passed');
  assert.deepEqual(f.calls, ['pointer', 'keyboard']);assert.equal(f.item.commitLinks.oracle.sha, OTHER);assert.equal(f.cleanups(), 1);
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
  assert.equal(fixture.item.commitLinks.discovery.actualURL, MASTER_LIST);assert.deepEqual(fixture.calls, ['pointer', 'keyboard']);assert.equal(fixture.cleanups(), 1);
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
