import { describe, expect, it } from 'vitest';
import { providerLabel, providerOf } from './git-provider';

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
