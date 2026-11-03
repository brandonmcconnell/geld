import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => { let value: unknown = {}; return { get: () => value, set: (next: unknown) => { value = next; }, reset: () => { value = {}; } }; });
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => stored.get(), setValue: async (value: unknown) => stored.set(value) }) } }));

import { fetchBitbucketConfig } from './config';
import { BitbucketClient } from './api';
import { canonicalBitbucketApiUrl, createBitbucketTransport } from './transport';
import type { ProviderReviewPage } from '../providers/types';
const REF = 'a'.repeat(40);
const HEAD = 'f'.repeat(40);
const ROOT = 'https://api.bitbucket.org/2.0/repositories/acme/widgets';
const PAGE: ProviderReviewPage = {
  provider: 'bitbucket', repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' }, number: '12',
  url: 'https://bitbucket.org/acme/widgets/pull-requests/12', diffPageUrl: 'https://bitbucket.org/acme/widgets/pull-requests/12/diff', diffUrl: `${ROOT}/pullrequests/12/diff`, kind: 'diff', headSha: HEAD, version: '12',
};
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function routes(override?: (url: URL) => Response | null): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const custom = override?.(url);
    if (custom !== undefined && custom !== null) return custom;
    if (url.href === ROOT) return json({ full_name: 'acme/widgets', mainbranch: { name: 'release/main' } });
    if (url.href === `${ROOT}/refs/branches/release%2Fmain`) return json({ name: 'release/main', target: { hash: REF } });
    if (url.pathname.endsWith(`/src/${REF}/`)) return json({ values: [{ type: 'commit_directory', path: '.github' }, { type: 'commit_file', path: '.gitattributes' }], size: 2 });
    if (url.pathname.endsWith(`/src/${REF}/.github/`)) return json({ values: [{ type: 'commit_file', path: '.github/geld.yml' }], size: 1 });
    if (url.pathname.endsWith(`/src/${REF}/.github/geld.yml`)) return new Response('categories:\n  tests: false', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.endsWith(`/src/${REF}/.gitattributes`)) return new Response('generated/** linguist-generated');
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  });
}
beforeEach(() => stored.reset());

describe('Bitbucket configuration protocol fixtures', () => {
  it('uses the native session transport for metadata and raw files without relaxing canonical response URL checks', async () => {
    const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store: { read: async () => 0, write: async () => undefined } });
    const canonical = routes();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://bitbucket.org');
      expect(url.pathname).toMatch(/^\/!api\/2\.0\/repositories\/acme\/widgets(?:\/|$)/);
      expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'manual' });
      const result = await canonical(canonicalBitbucketApiUrl(url).href, init);
      Object.defineProperty(result, 'url', { value: url.href });
      return result;
    });
    expect((await fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher, transport)).files[0]?.text).toContain('tests: false');
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/.github/geld.yml'))).toBe(true);
  });

  it('shares persisted 429 cooldowns between review clients and repository configuration', async () => {
    let until = 0;
    const store = { read: async () => until, write: async (value: number) => { until = value; } };
    const transport = createBitbucketTransport({ origin: () => null, now: () => 0, store });
    const blocked = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(new BitbucketClient(PAGE, blocked, transport).comments(new AbortController().signal)).rejects.toMatchObject({ reason: 'rate-limited', retryAfterMs: 3_600_000 });
    const fetcher = routes();
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher, transport)).rejects.toMatchObject({ retryAfterMs: 3_600_000 });
    expect(fetcher).not.toHaveBeenCalled();
    transport.dispose();
    const reloaded = createBitbucketTransport({ origin: () => null, now: () => 0, store });
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher, reloaded)).rejects.toMatchObject({ retryAfterMs: 3_600_000 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('blocks new review sources after configuration itself observes a 429', async () => {
    let until = 0;
    const transport = createBitbucketTransport({ now: () => 0, store: { read: async () => until, write: async (value) => { until = value; } } });
    const blocked = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '7200' } }));
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, blocked, transport)).rejects.toMatchObject({ retryAfterMs: 7_200_000 });
    const fetcher = vi.fn<typeof fetch>();
    await expect(new BitbucketClient(PAGE, fetcher, transport).statuses(new AbortController().signal)).rejects.toMatchObject({ reason: 'rate-limited', retryAfterMs: 7_200_000 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('pins repository default-branch content independently of the untrusted PR head', async () => {
    const fetcher = routes();
    const result = await fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher);
    expect(result.ref).toBe(REF);
    expect(result.files[0]?.text).toContain('tests: false');
    const requests = fetcher.mock.calls.map(([input]) => String(input));
    expect(requests[1]).toBe(`${ROOT}/refs/branches/release%2Fmain`);
    expect(requests.filter((url) => url.includes('/src/')).every((url) => url.includes(`/src/${REF}/`))).toBe(true);
    expect(requests.every((url) => !url.includes(HEAD) && !url.includes('/pullrequests/'))).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit' && init.redirect === 'manual')).toBe(true);
    expect(result.files[0]?.url).toBe(`https://bitbucket.org/acme/widgets/src/${REF}/.github/geld.yml`);
  });

  it('does not request missing raw files after a complete tree listing', async () => {
    const fetcher = routes((url) => url.pathname.endsWith(`/src/${REF}/`) ? json({ values: [], size: 0 }) : null);
    const result = await fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher);
    expect(result.files.every((file) => file.text === null)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('follows pagination only within the same repository and pinned revision', async () => {
    const fetcher = routes((url) => {
      if (!url.pathname.endsWith(`/src/${REF}/`)) return null;
      return url.searchParams.get('page') === '2'
        ? json({ values: [{ type: 'commit_directory', path: '.github' }], size: 2 })
        : json({ values: [{ type: 'commit_file', path: 'README.md' }], size: 2, next: `${ROOT}/src/${REF}/?pagelen=100&page=2` });
    });
    expect((await fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher)).files[0]?.text).toContain('tests: false');
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('page=2'))).toBe(true);
  });

  it.each([
    'https://evil.example/collect',
    `${ROOT}/src/${HEAD}/?page=2`,
    'https://api.bitbucket.org/2.0/repositories/attacker/widgets/src/' + REF + '/?page=2',
    `${ROOT}/src/${REF}/?fields=values.path&page=2`,
  ])('rejects pagination to %s before making another request', async (next) => {
    const fetcher = routes((url) => url.pathname.endsWith(`/src/${REF}/`) ? json({ values: [], next }) : null);
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher)).rejects.toThrow('pinned revision');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects incomplete tree metadata and retries after an authentication failure', async () => {
    const truncated = routes((url) => url.pathname.endsWith(`/src/${REF}/`) ? json({ values: [], size: 5 }) : null);
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, truncated)).rejects.toThrow('incomplete');
    const denied = routes((url) => url.pathname.includes('/src/') ? new Response('', { status: 401 }) : null);
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, denied)).rejects.toThrow('Sign in');
    expect((await fetchBitbucketConfig(PAGE, new AbortController().signal, routes())).files[0]?.text).toContain('tests: false');
  });

  it('rejects wrong repositories before reading branch or file data', async () => {
    const fetcher = routes((url) => url.href === ROOT ? json({ full_name: 'attacker/widgets', mainbranch: { name: 'main' } }) : null);
    await expect(fetchBitbucketConfig(PAGE, new AbortController().signal, fetcher)).rejects.toThrow('default branch');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
