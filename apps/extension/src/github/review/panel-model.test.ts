import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@geld/review';
import { authorLabels, botHealth, checkCountsFrom, checksHealth, checksSummary, checksTotal, digestMarkdown, EMPTY_CHECKS, isCurrent, itemMarkdown, newerSummaryAnchor, requiredReviewsFrom, sortItems, splitItems, standingReviewers, verdictLabel, verdictTone } from './panel-model';

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

  it('leads from an older run summary to the bot\u2019s newer one, and nowhere else', () => {
    const facts = new Map([
      ['issuecomment-1', { summary: true, createdAt: '2026-10-01T10:00:00Z' }],
      ['issuecomment-2', { summary: true, createdAt: '2026-10-02T10:00:00Z' }],
      ['issuecomment-3', { summary: false, createdAt: '2026-10-03T10:00:00Z' }],
    ]);
    // A review body per run: the first run's leads to the second's.
    expect(newerSummaryAnchor('issuecomment-2', 'issuecomment-1', facts)).toBe('issuecomment-2');
    // The current one is the latest: Rerun, not "See latest".
    expect(newerSummaryAnchor('issuecomment-2', 'issuecomment-2', facts)).toBeNull();
    // The verdict hanging on a status line ("reviewing…") or a thread is not a word to lead to.
    expect(newerSummaryAnchor('issuecomment-3', 'issuecomment-1', facts)).toBeNull();
    expect(newerSummaryAnchor('discussion_r9', 'issuecomment-1', facts)).toBeNull();
    // No verdict yet, or the "current" word is in fact older than this comment.
    expect(newerSummaryAnchor(undefined, 'issuecomment-1', facts)).toBeNull();
    expect(newerSummaryAnchor('issuecomment-1', 'issuecomment-2', facts)).toBeNull();
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
    // A reviewer asked again keeps the verdict they gave (mintlify/mint#12495: the sidebar awaits brandonmcconnell,
    // the box still reads "1 approval"); the count agrees with the heading's groups, and so does the warning for a
    // reviewer who requested changes and was asked again — GitHub still holds that against the merge.
    expect(requiredReviewsFrom('Changes approved\n1 approving review by reviewers with write access.\n1 approval\n1 pending review', [{ login: 'brandonmcconnell', state: 'approved' }])).toEqual({ required: null, approvals: 1, changesRequested: false });
    expect(requiredReviewsFrom('Review required\n1 pending review', [{ login: 'kyle', state: 'changes_requested' }])).toEqual({ required: 1, approvals: 0, changesRequested: true });
  });

  it('counts the verdicts that stand: a re-request keeps one, a dismissal takes it away for good', () => {
    const approved = { login: 'brandonmcconnell', state: 'approved' as const };
    // mintlify/mint#12495: approved, then asked again. The sidebar states no verdict (it awaits him); the
    // timeline's approval stands and counts.
    expect(standingReviewers({ sidebar: [{ login: 'brandonmcconnell', verdict: null, awaiting: true }], timeline: [approved], onTimeline: ['brandonmcconnell'], payload: [] })).toEqual([approved]);
    // The sidebar's stated verdict is final; the timeline's and the payload's add only reviewers it does not state.
    expect(standingReviewers({ sidebar: [{ login: 'Ana', verdict: 'approved', awaiting: false }], timeline: [{ login: 'ana', state: 'commented' }, { login: 'max', state: 'changes_requested' }], onTimeline: ['ana', 'max'], payload: [{ login: 'zoe', state: 'approved' }, { login: 'max', state: 'approved' }] })).toEqual([
      { login: 'Ana', state: 'approved' },
      { login: 'max', state: 'changes_requested' },
      { login: 'zoe', state: 'approved' },
    ]);
    // A push dismissed the approval and he was asked again: the timeline has his reviews but no verdict (the
    // dismissal took it), the sidebar awaits him, and a stale payload still says approved. Nothing stands.
    expect(standingReviewers({ sidebar: [{ login: 'brandonmcconnell', verdict: null, awaiting: true }], timeline: [], onTimeline: ['brandonmcconnell'], payload: [approved] })).toEqual([]);
    // The payload speaks only for reviewers the page has not read at all.
    expect(standingReviewers({ sidebar: [], timeline: [], onTimeline: [], payload: [approved] })).toEqual([approved]);
  });

  it('grades bots', () => {
    const base = { id: 'greptile', login: 'greptile-apps[bot]', reviewedSha: 'aaa' } as const;
    expect(botHealth({ ...base, verdict: 'findings', score: 5 })).toBe('good');
    expect(botHealth({ ...base, verdict: 'findings', score: 4 })).toBe('warn');
    expect(botHealth({ ...base, verdict: 'findings', score: 2 })).toBe('bad');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'findings', count: 1, severity: 'high' })).toBe('bad');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'clean' })).toBe('good');
    // A low score is a failure (red X); a run the bot refused is a warning (amber triangle); a run that broke is a failure.
    expect(botHealth({ ...base, verdict: 'findings', score: 1 })).toBe('bad');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'failed', reason: 'Bugbot is disabled for this repository' })).toBe('warn');
    expect(botHealth({ ...base, id: 'bugbot', verdict: 'failed' })).toBe('bad');
    // Findings whose threads are all resolved: nothing outstanding.
    const resolved = { ...base, verdict: 'findings', count: 0 } as const;
    expect(botHealth(resolved)).toBe('good');
    expect(verdictLabel(resolved)).toBe('Greptile resolved');
    // A scored run: the score always, the open count while threads are open.
    expect(verdictLabel({ ...base, verdict: 'findings', score: 4, count: 1 })).toBe('Greptile 4/5 · 1 issue');
    expect(verdictLabel({ ...base, verdict: 'findings', score: 4, count: 0 })).toBe('Greptile 4/5');
    expect(verdictLabel({ ...base, verdict: 'clean', score: 5 })).toBe('Greptile 5/5');
    expect(verdictLabel({ ...base, id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', count: 2 })).toBe('Bugbot 2 issues');
    expect(verdictTone(resolved)).toBe('success');
  });
});

describe('reviewer groups', () => {
  it('keeps a verdict standing beside a request to review again', async () => {
    const { reviewerGroups } = await import('./panel');
    const line = (author: string, state: 'awaiting' | 'changes_requested' | 'approved' | 'commented') => ({ anchor: `${state}:${author}`, author, avatarSrc: null, state, preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null }) as const;
    // The sidebar's awaited reviewers come first, the timeline's verdicts after, oldest first. Kyle requested
    // changes and was asked again: GitHub still holds his verdict against the merge, and still awaits him, so
    // he is in both groups — as the merge box puts it, "changes requested, 1 pending review".
    const groups = reviewerGroups([line('kyle', 'awaiting'), line('kyle', 'changes_requested'), line('ana', 'approved'), line('ana', 'commented')]);
    expect(groups.map((group) => [group.state, group.reviewers.map((reviewer) => reviewer.login)])).toEqual([
      ['approved', ['ana']],
      ['changes_requested', ['kyle']],
      ['awaiting', ['kyle']],
    ]);
  });

  it("shows an approval the sidebar no longer names once the reviewer was asked again", async () => {
    const { reviewerGroups } = await import('./panel');
    const line = (author: string, state: 'awaiting' | 'changes_requested' | 'approved' | 'commented') => ({ anchor: `${state}:${author}`, author, avatarSrc: null, state, preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null }) as const;
    // mintlify/mint#12495: brandonmcconnell approved, then re-requested his own review. The sidebar says only
    // "Awaiting requested review from brandonmcconnell"; the merge box says "Changes approved · 1 approval, 1
    // pending review". The approval is the timeline's; the request the sidebar's; both show.
    const sidebar = [{ login: 'brandonmcconnell', avatarSrc: 'https://avatars.githubusercontent.com/u/5913254?s=80&v=4', state: 'awaiting' as const, bot: false }];
    const groups = reviewerGroups([line('brandonmcconnell', 'approved')], sidebar);
    expect(groups.map((group) => [group.state, group.reviewers.map((reviewer) => reviewer.login)])).toEqual([
      ['approved', ['brandonmcconnell']],
      ['awaiting', ['brandonmcconnell']],
    ]);
    // Dismissed by GitHub (a push under "dismiss stale approvals"): nothing stands, only the request.
    const dismissed = [{ login: 'brandonmcconnell', avatarSrc: null, state: 'dismissed' as const, bot: false }, ...sidebar];
    expect(reviewerGroups([line('brandonmcconnell', 'approved')], dismissed).map((group) => group.state)).toEqual(['awaiting']);
  });

  it("takes the sidebar's word on a reviewer over the timeline's, and the timeline's for anyone else", async () => {
    const { reviewerGroups } = await import('./panel');
    const line = (author: string, state: 'awaiting' | 'changes_requested' | 'approved' | 'commented') => ({ anchor: `${state}:${author}`, author, avatarSrc: null, state, preview: '', time: '', hasBody: false, done: false, replies: 0, myReaction: null }) as const;
    // The timeline has only ana's early comment so far (her approval sits behind "Load more"); the sidebar already
    // says she approved. Kyle's dismissed review is nobody's verdict. Bots belong to their own row. Max is the
    // timeline's alone.
    const sidebar = [
      { login: 'Ana', avatarSrc: 'https://avatars.githubusercontent.com/u/1?s=80&v=4', state: 'approved' as const, bot: false },
      { login: 'kyle', avatarSrc: null, state: 'dismissed' as const, bot: false },
      { login: 'cursor[bot]', avatarSrc: null, state: 'commented' as const, bot: true },
    ];
    const groups = reviewerGroups([line('ana', 'commented'), line('kyle', 'approved'), line('max', 'changes_requested')], sidebar);
    expect(groups.map((group) => [group.state, group.reviewers.map((reviewer) => `${reviewer.login}|${reviewer.src}`)])).toEqual([
      ['approved', ['Ana|https://avatars.githubusercontent.com/u/1?s=80&v=4']],
      ['changes_requested', ['max|']],
    ]);
  });
});
