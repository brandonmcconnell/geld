import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, ProviderReviewThread, RawCheckRun } from '@geld/review';
import { hasPublishedSummaryPrefix } from '@geld/review';
import { ProviderCiError } from './config';
import { id, isRecord, object, ProviderHttp, sameReviewUrl, sha, text, time } from './http';
import type { OwnedComment, ProviderCiAdapter, ProviderCiReview } from './types';

function author(value: unknown): ProviderReviewAuthor {
  const user = object(value);
  const login = text(user.username);
  if (login.trim() === '') throw new ProviderCiError('GitLab returned an invalid review author.');
  return { id: id(user.id), login, ...(user.bot === true ? { automated: true } : {}) };
}

function note(value: unknown, reviewUrl: string): ProviderReviewComment {
  const raw = object(value);
  const number = id(raw.id);
  return {
    id: number, anchor: `note_${number}`, url: sameReviewUrl(raw.noteable_note_url, reviewUrl) ?? `${reviewUrl}#note_${number}`,
    author: author(raw.author), body: text(raw.body), createdAt: time(raw.created_at),
    ...(raw.updated_at === undefined || raw.updated_at === null ? {} : { updatedAt: time(raw.updated_at) }),
  };
}

function head(value: unknown): string {
  const pr = object(value);
  const refs = isRecord(pr.diff_refs) ? pr.diff_refs : null;
  return sha(refs?.head_sha ?? pr.sha);
}

export class GitLabCiAdapter implements ProviderCiAdapter {
  private readonly projectPath: string;
  private readonly reviewPath: string;
  private readonly reviewUrl: string;

  constructor(private readonly http: ProviderHttp) {
    const { config } = http;
    if (config.provider !== 'gitlab') throw new ProviderCiError('Expected a GitLab CI configuration.');
    this.projectPath = `projects/${encodeURIComponent(config.repository)}`;
    this.reviewPath = `${this.projectPath}/merge_requests/${config.number}`;
    this.reviewUrl = `${config.origin}/${config.repository.split('/').map(encodeURIComponent).join('/')}/-/merge_requests/${config.number}`;
  }

  async identity(): Promise<string> {
    return id(object((await this.http.request('user')).value).id);
  }

  async head(): Promise<string> {
    return head((await this.http.request(this.reviewPath)).value);
  }

  async load(): Promise<ProviderCiReview> {
    const mr = object((await this.http.request(this.reviewPath)).value);
    if (id(mr.iid) !== this.http.config.number) throw new ProviderCiError('GitLab returned a different merge request.');
    const headSha = head(mr);
    const [discussions, rawNotes, approvalResponse, reviewers, pipelines] = await Promise.all([
      this.http.gitlabArray(`${this.reviewPath}/discussions`),
      this.http.gitlabArray(`${this.reviewPath}/notes`),
      this.http.request(`${this.reviewPath}/approvals`),
      this.http.gitlabArray(`${this.reviewPath}/reviewers`),
      this.http.gitlabArray(`${this.reviewPath}/pipelines`),
    ]);
    const owned: OwnedComment[] = rawNotes.map((value) => {
      const raw = object(value);
      return { id: id(raw.id), authorId: author(raw.author).id, body: text(raw.body) };
    });
    const threads: ProviderReviewThread[] = [];
    const seen = new Set<string>();
    const seenDiscussions = new Set<string>();
    for (const value of discussions) {
      const discussion = object(value);
      const discussionId = text(discussion.id);
      if (!/^[a-f0-9]{8,64}$/i.test(discussionId) || !Array.isArray(discussion.notes)) throw new ProviderCiError('GitLab returned an invalid discussion.');
      if (seenDiscussions.has(discussionId)) throw new ProviderCiError('GitLab repeated a discussion.');
      seenDiscussions.add(discussionId);
      const rawThread = discussion.notes.map(object).filter((entry) => entry.system !== true);
      if (rawThread.length === 0) continue;
      const comments = rawThread.map((entry) => note(entry, this.reviewUrl));
      for (const comment of comments) {
        if (seen.has(comment.id)) throw new ProviderCiError('GitLab repeated a discussion note.');
        seen.add(comment.id);
      }
      const first = comments[0];
      const firstRaw = rawThread[0];
      if (first === undefined || firstRaw === undefined) continue;
      const resolvable = rawThread.filter((entry) => entry.resolvable === true);
      if (resolvable.length === 0) continue;
      const position = isRecord(firstRaw.position) ? firstRaw.position : null;
      const path = position?.new_path ?? position?.old_path;
      const line = position?.new_line ?? position?.old_line;
      if (path !== undefined && typeof path !== 'string') throw new ProviderCiError('GitLab returned an invalid discussion path.');
      if (line !== undefined && line !== null && (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0)) throw new ProviderCiError('GitLab returned an invalid discussion line.');
      const resolutionKnown = typeof discussion.resolved === 'boolean' || resolvable.every((entry) => typeof entry.resolved === 'boolean');
      const resolved = typeof discussion.resolved === 'boolean' ? discussion.resolved : resolvable.every((entry) => entry.resolved === true);
      const active = typeof discussion.active === 'boolean' ? discussion.active : typeof firstRaw.active === 'boolean' ? firstRaw.active : null;
      const outdated = active !== null ? !active : typeof firstRaw.outdated === 'boolean' ? firstRaw.outdated : null;
      const nonDiff = position === null && (discussion.diff_discussion === false || firstRaw.type === 'DiscussionNote');
      threads.push({
        id: discussionId, anchor: `discussion_${discussionId}`, url: first.url, comments,
        resolved, outdated: outdated === true, stateKnown: resolutionKnown && (outdated !== null || nonDiff),
        ...(typeof path === 'string' && path !== '' ? { path } : {}),
        ...(typeof line === 'number' ? { line } : {}),
      });
    }
    const standings = new Map<string, ProviderReviewReviewer>();
    for (const value of reviewers) {
      const reviewer = object(value);
      const user = author(reviewer.user ?? reviewer);
      const state = reviewer.state;
      standings.set(user.id, { author: user, state: state === 'requested_changes' ? 'changes_requested' : state === 'approved' ? 'approved' : state === 'reviewed' ? 'commented' : 'pending', reviewRequest: state === 'unreviewed' ? 'pending' : state === 'approved' || state === 'requested_changes' || state === 'reviewed' ? 'not-pending' : 'unknown' });
    }
    const approvals = object(approvalResponse.value);
    if (!Array.isArray(approvals.approved_by)) throw new ProviderCiError('GitLab omitted approval data.');
    for (const value of approvals.approved_by) {
      const user = author(object(value).user);
      const standing = standings.get(user.id);
      standings.set(user.id, { author: user, state: 'approved', reviewRequest: standing?.reviewRequest ?? 'unknown' });
    }
    const latestChecks = new Map<string, { readonly id: bigint; readonly check: RawCheckRun }>();
    const pipelineIds = new Set<string>();
    for (const value of pipelines) {
      const pipeline = object(value);
      if (sha(pipeline.sha) !== headSha) continue;
      const pipelineId = id(pipeline.id);
      if (pipelineIds.has(pipelineId)) throw new ProviderCiError('GitLab repeated a pipeline.');
      pipelineIds.add(pipelineId);
      const projectId = id(pipeline.project_id ?? mr.project_id);
      for (const raw of await this.http.gitlabArray(`projects/${projectId}/pipelines/${pipelineId}/jobs?include_retried=true`)) {
        const job = object(raw);
        const state = text(job.status);
        const completed = ['success', 'failed', 'canceled', 'skipped'].includes(state);
        const url = typeof job.web_url === 'string' ? new URL(job.web_url) : null;
        if (url !== null && (url.origin !== this.http.config.origin || url.username !== '' || url.password !== '')) throw new ProviderCiError('GitLab returned an untrusted job URL.');
        const name = text(job.name);
        const jobId = BigInt(id(job.id));
        const check: RawCheckRun = {
          name, sha: headSha, status: completed ? 'completed' : state === 'manual' ? 'waiting' : 'in_progress',
          conclusion: !completed ? null : state === 'success' ? 'success' : state === 'failed' ? 'failure' : state === 'canceled' ? 'cancelled' : 'skipped',
          ...(job.started_at === null || job.started_at === undefined ? {} : { startedAt: time(job.started_at) }),
          ...(job.finished_at === null || job.finished_at === undefined ? {} : { completedAt: time(job.finished_at) }),
          ...(url === null ? {} : { detailsUrl: url.href }),
        };
        const previous = latestChecks.get(name);
        if (previous === undefined || previous.id < jobId) latestChecks.set(name, { id: jobId, check });
      }
    }
    const input: ProviderReviewInput = {
      subject: { provider: 'gitlab', origin: this.http.config.origin, repository: this.http.config.repository, id: this.http.config.number, headSha },
      threads, reviewers: [...standings.values()], checks: [...latestChecks.values()].map((entry) => entry.check), bots: [],
    };
    if (await this.head() !== headSha) throw new ProviderCiError('GitLab changed the merge request while the summary was loading.');
    const notes: string[] = [];
    if (typeof approvals.approvals_required === 'number' && Number.isSafeInteger(approvals.approvals_required) && approvals.approvals_required >= 0) notes.push(`Required approvals: ${approvals.approvals_required}`);
    const unknownThreadState = threads.some((thread) => thread.stateKnown !== true);
    if (unknownThreadState) notes.push('Native resolution or outdated state is unavailable for some review discussions.');
    return { input, comments: owned, sourceCoverage: { comments: 'complete', threads: unknownThreadState ? 'partial' : 'complete' }, notes };
  }

  async upsert(commentId: string | null, body: string): Promise<void> {
    if (commentId !== null) {
      const [owner, current] = await Promise.all([this.identity(), this.http.request(`${this.reviewPath}/notes/${id(commentId)}`)]);
      const note = object(current.value);
      if (author(note.author).id !== owner || !hasPublishedSummaryPrefix(text(note.body))) throw new ProviderCiError('Refusing to update a GitLab note not owned by the token.');
    }
    await this.http.request(`${this.reviewPath}/notes${commentId === null ? '' : `/${id(commentId)}`}`, commentId === null ? 'POST' : 'PUT', { body });
  }
}
