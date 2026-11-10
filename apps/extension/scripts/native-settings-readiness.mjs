import assert from 'node:assert/strict';
import { nativeBashOnProbe } from './bitbucket-native-bash-on-probe.mjs';

/** Only observation references live here. Unknown DOM/values never leave this probe. */
export function nativeSettingsReadinessProbe(action = 'read', kind = null, opener = null, environment = {}) {
  const KEY = '__geldNativeSettingsReadiness';let store = globalThis[KEY];
  if (action === 'cleanup') { store?.cleanup();delete globalThis[KEY];return null; }
  const native = (n) => n?.isConnected === true && n.closest('[data-geld-ui],[data-testid="comment"],[data-qa="pr-activity"],[data-qa="pull-request-description"]') === null;
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(native);
  const presentation = (n) => {
    const v = { native: native(n), connected: n?.isConnected === true, blockedAncestor: n?.closest('[hidden],[inert],[aria-hidden="true"]') !== null, displayed: true, visible: true, contentVisible: true, opaque: true, ancestorCount: 0, scanComplete: true, width: null, height: null };
    for (let p = n; p; p = p.parentElement) { if (++v.ancestorCount > 200) { v.scanComplete = false;break; }const s = getComputedStyle(p);v.displayed &&= s.display !== 'none';v.visible &&= !['hidden', 'collapse'].includes(s.visibility);v.contentVisible &&= s.contentVisibility !== 'hidden';v.opaque &&= s.opacity !== '0'; }
    const r = n?.getBoundingClientRect();for (const key of ['width', 'height']) if (Number.isFinite(r?.[key]) && Math.abs(r[key]) <= 1_000_000) v[key] = r[key];
    return { ...v, eligible: v.native && v.connected && !v.blockedAncestor && v.displayed && v.visible && v.contentVisible && v.opaque && v.scanComplete && v.width > 0 && v.height > 0 };
  };
  if (action === 'begin') {
    if (store || !['standalone', 'pipeline'].includes(kind) || !native(opener)) return null;
    const existing = dialogs();const passive = kind === 'standalone' ? existing.filter((n) => n.getAttribute('aria-labelledby') === 'cookiesTrackingNoticeLink' && n.querySelector('input,select,textarea,form') === null && n.querySelector('a[id="cookiesTrackingNoticeLink"][href="https://www.atlassian.com/legal/cookies"]') !== null) : [];
    if (existing.length !== passive.length) return null;
    store = { url: location.href, opener, openerParent: opener.parentElement, passive: passive.map((node) => ({ node, parent: node.parentElement })), dialog: null, dialogParent: null, form: null, formParent: null, known: null, clicked: false, invalid: null, frame: null, timer: null };
    const listener = (event) => { if (event.target instanceof Element && opener.contains(event.target)) { const trusted = environment.unitOnly?.trusted(event) ?? event.isTrusted === true;store.clicked = trusted && native(opener) && opener.parentElement === store.openerParent && location.href === store.url;if (!store.clicked) store.invalid = 'untrusted_or_changed_opener'; } };
    document.addEventListener('click', listener, true);store.cleanup = () => { document.removeEventListener('click', listener, true);if (store.frame !== null) cancelAnimationFrame(store.frame);if (store.timer !== null) clearTimeout(store.timer);store.finishFrame?.({ expired: true }); };
    globalThis[KEY] = store;return { started: true };
  }
  if (!store) return null;
  const observe = () => {
    const fixed = native(store.opener) && store.opener.parentElement === store.openerParent && location.href === store.url && store.passive.every((p) => native(p.node) && p.node.parentElement === p.parent);
    if (!fixed) store.invalid ??= 'scope_or_opener_changed';
    const current = dialogs().filter((n) => !store.passive.some((p) => p.node === n));
    if (current.length > 1) store.invalid ??= 'ambiguous_candidate';
    if (store.dialog === null && current.length === 1 && store.clicked) { store.dialog = current[0];store.dialogParent = current[0].parentElement; }
    if (store.dialog !== null && (current.length !== 1 || current[0] !== store.dialog || store.dialog.parentElement !== store.dialogParent)) store.invalid ??= 'candidate_replaced';
    const dialog = store.dialog;const forms = dialog === null ? [] : [...dialog.querySelectorAll('form')];
    if (forms.length > 1) store.invalid ??= 'ambiguous_form';
    if (store.form === null && forms.length === 1) { store.form = forms[0];store.formParent = forms[0].parentElement; }
    if (store.form !== null && (forms.length !== 1 || forms[0] !== store.form || store.form.parentElement !== store.formParent)) store.invalid ??= 'form_replaced';
    const controls = store.form === null ? [] : [...store.form.querySelectorAll('input,select,textarea,button')];
    const vector = () => controls.map((n) => ({ node: n, parent: n.parentElement, id: n.id, name: n.name, type: n.type, value: n.value, checked: 'checked' in n ? n.checked : null, disabled: n.disabled, readOnly: 'readOnly' in n ? n.readOnly : false }));
    if (store.known !== null && (controls.length !== store.known.length || controls.some((n, i) => n !== store.known[i].node || n.parentElement !== store.known[i].parent || n.id !== store.known[i].id || n.name !== store.known[i].name || n.type !== store.known[i].type))) store.invalid ??= 'known_controls_or_vector_changed';
    const snapshot = (action === 'capture-known' || store.known !== null) && store.invalid === null ? vector() : [];const equal = (a, b) => a.length === b.length && a.every((r, i) => Object.keys(r).every((key) => r[key] === b[i][key]));
    if (store.known !== null && !equal(snapshot, store.known)) store.invalid ??= 'known_controls_or_vector_changed';
    const safe = (s) => /^[a-zA-Z0-9_-]{0,80}$/.test(s ?? '') ? s : '[omitted]';const seen = dialog === null ? [] : [...dialog.querySelectorAll('input,select,textarea')];
    return { state: { same: store.invalid === null, reason: store.invalid, clicked: store.clicked, dialogs: current.length, candidatePinned: dialog !== null, formPinned: store.form !== null, presentation: dialog === null ? null : presentation(dialog), diagnostics: { fieldCount: seen.length, fields: seen.slice(0, 40).map((n) => ({ name: safe(n.name), type: safe(n.type) })), truncated: seen.length > 40 } }, snapshot };
  };
  if (action === 'frame') return new Promise((resolve) => {
    let done = false;const finish = (v) => { if (done) return;done = true;store.frame = null;if (store.timer !== null) clearTimeout(store.timer);store.timer = null;store.finishFrame = null;resolve(v); };store.finishFrame = finish;
    store.timer = setTimeout(() => { if (store.frame !== null) cancelAnimationFrame(store.frame);finish({ expired: true }); }, 1000);
    store.frame = requestAnimationFrame(() => finish(observe().state));
  });
  const value = observe();
  if (action === 'capture-known') { if (!value.state.same || !value.state.clicked || !value.state.presentation?.eligible || !value.state.formPinned || value.snapshot.length === 0) return null;store.known = value.snapshot; }
  return value.state;
}

export async function waitNativeSettingsCandidate(page, { readCurrent, read, bind, pause, progress, timeoutMs = 4000, maxSamples = 40, tabWitness = null, unitOnly }) {
  assert.ok(tabWitness === null || tabWitness === 'bitbucket-native-tab');
  const now = unitOnly?.now ?? Date.now;const until = now() + timeoutMs;progress.status = 'waiting';progress.limits = { timeoutMs, maxCandidateSamples: maxSamples, retainedSamples: 8, stableFrames: 2 };progress.samples = [];progress.sampleCount = 0;
  const retain = (value) => { progress.sampleCount++;progress.samples.push(value);if (progress.samples.length > 8) progress.samples.shift(); };
  let timer;const deadline = new Error('Native Settings readiness deadline');
  const bounded = async (operation) => {
    const remaining = until - now();if (remaining <= 0) throw deadline;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(deadline), remaining); })]); }
    finally { clearTimeout(timer);timer = undefined; }
  };
  try {
    for (let i = 0; i < maxSamples && now() < until; i++) {
      await bounded(readCurrent);const source = await bounded(read);const sample = await bounded(() => page.evaluate(nativeSettingsReadinessProbe));retain({ ...sample, sourceCurrent: source?.same === true, formAvailable: source?.formAvailable === true, candidate: ['source-backed-standalone-13', 'source-backed-standalone-12-without-annotations'].includes(source?.candidate) ? source.candidate : null });
      if (['ambiguous_candidate', 'ambiguous_form'].includes(sample?.reason)) { progress.status = 'unavailable';progress.reason = sample.reason;return null; }
      assert.equal(sample?.same, true, `Native Settings candidate ownership invalid: ${sample?.reason ?? 'missing'}`);assert.equal(source?.same, true);assert.deepEqual(source.earlyEvents, [], 'Input preceded strict form qualification');
      if (source.formAvailable && sample.clicked && sample.presentation?.eligible && sample.formPinned) {
        assert.equal((await bounded(() => page.evaluate(nativeSettingsReadinessProbe, 'capture-known')))?.same, true);
        if (tabWitness === 'bitbucket-native-tab') assert.equal((await bounded(() => page.evaluate(nativeBashOnProbe, 'capture-tab-witness')))?.current, true, 'Source-qualified private tab witness required');
        for (let frame = 0; frame < 2; frame++) {
          const next = await bounded(() => page.evaluate(nativeSettingsReadinessProbe, 'frame'));retain(next);if (next?.expired) { progress.status = 'unavailable';progress.reason = 'frame_readiness_deadline';return null; }assert.ok(next?.same && next.presentation?.eligible, 'Original form/control/vector changed or presentation became ineligible during frame readiness');await bounded(readCurrent);const current = await bounded(read);assert.ok(current?.same && current.formAvailable);assert.deepEqual(current.earlyEvents, []);
        }
        const result = await bounded(bind);assert.ok(result, 'Original source-backed form binding failed');await bounded(readCurrent);const after = await bounded(() => page.evaluate(nativeSettingsReadinessProbe));retain(after);assert.ok(after?.same && after.presentation?.eligible, 'Original form changed or became ineligible during binding');const bound = await bounded(read);assert.ok(bound?.same && bound.ready);assert.deepEqual(bound.events, []);assert.deepEqual(bound.earlyEvents, []);progress.status = 'ready';return result;
      }
      if (i + 1 < maxSamples && now() < until) await bounded(() => pause(Math.min(100, Math.max(1, until - now()))));
    }
    progress.status = 'unavailable';progress.reason = progress.samples.at(-1)?.presentation?.eligible ? 'schema_unrecognized' : 'presentation_not_ready';return null;
  } catch (error) {
    if (error === deadline) { progress.status = 'unavailable';progress.reason = 'bounded_readiness_deadline';return null; }
    progress.status = 'failed';progress.error = String(error);throw error;
  } finally {
    clearTimeout(timer);
    const failures = [];
    try { if (!page.isClosed()) await page.evaluate(nativeSettingsReadinessProbe, 'cleanup');progress.cleanup = 'removed'; }
    catch (error) { progress.cleanup = 'failed';progress.cleanupError = String(error);progress.status = 'failed';failures.push(error); }
    if (tabWitness === 'bitbucket-native-tab' && progress.status !== 'ready') try { if (!page.isClosed()) await page.evaluate(nativeBashOnProbe, 'release-tab-witness');progress.tabWitnessCleanup = 'released'; }
    catch (error) { progress.tabWitnessCleanup = 'failed';progress.status = 'failed';failures.push(error); }
    if (failures.length > 0) throw tabWitness === 'bitbucket-native-tab' ? new Error('Native Settings tab-witness cleanup failed') : failures[0];
  }
}
