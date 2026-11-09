import { describe, expect, it } from 'vitest';
import { verdictsFrom } from './bots';
import type { BotComment } from './bots';
import { clusterComments, firstSentence } from './cluster';
import type { RawComment } from './cluster';
import { deeplinkFrom, itemThreads, parseGeldPrMeta, threadCounts } from './model';
import type { GeldPrMeta } from './model';
import { renderSummary } from './summary-render';

// prime-envs#1067's shape: Codex, Macroscope (twice) and Bugbot on the same lines of one file merge into one row, while
// each bot's chip counts its own threads. The digest's counts are threads, so they add up to the chips.
const thread = (anchor: string, author: string, line: number, resolved = false): RawComment => ({
  anchor,
  kind: 'thread',
  author,
  body: `Comparison runs omit reference input ${anchor}.`,
  createdAt: '2026-11-08T12:00:00Z',
  path: 'environments/office/gdpval/src/gdpval/taskset.py',
  line,
  isResolved: resolved,
});
const THREADS = [
  thread('discussion_r1', 'chatgpt-codex-connector[bot]', 305),
  thread('discussion_r2', 'macroscopeapp[bot]', 307),
  thread('discussion_r3', 'macroscopeapp[bot]', 307),
  thread('discussion_r4', 'cursor[bot]', 308),
  { ...thread('discussion_r5', 'macroscopeapp[bot]', 32), path: 'environments/office/gdpval/src/gdpval/grader.py' },
];
const HEAD = 'a'.repeat(40);
const meta = (items: GeldPrMeta['items']): GeldPrMeta => ({ v: 1, generatedAt: '2026-11-08T13:00:00Z', headSha: HEAD, producer: { kind: 'action', version: '0.1.0', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] } });

describe('thread counts', () => {
  it("counts a merged row's threads, as the bots' chips do", () => {
    const items = clusterComments(THREADS);
    expect(items).toHaveLength(2);
    const merged = items.find((item) => item.sources.length > 1);
    expect(merged?.threads).toEqual({ total: 4, open: 4 });
    expect(threadCounts(items)).toEqual({ total: 5, open: 5 });
    const chips = verdictsFrom([], THREADS.map((entry): BotComment => ({ author: entry.author, body: entry.body, anchor: entry.anchor, createdAt: entry.createdAt, resolved: entry.isResolved === true })), HEAD);
    expect(chips.reduce((sum, bot) => sum + (bot.count ?? 0), 0)).toBe(threadCounts(items).open);
  });

  it('drops a thread from the count when it is resolved, before the whole row is', () => {
    const one = clusterComments(THREADS.map((entry) => (entry.anchor === 'discussion_r3' ? { ...entry, isResolved: true } : entry)));
    const merged = one.find((item) => item.sources.length > 1);
    expect(merged?.status).toBe('open');
    expect(merged === undefined ? null : itemThreads(merged)).toEqual({ total: 4, open: 3 });
    expect(threadCounts(one)).toEqual({ total: 5, open: 4 });
    const chips = verdictsFrom([], THREADS.map((entry): BotComment => ({ author: entry.author, body: entry.body, anchor: entry.anchor, createdAt: entry.createdAt, resolved: entry.anchor === 'discussion_r3' })), HEAD);
    expect(chips.find((bot) => bot.id === 'macroscope')?.count).toBe(2);
    const all = clusterComments(THREADS.map((entry) => ({ ...entry, isResolved: true })));
    expect(threadCounts(all)).toEqual({ total: 5, open: 0 });
  });

  it('carries the counts through the payload, the summary comment and the deeplink', () => {
    const items = clusterComments(THREADS.map((entry) => (entry.anchor === 'discussion_r2' ? { ...entry, isResolved: true } : entry)));
    const parsed = parseGeldPrMeta(JSON.parse(JSON.stringify(meta(items))));
    expect(parsed.ok && threadCounts(parsed.value.items)).toEqual({ total: 5, open: 4 });
    expect(renderSummary(meta(items))).toContain('**1 of 5 done**');
    expect(deeplinkFrom(meta(items))).toMatchObject({ open: 4, total: 5 });
    // A payload from before the field: one thread per row.
    const older = items.map(({ threads: _threads, ...rest }) => rest);
    expect(threadCounts(older)).toEqual({ total: 2, open: 2 });
  });

  it('reads a score under the repository bar as findings, resolved once its threads are', () => {
    const check = { name: 'Greptile Review', status: 'completed', conclusion: 'failure', sha: HEAD, description: 'Base review: Confidence 3/5 — below your required 5/5' };
    const finding = (resolved: boolean): BotComment => ({ author: 'greptile-apps[bot]', body: 'The retry loop never exits.', anchor: 'discussion_r9', createdAt: '2026-11-08T12:00:00Z', resolved });
    expect(verdictsFrom([check], [finding(false)], HEAD)[0]).toMatchObject({ verdict: 'findings', count: 1 });
    expect(verdictsFrom([check], [finding(true)], HEAD)[0]).toMatchObject({ verdict: 'findings', count: 0 });
    expect(verdictsFrom([{ ...check, description: 'Base review' }], [finding(true)], HEAD)[0]?.verdict).toBe('failed');
  });

  it("titles Codex's raw thread by its words, not its badge", () => {
    expect(firstSentence('**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Resolve reference paths before creating comparison symlinks**\n\nWhen `root` is relative…')).toBe('**Resolve reference paths before creating comparison symlinks**');
    expect(firstSentence('Use `Map<string, number>` here. Then.')).toBe('Use `Map<string, number>` here.');
  });
});
