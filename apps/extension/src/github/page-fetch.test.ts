// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageFetch } from './page-fetch';

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pageFetch', () => {
  it('resolves the path against the page where there is no content.fetch', async () => {
    const own = vi.fn<Fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', own);
    await pageFetch('/acme/widgets/pull/7/page_data/merge_box', { method: 'GET' });
    expect(String(own.mock.calls[0]?.[0])).toBe(`${location.origin}/acme/widgets/pull/7/page_data/merge_box`);
  });

  it('sends a request to the page’s host with the page’s fetch, and answers with a Response of its own', async () => {
    const own = vi.fn<Fetch>(async () => new Response('{}', { status: 200 }));
    const page = vi.fn(async () => new Response('{"error":"Review body is required"}', { status: 422, statusText: 'Unprocessable', headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', own);
    vi.stubGlobal('content', { fetch: page });
    const init = { method: 'PUT', body: '{}' };
    const response = await pageFetch('/acme/widgets/pull/7/page_data/submit_review', init);
    expect(own).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledWith(`${location.origin}/acme/widgets/pull/7/page_data/submit_review`, init);
    expect([response.status, response.statusText, response.headers.get('content-type')]).toEqual([422, 'Unprocessable', 'application/json']);
    expect(await response.json()).toEqual({ error: 'Review body is required' });
  });

  it('leaves the content script’s abort signal out of the page’s fetch, which belongs to another world', async () => {
    const page = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('content', { fetch: page });
    await pageFetch('/acme/widgets/pull/7/page_data/merge_box', { method: 'GET', signal: new AbortController().signal });
    expect(page).toHaveBeenCalledWith(`${location.origin}/acme/widgets/pull/7/page_data/merge_box`, { method: 'GET' });
  });

  it('keeps an answer with no body empty', async () => {
    vi.stubGlobal('content', { fetch: async () => new Response(null, { status: 204 }) });
    const response = await pageFetch('/acme/widgets/pull/7/page_data/abandon_review', { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('leaves another host to the extension’s own fetch', async () => {
    const own = vi.fn<Fetch>(async () => new Response('', { status: 200 }));
    const page = vi.fn();
    vi.stubGlobal('fetch', own);
    vi.stubGlobal('content', { fetch: page });
    await pageFetch('https://raw.githubusercontent.com/acme/widgets/HEAD/.github/geld.yml');
    expect(page).not.toHaveBeenCalled();
    expect(String(own.mock.calls[0]?.[0])).toBe('https://raw.githubusercontent.com/acme/widgets/HEAD/.github/geld.yml');
  });
});
