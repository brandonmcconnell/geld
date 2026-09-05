import { compileRepoRules, decideRepo, repoFromPathname } from './repo-rules';

const allowed = (rules: readonly string[], repo: string): boolean => decideRepo(compileRepoRules(rules), repo).allowed;

describe('repo rules', () => {
  it('runs everywhere with no rules', () => {
    expect(allowed([], 'acme/widgets')).toBe(true);
  });

  it('turns off for listed repositories and whole owners', () => {
    expect(allowed(['acme/legacy'], 'acme/legacy')).toBe(false);
    expect(allowed(['acme/legacy'], 'acme/widgets')).toBe(true);
    expect(allowed(['acme'], 'acme/anything')).toBe(false);
    expect(allowed(['acme/*'], 'acme/anything')).toBe(false);
    expect(allowed(['acme'], 'other/anything')).toBe(true);
  });

  it('lets a later negation re-enable a repository (last match wins)', () => {
    const rules = ['acme/*', '!acme/example'];
    expect(allowed(rules, 'acme/widgets')).toBe(false);
    expect(allowed(rules, 'acme/example')).toBe(true);
    // Order matters: the exclusion after the rescue wins again.
    expect(allowed(['!acme/example', 'acme/*'], 'acme/example')).toBe(false);
  });

  it('supports an allowlist via * plus negations', () => {
    const rules = ['*', '!acme/*', '!me/dotfiles', 'acme/example'];
    expect(allowed(rules, 'random/repo')).toBe(false);
    expect(allowed(rules, 'acme/widgets')).toBe(true);
    expect(allowed(rules, 'me/dotfiles')).toBe(true);
    expect(allowed(rules, 'acme/example')).toBe(false);
  });

  it('is case-insensitive and ignores comments/blank lines', () => {
    expect(allowed(['ACME/Widgets', '', '# note'], 'acme/widgets')).toBe(false);
    expect(decideRepo(compileRepoRules(['acme']), 'acme/x').rule?.raw).toBe('acme');
  });

  it('extracts owner/repo from GitHub paths and ignores reserved routes', () => {
    expect(repoFromPathname('/acme/widgets/pull/12/files')).toBe('acme/widgets');
    expect(repoFromPathname('/acme/widgets')).toBe('acme/widgets');
    expect(repoFromPathname('/pulls')).toBeNull();
    expect(repoFromPathname('/settings/profile')).toBeNull();
    expect(repoFromPathname('/orgs/acme/repositories')).toBeNull();
  });
});
