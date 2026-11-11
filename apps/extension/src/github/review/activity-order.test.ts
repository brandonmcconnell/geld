// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { FoldRow } from './panel';
import { inTimeOrder } from './panel';

const fold = (key: string, at?: string): FoldRow => ({ key, label: key, section: 'activity', count: 1, avatarSrc: null, author: null, firstAnchor: null, time: '', timeAnchor: null, ...(at === undefined ? {} : { at }) });

describe('inTimeOrder', () => {
  it('lists the activity rows oldest first by the moment each shows', () => {
    const rows = [fold('events', '2026-11-09T14:35:06Z'), fold('commits', '2026-11-09T10:26:36Z'), fold('mentions', '2026-11-09T10:27:00Z')];
    expect(inTimeOrder(rows).map((row) => row.key)).toEqual(['commits', 'mentions', 'events']);
  });

  it('keeps a row with no known moment after the others, in its place among them', () => {
    const rows = [fold('misc'), fold('events', '2026-11-09T14:35:06Z'), fold('other'), fold('commits', '2026-11-09T10:26:36Z')];
    expect(inTimeOrder(rows).map((row) => row.key)).toEqual(['commits', 'events', 'misc', 'other']);
  });
});
