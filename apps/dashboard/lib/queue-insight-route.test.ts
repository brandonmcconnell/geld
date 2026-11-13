import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient, PullDetail } from '@geld/domain';
import { DEFAULT_SETTINGS } from '@geld/core';
const fixture = vi.hoisted((): { signedIn: boolean; changed: boolean; reads: number } => ({
  signedIn: true,
  changed: false,
  reads: 0,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./db', () => ({ database: () => null }));
vi.mock('./session', () => ({
  currentActor: async () => (fixture.signedIn ? { id: 'u', name: 'Reviewer', email: 'reviewer@example.test' } : null),
}));
vi.mock('./review-settings', () => ({
  reviewSettings: async () => ({ settings: DEFAULT_SETTINGS, warning: null, aiAllowed: true }),
}));
vi.mock('./providers', () => ({ providerClient: async (): Promise<ProviderClient> => client }));
import { GET } from '../app/api/queue/insight/route';
const ref = {
  provider: 'github',
  host: 'github.com',
  owner: 'acme',
  repo: 'platform',
  number: 128,
} satisfies PullDetail['ref'];
const pull: PullDetail = {
  ref,
  id: '128',
  title: 'Change',
  author: 'morgan',
  authorAvatar: null,
  state: 'open',
  draft: false,
  updatedAt: '2026-11-01T00:00:00Z',
  url: 'https://github.com/acme/platform/pull/128',
  headSha: 'head',
  baseSha: 'base',
  additions: 2,
  deletions: 0,
  labels: [],
  reviewers: ['sam'],
  body: '',
  capabilities: ['read'],
};
const unsupported = async () =>
  ({ ok: false, reason: 'unsupported' }) satisfies Awaited<ReturnType<ProviderClient['pull']>>;
const client: ProviderClient = {
  provider: 'github',
  repositories: unsupported,
  pulls: unsupported,
  pull: async () => {
    fixture.reads++;
    return { ok: true, value: { ...pull, headSha: fixture.changed && fixture.reads > 1 ? 'new-head' : 'head' } };
  },
  diff: async () => ({
    ok: true,
    value:
      'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -0,0 +1 @@\n+export const ready = true;\ndiff --git a/src/main.test.ts b/src/main.test.ts\n--- a/src/main.test.ts\n+++ b/src/main.test.ts\n@@ -0,0 +1 @@\n+expect(ready).toBe(true);\n',
  }),
  reviewRequesters: async () => ({
    ok: true,
    value: [
      { reviewer: 'sam', requester: 'alex' },
      { reviewer: 'no-longer-requested', requester: 'morgan' },
    ],
  }),
  comments: unsupported,
  comment: unsupported,
  lineComment: unsupported,
  review: unsupported,
  threads: unsupported,
  reply: unsupported,
  resolve: unsupported,
  requestReviewers: unsupported,
};
const request = () =>
  new Request('https://app.geld.sh/api/queue/insight?' + new URLSearchParams({ ...ref, number: '128' }));
beforeEach(() => {
  fixture.signedIn = true;
  fixture.changed = false;
  fixture.reads = 0;
});
describe('queue change counts', () => {
  it('uses the actual matcher and current pending requests without sharing a public cache', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      headSha: 'head',
      essential: { files: 1, additions: 1, deletions: 0 },
      hidden: { files: 1, additions: 1, deletions: 0 },
      categories: [{ id: 'tests', label: 'Tests', files: 1 }],
      requesters: ['alex'],
    });
  });
  it('discards counts if a push races the diff, and never reads provider data for a signed-out actor', async () => {
    fixture.changed = true;
    expect((await GET(request())).status).toBe(409);
    fixture.signedIn = false;
    fixture.reads = 0;
    expect((await GET(request())).status).toBe(401);
    expect(fixture.reads).toBe(0);
  });
});
