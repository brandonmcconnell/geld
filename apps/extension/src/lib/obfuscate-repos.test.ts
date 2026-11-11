import { describe, expect, it } from 'vitest';
import { obfuscateAddress, obfuscateRepos, providerLabel, providerOf } from './obfuscate-repos';

describe('obfuscateRepos', () => {
  const REPORT = [
    'Geld 0.1.3 diagnostics — 4 events (this browser session)',
    '17:01:02.003 fetch github.com/acme/secret#12 rate-limited status=429 from=github.com',
    '17:01:03.004 fetch ghe.acme.internal/acme/secret@0a1b2c3 ok 80ms from=ghe.acme.internal',
    '17:01:04.005 inject github.com/acme/secret#12/files present on=activated',
    '17:01:05.006 fetch github.com/wxt-dev/wxt#2544 ok 120ms from=patch-diff.githubusercontent.com',
    'github.com/acme/other (pulls): up 3s',
    '  pass: 1 runs (45.2/min, 1 in the last minute), mean 32.7ms',
  ].join('\n');

  it('puts every organization, repository and item in placeholders, keeping the host', () => {
    const out = obfuscateRepos(REPORT, null);
    expect(out).not.toMatch(/acme\/|secret|wxt/);
    expect(out).toContain('fetch github.com/[org]/[repo]#[pr] rate-limited status=429 from=github.com');
    expect(out).toContain('fetch ghe.acme.internal/[org]/[repo]@[commit] ok 80ms from=ghe.acme.internal');
    expect(out).toContain('inject github.com/[org]/[repo]#[pr]/files present');
    expect(out).toContain('github.com/[org]/[repo] (pulls): up 3s');
    expect(out).toContain('(45.2/min, 1 in the last minute)');
  });

  it('names the page whose address goes into the issue, and no other', () => {
    const out = obfuscateRepos(REPORT, { repo: 'wxt-dev/wxt', host: 'github.com' });
    expect(out).toContain('fetch github.com/wxt-dev/wxt#2544 ok 120ms');
    expect(out).toContain('fetch github.com/[org]/[repo]#[pr] rate-limited');
    expect(out).not.toContain('acme/');
  });

  it('never names the same owner/repo on another host', () => {
    const report = 'fetch github.com/acme/widgets#3 ok\ninject ghe.example.com/acme/widgets#77 present';
    expect(obfuscateRepos(report, { repo: 'acme/widgets', host: 'github.com' })).toBe('fetch github.com/acme/widgets#3 ok\ninject ghe.example.com/[org]/[repo]#[pr] present');
    expect(obfuscateRepos(report, { repo: 'acme/widgets', host: 'ghe.example.com' })).toBe('fetch github.com/[org]/[repo]#[pr] ok\ninject ghe.example.com/acme/widgets#77 present');
  });

  it('reads references written without a host as github.com\'s', () => {
    expect(obfuscateRepos('fetch acme/secret#1 ok', null)).toBe('fetch [org]/[repo]#[pr] ok');
    expect(obfuscateRepos('fetch acme/secret#1 ok', { repo: 'acme/secret', host: 'github.com' })).toBe('fetch acme/secret#1 ok');
    expect(obfuscateRepos('key:acme/secret#1', null)).toBe('key:[org]/[repo]#[pr]');
  });

  it('obfuscates addresses on every provider, ports, credentials and closing punctuation included', () => {
    expect(obfuscateRepos('see https://github.com/acme/secret/pull/12/files?w=1 and https://github.com/acme/secret.', null)).toBe(
      'see https://github.com/[org]/[repo]/pull/[pr]/files and https://github.com/[org]/[repo].',
    );
    expect(obfuscateRepos('(https://ghe.example.com:8443/acme/secret/issues/4)', null)).toBe('(https://ghe.example.com:8443/[org]/[repo]/issues/[issue])');
    expect(obfuscateRepos('https://user:token@ghe.example.com/acme/secret', null)).toBe('https://ghe.example.com/[org]/[repo]');
    expect(obfuscateRepos('https://ghe.example.com:8443/acme/secret/pull/12', { repo: 'acme/secret', host: 'ghe.example.com' })).toBe(
      'https://ghe.example.com:8443/acme/secret/pull/12',
    );
  });
});

describe('obfuscateAddress', () => {
  it('follows GitHub\'s structure', () => {
    expect(obfuscateAddress('github.com', '/acme/secret/pull/12')).toBe('github.com/[org]/[repo]/pull/[pr]');
    expect(obfuscateAddress('github.com', '/acme/secret/discussions/9')).toBe('github.com/[org]/[repo]/discussions/[discussion]');
    expect(obfuscateAddress('github.com', '/acme/secret/commit/0a1b2c3')).toBe('github.com/[org]/[repo]/commit/[commit]');
    expect(obfuscateAddress('github.com', '/acme/secret/blob/main/src/a.ts')).toBe('github.com/[org]/[repo]/blob/[ref]/[path]');
    expect(obfuscateAddress('github.com', '/acme/secret/pulls')).toBe('github.com/[org]/[repo]/pulls');
    expect(obfuscateAddress('github.com', '/acme')).toBe('github.com/[org]');
    expect(obfuscateAddress('github.com', '/orgs/acme/people')).toBe('github.com/orgs/[path]');
  });

  it('follows GitLab\'s, subgroups and all', () => {
    expect(obfuscateAddress('gitlab.com', '/acme/platform/secret/-/merge_requests/12')).toBe('gitlab.com/[group]/[group]/[project]/-/merge_requests/[mr]');
    expect(obfuscateAddress('gitlab.com', '/acme/secret/-/issues/3')).toBe('gitlab.com/[group]/[project]/-/issues/[issue]');
    expect(obfuscateAddress('gitlab.com', '/acme/secret')).toBe('gitlab.com/[group]/[project]');
    expect(obfuscateAddress('git.example.com', '/acme/secret/-/commit/0a1b2c3')).toBe('git.example.com/[group]/[project]/-/commit/[commit]');
  });

  it('follows Bitbucket Cloud\'s and Bitbucket Server\'s', () => {
    expect(obfuscateAddress('bitbucket.org', '/acme/secret/pull-requests/12')).toBe('bitbucket.org/[workspace]/[repo]/pull-requests/[pr]');
    expect(obfuscateAddress('bitbucket.org', '/acme/secret/issues/3')).toBe('bitbucket.org/[workspace]/[repo]/issues/[issue]');
    expect(obfuscateAddress('bb.example.com', '/projects/ACME/repos/secret/pull-requests/12/overview')).toBe('bb.example.com/projects/[project]/repos/[repo]/pull-requests/[pr]/overview');
  });

  it('follows Azure DevOps\'s, on dev.azure.com, visualstudio.com and its own server', () => {
    expect(obfuscateAddress('dev.azure.com', '/acme/Platform/_git/secret/pullrequest/12')).toBe('dev.azure.com/[org]/[project]/_git/[repo]/pullrequest/[pr]');
    expect(obfuscateAddress('dev.azure.com', '/acme/Platform/_workitems/edit/345')).toBe('dev.azure.com/[org]/[project]/_workitems/edit/[work-item]');
    expect(obfuscateAddress('acme.visualstudio.com', '/Platform/_git/secret/pullrequest/12')).toBe('[org].visualstudio.com/[project]/_git/[repo]/pullrequest/[pr]');
    expect(obfuscateAddress('tfs.example.com', '/tfs/Collection/Platform/_git/secret')).toBe('tfs.example.com/[org]/[org]/[project]/_git/[repo]');
  });
});

describe('providerOf and providerLabel', () => {
  it('knows the provider by host, else by the shape of the path', () => {
    expect(providerOf('github.com', '/a/b')).toBe('github');
    expect(providerOf('gitlab.com', '/a/b')).toBe('gitlab');
    expect(providerOf('git.example.com', '/a/b/-/issues/1')).toBe('gitlab');
    expect(providerOf('bitbucket.org', '/a/b')).toBe('bitbucket');
    expect(providerOf('bb.example.com', '/projects/A/repos/b')).toBe('bitbucket');
    expect(providerOf('dev.azure.com', '/a/b')).toBe('azure-devops');
    expect(providerOf('acme.visualstudio.com', '/b')).toBe('azure-devops');
    expect(providerOf('ghe.example.com', '/a/b/pull/1')).toBe('github');
  });

  it('names the provider with its host', () => {
    expect(providerLabel(new URL('https://github.com/wxt-dev/wxt/pull/1'))).toBe('GitHub (github.com)');
    expect(providerLabel(new URL('https://ghe.example.com/acme/x'))).toBe('GitHub Enterprise (ghe.example.com)');
    expect(providerLabel(new URL('https://gitlab.com/acme/x'))).toBe('GitLab (gitlab.com)');
  });
});
