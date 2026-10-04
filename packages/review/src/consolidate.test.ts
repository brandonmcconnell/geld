import { describe, expect, it } from 'vitest';
import type { RawComment } from './cluster';
import { clusterComments } from './cluster';
import { applyConsolidation, fixVisible, planConsolidation, summaryIsCurrent, summaryRecord } from './consolidate';
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

    const grownComments = [...first, bot('discussion_r2', 'cursor[bot]', 'parseDiff(null) throws; add a guard.', 44)];
    const grownItems = clusterComments(grownComments);
    expect(grownItems).toHaveLength(1);
    const grown = planConsolidation(previous, grownItems, { comments: grownComments, wantFix: true });
    expect(grown.carried.size).toBe(0);
    expect(grown.pending[0]?.previousTitle).toBe('Guard parseDiff against null');
    expect(grown.pending[0]?.previousContext).toBe('Throws on null input.');
    expect(grown.pending[0]?.wantFix).toBe(true);
    expect(grown.pending[0]?.excerpts).toHaveLength(2);
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
