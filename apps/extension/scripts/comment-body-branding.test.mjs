import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { commentBodyPresentationProbe, compareCommentBodyPresentation } from './comment-body-branding.mjs';

let window;
let previousDocument;
let previousStyle;
beforeEach(() => {
  window = new Window({ url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334' });
  previousDocument = globalThis.document;
  previousStyle = globalThis.getComputedStyle;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  // Offline protocol tests simulate visible rectangles, not installed layout.
  window.Element.prototype.getBoundingClientRect = function () {
    return this.closest('[hidden]') === null ? new window.DOMRect(0, 0, 300, 20) : new window.DOMRect();
  };
});
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  if (previousStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousStyle;
  window.happyDOM.abort();
});

function fixture(body, provider = 'gitlab') {
  const anchor = provider === 'gitlab' ? 'note_4118584957' : 'comment-471253038';
  const review = provider === 'gitlab' ? 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334' : 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  window.location.href = review;
  const cls = provider === 'gitlab' ? 'note-text md' : 'ak-renderer-document';
  document.head.innerHTML = '<style>.body-copy { font: 400 14px/21px Arial; color: rgb(41,42,46); } .body-copy code { background: rgb(230,231,232); border: 1px solid rgb(180,181,182); padding: 2px; border-radius: 3px; }</style>';
  document.body.innerHTML = `<div id="${anchor}" data-testid="${provider === 'gitlab' ? 'noteable-note-container' : 'comment'}"><div class="${provider === 'gitlab' ? 'note-body' : 'native-content'}" ${provider === 'gitlab' ? '' : 'data-testid="comment-content"'}><div class="${cls} body-copy">${body}</div></div></div>
    <section class="geld-provider-review"><article class="geld-provider-review__source" data-geld-source="${anchor}"><div class="geld-provider-review__byline"><strong>Native author</strong><a href="${review}#${anchor}">View original</a></div><div class="geld-provider-review__body" style="border-left: 9px solid red; padding: 25px"><div class="${cls} body-copy">${body}</div></div></article></section>`;
  return { anchor, provider, read: () => commentBodyPresentationProbe(provider, anchor), owned: document.querySelector('.geld-provider-review__body > div'), native: document.getElementById(anchor) };
}

test('compares only actual body clone typography and leaves the custom outer card layout distinct', () => {
  const f = fixture('<p>Hi <a href="/aslota">@aslota</a> 👋 Could you do direct maintainer review?</p>');
  const evidence = f.read();
  const compared = compareCommentBodyPresentation(evidence);
  assert.equal(evidence.rootAligned, true);
  assert.deepEqual(evidence.samples.map((pair) => pair.category), ['root', 'paragraph', 'link']);
  assert.deepEqual(compared.mismatches, []);
  assert.equal(compared.covered.length, 3);
  assert.ok(compared.uncovered.includes('comment body inline code: absent from this native fixture'));
  assert.ok(compared.uncovered.includes('comment body table: absent from this native fixture'));
  assert.equal(f.native.id, 'note_4118584957');
  assert.equal(document.querySelector('.geld-provider-review__byline a').href.endsWith('#note_4118584957'), true);
});

test('supports the actual Bitbucket renderer root and labels its blank paragraph and absent rich tags honestly', () => {
  const f = fixture('<p>Internal maintenance: Update tests to access token auth.</p><p>\u00a0</p>', 'bitbucket');
  const evidence = f.read();
  assert.deepEqual(evidence.samples.map((pair) => pair.category), ['root', 'paragraph']);
  assert.deepEqual(compareCommentBodyPresentation(evidence).mismatches, []);
  assert.ok(evidence.uncovered.some((label) => label.includes('paragraph at source order 2: native element has no visible text')));
  assert.ok(evidence.uncovered.includes('comment body link: absent from this native fixture'));
});

test('detects an actual computed body color/typography mismatch rather than asserting guessed native values', () => {
  const f = fixture('<p>Matching original words</p>');
  f.owned.querySelector('p').style.cssText = 'color: rgb(99,98,97);font-size:12px';
  const compared = compareCommentBodyPresentation(f.read());
  assert.ok(compared.mismatches.some((item) => item.label.endsWith('.color') && item.native !== item.owned));
  assert.ok(compared.mismatches.some((item) => item.label.endsWith('.fontSize') && item.native === '14px' && item.owned === '12px'));
});

test('does not pair reordered same-tag text or missing links with another source node', () => {
  const f = fixture('<p>First</p><p>Second <a href="/one">link</a></p>');
  f.owned.innerHTML = '<p>Second <a href="/one">link</a></p><p>First</p>';
  const evidence = f.read();
  assert.equal(evidence.samples.length, 0);
  assert.ok(compareCommentBodyPresentation(evidence).mismatches.some((entry) => entry.label.includes('source order does not match')));
  assert.equal(evidence.rootAligned, false);
});

test('fails for actual visible source words missing from a cloned table header instead of marking them uncovered', () => {
  const f = fixture('<h3>Important Files Changed</h3><table><thead><tr><th>Filename</th><th>Overview</th></tr></thead><tbody><tr><td>backend/pyproject.toml</td><td>Updates dependencies</td></tr></tbody></table>');
  const original = f.read();
  assert.ok(original.samples.some((pair) => pair.category === 'heading'));
  assert.deepEqual(compareCommentBodyPresentation(original).mismatches, []);
  f.owned.querySelector('th').textContent = '';
  const missing = f.read();
  assert.equal(missing.rootAligned, false);
  assert.ok(compareCommentBodyPresentation(missing).mismatches.some((pair) => pair.label.includes('table cell') && pair.native.text === 'Filename' && pair.owned.text === ''));
  assert.ok(compareCommentBodyPresentation(missing).mismatches.some((pair) => pair.label.includes('comment body root')));
  assert.ok(!missing.uncovered.some((label) => label.includes('source order does not match')));
});

test('keeps genuinely hidden native rich content uncovered rather than claiming it matches or fails', () => {
  const f = fixture('<h3>Summary</h3><pre hidden><code>Unpresented native source</code></pre>');
  f.owned.querySelector('code').textContent = 'Different hidden clone';
  const evidence = f.read();
  assert.ok(evidence.uncovered.some((label) => label.includes('block code') && label.includes('not presented')));
  assert.ok(!evidence.contentMismatches.some((pair) => pair.label.includes('block code')));
});

test('rejects a duplicate source article and a cross-review original permalink', () => {
  const f = fixture('<p>Original</p>');
  document.querySelector('.geld-provider-review').append(document.querySelector('article').cloneNode(true));
  assert.equal(f.read().samples.length, 0);
  assert.ok(f.read().uncovered.some((label) => label.includes('ambiguous')));
  document.querySelector('article').remove();
  document.querySelector('.geld-provider-review__byline a').href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266335#note_4118584957';
  assert.equal(f.read().samples.length, 0);
  assert.ok(f.read().uncovered.some((label) => label.includes('permalink')));
});

test('never claims hidden native bodies were compared and detects a missing owned clone', () => {
  const f = fixture('<p>Original</p>');
  f.native.hidden = true;
  assert.equal(f.read().samples.length, 0);
  assert.equal(compareCommentBodyPresentation(f.read()).covered.length, 0);
  assert.ok(f.read().uncovered.some((label) => label.includes('not presented')));
  f.native.hidden = false;
  f.owned.remove();
  assert.deepEqual(compareCommentBodyPresentation(f.read()).mismatches, [{ label: 'comment body root', native: 'presented', owned: 'absent or not presented' }]);
});

for (const target of ['native', 'owned']) for (const hiddenBy of ['hidden', 'inert', 'aria-hidden', 'opacity', 'content-visibility']) test(`rejects a ${target} ancestor concealed by ${hiddenBy} despite positive child geometry`, () => {
  const f = fixture('<h3>Summary</h3><p>Original words</p><ul><li>One item</li></ul>');
  const ancestor = target === 'native' ? f.native : f.owned.parentElement;
  if (hiddenBy === 'opacity') ancestor.style.opacity = '0';
  else if (hiddenBy === 'content-visibility') ancestor.style.setProperty('content-visibility', 'hidden');
  else ancestor.setAttribute(hiddenBy, hiddenBy === 'aria-hidden' ? 'true' : '');
  const evidence = f.read();
  const compared = compareCommentBodyPresentation(evidence);
  if (target === 'native') {
    assert.equal(evidence.nativeRootPresent, false);
    assert.equal(compared.covered.length, 0);
    assert.ok(evidence.uncovered.some((label) => label.includes('not presented in the DOM')));
  } else {
    assert.equal(evidence.nativeRootPresent, true);
    assert.equal(evidence.ownedRootPresent, false);
    assert.ok(compared.mismatches.some((pair) => pair.label === 'comment body root'));
  }
});

test('labels valid offscreen comparisons as DOM/style evidence without claiming simultaneous viewport paint', () => {
  const f = fixture('<p>Original words</p>');
  window.Element.prototype.getBoundingClientRect = () => new window.DOMRect(0, -5000, 300, 20);
  const evidence = f.read();
  assert.equal(evidence.rootAligned, true);
  assert.deepEqual(compareCommentBodyPresentation(evidence).mismatches, []);
  assert.match(evidence.evidenceKind, /including offscreen nodes/);
  assert.match(evidence.evidenceKind, /No simultaneous viewport painting assertion/);
});

test('compares visible code/pre/list/table samples and catches their own inner backgrounds/borders', () => {
  const f = fixture('<p>Use <code>token</code></p><pre><code>value()</code></pre><ul><li>one</li></ul><table><tbody><tr><td>cell</td></tr></tbody></table>');
  const before = f.read();
  assert.deepEqual(compareCommentBodyPresentation(before).mismatches, []);
  assert.ok(before.samples.some((pair) => pair.category === 'inline code' && pair.decoration));
  assert.ok(before.samples.some((pair) => pair.category === 'block code' && pair.decoration));
  assert.ok(before.samples.some((pair) => pair.category === 'list'));
  assert.ok(before.samples.some((pair) => pair.category === 'table cell'));
  f.owned.querySelector('code').style.cssText = 'background-color:rgb(1,2,3);border-color:rgb(4,5,6)';
  const mismatch = compareCommentBodyPresentation(f.read()).mismatches;
  assert.ok(mismatch.some((item) => item.label.endsWith('.backgroundColor')));
  assert.ok(mismatch.some((item) => item.label.endsWith('.borderTopColor')));
});

test('compares actual inner table shadows instead of accepting matching text and background alone', () => {
  const f = fixture('<table><thead><tr><th>Filename</th></tr></thead></table>');
  f.native.querySelector('th').style.boxShadow = 'inset 0 -1px 0 rgb(91,92,93)';
  const mismatch = compareCommentBodyPresentation(f.read()).mismatches;
  assert.ok(mismatch.some((pair) => pair.label.includes('table cell') && pair.label.endsWith('.boxShadow')));
  f.owned.querySelector('th').style.boxShadow = 'inset 0 -1px 0 rgb(91,92,93)';
  assert.deepEqual(compareCommentBodyPresentation(f.read()).mismatches, []);
});

test('keeps closed native details content uncovered despite positive descendant rectangles', () => {
  const f = fixture('<details><summary><h3>Sequence Diagram</h3></summary><pre><code>Native Mermaid source</code></pre></details>');
  const closed = f.read();
  assert.ok(closed.samples.some((pair) => pair.category === 'heading'));
  assert.ok(!closed.samples.some((pair) => ['preformatted', 'block code'].includes(pair.category)));
  assert.ok(closed.uncovered.some((label) => label.includes('block code') && label.includes('not presented')));
  f.native.querySelector('details').open = true;f.owned.querySelector('details').open = true;
  const open = f.read();
  assert.ok(open.samples.some((pair) => pair.category === 'preformatted'));
  assert.ok(open.samples.some((pair) => pair.category === 'block code'));
  assert.deepEqual(compareCommentBodyPresentation(open).mismatches, []);
});

test('bounds scan count, per-kind sampling and report text without claiming absent tags beyond the scan', () => {
  const f = fixture(Array.from({ length: 130 }, (_, index) => `<p>Paragraph ${index}</p>`).join(''));
  const evidence = f.read();
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.samples.length, 4);
  assert.ok(evidence.uncovered.includes('comment body table: not observed in bounded native scan'));
  assert.ok(evidence.samples.every((pair) => pair.native.text.length <= 240));
  assert.ok(evidence.uncovered.includes('comment body: source scan limited to 120 nodes'));
});


const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
function harnessFunction(name, next, environment) {
  const begin = harness.indexOf(`async function ${name}(`) >= 0 ? harness.indexOf(`async function ${name}(`) : harness.indexOf(`function ${name}(`);
  const end = harness.indexOf(`\n${next}`, begin);
  assert.ok(begin >= 0 && end > begin);
  return new vm.Script(`(({${Object.keys(environment).join(',')}}) => (${harness.slice(begin, end)}))`).runInThisContext()(environment);
}

const sortableHeaders = () => ['Filename', 'Overview'].map((label, index) => `<th scope="col" aria-sort="none" class="gl-group/markdown-table-header"><div class="gl-flex"><button type="button" id="markdown-table-62-col_${index}-sort" class="gl-font-bold gl-text-inherit"><span>${label}</span></button></div></th>`).join('');
function inertHeaderLabels(root) {
  for (const button of root.querySelectorAll('th button')) {
    const label = document.createElement('span');
    label.dataset.geldNativeTableHeaderLabel = '';label.className = 'gl-font-bold gl-text-inherit';label.textContent = button.textContent;button.replaceWith(label);
  }
}

test('compares the actual button label weight instead of accepting equal normal-weight table cells', () => {
  const f = fixture(`<table><thead><tr>${sortableHeaders()}</tr></thead></table>`);
  document.head.insertAdjacentHTML('beforeend', '<style>th { font-weight:400 } button { font:inherit } .gl-font-bold { font-weight:700 }</style>');
  inertHeaderLabels(f.owned);
  const good = f.read();
  assert.deepEqual(compareCommentBodyPresentation(good).mismatches, []);
  assert.ok(good.samples.some((pair) => pair.category === 'table cell' && pair.native.style.fontWeight === '400'));
  assert.ok(good.samples.some((pair) => pair.category === 'table header label' && pair.native.style.fontWeight === '700' && pair.owned.style.fontWeight === '700'));
  f.owned.querySelector('[data-geld-native-table-header-label]').classList.remove('gl-font-bold');
  assert.ok(compareCommentBodyPresentation(f.read()).mismatches.some((pair) => pair.label.includes('table header label') && pair.label.endsWith('.fontWeight') && pair.native === '700' && pair.owned === '400'));
});

function richBotFixture({ reveal = true, captureEffect = () => {}, beforeProbe = () => {}, nativeDark = false, ownedDarkDrift = false } = {}) {
  const f = fixture(`<h3>Important Files Changed</h3><p>Update <code>insta360</code></p><ul><li>Published packages</li></ul><table><thead><tr>${sortableHeaders()}</tr></thead><tbody><tr><td>backend/pyproject.toml</td><td>Dependencies</td></tr></tbody></table><pre hidden><code>Closed Mermaid source</code></pre>`);
  inertHeaderLabels(f.owned);
  const review = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
  const anchor = 'note_3381334808';
  window.location.href = review;
  f.native.id = anchor;f.native.hidden = true;
  document.querySelector('article').setAttribute('data-geld-source', anchor);
  document.querySelector('.geld-provider-review__byline a').href = `${review}#${anchor}`;
  const listeners = new Map();const events = [];const item = {};const media = [];let reads = 0;
  const page = {
    on: (event, fn) => listeners.set(event, fn), off: (event) => listeners.delete(event), url: () => review,
    evaluate: async (fn, ...args) => { if (fn === commentBodyPresentationProbe) beforeProbe({ fixture: f, read: ++reads });return fn(...args); },
    emulateMediaFeatures: async (features) => {
      media.push(features);
      const dark = features[0]?.value === 'dark';
      f.native.querySelector('.body-copy').style.color = dark && nativeDark ? 'rgb(240,241,242)' : '';
      f.owned.style.color = dark && (nativeDark || ownedDarkDrift) ? 'rgb(240,241,242)' : '';
    },
    evaluateHandle: async (fn, ...args) => {
      const link = fn(...args);
      return { asElement: () => link === null ? null : { evaluate: async (read) => { if (read.toString().includes('scrollIntoView')) return;return read(link); }, click: async () => { events.push('real-control-protocol');if (reveal) f.native.hidden = false; } }, dispose: async () => {} };
    },
  };
  const read = harnessFunction('gitLabBotBodyEvidence', 'async function verifyGitLabBot', {
    assert, GL_BOT: review, safeUrl: (value) => value, openReviewAncestors: async () => 0,
    errorText: (error) => error.message,
    pause: async () => {},
    discardHandle: async (handle) => handle.dispose(), commentBodyPresentationProbe, compareCommentBodyPresentation,
    pollStable: async (read, accepts, label, ms, signature) => {
      assert.equal(ms, 8000);let previous;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const value = await read();const key = signature(value);
        if (accepts(value) && key === previous) return { ...value, stability: { samples: 2, stableMs: 1000, minimumMs: 200 } };
        previous = accepts(value) ? key : undefined;
      }
      throw new Error('Native and owned source must both be positively presented with all required rich formats');
    },
    capture: async () => { captureEffect({ fixture: f, listeners });return { screenshot: 'offline-layout-protocol-only.png' }; },
  });
  return { fixture: f, listeners, events, item, media, run: () => read(page, item) };
}

test('rich bot case reveals the mounted original and positively requires actual format samples without source reads', async () => {
  const f = richBotFixture();
  const result = await f.run();
  assert.equal(f.events.length, 1);
  assert.equal(result.beforeCapture.rootAligned, true);
  assert.equal(result.afterCapture.rootAligned, true);
  assert.deepEqual(result.sourceGets, []);
  assert.equal(result.status, 'passed');
  assert.equal(result.beforeCaptureSamples.length, 2);
  assert.equal(result.beforeCapture.stability.samples, 2);
  assert.ok(result.beforeCapture.samples.some((pair) => pair.category === 'heading'));
  assert.ok(result.beforeCapture.samples.some((pair) => pair.native.tag === 'TH' && pair.owned.text === 'Filename'));
  assert.ok(result.beforeCapture.uncovered.some((label) => label.includes('preformatted') && label.includes('not presented')));
  assert.equal(f.listeners.size, 0);
  assert.equal(result.darkPreferenceProbe.nativeThemeChanged, false);
  assert.equal(result.darkPreferenceProbe.status, 'native_scheme_unchanged');
  assert.equal(f.media.length, 2);
  assert.deepEqual(f.media[1], []);
});

test('rich body dark-preference evidence records only an actual native color change and restores it', async () => {
  const f = richBotFixture({ nativeDark: true });
  const result = await f.run();
  assert.equal(result.darkPreferenceProbe.nativeThemeChanged, true);
  assert.equal(result.darkPreferenceProbe.status, 'native_scheme_observed');
  assert.deepEqual(result.darkPreferenceProbe.measurement.mismatches, []);
  assert.equal(result.restoredAfterTheme.samples[0].native.style.color, result.beforeCapture.samples[0].native.style.color);
  assert.deepEqual(f.media[1], []);
  assert.deepEqual(result.sourceGets, []);
});

test('rich body dark-preference failure retains mismatched samples and still restores preference', async () => {
  const f = richBotFixture({ ownedDarkDrift: true });
  await assert.rejects(f.run(), /all required rich formats/);
  assert.equal(f.item.richBody.status, 'failed');
  assert.ok(f.item.richBody.darkPreferenceProbe.measurement.mismatches.some((pair) => pair.label.endsWith('.color')));
  assert.deepEqual(f.media[1], []);
  assert.equal(f.listeners.size, 0);
});

test('rich bot case refuses hidden native originals instead of accepting uncovered formats', async () => {
  const f = richBotFixture({ reveal: false });
  await assert.rejects(f.run(), /both be positively presented/);
  assert.equal(f.item.richBody.status, 'failed');
  assert.equal(f.item.richBody.beforeCapture.nativeRootPresent, false);
  assert.equal(f.item.richBody.beforeCaptureSamples.length, 3);
  assert.equal(f.listeners.size, 0);
});

test('rich bot case waits for two matching complete samples after a transient native clone remount', async () => {
  let label;
  const f = richBotFixture({ beforeProbe: ({ fixture, read }) => {
    const cell = fixture.owned.querySelector('th');
    if (read === 1) { label = cell.innerHTML;cell.textContent = ''; }
    if (read === 2) cell.innerHTML = label;
  } });
  const result = await f.run();
  assert.equal(result.status, 'passed');
  assert.equal(result.beforeCaptureSamples.length, 3);
  assert.equal(result.beforeCaptureSamples[0].rootAligned, false);
  assert.ok(result.beforeCaptureSamples.slice(1).every((sample) => sample.rootAligned));
  assert.deepEqual(result.sourceGets, []);
});

test('rich bot case refuses source text loss occurring during screenshot capture', async () => {
  const f = richBotFixture({ captureEffect: ({ fixture }) => { fixture.owned.querySelector('th').textContent = ''; } });
  await assert.rejects(f.run());
  assert.equal(f.item.richBody.status, 'failed');
  assert.equal(f.item.richBody.beforeCapture.rootAligned, true);
  assert.equal(f.item.richBody.afterCapture.rootAligned, false);
  assert.ok(f.item.richBody.afterCapture.mismatches.some((pair) => pair.label.includes('table cell')));
  assert.equal(f.item.richBody.artifacts.screenshot, 'offline-layout-protocol-only.png');
  assert.equal(f.listeners.size, 0);
});

test('rich bot case rejects an additional review-source GET during its local-only comparison', async () => {
  const f = richBotFixture({ captureEffect: ({ listeners }) => listeners.get('request')({ url: () => 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272/discussions.json', method: () => 'GET' }) });
  await assert.rejects(f.run(), /reuse mounted notes/);
  assert.equal(f.listeners.size, 0);
});

test('rich bot case requires known-present headings even when both copies lose the same format', async () => {
  const f = richBotFixture();
  f.fixture.native.querySelector('h3').remove();f.fixture.owned.querySelector('h3').remove();
  await assert.rejects(f.run(), /all required rich formats/);
  assert.equal(f.item.richBody.status, 'failed');
  assert.ok(f.item.richBody.beforeCapture.uncovered.includes('comment body heading: absent from this native fixture'));
  assert.equal(f.listeners.size, 0);
});

test('combined harness retains author assertions while adding matched comment body failures', async () => {
  const f = fixture('<p>Original</p>');
  f.owned.querySelector('p').style.color = 'rgb(1,2,3)';
  const body = f.read();
  const style = { fontFamily: 'Arial', fontSize: '14px', fontWeight: '500', lineHeight: '20px', color: 'black' };
  const sample = { text: 'Native author', presented: true, style };
  const native = { name: { native: sample, owned: { ...sample, style: { ...style, fontSize: '12px' } } }, aliasPair: { native: null, owned: null }, profile: { native: null, owned: null }, avatar: { native: null, owned: null }, badges: [], uncoveredNative: [] };
  const compare = harnessFunction('compareAuthorPresentation', 'async function authorThemeEvidence', {});
  const probe = harnessFunction('authorPresentationProbe', 'function compareAuthorPresentation', { openReviewAncestors: async () => [], commentBodyPresentationProbe, compareCommentBodyPresentation, compareAuthorPresentation: compare });
  const page = { evaluate: async (fn) => fn === commentBodyPresentationProbe ? body : native };
  const result = await probe(page, 'gitlab', f.anchor);
  assert.ok(result.mismatches.some((item) => item.label === 'author name.fontSize'));
  assert.ok(result.mismatches.some((item) => item.label.startsWith('comment body paragraph') && item.label.endsWith('.color')));
  const assertion = harnessFunction('assertAuthorThemeEvidence', 'async function bitbucketCommentDigest', { assert });
  assert.throws(() => assertion({ baseline: result, darkPreferenceProbe: { nativeThemeChanged: false } }), /author or comment body/);
});

test('OS dark evidence changes only for comparable native colors and never claims unselected Bitbucket dark', async () => {
  const f = fixture('<p>Original</p>', 'bitbucket');
  const body = f.read();
  const author = { name: { native: { style: { color: 'black' } } }, aliasPair: { native: null }, avatar: { native: null }, badges: [] };
  const baseline = { ...author, body };
  for (const nativeChanges of [false, true]) {
    const darkBody = structuredClone(body);
    if (nativeChanges) darkBody.samples[0].native.style.color = 'white';
    else darkBody.samples = darkBody.samples.slice(0, 1);
    const measurements = [baseline, { ...author, body: darkBody }];
    const media = [];
    const theme = harnessFunction('authorThemeEvidence', 'function assertAuthorThemeEvidence', { authorPresentationProbe: async () => measurements.shift(), pause: async () => {}, capture: async () => ({ kind: 'offline test only' }) });
    const result = await theme({ emulateMediaFeatures: async (value) => media.push(value) }, 'bitbucket', f.anchor);
    assert.equal(result.darkPreferenceProbe.nativeThemeChanged, nativeChanges);
    assert.equal(result.darkPreferenceProbe.bodyNativeThemeChanged, nativeChanges);
    assert.equal(result.darkPreferenceProbe.status, nativeChanges ? 'native_scheme_observed' : 'site_did_not_select_dark_theme');
    assert.equal(media.length, 2);
    assert.equal(media[1].length, 0);
  }
});


test('an unchanged native theme still rejects owned color drift during OS preference emulation', () => {
  const assertion = harnessFunction('assertAuthorThemeEvidence', 'async function bitbucketCommentDigest', { assert });
  const evidence = { baseline: { mismatches: [] }, darkPreferenceProbe: { nativeThemeChanged: false, status: 'site_did_not_select_dark_theme', measurement: { mismatches: [] } } };
  assert.doesNotThrow(() => assertion(evidence));
  evidence.darkPreferenceProbe.measurement.mismatches.push({ label: 'comment body paragraph.color', native: 'native light token', owned: 'incorrect OS dark token' });
  assert.throws(() => assertion(evidence), /provider preserved its selected theme/);
  evidence.darkPreferenceProbe.measurement.mismatches = [{ label: 'author name.color', native: 'native light token', owned: 'incorrect OS dark token' }];
  assert.throws(() => assertion(evidence), /provider preserved its selected theme/);
  assert.equal(evidence.darkPreferenceProbe.status, 'site_did_not_select_dark_theme');
});
