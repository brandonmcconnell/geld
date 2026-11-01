import { describe, expect, it } from 'vitest';
import { parseUnifiedDiffHunks } from '@geld/core';
import { normalizeReviewPlan, reconcileProgress } from './plan';
import type { PlannerOutput, StepProgress } from './plan';
import { planReview } from './planner';
const files = parseUnifiedDiffHunks('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before\n+after\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-before\n+after\ndiff --git a/a.test.ts b/a.test.ts\n--- a/a.test.ts\n+++ b/a.test.ts\n@@ -1 +1 @@\n-before\n+after\n').map((file) => ({ ...file, hidden: file.path.endsWith('.test.ts') }));
const output: PlannerOutput = { steps: [{ title: 'Preserve review progress', kind: 'fix', story: 'Keep accepted work when its content stays the same.', why: 'A push should only reopen changed work.', touches: [{ path: 'a.ts', hunk: 0 }, { path: 'a.test.ts', hunk: 0 }, { path: 'invented.ts', hunk: 0 }], supporting: [], dependsOn: [], watch: [] }, { title: 'Duplicate reference', kind: 'other', story: '', why: '', touches: [{ path: 'a.ts', hunk: 0 }], supporting: [], dependsOn: [0], watch: [] }] };
const context = { headSha: 'head', model: 'test-language-model', madeAt: '2026-11-01T00:00:00Z' };
describe('AI plan invariants', () => {
  it('drops duplicate and invented hunks, attaches hidden hunks and recovers omissions', () => {
    const plan = normalizeReviewPlan(output, files, context);
    expect(plan.steps[0]?.touches).toEqual([{ path: 'a.ts', hunk: 0 }]);
    expect(plan.steps[0]?.supporting).toEqual([{ path: 'a.test.ts', hunk: 0 }]);
    expect(plan.steps[1]?.touches).toEqual([{ path: 'b.ts', hunk: 0 }]);
    const refs = plan.steps.flatMap((step) => [...step.touches, ...step.supporting]);
    expect(refs).toHaveLength(3);
    expect(new Set(refs.map((ref) => JSON.stringify(ref))).size).toBe(3);
  });
  it('keeps progress across new heads and marks changed hunks for another look', () => {
    const plan = normalizeReviewPlan(output, files, context);
    const step = plan.steps[0];
    if (!step) throw new Error('Missing step');
    const progress: Readonly<Record<string, StepProgress>> = { [step.id]: { state: 'accepted', fingerprint: step.fingerprint, at: context.madeAt, note: '' } };
    expect(reconcileProgress({ ...plan, headSha: 'next-head' }, { ...progress, [step.id]: { state: 'accepted', fingerprint: step.fingerprint, at: context.madeAt, note: '' } })[step.id]?.state).toBe('accepted');
    expect(reconcileProgress({ ...plan, steps: [{ ...step, fingerprint: 'changed' }] }, { [step.id]: { state: 'accepted', fingerprint: step.fingerprint, at: context.madeAt, note: '' } })[step.id]?.state).toBe('changed');
  });
  it('requires AI configuration and validates model output', async () => {
    let calls = 0;
    const options = { files, title: 'Review', body: '', headSha: 'head', gateway: { apiKey: crypto.randomUUID(), baseUrl: 'https://gateway.example', model: 'test-language-model', fetch: async () => Response.json({}) } };
    const result = await planReview({ ...options, complete: async () => { calls += 1; return { ok: true, text: JSON.stringify(output), model: 'test-language-model' }; } });
    expect(result.ok).toBe(true);
    expect(await planReview({ ...options, gateway: { ...options.gateway, apiKey: '' }, complete: async () => ({ ok: false, reason: 'should not run' }) })).toMatchObject({ ok: false });
    expect(calls).toBe(1);
    expect(await planReview({ ...options, complete: async () => ({ ok: true, text: '{"steps": []}', model: 'test-language-model' }) })).toMatchObject({ ok: false });
  });
});
