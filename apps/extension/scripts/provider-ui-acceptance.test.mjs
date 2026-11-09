import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { assertCompactProviderPopover, assertDiscoverableProviderCategories, assertProviderDashboard, assertVisibleProviderCounts, gitLabLocalReviewedCandidate, GITLAB_LOCAL_REVIEW, providerHeaderHintTarget, openProviderReviewAncestors, providerDashboardProbe, providerUiProbe, verifyGitLabCategoryFallback, verifyProviderDashboardUi } from './provider-ui-acceptance.mjs';

let window;
let saved;
beforeEach(() => {
  window = new Window({ url: 'https://gitlab.com/example/repo/-/merge_requests/1/diffs' });
  saved = Object.fromEntries(['document', 'location', 'getComputedStyle', 'innerWidth', 'innerHeight', 'requestAnimationFrame'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1440, innerHeight: 1000, requestAnimationFrame: window.requestAnimationFrame.bind(window) });
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
  delete globalThis.__geldDashboardPointerReceipt;
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key];else globalThis[key] = value; }
  window.happyDOM.abort();
});
function counts() {
  document.body.innerHTML = '<div class="geld-provider-header-line-counts"><span class="geld-provider-header-line-counts__add">+4</span><span class="geld-provider-header-line-counts__del">−0</span></div>';
}
function reviewCandidates(states) {
  document.body.innerHTML = '<section class="geld-provider-review"></section>';
  for (const [index, state] of states.entries()) {
    document.querySelector('section').insertAdjacentHTML('beforeend', `<article data-geld-item="item-${index}" data-state="${state}"><button data-geld-local-reviewed="item-${index}" aria-pressed="false">Mark reviewed</button><article data-geld-source="note_${index + 1}"><div class="geld-provider-review__byline"><a>Human</a></div></article></article>`);
    document.body.insertAdjacentHTML('beforeend', `<article id="note_${index + 1}"><div class="note-header"><a class="author-name-link" data-user-id="${index + 1}">Human</a></div></article>`);
  }
}
test('header hover uses the triggered tree hint even when an earlier NAV hint is visible', () => {
  document.body.innerHTML = '<nav><a>Diff</a><span class="geld-provider-header-stats" tabindex="0" data-geld-hover-bound data-left="900"><span class="geld-provider-header-hidden-count">1 test</span></span></nav><div id="file-tree"><section tabindex="0" data-geld-hover-bound><h5>Lines updated</h5><div class="stats"><span class="geld-provider-header-stats" tabindex="-1" data-geld-hover-bound data-left="30"><span class="geld-provider-header-hidden-count">1 test</span></span><span class="native-add">+41</span></div><span class="geld-provider-accessible-counts">counts</span></section></div>';
  const group = '#file-tree :has(> .geld-provider-accessible-counts)';
  const anchor = providerHeaderHintTarget(group);
  assert.equal(anchor, document.querySelector('#file-tree .geld-provider-header-stats'));
  assert.notEqual(anchor, document.querySelector('.geld-provider-header-stats'));
  assert.equal(providerHeaderHintTarget(group, 'keyboard'), document.querySelector('#file-tree section'));
  assert.equal(providerHeaderHintTarget('.native-add'), anchor, 'native signed leaf resolves its own surrounding statistics hint');
  document.querySelector('#file-tree .stats').insertAdjacentHTML('beforeend', '<span class="geld-provider-header-stats" data-geld-hover-bound tabindex="0">ambiguous</span>');
  assert.equal(providerHeaderHintTarget(group), null, 'duplicate associated anchors fail closed');
});
test('a keyboard-owned wrapper resolves itself, and hidden unrelated hints never become anchors', () => {
  document.body.innerHTML = '<div class="geld-provider-header-stats" hidden>old</div><section id="group"><span class="geld-provider-header-stats" tabindex="0" data-geld-hover-bound><span class="geld-provider-header-hidden-count">1 test</span></span></section>';
  const anchor = document.querySelector('#group .geld-provider-header-stats');
  assert.equal(providerHeaderHintTarget('#group'), anchor);
  assert.equal(providerHeaderHintTarget('#group', 'keyboard'), anchor);
  assert.equal(providerHeaderHintTarget('#group .geld-provider-header-stats'), anchor);
  anchor.hidden = true;assert.equal(providerHeaderHintTarget('#group'), null);
});
test('local-review selection skips earlier resolved and outdated humans before choosing actual actionable work', () => {
  reviewCandidates(['resolved', 'outdated', 'needs-reply']);
  assert.deepEqual(gitLabLocalReviewedCandidate().candidate, { id: 'item-2', humanAnchor: 'note_3', pressed: 'false', disabled: false });
});
test('local-review selection skips disabled, already reviewed and automated candidates and returns null without suitable work', () => {
  reviewCandidates(['open', 'open', 'open', 'addressed']);
  const buttons = document.querySelectorAll('[data-geld-local-reviewed]');buttons[0].disabled = true;buttons[1].setAttribute('aria-pressed', 'true');
  document.querySelectorAll('.geld-provider-review__byline')[2].insertAdjacentHTML('beforeend', '<span>Automated account</span>');
  assert.equal(gitLabLocalReviewedCandidate().candidate?.id, 'item-3');
  buttons[3].setAttribute('aria-disabled', 'true');assert.equal(gitLabLocalReviewedCandidate().candidate, null);
  assert.deepEqual(gitLabLocalReviewedCandidate().counts, { total: 4, truncated: false, human: 3, disabled: 2, pressed: 1, states: { open: 3, 'needs-reply': 0, addressed: 1, resolved: 0, outdated: 0, 'done-manual': 0, other: 0 } });
});
test('dedicated local-review fixture renews both the known source identity and actionable state live', () => {
  reviewCandidates(['open', 'open']);
  const required = { anchor: 'note_2', authorId: '2' };
  assert.equal(gitLabLocalReviewedCandidate(required).candidate?.id, 'item-1');
  assert.equal(gitLabLocalReviewedCandidate({ ...required, authorId: 'foreign' }).candidate, null);
  document.querySelector('[data-geld-item="item-1"]').setAttribute('data-state', 'resolved');
  assert.equal(gitLabLocalReviewedCandidate(required).candidate, null, 'a now-resolved retained source does not become a pass');
  assert.equal(GITLAB_LOCAL_REVIEW.url, 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117');
});
test('local-review failure diagnostics use only fixed state counters without source text', () => {
  reviewCandidates(['PRIVATE_CANARY']);
  const result = gitLabLocalReviewedCandidate();
  assert.equal(result.candidate, null);assert.equal(result.counts.states.other, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY|Human|note_1/);
});
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
test('GitLab native numeric leaves use their separate visible sibling signs', () => {
  document.body.innerHTML = '<div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><div aria-label="Added 4 lines." class="gl-flex"><div class="diff-stats-group gl-flex gl-items-center gl-text-success gl-font-bold"><span>+</span> <span data-testid="js-file-addition-line">4</span></div></div></div></div><span class="geld-provider-header-line-counts"><span class="geld-provider-header-line-counts__del">−0</span></span>';
  assertVisibleProviderCounts(providerUiProbe('gitlab'), { additions: 4, deletions: 0 });
  const sign = document.querySelector('.diff-stats-group > span');
  sign.style.visibility = 'hidden';assert.equal(providerUiProbe('gitlab').counts.additions.length, 0);
  sign.style.visibility = '';sign.textContent = '−';assert.equal(providerUiProbe('gitlab').counts.additions.length, 0);
  sign.textContent = '+';sign.parentElement.insertAdjacentHTML('afterbegin', '<span>+</span>');assert.equal(providerUiProbe('gitlab').counts.additions.length, 0);
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
  document.body.innerHTML = '<div class="issuable-discussion"><article id="note_1" data-testid="noteable-note-container" data-geld-provider-native-find="folded" hidden="until-found"><div class="timeline-content" style="background-color:rgb(255,255,255)">Native comment text</div></article></div><section class="geld-provider-review" data-provider="gitlab"><article data-geld-source="note_1">Digest copy</article><header data-geld-review-overview><span data-geld-review-metric="open">1</span><span data-geld-review-metric="comments">1</span><span data-geld-review-metric="activity">1</span></header><button data-geld-original-conversation>Show original conversation</button><section id="section-reviewers" data-geld-review-key="reviewers"><button id="reviewer-toggle" data-geld-review-toggle aria-controls="reviewers" aria-expanded="false">Reviews</button><div id="reviewers" class="geld-provider-review__section-content" aria-labelledby="reviewer-toggle" hidden></div></section><section id="section-checks" data-geld-review-key="checks"><button id="checks-toggle" data-geld-review-toggle aria-controls="checks" aria-expanded="true">CI checks</button><div id="checks" class="geld-provider-review__section-content" aria-labelledby="checks-toggle"></div></section></section>';
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
function semanticDashboard() {
  dashboard();
  document.querySelector('.timeline-content').innerHTML = '<div class="note-header"><div class="note-header-info"><a class="author-name-link">Author</a><a class="note-timestamp"><time datetime="2026-11-01T10:00:00Z">2 days ago</time></a></div><button>More actions</button><span role="status">Loading</span></div><div class="note-body"><div class="note-text md"><p>Native stable comment body</p></div></div>';
}
test('native timestamps and status/control labels may update while the original comment body remains pinned', () => {
  semanticDashboard();assertProviderDashboard(providerDashboardProbe('bind'));
  document.querySelector('time').textContent = '3 days ago';document.querySelector('.note-header button').textContent = 'Actions';document.querySelector('[role="status"]').textContent = '';
  const value = providerDashboardProbe();assertProviderDashboard(value);assert.equal(value.custody.unqualifiedPayloads, 0);
  document.querySelector('.note-text p').textContent = 'PRIVATE_CHANGED_BODY';
  const changed = providerDashboardProbe();assert.equal(changed.custody.bodyMismatches, 1);assert.equal(changed.sameOriginals, false);
  assert.throws(() => assertProviderDashboard(changed), /bodyMismatches/);assert.doesNotMatch(JSON.stringify(changed), /PRIVATE_CHANGED_BODY/);
});
test('body mismatch diagnostics identify bounded structural changes without exposing source values', () => {
  semanticDashboard();providerDashboardProbe('bind');
  document.querySelector('.note-text p').setAttribute('data-rendered', 'PRIVATE_ATTRIBUTE_VALUE');
  const changed = providerDashboardProbe();
  assert.equal(changed.sameOriginals, false);
  assert.equal(changed.bodyChanges.length, 1);
  assert.equal(changed.bodyChanges[0].source, 'note_1');
  assert.equal(changed.bodyChanges[0].difference.kind, 'attribute');
  assert.equal(changed.bodyChanges[0].difference.name, 'data-rendered');
  assert.deepEqual(changed.bodyChanges[0].beforeText, changed.bodyChanges[0].afterText);
  assert.doesNotMatch(JSON.stringify(changed), /PRIVATE_ATTRIBUTE_VALUE|Native stable comment body/);
});
test('GitLab may hydrate its verified table-height control without changing the retained table payload', () => {
  semanticDashboard();
  const body = document.querySelector('.note-text');
  body.innerHTML = '<div><div data-testid="table-shadow-overlay"><div id="table-scroll" data-sticky-header><table data-markdown-table-applied="true"><tbody><tr><td>Original table text</td></tr></tbody></table></div></div><!----></div>';
  providerDashboardProbe('bind');
  const wrapper = body.firstElementChild;
  wrapper.lastChild.replaceWith(document.createElement('div'));
  wrapper.lastChild.className = 'gl-order-1 gl-mt-2';
  wrapper.lastChild.innerHTML = '<button data-testid="markdown-table-height-toggle" aria-controls="table-scroll" aria-expanded="false">Show full table</button>';
  assertProviderDashboard(providerDashboardProbe());
  wrapper.querySelector('button').setAttribute('aria-expanded', 'true');
  wrapper.querySelector('button').textContent = 'Show less';
  assertProviderDashboard(providerDashboardProbe());
  wrapper.querySelector('td').textContent = 'Changed table text';
  assert.equal(providerDashboardProbe().sameOriginals, false);
});
test('a lookalike or incorrectly bound height control remains strict native payload', () => {
  semanticDashboard();
  document.querySelector('.note-text').innerHTML = '<div><div data-testid="table-shadow-overlay"><div id="table-scroll" data-sticky-header><table data-markdown-table-applied="true"><tbody><tr><td>Original table</td></tr></tbody></table></div></div><!----></div>';
  providerDashboardProbe('bind');
  document.querySelector('.note-text > div').insertAdjacentHTML('beforeend', '<div class="gl-order-1"><button data-testid="markdown-table-height-toggle" aria-controls="wrong-table" aria-expanded="false">Changed content</button></div>');
  assert.equal(providerDashboardProbe().sameOriginals, false);
});
test('native root replacement, reparenting, id changes and semantic body changes still fail custody', () => {
  for (const [kind, mutate] of [
    ['identityMismatches', node => node.replaceWith(node.cloneNode(true))],
    ['parentMismatches', node => { const parent = document.createElement('div');node.parentElement.append(parent);parent.append(node); }],
    ['idMismatches', node => { node.id = 'note_2'; }],
    ['bodyMismatches', node => { node.querySelector('.note-text').innerHTML = '<span>Native stable comment body</span>'; }],
  ]) {
    providerDashboardProbe('cleanup');semanticDashboard();providerDashboardProbe('bind');mutate(document.querySelector('#note_1'));
    const value = providerDashboardProbe();assert.equal(value.sameOriginals, false, kind);assert.equal(value.custody[kind], 1, kind);
  }
});
test('equivalent inner body or parent wrapper hydration preserves the exact original native source', () => {
  semanticDashboard();providerDashboardProbe('bind');
  const source = document.querySelector('#note_1');
  const body = source.querySelector('.note-text');body.replaceWith(body.cloneNode(true));
  assertProviderDashboard(providerDashboardProbe());
  const wrapper = source.querySelector('.note-body');wrapper.replaceWith(wrapper.cloneNode(true));
  assertProviderDashboard(providerDashboardProbe());
  assert.equal(document.querySelector('#note_1'), source);
});
test('grouped native notes retain their original identities, parents, payload count and ordering', () => {
  for (const [field, change] of [
    ['idMismatches', (root, note) => { note.id = 'note_3'; }],
    ['identityMismatches', (root, note) => { note.replaceWith(note.cloneNode(true)); }],
    ['parentMismatches', (root, note) => { const wrapper = document.createElement('div');root.append(wrapper);wrapper.append(note); }],
    ['payloadOrderMismatches', (root, note) => { root.append(note); }],
    ['bodyMismatches', (root, note) => { note.querySelector('.note-body').append(note.querySelector('.note-text').cloneNode(true)); }],
  ]) {
    providerDashboardProbe('cleanup');semanticDashboard();
    const note = document.querySelector('#note_1'), root = document.createElement('li');root.className = 'note-discussion';root.id = 'discussion';
    note.before(root);root.append(note);root.setAttribute('data-geld-provider-native-find', 'folded');root.setAttribute('hidden', 'until-found');note.removeAttribute('data-geld-provider-native-find');note.removeAttribute('hidden');
    const second = note.cloneNode(true);second.id = 'note_2';root.append(second);
    providerDashboardProbe('bind');change(root, note);
    const value = providerDashboardProbe();assert.equal(value.sameOriginals, false, field);assert.ok(value.custody[field] > 0, field);
  }
});
test('native system-event payload is pinned independently from its separate timestamp', () => {
  semanticDashboard();document.querySelector('.issuable-discussion').insertAdjacentHTML('beforeend', '<li class="js-timeline-entry system-note" id="note_2" data-geld-provider-native-find="folded" hidden="until-found"><div class="note-header-info"><span data-testid="system-note-content" class="system-note-message">approved this merge request</span><a class="note-timestamp"><time>2 days ago</time></a></div></li>');
  providerDashboardProbe('bind');document.querySelector('#note_2 time').textContent = '3 days ago';assertProviderDashboard(providerDashboardProbe());
  document.querySelector('[data-testid="system-note-content"]').textContent = 'unapproved this merge request';assert.equal(providerDashboardProbe().custody.bodyMismatches, 1);
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


for (const views of [false, true]) for (const scenario of ['success', 'callback-failure', 'layout-shift', 'reordered-sections', 'missed-click', 'replaced-control', 'invalid-expanded']) test(`dashboard pointer lifecycle: ${scenario}, three views=${views}`, async () => {
  dashboard();
  const original = document.querySelector('#note_1');
  const order = [];
  let target;
  let shifted = false;
  let reordered = false;
  document.elementFromPoint = () => target;
  for (const toggle of document.querySelectorAll('[data-geld-review-toggle]')) toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    document.getElementById(toggle.getAttribute('aria-controls')).hidden = !open;
    if (scenario === 'invalid-expanded') { toggle.removeAttribute('aria-expanded');document.getElementById(toggle.getAttribute('aria-controls')).hidden = true; }
    if (scenario === 'reordered-sections' && !reordered) {
      reordered = true;
      const reviews = document.querySelector('[data-geld-review-key="reviewers"]');
      reviews.before(document.querySelector('[data-geld-review-key="checks"]'));
    }
  });
  if (views) {
    document.querySelector('[data-geld-original-conversation]').remove();
    const navigation = document.createElement('nav');navigation.className = 'geld-provider-view';
    for (const value of ['digest', 'digest-timeline', 'github']) {
      const button = document.createElement('button');button.dataset.geldDigestView = value;button.setAttribute('aria-pressed', String(value === 'digest'));navigation.append(button);
      button.addEventListener('click', () => {
        const shown = value === 'digest-timeline';order.push(shown ? 'show' : 'hide');
        if (shown) original.removeAttribute('hidden');else original.setAttribute('hidden', 'until-found');
        for (const control of navigation.children) control.setAttribute('aria-pressed', String(control === button));
      });
    }
    document.body.prepend(navigation);
  } else document.querySelector('[data-geld-original-conversation]').addEventListener('click', () => {
    const shown = original.hasAttribute('hidden');order.push(shown ? 'show' : 'hide');
    if (shown) original.removeAttribute('hidden');else original.setAttribute('hidden', 'until-found');
  });
  const page = {
    evaluate: async (fn, value) => {
      if (scenario === 'layout-shift' && fn === providerDashboardProbe && value === 'read' && target && !shifted) { target.setAttribute('data-top', '100');shifted = true; }
      return fn(value);
    }, isClosed: () => false,
    $$: async selector => [...document.querySelectorAll(selector)].map(node => ({
      evaluate: async fn => { target = node;node.scrollIntoView = () => {};return fn(node); }, dispose: async () => {},
    })),
    mouse: { click: async (x, y) => {
      if (scenario === 'missed-click') return;
      if (scenario === 'replaced-control') { target.replaceWith(target.cloneNode(true));return; }
      const box = target.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
      const event = new window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'isTrusted', { value: true }); // Unit protocol only; Chromium replay supplies actual trusted input.
      target.dispatchEvent(event);
    } }, emulateMediaFeatures: async () => {},
  };
  const progress = {};
  const promise = verifyProviderDashboardUi(page, progress, {
    poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value));return value; }, capture: async () => 'fixture.png',
    onOriginalsShown: async snapshot => {
      order.push('callback');assert.equal(snapshot.originalVisible, 1);assert.equal(original.hasAttribute('hidden'), false);
      if (scenario === 'callback-failure') throw Error('Author comparison failed');
    },
  });
  if (scenario === 'callback-failure') await assert.rejects(promise, /Author comparison failed/);
  else if (scenario === 'missed-click' || scenario === 'replaced-control') await assert.rejects(promise, /must receive the trusted click/);
  else if (scenario === 'invalid-expanded') await assert.rejects(promise);
  else await promise;
  const missed = scenario === 'missed-click' || scenario === 'replaced-control' || scenario === 'invalid-expanded';
  assert.deepEqual(order, missed ? [] : ['show', 'callback', 'hide']);
  assert.equal(original.getAttribute('hidden'), 'until-found');
  if (!missed) assert.equal(progress.originalsHidden.originalVisible, 0);
  assert.equal(progress.clicks.length, missed ? 1 : 4);
  if (!missed) {
    const first = progress.clicks[0];
    assert.equal(first.point.sectionKey, 'reviewers');
    assert.equal(first.receipt.controlId, 'reviewer-toggle');
    assert.equal(first.receipt.trustedTargetCount, 1);
    assert.equal(first.receipt.before.target, 'false');
    assert.equal(first.receipt.immediate.current, 'true');
    assert.equal(first.receipt.microtask.current, 'true');
  }
  assert.equal(globalThis.__geldDashboardPointerReceipt, undefined);
});
