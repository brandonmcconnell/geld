import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@geld/review';
import { authorLabels, botHealth, checkCountsFrom, checksHealth, EMPTY_CHECKS, isCurrent, itemMarkdown, requiredReviewsFrom, sortItems, splitItems, verdictLabel, verdictTone } from './panel-model';

function item(id: string, status: ReviewItem['status']): ReviewItem {
  return { id, title: id, rewritten: false, severity: 'suggestion', status, sources: [{ anchor: 'discussion_r1', kind: 'thread', author: 'alice' }] };
}

describe('panel model', () => {
  it('puts needs-reply first and done last', () => {
    const sorted = sortItems([item('a', 'resolved'), item('b', 'open'), item('c', 'needs-reply'), item('d', 'addressed')]);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'd', 'a']);
    const split = splitItems(sorted);
    expect(split.open.map((entry) => entry.id)).toEqual(['c', 'b', 'd']);
    expect(split.done.map((entry) => entry.id)).toEqual(['a']);
  });

  it('describes verdicts with the bot product name', () => {
    const greptile = { id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings' as const, score: 4, reviewedSha: 'aaa' };
    expect(verdictLabel(greptile)).toBe('Greptile 4/5');
    expect(verdictTone(greptile)).toBe('attention');
    expect(verdictLabel({ id: 'bugbot', login: 'cursor[bot]', verdict: 'clean', reviewedSha: 'aaa' })).toBe('Bugbot clean');
    expect(isCurrent(greptile, 'aaab')).toBe(true);
    expect(isCurrent(greptile, 'bbb')).toBe(false);
  });

  it('renders an item as Markdown with absolute source links and an optional fix', () => {
    const entry: ReviewItem = {
      ...item('x', 'open'),
      title: 'Guard parseDiff against null',
      path: 'src/diff.ts',
      line: 42,
      context: 'Throws on null input.',
      fix: { text: 'if (input === null) return [];', source: 'ai' },
      sources: [{ anchor: 'discussion_r1', kind: 'thread', author: 'cursor[bot]', bot: 'bugbot' }],
    };
    const subject = { owner: 'acme', repo: 'widgets', number: 123, origin: 'https://github.com' };
    const md = itemMarkdown(entry, subject, true);
    expect(md).toContain('- [ ] **Guard parseDiff against null** `src/diff.ts:42` — Bugbot');
    expect(md).toContain('  Throws on null input.');
    expect(md).toContain('```suggestion');
    expect(md).toContain('[bugbot](https://github.com/acme/widgets/pull/123#discussion_r1)');
    expect(itemMarkdown(entry, subject, false)).not.toContain('suggestion');
  });

  it('lists distinct authors, bots by title', () => {
    const merged: ReviewItem = {
      ...item('x', 'open'),
      sources: [
        { anchor: 'discussion_r1', kind: 'thread', author: 'cursor[bot]', bot: 'bugbot' },
        { anchor: 'discussion_r2', kind: 'thread', author: 'cursor[bot]', bot: 'bugbot' },
        { anchor: 'discussion_r3', kind: 'thread', author: 'alice' },
      ],
    };
    expect(authorLabels(merged)).toEqual(['Bugbot', 'alice']);
  });
});

describe('status rows', () => {
  it('reads check counts from the merge box headings', () => {
    const counts = checkCountsFrom('1 in progress check\nUnit Tests / test\n3 skipped checks\n8 successful checks\n1 failing check');
    expect(counts).toEqual({ success: 8, failure: 1, pending: 1, skipped: 3, neutral: 0 });
    expect(checksHealth(counts ?? EMPTY_CHECKS)).toBe('bad');
    expect(checkCountsFrom('No checks here')).toBeNull();
  });

  it('reads required reviews', () => {
    expect(requiredReviewsFrom('Review required\nAt least 2 approving reviews are required by reviewers with write access.', [{ login: 'alice', state: 'approved' }])).toEqual({
      required: 2,
      approvals: 1,
      changesRequested: false,
    });
    expect(requiredReviewsFrom('Merging is blocked', [])).toBeNull();
  });

  it('grades bots', () => {
    const base = { id: 'greptile', login: 'greptile-apps[bot]', reviewedSha: 'aaa' } as const;
    expect(botHealth({ ...base, verdict: 'findings', score: 5 })).toBe('good');
    expect(botHealth({ ...base, verdict: 'findings', score: 4 })).toBe('warn');
    expect(botHealth({ ...base, verdict: 'findings', score: 2 })).toBe('bad');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'findings', count: 1, severity: 'high' })).toBe('bad');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'clean' })).toBe('good');
  });
});
