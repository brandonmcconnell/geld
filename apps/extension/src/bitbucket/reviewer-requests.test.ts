// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bitbucketReviewerRequests, parseBitbucketCandidates } from './reviewer-requests';

const subject = { provider: 'bitbucket' as const, origin: 'https://bitbucket.org', repository: 'acme/app', id: '22', headSha: 'a'.repeat(40) };
const ana = '{11111111-1111-1111-1111-111111111111}';
const bo = '{22222222-2222-2222-2222-222222222222}';

function signIn(authenticated: boolean): void {
  document.head.innerHTML = `<meta id="bb-bootstrap" data-current-user='{"isAuthenticated":${String(authenticated)}}'>`;
  document.cookie = 'csrftoken=tok';
}

afterEach(() => vi.unstubAllGlobals());

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('bitbucketReviewerRequests', () => {
  it('lists the workspace’s people by nickname, never apps', () => {
    expect(parseBitbucketCandidates({ values: [{ user: { uuid: ana, nickname: 'ana', display_name: 'Ana', links: { avatar: { href: 'https://avatar.example/a' } } } }, { user: { uuid: bo, type: 'app_user' } }] }))
      .toEqual([{ id: ana, login: 'ana', name: 'Ana', avatar: 'https://avatar.example/a', suggested: false, team: false }]);
  });

  it('offers nothing to a reader who is signed out', () => {
    signIn(false);
    expect(bitbucketReviewerRequests(subject)).toBeNull();
  });

  it('writes the whole set back with the title Bitbucket wants', async () => {
    signIn(true);
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return init.method === 'GET' ? reply({ title: 'Fix it', reviewers: [{ uuid: ana }] }) : reply({});
    }));
    const requests = bitbucketReviewerRequests(subject);
    expect(requests?.reask).toBe(false);
    expect(await requests?.request([bo, ana])).toBe(true);
    const put = calls.find((call) => call.init.method === 'PUT');
    expect(put?.url).toBe('https://bitbucket.org/!api/2.0/repositories/acme/app/pullrequests/22');
    expect(JSON.parse(String(put?.init.body))).toEqual({ title: 'Fix it', reviewers: [{ uuid: ana }, { uuid: bo }] });
    expect(new Headers(put?.init.headers).get('X-CSRFToken')).toBe('tok');
  });
});
