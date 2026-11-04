import { describe, expect, it } from 'vitest';
import { parseUnifiedDiffHunks } from '@geld/core';
import { normalizeReviewPlan, reconcileProgress, seedReview } from './plan';
import type { PlannerOutput, StepProgress } from './plan';
import { planReview } from './planner';

const context = { headSha: 'before-head', model: 'fixture', madeAt: '2026-11-01T00:00:00Z' };
const header = 'diff --git a/work.ts b/work.ts\n--- a/work.ts\n+++ b/work.ts\n';
const unchanged = '@@ -10 +10 @@\n-old-work\n+stable-work\n';
const step = (hunk: number): PlannerOutput => ({ steps: [{ title: 'Stable work', kind: 'fix', story: 'Review this work.', why: '', touches: [{ path: 'work.ts', hunk }], supporting: [], dependsOn: [], watch: [] }] });
const metadata = 'diff --git a/banner.png b/banner.png\nindex 1111111..2222222 100644\nBinary files a/banner.png and b/banner.png differ\ndiff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\ndiff --git a/tool.sh b/tool.sh\nold mode 100644\nnew mode 100755\n';

describe('review plan identity and file coverage', () => {
  it('keeps an accepted note on unchanged work after a new earlier hunk is inserted', () => {
    const before = parseUnifiedDiffHunks(header + unchanged).map(file => ({ ...file, hidden: false }));
    const after = parseUnifiedDiffHunks(header + '@@ -1 +1 @@\n-first\n+new-first\n' + unchanged).map(file => ({ ...file, hidden: false }));
    const oldPlan = normalizeReviewPlan(step(0), before, context);
    const nextPlan = normalizeReviewPlan(step(1), after, { ...context, headSha: 'next-head' });
    const previous = oldPlan.steps[0];
    const next = nextPlan.steps.find(step => step.title === 'Stable work');
    if (!previous || !next) throw new Error('Missing planned work');
    expect(next.id).toBe(previous.id);
    expect(next.fingerprint).toBe(previous.fingerprint);
    expect(next.touches).toEqual([{ path: 'work.ts', hunk: 1 }]);
    const progress: Record<string, StepProgress> = { [previous.id]: { state: 'accepted', note: 'Verified this behavior', fingerprint: previous.fingerprint, at: context.madeAt } };
    expect(reconcileProgress(nextPlan, progress)[next.id]).toEqual(progress[previous.id]);
  });
  it('includes binary, rename-only and mode-only changes once and reopens them after a push', () => {
    const files = parseUnifiedDiffHunks(header + unchanged + metadata).map(file => ({ ...file, hidden: file.path === 'tool.sh' }));
    const plan = normalizeReviewPlan(step(0), files, context);
    const refs = plan.steps.flatMap(step => [...step.touches, ...step.supporting]);
    expect(refs.filter(ref => ref.hunk === -1).map(ref => ref.path).sort()).toEqual(['banner.png', 'new.txt', 'tool.sh']);
    expect(refs).toHaveLength(4);
    expect(new Set(refs.map(ref => JSON.stringify(ref))).size).toBe(4);
    const next = normalizeReviewPlan(step(0), files, { ...context, headSha: 'next-head' });
    const previous = plan.steps.find(step => step.touches.some(ref => ref.hunk === -1));
    const updated = next.steps.find(step => step.id === previous?.id);
    if (!previous || !updated) throw new Error('Missing file metadata review');
    expect(updated.fingerprint).not.toBe(previous.fingerprint);
    expect(seedReview(files).flatMap(step => [...step.touches, ...step.supporting])).toHaveLength(4);
  });
  it('uses the AI planner for a pull request containing only non-text changes', async () => {
    const files = parseUnifiedDiffHunks(metadata).map(file => ({ ...file, hidden: false }));
    let calls = 0;
    const output: PlannerOutput = { steps: [{ title: 'Review assets and metadata', kind: 'chore', story: 'Inspect the binary asset, rename and executable mode.', why: '', touches: files.map(file => ({ path: file.path, hunk: -1 })), supporting: [], dependsOn: [], watch: [] }] };
    const result = await planReview({ files, title: 'Metadata update', body: '', headSha: context.headSha, gateway: { apiKey: crypto.randomUUID(), baseUrl: 'https://gateway.example', model: 'fixture', fetch: async () => Response.json({}) }, complete: async options => {
      calls += 1;
      expect(options.messages.some(message => message.content.includes('fileReviewIndex'))).toBe(true);
      return { ok: true, text: JSON.stringify(output), model: 'fixture' };
    } });
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.steps.flatMap(step => step.touches)).toHaveLength(3);
  });
});
