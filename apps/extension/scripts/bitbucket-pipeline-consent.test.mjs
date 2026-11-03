import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test, beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { bitbucketPipelineConsentProbe as probe, prepareBitbucketPipelineConsent as prepare } from './bitbucket-pipeline-consent.mjs';
import { bitbucketSyntaxSettingsProbe as sourceProbe } from './bitbucket-syntax-settings.mjs';
const REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff#chg-pipe%2Fpipe.py';
const globals = ['document', 'location', 'Element', 'NodeFilter', 'getComputedStyle', 'innerWidth', 'innerHeight'];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));let window;
beforeEach(() => {
  window = new Window({ url: REVIEW });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? window.getComputedStyle.bind(window) : key === 'innerWidth' || key === 'innerHeight' ? 1000 : window[key] });
});
afterEach(() => { probe('cleanup');sourceProbe('cleanup');for (const [key, value] of originals) if (value) Object.defineProperty(globalThis, key, value);else delete globalThis[key];window.happyDOM.abort(); });
// Reduced PR240 native structure. Synthetic dimensions and hit-testing exercise refusal only.
function fixture() {
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user="{&quot;isAuthenticated&quot;:false}">';
  document.body.innerHTML = '<div id="unsafe-design-system-page-layout-root"><div data-layout-slot="true"><section role="dialog" aria-labelledby="cookiesTrackingNoticeLink"><a id="cookiesTrackingNoticeLink" href="https://www.atlassian.com/legal/cookies">Cookies</a><button type="button" data-testid="preferences-button">Preferences</button><button type="button" data-testid="only-necessary-button">Only necessary</button><button type="button" data-testid="accept-all-button">Accept all</button></section></div></div>';
  for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 24, right: 110, bottom: 44 });
  document.elementFromPoint = () => document.querySelector('[data-testid="only-necessary-button"]');
}
test('exact original public banner arms only Only necessary and never alters native DOM or preferences', () => {
  fixture();const html = document.documentElement.outerHTML;const before = probe();assert.equal(before.status, 'ready');assert.equal(before.anonymous, true);assert.equal(before.legalUrl, 'https://www.atlassian.com/legal/cookies');
  probe('arm');const button = probe('button');assert.equal(button.getAttribute('data-testid'), 'only-necessary-button');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));assert.notEqual(probe('click-result').trusted, true);
  assert.equal(document.documentElement.outerHTML, html);probe('cleanup');assert.equal(probe('button'), null);
});
test('absent banner produces no action contract', () => { fixture();document.querySelector('[role="dialog"]').remove();assert.equal(probe().status, 'not_present');assert.equal(globalThis.__geldBitbucketPipelineConsent, undefined); });
for (const [name, mutate] of [
  ['authenticated viewer', () => document.querySelector('meta').setAttribute('data-current-user', '{"isAuthenticated":true}')],
  ['unknown viewer', () => document.querySelector('meta').remove()],
  ['malformed bootstrap', () => document.querySelector('meta').setAttribute('data-current-user', '{')],
  ['duplicate bootstrap', () => document.head.append(document.querySelector('meta').cloneNode(true))],
  ['legal URL changed', () => document.querySelector('a').setAttribute('href', 'https://example.org/cookies')],
  ['ambiguous dialog', () => { const clone = document.querySelector('[role="dialog"]').cloneNode(true);clone.getBoundingClientRect = () => ({ width: 10, height: 10 });document.body.append(clone); }],
  ['unknown modal', () => document.querySelector('[role="dialog"]').setAttribute('aria-labelledby', 'other')],
  ['non-layout banner', () => document.body.append(document.querySelector('[data-layout-slot]'))],
  ['owned banner', () => document.querySelector('[role="dialog"]').setAttribute('data-geld-ui', '')],
  ['comment body banner', () => document.querySelector('[data-layout-slot]').className = 'ak-renderer-document'],
  ['disabled button', () => { document.querySelector('[data-testid="only-necessary-button"]').disabled = true; }],
  ['ARIA-disabled button', () => document.querySelector('[data-testid="only-necessary-button"]').setAttribute('aria-disabled', 'true')],
  ['changed label', () => { document.querySelector('[data-testid="only-necessary-button"]').textContent = 'Accept all'; }],
  ['submit control', () => { document.querySelector('[data-testid="only-necessary-button"]').type = 'submit'; }],
  ['covered control', () => { document.elementFromPoint = () => document.querySelector('[data-testid="accept-all-button"]'); }],
  ['different review', () => window.history.replaceState(null, '', REVIEW.replace('/27/', '/28/'))],
]) test('native consent declines ' + name, () => { fixture();mutate();assert.equal(probe().status, 'unavailable');assert.equal(globalThis.__geldBitbucketPipelineConsent, undefined); });
test('replaced identical-looking native button cannot inherit the armed click capability', () => { fixture();probe('arm');const button = document.querySelector('[data-testid="only-necessary-button"]');const replacement = button.cloneNode(true);replacement.getBoundingClientRect = button.getBoundingClientRect;button.replaceWith(replacement);assert.equal(probe().sameControl, false);assert.equal(probe('button'), null); });
test('hidden native banner is absent and never clicked', () => { fixture();document.querySelector('[role="dialog"]').hidden = true;assert.equal(probe().status, 'not_present'); });

function protocol(options = {}) {
  const page = new EventEmitter();let clicked = false;let armed = false;let checks = 0;let disposed = false;const cleaned = [];const progress = {};
  const source = () => ({ url: REVIEW, sameSource: !(options.changedSource && clicked), sourceRows: 4, viewed: [false], events: options.preferenceWrite && clicked ? [{ type: 'change' }] : [] });
  const native = () => clicked || options.absent ? { status: 'not_present', url: REVIEW } : { status: options.unavailable ? 'unavailable' : 'ready', url: REVIEW, sameControl: armed && !options.replaced, anonymous: true };
  page.url = () => REVIEW;page.isClosed = () => false;
  page.evaluate = async (fn, action) => {
    if (action === 'cleanup') { cleaned.push(fn);if (options.cleanupRejected && fn === probe) throw new Error('Consent cleanup rejected');return; }
    if (fn === sourceProbe) return source();
    assert.equal(fn, probe);
    if (action === 'arm') { armed = true;return native(); }
    if (action === 'click-result') return { trusted: !options.untrusted, detail: 1, nativeButton: true, label: 'Only necessary', url: REVIEW };
    return native();
  };
  const handle = { asElement: () => options.missingControl ? null : handle, dispose: async () => { disposed = true; }, click: async () => {
    clicked = true;const url = 'https://bitbucket.org/gateway/consent/synthetic?secret=value';
    page.emit('request', { url: () => url, method: () => 'POST' });page.emit('response', { url: () => url, status: () => 204 });
  } };
  page.evaluateHandle = async () => handle;
  const call = () => prepare(page, { progress, freshAnonymousProfile: !options.notFresh,
    poll: async (read, predicate) => { const value = await read();assert.equal(predicate(value), true);return value; },
    guardBudget: () => { checks++;if (options.budgetChanged && armed) throw new Error('Budget exhausted');return { active: 16, budget: 40 }; },
    flush: async () => {}, assertCurrent: () => { if (options.headChanged && armed) throw new Error('Head changed');return { head: 'a'.repeat(40) }; },
    readState: async () => ({ counts: { files: clicked && options.countChanged ? 4 : 5 }, state: { complete: true } }), assertState: (before, after) => assert.deepEqual(after, before), safeUrl: (url) => new URL(url).origin + new URL(url).pathname,
  });
  return { call, progress, page, cleaned, clicked: () => clicked, disposed: () => disposed, checks: () => checks };
}
test('full trusted Only necessary preparation records all HTTP and unchanged source/head/counts, removing all listeners', async () => {
  const value = protocol();await value.call();assert.equal(value.progress.status, 'prepared');assert.equal(value.clicked(), true);assert.ok(value.checks() >= 3);assert.equal(value.disposed(), true);
  assert.deepEqual(value.progress.sourceBefore, value.progress.sourceAfter);assert.deepEqual(value.progress.headBefore, value.progress.headAfter);assert.equal(value.progress.traffic.length, 2);assert.equal(value.progress.traffic[0].method, 'POST');assert.doesNotMatch(JSON.stringify(value.progress.traffic), /secret|value/);
  assert.deepEqual(value.cleaned, [probe, sourceProbe]);assert.equal(value.page.listenerCount('request'), 0);assert.equal(value.page.listenerCount('response'), 0);
});
test('full preparation does nothing when native banner is missing', async () => { const value = protocol({ absent: true });await value.call();assert.equal(value.progress.status, 'not_present');assert.equal(value.clicked(), false);assert.deepEqual(value.progress.actions, []); });
for (const [name, options, clicked] of [
  ['profile not fresh', { notFresh: true }, false], ['unknown modal', { unavailable: true }, false], ['native control replaced', { replaced: true }, false], ['native control disappears', { missingControl: true }, false],
  ['head changes before click', { headChanged: true }, false], ['budget changes before click', { budgetChanged: true }, false], ['untrusted event', { untrusted: true }, true], ['original source changes', { changedSource: true }, true],
  ['native preference input', { preferenceWrite: true }, true], ['counts change', { countChanged: true }, true], ['cleanup rejects', { cleanupRejected: true }, true],
]) test('full preparation fails honestly when ' + name, async () => { const value = protocol(options);await assert.rejects(value.call());assert.equal(value.progress.status, 'failed');assert.equal(value.clicked(), clicked);assert.equal(value.page.listenerCount('request'), 0);assert.equal(value.page.listenerCount('response'), 0);assert.deepEqual(value.cleaned, [probe, sourceProbe]);if (options.cleanupRejected) assert.match(value.progress.cleanupErrors[0], /cleanup rejected/); });
