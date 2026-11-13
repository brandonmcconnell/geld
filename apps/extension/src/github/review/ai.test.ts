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

const { adoptOwnReplies, aiStateFor, discardSuggestion, fixFromComments, loadAiForPage, markSuggestionPosted, pendingReplyFor, runAi, triageNoteFor, triageSuggestions, withAi } = await import('./ai');

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

describe('a fix asked for from a chat', () => {
  beforeEach(() => {
    stored.clear();
    sendMessage.mockReset();
  });
  const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://ai-gateway.vercel.sh', aiModel: 'anthropic/claude-sonnet-5' };
  const person: RawComment = { anchor: 'discussion_r500', kind: 'thread', author: 'brandonmcconnell', body: 'Rename `x` to something readable.', createdAt: at, path: 'src/b.ts', line: 3 };
  const review: RawComment = { anchor: 'pullrequestreview-900', kind: 'review', author: 'coderabbitai[bot]', body: 'Outside diff range comments (1): src/c.ts line 12 leaks the handle.', createdAt: at };
  const lines = ['const x = 1;', 'export { x };', 'use(x);', 'end();'];
  const source = { pull: { title: 't', description: '' }, target: async () => ({ path: 'src/b.ts', start: 3, end: 3, lines }) };
  const fresh = async (): Promise<void> => {
    await new Promise<void>((resolve) => loadAiForPage(`github:/o/r/pull/8-${Math.random()}`, resolve));
    await new Promise<void>((resolve) => loadAiForPage('github:/o/r/pull/8', resolve));
    stored.set('local:aiKey', 'sk-test');
  };

  it('writes a fix for a person’s thread the reader asked about, which the triage leaves alone otherwise', async () => {
    await fresh();
    const meta = metaFor([person]);
    sendMessage.mockImplementation(async () => ({ ok: true, model: 'm', text: JSON.stringify({ suggestions: [{ ids: [person.anchor], summary: 'Names it `count`.', replacement: 'use(count);' }] }) }));
    expect(await fixFromComments(meta, [person], settings, () => undefined, source, { threads: [person.anchor], comment: null })).toEqual({ changed: true, failed: false });
    expect(triageSuggestions(meta, settings).map(({ entry }) => [entry.key, entry.replacement])).toEqual([[person.anchor, ['use(count);']]]);
  });

  it('turns what a comment asks for outside its threads into tasks for an agent, replacing that comment’s tasks from before', async () => {
    await fresh();
    const meta = metaFor([review]);
    const answer = (titles: readonly string[]) => async () => ({ ok: true, model: 'm', text: JSON.stringify({ findings: titles.map((title) => ({ title, task: `Fix ${title.toLowerCase()} in \`src/c.ts\`.`, path: 'src/c.ts', line: 12 })) }) });
    sendMessage.mockImplementation(answer(['Handle leaks', 'Docstrings missing']));
    const scope = { threads: [], comment: { anchor: review.anchor, author: review.author, text: review.body, threads: [] } };
    await fixFromComments(meta, [review], settings, () => undefined, source, scope);
    const rows = triageSuggestions(meta, settings);
    expect(rows.map(({ item }) => item.title)).toEqual(['Handle leaks', 'Docstrings missing']);
    expect(rows[0]?.item).toMatchObject({ path: 'src/c.ts', line: 12, sources: [{ anchor: review.anchor, kind: 'review' }] });
    expect(rows[0]?.entry.replacement).toBeNull();
    expect(rows[0] === undefined ? null : triageNoteFor(rows[0].item)).toBe('Fix handle leaks in `src/c.ts`.');
    sendMessage.mockImplementation(answer(['Handle leaks']));
    await fixFromComments(meta, [review], settings, () => undefined, source, scope);
    expect(triageSuggestions(meta, settings).map(({ item }) => item.title)).toEqual(['Handle leaks']);
  });

  it('writes a thread’s fix afresh when asked again, over a current one and a discarded one', async () => {
    await fresh();
    const meta = metaFor([person]);
    const answer = (code: string) => async () => ({ ok: true, model: 'm', text: JSON.stringify({ suggestions: [{ ids: [person.anchor], summary: 'Renames it.', replacement: code }] }) });
    const ask = { threads: [person.anchor], comment: null };
    sendMessage.mockImplementation(answer('use(count);'));
    await fixFromComments(meta, [person], settings, () => undefined, source, ask);
    sendMessage.mockImplementation(answer('use(total);'));
    await fixFromComments(meta, [person], settings, () => undefined, source, ask);
    expect(triageSuggestions(meta, settings)[0]?.entry.replacement).toEqual(['use(total);']);
    await discardSuggestion(person.anchor);
    expect(triageSuggestions(meta, settings)).toEqual([]);
    sendMessage.mockImplementation(answer('use(sum);'));
    await fixFromComments(meta, [person], settings, () => undefined, source, ask);
    expect(triageSuggestions(meta, settings).map(({ entry }) => [entry.state, entry.replacement])).toEqual([['open', ['use(sum);']]]);
  });

  it('keeps the card up for a comment’s tasks on a pull request with no thread open', async () => {
    await fresh();
    const meta = metaFor([review]);
    sendMessage.mockImplementation(async () => ({ ok: true, model: 'm', text: JSON.stringify({ findings: [{ title: 'Handle leaks', task: 'Close it.', path: null, line: null }] }) }));
    expect(aiStateFor(meta, [review], settings).kind).toBe('nothing');
    await fixFromComments(meta, [review], settings, () => undefined, source, { threads: [], comment: { anchor: review.anchor, author: review.author, text: review.body, threads: [] } });
    expect(aiStateFor(meta, [review], settings).kind).not.toBe('nothing');
  });

  it('drops an answer that lands after the reader moved to another pull request', async () => {
    await fresh();
    const meta = metaFor([review]);
    sendMessage.mockImplementation(async () => {
      await new Promise<void>((resolve) => loadAiForPage('github:/o/r/pull/9', resolve));
      return { ok: true, model: 'm', text: JSON.stringify({ findings: [{ title: 'Handle leaks', task: 'Close it.', path: null, line: null }] }) };
    });
    expect(await fixFromComments(meta, [review], settings, () => undefined, source, { threads: [], comment: { anchor: review.anchor, author: review.author, text: review.body, threads: [] } })).toEqual({ changed: false, failed: false });
    expect(triageSuggestions(meta, settings)).toEqual([]);
    expect(stored.get('local:aiRuns')).toBeUndefined();
  });

  it('asks again about every thread a saved fix covers, so a shared fix keeps all of them', async () => {
    const other: RawComment = { anchor: 'discussion_r600', kind: 'thread', author: 'greptile-apps[bot]', body: 'Same rename here.', createdAt: at, path: 'src/b.ts', line: 3 };
    const bot: RawComment = { ...person, author: 'coderabbitai[bot]' };
    stored.set('local:aiRuns', {
      'github:/o/r/pull/8': {
        ranAt: at,
        rewrites: [],
        seen: [bot.anchor, other.anchor],
        suggestions: [{ key: bot.anchor, threads: [bot.anchor, other.anchor], headSha: 'head1', path: 'src/b.ts', start: 3, end: 3, original: ['use(x);'], replacement: ['use(count);'], summary: 'Renames it.', state: 'open', sources: [bot.anchor, other.anchor] }],
      },
    });
    await fresh();
    const meta = metaFor([bot, other]);
    const asked: string[][] = [];
    sendMessage.mockImplementation(async (message: unknown) => {
      const second: unknown = typeof message === 'object' && message !== null && 'messages' in message && Array.isArray(message.messages) ? message.messages[1] : null;
      const user = typeof second === 'object' && second !== null && 'content' in second && typeof second.content === 'string' ? second.content : '';
      if (user !== '') asked.push([...user.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1] ?? ''));
      return { ok: true, model: 'm', text: JSON.stringify({ suggestions: [{ ids: [bot.anchor, other.anchor], summary: 'Renames it.', replacement: 'use(total);' }] }) };
    });
    await fixFromComments(meta, [bot, other], settings, () => undefined, source, { threads: [bot.anchor], comment: null });
    expect(asked).toEqual([[bot.anchor, other.anchor]]);
    expect(triageSuggestions(meta, settings).map(({ entry }) => entry.threads)).toEqual([[bot.anchor, other.anchor]]);
  });
});