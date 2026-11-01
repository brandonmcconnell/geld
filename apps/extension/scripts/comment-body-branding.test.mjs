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
  assert.ok(evidence.uncovered.some((label) => label.includes('source order does not match')));
  assert.equal(evidence.rootAligned, false);
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
  assert.ok(f.read().uncovered.some((label) => label.includes('not visibly presented')));
  f.native.hidden = false;
  f.owned.remove();
  assert.deepEqual(compareCommentBodyPresentation(f.read()).mismatches, [{ label: 'comment body root', native: 'presented', owned: 'absent or not presented' }]);
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
