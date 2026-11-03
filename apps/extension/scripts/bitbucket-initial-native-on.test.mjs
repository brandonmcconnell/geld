import assert from 'node:assert/strict';
import { observeInitialOnSource } from './bitbucket-initial-on-source.mjs';
import { nativeSettingsReadinessProbe } from './native-settings-readiness.mjs';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { bitbucketPipelineConsentProbe } from './bitbucket-pipeline-consent.mjs';
import { bitbucketPipelineVisitProbe } from './bitbucket-pipeline-visit.mjs';
import { bitbucketSyntaxSettingsProbe } from './bitbucket-syntax-settings.mjs';
import { Window } from 'happy-dom';
import { assertInitialNativeOnState, assertInitialNativeOnTraffic, initialNativeOnFormShape, initialNativeOnPreflight, initialNativeOnSettings, prepareInitialNativeOnSource, verifyInitialNativeOn } from './bitbucket-initial-native-on.mjs';
import { bitbucketShellProbe, observeBitbucketShellFixture } from './bitbucket-shell-acceptance.mjs';
import { syntaxOnProbe, classifySyntaxOnLines } from './bitbucket-syntax-on-probe.mjs';

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff#chg-bitbucket-pipelines.yml';
const REPO = 'atlassian/bitbucket-upload-file';const HEAD = 'a'.repeat(40);const BASE = 'b'.repeat(40);const SYNTAX = 'diff-settings-syntax-highlighting-toggle';const TOTALS = { files: 5, additions: 46, deletions: 29 };
const retained = JSON.parse(readFileSync(new globalThis.URL('./fixtures/bitbucket-native-syntax-rows.json', import.meta.url), 'utf8'));
const harness = readFileSync(new globalThis.URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const clone = (v) => structuredClone(v);
function evidence() { return { errors: [], mutations: [], commits: [], partialMetadata: [], metadata: [{ id: '27', state: 'MERGED', sourceRepo: REPO, destinationRepo: REPO, head: HEAD, base: BASE }], pins: [{ sourceRepo: REPO, head: HEAD, base: BASE }] }; }
function tab(enabled) { return { allowed: enabled, hasDiff: enabled, onDiffPage: enabled, hiddenCount: 0, all: TOTALS, visible: TOTALS, repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: REPO } }; }
function scope(before, fail) {
  let value = clone(before);const progress = {};const writes = [];let call = 0;
  const settings = initialNativeOnSettings({ readSettings: async () => clone(value), writeSettings: async (v) => { writes.push(clone(v));if (++call === fail) throw new Error('Unit settings write rejected');value = clone(v); }, progress });
  return { settings, progress, writes, get: () => clone(value), set: (v) => { value = clone(v); } };
}
for (const active of [1, 16, 32, 33, 40]) test(`initial native On holds navigation with${active} active requests`, () => { assert.equal(initialNativeOnPreflight(active, 40).budgetAvailable, false); });
test('full40 admits only a budget boundary, never a cheaper navigation/Save forecast', () => { const p = initialNativeOnPreflight(0, 40);assert.equal(p.budgetAvailable, true);assert.equal(p.admissionRequirement.boundary, 'ROOT-MANUAL');assert.equal(p.admissionRequirement.verifiedByHarness, false);assert.match(p.admissionRequirement.requirement, /NativeOn210/);assert.equal(p.minimumFreeBeforeSave, 8);assert.match(p.basis, /unknown/);assert.equal(Object.hasOwn(p, 'measuredNavigation'), false);assert.throws(() => initialNativeOnPreflight(0, 41));assert.throws(() => initialNativeOnPreflight(-1, 40)); });
for (const before of [undefined, {}, { enabled: false, prOverview: true, extra: { value: 'preserve' } }, { enabled: true, quickReview: false }]) test(`raw settings presence/value and every unrelated field survive first-use enable/disable:${JSON.stringify(before)}`, async () => {
  const s = scope(before);await s.settings.prepare();const prepared = { ...before, enabled: false, prOverview: false, quickReview: false };assert.deepEqual(s.get(), prepared);await s.settings.current(false);await s.settings.enable();assert.deepEqual(s.get(), { ...prepared, enabled: true });await s.settings.current(true);await assert.rejects(s.settings.restore(false));await s.settings.disable();await s.settings.restore(true);assert.deepEqual(s.get(), before);assert.equal(s.progress.restoration.status, 'restored');assert.deepEqual(s.progress.transitions.map((v) => [v.enabled, v.status]), [[true, 'saved'], [false, 'saved']]);
});
test('a second enable is refused even after disable, so the case cannot become a warmed re-entry test', async () => { const s = scope({ enabled: true });await s.settings.prepare();await s.settings.enable();await s.settings.disable();await assert.rejects(s.settings.enable(), /Only one/); });
for (const phase of ['before-enable', 'while-enabled', 'before-restore']) test(`unrelated settings drift is not overwritten:${phase}`, async () => { const s = scope({ enabled: true, retained: 1 });await s.settings.prepare();if (phase !== 'before-enable') await s.settings.enable();if (phase === 'before-restore') await s.settings.disable();s.set({ ...s.get(), retained: 2 });const n = s.writes.length;if (phase === 'before-enable') await assert.rejects(s.settings.enable());else if (phase === 'while-enabled') await assert.rejects(s.settings.disable());else await assert.rejects(s.settings.restore(true));assert.equal(s.writes.length, n);assert.equal(s.get().retained, 2); });
test('failed enable is recorded and cleanup safely returns to disabled without hiding the original rejection', async () => { const s = scope({ enabled: true, retained: 1 }, 2);await s.settings.prepare();await assert.rejects(s.settings.enable(), /rejected/);assert.equal(s.progress.transitions[0].status, 'failed');await s.settings.disable();await s.settings.restore(true);assert.deepEqual(s.get(), { enabled: true, retained: 1 }); });
test('prepare rejection can restore the untouched original after the page was never created', async () => { const s = scope(undefined, 1);await assert.rejects(s.settings.prepare());await s.settings.restore(true);assert.equal(s.get(), undefined); });
test('final settings rejection persists failed cleanup rather than silently reporting restoration', async () => { const s = scope({ enabled: false }, 3);await s.settings.prepare();await s.settings.disable();await assert.rejects(s.settings.restore(true));assert.equal(s.progress.restoration.status, 'failed');assert.match(s.progress.restoration.error, /rejected/); });
test('native-only inactive counts and eventual active counts are different explicit contracts', () => { assertInitialNativeOnState(TOTALS, tab(false), false);assertInitialNativeOnState(TOTALS, tab(true), true);for (const [counts, state, mode] of [[{ ...TOTALS, files: 4 }, tab(false), false], [TOTALS, tab(true), false], [TOTALS, { ...tab(false), hasDiff: true }, false], [TOTALS, { ...tab(true), all: { ...TOTALS, additions: 45 } }, true], [TOTALS, { ...tab(true), repository: { ...tab(true).repository, path: 'other/repo' } }, true]]) assert.throws(() => assertInitialNativeOnState(counts, state, mode)); });
test('unknown-form diagnostics retain only bounded names/types, never values, labels or hidden credentials', () => {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });const prior = globalThis.document;
  try { globalThis.document = window.document;document.body.innerHTML = '<section role="dialog"><form><label>DO_NOT_RETAIN_AUTH<input name="csrf" type="hidden" value="DO_NOT_RETAIN_AUTH"></label><textarea name="draft">DO_NOT_RETAIN_AUTH</textarea></form></section>';const html = document.body.innerHTML;const result = initialNativeOnFormShape();assert.deepEqual(result, { dialogs: 1, fields: [{ name: 'csrf', type: 'hidden' }, { name: 'draft', type: 'textarea' }] });assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETAIN_AUTH/);assert.equal(document.body.innerHTML, html); }
  finally { if (prior === undefined) delete globalThis.document;else globalThis.document = prior;window.happyDOM.abort(); }
});

// Protocol stand-in for browser handles only; fake ranges below are never native or live acceptance.
function boundary(fault = {}) {
  const order = [];const item = { shellNativeSources: evidence(), syntaxOnTraffic: { records: [], windows: [], truncated: false } };let active = false;let on = false;let dialogs = 0;let events = [];let last = null;let selected = false;let enableAttempted = false;let closed = false;let baseline = false;let budgetCalls = 0;let saveClicks = 0;let nativeActions = 0;
  const vector = () => Array.from({ length: 13 }, (_, i) => ({ id: i === 2 ? SYNTAX : `field${i}`, type: i === 2 ? 'checkbox' : 'unit', checked: i === 2 ? on : false, value: 'unit' }));
  const native = () => ({ same: !fault.nativeDrift || !active, offPreserved: !on, onBaseline: baseline, onPreserved: !fault.remount || !active, foreignPreserved: !fault.foreign || !active, dialogs, formAvailable: dialogs === 1 && !fault.unknown, ready: dialogs === 1, vector: dialogs ? vector() : null, sourceRows: 55, events: clone(events), earlyEvents: [], baselineEvidence: { origin: 'fresh-native-on-form-open', originalLines: retained.original, renderedLines: retained.on, lineModel: classifySyntaxOnLines(retained.original, retained.on, 'on') } });
  const source = () => ({ ownedCount: active ? fault.rangeCount ?? 47 : 0, invalidRanges: [], selection: selected ? { text: 'if [', anchor: 1, focus: 2 } : null });
  const click = async (kind) => {
    assert.equal(active, false, 'Native control while active');nativeActions++;order.push(kind + (kind === 'save' ? ':' + on : ''));
    if (kind === 'opener') { dialogs = 1;events = []; }
    if (kind === 'syntax') { on = !on;events = ['click', 'input', 'change'].map((type) => ({ type, control: 'syntax', checked: on, trusted: true })); }
    if (kind === 'save') { saveClicks++;events.push({ type: 'click', control: 'save', trusted: true }, { type: 'submit', control: 'form', trusted: true, sameForm: true, sameSubmitter: true });dialogs = 0; }
    if (kind === 'cancel') { events.push({ type: 'click', control: 'cancel', trusted: true });dialogs = 0; }
    last = { trusted: true };
  };
  const page = { url: () => URL, isClosed: () => closed,
    evaluate: async (fn, action) => {
      if (action === 'cleanup') { order.push('cleanup');return null; }
      if (fn === nativeSettingsReadinessProbe) { if (action === 'begin') return { started: true };return { same: true, clicked: true, dialogs, formPinned: true, presentation: { eligible: true }, diagnostics: { fields: [] } }; }
      if (fn === initialNativeOnFormShape) return { dialogs, fields: [{ name: 'csrf', type: 'hidden' }] };
      if (fn === syntaxOnProbe) {
        if (action === 'event') return last;if (action === 'events') return clone(events);if (action === 'bind') return vector();if (action === 'ready-frames') return { frames: 2 };if (action === 'begin-native-save') return true;
        if (action === 'baseline-on') { baseline = true;return native(); }if (action === 'finish-native-restore') { assert.equal(on, false);return native(); }
        if (action?.startsWith('arm-') || action === 'hit') return true;return native();
      }
      if (fn === bitbucketShellProbe) { if (action === 'selection-target') return { visible: true, text: 'if [', x1: 1, x2: 10, y: 1 };return source(); }
      throw new Error('Unexpected test observation');
    },
    evaluateHandle: async (_fn, kind) => ({ asElement: () => ({ evaluate: async () => {}, click: () => click(kind) }), dispose: async () => {} }),
    mouse: { move: async () => {}, down: async () => {}, up: async () => { selected = true;order.push('selection'); } },
    close: async () => { closed = true;order.push('page-close'); },
  };
  const settings = { current: async (expected) => { assert.equal(active, expected); }, enable: async () => { assert.equal(dialogs, 0);assert.equal(active, false);assert.equal(enableAttempted, false);enableAttempted = true;order.push('enable');active = true; }, disable: async () => { order.push('disable');active = false;if (fault.disable) throw new Error('Unit disable failed'); } };
  const traffic = { setPhase: (phase) => order.push(phase), pending: () => 0, beginSave: (expected) => { const w = { id: item.syntaxOnTraffic.windows.length + 1, status: 'armed', expected };item.syntaxOnTraffic.windows.push(w);return w; }, endSave: (e) => { Object.assign(item.syntaxOnTraffic.windows.at(-1), { status: 'observed', events: e }); } };
  const deps = { settings, traffic, freshAnonymousProfile: true, poll: async (read, accepts) => { const v = await read();assert.ok(accepts(v), 'Unit poll refuses invalid source/state');return v; }, pause: async () => {}, tabState: async () => tab(active), bitbucketDom: async () => fault.counts && active ? { ...TOTALS, additions: 45 } : TOTALS,
    guardBudget: () => { budgetCalls++;return { observedWithinRollingHour: fault.lateBudget && events.length === 3 ? 33 : 0 }; },
    capture: async () => { assert.equal(dialogs, 0);assert.equal(active, true);order.push('capture');if (fault.capture) throw new Error('Unit capture failed');return { screenshot: 'unit' }; },
    unitOnly: { flush: async () => {}, prepareNative: async () => { assert.equal(active, false);order.push('native-preparation-disabled');return { url: URL, head: { sourceRepo: REPO, head: HEAD, base: BASE } }; }, verifySource: (_source, _url, baseline) => { assert.equal(baseline.currentNative.foreignPreserved, true);return { scope: 'unit protocol only' }; } },
  };
  return { page, item, deps, order, saveClicks: () => saveClicks, nativeActions: () => nativeActions, active: () => active, on: () => on, budgetCalls: () => budgetCalls };
}
test('actual orchestrator prepares nativeOn while disabled, enables once after closed pristine form, then disables before exactOff restoration', async () => {
  const b = boundary();const p = await verifyInitialNativeOn(b.page, b.item, b.deps);assert.equal(p.status, 'passed');assert.equal(p.restoration.status, 'restored');assert.equal(b.saveClicks(), 2);assert.equal(b.active(), false);assert.equal(b.on(), false);assert.ok(b.order.indexOf('save:true') < b.order.indexOf('enable'));assert.ok(b.order.indexOf('enable') < b.order.indexOf('selection'));assert.ok(b.order.indexOf('capture') < b.order.indexOf('disable'));assert.ok(b.order.indexOf('disable') < b.order.indexOf('save:false'));assert.equal(p.actions.every((v) => v.masterEnabled === false), true);assert.equal(p.ordering.privateCapabilityRead, false);assert.match(p.ordering.internalGlobalCapability, /Not read/);assert.equal(p.zeroOwnedBeforeEnable.ownedCount, 0);
});
test('unknown form causes no checkbox/Save/Cancel or enable, records safe diagnostics and remains unavailable', async () => { const b = boundary({ unknown: true });const p = await verifyInitialNativeOn(b.page, b.item, b.deps);assert.equal(p.status, 'unavailable');assert.deepEqual(b.order.filter((v) => ['opener', 'syntax', 'cancel', 'enable'].includes(v) || v.startsWith('save:')), ['opener']);assert.equal(b.saveClicks(), 0);assert.equal(p.restoration.unknownFormUntouched, true);assert.doesNotMatch(JSON.stringify(p), /DO_NOT_RETAIN_AUTH/); });
for (const fault of ['nativeDrift', 'remount', 'foreign', 'counts', 'capture', 'disable']) test(`actual orchestrator retains failure and cleanup evidence:${fault}`, async () => { const b = boundary({ [fault]: true });await assert.rejects(verifyInitialNativeOn(b.page, b.item, b.deps));assert.equal(b.item.initialNativeOn.status, 'failed');assert.equal(b.active(), false);if (fault !== 'disable') assert.equal(b.item.initialNativeOn.restoration.status, 'restored');else assert.equal(b.item.initialNativeOn.restoration.status, 'failed');if (fault !== 'disable') assert.ok(b.order.indexOf('disable') < b.order.indexOf('save:false')); });
test('unexpected physical range count fails rather than accepting any positive paint', async () => { const b = boundary({ rangeCount: 48 });await assert.rejects(verifyInitialNativeOn(b.page, b.item, b.deps), /47 physical/);assert.equal(b.item.initialNativeOn.lastPaintSample.source.ownedCount, 48);assert.equal(b.item.initialNativeOn.restoration.status, 'restored'); });
test('late traffic after checkbox work drops below8 and blocks actual Save with known-form cleanup', async () => { const b = boundary({ lateBudget: true });await assert.rejects(verifyInitialNativeOn(b.page, b.item, b.deps));assert.equal(b.saveClicks(), 0);assert.equal(b.item.initialNativeOn.writes[0].immediateBudget.observedWithinRollingHour, 33);assert.equal(b.active(), false);assert.ok(b.order.includes('cancel'));assert.equal(b.item.initialNativeOn.status, 'failed'); });

for (const failDisable of [false, true]) for (const assetCleanupFailure of [false,true]) test(`actual outer runner suppresses unknown-form auth/DOM/AX and preserves cleanup failure:${failDisable}, optional asset cleanup:${assetCleanupFailure}`, async () => {
  const b = boundary({ unknown: true, disable: failDisable });let stored = { enabled: true, quickReview: true, retained: 'preserve' };const original = clone(stored);let captures = 0;let auth = 0;let saves = 0;
  Object.assign(b.page, { mainFrame: () => null, setViewport: async () => {}, bringToFront: async () => {}, on: () => {}, once: () => {}, off: () => {}, goto: async () => { assert.equal(stored.enabled, false);b.order.push('navigate-disabled');return { status: () => 200 }; } });
  const report = { cases: [], infrastructureErrors: [], quotaPolicy: { conservativeObservedRequestBudget: 40 } };
  const body = harness.slice(harness.indexOf('async function runCase('), harness.indexOf('\nasync function crossSettingsDom('));
  const context = { assert, report, focus: 'bitbucket-pipeline-initial-on', FOCUSED_CASES: { 'bitbucket-pipeline-initial-on': ['bitbucket-pipeline-initial-on'] }, AbortController, structuredClone, providerOf: () => 'bitbucket', cooldowns: new Map(), SETTINGS_KEY: 'settings', currentCaseAbort: undefined, extensionId: 'unit', bitbucketRequestTimes: [], initialNativeOnPreflight, initialNativeOnSettings, initialOnSettingsScopes: new WeakMap(), syntaxOnObservers: new WeakMap(),
    options: { evaluate: async (...args) => { if (args.length === 3) { if (args[2]?.enabled === true) { assert.equal(b.page.isClosed(), true);b.order.push('restore-master'); }stored = clone(args[2]); }return clone(stored); } },
    browser: { newPage: async () => { assert.equal(stored.enabled, false);b.order.push('create-disabled');return b.page; } }, observeBitbucketBudget: () => {}, observeBitbucketPipelineMainAsset:(_page,p,opts)=>{assert.equal(opts.moduleOnly,true);assert.equal(b.order.includes('navigate-disabled'),false);b.order.push('module-observe');return{dispose:async()=>{b.order.push('module-dispose');if(assetCleanupFailure)throw Error('DO_NOT_RETAIN_AUTH');p.status='unavailable';}};}, createSyntaxOnRequestIdentity: () => () => 1, observeInitialOnSource,
    observeSyntaxOnTraffic: (_page, progress) => { Object.assign(progress, b.item.syntaxOnTraffic);return { ...b.deps.traffic, dispose: () => {} }; },
    observeBitbucketShellFixture: (_page, item) => { item.shellNativeSources = b.item.shellNativeSources; },
    assertInitialNativeOnTraffic, assertSyntaxOnTraffic: (traffic) => { assert.equal(traffic.truncated, false); }, authObservation: async () => { auth++;throw Error('Unexpected outer authentication serialization'); }, capture: async () => { captures++;throw Error('DO_NOT_RETAIN_AUTH'); }, safeUrl: (v) => v, errorText: String, closedTarget: () => false, console: { log: () => {} }, saveReport: async () => { saves++;assert.doesNotMatch(JSON.stringify(report), /DO_NOT_RETAIN_AUTH/); },
  };
  vm.createContext(context);new vm.Script(body + '\nglobalThis.invoke=runCase;').runInContext(context);
  await context.invoke('bitbucket-pipeline-initial-on', URL, async (page, item) => {
    const real = context.initialOnSettingsScopes.get(page);const settings = { current: async (v) => { await real.current(v);await b.deps.settings.current(v); }, enable: async () => { await real.enable();await b.deps.settings.enable(); }, disable: async () => { await real.disable();await b.deps.settings.disable(); } };
    const p = await verifyInitialNativeOn(page, item, { ...b.deps, settings });return { status: p.status === 'passed' ? 'passed' : 'unsupported' };
  });
  const item = report.cases[0];assert.equal(item.status, failDisable ? 'failed' : 'unsupported');assert.equal(item.initialNativeOn.restoration.status, failDisable ? 'failed' : 'not_modified');assert.equal(captures, 0);assert.equal(auth, 0);assert.ok(item.artifacts.suppressed);assert.equal(b.page.isClosed(), true);assert.deepEqual(stored, original);assert.equal(item.initialOnSettings.restoration.status, 'restored');assert.ok(b.order.indexOf('page-close') < b.order.indexOf('restore-master'));assert.equal(saves, 1);assert.equal(b.saveClicks(), 0);assert.ok(b.order.indexOf('module-observe')<b.order.indexOf('navigate-disabled'));assert.ok(b.order.indexOf('module-dispose')<b.order.indexOf('page-close'));if(assetCleanupFailure)assert.equal(item.nativeMainAsset.cleanup.error,'Optional native module observer cleanup unavailable');
});

test('final page-close failure never enables master on a still-open native page', async () => { const s = scope({ enabled: true });await s.settings.prepare();await assert.rejects(s.settings.restore(false), /Close native/);assert.equal(s.get().enabled, false);assert.equal(s.progress.restoration.status, 'failed'); });

test('source ordering keeps preference construction/read behind the disabled-controller return, without a runtime private getter', () => {
  const source = (path) => readFileSync(new globalThis.URL('../src/' + path, import.meta.url), 'utf8');
  const controller = source('providers/controller.ts');const apply = controller.slice(controller.indexOf('  private applyPage(): void {'));
  const disabled = apply.indexOf('if (!this.settings.enabled || !decision.allowed)');const readDiff = apply.indexOf('const view = page === null ? null : this.adapter.readDiff(document)');const applySyntax = apply.indexOf('else this.adapter.diffSyntax?.apply(view)');assert.ok(disabled >= 0 && readDiff > disabled && applySyntax > readDiff);assert.match(apply.slice(disabled, readDiff), /this\.restorePage\(\);[\s\S]*?return;/);assert.match(controller, /if \(!preserveDiffSyntax\) this\.adapter\.diffSyntax\?\.clear\(\)/);
  const runtime = source('providers/runtime.ts');assert.ok(runtime.indexOf('await Promise.all([settingsItem.getValue()') < runtime.indexOf('controller = new ProviderController('));
  const bridge = source('bitbucket/diff-syntax.ts');assert.ok(bridge.indexOf('new BitbucketNativeSyntaxPreference') > bridge.indexOf('    apply(view)'));assert.match(bridge, /const capability = preference\.read\(\)/);assert.match(bridge, /capability === 'unknown' && preference\.allowsInitialRenderedOn\(\)/);
  const preference = source('bitbucket/native-syntax-preference.ts');const read = preference.slice(preference.indexOf('  read(): BitbucketSyntaxCapability {'));assert.match(read, /initialRenderings\.set\(this\.doc/);assert.match(read, /new view\.MutationObserver/);assert.match(preference, /this\.observer\?\.disconnect\(\)/);
  const module = readFileSync(new globalThis.URL('./bitbucket-initial-native-on.mjs', import.meta.url), 'utf8');assert.doesNotMatch(module, /initialRenderings|allowsInitialRenderedOn\(|\.read\(\).*capability|createBitbucketDiffSyntax|applyBitbucketWorkflowSyntax/);
});

function nativePreparation(fault = {}) {
  const page = new EventEmitter();const item = { initialNativeOn: {} };observeBitbucketShellFixture(page, item, { safeUrl: (v) => v, extensionId: 'unit' });Object.assign(item.shellNativeSources, evidence());let selected = false;let expanded = false;let contextClicks = 0;let contextHandle = false;let activeRequests = 0;const guardReceipts = [];const actions = [];
  const rows = retained.original.map((r, rowId) => ({ ...r.semantic, old: r.semantic.numbers[0][0] === null ? null : Number(r.semantic.numbers[0][0]), next: r.semantic.numbers[0][1] === null ? null : Number(r.semantic.numbers[0][1]), rowId }));
  const prefix = (side) => { const a = rows.filter((r) => r[side] !== null);let i = 0;while (i < a.length && a[i][side] === i + 1) i++;return a.slice(0, i); };
  const baseline = { url: URL, heading: 'bitbucket-pipelines.yml', file: 'chg-bitbucket-pipelines.yml', rows, prefixOld: 18, prefixNext: 16, ownedCount: 0, invalidRanges: [], controls: [{ visible: true, previous: [18, 16], next: [29, 27] }] };
  const final = { ...baseline, oldSource: prefix('old'), newSource: prefix('next'), prefixOld: prefix('old').at(-1).old, prefixNext: prefix('next').at(-1).next, actualStep: true };
  const visit = () => ({ url: URL, selected, sameSource: true, pinned: selected ? URL : null, heading: 'bitbucket-pipelines.yml' });
  page.url = () => URL;page.isClosed = () => false;
  page.evaluate = async (fn, action) => {
    if (action === 'cleanup') return null;assert.notEqual(fn, syntaxOnProbe, 'Native preparation must not initialize a Settings preference probe');
    if (fn === bitbucketPipelineVisitProbe) { if (action === 'click-result') return { trusted: !fault.untrustedLink, sameLink: true, sameParent: true, href: '#chg-bitbucket-pipelines.yml' };return visit(); }
    if (fn === bitbucketPipelineConsentProbe) return { status: 'not_present', url: URL };
    if (fn === bitbucketSyntaxSettingsProbe) return { url: URL, sameSource: true, sourceRows: 44, viewed: [false], events: [] };
    assert.equal(fn, bitbucketShellProbe);if (action === 'scroll') return { matches: 1 };if (action === 'arm') return { matches: 1 };if (action === 'click-result') return { trusted: !fault.untrustedContext, url: URL, qa: 'pr-diff-show-more-lines-below', aria: 'Show more lines below', previous: [18, 16], next: [29, 27] };
    const value = clone(expanded ? final : baseline);if (fault.empty) value.rows = [];if (fault.source && expanded) value.newSource[0].text = 'invalid: [';if (fault.owned) value.ownedCount = 1;return value;
  };
  page.evaluateHandle = async (fn) => { if (fn === bitbucketShellProbe) contextHandle = true;return { asElement: () => ({ click: async () => { if (fn === bitbucketPipelineVisitProbe) { selected = true;actions.push('native-file-link'); }else { contextClicks++;actions.push('native-context');if (!fault.noProgress) expanded = true;if (fault.head) item.shellNativeSources.pins.push({ sourceRepo: REPO, head: 'c'.repeat(40), base: BASE }); } } }), dispose: async () => {} }; };
  const deps = { freshAnonymousProfile: true, settings: { current: async (active) => { assert.equal(active, false);if (fault.lateBudget && contextHandle) activeRequests = 36; } }, poll: async (read, accept) => { const v = await read();assert.ok(accept(v), 'Native-only preparation poll failed');return v; }, guardBudget: () => { guardReceipts.push(activeRequests);assert.ok(activeRequests + 4 < 40, 'Current generic minimum-five request reserve exhausted');return { observedWithinRollingHour: activeRequests }; }, tabState: async () => tab(fault.active ?? false), bitbucketDom: async () => fault.counts ? { ...TOTALS, files: 4 } : TOTALS };
  return { page, item, deps, actions, guardReceipts, clicks: () => contextClicks };
}
test('native-only preparation reuses real context/source validators with retained55-row code, never initializing product or active Settings proof', async () => {
  const b = nativePreparation();try { const visit = await prepareInitialNativeOnSource(b.page, b.item, b.deps);assert.equal(visit.url, URL);assert.equal(visit.head.head, HEAD);assert.equal(b.item.initialNativeOn.preparation.status, 'prepared');assert.equal(b.item.initialNativeOn.preparation.expanded.rows.length, 55);assert.deepEqual(b.actions, ['native-file-link', 'native-context']);assert.equal(b.clicks(), 1); }finally { b.page.emit('close'); }
});
for (const fault of ['empty', 'source', 'owned', 'head', 'active', 'counts', 'noProgress', 'untrustedLink', 'untrustedContext']) test(`native-only preparation refuses${fault} instead of skipping its oracle`, async () => { const b = nativePreparation({ [fault]: true });try { await assert.rejects(prepareInitialNativeOnSource(b.page, b.item, b.deps));assert.equal(b.actions.some((v) => v.includes('Settings')), false);assert.ok(b.clicks() <= 2); }finally { b.page.emit('close'); } });

test('nonstandard extension-generated writes fail regardless of URL or native Save-window timing', () => {
  const p = { records: [{ kind: 'request', id: 1, method: 'POST', url: 'https://bitbucket.org/source-observed/settings', extensionInitiator: true, window: null }], windows: [], truncated: false };
  assert.throws(() => assertInitialNativeOnTraffic(p, []), /extension must not issue/);p.records[0].extensionInitiator = false;assertInitialNativeOnTraffic(p, []);assert.equal(p.writeSummary.outsideSaveWindows.length, 1);assert.match(p.writeSummary.outsideSaveWindows[0].classification, /Unattributed/);
});

test('native context input rechecks the generic minimum-five reserve after awaited current-source work', async () => {
  const b = nativePreparation({ lateBudget: true });try { await assert.rejects(prepareInitialNativeOnSource(b.page, b.item, b.deps), /minimum-five/);assert.equal(b.clicks(), 0);assert.equal(b.guardReceipts.at(-1), 36);assert.deepEqual(b.actions, ['native-file-link']); }finally { b.page.emit('close'); }
});
test('unknown native field names cannot carry arbitrary text into the report', () => {
  const window = new Window();const original = globalThis.document;
  try { globalThis.document = window.document;const dialog = document.createElement('section');dialog.setAttribute('role', 'dialog');const input = document.createElement('input');input.name = 'DO NOT RETAIN arbitrary secret text';input.type = 'hidden';input.value = 'secretValue';dialog.append(input);document.body.append(dialog);const result = initialNativeOnFormShape();assert.deepEqual(result.fields, [{ name: '[omitted]', type: 'hidden' }]);assert.doesNotMatch(JSON.stringify(result), /DO NOT RETAIN|secretValue/); }
  finally { if (original === undefined) delete globalThis.document;else globalThis.document = original;window.happyDOM.abort(); }
});

for (const fail of [false, true]) test(`actual first-use orchestrator requires the explicit closed-form tuple recheck/reserve before its sole enable:${fail}`, async () => {
  const b = boundary();let rechecked = false;
  b.deps.unitOnly.sourceQualifier = { current: () => ({ sourceRepo: REPO, head: HEAD, base: BASE }), beforeEnable: async () => { assert.equal(b.active(), false);assert.equal(b.on(), true);assert.equal(b.order.at(-1), 'cancel');b.order.push('explicit-current-tuple-recheck');if (fail) throw Error('API comparison changed before enable');rechecked = true; }, assertEnableReserve: () => { assert.equal(rechecked, true);assert.equal(b.active(), false);b.order.push('explicit-enable-reserve'); } };
  if (fail) { await assert.rejects(verifyInitialNativeOn(b.page, b.item, b.deps), /API comparison changed/);assert.equal(b.order.includes('enable'), false);assert.equal(b.item.initialNativeOn.restoration.status, 'restored');assert.equal(b.on(), false); }
  else { await verifyInitialNativeOn(b.page, b.item, b.deps);assert.deepEqual(b.order.slice(b.order.indexOf('explicit-enable-reserve'), b.order.indexOf('enable') + 1), ['explicit-enable-reserve', 'firstuse_enable_master', 'enable']);assert.equal(b.item.initialNativeOn.status, 'passed'); }
});
