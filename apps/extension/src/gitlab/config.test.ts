import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => { let value: unknown = {}; return { get: () => value, set: (next: unknown) => { value = next; }, reset: () => { value = {}; } }; });
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => stored.get(), setValue: async (value: unknown) => stored.set(value) }) } }));

import { fetchGitLabConfig } from './config';
import type { ProviderReviewPage } from '../providers/types';
const REF = 'a'.repeat(40);
const HEAD = 'f'.repeat(40);
const ROOT = 'https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fwidgets';
const PAGE: ProviderReviewPage = {
  provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/platform/widgets' }, number: '12',
  url: 'https://gitlab.com/acme/platform/widgets/-/merge_requests/12', diffPageUrl: 'https://gitlab.com/acme/platform/widgets/-/merge_requests/12/diffs', diffUrl: 'https://gitlab.com/acme/platform/widgets/-/merge_requests/12.diff', kind: 'diff', headSha: HEAD, version: '12',
};
function json(value: unknown, headers: Record<string, string> = {}): Response { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } }); }
function routes(override?: (url: URL) => Response | null): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const custom = override?.(url);
    if (custom !== undefined && custom !== null) return custom;
    if (url.href === ROOT) return json({ path_with_namespace: PAGE.repository.path, default_branch: 'release/main' });
    if (url.href === `${ROOT}/repository/branches/release%2Fmain`) return json({ name: 'release/main', commit: { id: REF } });
    if (url.pathname.endsWith('/repository/tree')) return json(url.searchParams.get('path') === '.github'
      ? [{ type: 'blob', path: '.github/geld.yml' }]
      : [{ type: 'tree', path: '.github' }, { type: 'blob', path: '.gitattributes' }, { type: 'commit', path: 'submodule' }], { 'x-next-page': '' });
    if (url.pathname.endsWith('/repository/files/.github%2Fgeld.yml/raw')) return new Response('categories:\n  tests: false', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.endsWith('/repository/files/.gitattributes/raw')) return new Response('generated/** linguist-generated');
    throw new Error(`Unexpected config request ${url.pathname}`);
  });
}
beforeEach(() => stored.reset());

describe('GitLab trusted repository configuration', () => {
  it('reads target default-branch files at an immutable SHA, encoding the complete nested project and branch path', async () => {
    const fetcher = routes();
    const result = await fetchGitLabConfig(PAGE, new AbortController().signal, fetcher);
    expect(result.ref).toBe(REF);
    expect(result.files.map((file) => file.path)).toEqual(['.github/geld.yml', '.gitattributes']);
    expect(result.files[0]?.text).toContain('tests: false');
    const requests = fetcher.mock.calls.map(([input]) => new URL(String(input)));
    expect(requests.every((url) => url.href.startsWith(ROOT))).toBe(true);
    expect(requests.some((url) => url.href.includes('/repository/branches/release%2Fmain'))).toBe(true);
    expect(requests.filter((url) => url.pathname.includes('/repository/tree') || url.pathname.includes('/repository/files/')).every((url) => url.searchParams.get('ref') === REF)).toBe(true);
    expect(requests.every((url) => !url.href.includes(HEAD) && !url.href.includes('merge_requests'))).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'same-origin' && init.redirect === 'error')).toBe(true);
    expect(result.files[0]?.url).toContain(`/-/blob/${REF}/.github/geld.yml`);
  });

  it('uses existence listings instead of routine missing-file requests', async () => {
    const fetcher = routes((url) => url.pathname.endsWith('/repository/tree') ? json([], { 'x-next-page': '' }) : null);
    const result = await fetchGitLabConfig(PAGE, new AbortController().signal, fetcher);
    expect(result.files.every((file) => file.text === null)).toBe(true);
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(fetcher.mock.calls.every(([input]) => !String(input).includes('/repository/files/'))).toBe(true);
  });

  it('finishes root pagination before concluding a config directory is missing', async () => {
    const fetcher = routes((url) => {
      if (!url.pathname.endsWith('/repository/tree') || url.searchParams.has('path')) return null;
      return url.searchParams.get('page') === '1'
        ? json([{ type: 'blob', path: 'README.md' }], { 'x-next-page': '2', 'x-total': '2' })
        : json([{ type: 'tree', path: '.github' }], { 'x-next-page': '', 'x-total': '2' });
    });
    const result = await fetchGitLabConfig(PAGE, new AbortController().signal, fetcher);
    expect(result.files[0]?.text).toContain('tests: false');
    expect(result.files[1]?.text).toBeNull();
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).searchParams.get('page') === '2')).toBe(true);
  });

  it('rejects incomplete listings instead of caching their absent paths', async () => {
    const fetcher = routes((url) => url.pathname.endsWith('/repository/tree') ? json([], { 'x-next-page': '', 'x-total': '2' }) : null);
    await expect(fetchGitLabConfig(PAGE, new AbortController().signal, fetcher)).rejects.toThrow('incomplete');
    const retry = routes();
    expect((await fetchGitLabConfig(PAGE, new AbortController().signal, retry)).files[0]?.text).toContain('tests: false');
  });

  it('does not cache sign-in HTML as a missing policy', async () => {
    const denied = routes((url) => url.pathname.includes('/repository/files/') ? new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }) : null);
    await expect(fetchGitLabConfig(PAGE, new AbortController().signal, denied)).rejects.toThrow('sign-in');
    expect((await fetchGitLabConfig(PAGE, new AbortController().signal, routes())).files[0]?.text).toContain('tests: false');
  });

  it('refuses a different project or an unpinned branch response before any file request', async () => {
    const wrong = routes((url) => url.href === ROOT ? json({ path_with_namespace: 'attacker/widgets', default_branch: 'main' }) : null);
    await expect(fetchGitLabConfig(PAGE, new AbortController().signal, wrong)).rejects.toThrow('default branch');
    expect(wrong).toHaveBeenCalledTimes(1);
    const mutable = routes((url) => url.pathname.includes('/repository/branches/') ? json({ name: 'release/main', commit: { id: 'main' } }) : null);
    await expect(fetchGitLabConfig(PAGE, new AbortController().signal, mutable)).rejects.toThrow('revision');
    expect(mutable).toHaveBeenCalledTimes(2);
  });
});
