import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: vi.fn(async () => []), setValue: vi.fn(async () => undefined) }) } }));

import { tabSubject } from './diagnostics';

describe('tabSubject', () => {
  it('names repositories and pull requests, never people or paths', () => {
    expect(tabSubject('https://github.com/wxt-dev/wxt/pull/2544')).toBe('wxt-dev/wxt#2544');
    expect(tabSubject('https://github.com/wxt-dev/wxt/pull/2544/files?w=1#diff-abc')).toBe('wxt-dev/wxt#2544/files');
    expect(tabSubject('https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef')).toBe('wxt-dev/wxt@d05ac55');
    expect(tabSubject('https://github.com/wxt-dev/wxt/pulls?q=is%3Aopen')).toBe('wxt-dev/wxt (pulls)');
    expect(tabSubject('https://github.com/wxt-dev/wxt/compare/main...feat')).toBe('wxt-dev/wxt (compare)');
    // A profile, an organisation, a search, a settings page: nothing of the path is kept.
    expect(tabSubject('https://github.com/someone')).toBe('other page');
    expect(tabSubject('https://github.com/orgs/acme/people')).toBe('other page');
    expect(tabSubject('https://github.com/search?q=secret+project')).toBe('other page');
    expect(tabSubject('https://github.com/wxt-dev/wxt/issues/12')).toBe('other page');
    expect(tabSubject('not a url')).toBe('other page');
  });
});
