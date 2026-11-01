import { describe, expect, it } from 'vitest';
import { parseDashboardPathname, repositoryPath } from './routes';
describe('encoded dashboard pathnames', () => {
  it('decodes nested GitLab namespaces exactly once for queue filters', () => {
    const ref = { provider: 'gitlab', host: 'gitlab.com', owner: 'group/subgroup', repo: 'project' } satisfies Parameters<typeof repositoryPath>[0];
    expect(parseDashboardPathname(repositoryPath(ref))).toEqual({ kind: 'repository', ref, settings: false });
    expect(parseDashboardPathname('/gitlab/group%252Fsubgroup/project')).toMatchObject({ ref: { owner: 'group%2Fsubgroup' } });
    expect(parseDashboardPathname('/gitlab/bad%XX/project')).toBeNull();
  });
});
