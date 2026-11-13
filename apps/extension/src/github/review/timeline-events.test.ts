import { describe, expect, it } from 'vitest';
import { eventState, eventText, eventWords, parseTimelineEvents, type EventBranches, type TimelineEvent } from './timeline-events';

const user = { displayLogin: 'sandy081', avatarUrl: 'https://avatars.githubusercontent.com/u/10746682?v=4', userType: 'USER_TYPE_HUMAN' };
const event = (id: string, timestamp: string, issueEvent: Record<string, unknown>, who: Record<string, unknown> = user): Record<string, unknown> => ({ id, type: 'TIMELINE_ITEM_TYPE_ISSUE_EVENT', timestamp, user: who, additionalInfo: { issueEvent } });

// Trimmed from `page_data/timeline` on microsoft/vscode#343264 and brandonmcconnell/geld#669 (Nov 2026).
const page = {
  items: [
    event('IssueEvent_1', '2026-10-21T16:33:46Z', { eventType: 'review_requested', reviewerLogin: 'Copilot', reviewEffortLevel: 'medium' }),
    event('IssueEvent_2', '2026-10-21T16:33:51Z', { eventType: 'assigned', assigneeLogin: 'sandy081' }),
    event('IssueEvent_3', '2026-10-21T17:31:17Z', { eventType: 'head_ref_force_pushed', beforeCommitOid: '47ff0c5', afterCommitOid: '54c8906', ref: 'agents/nested-composer-reuse' }),
    event('IssueEvent_4', '2026-10-21T17:35:24Z', { eventType: 'closed' }),
    event('IssueEvent_5', '2026-10-21T17:36:29Z', { eventType: 'renamed', previousTitle: 'Agents: make it so', newTitle: 'sessions: make it so' }),
    { id: 'IssueComment_1', type: 'TIMELINE_ITEM_TYPE_ISSUE_COMMENT', timestamp: '2026-10-21T17:40:00Z', user, additionalInfo: { issueComment: { commentId: '1' } } },
    event('IssueEvent_6', '2026-10-21T17:45:00Z', { eventType: 'deployed' }, { displayLogin: 'vercel[bot]', avatarUrl: 'https://avatars.githubusercontent.com/in/8329?v=4', userType: 'USER_TYPE_BOT' }),
    event('IssueEvent_7', '2026-10-21T18:08:03Z', { eventType: 'review_dismissed', reviewerLogin: 'connor4312' }),
    event('IssueEvent_8', '2026-10-21T18:10:00Z', { eventType: 'labeled', label: { name: 'pkg/browser', color: '3b105d' } }),
    event('IssueEvent_9', '2026-10-21T18:56:57Z', { eventType: 'merged', commitOid: '7b59892a986b0fc704297dca717b1418baeb97cf' }),
    event('IssueEvent_10', '2026-10-21T18:57:00Z', { eventType: 'head_ref_deleted' }),
  ],
};

const one = (overrides: Partial<TimelineEvent>): TimelineEvent => ({ id: 'x', type: 'closed', login: 'ethanpalm', avatarUrl: '', bot: false, at: '2026-11-13T22:00:00Z', subject: null, label: null, milestone: null, previousTitle: null, newTitle: null, commit: null, ...overrides });

describe('parseTimelineEvents', () => {
  it('reads the pull request’s own events, leaving out deployments, force-pushes and other item types', () => {
    const events = parseTimelineEvents(page);
    expect(events.map((entry) => entry.type)).toEqual(['review_requested', 'assigned', 'closed', 'renamed', 'review_dismissed', 'labeled', 'merged', 'head_ref_deleted']);
    expect(events[0]).toEqual({ id: 'IssueEvent_1', type: 'review_requested', login: 'sandy081', avatarUrl: user.avatarUrl, bot: false, at: '2026-10-21T16:33:46Z', subject: 'Copilot', label: null, milestone: null, previousTitle: null, newTitle: null, commit: null });
    expect(events.find((entry) => entry.type === 'labeled')?.label).toBe('pkg/browser');
    expect(events.find((entry) => entry.type === 'renamed')).toMatchObject({ previousTitle: 'Agents: make it so', newTitle: 'sessions: make it so' });
  });

  it('reads nothing from an answer that is not a timeline page', () => {
    expect(parseTimelineEvents(null)).toEqual([]);
    expect(parseTimelineEvents({ items: 'no' })).toEqual([]);
  });
});

describe('eventWords', () => {
  const branches: EventBranches = { base: 'main', head: 'agents/nested-composer-reuse' };
  const words = (overrides: Partial<TimelineEvent>, known: EventBranches = branches): string => eventText(eventWords(one(overrides), known));

  it('words each event as GitHub’s timeline does', () => {
    expect(words({ type: 'closed' })).toBe('closed this');
    expect(words({ type: 'merged' })).toBe('merged into main');
    expect(words({ type: 'head_ref_deleted' })).toBe('deleted the agents/nested-composer-reuse branch');
    expect(words({ type: 'review_requested', subject: 'Copilot' })).toBe('requested a review from Copilot');
    expect(words({ type: 'review_dismissed', subject: 'connor4312' })).toBe('dismissed connor4312’s review');
    expect(words({ type: 'labeled', label: 'pkg/browser' })).toBe('added the pkg/browser label');
    expect(words({ type: 'auto_squash_enabled' })).toBe('enabled auto-merge (squash)');
  });

  it('says “self-assigned” when the actor assigned themselves', () => {
    expect(words({ type: 'assigned', login: 'sandy081', subject: 'sandy081' })).toBe('self-assigned this');
    expect(eventWords(one({ type: 'assigned', subject: 'brandonmcconnell' }), branches)).toEqual(['assigned ', { user: 'brandonmcconnell' }]);
  });

  it('shows a rename as the old title struck out and the new one', () => {
    expect(eventWords(one({ type: 'renamed', previousTitle: 'Old', newTitle: 'New' }), branches)).toEqual(['changed the title ', { removed: 'Old' }, ' ', { added: 'New' }]);
  });

  it('leaves out branch names the page does not give', () => {
    expect(words({ type: 'merged' }, { base: null, head: null })).toBe('merged this');
    expect(words({ type: 'head_ref_deleted' }, { base: null, head: null })).toBe('deleted the head branch');
  });

  it('falls back to GitHub’s event name for an event it does not know', () => {
    expect(words({ type: 'transferred' })).toBe('transferred');
  });
});

describe('eventState', () => {
  it('is the state change a close, merge or reopen is, and nothing else', () => {
    expect(eventState(one({ type: 'merged' }))).toBe('merged');
    expect(eventState(one({ type: 'reopened' }))).toBe('reopened');
    expect(eventState(one({ type: 'renamed' }))).toBeNull();
  });
});
