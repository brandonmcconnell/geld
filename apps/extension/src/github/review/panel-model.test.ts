import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@geld/review';
import { authorLabels, botHealth, checkCountsFrom, checksHealth, checksSummary, checksTotal, digestMarkdown, EMPTY_CHECKS, isCurrent, itemMarkdown, requiredReviewsFrom, sortItems, splitItems, verdictLabel, verdictTone } from './panel-model';

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

describe('digestMarkdown', () => {
  it('carries bot verdicts with links and excerpts even without review items', () => {
    const meta = {
      v: 1 as const,
      generatedAt: '2026-09-18T12:00:00.000Z',
      headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      producer: { kind: 'crawler' as const, version: '0.1.0', ai: false },
      items: [],
      bots: [{ id: 'greptile', login: 'greptile-apps[bot]', verdict: 'findings' as const, score: 5, reviewedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sourceId: 'issuecomment-88' }],
      reviewers: [],
      fold: { comments: [], events: [] },
    };
    const md = digestMarkdown(meta, { owner: 'acme', repo: 'widgets', number: 123, origin: 'https://github.com' }, () => false, {
      status: ['CI: 8 successful'],
      excerptFor: () => 'Confidence Score: 5/5. The PR appears safe to merge.',
    });
    expect(md).toContain('## Review digest — acme/widgets#123');
    expect(md).toContain('- CI: 8 successful');
    expect(md).toContain('- ✅ **Greptile 5/5** — [run summary](https://github.com/acme/widgets/pull/123#issuecomment-88)');
    expect(md).toContain('  Confidence Score: 5/5.');
  });
});

describe('status rows', () => {
  it('reads check counts from the merge box headings', () => {
    const counts = checkCountsFrom('1 in progress check\nUnit Tests / test\n3 skipped checks\n8 successful checks\n1 failing check');
    expect(counts).toEqual({ success: 8, failure: 1, queued: 0, pending: 1, skipped: 3, neutral: 0 });
    expect(checksHealth(counts ?? EMPTY_CHECKS)).toBe('bad');
    expect(checkCountsFrom('No checks here')).toBeNull();
    expect(checkCountsFrom('Some checks were not successful\n1 failing, 7 skipped, 59 successful checks')).toEqual({ success: 59, failure: 1, queued: 0, pending: 0, skipped: 7, neutral: 0 });
    // Expanded: the summary sentence and the per-group headings both appear; the sentence alone counts.
    expect(checkCountsFrom('1 failing, 7 skipped, 59 successful checks\n1 failing check\n7 skipped checks\n59 successful checks')).toEqual({ success: 59, failure: 1, queued: 0, pending: 0, skipped: 7, neutral: 0 });
    expect(checkCountsFrom('All checks have passed\n3 successful checks')).toEqual({ success: 3, failure: 0, queued: 0, pending: 0, skipped: 0, neutral: 0 });
    // Block text keeps the sentence apart from the next control ("…checks\nCollapse checks").
    expect(checkCountsFrom('Some checks were not successful\n1 failing, 7 skipped, 59 successful checks\nCollapse checks\n1 failing check\nChecks settings\n7 skipped checks\nSkipped Sep 18, 2026 — not active\n59 successful checks')).toEqual({ success: 59, failure: 1, queued: 0, pending: 0, skipped: 7, neutral: 0 });
    // Expanded with a single state: the heading and the group repeat "3 successful checks".
    expect(checkCountsFrom('All checks have passed\n3 successful checks\n3 successful checks')).toEqual({ success: 3, failure: 0, queued: 0, pending: 0, skipped: 0, neutral: 0 });
  });

  it('keeps pending (not started) apart from in progress, as GitHub counts them', () => {
    // The screenshot case: the section sentence and both group headings, one bucket each.
    const counts = checkCountsFrom("Some checks haven't completed yet\n4 pending, 8 in progress, 7 skipped, 52 successful checks\n4 pending checks\nVercel – dashboard\nWaiting for status to be reported\n8 in progress checks\n7 skipped checks\n52 successful checks");
    expect(counts).toEqual({ success: 52, failure: 0, queued: 4, pending: 8, skipped: 7, neutral: 0 });
    expect(checksTotal(counts ?? EMPTY_CHECKS)).toBe(71);
    expect(checksHealth(counts ?? EMPTY_CHECKS)).toBe('pending');
    expect(checksSummary(counts ?? EMPTY_CHECKS)).toBe('4 pending · 8 in progress · 52 successful · 7 skipped');
  });

  it('reads required reviews', () => {
    expect(requiredReviewsFrom('Review required\nAt least 2 approving reviews are required by reviewers with write access.', [{ login: 'alice', state: 'approved' }])).toEqual({
      required: 2,
      approvals: 1,
      changesRequested: false,
    });
    expect(requiredReviewsFrom('Merging is blocked', [])).toBeNull();
    // Once met, the merge box counts approvals rather than stating the requirement; the requirement seen earlier is kept.
    expect(requiredReviewsFrom('Changes approved\n2 approving reviews by reviewers with write access.', [], { knownRequired: 1 })).toEqual({ required: 1, approvals: 2, changesRequested: false });
    expect(requiredReviewsFrom('Changes approved\n2 approving reviews by reviewers with write access.', [])).toEqual({ required: null, approvals: 2, changesRequested: false });
    // Approvals seen in the timeline count even when the box says nothing yet.
    expect(requiredReviewsFrom('Review required\nAt least 1 approving review is required by reviewers with write access.', [{ login: 'a', state: 'approved' }, { login: 'b', state: 'approved' }])).toEqual({ required: 1, approvals: 2, changesRequested: false });
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
