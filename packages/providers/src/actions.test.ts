import { describe, expect, it } from 'vitest';
import { githubAccessAdapter } from './actions';

describe('outside collaborator protection', () => {
  it('never invites outsiders to an organisation through team membership', async () => {
    const requests: string[] = [];
    const adapter = githubAccessAdapter({
      source: {
        get: async () => ({
          status: 'ok',
          token: crypto.randomUUID(),
          refreshed: false,
        }),
      },
      fetch: async (url) => {
        requests.push(url);
        return new Response(null, { status: 404 });
      },
    });
    expect(await adapter.addOrganisationMemberToTeam('org', 'team', 'outsider')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(requests).toEqual(['https://api.github.com/orgs/org/members/outsider']);
  });
});

describe('provider confirmation', () => {
  it('does not report an HTTP 200 unmerged result as a successful merge', async () => {
    const { githubAction } = await import('./actions');
    expect(
      await githubAction(
        {
          request: async () => ({
            ok: true,
            value: { merged: false, message: 'Blocked' },
          }),
        },
        {
          provider: 'github',
          host: 'github.com',
          owner: 'org',
          repo: 'repo',
          number: 1,
        },
        { kind: 'merge', headSha: 'expected', method: 'squash' },
      ),
    ).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('Bitbucket archive support',()=>{
  it.each([true,false])('rejects archived=%s before making an unrelated settings write',async archived=>{
    const {providerAction}=await import('./actions');let requests=0;
    expect(await providerAction({provider:'bitbucket',source:{get:async()=>({status:'ok',token:'fixture',refreshed:false})},fetch:async()=>{requests+=1;return Response.json({});}},{provider:'bitbucket',host:'bitbucket.org',owner:'workspace',repo:'repo',number:1},{kind:'settings',archived,description:'Changed'})).toEqual({ok:false,reason:'unsupported'});
    expect(requests).toBe(0);
  });
});
