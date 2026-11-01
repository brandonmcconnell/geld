import type {
  ProviderReviewAuthor,
  ProviderReviewCheck,
  ProviderReviewComment,
  ProviderReviewInput,
  ProviderReviewReviewer,
  ProviderReviewSubject,
  ProviderReviewThread,
} from '@geld/review';
import type { ProviderReviewPage, ProviderReviewSnapshot } from '../providers/types';

type JsonObject = Readonly<Record<string, unknown>>;
type GitLabMergeRequestState = 'opened' | 'closed' | 'merged' | 'locked';

export interface GitLabReviewEvent {
  readonly id: string;
  readonly url: string;
  readonly author: ProviderReviewAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly icon: string | null;
  readonly kind: 'push' | 'activity';
}

export interface GitLabReviewCapabilities {
  readonly signedIn: boolean;
  readonly canApprove: boolean;
  readonly canComment: boolean;
  readonly canReview: boolean;
  readonly requestChanges: 'available' | 'unavailable' | 'unknown';
}

export interface GitLabNativeNoteCapabilities {
  readonly noteId: string;
  readonly canEdit: boolean;
  readonly canReact: boolean;
  readonly canResolve: boolean;
  readonly canResolveDiscussion: boolean;
}

export interface GitLabNativeThreadCapabilities {
  readonly discussionId: string;
  readonly resolvable: boolean;
  readonly resolved: boolean;
  readonly canResolve: boolean;
  readonly notes: readonly GitLabNativeNoteCapabilities[];
}

export interface GitLabReviewCheck extends ProviderReviewCheck {
  readonly id: string;
  readonly url: string;
  readonly pipelineId: string;
  readonly nativeStatus: string;
  readonly allowFailure: boolean;
  readonly reviewHeadSha?: string;
}

export interface GitLabReviewSnapshot {
  readonly sourceCoverage: NonNullable<ProviderReviewSnapshot['sourceCoverage']>;
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly events: readonly GitLabReviewEvent[];
  readonly checks: readonly GitLabReviewCheck[];
  readonly capabilities: GitLabReviewCapabilities;
  readonly threadCapabilities: ReadonlyMap<string, GitLabNativeThreadCapabilities>;
  readonly approvalsRequired: number | null;
  readonly approvalsLeft: number | null;
  readonly state: GitLabMergeRequestState;
  readonly complete: boolean;
  readonly unavailable: readonly { readonly area: string; readonly reason: string }[];
}

export class GitLabReviewError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = 'GitLabReviewError';
  }
}

const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_RECORDS = 20_000;
const SHA = /^[0-9a-f]{40,64}$/i;

function record(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nativeId(value: unknown): string | null {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function mergeRequestState(value: unknown): GitLabMergeRequestState {
  if (value === 'opened' || value === 'closed' || value === 'merged' || value === 'locked') return value;
  throw new GitLabReviewError('GitLab returned an invalid merge request state.');
}

function time(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new GitLabReviewError('GitLab returned an invalid review timestamp.');
  return value;
}

function sameOriginUrl(value: unknown, base: string, prefix?: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value, base);
    const origin = new URL(base).origin;
    if (url.origin !== origin || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    if (prefix !== undefined && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function authorOf(value: unknown): ProviderReviewAuthor {
  if (!record(value)) throw new GitLabReviewError('GitLab returned a review without an author.');
  const id = nativeId(value.id);
  if (id === null || typeof value.username !== 'string' || value.username.trim() === '') throw new GitLabReviewError('GitLab returned an invalid review author.');
  return {
    id,
    login: value.username,
    ...(value.bot === true || (typeof value.user_type === 'string' && value.user_type !== 'human') ? { automated: true } : {}),
  };
}

function noteOf(value: unknown, subject: ProviderReviewSubject): ProviderReviewComment {
  if (!record(value)) throw new GitLabReviewError('GitLab returned an invalid note.');
  const id = nativeId(value.id);
  if (id === null || typeof value.note !== 'string') throw new GitLabReviewError('GitLab returned an invalid note identity or body.');
  const anchor = `note_${id}`;
  const base = `${subject.origin}/${subject.repository}/-/merge_requests/${subject.id}`;
  const prefix = new URL(base).pathname;
  const url = sameOriginUrl(value.noteable_note_url, base, prefix) ?? `${base}#${anchor}`;
  return {
    id,
    anchor,
    url,
    author: authorOf(value.author),
    body: value.note,
    createdAt: time(value.created_at),
    ...(value.updated_at === undefined || value.updated_at === null ? {} : { updatedAt: time(value.updated_at) }),
  };
}

export function parseGitLabDiscussions(value: unknown, subject: ProviderReviewSubject): {
  readonly threads: readonly ProviderReviewThread[];
  readonly comments: readonly ProviderReviewComment[];
  readonly events: readonly GitLabReviewEvent[];
  readonly threadCapabilities: ReadonlyMap<string, GitLabNativeThreadCapabilities>;
} {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new GitLabReviewError('GitLab returned an invalid discussion list.');
  const threads: ProviderReviewThread[] = [];
  const comments: ProviderReviewComment[] = [];
  const events: GitLabReviewEvent[] = [];
  const threadCapabilities = new Map<string, GitLabNativeThreadCapabilities>();
  const seenNotes = new Set<string>();
  const seenDiscussions = new Set<string>();
  let noteCount = 0;
  for (const item of value) {
    if (!record(item) || typeof item.id !== 'string' || !/^[a-f0-9]{8,64}$/.test(item.id) || !Array.isArray(item.notes)) {
      throw new GitLabReviewError('GitLab returned an invalid discussion.');
    }
    if (seenDiscussions.has(item.id)) throw new GitLabReviewError('GitLab returned a duplicate discussion.');
    seenDiscussions.add(item.id);
    const notes: ProviderReviewComment[] = [];
    const nativeNotes: GitLabNativeNoteCapabilities[] = [];
    const resolvableNotes: GitLabNativeNoteCapabilities[] = [];
    for (const note of item.notes) {
      noteCount += 1;
      if (noteCount > MAX_RECORDS || !record(note)) throw new GitLabReviewError('GitLab returned too many notes or an invalid note.');
      if (note.system === true) {
        if (typeof note.note !== 'string') throw new GitLabReviewError('GitLab returned an invalid activity.');
        const id = nativeId(note.id) ?? (typeof note.id === 'string' && /^[a-f0-9]{8,64}$/.test(note.id) ? note.id : null);
        if (id === null) throw new GitLabReviewError('GitLab returned an invalid activity identity.');
        events.push({
          id,
          url: sameOriginUrl(note.noteable_note_url, subject.origin) ?? `${subject.origin}/${subject.repository}/-/merge_requests/${subject.id}`,
          author: authorOf(note.author),
          body: note.note,
          createdAt: time(note.created_at),
          icon: typeof note.system_note_icon_name === 'string' ? note.system_note_icon_name : null,
          kind: note.system_note_icon_name === 'commit' ? 'push' : 'activity',
        });
        continue;
      }
      const parsed = noteOf(note, subject);
      if (seenNotes.has(parsed.id)) throw new GitLabReviewError('GitLab returned a duplicate note.');
      seenNotes.add(parsed.id);
      notes.push(parsed);
      const permissions = record(note.current_user) ? note.current_user : null;
      const capabilities: GitLabNativeNoteCapabilities = {
        noteId: parsed.id,
        canEdit: permissions?.can_edit === true,
        canReact: permissions?.can_award_emoji === true,
        canResolve: permissions?.can_resolve === true,
        canResolveDiscussion: permissions?.can_resolve_discussion === true,
      };
      nativeNotes.push(capabilities);
      if (note.resolvable === true) resolvableNotes.push(capabilities);
    }
    if (notes.length === 0) continue;
    threadCapabilities.set(item.id, {
      discussionId: item.id,
      resolvable: item.resolvable === true,
      resolved: item.resolved === true,
      canResolve: item.resolvable === true && resolvableNotes.length > 0 && resolvableNotes.every((note) => note.canResolveDiscussion),
      notes: nativeNotes,
    });
    if (item.resolvable !== true) {
      comments.push(...notes);
      continue;
    }
    const first = notes[0];
    if (first === undefined) continue;
    const position = record(item.position) ? item.position : null;
    const file = record(item.diff_file) ? item.diff_file : null;
    const path = position?.new_path ?? position?.old_path ?? file?.new_path ?? file?.old_path;
    const line = position?.new_line ?? position?.old_line;
    const base = `${subject.origin}/${subject.repository}/-/merge_requests/${subject.id}`;
    threads.push({
      id: item.id,
      anchor: `discussion_${item.id}`,
      url: sameOriginUrl(item.discussion_path, base, new URL(base).pathname) ?? first.url,
      resolved: item.resolved === true,
      outdated: item.active === false,
      stateKnown: typeof item.resolved === 'boolean' && (item.diff_discussion === false || typeof item.active === 'boolean'),
      comments: notes,
      ...(typeof path === 'string' && path !== '' ? { path } : {}),
      ...(typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    });
  }
  return { threads, comments, events, threadCapabilities };
}

function retryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60 * 60 * 1000);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, Math.min(deadline - Date.now(), 60 * 60 * 1000)) : null;
}

async function jsonResponse(url: string, origin: string, signal: AbortSignal, cache?: RequestCache): Promise<{ readonly value: unknown; readonly response: Response }> {
  if (sameOriginUrl(url, origin) === null) throw new GitLabReviewError('Refused a review endpoint outside this GitLab host.');
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal, ...(cache === undefined ? {} : { cache }) });
  if (!response.ok) throw new GitLabReviewError(`GitLab review source returned ${response.status}.`, response.status, retryAfter(response.headers.get('retry-after')));
  if (response.url !== '' && sameOriginUrl(response.url, origin) === null) throw new GitLabReviewError('GitLab redirected a review source to another host.');
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/(?:[\w.-]+\+)?json\b/i.test(type)) throw new GitLabReviewError('GitLab returned a sign-in page or non-JSON review source.');
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_JSON_BYTES) throw new GitLabReviewError('The GitLab review source is too large.');
  const text = await response.text();
  if (text.length > MAX_JSON_BYTES || new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new GitLabReviewError('The GitLab review source is too large.');
  try {
    const value: unknown = JSON.parse(text);
    return { value, response };
  } catch {
    throw new GitLabReviewError('GitLab returned invalid review JSON.');
  }
}

async function listResponse(url: string, origin: string, signal: AbortSignal): Promise<readonly unknown[]> {
  const items: unknown[] = [];
  const endpoint = new URL(url);
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const next = new URL(endpoint);
    if (cursor !== null) next.searchParams.set('cursor', cursor);
    else if (page > 1) next.searchParams.set('page', String(page));
    const { value, response } = await jsonResponse(next.href, origin, signal);
    if (!Array.isArray(value)) throw new GitLabReviewError('GitLab returned an invalid review list.');
    items.push(...value);
    if (items.length > MAX_RECORDS) throw new GitLabReviewError('The GitLab review source has too many records.');
    const nextCursor = response.headers.get('x-next-page-cursor');
    if (nextCursor !== null && nextCursor !== '') {
      if (nextCursor.length > 4096 || seenCursors.has(nextCursor)) throw new GitLabReviewError('GitLab returned an invalid review pagination cursor.');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      continue;
    }
    if (cursor !== null) return items;
    const nextPage = response.headers.get('x-next-page');
    if (nextPage === null || nextPage === '') return items;
    if (nextPage !== String(page + 1)) throw new GitLabReviewError('GitLab returned an invalid review pagination cursor.');
  }
  throw new GitLabReviewError('The GitLab review source has too many pages.');
}

function attributeJson(doc: Document, selector: string, attribute: string): JsonObject | null {
  const text = doc.querySelector(selector)?.getAttribute(attribute);
  if (text === undefined || text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

export function gitLabReviewCapabilities(doc: Document, approvals: unknown = null): GitLabReviewCapabilities {
  const current = attributeJson(doc, '#js-vue-mr-discussions', 'data-current-user-data');
  const signedIn = nativeId(current?.id) !== null || doc.querySelector('.js-mr-title-actions[data-is-signed-in="true"]') !== null;
  const drawer = doc.querySelector<HTMLButtonElement>('button[data-testid="review-drawer-toggle"]');
  const canReview = signedIn && drawer !== null;
  const comment = doc.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"], textarea#note-body');
  const canComment = signedIn && comment !== null && !comment.disabled && !comment.readOnly;
  const changes = doc.querySelector<HTMLInputElement>('[data-testid="reviewer_states"] input[value="requested_changes"]');
  return {
    signedIn,
    canApprove: signedIn && record(approvals) && approvals.user_can_approve === true,
    canComment,
    canReview,
    requestChanges: !signedIn ? 'unavailable' : changes === null ? 'unknown' : changes.disabled ? 'unavailable' : 'available',
  };
}

function validPipeline(value: unknown): value is JsonObject {
  return record(value) && nativeId(value.id) !== null && typeof value.sha === 'string' && SHA.test(value.sha)
    && (value.project_id === undefined || nativeId(value.project_id) !== null);
}

function checkOf(value: unknown, pipelineId: string, sha: string, origin: string): GitLabReviewCheck {
  if (!record(value)) throw new GitLabReviewError('GitLab returned an invalid pipeline job.');
  const id = nativeId(value.id);
  const url = sameOriginUrl(value.web_url, origin);
  if (id === null || typeof value.name !== 'string' || typeof value.status !== 'string' || url === null) throw new GitLabReviewError('GitLab returned an invalid pipeline job identity.');
  const nativeStatus = value.status;
  const running = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled'].includes(nativeStatus);
  const conclusion = running ? null : nativeStatus === 'success' ? 'success' : nativeStatus === 'failed' ? 'failure' : nativeStatus === 'canceled' ? 'cancelled' : nativeStatus === 'skipped' ? 'skipped' : 'neutral';
  return {
    id,
    name: value.name,
    key: `job:${id}`,
    status: running ? nativeStatus === 'running' ? 'in_progress' : 'queued' : 'completed',
    conclusion,
    sha,
    url,
    detailsUrl: url,
    pipelineId,
    nativeStatus,
    allowFailure: value.allow_failure === true,
    ...(typeof value.started_at === 'string' && Number.isFinite(Date.parse(value.started_at)) ? { startedAt: value.started_at } : {}),
    ...(typeof value.finished_at === 'string' && Number.isFinite(Date.parse(value.finished_at)) ? { completedAt: value.finished_at } : {}),
  };
}

export async function fetchGitLabReview(page: ProviderReviewPage, signal: AbortSignal, doc: Document = document): Promise<GitLabReviewSnapshot> {
  if (page.provider !== 'gitlab' || page.repository.provider !== 'gitlab' || !/^[1-9]\d*$/.test(page.number)) throw new GitLabReviewError('Expected a GitLab merge request.');
  const origin = page.repository.origin;
  const base = `${origin}/${page.repository.path}/-/merge_requests/${page.number}`;
  const project = encodeURIComponent(page.repository.path);
  const api = `${origin}/api/v4/projects/${project}/merge_requests/${page.number}`;
  const mr = (await jsonResponse(api, origin, signal, 'no-cache')).value;
  if (!record(mr) || nativeId(mr.iid) !== page.number || typeof mr.sha !== 'string' || !SHA.test(mr.sha)) throw new GitLabReviewError('GitLab returned invalid merge request metadata.');
  if (page.headSha !== null && page.headSha !== mr.sha) throw new GitLabReviewError('The merge request head changed. Refresh its review sources.');
  const subject: ProviderReviewSubject = { provider: 'gitlab', origin, repository: page.repository.path, id: page.number, headSha: mr.sha };
  const notes = attributeJson(doc, '#js-vue-mr-discussions', 'data-notes-data');
  const discussionPath = sameOriginUrl(notes?.discussionsPath, base, new URL(base).pathname) ?? `${base}/discussions.json`;
  const discussionsUrl = new URL(discussionPath);
  discussionsUrl.searchParams.delete('cursor');
  discussionsUrl.searchParams.delete('page');
  discussionsUrl.searchParams.set('per_page', '100');
  discussionsUrl.searchParams.set('notes_filter', '0');
  discussionsUrl.searchParams.set('persist_filter', 'false');
  const results = await Promise.allSettled([
    listResponse(discussionsUrl.href, origin, signal),
    jsonResponse(`${api}/approvals`, origin, signal),
    listResponse(`${api}/pipelines?per_page=100`, origin, signal),
    listResponse(`${api}/reviewers?per_page=100`, origin, signal),
  ]);
  signal.throwIfAborted();
  const discussionResult = results[0];
  if (discussionResult?.status !== 'fulfilled') throw discussionResult?.status === 'rejected' ? discussionResult.reason : new GitLabReviewError('GitLab discussions are unavailable.');
  const parsed = parseGitLabDiscussions(discussionResult.value, subject);
  const unavailable: { area: string; reason: string }[] = [];
  const unknownThreadState = parsed.threads.some((thread) => thread.stateKnown !== true);
  if (unknownThreadState) unavailable.push({ area: 'thread state', reason: 'GitLab did not supply the native resolution or active state of every discussion.' });
  const areaError = (area: string, reason: unknown): void => {
    unavailable.push({ area, reason: reason instanceof Error ? reason.message : 'GitLab source unavailable.' });
  };
  const approvalResult = results[1];
  const approvals = approvalResult?.status === 'fulfilled' && record(approvalResult.value.value) ? approvalResult.value.value : null;
  if (approvals === null) areaError('reviews', approvalResult?.status === 'rejected' ? approvalResult.reason : 'Invalid approval data.');
  const reviewerMap = new Map<string, ProviderReviewReviewer>();
  if (approvals !== null && Array.isArray(approvals.approved_by)) {
    for (const item of approvals.approved_by) {
      if (!record(item)) throw new GitLabReviewError('GitLab returned invalid approver data.');
      const author = authorOf(item.user);
      reviewerMap.set(author.id, { author, state: 'approved', reviewRequest: 'unknown' });
    }
  }
  const reviewerResult = results[3];
  if (reviewerResult?.status === 'fulfilled') {
    for (const item of reviewerResult.value) {
      if (!record(item)) throw new GitLabReviewError('GitLab returned invalid reviewer data.');
      const author = authorOf(item.user);
      const standing = reviewerMap.get(author.id);
      if (item.state === 'approved' || item.state === 'requested_changes') {
        reviewerMap.set(author.id, { author, state: item.state === 'approved' ? 'approved' : 'changes_requested', reviewRequest: 'not-pending' });
      } else if (item.state === 'reviewed' || item.state === 'unreviewed') {
        reviewerMap.set(author.id, { author, state: standing?.state ?? (item.state === 'reviewed' ? 'commented' : 'pending'), reviewRequest: item.state === 'unreviewed' ? 'pending' : 'not-pending' });
      } else {
        reviewerMap.set(author.id, { author, state: standing?.state ?? 'pending', reviewRequest: 'unknown' });
        areaError('reviews', 'GitLab returned an unknown reviewer state.');
      }
    }
  } else if (reviewerResult?.status === 'rejected') areaError('reviews', reviewerResult.reason);
  const pipelineResult = results[2];
  const pipelines = pipelineResult?.status === 'fulfilled' ? pipelineResult.value : [];
  if (pipelineResult?.status === 'rejected') areaError('checks', pipelineResult.reason);
  const headPipeline = validPipeline(mr.head_pipeline) ? mr.head_pipeline : null;
  const invalidPipelines = pipelines.some((pipeline) => !validPipeline(pipeline))
    || (mr.head_pipeline !== undefined && mr.head_pipeline !== null && headPipeline === null);
  if (invalidPipelines) areaError('checks', 'GitLab returned an incomplete pipeline identity.');
  const pipeline = pipelines.find((item) => validPipeline(item) && nativeId(item.id) === nativeId(headPipeline?.id))
    ?? pipelines.find((item) => validPipeline(item) && item.sha === mr.sha)
    ?? headPipeline;
  const checks: GitLabReviewCheck[] = [];
  let checksCoverage: 'complete' | 'partial' | 'unavailable' = pipelineResult?.status === 'fulfilled' ? 'complete' : 'unavailable';
  if (record(pipeline)) {
    const pipelineId = nativeId(pipeline.id);
    const projectId = nativeId(pipeline.project_id) ?? nativeId(mr.project_id);
    const sha = typeof pipeline.sha === 'string' && SHA.test(pipeline.sha) ? pipeline.sha : null;
    if (pipelineId !== null && projectId !== null && sha !== null) {
      try {
        const jobs = await listResponse(`${origin}/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`, origin, signal);
        const associatedHead = nativeId(headPipeline?.id) === pipelineId ? mr.sha : null;
        checks.push(...jobs.map((job) => {
          const check = checkOf(job, pipelineId, sha, origin);
          return associatedHead === null ? check : { ...check, reviewHeadSha: associatedHead };
        }));
        checksCoverage = 'complete';
      } catch (error) {
        signal.throwIfAborted();
        areaError('checks', error);
        checksCoverage = 'unavailable';
      }
    } else {
      areaError('checks', 'GitLab returned an incomplete pipeline identity.');
      checksCoverage = 'unavailable';
    }
  }
  if (invalidPipelines) checksCoverage = checks.length > 0 ? 'partial' : 'unavailable';
  const latest = (await jsonResponse(api, origin, signal, 'no-cache')).value;
  if (!record(latest) || latest.sha !== mr.sha) throw new GitLabReviewError('The merge request changed while its review was loading.');
  const state = mergeRequestState(latest.state);
  const complete = unavailable.length === 0;
  return {
    input: { subject, threads: parsed.threads, reviewers: [...reviewerMap.values()], checks, checksCoverage, complete, closed: state === 'closed' || state === 'merged' },
    comments: parsed.comments,
    sourceCoverage: { comments: 'complete', threads: unknownThreadState ? 'partial' : 'complete' },
    events: parsed.events,
    checks,
    capabilities: gitLabReviewCapabilities(doc, approvals),
    threadCapabilities: parsed.threadCapabilities,
    approvalsRequired: approvals === null ? null : nonnegative(approvals.approvals_required),
    approvalsLeft: approvals === null ? null : nonnegative(approvals.approvals_left),
    state,
    complete,
    unavailable,
  };
}
