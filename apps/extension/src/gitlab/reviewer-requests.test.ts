// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitLabReviewerRequests, parseGitLabCandidates } from './reviewer-requests';

const subject = { provider: 'gitlab' as const, origin: 'https://gitlab.com', repository: 'group/app', id: '7', headSha: 'a'.repeat(40) };

afterEach(() => vi.unstubAllGlobals());

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('gitLabReviewerRequests', () => {
  it('lists active people, never bots', () => {
    expect(parseGitLabCandidates([{ id: 1, username: 'ana', name: 'Ana', avatar_url: 'https://gitlab.com/a.png', state: 'active' }, { id: 2, username: 'duo', bot: true }, { id: 3, username: 'gone', state: 'blocked' }], 'https://gitlab.com'))
      .toEqual([{ id: 1, login: 'ana', name: 'Ana', avatar: 'https://gitlab.com/a.png', suggested: false, team: false }]);
  });

  it('offers nothing without a CSRF token', () => {
    document.head.innerHTML = '';
    expect(gitLabReviewerRequests(subject)).toBeNull();
  });

  it('adds someone new to the whole set and re-requests someone already a reviewer', async () => {
    document.head.innerHTML = '<meta name="csrf-token" content="tok">';
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init.method === 'GET') return reply({ reviewers: [{ id: 5 }] });
      return reply(init.method === 'POST' ? { data: { mergeRequestReviewerRereview: { errors: [] } } } : {});
    }));
    expect(await gitLabReviewerRequests(subject)?.request([9, 5])).toBe(true);
    const put = calls.find((call) => call.init.method === 'PUT');
    expect(put?.url).toBe('https://gitlab.com/api/v4/projects/group%2Fapp/merge_requests/7');
    expect(JSON.parse(String(put?.init.body))).toEqual({ reviewer_ids: [5, 9] });
    const graphql = calls.find((call) => call.init.method === 'POST');
    expect(JSON.parse(String(graphql?.init.body)).variables).toEqual({ projectPath: 'group/app', iid: '7', userId: 'gid://gitlab/User/5' });
    expect(new Headers(put?.init.headers).get('X-CSRF-Token')).toBe('tok');
  });

  it('says so when GitLab refuses', async () => {
    document.head.innerHTML = '<meta name="csrf-token" content="tok">';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => (init.method === 'GET' ? reply({ reviewers: [] }) : reply({}, 403))));
    expect(await gitLabReviewerRequests(subject)?.request([9])).toBe(false);
  });
});
