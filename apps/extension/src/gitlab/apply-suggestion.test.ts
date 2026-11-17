// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderReviewThread } from '@geld/review';
import { gitLabFixApplier, gitLabRefusal, gitLabSuggestionInfo } from './apply-suggestion';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '7', headSha: 'a'.repeat(40) } as const;
const thread: ProviderReviewThread = {
  id: 'd'.repeat(40), anchor: `discussion_${'d'.repeat(40)}`, url: 'https://gitlab.com/group/project/-/merge_requests/7#note_1', path: 'src/a.ts', line: 12, side: 'new',
  resolved: false, outdated: false,
  comments: [{ id: '1', anchor: 'note_1', url: 'https://gitlab.com/group/project/-/merge_requests/7#note_1', author: { id: '9', login: 'bot' }, body: 'Check it.', createdAt: '2026-11-01T00:00:00Z' }],
};
const fix = { threadAnchors: ['note_1'], path: 'src/a.ts', start: 12, end: 12, replacement: ['const a = 1;'], summary: 'Fix it.', title: 'A finding', headSha: subject.headSha };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.location.href = 'https://gitlab.com/group/project/-/merge_requests/7';
  document.head.innerHTML = '<meta name="csrf-token" content="token-1">';
});
afterEach(() => vi.unstubAllGlobals());

describe('GitLab triage apply', () => {
  it('counts the replaced lines around the thread\'s line', () => {
    expect(gitLabSuggestionInfo(12, 12, 12)).toBe('suggestion:-0+0');
    expect(gitLabSuggestionInfo(12, 10, 13)).toBe('suggestion:-2+1');
    expect(gitLabSuggestionInfo(12, 13, 14)).toBeNull();
  });

  it('posts a suggestion note in the discussion, commits it with batch_apply, and resolves the thread', async () => {
    const calls: { url: string; method: string; body: unknown; csrf: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? 'GET', body: init.body === undefined ? null : JSON.parse(String(init.body)), csrf: new Headers(init.headers).get('X-CSRF-Token') });
      if (url.endsWith('/notes')) return json(201, { id: 55, suggestions: [{ id: 801, applicable: true }] });
      return json(200, {});
    }));
    const applier = gitLabFixApplier(subject, () => [thread]);
    const results = await applier.apply([fix]);
    expect(results).toEqual([{ ok: true, replyAnchor: 'note_55' }]);
    expect(calls[0]?.url).toBe(`https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/7/discussions/${'d'.repeat(40)}/notes`);
    expect(calls[0]?.csrf).toBe('token-1');
    expect(String((calls[0]?.body as { body: string }).body)).toContain('```suggestion:-0+0\nconst a = 1;\n```');
    expect(calls[1]).toMatchObject({ url: 'https://gitlab.com/api/v4/suggestions/batch_apply', method: 'PUT', body: { ids: [801] } });
    applier.resolve('note_1');
    await Promise.resolve();
    expect(calls[2]).toMatchObject({ url: `https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/7/discussions/${'d'.repeat(40)}?resolved=true`, method: 'PUT' });
  });

  it('says GitLab\'s refusal and keeps the posted note to commit next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => (String(input).endsWith('/notes') ? json(201, { id: 55, suggestions: [{ id: 801 }] }) : json(400, { message: 'Suggestion is not applicable as its lines have changed' }))));
    const [result] = await gitLabFixApplier(subject, () => [thread]).apply([fix]);
    expect(result).toEqual({ ok: false, reason: 'GitLab refused it: Suggestion is not applicable as its lines have changed The suggestion is in the thread.', posted: true, reply: { anchor: 'note_55', id: 55 } });
  });

  it('asks a signed-out reader to sign in, sending nothing', async () => {
    document.head.innerHTML = '';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const [result] = await gitLabFixApplier(subject, () => [thread]).apply([fix]);
    expect(result).toEqual({ ok: false, reason: 'Sign in to GitLab to apply a fix.', posted: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('suggests nothing for a thread on the old side', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const [result] = await gitLabFixApplier(subject, () => [{ ...thread, side: 'old' }]).apply([fix]);
    expect(result?.ok).toBe(false);
  });

  it('reads a status when GitLab gives no words', () => {
    expect(gitLabRefusal({ ok: false, status: 403, body: null })).toBe('GitLab does not let you apply suggestions here.');
  });
});
