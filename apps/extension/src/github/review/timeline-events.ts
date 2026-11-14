import type { ClosureKind } from './fold';

/** One of the pull request's own events (closed, renamed, a review requested…), from the Overview's timeline data. */
export interface TimelineEvent {
  readonly id: string;
  /** GitHub's `eventType`: `closed`, `merged`, `renamed`, `review_requested`… */
  readonly type: string;
  readonly login: string;
  readonly avatarUrl: string;
  readonly bot: boolean;
  /** ISO time of the event. */
  readonly at: string;
  /** Who the event was about: the assignee, the reviewer asked or dismissed (a person, or a team asked to review). */
  readonly subject: EventSubject | null;
  readonly label: string | null;
  readonly milestone: string | null;
  readonly previousTitle: string | null;
  readonly newTitle: string | null;
  readonly commit: string | null;
}

/** A person by login, or a team by its name (`org/slug` when the timeline names its organisation). */
export interface EventSubject {
  readonly name: string;
  readonly team: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const named = (...values: unknown[]): string | null => values.map(text).find((value) => value !== '') ?? null;

/**
 * Events that have rows of their own elsewhere in the digest, as on the classic page: deployments (the Previews and
 * Deployments rows), force-pushes (the commits row and the rounds), and GitHub's notification bookkeeping.
 */
const LISTED_ELSEWHERE = new Set(['deployed', 'head_ref_force_pushed', 'subscribed', 'unsubscribed', 'mentioned']);

/**
 * The pull request's own events in one page of `page_data/timeline`: each `TIMELINE_ITEM_TYPE_ISSUE_EVENT` item but
 * those listed elsewhere. Comments, reviews, commits and cross-references are other item types, read by other rows.
 */
export function parseTimelineEvents(payload: unknown): readonly TimelineEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  const events: TimelineEvent[] = [];
  for (const item of payload.items) {
    if (!isRecord(item) || item.type !== 'TIMELINE_ITEM_TYPE_ISSUE_EVENT') continue;
    const event = isRecord(item.additionalInfo) && isRecord(item.additionalInfo.issueEvent) ? item.additionalInfo.issueEvent : null;
    const type = text(event?.eventType);
    if (event === null || type === '' || LISTED_ELSEWHERE.has(type)) continue;
    const user = isRecord(item.user) ? item.user : {};
    const label = isRecord(event.label) ? event.label : {};
    events.push({
      id: text(item.id),
      type,
      login: text(user.displayLogin),
      avatarUrl: text(user.avatarUrl),
      bot: user.userType === 'USER_TYPE_BOT',
      at: text(item.timestamp),
      subject: subjectOf(event),
      label: named(label.name),
      milestone: named(event.milestoneTitle),
      previousTitle: named(event.previousTitle),
      newTitle: named(event.newTitle),
      commit: named(event.commitOid),
    });
  }
  return events;
}

/**
 * Who an event was about. A team asked to review is read from any field naming a team, whatever GitHub calls it, and a
 * login in `org/slug` form is a team too: a team must never be linked or hovercarded as a person.
 */
function subjectOf(event: Record<string, unknown>): EventSubject | null {
  const team = Object.entries(event).find(([key, value]) => /team/i.test(key) && text(value) !== '')?.[1];
  if (team !== undefined) return { name: text(team), team: true };
  const login = named(event.assigneeLogin, event.reviewerLogin);
  return login === null ? null : { name: login, team: login.includes('/') };
}

/** A piece of an event's words: plain text, a branch, label or commit (`code`), a person, or a title before and after a rename. */
export type EventPart = string | { readonly code: string } | { readonly user: string } | { readonly team: string } | { readonly removed: string } | { readonly added: string };

export interface EventBranches {
  readonly base: string | null;
  readonly head: string | null;
}

/** What the event did, after its actor's name, in the words GitHub's timeline uses. */
export function eventWords(event: TimelineEvent, branches: EventBranches): readonly EventPart[] {
  const subject = event.subject;
  const who: EventPart | null = subject === null ? null : subject.team ? { team: subject.name } : { user: subject.name };
  const self = subject !== null && !subject.team && subject.name.toLowerCase() === event.login.toLowerCase();
  switch (event.type) {
    case 'closed':
      return ['closed this'];
    case 'reopened':
      return ['reopened this'];
    case 'merged':
      return branches.base === null ? ['merged this'] : ['merged into ', { code: branches.base }];
    case 'head_ref_deleted':
      return branches.head === null ? ['deleted the head branch'] : ['deleted the ', { code: branches.head }, ' branch'];
    case 'head_ref_restored':
      return branches.head === null ? ['restored the head branch'] : ['restored the ', { code: branches.head }, ' branch'];
    case 'renamed':
      return event.previousTitle === null || event.newTitle === null ? ['changed the title'] : ['changed the title ', { removed: event.previousTitle }, ' ', { added: event.newTitle }];
    case 'assigned':
      return who === null ? ['assigned someone'] : self ? ['self-assigned this'] : ['assigned ', who];
    case 'unassigned':
      return who === null ? ['unassigned someone'] : self ? ['removed their assignment'] : ['unassigned ', who];
    case 'review_requested':
      return who === null ? ['requested a review'] : ['requested a review from ', who];
    case 'review_request_removed':
      return who === null ? ['removed a request for review'] : ['removed the request for review from ', who];
    case 'review_dismissed':
      return who === null ? ['dismissed a review'] : ['dismissed ', who, '’s review'];
    case 'labeled':
      return event.label === null ? ['added a label'] : ['added the ', { code: event.label }, ' label'];
    case 'unlabeled':
      return event.label === null ? ['removed a label'] : ['removed the ', { code: event.label }, ' label'];
    case 'milestoned':
      return event.milestone === null ? ['added this to a milestone'] : ['added this to the ', { code: event.milestone }, ' milestone'];
    case 'demilestoned':
      return event.milestone === null ? ['removed this from a milestone'] : ['removed this from the ', { code: event.milestone }, ' milestone'];
    case 'locked':
      return ['locked this conversation'];
    case 'unlocked':
      return ['unlocked this conversation'];
    case 'ready_for_review':
      return ['marked this ready for review'];
    case 'convert_to_draft':
      return ['marked this as a draft'];
    case 'auto_merge_enabled':
      return ['enabled auto-merge'];
    case 'auto_squash_enabled':
      return ['enabled auto-merge (squash)'];
    case 'auto_rebase_enabled':
      return ['enabled auto-merge (rebase)'];
    case 'auto_merge_disabled':
      return ['disabled auto-merge'];
    case 'added_to_merge_queue':
      return ['added this to the merge queue'];
    case 'removed_from_merge_queue':
      return ['removed this from the merge queue'];
    case 'base_ref_changed':
      return ['changed the base branch'];
    case 'referenced':
      return event.commit === null ? ['referenced this in a commit'] : ['referenced this in commit ', { code: event.commit.slice(0, 7) }];
    case 'comment_deleted':
      return ['deleted a comment'];
    default:
      return [event.type.replace(/_/g, ' ')];
  }
}

/** The state change an event is, for the row's headline and its glyph's colour. */
export function eventState(event: TimelineEvent): ClosureKind | null {
  return event.type === 'closed' || event.type === 'merged' || event.type === 'reopened' ? event.type : null;
}

/** The plain words, for a tooltip or a screen reader. */
export function eventText(parts: readonly EventPart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : 'code' in part ? part.code : 'user' in part ? part.user : 'team' in part ? part.team : 'removed' in part ? part.removed : part.added)).join('');
}
