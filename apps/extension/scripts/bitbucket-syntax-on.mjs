import assert from 'node:assert/strict';
import { assertBitbucketShellCounts, bitbucketShellProbe, flushObservedBitbucketShell, observedBitbucketShellIdentity, verifyBitbucketShell, verifyBitbucketShellSource } from './bitbucket-shell-acceptance.mjs';
import { assertBitbucketPipelineURL } from './bitbucket-pipeline-visit.mjs';
import { syntaxOnProbe } from './bitbucket-syntax-on-probe.mjs';
export { syntaxOnProbe } from './bitbucket-syntax-on-probe.mjs';

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
