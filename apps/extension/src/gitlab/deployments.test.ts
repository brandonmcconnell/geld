import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGitLabEnvironments } from './deployments';

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8'));

describe('GitLab merge request environments', () => {
  it('reads a deployed review app with its site and environment page (docs-gitlab-com!2850, Nov 2026)', () => {
    expect(parseGitLabEnvironments(fixture('ci-environments-success.json'), 'https://gitlab.com')).toEqual([{
      id: '42855745',
      name: 'review/mr-2850',
      state: 'active',
      environmentUrl: 'https://gitlab.com/gitlab-org/technical-writing/docs-gitlab-com/-/environments/42855745',
      siteUrl: 'https://docs-review-mr-2850.gitlab-marketing.workers.dev/',
      deployedAt: '2026-11-10T17:58:31.506Z',
    }]);
  });

  it('reads a deployment waiting on a manual job, with no site yet (www-gitlab-com!144613)', () => {
    expect(parseGitLabEnvironments(fixture('ci-environments-blocked.json'), 'https://gitlab.com')).toMatchObject([{ name: 'review/mr-144613', state: 'waiting' }]);
    expect(parseGitLabEnvironments(fixture('ci-environments-blocked.json'), 'https://gitlab.com')?.[0]).not.toHaveProperty('siteUrl');
  });

  it('drops entries it cannot trust and refuses a payload that is not a list', () => {
    expect(parseGitLabEnvironments([
      { id: 1, name: 'off-host', status: 'success', url: 'https://evil.example/-/environments/1' },
      { id: 2, name: 'plain-http', status: 'success', url: '/g/p/-/environments/2', external_url: 'http://site.example' },
      { id: 3, name: '', status: 'success', url: '/g/p/-/environments/3' },
      { id: 4, name: 'odd', status: 'constructor', url: '/g/p/-/environments/4' },
    ], 'https://gitlab.com')).toEqual([
      { id: '2', name: 'plain-http', state: 'active', environmentUrl: 'https://gitlab.com/g/p/-/environments/2' },
      { id: '4', name: 'odd', state: 'unknown', environmentUrl: 'https://gitlab.com/g/p/-/environments/4' },
    ]);
    expect(parseGitLabEnvironments({ message: '404 Not Found' }, 'https://gitlab.com')).toBeNull();
  });
});
