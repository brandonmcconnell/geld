import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { bitbucketParentCommitSnapshot, createBitbucketCommitOracle, commitHoverTotal, prepareBitbucketParentCommit } from './bitbucket-commit-oracle.mjs';

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

function parentRevealFixture({ collapsed = true, selected = true, expanded = true, offscreen = false } = {}) {
  const parent = '4eded8cb0a4a3cf5f249d1bab75e90078eba2058';
  // Run41359880788's native64px rail and expanded contents, with explicit unit-only geometry and native-event simulation.
  document.body.innerHTML = `<div data-testid="sidebar" style="width:64px"><button type="button" id="native-sidebar-toggle"><span role="img" aria-label="Click or tap to expand or press the ] (right bracket) key"></span></button><div id="details" role="tab" data-testid="sidebar-tab-details" aria-selected="${selected}" aria-controls="panel">Details</div><div id="panel" role="tabpanel" aria-labelledby="details"><div data-testid="expanded-CommitCard"><section><h2><button aria-expanded="${expanded}" aria-controls="expanderId-3">1 parent commit</button></h2><div id="expanderId-3" aria-hidden="${!expanded}"><a href="${parent}" target="_self">4eded8c</a></div></section></div></div></div>`;
  const toggle = document.getElementById('native-sidebar-toggle');
  const tab = document.getElementById('details');
  const panel = document.getElementById('panel');
  const parents = document.querySelector('button[aria-controls="expanderId-3"]');
  const body = document.getElementById('expanderId-3');
  const link = body.querySelector('a');
  const state = { collapsed, offscreen, clicks: [], scrolls: 0 };
  panel.hidden = !selected;
  const rect = (shown, top) => ({ left: shown ? 850 : 1600, top, width: 80, height: 20 });
  toggle.getBoundingClientRect = () => rect(state.collapsed, 100);
  tab.getBoundingClientRect = () => rect(!state.collapsed, 150);
  parents.getBoundingClientRect = () => rect(!state.collapsed && !panel.hidden, 200);
  link.getBoundingClientRect = () => rect(!state.collapsed && !panel.hidden && body.getAttribute('aria-hidden') === 'false', state.offscreen ? 2000 : 250);
  document.elementFromPoint = (x, y) => [toggle, tab, parents, link].find((node) => { const box = node.getBoundingClientRect();return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height; }) ?? document.body;
  toggle.addEventListener('click', () => { state.collapsed = false;toggle.remove(); });
  tab.addEventListener('click', () => { tab.setAttribute('aria-selected', 'true');panel.hidden = false; });
  parents.addEventListener('click', () => { parents.setAttribute('aria-expanded', 'true');body.setAttribute('aria-hidden', 'false'); });
  link.scrollIntoView = () => { state.scrolls += 1;state.offscreen = false; };
  const page = {
    evaluate: async (read) => read(),
    $: async (selector) => { const node = document.querySelector(selector);return node === null ? null : { evaluate: async (read, ...args) => read(node, ...args), click: async () => { state.clicks.push(node);node.click(); }, dispose: async () => {} }; },
    $eval: async (selector, read, ...args) => read(document.querySelector(selector), ...args),
  };
  return { page, state, toggle, tab, panel, parents, body, link };
}

const immediateParentPoll = async (read, accept, label) => {
  const value = await read();if (!accept(value)) throw new Error(label);return value;
};

test('reveals the collapsed native rail before using its already-selected but offscreen Details tab', async () => {
  const fixture = parentRevealFixture();
  const initial = bitbucketParentCommitSnapshot();
  assert.equal(initial.tabSelected, 'true');assert.equal(initial.parentsExpanded, 'true');
  assert.equal(initial.links[0].visible, false);assert.equal(initial.controls.details.visible, false);
  assert.equal(initial.controls.expandSidebar.visible, true);
  const before = fixture.link.outerHTML;
  const result = await prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll);
  assert.deepEqual(result.actions.map((action) => action.kind), ['expandSidebar']);
  assert.deepEqual(fixture.state.clicks, [fixture.toggle]);
  assert.equal(result.native.links[0].visible, true);
  assert.equal(fixture.link.outerHTML, before);assert.equal(document.querySelector('a'), fixture.link);
});

test('selects only the visible native Details tab and opens only its closed parent section', async () => {
  const fixture = parentRevealFixture({ collapsed: false, selected: false, expanded: false });
  const result = await prepareBitbucketParentCommit(fixture.page, bitbucketParentCommitSnapshot(), immediateParentPoll);
  assert.deepEqual(result.actions.map((action) => action.kind), ['details', 'parents']);
  assert.deepEqual(fixture.state.clicks, [fixture.tab, fixture.parents]);
  assert.equal(result.native.links[0].visible, true);
});

test('scrolls an offscreen parent in an open native sidebar without clicking its selected Details tab', async () => {
  const fixture = parentRevealFixture({ collapsed: false, offscreen: true });
  const initial = bitbucketParentCommitSnapshot();
  assert.equal(initial.links[0].presented, true);assert.equal(initial.links[0].visible, false);
  const result = await prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll);
  assert.deepEqual(result.actions.map((action) => action.kind), ['scroll']);
  assert.equal(fixture.state.scrolls, 1);assert.deepEqual(fixture.state.clicks, []);
});

test('does not change an already visible parent, its native identity or its controls', async () => {
  const fixture = parentRevealFixture({ collapsed: false });
  const before = document.body.innerHTML;
  const result = await prepareBitbucketParentCommit(fixture.page, bitbucketParentCommitSnapshot(), immediateParentPoll);
  assert.deepEqual(result.actions, []);assert.deepEqual(fixture.state.clicks, []);
  assert.equal(document.body.innerHTML, before);
});

for (const change of ['navigation', 'identity', 'disabled', 'removed']) test(`refuses a native parent reveal after ${change} changes during control lookup`, async () => {
  const fixture = parentRevealFixture();
  const initial = bitbucketParentCommitSnapshot();
  const lookup = fixture.page.$;
  fixture.page.$ = async (selector) => {
    const handle = await lookup(selector);
    if (change === 'navigation') window.history.replaceState(null, '', '/atlassian/bitbucket-upload-file/commits/' + 'b'.repeat(40));
    else if (change === 'identity') fixture.link.setAttribute('href', 'c'.repeat(40));
    else if (change === 'disabled') fixture.toggle.disabled = true;
    else fixture.toggle.remove();
    return handle;
  };
  await assert.rejects(prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll), /changed|no longer visible/);
  assert.deepEqual(fixture.state.clicks, []);
});

test('does not use a sidebar expansion hint outside the actual Details sidebar or an owned clone', () => {
  const fixture = parentRevealFixture();
  fixture.toggle.remove();
  document.body.insertAdjacentHTML('beforeend', '<div data-testid="sidebar"><button><span role="img" aria-label="Click or tap to expand or press the ] (right bracket) key"></span></button></div>');
  assert.equal(bitbucketParentCommitSnapshot().controls.expandSidebar, null);
  fixture.panel.insertAdjacentHTML('beforeend', '<div data-geld-ui><button><span role="img" aria-label="Click or tap to expand or press the ] (right bracket) key"></span></button></div>');
  assert.equal(bitbucketParentCommitSnapshot().controls.expandSidebar, null);
});

for (const style of ['opacity:0', 'content-visibility:hidden', 'display:none']) test(`does not claim an invisible native control is presented under ${style}`, () => {
  const fixture = parentRevealFixture();fixture.toggle.style.cssText = style;
  const control = bitbucketParentCommitSnapshot().controls.expandSidebar;
  assert.equal(control.presented, false);assert.equal(control.visible, false);
});

test('refuses an offscreen parent scroll after URL-only navigation', async () => {
  const fixture = parentRevealFixture({ collapsed: false, offscreen: true });
  const initial = bitbucketParentCommitSnapshot();
  const scroll = fixture.page.$eval;
  fixture.page.$eval = async (...args) => { window.history.replaceState(null, '', '/atlassian/bitbucket-upload-file/commits/' + 'b'.repeat(40));return scroll(...args); };
  await assert.rejects(prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll), /changed before its scroll/);
  assert.equal(fixture.state.scrolls, 0);
});

function consentParentFixture(options = {}) {
  window.innerWidth = 1440;window.innerHeight = 1000;
  const fixture = parentRevealFixture();
  // Reduced actual run41365072551 structure. Geometry and trusted input below are unit protocol only.
  const layout = document.createElement('div');layout.id = 'unsafe-design-system-page-layout-root';
  const sidebar = fixture.toggle.closest('[data-testid="sidebar"]');
  document.body.append(layout);layout.append(sidebar);
  const slot = document.createElement('div');slot.setAttribute('data-layout-slot', 'true');
  slot.innerHTML = '<div><div role="dialog" aria-labelledby="cookiesTrackingNoticeLink"><a id="cookiesTrackingNoticeLink" href="https://www.atlassian.com/legal/cookies">Atlassian cookies and tracking notice</a><button type="button" data-testid="only-necessary-button">Only necessary</button></div></div>';
  const header = document.createElement('header');header.setAttribute('data-layout-slot', 'true');header.id = 'native-global-header';layout.prepend(slot, header);
  const dialog = slot.querySelector('[role="dialog"]');const necessary = dialog.querySelector('button');
  const state = { active: true, blockedAfterDismissal: options.blockedAfterDismissal === true };
  const toggleBox = fixture.toggle.getBoundingClientRect;
  fixture.toggle.getBoundingClientRect = () => state.active ? { left: 1388, top: 131, width: 40, height: 32 } : toggleBox();
  header.getBoundingClientRect = () => ({ left: 0, top: state.active ? 105 : 0, width: 1440, height: 56 });
  dialog.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1440, height: 105 });
  necessary.getBoundingClientRect = () => ({ left: 1174, top: 37, width: 128, height: 32 });
  const nativeHit = document.elementFromPoint;
  document.elementFromPoint = (x, y) => {
    if (state.active && x >= 1174 && x < 1302 && y >= 37 && y < 69) return necessary;
    if (state.active && x === 720 && y === 52.5) return dialog;
    if (state.active && x === 1408 && y === 147 || !state.active && state.blockedAfterDismissal && y === 110) return header;
    return nativeHit(x, y);
  };
  necessary.addEventListener('click', () => { state.active = false;slot.remove(); });
  const lookup = fixture.page.$;
  fixture.page.$ = async (selector) => {
    const handle = await lookup(selector);
    if (handle !== null && selector.includes('only-necessary-button')) {
      const click = handle.click;
      handle.click = async () => {
        await click();
        // Synthetic protocol record, never an assertion that HappyDOM creates a real trusted click.
        if (options.untrusted !== true) globalThis.__geldParentConsent.event = { trusted: true, detail: 1, nativeButton: true };
      };
    }
    return handle;
  };
  return { ...fixture, layout, slot, dialog, necessary, header, consentState: state };
}

test('records the actual obstruction target and binds only the observed native layout-slot necessary-cookie control', () => {
  const fixture = consentParentFixture();const initial = bitbucketParentCommitSnapshot();
  assert.equal(initial.controls.expandSidebar.presented, true);assert.equal(initial.controls.expandSidebar.visible, false);
  assert.deepEqual(initial.controls.expandSidebar.point, { x: 1408, y: 147 });
  assert.equal(initial.controls.expandSidebar.hit.id, 'native-global-header');assert.equal(initial.controls.expandSidebar.hit.nativeHeader, true);
  assert.equal(initial.consent.control.visible, true);assert.equal(initial.consent.label, 'Only necessary');
  assert.equal(initial.consent.legalUrl, 'https://www.atlassian.com/legal/cookies');
  assert.equal(initial.nativeLayout.headers[0].bounds.top, 105);
  assert.equal(document.querySelector('[data-testid="only-necessary-button"]'), fixture.necessary);
});

test('uses native necessary-cookie pointer input before rechecking and clicking the original sidebar control', async () => {
  const fixture = consentParentFixture();const nativeBody = fixture.link.outerHTML;let progress;
  const result = await prepareBitbucketParentCommit(fixture.page, bitbucketParentCommitSnapshot(), immediateParentPoll, (value) => { progress = value; });
  assert.deepEqual(result.actions.map((action) => action.kind), ['necessaryCookies', 'expandSidebar']);
  assert.deepEqual(fixture.state.clicks.map((node) => node === fixture.necessary ? 'necessary' : node === fixture.toggle ? 'sidebar' : 'unexpected'), ['necessary', 'sidebar']);
  assert.deepEqual(result.actions[0].event, { trusted: true, detail: 1, nativeButton: true });
  assert.equal(result.actions[0].before.controls.expandSidebar.hit.nativeHeader, true);
  assert.equal(result.actions[0].after.consent, null);assert.equal(result.actions[0].after.controls.expandSidebar.visible, true);
  assert.equal(result.native.links[0].visible, true);assert.equal(result.native.links[0].href, progress.initial.links[0].href);
  assert.equal(progress.status, 'ready');assert.equal(fixture.link.outerHTML, nativeBody);assert.equal(globalThis.__geldParentConsent, undefined);
});

for (const shape of ['wrong label', 'wrong legal URL', 'duplicate button', 'duplicate dialog', 'form', 'owned', 'comment', 'disabled', 'hidden', 'unknown obstruction']) test(`refuses consent preparation for ${shape}`, async () => {
  const fixture = consentParentFixture();
  if (shape === 'wrong label') fixture.necessary.textContent = 'Accept all';
  if (shape === 'wrong legal URL') fixture.dialog.querySelector('a').href = 'https://foreign.example/legal/cookies';
  if (shape === 'duplicate button') fixture.dialog.append(fixture.necessary.cloneNode(true));
  if (shape === 'duplicate dialog') fixture.slot.append(fixture.dialog.cloneNode(true));
  if (shape === 'form') { const form = document.createElement('form');fixture.dialog.replaceWith(form);form.append(fixture.dialog); }
  if (shape === 'owned') fixture.dialog.setAttribute('data-geld-ui', '');
  if (shape === 'comment') fixture.dialog.classList.add('ak-renderer-document');
  if (shape === 'disabled') fixture.necessary.disabled = true;
  if (shape === 'hidden') fixture.dialog.hidden = true;
  if (shape === 'unknown obstruction') document.elementFromPoint = () => document.body;
  let progress;await assert.rejects(prepareBitbucketParentCommit(fixture.page, bitbucketParentCommitSnapshot(), immediateParentPoll, (value) => { progress = value; }));
  assert.equal(fixture.state.clicks.length, 0);assert.equal(progress.status, 'failed');assert.equal(globalThis.__geldParentConsent, undefined);
});

for (const change of ['navigation', 'parent identity', 'original sidebar', 'consent replacement', 'disabled consent']) test(`rechecks original native identity after ${change} changes during consent lookup`, async () => {
  const fixture = consentParentFixture();const initial = bitbucketParentCommitSnapshot();const lookup = fixture.page.$;
  fixture.page.$ = async (selector) => {
    const handle = await lookup(selector);
    if (selector.includes('only-necessary-button')) {
      if (change === 'navigation') window.history.replaceState(null, '', '/atlassian/bitbucket-upload-file/commits/' + 'b'.repeat(40));
      if (change === 'parent identity') fixture.link.setAttribute('href', 'c'.repeat(40));
      if (change === 'original sidebar') fixture.toggle.remove();
      if (change === 'consent replacement') fixture.necessary.replaceWith(fixture.necessary.cloneNode(true));
      if (change === 'disabled consent') fixture.necessary.disabled = true;
    }
    return handle;
  };
  let progress;await assert.rejects(prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll, (value) => { progress = value; }));
  assert.equal(fixture.state.clicks.length, 0);assert.equal(progress.status, 'failed');assert.equal(globalThis.__geldParentConsent, undefined);
});

for (const [label, options] of [['untrusted pointer', { untrusted: true }], ['still-obstructed original sidebar', { blockedAfterDismissal: true }]]) test(`retains failed preparation and cleans up after ${label}`, async () => {
  const fixture = consentParentFixture(options);let progress;
  await assert.rejects(prepareBitbucketParentCommit(fixture.page, bitbucketParentCommitSnapshot(), immediateParentPoll, (value) => { progress = value; }));
  assert.equal(progress.status, 'failed');assert.deepEqual(fixture.state.clicks.map((node) => node === fixture.necessary ? 'necessary' : 'unexpected'), ['necessary']);
  assert.equal(progress.actions[0].kind, 'necessaryCookies');assert.ok(progress.actions[0].event);
  assert.equal(globalThis.__geldParentConsent, undefined);assert.equal(progress.initial.controls.expandSidebar.hit.nativeHeader, true);
});

for (const change of ['label', 'legal URL']) test(`rechecks the native consent ${change} at the last pre-click binding`, async () => {
  const fixture = consentParentFixture();const initial = bitbucketParentCommitSnapshot();const lookup = fixture.page.$;
  fixture.page.$ = async (selector) => {
    const handle = await lookup(selector);
    if (handle !== null && !selector.includes('only-necessary-button')) {
      const evaluate = handle.evaluate;
      handle.evaluate = async (...args) => {
        if (change === 'label') fixture.necessary.textContent = 'Accept all';
        else fixture.dialog.querySelector('a').href = 'https://foreign.example/legal/cookies';
        return evaluate(...args);
      };
    }
    return handle;
  };
  let progress;await assert.rejects(prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll, (value) => { progress = value; }), /consent control changed/);
  assert.equal(fixture.state.clicks.length, 0);assert.equal(progress.status, 'failed');assert.equal(globalThis.__geldParentConsent, undefined);
});

test('retains the native consent action but rejects replacement of the original sidebar after dismissal', async () => {
  const fixture = consentParentFixture();const initial = bitbucketParentCommitSnapshot();
  fixture.necessary.addEventListener('click', () => fixture.toggle.remove());
  let progress;await assert.rejects(prepareBitbucketParentCommit(fixture.page, initial, immediateParentPoll, (value) => { progress = value; }));
  assert.deepEqual(fixture.state.clicks.map((node) => node === fixture.necessary ? 'necessary' : 'unexpected'), ['necessary']);
  assert.equal(progress.status, 'failed');assert.deepEqual(progress.actions[0].event, { trusted: true, detail: 1, nativeButton: true });
  assert.equal(globalThis.__geldParentConsent, undefined);
});
