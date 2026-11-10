import assert from 'node:assert/strict';
import { BITBUCKET_NATIVE_BASH, revealNativeBashTarget } from './bitbucket-native-bash.mjs';
import { nativeBashOnProbe } from './bitbucket-native-bash-on-probe.mjs';
import { nativeSettingsReadinessProbe } from './native-settings-readiness.mjs';

export function nativeSettingsDiagnosticPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  return { budgetAvailable: active + 10 + 4 < budget, active, remaining: budget - active, budget, measuredNavigation: 10, reserve: 5,
    basis: 'Actual same-fixture opener-only runs41405715365 and41412708229 each observed10 standard GETs. This is a historical forecast, not a future cost bound. Global40/429/abort guards remain authoritative; NativeOn full40/immediate-eight gates are unchanged.' };
}

export async function diagnoseNativeSettings(page, item, { settings, source, poll, pause, tabState, guardBudget, unitOnly }) {
  const p = { status: 'running', featureParity: 'not_evaluated', actionCapability: 'original_opener_only', actions: [], samples: [], sampleCount: 0, limits: { candidateMs: 4000, maxSamples: 40, retainedSamples: 8 }, limitations: ['Read-only strict-form rejection report, never NativeOn, palette, checkbox-state, preference persistence or provider feature acceptance.', 'No form binding, vector, field, Save, Cancel, Escape, HTML, AX or PNG capability.'] };item.nativeSettingsDiagnostic = p;
  let installed = false;const now = unitOnly?.now ?? Date.now;
  const inspect = () => page.evaluate(nativeBashOnProbe, 'diagnose-form');
  const current = async () => {
    assert.equal(page.isClosed(), false);await settings.current();await source.flush();assert.deepEqual(source.evidence.errors, []);assert.ok(source.evidence.metadata.length > 0);assert.equal(source.evidence.extensionFrameCount, 0);assert.deepEqual(source.evidence.mutations, []);const state = await tabState(page);assert.equal(state.allowed, false);assert.equal(state.hasDiff, false);
    const v = await inspect();assert.ok(v?.same && v.sameOwner && v.sameSemantic && v.stable, 'Immutable native source or actor lease changed');assert.equal(v.ownedHighlightCount, 0);assert.equal(v.ownedUiCount, 0);assert.equal(v.viewedAvailable, false);assert.equal(v.forbiddenEventCount, 0);return v;
  };
  try {
    await settings.current();await (unitOnly?.prepare ?? revealNativeBashTarget)(page, p, { poll, tabState });await source.flush();
    const setup = await poll(() => page.evaluate(nativeBashOnProbe, 'setup', null, BITBUCKET_NATIVE_BASH), (v) => v?.same, 'Exact immutable native Bash source for report-only Settings diagnosis', 10000);installed = true;
    p.setup = { same: setup.same, rows: setup.rows, counts: setup.counts, viewedAvailable: setup.viewed.available, ownedUi: setup.ownedUi, ownedHighlightCount: setup.ownedHighlights.length, samples: setup.samples };await current();
    const budget = guardBudget();const handle = await page.evaluateHandle(nativeBashOnProbe, 'opener');
    try {
      const opener = handle.asElement();assert.ok(opener, 'Unique original Settings opener unavailable');await opener.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));assert.equal(await page.evaluate(nativeBashOnProbe, 'arm-opener', opener), true);assert.equal(await page.evaluate(nativeBashOnProbe, 'hit', opener), true);assert.equal((await page.evaluate(nativeSettingsReadinessProbe, 'begin', 'standalone', opener))?.started, true);await current();const immediateBudget = guardBudget();await opener.click();const event = (await current()).openerEvent;assert.equal(event?.trusted, true);p.actions.push({ kind: 'opener', budget, immediateBudget, event });
    } finally { await handle.dispose(); }
    const deadline = now() + p.limits.candidateMs;let timer;const expired = new Error('Diagnostic observation deadline');
    const bounded = async (operation) => { const remaining = deadline - now();if (remaining <= 0) throw expired;try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(expired), remaining); })]); }finally { clearTimeout(timer); } };
    try {
      for (let i = 0; i < p.limits.maxSamples && now() < deadline; i++) {
        const v = await bounded(current);const owner = await bounded(() => page.evaluate(nativeSettingsReadinessProbe));const safeOwner = owner === null ? null : { same: owner.same, reason: owner.reason, clicked: owner.clicked, dialogs: owner.dialogs, candidatePinned: owner.candidatePinned, formPinned: owner.formPinned, presentation: owner.presentation, fieldCount: owner.diagnostics?.fieldCount ?? null, truncated: owner.diagnostics?.truncated === true };const sample = { sourceCurrent: v.same, owner: safeOwner, inspection: v.inspection };p.sampleCount++;p.samples.push(sample);if (p.samples.length > p.limits.retainedSamples) p.samples.shift();
        assert.equal(owner?.same, true, 'Original Settings candidate changed');assert.equal(owner.clicked, true);
        if (i + 1 < p.limits.maxSamples && now() < deadline) await bounded(() => pause(Math.min(100, Math.max(1, deadline - now()))));
      }
    } catch (error) { if (error !== expired) throw error;p.deadlineReached = true; }
    p.finalSource = await current();p.status = p.sampleCount > 0 ? 'diagnostic_complete' : 'unavailable';p.preferenceModification = 'No field, bind, Save or Cancel action was available or performed';
    return { status: p.status === 'diagnostic_complete' ? 'discovery' : 'unavailable', featureParity: 'not_evaluated', reason: 'Report-only native strict-form diagnosis. A collected rejection or recognized schema is not a NativeOn or palette pass.' };
  } catch (error) { p.status = 'failed';p.failure = 'native_source_or_diagnostic_guard_failed';throw new Error('Native report-only diagnostic source or observation guard failed');
  } finally {
    const errors = [];
    if (installed && !page.isClosed()) for (const probe of [nativeSettingsReadinessProbe, nativeBashOnProbe]) try { await page.evaluate(probe, 'cleanup'); } catch { errors.push('observation_cleanup_failed'); }
    p.cleanup = { status: errors.length === 0 ? 'removed' : 'failed', errors };if (errors.length > 0) { p.status = 'failed';throw new Error('Native report-only diagnostic cleanup failed'); }
  }
}
