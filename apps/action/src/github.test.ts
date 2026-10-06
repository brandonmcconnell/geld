import { describe, expect, it } from 'vitest';
import { filesChangedBetween, findSummaryComment, loadPullRequest, parseActionEvent, shouldSkipSelfEdit } from './github';

const BASE = {
  repository: { full_name: 'acme/widgets' },
  sender: { login: 'alice' },
};

describe('parseActionEvent', () => {
  it('reads a pull_request payload', () => {
    const event = parseActionEvent({ GITHUB_EVENT_NAME: 'pull_request_target' }, { ...BASE, action: 'synchronize', pull_request: { number: 12 } });
    expect(event).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 12,
      actor: 'alice',
      eventName: 'pull_request_target',
      action: 'synchronize',
      commentAuthor: null,
      commentBody: null,
    });
  });

  it('reads an issue_comment on a pull request', () => {
    const event = parseActionEvent(
      { GITHUB_EVENT_NAME: 'issue_comment' },
      { ...BASE, action: 'edited', issue: { number: 12, pull_request: {} }, comment: { user: { login: 'bob' }, body: '- [x] done' } },
    );
    expect(event?.number).toBe(12);
    expect(event?.commentAuthor).toBe('bob');
  });

  it('reads a check_run payload with pull_requests', () => {
    const event = parseActionEvent(
      { GITHUB_EVENT_NAME: 'check_run' },
      { ...BASE, action: 'completed', check_run: { pull_requests: [{ number: 12 }] } },
    );
    expect(event?.number).toBe(12);
    expect(event?.eventName).toBe('check_run');
  });
});

describe('findSummaryComment', () => {
  it('returns the first Geld summary and ignores other comments', () => {
    const found = findSummaryComment([
      { databaseId: 1, author: 'alice', body: 'Looks good.', createdAt: '2026-09-18T10:00:00.000Z' },
      {
        databaseId: 2,
        author: 'github-actions[bot]',
        body: '<!-- geld:summary:v1 -->\n### Geld review summary\n\n<details><summary>Geld data</summary>\n\n```geld\n{"v":1,"generatedAt":"2026-09-18T12:00:00.000Z","headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","producer":{"kind":"action","version":"0.1.0","ai":false},"items":[],"bots":[],"reviewers":[],"fold":{"comments":[],"events":[]}}\n```\n\n</details>\n',
        createdAt: '2026-09-18T10:01:00.000Z',
      },
      {
        databaseId: 3,
        author: 'github-actions[bot]',
        body: '<!-- geld:summary:v1 --> duplicate',
        createdAt: '2026-09-18T10:02:00.000Z',
      },
    ]);
    expect(found?.commentId).toBe(2);
    expect(found?.meta?.v).toBe(1);
  });

  it('passes over a participant\u2019s comment that carries the marker, and takes the token\u2019s own login', () => {
    const marker = '<!-- geld:summary:v1 -->\n### Geld review summary\n';
    const comments = [
      { databaseId: 1, author: 'mallory', body: marker, createdAt: '2026-09-18T10:00:00.000Z' },
      { databaseId: 2, author: 'geld-ci-user', body: marker, createdAt: '2026-09-18T10:01:00.000Z' },
      { databaseId: 3, author: 'github-actions[bot]', body: marker, createdAt: '2026-09-18T10:02:00.000Z' },
    ];
    expect(findSummaryComment(comments)?.commentId).toBe(3);
    expect(findSummaryComment(comments, ['geld-ci-user'])?.commentId).toBe(2);
    expect(findSummaryComment(comments.slice(0, 1))).toBeNull();
  });
});

describe('filesChangedBetween', () => {
  it('returns filenames from the compare API and skips equal SHAs', async () => {
    expect(await filesChangedBetween({ token: 't', fetch: async () => new Response('{}') }, 'o', 'r', 'aaa', 'aaa')).toEqual([]);
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toContain('/compare/aaa...bbb');
      return new Response(JSON.stringify({ files: [{ filename: 'src/diff.ts' }, { filename: 'README.md' }] }));
    };
    expect(await filesChangedBetween({ token: 't', fetch: fetchImpl }, 'o', 'r', 'aaa', 'bbb')).toEqual(['src/diff.ts', 'README.md']);
  });
});

describe('shouldSkipSelfEdit', () => {
  it('skips the Action rewriting its own comment', () => {
    const event = parseActionEvent(
      { GITHUB_EVENT_NAME: 'issue_comment' },
      {
        ...BASE,
        action: 'edited',
        sender: { login: 'github-actions[bot]' },
        issue: { number: 1, pull_request: {} },
        comment: { user: { login: 'github-actions[bot]' }, body: '<!-- geld:summary:v1 -->\n### Geld review summary\n' },
      },
    );
    expect(event).not.toBeNull();
    if (event === null) return;
    expect(shouldSkipSelfEdit(event)).toBe(true);
  });

  it('does not skip a human ticking a checkbox', () => {
    const event = parseActionEvent(
      { GITHUB_EVENT_NAME: 'issue_comment' },
      {
        ...BASE,
        action: 'edited',
        issue: { number: 1, pull_request: {} },
        comment: { user: { login: 'alice' }, body: '<!-- geld:summary:v1 -->\n- [x] **Done** — [source](#discussion_r1)' },
      },
    );
    expect(event).not.toBeNull();
    if (event === null) return;
    expect(shouldSkipSelfEdit(event)).toBe(false);
  });
});

describe('loadPullRequest', () => {
  const page = { hasNextPage: false, endCursor: null };
  const comment = (id: number, login = 'alice') => ({ databaseId: id, author: { login, __typename: 'User' }, body: `c${id}`, createdAt: '2026-09-18T10:00:00.000Z' });

  it('reads a thread\u2019s comments past the first page', async () => {
    const calls: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push(body.variables);
      if (String(body.query).includes('GeldThreadComments')) {
        // The thread's later pages, by cursor.
        return new Response(JSON.stringify({ data: { node: { comments: body.variables.cursor === 'c1' ? { pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: [comment(2)] } : { pageInfo: page, nodes: [comment(3, 'bob')] } } } }));
      }
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 7,
                headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                reviewThreads: { pageInfo: page, nodes: [{ id: 'T1', isResolved: false, isOutdated: false, path: 'a.ts', line: 1, comments: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [comment(1, 'cursor')] } }] },
                comments: { pageInfo: page, nodes: [] },
                reviews: { pageInfo: page, nodes: [] },
                commits: { nodes: [{ commit: { oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', statusCheckRollup: null } }] },
              },
            },
          },
        }),
      );
    };
    const pr = await loadPullRequest({ token: 't', fetch: fetchImpl }, 'acme', 'widgets', 7);
    expect(pr.threads).toHaveLength(1);
    expect(pr.threads[0]?.comments.map((entry) => entry.author)).toEqual(['cursor', 'alice', 'bob']);
    expect(calls).toHaveLength(3);
  });

  it('reads the head commit\u2019s check contexts past the first page', async () => {
    const run = (name: string) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' });
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (String(body.query).includes('GeldCheckContexts')) {
        expect(body.variables.cursor).toBe('k1');
        return new Response(JSON.stringify({ data: { repository: { object: { statusCheckRollup: { contexts: { pageInfo: page, nodes: [run('Cursor Bugbot'), { __typename: 'StatusContext', context: 'codecov/patch', state: 'PENDING' }] } } } } } }));
      }
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                number: 7,
                headRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                reviewThreads: { pageInfo: page, nodes: [] },
                comments: { pageInfo: page, nodes: [] },
                reviews: { pageInfo: page, nodes: [] },
                commits: { nodes: [{ commit: { oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', statusCheckRollup: { contexts: { pageInfo: { hasNextPage: true, endCursor: 'k1' }, nodes: [run('build')] } } } }] },
              },
            },
          },
        }),
      );
    };
    const pr = await loadPullRequest({ token: 't', fetch: fetchImpl }, 'acme', 'widgets', 7);
    expect(pr.checks.map((check) => check.name)).toEqual(['build', 'Cursor Bugbot', 'codecov/patch']);
    expect(pr.checks[2]).toMatchObject({ status: 'in_progress', conclusion: null });
  });
});
