import { describe, expect, it } from 'vitest';
import type { GeldPrMeta } from '@geld/review';
import { mergeWithCrawler, usableMeta } from './meta-source';

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
