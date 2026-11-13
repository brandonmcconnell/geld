import { describe, expect, it } from 'vitest';
import type { RawComment } from './cluster';
import { clusterComments } from './cluster';
import { applyConsolidation, fixVisible, planConsolidation, summaryIsCurrent, summaryRecord, unthreadedFindings, unthreadedInputs } from './consolidate';
import type { GeldPrMeta } from './model';

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
  const verdict = (count: number | undefined, sourceId = 'pullrequestreview-9'): GeldPrMeta['bots'][number] => ({
    id: 'coderabbit',
    login: 'coderabbitai[bot]',
    verdict: 'findings',
    ...(count === undefined ? {} : { count }),
    reviewedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceId,
  });
  const thread = bot('discussion_r3', 'coderabbitai[bot]', 'Guard the null case.', 12);
  const withBots = (items: GeldPrMeta['items'], bots: GeldPrMeta['bots']): GeldPrMeta => ({ ...metaWith(items), bots });

  it('counts what a bot reports beyond its open threads', () => {
    expect(unthreadedFindings(withBots([], [verdict(2)]))).toEqual([{ id: 'unthreaded:coderabbit@pullrequestreview-9:2', bot: 'coderabbit', login: 'coderabbitai[bot]', count: 2, sourceId: 'pullrequestreview-9' }]);
    expect(unthreadedFindings(withBots(clusterComments([thread]), [verdict(3)]))[0]?.count).toBe(2);
    expect(unthreadedFindings(withBots(clusterComments([thread]), [verdict(1)]))).toEqual([]);
  });

  it('takes findings with no count and no open thread as unthreaded, and leaves resolved or human-review verdicts out', () => {
    expect(unthreadedFindings(withBots([], [verdict(undefined)]))[0]?.count).toBeNull();
    expect(unthreadedFindings(withBots(clusterComments([thread]), [verdict(undefined)]))).toEqual([]);
    expect(unthreadedFindings(withBots([], [verdict(0)]))).toEqual([]);
    expect(unthreadedFindings(withBots([], [{ ...verdict(undefined), needsHuman: true }]))).toEqual([]);
  });

  it('hands the TL;DR the bot’s own review, and makes a TL;DR written before them behind', () => {
    const found = unthreadedFindings(withBots([], [verdict(1)]));
    const review: RawComment = { anchor: 'pullrequestreview-9', kind: 'review', author: 'coderabbitai[bot]', body: '<!-- marker -->Outside diff range comments (1)\n\n`src/a.ts` 10-12: handle the empty list.', createdAt: at };
    expect(unthreadedInputs(found, [review])).toEqual([{ id: found[0]?.id, title: 'CodeRabbit reports 1 finding outside its review threads', severity: 'bug', status: 'open', context: 'Outside diff range comments (1) `src/a.ts` 10-12: handle the empty list.' }]);
    const before = summaryRecord('Nothing open.', [], at);
    expect(summaryIsCurrent(before, [], found)).toBe(false);
    expect(summaryIsCurrent(summaryRecord('One finding outside the diff.', [], at, found), [], found)).toBe(true);
  });
});
