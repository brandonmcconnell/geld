import assert from 'node:assert/strict';
import { nativeSettingsReadinessProbe, waitNativeSettingsCandidate } from './native-settings-readiness.mjs';
import { isDeepStrictEqual } from 'node:util';
import { bitbucketShellProbe, flushObservedBitbucketShell, observedBitbucketShellIdentity, verifyBitbucketShellContext, verifyBitbucketShellSource } from './bitbucket-shell-acceptance.mjs';
import { assertBitbucketPipelineURL, bitbucketPipelineVisitProbe, prepareBitbucketPipelineVisit } from './bitbucket-pipeline-visit.mjs';
import { prepareBitbucketPipelineConsent } from './bitbucket-pipeline-consent.mjs';
import { assertNativeSaveEvents, assertSyntaxOnlyVector, assertSyntaxOnTraffic, syntaxOnSafeURL } from './bitbucket-syntax-on.mjs';
import { createInitialOnSourceQualifier, initialOnActorProbe } from './bitbucket-initial-on-source.mjs';
import { syntaxOnProbe } from './bitbucket-syntax-on-probe.mjs';

const SYNTAX = 'diff-settings-syntax-highlighting-toggle';
const comparison = (v) => [v.sourceRepo, v.head, v.base];
const TOTALS = { files: 5, additions: 46, deletions: 29 };
export function initialNativeOnPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  return { budgetAvailable: active === 0, active, budget, minimumFreeBeforeSave: 8,
    admissionRequirement: { boundary: 'ROOT-MANUAL', verifiedByHarness: false, requirement: 'Root independently verifies prior successful PR NativeOn210, its exact native preference restoration and observed costs before selecting this literal focus. Cite run, artifact and report hashes in the admission note. Literal selection is an operator instruction, never automated proof.' },
    basis: 'Require a fully free rolling40 window. Native preparation, Save/read/restore and first enabled product demand costs are unknown. Historical NativeOn navigation is not a cost forecast.' };
}

export function initialNativeOnSettings({ readSettings, writeSettings, progress }) {
  let original;let scoped;let captured = false;let prepared = false;let enabled = false;let attemptedEnable = false;
  const value = () => ({ ...scoped, enabled });
  return {
    async prepare() {
      original = structuredClone(await readSettings());assert.ok(original === undefined || original !== null && typeof original === 'object' && !Array.isArray(original));
      scoped = { ...original, enabled: false, prOverview: false, quickReview: false };captured = true;
      progress.status = 'preparing';progress.rawSettingsPresent = original !== undefined;progress.transitions = [];
      await writeSettings(structuredClone(scoped));assert.deepEqual(await readSettings(), scoped);prepared = true;progress.status = 'disabled_before_page';
    },
    async current(expected) { assert.ok(captured);assert.equal(enabled, expected);assert.deepEqual(await readSettings(), value(), 'Unrelated settings drift during first-use acceptance'); },
    async enable() {
      assert.ok(captured && !enabled && !attemptedEnable, 'Only one first-use enable is allowed');assert.deepEqual(await readSettings(), value());attemptedEnable = true;enabled = true;
      const record = { enabled: true, status: 'pending' };progress.transitions.push(record);
      try { await writeSettings(value());assert.deepEqual(await readSettings(), value());record.status = 'saved';progress.status = 'enabled_for_first_apply'; }
      catch (error) { record.status = 'failed';record.error = String(error);throw error; }
    },
    async disable() {
      if (!captured) return;
      const actual = await readSettings();assert.ok(isDeepStrictEqual(actual, scoped) || attemptedEnable && isDeepStrictEqual(actual, { ...scoped, enabled: true }), 'Do not overwrite unrelated settings during first-use cleanup');
      enabled = false;const record = { enabled: false, status: 'pending' };progress.transitions.push(record);
      try { await writeSettings(value());assert.deepEqual(await readSettings(), value());record.status = 'saved';progress.status = 'disabled_for_native_restore'; }
      catch (error) { record.status = 'failed';record.error = String(error);throw error; }
    },
    async restore(closed) {
      if (!captured) return;progress.restoration = { status: 'pending', pageClosedBeforeRestore: closed };
      try { assert.equal(closed, true, 'Close native page before final master/flags restoration');assert.equal(enabled, false, 'Master stays disabled until the page is closed');const current = await readSettings();assert.ok(isDeepStrictEqual(current, scoped) || !prepared && isDeepStrictEqual(current, original), 'Do not overwrite a settings change');await writeSettings(structuredClone(original));assert.deepEqual(await readSettings(), original);progress.restoration.status = 'restored'; }
      catch (error) { progress.restoration.status = 'failed';progress.restoration.error = String(error);throw error; }
    },
  };
}

export function assertInitialNativeOnTraffic(progress, mutations) {
  assertSyntaxOnTraffic(progress, mutations);
  const generatedWrites = progress.records.filter((r) => r.kind === 'request' && r.extensionInitiator === true && !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  assert.deepEqual(generatedWrites, [], 'The extension must not issue any native preference or other write during first-use acceptance');
}

export function assertInitialNativeOnState(counts, state, enabled) {
  for (const [key, total] of Object.entries(TOTALS)) assert.equal(counts[key], total, `Native ${key} changed`);
  assert.equal(state.allowed, enabled, 'Actual installed master state differs');
  if (!enabled) { assert.equal(state.hasDiff, false);return; }
  assert.equal(state.hasDiff, true);assert.equal(state.onDiffPage, true);assert.equal(state.hiddenCount, 0);
  for (const key of ['all', 'visible']) for (const [field, total] of Object.entries(TOTALS)) assert.equal(state[key]?.[field], total, `Actual installed ${key}.${field} changed`);
  assert.equal(state.repository?.provider, 'bitbucket');assert.equal(state.repository?.origin, 'https://bitbucket.org');assert.equal(state.repository?.path, 'atlassian/bitbucket-upload-file');
}

/** Unknown form diagnostics deliberately omit values, labels, IDs and field contents. */
export function initialNativeOnFormShape() {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((n) => n.closest('[data-geld-ui],[data-testid="comment"],[data-qa="pr-activity"]') === null);
  const safe = (s) => /^[a-zA-Z0-9_-]{0,80}$/.test(s ?? '') ? s : '[omitted]';
  return { dialogs: dialogs.length, fields: dialogs.slice(0, 2).flatMap((d) => [...d.querySelectorAll('input,select,textarea')].slice(0, 30).map((f) => ({ name: safe(f.name), type: safe(f.type) }))) };
}

export async function prepareInitialNativeOnSource(page, item, { poll, guardBudget, tabState, bitbucketDom, freshAnonymousProfile, settings, sourceQualifier }) {
  const evidence = item.shellNativeSources;const proof = { status: 'preparing', clicks: [] };item.initialNativeOn.preparation = proof;
  const current = async () => { await settings.current(false);await flushObservedBitbucketShell(page);const head = sourceQualifier ? sourceQualifier.current() : observedBitbucketShellIdentity(evidence);if (proof.head) assert.deepEqual(comparison(head), comparison(proof.head));const state = await tabState(page);assert.equal(state.allowed, false);assert.equal(state.hasDiff, false);return head; };
  if (sourceQualifier) { proof.head = await sourceQualifier.qualify();await current(); }
  else { proof.head = await poll(current, (v) => v !== null, 'Already-issued immutable native comparison and inactive extension'); }
  evidence.phase = 'firstuse_native_pipeline_selection';proof.visit = {};
  const url = await prepareBitbucketPipelineVisit(page, { poll, progress: proof.visit, guardBudget, assertHead: () => { const head = sourceQualifier ? sourceQualifier.current() : observedBitbucketShellIdentity(evidence);assert.deepEqual(comparison(head), comparison(proof.head));return head; } });
  proof.consent = {};
  await prepareBitbucketPipelineConsent(page, { progress: proof.consent, poll, guardBudget, flush: () => flushObservedBitbucketShell(page), freshAnonymousProfile, safeUrl: (value) => syntaxOnSafeURL(value) ?? '[omitted malformed HTTP URL]',
    assertCurrent: () => { assertBitbucketPipelineURL(page.url(), url);const h = sourceQualifier ? sourceQualifier.current() : observedBitbucketShellIdentity(evidence);assert.deepEqual(comparison(h), comparison(proof.head));return h; },
    readState: async () => ({ counts: await bitbucketDom(page), state: await tabState(page), visit: await page.evaluate(bitbucketPipelineVisitProbe) }),
    assertState: (before, after) => { for (const s of [before, after]) { assertInitialNativeOnState(s.counts, s.state, false);assert.ok(s.visit?.sameSource && s.visit.selected); }assert.deepEqual(after, before); },
  });
  const baseline = await poll(() => page.evaluate(bitbucketShellProbe), (v) => v !== null && v.rows.some((r) => r.next === 34), 'Original native Pipeline rows before first use');
  assert.equal(baseline.prefixOld, 18);assert.equal(baseline.prefixNext, 16);assert.equal(baseline.ownedCount, 0);assert.deepEqual(baseline.invalidRanges, []);proof.baseline = baseline;
  await page.evaluate(bitbucketShellProbe, 'observe');let expanded = baseline;
  for (let i = 0; expanded.prefixNext < 37 && i < 2; i += 1) {
    const budget = guardBudget();await current();assertBitbucketPipelineURL(page.url(), url);
    const bounds = { previous: [expanded.prefixOld, expanded.prefixNext], next: [29, 27] };
    assert.ok(bounds.previous[0] >= 18 && bounds.previous[0] < 29 && bounds.previous[1] >= 16 && bounds.previous[1] < 27);
    assert.equal((await page.evaluate(bitbucketShellProbe, 'scroll', bounds))?.matches, 1);
    await poll(() => page.evaluate(bitbucketShellProbe), (v) => v.controls.some((c) => c.visible && isDeepStrictEqual(c.previous, bounds.previous) && isDeepStrictEqual(c.next, bounds.next)), 'Exact original native context button visible', 5000);
    await current();const armed = await page.evaluate(bitbucketShellProbe, 'arm', bounds);const handle = await page.evaluateHandle(bitbucketShellProbe, 'button', bounds);let immediateBudget;
    try { const button = handle.asElement();assert.ok(button);await current();immediateBudget = guardBudget();await button.click(); } finally { await handle.dispose(); }
    const event = await page.evaluate(bitbucketShellProbe, 'click-result');assert.equal(event.trusted, true);assert.equal(event.qa, 'pr-diff-show-more-lines-below');assert.equal(event.aria, 'Show more lines below');assertBitbucketPipelineURL(event.url, url);assert.deepEqual(event.previous, bounds.previous);assert.deepEqual(event.next, bounds.next);proof.clicks.push({ budget, immediateBudget, armed, event });
    const prefix = expanded.prefixNext;expanded = await poll(() => page.evaluate(bitbucketShellProbe), (v) => v.prefixNext > prefix, 'Actual native context progresses', 20_000);await current();assert.equal(expanded.ownedCount, 0);
  }
  verifyBitbucketShellContext(expanded, url);assert.equal(expanded.rows.length, 55, 'Known complete native source vector required');proof.expanded = expanded;if (sourceQualifier) sourceQualifier.reconcile(expanded);
  assertInitialNativeOnState(await bitbucketDom(page), await tabState(page), false);proof.status = 'prepared';return { url, head: proof.head };
}

/** Bounded projection of the existing read, never bootstrap, code rows or native field values. */
export function projectInitialNativeOnGuard(value, phase, masterEnabled) {
  const phases = ['current', 'before-counts', 'before-native-restore', 'before-enable', ...['opener', 'syntax', 'save', 'cancel'].flatMap((kind) => ['before-', 'armed-', 'after-'].map((prefix) => prefix + kind))];
  const booleans = ['same', 'sameScope', 'sameCodeCharacters', 'sameContainer', 'expectedSourcePreserved', 'saveArmedOn', 'saveArmedOff', 'offPreserved', 'onBaseline', 'onPreserved', 'foreignPreserved', 'ready', 'formAvailable'];
  const boolean = (v) => typeof v === 'boolean' ? v : null;
  const count = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null;
  return { phase: phases.includes(phase) ? phase : 'unknown', masterEnabled: boolean(masterEnabled), present: value !== null && typeof value === 'object',
    ...Object.fromEntries(booleans.map((key) => [key, boolean(value?.[key])])),
    lineModel: { valid: boolean(value?.lineModel?.valid), mode: ['on', 'off'].includes(value?.lineModel?.mode) ? value.lineModel.mode : null },
    sourceRows: count(value?.sourceRows, 500), dialogs: count(value?.dialogs, 20),
    lifecycle: { originalCodeRows: count(value?.lifecycle?.originalCodeRows, 500), originalTextNodes: count(value?.lifecycle?.originalTextNodes, 4000) } };
}

export async function verifyInitialNativeOn(page, item, deps) {
  const { poll, pause, tabState, bitbucketDom, settings, guardBudget, traffic, capture } = deps;
  const p = { status: 'running', actions: [], writes: [], restoration: { status: 'pending' }, sourceGuard: { last: null, failure: null }, ordering: { boundary: 'Source-audited master-off control flow', privateCapabilityRead: false, internalGlobalCapability: 'Not read or instrumented' }, limitations: ['One same-visit initial file-local native On Pipeline, not global preference, native Bash palette, dark, authenticated or server-persistence acceptance.'] };item.initialNativeOn = p;
  let installed = false;let initial;let failure;let visit;let active = false;let modified = false;
  const flush = deps.unitOnly?.flush ?? flushObservedBitbucketShell;
  const sourceQualifier = deps.unitOnly ? deps.unitOnly.sourceQualifier : createInitialOnSourceQualifier(page, item, { guardBudget, settings, tabState, flush, signal: deps.signal, poll });
  const sourceHead = () => sourceQualifier ? sourceQualifier.current() : observedBitbucketShellIdentity(item.shellNativeSources);
  const read = () => page.evaluate(syntaxOnProbe);
  const current = async (phase = 'current') => { assert.equal(page.isClosed(), false);await settings.current(active);await flush(page);assertBitbucketPipelineURL(page.url(), visit.url);const head = sourceHead();assert.deepEqual(comparison(head), comparison(visit.head));const v = await read();const guard = projectInitialNativeOnGuard(v, phase, active);p.sourceGuard.last = guard;if (v?.same !== true && p.sourceGuard.failure === null) p.sourceGuard.failure = guard;assert.equal(v?.same, true, 'Current native actor/source/head/Viewed owner changed');if (!active) assert.equal((await page.evaluate(bitbucketShellProbe)).ownedCount, 0);return v; };
  const counts = async () => { await current('before-counts');p.counts = { native: await bitbucketDom(page), state: await tabState(page), masterEnabled: active };assertInitialNativeOnState(p.counts.native, p.counts.state, active); };
  const click = async (kind) => {
    assert.equal(active, false, 'All native Settings interactions must occur with Geld disabled');const budget = guardBudget();await current('before-' + kind);const handle = await page.evaluateHandle(syntaxOnProbe, kind);
    try { const control = handle.asElement();assert.ok(control, `Original native ${kind} unavailable`);await control.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));assert.equal(await page.evaluate(syntaxOnProbe, `arm-${kind}`, control), true);assert.equal(await page.evaluate(syntaxOnProbe, 'hit', control), true);await current('armed-' + kind);if (kind === 'opener') assert.equal((await page.evaluate(nativeSettingsReadinessProbe, 'begin', 'pipeline', control))?.started, true);const immediateBudget = guardBudget();if (kind === 'save') { p.writes.at(-1).immediateBudget = immediateBudget;assert.ok(40 - immediateBudget.observedWithinRollingHour >= 8, 'Eight free immediately before native Save'); }await control.click();const event = await page.evaluate(syntaxOnProbe, 'event');assert.equal(event?.trusted, true);p.actions.push({ kind, masterEnabled: active, budget, immediateBudget, event });await current('after-' + kind);return event; } finally { await handle.dispose(); }
  };
  const open = async () => {
    const progress = { status: 'opening' };(p.formReadiness ??= []).push(progress);
    try {
      await click('opener');const bound = await waitNativeSettingsCandidate(page, { readCurrent: current, read, bind: async () => ({ vector: await page.evaluate(syntaxOnProbe, 'bind') }), pause, progress });p.lastForm = progress.samples.at(-1);
      if (bound === null) { p.readinessBlocked = true;p.unknownForm = p.lastForm?.diagnostics ?? { fields: [] };return null; }
      p.readinessBlocked = false;assert.ok(bound.vector?.length === 13);return bound.vector;
    } catch (error) { p.readinessBlocked = true;throw error; }
  };
  const close = async () => { const event = await click('cancel');await poll(read, (v) => v?.same && v.dialogs === 0, 'Original native Cancel removes form', 4000);return event; };
  const save = async (checked) => {
    const budget = guardBudget();assert.ok(40 - budget.observedWithinRollingHour >= 8, 'Eight free before native Save preparation');await counts();assertSyntaxOnlyVector(initial, (await read()).vector, !checked);modified = true;const record = { checked, budget };p.writes.push(record);
    await click('syntax');assertSyntaxOnlyVector(initial, (await read()).vector, checked);assert.equal(await page.evaluate(syntaxOnProbe, 'begin-native-save', checked), true);const window = traffic.beginSave(checked);record.window = window.id;
    try { await click('save');await poll(read, (v) => v?.same && v.dialogs === 0, 'Original native Save finishes', 5000); }
    finally { record.events = await page.evaluate(syntaxOnProbe, 'events');traffic.endSave(record.events); }
    assertNativeSaveEvents(record.events, checked);await counts();
  };
  try {
    assert.equal(deps.freshAnonymousProfile, true);await settings.current(false);
    visit = await (deps.unitOnly?.prepareNative ?? prepareInitialNativeOnSource)(page, item, { ...deps, sourceQualifier });p.visit = visit;
    const setup = await page.evaluate(syntaxOnProbe, 'setup');assert.ok(setup?.same && setup.offPreserved);installed = true;p.setup = setup;
    const vector = await open();if (vector === null) { p.status = 'unavailable';p.reason = 'Unknown native Settings form is untouched';return p; }
    assertSyntaxOnlyVector(vector, vector, vector.find((f) => f.id === SYNTAX)?.checked);
    if (vector.find((f) => f.id === SYNTAX)?.checked !== false) { await close();p.status = 'unavailable';p.reason = 'Fresh native baseline is not Off. No toggle or Save performed';return p; }
    initial = vector;p.initialVector = initial;await save(true);const on = await open();assertSyntaxOnlyVector(initial, on, true);p.onReadiness = await page.evaluate(syntaxOnProbe, 'ready-frames');assert.equal(p.onReadiness?.frames, 2);
    p.nativeOnBeforeCancel = await page.evaluate(syntaxOnProbe, 'baseline-on');assert.ok(p.nativeOnBeforeCancel?.onBaseline && p.nativeOnBeforeCancel.onPreserved);assert.equal(p.nativeOnBeforeCancel.sourceRows, 55);assert.deepEqual(p.nativeOnBeforeCancel.events, []);assert.equal(p.nativeOnBeforeCancel.baselineEvidence.lineModel.valid, true);assert.deepEqual(p.nativeOnBeforeCancel.baselineEvidence.lineModel.groups.map((g) => g.length), [43, 12]);
    p.onCancel = await close();p.closedBeforeEnable = await current();assert.equal(p.closedBeforeEnable.dialogs, 0);assert.ok(p.closedBeforeEnable.onPreserved && p.closedBeforeEnable.foreignPreserved);await counts();p.zeroOwnedBeforeEnable = await page.evaluate(bitbucketShellProbe);assert.equal(p.zeroOwnedBeforeEnable.ownedCount, 0);p.ordering.preEnableNativeActionCount = p.actions.length;
    if (sourceQualifier) { await sourceQualifier.beforeEnable();await current('before-enable');sourceQualifier.assertEnableReserve(); }
    traffic.setPhase('firstuse_enable_master');await settings.enable();active = true;
    const joined = async () => ({ source: await page.evaluate(bitbucketShellProbe), native: await read(), state: await tabState(page) });
    const painted = await poll(joined, (v) => v.source?.ownedCount > 0 && v.native?.onPreserved && v.native.dialogs === 0 && v.state?.hasDiff === true, 'First enabled application paints original native On file', 30_000);
    const validate = async (v) => { p.lastPaintSample = v;await counts();assert.equal(v.native?.dialogs, 0);assert.equal(v.source.ownedCount, 47, 'Exact55-row native source must yield47 physical Text ranges');assert.equal(p.actions.length, p.ordering.preEnableNativeActionCount, 'No native Settings action while enabled');return (deps.unitOnly?.verifySource ?? verifyBitbucketShellSource)(v.source, visit.url, { origin: 'fresh-native-on-form-open', record: p.nativeOnBeforeCancel.baselineEvidence, currentNative: v.native, subject: visit.head, currentSubject: sourceHead() }); };
    p.painted = painted;p.paint = await validate(painted);p.ordering.firstUse = 'Native On was present before the sole master enable. No active Settings qualification was performed. Product source ordering, not a private getter, separates the local witness from global learning.';
    guardBudget();const target = await page.evaluate(bitbucketShellProbe, 'selection-target');assert.ok(target?.visible);assert.equal(target.text, 'if [');await page.mouse.move(target.x1, target.y);await page.mouse.down();await page.mouse.move(target.x2, target.y, { steps: 6 });await page.mouse.up();
    const selected = await poll(joined, (v) => v.source?.selection?.text === 'if [', 'Real first-use source text selection');await validate(selected);await pause(350);const stable = await joined();await validate(stable);assert.deepEqual(stable.source.selection, selected.source.selection);p.selection = { before: selected.source.selection, after: stable.source.selection };
    p.artifacts = await capture(page, 'bitbucket-initial-native-on', { fullPage: false });p.afterCapture = await joined();await validate(p.afterCapture);assert.deepEqual(p.afterCapture.source.selection, selected.source.selection);p.status = 'passed';
  } catch (error) { failure = error;p.status = 'failed';p.error = String(error); }
  finally {
    let cleanupFailure;
    try {
      traffic.setPhase('firstuse_disable_before_native_restore');await settings.disable();active = false;
      if (installed && initial !== undefined) {
        await poll(async () => ({ state: await tabState(page), source: await page.evaluate(bitbucketShellProbe) }), (v) => v.state?.allowed === false && v.state.hasDiff === false && v.source?.ownedCount === 0, 'Geld disabled before native Off restoration', 10_000);
        await current('before-native-restore');let state = await read();if (state.dialogs > 0) { assert.notEqual(p.readinessBlocked, true, 'Readiness-invalid form remains untouched');assert.equal(state.ready, true, 'Unknown replacement form must not be operated');await close(); }
        const vector = await open();assert.ok(vector, 'Native restoration form unknown');const checked = vector.find((f) => f.id === SYNTAX)?.checked;assertSyntaxOnlyVector(initial, vector, checked);if (checked) await save(false);else await close();
        const off = await open();assertSyntaxOnlyVector(initial, off, false);p.restoration.readback = off;assert.equal((await page.evaluate(syntaxOnProbe, 'finish-native-restore'))?.same, true);p.restoration.cancel = await close();await counts();p.restoration.source = await page.evaluate(bitbucketShellProbe);assert.equal(p.restoration.source.ownedCount, 0);p.restoration.status = 'restored';p.restoration.modificationAttempted = modified;p.restoration.scope = 'Native exact-Off restore while masteroff. This is not new Off-observer acceptance.';
      } else p.restoration = { status: 'not_modified', unknownFormUntouched: p.unknownForm !== undefined };
    } catch (error) { cleanupFailure = error;p.restoration.status = 'failed';p.restoration.error = String(error);p.status = 'failed'; }
    try { await poll(() => traffic.pending(), (v) => v === 0, 'Native Save-window traffic settled', 3000);assertInitialNativeOnTraffic(item.syntaxOnTraffic, item.shellNativeSources.mutations); }
    catch (error) { cleanupFailure ??= error;p.trafficError = String(error);p.status = 'failed'; }
    if (!page.isClosed()) for (const probe of [syntaxOnProbe, bitbucketShellProbe, bitbucketPipelineVisitProbe, nativeSettingsReadinessProbe, initialOnActorProbe]) try { await page.evaluate(probe, 'cleanup'); } catch (error) { cleanupFailure ??= error;p.cleanupError = String(error);p.status = 'failed'; }
    if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'First-use acceptance and cleanup both failed');if (cleanupFailure) throw cleanupFailure;
  }
  if (failure) throw failure;return p;
}
