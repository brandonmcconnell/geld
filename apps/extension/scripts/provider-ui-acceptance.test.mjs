import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { assertCompactProviderPopover, assertDiscoverableProviderCategories, assertProviderDashboard, assertVisibleProviderCounts, openProviderReviewAncestors, providerDashboardProbe, providerUiProbe, verifyGitLabCategoryFallback } from './provider-ui-acceptance.mjs';

let window;
let saved;
beforeEach(() => {
  window = new Window({ url: 'https://gitlab.com/example/repo/-/merge_requests/1/diffs' });
  saved = Object.fromEntries(['document', 'location', 'getComputedStyle', 'innerWidth', 'innerHeight'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1440, innerHeight: 1000 });
  document.head.innerHTML = '<style>[hidden]{display:none}[hidden="until-found"]{display:block;content-visibility:hidden}</style>';
  window.Element.prototype.getBoundingClientRect = function () {
    const left = Number(this.getAttribute('data-left') ?? 20);
    const top = Number(this.getAttribute('data-top') ?? 20);
    return new window.DOMRect(left, top, Number(this.getAttribute('data-width') ?? 100), Number(this.getAttribute('data-height') ?? 20));
  };
  window.Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
});
afterEach(() => {
  providerDashboardProbe('cleanup');
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key];else globalThis[key] = value; }
  window.happyDOM.abort();
});
function counts() {
  document.body.innerHTML = '<div class="geld-provider-header-line-counts"><span class="geld-provider-header-line-counts__add">+4</span><span class="geld-provider-header-line-counts__del">−0</span></div>';
}
test('visible additions and deletions must both agree, rather than only a files badge', () => {
  counts();assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 });
  document.querySelector('.geld-provider-header-line-counts__add').textContent = '+36';
  assert.throws(() => assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 }), /additions/);
  document.body.innerHTML = '<a>2 files · 1 test</a>';
  assert.throws(() => assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 }), /visibly rendered/);
});
test('offscreen, hidden and zero-size counts do not qualify as visible line totals', () => {
  for (const change of [
    (node) => { node.parentElement.hidden = true; },
    (node) => { node.parentElement.style.display = 'none'; },
    (node) => { node.setAttribute('data-top', '1100'); },
    (node) => { node.setAttribute('data-width', '0'); },
  ]) {
    counts();change(document.querySelector('.geld-provider-header-line-counts__add'));
    assert.throws(() => assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 }), /visibly rendered/);
  }
});
test('visually presented native aria-hidden counter wrappers remain valid without reading accessible-only copies', () => {
  document.body.innerHTML = '<div id="file-tree"><div><span><h5>Lines updated</h5></span><div><span aria-hidden="true"><span>+41</span></span><span aria-hidden="true"><span>−28</span></span></div><span data-geld-ui>Added 46 lines Removed 29 lines</span></div></div>';
  assertVisibleProviderCounts(providerUiProbe('bitbucket'), { additions: 41, deletions: 28 });
});
test('native and fallback signs may independently complete the visible pair', () => {
  document.body.innerHTML = '<div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><span data-testid="js-file-addition-line">+4</span><span data-testid="js-file-deletion-line" hidden>−10</span></div></div><div class="geld-provider-header-line-counts"><span class="geld-provider-header-line-counts__del">−0</span></div>';
  assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 });
});
test('compact popover rejects old fixed-width sizing, clipping and missing viewport margins', () => {
  document.body.innerHTML = '<div class="geld-provider-hover" data-width="260"></div>';
  assertCompactProviderPopover(providerUiProbe('gitlab'));
  const popover = document.querySelector('.geld-provider-hover');
  popover.setAttribute('data-width', '420');
  assert.throws(() => assertCompactProviderPopover(providerUiProbe('gitlab')), /compact native width/);
  popover.setAttribute('data-width', '260');popover.setAttribute('data-left', '0');
  assert.throws(() => assertCompactProviderPopover(providerUiProbe('gitlab')), /margins/);
  popover.setAttribute('data-left', '20');Object.defineProperty(popover, 'scrollWidth', { value: 300 });Object.defineProperty(popover, 'clientWidth', { value: 260 });
  assert.throws(() => assertCompactProviderPopover(providerUiProbe('gitlab')), /clip/);
});
function categories() {
  document.body.innerHTML = '<aside data-geld-provider-category-placement="fallback"><button class="geld-provider-category-header" aria-controls="essential" aria-expanded="true">Essential (2 files)</button><div id="essential"></div><button class="geld-provider-category-header" aria-controls="tests" aria-expanded="false">Tests (1 file)</button><div id="tests" hidden></div></aside>';
}
test('both category controls must be visible, discoverable and bound to actual panels', () => {
  categories();assertDiscoverableProviderCategories(providerUiProbe('gitlab'));
  document.querySelectorAll('button')[1].setAttribute('data-top', '1200');
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /discoverable/);
  categories();document.querySelectorAll('button')[1].disabled = true;
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /actionable/);
  categories();document.querySelector('#tests').remove();
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /actual category panel/);
  categories();document.body.insertAdjacentHTML('beforeend', '<div id="tests"></div>');
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /actual category panel/);
});
test('a hidden native sidebar or duplicate visible copy cannot masquerade as the category entry point', () => {
  categories();document.querySelector('aside').hidden = true;
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /visible/);
  categories();document.body.append(document.querySelector('aside').cloneNode(true));
  assert.throws(() => assertDiscoverableProviderCategories(providerUiProbe('gitlab')), /One visible/);
});
test('fixed result shape does not serialize arbitrary source text, attributes or forms', () => {
  categories();document.body.insertAdjacentHTML('beforeend', '<form><input value="PRIVATE_CANARY"></form><article data-private="PRIVATE_CANARY">PRIVATE_CANARY</article>');
  assert.doesNotMatch(JSON.stringify(providerUiProbe('gitlab')), /PRIVATE_CANARY/);
});

function dashboard() {
  document.body.style.cssText = 'font-family:Arial;font-size:14px;color:rgb(23,23,23);background-color:rgb(255,255,255)';
  document.body.innerHTML = '<div class="issuable-discussion"><article id="note_1" data-testid="noteable-note-container" data-geld-provider-native-find="folded" hidden="until-found"><div class="timeline-content" style="background-color:rgb(255,255,255)">Native comment text</div></article></div><section class="geld-provider-review" data-provider="gitlab"><article data-geld-source="note_1">Digest copy</article><header data-geld-review-overview><span data-geld-review-metric="open">1</span><span data-geld-review-metric="comments">1</span><span data-geld-review-metric="activity">1</span></header><button data-geld-original-conversation>Show original conversation</button><section data-geld-review-key="reviewers"><button id="reviewer-toggle" data-geld-review-toggle aria-controls="reviewers" aria-expanded="false">Reviews</button><div id="reviewers" class="geld-provider-review__section-content" aria-labelledby="reviewer-toggle" hidden></div></section><section data-geld-review-key="checks"><button id="checks-toggle" data-geld-review-toggle aria-controls="checks" aria-expanded="true">CI checks</button><div id="checks" class="geld-provider-review__section-content" aria-labelledby="checks-toggle"></div></section></section>';
}
test('dashboard proof includes actual native suppression and exact original-node custody across restore', () => {
  dashboard();assertProviderDashboard(providerDashboardProbe('bind'));
  const native = document.querySelector('#note_1');native.removeAttribute('hidden');
  assertProviderDashboard(providerDashboardProbe(), true);
  assert.throws(() => assertProviderDashboard(providerDashboardProbe()), /visibility/);
  native.setAttribute('hidden', 'until-found');assertProviderDashboard(providerDashboardProbe());
  native.replaceWith(native.cloneNode(true));
  assert.throws(() => assertProviderDashboard(providerDashboardProbe()), /retained/);
});
test('legacy details-only UI and missing metrics cannot pass as a dashboard', () => {
  dashboard();document.querySelector('[data-geld-review-key]').outerHTML = '<details data-geld-review-key="reviewers"><summary>Reviews</summary></details>';
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /custom controls/);
  providerDashboardProbe('cleanup');dashboard();document.querySelector('[data-geld-review-metric="activity"]').remove();
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /metrics/);
});
test('native typography or color mismatches and missing original evidence fail', () => {
  dashboard();document.querySelector('.geld-provider-review').style.fontSize = '16px';
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /typography/);
  providerDashboardProbe('cleanup');dashboard();document.querySelector('.geld-provider-review').style.color = 'red';
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /colors/);
  providerDashboardProbe('cleanup');dashboard();document.querySelector('#note_1').remove();
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /original page/);
});
test('native card surface is independent from the page canvas and must not be owned by Geld', () => {
  dashboard();document.body.style.backgroundColor = 'rgb(236,236,239)';document.querySelector('.geld-provider-review').style.backgroundColor = 'rgb(255,255,255)';
  assertProviderDashboard(providerDashboardProbe('bind'));
  document.querySelector('.timeline-content').setAttribute('data-geld-ui', '');
  assert.throws(() => assertProviderDashboard(providerDashboardProbe()), /non-owned native card/);
});
test('dashboard diagnostics retain no original comment text or native URLs', () => {
  dashboard();document.querySelector('#note_1').textContent = 'PRIVATE_CANARY https://private.invalid/secret';
  const value = providerDashboardProbe('bind');assert.doesNotMatch(JSON.stringify(value), /PRIVATE_CANARY|private\.invalid/);
  document.querySelector('#note_1').textContent = 'Changed';assert.equal(providerDashboardProbe().sameOriginals, false);
});
test('a hidden marker without effective native suppression cannot pass the dashboard check', () => {
  dashboard();const original = document.querySelector('#note_1');original.style.contentVisibility = 'visible';
  assert.equal(original.getAttribute('hidden'), 'until-found');
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /visibility/);
});
test('one correctly hidden root cannot hide another represented source still visible below the digest', () => {
  dashboard();document.body.insertAdjacentHTML('beforeend', '<article id="note_2">Second original</article>');
  document.querySelector('.geld-provider-review').insertAdjacentHTML('beforeend', '<article data-geld-source="note_2">Second digest copy</article>');
  assert.throws(() => assertProviderDashboard(providerDashboardProbe('bind')), /Every represented native source/);
});
test('ancestor navigation opens custom dashboard controls before authored native details', async () => {
  document.body.innerHTML = '<section data-geld-review-key="comments"><button id="outer" data-geld-review-toggle aria-expanded="false">Comments</button><div hidden><details><summary id="inner">Authored detail</summary><span id="target">Body</span></details></div></section>';
  const calls = [];let disposed = 0;
  document.querySelector('#outer').addEventListener('click', () => { document.querySelector('#outer').setAttribute('aria-expanded', 'true');document.querySelector('section > div').hidden = false; });
  const page = { evaluateHandle: async (fn, selector) => {
    const node = fn(selector);
    return { asElement: () => node === null ? null : { click: async () => { calls.push(node.id);node.click(); } }, dispose: async () => { disposed++; } };
  } };
  assert.equal(await openProviderReviewAncestors(page, '#target'), 2);
  assert.deepEqual(calls, ['outer', 'inner']);assert.equal(disposed, 3);
});
for (const failure of [false, true]) test(`native sidebar fallback ${failure ? 'restores after an interaction failure' : 'uses the real control and returns to the sidebar'}`, async () => {
  categories();const sidebar = document.querySelector('aside');sidebar.removeAttribute('data-geld-provider-category-placement');
  const fallback = sidebar.cloneNode(true);fallback.setAttribute('data-geld-provider-category-placement', 'fallback');fallback.hidden = true;
  for (const node of fallback.querySelectorAll('[id]')) node.id = `fallback-${node.id}`;
  for (const node of fallback.querySelectorAll('[aria-controls]')) node.setAttribute('aria-controls', `fallback-${node.getAttribute('aria-controls')}`);
  document.body.append(fallback);
  const button = document.createElement('button');button.setAttribute('data-testid', 'file-tree-button');button.setAttribute('aria-label', 'Hide file browser');document.body.prepend(button);
  button.scrollIntoView = () => {};
  let clicks = 0;
  button.addEventListener('click', () => { clicks++;const close = button.getAttribute('aria-label') === 'Hide file browser';button.setAttribute('aria-label', close ? 'Show file browser' : 'Hide file browser');sidebar.hidden = close;fallback.hidden = !close; });
  const page = { $eval: async (selector, fn) => fn(document.querySelector(selector)), click: async (selector) => document.querySelector(selector).click(), evaluate: async (fn, arg) => fn(arg), isClosed: () => false };
  const poll = async (read, accepts) => { const value = await read();assert.ok(accepts(value));return value; };
  const promise = verifyGitLabCategoryFallback(page, {}, { poll, interact: async () => { if (failure) throw Error('Interaction failed');return { tested: true }; }, capture: async () => 'fixture.png' });
  if (failure) await assert.rejects(promise, /Interaction failed/);else await promise;
  assert.equal(clicks, 2);assert.equal(button.getAttribute('aria-label'), 'Hide file browser');assert.equal(sidebar.hidden, false);assert.equal(fallback.hidden, true);
});
