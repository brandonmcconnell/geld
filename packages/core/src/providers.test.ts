import { describeRepository, providerForHost, providerRepositoryScope, repositoryKey } from './providers';
import type { RepositoryIdentity } from './providers';
import { compileRepoRules, decideRepo, withRepoRule } from './repo-rules';
import { createMatcher } from './matcher';
import { DEFAULT_SETTINGS } from './settings';

describe('provider repository identity', () => {
  it('keeps nested GitLab namespaces and excludes review URL details', () => {
    expect(describeRepository('https://gitlab.com/Acme/platform/web/widgets/-/merge_requests/12/diffs?diff_id=10#note_5')).toEqual({
      provider: 'gitlab', origin: 'https://gitlab.com', path: 'Acme/platform/web/widgets',
    });
    expect(describeRepository('https://gitlab.com/acme/subgroup')).toBeNull();
    expect(describeRepository('https://gitlab.com/-/profile')).toBeNull();
  });

  it('recognizes Bitbucket repositories without treating workspace administration as a repository', () => {
    expect(describeRepository('https://bitbucket.org/acme/widgets/pull-requests/12/diff')).toEqual({
      provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets',
    });
    expect(describeRepository('https://bitbucket.org/acme/workspace/repositories')).toBeNull();
    expect(describeRepository('https://bitbucket.org/account/settings')).toBeNull();
  });

  it('preserves GitHub repository routing and requires explicit selection for enterprise hosts', () => {
    expect(describeRepository('https://github.com/acme/widgets/pull/12/files')?.path).toBe('acme/widgets');
    expect(describeRepository('https://github.com/settings/profile')).toBeNull();
    expect(describeRepository('https://ghe.example/acme/widgets/pull/12')).toBeNull();
    expect(describeRepository('https://ghe.example/acme/widgets/pull/12', 'github')?.origin).toBe('https://ghe.example');
    expect(describeRepository('https://gitlab.com/acme/widgets/-/merge_requests/12', 'github')).toBeNull();
  });

  it('does not let encoded separators, credential URLs or unknown origins impersonate repositories', () => {
    expect(describeRepository('https://gitlab.com/acme%2Fother/widgets/-/merge_requests/1')).toBeNull();
    expect(describeRepository('https://gitlab.com/acme/%zz/-/merge_requests/1')).toBeNull();
    expect(describeRepository('https://user:password@gitlab.com/acme/widgets/-/merge_requests/1')).toBeNull();
    expect(describeRepository('http://github.com/acme/widgets')).toBeNull();
    expect(describeRepository('https://github.com.evil.example/acme/widgets')).toBeNull();
    expect(providerForHost('GITLAB.COM')).toBe('gitlab');
  });

  it('keeps same-named repositories and self-hosted origins separate without delimiter collisions', () => {
    const path = 'acme/widgets';
    const keys = [
      repositoryKey({ provider: 'github', origin: 'https://github.com', path }),
      repositoryKey({ provider: 'gitlab', origin: 'https://gitlab.com', path }),
      repositoryKey({ provider: 'bitbucket', origin: 'https://bitbucket.org', path }),
      repositoryKey({ provider: 'gitlab', origin: 'https://gitlab.example:8443', path }),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(repositoryKey({ provider: 'gitlab', origin: 'https://GITLAB.COM:443', path })).toBe(keys[1]);
    expect(repositoryKey({ provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme:platform/widgets' }))
      .not.toBe(repositoryKey({ provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/platform:widgets' }));
  });
});

describe('provider-qualified rules and pattern scopes', () => {
  const github: RepositoryIdentity = { provider: 'github', origin: 'https://github.com', path: 'acme/widgets' };
  const gitlab: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/widgets' };
  const bitbucket: RepositoryIdentity = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' };

  it('preserves GitHub legacy scopes and qualifies other providers by host', () => {
    expect(providerRepositoryScope(github)).toBe('acme/widgets');
    expect(providerRepositoryScope(gitlab)).toBe('gitlab.com/acme/widgets');
    expect(providerRepositoryScope(bitbucket)).toBe('bitbucket.org/acme/widgets');
    expect(providerRepositoryScope({ ...gitlab, origin: 'https://GITLAB.EXAMPLE:8443' })).toBe('gitlab.example:8443/acme/widgets');
    const rules = compileRepoRules(['acme/widgets']);
    expect(decideRepo(rules, providerRepositoryScope(github)).allowed).toBe(false);
    expect(decideRepo(rules, providerRepositoryScope(gitlab)).allowed).toBe(true);
    expect(decideRepo(rules, providerRepositoryScope(bitbucket)).allowed).toBe(true);
  });

  it('keeps same-name hosted and self-hosted repositories independent', () => {
    const rules = compileRepoRules(['gitlab.com/acme/widgets']);
    expect(decideRepo(rules, providerRepositoryScope(gitlab)).allowed).toBe(false);
    expect(decideRepo(rules, providerRepositoryScope({ ...gitlab, origin: 'https://gitlab.example' })).allowed).toBe(true);
    expect(decideRepo(rules, providerRepositoryScope(bitbucket)).allowed).toBe(true);
    expect(decideRepo(rules, providerRepositoryScope(github)).allowed).toBe(true);
  });

  it('applies explicit nested-group rules and lets a repository opt back in', () => {
    const nested: RepositoryIdentity = { ...gitlab, path: 'acme/platform/web/widgets' };
    const off = withRepoRule([], 'gitlab.com/acme/platform/**', false);
    expect(decideRepo(compileRepoRules(off), providerRepositoryScope(nested)).allowed).toBe(false);
    expect(decideRepo(compileRepoRules(off), providerRepositoryScope({ ...gitlab, path: 'acme/backend/widgets' })).allowed).toBe(true);
    const on = withRepoRule(off, providerRepositoryScope(nested), true);
    expect(decideRepo(compileRepoRules(on), providerRepositoryScope(nested)).allowed).toBe(true);
    expect(withRepoRule(on, providerRepositoryScope(nested), false)).toEqual(off);
  });

  it('keeps the global off rule global across providers and supports an explicit namespace allowlist', () => {
    const disabled = compileRepoRules(['*']);
    for (const repository of [github, gitlab, bitbucket]) expect(decideRepo(disabled, providerRepositoryScope(repository)).allowed).toBe(false);
    const allowlist = compileRepoRules(['*', '!gitlab.com/acme/**']);
    expect(decideRepo(allowlist, providerRepositoryScope({ ...gitlab, path: 'acme/platform/widgets' })).allowed).toBe(true);
    expect(decideRepo(allowlist, providerRepositoryScope(github)).allowed).toBe(false);
    expect(decideRepo(allowlist, providerRepositoryScope(bitbucket)).allowed).toBe(false);
  });

  it('matches explicit provider and nested-group pattern headers without leaking a legacy GitHub header', () => {
    const settings = { ...DEFAULT_SETTINGS, categoryPatterns: { tests: [
      '[acme/widgets]', 'src/github-noise.ts',
      '[gitlab.com/acme/widgets]', 'src/gitlab-noise.ts',
      '[gitlab.com/acme/platform/**]', 'src/group-noise.ts',
      '[bitbucket.org/acme/*]', 'src/bitbucket-noise.ts',
      '[*]', 'src/global-noise.ts',
    ] } };
    const gh = createMatcher(settings, providerRepositoryScope(github));
    const gl = createMatcher(settings, providerRepositoryScope(gitlab));
    const bb = createMatcher(settings, providerRepositoryScope(bitbucket));
    expect(gh.categorize('src/github-noise.ts')?.id).toBe('tests');
    expect(gl.categorize('src/github-noise.ts')).toBeNull();
    expect(bb.categorize('src/github-noise.ts')).toBeNull();
    expect(gl.categorize('src/gitlab-noise.ts')?.id).toBe('tests');
    expect(bb.categorize('src/gitlab-noise.ts')).toBeNull();
    expect(bb.categorize('src/bitbucket-noise.ts')?.id).toBe('tests');
    expect(gl.categorize('src/bitbucket-noise.ts')).toBeNull();
    expect(createMatcher(settings, providerRepositoryScope({ ...gitlab, path: 'acme/platform/web/widgets' })).categorize('src/group-noise.ts')?.id).toBe('tests');
    for (const matcher of [gh, gl, bb]) expect(matcher.categorize('src/global-noise.ts')?.id).toBe('tests');
  });
});
