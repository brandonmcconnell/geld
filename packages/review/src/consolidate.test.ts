import { describe, expect, it } from 'vitest';
import type { RawComment } from './cluster';
import { clusterComments } from './cluster';
import { applyConsolidation, fixVisible, planConsolidation, summaryIsCurrent, summaryRecord, unthreadedFindings, unthreadedInputs } from './consolidate';
import type { GeldPrMeta } from './model';
import { unthreadedExcerpt } from './bots';

const at = '2026-09-18T10:00:00.000Z';

function bot(anchor: string, author: string, body: string, line: number): RawComment {
  return { anchor, kind: 'thread', author, body, createdAt: at, path: 'src/diff.ts', line };
}

function metaWith(items: GeldPrMeta['items']): GeldPrMeta {
  return {
    v: 1,
    generatedAt: at,
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    producer: { kind: 'action', version: '0.1.0', ai: true },
    items,
    bots: [],
    reviewers: [],
    fold: { comments: [], events: [] },
  };
}

describe('planConsolidation', () => {
  const first = [bot('discussion_r1', 'greptile-apps[bot]', 'Null check missing in parseDiff.', 42)];
  const firstItems = clusterComments(first);

  it('asks about every bot-only open item on the first pass, never about people', () => {
    const comments = [...first, bot('discussion_r9', 'bob', 'Why drop the cache?', 90)];
    const plan = planConsolidation(null, clusterComments(comments), { comments });
    expect(plan.pending.map((entry) => entry.sources)).toEqual([['discussion_r1']]);
    expect(plan.pending[0]?.excerpts[0]).toContain('greptile: Null check missing');
    expect(plan.carried.size).toBe(0);
  });

  it('carries an unchanged item and re-asks a grown one with the previous wording', () => {
    const summarised = applyConsolidation(firstItems, new Map(), [{ id: firstItems[0]?.id ?? '', title: 'Guard parseDiff against null', context: 'Throws on null input.' }]);
    const previous = metaWith(summarised);

    const unchanged = planConsolidation(previous, clusterComments(first), { comments: first });
    expect(unchanged.pending).toEqual([]);
    expect(unchanged.carried.get(firstItems[0]?.id ?? '')?.title).toBe('Guard parseDiff against null');

    // A second bot answering in the same thread: the item gains a source.
    const reply = { anchor: 'discussion_r2', kind: 'thread' as const, author: 'cursor[bot]', body: 'parseDiff(null) throws; add a guard.' };
    const opener = bot('discussion_r1', 'greptile-apps[bot]', 'Null check missing in parseDiff.', 42);
    const grownComments: RawComment[] = [{ ...opener, threadAnchors: [{ anchor: opener.anchor, kind: 'thread', author: opener.author, body: opener.body }, reply] }];
    const grownItems = clusterComments(grownComments);
    expect(grownItems).toHaveLength(1);
    const grown = planConsolidation(previous, grownItems, { comments: grownComments, wantFix: true });
    expect(grown.carried.size).toBe(0);
    expect(grown.pending[0]?.previousTitle).toBe('Guard parseDiff against null');
    expect(grown.pending[0]?.previousContext).toBe('Throws on null input.');
    expect(grown.pending[0]?.wantFix).toBe(true);
    expect(grown.pending[0]?.excerpts).toHaveLength(2);
  });

  it('does not ask again about an item the last run saw and left as reported, until a new comment joins it', () => {
    const seen = new Set(['discussion_r1']);
    expect(planConsolidation(null, firstItems, { comments: first, seen }).pending).toEqual([]);
    const reply = { anchor: 'discussion_r2', kind: 'thread' as const, author: 'cursor[bot]', body: 'Still throws.' };
    const opener = bot('discussion_r1', 'greptile-apps[bot]', 'Null check missing in parseDiff.', 42);
    const grownComments: RawComment[] = [{ ...opener, threadAnchors: [{ anchor: opener.anchor, kind: 'thread', author: opener.author, body: opener.body }, reply] }];
    expect(planConsolidation(null, clusterComments(grownComments), { comments: grownComments, seen }).pending).toHaveLength(1);
  });

  it('applies model fixes only where no bot fix exists', () => {
    const withBotFix = clusterComments([bot('discussion_r5', 'coderabbitai[bot]', 'Use const.\n```suggestion\nconst x = 1;\n```', 5)]);
    const applied = applyConsolidation(withBotFix, new Map(), [{ id: withBotFix[0]?.id ?? '', title: 'Use const', fix: 'let → const' }]);
    expect(applied[0]?.fix).toEqual({ text: 'const x = 1;', source: 'bot' });
    expect(fixVisible(applied[0]?.fix, 'bots')).toBe(true);
    expect(fixVisible(applied[0]?.fix, 'ai')).toBe(false);
    expect(fixVisible({ text: 'x', source: 'ai' }, 'all')).toBe(true);
    expect(fixVisible({ text: 'x', source: 'ai' }, 'off')).toBe(false);
  });
});

describe('summary freshness', () => {
  it('is current only for the same set of open items', () => {
    const items = clusterComments([bot('discussion_r1', 'cursor[bot]', 'A', 1), bot('discussion_r7', 'cursor[bot]', 'B', 70)]);
    const summary = summaryRecord('Two bot findings, both open.', items, at);
    expect(summaryIsCurrent(summary, items)).toBe(true);
    expect(summaryIsCurrent(summary, items.slice(0, 1))).toBe(false);
    expect(summaryIsCurrent(undefined, items)).toBe(false);
  });
});

describe('findings outside review threads', () => {
  const verdict = (unthreaded: number | null, digest = 'd1'): GeldPrMeta['bots'][number] => ({
    id: 'coderabbit',
    login: 'coderabbitai[bot]',
    verdict: 'findings',
    count: 3,
    reviewedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceId: 'discussion_r3',
    ...(unthreaded === null ? {} : { unthreaded: { count: unthreaded, sourceId: 'pullrequestreview-9', digest } }),
  });
  const withBots = (bots: GeldPrMeta['bots']): GeldPrMeta => ({ ...metaWith([]), bots });

  it('reads them from the review that holds them, not from the threads in view', () => {
    // A count of 3 over no item in view (a capped list, threads marked done) is no finding outside threads by itself.
    expect(unthreadedFindings(withBots([verdict(null)]))).toEqual([]);
    expect(unthreadedFindings(withBots([verdict(2)]))).toEqual([{ id: 'unthreaded:coderabbit@pullrequestreview-9:2:d1', bot: 'coderabbit', login: 'coderabbitai[bot]', count: 2, sourceId: 'pullrequestreview-9' }]);
    expect(unthreadedFindings(withBots([{ ...verdict(2), verdict: 'clean' }]))).toEqual([]);
  });

  it('hands the TL;DR the sections that hold them, however long the review, and keys it to the review’s words', () => {
    const found = unthreadedFindings(withBots([verdict(1)]));
    const inline = `${'Inline detail about another comment. '.repeat(200)}`;
    const body = `<!-- marker -->**Actionable comments posted: 2** ${inline}\n\nOutside diff range comments (1)\n\n\`src/a.ts\` 10-12: handle the empty list.\n\nNitpick comments (3)\n\nRename x.`;
    const review: RawComment = { anchor: 'pullrequestreview-9', kind: 'review', author: 'coderabbitai[bot]', body, createdAt: at };
    const reply: RawComment = { anchor: 'issuecomment-12', kind: 'comment', author: 'coderabbitai[bot]', body: 'No further change is needed.', createdAt: '2026-09-19T10:00:00.000Z' };
    expect(unthreadedInputs(found, [review, reply])).toEqual([{ id: found[0]?.id, title: 'CodeRabbit reports 1 finding outside its review threads', severity: 'bug', status: 'open', context: 'Outside diff range comments (1) `src/a.ts` 10-12: handle the empty list.' }]);
    const before = summaryRecord('Nothing open.', [], at);
    expect(summaryIsCurrent(before, [], found)).toBe(false);
    expect(summaryIsCurrent(summaryRecord('One finding outside the diff.', [], at, found), [], found)).toBe(true);
    // The same count in a rewritten review is a new reading.
    expect(summaryIsCurrent(summaryRecord('One finding outside the diff.', [], at, found), [], unthreadedFindings(withBots([verdict(1, 'd2')])))).toBe(false);
  });

  it('cuts out the outside-diff comments and failed checks, wherever they stand in the review', () => {
    const prompt = `Prompt to fix all issues\n\n${'Inline comment detail. '.repeat(300)}\nFailed pre-merge checks:\n- Docstring Coverage:\n  Write docstrings.\nAfter applying the fix, run the tests.`;
    expect(unthreadedExcerpt(prompt)).toBe('Failed pre-merge checks:\n- Docstring Coverage:\n  Write docstrings.');
    expect(unthreadedExcerpt('Actionable comments posted: 1')).toBe('');
    // A finding's own words are no section heading: the rest of the outside-diff comments stay in.
    const outside = '> **⚠️ Outside diff range comments (2)**\n> `a.ts` 3: Preserve review details when rebuilding the page.\n> `b.ts` 9: Additional comments (in code) should be kept.\n\n<summary>🧹 Nitpick comments (1)</summary>\nRename x.\n\n<summary>📜 Review details</summary>';
    expect(unthreadedExcerpt(outside)).toBe('Outside diff range comments (2)**\n> `a.ts` 3: Preserve review details when rebuilding the page.\n> `b.ts` 9: Additional comments (in code) should be kept.');
  });
});
