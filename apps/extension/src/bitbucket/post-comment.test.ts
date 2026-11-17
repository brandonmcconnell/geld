// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bitbucketCsrfToken, postBitbucketComment } from './post-comment';

const subject = { provider: 'bitbucket' as const, origin: 'https://bitbucket.org', repository: 'acme/app', id: '22', headSha: 'a'.repeat(40) };

function signIn(authenticated: boolean): void {
  document.head.innerHTML = `<meta id="bb-bootstrap" data-current-user='{"isAuthenticated":${String(authenticated)}}'>`;
  document.cookie = 'csrftoken=tok%2Ben';
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('postBitbucketComment', () => {
  it('reads the CSRF cookie', () => {
    signIn(true);
    expect(bitbucketCsrfToken()).toBe('tok+en');
  });

  it('posts the raw comment to the page’s own API with the token', async () => {
    signIn(true);
    const fetch = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    expect(await postBitbucketComment(subject, '@cursor fix it')).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(String(url)).toBe('https://bitbucket.org/!api/2.0/repositories/acme/app/pullrequests/22/comments');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('tok+en');
    expect(JSON.parse(String(init.body))).toEqual({ content: { raw: '@cursor fix it' } });
  });

  it('sends nothing for a reader who is signed out', async () => {
    signIn(false);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await postBitbucketComment(subject, '@cursor fix it')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers false when Bitbucket refuses', async () => {
    signIn(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await postBitbucketComment(subject, '@cursor fix it')).toBe(false);
  });
});
