import { describe, expect, it } from 'vitest';
import { repoVisibility } from './repo-visibility';

function answer(status: number, url = ''): () => Promise<Response> {
  return async () => {
    const response = new Response(null, { status });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
}

describe('repoVisibility', () => {
  it('asks for the repository page without cookies', async () => {
    let asked: { readonly url: string; readonly init: RequestInit } | null = null;
    await repoVisibility(new URL('https://github.com/wxt-dev/wxt/pull/2544/files?w=1'), async (url, init) => {
      asked = { url, init };
      return new Response(null, { status: 200 });
    });
    expect(asked).toMatchObject({ url: 'https://github.com/wxt-dev/wxt', init: { method: 'HEAD', credentials: 'omit' } });
  });

  it('reads the answer', async () => {
    const page = new URL('https://github.com/acme/widgets/pull/1');
    expect(await repoVisibility(page, answer(200, 'https://github.com/acme/widgets'))).toBe('public');
    expect(await repoVisibility(page, answer(404))).toBe('private');
    expect(await repoVisibility(new URL('https://ghe.example.com/acme/widgets'), answer(200, 'https://ghe.example.com/login?return_to=%2Facme'))).toBe('private');
    expect(await repoVisibility(page, answer(429))).toBe('unknown');
    expect(await repoVisibility(page, async () => Promise.reject(new Error('offline')))).toBe('unknown');
  });

  it('knows nothing of a page with no repository', async () => {
    expect(await repoVisibility(new URL('https://github.com/pulls'), answer(200))).toBe('unknown');
  });
});
