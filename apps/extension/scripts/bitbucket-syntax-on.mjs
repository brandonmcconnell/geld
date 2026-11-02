import assert from 'node:assert/strict';
import { assertBitbucketShellCounts, bitbucketShellProbe, flushObservedBitbucketShell, observedBitbucketShellIdentity, verifyBitbucketShell, verifyBitbucketShellSource } from './bitbucket-shell-acceptance.mjs';
import { assertBitbucketPipelineURL } from './bitbucket-pipeline-visit.mjs';

const SYNTAX = 'diff-settings-syntax-highlighting-toggle';
const SETTINGS = new Set(['pullRequestDefaultTab', 'diffViewMode', 'fileViewMode', 'tabSize', 'isWordDiffEnabled', 'shouldIgnoreWhitespace', 'isColorBlindModeEnabled', 'isSyntaxHighlightingEnabled', 'isAnnotationsEnabled', 'isSingleFileModeEnabled']);
export function syntaxOnBudgetPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  return { available: active === 0, active, remaining: budget - active, budget, measuredNavigation: 16, minimumFree: 8,
    basis: 'First native Save/restore request cost is unmeasured. Require a completely free rolling40 window, keep eight free before mutation, and retain global40/429/cleanup guards. No native cost guarantee or quota reset.' };
}

export function syntaxOnSafeURL(value) {
  try { const u = new URL(value);if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    u.search = new URLSearchParams([...u.searchParams.keys()].map((key) => [key, '[redacted]'])).toString();u.hash = '';return u.href; } catch { return null; }
}

export function syntaxOnSafeBody(raw) {
  if (typeof raw !== 'string' || raw.length > 16_384) return { available: false, reason: 'Absent or oversized body; no value retained' };
  try {
    const parsed = JSON.parse(raw);let nodes = 0;
    const walk = (value, depth = 0) => {
      assert.ok(++nodes <= 100 && depth <= 4, 'Body shape exceeds evidence bound');
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return '[redacted]';
      assert.ok(Object.keys(value).length <= 40, 'Body field count exceeds evidence bound');
      return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        const known = SETTINGS.has(key) && (typeof child === 'boolean' || Number.isSafeInteger(child) && child >= 0 && child <= 100 || typeof child === 'string' && ['UNIFIED', 'SIDE_BY_SIDE', 'TREE', 'LIST', 'ALL_FILES_MODE', 'SINGLE_FILE_MODE'].includes(child));
        return [key.slice(0, 80), known ? child : child !== null && typeof child === 'object' && !Array.isArray(child) ? walk(child, depth + 1) : '[redacted]'];
      }));
    };
    return { available: true, settings: walk(parsed) };
  } catch { return { available: false, reason: 'Non-JSON or bounded shape unavailable; no body retained' }; }
}

export function createSyntaxOnRequestIdentity() {
  const ids = new WeakMap();let next = 0;return (request) => { if (!ids.has(request)) ids.set(request, ++next);return ids.get(request); };
}

export function observeSyntaxOnTraffic(page, progress, extensionId, identifyRequest = createSyntaxOnRequestIdentity()) {
  progress.records = [];progress.windows = [];progress.truncated = false;progress.omittedHTTPURLs = 0;let phase = 'native_navigation';let current = null;let received = 0;const observed = new WeakMap();const pending = new Set();
  const append = (value) => { if (progress.records.length >= 2000) { progress.truncated = true;return; }progress.records.push(value); };
  const request = (r) => {
    const url = syntaxOnSafeURL(r.url());if (url === null) { if (/^https?:/i.test(r.url())) { progress.omittedHTTPURLs += 1;append({ kind: 'request', url: null, method: r.method(), phase, at: new Date().toISOString(), reason: 'Credentialed/malformed HTTP URL omitted; metadata incomplete' }); }return; }
    let stack = r.initiator?.()?.stack;let extension = false;
    for (let depth = 0; stack && depth < 8; depth += 1) { extension ||= (stack.callFrames ?? []).some((f) => f.url.startsWith(`chrome-extension://${extensionId}/`));stack = stack.parent; }
    const id = identifyRequest(r);received += 1;observed.set(r, { id, window: current?.id ?? null });const method = r.method();if (current && !['GET', 'HEAD', 'OPTIONS'].includes(method)) pending.add(id);
    append({ kind: 'request', id, at: new Date().toISOString(), phase, window: current?.id ?? null, url, method, extensionInitiator: extension,
      attribution: extension ? 'Extension stack observed' : 'Initiator not established; absence of extension frames is not native attribution',
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: syntaxOnSafeBody(r.postData?.()) } : {}) });
  };
  const response = (r) => { const url = syntaxOnSafeURL(r.url());const seen = observed.get(r.request());const id = identifyRequest(r.request());pending.delete(id);if (url !== null) append({ kind: 'response', id, at: new Date().toISOString(), phase, window: seen?.window ?? null, url, status: r.status() }); };
  const failure = (r) => { const seen = observed.get(r);pending.delete(seen?.id);append({ kind: 'requestfailed', id: seen?.id ?? null, at: new Date().toISOString(), phase, window: seen?.window ?? null, url: syntaxOnSafeURL(r.url()), error: r.failure()?.errorText?.slice(0, 2000) ?? null }); };
  const dispose = () => { progress.pendingSaveRequestIds = [...pending];page.off('request', request);page.off('response', response);page.off('requestfailed', failure); };
  page.on('request', request);page.on('response', response);page.on('requestfailed', failure);page.once('close', dispose);
  return { setPhase(value) { phase = value; },
    beginSave(expected) { assert.equal(current, null);current = { id: progress.windows.length + 1, expected, startedAt: new Date().toISOString(), firstReceipt: received + 1, status: 'armed' };progress.windows.push(current);phase = expected ? 'native_save_on' : 'native_save_off';return current; },
    endSave(formEvents) { assert.ok(current);current.events = formEvents;current.finishedAt = new Date().toISOString();current.status = 'observed';current = null;phase = 'after_native_save'; },
    pending: () => pending.size, dispose };
}

export function assertSyntaxOnTraffic(progress, standardMutations) {
  const writes = progress.records.filter((r) => r.kind === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  progress.writeSummary = { all: writes.length, outsideSaveWindows: writes.filter((r) => r.window === null).map((r) => ({ id: r.id, url: r.url, method: r.method, classification: 'Unattributed write outside native form windows; not silently excluded or assumed native' })), insideSaveWindows: writes.filter((r) => r.window !== null).map((r) => ({ id: r.id, url: r.url, method: r.method, window: r.window, classification: 'Observed in an armed form window; timing alone does not prove endpoint semantics or initiator' })), standardAPIMutationCount: standardMutations.length };
  assert.equal(progress.truncated, false, 'Native traffic evidence overflowed');
  assert.equal(progress.omittedHTTPURLs ?? 0, 0, 'Native HTTP URL evidence is incomplete');
  for (const window of progress.windows) {
    assert.equal(window.status, 'observed', 'Native Save window did not finish');assertNativeSaveEvents(window.events, window.expected);
  }
  for (const request of progress.records.filter((r) => r.kind === 'request' && r.window !== null && !['GET', 'HEAD', 'OPTIONS'].includes(r.method))) {
    const response = progress.records.find((r) => r.kind === 'response' && r.id === request.id);assert.ok(response, 'Observed native Save-window write did not receive a response');
    if (['https://bitbucket.org', 'https://api.bitbucket.org'].includes(new URL(request.url).origin)) assert.ok(response.status >= 200 && response.status < 400, 'Native Save-window first-party write was rejected; no effective/persisted-setting success inferred');
  }
  const matched = new Set();
  for (const mutation of standardMutations) {
    assert.ok(Number.isSafeInteger(mutation.requestId) && mutation.requestId > 0, 'Standard API mutation lacks shared HTTPRequest identity');
    const matches = progress.records.filter((r) => r.kind === 'request' && r.id === mutation.requestId && r.method === mutation.method && r.url === syntaxOnSafeURL(mutation.url) && r.window !== null);
    assert.equal(matches.length, 1, 'Standard API write association is missing or ambiguous');const record = matches[0];assert.equal(matched.has(record.id), false);matched.add(record.id);
    assert.ok(record && !record.extensionInitiator, 'Unattributed standard API mutation during native Syntax characterization');
    const window = progress.windows.find((w) => w.id === record.window);assert.ok(window && window.status === 'observed');
    const containsSetting = (value) => value !== null && typeof value === 'object' && Object.entries(value).some(([k, v]) => k === 'isSyntaxHighlightingEnabled' && v === window.expected || containsSetting(v));
    assert.ok(record.body?.available && containsSetting(record.body.settings), 'Observed API write lacks source-backed native Syntax setting evidence; endpoint semantics remain unknown');
    record.attribution = 'Trusted original form window plus observed Syntax setting body; initiator/endpoint/server persistence not independently established';
  }
}

export function assertNativeSaveEvents(events, expected) {
  assert.deepEqual(events.map((e) => `${e.type}:${e.control}`), ['click:syntax', 'input:syntax', 'change:syntax', 'click:save', 'submit:form'], 'Only the exact native Syntax toggle and Save event sequence is allowed');
  assert.equal(events.filter((e) => e.type === 'click' && e.control === 'syntax' && e.trusted).length, 1, 'Need one trusted original Syntax checkbox click');
  for (const type of ['input', 'change']) { const matches = events.filter((e) => e.type === type);assert.equal(matches.length, 1);assert.equal(matches[0].control, 'syntax');assert.equal(matches[0].trusted, true);assert.equal(matches[0].checked, expected); }
  assert.equal(events.filter((e) => e.type === 'click' && e.control === 'save' && e.trusted).length, 1, 'Need one trusted original Save click');
  const submits = events.filter((e) => e.type === 'submit');assert.equal(submits.length, 1);assert.equal(submits[0].trusted, true);assert.equal(submits[0].sameForm, true);assert.equal(submits[0].sameSubmitter, true);
  assert.ok(events.every((e) => e.control !== 'other' && e.trusted), 'An unrelated field or untrusted event invalidates the native form write');
}

export function assertSyntaxOnlyVector(before, after, checked) {
  assert.equal(before.length, 13);assert.equal(after.length, 13);assert.equal(before.filter((v) => v.id === SYNTAX).length, 1);
  const expected = before.map((v) => v.id === SYNTAX ? { ...v, checked } : v);
  assert.deepEqual(after, expected, 'Only native Syntax may change; preserve the other12 controls including hidden tabSize');
}

/** References and diagnostics only. Native input, Save and Cancel always use real browser handles. */
export function syntaxOnProbe(action = 'read', target = null) {
  const KEY = '__geldBitbucketSyntaxOnCharacterization';let store = globalThis[KEY];
  const forbidden = '[data-geld-ui],[data-testid="comment"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
  const native = (n) => n !== null && n.isConnected && n.closest(forbidden) === null;
  const visible = (n) => {
    if (!native(n) || n.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = n; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.contentVisibility === 'hidden' || s.opacity === '0' && !(p === n && n.tagName === 'INPUT' && n.type === 'checkbox')) return false; }
    const r = n.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const enabled = (n) => native(n) && !n.disabled && !n.readOnly && !n.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]');
  const actor = () => {
    const metas = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter(native);if (metas.length !== 1) return null;
    const node = metas[0];const user = node.getAttribute('data-current-user');const workspace = node.getAttribute('data-target-workspace-uuid');
    try { if (user.length > 16_384 || JSON.parse(user)?.isAuthenticated !== false || !workspace) return null; } catch { return null; }
    return { node, user, workspace };
  };
  const source = () => {
    const anchors = [...document.querySelectorAll('[id="chg-bitbucket-pipelines.yml"]')].filter(native);if (anchors.length !== 1) return null;
    const anchor = anchors[0];const root = anchor.parentElement;const articles = [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);if (articles.length !== 1) return null;const article = articles[0];
    if (article.querySelector('h2[data-qa="bk-filepath"]')?.textContent.trim() !== 'bitbucket-pipelines.yml') return null;
    const elements = [...article.querySelectorAll('[data-qa="code-line"]')].filter(native);if (elements.length === 0 || elements.length > 500) return null;
    let total = 0;const rows = elements.map((row) => { const code = row.querySelector('[data-line-type]');if (!native(code)) return null;
      const nodes = [];const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (++total > 4000) return null;nodes.push(n); }
      return { row, code, nodes, values: nodes.map((n) => n.data), font: getComputedStyle(code).font, idNodes: [...row.querySelectorAll('[id]')], linkNodes: [...row.querySelectorAll('a[href]')],
        semantic: { text: code.textContent, kind: code.getAttribute('data-line-type'), numbers: [...row.querySelectorAll('[data-key="code-line-number"]')].map((n) => [n.getAttribute('data-old-line-number'), n.getAttribute('data-new-line-number')]), ids: [...row.querySelectorAll('[id]')].map((n) => n.id), links: [...row.querySelectorAll('a[href]')].map((n) => [n.getAttribute('href'), n.getAttribute('aria-label')]) } }; });
    if (rows.some((r) => r === null)) return null;
    const viewed = [...root.querySelectorAll('label')].filter((n) => n.textContent.trim() === 'Viewed').map((n) => n.querySelector('input[type="checkbox"]'));
    if (viewed.length !== 1 || !native(viewed[0])) return null;
    return { anchor, root, parent: root.parentElement, article, articleParent: article.parentElement, rows, viewed: viewed[0], checked: viewed[0].checked, disabled: viewed[0].disabled };
  };
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(native);
  const settings = () => {
    const ds = dialogs();if (ds.length !== 1 || !visible(ds[0])) return null;const dialog = ds[0];const heading = dialog.getAttribute('aria-labelledby');if (!heading || document.getElementById(heading)?.textContent.trim() !== 'Global diff view settings' || !dialog.contains(document.getElementById(heading))) return null;
    const forms = [...dialog.querySelectorAll('form')];if (forms.length !== 1) return null;const form = forms[0];
    const fields = [...form.querySelectorAll('input,select,textarea')];if (fields.length !== 13 || fields.some((f) => !native(f) || f.disabled || f.readOnly)) return null;
    const shape = fields.map((f) => [f.id, f.name, f.type, f.type === 'radio' ? f.value : null]);
    if (JSON.stringify(shape) !== JSON.stringify([
      ['', 'diffViewMode', 'radio', 'UNIFIED'], ['', 'diffViewMode', 'radio', 'SIDE_BY_SIDE'],
      ['diff-settings-syntax-highlighting-toggle', 'enableSyntaxHighlighting', 'checkbox', null], ['diff-settings-ignore-whitespace-toggle', 'shouldIgnoreWhitespace', 'checkbox', null],
      ['diff-settings-word-diff-toggle', 'enableWordDiff', 'checkbox', null], ['diff-settings-color-blind-mode-toggle', 'enableColorBlindMode', 'checkbox', null], ['diff-settings-annotations-toggle', 'enableAnnotations', 'checkbox', null],
      ['', 'isSingleFileModeEnabled', 'radio', 'ALL_FILES_MODE'], ['', 'isSingleFileModeEnabled', 'radio', 'SINGLE_FILE_MODE'], ['tab-size-pref', '', 'text', null], ['', 'tabSize', 'hidden', null],
      ['', 'fileViewMode', 'radio', 'TREE'], ['', 'fileViewMode', 'radio', 'LIST'],
    ])) return null;
    const syntax = fields.filter((f) => f.id === 'diff-settings-syntax-highlighting-toggle');if (syntax.length !== 1) return null;const field = syntax[0];
    if (field.type !== 'checkbox' || field.name !== 'enableSyntaxHighlighting' || field.value !== 'enableSyntaxHighlighting' || !enabled(field) || ![...field.labels ?? []].some((l) => l.textContent.trim() === 'Syntax highlighting' && visible(l))) return null;
    if (fields.filter((f) => f.type === 'hidden').length !== 1 || fields.find((f) => f.type === 'hidden')?.name !== 'tabSize') return null;
    const buttons = [...form.querySelectorAll('button')].filter(native);const saves = buttons.filter((b) => b.type === 'submit' && b.textContent.trim() === 'Save' && enabled(b) && visible(b));const cancels = buttons.filter((b) => b.type === 'button' && b.textContent.trim() === 'Cancel' && enabled(b) && visible(b));
    if (saves.length !== 1 || cancels.length !== 1) return null;
    const vector = fields.map((f) => ({ id: f.id, name: f.name, type: f.type, value: f.value, checked: 'checked' in f ? f.checked : null, disabled: f.disabled, readOnly: 'readOnly' in f ? f.readOnly : false }));
    return { dialog, form, field, save: saves[0], cancel: cancels[0], fields, vector };
  };
  if (action === 'cleanup') { if (store) for (const type of ['click', 'input', 'change', 'submit']) document.removeEventListener(type, store.listen, true);delete globalThis[KEY];return null; }
  if (action === 'events') return store ? [...store.events] : [];
  const a = actor();const s = source();const u = new URL(location.href);
  if (!a || !s || u.origin !== 'https://bitbucket.org' || u.pathname !== '/atlassian/bitbucket-upload-file/pull-requests/27/diff' || u.search || u.hash !== '#chg-bitbucket-pipelines.yml' || u.username || u.password) return null;
  if (action === 'setup') {
    if (store || dialogs().length) return null;
    store = { url: location.href, actor: a, source: s, expectedSource: s, allowReplacement: false, on: null, baselineEvidence: null, nextBaseline: 0, nextForm: 0, foreign: [], opener: null, form: null, events: [], earlyEvents: [], expected: null, last: null };
    store.listen = (e) => {
      if (!(e.target instanceof Element)) return;const form = store.form;
      if (e.type === 'click' && store.expected?.contains(e.target)) { store.last = { trusted: e.isTrusted === true, type: 'click', control: store.expected.tagName, url: location.href };if (store.expected === store.opener) store.earlyEvents = []; }
      if (!form || !form.form.contains(e.target)) { const dialog = e.target.closest('[role="dialog"]');if (dialog && native(dialog) && dialog.querySelector('input[id="diff-settings-syntax-highlighting-toggle"]')) store.earlyEvents.push({ type: e.type, trusted: e.isTrusted === true });return; }
      const button = e.target.closest('button');const control = e.target === form.field ? 'syntax' : button === form.save ? 'save' : button === form.cancel ? 'cancel' : e.type === 'submit' && e.target === form.form ? 'form' : 'other';
      const event = { type: e.type, trusted: e.isTrusted === true, control, ...(control === 'syntax' ? { checked: form.field.checked } : {}), ...(e.type === 'submit' ? { sameForm: e.target === form.form, sameSubmitter: e.submitter === form.save } : {}) };
      store.events.push(event);
    };
    for (const type of ['click', 'input', 'change', 'submit']) document.addEventListener(type, store.listen, true);globalThis[KEY] = store;
  }
  if (!store) return null;
  const b = store.source;const sameScope = store.url === location.href && store.actor.node === a.node && store.actor.user === a.user && store.actor.workspace === a.workspace;
  const sameSemantic = JSON.stringify(s.rows.map((r) => r.semantic)) === JSON.stringify(b.rows.map((r) => r.semantic));
  const sameContainer = s.anchor === b.anchor && s.root === b.root && s.parent === b.parent && s.article === b.article && s.articleParent === b.articleParent && s.viewed === b.viewed && s.checked === b.checked && s.disabled === b.disabled;
  const preserved = (baseline) => baseline !== null && s.rows.length === baseline.rows.length && s.rows.every((r, i) => { const old = baseline.rows[i];return r.row === old.row && r.code === old.code && r.font === old.font && r.nodes.length === old.nodes.length && r.nodes.every((n, j) => n === old.nodes[j] && n.data === old.values[j]) && r.idNodes.length === old.idNodes.length && r.idNodes.every((n, j) => n === old.idNodes[j]) && r.linkNodes.length === old.linkNodes.length && r.linkNodes.every((n, j) => n === old.linkNodes[j]); });
  const same = sameScope && sameSemantic && sameContainer && (store.allowReplacement || preserved(store.expectedSource));const form = settings();
  if (action === 'bind') { if (!same || !form || store.earlyEvents.length || store.form?.dialog === form.dialog) return null;store.form = { ...form, id: `native-form-${++store.nextForm}` };store.events = [];store.last = null;return form.vector; }
  const sameForm = form !== null && store.form !== null && form.dialog === store.form.dialog && form.form === store.form.form && form.field === store.form.field && form.save === store.form.save && form.cancel === store.form.cancel && form.fields.every((f, i) => f === store.form.fields[i]);
  if (action === 'begin-native-save') {
    const allowed = same && sameForm && form.field.checked === target && store.events.length === 3 && store.events.every((e, i) => e.trusted && e.control === 'syntax' && e.type === ['click', 'input', 'change'][i] && e.checked === target);
    if (allowed) store.allowReplacement = true;return allowed;
  }
  if (action === 'finish-native-restore') {
    if (!same || !sameForm || form.field.checked || store.events.length) return null;store.expectedSource = s;store.allowReplacement = false;
  }
  if (action === 'ready-frames') {
    if (!same || !sameForm) return null;
    return new Promise((resolve) => { let frames = 0;let pending;const timeout = setTimeout(() => { cancelAnimationFrame(pending);resolve(null); }, 3000);
      const sample = () => { const current = syntaxOnProbe();if (!current?.same || !current.ready || current.events.length) { clearTimeout(timeout);resolve(null);return; }frames += 1;if (frames === 2) { clearTimeout(timeout);resolve({ frames, same: true, ready: true }); }else pending = requestAnimationFrame(sample); };pending = requestAnimationFrame(sample);
    });
  }
  if (action === 'event') return store.last;
  if (action === 'opener' || action === 'arm-opener') {
    const list = [...document.querySelectorAll('button[aria-live="polite"]')].filter((n) => n.textContent.trim() === 'Global diff settings' && !n.hasAttribute('aria-label') && !n.hasAttribute('aria-labelledby') && n.type === 'button' && n.tabIndex >= 0 && enabled(n) && visible(n) && n.closest('[role="tabpanel"]')?.id === 'pull-request-tabs-1-tab');const chosen = same && dialogs().length === 0 && list.length === 1 && (store.opener === null || store.opener === list[0]) ? list[0] : null;
    if (action === 'opener') { store.opener ??= chosen;return chosen; }store.expected = chosen;store.last = null;return chosen !== null && chosen === target;
  }
  if (action.startsWith('arm-')) { const kind = action.slice(4);const chosen = same && sameForm && ['syntax', 'save', 'cancel'].includes(kind) ? form[kind === 'syntax' ? 'field' : kind] : null;store.expected = chosen;store.last = null;return chosen !== null && chosen === target; }
  if (['syntax', 'save', 'cancel'].includes(action)) return same && sameForm ? form[action === 'syntax' ? 'field' : action] : null;
  if (action === 'hit') { if (target !== store.expected || !same || !native(target) || !enabled(target) || !visible(target)) return false;const r = target.getBoundingClientRect();return target.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }
  if (action === 'baseline-on') {
    const owned = [...CSS.highlights ?? []].filter(([key]) => key.startsWith('geld-bitbucket-shell-'));const ownedCount = owned.reduce((sum, [, ranges]) => sum + [...ranges].length, 0);
    if (!same || !sameForm || !form.field.checked || store.events.length || owned.length) return null;store.on = s;store.foreign = [...CSS.highlights ?? []].map(([key, highlight]) => ({ key, highlight, ranges: [...highlight] }));
    store.expectedSource = s;store.allowReplacement = false;store.baselineEvidence = { origin: 'fresh-native-on-form-open', id: `native-on-${++store.nextBaseline}`, formId: store.form.id, formControls: form.fields.length, url: location.href, dialogs: dialogs().length, checked: form.field.checked, ownedCount, events: [...store.events], semanticRows: s.rows.map((r) => r.semantic), vector: form.vector };
  }
  const foreignPreserved = store.foreign.every((p) => CSS.highlights?.get(p.key) === p.highlight && [...p.highlight].length === p.ranges.length && [...p.highlight].every((range, i) => range === p.ranges[i]));
  return { same, sameScope, sameSemantic, sameContainer, offPreserved: preserved(b), onBaseline: store.on !== null, onPreserved: preserved(store.on), dialogs: dialogs().length,
    ready: same && sameForm, formAvailable: same && form !== null && store.earlyEvents.length === 0, vector: sameForm ? form.vector : null, events: [...store.events], earlyEvents: [...store.earlyEvents], sourceRows: s.rows.length, semanticRows: s.rows.map((r) => r.semantic), checked: sameForm ? form.field.checked : null, foreignPreserved, baselineEvidence: store.baselineEvidence,
    lifecycle: { originalCodeRows: s.rows.filter((r, i) => r.row === b.rows[i].row).length, originalTextNodes: s.rows.reduce((sum, r, i) => sum + r.nodes.filter((n) => b.rows[i].nodes.includes(n)).length, 0) } };
}

export async function characterizeBitbucketSyntaxOn(page, item, deps) {
  const { poll, pause, capture, guardBudget, tabState, bitbucketDom, traffic } = deps;
  const proof = { status: 'running', writes: [], restoration: { status: 'pending' }, limitations: ['Ephemeral anonymous native UI characterization only; no authenticated or server-persistence claim.', 'Actual selected-theme owned ADS color equality is not native Bash-renderer palette equivalence.'] };item.syntaxOn = proof;
  let installed = false;let modified = false;let initialVector;let failure;let head;let initialState;let initialCounts;
  const read = () => page.evaluate(syntaxOnProbe);
  const current = async () => { await (deps.unitOnly?.flush ?? flushObservedBitbucketShell)(page);assertBitbucketPipelineURL(page.url(), item.shellSyntax.visit.url);const h = observedBitbucketShellIdentity(item.shellNativeSources);assert.deepEqual([h.sourceRepo, h.head, h.base], [head.sourceRepo, head.head, head.base]);return h; };
  const counts = async () => { await current();assertBitbucketShellCounts(initialCounts, initialState, await bitbucketDom(page), await tabState(page));assert.equal((await read())?.same, true, 'Native actor, source semantics, file root or Viewed changed'); };
  const click = async (action) => {
    const budget = guardBudget();await current();const handle = await page.evaluateHandle(syntaxOnProbe, action);
    try { const control = handle.asElement();assert.ok(control, `Original native ${action} unavailable`);await control.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));assert.equal(await page.evaluate(syntaxOnProbe, `arm-${action}`, control), true);assert.equal(await page.evaluate(syntaxOnProbe, 'hit', control), true);guardBudget();await control.click();const event = await page.evaluate(syntaxOnProbe, 'event');assert.equal(event?.trusted, true);(proof.actions ??= []).push({ action, budget, event });await current();return event; } finally { await handle.dispose(); }
  };
  const open = async () => { await click('opener');await poll(read, (v) => v?.same && v.dialogs === 1 && v.formAvailable, 'One hydrated original native13-control Settings form', 4000);const vector = await page.evaluate(syntaxOnProbe, 'bind');assert.ok(Array.isArray(vector) && vector.length === 13, 'Original13 native controls and unique Save/Cancel required');return vector; };
  const close = async () => { const event = await click('cancel');await poll(read, (v) => v?.same && v.dialogs === 0, 'Trusted Cancel removes original form', 4000);return event; };
  const save = async (checked) => {
    const budget = guardBudget();assert.ok(40 - budget.observedWithinRollingHour >= 8, 'Keep eight free before native mutation; Save/restore cost is unmeasured');await counts();
    const before = await read();assertSyntaxOnlyVector(initialVector, before.vector, !checked);
    const record = { expected: checked, before, budget };proof.writes.push(record);modified = true;
    await click('syntax');const changed = await read();assertSyntaxOnlyVector(initialVector, changed.vector, checked);assert.equal(await page.evaluate(syntaxOnProbe, 'begin-native-save', checked), true, 'Source replacement permission requires the actual trusted original checkbox event sequence');
    const window = traffic.beginSave(checked);record.window = window.id;
    try { record.save = await click('save');await poll(read, (v) => v?.same && v.dialogs === 0, 'Native Save removes its original form', 5000); }
    finally { const events = await page.evaluate(syntaxOnProbe, 'events');record.events = events;traffic.endSave(events); }
    assertNativeSaveEvents(record.events, checked);await counts();return record;
  };
  try {
    assert.equal(deps.freshAnonymousProfile, true, 'Native Save characterization requires the dedicated fresh anonymous profile');
    traffic.setPhase('native_off_baseline');await (deps.unitOnly?.prepareOff ?? verifyBitbucketShell)(page, item, deps);
    proof.offBaseline = structuredClone(item.shellSyntax);
    if (item.shellSyntax.status !== 'native_disabled') { proof.status = 'unsupported';proof.reason = 'The fresh anonymous baseline is not positively native-off; no toggle or Save performed';return proof; }
    head = observedBitbucketShellIdentity(item.shellNativeSources);proof.head = head;initialCounts = await bitbucketDom(page);initialState = await tabState(page);
    const setup = await page.evaluate(syntaxOnProbe, 'setup');assert.ok(setup?.same && setup.offPreserved, 'Exact anonymous source/actor baseline required');installed = true;
    const initial = await open();assert.equal(initial.find((f) => f.id === SYNTAX)?.checked, false);assertSyntaxOnlyVector(initial, initial, false);initialVector = initial;proof.initialVector = initialVector;
    await save(true);traffic.setPhase('fresh_native_on');const on = await open();assertSyntaxOnlyVector(initialVector, on, true);
    proof.onReadiness = await page.evaluate(syntaxOnProbe, 'ready-frames');assert.equal(proof.onReadiness?.frames, 2, 'Pristine native form must survive actual animation-frame samples before Cancel');await counts();proof.nativeOnComparison = await current();
    proof.nativeOnBeforeCancel = await page.evaluate(syntaxOnProbe, 'baseline-on');assert.equal(proof.nativeOnBeforeCancel?.onBaseline, true, 'Capture fresh native-On Text nodes with no owned colors before pristine Cancel');assert.deepEqual(proof.nativeOnBeforeCancel.events, []);assertSyntaxOnlyVector(initialVector, proof.nativeOnBeforeCancel.vector, true);
    proof.rawNativeOnSourceBeforeCancel = await page.evaluate(bitbucketShellProbe);assert.equal(proof.rawNativeOnSourceBeforeCancel.ownedCount, 0);
    proof.onCancel = await close();await counts();
    const joined = async () => { const source = await page.evaluate(bitbucketShellProbe);const native = await read();return { source, native }; };
    const painted = await poll(joined, (v) => v.source?.ownedCount > 0 && v.native?.onBaseline && v.native.onPreserved, 'Qualified native On produces owned ranges without replacing native-On source', 5000);
    const validate = async (value) => verifyBitbucketShellSource(value.source, item.shellSyntax.visit.url, { origin: 'fresh-native-on-form-open', record: proof.nativeOnBeforeCancel.baselineEvidence, currentNative: value.native, subject: proof.nativeOnComparison, currentSubject: await current() });
    proof.paint = await validate(painted);proof.painted = painted;await counts();
    guardBudget();const target = await page.evaluate(bitbucketShellProbe, 'selection-target');assert.ok(target?.visible);assert.equal(target.text, 'if [');await page.mouse.move(target.x1, target.y);await page.mouse.down();await page.mouse.move(target.x2, target.y, { steps: 6 });await page.mouse.up();
    const selected = await poll(joined, (v) => v.source?.selection?.text === 'if [', 'Real source text selection with native Syntax On');await validate(selected);await pause(350);const stable = await joined();await validate(stable);assert.deepEqual(stable.source.selection, selected.source.selection);proof.selection = { before: selected.source.selection, after: stable.source.selection };await counts();
    proof.artifacts = await capture(page, 'bitbucket-native-syntax-on', { fullPage: false });proof.afterCapture = await joined();await validate(proof.afterCapture);assert.deepEqual(proof.afterCapture.source.selection, selected.source.selection);await counts();
    await poll(() => traffic.pending(), (n) => n === 0, 'Observed native On Save-window writes settled', 3000);assertSyntaxOnTraffic(item.syntaxOnTraffic, item.shellNativeSources.mutations);proof.status = 'characterized';
  } catch (error) { failure = error;proof.status = 'failed';proof.error = String(error); }
  finally {
    let cleanupFailure;
    try {
      if (installed && initialVector === undefined) {
        proof.restoration = { status: 'not_modified', reason: 'No validated initial field vector or checkbox/Save attempt. Unknown native form remains untouched for profile closure.', nativeDialogMayRemainOpen: true };
      } else if (installed) {
        assert.equal(page.isClosed(), false, 'Native page closed before Off restoration');await current();traffic.setPhase('restore_native_off');
        let state = await read();assert.ok(state?.same);
        if (state.dialogs > 0) { assert.equal(state.ready, true, 'Do not operate an unknown replacement dialog');await close(); }
        const vector = await open();const checked = vector.find((f) => f.id === SYNTAX)?.checked;assertSyntaxOnlyVector(initialVector, vector, checked);
        if (checked) await save(false);else await close();
        const off = await open();assertSyntaxOnlyVector(initialVector, off, false);proof.restoration.initialOff = off;assert.deepEqual((await read()).events, []);assert.equal((await page.evaluate(syntaxOnProbe, 'finish-native-restore'))?.same, true);proof.restoration.cancel = await close();await counts();
        const source = await page.evaluate(bitbucketShellProbe);assert.equal(source.ownedCount, 0);assert.deepEqual(source.ranges, []);assert.deepEqual(source.invalidRanges, []);proof.restoration.source = source;proof.restoration.native = await read();assert.equal(proof.restoration.native.same, true);
        proof.restoration.status = 'restored';proof.restoration.modificationAttempted = modified;
      } else { proof.restoration.status = 'not_modified'; }
    } catch (error) { cleanupFailure = error;proof.restoration.status = 'failed';proof.restoration.error = String(error);proof.status = 'failed'; }
    finally {
      try { await poll(() => traffic.pending(), (n) => n === 0, 'Observed native Save/restore-window writes settled', 3000);assertSyntaxOnTraffic(item.syntaxOnTraffic, item.shellNativeSources.mutations);proof.trafficCheck = { status: 'recorded', attribution: 'All native traffic retained; Save windows and source-backed setting bodies are separate from endpoint or persistence proof' }; }
      catch (error) { cleanupFailure ??= error;proof.trafficCheck = { status: 'failed', error: String(error) };proof.status = 'failed'; }
      if (!page.isClosed()) for (const probe of [syntaxOnProbe, bitbucketShellProbe]) try { await page.evaluate(probe, 'cleanup'); } catch (error) { cleanupFailure ??= error;proof.cleanupError = String(error);proof.status = 'failed'; }traffic.setPhase('after_native_syntax_on');
    }
    if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Native On characterization and Off restoration both failed');if (cleanupFailure) throw cleanupFailure;
  }
  if (failure) throw failure;return proof;
}
