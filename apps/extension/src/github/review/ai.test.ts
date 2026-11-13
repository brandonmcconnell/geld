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
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: async () => undefined } } }));

const { adoptOwnReplies, aiStateFor, loadAiForPage, pendingReplyFor, triageSuggestions } = await import('./ai');

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
    const item = meta.items[0];
    expect(item === undefined ? null : pendingReplyFor(finding.anchor, item)).toBe(200);
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

  it('leaves another person’s reply, or one in other words, as news', async () => {
    await loadRun();
    const others: RawComment[] = [
      { ...finding, threadAnchors: [{ ...geldReply, author: 'someone-else' }, { anchor: 'discussion_r300', kind: 'thread', author: 'brandonmcconnell', body: 'I disagree, see the other test.' }] },
    ];
    expect(adoptOwnReplies(others, 'brandonmcconnell')).toBeNull();
    expect(triageSuggestions(metaFor(others), DEFAULT_SETTINGS)[0]?.behind).toBe('comments');
  });

  it('does not take a reply with other lines as the one to commit', async () => {
    await loadRun();
    const stale: RawComment[] = [{ ...finding, threadAnchors: [{ ...geldReply, body: 'Suggested fix from Geld triage: an earlier fix. Suggested change something else' }] }];
    await adoptOwnReplies(stale, 'brandonmcconnell');
    const item = metaFor(stale).items[0];
    expect(item === undefined ? null : pendingReplyFor(finding.anchor, item)).toBeNull();
  });
});
