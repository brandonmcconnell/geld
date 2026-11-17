import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: vi.fn(async () => []), setValue: vi.fn(async () => undefined) }) } }));

import { diagnosticSubject, tabSubject } from './diagnostics';

describe('tabSubject', () => {
  it('names repositories and pull requests, never people or paths', () => {
    expect(tabSubject('https://github.com/wxt-dev/wxt/pull/2544')).toBe('github.com/wxt-dev/wxt#2544');
    expect(tabSubject('https://github.com/wxt-dev/wxt/pull/2544/files?w=1#diff-abc')).toBe('github.com/wxt-dev/wxt#2544/files');
    expect(tabSubject('https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef')).toBe('github.com/wxt-dev/wxt@d05ac55');
    expect(tabSubject('https://github.com/wxt-dev/wxt/pulls?q=is%3Aopen')).toBe('github.com/wxt-dev/wxt (pulls)');
    expect(tabSubject('https://github.com/wxt-dev/wxt/compare/main...feat')).toBe('github.com/wxt-dev/wxt (compare)');
    // A profile, an organisation, a search, a settings page: nothing of the path is kept.
    expect(tabSubject('https://ghe.example.com/acme/widgets/pull/77/files')).toBe('ghe.example.com/acme/widgets#77/files');
    expect(tabSubject('https://ghe.example.com/acme/widgets/commit/0a1b2c3d4e')).toBe('ghe.example.com/acme/widgets@0a1b2c3');
    expect(tabSubject('https://github.com/someone')).toBe('other page');
    expect(tabSubject('https://github.com/orgs/acme/people')).toBe('other page');
    expect(tabSubject('https://github.com/search?q=secret+project')).toBe('other page');
    expect(tabSubject('https://github.com/wxt-dev/wxt/issues/12')).toBe('other page');
    expect(tabSubject('not a url')).toBe('other page');
  });

  it('names full provider repositories without copying query or profile paths', () => {
    expect(tabSubject('https://gitlab.com/acme/platform/widgets/-/merge_requests/12/diffs?token=secret#note_4')).toBe('gitlab.com/acme/platform/widgets!12/diffs');
    expect(tabSubject('https://gitlab.com/acme/platform/widgets/-/merge_requests?search=secret')).toBe('gitlab.com/acme/platform/widgets (merge requests)');
    expect(tabSubject('https://bitbucket.org/acme/widgets/pull-requests/12/diff?token=secret')).toBe('bitbucket.org/acme/widgets#12/diff');
    expect(tabSubject('https://bitbucket.org/acme/widgets/pull-requests/')).toBe('bitbucket.org/acme/widgets (pull requests)');
    expect(tabSubject('https://gitlab.com/acme/subgroup')).toBe('other page');
    expect(tabSubject('https://gitlab.com/-/profile')).toBe('other page');
    expect(tabSubject('https://bitbucket.org/acme/workspace/members')).toBe('other page');
    expect(tabSubject('https://bitbucket.org/account/settings')).toBe('other page');
  });

  it('separates provider diff identities and omits arbitrary API requests', () => {
    expect(diagnosticSubject('https://gitlab.com/acme/group/widgets/-/merge_requests/12.diff?private=secret')).toBe('gitlab.com/acme/group/widgets!12');
    expect(diagnosticSubject('https://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests/12/diff?token=secret')).toBe('bitbucket.org/acme/widgets#12');
    expect(diagnosticSubject('https://api.bitbucket.org/2.0/user')).toBeNull();
    expect(diagnosticSubject('https://gitlab.com/-/profile')).toBeNull();
  });
});
