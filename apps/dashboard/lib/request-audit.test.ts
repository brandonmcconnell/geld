import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./session', () => ({ currentActor: async () => null }));
import { requestAuditResource } from './request-audit';
describe('structural security receipt minimisation', () => {
  it('hashes repository identities and excludes content, query tokens and provider keys while leaving the request readable', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'synthetic-audit-key-at-least-32-characters');
    const request = new Request('https://dashboard.example/api/guides?token=private-query-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref: {
          provider: 'github',
          host: 'github.com',
          owner: 'private-owner',
          repo: 'private-repo',
          number: 1,
        },
        teamId: 'team',
        body: 'private source content',
        key: 'private-provider-key',
      }),
    });
    const record = await requestAuditResource(request, 'guides.post');
    expect(record.type).toBe('pull_request');
    expect(record.id).toMatch(/^[a-f0-9]{64}$/);
    expect(record.team).toBe('team');
    expect(JSON.stringify(record)).not.toMatch(/private-/);
    expect(await request.json()).toHaveProperty('body', 'private source content');
    vi.unstubAllEnvs();
  });
});
