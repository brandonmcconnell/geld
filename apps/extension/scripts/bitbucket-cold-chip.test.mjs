import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { bitbucketColdChipVisibilityProbe, bitbucketCountIntentRequests } from './bitbucket-cold-chip.mjs';

const theme = readFileSync(new URL('../src/bitbucket/theme.css', import.meta.url), 'utf8');
const globals = ['document', 'getComputedStyle', 'innerWidth', 'innerHeight', 'fetch'];
let window;
let previous;
beforeEach(() => {
  previous = Object.fromEntries(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  window = new Window({ url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED', settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false, enableIframePageLoading: false } });
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  document.documentElement.dataset.geldProvider = 'bitbucket';
  // Reduced exact native PR25 title structure from installed run41354742920; geometry is protocol-only in these tests.
  document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td><div><div role="presentation"><span style="anchor-name:--anchor-_riq_" aria-describedby="_r1q_-tooltip"><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/25">PIPES-1569: Internal maintenance: Bump release pipe version. Add multi-platform build: linux/arm64 and linux/amd64.</a></span></div><span data-geld-ui class="geld-provider-list-counts" tabindex="0">Hover to count changes</span></div></td></tr></tbody></table>';
});
afterEach(() => {
  for (const key of globals) { const descriptor = previous[key]; if (descriptor === undefined) delete globalThis[key]; else Object.defineProperty(globalThis, key, descriptor); }
  window.happyDOM.abort();
});

function geometry({ clipped = false, hitNative = false, offscreen = false, hidden = false } = {}) {
  const chip = document.querySelector('.geld-provider-list-counts');
  const cell = document.querySelector('td');
  if (chip === null || cell === null) throw new Error('Missing fixture');
  const top = offscreen ? 650 : 10;
  window.Element.prototype.getBoundingClientRect = function () { return this === chip ? new window.DOMRect(200, top, hidden ? 0 : 160, 20) : new window.DOMRect(0, 0, 400, 200); };
  window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(200, top + 2, 160, 16);
  for (const [name, value] of Object.entries({ clientLeft: 0, clientTop: 0, clientWidth: clipped ? 300 : 400, clientHeight: 200 })) Object.defineProperty(cell, name, { configurable: true, value });
  cell.style.overflow = 'hidden';
  document.elementFromPoint = () => hitNative ? document.querySelector('a') : chip;
  return { chip, cell };
}

test('read-only coverage detects actual ancestor clipping even when the chip has positive dimensions', () => {
  geometry({ clipped: true });
  const result = bitbucketColdChipVisibilityProbe();
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].bounds.width, 160);
  assert.equal(result.rows[0].fullTextVisible, false);
  assert.equal(result.allVisible, false);
  assert.equal(result.rows[0].clip.right, 300);
});

test('covered cold text must fit and have unobscured edge and center hits without pointer/focus events', () => {
  const { chip } = geometry();
  let events = 0;
  let network = 0;
  globalThis.fetch = () => { network += 1; throw new Error('Read-only geometry attempted network'); };
  window.fetch = globalThis.fetch;
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'focus', 'focusin', 'click', 'scroll']) document.addEventListener(type, () => events += 1, true);
  window.Element.prototype.scrollIntoView = () => { throw new Error('Read-only geometry attempted scrolling'); };
  window.scrollTo = () => { throw new Error('Read-only geometry attempted scrolling'); };
  const original = document.body.innerHTML;
  const scroll = { root: document.documentElement.scrollTop, body: document.body.scrollTop, x: window.scrollX, y: window.scrollY };
  const focused = document.activeElement;
  const result = bitbucketColdChipVisibilityProbe();
  assert.equal(result.allVisible, true);
  assert.equal(result.rows[0].hitPoints.length, 3);
  assert.equal(events, 0);
  assert.equal(network, 0);
  assert.equal(document.body.innerHTML, original);
  assert.equal(document.activeElement, focused);
  assert.deepEqual({ root: document.documentElement.scrollTop, body: document.body.scrollTop, x: window.scrollX, y: window.scrollY }, scroll);
  geometry({ hitNative: true });
  assert.equal(bitbucketColdChipVisibilityProbe().allVisible, false);
});

test('independent native analytics, page resources and metadata do not establish count intent', () => {
  const requests = [
    { url: 'https://api.bitbucket.org/2.0/repositories/a/b/pullrequests/25', extensionInitiator: false },
    { url: 'https://bitbucket.org/!api/2.0/repositories/a/b/refs/branches/master', extensionInitiator: false },
    { url: 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/page.js', extensionInitiator: false },
    { url: 'https://bitbucket.org/analytics?path=/diff/', extensionInitiator: false },
  ];
  assert.deepEqual(bitbucketCountIntentRequests(requests), []);
});

test('extension-attributed metadata and native-proxy or canonical diff/config acquisition remain forbidden', () => {
  const requests = [
    { url: 'https://api.bitbucket.org/2.0/repositories/a/b', extensionInitiator: true },
    ...['https://api.bitbucket.org/2.0/', 'https://bitbucket.org/!api/2.0/'].flatMap((api) => ['pullrequests/25/diff', 'pullrequests/25/diffstat', 'diffstat/abc..def', 'src/abc/', 'src/abc/.github/', 'src/abc/.github/geld.yml', 'src/abc/.gitattributes'].map((resource) => ({ url: `${api}repositories/a/b/${resource}`, extensionInitiator: false }))),
  ];
  assert.deepEqual(bitbucketCountIntentRequests(requests), requests);
});

test('responsive hidden and off-screen duplicate hosts are explicitly skipped without fake coverage', () => {
  geometry({ hidden: true });
  assert.equal(bitbucketColdChipVisibilityProbe().skippedHidden, 1);
  assert.equal(bitbucketColdChipVisibilityProbe().allVisible, false);
  geometry({ offscreen: true });
  assert.equal(bitbucketColdChipVisibilityProbe().skippedOffscreen, 1);
  assert.equal(bitbucketColdChipVisibilityProbe().allVisible, false);
});

test('conditional typography-neutral CSS shrinks only verified text and reserves the owned chip', () => {
  const style = document.createElement('style');
  style.textContent = theme;
  document.head.append(style);
  const title = document.querySelector('a');
  const span = title.parentElement;
  const presentation = span.parentElement;
  const chip = document.querySelector('.geld-provider-list-counts');
  const native = presentation.outerHTML;
  assert.equal(getComputedStyle(presentation).minInlineSize, '0');
  assert.equal(getComputedStyle(presentation).textOverflow, 'ellipsis');
  assert.equal(getComputedStyle(presentation).overflow, 'hidden');
  assert.equal(getComputedStyle(chip).flexShrink, '0');
  assert.equal(presentation.outerHTML, native);
  assert.equal(span.style.anchorName, '--anchor-_riq_');
  assert.equal(span.getAttribute('aria-describedby'), '_r1q_-tooltip');
  chip.remove();
  assert.notEqual(getComputedStyle(presentation).textOverflow, 'ellipsis');
  assert.equal(presentation.outerHTML, native);
});
