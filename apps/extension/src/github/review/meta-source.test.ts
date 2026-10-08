import { describe, expect, it } from 'vitest';
import type { GeldPrMeta } from '@geld/review';
import { mergeWithCrawler, usableMeta, withLiveRuns } from './meta-source';

function meta(overrides: Partial<GeldPrMeta> = {}): GeldPrMeta {
  return {
    v: 1,
    generatedAt: '2026-09-18T12:00:00.000Z',
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    producer: { kind: 'action', version: '0.1.0', ai: false },
    items: [
      {
        id: 'ri_open',
        title: 'Null check',
        rewritten: false,
        severity: 'bug',
        status: 'open',
        sources: [{ anchor: 'discussion_r1', kind: 'thread', author: 'cursor[bot]', bot: 'bugbot' }],
      },
    ],
    bots: [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', reviewedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', count: 1 }],
    reviewers: [{ login: 'alice', state: 'approved' }],
    fold: { comments: ['issuecomment-9'], events: [] },
    ...overrides,
  };
}

describe('mergeWithCrawler', () => {
  it('keeps payload items and appends crawler items with new anchors', () => {
    const crawled = meta({
      producer: { kind: 'crawler', version: '0.1.0', ai: false },
      items: [
        ...(meta().items),
        {
          id: 'ri_human',
          title: 'Why drop the cache?',
          rewritten: false,
          severity: 'question',
          status: 'open',
          sources: [{ anchor: 'discussion_r4', kind: 'thread', author: 'bob' }],
        },
      ],
      bots: [],
      reviewers: [],
      fold: { comments: ['issuecomment-9', 'issuecomment-10'], events: ['event-1'] },
    });
    const merged = mergeWithCrawler(meta(), crawled);
    expect(merged.items.map((item) => item.id)).toEqual(['ri_open', 'ri_human']);
    expect(merged.bots[0]?.id).toBe('bugbot');
    expect(merged.fold.comments).toEqual(['issuecomment-9', 'issuecomment-10']);
    expect(merged.fold.events).toEqual(['event-1']);
    expect(merged.truncated).toBeUndefined();
  });

  it('keeps truncated when the crawler has nothing extra', () => {
    const merged = mergeWithCrawler(meta({ truncated: true }), meta({ items: meta().items, bots: [], reviewers: [], fold: { comments: [], events: [] } }));
    expect(merged.truncated).toBe(true);
    expect(merged.items).toHaveLength(1);
  });
});

describe('usableMeta', () => {
  it('drops items whose anchors are missing and logs nothing throwable', () => {
    const found = {
      meta: meta({
        items: [
          ...meta().items,
          {
            id: 'ri_ghost',
            title: 'Gone',
            rewritten: false,
            severity: 'nit',
            status: 'open',
            sources: [{ anchor: 'discussion_r999', kind: 'thread', author: 'alice' }],
          },
        ],
        fold: { comments: ['issuecomment-9', 'issuecomment-missing'], events: [] },
      }),
      missingAnchors: ['discussion_r999', 'issuecomment-missing'],
    };
    const usable = usableMeta(found);
    expect(usable.items.map((item) => item.id)).toEqual(['ri_open']);
    expect(usable.fold.comments).toEqual(['issuecomment-9']);
  });
});

describe('withLiveRuns', () => {
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const settled: GeldPrMeta['bots'] = [
    { id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: sha },
    { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings', reviewedSha: sha, count: 2, score: 4 },
  ];

  it('takes a run the page sees now over the verdict the Action wrote earlier', () => {
    // Bugbot's check started after the Action ran: the Action still says clean, the page says running.
    const live: GeldPrMeta['bots'] = [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'running', reviewedSha: sha, checkName: 'Cursor Bugbot' }];
    expect(withLiveRuns(settled, live)).toEqual([live[0], settled[1]]);
  });

  it('adds a bot the Action never saw once the page sees it running, and only then', () => {
    const live: GeldPrMeta['bots'] = [
      { id: 'devin', login: 'devin-ai-integration[bot]', verdict: 'running', reviewedSha: sha },
      { id: 'codex', login: 'chatgpt-codex-connector[bot]', verdict: 'clean', reviewedSha: sha },
    ];
    expect(withLiveRuns(settled, live).map((bot) => bot.id)).toEqual(['bugbot', 'greptile', 'devin']);
  });

  it('ends a run the Action saw running only when the page judged the run against its start', () => {
    const running: GeldPrMeta['bots'] = [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'running', reviewedSha: sha }];
    // A settled verdict the page did not judge (it opened after the check finished, with no start to go by) may be
    // the summary from before this run: the Action's running stands. So does a completed check the page cannot date.
    expect(withLiveRuns(running, [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: sha }])).toEqual(running);
    expect(withLiveRuns(running, [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: sha, checkName: 'Cursor Bugbot' }])).toEqual(running);
    expect(withLiveRuns(running, [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'loading', reviewedSha: sha, checkName: 'Cursor Bugbot', runJudged: true }])).toEqual(running);
    // The page knew when the run began and found the report newer than that (or waited the grace out): that ends it.
    const judged: GeldPrMeta['bots'] = [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: sha, checkName: 'Cursor Bugbot', runJudged: true }];
    expect(withLiveRuns(running, judged)).toEqual(judged);
  });

  it('leaves settled verdicts to the Action', () => {
    const live: GeldPrMeta['bots'] = [{ id: 'greptile', login: 'greptile-apps[bot]', verdict: 'clean', reviewedSha: sha }];
    expect(withLiveRuns(settled, live)).toEqual(settled);
  });
});
