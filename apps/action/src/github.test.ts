import { describe, expect, it } from 'vitest';
import { filesChangedBetween, findSummaryComment, parseActionEvent, shouldSkipSelfEdit } from './github';

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
