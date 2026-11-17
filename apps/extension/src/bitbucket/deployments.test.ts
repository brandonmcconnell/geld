import { describe, expect, it } from 'vitest';
import { parseBitbucketDeployments } from './deployments';

const head = 'a'.repeat(40);
const deployment = (uuid: string, environment: string, commit: string, state: unknown): unknown => ({ uuid, environment: { uuid: environment }, release: { commit: { hash: commit }, created_on: '2026-11-01T00:00:00Z' }, state });
const environments = { values: [{ uuid: '{staging}', name: 'Staging' }, { uuid: '{prod}', name: 'Production' }] };

describe('parseBitbucketDeployments', () => {
  it('keeps the head commit’s latest deployment per environment, in Bitbucket’s states', () => {
    const deployments = {
      values: [
        deployment('{1}', '{staging}', head, { name: 'COMPLETED', status: { name: 'FAILED' }, completion_date: '2026-11-02T00:00:00Z' }),
        deployment('{2}', '{staging}', head, { name: 'COMPLETED', status: { name: 'SUCCESSFUL' }, completion_date: '2026-11-03T00:00:00Z', url: 'https://bitbucket.org/acme/app/pipelines/results/9' }),
        deployment('{3}', '{prod}', head, { name: 'IN_PROGRESS', start_date: '2026-11-03T01:00:00Z' }),
        deployment('{4}', '{prod}', 'b'.repeat(40), { name: 'COMPLETED', status: { name: 'SUCCESSFUL' }, completion_date: '2026-11-04T00:00:00Z' }),
      ],
    };
    expect(parseBitbucketDeployments(deployments, environments, head, 'acme/app')).toEqual([
      { id: '{2}', name: 'Staging', state: 'active', environmentUrl: 'https://bitbucket.org/acme/app/pipelines/results/9', deployedAt: '2026-11-03T00:00:00Z' },
      { id: '{3}', name: 'Production', state: 'deploying', environmentUrl: 'https://bitbucket.org/acme/app/deployments', deployedAt: '2026-11-03T01:00:00Z' },
    ]);
  });

  it('never links off Bitbucket and reads an unexpected answer as none', () => {
    const deployments = { values: [deployment('{1}', '{staging}', head, { name: 'COMPLETED', status: { name: 'STOPPED' }, url: 'https://evil.example/x' })] };
    expect(parseBitbucketDeployments(deployments, environments, head, 'acme/app')).toEqual([
      { id: '{1}', name: 'Staging', state: 'failed', environmentUrl: 'https://bitbucket.org/acme/app/deployments', deployedAt: '2026-11-01T00:00:00Z' },
    ]);
    expect(parseBitbucketDeployments({ error: {} }, environments, head, 'acme/app')).toBeNull();
  });
});
