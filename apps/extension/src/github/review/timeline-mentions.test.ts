// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTimelinePage, parseTimelineMentions, resetTimelineMentions, timelineMentionsFor } from './timeline-mentions';

// Trimmed from `page_data/timeline` on brandonmcconnell/geld#486 (Nov 2026).
const page = {
  items: [
    { id: 'IssueEvent_1', type: 'TIMELINE_ITEM_TYPE_ISSUE_EVENT', timestamp: '2026-11-07T23:12:53Z', additionalInfo: { issueEvent: { eventType: 'merged' } } },
    {
      id: 'CrossReference_20551667639',
      type: 'TIMELINE_ITEM_TYPE_CROSS_REFERENCE',
      timestamp: '2026-11-07T22:18:35Z',
      user: { id: '5913254', displayLogin: 'brandonmcconnell', avatarUrl: 'https://avatars.githubusercontent.com/u/5913254?v=4', userType: 'USER_TYPE_HUMAN' },
      additionalInfo: { crossReference: { sourceType: 'PullRequest', sourceNumber: 493, sourceTitle: 'Overview: merge button for stacked pull requests', sourceUrl: '/brandonmcconnell/geld/pull/493', sourceRepositoryNameWithOwner: 'brandonmcconnell/geld', sourceState: 'MERGED', sourceIsDraft: false } },
    },
    {
      id: 'CrossReference_2',
      type: 'TIMELINE_ITEM_TYPE_CROSS_REFERENCE',
      timestamp: '2026-11-07T21:59:01Z',
      user: { displayLogin: 'coderabbitai[bot]', avatarUrl: 'https://avatars.githubusercontent.com/in/347564?v=4', userType: 'USER_TYPE_BOT' },
      additionalInfo: { crossReference: { sourceType: 'PullRequest', sourceNumber: 480, sourceTitle: 'Status menu', sourceUrl: '/brandonmcconnell/geld/pull/480', sourceRepositoryNameWithOwner: 'brandonmcconnell/geld', sourceState: 'OPEN', sourceIsDraft: true } },
    },
    {
      id: 'CrossReference_3',
      type: 'TIMELINE_ITEM_TYPE_CROSS_REFERENCE',
      timestamp: '2026-11-06T10:00:00Z',
      user: { displayLogin: 'someone', avatarUrl: '', userType: 'USER_TYPE_HUMAN' },
      additionalInfo: { crossReference: { sourceType: 'Issue', sourceNumber: 12, sourceTitle: 'A bug', sourceUrl: '/o/r/issues/12', sourceRepositoryNameWithOwner: 'o/r', sourceState: 'CLOSED' } },
    },
  ],
};

describe('parseTimelineMentions', () => {
  it('reads each cross-reference as the pull request or issue that mentioned this one, and who did', () => {
    expect(parseTimelineMentions(page)).toEqual([
      { href: '/brandonmcconnell/geld/pull/493', ref: 'brandonmcconnell/geld#493', title: 'Overview: merge button for stacked pull requests', state: 'merged', login: 'brandonmcconnell', avatarUrl: 'https://avatars.githubusercontent.com/u/5913254?v=4', bot: false, at: '2026-11-07T22:18:35Z' },
      { href: '/brandonmcconnell/geld/pull/480', ref: 'brandonmcconnell/geld#480', title: 'Status menu', state: 'draft', login: 'coderabbitai[bot]', avatarUrl: 'https://avatars.githubusercontent.com/in/347564?v=4', bot: true, at: '2026-11-07T21:59:01Z' },
      { href: '/o/r/issues/12', ref: 'o/r#12', title: 'A bug', state: 'issue-closed', login: 'someone', avatarUrl: '', bot: false, at: '2026-11-06T10:00:00Z' },
    ]);
  });

  it('reads nothing from an answer that is not a timeline page', () => {
    expect(parseTimelineMentions(null)).toEqual([]);
    expect(parseTimelineMentions({ items: 'no' })).toEqual([]);
  });
});

describe('nextTimelinePage', () => {
  it('follows GitHub’s Link header to the next page, and stops on the last', () => {
    expect(nextTimelinePage('</brandonmcconnell/geld/pull/486/page_data/timeline?after=Y3Vy%3D&per_page=25>; rel="next"')).toBe('/brandonmcconnell/geld/pull/486/page_data/timeline?after=Y3Vy%3D&per_page=25');
    expect(nextTimelinePage('</x?page=1>; rel="prev"')).toBeNull();
    expect(nextTimelinePage(null)).toBeNull();
  });
});

describe('timelineMentionsFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetTimelineMentions();
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('keeps the last complete reading when a refresh fails on a later page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const second = { ...page, items: page.items.slice(2, 3) };
    let failSecond = false;
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('after=')) return failSecond ? new Response('busy', { status: 503 }) : new Response(JSON.stringify(second), { status: 200 });
      return new Response(JSON.stringify({ items: page.items.slice(0, 2) }), { status: 200, headers: { Link: '</o/r/pull/1/page_data/timeline?after=x>; rel="next"' } });
    });
    const landed = vi.fn();
    expect(timelineMentionsFor('/o/r/pull/1', landed)).toBeNull();
    await settle();
    expect(timelineMentionsFor('/o/r/pull/1', landed)?.map((mention) => mention.ref)).toEqual(['brandonmcconnell/geld#493', 'brandonmcconnell/geld#480']);
    failSecond = true;
    vi.setSystemTime(Date.now() + 6 * 60_000);
    timelineMentionsFor('/o/r/pull/1', landed);
    await settle();
    expect(timelineMentionsFor('/o/r/pull/1', landed)?.length).toBe(2);
    expect(landed).toHaveBeenCalledTimes(1);
  });
});
