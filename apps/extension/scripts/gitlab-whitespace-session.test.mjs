import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GITLAB_WHITESPACE_SESSION as F, gitLabWhitespaceSessionPresentation, gitLabWhitespaceSessionProbe as probe, gitLabWhitespaceSessionSettings, verifyGitLabWhitespaceSession, verifyGitLabWhitespaceSessionProduct } from './gitlab-whitespace-session.mjs';
import { gitLabWhitespaceProbe as strict } from './gitlab-whitespace-probe.mjs';
import { acquisitionMatches, cleanupGitLabWhitespace, whitespaceReceiptURL } from './gitlab-whitespace-viewed.mjs';

const NEW = '9'.repeat(40), BASE = '2'.repeat(40), START = '6'.repeat(40);
const optKey = JSON.stringify(['gitlab', 'https://gitlab.com', '/gitlab-org/gitlab/-/merge_requests/266334/diffs']);
async function dom(run) {
  const w = new Window({ url: F.url, settings: { enableJavaScriptEvaluation: false, enableCSSFileLoading: false, enableImageFileLoading: false } });
  const names = ['document', 'location', 'getComputedStyle', 'requestAnimationFrame'];const saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    Object.assign(globalThis, { document: w.document, location: w.location, getComputedStyle: w.getComputedStyle.bind(w), requestAnimationFrame: (fn) => w.requestAnimationFrame(fn) });
    w.HTMLElement.prototype.getBoundingClientRect = () => new w.DOMRect(1, 1, 100, 20);w.document.elementFromPoint = () => document.querySelector('label[for=ws]');
    document.body.dataset.projectId = '278964';document.body.dataset.projectFullPath = 'gitlab-org/gitlab';
    document.body.innerHTML = '<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a><div id="js-vue-mr-discussions" data-current-user-data="null"></div><article data-rapid-diffs><header class="rd-app-header" aria-label="View controls"><div class="gl-new-dropdown" aria-label="Preferences"><button type="button" class="js-show-diff-settings" data-testid="base-dropdown-toggle" role="combobox" aria-expanded="true">Preferences</button><div data-testid="base-dropdown-menu"><input type="checkbox" value="true" id="ws" data-testid="show-whitespace"><label for="ws">Show whitespace changes</label><input type="checkbox" value="true" id="fb" data-testid="file-by-file"><label for="fb">Show one file at a time</label></div></div></header><div data-diffs-overlay></div><div data-diffs-list-alert></div><div data-diffs-list></div><div data-list-loading hidden="hidden"></div></article>';
    const root = document.querySelector('article'), field = document.querySelector('#ws'), list = root.querySelector('[data-diffs-list]'), overlay = root.querySelector('[data-diffs-overlay]'), loading = root.querySelector('[data-list-loading]'), alert = root.querySelector('[data-diffs-list-alert]');
    root.setAttribute('data-app-data', JSON.stringify({ project_path: 'gitlab-org/gitlab', is_fork: false, mr_path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, file_by_file_mode: false, diff_view_type: 'inline', reload_stream_url: '/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream?diff_id=2158520123', show_whitespace: false, update_user_endpoint: '/api/v4/user/preferences', versions: {
      source_versions: [{ id: Number(F.version), head_sha: F.head, selected: true, is_merge_head: false, href: F.url }], target_versions: [{ id: Number(F.version), head_sha: F.head, start_sha: START, selected: true, is_merge_head: false, href: F.url }],
    } }));
    function file(slot, head = F.head, base = BASE, start = START) {
      const node = document.createElement('diff-file');node.id = String(slot + 1).repeat(40);const path = F.paths[slot];
      node.setAttribute('data-file-data', JSON.stringify({ new_path: path, diff_refs: { base_sha: base, start_sha: start, head_sha: head }, blob_raw_path: `/gitlab-org/gitlab/-/raw/${head}/${path}`, diff_lines_path: `/gitlab-org/gitlab/-/blob/${head}/${path}/diff_lines` }));
      node.innerHTML = '<input type="checkbox" data-viewed-checkbox disabled><table><tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="new"><a data-line-number="1" href="#native-line">1</a></td><td class="rd-line-text">original source</td></tr></table><diff-file-mounted></diff-file-mounted>';return node;
    }
    list.append(...F.paths.map((_, i) => file(i)));
    const install = async () => { assert.equal((await strict('bind', F)).bound, true);const value = await probe('install', F);assert.equal(value.qualified, true);return value; };
    // Protocol-only trust seam. Actual installed acceptance must obtain browser isTrusted events.
    const input = (desired) => { const p = globalThis.__geldNativeWhitespaceSessionProof;p.listen({ type: 'click', target: document.querySelector('label[for=ws]'), isTrusted: true });field.checked = desired;p.listen({ type: 'change', target: field, isTrusted: true }); };
    const cycle = (options = {}) => {
      const originals = [...list.children];overlay.dataset.loading = 'true';list.replaceChildren();delete overlay.dataset.loading;loading.removeAttribute('hidden');
      list.append(...(options.old ? originals : F.paths.map((_, i) => file(i, options.head ?? NEW))));if (!options.pending) loading.setAttribute('hidden', 'hidden');return originals;
    };
    return await run({ w, root, field, list, overlay, loading, alert, file, input, cycle, install });
  } finally {
    try { await probe('cleanup', F);await strict('cleanup', F); } finally { for (const name of names) { const value = saved.get(name);if (value) Object.defineProperty(globalThis, name, value);else delete globalThis[name]; }await w.happyDOM.close(); }
  }
}

function nativeHeader(files = '2 files', additions = '+4', deletions = '-0') {
  const root = document.createElement('div');root.className = 'diff-stats inline-parallel-buttons';root.innerHTML = '<div class="diff-stats-contents"><div class="diff-stats-group"><span></span></div><span data-testid="js-file-addition-line"></span><span data-testid="js-file-deletion-line"></span></div>';
  root.querySelector('.diff-stats-group > span').textContent = files;root.querySelector('[data-testid=js-file-addition-line]').textContent = additions;root.querySelector('[data-testid=js-file-deletion-line]').textContent = deletions;document.body.append(root);return root;
}
test('presentation distinguishes grouped hiding from visible inline fallback without raw layout text', async () => dom(async ({ list }) => {
  list.classList.add('geld-provider-diffs');const file = list.lastElementChild;
  file.setAttribute('data-geld-provider-hidden', 'closed');file.style.display = 'none';
  let observed = gitLabWhitespaceSessionPresentation(F.paths).files[2];
  assert.equal(observed.hidden, true);assert.equal(observed.hiddenMode, 'closed');assert.equal(observed.groupedAncestor, true);
  assert.equal(observed.ancestors[0].kind, 'diff_list');assert.equal(observed.ancestors[0].grouped, true);
  list.classList.remove('geld-provider-diffs');file.removeAttribute('data-geld-provider-hidden');file.style.display = 'block';file.style.position = 'relative';file.setAttribute('data-geld-provider-inline', '');
  observed = gitLabWhitespaceSessionPresentation(F.paths).files[2];
  assert.equal(observed.hidden, false);assert.equal(observed.hiddenMode, 'absent');assert.equal(observed.inline, true);assert.equal(observed.layout.inlinePosition, 'relative');assert.equal(observed.groupedAncestor, false);
}));
test('presentation bounds ancestor/layout observations and excludes unknown classes, styles and attributes', async () => dom(async ({ list }) => {
  const file = list.lastElementChild;let child = file;
  for (let i = 0; i < 7; i++) { const wrapper = document.createElement('div');wrapper.className = 'DO_NOT_RETAIN';wrapper.style.setProperty('--private-canary', 'DO_NOT_RETAIN');wrapper.setAttribute('data-private', 'DO_NOT_RETAIN');list.append(wrapper);wrapper.append(child);child = wrapper; }
  file.setAttribute('data-geld-provider-hidden', 'DO_NOT_RETAIN');
  const result = gitLabWhitespaceSessionPresentation(F.paths);const observed = result.files.find((entry) => entry.slot === 2);
  assert.equal(observed.ancestors.length, 4);assert.equal(observed.hiddenMode, 'other');assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));
test('history-limit rejection retains a bounded count without accepting the exhausted session', async () => dom(async ({ install }) => {
  await install();globalThis.__geldNativeWhitespaceSessionProof.records = 4096;document.body.append(document.createElement('div'));
  const result = await probe('read', F);assert.equal(result.qualified, false);assert.equal(result.code, 'SESSION_HISTORY_BOUND');assert.deepEqual(result.history, { observed: 4097, limit: 4096, phase: 'baseline' });
}));
test('two qualified native cycles each receive their own bounded mutation budget', async () => dom(async ({ install, input, cycle }) => {
  await install();
  for (const [phase, desired, count] of [['toggle', true, 1], ['restore', false, 2]]) {
    assert.equal((await probe(`mark-${phase}`, F)).qualified, true);input(desired);cycle();
    for (let i = 0; i < 2200; i++) document.body.setAttribute('data-native-render-tick', String(i));
    const result = await probe('read', F);assert.equal(result.qualified, true);assert.equal(result.completed, count);
  }
}));
test('a single native cycle still refuses more than its mutation budget', async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();
  for (let i = 0; i < 4097; i++) document.body.setAttribute('data-native-render-tick', String(i));
  const result = await probe('read', F);assert.equal(result.qualified, false);assert.equal(result.code, 'SESSION_HISTORY_BOUND');assert.equal(result.history.phase, 'toggle');assert.equal(result.history.limit, 4096);
}));
for (const [label, value] of [['2 files', 2], ['1 file', 1], ['0 files', 0], ['2', 2], ['1,234 files', 1234]]) test(`native count context accepts supported file label ${label}`, async () => dom(async () => {
  nativeHeader(label);const header = gitLabWhitespaceSessionPresentation(F.paths).headers[0];assert.equal(header.files, value);assert.equal(header.parsed.files.recognized, true);
}));
for (const label of ['-0', '−0', '0', '+0', '- 0', '− 0']) test(`native deletion counter accepts the complete signed magnitude ${label}`, async () => dom(async () => {
  nativeHeader('2 files', '+4', label);const header = gitLabWhitespaceSessionPresentation(F.paths).headers[0];assert.equal(header.deletions, 0);assert.equal(header.additions, 4);assert.equal(header.parsed.deletions.recognized, true);
}));
for (const label of ['DO_NOT_RETAIN 2 files', 'files 2', '2 file', '1 files', '1,,234 files', '02 files', '2.0 files', '1000000001 files']) test('unknown or malformed native file labels stay unrecognized without retaining text', async () => dom(async () => {
  nativeHeader(label);const result = gitLabWhitespaceSessionPresentation(F.paths);assert.equal(result.headers[0].files, null);assert.equal(result.headers[0].parsed.files.format, 'unrecognized');assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));
test('absent line leaves retain explicit contextual zero while an absent file label cannot qualify', async () => dom(async () => {
  const root = nativeHeader();root.querySelector('[data-testid=js-file-deletion-line]').remove();root.querySelector('.diff-stats-group > span').remove();const header = gitLabWhitespaceSessionPresentation(F.paths).headers[0];assert.equal(header.deletions, 0);assert.equal(header.parsed.deletions.format, 'absent_zero');assert.equal(header.files, null);assert.equal(header.parsed.files.recognized, false);
}));

async function productProtocol(options = {}) {
  return dom(async ({ list }) => {
    nativeHeader(options.fileLabel ?? '2 files', '+4', options.deletions ?? '-0');list.children[2].style.display = 'none';
    if (options.unknownPath) { const file = list.children[0];file.setAttribute('data-file-data', JSON.stringify({ new_path: 'DO_NOT_RETAIN_NATIVE_PATH' })); }
    const state = { hasDiff: true, all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 }, hiddenCount: 1, categories: [{ id: 'tests', count: 1, paths: [F.paths[2]] }], secret: 'DO_NOT_RETAIN_STATE' };
    if (options.wrongTotals) state.visible.files = 3;if (options.wrongCategory) state.categories[0].paths = ['DO_NOT_RETAIN_CATEGORY'];
    let stateReads = 0, nativeReads = 0;const progress = { phase: 'BASELINE_PRODUCT_TOTALS' };
    const page = { evaluate: async (fn, paths) => { nativeReads++;if (options.nativeReadFailure) throw Error('DO_NOT_RETAIN_NATIVE_ERROR');return fn(paths); } };
    const poll = async (read, accepts) => { for (let i = 0; i < 2; i++) { const value = await read();if (accepts(value)) return value; }throw Error('Unit deadline'); };
    let result, failure;try { result = await verifyGitLabWhitespaceSessionProduct(page, { phase: 'baseline', progress, poll, readState: async () => { stateReads++;if (options.tabReadFailure) throw Error('DO_NOT_RETAIN_TAB_ERROR');return state; } }); } catch (error) { failure = error; }
    return { progress, result, failure, stateReads, nativeReads };
  });
}
test('source-backed labeled header and ASCII-minus zero pass the actual product observer with one existing read per phase', async () => {
  const f = await productProtocol();assert.equal(f.failure, undefined);assert.equal(f.stateReads, 1);assert.equal(f.nativeReads, 1);assert.equal(f.progress.productObservations[0].entryPhase, 'BASELINE_PRODUCT_TOTALS');assert.equal(f.progress.productObservations[0].stage, 'VERIFIED');assert.equal(f.progress.productObservations[0].lastNative.headers[0].files, 2);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const [option, phase] of [['wrongTotals', 'TAB_TOTALS'], ['wrongCategory', 'TEST_CATEGORY'], ['fileLabel', 'NATIVE_PRESENTATION'], ['unknownPath', 'NATIVE_PRESENTATION'], ['tabReadFailure', 'TAB_TOTALS'], ['nativeReadFailure', 'NATIVE_PRESENTATION']]) test(`existing-read ${option} refusal records bounded fixed ${phase} diagnostics`, async () => {
  const f = await productProtocol({ [option]: option === 'fileLabel' ? 'DO_NOT_RETAIN_UNKNOWN_LABEL' : true });assert.ok(f.failure);assert.equal(f.progress.phase, phase);const observation = f.progress.productObservations[0];assert.equal(observation.stage, phase);assert.ok(observation.tabReads > 0);assert.ok(observation.tabReads <= 2);assert.ok(observation.nativeReads <= 2);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
  if (phase === 'NATIVE_PRESENTATION' && option !== 'nativeReadFailure') assert.ok(observation.lastNative);
});

test('independent model accepts two complete fresh native epochs with frozen selected target, preserving each frame', async () => dom(async ({ install, input, cycle, root }) => {
  const initial = await install();const app = root.getAttribute('data-app-data');await probe('mark-toggle', F);input(true);cycle();const first = await probe('read', F);
  assert.equal(first.model, 'completed_native_reload');assert.equal(first.completed, 1);assert.ok(first.files.every((file) => file.refs.head === NEW));assert.equal(first.preservedNativeNodes, true);assert.equal(root.getAttribute('data-app-data'), app);
  assert.equal((await strict('read', F)).code, 'FILE_DATA_UNQUALIFIED', 'The old strict acceptance must still reject this native head');
  await probe('mark-restore', F);input(false);cycle();const restored = await probe('read', F);assert.equal(restored.completed, 2);assert.equal(restored.checked, initial.checked);assert.ok(restored.files.every((file) => file.refs.head === NEW));assert.equal(restored.bootstrapUnchanged, true);assert.equal(restored.target, undefined);
}));

for (const [name, mutate, expected] of [
  ['head disagreement', ({ list }) => { const file = list.children[1], data = JSON.parse(file.getAttribute('data-file-data'));data.diff_refs.head_sha = F.head;file.setAttribute('data-file-data', JSON.stringify(data)); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['base disagreement', ({ list }) => { const file = list.children[1], data = JSON.parse(file.getAttribute('data-file-data'));data.diff_refs.base_sha = F.head;file.setAttribute('data-file-data', JSON.stringify(data)); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['start disagreement', ({ list }) => { const file = list.children[1], data = JSON.parse(file.getAttribute('data-file-data'));data.diff_refs.start_sha = F.head;file.setAttribute('data-file-data', JSON.stringify(data)); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['wrong canonical resource', ({ list }) => { const file = list.children[1];file.setAttribute('data-file-data', file.getAttribute('data-file-data').replace('/raw/', '/DO_NOT_RETAIN/')); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['unknown path', ({ list }) => { const file = list.children[1], data = JSON.parse(file.getAttribute('data-file-data'));data.new_path = 'DO_NOT_RETAIN';file.setAttribute('data-file-data', JSON.stringify(data)); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['duplicate path', ({ list }) => { list.children[1].setAttribute('data-file-data', list.children[0].getAttribute('data-file-data')); }, 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['unmounted file', ({ list }) => list.children[0].lastElementChild.remove(), 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['missing file', ({ list }) => list.lastElementChild.remove(), 'COMPLETED_NATIVE_FRAME_UNQUALIFIED'],
  ['transient alert', ({ alert }) => { const node = document.createElement('div');node.textContent = 'DO_NOT_RETAIN';alert.append(node);node.remove(); }, 'NATIVE_RELOAD_ALERT'],
  ['transient actor change', () => { const actor = document.querySelector('#js-vue-mr-discussions');actor.setAttribute('data-current-user-data', '{"id":1}');actor.setAttribute('data-current-user-data', 'null'); }, 'SESSION_IDENTITY_MUTATED'],
  ['transient bootstrap change', ({ root }) => { const value = root.getAttribute('data-app-data');root.setAttribute('data-app-data', '{}');root.setAttribute('data-app-data', value); }, 'SESSION_IDENTITY_MUTATED'],
  ['transient native field change', ({ field }) => { field.setAttribute('readonly', '');field.removeAttribute('readonly'); }, 'NATIVE_FIELD_MUTATED'],
  ['transient native label change', () => { const label = document.querySelector('label[for=fb]');label.setAttribute('for', 'DO_NOT_RETAIN');label.setAttribute('for', 'fb'); }, 'NATIVE_LABEL_MUTATED'],
  ['transient unknown form control', () => { const node = document.createElement('input');node.type = 'password';node.value = 'DO_NOT_RETAIN';const menu = document.querySelector('[data-testid=base-dropdown-menu]');menu.append(node);node.remove(); }, 'NATIVE_MENU_STRUCTURE_MUTATED'],
  ['transient dialog', () => { const node = document.createElement('dialog');node.innerHTML = '<input value="DO_NOT_RETAIN">';document.body.append(node);node.remove(); }, 'NATIVE_MARKER_OR_DIALOG_CHANGED'],
  ['owner removal/reinsert', ({ root }) => { const parent = root.parentNode;root.remove();parent.append(root); }, 'ORIGINAL_SESSION_OWNER_REMOVED'],
]) test(`completed frame refuses ${name} with fixed private diagnostics`, async () => dom(async (f) => {
  await f.install();await probe('mark-toggle', F);f.input(true);f.cycle();mutate(f);const result = await probe('read', F);assert.equal(result.qualified, false);assert.equal(result.code, expected);assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));

test('quiet fresh files without a native input/lifecycle never become a completed model', async () => dom(async ({ install, list, file }) => {
  await install();list.replaceChildren(...F.paths.map((_, i) => file(i, NEW)));const value = await probe('read', F);assert.equal(value.code, 'CURRENT_NATIVE_FRAME_CHANGED');
}));
test('untrusted checkbox events never create authority', async () => dom(async ({ install, field, cycle }) => {
  await install();await probe('mark-toggle', F);field.click();cycle();const result = await probe('read', F);assert.equal(result.qualified, false);
}));
test('a trusted click cannot authorize a checkbox change in a later task', async () => dom(async ({ install, field, cycle }) => {
  await install();await probe('mark-toggle', F);const p = globalThis.__geldNativeWhitespaceSessionProof;p.listen({ type: 'click', target: field, isTrusted: true });await new Promise((resolve) => setTimeout(resolve, 2));field.checked = true;p.listen({ type: 'change', target: field, isTrusted: true });cycle();assert.equal((await probe('read', F)).code, 'NATIVE_INPUT_UNQUALIFIED');
}));
test('an unfinished stream remains pending and cannot offer another choice', async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle({ pending: true });const result = await probe('read', F);assert.equal(result.pending, true);assert.equal(result.completed, 0);assert.equal(await probe('toggle-target', F), null);
}));
test('reusing original files fails even if all refs and final mode appear valid', async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle({ old: true });assert.equal((await probe('read', F)).code, 'ORIGINAL_FILES_REUSED');
}));
test('mounted-frame code and links remain protected after qualification', async () => dom(async ({ install, input, cycle, list }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();assert.equal((await probe('read', F)).qualified, true);list.querySelector('.rd-line-text').textContent = 'DO_NOT_RETAIN';assert.equal((await probe('read', F)).code, 'CURRENT_NATIVE_FRAME_CHANGED');
}));
for (const kind of ['text-identity', 'viewed', 'link', 'route', 'overlap', 'unknown-query', 'bare-query', 'anchor']) test(`native frame rejects ${kind} drift without adopting new evidence`, async () => dom(async (f) => {
  await f.install();await probe('mark-toggle', F);f.input(true);f.cycle();assert.equal((await probe('read', F)).qualified, true);
  if (kind === 'text-identity') { const code = f.list.querySelector('.rd-line-text');code.replaceChildren(document.createTextNode(code.textContent)); }
  if (kind === 'viewed') f.list.querySelector('input').checked = true;
  if (kind === 'link') f.list.querySelector('a').href = '#DO_NOT_RETAIN';
  if (kind === 'route') location.pathname = '/other/project/-/merge_requests/1/diffs';
  if (kind === 'overlap') { await probe('mark-restore', F);f.input(false);f.input(true); }
  if (kind === 'anchor') f.list.children[0].id = 'a'.repeat(40);
  if (kind === 'unknown-query' || kind === 'bare-query') { const file = f.list.children[0];const data = JSON.parse(file.getAttribute('data-file-data'));data.blob_raw_path += kind === 'bare-query' ? '?' : '?DO_NOT_RETAIN=auth';file.setAttribute('data-file-data', JSON.stringify(data)); }
  const value = await probe('read', F);assert.equal(value.qualified, false);assert.doesNotMatch(JSON.stringify(value), /DO_NOT_RETAIN/);
}));
test('the known settings observer releases after cleanup, including an install refusal', async () => dom(async ({ install, root }) => {
  await install();const p = globalThis.__geldNativeWhitespaceSessionProof;assert.equal((await probe('cleanup', F)).released, true);assert.equal(p.stopped, true);assert.equal(globalThis.__geldNativeWhitespaceSessionProof, undefined);
  root.setAttribute('data-app-data', '{}');assert.equal((await probe('install', F)).qualified, false);assert.equal((await probe('cleanup', F)).released, true);
}));
test('a trusted competing original file-by-file choice invalidates the lease even when reverted', async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();assert.equal((await probe('read', F)).completed, 1);
  const p = globalThis.__geldNativeWhitespaceSessionProof, other = document.querySelector('#fb');
  other.checked = true;p.listen({ type: 'change', target: other, isTrusted: true });other.checked = false;p.listen({ type: 'change', target: other, isTrusted: true });
  assert.deepEqual(await probe('read', F), { qualified: false, code: 'COMPETING_NATIVE_VIEW_CHOICE' });
}));
test('owned and untrusted header changes cannot impersonate a competing original native choice', async () => dom(async ({ install, input, cycle, root }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();assert.equal((await probe('read', F)).completed, 1);const p = globalThis.__geldNativeWhitespaceSessionProof;
  p.listen({ type: 'change', target: document.querySelector('#fb'), isTrusted: false });
  const owned = document.createElement('input');owned.setAttribute('data-geld-ui', '');root.querySelector('header').append(owned);p.listen({ type: 'change', target: owned, isTrusted: true });assert.equal((await probe('read', F)).qualified, true);
}));
test('unrelated ancestor classes and styles preserve the current anonymous witness and native frame', async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();assert.equal((await probe('read', F)).completed, 1);
  document.body.classList.add('native-scroll-state');document.body.style.position = 'relative';document.documentElement.style.setProperty('--native-color', 'DO_NOT_RETAIN');
  const signIn = document.querySelector('a[data-testid=topbar-signin-button]');signIn.setAttribute('href', signIn.getAttribute('href'));signIn.setAttribute('data-testid', 'topbar-signin-button');
  const result = await probe('read', F);assert.equal(result.qualified, true);assert.equal(result.preservedNativeNodes, true);assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));
test('reverted sign-in destination changes retain only fixed mutation diagnostics', async () => dom(async ({ install }) => {
  await install();const link = document.querySelector('a[data-testid=topbar-signin-button]');const before = link.getAttribute('href');link.setAttribute('href', '/DO_NOT_RETAIN');link.setAttribute('href', before);
  const result = await probe('read', F);assert.equal(result.code, 'ANONYMOUS_WITNESS_MUTATED');assert.deepEqual(result.witnessMutation, { attribute: 'href', target: 'sign_in', currentlyVisible: true, oldValueMatchesCurrent: false });assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));
for (const [name, mutate] of [
  ['original sign-in removal', (node) => node.remove()],
  ['original sign-in removal and reinsertion', (node) => { const parent = node.parentNode;node.remove();parent.append(node); }],
  ['sign-in href drift', (node) => { node.href = '/DO_NOT_RETAIN'; }],
  ['reverted sign-in href drift', (node) => { const href = node.getAttribute('href');node.href = '/DO_NOT_RETAIN';node.setAttribute('href', href); }],
  ['sign-in presentation loss', (node) => { node.style.display = 'none'; }],
  ['reverted sign-in presentation loss', (node) => { node.style.display = 'none';node.removeAttribute('style'); }],
  ['sign-in parent change', (node) => { const parent = document.createElement('div');node.replaceWith(parent);parent.append(node); }],
  ['contradictory signed-in title action', () => { const node = document.createElement('div');node.className = 'js-mr-title-actions';node.setAttribute('data-is-signed-in', 'true');document.body.append(node); }],
  ['transient contradictory signed-in title action', () => { const node = document.createElement('div');node.className = 'js-mr-title-actions';node.setAttribute('data-is-signed-in', 'true');document.body.append(node);node.remove(); }],
  ['reverted signed-in title action attribute', () => { const node = document.createElement('div');node.className = 'js-mr-title-actions';node.setAttribute('data-is-signed-in', 'false');document.body.append(node);node.setAttribute('data-is-signed-in', 'true');node.setAttribute('data-is-signed-in', 'false'); }],
]) test(`anonymous lease rejects ${name} with actor JSON still null`, async () => dom(async ({ install, input, cycle }) => {
  await install();await probe('mark-toggle', F);input(true);cycle();assert.equal((await probe('read', F)).completed, 1);mutate(document.querySelector('a[data-testid=topbar-signin-button]'));
  const result = await probe('read', F);assert.equal(result.qualified, false);assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/);
}));
test('reordered loading, repeated input and route drift cannot qualify final-looking DOM', async () => dom(async ({ install, input, cycle, loading }) => {
  await install();await probe('mark-toggle', F);input(true);loading.removeAttribute('hidden');cycle();assert.equal((await probe('read', F)).qualified, false);
}));

async function settingsFixture(initial = { sync: { present: false }, local: { present: false } }) {
  let value = structuredClone(initial);const writes = [];const progress = {};const settings = gitLabWhitespaceSessionSettings({ read: async () => structuredClone(value), write: async (next) => { writes.push(structuredClone(next));value = structuredClone(next); }, progress });
  await settings.prepare();return { settings, progress, writes, initial, get: () => value, set: (next) => { value = structuredClone(next); } };
}
test('settings custody admits only the product-generated current-review choice and preserves unrelated raw keys', async () => {
  const original = { sync: { present: true, value: { enabled: false, secret: 'DO_NOT_RETAIN' } }, local: { present: true, value: { other: 123 } } };const f = await settingsFixture(original);await f.settings.bind();f.settings.intent(true);await f.settings.current();
  f.get().local.value[optKey] = Date.now();await f.settings.choiceComplete();assert.deepEqual(f.progress.observedChoices, [{ showWhitespace: true, optOutPresent: true, timestampQualified: true }]);
  f.settings.intent(false);delete f.get().local.value[optKey];await f.settings.choiceComplete();await assert.rejects(f.settings.restore(false));
  assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
test('close-first restoration returns exact absent raw keys after both native choices', async () => {
  const f = await settingsFixture();await f.settings.bind();f.settings.intent(true);f.get().local = { present: true, value: { [optKey]: Date.now() } };await f.settings.choiceComplete();f.settings.intent(false);f.get().local.value = {};await f.settings.choiceComplete();await f.settings.restore(true);assert.deepEqual(f.get(), f.initial);assert.equal(f.progress.restoredAfterPageClose, true);
});
for (const [name, change] of [
  ['unrelated key change', (value) => { value.local = { present: true, value: { other: 1 } }; }],
  ['sync vector change', (value) => { value.sync.value.aiEnabled = true; }],
  ['unexpected opt-out without intent', (value) => { value.local = { present: true, value: { [optKey]: Date.now() } }; }],
  ['unknown opt-out value', (value) => { value.local = { present: true, value: { [optKey]: 'DO_NOT_RETAIN' } }; }],
]) test(`settings custody refuses ${name}`, async () => { const f = await settingsFixture();await f.settings.bind();change(f.get());await assert.rejects(f.settings.current());await f.settings.restore(true);assert.deepEqual(f.get(), f.initial); });

function acquisition() {
  const selected = (values) => ({ state: 'observed', selectedCount: 1, values });
  return { responses: [{ id: 'r1', kind: 'versions', status: 'projected', httpStatus: 200, selectionRedacted: false, selection: { diff_id: F.version, w: '1' }, url: `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/versions?diff_id=${F.version}&w=1`, projection: { source: selected([{ id: F.version, headSha: F.head }]), target: selected([{ id: '2160786615', headSha: NEW, startSha: BASE, mergeHead: true }]) } },
    { id: 'r2', kind: 'metadata', status: 'projected', httpStatus: 200, selectionRedacted: false, selection: { diff_id: F.version, w: '1' }, url: `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs_metadata.json?diff_id=${F.version}&w=1`, projection: { projectPath: 'gitlab-org/gitlab', diffId: F.version, inventory: { state: 'observed', scanComplete: true, total: 3, uniqueNewPaths: 3, paths: F.paths.map((newPath) => ({ newPath, deleted: false, submodule: false })), size: 3, realSize: 3, overflow: false } } }] };
}
test('only the explicit session model accepts actual w1 acquisition receipts and keeps their URLs untouched', async () => dom(async () => {
  const baseline = await strict('read', F), receipts = acquisition(), before = JSON.stringify(receipts);
  assert.equal(acquisitionMatches(baseline, receipts).matched, false);assert.equal(acquisitionMatches(baseline, receipts, '1').matched, true);assert.equal(acquisitionMatches(baseline, receipts, '0').matched, false);assert.equal(JSON.stringify(receipts), before);
}));
for (const [name, mutate] of [
  ['missing selected mode', (entry) => { delete entry.selection.w; }],
  ['wrong selected mode', (entry) => { entry.selection.w = '0'; }],
  ['missing URL mode', (entry) => { entry.url = entry.url.replace('&w=1', ''); }],
  ['wrong URL mode', (entry) => { entry.url = entry.url.replace('&w=1', '&w=0'); }],
  ['duplicate URL mode', (entry) => { entry.url += '&w=1'; }],
  ['duplicate source selector', (entry) => { entry.url += `&diff_id=${F.version}`; }],
  ['extra selected parameter', (entry) => { entry.selection.secret = 'DO_NOT_RETAIN'; }],
  ['extra URL parameter', (entry) => { entry.url += '&DO_NOT_RETAIN=secret'; }],
]) test(`explicit session acquisition rejects ${name} for either required response`, async () => dom(async () => {
  const baseline = await strict('read', F);
  for (const index of [0, 1]) { const receipts = acquisition();mutate(receipts.responses[index]);const result = acquisitionMatches(baseline, receipts, '1');assert.equal(result.matched, false);assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN/); }
}));
async function protocol(options = {}) {
  return dom(async (f) => {
    const storage = await settingsFixture();const progress = {};let closed = false;let phase = 'baseline';let choices = 0;const order = [];
    const observer = { evidence: { modes: [], overflow: false }, bind: () => {}, phase: (next) => { phase = next; }, dispose: () => { order.push('observer_cleanup'); } };
    const comparisons = { checkpoint: async () => {}, dispose: async () => { order.push('comparison_cleanup'); } };
    const page = { isClosed: () => closed, close: async () => { order.push('close');closed = true; }, evaluate: async (fn, action, fixture) => {
      if (action === 'frame') return fn('read', fixture);return fn(action, fixture);
    }, evaluateHandle: async (fn, action, fixture) => {
      const node = await fn(action, fixture);return { asElement: () => node === null ? null : { evaluate: async () => true, click: async () => {
        if (action === 'opener') { document.querySelector('button').setAttribute('aria-expanded', 'true');return; }
        choices++;const desired = !f.field.checked;f.input(desired);f.cycle({ pending: options.pendingRestore && phase === 'restore' });
        if (options.nativeError && phase === 'toggle') f.alert.append(document.createElement('div'));
        if (desired) storage.get().local = { present: true, value: { [optKey]: Date.now() } };else storage.get().local.value = {};
        observer.evidence.modes.push({ phase, eligible: true, nativeFrame: true, extensionFrame: false, status: 200, finished: true, ignoreWhitespace: !desired });
      } }, dispose: async () => {} };
    } };
    const poll = async (read, accepts) => { for (let i = 0; i < 3; i++) { const result = await read();if (accepts(result)) return result; }throw Object.assign(new Error('Protocol deadline'), { code: 'OBSERVATION_DEADLINE' }); };
    let result;let failure;try { result = await verifyGitLabWhitespaceSession(page, { settings: storage.settings, observer, comparisons, acquisition: () => options.noAcquisition ? {} : acquisition(), poll, totals: async () => ({ all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 } }), progress }); } catch (error) { failure = error; }
    return { result, failure, progress, choices, storage, closed, order };
  });
}
test('actual orchestrator independently qualifies two native cycles and restores settings only after closing', async () => {
  const f = await protocol();assert.equal(f.failure, undefined);assert.equal(f.result.status, 'passed');assert.equal(f.choices, 2);assert.equal(f.progress.nativeRestored, true);assert.equal(f.progress.sourceRestoration.equalsInitial, false);assert.equal(f.progress.acquisition.endpointTarget.head, NEW);assert.equal(f.progress.baselineSelection.target[0].head, F.head);assert.equal(f.progress.toggle.settled.files[0].refs.head, NEW);assert.deepEqual(f.storage.get(), f.storage.initial);assert.equal(f.closed, true);
});
test('missing existing acquisition causes no native checkbox choices and preserves exact raw custody', async () => {
  const f = await protocol({ noAcquisition: true });assert.ok(f.failure);assert.equal(f.choices, 0);assert.deepEqual(f.storage.get(), f.storage.initial);assert.equal(f.closed, true);
});
test('restoration pending is a failure with retained completed toggle, never a partial success', async () => {
  const f = await protocol({ pendingRestore: true });assert.ok(f.failure);assert.equal(f.progress.status, 'failed');assert.equal(f.progress.nativeRestored, false);assert.equal(f.progress.toggle.settled.completed, 1);assert.equal(f.choices, 2);assert.equal(f.closed, true);assert.deepEqual(f.storage.get(), f.storage.initial);
});
test('native alert refuses further input and still closes before exact raw restoration', async () => {
  const f = await protocol({ nativeError: true });assert.ok(f.failure);assert.equal(f.choices, 1);assert.equal(f.progress.nativeRestored, false);assert.equal(f.closed, true);assert.deepEqual(f.storage.get(), f.storage.initial);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});

for (const scenario of ['success', 'unknown', 'failure', 'close-failure', 'restore-failure', 'not-selected', 'held']) test(`actual runCase keeps session privacy and close-first raw custody: ${scenario}`, async () => {
  const source = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');const body = source.slice(source.indexOf('async function runCase('), source.indexOf('\nasync function crossSettingsDom('));
  const original = { sync: { present: false }, local: { present: false } };let storage = structuredClone(original);let closed = false;let captures = 0;let auth = 0;let saves = 0;let created = 0;let restored = false;const order = [];
  const page = new EventEmitter();Object.assign(page, { setViewport: async () => {}, bringToFront: async () => {}, isClosed: () => closed, url: () => F.url, close: async () => { order.push('close');if (scenario === 'close-failure') throw Error('DO_NOT_RETAIN_CLOSE');closed = true; }, goto: async () => {
    assert.equal(storage.sync.value.hideWhitespace, true);assert.equal(storage.sync.value.quickReview, false);order.push('navigate');
    page.emit('console', { type: () => 'log', text: () => 'DO_NOT_RETAIN_CONSOLE' });page.emit('pageerror', Error('DO_NOT_RETAIN_ERROR'));
    page.emit('requestfailed', { url: () => 'https://gitlab.com/public?DO_NOT_RETAIN_QUERY=secret', method: () => 'GET', failure: () => ({ errorText: 'DO_NOT_RETAIN_NETWORK' }) });return { status: () => 200 };
  } });
  const report = { cases: [], infrastructureErrors: [], quotaPolicy: { conservativeObservedRequestBudget: 40 } };
  const context = { assert, AbortController, console: { log() {} }, report, focus: scenario === 'not-selected' ? 'all' : 'gitlab-whitespace-session', FOCUSED_CASES: { 'gitlab-whitespace-session': ['gitlab-whitespace-session'] }, cooldowns: new Map(scenario === 'held' ? [['gitlab', Date.now() + 60000]] : []), providerOf: () => 'gitlab', currentCaseAbort: undefined,
    gitLabWhitespaceSessionSettings, gitLabWhitespaceSettings: () => { throw Error('Legacy lease must not handle the new case'); }, cleanupGitLabWhitespace, whitespaceReceiptURL, gitLabWhitespaceCases: new WeakMap(),
    options: { evaluate: async (...args) => { if (args.length === 2) { const value = args[1];if (!value.sync.present) { assert.equal(closed, true);if (scenario === 'restore-failure') throw Error('DO_NOT_RETAIN_STORAGE');restored = true;order.push('restore'); }storage = structuredClone(value); }return structuredClone(storage); } },
    browser: { newPage: async () => { created++;assert.equal(storage.sync.value.hideWhitespace, true);return page; } }, observeBitbucketBudget() {}, observeGitLabWhitespace: () => ({ evidence: { modes: [], overflow: false }, dispose() { order.push('traffic_disposed'); } }), observeGitLabComparisons: () => ({ dispose() { order.push('comparisons_disposed'); } }), extensionId: 'unit',
    safeUrl: (value) => value, errorText: (error) => String(error), closedTarget: () => false, saveReport: async () => { saves++; }, authObservation: async () => { auth++;throw Error('DO_NOT_RETAIN_AUTH'); }, capture: async () => { captures++;throw Error('DO_NOT_RETAIN_CAPTURE'); },
  };
  vm.createContext(context);new vm.Script(`${body}\nglobalThis.invoke = runCase;`).runInContext(context);
  await context.invoke('gitlab-whitespace-session', F.url, async (_page, item) => {
    item.nativeWhitespace.baseline = { anonymous: true };if (scenario === 'failure') { item.nativeWhitespace.status = 'failed';throw Error('DO_NOT_RETAIN_FAILURE'); }
    return { status: scenario === 'unknown' ? 'unavailable' : 'passed' };
  }, true);
  const item = report.cases[0];assert.equal(captures, 0);assert.equal(auth, 0);assert.equal(saves, 1);assert.doesNotMatch(JSON.stringify(report), /DO_NOT_RETAIN/);
  if (scenario === 'not-selected' || scenario === 'held') { assert.equal(created, 0);assert.deepEqual(storage, original);assert.equal(item.status, scenario === 'held' ? 'rate_limited' : 'not_selected'); }
  else { assert.ok(item.artifacts.suppressed);assert.equal(created, 1);if (scenario === 'close-failure' || scenario === 'restore-failure') { assert.equal(item.status, 'failed');assert.equal(restored, false); } else { assert.deepEqual(storage, original);assert.equal(restored, true);assert.ok(order.indexOf('close') < order.indexOf('restore'));assert.equal(item.status, scenario === 'failure' ? 'failed' : scenario === 'unknown' ? 'unavailable' : 'passed'); } }
});
