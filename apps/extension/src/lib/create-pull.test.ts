import { describe, expect, it } from 'vitest';
import type { PullAttempt } from './create-pull';
import { apiRefusal, ghCommand, isRetryableFailure, parseRef, pullAttemptFrom, senderMayCreatePull, shellQuote } from './create-pull';

const ATTEMPT: PullAttempt = { owner: 'pingdotgg', repo: 't3code', base: 'main', head: 'theo:fix-nav', headRepo: null, title: 'Fix the nav', body: 'It broke.', draft: false };

function attempt(pagePath: string, query = ''): PullAttempt | null {
  return pullAttemptFrom({ pagePath, queries: [new URLSearchParams(query)], title: 'T', body: 'B', draft: false });
}

describe('parseRef', () => {
  it('reads the three shapes GitHub writes a compare ref in', () => {
    expect(parseRef('main')).toEqual({ owner: null, repo: null, branch: 'main' });
    expect(parseRef('theo:fix')).toEqual({ owner: 'theo', repo: null, branch: 'fix' });
    expect(parseRef('theo:fork:fix')).toEqual({ owner: 'theo', repo: 'fork', branch: 'fix' });
    expect(parseRef('a::b')).toBeNull();
  });
});

describe('pullAttemptFrom', () => {
  it('reads base and head from the compare path', () => {
    expect(attempt('/pingdotgg/t3code/compare/main...theo:fix-nav')).toMatchObject({ owner: 'pingdotgg', repo: 't3code', base: 'main', head: 'theo:fix-nav', headRepo: null });
    expect(attempt('/o/r/compare/main...feature/a.b')).toMatchObject({ owner: 'o', repo: 'r', base: 'main', head: 'feature/a.b' });
  });

  it('takes the form action query first, which is all there is once GitHub re-rendered the form at /pull/create', () => {
    expect(attempt('/o/r/pull/create', 'base=o%3Amain&head=u%3Afix')).toMatchObject({ owner: 'o', repo: 'r', base: 'main', head: 'u:fix' });
    expect(attempt('/o/r/pull/create')).toBeNull();
  });

  it('names a head in another repository of the same owner', () => {
    expect(attempt('/o/r/compare/main...o:r-fork:fix')).toMatchObject({ head: 'o:fix', headRepo: 'r-fork' });
    expect(attempt('/o/r/compare/main...o:r:fix')).toMatchObject({ head: 'fix', headRepo: null });
  });

  it('opens the pull request on a qualified base, with the page repository as the head', () => {
    expect(attempt('/fork/r/compare/up:main...fix')).toMatchObject({ owner: 'up', repo: 'r', base: 'main', head: 'fork:fix' });
  });

  it('needs a title', () => {
    expect(pullAttemptFrom({ pagePath: '/o/r/compare/main...fix', queries: [], title: '  ', body: '', draft: false })).toBeNull();
  });
});

describe('ghCommand', () => {
  it('is the same request from a terminal', () => {
    expect(ghCommand(ATTEMPT)).toBe("gh pr create --repo pingdotgg/t3code --base main --head theo:fix-nav --title 'Fix the nav' --body 'It broke.'");
    expect(ghCommand({ ...ATTEMPT, draft: true, body: '' }, 'ghe.acme.dev')).toBe("GH_HOST=ghe.acme.dev gh pr create --repo pingdotgg/t3code --base main --head theo:fix-nav --title 'Fix the nav' --body '' --draft");
  });

  it('quotes for the shell', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'");
    expect(shellQuote('feature/a.b')).toBe('feature/a.b');
  });
});

describe('isRetryableFailure', () => {
  it('retries what a second send can change, not what it cannot', () => {
    expect(isRetryableFailure('Validation failed: was submitted too quickly')).toBe(true);
    expect(isRetryableFailure('A pull request already exists for theo:fix-nav.')).toBe(false);
    expect(isRetryableFailure('Validation failed: No commits between main and fix')).toBe(false);
  });
});

describe('apiRefusal', () => {
  it("says GitHub's own words for a 422", () => {
    expect(apiRefusal(422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for theo:fix-nav.' }] })).toEqual({
      ok: false,
      reason: 'refused',
      message: 'A pull request already exists for theo:fix-nav.',
    });
  });

  it('tells a repository the App cannot reach from a refusal', () => {
    expect(apiRefusal(403, { message: 'Resource not accessible by integration' })).toMatchObject({ reason: 'unavailable' });
    expect(apiRefusal(404, { message: 'Not Found' })).toMatchObject({ reason: 'unavailable' });
  });
});

describe('senderMayCreatePull', () => {
  it("takes only github.com pages of the pull request's own repository", () => {
    expect(senderMayCreatePull('https://github.com/PingDotGG/t3code/pull/create', ATTEMPT)).toBe(true);
    expect(senderMayCreatePull('https://github.com/evil/t3code/pull/create', ATTEMPT)).toBe(false);
    expect(senderMayCreatePull('https://ghe.acme.dev/pingdotgg/t3code/compare/main...x', ATTEMPT)).toBe(false);
    expect(senderMayCreatePull(undefined, ATTEMPT)).toBe(false);
  });
});
