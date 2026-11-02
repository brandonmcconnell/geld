import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { bitbucketSyntaxSettingsProbe as probe, observeBitbucketSyntaxSettings } from './bitbucket-syntax-settings.mjs';
import { assertBitbucketShellPreference } from './bitbucket-shell-acceptance.mjs';

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
const globals = ['document', 'location', 'Element', 'NodeFilter', 'getComputedStyle'];
const original = new Map(globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));let window;
beforeEach(() => {
  window = new Window({ url: URL });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? window.getComputedStyle.bind(window) : window[key] });
});
afterEach(() => { probe('cleanup');for (const [k, v] of original) if (v) Object.defineProperty(globalThis, k, v);else delete globalThis[k];window.happyDOM.abort(); });
function fixture() {
  document.body.innerHTML = '<div role="tabpanel" id="pull-request-tabs-1-tab"><button type="button" aria-label="Global diff settings">Settings</button><div><div id="chg-bitbucket-pipelines.yml"></div><article data-qa="branch-diff-file"><input type="checkbox"><div data-qa="code-line"><span data-key="code-line-number" data-new-line-number="1"></span><span data-line-type="+"><span>echo</span>hi</span><a id="L1" href="#L1">To line1</a></div></article></div></div>';
  for (const n of document.querySelectorAll('*')) n.getBoundingClientRect = () => ({ left: 1, right: 101, top: 1, bottom: 21, width: 100, height: 20 });
}
function dialog(checked = true) {
  document.body.insertAdjacentHTML('beforeend', '<form><div role="dialog"><label for="diff-settings-syntax-highlighting-toggle">Syntax highlighting</label><input type="checkbox" id="diff-settings-syntax-highlighting-toggle" name="enableSyntaxHighlighting"><button type="button">Cancel</button><button type="submit">Save</button></div></form>');
  document.getElementById('diff-settings-syntax-highlighting-toggle').checked = checked;
  for (const n of document.querySelectorAll('form,form *')) n.getBoundingClientRect = () => ({ left: 1, right: 101, top: 1, bottom: 21, width: 100, height: 20 });
}
test('DOM reads the real labeled checkbox, even native custom-checkbox opacity0, without toggling or submitting', () => {
  fixture();assert.equal(probe('setup').sameSource, true);dialog(false);
  const field = document.getElementById('diff-settings-syntax-highlighting-toggle');field.style.opacity = '0';
  const before = document.body.innerHTML;const value = probe();
  assert.equal(value.ready, true);assert.equal(value.checkbox.checked, false);assert.equal(value.cancelAvailable, true);assert.equal(document.body.innerHTML, before);assert.deepEqual(value.events, []);
});
for (const [name, mutate] of [
  ['native Text boundaries changed', () => { const code = document.querySelector('[data-line-type]');code.firstChild.firstChild.data = 'ech';code.lastChild.data = 'ohi'; }],
  ['native row replaced', () => { const row = document.querySelector('[data-qa="code-line"]');row.replaceWith(row.cloneNode(true)); }],
  ['native Viewed replaced', () => { const box = document.querySelector('article input');box.replaceWith(box.cloneNode(true)); }],
  ['native Viewed changed', () => { document.querySelector('article input').checked = true; }],
  ['line identity changed', () => { document.querySelector('[data-key]').setAttribute('data-new-line-number', '2'); }],
  ['selection changed', () => window.history.replaceState(null, '', URL + '#other')],
]) test('DOM rejects '+name, () => { fixture();probe('setup');mutate();assert.equal(probe().sameSource, false); });
test('DOM rejects duplicate, mislabeled or disabled preferences and excludes Save from Cancel', () => {
  fixture();probe('setup');dialog();const field = document.querySelector('form input');field.disabled = true;assert.equal(probe().ready, false);field.disabled = false;
  document.querySelector('label').textContent = 'Other preference';assert.equal(probe().ready, false);document.querySelector('label').textContent = 'Syntax highlighting';
  field.after(field.cloneNode());assert.equal(probe().ready, false);assert.equal(probe('cancel').textContent, 'Cancel');
});
test('DOM records unexpected preference input or submission without suppressing native events', () => {
  fixture();probe('setup');dialog();probe();document.querySelector('form input').dispatchEvent(new window.Event('change', { bubbles: true }));
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true }));assert.deepEqual(probe().events.map((e) => e.type), ['change', 'submit']);
});
test('DOM opener requires an original enabled native button in the actual Files changed tab', () => {
  fixture();probe('setup');const button = document.querySelector('button');assert.equal(probe('opener', button), true);
  button.disabled = true;assert.equal(probe('opener', button), false);button.disabled = false;
  button.setAttribute('data-geld-ui', '');assert.equal(probe('opener', button), false);button.removeAttribute('data-geld-ui');
  document.querySelector('[role="tabpanel"]').id = 'other-tab';assert.equal(probe('opener', button), false);
});
test('setup refuses an empty native article instead of claiming vacuous identity preservation', () => {
  fixture();document.querySelector('[data-qa="code-line"]').remove();assert.equal(probe('setup'), null);
});
test('rows outside the native file article cannot supply source evidence', () => {
  fixture();const article = document.querySelector('article');article.after(article.querySelector('[data-qa="code-line"]'));assert.equal(probe('setup'), null);
});
test('setup refuses missing or duplicate native articles and a bounded row scan refuses overflow', () => {
  fixture();const article = document.querySelector('article');article.removeAttribute('data-qa');assert.equal(probe('setup'), null);article.dataset.qa = 'branch-diff-file';
  article.after(article.cloneNode(true));assert.equal(probe('setup'), null);article.nextElementSibling.remove();
  const row = article.querySelector('[data-qa="code-line"]');for (let i = 0; i < 500; i += 1) article.append(row.cloneNode(true));assert.equal(probe('setup'), null);
});

function protocol(options = {}) {
  let open = false;let cycle = 0;let armed;let clicks = 0;let cleaned = false;const calls = [];const requests = [];
  const state = () => ({ sameSource: !(options.sourceChanged && cycle > 0 && !open), dialogCount: open || options.preexisting ? 1 : 0,
    ready: !options.missingCheckbox, cancelAvailable: !options.noCancel,
    checkbox: { checked: options.enabled !== false }, preferences: [{ id: 'syntax', checked: options.changedReadback && cycle === 2 ? false : options.enabled !== false }],
    events: options.changedEvent && cycle > 0 ? [{ type: 'change' }] : [] });
  const handle = (kind) => ({ asElement: () => options.noCancel ? null : handle('cancel'), evaluate: async () => calls.push('scroll-native-opener'), dispose: async () => {},
    click: async () => { calls.push(kind);clicks += 1;if (kind === 'open') { open = true;cycle += 1;if (options.nativeReads) requests.push({ method: 'GET', url: 'observed-native-only' }); } else if (!options.stuck) open = false; } });
  const page = { url: () => URL, isClosed: () => false,
    $$: async (selector) => { assert.equal(selector, '::-p-aria([name="Global diff settings"][role="button"])');return options.noOpener ? [] : options.duplicateOpener ? [handle('open'), handle('open')] : [handle('open')]; },
    evaluate: async (fn, action, target) => {
      assert.equal(fn, probe);
      if (action === 'cleanup') { cleaned = true;if (options.cleanupRejected) throw new Error('Native observation teardown rejected');return; }
      if (action === 'opener' || action === 'opener-hit') return !options.obstructed;
      if (action === 'arm') { armed = target;return true; }
      if (action === 'click-result') return { trusted: !options.untrusted, url: URL, control: { type: 'button' } };
      if (action === 'escape-result') return { trusted: !options.untrusted, url: URL };
      return state();
    },
    evaluateHandle: async () => handle('cancel'), keyboard: { press: async (key) => { assert.equal(key, 'Escape');calls.push('Escape');if (!options.stuck) open = false; } },
  };
  const progress = {};let reads = 0;
  const deps = { progress, requests: () => requests, assertCurrent: () => { if (options.routeChanged && cycle > 0) throw new Error('Current route changed'); },
    guardBudget: () => ({ observedWithinRollingHour: 10, budget: 40, buffer: 4 }),
    readState: async () => ({ count: options.countChanged && ++reads > 1 ? 6 : 5 }), assertState: (a, b) => assert.deepEqual(b, a),
    poll: async (read, accepts, label) => { const v = await read();assert.ok(accepts(v), label);return v; }, capture: async (_page, name) => ({ name }),
  };
  return { page, deps, progress, calls, cleaned: () => cleaned, clicks: () => clicks, open: () => open };
}
for (const enabled of [true, false]) test('protocol reads two fresh native '+enabled+' preferences with trusted Cancel and measured demand', async () => {
  const p = protocol({ enabled, nativeReads: true });await observeBitbucketSyntaxSettings(p.page, p.deps);
  assert.equal(p.progress.status, enabled ? 'native_enabled' : 'native_disabled');assert.equal(p.progress.enabled, enabled);assert.equal(p.progress.apiRequestDelta, 2);
  assert.deepEqual(p.calls.filter((x) => x !== 'scroll-native-opener'), ['open', 'cancel', 'open', 'cancel']);assert.equal(p.cleaned(), true);assert.equal(p.open(), false);assert.equal(p.progress.closeEvents.length, 2);
});
for (const options of [{ noOpener: true }, { duplicateOpener: true }, { obstructed: true }, { missingCheckbox: true }, { changedReadback: true }, { noCancel: true }]) test('protocol retains optional unavailable diagnostic '+JSON.stringify(options), async () => {
  const p = protocol(options);await observeBitbucketSyntaxSettings(p.page, p.deps);assert.equal(p.progress.status, 'unavailable');assert.equal(p.open(), false);assert.equal(p.cleaned(), true);
});
test('preexisting native dialog is never clicked or dismissed by the optional observer', async () => {
  const p = protocol({ preexisting: true });await observeBitbucketSyntaxSettings(p.page, p.deps);assert.equal(p.progress.status, 'unavailable');assert.deepEqual(p.calls, []);
});
for (const options of [{ stuck: true }, { sourceChanged: true }, { changedEvent: true }, { countChanged: true }, { routeChanged: true }, { untrusted: true }, { cleanupRejected: true }]) test('cleanup/source guard fails rather than skips '+JSON.stringify(options), async () => {
  const p = protocol(options);await assert.rejects(observeBitbucketSyntaxSettings(p.page, p.deps));assert.equal(p.progress.status, 'failed');assert.ok(p.progress.cleanupError);assert.equal(p.cleaned(), true);
  assert.equal(typeof p.progress.apiRequestDelta, 'number');
});
test('only absence of observed native preference remains uncovered; disabled plus positive owned ranges fails', () => {
  assert.throws(() => assertBitbucketShellPreference({ status: 'native_disabled' }, { ownedCount: 1 }), /coexist/);
  assert.doesNotThrow(() => assertBitbucketShellPreference({ status: 'native_disabled' }, { ownedCount: 0 }));
  assert.doesNotThrow(() => assertBitbucketShellPreference({ status: 'unavailable' }, { ownedCount: 1 }));
});
