import { describe, expect, it } from 'vitest';
import { githubAccessAdapter } from './actions';

describe('outside collaborator protection', () => {
  it('never invites outsiders to an organisation through team membership', async () => {
    const requests: string[] = [];
    const adapter = githubAccessAdapter({ source: { get: async () => ({ status: 'ok', token: crypto.randomUUID(), refreshed: false }) }, fetch: async (url) => { requests.push(url); return new Response(null, { status: 404 }); } });
    expect(await adapter.addOrganisationMemberToTeam('org', 'team', 'outsider')).toEqual({ ok: false, reason: 'not_found' });
    expect(requests).toEqual(['https://api.github.com/orgs/org/members/outsider']);
  });
});
