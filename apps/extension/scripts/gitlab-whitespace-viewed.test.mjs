import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { GITLAB_WHITESPACE as F, cleanupGitLabWhitespace, gitLabWhitespaceSettings, observeGitLabWhitespace, verifyGitLabWhitespace, whitespaceReceiptURL } from './gitlab-whitespace-viewed.mjs';
import { gitLabWhitespaceProbe as probe } from './gitlab-whitespace-probe.mjs';

const T = 'c'.repeat(40);
function state() {
  return { qualified: true, anonymous: true, url: F.url, initialShowWhitespace: false, checked: false, other: { fileByFile: false }, open: false, bound: false, events: [], eventOverflow: false,
    nativeStream: { resource: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream', diffId: F.version, view: 'inline', requestSourceHead: 'absent', requestTargetHead: 'absent' },
    app: { path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, fileByFileMode: false,
      sourceVersions: [{ id: 2158520123, head_sha: F.head, selected: true, is_merge_head: false, href: F.url }],
      targetVersions: [{ id: 2159233785, head_sha: T, selected: true, is_merge_head: true, href: F.url }] },
    files: F.paths.map((path, i) => ({ path, anchor: String(i).repeat(40), head: T, mounted: true, rows: 1, sha256: 'a'.repeat(64), viewed: { checked: false, disabled: true } })) };
}
function evidence() {
  return { responses: [{ kind: 'versions', status: 'projected', projection: { source: { selectedCount: 1, values: [{ id: F.version, headSha: F.head }] }, target: { selectedCount: 1, values: [{ id: '2159233785', headSha: T }] } } },
    { kind: 'metadata', status: 'projected', projection: { projectPath: 'gitlab-org/gitlab', diffId: F.version, inventory: { state: 'observed', scanComplete: true, total: 3, uniqueNewPaths: 3, size: 3, realSize: 3, overflow: false, paths: F.paths.map((newPath) => ({ newPath, deleted: false, submodule: false })) } } }] };
}
async function protocol(options = {}) {
  let live = state();let closed = false;let phase = 'baseline';let clicks = 0;let writes = 0;let readinessReads = 0;const order = [];const progress = {};const settingsProgress = {};
  if (options.mountPending) live.files.forEach((file) => { file.mounted = false; });
  const original = { sync: { present: true, value: { enabled: false, keep: 'DO_NOT_RETAIN_SETTINGS_CANARY' } }, local: { present: false } };let storage = structuredClone(original);
  const settings = gitLabWhitespaceSettings({ progress: settingsProgress, read: async () => structuredClone(storage), write: async (value) => { writes++;storage = structuredClone(value);order.push(closed ? 'restore-after-close' : 'prepare'); } });
  await settings.prepare();
  const observer = { evidence: { modes: [], nonreads: [], overflow: false }, bind: (value) => assert.deepEqual(value, state().nativeStream),
    phase: (value) => { phase = value;if (options.revertBeforeRestore && value === 'restore') live.checked = false; }, dispose: async () => { order.push('observer');if (options.observerFailure) throw Error('DO_NOT_RETAIN_OBSERVER_CANARY'); } };
  const comparisons = { checkpoint: async () => {}, dispose: async () => { order.push('comparisons');if (options.comparisonFailure) throw Error('DO_NOT_RETAIN_COMPARISON_CANARY'); } };
  const page = {
    isClosed: () => closed, close: async () => { order.push('close');if (options.closeFailure) throw Error('DO_NOT_RETAIN_CLOSE_CANARY');closed = true; },
    evaluate: async (fn, action) => {
      assert.equal(fn, probe);
      if (action === 'read' && !live.armed && options.mountPending) {
        readinessReads++;
        if (readinessReads === 2) {
          live.files.forEach((file) => { file.mounted = true; });
          if (options.mountScopeChanged) { live.app.targetVersions[0].head_sha = 'b'.repeat(40);live.files.forEach((file) => { file.head = 'b'.repeat(40); }); }
          if (options.mountUnknownControl) { live.qualified = false;live.code = 'MENU_SCHEMA_UNQUALIFIED'; }
        }
      }
      if (action === 'cleanup') { order.push('release');if (options.probeCleanupFailure) throw Error('DO_NOT_RETAIN_CLEANUP_CANARY');return { released: true }; }
      if (action === 'arm-opener') live.armed = true;
      if (action === 'bind') live.bound = true;
      if (options.unknown) return { qualified: false, code: 'MENU_SCHEMA_UNQUALIFIED' };
      return structuredClone(live);
    },
    evaluateHandle: async (fn, action) => {
      assert.equal(fn, probe);assert.ok(['opener', 'toggle-target'].includes(action));
      return { asElement: () => ({ evaluate: async () => true, click: async () => {
        assert.equal(live.files.every((file) => file.mounted), true, 'Native action preceded complete source mounting');
        clicks++;if (action === 'opener') { live.open = true;live.events.push({ kind: 'opener', type: 'click', trusted: !options.untrustedOpener });return; }
        const desired = !live.checked;live.checked = desired;
        live.events.push({ kind: 'whitespace', type: 'change', trusted: !options.untrusted, checked: desired });
        observer.evidence.nonreads.push({ method: 'PUT', resource: 'https://gitlab.com/api/v4/user/preferences', status: 401, phase, provenance: 'unattributed_browser_request' });
        if (options.revert && phase === 'toggle') live.checked = !desired;
        else if (options.rejectRestore && phase === 'restore') live.checked = !desired;
        else observer.evidence.modes.push({ phase, eligible: true, nativeFrame: true, extensionFrame: false, ignoreWhitespace: !desired, status: 200, finished: true });
        if (options.authAfterToggle && phase === 'toggle') { live.qualified = false;live.code = 'ACTOR_UNQUALIFIED'; }
        if (options.unknownAfterToggle && phase === 'toggle') { live.qualified = false;live.code = 'MENU_SCHEMA_UNQUALIFIED'; }
        if (options.headAfterToggle && phase === 'toggle') live.app.targetVersions[0].head_sha = 'b'.repeat(40);
      } }), dispose: async () => {} };
    },
  };
  const poll = async (read, accepts) => { for (let i = 0; i < 4; i++) { const value = await read();if (accepts(value)) return value; }throw Object.assign(Error('Unit deadline'), { code: 'OBSERVATION_DEADLINE' }); };
  return { page, progress, settingsProgress, observer, comparisons, order, original, storage: () => storage, clicks: () => clicks, writes: () => writes, readinessReads: () => readinessReads,
    run: () => verifyGitLabWhitespace(page, { settings, observer, comparisons, acquisition: () => {
      if (options.noAcquisition) return {};
      const value = evidence();if (options.incompleteInventory) value.responses[1].projection.inventory.realSize = 4;return value;
    }, poll, progress }), settings };
}

test('actual orchestrator observes natural anonymous401 plus local transition, restores native flag then exact raw keys after close', async () => {
  const f = await protocol();const result = await f.run();assert.equal(result.status, 'discovery');assert.equal(f.progress.nativeRestored, true);assert.equal(f.progress.restoration.snapshot.checked, false);
  assert.equal(f.clicks(), 3);assert.deepEqual(f.observer.evidence.nonreads.map((v) => v.status), [401, 401]);assert.equal(f.progress.nativeMode, 'native_frame_mode_response_observed');
  assert.deepEqual(f.storage(), f.original);assert.equal(f.settingsProgress.restoredAfterPageClose, true);assert.ok(f.order.indexOf('close') < f.order.indexOf('restore-after-close'));
  assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
test('qualified but still mounting source waits for the same pinned inventory before the first native action', async () => {
  const f = await protocol({ mountPending: true });assert.equal((await f.run()).status, 'discovery');assert.ok(f.readinessReads() >= 2);assert.equal(f.clicks(), 3);assert.equal(f.progress.nativeRestored, true);assert.deepEqual(f.storage(), f.original);
});
for (const option of ['mountScopeChanged', 'mountUnknownControl']) test(`mount readiness never retries ${option} or adopts another initial source`, async () => {
  const f = await protocol({ mountPending: true, [option]: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.readinessReads(), 2);assert.equal(f.clicks(), 0);assert.equal(f.progress.baseline, undefined);assert.deepEqual(f.storage(), f.original);
});
test('native revert is characterized without forcing checked state or inventing a successful reload', async () => {
  const f = await protocol({ revert: true });assert.equal((await f.run()).status, 'unavailable');assert.equal(f.clicks(), 2);assert.equal(f.progress.stages[0].status, 'native_reverted');assert.equal(f.progress.propertyVectorRestored, true);assert.equal(f.progress.nativeRestored, false);assert.equal(f.progress.effectiveModeRestored, 'unverified');assert.deepEqual(f.storage(), f.original);
});
test('completed desired-mode GET plus checkbox revert cannot fabricate effective-source restoration or force another toggle', async () => {
  const f = await protocol({ revertBeforeRestore: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.stages[0].snapshot.checked, true);assert.equal(f.progress.afterToggle.checked, true);
  assert.equal(f.observer.evidence.modes.some((value) => value.phase === 'toggle' && value.eligible && value.finished && value.status === 200), true);
  assert.equal(f.progress.restoration.status, 'property_already_matches');assert.equal(f.progress.propertyVectorRestored, true);assert.equal(f.progress.effectiveModeRestored, 'unverified');assert.equal(f.progress.nativeRestored, false);
  assert.ok(f.progress.cleanup.codes.includes('EFFECTIVE_MODE_RESTORE_UNVERIFIED'));assert.equal(f.clicks(), 2);assert.deepEqual(f.storage(), f.original);
});
for (const option of ['unknown', 'untrusted', 'untrustedOpener', 'noAcquisition', 'incompleteInventory', 'authAfterToggle', 'headAfterToggle', 'unknownAfterToggle']) test(`${option} refuses capability and still restores raw settings after page close`, async () => {
  const f = await protocol({ [option]: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.page.isClosed(), true);assert.deepEqual(f.storage(), f.original);
  if (option === 'unknown') { assert.equal(f.clicks(), 0);assert.equal(f.progress.baseline, undefined);assert.equal(f.order.includes('release'), false); }
  if (option === 'noAcquisition') assert.equal(f.clicks(), 1);
  if (option === 'incompleteInventory') assert.equal(f.clicks(), 1);
  if (option === 'authAfterToggle' || option === 'headAfterToggle') assert.equal(f.clicks(), 2);
  assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const option of ['observerFailure', 'comparisonFailure', 'probeCleanupFailure']) test(`actual ${option} cannot bypass close-first raw restoration`, async () => {
  const f = await protocol({ [option]: true });await assert.rejects(f.run(), AggregateError);assert.deepEqual(f.storage(), f.original);assert.equal(f.progress.cleanup.rawRestoredAfterClose, true);assert.equal(f.page.isClosed(), true);
});
test('original and native restoration errors remain separate in the actual failure path', async () => {
  const f = await protocol({ authAfterToggle: true, observerFailure: true });await assert.rejects(f.run(), (value) => {
    assert.equal(value instanceof AggregateError, true);assert.ok(value.errors.length >= 2);return true;
  });assert.equal(f.progress.primaryFailure, 'ACTOR_UNQUALIFIED');assert.ok(f.progress.cleanup.codes.includes('OBSERVER_CLEANUP_FAILED'));assert.deepEqual(f.storage(), f.original);
});
test('natural restore refusal fails explicitly instead of claiming cleanup success', async () => {
  const f = await protocol({ rejectRestore: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.progress.nativeRestored, false);assert.ok(f.progress.cleanup.codes.includes('NATIVE_RESTORATION_REJECTED'));assert.deepEqual(f.storage(), f.original);
});
test('page-close failure never restores settings while a provider page is still live', async () => {
  const f = await protocol({ closeFailure: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.writes(), 1);assert.equal(f.progress.cleanup.rawRestoredAfterClose, false);
});
test('navigation/observer setup failure cleanup restores even absent page and preserves missing raw settings key', async () => {
  let storage = { sync: { present: false }, local: { present: true, value: { untouched: 7 } } };const original = structuredClone(storage);const progress = {};
  const settings = gitLabWhitespaceSettings({ read: async () => storage, write: async (value) => { storage = value; }, progress });await settings.prepare();
  const result = await cleanupGitLabWhitespace(undefined, { settings, observer: { evidence: {}, dispose: () => { throw Error('DO_NOT_RETAIN'); } }, progress: {} });
  assert.deepEqual(storage, original);assert.deepEqual(result.codes, ['OBSERVER_CLEANUP_FAILED']);assert.equal(result.rawRestoredAfterClose, true);
});
test('nonread receipts omit queries, body, headers and raw failures while retaining outside-window unattributed requests', () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);
  const request = { method: () => 'POST', url: () => 'https://gitlab.com/api/graphql?account=DO_NOT_RETAIN', postData: () => { throw Error('Must not read body'); }, headers: () => { throw Error('Must not read headers'); } };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 401 });
  assert.equal(evidence.nonreads[0].resource, 'https://gitlab.com/api/graphql');assert.equal(evidence.nonreads[0].phase, 'navigation');assert.equal(evidence.nonreads[0].provenance, 'unattributed_browser_request');assert.equal(evidence.nonreads[0].status, 401);
  assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_RETAIN/);observer.dispose();assert.equal(page.listenerCount('request'), 0);
  assert.equal(whitespaceReceiptURL('javascript:DO_NOT_RETAIN'), 'NON_HTTP_RESOURCE');
});
for (const kind of ['native', 'unknown', 'mixed']) test(`${kind} GET provenance and body completion are observed rather than inferred from absent extension frames`, () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);observer.phase('toggle');
  const request = { method: () => 'GET', url: () => 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diff_file?ignore_whitespace_changes=true&unknown=DO_NOT_RETAIN',
    initiator: () => kind === 'unknown' ? {} : { stack: { callFrames: [{ url: 'https://gitlab.com/assets/known.js?secret=DO_NOT_RETAIN' }, ...(kind === 'mixed' ? [{ url: 'chrome-extension://abcdefghijklmnop/file.js' }] : [])] } } };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200 });assert.equal(evidence.modes[0].finished, undefined);
  page.emit('requestfinished', request);assert.equal(evidence.modes[0].finished, true);assert.equal(evidence.modes[0].nativeFrame, kind !== 'unknown');assert.equal(evidence.modes[0].extensionFrame, kind === 'mixed');assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_RETAIN/);
  observer.dispose();for (const name of ['request', 'response', 'requestfailed', 'requestfinished']) assert.equal(page.listenerCount(name), 0);
});
for (const [label, path, query, eligible] of [
  ['exact native stream and round', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0`, true],
  ['wrong round', 'diffs_stream', 'diff_id=2150000000&view=inline&w=0', false],
  ['missing round', 'diffs_stream', 'view=inline&w=0', false],
  ['other MR endpoint', 'widget.json', `diff_id=${F.version}&view=inline&w=0`, false],
  ['unqualified full ref override', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0&start_sha=${T}`, false],
  ['missing native view', 'diffs_stream', `diff_id=${F.version}&w=0`, false],
  ['ambiguous mode', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0&w=1`, false],
]) test(`${label} is retained with truthful request selection eligibility`, () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);observer.bind(state().nativeStream);observer.phase('toggle');
  const request = { method: () => 'GET', url: () => `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/${path}?${query}`, initiator: () => ({ stack: { callFrames: [{ url: 'https://gitlab.com/assets/native.js' }] } }) };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200 });page.emit('requestfinished', request);
  assert.equal(evidence.modes.length, 1);assert.equal(evidence.modes[0].eligible, eligible);assert.equal(evidence.modes[0].diffId, label === 'missing round' ? null : label === 'wrong round' ? '2150000000' : F.version);
  assert.equal(evidence.modes[0].requestSourceHead, label === 'unqualified full ref override' ? 'not_qualified' : 'absent');
  assert.equal(evidence.modes[0].requestTargetHead, label === 'unqualified full ref override' ? 'not_qualified' : 'absent');observer.dispose();
});

async function withDOM(run) {
  const w = new Window({ url: F.url, settings: { enableJavaScriptEvaluation: false, enableCSSFileLoading: false, enableImageFileLoading: false } });
  const names = ['document', 'location', 'getComputedStyle'];const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    Object.assign(globalThis, { document: w.document, location: w.location, getComputedStyle: w.getComputedStyle.bind(w) });w.HTMLElement.prototype.getBoundingClientRect = () => new w.DOMRect(1, 1, 100, 20);
    w.document.body.dataset.projectId = '278964';w.document.body.dataset.projectFullPath = 'gitlab-org/gitlab';
    document.body.innerHTML = '<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a><article data-rapid-diffs><header class="rd-app-header" aria-label="View controls"><div class="gl-new-dropdown" aria-label="Preferences"><button type="button" class="js-show-diff-settings" data-testid="base-dropdown-toggle" role="combobox" aria-expanded="true">Preferences</button><div data-testid="base-dropdown-menu"><input type="checkbox" value="true" id="ws" data-testid="show-whitespace"><label for="ws">Show whitespace changes</label><input type="checkbox" value="true" id="fb" data-testid="file-by-file"><label for="fb">Show one file at a time</label></div></div></header></article>';
    const app = document.querySelector('article');const base = state();app.setAttribute('data-app-data', JSON.stringify({ mr_path: base.app.path, iid: 266334, file_by_file_mode: false, diff_view_type: 'inline', reload_stream_url: '/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream?diff_id=2158520123', show_whitespace: false, update_user_endpoint: '/api/v4/user/preferences', versions: { source_versions: base.app.sourceVersions, target_versions: base.app.targetVersions } }));
    for (const [i, path] of F.paths.entries()) { const file = document.createElement('diff-file');file.id = String(i).repeat(40);file.setAttribute('data-file-data', JSON.stringify({ new_path: path, diff_refs: { head_sha: T } }));file.innerHTML = '<input type="checkbox" data-viewed-checkbox disabled><table><tr class="rd-hunk-lines-inline"><td class="rd-line-text">Source canary remains hashed</td></tr></table><diff-file-mounted></diff-file-mounted>';app.append(file); }
    await run({ w, app, menu: document.querySelector('[data-testid="base-dropdown-menu"]'), checkbox: document.querySelector('#ws') });
  } finally { await probe('cleanup');for (const [name, value] of before) { if (value) Object.defineProperty(globalThis, name, value);else delete globalThis[name]; }await w.happyDOM.abort(); }
}
test('actual DOM probe reads current checked property rather than absent HTML attribute and never exposes code text', async () => withDOM(async ({ checkbox }) => {
  checkbox.checked = true;assert.equal(checkbox.hasAttribute('checked'), false);const value = await probe('read', F);assert.equal(value.qualified, true);assert.equal(value.checked, true);assert.equal(value.initialShowWhitespace, false);assert.doesNotMatch(JSON.stringify(value), /Source canary/);
}));
for (const shape of ['input', 'select', 'textarea', 'form', 'editable']) test(`unknown ${shape} schema yields only fixed diagnostics with no field values`, async () => withDOM(async ({ menu }) => {
  const node = document.createElement(shape === 'editable' ? 'div' : shape);node.setAttribute('name', 'DO_NOT_RETAIN_AUTH');node.setAttribute('value', 'DO_NOT_RETAIN_VALUE');if (shape === 'editable') node.contentEditable = 'true';menu.append(node);
  assert.deepEqual(await probe('read', F), { qualified: false, code: 'MENU_SCHEMA_UNQUALIFIED' });
}));
test('bound original native field replacement is rejected rather than adopted', async () => withDOM(async ({ checkbox }) => {
  assert.equal((await probe('bind', F)).bound, true);checkbox.replaceWith(checkbox.cloneNode(true));assert.deepEqual(await probe('read', F), { qualified: false, code: 'ORIGINAL_OWNER_CHANGED' });
}));
test('numeric native actor refuses before menu values or arbitrary authored content is returned', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('afterbegin', '<div id="js-vue-mr-discussions" data-current-user-data=\'{"id":7,"secret":"DO_NOT_RETAIN"}\'></div>');
  assert.deepEqual(await probe('read', F), { qualified: false, code: 'ACTOR_UNQUALIFIED' });
}));
test('actual probe commands return the original associated label and mark synthetic events untrusted', async () => withDOM(async ({ w, menu, checkbox }) => {
  const opener = document.querySelector('button');opener.setAttribute('aria-expanded', 'false');menu.hidden = true;
  assert.equal((await probe('arm-opener', F)).armed, true);assert.equal(await probe('opener', F), opener);opener.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  opener.setAttribute('aria-expanded', 'true');menu.hidden = false;
  const bound = await probe('bind', F);assert.equal(bound.bound, true);assert.deepEqual(bound.events, [{ kind: 'opener', type: 'click', trusted: false }]);
  assert.equal(await probe('toggle-target', F), document.querySelector('label[for="ws"]'));assert.equal(checkbox.checked, false);
  assert.deepEqual(await probe('invented-command', F), { qualified: false, code: 'UNKNOWN_PROBE_ACTION' });
}));
test('an unrelated native auth dialog yields only a fixed diagnostic before any menu values', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><input type="password" value="DO_NOT_RETAIN_AUTH"></div>');assert.deepEqual(await probe('read', F), { qualified: false, code: 'UNRELATED_DIALOG_UNQUALIFIED' });
}));
test('a duplicated field ID cannot redirect the trusted native label click to another input', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('afterbegin', '<input id="ws" type="password" value="DO_NOT_RETAIN_AUTH">');assert.deepEqual(await probe('read', F), { qualified: false, code: 'MENU_LABEL_UNQUALIFIED' });
}));
