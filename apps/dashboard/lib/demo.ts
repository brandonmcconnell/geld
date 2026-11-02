import type { ProviderClient, PullDetail, PullRef, RepositoryRef, RepositorySummary } from '@geld/domain';
import { pullPath } from '@geld/domain';

export const DEMO_REPOSITORIES: readonly RepositorySummary[] = [
  { id: 'demo-1', ref: { provider: 'github', host: 'github.com', owner: 'acme', repo: 'platform' }, private: false, permission: 'write', url: 'https://github.com/acme/platform' },
  { id: 'demo-2', ref: { provider: 'gitlab', host: 'gitlab.com', owner: 'acme', repo: 'api' }, private: false, permission: 'write', url: 'https://gitlab.com/acme/api' },
  { id: 'demo-3', ref: { provider: 'bitbucket', host: 'bitbucket.org', owner: 'acme', repo: 'tooling' }, private: false, permission: 'read', url: 'https://bitbucket.org/acme/tooling' },
];
const changes = [
  { number: 128, title: 'Keep review progress when a pull request changes', author: 'morgan', repo: 0, labels: ['review', 'improvement'], additions: 84, deletions: 21 },
  { number: 127, title: 'Handle expired provider sessions before retrying', author: 'sam', repo: 0, labels: ['fix'], additions: 42, deletions: 18 },
  { number: 124, title: 'Make repository search work with pasted URLs', author: 'alex', repo: 0, labels: ['navigation'], additions: 108, deletions: 36 },
  { number: 42, title: 'Return consistent pagination across endpoints', author: 'jamie', repo: 1, labels: ['api'], additions: 67, deletions: 24 },
  { number: 18, title: 'Reduce duplicate background jobs', author: 'lee', repo: 2, labels: ['performance'], additions: 34, deletions: 12 },
];
export const DEMO_PULLS: readonly PullDetail[] = changes.flatMap((change, index) => {
  const repo = DEMO_REPOSITORIES[change.repo];
  if (!repo) return [];
  const ref: PullRef = { ...repo.ref, number: change.number };
  return [{ ref, id: `demo-pull-${change.number}`, title: change.title, body: 'Keep the review focused on what changed. Preserve progress for unchanged steps and ask for another look when their hunks change.', author: change.author, authorAvatar: null, state: 'open', draft: index === 2, updatedAt: `2026-11-01T${String(12 - index).padStart(2, '0')}:00:00Z`, url: pullPath(ref), headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), additions: change.additions, deletions: change.deletions, labels: change.labels, reviewers: ['demo-reviewer'], capabilities: ['read', 'comment', 'review'] }];
});
export const DEMO_DIFF = `diff --git a/src/review/progress.ts b/src/review/progress.ts
index 1234567..2345678 100644
--- a/src/review/progress.ts
+++ b/src/review/progress.ts
@@ -1,4 +1,7 @@
 export function restoreProgress(previous, next) {
-  return next.steps.map(step => ({ ...step, state: 'pending' }));
+  return next.steps.map(step => {
+    const saved = previous.steps.find(item => item.id === step.id);
+    const unchanged = saved?.fingerprint === step.fingerprint;
+    return { ...step, state: unchanged ? saved.state : 'pending' };
+  });
 }
\x20
 diff --git a/src/review/progress.test.ts b/src/review/progress.test.ts
new file mode 100644
--- /dev/null
+++ b/src/review/progress.test.ts
@@ -0,0 +1,3 @@
+it('keeps accepted steps when their hunks are unchanged', () => {
+  expect(restoreProgress(previous, next)[0].state).toBe('accepted');
+});
`.replace('\n diff --git', '\ndiff --git');
export function demoClient(provider: ProviderClient['provider']): ProviderClient {
  const denied = (): Promise<{ readonly ok: false; readonly reason: 'unsupported' }> => Promise.resolve({ ok: false, reason: 'unsupported' });
  return {
    provider,
    repositories: async () => ({ ok: true, value: { items: DEMO_REPOSITORIES.filter((repo) => repo.ref.provider === provider), cursor: null, total: null, capped: false } }),
    pulls: async (repo: RepositoryRef) => ({ ok: true, value: { items: DEMO_PULLS.filter((pull) => pull.ref.provider === repo.provider && pull.ref.owner === repo.owner && pull.ref.repo === repo.repo), cursor: null, total: null, capped: false } }),
    pull: async (ref) => { const pull = DEMO_PULLS.find((p) => p.ref.provider === ref.provider && p.ref.owner === ref.owner && p.ref.repo === ref.repo && p.ref.number === ref.number); return pull ? { ok: true, value: pull } : { ok: false, reason: 'not_found' }; },
    diff: async () => ({ ok: true, value: DEMO_DIFF }),
    comments: async () => ({ ok: true, value: [] }),
    comment: denied, lineComment: denied, review: denied, requestReviewers: denied,
    threads: async () => ({ ok: true, value: [] }), reply: denied, resolve: denied,
  };
}
