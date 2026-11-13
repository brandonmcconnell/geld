import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import { clusterComments } from '@geld/review';
import type { GeldPrMeta, RawComment } from '@geld/review';

const stored = new Map<string, unknown>();

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: <T>(key: string, options: { readonly fallback: T }) => ({
      getValue: async (): Promise<unknown> => (stored.has(key) ? stored.get(key) : options.fallback),
      setValue: async (value: unknown): Promise<void> => {
        stored.set(key, value);
      },
      watch: () => () => undefined,
    }),
  },
}));
const sendMessage = vi.fn(async (_message: unknown): Promise<unknown> => undefined);
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: (message: unknown) => sendMessage(message) } } }));

const { adoptOwnReplies, aiStateFor, loadAiForPage, markSuggestionPosted, pendingReplyFor, runAi, triageSuggestions, withAi } = await import('./ai');

const at = '2026-11-13T14:24:02Z';
const finding: RawComment = { anchor: 'discussion_r100', kind: 'thread', author: 'greptile-apps[bot]', body: 'The caret switch is never tested.', createdAt: at, path: 'src/a.test.ts', line: 179 };
const replacement = ['render(group(false));', 'expect(variants()).toEqual(["primary", "primary"]);'];
const geldReply = { anchor: 'discussion_r200', kind: 'thread' as const, author: 'brandonmcconnell', body: `Suggested fix from Geld triage: Toggle in place. Suggested change ${replacement.join(' ')}` };

function metaFor(comments: readonly RawComment[]): GeldPrMeta {
  return { v: 1, generatedAt: at, headSha: 'head1', producer: { kind: 'crawler', version: '1', ai: false }, items: clusterComments(comments), bots: [], reviewers: [], fold: { comments: [], events: [] } };
}

async function loadRun(): Promise<void> {
  const before = metaFor([finding]);
  const item = before.items[0];
  stored.set('local:aiRuns', {
    'github:/o/r/pull/7': {
      ranAt: at,
      rewrites: [],
      seen: [finding.anchor],
      summary: { tldr: 'One finding: test the caret switch.', updatedAt: at, forItems: [item?.id ?? ''] },
      suggestions: [{ key: finding.anchor, threads: [finding.anchor], headSha: 'head1', path: 'src/a.test.ts', start: 174, end: 179, original: ['a'], replacement, summary: 'Toggle in place.', state: 'open', sources: [finding.anchor], itemIds: { [finding.anchor]: item?.id ?? '' } }],
    },
  });
  // The module keeps one pull request's run: point it elsewhere first, so this one is read afresh.
  await new Promise<void>((resolve) => loadAiForPage(`github:/o/r/pull/7-${Math.random()}`, resolve));
  await new Promise<void>((resolve) => loadAiForPage('github:/o/r/pull/7', resolve));
}

describe('Geld’s own suggestion reply in a fix’s thread', () => {
  beforeEach(() => stored.clear());

  it('makes the fix read as behind until it is known as Geld’s, then not', async () => {
    await loadRun();
    const withReply: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    const meta = metaFor(withReply);
    expect(triageSuggestions(meta, DEFAULT_SETTINGS)[0]?.behind).toBe('comments');
    await adoptOwnReplies(withReply, 'brandonmcconnell');
    expect(triageSuggestions(meta, DEFAULT_SETTINGS)[0]?.behind).toBeNull();
    // Adopted from the page it is Geld's, but not the one to commit: the page cannot say which fix it carries.
    expect(pendingReplyFor(finding.anchor, withReply)).toBeNull();
    expect(adoptOwnReplies(withReply, 'brandonmcconnell')).toBeNull();
  });

  it('keeps the TL;DR current over a thread only Geld has written in since', async () => {
    await loadRun();
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const withReply: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    const meta = metaFor(withReply);
    expect(aiStateFor(meta, withReply, settings).kind).toBe('stale');
    await adoptOwnReplies(withReply, 'brandonmcconnell');
    expect(aiStateFor(meta, withReply, settings).kind).toBe('current');
    const answered: RawComment[] = [{ ...withReply[0] ?? finding, threadAnchors: [...(withReply[0]?.threadAnchors ?? []), { anchor: 'discussion_r300', kind: 'thread', author: 'someone-else', body: 'Not this way.' }] }];
    expect(aiStateFor(metaFor(answered), answered, settings).kind).toBe('stale');
  });

  it('names a new commit as well as new comments, since the commit is why the fix is greyed out', async () => {
    await loadRun();
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const answered: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, { anchor: 'discussion_r300', kind: 'thread', author: 'coderabbitai[bot]', body: 'Agreed, the switch is untested.' }] }];
    const pushed = { ...metaFor(answered), headSha: 'head2' };
    expect(aiStateFor(pushed, answered, settings)).toMatchObject({ kind: 'stale', reason: 'both' });
    expect(aiStateFor({ ...metaFor([finding]), headSha: 'head2' }, [finding], settings)).toMatchObject({ kind: 'stale', reason: 'commits' });
  });

  it('leaves another person’s reply, or one in other words, as news', async () => {
    await loadRun();
    const others: RawComment[] = [
      { ...finding, threadAnchors: [{ ...geldReply, author: 'someone-else' }, { anchor: 'discussion_r300', kind: 'thread', author: 'brandonmcconnell', body: 'I disagree, see the other test.' }] },
    ];
    expect(adoptOwnReplies(others, 'brandonmcconnell')).toBeNull();
    expect(triageSuggestions(metaFor(others), DEFAULT_SETTINGS)[0]?.behind).toBe('comments');
  });

  it('commits the reply Geld recorded posting, and only while it stands in the thread', async () => {
    await loadRun();
    await markSuggestionPosted(finding.anchor, { anchor: geldReply.anchor, id: 200 });
    const comments: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    expect(triageSuggestions(metaFor(comments), DEFAULT_SETTINGS)[0]?.behind).toBeNull();
    expect(pendingReplyFor(finding.anchor, comments)).toBe(200);
    expect(pendingReplyFor(finding.anchor, [finding])).toBeNull();
    // The page shows it, its words are taken; edited on GitHub since, it is no longer the fix in Geld's preview.
    await adoptOwnReplies(comments, 'brandonmcconnell');
    expect(pendingReplyFor(finding.anchor, comments)).toBe(200);
    const edited: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, { ...geldReply, body: `${geldReply.body} unwanted();` }] }];
    expect(pendingReplyFor(finding.anchor, edited)).toBeNull();
  });

  it('still finds the fix behind a new commit once Geld has replied in its thread', async () => {
    await loadRun();
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const withReply: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    await adoptOwnReplies(withReply, 'brandonmcconnell');
    // Geld's reply is posted as the reader: the thread is still a bot's finding, and its fix is behind the commit.
    expect(aiStateFor({ ...metaFor(withReply), headSha: 'head2' }, withReply, settings)).toMatchObject({ kind: 'stale', reason: 'commits' });
  });

  it('keeps the TL;DR current over a thread only Geld has written in since', async () => {
    await loadRun();
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const withReply: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    const meta = metaFor(withReply);
    expect(aiStateFor(meta, withReply, settings).kind).toBe('stale');
    await adoptOwnReplies(withReply, 'brandonmcconnell');
    expect(aiStateFor(meta, withReply, settings).kind).toBe('current');
    const answered: RawComment[] = [{ ...withReply[0] ?? finding, threadAnchors: [...(withReply[0]?.threadAnchors ?? []), { anchor: 'discussion_r300', kind: 'thread', author: 'someone-else', body: 'Not this way.' }] }];
    expect(aiStateFor(metaFor(answered), answered, settings).kind).toBe('stale');
  });

  it('names a new commit as well as new comments, since the commit is why the fix is greyed out', async () => {
    await loadRun();
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const answered: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, { anchor: 'discussion_r300', kind: 'thread', author: 'coderabbitai[bot]', body: 'Agreed, the switch is untested.' }] }];
    const pushed = { ...metaFor(answered), headSha: 'head2' };
    expect(aiStateFor(pushed, answered, settings)).toMatchObject({ kind: 'stale', reason: 'both' });
    expect(aiStateFor({ ...metaFor([finding]), headSha: 'head2' }, [finding], settings)).toMatchObject({ kind: 'stale', reason: 'commits' });
  });

  it('leaves another person’s reply, or one in other words, as news', async () => {
    await loadRun();
    const others: RawComment[] = [
      { ...finding, threadAnchors: [{ ...geldReply, author: 'someone-else' }, { anchor: 'discussion_r300', kind: 'thread', author: 'brandonmcconnell', body: 'I disagree, see the other test.' }] },
    ];
    expect(adoptOwnReplies(others, 'brandonmcconnell')).toBeNull();
    expect(triageSuggestions(metaFor(others), DEFAULT_SETTINGS)[0]?.behind).toBe('comments');
  });


  it('keeps the TL;DR when a push makes Geld rewrite a fix in a thread it has replied in', async () => {
    await loadRun();
    stored.set('local:aiKey', 'sk-test');
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
    const comments: RawComment[] = [{ ...finding, threadAnchors: [{ anchor: finding.anchor, kind: 'thread', author: finding.author, body: finding.body }, geldReply] }];
    await adoptOwnReplies(comments, 'brandonmcconnell');
    const pushed = { ...metaFor(comments), headSha: 'head2' };
    sendMessage.mockImplementation(async () => ({ ok: true, model: 'm', text: JSON.stringify({ suggestions: [{ ids: [finding.anchor], summary: 'Toggle in place, again.', replacement: 'render(group(true));' }] }) }));
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
    await runAi(pushed, comments, settings, () => undefined, { pull: { title: 't', description: '' }, target: async () => ({ path: 'src/a.test.ts', start: 174, end: 179, lines }) });
    expect(triageSuggestions(pushed, settings)[0]).toMatchObject({ behind: null, entry: { summary: 'Toggle in place, again.' } });
    expect(withAi(pushed).summary?.tldr).toBe('One finding: test the caret switch.');
    expect(aiStateFor(pushed, comments, settings).kind).toBe('current');
  });
});
