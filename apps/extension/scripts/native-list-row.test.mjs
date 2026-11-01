import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import { bitbucketListRowSnapshot, countHoverVisibilityProbe } from './native-list-row.mjs';

let window;
let previousDocument;
let previousStyle;
beforeEach(() => {
  window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED' });
  previousDocument = globalThis.document;
  previousStyle = globalThis.getComputedStyle;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  // Protocol fixtures exercise classification and hit evidence, not real browser layout.
  window.Element.prototype.getBoundingClientRect = function () { return new window.DOMRect(0, 0, 300, 20); };
  document.body.innerHTML = '<table><tbody><tr id="native-row" data-qa="pull-request-row"><td id="native-cell"><span id="native-content"><a id="native-title" data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a><span data-geld-ui class="geld-provider-list-counts" id="owned-count">0 tests · +46 −29</span></span><span id="_r1p_">Albert Sundjaja</span><ul id="_r20_" aria-label="avatar group"><li id="_r22_">Reviewer</li></ul><span id="_rh7_">, (opens new window)</span></td></tr></tbody></table>';
});
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  if (previousStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousStyle;
  window.happyDOM.abort();
});

const stableIdentity = (value) => ({ ids: value.nativeIds, links: value.nativeLinks });
const append = (html) => document.getElementById('native-cell').insertAdjacentHTML('beforeend', html);

test('keeps native row, content, title and accessibility IDs while excluding owned UI', () => {
  assert.deepEqual(bitbucketListRowSnapshot().nativeIds, ['native-row', 'native-cell', 'native-content', 'native-title', '_r1p_', '_r20_', '_r22_', '_rh7_']);
  assert.deepEqual(bitbucketListRowSnapshot().nativeLinks, [{ href: '/atlassian/bitbucket-upload-file/pull-requests/27', qa: 'pull-request-row-link' }]);
});

test('only semantically identified native tooltip IDs and links may expire', () => {
  append('<div id="_r1q_-tooltip" role="tooltip"><span id="native-tooltip-copy">Albert Sundjaja</span><a id="tooltip-profile" href="/asundjaja">Profile</a></div>');
  const initial = bitbucketListRowSnapshot();
  assert.deepEqual(initial.transientNativePopups, [{ id: '_r1q_-tooltip', tag: 'DIV', role: 'tooltip', popover: null, ids: ['_r1q_-tooltip', 'native-tooltip-copy', 'tooltip-profile'], links: [{ href: '/asundjaja', qa: null }] }]);
  document.getElementById('_r1q_-tooltip').remove();
  assert.deepEqual(stableIdentity(bitbucketListRowSnapshot()), stableIdentity(initial));
  assert.deepEqual(bitbucketListRowSnapshot().transientNativePopups, []);
});

test('actual native HTML popover semantics permit popup expiry without weakening content identity', () => {
  append('<div id="popover-ris" popover="auto"><span id="popup-title">PR preview</span></div>');
  const initial = bitbucketListRowSnapshot();
  assert.equal(initial.transientNativePopups[0].popover, 'auto');
  document.getElementById('popover-ris').remove();
  assert.deepEqual(stableIdentity(bitbucketListRowSnapshot()), stableIdentity(initial));
});

test('popup-looking names without semantic evidence stay strictly checked', () => {
  append('<span id="ordinary-tooltip">Persistent content</span><div id="popover-ordinary">Persistent content</div>');
  const initial = bitbucketListRowSnapshot();
  assert.ok(initial.nativeIds.includes('ordinary-tooltip') && initial.nativeIds.includes('popover-ordinary'));
  assert.deepEqual(initial.transientNativePopups, []);
  document.getElementById('ordinary-tooltip').remove();
  assert.throws(() => assert.deepEqual(stableIdentity(bitbucketListRowSnapshot()), stableIdentity(initial)));
});

for (const id of ['native-row', 'native-cell', 'native-content', 'native-title', '_r1p_', '_r20_', '_r22_', '_rh7_']) {
  test(`stable native ID ${id} cannot silently disappear`, () => {
    const initial = bitbucketListRowSnapshot();
    document.getElementById(id).removeAttribute('id');
    assert.throws(() => assert.deepEqual(stableIdentity(bitbucketListRowSnapshot()), stableIdentity(initial)));
  });
}

test('native source links remain strict when a real popup expires', () => {
  append('<div id="temporary-popup" role="tooltip">Preview</div><a id="native-status" href="/atlassian/bitbucket-upload-file/commits/9777bca47119">Commit</a>');
  const initial = bitbucketListRowSnapshot();
  document.getElementById('temporary-popup').remove();
  document.getElementById('native-status').href = '/different-commit';
  assert.throws(() => assert.deepEqual(stableIdentity(bitbucketListRowSnapshot()), stableIdentity(initial)));
});

test('the native row itself cannot be exempted by popup attributes', () => {
  document.getElementById('native-row').setAttribute('role', 'tooltip');
  assert.ok(bitbucketListRowSnapshot().nativeIds.includes('native-row'));
  assert.ok(bitbucketListRowSnapshot().nativeIds.includes('native-title'));
});

test('owned popups and their descendants are excluded rather than called native', () => {
  append('<div data-geld-ui role="tooltip" id="owned-popup"><a id="owned-link" href="/owned">Owned</a></div>');
  const snapshot = bitbucketListRowSnapshot();
  assert.ok(!snapshot.nativeIds.includes('owned-popup') && !snapshot.nativeIds.includes('owned-link'));
  assert.deepEqual(snapshot.transientNativePopups, []);
});

test('the relocated chip is read from its verified native titleline outside tooltip trigger ancestors', () => {
  document.getElementById('native-cell').innerHTML = '<div id="native-titleline"><div role="presentation"><span id="native-title-span" style="anchor-name: --anchor-native-title"><a id="native-title" data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span></div><span data-geld-ui class="geld-provider-list-counts">0 tests · +46 −29</span></div>';
  const result = bitbucketListRowSnapshot();
  assert.equal(result.text, '0 tests · +46 −29');
  assert.equal(result.chipMount.insideTitleSpan, false);
  assert.equal(result.chipMount.insideNativePresentation, false);
  assert.equal(result.titlePresentation.line.attributes.id, 'native-titleline');
  assert.ok(result.nativeIds.includes('native-title-span') && result.nativeIds.includes('native-title'));
});

test('a chip outside the selected native titleline is not borrowed from another responsive host', () => {
  document.getElementById('owned-count').remove();
  append('<span data-geld-ui class="geld-provider-list-counts">Wrong host</span>');
  assert.equal(bitbucketListRowSnapshot().text, null);
});

function hoverFixture({ overlay = false, pointerEvents = 'auto', nativeHit = false, overlayBounds = [25, 25, 90, 35] } = {}) {
  document.body.innerHTML = '<div data-geld-ui id="geld-provider-count-tooltip" role="tooltip"><div class="geld-provider-hover__row"><span class="geld-provider-hover__label">Essential</span><span>4 files</span><span>+41</span><span>−28</span></div></div>';
  const tip = document.getElementById('geld-provider-count-tooltip');
  const cells = [...tip.querySelectorAll('span')];
  const boxes = new Map([[tip, new window.DOMRect(20, 20, 360, 60)]]);
  for (let i = 0; i < cells.length; i += 1) boxes.set(cells[i], new window.DOMRect(30 + i * 80, 30, 70, 20));
  let popup;
  if (overlay) {
    document.body.insertAdjacentHTML('beforeend', `<div id="native-title-tooltip" role="tooltip" style="pointer-events:${pointerEvents};opacity:1">Native title</div>`);
    popup = document.getElementById('native-title-tooltip');
    boxes.set(popup, new window.DOMRect(...overlayBounds));
  }
  window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) ?? new window.DOMRect(); };
  document.createRange = () => {
    let node;
    return { selectNodeContents: (value) => { node = value; }, getBoundingClientRect: () => boxes.get(node) };
  };
  document.elementFromPoint = (x, y) => nativeHit && popup !== undefined && x < 115 && y < 60 ? popup : cells.find((node) => { const box = boxes.get(node);return x >= box.left && x <= box.right; }) ?? null;
}

test('visual evidence retains popup, row, cell and actual hit bounds', () => {
  hoverFixture();
  const result = countHoverVisibilityProbe();
  assert.equal(result.unobscured, true);
  assert.equal(result.rows[0].cells.length, 4);
  assert.deepEqual(result.rows[0].bounds, { left: 30, right: 340, top: 30, bottom: 50 });
  assert.equal(result.rows[0].cells[0].hit.ownedByTooltip, true);
});

test('a native tooltip intercepting an actual breakdown-cell hit fails visibility', () => {
  hoverFixture({ overlay: true, nativeHit: true });
  const result = countHoverVisibilityProbe();
  assert.equal(result.unobscured, false);
  assert.equal(result.rows[0].cells[0].hit.id, 'native-title-tooltip');
  assert.equal(result.rows[0].cells[0].potentialOccluders[0].id, 'native-title-tooltip');
});

test('pointer-events:none native tooltip overlap is still reported as potential visual occlusion', () => {
  hoverFixture({ overlay: true, pointerEvents: 'none' });
  const result = countHoverVisibilityProbe();
  assert.equal(result.rows[0].cells[0].hit.ownedByTooltip, true);
  assert.equal(result.unobscured, false);
  assert.equal(result.rows[0].cells[0].potentialOccluders[0].pointerEvents, 'none');
});

test('a native overlay intersecting only the text edge still fails when the center hit belongs to Geld', () => {
  hoverFixture({ overlay: true, overlayBounds: [25, 25, 20, 35] });
  const result = countHoverVisibilityProbe();
  const cell = result.rows[0].cells[0];
  assert.equal(cell.hit.ownedByTooltip, true);
  assert.ok(cell.center.x > cell.intersectingNativeOverlays[0].bounds.right);
  assert.equal(cell.potentialOccluders[0].pointerEvents, 'auto');
  assert.equal(result.unobscured, false);
});
