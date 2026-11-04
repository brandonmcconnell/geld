import { describe, expect, it } from 'vitest';
import { verdictsFrom } from '@geld/review';
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

  it("ends a saved run the bot gave up on, with the page's verdict (geld#103)", () => {
    // The Action wrote while CodeRabbit's status was pending; the pull request was then merged mid-run and CodeRabbit
    // rewrote its summary into "Review failed", leaving the status pending for good.
    const saved: GeldPrMeta['bots'] = [{ id: 'coderabbit', login: 'coderabbitai[bot]', verdict: 'running', reviewedSha: sha, checkName: 'CodeRabbit' }];
    const page = verdictsFrom(
      [{ name: 'CodeRabbit', status: 'in_progress', conclusion: null, sha }],
      [{ author: 'coderabbitai[bot]', body: 'Caution\nReview failed\nThe pull request is closed.', anchor: 'issuecomment-1', createdAt: '2026-10-26T20:42:12Z', editedAt: '2026-10-26T21:59:47Z' }],
      sha,
      [],
      Date.parse('2026-10-26T22:10:00Z'),
      { closed: true },
    );
    expect(withLiveRuns(saved, page)).toMatchObject([{ id: 'coderabbit', verdict: 'failed', reason: 'The pull request is closed', runJudged: true }]);
  });

  it('adds a bot the Action never saw once the page sees it running, and only then', () => {
    const live: GeldPrMeta['bots'] = [
      { id: 'devin', login: 'devin-ai-integration[bot]', verdict: 'running', reviewedSha: sha },
      { id: 'codex', login: 'chatgpt-codex-connector[bot]', verdict: 'clean', reviewedSha: sha },
    ];
    expect(withLiveRuns(settled, live).map((bot) => bot.id)).toEqual(['bugbot', 'greptile', 'devin']);
    // ...or with no word: asked after the Action wrote, never answered, and the pull request closed since. The page's
    // `unknown` contradicts nothing the Action knew, and without it the bot had no chip at all.
    const silent: GeldPrMeta['bots'] = [{ id: 'capy', login: 'capy-ai[bot]', verdict: 'unknown', reviewedSha: sha, sourceId: 'issuecomment-7' }];
    expect(withLiveRuns(settled, silent).map((bot) => `${bot.id}:${bot.verdict}`)).toEqual(['bugbot:clean', 'greptile:findings', 'capy:unknown']);
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

  it('takes the page\u2019s count of what is still open once the whole timeline is read', () => {
    // mint#12803: the Action wrote Bugbot's "findings" (its thread open then); the thread was resolved on the page
    // since. With every thread on the page, the page's count stands and the chip turns to "resolved".
    const greptile: GeldPrMeta['bots'][number] = { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings', reviewedSha: sha, count: 2, score: 4 };
    const bugbot: GeldPrMeta['bots'][number] = { id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', reviewedSha: sha, count: 1 };
    const payload: GeldPrMeta['bots'] = [bugbot, greptile];
    const live: GeldPrMeta['bots'] = [
      { id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', reviewedSha: sha, count: 0 },
      { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings', reviewedSha: sha, count: 1, score: 4 },
    ];
    expect(withLiveRuns(payload, live, true)).toEqual([{ ...bugbot, count: 0 }, { ...greptile, count: 1 }]);
    // A payload with no count (the Action read the summary alone) takes the page's count too; the score stays.
    const unscored: GeldPrMeta['bots'][number] = { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings', reviewedSha: sha, score: 4 };
    expect(withLiveRuns([unscored], live, true)).toEqual([{ ...unscored, count: 1 }]);
    // The page's count must be the same run's: hanging on a thread (as above), or on the summary the Action read.
    const summarised: GeldPrMeta['bots'][number] = { ...greptile, sourceId: 'issuecomment-1' };
    expect(withLiveRuns([summarised], [{ ...summarised, count: 1 }], true)).toEqual([{ ...summarised, count: 1 }]);
    // A page verdict on a different summary is a newer report on the same head (the bot ran again): taken whole,
    // not as a new count under the earlier run's score and severity.
    const rerun: GeldPrMeta['bots'][number] = { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings', reviewedSha: sha, count: 1, score: 5, sourceId: 'issuecomment-9' };
    expect(withLiveRuns([{ ...summarised, severity: 'high' }], [rerun], true)).toEqual([rerun]);
    // Not while the timeline is still being read (a thread not loaded yet would count as resolved), and never
    // upward: a count the page has more of than the Action is a run the Action has not written yet.
    expect(withLiveRuns(payload, live)).toEqual(payload);
    expect(withLiveRuns(payload, [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', reviewedSha: sha, count: 3 }], true)).toEqual(payload);
  });
});
