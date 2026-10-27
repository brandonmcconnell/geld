import { describe, expect, it } from 'vitest';
import {
  decodeDeeplinkPayload,
  encodeDeeplinkPayload,
  fnv1aHex,
  isAllowedSummaryAuthor,
  itemIdFor,
  openItemCount,
  parseGeldPrMeta,
  truncateMeta,
  type GeldPrMeta,
  type ReviewItem,
} from './model';

const SOURCE = { anchor: 'discussion_r1', kind: 'thread' as const, author: 'alice' };

function item(overrides: Partial<ReviewItem> & Pick<ReviewItem, 'id' | 'status'>): ReviewItem {
  return {
    title: overrides.title ?? overrides.id,
    rewritten: false,
    severity: 'suggestion',
    sources: [SOURCE],
    ...overrides,
  };
}

function meta(overrides: Partial<GeldPrMeta> = {}): GeldPrMeta {
  return {
    v: 1,
    generatedAt: '2026-09-18T12:00:00.000Z',
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    producer: { kind: 'action', version: '0.1.0', ai: false },
    items: [item({ id: 'ri_open', status: 'open', title: 'Missing null check' })],
    bots: [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    reviewers: [{ login: 'alice', state: 'approved' }],
    fold: { comments: ['issuecomment-9'], events: [] },
    ...overrides,
  };
}

describe('parseGeldPrMeta', () => {
  it('accepts a well-formed payload', () => {
    const result = parseGeldPrMeta(meta());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0]?.title).toBe('Missing null check');
  });

  it('rejects a wrong version and unknown anchors', () => {
    expect(parseGeldPrMeta({ ...meta(), v: 2 }).ok).toBe(false);
    expect(parseGeldPrMeta({ ...meta(), items: [{ ...item({ id: 'x', status: 'open' }), sources: [{ ...SOURCE, anchor: 'not-an-anchor' }] }] }).ok).toBe(false);
  });

  it('strips undefined optionals so exactOptionalPropertyTypes stays happy', () => {
    const result = parseGeldPrMeta(meta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('truncated' in result.value).toBe(false);
    expect('path' in (result.value.items[0] ?? {})).toBe(false);
  });
});

describe('item ids and truncation', () => {
  it('hashes sorted anchors stably', () => {
    expect(itemIdFor(['discussion_r2', 'discussion_r1'])).toBe(itemIdFor(['discussion_r1', 'discussion_r2']));
    expect(fnv1aHex('x')).toHaveLength(8);
  });

  it('drops closed items first and flags truncated', () => {
    const fat: GeldPrMeta = meta({
      items: [
        item({ id: 'open', status: 'open', title: 'A'.repeat(200) }),
        item({ id: 'done', status: 'resolved', title: 'B'.repeat(200) }),
      ],
    });
    const small = truncateMeta(fat, JSON.stringify(fat).length - 40);
    expect(small.truncated).toBe(true);
    expect(small.items.every((entry) => entry.status === 'open')).toBe(true);
    expect(openItemCount(small.items)).toBeGreaterThan(0);
  });
});

describe('allowed authors', () => {
  it('only trusts the Action and Geld app logins', () => {
    expect(isAllowedSummaryAuthor('github-actions[bot]')).toBe(true);
    expect(isAllowedSummaryAuthor('geld[bot]')).toBe(true);
    expect(isAllowedSummaryAuthor('alice')).toBe(false);
    expect(isAllowedSummaryAuthor('cursor[bot]')).toBe(false);
  });
});

describe('deeplink payload', () => {
  it('round-trips', () => {
    const encoded = encodeDeeplinkPayload({
      v: 1,
      headSha: 'abcdef0',
      generatedAt: '2026-09-18T12:00:00.000Z',
      open: 3,
      total: 10,
    });
    const decoded = decodeDeeplinkPayload(encoded);
    expect(decoded).toEqual({
      ok: true,
      value: { v: 1, headSha: 'abcdef0', generatedAt: '2026-09-18T12:00:00.000Z', open: 3, total: 10 },
    });
  });
});
